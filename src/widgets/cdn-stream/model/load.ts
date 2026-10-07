/**
 * Демо и тест спрашивают один и тот же код — строки из `data.ts` темы «CDN и серверный кеш».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/cdn-cache.test.ts`: там же прослойка поднимается на `node:http` против своего
 * origin. Копии нет — если напечатанный код разойдётся с тем, что утверждает тема, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

export interface HttpRequest {
  method: string;
  url: string;
  /** Имена заголовков — в нижнем регистре, как их отдаёт `node:http`. */
  headers: Record<string, string | undefined>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface CacheOptions {
  /** Часы кеша в секундах. В демо и тесте — виртуальные. */
  now: () => number;
  fetchOrigin: (req: HttpRequest) => Promise<HttpResponse>;
  coalesce?: boolean;
  normalize?: (url: string) => string;
  /** Имя кеша в `Cache-Status`. */
  name?: string;
}

export interface SharedCache {
  handle: (req: HttpRequest) => Promise<HttpResponse>;
  purgeTag: (tag: string) => number;
  purgeUrl: (url: string) => number;
}

export interface CacheApi {
  directives: (value: string | undefined) => Record<string, string | true>;
  whyNotStore: (req: HttpRequest, res: HttpResponse) => string | null;
  lifetime: (res: HttpResponse) => number;
  staleForbidden: (res: HttpResponse) => boolean;
  createCache: (options: CacheOptions) => SharedCache;
}

/** Правила хранения (`RULES_CODE`) и сам кеш (`CACHE_CODE`) — две строки темы, одним модулем. */
export function loadCache(rules: string, cache: string): CacheApi {
  return new Function(
    `${rules}\n${cache}\nreturn { directives, whyNotStore, lifetime, staleForbidden, createCache };`,
  )() as CacheApi;
}

export function loadNormalize(code: string): (url: string) => string {
  return new Function(`${code}\nreturn normalize;`)() as (url: string) => string;
}

export type ShouldRecompute = (
  now: number,
  expiry: number,
  delta: number,
  beta?: number,
  random?: () => number,
) => boolean;

export function loadXfetch(code: string): ShouldRecompute {
  return new Function(`${code}\nreturn shouldRecompute;`)() as ShouldRecompute;
}

export interface Lru<V = unknown> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  readonly map: Map<string, V>;
}

export function loadLru(code: string): new (limit: number) => Lru {
  return new Function(`${code}\nreturn LRU;`)() as new (limit: number) => Lru;
}

/** Детерминированный генератор: одинаковое зерно — одинаковая последовательность. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
