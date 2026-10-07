import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CertFact, StepInfo } from '@/widgets/tls-lab/model/types';

/**
 * Данные темы «TLS и сертификаты: рукопожатие, цепочка доверия, ACME».
 *
 * Тема написана здесь, 2026-10-02, по списку кандидатов для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * OpenSSL **3.6.4** (Homebrew, `openssl` из PATH), Node **24.11.0** (внутри — OpenSSL 3.5.4),
 * Chromium **153.0.8010.12** (Playwright 1.63), macOS, 2 октября 2026. Порты 4930–4939.
 *
 * Учебный УЦ собран скриптом `MAKE_CA_CODE` (он же напечатан в теме): корневой → промежуточный
 * (`pathlen:0`) → лист `shop.test` с SAN `shop.test`, `www.shop.test`, ключи EC P-256.
 * Сломанные варианты листа — тем же промежуточным: просроченный (2026-01-01…2026-04-01),
 * ещё не действующий (2099), с именем только в CN, со звёздочкой `*.shop.test`. Сертификаты
 * ниже (`CERTS`) — публичные части этого запуска; **закрытых ключей в теме нет**, тест
 * выпускает свои.
 *
 * Что снято и чем:
 *   — `NODE_VERDICTS`: сервер `tls.createServer` отдаёт лист (+ промежуточный, + корень),
 *     клиент `tls.connect({ servername, ca?, rejectUnauthorized: false })` записывает
 *     `authorized`/`authorizationError`. 5 листов × 3 набора × доверие да/нет × 5 имён = 150
 *     решений, 2026-10-02T10:03:59Z (`STAND_NOW`). Учебная `VERIFY_CODE` на тех же
 *     сертификатах в тот же момент совпала в 148 из 150; два расхождения — лист без SAN:
 *     Node по нему пускает (берёт имя из CN), учебная функция, как браузеры, — нет;
 *   — рукопожатие: `openssl s_client -tls1_3 -alpn h2,http/1.1 -trace -keylogfile` против
 *     сервера на `node:tls` → `HANDSHAKE_ROWS` (длины тел сообщений из `Length=`), метки
 *     ключей из keylog. Только с `-groups X25519` — ClientHello 242, ServerHello 118 байт;
 *   — ClientHello Chromium: `openssl s_server -trace`, Chromium заходит на `shop.test` через
 *     `--host-resolver-rules` — 1782 байта, GREASE, ECH-GREASE (тип 65037, 250 байт),
 *     `status_request`, `compress_certificate: brotli`, тот же X25519MLKEM768;
 *   — 0-RTT: `openssl s_server -early_data [-no_anti_replay]`, `s_client -sess_out`, потом
 *     дважды `-sess_in -early_data` с `POST /pay` — `ZERO_RTT_ROWS`, два прогона одинаковы;
 *   — Chromium без доверия к учебному корню: все десять вариантов (без промежуточного,
 *     просрочен, не тот хост, CN, звёздочка на два уровня…) — один и тот же
 *     `net::ERR_CERT_AUTHORITY_INVALID`. Добавить корень в хранилище Chromium без правки
 *     системы нельзя, поэтому `ERR_CERT_DATE_INVALID` и `ERR_CERT_COMMON_NAME_INVALID` в
 *     `ERROR_ROWS` — **по документации** (`net/base/net_error_list.h`);
 *   — AIA: лист с `caIssuers` на свой HTTP-сервер, сервер отдаёт только лист. Chromium
 *     запросил `GET /int.der`, Node — нет (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`);
 *   — SNI, ALPN и mTLS — `node:tls` с `SNICallback`, `ALPNProtocols`, `requestCert`.
 *
 * Пересобирается `tests/unit/tls-certificates.test.ts`: факты `CERTS` — против
 * `X509Certificate`; `VERIFY_CODE` — против `NODE_VERDICTS` и против живого `tls.connect` на
 * свежевыпущенных сертификатах (в том числе просроченный промежуточный и самоподписанный
 * лист); длины сообщений рукопожатия, ALPN, SNI, возобновление, метки keylog и mTLS —
 * запуском; `ACME_CODE` — против векторов RFC 7638 и RFC 9773.
 *
 * Только по документации (своего публичного УЦ и Let's Encrypt у стенда нет): шаги ACME
 * (RFC 8555, RFC 8737), сроки CA/B Forum (BR 6.3.2, бюллетень SC-081v3), планы Let's Encrypt
 * (блог 2025-12-02 «From 90 to 45»), конец OCSP у Let's Encrypt (2025), CRLite в Firefox,
 * CRLSets в Chrome, отказ Chrome 58 от CN, поломки старых межсетевых экранов на большом `ClientHello`, AIA-докачка как поведение Chromium вообще (снят только сам запрос), требования списка HSTS preload, отсутствие 0-RTT в `node:tls`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'TLS',
    d: 'Протокол поверх TCP, который делает из обычного соединения защищённое: шифрует байты и доказывает клиенту, что на том конце владелец имени из адреса. HTTPS — это HTTP внутри TLS.',
  },
  {
    k: 'рукопожатие',
    d: 'Служебный обмен в начале соединения: стороны договариваются о версии и шифре, вырабатывают общий ключ, сервер показывает сертификат. Данные приложения идут только после него.',
  },
  {
    k: 'сертификат X.509',
    d: 'Файл, в котором записаны имя сайта, открытый ключ, срок действия и подпись того, кто всё это заверил. Закрытый ключ к нему лежит только на сервере.',
  },
  {
    k: 'УЦ (удостоверяющий центр, CA)',
    d: 'Организация, которая подписывает сертификаты. Корневые УЦ записаны в хранилище браузера или ОС; им доверяют заранее, без проверки.',
  },
  {
    k: 'SAN',
    d: 'Subject Alternative Name — поле сертификата со списком имён, для которых он выдан: `DNS:shop.test, DNS:www.shop.test`. Имя из адреса сверяется именно с ним.',
  },
  {
    k: 'RTT',
    d: 'Round-trip time — время «туда и обратно» между клиентом и сервером. Рукопожатия считают в RTT: сколько раз нужно дождаться ответа, прежде чем отправить запрос.',
  },
  {
    k: 'SNI и ALPN',
    d: 'Два поля первого сообщения клиента. SNI — имя сайта: по нему сервер выбирает сертификат. ALPN — список протоколов (`h2`, `http/1.1`): сервер выбирает один.',
  },
  {
    k: 'ACME',
    d: 'Протокол (RFC 8555), по которому программа на вашем сервере сама получает сертификат: доказывает УЦ, что управляет доменом, и забирает подписанный сертификат. На нём работает Let’s Encrypt.',
  },
];

export const PLAIN_TLS =
  'Сертификат похож на паспорт сайта. В нём имя, фотография (открытый ключ), срок и печать того, кто выдал. Браузер не знает каждого сотрудника паспортного стола, но знает министерство — корневой УЦ. Поэтому сайт показывает не только свой паспорт, но и доверенность отделения, которое его выдало, подписанную министерством. А чтобы доказать, что паспорт не чужой, сервер прямо при встрече расписывается ключом, который есть только у владельца.';

export const PREREQ_NOTE =
  'Тема начинается с первого байта TLS. Всё, что до него и после него, разобрано в других темах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'TCP и цена круга',
    d: 'До TLS соединение открывает TCP — ещё один круг туда и обратно. Сколько кругов стоит первый запрос и как их убирают `preconnect` и QUIC.',
    href: '/platform/network/#s1',
    hrefLabel: '«Сеть и кеширование», раздел «Транспорт и RTT-бюджет»',
    tone: 'info',
  },
  {
    t: 'Подпись открытым ключом',
    d: 'Закрытым ключом подписывают, открытым проверяют; подделать подпись без закрытого ключа нельзя. На этом стоит и вход по ключу доступа, и сертификаты.',
    href: '/platform/passkeys/#s1',
    hrefLabel: '«Passkeys и WebAuthn», раздел «Ключ вместо пароля»',
    tone: 'info',
  },
  {
    t: 'Где заканчивается TLS',
    d: 'В проде TLS обычно расшифровывает не приложение, а nginx или контроллер входа Kubernetes; дальше идёт простой HTTP с заголовком `X-Forwarded-Proto`.',
    href: '/delivery/ingress/#s4',
    hrefLabel: '«Вход в кластер: Ingress и Gateway API», раздел «TLS и сертификаты»',
    tone: 'info',
  },
  {
    t: 'HTTP/2 и QUIC',
    d: 'ALPN выбирает `h2`, а HTTP/3 несёт то же рукопожатие TLS 1.3 внутри пакетов QUIC. Сами кадры и QUIC — отдельная тема.',
    href: '/platform/http2-http3/#s6',
    hrefLabel: '«HTTP/2 и HTTP/3», раздел «HTTP/3 и QUIC»',
    tone: 'info',
  },
];

// ─── Раздел 1. Рукопожатие ─────────────────────────────────────────────────────────────────

export const HANDSHAKE_LEAD =
  'Сервер на `node:tls` с сертификатом `shop.test`, клиент — `openssl s_client -tls1_3 -alpn h2,http/1.1`. Ниже всё, что они сказали друг другу до первого байта HTTP, с длинами сообщений. Две строки идут открытым текстом, всё после `ServerHello` уже зашифровано.';

export const HANDSHAKE_CHIPS = [
  { label: '→ ClientHello', tone: 'info' as const },
  { label: '← ServerHello', tone: 'info' as const },
  { label: '← EncryptedExtensions · Certificate · CertificateVerify · Finished', tone: 'warn' as const },
  { label: '→ Finished + запрос', tone: 'ok' as const },
];

export interface HandshakeRow {
  dir: '→' | '←';
  msg: string;
  bytes: number;
  what: string;
  open: boolean;
}

/** Длины — тела сообщений из `openssl s_client -trace` (`Length=`), без 4 байт заголовка. */
export const HANDSHAKE_ROWS: HandshakeRow[] = [
  {
    dir: '→',
    msg: 'ClientHello',
    bytes: 1476,
    open: true,
    what: 'Имя сайта (SNI `shop.test`), список протоколов (ALPN `h2`, `http/1.1`), версии (только TLS 1.3), шифры и **сразу открытые части ключа**: `X25519MLKEM768` (1216 байт) и запасной `x25519` (32 байта).',
  },
  {
    dir: '←',
    msg: 'ServerHello',
    bytes: 1206,
    open: true,
    what: 'Выбор сервера: шифр `TLS_AES_256_GCM_SHA384` и своя часть ключа для `X25519MLKEM768` (1120 байт). С этого момента у обоих есть общий секрет, и всё дальше шифруется.',
  },
  {
    dir: '←',
    msg: 'EncryptedExtensions',
    bytes: 11,
    open: false,
    what: 'Ответы на расширения, которые незачем показывать сети. Здесь — выбранный ALPN: `h2`.',
  },
  {
    dir: '←',
    msg: 'Certificate',
    bytes: 953,
    open: false,
    what: 'Цепочка: лист `shop.test` (486 байт DER) и промежуточный `Lesson Issuing CA R1` (453 байта). Корень не отправляется — он и так есть у клиента.',
  },
  {
    dir: '←',
    msg: 'CertificateVerify',
    bytes: 76,
    open: false,
    what: 'Подпись `ecdsa_secp256r1_sha256` под всем рукопожатием, сделанная закрытым ключом сертификата. Так сервер доказывает, что сертификат его, а не скопирован.',
  },
  {
    dir: '←',
    msg: 'Finished',
    bytes: 48,
    open: false,
    what: 'Контрольная сумма (HMAC) всех сообщений. Если кто-то по дороге поменял хоть байт в `ClientHello`, суммы не сойдутся.',
  },
  {
    dir: '→',
    msg: 'Finished',
    bytes: 48,
    open: false,
    what: 'То же от клиента. Сразу за ним в том же полёте уходит HTTP-запрос: рукопожатие стоило **один круг**.',
  },
  {
    dir: '←',
    msg: 'NewSessionTicket ×2',
    bytes: 261,
    open: false,
    what: 'Уже после рукопожатия: два билета для следующего подключения, срок жизни `7200` секунд.',
  },
];

export const PLAIN_KEYSHARE =
  'Как замок с двумя ключами, который стороны собирают по почте. Клиент в первом же письме кладёт половину замка, не дожидаясь вопросов. Сервер отвечает своей половиной — и у обоих в руках один и тот же ключ, хотя по дороге он ни разу не проезжал целиком. В TLS 1.2 сначала договаривались, какой замок брать, и только потом слали половины — на круг дольше.';

export const KEYS_NOTE =
  'Из общего секрета обе стороны выводят не один ключ, а несколько: свои для рукопожатия, свои для данных, отдельно в каждую сторону. Клиент Node или OpenSSL может записать их в файл (`SSLKEYLOGFILE`, в Node — событие `keylog`), и тогда Wireshark расшифрует запись трафика. На стенде таких строк пять: `CLIENT_HANDSHAKE_TRAFFIC_SECRET`, `SERVER_HANDSHAKE_TRAFFIC_SECRET`, `CLIENT_TRAFFIC_SECRET_0`, `SERVER_TRAFFIC_SECRET_0`, `EXPORTER_SECRET`. Файл с ними — это ключ ко всей записи, держать его на проде нельзя.';

export const PQ_NOTE =
  '**Почему ClientHello весит полтора килобайта.** `X25519MLKEM768` — гибрид обычной кривой и постквантового ML-KEM: если однажды квантовый компьютер вскроет одну половину, вторая удержит записанный сегодня трафик. Его по умолчанию предлагают OpenSSL 3.6 и Chromium 153 и выбирает сервер на Node 24. Цена — размер: с одним `x25519` тот же `ClientHello` весит 242 байта, `ServerHello` — 118. Кругов от этого не прибавилось, но первое сообщение больше не влезает в один пакет: старые межсетевые экраны, которые ждали `ClientHello` целиком, на этом ломаются.';

export interface HelloRow {
  k: string;
  openssl: string;
  chromium: string;
}

export const HELLO_ROWS: HelloRow[] = [
  { k: 'размер `ClientHello`', openssl: '1476 байт', chromium: '1782 байта' },
  { k: 'SNI', openssl: '`shop.test`', chromium: '`shop.test`' },
  { k: 'ALPN', openssl: '`h2`, `http/1.1`', chromium: '`h2`, `http/1.1`' },
  { k: 'ключи', openssl: '`X25519MLKEM768`, `x25519`', chromium: 'GREASE, `X25519MLKEM768`, `x25519`' },
  { k: 'ECH', openssl: 'нет', chromium: 'GREASE — 250 случайных байт, чтобы настоящий ECH не выделялся' },
  { k: 'OCSP-ответ (`status_request`)', openssl: 'не просит', chromium: 'просит' },
  { k: 'сжатие сертификата', openssl: 'нет', chromium: '`brotli`' },
];

export const HELLO_NOTE =
  'GREASE — заведомо несуществующие номера расширений и групп. Chromium вставляет их нарочно: сервер, который падает на незнакомом значении, сломается сразу, а не в день, когда появится настоящее новое расширение.';

export const SNI_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'SNI выбирает сертификат',
    d: 'Сервер на одном адресе держит `shop.test` и `*.shop.test`. `SNICallback` получил `shop.test` и `api.shop.test` и отдал каждому свой сертификат. Без SNI сервер не знает, какой сайт нужен клиенту, — ведь `Host` из HTTP ещё не пришёл.',
  },
  {
    t: 'Нет имени — сертификат по умолчанию',
    d: 'Подключение к `127.0.0.1` без `servername`: SNI для IP-адресов не отправляют, `SNICallback` не вызван, сервер отдал сертификат по умолчанию, и Node отказал с `ERR_TLS_CERT_ALTNAME_INVALID` — в сертификате нет такого адреса.',
    tone: 'warn',
  },
  {
    t: 'ALPN без общего протокола',
    d: 'Клиент просит `spdy/3`, сервер умеет `h2` и `http/1.1`. Сервер Node оборвал рукопожатие сигналом `no_application_protocol` (номер 120); у клиента — `ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL`. Клиент, который ALPN не прислал вовсе, получает соединение без протокола (`alpnProtocol: false`) и говорит HTTP/1.1.',
  },
  {
    t: 'Имя видно сети',
    d: 'SNI идёт в открытом `ClientHello`: шифрование не прячет, на какой сайт вы пошли. Это закрывает ECH — разобрано в [«Сеть и кеширование», раздел «Транспорт и RTT-бюджет»](/platform/network/#s1).',
  },
];

// ─── Раздел 2. Возобновление и 0-RTT ───────────────────────────────────────────────────────

export const RESUME_LEAD =
  'Билет `NewSessionTicket` — это общий секрет прошлого соединения, зашифрованный ключом сервера. Клиент предъявляет его в следующем `ClientHello`, и сервер не присылает сертификат заново: доверие перенесено из прошлого соединения. Node умеет это из коробки: `tls.connect({ session })` с билетом прошлого подключения даёт `isSessionReused() === true`.';

export const PLAIN_ZERO_RTT =
  '0-RTT — это записка, вложенная в конверт со входным билетом. Охранник читает её сразу, ещё не проверив, не копия ли это билета. Если кто-то сфотографировал конверт и подсунул его второй раз, записка «переведите 100 рублей» будет исполнена дважды.';

export const ZERO_RTT_ROWS: { k: string; on: string; off: string }[] = [
  { k: 'заход 1, без билета', on: 'обычное рукопожатие, билет сохранён', off: 'обычное рукопожатие, билет сохранён' },
  { k: 'заход 2, билет + `POST /pay` в 0-RTT', on: '`Reused`, early data **принята**', off: '`Reused`, early data **принята**' },
  { k: 'заход 3, тот же билет ещё раз', on: '`New`, early data **отклонена**: полное рукопожатие', off: '`Reused`, early data **принята**' },
  { k: 'сервер выполнил `POST /pay`', on: '**1** раз', off: '**2** раза' },
];

export const ZERO_RTT_NOTE =
  'Защита от повтора у `openssl s_server` — память о билетах **внутри одного процесса**. Десять серверов за балансировщиком друг о друге не знают, и записанный пакет можно отправить на соседний (RFC 8446, раздел 8). Поэтому в 0-RTT пускают только то, что безопасно выполнить дважды, а прокси помечает такие запросы `Early-Data: 1` — механика с `425 Too Early` разобрана в [«HTTP/2 и HTTP/3», раздел «HTTP/3 и QUIC»](/platform/http2-http3/#s6). У `node:tls` 0-RTT нет вовсе: в API нет ни отправки, ни приёма early data.';

// ─── Раздел 3. Цепочка доверия ─────────────────────────────────────────────────────────────

/**
 * Скрипт учебного УЦ. Тест исполняет именно его (`bash`, `openssl` из PATH) — и выпускает
 * свои ключи. ⚠️ `\\n` — чтобы в строке остался `\n` для `printf`.
 */
export const MAKE_CA_CODE = `set -euo pipefail
# Расширения: УЦ и лист
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\\nkeyUsage=critical,keyCertSign,cRLSign\\nsubjectKeyIdentifier=hash\\nauthorityKeyIdentifier=keyid\\n' > ca.ext
printf 'basicConstraints=critical,CA:FALSE\\nkeyUsage=critical,digitalSignature\\nextendedKeyUsage=serverAuth\\nsubjectKeyIdentifier=hash\\nauthorityKeyIdentifier=keyid\\n' > leaf.ext
EC="-newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc"

# 1. Корневой УЦ: самоподписанный, живёт годами, ключ хранят офлайн
openssl req -x509 $EC -keyout root.key -out root.pem -days 3650 \\
  -subj "/O=Lesson/CN=Lesson Root CA" \\
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2. Промежуточный УЦ: подписан корнем, им подписывают сайты
openssl req -new $EC -keyout int.key -out int.csr -subj "/O=Lesson/CN=Lesson Issuing CA R1"
openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -days 1825 -extfile ca.ext -out int.pem

# 3. Лист для shop.test: имена — в SAN, CSR их просит, УЦ копирует
openssl req -new $EC -keyout shop.key -out shop.csr -subj "/CN=shop.test" \\
  -addext "subjectAltName=DNS:shop.test,DNS:www.shop.test"
openssl x509 -req -in shop.csr -CA int.pem -CAkey int.key -days 90 \\
  -copy_extensions copy -extfile leaf.ext -out shop.pem`;

/** `openssl x509 -in shop.pem -noout -text -certopt no_pubkey,no_sigdump,no_version`. */
export const CERT_TEXT = `Certificate:
    Data:
        Serial Number:
            6b:84:b7:2f:b2:03:37:a9:8c:8a:38:48:98:ea:fb:04:eb:25:4b:08
        Signature Algorithm: ecdsa-with-SHA256
        Issuer: O=Lesson, CN=Lesson Issuing CA R1
        Validity
            Not Before: Oct  2 09:57:15 2026 GMT
            Not After : Dec 31 09:57:15 2026 GMT
        Subject: CN=shop.test
        X509v3 extensions:
            X509v3 Subject Alternative Name:
                DNS:shop.test, DNS:www.shop.test
            X509v3 Basic Constraints: critical
                CA:FALSE
            X509v3 Key Usage: critical
                Digital Signature
            X509v3 Extended Key Usage:
                TLS Web Server Authentication
            X509v3 Subject Key Identifier:
                FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6
            X509v3 Authority Key Identifier:
                5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37`;

export const CERT_FIELDS: { k: string; d: string }[] = [
  { k: 'Issuer', d: 'Кто подписал. Совпадает с `Subject` промежуточного УЦ — так проверка находит следующее звено.' },
  { k: 'Validity', d: 'Срок. 90 дней, как у Let’s Encrypt сегодня; проверяется по часам клиента.' },
  { k: 'Subject Alternative Name', d: 'Имена, для которых сертификат годен. Именно с ними сверяют адрес.' },
  { k: 'Basic Constraints `CA:FALSE`', d: 'Этим сертификатом нельзя подписывать другие. У промежуточного — `CA:TRUE, pathlen:0`: подписывать можно, но только листья.' },
  { k: 'Extended Key Usage', d: 'Годится для сервера TLS. Сертификат клиента (mTLS) получает `clientAuth`.' },
  { k: 'Authority Key Identifier', d: 'Номер ключа издателя. Если у двух УЦ одинаковые имена, выбирают того, чей `Subject Key Identifier` совпал.' },
];

export const PLAIN_CHAIN =
  'Как проверка доверенности у нотариуса. Лист говорит: «меня заверил R1». Клиент ищет R1 у себя — его там нет: в хранилище лежат только корни. Тогда он смотрит, что принёс сервер, находит доверенность R1 с подписью корня, а корень у него есть. Если сервер доверенность не принёс, цепочка обрывается на первом же звене.';

export const CHAIN_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Промежуточный — обязанность сервера',
    d: 'В хранилище клиента только корни. Сервер, который отдаёт один лист, получает от Node `UNABLE_TO_VERIFY_LEAF_SIGNATURE` — даже при полном доверии к корню. В nginx это `ssl_certificate` с файлом **полной цепочки** (у certbot — `fullchain.pem`), а не `cert.pem`.',
    tone: 'err',
  },
  {
    t: 'Браузер иногда достраивает сам',
    d: 'Лист с полем AIA `caIssuers` — адресом, где лежит издатель, — сервер отдал без промежуточного. Chromium сам скачал `GET /int.der`; Node не сделал ни одного запроса и отказал. Отсюда классика: «в браузере открывается, а `fetch` с сервера и `curl` падают».',
    tone: 'warn',
  },
  {
    t: 'Корень отправлять незачем',
    d: 'Клиент, который корню доверяет, возьмёт его из своего хранилища. Клиент, который не доверяет, увидит самоподписанный сертификат в цепочке: `SELF_SIGNED_CERT_IN_CHAIN`. Знакомо по корпоративным прокси, которые подменяют сертификаты своим корнем.',
  },
];

/**
 * Учебная проверка цепочки — строкой: её печатает `CodeBlock`, исполняет демо и тест.
 * Порядок шагов — как у OpenSSL под Node: ошибки копятся, `code` — последняя, имя — только
 * при чистой цепочке. Тест: 148 из 150 решений `NODE_VERDICTS` и все живые прогоны.
 */
export const VERIFY_CODE = `function verifyChain({ presented, roots, host, now }) {
  const errors = [];
  const fail = (step, code, depth) => errors.push({ step, code, depth });
  const selfSigned = (c) => c.checkIssued(c);

  // 1. Строим цепочку: издателя ищем сперва среди своих корней, потом среди присланного
  const chain = [presented[0]];
  let anchored = roots.some((r) => r.fingerprint256 === presented[0].fingerprint256);
  while (!anchored) {
    const cur = chain[chain.length - 1];
    if (selfSigned(cur)) break;
    const root = roots.find((r) => cur.checkIssued(r));
    if (root) { chain.push(root); anchored = true; break; }
    const next = presented.find((c) => !chain.includes(c) && cur.checkIssued(c));
    if (!next) break;
    chain.push(next);
  }
  const top = chain.length - 1;
  if (!anchored) {
    if (selfSigned(chain[top])) fail('chain', top === 0 ? 'DEPTH_ZERO_SELF_SIGNED_CERT' : 'SELF_SIGNED_CERT_IN_CHAIN', top);
    else fail('chain', top === 0 ? 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' : 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', top);
  }

  // 2. Все, кто подписывает, обязаны быть УЦ (basicConstraints CA:TRUE)
  for (let i = 1; i < chain.length; i++) if (!chain[i].ca) fail('ca', 'INVALID_CA', i);

  // 3. Подписи и сроки — сверху вниз, от корня к листу. Верхнее звено оборванной
  //    цепочки (не корень и не лист) OpenSSL пропускает целиком — и подпись, и срок
  const from = !anchored && top > 0 && !selfSigned(chain[top]) ? top - 1 : top;
  for (let i = from; i >= 0; i--) {
    const cert = chain[i];
    const issuer = chain[i + 1];
    if (issuer && !cert.verify(issuer.publicKey)) fail('signature', 'CERT_SIGNATURE_FAILURE', i);
    if (now < cert.validFromDate) fail('time', 'CERT_NOT_YET_VALID', i);
    else if (now > cert.validToDate) fail('time', 'CERT_HAS_EXPIRED', i);
  }

  // 4. Имя сверяют, только если цепочка чиста
  if (!errors.length && !matchesHost(presented[0], host)) fail('name', 'ERR_TLS_CERT_ALTNAME_INVALID', 0);

  // Проверка не останавливается на первой ошибке; в отчёт идёт последняя
  return { chain, errors, code: errors.length ? errors[errors.length - 1].code : null };
}

// Имя — только из SAN; «*» заменяет ровно одну, самую левую метку
function matchesHost(cert, host) {
  const names = (cert.subjectAltName ?? '').split(', ')
    .filter((s) => s.startsWith('DNS:')).map((s) => s.slice(4).toLowerCase());
  const want = host.toLowerCase().split('.');
  return names.some((name) => {
    const parts = name.split('.');
    if (parts.length !== want.length) return false;
    return parts.every((p, i) => p === want[i] || (i === 0 && p === '*' && parts.length > 2));
  });
}`;

export const VERIFY_NOTE =
  '`presented` — сертификаты в том порядке, в каком их прислал сервер, `roots` — хранилище клиента. Вход — те же `X509Certificate` из `node:crypto`: `checkIssued` сверяет имя издателя и номер ключа, `verify` — подпись. **Главная неочевидность — порядок.** OpenSSL под Node не бросает проверку на первой ошибке, а идёт до конца, и в `authorizationError` попадает последняя. Поэтому просроченный лист без промежуточного Node называет `CERT_HAS_EXPIRED`, а не «нет издателя»: срок проверяется позже. Имя сверяется только у чистой цепочки. А верхнее звено оборванной цепочки не проверяется вовсе: просроченный промежуточный, корня которого нет у клиента, даёт `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, а не «просрочен».';

export const STAND_NOW = '2026-10-02T10:03:59.606Z';

export const DEMO_LEAVES: { id: string; label: string }[] = [
  { id: 'shop', label: 'обычный' },
  { id: 'expired', label: 'просрочен' },
  { id: 'future', label: 'ещё не действует' },
  { id: 'cnonly', label: 'имя только в CN' },
  { id: 'wild', label: '*.shop.test' },
];

export const DEMO_SENDS: { id: string; label: string }[] = [
  { id: 'leaf', label: 'только лист' },
  { id: 'leaf+int', label: 'лист + промежуточный' },
  { id: 'leaf+int+root', label: '+ корень' },
];

export const DEMO_HOSTS = ['shop.test', 'www.shop.test', 'api.shop.test', 'a.b.shop.test', 'other.test'];

export const DEMO_STEPS: StepInfo[] = [
  { id: 'chain', label: 'Цепочка до корня' },
  { id: 'ca', label: 'Издатели — УЦ' },
  { id: 'signature', label: 'Подписи' },
  { id: 'time', label: 'Сроки' },
  { id: 'name', label: 'Имя в SAN' },
];

/** Пояснения кодов для демо и таблицы. Строчная разметка. */
export const CODE_NOTES: Record<string, string> = {
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Сервер прислал один лист, а его издателя нет ни в присланном, ни в хранилище. Чинится на сервере: отдавать полную цепочку.',
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: 'Цепочка дошла до промежуточного, а его корня в хранилище клиента нет. Чинится на клиенте: доверить корень (`ca` в Node, `NODE_EXTRA_CA_CERTS`).',
  SELF_SIGNED_CERT_IN_CHAIN: 'Сервер прислал и корень, но клиент ему не доверяет. Сам по себе корень в цепочке ничего не доказывает: подписать себя может кто угодно.',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'Лист подписан сам собой — так выглядит сертификат, сделанный одной командой для разработки.',
  INVALID_CA: 'Подписывал сертификат без `CA:TRUE`. Без этой проверки любой владелец сертификата сайта мог бы выпускать сертификаты на чужие имена.',
  CERT_SIGNATURE_FAILURE: 'Подпись не сходится с ключом издателя: сертификат изменён после подписи.',
  CERT_HAS_EXPIRED: 'Срок вышел. Проверяется по часам клиента — с неверными часами «просрочено» всё.',
  CERT_NOT_YET_VALID: 'Срок ещё не начался. Чаще всего — часы клиента отстают.',
  ERR_TLS_CERT_ALTNAME_INVALID: 'Цепочка в порядке, но имени из адреса нет в SAN. Звёздочка заменяет ровно одну метку и не покрывает сам `shop.test`.',
};

export const DEMO_CAPTION =
  'Выберите сломанный лист и посмотрите, на каких шагах накопились ошибки и какая из них попала в отчёт. Просроченный лист без промежуточного даёт две ошибки, а Node называет вторую. Лист с именем только в CN — единственный случай, где учебная проверка и Node расходятся: Node берёт имя из CN, браузеры — нет.';

export const DEMO_DIFF_NOTE =
  'Node пускает: у листа нет SAN, и `checkServerIdentity` берёт имя из CN. Браузеры смотрят только в SAN — учебная проверка тоже.';

export const DEMO_STAND_NOTE =
  'Ответ Node снят на стенде теми же сертификатами в момент `STAND_NOW`; сертификаты и проверка — те, что выше.';

// ─── Раздел 4. Имя и срок ──────────────────────────────────────────────────────────────────

export const NAME_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'CN больше не имя сайта',
    d: 'Браузеры сверяют адрес только с SAN; Chrome перестал смотреть в CN с версии 58 (2017). Node — нет: сертификат без SAN с `CN=shop.test` Node 24 пропустил на `shop.test`. Сервис, который проверяли только из Node, может открыться в браузере с ошибкой имени.',
    tone: 'warn',
  },
  {
    t: 'Звёздочка — ровно одна метка',
    d: '`*.shop.test` покрывает `api.shop.test` и `www.shop.test`, но не `a.b.shop.test` (две метки) и не сам `shop.test` (ни одной). Поэтому в сертификат почти всегда кладут оба имени: `shop.test` и `*.shop.test`.',
  },
  {
    t: 'Срок — по часам клиента',
    d: 'Сервер не сообщает «сейчас», клиент сравнивает `notBefore` и `notAfter` со своими часами. Устройство, у которого часы сбросились на 2020 год, видит `CERT_NOT_YET_VALID` на каждом сайте.',
  },
];

export interface ErrorRow {
  k: string;
  node: string;
  chromium: string;
  tone?: 'err' | 'warn';
}

export const ERROR_ROWS: ErrorRow[] = [
  { k: 'нет промежуточного', node: '`UNABLE_TO_VERIFY_LEAF_SIGNATURE`', chromium: 'скачивает промежуточный по AIA, если поле есть; иначе `ERR_CERT_AUTHORITY_INVALID`', tone: 'err' },
  { k: 'корню не доверяют', node: '`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, с присланным корнем — `SELF_SIGNED_CERT_IN_CHAIN`', chromium: '`ERR_CERT_AUTHORITY_INVALID`' },
  { k: 'просрочен', node: '`CERT_HAS_EXPIRED`', chromium: '`ERR_CERT_DATE_INVALID` (по документации)' },
  { k: 'ещё не действует', node: '`CERT_NOT_YET_VALID`', chromium: '`ERR_CERT_DATE_INVALID` (по документации)' },
  { k: 'чужое имя', node: '`ERR_TLS_CERT_ALTNAME_INVALID`', chromium: '`ERR_CERT_COMMON_NAME_INVALID` (по документации)' },
  { k: 'имя только в CN', node: 'пропускает', chromium: '`ERR_CERT_COMMON_NAME_INVALID` (по документации)', tone: 'warn' },
];

export const CHROMIUM_NOTE =
  'Chromium без доверия к учебному корню на всех десяти сломанных вариантах — просроченном, с чужим именем, со звёздочкой на два уровня — сказал одно и то же: `ERR_CERT_AUTHORITY_INVALID`. Браузер показывает одну, самую важную ошибку. Пока корень не доверенный, остальные не видны: починили доверие — увидели срок, починили срок — увидели имя.';

// ─── Раздел 5. ACME ────────────────────────────────────────────────────────────────────────

export const ACME_LEAD =
  'ACME — это HTTP API удостоверяющего центра. Все запросы — `POST` с телом, подписанным ключом **аккаунта** (JWS), а не ключом сертификата. Ключ аккаунта создают один раз; ключ сертификата — новый на каждый выпуск.';

export const ACME_STEPS: { k: string; req: string; d: string }[] = [
  { k: '1. Каталог', req: '`GET /directory`', d: 'Адреса остальных методов: `newNonce`, `newAccount`, `newOrder`, `renewalInfo`. У Let’s Encrypt — `https://acme-v02.api.letsencrypt.org/directory`.' },
  { k: '2. Аккаунт', req: '`POST newAccount`', d: 'Открытый ключ аккаунта (JWK) и согласие с условиями. Дальше запросы подписаны этим ключом, а в каждом — одноразовый `nonce` от сервера, чтобы запрос нельзя было повторить.' },
  { k: '3. Заказ', req: '`POST newOrder`', d: 'Список имён: `shop.test`, `www.shop.test`. В ответ — заказ в статусе `pending` и по одной авторизации на имя.' },
  { k: '4. Вызов', req: '`POST` авторизации', d: 'Для каждого имени УЦ предлагает вызовы — способы доказать, что домен ваш: `http-01`, `dns-01`, `tls-alpn-01`. В каждом — случайный `token`.' },
  { k: '5. Ответ', req: '`POST` вызова `{}`', d: 'Вы выложили ответ и говорите «проверяйте». УЦ сам идёт к вашему домену — из нескольких точек сети сразу — и сверяет. Авторизация становится `valid`, заказ — `ready`.' },
  { k: '6. Финализация', req: '`POST finalize` с CSR', d: 'CSR — запрос на сертификат: новый открытый ключ и имена, подписанные закрытым ключом сертификата. Имена в CSR обязаны совпасть с заказом.' },
  { k: '7. Сертификат', req: '`POST-as-GET certificate`', d: 'Заказ `valid`, в нём ссылка на сертификат: PEM-цепочка — лист и промежуточный. Её и отдаёт сервер целиком.' },
];

export const CHALLENGE_ROWS: { k: string; where: string; wild: string; when: string }[] = [
  {
    k: '`http-01`',
    where: '`http://<имя>/.well-known/acme-challenge/<token>` отдаёт ключ авторизации, порт **80**',
    wild: 'нет',
    when: 'Один сервер с открытым 80-м портом. Так работают certbot и cert-manager по умолчанию.',
  },
  {
    k: '`dns-01`',
    where: 'TXT-запись `_acme-challenge.<имя>` = base64url(SHA-256(ключ авторизации))',
    wild: '**да**, только так',
    when: 'Звёздочка, сервер без публичного 80-го порта, много серверов за балансировщиком. Нужен доступ к API DNS.',
  },
  {
    k: '`tls-alpn-01`',
    where: 'на порту **443** при ALPN `acme-tls/1` — особый самоподписанный сертификат с хешем ключа авторизации (RFC 8737)',
    wild: 'нет',
    when: 'Когда 80-й порт закрыт, а 443 — ваш: так умеют Caddy и Traefik.',
  },
];

/** ACME-вычисления, которые делает клиент. `createHash` из `node:crypto` подаётся снаружи. */
export const ACME_CODE = `// base64url без «=» — так ACME пишет все двоичные поля
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

// Отпечаток ключа аккаунта (RFC 7638): только обязательные поля, по алфавиту, без пробелов
function thumbprint(jwk) {
  const fields = jwk.kty === 'EC'
    ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
    : { e: jwk.e, kty: jwk.kty, n: jwk.n };
  return b64url(createHash('sha256').update(JSON.stringify(fields)).digest());
}

// Ответ на вызов: токен от УЦ + отпечаток вашего ключа.
// http-01 отдаёт эту строку как есть
const keyAuthorization = (token, jwk) => token + '.' + thumbprint(jwk);

// dns-01 кладёт в TXT не её, а SHA-256 от неё
const dns01Value = (token, jwk) =>
  b64url(createHash('sha256').update(keyAuthorization(token, jwk)).digest());

// ARI (RFC 9773): имя сертификата = keyIdentifier из AKI + «.» + серийный номер в DER
const hex = (s) => Buffer.from(s.replace(/:/g, ''), 'hex');
const ariCertId = (akiHex, serialHex) => b64url(hex(akiHex)) + '.' + b64url(hex(serialHex));`;

export const ACME_NOTE =
  'Ключ авторизации связывает домен с **вашим аккаунтом**: подсмотреть `token` мало, ответ без отпечатка вашего ключа не подойдёт. Поэтому ключ аккаунта — такой же секрет, как ключ сертификата: в cert-manager он лежит отдельным Secret ([«Вход в кластер: Ingress и Gateway API», раздел «TLS и сертификаты»](/delivery/ingress/#s4)).';

export const LIFETIME_ROWS: { k: string; v: string; d: string; tone?: 'warn' }[] = [
  { k: 'до 15.03.2026', v: '398 дней', d: 'Прежний потолок для публичных сертификатов (CA/B Forum Baseline Requirements, раздел 6.3.2).' },
  { k: 'с 15.03.2026', v: '200 дней', d: 'Первая ступень бюллетеня SC-081v3, принятого 11.04.2025.' },
  { k: 'с 15.03.2027', v: '100 дней', d: 'Вторая ступень.' },
  { k: 'с 15.03.2029', v: '**47 дней**', d: 'Последняя. Повторно использовать прошлую проверку домена можно будет лишь 10 дней.', tone: 'warn' },
  { k: 'Let’s Encrypt, `classic`', v: '90 → 64 → 45 дней', d: '64 дня с 10.02.2027, 45 дней с 16.02.2028; переиспользование проверки домена сокращается с 30 дней до 7 часов (блог Let’s Encrypt, декабрь 2025).' },
  { k: 'Let’s Encrypt, профили', v: '45 и 6 дней', d: '`tlsserver` — 45 дней с 13.05.2026, по желанию; `shortlived` — 6 дней.' },
];

export const ARI_NOTE =
  '**Когда продлевать, теперь говорит УЦ.** ARI (RFC 9773, 2025) — метод `renewalInfo`: клиент спрашивает его по идентификатору сертификата и получает окно `suggestedWindow` с `start` и `end`. Если УЦ должен массово отозвать сертификаты, он сдвигает окно в прошлое, и клиенты продлевают сами, без писем админам. Без ARI Let’s Encrypt советует продлевать на двух третях срока: жёсткое «раз в 60 дней» при сроке 45 дней уже опаздывает.';

// ─── Раздел 6. Отзыв, HSTS, mTLS ───────────────────────────────────────────────────────────

export const REVOKE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'OCSP уходит',
    d: 'OCSP — запрос к УЦ «этот сертификат не отозван?» при каждом заходе. УЦ при этом узнаёт, кто на какой сайт идёт. Let’s Encrypt убрал адрес OCSP из сертификатов 07.05.2025 и выключил свои OCSP-серверы 06.08.2025; Baseline Requirements с 2024 года требуют CRL, а OCSP сделали необязательным.',
    tone: 'warn',
  },
  {
    t: 'Браузеры проверяют по своим спискам',
    d: 'Chrome давно не ходит в OCSP: он получает от Google сжатый список отзывов (CRLSet). Firefox с версии 137 скачивает CRLite — компактный набор всех отозванных сертификатов из журналов Certificate Transparency, а с версии 142 перестал спрашивать OCSP для обычных сертификатов доменов.',
  },
  {
    t: 'OCSP stapling — по инерции',
    d: 'Stapling — когда сервер сам приносит свежий ответ OCSP в рукопожатии. Chromium 153 на стенде всё ещё просит его (`status_request`). Но у сертификата без адреса OCSP «приносить» нечего: `ssl_stapling on` в nginx с сертификатом Let’s Encrypt ничего не делает — только пишет в лог, что адреса OCSP в сертификате нет.',
  },
  {
    t: 'Короткий срок вместо отзыва',
    d: 'Отзыв работает плохо, поэтому индустрия выбрала другое: украденный ключ проживёт не больше срока сертификата. Отсюда и 47 дней, и шестидневные сертификаты.',
  },
];

export const HSTS_NOTE =
  '**HSTS** — заголовок `Strict-Transport-Security: max-age=31536000; includeSubDomains`. Получив его один раз, браузер на этот срок сам переписывает `http://` на `https://` и **не даёт пропустить ошибку сертификата** кнопкой «всё равно перейти». Первый заход всё равно идёт по HTTP; чтобы закрыть и его, домен вносят в список **preload**, вшитый в браузеры: hstspreload.org требует `max-age` не меньше года, `includeSubDomains`, `preload` и редирект с HTTP. Выйти из списка — месяцы. Заголовок в наборе остальных — в [«Безопасность фронтенда», раздел «CSRF и кликджекинг»](/platform/security/#s5). Целые зоны вроде `.dev` и `.app` внесены в preload сразу: по HTTP туда не зайти вовсе.';

export const MTLS_LEAD =
  '**mTLS** — когда сертификат показывает и клиент. Сервер в `CertificateRequest` просит сертификат, клиент отвечает своим `Certificate` и `CertificateVerify`. Так сервисы внутри кластера узнают друг друга без паролей; сертификат клиента получает `extendedKeyUsage=clientAuth`.';

export const MTLS_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'С сертификатом',
    d: 'Сервер `tls.createServer({ requestCert: true, rejectUnauthorized: true, ca })` увидел `CN=billing-service`, `authorized: true` — имя клиента приходит из сертификата, а не из запроса.',
  },
  {
    t: 'Без сертификата — ошибка после «успеха»',
    d: 'В TLS 1.3 клиент отправляет свой `Finished` и считает рукопожатие законченным: событие `secureConnect` в Node **сработало**. Отказ приходит следом сигналом `certificate_required` — у клиента `ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED`, у сервера `ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE`. Код, который считает «подключились — значит пустили», ошибается.',
    tone: 'warn',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Без промежуточного «работает в браузере»',
    d: 'Chromium достраивает цепочку по AIA и кешу, Node, curl и мобильные клиенты — нет. Проверять сервер надо не браузером, а `openssl s_client -connect host:443 -servername host` : `Verify return code: 21 (unable to verify the first certificate)` значит, что сервер не прислал промежуточный.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Код ошибки — не первая проблема',
    d: 'Node докладывает последнюю найденную ошибку, Chromium — самую важную. Просроченный лист без промежуточного в Node — `CERT_HAS_EXPIRED`, в Chromium без доверия — `ERR_CERT_AUTHORITY_INVALID`. Починив одну, ждите следующую.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`rejectUnauthorized: false` выключает всё',
    d: 'И цепочку, и срок, и имя: с ним Node подключится к кому угодно, кто встал посередине. На стенде он нужен, чтобы прочитать `authorizationError`. Для своего корня есть `ca` или `NODE_EXTRA_CA_CERTS`, для отладки — `NODE_TLS_REJECT_UNAUTHORIZED=0` только локально; Node печатает о нём предупреждение не зря.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Звёздочка не покрывает голый домен',
    d: '`*.shop.test` не подходит для `shop.test` и для `a.b.shop.test`. Сертификат со звёздочкой Let’s Encrypt выдаёт только через `dns-01`.',
  },
  {
    n: '05',
    t: 'Продление «раз в 60 дней» скоро опоздает',
    d: 'При сроке 45 дней жёсткое расписание не успеет. Продлевать по ARI или на двух третях срока и мониторить дату `notAfter` снаружи, отдельно от того, кто продлевает.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '0-RTT повторяем',
    d: 'Ранние данные можно отправить серверу второй раз; защита от повтора живёт в памяти одного процесса. Неидемпотентные запросы в 0-RTT не пускать.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'HSTS preload почти необратим',
    d: 'С `includeSubDomains; preload` любой поддомен без рабочего HTTPS перестаёт открываться у всех, и вычеркнуть домен из списка — дело месяцев, пока обновятся браузеры.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Без SNI — чужой сертификат',
    d: 'Клиент, который подключается по IP или не умеет SNI, получает сертификат по умолчанию. Health-check балансировщика по IP «видит ошибку сертификата», хотя сайт в порядке.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  { title: 'RFC 8446 — TLS 1.3', href: 'https://www.rfc-editor.org/rfc/rfc8446', what: 'сообщения рукопожатия, расписание ключей, билеты, 0-RTT и повтор (раздел 8)' },
  { title: 'RFC 5280 — X.509 PKI', href: 'https://www.rfc-editor.org/rfc/rfc5280', what: 'поля сертификата, basicConstraints, AKI/SKI, построение пути' },
  { title: 'RFC 6125 — проверка имени сервера', href: 'https://www.rfc-editor.org/rfc/rfc6125', what: 'SAN вместо CN, правила звёздочки' },
  { title: 'RFC 8555 — ACME', href: 'https://www.rfc-editor.org/rfc/rfc8555', what: 'аккаунт, заказ, авторизации, `http-01` и `dns-01`, финализация CSR' },
  { title: 'RFC 8737 — TLS-ALPN-01', href: 'https://www.rfc-editor.org/rfc/rfc8737', what: 'вызов через ALPN `acme-tls/1`' },
  { title: 'RFC 7638 — JWK Thumbprint', href: 'https://www.rfc-editor.org/rfc/rfc7638', what: 'отпечаток ключа аккаунта, пример из раздела 3.1' },
  { title: 'RFC 9773 — ACME Renewal Information', href: 'https://www.rfc-editor.org/rfc/rfc9773', what: '`renewalInfo`, `suggestedWindow`, идентификатор сертификата' },
  { title: 'CA/Browser Forum — Baseline Requirements', href: 'https://github.com/cabforum/servercert/blob/main/docs/BR.md', what: 'раздел 6.3.2: 398 → 200 → 100 → 47 дней' },
  { title: 'CA/Browser Forum — Ballot SC-081v3', href: 'https://cabforum.org/2025/04/11/ballot-sc081v3-introduce-schedule-of-reducing-validity-and-data-reuse-periods/', what: 'расписание сокращения сроков и переиспользования проверок' },
  { title: 'Let’s Encrypt — From 90 to 45', href: 'https://letsencrypt.org/2025/12/02/from-90-to-45', what: 'профили, даты 2026–2028, ARI и продление на двух третях' },
  { title: 'Let’s Encrypt — Ending OCSP Support in 2025', href: 'https://letsencrypt.org/2024/12/05/ending-ocsp', what: 'даты отключения OCSP и Must-Staple' },
  { title: 'Mozilla Hacks — CRLite in Firefox', href: 'https://hacks.mozilla.org/2025/08/crlite-fast-private-and-comprehensive-certificate-revocation-checking-in-firefox/', what: 'CRLite с Firefox 137, OCSP выключен в 142' },
  { title: 'Chromium — CRLSets', href: 'https://www.chromium.org/Home/chromium-security/crlsets/', what: 'как Chrome узнаёт об отзыве без OCSP' },
  { title: 'HSTS Preload List', href: 'https://hstspreload.org/', what: 'требования к домену и порядок исключения' },
  { title: 'Node.js — TLS', href: 'https://nodejs.org/api/tls.html', what: '`checkServerIdentity`, `SNICallback`, `ALPNProtocols`, событие `keylog`, `requestCert`' },
  { title: 'Node.js — X509Certificate', href: 'https://nodejs.org/api/crypto.html#class-x509certificate', what: '`checkIssued`, `verify`, `subjectAltName`, `validFromDate`' },
  { title: 'OpenSSL — openssl-s_client', href: 'https://docs.openssl.org/3.6/man1/openssl-s_client/', what: '`-trace`, `-msg`, `-keylogfile`, `-sess_out`, `-early_data`' },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Транспорт и RTT-бюджет»](/platform/network/#s1) — круги до первого байта, SNI и ECH. [HTTP/2 и HTTP/3, раздел «HTTP/3 и QUIC»](/platform/http2-http3/#s6) — TLS 1.3 внутри QUIC, `Early-Data` и `425`. [Вход в кластер: Ingress и Gateway API, раздел «TLS и сертификаты»](/delivery/ingress/#s4) — cert-manager и TLS на входе. [Nginx как обратный прокси](/delivery/nginx-proxy/) — сервер, на котором чаще всего заканчивается TLS. [GitHub Pages: публикация статики](/delivery/github-pages/) — сертификат для своего домена без вашего участия. [Безопасность фронтенда, раздел «CSRF и кликджекинг»](/platform/security/#s5) — HSTS среди остальных заголовков. [WebRTC, раздел «DTLS и SRTP»](/platform/webrtc/#s5) — TLS без удостоверяющих центров, по отпечатку. [DNS](/delivery/dns/) — путь запроса по серверам, TTL и кеш, CNAME на вершине зоны и смена адреса при выкатке.';

// ─── Снимок стенда: сертификаты учебного УЦ и решения Node ────────────────────────────────

export const CERTS: CertFact[] = [
  {
    id: 'root',
    label: 'Lesson Root CA',
    subject: "O=Lesson, CN=Lesson Root CA",
    issuer: "O=Lesson, CN=Lesson Root CA",
    ca: true,
    san: null,
    from: '2026-10-02T09:57:15.000Z',
    to: '2036-09-29T09:57:15.000Z',
    ski: '2E:C1:EC:82:A6:83:9A:2B:86:2B:6E:A4:AD:4E:A2:12:A0:C9:DF:51',
    aki: '2E:C1:EC:82:A6:83:9A:2B:86:2B:6E:A4:AD:4E:A2:12:A0:C9:DF:51',
    der: 445,
    fp: '89:CD:2E:E2:6B:BF:E8:F8:88:54:7A:97:21:21:EC:E4:85:19:48:49:71:1D:C9:5D:DB:FA:FA:F5:8E:EB:34:DA',
    pem: `-----BEGIN CERTIFICATE-----
MIIBuTCCAV+gAwIBAgIUZQdIK8w2e0J4QZKxCmQBszcBQIQwCgYIKoZIzj0EAwIw
KjEPMA0GA1UECgwGTGVzc29uMRcwFQYDVQQDDA5MZXNzb24gUm9vdCBDQTAeFw0y
NjEwMDIwOTU3MTVaFw0zNjA5MjkwOTU3MTVaMCoxDzANBgNVBAoMBkxlc3NvbjEX
MBUGA1UEAwwOTGVzc29uIFJvb3QgQ0EwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNC
AASJIt5rVaTJspB1+TOpgvCb0aJx2fcOvUYYN1oVux5OgS0shzDzhZfzX7+GWvnz
JnMriS8DdFD0qJE4Z+e1Sug0o2MwYTAdBgNVHQ4EFgQULsHsgqaDmiuGK26krU6i
EqDJ31EwHwYDVR0jBBgwFoAULsHsgqaDmiuGK26krU6iEqDJ31EwDwYDVR0TAQH/
BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwIDSAAwRQIgHY3sN+0j
LHGUVaV1bjbNPNPaHqJ2rFoM04TM05rsAT8CIQCeMq3A52I6j5DC5krT6wCTxSiG
VZbWtWUKpQIMA5hM/w==
-----END CERTIFICATE-----`,
  },
  {
    id: 'int',
    label: 'Lesson Issuing CA R1',
    subject: "O=Lesson, CN=Lesson Issuing CA R1",
    issuer: "O=Lesson, CN=Lesson Root CA",
    ca: true,
    san: null,
    from: '2026-10-02T09:57:15.000Z',
    to: '2031-10-01T09:57:15.000Z',
    ski: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    aki: '2E:C1:EC:82:A6:83:9A:2B:86:2B:6E:A4:AD:4E:A2:12:A0:C9:DF:51',
    der: 453,
    fp: '46:84:8E:1C:CB:7A:CF:60:B6:40:FA:61:83:4F:83:92:A0:99:97:85:C0:60:84:3B:0E:1D:78:BC:3E:28:07:67',
    pem: `-----BEGIN CERTIFICATE-----
MIIBwTCCAWigAwIBAgIUeKJqRHx3/Te23lqmmxKnrctdXyAwCgYIKoZIzj0EAwIw
KjEPMA0GA1UECgwGTGVzc29uMRcwFQYDVQQDDA5MZXNzb24gUm9vdCBDQTAeFw0y
NjEwMDIwOTU3MTVaFw0zMTEwMDEwOTU3MTVaMDAxDzANBgNVBAoMBkxlc3NvbjEd
MBsGA1UEAwwUTGVzc29uIElzc3VpbmcgQ0EgUjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQ7x297sPycklMKt1XbrXurzsgAtc7rTc/EtKT2fXuNGdDMODHvFxCk
eLRh5LWPRmghferCA0g8rgzfhmYeAndpo2YwZDASBgNVHRMBAf8ECDAGAQH/AgEA
MA4GA1UdDwEB/wQEAwIBBjAdBgNVHQ4EFgQUXem592qMCXyBpzmve7pwUpkpizcw
HwYDVR0jBBgwFoAULsHsgqaDmiuGK26krU6iEqDJ31EwCgYIKoZIzj0EAwIDRwAw
RAIgEv+QjGTo2f1J6PiHtvzukv59ibD27V4f1nKGHUuKYN4CIHlQRgrbe0r2lUzT
cSk1N1w2SS4I/h6jbhnyYHMmDWNv
-----END CERTIFICATE-----`,
  },
  {
    id: 'shop',
    label: 'shop.test',
    subject: "CN=shop.test",
    issuer: "O=Lesson, CN=Lesson Issuing CA R1",
    ca: false,
    san: "DNS:shop.test, DNS:www.shop.test",
    from: '2026-10-02T09:57:15.000Z',
    to: '2026-12-31T09:57:15.000Z',
    ski: 'FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6',
    aki: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    der: 486,
    fp: '5E:C2:03:8E:7D:7C:87:96:AF:48:37:3C:49:7D:7F:9F:6D:D6:13:F2:94:3F:FF:95:69:9B:8D:F9:A2:CE:E2:65',
    pem: `-----BEGIN CERTIFICATE-----
MIIB4jCCAYigAwIBAgIUa4S3L7IDN6mMijhImOr7BOslSwgwCgYIKoZIzj0EAwIw
MDEPMA0GA1UECgwGTGVzc29uMR0wGwYDVQQDDBRMZXNzb24gSXNzdWluZyBDQSBS
MTAeFw0yNjEwMDIwOTU3MTVaFw0yNjEyMzEwOTU3MTVaMBQxEjAQBgNVBAMMCXNo
b3AudGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKyYgVER/H6PR2PJlxjB
vQTu4cKrWj9k324bWdu3redK33rbwkiTZWQTzWJy9WIQRSLP0m2likOraQ/FcyI4
KbqjgZswgZgwIwYDVR0RBBwwGoIJc2hvcC50ZXN0gg13d3cuc2hvcC50ZXN0MAwG
A1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMB
MB0GA1UdDgQWBBT/pIgroApABR7uOcBnBivsWFKM1jAfBgNVHSMEGDAWgBRd6bn3
aowJfIGnOa97unBSmSmLNzAKBggqhkjOPQQDAgNIADBFAiA4UTzYBEpR+07hcqMN
oNEbkvpRniJ3Oz2syifLlYJnLQIhALSohlKFjAqVPl+RsP2T84OmUGBiVu4CBCpR
ceH1l5GK
-----END CERTIFICATE-----`,
  },
  {
    id: 'expired',
    label: 'shop.test, просрочен',
    subject: "CN=shop.test",
    issuer: "O=Lesson, CN=Lesson Issuing CA R1",
    ca: false,
    san: "DNS:shop.test, DNS:www.shop.test",
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-04-01T00:00:00.000Z',
    ski: 'FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6',
    aki: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    der: 485,
    fp: '1C:AD:4F:21:7A:AB:E1:93:94:E7:61:2C:D4:20:B2:6F:8E:83:7F:01:B5:38:2F:2D:A4:4E:83:48:7F:F5:B0:0B',
    pem: `-----BEGIN CERTIFICATE-----
MIIB4TCCAYigAwIBAgIUdeGYbvTyh+O5w03ceaKwwdC2JaAwCgYIKoZIzj0EAwIw
MDEPMA0GA1UECgwGTGVzc29uMR0wGwYDVQQDDBRMZXNzb24gSXNzdWluZyBDQSBS
MTAeFw0yNjAxMDEwMDAwMDBaFw0yNjA0MDEwMDAwMDBaMBQxEjAQBgNVBAMMCXNo
b3AudGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKyYgVER/H6PR2PJlxjB
vQTu4cKrWj9k324bWdu3redK33rbwkiTZWQTzWJy9WIQRSLP0m2likOraQ/FcyI4
KbqjgZswgZgwIwYDVR0RBBwwGoIJc2hvcC50ZXN0gg13d3cuc2hvcC50ZXN0MAwG
A1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMB
MB0GA1UdDgQWBBT/pIgroApABR7uOcBnBivsWFKM1jAfBgNVHSMEGDAWgBRd6bn3
aowJfIGnOa97unBSmSmLNzAKBggqhkjOPQQDAgNHADBEAiBA2WFem9VIcKHXyIxO
HUk/qAAHcUuYyWbwlWvno9smAQIgfr3pNc53tpnthWNmXgZPq4q3w2bP8XXbte9L
db8xrXo=
-----END CERTIFICATE-----`,
  },
  {
    id: 'future',
    label: 'shop.test, ещё не действует',
    subject: "CN=shop.test",
    issuer: "O=Lesson, CN=Lesson Issuing CA R1",
    ca: false,
    san: "DNS:shop.test, DNS:www.shop.test",
    from: '2099-01-01T00:00:00.000Z',
    to: '2099-04-01T00:00:00.000Z',
    ski: 'FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6',
    aki: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    der: 490,
    fp: 'BA:8B:F7:25:D3:CB:E8:A0:A4:46:78:87:74:00:EA:9E:3B:FF:EE:32:75:E4:36:6A:68:6E:35:09:AE:8A:FC:74',
    pem: `-----BEGIN CERTIFICATE-----
MIIB5jCCAYygAwIBAgIUeBrO1ChyPHWxDp0QklaufInG61kwCgYIKoZIzj0EAwIw
MDEPMA0GA1UECgwGTGVzc29uMR0wGwYDVQQDDBRMZXNzb24gSXNzdWluZyBDQSBS
MTAiGA8yMDk5MDEwMTAwMDAwMFoYDzIwOTkwNDAxMDAwMDAwWjAUMRIwEAYDVQQD
DAlzaG9wLnRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASsmIFREfx+j0dj
yZcYwb0E7uHCq1o/ZN9uG1nbt63nSt9628JIk2VkE81icvViEEUiz9JtpYpDq2kP
xXMiOCm6o4GbMIGYMCMGA1UdEQQcMBqCCXNob3AudGVzdIINd3d3LnNob3AudGVz
dDAMBgNVHRMBAf8EAjAAMA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEF
BQcDATAdBgNVHQ4EFgQU/6SIK6AKQAUe7jnAZwYr7FhSjNYwHwYDVR0jBBgwFoAU
Xem592qMCXyBpzmve7pwUpkpizcwCgYIKoZIzj0EAwIDSAAwRQIhAP+48JuKLsun
M1aBWlxFnl6DX7gvkKPUlAuJZOVjnrJ/AiB25XaAazoXcvgjWH+6G6/E9SqqGO6G
G4o5WdUDWDBRvw==
-----END CERTIFICATE-----`,
  },
  {
    id: 'cnonly',
    label: 'shop.test, имя только в CN',
    subject: "CN=shop.test",
    issuer: "O=Lesson, CN=Lesson Issuing CA R1",
    ca: false,
    san: null,
    from: '2026-10-02T09:57:26.000Z',
    to: '2026-12-31T09:57:26.000Z',
    ski: 'FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6',
    aki: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    der: 446,
    fp: '76:8C:67:48:6C:DE:77:0D:91:53:BA:51:30:84:61:C8:89:7B:89:7D:E7:DE:CF:63:1E:32:A5:64:1C:B2:E2:39',
    pem: `-----BEGIN CERTIFICATE-----
MIIBujCCAWGgAwIBAgIUEfPO6SxiEwXdOWjnuz+y8r0BCCQwCgYIKoZIzj0EAwIw
MDEPMA0GA1UECgwGTGVzc29uMR0wGwYDVQQDDBRMZXNzb24gSXNzdWluZyBDQSBS
MTAeFw0yNjEwMDIwOTU3MjZaFw0yNjEyMzEwOTU3MjZaMBQxEjAQBgNVBAMMCXNo
b3AudGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABKyYgVER/H6PR2PJlxjB
vQTu4cKrWj9k324bWdu3redK33rbwkiTZWQTzWJy9WIQRSLP0m2likOraQ/FcyI4
KbqjdTBzMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoG
CCsGAQUFBwMBMB0GA1UdDgQWBBT/pIgroApABR7uOcBnBivsWFKM1jAfBgNVHSME
GDAWgBRd6bn3aowJfIGnOa97unBSmSmLNzAKBggqhkjOPQQDAgNHADBEAiAPMEIS
NFw5vTkFt8V62+vWyhA+dlbp7NkMO4vZT1f7/AIgZP4pQ3HURrLN8kERVBKOb2Jn
iHbQdbyjHFZPqhArk50=
-----END CERTIFICATE-----`,
  },
  {
    id: 'wild',
    label: '*.shop.test',
    subject: "CN=*.shop.test",
    issuer: "O=Lesson, CN=Lesson Issuing CA R1",
    ca: false,
    san: "DNS:*.shop.test",
    from: '2026-10-02T09:57:26.000Z',
    to: '2026-12-31T09:57:26.000Z',
    ski: 'FF:A4:88:2B:A0:0A:40:05:1E:EE:39:C0:67:06:2B:EC:58:52:8C:D6',
    aki: '5D:E9:B9:F7:6A:8C:09:7C:81:A7:39:AF:7B:BA:70:52:99:29:8B:37',
    der: 475,
    fp: 'D3:D0:0D:B2:A3:C0:C4:24:E2:98:7A:A9:6C:BB:26:94:DF:12:6B:FF:F5:4B:54:9E:E7:0B:7F:2F:F8:33:1E:93',
    pem: `-----BEGIN CERTIFICATE-----
MIIB1zCCAX2gAwIBAgIUY3fNOE2zLRhFbqOXXNuF6Qe9NigwCgYIKoZIzj0EAwIw
MDEPMA0GA1UECgwGTGVzc29uMR0wGwYDVQQDDBRMZXNzb24gSXNzdWluZyBDQSBS
MTAeFw0yNjEwMDIwOTU3MjZaFw0yNjEyMzEwOTU3MjZaMBYxFDASBgNVBAMMCyou
c2hvcC50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAErJiBURH8fo9HY8mX
GMG9BO7hwqtaP2TfbhtZ27et50rfetvCSJNlZBPNYnL1YhBFIs/SbaWKQ6tpD8Vz
IjgpuqOBjjCBizAWBgNVHREEDzANggsqLnNob3AudGVzdDAMBgNVHRMBAf8EAjAA
MA4GA1UdDwEB/wQEAwIHgDATBgNVHSUEDDAKBggrBgEFBQcDATAdBgNVHQ4EFgQU
/6SIK6AKQAUe7jnAZwYr7FhSjNYwHwYDVR0jBBgwFoAUXem592qMCXyBpzmve7pw
UpkpizcwCgYIKoZIzj0EAwIDSAAwRQIhAKdzVEE2FIfKRxo5E5YI3A/5+l0/jr0o
QH0crjoMhbl4AiBHiybRYWklUPB0PAybVYMR2xXpTRKmBXPg7nmTh4v6Og==
-----END CERTIFICATE-----`,
  },
];

export const NODE_VERDICTS: Record<string, string | null> = {
  'shop|leaf|trust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|trust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|trust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|trust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|trust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|notrust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|notrust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|notrust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|notrust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf|notrust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'shop|leaf+int|trust|shop.test': null,
  'shop|leaf+int|trust|www.shop.test': null,
  'shop|leaf+int|trust|api.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int|notrust|shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'shop|leaf+int|notrust|www.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'shop|leaf+int|notrust|api.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'shop|leaf+int|notrust|a.b.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'shop|leaf+int|notrust|other.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'shop|leaf+int+root|trust|shop.test': null,
  'shop|leaf+int+root|trust|www.shop.test': null,
  'shop|leaf+int+root|trust|api.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int+root|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int+root|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'shop|leaf+int+root|notrust|shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'shop|leaf+int+root|notrust|www.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'shop|leaf+int+root|notrust|api.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'shop|leaf+int+root|notrust|a.b.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'shop|leaf+int+root|notrust|other.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'expired|leaf|trust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|trust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|trust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|trust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|trust|other.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|notrust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|notrust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|notrust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|notrust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf|notrust|other.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|trust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|trust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|trust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|trust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|trust|other.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|notrust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|notrust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|notrust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|notrust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int|notrust|other.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|trust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|trust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|trust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|trust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|trust|other.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|notrust|shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|notrust|www.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|notrust|api.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|notrust|a.b.shop.test': 'CERT_HAS_EXPIRED',
  'expired|leaf+int+root|notrust|other.test': 'CERT_HAS_EXPIRED',
  'future|leaf|trust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|trust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|trust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|trust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|trust|other.test': 'CERT_NOT_YET_VALID',
  'future|leaf|notrust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|notrust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|notrust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|notrust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf|notrust|other.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|trust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|trust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|trust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|trust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|trust|other.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|notrust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|notrust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|notrust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|notrust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int|notrust|other.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|trust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|trust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|trust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|trust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|trust|other.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|notrust|shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|notrust|www.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|notrust|api.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|notrust|a.b.shop.test': 'CERT_NOT_YET_VALID',
  'future|leaf+int+root|notrust|other.test': 'CERT_NOT_YET_VALID',
  'cnonly|leaf|trust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|trust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|trust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|trust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|trust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|notrust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|notrust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|notrust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|notrust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf|notrust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'cnonly|leaf+int|trust|shop.test': null,
  'cnonly|leaf+int|trust|www.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int|trust|api.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int|notrust|shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'cnonly|leaf+int|notrust|www.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'cnonly|leaf+int|notrust|api.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'cnonly|leaf+int|notrust|a.b.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'cnonly|leaf+int|notrust|other.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'cnonly|leaf+int+root|trust|shop.test': null,
  'cnonly|leaf+int+root|trust|www.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int+root|trust|api.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int+root|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int+root|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'cnonly|leaf+int+root|notrust|shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'cnonly|leaf+int+root|notrust|www.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'cnonly|leaf+int+root|notrust|api.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'cnonly|leaf+int+root|notrust|a.b.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'cnonly|leaf+int+root|notrust|other.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'wild|leaf|trust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|trust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|trust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|trust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|trust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|notrust|shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|notrust|www.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|notrust|api.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|notrust|a.b.shop.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf|notrust|other.test': 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'wild|leaf+int|trust|shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int|trust|www.shop.test': null,
  'wild|leaf+int|trust|api.shop.test': null,
  'wild|leaf+int|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int|notrust|shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'wild|leaf+int|notrust|www.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'wild|leaf+int|notrust|api.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'wild|leaf+int|notrust|a.b.shop.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'wild|leaf+int|notrust|other.test': 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'wild|leaf+int+root|trust|shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int+root|trust|www.shop.test': null,
  'wild|leaf+int+root|trust|api.shop.test': null,
  'wild|leaf+int+root|trust|a.b.shop.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int+root|trust|other.test': 'ERR_TLS_CERT_ALTNAME_INVALID',
  'wild|leaf+int+root|notrust|shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'wild|leaf+int+root|notrust|www.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'wild|leaf+int+root|notrust|api.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'wild|leaf+int+root|notrust|a.b.shop.test': 'SELF_SIGNED_CERT_IN_CHAIN',
  'wild|leaf+int+root|notrust|other.test': 'SELF_SIGNED_CERT_IN_CHAIN',
};
