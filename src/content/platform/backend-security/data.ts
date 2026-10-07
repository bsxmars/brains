import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DnsChoice, EgressCase } from '@/widgets/bs-egress-check/model/types';
import type { FieldCase } from '@/widgets/bs-field-allowlist/model/types';

/**
 * Данные темы «Безопасность бэкенда глазами фронтенда».
 *
 * Тема написана здесь. До неё предмет висел строкой «Безопасность бэкенда: SSRF, IDOR, инъекции,
 * supply chain — Отдельная тема — готовится» в `OFFSCREEN` «Безопасности фронтенда». Браузерная
 * половина — источник, CORS, CSRF, XSS, CSP, куки — разобрана там и здесь не повторяется.
 * Lock-файл, integrity и скрипты установки — в «Пакетных менеджерах»; что попадает в бандл —
 * в «Модулях и сборке». Сюда они входят ссылками.
 *
 * Тема защитная: весь код — проверки, валидация и безопасные API. «Наивные» версии оставлены
 * ровно для того, чтобы тест мог показать, какие строки таблицы они пропускают.
 *
 * ── Что чем проверено ────────────────────────────────────────────────────────────────
 *
 * Весь код темы — строки ниже. Каждая напечатана на странице и **исполняется**
 * `tests/unit/backend-security.test.ts` — именно она, а не копия. Строки с `import`
 * исполняются так: тест вырезает строки импорта и подставляет **те же имена** из настоящих
 * модулей (`node:sqlite`, `node:child_process`, `node:util`, `zod`), остальной текст идёт
 * в движок как есть. Имя, которого тест не подставил, — красный тест.
 *
 *   — IDOR: `node:sqlite` в памяти (Node 26.8.2), сквозная база `SEED_CODE`, обработчики
 *     на поддельных запросах; свой тест читателя `CHECK_IDOR_CODE` зелёный на защищённой
 *     версии и красный на наивной;
 *   — SSRF: `EGRESS_CODE` по таблице `EGRESS_CASES` и `naiveCheck` по той же таблице
 *     (строки, которые она пропускает, закреплены); `guardLookup` — настоящим `http.get`
 *     на свой сервер 127.0.0.1 (без внешней сети; сервер считает дошедшие запросы);
 *     `fetchChecked` — на поддельном `fetch` с редиректом. Нормализация хоста парсером URL
 *     (`2130706433`, `0x7f.1`, `①②⑦.0.0.1`, `[::ffff:127.0.0.1]`) — тестом на `new URL`;
 *   — инъекции: `node:sqlite` (склейка против параметров, `ORDER BY ?`), `execFile` против
 *     `exec` — настоящим `wc` во временном каталоге; `shell: true` и DEP0190 — прогоном;
 *   — массовое присваивание: zod 4.6.2 (приходит с Astro, тест берёт его через `astro/zod`),
 *     `Object.assign` и `__proto__` из `JSON.parse`;
 *   — ошибки: настоящая ошибка `node:sqlite`, `TypeError`, свой `PublicError`;
 *   — цепочка поставок: `lockProblems` прогнана по `package-lock.json` этого проекта (сотни пакетов; точное число не пишется — оно меняется с каждой установкой).
 *
 * ── Что сверено с первоисточниками (29 сентября 2026) ─────────────────────────────────
 *
 *   — реестры IANA: CSV `iana-ipv4-special-registry-1.csv` и `iana-ipv6-special-registry-1.csv`.
 *     IPv4 `V4_BLOCKED` совпал со всеми блоками «Globally Reachable: False» (плюс multicast
 *     224/4 — он из другого реестра, RFC 5771). В IPv6 черновик пропускал два блока внутри
 *     2000::/3: `2001:2::/48` (замеры) и `3fff::/20` (документация, RFC 9637) — **добавлены**,
 *     тест держит их в списке запрещённых. Остальные незаглобальные блоки (`100::/64`,
 *     `64:ff9b:1::/48`, `5f00::/16`) лежат вне 2000::/3 и отсекались и раньше;
 *   — сервис метаданных: 169.254.169.254 — в документации AWS (и IPv6 `fd00:ec2::254`, он
 *     внутри `fc00::/7`), Google Cloud и Azure;
 *   — CVE-2025-29927: GHSA-f82v-jwr5-mffw (опубликован 2025-03-21), исправлено в 15.2.3,
 *     14.2.25, 13.5.9, 12.3.5;
 *   — Server Actions: nextjs.org/docs/app/guides/data-security — «reachable via a direct POST
 *     request»;
 *   — префиксы: документация Vite, Next.js и Astro подтверждают подстановку в клиентский код;
 *     у Nuxt иначе — `NUXT_PUBLIC_*` лишь переопределяет ключ `runtimeConfig.public`, и значение
 *     едет в полезной нагрузке страницы, а не строкой в бандле (docs/3.guide/6.going-further/
 *     10.runtime-config.md в nuxt/nuxt) — **уточнено** в `SECRETS_NOTE`;
 *   — `Agent` из undici с `connect.lookup`: **прогнано** тестом на undici 8.10.2 (приходит
 *     с Astro) — та же `guardLookup`, свой сервер 127.0.0.1;
 *   — OWASP: API Security Top 10 2023, Top 10 2021 и **2025** (вышла после черновика темы:
 *     SSRF там уже внутри A01), семь шпаргалок — страницы открыты.
 */

/* ──────────────────── Вводный раздел ──────────────────── */

export const INTRO_THESIS =
  'Сервер не знает, какие кнопки показал интерфейс. Он видит запрос — метод, адрес, заголовки и тело, — и любой из них может прийти не из вашего фронта, а из `curl`. Поэтому каждая проверка, которая защищает данные, живёт в обработчике: **кто спрашивает, его ли это объект, какие поля ему можно менять и куда сервер пойдёт по его просьбе.**';

export const PLAIN_SERVER =
  'Фронт — это витрина и бланки заказа. Сервер — склад. Покупатель может заполнить бланк от руки, вписать чужой номер заказа и лишнюю графу «скидка 100%». Склад, который верит бланку, потому что «на витрине такой графы не было», отгрузит что угодно.';

export const GLOSSARY = [
  {
    k: 'аутентификация и авторизация',
    d: 'Аутентификация отвечает «кто это» — сессия, токен. Авторизация отвечает «можно ли ему **это**» — конкретный заказ, конкретное поле. Большинство дыр этой темы — не в первой, а во второй.',
  },
  {
    k: 'BFF',
    d: 'Backend for Frontend: серверный слой, который пишет команда фронта под свой интерфейс, — API-роуты Next, Nuxt и Astro, серверные функции. Это настоящий сервер, со своими секретами и доступом во внутреннюю сеть.',
  },
  {
    k: 'IDOR',
    d: 'Insecure Direct Object Reference: сервер отдаёт или меняет объект по id из запроса, не проверив, что объект принадлежит спрашивающему. В OWASP API Top 10 — первая строка, Broken Object Level Authorization.',
  },
  {
    k: 'SSRF',
    d: 'Server-Side Request Forgery: сервер сам идёт по адресу, который прислал пользователь, — и попадает туда, куда пользователю снаружи хода нет: в `localhost`, во внутреннюю сеть, в сервис метаданных облака.',
  },
  {
    k: 'резолв',
    d: 'Превращение имени (`hooks.example.com`) в IP-адреса через DNS. Ответ выбирает владелец домена, и он вправе ответить `127.0.0.1`. Поэтому проверка имени ничего не говорит о том, куда пойдёт соединение.',
  },
  {
    k: 'частные и служебные адреса',
    d: '`10/8`, `172.16/12`, `192.168/16` — внутренние сети; `127/8` и `::1` — сама машина; `169.254/16` — link-local, где в облаках отвечает сервис метаданных; `fc00::/7` — частные адреса IPv6. Снаружи до них не дойти, а с сервера — можно.',
  },
  {
    k: 'middleware',
    d: 'Код, который фреймворк запускает перед обработчиком для каждого запроса, подходящего по пути: проверить сессию, переписать адрес, добавить заголовок. О самом объекте запроса — чей это заказ — он обычно ничего не знает.',
  },
  {
    k: 'параметризованный запрос',
    d: 'Текст SQL с метками `?`, значения к которым передаются отдельно. База разбирает текст один раз, и значение остаётся значением, какие бы кавычки в нём ни стояли.',
  },
  {
    k: 'массовое присваивание',
    d: 'Mass assignment: тело запроса целиком копируется в запись. Клиент дописывает поле, которого нет в форме, — `role`, `id`, `isAdmin`, — и сервер его сохраняет.',
  },
];

/* ──────────────────── Перед началом ──────────────────── */

export const PREREQ = [
  {
    t: 'Сессия, куки и токен',
    d: 'Как сервер узнаёт пользователя по запросу: кука сессии, `HttpOnly`, JWT. Здесь `req.user` — готовый результат этого шага; тема начинается там, где он заканчивается.',
    href: '/platform/security/#s6',
    hrefLabel: '«Безопасность фронтенда», раздел «Куки и JWT для фронта»',
    tone: 'info' as const,
  },
  {
    t: 'Источник, сайт и CORS',
    d: 'Что браузер запрещает страницам. Серверу он не запрещает ничего: CORS защищает чтение ответа в браузере, а не обработчик от запроса.',
    href: '/platform/security/#s2',
    hrefLabel: '«Безопасность фронтенда», раздел «CORS и preflight»',
    tone: 'warn' as const,
  },
  {
    t: 'Схема валидации',
    d: 'Объект, который проверяет значение при выполнении и отдаёт тип компилятору, — на примере zod. Здесь схема — список полей, которые клиент вправе прислать.',
    href: '/tooling/typescript/#s6',
    hrefLabel: '«TypeScript на уровне типов», подраздел «Схема вместо предиката»',
    tone: 'ok' as const,
  },
  {
    t: 'Lock-файл и `integrity`',
    d: 'Что фиксирует `package-lock.json` и чем `npm ci` отличается от `npm install`. В разделе про цепочку поставок это используется без объяснений.',
    href: '/tooling/package-managers/#s3',
    hrefLabel: '«Пакетные менеджеры», раздел «Lock-файл»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Сквозной пример ──────────────────── */

/**
 * База магазина — на ней стоят разделы про доступ к объектам и про SQL. Её же создаёт тест
 * (строка исполняется как есть, импорт подставлен настоящим `node:sqlite`).
 */
export const SEED_CODE = `import { DatabaseSync } from 'node:sqlite';

// Магазин: два покупателя, три заказа. На этой базе стоят все примеры темы.
const db = new DatabaseSync(':memory:');
db.exec(\`
  CREATE TABLE users  (id TEXT PRIMARY KEY, name TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
                       role TEXT NOT NULL DEFAULT 'user');
  CREATE TABLE orders (id INTEGER PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users,
                       status TEXT NOT NULL, total INTEGER NOT NULL);
  INSERT INTO users (id, name) VALUES ('u1', 'Алиса'), ('u2', 'Борис');
  INSERT INTO orders VALUES (1, 'u1', 'new', 1200), (2, 'u1', 'paid', 540), (3, 'u2', 'new', 99);
\`);`;

/** Учётная запись Алисы — та же, что строка `u1` в `SEED_CODE`. Её меняет раздел про лишние поля. */
export const ALICE = { id: 'u1', name: 'Алиса', bio: '', role: 'user' };

/* ──────────────────── Раздел 1 · доступ к объекту по id ──────────────────── */

export const PLAIN_IDOR =
  'Камера хранения выдаёт сумку по номеру ячейки и не спрашивает квитанцию. Номер написан на жетоне, жетоны идут подряд — и чтобы забрать чужую сумку, достаточно назвать соседний номер. Скрыть от посетителя табличку с номерами не поможет: проверять надо квитанцию на выдаче.';

export const NAIVE_IDOR_CODE = `// ✗ Владельца проверяет один обработчик из двух
async function getOrder(req, db) {
  if (!req.user) return { status: 401 };
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.owner_id !== req.user.id) return { status: 404 };
  return { status: 200, body: order };
}

// «У чужого заказа на фронте нет кнопки „Отменить“» — значит, и проверка не нужна
async function cancelOrder(req, db) {
  if (!req.user) return { status: 401 };
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return { status: 404 };
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(order.id);
  return { status: 200 };
}

const handlers = { getOrder, cancelOrder };`;

export const SAFE_IDOR_CODE = `// ✓ Заказ достаётся только парой «id и владелец» — одной функцией для всех обработчиков.
//   Чужой и несуществующий неразличимы: оба 404, перебор id ничего не сообщает.
function findOwnOrder(db, user, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ? AND owner_id = ?').get(id, user.id) ?? null;
}

async function getOrder(req, db) {
  if (!req.user) return { status: 401 };
  const order = findOwnOrder(db, req.user, req.params.id);
  if (!order) return { status: 404 };
  return { status: 200, body: order };
}

async function cancelOrder(req, db) {
  if (!req.user) return { status: 401 };
  const order = findOwnOrder(db, req.user, req.params.id);
  if (!order) return { status: 404 };
  if (order.status !== 'new') return { status: 409 };
  // и сама запись — с тем же условием на владельца
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND owner_id = ?")
    .run(order.id, req.user.id);
  return { status: 200 };
}

const handlers = { getOrder, cancelOrder };`;

/** Тест читателя: зелёный на `SAFE_IDOR_CODE`, красный на `NAIVE_IDOR_CODE` — это проверяет наш тест. */
export const CHECK_IDOR_CODE = `// Тест на свои обработчики: каждый пользователь просит чужое.
// Проверяется ответ сервера, а не наличие кнопки в интерфейсе.
const alice = { id: 'u1' };
const bob = { id: 'u2' };
const foreign = [
  ['getOrder', bob, '1'],       // заказ 1 — Алисы
  ['cancelOrder', bob, '1'],
  ['getOrder', alice, '3'],     // заказ 3 — Бориса
  ['cancelOrder', alice, '3'],
];
for (const [name, user, id] of foreign) {
  const res = await handlers[name]({ user, params: { id } }, db);
  assert.equal(res.status, 404, \`\${name}(\${id}) от \${user.id}\`);
}
// и чужие заказы не изменились
const statuses = db.prepare('SELECT status FROM orders ORDER BY id').all().map((o) => o.status);
assert.deepEqual(statuses, ['new', 'paid', 'new']);`;

/**
 * Таблица на странице. `safe` и `naive` — ответы обработчиков; тест вызывает их на свежей базе
 * и сверяет с литералом. `id` приходит строкой, как из адреса: `/api/orders/1`.
 */
export const IDOR_CASES: {
  who: 'u1' | 'u2' | null;
  call: 'getOrder' | 'cancelOrder';
  id: string;
  safe: number;
  naive: number;
  note: string;
}[] = [
  { who: 'u1', call: 'getOrder', id: '1', safe: 200, naive: 200, note: 'свой заказ' },
  { who: null, call: 'getOrder', id: '1', safe: 401, naive: 401, note: 'без сессии' },
  { who: 'u1', call: 'getOrder', id: '3', safe: 404, naive: 404, note: 'чужой — тот же ответ, что и несуществующий' },
  { who: 'u1', call: 'getOrder', id: '99', safe: 404, naive: 404, note: 'такого нет' },
  { who: 'u1', call: 'cancelOrder', id: '1', safe: 200, naive: 200, note: 'свой, статус `new`' },
  { who: 'u2', call: 'cancelOrder', id: '1', safe: 404, naive: 200, note: '**чужой заказ отменён** — кнопки не было, запрос был' },
  { who: 'u1', call: 'cancelOrder', id: '3', safe: 404, naive: 200, note: '**то же в обратную сторону**' },
];

export const IDOR_WHO: Record<string, string> = { u1: 'Алиса', u2: 'Борис', null: 'аноним' };

export const IDOR_NOTES = [
  '**Проверка — в запросе к базе, а не после него.** `WHERE id = ? AND owner_id = ?` не даёт получить чужую строку вовсе. Сравнение `order.owner_id !== req.user.id` после выборки работает, пока его не забыли, — а забывают его во втором, третьем, десятом обработчике. Одна функция доступа на все обработчики превращает «не забыть» в «нельзя обойти».',
  '**404, а не 403.** Ответ 403 на чужой id подтверждает, что объект существует, и перебор id превращается в опись чужих заказов. 404 на «чужое» и на «нет такого» неотличимы.',
  '**Непредсказуемые id — не защита.** UUID вместо `1, 2, 3` усложняет перебор, но id утекают в ссылках, журналах, письмах и заголовке `Referer`. Проверка владельца нужна всё равно; случайный id лишь добавляет второй слой.',
];

/* ──────────────────── Раздел 2 · исходящий запрос на адрес пользователя ──────────────────── */

export const PLAIN_SSRF =
  'Курьер компании носит пропуск во все внутренние помещения. Клиент по телефону диктует адрес: «заберите посылку из комнаты 127». Курьер не проверяет, что комната 127 — серверная его же офиса: адрес продиктован, пропуск есть. Защита — не список «плохих» слов в адресе, а правило курьера: **заходить только в помещения для посетителей** — и проверять это на месте, у самой двери.';

export const NAIVE_EGRESS_CODE = `// ✗ Чёрный список строк
const BLOCKED = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]'];

function naiveCheck(input) {
  const host = new URL(input).hostname;
  if (BLOCKED.includes(host) || host.startsWith('10.') || host.startsWith('192.168.')) {
    return { ok: false, reason: \`\${host} в чёрном списке\` };
  }
  return { ok: true };
}`;

/**
 * Защитная проверка адреса. Та же строка напечатана в теме, исполняется демо
 * (`widgets/bs-egress-check/model/run.ts`) и тестом. Без импортов — поэтому и в браузере.
 */
export const EGRESS_CODE = `// Проверка адреса для исходящего запроса: вебхук, превью ссылки, импорт по URL.
// Сначала адрес как строка, потом — каждый IP, в который он превратился.

const fail = (stage, reason) => ({ ok: false, stage, reason });
const blocked = (reason) => Object.assign(new Error(reason), { code: 'EGRESS_BLOCKED' });

// 1. Строка. Разбирает тот же парсер, что и fetch: '2130706433', '0x7f.1'
//    и '①②⑦.0.0.1' он превращает в '127.0.0.1' — проверять надо его вывод.
function checkUrl(input, allowHosts) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return fail('url', 'не разбирается как URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('url', \`схема \${url.protocol} запрещена\`);
  }
  if (url.username || url.password) return fail('url', 'логин и пароль в адресе запрещены');
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return fail('url', \`порт \${url.port} запрещён\`);
  }
  const host = url.hostname.replace(/\\.$/, '');    // 'localhost.' — то же имя, что 'localhost'
  if (allowHosts && !allowHosts.includes(host)) {
    return fail('url', \`хоста \${host} нет в списке разрешённых\`);
  }
  return { ok: true, url, host };
}

// Адрес-литерал парсер уже нормализовал: '[::ffff:7f00:1]' или '127.0.0.1'
function literalIp(host) {
  if (host.startsWith('[')) return host.slice(1, -1);
  return /^\\d+\\.\\d+\\.\\d+\\.\\d+$/.test(host) ? host : null;
}

// 2. Адрес. Разрешён только глобальный; всё остальное — с причиной.
const V4_BLOCKED = [
  ['0.0.0.0', 8, '«эта сеть»: 0.0.0.0 ведёт на саму машину'],
  ['10.0.0.0', 8, 'частная сеть'],
  ['100.64.0.0', 10, 'адреса провайдера (CGNAT)'],
  ['127.0.0.0', 8, 'петля: сама машина'],
  ['169.254.0.0', 16, 'link-local: здесь отвечает сервис метаданных облака'],
  ['172.16.0.0', 12, 'частная сеть'],
  ['192.0.0.0', 24, 'служебный блок'],
  ['192.0.2.0', 24, 'документация'],
  ['192.168.0.0', 16, 'частная сеть'],
  ['198.18.0.0', 15, 'стенды для замеров'],
  ['198.51.100.0', 24, 'документация'],
  ['203.0.113.0', 24, 'документация'],
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'зарезервировано, вместе с 255.255.255.255'],
];

function v4ToInt(ip) {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

function v4Problem(ip) {
  const n = v4ToInt(ip);
  for (const [net, bits, why] of V4_BLOCKED) {
    const size = 2 ** (32 - bits);
    if (Math.floor(n / size) === Math.floor(v4ToInt(net) / size)) return \`\${net}/\${bits} — \${why}\`;
  }
  return null;
}

// '::ffff:7f00:1' → [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]
function v6Groups(ip) {
  let s = ip.split('%')[0].toLowerCase();                  // 'fe80::1%en0' — без зоны
  const tail = s.match(/(\\d+\\.\\d+\\.\\d+\\.\\d+)$/);             // '::ffff:1.2.3.4'
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const [head, rest] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = rest ? rest.split(':') : [];
  const zeros = s.includes('::') ? 8 - a.length - b.length : 0;
  return [...a, ...Array(zeros).fill('0'), ...b].map((g) => parseInt(g, 16));
}

const v4At = (g, i) => \`\${g[i] >> 8}.\${g[i] & 255}.\${g[i + 1] >> 8}.\${g[i + 1] & 255}\`;

// Внутри IPv6 спрятан IPv4 — решает он
function wrapped(kind, v4) {
  const problem = v4Problem(v4);
  return problem ? \`\${kind} с \${v4} внутри: \${problem}\` : null;
}

function v6Problem(ip) {
  const g = v6Groups(ip);
  if (g.length !== 8 || g.some(Number.isNaN)) return 'не разбирается как IPv6';
  const zeroTo = (k) => g.slice(0, k).every((x) => x === 0);
  if (zeroTo(8)) return ':: — «никакой адрес», ведёт на саму машину';
  if (zeroTo(7) && g[7] === 1) return '::1 — петля: сама машина';
  if (zeroTo(5) && g[5] === 0xffff) return wrapped('::ffff:0:0/96', v4At(g, 6));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return wrapped('NAT64 64:ff9b::/96', v4At(g, 6));
  }
  if (zeroTo(6)) return '::/96 — устаревший IPv4-совместимый адрес';
  if ((g[0] & 0xfe00) === 0xfc00) return 'fc00::/7 — частная сеть IPv6 (ULA)';
  if ((g[0] & 0xffc0) === 0xfe80) return 'fe80::/10 — link-local';
  if ((g[0] & 0xff00) === 0xff00) return 'ff00::/8 — multicast';
  if ((g[0] & 0xe000) !== 0x2000) return 'вне 2000::/3 — не глобальный адрес';
  if (g[0] === 0x2001 && g[1] === 0x0db8) return '2001:db8::/32 — документация';
  if (g[0] === 0x3fff && g[1] < 0x1000) return '3fff::/20 — документация';
  if (g[0] === 0x2001 && g[1] === 0) return '2001::/32 — туннель Teredo';
  if (g[0] === 0x2001 && g[1] === 2 && g[2] === 0) return '2001:2::/48 — стенды для замеров';
  if (g[0] === 0x2002) return wrapped('6to4 2002::/16', v4At(g, 1));
  return null;
}

function addressProblem(ip) {
  return ip.includes(':') ? v6Problem(ip) : v4Problem(ip);
}

// Итог для адреса и ответа DNS. Годны должны быть ВСЕ адреса ответа:
// клиент вправе соединиться с любым из них.
function checkOutgoing(input, dnsAnswer, allowHosts) {
  const target = checkUrl(input, allowHosts);
  if (!target.ok) return target;
  const literal = literalIp(target.host);
  const addresses = literal ? [literal] : dnsAnswer;
  if (addresses.length === 0) return fail('dns', \`\${target.host} не резолвится\`);
  for (const ip of addresses) {
    const problem = addressProblem(ip);
    if (problem) return fail(literal ? 'ip' : 'dns', \`\${ip}: \${problem}\`);
  }
  return { ok: true, host: target.host, addresses };
}

// 3. Соединение. Проверка живёт внутри lookup — запрос уйдёт ровно на тот адрес,
//    который её прошёл. Отдельный резолв «для проверки» оставляет окно:
//    второй ответ DNS может быть другим (DNS rebinding).
//    http.get(url, { lookup: guardLookup(dns.lookup) })
function guardLookup(lookup) {
  return (hostname, options, callback) => {
    lookup(hostname, { ...options, all: true }, (err, answers) => {
      if (err) return callback(err);
      const bad = answers.find((a) => addressProblem(a.address));
      if (bad) return callback(blocked(\`\${hostname} → \${bad.address}: \${addressProblem(bad.address)}\`));
      if (options.all) return callback(null, answers);
      callback(null, answers[0].address, answers[0].family);
    });
  };
}

// 4. Редирект — новый адрес, выбранный чужим сервером. Он проходит проверку заново.
//    fetch здесь — собранный с guardLookup: имена проверяются при соединении.
async function fetchChecked(input, { fetch, allowHosts, maxHops = 3 }) {
  let url = input;
  for (let hop = 0; hop <= maxHops; hop++) {
    const target = checkUrl(url, allowHosts);
    if (!target.ok) throw blocked(target.reason);
    const literal = literalIp(target.host);
    if (literal && addressProblem(literal)) throw blocked(\`\${literal}: \${addressProblem(literal)}\`);
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status > 399 || !location) return res;
    url = new URL(location, url).href;
  }
  throw blocked('слишком много редиректов');
}`;

export const NAIVE_FETCH_CODE = `// ✗ Проверили первый адрес — и отдали fetch, который сам идёт по редиректам
async function naiveFetch(input, { fetch }) {
  if (!naiveCheck(input).ok) throw new Error('адрес запрещён');
  return fetch(input);
}`;

/** Разрешённые хосты в режиме «только партнёр» — у демо и у таблицы. */
export const ALLOW_HOSTS = ['hooks.example.com'];

/** Ответы DNS, которые можно выбрать в демо. Адреса — литералы, резолва нет. */
export const DNS_CHOICES: DnsChoice[] = [
  { id: 'public4', label: '93.184.215.14', addresses: ['93.184.215.14'] },
  { id: 'public6', label: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', addresses: ['2606:2800:21f:cb07:6820:80da:af6b:8b2c'] },
  { id: 'loop', label: '127.0.0.1', addresses: ['127.0.0.1'] },
  { id: 'private', label: '10.0.0.5', addresses: ['10.0.0.5'] },
  { id: 'meta', label: '169.254.169.254', addresses: ['169.254.169.254'] },
  { id: 'ula', label: 'fd00::1', addresses: ['fd00::1'] },
  { id: 'mixed', label: '93.184.215.14 и 127.0.0.1', addresses: ['93.184.215.14', '127.0.0.1'] },
];

/**
 * Таблица случаев. `dns` — id ответа из `DNS_CHOICES` (для адресов-литералов не используется),
 * `safe` и `naive` — решения двух проверок, `stage` — на каком шаге отказала защитная.
 * Тест прогоняет обе функции и сверяет с литералом; строки, где `naive` ≠ `safe`, закреплены
 * отдельно — это и есть доказательство, что чёрный список не работает.
 */
export const EGRESS_CASES: EgressCase[] = [
  { label: 'публичный хост', url: 'https://hooks.example.com/in', dns: 'public4', safe: 'ok', naive: 'ok' },
  { label: 'публичный IPv6', url: 'https://[2606:2800:21f:cb07:6820:80da:af6b:8b2c]/', dns: 'public4', safe: 'ok', naive: 'ok' },
  { label: '127.0.0.1', url: 'http://127.0.0.1/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: '127.0.0.2', url: 'http://127.0.0.2/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'ok' },
  { label: 'число вместо адреса', url: 'http://2130706433/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: '0 — это 0.0.0.0', url: 'http://0/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: 'localhost с точкой', url: 'http://localhost./', dns: 'loop', safe: 'block', stage: 'dns', naive: 'ok' },
  { label: '[::1]', url: 'http://[::1]/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: 'IPv4 внутри IPv6', url: 'http://[::ffff:127.0.0.1]/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'ok' },
  { label: '10.0.0.5', url: 'http://10.0.0.5/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: '172.16.0.5', url: 'http://172.16.0.5/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'ok' },
  { label: 'метаданные облака', url: 'http://169.254.169.254/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'block' },
  { label: 'fd00::1', url: 'http://[fd00::1]/', dns: 'public4', safe: 'block', stage: 'ip', naive: 'ok' },
  { label: 'имя → частный адрес', url: 'https://hooks.example.com/in', dns: 'private', safe: 'block', stage: 'dns', naive: 'ok' },
  { label: 'имя → два адреса', url: 'https://hooks.example.com/in', dns: 'mixed', safe: 'block', stage: 'dns', naive: 'ok' },
  { label: 'порт 6379', url: 'https://hooks.example.com:6379/', dns: 'public4', safe: 'block', stage: 'url', naive: 'ok' },
  { label: 'схема file:', url: 'file:///etc/passwd', dns: 'public4', safe: 'block', stage: 'url', naive: 'ok' },
];

/** Что парсер URL делает с хостом — закреплено тестом на `new URL`. */
export const PARSER_ROWS: { input: string; host: string }[] = [
  { input: 'http://2130706433/', host: '127.0.0.1' },
  { input: 'http://0x7f.1/', host: '127.0.0.1' },
  { input: 'http://017700000001/', host: '127.0.0.1' },
  { input: 'http://①②⑦.0.0.1/', host: '127.0.0.1' },
  { input: 'http://0/', host: '0.0.0.0' },
  { input: 'http://[::ffff:127.0.0.1]/', host: '[::ffff:7f00:1]' },
  { input: 'http://LOCALHOST./', host: 'localhost.' },
];

export const PARSER_NOTE =
  'Парсер URL в Node и в браузере один — WHATWG URL, — и он переписывает хост до того, как его увидит проверка. Отсюда правило: **сравнивать то, что вернул парсер, а не исходную строку**, и разбирать тем же парсером, что отправит запрос. Чёрный список `naiveCheck` смотрит в `hostname` и потому ловит пять строк таблицы из семи — кроме `[::ffff:7f00:1]` и `localhost.`. А того, что ответит DNS на обычное имя, не видит ни одна проверка строки.';

export const EGRESS_STEPS = [
  '**Схема и порт.** Только `http:` и `https:`, только 80 и 443. `file:`, `gopher:` и порт `6379` внутреннего Redis отсекаются до всякого DNS.',
  '**Хост из списка, если список возможен.** Запросы к партнёру — только на его имена. Для вебхуков и превью ссылок списка нет, и вся защита — в следующем шаге.',
  '**Каждый адрес из ответа DNS — глобальный.** Разрешено то, что точно публично; всё остальное — с причиной. Годны должны быть все адреса: клиент вправе выбрать любой.',
  '**Проверка там, где соединение.** `guardLookup` стоит в `lookup` самого запроса: адрес, прошедший проверку, и адрес соединения — одно значение.',
  '**Редирект — новый адрес.** `redirect: \'manual\'` и та же проверка на каждый переход. `fetch` по умолчанию идёт по редиректам сам, и проверка первого адреса ничего не стоит.',
];

export const EGRESS_DEMO_CAPTION =
  'Обе проверки — строки кода выше, исполненные в вашем браузере; ответ DNS выбран вручную, в сеть демо не ходит. Хост разбирает `new URL` браузера — тот же парсер, что у `fetch`.';

export const REBIND_NOTE =
  '**Почему проверить имя заранее недостаточно.** `checkOutgoing` спрашивает DNS, получает `93.184.215.14`, одобряет — а потом `fetch` резолвит имя **второй раз**. Владелец домена отвечает с TTL 0 («не запоминать ответ») и во второй раз говорит `127.0.0.1`. Это DNS rebinding, и лечится он не второй проверкой, а тем, что проверка и соединение пользуются **одним** ответом: `guardLookup` для `node:http`, `Agent` из undici с `connect.lookup` для `fetch` — одна и та же функция в обоих местах.';

/**
 * Один вебхук — четыре уровня проверки. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. `REBIND_NOTE` одним абзацем говорил, почему проверка заранее
 * не спасает, но не показывал, где именно адрес меняется между проверкой и соединением
 * и что закрывает каждый уровень защиты. Тема защитная: здесь нет ничего сверх того, что
 * уже утверждают `EGRESS_STEPS`, `REBIND_NOTE`, `GUARD_RUN_NOTE` и таблица `EGRESS_CASES`;
 * все четыре исхода исполняет `tests/unit/backend-security.test.ts` (строки `naiveCheck`
 * по таблице, `guardLookup` на своём сервере 127.0.0.1 и в `Agent` undici, `fetchChecked`
 * на поддельном `fetch` с редиректом).
 */
export const HOOK_SCENE_CODE = `// Пользователь сохраняет вебхук:
POST /api/webhooks   { "url": "https://hooks.example.com/notify" }

// Позже сервер шлёт туда событие «заказ оплачен».
// Имя hooks.example.com принадлежит пользователю: какой IP за ним стоит,
// решает он, и ответ DNS может меняться от запроса к запросу.`;

export const HOOK_SCENE_NOTE =
  'Что проверять, если смотреть **только на строку**. В ней нет ни `localhost`, ни `127.`, ни `169.254` — обычное внешнее имя. Но сервер соединяется не со строкой, а с IP, который вернул DNS, и этот IP назначает владелец имени. Между «проверили» и «соединились» у адреса есть три места, где он может стать другим: ответ DNS, **второй** ответ DNS и редирект. Каждый уровень проверки ниже закрывает одно из них.';

export const HOOK_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Чёрный список строк',
    when: '`naiveCheck` смотрит на текст адреса',
    what: 'Строка `https://hooks.example.com/notify` проходит: запрещённых слов в ней нет. Если имя отвечает частным адресом, строка остаётся той же самой — в таблице выше строки «имя → частный адрес» и «имя → два адреса» у `naiveCheck` обе «можно».',
    cost: 'Не закрывает ничего из трёх мест: DNS в проверке не участвует вовсе. И даже как список строк он всегда короче реестра: в той же таблице `naiveCheck` пропускает `127.0.0.2`, `172.16.0.5`, `[::ffff:127.0.0.1]` и `localhost.` с точкой.',
  },
  {
    k: 'Проверить IP заранее, потом `fetch`',
    when: '`checkOutgoing` резолвит имя и проверяет каждый адрес, затем обычный `fetch`',
    what: 'Первое место закрыто: частный адрес в ответе DNS проверка видит и отказывает. Но `fetch` резолвит имя **заново**. Проверка одобрила один ответ, соединение получило другой — если владелец имени ответил по-разному, до сервера дойдёт то, что проверка не видела.',
    cost: 'Вторая проверка перед `fetch` дела не меняет: между ней и соединением остаётся тот же зазор. Лечится не числом проверок, а тем, чтобы проверка и соединение пользовались одним ответом.',
  },
  {
    k: 'Проверка в `lookup` соединения',
    when: '`guardLookup` передан в `lookup` у `http.get` или в `connect.lookup` у `Agent` из undici',
    what: 'Имя резолвит само соединение, и тот же ответ, прежде чем по нему соединиться, проходит проверку. Проверенный адрес и адрес соединения — одно значение, второго ответа нет. На стенде: без `guardLookup` запрос дошёл до сервера на `127.0.0.1` (счётчик 1), с ним — `EGRESS_BLOCKED`, счётчик не сдвинулся.',
    cost: 'Защищены только запросы, собранные с этим `lookup` или этим `Agent`. Библиотека, которая делает свой `fetch` без него, мимо проверки. И редирект — это уже новый адрес.',
  },
  {
    k: 'Каждый редирект — новая проверка',
    when: '`fetchChecked`: `redirect: \'manual\'` и та же проверка на каждый переход',
    what: 'Ответ `302` на `http://169.254.169.254/` не выполняется сам: `fetchChecked` берёт адрес из `Location`, проверяет его как новый — и останавливается. `naiveFetch` на том же поддельном `fetch` идёт по редиректу, потому что `fetch` по умолчанию следует за ними сам.',
    cost: 'Цикл переходов и лимит на их число (`maxHops`) — ваш код. Зато третье место закрыто: адрес, который сервер получил от чужого сервера, проверяется так же, как адрес от пользователя.',
  },
];

export const GUARD_RUN_NOTE =
  'Сети для такого теста не нужно. Поднимите в тесте свой HTTP-сервер на `127.0.0.1`, который считает дошедшие запросы, и подмените «DNS» функцией, отвечающей на `hooks.example.com` адресом `127.0.0.1`. Без `guardLookup` запрос доходит — счётчик 1. С ним `http.get` падает с `EGRESS_BLOCKED`, и счётчик не двигается. Редиректы проверяются поддельным `fetch`, который отвечает 302 на `http://169.254.169.254/`: `naiveFetch` идёт по нему, `fetchChecked` останавливается на первом ответе.';

/* ──────────────────── Раздел 3 · инъекции ──────────────────── */

export const PLAIN_PARAMS =
  'Склейка — это письмо, продиктованное целиком: «Выдайте заказы клиента Алиса». Если клиент назовётся «Алиса, а также всех остальных», письмо так и запишут. Параметры — это бланк с полем «имя клиента»: что бы ни вписали в поле, оно остаётся именем и не становится новым пунктом бланка.';

export const NAIVE_SQL_CODE = `// ✗ Склейка: значение становится частью текста SQL
function findOrders(db, userId, status) {
  return db
    .prepare(\`SELECT id, owner_id FROM orders WHERE owner_id = '\${userId}' AND status = '\${status}'\`)
    .all();
}`;

export const SAFE_SQL_CODE = `// ✓ Параметры: текст запроса один и тот же, значения едут отдельно
function findOrders(db, userId, status) {
  return db
    .prepare('SELECT id, owner_id FROM orders WHERE owner_id = ? AND status = ?')
    .all(userId, status);
}

// Имя столбца параметром не передать — только выбором из своего списка
const SORTABLE = new Map([['date', 'id'], ['total', 'total']]);

function listOrders(db, userId, sort) {
  const column = SORTABLE.get(sort) ?? 'id';
  return db.prepare(\`SELECT id FROM orders WHERE owner_id = ? ORDER BY \${column}\`).all(userId);
}`;

export const CHECK_SQL_CODE = `// Тест: кавычки и синтаксис SQL в значении — просто данные
const tricky = ["O'Brien", "new' OR '1'='1", "new'; DROP TABLE orders; --"];
for (const status of tricky) {
  assert.deepEqual(findOrders(db, 'u1', status), []);
}
assert.equal(db.prepare('SELECT count(*) AS n FROM orders').get().n, 3);`;

/** Что сделала склейка на сквозной базе — сверено тестом. */
export const SQL_RUN: { value: string; naive: string; safe: string; tone?: 'err' | 'warn' }[] = [
  { value: '`new`', naive: 'заказ 1', safe: 'заказ 1' },
  { value: '`O\'Brien`', naive: 'ошибка SQLite: `near "Brien": syntax error`', safe: 'пусто', tone: 'warn' },
  { value: '`new\' OR \'1\'=\'1`', naive: 'заказы 1, 2 **и 3 — Бориса**', safe: 'пусто', tone: 'err' },
];

export const SQL_NOTES = [
  '**Склейка ломается и на честных данных.** Фамилия с апострофом — не атака, а обычный покупатель, и для него поиск падает с ошибкой синтаксиса. Параметры чинят обе беды одним движением.',
  '**Плейсхолдер — только для значения.** Имя столбца, направление сортировки и имя таблицы параметром не передаются: `ORDER BY ?` с `\'total\'` сортирует по строковой константе, то есть никак, и не жалуется. Такие части запроса выбираются из своего списка.',
  '**ORM и построители запросов параметризуют сами** — пока вы не ушли в «сырой» режим: `$queryRawUnsafe`, `sql.raw`, `knex.raw` со склеенной строкой возвращают ровно проблему из примера. Тегированный шаблон `sql` у тех же библиотек подставляет значения параметрами, а не склеивает.',
];

export const ESCAPE_CODE = `// Сервер собирает HTML строкой — письмо, отчёт, страницу ошибки.
// Каждое значение экранируется; тегированный шаблон делает это за вас.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);

const html = (strings, ...values) =>
  strings.reduce((out, s, i) => out + escapeHtml(values[i - 1]) + s);

const letter = (user) => html\`<p>Здравствуйте, \${user.name}!</p><a title="\${user.bio}">профиль</a>\`;`;

export const ESCAPE_NOTE =
  'Шаблоны React, Vue и Astro экранируют сами — пока значение не ушло в `dangerouslySetInnerHTML`, `v-html` или `set:html`. Экранирование закрывает текст и атрибут в кавычках, но не `href="javascript:…"` и не содержимое `<script>`: там нужен разбор значения, а не замена символов. Как такие строки становятся кодом в браузере и чем от этого страхует CSP — в [«Безопасности фронтенда», раздел «XSS»](/platform/security/#s4).';

export const NAIVE_EXEC_CODE = `import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const sh = promisify(exec);

// ✗ Строка для оболочки: ; | $( ) в имени файла — это команды
async function countLines(dir, name) {
  const { stdout } = await sh(\`wc -l \${name}\`, { cwd: dir });
  return Number.parseInt(stdout, 10);
}`;

export const SAFE_EXEC_CODE = `import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// ✓ Программа и аргументы — массивом: оболочки нет, ; | $( ) остаются буквами имени.
//   '--' отделяет имя от флагов: файл с именем '-w' не станет опцией
async function countLines(dir, name) {
  const { stdout } = await run('wc', ['-l', '--', name], { cwd: dir });
  return Number.parseInt(stdout, 10);
}`;

export const CHECK_EXEC_CODE = `import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Тест: имя файла с символами оболочки остаётся именем
const dir = mkdtempSync(join(tmpdir(), 'wc-'));
writeFileSync(join(dir, 'report.txt'), 'a\\nb\\nc\\n');
writeFileSync(join(dir, '-w'), 'a\\nb\\n');

assert.equal(await countLines(dir, 'report.txt'), 3);
await assert.rejects(countLines(dir, 'report.txt; touch marker'));   // такого файла нет
assert.equal(existsSync(join(dir, 'marker')), false);                // и команда не выполнилась
assert.equal(await countLines(dir, '-w'), 2);                         // имя, а не флаг`;

export const EXEC_NOTE =
  '**Наивная версия не падает — она молча выполняет вторую команду.** На имени `report.txt; touch marker` она вернула честные 3 строки, а файл `marker` в каталоге появился: результат выглядит правильным, и только побочный эффект выдаёт, что оболочка разобрала имя. Защищённая версия получила от `wc` «нет такого файла» и отказала.';

/* ──────────────────── Раздел 4 · лишние поля в теле запроса ──────────────────── */

export const PLAIN_MASS =
  'Регистратура переписывает в карту пациента всё, что стоит в анкете. Пациент дописал от руки строку «допущен к работе без ограничений» — и она попала в карту: графы такой в бланке не было, но регистратор переносит листок целиком. Правильный регистратор берёт из анкеты только графы из своего списка и проверяет, что в графе «возраст» стоит число.';

export const NAIVE_MASS_CODE = `// ✗ Тело запроса целиком — в запись пользователя
function updateProfile(user, body) {
  return Object.assign(user, body);
}`;

export const SAFE_MASS_CODE = `import { z } from 'zod';

// ✓ Схема — список того, что клиент вправе менять, с типами и пределами.
//   Остальные ключи zod отбрасывает; .strict() вместо этого откажет с ошибкой.
const ProfilePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
});

function updateProfile(user, body) {
  const patch = ProfilePatch.parse(body);      // ZodError → ответ 400
  return { ...user, ...patch };
}`;

/** Без библиотеки — её исполняет второе демо. */
export const PICK_CODE = `// То же без библиотеки: список имён. Типы и длины он не проверяет — только имена.
const EDITABLE = ['name', 'bio'];

function pickEditable(body) {
  const patch = {};
  for (const key of EDITABLE) {
    if (Object.hasOwn(body, key)) patch[key] = body[key];
  }
  return patch;
}`;

export const CHECK_MASS_CODE = `// Тест: служебные поля из тела запроса не доходят до записи
const alice = { id: 'u1', name: 'Алиса', bio: '', role: 'user' };
const hostile = [
  { role: 'admin' },
  { id: 'u2' },
  JSON.parse('{"__proto__": {"isAdmin": true}}'),
];
for (const body of hostile) {
  const saved = updateProfile({ ...alice }, body);
  assert.equal(saved.role, 'user');
  assert.equal(saved.id, 'u1');
  assert.equal(saved.isAdmin, undefined);
}`;

/**
 * Тела запросов для таблицы и второго демо. `naive` — что изменилось в записи после
 * `Object.assign`, `schema` — ответ схемы zod, `pick` — что пропустил список имён.
 * Сверено тестом.
 */
export const FIELD_CASES: FieldCase[] = [
  {
    label: 'честная форма',
    body: '{"name": "Алиса Л.", "bio": "пеку хлеб"}',
    naive: '`name`, `bio`',
    schema: '`name`, `bio`',
    pick: '`name`, `bio`',
    changed: { name: 'Алиса Л.', bio: 'пеку хлеб' },
    schemaPatch: { name: 'Алиса Л.', bio: 'пеку хлеб' },
    pickPatch: { name: 'Алиса Л.', bio: 'пеку хлеб' },
  },
  {
    label: 'роль',
    body: '{"name": "Алиса", "role": "admin"}',
    naive: '**`role` = `admin`**',
    schema: '`name`; `role` отброшен',
    pick: '`name`',
    changed: { role: 'admin' },
    schemaPatch: { name: 'Алиса' },
    pickPatch: { name: 'Алиса' },
    tone: 'err',
  },
  {
    label: 'чужой id',
    body: '{"id": "u2"}',
    naive: '**`id` = `u2`** — запись теперь указывает на Бориса',
    schema: 'ничего',
    pick: 'ничего',
    changed: { id: 'u2' },
    schemaPatch: {},
    pickPatch: {},
    tone: 'err',
  },
  {
    label: '__proto__',
    body: '{"__proto__": {"isAdmin": true}}',
    naive: '**`isAdmin` = `true`** — унаследовано: сменился прототип записи',
    schema: 'ничего',
    pick: 'ничего',
    changed: { isAdmin: true },
    schemaPatch: {},
    pickPatch: {},
    tone: 'err',
  },
  {
    label: 'не тот тип',
    body: '{"name": 42}',
    naive: '`name` = `42`',
    schema: '**400**: ждали строку',
    pick: '`name` = `42` — имя разрешено, тип не проверен',
    changed: { name: 42 },
    schemaPatch: null,
    pickPatch: { name: 42 },
    tone: 'warn',
  },
  {
    label: 'пустое имя',
    body: '{"name": "   "}',
    naive: '`name` = пробелы',
    schema: '**400**: после `trim` короче одного символа',
    pick: '`name` = пробелы',
    changed: { name: '   ' },
    schemaPatch: null,
    pickPatch: { name: '   ' },
    tone: 'warn',
  },
];

// ─── Раздел 4 · глубокое слияние и prototype pollution ───────────────────────────────────────

/**
 * Атака по шагам и три защиты — каждая названа по тому звену, которое она рвёт.
 *
 * ⚠️ Здесь стояла подпись «Слева — то, что пришло от пользователя; справа — что исполнилось.
 * Три переключателя…» — пересказ устройства демо, а не предмета; механика атаки при этом
 * уместилась в одну фразу. Каждый шаг ниже — то, что `runPollution` пишет в трассу, и это
 * сверено тестом: `tests/unit/backend-security.test.ts`, блок «prototype pollution».
 */
/*
 * ⚠️ Переехало сюда из «Объектной модели» 2026-10-03, там же и переписано (автор курса: «а тут?»). Шаги разбирали `merge`, `source`,
 * `target` и строку `if (!target[key])`, а исходника над ними не было: он появлялся только
 * в демо, ниже шагов и защит. Читатель шёл по коду, которого не видел. Теперь сначала —
 * зачем вообще смотреть на `merge`, потом сам код с выводом, потом шаги. Свидетель
 * атаки (посторонний `{}`) переехал из лида в последнюю строку кода, где его и видно.
 */
export const POLLUTION_LEAD =
  '`Object.assign` портит одну запись. Глубокое слияние — `merge` — опаснее: им накладывают тело запроса на сохранённую запись, а настройки пользователя — на настройки по умолчанию, и через него отправитель может дописать свойство **всем объектам процесса сразу**. Вот наивная версия и атака на неё:';

/**
 * Тот же код, что исполняет демо (`runPollution([]).code` в `widgets/pollution-lab`), плюс
 * вывод последней строки. Тест «код в тексте — тот, что исполняет демо» сверяет
 * строки без комментариев и исполняет листинг целиком.
 */
export const POLLUTION_CODE = `function merge(target, source) {
  for (const key of Object.keys(source)) {
    const value = source[key];
    if (value && typeof value === "object") {
      if (!target[key]) target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
}

const target = {};
merge(target, JSON.parse('{"__proto__":{"isAdmin":true}}'));

({}).isAdmin;   // true — у объекта, которого merge не касался`;

export const POLLUTION_AFTER =
  'Последняя строка спрашивает не цель слияния, а **посторонний** объект: свежий `{}`. Он отвечает `true` — значит, свойство легло в общий прототип, и его теперь видят все обычные объекты процесса — в каждом следующем запросе. По шагам:';

export const POLLUTION_WALK = [
  '`JSON.parse` заводит `"__proto__"` **обычным собственным ключом**: парсер особых имён не знает (почему в литерале то же имя ведёт себя иначе — в [«Объектной модели», раздел «Прототипы»](/js/object-model/#s2)). Поэтому `Object.keys(source)` отдаёт `["__proto__"]`, и `merge` идёт по нему, как по любому другому ключу.',
  'Значение под ключом — объект, и `merge` читает `target["__proto__"]`, чтобы спуститься внутрь. Собственного такого ключа у `target` нет, поиск уходит в `Object.prototype` и находит там **аксессор** `__proto__`. Его геттер возвращает прототип `target`, то есть сам `Object.prototype`.',
  'Проверка `if (!target[key])` видит объект и ничего не создаёт: «вложенный объект уже есть». Рекурсия получает `Object.prototype` новой целью.',
  'На следующем уровне `target[key] = value` пишет `isAdmin = true` — прямо в `Object.prototype`. Теперь `({}).isAdmin` находит ключ по цепочке у любого обычного объекта.',
  'Сама цель осталась пустой: `Object.keys(target)` — `[]`. Со стороны слияние выглядит так, будто ничего не произошло.',
];

export const POLLUTION_DEFENSES = [
  {
    t: 'Проверка ключа — рвёт шаг 1',
    d: '`"__proto__"` и `"constructor"` отбрасываются до чтения: до аксессора дело не доходит. Имя `constructor` в списке не случайно: через `target.constructor.prototype` путь ведёт туда же.',
  },
  {
    t: '`Object.create(null)` — рвёт шаг 2',
    d: 'У цели нет прототипа, значит нет и унаследованного аксессора. `target["__proto__"]` даёт `undefined`, `merge` заводит собственное свойство с этим именем, и `isAdmin` оседает внутри цели: её ключи — `["__proto__"]`.',
  },
  {
    t: 'Заморозка прототипа — рвёт шаг 4',
    d: 'Чтение аксессора проходит как раньше, а запись в замороженный объект отказывает: в строгом режиме — `TypeError`, в нестрогом — молча. Защита глобальная и необратимая: заморозить `Object.prototype` можно только всей программе сразу.',
  },
  {
    t: '`Map` вместо объекта — атаки нет вовсе',
    d: 'Ключи `Map` — записи в таблице, а не свойства: `map.get("__proto__")` читает запись и до прототипа не доходит. Обходить нечего: у записей таблицы нет ни аксессоров, ни цепочки.',
  },
];

export const MASS_NOTES = [
  '**`Object.assign` и `__proto__`.** `JSON.parse` делает `__proto__` обычным собственным ключом. `Object.assign` записывает ключи присваиванием — и присваивание `__proto__` меняет прототип записи: у Алисы появляется унаследованный `isAdmin`. Распаковка `{ ...body }` и схема такого не делают. Чем это грозит всему процессу — ниже, в «Глубоком слиянии».',
  '**Отбросить или отказать.** По умолчанию zod молча отбрасывает лишние ключи — клиент, приславший `role`, получит 200 и не узнает, что поле не сохранилось. `.strict()` превращает лишний ключ в ошибку 400: для внутреннего API это честнее, ошибку фронта видно сразу.',
  '**Ответ — тоже список полей.** Та же дыра наоборот: `return user` отдаёт клиенту хеш пароля и служебные флаги, потому что «фронт их не показывает». OWASP объединяет обе половины в одну строку — Broken Object Property Level Authorization. Ответ собирается из явного списка полей, как и запись.',
];

export const FIELD_DEMO_CAPTION =
  'Исполняются `NAIVE_MASS_CODE` и `PICK_CODE` — строки выше — над копией записи Алисы. Схему zod демо не везёт в браузер; её ответы на те же тела — в третьей колонке таблицы ниже.';

/* ──────────────────── Раздел 5 · ошибки и секреты ──────────────────── */

export const NAIVE_ERROR_CODE = `// ✗ Клиенту — всё, что знает исключение
function toResponse(err) {
  return { status: 500, body: { error: err.message, stack: err.stack } };
}`;

export const SAFE_ERROR_CODE = `// ✓ Показать можно только ошибку, созданную для показа. Остальное — в журнал.
class PublicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toResponse(err, requestId, log) {
  if (err instanceof PublicError) return { status: err.status, body: { error: err.message } };
  log({ requestId, err });                       // стек и подробности — сюда
  return { status: 500, body: { error: 'Внутренняя ошибка', requestId } };
}`;

export const CHECK_ERROR_CODE = `// Тест: ответ 500 не несёт ни текста исключения, ни стека
const internal = [
  new Error('connect ECONNREFUSED 10.0.3.7:5432'),
  new TypeError("Cannot read properties of undefined (reading 'total')"),
];
for (const err of internal) {
  const res = toResponse(err, 'req-42', () => {});
  const text = JSON.stringify(res.body);
  assert.equal(res.status, 500);
  assert.equal(text.includes(err.message), false, text);
  assert.equal(text.includes('    at '), false, text);
}`;

export const ERROR_NOTES = [
  '**Что уносит наивный ответ.** На сквозной базе запрос к несуществующей таблице отдал клиенту `no such table: payments` — имя таблицы; ошибка соединения — внутренний адрес `10.0.3.7:5432`; стек — пути к файлам сервера и версии библиотек. Каждое по отдельности безобидно, вместе — карта того, что стоит за API.',
  '**`requestId` связывает ответ с журналом.** Пользователь присылает номер из сообщения об ошибке — и поддержка находит полный стек, не показав его никому снаружи.',
];

export const FIND_LEAKS_CODE = `// После сборки: ни одно значение серверного секрета не встречается в файлах клиента.
// Искать имя переменной бесполезно — сборщик подставляет значение, а не имя.
const PUBLIC = /^(PUBLIC_|VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_)/;

function findLeaks(env, files) {
  const secrets = Object.entries(env).filter(
    ([name, value]) => !PUBLIC.test(name) && typeof value === 'string' && value.length >= 8,
  );
  const leaks = [];
  for (const [file, text] of Object.entries(files)) {
    for (const [name, value] of secrets) if (text.includes(value)) leaks.push(\`\${name} → \${file}\`);
  }
  return leaks;
}`;

export const SECRETS_NOTE =
  'Серверная переменная попадает в бандл двумя путями: её называют публичным префиксом — `VITE_`, `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `PUBLIC_` в Astro, — или модуль, который её читает, импортирован из клиентского кода. В обоих случаях сборщик вписывает **значение** строкой в JS, и оно едет каждому посетителю. У Nuxt путь другой, итог тот же: `NUXT_PUBLIC_API_BASE` переопределяет ключ `runtimeConfig.public.apiBase`, и значение уходит в данные каждой страницы — в файлах сборки его нет, ищите в HTML ответа. Как устроена подстановка через `define` и почему она работает и в разработке, и в сборке — в [«Модулях и сборке», раздел «Dev не равен prod»](/tooling/modules/#s6). Искать после сборки надо значения, а не имена: имени переменной в бандле нет, есть только то, что в ней лежало.';

/* ──────────────────── Раздел 6 · цепочка поставок ──────────────────── */

export const LOCK_CHECK_CODE = `// Каждый пакет в lock-файле — из своего реестра и с хешем содержимого.
// Пакет без integrity или с чужим resolved — повод остановить сборку.
function lockProblems(lock, registry = 'https://registry.npmjs.org/') {
  const problems = [];
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (path === '' || pkg.link) continue;          // корень и ссылки на рабочие пакеты
    if (!pkg.resolved?.startsWith(registry)) problems.push(\`\${path}: resolved \${pkg.resolved ?? 'нет'}\`);
    if (!pkg.integrity) problems.push(\`\${path}: нет integrity\`);
  }
  return problems;
}`;

export const CI_CODE = `npm ci                                     # lock-файл разошёлся с package.json — падение
node scripts/check-lock.mjs                # lockProblems из кода рядом
npm audit --omit=dev --audit-level=high    # уязвимости того, что едет на сервер`;

export const SUPPLY_CARDS = [
  {
    t: 'Серверная зависимость видит больше',
    d: 'Пакет в клиентском бандле работает в песочнице вкладки. Тот же пакет в обработчике работает с правами процесса: читает `process.env` со всеми секретами, открывает соединения во внутреннюю сеть, пишет на диск. Поэтому список `dependencies` сервера — отдельный предмет ревью, а исходящие соединения сервера стоит ограничивать и на уровне сети, не только кодом из раздела «Запрос на адрес пользователя».',
    tone: 'warn' as const,
  },
  {
    t: 'Lock-файл, `integrity` и `npm ci`',
    d: '`lockProblems` выше — десяток строк для шага в CI: пакет с чужим `resolved` или без `integrity` останавливает сборку раньше, чем код попадёт на сервер. На `package-lock.json` этого курса: сотни пакетов, замечаний ноль. Что такое `integrity`, почему `npm ci` не меняет lock-файл и откуда берётся `EINTEGRITY` — в [«Пакетных менеджерах», раздел «Lock-файл»](/tooling/package-managers/#s3).',
    tone: 'info' as const,
  },
  {
    t: 'Скрипты установки и `npm audit`',
    d: 'Установка пакета исполняет его `postinstall` раньше, чем вы импортировали строку. Одобрение скриптов, порог возраста версии и что на самом деле проверяет `npm audit` — в [«Пакетных менеджерах», раздел «Скрипты установки и цепочка поставок»](/tooling/package-managers/#s6). Здесь добавка одна: `--omit=dev` сужает отчёт до того, что едет на сервер.',
    tone: 'info' as const,
  },
];

export const TAKEAWAY =
  'Проверка, которую нельзя обойти, стоит там, где решение исполняется: владелец — в запросе к базе, адрес — в `lookup` соединения, поля — в схеме перед записью, текст ошибки — на выходе из обработчика. И у каждой есть тест, который присылает чужой id, адрес `127.0.0.2` и поле `role`, — тот же, что упал бы на наивной версии.';

/* ──────────────────── Тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Проверка в middleware — не проверка в обработчике',
    d: 'Middleware решает по пути, обработчик — по объекту. Middleware знает, что пользователь вошёл, но не знает, чей заказ 3. И обходят его отдельно: в Next.js уязвимость CVE-2025-29927 (март 2025) позволяла пропустить middleware целиком служебным заголовком запроса `x-middleware-subrequest`. Исправлено в 15.2.3, 14.2.25, 13.5.9 и 12.3.5; свою версию показывает `npm ls next`. Авторизация объекта живёт в обработчике — middleware может быть только первым слоем.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Серверная функция — открытая точка входа',
    d: 'Server Actions в Next.js и серверные функции других фреймворков вызываются обычным POST-запросом, и вызвать их может кто угодно — с любыми аргументами, а не только ваша форма. То, что функция импортирована в компонент для вошедших пользователей, её не защищает: сессию, владельца и поля она проверяет сама, как любой обработчик. Документация Next.js так и пишет: считайте Server Action доступным прямым POST-запросом.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Парсер URL переписывает хост',
    d: '`new URL("http://①②⑦.0.0.1/").hostname` — это `127.0.0.1`; `http://2130706433/` — тоже. Проверка сырой строки регулярным выражением пропускает всё это, проверка `hostname` — ловит. Но и `hostname` не говорит, куда пойдёт соединение: для имени решает DNS.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Проверили адрес — и резолвят заново',
    d: 'Резолв «для проверки» и резолв «для запроса» — два вопроса к DNS, и ответы на них выбирает владелец домена. Проверка должна стоять в `lookup` соединения, иначе между ними есть окно (DNS rebinding).',
    tone: 'err',
  },
  {
    n: '05',
    t: '`execFile` с `shell: true` — снова оболочка',
    d: 'Опция `shell` склеивает аргументы в строку для оболочки, и массив больше ничего не защищает: `execFile("wc", ["-l", "report.txt; touch m"], { shell: true })` создал файл `m`. Node 26 предупреждает об этом отдельно — `DEP0190: Passing args to a child process with shell option true… only concatenated`. То же у `spawn`.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`ORDER BY ?` не сортирует',
    d: 'Плейсхолдер — значение, поэтому `ORDER BY ?` с `\'total\'` сортирует по строковой константе: порядок остался `1, 2, 3` вместо `3, 2, 1`, и ни ошибки, ни предупреждения. Имена столбцов выбираются из своего списка.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`prepare` исполняет первый оператор, `exec` — все',
    d: 'Склеенная строка `…\'; DROP TABLE orders; --` в `db.prepare` из `node:sqlite` таблицу не удалила: подготовлен и исполнен только первый оператор, хвост отброшен без ошибки. Тот же текст в `db.exec` исполнил бы оба. Это не защита, а случайность API: другой драйвер или режим «несколько операторов» ведёт себя иначе.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Схема молча отбрасывает',
    d: 'zod по умолчанию убирает незнакомые ключи и отвечает успехом. Для записи это безопасно, но фронт, приславший `displayName` вместо `name`, получит 200 и потерянные данные. `.strict()` превращает опечатку в 400.',
    tone: 'warn',
  },
];

/* ──────────────────── Источники ──────────────────── */

export const SOURCES: { t: string; items: string[] }[] = [
  {
    t: 'OWASP',
    items: [
      '[**OWASP API Security Top 10 (2023)**](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) — API1 Broken Object Level Authorization, API3 Broken Object Property Level Authorization (бывшие Mass Assignment и Excessive Data Exposure — массовое присваивание и лишние поля в ответе), API7 Server Side Request Forgery',
      '[**OWASP Top 10 (2025)**](https://owasp.org/Top10/2025/) — A01 Broken Access Control (SSRF теперь здесь), A03 Software Supply Chain Failures, A05 Injection, A10 Mishandling of Exceptional Conditions. В [редакции 2021](https://owasp.org/Top10/2021/) SSRF была отдельной строкой A10, а зависимости — A06 Vulnerable and Outdated Components',
      '[**OWASP Cheat Sheet Series**](https://cheatsheetseries.owasp.org/) — Server Side Request Forgery Prevention, Query Parameterization, OS Command Injection Defense, Mass Assignment, Error Handling, Secrets Management, NPM Security',
    ],
  },
  {
    t: 'Документация и стандарты',
    items: [
      '**Node.js 26** — `node:sqlite` (`DatabaseSync`, `prepare`, `exec`), `child_process` (`exec`, `execFile`, опция `shell`, DEP0190), `http.request` (опция `lookup`), `dns.lookup` (`all`)',
      '**WHATWG URL Standard** — разбор хоста: IPv4 в десятичной, восьмеричной и шестнадцатеричной записи, нормализация IPv6',
      '**IANA** — [IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry/) и [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry/) Special-Purpose Address Registry (RFC 6890), сверено по состоянию на сентябрь 2026; сервис метаданных — [AWS](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html), [Google Cloud](https://cloud.google.com/compute/docs/metadata/querying-metadata), [Azure](https://learn.microsoft.com/en-us/azure/virtual-machines/instance-metadata-service)',
      '**zod 4** — `z.object`, поведение с незнакомыми ключами, `.strict()`',
      '**Next.js** — [безопасность данных и Server Actions](https://nextjs.org/docs/app/guides/data-security), [бюллетень CVE-2025-29927 (GHSA-f82v-jwr5-mffw)](https://github.com/advisories/GHSA-f82v-jwr5-mffw), [переменные окружения](https://nextjs.org/docs/app/guides/environment-variables); [**Vite**](https://vite.dev/guide/env-and-mode), [**Astro**](https://docs.astro.build/en/guides/environment-variables/) — публичные префиксы; **Nuxt** — `runtimeConfig.public` и `NUXT_PUBLIC_*` ([docs/…/runtime-config.md](https://github.com/nuxt/nuxt/blob/main/docs/3.guide/6.going-further/10.runtime-config.md))',
    ],
  },
];
