import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { PasskeyScenario } from '@/widgets/passkey-lab/model/types';

/**
 * Данные темы «Passkeys и WebAuthn: вход без пароля».
 *
 * Тема написана здесь, 2026-10-01. Соседняя «Аутентификация» разбирает сессию и токен, подпись
 * JWT HS256 и вход через OAuth/OIDC — здесь это не пересказывается: passkey заменяет пароль
 * при входе, а после проверки подписи сервер выдаёт ту же сессию или токен. Origin разобран
 * в «Безопасности фронтенда» (раздел «Origin и правило одного источника») и даётся ссылкой.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63.0), `@simplewebauthn/server` 14.0.3,
 * 1 октября 2026. Скрипты стенда лежали в каталоге scratchpad агента (`agent-passkeys/stand.mjs`,
 * `cond.mjs`, `probe.mjs`), в репозиторий не входят.
 *
 * Сервер — `node:http` на двух портах, 50400 и 50401, один процесс и одна «база». Страница —
 * `CLIENT_CODE` дословно (стенд читал тот же текст из файла и вставлял в `<script>`) плюс поле
 * `<input autocomplete="username webauthn">`. Сервер собирает параметры сам (`REG_OPTIONS`),
 * хранит выданный challenge до ответа и проверяет ответы `verifyRegistrationResponse` /
 * `verifyAuthenticationResponse` из `@simplewebauthn/server` 14.0.3. Тела запросов и ответов
 * сервера записаны в журнал — литералы `STAND` ниже взяты из него без правок.
 *
 * Аутентификатор — виртуальный, через CDP: `WebAuthn.enable`, `WebAuthn.addVirtualAuthenticator`
 * с `protocol: 'ctap2'`, `transport: 'internal'`, `hasResidentKey`, `hasUserVerification`,
 * `isUserVerified`, `automaticPresenceSimulation`, `defaultBackupEligibility: true`,
 * `defaultBackupState: true` — то есть встроенный аутентификатор с синхронизируемым ключом.
 * Второй — `transport: 'usb'`, без проверки пользователя, `defaultBackupEligibility: false`:
 * аппаратный ключ (`STAND.deviceBound`, challenge — 32 нулевых байта, его давала страница сама).
 *
 * Домены — подимена `localhost`: Chromium считает `*.localhost` безопасным контекстом и сам
 * ведёт их на 127.0.0.1. Имена `.test` с `--host-resolver-rules` не подошли: без `https` там
 * `isSecureContext === false`, и `navigator.credentials` нет вовсе (`probe.mjs`).
 *
 * Снято там же (`REFUSALS`, `CONDITIONAL_FACTS`):
 *   — `http://bank.localhost:50401` (тот же rp.id, другой порт): браузер подписал, сервер отказал
 *     по `origin`;
 *   — `http://bank-login.localhost:50401` с `rpId: 'bank.localhost'` → `SecurityError`, текст
 *     сообщения — в `REFUSALS` дословно; без `rpId` → `NotAllowedError` (ключей для этого домена нет);
 *   — `http://login.bank.localhost:50400` с `rpId: 'bank.localhost'` → подпись, `origin` поддомена;
 *   — повтор: свежий `/auth/options`, а в `/auth/verify` — тело первого входа из журнала;
 *   — `userVerification: 'required'` на ключе без проверки пользователя → `NotAllowedError`;
 *   — conditional UI (`cond-stand.mjs`): страница — `CLIENT_CODE` + `CONDITIONAL_CODE` дословно.
 *     С выключенной `setAutomaticPresenceSimulation` `offerPasskeys()` висит дольше 1,5 с; второй
 *     `get()` в это время → `OperationError: A request is already pending.`; `onPasskeyButton()`
 *     снимает висящий (`AbortError`) и входит (`verified: true`). С включённой присутствием
 *     виртуальный аутентификатор «выбирает» ключ сам, и запрос разрешается без подсказки —
 *     так настоящий браузер себя не ведёт, поэтому этот случай в тексте не показан;
 *   — `other_keys_can_be_added_here` в `clientDataJSON`: в 3 ответах из 12 за два прогона.
 *
 * Только по документации, не запускалось: что без `webauthn` в `autocomplete` подсказки нет
 * (UI автозаполнения в headless не наблюдаем), поведение настоящих облачных менеджеров ключей (что
 * они шлют `signCount` 0 и ставят BE/BS), Related Origin Requests (`/.well-known/webauthn`) —
 * кроме того, что Chromium упоминает его в тексте `SecurityError`.
 *
 * Пересобирается `tests/unit/passkeys.test.ts`: `AUTHDATA_CODE` и `VERIFY_CODE` сверяются
 * с `@simplewebauthn/server` 14.0.3 на всех ответах стенда и на испорченных копиях; `derToRaw` —
 * с `node:crypto` (`dsaEncoding: 'der'` против `'ieee-p1363'`); числа из текста (флаги, длины,
 * rpIdHash, счётчики) — с разбором тех же байтов. Сам браузерный прогон тестом не повторяется:
 * ключи стенда новые при каждом запуске, литералы — один снятый прогон.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'passkey',
    d: 'Ключ входа на сайт, сделанный по стандарту WebAuthn. Пара ключей: закрытый хранит устройство пользователя, открытый — сервер. Обычно синхронизируется между устройствами через менеджер паролей.',
  },
  {
    k: 'WebAuthn',
    d: 'Стандарт W3C: два вызова в браузере — `navigator.credentials.create` (завести ключ) и `navigator.credentials.get` (войти) — и правила, по которым сервер проверяет их ответы.',
  },
  {
    k: 'аутентификатор',
    d: 'То, что хранит закрытый ключ и ставит подпись: Touch ID или Windows Hello в самом устройстве, телефон рядом, USB-ключ. Страница с ним напрямую не говорит — только через браузер.',
  },
  {
    k: 'RP и `rp.id`',
    d: 'RP (relying party, «проверяющая сторона») — ваш сайт. `rp.id` — домен, к которому привязан ключ: `bank.localhost` на стенде. Ключ, заведённый для одного `rp.id`, для другого не существует.',
  },
  {
    k: 'challenge',
    d: 'Случайные байты, которые сервер выдаёт на каждую попытку. Пользователь подписывает именно их, поэтому старую подпись нельзя принести второй раз.',
  },
  {
    k: 'открытый и закрытый ключ',
    d: 'Пара чисел. Закрытым подписывают, открытым проверяют подпись. По открытому вычислить закрытый нельзя — поэтому открытый не секрет.',
  },
  {
    k: 'ES256',
    d: 'Алгоритм подписи: ECDSA на кривой P-256 с хешем SHA-256. В WebAuthn его обозначают числом `-7` — номером из реестра COSE.',
  },
  {
    k: 'CBOR и COSE',
    d: 'CBOR — двоичный аналог JSON: те же числа, строки, массивы и словари, но байтами. COSE — договорённость, как записать в CBOR ключ: какие номера полей значат тип, кривую и координаты.',
  },
];

export const PLAIN_PASSKEY =
  'Пароль — как слово у входа в клуб: охранник его знает, и любой, кто подслушал, войдёт. Passkey — как личная печать. У охранника хранится только образец оттиска, печать остаётся у вас в кармане. На каждый вход охранник даёт новый листок, вы ставите оттиск, он сличает с образцом. Украденный образец бесполезен: по оттиску печать не вырезать.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Origin',
    d: 'Источник страницы — три части вместе: протокол, домен и порт. `http://bank.localhost:50400` и `http://bank.localhost:50401` — разные источники, хотя домен один.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
  {
    t: 'Сессия после входа',
    d: 'Passkey заменяет пароль, а не сессию. Когда подпись проверена, сервер делает то же, что после пароля: заводит сессию и ставит куку или выдаёт токен.',
    href: '/platform/authentication/#s1',
    hrefLabel: '«Аутентификация», раздел «Сессия или токен»',
    tone: 'info',
  },
  {
    t: 'Хеш и подпись',
    d: 'SHA-256 превращает любые байты в 32 байта «отпечатка». Подпись доказывает, что данные подписал владелец ключа и что их не меняли. В JWT HS256 ключ один на двоих; здесь ключей два.',
    href: '/platform/authentication/#s2',
    hrefLabel: '«Аутентификация», раздел «Подпись JWT»',
    tone: 'info',
  },
  {
    t: 'base64url и байты',
    d: 'Ответы WebAuthn — байты. Чтобы отправить их в JSON, их пишут буквами base64url: алфавит `A–Z a–z 0–9 - _` без `=` на конце. Три байта превращаются в четыре буквы.',
    tone: 'info',
  },
];

// ─── Раздел 1. Ключ вместо пароля ──────────────────────────────────────────────────────────

export const KEY_VS_PASSWORD: { k: string; password: string; passkey: string }[] = [
  {
    k: 'что хранит сервер',
    password: 'хеш пароля — по нему пароль подбирают перебором',
    passkey: 'открытый ключ — из него закрытый не получить',
  },
  {
    k: 'что уходит по сети при входе',
    password: 'сам пароль, каждый раз',
    passkey: 'подпись под свежим challenge; повторно она не годится',
  },
  {
    k: 'поддельный сайт',
    password: 'пользователь вводит пароль сам, своими руками',
    passkey: 'браузер не даст ключ чужому домену — пользователю нечего «ввести»',
  },
  {
    k: 'один секрет на разных сайтах',
    password: 'частая привычка: утечка с одного сайта открывает другие',
    passkey: 'на каждый `rp.id` — своя пара ключей',
  },
  {
    k: 'что делает пользователь',
    password: 'помнит и набирает',
    passkey: 'прикладывает палец, смотрит в камеру или вводит PIN устройства — локально, сервер этого не видит',
  },
];

export const CEREMONY_CHIPS = [
  { label: 'сервер: challenge + параметры', tone: 'info' as const },
  { label: 'браузер: create() / get()', tone: 'ink' as const },
  { label: 'аутентификатор: ключ, подпись', tone: 'warn' as const },
  { label: 'браузер: ответ в JSON', tone: 'ink' as const },
  { label: 'сервер: проверка, сессия', tone: 'ok' as const },
];

export const CEREMONY_NOTE =
  'Регистрация и вход устроены одинаково: сервер выдаёт challenge, браузер передаёт его аутентификатору вместе с адресом страницы, ответ возвращается на сервер. Разница в том, что приходит назад. При регистрации — новый открытый ключ, его сервер запоминает. При входе — подпись, её сервер проверяет этим ключом.';

// ─── Раздел 2. Регистрация ─────────────────────────────────────────────────────────────────

/** Сценарий страницы стенда дословно. Тест проверяет, что это синтаксически целый скрипт. */
export const CLIENT_CODE = `async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

// Регистрация: сервер даёт параметры, браузер создаёт ключ, сервер проверяет ответ.
async function register() {
  const options = await post('/reg/options');
  const cred = await navigator.credentials.create({
    publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
  });
  return post('/reg/verify', cred.toJSON());
}

// Вход: свежий challenge от сервера → подпись → проверка на сервере.
async function login() {
  const options = await post('/auth/options');
  const cred = await navigator.credentials.get({
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  return post('/auth/verify', cred.toJSON());
}`;

/**
 * Журнал сервера стенда: параметры, которые он выдал, и тела, которые прислал браузер (`cred.toJSON()`),
 * без правок. `verdicts` — ответы `/reg/verify` и `/auth/verify` по порядку; `capabilities` —
 * `PublicKeyCredential.getClientCapabilities()` в Chromium 153.
 */
export const STAND = {
  "regOptions": {
    "challenge": "6BYbbYAnnKo-Q3IIGo1tiLlbytHRLhN-9CGHw5-ZM4o",
    "rp": {
      "id": "bank.localhost",
      "name": "Банк"
    },
    "user": {
      "id": "dXNlci00Mg",
      "name": "alice@bank.localhost",
      "displayName": "Алиса"
    },
    "pubKeyCredParams": [
      {
        "type": "public-key",
        "alg": -7
      },
      {
        "type": "public-key",
        "alg": -257
      }
    ],
    "authenticatorSelection": {
      "residentKey": "required",
      "userVerification": "required"
    },
    "attestation": "none",
    "timeout": 60000
  },
  "reg": {
    "authenticatorAttachment": "platform",
    "clientExtensionResults": {},
    "id": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "rawId": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "response": {
      "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f1dAAAAAQECAwQFBgcIAQIDBAUGBwgAIJjcDsYggGULJMjSpvhXCI8B-3m7MCDHQQItNYFvCQNhpQECAyYgASFYIL96uG6sp3hCLZoCouHEPgt1DRRaT-jEphBZhFMUfDqAIlggn4FLIQITYKzhW3O5XCTefXr_xEqtQMaYWQyAdbD7MDs",
      "authenticatorData": "ezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f1dAAAAAQECAwQFBgcIAQIDBAUGBwgAIJjcDsYggGULJMjSpvhXCI8B-3m7MCDHQQItNYFvCQNhpQECAyYgASFYIL96uG6sp3hCLZoCouHEPgt1DRRaT-jEphBZhFMUfDqAIlggn4FLIQITYKzhW3O5XCTefXr_xEqtQMaYWQyAdbD7MDs",
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiNkJZYmJZQW5uS28tUTNJSUdvMXRpTGxieXRIUkxoTi05Q0dIdzUtWk00byIsIm9yaWdpbiI6Imh0dHA6Ly9iYW5rLmxvY2FsaG9zdDo1MDQwMCIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
      "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEv3q4bqyneEItmgKi4cQ-C3UNFFpP6MSmEFmEUxR8OoCfgUshAhNgrOFbc7lcJN59ev_ESq1AxphZDIB1sPswOw",
      "publicKeyAlgorithm": -7,
      "transports": [
        "internal"
      ]
    },
    "type": "public-key"
  },
  "login1Options": {
    "challenge": "0yGoABqnkNgmENvUzJCE4w6ZSzzZoOdVzDFjKgmeQbo",
    "rpId": "bank.localhost",
    "userVerification": "required",
    "timeout": 60000
  },
  "login1": {
    "authenticatorAttachment": "platform",
    "clientExtensionResults": {},
    "id": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "rawId": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "response": {
      "authenticatorData": "ezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f0dAAAAAg",
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiMHlHb0FCcW5rTmdtRU52VXpKQ0U0dzZaU3p6Wm9PZFZ6REZqS2dtZVFibyIsIm9yaWdpbiI6Imh0dHA6Ly9iYW5rLmxvY2FsaG9zdDo1MDQwMCIsImNyb3NzT3JpZ2luIjpmYWxzZSwib3RoZXJfa2V5c19jYW5fYmVfYWRkZWRfaGVyZSI6ImRvIG5vdCBjb21wYXJlIGNsaWVudERhdGFKU09OIGFnYWluc3QgYSB0ZW1wbGF0ZS4gU2VlIGh0dHBzOi8vZ29vLmdsL3lhYlBleCJ9",
      "signature": "MEQCICff1VhK5eynqTZQL7WDuXizLPVoxeHt8fZ6zNBGlu4lAiAy7DCb2CU8DLLcFrHOP9Ejakxa9rchKL66bV8HUD9jcQ",
      "userHandle": "dXNlci00Mg"
    },
    "type": "public-key"
  },
  "login2Options": {
    "challenge": "ShY3ylWvGRlyYXnk4bmTOxNi52cfsKxrigBqrRRqtv4",
    "rpId": "bank.localhost",
    "userVerification": "required",
    "timeout": 60000
  },
  "login2": {
    "authenticatorAttachment": "platform",
    "clientExtensionResults": {},
    "id": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "rawId": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "response": {
      "authenticatorData": "ezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f0dAAAAAw",
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiU2hZM3lsV3ZHUmx5WVhuazRibVRPeE5pNTJjZnNLeHJpZ0JxclJScXR2NCIsIm9yaWdpbiI6Imh0dHA6Ly9iYW5rLmxvY2FsaG9zdDo1MDQwMCIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
      "signature": "MEUCIG5VOFb1IgXjD7x0J-vwW28h7xQ9FPnc0FdNzqhOLoBwAiEAn4-AH1Qjl31njFysjAzAFATfkVcZruHsjksLEbI2k2s",
      "userHandle": "dXNlci00Mg"
    },
    "type": "public-key"
  },
  "replayOptions": {
    "challenge": "JJ36YAg1aHZPL4dPXzXgwqgMx6mt5mPadgsU6Rj4kjE",
    "rpId": "bank.localhost",
    "userVerification": "required",
    "timeout": 60000
  },
  "otherPortOptions": {
    "challenge": "0qECu8TQ4_DHzOGQr3dSMJHeRQGrPg7lbXQ24bhVxJg",
    "rpId": "bank.localhost",
    "userVerification": "required",
    "timeout": 60000
  },
  "otherPort": {
    "authenticatorAttachment": "platform",
    "clientExtensionResults": {},
    "id": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "rawId": "mNwOxiCAZQskyNKm-FcIjwH7ebswIMdBAi01gW8JA2E",
    "response": {
      "authenticatorData": "ezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f0dAAAABA",
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiMHFFQ3U4VFE0X0RIek9HUXIzZFNNSkhlUlFHclBnN2xiWFEyNGJoVnhKZyIsIm9yaWdpbiI6Imh0dHA6Ly9iYW5rLmxvY2FsaG9zdDo1MDQwMSIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
      "signature": "MEQCIDQNGNZmKWRgtFnNqpPTuqKwk-VelKsjQGomJ3aTgZD5AiBPCRYDXIiyt8WgSVXmpSgBuXPqlDx9MArtngEgarlHrw",
      "userHandle": "dXNlci00Mg"
    },
    "type": "public-key"
  },
  "deviceBound": {
    "authenticatorAttachment": "cross-platform",
    "clientExtensionResults": {},
    "id": "_OSbucblD1A7ftxDJdxs07cmLrOC05cliLkbDjkntgk",
    "rawId": "_OSbucblD1A7ftxDJdxs07cmLrOC05cliLkbDjkntgk",
    "response": {
      "attestationObject": "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVikezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f1BAAAAAQAAAAAAAAAAAAAAAAAAAAAAIPzkm7nG5Q9QO37cQyXcbNO3Ji6zgtOXJYi5Gw45J7YJpQECAyYgASFYILD54A9kn7GJQxqpnHXZygn_zPiWueqrEweL0qJyCXPuIlgg596Q_KQJx2W0t5j3TMhGeZHVs-BwsQ35jtVM8hAtfmc",
      "authenticatorData": "ezn3LJppOT1BpcJiHZlR54QvKszM42DSaN17puNH3f1BAAAAAQAAAAAAAAAAAAAAAAAAAAAAIPzkm7nG5Q9QO37cQyXcbNO3Ji6zgtOXJYi5Gw45J7YJpQECAyYgASFYILD54A9kn7GJQxqpnHXZygn_zPiWueqrEweL0qJyCXPuIlgg596Q_KQJx2W0t5j3TMhGeZHVs-BwsQ35jtVM8hAtfmc",
      "clientDataJSON": "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQSIsIm9yaWdpbiI6Imh0dHA6Ly9iYW5rLmxvY2FsaG9zdDo1MDQwMCIsImNyb3NzT3JpZ2luIjpmYWxzZX0",
      "publicKey": "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEsPngD2SfsYlDGqmcddnKCf_M-Ja56qsTB4vSonIJc-7n3pD8pAnHZbS3mPdMyEZ5kdWz4HCxDfmO1UzyEC1-Zw",
      "publicKeyAlgorithm": -7,
      "transports": [
        "usb"
      ]
    },
    "type": "public-key"
  },
  "deviceBoundChallenge": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "verdicts": [
    {
      "req": "bank.localhost:50400/reg/verify",
      "res": {
        "verified": true,
        "counter": 1,
        "deviceType": "multiDevice",
        "backedUp": true
      }
    },
    {
      "req": "bank.localhost:50400/auth/verify",
      "res": {
        "verified": true,
        "newCounter": 2,
        "origin": "http://bank.localhost:50400"
      }
    },
    {
      "req": "bank.localhost:50400/auth/verify",
      "res": {
        "verified": true,
        "newCounter": 3,
        "origin": "http://bank.localhost:50400"
      }
    },
    {
      "req": "bank.localhost:50400/auth/verify",
      "res": {
        "verified": false,
        "error": "Unexpected authentication response challenge \"0yGoABqnkNgmENvUzJCE4w6ZSzzZoOdVzDFjKgmeQbo\", expected \"JJ36YAg1aHZPL4dPXzXgwqgMx6mt5mPadgsU6Rj4kjE\""
      }
    },
    {
      "req": "bank.localhost:50401/auth/verify",
      "res": {
        "verified": false,
        "error": "Unexpected authentication response origin \"http://bank.localhost:50401\", expected \"http://bank.localhost:50400\""
      }
    }
  ],
  "capabilities": {
    "conditionalCreate": true,
    "conditionalGet": true,
    "extension:appid": true,
    "extension:appidExclude": true,
    "extension:cmtgKey": false,
    "extension:credBlob": true,
    "extension:credProps": true,
    "extension:credentialProtectionPolicy": true,
    "extension:crossDeviceFallbackUrl": false,
    "extension:enforceCredentialProtectionPolicy": true,
    "extension:getCredBlob": true,
    "extension:hmacCreateSecret": true,
    "extension:largeBlob": true,
    "extension:minPinLength": true,
    "extension:payment": true,
    "extension:prf": true,
    "hybridTransport": true,
    "immediateGet": true,
    "passkeyPlatformAuthenticator": true,
    "relatedOrigins": true,
    "signalAllAcceptedCredentials": true,
    "signalCurrentUserDetails": true,
    "signalUnknownCredential": true,
    "userVerifyingPlatformAuthenticator": true
  }
};

export const RP_ID = 'bank.localhost';
export const ORIGIN = 'http://bank.localhost:50400';

/** Параметры регистрации, как их отдал сервер стенда. */
export const REG_OPTIONS_CODE = JSON.stringify(STAND.regOptions, null, 2);

export const OPTIONS_ROWS: { k: string; v: string; d: string }[] = [
  { k: 'challenge', v: '32 случайных байта', d: 'Сервер запоминает его до ответа и принимает ровно один раз.' },
  { k: 'rp.id', v: '`bank.localhost`', d: 'Домен, к которому привяжется ключ. Не указан — браузер возьмёт домен страницы.' },
  { k: 'rp.name', v: '`Банк`', d: 'Подпись для окна браузера. В проверке не участвует.' },
  { k: 'user.id', v: '`user-42` байтами', d: 'Ваш внутренний номер пользователя, до 64 байт. Вернётся при входе как `userHandle`. Не email и не имя: аутентификатор хранит его как есть.' },
  { k: 'user.name, displayName', v: 'строки', d: 'Что показать в списке ключей: «alice@bank.localhost», «Алиса».' },
  { k: 'pubKeyCredParams', v: '`-7`, `-257`', d: 'Какие алгоритмы сервер умеет проверять, по порядку предпочтения: ES256, затем RS256.' },
  { k: 'residentKey', v: '`required`', d: 'Ключ, который можно найти без имени пользователя: при входе браузер сам предложит список. Такой ключ и называют passkey.' },
  { k: 'userVerification', v: '`required`', d: 'Аутентификатор обязан проверить человека: палец, лицо, PIN. По умолчанию `preferred` — «если умеешь».' },
  { k: 'attestation', v: '`none`', d: 'Не просить доказательства модели устройства. Для обычного сайта так и надо: аттестация нужна там, где пускают только определённые ключи.' },
];

export const PLAIN_CLIENT_DATA =
  'Как конверт с почтовым штемпелем. Письмо (challenge) пишет сервер, а штемпель с названием отделения (origin) ставит почта — браузер. Страница может положить в конверт что угодно, но штемпель ей не подделать: его ставят уже после того, как конверт ушёл из её рук.';

export const CLIENT_DATA_ROWS: { k: string; v: string; d: string }[] = [
  { k: 'type', v: '`webauthn.create`', d: 'Чтобы подпись входа нельзя было выдать за регистрацию и наоборот. При входе — `webauthn.get`.' },
  { k: 'challenge', v: 'base64url', d: 'Тот, что выдал сервер. Сервер сверяет его со своим.' },
  { k: 'origin', v: '`http://bank.localhost:50400`', d: 'Источник страницы, которая вызвала `create`. Пишет браузер, страница на это поле не влияет.' },
  { k: 'crossOrigin', v: '`false`', d: '`true`, если вызов был из фрейма чужого источника.' },
];

export const PLAIN_AUTHDATA =
  'Как бланк с полями фиксированной длины: первые 32 клетки — отпечаток адреса сайта, одна клетка — галочки, четыре клетки — номер по порядку. Чтобы прочитать бланк, не нужен словарь — только знать, где какое поле начинается.';

export const AUTHDATA_LAYOUT: { at: string; len: string; k: string; d: string }[] = [
  { at: '0', len: '32', k: 'rpIdHash', d: 'SHA-256 от `rp.id`. Аутентификатор считает его сам — от того `rp.id`, который назвал браузер.' },
  { at: '32', len: '1', k: 'флаги', d: 'Биты UP, UV, BE, BS, AT, ED.' },
  { at: '33', len: '4', k: 'signCount', d: 'Счётчик подписей, big-endian. Ноль — аутентификатор его не ведёт.' },
  { at: '37', len: '16', k: 'AAGUID', d: 'Только при регистрации (флаг AT): номер модели аутентификатора.' },
  { at: '53', len: '2', k: 'длина ID', d: 'Сколько байт в номере ключа.' },
  { at: '55', len: 'n', k: 'credential ID', d: 'Номер ключа: им браузер найдёт ключ при входе.' },
  { at: '55 + n', len: 'до конца', k: 'открытый ключ', d: 'Словарь COSE в CBOR: тип, алгоритм, кривая, координаты x и y.' },
];

export const AUTHDATA_CODE = `// Байты из base64url — так их передают toJSON() и сервер.
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toB64url = (b) => btoa(String.fromCharCode(...b)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

// CBOR — двоичный JSON. Здесь только то, что встречается в ответе create:
// числа, байты, строки, массивы и словари.
function readCbor(bytes, pos = 0) {
  const major = bytes[pos] >> 5;          // старшие 3 бита — тип
  let len = bytes[pos++] & 31;            // младшие 5 — длина или само число
  if (len === 24) len = bytes[pos++];
  else if (len === 25) { len = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; }
  else if (len > 25) throw new Error('CBOR: длина ' + len + ' не поддержана');
  if (major === 0) return [len, pos];
  if (major === 1) return [-1 - len, pos];
  if (major === 2) return [bytes.slice(pos, pos + len), pos + len];
  if (major === 3) return [new TextDecoder().decode(bytes.slice(pos, pos + len)), pos + len];
  const items = [];
  for (let i = 0; i < (major === 5 ? len * 2 : len); i++) {
    let item;
    [item, pos] = readCbor(bytes, pos);
    items.push(item);
  }
  if (major === 4) return [items, pos];
  if (major === 5) return [new Map(items.flatMap((x, i) => (i % 2 ? [] : [[x, items[i + 1]]]))), pos];
  throw new Error('CBOR: тип ' + major + ' не поддержан');
}

// authenticatorData: 32 байта rpIdHash, 1 байт флагов, 4 байта счётчика,
// а после регистрации — ещё данные нового ключа.
function parseAuthData(bytes) {
  const f = bytes[32];
  const data = {
    rpIdHash: bytes.slice(0, 32),
    flags: {
      UP: (f & 0x01) > 0,   // пользователь был рядом: коснулся, нажал
      UV: (f & 0x04) > 0,   // пользователь проверен: отпечаток, лицо, PIN
      BE: (f & 0x08) > 0,   // ключ может уехать в облако на другие устройства
      BS: (f & 0x10) > 0,   // ключ уже лежит в облачной копии
      AT: (f & 0x40) > 0,   // дальше идёт новый открытый ключ
      ED: (f & 0x80) > 0,   // дальше идут расширения
    },
    signCount: new DataView(bytes.buffer, bytes.byteOffset).getUint32(33),
  };
  if (data.flags.AT) {
    data.aaguid = bytes.slice(37, 53);    // модель аутентификатора
    const idLen = (bytes[53] << 8) | bytes[54];
    data.credentialId = bytes.slice(55, 55 + idLen);
    data.publicKey = readCbor(bytes, 55 + idLen)[0];  // ключ в формате COSE
  }
  return data;
}`;

export const AUTHDATA_NOTE =
  'На стенде `authenticatorData` регистрации — 164 байта: 37 байт заголовка, 16 AAGUID, 2 длины, 32 байта номера ключа и 77 байт ключа COSE. Байт флагов — `0x5d`: UP, UV, BE, BS и AT. При входе остаются только первые 37 байт: флаги `0x1d` — те же без AT.';

export const STORED_ROWS: { k: string; v: string; d: string }[] = [
  { k: 'credential ID', v: '32 байта', d: 'По нему сервер найдёт ключ, когда придёт ответ `get`. В ответе это поле `id`.' },
  { k: 'открытый ключ', v: 'x и y на P-256', d: 'Для проверки подписи. Утечка базы его не раскрывает: проверять подписи может кто угодно, ставить — нет.' },
  { k: 'signCount', v: '`1` после регистрации', d: 'Последний виденный счётчик.' },
  { k: 'BE, BS', v: '`true`, `true`', d: 'Может ли ключ синхронизироваться и лежит ли уже в облаке. В интерфейсе: «ключ есть на всех ваших устройствах» или «только на этом».' },
  { k: 'user.id', v: '`user-42`', d: 'Чей это ключ. При входе придёт как `userHandle`.' },
];

// ─── Раздел 3. Вход ────────────────────────────────────────────────────────────────────────

export const SIGNED_CHIPS = [
  { label: 'authenticatorData: 37 байт', tone: 'warn' as const },
  { label: '+ SHA-256(clientDataJSON): 32 байта', tone: 'info' as const },
  { label: 'подпись ES256 закрытым ключом', tone: 'ink' as const },
  { label: 'сервер: проверка открытым ключом', tone: 'ok' as const },
];

export const SIGNED_NOTE =
  'Подписаны оба куска сразу: байты аутентификатора как есть и хеш того, что собрал браузер. Значит, под подписью и `rpIdHash`, и флаги, и счётчик, и challenge, и `origin`. Поменять любой байт — подпись перестанет сходиться.';

export const VERIFY_CODE = `const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Проверки, общие для регистрации и входа. Каждая — строка отчёта.
async function checkClient(clientBytes, auth, type, expected) {
  const client = JSON.parse(new TextDecoder().decode(clientBytes));
  const rpHash = await sha256(new TextEncoder().encode(expected.rpId));
  return [
    { k: 'type', got: client.type, want: type },
    { k: 'challenge', got: client.challenge, want: expected.challenge },
    { k: 'origin', got: client.origin, want: expected.origin },
    { k: 'rpIdHash', got: hex(auth.rpIdHash), want: hex(rpHash) },
    { k: 'флаг UP', got: auth.flags.UP, want: true },
    { k: 'флаг UV', got: auth.flags.UV, want: expected.requireUV ? true : auth.flags.UV },
  ];
}

// COSE-ключ ES256 → JWK, который понимает crypto.subtle.
// Номера полей COSE: 1 — тип, 3 — алгоритм, -1 — кривая, -2 и -3 — координаты.
function coseToJwk(cose) {
  if (cose.get(1) !== 2 || cose.get(3) !== -7 || cose.get(-1) !== 1) throw new Error('не ES256');
  return { kty: 'EC', crv: 'P-256', x: toB64url(cose.get(-2)), y: toB64url(cose.get(-3)) };
}

// cred — ровно то, что прислал браузер: cred.toJSON().
async function verifyRegistration(cred, expected) {
  const response = cred.response;
  const attestation = readCbor(b64url(response.attestationObject))[0];
  const auth = parseAuthData(attestation.get('authData'));
  const checks = await checkClient(b64url(response.clientDataJSON), auth, 'webauthn.create', expected);
  checks.push({ k: 'fmt', got: attestation.get('fmt'), want: 'none' });
  checks.push({ k: 'алгоритм', got: auth.publicKey.get(3), want: -7 });
  const ok = checks.every((c) => c.got === c.want);
  // Запись о ключе — всё, что сервер хранит вместо пароля.
  const credential = ok
    ? { id: cred.id, jwk: coseToJwk(auth.publicKey), signCount: auth.signCount, BE: auth.flags.BE, BS: auth.flags.BS }
    : null;
  return { ok, checks, auth, credential };
}

// ECDSA в WebAuthn — в обёртке DER, а crypto.subtle ждёт r и s подряд по 32 байта.
function derToRaw(der) {
  const raw = new Uint8Array(64);
  let pos = 2;                            // 0x30, длина последовательности
  for (const at of [0, 32]) {
    const len = der[pos + 1];             // 0x02, длина целого
    let int = der.slice(pos + 2, pos + 2 + len);
    pos += 2 + len;
    while (int.length > 32 && int[0] === 0) int = int.slice(1);   // знаковый ноль
    raw.set(int, at + 32 - int.length);   // короткое число — с нулями слева
  }
  return raw;
}

// credential — запись, которую сервер сохранил при регистрации (найдена по cred.id).
async function verifyAssertion(cred, expected, credential) {
  const response = cred.response;
  const authBytes = b64url(response.authenticatorData);
  const clientBytes = b64url(response.clientDataJSON);
  const auth = parseAuthData(authBytes);
  const checks = await checkClient(clientBytes, auth, 'webauthn.get', expected);
  // Подписаны оба куска: authenticatorData целиком и хеш clientDataJSON.
  const signed = new Uint8Array([...authBytes, ...(await sha256(clientBytes))]);
  const key = await crypto.subtle.importKey('jwk', credential.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(b64url(response.signature)), signed);
  checks.push({ k: 'подпись', got: valid, want: true });
  // Счётчик обязан расти. Оба нуля — аутентификатор его не ведёт, это норма.
  const fresh = auth.signCount > credential.signCount || (auth.signCount === 0 && credential.signCount === 0);
  checks.push({ k: 'signCount', got: auth.signCount, want: fresh ? auth.signCount : '> ' + credential.signCount });
  return { ok: checks.every((c) => c.got === c.want), checks, auth };
}`;

export const DER_NOTE =
  'ECDSA-подпись — два числа, r и s. Аутентификатор присылает их в обёртке DER: `30 45 02 20 … 02 21 00 …` — 70–72 байта, у чисел бывает лишний нулевой байт спереди или не хватает байта. `crypto.subtle.verify` ждёт ровно 64 байта: r и s подряд. Если отдать ему DER как есть, он не бросит ошибку, а вернёт `false` — и верная подпись «не сойдётся».';

export const COUNTER_NOTE =
  'На стенде счётчик шёл 1 → 2 → 3: регистрация, первый вход, второй. Сервер хранит последний и требует, чтобы новый был больше. Если меньше или равен — две копии одного ключа подписывают независимо, ключ мог быть скопирован. Оба нуля — аутентификатор счётчик не ведёт, и проверка пропускается: так ведут себя синхронизируемые passkeys, ведь копий у них по замыслу несколько.';

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

/**
 * Сценарии демо — ответы стенда как есть. `stored` — счётчик, который сервер хранил к этому
 * моменту; у «Повтора» ожидаемый challenge — свежий, выданный сервером перед повтором.
 */
export const DEMO_SCENARIOS: PasskeyScenario[] = [
  {
    id: 'reg',
    label: 'Регистрация',
    kind: 'create',
    cred: STAND.reg,
    expected: { challenge: STAND.regOptions.challenge, origin: ORIGIN, rpId: RP_ID, requireUV: true },
    note: 'Ответ `create` со стенда. В `authenticatorData` после 37 байт заголовка идёт новый ключ — флаг AT. Подписи здесь нет: при `attestation: \'none\'` сервер принимает открытый ключ на слово и проверяет только challenge, `origin`, `rpIdHash` и флаги.',
  },
  {
    id: 'login',
    label: 'Вход',
    kind: 'get',
    cred: STAND.login1,
    expected: { challenge: STAND.login1Options.challenge, origin: ORIGIN, rpId: RP_ID, requireUV: true },
    stored: 1,
    note: 'Первый вход после регистрации. Сервер хранит счётчик 1, пришёл 2. Обратите внимание на лишнее поле в `clientDataJSON`: Chromium иногда добавляет его нарочно.',
  },
  {
    id: 'port',
    label: 'Другой origin',
    kind: 'get',
    cred: STAND.otherPort,
    expected: { challenge: STAND.otherPortOptions.challenge, origin: ORIGIN, rpId: RP_ID, requireUV: true },
    stored: 3,
    note: 'Та же страница на порту 50401. `rp.id` тот же — порт в нём не участвует, — поэтому браузер ключ дал, и подпись верна. Отказывает только сравнение `origin`.',
  },
  {
    id: 'replay',
    label: 'Повтор',
    kind: 'get',
    cred: STAND.login1,
    expected: { challenge: STAND.replayOptions.challenge, origin: ORIGIN, rpId: RP_ID, requireUV: true },
    stored: 3,
    note: 'Ответ первого входа, отправленный ещё раз после двух удачных. Подпись настоящая, но под ней старый challenge и старый счётчик 2.',
  },
  {
    id: 'usb',
    label: 'Ключ без UV',
    kind: 'create',
    cred: STAND.deviceBound,
    expected: { challenge: STAND.deviceBoundChallenge, origin: ORIGIN, rpId: RP_ID, requireUV: true },
    note: 'USB-ключ без проверки пользователя, зарегистрированный с `userVerification: \'discouraged\'`. Флаги `0x41`: только UP и AT. BE и BS выключены — ключ живёт в одном устройстве.',
  },
];

export const DEMO_CAPTION =
  'Разбор байтов и все проверки считают `parseAuthData` и `verifyAssertion` выше — здесь же, в браузере, на `crypto.subtle`. У ответа входа флаги можно переключить: правится один бит в `authenticatorData`, и первой ломается подпись — флаги подписаны вместе со всем остальным.';

// ─── Раздел 4. Почему фишинг не проходит ───────────────────────────────────────────────────

export const PLAIN_RPID =
  'Как ключ от квартиры, который сам читает табличку с адресом на двери. Вас привели к двери, похожей на вашу, — ключ просто не повернётся. Ему не важно, насколько хороша подделка: он сравнивает адрес, а не внешний вид.';

export const RPID_RULES: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`rp.id` — домен страницы или его родитель',
    d: 'Страница на `login.bank.localhost` может попросить ключ для `bank.localhost`: это родительский домен. Для соседа `bank-login.localhost` — нет. Публичный суффикс вроде `com` или `github.io` тоже нельзя: тогда один ключ подошёл бы чужим сайтам.',
    tone: 'ok',
  },
  {
    t: 'Порт и протокол в `rp.id` не входят',
    d: 'Ключ, заведённый на `bank.localhost:50400`, браузер даст и странице на порту 50401. Отделить их может только сервер — сравнив `origin`.',
    tone: 'warn',
  },
  {
    t: '`origin` пишет браузер, а не страница',
    d: 'Скрипт страницы не может подставить в `clientDataJSON` чужой адрес. А подпись покрывает хеш `clientDataJSON`, так что поправить его по дороге тоже нельзя.',
    tone: 'ok',
  },
  {
    t: 'Нет `https` — нет WebAuthn',
    d: '`navigator.credentials` есть только в безопасном контексте: `https` или `localhost`. На стенде с `http://bank.test` его не было вовсе — `isSecureContext` ложь.',
  },
];

export const REFUSALS: { k: string; what: string; got: string; tone: 'ok' | 'err' | 'warn' }[] = [
  {
    k: 'Чужой домен просит ключ банка',
    what: '`http://bank-login.localhost:50401`, `get({ rpId: \'bank.localhost\' })`',
    got: '`SecurityError` сразу, до аутентификатора: «The relying party ID is not a registrable domain suffix of, nor equal to the current domain…»',
    tone: 'ok',
  },
  {
    k: 'Чужой домен просит свой ключ',
    what: 'тот же сайт, `get()` без `rpId`',
    got: '`NotAllowedError`: для `bank-login.localhost` ключей нет, а ключ банка к этому домену не относится',
    tone: 'ok',
  },
  {
    k: 'Тот же домен, другой порт',
    what: '`http://bank.localhost:50401`, обычный вход',
    got: 'браузер подписал; сервер: «Unexpected authentication response origin "http://bank.localhost:50401"»',
    tone: 'warn',
  },
  {
    k: 'Поддомен банка',
    what: '`http://login.bank.localhost:50400`, `rpId: \'bank.localhost\'`',
    got: 'подпись есть, `origin` — `http://login.bank.localhost:50400`. Пускать или нет — решает список разрешённых `origin` на сервере',
    tone: 'warn',
  },
  {
    k: 'Старый ответ ещё раз',
    what: 'тело первого входа после свежего `/auth/options`',
    got: 'сервер: «Unexpected authentication response challenge», challenge уже другой',
    tone: 'ok',
  },
];

export const PHISHING_NOTE =
  'Фишинговый прокси — страница, которая показывает настоящий сайт и пересылает всё, что ввёл человек, — ломает пароль и даже одноразовый код из SMS: человек сам вводит их не там. С passkey вводить нечего. Ключ банка браузер чужому домену не выдаст, а подпись, сделанная на домене прокси, несёт его `origin` и его `rpIdHash`, и сервер банка её отвергнет.';

export const XSS_NOTE =
  'Чего passkey не закрывает. Скрипт, выполненный на **вашем** origin, — XSS — может сам вызвать `get()`: `origin` и `rp.id` будут правильными, и если пользователь подтвердит вход, подпись выйдет настоящей. И после входа остаётся обычная кука сессии: её кража работает так же, как при пароле. Passkey защищает момент входа, а не сессию после него.';

// ─── Раздел 5. Синхронизация и автозаполнение ──────────────────────────────────────────────

export const PLAIN_SYNC =
  'Как ключ от дома, у которого есть дубликат в банковской ячейке. Флаг BE говорит «этот ключ разрешено копировать в ячейку», BS — «копия уже лежит там». Потеряли телефон — открыли ячейку с нового. Аппаратный USB-ключ — ключ без дубликатов: потеряли — заводите новый.';

export const BACKUP_ROWS: { k: string; flags: string; be: string; bs: string; d: string }[] = [
  {
    k: 'встроенный, синхронизируемый',
    flags: '`0x5d`',
    be: '1',
    bs: '1',
    d: 'Виртуальный `internal` стенда. `@simplewebauthn/server` назвал его `multiDevice`, `backedUp: true`.',
  },
  {
    k: 'аппаратный USB-ключ',
    flags: '`0x41`',
    be: '0',
    bs: '0',
    d: 'Виртуальный `usb` без проверки пользователя: ключ не покидает устройство. `singleDevice`.',
  },
  {
    k: 'синхронизируемый, ещё не скопирован',
    flags: '—',
    be: '1',
    bs: '0',
    d: 'Ключ может уехать в облако, но пока не уехал. На стенде такого не было — это случай из спецификации: BS меняется со временем, BE — никогда, он задан при создании.',
  },
];

export const BACKUP_NOTE =
  'Зачем серверу эти флаги. Если ключ единственный и без копии (BE = 0), его потеря — потеря входа; сайт честно предложит завести второй или оставит запасной способ. Если BS = 1, можно смелее убирать пароль. Флаги приходят и при входе, так что сервер видит, когда ключ доехал до облака.';

export const CONDITIONAL_CODE = `// В разметке: <input name="username" autocomplete="username webauthn">
// Запрос ставят при загрузке страницы входа, а не по кнопке.
const pending = new AbortController();

async function offerPasskeys() {
  if (!(await PublicKeyCredential.isConditionalMediationAvailable?.())) return null;
  const options = await post('/auth/options');
  const cred = await navigator.credentials.get({
    mediation: 'conditional',            // ждать, пока человек выберет ключ в подсказке
    signal: pending.signal,
    publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
  });
  return post('/auth/verify', cred.toJSON());
}

// Кнопка «Войти с ключом»: висящий запрос сначала снять, иначе новый
// получит OperationError «A request is already pending».
function onPasskeyButton() {
  pending.abort();
  return login();
}`;

export const PLAIN_CONDITIONAL =
  'Как гардеробщик, который узнаёт вас в лицо. Номерок можно не доставать: подходите — он уже протягивает пальто. Но только если вы сами подошли к стойке, а не когда проходите мимо.';

export const CONDITIONAL_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Запрос висит, пока человек не выберет ключ',
    d: 'На стенде, пока аутентификатор не подтверждал присутствие, `offerPasskeys()` оставался в ожидании дольше 1,5 с и не падал. Обычный `get()` в той же ситуации отклонился `NotAllowedError` по своему `timeout`.',
  },
  {
    t: 'Второй запрос при висящем — `OperationError`',
    d: 'Пока conditional-запрос ждёт, обычный `get()` по кнопке сразу отклоняется: «A request is already pending.» Поэтому кнопка сначала снимает висящий запрос `abort()` — тот отклоняется `AbortError`, — и только потом зовёт `login()`. Так на стенде и прошло: вход по кнопке подтвердился сервером.',
    tone: 'warn',
  },
  {
    t: '`webauthn` — последнее слово в `autocomplete`',
    d: '`autocomplete="username webauthn"`: по документации без этого слова браузер не покажет ключи в подсказке поля, и запросу нечего будет дождаться.',
    tone: 'warn',
  },
  {
    t: 'Сначала спросить, умеет ли браузер',
    d: '`PublicKeyCredential.isConditionalMediationAvailable()` в Chromium 153 стенда вернул `true`. Новый общий вопрос — `getClientCapabilities()`: он вернул 24 возможности, среди них `conditionalGet` и `passkeyPlatformAuthenticator`.',
  },
];

export const TAKEAWAY =
  '**Passkey убирает общий секрет, а с ним — и то, что можно выманить.** Сервер хранит только открытый ключ, пользователь ничего не вводит, а браузер вписывает в подписанные данные адрес страницы. Но последняя проверка всё равно серверная: `origin`, challenge, `rpIdHash`, флаги и подпись — каждое поле по отдельности, без сравнения с шаблоном.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'DER-подпись в `crypto.subtle` даёт `false`, а не ошибку',
    d: 'Аутентификатор присылает ECDSA в DER, Web Crypto ждёт 64 байта r‖s. Без перевода верная подпись молча «не сходится», и кажется, что сломан ключ или данные. Библиотеки переводят формат сами; своя проверка — нет.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`clientDataJSON` нельзя сравнивать со строкой',
    d: 'Chromium иногда дописывает поле `other_keys_can_be_added_here` — на стенде в 3 ответах из 12. Сервер, который собирает ожидаемую строку и сравнивает целиком, будет отказывать случайным пользователям. Только `JSON.parse` и сверка полей.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Порт не входит в `rp.id`',
    d: 'Ключ, заведённый на одном порту, браузер выдаст странице на другом порту того же домена — и на любом поддомене, который назовёт родительский `rp.id`. Отличить их может только сервер, по `origin`. Список разрешённых `origin` — явный, а не «всё, что кончается на мой домен».',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`userVerification` в параметрах — пожелание, а не проверка',
    d: 'Параметры уходят в браузер, а там их может переписать кто угодно. Если вход должен заменять пароль и второй фактор сразу, сервер сам требует флаг UV в ответе. По умолчанию стоит `preferred`, и ключ без UV пройдёт.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Challenge — одноразовый и серверный',
    d: 'Его хранят на сервере (в сессии, в базе) до ответа и стирают сразу после. Сгенерированный в браузере или принятый «из формы» challenge ничего не доказывает: подпись под ним можно сделать заранее.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Нулевой счётчик — не повод отказывать',
    d: 'Синхронизируемые ключи обычно шлют `signCount` 0 при каждом входе: копий несколько, общий счётчик вести негде. Правило спецификации: если оба значения нули, счётчик не проверяют. Отказ на нуле запрёт пользователей облачных менеджеров.',
  },
  {
    n: '07',
    t: '«Нет ключа» и «отменил» выглядят одинаково',
    d: 'На стенде и отсутствие ключей у домена, и отказ проверить пользователя дали `NotAllowedError` с тем же текстом. Это нарочно: иначе любая страница могла бы узнать, есть ли у человека аккаунт на другом сайте. Различать эти случаи по ошибке не выйдет.',
  },
  {
    n: '08',
    t: '`user.id` уходит в аутентификатор навсегда',
    d: 'Его не стоит делать из email или телефона: он хранится в ключе и возвращается как `userHandle`, а сменить его без нового ключа нельзя. Подходят случайные байты, привязанные к записи пользователя.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Web Authentication Level 3',
    href: 'https://www.w3.org/TR/webauthn-3/',
    what: '`create` и `get`, `clientDataJSON`, `authenticatorData` и флаги, правила `rp.id`, проверка регистрации и входа, счётчик подписей',
  },
  {
    title: 'RFC 8949 — CBOR',
    href: 'https://www.rfc-editor.org/rfc/rfc8949',
    what: 'типы и длины в первом байте — то, что читает `readCbor`',
  },
  {
    title: 'RFC 9053 — COSE: алгоритмы',
    href: 'https://www.rfc-editor.org/rfc/rfc9053',
    what: 'ES256 = `-7`, кривая P-256 = `1`, поля ключа `-1`, `-2`, `-3`',
  },
  {
    title: 'Chrome DevTools Protocol — домен WebAuthn',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/',
    what: '`addVirtualAuthenticator`, `setAutomaticPresenceSimulation`, `getCredentials` — виртуальный аутентификатор стенда',
  },
  {
    title: 'SimpleWebAuthn — @simplewebauthn/server',
    href: 'https://simplewebauthn.dev/docs/packages/server',
    what: '`verifyRegistrationResponse` и `verifyAuthenticationResponse`; версия 14.0.3 на стенде и в тесте',
  },
  {
    title: 'MDN — Web Authentication API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API',
    what: 'справочник по `PublicKeyCredential`, `toJSON`, `parseCreationOptionsFromJSON`, `getClientCapabilities`',
  },
  {
    title: 'passkeys.dev',
    href: 'https://passkeys.dev/docs/',
    what: 'руководство рабочей группы FIDO и W3C: синхронизация, BE/BS, автозаполнение, Related Origin Requests',
  },
];

export const RELATED =
  'Смежное на сайте: [Аутентификация, раздел «Сессия или токен»](/platform/authentication/#s1) — что сервер выдаёт после проверки подписи. [Аутентификация, раздел «OAuth и PKCE»](/platform/authentication/#s4) — вход через чужой сервис, где пароль (или passkey) вводят у провайдера. [Безопасность фронтенда, раздел «XSS»](/platform/security/#s4) — от чего passkey не защищает. [XS-Leaks, раздел «Один бит вместо ответа»](/platform/xs-leaks/#s1) — почему ошибки WebAuthn нарочно одинаковы. [Встроенный контент без сторонних кук, раздел «Виджет без сторонних кук»](/platform/third-party-cookies/#s6) — FedCM, браузерный вход через провайдера.';
