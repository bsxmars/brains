import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADD_HOST_CODE,
  ADD_REFERENCE,
  ADD_WGSL,
  GPU_PRESETS,
  HISTOGRAM_REFERENCE,
  HISTOGRAM_WGSL,
  PITFALLS,
  PREREQ,
  RACE_WGSL,
  RELATED,
} from '@/content/render/webgpu/data';
import { compare, compileReference, makeInputs, mulberry32, workgroupCount } from '@/widgets/gpu-compute/model/input';
import { runModel } from '@/widgets/gpu-compute/model/run';
import { constOf, layoutTypeOf, parseBindings, workgroupSizeOf } from '@/widgets/gpu-compute/model/wgsl';

/**
 * Тема «WebGPU: другая модель работы с видеокартой» — то, что проверяемо без видеокарты.
 *
 * В процессе `vitest` WebGPU нет (`navigator.gpu` в Node отсутствует), поэтому шейдеры здесь
 * не исполняются — их исполнил браузерный скрипт темы в четырёх конфигурациях (см. шапку
 * `data.ts`). Здесь закрепляется другое, и именно то, что ломается молча:
 *
 *   — эталон на JS, с которым демо сверяет GPU, считает верно — исполняется **строка из данных**;
 *   — раскладка привязок, по которой демо строит `GPUBindGroupLayout`, совпадает с `@binding`
 *     в тексте шейдера. Расхождение здесь — это ошибка проверки у читателя в консоли, а в
 *     Firefox, где часть проверок мягче, — возможно, и её отсутствие;
 *   — то же для хост-кода, напечатанного в теме: его раскладка сверяется с его шейдером;
 *   — числа в тексте, которые можно пересчитать, пересчитаны.
 */

const U32 = 2 ** 32;

describe('эталон на JS — исполняется строка из данных', () => {
  it('сложение переполняется так же, как u32 в WGSL', () => {
    const add = compileReference(ADD_REFERENCE);
    const a = new Uint32Array([1, 0xffffffff, 0x80000000, 7]);
    const b = new Uint32Array([2, 1, 0x80000000, 0xfffffffe]);
    const sum = add({ a, b, values: new Uint32Array(0) });

    expect(sum).toBeInstanceOf(Uint32Array);
    // 0xFFFFFFFF + 1 → 0 — ровно то, что GPU вернул в прогоне темы («Тонкие места»).
    expect([...sum]).toEqual([3, 0, 0, (7 + 0xfffffffe) % U32]);
  });

  it('гистограмма раскладывает значения по остатку и ничего не теряет', () => {
    const hist = compileReference(HISTOGRAM_REFERENCE);
    const values = new Uint32Array([0, 1, 16, 17, 33, 15, 31, 0xffffffff]);
    const out = hist({ a: new Uint32Array(0), b: new Uint32Array(0), values }, 16);

    expect(out).toHaveLength(16);
    expect(out[0]).toBe(2); // 0, 16
    expect(out[1]).toBe(3); // 1, 17, 33
    expect(out[15]).toBe(3); // 15, 31, 0xFFFFFFFF
    expect(out.reduce((s, v) => s + v, 0)).toBe(values.length);
  });

  it('на входе демо эталон совпадает с независимым пересчётом', () => {
    for (const preset of GPU_PRESETS) {
      const inputs = makeInputs(preset.n);
      const got = compileReference(preset.reference)(inputs, preset.bins);

      const want =
        preset.bins === undefined
          ? inputs.a.map((x, i) => (x + inputs.b[i]) % U32)
          : (() => {
              const w = new Uint32Array(preset.bins);
              inputs.values.forEach((v) => (w[v % preset.bins!] += 1));
              return w;
            })();

      expect(compare(got, want).mismatches, preset.key).toBe(0);
    }
  });
});

describe('входы демо', () => {
  it('детерминированы: эталон и GPU получают одно и то же', () => {
    expect(makeInputs(8).values).toEqual(makeInputs(8).values);
    const next = mulberry32(1);
    expect(next()).not.toBe(next());
  });

  /**
   * ⚠️ Первая версия генератора (линейный конгруэнтный по модулю 2³²) раскладывала 65 536 значений
   * ровно по 4096 в корзину: младшие биты ЛКГ периодичны. На такой гистограмме сверка «проходит»,
   * даже если шейдер заполняет корзины по кругу, а не по данным. Сторож — неравномерность.
   */
  it('гистограмма входа не вырождена в ровные корзины', () => {
    const preset = GPU_PRESETS.find((p) => p.key === 'histogram')!;
    const out = compileReference(preset.reference)(makeInputs(preset.n), preset.bins);
    expect(new Set(out).size).toBeGreaterThan(1);
  });
});

describe('раскладка в JS совпадает с @binding в шейдере', () => {
  it.each(GPU_PRESETS.map((p) => [p.key, p] as const))('%s', (_key, preset) => {
    const declared = parseBindings(preset.wgsl);

    expect(declared.length, 'в шейдере не нашлось ни одной привязки — разбор сломан или форма другая').toBeGreaterThan(0);
    expect(declared.every((d) => d.group === 0), 'демо создаёт только группу 0').toBe(true);

    const fromShader = declared.map((d) => ({ binding: d.binding, type: layoutTypeOf(d), name: d.name }));
    const fromLayout = preset.bindings.map((b) => ({ binding: b.binding, type: b.type, name: b.name }));
    expect(fromLayout).toEqual(fromShader);

    // Из буфера, который читается обратно, шейдер обязан писать.
    const out = preset.bindings.filter((b) => b.out);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('storage');
  });

  it.each(GPU_PRESETS.map((p) => [p.key, p] as const))('%s: размер группы и число корзин — одни и те же', (_key, preset) => {
    expect(workgroupSizeOf(preset.wgsl)).toBe(preset.workgroupSize);
    if (preset.bins !== undefined) expect(constOf(preset.wgsl, 'BINS')).toBe(preset.bins);
  });

  it('хост-код темы: раскладка, группа и dispatch сходятся с его шейдером', () => {
    const layout = [
      ...ADD_HOST_CODE.matchAll(/\{\s*binding:\s*(\d+),\s*visibility:\s*GPUShaderStage\.COMPUTE,\s*buffer:\s*\{\s*type:\s*'([a-z-]+)'\s*\}\s*\}/g),
    ].map((m) => ({ binding: Number(m[1]), type: m[2] }));
    const group = [...ADD_HOST_CODE.matchAll(/\{\s*binding:\s*(\d+),\s*resource:/g)].map((m) => Number(m[1]));
    const shader = parseBindings(ADD_WGSL).map((d) => ({ binding: d.binding, type: layoutTypeOf(d) }));

    expect(layout.length, 'в хост-коде не нашлось записей раскладки — сменилась форма кода').toBeGreaterThan(0);
    expect(layout).toEqual(shader);
    expect(group).toEqual(shader.map((s) => s.binding));

    const dispatch = ADD_HOST_CODE.match(/dispatchWorkgroups\(Math\.ceil\(a\.length \/ (\d+)\)\)/);
    expect(dispatch, 'в хост-коде нет dispatchWorkgroups(Math.ceil(… / N))').not.toBeNull();
    expect(Number(dispatch![1])).toBe(workgroupSizeOf(ADD_WGSL));
  });

  it('хост-код читает через промежуточный буфер: MAP_READ только с COPY_DST', () => {
    const mapped = [...ADD_HOST_CODE.matchAll(/usage:\s*([^}]*MAP_READ[^}]*)\}/g)].map((m) => m[1].trim());
    expect(mapped).toEqual(['U.MAP_READ | U.COPY_DST']);
  });
});

describe('шейдеры держат то, что обещает текст', () => {
  it('лишние вызовы отсекаются: групп с запасом — проверка границы есть', () => {
    for (const preset of GPU_PRESETS) {
      const invocations = workgroupCount(preset.n, preset.workgroupSize) * preset.workgroupSize;
      expect(invocations).toBeGreaterThanOrEqual(preset.n);
      if (invocations > preset.n) expect(preset.wgsl, preset.key).toMatch(/arrayLength\(/);
    }
  });

  /**
   * «Тонкие места», барьер: Chromium и WebKit не соберут барьер после раннего `return`,
   * а Firefox 155 соберёт молча. Значит, в Firefox такой шейдер пройдёт, у остальных — нет,
   * и единственный переносимый сторож — здесь.
   */
  it('в гистограмме нет return до workgroupBarrier', () => {
    const beforeBarrier = HISTOGRAM_WGSL.slice(0, HISTOGRAM_WGSL.indexOf('workgroupBarrier'));
    expect(HISTOGRAM_WGSL).toContain('workgroupBarrier()');
    expect(beforeBarrier).not.toMatch(/\breturn\b/);
  });

  it('гистограмма атомарна, «гонка» — нет, и больше они ничем не отличаются по привязкам', () => {
    expect(HISTOGRAM_WGSL).toMatch(/atomicAdd\(&bins/);
    expect(RACE_WGSL).not.toMatch(/atomic/);
    const race = GPU_PRESETS.find((p) => p.key === 'race')!;
    const hist = GPU_PRESETS.find((p) => p.key === 'histogram')!;
    expect(race.reference).toBe(hist.reference);
    expect(race.expect).toBe('mismatch');
  });

  it('«забыт флаг STORAGE» — ровно одна ошибка, всё прочее как у сложения', () => {
    const broken = GPU_PRESETS.find((p) => p.key === 'broken')!;
    const add = GPU_PRESETS.find((p) => p.key === 'add')!;
    expect(broken.wgsl).toBe(add.wgsl);
    expect(broken.bindings.filter((b) => b.forgetStorage)).toHaveLength(1);
    expect(broken.bindings.map(({ forgetStorage: _f, ...rest }) => rest)).toEqual(add.bindings);
  });
});

describe('модель на JS не выдаёт себя за GPU', () => {
  it.each(GPU_PRESETS.map((p) => [p.key, p] as const))('%s', (_key, preset) => {
    const result = runModel(preset, 'no-adapter', () => {});
    expect(result.mode).toBe('model');
    // Сравнивать ей не с чем: «совпало» здесь было бы враньём.
    expect(result.mismatches).toBeNull();
    expect(result.stages.every((s) => s.state === 'warn')).toBe(true);
    expect(result.stages.slice(1, 6).every((s) => s.detail.startsWith('модель'))).toBe(true);
  });
});

describe('числа в тексте пересчитываются', () => {
  it('0.1 + 0.2 в f32 — ровно то число, что в «Тонких местах»', () => {
    const f32 = Math.fround(Math.fround(0.1) + Math.fround(0.2));
    const pitfall = PITFALLS.find((p) => p.t.includes('`f32`'))!;
    expect(pitfall.d).toContain(String(f32));
    expect(pitfall.d).toContain(String(0.1 + 0.2));
    expect(f32).toBe(0.30000001192092896);
  });

  it('1000 элементов при группе 64 — 16 групп и 24 лишних вызова', () => {
    expect(workgroupCount(1000, 64)).toBe(16);
    expect(16 * 64 - 1000).toBe(24);
  });
});

describe('ссылки темы ведут в существующие разделы', () => {
  const COLLECTION: Record<string, string> = { render: 'render', frameworks: 'frameworks', js: 'lessons', platform: 'platform', tooling: 'tooling', delivery: 'delivery', algorithms: 'algorithms', data: 'data', patterns: 'patterns' };

  const links = [
    ...PREREQ.map((p) => p.href),
    ...[...RELATED.matchAll(/\]\((\/[^)]+)\)/g)].map((m) => m[1]),
  ];

  it.each(links)('%s', (href) => {
    const m = href.match(/^\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?$/);
    expect(m, `адрес не похож на адрес темы: ${href}`).not.toBeNull();
    const [, direction, slug, anchor] = m!;
    const file = new URL(`../../src/content/${COLLECTION[direction]}/${slug}/index.mdx`, import.meta.url);
    expect(existsSync(file), `нет темы ${direction}/${slug}`).toBe(true);
    if (anchor) expect(readFileSync(file, 'utf8')).toMatch(new RegExp(`id="${anchor}"`));
  });
});
