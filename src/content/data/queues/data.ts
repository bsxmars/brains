import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Final, QueueScenario, RawStep, Step } from '@/widgets/queue-lab/model/types';

/**
 * Данные темы «Очереди и идемпотентность: ровно один раз не бывает».
 *
 * Тема написана здесь, 2026-10-01, четвёртой в направлении «Данные и бэкенд».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Три стенда, все на этой машине, октябрь 2026, Node 24.11.0.
 *
 * 1. **Redis 7.4.11 + PGlite.** Redis — Docker `redis:7-alpine` (образ был на машине, `INFO
 *    server` → `redis_version:7.4.11`), без файла настроек, порт 127.0.0.1:53611; клиент —
 *    ioredis 5.11.1 из `node_modules`. База — `@electric-sql/pglite` 0.5.8 (`PostgreSQL 18.3`)
 *    в том же процессе, схема `SCHEMA_SQL`. Учебные функции темы (строки `*_CODE` ниже) гонялись
 *    с `env`, где `redis.call` уходит в настоящий Redis, `db.exec` — в PGlite, а пауза — настоящий
 *    `setTimeout`. Так сняты:
 *      — `STAND_RUNS`: журнал и итог каждого сценария демо (`SCENARIOS`);
 *      — `STAND_FULL`: перебор точек падения — 12 вариантов кода (три издателя × четыре
 *        обработчика) на расписании `FULL_SCHEDULE`, по прогону на каждую метку `point`;
 *      — `INTRO_LOG`, `SLOW_LOG`, `TRIM_LOG`: команды Redis напрямую (`RAW_*`).
 *    Нормализация одна: номера записей Redis (`1790885348379-0`) заменены на `1-0`, `2-0`… по
 *    порядку появления (`normalizeIds` в `widgets/queue-lab/model/run.ts`). Время простоя
 *    в ответе `XPENDING` в журнал не попадает — это часы; `showReply` печатает только номер,
 *    владельца и счётчик доставок.
 *
 * 2. **Два сеанса Postgres 16.15** — Docker `postgres:16-alpine` (`PostgreSQL 16.15 on
 *    aarch64-unknown-linux-musl`), два процесса `docker exec -i … psql -X -A -t` с `\set VERBOSITY
 *    verbose`, как в теме «Транзакции и уровни изоляции». Шаг «ждёт», если сеанс стоит
 *    в `pg_stat_activity` с `wait_event_type = 'Lock'`. Так сняты `PG_RUNS`: одновременная
 *    вставка ключа с `ON CONFLICT DO NOTHING` (фиксация и откат первого), «проверить, потом
 *    сделать» без ошибки, тот же ключ на Repeatable Read и дыра в номерах outbox.
 *
 * 3. Учебная модель — те же строки с `createBroker` (Redis Streams в памяти) и `createDb`
 *    (таблицы в памяти, те же тексты `SQL`) и виртуальными часами. Она и считает демо.
 *
 * Оба контейнера удалены после стенда.
 *
 * ── Тест ──────────────────────────────────────────────────────────────────────────────────
 * `tests/unit/queues.test.ts` всегда: модель шаг в шаг против `STAND_RUNS`, `STAND_FULL`,
 * `SLOW_LOG`, `TRIM_LOG`; модель против PGlite (тот же код, настоящая база, учебный Redis);
 * свойство «эффект ровно один раз» для outbox + идемпотентного обработчика при любом одном
 * и любых двух падениях; таблицы и числа текста — из литералов. Живой Redis пересобирает
 * литералы при `QUEUES_REDIS_CONTAINER` (имя контейнера `redis:7-alpine` с опубликованным портом
 * 6379), живой Postgres — `PG_RUNS` при `QUEUES_PG_CONTAINER` (`postgres:16-alpine`, база
 * `qlab`). Без переменных эти блоки пропускаются.
 *
 * ── Что взято из документации, а не со стенда ────────────────────────────────────────────
 *   — таблица `BROKER_ROWS` про RabbitMQ, SQS и Kafka: `basic.ack` и возврат неподтверждённых
 *     при закрытии канала, `x-delivery-count` у quorum-очередей; таймаут видимости SQS
 *     (по умолчанию 30 с), `ApproximateReceiveCount`, `maxReceiveCount`; смещения Kafka
 *     и порядок только внутри партиции; «exactly once» Kafka — внутри Kafka;
 *   — `XINFO GROUPS` учебная модель не реализует: `INTRO_LOG` пересобирается только живым Redis;
 *   — ретранслятор, читающий журнал изменений Postgres (Debezium), — по документации Debezium;
 *   — что сеть рвёт трассу на очереди — тема «Наблюдаемость».
 *
 * ── Чем модель проще настоящих ────────────────────────────────────────────────────────────
 * У учебного Redis один номер записей на все потоки (`1-0`, `2-0`…), у настоящего — время
 * в миллисекундах и свой счёт в каждом потоке. Учебная база — одна сессия: транзакция
 * в ней одна в каждый момент, ожиданий на блокировках нет (их показывают `PG_RUNS`).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'очередь (брокер сообщений)',
    d: 'Сервер, который принимает сообщения от одних программ и раздаёт другим. Отправитель кладёт сообщение и не ждёт, пока его обработают. Примеры: Redis Streams, RabbitMQ, Amazon SQS, Kafka.',
  },
  {
    k: 'Redis Streams',
    d: 'Тип данных Redis — журнал записей с номерами вида `1-0`, `2-0`. `XADD` дописывает запись в конец. Прочитанная запись из журнала не пропадает.',
  },
  {
    k: 'группа потребителей',
    d: 'Несколько обработчиков, которые делят один поток: каждую запись группа выдаёт кому-то одному. Группа помнит, докуда она уже выдала записи.',
  },
  {
    k: 'подтверждение (ack)',
    d: 'Сообщение брокеру «эту запись я обработал». В Redis — команда `XACK`. Пока подтверждения нет, запись числится за обработчиком и может быть выдана снова.',
  },
  {
    k: 'список ожидания (PEL)',
    d: 'Pending Entries List — записи, которые группа уже выдала, а подтверждения по ним ещё нет: номер, кому выдана и сколько раз. Смотрят его командой `XPENDING`.',
  },
  {
    k: 'эффект',
    d: 'То, ради чего сообщение обрабатывают: начислить бонусы, отправить письмо, списать деньги. Повтор опасен именно эффектом — прочитать сообщение дважды не страшно, начислить дважды страшно.',
  },
  {
    k: 'таймаут видимости',
    d: 'Сколько выданное сообщение может висеть без подтверждения, прежде чем его отдадут другому обработчику. Термин из Amazon SQS. В Redis это аргумент `XAUTOCLAIM` — минимальное время простоя.',
  },
  {
    k: 'идемпотентная обработка',
    d: 'Обработка, которую можно повторить с тем же сообщением сколько угодно раз, а итог будет как от одного раза.',
  },
  {
    k: 'ключ идемпотентности',
    d: 'Метка, по которой обработчик узнаёт повтор: номер заказа, платежа, события. Ключ задаёт тот, кто создал событие, а не очередь.',
  },
  {
    k: 'outbox',
    d: 'Таблица исходящих событий в той же базе, что и данные. Событие пишется в неё той же транзакцией, что и изменение, а в очередь его переносит отдельный процесс — ретранслятор.',
  },
];

export const PLAIN_QUEUE =
  'Как лоток для заявок в бухгалтерии. Менеджер кладёт заявку и уходит, не дожидаясь бухгалтера. Бухгалтер берёт заявку, проводит платёж и ставит штамп «исполнено». Если бухгалтеру стало плохо между платежом и штампом, сменщик увидит заявку без штампа и проведёт платёж ещё раз. А если штамп ставят до платежа, сменщик заявку пропустит — и платежа не будет вовсе.';

export const PREREQ_NOTE = 'Тема опирается на три вещи, и все три разобраны на сайте.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Транзакция: всё или ничего',
    d: 'Команды между `BEGIN` и `COMMIT` применяются вместе или не применяются вовсе. Если процесс упал до `COMMIT`, Postgres сам отменит всё, что транзакция успела сделать.',
    href: '/data/transactions/#s1',
    hrefLabel: '«Транзакции и уровни изоляции», раздел «Что обещает транзакция»',
    tone: 'info',
  },
  {
    t: 'Redis и его команды',
    d: 'Redis — сервер в памяти, к которому ходят по сети командами вроде `GET` и `SET`. Здесь понадобятся команды другого типа данных — потоков, но устроены они так же: имя команды и аргументы.',
    href: '/data/redis-cache/#s1',
    hrefLabel: '«Кеш перед базой», раздел «Cache-aside»',
    tone: 'info',
  },
  {
    t: 'Повтор запроса и идемпотентность',
    d: 'Запрос, на который не пришёл ответ, повторяют — и сервер может выполнить его второй раз. Безопасно повторять только то, что даёт тот же итог при повторе. Для `POST` это делают ключом `Idempotency-Key`.',
    href: '/delivery/load-balancing/#s6',
    hrefLabel: '«Балансировка нагрузки», раздел «Повторы»',
    tone: 'info',
  },
];

// ─── Раздел 1. Зачем очередь ───────────────────────────────────────────────────────────────

export const WHY_ROWS: { t: string; d: string }[] = [
  {
    t: 'Отправитель не ждёт',
    d: 'Сервис заказов кладёт событие и сразу отвечает покупателю. Ему не важно, жив ли сейчас обработчик бонусов и сколько тот думает. Упал обработчик — события копятся и ждут.',
  },
  {
    t: 'Пик превращается в хвост',
    d: 'В распродажу заказов в десять раз больше, чем обычно. Обработчик берёт их со своей скоростью, а очередь растёт. Это видно по счётчику `lag` — сколько записей группа ещё не выдала.',
  },
  {
    t: 'Сбой превращается в повтор',
    d: 'Если обработчик упал посреди работы, запись не пропадает: она остаётся за ним неподтверждённой и достанется другому. Из этого же свойства растут дубли — вся тема про то, как с ними жить.',
  },
];

export const EXAMPLE_TEXT =
  'Пример на всю тему — магазин. Заказ `o-1` на 1000 рублей оплачен, и пользователю 7 положено 10 бонусов. Сервис заказов публикует событие в поток `events`, обработчики группы `bonus` начисляют бонусы в таблицу `wallets`. Ошибку легко увидеть по счёту: 10 бонусов — эффект случился один раз, 0 — потерялся, 20 — случился дважды.';

export const SCHEMA_SQL = `CREATE TABLE orders (
  id      text PRIMARY KEY,
  user_id int  NOT NULL,
  total   int  NOT NULL
);
CREATE TABLE outbox (
  id       bigserial PRIMARY KEY,
  event_id text NOT NULL,
  user_id  int  NOT NULL,
  points   int  NOT NULL,
  sent_at  timestamptz            -- NULL — ещё не опубликовано
);
CREATE TABLE wallets (
  user_id int PRIMARY KEY,
  points  int NOT NULL
);
CREATE TABLE processed (
  event_id text PRIMARY KEY      -- ключ идемпотентности
);
INSERT INTO wallets VALUES (7, 0);`;

export const SQL_CODE = `const SQL = {
  insertOrder: 'INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)',
  insertOutbox: 'INSERT INTO outbox (event_id, user_id, points) VALUES ($1, $2, $3)',
  pickOutbox: 'SELECT id, event_id, user_id, points FROM outbox WHERE sent_at IS NULL ORDER BY id',
  markSent: 'UPDATE outbox SET sent_at = now() WHERE id = $1',
  addPoints: 'UPDATE wallets SET points = points + $2 WHERE user_id = $1',
  markProcessed: 'INSERT INTO processed (event_id) VALUES ($1) ON CONFLICT DO NOTHING',
  wasProcessed: 'SELECT 1 FROM processed WHERE event_id = $1',
  countOrders: 'SELECT count(*)::int AS n FROM orders',
  walletPoints: 'SELECT points FROM wallets WHERE user_id = 7',
};`;

/** Команды Redis напрямую: три события, один обработчик, одно подтверждение. */
export const RAW_INTRO: RawStep[] = [
  [
    "P",
    "XGROUP",
    "CREATE",
    "events",
    "bonus",
    "$",
    "MKSTREAM"
  ],
  [
    "P",
    "XADD",
    "events",
    "*",
    "event",
    "o-1",
    "user",
    "7",
    "points",
    "10"
  ],
  [
    "P",
    "XADD",
    "events",
    "*",
    "event",
    "o-2",
    "user",
    "7",
    "points",
    "30"
  ],
  [
    "P",
    "XADD",
    "events",
    "*",
    "event",
    "o-3",
    "user",
    "8",
    "points",
    "5"
  ],
  [
    "P",
    "XINFO",
    "GROUPS",
    "events"
  ],
  [
    "w1",
    "XREADGROUP",
    "GROUP",
    "bonus",
    "w1",
    "COUNT",
    "2",
    "STREAMS",
    "events",
    ">"
  ],
  [
    "w1",
    "XINFO",
    "GROUPS",
    "events"
  ],
  [
    "w1",
    "XACK",
    "events",
    "bonus",
    "1-0"
  ],
  [
    "w1",
    "XINFO",
    "GROUPS",
    "events"
  ],
  [
    "w1",
    "XLEN",
    "events"
  ]
];

/** Журнал `RAW_INTRO` на настоящем Redis 7.4.11. Пересобирается живым тестом. */
export const INTRO_LOG: string[] = [
  "P: XGROUP CREATE events bonus $ MKSTREAM → OK",
  "P: XADD events * event o-1 user 7 points 10 → 1-0",
  "P: XADD events * event o-2 user 7 points 30 → 2-0",
  "P: XADD events * event o-3 user 8 points 5 → 3-0",
  "P: XINFO GROUPS events → pending 0, lag 3",
  "w1: XREADGROUP GROUP bonus w1 COUNT 2 STREAMS events > → 1-0 {event o-1 user 7 points 10}, 2-0 {event o-2 user 7 points 30}",
  "w1: XINFO GROUPS events → pending 2, lag 1",
  "w1: XACK events bonus 1-0 → (integer) 1",
  "w1: XINFO GROUPS events → pending 1, lag 1",
  "w1: XLEN events → (integer) 3"
];

export const INTRO_NOTE =
  'Три события легли в поток, хотя ни одного обработчика ещё нет: `lag 3`. Обработчик `w1` взял два — они ушли из `lag` в `pending`: выданы, но не подтверждены. После `XACK` одна запись ушла и из `pending`. А длина потока осталась 3: подтверждение убирает запись из списка ожидания, а не из потока. Поток — журнал, его обрезают отдельно, `XADD … MAXLEN` или `XTRIM`.';

export const BROKER_ROWS: { k: string; redis: string; rabbit: string; sqs: string; kafka: string }[] = [
  {
    k: 'подтвердить',
    redis: '`XACK`',
    rabbit: '`basic.ack`',
    sqs: '`DeleteMessage`',
    kafka: 'сохранить смещение (commit offset)',
  },
  {
    k: 'выдано, не подтверждено',
    redis: 'список ожидания, `XPENDING`',
    rabbit: 'unacked у канала',
    sqs: 'in flight — скрыто от других',
    kafka: 'всё после сохранённого смещения',
  },
  {
    k: 'когда выдадут снова',
    redis: 'когда кто-то заберёт: `XAUTOCLAIM`, `XCLAIM`',
    rabbit: 'когда закроется канал или соединение',
    sqs: 'сам, через таймаут видимости (по умолчанию 30 с)',
    kafka: 'после перезапуска — с сохранённого смещения',
  },
  {
    k: 'счётчик доставок',
    redis: 'в `XPENDING`',
    rabbit: '`x-delivery-count` у quorum-очередей',
    sqs: '`ApproximateReceiveCount`',
    kafka: 'нет',
  },
];

export const BROKER_NOTE =
  'Слова у брокеров разные, механика одна: выданное и неподтверждённое сообщение не исчезает и будет выдано снова. Различается только, кто и когда его вернёт. Redis не возвращает ничего сам — это делают живые обработчики, и в этом удобство примера: каждое действие видно отдельной командой.';

// ─── Раздел 2. Подтверждение: до работы или после ─────────────────────────────────────────

export const CONSUMER_CODE = `const STREAM = 'events';
const GROUP = 'bonus';
const DEAD = 'events:dead';
const VISIBILITY_MS = 200;   // столько сообщение может висеть без XACK
const MAX_DELIVERIES = 3;    // после стольких попыток — в очередь мёртвых писем

// ['event', 'o-1', 'user', '7', …] → { id, event: 'o-1', user: '7', … }
function fieldsToMsg(id, fields) {
  const msg = { id };
  for (let i = 0; i < fields.length; i += 2) msg[fields[i]] = fields[i + 1];
  return msg;
}

// Новые сообщения: '>' — те, что группа ещё никому не выдавала. Нет новых — null.
async function readNew(ctx) {
  const reply = await ctx.redis.call('XREADGROUP', 'GROUP', GROUP, ctx.me, 'COUNT', '1', 'STREAMS', STREAM, '>');
  for (const [id, fields] of reply?.[0][1] ?? []) await deliver(ctx, fieldsToMsg(id, fields));
}

async function deliver(ctx, msg) {
  await ctx.point('получил ' + msg.event);
  try {
    await ctx.handle(ctx, msg);
  } catch {
    // без XACK: сообщение остаётся в списке ожидания и придёт снова
  }
}`;

export const ACK_CODE = `const HANDLERS = {
  // не больше одного раза: подтвердить, потом делать
  async ackFirst({ db, redis, point }, msg) {
    await redis.call('XACK', STREAM, GROUP, msg.id);
    await point('XACK отправлен, начисления нет');
    await db.query(SQL.addPoints, [msg.user, msg.points]);
  },
  // не меньше одного раза: сделать, потом подтвердить
  async ackAfter({ db, redis, point }, msg) {
    await db.query(SQL.addPoints, [msg.user, msg.points]);
    await point('начислил, XACK нет');
    await redis.call('XACK', STREAM, GROUP, msg.id);
  },
};`;

export const POINT_NOTE =
  '`point(\'…\')` — метка в коде. В демо на ней процесс может «умереть»: дальше этой строки не выполнится ничего — ни следующая команда, ни `COMMIT`. Если в этот момент была открыта транзакция, Postgres откатит её сам, когда оборвётся соединение. Вне демо `point` ничего не делает.';

export const GUARANTEE_ROWS: { k: string; order: string; crash: string; tone: 'warn' | 'err' | 'ok' }[] = [
  {
    k: 'не больше одного раза (at-most-once)',
    order: 'сначала `XACK`, потом эффект',
    crash: 'Запись подтверждена, эффекта нет. Забирать нечего: в списке ожидания её уже нет. Бонусы **потеряны**.',
    tone: 'err',
  },
  {
    k: 'не меньше одного раза (at-least-once)',
    order: 'сначала эффект, потом `XACK`',
    crash: 'Эффект сделан, подтверждения нет. Запись заберёт другой обработчик и сделает эффект **ещё раз**.',
    tone: 'warn',
  },
  {
    k: 'ровно один раз (exactly-once)',
    order: 'такого порядка нет',
    crash: 'Эффект и `XACK` живут в разных системах, и общей транзакции у них нет. Собирается из «не меньше одного раза» и обработчика, для которого повтор ничего не меняет.',
    tone: 'ok',
  },
];

export const ACK_NOTE =
  'Почему нельзя сделать эффект и подтверждение «одновременно»: эффект — это `UPDATE` в Postgres, подтверждение — команда Redis. Между двумя сетевыми вызовами в два разных сервера всегда есть момент, когда первый уже выполнен, а второй ещё нет. Брокеры с режимом «exactly once», вроде Kafka, обещают его внутри себя: прочитать из одного топика и записать в другой атомарно. Как только эффект уходит во внешнюю базу, возвращается та же развилка.';

// ─── Раздел 3. Список ожидания и повторная выдача ─────────────────────────────────────────

export const PLAIN_VISIBILITY =
  'Как бронь столика: ресторан держит стол за гостем 15 минут. Не пришёл — стол отдают следующему. Если гость не исчез, а просто опоздал, за столом окажутся двое. Таймаут видимости устроен так же: слишком короткий — сообщение получат двое, слишком длинный — упавшего обработчика будут ждать долго.';

export const CLAIM_CODE = `// После перезапуска: '0' — свои сообщения, выданные раньше и не подтверждённые.
async function readOwn(ctx) {
  const reply = await ctx.redis.call('XREADGROUP', 'GROUP', GROUP, ctx.me, 'COUNT', '1', 'STREAMS', STREAM, '0');
  for (const [id, fields] of reply[0][1]) await deliver(ctx, fieldsToMsg(id, fields));
}

// Чужие зависшие: выданы, но без XACK дольше VISIBILITY_MS.
async function claimStale(ctx) {
  const [, claimed] = await ctx.redis.call('XAUTOCLAIM', STREAM, GROUP, ctx.me, String(VISIBILITY_MS), '0-0', 'COUNT', '1');
  for (const [id, fields] of claimed) {
    const [[, , , deliveries]] = await ctx.redis.call('XPENDING', STREAM, GROUP, id, id, '1');
    if (deliveries > MAX_DELIVERIES) {
      await ctx.redis.call('XADD', DEAD, '*', ...fields, 'from', id);
      await ctx.redis.call('XACK', STREAM, GROUP, id);
      continue;
    }
    await deliver(ctx, fieldsToMsg(id, fields));
  }
}`;

export const BROKER_CODE = `// Учебный Redis Streams: поток, группа потребителей, список ожидания (PEL).
function createBroker(clock) {
  const streams = new Map();   // имя → { entries: [[id, поля]], groups: Map }
  let seq = 0;
  const num = (id) => Number(id.split('-')[0]);
  const open = (name) => {
    if (!streams.has(name)) streams.set(name, { entries: [], groups: new Map() });
    return streams.get(name);
  };
  const fieldsOf = (s, id) => s.entries.find((e) => e[0] === id)?.[1];

  const commands = {
    XGROUP(sub, name, group) {                       // CREATE name group $ MKSTREAM
      const s = open(name);
      if (s.groups.has(group)) throw new Error('BUSYGROUP Consumer Group name already exists');
      s.groups.set(group, { last: seq, pending: new Map() });
      return 'OK';
    },
    XADD(name, star, ...fields) {
      const id = ++seq + '-0';
      open(name).entries.push([id, fields]);
      return id;
    },
    XLEN: (name) => open(name).entries.length,
    XDEL(name, ...ids) {                                  // из потока, но не из списка ожидания
      const s = open(name);
      const before = s.entries.length;
      s.entries = s.entries.filter(([id]) => !ids.includes(id));
      return before - s.entries.length;
    },
    // '>' — новые, которых группа ещё никому не выдавала; '0' — свои невыполненные
    XREADGROUP(g, group, me, c, count, s, name, from) {
      const st = open(name);
      const gr = st.groups.get(group);
      const out = [];
      if (from === '>') {
        for (const [id, fields] of st.entries) {
          if (num(id) <= gr.last || out.length >= Number(count)) continue;
          gr.last = num(id);
          gr.pending.set(id, { consumer: me, at: clock.now, deliveries: 1 });
          out.push([id, fields]);
        }
        return out.length ? [[name, out]] : null;
      }
      for (const [id, p] of gr.pending) {
        if (p.consumer !== me || out.length >= Number(count)) continue;
        p.at = clock.now;
        p.deliveries += 1;                               // повторная выдача тоже считается
        out.push([id, fieldsOf(st, id)]);
      }
      return [[name, out]];
    },
    XACK(name, group, ...ids) {
      const gr = open(name).groups.get(group);
      return ids.filter((id) => gr.pending.delete(id)).length;
    },
    XPENDING(name, group, start, end, count) {
      const gr = open(name).groups.get(group);
      const list = [...gr.pending].sort((a, b) => num(a[0]) - num(b[0]));
      if (start === undefined) {                          // сводка
        if (!list.length) return [0, null, null, null];
        const per = new Map();
        for (const [, p] of list) per.set(p.consumer, (per.get(p.consumer) ?? 0) + 1);
        return [list.length, list[0][0], list.at(-1)[0], [...per].map(([c, n]) => [c, String(n)])];
      }
      return list
        .filter(([id]) => (start === '-' || num(id) >= num(start)) && (end === '+' || num(id) <= num(end)))
        .slice(0, Number(count))
        .map(([id, p]) => [id, p.consumer, clock.now - p.at, p.deliveries]);
    },
    // забрать чужие сообщения, которые висят без XACK дольше minIdle мс
    XAUTOCLAIM(name, group, me, minIdle, start, c, count) {
      const st = open(name);
      const gr = st.groups.get(group);
      const claimed = [];
      const deleted = [];
      for (const [id, p] of [...gr.pending].sort((a, b) => num(a[0]) - num(b[0]))) {
        if (claimed.length + deleted.length >= Number(count)) break;
        if (clock.now - p.at < Number(minIdle)) continue;
        const fields = fieldsOf(st, id);
        if (!fields) {                                    // запись удалили из потока
          gr.pending.delete(id);
          deleted.push(id);
          continue;
        }
        Object.assign(p, { consumer: me, at: clock.now, deliveries: p.deliveries + 1 });
        claimed.push([id, fields]);
      }
      return ['0-0', claimed, deleted];
    },
  };

  return {
    async call(cmd, ...args) {
      return commands[cmd](...args);
    },
    dump() {                                              // для демо: что лежит сейчас
      const out = { entries: {}, pending: [] };
      for (const [name, s] of streams) {
        out.entries[name] = s.entries.map(([id, fields]) => [id, [...fields]]);
        for (const [, g] of s.groups) {
          for (const [id, p] of g.pending) out.pending.push({ id, consumer: p.consumer, deliveries: p.deliveries });
        }
      }
      return out;
    },
  };
}`;

/** Медленный, но живой обработчик: его запись забрали, а он всё равно подтвердил. */
export const RAW_SLOW: RawStep[] = [
  [
    "P",
    "XGROUP",
    "CREATE",
    "events",
    "bonus",
    "$",
    "MKSTREAM"
  ],
  [
    "P",
    "XADD",
    "events",
    "*",
    "event",
    "o-1",
    "user",
    "7",
    "points",
    "10"
  ],
  [
    "w1",
    "XREADGROUP",
    "GROUP",
    "bonus",
    "w1",
    "COUNT",
    "1",
    "STREAMS",
    "events",
    ">"
  ],
  [
    "wait",
    300
  ],
  [
    "w2",
    "XAUTOCLAIM",
    "events",
    "bonus",
    "w2",
    "200",
    "0-0",
    "COUNT",
    "1"
  ],
  [
    "w1",
    "XACK",
    "events",
    "bonus",
    "1-0"
  ],
  [
    "w2",
    "XACK",
    "events",
    "bonus",
    "1-0"
  ],
  [
    "w2",
    "XPENDING",
    "events",
    "bonus",
    "-",
    "+",
    "10"
  ]
];

export const SLOW_LOG: string[] = [
  "P: XGROUP CREATE events bonus $ MKSTREAM → OK",
  "P: XADD events * event o-1 user 7 points 10 → 1-0",
  "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
  "прошло 300 мс",
  "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
  "w1: XACK events bonus 1-0 → (integer) 1",
  "w2: XACK events bonus 1-0 → (integer) 0",
  "w2: XPENDING events bonus - + 10 → (пусто)"
];

export const SLOW_NOTE =
  '`w1` не упал, а просто работал дольше 200 мс. За это время `w2` забрал запись и тоже начал работать. `XACK` от `w1` прошёл — `(integer) 1`, хотя запись числилась уже за `w2`: Redis не проверяет, кто подтверждает. Подтверждение `w2` вернуло `0`. Эффект при этом сделан дважды, и никто не падал. Таймаут видимости должен быть заметно больше самой долгой обработки.';

/** Запись удалили из потока, пока она висела в списке ожидания. */
export const RAW_TRIM: RawStep[] = [
  [
    "P",
    "XGROUP",
    "CREATE",
    "events",
    "bonus",
    "$",
    "MKSTREAM"
  ],
  [
    "P",
    "XADD",
    "events",
    "*",
    "event",
    "o-1",
    "user",
    "7",
    "points",
    "10"
  ],
  [
    "w1",
    "XREADGROUP",
    "GROUP",
    "bonus",
    "w1",
    "COUNT",
    "1",
    "STREAMS",
    "events",
    ">"
  ],
  [
    "w1",
    "XREADGROUP",
    "GROUP",
    "bonus",
    "w1",
    "COUNT",
    "1",
    "STREAMS",
    "events",
    "0"
  ],
  [
    "w1",
    "XPENDING",
    "events",
    "bonus",
    "-",
    "+",
    "10"
  ],
  [
    "P",
    "XDEL",
    "events",
    "1-0"
  ],
  [
    "wait",
    300
  ],
  [
    "w2",
    "XAUTOCLAIM",
    "events",
    "bonus",
    "w2",
    "200",
    "0-0",
    "COUNT",
    "1"
  ],
  [
    "w2",
    "XPENDING",
    "events",
    "bonus",
    "-",
    "+",
    "10"
  ]
];

export const TRIM_LOG: string[] = [
  "P: XGROUP CREATE events bonus $ MKSTREAM → OK",
  "P: XADD events * event o-1 user 7 points 10 → 1-0",
  "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
  "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events 0 → 1-0 {event o-1 user 7 points 10}",
  "w1: XPENDING events bonus - + 10 → 1-0 у w1, доставок 2",
  "P: XDEL events 1-0 → (integer) 1",
  "прошло 300 мс",
  "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал ничего; удалены 1-0",
  "w2: XPENDING events bonus - + 10 → (пусто)"
];

export const PENDING_FACTS: { t: string; d: string; tone?: 'warn' }[] = [
  {
    t: 'Счётчик растёт на каждой выдаче',
    d: '`XAUTOCLAIM` увеличивает счётчик доставок. `XREADGROUP` с `0` — тоже, хотя запись возвращается тому же обработчику: в журнале про удалённую запись её прочитали дважды, и счётчик стал 2.',
    tone: 'warn',
  },
  {
    t: 'Раньше таймаута — ничего',
    d: '`XAUTOCLAIM … 200` отдаёт только записи, которые висят без подтверждения дольше 200 мс. В сценарии «XACK после работы» первая попытка `w2` вернула «забрал ничего», вторая — через 300 мс — забрала.',
  },
  {
    t: 'Удалённая запись — не в работу',
    d: 'Если запись удалили из потока (`XDEL`, `XTRIM`), пока она висела, `XAUTOCLAIM` вернёт её номер третьим списком — «удалены» — и сам вычеркнет из списка ожидания. Содержимого уже нет, обработать её нельзя.',
  },
];

export const RESTART_NOTE =
  'Перезапущенный обработчик с тем же именем видит свои неподтверждённые записи сразу, без таймаута: `XREADGROUP … 0` вместо `>`. Поэтому обработчику дают постоянное имя — номер пода, имя машины, — а не случайное при каждом старте. Со случайным именем записи упавшего так и числятся за обработчиком, которого больше нет, пока их не заберёт `XAUTOCLAIM`.';

// ─── Раздел 4. Ядовитые сообщения ──────────────────────────────────────────────────────────

export const PLAIN_POISON =
  'Письмо на несуществующий адрес. Почтальон носит его каждый день и каждый день приносит обратно. Разумная почта после трёх попыток откладывает такое письмо в отдел невостребованных — там его разберёт человек, а почтальон займётся остальными.';

export const DLQ_NOTE =
  'В `claimStale` перед обработкой стоит проверка счётчика: больше трёх доставок — запись копируется в поток `events:dead` с пометкой, откуда она, и подтверждается в основном. Ошибка `22P02` — «abc» не число — повторяется на каждой попытке, и без этой проверки обработчики гоняли бы запись вечно. Ключ при этом не «сгорает»: `markProcessed` откатывается вместе с упавшим `addPoints`, и в `processed` записи `o-9` нет.';

export const DLQ_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Мёртвые письма читает человек',
    d: 'Поток `events:dead` — не мусорка. На его длину ставят тревогу, а после исправления (данных или кода) записи публикуют в основной поток заново. Идемпотентный обработчик это переживёт: что уже было сделано, повторно не сделается.',
  },
  {
    t: 'Постоянная ошибка и временная',
    d: 'Неверные данные (`22P02`) не исправятся от повтора, их можно отправлять в мёртвые сразу. Обрыв сети или `40001` — исправятся: такие повторяют. Счётчик доставок их не различает, различать должен код.',
    tone: 'warn',
  },
  {
    t: 'В SQS это настройка',
    d: 'У SQS очередь мёртвых писем — свойство очереди: `maxReceiveCount` в redrive policy. После стольких получений без удаления сообщение переезжает само. В Redis этот перенос пишут руками, как в `claimStale`.',
  },
];

// ─── Раздел 5. Идемпотентный обработчик ───────────────────────────────────────────────────

export const IDEMPOTENT_CODE = `Object.assign(HANDLERS, {
  // «проверить, потом сделать» — ключ записан отдельно от эффекта
  async checkFirst({ db, redis, point }, msg) {
    const { rows } = await db.query(SQL.wasProcessed, [msg.event]);
    if (rows.length === 0) {
      await db.query(SQL.addPoints, [msg.user, msg.points]);
      await point('начислил, ключа нет');
      await db.query(SQL.markProcessed, [msg.event]);
    }
    await redis.call('XACK', STREAM, GROUP, msg.id);
  },
  // идемпотентно: ключ и эффект в одной транзакции
  async idempotent({ db, redis, point }, msg) {
    await db.tx(async (q) => {
      const { rowCount } = await q(SQL.markProcessed, [msg.event]);
      if (rowCount === 0) return;                   // уже обработано: дубль
      await q(SQL.addPoints, [msg.user, msg.points]);
      await point('начислил, COMMIT ещё нет');
    });
    await point('COMMIT прошёл, XACK нет');
    await redis.call('XACK', STREAM, GROUP, msg.id);
  },
});`;

export const KEY_NOTE =
  'Ключ — номер события `o-1`, а не номер записи в потоке. Номер записи у дубля другой: ретранслятор, повторивший публикацию, получит от Redis `2-0`, а событие внутри то же. Номер записи годится, только чтобы отличить одну выдачу от другой, — а это и так делает список ожидания.';

export const KEY_ORDER: { t: string; d: string; tone: 'err' | 'ok' }[] = [
  {
    t: 'Ключ после эффекта',
    d: 'Так устроен `checkFirst`: проверил — начислил — записал ключ. Упал между начислением и ключом — эффект есть, ключа нет. Следующий обработчик проверит, ключа не найдёт и начислит ещё раз: 20 бонусов.',
    tone: 'err',
  },
  {
    t: 'Ключ до эффекта, отдельно',
    d: 'Записал ключ, зафиксировал, потом начислил. Упал между ними — ключ есть, эффекта нет. Следующий обработчик увидит ключ и решит, что всё сделано: 0 бонусов, и никто об этом не узнает.',
    tone: 'err',
  },
  {
    t: 'Ключ и эффект — одна транзакция',
    d: 'Так устроен `idempotent`: `INSERT … ON CONFLICT DO NOTHING` и `UPDATE` между одними `BEGIN` и `COMMIT`. Упал до `COMMIT` — Postgres откатит оба, после — зафиксированы оба. Третьего состояния нет.',
    tone: 'ok',
  },
];

export const PLAIN_UNIQUE =
  '`ON CONFLICT DO NOTHING` — «вставь, а если такой ключ уже есть, молча ничего не делай». Сколько строк вставлено, приходит в ответе: 1 — ключ новый, работаем; 0 — ключ уже был, это повтор. Проверка и запись ключа — одна команда, поэтому между ними никто не вклинится.';

/** Два сеанса Postgres 16: шаги `[сеанс, SQL]`. */
export const PG_SCENARIOS: Record<string, [string, string][]> = {
  "commit": [
    [
      "A",
      "BEGIN;"
    ],
    [
      "A",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "B",
      "BEGIN;"
    ],
    [
      "B",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "COMMIT;"
    ],
    [
      "B",
      "COMMIT;"
    ]
  ],
  "rollback": [
    [
      "A",
      "BEGIN;"
    ],
    [
      "A",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "B",
      "BEGIN;"
    ],
    [
      "B",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "ROLLBACK;"
    ],
    [
      "B",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "B",
      "COMMIT;"
    ]
  ],
  "check-race": [
    [
      "A",
      "BEGIN;"
    ],
    [
      "A",
      "SELECT 1 FROM processed WHERE event_id = 'o-1';"
    ],
    [
      "B",
      "BEGIN;"
    ],
    [
      "B",
      "SELECT 1 FROM processed WHERE event_id = 'o-1';"
    ],
    [
      "A",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "A",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "COMMIT;"
    ],
    [
      "B",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "B",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "B",
      "COMMIT;"
    ]
  ],
  "repeatable-read": [
    [
      "A",
      "BEGIN;"
    ],
    [
      "A",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "UPDATE wallets SET points = points + 10 WHERE user_id = 7;"
    ],
    [
      "B",
      "BEGIN ISOLATION LEVEL REPEATABLE READ;"
    ],
    [
      "B",
      "INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING;"
    ],
    [
      "A",
      "COMMIT;"
    ],
    [
      "B",
      "ROLLBACK;"
    ]
  ],
  "outbox-gap": [
    [
      "A",
      "BEGIN;"
    ],
    [
      "A",
      "INSERT INTO outbox (event_id, user_id, points) VALUES ('o-1', 7, 10) RETURNING id;"
    ],
    [
      "B",
      "BEGIN;"
    ],
    [
      "B",
      "INSERT INTO outbox (event_id, user_id, points) VALUES ('o-2', 7, 30) RETURNING id;"
    ],
    [
      "B",
      "COMMIT;"
    ],
    [
      "B",
      "SELECT id, event_id FROM outbox WHERE sent_at IS NULL ORDER BY id;"
    ],
    [
      "A",
      "COMMIT;"
    ],
    [
      "B",
      "SELECT id, event_id FROM outbox WHERE sent_at IS NULL ORDER BY id;"
    ]
  ]
};

/** Вывод `PG_SCENARIOS` на двух настоящих сеансах Postgres 16.15. «ждёт» — сеанс стоит на блокировке. */
export const PG_RUNS: Record<string, { log: string[]; points: number }> = {
  "commit": {
    "log": [
      "A: BEGIN; → BEGIN",
      "A: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → INSERT 0 1",
      "A: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "B: BEGIN; → BEGIN",
      "B: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → ждёт",
      "A: COMMIT; → COMMIT",
      "B: …дождался → INSERT 0 0",
      "B: COMMIT; → COMMIT"
    ],
    "points": 10
  },
  "rollback": {
    "log": [
      "A: BEGIN; → BEGIN",
      "A: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → INSERT 0 1",
      "A: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "B: BEGIN; → BEGIN",
      "B: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → ждёт",
      "A: ROLLBACK; → ROLLBACK",
      "B: …дождался → INSERT 0 1",
      "B: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "B: COMMIT; → COMMIT"
    ],
    "points": 10
  },
  "check-race": {
    "log": [
      "A: BEGIN; → BEGIN",
      "A: SELECT 1 FROM processed WHERE event_id = 'o-1'; → (пусто)",
      "B: BEGIN; → BEGIN",
      "B: SELECT 1 FROM processed WHERE event_id = 'o-1'; → (пусто)",
      "A: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "A: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → INSERT 0 1",
      "A: COMMIT; → COMMIT",
      "B: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "B: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → INSERT 0 0",
      "B: COMMIT; → COMMIT"
    ],
    "points": 20
  },
  "repeatable-read": {
    "log": [
      "A: BEGIN; → BEGIN",
      "A: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → INSERT 0 1",
      "A: UPDATE wallets SET points = points + 10 WHERE user_id = 7; → UPDATE 1",
      "B: BEGIN ISOLATION LEVEL REPEATABLE READ; → BEGIN",
      "B: INSERT INTO processed (event_id) VALUES ('o-1') ON CONFLICT DO NOTHING; → ждёт",
      "A: COMMIT; → COMMIT",
      "B: …дождался → ошибка 40001",
      "B: ROLLBACK; → ROLLBACK"
    ],
    "points": 10
  },
  "outbox-gap": {
    "log": [
      "A: BEGIN; → BEGIN",
      "A: INSERT INTO outbox (event_id, user_id, points) VALUES ('o-1', 7, 10) RETURNING id; → 1 / INSERT 0 1",
      "B: BEGIN; → BEGIN",
      "B: INSERT INTO outbox (event_id, user_id, points) VALUES ('o-2', 7, 30) RETURNING id; → 2 / INSERT 0 1",
      "B: COMMIT; → COMMIT",
      "B: SELECT id, event_id FROM outbox WHERE sent_at IS NULL ORDER BY id; → 2|o-2",
      "A: COMMIT; → COMMIT",
      "B: SELECT id, event_id FROM outbox WHERE sent_at IS NULL ORDER BY id; → 1|o-1 / 2|o-2"
    ],
    "points": 0
  }
};

export const PG_CASES: { id: string; t: string; d: string; tone: 'ok' | 'err' | 'warn' }[] = [
  {
    id: 'commit',
    t: 'Двое с одним ключом: первый зафиксировал',
    d: 'B вставляет тот же ключ, пока транзакция A открыта, — и ждёт: уникальный индекс не даёт решить, конфликт это или нет, пока судьба строки A неизвестна. A зафиксировал — B получил `INSERT 0 0` и ничего не начисляет. Итог — 10.',
    tone: 'ok',
  },
  {
    id: 'rollback',
    t: 'Первый откатился',
    d: 'Тот же расклад, но A упал и откатился. B дождался и получил `INSERT 0 1`: ключа больше нет, работа достаётся ему. Итог — 10, как и должно быть.',
    tone: 'ok',
  },
  {
    id: 'check-race',
    t: 'Проверить, потом сделать',
    d: 'Без падений, просто одновременно. Оба `SELECT` вернули пусто, оба начислили, ключ вставил только A. Итог — **20**: проверка и запись разнесены по разным командам, и между ними прошёл второй обработчик.',
    tone: 'err',
  },
  {
    id: 'repeatable-read',
    t: 'B на Repeatable Read',
    d: 'B ждал, A зафиксировал — и B получил не «0 строк», а ошибку `40001`: строка A появилась после снимка B. Двойного начисления нет, но обработчик обязан повторить транзакцию — на повторе будет `INSERT 0 0`.',
    tone: 'warn',
  },
];

export const RETRY_LINK =
  'Повтор транзакции на `40001` и почему это штатный ответ, а не сбой, — в [«Транзакциях и уровнях изоляции», раздел «Повтор и дедлоки»](/data/transactions/#s8). Идемпотентность `POST` в HTTP тем же приёмом — ключ от клиента и запомненный ответ — в [«Балансировке нагрузки», раздел «Повторы»](/delivery/load-balancing/#s6).';

export const OUTSIDE_NOTE =
  'Не всякий эффект живёт в той же базе. Письмо, пуш, запрос в платёжный шлюз в транзакцию не положить. Для них два пути. Передать ключ дальше: платёжный API с `Idempotency-Key: o-1` сам отбросит повтор. Или превратить внешний вызов в ещё одно событие — записать намерение в outbox и отдать его отдельному обработчику, идемпотентному на своей стороне.';

// ─── Раздел 6. Двойная запись и outbox ────────────────────────────────────────────────────

export const PLAIN_OUTBOX =
  'Как папка «Исходящие» в почте. Нажали «отправить» — письмо ложится в «Исходящие», и это мгновенно и надёжно. Отправляет его фоновый процесс, когда есть связь. Связи нет — письмо лежит и ждёт, но не теряется. Связь пропала после отправки, но до отметки «отправлено» — письмо уйдёт второй раз.';

export const PRODUCER_CODE = `// Двойная запись: заказ в базе, событие — в Redis. Между ними процесс может упасть.
async function placeOrderPublishAfter({ db, redis, point }, order) {
  await db.tx(async (q) => {
    await q(SQL.insertOrder, [order.id, order.user, order.total]);
  });
  await point('заказ зафиксирован');
  await redis.call('XADD', STREAM, '*', 'event', order.id, 'user', String(order.user), 'points', String(order.total / 100));
}

async function placeOrderPublishInside({ db, redis, point }, order) {
  await db.tx(async (q) => {
    await q(SQL.insertOrder, [order.id, order.user, order.total]);
    await redis.call('XADD', STREAM, '*', 'event', order.id, 'user', String(order.user), 'points', String(order.total / 100));
    await point('событие ушло, COMMIT ещё нет');
  });
}

// Outbox: заказ и событие — одна транзакция. Публикует ретранслятор.
async function placeOrderOutbox({ db, point }, order) {
  await db.tx(async (q) => {
    await q(SQL.insertOrder, [order.id, order.user, order.total]);
    await point('заказ записан, COMMIT ещё нет');
    await q(SQL.insertOutbox, [order.id, order.user, order.total / 100]);
  });
}

async function relay({ db, redis, point }) {
  const { rows } = await db.query(SQL.pickOutbox);
  for (const row of rows) {
    await redis.call('XADD', STREAM, '*', 'event', row.event_id, 'user', String(row.user_id), 'points', String(row.points));
    await point('опубликовал, отметки нет');
    await db.query(SQL.markSent, [row.id]);
  }
}`;

export const OUTBOX_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Ретранслятор — тоже «не меньше одного раза»',
    d: 'Он публикует, потом ставит отметку. Упал между — после перезапуска опубликует ещё раз: так в сценарии «ретранслятор упал» поток получил `1-0` и `2-0` с одним `o-1`. Ставить отметку до публикации — значит терять события. Значит, потребитель обязан быть идемпотентным.',
    tone: 'warn',
  },
  {
    t: 'Несколько ретрансляторов',
    d: 'Два ретранслятора с одним и тем же `SELECT` увидят одни и те же строки и опубликуют их оба. Чтобы они делили строки, выборку делают в транзакции с `FOR UPDATE SKIP LOCKED`: занятые соседом строки пропускаются.',
  },
  {
    t: 'Опрос или журнал изменений',
    d: 'Ретранслятор из темы опрашивает таблицу. Другой способ — читать журнал изменений Postgres через логическую репликацию, так устроен Debezium. Задержка меньше, гарантия та же: не меньше одного раза.',
  },
];

export const GAP_NOTE =
  'Отмечать каждую строку, а не помнить «последний опубликованный `id`», приходится из-за дыр в номерах. Номер из `bigserial` выдаётся при вставке, а видна строка становится при `COMMIT`. A взял `id` 1 и ещё думает, B взял 2 и зафиксировал. Ретранслятор видит только 2 — и если запомнит «опубликовано до 2», строку 1 не опубликует никогда.';

export const SKIP_LOCKED_LINK =
  '`SKIP LOCKED` и очередь задач прямо в таблице Postgres — в [«Транзакциях и уровнях изоляции», раздел «Блокировки строк»](/data/transactions/#s6).';

// ─── Раздел 7. Порядок ─────────────────────────────────────────────────────────────────────

export const ORDER_TEXT =
  'Здесь порядок не важен: 10 + 30 = 30 + 10. Но события бывают и такими: «заказ оплачен», потом «заказ отменён». Обработанные наоборот, они оставят оплаченный заказ, которого уже нет. Есть три ответа, и все с ценой.';

export const ORDER_ROWS: { k: string; how: string; cost: string }[] = [
  {
    k: 'один обработчик',
    how: 'Вся группа — один процесс, записи по одной.',
    cost: 'Нет параллельности. И порядок всё равно нарушит повтор: запись, ушедшая в мёртвые, пропустит вперёд следующие.',
  },
  {
    k: 'партиции по ключу',
    how: 'Несколько потоков, `events:0`, `events:1`… Событие кладут в поток по хешу ключа — номера заказа. У каждого потока один обработчик. Так устроены партиции Kafka: порядок гарантирован только внутри партиции.',
    cost: 'Медленная или ядовитая запись держит всю свою партицию. Число партиций не поменять без переезда ключей.',
  },
  {
    k: 'версия в событии',
    how: 'Событие несёт номер версии заказа, обработчик пишет `UPDATE … WHERE version < $v`. Опоздавшее старое событие ничего не меняет.',
    cost: 'Нужен монотонный номер у источника. Зато порядок доставки становится неважен.',
  },
];

export const PARTITION_LINK =
  'Раскладка ключей по узлам хешем и что происходит при смене числа узлов — в [«Балансировке нагрузки», раздел «Хеш по ключу»](/delivery/load-balancing/#s4). Проверка версии в `UPDATE` — оптимистичная блокировка из [«Транзакций и уровней изоляции», раздел «Блокировки строк»](/data/transactions/#s6).';

// ─── Раздел 8. Все точки падения ───────────────────────────────────────────────────────────

/** Заказ, который проходит всю цепочку. Бонусы — 1 % суммы. */
export const ORDER = { id: 'o-1', user: 7, total: 1000 };

/** Круг восстановления: подождать таймаут, перезапустить ретранслятор, забрать зависшее, дочитать новое. */
const ROUND: Step[] = [
  ['wait', 300],
  ['R', 'relay'],
  ['w2', 'claimStale'],
  ['w2', 'readNew'],
  ['w2', 'readNew'],
];

/** Вся цепочка: заказ, ретранслятор, обработчик — и два круга восстановления. */
export const FULL_SCHEDULE: Step[] = [['P', 'place', ORDER], ['R', 'relay'], ['w1', 'readNew'], ...ROUND, ...ROUND];

export const PRODUCER_OPTIONS = [
  { value: 'publishAfter', label: 'XADD после COMMIT' },
  { value: 'publishInside', label: 'XADD до COMMIT' },
  { value: 'outbox', label: 'outbox' },
] as const;

export const HANDLER_OPTIONS = [
  { value: 'ackFirst', label: 'XACK до работы' },
  { value: 'ackAfter', label: 'XACK после' },
  { value: 'checkFirst', label: 'проверить, потом сделать' },
  { value: 'idempotent', label: 'ключ в транзакции' },
] as const;

export const DB_CODE = `// Учебная база: те же запросы SQL, что и у Postgres, но таблицы — массивы в памяти.
function createDb() {
  let data = { orders: [], outbox: [], wallets: { 7: 0 }, processed: [], nextId: 1 };
  let draft = null;                                    // незафиксированная транзакция
  const fail = (code) => Object.assign(new Error(code), { code });
  const int = (v) => {
    if (!/^-?\\d+$/.test(String(v))) throw fail('22P02'); // invalid input syntax for type integer
    return Number(v);
  };
  const impl = {
    BEGIN: () => ((draft = structuredClone(data)), []),
    COMMIT: () => ((data = draft), (draft = null), []),
    ROLLBACK: () => ((draft = null), []),
    [SQL.insertOrder]: (d, [id, user, total]) => {
      if (d.orders.some((o) => o.id === id)) throw fail('23505');
      d.orders.push({ id, user_id: int(user), total: int(total) });
      return 1;
    },
    [SQL.insertOutbox]: (d, [event, user, points]) => {
      d.outbox.push({ id: d.nextId++, event_id: event, user_id: int(user), points: int(points), sent_at: null });
      return 1;
    },
    [SQL.pickOutbox]: (d) =>
      d.outbox.filter((r) => r.sent_at === null).map(({ id, event_id, user_id, points }) => ({ id, event_id, user_id, points })),
    [SQL.markSent]: (d, [id]) => d.outbox.filter((r) => r.id === Number(id) && (r.sent_at = 'now')).length,
    [SQL.addPoints]: (d, [user, points]) => {
      const add = int(points);
      if (!(int(user) in d.wallets)) return 0;
      d.wallets[int(user)] += add;
      return 1;
    },
    [SQL.markProcessed]: (d, [event]) => {
      if (d.processed.includes(event)) return 0;          // ON CONFLICT DO NOTHING
      d.processed.push(event);
      return 1;
    },
    [SQL.wasProcessed]: (d, [event]) => (d.processed.includes(event) ? [{ '?column?': 1 }] : []),
    [SQL.countOrders]: (d) => [{ n: d.orders.length }],
    [SQL.walletPoints]: (d) => [{ points: d.wallets[7] }],
  };
  return {
    async exec(sql, params = []) {
      const out = impl[sql](draft ?? data, params);
      return Array.isArray(out) ? { rows: out, rowCount: out.length } : { rows: [], rowCount: out };
    },
    dump: () => structuredClone(draft ?? data),
  };
}`;

export const RUNNER_CODE = `// Прогон расписания: шаги [кто, действие, аргумент]; ['wait', мс] — пауза.
// crash — где «убить» процесс: номер метки по порядку, «кто: метка» или список таких.
const PRODUCERS = {
  publishAfter: placeOrderPublishAfter,
  publishInside: placeOrderPublishInside,
  outbox: placeOrderOutbox,
};

const showEntry = ([id, fields]) => id + ' {' + fields.join(' ') + '}';

function showReply(cmd, r) {
  if (r === null) return '(nil)';
  if (typeof r === 'number') return '(integer) ' + r;
  if (cmd === 'XREADGROUP') return r[0][1].map(showEntry).join(', ') || '(пусто)';
  if (cmd === 'XAUTOCLAIM') {
    const got = r[1].map(showEntry).join(', ') || 'ничего';
    return 'забрал ' + got + (r[2].length ? '; удалены ' + r[2].join(' ') : '');
  }
  if (cmd === 'XINFO') return r.map((g) => fieldsToMsg('', g)).map((g) => 'pending ' + g.pending + ', lag ' + g.lag).join('; ');
  if (cmd === 'XPENDING') return r.map(([id, who, idle, n]) => id + ' у ' + who + ', доставок ' + n).join('; ') || '(пусто)';
  return String(r);
}

async function runSchedule(env, schedule, variant, crash = -1) {
  const log = [];
  const write = (line) => {
    log.push(line);
    env.onLine?.();                                  // демо снимает состояние после каждой строки
  };
  const hits = [];
  const want = [].concat(crash);
  await env.redis.call('XGROUP', 'CREATE', STREAM, GROUP, '$', 'MKSTREAM');

  for (const [who, action, arg] of schedule) {
    if (who === 'wait') {
      await env.sleep(action);
      write('прошло ' + action + ' мс');
      continue;
    }
    const say = (text) => write(who + ': ' + text);
    let die;
    const died = new Promise((resolve) => (die = resolve));
    let inTx = false;

    const redis = {
      async call(...args) {
        const reply = await env.redis.call(...args);
        say(args.join(' ') + ' → ' + showReply(args[0], reply));
        return reply;
      },
    };
    const q = async (sql, params = []) => {
      const name = 'SQL.' + Object.keys(SQL).find((k) => SQL[k] === sql) + '(' + params.join(', ') + ')';
      try {
        const res = await env.db.exec(sql, params);
        say(name + ' → строк: ' + res.rowCount);
        return res;
      } catch (err) {
        say(name + ' → ошибка ' + err.code);
        throw err;
      }
    };
    const db = {
      query: q,
      async tx(fn) {
        await env.db.exec('BEGIN');
        inTx = true;
        say('BEGIN');
        try {
          await fn(q);
          await env.db.exec('COMMIT');
          say('COMMIT');
        } catch (err) {
          await env.db.exec('ROLLBACK');
          say('ROLLBACK');
          throw err;
        } finally {
          inTx = false;
        }
      },
    };
    const point = (label) => {
      const at = hits.push(who + ': ' + label) - 1;
      const i = want.findIndex((c) => c === at || c === hits[at]);
      if (i < 0) return;
      want.splice(i, 1);
      say('✕ упал: ' + label);
      die();
      return new Promise(() => {});                 // дальше этой строки процесс не пошёл
    };

    const ctx = { me: who, redis, db, point, handle: HANDLERS[variant.handler] };
    const jobs = {
      place: () => PRODUCERS[variant.producer](ctx, arg),
      relay: () => relay(ctx),
      publish: () => redis.call('XADD', STREAM, '*', ...arg),
      readNew: () => readNew(ctx),
      readOwn: () => readOwn(ctx),
      claimStale: () => claimStale(ctx),
    };
    const ended = await Promise.race([jobs[action]().then(() => 'ok'), died.then(() => 'crash')]);
    if (ended === 'crash' && inTx) {
      await env.db.exec('ROLLBACK');                // соединение закрылось — Postgres откатывает
      say('ROLLBACK: соединение оборвалось');
    }
  }

  const orders = (await env.db.exec(SQL.countOrders)).rows[0].n;
  const points = (await env.db.exec(SQL.walletPoints)).rows[0].points;
  const pending = (await env.redis.call('XPENDING', STREAM, GROUP))[0];
  const dead = await env.redis.call('XLEN', DEAD);
  return { log, hits, final: { orders, points, pending, dead } };
}`;

export const MODEL_NOTE =
  'Учебный Redis и учебная база исполняют те же команды и те же тексты `SQL`, что настоящие. Журналы всех сценариев темы на них совпадают строка в строку с журналами Redis 7.4 и Postgres — с точностью до номеров записей: у настоящего Redis это время в миллисекундах.';

export const CRASH_CAPTION =
  'Каждая строка — отдельный прогон всей цепочки: заказ, ретранслятор, обработчик `w1` и два круга восстановления, в которых `w2` забирает зависшее и дочитывает новое. Процесс падает на одной метке, остальные работают как работали. «Ровно один» — бонусов столько, сколько зафиксировано заказов.';

// ─── Сценарии демо ─────────────────────────────────────────────────────────────────────────

const EV = (id: string, points = '10') => ['event', id, 'user', '7', 'points', points];

export const SCENARIOS: QueueScenario[] = [
  {
    id: 'ack-first',
    label: 'XACK до работы',
    variant: { producer: 'outbox', handler: 'ackFirst' },
    crash: 'w1: XACK отправлен, начисления нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` подтверждает запись сразу, как получил, и падает, не дойдя до `UPDATE`.',
    verdict: 'Запись подтверждена — в списке ожидания её нет, и `w2` забирать нечего. Бонусов **0**: сообщение потеряно молча.',
    tone: 'err',
  },
  {
    id: 'ack-after-early',
    label: 'падение до работы',
    variant: { producer: 'outbox', handler: 'ackAfter' },
    crash: 'w1: получил o-1',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` подтверждает после работы, но падает раньше, чем начал её.',
    verdict: 'Запись висит за `w1` без подтверждения. Через 300 мс `w2` её забирает — счётчик доставок 2 — и делает работу. Бонусов **10**.',
    tone: 'ok',
  },
  {
    id: 'ack-after',
    label: 'XACK после работы',
    variant: { producer: 'outbox', handler: 'ackAfter' },
    crash: 'w1: начислил, XACK нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['w2', 'claimStale'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` начислил и упал, не успев подтвердить. `w2` пробует забрать зависшее дважды: сразу и через 300 мс.',
    verdict: 'Первая попытка — «забрал ничего»: запись висит меньше 200 мс. Вторая забирает её, и `w2` начисляет ещё раз. Бонусов **20**: эффект случился дважды.',
    tone: 'err',
  },
  {
    id: 'restart',
    label: 'перезапуск',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'w1: COMMIT прошёл, XACK нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['w1', 'readOwn'], ['w1', 'readOwn']],
    note: '`w1` начислил, зафиксировал и упал до `XACK`. Его перезапускают с тем же именем, и первым делом он читает свои неподтверждённые записи — `0` вместо `>`.',
    verdict: 'Запись вернулась без всякого таймаута, счётчик стал 2. Ключ `o-1` уже в `processed` — `INSERT` вставил 0 строк, бонусы не тронуты, запись подтверждена. Бонусов **10**.',
    tone: 'ok',
  },
  {
    id: 'poison',
    label: 'ядовитое сообщение',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: -1,
    schedule: [
      ['P', 'publish', EV('o-9', 'abc')],
      ['w1', 'readNew'],
      ['wait', 300],
      ['w2', 'claimStale'],
      ['wait', 300],
      ['w1', 'claimStale'],
      ['wait', 300],
      ['w2', 'claimStale'],
    ],
    note: 'В событии `points abc` — не число. Никто не падает, но `UPDATE` каждый раз отвечает ошибкой `22P02`, а без подтверждения запись возвращается снова.',
    verdict: 'Три попытки — три отката. На четвёртой выдаче счётчик 4 > 3, и `w2` перекладывает запись в `events:dead` и подтверждает. Бонусов 0, в очереди мёртвых писем **1**, в списке ожидания пусто.',
    tone: 'warn',
  },
  {
    id: 'check-first',
    label: 'проверить, потом сделать',
    variant: { producer: 'outbox', handler: 'checkFirst' },
    crash: 'w1: начислил, ключа нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` проверил ключ, начислил и упал до того, как записал ключ.',
    verdict: '`w2` проверяет ключ — его нет — и начисляет снова. Бонусов **20**: ключ был, но записан отдельно от эффекта.',
    tone: 'err',
  },
  {
    id: 'idempotent-mid',
    label: 'падение до COMMIT',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'w1: начислил, COMMIT ещё нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` вставил ключ, начислил и упал до `COMMIT`.',
    verdict: 'Соединение оборвалось — Postgres откатил и ключ, и бонусы. `w2` вставляет ключ заново (1 строка) и начисляет. Бонусов **10**.',
    tone: 'ok',
  },
  {
    id: 'idempotent',
    label: 'падение после COMMIT',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'w1: COMMIT прошёл, XACK нет',
    schedule: [['P', 'publish', EV('o-1')], ['w1', 'readNew'], ['wait', 300], ['w2', 'claimStale']],
    note: '`w1` зафиксировал ключ и бонусы и упал до `XACK` — то же место, где «XACK после работы» давал 20.',
    verdict: '`w2` забирает запись, `INSERT … ON CONFLICT DO NOTHING` вставляет **0 строк** — дубль. Бонусы не тронуты, запись подтверждена. Бонусов **10**.',
    tone: 'ok',
  },
  {
    id: 'publish-after',
    label: 'XADD после COMMIT',
    variant: { producer: 'publishAfter', handler: 'idempotent' },
    crash: 'P: заказ зафиксирован',
    schedule: [['P', 'place', ORDER], ['w1', 'readNew']],
    note: 'Сервис заказов фиксирует заказ, а событие публикует следом — и падает между ними.',
    verdict: 'Заказ в базе есть, события в потоке нет. Обработчику читать нечего. Заказов 1, бонусов **0**.',
    tone: 'err',
  },
  {
    id: 'publish-inside',
    label: 'XADD до COMMIT',
    variant: { producer: 'publishInside', handler: 'idempotent' },
    crash: 'P: событие ушло, COMMIT ещё нет',
    schedule: [['P', 'place', ORDER], ['w1', 'readNew']],
    note: 'Событие публикуется внутри транзакции, до `COMMIT`. Процесс падает после публикации.',
    verdict: 'Транзакция откатилась — заказа нет. А событие уже в потоке, и обработчик начисляет бонусы за несуществующий заказ. Заказов **0**, бонусов 10.',
    tone: 'err',
  },
  {
    id: 'outbox-rollback',
    label: 'outbox: откат',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'P: заказ записан, COMMIT ещё нет',
    schedule: [['P', 'place', ORDER], ['R', 'relay'], ['w1', 'readNew']],
    note: 'Заказ и событие пишутся одной транзакцией. Процесс падает посреди неё.',
    verdict: 'Откатилось всё: нет ни заказа, ни строки в outbox. Ретранслятору нечего публиковать. Покупатель получит ошибку и повторит — ничего не потеряно и ничего не лишнее.',
    tone: 'ok',
  },
  {
    id: 'relay-twice',
    label: 'ретранслятор упал',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'R: опубликовал, отметки нет',
    schedule: [['P', 'place', ORDER], ['R', 'relay'], ['R', 'relay'], ['w1', 'readNew'], ['w1', 'readNew']],
    note: 'Ретранслятор опубликовал событие и упал, не поставив отметку `sent_at`. После перезапуска он видит ту же строку неопубликованной.',
    verdict: 'В потоке две записи, `1-0` и `2-0`, обе с `o-1`. Первая начисляет, вторая упирается в ключ: `INSERT` — 0 строк. Заказов 1, бонусов **10**.',
    tone: 'ok',
  },
  {
    id: 'reorder',
    label: 'два события',
    variant: { producer: 'outbox', handler: 'idempotent' },
    crash: 'w1: получил o-1',
    schedule: [
      ['P', 'publish', EV('o-1')],
      ['P', 'publish', EV('o-2', '30')],
      ['w1', 'readNew'],
      ['w2', 'readNew'],
      ['wait', 300],
      ['w2', 'claimStale'],
    ],
    note: 'Два события подряд: `o-1` и `o-2`. `w1` берёт первое и падает, `w2` берёт второе.',
    verdict: '`w2` обработал `o-2` раньше, чем `o-1`: первое событие пришло к нему повторной выдачей. Порядок записи в потоке — `1-0`, `2-0`, порядок эффектов — обратный.',
    tone: 'warn',
  },
];

export const SCENARIO_GROUPS = {
  ack: ['ack-first', 'ack-after-early', 'ack-after'],
  pending: ['restart'],
  poison: ['poison'],
  idempotent: ['check-first', 'idempotent-mid', 'idempotent'],
  outbox: ['publish-after', 'publish-inside', 'outbox-rollback', 'relay-twice'],
  order: ['reorder'],
} as const;

const byId = (ids: readonly string[]) => ids.map((id) => SCENARIOS.find((s) => s.id === id)!);

/** Сценарии каждого демо по разделам. */
export const SCENES = {
  ack: byId(SCENARIO_GROUPS.ack),
  pending: byId(SCENARIO_GROUPS.pending),
  poison: byId(SCENARIO_GROUPS.poison),
  idempotent: byId(SCENARIO_GROUPS.idempotent),
  outbox: byId(SCENARIO_GROUPS.outbox),
  order: byId(SCENARIO_GROUPS.order),
};

/** Все строки модели в порядке склейки — их собирает `loadModel` в демо и в тесте. */
export const PARTS = [SQL_CODE, BROKER_CODE, DB_CODE, CONSUMER_CODE, ACK_CODE, CLAIM_CODE, IDEMPOTENT_CODE, PRODUCER_CODE, RUNNER_CODE];

export const CAPTIONS = {
  ack: 'Одно событие, два обработчика и одно падение. Подсвечен итог на счёте: 10 — эффект один раз, 0 — потерян, 20 — дважды.',
  pending: 'Номер записи, кому она выдана и счётчик доставок — то, что Redis хранит в списке ожидания, — видны после каждой команды.',
  poison: 'Падения нет — есть ошибка в данных. Счётчик доставок растёт с каждой попыткой, и только он останавливает круг.',
  idempotent: 'Одно и то же место падения — после начисления — у трёх обработчиков. Разница только в том, где записан ключ.',
  outbox: 'Два способа ошибиться с двойной записью и outbox. Счёт заказов и бонусов должен совпасть: заказ без бонусов — потеря, бонусы без заказа — лишнее.',
  order: 'Без падений порядок совпал бы с порядком записи. Повторная выдача ставит старое событие после нового.',
};

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Ключ — номер записи в потоке',
    d: 'Номер `1-0` выдаёт Redis при каждой публикации. Ретранслятор, повторивший `XADD`, получит другой номер, и проверка по нему пропустит дубль. Ключ — номер события, который задал источник.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Ключ записан отдельно от эффекта',
    d: 'После эффекта — дубль при падении между ними, до эффекта в отдельной транзакции — потеря. Работает только одна транзакция на ключ и эффект.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Таймаут видимости короче обработки',
    d: 'Живой медленный обработчик теряет запись: её забирает другой, и эффект случается дважды без единого падения. `XACK` при этом не проверяет, за кем запись числится.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Курсор «опубликовано до id» в outbox',
    d: 'Номер `bigserial` выдаётся при вставке, а строка видна после `COMMIT`. Транзакция с меньшим номером, зафиксированная позже, окажется ниже курсора и не будет опубликована никогда. Отмечать каждую строку.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`XACK` не удаляет запись',
    d: 'Подтверждение убирает запись из списка ожидания, поток растёт дальше. Обрезка `MAXLEN` или `XTRIM` нужна отдельно — и она удаляет и неподтверждённые записи: `XAUTOCLAIM` вернёт их номера как удалённые.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Счётчик доставок считает и перезапуски',
    d: '`XREADGROUP … 0` своему же обработчику тоже увеличивает счётчик. Обработчик, который падает на старте в цикле, отправит здоровые сообщения в мёртвые.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Таблицу ключей чистят слишком рано',
    d: '`processed` растёт, и её чистят по возрасту. Ключ должен жить дольше, чем может прийти дубль, — включая повторную публикацию из очереди мёртвых писем через неделю.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Repeatable Read и `ON CONFLICT`',
    d: 'На Repeatable Read и Serializable одновременный дубль приходит не как `INSERT 0 0`, а как ошибка `40001`. Это не сбой: транзакцию повторяют, и на повторе будет 0 строк.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Порядок ломается не только параллельностью',
    d: 'Даже с одним обработчиком повторная выдача и очередь мёртвых писем ставят старое сообщение после нового. Где порядок важен — версия в событии или партиция по ключу.',
  },
  {
    n: '10',
    t: 'Очередь рвёт трассу',
    d: 'Автоинструментирование знает HTTP, а сообщение в очереди уходит без `traceparent`. Заголовок кладут в поля сообщения сами, иначе обработчик начнёт новую трассу.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Redis — Streams',
    href: 'https://redis.io/docs/latest/develop/data-types/streams/',
    what: 'группы потребителей, список ожидания, `XACK`, повторная выдача и счётчик доставок',
  },
  {
    title: 'Redis — XREADGROUP',
    href: 'https://redis.io/docs/latest/commands/xreadgroup/',
    what: '`>` против явного номера: новые записи или свои неподтверждённые',
  },
  {
    title: 'Redis — XAUTOCLAIM',
    href: 'https://redis.io/docs/latest/commands/xautoclaim/',
    what: 'минимальное время простоя, курсор, третий список — удалённые записи',
  },
  {
    title: 'Redis — XPENDING',
    href: 'https://redis.io/docs/latest/commands/xpending/',
    what: 'сводка и подробный вид: владелец, время простоя, счётчик доставок',
  },
  {
    title: 'PostgreSQL — INSERT, ON CONFLICT',
    href: 'https://www.postgresql.org/docs/current/sql-insert.html',
    what: '`ON CONFLICT DO NOTHING`, ожидание незафиксированной вставки, число вставленных строк',
  },
  {
    title: 'PostgreSQL — Transaction Isolation',
    href: 'https://www.postgresql.org/docs/current/transaction-iso.html',
    what: 'ошибка сериализации на Repeatable Read при конкурентной записи',
  },
  {
    title: 'Amazon SQS — Visibility timeout',
    href: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html',
    what: 'сообщение скрыто, пока его обрабатывают; 30 секунд по умолчанию; повтор после таймаута',
  },
  {
    title: 'Amazon SQS — Dead-letter queues',
    href: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html',
    what: 'redrive policy и `maxReceiveCount`',
  },
  {
    title: 'RabbitMQ — Consumer Acknowledgements and Publisher Confirms',
    href: 'https://www.rabbitmq.com/docs/confirms',
    what: 'ручное и автоматическое подтверждение, возврат неподтверждённых при закрытии канала',
  },
  {
    title: 'Apache Kafka — Message Delivery Semantics',
    href: 'https://kafka.apache.org/documentation/#semantics',
    what: 'at-most-once, at-least-once, exactly-once и где кончается гарантия Kafka',
  },
  {
    title: 'microservices.io — Transactional outbox',
    href: 'https://microservices.io/patterns/data/transactional-outbox.html',
    what: 'проблема двойной записи, таблица outbox, ретранслятор опросом и через журнал',
  },
  {
    title: 'Debezium — Outbox Event Router',
    href: 'https://debezium.io/documentation/reference/stable/transformations/outbox-event-router.html',
    what: 'ретранслятор outbox на логической репликации Postgres',
  },
];

export const RELATED =
  'Смежное на сайте: [Транзакции и уровни изоляции](/data/transactions/) — `COMMIT`, откат, `40001` и `SKIP LOCKED`. [Кеш перед базой](/data/redis-cache/) — тот же Redis, но как кеш: гонки инвалидации и замки `SET NX`. [Балансировка нагрузки, «Повторы»](/delivery/load-balancing/#s6) — повтор `POST` балансировщиком и `Idempotency-Key`. [Наблюдаемость, «Заголовок traceparent»](/delivery/observability/#s3) — как трасса переходит между сервисами и почему очередь её рвёт. [Стримы, «Записываемый и HWM»](/platform/streams/#s3) — обратное давление: что делать, когда получатель не успевает. [Долгое соединение, «Переподключение и heartbeat»](/platform/realtime/#s6) — `Last-Event-ID`: повторная доставка после обрыва, только в браузере. [Ограничение частоты в API](/platform/rate-limits/) — 429 и `Retry-After`, джиттер, бюджет повторов и `RetryAgent` из undici.';

// ─── Снято стендом ─────────────────────────────────────────────────────────────────────────

export const STAND_VERSIONS = {
  redis: '7.4.11',
  ioredis: '5.11.1',
  pglite: '0.5.8',
  pgliteServer: 'PostgreSQL 18.3',
  postgres: 'PostgreSQL 16.15',
};

/** Журнал и итог каждого сценария на Redis 7.4.11 + PGlite. Пересобирается живым тестом. */
export const STAND_RUNS: Record<string, { log: string[]; final: Final }> = {
  "ack-first": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: XACK events bonus 1-0 → (integer) 1",
      "w1: ✕ упал: XACK отправлен, начисления нет",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал ничего"
    ],
    "final": {
      "orders": 0,
      "points": 0,
      "pending": 0,
      "dead": 0
    }
  },
  "ack-after": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: ✕ упал: начислил, XACK нет",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал ничего",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: SQL.addPoints(7, 10) → строк: 1",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 20,
      "pending": 0,
      "dead": 0
    }
  },
  "ack-after-early": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: ✕ упал: получил o-1",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: SQL.addPoints(7, 10) → строк: 1",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  },
  "check-first": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: SQL.wasProcessed(o-1) → строк: 0",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: ✕ упал: начислил, ключа нет",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: SQL.wasProcessed(o-1) → строк: 0",
      "w2: SQL.addPoints(7, 10) → строк: 1",
      "w2: SQL.markProcessed(o-1) → строк: 1",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 20,
      "pending": 0,
      "dead": 0
    }
  },
  "idempotent": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 1",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: COMMIT",
      "w1: ✕ упал: COMMIT прошёл, XACK нет",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: BEGIN",
      "w2: SQL.markProcessed(o-1) → строк: 0",
      "w2: COMMIT",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  },
  "idempotent-mid": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 1",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: ✕ упал: начислил, COMMIT ещё нет",
      "w1: ROLLBACK: соединение оборвалось",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: BEGIN",
      "w2: SQL.markProcessed(o-1) → строк: 1",
      "w2: SQL.addPoints(7, 10) → строк: 1",
      "w2: COMMIT",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  },
  "restart": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 1",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: COMMIT",
      "w1: ✕ упал: COMMIT прошёл, XACK нет",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events 0 → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 0",
      "w1: COMMIT",
      "w1: XACK events bonus 1-0 → (integer) 1",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events 0 → (пусто)"
    ],
    "final": {
      "orders": 0,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  },
  "poison": {
    "log": [
      "P: XADD events * event o-9 user 7 points abc → 1-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-9 user 7 points abc}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-9) → строк: 1",
      "w1: SQL.addPoints(7, abc) → ошибка 22P02",
      "w1: ROLLBACK",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-9 user 7 points abc}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: BEGIN",
      "w2: SQL.markProcessed(o-9) → строк: 1",
      "w2: SQL.addPoints(7, abc) → ошибка 22P02",
      "w2: ROLLBACK",
      "прошло 300 мс",
      "w1: XAUTOCLAIM events bonus w1 200 0-0 COUNT 1 → забрал 1-0 {event o-9 user 7 points abc}",
      "w1: XPENDING events bonus 1-0 1-0 1 → 1-0 у w1, доставок 3",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-9) → строк: 1",
      "w1: SQL.addPoints(7, abc) → ошибка 22P02",
      "w1: ROLLBACK",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-9 user 7 points abc}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 4",
      "w2: XADD events:dead * event o-9 user 7 points abc from 1-0 → 2-0",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 0,
      "pending": 0,
      "dead": 1
    }
  },
  "reorder": {
    "log": [
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "P: XADD events * event o-2 user 7 points 30 → 2-0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: ✕ упал: получил o-1",
      "w2: XREADGROUP GROUP bonus w2 COUNT 1 STREAMS events > → 2-0 {event o-2 user 7 points 30}",
      "w2: BEGIN",
      "w2: SQL.markProcessed(o-2) → строк: 1",
      "w2: SQL.addPoints(7, 30) → строк: 1",
      "w2: COMMIT",
      "w2: XACK events bonus 2-0 → (integer) 1",
      "прошло 300 мс",
      "w2: XAUTOCLAIM events bonus w2 200 0-0 COUNT 1 → забрал 1-0 {event o-1 user 7 points 10}",
      "w2: XPENDING events bonus 1-0 1-0 1 → 1-0 у w2, доставок 2",
      "w2: BEGIN",
      "w2: SQL.markProcessed(o-1) → строк: 1",
      "w2: SQL.addPoints(7, 10) → строк: 1",
      "w2: COMMIT",
      "w2: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 40,
      "pending": 0,
      "dead": 0
    }
  },
  "publish-after": {
    "log": [
      "P: BEGIN",
      "P: SQL.insertOrder(o-1, 7, 1000) → строк: 1",
      "P: COMMIT",
      "P: ✕ упал: заказ зафиксирован",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → (nil)"
    ],
    "final": {
      "orders": 1,
      "points": 0,
      "pending": 0,
      "dead": 0
    }
  },
  "publish-inside": {
    "log": [
      "P: BEGIN",
      "P: SQL.insertOrder(o-1, 7, 1000) → строк: 1",
      "P: XADD events * event o-1 user 7 points 10 → 1-0",
      "P: ✕ упал: событие ушло, COMMIT ещё нет",
      "P: ROLLBACK: соединение оборвалось",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 1",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: COMMIT",
      "w1: XACK events bonus 1-0 → (integer) 1"
    ],
    "final": {
      "orders": 0,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  },
  "outbox-rollback": {
    "log": [
      "P: BEGIN",
      "P: SQL.insertOrder(o-1, 7, 1000) → строк: 1",
      "P: ✕ упал: заказ записан, COMMIT ещё нет",
      "P: ROLLBACK: соединение оборвалось",
      "R: SQL.pickOutbox() → строк: 0",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → (nil)"
    ],
    "final": {
      "orders": 0,
      "points": 0,
      "pending": 0,
      "dead": 0
    }
  },
  "relay-twice": {
    "log": [
      "P: BEGIN",
      "P: SQL.insertOrder(o-1, 7, 1000) → строк: 1",
      "P: SQL.insertOutbox(o-1, 7, 10) → строк: 1",
      "P: COMMIT",
      "R: SQL.pickOutbox() → строк: 1",
      "R: XADD events * event o-1 user 7 points 10 → 1-0",
      "R: ✕ упал: опубликовал, отметки нет",
      "R: SQL.pickOutbox() → строк: 1",
      "R: XADD events * event o-1 user 7 points 10 → 2-0",
      "R: SQL.markSent(1) → строк: 1",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 1-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 1",
      "w1: SQL.addPoints(7, 10) → строк: 1",
      "w1: COMMIT",
      "w1: XACK events bonus 1-0 → (integer) 1",
      "w1: XREADGROUP GROUP bonus w1 COUNT 1 STREAMS events > → 2-0 {event o-1 user 7 points 10}",
      "w1: BEGIN",
      "w1: SQL.markProcessed(o-1) → строк: 0",
      "w1: COMMIT",
      "w1: XACK events bonus 2-0 → (integer) 1"
    ],
    "final": {
      "orders": 1,
      "points": 10,
      "pending": 0,
      "dead": 0
    }
  }
};

/**
 * Перебор точек падения на `FULL_SCHEDULE`: вариант «издатель/обработчик» → по строке на метку:
 * `[где упал, заказов, бонусов]`. Redis 7.4.11 + PGlite, пересобирается живым тестом.
 */
export const STAND_FULL: Record<string, [string, number, number][]> = {
  "publishAfter/ackFirst": [
    [
      "P: заказ зафиксирован",
      1,
      0
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: XACK отправлен, начисления нет",
      1,
      0
    ]
  ],
  "publishAfter/ackAfter": [
    [
      "P: заказ зафиксирован",
      1,
      0
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, XACK нет",
      1,
      20
    ]
  ],
  "publishAfter/checkFirst": [
    [
      "P: заказ зафиксирован",
      1,
      0
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, ключа нет",
      1,
      20
    ]
  ],
  "publishAfter/idempotent": [
    [
      "P: заказ зафиксирован",
      1,
      0
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, COMMIT ещё нет",
      1,
      10
    ],
    [
      "w1: COMMIT прошёл, XACK нет",
      1,
      10
    ]
  ],
  "publishInside/ackFirst": [
    [
      "P: событие ушло, COMMIT ещё нет",
      0,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: XACK отправлен, начисления нет",
      1,
      0
    ]
  ],
  "publishInside/ackAfter": [
    [
      "P: событие ушло, COMMIT ещё нет",
      0,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, XACK нет",
      1,
      20
    ]
  ],
  "publishInside/checkFirst": [
    [
      "P: событие ушло, COMMIT ещё нет",
      0,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, ключа нет",
      1,
      20
    ]
  ],
  "publishInside/idempotent": [
    [
      "P: событие ушло, COMMIT ещё нет",
      0,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, COMMIT ещё нет",
      1,
      10
    ],
    [
      "w1: COMMIT прошёл, XACK нет",
      1,
      10
    ]
  ],
  "outbox/ackFirst": [
    [
      "P: заказ записан, COMMIT ещё нет",
      0,
      0
    ],
    [
      "R: опубликовал, отметки нет",
      1,
      20
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: XACK отправлен, начисления нет",
      1,
      0
    ]
  ],
  "outbox/ackAfter": [
    [
      "P: заказ записан, COMMIT ещё нет",
      0,
      0
    ],
    [
      "R: опубликовал, отметки нет",
      1,
      20
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, XACK нет",
      1,
      20
    ]
  ],
  "outbox/checkFirst": [
    [
      "P: заказ записан, COMMIT ещё нет",
      0,
      0
    ],
    [
      "R: опубликовал, отметки нет",
      1,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, ключа нет",
      1,
      20
    ]
  ],
  "outbox/idempotent": [
    [
      "P: заказ записан, COMMIT ещё нет",
      0,
      0
    ],
    [
      "R: опубликовал, отметки нет",
      1,
      10
    ],
    [
      "w1: получил o-1",
      1,
      10
    ],
    [
      "w1: начислил, COMMIT ещё нет",
      1,
      10
    ],
    [
      "w1: COMMIT прошёл, XACK нет",
      1,
      10
    ]
  ]
};

/** Сводка `STAND_FULL` для таблицы: сколько меток дали ровно один эффект, потерю и лишний. */
export const CRASH_SUMMARY = Object.entries(STAND_FULL).map(([key, rows]) => {
  const [producer, handler] = key.split('/');
  const outcome = ([, orders, points]: [string, number, number]) =>
    points / 10 === orders ? 'once' : points / 10 < orders ? 'lost' : 'extra';
  const count = (o: string) => rows.filter((r) => outcome(r) === o).length;
  return {
    producer: PRODUCER_OPTIONS.find((o) => o.value === producer)!.label,
    handler: HANDLER_OPTIONS.find((o) => o.value === handler)!.label,
    points: rows.length,
    once: count('once'),
    lost: count('lost'),
    extra: count('extra'),
  };
});
