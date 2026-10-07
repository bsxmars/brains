import { LRUCache } from 'lru-cache';
import { lruMemoize, weakMapMemoize } from 'reselect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as t from '@/content/algorithms/eviction/data';
import { ALGOS, curves, keysOf, loadEviction, makeCache, stepFrames } from '@/widgets/eviction-lab/model/run';
import type { AlgoId, Cache, LfuCache, LruCache, SieveCache, TinyLfuCache } from '@/widgets/eviction-lab/model/types';

/**
 * Тема «Кеши с вытеснением: LRU, LFU, TinyLFU».
 *
 * Классы и трассы — строки из темы (`LRU_CODE`, `LFU_CODE`, `SKETCH_CODE`, `TINYLFU_CODE`,
 * `SIEVE_CODE`, `TRACE_CODE`), собранные тем же `loadEviction`, что и демо. Учебный LRU
 * сверяется с `lru-cache` 11 по каждому шагу; остальные — по свойствам, которые утверждает
 * текст, и по закреплённым долям попаданий на трассах с зерном 1. Примеры с `lru-cache`
 * (`TTL_CODE`, `SIZE_CODE`, `FETCH_CODE`) исполняются как напечатаны.
 */

const api = loadEviction({
  lru: t.LRU_CODE,
  lfu: t.LFU_CODE,
  sketch: t.SKETCH_CODE,
  tinylfu: t.TINYLFU_CODE,
  sieve: t.SIEVE_CODE,
  trace: t.TRACE_CODE,
});

/** Нужная тесту часть `unsafeExposeInternals`: типы пакета описывают её шире, чем она есть. */
interface Internals {
  keyList: unknown[];
  next: Uint8Array | Uint16Array | Uint32Array;
  prev: Uint8Array | Uint16Array | Uint32Array;
  head: number;
  tail: number;
  free: { heap: Uint8Array | Uint16Array | Uint32Array; length: number };
  rindexes(options: { allowStale: boolean }): Iterable<number>;
}
type Key = NonNullable<unknown>;
const internals = (c: object) => LRUCache.unsafeExposeInternals(c as LRUCache<Key, Key>) as unknown as Internals;
const pct = t.share;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LRU_CODE против lru-cache', () => {
  /**
   * Случайная трасса операций: get, set и сдвиг своих часов. На каждой операции совпадают
   * ответ get, кто ушёл (и почему) и весь порядок записей, включая протухшие.
   */
  function race(seed: number, { max, ttl, keys, ops }: { max: number; ttl: number; keys: number; ops: number }) {
    const random = api.mulberry32(seed);
    let now = 1000;
    const clock = () => now;
    const gone: string[] = [];
    const ref = new LRUCache<number, number>({
      max,
      ...(ttl ? { ttl, ttlResolution: 0, perf: { now: clock } } : {}),
      dispose: (_v, k, reason) => {
        if (reason !== 'set') gone.push(`${k}:${reason}`);
      },
    });
    const mine = new api.LRU(max, { ttl, now: clock });
    const stats = { hits: 0, evict: 0, expire: 0 };

    for (let i = 0; i < ops; i++) {
      const x = random();
      const k = Math.floor(random() * keys);
      gone.length = 0;
      const before = [...mine.map.keys()] as number[];
      if (x < 0.55) {
        const a = ref.get(k);
        const b = mine.get(k);
        expect(b, `get на операции ${i}`).toBe(a);
        if (b !== undefined) stats.hits++;
      } else if (x < 0.95) {
        ref.set(k, i);
        mine.set(k, i);
      } else {
        now += Math.floor(random() * (ttl || 10));
      }
      const after = new Set(mine.map.keys());
      const left = before.filter((q) => !after.has(q));
      expect(left, `ушедшие на операции ${i}`).toEqual(gone.map((g) => Number(g.split(':')[0])));
      for (const g of gone) stats[g.endsWith('evict') ? 'evict' : 'expire']++;
      const ri = internals(ref);
      const order = [...ri.rindexes({ allowStale: true })].map((j) => ri.keyList[j]);
      expect(order, `порядок на операции ${i}`).toEqual([...mine.map.keys()]);
    }
    return stats;
  }

  it('без TTL: те же попадания, вытеснения и порядок на трёх зёрнах', () => {
    for (const seed of [1, 2, 3]) {
      const s = race(seed, { max: 8, ttl: 0, keys: 20, ops: 5000 });
      expect(s.evict).toBeGreaterThan(1000);
      expect(s.expire).toBe(0);
    }
  });

  it('с TTL: протухшие уходят при чтении (expire) и при вытеснении (evict) одинаково', () => {
    for (const seed of [1, 2, 3]) {
      const s = race(seed, { max: 8, ttl: 50, keys: 20, ops: 5000 });
      expect(s.expire).toBeGreaterThan(50);
    }
  });

  it('на трассах темы доля попаданий учебного LRU и lru-cache совпадает', () => {
    for (const kind of ['zipf', 'scan', 'loop', 'shift'] as const) {
      const trace = api.makeTrace(kind, { seed: 1 });
      for (const cap of t.CHART_CAPACITIES) {
        const ref = new LRUCache<number, number>({ max: cap });
        const adapter: Cache = { get: (k) => ref.get(k as number), set: (k, v) => void ref.set(k as number, v as number) };
        expect(api.simulate(adapter, trace).hitRate).toBe(api.simulate(new api.LRU(cap), trace).hitRate);
      }
    }
  });

  it('вытеснение новым итератором (NAIVE_EVICT_CODE) выбирает ту же жертву, что один итератор', () => {
    expect(t.NAIVE_EVICT_CODE).toContain('this.map.keys().next().value');
    const naive = new api.LRU(16);
    naive.set = function (this: LruCache, key: unknown, value: unknown) {
      this.map.delete(key);
      this.map.set(key, { value, start: 0 });
      if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    };
    const mine = new api.LRU(16);
    const trace = api.makeTrace('zipf', { seed: 3, length: 5000, keys: 100 });
    for (const k of trace) {
      const a = naive.get(k) !== undefined;
      const b = mine.get(k) !== undefined;
      expect(b).toBe(a);
      if (!a) {
        naive.set(k, k);
        mine.set(k, k);
      }
      expect([...mine.map.keys()]).toEqual([...naive.map.keys()]);
    }
  });
});

describe('lru-cache изнутри', () => {
  it('LAYOUT_ROWS — массивы индексов после каждой операции', () => {
    const c = new LRUCache<string, string>({ max: 4 });
    const i = internals(c);
    for (const row of t.LAYOUT_ROWS) {
      const [, op, key] = /^(\w+)\((\w+)\)$/.exec(row.op)!;
      if (op === 'set') c.set(key, key.toLowerCase());
      else if (op === 'get') c.get(key);
      else c.delete(key);
      expect({
        keyList: i.keyList.map((k: unknown) => k ?? null),
        next: [...i.next],
        prev: [...i.prev],
        head: i.head,
        tail: i.tail,
        free: [...i.free.heap].slice(0, i.free.length),
        order: [...c.rkeys()],
      }).toEqual({ keyList: row.keyList, next: row.next, prev: row.prev, head: row.head, tail: row.tail, free: row.free, order: row.order });
    }
  });

  it('PREALLOC: пустой кеш на миллион держит 12 МБ типизированных массивов', () => {
    const i = internals(new LRUCache({ max: t.PREALLOC.max }));
    expect(i.next.constructor.name).toBe(t.PREALLOC.arrays);
    expect(i.next.byteLength + i.prev.byteLength + i.free.heap.byteLength).toBe(t.PREALLOC.typedBytes);
    expect(i.keyList.length).toBe(t.PREALLOC.max);
    expect(t.PREALLOC_NOTE).toContain('12 000 000 байт');
    // Пороги типа индексов из PREALLOC_NOTE.
    const kind = (max: number) => internals(new LRUCache({ max })).next.constructor.name;
    expect([kind(256), kind(257), kind(65536), kind(65537)]).toEqual(['Uint8Array', 'Uint16Array', 'Uint16Array', 'Uint32Array']);
  });

  it('TTL_CODE: протухшие занимают место, уходят как evict и как expire', () => {
    const code = t.TTL_CODE.replace(/^c\.size;/m, 'probe.size = c.size;')
      .replace(/^\[\.\.\.c\.keys\(\)\];/m, 'probe.keys = [...c.keys()];')
      .replace(/^c\.get\('b'\);/m, "probe.got = c.get('b');");
    const probe: Record<string, unknown> = {};
    const out = new Function('LRUCache', 'probe', `${code}\nreturn { log, size: c.size };`)(LRUCache, probe);
    expect(probe).toEqual({ size: t.TTL_RESULT.size, keys: t.TTL_RESULT.keys, got: undefined });
    expect(out.log).toEqual(t.TTL_RESULT.log);
    expect(out.size).toBe(t.TTL_RESULT.sizeAfter);
  });

  it('SIZE_CODE: тяжёлая запись вытесняет две лёгких, слишком тяжёлая не кладётся', () => {
    const code = t.SIZE_CODE.replace(/^\[\.\.\.c\.rkeys\(\)\];/m, 'probe.keys = [...c.rkeys()];').replace(
      /^c\.calculatedSize;/m,
      'probe.calculatedSize = c.calculatedSize;',
    );
    const probe: Record<string, unknown> = {};
    const c = new Function('LRUCache', 'probe', `${code}\nreturn c;`)(LRUCache, probe);
    expect(probe).toEqual({ keys: t.SIZE_RESULT.keys, calculatedSize: t.SIZE_RESULT.calculatedSize });
    expect(c.has('big')).toBe(t.SIZE_RESULT.hasBig);
    // «а если ключ уже был, старое значение удаляется»
    c.set('c', 'x'.repeat(11));
    expect(c.has('c')).toBe(false);
  });

  it('FETCH_CODE: два одновременных fetch — один запрос в сеть', async () => {
    let calls = 0;
    const fakeFetch = async (url: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return { json: async () => ({ url }) };
    };
    const body = t.FETCH_CODE.replace(/^import .*\n/m, '');
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const { a, b } = await new AsyncFunction('LRUCache', 'fetch', `${body}\nreturn { a, b };`)(LRUCache, fakeFetch);
    expect(calls).toBe(1);
    expect(a).toEqual({ url: '/api/users/42' });
    expect(b).toBe(a);
  });

  it('FETCH_FACTS: протухшее с allowStale отдаётся сразу, без него — ждём; удаление отменяет запрос', async () => {
    let now = 1;
    let calls = 0;
    const perf = { now: () => now };
    const fetchMethod = async (k: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return `${k}#${calls}`;
    };
    const stale = new LRUCache<string, string>({ max: 10, ttl: 100, ttlResolution: 0, perf, allowStale: true, fetchMethod });
    expect(await stale.fetch('u')).toBe('u#1');
    now += 500;
    expect(await stale.fetch('u')).toBe('u#1'); // старое — сразу
    await new Promise((r) => setTimeout(r, 20));
    expect(stale.get('u')).toBe('u#2'); // новое пришло в фоне

    const strict = new LRUCache<string, string>({ max: 10, ttl: 100, ttlResolution: 0, perf, fetchMethod });
    expect(await strict.fetch('v')).toBe('v#3');
    now += 500;
    expect(await strict.fetch('v')).toBe('v#4');

    const reasons: string[] = [];
    const slow = new LRUCache<string, string>({
      max: 1,
      fetchMethod: (_k, _s, { signal }) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            reasons.push((signal.reason as Error).message);
            resolve('отменён');
          });
        }),
    });
    void slow.fetch('a').catch(() => {});
    slow.delete('a');
    void slow.fetch('b').catch(() => {});
    void slow.fetch('c').catch(() => {}); // max: 1 — b вытеснена на лету
    expect(reasons).toEqual(['deleted', 'evicted']);
  });

  it('PITFALLS 02: часы на нуле делают запись вечной', () => {
    let now = 0;
    const c = new LRUCache<string, number>({ max: 10, ttl: 100, ttlResolution: 0, perf: { now: () => now } });
    c.set('a', 1);
    now = 10_000;
    expect(c.get('a')).toBe(1);
    expect(c.getRemainingTTL('a')).toBe(Infinity);
    now = 1;
    c.set('b', 1);
    now = 10_000;
    expect(c.get('b')).toBeUndefined();
  });

  it('PITFALLS 03: без ttlResolution: 0 свои часы в одной задаче стоят', async () => {
    let now = 1;
    const c = new LRUCache<string, number>({ max: 10, ttl: 100, perf: { now: () => now } });
    c.set('a', 1);
    c.get('a');
    now = 501; // +500 мс, срок 100
    expect(c.get('a')).toBe(1); // отдана протухшая — now запомнен
    await new Promise((r) => setTimeout(r, 5));
    expect(c.get('a')).toBeUndefined();
    expect(t.PITFALLS.find((p) => p.n === '03')?.d).toContain('на 500 мс');
  });
});

describe('reselect: SELECTOR_ROWS', () => {
  it('число пересчётов на f(1) f(2) f(3) f(1) f(2)', () => {
    const variants = [
      (f: (x: number) => unknown) => weakMapMemoize(f),
      (f: (x: number) => unknown) => weakMapMemoize(f, { maxSize: 2 }),
      (f: (x: number) => unknown) => lruMemoize(f),
      (f: (x: number) => unknown) => lruMemoize(f, { maxSize: 2 }),
    ];
    const counts = variants.map((make) => {
      let calls = 0;
      const m = make((x) => {
        calls++;
        return { x };
      });
      for (const x of t.SELECTOR_SEQ) m(x);
      return calls;
    });
    expect(counts).toEqual(t.SELECTOR_ROWS.map((r) => r.calls));
  });

  it('предупреждение после тысячи разных примитивов в одной позиции', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = weakMapMemoize((x: number) => ({ x }));
    for (let i = 0; i < 1000; i++) m(i); // ровно тысяча — молчит
    expect(warn).not.toHaveBeenCalled();
    m(1000); // тысяча первое значение
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.SELECTOR_NOTE).toContain('больше тысячи');
  });
});

describe('LFU_CODE', () => {
  it('жертва — самый редкий, среди равных — самый давно тронутый (сверка с перебором)', () => {
    const lfu = new api.LFU(12);
    const count = new Map<number, number>();
    const touched = new Map<number, number>();
    const trace = api.makeTrace('zipf', { seed: 5, length: 6000, keys: 60, s: 0.7 });
    trace.forEach((k, tick) => {
      const before = new Set(lfu.values.keys());
      let expected: number | undefined;
      if (lfu.get(k) !== undefined) {
        count.set(k, count.get(k)! + 1);
      } else {
        if (before.size >= 12) {
          expected = [...before].sort((a, b) => count.get(a as number)! - count.get(b as number)! || touched.get(a as number)! - touched.get(b as number)!)[0] as number;
        }
        lfu.set(k, k);
        count.set(k, 1);
      }
      touched.set(k, tick);
      const gone = [...before].filter((q) => !lfu.values.has(q));
      expect(gone).toEqual(expected === undefined ? [] : [expected]);
      if (expected !== undefined) {
        count.delete(expected);
        touched.delete(expected);
      }
      expect([...lfu.counts]).toEqual(expect.arrayContaining([...count]));
      expect(lfu.minFreq).toBe(Math.min(...count.values()));
    });
  });

  it('SHIFT_HALVES: на смене горячего LFU держит старые ключи', () => {
    const trace = api.makeTrace('shift', { seed: 1 });
    const half = trace.length / 2;
    const rows = ALGOS.map((a) => {
      const c = makeCache(api, a.id, 100);
      let first = 0;
      let second = 0;
      trace.forEach((k, i) => {
        if (c.get(k) !== undefined) {
          if (i < half) first++;
          else second++;
        } else c.set(k, k);
      });
      const oldLeft = keysOf(a.id, c).filter((k) => (k as number) < 1000).length;
      return { k: a.label, first: +(first / half).toFixed(4), second: +(second / half).toFixed(4), oldLeft };
    });
    expect(rows).toEqual(t.SHIFT_HALVES);
    expect(t.AGING_NOTE).toContain(pct(t.SHIFT_HALVES[1].second));
    expect(t.AGING_NOTE).toContain(`${t.SHIFT_HALVES[1].oldLeft} из 100`);
    expect(t.TINYLFU_STEPS.at(-1)?.d).toContain(pct(t.SHIFT_HALVES[2].second));
  });
});

describe('SKETCH_CODE', () => {
  it('оценка никогда не меньше точного счёта (до потолка 15)', () => {
    const sketch = new api.CountMinSketch(256, Infinity);
    const exact = new Map<number, number>();
    for (const k of api.makeTrace('zipf', { seed: 2, length: 20000, keys: 2000 })) {
      sketch.increment(k);
      exact.set(k, (exact.get(k) ?? 0) + 1);
    }
    let over = 0;
    for (const [k, n] of exact) {
      const e = sketch.estimate(k);
      expect(e).toBeGreaterThanOrEqual(Math.min(n, 15));
      if (e > Math.min(n, 15)) over++;
    }
    // на узком sketch столкновения есть — завышения встречаются, занижений нет
    expect(over).toBeGreaterThan(0);
  });

  it('после sampleSize добавлений все счётчики делятся пополам', () => {
    // Ключей много, счётчики далеко от потолка: каждое добавление засчитывается.
    const sketch = new api.CountMinSketch(256, 100);
    for (let i = 0; i < 99; i++) sketch.increment(i % 40);
    expect(sketch.additions).toBe(99);
    const before = sketch.rows.map((r) => [...r]);
    sketch.increment(0); // сотое добавление: 0 → +1, затем сброс
    const index = (k: unknown, r: number) => (sketch as unknown as { index(k: unknown, r: number): number }).index(k, r);
    sketch.rows.forEach((row, r) => {
      row.forEach((v, i) => {
        const was = before[r][i] + (i === index(0, r) ? 1 : 0);
        expect(v).toBe(was >> 1);
      });
    });
    expect(sketch.additions).toBe(50);
  });
});

describe('W-TinyLFU и SIEVE', () => {
  it('W-TinyLFU не выходит за max и держит доли частей', () => {
    const c = new api.WTinyLFU(100);
    expect([c.windowMax, c.mainMax, c.protectedMax]).toEqual([1, 99, 79]);
    for (const k of api.makeTrace('scan', { seed: 1 })) {
      if (c.get(k) === undefined) c.set(k, k);
      expect(c.window.size).toBeLessThanOrEqual(c.windowMax);
      expect(c.protected.size).toBeLessThanOrEqual(c.protectedMax);
      expect(c.window.size + c.probation.size + c.protected.size).toBeLessThanOrEqual(100);
    }
  });

  it('SIEVE: попадание ничего не двигает, только ставит бит', () => {
    const c = new api.Sieve(4);
    for (const k of ['A', 'B', 'C', 'D']) c.set(k, k);
    const order = (s: SieveCache) => {
      const out = [];
      for (let n = s.tail; n; n = n.prev) out.push(n.key);
      return out;
    };
    expect(order(c)).toEqual(['A', 'B', 'C', 'D']);
    c.get('A');
    c.get('C');
    expect(order(c)).toEqual(['A', 'B', 'C', 'D']);
    c.set('E', 'E'); // стрелка: A (бит снят) → B — жертва
    expect(order(c)).toEqual(['A', 'C', 'D', 'E']);
    expect(c.map.get('A')!.visited).toBe(false);
    expect(c.hand?.key).toBe('C'); // следующий обход — с соседа жертвы ближе к голове
  });
});

describe('трассы и закреплённые числа', () => {
  it('HIT_TABLE: доли попаданий всех политик на всех трассах', () => {
    for (const row of t.HIT_TABLE) {
      const r = curves(api, row.trace as 'zipf', row.cap);
      expect({ lru: r.lru.hitRate, lfu: r.lfu.hitRate, tinylfu: r.tinylfu.hitRate, sieve: r.sieve.hitRate }).toEqual({
        lru: expect.closeTo(row.lru, 4),
        lfu: expect.closeTo(row.lfu, 4),
        tinylfu: expect.closeTo(row.tinylfu, 4),
        sieve: expect.closeTo(row.sieve, 4),
      });
      expect(r.lru.curve).toHaveLength(40);
    }
  });

  it('числа в тексте взяты из HIT_TABLE', () => {
    const at = (trace: string, cap: number) => t.HIT_TABLE.find((r) => r.trace === trace && r.cap === cap)!;
    expect(at('loop', 100).lru).toBe(0);
    expect(at('loop', 100).sieve).toBe(0);
    expect(at('loop', 100).lfu).toBe(0);
    expect(t.LOOP_TINY_NOTE).toContain(pct(at('loop', 100).tinylfu));
    expect(t.LOOP_NOTE).toContain(pct(at('loop', 200).lru));
    // «от 8 до 12 пунктов» между LRU и лучшим из остальных на «Ципфе»
    const gaps = t.CHART_CAPACITIES.map((cap) => {
      const r = at('zipf', cap);
      return (Math.max(r.lfu, r.tinylfu, r.sieve) - r.lru) * 100;
    });
    expect(Math.min(...gaps)).toBeGreaterThan(7.5);
    expect(Math.max(...gaps)).toBeLessThan(12.5);
    // «LRU ни на одной трассе не обгоняет остальных»
    for (const r of t.HIT_TABLE) expect(r.lru).toBeLessThanOrEqual(Math.max(r.lfu, r.tinylfu, r.sieve));
  });

  it('SCAN_HOT: после скана LRU не держит ни одного горячего ключа, остальные держат', () => {
    const trace = api.makeTrace('scan', { seed: 1 });
    const rows = ALGOS.map((a) => {
      const c = makeCache(api, a.id, 100);
      let top = 0;
      let after = 0;
      trace.forEach((k, i) => {
        const hit = c.get(k) !== undefined;
        if (!hit) c.set(k, k);
        if (i === 3999) {
          const inside = new Set(keysOf(a.id, c));
          for (let j = 0; j < 20; j++) if (inside.has(j)) top++;
        }
        if (i >= 4000 && i < 4500 && hit) after++;
      });
      return { k: a.label, top, after };
    });
    expect(rows).toEqual(t.SCAN_HOT);
    // первый скан идёт с 2500 по 3999 запрос
    expect(trace.slice(2500, 4000).every((k) => k >= 1e6)).toBe(true);
    expect(trace[2499]).toBeLessThan(1000);
  });

  it('STEP_HITS и кадры пошагового режима', () => {
    for (const tr of t.STEP_TRACES) {
      const keys = tr.keys.split(' ');
      for (const a of ALGOS) {
        const frames = stepFrames(api, a.id, keys, t.STEP_CAPACITY);
        expect(frames.filter((f) => f.hit).length, `${tr.id}/${a.id}`).toBe(t.STEP_HITS[tr.id][a.id]);
        for (const f of frames) {
          const size = f.groups.reduce((n, g) => n + g.items.length, 0);
          expect(size).toBeLessThanOrEqual(t.STEP_CAPACITY);
        }
      }
    }
    // В «Скане» LRU выталкивает A на x3 и B на x4
    const lru = stepFrames(api, 'lru', t.STEP_TRACES[0].keys.split(' '), t.STEP_CAPACITY);
    expect(lru[8].gone).toEqual([{ key: 'A', why: 'evict' }]);
    expect(lru[9].gone).toEqual([{ key: 'B', why: 'evict' }]);
    // W-TinyLFU в «Цикле» отказывает новичку на входе
    const tiny = stepFrames(api, 'tinylfu', t.STEP_TRACES[1].keys.split(' '), t.STEP_CAPACITY);
    expect(tiny.some((f) => f.gone.some((g) => g.why === 'reject'))).toBe(true);
  });

  it('трасса воспроизводится по зерну и имеет заявленную форму', () => {
    expect(api.makeTrace('zipf', { seed: 1 })).toEqual(api.makeTrace('zipf', { seed: 1 }));
    expect(api.makeTrace('zipf', { seed: 1 })).not.toEqual(api.makeTrace('zipf', { seed: 2 }));
    const loop = api.makeTrace('loop');
    expect(loop.slice(0, 3)).toEqual([0, 1, 2]);
    expect(loop[120]).toBe(0);
    const shift = api.makeTrace('shift');
    expect(shift.slice(0, 10000).every((k) => k < 1000)).toBe(true);
    expect(shift.slice(10000).every((k) => k >= 1000)).toBe(true);
  });

  it('каждый класс из темы собирается и считает через общий интерфейс', () => {
    const ids: AlgoId[] = ['lru', 'lfu', 'tinylfu', 'sieve'];
    for (const id of ids) {
      const c = makeCache(api, id, 3);
      c.set('a', 1);
      expect(c.get('a')).toBe(1);
      expect(c.get('zzz')).toBeUndefined();
    }
    const lfu = makeCache(api, 'lfu', 2) as LfuCache;
    lfu.set('a', 1);
    expect(lfu.counts.get('a')).toBe(1);
    const tiny = makeCache(api, 'tinylfu', 2) as TinyLfuCache;
    tiny.get('q');
    expect(tiny.sketch.estimate('q')).toBe(1);
  });
});
