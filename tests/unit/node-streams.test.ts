import { execFileSync } from 'node:child_process';
import * as stream from 'node:stream';
import * as streamPromises from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  CHAIN_OF_FIVE,
  CORK_CODE,
  CORK_OUT,
  DEMO_CHECKS,
  DEMO_DEFAULTS,
  DEMO_OPTIONS,
  DESTROY_CODE,
  DESTROY_OUT,
  DUPLEX_CODE,
  DUPLEX_OUT,
  EVENTS_CODE,
  EVENTS_OUT,
  FROM_CODE,
  FROM_OUT,
  MODES_CODE,
  MODES_OUT,
  NS_MODEL_CODE,
  NS_MODES,
  NS_SCENARIO_CODE,
  OWN_FIELDS,
  SAMPLE_CODE,
  SAMPLE_OUT,
  SIZE_CODE,
  SIZE_OUT,
  STATE_CODE,
  STATE_ROWS,
  WSTATE_CODE,
  WSTATE_ROWS,
} from '@/content/platform/node-streams/data';
import { loadScenario, simulate, trimFrames } from '@/widgets/ns-tick-lab/model/run';
import type { NsFrame, NsMode, NsParams } from '@/widgets/ns-tick-lab/model/types';

/**
 * «`node:stream` изнутри»: всё, что тема утверждает, спрашивается у Node 26 тем же кодом,
 * что напечатан в теме.
 *
 * Главная часть — сверка модели демо с настоящим `node:stream`. Сценарий `NS_SCENARIO_CODE`
 * не знает, чьи у него классы: здесь он идёт дважды — на модели (`NS_MODEL_CODE`, ровно так,
 * как её собирает демо) и на `node:stream` — и каждый кадр обязан совпасть целиком: журнал
 * по порядку, буфер, `readableLength`, `readableFlowing`, `reading`, очередь записи. Сочетания —
 * **все**, что читатель может выставить переключателями (`DEMO_OPTIONS`), плюс пустой
 * и одночанковый источник, где у Node свои короткие пути.
 *
 * «Тик» здесь — `setImmediate`: доиграли очередь `nextTick` и микрозадачи. Таймеров и замеров
 * времени нет, поэтому проверка не мигает под нагрузкой.
 */

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const host = { macrotask: settle };
const realStreams = { Readable: stream.Readable, Writable: stream.Writable, settle };
const runScenario = loadScenario(NS_SCENARIO_CODE);

const MODES: NsMode[] = ['data', 'readable', 'iterator', 'pipe'];

function cases(): NsParams[] {
  const out: NsParams[] = [];
  for (const mode of MODES)
    for (const hwm of DEMO_OPTIONS.hwm)
      for (const delay of DEMO_OPTIONS.delay)
        for (const whwm of mode === 'pipe' ? DEMO_OPTIONS.whwm : [DEMO_DEFAULTS.whwm])
          for (const n of [0, 1, DEMO_DEFAULTS.n])
            out.push({ ...DEMO_DEFAULTS, mode, hwm, delay, whwm, n });
  return out;
}

describe('модель демо ведёт себя как node:stream — кадр в кадр', () => {
  it('переключатели демо дают все четыре режима, и режим for await — настоящий for await', () => {
    expect(NS_MODES.map((m) => m.value)).toEqual(MODES);
    // Подпись демо обещает, что итератор — не имитация: на node:stream его обслуживает Node.
    expect(NS_SCENARIO_CODE).toContain('for await (const c of rs)');
  });

  it.each(cases().map((p) => [`${p.mode} hwm=${p.hwm} delay=${p.delay} whwm=${p.whwm} n=${p.n}`, p] as const))(
    '%s',
    async (_name, params) => {
      const real = await runScenario(realStreams, params);
      const model = await simulate(NS_MODEL_CODE, NS_SCENARIO_CODE, params, host);
      expect(model).toEqual(real);
      // Сценарий успевает доиграть до конца: иначе демо обрезало бы историю на середине.
      expect(trimFrames(real).length, 'тиков не хватило, чтобы стрим дошёл до конца').toBeLessThan(real.length);
    },
  );
});

/** Подписи режимов говорят не только о значениях по умолчанию — здесь то, что верно на любых. */
describe('подписи режимов верны на всех сочетаниях переключателей', () => {
  it.each(cases().map((p) => [`${p.mode} hwm=${p.hwm} delay=${p.delay} whwm=${p.whwm} n=${p.n}`, p] as const))(
    '%s',
    async (_name, params) => {
      const frames = await runScenario(realStreams, params);
      if (params.mode === 'data') {
        // «Буфер стрима пуст всё время, readableFlowing — true».
        expect(frames.slice(1).every((f) => f.length === 0 && f.flowing === true)).toBe(true);
      }
      if (params.mode === 'iterator' || params.mode === 'pipe') {
        // Обратное давление: у потребителя вне стрима ничего не копится.
        expect(frames.every((f) => f.backlog.length === 0)).toBe(true);
      }
      if (params.mode === 'iterator') {
        // «Буфер заполняется до порога и встаёт»: выше порога не поднимается.
        expect(Math.max(...frames.map((f) => f.length))).toBeLessThanOrEqual(params.hwm);
      }
    },
  );

  it("pipe: бывает 'pause' и сразу 'resume', а readableFlowing остаётся false", async () => {
    const frames = await runScenario(realStreams, { ...DEMO_DEFAULTS, mode: 'pipe' });
    const hit = frames.find((f) => {
      const p = f.log.findIndex((l) => l.startsWith("rs 'pause'"));
      return p >= 0 && f.log.slice(p + 1).some((l) => l.startsWith("rs 'resume'")) && f.flowing === false;
    });
    expect(hit, "кадра с 'pause' → 'resume' при flowing false нет").toBeDefined();
  });
});

describe('числа из подписей демо сняты с node:stream', () => {
  const measure = (frames: NsFrame[], params: NsParams) => {
    const withLog = frames.filter((f) => f.log.length);
    return {
      maxBacklog: Math.max(...frames.map((f) => f.backlog.length)),
      maxLength: Math.max(...frames.map((f) => f.length)),
      maxWLength: Math.max(...frames.map((f) => f.wlength ?? 0)),
      endTick: frames.find((f) => f.log.some((l) => l.startsWith("rs 'end'")))?.t ?? -1,
      lastTick: withLog[withLog.length - 1].t,
      needDrainBelowHwm: frames.some(
        (f) => f.needDrain === true && (f.wlength ?? 0) > 0 && (f.wlength ?? 0) < params.whwm,
      ),
    };
  };

  it.each(MODES)('%s', async (mode) => {
    const params = { ...DEMO_DEFAULTS, mode };
    const frames = await runScenario(realStreams, params);
    expect(measure(frames, params)).toEqual(DEMO_CHECKS[mode]);
  });

  it('обратное давление видно в числах: for await и pipe держат буфер у порога, data и readable — нет', () => {
    expect(DEMO_CHECKS.iterator.maxLength).toBe(DEMO_DEFAULTS.hwm);
    expect(DEMO_CHECKS.iterator.maxBacklog).toBe(0);
    expect(DEMO_CHECKS.data.maxBacklog).toBeGreaterThan(0);
    // 'end' в режиме data приходит раньше, чем потребитель доделал работу, — тонкое место 02.
    expect(DEMO_CHECKS.data.endTick).toBeLessThan(DEMO_CHECKS.data.lastTick);
    expect(DEMO_CHECKS.iterator.endTick).toBeGreaterThan(DEMO_CHECKS.data.endTick);
    // 'drain' ждёт пустой очереди, а не «ниже порога» — WSTATE_NOTE ссылается на это.
    expect(DEMO_CHECKS.pipe.needDrainBelowHwm).toBe(true);
  });
});

/**
 * Примеры темы исполняются как есть — те самые строки из `data.ts`. Строки `import`
 * срезаются, имена из `node:stream` и `node:stream/promises` подставляются параметрами,
 * `console.log` собирается и сравнивается с выводом, напечатанным в теме.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

async function runSnippet(code: string): Promise<unknown[][]> {
  const logs: unknown[][] = [];
  const body = code
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n');
  const scope: Record<string, unknown> = { ...stream, ...streamPromises };
  const names = Object.keys(scope).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'default');
  const fn = new AsyncFunction(...names, 'console', body);
  await fn(...names.map((n) => scope[n]), { log: (...args: unknown[]) => logs.push(args) });
  return logs;
}

const asLine = (args: unknown[]) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
const asRow = (args: unknown[]) => {
  if (args.length === 1) return { step: args[0] };
  const [step, result, state] = args;
  return { step, result: typeof result === 'boolean' ? String(result) : '', ...(state as object) };
};

describe('примеры темы печатают то, что напечатано в теме', () => {
  it.each([
    ['сквозной пример', SAMPLE_CODE, SAMPLE_OUT],
    ['режимы и _read без push', MODES_CODE, MODES_OUT],
    ['objectMode и размер', SIZE_CODE, SIZE_OUT],
    ['end, autoDestroy, emitClose', EVENTS_CODE, EVENTS_OUT],
    ['Duplex и PassThrough', DUPLEX_CODE, DUPLEX_OUT],
    ['destroy, finished, addAbortSignal', DESTROY_CODE, DESTROY_OUT],
    ['Readable.from, pipeline, compose', FROM_CODE, FROM_OUT],
    ['cork и _writev', CORK_CODE, CORK_OUT],
  ] as const)('%s', async (_name, code, out) => {
    const logs = await runSnippet(code);
    expect(logs.map(asLine)).toEqual(out);
  });

  it('таблица состояния Readable', async () => {
    expect((await runSnippet(STATE_CODE)).map(asRow)).toEqual(STATE_ROWS);
  });

  it('таблица состояния Writable', async () => {
    expect((await runSnippet(WSTATE_CODE)).map(asRow)).toEqual(WSTATE_ROWS);
  });
});

describe('утверждения темы без отдельного примера', () => {
  it('собственных полей у _readableState шесть — остальное геттеры над битовым полем', () => {
    // Внутреннее поле: в типах @types/node его нет, а в рантайме оно есть — это и проверяется.
    const rs = new stream.Readable({ read() {} }) as unknown as { _readableState: object };
    const state = rs._readableState;
    expect(Object.keys(state)).toEqual(OWN_FIELDS);
    const proto = Object.getPrototypeOf(state);
    for (const flag of ['flowing', 'ended', 'reading', 'destroyed', 'endEmitted'])
      expect(typeof Object.getOwnPropertyDescriptor(proto, flag)?.get, flag).toBe('function');
  });

  it('_read не зовут, пока _construct не вызвал свой колбэк', async () => {
    const log: string[] = [];
    let open = () => {};
    const rs = new stream.Readable({
      construct(done) {
        log.push('construct');
        open = () => done();
      },
      read() {
        log.push('_read');
        this.push(null);
      },
    });
    rs.on('data', () => {});
    await settle();
    await settle();
    log.push('открыли');
    open();
    await settle();
    expect(log).toEqual(['construct', 'открыли', '_read']);
  });

  it("'finish' не приходит, если стрим разрушили до конца записи — только 'close'", async () => {
    const log: string[] = [];
    const ws = new stream.Writable({ write() {} }); // колбэк записи не зовётся никогда
    for (const ev of ['finish', 'close', 'error']) ws.on(ev, () => log.push(ev));
    ws.write('a');
    ws.end();
    ws.destroy();
    for (let i = 0; i < 5; i++) await settle();
    expect(log).toEqual(['close']);
  });

  it("'data' не ждёт асинхронного обработчика: все чанки в работе одновременно", async () => {
    let inFlight = 0;
    let peak = 0;
    const pending: (() => void)[] = [];
    const rs = stream.Readable.from([1, 2, 3, 4, 5]);
    rs.on('data', async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => pending.push(resolve));
      inFlight--;
    });
    for (let i = 0; i < 10; i++) await settle();
    expect(peak).toBe(5);
    pending.forEach((resolve) => resolve());
  });

  it(`пять PassThrough через pipe без читателя принимают ${CHAIN_OF_FIVE} объектов`, async () => {
    const chain = Array.from({ length: 5 }, () => new stream.PassThrough({ objectMode: true }));
    for (let i = 0; i < 4; i++) chain[i].pipe(chain[i + 1]);
    let written = 0;
    let drained = true;
    chain[0].on('drain', () => (drained = true));
    while (drained) {
      drained = false;
      while (chain[0].write(++written));
      for (let i = 0; i < 10; i++) await settle();
    }
    expect(written).toBe(CHAIN_OF_FIVE);
  });

  it("'error' без слушателя роняет процесс — push не того типа не бросает, а разрушает стрим", () => {
    const code = [
      "const { Readable } = require('node:stream')",
      'const rs = new Readable({ read() {} })',
      "console.log('push вернул', rs.push(42))",
    ].join('\n');
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      ({ status, stdout, stderr } = err);
    }
    expect(stdout).toContain('push вернул false');
    expect(status).toBe(1);
    expect(stderr).toContain('ERR_INVALID_ARG_TYPE');
  });
});
