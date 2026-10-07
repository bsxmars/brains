import type {
  AlgoId,
  Cache,
  EvictionApi,
  EvictionCodes,
  Frame,
  LfuCache,
  LruCache,
  SieveCache,
  SimResult,
  SnapGroup,
  TinyLfuCache,
  TraceKind,
} from './types';

/**
 * Демо и тест спрашивают одни и те же кеши — строки `LRU_CODE`, `LFU_CODE`, `SKETCH_CODE`,
 * `TINYLFU_CODE`, `SIEVE_CODE` и `TRACE_CODE` из темы, собранные здесь `new Function`.
 *
 * Те же строки напечатаны на странице и прогоняются `tests/unit/eviction.test.ts`: учебный LRU
 * сверяется с `lru-cache` по каждому вытеснению, остальные — по свойствам и закреплённым долям
 * попаданий. Копии кода нет: разойдётся показанное с проверенным — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadEviction(codes: EvictionCodes): EvictionApi {
  return new Function(
    `${codes.lru}\n${codes.lfu}\n${codes.sketch}\n${codes.tinylfu}\n${codes.sieve}\n${codes.trace}\n` +
      'return { LRU, LFU, CountMinSketch, WTinyLFU, Sieve, mulberry32, zipf, makeTrace, simulate };',
  )() as EvictionApi;
}

export const ALGOS: { id: AlgoId; label: string }[] = [
  { id: 'lru', label: 'LRU' },
  { id: 'lfu', label: 'LFU' },
  { id: 'tinylfu', label: 'W-TinyLFU' },
  { id: 'sieve', label: 'SIEVE' },
];

export function makeCache(api: EvictionApi, id: AlgoId, max: number): Cache {
  if (id === 'lru') return new api.LRU(max);
  if (id === 'lfu') return new api.LFU(max);
  if (id === 'tinylfu') return new api.WTinyLFU(max);
  return new api.Sieve(max);
}

/** Все ключи, которые сейчас лежат в кеше, — читаются из полей учебных классов. */
export function keysOf(id: AlgoId, cache: Cache): unknown[] {
  if (id === 'lru') return [...(cache as LruCache).map.keys()];
  if (id === 'lfu') return [...(cache as LfuCache).values.keys()];
  if (id === 'sieve') return [...(cache as SieveCache).map.keys()];
  const t = cache as TinyLfuCache;
  return [...t.window.keys(), ...t.probation.keys(), ...t.protected.keys()];
}

/** Снимок содержимого: как его разложил бы на бумаге тот, кто читает код класса. */
export function snapshot(id: AlgoId, cache: Cache): SnapGroup[] {
  if (id === 'lru') {
    return [{ label: 'от давнего к свежему', items: [...(cache as LruCache).map.keys()].map((k) => ({ key: String(k) })) }];
  }
  if (id === 'lfu') {
    const c = cache as LfuCache;
    return [...c.buckets.keys()]
      .sort((a, b) => a - b)
      .map((f) => ({ label: `частота ${f}`, items: [...c.buckets.get(f)!.keys].map((k) => ({ key: String(k) })) }));
  }
  if (id === 'tinylfu') {
    const c = cache as TinyLfuCache;
    const part = (label: string, m: Map<unknown, unknown>) => ({
      label,
      items: [...m.keys()].map((k) => ({ key: String(k), badge: `≈${c.sketch.estimate(k)}` })),
    });
    return [part('окно', c.window), part('испытание', c.probation), part('защищённые', c.protected)];
  }
  const c = cache as SieveCache;
  const items = [];
  for (let n = c.tail; n; n = n.prev) {
    items.push({ key: String(n.key), badge: n.visited ? '✓' : undefined, hand: n === c.hand });
  }
  return [{ label: 'от хвоста (старые) к голове (новые)', items }];
}

/** Пошаговый прогон: кадр после каждого запроса — попал ли он, кто ушёл и что осталось. */
export function stepFrames(api: EvictionApi, id: AlgoId, keys: string[], max: number): Frame[] {
  const cache = makeCache(api, id, max);
  return keys.map((key) => {
    const before = new Set(keysOf(id, cache));
    const inWindow = id === 'tinylfu' ? new Set((cache as TinyLfuCache).window.keys()) : new Set();
    const hit = cache.get(key) !== undefined;
    if (!hit) cache.set(key, key);
    const after = new Set(keysOf(id, cache));
    const gone = [...before]
      .filter((k) => !after.has(k))
      .map((k) => ({ key: String(k), why: inWindow.has(k) ? ('reject' as const) : ('evict' as const) }));
    return { key, hit, gone, groups: snapshot(id, cache) };
  });
}

/** Доли попаданий четырёх кешей на одной трассе. */
export function curves(api: EvictionApi, kind: TraceKind, max: number, seed = 1): Record<AlgoId, SimResult> {
  const trace = api.makeTrace(kind, { seed });
  const out = {} as Record<AlgoId, SimResult>;
  for (const a of ALGOS) out[a.id] = api.simulate(makeCache(api, a.id, max), trace);
  return out;
}
