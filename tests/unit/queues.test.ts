import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/data/queues/data';
import { crashTable, loadModel, modelEnv, normalizeIds, outcomeOf, replayRaw } from '@/widgets/queue-lab/model/run';
import type { Env, Handler, Producer, Step, Variant } from '@/widgets/queue-lab/model/types';

/**
 * Тема «Очереди и идемпотентность: ровно один раз не бывает».
 *
 * Учебная модель — строки `*_CODE` темы (`t.PARTS`), её же исполняют демо. Здесь она всегда
 * сверяется:
 *   — с журналами настоящих Redis 7.4.11 + PGlite (`STAND_RUNS`, `STAND_FULL`, `SLOW_LOG`,
 *     `TRIM_LOG`) — строка в строку, с точностью до номеров записей Redis;
 *   — с PGlite в этом же процессе: тот же код, учебный Redis, настоящая база — журнал тот же;
 *   — со свойством «эффект ровно один раз» для outbox + ключа в транзакции при любом одном
 *     и любых двух падениях; остальные одиннадцать вариантов хоть где-то ошибаются.
 *
 * Живые блоки в конце пересобирают литералы: Redis — при `QUEUES_REDIS_CONTAINER` (имя контейнера
 * `redis:7-alpine` с опубликованным портом 6379: `docker run -d --name queues-redis
 * -p 127.0.0.1:53611:6379 redis:7-alpine`; блок делает `FLUSHALL`), Postgres — при
 * `QUEUES_PG_CONTAINER` (`docker run -d --name queues-pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=qlab
 * postgres:16-alpine`; блок пересоздаёт таблицы темы). Без переменных блоки пропускаются.
 */

const model = loadModel(t.PARTS);
const PRODUCERS: Producer[] = ['publishAfter', 'publishInside', 'outbox'];
const HANDLERS: Handler[] = ['ackFirst', 'ackAfter', 'checkFirst', 'idempotent'];
const VARIANTS: Variant[] = PRODUCERS.flatMap((producer) => HANDLERS.map((handler) => ({ producer, handler })));
const keyOf = (v: Variant) => `${v.producer}/${v.handler}`;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** PGlite со схемой темы; `reset` возвращает таблицы к началу между прогонами. */
async function openPglite() {
  const pg = new PGlite();
  await pg.exec(t.SCHEMA_SQL);
  const db: Env['db'] = {
    async exec(sql, params = []) {
      const res = await pg.query<Record<string, unknown>>(sql, params as unknown[]);
      return { rows: res.rows, rowCount: /^\s*SELECT/i.test(sql) ? res.rows.length : (res.affectedRows ?? 0) };
    },
  };
  const reset = () => pg.exec('TRUNCATE orders, outbox, processed RESTART IDENTITY; UPDATE wallets SET points = 0;');
  return { pg, db, reset };
}

describe('модель шаг в шаг совпадает с журналами Redis 7.4 + PGlite', () => {
  for (const sc of t.SCENARIOS) {
    it(sc.id, async () => {
      const r = await model.runSchedule(modelEnv(model).env, sc.schedule, sc.variant, sc.crash);
      expect({ log: r.log, final: r.final }).toEqual(t.STAND_RUNS[sc.id]);
    });
  }

  it('литералов столько же, сколько сценариев, и каждый сценарий стоит в каком-то демо', () => {
    expect(Object.keys(t.STAND_RUNS).sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
    const shown = Object.values(t.SCENES).flat().map((s) => s.id);
    expect(shown.sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
  });

  it('метка падения из сценария действительно встречается в коде', async () => {
    for (const sc of t.SCENARIOS.filter((s) => typeof s.crash === 'string')) {
      const r = await model.runSchedule(modelEnv(model).env, sc.schedule, sc.variant);
      expect(r.hits, sc.id).toContain(sc.crash);
      expect(t.STAND_RUNS[sc.id].log.some((l) => l.includes('✕ упал')), sc.id).toBe(true);
    }
  });

  it('SLOW_LOG и TRIM_LOG: учебный Redis отвечает как настоящий', async () => {
    for (const [steps, stand] of [
      [t.RAW_SLOW, t.SLOW_LOG],
      [t.RAW_TRIM, t.TRIM_LOG],
    ] as const) {
      const { env, redis } = modelEnv(model);
      expect(await replayRaw(redis, [...steps], env.sleep, model.showReply)).toEqual(stand);
    }
  });
});

describe('перебор точек падения: модель против STAND_FULL', () => {
  for (const v of VARIANTS) {
    it(keyOf(v), async () => {
      const { rows } = await crashTable(model, t.FULL_SCHEDULE, v);
      expect(rows.map((r) => [r.at, r.final.orders, r.final.points])).toEqual(t.STAND_FULL[keyOf(v)]);
    });
  }

  it('без ошибок — только outbox и ключ в транзакции', () => {
    const clean = t.CRASH_SUMMARY.filter((r) => r.lost + r.extra === 0);
    expect(clean).toEqual([expect.objectContaining({ producer: 'outbox', handler: 'ключ в транзакции' })]);
    expect(t.CRASH_SUMMARY).toHaveLength(12);
    // DarkPanel: «Ровно один раз из двенадцати вариантов даёт только один».
    for (const r of t.CRASH_SUMMARY) expect(r.once + r.lost + r.extra).toBe(r.points);
  });

  it('XACK до работы теряет, XACK после — удваивает (таблица гарантий)', () => {
    const at = (key: string, where: string) => t.STAND_FULL[key].find((r) => r[0] === where)!;
    expect(at('outbox/ackFirst', 'w1: XACK отправлен, начисления нет')[2]).toBe(0);
    expect(at('outbox/ackAfter', 'w1: начислил, XACK нет')[2]).toBe(20);
    expect(at('outbox/checkFirst', 'w1: начислил, ключа нет')[2]).toBe(20);
    expect(at('publishAfter/idempotent', 'P: заказ зафиксирован').slice(1)).toEqual([1, 0]);
    expect(at('publishInside/idempotent', 'P: событие ушло, COMMIT ещё нет').slice(1)).toEqual([0, 10]);
  });
});

describe('свойство: outbox + ключ в транзакции — эффект ровно один раз', () => {
  const v: Variant = { producer: 'outbox', handler: 'idempotent' };
  const ROUND = t.FULL_SCHEDULE.slice(3, 8);
  /** Три круга восстановления: после двух падений нужен лишний круг. */
  const LONG: Step[] = [...t.FULL_SCHEDULE.slice(0, 3), ...ROUND, ...ROUND, ...ROUND];

  it('круг восстановления — тот, что описан в теме', () => {
    expect(ROUND.map((s) => s[1])).toEqual([300, 'relay', 'claimStale', 'readNew', 'readNew']);
  });

  it('любое одно падение', async () => {
    const { clean, rows } = await crashTable(model, LONG, v);
    expect(outcomeOf(clean.final)).toBe('once');
    expect(rows.length).toBeGreaterThan(3);
    for (const r of rows) {
      expect(r.outcome, r.at).toBe('once');
      expect(r.final.pending, r.at).toBe(0);
    }
  });

  it('любые два падения подряд', async () => {
    const clean = await model.runSchedule(modelEnv(model).env, LONG, v);
    let pairs = 0;
    for (let a = 0; a < clean.hits.length; a++) {
      const first = await model.runSchedule(modelEnv(model).env, LONG, v, a);
      for (let b = a + 1; b < first.hits.length; b++) {
        const r = await model.runSchedule(modelEnv(model).env, LONG, v, [a, b]);
        expect(outcomeOf(r.final), `${first.hits[a]} + ${first.hits[b]}`).toBe('once');
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(10);
  });

  it('остальные одиннадцать вариантов ошибаются хотя бы на одной метке', async () => {
    for (const other of VARIANTS.filter((x) => keyOf(x) !== keyOf(v))) {
      const { rows } = await crashTable(model, t.FULL_SCHEDULE, other);
      expect(rows.some((r) => r.outcome !== 'once'), keyOf(other)).toBe(true);
    }
  });
});

describe('PGlite: тот же код с настоящей базой даёт тот же журнал', () => {
  let pgl: Awaited<ReturnType<typeof openPglite>>;
  beforeAll(async () => {
    pgl = await openPglite();
  });
  afterAll(async () => {
    await pgl.pg.close();
  });

  const envWithPg = async (): Promise<Env> => {
    await pgl.reset();
    return { ...modelEnv(model).env, db: pgl.db };
  };

  it('все сценарии демо', async () => {
    for (const sc of t.SCENARIOS) {
      const r = await model.runSchedule(await envWithPg(), sc.schedule, sc.variant, sc.crash);
      expect({ log: r.log, final: r.final }, sc.id).toEqual(t.STAND_RUNS[sc.id]);
    }
  });

  it('перебор падений для outbox и для «проверить, потом сделать»', async () => {
    for (const v of [{ producer: 'outbox', handler: 'idempotent' }, { producer: 'outbox', handler: 'checkFirst' }] as Variant[]) {
      const { rows } = await crashTable(model, t.FULL_SCHEDULE, v, envWithPg);
      expect(rows.map((r) => [r.at, r.final.orders, r.final.points])).toEqual(t.STAND_FULL[keyOf(v)]);
    }
  });

  it('SQL_CODE и SCHEMA_SQL: ответ ON CONFLICT DO NOTHING — 1, затем 0 строк', async () => {
    await pgl.reset();
    const SQL = model.SQL;
    expect((await pgl.db.exec(SQL.markProcessed, ['o-1'])).rowCount).toBe(1);
    expect((await pgl.db.exec(SQL.markProcessed, ['o-1'])).rowCount).toBe(0);
    await expect(pgl.db.exec(SQL.addPoints, ['7', 'abc'])).rejects.toMatchObject({ code: '22P02' });
  });
});

describe('утверждения текста следуют из литералов', () => {
  it('итоги сценариев: числа в тексте — из журнала', () => {
    for (const sc of t.SCENARIOS) {
      const f = t.STAND_RUNS[sc.id].final;
      const pts = /[Бб]онусов \*?\*?(\d+)/.exec(sc.verdict);
      if (pts) expect(Number(pts[1]), sc.id).toBe(f.points);
      const ord = /[Зз]аказов \*?\*?(\d+)/.exec(sc.verdict);
      if (ord) expect(Number(ord[1]), sc.id).toBe(f.orders);
      if (sc.verdict.includes('мёртвых писем **1**')) expect(f.dead, sc.id).toBe(1);
      for (const m of sc.verdict.matchAll(/`(\d-0)`/g)) expect(t.STAND_RUNS[sc.id].log.join('\n'), sc.id).toContain(m[1]);
    }
  });

  it('тон итога совпадает с исходом', () => {
    for (const sc of t.SCENARIOS) {
      const f = t.STAND_RUNS[sc.id].final;
      if (sc.schedule.some((s) => s[1] === 'place')) {
        expect(sc.tone, sc.id).toBe(outcomeOf(f) === 'once' ? 'ok' : 'err');
      } else if (sc.tone === 'ok') {
        expect(f.points, sc.id).toBe(10);
      } else if (sc.tone === 'err') {
        expect(f.points, sc.id).not.toBe(10);
      }
    }
  });

  it('INTRO_NOTE: lag 3, потом pending 2, длина потока после XACK — 3', () => {
    const log = t.INTRO_LOG.join('\n');
    expect(log).toContain('pending 0, lag 3');
    expect(log).toContain('pending 2, lag 1');
    expect(log).toContain('pending 1, lag 1');
    expect(log).toContain('XLEN events → (integer) 3');
  });

  it('DLQ_NOTE: ключ ядовитого события откатывается вместе с ошибкой', async () => {
    const sc = t.SCENARIOS.find((s) => s.id === 'poison')!;
    const { env, db } = modelEnv(model);
    await model.runSchedule(env, sc.schedule, sc.variant, sc.crash);
    expect(db.dump().processed).toEqual([]);
    expect(t.STAND_RUNS.poison.log.filter((l) => l.endsWith('ROLLBACK'))).toHaveLength(3);
    expect(t.DLQ_NOTE).toContain('записи `o-9` нет');
  });

  it('SLOW_NOTE и PENDING_FACTS: ответы — из журналов', () => {
    expect(t.SLOW_LOG).toContain('w1: XACK events bonus 1-0 → (integer) 1');
    expect(t.SLOW_LOG).toContain('w2: XACK events bonus 1-0 → (integer) 0');
    expect(t.TRIM_LOG.join('\n')).toContain('доставок 2');
    expect(t.TRIM_LOG.join('\n')).toContain('удалены 1-0');
    expect(t.STAND_RUNS['ack-after'].log.filter((l) => l.includes('забрал ничего'))).toHaveLength(1);
    expect(t.STAND_RUNS.poison.log.join('\n')).toContain('доставок 4');
    expect(t.CONSUMER_CODE).toContain('VISIBILITY_MS = 200');
    expect(t.CONSUMER_CODE).toContain('MAX_DELIVERIES = 3');
  });

  it('PG_CASES: двое с одним ключом', () => {
    const run = (id: string) => t.PG_RUNS[id];
    expect(run('commit').log).toContain('B: …дождался → INSERT 0 0');
    expect(run('commit').points).toBe(10);
    expect(run('rollback').log).toContain('B: …дождался → INSERT 0 1');
    expect(run('rollback').points).toBe(10);
    expect(run('check-race').points).toBe(20);
    expect(run('repeatable-read').log).toContain('B: …дождался → ошибка 40001');
    const gap = run('outbox-gap').log.filter((l) => l.includes('SELECT id, event_id'));
    expect(gap.map((l) => l.split(' → ')[1])).toEqual(['2|o-2', '1|o-1 / 2|o-2']);
    for (const c of t.PG_CASES) expect(t.PG_RUNS[c.id], c.id).toBeDefined();
  });
});

// ─── Живой Redis: только при QUEUES_REDIS_CONTAINER ──────────────────────────────────────

const REDIS_CONTAINER = process.env.QUEUES_REDIS_CONTAINER;

function probeRedis(): { port: number } | { why: string } {
  if (!REDIS_CONTAINER) return { why: 'не задан QUEUES_REDIS_CONTAINER' };
  try {
    const out = execFileSync('docker', ['port', REDIS_CONTAINER, '6379'], { stdio: 'pipe' }).toString();
    const port = Number(/:(\d+)\s*$/m.exec(out)?.[1]);
    return port ? { port } : { why: `у контейнера ${REDIS_CONTAINER} не опубликован порт 6379` };
  } catch {
    return { why: `Docker не отвечает или нет контейнера ${REDIS_CONTAINER}` };
  }
}

const live = probeRedis();
const LIVE_TITLE = 'port' in live ? `стенд: живой Redis в контейнере ${REDIS_CONTAINER}` : `стенд: живой Redis — пропущен (${live.why})`;

describe.runIf('port' in live)(LIVE_TITLE, () => {
  let r: Redis;
  let pgl: Awaited<ReturnType<typeof openPglite>>;

  beforeAll(async () => {
    r = new Redis({ port: 'port' in live ? live.port : 0 });
    pgl = await openPglite();
  });
  afterAll(async () => {
    await r.flushall();
    r.disconnect();
    await pgl.pg.close();
  });

  const realEnv = async (): Promise<Env> => {
    await r.flushall();
    await pgl.reset();
    return { redis: { call: (cmd, ...a) => r.call(cmd, ...a) as never }, db: pgl.db, sleep };
  };

  it('версия Redis', async () => {
    expect((await r.info('server')).match(/redis_version:(\S+)/)?.[1]).toBe(t.STAND_VERSIONS.redis);
  });

  it('STAND_RUNS', async () => {
    for (const sc of t.SCENARIOS) {
      const res = await model.runSchedule(await realEnv(), sc.schedule, sc.variant, sc.crash);
      expect({ log: normalizeIds(res.log), final: res.final }, sc.id).toEqual(t.STAND_RUNS[sc.id]);
    }
  }, 60_000);

  it('STAND_FULL', async () => {
    for (const v of VARIANTS) {
      const { rows } = await crashTable(model, t.FULL_SCHEDULE, v, realEnv);
      expect(rows.map((x) => [x.at, x.final.orders, x.final.points]), keyOf(v)).toEqual(t.STAND_FULL[keyOf(v)]);
    }
  }, 180_000);

  it('INTRO_LOG, SLOW_LOG, TRIM_LOG', async () => {
    const call = { call: (cmd: string, ...a: string[]) => r.call(cmd, ...a) as never };
    for (const [steps, stand] of [
      [t.RAW_INTRO, t.INTRO_LOG],
      [t.RAW_SLOW, t.SLOW_LOG],
      [t.RAW_TRIM, t.TRIM_LOG],
    ] as const) {
      await r.flushall();
      expect(await replayRaw(call, [...steps], sleep, model.showReply)).toEqual(stand);
    }
  }, 10_000);
});

// ─── Два сеанса Postgres: только при QUEUES_PG_CONTAINER ──────────────────────────────────

const PG_CONTAINER = process.env.QUEUES_PG_CONTAINER;

class PsqlSession {
  out = '';
  err = '';
  n = 0;
  p: ChildProcessWithoutNullStreams;
  constructor(public name: string) {
    this.p = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=q${name}`, PG_CONTAINER!, 'psql', '-U', 'postgres', '-d', 'qlab', '-X', '-A', '-t']);
    this.p.stdout.on('data', (d) => (this.out += d));
    this.p.stderr.on('data', (d) => (this.err += d));
    this.p.stdin.write('\\set VERBOSITY verbose\n');
  }
  send(sql: string) {
    const k = `@@${this.name}${++this.n}`;
    const tk = { k, o: this.out.length, e: this.err.length };
    this.p.stdin.write(`${sql}\n\\echo ${k}\n\\warn ${k}\n`);
    return tk;
  }
  done(tk: { k: string; o: number; e: number }) {
    return this.out.includes(`${tk.k}\n`, tk.o) && this.err.includes(`${tk.k}\n`, tk.e);
  }
  result(tk: { k: string; o: number; e: number }) {
    const errLine = this.err.slice(tk.e, this.err.indexOf(`${tk.k}\n`, tk.e)).split('\n').find((l) => l.startsWith('ERROR:'));
    if (errLine) return `ошибка ${/^ERROR:\s+(\w{5})/.exec(errLine)![1]}`;
    return this.out.slice(tk.o, this.out.indexOf(`${tk.k}\n`, tk.o)).split('\n').filter(Boolean).join(' / ') || '(пусто)';
  }
}

const admin = (sql: string) =>
  execFileSync('docker', ['exec', '-i', PG_CONTAINER!, 'psql', '-U', 'postgres', '-d', 'qlab', '-X', '-A', '-t', '-q'], { input: sql, stdio: 'pipe' })
    .toString()
    .trim();

/** Шаги по очереди; шаг, вставший на блокировку (видно по pg_stat_activity), дописывается, когда закончит. */
async function twoSessions(steps: [string, string][]) {
  admin(t.SCHEMA_SQL.replace(/CREATE TABLE (\w+)/g, 'DROP TABLE IF EXISTS $1; CREATE TABLE $1'));
  const S: Record<string, PsqlSession> = { A: new PsqlSession('A'), B: new PsqlSession('B') };
  const waiting = (who: string) =>
    admin(`SELECT count(*) FROM pg_stat_activity WHERE application_name = 'q${who}' AND wait_event_type = 'Lock'`) === '1';
  const log: string[] = [];
  const open: { who: string; tk: ReturnType<PsqlSession['send']>; i: number }[] = [];
  const flush = (i: number) => {
    for (const w of [...open]) {
      if (w.i === i || !S[w.who].done(w.tk)) continue;
      log.push(`${w.who}: …дождался → ${S[w.who].result(w.tk)}`);
      open.splice(open.indexOf(w), 1);
    }
  };
  for (const [i, [who, sql]] of steps.entries()) {
    const tk = S[who].send(sql);
    let finished = false;
    for (let j = 0; j < 200; j++) {
      if (S[who].done(tk)) {
        finished = true;
        break;
      }
      await sleep(10);
      if (j > 5 && waiting(who)) break;
    }
    if (finished) log.push(`${who}: ${sql} → ${S[who].result(tk)}`);
    else {
      log.push(`${who}: ${sql} → ждёт`);
      open.push({ who, tk, i });
    }
    flush(i);
    await sleep(50);
    flush(i);
  }
  Object.values(S).forEach((s) => s.p.stdin.end());
  return { log, points: Number(admin('SELECT points FROM wallets WHERE user_id = 7')) };
}

describe.runIf(PG_CONTAINER)('стенд: два сеанса Postgres в Docker', () => {
  it('версия Postgres', () => {
    expect(admin('SELECT version()')).toContain(t.STAND_VERSIONS.postgres);
  });

  for (const [id, steps] of Object.entries(t.PG_SCENARIOS)) {
    it(`PG_RUNS: ${id}`, async () => {
      expect(await twoSessions(steps)).toEqual(t.PG_RUNS[id]);
    }, 20_000);
  }
});
