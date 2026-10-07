import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ApiCodes, ResolverScenario, Tables } from '@/widgets/api-wire-lab/model/types';

/**
 * Данные темы «REST, GraphQL и gRPC-web: что ходит по проводу».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сеть и безопасность».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, `graphql` **17.0.2** из `node_modules` проекта, Chromium 153.0.8010.12
 * (Playwright 1.63), октябрь 2026. Свой `node:http`-сервер (порты 52100–52103), три API над одной
 * «базой» `TABLES`:
 *   — REST: `GET /api/orders?limit=5`, `/api/users/:id`, `/api/products/:id` — маршруты `REST_CODE`,
 *     заголовки `ETag` (sha1 тела) и `Cache-Control` (`private, no-cache` у заказов,
 *     `public, max-age=60` у пользователей и товаров);
 *   — GraphQL: `POST /graphql` — `graphql()` из graphql 17 со схемой `SDL` и резолверами
 *     `RESOLVERS_CODE`; `GET /graphql?extensions=…` — automatic persisted queries по протоколу Apollo
 *     (хеш sha256 текста запроса, промах — `PersistedQueryNotFound`, регистрация — POST с текстом и хешем);
 *   — gRPC-web: `POST /shop.OrderService/ListOrders` — тело кадрами `grpcWebFrame`, сообщение
 *     кодирует `encode` из `PROTO_CODE`.
 *
 * Байты (`WIRE_ROWS`) сняты сырыми TCP-сокетами: запрос написан руками (`Host: shop.example`,
 * `Connection: close`, без лишних заголовков), сервер с `sendDate = false` — числа повторяются
 * байт в байт. Это HTTP/1.1 без сжатия; браузер к каждому запросу добавляет свои заголовки:
 * Chromium 153 на стенде прислал 12 заголовков, около 480 байт на запрос.
 *
 * Второй заход (`CACHE_ROWS`) снят в Chromium: страница со стенда дважды собирает экран каждым
 * способом, сервер пишет журнал, `performance.getEntriesByType('resource')` даёт `transferSize`
 * (0 — ответ из кеша браузера).
 *
 * Трейлеры (`TRAILER_FACTS`): `node:http2` с самоподписанным сертификатом, ответ
 * `application/grpc+proto` с трейлерами `grpc-status: 0`. Node-клиент получил их событием
 * `trailers`; `fetch` в Chromium (протокол `h2`) — заголовки `access-control-allow-origin`,
 * `content-type`, `date`, и ни одного свойства про трейлеры у `Response`.
 *
 * Что взято только из документации и не запускалось: настоящий gRPC-сервер и прокси Envoy
 * (на стенде нет ни `@grpc/grpc-js`, ни `grpc-web`, ни `protobufjs` — пакеты не ставились).
 * Кодирование protobuf учебное, по спецификации «Encoding»; оно сверено с примерами из неё же
 * (`PROTO_VECTORS`: 150 → `08 96 01` и др.). Кадр gRPC-web — по PROTOCOL-WEB.md. Правила статусов
 * GraphQL over HTTP — по черновику спецификации, сервер стенда их не реализует целиком.
 *
 * Пересобирает всё, кроме Chromium, `tests/unit/api-styles.test.ts`: учебный исполнитель `GQL_CODE`
 * сверяется с graphql 17 (тот же ответ, тот же порядок вызовов резолверов, тот же журнал «базы»),
 * байты — сервером на сырых сокетах, размеры сжатия — `node:zlib`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'ресурс (REST)',
    d: 'Сущность со своим адресом: `/api/users/u1` — пользователь, `/api/products/p1` — товар. Сервер решает, какие поля отдать; клиент берёт запись целиком.',
  },
  {
    k: 'резолвер',
    d: 'Функция на сервере GraphQL, которая достаёт значение одного поля: «автор заказа», «товар позиции». Сервер вызывает её для каждого объекта, где это поле запрошено.',
  },
  {
    k: 'N+1',
    d: 'Один запрос к базе за списком и ещё по одному на каждый элемент списка. Пять заказов — пять отдельных походов за авторами.',
  },
  {
    k: 'DataLoader (батчинг)',
    d: 'Прослойка, которая копит одиночные запросы `load(id)` и отправляет их в базу одним вызовом со списком ключей.',
  },
  {
    k: 'over- и under-fetching',
    d: 'Over-fetching — в ответе больше полей, чем нужно экрану. Under-fetching — в одном ответе не хватает данных, и приходится идти за ними ещё раз.',
  },
  {
    k: 'protobuf',
    d: 'Protocol Buffers — двоичный формат сообщений. Схема лежит в файле `.proto`; в байтах вместо имён полей — их номера.',
  },
  {
    k: 'varint',
    d: 'Запись целого числа переменной длины: по 7 бит в байт. Числа до 127 занимают один байт, до 16 383 — два.',
  },
  {
    k: 'трейлеры HTTP',
    d: 'Заголовки, которые сервер присылает **после** тела ответа. gRPC кладёт туда статус вызова: успех или ошибку он знает только в конце.',
  },
  {
    k: 'persisted query',
    d: 'Запрос GraphQL, который сервер помнит по хешу. Клиент шлёт не текст запроса, а короткий хеш — и может сделать это через `GET`.',
  },
];

export const PLAIN_STYLES =
  'Три способа заказать обед в столовой. REST — линия раздачи: суп в одном окне, второе в другом, компот в третьем, и к каждому окну своя очередь. GraphQL — официант с бланком: отмечаете галочками, что нужно, и всё приносят одним подносом, но кухня собирает заказ по пунктам. gRPC — заказ по номерам из меню в коробке с наклейкой: компактно и быстро, но без меню не понять, что внутри.';

export const PREREQ_NOTE =
  'Тема опирается на кеш HTTP, кадры HTTP/2 и порядок задач в цикле событий — всё это разобрано в других темах. Двоичная запись числа объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кеш HTTP и валидация',
    d: '`Cache-Control: max-age=60` разрешает браузеру отдать копию без сети. `no-cache` с `ETag` — спросить сервер «не изменилось?» и получить короткий ответ `304`.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
  {
    t: 'Общий кеш и его ключ',
    d: 'CDN и прокси хранят ответы для всех. Ключ кеша — метод и адрес, и почти все кеши хранят только `GET`.',
    href: '/platform/cdn-cache/#s2',
    hrefLabel: '«CDN и серверный кеш», раздел «Ключ и Vary»',
    tone: 'info',
  },
  {
    t: 'Задача и микрозадачи',
    d: 'Цикл событий берёт задачу, выполняет её целиком, потом все микрозадачи (`then` промисов). `setTimeout(fn, 0)` ставит `fn` следующей задачей — после всего этого.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Цикл событий», раздел «Оборот»',
    tone: 'info',
  },
  {
    t: 'Кадры HTTP/2',
    d: 'Ответ HTTP/2 приходит кадрами: HEADERS с заголовками, DATA с телом. Трейлеры — ещё один кадр HEADERS после тела.',
    href: '/platform/http2-http3/#s2',
    hrefLabel: '«HTTP/2 и HTTP/3», раздел «Кадры»',
    tone: 'info',
  },
  {
    t: 'Число в двоичной записи',
    d: 'Нужно для раздела про protobuf. 150 в двоичной записи — `10010110`: 128 + 16 + 4 + 2. В семь бит помещаются числа от 0 до 127.',
    tone: 'info',
  },
];

// ─── Раздел 1. Один экран ──────────────────────────────────────────────────────────────────

/** «База» стенда. Её же читают REST-маршруты, резолверы GraphQL и сервис gRPC. */
export const TABLES: Tables = {
  users: [
    {
      id: "u1",
      name: "Анна Смирнова",
      email: "anna@example.com",
      city: "Казань",
      avatarUrl: "https://cdn.example.com/avatars/u1.webp",
      bio: "Варит кофе по утрам и пишет обзоры на кофемолки.",
      createdAt: "2025-03-14T09:12:00Z"
    },
    {
      id: "u2",
      name: "Борис Ким",
      email: "boris@example.com",
      city: "Новосибирск",
      avatarUrl: "https://cdn.example.com/avatars/u2.webp",
      bio: "Собирает френч-прессы.",
      createdAt: "2025-06-02T18:40:00Z"
    },
    {
      id: "u3",
      name: "Вера Орлова",
      email: "vera@example.com",
      city: "Пермь",
      avatarUrl: "https://cdn.example.com/avatars/u3.webp",
      bio: "Бариста выходного дня.",
      createdAt: "2026-01-20T11:05:00Z"
    }
  ],
  products: [
    {
      id: "p1",
      title: "Кофе в зёрнах, 1 кг",
      price: 1890,
      stock: 42,
      imageUrl: "https://cdn.example.com/p/p1.webp",
      description: "Эфиопия, светлая обжарка, ноты черники и жасмина."
    },
    {
      id: "p2",
      title: "Френч-пресс",
      price: 2490,
      stock: 7,
      imageUrl: "https://cdn.example.com/p/p2.webp",
      description: "Стекло и сталь, 600 мл."
    },
    {
      id: "p3",
      title: "Кружка",
      price: 650,
      stock: 120,
      imageUrl: "https://cdn.example.com/p/p3.webp",
      description: "Керамика, 300 мл."
    },
    {
      id: "p4",
      title: "Фильтры, 100 шт",
      price: 320,
      stock: 300,
      imageUrl: "https://cdn.example.com/p/p4.webp",
      description: "Бумажные, неотбеленные."
    },
    {
      id: "p5",
      title: "Кемекс",
      price: 5900,
      stock: 3,
      imageUrl: "https://cdn.example.com/p/p5.webp",
      description: "Колба на 6 чашек."
    },
    {
      id: "p6",
      title: "Весы",
      price: 3400,
      stock: 15,
      imageUrl: "https://cdn.example.com/p/p6.webp",
      description: "Точность 0,1 г, таймер."
    }
  ],
  orders: [
    {
      id: "o1001",
      authorId: "u1",
      status: "paid",
      createdAt: "2026-09-28T10:00:00Z",
      items: [
        {
          productId: "p1",
          qty: 2
        },
        {
          productId: "p3",
          qty: 1
        }
      ]
    },
    {
      id: "o1002",
      authorId: "u2",
      status: "shipped",
      createdAt: "2026-09-28T12:30:00Z",
      items: [
        {
          productId: "p2",
          qty: 1
        },
        {
          productId: "p4",
          qty: 3
        },
        {
          productId: "p1",
          qty: 1
        }
      ]
    },
    {
      id: "o1003",
      authorId: "u1",
      status: "new",
      createdAt: "2026-09-29T08:15:00Z",
      items: [
        {
          productId: "p5",
          qty: 1
        }
      ]
    },
    {
      id: "o1004",
      authorId: "u3",
      status: "paid",
      createdAt: "2026-09-30T16:45:00Z",
      items: [
        {
          productId: "p6",
          qty: 1
        },
        {
          productId: "p4",
          qty: 1
        }
      ]
    },
    {
      id: "o1005",
      authorId: "u2",
      status: "paid",
      createdAt: "2026-10-01T07:20:00Z",
      items: [
        {
          productId: "p3",
          qty: 4
        },
        {
          productId: "p1",
          qty: 1
        }
      ]
    }
  ]
};

/** Таблицы для печати: строка на запись, как их видит читатель. Собирается из `TABLES`. */
export const TABLES_PRINT = (Object.keys(TABLES) as (keyof Tables)[])
  .map((name) => `${name}: [\n${TABLES[name].map((row) => `  ${JSON.stringify(row)},`).join('\n')}\n]`)
  .join('\n');

export const SCREEN_NOTE =
  'Экрану нужны номер и статус заказа, имя автора, а у каждой позиции — количество, название и цена товара. Остальные поля — почта, город, описание, остаток на складе — нужны другим экранам.';

/** Что получает экран — одинаково при любом способе; первый заказ из пяти. Сверяет тест. */
export const SCREEN_FIRST = `{
  "id": "o1001",
  "status": "paid",
  "author": {
    "name": "Анна Смирнова"
  },
  "items": [
    {
      "qty": 2,
      "product": {
        "title": "Кофе в зёрнах, 1 кг",
        "price": 1890
      }
    },
    {
      "qty": 1,
      "product": {
        "title": "Кружка",
        "price": 650
      }
    }
  ]
}`;

/**
 * Байты одного экрана, HTTP/1.1 без сжатия. «Тело» не зависит от сервера, «с заголовками» —
 * минимальные заголовки стенда (см. шапку). Пересобирает тест на сырых сокетах.
 */
export const WIRE_ROWS = [
  {
    k: "REST",
    requests: 10,
    steps: 2,
    upBody: 0,
    downBody: 2508,
    up: 974,
    down: 4177
  },
  {
    k: "GraphQL",
    requests: 1,
    steps: 1,
    upBody: 159,
    downBody: 1103,
    up: 320,
    down: 1227
  },
  {
    k: "gRPC-web",
    requests: 1,
    steps: 1,
    upBody: 7,
    downBody: 562,
    up: 169,
    down: 663
  }
];

export const WIRE_NOTE =
  'Данных для экрана — 1083 байт JSON. REST привёз 2508 байт тел в десяти ответах, GraphQL — 1103 в одном, gRPC-web — 562: это двоичное сообщение и кадр со статусом.';

export const WIRE_CAPTION =
  'Запросы и байты считают функции темы: `loadScreenRest` с маршрутами `ROUTES`, исполнитель `execute` и кодировщик `encode`. Цифры — длины тел в UTF-8; заголовки HTTP сюда не входят.';

/** Подписи к трём режимам демо «Один экран». */
export const WIRE_MODES = {
  rest: 'Первый запрос — заказы. Остальные девять ждут его ответа: только из него видно, какие авторы и товары нужны. В записях пользователя и товара подсвечены поля, которые попали на экран.',
  graphql: 'Один `POST` на один адрес. Запрос едет строкой внутри JSON — с переводами строк и пробелами, как его написали. Ответ повторяет форму запроса.',
  grpc: 'Один `POST` на адрес метода. Первый заказ по байтам: ключ поля, длина, данные. Имён полей в байтах нет — только номера из `.proto`.',
};

// ─── Раздел 2. REST ────────────────────────────────────────────────────────────────────────

export const REST_CODE = `// REST: три ресурса — три адреса. Ответ — запись целиком, какие поля ни нужны экрану.
const ROUTES = [
  [/^\\/api\\/orders\\?limit=(\\d+)$/, (db, n) => db.orders.slice(0, Number(n))],
  [/^\\/api\\/users\\/(\\w+)$/, (db, id) => db.users.find((u) => u.id === id)],
  [/^\\/api\\/products\\/(\\w+)$/, (db, id) => db.products.find((p) => p.id === id)],
];

function route(db, url) {
  for (const [pattern, handler] of ROUTES) {
    const m = pattern.exec(url);
    if (m) return handler(db, m[1]) ?? null;
  }
  return null;
}

// Клиент экрана: заказы, потом авторы и товары — второй шаг ждёт первый.
async function loadScreenRest(get) {
  const orders = await get('/api/orders?limit=5');
  const userIds = [...new Set(orders.map((o) => o.authorId))];
  const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.productId)))];
  const [users, products] = await Promise.all([
    Promise.all(userIds.map((id) => get(\`/api/users/\${id}\`))),
    Promise.all(productIds.map((id) => get(\`/api/products/\${id}\`))),
  ]);
  const user = new Map(users.map((u) => [u.id, u]));
  const product = new Map(products.map((p) => [p.id, p]));
  // Склейка на клиенте: из каждой записи берём два-три поля.
  return orders.map((o) => ({
    id: o.id,
    status: o.status,
    author: { name: user.get(o.authorId).name },
    items: o.items.map((i) => ({
      qty: i.qty,
      product: { title: product.get(i.productId).title, price: product.get(i.productId).price },
    })),
  }));
}`;

export const REST_FACTS = [
  {
    t: 'Водопад: второй шаг ждёт первый',
    d: 'Какие авторы и товары нужны, клиент узнаёт только из ответа про заказы. Девять запросов второго шага уходят разом, но не раньше, чем пришёл первый. Каждый шаг — минимум один круг до сервера и обратно.',
    tone: 'warn' as const,
  },
  {
    t: 'Under-fetching: десять запросов',
    d: 'Ответ про заказ не содержит ни имени автора, ни названий товаров — только ссылки `authorId` и `productId`. За каждым уникальным id — свой запрос: 1 + 3 + 6.',
  },
  {
    t: 'Over-fetching: 57% лишнего',
    d: 'Из записи пользователя экрану нужно одно поле из семи, из товара — два из шести. Тела десяти ответов — 2508 байт, а данных для экрана в них 1083.',
    tone: 'warn' as const,
  },
  {
    t: 'Заголовки на каждый запрос',
    d: 'Chromium на стенде прислал с каждым запросом около 480 байт заголовков — десять запросов по HTTP/1.1 это почти 5 КБ одних заголовков. HTTP/2 сжимает повторы до байта-двух на заголовок.',
  },
];

export const REST_FIX =
  'Водопад лечат на сервере: адрес, который отдаёт заказы сразу с авторами и товарами. Так делает JSON:API параметром `include=author,items.product`, так устроен BFF — свой бэкенд под экран. Цена — тот же адрес кеша теперь зависит от набора полей, и таких адресов становится много.';

/** Второй заход на тот же экран в Chromium 153. Снято стендом, не пересобирается тестом. */
export const CACHE_ROWS = [
  {
    k: 'REST',
    first: '10 запросов, все `200`',
    second: '1 запрос: заказы с `If-None-Match` → `304`. Пользователи и товары — из кеша браузера, сервер их не видел (`transferSize` 0)',
    tone: 'ok' as const,
  },
  {
    k: 'GraphQL, POST',
    first: '1 запрос, `200`',
    second: 'Снова `POST` и ответ целиком: браузер не кладёт ответы на `POST` в кеш',
    tone: 'err' as const,
  },
  {
    k: 'GraphQL, persisted query',
    first: '`GET` с хешем → `PersistedQueryNotFound`; `POST` с текстом и хешем; `GET` → данные',
    second: '`GET` с тем же хешем — из кеша браузера, сервер запроса не видел',
    tone: 'ok' as const,
  },
];

export const CACHE_NOTE =
  'Кеш HTTP хранит ответ по методу и адресу. У REST адрес — это и есть ресурс, поэтому `Cache-Control` и `ETag` работают как задумано, и на CDN тоже. У GraphQL один адрес на всё, а запрос лежит в теле `POST` — ключа для кеша нет.';

// ─── Раздел 3. GraphQL изнутри ─────────────────────────────────────────────────────────────

export const SDL = `type Query {
  orders(first: Int): [Order]
}
type Order {
  id: ID
  status: String
  createdAt: String
  author: User
  items: [Item]
}
type Item {
  qty: Int
  product: Product
}
type Product {
  id: ID
  title: String
  price: Int
  stock: Int
  description: String
}
type User {
  id: ID
  name: String
  email: String
  city: String
  orders: [Order]
}`;

export const SCREEN_QUERY = `query Orders {
  orders(first: 5) {
    id
    status
    author { name }
    items {
      qty
      product { title price }
    }
  }
}`;

export const PLAIN_RESOLVER =
  'Как сборка заказа на складе по накладной. Кладовщик идёт по строкам сверху вниз: «заказ — есть, автор — сходить в отдел кадров, товары — сходить на полку». Накладная — запрос, кладовщик — исполнитель, а «сходить в отдел кадров» — резолвер поля `author`.';

export const SCHEMA_CODE = `// Схема как объект: тип → поле → тип поля. [Order] — список заказов.
const schema = {
  Query: { orders: '[Order]' },
  Order: { id: 'ID', status: 'String', createdAt: 'String', author: 'User', items: '[Item]' },
  Item: { qty: 'Int', product: 'Product' },
  Product: { id: 'ID', title: 'String', price: 'Int', stock: 'Int', description: 'String' },
  User: { id: 'ID', name: 'String', email: 'String', city: 'String', orders: '[Order]' },
};`;

export const RESOLVERS_CODE = `// «База» с журналом: каждый вызов — одна запись, как запрос к настоящей базе.
function createDb(tables, journal) {
  const call = (name, arg, rows) => {
    journal.push(\`\${name}(\${arg})\`);
    return Promise.resolve(rows);
  };
  const byId = (table, id) => tables[table].find((row) => row.id === id) ?? null;
  return {
    orders: (first) => call('orders', first ?? '', tables.orders.slice(0, first)),
    ordersByAuthor: (id) => call('ordersByAuthor', id, tables.orders.filter((o) => o.authorId === id)),
    user: (id) => call('user', id, byId('users', id)),
    product: (id) => call('product', id, byId('products', id)),
    usersByIds: (ids) => call('usersByIds', ids.join(','), ids.map((id) => byId('users', id))),
    productsByIds: (ids) => call('productsByIds', ids.join(','), ids.map((id) => byId('products', id))),
  };
}

const resolvers = {
  Query: {
    orders: (_, args, ctx) => ctx.db.orders(args.first),
  },
  Order: {
    author: (order, _, ctx) => ctx.users.load(order.authorId),
  },
  Item: {
    product: (item, _, ctx) => ctx.products.load(item.productId),
  },
  User: {
    orders: (user, _, ctx) => ctx.db.ordersByAuthor(user.id),
  },
};

// Без батчинга load — прямой поход в базу; с батчингом — загрузчик на запрос.
function createContext(db, batch) {
  return {
    db,
    users: batch ? createLoader((ids) => db.usersByIds(ids)) : { load: (id) => db.user(id) },
    products: batch ? createLoader((ids) => db.productsByIds(ids)) : { load: (id) => db.product(id) },
  };
}`;

export const GQL_CODE = `// Разбор запроса: поля, вложенность, аргументы. Запятые в GraphQL — пробел.
function parse(source) {
  const tokens = source.replace(/#.*$/gm, '').match(/[{}():]|"[^"]*"|-?\\d+|\\w+/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const value = () => {
    const t = next();
    if (t.startsWith('"')) return t.slice(1, -1); // строка
    if (t === 'true' || t === 'false') return t === 'true';
    return Number(t); // число
  };

  function selectionSet() {
    next(); // {
    const fields = [];
    while (peek() !== '}') {
      const field = { name: next(), args: {}, fields: null };
      if (peek() === '(') {
        next();
        while (peek() !== ')') {
          const key = next();
          next(); // :
          field.args[key] = value();
        }
        next();
      }
      if (peek() === '{') field.fields = selectionSet();
      fields.push(field);
    }
    next(); // }
    return fields;
  }
  if (peek() === 'query') { next(); if (peek() !== '{') next(); } // query Имя
  return selectionSet();
}

// Глубина: сколько уровней фигурных скобок. { orders { author { name } } } — 3.
const depthOf = (fields) => (fields ? 1 + Math.max(...fields.map((f) => depthOf(f.fields))) : 0);

function execute({ schema, resolvers, source, context, maxDepth = Infinity }) {
  const fields = parse(source);
  const depth = depthOf(fields);
  if (depth > maxDepth) {
    return Promise.resolve({ errors: [{ message: \`Глубина запроса \${depth}, а можно не больше \${maxDepth}\` }] });
  }
  const errors = [];
  const isPromise = (v) => typeof v?.then === 'function';

  // Ошибка поля не роняет ответ: на место поля — null, сама ошибка — в errors с путём.
  const fail = (error, path) => {
    errors.push({ message: error.message, path });
    return null;
  };

  function executeFields(typeName, parent, fields, path) {
    const out = {};
    const waits = [];
    for (const f of fields) {
      const value = executeField(typeName, parent, f, [...path, f.name]);
      out[f.name] = value; // ключ на своё место сразу: порядок полей ответа = порядок в запросе
      if (isPromise(value)) waits.push(value.then((v) => { out[f.name] = v; }));
    }
    return waits.length ? Promise.all(waits).then(() => out) : out;
  }

  function executeField(typeName, parent, f, path) {
    const type = schema[typeName][f.name]; // '[Item]', 'User', 'Int'…
    if (!type) throw new Error(\`Cannot query field "\${f.name}" on type "\${typeName}".\`);
    const resolve = resolvers[typeName]?.[f.name];
    try {
      // Резолвера нет — берём одноимённое свойство родителя.
      const raw = resolve ? resolve(parent, f.args, context) : parent[f.name];
      if (isPromise(raw)) {
        return raw.then((v) => complete(type, f, v, path)).then(undefined, (e) => fail(e, path));
      }
      const done = complete(type, f, raw, path);
      return isPromise(done) ? done.then(undefined, (e) => fail(e, path)) : done;
    } catch (e) {
      return fail(e, path);
    }
  }

  function complete(type, f, value, path) {
    if (value == null) return null;
    if (type.startsWith('[')) {
      const inner = type.slice(1, -1);
      const items = value.map((item, i) => complete(inner, f, item, [...path, i]));
      return items.some(isPromise) ? Promise.all(items) : items;
    }
    if (schema[type]) return executeFields(type, value, f.fields, path); // объектный тип — вглубь
    return value; // скаляр
  }

  const data = executeFields('Query', undefined, fields, []);
  return Promise.resolve(data).then((d) => (errors.length ? { errors, data: d } : { data: d }));
}`;

export const GQL_FACTS = [
  {
    t: 'Резолвера нет — берётся свойство',
    d: '`id`, `status`, `qty`, `name` своих функций не имеют: исполнитель берёт одноимённое свойство родителя. Свой резолвер нужен только там, где за данными надо сходить: автор, товар.',
  },
  {
    t: 'Синхронное — сразу, промис — потом',
    d: 'Исполнитель вызывает резолверы всех полей объекта подряд и не ждёт промисы по одному. Поэтому `author` всех пяти заказов и `product` всех десяти позиций вызываются, ещё до того как пришёл первый автор.',
  },
  {
    t: 'Порядок полей — из запроса',
    d: 'Ключи ответа идут в том порядке, в каком поля стоят в запросе, даже если промисы пришли в другом. Ключ ставится на место сразу, значение дописывается, когда придёт.',
  },
];

export const GQL_NOTE =
  'Так же устроен `graphql-js`: на запросе экрана он вызывает те же 16 резолверов в том же порядке и отдаёт тот же ответ — байт в байт. В настоящем исполнителе есть ещё проверка запроса по схеме, переменные, фрагменты и `!`, но обход — этот.';

// ─── Раздел 4. N+1 и DataLoader ────────────────────────────────────────────────────────────

export const PLAIN_N1 =
  'Как ходить в магазин за каждым продуктом отдельно. Список из десяти пунктов — десять поездок, хотя всё лежит на одной полке. N+1 — это одна поездка за списком и N поездок за пунктами.';

export const N1_JOURNAL = `orders(5)
user(u1)
product(p1)
product(p3)
user(u2)
product(p2)
product(p4)
product(p1)
user(u1)
product(p5)
user(u3)
product(p6)
product(p4)
user(u2)
product(p3)
product(p1)`;

export const LOADER_CODE = `// Загрузчик в духе DataLoader: копит ключи до конца тика и просит их одним вызовом.
function createLoader(batchFn) {
  const cache = new Map(); // ключ → промис: повтор того же ключа в базу не идёт
  let queue = [];

  function dispatch() {
    const batch = queue;
    queue = [];
    batchFn(batch.map((q) => q.key)).then(
      (values) => batch.forEach((q, i) => q.resolve(values[i])),
      (error) => batch.forEach((q) => q.reject(error)),
    );
  }

  return {
    load(key) {
      if (cache.has(key)) return cache.get(key);
      const promise = new Promise((resolve, reject) => {
        if (queue.length === 0) setTimeout(dispatch, 0); // первый ключ тика заводит отправку
        queue.push({ key, resolve, reject });
      });
      cache.set(key, promise);
      return promise;
    },
  };
}`;

export const PLAIN_BATCH =
  'Официант не бегает на кухню с каждым заказом отдельно. Он обходит весь стол, записывает всё в один листок и относит его разом. Обход стола — текущая задача, листок — список ключей, кухня — один запрос к базе.';

export const BATCH_JOURNAL = `orders(5)
usersByIds(u1,u2,u3)
productsByIds(p1,p3,p2,p4,p5,p6)`;

export const BATCH_NOTE =
  'Резолверов по-прежнему 16 — исполнитель вызывает их так же. Меняется то, что они делают: `load(id)` не ходит в базу, а кладёт ключ в очередь. Первый ключ ставит отправку на `setTimeout(…, 0)`: она случится после того, как исполнитель обойдёт все объекты текущего уровня. Повторный `u1` в базу не идёт вовсе — кеш загрузчика вернул тот же промис.';

export const LOADER_FACTS = [
  {
    t: 'Загрузчик — на один запрос',
    d: 'Кеш загрузчика живёт, пока исполняется один запрос GraphQL. Общий загрузчик на весь сервер отдаст одному пользователю то, что было загружено для другого, — с чужими правами.',
    tone: 'err' as const,
  },
  {
    t: 'Батч падает целиком',
    d: 'Если `usersByIds` отвечает ошибкой, её получают все ключи пачки. На стенде сервис пользователей «лёг» — и ошибку получили все пять полей `author`, а не одно.',
    tone: 'warn' as const,
  },
  {
    t: 'Порядок ответа — порядок ключей',
    d: '`batchFn` обязан вернуть массив той же длины и в том же порядке, что ключи: загрузчик раздаёт ответы по номеру. База отдаёт строки в своём порядке — их надо разложить по ключам.',
    tone: 'warn' as const,
  },
];

export const DEMO_SCENARIOS: ResolverScenario[] = [
  {
    id: 'screen',
    label: 'Экран',
    query: SCREEN_QUERY,
    fail: false,
    note: 'Запрос экрана. Без загрузчика каждый `author` и `product` — отдельный поход в «базу».',
  },
  {
    id: 'deep',
    label: 'Глубокий запрос',
    query: '{ orders(first: 5) { author { orders { author { orders { author { orders { author { name } } } } } } } } }',
    fail: false,
    note: 'Автор заказа → его заказы → их авторы… Запрос в 118 байт, а резолверов — почти сотня. Загрузчик экономит походы за авторами, но не за заказами автора: для них пачки нет.',
  },
  {
    id: 'limit',
    label: 'Лимит глубины',
    query: '{ orders(first: 5) { author { orders { author { orders { author { orders { author { name } } } } } } } } }',
    fail: false,
    maxDepth: 5,
    note: 'Тот же запрос с `maxDepth: 5`. Исполнитель считает глубину до первого резолвера и отказывает сразу: ни одного вызова, ни одного похода в базу.',
  },
  {
    id: 'fail',
    label: 'Сервис лёг',
    query: SCREEN_QUERY,
    fail: true,
    note: 'Перед запросом выполнен `FAIL_CODE`: обе ручки пользователей подменены и отвечают ошибкой, мимо журнала. Ответ всё равно приходит — с данными, `author: null` и списком ошибок.',
  },
];

export const RESOLVER_CAPTION =
  'Ответ, журнал «базы» и ошибки считает исполнитель `execute` с резолверами и загрузчиком из темы. Резолверы в журнале — те, у которых есть своя функция.';

// ─── Раздел 5. GraphQL на проводе ──────────────────────────────────────────────────────────

export const APQ_HASH = '83437cd0c319f958811fbab8712fe90bc5eb59d1e077df4bff3fd473ef26ee52';

export const APQ_CODE = `// 1. Хеш sha256 от текста запроса. В адресе JSON закодирован, здесь — для чтения
GET /graphql?extensions={"persistedQuery":{"version":1,"sha256Hash":"83437cd0c319…"}}
← 200  Cache-Control: no-store
  {"errors":[{"message":"PersistedQueryNotFound","extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}

// 2. Сервер хеша не знает — тот же хеш вместе с текстом
POST /graphql
  {"query":"query Orders { … }","extensions":{"persistedQuery":{…}}}
← 200  {"data":{"orders":[…]}}

// 3. Дальше — только хеш, а ответ можно кешировать
GET /graphql?extensions={"persistedQuery":{"version":1,"sha256Hash":"83437cd0c319…"}}
← 200  Cache-Control: public, max-age=60  ETag: "HKkSG9vnmrhvs5TR"
  {"data":{"orders":[…]}}`;

export const PLAIN_APQ =
  'Как заказ «как обычно» в кофейне, где вас знают. В первый раз вы диктуете всё: «капучино на овсяном, без сахара». Бариста запоминает, и дальше достаточно сказать «как обычно». Хеш — это «как обычно», а `PersistedQueryNotFound` — «извините, я вас ещё не знаю».';

export const APQ_FACTS = [
  {
    t: 'Короче и кешируется',
    d: 'Запрос с хешем короче: `GET` с заголовками стенда — 263 байта, `POST` с текстом запроса — 320. Главное не размер: у `GET` есть адрес, и ответ с `Cache-Control` ложится в кеш браузера и CDN.',
    tone: 'ok' as const,
  },
  {
    t: 'Автоматические — не защита',
    d: 'Сервер выше запоминает любой запрос, который ему прислали с правильным хешем. Атакующий так же зарегистрирует свой. Защищает только список разрешённых запросов, собранный при сборке клиента (trusted documents): незнакомый хеш — отказ, текст запроса сервер не принимает вовсе.',
    tone: 'warn' as const,
  },
  {
    t: '`GET` — ещё и без preflight',
    d: '`POST` с `Content-Type: application/json` на другой источник браузер предваряет запросом `OPTIONS`. `GET` без своих заголовков — простой запрос, preflight ему не нужен.',
  },
];

export const DEPTH_ROWS = [
  {
    levels: 1,
    depth: 3,
    query: 52,
    resolvers: 6,
    response: 241
  },
  {
    levels: 2,
    depth: 5,
    query: 74,
    resolvers: 20,
    response: 537
  },
  {
    levels: 3,
    depth: 7,
    query: 96,
    resolvers: 46,
    response: 1105
  },
  {
    levels: 4,
    depth: 9,
    query: 118,
    resolvers: 96,
    response: 2217
  },
  {
    levels: 5,
    depth: 11,
    query: 140,
    resolvers: 194,
    response: 4417
  },
  {
    levels: 6,
    depth: 13,
    query: 162,
    resolvers: 388,
    response: 8793
  }
];

export const DEPTH_NOTE =
  'Каждый уровень `orders { author { … } }` добавляет к запросу 22 байта, а работу сервера почти удваивает: у автора в «базе» один-два заказа. У настоящего пользователя их пятьдесят — и тогда каждый уровень множит работу на пятьдесят. Защиты складываются: предел глубины, оценка стоимости по `first` на каждом списке, потолок самого `first`, таймаут на запрос и список разрешённых запросов.';

export const FAIL_CODE = `db.user = db.usersByIds = () => Promise.reject(new Error('users: timeout'));`;

export const FAIL_RESPONSE = `{
  "errors": [
    { "message": "users: timeout", "path": ["orders", 0, "author"] },
    { "message": "users: timeout", "path": ["orders", 2, "author"] },
    … ещё 3: заказы 1, 4, 3
  ],
  "data": {
    "orders": [
      { "id": "o1001", "status": "paid", "author": null, "items": [ … ] },
      …
    ]
  }
}`;

export const STATUS_FACTS = [
  {
    t: 'Частичный успех — это `200`',
    d: 'Ответ с `data` и `errors` сразу — нормальный ответ GraphQL: остальные поля посчитаны. Черновик GraphQL over HTTP требует для него `2xx`. С `Content-Type: application/json` — `200` вообще на всё, включая неверный запрос.',
  },
  {
    t: 'Мониторинг по статусам слепнет',
    d: 'Доля ошибок по кодам HTTP у GraphQL-сервера — ноль, даже когда лёг сервис пользователей. Считать надо записи в `errors` и их `path`, а клиент обязан проверять `errors`, а не `response.ok`.',
    tone: 'err' as const,
  },
  {
    t: '`!` уносит null выше',
    d: 'Если поле объявлено `author: User!`, null на его место поставить нельзя — и null уходит к ближайшему полю, которому можно. На стенде с `author: User!` graphql 17 вернул `orders: [null, null, null, null, null]`: пропали целые заказы, а не имена.',
    tone: 'warn' as const,
  },
];

export const NONNULL_DATA = '{"orders":[null,null,null,null,null]}';

// ─── Раздел 6. gRPC-web ────────────────────────────────────────────────────────────────────

export const PROTO_FILE = `syntax = "proto3";
package shop;

service OrderService {
  rpc ListOrders (ListOrdersRequest) returns (ListOrdersResponse);
}

message ListOrdersRequest { int32 first = 1; }
message ListOrdersResponse { repeated Order orders = 1; }

message Order {
  string id = 1;
  string status = 2;
  User author = 3;
  repeated Item items = 4;
}
message User { string name = 1; }
message Item {
  int32 qty = 1;
  Product product = 2;
}
message Product {
  string title = 1;
  int32 price = 2;
}`;

export const PLAIN_VARINT =
  'Как запись суммы купюрами по 128. Сначала кладёте остаток меньше 128, потом считаете, сколько ещё полных «сотен-двадцать-восемь». На каждой бумажке, кроме последней, — пометка «это не всё». 150 — это бумажка «22, не всё» и бумажка «1».';

export const PROTO_CODE = `// Схема из .proto: номер поля, имя, тип. В байты попадут только номера.
const PROTO = {
  ListOrdersRequest: [[1, 'first', 'int32']],
  ListOrdersResponse: [[1, 'orders', 'Order', 'repeated']],
  Order: [[1, 'id', 'string'], [2, 'status', 'string'], [3, 'author', 'User'], [4, 'items', 'Item', 'repeated']],
  User: [[1, 'name', 'string']],
  Item: [[1, 'qty', 'int32'], [2, 'product', 'Product']],
  Product: [[1, 'title', 'string'], [2, 'price', 'int32']],
};

// Varint: по 7 бит числа в байт, младшие вперёд; старший бит — «будет ещё байт».
function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

// Ключ поля = (номер << 3) | тип провода: 0 — varint, 2 — длина и байты.
function encode(schema, type, msg) {
  const out = [];
  for (const [num, name, kind, rule] of schema[type]) {
    const values = rule === 'repeated' ? (msg[name] ?? []) : [msg[name]];
    for (const v of values) {
      if (v == null || v === 0 || v === '') continue; // значение по умолчанию не пишется
      if (kind === 'int32') {
        out.push(...varint((num << 3) | 0), ...varint(v));
        continue;
      }
      const bytes = kind === 'string' ? [...new TextEncoder().encode(v)] : encode(schema, kind, v);
      out.push(...varint((num << 3) | 2), ...varint(bytes.length), ...bytes);
    }
  }
  return out;
}

// Разбор без схемы: видны номера полей и типы провода, но не имена.
function decodeRaw(bytes, start = 0, end = bytes.length) {
  const fields = [];
  let pos = start;
  const readVarint = () => {
    let n = 0, mul = 1, b;
    do {
      b = bytes[pos++];
      n += (b & 127) * mul;
      mul *= 128;
    } while (b & 128);
    return n;
  };
  while (pos < end) {
    const at = pos;
    const key = readVarint();
    const field = key >> 3, wire = key & 7;
    if (wire === 0) {
      fields.push({ at, field, wire, value: readVarint(), end: pos });
    } else if (wire === 2) {
      const len = readVarint();
      fields.push({ at, field, wire, from: pos, end: pos + len });
      pos += len;
    } else {
      throw new Error(\`тип провода \${wire} в примере не встречается\`);
    }
  }
  return fields;
}

// gRPC-web: сообщение в кадре — флаг (1 байт), длина (4 байта), тело.
// Флаг 0x80 — кадр трейлеров: статус едет в теле, текстом, как заголовки.
function grpcWebFrame(flag, bytes) {
  const n = bytes.length;
  return [flag, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...bytes];
}

// Ответ целиком: кадр с сообщением и кадр трейлеров со статусом «успех».
function grpcWebResponse(message) {
  const trailers = [...new TextEncoder().encode('grpc-status:0\\r\\ngrpc-message:\\r\\n')];
  return [...grpcWebFrame(0x00, message), ...grpcWebFrame(0x80, trailers)];
}`;

/** Все строки кода темы — для демо. Склеиваются в этом порядке в `loadApi`. */
export const CODES: ApiCodes = {
  schema: SCHEMA_CODE,
  loader: LOADER_CODE,
  resolvers: RESOLVERS_CODE,
  gql: GQL_CODE,
  rest: REST_CODE,
  proto: PROTO_CODE,
};

/** Примеры из спецификации protobuf «Encoding». Тест кодирует их `encode` и сверяет байты. */
export const PROTO_VECTORS = [
  { msg: 'message Test1 { int32 a = 1; }', value: '`a: 150`', bytes: '08 96 01', d: 'ключ `08` = поле 1 << 3 | тип 0; `96 01` — varint 150' },
  { msg: 'message Test2 { string b = 2; }', value: '`b: "testing"`', bytes: '12 07 74 65 73 74 69 6e 67', d: 'ключ `12` = поле 2 << 3 | тип 2; длина 7; байты UTF-8' },
  { msg: 'message Test3 { Test1 c = 3; }', value: '`c: { a: 150 }`', bytes: '1a 03 08 96 01', d: 'вложенное сообщение — те же байты `Test1` с ключом и длиной' },
];

/** Байты первого заказа: ключ, длина, содержимое. Сверяет тест. */
export const ORDER_BYTES = [
  {
    k: "orders[0]",
    head: "0a 6c",
    body: "",
    d: "поле 1 ответа, сообщение Order на 108 байт"
  },
  {
    k: "id",
    head: "0a 05",
    body: "6f 31 30 30 31",
    d: "поле 1, строка 5 байт: «o1001»"
  },
  {
    k: "status",
    head: "12 04",
    body: "70 61 69 64",
    d: "поле 2, строка 4 байта: «paid»"
  },
  {
    k: "author",
    head: "1a 1b",
    body: "",
    d: "поле 3, сообщение User на 27 байт"
  },
  {
    k: "author.name",
    head: "0a 19",
    body: "d0 90 d0 bd … (25)",
    d: "поле 1, строка 25 байт: «Анна Смирнова»"
  },
  {
    k: "items[0]",
    head: "22 29",
    body: "",
    d: "поле 4, сообщение Item на 41 байт"
  },
  {
    k: "items[0].qty",
    head: "08",
    body: "02",
    d: "поле 1, varint: 2"
  },
  {
    k: "items[0].product",
    head: "12 25",
    body: "",
    d: "поле 2, сообщение Product на 37 байт"
  },
  {
    k: "items[0].product.title",
    head: "0a 20",
    body: "d0 9a d0 be … (32)",
    d: "поле 1, строка 32 байта: «Кофе в зёрнах, 1 кг»"
  },
  {
    k: "items[0].product.price",
    head: "10",
    body: "e2 0e",
    d: "поле 2, varint: 1890"
  },
  {
    k: "items[5]",
    head: "22 15",
    body: "",
    d: "поле 4, сообщение Item на 21 байт"
  },
  {
    k: "items[5].qty",
    head: "08",
    body: "01",
    d: "поле 1, varint: 1"
  },
  {
    k: "items[5].product",
    head: "12 11",
    body: "",
    d: "поле 2, сообщение Product на 17 байт"
  },
  {
    k: "items[5].product.title",
    head: "0a 0c",
    body: "d0 9a d1 80 … (12)",
    d: "поле 1, строка 12 байт: «Кружка»"
  },
  {
    k: "items[5].product.price",
    head: "10",
    body: "8a 05",
    d: "поле 2, varint: 650"
  }
];

/** Из чего состоят байты первого заказа в JSON и protobuf. Сверяет тест. */
export const ORDER_PARTS = [
  {
    k: "текст: id, статус, имя, названия",
    json: 78,
    proto: 78
  },
  {
    k: "числа: количество и цены",
    json: 9,
    proto: 6
  },
  {
    k: "разметка: имена полей, кавычки, скобки / ключи и длины",
    json: 134,
    proto: 24
  },
  {
    k: "всего",
    json: 221,
    proto: 108
  }
];

/** Сообщение всего экрана: сырые байты и после сжатия. Пересобирает тест через `node:zlib`. */
export const SIZE_ROWS = [
  {
    k: "без сжатия",
    json: 1094,
    proto: 522
  },
  {
    k: "gzip",
    json: 353,
    proto: 315
  },
  {
    k: "brotli",
    json: 290,
    proto: 282
  }
];

export const SIZE_NOTE =
  'Без сжатия protobuf вдвое короче: имена полей заменены номерами, кавычек и скобок нет. После gzip разница 11%, после brotli — 3%: сжатие хорошо убирает именно повторы `"product":{"title":`. Текст на кириллице — по два байта на букву — одинаков в обоих форматах. Выигрыш protobuf в другом: схема, строгие типы и разбор без парсинга текста.';

export const PLAIN_TRAILERS =
  'Как накладная, которую водитель отдаёт после разгрузки. Пока коробки носят, никто не знает, все ли доехали. Подпись «принято полностью» или «две коробки битые» появляется в конце. gRPC так же сообщает статус вызова — после тела.';

export const TRAILER_FACTS = [
  {
    t: 'Node-клиент видит статус',
    d: 'Ответ `node:http2`-сервера: заголовки, тело на 527 байт (кадр 5 + сообщение) и трейлеры `grpc-status: 0`, `grpc-message: ""`. Клиент `node:http2` получил трейлеры отдельным событием.',
    tone: 'ok' as const,
  },
  {
    t: '`fetch` в Chromium — нет',
    d: 'Тот же ответ по `h2` в Chromium 153: статус `200`, тело на 527 байт, заголовки `access-control-allow-origin`, `content-type`, `date`. `grpc-status` нет ни в `headers`, ни где-либо ещё: у `Response` нет свойства для трейлеров.',
    tone: 'err' as const,
  },
  {
    t: 'Без статуса сбой не отличить',
    d: 'Сервер отдал 9 байт тела (кадр обещал 522) и трейлеры `grpc-status: 13`, `grpc-message: database gone`. Chromium: `200`, `ok: true`, 9 байт — и ни слова о сбое.',
    tone: 'warn' as const,
  },
];

export const WEB_FRAME_CODE = `// Запрос: ListOrdersRequest { first: 5 } в одном кадре, 7 байт
00 00 00 00 02 08 05
│  └─ длина 2┘ └ поле 1 = 5
└ флаг 0: сообщение

// Ответ: кадр с сообщением и кадр с трейлерами
00 00 00 02 0a  …522 байта ListOrdersResponse…
80 00 00 00 1e  grpc-status:0\\r\\ngrpc-message:\\r\\n
└ флаг 0x80: трейлеры, текстом`;

export const WEB_NOTE =
  'gRPC-web переносит трейлеры в тело: последним кадром с флагом `0x80` и текстом как у заголовков. Тогда ответ можно прочитать обычным `fetch`, и по HTTP/1.1 тоже. Настоящий gRPC-сервер такого не умеет — между браузером и ним ставят прокси (по документации grpc-web это Envoy) или сервер, который говорит на обоих протоколах. Потоки от клиента и в обе стороны gRPC-web не поддерживает: только один ответ или поток от сервера.';

// ─── Раздел 7. Что выбрать ─────────────────────────────────────────────────────────────────

export const CHOOSE_ROWS = [
  {
    k: 'REST',
    good: 'Публичное API, данные для многих клиентов, тяжёлый кеш на CDN, файлы и простые формы.',
    cost: 'Водопад и лишние поля на сложных экранах; под каждый экран — свой адрес или BFF.',
  },
  {
    k: 'GraphQL',
    good: 'Много разных экранов над одним графом данных; клиент сам выбирает поля; одна схема с типами на фронт и бэк.',
    cost: 'N+1 и защита от тяжёлых запросов — ваша работа; кеш HTTP только через persisted queries; ошибки при `200`.',
  },
  {
    k: 'gRPC-web',
    good: 'Внутренние сервисы уже на gRPC; строгая схема и генерация клиента; длинные потоки от сервера.',
    cost: 'Прокси между браузером и сервером; двоичный ответ не прочитать в DevTools без схемы; кеша HTTP нет — всегда `POST`.',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'GraphQL не убирает N+1 — он его прячет',
    d: 'Клиент шлёт один запрос, и кажется, что всё дёшево. Внутри сервер на экране из пяти заказов сходил в базу 16 раз. Без загрузчика каждый новый список в запросе умножает походы в базу.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Общий загрузчик на весь сервер',
    d: 'Кеш DataLoader, созданный один раз при старте, хранит данные между запросами разных пользователей и отдаёт их без проверки прав. Загрузчик создают на каждый запрос, в контексте.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`response.ok` у GraphQL ничего не значит',
    d: 'Сервис пользователей лёг — а ответ `200`, и в `data` пять заказов с `author: null`. Проверять надо поле `errors`. Мониторинг по кодам HTTP такой сбой не видит.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Запрос в 118 байт — почти сотня резолверов',
    d: 'Цикл в схеме (`Order.author` → `User.orders`) позволяет написать запрос любой глубины. Работа сервера растёт в разы на каждом уровне, а размер запроса — на 22 байта. Предел глубины и стоимости ставят до исполнения.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Automatic persisted queries — про кеш, а не про безопасность',
    d: 'Сервер с APQ запоминает любой присланный запрос. Закрыть API от произвольных запросов может только список разрешённых, собранный при сборке клиента.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`ETag` у REST экономит тело, но не запрос',
    d: 'С `no-cache` браузер всё равно идёт к серверу, просто получает `304` без тела. Без сети обходится только `max-age` — у заказов на стенде был `no-cache`, и это единственный запрос второго захода.',
  },
  {
    n: '07',
    t: 'protobuf без схемы — номера и байты',
    d: 'В ответе нет имён полей: `0a 05 6f 31 30 30 31` — «поле 1, строка из 5 байт». Чтобы прочитать ответ в DevTools или логе, нужна та же версия `.proto`. Номер поля, однажды выданный, не переиспользуют: старый клиент прочитает новое поле как старое.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Двоичный формат не равен «втрое меньше»',
    d: 'Сырым protobuf вдвое короче JSON, но после gzip разница — 11%, после brotli — 3%. Текст занимает столько же, а повторы имён сжатие и так убирает.',
  },
  {
    n: '09',
    t: 'Браузер не видит трейлеры',
    d: '`fetch` по HTTP/2 читает заголовки и тело, а трейлеры отбрасывает. Поэтому чистый gRPC из браузера не работает: статус вызова потерялся бы. gRPC-web кладёт его в тело последним кадром.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'GraphQL Specification — Execution',
    href: 'https://spec.graphql.org/October2021/#sec-Execution',
    what: 'исполнение полей, резолверы, ошибки поля и распространение null через `!`',
  },
  {
    title: 'GraphQL over HTTP (черновик)',
    href: 'https://graphql.github.io/graphql-over-http/draft/',
    what: '`application/graphql-response+json`, `GET` и `POST`, коды статусов для частичного успеха',
  },
  {
    title: 'graphql-js',
    href: 'https://github.com/graphql/graphql-js',
    what: 'эталонный исполнитель; версия 17.0.2 на стенде, с ним сверен учебный `execute`',
  },
  {
    title: 'DataLoader',
    href: 'https://github.com/graphql/dataloader',
    what: 'батчинг за один тик, кеш на запрос, требования к `batchFn`',
  },
  {
    title: 'Apollo — Automatic persisted queries',
    href: 'https://www.apollographql.com/docs/apollo-server/performance/apq',
    what: 'протокол APQ: хеш sha256, `PersistedQueryNotFound`, `GET` для кеша на CDN',
  },
  {
    title: 'GraphQL — Security',
    href: 'https://graphql.org/learn/security/',
    what: 'глубина и стоимость запроса, таймауты, trusted documents',
  },
  {
    title: 'Protocol Buffers — Encoding',
    href: 'https://protobuf.dev/programming-guides/encoding/',
    what: 'varint, ключ поля и типы провода, примеры `08 96 01`, `12 07 74 65 73 74 69 6e 67`',
  },
  {
    title: 'gRPC over HTTP/2',
    href: 'https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md',
    what: 'кадр сообщения 5 + N байт, статус вызова в трейлерах',
  },
  {
    title: 'gRPC-web protocol',
    href: 'https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-WEB.md',
    what: 'трейлеры в теле кадром с флагом `0x80`, `application/grpc-web+proto`',
  },
  {
    title: 'grpc-web',
    href: 'https://github.com/grpc/grpc-web',
    what: 'прокси Envoy между браузером и сервером, поддерживаемые виды вызовов',
  },
  {
    title: 'JSON:API — Inclusion of related resources',
    href: 'https://jsonapi.org/format/#fetching-includes',
    what: 'параметр `include` против водопада REST',
  },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — `Cache-Control`, `ETag` и `304` подробно. [Сеть и кеширование, раздел «Preflight и его кеш»](/platform/network/#s3) — когда `POST` с JSON вызывает `OPTIONS`. [CDN и серверный кеш, раздел «Ключ и Vary»](/platform/cdn-cache/#s2) — почему общий кеш хранит только `GET`. [HTTP/2 и HTTP/3, раздел «Кадры»](/platform/http2-http3/#s2) — кадры HEADERS и DATA, из которых складываются трейлеры. [Кеш данных на клиенте, раздел «Кеш по ключу»](/frameworks/data-cache/#s2) — где клиент держит ответы API после того, как они пришли. [Безопасность бэкенда, раздел «Чужой объект по id»](/platform/backend-security/#s1) — проверка владельца, которая нужна каждому резолверу.';
