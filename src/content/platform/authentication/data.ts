import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FlowStep, JwtVariant } from '@/widgets/auth-lab/model/types';

/**
 * Данные темы «Аутентификация: сессии, токены, OAuth и OIDC».
 *
 * Тема написана здесь, 2026-10-01. Соседняя тема «Безопасность фронтенда» (раздел «Куки и JWT
 * для фронта») уже разбирает устройство JWT, чтение нагрузки, места хранения, пару access +
 * refresh и гонку обновления — здесь это не пересказывается, а даётся ссылкой. Эта тема идёт
 * глубже: как подпись считается и проверяется на сервере, почему токен нельзя отозвать,
 * и весь вход через OAuth 2.0 + PKCE + OpenID Connect.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63.0), 1 октября 2026. Скрипт стенда лежал
 * в каталоге scratchpad агента (`agent-auth/stand.mjs`), в репозиторий не входит.
 *
 * Два сервера на `node:http`:
 *   — сервер авторизации на `http://127.0.0.1:49811`: `/authorize` (страница согласия с кнопкой
 *     «Разрешить» → `302` на `redirect_uri` с `code` и `state`), `/token` (обмен кода: проверка
 *     одноразовости, `client_id`, `redirect_uri` и `BASE64URL(SHA256(code_verifier))` против
 *     сохранённого `code_challenge`), `/jwks`, `/.well-known/openid-configuration`. Access-токен —
 *     JWT HS256 на секрете `STAND.apiSecret` (57 байт UTF-8, не короче 256 бит, как требует
 *     RFC 7518 §3.2); id_token — JWT RS256 на свежем ключе RSA-2048, открытая часть — `STAND.jwk`;
 *   — SPA-клиент на `http://localhost:49810`: другой хост, значит и другой сайт. Кнопка «Войти»
 *     создаёт `verifier`, `state` и `nonce` через `crypto.getRandomValues` (32 байта →
 *     base64url), кладёт их в `sessionStorage` и уходит на `/authorize`; страница `/callback`
 *     сверяет `state`, меняет код на токены `fetch`-ом и проверяет `iss`, `aud`, `nonce`, `exp`
 *     у id_token.
 *
 * Chromium прошёл вход целиком; адреса, тела и ответы ниже (`STAND`) — его сетевой журнал
 * (`page.on('request'|'response')`) без правок. Снято там же:
 *   — запроса `OPTIONS` перед `POST /token` не было: тело `application/x-www-form-urlencoded`
 *     без своих заголовков — «простой» CORS-запрос;
 *   — `Referer` перехода на `/callback` — `http://127.0.0.1:49811/`, только origin: политика
 *     по умолчанию `strict-origin-when-cross-origin` срезала путь и параметры;
 *   — после входа `sessionStorage.getItem('pkce')` — `null`: клиент стёр verifier после обмена;
 *   — четыре отказа (`STAND_FAILURES`): повторный обмен того же кода, обмен перехваченного кода
 *     с чужим verifier (код перехвачен на ответе `POST /authorize` через `route.fetch`),
 *     `/callback` с чужим `state` и `/authorize` с незарегистрированным `redirect_uri`.
 *
 * Векторы: RFC 7636, приложение B (verifier → challenge) и RFC 7515, приложение A.1 (JWS HS256
 * с ключом-JWK). Курьёз, сверенный тестом: verifier из RFC 7636 — это буква в букву подпись
 * из примера RFC 7515 A.1, авторы PKCE взяли готовые 32 байта.
 *
 * Пересобирается `tests/unit/authentication.test.ts`: функции темы — против векторов RFC
 * и `node:crypto`; литералы стенда — на согласованность между собой (challenge из verifier,
 * `state` и `nonce` туда и обратно, подписи обоих токенов). Сам браузерный прогон тестом
 * не повторяется.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'аутентификация и авторизация',
    d: 'Аутентификация отвечает на вопрос «кто это?», авторизация — «что ему можно?». Вход по паролю — первое; проверка, что этот пользователь может читать этот заказ, — второе.',
  },
  {
    k: 'сессия',
    d: 'Запись на сервере: «вот этот случайный номер — это Алиса, вошла в 10:12». Браузеру достаётся только номер, обычно в куке.',
  },
  {
    k: 'токен (bearer-токен)',
    d: 'Строка, которую предъявляют вместо пароля. «Bearer» значит «предъявитель»: сервер пускает того, кто токен принёс, и не спрашивает, откуда он у него.',
  },
  {
    k: 'claim (утверждение)',
    d: 'Одно поле в нагрузке JWT: `sub` — кто, `aud` — кому предназначен, `exp` — до какого момента действует, `iss` — кто выдал.',
  },
  {
    k: 'сервер авторизации (провайдер)',
    d: 'Сервис, где пользователь вводит пароль и который выдаёт токены: Google, GitHub, Keycloak, корпоративный SSO. Ваше приложение пароля не видит.',
  },
  {
    k: 'клиент',
    d: 'В словаре OAuth — ваше приложение, которое просит токен. Не «браузер» и не «пользователь»: SPA, мобильное приложение или сервер.',
  },
  {
    k: '`redirect_uri`',
    d: 'Адрес вашего приложения, куда сервер авторизации вернёт браузер после входа. Его заранее регистрируют у провайдера.',
  },
  {
    k: '`scope`',
    d: 'Список прав, которые клиент просит: `openid profile orders:read`. Пользователь видит его на странице согласия.',
  },
];

export const PLAIN_AUTH =
  'Как гардероб и пропуск. Гардеробщик даёт номерок и держит пальто у себя: номерок без гардероба ничего не значит, а пальто можно не отдать, даже если номерок принесли. Пропуск с печатью — другое: всё написано на нём самом, охранник смотрит на печать и пускает, никуда не звоня. Но и забрать пропуск у того, кто уже вышел за ворота, он не может.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем. Повторять их здесь не нужно — достаточно помнить вывод из каждой.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кука и её атрибуты',
    d: 'Браузер сам прикладывает куку к запросам на её сайт. `HttpOnly` прячет её от JS, `Secure` — от `http:`, `SameSite` решает, уйдёт ли она с запросом, начатым на чужом сайте.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
  {
    t: 'Устройство JWT',
    d: 'Три части через точку: заголовок, нагрузка, подпись. Первые две — `base64url` от JSON, их читает кто угодно. Как разобрать нагрузку и где хранить токен на фронте — там же.',
    href: '/platform/security/#s6',
    hrefLabel: '«Безопасность фронтенда», раздел «Куки и JWT для фронта»',
    tone: 'info',
  },
  {
    t: 'XSS',
    d: 'Чужой скрипт, исполненный на вашей странице. Он видит всё, что видит ваш JS: `localStorage`, переменные, ответы `fetch`.',
    href: '/platform/security/#s4',
    hrefLabel: '«Безопасность фронтенда», раздел «XSS»',
    tone: 'info',
  },
  {
    t: 'CSRF',
    d: 'Запрос на ваш сайт, начатый с чужой страницы, — с вашими куками. Против него стоят `SameSite`, проверка `Origin` и одноразовые метки; в OAuth такая метка называется `state`.',
    href: '/platform/security/#s5',
    hrefLabel: '«Безопасность фронтенда», раздел «CSRF и кликджекинг»',
    tone: 'info',
  },
];

// ─── Раздел 1. Сессия или токен ────────────────────────────────────────────────────────────

export const SESSION_CODE = `// Вход: сервер создаёт запись и отдаёт браузеру только её номер
const sid = crypto.randomBytes(32).toString('base64url');   // 43 знака
sessions.set(sid, { user: 'alice', created: Date.now() });
res.setHeader('Set-Cookie',
  \`__Host-sid=\${sid}; HttpOnly; Secure; SameSite=Lax; Path=/\`);

// Каждый запрос: номер из куки → запись в хранилище
const s = sessions.get(cookies['__Host-sid']);
if (!s) return res.writeHead(401).end();

// Выход: запись удалена — номер больше ничего не значит
sessions.delete(cookies['__Host-sid']);`;

export const TOKEN_CODE = `// Вход: сервер подписывает утверждения и забывает о них
const token = await signJwt(
  { sub: 'alice', scope: 'orders:read', exp: now + 600 },
  SECRET,
);

// Каждый запрос: проверить подпись и срок — без хранилища
const r = await verifyJwt(req.headers.authorization.slice(7), SECRET);
if (!r.ok) return res.writeHead(401).end();

// Выход: стереть токен можно только у себя.
// Копия, которую кто-то унёс, проходит проверку до exp.`;

export const SESSION_ROWS: { k: string; session: string; token: string }[] = [
  {
    k: 'Где правда о входе',
    session: 'на сервере, в хранилище сессий',
    token: 'в самом токене; сервер помнит только ключ',
  },
  {
    k: 'Что делает сервер на каждом запросе',
    session: 'читает запись по номеру — поход в хранилище',
    token: 'считает HMAC или проверяет подпись RSA — без хранилища',
  },
  {
    k: 'Выйти, сменить права, заблокировать',
    session: '**сразу**: удалил запись — и всё',
    token: '**не раньше `exp`**, если не завести список отозванных',
  },
  {
    k: 'Размер',
    session: '43 знака: 32 случайных байта',
    token: 'access-токен стенда — 243 знака, id_token — 626',
  },
  {
    k: 'Что видит тот, кто его держит',
    session: 'случайный номер, смысла в нём нет',
    token: 'все claims: `sub`, `scope`, `exp` — открытым текстом',
  },
  {
    k: 'Кому удобно',
    session: 'один сайт и свой бэкенд',
    token: 'много сервисов, которые не делят одну базу сессий',
  },
];

export const REVOKE_NOTE =
  '**Отозвать JWT до `exp` нельзя — это не недоработка, а цена «без хранилища».** Сервер проверяет подпись и срок, и больше ему проверять нечего: о выданных токенах он не помнит. Варианты есть, но каждый возвращает состояние на сервер. **Короткий срок** — токен живёт минуты, а продлевают его отзываемым refresh-токеном. **Список отозванных** — по полю `jti` (номер токена) или по `sub` и моменту выхода; его читают на каждом запросе, то есть это та же сессия, только наоборот. **Смена ключа** — отзывает сразу все токены всех пользователей.';

// ─── Раздел 2. Подпись JWT ─────────────────────────────────────────────────────────────────

export const PLAIN_SIGNATURE =
  'Как открытка с сургучной печатью. Текст на открытке читает любой почтальон — она не в конверте. Но поменять в ней слово незаметно нельзя: печать ставится на весь текст, а печатка одна, у отправителя. Подпись не прячет содержимое, она только доказывает, что его никто не трогал.';

/**
 * Учебная реализация HS256 на Web Crypto. Напечатана в теме, исполняется демо и тестом
 * (`widgets/auth-lab/model/run.ts`) — против RFC 7515 A.1 и `node:crypto.createHmac`.
 */
export const JWT_CODE = `const enc = new TextEncoder();
const dec = new TextDecoder();

// base64url: base64 без '=' и с '-', '_' вместо '+', '/'
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}
function fromB64url(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function hmacKey(secret) {
  const raw = typeof secret === 'string' ? enc.encode(secret) : secret;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']);
}

async function signJwt(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  // Подписывают СТРОКУ «заголовок.нагрузка», а не объект
  const input = b64url(enc.encode(JSON.stringify(header))) + '.' +
                b64url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(input));
  return input + '.' + b64url(new Uint8Array(sig));
}

async function verifyJwt(token, secret, now = Date.now() / 1000) {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'не три части' };
  const [h, p, s] = parts;
  let header, payload, sig;
  try {
    header = JSON.parse(dec.decode(fromB64url(h)));
    payload = JSON.parse(dec.decode(fromB64url(p)));
    sig = fromB64url(s);
  } catch {
    return { ok: false, reason: 'не разбирается' };
  }
  // Алгоритм выбирает сервер, а не токен
  if (header.alg !== 'HS256') return { ok: false, reason: \`alg «\${header.alg}» не ждали\` };
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), sig,
    enc.encode(h + '.' + p));            // те самые байты, что пришли
  if (!valid) return { ok: false, reason: 'подпись не сходится' };
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    return { ok: false, reason: 'срок вышел' };
  }
  return { ok: true, payload };
}`;

export const SIGN_STEPS = [
  {
    k: '1. Строка для подписи',
    d: 'Заголовок и нагрузку переводят в JSON, потом в `base64url` и склеивают через точку. Подписывают **эту строку**, байт в байт. Поэтому проверка берёт части из пришедшего токена как есть и не собирает JSON заново: другой порядок полей или пробел — другая строка.',
  },
  {
    k: '2. HMAC-SHA256',
    d: 'Хеш SHA-256 от строки, перемешанной с секретом. Без секрета нельзя ни получить такие 32 байта, ни подобрать строку под чужую подпись. Подпись и есть эти 32 байта в `base64url` — 43 знака.',
  },
  {
    k: '3. Проверка',
    d: 'Сервер считает HMAC от первых двух частей своим секретом и сравнивает с третьей частью. Совпало — значит строку подписал тот, у кого есть секрет, и после этого в ней не изменилось ни одного бита. Потом — срок, издатель, получатель.',
  },
];

export const SIGN_VS_ENCRYPT =
  '**Подпись ≠ шифрование.** HS256 и RS256 — подписи: нагрузка лежит открытым текстом, а подпись лишь доказывает, что её не меняли. Чтобы спрятать содержимое, есть JWE — зашифрованный токен из пяти частей вместо трёх; на фронте его встречают редко. Практическое правило от этого не меняется: в нагрузку не кладут ничего, что нельзя показать пользователю.';

/** Тест JWS из RFC 7515, приложение A.1: ключ-JWK `k` и готовый токен. */
export const RFC7515_KEY_B64URL =
  'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow';
export const RFC7515_TOKEN =
  'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

export const RFC7515_NOTE =
  'Реализацию сверяют с примером из самого стандарта. В RFC 7515 заголовок примера записан с переводом строки внутри JSON — `{"typ":"JWT",\\r\\n "alg":"HS256"}`. Если бы проверка собирала JSON заново, переводы строки пропали бы, строка изменилась, и подпись из RFC не сошлась бы. Функция выше берёт части как пришли, и пример проходит; срок `exp` в нём — март 2011 года, поэтому `verifyJwt` с текущими часами отвечает «срок вышел», а с часами до `exp` — пропускает.';

export const JWT_LAB_CAPTION =
  'Токен — настоящий access-токен со стенда, тот, что сервер авторизации выдал в разделе про OAuth. Проверку делает `verifyJwt` выше прямо на странице, через Web Crypto. Часы проверки стоят на минуте после выдачи — иначе токен стенда давно бы истёк; в варианте «Истёк» они переведены за `exp`. Попробуйте изменить ключ хотя бы на одну букву.';

/** Время в демо: минута после выдачи токена стенда. */
const ISSUED_AT = 1790849705;
const EXPIRES_AT = 1790850305;

// ─── Раздел 3. Где держать вход в браузере ─────────────────────────────────────────────────

export const STORAGE_NOTE =
  'Подробная таблица «кука против `localStorage` против памяти» с примером одной XSS по минутам — в теме [«Безопасность фронтенда», раздел «Куки и JWT для фронта»](/platform/security/#s6). Коротко её вывод: `HttpOnly`-кука не мешает чужому скрипту **действовать** от имени пользователя, пока открыта вкладка, но не даёт **унести** токен и пользоваться им потом. Токен в `localStorage` уносится одной строкой.';

export const PLAIN_BFF =
  'Как камера хранения на вокзале. Ценную вещь — токены провайдера — вы в карманах не носите: она лежит в ячейке, на сервере вашего сайта. В кармане у вас только жетон от ячейки, и он пришит к подкладке — `HttpOnly`-кука. Украсть из кармана нечего, а камера хранения стоит в вашем же здании.';

export const ARCH_ROWS: { k: string; how: string; xss: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'BFF (backend for frontend)',
    how: 'OAuth проходит **сервер вашего сайта**: он хранит токены провайдера и ходит в API сам. Браузер получает обычную сессионную `HttpOnly`-куку — ровно то, что в разделе «Сессия или токен».',
    xss: 'Скрипт может слать запросы через ваш сервер, пока открыта вкладка. Унести токены нечего — в браузере их нет.',
    tone: 'ok',
  },
  {
    k: 'Сервер выдаёт токен браузеру',
    how: 'Сервер сайта проходит OAuth и хранит refresh-токен, а короткий access-токен отдаёт странице — в память.',
    xss: 'Access-токен уносится, но живёт минуты. Refresh остаётся на сервере.',
    tone: 'warn',
  },
  {
    k: 'Только браузер (публичный клиент)',
    how: 'SPA проходит OAuth сама: PKCE, `state`, обмен кода `fetch`-ом. Так устроен стенд этой темы.',
    xss: 'Уносится всё, что получила страница, включая refresh-токен, если он выдан. Помогают короткие сроки и одноразовый refresh.',
    tone: 'err',
  },
];

export const ARCH_NOTE =
  'Названия и порядок — из черновика IETF «OAuth 2.0 for Browser-Based Applications»: он ставит BFF первым вариантом для приложений, где ставки высоки. Причина простая: у SPA **нет места для секрета**. Всё, что есть в бандле, читает любой пользователь, поэтому SPA — «публичный клиент» без `client_secret`, и её защищают PKCE и короткие сроки, а не секрет.';

// ─── Раздел 4. OAuth 2.0: код и PKCE ───────────────────────────────────────────────────────

export const PLAIN_OAUTH =
  'Как ключ для парковщика. Вы не отдаёте парковщику свои ключи от дома и машины — вы просите у охраны отдельный ключ, который только заводит мотор и только на час. OAuth — та же охрана: приложение получает не ваш пароль, а ограниченный и временный токен, и пароль вы вводите только на странице самой охраны.';

export const OAUTH_CHIPS = [
  { label: 'SPA: verifier, state, nonce', tone: 'info' as const },
  { label: '→ /authorize + challenge' },
  { label: 'вход и согласие у провайдера', tone: 'ink' as const },
  { label: '302 → /callback?code&state' },
  { label: 'POST /token + verifier', tone: 'warn' as const },
  { label: 'access_token + id_token', tone: 'ok' as const },
];

export const WHY_CODE =
  '**Почему код, а не сразу токен.** Ответ провайдера приезжает в браузер через адрес страницы, а адрес оседает в истории, в журналах серверов и прокси, в расширениях. Поэтому в адресе едет **код** — одноразовый, короткий и бесполезный без второго шага. Токены отдаются уже в ответе на прямой `POST`, в теле, с `Cache-Control: no-store`. Старый «неявный» вариант (`response_type=token`), где токен приходил прямо в адресе, RFC 9700 говорит не использовать.';

export const PLAIN_PKCE =
  'Как квитанция в химчистке с кодовым словом. Сдавая вещь, вы называете не само слово, а его отпечаток — то, что из слова получается, но обратно в слово не превращается. Квитанцию можно подсмотреть или украсть, но вещь выдадут только тому, кто назовёт слово, чей отпечаток совпадёт с записанным.';

export const PKCE_CODE = `// 32 случайных байта → 43 знака base64url. RFC 7636 разрешает 43–128
// знаков из [A-Z a-z 0-9 - . _ ~]
function randomVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

function isValidVerifier(v) {
  return /^[A-Za-z0-9\\-._~]{43,128}$/.test(v);
}

// code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
async function pkceChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}`;

export const PKCE_NOTE =
  '`b64url` — та же функция, что в коде подписи выше. Метод `S256` — не единственный: RFC 7636 описывает и `plain`, где challenge равен verifier. Но он не защищает от того, кто видит адрес запроса, и RFC требует `S256` от любого клиента, который умеет считать SHA-256, — а Web Crypto есть в каждом современном браузере.';

/** Тестовый вектор RFC 7636, приложение B. */
export const RFC7636_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
export const RFC7636_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

export const PKCE_WHAT = [
  {
    t: 'От чего защищает PKCE',
    d: 'От **перехваченного кода**. Код едет через адрес браузера, и увидеть его может не только ваша страница: журнал прокси, вредное расширение, другое приложение на телефоне, зарегистрировавшее ту же схему адреса. Без verifier код не обменять — challenge провайдер записал до того, как код вообще появился.',
    tone: 'ok' as const,
  },
  {
    t: 'От чего — нет',
    d: 'От XSS на вашей же странице. Чужой скрипт исполняется рядом с вашим кодом, прочитает verifier из `sessionStorage` и проведёт обмен сам. PKCE защищает дорогу между провайдером и клиентом, а не самого клиента.',
    tone: 'err' as const,
  },
  {
    t: 'Обязателен ли',
    d: 'RFC 9700 (OAuth 2.0 Security Best Current Practice, 2025) требует PKCE от публичных клиентов — SPA и мобильных — и рекомендует его остальным.',
    tone: 'info' as const,
  },
];

export const PLAIN_STATE =
  'Как номер заказа в службе доставки. Курьер звонит в дверь с коробкой — вы сначала сверяете номер с тем, что записали при заказе. Коробка без вашего номера — не ваша, даже если адрес на ней верный.';

export const STATE_NOTE =
  '**`state` — защита страницы `/callback` от подброшенного ответа.** Без неё чужая страница может отправить браузер на ваш `/callback?code=…` с кодом **от своего** аккаунта: приложение послушно обменяет его, и пользователь окажется в чужой учётной записи. Всё, что он потом загрузит или сохранит, увидит владелец этой записи. `state` — случайная строка, которую клиент запомнил перед уходом к провайдеру и сверяет по возвращении: подброшенный ответ её не знает. RFC 9700 разрешает полагаться вместо неё на PKCE, если провайдер точно поддерживает PKCE, но `state` дешёв, и он же удобен, чтобы вернуть пользователя туда, откуда он пошёл входить.';

export const FLOW_CAPTION =
  'Шаги — сетевой журнал Chromium, прошедшего вход на стенде: SPA на `localhost:49810`, сервер авторизации на `127.0.0.1:49811`. Challenge и проверку verifier на последних шагах считает `pkceChallenge` прямо на странице. Свой verifier можно ввести в поле — challenge пересчитается.';

/** Литералы стенда: сетевой журнал входа и ключи. См. шапку файла. */
export const STAND = {
  app: 'http://localhost:49810',
  issuer: 'http://127.0.0.1:49811',
  clientId: 'lesson-spa',
  redirectUri: 'http://localhost:49810/callback',
  apiSecret: 'секрет-API-стенда-не-для-прода-2026',
  verifier: 'OyIXGrGTfDrn2lC09eqbFmUccvWb_I_TVSzVd6iixTI',
  authorizeUrl:
    'http://127.0.0.1:49811/authorize?response_type=code&client_id=lesson-spa&redirect_uri=http%3A%2F%2Flocalhost%3A49810%2Fcallback&scope=openid+profile+orders%3Aread&state=t5syZqaUdN3wpC365XSGvNwzf8ZGLAaLSQA6QmjmQGk&nonce=eKKVApx-K6HWs3RgCCPgo8I6LooPZzhYTezA3kDgzIo&code_challenge=zyB7FUptaYPKfp3EhkOamiJE6dNDeV4zmxVTnmVcGZ8&code_challenge_method=S256',
  callbackUrl:
    'http://localhost:49810/callback?code=roxYSJXbdER5ghOyBVmA0A&state=t5syZqaUdN3wpC365XSGvNwzf8ZGLAaLSQA6QmjmQGk',
  callbackReferer: 'http://127.0.0.1:49811/',
  tokenBody:
    'grant_type=authorization_code&code=roxYSJXbdER5ghOyBVmA0A&redirect_uri=http%3A%2F%2Flocalhost%3A49810%2Fcallback&client_id=lesson-spa&code_verifier=OyIXGrGTfDrn2lC09eqbFmUccvWb_I_TVSzVd6iixTI',
  tokenResponse: {
    access_token:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwOi8vMTI3LjAuMC4xOjQ5ODExIiwic3ViIjoiYWxpY2UiLCJhdWQiOiJvcmRlcnMtYXBpIiwic2NvcGUiOiJvcmRlcnM6cmVhZCIsImlhdCI6MTc5MDg0OTcwNSwiZXhwIjoxNzkwODUwMzA1fQ.vmDrzJsJuDHlTn26vyZ7Qxom4Ms0ClMfehItbAt7dbU',
    token_type: 'Bearer',
    expires_in: 600,
    scope: 'openid profile orders:read',
    id_token:
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImsxIn0.eyJpc3MiOiJodHRwOi8vMTI3LjAuMC4xOjQ5ODExIiwic3ViIjoiYWxpY2UiLCJhdWQiOiJsZXNzb24tc3BhIiwibm9uY2UiOiJlS0tWQXB4LUs2SFdzM1JnQ0NQZ284STZMb29QWnpoWVRlekEza0RneklvIiwiaWF0IjoxNzkwODQ5NzA1LCJleHAiOjE3OTA4NTAwMDUsIm5hbWUiOiLQkNC70LjRgdCwIn0.Yiv88l7hgkhNYL4B4xrQNrYEC1o2HC2Be7wRvvm0b_K0srNFhilahCZ_ee4MjaAWVJvAXQSh3EBeLIouOiL6F1TgLG-uQp3nleM0qX1Reul0OZH7SsHWxJnZRFMBn6ItHB9KEPFN9vZWeKks8kGANkXSq9jGd9sM6k-e9gcCLg-psevkDV8ZOE1yNozawUSk1DPSABo5IKQevKxI62fygQP0Nk4kJ6q5oKBmPUAaWSKw7HIWOXFR64N2p1f0iaiHf8K5fzCUFT7x0OupV9cdJa1emq6JAZXM-d-iosDT84_uTVcMJ2_yVLT6oXq9D6RrEqMTTNzcigZuDkto6tt6Gg',
  },
  /** Открытый ключ RS256, которым сервер авторизации стенда подписал id_token (`/jwks`). */
  jwk: {
    kty: 'RSA',
    n: 'o2xs8VWAD6aBJDDwSy0uJwu904_T3QZFxgMdCOcXcsvDkz1CabbxF4nlaAiiBe-YcMEeu_sBGuOU002dNqQhT_8wrjKA1yry0s36lE-RVJaNosPjbWNCIkAfBXa08ltoGtW7ZrH8sC9iFrDYAk9hZewYB1mjczxqVW8VjCfpNJQ8--aOZGZgvfPjAouY2m9m86ijJS_Sh-gpvEKkbQUNn-iKHeEk1pVigeGWAaOdYniUIPkNV7N7IwOV0e_YDaWUyVBPZ3OLyQhm4WgQmBQjfqLrt0cyxhcR6NOyi-aEhZf6puhHYudeTjtXFPjMBFkJbDz4SYFLid8_Umhw6yOxIw',
    e: 'AQAB',
    kid: 'k1',
    alg: 'RS256',
    use: 'sig',
  },
};

/** Challenge из запроса входа стенда — с ним демо сверяет пересчитанный на странице. */
export const STAND_CHALLENGE = new URL(STAND.authorizeUrl).searchParams.get('code_challenge') ?? '';

const query = (url: string) => [...new URL(url).searchParams];
const form = (body: string) => [...new URLSearchParams(body)];
const short = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Шаги обмена для демо. Значения — из `STAND`, ничего не набрано руками. */
export const FLOW_STEPS: FlowStep[] = [
  {
    id: 'start',
    route: 'SPA, до ухода со страницы',
    title: 'Три случайные строки',
    line: 'sessionStorage.setItem(\'pkce\', …)',
    params: [
      { k: 'verifier', v: STAND.verifier, hot: true },
      { k: 'state', v: new URL(STAND.authorizeUrl).searchParams.get('state') ?? '' },
      { k: 'nonce', v: new URL(STAND.authorizeUrl).searchParams.get('nonce') ?? '' },
    ],
    note: 'Каждая — 32 байта из `crypto.getRandomValues`, в `base64url`. Они нужны **после** возвращения от провайдера, а вкладка за это время уйдёт на другой сайт и загрузится заново. Поэтому — `sessionStorage`: он переживает уход на чужой сайт и обратно в той же вкладке, а другим вкладкам не виден.',
  },
  {
    id: 'authorize',
    route: 'браузер → сервер авторизации',
    title: 'Запрос входа',
    line: 'GET http://127.0.0.1:49811/authorize',
    params: query(STAND.authorizeUrl).map(([k, v]) => ({ k, v, hot: k === 'code_challenge' || k === 'state' || k === 'redirect_uri' })),
    note: 'Обычный переход страницы, не `fetch`. В адресе едет **challenge** — отпечаток verifier; сам verifier остался дома. `redirect_uri` провайдер сравнивает с зарегистрированным строка в строку: незнакомый адрес на стенде дал `400` и страницу ошибки, а не переход.',
  },
  {
    id: 'consent',
    route: 'пользователь ↔ сервер авторизации',
    title: 'Вход и согласие',
    line: 'POST http://127.0.0.1:49811/authorize',
    params: [
      { k: 'scope', v: 'openid profile orders:read' },
      { k: 'Set-Cookie', v: 'as_session=alice; HttpOnly; SameSite=Lax; Path=/' },
    ],
    note: 'Пароль вводят **на сайте провайдера** — ваш код его не видит. Провайдер ставит **свою** куку на своём домене: в следующий раз он узнает пользователя и не спросит пароль. Это и есть единый вход (SSO). Кука первой стороны: браузер на сайте провайдера находится на верхнем уровне, а не во фрейме.',
  },
  {
    id: 'redirect',
    route: 'сервер авторизации → браузер',
    title: 'Возврат с кодом',
    line: '302 Found',
    params: [{ k: 'Location', v: STAND.callbackUrl, hot: true }, ...query(STAND.callbackUrl).map(([k, v]) => ({ k, v, hot: true }))],
    note: 'Код на стенде — 16 случайных байт, одноразовый и короткоживущий. RFC 6749 советует срок не больше десяти минут. Браузер переходит на `/callback`, и `Referer` этого перехода — `http://127.0.0.1:49811/`: только origin, без пути и параметров.',
  },
  {
    id: 'callback',
    route: 'SPA на /callback',
    title: 'Сверить state',
    line: 'GET http://localhost:49810/callback?code=…&state=…',
    params: [
      { k: 'state из адреса', v: new URL(STAND.callbackUrl).searchParams.get('state') ?? '', hot: true },
      { k: 'state из sessionStorage', v: new URL(STAND.authorizeUrl).searchParams.get('state') ?? '', hot: true },
    ],
    note: 'Совпали — ответ на наш запрос. На стенде тот же `/callback` с чужим `state` клиент отверг, до обмена кода дело не дошло. Сразу после обмена клиент убирает код из адреса через `history.replaceState`, чтобы он не остался в истории.',
  },
  {
    id: 'token',
    route: 'SPA → сервер авторизации',
    title: 'Обмен кода',
    line: 'POST http://127.0.0.1:49811/token',
    params: form(STAND.tokenBody).map(([k, v]) => ({ k, v, hot: k === 'code_verifier' || k === 'code' })),
    note: 'Теперь verifier едет в теле прямого запроса. Провайдер считает `BASE64URL(SHA256(verifier))` и сравнивает с challenge из второго шага. `OPTIONS` перед этим запросом не было: тело `application/x-www-form-urlencoded` без своих заголовков — простой CORS-запрос.',
  },
  {
    id: 'tokens',
    route: 'сервер авторизации → SPA',
    title: 'Токены',
    line: '200 OK · Cache-Control: no-store',
    params: [
      { k: 'access_token', v: short(STAND.tokenResponse.access_token), hot: true },
      { k: 'token_type', v: STAND.tokenResponse.token_type },
      { k: 'expires_in', v: String(STAND.tokenResponse.expires_in) },
      { k: 'scope', v: STAND.tokenResponse.scope },
      { k: 'id_token', v: short(STAND.tokenResponse.id_token), hot: true },
    ],
    note: 'Access-токен — для API, его разбирает демо в разделе про подпись. id_token появился потому, что в `scope` есть `openid`: это уже OpenID Connect. Клиент проверил у него `iss`, `aud`, `nonce` и `exp` — все четыре сошлись — и стёр verifier: `sessionStorage.getItem(\'pkce\')` после входа — `null`.',
  },
];

export const STAND_FAILURES: { k: string; what: string; got: string; tone: 'ok' | 'err' }[] = [
  {
    k: 'Тот же код второй раз',
    what: 'повторный `POST /token` с верным verifier',
    got: '`400 {"error":"invalid_grant"}` — код одноразовый. RFC 6749 советует ещё и отозвать токены, выданные по этому коду: повтор — признак, что код кто-то перехватил',
    tone: 'ok',
  },
  {
    k: 'Перехваченный код',
    what: 'обмен кода из чужого входа со своим verifier',
    got: '`400 invalid_grant`: «code_verifier не сходится с code_challenge»',
    tone: 'ok',
  },
  {
    k: 'Подброшенный ответ',
    what: '`/callback?code=…&state=чужой` во вкладке, где сохранён свой `state`',
    got: 'клиент отказал до обмена: «state не совпал — ответ не на наш запрос»',
    tone: 'ok',
  },
  {
    k: 'Чужой `redirect_uri`',
    what: '`/authorize` с адресом, которого нет в регистрации клиента',
    got: '`400` и страница ошибки у провайдера. Не переход: перенаправлять на незнакомый адрес нельзя, туда уехал бы код',
    tone: 'ok',
  },
];

// ─── Раздел 5. OpenID Connect ──────────────────────────────────────────────────────────────

export const PLAIN_OIDC =
  'Как ключ-карта от гостиничного номера и паспорт. Ключ-карта открывает дверь, но на ней не написано, кто вы, — это access-токен для API. Паспорт говорит, кто вы, но дверь им не откроешь — это id_token для самого приложения. Путать их — значит совать паспорт в замок.';

export const OIDC_INTRO =
  'OAuth 2.0 — про **доступ**: «этому приложению можно читать заказы». Кто пользователь, OAuth не говорит: access-токен может быть случайной строкой, и клиенту читать его не положено. OpenID Connect — слой поверх OAuth про **личность**: клиент добавляет в `scope` слово `openid`, и вместе с access-токеном приходит **id_token** — JWT, адресованный самому клиенту.';

export const ID_TOKEN_CLAIMS = `{
  "iss": "http://127.0.0.1:49811",    // кто выдал: ровно ваш провайдер
  "sub": "alice",                     // кто вошёл: постоянный id у этого провайдера
  "aud": "lesson-spa",                // кому: ваш client_id
  "nonce": "eKKVApx-K6HWs3RgCCPgo8I6LooPZzhYTezA3kDgzIo",  // из вашего запроса
  "iat": 1790849705,                  // когда выдан
  "exp": 1790850005,                  // до какого момента верить
  "name": "Алиса"
}`;

export const ID_CHECKS: string[] = [
  '**`iss`** в точности равен адресу провайдера — из документа `/.well-known/openid-configuration`.',
  '**`aud`** содержит ваш `client_id`. Токен, выданный другому приложению того же провайдера, не ваш, даже с верной подписью.',
  '**`nonce`** равен тому, что вы положили в запрос входа. Так клиент узнаёт, что токен выдан на **этот** вход, а не подсунут из чужого.',
  '**`exp`** в будущем — в секундах, не миллисекундах.',
  '**Подпись** — открытым ключом из `jwks_uri` и алгоритмом, который вы ждёте. Если id_token пришёл прямым ответом `/token` по HTTPS, OIDC Core разрешает доверять TLS вместо проверки подписи.',
];

export const DISCOVERY_CODE = `GET /.well-known/openid-configuration

{
  "issuer": "http://127.0.0.1:49811",
  "authorization_endpoint": "http://127.0.0.1:49811/authorize",
  "token_endpoint": "http://127.0.0.1:49811/token",
  "jwks_uri": "http://127.0.0.1:49811/jwks",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"],
  "id_token_signing_alg_values_supported": ["RS256"]
}`;

export const DISCOVERY_NOTE =
  'Адреса провайдера не зашивают в код — их читают из документа обнаружения. Там же список ключей (`jwks_uri`): id_token подписан закрытым ключом RSA, а проверяют его открытым, который лежит в открытом доступе. В отличие от HS256, проверяющий не может выпустить свой токен — закрытый ключ есть только у провайдера.';

export const TOKEN_KIND_ROWS: { k: string; access: string; id: string }[] = [
  { k: 'Кому адресован', access: 'API (серверу ресурсов): `aud` — `orders-api`', id: 'клиенту: `aud` — ваш `client_id`' },
  { k: 'Что говорит', access: 'что **можно**: `scope`', id: 'кто **вошёл**: `sub`, `name`, когда и как' },
  { k: 'Формат', access: 'любой — JWT или случайная строка; клиенту читать его не положено', id: 'всегда JWT' },
  { k: 'Куда отправлять', access: 'в `Authorization: Bearer` к API', id: '**никуда**: прочитать, проверить, показать имя' },
];

export const OIDC_TAKEAWAY =
  '**Вход — это не токен, а цепочка проверок, и каждая закрывает свою дыру.** `redirect_uri` — чтобы код не уехал на чужой адрес, `state` — чтобы не приняли чужой ответ, PKCE — чтобы перехваченный код был бесполезен, `nonce` — чтобы не подсунули чужой id_token, проверка `alg` и подписи — чтобы токен не подделали. Библиотека входа делает всё это сама; задача фронтендера — знать, что она обязана это делать, и не выключать.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Алгоритм из заголовка токена',
    d: 'Заголовок пишет тот, кто прислал токен. Проверка, которая берёт оттуда `alg`, примет `"alg":"none"` без подписи вовсе или подпись HMAC, посчитанную на **открытом** ключе RSA. RFC 8725 требует, чтобы библиотека проверяла только алгоритмы, которые ей назвал сервер. В `verifyJwt` выше это одна строка — `header.alg !== \'HS256\'`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'HS256: кто проверяет, тот и выпускает',
    d: 'Секрет HMAC один и для подписи, и для проверки. Отдали его пяти сервисам, чтобы они проверяли токены, — каждый из пяти может выпустить токен на любого пользователя. Когда проверяющих много, берут RS256 или ES256: проверяют открытым ключом, выпускает один.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Секрет HS256 подбирается без сервера',
    d: 'Токен с подписью — готовая задача «найди секрет»: перебирать можно у себя, не делая ни одного запроса к вашему серверу, и никакой лимит попыток не поможет. Поэтому секрет — случайные байты не короче 256 бит (RFC 7518), а не слово `secret` из примера в документации.',
    tone: 'err',
  },
  {
    n: '04',
    t: '«Выйти» не отзывает JWT',
    d: 'Удалили токен из памяти вкладки — у вас его нет, а копия, если её унесли, проходит проверку до `exp`. Настоящий выход — запрос на сервер, который гасит refresh-токен; для access-токена остаётся только короткий срок или список отозванных.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'id_token вместо access-токена',
    d: 'id_token адресован клиенту: в `aud` — `client_id`, а не ваше API. API, который принимает его как пропуск, примет и id_token, выданный **другому** приложению того же провайдера: подпись у него настоящая. API проверяет `aud` — и это должен быть он сам.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`state` и `nonce` — не константы',
    d: 'Строка `state=xyz`, зашитая в код, проверку проходит всегда, и подброшенный ответ — тоже. Это случайные значения на **каждый** вход, сохранённые до ухода и стёртые после возвращения.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Секрет клиента в бандле — не секрет',
    d: 'Провайдер выдаёт `client_secret` серверным приложениям. Положенный в SPA, он виден всем во вкладке «Исходники». SPA регистрируют публичным клиентом без секрета и защищают PKCE; нужен секрет — нужен сервер, то есть BFF.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Verifier из RFC 7636 — подпись из RFC 7515',
    d: 'Тестовый verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` совпадает буква в букву с подписью из примера A.1 в RFC 7515: авторы взяли готовые 32 байта. Безобидно, но полезно знать, если тест PKCE вдруг «совпал» с тестом JWT.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'RFC 6749 — The OAuth 2.0 Authorization Framework',
    href: 'https://www.rfc-editor.org/rfc/rfc6749',
    what: 'роли, authorization code, `state`, одноразовость кода, `Cache-Control: no-store` у ответа `/token`',
  },
  {
    title: 'RFC 7636 — Proof Key for Code Exchange (PKCE)',
    href: 'https://www.rfc-editor.org/rfc/rfc7636',
    what: 'verifier и challenge, `S256` и `plain`, тестовый вектор в приложении B',
  },
  {
    title: 'RFC 9700 — Best Current Practice for OAuth 2.0 Security',
    href: 'https://www.rfc-editor.org/rfc/rfc9700',
    what: 'PKCE для публичных клиентов, отказ от неявного варианта, `state` и PKCE против CSRF',
  },
  {
    title: 'RFC 7519 — JSON Web Token (JWT)',
    href: 'https://www.rfc-editor.org/rfc/rfc7519',
    what: 'claims `iss`, `sub`, `aud`, `exp`, `iat`, `jti`',
  },
  {
    title: 'RFC 7515 — JSON Web Signature (JWS)',
    href: 'https://www.rfc-editor.org/rfc/rfc7515',
    what: 'строка для подписи, компактная форма, пример HS256 в приложении A.1',
  },
  {
    title: 'RFC 7518 — JSON Web Algorithms и RFC 8725 — JWT Best Current Practices',
    href: 'https://www.rfc-editor.org/rfc/rfc8725',
    what: 'длина ключа HS256, проверка только ожидаемых алгоритмов, `none`',
  },
  {
    title: 'OpenID Connect Core 1.0',
    href: 'https://openid.net/specs/openid-connect-core-1_0.html',
    what: 'id_token, `nonce`, правила проверки id_token',
  },
  {
    title: 'IETF — OAuth 2.0 for Browser-Based Applications (черновик)',
    href: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/',
    what: 'BFF, сервер, выдающий токен браузеру, и клиент только в браузере',
  },
  {
    title: 'OWASP Cheat Sheets — Session Management, OAuth 2.0',
    href: 'https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html',
    what: 'длина и случайность идентификатора сессии, атрибуты куки; там же — шпаргалка по OAuth 2.0',
  },
  {
    title: 'MDN — SubtleCrypto',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto',
    what: '`importKey`, `sign`, `verify`, `digest`; в Node 24 — тот же `crypto.subtle`',
  },
];

export const RELATED =
  'Смежное на сайте: [Безопасность фронтенда, раздел «Куки и JWT для фронта»](/platform/security/#s6) — чтение нагрузки, места хранения, пара access + refresh и гонка обновления между вкладками. [Безопасность фронтенда, раздел «CSRF и кликджекинг»](/platform/security/#s5) — `SameSite` и защита от чужих запросов. [Встроенный контент без сторонних кук, раздел «Виджет без сторонних кук»](/platform/third-party-cookies/#s6) — вход через провайдера во фрейме и FedCM. [Безопасность бэкенда, раздел «Ошибки и секреты»](/platform/backend-security/#s5) — где держать секреты сервера. [Passkeys и WebAuthn](/platform/passkeys/) — вход по паре ключей вместо пароля и почему его нельзя выманить на чужом сайте.';

// ─── Демо «Разбери JWT» ────────────────────────────────────────────────────────────────────

/** Нагрузка access-токена стенда с подменённым `scope`. */
const TAMPERED_PAYLOAD = {
  iss: 'http://127.0.0.1:49811',
  sub: 'alice',
  aud: 'orders-api',
  scope: 'orders:write',
  iat: ISSUED_AT,
  exp: EXPIRES_AT,
};

export const TAMPERED_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwOi8vMTI3LjAuMC4xOjQ5ODExIiwic3ViIjoiYWxpY2UiLCJhdWQiOiJvcmRlcnMtYXBpIiwic2NvcGUiOiJvcmRlcnM6d3JpdGUiLCJpYXQiOjE3OTA4NDk3MDUsImV4cCI6MTc5MDg1MDMwNX0.vmDrzJsJuDHlTn26vyZ7Qxom4Ms0ClMfehItbAt7dbU';

export const NONE_TOKEN =
  'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJpc3MiOiJodHRwOi8vMTI3LjAuMC4xOjQ5ODExIiwic3ViIjoiYWxpY2UiLCJhdWQiOiJvcmRlcnMtYXBpIiwic2NvcGUiOiJvcmRlcnM6d3JpdGUiLCJpYXQiOjE3OTA4NDk3MDUsImV4cCI6MTc5MDg1MDMwNX0.';

export const JWT_VARIANTS: JwtVariant[] = [
  {
    id: 'issued',
    label: 'Как выдан',
    token: STAND.tokenResponse.access_token,
    at: ISSUED_AT + 60,
    note: 'Токен в том виде, в каком его выдал сервер авторизации стенда. С верным ключом проверка проходит.',
  },
  {
    id: 'tampered',
    label: 'Правка нагрузки',
    token: TAMPERED_TOKEN,
    at: ISSUED_AT + 60,
    note: 'В нагрузке `orders:read` заменено на `orders:write`, подпись оставлена прежней. Средняя часть изменилась — строка для подписи другая, HMAC не сходится.',
  },
  {
    id: 'none',
    label: 'alg: none',
    token: NONE_TOKEN,
    at: ISSUED_AT + 60,
    note: 'Та же правка, а в заголовке написано «подписи нет», и третья часть пустая. Проверка, которая верит заголовку, такой токен примет. `verifyJwt` ждёт только `HS256` и отказывает ещё до подписи.',
  },
  {
    id: 'resigned',
    label: 'Переподписан',
    resign: TAMPERED_PAYLOAD,
    at: ISSUED_AT + 60,
    note: 'Правка нагрузки, подписанная заново `signJwt` — ключом из поля. С настоящим секретом такая подделка неотличима от настоящего токена: секрет HS256 — это право выпускать токены.',
  },
  {
    id: 'expired',
    label: 'Истёк',
    token: STAND.tokenResponse.access_token,
    at: EXPIRES_AT + 1,
    note: 'Тот же токен, но часы проверки — через секунду после `exp`. Подпись верна, а пускать нельзя.',
  },
];
