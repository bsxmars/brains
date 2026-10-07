import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MigrationPlan, Schema, StatementCost } from '@/widgets/migration-lab/model/types';

/**
 * Данные темы «Миграции базы без простоя».
 *
 * Тема написана здесь, 2026-10-01, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Настоящий Postgres внутри Node: `@electric-sql/pglite` **0.5.8** из `node_modules` проекта,
 * `select version()` → `PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten`. Node 24.11.0,
 * октябрь 2026. Без Docker и без сервера: один процесс, одна сессия базы.
 *
 * Таблица — `TABLE_SQL`, 10 000 строк (`FILL_SQL`). Как снято:
 *   — **блокировки**: оператор выполняется внутри `BEGIN`, затем `LOCK_PROBE_SQL` читает
 *     `pg_locks` своей же сессии (`pid = pg_backend_pid()`), затем `COMMIT`. Из списка берётся
 *     самый сильный режим на самой таблице `users` (блокировки индексов и последовательностей
 *     не в счёт);
 *   — **перезапись**: `relfilenode` таблицы из `pg_class` до и после оператора (`REWRITE_PROBE_SQL`);
 *   — **проходы по таблице**: разница `seq_scan` в `pg_stat_xact_user_tables` внутри той же
 *     транзакции — счётчик текущей транзакции, ему не нужен сборщик статистики;
 *   — **ответ старого и нового кода**: запросы `V1`/`V2`/`V3` выполняются как есть, каждый под
 *     своей точкой сохранения, и сравнивается код ошибки Postgres (`42703`, `23502`);
 *   — **размеры**: `pg_relation_size('users')` в байтах; план — `EXPLAIN (COSTS OFF)`.
 * Таймеров нет нигде: всё снятое — режимы, номера файлов, счётчики, байты, коды ошибок.
 *
 * Всё перечисленное пересобирает `tests/unit/db-migrations.test.ts`: таблицы `SAFETY_ROWS`,
 * `REWRITE_ROWS`, стоимости шагов в `PLANS`, схемы после каждого шага (сверка с
 * `information_schema.columns`), размеры `BATCH_SIZES`, планы `PLAN_*`, перенос `BACKFILL_CODE`
 * и откат транзакции `TX_DDL_SQL`. Учебная функция `COMPAT_CODE` сверяется с настоящим
 * исполнением всех девяти запросов на каждом шаге обоих планов.
 *
 * ── Чего стенд не умеет и что поэтому взято из документации Postgres ─────────────────────
 * В PGlite **одна сессия**: две транзакции не могут ждать друг друга. Поэтому не сняты и взяты
 * из документации (раздел 13.3 «Explicit Locking», `ALTER TABLE`, `CREATE INDEX`, `lock_timeout`):
 *   — таблица конфликтов режимов (`LOCK_MODES`, столбцы «мешает чтению/записи»);
 *   — очередь блокировок (`LOCK_QUEUE`) и ошибка `55P03` по `lock_timeout`; на стенде проверено
 *     только, что `SET lock_timeout = '3s'` принимается и `SHOW` его возвращает;
 *   — режим блокировки `CREATE INDEX CONCURRENTLY` (`SHARE UPDATE EXCLUSIVE`): вне транзакции
 *     `pg_locks` своей сессии его не показывает. Сняты запуском: что он выполняется, что внутри
 *     `BEGIN` он запрещён, и что упавший оставляет индекс с `indisvalid = false`;
 *   — что быстрый `ADD COLUMN … DEFAULT` появился в Postgres 11 (release notes 11); стенд — 18.3.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'миграция',
    d: 'Скрипт, который меняет схему базы: добавляет таблицы и столбцы, ограничения, индексы — или переносит данные. Миграции нумеруют и выполняют по порядку, а база помнит, какие уже выполнены.',
  },
  {
    k: 'схема',
    d: 'Устройство базы: какие таблицы, какие в них столбцы, каких типов, какие обязательны. Данные — строки в этих таблицах.',
  },
  {
    k: 'выкат по частям (rolling update)',
    d: 'Новая версия приложения заменяет старую не разом, а по нескольку подов. Пока выкат идёт, запросы обслуживают обе версии вперемешку.',
  },
  {
    k: 'блокировка таблицы',
    d: 'Отметка «эту таблицу сейчас использую я», которую Postgres ставит на время транзакции. Режимов восемь; одни уживаются друг с другом, другие заставляют ждать.',
  },
  {
    k: 'перезапись таблицы',
    d: 'Postgres пишет новую копию таблицы целиком в новый файл, а старый выбрасывает. Пока идёт перезапись, таблица закрыта даже для чтения.',
  },
  {
    k: 'транзакция',
    d: 'Группа команд, которая применяется целиком или не применяется вовсе. Блокировки, взятые внутри, держатся до её конца — до `COMMIT` или `ROLLBACK`.',
  },
];

export const PLAIN_MIGRATION =
  'Как ремонт в кафе, которое не закрывается. Повара нового меню и повара старого полчаса работают на одной кухне. Убрать полку со специями, пока старые повара за ней тянутся, нельзя: сначала ставят новую полку рядом, потом все переходят на неё, и только потом снимают старую. И любую перестановку делают быстро: пока двигают плиту, кухня стоит.';

export const PREREQ_NOTE =
  'Тема опирается на выкат по частям и на SQL-основы. Первое разобрано на сайте, второе объяснено прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Выкат по частям',
    d: 'Kubernetes заменяет поды порциями, которые задают `maxSurge` и `maxUnavailable`. Несколько минут старые и новые поды отвечают одновременно, а при откате — снова.',
    href: '/delivery/kubernetes/#s4',
    hrefLabel: '«Kubernetes: развёртывание», раздел «Выкат и откат»',
    tone: 'info',
  },
  {
    t: '«Расширяй, потом сужай» как модель',
    d: 'Почему версия кода и состояние схемы совместимы только попарно и почему сужение — отдельный выкат. Там это модель на множествах столбцов; здесь — тот же приём на SQL и настоящих ошибках Postgres.',
    href: '/delivery/progressive-delivery/#s2',
    hrefLabel: '«Прогрессивная доставка», раздел «Сине-зелёный»',
    tone: 'info',
  },
  {
    t: 'SQL: SELECT, INSERT, UPDATE, ALTER TABLE',
    d: 'Достаточно читать простые запросы. `NOT NULL` — столбец обязателен, `DEFAULT` — значение, которое база подставит сама, если `INSERT` столбец не назвал.',
    tone: 'info',
  },
];

// ─── Раздел 1. Две версии на одной базе ────────────────────────────────────────────────────

/** Сквозной пример. Тест создаёт ровно эту таблицу и заполняет `FILL_SQL`. */
export const TABLE_SQL = `CREATE TABLE users (
  id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name  text NOT NULL,
  email text NOT NULL
);`;

export const FILL_SQL = `INSERT INTO users (name, email)
SELECT 'Пользователь ' || g, 'u' || g || '@example.com'
FROM generate_series(1, 10000) AS g;`;

export const TABLE_NAME = 'users';

/** Код приложения трёх версий — ровно эти строки исполняет тест на каждом шаге. */
export const VERSIONS: Record<'v1' | 'v2' | 'v3', string[]> = {
  v1: [
    "SELECT id, name, email FROM users WHERE id = 1",
    "INSERT INTO users (name, email) VALUES ('Анна Ким', 'anna@example.com')",
    "UPDATE users SET name = 'Анна Ли' WHERE id = 1",
  ],
  v2: [
    "SELECT id, coalesce(full_name, name), email FROM users WHERE id = 1",
    "INSERT INTO users (name, full_name, email) VALUES ('Анна Ким', 'Анна Ким', 'anna@example.com')",
    "UPDATE users SET name = 'Анна Ли', full_name = 'Анна Ли' WHERE id = 1",
  ],
  v3: [
    "SELECT id, full_name, email FROM users WHERE id = 1",
    "INSERT INTO users (full_name, email) VALUES ('Анна Ким', 'anna@example.com')",
    "UPDATE users SET full_name = 'Анна Ли' WHERE id = 1",
  ],
};

export const VERSION_NOTES: Record<'v1' | 'v2' | 'v3', string> = {
  v1: 'знает только `name`',
  v2: 'пишет в оба столбца, читает новый, а пока он пуст — старый',
  v3: 'знает только `full_name`',
};

export const versionCode = (v: 'v1' | 'v2' | 'v3') => `-- ${v}: ${VERSION_NOTES[v].replaceAll('`', '')}\n${VERSIONS[v].join(';\n')};`;

export const TWO_VERSIONS_TEXT =
  'Миграцию выполняют **один раз и до выката**: отдельной задачей в кластере или хуком перед обновлением релиза. Значит, новую схему первым встречает **старый** код — новых подов ещё нет. Потом выкат идёт по частям, и несколько минут обе версии работают на одной схеме. Если что-то пойдёт не так, код откатят — и старая версия снова встретится с новой схемой. Отсюда правило: каждая миграция обязана подходить коду до неё и коду после неё.';

export const SAFETY_LEAD =
  'Старый код — версия `v1` выше: три запроса, которые знают про `name` и `email`. Каждую миграцию применим к таблице из 10 000 строк и после неё выполним все три запроса. Postgres отвечает кодом ошибки: `42703` — нет такого столбца, `23502` — обязательный столбец остался пустым.';

export type Outcome = 'ok' | '42703' | '23502';

/**
 * Что видит старый код после изменения. `migration` — чем закончилась сама миграция
 * на таблице с 10 000 строк; `v1` — ответ трёх запросов v1 по порядку.
 * Всё пересобирает тест на PGlite.
 */
export const SAFETY_ROWS: {
  sql: string;
  migration: 'ok' | '23502';
  v1: [Outcome, Outcome, Outcome];
  verdict: string;
  tone: 'ok' | 'warn' | 'err';
}[] = [
  {
    sql: 'ALTER TABLE users ADD COLUMN full_name text',
    migration: 'ok',
    v1: ['ok', 'ok', 'ok'],
    verdict: 'Безопасно. Старый код нового столбца не называет, а `INSERT` без него оставит там `NULL`.',
    tone: 'ok',
  },
  {
    sql: "ALTER TABLE users ADD COLUMN full_name text NOT NULL DEFAULT ''",
    migration: 'ok',
    v1: ['ok', 'ok', 'ok'],
    verdict: 'Безопасно для кода: пропущенный столбец заполнит `DEFAULT`. Но пустая строка в обязательном поле — тоже данные, и их придётся отличать от настоящих.',
    tone: 'ok',
  },
  {
    sql: 'ALTER TABLE users ADD COLUMN full_name text NOT NULL',
    migration: '23502',
    v1: ['ok', 'ok', 'ok'],
    verdict: 'Падает **сама миграция**: у 10 000 старых строк в новом столбце `NULL`. На пустой таблице прошла бы — и тогда падал бы каждый `INSERT` старого кода.',
    tone: 'warn',
  },
  {
    sql: 'ALTER TABLE users RENAME COLUMN name TO full_name',
    migration: 'ok',
    v1: ['42703', '42703', '42703'],
    verdict: 'Ломает всё: для старого кода переименование — это «столбца `name` больше нет». Падают и чтение, и запись.',
    tone: 'err',
  },
  {
    sql: 'ALTER TABLE users DROP COLUMN email',
    migration: 'ok',
    v1: ['42703', '42703', 'ok'],
    verdict: 'Ломает чтение и вставку. `UPDATE` выжил только потому, что не трогает `email`, — такую «совместимость» не стоит принимать за правило.',
    tone: 'err',
  },
  {
    sql: 'ALTER TABLE users ALTER COLUMN name DROP NOT NULL',
    migration: 'ok',
    v1: ['ok', 'ok', 'ok'],
    verdict: 'Безопасно: ослабить ограничение — то же, что ничего не менять, для кода, который его соблюдает.',
    tone: 'ok',
  },
];

export const SAFETY_NOTE =
  'Правило по таблице короткое: **добавлять — безопасно, убирать и переименовывать — нет.** Новый столбец, новый необязательный параметр, ослабленное ограничение старый код не замечает. Удалённый или переименованный столбец он замечает первым же запросом. А обязательный столбец без значения по умолчанию не даёт даже выполнить миграцию — если в таблице есть строки.';

// ─── Раздел 2. Расширить и сузить: переименование по шагам ─────────────────────────────────

export const EXPAND_LEAD =
  'Задача: переименовать `name` в `full_name`. Одной командой это ломает старый код. «Расширить и сузить» растягивает переименование на шесть шагов и три версии кода: на каждом шаге работают те версии, которые сейчас обслуживают запросы, и та, на которую придётся откатиться.';

/** Учебная функция: напечатана в теме, исполняется демо и тестом против настоящего Postgres. */
export const COMPAT_CODE = `// Схема: для каждого столбца — обязателен ли он и есть ли значение по умолчанию.
// { id: { notNull: true, hasDefault: true }, name: { notNull: true, hasDefault: false } }

const KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'into', 'values',
  'update', 'set', 'and', 'or', 'not', 'is', 'null', 'as',
]);

// Столбцы, которые упоминает запрос. Разбор нарочно простой — для запросов вида
// SELECT … FROM t WHERE …, INSERT INTO t (…) VALUES (…), UPDATE t SET … WHERE ….
// Строки в кавычках выбрасываем; слово перед «(» — функция; имя таблицы — не столбец.
function columnsOf(sql, table) {
  const text = sql.replace(/'[^']*'/g, '').toLowerCase();
  const words = text.match(/\\b[a-z_][a-z0-9_]*\\b(?!\\s*\\()/g) ?? [];
  return [...new Set(words.filter((w) => !KEYWORDS.has(w) && w !== table))];
}

// INSERT заполняет только столбцы из своего списка, остальные — DEFAULT или NULL.
function insertedColumns(sql) {
  const m = /insert\\s+into\\s+\\w+\\s*\\(([^)]*)\\)/i.exec(sql);
  return m ? m[1].split(',').map((c) => c.trim().toLowerCase()) : null;
}

// Что ответит Postgres: null — запрос выполнится, иначе код ошибки и столбец.
function check(schema, table, sql) {
  const missing = columnsOf(sql, table).filter((c) => !(c in schema));
  if (missing.length) return { code: '42703', column: missing[0] };   // нет столбца

  const filled = insertedColumns(sql);
  if (filled) {
    const unfilled = Object.keys(schema).filter(
      (c) => schema[c].notNull && !schema[c].hasDefault && !filled.includes(c),
    );
    if (unfilled.length) return { code: '23502', column: unfilled[0] };  // обязательный пуст
  }
  return null;
}

// Шаг безопасен, если на схеме после него работают все версии, которые сейчас
// обслуживают запросы (live), и версия, на которую придётся откатиться (fallback).
function stepVerdict(schema, table, versions, live, fallback) {
  const broken = [];
  for (const v of fallback ? [...live, fallback] : live) {
    const errors = versions[v].map((sql) => check(schema, table, sql)).filter(Boolean);
    if (errors.length) broken.push({ version: v, fallback: !live.includes(v), error: errors[0] });
  }
  return broken;
}`;

export const COMPAT_NOTE =
  'Postgres сообщает **первую** ошибку запроса, поэтому функция тоже возвращает одну. Разбор SQL здесь игрушечный и справляется только с запросами такого вида, как у трёх версий выше. Настоящие линтеры миграций берут парсер самого Postgres; смысл проверки тот же.';

const S0: Schema = {
  id: { notNull: true, hasDefault: true },
  name: { notNull: true, hasDefault: false },
  email: { notNull: true, hasDefault: false },
};
const S_EXPANDED: Schema = { ...S0, full_name: { notNull: false, hasDefault: false } };
const S_SWAPPED: Schema = {
  id: S0.id,
  name: { notNull: false, hasDefault: false },
  email: S0.email,
  full_name: { notNull: true, hasDefault: false },
};
const S_CONTRACTED: Schema = { id: S0.id, email: S0.email, full_name: { notNull: true, hasDefault: false } };
const S_RENAMED: Schema = { id: S0.id, full_name: { notNull: true, hasDefault: false }, email: S0.email };

const AE = 'AccessExclusiveLock';
const cost = (lock: string, rewrite = false, scans = 0): StatementCost => ({ lock, rewrite, scans });

/** Пачка переноса — та же строка, что в `BACKFILL_CODE`, с числами первой пачки. */
export const BACKFILL_BATCH_SQL =
  'UPDATE users SET full_name = name WHERE id > 0 AND id <= 1000 AND full_name IS NULL';

/**
 * Два плана для демо. `cost` у каждого оператора снят на таблице из 10 000 строк
 * (блокировка, перезапись, проходы); `schema` — схема после шага. Всё пересобирает тест.
 */
export const PLANS: MigrationPlan[] = [
  {
    id: 'expand',
    label: 'Расширить и сузить',
    note: 'Шесть шагов, три версии кода. Ни на одном шаге работающая версия не ломается; ломается только **возможность откатиться** — и это видно заранее.',
    steps: [
      { id: 'start', label: 'Было', text: 'Таблица до миграции, работает `v1`.', statements: [], live: ['v1'], schema: S0 },
      {
        id: 'expand',
        label: '1. Расширить',
        text: 'Добавить новый столбец необязательным. Старый код его не видит, `v3` ещё рано: `name` пока обязателен.',
        statements: [{ sql: 'ALTER TABLE users ADD COLUMN full_name text', cost: cost(AE) }],
        live: ['v1'],
        schema: S_EXPANDED,
      },
      {
        id: 'deploy-v2',
        label: '2. Выкат v2',
        text: 'Схема не меняется, меняется код. Пока идёт выкат, `v1` и `v2` работают вместе, и обе версии на этой схеме исправны.',
        statements: [],
        live: ['v1', 'v2'],
        schema: S_EXPANDED,
      },
      {
        id: 'backfill',
        label: '3. Перенести данные',
        text: 'Скопировать `name` в `full_name` у старых строк — пачками по тысяче. Запускают, когда последних подов `v1` уже нет: иначе `v1` успеет вставить строки без `full_name`.',
        statements: [{ sql: BACKFILL_BATCH_SQL, cost: cost('RowExclusiveLock') }],
        live: ['v2'],
        fallback: 'v1',
        schema: S_EXPANDED,
      },
      {
        id: 'constrain',
        label: '4. Сделать обязательным',
        text: 'Перевернуть обязательность: `full_name` — `NOT NULL`, `name` — нет. Четыре команды вместо одной, чтобы не держать таблицу закрытой на время проверки. С этого шага `v1` не может вставить строку: откат — только на `v2`.',
        statements: [
          { sql: 'ALTER TABLE users ADD CONSTRAINT full_name_present CHECK (full_name IS NOT NULL) NOT VALID', cost: cost(AE) },
          { sql: 'ALTER TABLE users VALIDATE CONSTRAINT full_name_present', cost: cost('ShareUpdateExclusiveLock', false, 1) },
          { sql: 'ALTER TABLE users ALTER COLUMN full_name SET NOT NULL', cost: cost(AE) },
          { sql: 'ALTER TABLE users DROP CONSTRAINT full_name_present', cost: cost(AE) },
          { sql: 'ALTER TABLE users ALTER COLUMN name DROP NOT NULL', cost: cost(AE) },
        ],
        live: ['v2'],
        fallback: 'v1',
        schema: S_SWAPPED,
      },
      {
        id: 'deploy-v3',
        label: '5. Выкат v3',
        text: 'Снова только код. `v2` и `v3` работают вместе: `v3` не пишет в `name`, и теперь ей это можно.',
        statements: [],
        live: ['v2', 'v3'],
        schema: S_SWAPPED,
      },
      {
        id: 'contract',
        label: '6. Сузить',
        text: 'Удалить старый столбец — отдельным выкатом, когда откат на `v2` точно не понадобится. Вместе со столбцом уходят данные: вернуть их можно только из резервной копии.',
        statements: [{ sql: 'ALTER TABLE users DROP COLUMN name', cost: cost(AE) }],
        live: ['v3'],
        fallback: 'v2',
        schema: S_CONTRACTED,
      },
    ],
  },
  {
    id: 'rename',
    label: 'Переименовать сразу',
    note: 'Одна команда, мгновенная и без перезаписи таблицы. Ломает она не базу, а код: от миграции до конца выката старые поды получают `42703` на каждый запрос.',
    steps: [
      { id: 'start', label: 'Было', text: 'Таблица до миграции, работает `v1`.', statements: [], live: ['v1'], schema: S0 },
      {
        id: 'rename',
        label: '1. Переименовать',
        text: 'Миграция выполняется до выката, так что новую схему первым встречает `v1`. Новых подов ещё нет — сервис лежит целиком.',
        statements: [{ sql: 'ALTER TABLE users RENAME COLUMN name TO full_name', cost: cost(AE) }],
        live: ['v1'],
        schema: S_RENAMED,
      },
      {
        id: 'deploy-v3',
        label: '2. Выкат v3',
        text: 'Новые поды работают, старые падают. Доля ошибок снижается по мере выката, но откатить код уже нельзя: `v1` на этой схеме не работает.',
        statements: [],
        live: ['v1', 'v3'],
        schema: S_RENAMED,
      },
      {
        id: 'done',
        label: '3. Выкат закончен',
        text: 'Ошибок больше нет, но и пути назад нет: откат на `v1` — снова полный отказ.',
        statements: [],
        live: ['v3'],
        fallback: 'v1',
        schema: S_RENAMED,
      },
    ],
  },
];

export const DEMO_CAPTION =
  'Вердикт по каждому запросу считает функция `check` выше на схеме после шага. Тест выполняет те же девять запросов в настоящем Postgres на каждом шаге обоих планов и сверяет код ошибки и столбец. Блокировки и перезапись у операторов — снятые на таблице из 10 000 строк.';

export const BACKFILL_RACE =
  'Почему перенос — после того, как ушёл последний под `v1`. Пока `v1` работает, она вставляет строки без `full_name` и меняет `name`, не трогая `full_name`. Первое ловится: проверка `VALIDATE` на следующем шаге упадёт с `23514`. Второе молча: `v2` читает `coalesce(full_name, name)`, а в `full_name` лежит старое имя. Если дождаться нельзя — например, при откате на `v1` после переноса, — синхронизацию берёт на себя триггер, который копирует `name` в `full_name` при каждой записи, и его снимают на шаге «сузить».';

// ─── Раздел 3. Блокировки ──────────────────────────────────────────────────────────────────

export const PLAIN_LOCK =
  'Как табличка на двери переговорной. «Идёт встреча, заходите тихо» не мешает другим зайти и послушать — это блокировка чтения. «Переставляем мебель, не входить» закрывает дверь для всех. И если перед дверью уже стоит грузчик с диваном, вежливая очередь ждёт за ним — даже те, кто хотел только послушать.';

/** Как подсмотреть блокировки своей транзакции. Тест выполняет ровно эту строку. */
export const LOCK_PROBE_SQL = `BEGIN;
ALTER TABLE users ADD COLUMN full_name text;

SELECT relation::regclass AS what, mode
FROM pg_locks
WHERE pid = pg_backend_pid() AND relation = 'users'::regclass;
--  what  |        mode
-- -------+---------------------
--  users | AccessExclusiveLock

ROLLBACK;`;

export const LOCK_PROBE_NOTE =
  'Блокировка держится **до конца транзакции**, а не до конца команды. Если в одной транзакции миграции после быстрого `ALTER` идёт долгий перенос данных, таблица закрыта на всё время переноса.';

/** Режим блокировки: имя в документации и имя в `pg_locks`. */
export const LOCK_NAMES: Record<string, string> = {
  AccessShareLock: 'ACCESS SHARE',
  RowExclusiveLock: 'ROW EXCLUSIVE',
  ShareUpdateExclusiveLock: 'SHARE UPDATE EXCLUSIVE',
  ShareLock: 'SHARE',
  ShareRowExclusiveLock: 'SHARE ROW EXCLUSIVE',
  AccessExclusiveLock: 'ACCESS EXCLUSIVE',
};

/**
 * Шесть режимов из восьми, которые встречаются в миграциях. `takenBy` — какие команды
 * его берут: всё, кроме помеченного `doc`, снято стендом (самый сильный режим на `users`).
 * Столбцы «чтение» и «запись» — из таблицы конфликтов документации: режим не уживается
 * с `ACCESS SHARE` (его берёт SELECT) и с `ROW EXCLUSIVE` (его берут INSERT, UPDATE, DELETE).
 */
export const LOCK_MODES: { mode: string; takenBy: { sql: string; doc?: boolean }[]; blocksRead: boolean; blocksWrite: boolean }[] = [
  { mode: 'AccessShareLock', takenBy: [{ sql: 'SELECT … FROM users' }], blocksRead: false, blocksWrite: false },
  { mode: 'RowExclusiveLock', takenBy: [{ sql: 'INSERT INTO users …' }, { sql: 'UPDATE users …' }], blocksRead: false, blocksWrite: false },
  {
    mode: 'ShareUpdateExclusiveLock',
    takenBy: [{ sql: 'ALTER TABLE users VALIDATE CONSTRAINT …' }, { sql: 'CREATE INDEX CONCURRENTLY …', doc: true }],
    blocksRead: false,
    blocksWrite: false,
  },
  { mode: 'ShareLock', takenBy: [{ sql: 'CREATE INDEX … ON users …' }], blocksRead: false, blocksWrite: true },
  {
    mode: 'ShareRowExclusiveLock',
    takenBy: [{ sql: 'ALTER TABLE users ADD … FOREIGN KEY … NOT VALID' }],
    blocksRead: false,
    blocksWrite: true,
  },
  {
    mode: 'AccessExclusiveLock',
    takenBy: [
      { sql: 'ALTER TABLE users ADD COLUMN …' },
      { sql: 'ALTER TABLE users DROP COLUMN …' },
      { sql: 'ALTER TABLE users RENAME …' },
      { sql: 'ALTER TABLE users ALTER COLUMN … TYPE …' },
      { sql: 'ALTER TABLE users ALTER COLUMN … SET NOT NULL' },
    ],
    blocksRead: true,
    blocksWrite: true,
  },
];

export const LOCK_MODES_NOTE =
  'Почти любой `ALTER TABLE` берёт самый сильный режим — `ACCESS EXCLUSIVE`, который не уживается ни с чем, даже с `SELECT`. Сам по себе он не страшен: добавить необязательный столбец — это правка в каталоге, на стенде такая транзакция не прочла ни одной строки таблицы. Страшно **ожидание** этой блокировки.';

/** Сценарий очереди — по документации: на стенде одна сессия, и ждать в ней некому. */
export const LOCK_QUEUE: { at: string; who: string; what: string; result: string; tone: 'ok' | 'warn' | 'err' | 'info' }[] = [
  { at: '0 с', who: 'A — отчёт', what: '`SELECT` по всей таблице на 30 секунд', result: 'берёт `ACCESS SHARE`, работает', tone: 'info' },
  { at: '1 с', who: 'B — миграция', what: '`ALTER TABLE users ADD COLUMN …`', result: 'просит `ACCESS EXCLUSIVE`, ждёт A', tone: 'warn' },
  { at: '2 с', who: 'C, D, E… — сайт', what: 'обычные `SELECT … WHERE id = …`', result: 'ждут **за B**, хотя с A они бы ужились', tone: 'err' },
  { at: '30 с', who: 'A заканчивает', what: '—', result: 'B выполняется за миллисекунды, за ним C, D, E', tone: 'ok' },
];

export const LOCK_QUEUE_NOTE =
  'Запросы встают в очередь к таблице по порядку. Новый `SELECT` не обгоняет миграцию, которая ждёт: иначе она могла бы не дождаться никогда. Поэтому команда, которая сама выполняется за миллисекунды, может на 30 секунд остановить все запросы к таблице — столько, сколько идёт самая долгая транзакция перед ней.';

export const LOCK_TIMEOUT_SQL = `-- В начале каждой миграции: не ждать блокировку дольше трёх секунд.
SET lock_timeout = '3s';
ALTER TABLE users ADD COLUMN full_name text;
-- Не дождалась — ошибка 55P03 lock_not_available, очередь за ней рассосалась.
-- Миграцию запускают снова через минуту, и так несколько раз.`;

export const LOCK_TIMEOUT_NOTE =
  '`lock_timeout` ограничивает **ожидание** блокировки, а не работу команды. Для команды, которая потом долго держит таблицу, нужен ещё `statement_timeout`. По умолчанию оба равны нулю — то есть «ждать вечно»; на стенде `SHOW lock_timeout` до настройки так и отвечает: `0`.';

// ─── Раздел 4. Что переписывает таблицу ────────────────────────────────────────────────────

export const PLAIN_REWRITE =
  'Как поправить оглавление в книге и перепечатать весь тираж. Добавить пустую графу в анкету — правка оглавления: старые страницы остаются как были, а читатель знает, что графа там пустая. Сменить ширину каждой графы — перепечатка каждой страницы, и пока типография работает, книгу никто не читает.';

export const REWRITE_PROBE_SQL = `-- Номер файла, в котором лежит таблица. Перезапись = новый файл = новый номер.
SELECT relfilenode FROM pg_class WHERE relname = 'users';

-- Сколько раз текущая транзакция прочла таблицу целиком.
SELECT seq_scan FROM pg_stat_xact_user_tables WHERE relname = 'users';`;

/**
 * Операторы по порядку, на одной таблице из 10 000 строк (`TABLE_SQL` + `FILL_SQL`).
 * `setup` выполняется и фиксируется до замера и в таблицу не попадает. `error` — код ошибки,
 * если оператор упал (тогда транзакция откатывается). Всё пересобирает тест.
 */
export const REWRITE_ROWS: {
  sql: string;
  setup?: string;
  lock: string;
  rewrite: boolean;
  scans: number;
  error?: string;
  note: string;
  tone: 'ok' | 'warn' | 'err';
}[] = [
  { sql: 'ALTER TABLE users ADD COLUMN note text', lock: AE, rewrite: false, scans: 0, note: 'Правка каталога. У старых строк столбца физически нет, Postgres читает его как `NULL`.', tone: 'ok' },
  { sql: 'ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true', lock: AE, rewrite: false, scans: 0, note: 'Тоже без перезаписи: значение по умолчанию лежит в каталоге, и старые строки отдают его при чтении. Так с Postgres 11; раньше эта команда переписывала таблицу.', tone: 'ok' },
  { sql: 'ALTER TABLE users ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()', lock: AE, rewrite: false, scans: 0, note: '`now()` вычисляется **один раз**: у всех 10 000 старых строк одно и то же время — момент миграции, а не создания строки.', tone: 'warn' },
  { sql: 'ALTER TABLE users ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid()', lock: AE, rewrite: true, scans: 2, note: 'Функция меняет значение от вызова к вызову — каждой строке нужно своё, и таблица переписывается целиком.', tone: 'err' },
  { sql: 'ALTER TABLE users ADD COLUMN phone text NOT NULL', lock: AE, rewrite: false, scans: 0, error: '23502', note: 'Не выполняется на непустой таблице: старым строкам нечего положить в обязательный столбец.', tone: 'err' },
  { sql: 'ALTER TABLE users ALTER COLUMN email TYPE varchar(320)', lock: AE, rewrite: true, scans: 2, note: 'Из `text` в `varchar(320)`: каждое значение надо проверить на длину — перезапись.', tone: 'err' },
  { sql: 'ALTER TABLE users ALTER COLUMN email TYPE varchar(400)', lock: AE, rewrite: false, scans: 0, note: 'Расширить предел — правка каталога: всё, что влезало в 320, влезет и в 400.', tone: 'ok' },
  { sql: 'ALTER TABLE users ALTER COLUMN visits TYPE bigint', setup: 'ALTER TABLE users ADD COLUMN visits integer NOT NULL DEFAULT 0', lock: AE, rewrite: true, scans: 2, note: '`integer` в `bigint` — разный размер на диске, перезапись вместе с индексами. Классика для счётчиков и ключей, которым стало мало 2³¹.', tone: 'err' },
  { sql: 'ALTER TABLE users ALTER COLUMN email SET NOT NULL', setup: 'ALTER TABLE users ALTER COLUMN email DROP NOT NULL', lock: AE, rewrite: false, scans: 1, note: 'Без перезаписи, но с **проходом по всей таблице** — под `ACCESS EXCLUSIVE`: Postgres ищет хоть один `NULL`.', tone: 'warn' },
  { sql: 'ALTER TABLE users ADD CONSTRAINT email_present CHECK (email IS NOT NULL) NOT VALID', setup: 'ALTER TABLE users ALTER COLUMN email DROP NOT NULL', lock: AE, rewrite: false, scans: 0, note: '`NOT VALID` — проверять только новые записи. Старые строки не читаются, команда мгновенная.', tone: 'ok' },
  { sql: 'ALTER TABLE users VALIDATE CONSTRAINT email_present', lock: 'ShareUpdateExclusiveLock', rewrite: false, scans: 1, note: 'Проход по таблице тот же, но под мягкой блокировкой: чтение и запись идут.', tone: 'ok' },
  { sql: 'ALTER TABLE users ALTER COLUMN email SET NOT NULL', lock: AE, rewrite: false, scans: 0, note: 'Теперь **ноль проходов**: Postgres видит проверенный `CHECK (email IS NOT NULL)` и верит ему.', tone: 'ok' },
  { sql: 'CREATE INDEX users_email_idx ON users (email)', lock: 'ShareLock', rewrite: false, scans: 1, note: 'Чтение идёт, запись ждёт всё время построения индекса.', tone: 'warn' },
  { sql: 'ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)', lock: AE, rewrite: false, scans: 1, note: 'Уникальность — это индекс, и строится он под `ACCESS EXCLUSIVE`: закрыто и чтение.', tone: 'err' },
  { sql: 'ALTER TABLE users DROP COLUMN note', lock: AE, rewrite: false, scans: 0, note: 'Мгновенно: столбец помечается удалённым в каталоге, место на диске освобождается при следующих записях строк.', tone: 'ok' },
];

export const REWRITE_NOTE =
  'Три вопроса к любому `ALTER`: какую блокировку он берёт, переписывает ли таблицу и читает ли её целиком. Блокировка `ACCESS EXCLUSIVE` с нулём проходов — миллисекунды. Она же с перезаписью или проходом — время, пропорциональное размеру таблицы, и всё это время таблица закрыта.';

export const NOT_NULL_SQL = `-- Сделать столбец обязательным, не закрывая таблицу на проход:
ALTER TABLE users ADD CONSTRAINT full_name_present
  CHECK (full_name IS NOT NULL) NOT VALID;               -- мгновенно
ALTER TABLE users VALIDATE CONSTRAINT full_name_present;  -- проход, но чтение и запись идут
ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;   -- мгновенно: верит проверке
ALTER TABLE users DROP CONSTRAINT full_name_present;     -- больше не нужна`;

export const NOT_NULL_NOTE =
  'Приём работает с Postgres 12. В Postgres 18 появился короткий путь — `ADD CONSTRAINT … NOT NULL full_name NOT VALID` и затем `VALIDATE CONSTRAINT`: на стенде первая команда не читала таблицу, вторая прошла по ней под `SHARE UPDATE EXCLUSIVE`.';

export const INDEX_SQL = `-- Индекс без остановки записи. Нельзя внутри транзакции:
CREATE INDEX CONCURRENTLY users_email_idx ON users (email);

-- Уникальность без ACCESS EXCLUSIVE на время построения:
CREATE UNIQUE INDEX CONCURRENTLY users_email_key ON users (email);
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE USING INDEX users_email_key;`;

export const INDEX_FACTS = [
  {
    t: 'Почему не в транзакции',
    d: '`CONCURRENTLY` строит индекс в несколько транзакций и между ними ждёт, пока закончатся чужие. Поэтому внутри `BEGIN` он отказывается сразу: `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. Инструменты миграций для таких файлов умеют выключать свою обёртку-транзакцию.',
  },
  {
    t: 'Упавший оставляет мусор',
    d: 'На стенде `CREATE UNIQUE INDEX CONCURRENTLY` по столбцу с повтором упал с `23505` — и оставил индекс с `indisvalid = false`. Запросы его не используют, а запись его обновляет. Перед повтором его удаляют: `DROP INDEX CONCURRENTLY`.',
    tone: 'warn' as const,
  },
  {
    t: 'Мягкая блокировка — по документации',
    d: 'Обычный `CREATE INDEX` на стенде взял `SHARE` — запись ждёт. `CONCURRENTLY` по документации берёт `SHARE UPDATE EXCLUSIVE` и пропускает и чтение, и запись. Снять это стендом нельзя: команда идёт вне транзакции, и подсмотреть её блокировки из той же сессии не получается.',
  },
];

// ─── Раздел 5. Перенос данных пачками ──────────────────────────────────────────────────────

export const PLAIN_MVCC =
  'Как правка в журнале учёта, где ничего не стирают. Исправить запись — значит зачеркнуть старую строку и написать новую ниже. Журнал толстеет, пока архивариус не пройдёт и не отметит зачёркнутые строки как место для новых. В Postgres архивариус — `VACUUM`.';

export const MVCC_TEXT =
  '`UPDATE` в Postgres не меняет строку на месте, а пишет **новую версию**; старая остаётся, пока её может видеть чья-то транзакция. Поэтому один `UPDATE` на всю таблицу раздувает её на диске больше чем вдвое и держит блокировку каждой изменённой строки до своего конца: пользователь, который хочет поменять своё имя, ждёт весь перенос.';

/** Учебный перенос. Тест исполняет ровно эту строку против PGlite. */
export const BACKFILL_CODE = `// Перенос пачками: каждая пачка — отдельная короткая транзакция.
// run(sql, params) выполняет запрос и возвращает число изменённых строк.
async function backfill(run, maxId, batch = 1000) {
  const changed = [];
  for (let from = 0; from < maxId; from += batch) {
    changed.push(await run(
      'UPDATE users SET full_name = name ' +
      'WHERE id > $1 AND id <= $2 AND full_name IS NULL',
      [from, from + batch],
    ));
  }
  return changed;
}

// const { rows } = await db.query('SELECT max(id) AS max FROM users');
// await backfill(run, rows[0].max);   // 10 000 строк → [1000, 1000, … ] — 10 пачек`;

export const BACKFILL_NOTE =
  'Пачка — по диапазону ключа, а не «следующая тысяча пустых». Условие `full_name IS NULL` оставлено, чтобы перенос можно было запустить ещё раз: повтор пропустит готовые строки. Между пачками стоит пауза — место для живых запросов и для `VACUUM`.';

export const PLAN_SUBQUERY_SQL =
  'UPDATE users SET full_name = name\nWHERE id IN (SELECT id FROM users WHERE full_name IS NULL ORDER BY id LIMIT 1000)';

export const PLAN_SUBQUERY = `Update on users
  ->  Hash Semi Join
        Hash Cond: (users.id = "ANY_subquery".id)
        ->  Seq Scan on users
        ->  Hash
              ->  Subquery Scan on "ANY_subquery"
                    ->  Limit
                          ->  Index Scan using users_pkey on users users_1
                                Filter: (full_name IS NULL)`;

export const PLAN_RANGE_SQL =
  'UPDATE users SET full_name = name\nWHERE id > $1 AND id <= $2 AND full_name IS NULL';

export const PLAN_RANGE = `Update on users
  ->  Index Scan using users_pkey on users
        Index Cond: ((id > '0'::bigint) AND (id <= '1000'::bigint))
        Filter: (full_name IS NULL)`;

export const PLAN_NOTE =
  '`EXPLAIN` на стенде. Пачка «следующая тысяча пустых» читает всю таблицу (`Seq Scan`) и ещё идёт по индексу с начала, перешагивая уже готовые строки: чем дальше перенос, тем дороже пачка. Пачка по диапазону идёт по первичному ключу прямо к своей тысяче.';

/** Размер таблицы `users` в байтах (`pg_relation_size`), 10 000 строк, столбец `full_name` пуст. */
export const BATCH_SIZES = {
  before: 851968,
  oneUpdate: 2015232,
  batches: 1998848,
  batchesVacuum: 1261568,
};

export const BATCH_ROWS = [
  { k: 'до переноса', v: BATCH_SIZES.before, how: 'таблица из 10 000 строк, `full_name` пуст', tone: 'info' as const },
  { k: 'один `UPDATE` на всё', v: BATCH_SIZES.oneUpdate, how: 'каждая строка — в двух версиях, старая ещё не убрана', tone: 'err' as const },
  { k: '10 пачек подряд', v: BATCH_SIZES.batches, how: 'то же самое: без `VACUUM` место старых версий не освобождается', tone: 'warn' as const },
  { k: '10 пачек, `VACUUM` между ними', v: BATCH_SIZES.batchesVacuum, how: 'следующая пачка пишет на место, освобождённое после предыдущей', tone: 'ok' as const },
];

export const BATCH_NOTE =
  'Пачки сами по себе таблицу не уменьшают: десять пачек подряд дают почти тот же рост, что один `UPDATE`. Выигрыш в другом — каждая пачка держит блокировки строк на одну тысячу строк и коротко, а паузы дают `VACUUM` вернуть место. В рабочей базе `VACUUM` запускает фоновый процесс autovacuum; в PGlite фоновых процессов нет, поэтому здесь `VACUUM` вызван явно.';

// ─── Раздел 6. Откат ───────────────────────────────────────────────────────────────────────

export const TX_DDL_SQL = `BEGIN;
ALTER TABLE users ADD COLUMN x integer;
ALTER TABLE users ADD COLUMN name text;  -- ошибка 42701: столбец name уже есть
ROLLBACK;
-- Столбца x нет: изменения схемы в Postgres тоже откатываются транзакцией.`;

export const TX_DDL_NOTE =
  'В Postgres изменения схемы транзакционны, как и изменения данных: миграция, упавшая на середине, не оставляет половину столбцов. Это не везде так — в MySQL каждый `ALTER TABLE` фиксируется сразу. Исключения и в Postgres есть: `CREATE INDEX CONCURRENTLY` вне транзакции, и откатывать его приходится руками.';

export const ROLLBACK_ROWS = [
  { step: '1. Расширить', down: '`DROP COLUMN full_name`', code: 'на `v1` — да', tone: 'ok' as const },
  { step: '3. Перенести данные', down: 'не нужен: `name` не тронут', code: 'на `v1` — да, но `v1` не обновляет `full_name` (см. триггер)', tone: 'warn' as const },
  { step: '4. Сделать обязательным', down: '`ALTER COLUMN full_name DROP NOT NULL`, `ALTER COLUMN name SET NOT NULL`', code: 'на `v2` — да; на `v1` — только после обратной миграции', tone: 'warn' as const },
  { step: '6. Сузить', down: 'нет: данные `name` удалены вместе со столбцом', code: 'на `v2` — только после восстановления из копии', tone: 'err' as const },
];

export const ROLLBACK_TEXT =
  'Откат бывает двух видов, и путать их опасно. **Откат кода** — вернуть прошлый образ: секунды, и данные не трогаются. **Обратная миграция** («down») — вернуть схему: иногда простая, иногда невозможная. Пока все шаги «расширить и сузить» обратимы, откат кода остаётся кнопкой. Необратим только последний шаг — поэтому его откладывают, пока новая версия не поработает какое-то время — часто неделю-другую.';

export const WHERE_TO_RUN =
  'Где запускать миграции. Не при старте каждого пода: десять подов начнут одну и ту же миграцию одновременно, а под, который при старте долго мигрирует, не готов к запросам — и выкат стоит, пока он не закончит. Обычно миграцию запускает одна задача перед выкатом: Job в кластере или хук `pre-upgrade` в Helm — оба разобраны в [«Kubernetes: развёртывание»](/delivery/kubernetes/#s1) и в [«Один манифест на много окружений»](/delivery/helm-gitops/#s6). Перед необратимым шагом снимают копию — например, снапшот диска из [«StatefulSet, тома и данные»](/delivery/statefulset/#s6).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Мгновенный `ALTER` останавливает таблицу на минуты',
    d: 'Сама команда — правка каталога за миллисекунды. Но `ACCESS EXCLUSIVE` ждёт конца самой долгой транзакции перед ней, а все запросы к таблице встают в очередь за миграцией. Лечится `SET lock_timeout` и повтором, а не надеждой, что «ночью никого нет».',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Переименование — это удаление для старого кода',
    d: '`RENAME COLUMN` быстрый и без перезаписи, поэтому выглядит безопасным. Старый код на каждый запрос получает `42703`. Переименовывают через новый столбец и три версии кода.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`DEFAULT now()` — одно время на все старые строки',
    d: 'Быстрый `ADD COLUMN … DEFAULT` вычисляет значение один раз. На стенде у 10 000 строк оказалось одно и то же `created_at` — момент миграции. А `DEFAULT gen_random_uuid()` вычисляется для каждой строки и переписывает таблицу.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`SET NOT NULL` читает всю таблицу под замком',
    d: 'Перезаписи нет, но проход по всем строкам идёт под `ACCESS EXCLUSIVE`. Сначала `CHECK … NOT VALID` и `VALIDATE` под мягкой блокировкой — тогда `SET NOT NULL` проходов не делает.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Перенос данных, пока работает старый код',
    d: 'Старая версия вставляет строки без нового столбца и меняет старый столбец, не трогая новый. Первое уронит `VALIDATE` с `23514`, второе молча оставит в новом столбце устаревшее значение. Перенос — после ухода старой версии или вместе с триггером.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Пачка «следующая тысяча пустых» дорожает с каждым шагом',
    d: '`WHERE id IN (SELECT … WHERE full_name IS NULL LIMIT 1000)` без индекса по условию читает всю таблицу и перешагивает уже готовые строки. Пачки по диапазону первичного ключа идут прямо к своей тысяче.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Упавший `CREATE INDEX CONCURRENTLY` оставляет невалидный индекс',
    d: 'Индекс остаётся в каталоге с `indisvalid = false`: запросы его не используют, запись платит за его обновление. Повтор с тем же именем упадёт — сначала `DROP INDEX CONCURRENTLY`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Откат кода не откатывает схему',
    d: 'Кнопка «откатить» возвращает образ, а столбцы остаются какими их оставила миграция. Если прошлая версия на новой схеме не работает — откат становится вторым отказом. Проверка простая: на каждом шаге прогнать запросы прошлой версии.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'PostgreSQL — Explicit Locking',
    href: 'https://www.postgresql.org/docs/current/explicit-locking.html',
    what: 'восемь режимов блокировок таблиц и таблица их конфликтов; какие команды берут какой режим',
  },
  {
    title: 'PostgreSQL — ALTER TABLE',
    href: 'https://www.postgresql.org/docs/current/sql-altertable.html',
    what: 'какие формы переписывают таблицу, `ADD COLUMN … DEFAULT`, `NOT VALID` и `VALIDATE CONSTRAINT`, `SET NOT NULL` и проверенный `CHECK`',
  },
  {
    title: 'PostgreSQL — CREATE INDEX, Building Indexes Concurrently',
    href: 'https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY',
    what: 'как строится индекс без блокировки записи, почему нельзя в транзакции, невалидный индекс после сбоя',
  },
  {
    title: 'PostgreSQL — Client Connection Defaults: lock_timeout',
    href: 'https://www.postgresql.org/docs/current/runtime-config-client.html#GUC-LOCK-TIMEOUT',
    what: '`lock_timeout` и `statement_timeout`',
  },
  {
    title: 'PostgreSQL — Routine Vacuuming',
    href: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
    what: 'версии строк, зачем нужен `VACUUM` и autovacuum',
  },
  {
    title: 'PostgreSQL — Error Codes',
    href: 'https://www.postgresql.org/docs/current/errcodes-appendix.html',
    what: '`42703`, `23502`, `23505`, `23514`, `42701`, `55P03`',
  },
  {
    title: 'MySQL — Statements That Cause an Implicit Commit',
    href: 'https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html',
    what: 'почему в MySQL `ALTER TABLE` не откатывается транзакцией',
  },
  {
    title: 'PGlite',
    href: 'https://pglite.dev/',
    what: 'Postgres, собранный в WebAssembly; версия 0.5.8 (PostgreSQL 18.3) — стенд темы',
  },
  {
    title: 'Martin Fowler — Parallel Change',
    href: 'https://martinfowler.com/bliki/ParallelChange.html',
    what: 'приём «расширяй, потом сужай» в общем виде',
  },
];

export const RELATED =
  'Смежное на сайте: [Прогрессивная доставка, раздел «Сине-зелёный»](/delivery/progressive-delivery/#s2) — «расширяй, потом сужай» как модель совместимости версий. [Kubernetes: развёртывание, раздел «Выкат и откат»](/delivery/kubernetes/#s4) — почему две версии работают одновременно. [Один манифест на много окружений, раздел «Релиз и откат»](/delivery/helm-gitops/#s6) — миграция хуком перед обновлением. [StatefulSet, тома и данные, раздел «Копии, снапшоты и операторы»](/delivery/statefulset/#s6) — копия перед необратимым шагом. [Наблюдаемость](/delivery/observability/) — как увидеть всплеск ошибок во время выката. [Индексы Postgres и EXPLAIN](/data/indexes/) — B-дерево, чтение плана и почему запрос не берёт индекс.';

// ─── Таблицы для печати ────────────────────────────────────────────────────────────────────
// Собраны из литералов выше, чтобы в тексте и в тесте были одни и те же числа.

const OUTCOME_TEXT: Record<Outcome, string> = { ok: 'работает', '42703': '`42703`', '23502': '`23502`' };

export const SAFETY_TABLE = {
  head: ['миграция', 'сама миграция', '`SELECT` · `INSERT` · `UPDATE` старого кода', 'итог'],
  rows: SAFETY_ROWS.map((r) => [
    `\`${r.sql}\``,
    r.migration === 'ok' ? 'выполнилась' : `упала: \`${r.migration}\``,
    r.v1.map((o) => OUTCOME_TEXT[o]).join(' · '),
    r.verdict,
  ]),
  tones: SAFETY_ROWS.map((r) => r.tone),
  cols: 'minmax(220px,1.3fr) minmax(110px,.6fr) minmax(170px,.8fr) minmax(260px,1.6fr)',
  kinds: ['prose', 'prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 820,
};

export const LOCK_TABLE = {
  head: ['режим', 'кто его берёт', '`SELECT`', '`INSERT`, `UPDATE`'],
  rows: LOCK_MODES.map((m) => [
    `\`${LOCK_NAMES[m.mode]}\``,
    m.takenBy.map((c) => `\`${c.sql}\`${c.doc ? ' (по документации)' : ''}`).join('; '),
    m.blocksRead ? '**ждёт**' : 'идёт',
    m.blocksWrite ? '**ждёт**' : 'идёт',
  ]),
  tones: LOCK_MODES.map((m) => (m.blocksRead ? 'err' : m.blocksWrite ? 'warn' : 'ok') as 'err' | 'warn' | 'ok'),
  cols: 'minmax(170px,.8fr) minmax(280px,1.8fr) minmax(80px,.4fr) minmax(110px,.5fr)',
  kinds: ['prose', 'prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 720,
};

export const QUEUE_TABLE = {
  head: ['момент', 'кто', 'что делает', 'что с ним'],
  rows: LOCK_QUEUE.map((r) => [r.at, r.who, r.what, r.result]),
  tones: LOCK_QUEUE.map((r) => r.tone),
  cols: 'minmax(60px,.3fr) minmax(130px,.7fr) minmax(220px,1.3fr) minmax(220px,1.3fr)',
  kinds: ['prose', 'prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 680,
};

export const REWRITE_TABLE = {
  head: ['оператор', 'блокировка', 'перезапись', 'проходов', 'что происходит'],
  rows: REWRITE_ROWS.map((r) => [
    `\`${r.sql}\``,
    r.error ? '—' : `\`${LOCK_NAMES[r.lock]}\``,
    r.error ? '—' : r.rewrite ? '**да**' : 'нет',
    r.error ? `ошибка \`${r.error}\`` : String(r.scans),
    r.note,
  ]),
  tones: REWRITE_ROWS.map((r) => r.tone),
  cols: 'minmax(260px,1.5fr) minmax(150px,.7fr) minmax(90px,.4fr) minmax(80px,.4fr) minmax(260px,1.5fr)',
  kinds: ['prose', 'prose', 'prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 960,
};

const bytes = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
const times = (n: number) => `×${(n / BATCH_SIZES.before).toFixed(2).replace('.', ',')}`;

export const BATCH_TABLE = {
  head: ['вариант', 'байт на диске', 'против исходного', 'почему'],
  rows: BATCH_ROWS.map((r) => [r.k, bytes(r.v), r.v === BATCH_SIZES.before ? '—' : times(r.v), r.how]),
  tones: BATCH_ROWS.map((r) => r.tone),
  cols: 'minmax(200px,1fr) minmax(120px,.6fr) minmax(110px,.5fr) minmax(240px,1.4fr)',
  kinds: ['prose', 'mono', 'mono', 'prose'] as ('prose' | 'mono')[],
  minWidth: 720,
};

export const ROLLBACK_TABLE = {
  head: ['шаг', 'обратная миграция', 'откат кода'],
  rows: ROLLBACK_ROWS.map((r) => [r.step, r.down, r.code]),
  tones: ROLLBACK_ROWS.map((r) => r.tone),
  cols: 'minmax(170px,.7fr) minmax(260px,1.4fr) minmax(260px,1.4fr)',
  kinds: ['prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 720,
};
