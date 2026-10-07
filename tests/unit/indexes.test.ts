import { PGlite } from '@electric-sql/pglite';
import { pageinspect } from '@electric-sql/pglite/contrib/pageinspect';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/data/indexes/data';
import { loadBtree, loadPlanner } from '@/widgets/index-lab/model/run';
import type { BtKey, BtPage, BtTree, ScanNode } from '@/widgets/index-lab/model/types';

/**
 * Тема «Индексы Postgres и EXPLAIN».
 *
 * Стенд — настоящий Postgres 18.3 в WebAssembly (`@electric-sql/pglite` 0.5.8) с `pageinspect`,
 * в процессе теста. Здесь пересобирается всё, что тема утверждает о базе: тексты планов
 * `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF)` — дословно, число прочитанных страниц,
 * уровни и листья B-дерева, цены вариантов плана, цена записи в страницах и WAL.
 *
 * `BTREE_CODE` и `PLANNER_CODE` — строки из темы, их же исполняет демо. Дерево сверяется
 * с `pageinspect` (листья, разделители в корне, уровни) и с SQL на тех же данных (поиск,
 * диапазон, число страниц). Модель стоимости — с выбором и ценами `EXPLAIN` на 17 запросах.
 *
 * Время из планов не проверяется и в тему не попадает: его в планах нет вовсе (`TIMING OFF`).
 */

const btree = loadBtree(t.BTREE_CODE);
const planCosts = loadPlanner(t.PLANNER_CODE);

async function freshDb(extra = ''): Promise<PGlite> {
  const db = new PGlite({ extensions: { pageinspect } });
  await db.exec('CREATE EXTENSION pageinspect;');
  await db.exec(t.SETUP_SQL);
  if (extra) await db.exec(extra);
  return db;
}

const rows = async <T>(db: PGlite, sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;
const one = async <T>(db: PGlite, sql: string): Promise<T> => (await rows<T>(db, sql))[0];

/** Текст плана, как он напечатан в теме: второй запуск, без хвоста `Planning:`. */
async function plan(db: PGlite, sql: string): Promise<string> {
  const q = `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF) ${sql}`;
  await db.query(q);
  const r = await rows<{ 'QUERY PLAN': string }>(db, q);
  return r
    .map((x) => x['QUERY PLAN'])
    .join('\n')
    .replace(/\nPlanning:[\s\S]*$/, '');
}

interface JsonNode {
  'Node Type': string;
  'Total Cost': number;
  'Plan Rows': number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'WAL Records'?: number;
  'WAL Bytes'?: number;
  Plans?: JsonNode[];
}

async function json(db: PGlite, sql: string, opts = 'ANALYZE, BUFFERS'): Promise<JsonNode> {
  const q = `EXPLAIN (${opts}, FORMAT JSON) ${sql}`;
  const r = await rows<{ 'QUERY PLAN': { Plan: JsonNode }[] }>(db, q);
  return r[0]['QUERY PLAN'][0].Plan;
}

/** Верхний узел второго запуска: тип и сколько страниц прочитано. */
async function scan(db: PGlite, sql: string) {
  await json(db, sql);
  const p = await json(db, sql);
  return { node: p['Node Type'], pages: p['Shared Hit Blocks'] ?? 0 };
}

/** Номер страницы из `ctid` вида `(10,3)`. */
const pageOf = (ctid: string) => Number(/^\((\d+),/.exec(ctid)![1]);

/** Листья учебного дерева слева направо. */
function leaves(tree: BtTree): BtPage[] {
  let p = tree.root;
  while (!p.leaf) p = p.children![0];
  const out: BtPage[] = [];
  for (let q: BtPage | null = p; q; q = q.next) out.push(q);
  return out;
}

function build(keys: BtKey[], capacity: number, rightFill?: number): BtTree {
  const tree = btree.createTree(capacity, rightFill);
  for (const k of keys) btree.insert(tree, k);
  return tree;
}

/** Ключ bigint из `bt_page_items.data`: восемь байт little-endian в hex через пробел. */
const bigintOf = (hex: string) =>
  hex
    .split(' ')
    .reverse()
    .reduce((acc, b) => acc * 256 + parseInt(b, 16), 0);

// ─── Таблица, страницы, первые планы ───────────────────────────────────────────────────────

describe('таблица — это страницы', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(t.ORDERS_SQL);
  }, 60_000);

  it('306 страниц по 8 КБ, адреса строк — как в CTID_ROWS', async () => {
    const r = await one<{ relpages: number; bytes: number; bs: string }>(
      db,
      "SELECT relpages, pg_relation_size('users')::int AS bytes, current_setting('block_size') AS bs FROM pg_class WHERE relname = 'users'",
    );
    expect(r.relpages).toBe(t.HEAP_FACTS.pages);
    expect(r.bytes).toBe(t.HEAP_FACTS.bytes);
    expect(Number(r.bs)).toBe(t.HEAP_FACTS.blockSize);
    expect(t.HEAP_FACTS.pages * t.HEAP_FACTS.blockSize).toBe(t.HEAP_FACTS.bytes);
    const got = await rows<{ ctid: string; id: number }>(db, t.CTID_SQL.replace(/;$/, ' ORDER BY id'));
    expect(got.map((x) => ({ ctid: x.ctid, id: Number(x.id) }))).toEqual(t.CTID_ROWS);
  });

  it('база в сортировке C, PostgreSQL 18', async () => {
    const r = await one<{ datcollate: string; v: string }>(
      db,
      'SELECT datcollate, version() AS v FROM pg_database WHERE datname = current_database()',
    );
    expect(r.datcollate).toBe('C');
    expect(r.v).toMatch(/^PostgreSQL 18\./);
  });

  it('PLAN_SEQ без индекса, PLAN_INDEX с ним — дословно', async () => {
    expect(await plan(db, t.EMAIL_QUERY)).toBe(t.PLAN_SEQ);
    await db.exec(t.INDEX_SQL);
    expect(await plan(db, t.EMAIL_QUERY)).toBe(t.PLAN_INDEX);
  });

  it('диапазон: PLAN_RANGE, строки на двух страницах таблицы, граница листа — 1099', async () => {
    expect(await plan(db, t.RANGE_SQL)).toBe(t.PLAN_RANGE);
    const pages = await rows<{ ctid: string }>(db, 'SELECT ctid FROM users WHERE id BETWEEN 1000 AND 1100');
    expect([...new Set(pages.map((p) => pageOf(p.ctid)))]).toEqual([9, 10]);
    expect(t.RANGE_NOTE).toContain('страницах 9 и 10');
    expect(t.PK_TREE.rootSeparators).toContain(1099);
  });

  it('PLAN_LOOPS: вложенный цикл, loops=5, 3 + 15 = 18 страниц', async () => {
    const sql = t.LOOPS_SQL.replace(/^EXPLAIN \(ANALYZE, BUFFERS\)\n/, '').replace(/;$/, '');
    expect(await plan(db, sql)).toBe(t.PLAN_LOOPS);
  });

  it('первый запуск в сессии читает больше: FIRST_RUN', async () => {
    const fresh = await freshDb();
    const a = await json(fresh, 'SELECT * FROM users WHERE id = 42');
    const b = await json(fresh, 'SELECT * FROM users WHERE id = 42');
    expect((a['Shared Hit Blocks'] ?? 0) + (a['Shared Read Blocks'] ?? 0)).toBe(t.FIRST_RUN.first);
    expect(b['Shared Hit Blocks']).toBe(t.FIRST_RUN.second);
  }, 60_000);
});

// ─── B-дерево ──────────────────────────────────────────────────────────────────────────────

describe('BTREE_CODE против pageinspect и SQL', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb(t.INDEX_SQL);
    await db.exec('VACUUM users');
  }, 60_000);

  it('ёмкость листа из bt_page_stats: 406 ключей, 366 при делении правой страницы', async () => {
    const leaf = await one<{ live_items: number; avg_item_size: number; free_size: number }>(
      db,
      "SELECT live_items, avg_item_size, free_size FROM bt_page_stats('users_pkey', 1)",
    );
    // live_items включает «верхний ключ» страницы — он не данные.
    const keys = leaf.live_items - 1;
    const room = Math.floor(leaf.free_size / (leaf.avg_item_size + 4));
    expect(keys).toBe(t.PK_TREE.keysPerLeaf);
    expect(keys + room).toBe(t.PK_TREE.capacity);
    expect(Math.round((keys / (keys + room)) * 100)).toBe(90);
  });

  it('30 000 id: те же уровни, листья, наполнение и разделители в корне', async () => {
    const meta = await one<{ level: number; root: number }>(db, "SELECT level, root FROM bt_metap('users_pkey')");
    const stats = await rows<{ type: string; n: number }>(
      db,
      "SELECT type, count(*)::int AS n FROM bt_multi_page_stats('users_pkey', 1, -1) GROUP BY type",
    );
    const items = await rows<{ data: string }>(db, `SELECT data FROM bt_page_items('users_pkey', ${meta.root}) ORDER BY itemoffset`);
    const pgSeparators = items.slice(1).map((i) => bigintOf(i.data)); // первый — «минус бесконечность»

    const tree = build(Array.from({ length: 30000 }, (_, i) => i + 1), t.PK_TREE.capacity, t.PK_TREE.keysPerLeaf);
    expect(tree.levels).toBe(meta.level + 1);
    expect(tree.levels).toBe(t.PK_TREE.levels);
    const ls = leaves(tree);
    expect(ls).toHaveLength(stats.find((s) => s.type === 'l')!.n);
    expect(ls).toHaveLength(t.PK_TREE.leaves);
    expect(ls[0].keys).toHaveLength(t.PK_TREE.keysPerLeaf);
    expect(ls.at(-1)!.keys).toHaveLength(t.PK_TREE.lastLeaf);
    expect(tree.root.keys).toEqual(pgSeparators);
    expect(pgSeparators.slice(0, 4)).toEqual(t.PK_TREE.rootSeparators);
  });

  it('индекс по email: уровни и листья — EMAIL_TREE', async () => {
    const meta = await one<{ level: number }>(db, "SELECT level FROM bt_metap('users_email_idx')");
    const l = await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM bt_multi_page_stats('users_email_idx', 1, -1) WHERE type = 'l'");
    const pages = await one<{ relpages: number }>(db, "SELECT relpages FROM pg_class WHERE relname = 'users_email_idx'");
    expect({ levels: meta.level + 1, leaves: l.n, pages: pages.relpages }).toEqual(t.EMAIL_TREE);
  });

  it('поиск и диапазон дают те же строки, что SQL, — по id и по email', async () => {
    const ids = build(Array.from({ length: 30000 }, (_, i) => i + 1), t.PK_TREE.capacity, t.PK_TREE.keysPerLeaf);
    for (const k of [1, 42, 366, 367, 1099, 29999, 30000]) expect(btree.search(ids, k).found).toBe(true);
    for (const k of [0, 30001]) expect(btree.search(ids, k).found).toBe(false);
    for (const [a, b] of [[1000, 1100], [1, 10000], [29990, 40000]]) {
      const sql = await rows<{ id: number }>(db, `SELECT id FROM users WHERE id BETWEEN ${a} AND ${b} ORDER BY id`);
      expect(btree.range(ids, a, b).keys).toEqual(sql.map((r) => Number(r.id)));
    }

    // Адреса — в порядке id, то есть вперемешку для дерева; сортировка базы C = сравнение JS для ASCII.
    const emails = (await rows<{ email: string }>(db, 'SELECT email FROM users ORDER BY id')).map((r) => r.email);
    const byEmail = build(emails, 200);
    for (const e of ['user42@mail.test', 'user30000@mail.test']) expect(btree.search(byEmail, e).found).toBe(true);
    expect(btree.search(byEmail, 'user0@mail.test').found).toBe(false);
    const sql = await rows<{ email: string }>(
      db,
      "SELECT email FROM users WHERE email BETWEEN 'user12' AND 'user13' ORDER BY email",
    );
    expect(btree.range(byEmail, 'user12', 'user13').keys).toEqual(sql.map((r) => r.email));
  });

  it('страниц прочитано столько же, сколько у Postgres: уровни + страница таблицы; диапазон + карта видимости', async () => {
    const ids = build(Array.from({ length: 30000 }, (_, i) => i + 1), t.PK_TREE.capacity, t.PK_TREE.keysPerLeaf);
    // Точка: дерево читает уровни, Postgres — уровни и одну страницу таблицы.
    expect(btree.search(ids, 42).pages).toHaveLength(2);
    expect((await scan(db, 'SELECT * FROM users WHERE id = 42')).pages).toBe(2 + 1);
    // Диапазон без таблицы (Index Only Scan после VACUUM): + одна страница карты видимости.
    for (const [a, b] of [[1000, 1100], [1, 10000]]) {
      const p = await scan(db, `SELECT id FROM users WHERE id BETWEEN ${a} AND ${b}`);
      expect(p.node).toBe('Index Only Scan');
      expect(p.pages).toBe(btree.range(ids, a, b).pages.length + 1);
    }
  });

  it('миллион id — три уровня и 2733 листа, как у Postgres', async () => {
    const big = new PGlite({ extensions: { pageinspect } });
    await big.exec('CREATE EXTENSION pageinspect; CREATE TABLE big (id bigint PRIMARY KEY);');
    await big.exec(`INSERT INTO big SELECT generate_series(1, ${t.BIG_TREE.rows})`);
    const meta = await one<{ level: number }>(big, "SELECT level FROM bt_metap('big_pkey')");
    const l = await one<{ n: number }>(big, "SELECT count(*)::int AS n FROM bt_multi_page_stats('big_pkey', 1, -1) WHERE type = 'l'");
    const tree = build(Array.from({ length: t.BIG_TREE.rows }, (_, i) => i + 1), t.PK_TREE.capacity, t.PK_TREE.keysPerLeaf);
    expect(meta.level + 1).toBe(t.BIG_TREE.levels);
    expect(tree.levels).toBe(t.BIG_TREE.levels);
    expect(l.n).toBe(t.BIG_TREE.leaves);
    expect(leaves(tree)).toHaveLength(t.BIG_TREE.leaves);
  }, 120_000);

  it('сценарии демо: вперемешку страниц больше, чем по возрастанию; ключи без повторов', () => {
    const [asc, mixed] = t.BTREE_SCENARIOS;
    expect([...mixed.keys].sort((a, b) => a - b)).toEqual(asc.keys);
    const a = build(asc.keys, asc.capacity, asc.rightFill);
    const m = build(mixed.keys, mixed.capacity, mixed.rightFill);
    expect(m.pages).toBeGreaterThan(a.pages);
    for (const tr of [a, m]) {
      expect(btree.range(tr, 0, 100).keys).toEqual(asc.keys);
      expect(btree.search(tr, asc.search).pages).toHaveLength(tr.levels);
    }
  });
});

// ─── Модель стоимости ──────────────────────────────────────────────────────────────────────

describe('PLANNER_CODE против выбора и цен EXPLAIN', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await freshDb('CREATE INDEX users_created_idx ON users (created_at); ANALYZE users;');
  }, 60_000);

  const INDEX: Record<string, string> = { id: 'users_pkey', created_at: 'users_created_idx' };
  const FORCE: Record<ScanNode, string> = {
    'Seq Scan': 'SET enable_indexscan = off; SET enable_bitmapscan = off;',
    'Index Scan': 'SET enable_seqscan = off; SET enable_bitmapscan = off;',
    'Bitmap Heap Scan': 'SET enable_seqscan = off; SET enable_indexscan = off;',
  };

  it('статистика в PLAN_COLUMNS — та, что видит Postgres', async () => {
    for (const col of t.PLAN_COLUMNS) {
      const r = await one<{ pages: number; tuples: number; ip: number; level: number; corr: number }>(
        db,
        `SELECT (SELECT relpages FROM pg_class WHERE relname = 'users') AS pages,
                (SELECT reltuples FROM pg_class WHERE relname = 'users') AS tuples,
                (SELECT relpages FROM pg_class WHERE relname = '${INDEX[col.id]}') AS ip,
                (bt_metap('${INDEX[col.id]}')).level AS level,
                (SELECT correlation FROM pg_stats WHERE tablename = 'users' AND attname = '${col.id}') AS corr`,
      );
      expect(col.stats.pages).toBe(r.pages);
      expect(col.stats.tuples).toBe(r.tuples);
      expect(col.stats.indexPages).toBe(r.ip);
      expect(col.stats.levels).toBe(r.level + 1);
      expect(col.stats.correlation).toBeCloseTo(r.corr, 8);
    }
  });

  it('на каждой точке: оценка строк, выбор Postgres и цены вариантов совпадают с литералами', async () => {
    for (const col of t.PLAN_COLUMNS) {
      for (const p of col.points) {
        const sql = col.sql.replace('{n}', String(p.n));
        const chosen = await json(db, sql, 'COSTS');
        expect(chosen['Plan Rows'], sql).toBe(p.rows);
        expect(chosen['Node Type'], sql).toBe(p.chosen);
        for (const nodeName of Object.keys(FORCE) as ScanNode[]) {
          await db.exec(FORCE[nodeName]);
          const forced = await json(db, sql, 'COSTS');
          await db.exec('RESET ALL;');
          expect(forced['Node Type'], `${sql} / ${nodeName}`).toBe(nodeName);
          expect(forced['Total Cost'], `${sql} / ${nodeName}`).toBe(p.costs[nodeName]);
        }
      }
    }
  }, 60_000);

  it('модель выбирает то же, что Postgres, а цены расходятся не больше чем на 1', () => {
    let n = 0;
    for (const col of t.PLAN_COLUMNS) {
      for (const p of col.points) {
        const m = planCosts(col.stats, p.rows);
        expect(m.winner, `${col.id} ${p.n}`).toBe(p.chosen);
        for (const k of Object.keys(p.costs) as ScanNode[]) {
          expect(Math.abs(m.costs[k] - p.costs[k]), `${col.id} ${p.n} ${k}`).toBeLessThanOrEqual(1.01);
        }
        n++;
      }
    }
    expect(n).toBe(17);
    expect(t.PLANNER_NOTE).toContain('до единицы');
  });

  it('у Seq Scan цена — ровно страницы + строки × (0,01 + 0,0025)', () => {
    const s = t.PLAN_COLUMNS[0].stats;
    expect(planCosts(s, 1).costs['Seq Scan']).toBe(681);
    expect(s.pages + s.tuples * 0.0125).toBe(681);
  });
});

// ─── Почему индекс не берётся ──────────────────────────────────────────────────────────────

describe('WHY_CASES: план каждого запроса на стенде', () => {
  for (const c of t.WHY_CASES) {
    it(`${c.id}: ${c.t}`, async () => {
      const db = await freshDb();
      for (const s of c.steps) {
        if (s.ddl) await db.exec(s.ddl);
        const got = await scan(db, s.sql.replace(/;$/, ''));
        expect(got, s.sql).toEqual({ node: s.node, pages: s.pages });
        if (s.extra) expect(await plan(db, s.sql.replace(/;$/, ''))).toContain(s.extra);
      }
      // Код карточки собран из тех же шагов.
      const code = t.whyCode(c);
      for (const s of c.steps) expect(code).toContain(`-- ${s.node}, страниц: ${s.pages}`);
    }, 60_000);
  }

  it('принудительный проход по (email, city) для city = Омск — 1271 страница', async () => {
    const db = await freshDb('CREATE INDEX users_email_city_idx ON users (email, city);');
    await db.exec('SET enable_seqscan = off; SET enable_bitmapscan = off;');
    const got = await scan(db, "SELECT * FROM users WHERE city = 'Омск'");
    expect(got).toEqual({ node: 'Index Scan', pages: t.FORCED_PREFIX_PAGES });
  }, 60_000);

  it('заблокированные — на 300 разных страницах; месяц created_at — на всех 306', async () => {
    const db = await freshDb();
    const blocked = await rows<{ ctid: string }>(db, "SELECT ctid FROM users WHERE status = 'blocked'");
    expect(new Set(blocked.map((r) => pageOf(r.ctid))).size).toBe(300);
    const month = await rows<{ ctid: string }>(db, t.INCLUDE_QUERY.replace('created_at, city', 'ctid'));
    expect(month).toHaveLength(780);
    expect(new Set(month.map((r) => pageOf(r.ctid))).size).toBe(t.HEAP_FACTS.pages);
    const day = await rows<{ ctid: string }>(db, "SELECT ctid FROM users WHERE created_at = date '2024-03-01'");
    expect(new Set(day.map((r) => pageOf(r.ctid))).size).toBe(30);
  }, 60_000);

  it('оценка без статистики — 0,5 % таблицы, 150 строк; у индекса по выражению — после ANALYZE', async () => {
    const db = await freshDb();
    const q = "SELECT * FROM users WHERE lower(email) = 'user42@mail.test'";
    expect((await json(db, q, 'COSTS'))['Plan Rows']).toBe(150);
    expect((await json(db, 'SELECT * FROM users WHERE id = 42.0', 'COSTS'))['Plan Rows']).toBe(150);
    await db.exec('CREATE INDEX users_lower_email_idx ON users (lower(email))');
    expect((await json(db, q, 'COSTS'))['Plan Rows']).toBe(t.EXPR_ROWS.before);
    await db.exec('ANALYZE users');
    expect((await json(db, q, 'COSTS'))['Plan Rows']).toBe(t.EXPR_ROWS.after);
  }, 60_000);

  it('устаревшая статистика: PLAN_STALE до ANALYZE, PLAN_FRESH после', async () => {
    const db = await freshDb(`${t.ORDERS_SQL}\n${t.STALE_SETUP}\nANALYZE users;`);
    await db.exec(t.STALE_UPDATE);
    expect(t.STALE_SQL).toContain(t.STALE_UPDATE);
    expect(await plan(db, t.STALE_QUERY)).toBe(t.PLAN_STALE);
    await db.exec('ANALYZE users');
    expect(await plan(db, t.STALE_QUERY)).toBe(t.PLAN_FRESH);
    expect(Math.round(36103 / 486)).toBe(74);
  }, 60_000);
});

// ─── Index Only Scan и особые индексы ──────────────────────────────────────────────────────

describe('Index Only Scan, INCLUDE, частичный индекс', () => {
  const heapFetches = (p: string) => Number(/Heap Fetches: (\d+)/.exec(p)![1]);
  const hits = (p: string) => Number(/^ {2}Buffers: shared hit=(\d+)/m.exec(p)![1]);

  it('IOS_ROWS: до VACUUM, после, после UPDATE одной строки', async () => {
    const db = await freshDb();
    const states: string[] = [];
    states.push(await plan(db, t.IOS_SQL));
    await db.exec('VACUUM users');
    states.push(await plan(db, t.IOS_SQL));
    await db.exec("UPDATE users SET city = 'Сочи' WHERE id = 1050");
    states.push(await plan(db, t.IOS_SQL));
    states.forEach((p, i) => {
      expect(p).toMatch(/^Index Only Scan using users_pkey/);
      expect({ heapFetches: heapFetches(p), pages: hits(p) }).toEqual({
        heapFetches: t.IOS_ROWS[i].heapFetches,
        pages: t.IOS_ROWS[i].pages,
      });
    });
  }, 60_000);

  it('INCLUDE: PLAN_INCLUDE_BEFORE → PLAN_INCLUDE_AFTER, размеры INDEX_SIZES, частичный — PLAN_PARTIAL', async () => {
    const db = await freshDb();
    await db.exec('VACUUM users');
    await db.exec(t.INDEX_SIZES[0].ddl);
    expect(await plan(db, t.INCLUDE_QUERY)).toBe(t.PLAN_INCLUDE_BEFORE);
    await db.exec('DROP INDEX users_created_idx');
    await db.exec(t.INDEX_SIZES[1].ddl);
    expect(t.INCLUDE_SQL).toContain(t.INDEX_SIZES[1].ddl);
    expect(await plan(db, t.INCLUDE_QUERY)).toBe(t.PLAN_INCLUDE_AFTER);
    await db.exec('DROP INDEX users_created_city_idx');

    await db.exec(t.INDEX_SIZES[0].ddl);
    await db.exec(t.INDEX_SIZES[2].ddl);
    await db.exec('ANALYZE users');
    expect(await plan(db, t.PARTIAL_QUERY)).toBe(t.PLAN_PARTIAL);
    expect(t.PARTIAL_SQL.replace(/\s+/g, ' ')).toContain(t.INDEX_SIZES[2].ddl);

    await db.exec(t.INDEX_SIZES[1].ddl);
    for (const s of t.INDEX_SIZES) {
      const name = /INDEX (\w+)/.exec(s.ddl)![1];
      const r = await one<{ relpages: number }>(db, `SELECT relpages FROM pg_class WHERE relname = '${name}'`);
      expect(r.relpages, name).toBe(s.pages);
    }
  }, 60_000);
});

// ─── Цена записи ───────────────────────────────────────────────────────────────────────────

describe('цена индекса на запись: WRITE_ROWS', () => {
  it('страницы и WAL одиночного INSERT и пачки в 1000 строк при 0, 1 и 3 индексах', async () => {
    const db = await freshDb();
    for (const w of t.WRITE_ROWS) {
      const name = `w${w.indexes}`;
      await db.exec(`CREATE TABLE ${name} (LIKE users); INSERT INTO ${name} SELECT * FROM users; ${w.ddl.replaceAll('{t}', name)}`);
      await db.exec(`VACUUM ANALYZE ${name}`);
      const insert = (id: number) =>
        json(db, `INSERT INTO ${name} VALUES (${id}, 'new${id}@mail.test', 'Омск', 'active', date '2026-10-01')`, 'ANALYZE, BUFFERS, WAL');
      await insert(100001); // первый читает холодные страницы — не в счёт
      const p = await insert(100002);
      await insert(100003); // как на стенде: три одиночные вставки, потом пачка
      expect((p['Shared Hit Blocks'] ?? 0) + (p['Shared Read Blocks'] ?? 0), name).toBe(w.rowPages);
      expect(p['WAL Records'], name).toBe(w.walRecords);
      expect(p['WAL Bytes'], name).toBe(w.walBytes);
      const b = await json(
        db,
        `INSERT INTO ${name} SELECT 200000 + i, 'bulk' || i || '@mail.test', 'Пермь', 'active', date '2026-10-01' FROM generate_series(1, 1000) AS i`,
        'ANALYZE, BUFFERS, WAL',
      );
      expect((b['Shared Hit Blocks'] ?? 0) + (b['Shared Read Blocks'] ?? 0), name).toBe(w.bulkPages);
      expect(b['WAL Records'], name).toBe(w.bulkWalRecords);
      expect(b['WAL Bytes'], name).toBe(w.bulkWalBytes);
      expect(w.indexes).toBe((w.ddl.match(/CREATE INDEX/g) ?? []).length);
    }
    const [w0, , w3] = t.WRITE_ROWS;
    expect(Math.round(w3.bulkPages / w0.bulkPages)).toBe(7);
    expect((w3.bulkWalBytes / w0.bulkWalBytes).toFixed(1)).toBe('3.5');
  }, 120_000);

  it('HOT: из 100 UPDATE неиндексированного status — 21, индексированного city — 0', async () => {
    const db = await freshDb(
      'CREATE TABLE w3 (LIKE users INCLUDING INDEXES) WITH (fillfactor = 90); INSERT INTO w3 SELECT * FROM users; CREATE INDEX ON w3 (email); CREATE INDEX ON w3 (city); CREATE INDEX ON w3 (created_at);',
    );
    await db.exec('VACUUM ANALYZE w3');
    // Счётчики в PGlite копятся через транзакции — берём разницу до и после.
    const counters = () =>
      one<{ upd: number; hot: number }>(
        db,
        "SELECT n_tup_upd::int AS upd, n_tup_hot_upd::int AS hot FROM pg_stat_xact_user_tables WHERE relname = 'w3'",
      ).then((r) => r ?? { upd: 0, hot: 0 });
    const hot = async (sql: string) => {
      await db.exec('BEGIN');
      const before = await counters();
      await db.exec(sql);
      const after = await counters();
      await db.exec('COMMIT');
      return { upd: after.upd - before.upd, hot: after.hot - before.hot };
    };
    expect(await hot("UPDATE w3 SET status = 'blocked' WHERE id BETWEEN 1001 AND 1100")).toEqual({
      upd: t.HOT_FACTS.updates,
      hot: t.HOT_FACTS.hotStatus,
    });
    expect(await hot("UPDATE w3 SET city = 'Сочи' WHERE id BETWEEN 2001 AND 2100")).toEqual({
      upd: t.HOT_FACTS.updates,
      hot: t.HOT_FACTS.hotCity,
    });
  }, 60_000);

  it('UNUSED_SQL: несработавший индекс показывает idx_scan = 0', async () => {
    const db = await freshDb('CREATE INDEX users_city_idx ON users (city);');
    await db.query('SELECT * FROM users WHERE id = 42');
    await db.query('SELECT pg_stat_force_next_flush()');
    await db.query('SELECT * FROM users WHERE id = 43');
    const r = await rows<{ indexrelname: string; idx_scan: number }>(db, t.UNUSED_SQL);
    expect(r.find((x) => x.indexrelname === 'users_city_idx')?.idx_scan).toBe(0);
    expect(Number(r.find((x) => x.indexrelname === 'users_pkey')?.idx_scan)).toBeGreaterThan(0);
  }, 60_000);
});
