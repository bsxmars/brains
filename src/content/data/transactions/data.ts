import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Level, Op, Row, RowLockMode, Scenario, Step } from '@/widgets/mvcc-lab/model/types';

/**
 * Данные темы «Транзакции и уровни изоляции: какие аномалии вы разрешили».
 *
 * Тема написана здесь, 2026-10-01, второй в направлении «Данные и бэкенд».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Два стенда, потому что аномалии изоляции видны только в двух одновременных сеансах.
 *
 * 1. **Два настоящих сеанса: Postgres 16.15 в Docker** (`postgres:16-alpine`, образ был
 *    на машине; `select version()` → `PostgreSQL 16.15 on aarch64-unknown-linux-musl`).
 *    Клиентского пакета (`pg`, `postgres`) в проекте нет и не ставился: сеансы — два процесса
 *    `docker exec -i … psql -X -A -t` с `\set VERBOSITY verbose`, Node 24.11.0 пишет в них SQL
 *    по шагу и читает ответ до метки `\echo`/`\warn`. «Шаг ждёт блокировку» определяет третий
 *    сеанс по `pg_stat_activity.wait_event_type = 'Lock'`, а не таймер. После того как шаг
 *    встал, драйвер ждёт 500 мс при `SET deadlock_timeout = '200ms'` в обоих сеансах — это
 *    темп человека, который шагает руками: проверка на дедлок у первого ждущего успевает пройти
 *    раньше, чем второй замкнёт круг. Так сняты:
 *      — `STAND_RUNS`: десять сценариев × три уровня, вывод каждого шага и итог в базе;
 *      — `DIRTY_RU`: грязное чтение на `READ UNCOMMITTED`;
 *      — `LOCK_MATRIX`: 16 пар режимов `SELECT … FOR …` и `… NOWAIT` во втором сеансе;
 *      — `FK_ROWS`: вставка в дочернюю таблицу против блокировки родительской строки;
 *      — `SKIP_LOCKED_RUN`, `ORDERED_RUN`, `SHOW_DEFAULTS`.
 *    Драйвер живёт в `tests/unit/transactions.test.ts` и пересобирает всё это, если задать
 *    `TX_PG_CONTAINER=<имя контейнера>`; без переменной блок пропускается (Docker есть не везде).
 *
 * 2. **Одна сессия: PGlite** — `@electric-sql/pglite` 0.5.8 (`PostgreSQL 18.3 (PGlite 0.5.8)`)
 *    с `pageinspect`, в процессе теста, как в «Индексах». PGlite — однопользовательский: второго
 *    соединения к той же базе у него нет. Им сняты и пересобираются всегда: версии строк
 *    на странице (`heap_page_items` → `HEAP_ROWS`), ленивая выдача номера транзакции и формат
 *    снимка (`SNAP_SQL`), бит «только блокировка» в `xmax` (`t_infomask & 128`), ошибка `25001`,
 *    уровень по умолчанию, повтор транзакции `RETRY_CODE` на настоящей ошибке `40001`
 *    (`RAISE … USING ERRCODE`).
 *
 * Учебная модель — строки `ENGINE_CODE`, `SNAPSHOT_CODE`, `WRITE_CODE`, `SSI_CODE`; их же
 * исполняет демо. Тест сверяет: все 30 прогонов сценариев — шаг в шаг с `STAND_RUNS` (вывод,
 * код ошибки, кто ждал и до какого шага, итог в базе); `CONFLICTS` — с `LOCK_MATRIX`; версии,
 * `xmin`/`xmax`, бит блокировки и снимки одной сессии — с PGlite.
 *
 * ── Что взято из документации, а не со стенда ────────────────────────────────────────────
 *   — таблица аномалий стандарта SQL (Transaction Isolation, Table 13.1) — столбец «по стандарту»;
 *   — что Postgres выбирает жертву дедлока непредсказуемо и полагаться на это нельзя (13.3.4);
 *     стенд показывает один порядок — при ручном темпе;
 *   — что SSI берёт предикатные блокировки на строки, страницы и целые таблицы и потому даёт
 *     ложные срабатывания; что ошибка `40001` на Serializable может прийти на любом операторе,
 *     не только на `COMMIT`; что защита есть только между транзакциями Serializable;
 *     `READ ONLY DEFERRABLE` (Transaction Isolation, 13.2.3; wiki SSI) — на стенде видно только
 *     падение на `COMMIT` в сценарии с дежурными;
 *   — Durability: `COMMIT` возвращается после сброса WAL на диск (`synchronous_commit`, WAL
 *     Reliability) — падение сервера стендом не моделировалось;
 *   — IndexedDB: пересекающиеся `readwrite`-транзакции браузер выполняет по очереди
 *     (спецификация IndexedDB, Transaction scheduling);
 *   — что ошибки `node-postgres` несут SQLSTATE в поле `code` — `RETRY_CODE` проверен на PGlite,
 *     у которого поле то же.
 *
 * ── Чем модель проще Postgres ─────────────────────────────────────────────────────────────
 * Предикатные блокировки SSI в модели — по условию `WHERE`, у Postgres — по строкам, страницам
 * индекса или всей таблице (грубее, отсюда ложные срабатывания). Модель не знает про индексы,
 * уникальность ключа, MultiXact (несколько держателей `FOR SHARE` — у Postgres это отдельный
 * номер в `xmax`), подтранзакции и `VACUUM`. Номер транзакции настройки — 100, у PGlite — 753.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'транзакция',
    d: 'Группа команд между `BEGIN` и `COMMIT`, которая применяется целиком или не применяется вовсе. Команда вне `BEGIN` — тоже транзакция, из одной команды.',
  },
  {
    k: 'сеанс (соединение)',
    d: 'Одно подключение к базе. Внутри сеанса команды идут строго по очереди, а разные сеансы работают одновременно. Пул соединений в приложении — это несколько сеансов.',
  },
  {
    k: 'версия строки',
    d: 'Postgres не меняет строку на месте. `UPDATE` пишет рядом новую копию, а старая остаётся. На диске у одной строки таблицы может быть несколько версий сразу.',
  },
  {
    k: 'номер транзакции (xid)',
    d: 'Число, которое транзакция получает при первой записи. Им подписаны версии строк: кто версию создал (`xmin`) и кто заменил или удалил (`xmax`).',
  },
  {
    k: 'снимок (snapshot)',
    d: 'Список «какие транзакции к этому моменту уже закончились». По снимку транзакция решает, какие версии строк ей видны.',
  },
  {
    k: 'аномалия',
    d: 'Результат, который не мог бы получиться, если бы транзакции шли строго по одной. Например, два перевода прошли, а на счёте учтён только один.',
  },
  {
    k: 'SQLSTATE',
    d: 'Пятизначный код ошибки Postgres. Текст сообщения может меняться от версии к версии, код — нет: по нему приложение и решает, что делать. `40001` — «повторите транзакцию».',
  },
];

export const PLAIN_TX =
  'Как два кассира с одной общей кассой. Каждый пересчитывает деньги, пробивает чек и кладёт выручку. Если оба одновременно пересчитали «100», один добавил 10, а другой 20, и каждый записал свою сумму, — в журнале будет 120, а не 130. Ни один кассир не ошибся, ошибка в том, что они работали одновременно. Уровень изоляции — это правила, которые база навязывает кассирам: кому ждать, кого остановить и кому сказать «пересчитай заново».';

export const PREREQ_NOTE =
  'Тема опирается на три вещи. Две разобраны на сайте, третья объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'SQL: SELECT, UPDATE, BEGIN и COMMIT',
    d: 'Достаточно читать простые запросы. `UPDATE accounts SET balance = 110 WHERE id = 1` меняет столбец у строки с `id = 1`; `BEGIN` открывает транзакцию, `COMMIT` её фиксирует, `ROLLBACK` отменяет.',
    tone: 'info',
  },
  {
    t: 'Блокировки таблиц',
    d: 'Команда берёт блокировку на таблицу и держит её до конца транзакции; несовместимая команда ждёт. Здесь речь пойдёт о блокировках отдельных **строк** — они устроены иначе.',
    href: '/delivery/db-migrations/#s3',
    hrefLabel: '«Миграции базы без простоя», раздел «Блокировки»',
    tone: 'info',
  },
  {
    t: 'Генератор в JavaScript',
    d: 'Функция `function*` умеет остановиться на `yield` и продолжить с того же места, когда её позовут снова. Учебная модель так и ждёт блокировку: отдаёт `{ wait: xid }` и продолжает, когда та транзакция закончится.',
    href: '/js/generators/#s1',
    hrefLabel: '«Генераторы и асинхронные итераторы», раздел «Пауза генератора»',
    tone: 'info',
  },
];

// ─── Раздел 1. Что обещает транзакция ──────────────────────────────────────────────────────

export const ACID_ROWS: { k: string; what: string; how: string; tone?: 'warn' }[] = [
  {
    k: 'A — атомарность',
    what: 'Применяется всё или ничего. Упала третья команда из пяти — первых двух тоже не было.',
    how: 'Откат ничего не стирает. Версии, записанные отменённой транзакцией, остаются на странице, но становятся невидимы: их `xmin` — номер транзакции со статусом «отменена».',
  },
  {
    k: 'C — согласованность',
    what: 'После транзакции данные удовлетворяют правилам.',
    how: 'Postgres проверяет только объявленные правила: `PRIMARY KEY`, `FOREIGN KEY`, `CHECK`, `NOT NULL`. Правило «хотя бы один врач на дежурстве», которое живёт в коде приложения, он не знает и не защищает.',
    tone: 'warn',
  },
  {
    k: 'I — изоляция',
    what: 'Одновременные транзакции не мешают друг другу.',
    how: 'Насколько не мешают — решает уровень изоляции. Полностью «как будто по одной» — только на Serializable. По умолчанию стоит Read Committed, и он пропускает несколько аномалий.',
    tone: 'warn',
  },
  {
    k: 'D — долговечность',
    what: 'После `COMMIT` данные переживут падение сервера.',
    how: 'Перед ответом на `COMMIT` Postgres сбрасывает на диск журнал предзаписи (WAL). Данные в таблицах могут доехать до диска позже: после падения их восстановят из журнала.',
  },
];

export const ACID_NOTE =
  'Буква I — самая дорогая из четырёх, и поэтому её выдают дозированно. Полная изоляция означает, что база иногда отказывает транзакции и просит повторить. Уровень ниже не отказывает, но разрешает часть аномалий — и тогда защищаться от них приходится приложению.';

export const IDB_NOTE =
  'Для сравнения — IndexedDB в браузере: там две `readwrite`-транзакции с общими хранилищами просто не идут одновременно, браузер ставит вторую в очередь. Аномалий нет, но нет и параллельной записи. Postgres выбирает другое: пишут все сразу, а видимость решают версии строк. Как живёт транзакция IndexedDB — в теме [«Хранилища браузера»](/platform/browser-storage/#s4).';

// ─── Раздел 2. Версии строк ────────────────────────────────────────────────────────────────

export const PLAIN_MVCC =
  'Как табличка на экспонате в музее: «выставлен с такого-то дня, снят такого-то». Экспонат, снятый вчера, никуда не делся — он в запаснике, и экскурсия, которая началась позавчера по старому путеводителю, его ещё «видит». Табличка у версии строки — два номера: `xmin` («выставлен транзакцией…») и `xmax` («снят транзакцией…»).';

export const ACCOUNTS_SQL = `CREATE TABLE accounts (
  id      int  PRIMARY KEY,
  owner   text NOT NULL,
  balance int  NOT NULL,
  version int  NOT NULL
);
INSERT INTO accounts VALUES (1, 'Аня', 100, 1), (2, 'Борис', 100, 1);`;

export const DOCTORS_SQL = `CREATE TABLE doctors (
  name    text    PRIMARY KEY,
  on_call boolean NOT NULL
);
INSERT INTO doctors VALUES ('alice', true), ('bob', true);`;

/** Одна сессия PGlite. Тест выполняет ровно эту строку на свежей базе. */
export const HEAP_SQL = `${ACCOUNTS_SQL}                       -- транзакция 753

BEGIN;                                                   -- 754
UPDATE accounts SET balance = 110 WHERE id = 1;
DELETE FROM accounts WHERE id = 2;
COMMIT;

BEGIN;                                                   -- 755
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
ROLLBACK;

BEGIN;                                                   -- 756
INSERT INTO accounts VALUES (3, 'Вера', 500, 1);
ROLLBACK;`;

/** Как подсмотреть все версии на странице, включая невидимые. */
export const HEAP_QUERY = `CREATE EXTENSION pageinspect;
SELECT lp, t_xmin, t_xmax, t_ctid
FROM heap_page_items(get_raw_page('accounts', 0));`;

/** `heap_page_items` после `HEAP_SQL`; `id` и `balance` — из `heap_page_item_attrs`. Пересобирает тест. */
export const HEAP_ROWS: { lp: number; xmin: number; xmax: number; ctid: string; id: number; balance: number; what: string; tone?: 'ok' | 'err' | 'warn' }[] = [
  { lp: 1, xmin: 753, xmax: 754, ctid: '(0,3)', id: 1, balance: 100, what: 'Старая версия Ани. 754 её заменила, `ctid` указывает на новую — на `lp` 3.', tone: 'err' },
  { lp: 2, xmin: 753, xmax: 754, ctid: '(0,2)', id: 2, balance: 100, what: 'Борис, удалённый транзакцией 754. `ctid` указывает сам на себя: новой версии нет.', tone: 'err' },
  { lp: 3, xmin: 754, xmax: 755, ctid: '(0,3)', id: 1, balance: 110, what: 'Живая версия Ани. `xmax` не ноль: 755 взяла её `FOR UPDATE` и откатилась. Это след блокировки, а не удаление.', tone: 'ok' },
  { lp: 4, xmin: 756, xmax: 0, ctid: '(0,4)', id: 3, balance: 500, what: 'Вера. Транзакция 756 откатилась, поэтому версия не видна никому, хотя `xmax` пуст.', tone: 'err' },
];

export const HEAP_NOTE =
  '`SELECT xmin, xmax, * FROM accounts` после тех же команд вернёт одну строку: Аню с балансом 110, `xmin` 754 и `xmax` 755. Остальные три версии лежат на той же странице, пока их не уберёт `VACUUM`, — `SELECT` их просто не показывает.';

export const PLAIN_SNAPSHOT =
  'Снимок — как список сданных работ, который учитель составил в 9:00. Работа ученика, сданная в 9:05, в этот список не попала, даже если учитель проверяет стопку в 9:30. Чтобы её увидеть, нужен новый список — новый снимок.';

/** Одна сессия PGlite на свежей базе после `ACCOUNTS_SQL`. Значения в комментариях сверяет тест. */
export const SNAP_SQL = `BEGIN;
SELECT pg_current_xact_id_if_assigned();          -- NULL: номера ещё нет
SELECT pg_current_snapshot();                     -- 754:754:
UPDATE accounts SET balance = 110 WHERE id = 1;
SELECT pg_current_xact_id_if_assigned();          -- 754
SELECT pg_current_snapshot();                     -- 754:754:
COMMIT;
SELECT pg_current_snapshot();                     -- 755:755:`;

export const SNAP_FACTS = [
  {
    t: 'Номер выдаётся при первой записи',
    d: 'До `UPDATE` у транзакции номера нет: `pg_current_xact_id_if_assigned()` возвращает `NULL`. Транзакции, которые только читают, номер не тратят вовсе.',
  },
  {
    t: 'Снимок — три поля',
    d: '`xmin:xmax:xip`. Все номера меньше `xmin` уже закончились. Номер `xmax` и старше снимок считает незаконченными. Между ними `xip` перечисляет тех, кто ещё работал. Для «видна ли версия» снимку достаточно этих трёх полей и статуса транзакции.',
  },
  {
    t: 'Своя транзакция — тоже «незаконченная»',
    d: 'Снимок `754:754:` взят транзакцией 754: свой номер для снимка «в будущем». Свои версии транзакция всё равно видит — правило видимости проверяет их отдельно, по номеру.',
  },
];

export const SNAPSHOT_CODE = `// Снимок: какие транзакции к этому моменту уже закончились.
function takeSnapshot(db) {
  const xmax = db.lastCompleted + 1;         // эта и более поздние — «ещё не закончились»
  const xip = [...db.running].filter((x) => x < xmax).sort((a, b) => a - b);
  const xmin = Math.min(xmax, ...xip);       // все, кто старше, точно закончились
  return { xmin, xmax, xip };
}

// Виден ли снимку итог транзакции xid: закоммичена и закончилась до снимка.
function committedFor(db, snap, xid) {
  return db.status[xid] === 'committed' && xid < snap.xmax && !snap.xip.includes(xid);
}

// Правило видимости версии строки для транзакции tx.
function visible(db, tx, snap, v) {
  const mine = (xid) => tx.xid !== null && xid === tx.xid;
  if (!mine(v.xmin) && !committedFor(db, snap, v.xmin)) return false; // создатель не виден
  if (v.xmax === null) return true;                                   // версию никто не заменял
  if (mine(v.xmax)) return false;                                     // заменил я сам
  return !committedFor(db, snap, v.xmax);                             // замена ещё не видна
}

// Read Committed берёт снимок на каждый оператор, остальные уровни — один на транзакцию.
function snapshotFor(db, tx) {
  if (tx.level === 'read committed' || tx.snap === null) tx.snap = takeSnapshot(db);
  return tx.snap;
}`;

export const VISIBILITY_NOTE =
  'Модель хранит у версии только номера, а не время, — как и Postgres. В модели `xmax` — только тот, кто версию заменил; блокировки лежат отдельным списком `locks`. У Postgres и то, и другое пишется в одно поле `xmax`, а отличает их бит «только блокировка» в заголовке версии. Поэтому `committedFor` спрашивает статус транзакции: номер в `xmax` откатившейся транзакции ничего не значит.';

// ─── Раздел 3. Снимки и уровни ─────────────────────────────────────────────────────────────

export const LEVEL_SNAPSHOT_ROWS: { k: string; snap: string; write: string; tone?: 'ok' | 'warn' }[] = [
  {
    k: 'Read Committed (по умолчанию)',
    snap: 'Новый снимок на **каждый оператор**. Два одинаковых `SELECT` подряд могут вернуть разное.',
    write: 'Наткнулся на строку, которую заменила закоммиченная транзакция, — берёт её свежую версию, перепроверяет `WHERE` и пишет поверх.',
    tone: 'warn',
  },
  {
    k: 'Repeatable Read',
    snap: 'Один снимок на **всю транзакцию**, взятый первым запросом (не `BEGIN`).',
    write: 'Наткнулся на такую строку — ошибка `40001`: повторите транзакцию целиком.',
  },
  {
    k: 'Serializable',
    snap: 'Как Repeatable Read.',
    write: 'Как Repeatable Read, и вдобавок следит, кто что читал. Если чтения и записи переплелись так, что «по одной» не выйти, — тоже `40001`.',
    tone: 'ok',
  },
];

export const LEVEL_NOTE =
  '`READ UNCOMMITTED` Postgres принимает, но работает как Read Committed: на стенде сеанс с этим уровнем незакоммиченное значение не увидел. Грязного чтения в Postgres нет ни на одном уровне.';

/** Что разрешает каждый уровень. Ячейки вычисляет тест из `STAND_RUNS` — правило в `anomalyCells`. */
export const LEVEL_TABLE: { level: string; dirty: string; nonrepeatable: string; phantom: string; lost: string; skew: string }[] = [
  { level: 'Read Committed', dirty: 'нет', nonrepeatable: 'есть', phantom: 'есть', lost: 'есть', skew: 'есть' },
  { level: 'Repeatable Read', dirty: 'нет', nonrepeatable: 'нет', phantom: 'нет', lost: 'нет — `40001`', skew: 'есть' },
  { level: 'Serializable', dirty: 'нет', nonrepeatable: 'нет', phantom: 'нет', lost: 'нет — `40001`', skew: 'нет — `40001`' },
];

export const STANDARD_NOTE =
  'Стандарт SQL разрешает фантомы на Repeatable Read, а потерянное обновление и write skew не упоминает вовсе. Postgres строже стандарта: его Repeatable Read — это изоляция снимком, и фантомов в ней нет. Но и не всесилен: write skew на Repeatable Read проходит, и стандарт тут не подсказка — таблицу в документации читают вместе с таблицей выше.';

// ─── Раздел 4. Аномалии по шагам ───────────────────────────────────────────────────────────

const ID1 = { id: 1 };
const BEGIN = 'BEGIN ISOLATION LEVEL {level};';
const st = (s: 'A' | 'B', sql: string, op: Op): Step => ({ s, sql, op });
const begin = (s: 'A' | 'B') => st(s, BEGIN, { t: 'begin' });
const commit = (s: 'A' | 'B') => st(s, 'COMMIT;', { t: 'commit' });
const rollback = (s: 'A' | 'B') => st(s, 'ROLLBACK;', { t: 'rollback' });
const readBalance = (s: 'A' | 'B') => st(s, 'SELECT balance FROM accounts WHERE id = 1;', { t: 'select', where: ID1, cols: ['balance'] });
const setBalance = (s: 'A' | 'B', n: number) =>
  st(s, `UPDATE accounts SET balance = ${n} WHERE id = 1;`, { t: 'update', where: ID1, set: { balance: n } });
const addBalance = (s: 'A' | 'B', id: number, n: number) =>
  st(s, `UPDATE accounts SET balance = balance ${n < 0 ? '-' : '+'} ${Math.abs(n)} WHERE id = ${id};`, {
    t: 'update',
    where: { id },
    set: { balance: { add: n } },
  });
const countRich = (s: 'A' | 'B') =>
  st(s, 'SELECT count(*) FROM accounts WHERE balance >= 100;', { t: 'select', where: { balance: { gte: 100 } }, count: true });
const countOnCall = (s: 'A' | 'B') =>
  st(s, 'SELECT count(*) FROM doctors WHERE on_call;', { t: 'select', where: { on_call: true }, count: true });
const offCall = (s: 'A' | 'B', name: string) =>
  st(s, `UPDATE doctors SET on_call = false WHERE name = '${name}';`, { t: 'update', where: { name }, set: { on_call: false } });

export const ACCOUNT_ROWS: Row[] = [
  { id: 1, owner: 'Аня', balance: 100, version: 1 },
  { id: 2, owner: 'Борис', balance: 100, version: 1 },
];
export const DOCTOR_ROWS: Row[] = [
  { name: 'alice', on_call: true },
  { name: 'bob', on_call: true },
];

const accounts = { table: 'accounts' as const, key: 'id', show: ['balance'], rows: ACCOUNT_ROWS };
const checkBalance = { sql: 'SELECT balance FROM accounts WHERE id = 1;', op: { t: 'select', where: ID1, cols: ['balance'] } as Op };

export const SCENARIOS: Scenario[] = [
  {
    id: 'dirty-read',
    group: 'read',
    label: 'Грязное чтение',
    ...accounts,
    steps: [
      begin('A'),
      setBalance('A', 150),
      begin('B'),
      readBalance('B'),
      rollback('A'),
      readBalance('B'),
      commit('B'),
    ],
    check: checkBalance,
    note: 'A меняет баланс и ещё не закоммитила. Увидит ли B число, которого, как выяснится, никогда не было?',
    verdict: {
      'read committed': 'B оба раза читает **100**: версия со 150 создана незаконченной транзакцией, и правило видимости отбрасывает её первой же проверкой. После отката A она так и остаётся невидимой.',
      'repeatable read': 'Так же: **100**. Грязного чтения в Postgres нет ни на одном уровне.',
      serializable: 'Так же: **100**.',
    },
  },
  {
    id: 'non-repeatable',
    group: 'read',
    label: 'Неповторяемое чтение',
    ...accounts,
    steps: [
      begin('A'),
      readBalance('A'),
      begin('B'),
      setBalance('B', 150),
      commit('B'),
      readBalance('A'),
      commit('A'),
    ],
    check: checkBalance,
    note: 'A дважды читает одну строку, а между чтениями B меняет её и коммитит.',
    verdict: {
      'read committed': 'Второе чтение A вернуло **150**: новый оператор — новый снимок, а в нём B уже закончилась. Внутри одной транзакции одна и та же строка дала два ответа.',
      'repeatable read': 'Второе чтение вернуло **100**: снимок взят первым `SELECT` и не меняется, а B в нём ещё работала. В базе при этом уже **150**.',
      serializable: 'Как на Repeatable Read: **100**. Обе транзакции закоммитились — «по одной» это объясняется порядком «сначала A, потом B».',
    },
  },
  {
    id: 'phantom',
    group: 'read',
    label: 'Фантом',
    ...accounts,
    steps: [
      begin('A'),
      countRich('A'),
      begin('B'),
      st('B', "INSERT INTO accounts VALUES (3, 'Вера', 500, 1);", { t: 'insert', row: { id: 3, owner: 'Вера', balance: 500, version: 1 } }),
      commit('B'),
      countRich('A'),
      commit('A'),
    ],
    check: { sql: 'SELECT count(*) FROM accounts;', op: { t: 'select', where: {}, count: true } },
    note: 'То же, но строка не меняется, а появляется: A считает строки по условию, B вставляет подходящую.',
    verdict: {
      'read committed': 'Второй подсчёт — **3**: новая строка «материализовалась» посреди транзакции. Это и есть фантом.',
      'repeatable read': 'Второй подсчёт — **2**. Стандарт SQL разрешает тут фантом, но Postgres его не показывает: вставка B просто не видна старому снимку.',
      serializable: 'Тоже **2**, и обе транзакции закоммитились.',
    },
  },
  {
    id: 'snapshot-start',
    group: 'read',
    label: 'Когда берётся снимок',
    ...accounts,
    steps: [
      begin('A'),
      setBalance('B', 150),
      readBalance('A'),
      setBalance('B', 200),
      readBalance('A'),
      commit('A'),
    ],
    check: checkBalance,
    note: 'B пишет без `BEGIN`: каждая команда — отдельная транзакция, закоммиченная сразу. Первая запись B случилась **после** `BEGIN` у A.',
    verdict: {
      'read committed': 'A видит **150**, потом **200**: снимок на каждый оператор.',
      'repeatable read': 'A видит **150** оба раза. Запись B была после `BEGIN`, но до первого запроса A, — а снимок берётся именно первым запросом. Итог в базе — 200.',
      serializable: 'Так же: **150** оба раза. `BEGIN` ничего не фиксирует, «момент транзакции» — её первый запрос.',
    },
  },
  {
    id: 'lost-update',
    group: 'write',
    label: 'Потерянное обновление',
    ...accounts,
    steps: [begin('A'), begin('B'), readBalance('A'), readBalance('B'), setBalance('A', 110), setBalance('B', 120), commit('A'), commit('B')],
    check: checkBalance,
    note: 'Классика «прочитать — посчитать в приложении — записать». A хочет добавить 10, B — 20; обе прочли 100 и записывают уже готовые числа.',
    verdict: {
      'read committed': 'В базе **120**: пополнение A на 10 пропало без единой ошибки. B подождала, пока A закоммитит, и записала своё «120» поверх — число она посчитала из устаревших 100.',
      'repeatable read': 'B получила `40001`, в базе **110**. Строка, которую B собиралась заменить, изменилась после её снимка, — Postgres отказывается писать поверх. Приложение повторяет транзакцию B, читает 110 и пишет 130.',
      serializable: 'Как на Repeatable Read: `40001` у B, в базе **110**.',
    },
  },
  {
    id: 'increment',
    group: 'write',
    label: 'UPDATE x = x + 1',
    ...accounts,
    steps: [begin('A'), begin('B'), readBalance('A'), readBalance('B'), addBalance('A', 1, 10), addBalance('B', 1, 20), commit('A'), commit('B')],
    check: checkBalance,
    note: 'То же пополнение, но арифметику делает сама база: `SET balance = balance + 10`.',
    verdict: {
      'read committed': 'В базе **130** — оба пополнения на месте. B ждала A, а после её коммита взяла **свежую** версию (110) и прибавила 20 к ней. Атомарный `UPDATE` на Read Committed безопасен.',
      'repeatable read': 'А здесь `40001` у B и **110** в базе. Даже атомарный `UPDATE` не может прочесть свежую версию мимо своего снимка — транзакцию придётся повторить.',
      serializable: 'Как на Repeatable Read: `40001`, **110**.',
    },
  },
  {
    id: 'for-update',
    group: 'write',
    label: 'SELECT … FOR UPDATE',
    ...accounts,
    steps: [
      begin('A'),
      begin('B'),
      st('A', 'SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;', { t: 'select', where: ID1, cols: ['balance'], lock: 'update' }),
      st('B', 'SELECT balance FROM accounts WHERE id = 1 FOR UPDATE;', { t: 'select', where: ID1, cols: ['balance'], lock: 'update' }),
      setBalance('A', 110),
      commit('A'),
      setBalance('B', 130),
      commit('B'),
    ],
    check: checkBalance,
    note: '«Прочитать — посчитать — записать», но чтение сразу забирает строку себе. Второй сеанс ждёт уже на чтении.',
    verdict: {
      'read committed': 'B ждала на `SELECT` и получила **110** — свежее значение. Посчитала 110 + 20 и записала 130. Итог **130**: ничего не потеряно.',
      'repeatable read': 'B дождалась и получила `40001`: строка изменилась после её снимка. Дальше её `UPDATE` отвергнут с `25P02` — транзакция уже сломана. Итог **110**, B нужно повторить.',
      serializable: 'Как на Repeatable Read: `40001`, затем `25P02`, итог **110**.',
    },
  },
  {
    id: 'optimistic',
    group: 'write',
    label: 'Версия в строке',
    ...accounts,
    steps: [
      begin('A'),
      begin('B'),
      st('A', 'SELECT balance, version FROM accounts WHERE id = 1;', { t: 'select', where: ID1, cols: ['balance', 'version'] }),
      st('B', 'SELECT balance, version FROM accounts WHERE id = 1;', { t: 'select', where: ID1, cols: ['balance', 'version'] }),
      st('A', 'UPDATE accounts SET balance = 110, version = 2 WHERE id = 1 AND version = 1;', {
        t: 'update',
        where: { id: 1, version: 1 },
        set: { balance: 110, version: 2 },
      }),
      commit('A'),
      st('B', 'UPDATE accounts SET balance = 120, version = 2 WHERE id = 1 AND version = 1;', {
        t: 'update',
        where: { id: 1, version: 1 },
        set: { balance: 120, version: 2 },
      }),
      commit('B'),
    ],
    check: checkBalance,
    note: 'Оптимистичная блокировка: никто ничего не захватывает, а запись проходит, только если `version` не изменилась с момента чтения.',
    verdict: {
      'read committed': 'У B — `UPDATE 0`: свежая версия строки уже с `version = 2`, условие не совпало. Ошибки нет, и если приложение не проверит число строк, пополнение B молча пропадёт. Итог **110**.',
      'repeatable read': 'У B — `40001`: снимок B видит `version = 1`, но строку уже заменили. Итог **110**. Проверка версии здесь дублирует то, что база делает сама.',
      serializable: 'Как на Repeatable Read: `40001`, итог **110**.',
    },
  },
  {
    id: 'write-skew',
    group: 'hard',
    label: 'Write skew: дежурные',
    table: 'doctors',
    key: 'name',
    show: ['on_call'],
    rows: DOCTOR_ROWS,
    steps: [begin('A'), begin('B'), countOnCall('A'), countOnCall('B'), offCall('A', 'alice'), offCall('B', 'bob'), commit('A'), commit('B')],
    check: { sql: 'SELECT count(*) FROM doctors WHERE on_call;', op: { t: 'select', where: { on_call: true }, count: true } },
    note: 'Правило больницы: на дежурстве хотя бы один врач. Алиса и Боб одновременно просят отгул; каждый проверяет, что дежурных двое, и снимает **себя**. Строки разные — конфликта записи нет.',
    verdict: {
      'read committed': 'Обе транзакции закоммитились, дежурных **0**. Никто не ждал: каждая писала свою строку.',
      'repeatable read': 'Тоже **0**. Снимок не помогает: каждая транзакция честно видела двоих и честно изменила только свою строку. Это и есть write skew — аномалия, которую изоляция снимком пропускает.',
      serializable: 'A закоммитилась, B получила `40001` на `COMMIT`. Дежурных **1**. Serializable заметил, что каждая прочла строку, которую изменила другая, — по одной так не бывает.',
    },
  },
  {
    id: 'deadlock',
    group: 'hard',
    label: 'Дедлок',
    ...accounts,
    show: ['balance'],
    steps: [begin('A'), begin('B'), addBalance('A', 1, -10), addBalance('B', 2, -10), addBalance('A', 2, 10), addBalance('B', 1, 10), commit('A'), commit('B')],
    check: { sql: 'SELECT id, balance FROM accounts ORDER BY id;', op: { t: 'select', where: {}, cols: ['id', 'balance'] } },
    note: 'Два перевода навстречу: A — от Ани Борису, B — от Бориса Ане. Каждая сначала списывает со «своего» счёта, потом зачисляет на чужой.',
    verdict: {
      'read committed': 'A ждёт B, B ждёт A — круг. Postgres замечает его и обрывает B с `40P01`; A сразу продолжает. Итог **1|90 / 2|110**: прошёл только перевод A.',
      'repeatable read': 'То же: дедлок не зависит от уровня изоляции, это про блокировки строк. Итог **1|90 / 2|110**.',
      serializable: 'То же: `40P01` у B, итог **1|90 / 2|110**.',
    },
  },
];

export const LEVELS: { value: Level; label: string; sql: string }[] = [
  { value: 'read committed', label: 'Read Committed', sql: 'READ COMMITTED' },
  { value: 'repeatable read', label: 'Repeatable Read', sql: 'REPEATABLE READ' },
  { value: 'serializable', label: 'Serializable', sql: 'SERIALIZABLE' },
];

export const GROUPS: { value: Scenario['group']; label: string }[] = [
  { value: 'read', label: 'Чтение' },
  { value: 'write', label: 'Запись' },
  { value: 'hard', label: 'Write skew и дедлок' },
];

export const DEMO_CAPTION =
  'Каждый шаг выполняет учебная модель — строки `ENGINE_CODE`, `SNAPSHOT_CODE`, `WRITE_CODE` и `SSI_CODE`, напечатанные в теме. Те же сценарии прошли в двух настоящих сеансах Postgres 16, и вывод модели совпал с ними шаг в шаг на всех трёх уровнях: числа, `UPDATE 0`, коды ошибок, кто ждал и до какого шага.';

export const PLAIN_ANOMALY =
  'Как проверить, аномалия ли это: попробуйте расставить транзакции по одной — сначала A целиком, потом B, или наоборот. Если ни один порядок не даёт такой итог, значит, одновременность что-то сломала. У «дежурных» оба порядка дают одного врача на смене, а одновременно вышло ноль.';

export const ANOMALIES: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Неповторяемое чтение и фантом',
    d: 'Транзакция читает одно и то же дважды и получает разное: изменённую строку или новую. Опасно, когда по первому чтению принимают решение, а по второму действуют — например, считают сумму и потом выводят список.',
    tone: 'warn',
  },
  {
    t: 'Потерянное обновление',
    d: 'Две транзакции прочли одно значение, каждая посчитала новое и записала. Вторая запись стёрла первую. На Read Committed это проходит без ошибок, и это самая частая гонка в веб-приложениях: счётчики, остатки, балансы.',
    tone: 'err',
  },
  {
    t: 'Write skew',
    d: 'Две транзакции прочли общий набор строк, проверили по нему правило и изменили **разные** строки. Конфликта записи нет, поэтому ни снимок, ни блокировки строк не мешают. Ловит только Serializable — или явная блокировка того, что читали.',
    tone: 'err',
  },
];

// ─── Движок модели: сеансы, ожидание, дедлок ───────────────────────────────────────────────

export const ENGINE_CODE = `function createDb(rows) {
  const db = { status: { 100: 'committed' }, running: new Set(), lastCompleted: 100,
               nextXid: 101, versions: [], txs: [], clock: 0 };
  for (const row of rows) {
    db.versions.push({ row, xmin: 100, xmax: null, xmaxMode: null, locks: [], next: null });
  }
  return db;
}

function sqlError(code, message) {
  return Object.assign(new Error(message), { code });
}

function matches(row, where) {
  return Object.entries(where).every(([col, want]) =>
    typeof want === 'object' ? row[col] >= want.gte : row[col] === want);
}

// Номер транзакции выдаётся при первой записи, а не на BEGIN.
function assignXid(db, tx) {
  if (tx.xid !== null) return;
  tx.xid = db.nextXid++;
  db.running.add(tx.xid);
}

function newTx(db, name, level) {
  const tx = { name, level, state: 'active', xid: null, snap: null,
               snapAt: null, doneAt: null, reads: [], writes: [] };
  db.txs.push(tx);
  return tx;
}

function end(db, tx, status) {
  tx.state = status;
  tx.doneAt = db.clock++;
  if (tx.xid === null) return;
  db.status[tx.xid] = status;
  db.running.delete(tx.xid);
  db.lastCompleted = Math.max(db.lastCompleted, tx.xid);
}

function* statement(db, tx, op) {
  if (tx.snapAt === null) tx.snapAt = db.clock++;
  if (op.where) tx.reads.push(op.where);
  const print = (rows) => op.count ? [String(rows.length)] : rows.map((r) => op.cols.map((c) => r[c]).join('|'));
  switch (op.t) {
    case 'select': {
      if (op.lock) return print((yield* lockRows(db, tx, op.where, op.lock)).map((v) => v.row));
      const snap = snapshotFor(db, tx);
      return print(db.versions.filter((v) => visible(db, tx, snap, v) && matches(v.row, op.where)).map((v) => v.row));
    }
    case 'update':
      return yield* update(db, tx, op.where, op.set);
    case 'insert':
      assignXid(db, tx);
      db.versions.push({ row: op.row, xmin: tx.xid, xmax: null, xmaxMode: null, locks: [], next: null });
      tx.writes.push(op.row);
      return ['INSERT 0 1'];
    case 'delete': {
      const claimed = yield* claimRows(db, tx, op.where, 'update');
      assignXid(db, tx);
      for (const v of claimed) Object.assign(v, { xmax: tx.xid, xmaxMode: 'update' });
      tx.writes.push(...claimed.map((v) => v.row));
      return [\`DELETE \${claimed.length}\`];
    }
  }
}

// Один шаг сеанса. Вне BEGIN каждый оператор — отдельная транзакция Read Committed.
function* execute(db, session, op, level) {
  if (op.t === 'begin') {
    session.tx = newTx(db, session.name, level);
    return ['BEGIN'];
  }
  const tx = session.tx ?? newTx(db, session.name, 'read committed');
  const auto = session.tx === null;
  if (op.t === 'commit' || op.t === 'rollback') {
    session.tx = null;
    if (op.t === 'rollback' || tx.state === 'aborted') {
      if (tx.state === 'active') end(db, tx, 'aborted');
      return ['ROLLBACK'];
    }
    try {
      if (tx.level === 'serializable') checkCommit(db, tx);
    } catch (e) {
      end(db, tx, 'aborted');
      throw e;
    }
    end(db, tx, 'committed');
    return ['COMMIT'];
  }
  if (tx.state === 'aborted') {
    throw sqlError('25P02', 'current transaction is aborted, commands ignored until end of transaction block');
  }
  session.tx = tx;
  try {
    const lines = yield* statement(db, tx, op);
    if (auto) { session.tx = null; end(db, tx, 'committed'); }
    return lines;
  } catch (e) {
    end(db, tx, 'aborted');   // ошибка откатывает транзакцию сразу, блокировки отпускаются
    if (auto) session.tx = null;
    throw e;
  }
}

// Прогон расписания двух сеансов: шаг за шагом, с ожиданием блокировок.
function runSchedule(rows, steps, level, upTo = steps.length) {
  const db = createDb(rows);
  const sessions = { A: { name: 'A', tx: null }, B: { name: 'B', tx: null } };
  const parked = new Map();
  const out = [];
  const holderSession = (xid) => Object.values(sessions).find((s) => s.tx && s.tx.xid === xid);

  // Ждёт ли владелец xid — по цепочке — сеанс name? Тогда круг замкнулся: дедлок.
  function closesCycle(name, xid) {
    for (let s = holderSession(xid); s; s = holderSession(parked.get(s.name)?.wait)) {
      if (s.name === name) return true;
      if (!parked.has(s.name)) return false;
    }
    return false;
  }

  function drive(name, gen, rec, input) {
    try {
      const r = input ? gen.throw(input) : gen.next();
      if (r.done) { rec.lines = r.value; return; }
      rec.waited = true;
      if (closesCycle(name, r.value.wait)) return drive(name, gen, rec, sqlError('40P01', 'deadlock detected'));
      parked.set(name, { gen, rec, wait: r.value.wait });
    } catch (e) {
      if (!e.code) throw e;
      rec.lines = [];
      rec.error = { code: e.code, message: e.message };
    }
  }

  steps.slice(0, upTo).forEach((step, i) => {
    const rec = { s: step.s, sql: step.sql, lines: null, error: null, waited: false, until: null };
    out.push(rec);
    drive(step.s, execute(db, sessions[step.s], step.op, level), rec);
    if (rec.waited && !parked.has(step.s)) rec.until = i;
    for (let moved = true; moved; ) {
      moved = false;
      for (const [name, p] of parked) {
        if (db.running.has(p.wait)) continue;
        parked.delete(name);
        moved = true;
        drive(name, p.gen, p.rec);
        if (!parked.has(name)) p.rec.until = i;
      }
    }
  });
  return { out, db, sessions };
}`;

export const ENGINE_NOTE =
  'Шаг, который упёрся в чужую блокировку, «паркуется» вместе со своим генератором. После каждого шага движок будит тех, чья транзакция-держатель закончилась. Перед тем как запарковать шаг, он проверяет круг ожиданий: если держатель — по цепочке — ждёт нас самих, в генератор бросается `40P01`.';

// ─── Раздел 5. Конфликт записи ─────────────────────────────────────────────────────────────

export const PLAIN_CONFLICT =
  'Два редактора правят один абзац в общем документе. Второй открыл документ раньше, чем первый сохранил правку. Read Committed — редактор, который, дождавшись чужого сохранения, берёт свежий текст и вносит свою правку уже в него. Repeatable Read — редактор, который говорит: «Мой текст устарел, начну заново».';

export const WRITE_CODE = `// Какие блокировки строки не уживаются друг с другом.
const CONFLICTS = {
  'key share':     ['update'],
  'share':         ['no key update', 'update'],
  'no key update': ['share', 'no key update', 'update'],
  'update':        ['key share', 'share', 'no key update', 'update'],
};

// Незавершённая чужая транзакция, которая держит версию v так, что режим mode ей мешает.
function holder(db, tx, v, mode) {
  const holds = v.xmax === null ? v.locks : [...v.locks, { xid: v.xmax, mode: v.xmaxMode }];
  const h = holds.find((l) => l.xid !== tx.xid && db.running.has(l.xid) && CONFLICTS[l.mode].includes(mode));
  return h ? h.xid : null;
}

// Найти строки по снимку и захватить их. На чужой блокировке генератор
// отдаёт { wait: xid } и продолжает с того же места, когда та транзакция закончится.
function* claimRows(db, tx, where, mode) {
  const snap = snapshotFor(db, tx);
  const claimed = [];
  for (let v of db.versions.filter((x) => visible(db, tx, snap, x) && matches(x.row, where))) {
    for (;;) {
      const xid = holder(db, tx, v, mode);
      if (xid !== null) { yield { wait: xid }; continue; }
      const replaced = v.xmax !== null && v.xmax !== tx.xid && db.status[v.xmax] === 'committed';
      if (!replaced) break;
      // Строку заменили и закоммитили после нашего снимка.
      if (tx.level !== 'read committed') {
        throw sqlError('40001', 'could not serialize access due to concurrent update');
      }
      v = v.next;                              // Read Committed идёт к свежей версии
      if (!v || !matches(v.row, where)) break; // удалена или больше не подходит
    }
    if (v && matches(v.row, where)) claimed.push(v);
  }
  return claimed;
}

// UPDATE: старая версия получает xmax, новая — xmin, обе — номер нашей транзакции.
function* update(db, tx, where, set) {
  const claimed = yield* claimRows(db, tx, where, 'no key update');
  for (const v of claimed) {
    const row = { ...v.row };
    for (const [col, val] of Object.entries(set)) row[col] = typeof val === 'object' ? row[col] + val.add : val;
    assignXid(db, tx);
    const fresh = { row, xmin: tx.xid, xmax: null, xmaxMode: null, locks: [], next: null };
    Object.assign(v, { xmax: tx.xid, xmaxMode: 'no key update', next: fresh });
    db.versions.push(fresh);
    tx.writes.push(v.row, row);
  }
  return [\`UPDATE \${claimed.length}\`];
}

// SELECT … FOR UPDATE и родня: захватить строки, ничего не меняя.
function* lockRows(db, tx, where, mode) {
  const claimed = yield* claimRows(db, tx, where, mode);
  assignXid(db, tx);
  for (const v of claimed) v.locks.push({ xid: tx.xid, mode });
  return claimed;
}`;

export const CONFLICT_STEPS = [
  {
    k: '1. Найти строку по снимку',
    d: '`UPDATE … WHERE id = 1` ищет подходящие версии так же, как `SELECT`: по своему снимку. Нашлась версия, которую снимок считает живой.',
  },
  {
    k: '2. Чужая незаконченная запись — ждать',
    d: 'У версии уже есть `xmax` транзакции, которая ещё работает. Писать поверх нельзя: неизвестно, закоммитит она или откатится. Оператор встаёт и ждёт её конца.',
  },
  {
    k: '3а. Read Committed: взять свежую версию',
    d: 'Та закоммитила. Postgres идёт по `ctid` к новой версии, заново проверяет на ней `WHERE` и пишет уже поверх неё. Отсюда 130 в `balance + 10` и `UPDATE 0` у оптимистичной блокировки: `version = 1` на свежей версии не совпало.',
  },
  {
    k: '3б. Repeatable Read и Serializable: 40001',
    d: 'Снимок транзакции не видит новой версии, а писать поверх невидимого нельзя. Ошибка `could not serialize access due to concurrent update`. Если та транзакция откатилась, ошибки нет: старая версия снова живая, и оператор просто продолжает.',
  },
];

export const CONFLICT_NOTE =
  'Важная разница: на Read Committed **атомарный** `UPDATE x = x + 1` корректен, а «прочитать в приложение — посчитать — записать» теряет обновления. На Repeatable Read ни то, ни другое не теряет — но оба могут упасть с `40001` и требуют повтора.';

// ─── Раздел 6. Блокировки строк ────────────────────────────────────────────────────────────

export const LOCK_MODES: { mode: RowLockMode; sql: string; who: string }[] = [
  { mode: 'key share', sql: 'FOR KEY SHARE', who: 'Проверка внешнего ключа при вставке в дочернюю таблицу.' },
  { mode: 'share', sql: 'FOR SHARE', who: 'Явно: «прочитал, не меняйте, пока я не закончу».' },
  { mode: 'no key update', sql: 'FOR NO KEY UPDATE', who: 'Обычный `UPDATE` столбцов, не входящих в ключ.' },
  { mode: 'update', sql: 'FOR UPDATE', who: '`DELETE` и `UPDATE` ключевого столбца.' },
];

/**
 * Снято стендом: сеанс A берёт строку `SELECT … FOR <строка>`, сеанс B — `SELECT … FOR <столбец> NOWAIT`.
 * `true` — B получил `55P03 could not obtain lock on row in relation "accounts"`.
 */
export const LOCK_MATRIX: Record<RowLockMode, Record<RowLockMode, boolean>> = {
  'key share': { 'key share': false, share: false, 'no key update': false, update: true },
  share: { 'key share': false, share: false, 'no key update': true, update: true },
  'no key update': { 'key share': false, share: true, 'no key update': true, update: true },
  update: { 'key share': true, share: true, 'no key update': true, update: true },
};

export const FK_SQL = `CREATE TABLE orders (
  id         int PRIMARY KEY,
  account_id int NOT NULL REFERENCES accounts (id)
);
-- сеанс B, пока сеанс A держит строку accounts.id = 1:
INSERT INTO orders VALUES (1, 1);`;

/** Снято стендом: что держит сеанс A и ждёт ли вставка заказа в сеансе B. */
export const FK_ROWS: { a: string; mode: RowLockMode; waits: boolean }[] = [
  { a: 'SELECT … WHERE id = 1 FOR UPDATE', mode: 'update', waits: true },
  { a: 'SELECT … WHERE id = 1 FOR NO KEY UPDATE', mode: 'no key update', waits: false },
  { a: 'UPDATE accounts SET balance = 110 WHERE id = 1', mode: 'no key update', waits: false },
  { a: 'UPDATE accounts SET id = 10 WHERE id = 1', mode: 'update', waits: true },
];

export const FK_NOTE =
  'Вставка заказа берёт на родительскую строку `FOR KEY SHARE`: «не удаляйте этот счёт и не меняйте его `id`, пока я ссылаюсь». С `FOR NO KEY UPDATE` и обычным `UPDATE` баланса это уживается, с `FOR UPDATE` — нет. Поэтому `SELECT … FOR UPDATE` «на всякий случай» на горячей родительской строке останавливает вставку всех её дочерних записей. Если ключ менять не собираетесь — берите `FOR NO KEY UPDATE`.';

export const LOCK_XMAX_NOTE =
  'Блокировка строки — не запись в памяти сервера, а пометка в самой версии: номер держателя в `xmax` и бит «только блокировка». На стенде после `SELECT … FOR UPDATE` у живой версии `xmax` стал номером транзакции, а после её отката так и остался. Поэтому таблица на миллион строк, взятых `FOR UPDATE`, не съедает память под блокировки — но каждую такую строку приходится переписать на странице.';

export const SKIP_LOCKED_SQL = `-- сеанс A держит id = 1 FOR UPDATE
SELECT id FROM accounts ORDER BY id FOR UPDATE SKIP LOCKED;   -- сеанс B: 2`;

export const SKIP_LOCKED_NOTE =
  '`NOWAIT` вместо ожидания сразу даёт ошибку `55P03`, `SKIP LOCKED` — молча пропускает занятые строки. Второе — основа очереди задач в таблице: каждый обработчик берёт первые свободные строки и не ждёт соседа.';

export const OPTIMISTIC_SQL = `-- прочитать вместе с версией
SELECT balance, version FROM accounts WHERE id = 1;         -- 100 | 1

-- записать, только если версия не изменилась
UPDATE accounts SET balance = 110, version = version + 1
WHERE id = 1 AND version = 1;                               -- UPDATE 1 или UPDATE 0`;

export const OPTIMISTIC_NOTE =
  'Оптимистичная блокировка ничего не держит между чтением и записью — поэтому годится, когда между ними человек: форма редактирования открыта десять минут. Цена — проверка числа строк: `UPDATE 0` значит «кто-то успел раньше», и приложение должно сказать об этом пользователю, а не считать запись успешной. Тот же приём в HTTP — заголовок `If-Match`, разобран в теме [«Сеть»](/platform/network/#s2).';

// ─── Раздел 7. Serializable ────────────────────────────────────────────────────────────────

export const PLAIN_SSI =
  'Как диспетчер, который не запрещает поездам ехать одновременно, а рисует на доске стрелки «этот проехал там, где тот потом изменил стрелку». Пока стрелки не складываются в опасную фигуру, все едут. Сложились — один поезд останавливают и отправляют на повтор.';

export const SSI_TEXT =
  'Serializable в Postgres ничего не блокирует сверх Repeatable Read. Он записывает, кто что прочитал (это называют предикатными блокировками, хотя никто на них не ждёт), и на каждой записи и коммите ищет стрелки «r прочла то, что w потом переписала, и не увидела этого». Одна такая стрелка безвредна: её объясняет порядок «сначала r, потом w». Опасна транзакция, в которую стрелка входит и из которой выходит в уже закоммиченную, — по одной так не выстроить.';

export const SSI_CODE = `// r прочла то, что w переписала, и не увидела этой записи: стрелка r → w.
function rwConflict(db, r, w) {
  if (r === w || r.level !== 'serializable' || w.level !== 'serializable') return false;
  if (r.state === 'aborted' || w.state === 'aborted') return false;
  if (r.doneAt !== null && r.doneAt < w.snapAt) return false;     // r закончилась до начала w
  if (w.xid === null || committedFor(db, r.snap, w.xid)) return false;
  return w.writes.some((row) => r.reads.some((where) => matches(row, where)));
}

// Перед COMMIT: есть стрелка в t и стрелка из t в уже закоммиченную — опасная структура.
function checkCommit(db, t) {
  const into = db.txs.some((r) => rwConflict(db, r, t));
  const outOfCommitted = db.txs.some((w) => w.state === 'committed' && rwConflict(db, t, w));
  if (into && outOfCommitted) {
    throw sqlError('40001', 'could not serialize access due to read/write dependencies among transactions');
  }
}`;

export const SKEW_STEPS = [
  { k: 'A считает дежурных', d: 'Читает обе строки: `on_call = true` у Алисы и у Боба. Записано: A читала по условию `on_call`.' },
  { k: 'B считает дежурных', d: 'То же самое: B читала по условию `on_call`.' },
  { k: 'A снимает Алису, B — Боба', d: 'Строки разные, ждать некого. Но старая версия Боба подходит под условие, которое читала A: стрелка A → B. И наоборот: B → A.' },
  { k: 'COMMIT у A', d: 'Стрелка в A есть (от B), стрелка из A — в B, но B ещё не закоммичена. Опасной фигуры пока нет — A проходит.' },
  { k: 'COMMIT у B', d: 'Стрелка в B (от A) и стрелка из B в A, которая **уже закоммичена**. Порядка «по одной» нет: `40001` у B.' },
];

export const SSI_FACTS: { t: string; d: string; tone?: 'warn' }[] = [
  {
    t: 'Ошибка может прийти не на COMMIT',
    d: 'На стенде B упала на `COMMIT`. Документация предупреждает: проверка идёт и на чтениях, и на записях, поэтому `40001` на Serializable возможна на любом операторе. Код должен быть готов к ней везде.',
    tone: 'warn',
  },
  {
    t: 'Ложные срабатывания',
    d: 'Модель помнит прочитанное по условию `WHERE`. Postgres — по строкам, страницам индекса, а при чтении без индекса — по всей таблице. Чем грубее запись, тем чаще `40001` без настоящей аномалии. Индекс под условием чтения снижает их число.',
    tone: 'warn',
  },
  {
    t: 'Защищены только Serializable',
    d: 'Стрелки рисуются только между транзакциями уровня Serializable. Одна транзакция Read Committed, которая пишет в те же строки, проходит мимо проверки. Уровень поднимают для всех, кто трогает эти данные, — обычно `default_transaction_isolation` на базу или роль.',
    tone: 'warn',
  },
  {
    t: 'Чтение без ошибок: READ ONLY DEFERRABLE',
    d: 'Долгий отчёт можно открыть как `BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY DEFERRABLE`. Такая транзакция при старте подождёт безопасного снимка и потом уже не упадёт с `40001` и не уронит других.',
  },
];

// ─── Раздел 8. Повтор и дедлоки ────────────────────────────────────────────────────────────

/** Обёртка для пула в стиле node-postgres. Тест гоняет её на PGlite с настоящей ошибкой 40001. */
export const RETRY_CODE = `// 40001 — сериализация, 40P01 — дедлок: в обоих случаях транзакция уже откачена,
// и тот же код, запущенный заново, может пройти.
const RETRYABLE = new Set(['40001', '40P01']);

async function inTransaction(pool, level, work, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query(\`BEGIN ISOLATION LEVEL \${level}\`);
      const result = await work(client);       // ВСЯ работа, включая чтения
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (!RETRYABLE.has(e.code) || attempt === attempts) throw e;
      // случайная пауза растёт с номером попытки: две транзакции не столкнутся снова тем же шагом
      await new Promise((r) => setTimeout(r, Math.random() * 2 ** attempt * 10));
    } finally {
      client.release();
    }
  }
}`;

export const RETRY_RULES: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Повторять всю транзакцию',
    d: 'Не упавший оператор, а всё с `BEGIN`: чтения тоже. Значение, прочитанное в первой попытке, устарело — из-за него попытка и упала.',
    tone: 'err',
  },
  {
    t: 'Побочные эффекты — после COMMIT',
    d: 'Письмо, запрос в платёжный шлюз, сообщение в очередь внутри `work` уйдут столько раз, сколько было попыток. Их выполняют после успешного `COMMIT` или делают идемпотентными.',
    tone: 'warn',
  },
  {
    t: 'Только 40001 и 40P01',
    d: 'Нарушение уникальности (`23505`) или `CHECK` при повторе упадёт снова. Ошибку сети после отправленного `COMMIT` повторять тоже нельзя вслепую: транзакция могла и пройти.',
  },
];

export const DEADLOCK_TEXT =
  'Дедлок не связан с уровнем изоляции: это круг ожиданий блокировок строк. Postgres не ищет круг сразу. Транзакция, простоявшая в ожидании `deadlock_timeout` (по умолчанию 1 секунда), проверяет граф ожиданий, и если круг есть — обрывает одну из транзакций с `40P01`. На стенде, при ручном темпе, ошибку получил сеанс, замкнувший круг. Документация предупреждает, что жертву предсказать трудно, — полагаться на это нельзя.';

export const ORDERED_SQL = `-- оба перевода сначала берут обе строки в одном порядке
BEGIN;
SELECT id FROM accounts WHERE id IN (1, 2) ORDER BY id FOR NO KEY UPDATE;
UPDATE accounts SET balance = balance - 10 WHERE id = 1;
UPDATE accounts SET balance = balance + 10 WHERE id = 2;
COMMIT;`;

export const ORDERED_NOTE =
  'Лечится дедлок порядком: если все транзакции захватывают строки по возрастанию `id`, круг не замкнётся — вторая просто подождёт первую. На стенде те же два встречных перевода с таким `SELECT` в начале прошли оба, без `40P01`: второй ждал на `SELECT`, а не посреди перевода.';

/** Снято стендом: значения по умолчанию. */
export const SHOW_DEFAULTS = { default_transaction_isolation: 'read committed', deadlock_timeout: '1s' };

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'По умолчанию — Read Committed, и он теряет обновления',
    d: '«Прочитать в приложение — посчитать — записать» на уровне по умолчанию теряет одно из двух одновременных изменений без единой ошибки. Лечится атомарным `UPDATE … SET x = x + …`, `SELECT … FOR UPDATE`, проверкой версии или уровнем Repeatable Read с повтором.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Repeatable Read бросает 40001 даже на атомарном UPDATE',
    d: '`SET balance = balance + 10` на Repeatable Read падает, если строку успели изменить после снимка. Подняли уровень без цикла повтора — получили ошибки там, где раньше всё работало.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Снимок берётся первым запросом, а не BEGIN',
    d: 'Между `BEGIN ISOLATION LEVEL REPEATABLE READ` и первым `SELECT` чужие коммиты ещё попадают в снимок. Если важно «состояние на момент начала», первый запрос надо сделать сразу.',
  },
  {
    n: '04',
    t: 'Повтор — всей транзакции, а эффекты — после COMMIT',
    d: 'Повторить один упавший оператор бессмысленно: прочитанное раньше устарело. А письмо, отправленное изнутри транзакции, при трёх попытках уйдёт три раза.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`xmax` не ноль — не значит «удалена»',
    d: 'В `xmax` живой версии лежит номер того, кто её заблокировал, — даже если он давно откатился. На стенде после `FOR UPDATE` и `ROLLBACK` у живой строки `xmax` = 755. Видна ли версия, решает статус транзакции, а не то, пусто ли поле.',
  },
  {
    n: '06',
    t: 'FOR UPDATE на родителе останавливает вставку детей',
    d: 'Проверка внешнего ключа берёт `FOR KEY SHARE`, и `FOR UPDATE` с ней не уживается. Если ключ не меняется, нужен `FOR NO KEY UPDATE` — с ним вставка заказов не ждёт.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`UPDATE 0` — тоже ответ',
    d: 'Оптимистичная блокировка на Read Committed сообщает о конфликте не ошибкой, а числом строк. Код, который не смотрит на `rowCount`, молча теряет запись.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Serializable защищает только Serializable',
    d: 'Транзакция Read Committed, пишущая в те же таблицы, проходит мимо проверки и может создать ту самую аномалию. Уровень задают всем участникам, а не одному «важному» месту.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Долгая транзакция держит старые версии',
    d: 'Пока открыт снимок, `VACUUM` не может убрать версии, которые этот снимок теоретически видит. Отчёт на Repeatable Read на два часа раздувает горячие таблицы на два часа правок.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Дедлок — не баг Postgres, а порядок захвата',
    d: 'Две транзакции, берущие одни и те же строки в разном порядке, рано или поздно замкнут круг. Сортируйте `id` перед захватом и держите транзакции короткими; `40P01` ловите и повторяйте как `40001`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'PostgreSQL — Transaction Isolation',
    href: 'https://www.postgresql.org/docs/current/transaction-iso.html',
    what: 'уровни, таблица аномалий стандарта, поведение `UPDATE` на Read Committed, ошибки сериализации, Serializable и его ложные срабатывания',
  },
  {
    title: 'PostgreSQL — Explicit Locking',
    href: 'https://www.postgresql.org/docs/current/explicit-locking.html',
    what: 'режимы блокировок строк и таблица их конфликтов, дедлоки, `deadlock_timeout`',
  },
  {
    title: 'PostgreSQL — Serialization Failure Handling',
    href: 'https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html',
    what: 'какие коды повторять (`40001`, `40P01`) и почему повторять всю транзакцию',
  },
  {
    title: 'PostgreSQL — The Locking Clause (SELECT)',
    href: 'https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE',
    what: '`FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`, `NOWAIT`, `SKIP LOCKED`',
  },
  {
    title: 'PostgreSQL — System Columns',
    href: 'https://www.postgresql.org/docs/current/ddl-system-columns.html',
    what: '`xmin`, `xmax`, `ctid`',
  },
  {
    title: 'PostgreSQL — Transaction ID and Snapshot Information Functions',
    href: 'https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT',
    what: '`pg_current_snapshot`, `pg_current_xact_id_if_assigned`, поля снимка',
  },
  {
    title: 'PostgreSQL — pageinspect',
    href: 'https://www.postgresql.org/docs/current/pageinspect.html',
    what: '`heap_page_items` — все версии на странице, включая невидимые',
  },
  {
    title: 'Ports, Grittner — Serializable Snapshot Isolation in PostgreSQL (VLDB 2012)',
    href: 'https://arxiv.org/abs/1208.4179',
    what: 'стрелки чтения-записи, опасная структура, `READ ONLY DEFERRABLE`',
  },
  {
    title: 'PostgreSQL Wiki — SSI',
    href: 'https://wiki.postgresql.org/wiki/SSI',
    what: 'примеры аномалий, в том числе дежурные врачи',
  },
  {
    title: 'Indexed Database API 3.0',
    href: 'https://w3c.github.io/IndexedDB/',
    what: 'раздел Transaction scheduling: пересекающиеся `readwrite`-транзакции идут по очереди',
  },
];

export const RELATED =
  'Смежное на сайте: [Индексы Postgres и EXPLAIN](/data/indexes/) — страницы таблицы и тот же стенд на PGlite. [Миграции базы без простоя, раздел «Блокировки»](/delivery/db-migrations/#s3) — блокировки таблиц и очередь за `ALTER TABLE`. [Там же, раздел «Перенос пачками»](/delivery/db-migrations/#s5) — версии строк, `VACUUM` и короткие транзакции. [Хранилища браузера, раздел «Жизнь транзакции»](/platform/browser-storage/#s4) — транзакции IndexedDB. [Сеть, раздел «Кеш и валидация»](/platform/network/#s2) — `If-Match` как оптимистичная блокировка в HTTP. [Генераторы, раздел «Пауза генератора»](/js/generators/#s1) — `yield`, на котором ждёт модель. [Кеш перед базой](/data/redis-cache/) — cache-aside, гонки инвалидации, толпа при истечении и вытеснение в Redis.';

// ─── Снято стендом: два сеанса Postgres 16.15 ──────────────────────────────────────────────

/**
 * Вывод каждого шага `SCENARIOS` × `LEVELS` в двух настоящих сеансах, формат `formatStep`
 * из `widgets/mvcc-lab/model/run.ts`; `final` — запрос `check` после сценария.
 * Пересобирается тестом при `TX_PG_CONTAINER`, всегда — сверяется с моделью.
 */
export const STAND_RUNS: Record<string, { steps: string[]; final: string }> = {
  'dirty-read/read committed': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      'BEGIN',
      '100',
      'ROLLBACK',
      '100',
      'COMMIT',
    ],
    final: '100',
  },
  'dirty-read/repeatable read': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      'BEGIN',
      '100',
      'ROLLBACK',
      '100',
      'COMMIT',
    ],
    final: '100',
  },
  'dirty-read/serializable': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      'BEGIN',
      '100',
      'ROLLBACK',
      '100',
      'COMMIT',
    ],
    final: '100',
  },
  'non-repeatable/read committed': {
    steps: [
      'BEGIN',
      '100',
      'BEGIN',
      'UPDATE 1',
      'COMMIT',
      '150',
      'COMMIT',
    ],
    final: '150',
  },
  'non-repeatable/repeatable read': {
    steps: [
      'BEGIN',
      '100',
      'BEGIN',
      'UPDATE 1',
      'COMMIT',
      '100',
      'COMMIT',
    ],
    final: '150',
  },
  'non-repeatable/serializable': {
    steps: [
      'BEGIN',
      '100',
      'BEGIN',
      'UPDATE 1',
      'COMMIT',
      '100',
      'COMMIT',
    ],
    final: '150',
  },
  'phantom/read committed': {
    steps: [
      'BEGIN',
      '2',
      'BEGIN',
      'INSERT 0 1',
      'COMMIT',
      '3',
      'COMMIT',
    ],
    final: '3',
  },
  'phantom/repeatable read': {
    steps: [
      'BEGIN',
      '2',
      'BEGIN',
      'INSERT 0 1',
      'COMMIT',
      '2',
      'COMMIT',
    ],
    final: '3',
  },
  'phantom/serializable': {
    steps: [
      'BEGIN',
      '2',
      'BEGIN',
      'INSERT 0 1',
      'COMMIT',
      '2',
      'COMMIT',
    ],
    final: '3',
  },
  'snapshot-start/read committed': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      '150',
      'UPDATE 1',
      '200',
      'COMMIT',
    ],
    final: '200',
  },
  'snapshot-start/repeatable read': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      '150',
      'UPDATE 1',
      '150',
      'COMMIT',
    ],
    final: '200',
  },
  'snapshot-start/serializable': {
    steps: [
      'BEGIN',
      'UPDATE 1',
      '150',
      'UPDATE 1',
      '150',
      'COMMIT',
    ],
    final: '200',
  },
  'lost-update/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → UPDATE 1',
      'COMMIT',
      'COMMIT',
    ],
    final: '120',
  },
  'lost-update/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → ERROR 40001: could not serialize access due to concurrent update',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '110',
  },
  'lost-update/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → ERROR 40001: could not serialize access due to concurrent update',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '110',
  },
  'increment/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → UPDATE 1',
      'COMMIT',
      'COMMIT',
    ],
    final: '130',
  },
  'increment/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → ERROR 40001: could not serialize access due to concurrent update',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '110',
  },
  'increment/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      '100',
      'UPDATE 1',
      'ждал до шага 7 → ERROR 40001: could not serialize access due to concurrent update',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '110',
  },
  'for-update/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      'ждал до шага 6 → 110',
      'UPDATE 1',
      'COMMIT',
      'UPDATE 1',
      'COMMIT',
    ],
    final: '130',
  },
  'for-update/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      'ждал до шага 6 → ERROR 40001: could not serialize access due to concurrent update',
      'UPDATE 1',
      'COMMIT',
      'ERROR 25P02: current transaction is aborted, commands ignored until end of transaction block',
      'ROLLBACK',
    ],
    final: '110',
  },
  'for-update/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100',
      'ждал до шага 6 → ERROR 40001: could not serialize access due to concurrent update',
      'UPDATE 1',
      'COMMIT',
      'ERROR 25P02: current transaction is aborted, commands ignored until end of transaction block',
      'ROLLBACK',
    ],
    final: '110',
  },
  'optimistic/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100|1',
      '100|1',
      'UPDATE 1',
      'COMMIT',
      'UPDATE 0',
      'COMMIT',
    ],
    final: '110',
  },
  'optimistic/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100|1',
      '100|1',
      'UPDATE 1',
      'COMMIT',
      'ERROR 40001: could not serialize access due to concurrent update',
      'ROLLBACK',
    ],
    final: '110',
  },
  'optimistic/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      '100|1',
      '100|1',
      'UPDATE 1',
      'COMMIT',
      'ERROR 40001: could not serialize access due to concurrent update',
      'ROLLBACK',
    ],
    final: '110',
  },
  'write-skew/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      '2',
      '2',
      'UPDATE 1',
      'UPDATE 1',
      'COMMIT',
      'COMMIT',
    ],
    final: '0',
  },
  'write-skew/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      '2',
      '2',
      'UPDATE 1',
      'UPDATE 1',
      'COMMIT',
      'COMMIT',
    ],
    final: '0',
  },
  'write-skew/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      '2',
      '2',
      'UPDATE 1',
      'UPDATE 1',
      'COMMIT',
      'ERROR 40001: could not serialize access due to read/write dependencies among transactions',
    ],
    final: '1',
  },
  'deadlock/read committed': {
    steps: [
      'BEGIN',
      'BEGIN',
      'UPDATE 1',
      'UPDATE 1',
      'ждал до шага 6 → UPDATE 1',
      'ждал до шага 6 → ERROR 40P01: deadlock detected',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '1|90 / 2|110',
  },
  'deadlock/repeatable read': {
    steps: [
      'BEGIN',
      'BEGIN',
      'UPDATE 1',
      'UPDATE 1',
      'ждал до шага 6 → UPDATE 1',
      'ждал до шага 6 → ERROR 40P01: deadlock detected',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '1|90 / 2|110',
  },
  'deadlock/serializable': {
    steps: [
      'BEGIN',
      'BEGIN',
      'UPDATE 1',
      'UPDATE 1',
      'ждал до шага 6 → UPDATE 1',
      'ждал до шага 6 → ERROR 40P01: deadlock detected',
      'COMMIT',
      'ROLLBACK',
    ],
    final: '1|90 / 2|110',
  },
};

/** `READ UNCOMMITTED` в сценарии `dirty-read`: оба чтения B. */
export const DIRTY_RU: string[] = ['100', '100'];

/** `SKIP_LOCKED_SQL`: что вернул сеанс B. */
export const SKIP_LOCKED_RUN = '2';

/** Встречные переводы с `ORDERED_SQL`: вывод шагов и итог. */
export const ORDERED_RUN: { steps: string[]; final: string } = {
  steps: ['BEGIN', 'BEGIN', '1 / 2', 'ждал до шага 7 → 1 / 2', 'UPDATE 1', 'UPDATE 1', 'COMMIT', 'UPDATE 1', 'UPDATE 1', 'COMMIT'],
  final: '1|100 / 2|100',
};
