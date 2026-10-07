import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/algorithms/schedulers/data';
import { loadHeap, loadMiniScheduler, loadRunner, toSlices, traceHeap } from '@/widgets/sched-lab/model/run';
import type { HeapNode, Job, LogEntry } from '@/widgets/sched-lab/model/types';

/**
 * Тема «Планировщики: очередь с приоритетом и нарезка времени».
 *
 * Строки темы (`HEAP_CODE`, `SORTED_CODE`, `LESS_NO_ID_CODE`, `SCHED_CODE`, `HOST_CODE`,
 * `JOB_CODE`, `SCENARIO_CODE`) напечатаны на странице и исполняются демо. Здесь:
 *   — куча сверяется с сортировкой на случайных операциях и с кучей из исходника `scheduler`
 *     (функции вырезаны из `unstable_mock` текстом — наружу пакет их не отдаёт);
 *   — мини-планировщик и **настоящий** `scheduler` 0.28 (`scheduler.production.js` в `vm`, где
 *     часы и макрозадачи — хост темы) прогоняются одним `SCENARIO_CODE`, журналы — дословно;
 *   — `scheduler/unstable_mock` — второй оракул порядка задач;
 *   — все числа из текста пересчитываются.
 */

const require = createRequire(import.meta.url);
const pkgDir = require.resolve('scheduler/package.json').replace(/package\.json$/, '');
const PKG = JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8')) as { version: string };
const PROD = readFileSync(`${pkgDir}cjs/scheduler.production.js`, 'utf8');
const MOCK = readFileSync(`${pkgDir}cjs/scheduler-unstable_mock.production.js`, 'utf8');

interface Host {
  now(): number;
  postTask(fn: () => void): void;
  setTimer(fn: () => void, ms: number): number;
  clearTimer(id: number): void;
}

type SchedulerModule = Record<string, (...args: never[]) => unknown> & { unstable_now(): number };

function loadProd(globals: Record<string, unknown>): SchedulerModule {
  const exports = {};
  const ctx = vm.createContext({ exports, process: { env: { NODE_ENV: 'production' } }, ...globals });
  vm.runInContext(PROD, ctx);
  return ctx.exports as SchedulerModule;
}

/** Настоящий планировщик поверх хоста темы — с тем же интерфейсом, что у `createScheduler`. */
function realScheduler(host: Host) {
  const S = loadProd({
    performance: { now: () => host.now() },
    setImmediate: (fn: () => void) => host.postTask(fn),
    setTimeout: (fn: () => void, ms: number) => host.setTimer(fn, ms),
    clearTimeout: (id: number) => host.clearTimer(id),
  }) as unknown as {
    unstable_scheduleCallback(p: number, cb: unknown, o?: { delay: number }): { startTime: number; expirationTime: number };
    unstable_cancelCallback(task: unknown): void;
    unstable_shouldYield(): boolean;
  };
  return {
    scheduleCallback: (p: number, cb: unknown, delay = 0) =>
      S.unstable_scheduleCallback(p, cb, delay > 0 ? { delay } : undefined),
    cancelCallback: (task: unknown) => S.unstable_cancelCallback(task),
    shouldYield: () => S.unstable_shouldYield(),
    now: () => host.now(),
  };
}

const heapApi = () => loadHeap(t.HEAP_CODE, t.SORTED_CODE);
const miniCreate = loadMiniScheduler(t.HEAP_CODE, t.SCHED_CODE);
const runMini = loadRunner(t.HOST_CODE, t.JOB_CODE, t.SCENARIO_CODE, miniCreate);
const runReal = loadRunner(t.HOST_CODE, t.JOB_CODE, t.SCENARIO_CODE, realScheduler);

const fmt = (log: LogEntry[]) =>
  toSlices(log).map((e) => `#${e.slice} t=${e.t} ${e.name}${e.part}${e.didTimeout ? '!' : ''}`);

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const scenario = (id: string) => t.SCHED_SCENARIOS.find((s) => s.id === id)!;
const withPriority = (jobs: Job[], name: string, priority: Job['priority']) =>
  jobs.map((j) => (j.name === name ? { ...j, priority } : j));

describe('стенд', () => {
  it('scheduler из node_modules — 0.28.0', () => {
    expect(PKG.version).toBe('0.28.0');
  });
});

describe('куча темы', () => {
  it('выдаёт то же, что сортировка, на случайных операциях', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed);
      const h = heapApi();
      const heap: HeapNode[] = [];
      const model: HeapNode[] = [];
      let id = 1;
      for (let i = 0; i < 400; i++) {
        if (r() < 0.6 || heap.length === 0) {
          const node = { id: id++, sortIndex: Math.floor(r() * 30) - 5 };
          h.push(heap, node);
          model.push(node);
        } else {
          model.sort((a, b) => a.sortIndex - b.sortIndex || a.id - b.id);
          expect(h.peek(heap)).toBe(model[0]);
          expect(h.pop(heap)).toBe(model.shift());
        }
        // свойство кучи: родитель не срочнее ребёнка не бывает
        for (let k = 1; k < heap.length; k++) expect(h.less(heap[k], heap[(k - 1) >> 1])).toBe(false);
      }
    }
  });

  it('раскладывает массив так же, как куча из исходника scheduler', () => {
    const start = MOCK.indexOf('function push(');
    const end = MOCK.indexOf('function advanceTimers(');
    expect(start).toBeGreaterThan(-1);
    const react = new Function(`${MOCK.slice(start, end)}\nreturn { push, pop };`)() as {
      push(h: HeapNode[], n: HeapNode): void;
      pop(h: HeapNode[]): HeapNode;
    };
    const h = heapApi();
    const r = rng(7);
    const mine: HeapNode[] = [];
    const theirs: HeapNode[] = [];
    let id = 1;
    for (let i = 0; i < 20000; i++) {
      if (r() < 0.6 || mine.length === 0) {
        const key = Math.floor(r() * 50);
        h.push(mine, { id, sortIndex: key });
        react.push(theirs, { id, sortIndex: key });
        id++;
      } else {
        expect(h.pop(mine)!.id).toBe(react.pop(theirs).id);
      }
      expect(mine.map((n) => n.id)).toEqual(theirs.map((n) => n.id));
    }
  });

  it('COST_ROWS: счётчики пересобираются', () => {
    for (const row of t.COST_ROWS) {
      const heap = heapApi();
      const sorted = heapApi();
      const r = rng(1);
      const h: HeapNode[] = [];
      const s: HeapNode[] = [];
      for (let i = 0; i < row.n; i++) {
        const key = row.keys === 'случайные' ? Math.floor(r() * 10000) : 5000 + i;
        heap.push(h, { id: i + 1, sortIndex: key });
        sorted.insertSorted(s, { id: i + 1, sortIndex: key });
      }
      const afterPush = heap.stats.moves;
      for (let i = 0; i < row.n; i++) heap.pop(h);
      expect({ heapPush: afterPush, heapPop: heap.stats.moves - afterPush, sorted: sorted.stats.moves }).toEqual({
        heapPush: row.heapPush,
        heapPop: row.heapPop,
        sorted: row.sorted,
      });
    }
    // «ровно n·(n−1)/2» и «около 10,7 перемещения на изъятие»
    const growing = t.COST_ROWS.find((r) => r.keys === 'растущие' && r.n === 10000)!;
    expect(growing.sorted).toBe((10000 * 9999) / 2);
    expect(t.COST_NOTE).toContain('49 995 000');
    expect((growing.heapPop / 10000).toFixed(1)).toBe('10.7');
  });

  it('PUSH_STEPS и пример из демо: массив после каждого шага', () => {
    const steps = traceHeap(heapApi, t.HEAP_SCENARIOS.find((s) => s.id === 'five')!.ops);
    const arr = (i: number) => `\`[${steps[i].after.map((n) => `${n.name}:${n.sortIndex}`).join(', ')}]\``;
    t.PUSH_STEPS.forEach((step, i) => expect(arr(i), step.op).toBe(step.arr));
    expect(steps[5].popped!.name).toBe('D');
  });

  it('без счётчика равные ключи теряют порядок постановки (NO_ID_ORDERS)', () => {
    for (const { n, order } of t.NO_ID_ORDERS) {
      const h = loadHeap(t.HEAP_CODE, t.SORTED_CODE, t.LESS_NO_ID_CODE);
      const heap: HeapNode[] = [];
      for (let i = 1; i <= n; i++) h.push(heap, { id: i, sortIndex: 5000 });
      const out: number[] = [];
      while (heap.length) out.push(h.pop(heap)!.id);
      expect(out.join(' ')).toBe(order);
    }
    // а со счётчиком — по порядку
    const ties = traceHeap(heapApi, t.HEAP_SCENARIOS.find((s) => s.id === 'ties')!.ops);
    expect(ties.filter((s) => s.popped).map((s) => s.popped!.name).join('')).toBe('ABCDE');
    const noId = traceHeap(
      () => loadHeap(t.HEAP_CODE, t.SORTED_CODE, t.LESS_NO_ID_CODE),
      t.HEAP_SCENARIOS.find((s) => s.id === 'ties-no-id')!.ops,
    );
    expect(noId.filter((s) => s.popped).map((s) => s.popped!.name).join('')).toBe('AEDCB');
  });
});

describe('мини-планировщик против настоящего scheduler 0.28', () => {
  it('сроки приоритетов (PRIORITY_ROWS) — как у пакета', () => {
    const host = { now: () => 0, postTask() {}, setTimer: () => 1, clearTimer() {} };
    const real = realScheduler(host);
    for (const row of t.PRIORITY_ROWS) {
      const task = real.scheduleCallback(row.n, () => null);
      expect(task.expirationTime - task.startTime, row.name).toBe(row.timeout);
    }
    expect(t.SCHED_CODE).toContain('const TIMEOUT = { 1: -1, 2: 250, 3: 5000, 4: 10000, 5: 1073741823 };');
    expect(2 ** 30 - 1).toBe(1073741823);
    expect((1073741823 / 86_400_000).toFixed(1)).toBe('12.4');
  });

  it('на сценариях темы журналы совпадают дословно', () => {
    for (const s of t.SCHED_SCENARIOS) {
      const variants: Job['priority'][] = s.pickPriorityOf ? [1, 2, 3, 4, 5] : [3];
      for (const p of variants) {
        const jobs = s.pickPriorityOf ? withPriority(s.jobs, s.pickPriorityOf, p) : s.jobs;
        expect(fmt(runMini(jobs)), `${s.id} ${p}`).toEqual(fmt(runReal(jobs)));
      }
    }
  });

  it('на 200 случайных сценариях журналы совпадают дословно', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 31);
      const jobs: Job[] = Array.from({ length: 2 + Math.floor(r() * 9) }, (_, i) => ({
        name: `J${i}_`,
        priority: (1 + Math.floor(r() * 5)) as Job['priority'],
        at: r() < 0.5 ? 0 : Math.floor(r() * 40),
        delay: r() < 0.3 ? Math.floor(r() * 30) : 0,
        units: Array.from({ length: 1 + Math.floor(r() * 6) }, () => Math.floor(r() * 4) + (r() < 0.1 ? 300 : 0)),
      }));
      expect(fmt(runMini(jobs)), `seed ${seed}`).toEqual(fmt(runReal(jobs)));
    }
  });

  it('ORDER_LOG, SLICE_LOGS — как в тексте', () => {
    expect(fmt(runReal(scenario('order').jobs))).toEqual(t.ORDER_LOG);
    const slice = scenario('slice').jobs;
    expect(fmt(runReal(withPriority(slice, 'C', 2)))).toEqual(t.SLICE_LOGS.userBlocking);
    expect(fmt(runReal(withPriority(slice, 'C', 3)))).toEqual(t.SLICE_LOGS.normal);
  });

  it('продолжение: квант на 5 мс, продолжается A, клик UserBlocking влезает перед ним', () => {
    const log = fmt(runReal(scenario('continue').jobs));
    expect(log.slice(0, 7)).toEqual(['#1 t=0 A0', '#1 t=1 A1', '#1 t=2 A2', '#1 t=3 A3', '#1 t=4 A4', '#2 t=5 C0', '#2 t=6 A5']);
    expect(log.indexOf('#2 t=9 B0')).toBeGreaterThan(log.indexOf('#2 t=8 A7'));
  });

  it('просрочка: до 250 мс — квант на кусок, потом остаток одним квантом в 150 мс', () => {
    const log = toSlices(runReal(scenario('expired').jobs));
    const u = log.filter((e) => e.name === 'U');
    const firstLate = u.find((e) => e.didTimeout)!;
    expect(firstLate.t).toBe(250);
    expect(u.filter((e) => e.slice === firstLate.slice).length * 10).toBe(150);
    expect(u.filter((e) => !e.didTimeout).every((e, i) => e.slice === i + 1)).toBe(true);
    expect(log.at(-1)).toMatchObject({ name: 'N', t: 400 });
  });

  it('голодание: STARVE_FACTS — у мини и у настоящего', () => {
    for (const run of [runMini, runReal]) {
      const log = run(scenario('starve').jobs);
      const n = log.find((e) => e.name === 'N')!;
      expect({
        startedAt: n.t,
        clicksBefore: log.filter((e) => e.name === 'U' && e.t < n.t).length,
        didTimeout: n.didTimeout,
      }).toEqual(t.STARVE_FACTS);
    }
    expect(t.STARVE_NOTE).toContain(`${t.STARVE_FACTS.startedAt}-й`);
    expect(t.STARVE_NOTE).toContain(`${t.STARVE_FACTS.clicksBefore} кликов`);
  });

  it('после продолжения уступает всегда, даже через 0 мс работы', () => {
    for (const create of [miniCreate, realScheduler]) {
      const host = new Function(`${t.HOST_CODE}\nreturn createHost();`)() as Host & {
        run(): void;
        turn(): number;
      };
      const s = (create as (h: Host) => ReturnType<typeof realScheduler>)(host);
      const turns: number[] = [];
      let left = 3;
      const step = (): unknown => {
        turns.push(host.turn());
        return --left > 0 ? step : null;
      };
      s.scheduleCallback(3, step);
      s.scheduleCallback(3, () => turns.push(-host.turn()));
      host.run();
      expect(turns).toEqual([1, 2, 3, -3]);
    }
  });

  it('квант — 5 мс: уступка после пятого куска по 1 мс', () => {
    const jobs: Job[] = [{ name: 'A', priority: 3, units: Array.from({ length: 12 }, () => 1) }];
    const log = fmt(runReal(jobs));
    expect(log[4]).toBe('#1 t=4 A4');
    expect(log[5]).toBe('#2 t=5 A5');
    expect(log[10]).toBe('#3 t=10 A10');
  });

  it('хост: setImmediate, если он есть, иначе MessageChannel', () => {
    let immediates = 0;
    const a = loadProd({ performance: { now: () => 0 }, setImmediate: () => immediates++, setTimeout, clearTimeout });
    a.unstable_scheduleCallback(3 as never, (() => null) as never);
    expect(immediates).toBe(1);

    let posts = 0;
    class FakeChannel {
      port1: { onmessage: unknown } = { onmessage: null };
      port2 = { postMessage: () => posts++ };
    }
    const b = loadProd({ performance: { now: () => 0 }, MessageChannel: FakeChannel, setTimeout, clearTimeout });
    b.unstable_scheduleCallback(3 as never, (() => null) as never);
    expect(posts).toBe(1);
  });
});

describe('unstable_mock — второй оракул порядка', () => {
  function runMock(jobs: Job[]) {
    const exports = {};
    const ctx = vm.createContext({ exports, process: { env: { NODE_ENV: 'production' } }, console });
    vm.runInContext(MOCK, ctx);
    const M = ctx.exports as {
      unstable_now(): number;
      unstable_advanceTime(ms: number): void;
      unstable_shouldYield(): boolean;
      unstable_scheduleCallback(p: number, cb: unknown, o?: { delay: number }): void;
      unstable_flushAllWithoutAsserting(): void;
    };
    const makeJob = new Function(`${t.JOB_CODE}\nreturn makeJob;`)() as (...a: unknown[]) => unknown;
    const host = { now: () => M.unstable_now(), work: (ms: number) => M.unstable_advanceTime(ms) };
    const sch = { shouldYield: () => M.unstable_shouldYield() };
    const log: LogEntry[] = [];
    for (const job of jobs) {
      const cb = makeJob(sch, host, job, (name: string, part: number, didTimeout: boolean) =>
        log.push({ turn: 0, t: M.unstable_now(), name, part, didTimeout }),
      );
      M.unstable_scheduleCallback(job.priority, cb, job.delay ? { delay: job.delay } : undefined);
    }
    for (let i = 0; i < 2000; i++) {
      M.unstable_flushAllWithoutAsserting();
      M.unstable_advanceTime(1);
    }
    return log;
  }
  const order = (log: LogEntry[]) => log.map((e) => e.name).filter((n, i, a) => n !== a[i - 1]).join(' ');

  it('сценарий «Порядок» — то же время и тот же didTimeout', () => {
    const log = runMock(scenario('order').jobs);
    expect(log.map((e) => `t=${e.t} ${e.name}${e.part}${e.didTimeout ? '!' : ''}`)).toEqual(
      t.ORDER_LOG.map((s) => s.replace(/^#\d+ /, '')),
    );
  });

  it('200 случайных сценариев без событий: тот же порядок задач', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 17);
      const jobs: Job[] = Array.from({ length: 2 + Math.floor(r() * 9) }, (_, i) => ({
        name: `J${i}`,
        priority: (1 + Math.floor(r() * 5)) as Job['priority'],
        delay: r() < 0.3 ? Math.floor(r() * 30) : 0,
        units: [1 + Math.floor(r() * 3)],
      }));
      expect(order(runMock(jobs)), `seed ${seed}`).toBe(order(runMini(jobs)));
    }
  });
});
