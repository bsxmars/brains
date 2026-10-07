import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { IceScenario } from '@/widgets/ice-lab/model/types';
import { STAND } from './stand';

export { STAND };

/**
 * Данные темы «WebRTC: как два браузера находят друг друга».
 *
 * Тема написана здесь, 2026-10-01. Соседи: «Долгие соединения» разбирают WebSocket (сигнализация
 * стенда идёт по нему, но сам протокол здесь не пересказывается) и WebTransport; «Сеть
 * и кеширование» — TCP, UDP, TLS и QUIC. Здесь — только то, чего там нет: SDP, ICE, NAT,
 * STUN/TURN, DTLS-SRTP, каналы данных на SCTP и `getStats`.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, Chromium 153.0.8010.12 (headless shell, Playwright 1.63.0), `ws` 8.22.0 (есть
 * в node_modules как зависимость зависимости), 1 октября 2026, macOS. Скрипты стенда лежали
 * в каталоге scratchpad агента (`agent-webrtc/two-pages.mjs`, `one-page.mjs`, `stunturn.mjs`,
 * `collect.mjs`, `extract.mjs`, `probe-edge.mjs`, `probe-nofp.mjs`), в репозиторий не входят. Журнал — `stand.ts`
 * рядом, собран `extract.mjs` без правок, кроме одной нормализации: адрес машины в локальной
 * сети заменён на `192.168.1.105` (строка той же длины — байты сообщений сигнализации верны).
 *
 * Два браузера (два отдельных процесса Chromium) и свой сервер `node:http` + `ws` на порту
 * 50901: страница — `SIGNALING_CODE` дословно (`collect.mjs` вынимал строку из этого файла),
 * поверх неё стенд вешал только журнал событий через `addEventListener`. Сервер пересылает
 * сообщения второму участнику комнаты и пишет их в журнал (`signal`: кто, что, байты).
 *
 * STUN и TURN — свои, на `node:dgram` (`stunturn.mjs`, порт 50910): Binding, Allocate с ответом
 * 401 и долговременными учётными данными (MESSAGE-INTEGRITY, HMAC-SHA1), CreatePermission,
 * ChannelBind, Send/Data indication и ChannelData; relay-адреса — порты 50920+. Серверов из
 * интернета нет. Чтобы изобразить NAT на одной машине, STUN отвечает настоящим адресом, но
 * портом на 1000 больше — «внешним портом» (srflx на стенде поэтому смещён на 1000 от host).
 * Сценарии (`STAND.scenarios`):
 *   host      — без iceServers;
 *   stun      — свой STUN;
 *   relay     — свой TURN, `iceTransportPolicy: 'relay'`;
 *   symturn   — сервер сигнализации прибавляет 7 к порту каждого не-relay кандидата: так пара
 *               видит симметричный NAT (адрес, который назвал STUN, собеседнику не годится);
 *               TURN подключён;
 *   symmetric — то же без TURN (только STUN);
 *   norelay   — `iceTransportPolicy: 'relay'` без серверов;
 *   badfp     — сервер сигнализации меняет первый байт `a=fingerprint` в offer.
 *   Плюс `stun` с `--disable-features=WebRtcHideLocalIpsWithMdns` (`noMdnsCandidates`).
 * Симметричный NAT стенд **изображает** подменой портов, настоящего NAT не было; relay-кандидат
 * настоящий, но «внешний» адрес TURN — та же машина.
 *
 * Медиа (`STAND.media`) — `one-page.mjs`: два `RTCPeerConnection` в одной странице, звук
 * от `OscillatorNode` и видео `canvas.captureStream()`, каналы `CHANNELS_CODE` дословно;
 * offer/answer до сбора кандидатов, `getStats` после обмена сообщениями.
 *
 * `probe-edge.mjs` (`PROBES`): `addIceCandidate` до `setRemoteDescription`, встречные offer,
 * сообщение больше `max-message-size`, `RTCPeerConnection` на `http://` не-localhost.
 *
 * Сверх снятого: `getUserMedia` в headless shell на macOS с фейковым устройством повесил
 * браузер (`probe-gum.mjs`), поэтому «разрешение камеры снимает mDNS» — по документации
 * Chromium, не запускалось. Только по документации: типы NAT и доля звонков через TURN,
 * TURN по TCP/TLS, perfect negotiation целиком (снята лишь неявная отмена своего offer),
 * DCEP — открытие канала сообщением внутри SCTP, ICE restart, человек посередине на
 * сервере сигнализации (стенд показал только, что подменённый отпечаток рвёт DTLS).
 *
 * Пересобирается `tests/unit/webrtc.test.ts`: `SDP_CODE` разбирает каждую строку кандидата
 * стенда так же, как `new RTCIceCandidate` в Chromium (`STAND.chromiumParse`), формула
 * приоритета пересобирает каждый приоритет, `pairPriority` даёт ровно `priority` пар из
 * `getStats`, `checklist` — те же пары, что составил Chromium; `STATS_CODE` — таблицу
 * `STATS_ROWS`; отпечаток в SDP — SHA-256 сертификата из `getStats` (node:crypto); числа текста —
 * из журнала. Браузерный прогон тестом не повторяется: порты, ufrag и ключи новые при каждом запуске.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'peer-to-peer',
    d: 'Соединение «равный с равным»: браузеры шлют данные друг другу, без сервера посередине. Сервер нужен только чтобы познакомить их — и иногда чтобы передавать пакеты, если напрямую не выходит.',
  },
  {
    k: 'NAT',
    d: 'Устройство на границе сети — обычно домашний роутер или оборудование провайдера. Подменяет частный адрес компьютера (`192.168.…`) своим внешним и выделяет под соединение внешний порт. Снаружи компьютер за NAT не виден.',
  },
  {
    k: 'SDP',
    d: 'Session Description Protocol — текстовое описание сеанса: какие потоки, какие кодеки, ключи для ICE и отпечаток сертификата. Offer и answer — это две такие записи.',
  },
  {
    k: 'ICE',
    d: 'Interactive Connectivity Establishment — процедура, которая собирает возможные адреса обеих сторон, перебирает их пары и выбирает ту, по которой пакеты реально доходят.',
  },
  {
    k: 'кандидат',
    d: 'Один возможный адрес для связи: IP (или имя), порт, протокол и тип — `host`, `srflx`, `prflx` или `relay`. Каждая сторона собирает свои и отправляет собеседнику.',
  },
  {
    k: 'STUN и TURN',
    d: 'Два вспомогательных сервера. STUN отвечает «я вижу тебя с такого-то адреса и порта» — так узнают внешний адрес за NAT. TURN пересылает пакеты, когда напрямую не выходит.',
  },
  {
    k: 'DTLS и SRTP',
    d: 'DTLS — TLS для UDP: то же рукопожатие и шифрование, но пакеты могут теряться и приходить не по порядку. SRTP — зашифрованный RTP, формат пакетов звука и видео; ключи для него дают из рукопожатия DTLS.',
  },
  {
    k: 'SCTP',
    d: 'Транспорт каналов данных. Умеет много независимых потоков в одном соединении, и для каждого можно выбрать: надёжно и по порядку, как TCP, или «отправил и забыл», как UDP.',
  },
  {
    k: 'mDNS',
    d: 'Multicast DNS — поиск имён внутри локальной сети без DNS-сервера. Chromium подставляет вместо своего локального IP случайное имя `….local`, и узнать его адрес может только компьютер из той же сети.',
  },
];

export const PLAIN_WEBRTC =
  'Как двое, решивших созвониться напрямую, у которых нет номеров друг друга. Сначала они пишут общему знакомому — тот передаёт записки туда и обратно: «я могу так-то, мой адрес такой-то». Когда записки прочитаны, они звонят напрямую, а знакомый больше не нужен. Если напрямую не дозвониться — разговор идёт через коммутатор, но и тогда коммутатор не понимает, о чём говорят: разговор зашифрован.';

export const PREREQ_NOTE =
  'WebRTC собран из готовых сетевых деталей. Тема опирается на четыре из них.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'TCP, UDP и TLS',
    d: 'TCP доставляет байты по порядку и без потерь, UDP — отдельными пакетами, которые могут потеряться. TLS шифрует соединение и проверяет сертификат сервера. Медиа WebRTC едет по UDP: опоздавший кадр видео уже не нужен.',
    href: '/platform/network/#s1',
    hrefLabel: '«Сеть и кеширование», раздел «Транспорт и RTT-бюджет»',
    tone: 'info',
  },
  {
    t: 'WebSocket',
    d: 'Долгое соединение браузера с сервером, по которому сервер может писать первым. Сигнализация в теме идёт по нему: так сервер передаёт сообщение одного участника другому без опроса.',
    href: '/platform/realtime/#s2',
    hrefLabel: '«Долгие соединения», раздел «Рукопожатие»',
    tone: 'info',
  },
  {
    t: 'Хеш и подпись',
    d: 'SHA-256 даёт 32 байта «отпечатка» любых данных: другие данные — другой отпечаток. Отпечаток сертификата в SDP работает именно так.',
    href: '/platform/authentication/#s2',
    hrefLabel: '«Аутентификация», раздел «Подпись JWT»',
    tone: 'info',
  },
  {
    t: 'Адрес и порт, частные сети',
    d: 'Пакет UDP адресуется парой «IP и порт». Адреса `10.…`, `172.16–31.…` и `192.168.…` — частные: в интернете их нет, такой адрес имеет смысл только внутри своей сети. Компьютер дома почти всегда сидит на частном адресе.',
    tone: 'info',
  },
];

// ─── Раздел 1. Сигнализация ────────────────────────────────────────────────────────────────

export const PLAIN_SIGNALING =
  'Как почта для двух людей, которые хотят встретиться. Чтобы договориться о месте, нужно сначала обменяться письмами. Встреча — это WebRTC, а почта — ваша забота: стандарт не говорит, через какое отделение отправлять.';

export const SIGNAL_CHIPS = [
  { label: 'звонящий: offer', tone: 'info' as const },
  { label: 'сервер сигнализации', tone: 'ink' as const },
  { label: 'отвечающий: answer', tone: 'info' as const },
  { label: 'обе стороны: кандидаты', tone: 'warn' as const },
  { label: 'проверки ICE напрямую', tone: 'ok' as const },
];

export const SIGNAL_NOTE =
  'Через сервер идут только описания и кандидаты — несколько сообщений по 200–550 байт. Звук, видео и сообщения каналов данных через него не идут: они едут по паре адресов, которую выбрал ICE.';

/** Код страницы стенда дословно: его исполняли оба браузера. */
export const SIGNALING_CODE = `// Сигнализация — обычный WebSocket к своему серверу. WebRTC не знает, как
// доставить offer до собеседника: это делает ваш код, любым каналом.
const ws = new WebSocket(\`ws://\${location.host}/room/42\`);
const send = (msg) => ws.send(JSON.stringify(msg));

const pc = new RTCPeerConnection(config);   // config: { iceServers, iceTransportPolicy }

// Trickle ICE: каждый найденный кандидат уходит собеседнику сразу.
pc.onicecandidate = ({ candidate }) => {
  if (candidate) send({ candidate });
};

// Новый канал или дорожка требуют переговоров — браузер зовёт negotiationneeded.
pc.onnegotiationneeded = async () => {
  await pc.setLocalDescription();            // без аргумента: браузер сам создаст offer
  send({ description: pc.localDescription });
};

ws.onmessage = async ({ data }) => {
  const { description, candidate } = JSON.parse(data);
  if (description) {
    await pc.setRemoteDescription(description);
    if (description.type === 'offer') {
      await pc.setLocalDescription();        // здесь — answer
      send({ description: pc.localDescription });
    }
  } else if (candidate) {
    await pc.addIceCandidate(candidate);
  }
};

// Отвечающий: канал приходит событием, когда его открыл собеседник.
pc.ondatachannel = ({ channel }) => {
  channel.onmessage = ({ data }) => channel.send('и тебе ' + data);
};

// Звонящий начинает разговор: создаёт канал — и запускает всё остальное.
function call() {
  const chat = pc.createDataChannel('chat');
  chat.onopen = () => chat.send('привет');
  chat.onmessage = ({ data }) => console.log(data);   // «и тебе привет»
  return chat;
}`;

/** Сообщения сервера сигнализации в сценарии host — из журнала `STAND.scenarios.host.signal`. */
export const SIGNAL_ROWS = STAND.scenarios.host.signal.map((m) => ({
  from: m.from === 'caller' ? 'звонящий' : 'отвечающий',
  what: m.kind === 'candidate' ? 'кандидат' : m.kind,
  bytes: String(m.bytes),
}));

export const SIGNALING_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Канал — любой',
    d: 'WebSocket, `fetch` с опросом, сообщение в мессенджере, QR-код. Стандарт описывает только, что передать, а не как. В телефонии своё готовое решение: SIP поверх WebSocket (RFC 7118) — SDP в нём едет в теле сообщения `INVITE`.',
  },
  {
    t: 'Кто с кем в комнате — тоже ваше',
    d: 'Сервер стенда пересылает сообщение второму участнику комнаты `/room/42`. Кто может войти, сколько участников, что делать, если второй ещё не пришёл, — всё это логика вашего сервера. WebRTC о комнатах не знает.',
    tone: 'warn',
  },
  {
    t: 'Сервер видит всё описание',
    d: 'Через сигнализацию проходят адреса обеих сторон, ключи ICE и отпечатки сертификатов. Звука и данных сервер не видит, но тот, кто управляет сигнализацией, может подменить отпечаток. Поэтому канал сигнализации — `wss://` с проверкой, кто на том конце.',
    tone: 'warn',
  },
];

// ─── Раздел 2. Offer, answer и SDP ─────────────────────────────────────────────────────────

/** Offer сценария host — как его отправил звонящий: без кандидатов, они придут отдельно. */
export const DATA_OFFER = STAND.scenarios.host.signal[0].sdp!.replace(/\r\n/g, '\n').trimEnd();

export const SDP_ROWS: { k: string; d: string }[] = [
  { k: 'v=, o=, s=, t=', d: 'Шапка из старого формата SDP (RFC 4566). В WebRTC почти пустая: `s=-`, `t=0 0`. В `o=` — номер сеанса и версия описания; адрес там всегда `127.0.0.1`.' },
  { k: 'a=group:BUNDLE 0', d: 'Все секции из списка едут по одной паре адресов. Без него у каждой секции было бы своё соединение ICE.' },
  { k: 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', d: 'Секция: здесь — каналы данных. Порт `9` — заглушка: настоящие адреса придут кандидатами.' },
  { k: 'c=IN IP4 0.0.0.0', d: 'Адрес соединения — тоже заглушка, по той же причине.' },
  { k: 'a=ice-ufrag, a=ice-pwd', d: 'Имя и пароль для проверок ICE. Каждая проверка подписана паролем собеседника — чужой пакет на тот же порт не пройдёт как проверка.' },
  { k: 'a=ice-options:trickle', d: 'Кандидаты будут приходить по одному, после описания.' },
  { k: 'a=fingerprint:sha-256 …', d: 'SHA-256 сертификата, которым эта сторона представится в рукопожатии DTLS.' },
  { k: 'a=setup:actpass', d: 'Кто начнёт рукопожатие DTLS. Offer говорит «могу любую роль», answer выбирает: на стенде `active` — отвечающий начинает.' },
  { k: 'a=mid:0', d: 'Имя секции, на которое ссылаются BUNDLE и кандидаты (`sdpMid`).' },
  { k: 'a=sctp-port:5000, a=max-message-size:262144', d: 'Порт SCTP внутри DTLS и самое большое сообщение канала, которое примет эта сторона, — 256 КиБ.' },
];

export const PLAIN_SDP =
  'Как анкета перед знакомством: «говорю по-русски и по-английски, могу звонить по видео, вот мой паспорт для проверки». Собеседник отвечает своей анкетой — и говорить дальше будут на языке, который есть в обеих.';

export const MEDIA_NOTE =
  'Offer с одной звуковой и одной видеодорожкой и каналом данных — 171 строка. Три секции: `m=audio` с 8 номерами форматов, `m=video` с 23 и `m=application`. Каждый номер расшифрован строкой `a=rtpmap`: `111 opus/48000/2`, `96 VP8/90000`, H.264 в шести вариантах, AV1, VP9 и служебные `rtx`, `red`, `ulpfec`. Answer повторяет секции в том же порядке и отвечает за себя: `recvonly` — принимать буду, отправлять нечего; `setup:active`.';

export const OFFER_ANSWER_STEPS: { k: string; who: string; state: string }[] = [
  { k: '`setLocalDescription()`', who: 'звонящий', state: '`have-local-offer`' },
  { k: '`setRemoteDescription(offer)`', who: 'отвечающий', state: '`have-remote-offer`' },
  { k: '`setLocalDescription()`', who: 'отвечающий', state: '`stable`' },
  { k: '`setRemoteDescription(answer)`', who: 'звонящий', state: '`stable`' },
];

export const OFFER_ANSWER_NOTE =
  '`signalingState` меняется ровно в таком порядке — на стенде в обоих сценариях. Сбор кандидатов начинается сразу после `setLocalDescription`, а не после ответа: первый кандидат звонящего прошёл через сервер раньше, чем answer.';

// ─── Раздел 3. Кандидаты ICE ───────────────────────────────────────────────────────────────

export const PLAIN_NAT =
  'Как офис с одним городским номером и секретарём. Снаружи звонят на общий номер, секретарь знает, кому переключить, — но только если сотрудник сам звонил этому человеку недавно. Незнакомый звонок секретарь не пропустит. Узнать городской номер сотрудник может, только позвонив кому-то снаружи и спросив «с какого номера я звоню?» — это и есть STUN.';

export const CANDIDATE_TYPES: { k: string; d: string; stand: string; tone: 'info' | 'ok' | 'warn' }[] = [
  {
    k: 'host',
    d: 'Адрес самого компьютера на сетевой карте. Работает, если собеседник в той же сети или у компьютера публичный адрес.',
    stand: 'собран во всех сценариях, кроме «только relay»; адрес спрятан за mDNS',
    tone: 'ok',
  },
  {
    k: 'srflx',
    d: 'Server-reflexive — адрес, каким компьютер видит STUN-сервер, то есть внешний адрес и порт NAT. Работает, если NAT пропустит пакеты собеседника на этот порт.',
    stand: 'от своего STUN: порт на 1000 больше host — так стенд изображает NAT',
    tone: 'info',
  },
  {
    k: 'prflx',
    d: 'Peer-reflexive — адрес, который стал известен из пришедшей проверки: пакет пришёл не с того адреса, что был в списке. Никто его не отправлял через сигнализацию.',
    stand: 'появился в сценарии с изображённым симметричным NAT',
    tone: 'info',
  },
  {
    k: 'relay',
    d: 'Адрес на TURN-сервере. Всё, что придёт на него, сервер перешлёт вам. Работает почти всегда, но весь трафик идёт через сервер — его канал и его счёт.',
    stand: 'от своего TURN на `node:dgram`',
    tone: 'warn',
  },
];

/** Кандидат srflx со стенда без mDNS: по нему разобраны поля строки. */
export const SAMPLE_CANDIDATE = STAND.noMdnsCandidates[1];

export const CANDIDATE_FIELDS: { k: string; v: string; d: string }[] = [
  { k: 'foundation', v: '1768869333', d: 'Метка «одного происхождения»: тип, базовый адрес, сервер, протокол. Кандидаты с одной меткой ICE проверяет вместе — если сработал один, сработает и второй.' },
  { k: 'component', v: '1', d: 'RTP. Двойка была бы для RTCP, если бы тот шёл отдельно; в WebRTC почти всегда `a=rtcp-mux` — одна дорожка.' },
  { k: 'protocol', v: 'udp', d: 'Транспорт кандидата. Бывает и `tcp` — когда UDP закрыт.' },
  { k: 'priority', v: '1677729535', d: 'Чем больше, тем раньше кандидата попробуют. Формула — ниже.' },
  { k: 'address, port', v: '192.168.1.105 59333', d: 'Куда слать. У srflx — что увидел STUN-сервер.' },
  { k: 'typ', v: 'srflx', d: 'Тип кандидата.' },
  { k: 'raddr, rport', v: '192.168.1.105 58333', d: 'Related — база кандидата: host, с которого STUN-запрос ушёл. С mDNS Chromium пишет сюда `0.0.0.0` и `0`.' },
  { k: 'generation, ufrag, network-cost', v: '0, +fom, 999', d: 'Расширения Chromium: номер поколения (растёт при ICE restart), ufrag и «стоимость» сети. По исходникам WebRTC 999 — тип сети неизвестен.' },
];

export const PRIORITY_NOTE =
  'Приоритет — это три числа, упакованные в одно. Старший байт — предпочтение типа: прямые адреса раньше пересылки. Средние два — выбор среди своих сетевых карт. Младший — `256 − component`. Функции разбора и формулы — одна строка кода на странице; ей же считает демо ниже.';

/** Учебный разбор SDP и кандидатов, формулы RFC 8445. Исполняют демо (`model/run.ts`) и тест. */
export const SDP_CODE = `// Строка кандидата: восемь обязательных полей по порядку, дальше пары «имя значение».
// candidate:3416709932 1 udp 2113937151 fefb….local 52020 typ host generation 0 …
function parseCandidate(line) {
  const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').trim().split(/\\s+/);
  const [foundation, component, protocol, priority, address, port, typ, type] = parts;
  if (typ !== 'typ') throw new Error('не строка кандидата: ' + line);
  const c = {
    foundation,
    component: Number(component),        // 1 — RTP; 2 — RTCP, если тот идёт отдельно
    protocol: protocol.toLowerCase(),    // udp или tcp
    priority: Number(priority),
    address,                             // IP или имя mDNS вида «…uuid….local»
    port: Number(port),
    type,                                // host, srflx, prflx, relay
    relatedAddress: null,
    relatedPort: null,
    extra: {},
  };
  for (let i = 8; i + 1 < parts.length; i += 2) {
    const [k, v] = [parts[i], parts[i + 1]];
    if (k === 'raddr') c.relatedAddress = v;          // с какого адреса получен этот
    else if (k === 'rport') c.relatedPort = Number(v);
    else c.extra[k] = v;                              // generation, ufrag, network-cost…
  }
  return c;
}

// SDP — текст из строк «буква=значение». Строка m= открывает новую секцию:
// всё, что ниже неё, относится к одному потоку — звуку, видео или каналу данных.
function parseSdp(sdp) {
  const session = { lines: [], attrs: [] };
  const media = [];
  let cur = session;
  for (const line of sdp.split(/\\r?\\n/)) {
    if (!line) continue;
    const value = line.slice(2);
    if (line[0] === 'm') {
      const [kind, port, proto, ...formats] = value.split(' ');
      cur = { kind, port: Number(port), proto, formats, lines: [], attrs: [] };
      media.push(cur);
    }
    cur.lines.push(line);
    if (line[0] === 'a') {
      const i = value.indexOf(':');
      cur.attrs.push(i < 0 ? { k: value, v: '' } : { k: value.slice(0, i), v: value.slice(i + 1) });
    }
  }
  // Атрибут секции; если его нет — общий, из шапки до первой m=.
  const get = (sec, k) => (sec.attrs.find((a) => a.k === k) ?? session.attrs.find((a) => a.k === k))?.v;
  for (const m of media) {
    m.mid = get(m, 'mid');
    m.ice = { ufrag: get(m, 'ice-ufrag'), pwd: get(m, 'ice-pwd') };
    m.fingerprint = get(m, 'fingerprint');           // «sha-256 AB:CD:…» — отпечаток сертификата DTLS
    m.setup = get(m, 'setup');                       // actpass / active / passive — кто начнёт DTLS
    m.direction = ['sendrecv', 'sendonly', 'recvonly', 'inactive'].find((d) => m.attrs.some((a) => a.k === d)) ?? null;
    m.codecs = m.attrs
      .filter((a) => a.k === 'rtpmap')
      .map((a) => {
        const [pt, codec] = a.v.split(' ');
        const [name, clockRate, channels] = codec.split('/');
        return { pt: Number(pt), name, clockRate: Number(clockRate), channels: channels ? Number(channels) : null };
      });
    m.candidates = m.attrs.filter((a) => a.k === 'candidate').map((a) => parseCandidate(a.v));
  }
  const bundle = session.attrs.find((a) => a.k === 'group' && a.v.startsWith('BUNDLE '));
  return { session, media, bundle: bundle ? bundle.v.split(' ').slice(1) : [] };
}

// RFC 8445, 5.1.2.1: приоритет кандидата — три числа, упакованные в 32 бита.
// typePref (0–126): тип адреса; localPref (0–65535): выбор среди своих сетей;
// component: 1 для RTP — и 256 − 1 = 255 в младшем байте.
function candidatePriority(typePref, localPref, component) {
  return typePref * 2 ** 24 + localPref * 2 ** 8 + (256 - component);
}

// Обратная операция: какие три числа лежат в готовом приоритете.
function splitPriority(priority) {
  return {
    typePref: Math.floor(priority / 2 ** 24),
    localPref: Math.floor(priority / 2 ** 8) % 2 ** 16,
    component: 256 - (priority % 2 ** 8),
  };
}

// RFC 8445, 6.1.2.3: приоритет пары. G — приоритет кандидата управляющей стороны
// (controlling, на стенде — звонящий), D — управляемой. Число до 2^64, поэтому BigInt.
function pairPriority(G, D) {
  const [g, d] = [BigInt(G), BigInt(D)];
  const min = g < d ? g : d;
  const max = g > d ? g : d;
  return 2n ** 32n * min + 2n * max + (g > d ? 1n : 0n);
}

// Список проверок одной стороны: каждый свой кандидат с каждым чужим того же компонента,
// по убыванию приоритета пары. Свой srflx в пары не идёт: проверки уходят с его базы — host.
function checklist(local, remote, controlling) {
  const pairs = [];
  for (const l of local) {
    if (l.type === 'srflx') continue;
    for (const r of remote) {
      if (l.component !== r.component || l.protocol !== r.protocol) continue;
      // Имя .local понимает только браузер: TURN-сервер отправить по нему не сможет.
      if (l.type === 'relay' && r.address.endsWith('.local')) continue;
      const priority = controlling ? pairPriority(l.priority, r.priority) : pairPriority(r.priority, l.priority);
      pairs.push({ local: l, remote: r, priority });
    }
  }
  return pairs.sort((a, b) => (a.priority < b.priority ? 1 : a.priority > b.priority ? -1 : 0));
}`;

export const PRIORITY_ROWS: { k: string; rfc: string; stand: string; local: string; sample: string }[] = [
  { k: 'host', rfc: '126', stand: '126', local: '30', sample: '2113937151' },
  { k: 'prflx', rfc: '110', stand: '110', local: '30', sample: '1845501695' },
  { k: 'srflx', rfc: '100', stand: '100', local: '30', sample: '1677729535' },
  { k: 'relay', rfc: '0', stand: '3', local: '31', sample: '50339839' },
];

export const PRIORITY_AFTER =
  'Предпочтения типа у Chromium совпали с рекомендацией RFC 8445 везде, кроме relay: 3 вместо 0. Это законно — RFC даёт числа как совет, требуя только порядок «прямой адрес раньше пересылки». Локальное предпочтение Chromium выбирает сам; на стенде у всех кандидатов одной сетевой карты — 30, у relay — 31.';

export const PLAIN_MDNS =
  'Как подписаться в чате не номером телефона, а прозвищем. Соседи по подъезду знают, кто такой «Сосед с пятого», и могут постучать в дверь. Всем остальным прозвище ничего не говорит — адреса в нём нет.';

export const MDNS_ROWS: { k: string; v: string }[] = [
  { k: 'по умолчанию', v: '`fefbb9f2-….local 52020 typ host`, у srflx — `raddr 0.0.0.0 rport 0`' },
  { k: 'с `--disable-features=WebRtcHideLocalIpsWithMdns`', v: '`192.168.1.105 58333 typ host`, у srflx — `raddr 192.168.1.105 rport 58333`' },
];

export const MDNS_NOTE =
  'Любая страница может создать `RTCPeerConnection` без разрешений и прочитать кандидатов. Раньше так узнавали локальный IP посетителя — ещё одна примета для слежки. Теперь Chromium подставляет случайное имя, и разрешить его может только компьютер в той же сети. По документации Chromium настоящий адрес возвращается, когда странице разрешены камера или микрофон: тогда она и так знает о человеке больше.';

export const TURN_ROWS = STAND.scenarios.relay.turn.map((t) => ({
  method: t.method,
  result: t.result ?? (t.channel ? `канал ${t.channel}` : t.peer ? `разрешён ${t.peer}` : ''),
  extra: t.mapped ? `видит ${t.mapped}` : t.relayed ? `relay ${t.relayed}` : '',
}));

export const TURN_NOTE =
  'Журнал своего TURN-сервера в сценарии «только relay». Каждый браузер сначала спросил адрес (Binding), потом попросил relay-адрес (Allocate) — и получил 401: TURN раздаёт свой канал только по имени и паролю. Второй Allocate пришёл подписанным, сервер выдал порт. Дальше — разрешение на адрес собеседника (CreatePermission) и номер канала `0x4000` (ChannelBind): с ним каждый пакет несёт 4 байта заголовка вместо 36 у Send indication. За разговор через сервер прошло 60 пакетов ChannelData и ещё 14 — в длинной форме, Send и Data indication, пока номер канала не был назначен.';

// ─── Раздел 4. Проверки связности ──────────────────────────────────────────────────────────

export const CHECKS_NOTE =
  'Собрав кандидатов, каждая сторона составляет пары «мой × чужой» и шлёт по каждой проверку — STUN-запрос Binding, подписанный паролем `ice-pwd` собеседника. Пришёл ответ — пара рабочая. Одна сторона управляющая (controlling, на стенде — звонящий): она выбирает из рабочих пар ту, по которой поедут данные, и помечает её (nominated).';

export const PAIR_NOTE =
  'Приоритет пары складывается из приоритетов обоих кандидатов так, чтобы обе стороны получили одно и то же число: меньший из двух — в старшие 32 бита, больший — в младшие, и единица, если больший у управляющей стороны. `pairPriority` из кода выше дала ровно те числа, что Chromium показал в `getStats` у каждой пары стенда.';

export const PLAIN_SYMMETRIC =
  'Секретарь, который на каждый внешний номер заводит отдельную линию. Вы позвонили в справочную — справочная видит линию 7. Вы сообщили другу «звони на линию 7», а линия 7 закреплена за справочной: звонок друга секретарь не пропустит. Узнать, какую линию получил бы друг, заранее нельзя.';

export const NAT_ROWS: { k: string; d: string; works: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'Конусный NAT (один внешний порт на все адреса)',
    d: 'Порт, который увидел STUN, годится и для собеседника. Пробой проходит: обе стороны шлют проверки навстречу, и NAT каждой видит «я сам туда писал».',
    works: 'srflx ↔ srflx',
    tone: 'ok',
  },
  {
    k: 'Симметричный NAT с одной стороны',
    d: 'Его внешний порт для собеседника не тот, что видел STUN. Но если у второй стороны NAT конусный, она примет проверку с нового порта и узнает его как prflx.',
    works: 'обычно — через prflx',
    tone: 'warn',
  },
  {
    k: 'Симметричный NAT с обеих сторон',
    d: 'Каждая шлёт на порт, которого у собеседника нет. Ни одна проверка не доходит — нужен TURN.',
    works: 'только relay',
    tone: 'err',
  },
];

export const NAT_STAND_NOTE =
  'Настоящего NAT на стенде нет: оба браузера на одной машине. Его изобразил сервер сигнализации — прибавлял 7 к порту каждого host- и srflx-кандидата по дороге. Для собеседника это ровно то, что даёт симметричный NAT с двух сторон: в списке адреса, на которые никто не отвечает.';

export const SYMMETRIC_RESULT =
  'Без TURN все проверки ушли в пустоту, и примерно через 15 секунд `connectionState` стал `failed`. С TURN звонящий соединился с relay-адресом отвечающего: его host → relay собеседника. Попутно звонящий узнал prflx — настоящий порт отвечающего, с которого пришла проверка.';

/** Сценарии демо: журнал стенда как есть, подписи — что здесь произошло. */
export const DEMO_SCENARIOS: IceScenario[] = [
  {
    id: 'host',
    label: 'Одна сеть',
    note: 'Без STUN и TURN: у каждой стороны один host-кандидат с именем `.local`. Единственная пара сработала с первой проверки.',
    run: STAND.scenarios.host,
  },
  {
    id: 'stun',
    label: 'STUN',
    note: 'Свой STUN добавил srflx — с портом на 1000 больше host. Но пара host ↔ host приоритетнее и сработала первой: в одной сети внешний адрес не понадобился.',
    run: STAND.scenarios.stun,
  },
  {
    id: 'relay',
    label: 'Только TURN',
    note: '`iceTransportPolicy: \'relay\'`: браузер не раскрывает ни одного своего адреса, только relay. Данные идут браузер → TURN → TURN → браузер.',
    run: STAND.scenarios.relay,
  },
  {
    id: 'symturn',
    label: 'NAT + TURN',
    note: 'Изображён симметричный NAT: сервер сигнализации портит порты host и srflx. Пары с ними висят в проверке, prflx узнан из пришедшей проверки, а сработала пара host → relay собеседника.',
    run: STAND.scenarios.symturn,
  },
  {
    id: 'symmetric',
    label: 'NAT без TURN',
    note: 'То же без TURN. Проверки не доходят ни по одной паре, и через ≈15 с соединение `failed`. После отказа Chromium убрал пары из `getStats` — список проверок построен по кандидатам, состояния пар не осталось.',
    run: STAND.scenarios.symmetric,
  },
  {
    id: 'norelay',
    label: 'relay без сервера',
    note: '`iceTransportPolicy: \'relay\'`, но `iceServers` пуст: кандидатов нет вовсе. Сбор завершился, а `connectionState` так и остался `new` — ни ошибки, ни события.',
    run: STAND.scenarios.norelay,
  },
  {
    id: 'badfp',
    label: 'Чужой отпечаток',
    note: 'Сервер сигнализации поменял один байт `a=fingerprint` в offer. ICE соединился, а рукопожатие DTLS — нет: сертификат не совпал с отпечатком. `iceConnectionState` — `connected`, `connectionState` — `failed`.',
    run: STAND.scenarios.badfp,
  },
];

export const DEMO_CAPTION =
  'Кандидаты и список проверок считают `parseCandidate`, `splitPriority` и `checklist` выше — на тех строках, что ходили через сигнализацию стенда. Состояние пар, выбранная пара и журнал событий — из `getStats` и обработчиков звонящего. Пара, которой нет в `getStats`, Chromium не проверял.';

export const TRICKLE_NOTE =
  'Trickle ICE — кандидаты уходят по одному, как только найдены, а не одним списком внутри SDP. На стенде offer ушёл без единого кандидата, а они пошли следом отдельными сообщениями по 215–225 байт. Без trickle пришлось бы ждать `iceGatheringState === \'complete\'`, а с настоящими STUN и TURN в интернете сбор занимает сотни миллисекунд и больше — столько ждал бы каждый звонок.';

// ─── Раздел 5. DTLS и SRTP ─────────────────────────────────────────────────────────────────

export const PLAIN_FINGERPRINT =
  'Как сверить ключ по фото. Вы заранее переслали другу фотографию своего ключа через общего знакомого. При встрече друг сравнивает ключ с фото. Подделать ключ при встрече нельзя — но знакомый, который передавал фото, мог подменить его заранее. Поэтому знакомый должен быть надёжным.';

export const DTLS_ROWS: { k: string; v: string; d: string }[] = [
  { k: 'сертификат', v: '`CN=WebRTC`, ECDSA P-256, 280 байт', d: 'Самоподписанный, создан браузером для этого `RTCPeerConnection`. Удостоверяющих центров здесь нет: доверие — только через отпечаток в SDP.' },
  { k: 'срок', v: '30 сентября — 31 октября 2026', d: 'Месяц. Можно создать свой заранее — `RTCPeerConnection.generateCertificate()` — и передать в `certificates`.' },
  { k: '`a=fingerprint`', v: 'SHA-256 сертификата', d: 'Отпечаток в offer совпал с SHA-256 байтов сертификата из `getStats`. При рукопожатии каждая сторона сверяет присланный сертификат с отпечатком собеседника.' },
  { k: 'версия', v: '`tlsVersion: FEFC`', d: 'DTLS 1.3. У DTLS номера версий идут вниз: `FEFF` — 1.0, `FEFD` — 1.2, `FEFC` — 1.3.' },
  { k: 'шифр DTLS', v: '`TLS_AES_128_GCM_SHA256`', d: 'Набор TLS 1.3: им шифруются каналы данных.' },
  { k: 'шифр SRTP', v: '`SRTP_AES128_CM_HMAC_SHA1_80`', d: 'Для звука и видео. Ключи SRTP выводятся из рукопожатия DTLS (DTLS-SRTP, RFC 5764), сами пакеты RTP идут мимо DTLS.' },
  { k: 'роли', v: 'звонящий — `server`, отвечающий — `client`', d: 'Из `setup`: offer — `actpass`, answer — `active`, значит рукопожатие начинает отвечающий. Роль ICE — своя: звонящий controlling.' },
];

export const ENCRYPTION_NOTE =
  'Выключить шифрование нельзя. В API нет такого параметра, а описание без `a=fingerprint` браузер отвергает: `InvalidAccessError … SDP without DTLS fingerprint`. Незашифрованного WebRTC между браузерами не бывает. Сервер TURN, через который идут пакеты, видит только зашифрованные байты.';

export const BADFP_NOTE =
  'Сценарий «чужой отпечаток»: сервер сигнализации поменял первый байт отпечатка в offer. ICE отработал, пара выбрана — а `dtlsState` у обеих сторон `failed`, и следом `connectionState` стал `failed`. Сертификат звонящего не совпал с тем, что отвечающий прочитал в SDP. Подмена отпечатка без подмены сертификата ломает звонок; подмена обоих — это уже человек посередине, и защита от него — надёжный канал сигнализации.';

// ─── Раздел 6. Каналы данных и медиа ───────────────────────────────────────────────────────

export const CHANNEL_STACK = [
  { label: 'ваши сообщения', tone: 'ink' as const },
  { label: 'SCTP: потоки, порядок, повторы', tone: 'info' as const },
  { label: 'DTLS: шифрование', tone: 'warn' as const },
  { label: 'ICE: пара адресов, UDP', tone: 'ok' as const },
];

export const MEDIA_STACK = [
  { label: 'кадры звука и видео', tone: 'ink' as const },
  { label: 'RTP → SRTP (ключи из DTLS)', tone: 'warn' as const },
  { label: 'ICE: та же пара адресов', tone: 'ok' as const },
];

export const CHANNELS_CODE = `const chat = pc1.createDataChannel('chat');   // по умолчанию: по порядку и без потерь
const pos = pc1.createDataChannel('pos', { ordered: false, maxRetransmits: 0 });`;

export const CHANNEL_ROWS: { k: string; chat: string; pos: string }[] = [
  { k: '`ordered`', chat: '`true`', pos: '`false` — сообщения могут прийти не по порядку' },
  { k: '`maxRetransmits`', chat: '`null` — повторять, пока не дойдёт', pos: '`0` — не повторять: потерялось, и ладно' },
  { k: '`maxPacketLifeTime`', chat: '`null`', pos: '`null` (можно вместо `maxRetransmits`: «повторять не дольше N мс»)' },
  { k: '`id` — номер потока SCTP', chat: '`1`', pos: '`3`' },
];

export const CHANNEL_NOTE =
  'Оба канала живут в одном соединении SCTP — это разные потоки, и потеря в `pos` не задерживает `chat`. Номера нечётные: по RFC 8832 нечётные потоки открывает сторона, которая в DTLS сервер, — здесь это создатель каналов. Самое большое сообщение — `max-message-size` из SDP, у Chromium 262 144 байта: на один байт больше — `TypeError` прямо в `send`.';

export const MEDIA_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Кодек выбирают по SDP',
    d: 'Отвечающий оставил в answer те же форматы, а отправитель взял первый общий: `getStats` показал `audio/opus` (тип 111) и `video/VP8` (тип 96) — по первому номеру каждой секции offer.',
  },
  {
    t: 'Медиа не ждёт потерянного',
    d: 'Пакет RTP, который не дошёл, обычно не повторяют: опоздавший кадр звука бесполезен. Для видео есть точечные просьбы — `nack`, `pli` в `a=rtcp-fb` — повторить один пакет или прислать опорный кадр.',
  },
  {
    t: 'Всё по одной паре',
    d: 'Звук, видео и каналы данных стенда шли по одной паре адресов: `a=group:BUNDLE 0 1 2`. До ответа звонящий собирал кандидатов на каждую секцию — три host с одной `foundation`, — а после ответа остался один транспорт.',
    tone: 'warn',
  },
];

export const VS_WEBSOCKET =
  'Канал данных — не замена WebSocket. Он нужен там, где данные идут между браузерами напрямую: игра на двоих, передача файла, курсоры в общем редакторе. Если собеседник — ваш сервер, то WebSocket или WebTransport проще: не нужны ни сигнализация, ни ICE, ни TURN. Их сравнение — в [«Долгих соединениях», раздел «HTTP/2, HTTP/3 и WebTransport»](/platform/realtime/#s7).';

// ─── Раздел 7. getStats ────────────────────────────────────────────────────────────────────

export const STATS_INTRO =
  '`getStats()` — единственный способ узнать, что на самом деле соединилось. Отчёт — словарь объектов с полями `id` и `type`, связанных ссылками: транспорт указывает на выбранную пару, пара — на два кандидата.';

export const STATS_CODE = `// Что соединилось: транспорт → выбранная пара → её кандидаты.
async function connectionSummary(pc) {
  return summarize([...(await pc.getStats()).values()]);
}

function summarize(stats) {
  const byId = new Map(stats.map((s) => [s.id, s]));
  const transport = stats.find((s) => s.type === 'transport');
  const pair = byId.get(transport?.selectedCandidatePairId);
  const result = { ice: transport?.iceState ?? 'new', dtls: transport?.dtlsState ?? 'new' };
  if (!pair) return { ...result, path: null, viaTurn: false };
  const local = byId.get(pair.localCandidateId);
  const remote = byId.get(pair.remoteCandidateId);
  return {
    ...result,
    path: local.candidateType + ' → ' + remote.candidateType,
    viaTurn: local.candidateType === 'relay' || remote.candidateType === 'relay',
    tlsVersion: transport.tlsVersion ?? null,   // 'FEFC' — DTLS 1.3
  };
}`;

export const STATS_ROWS: { id: string; k: string; ice: string; dtls: string; path: string; turn: string }[] = [
  { id: 'host', k: 'Одна сеть', ice: 'connected', dtls: 'connected', path: 'host → host', turn: 'нет' },
  { id: 'stun', k: 'STUN', ice: 'connected', dtls: 'connected', path: 'host → host', turn: 'нет' },
  { id: 'relay', k: 'Только TURN', ice: 'connected', dtls: 'connected', path: 'relay → relay', turn: 'да' },
  { id: 'symturn', k: 'NAT + TURN', ice: 'connected', dtls: 'connected', path: 'host → relay', turn: 'да' },
  { id: 'symmetric', k: 'NAT без TURN', ice: 'failed', dtls: 'new', path: '—', turn: 'нет' },
  { id: 'norelay', k: 'relay без сервера', ice: 'new', dtls: 'new', path: '—', turn: 'нет' },
  { id: 'badfp', k: 'Чужой отпечаток', ice: 'connected', dtls: 'failed', path: 'host → host', turn: 'нет' },
];

export const STATS_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Адрес кандидата в отчёте пуст',
    d: 'У host с именем mDNS `getStats` отдаёт `address: \'\'` — имени нет, адреса тоже. Тип, порт и приоритет на месте.',
  },
  {
    t: 'Что ещё лежит в отчёте',
    d: '`outbound-rtp` и `inbound-rtp` — пакеты, байты, кадры; `codec` — выбранный кодек; `data-channel` — сообщения и байты по каждому каналу; `certificate` — сертификаты и отпечатки.',
  },
  {
    t: 'Числа приоритетов — уже не целые',
    d: 'Приоритет пары достигает 2^63, а `getStats` отдаёт его обычным числом JS: 9079290933572287998 превращается в 9079290933572287000. Сравнивать можно, восстанавливать младшие разряды — нет.',
    tone: 'warn',
  },
];

export const TAKEAWAY =
  '**WebRTC делает соединение, но не знакомит.** Описания и кандидатов передаёте вы — своим сервером. Дальше ICE перебирает пары адресов, и прямой путь находится не всегда: за двумя симметричными NAT нужен TURN. А что получилось на деле — показывает только `getStats`: `connectionState`, выбранная пара и её типы.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Пробы `probe-edge.mjs` дословно. */
export const PROBES = {
  earlyCandidate:
    "InvalidStateError: Failed to execute 'addIceCandidate' on 'RTCPeerConnection': The remote description was null",
  glare: 'have-remote-offer',
  maxMessageSize: 262144,
  tooBig: "TypeError: Failed to execute 'send' on 'RTCDataChannel': Trying to send message larger than max-message-size",
  insecure: { isSecure: false, rtc: 'function', mediaDevices: 'undefined' },
  noFingerprint:
    "InvalidAccessError: Failed to execute 'setRemoteDescription' on 'RTCPeerConnection': Failed to set remote offer sdp: Called with SDP without DTLS fingerprint.",
};

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Без TURN часть звонков не соединится никогда',
    d: 'В офисе и дома всё работает: одна сеть или конусный NAT. За двумя симметричными NAT и в сетях, где закрыт UDP, проверки не доходят, и звонок просто становится `failed` — на стенде примерно через 15 секунд. STUN этого не лечит: он только сообщает адрес. Для продакшена TURN обязателен — и лучше с вариантом по TCP или TLS на 443.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Смотрите на `connectionState`, а не на `iceConnectionState`',
    d: 'В сценарии «NAT без TURN» `iceConnectionState` остановился на `disconnected`, а `connectionState` и `iceState` транспорта стали `failed`. В сценарии с чужим отпечатком ICE — `connected`, а звонка нет: сломался DTLS. Только `connectionState` учитывает оба слоя.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Кандидат раньше описания — ошибка',
    d: '`addIceCandidate` до `setRemoteDescription` бросает `InvalidStateError: The remote description was null`. С trickle кандидат может обогнать answer — например, если описание обрабатывается асинхронно. Кандидатов до описания складывают в очередь.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Встречные offer молча отменяют ваш',
    d: 'Если обе стороны сделали offer одновременно, `setRemoteDescription(чужой offer)` в Chromium не бросает ошибку, а тихо откатывает свой: состояние `have-remote-offer`. Сделают так обе — обе станут отвечающими. Принятый приём — perfect negotiation: одна сторона «вежливая» и уступает, другая встречный offer игнорирует.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`relay` без серверов — тишина',
    d: '`iceTransportPolicy: \'relay\'` с пустым `iceServers` (или с неверным паролем TURN) не даёт ни одного кандидата. Ошибки нет, `connectionState` вечно `new`. Сбор завершился — и всё.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Пароль TURN в коде страницы виден всем',
    d: 'TURN пересылает чужой трафик за ваш счёт, и пароль из `iceServers` прочитает любой посетитель. Выдавайте короткоживущие учётные данные с сервера — например, имя с меткой времени и HMAC от него, как в черновике «TURN REST API», который поддерживают coturn и облачные TURN.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Канал данных принимает не больше `max-message-size`',
    d: 'У Chromium — 262 144 байта, на байт больше — `TypeError` в `send`. Файлы режут на куски и следят за `bufferedAmount`: `send` не ждёт отправки, а копит очередь в памяти.',
  },
  {
    n: '08',
    t: 'В логах — `.local`, а не адрес',
    d: 'Host-кандидаты Chromium приходят с именами mDNS. В сети, где multicast закрыт (часть корпоративных и гостевых Wi-Fi), соседи по сети не разрешат имя — прямое соединение внутри сети не случится, и звонок уйдёт на srflx или relay.',
  },
  {
    n: '09',
    t: '`RTCPeerConnection` есть и на `http://`',
    d: 'На `http://rtc.test` стенда `isSecureContext` ложь, но `RTCPeerConnection` есть, а `navigator.mediaDevices` — нет. Каналы данных работают где угодно; камера и микрофон — только в безопасном контексте.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  { title: 'W3C — WebRTC: Real-Time Communication in Browsers', href: 'https://www.w3.org/TR/webrtc/', what: '`RTCPeerConnection`, состояния, `setLocalDescription` без аргумента, `iceTransportPolicy`, `RTCDataChannel`, неявный откат offer' },
  { title: 'RFC 8445 — ICE', href: 'https://www.rfc-editor.org/rfc/rfc8445', what: 'типы кандидатов, формулы приоритета кандидата и пары, проверки связности, controlling и nominated' },
  { title: 'RFC 8838 — Trickle ICE', href: 'https://www.rfc-editor.org/rfc/rfc8838', what: 'кандидаты по одному после описания, `a=ice-options:trickle`' },
  { title: 'RFC 8829 — JSEP', href: 'https://www.rfc-editor.org/rfc/rfc8829', what: 'как браузер строит offer и answer, BUNDLE, порт `9` и `0.0.0.0` в SDP' },
  { title: 'RFC 8866 — SDP', href: 'https://www.rfc-editor.org/rfc/rfc8866', what: 'строки `v=`, `o=`, `m=`, `a=`' },
  { title: 'RFC 8489 — STUN и RFC 8656 — TURN', href: 'https://www.rfc-editor.org/rfc/rfc8656', what: 'Binding, XOR-MAPPED-ADDRESS, Allocate с 401, CreatePermission, ChannelBind, ChannelData — то, что реализовал сервер стенда' },
  { title: 'RFC 8827 — WebRTC Security Architecture', href: 'https://www.rfc-editor.org/rfc/rfc8827', what: 'обязательное шифрование, отпечаток в SDP и доверие к сигнализации' },
  { title: 'RFC 5764 — DTLS-SRTP', href: 'https://www.rfc-editor.org/rfc/rfc5764', what: 'ключи SRTP из рукопожатия DTLS' },
  { title: 'RFC 8831 и RFC 8832 — каналы данных и DCEP', href: 'https://www.rfc-editor.org/rfc/rfc8831', what: 'SCTP поверх DTLS, надёжность и порядок, чётные и нечётные номера потоков' },
  { title: 'IETF draft-ietf-mmusic-mdns-ice-candidates', href: 'https://datatracker.ietf.org/doc/draft-ietf-mmusic-mdns-ice-candidates/', what: 'имена `.local` вместо локальных адресов' },
  { title: 'W3C — Identifiers for WebRTC\'s Statistics API', href: 'https://www.w3.org/TR/webrtc-stats/', what: 'типы объектов `getStats`: transport, candidate-pair, local-candidate, codec, data-channel' },
  { title: 'MDN — Perfect negotiation', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation', what: 'вежливая и невежливая стороны при встречных offer' },
];

export const RELATED =
  'Смежное на сайте: [Долгие соединения, раздел «Рукопожатие»](/platform/realtime/#s2) — WebSocket, по которому шла сигнализация. [Долгие соединения, раздел «HTTP/2, HTTP/3 и WebTransport»](/platform/realtime/#s7) — когда собеседник ваш сервер. [Сеть и кеширование, раздел «Транспорт и RTT-бюджет»](/platform/network/#s1) — TCP, UDP, TLS и QUIC. [Безопасность фронтенда, раздел «Origin и правило одного источника»](/platform/security/#s1) — безопасный контекст, без которого нет камеры.';
