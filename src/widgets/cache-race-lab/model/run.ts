import type {
  CacheLike,
  CacheModel,
  Client,
  EvictionRun,
  HerdParams,
  HerdPattern,
  HerdResult,
  MiniRedis,
  RaceResult,
  RaceScenario,
  Row,
  Strategy,
} from './types';

/**
 * Демо и тест исполняют одну и ту же модель — строки из темы «Кеш перед базой»
 * (`REDIS_CODE`, `DB_CODE`, `SCHEDULE_CODE`, `CLIENT_CODE`, `FIX_CODE`, `HERD_CODE`, `SIM_CODE`,
 * `EVICT_CODE`, `WORKLOAD_CODE`), склеенные и собранные `new Function`. Те же строки напечатаны
 * на странице, а `tests/unit/redis-cache.test.ts` сверяет ответы модели с журналами настоящего
 * Redis 7.4 (литералы `STAND_*` в `data.ts`) и с аналитикой.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
const EXPORTS = [
  'createRedis',
  'createDb',
  'runSchedule',
  'simulate',
  'createStore',
  'workload',
  'readUser',
  'renameUser',
  'renameUserDelFirst',
  'readUserLease',
  'renameUserLease',
  'readUserVersioned',
  'renameUserVersioned',
  'renameUserTwice',
  'plain',
  'withLock',
  'xfetch',
  'staleWhileRevalidate',
];

export function loadModel(parts: string[]): CacheModel {
  return new Function(`${parts.join('\n\n')}\nreturn { ${EXPORTS.join(', ')} };`)() as CacheModel;
}

/** Детерминированное «случайное» число из [0, 1): одно зерно — одна и та же последовательность. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** XFetch берёт логарифм случайного числа, поэтому ноль отдавать нельзя: (0, 1]. */
export const openUnit = (rnd: () => number) => () => 1 - rnd();

/** Буквы порядка без пробелов: столько шагов у сценария. */
export const stepsOf = (order: string) => order.replace(/\s+/g, '');

const makeClient = (model: CacheModel, [fn, ...args]: [string, ...(string | number)[]]) =>
  (model[fn] as (...a: unknown[]) => Client)(...args);

/**
 * Прогон сценария гонки до шага `upto` (все шаги по умолчанию). Кеш — учебный Redis
 * или переданный снаружи (тест подставляет настоящий через ioredis).
 */
export async function runRace(
  model: CacheModel,
  sc: RaceScenario,
  rows: Row[],
  upto = Infinity,
  cache: CacheLike = model.createRedis(),
): Promise<RaceResult & { db: ReturnType<ReturnType<CacheModel['createDb']>['snapshot']> }> {
  const db = model.createDb(structuredClone(rows), { replica: sc.replica });
  const clients = Object.fromEntries(Object.entries(sc.clients).map(([name, spec]) => [name, makeClient(model, spec)]));
  const order = stepsOf(sc.order).slice(0, upto);
  const log = await model.runSchedule({ cache, db, clients, order });
  const snap = db.snapshot();
  const cached = (await cache.call('GET', `user:${rows[0].id}`)) as string | null;
  const p = snap.primary[0];
  return { log, cached, primary: `${p.v}:${p.name}`, db: snap };
}

/** Генератор читателя для стратегии защиты от толпы. Имя клиента — его токен замка. */
export function herdClient(model: CacheModel, strategy: Strategy, i: number, beta: number, random: () => number): Client {
  const key = 'news';
  if (strategy === 'plain') return (model.plain as (k: string) => Client)(key);
  if (strategy === 'lock') return (model.withLock as (k: string, me: string) => Client)(key, `c${i}`);
  if (strategy === 'xfetch') return (model.xfetch as (k: string, b: number, r: () => number) => Client)(key, beta, random);
  return (model.staleWhileRevalidate as (k: string, me: string) => Client)(key, `c${i}`);
}

/**
 * С чего начинается прогон: какая запись лежит в кеше. Для потока ключ истекает
 * в `expiryMs`; у XFetch рядом записаны `delta` и `expiry`, у мягкого срока — `soft`.
 */
export function herdSetup(strategy: Strategy, pattern: HerdPattern, p: HerdParams): unknown[] | null {
  if (pattern === 'miss') return null;
  if (pattern === 'stale') {
    return strategy === 'swr' ? ['SET', 'news', JSON.stringify({ value: 'v0', soft: -1 }), 'PX', 60_000] : null;
  }
  if (strategy === 'xfetch') {
    return ['SET', 'news', JSON.stringify({ value: 'v0', delta: p.dbMs, expiry: p.expiryMs }), 'PX', p.expiryMs];
  }
  if (strategy === 'swr') return ['SET', 'news', JSON.stringify({ value: 'v0', soft: p.expiryMs }), 'PX', 60_000];
  return ['SET', 'news', 'v0', 'PX', p.expiryMs];
}

/** Когда приходят читатели: все разом или поток через момент истечения. */
export function arrivals(pattern: HerdPattern, p: HerdParams): number[] {
  if (pattern !== 'stream') return Array.from({ length: p.n }, () => 0);
  return Array.from({ length: p.streamN }, (_, k) => p.offsetMs + p.intervalMs * k);
}

/** Прогон защиты от толпы в виртуальном времени учебной модели. */
export async function runHerd(model: CacheModel, strategy: Strategy, pattern: HerdPattern, p: HerdParams, seed = 1): Promise<HerdResult> {
  const clock = { now: 0 };
  const cache: MiniRedis = model.createRedis(() => clock.now);
  const setup = herdSetup(strategy, pattern, p);
  if (setup) cache.call(...(setup as [string, ...unknown[]]));
  const random = openUnit(mulberry32(seed));
  const clients = arrivals(pattern, p).map((at, i) => ({ at, gen: herdClient(model, strategy, i, p.beta, random) }));
  return model.simulate({ cache, clock, clients, dbMs: p.dbMs });
}

/**
 * Ожидаемое число походов в базу у XFetch на потоке — без прогона. Читатель i пересчитывает
 * с вероятностью p_i = exp(−(expiry − t_i) / (β·Δ)) (после истечения — 1), но только если ни один
 * пересчёт, начатый раньше t_i − Δ, ещё не положил свежее значение.
 */
export function xfetchExpected(p: HerdParams): number {
  const ts = arrivals('stream', p);
  const prob = ts.map((t) => (t >= p.expiryMs ? 1 : Math.exp(-(p.expiryMs - t) / (p.beta * p.dbMs))));
  return ts.reduce((sum, t, i) => {
    let none = 1;
    ts.forEach((tj, j) => {
      if (tj + p.dbMs < t) none *= 1 - prob[j];
    });
    return sum + prob[i] * none;
  }, 0);
}

/**
 * Сколько читателей потока идут в базу без защиты: все, кто пришёл после истечения и не позже,
 * чем первый промах вернулся из базы. Читатель, пришедший ровно в момент возврата, значение ещё
 * не видит — тот же порядок, что и в `xfetchExpected`.
 */
export function plainExpected(p: HerdParams): number {
  const ts = arrivals('stream', p).filter((t) => t >= p.expiryMs);
  return ts.filter((t) => t <= ts[0] + p.dbMs).length;
}

/** Нагрузка стенда на учебном вытеснении: сколько ключей каждой группы осталось. */
export function runEviction(model: CacheModel, policy: string, samples: number, seed: number, capacity: number): EvictionRun {
  const store = model.createStore({ capacity, policy, samples, random: mulberry32(seed) });
  let writes = 0;
  let fails = 0;
  let firstFail: number | null = null;
  const all: string[] = [];
  for (const [op, key, ttl] of model.workload()) {
    if (op === 'tick') store.tick(Number(key));
    else if (op === 'get') store.get(String(key));
    else {
      writes++;
      all.push(String(key));
      try {
        store.set(String(key), ttl ?? null);
      } catch {
        fails++;
        firstFail ??= writes;
      }
    }
  }
  const kept = new Set(store.keys());
  const count = (prefix: string) => [...kept].filter((k) => k.startsWith(prefix)).length;
  return { s: count('s:'), h: count('h:'), c: count('c:'), evicted: store.evicted(), fails, firstFail, kept, all };
}

/** Ответ Redis так, как его печатает redis-cli, — тем же видом, что в журнале планировщика. */
export function showReply(reply: unknown): string {
  if (reply === null) return '(nil)';
  if (typeof reply === 'number') return `(integer) ${reply}`;
  return reply === 'OK' ? 'OK' : `"${String(reply)}"`;
}
