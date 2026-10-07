import { bindingData, bindingLength, compare, compileReference, makeInputs, workgroupCount } from './input';
import type { Absence, GpuPreset, RunResult, Stage, StageKey, StageState } from './types';

export type { Absence };

/**
 * Пространства флагов WebGPU. Интерфейсы (`GPUDevice`, `GPUBuffer`…) в `lib.dom` TypeScript 6
 * есть, а глобальных объектов с флагами — нет: `vue-tsc` видит `GPUBufferUsage` как неизвестное
 * имя. Объявлены ровно те флаги, которыми пользуется демо; сами значения берутся из браузера.
 */
declare const GPUBufferUsage: { readonly MAP_READ: number; readonly COPY_SRC: number; readonly COPY_DST: number; readonly STORAGE: number };
declare const GPUShaderStage: { readonly COMPUTE: number };
declare const GPUMapMode: { readonly READ: number };

/**
 * Прогон предустановки — на GPU читателя или, если WebGPU нет, моделью на JS.
 *
 * Модуль чистый в том смысле, в каком здесь это возможно: ни Vue, ни DOM. Компонент передаёт
 * `report` и перерисовывает этапы по мере прохождения. Зовётся **только по кнопке**: на
 * `client:visible` он не запускается, чтобы не просить у системы видеокарту ради прокрутки.
 *
 * ⚠️ Времени здесь нет ни одного — это правило темы, а не упущение. `submit` возвращается
 * раньше, чем GPU начал работать, и секундомер вокруг него мерил бы постановку в очередь;
 * а на программном адаптере (SwiftShader) — процессор. Демо показывает **что** произошло
 * и в каком порядке, но не сколько это заняло.
 */

export const STAGE_CALLS: Record<StageKey, string> = {
  device: 'requestAdapter() → requestDevice()',
  buffers: 'createBuffer + queue.writeBuffer',
  pipeline: 'createShaderModule → createComputePipeline → createBindGroup',
  encode: 'createCommandEncoder → beginComputePass → dispatchWorkgroups → finish()',
  submit: 'queue.submit([commandBuffer])',
  map: 'mapAsync(READ) → getMappedRange() → unmap()',
  check: 'сверка с эталоном на JS',
};

const ORDER: StageKey[] = ['device', 'buffers', 'pipeline', 'encode', 'submit', 'map', 'check'];

export function emptyStages(): Stage[] {
  return ORDER.map((key) => ({ key, call: STAGE_CALLS[key], state: 'idle', detail: '' }));
}

type Report = (stages: Stage[]) => void;

function stepper(report: Report) {
  const stages = emptyStages();
  const set = (key: StageKey, state: StageState, detail = '') => {
    const s = stages.find((x) => x.key === key)!;
    s.state = state;
    s.detail = detail;
    report(stages.map((x) => ({ ...x })));
  };
  return { stages, set };
}

const kb = (bytes: number) => (bytes >= 1024 ? `${Math.round(bytes / 1024).toLocaleString('ru-RU')} КБ` : `${bytes} Б`);
const num = (n: number) => n.toLocaleString('ru-RU');

/** Первая содержательная строка сообщения: у Dawn дальше идёт цепочка «While …». */
const firstLine = (msg: string) => msg.split('\n').map((l) => l.trim()).find(Boolean) ?? msg;

export function absenceNote(why: Absence): string {
  if (why === 'insecure')
    return 'страница открыта не в защищённом контексте: `navigator.gpu` есть только на `https:` и `localhost`';
  if (why === 'no-api') return 'в вашем браузере WebGPU нет: `navigator.gpu` не определён';
  return '`navigator.gpu` есть, но `requestAdapter()` вернул `null` — подходящей видеокарты браузер не дал';
}

/** Настоящий прогон. Бросает только если WebGPU нет — это решает вызывающий. */
export async function runOnGpu(preset: GpuPreset, report: Report): Promise<RunResult> {
  const { stages, set } = stepper(report);
  const inputs = makeInputs(preset.n);
  const reference = compileReference(preset.reference)(inputs, preset.bins);

  set('device', 'run');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no-adapter');
  const device = await adapter.requestDevice();
  const info = adapter.info;
  const who = [...new Set([info?.vendor, info?.architecture].filter(Boolean))].join(' · ') || 'браузер не назвал';
  set(
    'device',
    'ok',
    `адаптер: **${who}**${info?.isFallbackAdapter ? ' — программный, считает процессор' : ''}; ` +
      `у устройства \`maxComputeInvocationsPerWorkgroup\` = ${device.limits.maxComputeInvocationsPerWorkgroup}, ` +
      `у адаптера — ${adapter.limits.maxComputeInvocationsPerWorkgroup}`,
  );

  try {
    // ---- буферы ----
    set('buffers', 'run');
    const U = GPUBufferUsage;
    let bytes = 0;
    const buffers = preset.bindings.map((b) => {
      const data = bindingData(b, preset, inputs);
      const size = bindingLength(b, preset) * 4;
      bytes += size;
      const usage = b.forgetStorage ? U.COPY_SRC | U.COPY_DST : U.STORAGE | U.COPY_SRC | U.COPY_DST;
      const buffer = device.createBuffer({ size, usage, label: b.name });
      device.queue.writeBuffer(buffer, 0, data);
      return buffer;
    });
    const outIndex = preset.bindings.findIndex((b) => b.out);
    const outBinding = preset.bindings[outIndex];
    const outSize = bindingLength(outBinding, preset) * 4;
    const readback = device.createBuffer({ size: outSize, usage: U.MAP_READ | U.COPY_DST, label: 'readback' });
    set(
      'buffers',
      'ok',
      `${buffers.length} буфера на GPU, всего ${kb(bytes)}, и ещё один на ${kb(outSize)} — только для чтения обратно ` +
        '(`MAP_READ` сочетается лишь с `COPY_DST`). `writeBuffer` скопировал входы в момент вызова',
    );

    // ---- конвейер и привязки ----
    set('pipeline', 'run');
    const module = device.createShaderModule({ code: preset.wgsl, label: preset.key });
    const compile = await module.getCompilationInfo();
    const errors = compile.messages.filter((m) => m.type === 'error');
    if (errors.length > 0) {
      set('pipeline', 'err', errors.map((m) => `${m.lineNum}:${m.linePos} ${firstLine(m.message)}`).join('; '));
      throw new Error('compile');
    }
    device.pushErrorScope('validation');
    const bindGroupLayout = device.createBindGroupLayout({
      entries: preset.bindings.map((b) => ({
        binding: b.binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: b.type },
      })),
    });
    const pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      compute: { module, entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: buffers.map((buffer, i) => ({ binding: preset.bindings[i].binding, resource: { buffer } })),
    });
    const bindError = await device.popErrorScope();
    set(
      'pipeline',
      bindError ? 'err' : 'ok',
      bindError
        ? `исключения не было — ошибку поймала область ошибок: «${firstLine(bindError.message)}»`
        : `шейдер собран, конвейер создан: ${preset.bindings.length} привязки в группе 0, у объекта конвейера нет ни одного сеттера`,
    );

    // ---- запись команд ----
    set('encode', 'run');
    const groups = workgroupCount(preset.n, preset.workgroupSize);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(groups);
    pass.end();
    encoder.copyBufferToBuffer(buffers[outIndex], 0, readback, 0, outSize);
    const commands = encoder.finish();
    const extra = groups * preset.workgroupSize - preset.n;
    set(
      'encode',
      'ok',
      `рабочих групп: ${num(groups)} по ${preset.workgroupSize}, всего вызовов шейдера: ${num(groups * preset.workgroupSize)}` +
        (extra > 0 ? `; лишние ${extra} отсекает проверка границы в шейдере` : '') +
        `. Записан \`${commands.constructor.name}\` — GPU ещё ничего не сделал`,
    );

    // ---- отправка ----
    set('submit', 'run');
    device.pushErrorScope('validation');
    const returned = device.queue.submit([commands]);
    const submitError = await device.popErrorScope();
    set(
      'submit',
      submitError ? 'err' : 'ok',
      `\`submit\` вернул \`${String(returned)}\` сразу` +
        (submitError
          ? `; исключения нет, отправка отклонена: «${firstLine(submitError.message)}»`
          : ' — работа ушла в очередь, результата у страницы пока нет'),
    );

    // ---- чтение ----
    set('map', 'run');
    const states = [readback.mapState as string];
    const mapping = readback.mapAsync(GPUMapMode.READ);
    states.push(readback.mapState);
    await mapping;
    states.push(readback.mapState);
    const range = readback.getMappedRange();
    const got = new Uint32Array(range.slice(0));
    readback.unmap();
    states.push(readback.mapState);
    set(
      'map',
      'ok',
      `\`mapState\`: ${states.map((s) => `\`${s}\``).join(' → ')}. После \`unmap()\` полученный ` +
        `\`ArrayBuffer\` обнулён: \`byteLength\` = ${range.byteLength} — поэтому копия берётся до него`,
    );

    // ---- сверка ----
    const cmp = compare(got, reference);
    set(
      'check',
      cmp.mismatches === 0 ? 'ok' : 'err',
      `эталон — функция \`reference\` из данных темы, исполненная у вас на тех же входах; сравнение поэлементное, по ${num(reference.length)} значениям`,
    );

    return { mode: 'gpu', stages, mismatches: cmp.mismatches, total: reference.length, sample: cmp.sample, sum: cmp.sum, sumExpected: cmp.sumExpected };
  } catch (e) {
    if ((e as Error).message === 'compile') {
      return { mode: 'gpu', stages, mismatches: null, total: reference.length, sample: [], sum: 0, sumExpected: 0 };
    }
    throw e;
  } finally {
    device.destroy();
  }
}

/**
 * Модель на JS — когда WebGPU нет.
 *
 * ⚠️ Она **не исполняет шейдер** и не притворяется, что исполняет: результат считает эталон,
 * а модель показывает только то, что от GPU не зависит, — сколько байт, сколько групп
 * и вызовов, в каком порядке идут этапы. Гонку без атомиков и проверку привязок она
 * не воспроизводит: это делает только настоящий драйвер. Так и подписано в каждом этапе.
 */
export function runModel(preset: GpuPreset, why: Absence, report: Report): RunResult {
  const { stages, set } = stepper(report);
  const inputs = makeInputs(preset.n);
  const reference = compileReference(preset.reference)(inputs, preset.bins);

  set('device', 'warn', absenceNote(why));
  const bytes = preset.bindings.reduce((s, b) => s + bindingLength(b, preset) * 4, 0);
  set('buffers', 'warn', `модель: ${preset.bindings.length} типизированных массива, всего ${kb(bytes)} — в памяти страницы, не видеокарты`);
  set(
    'pipeline',
    'warn',
    preset.expect === 'error'
      ? 'модель: шейдер не компилируется — нечем. Ошибку привязки здесь поймал бы драйвер, модель её не повторяет'
      : 'модель: шейдер не компилируется — нечем; дальше считает эталон на JS',
  );
  const groups = workgroupCount(preset.n, preset.workgroupSize);
  set(
    'encode',
    'warn',
    `модель: рабочих групп ${num(groups)} по ${preset.workgroupSize}, всего вызовов: ${num(groups * preset.workgroupSize)} — столько запросил бы \`dispatchWorkgroups\``,
  );
  set('submit', 'warn', 'модель: очереди нет, эталон исполняется сразу и синхронно');
  set('map', 'warn', 'модель: читать нечего — результат уже в памяти страницы');
  set(
    'check',
    'warn',
    preset.expect === 'mismatch'
      ? 'модель гонки не воспроизводит: однопоточный JS не теряет ни одного прибавления'
      : `эталон посчитал ${reference.length.toLocaleString('ru-RU')} элементов; сверять не с чем`,
  );
  const cmp = compare(reference, reference);
  return { mode: 'model', stages, mismatches: null, total: reference.length, sample: cmp.sample, sum: cmp.sum, sumExpected: cmp.sumExpected, absence: why };
}

/** Есть ли WebGPU: имя, защищённый контекст. Адаптер проверяет уже `runOnGpu`. */
export function detect(): Absence | null {
  if (typeof navigator === 'undefined') return 'no-api';
  if (!('gpu' in navigator) || !navigator.gpu) {
    return typeof isSecureContext !== 'undefined' && !isSecureContext ? 'insecure' : 'no-api';
  }
  return null;
}
