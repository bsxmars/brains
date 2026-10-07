import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/db-migrations/data';
import { loadBackfill, loadCompat } from '@/widgets/migration-lab/model/run';
import type { Schema, StatementCost, VersionId } from '@/widgets/migration-lab/model/types';

/**
 * Тема «Миграции базы без простоя».
 *
 * Стенд — настоящий Postgres 18.3 в WebAssembly (`@electric-sql/pglite` 0.5.8), в процессе теста.
 * Здесь пересобирается всё, что тема утверждает о базе: какую блокировку берёт оператор
 * (`pg_locks` своей транзакции), переписывает ли он таблицу (`relfilenode`), читает ли её целиком
 * (`pg_stat_xact_user_tables.seq_scan`), что отвечают запросы трёх версий кода на каждом шаге,
 * размеры таблицы при переносе и планы `EXPLAIN`.
 *
 * `COMPAT_CODE` — строка из темы, её же исполняет демо. Её вердикт по каждому из девяти запросов
 * на каждом шаге обоих планов сверяется с тем, что ответил Postgres на тот же запрос.
 *
 * Чего здесь нет: двух сессий. В PGlite одна сессия, поэтому конфликт блокировок, очередь
 * и `lock_timeout` в деле не проверить — это в теме помечено как взятое из документации.
 */

const compat = loadCompat(t.COMPAT_CODE);
const backfill = loadBackfill(t.BACKFILL_CODE);
const TABLE = t.TABLE_NAME;

const MODE_ORDER = [
  'AccessShareLock',
  'RowShareLock',
  'RowExclusiveLock',
  'ShareUpdateExclusiveLock',
  'ShareLock',
  'ShareRowExclusiveLock',
  'ExclusiveLock',
  'AccessExclusiveLock',
];

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(t.TABLE_SQL);
  await db.exec(t.FILL_SQL);
  return db;
}

const one = async <T>(db: PGlite, sql: string): Promise<T> => (await db.query<T>(sql)).rows[0];

const relfilenode = (db: PGlite) =>
  one<{ relfilenode: number }>(db, `SELECT relfilenode FROM pg_class WHERE relname = '${TABLE}'`).then((r) => r.relfilenode);

const seqScans = (db: PGlite) =>
  one<{ seq_scan: number } | undefined>(db, `SELECT seq_scan FROM pg_stat_xact_user_tables WHERE relname = '${TABLE}'`).then((r) =>
    Number(r?.seq_scan ?? 0),
  );

/** Самый сильный режим на самой таблице в текущей транзакции — то, что печатает `LOCK_PROBE_SQL`. */
async function strongestLock(db: PGlite): Promise<string> {
  const rows = (
    await db.query<{ mode: string }>(`SELECT mode FROM pg_locks WHERE pid = pg_backend_pid() AND relation = '${TABLE}'::regclass`)
  ).rows.map((r) => r.mode);
  return rows.sort((a, b) => MODE_ORDER.indexOf(b) - MODE_ORDER.indexOf(a))[0];
}

/** Выполнить оператор в своей транзакции и снять цену. Ошибка — откат и её код. */
async function measure(db: PGlite, sql: string): Promise<StatementCost & { error?: string }> {
  const before = await relfilenode(db);
  await db.exec('BEGIN');
  const scans0 = await seqScans(db);
  try {
    await db.query(sql);
  } catch (e) {
    await db.exec('ROLLBACK');
    return { lock: '', rewrite: false, scans: 0, error: (e as { code: string }).code };
  }
  const scans = (await seqScans(db)) - scans0;
  const lock = await strongestLock(db);
  await db.exec('COMMIT');
  return { lock, rewrite: (await relfilenode(db)) !== before, scans };
}

/** Код ошибки Postgres на запрос (или `ok`) — запрос под точкой сохранения, без следов в данных. */
async function outcome(db: PGlite, sql: string): Promise<{ code: string; column?: string }> {
  await db.exec('BEGIN');
  try {
    await db.query(sql);
    return { code: 'ok' };
  } catch (e) {
    const err = e as { code: string; column?: string; message: string };
    const column = err.column ?? /column "([^"]+)"/.exec(err.message)?.[1];
    return { code: err.code, column };
  } finally {
    await db.exec('ROLLBACK');
  }
}

/** Схема таблицы из каталога в той же форме, что `Schema` темы. */
async function schemaOf(db: PGlite): Promise<Schema> {
  const rows = (
    await db.query<{ column_name: string; is_nullable: string; column_default: string | null; is_identity: string }>(
      `SELECT column_name, is_nullable, column_default, is_identity
       FROM information_schema.columns WHERE table_name = '${TABLE}' ORDER BY ordinal_position`,
    )
  ).rows;
  return Object.fromEntries(
    rows.map((r) => [r.column_name, { notNull: r.is_nullable === 'NO', hasDefault: r.column_default !== null || r.is_identity === 'YES' }]),
  );
}

describe('стенд: Postgres той версии, что в шапке', () => {
  it('PGlite 0.5.8 = PostgreSQL 18.3', async () => {
    const db = new PGlite();
    const { version } = await one<{ version: string }>(db, 'SELECT version()');
    expect(version).toMatch(/^PostgreSQL 18\.3 \(PGlite 0\.5\.8\)/);
    expect((await one<{ lock_timeout: string }>(db, 'SHOW lock_timeout')).lock_timeout).toBe('0');
    await db.exec("SET lock_timeout = '3s'");
    expect((await one<{ lock_timeout: string }>(db, 'SHOW lock_timeout')).lock_timeout).toBe('3s');
  });
});

describe('что видит старый код после изменения — SAFETY_ROWS', () => {
  for (const row of t.SAFETY_ROWS) {
    it(row.sql, async () => {
      const db = await freshDb();
      const r = await measure(db, row.sql);
      expect(r.error ?? 'ok').toBe(row.migration);
      const got = [];
      for (const sql of t.VERSIONS.v1) got.push((await outcome(db, sql)).code);
      expect(got).toEqual(row.v1);
    });
  }

  it('на пустой таблице обязательный столбец без DEFAULT добавляется — и ломает INSERT старого кода', async () => {
    const db = new PGlite();
    await db.exec(t.TABLE_SQL);
    expect((await measure(db, 'ALTER TABLE users ADD COLUMN full_name text NOT NULL')).error).toBeUndefined();
    expect((await outcome(db, t.VERSIONS.v1[1])).code).toBe('23502');
  });
});

describe('планы демо: схема, цена и ответы всех версий на каждом шаге', () => {
  for (const plan of t.PLANS) {
    it(`план «${plan.label}»`, async () => {
      const db = await freshDb();
      for (const step of plan.steps) {
        for (const st of step.statements) {
          // Пачка переноса в плане — первая; дальше переносим всё, чтобы следующий шаг прошёл.
          expect(await measure(db, st.sql), `${step.id}: ${st.sql}`).toEqual(st.cost);
        }
        if (step.id === 'backfill') await db.exec('UPDATE users SET full_name = name WHERE full_name IS NULL');

        expect(await schemaOf(db), `схема после «${step.label}»`).toEqual(step.schema);

        for (const v of ['v1', 'v2', 'v3'] as VersionId[]) {
          for (const sql of t.VERSIONS[v]) {
            const real = await outcome(db, sql);
            const model = compat.check(step.schema, TABLE, sql);
            expect(model?.code ?? 'ok', `${step.id} · ${v} · ${sql}`).toBe(real.code);
            if (model) expect(model.column, `${step.id} · ${v} · ${sql}`).toBe(real.column);
          }
        }
      }
    }, 60_000);
  }

  it('вердикт шагов: в «расширить и сузить» не ломается ни одна работающая версия', () => {
    const verdicts = (planId: string) =>
      t.PLANS.find((p) => p.id === planId)!.steps.map((s) =>
        compat.stepVerdict(s.schema, TABLE, t.VERSIONS, s.live, s.fallback).map((b) => `${b.version}${b.fallback ? ' (откат)' : ''}`),
      );
    expect(verdicts('expand')).toEqual([[], [], [], [], ['v1 (откат)'], [], ['v2 (откат)']]);
    expect(verdicts('rename')).toEqual([[], ['v1'], ['v1'], ['v1 (откат)']]);
  });

  it('разбор столбцов: функции и строки в кавычках не столбцы', () => {
    expect(compat.columnsOf(t.VERSIONS.v2[0], TABLE)).toEqual(['id', 'full_name', 'name', 'email']);
    expect(compat.columnsOf(t.VERSIONS.v1[1], TABLE)).toEqual(['name', 'email']);
    expect(compat.insertedColumns(t.VERSIONS.v2[1])).toEqual(['name', 'full_name', 'email']);
    expect(compat.insertedColumns(t.VERSIONS.v1[0])).toBeNull();
  });
});

describe('блокировки и перезапись — REWRITE_ROWS и LOCK_MODES', () => {
  it('каждая строка таблицы — так, как её снял стенд', async () => {
    const db = await freshDb();
    for (const row of t.REWRITE_ROWS) {
      if (row.setup) await db.exec(row.setup);
      const r = await measure(db, row.sql);
      if (row.error) {
        expect(r.error, row.sql).toBe(row.error);
        continue;
      }
      expect(r, row.sql).toEqual({ lock: row.lock, rewrite: row.rewrite, scans: row.scans });
    }
  }, 60_000);

  it('DEFAULT now() — одно время на все старые строки', async () => {
    const db = await freshDb();
    await db.exec('ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()');
    expect(Number((await one<{ n: number }>(db, 'SELECT count(DISTINCT created_at) AS n FROM users')).n)).toBe(1);
  });

  it('LOCK_PROBE_SQL печатает AccessExclusiveLock', async () => {
    const db = await freshDb();
    const results = await db.exec(t.LOCK_PROBE_SQL);
    const probe = results.find((r) => r.fields.some((f) => f.name === 'mode'))!;
    expect(probe.rows).toEqual([{ what: 'users', mode: 'AccessExclusiveLock' }]);
    expect(Object.keys(await schemaOf(db))).not.toContain('full_name');
  });

  it('режимы в LOCK_MODES берут именно те команды, что подписаны (кроме помеченных doc)', async () => {
    const db = await freshDb();
    await db.exec('ALTER TABLE users ADD COLUMN manager_id bigint');
    await db.exec('ALTER TABLE users ADD CONSTRAINT name_present CHECK (name IS NOT NULL) NOT VALID');
    const real: Record<string, string> = {
      'SELECT … FROM users': 'SELECT * FROM users WHERE id = 1',
      'INSERT INTO users …': "INSERT INTO users (name, email, manager_id) VALUES ('a', 'b', 1)",
      'UPDATE users …': "UPDATE users SET name = 'b' WHERE id = 1",
      'ALTER TABLE users VALIDATE CONSTRAINT …': 'ALTER TABLE users VALIDATE CONSTRAINT name_present',
      'CREATE INDEX … ON users …': 'CREATE INDEX ON users (email)',
      'ALTER TABLE users ADD … FOREIGN KEY … NOT VALID':
        'ALTER TABLE users ADD CONSTRAINT manager_fk FOREIGN KEY (manager_id) REFERENCES users (id) NOT VALID',
      'ALTER TABLE users ADD COLUMN …': 'ALTER TABLE users ADD COLUMN x int',
      'ALTER TABLE users DROP COLUMN …': 'ALTER TABLE users DROP COLUMN x',
      'ALTER TABLE users RENAME …': 'ALTER TABLE users RENAME COLUMN email TO mail',
      'ALTER TABLE users ALTER COLUMN … TYPE …': 'ALTER TABLE users ALTER COLUMN mail TYPE varchar(300)',
      'ALTER TABLE users ALTER COLUMN … SET NOT NULL': 'ALTER TABLE users ALTER COLUMN manager_id SET NOT NULL',
    };
    await db.exec('UPDATE users SET manager_id = 1');
    for (const m of t.LOCK_MODES) {
      for (const cmd of m.takenBy) {
        if (cmd.doc) continue;
        expect(real[cmd.sql], `нет настоящего запроса для «${cmd.sql}»`).toBeDefined();
        expect((await measure(db, real[cmd.sql])).lock, cmd.sql).toBe(m.mode);
      }
    }
  }, 60_000);

  it('NOT NULL … NOT VALID (Postgres 18): без прохода, VALIDATE — проход под SHARE UPDATE EXCLUSIVE', async () => {
    const db = await freshDb();
    await db.exec('ALTER TABLE users ADD COLUMN full_name text');
    await db.exec('UPDATE users SET full_name = name');
    expect(await measure(db, 'ALTER TABLE users ADD CONSTRAINT full_name_nn NOT NULL full_name NOT VALID')).toEqual({
      lock: 'AccessExclusiveLock',
      rewrite: false,
      scans: 0,
    });
    expect(await measure(db, 'ALTER TABLE users VALIDATE CONSTRAINT full_name_nn')).toEqual({
      lock: 'ShareUpdateExclusiveLock',
      rewrite: false,
      scans: 1,
    });
  });

  it('NOT_NULL_SQL выполняется целиком, и столбец становится обязательным', async () => {
    const db = await freshDb();
    await db.exec('ALTER TABLE users ADD COLUMN full_name text');
    await db.exec('UPDATE users SET full_name = name');
    await db.exec(t.NOT_NULL_SQL);
    expect((await schemaOf(db)).full_name).toEqual({ notNull: true, hasDefault: false });
  });

  it('CREATE INDEX CONCURRENTLY: работает вне транзакции, запрещён внутри, упавший оставляет невалидный индекс', async () => {
    const db = await freshDb();
    await db.exec('CREATE INDEX CONCURRENTLY users_email_idx ON users (email)');
    await db.exec('BEGIN');
    await expect(db.exec('CREATE INDEX CONCURRENTLY users_name_idx ON users (name)')).rejects.toThrow(
      'CREATE INDEX CONCURRENTLY cannot run inside a transaction block',
    );
    await db.exec('ROLLBACK');

    await db.exec("INSERT INTO users (name, email) VALUES ('дубль', 'u1@example.com')");
    const err = await db.exec('CREATE UNIQUE INDEX CONCURRENTLY users_email_key ON users (email)').catch((e: { code: string }) => e);
    expect((err as { code: string }).code).toBe('23505');
    const idx = await one<{ indisvalid: boolean }>(
      db,
      "SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = 'users_email_key'",
    );
    expect(idx.indisvalid).toBe(false);

    // Рецепт из INDEX_SQL на чистых данных — проходит целиком.
    const clean = await freshDb();
    for (const stmt of t.INDEX_SQL.split(';').map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) await clean.exec(stmt);
    const con = await one<{ contype: string }>(clean, "SELECT contype FROM pg_constraint WHERE conname = 'users_email_key'");
    expect(con.contype).toBe('u');
  });
});

describe('перенос пачками — BACKFILL_CODE, планы и размеры', () => {
  async function prepared() {
    const db = await freshDb();
    await db.exec('ALTER TABLE users ADD COLUMN full_name text');
    await db.exec('ANALYZE users');
    return db;
  }
  const size = (db: PGlite) => one<{ s: number }>(db, "SELECT pg_relation_size('users') AS s").then((r) => Number(r.s));

  it('10 000 строк → 10 пачек по 1000, всё перенесено; повтор ничего не меняет', async () => {
    const db = await prepared();
    const run = async (sql: string, params: number[]) => (await db.query(sql, params)).affectedRows ?? 0;
    const { max } = await one<{ max: number }>(db, 'SELECT max(id) AS max FROM users');
    expect(await backfill(run, Number(max))).toEqual(Array(10).fill(1000));
    expect(Number((await one<{ n: number }>(db, 'SELECT count(*) AS n FROM users WHERE full_name IS DISTINCT FROM name')).n)).toBe(0);
    expect(await backfill(run, Number(max))).toEqual(Array(10).fill(0));
  });

  it('BATCH_SIZES: один UPDATE, пачки подряд, пачки с VACUUM', async () => {
    const a = await prepared();
    expect(await size(a)).toBe(t.BATCH_SIZES.before);
    await a.exec('UPDATE users SET full_name = name');
    expect(await size(a)).toBe(t.BATCH_SIZES.oneUpdate);

    for (const [vacuum, expected] of [
      [false, t.BATCH_SIZES.batches],
      [true, t.BATCH_SIZES.batchesVacuum],
    ] as const) {
      const db = await prepared();
      const run = async (sql: string, params: number[]) => {
        const n = (await db.query(sql, params)).affectedRows ?? 0;
        if (vacuum) await db.exec('VACUUM users');
        return n;
      };
      await backfill(run, 10000);
      expect(await size(db), vacuum ? 'с VACUUM' : 'без VACUUM').toBe(expected);
    }
  }, 60_000);

  it('PLAN_SUBQUERY и PLAN_RANGE — то, что печатает EXPLAIN', async () => {
    const db = await prepared();
    const plan = async (sql: string, params: number[] = []) =>
      (await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${sql}`, params)).rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(await plan(t.PLAN_SUBQUERY_SQL)).toBe(t.PLAN_SUBQUERY);
    expect(await plan(t.PLAN_RANGE_SQL, [0, 1000])).toBe(t.PLAN_RANGE);
  });

  it('перенос при живой v1: VALIDATE падает с 23514, а обновление имени молча теряется', async () => {
    const db = await prepared();
    const run = async (sql: string, params: number[]) => (await db.query(sql, params)).affectedRows ?? 0;
    await backfill(run, 10000);
    // v1 ещё работает: вставляет строку и меняет имя.
    await db.exec(t.VERSIONS.v1[1]);
    await db.exec(t.VERSIONS.v1[2]);
    const fresh = await one<{ coalesce: string }>(db, t.VERSIONS.v2[0]);
    expect(fresh.coalesce).toBe('Пользователь 1'); // v2 видит старое имя, а не «Анна Ли»
    const plan = t.PLANS.find((p) => p.id === 'expand')!.steps.find((s) => s.id === 'constrain')!;
    await db.exec(plan.statements[0].sql);
    const err = await db.exec(plan.statements[1].sql).catch((e: { code: string }) => e);
    expect((err as { code: string }).code).toBe('23514');
  });
});

describe('откат — TX_DDL_SQL', () => {
  it('упавшая миграция в транзакции не оставляет столбцов', async () => {
    const db = await freshDb();
    const [begin, add, bad] = t.TX_DDL_SQL.split('\n');
    await db.exec(begin);
    await db.exec(add);
    const err = await db.exec(bad).catch((e: { code: string }) => e);
    expect((err as { code: string }).code).toBe('42701');
    await db.exec('ROLLBACK');
    expect(Object.keys(await schemaOf(db))).toEqual(['id', 'name', 'email']);
  });
});

describe('числа и утверждения текста', () => {
  it('подписи стенда в тексте совпадают с литералами', () => {
    expect(t.DEMO_CAPTION).toContain('10 000');
    expect(t.BACKFILL_CODE).toContain('10 пачек');
    expect(Object.keys(t.LOCK_NAMES)).toEqual(expect.arrayContaining(t.LOCK_MODES.map((m) => m.mode)));
    for (const plan of t.PLANS) for (const s of plan.steps) for (const st of s.statements) expect(t.LOCK_NAMES[st.cost.lock]).toBeDefined();
  });
});
