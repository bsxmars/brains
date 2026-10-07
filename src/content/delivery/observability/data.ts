import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Hop, LatencySet, LogLine, StandSpan, TraceScenario } from '@/widgets/trace-lab/model/types';

/**
 * Данные темы «Наблюдаемость: логи, метрики и трассировка».
 *
 * Тема написана здесь, 2026-10-01, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@opentelemetry/api` **1.9.1**, `@opentelemetry/core`, `@opentelemetry/sdk-trace-base`
 * (шим над `@opentelemetry/sdk-trace`) и `@opentelemetry/resources` — **2.11.0**, всё из
 * `node_modules` проекта; Node 24.11.0, октябрь 2026.
 *
 * Три «сервиса» в одном процессе Node, у каждого свой `BasicTracerProvider` с ресурсом
 * `service.name`, все пишут в один `InMemorySpanExporter` через `SimpleSpanProcessor`:
 *   — `web` — клиент-заглушка вместо браузера: открывает корневой CLIENT-спан, кладёт
 *     `traceparent` через `W3CTraceContextPropagator.inject` и делает `http.get` в api;
 *   — `api` — `node:http`, порт 50041: `extract` → SERVER-спан → `auth.check` → CLIENT-спан
 *     `GET /stock` → `inject` → `http.get` в stock → `render cart`;
 *   — `stock` — `node:http`, порт 50042: `extract` → SERVER-спан → CLIENT-спан `SELECT stock`
 *     (базы нет, спан пишет сам сервис, как это делает инструментирование драйвера).
 * Сэмплер у всех один: `ParentBasedSampler({ root: TraceIdRatioBasedSampler(0.25) })`.
 *
 * Заголовки `traceparent` в `*_HOPS` — то, что сервер-получатель **реально** нашёл
 * в `req.headers`. Спаны — `exporter.getFinishedSpans()` в порядке экспорта.
 *
 * Что сделано детерминированным и почему:
 *   — **id.** Свой `IdGenerator`: span id — первые 16 знаков sha256 от `span/<сценарий>/<n>`,
 *     trace id — первые 32 знака sha256 от `trace/<сценарий>/<k>` с наименьшим `k`, при котором
 *     `TraceIdRatioBasedSampler(0.25)` даёт нужное решение (записать — для `ok` и `error`,
 *     нет — для `unsampled`). Формат тот же, что у `RandomIdGenerator`; зато тест получает
 *     те же номера и сверяет литералы как есть;
 *   — **время.** `startTime`/`end()` заданы сценарием: от 2026-10-01T09:00:00Z плюс смещение
 *     в мс (`OK`/`FAIL` в тесте). Длительности — не замер скорости, а структура запроса;
 *   — **`exception.stacktrace`** у события `exception` отброшен: в нём абсолютный путь стенда.
 *
 * Испорченный заголовок: api получил `00-4BF92F35…-01` заглавными — SDK не принял его и начал
 * новую трассу (`INVALID_HEADER_TRACE`, родителя нет).
 *
 * Всё перечисленное пересобирается `tests/unit/observability.test.ts` на свободных портах
 * и сверяется с литералами ниже. Там же `TRACEPARENT_CODE` сверяется с
 * `W3CTraceContextPropagator` (и на снятых заголовках, и на таблице испорченных), `TREE_CODE` —
 * со ссылками на родителя в спанах SDK.
 *
 * ── Чего стенд не закрывает ────────────────────────────────────────────────────────────────
 * SDK метрик (`@opentelemetry/sdk-metrics`) в проекте нет: `METRICS_CODE` исполняется тестом
 * против no-op метра из `@opentelemetry/api` — проверены только вызовы. Границы корзин SDK
 * по умолчанию (`OTEL_DEFAULT_BOUNDS`), `histogram_quantile` Prometheus, tail-based сэмплирование
 * в коллекторе, `FetchInstrumentation` и `<meta name="traceparent">` для загрузки документа —
 * по документации, не запускались. Наборы задержек (`LATENCY_*`) — синтетические, собраны
 * формулой ниже, а не сняты с сервиса.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'телеметрия',
    d: 'Данные, которые работающая программа сообщает о себе: записи логов, числа метрик, спаны трасс. Её пишет сам код сервиса, а читают люди и алерты.',
  },
  {
    k: 'OpenTelemetry (OTel)',
    d: 'Открытый стандарт и набор библиотек для телеметрии. **API** — то, что вызывает код («начать спан»), **SDK** — то, что собирает данные, решает, что записать, и отправляет.',
  },
  {
    k: 'экспортёр',
    d: 'Часть SDK, которая отправляет собранное: в коллектор, сразу в хранилище или просто в память процесса (`InMemorySpanExporter`, удобно для тестов).',
  },
  {
    k: 'бэкенд наблюдаемости',
    d: 'Хранилище с поиском и графиками. Для трасс — Jaeger или Tempo, для метрик — Prometheus, для логов — Loki или Elasticsearch. Сервисы туда пишут, человек оттуда читает.',
  },
  {
    k: 'инструментирование',
    d: 'Код, который пишет телеметрию. Бывает ручным — `tracer.startSpan(…)` в своём коде — и автоматическим: обёртки вокруг `http`, `fetch` и драйверов баз данных.',
  },
  {
    k: 'атрибут (метка)',
    d: 'Пара «ключ — значение» на спане, записи лога или точке метрики: `http.route = /api/cart`. У метрик их обычно называют метками.',
  },
];

export const PLAIN_SIGNALS =
  'Представьте службу доставки. Журнал склада — это логи: «09:00:01, посылка 42, сканер не сработал». Табло на стене — метрики: «сегодня отправлено 1 200 посылок, обычно в пути два дня». А трек-номер на коробке — трасса: по нему видны все пункты, через которые прошла именно эта посылка, и сколько она пролежала в каждом.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи. Две разобраны в других темах, третья объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Сервисы зовут друг друга по HTTP',
    d: 'Один клик в браузере — это запрос к api, а api по ходу дела спрашивает другие сервисы: склад, оплату, базу. Каждый из них — отдельный процесс со своими логами и своими часами.',
    href: '/delivery/compose/#s1',
    hrefLabel: '«Docker Compose», раздел «Сервис, сеть и имена»',
    tone: 'info',
  },
  {
    t: 'Заголовки запроса и CORS',
    d: 'Запрос несёт заголовки — пары «имя: значение». Нестандартный заголовок браузер отправит на чужой источник, только если сервер разрешит его в ответе на предварительный запрос (preflight).',
    href: '/platform/security/#s2',
    hrefLabel: '«Безопасность фронтенда», раздел «CORS и preflight»',
    tone: 'info',
  },
  {
    t: 'Шестнадцатеричная запись',
    d: 'Цифры `0–9` и буквы `a–f`. Один такой знак — 4 бита, два — байт. Номер трассы — 32 знака, то есть 16 байт; номер спана — 16 знаков, 8 байт.',
    tone: 'info',
  },
];

// ─── Стенд: три сценария одного запроса ─────────────────────────────────────────────────────

/** Начало каждого сценария: от него отсчитано время спанов (мс). */
export const STAND_T0 = Date.UTC(2026, 9, 1, 9, 0, 0);

/** Сэмплер у корня стенда: доля записываемых трасс. */
export const STAND_RATIO = 0.25;

const OK_HOPS: Hop[] = [
  { from: 'web', to: 'api', traceparent: '00-3d1ed4f5e21e676478b74d96b2b7c441-0e4362272d9e7108-01' },
  { from: 'api', to: 'stock', traceparent: '00-3d1ed4f5e21e676478b74d96b2b7c441-d7fe48087ab8f57f-01' },
];

const OK_SPANS: StandSpan[] = [
  { service: 'api', name: 'auth.check', kind: 'INTERNAL', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: 'a23ce6c775d4aa3f', parentSpanId: '54e185b9801a82f0', start: 8, end: 13, status: 'UNSET', attributes: {}, events: [] },
  { service: 'stock', name: 'SELECT stock', kind: 'CLIENT', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: '2b05c9e16f76e991', parentSpanId: '1a66807c254db16f', start: 21, end: 88, status: 'UNSET', attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT', 'db.collection.name': 'stock' }, events: [] },
  { service: 'stock', name: 'GET /stock', kind: 'SERVER', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: '1a66807c254db16f', parentSpanId: 'd7fe48087ab8f57f', start: 19, end: 92, status: 'UNSET', attributes: { 'http.request.method': 'GET', 'http.route': '/stock', 'http.response.status_code': 200 }, events: [] },
  { service: 'api', name: 'GET /stock', kind: 'CLIENT', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: 'd7fe48087ab8f57f', parentSpanId: '54e185b9801a82f0', start: 15, end: 96, status: 'UNSET', attributes: { 'http.request.method': 'GET', 'server.address': 'stock', 'http.response.status_code': 200 }, events: [] },
  { service: 'api', name: 'render cart', kind: 'INTERNAL', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: '99b020e728f2809f', parentSpanId: '54e185b9801a82f0', start: 98, end: 114, status: 'UNSET', attributes: {}, events: [] },
  { service: 'api', name: 'GET /api/cart', kind: 'SERVER', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: '54e185b9801a82f0', parentSpanId: '0e4362272d9e7108', start: 6, end: 118, status: 'UNSET', attributes: { 'http.request.method': 'GET', 'http.route': '/api/cart', 'http.response.status_code': 200 }, events: [] },
  { service: 'web', name: 'GET /api/cart', kind: 'CLIENT', traceId: '3d1ed4f5e21e676478b74d96b2b7c441', spanId: '0e4362272d9e7108', parentSpanId: null, start: 0, end: 124, status: 'UNSET', attributes: { 'http.request.method': 'GET', 'server.address': 'api', 'url.path': '/api/cart', 'http.response.status_code': 200 }, events: [] },
];

const OK_LOGS: LogLine[] = [
  { ts: '2026-10-01T09:00:00.118Z', service: 'api', level: 'info', msg: 'GET /api/cart 200 in 112 ms', trace_id: '3d1ed4f5e21e676478b74d96b2b7c441', span_id: '54e185b9801a82f0' },
];

const ERROR_HOPS: Hop[] = [
  { from: 'web', to: 'api', traceparent: '00-39c9d9e73b8d61cec21d2631cdccc837-986ce13f0858852c-01' },
  { from: 'api', to: 'stock', traceparent: '00-39c9d9e73b8d61cec21d2631cdccc837-43033b0266ba7c4d-01' },
];

const ERROR_SPANS: StandSpan[] = [
  { service: 'api', name: 'auth.check', kind: 'INTERNAL', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '9f577e1fc1cc78a8', parentSpanId: '5081d8621c01ea52', start: 8, end: 13, status: 'UNSET', attributes: {}, events: [] },
  { service: 'stock', name: 'SELECT stock', kind: 'CLIENT', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '1d6869bee7b7dc0a', parentSpanId: '1d1e49b03e94c767', start: 21, end: 1021, status: 'ERROR', attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT', 'db.collection.name': 'stock' }, events: [{ name: 'exception', time: 1021, attributes: { 'exception.type': 'Error', 'exception.message': 'query timeout after 1000 ms' } }] },
  { service: 'stock', name: 'GET /stock', kind: 'SERVER', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '1d1e49b03e94c767', parentSpanId: '43033b0266ba7c4d', start: 19, end: 1023, status: 'ERROR', attributes: { 'http.request.method': 'GET', 'http.route': '/stock', 'http.response.status_code': 503 }, events: [] },
  { service: 'api', name: 'GET /stock', kind: 'CLIENT', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '43033b0266ba7c4d', parentSpanId: '5081d8621c01ea52', start: 15, end: 1027, status: 'ERROR', attributes: { 'http.request.method': 'GET', 'server.address': 'stock', 'http.response.status_code': 503 }, events: [] },
  { service: 'api', name: 'GET /api/cart', kind: 'SERVER', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '5081d8621c01ea52', parentSpanId: '986ce13f0858852c', start: 6, end: 1030, status: 'ERROR', attributes: { 'http.request.method': 'GET', 'http.route': '/api/cart', 'http.response.status_code': 502 }, events: [] },
  { service: 'web', name: 'GET /api/cart', kind: 'CLIENT', traceId: '39c9d9e73b8d61cec21d2631cdccc837', spanId: '986ce13f0858852c', parentSpanId: null, start: 0, end: 1036, status: 'ERROR', attributes: { 'http.request.method': 'GET', 'server.address': 'api', 'url.path': '/api/cart', 'http.response.status_code': 502 }, events: [] },
];

const ERROR_LOGS: LogLine[] = [
  { ts: '2026-10-01T09:00:01.021Z', service: 'stock', level: 'error', msg: 'stock query failed: query timeout after 1000 ms', trace_id: '39c9d9e73b8d61cec21d2631cdccc837', span_id: '1d6869bee7b7dc0a' },
  { ts: '2026-10-01T09:00:01.027Z', service: 'api', level: 'error', msg: 'GET /stock answered 503', trace_id: '39c9d9e73b8d61cec21d2631cdccc837', span_id: '43033b0266ba7c4d' },
  { ts: '2026-10-01T09:00:01.030Z', service: 'api', level: 'error', msg: 'GET /api/cart 502 in 1024 ms', trace_id: '39c9d9e73b8d61cec21d2631cdccc837', span_id: '5081d8621c01ea52' },
  { ts: '2026-10-01T09:00:01.036Z', service: 'web', level: 'error', msg: 'cart load failed: HTTP 502', trace_id: '39c9d9e73b8d61cec21d2631cdccc837', span_id: '986ce13f0858852c' },
];

const UNSAMPLED_HOPS: Hop[] = [
  { from: 'web', to: 'api', traceparent: '00-6180b44a28c043c641ffba89c10cb400-dbdfc4299b0243da-00' },
  { from: 'api', to: 'stock', traceparent: '00-6180b44a28c043c641ffba89c10cb400-ef9397e62d5db75d-00' },
];

const UNSAMPLED_SPANS: StandSpan[] = [
];

const UNSAMPLED_LOGS: LogLine[] = [
  { ts: '2026-10-01T09:00:01.021Z', service: 'stock', level: 'error', msg: 'stock query failed: query timeout after 1000 ms', trace_id: '6180b44a28c043c641ffba89c10cb400', span_id: '4ff7bdc9a6c9a55b' },
  { ts: '2026-10-01T09:00:01.027Z', service: 'api', level: 'error', msg: 'GET /stock answered 503', trace_id: '6180b44a28c043c641ffba89c10cb400', span_id: 'ef9397e62d5db75d' },
  { ts: '2026-10-01T09:00:01.030Z', service: 'api', level: 'error', msg: 'GET /api/cart 502 in 1024 ms', trace_id: '6180b44a28c043c641ffba89c10cb400', span_id: '008c770f2b4be8a7' },
  { ts: '2026-10-01T09:00:01.036Z', service: 'web', level: 'error', msg: 'cart load failed: HTTP 502', trace_id: '6180b44a28c043c641ffba89c10cb400', span_id: 'dbdfc4299b0243da' },
];

export const SCENARIOS: TraceScenario[] = [
  {
    id: 'ok',
    label: 'Успех',
    note: 'Корзина загрузилась за 124 мс. Самый длинный кусок — запрос к базе на складе: `SELECT stock` занял больше половины всего времени.',
    traceId: OK_HOPS[0].traceparent.slice(3, 35),
    status: 200,
    hops: OK_HOPS,
    spans: OK_SPANS,
    logs: OK_LOGS,
  },
  {
    id: 'error',
    label: 'Ошибка',
    note: 'База на складе не ответила за секунду. Ошибка поднялась по цепочке: склад ответил 503, api — 502, браузер показал сообщение. Красные спаны идут от базы до самого корня.',
    traceId: ERROR_HOPS[0].traceparent.slice(3, 35),
    status: 502,
    hops: ERROR_HOPS,
    spans: ERROR_SPANS,
    logs: ERROR_LOGS,
  },
  {
    id: 'unsampled',
    label: 'Вне выборки',
    note: 'Тот же сбой, но корень решил трассу не записывать: флаг `00`. Заголовки ушли дальше, номер трассы общий — а спанов нет ни одного. Логи остались, и в них тот же `trace_id`.',
    traceId: UNSAMPLED_HOPS[0].traceparent.slice(3, 35),
    status: 502,
    hops: UNSAMPLED_HOPS,
    spans: UNSAMPLED_SPANS,
    logs: UNSAMPLED_LOGS,
  },
];

/** Испорченный заголовок (заглавные буквы) и что из него вышло у api. */
export const INVALID_HEADER = '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01';
export const INVALID_HEADER_TRACE = { traceId: '29b36f4724913a671f79386a0a8f1ac4', parentSpanId: null };

const short = (id: string) => `${id.slice(0, 4)}…${id.slice(-4)}`;
const ERR = SCENARIOS[1];

// ─── Раздел 1. Три сигнала ─────────────────────────────────────────────────────────────────

export const SIGNAL_ROWS = [
  {
    k: 'лог',
    what: 'Одно событие: время, уровень, текст и поля.',
    asks: '«Что именно случилось в 09:00:01.021?»',
    lacks: 'Сколько таких событий за час — пока не пересчитаешь все записи.',
  },
  {
    k: 'метрика',
    what: 'Число во времени: счётчик или гистограмма, сведённые по меткам.',
    asks: '«Сколько ошибок в минуту? Насколько медленно отвечаем?»',
    lacks: 'Какой именно запрос был медленным: подробности уже сложены в число.',
  },
  {
    k: 'трасса',
    what: 'Дерево спанов одного запроса через все сервисы.',
    asks: '«Где этот запрос провёл секунду?»',
    lacks: 'Как часто такое бывает: трассы обычно хранят выборочно.',
  },
];

/** Логи сценария с ошибкой — по строке JSON на запись, как их пишут сервисы. */
export const INCIDENT_LOGS_CODE = ERR.logs.map((l) => JSON.stringify(l)).join('\n');

const errApi = ERR.spans.find((s) => s.service === 'api' && s.kind === 'SERVER')!;

export const INCIDENT_CARDS = [
  {
    t: 'Лог',
    d: `Четыре записи трёх сервисов. Первая — от склада: \`${ERR.logs[0].msg}\`. В каждой есть \`trace_id\` — по нему их и собирают вместе.`,
  },
  {
    t: 'Метрика',
    d: `У гистограммы длительности api с метками \`http.route=/api/cart\`, \`http.response.status_code=502\` количество выросло на единицу, а сумма — на ${((errApi.end - errApi.start) / 1000).toLocaleString('ru-RU')} с. Какой это был запрос, метрика уже не помнит.`,
  },
  {
    t: 'Трасса',
    d: `Трасса \`${short(ERR.traceId)}\`: ${ERR.spans.length} спанов, ${ERR.spans.filter((s) => s.status === 'ERROR').length} из них с ошибкой. Цепочка ведёт к \`SELECT stock\`, который шёл 1000 мс и кончился событием \`exception\`.`,
  },
];

export const INCIDENT_NOTE =
  'Три сигнала связывает один номер: `trace_id` в записи лога — это номер трассы. Без него лог и трасса лежат в разных хранилищах, и сопоставить их можно только по времени — «где-то около 09:00:01», среди тысячи других запросов той же секунды.';

// ─── Раздел 2. Спан и дерево ───────────────────────────────────────────────────────────────

export const PLAIN_SPAN =
  'Трек-номер посылки — это trace id: он один на всю дорогу. Каждый пункт сортировки ставит свою отметку — это спан: «принято в 10:02, отправлено в 10:40, пункт Казань». В отметке записано и откуда посылка пришла — номер предыдущей отметки. По этим ссылкам путь собирается обратно, даже если отметки пришли в разном порядке.';

const errDb = ERR.spans.find((s) => s.name === 'SELECT stock')!;

export const SPAN_FIELDS = [
  { k: 'traceId', ex: `\`${short(errDb.traceId)}\``, d: 'Номер трассы, 16 байт. Одинаковый у всех спанов одного запроса во всех сервисах.' },
  { k: 'spanId', ex: `\`${short(errDb.spanId)}\``, d: 'Номер этого спана, 8 байт. Уникален внутри трассы.' },
  { k: 'parentSpanId', ex: `\`${short(errDb.parentSpanId!)}\``, d: 'Номер родителя. У корня трассы его нет.' },
  { k: 'name', ex: `\`${errDb.name}\``, d: 'Что делалось. Без уникальных значений: `GET /users/:id`, а не `GET /users/123`, иначе одинаковые операции не сгруппировать.' },
  { k: 'kind', ex: `\`${errDb.kind}\``, d: '`SERVER` — принял запрос, `CLIENT` — отправил, `INTERNAL` — работа внутри процесса. Ещё есть `PRODUCER` и `CONSUMER` для очередей.' },
  { k: 'start, end', ex: `${errDb.start} → ${errDb.end} мс`, d: 'Время начала и конца по часам того процесса, который записал спан. Длительность — разность.' },
  { k: 'status', ex: `\`${errDb.status}\``, d: 'По умолчанию `UNSET` — это норма. `ERROR` ставит код или инструментирование, `OK` — только явно.' },
  { k: 'attributes', ex: '`db.system.name: postgresql`', d: 'Подробности. Имена берут из соглашений OpenTelemetry (semantic conventions), чтобы `http.route` значил одно и то же во всех сервисах.' },
  { k: 'events', ex: `\`exception\` в ${errDb.events[0].time} мс`, d: 'События внутри спана со своим временем: исключение, повтор запроса.' },
  { k: 'resource', ex: `\`service.name: ${errDb.service}\``, d: 'Кто записал: имя сервиса, версия, хост. Общий для всех спанов процесса и хранится один раз.' },
];

/** Спан `SELECT stock` из сценария с ошибкой — в том виде, как его хранит тема. */
export const SPAN_PRINT_CODE = JSON.stringify(errDb, null, 2);

/** Порядок, в каком экспортёр получил спаны успешного запроса. */
export const EXPORT_ORDER_CODE = SCENARIOS[0].spans
  .map((s, i) => `${i + 1}. ${s.service.padEnd(6)}${s.name.padEnd(15)}родитель ${s.parentSpanId ? short(s.parentSpanId) : '—'}`)
  .join('\n');

export const EXPORT_ORDER_NOTE =
  'Экспортёр получает спан, когда тот **закончился**. Поэтому дети приходят раньше родителей: первым пришёл `auth.check`, последним — корневой спан браузера. Спаны разных сервисов и вовсе едут в хранилище разными пакетами. Дерево собирают на месте — по ссылкам на родителя.';

export const TREE_CODE = `// Плоский список спанов — в любом порядке — превращается в дерево.
function buildTree(spans) {
  const byId = new Map();
  for (const s of spans) byId.set(s.spanId, { ...s, children: [] });

  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentSpanId ? byId.get(node.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);      // настоящий корень или «сирота»: родителя нет в списке
  }

  const byStart = (a, b) => a.start - b.start;
  for (const node of byId.values()) node.children.sort(byStart);
  return roots.sort(byStart);
}

// Дерево — в строки водопада: обход в глубину, глубина станет отступом.
function waterfall(roots) {
  const rows = [];
  const walk = (node, depth) => {
    rows.push({ span: node, depth, orphan: depth === 0 && node.parentSpanId !== null });
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}`;

export const TREE_NOTE =
  'Ссылка на родителя, которого нет в списке, — обычное дело. Так выглядит трасса, в которой один из сервисов не отправил свои спаны: упал, не настроен или выкинул их по своей выборке. Его потомки становятся «сиротами» — вторыми корнями без начала. Хранилище покажет их отдельно или с пометкой «родитель не найден».';

// ─── Раздел 3. Заголовок traceparent ───────────────────────────────────────────────────────

export const PLAIN_TRACEPARENT =
  'Как накладная, которую пункт сортировки кладёт в коробку для следующего пункта: трек-номер посылки и номер своей отметки. Следующий пункт ничего не придумывает — переписывает трек-номер и ссылается на предыдущую отметку. Потерялась накладная — следующий пункт заводит посылке новый трек-номер, и путь рвётся на два.';

export const HEADER_EXAMPLE = `traceparent: ${ERR.hops[0].traceparent}`;

const [, exTrace, exParent, exFlags] = ERR.hops[0].traceparent.split('-');

export const TRACEPARENT_PARTS = [
  { k: 'version', len: '2 знака', ex: '`00`', d: 'Версия формата. Сейчас одна — `00`; значение `ff` запрещено.' },
  { k: 'trace-id', len: '32 знака', ex: `\`${short(exTrace)}\``, d: 'Номер трассы. Все нули — недопустимы.' },
  { k: 'parent-id', len: '16 знаков', ex: `\`${short(exParent)}\``, d: 'Номер спана **отправителя** — того, кто делает этот запрос. Все нули — недопустимы.' },
  { k: 'trace-flags', len: '2 знака', ex: `\`${exFlags}\``, d: 'Битовые флаги. Младший бит — sampled: «отправитель записывает трассу».' },
];

export const TRACEPARENT_CODE = `const HEX = /^[0-9a-f]+$/;             // только строчные: так требует формат
const isHex = (s, len) => s.length === len && HEX.test(s);
const isZero = (s) => /^0+$/.test(s);

function parseTraceparent(header) {
  const parts = header.split('-');
  if (parts.length < 4) return null;
  const [version, traceId, parentId, flags] = parts;

  if (!isHex(version, 2) || version === 'ff') return null;
  // У версии 00 ровно четыре поля; у будущих версий хвост допустим.
  if (version === '00' && parts.length > 4) return null;
  if (!isHex(traceId, 32) || isZero(traceId)) return null;
  if (!isHex(parentId, 16) || isZero(parentId)) return null;
  if (!isHex(flags, 2)) return null;

  const f = parseInt(flags, 16);
  return { version, traceId, parentId, flags: f, sampled: (f & 1) === 1 };
}

// Исходящий запрос: тот же trace id, в parent-id — свой спан.
function formatTraceparent({ traceId, spanId, sampled }) {
  return \`00-\${traceId}-\${spanId}-\${sampled ? '01' : '00'}\`;
}`;

export const TRACEPARENT_NOTE = `Заголовок с ошибкой не принимается целиком — ни частично, ни «по возможности». Это не авария: получатель просто начинает новую трассу. Когда api получил заголовок заглавными буквами, \`00-4BF92F35…-01\`, SDK завёл трассу с новым номером \`${short(INVALID_HEADER_TRACE.traceId)}\` и без родителя. Запрос обработан, а путь разорван на две трассы, и ни одна не знает о другой.`;

/** Выдержка из api стенда: принять контекст, открыть свой спан, передать дальше. */
export const PROPAGATION_CODE = `// api: принять контекст из заголовков
const ctx = propagator.extract(ROOT_CONTEXT, req.headers, defaultTextMapGetter);
const server = tracer.startSpan('GET /api/cart', { kind: SpanKind.SERVER }, ctx);

// вызов склада — дочерний CLIENT-спан
const call = tracer.startSpan('GET /stock', { kind: SpanKind.CLIENT },
                              trace.setSpan(ctx, server));
const headers = {};
propagator.inject(trace.setSpan(ctx, call), headers, defaultTextMapSetter);
http.get({ host: 'stock', path: '/stock', headers });  // traceparent уехал`;

export const PROPAGATION_NOTE =
  'В исходящий заголовок уходит номер **CLIENT-спана** вызывающего, а не его SERVER-спана. Поэтому в дереве под CLIENT-спаном api висит SERVER-спан склада, и разница между ними — время в сети и в очереди склада. Руками это пишут редко: автоинструментирование `http`, `fetch`, Express делает то же самое. Но если сервис ходит к соседу самописным клиентом или через очередь сообщений, заголовок приходится класть самому — иначе трасса рвётся.';

export const DEMO_CAPTION =
  'Проследите, откуда у каждого сервиса родитель: номер в parent-id заголовка — это номер CLIENT-спана того, кто звонил. Водопад строят `buildTree` и `waterfall`, поля заголовка разбирает `parseTraceparent` — функции, напечатанные выше.';

export const TRACE_EMPTY_NOTE =
  'Спанов нет: корень поставил флаг `00`, и ни один сервис ничего не записал. Номер трассы при этом есть — в заголовках и в логах.';

// ─── Раздел 4. Сэмплирование ───────────────────────────────────────────────────────────────

export const PLAIN_SAMPLING =
  'Как выборочный досмотр на таможне. Решение «вскрываем» принимают на первом пункте и клеят на коробку красную наклейку. Дальше никто не решает заново — все смотрят на наклейку. Зато клеят её до того, как кто-то узнал, что внутри.';

export const SAMPLING_ROWS = [
  { who: 'корень — браузер или первый сервис', sees: 'родителя нет', does: 'Решает сам: `TraceIdRatioBased(0.25)` записывает примерно каждую четвёртую трассу.' },
  { who: 'api, склад', sees: 'флаг `01`', does: '`ParentBased`: родитель записывает — записываю и я.' },
  { who: 'api, склад', sees: 'флаг `00`', does: 'Родитель не записывает — и я нет. Спан всё равно получает номер, и заголовок уходит дальше с тем же trace id.' },
];

export const SAMPLER_CODE = `const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.25),   // решает только корень
});                                           // остальные смотрят на флаг родителя`;

/** Доля, которую `TraceIdRatioBasedSampler` JS SDK 2.11 вычисляет из trace id. */
export function ratioOf(traceId: string): number {
  let acc = 0;
  for (let i = 0; i < 32; i += 8) acc = (acc ^ parseInt(traceId.slice(i, i + 8), 16)) >>> 0;
  return acc / 2 ** 32;
}

const fmtRatio = (id: string) => ratioOf(id).toFixed(3).replace('.', ',');

export const SAMPLING_FACTS = [
  {
    t: 'Решает trace id, а не монетка',
    d: `JS SDK 2.11 режет trace id на четыре куска по 8 знаков, складывает их побитовым XOR и сравнивает с 0,25 · 2³². У трассы \`${short(SCENARIOS[0].traceId)}\` вышло ${fmtRatio(SCENARIOS[0].traceId)} — записана; у \`${short(SCENARIOS[2].traceId)}\` — ${fmtRatio(SCENARIOS[2].traceId)}, нет. Один trace id даёт одно решение в любом процессе с этим SDK. SDK на других языках вправе считать иначе — поэтому решает корень, а остальные смотрят на флаг.`,
  },
  {
    t: 'Без записи — не без контекста',
    d: `В сценарии вне выборки ни один сервис не записал ни одного спана, но оба заголовка ушли с флагом \`00\` и общим trace id, а логи — ${SCENARIOS[2].logs.length} строки — пришли с ним же. Поиск трассы по этому номеру вернёт «не найдено», поиск логов — найдёт всё.`,
    tone: 'warn' as const,
  },
  {
    t: 'Ошибка не знает, что её не записали',
    d: 'Решение принимают до того, как известен исход. При доле 0,25 три сбойных запроса из четырёх останутся без трассы — ровно те, что нужнее всего. Отсюда tail-based сэмплирование: коллектор держит все спаны трассы несколько секунд и решает после — оставить все ошибки и медленные, из остальных взять долю. Цена — память коллектора, и спаны одной трассы должны приходить в один и тот же экземпляр.',
    tone: 'err' as const,
  },
];

export const SAMPLING_NOTE =
  'Флаг в `traceparent` из браузера — пользовательский ввод. Любой может прислать `01` на каждом запросе и заставить вас записывать всё подряд. На входе в систему решение можно принимать заново — сэмплером без `ParentBased` у первого серверного сервиса, — а trace id при этом сохранить.';

// ─── Раздел 5. С фронта на бэк ─────────────────────────────────────────────────────────────

/** Конфигурация браузерного инструментирования — по документации, в стенде не запускалась. */
export const FRONT_CODE = `// Браузер: инструментирование fetch само кладёт traceparent в запрос.
// На свой источник — всегда, на чужой — только по этому списку.
new FetchInstrumentation({
  propagateTraceHeaderCorsUrls: [/^https:\\/\\/api\\.shop\\.example\\//],
});`;

export const CORS_CODE = `OPTIONS /api/cart
Origin: https://shop.example
Access-Control-Request-Headers: traceparent

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://shop.example
Access-Control-Allow-Headers: traceparent, tracestate`;

export const CORS_NOTE =
  '`traceparent` не входит в короткий список «безопасных» заголовков, поэтому запрос с ним на чужой источник браузер предваряет preflight-запросом. Если сервер не назвал `traceparent` в `Access-Control-Allow-Headers`, браузер не отправит **сам запрос** — сломается не трасса, а загрузка корзины. Поэтому инструментирование и не шлёт заголовок на чужие адреса без явного списка.';

export const CORRELATE_STEPS = [
  {
    k: '1. Фронт знает номер',
    d: `Корень трассы — браузер, поэтому trace id известен ещё до ответа: \`span.spanContext().traceId\`. Его кладут в отчёт об ошибке и в лог фронта — в примере это запись \`${ERR.logs.at(-1)!.msg}\` с \`trace_id ${short(ERR.traceId)}\`.`,
  },
  {
    k: '2. Трасса по номеру',
    d: 'Хранилище трасс по номеру отдаёт дерево: красная цепочка спанов ведёт к `SELECT stock` на складе с событием `exception`.',
  },
  {
    k: '3. Логи вокруг',
    d: `В логах всех сервисов есть поле \`trace_id\`. Фильтр по нему даёт ${ERR.logs.length} записи трёх сервисов по порядку — с текстом ошибки, которого в спанах нет.`,
  },
  {
    k: '4. Если фронт не трассирует',
    d: 'Тогда корнем становится api, и номер браузер узнаёт только из ответа: сервер кладёт его в заголовок ответа. С чужого источника `fetch` покажет такой заголовок, только если сервер перечислил его в `Access-Control-Expose-Headers`.',
  },
];

export const LOG_FACTS = [
  {
    t: 'Лог — структура, а не строка',
    d: 'Запись в JSON с полями `trace_id`, `span_id`, `service`, `level` ищется фильтром по полю. Та же информация в свободном тексте — только регулярным выражением, и каждый сервис пишет её по-своему.',
  },
  {
    t: 'Номер — из активного спана',
    d: 'В модели данных логов OpenTelemetry у записи есть поля `TraceId` и `SpanId`. Мост между библиотекой логов и SDK обычно заполняет их сам из текущего спана; вручную номер берут из `span.spanContext()`.',
  },
  {
    t: 'Первая загрузка страницы',
    d: 'Запрос за HTML браузер делает раньше, чем загрузится любой JS, — заголовок к нему не прицепить. Сервер может вписать свой контекст в `<meta name="traceparent" content="00-…">`, и инструментирование загрузки документа продолжит трассу сервера.',
  },
  {
    t: 'Стек в отчёте — позиции бандла',
    d: 'Ошибка из браузера приходит со стеком минифицированного файла. Номер трассы скажет, какой запрос упал, а строку исходника — карта исходников.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 6. Счётчик и гистограмма ───────────────────────────────────────────────────────

export const METRIC_KINDS = [
  { k: 'Counter (счётчик)', keeps: 'Число, которое только растёт.', ex: 'оформленные заказы', how: 'Скорость роста за окно: заказов в минуту. Само значение ничего не говорит.' },
  { k: 'UpDownCounter', keeps: 'Растёт и убывает.', ex: 'открытые соединения', how: 'Текущее значение.' },
  { k: 'Gauge', keeps: 'Последнее измеренное значение.', ex: 'занятая память', how: 'Текущее значение; складывать такие числа по времени бессмысленно.' },
  { k: 'Histogram (гистограмма)', keeps: 'Счётчики корзин, сумму и количество.', ex: 'длительность запроса', how: 'Перцентили по корзинам; среднее — сумма, делённая на количество; число запросов — количество.' },
];

/** Пишется против `metrics` из `@opentelemetry/api`. Тест исполняет эту строку против no-op метра. */
export const METRICS_CODE = `// metrics — из @opentelemetry/api
const meter = metrics.getMeter('api');

// Счётчик: только растёт. На графике — скорость роста.
const checkouts = meter.createCounter('cart.checkouts', {
  description: 'Оформленные заказы',
});

// Гистограмма: каждое значение падает в свою корзину.
// Имя и единица — по соглашениям OpenTelemetry для HTTP: секунды.
const duration = meter.createHistogram('http.server.request.duration', {
  unit: 's',
  advice: {
    explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1,
                               0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
  },
});

checkouts.add(1, { 'payment.method': 'card' });
duration.record(0.112, {
  'http.request.method': 'GET',
  'http.route': '/api/cart',
  'http.response.status_code': 200,
});`;

export const METRICS_NOTE =
  'Отдельный счётчик запросов не нужен: у гистограммы длительности уже есть количество, а с меткой статуса — и количество ошибок. Процесс хранит не значения, а несколько чисел на каждую комбинацию меток, и раз в несколько секунд отдаёт их экспортёру.';

export const PLAIN_HISTOGRAM =
  'Как сортировка писем по ячейкам «до 50 г», «до 100 г», «до 250 г». Письмо кладут в ячейку и забывают — остаётся только, сколько писем в какой ячейке. Вес конкретного письма уже не узнать, зато ячеек всегда столько же, сколько бы писем ни пришло.';

/** Границы корзин SDK по умолчанию — из спецификации OpenTelemetry (Explicit Bucket Histogram). */
export const OTEL_DEFAULT_BOUNDS = [0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000];

export const BUCKETS_NOTE =
  'Если границы не заданы, SDK берёт пятнадцать границ по умолчанию: `0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000` — шестнадцать корзин, последняя «больше 10 000». Числа рассчитаны на миллисекунды. Запишите в такую гистограмму секунды — `0.112` вместо `112`, — и все запросы быстрее пяти секунд лягут в одну корзину `(0, 5]`. Перцентили по ней бессмысленны.';

export const COUNTER_FACTS = [
  {
    t: 'Счётчик обнуляется при рестарте',
    d: 'Процесс перезапустился — счётчик начал с нуля. Функции вроде `rate()` в Prometheus такой спад распознают и не считают его отрицательной скоростью. Поэтому на графике смотрят скорость, а не значение.',
  },
  {
    t: 'Метрика не сэмплируется',
    d: 'В отличие от трасс, в гистограмму попадает каждый запрос. Стоит это одно сложение в памяти. Поэтому алерты строят на метриках: по выборке трасс доля ошибок видна с опозданием и шумом.',
  },
];

// ─── Раздел 7. Перцентили ──────────────────────────────────────────────────────────────────

export const PLAIN_PERCENTILE =
  'Выстройте тысячу запросов по длительности, от самого быстрого. p50 — тот, что стоит пятисотым: половина быстрее него. p99 — девятьсот девяностый: медленнее только десять. Среднее — это средняя температура по больнице: у одних жар, у других норма, а в среднем все здоровы.';

export const STATS_CODE = `// Перцентиль «по ближайшему рангу»: значение, не больше которого
// оказались q · 100% замеров.
function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(q * sorted.length);      // место в строю, с единицы
  return sorted[Math.max(rank, 1) - 1];
}

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Гистограмма хранит не значения, а счётчики корзин:
// корзина i — (bounds[i-1], bounds[i]], последняя — всё, что больше.
function bucketCounts(values, bounds) {
  const counts = new Array(bounds.length + 1).fill(0);
  for (const v of values) {
    let i = 0;
    while (i < bounds.length && v > bounds[i]) i++;
    counts[i]++;
  }
  return counts;
}

// Перцентиль по корзинам: найти корзину, где стоит нужный по счёту замер,
// и считать, что внутри неё значения разложены ровно.
function percentileFromBuckets(bounds, counts, q) {
  const rank = q * counts.reduce((sum, c) => sum + c, 0);
  let seen = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > 0 && seen + counts[i] >= rank) {
      if (i === bounds.length) return bounds[i - 1];   // за последней границей
      const lo = i === 0 ? 0 : bounds[i - 1];
      return lo + ((bounds[i] - lo) * (rank - seen)) / counts[i];
    }
    seen += counts[i];
  }
  return NaN;
}`;

/** Симметричный набор отклонений `-half…half` без нуля: среднее у него ровно 0. */
const spread = (half: number) => Array.from({ length: 2 * half + 1 }, (_, i) => i - half).filter((d) => d !== 0);

/** Синтетика: тысяча запросов по 80–120 мс. Среднее — ровно 100. */
export const LATENCY_EVEN: number[] = Array.from({ length: 1000 }, (_, i) => 100 + spread(20)[i % 40]);

/** Синтетика: 900 запросов по 35–65 мс и 100 по 500–600 мс. Среднее — тоже ровно 100. */
export const LATENCY_TAIL: number[] = [
  ...Array.from({ length: 900 }, (_, i) => 50 + spread(15)[i % 30]),
  ...spread(50).map((d) => 550 + d),
];

export const LATENCY_SETS: LatencySet[] = [
  {
    id: 'even',
    label: 'Ровно',
    note: 'Тысяча запросов, каждый от 80 до 120 мс. Среднее — 100 мс, и оно честно: так и ощущается.',
    values: LATENCY_EVEN,
  },
  {
    id: 'tail',
    label: 'С хвостом',
    note: 'Девятьсот запросов по 35–65 мс и сто — по полсекунды. Среднее то же самое, 100 мс, но каждый десятый пользователь ждёт впятеро дольше.',
    values: LATENCY_TAIL,
  },
];

export const LATENCY_CAPTION =
  'Сравните два набора: среднее у них совпадает до миллисекунды, а p99 различается почти впятеро. Точные перцентили считает `percentile` по всем значениям, оценку — `percentileFromBuckets` по шестнадцати корзинам, как это делает хранилище, у которого самих значений нет.';

export const PERCENTILE_FACTS = [
  {
    t: 'Перцентили не усредняют',
    d: 'Пусть первый набор — один под, второй — другой. Их p99 — 120 и 590 мс, «среднее p99» — 355. А p99 всех двух тысяч запросов вместе — 580 мс. Готовые перцентили нельзя ни усреднить, ни сложить. Гистограммы — можно: корзины складываются, и перцентиль считают уже по сумме.',
    tone: 'err' as const,
  },
  {
    t: 'Оценка по корзинам грубая',
    d: 'У набора с хвостом точный p99 — 590 мс, а оценка по корзинам — около 725: девяносто девять медленных запросов лежат в одной корзине от 500 до 750 мс, и где именно внутри — неизвестно. Ошибка доходит до ширины корзины. Поэтому границы ставят гуще там, где проходит ваш порог: «95% быстрее 300 мс» требует границы на 300.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 8. Кардинальность ──────────────────────────────────────────────────────────────

export const PLAIN_CARDINALITY =
  'Как шкафчики в раздевалке, где на каждое сочетание «цвет куртки × размер» нужен свой шкафчик. Цветов пять, размеров шесть — тридцать шкафчиков. Добавьте к сочетанию имя владельца — и шкафчиков станет столько, сколько посетителей было за всё время.';

/** Каждая строка добавляет метку к предыдущей. Рядов у гистограммы: 16 корзин + сумма + количество. */
export const CARDINALITY_ROWS = [
  { label: '`http.request.method`', values: 4 },
  { label: '+ `http.route`', values: 12 },
  { label: '+ `http.response.status_code`', values: 5 },
  { label: '+ `user.id`', values: 50000 },
];

export const SERIES_PER_HISTOGRAM = OTEL_DEFAULT_BOUNDS.length + 1 + 2;

const ru = (n: number) => n.toLocaleString('ru-RU');

/** Та же таблица с посчитанными произведениями — её печатает тема. */
export const CARDINALITY_TABLE = CARDINALITY_ROWS.reduce<
  { label: string; values: string; combos: string; series: string; n: number; tone: 'ok' | 'err' }[]
>((acc, r) => {
  const n = (acc.at(-1)?.n ?? 1) * r.values;
  return [...acc, { label: r.label, values: ru(r.values), combos: ru(n), series: ru(n * SERIES_PER_HISTOGRAM), n, tone: r.values > 1000 ? 'err' : 'ok' }];
}, []);

export const CARDINALITY_NOTE =
  'Уникальные значения — `user.id`, номер заказа, полный URL с параметрами — место в атрибутах спана и полях лога: там каждая запись и так отдельная. В метки метрики идут только значения из короткого списка. Отсюда и `http.route` — шаблон `/users/:id`, а не путь `/users/123`: путей бесконечно много, шаблонов — десяток.';

export const EXEMPLAR_NOTE =
  'Мост в обратную сторону — экземпляры (exemplars). К корзине гистограммы хранилище может приложить trace id одного из попавших в неё запросов. Тогда с графика «p99 вырос» можно перейти к конкретной медленной трассе, не добавляя `trace_id` в метки.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Ошибка в логах есть, трассы нет',
    d: 'Head-based сэмплирование решило не записывать трассу ещё до ошибки. `trace_id` в логе настоящий, но хранилище трасс ответит «не найдено». Это не поломка — это доля 0,25. Нужны трассы всех ошибок — нужен tail-based отбор в коллекторе.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Самописный клиент или очередь рвут трассу',
    d: 'Автоинструментирование знает `http` и `fetch`. Запрос через свою обёртку над сокетом или сообщение в очередь уходит без `traceparent`, и получатель начинает новую трассу. Ошибок нет — просто одна трасса стала двумя.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Заглавные буквы в traceparent',
    d: 'Самописный прокси или шлюз, который «нормализует» заголовок к верхнему регистру, ломает его: формат допускает только строчные. SDK молча выбрасывает такой заголовок и начинает новую трассу.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'traceparent на чужой источник без CORS ломает запрос',
    d: 'Нестандартный заголовок запускает preflight. Не разрешил сервер `traceparent` — браузер не отправит сам запрос, и страница перестанет работать. Включая трассировку на фронте, сначала разрешите заголовок на api.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Средние перцентилей',
    d: 'Средний p99 по подам — не p99 сервиса. На наборах этой темы: «среднее» 355 мс против настоящих 580. Перцентиль считают по сложенным гистограммам, а не по готовым перцентилям.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Секунды в корзинах для миллисекунд',
    d: 'Границы по умолчанию — `0, 5, 10, … 10000` — рассчитаны на миллисекунды. Запишите `0.112` секунды — и почти всё ляжет в корзину `(0, 5]`. Единица в имени или поле `unit` и границы корзин должны совпадать.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Уникальное значение в метке',
    d: '`user.id` в метке умножает число рядов на число пользователей. Память процесса и хранилища растёт, пока что-нибудь не упадёт. Уникальное — в атрибуты спана и поля лога.',
    tone: 'err',
  },
  {
    n: '08',
    t: '404 на сервере — не ошибка спана',
    d: 'По соглашениям OpenTelemetry для HTTP SERVER-спан с кодом 4xx остаётся `UNSET`: виноват клиент, а не сервер. Ошибкой его считает CLIENT-спан того, кто звонил. Фильтр «все спаны с ошибкой» поэтому не покажет ответы 404 на стороне сервера.',
  },
  {
    n: '09',
    t: 'У сервисов разные часы',
    d: 'Время спана пишет тот процесс, который его записал, по своим часам. Разойдутся часы двух машин на 20 мс — и дочерний спан на водопаде начнётся раньше родителя. Длительность внутри одного спана при этом верна: начало и конец взяты с одних часов.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Trace Context',
    href: 'https://www.w3.org/TR/trace-context/',
    what: 'формат `traceparent` и `tracestate`, правила разбора, флаг sampled, что делать с неверным заголовком',
  },
  {
    title: 'OpenTelemetry — Traces',
    href: 'https://opentelemetry.io/docs/concepts/signals/traces/',
    what: 'спан, его поля, виды (kind), статус, события',
  },
  {
    title: 'OpenTelemetry — Context propagation',
    href: 'https://opentelemetry.io/docs/concepts/context-propagation/',
    what: 'как контекст переходит между процессами',
  },
  {
    title: 'OpenTelemetry — Sampling',
    href: 'https://opentelemetry.io/docs/concepts/sampling/',
    what: 'head-based и tail-based сэмплирование',
  },
  {
    title: 'OpenTelemetry — Metrics SDK: Explicit Bucket Histogram',
    href: 'https://opentelemetry.io/docs/specs/otel/metrics/sdk/#explicit-bucket-histogram-aggregation',
    what: 'границы корзин по умолчанию',
  },
  {
    title: 'OpenTelemetry — Semantic conventions for HTTP',
    href: 'https://opentelemetry.io/docs/specs/semconv/http/',
    what: '`http.server.request.duration` в секундах, статус спана для 4xx и 5xx',
  },
  {
    title: 'OpenTelemetry — Logs data model',
    href: 'https://opentelemetry.io/docs/specs/otel/logs/data-model/',
    what: 'поля `TraceId` и `SpanId` записи лога',
  },
  {
    title: 'opentelemetry-js',
    href: 'https://github.com/open-telemetry/opentelemetry-js',
    what: '`W3CTraceContextPropagator`, `ParentBasedSampler`, `TraceIdRatioBasedSampler`; примеры темы — на версии 2.11.0',
  },
  {
    title: 'Prometheus — Histograms and summaries',
    href: 'https://prometheus.io/docs/practices/histograms/',
    what: 'оценка перцентиля по корзинам и её погрешность, почему квантили не агрегируют',
  },
  {
    title: 'Prometheus — Metric and label naming',
    href: 'https://prometheus.io/docs/practices/naming/',
    what: 'метки и кардинальность',
  },
];

export const RELATED =
  'Смежное на сайте: [Прогрессивная доставка, раздел «Анализ»](/delivery/progressive-delivery/#s4) — p95 и доля ошибок канарейки против базы: метрики, по которым принимают решение о выкате. [Непрерывное профилирование памяти, раздел «Метрики»](/js/continuous-profiling/#s4) — метрики процесса Node и задержка цикла событий для алертов. [Source maps изнутри, раздел «От стека к исходнику»](/tooling/source-maps/#s3) — как стек ошибки с фронта превращается в строку исходника. [Безопасность фронтенда, раздел «CORS и preflight»](/platform/security/#s2) — почему нестандартный заголовок требует разрешения. [Безопасность бэкенда, раздел «Ошибки и секреты»](/platform/backend-security/#s5) — что не должно попасть ни в ответ, ни в лог. [Kubernetes: развёртывание](/delivery/kubernetes/) — поды и пробы, рядом с которыми обычно и живёт коллектор телеметрии. [Асинхронный контекст](/js/async-context/) — AsyncLocalStorage, момент снимка контекста и почему в браузере его пока нет.';
