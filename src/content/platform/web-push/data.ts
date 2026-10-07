import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { PushMode } from '@/widgets/push-lab/model/types';

/**
 * Данные темы «Web Push: путь уведомления от сервера до экрана».
 *
 * Тема написана здесь, 2026-10-01. Смежное не пересказывается, а даётся ссылкой: жизненный цикл
 * Service Worker — «Сеть и кеширование», раздел «Service Worker»; устройство JWT и подпись
 * HS256 — «Аутентификация», раздел «Подпись JWT»; ECDSA P-256 и формат подписи DER против r‖s —
 * «Passkeys и WebAuthn», раздел «Вход и подпись»; WebSocket и SSE — «Долгие соединения», раздел
 * «Когда нужно долгое соединение».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, `web-push` 3.6.7 (внутри `http_ece` 1.2.0), Playwright 1.63.0: Chromium
 * 153.0.8010.12 (`channel: 'chromium'`, headless), headless shell той же версии, Firefox 155.0,
 * WebKit 26.6. 1 октября 2026. Скрипты стенда лежали в каталоге scratchpad агента
 * (`agent-push/final-stand.mjs`, `crypto-stand.mjs`, `browser-stand.mjs`, `offline-stand.mjs`,
 * `engines.mjs`, `probe-sw.mjs`), в репозиторий не входят. Сеть у стенда была настоящая.
 *
 * Сервер — `node:http` на `localhost:53305` (localhost — безопасный контекст). Страница исполняет
 * `CLIENT_CODE` дословно, `/sw.js` — это `SW_CODE` дословно плюс служебный обработчик стенда,
 * который после показа уведомления шлёт `fetch('/log')` со списком `getNotifications()` и числом
 * открытых вкладок. Отправку делает `SERVER_CODE` дословно (без строки `import`, `webpush` и `db`
 * подставлены стендом) поверх настоящего `web-push`.
 *
 * Снято (литералы `STAND`, `REFUSALS`, `OFFLINE_ROWS`, `RESPONSES` — из журнала стенда без правок,
 * кроме сокращения заголовков ответа до `Location`):
 *   — **Настоящая подписка есть, но не везде.** Обычный контекст Playwright (`newContext`) —
 *     профиль «инкогнито»: `subscribe` → `AbortError: Registration failed - permission denied`
 *     и в headless, и с окном. С постоянным профилем (`launchPersistentContext`) Chromium
 *     153 headless подписался по-настоящему: `endpoint` на `jmt17.google.com/fcm/send/…`
 *     (у сборки Chromium без ключей Google; у Chrome адрес `fcm.googleapis.com` — это уже
 *     по документации). `p256dh` 65 байт, `auth` 16 байт, `expirationTime: null`.
 *   — Отправка `SERVER_CODE` на этот `endpoint` (сеть, FCM): 201 с `Location`; Service Worker
 *     показал уведомление через 0,6–6 с в разных прогонах (время не мерялось как замер — это
 *     разброс наблюдений). Чужой ключ VAPID → 403, без VAPID → 401, тело больше 4096 байт → 400
 *     (не 413), ровно 4096 (3993 байта текста) → 201; после `unsubscribe()` `notify` получил
 *     404/410 и удалил подписку из «базы». Тексты ответов — в `RESPONSES`.
 *   — **410 не мгновенный и не окончательный** (`unsub-stand.mjs`, `fresh-stand.mjs`): у только
 *     что созданной подписки первая отправка в первые секунды получала 410 в 4 прогонах из 11
 *     (дальше — 201); после `unsubscribe()` в одном прогоне из трёх среди восьми 410 попались
 *     два 201. Наблюдалось на адресе `jmt17.google.com`; переносить ли это на Chrome и
 *     `fcm.googleapis.com` — не проверено.
 *   — Браузер закрыт (профиль на диске), пять отправок: два сообщения с одним `Topic`,
 *     одно без `Topic`, `TTL: 0` и `TTL: 5`, через 12 с браузер запущен снова. Через 3–16 с
 *     после запуска (в разных прогонах) пришли **два**:
 *     второе из пары с `Topic` и сообщение без него. Проснувшийся Service Worker не видел ни
 *     одной вкладки (`clients.matchAll` → 0). Прогонов три (два — `offline-stand.mjs`, один —
 *     `final-stand.mjs` с `SW_CODE`), итог одинаковый.
 *   — Три push подряд без `showNotification` (нарушение `userVisibleOnly`; отдельный стенд
 *     `offline-stand.mjs` со своим Service Worker, где такая ветка есть): 201, Service Worker
 *     отработал, своих уведомлений Chromium не добавил — `getNotifications()` прежний. Что делает
 *     браузер при систематическом нарушении — только по документации.
 *   — CDP `ServiceWorker.deliverPushMessage` (без сети): данные приходят в `event.data` открытым
 *     текстом, шифрование обходится. Два push с одним `tag` → одно уведомление, второе.
 *     Не-JSON в `event.data.json()` → обработчик бросил `SyntaxError`, уведомления нет.
 *     Headless shell на `showNotification` отвечает `TypeError: … No notification permission
 *     has been granted for this origin.` даже после `grantPermissions` — поэтому полный Chromium.
 *   — `PushManager.supportedContentEncodings` → `['aes128gcm', 'aesgcm']`; в Service Worker
 *     Chromium 153 есть `onpushsubscriptionchange` (`probe-sw.mjs`).
 *   — Firefox 155 из Playwright: `subscribe` не ответил за 15 с (push-сервер в сборке
 *     Playwright не настроен); WebKit 26.6: `NotAllowedError: User denied push permission`.
 *     Поведение Firefox и Safari в тексте — по документации.
 *
 * Только по документации, не запускалось: адреса push-сервисов Chrome, Firefox и Safari;
 * iOS и iPadOS 16.4+ — только для веб-приложения, добавленного на экран «Домой»; что Chrome
 * при нарушении `userVisibleOnly` показывает своё уведомление; `notificationclick` (клик
 * по системному уведомлению в headless не воспроизводится); как Urgency влияет на доставку;
 * что отказ в `requestPermission` запоминается и повторный вызов возвращает `denied` без окна
 * (headless Chromium без `grantPermissions` отвечает `denied` сразу — это не то же самое).
 *
 * ── Учебный код исполняется тестом ─────────────────────────────────────────────────────────
 * `PUSH_CODE` (шифрование RFC 8291 на `crypto.subtle`) и `VAPID_CODE` (подпись JWT ES256 и проверка
 * push-сервиса) собирает `widgets/push-lab/model/run.ts`; `tests/unit/web-push.test.ts` сверяет:
 * `encryptPush` с ключами и `salt` из RFC 8291, раздел 5 и Appendix A, даёт те же 144 байта
 * буква в букву, `decryptPush` их расшифровывает; `decryptPush` читает то, что зашифровал
 * `web-push`; `vapidAuth` даёт те же заголовок и нагрузку JWT, что `webpush.getVapidHeaders`,
 * а `checkVapid` принимает подпись `web-push`. Заметка: в примере RFC 8291 стоит
 * `Content-Length: 145`, а байтов в теле 144 (86 + 41 + 1 + 16) — тест сверяет байты, не число.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'push-сервис',
    d: 'Сервер производителя браузера, к которому устройство держит одно постоянное соединение: у Chrome — FCM от Google, у Firefox — autopush от Mozilla, у Safari — сервис Apple. Ваш сервер отдаёт сообщение ему, а не устройству.',
  },
  {
    k: 'подписка, `endpoint`',
    d: 'То, что браузер выдал вашей странице: адрес у push-сервиса (`endpoint`) и два ключа. Всё, что отправлено POST-запросом на этот адрес, push-сервис доставит этому браузеру и этому сайту.',
  },
  {
    k: '`p256dh` и `auth`',
    d: 'Ключи подписки. `p256dh` — открытый ключ браузера на кривой P-256, 65 байт. `auth` — 16 случайных байт, общий секрет браузера и вашего сервера. Оба нужны, чтобы зашифровать сообщение так, что прочитает только этот браузер.',
  },
  {
    k: 'VAPID',
    d: 'Подпись сервера приложения: JWT, подписанный его ключом ECDSA P-256. По ней push-сервис знает, что сообщение послал тот же сервер, чей ключ был указан при подписке.',
  },
  {
    k: 'ECDH',
    d: 'Способ двум сторонам получить один и тот же секрет, обменявшись только открытыми ключами. Каждая берёт свой закрытый ключ и чужой открытый — и у обеих выходят одинаковые 32 байта.',
  },
  {
    k: 'HKDF',
    d: 'Функция, которая из секрета и подписей-строк делает ключи нужной длины. Одни и те же входы — одни и те же ключи; сменился хоть байт — ключи другие.',
  },
  {
    k: 'AES-128-GCM',
    d: 'Шифр, который не только прячет текст, но и проверяет его целостность: к шифротексту дописывается 16-байтная метка. Изменённый в пути байт — и расшифровка отказывает, а не выдаёт мусор.',
  },
];

export const PLAIN_PUSH =
  'Как письмо до востребования. Вы не знаете, где сейчас адресат, и не носите письма сами: вы отдаёте конверт на почту, а почта держит его, пока адресат не зайдёт. Почтальон видит адрес и пометку «срочно», но конверт запечатан — прочитать письмо может только адресат. А чтобы почта не принимала письма от кого попало на чужое имя, на конверте ваша подпись.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Service Worker',
    d: 'Скрипт сайта, который живёт отдельно от вкладок: браузер будит его на событие и снова усыпляет. Сообщение push приходит именно ему — открытой страницы в этот момент может не быть вовсе.',
    href: '/platform/network/#s5',
    hrefLabel: '«Сеть и кеширование», раздел «Service Worker»',
    tone: 'info',
  },
  {
    t: 'JWT',
    d: 'Три части через точку: заголовок, нагрузка и подпись, первые две — `base64url` от JSON. Подписывается строка «заголовок.нагрузка» байт в байт.',
    href: '/platform/authentication/#s2',
    hrefLabel: '«Аутентификация», раздел «Подпись JWT»',
    tone: 'info',
  },
  {
    t: 'Подпись ECDSA P-256',
    d: 'Закрытым ключом подписывают, открытым проверяют. Подпись — два числа по 32 байта, r и s; Web Crypto отдаёт их подряд, 64 байта.',
    href: '/platform/passkeys/#s3',
    hrefLabel: '«Passkeys и WebAuthn», раздел «Вход и подпись»',
    tone: 'info',
  },
  {
    t: 'Общий секрет без передачи секрета',
    d: 'У браузера и у сервера по паре ключей P-256. Каждый умножает свой закрытый ключ на чужой открытый и получает одну и ту же точку кривой — общий секрет. Подслушавший видит только открытые ключи и секрет из них не получит. Это ECDH; на сайте он больше нигде не разобран.',
    tone: 'info',
  },
];

// ─── Раздел 1. Три участника ───────────────────────────────────────────────────────────────

export const FLOW_CHIPS = [
  { label: 'ваш сервер: POST на endpoint', tone: 'info' as const },
  { label: 'push-сервис: FCM, autopush, Apple', tone: 'warn' as const },
  { label: 'браузер на устройстве' },
  { label: 'Service Worker: событие push', tone: 'ok' as const },
  { label: 'уведомление на экране', tone: 'ok' as const },
];

export const PLAIN_SERVICE =
  'Почему посредник обязателен. Телефон не может держать открытое соединение с каждым сайтом, на чьи уведомления подписан: батарея кончится к обеду, а ваш сервер не знает, в какой сети телефон сейчас и есть ли он в сети. Поэтому устройство держит **одно** соединение — с push-сервисом своего браузера, — а все сайты стучатся туда.';

export const PARTICIPANTS = [
  {
    k: 'ваш сервер',
    keeps: 'подписки пользователей (`endpoint`, `p256dh`, `auth`) и закрытый ключ VAPID',
    sees: 'текст сообщения — он его и пишет',
  },
  {
    k: 'push-сервис',
    keeps: 'очередь недоставленных сообщений для каждой подписки — до срока, который назвал ваш сервер',
    sees: 'адрес, служебные заголовки (срок хранения, срочность, метку замены) и размер тела. Текст — нет: тело зашифровано для браузера',
  },
  {
    k: 'браузер и Service Worker',
    keeps: 'закрытый ключ подписки и `auth`; разрешение на уведомления для origin',
    sees: 'текст — после расшифровки; показывает уведомление',
  },
];

export const SERVICE_NOTE =
  'Какой push-сервис, решает браузер пользователя, а не вы. Адрес подписки на стенде — `https://jmt17.google.com/fcm/send/…`: так подписывается сборка Chromium без ключей Google. В Chrome адрес начинается с `https://fcm.googleapis.com/`, в Firefox — с `https://updates.push.services.mozilla.com/`, в Safari — с `https://web.push.apple.com/`. Протокол у всех один (RFC 8030), поэтому серверу всё равно: он просто делает POST на тот адрес, что пришёл.';

export const VS_SOCKET_NOTE =
  'Чем это отличается от WebSocket и SSE. Сокет живёт, пока открыта вкладка, и говорит с **вашим** сервером. Push доходит, когда сайт закрыт и браузер свёрнут, но через чужой сервер, с задержкой в секунды и с телом до 4 КБ. Когда что выбирать для открытой вкладки — в теме [«Долгие соединения», раздел «Когда нужно долгое соединение»](/platform/realtime/#s1).';

// ─── Раздел 2. Подписка ────────────────────────────────────────────────────────────────────

export const CLIENT_CODE = `// Страница: подписаться и отдать подписку своему серверу.
// Звать из обработчика клика — разрешение спрашивают в ответ на действие человека.
async function subscribe(vapidPublicKey) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  if ((await Notification.requestPermission()) !== 'granted') return null;

  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,                // обещание: каждый push покажет уведомление
      applicationServerKey: vapidPublicKey, // открытый ключ VAPID вашего сервера
    }));

  await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sub),              // toJSON(): endpoint, expirationTime, keys
  });
  return sub;
}`;

/** Подписка, которую стенд получил на `POST /api/push/subscriptions`, и первая отправка `SERVER_CODE`. */
export const STAND = {
  subscription: {
    endpoint:
      'https://jmt17.google.com/fcm/send/dvpYwzobq28:APA91bGW3dlRNtTMDw87VeWXXXmaxC-wBl9bDBtmVJsAY9F5h8o2clr06G9vVky-yRBThvzXDP2MHbRc1NKB-RQea30nWBYI51WGnn3szvpgaSwOCEp0oHqbyhEjZcZ4VrCeICB0fbqe',
    expirationTime: null,
    keys: {
      p256dh: 'BGafow7umC6tF-lqHFk-9A0av2gm390Z2hRu73qhG1-Bf7lnyym2eIVyLVif8eCqd1iu3t7UKztBg_CRfZYzSZQ',
      auth: 'TjL2AmkLiB0MeV1QldK2vg',
    },
  },
  /** Ключ VAPID стенда — открытая часть, та, что ушла в `applicationServerKey`. */
  vapidPublicKey: 'BP-Jyt08R5HINTL91JsVwm2FjU9-Y6vd5l17KvZ64LdqoGIEasEd6BJI1LUDk0RkFt21viBxbIAqXIRFpBc9k3I',
  /** Заголовок, который `web-push` собрал для этой отправки (`generateRequestDetails` с теми же опциями). */
  authorization:
    'vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL2ptdDE3Lmdvb2dsZS5jb20iLCJleHAiOjE3OTA5MjY1ODAsInN1YiI6Im1haWx0bzpwdXNoQHNob3AuZXhhbXBsZSJ9.iuxZQyei0X2yFn4bqof9shiasM6IGX0pMZyDCAu1yAUcN1VBRIad3OwaSclNYYGBOg-P1Ex4G6VY60oNYEgybw, k=BP-Jyt08R5HINTL91JsVwm2FjU9-Y6vd5l17KvZ64LdqoGIEasEd6BJI1LUDk0RkFt21viBxbIAqXIRFpBc9k3I',
  /** Секунда отправки по часам стенда: `exp` в JWT — она же плюс 12 часов. */
  sentAt: 1790883380,
  location: 'https://jmt17.google.com/0:1790883380620765%5b0530cc2a35fbfc',
  /** Сообщение сквозного примера. */
  message: { title: 'Заказ 1042 собран', body: 'Курьер выедет в 14:30', url: '/orders/1042', tag: 'order-1042' },
  /** `JSON.stringify(message)` в байтах UTF-8 и длина тела, которое отправил `web-push`. */
  payloadBytes: 124,
  bodyBytes: 227,
  supportedContentEncodings: ['aes128gcm', 'aesgcm'],
};

export const SUBSCRIPTION_PRINT_CODE = `{
  "endpoint": "https://jmt17.google.com/fcm/send/dvpYwzobq28:APA91bGW3dlRNtTMDw…",
  "expirationTime": null,
  "keys": {
    "p256dh": "BGafow7umC6tF-lqHFk-9A0av2gm390Z2hRu73qhG1-Bf7lnyym2eIVyLVif8eCqd1iu3t7UKztBg_CRfZYzSZQ",
    "auth": "TjL2AmkLiB0MeV1QldK2vg"
  }
}`;

export const SUB_FIELDS = [
  { k: 'endpoint', v: '186 знаков', d: 'Адрес подписки у push-сервиса. Кто его знает, тот может слать на него запросы, — поэтому он ещё и привязан к ключу VAPID. Храните как секрет пользователя.' },
  { k: 'expirationTime', v: '`null`', d: 'Когда подписка истечёт. Почти всегда `null`: срок не известен заранее. Узнаёте вы его по ответу 404 или 410 на отправку.' },
  { k: 'keys.p256dh', v: '65 байт', d: 'Открытый ключ браузера, точка кривой P-256 в несжатом виде: байт `0x04`, затем x и y по 32 байта. Закрытая половина не покидает браузер.' },
  { k: 'keys.auth', v: '16 байт', d: 'Случайный секрет, который знают только браузер и ваш сервер. Push-сервис получает подписку без него — он видит только `endpoint`.' },
];

export const SUBSCRIBE_NOTE =
  '`applicationServerKey` — это открытый ключ VAPID вашего сервера, те же 65 байт. Браузер передаёт его push-сервису, и подписка запоминает: принимать сообщения только с подписью этим ключом. Сменили ключ на сервере — старые подписки перестанут принимать ваши сообщения, их придётся собирать заново.';

export const REFUSALS = [
  { k: 'контекст без профиля (инкогнито)', got: '`AbortError: Registration failed - permission denied` — даже с разрешением на уведомления', tone: 'err' as const },
  { k: 'без `userVisibleOnly: true`', got: '`NotAllowedError: Registration failed - permission denied`', tone: 'err' as const },
  { k: 'без `applicationServerKey`', got: '`AbortError: Registration failed - missing applicationServerKey, and manifest empty or missing`', tone: 'err' as const },
  { k: 'постоянный профиль, разрешение есть', got: 'подписка на `jmt17.google.com/fcm/send/…`', tone: 'ok' as const },
];

export const REFUSALS_NOTE =
  'Тихих подписок не бывает: Chromium отказал, когда страница не пообещала показывать каждое сообщение. А в профиле без истории, как у инкогнито, push не работает совсем — ошибка та же, «permission denied», хотя разрешение на уведомления выдано.';

// ─── Раздел 3. VAPID ───────────────────────────────────────────────────────────────────────

export const PLAIN_VAPID =
  'Как образец подписи в банке. Открывая счёт, вы оставили образец — `applicationServerKey` при подписке. Теперь любое поручение по этому счёту банк сверит с образцом, и поручение с чужой подписью не примет, даже если номер счёта, то есть `endpoint`, кто-то подсмотрел.';

export const VAPID_CODE = `const json64 = (obj) => b64url(enc.encode(JSON.stringify(obj)));

// Сервер приложения: заголовок Authorization для одного push-сервиса.
// keys — пара ECDSA P-256 (та же, чей открытый ключ ушёл в applicationServerKey).
async function vapidAuth(endpoint, subject, keys, exp) {
  const aud = new URL(endpoint).origin;               // origin push-сервиса, не ваш сайт
  const input = json64({ typ: 'JWT', alg: 'ES256' }) + '.' + json64({ aud, exp, sub: subject });
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, enc.encode(input)));
  // Web Crypto отдаёт подпись как r‖s, 64 байта, — ровно то, что ждёт JWT (ES256).
  const k = b64url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  return \`vapid t=\${input}.\${b64url(sig)}, k=\${k}\`;
}

// Push-сервис: проверяет заголовок по ключу, к которому привязана подписка.
async function checkVapid(header, endpoint, subscribedKey, now) {
  const m = /^vapid t=([\\w-]+)\\.([\\w-]+)\\.([\\w-]+), k=([\\w-]+)$/.exec(header ?? '');
  if (!m) return { status: 401, why: 'нет заголовка vapid' };
  const [, h, p, s, k] = m;
  if (k !== subscribedKey) return { status: 403, why: 'k не тот, что при подписке' };
  const pub = await crypto.subtle.importKey(
    'raw', fromB64url(k), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(s), enc.encode(h + '.' + p));
  if (!ok) return { status: 403, why: 'подпись не сходится' };
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (claims.aud !== new URL(endpoint).origin) return { status: 403, why: 'aud — чужой origin' };
  if (!(claims.exp > now && claims.exp <= now + 24 * 3600)) {
    return { status: 403, why: 'exp в прошлом или дальше суток' };
  }
  return { status: 201, why: 'принято' };
}`;

export const VAPID_HEADER_CODE = `Authorization: vapid
  t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9
   .eyJhdWQiOiJodHRwczovL2ptdDE3Lmdvb2dsZS5jb20iLCJleHAiOjE3OTA5MjY1ODAsInN1YiI6Im1haWx0bzpwdXNoQHNob3AuZXhhbXBsZSJ9
   .iuxZQyei0X2yFn4bqof9shiasM6IGX0pMZyDCAu1yAUcN1VBRIad3OwaSclNYYGBOg-P1Ex4G6VY60oNYEgybw,
  k=BP-Jyt08R5HINTL91JsVwm2FjU9-Y6vd5l17KvZ64LdqoGIEasEd6BJI1LUDk0RkFt21viBxbIAqXIRFpBc9k3I

// заголовок JWT: {"typ":"JWT","alg":"ES256"}
// нагрузка:      {"aud":"https://jmt17.google.com","exp":1790926580,"sub":"mailto:push@shop.example"}
// подпись:       64 байта, r‖s`;

export const VAPID_CLAIMS = [
  { k: 'aud', v: '`https://jmt17.google.com`', d: 'Origin **push-сервиса** из `endpoint`, а не вашего сайта. Токен для FCM не подойдёт для autopush: у каждого push-сервиса свой JWT.' },
  { k: 'exp', v: 'через 12 часов', d: 'Срок токена. RFC 8292 запрещает больше 24 часов от момента запроса; `web-push` по умолчанию ставит 12. Токен можно переиспользовать, пока не истёк.' },
  { k: 'sub', v: '`mailto:push@shop.example`', d: 'Как связаться с отправителем, если его сообщения мешают: `mailto:` или `https:`. `web-push` бросает ошибку, если тут что-то другое.' },
  { k: 'k (вне JWT)', v: '65 байт', d: 'Открытый ключ, которым проверять подпись. Push-сервис сравнивает его с ключом из подписки — так он узнаёт «тот ли это сервер».' },
];

export const VAPID_NOTE =
  'ES256 — тот же JWT, что в «Аутентификации», только подписан не общим секретом (HS256), а закрытым ключом ECDSA P-256. Проверяет его не ваш API, а push-сервис, по открытому ключу из `k`. Подпись в JWT — 64 байта r‖s; Web Crypto выдаёт её именно так, без обёртки DER, какую присылает аутентификатор в [«Passkeys и WebAuthn»](/platform/passkeys/#s3).';

export const VAPID_FACTS = [
  {
    t: 'Чужой ключ — 403',
    d: 'На стенде сообщение с подписью другого ключа FCM отклонил: `403`, «the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions». Утёкший `endpoint` без вашего закрытого ключа бесполезен.',
    tone: 'ok' as const,
  },
  {
    t: 'Без подписи — 401',
    d: 'Запрос без `Authorization` FCM отклонил: `401`, «Authorization header must be specified». Подписка, созданная с `applicationServerKey`, без VAPID не принимает ничего.',
  },
  {
    t: 'Ключ VAPID — один на сервер, надолго',
    d: 'Его открытая часть записана в каждой подписке. Потерять закрытую часть — значит переподписать всех: старые подписки примут только старый ключ. Держите его среди секретов, как ключ подписи токенов.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 4. Шифрование тела ─────────────────────────────────────────────────────────────

export const PLAIN_ECDH =
  'Как смешивание красок. У каждого своя секретная краска, а общая для всех — жёлтая. Вы смешиваете жёлтую со своей и отдаёте банку соседу, он — свою смесь вам. Каждый добавляет к чужой смеси свою секретную краску, и у обоих выходит один и тот же цвет. Тот, кто перехватил обе банки, не разделит смеси обратно и общего цвета не получит.';

export const PUSH_CODE = `const enc = new TextEncoder();

// base64url: base64 без '=' и с '-', '_' вместо '+', '/'
const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const fromB64url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// Общий секрет: свой закрытый ключ × чужой открытый. У обеих сторон выходит одно и то же.
async function ecdh(privateKey, publicBytes) {
  const pub = await crypto.subtle.importKey(
    'raw', publicBytes, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256));
}

// RFC 8291 §3.4: секрет ECDH + auth → IKM; IKM + salt → ключ AES и nonce.
async function deriveKeys(secret, auth, uaPublic, asPublic, salt) {
  const keyInfo = concat(enc.encode('WebPush: info\\0'), uaPublic, asPublic);
  const ikm = await hkdf(auth, secret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\\0'), 12);
  return { cek, nonce };
}

// Сервер: шифрует текст для подписки { p256dh, auth }.
// Пара ключей сервера — новая на каждое сообщение; salt — 16 случайных байт.
async function encryptPush(keys, text, opts = {}) {
  const uaPublic = fromB64url(keys.p256dh);
  const auth = fromB64url(keys.auth);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const as = opts.serverKeys ?? await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));

  const secret = await ecdh(as.privateKey, uaPublic);
  const { cek, nonce } = await deriveKeys(secret, auth, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 после текста — «это последняя запись»; за ним могли бы идти нули-паддинг.
  const plain = concat(enc.encode(text), [2]);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));

  // Заголовок aes128gcm: salt (16) | rs (4) | idlen (1) | keyid (65) = 86 байт.
  const header = new Uint8Array(86);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

// Браузер: расшифровывает тело своим закрытым ключом подписки и auth.
async function decryptPush(body, uaKeys, auth) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));

  const secret = await ecdh(uaKeys.privateKey, asPublic);
  const { cek, nonce } = await deriveKeys(secret, auth, uaPublic, asPublic, salt);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  // Не тот ключ или изменён хоть один байт — decrypt бросит OperationError.
  const plain = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, sealed));

  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;          // паддинг — нули с конца
  if (plain[end] !== 2) throw new Error('нет разделителя 0x02');
  return new TextDecoder().decode(plain.slice(0, end));
}`;

export const DERIVE_STEPS = [
  { k: '1. Общий секрет', d: 'Сервер делает **новую** пару ключей P-256 на каждое сообщение и считает ECDH со своим закрытым ключом и `p256dh` браузера. Браузер потом посчитает тот же секрет своим закрытым ключом и открытым ключом сервера из заголовка тела.' },
  { k: '2. Примешать `auth`', d: 'HKDF с солью `auth` и строкой `WebPush: info`, к которой приписаны оба открытых ключа. Получается IKM, 32 байта. Без `auth` его не получить, даже зная оба открытых ключа и `endpoint`.' },
  { k: '3. Ключ и nonce', d: 'Ещё два HKDF с 16 случайными байтами `salt`: ключ AES, 16 байт, и nonce, 12 байт. `salt` новый на каждое сообщение, поэтому ключи не повторяются, даже если текст тот же.' },
  { k: '4. Шифрование', d: 'AES-128-GCM над текстом с байтом `0x02` в конце. К шифротексту дописывается 16 байт метки — по ней браузер узнает, что ничего не изменено.' },
];

export const HEADER_ROWS = [
  { k: 'salt', bytes: '16', d: 'Случайные байты отправителя. Входят в вывод ключа и nonce.' },
  { k: 'rs', bytes: '4', d: 'Размер записи, число big-endian. Сообщение push — всегда одна запись; `web-push` пишет 4096 (`00 00 10 00`).' },
  { k: 'idlen', bytes: '1', d: 'Длина следующего поля: `0x41`, то есть 65.' },
  { k: 'keyid', bytes: '65', d: 'Одноразовый открытый ключ сервера, начинается с `0x04`. Из него браузер получит общий секрет.' },
  { k: 'шифротекст', bytes: 'n + 1', d: 'Текст и разделитель `0x02`, зашифрованные AES-128-GCM. Нулями после разделителя можно скрыть длину текста.' },
  { k: 'метка GCM', bytes: '16', d: 'Проверка целостности. Не сошлась — `decrypt` бросает `OperationError`.' },
];

export const SIZE_NOTE =
  'Итого к тексту прибавляется 103 байта: 86 заголовка, 1 разделитель и 16 метки. Сообщение сквозного примера — 124 байта JSON, `web-push` отправил 227. Push-сервис обязан принять тело до 4096 байт (RFC 8030), значит текста помещается не больше 3993 байт — на стенде FCM ровно 4096 принял, а 4097 отклонил с `400` «binary data passed in the request must be less than 4096 bytes». Кириллица — два байта на букву: около 2000 символов.';

export const RFC_VECTOR = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

export const RFC_NOTE =
  'Проверить такую функцию можно примером из самого стандарта. В RFC 8291 даны ключи обеих сторон, `auth`, `salt` и готовое тело на 144 байта с текстом «When I grow up, I want to be a watermelon». `encryptPush` с теми же ключами и `salt` выдаёт эти 144 байта буква в букву, а `decryptPush` читает их обратно. И тело, которое зашифровал `web-push`, `decryptPush` тоже читает.';

export const DEMO_MODES: { id: PushMode; label: string; note: string }[] = [
  {
    id: 'ok',
    label: 'Как есть',
    note: 'Сервер зашифровал текст для подписки, push-сервис передал тело без изменений, браузер расшифровал своим закрытым ключом и `auth`.',
  },
  {
    id: 'flip',
    label: 'Байт изменён в пути',
    note: 'В шифротексте изменён один байт. Расшифровка не выдаёт искажённый текст — метка GCM не сходится, и `decrypt` бросает ошибку.',
  },
  {
    id: 'auth',
    label: 'Другой auth',
    note: 'Тот, кто знает `endpoint` и `p256dh`, но не `auth`, шифрует со случайным `auth`. Браузер выводит другие ключи, и сообщение отвергается.',
  },
  {
    id: 'key',
    label: 'Другая подписка',
    note: 'Тело зашифровано для другого браузера. Ключ ECDH не тот — общий секрет не тот — расшифровать нельзя.',
  },
];

export const DEMO_DEFAULT_TEXT = JSON.stringify(STAND.message);

export const DEMO_CAPTION =
  'Ключи подписки создаются прямо в вашем браузере при открытии демо, тело шифрует и расшифровывает `PUSH_CODE` выше через Web Crypto. Заголовок тела не зашифрован: `salt` и ключ сервера видны всем, и это нормально — без закрытого ключа подписки и `auth` они бесполезны.';

// ─── Раздел 5. Доставка: TTL, Urgency, Topic ───────────────────────────────────────────────

export const SERVER_CODE = `import webpush from 'web-push';

// Ключи — один раз: npx web-push generate-vapid-keys, затем в секреты сервера.
webpush.setVapidDetails('mailto:push@shop.example', VAPID_PUBLIC, VAPID_PRIVATE);

async function notify(sub, message) {
  try {
    return await webpush.sendNotification(sub, JSON.stringify(message), {
      TTL: 3600,            // сколько push-сервис хранит сообщение, пока устройство не в сети
      urgency: 'high',      // very-low | low | normal | high
      topic: 'order-1042',  // новое сообщение с тем же Topic заменит недоставленное
    });
  } catch (e) {
    // Подписки больше нет: пользователь отписался, сбросил данные, удалил приложение.
    if (e.statusCode === 404 || e.statusCode === 410) {
      await db.subscriptions.delete(sub.endpoint);
      return null;
    }
    throw e;
  }
}`;

export const REQUEST_PRINT_CODE = `POST /fcm/send/dvpYwzobq28:APA91bGW3dlRNtTMDw… HTTP/1.1
Host: jmt17.google.com
TTL: 3600
Urgency: high
Topic: order-1042
Content-Type: application/octet-stream
Content-Encoding: aes128gcm
Content-Length: 227
Authorization: vapid t=eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9…, k=BP-Jyt08R5HINTL91JsV…

<227 байт: заголовок aes128gcm + шифротекст + метка>

HTTP/1.1 201 Created
Location: https://jmt17.google.com/0:1790883380620765%5b0530cc2a35fbfc`;

export const HEADERS_ROWS = [
  { k: 'TTL', d: 'Секунды, которые push-сервис хранит сообщение, если устройство не в сети. `0` — доставить сейчас или выбросить. Обязателен; `web-push` без опции ставит 2 419 200 — четыре недели.' },
  { k: 'Urgency', d: '`very-low`, `low`, `normal`, `high`. Подсказка для экономии батареи: устройство может попросить только срочные, пока экран выключен. По умолчанию `normal`.' },
  { k: 'Topic', d: 'Метка для замены: новое сообщение с тем же `Topic` вытесняет **недоставленное** старое. До 32 символов из алфавита base64url.' },
  { k: 'Content-Encoding', d: 'Только `aes128gcm`. Сжимать тело нельзя: по размеру сжатого текста можно угадывать содержимое.' },
];

export const OFFLINE_NOTE =
  'Браузер стенда закрыли, профиль остался на диске. Пять отправок ушли за секунду, все получили `201` — push-сервис принял их в очередь. Через 12 с браузер запустили снова, без единой открытой вкладки:';

export const OFFLINE_ROWS = [
  { k: '«Статус: собран»', how: '`Topic: order-1042`, `TTL: 3600`', got: 'не пришло — заменено следующим', tone: 'warn' as const },
  { k: '«Статус: в пути»', how: '`Topic: order-1042`, `TTL: 3600`', got: 'пришло', tone: 'ok' as const },
  { k: '«Скидка дня»', how: 'без `Topic`, `TTL: 3600`', got: 'пришло', tone: 'ok' as const },
  { k: '«Курьер у двери»', how: '`TTL: 0`', got: 'не пришло: доставить сразу было некому', tone: 'err' as const },
  { k: '«Через пять секунд устарело»', how: '`TTL: 5`', got: 'не пришло: срок вышел раньше, чем браузер вернулся', tone: 'err' as const },
];

export const OFFLINE_AFTER =
  'Service Worker проснулся сам — `clients.matchAll` не нашёл ни одной вкладки — и показал два уведомления. `201` значит «принято в очередь», а не «показано»: о том, что сообщение с `TTL: 0` пропало, сервер не узнал.';

export const RESPONSES = [
  { k: '201 Created', what: 'Принято. `Location` — адрес сообщения в очереди.', stand: 'обычная отправка', tone: 'ok' as const },
  { k: '400 Bad Request', what: 'Ошибка запроса. У FCM — и слишком большое тело: «binary data passed in the request must be less than 4096 bytes».', stand: 'тело 4097 байт', tone: 'warn' as const },
  { k: '401 Unauthorized', what: 'Нет подписи VAPID: «Authorization header must be specified».', stand: 'без `vapidDetails`', tone: 'warn' as const },
  { k: '403 Forbidden', what: 'Подпись не та или не тем ключом, что при подписке.', stand: 'чужой ключ VAPID', tone: 'warn' as const },
  { k: '404 / 410', what: 'Подписки больше нет. FCM: «push subscription has unsubscribed or expired». Удалить подписку из базы и больше не слать.', stand: '`410` после `unsubscribe()`', tone: 'err' as const },
  { k: '413 / 429', what: 'Тело больше 4096 байт (по RFC 8030) / слишком часто: подождать `Retry-After`.', stand: 'по документации', tone: undefined },
];

export const RESPONSES_NOTE =
  'RFC 8030 называет для истёкшей подписки код `404`, а FCM на стенде ответил `410 Gone`; Mozilla autopush по своей документации отвечает `410` на отписку и `404` на неверный адрес. Поэтому `notify` удаляет подписку на оба кода. Без этого база копит мёртвые подписки, и каждая рассылка тратит запрос на каждую.';

export const GONE_NOTE =
  'И одно наблюдение стенда, которого нет в стандарте. У только что созданной подписки FCM в первые секунды иногда отвечал `410` — в 4 прогонах из 11, — а следом `201`. `notify` в таком случае удалит живую подписку. Страховка уже есть в `CLIENT_CODE`: он отправляет подписку серверу при каждом вызове, и если звать `subscribe` при каждом открытии сайта, когда разрешение уже выдано, ошибочно удалённая подписка вернётся при следующем визите.';

// ─── Раздел 6. Service Worker: событие push ────────────────────────────────────────────────

export const SW_CODE = `// sw.js
self.addEventListener('push', (event) => {
  const msg = event.data?.json() ?? { title: 'Есть новости' };
  // waitUntil держит Service Worker живым, пока уведомление не показано.
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,             // тот же tag — заменить прежнее уведомление, а не добавить
      data: { url: msg.url },   // пригодится по клику
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = tabs.find((tab) => tab.url === url);
    return open ? open.focus() : clients.openWindow(url);
  })());
});`;

export const SW_FACTS = [
  {
    t: '`event.data` уже расшифрован',
    d: 'Браузер расшифровал тело до события: `text()`, `json()`, `arrayBuffer()` отдают ваш текст. Ключей подписки Service Worker не видит и не трогает.',
  },
  {
    t: 'Без `waitUntil` браузер может усыпить',
    d: 'Обработчик синхронный, а `showNotification` возвращает промис. Без `waitUntil` браузер вправе остановить Service Worker раньше, чем уведомление появится.',
    tone: 'warn' as const,
  },
  {
    t: '`tag` заменяет уведомление на экране',
    d: 'На стенде два push с `tag: order-1042` подряд оставили одно уведомление — второе. Это замена **уже показанного**; `Topic` заменяет ещё **не доставленное**. Нужны обычно оба.',
  },
  {
    t: 'Не JSON — нет уведомления',
    d: 'Строка «не JSON» в `event.data.json()` бросила `SyntaxError`, обработчик упал, и уведомления не было. Сервер получил `201` и ничего не узнал.',
    tone: 'err' as const,
  },
];

export const STAND_SW_NOTE =
  'Событие `push` можно вызвать без push-сервиса: в DevTools Chromium на вкладке Application → Service Workers есть кнопка Push, а из скрипта — команда протокола DevTools `ServiceWorker.deliverPushMessage`. Данные тогда приходят открытым текстом, шифрование и VAPID в этом пути не участвуют. Так `SW_CODE` и проверен: уведомления, `tag` и данные для клика.';

export const USER_VISIBLE_NOTE =
  '`userVisibleOnly: true` — обещание показывать уведомление на **каждый** push. На стенде три push подряд без `showNotification` прошли без последствий: Chromium ничего не добавил на экран. Но это поблажка, а не правило: по документации Chrome за систематическое нарушение показывает вместо вашего своё уведомление о том, что сайт обновился в фоне. Тихих push для синхронизации данных в вебе нет.';

// ─── Раздел 7. Где push не дойдёт ──────────────────────────────────────────────────────────

export const LIMITS = [
  {
    t: 'iOS и iPadOS — только установленное приложение',
    d: 'По документации WebKit, с iOS 16.4 push работает только у сайта, добавленного на экран «Домой», с манифестом и `display: standalone`. В обычной вкладке Safari на iPhone `PushManager` нет.',
    tone: 'warn' as const,
  },
  {
    t: 'Разрешение — один раз',
    d: 'Отказ в `requestPermission` запоминается: повторный вызов сразу вернёт `denied`, без окна. Поэтому окно спрашивают по кнопке «Сообщать о заказе», а не при загрузке страницы.',
    tone: 'warn' as const,
  },
  {
    t: 'Инкогнито и профиль без истории',
    d: 'На стенде Chromium в таком контексте подписку не выдал вовсе. Пользователь в приватном окне уведомлений не получит.',
  },
  {
    t: 'Доставка не гарантирована',
    d: 'Устройство выключено дольше `TTL`, пользователь отозвал разрешение, браузер удалили — сервер узнает об этом в лучшем случае ответом `410` на следующую отправку. Push — подсказка «зайди посмотреть», а не канал данных: важное должно быть видно и на сайте.',
    tone: 'err' as const,
  },
  {
    t: 'Подписка может смениться сама',
    d: 'Push-сервис вправе выдать новый `endpoint`. Тогда в Service Worker приходит событие `pushsubscriptionchange` (в Chromium 153 оно есть). Надёжнее не полагаться только на него: при каждом открытии сайта сверять `getSubscription()` с сервером.',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`201` — это «принято», а не «показано»',
    d: 'Push-сервис отвечает, когда положил сообщение в очередь. С `TTL: 0` при выключенном устройстве оно пропадёт молча, и сервер об этом не узнает. Подтверждение показа — только запросом из Service Worker к вашему API.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`aud` — адрес push-сервиса, а не ваш',
    d: 'JWT VAPID адресован origin из `endpoint`: `https://fcm.googleapis.com`, `https://updates.push.services.mozilla.com`. Токен, собранный один раз на «свой домен», FCM отвергнет `403`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Мёртвые подписки копятся',
    d: 'Отписка, очищенные данные сайта, удалённый браузер — подписка умирает на стороне push-сервиса, а ваша база об этом не знает. Удаляйте её по `404` и `410`, иначе каждая рассылка тратит запросы на тех, кого нет.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Push без уведомления',
    d: 'Подписаться без `userVisibleOnly: true` Chromium не дал. А push, на который Service Worker ничего не показал, — нарушение обещания: браузер вправе показать своё уведомление вместо вашего.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Сменили ключ VAPID — потеряли подписчиков',
    d: 'Каждая подписка привязана к открытому ключу из `applicationServerKey`. Новый ключ → `403` на все старые подписки. Ключ хранят как долгоживущий секрет и не генерируют при каждом деплое.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`Topic` и `tag` — разные замены',
    d: '`Topic` — заголовок запроса: push-сервис заменяет недоставленное сообщение. `tag` — опция `showNotification`: браузер заменяет уже показанное уведомление. Статус заказа без `tag` покажет пять уведомлений подряд.',
  },
  {
    n: '07',
    t: 'Тело — до 4096 байт вместе с шифрованием',
    d: 'Шифрование добавляет 103 байта, на текст остаётся 3993. FCM на 4097 ответил не `413`, как предлагает RFC, а `400`. Большие данные не шлют в push: шлют «есть новое», а Service Worker забирает данные запросом.',
  },
  {
    n: '08',
    t: 'Разрешение просят по клику',
    d: 'Окно при загрузке страницы появляется раньше, чем человек понял, зачем ему уведомления. А отказ запоминается: второй `requestPermission` вернёт `denied` без окна, и вернуть разрешение пользователь может только в настройках сайта.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Push не проверить в инкогнито',
    d: 'Chromium в контексте без профиля отвечает «permission denied» даже с выданным разрешением. Автотестам нужен постоянный профиль — или событие из DevTools, `ServiceWorker.deliverPushMessage`.',
  },
  {
    n: '10',
    t: '`410` в первые секунды после подписки',
    d: 'На стенде свежая подписка иногда получала `410` на первую отправку, а через секунду — `201`. Сервер, который удаляет по первому `410`, теряет её. Пусть страница присылает подписку при каждом визите, а тестовый push сразу после подписки не считается проверкой.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'RFC 8030 — Generic Event Delivery Using HTTP Push',
    href: 'https://www.rfc-editor.org/rfc/rfc8030',
    what: 'протокол push-сервиса: `TTL`, `Urgency`, `Topic`, 201, 404 для истёкшей подписки, 4096 байт',
  },
  {
    title: 'RFC 8291 — Message Encryption for Web Push',
    href: 'https://www.rfc-editor.org/rfc/rfc8291',
    what: 'ECDH, `auth`, вывод ключей; пример с ключами и промежуточными значениями (Appendix A) — с ним сверен `PUSH_CODE`',
  },
  {
    title: 'RFC 8188 — Encrypted Content-Encoding for HTTP',
    href: 'https://www.rfc-editor.org/rfc/rfc8188',
    what: 'формат `aes128gcm`: заголовок salt, rs, idlen, keyid; разделитель и паддинг',
  },
  {
    title: 'RFC 8292 — VAPID for Web Push',
    href: 'https://www.rfc-editor.org/rfc/rfc8292',
    what: 'JWT ES256, `aud`, `exp` не дальше 24 часов, `sub`, схема `vapid t=…, k=…`, привязка подписки к ключу',
  },
  {
    title: 'W3C Push API',
    href: 'https://www.w3.org/TR/push-api/',
    what: '`pushManager.subscribe`, `userVisibleOnly`, `applicationServerKey`, `PushSubscription`, события `push` и `pushsubscriptionchange`',
  },
  {
    title: 'WHATWG Notifications API',
    href: 'https://notifications.spec.whatwg.org/',
    what: '`requestPermission`, `showNotification`, `tag`, `notificationclick`',
  },
  {
    title: 'web-push для Node.js',
    href: 'https://github.com/web-push-libs/web-push',
    what: 'отправка, VAPID, значения по умолчанию (`TTL` четыре недели); версия 3.6.7 на стенде',
  },
  {
    title: 'Mozilla autopush — HTTP Endpoints for Notifications',
    href: 'https://autopush.readthedocs.io/en/latest/http.html',
    what: 'коды ответов push-сервиса Firefox: 404, 410, 413',
  },
  {
    title: 'WebKit — Web Push for Web Apps on iOS and iPadOS',
    href: 'https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/',
    what: 'push на iPhone и iPad только для веб-приложения на экране «Домой», с iOS 16.4',
  },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Service Worker»](/platform/network/#s5) — регистрация, жизненный цикл и обновление Service Worker. [Аутентификация, раздел «Подпись JWT»](/platform/authentication/#s2) — устройство и проверка JWT. [Passkeys и WebAuthn, раздел «Вход и подпись»](/platform/passkeys/#s3) — ECDSA P-256, DER и r‖s на `crypto.subtle`. [Долгие соединения](/platform/realtime/#s1) — WebSocket и SSE, когда вкладка открыта. [Хранилища браузера](/platform/browser-storage/) — где Service Worker держит данные между пробуждениями.';
