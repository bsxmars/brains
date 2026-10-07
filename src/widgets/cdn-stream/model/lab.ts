import { mulberry32, type CacheApi, type HttpRequest, type HttpResponse, type Lru, type ShouldRecompute } from './load';

/**
 * Вычисления для таблиц темы «CDN и серверный кеш».
 *
 * Таблицы на странице — литералы в `data.ts`, а эти функции их пересчитывают: тест сверяет
 * одно с другим (`tests/unit/cdn-cache.test.ts`). Каждая функция зовёт код, напечатанный
 * в теме, а не свою копию: правила хранения — `whyNotStore` и `lifetime` из `RULES_CODE`,
 * вытеснение — `LRU` из `LRU_CODE`, ранний пересчёт — `shouldRecompute` из `XFETCH_CODE`.
 *
 * Случайность — `mulberry32` с зерном, время — виртуальное: одинаковые входы дают одинаковые
 * числа на любой машине. Ни DOM, ни Vue.
 */

// ─── Кто вправе хранить ──────────────────────────────────────────────────────────────────

export interface StoreCase {
  /** Что в запросе: метод и заголовки, если есть. */
  req: { method?: string; headers?: Record<string, string> };
  res: { status?: number; headers: Record<string, string> };
}

export interface StoreVerdict {
  store: boolean;
  /** Сколько секунд ответ свеж; `null` — хранить нельзя. */
  fresh: number | null;
  why: string | null;
}

/** Имена заголовков в таблице набраны как в HTTP (`Cache-Control`), а кеш ждёт нижний регистр. */
const lower = (headers: Record<string, string> = {}) =>
  Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

export function storeVerdict(api: CacheApi, c: StoreCase): StoreVerdict {
  const req: HttpRequest = { method: c.req.method ?? 'GET', url: '/', headers: lower(c.req.headers) };
  const res: HttpResponse = { status: c.res.status ?? 200, headers: lower(c.res.headers), body: '' };
  const why = api.whyNotStore(req, res);
  return { store: why === null, fresh: why === null ? api.lifetime(res) : null, why };
}

// ─── Доля попаданий: длинный хвост и Vary ────────────────────────────────────────────────

export interface HitInput {
  /** Сколько разных адресов. */
  urls: number;
  /** Показатель Ципфа: чем меньше, тем длиннее хвост редких адресов. */
  s: number;
  /** Сколько записей помещается в кеш. */
  capacity: number;
  requests: number;
  /** Сколько вариантов у каждого адреса (`Vary` по заголовку с таким числом значений). */
  variants?: number;
  seed: number;
}

export function hitRatio(LRU: new (limit: number) => Lru, input: HitInput): number {
  const { urls, s, capacity, requests, variants = 1 } = input;
  const cdf = new Float64Array(urls);
  let sum = 0;
  for (let k = 0; k < urls; k++) cdf[k] = sum += 1 / Math.pow(k + 1, s);

  const random = mulberry32(input.seed);
  const pick = () => {
    const x = random() * sum;
    let lo = 0;
    let hi = urls - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const cache = new LRU(capacity);
  let hits = 0;
  for (let r = 0; r < requests; r++) {
    const url = pick();
    const variant = variants > 1 ? Math.floor(random() * variants) : 0;
    const key = `${url}|${variant}`;
    if (cache.get(key) !== undefined) hits++;
    else cache.set(key, 1);
  }
  return hits / requests;
}

// ─── XFetch ──────────────────────────────────────────────────────────────────────────────

/**
 * Доля читателей, которые решат пересчитать за `gap` дельт до истечения, — по той же функции,
 * что напечатана в теме, на `samples` бросках. Аналитически это `exp(−gap / beta)`.
 */
export function xfetchShare(should: ShouldRecompute, gap: number, beta: number, samples: number, seed: number): number {
  const random = mulberry32(seed);
  const delta = 1000;
  let yes = 0;
  for (let i = 0; i < samples; i++) if (should(0, gap * delta, delta, beta, random)) yes++;
  return yes / samples;
}

export interface StormInput {
  /** Срок жизни значения, мс. */
  ttl: number;
  /** Сколько длится пересчёт, мс. */
  delta: number;
  /** Интервал между чтениями, мс. */
  gap: number;
  beta: number;
  seed: number;
}

export interface StormResult {
  /** Сколько пересчётов запустилось за один цикл истечения. */
  recomputes: number;
  /** Сколько чтений застало значение истёкшим и ждало пересчёта. */
  waited: number;
}

/**
 * Один цикл истечения ключа под постоянным чтением. Блокировки нет ни в одной стратегии:
 * `null` — пересчёт только по факту истечения, функция — XFetch перед каждым чтением.
 */
export function expiryStorm(should: ShouldRecompute | null, input: StormInput): StormResult {
  const { ttl, delta, gap, beta } = input;
  const random = mulberry32(input.seed);
  let expiry = ttl;
  const running: number[] = [];
  let recomputes = 0;
  let waited = 0;

  for (let t = 0; t < ttl + delta; t += gap) {
    while (running.length && running[0] <= t) expiry = Math.max(expiry, running.shift()! + ttl);
    const expired = t >= expiry;
    if (expired) waited++;
    if (expired || (should && should(t, expiry, delta, beta, random))) {
      recomputes++;
      running.push(t + delta);
    }
  }
  return { recomputes, waited };
}

// ─── TTL с джиттером ─────────────────────────────────────────────────────────────────────

export type TtlWithJitter = (ttl: number, spread?: number, random?: () => number) => number;

/** Больше всего ключей, истекающих в одну секунду, если `keys` ключей прогрели разом. */
export function expiryPeak(jitter: TtlWithJitter | null, keys: number, ttl: number, spread: number, seed: number): number {
  const random = mulberry32(seed);
  const perSecond = new Map<number, number>();
  for (let k = 0; k < keys; k++) {
    const t = jitter ? jitter(ttl, spread, random) : ttl;
    perSecond.set(t, (perSecond.get(t) ?? 0) + 1);
  }
  return Math.max(...perSecond.values());
}

// ─── Гонка cache-aside ───────────────────────────────────────────────────────────────────

export interface AsideDeps {
  db: { read(id: number): Promise<string>; write(id: number, patch: { name: string }): Promise<void> };
  cache: {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string, ttl: number): Promise<void>;
    del(key: string): Promise<void>;
  };
  ttl: number;
}

export interface AsideApi {
  getUser(id: number, deps: AsideDeps): Promise<string>;
  renameUser(id: number, name: string, deps: AsideDeps): Promise<void>;
  ttlWithJitter: TtlWithJitter;
}

export function loadAside(code: string): AsideApi {
  return new Function(`${code}\nreturn { getUser, renameUser, ttlWithJitter };`)() as AsideApi;
}

export interface RaceResult {
  /** Что в базе после всех шагов. */
  db: string;
  /** Что в кеше. */
  cached: string | undefined;
  /** Что получил читатель, пришедший последним. */
  lateReader: string;
  /** Порядок операций, как он случился. */
  log: string[];
}

/**
 * Читатель промахнулся и прочитал базу, но записать в кеш не успел; в это время писатель
 * обновил базу и удалил ключ; потом читатель всё-таки записал — старое. Порядок задан
 * воротами, а не таймерами: запись читателя ждёт, пока писатель закончит.
 */
export async function raceAside(api: AsideApi): Promise<RaceResult> {
  const log: string[] = [];
  let row = 'Анна';
  const store = new Map<string, string>();
  let openGate!: () => void;
  const gate = new Promise<void>((resolve) => (openGate = resolve));
  let slowWriter = true;

  const deps: AsideDeps = {
    ttl: 3600,
    db: {
      async read() {
        log.push(`читатель: база → ${row}`);
        return row;
      },
      async write(_id, patch) {
        row = patch.name;
        log.push(`писатель: база ← ${row}`);
      },
    },
    cache: {
      async get(key) {
        const value = store.get(key);
        log.push(`get ${key} → ${value ?? 'промах'}`);
        return value;
      },
      async set(key, value) {
        if (slowWriter) {
          slowWriter = false;
          await gate; // первый читатель задержался — GC, сеть, что угодно
        }
        store.set(key, value);
        log.push(`читатель: кеш ← ${value}`);
      },
      async del(key) {
        store.delete(key);
        log.push(`писатель: del ${key}`);
      },
    },
  };

  const reader = api.getUser(1, deps);
  for (let i = 0; i < 16; i++) await null; // читатель дошёл до записи в кеш и встал
  await api.renameUser(1, 'Мария', deps);
  openGate();
  await reader;
  const lateReader = await api.getUser(1, deps);
  return { db: row, cached: store.get('user:1'), lateReader, log };
}

// ─── Многоуровневый кеш: PoP → щит → origin ──────────────────────────────────────────────

export interface TierRow {
  t: number;
  pop: string;
  age: string;
  cacheStatus: string;
}

/**
 * Два PoP ходят к origin не сами, а через щит — такой же кеш уровнем выше. Щит видит один
 * промах там, где без него было бы по промаху на каждый PoP, а `Age` щита доезжает до PoP
 * и съедает его срок: копия не становится свежее оттого, что её переложили.
 */
export async function tierLog(api: CacheApi): Promise<{ rows: TierRow[]; origin: number }> {
  let clock = 0;
  let origin = 0;
  const now = () => clock;
  const shield = api.createCache({
    now,
    name: 'shield',
    fetchOrigin: async (req) => {
      origin++;
      const headers = { 'cache-control': 'public, max-age=60', etag: '"v1"' };
      return req.headers['if-none-match'] === '"v1"'
        ? { status: 304, headers, body: '' }
        : { status: 200, headers, body: 'v1' };
    },
  });
  const pops: Record<string, ReturnType<CacheApi['createCache']>> = {
    Франкфурт: api.createCache({ now, name: 'fra', fetchOrigin: (req) => shield.handle(req) }),
    Варшава: api.createCache({ now, name: 'waw', fetchOrigin: (req) => shield.handle(req) }),
  };

  const rows: TierRow[] = [];
  const plan: [number, string][] = [
    [0, 'Франкфурт'],
    [30, 'Варшава'],
    [45, 'Варшава'],
    [61, 'Варшава'],
    [62, 'Франкфурт'],
  ];
  for (const [t, pop] of plan) {
    clock = t;
    const res = await pops[pop].handle({ method: 'GET', url: '/app.css', headers: {} });
    rows.push({ t, pop, age: res.headers.age ?? '—', cacheStatus: res.headers['cache-status'] ?? '' });
  }
  return { rows, origin };
}
