import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { BtreeScenario, PlanColumn } from '@/widgets/index-lab/model/types';

/**
 * Данные темы «Индексы Postgres и EXPLAIN: почему запрос не берёт индекс».
 *
 * Тема написана здесь, 2026-10-01, первой в направлении «Данные и бэкенд».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Настоящий Postgres внутри Node: `@electric-sql/pglite` **0.5.8** из `node_modules` проекта,
 * `select version()` → `PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten`, Node 24.11.0,
 * октябрь 2026. Расширения `pageinspect` и `pg_visibility` из `@electric-sql/pglite/contrib/*`
 * работают — уровни и листья B-дерева сняты ими, а не посчитаны. Сортировка базы — `C`
 * (`pg_database.datcollate`), размер страницы — 8192.
 *
 * Данные — `SETUP_SQL`: 30 000 строк, все значения выведены из номера строки, случайности нет.
 * Строк ровно столько, чтобы `ANALYZE` (выборка 300 × `default_statistics_target` = 30 000 строк)
 * прочитал таблицу целиком: тогда статистика, а с ней и оценки `rows=` в планах, одинаковы
 * от запуска к запуску. На 50 000 строках оценки гуляли (482, 487, 520 для одного запроса).
 *
 * Как сняты планы: `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY OFF)` — без времени вовсе.
 * Каждый запрос выполняется **дважды**, печатается второй план: первый вызов в сессии читает
 * лишние страницы (метастраницу индекса, каталог) — `FIRST_RUN`. Из текста плана убран хвост
 * `Planning: Buffers …` — это страницы каталога, прочитанные планировщиком, а не запросом.
 * Цены вариантов плана — тот же запрос с `enable_seqscan`/`enable_indexscan`/`enable_bitmapscan`
 * = off, `EXPLAIN (FORMAT JSON)`, поле `Total Cost`. Цена записи — `EXPLAIN (ANALYZE, BUFFERS, WAL)`
 * на `INSERT`: страницы (`hit + read`), записи и байты WAL. Таймеров нет нигде.
 *
 * Всё перечисленное пересобирает `tests/unit/indexes.test.ts`. Учебные функции — строки
 * `BTREE_CODE` и `PLANNER_CODE`, их же исполняет демо:
 *   — мини-B-дерево с ёмкостью страницы Postgres (406 ключей, 366 при расщеплении правой
 *     страницы — оба числа из `bt_page_stats`) строит для 30 000 id те же 82 листа и те же
 *     разделители в корне, что `bt_page_items`; число уровней совпадает с `bt_metap` и для
 *     миллиона ключей; поиск и диапазон дают те же строки, что SQL, а число прочитанных страниц
 *     сходится с `Buffers` у Index Only Scan (плюс страница карты видимости);
 *   — модель стоимости `planCosts` на 17 запросах выбирает тот же узел, что Postgres, а цены
 *     всех трёх вариантов совпадают с `EXPLAIN` с точностью до 1 (округление числа страниц).
 *
 * ── Что взято из документации, а не со стенда ────────────────────────────────────────────
 *   — что сортировка, отличная от `C`, лишает `LIKE 'abc%'` обычного индекса и требует
 *     `text_pattern_ops` (Operator Classes): на стенде сортировка `C`, сравнить не с чем;
 *   — что `INCLUDE`-индекс не умеет дедупликацию (B-Tree, Deduplication) — на стенде видно
 *     только следствие: 30 страниц против 131;
 *   — что пропуск ведущего столбца (skip scan) появился в Postgres 18 (release notes 18);
 *     стенд — 18.3, старой версии под рукой нет;
 *   — пороги автоматического `ANALYZE` (`autovacuum_analyze_threshold` 50 и
 *     `autovacuum_analyze_scale_factor` 0.1): в PGlite фоновых процессов нет;
 *   — fillfactor 90 у листьев B-дерева — документация `CREATE INDEX`; на стенде видно, что
 *     366 из 406 — это 90 %;
 *   — формулы стоимости — исходники `costsize.c` и `btcostestimate`; модель проверена ценами
 *     `EXPLAIN`, а не чтением кода.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'страница',
    d: 'Кусок файла в 8 КБ. Postgres читает и пишет таблицы и индексы только целыми страницами. Строки таблицы лежат на страницах по сотне, в порядке вставки.',
  },
  {
    k: 'индекс B-дерево',
    d: 'Отдельная структура рядом с таблицей: значения столбца в отсортированном порядке и для каждого — адрес строки в таблице. По умолчанию `CREATE INDEX` строит именно его.',
  },
  {
    k: 'план запроса',
    d: 'Дерево шагов, которыми Postgres выполнит запрос: какую таблицу как читать, в каком порядке соединять. Его выбирает планировщик, а показывает `EXPLAIN`.',
  },
  {
    k: 'селективность',
    d: 'Какую долю строк отбирает условие. `id = 42` — одна строка из 30 000, высокая селективность; `status = \'active\'` — 99 % строк, низкая.',
  },
  {
    k: 'буфер',
    d: 'Страница в памяти Postgres. `Buffers: shared hit=3` в плане — запрос обратился к трём страницам, и все уже были в памяти; `read` — пришлось читать с диска.',
  },
  {
    k: 'статистика',
    d: 'Сводка о данных: сколько разных значений, какие самые частые, лежат ли строки по порядку. Её собирает `ANALYZE`, и по ней планировщик угадывает, сколько строк вернёт условие.',
  },
];

export const PLAIN_HEAP =
  'Таблица — как папка с сотнями листов, на каждом по сто анкет, подшитых в порядке поступления. Найти анкету по фамилии можно только перелистав всю папку. Индекс — алфавитный указатель в начале папки: «Иванов — лист 42». Указатель приходится вести отдельно и обновлять при каждой новой анкете.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи. Две разобраны на сайте, третья объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'SQL: SELECT, WHERE, JOIN',
    d: 'Достаточно читать простые запросы. `JOIN … ON o.user_id = u.id` соединяет строки двух таблиц, у которых совпали значения; `CREATE INDEX имя ON таблица (столбец)` строит индекс.',
    tone: 'info',
  },
  {
    t: 'UPDATE пишет новую версию строки',
    d: 'Postgres не меняет строку на месте: старая версия остаётся, пока её может видеть чья-то транзакция, а убирает её `VACUUM`. Здесь это понадобится для Index Only Scan.',
    href: '/delivery/db-migrations/#s5',
    hrefLabel: '«Миграции базы без простоя», раздел «Перенос пачками»',
    tone: 'info',
  },
  {
    t: 'Двоичный поиск',
    d: 'Поиск в отсортированном массиве делением пополам: каждое сравнение отбрасывает половину. Внутри страницы B-дерева ключ ищется именно так.',
    href: '/tooling/source-maps/#s3',
    hrefLabel: '«Source maps изнутри», раздел «От стека к исходнику»',
    tone: 'info',
  },
];

// ─── Раздел 1. Таблица — это страницы ──────────────────────────────────────────────────────

/** Сквозной пример. Тест создаёт ровно эту таблицу. */
export const SETUP_SQL = `CREATE TABLE users (
  id         bigint PRIMARY KEY,
  email      text   NOT NULL,
  city       text   NOT NULL,
  status     text   NOT NULL,
  created_at date   NOT NULL
);

INSERT INTO users
SELECT i,
       'user' || i || '@mail.test',
       (ARRAY['Москва', 'Казань', 'Пермь', 'Омск',
              'Тверь', 'Самара', 'Томск'])[1 + i % 7],
       CASE WHEN i % 100 = 0 THEN 'blocked' ELSE 'active' END,
       date '2024-01-01' + (i * 7919 % 1000)
FROM generate_series(1, 30000) AS i;

ANALYZE users;`;

export const SETUP_NOTE =
  'Тридцать тысяч пользователей. Город — один из семи по кругу, каждый седьмой. Заблокирован каждый сотый. Дата регистрации — одна из тысячи дней, и соседние `id` получают далёкие друг от друга даты: строки одного дня рассыпаны по всей таблице. `ANALYZE` собирает статистику — без неё планировщик гадает вслепую.';

export const HEAP_FACTS = {
  pages: 306,
  bytes: 2506752,
  blockSize: 8192,
};

export const CTID_SQL = `SELECT ctid, id FROM users WHERE id IN (1, 103, 104, 30000);`;

/** Ответ `CTID_SQL` на стенде: (страница, номер строки на странице). */
export const CTID_ROWS: { ctid: string; id: number }[] = [
  { ctid: '(0,1)', id: 1 },
  { ctid: '(0,103)', id: 103 },
  { ctid: '(1,1)', id: 104 },
  { ctid: '(305,70)', id: 30000 },
];

export const CTID_NOTE =
  '`ctid` — адрес строки: номер страницы и номер строки на ней. Пользователи с 1-го по 103-й лежат на странице 0, 104-й открывает страницу 1, последний — на странице 305. Всего страниц 306, это 2 506 752 байта — ровно 306 × 8192. Индекс хранит именно такие адреса.';

export const EMAIL_QUERY = "SELECT * FROM users WHERE email = 'user42@mail.test'";

export const PLAN_SEQ = `Seq Scan on users  (cost=0.00..681.00 rows=1 width=49) (actual rows=1.00 loops=1)
  Filter: (email = 'user42@mail.test'::text)
  Rows Removed by Filter: 29999
  Buffers: shared hit=306`;

export const SEQ_NOTE =
  'Индекса по `email` нет, и Postgres сделал единственное, что мог: прочитал все 306 страниц и проверил условие у каждой из 30 000 строк. `Rows Removed by Filter: 29999` — столько строк проверено зря. `Buffers: shared hit=306` — прочитано 306 страниц. Это число — главная мера работы запроса: время зависит от нагрузки на машину, а число страниц у одного и того же плана на тех же данных не меняется.';

// ─── Раздел 2. B-дерево ─────────────────────────────────────────────────────────────────────

export const PLAIN_BTREE =
  'Как картотека в библиотеке. На ящиках написано «А–Г», «Д–К»: по надписи выбираете ящик, не открывая остальных. В ящике разделители по буквам, за разделителем — карточки по алфавиту, и на каждой номер полки. Три взгляда — ящик, разделитель, карточка — и вы у полки, сколько бы книг ни было в библиотеке.';

export const INDEX_SQL = 'CREATE INDEX users_email_idx ON users (email);';

export const PLAN_INDEX = `Index Scan using users_email_idx on users  (cost=0.29..8.30 rows=1 width=49) (actual rows=1.00 loops=1)
  Index Cond: (email = 'user42@mail.test'::text)
  Index Searches: 1
  Buffers: shared hit=3`;

export const INDEX_NOTE =
  'Три страницы вместо 306: корень индекса, лист с нужным ключом и страница таблицы, где лежит строка. `Index Cond` — условие, которое проверяет сам индекс: строки, не прошедшие его, не читаются вовсе.';

export const BTREE_TEXT =
  'B-дерево — несколько уровней страниц. В **листьях** лежат все значения столбца по порядку, и у каждого — `ctid` строки. Листья связаны ссылкой на соседа справа. Над листьями — **внутренние страницы**: в них только разделители, «ключи меньше 367 — в первом листе, от 367 до 733 — во втором». Сверху одна страница — **корень**. Поиск — это спуск от корня к листу, по одной странице на уровень; внутри страницы ключ находится двоичным поиском.';

/** Дерево первичного ключа `users_pkey` по `bt_metap` и `bt_multi_page_stats`. */
export const PK_TREE = {
  levels: 2,
  leaves: 82,
  keysPerLeaf: 366,
  lastLeaf: 354,
  capacity: 406,
  rootSeparators: [367, 733, 1099, 1465],
};

export const EMAIL_TREE = { levels: 2, leaves: 148, pages: 150 };

/** Отдельная таблица `big (id bigint PRIMARY KEY)` с миллионом строк. */
export const BIG_TREE = { rows: 1000000, levels: 3, leaves: 2733 };

export const TREE_ROWS = [
  { k: '`users_pkey`, 30 000 `id`', levels: PK_TREE.levels, leaves: PK_TREE.leaves, note: `по ${PK_TREE.keysPerLeaf} ключей в листе, разделители в корне: ${PK_TREE.rootSeparators.join(', ')}…` },
  { k: '`users_email_idx`, 30 000 адресов', levels: EMAIL_TREE.levels, leaves: EMAIL_TREE.leaves, note: 'строки длиннее чисел — в лист помещается меньше' },
  { k: 'первичный ключ, 1 000 000 `id`', levels: BIG_TREE.levels, leaves: BIG_TREE.leaves, note: 'в тридцать три раза больше строк — на один уровень больше' },
];

export const TREE_NOTE =
  'Каждый уровень умножает ёмкость примерно на число ключей в странице — здесь на сотни. Поэтому уровней мало и растут они медленно: 30 000 строк — два уровня, миллион — три. Поиск по ключу стоит «уровни + одна страница таблицы» и почти не зависит от размера таблицы. Это и есть «поиск за логарифм».';

/** Учебное B-дерево. Его исполняют демо и тест; тест сверяет его с `pageinspect`. */
export const BTREE_CODE = `// Страница — отсортированный массив ключей и ссылка на соседа справа.
// У внутренней страницы ещё дети: children[i] хранит ключи меньше keys[i],
// последний ребёнок — всё остальное. В листьях лежат сами ключи.
function createTree(capacity, rightFill = Math.ceil(capacity / 2)) {
  const root = { leaf: true, keys: [], next: null };
  return { root, capacity, rightFill, levels: 1, pages: 1 };
}

// Двоичный поиск: первая позиция, где ключ не меньше key,
// а при strict — первая, где ключ больше key.
function lowerBound(keys, key, strict) {
  let lo = 0, hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < key || (strict && keys[mid] === key)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Спуск от корня к листу. pages — прочитанные страницы, по одной на уровень.
function descend(tree, key) {
  let page = tree.root;
  const pages = [page], path = [];
  while (!page.leaf) {
    const i = lowerBound(page.keys, key, true);
    path.push({ page, i });
    page = page.children[i];
    pages.push(page);
  }
  return { leaf: page, pages, path };
}

function search(tree, key) {
  const { leaf, pages } = descend(tree, key);
  const i = lowerBound(leaf.keys, key, false);
  return { found: leaf.keys[i] === key, pages };
}

// Диапазон: один спуск к from, дальше — по листьям вправо до to.
function range(tree, from, to) {
  const { leaf, pages } = descend(tree, from);
  const keys = [];
  let page = leaf, i = lowerBound(leaf.keys, from, false);
  while (page) {
    for (; i < page.keys.length; i++) {
      if (page.keys[i] > to) return { keys, pages };
      keys.push(page.keys[i]);
    }
    page = page.next;
    i = 0;
    if (page) pages.push(page);
  }
  return { keys, pages };
}

function insert(tree, key) {
  const { leaf, path } = descend(tree, key);
  const at = lowerBound(leaf.keys, key, false);
  leaf.keys.splice(at, 0, key);
  let page = leaf, appended = at === leaf.keys.length - 1;

  // Переполненную страницу делим пополам. Самую правую страницу, если ключ
  // дописан в конец, делим иначе: слева остаётся rightFill ключей, и
  // растущий id не оставляет за собой полупустых страниц.
  while (page.keys.length > tree.capacity) {
    const cut = page.next === null && appended
      ? tree.rightFill
      : Math.ceil(page.keys.length / 2);
    const right = { leaf: page.leaf, keys: [], next: page.next };
    let separator;
    if (page.leaf) {
      right.keys = page.keys.splice(cut);
      separator = right.keys[0];          // копия первого ключа уходит вверх
    } else {
      right.keys = page.keys.splice(cut + 1);
      separator = page.keys.pop();        // средний ключ переезжает вверх
      right.children = page.children.splice(cut + 1);
    }
    page.next = right;
    tree.pages++;

    const parent = path.pop();
    if (!parent) {                        // делился корень — дерево растёт
      tree.root = { leaf: false, keys: [separator], children: [page, right], next: null };
      tree.levels++;
      tree.pages++;
      return;
    }
    parent.page.keys.splice(parent.i, 0, separator);
    parent.page.children.splice(parent.i + 1, 0, right);
    appended = parent.i === parent.page.keys.length - 1;
    page = parent.page;
  }
}`;

export const BTREE_NOTE =
  'Дерево растёт снизу: переполнился лист — он делится на два, и разделитель уходит в родителя; переполнился родитель — делится он. Новый уровень появляется только когда делится корень, поэтому все листья всегда на одной глубине. С ёмкостью страницы Postgres — 406 ключей, а у правой страницы при делении 366 слева, это fillfactor 90 % — тот же код строит для 30 000 `id` ровно то дерево, что показывает `pageinspect`: 82 листа по 366 ключей и разделители 367, 733, 1099 в корне.';

const ASC_KEYS = Array.from({ length: 30 }, (_, i) => i + 1);
/** Те же 30 ключей вперемешку: i·7 mod 31 перебирает 1…30 без повторов. */
const MIXED_KEYS = Array.from({ length: 30 }, (_, i) => ((i + 1) * 7) % 31);

export const BTREE_SCENARIOS: BtreeScenario[] = [
  {
    id: 'asc',
    label: 'id по возрастанию',
    keys: ASC_KEYS,
    capacity: 4,
    rightFill: 4,
    note: 'Ключи приходят по возрастанию, как `id` из последовательности. Каждый новый ключ дописывается в самый правый лист, и при делении слева остаётся полная страница.',
    search: 17,
    range: [10, 20],
  },
  {
    id: 'mixed',
    label: 'вперемешку',
    keys: MIXED_KEYS,
    capacity: 4,
    rightFill: 4,
    note: 'Те же 30 ключей в разном порядке, как адреса почты или UUID. Ключи попадают в середину, листья делятся пополам и остаются полупустыми — страниц выходит больше.',
    search: 17,
    range: [10, 20],
  },
];

export const BTREE_CAPTION =
  'Страница здесь вмещает четыре ключа вместо четырёхсот — иначе дерево не поместилось бы на экран, а устроено оно так же. Дерево строит и обходит функция `BTREE_CODE` выше. Найденные страницы подсвечены: поиск ключа читает по странице на уровень, диапазон — один спуск и дальше листья вправо.';

export const RANGE_SQL = 'SELECT * FROM users WHERE id BETWEEN 1000 AND 1100';

export const PLAN_RANGE = `Index Scan using users_pkey on users  (cost=0.29..11.31 rows=101 width=49) (actual rows=101.00 loops=1)
  Index Cond: ((id >= 1000) AND (id <= 1100))
  Index Searches: 1
  Buffers: shared hit=5`;

export const RANGE_NOTE =
  'Сто одна строка за пять страниц: корень, два листа (граница листов приходится на 1099) и две страницы таблицы — строки с `id` от 1000 до 1100 лежат на страницах 9 и 10. Диапазон дёшев, пока строки по порядку индекса лежат и в таблице рядом. Если они рассыпаны — за каждой придётся идти на отдельную страницу.';

// ─── Раздел 3. Как читать EXPLAIN ──────────────────────────────────────────────────────────

/** Вторая таблица — только для соединений. Тест создаёт её поверх `SETUP_SQL`. */
export const ORDERS_SQL = `CREATE TABLE orders (
  id      bigint PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users,
  total   int    NOT NULL
);

INSERT INTO orders
SELECT i, 1 + (i * 7) % 30000, 100 + i % 900
FROM generate_series(1, 60000) AS i;

CREATE INDEX orders_user_idx ON orders (user_id);
ANALYZE orders;`;

export const LOOPS_SQL = `EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.total, u.email
FROM orders o JOIN users u ON u.id = o.user_id
WHERE o.id <= 5;`;

export const PLAN_LOOPS = `Nested Loop  (cost=0.58..49.90 rows=5 width=31) (actual rows=5.00 loops=1)
  Buffers: shared hit=18
  ->  Index Scan using orders_pkey on orders o  (cost=0.29..8.38 rows=5 width=20) (actual rows=5.00 loops=1)
        Index Cond: (id <= 5)
        Index Searches: 1
        Buffers: shared hit=3
  ->  Index Scan using users_pkey on users u  (cost=0.29..8.30 rows=1 width=27) (actual rows=1.00 loops=5)
        Index Cond: (id = o.user_id)
        Index Searches: 5
        Buffers: shared hit=15`;

export const PLAIN_PLAN =
  'Как поручение с подпоручениями: «возьми пять заказов и к каждому приложи карточку клиента». Исполнитель (`Nested Loop`) берёт у первого помощника очередной заказ и с ним идёт ко второму за карточкой — пять раз. Помощники записаны под исполнителем со сдвигом вправо.';

export const EXPLAIN_PARTS = [
  { k: '`Nested Loop`, `Index Scan …`', d: 'Узел плана — один шаг. Отступ и `->` показывают, кто чей ребёнок: родитель получает строки от детей. Читают снизу вверх и изнутри наружу.' },
  { k: '`cost=0.29..8.30`', d: 'Оценка планировщика в условных единицах: до первой строки и до последней. Единица — чтение одной страницы подряд. Это не миллисекунды и между разными запросами не сравнивается.' },
  { k: '`rows=1`', d: 'Сколько строк планировщик **ожидал** — на один проход узла.' },
  { k: '`actual rows=1.00 loops=5`', d: 'Что вышло на деле — тоже **на один проход**. Узел выполнили 5 раз, всего он вернул 1 × 5 = 5 строк. Есть только с `ANALYZE`: запрос по-настоящему выполняется.' },
  { k: '`Index Cond`', d: 'Условие, которое проверил индекс. Строки, не прошедшие его, не читались.' },
  { k: '`Filter`, `Rows Removed by Filter`', d: 'Условие, которое проверялось на уже прочитанной строке, и сколько строк оно отбросило. Большое число здесь — прочитано лишнее.' },
  { k: '`Index Searches: 5`', d: 'Сколько раз узел спускался по индексу от корня. Строка появилась в Postgres 18.' },
  { k: '`Buffers: shared hit=15`', d: 'Сколько страниц тронул узел вместе с детьми и **за все проходы**: 5 спусков по 3 страницы. У корня — сумма всего плана: 3 + 15 = 18.' },
];

export const EXPLAIN_NOTE =
  'Первым делом сравнивают `rows` и `actual rows` у каждого узла. Расхождение в разы — планировщик выбирал план для других данных, и дальше искать надо в статистике. Вторым — `Buffers`: где читается больше всего страниц, там и работа. Время в плане тоже есть, но оно скачет от запуска к запуску; страницы у того же плана на тех же данных — нет.';

export const EXPLAIN_TIPS = [
  {
    t: '`ANALYZE` выполняет запрос',
    d: '`EXPLAIN ANALYZE DELETE …` удалит строки. Изменяющие запросы смотрят внутри транзакции: `BEGIN; EXPLAIN ANALYZE …; ROLLBACK;`.',
    tone: 'warn' as const,
  },
  {
    t: 'Без `ANALYZE` — только догадка',
    d: 'Простой `EXPLAIN` запрос не выполняет и показывает лишь оценки. Для вопроса «почему медленно» нужен `actual`: ошибка обычно в расхождении оценки с фактом.',
  },
  {
    t: '`FORMAT JSON` — для программ',
    d: 'Те же поля деревом: `Node Type`, `Plan Rows`, `Actual Rows`, `Actual Loops`, `Shared Hit Blocks`. Их читают визуализаторы планов и тесты этой темы.',
  },
];

// ─── Раздел 4. Как планировщик выбирает ────────────────────────────────────────────────────

export const PLAIN_PLANNER =
  'Как навигатор, который выбирает маршрут по прогнозу пробок. Он не едет всеми дорогами сразу, а прикидывает время каждой по сводке и выбирает быструю. Сводка устарела — навигатор уверенно ведёт в пробку. У планировщика сводка — статистика таблицы, а время — `cost`.';

export const SCAN_KINDS = [
  {
    t: 'Seq Scan',
    d: 'Все страницы таблицы подряд, условие — на каждой строке. Цена почти не зависит от того, сколько строк подходит: читается всё.',
  },
  {
    t: 'Index Scan',
    d: 'Спуск по индексу и за каждой найденной строкой — в таблицу. Если строки рассыпаны, каждая — отдельная страница, прочитанная вразброс. Планировщик считает такое чтение вчетверо дороже чтения подряд (`random_page_cost = 4`).',
  },
  {
    t: 'Bitmap Heap Scan',
    d: 'Сначала `Bitmap Index Scan` собирает из индекса номера всех нужных страниц, потом таблица читается по возрастанию номеров, каждая страница один раз. Середина между первыми двумя.',
  },
];

export const PLAN_LEAD_TEXT =
  'Какой из трёх дешевле, решают две вещи. **Сколько строк** вернёт условие — это планировщик берёт из статистики. И **лежат ли эти строки рядом** — это `correlation` из той же статистики: 1 — строки в таблице идут в порядке индекса, около 0 — рассыпаны. У `id` в примере `correlation` = 1: строки вставлялись по возрастанию. У `created_at` — 0,0008: соседние дни разбросаны по всей таблице.';

/** Модель стоимости. Её исполняют демо и тест; тест сверяет цены с `EXPLAIN`. */
export const PLANNER_CODE = `// Настройки Postgres по умолчанию. Цена — в условных единицах:
// 1 — прочитать одну страницу таблицы сразу за предыдущей.
const SEQ_PAGE = 1.0, RANDOM_PAGE = 4.0;
const CPU_TUPLE = 0.01, CPU_INDEX_TUPLE = 0.005, CPU_OPERATOR = 0.0025;

// Сколько разных страниц из pages заденут n строк, разбросанных
// по таблице случайно (формула Макерта — Ломана из исходников Postgres).
function pagesTouched(n, pages) {
  const p = (2 * pages * n) / (2 * pages + n);
  return p >= pages ? pages : Math.ceil(p);
}

// Проход по индексу: спуск от корня и листья с нужными ключами.
function indexPart(t, rows) {
  const leaves = Math.ceil((rows * t.indexPages) / t.tuples);
  const descent = Math.ceil(Math.log2(t.tuples)) * CPU_OPERATOR
                + t.levels * 50 * CPU_OPERATOR;
  return descent + leaves * RANDOM_PAGE
       + rows * (CPU_INDEX_TUPLE + CPU_OPERATOR);
}

// t — статистика: pages и tuples таблицы, indexPages, levels и
// correlation индекса. rows — сколько строк планировщик ожидает.
// В WHERE одно сравнение по столбцу индекса.
function planCosts(t, rows) {
  // Seq Scan: все страницы подряд, сравнение — на каждой строке.
  const seq = t.pages * SEQ_PAGE + t.tuples * (CPU_TUPLE + CPU_OPERATOR);

  // Index Scan: за каждой строкой — в таблицу. Худший случай: каждая
  // страница вразброс. Лучший: строки лежат в порядке индекса, страницы
  // идут подряд. Между ними цену двигает квадрат correlation.
  const worst = pagesTouched(rows, t.pages) * RANDOM_PAGE;
  const span = Math.ceil((rows / t.tuples) * t.pages);
  const best = span > 0 ? RANDOM_PAGE + (span - 1) * SEQ_PAGE : 0;
  const c2 = t.correlation * t.correlation;
  const index = indexPart(t, rows) + worst + c2 * (best - worst)
              + rows * CPU_TUPLE;

  // Bitmap Heap Scan: номера страниц из индекса, потом чтение по
  // возрастанию. Чем больше доля страниц, тем ближе к «подряд».
  const touched = pagesTouched(rows, t.pages);
  const perPage = touched >= 2
    ? RANDOM_PAGE - (RANDOM_PAGE - SEQ_PAGE) * Math.sqrt(touched / t.pages)
    : RANDOM_PAGE;
  const bitmap = indexPart(t, rows) + 0.1 * CPU_OPERATOR * rows
               + touched * perPage + rows * (CPU_TUPLE + CPU_OPERATOR);

  const costs = { 'Seq Scan': seq, 'Index Scan': index, 'Bitmap Heap Scan': bitmap };
  const winner = Object.keys(costs).reduce((a, b) => (costs[b] < costs[a] ? b : a));
  return { costs, winner };
}`;

export const PLANNER_NOTE =
  'Это упрощение настоящего планировщика: одна таблица, одно условие, без Index Only Scan и параллельных планов. Но формулы те же, что в исходниках Postgres, и на запросах ниже цены совпадают с `EXPLAIN` до единицы, а выбор — всегда.';

const STATS_TABLE = { pages: 306, tuples: 30000 };

/** Точки стенда: оценка строк, выбор Postgres и цены всех трёх вариантов (`enable_* = off`). */
export const PLAN_COLUMNS: PlanColumn[] = [
  {
    id: 'id',
    label: 'id — строки по порядку',
    note: 'Индекс `users_pkey`. Строки вставлялись по возрастанию `id`, `correlation` = 1: диапазон `id` лежит на соседних страницах.',
    stats: { ...STATS_TABLE, indexPages: 84, levels: 2, correlation: 1 },
    points: [
      { n: 10, rows: 10, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 8.46, 'Bitmap Heap Scan': 39.07 } },
      { n: 100, rows: 100, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 11.04, 'Bitmap Heap Scan': 213.54 } },
      { n: 1000, rows: 1000, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 43.79, 'Bitmap Heap Scan': 338.54 } },
      { n: 5000, rows: 5000, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 198.79, 'Bitmap Heap Scan': 463.54 } },
      { n: 10000, rows: 10000, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 393.29, 'Bitmap Heap Scan': 620.79 } },
      { n: 16000, rows: 16000, chosen: 'Index Scan', costs: { 'Seq Scan': 681, 'Index Scan': 627.29, 'Bitmap Heap Scan': 810.29 } },
      { n: 20000, rows: 20000, chosen: 'Seq Scan', costs: { 'Seq Scan': 681, 'Index Scan': 782.29, 'Bitmap Heap Scan': 935.29 } },
      { n: 30000, rows: 30000, chosen: 'Seq Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1170.29, 'Bitmap Heap Scan': 1249.79 } },
    ],
    sql: 'SELECT * FROM users WHERE id <= {n}',
    unit: 'первые {n} id',
  },
  {
    id: 'created_at',
    label: 'created_at — строки вразброс',
    note: 'Индекс `users_created_idx ON users (created_at)`. Дни рассыпаны по таблице, `correlation` = 0,0008: даже один день — это 30 строк на 30 разных страницах.',
    stats: { ...STATS_TABLE, indexPages: 30, levels: 2, correlation: 0.00078558887 },
    points: [
      { n: 1, rows: 32, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 128.85, 'Bitmap Heap Scan': 99.33 } },
      { n: 3, rows: 97, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 341.98, 'Bitmap Heap Scan': 210.22 } },
      { n: 10, rows: 322, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 853.92, 'Bitmap Heap Scan': 329.17 } },
      { n: 30, rows: 967, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1245.21, 'Bitmap Heap Scan': 329.87 } },
      { n: 100, rows: 3222, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1296.67, 'Bitmap Heap Scan': 387.53 } },
      { n: 300, rows: 9000, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1417.79, 'Bitmap Heap Scan': 524.54 } },
      { n: 500, rows: 15000, chosen: 'Bitmap Heap Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1546.79, 'Bitmap Heap Scan': 670.04 } },
      { n: 700, rows: 21000, chosen: 'Seq Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1675.79, 'Bitmap Heap Scan': 815.54 } },
      { n: 1000, rows: 30000, chosen: 'Seq Scan', costs: { 'Seq Scan': 681, 'Index Scan': 1869.29, 'Bitmap Heap Scan': 1033.79 } },
    ],
    sql: "SELECT * FROM users WHERE created_at < date '2024-01-01' + {n}",
    unit: 'первые {n} дн.',
  },
];

export const PLAN_CAPTION =
  'Цены считает функция `planCosts` выше — по той же статистике, что видит Postgres: страницы таблицы и индекса, `correlation` и ожидаемое число строк. Рядом — что Postgres на самом деле выбрал для этого запроса на стенде и какие цены назвал `EXPLAIN` для каждого из трёх вариантов.';

export const SELECTIVITY_FACTS = [
  {
    t: 'Один процент строк — почти все страницы',
    d: 'Заблокированных — 300 из 30 000, каждый сотый. Index Scan по `status = \'blocked\'` прочитал 302 страницы: две страницы индекса и 300 страниц таблицы — заблокированный нашёлся почти на каждой. Seq Scan читает 306. Индекс сэкономил четыре страницы из трёхсот.',
    tone: 'warn' as const,
  },
  {
    t: 'Порядок важнее доли',
    d: 'Больше половины таблицы по `id` (`id <= 16000`) Postgres всё ещё читает через индекс: строки идут подряд, и это почти Seq Scan по куску таблицы. По `created_at` уже 2,6 % строк задевают все 306 страниц.',
  },
  {
    t: 'Bitmap — до последнего',
    d: 'На рассыпанных строках Bitmap Heap Scan дешевле Seq Scan вплоть до половины таблицы: страницы он читает по возрастанию, каждую один раз, а условие проверяет только у найденных строк, а не у всех 30 000. Seq Scan выигрывает, когда нужна почти вся таблица.',
  },
];

// ─── Раздел 5. Почему индекс не берётся ────────────────────────────────────────────────────

export interface WhyStep {
  /** Что выполнить перед запросом: индекс, `ANALYZE`. */
  ddl?: string;
  sql: string;
  node: string;
  /** `Buffers: shared hit` у верхнего узла — сколько страниц прочитано. */
  pages: number;
  /** Строка, которая должна быть в тексте плана. */
  extra?: string;
}

export interface WhyCase {
  id: string;
  t: string;
  d: string;
  tone?: 'warn' | 'err';
  steps: WhyStep[];
}

export const WHY_CASES: WhyCase[] = [
  {
    id: 'function',
    t: 'Функция над столбцом',
    d: 'Индекс хранит `email`, а условие спрашивает `lower(email)` — значение, которого в индексе нет. Postgres не знает, что `lower` сохраняет порядок, и проверяет условие на каждой строке. Лечение — индекс **по выражению**: в нём лежит ровно `lower(email)`.',
    tone: 'err',
    steps: [
      { ddl: 'CREATE INDEX users_email_idx ON users (email);', sql: "SELECT * FROM users WHERE lower(email) = 'user42@mail.test';", node: 'Seq Scan', pages: 306 },
      { ddl: 'CREATE INDEX users_lower_email_idx ON users (lower(email));\nANALYZE users;', sql: "SELECT * FROM users WHERE lower(email) = 'user42@mail.test';", node: 'Index Scan', pages: 3 },
    ],
  },
  {
    id: 'type',
    t: 'Другой тип в сравнении',
    d: '`id` — `bigint`, а `42.0` — `numeric`. Postgres приводит к общему типу **столбец**, а не число: в условии оказывается `(id)::numeric`, и индекс по `id` уже не подходит. Строка `\'42\'` типа не имеет и получает тип столбца — индекс работает. Так же ломает приведение в самом запросе: `id::text`. В коде приложения это обычно параметр, который драйвер отправил не тем типом.',
    tone: 'err',
    steps: [
      { sql: 'SELECT * FROM users WHERE id = 42.0;', node: 'Seq Scan', pages: 306, extra: 'Filter: ((id)::numeric = 42.0)' },
      { sql: "SELECT * FROM users WHERE id = '42';", node: 'Index Scan', pages: 3 },
      { sql: "SELECT * FROM users WHERE id::text = '42';", node: 'Seq Scan', pages: 306 },
    ],
  },
  {
    id: 'like',
    t: 'LIKE с процентом в начале',
    d: 'Индекс отсортирован с первого символа. `LIKE \'user42@%\'` — это диапазон от `user42@` до `user42A`, Postgres так и пишет в `Index Cond`. У `\'%42@mail.test\'` начало неизвестно, диапазона нет — читается всё. Для поиска по середине строки B-дерево не годится; нужен триграммный индекс `pg_trgm`.',
    tone: 'warn',
    steps: [
      { ddl: 'CREATE INDEX users_email_idx ON users (email);', sql: "SELECT * FROM users WHERE email LIKE 'user42@%';", node: 'Index Scan', pages: 3, extra: "Index Cond: ((email >= 'user42@'::text) AND (email < 'user42A'::text))" },
      { sql: "SELECT * FROM users WHERE email LIKE '%42@mail.test';", node: 'Seq Scan', pages: 306 },
    ],
  },
  {
    id: 'prefix',
    t: 'Не ведущий столбец составного индекса',
    d: 'Индекс `(email, city)` отсортирован по `email`, а внутри одного адреса — по `city`. Все москвичи рассыпаны по всему индексу, искать их нечем: Postgres читает таблицу. Принудительный проход по этому индексу прочитал бы 1271 страницу — вчетверо больше таблицы. Правило «левого префикса»: индекс помогает условиям на первый столбец, на первый и второй, и так далее.',
    tone: 'err',
    steps: [
      { ddl: 'CREATE INDEX users_email_city_idx ON users (email, city);', sql: "SELECT * FROM users WHERE email = 'user42@mail.test' AND city = 'Омск';", node: 'Index Scan', pages: 3 },
      { sql: "SELECT * FROM users WHERE city = 'Омск';", node: 'Seq Scan', pages: 306 },
    ],
  },
  {
    id: 'skip',
    t: 'Пропуск ведущего столбца — Postgres 18',
    d: 'Если у первого столбца мало разных значений, Postgres 18 обходит правило: спускается по индексу отдельно для каждого города и ищет нужный день внутри. `Index Searches: 11` — одиннадцать спусков вместо одного. Работает, пока ведущих значений немного; у `email` их 30 000, и там пропуск не поможет.',
    steps: [
      { ddl: 'CREATE INDEX users_city_created_idx ON users (city, created_at);', sql: "SELECT * FROM users WHERE created_at = date '2024-03-01';", node: 'Bitmap Heap Scan', pages: 52, extra: 'Index Searches: 11' },
    ],
  },
  {
    id: 'or',
    t: 'OR со столбцом без индекса',
    d: 'Для `OR` индекс должен быть у **каждой** половины: Postgres соберёт номера страниц из обоих индексов (`BitmapOr`) и прочитает их. Если одной половине индекса нет, её строки всё равно придётся искать по всей таблице — и Postgres сразу читает таблицу целиком.',
    tone: 'warn',
    steps: [
      { ddl: 'CREATE INDEX users_email_idx ON users (email);', sql: "SELECT * FROM users WHERE id = 42 OR email = 'user7@mail.test';", node: 'Bitmap Heap Scan', pages: 5, extra: 'BitmapOr' },
      { sql: "SELECT * FROM users WHERE id = 42 OR city = 'Омск';", node: 'Seq Scan', pages: 306 },
    ],
  },
  {
    id: 'selectivity',
    t: 'Условию подходит почти всё',
    d: 'Активны 99 % пользователей. Индекс по `status` вернул бы адреса почти всех строк, и Postgres прав, читая таблицу подряд. Индекс по столбцу с двумя-тремя значениями полезен только для редкого значения — а для него лучше частичный индекс.',
    steps: [
      { ddl: 'CREATE INDEX users_status_idx ON users (status);', sql: "SELECT * FROM users WHERE status = 'active';", node: 'Seq Scan', pages: 306 },
      { sql: "SELECT * FROM users WHERE status = 'blocked';", node: 'Index Scan', pages: 302 },
    ],
  },
];

/** Код карточки: запросы и что ответил стенд. Тот же текст сверяет тест — через поля `steps`. */
export function whyCode(c: WhyCase): string {
  return c.steps
    .map((s) => {
      const head = s.ddl ? `${s.ddl}\n\n` : '';
      const extra = s.extra ? `\n--   ${s.extra}` : '';
      return `${head}${s.sql}\n-- ${s.node}, страниц: ${s.pages}${extra}`;
    })
    .join('\n\n');
}

/** Принудительный проход по `(email, city)` для `city = 'Омск'` (`enable_seqscan`, `enable_bitmapscan` = off). */
export const FORCED_PREFIX_PAGES = 1271;

export const STALE_SQL = `-- Новый статус, о котором статистика ещё не знает
UPDATE users SET status = 'frozen' WHERE id % 10 < 3;

EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.total
FROM users u JOIN orders o ON o.user_id = u.id
WHERE u.status = 'frozen';`;

export const STALE_SETUP = 'CREATE INDEX users_status_idx ON users (status);';
export const STALE_UPDATE = "UPDATE users SET status = 'frozen' WHERE id % 10 < 3";
export const STALE_QUERY =
  "SELECT o.id, o.total FROM users u JOIN orders o ON o.user_id = u.id WHERE u.status = 'frozen'";

export const PLAN_STALE = `Nested Loop  (cost=4.60..16.38 rows=2 width=12) (actual rows=18000.00 loops=1)
  Buffers: shared hit=36103
  ->  Index Scan using users_status_idx on users u  (cost=0.29..4.46 rows=1 width=8) (actual rows=9000.00 loops=1)
        Index Cond: (status = 'frozen'::text)
        Index Searches: 1
        Buffers: shared hit=103
  ->  Bitmap Heap Scan on orders o  (cost=4.31..11.90 rows=2 width=20) (actual rows=2.00 loops=9000)
        Recheck Cond: (u.id = user_id)
        Heap Blocks: exact=18000
        Buffers: shared hit=36000
        ->  Bitmap Index Scan on orders_user_idx  (cost=0.00..4.30 rows=2 width=0) (actual rows=2.00 loops=9000)
              Index Cond: (user_id = u.id)
              Index Searches: 9000
              Buffers: shared hit=18000`;

export const PLAN_FRESH = `Hash Join  (cost=437.56..1578.08 rows=18000 width=12) (actual rows=18000.00 loops=1)
  Hash Cond: (o.user_id = u.id)
  Buffers: shared hit=486
  ->  Seq Scan on orders o  (cost=0.00..983.00 rows=60000 width=20) (actual rows=60000.00 loops=1)
        Buffers: shared hit=383
  ->  Hash  (cost=325.06..325.06 rows=9000 width=8) (actual rows=9000.00 loops=1)
        Buckets: 16384  Batches: 1  Memory Usage: 346kB
        Buffers: shared hit=103
        ->  Index Scan using users_status_idx on users u  (cost=0.29..325.06 rows=9000 width=8) (actual rows=9000.00 loops=1)
              Index Cond: (status = 'frozen'::text)
              Index Searches: 1
              Buffers: shared hit=103`;

export const PLAIN_STATS =
  'Статистика — как перепись населения: её проводят время от времени, а не при каждом рождении. Пока новой переписи не было, город считается деревней, и автобусов туда пускают два. Новый статус `frozen` для планировщика — та самая деревня: в статистике его нет совсем.';

export const STALE_NOTE =
  'Статистика собрана, когда статуса `frozen` не было, и планировщик ждёт **одну** строку (`rows=1`), а приходит 9000. Под одну строку он выбрал вложенный цикл: на каждого пользователя — свой спуск по индексу заказов. Внутренний узел выполнился 9000 раз (`loops=9000`) и прочитал 36 000 страниц. После `ANALYZE users` оценка стала точной, и тот же запрос стал соединением через хеш-таблицу: обе таблицы по разу, 486 страниц — в 74 раза меньше.';

export const STALE_FACTS = [
  {
    t: 'Когда статистика обновляется сама',
    d: 'Фоновый `autovacuum` запускает `ANALYZE`, когда с прошлого раза изменилось больше 50 строк плюс 10 % таблицы. На таблице в миллион строк это 100 050 изменений: массовое обновление, загрузка, миграция вполне укладываются в «ещё не пора».',
  },
  {
    t: 'После массовых изменений — `ANALYZE` руками',
    d: 'Загрузили данные, перенесли столбец, ввели новое значение — следующей командой `ANALYZE таблица`. Он читает выборку строк, а не всю большую таблицу, и не блокирует запись.',
    tone: 'warn' as const,
  },
  {
    t: 'Где смотреть',
    d: '`pg_stat_user_tables.last_analyze` и `last_autoanalyze` — когда собиралась статистика. `pg_stats` — что в ней: `most_common_vals`, `n_distinct`, `correlation` по каждому столбцу.',
  },
];

// ─── Раздел 6. Index Only Scan и особые индексы ────────────────────────────────────────────

export const PLAIN_VISIBILITY =
  'Как отметки «проверено» в журнале смен. Если на странице журнала стоит отметка, что все записи на ней окончательные, их можно переписывать не сверяя с оригиналом. Нет отметки — каждую запись приходится сверять. Отметки ставит `VACUUM`, а любая правка на странице снимает отметку с неё.';

export const IOS_SQL = 'SELECT id FROM users WHERE id BETWEEN 1000 AND 1100';

export const IOS_TEXT =
  'Запросу нужен только `id`, а `id` есть в самом индексе — таблицу можно не читать. Это Index Only Scan. Но в индексе нет сведений, видна ли строка вашей транзакции: может, её удалили, а `VACUUM` ещё не убрал. Поэтому для каждой строки Postgres смотрит в **карту видимости** — по биту на страницу таблицы, «все строки здесь видны всем». Бит стоит — таблицу не трогает. Не стоит — идёт в таблицу проверять (`Heap Fetches`).';

export const IOS_ROWS = [
  { k: 'сразу после загрузки', heapFetches: 101, pages: 5, d: 'карта видимости пуста: каждая строка проверена в таблице' },
  { k: 'после `VACUUM users`', heapFetches: 0, pages: 4, d: 'корень, два листа и одна страница карты видимости' },
  { k: 'после `UPDATE` одной строки (`id` = 1050)', heapFetches: 80, pages: 7, d: 'правка сняла отметку со страницы — её строки снова проверяются' },
];

export const IOS_NOTE =
  'Поэтому Index Only Scan хорош на таблицах, которые `VACUUM` успевает обходить. На таблице, где строки постоянно меняются, он вырождается в обычный Index Scan. В плане это видно сразу: `Heap Fetches` близко к числу строк.';

export const INCLUDE_SQL = `-- Запросу нужны дата и город, условие — только по дате
SELECT created_at, city FROM users
WHERE created_at >= date '2026-09-01';

CREATE INDEX users_created_city_idx ON users (created_at) INCLUDE (city);`;

export const INCLUDE_QUERY = "SELECT created_at, city FROM users WHERE created_at >= date '2026-09-01'";

export const PLAN_INCLUDE_BEFORE = `Bitmap Heap Scan on users  (cost=10.33..326.08 rows=780 width=15) (actual rows=780.00 loops=1)
  Recheck Cond: (created_at >= '2026-09-01'::date)
  Heap Blocks: exact=306
  Buffers: shared hit=308
  ->  Bitmap Index Scan on users_created_idx  (cost=0.00..10.14 rows=780 width=0) (actual rows=780.00 loops=1)
        Index Cond: (created_at >= '2026-09-01'::date)
        Index Searches: 1
        Buffers: shared hit=2`;

export const PLAN_INCLUDE_AFTER = `Index Only Scan using users_created_city_idx on users  (cost=0.29..29.94 rows=780 width=15) (actual rows=780.00 loops=1)
  Index Cond: (created_at >= '2026-09-01'::date)
  Heap Fetches: 0
  Index Searches: 1
  Buffers: shared hit=6`;

export const INCLUDE_NOTE =
  '`INCLUDE (city)` кладёт город в листья индекса, не делая его частью ключа: искать по нему нельзя, но читать — можно. 780 строк одного месяца лежали на всех 306 страницах таблицы; теперь запрос читает 6 страниц индекса. Цена — размер: `users_created_idx` занимал 30 страниц, `users_created_city_idx` — 131. Обычный индекс хранит повторяющуюся дату один раз на группу строк, а индекс с `INCLUDE` так не умеет.';

/** Размеры индексов в страницах по 8 КБ (`pg_class.relpages` после создания). */
export const INDEX_SIZES = [
  { k: '`users_created_idx`', ddl: 'CREATE INDEX users_created_idx ON users (created_at)', pages: 30 },
  { k: '`users_created_city_idx`', ddl: 'CREATE INDEX users_created_city_idx ON users (created_at) INCLUDE (city)', pages: 131 },
  { k: '`users_blocked_created_idx`', ddl: "CREATE INDEX users_blocked_created_idx ON users (created_at) WHERE status = 'blocked'", pages: 2 },
];

export const PARTIAL_SQL = `-- Индекс только по заблокированным: 300 строк из 30 000
CREATE INDEX users_blocked_created_idx ON users (created_at)
  WHERE status = 'blocked';

SELECT * FROM users
WHERE status = 'blocked' AND created_at >= date '2026-01-01';`;

export const PARTIAL_QUERY = "SELECT * FROM users WHERE status = 'blocked' AND created_at >= date '2026-01-01'";

export const PLAN_PARTIAL = `Bitmap Heap Scan on users  (cost=4.78..189.21 rows=81 width=49) (actual rows=60.00 loops=1)
  Recheck Cond: ((created_at >= '2026-01-01'::date) AND (status = 'blocked'::text))
  Heap Blocks: exact=60
  Buffers: shared hit=61
  ->  Bitmap Index Scan on users_blocked_created_idx  (cost=0.00..4.75 rows=81 width=0) (actual rows=60.00 loops=1)
        Index Cond: (created_at >= '2026-01-01'::date)
        Index Searches: 1
        Buffers: shared hit=1`;

export const PARTIAL_NOTE =
  'Частичный индекс хранит только строки, подходящие под его `WHERE`: две страницы вместо тридцати, и при вставке активного пользователя он вовсе не меняется. Postgres берёт его, только если из условия запроса **следует** условие индекса — здесь в запросе стоит то же `status = \'blocked\'`. Запрос про активных этот индекс не увидит.';

export const SPECIAL_FACTS = [
  {
    t: 'По выражению — это тоже индекс',
    d: '`CREATE INDEX … ON users (lower(email))` из примера с функцией. Условие запроса должно повторять выражение буквально: индекс по `lower(email)` не поможет `upper(email)`. И у выражения своя статистика: до `ANALYZE` планировщик ждал от `lower(email) = …` 150 строк, после — одну.',
  },
  {
    t: 'Уникальный индекс',
    d: '`PRIMARY KEY` и `UNIQUE` — это B-дерево, которое при вставке ещё и проверяет, нет ли такого ключа. Индекс `users_pkey` в этой теме появился сам, из `PRIMARY KEY`.',
  },
  {
    t: 'Индекс на живой таблице',
    d: 'Обычный `CREATE INDEX` не пускает запись в таблицу, пока строится. На проде индекс строят с `CONCURRENTLY` — дольше, зато запись идёт. Как это устроено и что делать с упавшей сборкой — в теме про миграции.',
  },
];

// ─── Раздел 7. Цена индекса на запись ──────────────────────────────────────────────────────

/**
 * Копии `users` (`CREATE TABLE wN (LIKE users)`, 30 000 строк, `VACUUM ANALYZE`) с 0, 1 и 3
 * индексами. «Одна строка» — второй одиночный `INSERT` (первый читает ещё и холодные страницы),
 * «1000 строк» — один `INSERT … SELECT`. Страницы — `hit + read` у узла `Insert`.
 */
export const WRITE_ROWS = [
  { indexes: 0, ddl: '', rowPages: 1, walRecords: 1, walBytes: 103, bulkPages: 1027, bulkWalRecords: 1000, bulkWalBytes: 103004 },
  { indexes: 1, ddl: 'CREATE INDEX ON {t} (email);', rowPages: 3, walRecords: 2, walBytes: 183, bulkPages: 3045, bulkWalRecords: 2009, bulkWalBytes: 216868 },
  {
    indexes: 3,
    ddl: 'CREATE INDEX ON {t} (email); CREATE INDEX ON {t} (city); CREATE INDEX ON {t} (created_at);',
    rowPages: 7,
    walRecords: 4,
    walBytes: 319,
    bulkPages: 7050,
    bulkWalRecords: 4048,
    bulkWalBytes: 360324,
  },
];

export const WRITE_TEXT =
  'Каждый индекс — отдельное B-дерево, и `INSERT` обязан положить новый ключ в каждое. Для этого он спускается по индексу так же, как поиск: корень и лист — две страницы на индекс. И каждая правка индекса — отдельная запись в журнал предзаписи (WAL), который Postgres пишет на диск перед ответом «готово» и шлёт репликам.';

export const WRITE_NOTE =
  'Одна строка без индексов — одна страница таблицы и одна запись WAL. Три индекса превращают её в семь страниц и четыре записи. На тысяче строк то же самое: страниц в семь раз больше, журнала — в три с половиной. Время на этом стенде не мерялось, но страницы и журнал — это и есть то, во что упирается запись на нагруженной базе.';

export const UNUSED_SQL = `SELECT indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE relname = 'users'
ORDER BY idx_scan;`;

export const UNUSED_NOTE =
  '`idx_scan` — сколько раз индекс использовали с последнего сброса статистики. Индекс, который месяцами стоит на нуле, только замедляет запись: на стенде созданный и ни разу не спрошенный `users_city_idx` показывает `0`. Перед удалением проверьте реплики — счётчик у каждого сервера свой.';

/** `CREATE TABLE w3 (LIKE users INCLUDING INDEXES) WITH (fillfactor = 90)` + три индекса, `VACUUM ANALYZE`. */
export const HOT_FACTS = { updates: 100, hotStatus: 21, hotCity: 0 };

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Первый `EXPLAIN ANALYZE` для `id = 42` в новой сессии и второй. */
export const FIRST_RUN = { first: 6, second: 3 };

/** Оценка строк для `lower(email) = …` с индексом по выражению: до `ANALYZE` и после. */
export const EXPR_ROWS = { before: 150, after: 1 };

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`actual rows` — на один проход',
    d: '`actual rows=2.00 loops=9000` — это 18 000 строк, а не две. Узел внутри вложенного цикла с маленьким `rows` и огромным `loops` — первое место, куда смотреть.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Первый запуск читает больше',
    d: 'Первый `EXPLAIN ANALYZE` по `id = 42` в новой сессии тронул 6 страниц, второй — 3: в первый раз Postgres читал служебную страницу индекса. На живом сервере первый запуск ещё и читает с диска (`read=`). Сравнивают повторный запуск.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Доля строк — не доля страниц',
    d: 'Один процент строк может лежать на всех страницах таблицы — тогда индекс почти ничего не экономит. Смотрите не на `rows`, а на `Buffers` и `Heap Blocks`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Оценка 150 строк — это догадка',
    d: 'Для условия, о котором нет статистики (`lower(email) = …` без индекса, `id = 42.0`), планировщик берёт 0,5 % таблицы — 150 строк из 30 000. Круглая доля вместо оценки — признак, что статистика здесь не работает.',
  },
  {
    n: '05',
    t: '`INCLUDE` делает индекс толще',
    d: 'Индекс по дате с `INCLUDE (city)` вырос с 30 до 131 страницы: повторяющиеся ключи в нём больше не сжимаются. Включённый столбец окупается, только если Index Only Scan реально случается — то есть `VACUUM` успевает за таблицей.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Индекс отнимает быстрые UPDATE',
    d: 'Если `UPDATE` не трогает индексированных столбцов и на странице есть место, Postgres пишет новую версию рядом и индексы не правит (HOT). На стенде из 100 таких `UPDATE` по `status` HOT-ом прошли 21 — дальше кончилось место на странице. Из 100 `UPDATE` индексированного `city` — ни одного.',
  },
  {
    n: '07',
    t: '`LIKE \'abc%\'` зависит от сортировки базы',
    d: 'На стенде база в сортировке `C`, и обычный индекс обслуживает префиксный `LIKE`. В базе с сортировкой вроде `en_US.UTF-8` для этого нужен индекс с классом операторов `text_pattern_ops`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Принудить индекс нельзя — и не нужно',
    d: 'Подсказок планировщику в Postgres нет. `SET enable_seqscan = off` годится, чтобы посмотреть цену другого плана, но не как лечение: если план плохой, причина в статистике, типе или форме условия.',
  },
];

// ─── Источники и смежное ───────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'PostgreSQL — Using EXPLAIN',
    href: 'https://www.postgresql.org/docs/current/using-explain.html',
    what: 'узлы плана, `cost`, `rows`, `loops`, `BUFFERS`, `Rows Removed by Filter`, предупреждение про `ANALYZE` и изменяющие запросы',
  },
  {
    title: 'PostgreSQL — B-Tree Indexes',
    href: 'https://www.postgresql.org/docs/current/btree.html',
    what: 'устройство B-дерева, дедупликация и почему её нет у индексов с `INCLUDE`, fillfactor листьев',
  },
  {
    title: 'PostgreSQL — Multicolumn Indexes',
    href: 'https://www.postgresql.org/docs/current/indexes-multicolumn.html',
    what: 'ведущие столбцы составного индекса и пропуск ведущего столбца (skip scan) в Postgres 18',
  },
  {
    title: 'PostgreSQL — Index-Only Scans and Covering Indexes',
    href: 'https://www.postgresql.org/docs/current/indexes-index-only-scans.html',
    what: 'карта видимости, `Heap Fetches`, `INCLUDE`',
  },
  {
    title: 'PostgreSQL — Partial Indexes и Indexes on Expressions',
    href: 'https://www.postgresql.org/docs/current/indexes-partial.html',
    what: 'когда планировщик берёт частичный индекс; индексы по выражению — соседняя страница документации',
  },
  {
    title: 'PostgreSQL — Operator Classes and Operator Families',
    href: 'https://www.postgresql.org/docs/current/indexes-opclass.html',
    what: '`text_pattern_ops` для `LIKE` в сортировке, отличной от `C`',
  },
  {
    title: 'PostgreSQL — Planner Cost Constants',
    href: 'https://www.postgresql.org/docs/current/runtime-config-query.html#RUNTIME-CONFIG-QUERY-CONSTANTS',
    what: '`seq_page_cost`, `random_page_cost`, `cpu_tuple_cost` и их значения по умолчанию',
  },
  {
    title: 'PostgreSQL — Statistics Used by the Planner',
    href: 'https://www.postgresql.org/docs/current/planner-stats.html',
    what: '`pg_stats`, `most_common_vals`, `correlation`, выборка `ANALYZE`',
  },
  {
    title: 'PostgreSQL — Routine Vacuuming',
    href: 'https://www.postgresql.org/docs/current/routine-vacuuming.html',
    what: 'карта видимости и пороги автоматического `ANALYZE`',
  },
  {
    title: 'PostgreSQL — Heap-Only Tuples (HOT)',
    href: 'https://www.postgresql.org/docs/current/storage-hot.html',
    what: 'когда `UPDATE` обходится без правки индексов',
  },
  {
    title: 'PostgreSQL — pageinspect',
    href: 'https://www.postgresql.org/docs/current/pageinspect.html',
    what: '`bt_metap`, `bt_multi_page_stats`, `bt_page_items` — ими сняты уровни и листья',
  },
  {
    title: 'Исходники Postgres — costsize.c',
    href: 'https://github.com/postgres/postgres/blob/master/src/backend/optimizer/path/costsize.c',
    what: '`cost_seqscan`, `cost_index`, `cost_bitmap_heap_scan`, `index_pages_fetched` — формулы модели стоимости',
  },
  {
    title: 'PGlite',
    href: 'https://pglite.dev/',
    what: 'Postgres в WebAssembly, на котором снят стенд; версия 0.5.8, внутри PostgreSQL 18.3',
  },
];

export const RELATED =
  'Смежное на сайте: [Миграции базы без простоя, раздел «Перезапись и проходы»](/delivery/db-migrations/#s4) — `CREATE INDEX CONCURRENTLY`, блокировки при построении и невалидный индекс после сбоя. [Там же, раздел «Перенос пачками»](/delivery/db-migrations/#s5) — версии строк, `VACUUM` и почему пачку берут по диапазону ключа. [Source maps изнутри, раздел «От стека к исходнику»](/tooling/source-maps/#s3) — тот же двоичный поиск по отсортированному массиву. [Транзакции и уровни изоляции](/data/transactions/) — версии строк, снимки и аномалии двух одновременных сессий.';
