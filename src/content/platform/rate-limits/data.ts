import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { HerdPreset, PolicyOptions, RetryAfterMode, RetryCode, Strategy } from '@/widgets/retry-lab/model/types';

/**
 * Данные темы «Ограничение частоты в API: 429, Retry-After и ретраи с джиттером».
 *
 * Тема написана 2026-10-02 для направления «Сеть и безопасность». Алгоритмы ограничителя
 * (ведро жетонов, дырявое ведро, окна) разобраны в `algorithms/rate-limiting` — здесь только
 * ссылка; эта тема — про HTTP вокруг лимита и про поведение клиента.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0 (встроенный undici 7.16.0), пакет `undici` **8.10.2** из `node_modules`
 * проекта (стоит транзитивно: astro → unifont), `@tanstack/query-core` 5.104.0, ioredis 5.11.1,
 * Chromium 153.0.8010.12 (Playwright 1.63), Docker: `nginx:1.30.0-alpine-slim`,
 * `redis:7-alpine` (Redis 7.4.11), Python 3.14.7. Скрипты — в scratchpad агента
 * (`agent-ratelimits/`), порты 5050–5055. Октябрь 2026.
 *
 * Что снято и чем пересобирается в `tests/unit/rate-limits.test.ts`:
 *   — **undici `RetryAgent`** (`UNDICI_CASES`): живой `node:http`, отдающий по сценарию 429/503
 *     с разными `Retry-After` и обрывы сокета. Паузу, которую undici попросил у `setTimeout`,
 *     записывает обёртка над его же функцией повтора по умолчанию (`RetryHandler`
 *     `[kRetryHandlerDefaultRetry]`): на время её синхронного вызова `setTimeout` подменён
 *     записью и нулевой задержкой. Тест повторяет это на каждом прогоне и сверяет с ним
 *     `POLICY_CODE` в режиме «как undici» (`UNDICI_LIKE`); расхождения перечислены в
 *     `UNDICI_CASES[].ours` и закреплены поштучно;
 *   — **`fetch` не повторяет**: Node 24 — тестом (`FETCH_CODE` на живом сервере, одно обращение);
 *     Chromium 153 — стендом (`CORS_ROWS`: страница на :5054 читала ответы :5055, на каждый путь
 *     сервер получил ровно один запрос; без `Access-Control-Expose-Headers` `retry-after`
 *     и `ratelimit` читаются как `null`). Браузерная часть тестом не повторяется;
 *   — **`RetryAgent` в Node без пакета нет**: среди имён `globalThis` Node 24.11 нет ни одного
 *     `*Agent`/`undici`; `fetch` построен на встроенном undici 7.16.0, но наружу он не отдан;
 *   — **AWS OCC-модель** (`AWS_ROWS`): исходник `src/backoff_simulator.py` из
 *     github.com/aws-samples/aws-arch-backoff-simulator, Python 3.14 (`xrange` → `range`),
 *     `random.seed(1)`, по 100 прогонов на точку. Тест портирует ту же модель на JS с `backoff`
 *     темы и зерном 1 и проверяет порядок стратегий и близость чисел (±8 %);
 *   — **симуляция стада и потока** (`HERD_STATS`, `STREAM_ROWS`, `BACKOFF_SAMPLES`): только
 *     `SIM_CODE` на виртуальных часах, зёрна 1…200; тест пересчитывает всё;
 *   — **адрес клиента** (`REALIP_ROWS`): nginx 1.30.0, `set_real_ip_from` 10/8, 172.16/12,
 *     192.168/16, `real_ip_header X-Forwarded-For`, `real_ip_recursive on` (порт 5050) и `off`
 *     (5052), ответ — `$remote_addr`; соединение приходило с `172.17.0.1` (шлюз Docker).
 *     Тест сверяет `CLIENT_IP_CODE` с этой таблицей;
 *   — **счётчик в Redis** (`REDIS_STAND`): `LIMIT_CODE`, три соединения ioredis к Redis 7.4.11,
 *     30 запросов по кругу, лимит 10 за окно 1000 мс. Тест прогоняет код на счётчиках в памяти
 *     всегда, а на живом Redis — при `RATELIMITS_REDIS_URL` (например `redis://127.0.0.1:5051`
 *     после `docker run -d --name rl-redis -p 127.0.0.1:5051:6379 redis:7-alpine`; блок делает
 *     `FLUSHALL`);
 *   — **GitHub** (`GH_HEADERS`): `curl -D -` на `https://api.github.com/repos/nodejs/undici`
 *     без токена, 2026-10-02 13:17:26 GMT. Живой запрос в тест не взят (сеть и квота 60 в час);
 *     тест проверяет согласованность литерала: `reset − date` = 3600 с, нужные имена в expose.
 *
 * Только по документации, без запуска: ky 2.1.0 (readme), axios-retry 4.5.0 (readme),
 * текст `draft-ietf-httpapi-ratelimit-headers-11` (23 мая 2026, истекает 24 ноября 2026,
 * RFC не стал — по datatracker), ответ GitHub 403/429 при превышении (docs.github.com),
 * бюджет повторов в gRPC (предложение A6) и предохранитель у Фаулера.
 */

// ─── Код темы: эти строки печатает страница, исполняют демо и тест ─────────────────────────

export const RETRY_AFTER_CODE = `// Retry-After: целые секунды или HTTP-дата. Ответ — сколько ждать (мс) или null.
function parseRetryAfter(value, now) {
  if (value == null) return null;
  const text = String(value).trim();
  if (/^\\d+$/.test(text)) return Number(text) * 1000;   // «120» — секунды
  if (!/[a-z]/i.test(text)) return null;                // «1.5», «-1»: не секунды и не дата
  const at = Date.parse(text);                          // «Fri, 02 Oct 2026 14:17:26 GMT»
  if (Number.isNaN(at)) return null;                    // мусор — как будто заголовка нет
  return Math.max(0, at - now);                         // дата в прошлом — можно сразу
}`;

export const BACKOFF_CODE = `// Воспроизводимая случайность: одно зерно — одна и та же последовательность.
function seeded(seed) {
  let a = seed >>> 0;
  return function random() {                            // mulberry32, числа в [0, 1)
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Пауза перед повтором номер attempt (с нуля). prev — прошлая пауза.
function backoff(strategy, attempt, prev, { base, cap }, random) {
  const ceiling = Math.min(cap, base * 2 ** attempt);   // потолок растёт вдвое
  switch (strategy) {
    case 'none':  return ceiling;                       // экспонента без джиттера
    case 'full':  return random() * ceiling;            // где угодно от 0 до потолка
    case 'equal': return ceiling / 2 + random() * ceiling / 2;
    case 'decorrelated':                                // от base до тройной прошлой
      return Math.min(cap, base + random() * (prev * 3 - base));
  }
  throw new Error('неизвестная стратегия: ' + strategy);
}`;

export const POLICY_CODE = `const IDEMPOTENT = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE', 'TRACE'];
const RETRY_STATUS = [429, 500, 502, 503, 504];
const RETRY_ERRORS = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ENETDOWN',
  'ENETUNREACH', 'EHOSTDOWN', 'EHOSTUNREACH', 'EPIPE', 'UND_ERR_SOCKET'];

function createRetryPolicy({
  maxRetries = 3, base = 500, cap = 30_000, strategy = 'full', seed = 1,
  retryAfter = 'jitter',      // 'ignore' | 'exact' | 'jitter'
  maxRetryAfter = 60_000,     // дольше ждать не готовы — сдаёмся сразу
  budget = null,              // { ratio: 0.1, reserve: 10 } — доля повторов
} = {}) {
  const random = seeded(seed);
  let tokens = budget ? budget.reserve : Infinity;
  return {
    // Каждый новый запрос (не повтор) пополняет бюджет на ratio.
    started() {
      if (budget) tokens = Math.min(budget.reserve, tokens + budget.ratio);
    },
    // req: { method, idempotencyKey }; outcome: { status, retryAfter } или { code }
    decide(req, outcome, { attempt, prev = base, now = 0 }) {
      if (!IDEMPOTENT.includes(req.method) && !req.idempotencyKey)
        return { retry: false, why: 'метод' };
      if (outcome.code ? !RETRY_ERRORS.includes(outcome.code)
                       : !RETRY_STATUS.includes(outcome.status))
        return { retry: false, why: outcome.code ? 'ошибка' : 'статус' };
      if (attempt >= maxRetries) return { retry: false, why: 'попытки' };
      const wait = retryAfter === 'ignore' ? null : parseRetryAfter(outcome.retryAfter, now);
      if (wait !== null && wait > maxRetryAfter) return { retry: false, why: 'Retry-After' };
      if (tokens < 1) return { retry: false, why: 'бюджет' };
      if (budget) tokens -= 1;
      let delay = backoff(strategy, attempt, prev, { base, cap }, random);
      if (wait !== null)                                // сервер сказал, сколько ждать
        delay = retryAfter === 'exact' ? wait : wait + random() * wait;
      return { retry: true, delay: Math.round(delay), why: wait !== null ? 'Retry-After' : 'пауза' };
    },
  };
}`;

export const BREAKER_CODE = `// Предохранитель: после threshold неудач подряд не пускает запросы cooldown мс,
// потом пропускает один пробный. Успех — замыкается, неудача — снова размыкается.
function createBreaker({ threshold = 5, cooldown = 5000 } = {}) {
  let failures = 0, openUntil = -Infinity, probing = false;
  return {
    allow(now) {
      if (failures < threshold) return true;            // замкнут: пускаем всех
      if (now < openUntil || probing) return false;     // разомкнут или проба в пути
      probing = true;                                   // полуоткрыт: один пробный
      return true;
    },
    record(ok, now) {
      probing = false;
      if (ok) { failures = 0; return; }
      failures++;
      if (failures >= threshold) openUntil = now + cooldown;
    },
  };
}`;

export const SIM_CODE = `// Запросы против сервера на виртуальных часах. До downUntil сервер лежит (503),
// потом пускает по ведру жетонов rate/burst, остальным — 429 и Retry-After.
function simulate({
  starts,                     // момент первой попытки каждого запроса, мс
  downUntil = 2000, rate = 10, burst = rate, latency = 20,
  policy: policyOptions = {}, breaker: breakerOptions = null,
} = {}) {
  const policy = createRetryPolicy(policyOptions);
  const breaker = breakerOptions && createBreaker(breakerOptions);
  let level = burst, last = downUntil;

  function serve(t) {
    if (t < downUntil) return { status: 503 };
    level = Math.min(burst, level + (t - last) * rate / 1000);
    last = t;
    if (level >= 1) { level -= 1; return { status: 200 }; }
    const ms = (1 - level) * 1000 / rate;               // до следующего жетона
    return { status: 429, retryAfter: String(Math.ceil(ms / 1000)) };
  }

  // Очередь событий по времени; при равенстве — по номеру запроса.
  const queue = [];
  const push = (e) => {
    let i = queue.length;
    while (i && (queue[i - 1].at > e.at ||
                 (queue[i - 1].at === e.at && queue[i - 1].id > e.id))) i--;
    queue.splice(i, 0, e);
  };
  starts.forEach((at, id) => push({ at, id, attempt: 0, prev: policyOptions.base ?? 500 }));

  const log = [];             // [момент на сервере, статус]
  const stats = { calls: 0, ok: 0, s429: 0, s503: 0, fastFail: 0, gaveUp: 0, lastOk: null };
  while (queue.length) {
    const e = queue.shift();
    if (e.attempt === 0) policy.started();
    if (breaker && !breaker.allow(e.at)) { stats.fastFail++; continue; }
    const t = e.at + latency / 2;                       // запрос дошёл до сервера
    const res = serve(t);
    const back = e.at + latency;                        // ответ вернулся
    stats.calls++;
    log.push([t, res.status]);
    breaker?.record(res.status === 200, back);
    if (res.status === 200) { stats.ok++; stats.lastOk = back; continue; }
    if (res.status === 429) stats.s429++; else stats.s503++;
    const d = policy.decide({ method: 'GET' }, res, { attempt: e.attempt, prev: e.prev, now: back });
    if (!d.retry) { stats.gaveUp++; continue; }
    push({ at: back + d.delay, id: e.id, attempt: e.attempt + 1, prev: d.delay });
  }
  return { ...stats, log };
}`;

/** Всё, что исполняет демо (`widgets/retry-lab`). */
export const RETRY_CODE: RetryCode = {
  retryAfter: RETRY_AFTER_CODE,
  backoff: BACKOFF_CODE,
  policy: POLICY_CODE,
  breaker: BREAKER_CODE,
  sim: SIM_CODE,
};

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '429 Too Many Requests',
    d: 'Код ответа «вы прислали слишком много запросов за отрезок времени». Лимит лично ваш: вашего токена, пользователя или адреса. Другие клиенты в ту же секунду получают ответы как обычно.',
  },
  {
    k: '`Retry-After`',
    d: 'Заголовок ответа: сколько подождать перед следующим запросом. Число секунд (`120`) или дата (`Fri, 02 Oct 2026 14:17:26 GMT`). Приходит с 429, 503 и некоторыми редиректами.',
  },
  {
    k: 'ретрай (повтор)',
    d: 'Тот же запрос, отправленный ещё раз после неудачи. Делает его клиент сам, без участия пользователя: библиотека, `fetch`-обёртка, SDK.',
  },
  {
    k: 'экспоненциальная задержка',
    d: 'Exponential backoff. Пауза перед повтором растёт вдвое с каждой неудачей: 0,5 с, 1 с, 2 с, 4 с… до потолка. Так клиент быстро повторяет после случайного сбоя и не долбит сервер, который лежит долго.',
  },
  {
    k: 'джиттер',
    d: 'Случайная часть паузы. Без неё клиенты, получившие отказ в одну миллисекунду, вернутся тоже в одну миллисекунду.',
  },
  {
    k: 'идемпотентный запрос',
    d: 'Запрос, который можно выполнить дважды с тем же итогом, что и один раз. `GET`, `PUT`, `DELETE` — по определению HTTP; `POST` и `PATCH` — нет.',
  },
  {
    k: 'громовое стадо',
    d: 'Thundering herd. Много клиентов одновременно делают одно и то же — например, разом повторяют запросы после сбоя — и своей толпой снова роняют сервер.',
  },
  {
    k: 'предохранитель',
    d: 'Circuit breaker. Обёртка вокруг вызовов: заметив череду неудач, она на время перестаёт пускать запросы к сервису вовсе и отвечает ошибкой сразу.',
  },
];

export const PLAIN_RATELIMIT =
  'Как очередь в кассу с табличкой «не больше трёх покупок в одни руки». Кассир отказывает не потому, что касса сломалась (это 503), а потому, что вы лично выбрали лимит (это 429), — и говорит, когда подойти снова (`Retry-After`). Вежливый покупатель приходит не раньше, а толпа покупателей, пришедших ровно в названную минуту, снова встанет стеной.';

export const PREREQ_NOTE =
  'Тема начинается там, где кончается устройство самого ограничителя, и опирается на три вещи из других тем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Как ограничитель считает запросы',
    d: 'Ведро жетонов, дырявое ведро, фиксированное и скользящее окно — алгоритмы, которые решают, пропустить запрос или отказать. Здесь они не разбираются: тема о том, как отказ выглядит в HTTP и что с ним делает клиент.',
    href: '/algorithms/rate-limiting/#s5',
    hrefLabel: '«Debounce, throttle и token bucket», раздел «Ведро жетонов»',
    tone: 'info',
  },
  {
    t: 'Повтор безопасен не для всех запросов',
    d: 'Запрос, на который не пришёл ответ, мог выполниться. `GET` повторять можно, `POST` «оплатить» — только с ключом идемпотентности, который сервер запоминает вместе с ответом.',
    href: '/delivery/load-balancing/#s6',
    hrefLabel: '«Балансировка нагрузки», раздел «Повторы»',
    tone: 'info',
  },
  {
    t: 'Прокси и `X-Forwarded-For`',
    d: 'Между клиентом и приложением обычно стоит nginx или балансировщик. Приложение видит соединение от прокси, а адрес клиента прокси дописывает в заголовок `X-Forwarded-For`.',
    href: '/delivery/nginx-proxy/#s4',
    hrefLabel: '«Nginx как обратный прокси», раздел «Заголовки к бэкенду»',
    tone: 'info',
  },
  {
    t: 'Виртуальные часы',
    d: 'Симуляции темы идут на часах, которые двигает сам код: пауза в 4 секунды проходит мгновенно, а одинаковое зерно случайности даёт одинаковый результат при каждом запуске.',
    href: '/algorithms/rate-limiting/#s1',
    hrefLabel: '«Debounce, throttle и token bucket», раздел «Часы»',
    tone: 'info',
  },
];

// ─── Раздел 1. 429 и 503 ───────────────────────────────────────────────────────────────────

export const STATUS_ROWS: { k: string; what: string; client: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    k: '`429 Too Many Requests`',
    what: 'RFC 6585: «пользователь прислал слишком много запросов за время». Отказ лично вам; кто такой «пользователь» и как считать, решает сервер. Кешировать такой ответ запрещено.',
    client: 'Замедлиться **самому**: подождать `Retry-After`, если он есть, и дальше слать реже.',
    tone: 'warn',
  },
  {
    k: '`503 Service Unavailable`',
    what: 'RFC 9110: сервер временно не может обработать запрос — перегрузка или обслуживание. Касается всех клиентов сразу.',
    client: 'Подождать и повторить. `Retry-After` здесь — сколько, по оценке сервера, он будет недоступен.',
    tone: 'err',
  },
  {
    k: '`403 Forbidden` у GitHub',
    what: 'По документации GitHub, при превышении лимита ответ — 403 **или** 429, а `x-ratelimit-remaining` равен 0.',
    client: 'Отличать от настоящего «нельзя» по заголовкам квоты и тексту ошибки: обычный 403 повторять бессмысленно.',
    tone: 'info',
  },
  {
    k: '`502`, `504`',
    what: 'Прокси не получил нормального ответа от бэкенда или не дождался его. Это сбой по дороге, а не лимит.',
    client: 'Повторять только то, что безопасно повторить: запрос мог дойти и выполниться.',
  },
];

export const STATUS_NOTE =
  'Различие 429 и 503 — не формальность. На 429 виноват темп **этого** клиента, и лучшее, что он может сделать, — замедлиться. На 503 сервер плох для всех, и если каждый клиент тут же повторит, нагрузка на лежащий сервер вырастет как раз тогда, когда ему хуже всего. `Retry-After` оба кода могут нести, а могут и нет: RFC разрешает его, но не требует.';

/** Ответ из примера B.3 черновика `draft-ietf-httpapi-ratelimit-headers-11` — дословно. */
export const RESPONSE_429 = `HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 20
RateLimit-Policy: "dynamic";q=100;w=60
RateLimit: "dynamic";r=15;t=40

{
  "status": 429,
  "detail": "Wait 20 seconds, then slow down!"
}`;

export const FETCH_CODE = `const res = await fetch(url);          // сервер ответил 429 и Retry-After: 2
res.ok;                                // false — но исключения нет
res.status;                            // 429
res.headers.get('retry-after');        // '2' — строка, разбирать самим
// Повтора не было: сервер получил ровно один запрос.`;

export const FETCH_RESULT = { ok: false, status: 429, retryAfter: '2', hits: 1 };

export const FETCH_NOTE =
  '`fetch` не повторяет ничего: ни 429, ни 503, ни оборванное соединение. Ответ с любым кодом для него — успешный ответ: промис выполняется, а `res.ok` просто равен `false`. Исключение бывает только при сетевой ошибке, когда ответа нет вовсе. Решать, ждать ли и повторять ли, приходится вашему коду или библиотеке поверх `fetch`.';

export const CORS_ROWS: { k: string; plain: string; exposed: string; tone?: 'warn' | 'ok' }[] = [
  { k: '`res.status`', plain: '`429`', exposed: '`429`' },
  { k: '`res.headers.get(\'retry-after\')`', plain: '`null`', exposed: '`\'2\'`', tone: 'warn' },
  { k: '`res.headers.get(\'ratelimit\')`', plain: '`null`', exposed: '`\'"default";r=0;t=2\'`', tone: 'warn' },
  { k: 'запросов на сервере', plain: '1', exposed: '1' },
];

export const CORS_NOTE =
  '`Retry-After` и заголовки квоты не входят в короткий список заголовков ответа, которые страница видит на запросе к **чужому** источнику без разрешения. Сервер обязан перечислить их в `Access-Control-Expose-Headers` — иначе `headers.get()` вернёт `null`, хотя заголовок пришёл и виден во вкладке «Сеть» DevTools. GitHub так и делает: `Retry-After` и все `X-RateLimit-*` стоят в его списке.';

// ─── Раздел 2. Retry-After ─────────────────────────────────────────────────────────────────

export const PLAIN_RETRY_AFTER =
  'Две формы одной записки. «Зайдите через две минуты» не зависит от того, сколько показывают ваши часы. «Зайдите в 14:17» зависит: если ваши часы спешат на пять минут, вы придёте рано. Поэтому секунды надёжнее даты, а дата полезна, когда известен точный момент: окончание работ, сброс квоты.';

/** Момент, от которого считается таблица: 2026-10-02 13:17:26 GMT — заголовок `date` GitHub со стенда. */
export const RA_NOW = Date.UTC(2026, 9, 2, 13, 17, 26);

export const RA_ROWS: { value: string | null; ms: number | null; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { value: '2', ms: 2000, d: 'Секунды — основная форма.', tone: 'ok' },
  { value: '0', ms: 0, d: 'Можно сразу. Ноль — не «заголовка нет».' },
  { value: 'Fri, 02 Oct 2026 13:17:29 GMT', ms: 3000, d: 'Дата: через три секунды после `Date` ответа. Точность — секунда: миллисекунд в HTTP-дате нет.', tone: 'ok' },
  { value: 'Mon, 05 Aug 2019 09:27:05 GMT', ms: 0, d: 'Дата в прошлом: ждать нечего.' },
  { value: '1.5', ms: null, d: 'Дробных секунд грамматика не допускает. `Date.parse(\'1.5\')` при этом даёт **январь 2001 года** — поэтому проверка «есть ли буквы» стоит до разбора даты.', tone: 'warn' },
  { value: 'soon', ms: null, d: 'Не число и не дата — как будто заголовка нет: пауза по своей формуле.' },
  { value: null, ms: null, d: 'Заголовка нет.' },
];

export const RA_NOTE =
  '«Не раньше чем через столько» — это минимум, а не расписание. Если сервер всем отказавшим ответил `Retry-After: 2`, то клиенты, вернувшиеся ровно через две секунды, снова придут вместе. Как это выглядит на пятидесяти клиентах — в демо раздела «Стадо после сбоя».';

// ─── Раздел 3. Заголовки квоты ─────────────────────────────────────────────────────────────

/** `curl -D -` на api.github.com/repos/nodejs/undici без токена — только строки про квоту. */
export const GH_HEADERS = `date: Fri, 02 Oct 2026 13:17:26 GMT
x-ratelimit-limit: 60
x-ratelimit-remaining: 58
x-ratelimit-used: 2
x-ratelimit-resource: core
x-ratelimit-reset: 1790950646
access-control-expose-headers: ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset, Warning`;

export const DRAFT_CODE = `RateLimit-Policy: "basic";q=100;w=60
RateLimit: "basic";r=60;t=58`;

export const QUOTA_ROWS: { k: string; draft: string; github: string }[] = [
  { k: 'размер квоты', draft: '`q=100` в `RateLimit-Policy`', github: '`x-ratelimit-limit: 60`' },
  { k: 'окно', draft: '`w=60` — секунды', github: 'нет в заголовках; по документации — час' },
  { k: 'осталось', draft: '`r=60` в `RateLimit`', github: '`x-ratelimit-remaining: 58`' },
  { k: 'когда обновится', draft: '`t=58` — **через** столько секунд', github: '`x-ratelimit-reset: 1790950646` — **момент**, секунды Unix' },
  { k: 'чья квота', draft: '`pk=:…:` — ключ раздела, байты', github: '`x-ratelimit-resource: core`' },
];

export const QUOTA_NOTE =
  'Своих заголовков квоты у HTTP нет до сих пор. Черновик IETF `RateLimit` / `RateLimit-Policy` дошёл до 11-й редакции (май 2026), RFC он пока не стал, а самые известные API давно живут со своими `X-RateLimit-*`. Главное отличие — в «когда»: черновик даёт **сколько секунд** осталось, GitHub — **момент** по часам Unix. На стенде это 1790950646, то есть 14:17:26 GMT — ровно через час после `date` ответа. Момент зависит от часов клиента, секунды — нет; черновик выбрал секунды именно поэтому и ещё затем, чтобы тысячи клиентов не получали один и тот же момент.';

export const QUOTA_FACTS: { t: string; d: string; tone?: 'warn' | 'info' }[] = [
  {
    t: '`Retry-After` важнее',
    d: 'Если в ответе есть и `Retry-After`, и `RateLimit`, по черновику главный `Retry-After`. Заголовки квоты — подсказка, чтобы **не дойти** до 429, а не инструкция после него.',
  },
  {
    t: 'Остаток не гарантия',
    d: '`r=1` не обещает, что следующий запрос пройдёт: сервер вправе урезать квоту в любой момент, например под нагрузкой. Черновик прямо запрещает клиенту на это рассчитывать.',
    tone: 'warn',
  },
  {
    t: 'Квота у GitHub — за час',
    d: 'Без токена — 60 запросов в час на адрес. `x-ratelimit-remaining: 0` вместе с 403 или 429 значит «ждать до `x-ratelimit-reset`», а не «повторить через секунду».',
    tone: 'info',
  },
];

// ─── Раздел 4. Ключ лимита ─────────────────────────────────────────────────────────────────

export const KEY_ROWS: { k: string; good: string; bad: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'адрес IP',
    good: 'Есть у любого запроса, даже без входа. Годится для страницы входа и регистрации.',
    bad: 'Офис за одним NAT, мобильный оператор, корпоративный прокси — сотни людей на одном адресе делят один лимит. Наоборот, у одного человека с IPv6 адресов миллиарды.',
    tone: 'warn',
  },
  {
    k: 'пользователь',
    good: 'Лимит следует за человеком, с какого бы устройства он ни пришёл.',
    bad: 'Работает только после входа; запросы до входа считать нечем.',
    tone: 'ok',
  },
  {
    k: 'токен API / приложение',
    good: 'Разные интеграции одного пользователя получают разные квоты, и сбойный скрипт не съедает квоту интерфейса.',
    bad: 'Токенов можно навыпускать много — лимит на токен без лимита на владельца обходится.',
    tone: 'ok',
  },
  {
    k: 'сочетание',
    good: 'Адрес — до входа, пользователь — после, плюс отдельный строгий лимит на дорогие ручки: вход, поиск, отправка писем.',
    bad: 'Больше счётчиков — больше обращений к хранилищу на каждый запрос.',
  },
];

export const CLIENT_IP_CODE = `// Адрес клиента за цепочкой прокси. remote — откуда пришло TCP-соединение,
// xff — заголовок X-Forwarded-For, trusted(ip) — наш ли это прокси.
function clientIp(remote, xff, trusted) {
  const chain = (xff ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let ip = remote;
  while (trusted(ip) && chain.length) {     // справа налево, пока это наши прокси
    const next = chain.pop();
    if (!isIp(next)) break;                 // мусор в цепочке — дальше не верим
    ip = next;
  }
  return ip;
}

const isIp = (s) => /^\\d{1,3}(\\.\\d{1,3}){3}$/.test(s) || (s.includes(':') && /^[0-9a-f:]+$/i.test(s));
const trusted = (ip) => /^(10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/.test(ip);  // частные сети`;

export const REALIP_REMOTE = '172.17.0.1';

/** nginx 1.30.0, `real_ip_recursive on` / `off`; доверены 10/8, 172.16/12, 192.168/16. */
export const REALIP_ROWS: { xff: string | null; on: string; off: string; first: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { xff: null, on: '172.17.0.1', off: '172.17.0.1', first: '172.17.0.1' },
  { xff: '203.0.113.7', on: '203.0.113.7', off: '203.0.113.7', first: '203.0.113.7' },
  { xff: '6.6.6.6, 203.0.113.7', on: '203.0.113.7', off: '203.0.113.7', first: '6.6.6.6', tone: 'err' },
  { xff: '203.0.113.7, 10.0.0.5', on: '203.0.113.7', off: '10.0.0.5', first: '203.0.113.7', tone: 'warn' },
  { xff: '6.6.6.6, 203.0.113.7, 10.0.0.5', on: '203.0.113.7', off: '10.0.0.5', first: '6.6.6.6', tone: 'err' },
  { xff: '10.0.0.9, 10.0.0.5', on: '10.0.0.9', off: '10.0.0.5', first: '10.0.0.9' },
  { xff: 'garbage, 10.0.0.5', on: '10.0.0.5', off: '10.0.0.5', first: 'garbage' },
];

export const REALIP_NOTE =
  'Каждый прокси **дописывает** в `X-Forwarded-For` адрес, с которого пришёл к нему запрос, — справа. Значит, правые записи сделали ваши прокси, а левые мог написать кто угодно, включая самого клиента: `6.6.6.6` в таблице вписан руками. Ключ лимита по «первому адресу» отдаёт выбор ключа атакующему — он меняет `X-Forwarded-For` на каждом запросе, и лимит его не видит. Правильно идти справа налево и остановиться на первом адресе, который **не** ваш прокси. Так делает nginx с `real_ip_recursive on`, и `clientIp` выше даёт те же ответы во всех строках. С `off` nginx берёт только последний адрес: если перед ним ещё один ваш прокси (`10.0.0.5`), все клиенты получат его адрес и один лимит на всех.';

// ─── Раздел 5. Лимит на кластере ───────────────────────────────────────────────────────────

export const LIMIT_CODE = `// Фиксированное окно поверх любого хранилища счётчиков.
async function allow(store, key, { limit, window }, now) {
  const slot = Math.floor(now / window);                // номер окна
  const count = await store.incr(\`rl:\${key}:\${slot}\`, window);
  return count <= limit;
}

// В памяти процесса: у каждого экземпляра сервиса — свой счётчик.
function memoryStore() {
  const counts = new Map();
  return {
    async incr(k) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k);
    },
  };
}

// В Redis: один счётчик на все экземпляры. INCR и срок — в одной транзакции,
// иначе падение между ними оставит ключ без срока.
function redisStore(redis) {
  return {
    async incr(k, window) {
      const [[, count]] = await redis.multi().incr(k).pexpire(k, window * 2, 'NX').exec();
      return count;
    },
  };
}`;

export const PLAIN_SHARED =
  'Как лимит «две порции в одни руки» в столовой с тремя раздачами. Если каждая раздача ведёт свой список, хитрый посетитель возьмёт по две на каждой — шесть. Один общий список у входа даёт честные две, но за ним нужно сходить с каждой раздачи.';

/** Redis 7.4.11, три соединения ioredis, 30 запросов по кругу, лимит 10 за окно 1000 мс. */
export const REDIS_STAND = { instances: 3, requests: 30, limit: 10, window: 1000, shared: 10, local: 30, counter: 30, pttlAbove: 1000 };

export const CLUSTER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Свой счётчик на каждом — лимит × N',
    d: 'Три экземпляра за балансировщиком, лимит 10 в секунду, тридцать запросов одного пользователя по кругу: со счётчиком в памяти прошли **все 30**, с общим в Redis — **10**. Делить лимит на число экземпляров помогает плохо: балансировщик раскладывает запросы неровно, а число экземпляров меняется при каждом масштабировании.',
    tone: 'err',
  },
  {
    t: 'Общий счётчик — ещё один поход по сети',
    d: 'Каждый запрос к API теперь начинается с `INCR` в Redis. Это обычно доли миллисекунды, но если Redis недоступен, нужно заранее решить: пускать всех без лимита (лимит выключился) или отказывать всем (лег весь API).',
    tone: 'warn',
  },
  {
    t: 'Окно — фиксированное',
    d: '`LIMIT_CODE` — самый простой счётчик, и у него известный изъян: на стыке двух окон пропускает до удвоенного лимита. Скользящий счётчик или ведро жетонов в Redis пишут скриптом Lua, чтобы чтение и запись шли одной командой.',
    tone: 'info',
  },
];

export const CLUSTER_NOTE =
  'Счётчик растёт и на отказанных запросах: после тридцати обращений в Redis лежит 30, хотя пропущено 10. Для фиксированного окна это не важно — сравнивается только `count <= limit`. Срок ставится с `NX` один раз, на первом `INCR` окна; ключ живёт два окна и исчезает сам. Почему `INCR` и срок нельзя разносить по двум командам — в [«Кеше перед базой», раздел «Срок ключа»](/data/redis-cache/#s2). Чем окно хуже ведра жетонов — в [«Debounce, throttle и token bucket», раздел «Окна»](/algorithms/rate-limiting/#s7).';

// ─── Раздел 6. Что повторять ───────────────────────────────────────────────────────────────

export const DECIDE_ROWS: { k: string; retry: string; why: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`GET`, `PUT`, `DELETE` → 503, 502, 504, 500', retry: 'да', why: 'Идемпотентны: второй раз даст тот же итог.', tone: 'ok' },
  { k: 'любой метод → 429', retry: 'да, если метод можно повторять', why: 'Отказ пришёл **до** работы: ограничитель стоит перед обработчиком. Но клиент этого не знает наверняка — 429 мог отдать и сам обработчик.' },
  { k: '`POST`, `PATCH` → 5xx или обрыв', retry: 'только с `Idempotency-Key`', why: 'Запрос мог выполниться, а ответ потеряться. Без ключа повтор — второй заказ.', tone: 'warn' },
  { k: 'обрыв соединения: `ECONNRESET`, `UND_ERR_SOCKET`', retry: 'да для идемпотентных', why: 'Сеть подвела — повтор часто проходит. Для `POST` неизвестно, дошёл ли запрос.' },
  { k: '400, 401, 403, 404, 409, 422', retry: 'нет', why: 'Повтор получит тот же ответ: запрос неверен, а не невовремя.', tone: 'err' },
  { k: '`Retry-After` дольше, чем готовы ждать', retry: 'нет — сдаться сразу', why: 'Повторить раньше — гарантированный новый отказ. Лучше честная ошибка пользователю.', tone: 'warn' },
];

export const DECIDE_NOTE =
  'Решение «повторять ли» складывается из трёх вопросов: **можно** ли (метод или ключ идемпотентности), **есть ли смысл** (код или ошибка из тех, что проходят со временем) и **сколько уже было** (попытки и бюджет). `decide` задаёт их в этом порядке и возвращает не только «да» или «нет», но и почему — это пригодится в журналах. Как сервер узнаёт повтор по ключу — в [«Очередях и идемпотентности», раздел «Ключ и дубли»](/data/queues/#s5).';

// ─── Раздел 7. Пауза и джиттер ─────────────────────────────────────────────────────────────

export const PLAIN_JITTER =
  'Как выход из кинотеатра после сеанса. Если все встают по последнему титру, у дверей давка. Экспонента без джиттера — это «каждый выходит через минуту после титров»: давка просто переносится на минуту. Джиттер — каждый встаёт, когда ему удобно, в пределах этой минуты, и двери справляются.';

export const STRATEGY_ROWS: { k: Strategy; label: string; formula: string; d: string }[] = [
  { k: 'none', label: 'без джиттера', formula: '`min(cap, base · 2ⁿ)`', d: 'Одинаковые клиенты получают одинаковые паузы и остаются в строю.' },
  { k: 'full', label: 'полный', formula: '`random(0, потолок)`', d: 'Разброс максимальный, пауза бывает почти нулевой.' },
  { k: 'equal', label: 'равный', formula: '`потолок / 2 + random(0, потолок / 2)`', d: 'Половина паузы гарантирована, разброс — во второй половине.' },
  { k: 'decorrelated', label: 'декоррелированный', formula: '`min(cap, random(base, прошлая · 3))`', d: 'Новая пауза зависит от прошлой, а не от номера попытки.' },
];

/** Первые шесть пауз при base 500, cap 20 000, зерно 1 — считает `backoff` выше. */
export const BACKOFF_SAMPLES: Record<Strategy, number[]> = {
  none: [500, 1000, 2000, 4000, 8000, 16000],
  full: [314, 3, 1055, 3924, 7747, 4498],
  equal: [407, 501, 1527, 3962, 7874, 10249],
  decorrelated: [1127, 508, 1040, 3070, 8935, 7894],
};

export const SAMPLES_NOTE =
  'Шесть пауз подряд при `base` 500 мс и зерне 1. У полного джиттера вторая пауза — **3 мс**: формула позволяет почти ноль, и это не ошибка. У декоррелированного пауза может и уменьшиться — 1127, потом 508: она случайна в пределах от `base` до тройной прошлой.';

/** aws-arch-backoff-simulator, Python 3.14, random.seed(1), по 100 прогонов на точку. */
export const AWS_ROWS: { clients: number; strategy: Strategy | 'noop'; time: number; calls: number }[] = [
  { clients: 50, strategy: 'none', time: 36443, calls: 623 },
  { clients: 50, strategy: 'decorrelated', time: 2216, calls: 374 },
  { clients: 50, strategy: 'equal', time: 4240, calls: 347 },
  { clients: 50, strategy: 'full', time: 2827, calls: 331 },
  { clients: 50, strategy: 'noop', time: 1150, calls: 693 },
  { clients: 100, strategy: 'none', time: 63307, calls: 1856 },
  { clients: 100, strategy: 'decorrelated', time: 4616, calls: 1002 },
  { clients: 100, strategy: 'equal', time: 6533, calls: 813 },
  { clients: 100, strategy: 'full', time: 4901, calls: 796 },
  { clients: 100, strategy: 'noop', time: 2030, calls: 2421 },
];

export const AWS_NOTE =
  'Так сравнивал стратегии Марк Брукер в статье AWS «Exponential Backoff And Jitter» (2015). Модель там другая, чем у ограничителя: клиенты пишут в одну строку базы с оптимистичной блокировкой, и за раунд выигрывает один. Числа выше — его собственный симулятор, запущенный заново: время до последнего успеха (виртуальные мс) и число вызовов. Полный джиттер — меньше всего вызовов, декоррелированный — быстрее, равный — медленнее обоих, экспонента без джиттера — хуже всех по обоим счетам. «Без пауз» заканчивает быстрее всех, но делает больше всех работы.';

// ─── Раздел 8. Стадо после сбоя (демо) ─────────────────────────────────────────────────────

export const HERD_PRESET: HerdPreset = {
  clients: 50,
  downUntil: 2000,
  rate: 10,
  latency: 20,
  base: 500,
  cap: 20_000,
  maxRetries: 10,
  bin: 500,
};

export const HERD_SETUP =
  `**Сценарий.** ${HERD_PRESET.clients} клиентов отправили запрос в момент сбоя. Первые ${HERD_PRESET.downUntil / 1000} с сервер отвечает 503 без \`Retry-After\`, потом поднимается, но пропускает не больше ${HERD_PRESET.rate} запросов в секунду (ведро жетонов), остальным — 429 и \`Retry-After\` в целых секундах. Политика повторов — \`createRetryPolicy\` выше: \`base\` ${HERD_PRESET.base} мс, потолок ${HERD_PRESET.cap / 1000} с, до ${HERD_PRESET.maxRetries} повторов.`;

/** Средние по зёрнам 1…200 — считает `SIM_CODE` на сценарии `HERD_PRESET`. Время — мс. */
export const HERD_STATS: Record<RetryAfterMode, Record<Strategy, { calls: number; s503: number; s429: number; lastOk: number }>> = {
  ignore: {
    none: { calls: 300, s503: 150, s429: 100, lastOk: 51660 },
    full: { calls: 247, s503: 184, s429: 13, lastOk: 11980 },
    equal: { calls: 229, s503: 151, s429: 28, lastOk: 8744 },
    decorrelated: { calls: 179, s503: 113, s429: 16, lastOk: 10795 },
  },
  exact: {
    none: { calls: 300, s503: 150, s429: 100, lastOk: 7660 },
    full: { calls: 258, s503: 184, s429: 23, lastOk: 8784 },
    equal: { calls: 257, s503: 151, s429: 56, lastOk: 6546 },
    decorrelated: { calls: 193, s503: 113, s429: 30, lastOk: 6532 },
  },
  jitter: {
    none: { calls: 265, s503: 150, s429: 65, lastOk: 8870 },
    full: { calls: 251, s503: 184, s429: 17, lastOk: 8827 },
    equal: { calls: 240, s503: 151, s429: 39, lastOk: 6583 },
    decorrelated: { calls: 184, s503: 113, s429: 21, lastOk: 6778 },
  },
};

export const HERD_SEEDS = 200;

export const RA_MODES: { k: RetryAfterMode; label: string; d: string }[] = [
  { k: 'ignore', label: 'не смотреть', d: 'Пауза только по своей формуле.' },
  { k: 'exact', label: 'ровно', d: 'Ждать ровно `Retry-After`.' },
  { k: 'jitter', label: 'с разбросом', d: '`Retry-After` плюс случайная доля от него же: от одного до двух `Retry-After`.' },
];

const fmtS = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} с`;

export const HERD_ROWS = (['none', 'full', 'equal', 'decorrelated'] as Strategy[]).map((s) => ({
  k: STRATEGY_ROWS.find((r) => r.k === s)!.label,
  calls: String(HERD_STATS.ignore[s].calls),
  s429: String(HERD_STATS.ignore[s].s429),
  lastOk: fmtS(HERD_STATS.ignore[s].lastOk),
  s429j: String(HERD_STATS.jitter[s].s429),
  lastOkj: fmtS(HERD_STATS.jitter[s].lastOk),
  tone: s === 'none' ? ('err' as const) : undefined,
}));

export const HERD_NOTE =
  `Средние по ${HERD_SEEDS} зёрнам. Экспонента без джиттера здесь хуже всех так же, как у AWS: все 50 клиентов приходят одной волной, сервер пропускает десять, сорок получают 429 — и уходят ждать одинаково долго. Без \`Retry-After\` последний клиент получает ответ через **${fmtS(HERD_STATS.ignore.none.lastOk)}**, хотя сервер поднялся через две. Среди стратегий с джиттером меньше всего отказов 429 у полного: он сильнее всех размазывает клиентов. Но он же чаще всех стучится в лежащий сервер — ${HERD_STATS.ignore.full.s503} ответов 503 против ${HERD_STATS.ignore.decorrelated.s503} у декоррелированного, — потому что разрешает паузы почти в ноль. А раньше всех здесь заканчивает **равный** джиттер, хотя у AWS он был самым медленным: модель другая, и порядок другой. Устойчиво одно — **джиттер нужен**, а какой именно, решают ваши числа.`;

export const RA_EFFECT_NOTE =
  `\`Retry-After\` меняет картину сильнее, чем выбор джиттера. Ждать его **ровно** — это вернуть стадо: ограничитель всем отказавшим отвечает «через 1 с», и у экспоненты без джиттера снова ${HERD_STATS.exact.none.s429} отказов 429 — каждую секунду все, кто ещё ждёт, приходят за десятью местами. Зато сервер сам задаёт темп, и все заканчивают за ${fmtS(HERD_STATS.exact.none.lastOk)}. С разбросом поверх \`Retry-After\` (от одного до двух его значений) у той же экспоненты отказов ${HERD_STATS.jitter.none.s429}, а у полного джиттера — ${HERD_STATS.jitter.full.s429}, и время почти то же.`;

export const HERD_CAPTION =
  'Столбик — полсекунды на часах сервера: зелёное — ответ 200, жёлтое — 429, красное — 503. Числа считает `simulate` выше с политикой `createRetryPolicy` из раздела «Что можно повторять» — те же строки, что напечатаны в теме. Зерно меняет только случайную часть пауз — у экспоненты без джиттера график от зерна не зависит вовсе.';

export const HERD_NOTES: Record<Strategy, string> = {
  none: 'Все клиенты считают паузу одинаково — и приходят строем. Каждая волна упирается в десять мест в секунду, остальные уходят ждать вдвое дольше прежнего.',
  full: 'Пауза — где угодно от нуля до потолка. Волны размазаны, отказов 429 меньше всего, но в лежащий сервер клиенты стучатся чаще: паузы бывают почти нулевыми.',
  equal: 'Половина паузы гарантирована, разброс — во второй половине. Пустых промежутков между волнами нет, и в этой модели клиенты заканчивают раньше остальных.',
  decorrelated: 'Каждая пауза — от `base` до тройной прошлой. Паузы растут быстрее, поэтому в лежащий сервер клиенты стучатся реже всех.',
};

// ─── Раздел 9. Бюджет и предохранитель ─────────────────────────────────────────────────────

export const PLAIN_BUDGET =
  'Как лимит на звонки в техподдержку из одного офиса. Пока линия работает, каждый перезванивает при обрыве — это нормально. Когда линия лежит у всех, сотня сотрудников, перезванивающих по три раза, превращает сто звонков в четыреста. Бюджет говорит: перезвонов не больше одного на десять обычных звонков. Предохранитель — табличка «линия не работает, не звоните пять минут».';

export const STREAM_SETUP =
  'Сервис отправляет 20 запросов в секунду в течение 30 секунд — 600 запросов. Первые 20 секунд сервер лежит (503), потом отвечает всем. Повторы — до трёх, полный джиттер, `base` 500 мс. Бюджет — `{ ratio: 0.1, reserve: 10 }`: десять повторов в запасе и ещё одна десятая на каждый новый запрос. Предохранитель — `threshold` 5, `cooldown` 2 с.';

export const STREAM_OPTIONS: Record<'none' | 'retry' | 'budget' | 'breaker', { policy: PolicyOptions; breaker?: { threshold: number; cooldown: number } }> = {
  none: { policy: { maxRetries: 0 } },
  retry: { policy: { maxRetries: 3, base: 500, strategy: 'full' } },
  budget: { policy: { maxRetries: 3, base: 500, strategy: 'full', budget: { ratio: 0.1, reserve: 10 } } },
  breaker: { policy: { maxRetries: 3, base: 500, strategy: 'full' }, breaker: { threshold: 5, cooldown: 2000 } },
};

export const STREAM_SCENE = { count: 600, every: 50, downUntil: 20_000, rate: 1000 };

export const STREAM_ROWS: { id: keyof typeof STREAM_OPTIONS; k: string; during: number; calls: number; ok: number; lost: number; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { id: 'none', k: 'без повторов', during: 400, calls: 600, ok: 200, lost: 400, d: 'Каждый запрос за время сбоя — одна попытка и ошибка.' },
  { id: 'retry', k: 'до трёх повторов', during: 1543, calls: 1780, ok: 237, lost: 363, d: 'Лежащий сервер получил почти **вчетверо** больше запросов. Спасены 37 — те, что начались в последние секунды сбоя.', tone: 'err' },
  { id: 'budget', k: 'повторы + бюджет', during: 449, calls: 649, ok: 200, lost: 400, d: 'Запас в десять повторов кончился в первые секунды, дальше — по одному на десять запросов. Нагрузка — плюс 12 %.', tone: 'ok' },
  { id: 'breaker', k: 'повторы + предохранитель', during: 14, calls: 201, ok: 187, lost: 413, d: 'После пяти неудач подряд запросы падают сразу, не уходя в сеть; раз в 2 с — одна проба. Цена — 13 запросов после подъёма, пока предохранитель ещё не замкнулся.', tone: 'warn' },
];

export const BUDGET_NOTE =
  'Повтор помогает, когда сбой короткий и случайный: один запрос из тысячи наткнулся на перезапуск. Когда лежит весь сервер, повтор не помогает почти никому и умножает нагрузку на число попыток — в таблице 1543 запроса вместо 400. Бюджет оставляет повторы для редких сбоев и отключает их для массовых: пока неудач мало, запаса хватает на каждый, когда их много — запас кончается. Так устроены повторы в gRPC: каждая неудача списывает жетон, каждый успех добавляет долю, и при половине пустого ведра повторы прекращаются.';

export const BREAKER_NOTE =
  'Предохранитель идёт дальше бюджета: он не пускает к лежащему сервису и **первые** попытки. Пользователь получает ошибку сразу, а не через три повтора и десять секунд ожидания, а сервис — время подняться без толпы. Плата — пробы раз в `cooldown`: пока проба не вернулась с успехом, живой сервис для клиента ещё «лежит». Балансировщик делает то же самое на своей стороне, исключая больной бэкенд по проверкам здоровья, — это разобрано в [«Балансировке нагрузки», раздел «Проверки здоровья»](/delivery/load-balancing/#s5).';

// ─── Раздел 10. Готовые клиенты ────────────────────────────────────────────────────────────

/** `POLICY_CODE` с параметрами undici `RetryAgent` по умолчанию: без джиттера, 500 мс × 2ⁿ, до 30 с. */
export const UNDICI_LIKE: PolicyOptions = { strategy: 'none', base: 500, cap: 30_000, maxRetries: 5, retryAfter: 'exact', maxRetryAfter: Infinity };

export type UndiciStep = 'reset' | { status: number; retryAfter?: string };

/** `+3s` в `retryAfter` — HTTP-дата через 3 с от момента запроса; тест подставляет её сам. */
export const UNDICI_CASES: {
  id: string;
  label: string;
  method: string;
  key?: boolean;
  script: UndiciStep[];
  hits: number;
  delays: number[];
  ours: { retry: boolean; delay?: number };
  differs?: string;
}[] = [
  { id: 'get-503', label: '`GET` → 503', method: 'GET', script: [{ status: 503 }, { status: 200 }], hits: 2, delays: [500], ours: { retry: true, delay: 500 } },
  { id: 'get-429-2', label: '`GET` → 429, `Retry-After: 2`', method: 'GET', script: [{ status: 429, retryAfter: '2' }, { status: 200 }], hits: 2, delays: [2000], ours: { retry: true, delay: 2000 } },
  { id: 'get-429-date', label: '`GET` → 429, дата через 3 с', method: 'GET', script: [{ status: 429, retryAfter: '+3s' }, { status: 200 }], hits: 2, delays: [], ours: { retry: true } },
  { id: 'get-429-120', label: '`GET` → 429, `Retry-After: 120`', method: 'GET', script: [{ status: 429, retryAfter: '120' }, { status: 200 }], hits: 2, delays: [30000], ours: { retry: true, delay: 120000 }, differs: 'undici срезает до `maxTimeout` — 30 с — и приходит на полторы минуты раньше, чем просили' },
  { id: 'get-503-0', label: '`GET` → 503, `Retry-After: 0`', method: 'GET', script: [{ status: 503, retryAfter: '0' }, { status: 200 }], hits: 2, delays: [0], ours: { retry: true, delay: 0 } },
  { id: 'get-503-1.5', label: '`GET` → 503, `Retry-After: 1.5`', method: 'GET', script: [{ status: 503, retryAfter: '1.5' }, { status: 200 }], hits: 2, delays: [1500], ours: { retry: true, delay: 500 }, differs: 'undici читает дробь через `Number()`; по грамматике такого значения нет, и наша политика ждёт по своей формуле' },
  { id: 'get-503-past', label: '`GET` → 503, дата в прошлом', method: 'GET', script: [{ status: 503, retryAfter: 'Mon, 05 Aug 2019 09:27:05 GMT' }, { status: 200 }], hits: 2, delays: [500], ours: { retry: true, delay: 0 }, differs: 'отрицательную паузу undici не берёт и ждёт 500 мс по формуле; наша — повторяет сразу' },
  { id: 'get-503-junk', label: '`GET` → 503, `Retry-After: soon`', method: 'GET', script: [{ status: 503, retryAfter: 'soon' }, { status: 200 }], hits: 2, delays: [500], ours: { retry: true, delay: 500 } },
  { id: 'get-503-forever', label: '`GET` → 503 всегда', method: 'GET', script: [{ status: 503 }], hits: 6, delays: [500, 1000, 2000, 4000, 8000], ours: { retry: true, delay: 500 } },
  { id: 'post-503', label: '`POST` → 503', method: 'POST', script: [{ status: 503 }, { status: 200 }], hits: 1, delays: [], ours: { retry: false } },
  { id: 'post-503-key', label: '`POST` + `Idempotency-Key` → 503', method: 'POST', key: true, script: [{ status: 503 }, { status: 200 }], hits: 1, delays: [], ours: { retry: true, delay: 500 }, differs: 'undici смотрит только на метод; ключ идемпотентности он не знает' },
  { id: 'patch-503', label: '`PATCH` → 503', method: 'PATCH', script: [{ status: 503 }, { status: 200 }], hits: 1, delays: [], ours: { retry: false } },
  { id: 'put-503', label: '`PUT` → 503', method: 'PUT', script: [{ status: 503 }, { status: 200 }], hits: 2, delays: [500], ours: { retry: true, delay: 500 } },
  { id: 'get-408', label: '`GET` → 408', method: 'GET', script: [{ status: 408 }, { status: 200 }], hits: 1, delays: [], ours: { retry: false } },
  { id: 'get-404', label: '`GET` → 404', method: 'GET', script: [{ status: 404 }, { status: 200 }], hits: 1, delays: [], ours: { retry: false } },
  { id: 'get-reset', label: '`GET` → обрыв сокета', method: 'GET', script: ['reset', { status: 200 }], hits: 2, delays: [500], ours: { retry: true, delay: 500 } },
  { id: 'post-reset', label: '`POST` → обрыв сокета', method: 'POST', script: ['reset', { status: 200 }], hits: 1, delays: [], ours: { retry: false } },
];

export const UNDICI_CODE = `import { Agent, RetryAgent, request } from 'undici';

const agent = new RetryAgent(new Agent(), {
  maxRetries: 3,              // по умолчанию 5
  minTimeout: 500,            // первая пауза, дальше ×2 (timeoutFactor)
  maxTimeout: 30_000,         // потолок паузы — и Retry-After тоже
});
const res = await request(url, { dispatcher: agent });
res.statusCode;               // 200 — после двух ответов 503`;

export const UNDICI_NOTE =
  '`RetryAgent` — обёртка над диспетчером undici: повторы прозрачны, наружу приходит последний ответ. Во встроенном `fetch` Node его нет: `fetch` в Node 24 построен на undici 7.16, но сам undici наружу не отдан, и `RetryAgent` требует пакета `undici`. Поведение по умолчанию: методы `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`, `TRACE`, `QUERY`; коды 429, 500, 502, 503, 504; пять повторов, паузы 500 мс × 2ⁿ до 30 с, **без джиттера**. `Retry-After` уважает — в секундах и датой, — но срезает его до `maxTimeout`. Когда попытки кончились, `request` не возвращает последний 503, а бросает `RequestRetryError` с `statusCode: 503`.';

export const CLIENT_ROWS: { k: string; retries: string; ra: string; jitter: string; how: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`fetch` (браузер, Node)', retries: 'нет', ra: 'нет; на чужом источнике без expose заголовок не прочитать', jitter: '—', how: 'запуск: Node 24, Chromium 153', tone: 'err' },
  { k: 'undici `RetryAgent` 8.10.2', retries: '5; `GET`, `PUT`, `DELETE`…; 429 и 5xx', ra: 'да, но не дольше `maxTimeout` (30 с)', jitter: 'нет', how: 'запуск', tone: 'warn' },
  { k: 'TanStack Query 5.104', retries: '3 для запросов, 0 для мутаций; любые ошибки', ra: 'нет — ядро не знает про HTTP', jitter: 'нет: 1, 2, 4 с', how: 'исходник `retryer.js`', tone: 'warn' },
  { k: 'ky 2.1.0', retries: '2; `get`, `put`, `head`, `delete`…; 408, 413, 429, 500, 502, 503, 504', ra: 'да для 413, 429, 503; ещё `RateLimit-Reset` и `X-RateLimit-Reset`', jitter: '`jitter: true` — полный; при `Retry-After` не применяется', how: '⚠️ по документации' },
  { k: 'axios-retry 4.5.0', retries: '3; сетевые ошибки и **5xx** идемпотентных — 429 по умолчанию нет', ra: 'да: ждёт большее из `Retry-After` и своей паузы', jitter: 'пауза по умолчанию — **ноль**; `exponentialDelay` со случайной добавкой', how: '⚠️ по документации', tone: 'warn' },
];

export const CLIENTS_NOTE =
  'Ни один из готовых клиентов не делает всего сразу: кто-то не смотрит на `Retry-After`, кто-то не знает джиттера, кто-то не повторяет 429. Повторы в TanStack Query разобраны в [«Кеше данных на клиенте», раздел «Фокус и повторы»](/frameworks/data-cache/#s4): там видно, как три повтора на 1, 2 и 4 секунды держат интерфейс в «загрузке» семь секунд. Переподключение тысячи сокетов с полным джиттером — в [«Долгих соединениях», раздел «Переподключение и heartbeat»](/platform/realtime/#s6).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Ждать `Retry-After` ровно — вернуть стадо',
    d: `Ограничитель отвечает всем отказавшим одно и то же «через 1 с», и клиенты, послушно вернувшиеся ровно через секунду, приходят снова вместе. В демо у экспоненты без джиттера так набирается ${HERD_STATS.exact.none.s429} отказов 429. \`Retry-After\` — нижняя граница: добавьте случайную часть сверху.`,
    tone: 'warn',
  },
  {
    n: '02',
    t: '`Date.parse(\'1.5\')` — это 2001 год',
    d: 'V8 охотно читает как дату почти любую строку с цифрами. Разбор «если не число, то дата» превращает кривой `Retry-After: 1.5` в момент двадцатипятилетней давности — и клиент повторяет без паузы. Дату разбирают, только если в строке есть буквы месяца и дня.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'undici срезает `Retry-After` до 30 секунд',
    d: 'Сервер просит 120 секунд, `RetryAgent` по умолчанию ждёт `maxTimeout` — 30 и получает новый 429. Если API отвечает долгими `Retry-After`, поднимите `maxTimeout` или решайте сами: ждать или честно вернуть ошибку.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'На чужом источнике `Retry-After` не виден',
    d: 'Заголовок пришёл, вкладка «Сеть» его показывает, а `res.headers.get(\'retry-after\')` возвращает `null`: его нет в `Access-Control-Expose-Headers`. Если ваш фронтенд ходит в API на другом домене, этот список — часть контракта API.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Первый адрес в `X-Forwarded-For` пишет клиент',
    d: 'Ключ лимита по левому адресу атакующий выбирает сам и меняет на каждом запросе. Брать адрес нужно справа налево, пропуская только свои прокси, — как nginx с `real_ip_recursive on`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Лимит в памяти на N экземплярах — это N лимитов',
    d: 'Три экземпляра и счётчик в памяти: из тридцати запросов при лимите 10 прошли все 30. Пока экземпляр один, ошибку не видно; она появляется при первом масштабировании.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Повторы умножают нагрузку на лежащий сервер',
    d: 'Три повтора на каждый запрос во время сбоя — почти вчетверо больше запросов к серверу, который и так не справляется (1543 вместо 400). Бюджет повторов или предохранитель нужны именно для массовых сбоев.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Экспонента без джиттера не разгоняет толпу',
    d: 'Удвоение паузы делает волны реже, но не меньше: одинаковые клиенты считают одинаково и возвращаются вместе. Без `Retry-After` последний из пятидесяти клиентов получает ответ через 51,7 с — при сервере, лежавшем две.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'axios-retry по умолчанию не ждёт и не повторяет 429',
    d: 'По документации пауза по умолчанию — ноль, а условие повтора — сетевые ошибки и 5xx на идемпотентных запросах. Отказ лимита (429) так и вернётся ошибкой, а повторы после 503 уйдут подряд без паузы, пока не задан `retryDelay`.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Повторяя `POST`, легко заказать дважды',
    d: 'Ответ потерялся — не значит, что запрос не выполнился. `POST` и `PATCH` повторяют только с `Idempotency-Key`, по которому сервер узнаёт повтор и отдаёт сохранённый ответ.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  { title: 'RFC 6585 — Additional HTTP Status Codes, §4: 429', href: 'https://www.rfc-editor.org/rfc/rfc6585#section-4', what: 'определение 429, `Retry-After` необязателен, кешировать запрещено' },
  { title: 'RFC 9110 — HTTP Semantics, §10.2.3: Retry-After', href: 'https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3', what: 'две формы: HTTP-дата и `delay-seconds` из одних цифр' },
  { title: 'RFC 9110, §15.6.4: 503 Service Unavailable', href: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4', what: 'временная перегрузка или обслуживание' },
  { title: 'RFC 9110, §9.2.2: Idempotent Methods', href: 'https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2', what: 'какие методы можно повторять' },
  { title: 'draft-ietf-httpapi-ratelimit-headers', href: 'https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/', what: '`RateLimit` и `RateLimit-Policy`; редакция 11 от 23 мая 2026, не RFC' },
  { title: 'draft-ietf-httpapi-idempotency-key-header', href: 'https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/', what: 'заголовок `Idempotency-Key`' },
  { title: 'GitHub Docs — Rate limits for the REST API', href: 'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api', what: '`x-ratelimit-*`, ответ 403 или 429, `reset` в секундах Unix' },
  { title: 'AWS Architecture Blog — Exponential Backoff And Jitter', href: 'https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/', what: 'полный, равный и декоррелированный джиттер; Марк Брукер, 2015' },
  { title: 'aws-samples/aws-arch-backoff-simulator', href: 'https://github.com/aws-samples/aws-arch-backoff-simulator', what: 'исходник симулятора из статьи; запущен заново для таблицы темы' },
  { title: 'Amazon Builders’ Library — Timeouts, retries, and backoff with jitter', href: 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/', what: 'повторы на каждом слое умножаются, бюджет повторов' },
  { title: 'gRPC — A6: Client Retries', href: 'https://github.com/grpc/proposal/blob/master/A6-client-retries.md', what: 'ограничение повторов ведром жетонов (retry throttling)' },
  { title: 'Martin Fowler — CircuitBreaker', href: 'https://martinfowler.com/bliki/CircuitBreaker.html', what: 'замкнут, разомкнут, полуоткрыт' },
  { title: 'undici — RetryAgent и RetryHandler', href: 'https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryHandler.md', what: 'параметры повторов; на стенде undici 8.10.2' },
  { title: 'nginx — ngx_http_realip_module', href: 'https://nginx.org/en/docs/http/ngx_http_realip_module.html', what: '`set_real_ip_from`, `real_ip_recursive`' },
  { title: 'Redis — INCR, раздел «Pattern: Rate limiter»', href: 'https://redis.io/docs/latest/commands/incr/', what: 'счётчик с ключом на окно' },
  { title: 'ky — retry', href: 'https://github.com/sindresorhus/ky', what: 'умолчания повторов, `afterStatusCodes`, `jitter`; версия 2.1.0' },
  { title: 'axios-retry', href: 'https://github.com/softonic/axios-retry', what: '`retryCondition`, `retryDelay`, `Retry-After`; версия 4.5.0' },
];

export const RELATED =
  'Смежное на сайте: [Debounce, throttle и token bucket](/algorithms/rate-limiting/#s5) — сами алгоритмы ограничителя: ведро жетонов, дырявое ведро, окна. [Балансировка нагрузки, раздел «Повторы»](/delivery/load-balancing/#s6) — повторы на стороне прокси и `Idempotency-Key`. [Nginx как обратный прокси, раздел «Заголовки к бэкенду»](/delivery/nginx-proxy/#s4) — откуда берётся `X-Forwarded-For`. [Кеш перед базой, раздел «Толпа»](/data/redis-cache/#s5) — то же стадо, но на промахе кеша. [CDN и серверный кеш, раздел «Кеш в приложении»](/platform/cdn-cache/#s6) — джиттер в сроке жизни ключей. [Долгие соединения, раздел «Переподключение и heartbeat»](/platform/realtime/#s6) — полный джиттер при переподключении сокетов. [Кеш данных на клиенте, раздел «Фокус и повторы»](/frameworks/data-cache/#s4) — повторы в TanStack Query.';
