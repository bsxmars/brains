import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import Redis from 'ioredis';
import { Agent, RetryAgent, RetryHandler, request } from 'undici';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/rate-limits/data';
import { binLog, loadRetry, runHerd } from '@/widgets/retry-lab/model/run';
import type { Outcome, RetryAfterMode, Strategy } from '@/widgets/retry-lab/model/types';

/**
 * Тема «Ограничение частоты в API».
 *
 * `RETRY_CODE` (разбор `Retry-After`, паузы, политика, предохранитель, симуляция) — строки темы:
 * напечатаны на странице и исполняются демо. Здесь они сверяются:
 *   — с undici `RetryAgent` на живом `node:http`: сколько обращений получил сервер и какую паузу
 *     undici попросил у `setTimeout` (обёртка над его же функцией повтора по умолчанию);
 *     политика темы в режиме `UNDICI_LIKE` отвечает так же, кроме перечисленных в теме различий;
 *   — `fetch` Node и пример `UNDICI_CODE` исполняются как напечатаны;
 *   — паузы — с портом OCC-модели из aws-arch-backoff-simulator: порядок стратегий и числа
 *     (±8 %) как в `AWS_ROWS`, снятых оригинальным симулятором на Python;
 *   — симуляции — с литералами `HERD_STATS`, `STREAM_ROWS`, `BACKOFF_SAMPLES`;
 *   — `CLIENT_IP_CODE` — с таблицей nginx `real_ip_recursive`; `LIMIT_CODE` — со счётчиками
 *     в памяти всегда и с живым Redis при `RATELIMITS_REDIS_URL`.
 */

const api = loadRetry(t.RETRY_CODE);

// ─── Живой сервер по сценарию ──────────────────────────────────────────────────────────────

type Step = 'reset' | { status: number; retryAfter?: string };
const scripts = new Map<string, Step[]>();
const hits = new Map<string, number>();
let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const key = req.url ?? '/';
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    const list = scripts.get(key) ?? [{ status: 200 }];
    const step = list[Math.min(n - 1, list.length - 1)];
    if (step === 'reset') {
      req.socket.destroy();
      return;
    }
    req.resume();
    req.on('end', () => {
      const headers: Record<string, string> = {};
      if (step.retryAfter !== undefined) headers['retry-after'] = step.retryAfter;
      res.writeHead(step.status, headers);
      res.end(String(step.status));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

function prepare(path: string, script: Step[]) {
  scripts.set(path, script);
  hits.set(path, 0);
}

// Функция повтора undici по умолчанию — статический метод под символом.
const kDefault = Object.getOwnPropertySymbols(RetryHandler)[0] as unknown as keyof typeof RetryHandler;
const recorded = new Map<string, number[]>();
type RetryFn = (err: unknown, ctx: { opts: { path: string } }, cb: (e?: unknown) => void) => unknown;
const undiciDefault = RetryHandler[kDefault] as unknown as RetryFn;

/** `RetryAgent` с умолчаниями; паузу, которую он просит у `setTimeout`, записываем и обнуляем. */
const agent = new RetryAgent(new Agent(), {
  retry: ((err: unknown, ctx: { opts: { path: string } }, cb: (e?: unknown) => void) => {
    const real = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      recorded.get(ctx.opts.path)?.push(ms);
      return real(fn, 0);
    }) as typeof setTimeout;
    try {
      return undiciDefault(err, ctx, cb);
    } finally {
      globalThis.setTimeout = real;
    }
  }) as never,
});

afterAll(() => agent.close());

const resolveDate = (v?: string) => (v === '+3s' ? new Date(Date.now() + 3000).toUTCString() : v);

describe('undici RetryAgent на живом сервере — как в UNDICI_CASES', () => {
  for (const c of t.UNDICI_CASES) {
    it(c.id, async () => {
      const path = `/u/${c.id}`;
      const script = c.script.map((s) => (s === 'reset' ? s : { ...s, retryAfter: resolveDate(s.retryAfter) }));
      prepare(path, script);
      recorded.set(path, []);
      try {
        const res = await request(base + path, {
          method: c.method as 'GET',
          dispatcher: agent,
          headers: c.key ? { 'idempotency-key': 'o-1' } : {},
          body: c.method === 'GET' ? undefined : 'x',
        });
        await res.body.text();
      } catch {
        // попытки кончились или метод не повторяется — undici бросает; считаем обращения
      }
      expect(hits.get(path), 'обращений к серверу').toBe(c.hits);
      if (c.id === 'get-429-date') {
        // HTTP-дата — с точностью до секунды: от «через 3 с» остаётся 2–3 с.
        const [ms] = recorded.get(path)!;
        expect(ms).toBeGreaterThanOrEqual(1900);
        expect(ms).toBeLessThanOrEqual(3000);
      } else {
        expect(recorded.get(path)).toEqual(c.delays);
      }

      // Политика темы в режиме «как undici»: первое решение.
      const first = script[0];
      const outcome: Outcome = first === 'reset' ? { code: 'UND_ERR_SOCKET' } : first;
      const policy = api.createRetryPolicy(t.UNDICI_LIKE);
      const d = policy.decide({ method: c.method, idempotencyKey: c.key ? 'o-1' : undefined }, outcome, { attempt: 0, now: Date.now() });
      expect(d.retry).toBe(c.ours.retry);
      if (c.id === 'get-429-date') {
        expect(d.delay!).toBeGreaterThanOrEqual(1900);
        expect(d.delay!).toBeLessThanOrEqual(3000);
      } else if (c.ours.delay !== undefined) {
        expect(d.delay).toBe(c.ours.delay);
      }
      // Там, где различие не объявлено, ответ тот же, что у undici.
      if (!c.differs && c.id !== 'get-429-date') {
        expect(d.retry).toBe(c.hits > 1);
        if (d.retry) expect(d.delay).toBe(c.delays[0]);
      }
    });
  }

  it('«503 всегда»: политика темы даёт те же пять пауз и сдаётся на шестой', () => {
    const policy = api.createRetryPolicy(t.UNDICI_LIKE);
    const delays: number[] = [];
    for (let attempt = 0; ; attempt++) {
      const d = policy.decide({ method: 'GET' }, { status: 503 }, { attempt });
      if (!d.retry) {
        expect(d.why).toBe('попытки');
        break;
      }
      delays.push(d.delay!);
    }
    expect(delays).toEqual(t.UNDICI_CASES.find((c) => c.id === 'get-503-forever')!.delays);
  });

  it('с умолчаниями темы Retry-After дольше минуты — отказ сразу', () => {
    const d = api.createRetryPolicy().decide({ method: 'GET' }, { status: 429, retryAfter: '120' }, { attempt: 0 });
    expect(d).toEqual({ retry: false, why: 'Retry-After' });
  });

  it('у undici по умолчанию нет 408 в кодах и нет POST в методах', async () => {
    const src = readFileSync(createRequire(import.meta.url).resolve('undici/lib/handler/retry-handler.js'), 'utf8');
    expect(src).toContain("statusCodes ?? [500, 502, 503, 504, 429]");
    expect(src).toContain("methods ?? ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE', 'QUERY']");
    expect(src).toContain('maxTimeout: maxTimeout ?? 30 * 1000');
    const version = (JSON.parse(readFileSync(createRequire(import.meta.url).resolve('undici/package.json'), 'utf8')) as { version: string }).version;
    expect(version).toBe('8.10.2');
    expect(t.CLIENT_ROWS[1].k).toContain(version);
  });

  it('UNDICI_CODE исполняется как напечатан: два 503, потом 200', async () => {
    const lines = t.UNDICI_CODE.split('\n');
    expect(lines[0]).toBe("import { Agent, RetryAgent, request } from 'undici';");
    const body = lines.slice(1).join('\n');
    const path = '/undici-code';
    prepare(path, [{ status: 503, retryAfter: '0' }, { status: 503, retryAfter: '0' }, { status: 200 }]);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...args: unknown[]) => Promise<{ statusCode: number; body: { text(): Promise<string> } }>;
    const run = new AsyncFunction('Agent', 'RetryAgent', 'request', 'url', `${body}\nreturn res;`);
    const res = await run(Agent, RetryAgent, request, base + path);
    await res.body.text();
    expect(res.statusCode).toBe(200);
    expect(hits.get(path)).toBe(3);
  });
});

describe('fetch не повторяет', () => {
  it('FETCH_CODE исполняется как напечатан: 429, ok false, Retry-After строкой, одно обращение', async () => {
    const path = '/fetch';
    prepare(path, [{ status: 429, retryAfter: '2' }, { status: 200 }]);
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...a: string[]) => (...args: unknown[]) => Promise<{ ok: boolean; status: number; retryAfter: string | null }>;
    const run = new AsyncFunction('fetch', 'url', `${t.FETCH_CODE}\nawait res.text();\nreturn { ok: res.ok, status: res.status, retryAfter: res.headers.get('retry-after') };`);
    const got = await run(fetch, base + path);
    expect({ ...got, hits: hits.get(path) }).toEqual(t.FETCH_RESULT);
  });

  it('503 и обрыв сокета — тоже одно обращение', async () => {
    prepare('/fetch-503', [{ status: 503 }, { status: 200 }]);
    expect((await fetch(base + '/fetch-503')).status).toBe(503);
    expect(hits.get('/fetch-503')).toBe(1);
    prepare('/fetch-reset', ['reset', { status: 200 }]);
    await expect(fetch(base + '/fetch-reset')).rejects.toThrow(TypeError);
    expect(hits.get('/fetch-reset')).toBe(1);
  });

  it('RetryAgent в Node без пакета недоступен: встроенный undici наружу не отдан', () => {
    expect(process.versions.undici).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.getOwnPropertyNames(globalThis).filter((k) => /undici|Agent$/i.test(k))).toEqual([]);
    expect(t.UNDICI_NOTE).toContain(`undici ${process.versions.undici!.split('.').slice(0, 2).join('.')}`);
  });
});

describe('Retry-After: разбор', () => {
  it('RA_ROWS — ответы parseRetryAfter', () => {
    for (const row of t.RA_ROWS) expect(api.parseRetryAfter(row.value, t.RA_NOW), String(row.value)).toBe(row.ms);
  });

  it('Date.parse(\'1.5\') в V8 — январь 2001 года, поэтому нужна проверка на буквы', () => {
    const at = Date.parse('1.5');
    expect(Number.isFinite(at)).toBe(true);
    expect(new Date(at).getFullYear()).toBe(2001);
    expect(api.parseRetryAfter('1.5', Date.now())).toBeNull();
    expect(api.parseRetryAfter('-1', Date.now())).toBeNull();
  });
});

describe('паузы и джиттер', () => {
  it('BACKOFF_SAMPLES — первые шесть пауз при зерне 1', () => {
    for (const s of Object.keys(t.BACKOFF_SAMPLES) as Strategy[]) {
      const random = api.seeded(1);
      let prev = 500;
      const out: number[] = [];
      for (let a = 0; a < 6; a++) {
        const d = Math.round(api.backoff(s, a, prev, { base: 500, cap: 20_000 }, random));
        out.push(d);
        prev = d;
      }
      expect(out, s).toEqual(t.BACKOFF_SAMPLES[s]);
    }
  });

  it('пределы стратегий на 10 000 пауз', () => {
    const random = api.seeded(42);
    const o = { base: 100, cap: 5000 };
    for (let i = 0; i < 10_000; i++) {
      const attempt = i % 8;
      const ceiling = Math.min(o.cap, o.base * 2 ** attempt);
      const prev = 100 + (i % 37) * 50;
      const full = api.backoff('full', attempt, prev, o, random);
      const equal = api.backoff('equal', attempt, prev, o, random);
      const dec = api.backoff('decorrelated', attempt, prev, o, random);
      expect(full >= 0 && full < ceiling).toBe(true);
      expect(equal >= ceiling / 2 && equal < ceiling).toBe(true);
      expect(dec >= o.base && dec <= Math.min(o.cap, prev * 3)).toBe(true);
      expect(api.backoff('none', attempt, prev, o, random)).toBe(ceiling);
    }
  });

  /** Порт `OccServer`/`OccClient` из aws-arch-backoff-simulator: сеть N(10, 2) мс, base 5, cap 2000. */
  function occ(clients: number, strategy: Strategy | 'noop', random: () => number) {
    const gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const delay = () => Math.abs(10 + 2 * gauss());
    type Ev = { at: number; kind: 'read' | 'write'; attempt: number; prev: number; seen?: number };
    const q: Ev[] = [];
    const push = (e: Ev) => {
      let i = q.length;
      while (i && q[i - 1].at > e.at) i--;
      q.splice(i, 0, e);
    };
    for (let c = 0; c < clients; c++) push({ at: delay(), kind: 'read', attempt: 0, prev: 5 });
    let version = 0,
      calls = 0,
      tm = 0;
    while (q.length) {
      const e = q.shift()!;
      tm = e.at;
      if (e.kind === 'read') {
        push({ ...e, at: tm + delay() + delay(), kind: 'write', seen: version });
        continue;
      }
      calls++;
      if (e.seen === version) {
        version++;
        continue;
      }
      const attempt = e.attempt + 1;
      const s = strategy === 'noop' ? 0 : api.backoff(strategy, attempt, e.prev, { base: 5, cap: 2000 }, random);
      push({ at: tm + delay() + delay() + s, kind: 'read', attempt, prev: s });
    }
    return { tm, calls };
  }

  it('OCC-модель AWS с паузами темы: порядок как в статье, числа ±8 % от оригинального симулятора', () => {
    const got: Record<string, { time: number; calls: number }> = {};
    for (const row of t.AWS_ROWS) {
      const random = api.seeded(1);
      let tm = 0,
        calls = 0;
      for (let i = 0; i < 100; i++) {
        const r = occ(row.clients, row.strategy, random);
        tm += r.tm;
        calls += r.calls;
      }
      got[`${row.clients}/${row.strategy}`] = { time: tm / 100, calls: calls / 100 };
      expect(Math.abs(tm / 100 / row.time - 1), `${row.clients} ${row.strategy} время`).toBeLessThan(0.08);
      expect(Math.abs(calls / 100 / row.calls - 1), `${row.clients} ${row.strategy} вызовы`).toBeLessThan(0.08);
    }
    for (const n of [50, 100]) {
      const g = (s: string) => got[`${n}/${s}`];
      // «Full Jitter uses less work, but slightly more time» чем Decorrelated; Equal — медленнее обоих.
      expect(g('full').calls).toBeLessThan(g('equal').calls);
      expect(g('equal').calls).toBeLessThan(g('decorrelated').calls);
      expect(g('decorrelated').calls).toBeLessThan(g('none').calls);
      expect(g('decorrelated').time).toBeLessThan(g('full').time);
      expect(g('full').time).toBeLessThan(g('equal').time);
      expect(g('equal').time).toBeLessThan(g('none').time);
      expect(g('noop').time).toBeLessThan(g('decorrelated').time);
      expect(g('noop').calls).toBeGreaterThan(g('none').calls);
    }
  });
});

describe('стадо после сбоя: HERD_STATS', () => {
  const modes: RetryAfterMode[] = ['ignore', 'exact', 'jitter'];
  const strategies: Strategy[] = ['none', 'full', 'equal', 'decorrelated'];

  it(`средние по ${t.HERD_SEEDS} зёрнам совпадают с литералом`, () => {
    for (const mode of modes) {
      for (const s of strategies) {
        const sum = { calls: 0, s503: 0, s429: 0, lastOk: 0 };
        for (let seed = 1; seed <= t.HERD_SEEDS; seed++) {
          const r = runHerd(api, t.HERD_PRESET, s, mode, seed);
          expect(r.ok, `${mode}/${s}/${seed}: дошли все`).toBe(t.HERD_PRESET.clients);
          sum.calls += r.calls;
          sum.s503 += r.s503;
          sum.s429 += r.s429;
          sum.lastOk += r.lastOk!;
        }
        const avg = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Math.round(v / t.HERD_SEEDS)]));
        expect(avg, `${mode}/${s}`).toEqual(t.HERD_STATS[mode][s]);
      }
    }
  });

  it('утверждения текста: полный — меньше всего 429, декоррелированный — меньше всего вызовов, равный — раньше всех', () => {
    const h = t.HERD_STATS;
    for (const mode of ['ignore', 'jitter'] as const) {
      const jit = ['full', 'equal', 'decorrelated'] as const;
      expect(Math.min(...jit.map((s) => h[mode][s].s429))).toBe(h[mode].full.s429);
      expect(Math.min(...strategies.map((s) => h[mode][s].calls))).toBe(h[mode].decorrelated.calls);
      expect(Math.min(...strategies.map((s) => h[mode][s].lastOk))).toBe(h[mode].equal.lastOk);
      expect(Math.max(...strategies.map((s) => h[mode][s].s503))).toBe(h[mode].full.s503);
    }
    expect(h.ignore.none.s429).toBe(100);
    expect(h.exact.none.s429).toBe(100);
    expect(h.jitter.none.s429).toBeLessThan(h.exact.none.s429);
    expect(t.HERD_NOTE).toContain('51,7 с');
    expect(t.PITFALLS.find((p) => p.n === '08')!.d).toContain('51,7 с');
  });

  it('без джиттера результат от зерна не зависит; волна 50 → 10 проходят, 40 получают 429', () => {
    const a = runHerd(api, t.HERD_PRESET, 'none', 'ignore', 1);
    const b = runHerd(api, t.HERD_PRESET, 'none', 'ignore', 99);
    expect(a.log).toEqual(b.log);
    const bins = binLog(a.log, 500);
    const firstAfterUp = bins.find((x) => x.ok > 0)!;
    expect(firstAfterUp).toEqual({ ok: 10, s429: 40, s503: 0 });
  });

  it('binLog раскладывает весь журнал', () => {
    const r = runHerd(api, t.HERD_PRESET, 'full', 'jitter', 3);
    const bins = binLog(r.log, t.HERD_PRESET.bin);
    expect(bins.reduce((s, b) => s + b.ok + b.s429 + b.s503, 0)).toBe(r.calls);
    expect(bins.reduce((s, b) => s + b.s429, 0)).toBe(r.s429);
  });
});

describe('бюджет и предохранитель: STREAM_ROWS', () => {
  it('поток 600 запросов: литерал совпадает с симуляцией', () => {
    const sc = t.STREAM_SCENE;
    const starts = Array.from({ length: sc.count }, (_, i) => i * sc.every);
    for (const row of t.STREAM_ROWS) {
      const o = t.STREAM_OPTIONS[row.id];
      const r = api.simulate({ starts, downUntil: sc.downUntil, rate: sc.rate, burst: sc.rate, policy: o.policy, breaker: o.breaker ?? null });
      expect(
        { during: r.log.filter(([at]) => at < sc.downUntil).length, calls: r.calls, ok: r.ok, lost: r.gaveUp + r.fastFail },
        row.id,
      ).toEqual({ during: row.during, calls: row.calls, ok: row.ok, lost: row.lost });
    }
    const [none, retry, budget, breaker] = t.STREAM_ROWS;
    expect(retry.ok - none.ok).toBe(37);
    expect(Math.round((budget.during / none.during - 1) * 100)).toBe(12);
    expect(none.ok - breaker.ok).toBe(13);
    expect(retry.during / none.during).toBeGreaterThan(3.8);
  });

  it('предохранитель: после threshold неудач не пускает, через cooldown — одна проба', () => {
    const b = api.createBreaker({ threshold: 2, cooldown: 100 });
    b.record(false, 0);
    expect(b.allow(1)).toBe(true);
    b.record(false, 1);
    expect(b.allow(50)).toBe(false);
    expect(b.allow(101)).toBe(true); // проба
    expect(b.allow(102)).toBe(false); // вторая — нет, проба в пути
    b.record(true, 110);
    expect(b.allow(111)).toBe(true);
  });

  it('бюджет: запас reserve, потом по одному повтору на 1/ratio новых запросов', () => {
    const p = api.createRetryPolicy({ budget: { ratio: 0.1, reserve: 3 }, maxRetries: 10 });
    const out: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      p.started();
      out.push(p.decide({ method: 'GET' }, { status: 503 }, { attempt: 0 }).retry);
    }
    expect(out.filter(Boolean).length).toBe(4); // 3 из запаса + 1 накопленный
  });
});

describe('ключ лимита: CLIENT_IP_CODE против nginx real_ip_recursive', () => {
  const ip = new Function(`${t.CLIENT_IP_CODE}\nreturn { clientIp, trusted };`)() as {
    clientIp(remote: string, xff: string | null, trusted: (s: string) => boolean): string;
    trusted(s: string): boolean;
  };

  it('ответы совпадают с nginx (on) во всех строках', () => {
    for (const row of t.REALIP_ROWS) {
      expect(ip.clientIp(t.REALIP_REMOTE, row.xff, ip.trusted), String(row.xff)).toBe(row.on);
    }
  });

  it('«первый адрес» — левый в цепочке; с off nginx берёт правый', () => {
    for (const row of t.REALIP_ROWS) {
      const chain = (row.xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      expect(row.first).toBe(chain[0] ?? t.REALIP_REMOTE);
      expect(row.off).toBe(chain.at(-1) && /^\d/.test(chain.at(-1)!) ? chain.at(-1) : t.REALIP_REMOTE);
    }
    expect(ip.trusted('172.17.0.1') && ip.trusted('10.0.0.5') && !ip.trusted('203.0.113.7')).toBe(true);
  });
});

describe('лимит на кластере: LIMIT_CODE', () => {
  type Store = { incr(k: string, window?: number): Promise<number> };
  const lim = new Function(`${t.LIMIT_CODE}\nreturn { allow, memoryStore, redisStore };`)() as {
    allow(store: Store, key: string, o: { limit: number; window: number }, now: number): Promise<boolean>;
    memoryStore(): Store;
    redisStore(r: Redis): Store;
  };
  const R = t.REDIS_STAND;
  const opts = { limit: R.limit, window: R.window };
  const now = 1_790_950_000_000;

  async function run(stores: Store[]) {
    let passed = 0;
    for (let i = 0; i < R.requests; i++) if (await lim.allow(stores[i % stores.length], 'user:42', opts, now + i)) passed++;
    return passed;
  }

  it('свой счётчик на каждом из трёх экземпляров пропускает все 30, общий — 10', async () => {
    expect(await run(Array.from({ length: R.instances }, () => lim.memoryStore()))).toBe(R.local);
    const shared = lim.memoryStore();
    expect(await run([shared, shared, shared])).toBe(R.shared);
  });

  it.skipIf(!process.env.RATELIMITS_REDIS_URL)('живой Redis: три соединения, 10 из 30, срок ключа поставлен', async () => {
    const conns = Array.from({ length: R.instances }, () => new Redis(process.env.RATELIMITS_REDIS_URL!));
    try {
      await conns[0].flushall();
      expect(await run(conns.map((c) => lim.redisStore(c)))).toBe(R.shared);
      const key = `rl:user:42:${Math.floor(now / R.window)}`;
      expect(Number(await conns[0].get(key))).toBe(R.counter);
      expect(await conns[0].pttl(key)).toBeGreaterThan(R.pttlAbove);
    } finally {
      conns.forEach((c) => c.disconnect());
    }
  });
});

describe('заголовки квоты и готовые клиенты', () => {
  it('GH_HEADERS: reset — момент через час после date, Retry-After и X-RateLimit-* открыты для CORS', () => {
    const h = Object.fromEntries(t.GH_HEADERS.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]));
    expect(Number(h['x-ratelimit-reset']) * 1000 - Date.parse(h.date)).toBe(3600_000);
    expect(Date.parse(h.date)).toBe(t.RA_NOW);
    expect(Number(h['x-ratelimit-limit']) - Number(h['x-ratelimit-used'])).toBe(Number(h['x-ratelimit-remaining']));
    const exposed = h['access-control-expose-headers'].split(', ');
    for (const k of ['Retry-After', 'X-RateLimit-Remaining', 'X-RateLimit-Reset']) expect(exposed).toContain(k);
    expect(t.QUOTA_NOTE).toContain('14:17:26');
  });

  it('TanStack Query: пауза 1, 2, 4 с без джиттера, Retry-After не читает', () => {
    const require = createRequire(import.meta.url);
    const file = require.resolve('@tanstack/query-core').replace(/build\/.*$/, 'build/modern/retryer.js');
    const src = readFileSync(file, 'utf8');
    expect(src).toContain('return Math.min(1e3 * 2 ** failureCount, 3e4);');
    expect(src).not.toMatch(/retry-after/i);
    expect(src).not.toMatch(/Math\.random/);
  });
});
