import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CAPTURE_CODE,
  CPU_VS_HEAP_ROWS,
  FLOOR_CODE,
  FLAME_DEMO_NOTE,
  FLOOR_OUT,
  FOLD_CODE,
  INTERVAL_DEMO_NOTE,
  METRICS_CODE,
  MODE_ROWS,
  OVERHEAD_ROWS,
  PITFALLS,
  STAND_ALL,
  STAND_CODE,
  STAND_LIVE,
} from '@/content/lessons/continuous-profiling/data';
import { expandProfile, loadFold } from '@/widgets/pp-flame/model/fold';
import type { FoldNode, StandProfile, V8HeapNode, V8HeapProfile } from '@/widgets/pp-flame/model/types';
import { intervalReport, NODE_DEFAULT_INTERVAL, SAMPLES_FOR_20PCT } from '@/widgets/pp-interval/model/interval';

/**
 * Утверждения темы «Непрерывное профилирование памяти» — запуском.
 *
 * Всё, что касается профилировщика и сборщика, спрашивается у **отдельного процесса** Node:
 * в процессе `vitest` нет `gc()`, а профиль, снятый внутри тестового раннера, записал бы
 * и его собственные выделения. Приём тот же, что в `node-memory.test.ts` и `v8-engine.test.ts`.
 *
 * ⚠️ Здесь закрепляются законы и направления, а не числа. Выборка случайна, время зависит
 * от машины и от соседей по ней. Поэтому: «профиль назвал `login`», а не «login = 92%»;
 * «разброс близок к 1/√n», а не «разброс = 0.069»; «выборка дороже», а не «×3.3».
 *
 * ⚠️ Не проверяется здесь: браузерная таблица (`BROWSER_ROWS`) — она снята Playwright
 * в Chromium, а юнит-тест в браузер не ходит; описания Pyroscope, Datadog и Parca — они
 * помечены в данных как прочитанные по документации.
 */

const api = loadFold(FOLD_CODE);
const work = mkdtempSync(join(tmpdir(), 'continuous-profiling-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** Запустить модуль в отдельном процессе Node и вернуть его stdout. */
function runModule(name: string, code: string, args: string[] = [], flags: string[] = []): string {
  writeFileSync(join(work, name), code);
  return execFileSync(process.execPath, [...flags, name, ...args], { cwd: work, encoding: 'utf8' }).trim();
}

/** Записать профиль стенда ровно тем кодом, что напечатан в теме. */
function capture(code: string): V8HeapProfile {
  writeFileSync(join(work, 'stand.mjs'), STAND_CODE);
  runModule('capture.mjs', code);
  return JSON.parse(readFileSync(join(work, 'stand.heapprofile'), 'utf8')) as V8HeapProfile;
}

/** Без двух флагов `include…` — профиль «только живое». Правка обязана примениться. */
function liveVariant(): string {
  const code = CAPTURE_CODE.replace(/\n\s*includeObjects[^\n]*/g, '');
  expect(CAPTURE_CODE.split('\n').length - code.split('\n').length, 'сняты обе строки флагов').toBe(2);
  return code;
}

/** Собственные значения по имени функции (без файла и строки), доли от корня. */
function selfShares(root: FoldNode): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (node: FoldNode) => {
    if (node !== root) {
      const name = node.name.split(' ')[0];
      out.set(name, (out.get(name) ?? 0) + node.self / root.total);
    }
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}

function topSelf(root: FoldNode): string {
  return [...selfShares(root)].sort((a, b) => b[1] - a[1])[0][0];
}

function nodeIds(profile: V8HeapProfile): Set<number> {
  const ids = new Set<number>();
  const walk = (n: V8HeapNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(profile.head);
  return ids;
}

function selfSum(profile: V8HeapProfile): number {
  let sum = 0;
  const walk = (n: V8HeapNode) => {
    sum += n.selfSize;
    n.children.forEach(walk);
  };
  walk(profile.head);
  return sum;
}

describe('стенд и запись: профиль называет правильную функцию', () => {
  it('все выделения → renderCatalog; сумма корня равна сумме сэмплов', () => {
    const profile = capture(CAPTURE_CODE);
    const root = api.fold(api.fromV8(profile), 'bytes');

    expect(topSelf(root), 'больше всего мусора создаёт renderCatalog').toBe('renderCatalog');
    expect(selfShares(root).get('sign') ?? 0, '`sign` ничего не выделяет').toBeLessThan(0.005);

    const ids = nodeIds(profile);
    const bytes = profile.samples.filter((s) => ids.has(s.nodeId)).reduce((a, s) => a + s.size, 0);
    expect(root.total, 'корень свёртки = сумма `size` сэмплов с узлом').toBe(bytes);
    // Округление масштаба у мелких объектов — доли процента.
    expect(Math.abs(root.total / selfSum(profile) - 1)).toBeLessThan(0.01);
  }, 60_000);

  it('только живое → login; renderCatalog почти не остаётся', () => {
    const profile = capture(liveVariant());
    const root = api.fold(api.fromV8(profile), 'bytes');
    expect(topSelf(root), 'живое родилось в login').toBe('login');
    expect(selfShares(root).get('renderCatalog') ?? 0).toBeLessThan(0.1);
  }, 60_000);
});

describe('литералы стенда согласованы с кодом и с текстом', () => {
  const standLines = STAND_CODE.split('\n');

  it.each([
    ['all', STAND_ALL],
    ['live', STAND_LIVE],
  ] as [string, StandProfile][])('%s: суммы, строки кадров и число сэмплов', (_mode, profile) => {
    const bytes = profile.samples.reduce((a, s) => a + s[1], 0);
    const count = profile.samples.reduce((a, s) => a + s[2], 0);
    expect(bytes).toBe(profile.recordedBytes);
    expect(count).toBe(profile.rawSamples);

    // «расхождение меньше десятой доли процента» — так сказано в теме.
    expect(Math.abs(profile.recordedBytes / profile.selfTotal - 1)).toBeLessThan(0.001);

    // Кадр `renderCatalog stand.mjs:4` обязан указывать на строку с этой функцией в STAND_CODE:
    // иначе литерал снят с другого стенда, чем напечатан.
    for (const frame of profile.frames) {
      const m = /^(\w+) stand\.mjs:(\d+)$/.exec(frame);
      if (!m) continue;
      expect(standLines[Number(m[2]) - 1], `${frame} → строка стенда`).toContain(m[1]);
    }

    const root = api.fold(expandProfile(profile), 'bytes');
    expect(root.total).toBe(profile.recordedBytes);
    expect(api.fold(expandProfile(profile), 'samples').total).toBe(profile.rawSamples);
  });

  it('литералы называют тех же виновников, что и таблица режимов', () => {
    const all = api.fold(expandProfile(STAND_ALL), 'bytes');
    const live = api.fold(expandProfile(STAND_LIVE), 'bytes');
    expect(topSelf(all)).toBe('renderCatalog');
    expect(topSelf(live)).toBe('login');
    expect(MODE_ROWS[0][1]).toMatch(/^`renderCatalog`/);
    expect(MODE_ROWS[1][1]).toMatch(/^`login`/);
  });
});

/**
 * Подписи к демо говорят, что читатель увидит, — числами. Числа вынимаются из текста
 * и сверяются с тем, что посчитает тот же код, который исполняет демо: правка подписи
 * без пересчёта (или пересъёмка литералов без правки подписи) краснеет здесь.
 */
describe('подписи к демо совпадают с тем, что демо покажет', () => {
  const pct = (re: RegExp, text: string) => {
    const m = re.exec(text);
    expect(m, `в подписи нет ${re}`).not.toBeNull();
    return Number(m![1].replace(',', '.')) / 100;
  };

  it('FLAME_DEMO_NOTE: доля renderCatalog, нет sign, «живое» — один login, байты ≈ сэмплы', () => {
    const allBytes = api.fold(expandProfile(STAND_ALL), 'bytes');
    const allCount = api.fold(expandProfile(STAND_ALL), 'samples');
    const live = api.fold(expandProfile(STAND_LIVE), 'bytes');

    const said = pct(/`join` — ([\d.]+)% байт/, FLAME_DEMO_NOTE);
    expect(api.matchShare(allBytes, 'renderCatalog'), 'renderCatalog вместе с join').toBeCloseTo(said, 2);
    expect(FLAME_DEMO_NOTE).toContain('`sign` здесь нет');
    expect(api.matchShare(allBytes, 'sign')).toBe(0);
    expect(api.matchShare(live, 'login'), 'живое — один login').toBe(1);
    for (const name of ['renderCatalog', 'join', 'searchApi', 'login']) {
      const gap = Math.abs(api.matchShare(allBytes, name) - api.matchShare(allCount, name));
      expect(gap, `${name}: байты против сэмплов`).toBeLessThan(0.01);
    }
  });

  it('INTERVAL_DEMO_NOTE: умолчания калькулятора при 32 КБ и при 512 КБ', () => {
    const base = { rateMBs: 20, share: 0.05, windowS: 60, objectB: 64 };
    const r32 = intervalReport({ ...base, intervalB: 32 * 1024 });
    const r512 = intervalReport({ ...base, intervalB: NODE_DEFAULT_INTERVAL });
    expect(INTERVAL_DEMO_NOTE).toContain('около двух тысяч сэмплов');
    expect(r32.fnSamples).toBeGreaterThan(1800);
    expect(r32.fnSamples).toBeLessThan(2100);
    expect(r32.err95).toBeCloseTo(pct(/±([\d.]+)%\. При умолчании/, INTERVAL_DEMO_NOTE), 3);
    expect(r512.err95).toBeCloseTo(pct(/до ±(\d+)%/, INTERVAL_DEMO_NOTE), 2);
    expect(r32.fnSamples / r512.fnSamples).toBe(16);
    expect(r512.err95, '5% проходит порог ±20%').toBeLessThan(0.2);
    expect(r512.minShare).toBeCloseTo(pct(/±20% \((\d+)%\)/, INTERVAL_DEMO_NOTE), 2);
  });
});

describe('FOLD_CODE: дерево и ширины', () => {
  const root = api.fold(expandProfile(STAND_ALL), 'bytes');
  const rects = api.layout(root);

  it('корень во всю ширину, дети не шире родителя и лежат внутри него', () => {
    expect(rects[0]).toMatchObject({ x: 0, w: 1, depth: 0 });
    for (const rect of rects) {
      const kids = rects.filter((r) => r.depth === rect.depth + 1 && [...rect.node.children.values()].includes(r.node));
      const sum = kids.reduce((a, k) => a + k.w, 0);
      expect(sum).toBeLessThanOrEqual(rect.w + 1e-9);
      for (const k of kids) {
        expect(k.x).toBeGreaterThanOrEqual(rect.x - 1e-9);
        expect(k.x + k.w).toBeLessThanOrEqual(rect.x + rect.w + 1e-9);
      }
    }
  });

  it('total узла = self + сумма детей', () => {
    const visit = (n: FoldNode) => {
      const kids = [...n.children.values()].reduce((a, c) => a + c.total, 0);
      expect(n.total).toBe(n.self + kids);
      n.children.forEach(visit);
    };
    visit(root);
  });

  it('поиск: доля кадра и отсутствие двойного счёта', () => {
    const shares = selfShares(root);
    // join вызывается только из renderCatalog — его байты уже внутри renderCatalog.
    expect(api.matchShare(root, 'renderCatalog')).toBeCloseTo(
      (shares.get('renderCatalog') ?? 0) + (shares.get('join') ?? 0),
      6,
    );
    expect(api.matchShare(root, 'stand.mjs')).toBeLessThanOrEqual(1);
    expect(api.matchShare(root, 'нет-такой-функции')).toBe(0);
    expect(api.matchShare(root, '   ')).toBe(0);
  });

  it('сэмпл без узла в дереве отбрасывается, а не роняет свёртку', () => {
    const profile: V8HeapProfile = {
      head: {
        id: 1,
        selfSize: 0,
        callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 },
        children: [
          { id: 2, selfSize: 100, callFrame: { functionName: 'a', url: 'file:///x/a.mjs', lineNumber: 0, columnNumber: 0 }, children: [] },
        ],
      },
      samples: [
        { size: 100, nodeId: 2, ordinal: 1 },
        { size: 999, nodeId: 42, ordinal: 2 },
      ],
    };
    const samples = api.fromV8(profile);
    expect(samples).toEqual([{ stack: ['a a.mjs:1'], bytes: 100, count: 1 }]);
    expect(api.fold(samples, 'bytes').total).toBe(100);
  });
});

describe('интервал выборки: формулы калькулятора против движка', () => {
  it('формулы калькулятора', () => {
    const r = intervalReport({ rateMBs: 32, intervalB: 32 * 1024, share: 0.25, windowS: 10, objectB: 32 * 1024 });
    expect(r.samplesPerSec).toBeCloseTo(1024, 6);
    expect(r.fnSamples).toBeCloseTo(2560, 6);
    expect(r.err95).toBeCloseTo(1.96 / Math.sqrt(2560), 9);
    expect(r.pObject).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(r.vsReference).toBe(NODE_DEFAULT_INTERVAL / (32 * 1024));
    expect(r.minShare).toBeCloseTo(SAMPLES_FOR_20PCT / 10240, 9);
    expect(SAMPLES_FOR_20PCT).toBe(97);
  });

  /**
   * Сорок записей одного и того же кода. Массив под объекты создан заранее: иначе его рост
   * даёт крупные выделения, которые попадают в выборку почти наверняка, и разброс выходит
   * меньше закона — так и было в первой версии этой проверки (0.043 против 0.070).
   */
  const CV_CODE = `import v8 from 'node:v8';
const keep = new Array(20000).fill(null);
function make(n) { for (let i = 0; i < n; i++) keep[i] = { a: i, b: i }; }
const out = {};
for (const R of [1024, 4096, 16384]) {
  const est = [], ns = [];
  for (let rep = 0; rep < 40; rep++) {
    keep.fill(null);
    const h = v8.startHeapProfile({ sampleInterval: R, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    make(20000);
    const p = JSON.parse(h.stop());
    let self = 0; const ids = new Set();
    (function w(n) { if (n.callFrame.functionName === 'make') { self += n.selfSize; ids.add(n.id); } n.children.forEach(w); })(p.head);
    est.push(self); ns.push(p.samples.filter((s) => ids.has(s.nodeId)).length);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sd = Math.sqrt(mean(est.map((x) => (x - mean(est)) ** 2)));
  out[R] = { cv: sd / mean(est), n: mean(ns), mean: mean(est) };
}
console.log(JSON.stringify(out));`;

  /** `v8.startHeapProfile` появился в Node 26: в 24.11 и 20.14 его нет. */
  const hasV8Profile = Number(process.versions.node.split('.')[0]) >= 26;

  it.runIf(hasV8Profile)('разброс оценки ≈ 1/√n, среднее от интервала не зависит', () => {
    const out = JSON.parse(runModule('cv.mjs', CV_CODE)) as Record<string, { cv: number; n: number; mean: number }>;
    for (const { cv, n } of Object.values(out)) {
      const law = 1 / Math.sqrt(n);
      expect(cv / law, `cv ${cv.toFixed(3)} против 1/√n ${law.toFixed(3)}`).toBeGreaterThan(0.6);
      expect(cv / law).toBeLessThan(1.5);
    }
    expect(Math.abs(out['1024'].mean / out['16384'].mean - 1), 'оценка несмещённая').toBeLessThan(0.15);
  }, 60_000);

  it('умолчания интервала: 512 КБ у v8.startHeapProfile и --heap-prof', () => {
    const src = execFileSync(
      process.execPath,
      ['--expose-internals', '-e', "process.stdout.write(process.binding('natives')['internal/v8/heap_profile'] ?? '')"],
      { encoding: 'utf8' },
    );
    expect(src, 'исходник normalizeHeapProfileOptions').toContain('sampleInterval = 512 * 1024');
    expect(CAPTURE_CODE).toContain('samplingInterval: 32768');
    expect(PITFALLS.some((p) => p.d.includes('32 КБ') && p.d.includes('512 КБ'))).toBe(true);
  });

  /**
   * Средний объект: округление числа объектов на сэмпл завышает сумму по сэмплам.
   * 3000 массивов по ~8 КБ при интервале 16 КБ — те же, что в тонком месте 02.
   */
  it('у средних объектов сумма по сэмплам заметно больше selfSize', () => {
    const code = `import { Session } from 'node:inspector/promises';
const keep = [];
function big(i) { keep.push(new Array(1000).fill(i)); }
const s = new Session(); s.connect();
await s.post('HeapProfiler.enable');
await s.post('HeapProfiler.startSampling', { samplingInterval: 16384 });
for (let i = 0; i < 3000; i++) big(i);
const { profile } = await s.post('HeapProfiler.stopSampling');
let self = 0; const ids = new Set();
(function w(n) { if (n.callFrame.functionName === 'big') { self += n.selfSize; ids.add(n.id); } n.children.forEach(w); })(profile.head);
const samples = profile.samples.filter((x) => ids.has(x.nodeId)).reduce((a, x) => a + x.size, 0);
console.log(JSON.stringify({ self, samples }));`;
    const { self, samples } = JSON.parse(runModule('medium.mjs', code)) as { self: number; samples: number };
    expect(samples / self, 'по сэмплам больше, чем по дереву').toBeGreaterThan(1.05);
  }, 60_000);
});

describe('накладные расходы и CPU-профиль — только направление', () => {
  const node26 = Number(process.versions.node.split('.')[0]) >= 26;

  it.runIf(node26)('частая выборка дороже, чем без неё', () => {
    writeFileSync(join(work, 'stand.mjs'), STAND_CODE);
    const code = `import v8 from 'node:v8';
import { serve, sessions } from './stand.mjs';
await serve(5000);
const t = { off: [], on: [] };
for (let rep = 0; rep < 3; rep++) for (const mode of rep % 2 ? ['on', 'off'] : ['off', 'on']) {
  sessions.clear();
  const h = mode === 'on' ? v8.startHeapProfile({ sampleInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }) : null;
  const t0 = performance.now(); await serve(10000); t[mode].push(performance.now() - t0);
  h?.stop();
}
const med = (a) => [...a].sort((x, y) => x - y)[1];
console.log(med(t.on) / med(t.off));`;
    const ratio = Number(runModule('overhead.mjs', code));
    expect(ratio, `отношение ${ratio.toFixed(2)}`).toBeGreaterThan(1.3);
    // И в таблице цена растёт с частотой — сверху вниз.
    const tops = OVERHEAD_ROWS.slice(0, 5).map((row) => Number(/×([\d.]+)/.exec(row[2])![1]));
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  }, 120_000);

  it.runIf(node26)('sign есть в CPU-профиле и отсутствует в профиле выделений', () => {
    writeFileSync(join(work, 'stand.mjs'), STAND_CODE);
    const code = `import v8 from 'node:v8';
import { serve } from './stand.mjs';
await serve(3000);
const cpu = v8.startCpuProfile();
const heap = v8.startHeapProfile({ sampleInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await serve(100000);
const hp = JSON.parse(heap.stop());
const cp = JSON.parse(cpu.stop());
const hits = cp.nodes.reduce((a, n) => a + (n.hitCount ?? 0), 0);
const cpuShare = (name) => cp.nodes.filter((n) => n.callFrame.functionName === name).reduce((a, n) => a + (n.hitCount ?? 0), 0) / hits;
let signHeap = 0; (function w(n) { if (n.callFrame.functionName === 'sign') signHeap += n.selfSize; n.children.forEach(w); })(hp.head);
console.log(JSON.stringify({ signCpu: cpuShare('sign'), gcCpu: cpuShare('(garbage collector)'), signHeap }));`;
    const r = JSON.parse(runModule('cpu.mjs', code)) as { signCpu: number; gcCpu: number; signHeap: number };
    expect(r.signCpu, 'sign ест процессор').toBeGreaterThan(0.05);
    expect(r.signHeap, 'и не выделяет ничего').toBe(0);
    expect(r.gcCpu, 'работа сборщика — отдельный кадр CPU-профиля').toBeGreaterThan(0);
    expect(CPU_VS_HEAP_ROWS.find((row) => row[0] === '`sign`')![2]).toMatch(/^0/);
  }, 120_000);
});

describe('метрики процесса', () => {
  it('startMetrics: простой, занятый цикл и две принудительные сборки', () => {
    writeFileSync(join(work, 'metrics.mjs'), METRICS_CODE);
    const driver = `import { startMetrics } from './metrics.mjs';
const rows = [];
const stop = startMetrics((m) => rows.push(m), 300);
const spin = (ms) => { const t = performance.now(); while (performance.now() - t < ms); };
await new Promise((r) => setTimeout(r, 320));
for (let i = 0; i < 6; i++) { spin(40); await new Promise((r) => setTimeout(r, 5)); }
await new Promise((r) => setTimeout(r, 0));
globalThis.gc(); globalThis.gc();
await new Promise((r) => setTimeout(r, 700));
stop();
console.log(JSON.stringify(rows));`;
    const rows = JSON.parse(runModule('drive.mjs', driver, [], ['--expose-gc'])) as {
      elu: number;
      delayP99Ms: number;
      major: number;
      rss: number;
      heapUsed: number;
      external: number;
    }[];
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) {
      expect(row.rss).toBeGreaterThan(row.heapUsed);
      expect(row.external).toBeGreaterThan(0);
    }
    const elus = rows.map((r) => r.elu);
    expect(Math.max(...elus), 'занятый цикл').toBeGreaterThan(0.5);
    expect(Math.min(...elus), 'простой').toBeLessThan(0.2);
    expect(Math.max(...elus) / Math.max(Math.min(...elus), 1e-3), 'занят против простоя').toBeGreaterThan(5);
    expect(rows.reduce((a, r) => a + r.major, 0), 'две принудительные — это major').toBeGreaterThanOrEqual(2);
    expect(Math.min(...rows.map((r) => r.delayP99Ms)), 'после вычета шага простой близок к нулю').toBeLessThan(8);
  }, 60_000);

  it('записи gc: доставка после уступки, виды и флаг принудительной сборки', () => {
    const code = `import { PerformanceObserver, constants as C } from 'node:perf_hooks';
const seen = { minor: 0, major: 0, forced: 0 };
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.detail.kind === C.NODE_PERFORMANCE_GC_MINOR) seen.minor++;
    if (e.detail.kind === C.NODE_PERFORMANCE_GC_MAJOR) seen.major++;
    if (e.detail.flags & C.NODE_PERFORMANCE_GC_FLAGS_FORCED) seen.forced++;
  }
});
obs.observe({ entryTypes: ['gc'] });
let junk = 0; for (let i = 0; i < 2e6; i++) junk += [i, i + 1].length;
await new Promise((r) => setTimeout(r, 0));
globalThis.gc();
globalThis.gc();
await new Promise((r) => setTimeout(r, 30));
console.log(JSON.stringify(seen));
obs.disconnect();`;
    const r = JSON.parse(runModule('gc.mjs', code, [], ['--expose-gc'])) as {
      minor: number;
      major: number;
      forced: number;
    };
    expect(r.minor, 'мусор даёт молодые сборки').toBeGreaterThan(0);
    expect(r.forced, 'gc() помечен флагом FORCED').toBe(2);
    expect(r.major).toBeGreaterThanOrEqual(2);
    // Синхронно сразу после gc() — ноль, пока поток не уступлен (без флага, одной записью).
    const syncCode = `import { PerformanceObserver } from 'node:perf_hooks';
let n = 0;
const o = new PerformanceObserver((l) => { n += l.getEntries().length; });
o.observe({ entryTypes: ['gc'] });
globalThis.gc();
const sync = n;
await new Promise((r) => setTimeout(r, 30));
console.log(sync, n);
o.disconnect();`;
    const [sync, later] = runModule('gc-sync.mjs', syncCode, [], ['--expose-gc']).split(' ').map(Number);
    expect(sync).toBe(0);
    expect(later).toBeGreaterThan(0);
  }, 60_000);

  it('гистограмма задержки в простое не опускается ниже шага опроса', () => {
    const code = `import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 10 }); h.enable();
setTimeout(() => { h.disable(); console.log(h.min / 1e6); }, 500);`;
    expect(Number(runModule('eld.mjs', code))).toBeGreaterThan(8);
  }, 30_000);

  it('FLOOR_CODE: пол кеша стоит, пол утечки растёт', () => {
    const parse = (line: string) => {
      const m = /major GC: (\d+) · пол после каждой, МБ: ([\d. ]+)$/.exec(line.trim());
      expect(m, `строка вывода: ${line}`).not.toBeNull();
      return { majors: Number(m![1]), floor: m![2].trim().split(' ').map(Number) };
    };
    const cache = parse(runModule('floor.mjs', FLOOR_CODE, ['cache']));
    const leak = parse(runModule('floor.mjs', FLOOR_CODE, ['leak']));
    const [cacheOut, leakOut] = FLOOR_OUT.split('\n').map(parse);

    for (const run of [cache, cacheOut]) {
      expect(run.floor.length).toBeGreaterThanOrEqual(3);
      expect(Math.max(...run.floor) / Math.min(...run.floor), 'кеш: пол ровный').toBeLessThan(1.5);
    }
    for (const run of [leak, leakOut]) {
      expect(run.floor.length).toBeGreaterThanOrEqual(2);
      expect(run.floor.at(-1)! / run.floor[0], 'утечка: пол растёт').toBeGreaterThan(3);
    }
    // Тонкое место 04: у утечки полных сборок не больше, чем у здорового кеша.
    expect(leak.majors).toBeLessThanOrEqual(cache.majors);
    expect(leakOut.majors).toBeLessThanOrEqual(cacheOut.majors);
  }, 120_000);
});

describe('ссылки темы ведут на существующие разделы', () => {
  const root = new URL('../../src/content/', import.meta.url);
  const text = [
    readFileSync(new URL('lessons/continuous-profiling/index.mdx', root), 'utf8'),
    readFileSync(new URL('lessons/continuous-profiling/data.ts', root), 'utf8'),
  ].join('\n');
  const links = [...new Set([...text.matchAll(/\]\((\/(js|platform|render|delivery)\/[a-z0-9-]+\/(#s\d+)?)\)/g)].map((m) => m[1]))];

  it('ссылки найдены', () => {
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it.each(links)('%s', (href) => {
    const [, direction, slug, anchor] = /^\/(\w+)\/([a-z0-9-]+)\/(?:#(s\d+))?$/.exec(href)!;
    const collection = direction === 'js' ? 'lessons' : direction;
    const mdx = new URL(`${collection}/${slug}/index.mdx`, root);
    expect(existsSync(mdx), `${href}: темы нет`).toBe(true);
    if (anchor) expect(readFileSync(mdx, 'utf8'), `${href}: раздела нет`).toContain(`id="${anchor}"`);
  });
});
