import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/cdn-cache/data';
import {
  loadCache,
  loadLru,
  loadNormalize,
  loadXfetch,
  type HttpRequest,
  type HttpResponse,
  type SharedCache,
} from '@/widgets/cdn-stream/model/load';
import {
  expiryPeak,
  expiryStorm,
  hitRatio,
  loadAside,
  raceAside,
  storeVerdict,
  tierLog,
  xfetchShare,
} from '@/widgets/cdn-stream/model/lab';
import { runStream, type StreamInput } from '@/widgets/cdn-stream/model/stream';

/**
 * Тема «CDN и серверный кеш».
 *
 * Весь код, который тема печатает, исполняется здесь — именно он, а не копия:
 *  1. прослойка (`RULES_CODE` + `CACHE_CODE` + `PROXY_CODE`) поднимается на `node:http`
 *     перед своим origin на локальной петле; тест считает запросы, дошедшие до origin,
 *     и читает `Age` и `Cache-Status`. Время — виртуальные часы, одновременность — ворота
 *     на промисах: ни одного таймера и ни одного замера;
 *  2. литералы таблиц в `data.ts` пересчитываются теми же функциями, что напечатаны в теме;
 *  3. числа демо, на которые опирается текст, пересчитываются тем же `runStream`, что крутит демо.
 */

const api = loadCache(t.RULES_CODE, t.CACHE_CODE);

interface ProxyKit {
  listen: (h: typeof http, cache: SharedCache) => http.Server;
  originFetch: (h: typeof http, base: string) => (req: HttpRequest) => Promise<HttpResponse>;
}
const proxyKit = new Function(`${t.PROXY_CODE}\nreturn { listen, originFetch };`)() as ProxyKit;

// ─── Стенд: origin + прослойка ───────────────────────────────────────────────────────────

type Handler = (req: http.IncomingMessage) => { status?: number; headers: Record<string, string>; body?: string };

interface Stand {
  /** Сколько запросов дошло до origin. */
  hits: () => number;
  /** Заголовки запросов, дошедших до origin. */
  seen: http.IncomingHttpHeaders[];
  get: (path: string, headers?: Record<string, string>, method?: string) => Promise<{ status: number; headers: Headers; body: string }>;
  purge: (tag: string) => Promise<number>;
  clock: { t: number };
  /** Задержать ответы origin, пока ворота не открыты. */
  hold: () => () => void;
  close: () => Promise<void>;
}

const stands: Stand[] = [];

async function stand(handler: Handler, options: { coalesce?: boolean; normalize?: (url: string) => string } = {}): Promise<Stand> {
  let count = 0;
  const seen: http.IncomingHttpHeaders[] = [];
  let gate: Promise<void> | null = null;

  const origin = http.createServer(async (req, res) => {
    count++;
    seen.push(req.headers);
    const out = handler(req); // ответ собран в момент прихода, а в пути может задержаться
    if (gate) await gate;
    res.writeHead(out.status ?? 200, out.headers).end(out.body ?? '');
  });
  await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r));

  const clock = { t: 0 };
  const cache = api.createCache({
    now: () => clock.t,
    fetchOrigin: proxyKit.originFetch(http, `http://127.0.0.1:${(origin.address() as AddressInfo).port}`),
    coalesce: options.coalesce ?? true,
    normalize: options.normalize,
    name: 'edge',
  });
  const proxy = proxyKit.listen(http, cache);
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

  const s: Stand = {
    hits: () => count,
    seen,
    clock,
    async get(path, headers = {}, method = 'GET') {
      const r = await fetch(base + path, { method, headers });
      return { status: r.status, headers: r.headers, body: await r.text() };
    },
    async purge(tag) {
      const r = await fetch(`${base}/`, { method: 'PURGE', headers: { 'surrogate-key': tag } });
      return ((await r.json()) as { purged: number }).purged;
    },
    hold() {
      let open!: () => void;
      gate = new Promise((r) => (open = r));
      return () => {
        gate = null;
        open();
      };
    },
    async close() {
      proxy.closeAllConnections();
      origin.closeAllConnections();
      await Promise.all([new Promise((r) => proxy.close(r)), new Promise((r) => origin.close(r))]);
    },
  };
  stands.push(s);
  return s;
}

afterAll(async () => {
  await Promise.all(stands.map((s) => s.close()));
});

/** Ждать без таймеров: крутить цикл событий, пока условие не выполнится, но не бесконечно. */
async function until(what: string, cond: () => boolean): Promise<void> {
  for (let i = 0; i < 5000; i++) {
    if (cond()) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error(`не дождались: ${what}`);
}

const news = (version = 'v1', extra: Record<string, string> = {}): Handler => (req) => {
  const etag = `"${version}"`;
  const headers = { 'cache-control': 'public, max-age=10', etag, 'surrogate-key': 'news', ...extra };
  if (req.headers['if-none-match'] === etag) return { status: 304, headers };
  return { headers, body: `${version}:${req.url}` };
};

// ─── 1. Прослойка против настоящего origin ───────────────────────────────────────────────

describe('прослойка на node:http перед своим origin', () => {
  it('промах, попадание и Age: второй запрос до origin не доходит', async () => {
    const s = await stand(news());
    const first = await s.get('/a');
    expect(first.headers.get('cache-status')).toBe('edge; fwd=uri-miss; fwd-status=200; stored');
    expect(first.headers.get('age')).toBe('0');

    s.clock.t = 4;
    const second = await s.get('/a');
    expect(second.headers.get('cache-status')).toBe('edge; hit; ttl=6');
    expect(second.headers.get('age')).toBe('4');
    expect(second.body).toBe('v1:/a');
    expect(s.hits()).toBe(1);
  });

  it('s-maxage перекрывает max-age в общем кеше', async () => {
    const s = await stand(() => ({ headers: { 'cache-control': 'max-age=5, s-maxage=60' }, body: 'x' }));
    await s.get('/a');
    s.clock.t = 30;
    expect((await s.get('/a')).headers.get('cache-status')).toBe('edge; hit; ttl=30');
    expect(s.hits()).toBe(1);
  });

  it('Vary: у каждого значения заголовка свой вариант, первый запрос варианта — vary-miss', async () => {
    const s = await stand(news('v1', { vary: 'Accept-Language' }));
    await s.get('/a', { 'accept-language': 'ru' });
    const en = await s.get('/a', { 'accept-language': 'en' });
    expect(en.headers.get('cache-status')).toBe('edge; fwd=vary-miss; fwd-status=200; stored');
    const ru = await s.get('/a', { 'accept-language': 'ru' });
    expect(ru.headers.get('cache-status')).toBe('edge; hit; ttl=10');
    expect(s.hits()).toBe(2);
  });

  it('устаревшая копия проверяется условным запросом, 304 продлевает её без тела', async () => {
    const s = await stand(news());
    await s.get('/a');
    s.clock.t = 12;
    const r = await s.get('/a');
    expect(s.seen[1]['if-none-match']).toBe('"v1"');
    expect(r.headers.get('cache-status')).toBe('edge; fwd=stale; fwd-status=304; stored');
    expect(r.body).toBe('v1:/a');
    expect(r.headers.get('age')).toBe('0');
  });

  it('no-cache хранится, но каждый запрос превращается в условный', async () => {
    const origin304 = await stand((req) =>
      req.headers['if-none-match'] === '"n"'
        ? { status: 304, headers: { 'cache-control': 'no-cache', etag: '"n"' } }
        : { headers: { 'cache-control': 'no-cache', etag: '"n"' }, body: 'n' },
    );
    for (let i = 0; i < 3; i++) await origin304.get('/a');
    expect(origin304.hits()).toBe(3);
    expect(origin304.seen.slice(1).every((h) => h['if-none-match'] === '"n"')).toBe(true);
    expect((await origin304.get('/a')).headers.get('cache-status')).toBe('edge; fwd=stale; fwd-status=304; stored');
  });

  it('no-store, private и Authorization без разрешения — до origin доходит каждый запрос', async () => {
    for (const [cc, auth] of [
      ['no-store', ''],
      ['private, max-age=60', ''],
      ['max-age=60', 'Bearer t'],
    ] as const) {
      const s = await stand(() => ({ headers: { 'cache-control': cc }, body: 'x' }));
      const headers: Record<string, string> = auth ? { authorization: auth } : {};
      await s.get('/a', headers);
      const r = await s.get('/a', headers);
      expect(s.hits(), cc).toBe(2);
      expect(r.headers.get('cache-status'), cc).toBe('edge; fwd=uri-miss; fwd-status=200');
    }
  });

  it('private="Set-Cookie": копия хранится, но без куки', async () => {
    const s = await stand(() => ({
      headers: { 'cache-control': 'private="Set-Cookie", max-age=60', 'set-cookie': 'sid=a1b2' },
      body: 'x',
    }));
    const first = await s.get('/a');
    expect(first.headers.get('set-cookie')).toBe('sid=a1b2');
    const second = await s.get('/a');
    expect(second.headers.get('cache-status')).toBe('edge; hit; ttl=60');
    expect(second.headers.get('set-cookie')).toBeNull();
  });

  it('stale-while-revalidate в CDN-Cache-Control: старое сразу, новое — в фоне', async () => {
    let version = 'v1';
    const s = await stand((req) => {
      const headers = { 'cdn-cache-control': 'max-age=10, stale-while-revalidate=20', etag: `"${version}"` };
      return req.headers['if-none-match'] === `"${version}"` ? { status: 304, headers } : { headers, body: version };
    });
    await s.get('/a');
    version = 'v2';
    s.clock.t = 15;
    const stale = await s.get('/a');
    expect(stale.body).toBe('v1');
    expect(stale.headers.get('cache-status')).toBe('edge; hit; ttl=-5; detail=stale-while-revalidate');
    await until('фоновое обновление дошло до origin', () => s.hits() === 2);
    // Ответ фонового похода ещё в пути: пока он не лёг, прослойка отдаёт старое и к origin не ходит.
    let fresh = await s.get('/a');
    for (let i = 0; i < 50 && fresh.body !== 'v2'; i++) fresh = await s.get('/a');
    expect(fresh.body).toBe('v2');
    expect(fresh.headers.get('cache-status')).toBe('edge; hit; ttl=10');
    expect(s.hits()).toBe(2);
  });

  it('та же пара рядом с s-maxage не действует: по букве RFC устаревшее — только после проверки', async () => {
    const s = await stand(news('v1', { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=20' }));
    await s.get('/a');
    s.clock.t = 15;
    const r = await s.get('/a');
    expect(r.headers.get('cache-status')).toBe('edge; fwd=stale; fwd-status=304; stored');
    expect(t.SMAXAGE_NOTE).toContain('§5.2.2.10');
  });

  it('stale-if-error прячет упавший origin, s-maxage — нет', async () => {
    for (const [policy, header, want] of [
      ['cdn', 'cdn-cache-control', 'edge; fwd=stale; fwd-status=503; detail=stale-if-error'],
      ['s-maxage', 'cache-control', 'edge; fwd=stale; fwd-status=503'],
    ] as const) {
      let down = false;
      const value = policy === 'cdn' ? 'max-age=10, stale-if-error=60' : 's-maxage=10, stale-if-error=60';
      const s = await stand(() => (down ? { status: 503, headers: {}, body: 'down' } : { headers: { [header]: value }, body: 'ok' }));
      await s.get('/a');
      down = true;
      s.clock.t = 30;
      const r = await s.get('/a');
      expect(r.headers.get('cache-status'), policy).toBe(want);
      expect(r.status, policy).toBe(policy === 'cdn' ? 200 : 503);
    }
  });

  it('коллапс: десять одновременных промахов — один поход к origin', async () => {
    for (const coalesce of [true, false]) {
      const s = await stand(news(), { coalesce });
      const open = s.hold();
      const all = Promise.all(Array.from({ length: 10 }, () => s.get('/hot')));
      await until('первый запрос дошёл до origin', () => s.hits() >= 1);
      if (coalesce) {
        // Дать остальным девяти дойти до прослойки и встать в ожидание.
        for (let i = 0; i < 200; i++) await new Promise((r) => setImmediate(r));
        expect(s.hits()).toBe(1);
      } else {
        await until('все десять дошли до origin', () => s.hits() === 10);
      }
      open();
      const res = await all;
      const statuses = res.map((r) => r.headers.get('cache-status'));
      if (coalesce) {
        expect(statuses.filter((x) => x === 'edge; fwd=uri-miss; fwd-status=200; stored')).toHaveLength(1);
        expect(statuses.filter((x) => x === 'edge; fwd=uri-miss; ttl=10; collapsed')).toHaveLength(9);
        expect(s.hits()).toBe(1);
      } else {
        expect(s.hits()).toBe(10);
      }
    }
  });

  it('purge по тегу снимает все записи с этим тегом', async () => {
    const s = await stand(news());
    await s.get('/a');
    await s.get('/b');
    expect(await s.purge('news')).toBe(2);
    expect((await s.get('/a')).headers.get('cache-status')).toBe('edge; fwd=uri-miss; fwd-status=200; stored');
    expect(s.hits()).toBe(3);
  });

  it('purge во время похода к origin: старая версия ложится в кеш после purge', async () => {
    let version = 'v1';
    const s = await stand((req) => news(version)(req));
    const open = s.hold();
    const inFlight = s.get('/a');
    await until('запрос дошёл до origin', () => s.hits() === 1);
    const answer = version; // origin уже прочитал версию, пока ответ в пути
    version = 'v2';
    expect(await s.purge('news')).toBe(0); // сбрасывать пока нечего
    open();
    expect((await inFlight).body).toBe(`${answer}:/a`);
    const after = await s.get('/a');
    expect(after.body).toBe('v1:/a');
    expect(after.headers.get('cache-status')).toBe('edge; hit; ttl=10');
    expect(t.PURGE_RACE_NOTE).toContain('после');
  });

  it('POST на адрес выбрасывает копию этого адреса (RFC 9111 §4.4)', async () => {
    const s = await stand(news());
    await s.get('/a');
    await s.get('/a', {}, 'POST');
    expect((await s.get('/a')).headers.get('cache-status')).toBe('edge; fwd=uri-miss; fwd-status=200; stored');
  });

  it('нормализация ключа: четыре записи одного адреса — один поход к origin', async () => {
    const normalize = loadNormalize(t.NORMALIZE_CODE);
    const raw = await stand(news());
    const normal = await stand(news(), { normalize });
    for (const url of t.KEY_URLS) {
      await raw.get(url);
      await normal.get(url);
    }
    expect({ raw: raw.hits(), normal: normal.hits() }).toEqual(t.KEY_ORIGIN);
    expect(t.KEY_ROWS.map((r) => r.url)).toEqual(t.KEY_URLS);
    for (const row of t.KEY_ROWS) {
      expect(`GET ${row.url}`).toBe(row.raw);
      expect(`GET ${normalize(row.url)}`).toBe(row.normal);
    }
  });
});

// ─── 2. Таблицы темы против функций, напечатанных в теме ─────────────────────────────────

describe('таблицы пересчитываются кодом темы', () => {
  it('можно ли хранить: STORE_CASES', () => {
    for (const c of t.STORE_CASES) {
      expect(storeVerdict(api, c), JSON.stringify(c.res.headers)).toEqual(c.expect);
    }
  });

  const LRU = loadLru(t.LRU_CODE);

  it('LRU вытесняет самый давний и освежает прочитанное', () => {
    const lru = new LRU(2);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect([...lru.map.keys()]).toEqual(['a', 'c']);
  });

  it('доля попаданий: HIT_ROWS', () => {
    for (const row of t.HIT_ROWS) {
      const got = hitRatio(LRU, { urls: 100_000, s: row.s, capacity: row.capacity, requests: 200_000, variants: row.variants, seed: 7 });
      expect(got, row.k).toBeCloseTo(row.hit, 4);
    }
  }, 60_000);

  const shouldRecompute = loadXfetch(t.XFETCH_CODE);

  it('XFetch: литерал = exp(−g/β) = доля бросков функции', () => {
    const pct = (x: number) => `${(x * 100).toFixed(1).replace('.', ',').replace(/,0$/, '')} %`;
    for (const row of t.XFETCH_ROWS) {
      for (const [beta, cell] of [
        [0.5, row.b05],
        [1, row.b1],
        [2, row.b2],
      ] as const) {
        const exact = Math.exp(-row.g / beta);
        expect(cell.replace(',0 %', ' %'), `${row.gap} β=${beta}`).toBe(pct(exact).replace(',0 %', ' %'));
        expect(xfetchShare(shouldRecompute, row.g, beta, 100_000, 3)).toBeCloseTo(exact, 2);
      }
    }
  });

  it('толпа при истечении: STORM_ROWS', () => {
    for (const row of t.STORM_ROWS) {
      const runs = Array.from({ length: 1000 }, (_, i) =>
        expiryStorm(row.beta === null ? null : shouldRecompute, { ttl: 60_000, delta: 2000, gap: 20, beta: row.beta ?? 1, seed: i + 1 }),
      );
      const counts = runs.map((r) => r.recomputes).sort((a, b) => a - b);
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      expect(mean.toFixed(1).replace('.', ',').replace(/,0$/, ''), row.k).toBe(row.mean);
      expect(counts[500], row.k).toBe(row.median);
      expect(counts[999], row.k).toBe(row.max);
      expect(runs.filter((r) => r.waited > 0).length, row.k).toBe(row.waitedCycles);
    }
  }, 60_000);

  const aside = loadAside(t.ASIDE_CODE);

  it('джиттер: JITTER_ROWS', () => {
    for (const row of t.JITTER_ROWS) {
      expect(expiryPeak(row.spread === null ? null : aside.ttlWithJitter, 10_000, 3600, row.spread ?? 0, 9), row.k).toBe(row.peak);
    }
    const spread = Array.from({ length: 1000 }, () => aside.ttlWithJitter(3600, 0.1));
    expect(Math.min(...spread)).toBeGreaterThanOrEqual(3240);
    expect(Math.max(...spread)).toBeLessThanOrEqual(3960);
  });

  it('гонка cache-aside: в базе новое, в кеше старое', async () => {
    const race = await raceAside(aside);
    expect(race.log).toEqual(t.RACE_LOG);
    expect({ db: race.db, cached: race.cached }).toEqual(t.RACE_RESULT);
    expect(race.lateReader).toBe(t.RACE_RESULT.cached);
  });

  it('PoP → щит → origin: TIER_LOG', async () => {
    const { rows, origin } = await tierLog(api);
    expect(rows).toEqual(t.TIER_LOG);
    expect(origin).toBe(t.TIER_ORIGIN);
  });
});

// ─── 3. Числа демо ───────────────────────────────────────────────────────────────────────

describe('демо: числа, на которые опирается текст', () => {
  const base: StreamInput = { ttl: 10, swr: 0, form: 's-maxage', coalesce: true, vary: 'none', purge: false };
  const run = (patch: Partial<StreamInput>) => runStream(api, { ...base, ...patch });
  const count = (rows: { outcome: string }[], o: string) => rows.filter((r) => r.outcome === o).length;

  beforeAll(() => {
    // Демо и тест собирают кеш из одних и тех же строк.
    expect(typeof api.createCache).toBe('function');
  });

  it('как демо открывается', async () => {
    const r = await run({});
    expect({ origin: r.calls.length, peak: r.peak, oldUntil: r.oldUntil }).toEqual(t.STREAM_NUMBERS.base);
    expect(r.rows).toHaveLength(240);
  });

  it('без коллапса — толпа на каждом истечении', async () => {
    const r = await run({ coalesce: false });
    expect({ origin: r.calls.length, peak: r.peak }).toEqual(t.STREAM_NUMBERS.noCoalesce);
  });

  it('stale-while-revalidate рядом с s-maxage не действует, в CDN-Cache-Control — действует', async () => {
    const a = await run({ swr: 20 });
    expect({ origin: a.calls.length, stale: count(a.rows, 'stale') }).toEqual(t.STREAM_NUMBERS.swrSmaxage);
    const b = await run({ swr: 20, form: 'cdn' });
    expect({ origin: b.calls.length, stale: count(b.rows, 'stale'), waits: b.rows.filter((x) => x.wait > 0).length }).toEqual(
      t.STREAM_NUMBERS.swrCdn,
    );
  });

  it('Vary: User-Agent — коллапс не спасает, ожидание вдвое дольше', async () => {
    const a = await run({ vary: 'ua' });
    expect({ origin: a.calls.length, collapsed: count(a.rows, 'collapsed'), maxWait: Math.max(...a.rows.map((x) => x.wait)) }).toEqual(
      t.STREAM_NUMBERS.uaCoalesce,
    );
    const b = await run({ vary: 'ua', coalesce: false });
    expect({ origin: b.calls.length, maxWait: Math.max(...b.rows.map((x) => x.wait)) }).toEqual(t.STREAM_NUMBERS.uaNoCoalesce);
  });

  it('purge при публикации: старую версию после 20-й секунды не получил никто', async () => {
    const r = await run({ purge: true });
    expect({ oldUntil: r.oldUntil }).toEqual(t.STREAM_NUMBERS.purge);
    expect(r.purged).toBe(1);
  });
});
