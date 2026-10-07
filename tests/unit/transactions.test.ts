import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/data/transactions/data';
import { finalOf, formatStep, loadModel } from '@/widgets/mvcc-lab/model/run';
import type { Level, Op, RowLockMode, Scenario, Session } from '@/widgets/mvcc-lab/model/types';

/**
 * Тема «Транзакции и уровни изоляции».
 *
 * Учебная модель — строки `ENGINE_CODE`, `SNAPSHOT_CODE`, `WRITE_CODE`, `SSI_CODE` из темы,
 * её же исполняет демо. Здесь она сверяется:
 *   — с выводом двух настоящих сеансов Postgres 16 (`STAND_RUNS`) — шаг в шаг на всех
 *     сценариях и уровнях: строки ответа, код и текст ошибки, кто ждал и до какого шага, итог;
 *   — с PGlite (Postgres 18.3, одна сессия) — версии на странице, `xmin`/`xmax`, бит
 *     «только блокировка», снимки и ленивый номер транзакции.
 *
 * Сами литералы двух сеансов пересобираются, только если задан `TX_PG_CONTAINER` — имя
 * запущенного контейнера `postgres:16-alpine` (`docker run -d --name tx-pg -e POSTGRES_PASSWORD=x
 * -e POSTGRES_DB=txlab postgres:16-alpine`). Клиентский пакет не нужен: сеансы — `psql` внутри
 * контейнера. Без переменной этот блок пропускается.
 */

const PARTS = [t.ENGINE_CODE, t.SNAPSHOT_CODE, t.WRITE_CODE, t.SSI_CODE];
const model = loadModel(PARTS);
const levelSql = (l: Level) => t.LEVELS.find((x) => x.value === l)!.sql;
const run = (sc: Scenario, level: Level) => model.runSchedule(structuredClone(sc.rows), sc.steps, level);

describe('модель шаг в шаг совпадает с двумя сеансами Postgres', () => {
  for (const sc of t.SCENARIOS) {
    for (const { value: level } of t.LEVELS) {
      it(`${sc.id} / ${level}`, () => {
        const stand = t.STAND_RUNS[`${sc.id}/${level}`];
        expect(stand, 'нет литерала стенда').toBeDefined();
        expect(run(sc, level).out.map(formatStep)).toEqual(stand.steps);
        expect(finalOf(model, sc, level)).toBe(stand.final);
      });
    }
  }

  it('литералов ровно столько, сколько сценариев × уровней', () => {
    expect(Object.keys(t.STAND_RUNS).sort()).toEqual(
      t.SCENARIOS.flatMap((s) => t.LEVELS.map((l) => `${s.id}/${l.value}`)).sort(),
    );
  });

  it('числа, выделенные в итогах, действительно есть в выводе стенда', () => {
    for (const sc of t.SCENARIOS) {
      for (const { value: level } of t.LEVELS) {
        const stand = t.STAND_RUNS[`${sc.id}/${level}`];
        const seen = [...stand.steps, stand.final].join('\n');
        for (const m of sc.verdict[level].matchAll(/\*\*([^*]+)\*\*/g)) {
          if (!/^[\d|/ ]+$/.test(m[1])) continue;
          expect(seen, `${sc.id}/${level}: «${m[1]}»`).toContain(m[1]);
        }
        // Код ошибки, названный в итоге, есть в выводе.
        for (const m of sc.verdict[level].matchAll(/`(\d\dP?\d\d\d?)`/g)) {
          expect(seen, `${sc.id}/${level}: ${m[1]}`).toContain(`ERROR ${m[1]}`);
        }
      }
    }
  });
});

/** Ячейки таблицы уровней по выводу стенда. */
function anomalyCells(level: Level) {
  const r = (id: string) => t.STAND_RUNS[`${id}/${level}`];
  const has40001 = (id: string) => r(id).steps.some((s) => s.includes('ERROR 40001'));
  const verdict = (anomaly: boolean, id: string) => (anomaly ? 'есть' : has40001(id) ? 'нет — `40001`' : 'нет');
  const dirty = r('dirty-read').steps;
  const nr = r('non-repeatable').steps;
  const ph = r('phantom').steps;
  return {
    level: t.LEVELS.find((l) => l.value === level)!.label,
    dirty: verdict(dirty[3] === '150' || dirty[5] === '150', 'dirty-read'),
    nonrepeatable: verdict(nr[1] !== nr[5], 'non-repeatable'),
    phantom: verdict(ph[1] !== ph[5], 'phantom'),
    lost: verdict(r('lost-update').final === '120', 'lost-update'),
    skew: verdict(r('write-skew').final === '0', 'write-skew'),
  };
}

describe('таблицы темы следуют из стенда', () => {
  it('LEVEL_TABLE', () => {
    expect(t.LEVELS.map((l) => anomalyCells(l.value))).toEqual(t.LEVEL_TABLE);
  });

  it('READ UNCOMMITTED не читает грязное', () => {
    expect(t.DIRTY_RU).toEqual(['100', '100']);
  });

  it('CONFLICTS модели — та же матрица, что сняли NOWAIT', () => {
    for (const held of t.LOCK_MODES) {
      for (const wanted of t.LOCK_MODES) {
        expect(model.CONFLICTS[held.mode].includes(wanted.mode), `${held.mode} / ${wanted.mode}`).toBe(
          t.LOCK_MATRIX[held.mode][wanted.mode],
        );
      }
    }
  });

  it('вставка ребёнка ждёт ровно тогда, когда режим родителя мешает FOR KEY SHARE', () => {
    for (const row of t.FK_ROWS) expect(row.waits).toBe(t.LOCK_MATRIX[row.mode]['key share']);
  });

  it('упорядоченный захват: без дедлока, второй ждёт на SELECT, оба перевода прошли', () => {
    expect(t.ORDERED_RUN.steps.join('\n')).not.toContain('40P01');
    expect(t.ORDERED_RUN.steps[3]).toMatch(/^ждал до шага 7 → /);
    expect(t.ORDERED_RUN.final).toBe('1|100 / 2|100');
  });

  it('SKIP LOCKED: комментарий в примере — то, что вернул стенд', () => {
    expect(t.SKIP_LOCKED_SQL).toContain(`сеанс B: ${t.SKIP_LOCKED_RUN}`);
  });
});

// ─── PGlite: одна сессия ───────────────────────────────────────────────────────────────────

async function fresh(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pageinspect } });
  await db.exec('CREATE EXTENSION pageinspect;');
  return db;
}

const le32 = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, 4).getInt32(0, true);

describe('PGlite: версии строк и снимки одной сессии', () => {
  it('HEAP_ROWS — то, что лежит на странице после HEAP_SQL', async () => {
    const db = await fresh();
    // Каждый блок — отдельным вызовом: несколько команд в одном `exec` PGlite шлёт одним
    // простым запросом, и без явного BEGIN они становятся одной транзакцией.
    for (const chunk of t.HEAP_SQL.split('\n\n')) await db.exec(chunk);
    const items = (
      await db.query<{ lp: number; t_xmin: string; t_xmax: string; t_ctid: string }>(
        `SELECT lp, t_xmin, t_xmax, t_ctid FROM heap_page_items(get_raw_page('accounts', 0)) ORDER BY lp`,
      )
    ).rows;
    const attrs = (
      await db.query<{ t_attrs: Uint8Array[] }>(
        `SELECT t_attrs FROM heap_page_item_attrs(get_raw_page('accounts', 0), 'accounts'::regclass) ORDER BY lp`,
      )
    ).rows;
    expect(
      items.map((r, i) => ({
        lp: r.lp,
        xmin: Number(r.t_xmin),
        xmax: Number(r.t_xmax),
        ctid: r.t_ctid,
        id: le32(attrs[i].t_attrs[0]),
        balance: le32(attrs[i].t_attrs[2]),
      })),
    ).toEqual(t.HEAP_ROWS.map(({ lp, xmin, xmax, ctid, id, balance }) => ({ lp, xmin, xmax, ctid, id, balance })));

    // HEAP_NOTE: SELECT видит одну строку — Аню, 110, xmin 754, xmax 755.
    const live = (await db.query<{ xmin: string; xmax: string; owner: string; balance: number }>('SELECT xmin, xmax, owner, balance FROM accounts')).rows;
    expect(live).toEqual([{ xmin: '754', xmax: '755', owner: 'Аня', balance: 110 }]);
    expect(t.HEAP_NOTE).toContain('`xmin` 754 и `xmax` 755');
    await db.close();
  });

  it('SNAP_SQL: значения в комментариях — ответы Postgres', async () => {
    const db = await fresh();
    await db.exec(t.ACCOUNTS_SQL);
    for (const line of t.SNAP_SQL.split('\n')) {
      const [sql, comment] = line.split(/\s+-- /);
      const r = await db.query<Record<string, unknown>>(sql);
      if (!comment) continue;
      const got = r.rows[0] ? Object.values(r.rows[0])[0] : undefined;
      expect(String(got ?? 'NULL'), sql).toBe(comment.split(':')[0] === 'NULL' ? 'NULL' : comment.trim());
    }
    await db.close();
  });

  it('модель повторяет PGlite: xmin/xmax, бит блокировки, снимки, видимость', async () => {
    const db = await fresh();
    await db.exec(t.ACCOUNTS_SQL);
    const base = Number((await db.query<{ xmin: string }>('SELECT xmin FROM accounts LIMIT 1')).rows[0].xmin);
    const rel = (x: string | number | null) => (Number(x) === 0 ? 0 : Number(x) - base);

    const pgHeap = async () =>
      (
        await db.query<{ t_xmin: string; t_xmax: string; lock_only: boolean }>(
          `SELECT t_xmin, t_xmax, (t_infomask & 128) <> 0 AS lock_only FROM heap_page_items(get_raw_page('accounts', 0)) ORDER BY lp`,
        )
      ).rows.map((r) => `${rel(r.t_xmin)}/${rel(r.t_xmax)}${r.lock_only ? ' lock' : ''}`);
    const pgSnap = async () => {
      const r = (await db.query<{ s: string; x: string | null }>('SELECT pg_current_snapshot()::text AS s, pg_current_xact_id_if_assigned()::text AS x')).rows[0];
      return `${r.s.split(':').map((p) => p.split(',').filter(Boolean).map(rel).join(',')).join(':')} x=${r.x === null ? 'null' : rel(r.x)}`;
    };

    const mdb = model.createDb(structuredClone(t.ACCOUNT_ROWS));
    const sess: Session = { name: 'A', tx: null };
    const step = (op: Op) => {
      const r = model.execute(mdb, sess, op, 'read committed').next();
      expect(r.done).toBe(true);
      return r.value;
    };
    const mHeap = () =>
      mdb.versions.map((v) => {
        const lockOnly = v.xmax === null && v.locks.length > 0;
        const xmax = v.xmax ?? v.locks.at(-1)?.xid ?? null;
        return `${v.xmin - 100}/${xmax === null ? 0 : xmax - 100}${lockOnly ? ' lock' : ''}`;
      });
    const mSnap = () => {
      const s = model.takeSnapshot(mdb);
      const x = sess.tx?.xid ?? null;
      return `${s.xmin - 100}:${s.xmax - 100}:${s.xip.map((v) => v - 100).join(',')} x=${x === null ? 'null' : x - 100}`;
    };

    const seq: [string, Op][] = [
      ['BEGIN', { t: 'begin' }],
      ['UPDATE accounts SET balance = 110 WHERE id = 1', { t: 'update', where: { id: 1 }, set: { balance: 110 } }],
      ['DELETE FROM accounts WHERE id = 2', { t: 'delete', where: { id: 2 } }],
      ['SELECT balance FROM accounts', { t: 'select', where: {}, cols: ['balance'] }],
      ['COMMIT', { t: 'commit' }],
      ['BEGIN', { t: 'begin' }],
      ['SELECT balance FROM accounts WHERE id = 1 FOR UPDATE', { t: 'select', where: { id: 1 }, cols: ['balance'], lock: 'update' }],
      ['ROLLBACK', { t: 'rollback' }],
      ['BEGIN', { t: 'begin' }],
      ["INSERT INTO accounts VALUES (3, 'Вера', 500, 1)", { t: 'insert', row: { id: 3, owner: 'Вера', balance: 500, version: 1 } }],
      ['SELECT count(*) FROM accounts WHERE balance >= 100', { t: 'select', where: { balance: { gte: 100 } }, count: true }],
      ['ROLLBACK', { t: 'rollback' }],
      ['SELECT count(*) FROM accounts WHERE balance >= 100', { t: 'select', where: { balance: { gte: 100 } }, count: true }],
    ];
    expect(await pgSnap()).toBe(mSnap());
    for (const [sql, op] of seq) {
      const r = await db.query<Record<string, unknown>>(sql);
      const pgLines = r.rows.map((x) => Object.values(x).join('|'));
      const lines = step(op);
      if (/^SELECT/.test(sql)) expect(lines, sql).toEqual(pgLines);
      expect(await pgHeap(), sql).toEqual(mHeap());
      expect(await pgSnap(), sql).toEqual(mSnap());
    }
    await db.close();
  });

  it('SET TRANSACTION после первого запроса — 25001; уровень по умолчанию — read committed', async () => {
    const db = await fresh();
    await db.exec('BEGIN; SELECT 1;');
    await expect(db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')).rejects.toMatchObject({ code: '25001' });
    await db.exec('ROLLBACK');
    expect((await db.query<{ v: string }>('SHOW default_transaction_isolation')).rows[0]).toEqual({
      default_transaction_isolation: t.SHOW_DEFAULTS.default_transaction_isolation,
    });
    expect((await db.query('SHOW deadlock_timeout')).rows[0]).toEqual({ deadlock_timeout: t.SHOW_DEFAULTS.deadlock_timeout });
    await db.close();
  });
});

describe('RETRY_CODE на настоящей ошибке 40001', () => {
  type Client = { query: (sql: string) => Promise<unknown>; release: () => void };
  const inTransaction = new Function(`${t.RETRY_CODE}\nreturn inTransaction;`)() as (
    pool: { connect: () => Promise<Client> },
    level: string,
    work: (c: Client) => Promise<unknown>,
    attempts?: number,
  ) => Promise<unknown>;

  async function pool() {
    const db = await fresh();
    await db.exec(t.ACCOUNTS_SQL);
    const log: string[] = [];
    const client: Client = {
      query: (sql: string) => {
        log.push(sql.split(' ')[0]);
        return db.query(sql);
      },
      release: () => {},
    };
    return { db, log, pool: { connect: async () => client } };
  }
  const raise = (code: string) => `DO $$ BEGIN RAISE EXCEPTION 'нарочно' USING ERRCODE = '${code}'; END $$`;

  it('повторяет всю работу, а откаченная попытка не оставляет следа', async () => {
    const { db, pool: p, log } = await pool();
    let calls = 0;
    const result = await inTransaction(p, 'REPEATABLE READ', async (c) => {
      calls++;
      await c.query('UPDATE accounts SET balance = balance + 10 WHERE id = 1');
      if (calls === 1) await c.query(raise('40001'));
      return calls;
    });
    expect(result).toBe(2);
    expect((await db.query('SELECT balance FROM accounts WHERE id = 1')).rows).toEqual([{ balance: 110 }]);
    expect(log).toEqual(['BEGIN', 'UPDATE', 'DO', 'ROLLBACK', 'BEGIN', 'UPDATE', 'COMMIT']);
    await db.close();
  });

  it('40P01 тоже повторяется, 23505 — нет, попытки кончаются', async () => {
    const { db, pool: p } = await pool();
    let n = 0;
    await inTransaction(p, 'READ COMMITTED', async (c) => {
      if (++n === 1) await c.query(raise('40P01'));
    });
    expect(n).toBe(2);
    n = 0;
    await expect(inTransaction(p, 'READ COMMITTED', async (c) => { n++; await c.query(raise('23505')); })).rejects.toMatchObject({ code: '23505' });
    expect(n).toBe(1);
    n = 0;
    await expect(inTransaction(p, 'READ COMMITTED', async (c) => { n++; await c.query(raise('40001')); }, 3)).rejects.toMatchObject({ code: '40001' });
    expect(n).toBe(3);
    await db.close();
  });
});

// ─── Два настоящих сеанса: только при TX_PG_CONTAINER ─────────────────────────────────────

const CONTAINER = process.env.TX_PG_CONTAINER;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class PsqlSession {
  out = '';
  err = '';
  n = 0;
  p: ChildProcessWithoutNullStreams;
  constructor(public name: string) {
    this.p = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${name}`, CONTAINER!, 'psql', '-U', 'postgres', '-d', 'txlab', '-X', '-A', '-t']);
    this.p.stdout.on('data', (d) => (this.out += d));
    this.p.stderr.on('data', (d) => (this.err += d));
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
    const lines = this.out.slice(tk.o, this.out.indexOf(`${tk.k}\n`, tk.o)).split('\n').filter(Boolean);
    const errLine = this.err.slice(tk.e, this.err.indexOf(`${tk.k}\n`, tk.e)).split('\n').find((l) => l.startsWith('ERROR:'));
    const m = errLine ? /^ERROR:\s+(\w{5}): (.*)$/.exec(errLine) : null;
    return { lines, error: m ? { code: m[1], message: m[2] } : null };
  }
  async wait(tk: { k: string; o: number; e: number }) {
    for (let i = 0; !this.done(tk); i++) {
      if (i > 500) throw new Error(`psql ${this.name}: нет ответа`);
      await sleep(10);
    }
    return this.result(tk);
  }
}

const admin = (sql: string) =>
  execFileSync('docker', ['exec', '-i', CONTAINER!, 'psql', '-U', 'postgres', '-d', 'txlab', '-X', '-A', '-t', '-q'], { input: sql })
    .toString()
    .trim()
    .split('\n')
    .join(' / ');

/** Шаги по очереди; шаг, вставший на блокировку (видно по pg_stat_activity), дописывается, когда закончит. */
async function twoSessions(setup: string, steps: { s: string; sql: string }[]): Promise<string[]> {
  admin(`DROP TABLE IF EXISTS orders; DROP TABLE IF EXISTS accounts; DROP TABLE IF EXISTS doctors;\n${setup}`);
  const S: Record<string, PsqlSession> = { A: new PsqlSession('A'), B: new PsqlSession('B') };
  const mon = new PsqlSession('M');
  for (const s of Object.values(S)) await s.wait(s.send(`\\set VERBOSITY verbose\nSET deadlock_timeout = '200ms';`));
  const settle = async (s: PsqlSession, tk: ReturnType<PsqlSession['send']>) => {
    for (;;) {
      if (s.done(tk)) return 'done';
      const r = await mon.wait(mon.send(`select count(*) from pg_stat_activity where application_name = '${s.name}' and wait_event_type = 'Lock';`));
      if (r.lines[0] === '1') return 'blocked';
    }
  };
  const recs: { s: string; tk: ReturnType<PsqlSession['send']>; blocked: boolean; until?: number }[] = [];
  const pending = new Map<string, number>();
  for (let i = 0; i < steps.length; i++) {
    const tk = S[steps[i].s].send(steps[i].sql);
    const blocked = (await settle(S[steps[i].s], tk)) === 'blocked';
    recs.push({ s: steps[i].s, tk, blocked });
    if (blocked) {
      pending.set(steps[i].s, i);
      await sleep(500);
    }
    await sleep(50);
    for (const [name, idx] of pending) {
      if ((await settle(S[name], recs[idx].tk)) === 'done') {
        recs[idx].until = i;
        pending.delete(name);
      }
    }
  }
  for (const s of [...Object.values(S), mon]) s.p.stdin.end();
  return recs.map((r) => {
    const { lines, error } = S[r.s].result(r.tk);
    return formatStep({ s: r.s as 'A', sql: '', lines, error, waited: r.blocked, until: r.until ?? null });
  });
}

describe.runIf(CONTAINER)('стенд: два сеанса Postgres в Docker', () => {
  const setupOf = (sc: Scenario) => (sc.table === 'doctors' ? t.DOCTORS_SQL : t.ACCOUNTS_SQL);

  for (const sc of t.SCENARIOS) {
    for (const { value: level } of t.LEVELS) {
      it(`${sc.id} / ${level}`, async () => {
        const steps = await twoSessions(setupOf(sc), sc.steps.map((s) => ({ s: s.s, sql: s.sql.replace('{level}', levelSql(level)) })));
        expect({ steps, final: admin(sc.check.sql) }).toEqual(t.STAND_RUNS[`${sc.id}/${level}`]);
      }, 30_000);
    }
  }

  it('READ UNCOMMITTED, матрица блокировок, внешний ключ, SKIP LOCKED, порядок захвата, умолчания', async () => {
    const dirty = t.SCENARIOS.find((s) => s.id === 'dirty-read')!;
    const ru = await twoSessions(t.ACCOUNTS_SQL, dirty.steps.map((s) => ({ s: s.s, sql: s.sql.replace('{level}', 'READ UNCOMMITTED') })));
    expect([ru[3], ru[5]]).toEqual(t.DIRTY_RU);

    for (const a of t.LOCK_MODES) {
      for (const b of t.LOCK_MODES) {
        const out = await twoSessions(t.ACCOUNTS_SQL, [
          { s: 'A', sql: 'BEGIN;' }, { s: 'A', sql: `SELECT id FROM accounts WHERE id = 1 ${a.sql};` },
          { s: 'B', sql: 'BEGIN;' }, { s: 'B', sql: `SELECT id FROM accounts WHERE id = 1 ${b.sql} NOWAIT;` },
          { s: 'A', sql: 'COMMIT;' }, { s: 'B', sql: 'COMMIT;' },
        ]);
        expect(out[3].startsWith('ERROR 55P03'), `${a.mode} / ${b.mode}`).toBe(t.LOCK_MATRIX[a.mode as RowLockMode][b.mode as RowLockMode]);
      }
    }

    const fkSetup = `${t.ACCOUNTS_SQL}\n${t.FK_SQL.split('-- ')[0]}`;
    const fkSql: Record<string, string> = {
      'SELECT … WHERE id = 1 FOR UPDATE': 'SELECT id FROM accounts WHERE id = 1 FOR UPDATE;',
      'SELECT … WHERE id = 1 FOR NO KEY UPDATE': 'SELECT id FROM accounts WHERE id = 1 FOR NO KEY UPDATE;',
      'UPDATE accounts SET balance = 110 WHERE id = 1': 'UPDATE accounts SET balance = 110 WHERE id = 1;',
      'UPDATE accounts SET id = 10 WHERE id = 1': 'UPDATE accounts SET id = 10 WHERE id = 1;',
    };
    for (const row of t.FK_ROWS) {
      const out = await twoSessions(fkSetup, [
        { s: 'A', sql: 'BEGIN;' }, { s: 'A', sql: fkSql[row.a] },
        { s: 'B', sql: 'BEGIN;' }, { s: 'B', sql: 'INSERT INTO orders VALUES (1, 1);' },
        { s: 'A', sql: 'ROLLBACK;' }, { s: 'B', sql: 'COMMIT;' },
      ]);
      expect(out[3].startsWith('ждал'), row.a).toBe(row.waits);
    }

    const skip = await twoSessions(t.ACCOUNTS_SQL, [
      { s: 'A', sql: 'BEGIN;' }, { s: 'A', sql: 'SELECT id FROM accounts WHERE id = 1 FOR UPDATE;' },
      { s: 'B', sql: 'BEGIN;' }, { s: 'B', sql: 'SELECT id FROM accounts ORDER BY id FOR UPDATE SKIP LOCKED;' },
      { s: 'A', sql: 'COMMIT;' }, { s: 'B', sql: 'COMMIT;' },
    ]);
    expect(skip[3]).toBe(t.SKIP_LOCKED_RUN);

    const lock = t.ORDERED_SQL.split('\n').find((l) => l.startsWith('SELECT'))!;
    const ord = await twoSessions(t.ACCOUNTS_SQL, [
      { s: 'A', sql: 'BEGIN;' }, { s: 'B', sql: 'BEGIN;' }, { s: 'A', sql: lock }, { s: 'B', sql: lock },
      { s: 'A', sql: 'UPDATE accounts SET balance = balance - 10 WHERE id = 1;' },
      { s: 'A', sql: 'UPDATE accounts SET balance = balance + 10 WHERE id = 2;' },
      { s: 'A', sql: 'COMMIT;' },
      { s: 'B', sql: 'UPDATE accounts SET balance = balance - 10 WHERE id = 2;' },
      { s: 'B', sql: 'UPDATE accounts SET balance = balance + 10 WHERE id = 1;' },
      { s: 'B', sql: 'COMMIT;' },
    ]);
    expect({ steps: ord, final: admin('SELECT id, balance FROM accounts ORDER BY id;') }).toEqual(t.ORDERED_RUN);

    expect(admin('SHOW default_transaction_isolation; SHOW deadlock_timeout;')).toBe(
      `${t.SHOW_DEFAULTS.default_transaction_isolation} / ${t.SHOW_DEFAULTS.deadlock_timeout}`,
    );
  }, 300_000);
});
