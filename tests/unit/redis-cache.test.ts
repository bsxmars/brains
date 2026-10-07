import { execFileSync } from 'node:child_process';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/data/redis-cache/data';
import * as nginx from '@/content/delivery/nginx-proxy/data';
import {
  herdClient,
  herdSetup,
  loadModel,
  mulberry32,
  openUnit,
  plainExpected,
  runEviction,
  runHerd,
  runRace,
  showReply,
  xfetchExpected,
} from '@/widgets/cache-race-lab/model/run';
import type { CacheLike, Client, HerdPattern, RaceScenario, Strategy } from '@/widgets/cache-race-lab/model/types';

/**
 * Тема «Кеш перед базой: Redis, инвалидация и толпа».
 *
 * Учебная модель — строки `REDIS_CODE`, `DB_CODE`, `SCHEDULE_CODE`, `CLIENT_CODE`, `FIX_CODE`,
 * `HERD_CODE`, `SIM_CODE`, `EVICT_CODE`, `WORKLOAD_CODE` из темы; её же исполняют демо. Здесь она
 * всегда сверяется с литералами стенда (настоящий Redis 7.4.11, см. шапку `data.ts`):
 *   — гонки — журнал шаг в шаг;
 *   — толпа — число походов в базу и число ждавших у 50 одновременных читателей;
 *   — поток через истечение — с формулами `plainExpected` и `xfetchExpected`;
 *   — вытеснение — статистика по группам ключей (имена ключей у Redis и модели разные:
 *     LRU приближённый, выборка случайная).
 *
 * Живой Redis нужен только блоку в конце: он пересобирает литералы, если задана переменная
 * `REDIS_CACHE_CONTAINER` — имя запущенного контейнера `redis:7-alpine` с опубликованным портом
 * 6379. Блок чистит этот Redis (`FLUSHALL`, `CONFIG SET maxmemory…`) — контейнер должен быть
 * отдельным. Нет переменной или Docker не отвечает — блок пропускается, и его название говорит почему.
 */

const PARTS = [t.REDIS_CODE, t.DB_CODE, t.SCHEDULE_CODE, t.CLIENT_CODE, t.FIX_CODE, t.HERD_CODE, t.SIM_CODE, t.EVICT_CODE, t.WORKLOAD_CODE];
const model = loadModel(PARTS);
const comma = (n: number) => n.toFixed(2).replace('.', ',');
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Медиана трёх прогонов стенда: первый прогон `noeviction` вместил больше — исходная память была другой. */
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Ждавшие: ходили в базу сами или спали, пока ходит другой. */
const waitedOf = (readers: { db: boolean; slept: boolean }[]) => readers.filter((r) => r.db || r.slept).length;

/** Учебный Redis с виртуальными часами: шаги лога с паузой «прошло N мс» двигают часы. */
function replayOnMini(log: string[]): string[] {
  const clock = { now: 0 };
  const cache = model.createRedis(() => clock.now);
  return log.map((line) => {
    const wait = /^прошло (\d+) мс$/.exec(line);
    if (wait) {
      clock.now += Number(wait[1]);
      return line;
    }
    const [head] = line.split(' → ');
    const [who, cmd] = head.split(': ');
    const args = cmd.split(' ');
    return `${who}: ${cmd} → ${showReply(cache.call(args[0], ...args.slice(1)))}`;
  });
}

describe('гонки: модель шаг в шаг совпадает с журналом Redis', () => {
  for (const sc of t.RACE_SCENARIOS) {
    it(sc.id, async () => {
      const r = await runRace(model, sc, t.ROWS);
      expect({ log: r.log, cached: r.cached, primary: r.primary }).toEqual(t.STAND_RACE[sc.id]);
    });
  }

  it('литералов ровно столько, сколько сценариев', () => {
    expect(Object.keys(t.STAND_RACE).sort()).toEqual(t.RACE_SCENARIOS.map((s) => s.id).sort());
  });

  it('гонки без защиты оставляют старое, лечение — свежее, кроме аренды против реплики', () => {
    const stale = Object.fromEntries(Object.entries(t.STAND_RACE).map(([id, r]) => [id, r.cached !== r.primary]));
    expect(stale).toEqual({
      'slow-reader': true,
      'early-del': true,
      replica: true,
      lease: false,
      'lease-replica': true,
      version: false,
      'double-del': false,
    });
    for (const sc of t.RACE_SCENARIOS.filter((s) => s.group === 'race')) expect(stale[sc.id], sc.id).toBe(true);
  });

  it('ответы, названные в итогах сценариев, есть в журнале', () => {
    for (const sc of t.RACE_SCENARIOS) {
      const seen = t.STAND_RACE[sc.id].log.join('\n');
      for (const m of sc.verdict.matchAll(/`(\(integer\) \d)`/g)) expect(seen, `${sc.id}: ${m[1]}`).toContain(m[1]);
      for (const m of sc.verdict.matchAll(/вернула `(\d)`/g)) expect(seen, `${sc.id}: ${m[1]}`).toContain(`(integer) ${m[1]}`);
    }
  });

  it('таблица лечения: версия выдерживает и медленного читателя, аренда — нет реплику', async () => {
    const slow = t.RACE_SCENARIOS.find((s) => s.id === 'slow-reader')!;
    const versionSlow: RaceScenario = {
      ...slow,
      id: 'version-slow',
      clients: { A: ['readUserVersioned', 1], B: ['renameUserVersioned', 1, 'Мария'], C: ['readUserVersioned', 1] },
    };
    const r = await runRace(model, versionSlow, t.ROWS);
    expect(r.cached).toBe(r.primary);

    const row = (k: string) => t.FIX_ROWS.find((x) => x.k.includes(k))!;
    const fresh = (id: string) => t.STAND_RACE[id].cached === t.STAND_RACE[id].primary;
    expect(row('после').slow).toBe(fresh('slow-reader') ? 'да' : 'нет');
    expect(row('после').replica).toBe(fresh('replica') ? 'да' : 'нет');
    expect(row('аренда').slow).toBe(fresh('lease') ? 'да' : 'нет');
    expect(row('аренда').replica).toBe(fresh('lease-replica') ? 'да' : 'нет');
    expect(row('версия').replica).toBe(fresh('version') ? 'да' : 'нет');
    expect(row('версия').slow).toBe('да');
  });

  it('замок, снятый простым DEL, достаётся третьему — учебный Redis отвечает так же', () => {
    expect(replayOnMini(t.LOCK_STEAL_LOG)).toEqual(t.LOCK_STEAL_LOG);
  });
});

describe('толпа: 50 читателей разом — модель против настоящего Redis', () => {
  for (const [key, stand] of Object.entries(t.STAND_BURST)) {
    it(key, async () => {
      const [strategy, pattern] = key.split('/') as [Strategy, HerdPattern];
      const r = await runHerd(model, strategy, pattern, t.HERD_PARAMS);
      expect({ dbCalls: r.dbCalls, waited: waitedOf(r.readers) }).toEqual(stand);
    });
  }

  it('без защиты в базу идут все 50, с замком — один; XFetch на промахе не помогает', () => {
    expect(t.STAND_BURST['plain/miss'].dbCalls).toBe(t.HERD_PARAMS.n);
    expect(t.STAND_BURST['lock/miss'].dbCalls).toBe(1);
    expect(t.STAND_BURST['xfetch/miss'].dbCalls).toBe(t.HERD_PARAMS.n);
    expect(t.STAND_BURST['swr/stale']).toEqual({ dbCalls: 1, waited: 0 });
  });

  it('без проверки после замка мягкий срок ходит в базу дважды', async () => {
    // Тот же HERD_CODE, но refresh не перечитывает кеш: так он был написан до того, как модель нашла лишний поход.
    const broken = HERD_WITHOUT_RECHECK();
    const m = loadModel(PARTS.map((p) => (p === t.HERD_CODE ? broken : p)));
    const r = await runHerd(m, 'swr', 'miss', t.HERD_PARAMS);
    expect(r.dbCalls).toBe(2);
  });
});

/** `HERD_CODE`, у которого refresh идёт в базу, не глядя в кеш. */
function HERD_WITHOUT_RECHECK(): string {
  const start = t.HERD_CODE.indexOf('function* refresh');
  const end = t.HERD_CODE.indexOf('function* staleWhileRevalidate');
  const naive = `function* refresh(key, me) {
  const value = yield ['db', 'load', key];
  const now = yield ['now'];
  yield ['cache', 'SET', key, JSON.stringify({ value, soft: now + SOFT_MS }), 'PX', TTL_MS];
  yield ['cache', 'FCALL', 'unlock', 1, \`lock:\${key}\`, me];
  return value;
}

`;
  expect(start).toBeGreaterThan(0);
  return t.HERD_CODE.slice(0, start) + naive + t.HERD_CODE.slice(end);
}

describe('толпа: поток через истечение — модель против формул', () => {
  it('STREAM_ROWS пересчитываются моделью', async () => {
    for (const row of t.STREAM_ROWS) {
      const r = await runHerd(model, row.strategy, 'stream', t.HERD_PARAMS);
      expect(
        {
          dbCalls: r.dbCalls,
          waited: waitedOf(r.readers),
          maxWait: Math.max(...r.readers.map((x) => x.wait)),
          stale: r.readers.filter((x) => x.at >= t.HERD_PARAMS.expiryMs && x.result === 'v0').length,
        },
        row.strategy,
      ).toEqual({ dbCalls: row.dbCalls, waited: row.waited, maxWait: row.maxWait, stale: row.stale });
    }
  });

  it('без защиты в базу идут все, кто пришёл, пока первый промах ждёт базу', () => {
    expect(plainExpected(t.HERD_PARAMS)).toBe(t.STREAM_ROWS.find((r) => r.strategy === 'plain')!.dbCalls);
  });

  it('XFetch: среднее по 1000 зёрен — в пределах 3 % от формулы, и обе цифры в таблице те же', async () => {
    for (const row of t.XFETCH_MEANS) {
      const p = { ...t.HERD_PARAMS, beta: row.beta };
      const calls: number[] = [];
      for (let seed = 1; seed <= 1000; seed++) calls.push((await runHerd(model, 'xfetch', 'stream', p, seed)).dbCalls);
      const expected = xfetchExpected(p);
      expect(Math.abs(mean(calls) - expected) / expected, `β = ${row.beta}`).toBeLessThan(0.03);
      expect(comma(mean(calls))).toBe(row.mean);
      expect(comma(expected)).toBe(row.expected);
    }
  }, 60_000);

  it('замок nginx из соседней темы: те же 10 → 1, что названы здесь', () => {
    const rows = nginx.CROWD_ROWS;
    expect(rows.map((r) => r.origin)).toEqual([10, 1]);
    expect(t.NGINX_NOTE).toContain('10 походов к бэкенду без неё и 1');
  });
});

describe('вытеснение: статистика модели против Redis', () => {
  const MODEL_RUNS = 200;
  const runsOf = (policy: string, samples: number) =>
    Array.from({ length: MODEL_RUNS }, (_, i) => runEviction(model, policy, samples, i + 1, t.EVICT_CAPACITY));

  // Политики, где случай почти не решает, — допуск 3 ключа; выборка из одного и random — 6.
  const TOL: Record<string, number> = { 'allkeys-lru/1': 6, 'allkeys-random/5': 6 };

  for (const key of Object.keys(t.STAND_EVICT).filter((k) => !k.startsWith('allkeys-lfu'))) {
    it(key, () => {
      const [policy, samples] = key.split('/');
      const runs = runsOf(policy, Number(samples));
      const stand = t.STAND_EVICT[key];
      const tol = TOL[key] ?? 3;
      for (const g of ['s', 'h', 'c'] as const) {
        expect(Math.abs(mean(runs.map((r) => r[g])) - median(stand.map((r) => r[g]))), `${key} ${g}`).toBeLessThanOrEqual(tol);
      }
    });
  }

  it('noeviction: модель отказывает на 299-й записи, Redis — на 297-й (и 310-й в первом прогоне)', () => {
    const r = runEviction(model, 'noeviction', 5, 1, t.EVICT_CAPACITY);
    expect(r.firstFail).toBe(t.EVICT_CAPACITY + 1);
    expect(r.fails).toBe(700 - t.EVICT_CAPACITY);
    for (const s of t.STAND_EVICT['noeviction/5']) expect(Math.abs(s.firstFail! - r.firstFail!)).toBeLessThanOrEqual(12);
    expect(t.OOM_ERROR).toBe("OOM command not allowed when used memory > 'maxmemory'.");
  });

  it('утверждения тонких мест: allkeys-lru съел все 50 ключей без срока, volatile-ttl — все 50 горячих', () => {
    for (const s of t.STAND_EVICT['allkeys-lru/5']) expect(s.s).toBe(0);
    for (const s of t.STAND_EVICT['volatile-lru/5']) expect([s.s, s.h]).toEqual([50, 50]);
    for (const s of t.STAND_EVICT['volatile-ttl/5']) expect(s.h).toBe(0);
    expect(t.PITFALLS.find((p) => p.n === '08')!.d).toContain('все 50');
    expect(t.PITFALLS.find((p) => p.n === '10')!.d).toContain(`${t.READ_EVICT.gets} подряд \`GET\` вытеснили ${t.READ_EVICT.byGets}`);
  });

  it('у выборки из одного ключа LRU вырождается в случайный выбор — в модели совпадение полное', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const a = runEviction(model, 'allkeys-lru', 1, seed, t.EVICT_CAPACITY);
      const b = runEviction(model, 'allkeys-random', 5, seed, t.EVICT_CAPACITY);
      expect([...a.kept].sort()).toEqual([...b.kept].sort());
    }
  });
});

describe('тексты держатся за стенд', () => {
  it('SET без срока делает ключ вечным, KEEPTTL сохраняет, INCR не трогает', () => {
    expect(t.TTL_LOG[3]).toBe('TTL user:1 → (integer) -1');
    expect(t.TTL_LOG[6]).toBe('TTL user:1 → (integer) 300');
    expect(t.TTL_LOG.at(-1)).toBe('TTL views → (integer) 60');
    expect(t.TTL_LOG).toContain('EXPIRE user:404 60 → (integer) 0');
  });

  it('write-behind: число из таблицы схем — то, что потерял docker kill', () => {
    const kill = t.RESTART_ROWS.find((r) => r.k.includes('kill'))!;
    expect(kill.after).toBe(0);
    expect(t.PATTERN_ROWS.find((r) => r.k === 'write-behind')!.when).toContain(`все ${kill.before} ключей`);
  });

  it('политика по умолчанию — noeviction, выборка — 5', () => {
    expect(t.REDIS_DEFAULTS).toEqual({ policy: 'noeviction', samples: 5, maxmemory: 0 });
    expect(t.EVICT_NOTE).toContain('по умолчанию 5');
  });

  it('демо собирает модель из тех же строк, что и тест', () => {
    expect(t.MODEL_PARTS).toEqual(PARTS);
    expect([...t.RACE_ONLY, ...t.FIX_ONLY].map((s) => s.id).sort()).toEqual(t.RACE_SCENARIOS.map((s) => s.id).sort());
  });

  it('XFetch с зерном 1 пересчитал за 810 мс до срока — как сказано в тексте', async () => {
    const r = await runHerd(model, 'xfetch', 'stream', t.HERD_PARAMS, 1);
    const first = r.readers.find((x) => x.db)!;
    expect(t.STREAM_NOTE).toContain(`за ${t.HERD_PARAMS.expiryMs - first.at} мс до срока`);
  });

  it('выборка 1: горячих уцелело столько, сколько названо в тексте', () => {
    const hs = t.STAND_EVICT['allkeys-lru/1'].map((r) => r.h);
    expect(t.EVICT_STAND_NOTE).toContain(`уцелело ${Math.min(...hs)}–${Math.max(...hs)}`);
    expect(t.EVICT_STAND_NOTE).toContain(`— ${t.MEMORY_USAGE} байт`);
  });

  it('OBJECT IDLETIME под LFU — ошибка', () => {
    expect(t.IDLE_LOG.at(-1)).toContain('idle time not tracked');
  });
});

// ─── Живой Redis: только при REDIS_CACHE_CONTAINER ──────────────────────────────────────────

const CONTAINER = process.env.REDIS_CACHE_CONTAINER;

/** Порт контейнера на хосте — или причина, по которой блок пропущен. */
function probe(): { port: number } | { why: string } {
  if (!CONTAINER) return { why: 'не задан REDIS_CACHE_CONTAINER' };
  try {
    const out = execFileSync('docker', ['port', CONTAINER, '6379'], { stdio: 'pipe' }).toString();
    const port = Number(/:(\d+)\s*$/m.exec(out)?.[1]);
    return port ? { port } : { why: `у контейнера ${CONTAINER} не опубликован порт 6379` };
  } catch {
    return { why: `Docker не отвечает или нет контейнера ${CONTAINER}` };
  }
}

const live = probe();
const LIVE_TITLE = 'port' in live ? `стенд: живой Redis в контейнере ${CONTAINER}` : `стенд: живой Redis — пропущен (${live.why})`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.runIf('port' in live)(LIVE_TITLE, () => {
  const port = 'port' in live ? live.port : 0;
  let r: Redis;
  let conns: Redis[];
  const real: CacheLike = { call: (cmd, ...a) => r.call(cmd, ...a.map(String)) };

  beforeAll(async () => {
    r = new Redis({ port, lazyConnect: true });
    await r.connect();
    conns = Array.from({ length: 10 }, () => new Redis({ port }));
    await r.config('SET', 'maxmemory', '0');
    await r.config('SET', 'maxmemory-policy', 'noeviction');
    await r.call('FUNCTION', 'LOAD', 'REPLACE', t.LUA_CODE);
  });

  afterAll(async () => {
    await r.config('SET', 'maxmemory', '0');
    await r.config('SET', 'maxmemory-policy', 'noeviction');
    await r.config('SET', 'maxmemory-samples', '5');
    await r.flushall();
    r.disconnect();
    conns.forEach((c) => c.disconnect());
  });

  it('версия Redis', async () => {
    expect((await r.info('server')).match(/redis_version:(\S+)/)?.[1]).toBe(t.STAND_VERSION);
    expect(await r.config('GET', 'maxmemory-samples')).toEqual(['maxmemory-samples', String(t.REDIS_DEFAULTS.samples)]);
  });

  it('STAND_RACE: семь гонок', async () => {
    for (const sc of t.RACE_SCENARIOS) {
      await r.flushall();
      await r.call('FUNCTION', 'LOAD', 'REPLACE', t.LUA_CODE);
      const res = await runRace(model, sc, t.ROWS, Infinity, real);
      expect({ log: res.log, cached: res.cached, primary: res.primary }, sc.id).toEqual(t.STAND_RACE[sc.id]);
    }
  });

  /** 50 читателей в настоящем времени: база — таймер со счётчиком, соединений десять. */
  async function burst(strategy: Strategy, pattern: HerdPattern) {
    await r.flushall();
    await r.call('FUNCTION', 'LOAD', 'REPLACE', t.LUA_CODE);
    const t0 = Date.now();
    const setup = herdSetup(strategy, pattern, t.HERD_PARAMS);
    if (setup) await r.call(...(setup.map(String) as [string, ...string[]]));
    let dbCalls = 0;
    const background: Promise<boolean>[] = [];
    const random = openUnit(mulberry32(1));
    async function drive(gen: Client, i: number): Promise<boolean> {
      let reply: unknown;
      let waited = false;
      for (;;) {
        const step = gen.next(reply);
        if (step.done) return waited;
        const [kind, ...args] = step.value;
        reply = undefined;
        if (kind === 'cache') reply = await conns[i % conns.length].call(String(args[0]), ...args.slice(1).map(String));
        else if (kind === 'now') reply = Date.now() - t0;
        else if (kind === 'db') {
          dbCalls++;
          waited = true;
          await sleep(t.HERD_PARAMS.dbMs);
          reply = `v@${Date.now() - t0}`;
        } else if (kind === 'sleep') {
          waited = true;
          await sleep(Number(args[0]));
        } else if (kind === 'spawn') background.push(drive(args[0] as Client, i));
      }
    }
    const waits = await Promise.all(
      Array.from({ length: t.HERD_PARAMS.n }, (_, i) => drive(herdClient(model, strategy, i, 1, random), i)),
    );
    await Promise.all(background);
    return { dbCalls, waited: waits.filter(Boolean).length };
  }

  it('STAND_BURST: 50 читателей разом в настоящем времени', async () => {
    for (const [key, stand] of Object.entries(t.STAND_BURST)) {
      const [strategy, pattern] = key.split('/') as [Strategy, HerdPattern];
      expect(await burst(strategy, pattern), key).toEqual(stand);
    }
  }, 30_000);

  const replay = async (log: string[]) => {
    const out: string[] = [];
    for (const line of log) {
      const wait = /^прошло (\d+) мс$/.exec(line);
      if (wait) {
        await sleep(Number(wait[1]));
        out.push(line);
        continue;
      }
      const [head] = line.split(' → ');
      const cmd = head.includes(': ') ? head.split(': ')[1] : head;
      const [name, ...args] = cmd.split(' ');
      let reply: string;
      try {
        reply = showReply(await r.call(name, ...args));
      } catch (e) {
        reply = `(error) ${(e as Error).message}`;
      }
      out.push(`${head} → ${reply}`);
    }
    return out;
  };

  it('TTL_LOG и LOCK_STEAL_LOG', async () => {
    await r.flushall();
    expect(await replay(t.TTL_LOG)).toEqual(t.TTL_LOG);
    await r.flushall();
    await r.call('FUNCTION', 'LOAD', 'REPLACE', t.LUA_CODE);
    expect(await replay(t.LOCK_STEAL_LOG)).toEqual(t.LOCK_STEAL_LOG);
  });

  it('IDLE_LOG и MEMORY_USAGE', async () => {
    await r.flushall();
    await r.set('page:1', 'x'.repeat(1000));
    expect(await r.call('MEMORY', 'USAGE', 'page:1')).toBe(t.MEMORY_USAGE);
    await sleep(3100);
    const idle = Number(await r.call('OBJECT', 'IDLETIME', 'page:1'));
    expect(idle).toBeGreaterThanOrEqual(3);
    expect(idle).toBeLessThanOrEqual(5);
    await r.get('page:1');
    expect(await r.call('OBJECT', 'IDLETIME', 'page:1')).toBe(0);
    await expect(r.call('OBJECT', 'FREQ', 'page:1')).rejects.toThrow('An LFU maxmemory policy is not selected');
    await r.config('SET', 'maxmemory-policy', 'allkeys-lfu');
    await expect(r.call('OBJECT', 'IDLETIME', 'page:1')).rejects.toThrow('idle time not tracked');
    await r.config('SET', 'maxmemory-policy', 'noeviction');
  }, 10_000);

  /** Нагрузка WORKLOAD_CODE на настоящем Redis — так же, как на стенде. */
  async function evict(policy: string, samples: number) {
    await r.config('SET', 'maxmemory', '0');
    await r.flushall();
    await r.config('RESETSTAT');
    const base = Number(/used_memory:(\d+)/.exec(await r.info('memory'))![1]);
    await r.config('SET', 'maxmemory-policy', policy);
    await r.config('SET', 'maxmemory-samples', String(samples));
    await r.config('SET', 'maxmemory', String(base + 432_000));
    let writes = 0;
    let fails = 0;
    let firstFail: number | null = null;
    for (const [op, key, ttl] of model.workload()) {
      if (op === 'tick') await sleep(1100);
      else if (op === 'get') await r.get(String(key));
      else {
        writes++;
        try {
          if (ttl === null || ttl === undefined) await r.set(String(key), 'x'.repeat(1000));
          else await r.set(String(key), 'x'.repeat(1000), 'EX', ttl);
        } catch {
          fails++;
          firstFail ??= writes;
        }
      }
    }
    await r.config('SET', 'maxmemory', '0');
    const keys = await r.keys('*');
    const count = (p: string) => keys.filter((k) => k.startsWith(p)).length;
    return { s: count('s:'), h: count('h:'), c: count('c:'), fails, firstFail };
  }

  it('STAND_EVICT: allkeys-lru, volatile-lru и noeviction', async () => {
    for (const key of ['allkeys-lru/5', 'volatile-lru/5', 'noeviction/5']) {
      const [policy, samples] = key.split('/');
      const got = await evict(policy, Number(samples));
      const stand = t.STAND_EVICT[key];
      for (const g of ['s', 'h', 'c'] as const) {
        expect(Math.abs(got[g] - median(stand.map((x) => x[g]))), `${key} ${g}`).toBeLessThanOrEqual(15);
      }
      expect(got.fails > 0, key).toBe(policy === 'noeviction');
    }
    await r.config('SET', 'maxmemory-policy', 'noeviction');
    await r.config('SET', 'maxmemory-samples', '5');
  }, 60_000);
});
