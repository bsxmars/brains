import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { debounce as ldDebounce, throttle as ldThrottle } from 'lodash-es';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as t from '@/content/algorithms/rate-limiting/data';
import { THROTTLE_CODE as CALLBACKS_THROTTLE_CODE } from '@/content/lessons/callbacks/data';
import { loadLimiters, loadWrappers, maxInWindow, runLimiters, runTape, runWrappers, seededTape } from '@/widgets/rate-lab/model/run';
import type { Call, WrapperApi } from '@/widgets/rate-lab/model/types';

/**
 * Тема «Debounce, throttle и token bucket».
 *
 * Строки темы напечатаны на странице и исполняются демо (`widgets/rate-lab/model/run.ts`). Здесь:
 *   — `DEBOUNCE_CODE` и `THROTTLE_CODE` на виртуальных часах темы (`CLOCK_CODE`) сверяются
 *     с настоящими `debounce`/`throttle` из `lodash-es` под `vi.useFakeTimers` — на одних и тех же
 *     случайных лентах (mulberry32, зерно → лента), по парам «момент вызова, чьё событие дошло»;
 *   — таблицы темы пересчитываются lodash'ем и функциями темы;
 *   — rAF-throttle сверяется с независимым расчётом «последнее событие перед кадром»;
 *   — ограничители проверяются на свойствах: предел ведра жетонов, ровный выход дырявого ведра,
 *     граничный всплеск фиксированного окна, худшие окна на случайных лентах.
 * Настоящего времени нет нигде: числа одинаковы на любой машине.
 */

const require = createRequire(import.meta.url);
const W: WrapperApi = loadWrappers(t.RATE_CODE);
const L = loadLimiters(t.RATE_CODE);

const pairs = (calls: Call[]) => calls.map((c) => [c.t, c.arg] as [number, number]);

/** Тот же прогон, но настоящим lodash на фальшивых таймерах vitest. */
function runLodash(times: number[], make: (fn: (arg: number) => void) => (arg: number) => void, end: number) {
  vi.useFakeTimers({ now: 0 });
  try {
    const calls: [number, number][] = [];
    const wrapped = make((arg) => calls.push([Date.now(), arg]));
    times.forEach((at, i) => {
      vi.advanceTimersByTime(at - Date.now());
      wrapped(i);
    });
    vi.advanceTimersByTime(end - Date.now());
    return calls;
  } finally {
    vi.useRealTimers();
  }
}

const mine = (times: number[], make: Parameters<typeof runTape>[2], end: number) =>
  pairs(runTape(W, times, make, end));

afterEach(() => {
  vi.useRealTimers();
});

const DEBOUNCE_OPTS = [
  {},
  { leading: true },
  { leading: true, trailing: false },
  { trailing: false },
  { leading: false, trailing: false },
  { maxWait: 150 },
  { leading: true, maxWait: 150 },
  { leading: true, maxWait: 40 },
  { maxWait: 10 },
  { leading: true, trailing: false, maxWait: 120 },
];
const THROTTLE_OPTS = [{}, { leading: false }, { trailing: false }, { leading: false, trailing: false }];
const WAITS = [0, 1, 30, 100, 250];

describe('пример на виртуальных часах', () => {
  it('USAGE_CODE даёт то, что написано в комментарии', () => {
    const calls = new Function(`${t.CLOCK_CODE}\n${t.DEBOUNCE_CODE}\n${t.USAGE_CODE}\nreturn calls;`)();
    expect(calls).toEqual(t.USAGE_RESULT);
    expect(t.USAGE_CODE).toContain(`// ${JSON.stringify(t.USAGE_RESULT).replaceAll(',', ', ').replaceAll('"', "'")}`);
  });
});

describe('debounce и throttle темы против lodash-es', () => {
  it('на 120 случайных лентах вызовы совпадают с lodash: момент и аргумент', () => {
    let runs = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const times = seededTape(seed, 40);
      const end = times.at(-1)! + 2000;
      for (const wait of WAITS) {
        for (const o of DEBOUNCE_OPTS) {
          const want = runLodash(times, (fn) => ldDebounce(fn, wait, o), end);
          expect(mine(times, (fn, c) => W.debounce(fn, wait, o, c), end), `debounce seed ${seed} wait ${wait} ${JSON.stringify(o)}`).toEqual(want);
          runs++;
        }
        for (const o of THROTTLE_OPTS) {
          const want = runLodash(times, (fn) => ldThrottle(fn, wait, o), end);
          expect(mine(times, (fn, c) => W.throttle(fn, wait, o, c), end), `throttle seed ${seed} wait ${wait} ${JSON.stringify(o)}`).toEqual(want);
          runs++;
        }
      }
    }
    expect(runs).toBe(120 * WAITS.length * (DEBOUNCE_OPTS.length + THROTTLE_OPTS.length));
  });

  it('ветка «maxWait истёк, а таймер заведён на потом» нужна: без неё расхождение с lodash', () => {
    const branch = /\n {4}if \(isDue && maxing\) \{[\s\S]*?\n {4}\}\n/;
    expect(t.DEBOUNCE_CODE).toMatch(branch);
    const stripped = loadWrappers({ ...t.RATE_CODE, debounce: t.DEBOUNCE_CODE.replace(branch, '\n') });
    const times = seededTape(1, 40);
    const end = times.at(-1)! + 2000;
    const want = runLodash(times, (fn) => ldDebounce(fn, 250, { maxWait: 150 }), end);
    const full = mine(times, (fn, c) => W.debounce(fn, 250, { maxWait: 150 }, c), end);
    const bad = pairs(runTape(stripped, times, (fn, c) => stripped.debounce(fn, 250, { maxWait: 150 }, c), end));
    expect(full).toEqual(want);
    expect(bad).not.toEqual(want);
    expect(want[1][0]).toBe(503);
    expect(bad[1][0]).toBe(537);
  });

  it('throttle в lodash — это debounce с maxWait = wait: строка из исходника и поведение', () => {
    const src = readFileSync(require.resolve('lodash-es/throttle.js'), 'utf8');
    expect(src).toContain(t.LODASH_THROTTLE_SRC);
    const pkg = JSON.parse(readFileSync(require.resolve('lodash-es/package.json'), 'utf8')) as { version: string };
    expect(pkg.version).toBe('4.18.1');
    for (let seed = 1; seed <= 60; seed++) {
      const times = seededTape(seed, 40);
      const end = times.at(-1)! + 2000;
      for (const wait of [30, 100, 250]) {
        const a = runLodash(times, (fn) => ldThrottle(fn, wait), end);
        const b = runLodash(times, (fn) => ldDebounce(fn, wait, { leading: true, maxWait: wait, trailing: true }), end);
        expect(a).toEqual(b);
      }
    }
  });

  it('maxWait меньше wait поднимается до wait', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const times = seededTape(seed, 40);
      const end = times.at(-1)! + 2000;
      const a = runLodash(times, (fn) => ldDebounce(fn, 300, { maxWait: 100 }), end);
      const b = runLodash(times, (fn) => ldDebounce(fn, 300, { maxWait: 300 }), end);
      expect(a).toEqual(b);
      expect(mine(times, (fn, c) => W.debounce(fn, 300, { maxWait: 100 }, c), end)).toEqual(a);
    }
  });
});

describe('таблицы темы', () => {
  it('DEBOUNCE_ROWS — набор текста', () => {
    for (const row of t.DEBOUNCE_ROWS) {
      const end = 3000;
      expect(runLodash(t.TYPING_TAPE, (fn) => ldDebounce(fn, row.wait, row.opts), end), row.k).toEqual(row.calls);
      expect(mine(t.TYPING_TAPE, (fn, c) => W.debounce(fn, row.wait, row.opts, c), end), row.k).toEqual(row.calls);
    }
    expect(t.TYPING_TAPE[5] - t.TYPING_TAPE[4]).toBe(480);
    expect(t.DEBOUNCE_ROWS[1].d).toContain('480 мс');
  });

  it('STEADY_ROWS — ровный поток', () => {
    for (const row of t.STEADY_ROWS) {
      expect(runLodash(t.STEADY_TAPE, (fn) => ldDebounce(fn, row.wait, row.opts), 10_000), row.k).toEqual(row.calls);
      expect(mine(t.STEADY_TAPE, (fn, c) => W.debounce(fn, row.wait, row.opts, c), 10_000), row.k).toEqual(row.calls);
    }
  });

  it('на ровном потоке lodash ставит 21 таймер на 40 событий', () => {
    vi.useFakeTimers({ now: 0 });
    const fake = globalThis.setTimeout;
    let n = 0;
    globalThis.setTimeout = ((...a: Parameters<typeof setTimeout>) => {
      n++;
      return fake(...a);
    }) as typeof setTimeout;
    try {
      const d = ldDebounce(() => {}, 300);
      for (const at of t.STEADY_TAPE) {
        vi.advanceTimersByTime(at - Date.now());
        d();
      }
      vi.advanceTimersByTime(5000);
    } finally {
      globalThis.setTimeout = fake;
      vi.useRealTimers();
    }
    expect(n).toBe(t.STEADY_TIMERS);
    expect(t.STEADY_TAPE).toHaveLength(40);
    expect(t.DEBOUNCE_NOTE).toContain(`ставит ${t.STEADY_TIMERS} таймер`);
  });

  it('THROTTLE_QUIRK: lodash 0/100/150, throttle из «Колбэков» — 0/100/200', () => {
    const q = t.THROTTLE_QUIRK;
    expect(runLodash(q.tape, (fn) => ldThrottle(fn, q.wait), 1000)).toEqual(q.lodash);
    expect(mine(q.tape, (fn, c) => W.throttle(fn, q.wait, {}, c), 1000)).toEqual(q.lodash);
    const cbThrottle = new Function(`${CALLBACKS_THROTTLE_CODE}\nreturn throttle;`)() as (
      fn: (a: number) => void,
      wait: number,
    ) => (a: number) => void;
    expect(runLodash(q.tape, (fn) => cbThrottle(fn, q.wait), 1000)).toEqual(q.callbacks);
  });
});

describe('rAF-throttle', () => {
  it('один вызов на кадр, с последним событием перед кадром', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const times = seededTape(seed, 40);
      const got = mine(times, (fn, c) => W.rafThrottle(fn, c), times.at(-1)! + 100);
      // Независимый расчёт: событие в момент t попадает в кадр (⌊t / 16⌋ + 1) · 16.
      const want = new Map<number, number>();
      times.forEach((at, i) => want.set((Math.floor(at / 16) + 1) * 16, i));
      expect(got, `seed ${seed}`).toEqual([...want.entries()]);
    }
  });
});

describe('ведро жетонов', () => {
  it('на любом отрезке — не больше burst + rate · T', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const times = seededTape(seed, 80);
      for (const [rate, burst] of [[1, 1], [5, 3], [10, 1], [20, 10], [3, 7]]) {
        const b = L.createTokenBucket({ rate, burst });
        const passed = times.filter((at) => b.take(at));
        for (let i = 0; i < passed.length; i++) {
          for (let j = i; j < passed.length; j++) {
            // (j − i + 1) прошедших за (passed[j] − passed[i]) мс; целочисленно, без округлений.
            expect((j - i + 1 - burst) * 1000).toBeLessThanOrEqual(rate * (passed[j] - passed[i]));
          }
        }
      }
    }
  });

  it('под напором — burst из запаса и rate в секунду', () => {
    const s = t.TOKEN_SATURATION;
    const b = L.createTokenBucket({ rate: s.rate, burst: s.burst });
    let passed = 0;
    for (let at = 0; at <= s.until; at++) if (b.take(at)) passed++;
    expect(passed).toBe(s.passed);
    expect(passed).toBe(s.burst + (s.rate * s.until) / 1000);
    expect(t.TOKEN_FACTS[1].d).toContain(`прошло ${s.passed}`);
  });

  it('burst 1 и rate 1000 / wait пропускают те же события, что throttle lodash без trailing', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const times = seededTape(seed, 40);
      for (const wait of [40, 100, 250, 500]) {
        const b = L.createTokenBucket({ rate: 1000 / wait, burst: 1 });
        const viaBucket = times.flatMap((at, i) => (b.take(at) ? [i] : []));
        const viaThrottle = runLodash(times, (fn) => ldThrottle(fn, wait, { trailing: false }), times.at(-1)! + 1000).map((c) => c[1]);
        expect(viaBucket, `seed ${seed} wait ${wait}`).toEqual(viaThrottle);
      }
    }
  });
});

describe('дырявое ведро', () => {
  it('выход ровно раз в 1000 / rate мс, ожидание не больше capacity · gap', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const times = seededTape(seed, 60);
      for (const [rate, capacity] of [[5, 4], [10, 0], [2, 10]]) {
        const lb = L.createLeakyBucket({ rate, capacity });
        const gap = 1000 / rate;
        const outs: number[] = [];
        for (const at of times) {
          const out = lb.offer(at);
          if (out === null) continue;
          expect(out).toBeGreaterThanOrEqual(at);
          expect(out - at).toBeLessThanOrEqual(capacity * gap + 1e-9);
          outs.push(out);
        }
        for (let i = 1; i < outs.length; i++) expect(outs[i] - outs[i - 1]).toBeGreaterThanOrEqual(gap - 1e-9);
      }
    }
  });

  it('ведро без очереди (счётчик) решает так же, как ведро жетонов той же ёмкости', () => {
    // Независимая реализация «ведра-счётчика»: вода утекает со скоростью rate, переполнение — отказ.
    const meter = (rate: number, capacity: number) => {
      let water = 0;
      let last = 0;
      return (now: number) => {
        water = Math.max(0, water - (now - last) * rate);
        last = now;
        if (water + 1000 > capacity * 1000) return false;
        water += 1000;
        return true;
      };
    };
    for (let seed = 1; seed <= 200; seed++) {
      const times = seededTape(seed, 60);
      for (const [rate, burst] of [[5, 3], [1, 1], [20, 6]]) {
        const m = meter(rate, burst);
        const b = L.createTokenBucket({ rate, burst });
        expect(times.map((at) => m(at)), `seed ${seed}`).toEqual(times.map((at) => b.take(at)));
      }
    }
  });
});

describe('окна', () => {
  it('EDGE_ROWS: десять событий у границы секунды, лимит 5', () => {
    const run = (id: string) => {
      if (id === 'leaky') {
        const lb = L.createLeakyBucket({ rate: 5, capacity: 4 });
        return t.EDGE_TAPE.map((at) => lb.offer(at)).filter((x) => x !== null);
      }
      const lim =
        id === 'fixed'
          ? L.createFixedWindow({ limit: 5, window: 1000 })
          : id === 'log'
            ? L.createSlidingLog({ limit: 5, window: 1000 })
            : id === 'counter'
              ? L.createSlidingCounter({ limit: 5, window: 1000 })
              : L.createTokenBucket({ rate: 5, burst: 5 });
      return t.EDGE_TAPE.filter((at) => lim.take(at));
    };
    for (const row of t.EDGE_ROWS) expect(run(row.id), row.k).toHaveLength(row.passed);
    expect(run('leaky')).toEqual(t.LEAKY_EDGE_OUT);
    expect(t.EDGE_TAPE.at(-1)! - t.EDGE_TAPE[0]).toBe(180);
    expect(t.LEAKY_EDGE_OUT.at(-1)! - t.EDGE_TAPE[4]).toBe(720);
  });

  it('WINDOW_STATS: худшие 1000 мс на 2000 случайных лентах', () => {
    const s = t.WINDOW_STATS_SETUP;
    const worst: Record<string, number> = { fixed: 0, counter: 0, log: 0 };
    for (let seed = 1; seed <= s.tapes; seed++) {
      // Своя лента: серии плотные (шаг до 30 мс) и редкие (до 400 мс) вперемешку.
      let x = seed;
      const rnd = () => {
        x = (x + 0x6d2b79f5) | 0;
        let y = Math.imul(x ^ (x >>> 15), 1 | x);
        y = (y + Math.imul(y ^ (y >>> 7), 61 | y)) ^ y;
        return ((y ^ (y >>> 14)) >>> 0) / 4294967296;
      };
      const times: number[] = [];
      let at = 0;
      for (let i = 0; i < s.events; i++) {
        at += Math.floor(rnd() * (rnd() < 0.5 ? 30 : 400));
        times.push(at);
      }
      const make = {
        fixed: () => L.createFixedWindow({ limit: s.limit, window: s.window }),
        counter: () => L.createSlidingCounter({ limit: s.limit, window: s.window }),
        log: () => L.createSlidingLog({ limit: s.limit, window: s.window }),
      };
      for (const id of ['fixed', 'counter', 'log'] as const) {
        const lim = make[id]();
        worst[id] = Math.max(worst[id], maxInWindow(times.filter((v) => lim.take(v)), s.window));
      }
    }
    for (const row of t.WINDOW_STATS) expect(worst[row.id], row.k).toBe(row.worst);
    expect(worst.fixed).toBe(2 * s.limit);
    expect(worst.log).toBe(s.limit);
  });
});

describe('фальшивые таймеры без фальшивого Date', () => {
  it('lodash не зовёт функцию ни разу и держит таймер взведённым', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const calls: number[] = [];
    try {
      const d = ldDebounce((v: number) => calls.push(v), 300);
      t.TYPING_TAPE.forEach((at, i) => {
        if (i) vi.advanceTimersByTime(at - t.TYPING_TAPE[i - 1]);
        d(i);
      });
      vi.advanceTimersByTime(3000);
      expect(calls).toEqual([]);
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    expect(t.FAKE_DATE_NOTE).toContain('ни одного вызова');
  });
});

describe('демо считает теми же функциями', () => {
  it('runWrappers и runLimiters на лентах темы', () => {
    for (const tape of t.TAPES) {
      const end = tape.times.at(-1)! + 1000;
      const lanes = runWrappers(W, tape.times, { wait: 300, maxWait: 600 }, end);
      expect(lanes.find((l) => l.id === 'debounce')!.calls.map((c) => [c.t, c.arg])).toEqual(
        runLodash(tape.times, (fn) => ldDebounce(fn, 300), end),
      );
      expect(lanes.find((l) => l.id === 'throttle')!.calls.map((c) => [c.t, c.arg])).toEqual(
        runLodash(tape.times, (fn) => ldThrottle(fn, 300), end),
      );
    }
    const { lanes } = runLimiters(L, t.EDGE_TAPE, { rate: 5, burst: 5 }, 3000);
    const passed = Object.fromEntries(lanes.map((l) => [l.id, l.verdicts.filter((v) => v.ok).length]));
    expect(passed).toMatchObject({ fixed: 10, log: 5, counter: 6, token: 5 });
    expect(lanes.find((l) => l.id === 'fixed')!.worst).toBe(10);
  });

  it('лента «у границы окна»: при rate до пяти худшая секунда фиксированного окна — ровно вдвое', () => {
    const edge = t.TAPES.find((p) => p.id === 'edge')!;
    expect(edge.note).toContain('при `rate` до пяти');
    for (let rate = 1; rate <= 5; rate++) {
      const { lanes } = runLimiters(L, edge.times, { rate, burst: 3 }, 3000);
      expect(lanes.find((l) => l.id === 'fixed')!.worst, `rate ${rate}`).toBe(2 * rate);
    }
  });
});
