import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AuthServer, DnsRecord, DemoQuery, RolloutScenario, Zone } from '@/widgets/dns-lab/model/types';

/**
 * Данные темы «DNS: от имени до адреса и как он влияет на выкатку».
 *
 * Тема написана здесь, 2026-10-02, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0 (c-ares 1.34.5, libuv 1.51.0), `dns-packet` 5.6.1 из `node_modules` проекта,
 * DiG 9.10.6 (macOS), октябрь 2026. Своя маленькая «интернет-иерархия» на 127.0.0.1:
 *   — четыре авторитетных сервера на `node:dgram`, каждый — функция `AUTH_CODE` над своими
 *     зонами из `ZONES`: корень `.` (порт 5070), `test.` (5071), `shop.test.` (5072),
 *     `cdnhost.test.` и `cdn.test.` на одном сервере (5074);
 *   — рекурсивный резолвер на 5073: `RESOLVER_CODE` за UDP-сокетом, время виртуальное.
 * Адреса серверов в зонах — из документационного диапазона 192.0.2.0/24 (RFC 5737); стенд
 * переводит адрес в порт на 127.0.0.1. Причина: на macOS из всей сети 127/8 настроен только
 * 127.0.0.1, а DNS ходит на порт 53 без выбора — значит, три сервера на одном адресе можно
 * различить только портами. Поэтому `dig +trace` (он шлёт все запросы на один порт) здесь не
 * воспроизводится, и цепочка снята тем же, что делает `+trace` внутри, — `dig +norec` по
 * шагам к каждому серверу (`DIG_STEPS`).
 *
 * Пакеты ответов пишет кодировщик стенда со сжатием имён (`tests/unit/dns.test.ts`):
 * `dns-packet` 5.6.1 при записи имена **не сжимает** — проверено: тот же ответ он пишет в 111
 * байт против 72. Разбирает пакеты `dns-packet` и `dig`; учебный `PARSE_CODE` сверяется
 * с `dns-packet` на каждом пакете стенда.
 *
 * Сняты запуском и пересобираются тестом: вывод `dig` (`DIG_*`, номер запроса заменён на 4242,
 * строки со временем и адресом сервера убраны), байты пакета (`PACKET_HEX`, `PACKET_ROWS`),
 * размеры со сжатием и без, ответы `dns.promises.Resolver` (`NODE_RESOLVE_OUT`), порядок
 * колбэков при занятом пуле (`POOL_PROBE_OUT`, `UV_THREADPOOL_SIZE=2`, плюс прогоны при 4),
 * числа сценариев смены адреса (`ROLLOUT_SCENARIOS`). Найдено запуском: `Resolver` в Node
 * 24.11 ничего не кеширует — три `resolve4` подряд дают три запроса на сервер; тип `HTTPS`
 * Node не принимает (`ERR_INVALID_ARG_VALUE`), `dig` 9.10.6 печатает его как `TYPE65`.
 *
 * Разовый запрос к публичному резолверу (1.1.1.1, `example.com A`) сделан один раз для
 * иллюстрации сжатия — и в тему **не взят**: ответ пришёл без сжатия, с TTL ровно 86400,
 * а `dig +trace` из той же сети оборвался на корне (40 байт от e.root-servers.net). Похоже,
 * DNS в этой сети перехватывается по дороге; настоящим такой ответ считать нельзя.
 *
 * ── Только по документации, без запуска ─────────────────────────────────────────────────
 *   — формат записи HTTPS (RFC 9460, §2.2 и §7.1.1): байты `HTTPS_RDATA` собраны по тексту
 *     RFC, тестовые векторы приложения D не сверялись (сайт RFC со стенда недоступен);
 *   — ALIAS, ANAME, CNAME flattening — по документации Cloudflare, AWS Route 53, DNSimple;
 *   — кеши ОС (mDNSResponder, systemd-resolved, служба DNS-клиента Windows) и браузера;
 *   — DoH и DoT (RFC 8484, 7858), EDNS(0) и переход на TCP по флагу TC (RFC 6891, 7766);
 *   — Happy Eyeballs (RFC 8305), сортировка адресов `getaddrinfo` (RFC 6724);
 *   — что `getaddrinfo` занимает не больше половины пула libuv — по исходнику libuv, как
 *     и в теме «Цикл событий Node».
 */

// ─── Стенд: зоны и серверы ───────────────────────────────────────────────────────────────

const rr = (name: string, ttl: number, type: string, data: DnsRecord['data']): DnsRecord => ({ name, type, ttl, data });
const soa = (name: string, mname: string, rname: string, minimum: number, ttl: number): DnsRecord =>
  rr(name, ttl, 'SOA', { mname, rname, serial: 2026100201, refresh: 7200, retry: 900, expire: 1209600, minimum });

/**
 * Запись HTTPS (тип 65, RFC 9460) для `shop.test`: `1 . alpn="h3,h2"` в байтах.
 * `dns-packet` 5.6.1 этот тип не знает, поэтому данные лежат готовыми байтами.
 */
export const HTTPS_RDATA = '0001' + '00' + '0001' + '0006' + '026833' + '026832';

export const ZONES: Zone[] = [
  {
    origin: '.',
    records: [
      soa('.', 'a.root.test', 'admin.root.test', 86400, 86400),
      rr('.', 518400, 'NS', 'a.root.test'),
      rr('test', 172800, 'NS', 'ns1.nic.test'),
      rr('ns1.nic.test', 172800, 'A', '192.0.2.10'),
      rr('a.root.test', 518400, 'A', '192.0.2.1'),
    ],
  },
  {
    origin: 'test',
    records: [
      soa('test', 'ns1.nic.test', 'hostmaster.nic.test', 900, 900),
      rr('test', 172800, 'NS', 'ns1.nic.test'),
      rr('ns1.nic.test', 172800, 'A', '192.0.2.10'),
      rr('shop.test', 3600, 'NS', 'ns1.shop.test'),
      rr('ns1.shop.test', 3600, 'A', '192.0.2.20'),
      rr('cdnhost.test', 3600, 'NS', 'ns1.cdnhost.test'),
      rr('ns1.cdnhost.test', 3600, 'A', '192.0.2.30'),
      rr('cdn.test', 3600, 'NS', 'ns1.cdnhost.test'),
    ],
  },
  {
    origin: 'shop.test',
    records: [
      soa('shop.test', 'ns1.shop.test', 'hostmaster.shop.test', 300, 3600),
      rr('shop.test', 3600, 'NS', 'ns1.shop.test'),
      rr('ns1.shop.test', 3600, 'A', '192.0.2.20'),
      rr('shop.test', 3600, 'A', '203.0.113.10'),
      rr('shop.test', 3600, 'AAAA', '2001:db8::10'),
      rr('shop.test', 3600, 'MX', { preference: 10, exchange: 'mail.shop.test' }),
      rr('shop.test', 3600, 'TXT', ['v=spf1 mx -all']),
      rr('shop.test', 3600, 'HTTPS', HTTPS_RDATA),
      rr('mail.shop.test', 3600, 'A', '203.0.113.25'),
      rr('api.shop.test', 60, 'A', '203.0.113.20'),
      rr('www.shop.test', 300, 'CNAME', 'shop.cdn.test'),
      rr('img.shop.test', 300, 'CNAME', 'www.shop.test'),
    ],
  },
  {
    origin: 'cdnhost.test',
    records: [
      soa('cdnhost.test', 'ns1.cdnhost.test', 'ops.cdnhost.test', 60, 3600),
      rr('cdnhost.test', 3600, 'NS', 'ns1.cdnhost.test'),
      rr('ns1.cdnhost.test', 3600, 'A', '192.0.2.30'),
    ],
  },
  {
    origin: 'cdn.test',
    records: [
      soa('cdn.test', 'ns1.cdnhost.test', 'ops.cdnhost.test', 60, 3600),
      rr('cdn.test', 3600, 'NS', 'ns1.cdnhost.test'),
      rr('shop.cdn.test', 20, 'A', '203.0.113.50'),
      rr('shop.cdn.test', 20, 'A', '203.0.113.51'),
    ],
  },
];

/** Кто какие зоны держит. Адреса — из документационного диапазона 192.0.2.0/24; на стенде каждый — свой порт на 127.0.0.1. */
export const SERVERS: AuthServer[] = [
  { ip: '192.0.2.1', name: 'a.root.test', zones: ['.'], port: 5070 },
  { ip: '192.0.2.10', name: 'ns1.nic.test', zones: ['test'], port: 5071 },
  { ip: '192.0.2.20', name: 'ns1.shop.test', zones: ['shop.test'], port: 5072 },
  { ip: '192.0.2.30', name: 'ns1.cdnhost.test', zones: ['cdnhost.test', 'cdn.test'], port: 5074 },
];

/** Рекурсивный резолвер стенда: учебный `createResolver` за UDP-сокетом. */
export const RESOLVER_PORT = 5073;

/** Подсказка корня: резолвер знает адрес корневого сервера заранее, из конфигурации. */
export const ROOT_HINTS = ['192.0.2.1'];

// ─── Авторитетный сервер ──────────────────────────────────────────────────────────────────

export const AUTH_CODE = `// Авторитетный сервер: отвечает только из своих зон и никого не спрашивает сам.
// Порядок — алгоритм из RFC 1034, раздел 4.3.2, без DNSSEC и звёздочек.
function answer(zones, name, type) {
  const under = (n, zone) => zone === '.' || n === zone || n.endsWith('.' + zone);
  const reply = (aa, rcode, answers, authorities = [], additionals = []) =>
    ({ aa, rcode, answers, authorities, additionals });

  // 1. Самая глубокая из своих зон, в которой лежит имя
  const zone = zones
    .filter((z) => under(name, z.origin))
    .sort((a, b) => b.origin.length - a.origin.length)[0];
  if (!zone) return reply(false, 'REFUSED', []);
  const at = (n, t) => zone.records.filter((r) => r.name === n && r.type === t);

  // 2. Делегирование: NS ниже вершины зоны на пути к имени.
  //    Ответ — «не знаю, спросите их» (AA = 0), адреса NS внутри
  //    делегированной зоны прикладываются как glue
  const cut = zone.records
    .filter((r) => r.type === 'NS' && r.name !== zone.origin && under(name, r.name))
    .sort((a, b) => a.name.length - b.name.length)[0];
  if (cut) {
    const ns = at(cut.name, 'NS');
    const glue = ns.flatMap((r) =>
      under(r.data, cut.name) ? [...at(r.data, 'A'), ...at(r.data, 'AAAA')] : []);
    return reply(false, 'NOERROR', [], ns, glue);
  }

  // 3. Своё имя: запись нужного типа, иначе CNAME — и по нему дальше,
  //    пока цель лежит в этой же зоне
  const answers = [];
  let cur = name;
  for (;;) {
    const exact = at(cur, type);
    if (exact.length) return reply(true, 'NOERROR', [...answers, ...exact]);
    const alias = type === 'CNAME' ? [] : at(cur, 'CNAME');
    if (!alias.length) break;
    answers.push(alias[0]);
    cur = alias[0].data;
    if (!under(cur, zone.origin)) return reply(true, 'NOERROR', answers);
  }

  // 4. Подходящего нет. Имя существует — NODATA, нет — NXDOMAIN.
  //    В обоих случаях SOA: её TTL и поле minimum задают срок отрицательного кеша
  const exists = zone.records.some((r) => r.name === cur || r.name.endsWith('.' + cur));
  const soa = at(zone.origin, 'SOA').map((r) => ({ ...r, ttl: Math.min(r.ttl, r.data.minimum) }));
  return reply(true, exists ? 'NOERROR' : 'NXDOMAIN', answers, soa);
}`;

// ─── Итеративный резолвер ─────────────────────────────────────────────────────────────────

export const RESOLVER_CODE = `// Итеративный резолвер. send(ip, name, type) — один запрос без RD к одному серверу,
// now() — время в секундах (в демо и тесте виртуальное).
function createResolver({ roots, send, now }) {
  const cache = new Map(); // "имя|ТИП" → { records } или { negative, soa }, и срок expires
  const log = [];          // каждый вопрос к серверу и каждое попадание в кеш
  const key = (name, type) => name + '|' + type;

  function get(name, type) {
    const hit = cache.get(key(name, type));
    if (!hit) return null;
    const left = hit.expires - now();
    if (left <= 0) { cache.delete(key(name, type)); return null; }
    // из кеша запись выходит с остатком срока, а не с исходным TTL
    return hit.records ? { records: hit.records.map((r) => ({ ...r, ttl: left })) } : hit;
  }

  function remember(records) {
    const groups = Map.groupBy(records, (r) => key(r.name, r.type));
    for (const [k, rs] of groups) {
      // набор записей одного имени и типа живёт по самому короткому TTL
      const ttl = Math.min(...rs.map((r) => r.ttl));
      cache.set(k, { key: k, records: rs, expires: now() + ttl });
    }
  }

  // Отказ тоже кешируется: NXDOMAIN — на имя целиком, NODATA — на имя и тип.
  // Срок по RFC 2308 — меньшее из TTL записи SOA и её поля minimum
  function rememberNegative(name, kind, soa) {
    const k = key(name, kind);
    const ttl = Math.min(soa.ttl, soa.data.minimum);
    cache.set(k, { key: k, negative: kind === 'NXDOMAIN' ? kind : 'NODATA', soa, expires: now() + ttl });
  }

  // С чего начать: самая глубокая зона-предок, чьи NS и их адреса уже в кеше
  function closest(name) {
    const labels = name === '.' ? [] : name.split('.');
    for (let i = 0; i < labels.length; i++) {
      const zone = labels.slice(i).join('.');
      const ns = get(zone, 'NS');
      const ips = (ns?.records ?? []).flatMap((r) => get(r.data, 'A')?.records ?? []);
      if (ips.length) return { zone, ips: ips.map((r) => r.data) };
    }
    return { zone: '.', ips: roots };
  }

  // Один вопрос до конца: от ближайшей известной зоны вниз по делегированиям
  async function iterate(name, type, depth) {
    let { zone, ips } = closest(name);
    for (let step = 0; step < 16; step++) {
      const res = await send(ips[0], name, type);
      const entry = { depth, ip: ips[0], zone, name, type };
      log.push(entry);
      if (res.rcode !== 'NOERROR' && res.rcode !== 'NXDOMAIN') throw new Error(ips[0] + ': ' + res.rcode);
      const soa = res.authorities.find((r) => r.type === 'SOA');
      remember(res.answers);
      if (res.rcode === 'NXDOMAIN') {
        entry.result = 'NXDOMAIN';
        rememberNegative(res.answers.at(-1)?.data ?? name, 'NXDOMAIN', soa);
        return res;
      }
      if (res.answers.length) { entry.result = 'answer'; return res; }
      const ns = res.authorities.filter((r) => r.type === 'NS');
      if (res.aa || !ns.length) {
        entry.result = 'NODATA';
        rememberNegative(name, type, soa);
        return res;
      }
      // Делегирование: запоминаем NS и glue, идём на уровень ниже
      remember(ns);
      remember(res.additionals);
      zone = ns[0].name;
      entry.result = 'referral';
      entry.to = zone;
      ips = ns.flatMap((r) =>
        res.additionals.filter((a) => a.type === 'A' && a.name === r.data).map((a) => a.data));
      if (!ips.length) {
        // glue нет: NS живёт в чужой зоне, его адрес — отдельный поиск с корня
        entry.noGlue = ns[0].data;
        const found = await resolve(ns[0].data, 'A', depth + 1);
        ips = found.answers.filter((r) => r.type === 'A').map((r) => r.data);
      }
    }
    throw new Error('слишком длинная цепочка делегирований');
  }

  async function resolve(name, type, depth = 0) {
    const answers = [];
    for (let hop = 0; hop < 8; hop++) {
      const fromCache = (result) => log.push({ depth, cache: true, name, type, result });
      if (get(name, 'NXDOMAIN')) { fromCache('NXDOMAIN'); return { rcode: 'NXDOMAIN', answers }; }
      const hit = get(name, type);
      if (hit?.records) { fromCache('answer'); return { rcode: 'NOERROR', answers: [...answers, ...hit.records] }; }
      if (hit?.negative) { fromCache('NODATA'); return { rcode: 'NOERROR', answers }; }
      const alias = type !== 'CNAME' && get(name, 'CNAME');
      if (alias) { fromCache('answer'); answers.push(...alias.records); name = alias.records[0].data; continue; }

      const res = await iterate(name, type, depth);
      // Идём по CNAME внутри ответа, пока он ведёт к нужной записи
      let cur = name;
      for (;;) {
        const exact = res.answers.filter((r) => r.name === cur && r.type === type);
        if (exact.length) return { rcode: 'NOERROR', answers: [...answers, ...exact] };
        const next = res.answers.find((r) => r.name === cur && r.type === 'CNAME');
        if (!next) break;
        answers.push(next);
        cur = next.data;
      }
      if (res.rcode === 'NXDOMAIN') return { rcode: 'NXDOMAIN', answers };
      if (cur === name) return { rcode: 'NOERROR', answers };
      name = cur; // цепочка ушла в чужую зону: ищем цель с начала
    }
    throw new Error('слишком длинная цепочка CNAME');
  }

  return { resolve, log, cache };
}`;

/** Запись в виде строки зоны — так её печатает `dig`: имя с точкой, TTL, класс, тип, данные. */
export function zoneLine(r: DnsRecord): string {
  const fq = (n: string) => (n === '.' ? '.' : `${n}.`);
  const d = r.data;
  let data: string;
  if (r.type === 'HTTPS') data = '1 . alpn="h3,h2"';
  else if (r.type === 'NS' || r.type === 'CNAME') data = fq(String(d));
  else if (Array.isArray(d)) data = d.map((x) => `"${x}"`).join(' ');
  else if (typeof d === 'string') data = d;
  else if ('exchange' in d) data = `${d.preference} ${fq(d.exchange)}`;
  else data = `${fq(d.mname)} ${fq(d.rname)} ${d.serial} ${d.refresh} ${d.retry} ${d.expire} ${d.minimum}`;
  return `${fq(r.name).padEnd(18)} ${String(r.ttl).padStart(6)}  IN  ${r.type.padEnd(5)}  ${data}`;
}

const zoneOf = (origin: string) => ZONES.find((z) => z.origin === origin) as Zone;
const zoneText = (origin: string, title: string) =>
  [`; ${title}`, ...zoneOf(origin).records.map(zoneLine)].join('\n');

export const ZONE_ROOT_TEXT = zoneText('.', 'корень «.» — сервер a.root.test, 192.0.2.1');
export const ZONE_TLD_TEXT = zoneText('test', 'зона test. — сервер ns1.nic.test, 192.0.2.10');
export const ZONE_SHOP_TEXT = zoneText('shop.test', 'зона shop.test. — сервер ns1.shop.test, 192.0.2.20');
export const ZONE_CDN_TEXT = [
  zoneText('cdnhost.test', 'зоны cdnhost.test. и cdn.test. — один сервер ns1.cdnhost.test, 192.0.2.30'),
  ...zoneOf('cdn.test').records.map(zoneLine),
].join('\n');

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'зона',
    d: 'Кусок пространства имён, за который отвечает один владелец: `shop.test.` и всё под ним, кроме того, что он отдал другим. Записи зоны лежат на её **авторитетных** серверах.',
  },
  {
    k: 'авторитетный сервер',
    d: 'Сервер, который отвечает за зону из первых рук: его ответ — это и есть правда о зоне. Других он не спрашивает. В ответе стоит флаг **AA** (authoritative answer).',
  },
  {
    k: 'рекурсивный резолвер',
    d: 'Сервер провайдера, компании или публичный (1.1.1.1, 8.8.8.8). Получает вопрос «какой адрес у имени» и сам обходит авторитетные серверы, а ответы складывает в кеш.',
  },
  {
    k: 'stub-резолвер',
    d: 'Маленький клиент DNS в ОС или в программе. Сам ничего не обходит: шлёт вопрос с флагом **RD** («сделай за меня») рекурсивному резолверу и ждёт готовый ответ.',
  },
  {
    k: 'делегирование и NS',
    d: 'Запись NS в родительской зоне: «зоной `shop.test.` заведует сервер `ns1.shop.test`». Родитель отвечает на вопросы про чужую зону не данными, а ссылкой на её серверы.',
  },
  {
    k: 'TTL',
    d: 'Time to live — сколько секунд ответ можно держать в кеше. Ставит владелец записи. Кеш по дороге отдаёт запись с **остатком** срока, а когда срок вышел, спрашивает заново.',
  },
  {
    k: 'SOA',
    d: 'Служебная запись на вершине зоны: главный сервер, контакт, серийный номер. Её последнее поле `minimum` сегодня значит одно — сколько кешировать ответ «такого нет».',
  },
  {
    k: 'NXDOMAIN и NODATA',
    d: 'Два разных «нет». NXDOMAIN — имени не существует вообще. NODATA — имя есть, но записи нужного типа у него нет (например, у `api.shop.test` нет IPv6-адреса).',
  },
];

export const PLAIN_DNS =
  'Как справочная, которая не знает ничего, кроме того, у кого спросить. Вы звоните знакомому (рекурсивный резолвер). Он звонит в общую справочную (корень): «Про `test` спросите вот по этому номеру». Там отвечают: «Про `shop.test` — вот номер их секретаря». Секретарь (авторитетный сервер) называет адрес. Знакомый записывает всё услышанное на бумажку со сроком годности (TTL) — и следующий раз отвечает сразу, без звонков.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем. Сам DNS, его пакеты и кеши разобраны здесь с нуля.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'IP-адрес, UDP и круг «туда и обратно»',
    d: 'Соединение открывают не с именем, а с IP-адресом и портом. Каждый вопрос по сети стоит круг туда и обратно (RTT), и DNS-запрос — первый такой круг при заходе на новый домен.',
    href: '/platform/network/#s1',
    hrefLabel: '«Сеть и кеширование», раздел «Транспорт и RTT-бюджет»',
    tone: 'info',
  },
  {
    t: 'Балансировщик и проверки здоровья',
    d: 'Несколько копий сервиса за одним адресом. Балансировщик сам видит, какая копия больна, и не шлёт на неё запросы. У DNS такого знания нет, и это важно для раздела про выкатку.',
    href: '/delivery/load-balancing/#s5',
    hrefLabel: '«Балансировка нагрузки», раздел «Проверки здоровья»',
    tone: 'info',
  },
  {
    t: 'Пул потоков libuv',
    d: 'Node выполняет блокирующие системные вызовы — файлы, хеши, `getaddrinfo` — в пуле из четырёх потоков. Когда пул занят, новые задачи ждут в очереди.',
    href: '/js/node-event-loop/#s6',
    hrefLabel: '«Цикл событий Node», раздел «Пул потоков»',
    tone: 'info',
  },
];

// ─── Путь запроса ────────────────────────────────────────────────────────────────────────

export const PATH_CHIPS = [
  { label: 'браузер / Node', tone: 'ink' as const },
  { label: 'stub-резолвер ОС', tone: 'ink' as const },
  { label: 'рекурсивный резолвер', tone: 'info' as const },
  { label: 'корень «.»', tone: 'warn' as const },
  { label: 'test.', tone: 'warn' as const },
  { label: 'shop.test.', tone: 'ok' as const },
];

export const PATH_NOTE =
  'Stub-резолвер задаёт один вопрос и получает готовый ответ. Всю работу делает рекурсивный резолвер: он начинает с корня, адрес которого знает из конфигурации, и спускается по зонам. Каждый уровень либо отвечает, либо говорит «не моё, спросите их» — это **делегирование**. Авторитетные серверы никого не спрашивают сами: они отвечают только про свои зоны.';

export const ZONES_NOTE =
  'Пример на всю тему — маленький интернет из четырёх серверов. Корень делегирует `test.`, тот — магазин `shop.test.` и две зоны CDN-провайдера. У магазина есть адрес на вершине зоны, почта, псевдоним `www` на CDN и `img` — псевдоним на `www`. Адреса — из диапазонов, отведённых под документацию: `192.0.2.0/24` у серверов, `203.0.113.0/24` у сайтов.';

export const PLAIN_GLUE =
  'Ссылка «зоной `shop.test` заведует `ns1.shop.test`» сама по себе бесполезна: чтобы узнать адрес `ns1.shop.test`, надо спросить… сервер зоны `shop.test`. Замкнутый круг. Поэтому родитель кладёт в ответ ещё и адрес этого сервера — **glue**, «клей». Это как визитка, на которой рядом с именем секретаря написан и его телефон.';

/** `dig +norec` к каждому серверу по очереди — то, что делает `dig +trace`. */
export const DIG_STEPS: { t: string; cmd: string; out: string; d: string }[] = [
  {
    t: 'Корень: «спросите test.»',
    cmd: 'dig @127.0.0.1 -p 5070 +norec www.shop.test',
    out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1

;; AUTHORITY SECTION:
test.			172800	IN	NS	ns1.nic.test.

;; ADDITIONAL SECTION:
ns1.nic.test.		172800	IN	A	192.0.2.10`,
    d: 'Ответов нет, флага `aa` нет. В секции AUTHORITY — кто заведует `test.`, в ADDITIONAL — его адрес (glue). Срок у делегирования TLD — двое суток.',
  },
  {
    t: 'TLD: «спросите shop.test.»',
    cmd: 'dig @127.0.0.1 -p 5071 +norec www.shop.test',
    out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 1

;; AUTHORITY SECTION:
shop.test.		3600	IN	NS	ns1.shop.test.

;; ADDITIONAL SECTION:
ns1.shop.test.		3600	IN	A	192.0.2.20`,
    d: 'Ещё одно делегирование. Сервер `test.` знает про магазин только то, что записал при регистрации домена: имя его DNS-сервера и адрес.',
  },
  {
    t: 'Авторитетный: «это псевдоним»',
    cmd: 'dig @127.0.0.1 -p 5072 +norec www.shop.test',
    out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr aa; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0

;; ANSWER SECTION:
www.shop.test.		300	IN	CNAME	shop.cdn.test.`,
    d: 'Флаг `aa` — ответ из первых рук. Но это не адрес, а CNAME в чужую зону: сервер магазина про `cdn.test.` ничего не знает, и поиск начинается заново.',
  },
  {
    t: 'Снова TLD: делегирование без glue',
    cmd: 'dig @127.0.0.1 -p 5071 +norec shop.cdn.test',
    out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 0

;; AUTHORITY SECTION:
cdn.test.		3600	IN	NS	ns1.cdnhost.test.`,
    d: '`ADDITIONAL: 0`. Сервер `ns1.cdnhost.test` живёт не внутри `cdn.test.`, клеить нечего. Резолвер откладывает вопрос и ищет адрес `ns1.cdnhost.test` отдельно — ещё два запроса.',
  },
  {
    t: 'Сервер CDN: два адреса',
    cmd: 'dig @127.0.0.1 -p 5074 +norec shop.cdn.test',
    out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr aa; QUERY: 1, ANSWER: 2, AUTHORITY: 0, ADDITIONAL: 0

;; ANSWER SECTION:
shop.cdn.test.		20	IN	A	203.0.113.50
shop.cdn.test.		20	IN	A	203.0.113.51`,
    d: 'Наконец адреса — два, с TTL 20 секунд. Короткий срок и несколько адресов — обычная картина у CDN: так он быстро уводит трафик с площадки.',
  },
];

export const DIG_RECURSIVE: { cmd: string; out: string } = {
  cmd: 'dig @127.0.0.1 -p 5073 www.shop.test',
  out: `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
;; flags: qr rd ra; QUERY: 1, ANSWER: 3, AUTHORITY: 0, ADDITIONAL: 0

;; ANSWER SECTION:
www.shop.test.		300	IN	CNAME	shop.cdn.test.
shop.cdn.test.		20	IN	A	203.0.113.50
shop.cdn.test.		20	IN	A	203.0.113.51`,
};

export const DIG_RECURSIVE_NOTE =
  'Тот же вопрос рекурсивному резолверу стенда (порт 5073). Флаги другие: `rd` — клиент просил рекурсию, `ra` — сервер её умеет, а `aa` нет: резолвер пересказывает чужие ответы. За одну строку ответа резолвер сделал **семь** запросов к четырём серверам: три по цепочке до CNAME, два за адресом сервера CDN без glue, два за самим `shop.cdn.test`.';

// ─── Пакет ────────────────────────────────────────────────────────────────────────────────

/** Вопрос резолвера к серверу `shop.test.`: `img.shop.test A`, номер 0x2a17, без RD. */
export const QUERY_HEX = '2a170000000100000000000003696d670473686f7004746573740000010001';

/** Ответ сервера `shop.test.` на этот вопрос, байт в байт со стенда. */
export const PACKET_HEX =
  '2a178400000100020000000003696d670473686f7004746573740000010001c00c000500010000012c000603777777c010c02b000500010000012c000b0473686f700363646ec015';

/** Тот же ответ, записанный `dns-packet` (без сжатия имён). Длина — в тесте. */
export const PACKET_PLAIN_BYTES = 111;

export const PACKET_ROWS: { at: number; hex: string; field: string; value: string; tone?: 'warn' | 'info' }[] = [
  { at: 0, hex: '2a 17', field: 'ID', value: 'номер вопроса; ответ повторяет его, иначе клиент ответ выбросит' },
  { at: 2, hex: '84 00', field: 'флаги', value: '`QR=1` ответ · `AA=1` из первых рук · `RD=0` · `RA=0` · `RCODE=0` (NOERROR)', tone: 'info' },
  { at: 4, hex: '00 01', field: 'QDCOUNT', value: '1 вопрос' },
  { at: 6, hex: '00 02', field: 'ANCOUNT', value: '2 записи в ответе' },
  { at: 8, hex: '00 00', field: 'NSCOUNT', value: '0 в AUTHORITY' },
  { at: 10, hex: '00 00', field: 'ARCOUNT', value: '0 в ADDITIONAL' },
  { at: 12, hex: '03 69 6d 67 04 73 68 6f 70 04 74 65 73 74 00', field: 'вопрос: имя', value: '`3 img 4 shop 4 test 0` — метки с длиной впереди, ноль в конце' },
  { at: 27, hex: '00 01', field: 'вопрос: тип', value: '1 — A' },
  { at: 29, hex: '00 01', field: 'вопрос: класс', value: '1 — IN, интернет' },
  { at: 31, hex: 'c0 0c', field: 'запись 1: имя', value: 'указатель: «имя лежит с байта 12» — `img.shop.test`', tone: 'warn' },
  { at: 33, hex: '00 05 00 01', field: 'тип и класс', value: '5 — CNAME, IN' },
  { at: 37, hex: '00 00 01 2c', field: 'TTL', value: '300 секунд' },
  { at: 41, hex: '00 06', field: 'длина данных', value: '6 байт' },
  { at: 43, hex: '03 77 77 77 c0 10', field: 'данные', value: '`3 www`, затем указатель на байт 16 — `shop.test`: итого `www.shop.test`', tone: 'warn' },
  { at: 49, hex: 'c0 2b', field: 'запись 2: имя', value: 'указатель на байт 43 — на имя внутри данных первой записи', tone: 'warn' },
  { at: 51, hex: '00 05 00 01 00 00 01 2c 00 0b', field: 'тип, класс, TTL, длина', value: 'CNAME, IN, 300, 11 байт' },
  { at: 61, hex: '04 73 68 6f 70 03 63 64 6e c0 15', field: 'данные', value: '`4 shop 3 cdn`, затем указатель на байт 21 — `test`', tone: 'warn' },
];

export const PLAIN_POINTER =
  'Как «см. выше» в документе. Имя `shop.test` уже написано в начале пакета — второй раз его не пишут, а ставят ссылку на место, где оно лежит. Ссылку видно по двум старшим битам байта: метка короче 64 символов, поэтому её длина никогда не начинается с `11`, и `0xC0` и выше означает «дальше не метка, а адрес».';

export const PACKET_NOTE =
  'Из 72 байт ответа имена без сжатия заняли бы на 39 больше: `dns-packet` пишет тот же ответ в 111 байт. Для DNS это не мелочь. Классический UDP-ответ ограничен 512 байтами (RFC 1035); если ответ длиннее, сервер ставит флаг `TC` («обрезано»), и клиент переспрашивает по TCP — ещё один круг и рукопожатие. Расширение EDNS(0) (RFC 6891) позволяет клиенту объявить буфер побольше, обычно около 1232 байт.';

export const PARSE_CODE = `// Разбор пакета DNS: заголовок 12 байт, вопросы, потом записи трёх секций.
function readName(buf, pos) {
  const labels = [];
  let end = -1; // где продолжить чтение после имени
  for (let jumps = 0; ; ) {
    const len = buf[pos];
    if (len === 0) { pos += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      // указатель: 14 бит — смещение от начала пакета
      if (end < 0) end = pos + 2;
      if (++jumps > 32) throw new Error('петля из указателей');
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    labels.push(new TextDecoder().decode(buf.subarray(pos + 1, pos + 1 + len)));
    pos += 1 + len;
  }
  return [labels.length ? labels.join('.') : '.', end < 0 ? pos : end];
}

function parse(buf) {
  const u16 = (p) => (buf[p] << 8) | buf[p + 1];
  const u32 = (p) => u16(p) * 65536 + u16(p + 2);
  const f = u16(2);
  const header = {
    id: u16(0), qr: f >> 15, opcode: (f >> 11) & 15, aa: (f >> 10) & 1, tc: (f >> 9) & 1,
    rd: (f >> 8) & 1, ra: (f >> 7) & 1, rcode: f & 15,
  };
  const [qd, an, ns, ar] = [u16(4), u16(6), u16(8), u16(10)];
  let pos = 12;
  const questions = [];
  for (let i = 0; i < qd; i++) {
    const [name, next] = readName(buf, pos);
    questions.push({ name, type: u16(next), class: u16(next + 2) });
    pos = next + 4;
  }
  const records = [];
  for (let i = 0; i < an + ns + ar; i++) {
    const [name, next] = readName(buf, pos);
    const type = u16(next);
    const start = next + 10;
    const len = u16(next + 8);
    const data =
      type === 2 || type === 5 ? readName(buf, start)[0] // NS, CNAME: имя, может быть сжато
      : type === 1 ? [...buf.subarray(start, start + 4)].join('.')
      : [...buf.subarray(start, start + len)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const section = i < an ? 'answer' : i < an + ns ? 'authority' : 'additional';
    records.push({ section, name, type, ttl: u32(next + 4), data });
    pos = start + len;
  }
  return { header, questions, records };
}`;

// ─── Резолвер ─────────────────────────────────────────────────────────────────────────────

export const RESOLVER_NOTE =
  'Вся рекурсия — два цикла. Внутренний (`iterate`) спускается по делегированиям, пока не получит ответ или отказ. Внешний (`resolve`) идёт по CNAME: если псевдоним увёл в чужую зону, поиск цели начинается заново. Всё, что пришло по дороге, — NS, glue, псевдонимы, отказы — ложится в кеш со своим сроком, и следующий вопрос начинается не с корня, а с самой глубокой зоны, которую резолвер уже знает.';

export const DEMO_QUERIES: DemoQuery[] = [
  { id: 'www', name: 'www.shop.test', type: 'A', label: 'www A' },
  { id: 'img', name: 'img.shop.test', type: 'A', label: 'img A' },
  { id: 'apex', name: 'shop.test', type: 'A', label: 'shop A' },
  { id: 'api6', name: 'api.shop.test', type: 'AAAA', label: 'api AAAA' },
  { id: 'nope', name: 'nope.shop.test', type: 'A', label: 'nope A' },
];

export const DEMO_CAPTION =
  'Резолвер — строка `RESOLVER_CODE`, серверы — `AUTH_CODE` над зонами примера, время виртуальное. Первый вопрос про `www` проходит всю цепочку, а `img`, заданный сразу следом, обходится одним запросом: остальное уже в кеше. Сдвиньте время вперёд — записи с коротким TTL (`shop.cdn.test`, 20 с) протухают первыми, делегирования `test.` живут двое суток. Отказ про `nope` тоже лежит в кеше — пять минут, по полю `minimum` у SOA.';

// ─── TTL и кеш ───────────────────────────────────────────────────────────────────────────

export const CACHE_LEVELS: { k: string; who: string; ttl: string; flush: string; tone?: 'warn' | 'ok' }[] = [
  {
    k: 'браузер',
    who: 'свой кеш имён в сетевом процессе',
    ttl: 'TTL, если браузер спрашивал DNS сам (встроенный резолвер, DoH); через систему TTL не виден, и срок браузер выбирает свой',
    flush: 'в Chrome — `chrome://net-internals/#dns`',
    tone: 'warn',
  },
  {
    k: 'ОС',
    who: 'macOS — mDNSResponder; Windows — служба DNS-клиента; Linux — `systemd-resolved`, если он стоит. Сам glibc ничего не кеширует',
    ttl: 'по TTL ответа',
    flush: '`sudo killall -HUP mDNSResponder`, `ipconfig /flushdns`, `resolvectl flush-caches`',
  },
  {
    k: 'рекурсивный резолвер',
    who: 'провайдер, офис, 1.1.1.1, DNS кластера (CoreDNS)',
    ttl: 'по TTL; многие ограничивают сверху (сутки–неделя) и снизу',
    flush: 'не в ваших руках: у публичных есть формы сброса, у провайдера — нет',
    tone: 'warn',
  },
  {
    k: 'Node',
    who: '`dns.lookup` и `dns.Resolver` — не кешируют ничего',
    ttl: '—: каждый `http.get` по имени — новый вопрос к ОС',
    flush: 'нечего сбрасывать; кеш ставят библиотекой или в агенте',
    tone: 'ok',
  },
];

export const CACHE_NOTE =
  'TTL считается на каждом уровне от момента, когда этот уровень получил ответ. Резолвер отдаёт запись с остатком — в выводе ниже пятнадцать секунд спустя `300` стал `285`, а `20` — `5`. Следующий уровень кладёт к себе этот остаток. Поэтому сумма кешей не длиннее исходного TTL — если каждый уровень честен. Нечестные бывают: кто-то поднимает слишком короткие сроки до своего минимума, а приложение, однажды узнавшее адрес, может держать его, пока живёт.';

export const DIG_TTL = {
  cmd: 'dig @127.0.0.1 -p 5073 +noall +answer www.shop.test   # через 15 секунд',
  out: `www.shop.test.		285	IN	CNAME	shop.cdn.test.
shop.cdn.test.		5	IN	A	203.0.113.50
shop.cdn.test.		5	IN	A	203.0.113.51`,
};

export const PLAIN_NEGATIVE =
  'Отказ тоже запоминают, иначе каждая опечатка в имени гоняла бы резолвер до самого авторитетного сервера. Срок отказа владелец зоны не пишет к каждому несуществующему имени — их бесконечно много. Он один на всю зону и спрятан в записи SOA, которую сервер прикладывает к ответу «нет».';

export const DIG_NEGATIVE = {
  cmd: 'dig @127.0.0.1 -p 5073 +noall +comments +authority nope.shop.test',
  out: `;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 4242
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 1, ADDITIONAL: 0

;; AUTHORITY SECTION:
shop.test.		300	IN	SOA	ns1.shop.test. hostmaster.shop.test. 2026100201 7200 900 1209600 300`,
  later: 'shop.test.		100	IN	SOA	ns1.shop.test. hostmaster.shop.test. 2026100201 7200 900 1209600 300',
};

export const NEGATIVE_NOTE =
  'Срок отказа — меньшее из двух чисел: TTL самой записи SOA (3600) и её последнего поля `minimum` (300), так велит RFC 2308. Сервер сразу кладёт этот минимум в TTL записи — в выводе стоит `300`. Через двести секунд тот же вопрос отвечается из кеша, и TTL уже `100`. Ловушка выкатки: кто-то проверил новое имя **до** того, как вы его создали, — и пять минут его резолвер будет уверенно отвечать «такого нет».';

// ─── CNAME и вершина зоны ────────────────────────────────────────────────────────────────

export const CNAME_NOTE =
  'CNAME говорит: «у этого имени нет своих записей, всё спрашивайте у другого». Буквально **всё**: и адрес, и почту, и TXT. Поэтому рядом с CNAME на том же имени не может стоять ничего другого (RFC 1034, раздел 3.6.2; RFC 2181, раздел 10.1). Цепочка `img → www → shop.cdn.test` стоит запросов: каждый шаг, ушедший в чужую зону, — это новый спуск по делегированиям, если зона ещё не в кеше.';

export const APEX_NOTE =
  'Вершина зоны (apex) — само имя `shop.test`, без `www`. На ней **обязаны** быть SOA и NS: без них зоны нет. А CNAME не терпит соседей. Значит, `shop.test CNAME что-угодно` противоречит правилам, и честный сервер такую зону не загрузит. Отсюда вечная проблема: CDN и хостинги дают **имя** (`shop.cdn.test`), а не адрес, и на `www` его поставить можно, а на голый домен — нет.';

export const APEX_ROWS: { k: string; how: string; who: string; tone?: 'warn' | 'ok' }[] = [
  {
    k: 'A/AAAA на адреса хостинга',
    how: 'Вписать адреса руками. Так GitHub Pages просит указать корень домена.',
    who: 'Работает везде. Сменит хостинг адреса — сайт молча сломается.',
    tone: 'warn',
  },
  {
    k: 'ALIAS / ANAME',
    how: 'Запись у DNS-провайдера, похожая на CNAME. Провайдер сам спрашивает цель и отвечает клиентам её адресами как обычной A.',
    who: 'DNSimple, NS1 и другие. Не стандарт: черновик ANAME в IETF так и не стал RFC.',
  },
  {
    k: 'CNAME flattening',
    how: 'Cloudflare разрешает написать CNAME на вершине в своём интерфейсе, но наружу отдаёт уже адреса цели.',
    who: 'Только пока зона у Cloudflare.',
  },
  {
    k: 'alias-запись Route 53',
    how: 'Ссылка на ресурс AWS (балансировщик, CloudFront, S3). Ответ — адреса ресурса, запрос не тарифицируется.',
    who: 'Только на ресурсы AWS и только в Route 53.',
  },
  {
    k: 'редирект на www',
    how: 'Вершина указывает A на сервер, который отвечает `301` на `https://www.…`; на `www` — обычный CNAME.',
    who: 'Работает везде, стоит одного лишнего запроса при входе с голого домена.',
    tone: 'ok',
  },
];

export const APEX_WARN =
  'Все «CNAME на вершине» делают одно и то же: провайдер разрешает цель **у себя** и отдаёт клиенту адреса. Наружу это обычная запись A с TTL, который выбрал провайдер. Двух последствий стоит ждать: адреса считаются от места, где стоит DNS-провайдер, а не пользователь (CDN, который выбирает площадку по резолверу, промахнётся), и при переезде к другому провайдеру такой записи в стандартном файле зоны нет — её придётся заменить руками.';

// ─── Выкатка ─────────────────────────────────────────────────────────────────────────────

export const ROLLOUT_SCENARIOS: RolloutScenario[] = [
  {
    id: 'ttl3600',
    label: 'TTL 3600',
    ttlBefore: 3600,
    lowerAt: null,
    ttlAfter: 3600,
    switchAt: 1830,
    note: 'Адрес сменили через полчаса от начала шкалы, TTL всё время час. Резолвер E спросил за 40 секунд до смены — и отдаёт старый адрес ещё почти час.',
  },
  {
    id: 'ttl60',
    label: 'TTL 60',
    ttlBefore: 60,
    lowerAt: null,
    ttlAfter: 60,
    switchAt: 1830,
    note: 'Та же смена при TTL 60. Старый адрес живёт меньше минуты после смены — ценой того, что резолверы ходят к вашему серверу каждую минуту.',
  },
  {
    id: 'lowered',
    label: 'понизили заранее',
    ttlBefore: 3600,
    lowerAt: 600,
    ttlAfter: 60,
    switchAt: 4230,
    note: 'TTL понизили до 60 через десять минут от начала и **выждали старый TTL** — час. Смена адреса прошла так же быстро, как при TTL 60, а до этого резолверы почти не беспокоили сервер.',
  },
  {
    id: 'late',
    label: 'понизили поздно',
    ttlBefore: 3600,
    lowerAt: 1200,
    ttlAfter: 60,
    switchAt: 1830,
    note: 'TTL понизили за десять с половиной минут до смены. Резолверы A и B взяли запись ещё с часовым сроком и про понижение не узнают, пока он не выйдет. Новый TTL действует только на тех, кто спросит **после** понижения.',
  },
];

/** Числа сценариев: пересчитываются тестом той же функцией, что рисует демо. */
export const ROLLOUT_FACTS = {
  ttl3600: { lastOldAfter: 3520, upstream: [3, 2, 2, 2, 2] },
  ttl60: { lastOldAfter: 30 },
  lowered: { lastOldAfter: 30 },
  late: { lastOldAfter: 2330 },
};

export const ROLLOUT_CAPTION =
  'Пять резолверов разных сетей: к каждому каждые 40 секунд приходит клиент с вопросом `shop.test A`, к первому — с начала шкалы, к пятому — с 1790-й секунды. Владелец меняет адрес с `203.0.113.10` на `203.0.113.99` в момент, отмеченный чертой. Каждый резолвер — тот же `createResolver`, со своим кешем. Смотреть стоит на хвост старого цвета справа от черты и на число запросов к серверу зоны.';

export const ROLLOUT_STEPS = [
  { k: 'За сутки (или за старый TTL)', d: 'Понизьте TTL записи, которую будете менять, до 60–300 секунд. Новое значение подействует только после того, как истечёт старое у всех, кто уже держит запись.' },
  { k: 'Перед сменой', d: 'Убедитесь, что новый адрес уже отвечает правильно: часть клиентов придёт туда сразу после правки. Старый держите живым.' },
  { k: 'Смена', d: 'Поменяйте запись. Через новый короткий TTL большинство резолверов отдаёт новый адрес.' },
  { k: 'После', d: 'Старый адрес держите, пока на него идут запросы: смотрите журнал, а не часы. Потом верните TTL вверх.' },
];

export const BALANCE_NOTE =
  'Несколько записей A на одно имя — самая старая балансировка: резолвер отдаёт все адреса, сервер часто меняет их порядок от ответа к ответу, клиент берёт обычно первый. Работает грубо. DNS ничего не знает о здоровье: упавший адрес продолжит раздаваться, пока его не уберут руками, и ещё TTL после этого. Клиенты пробуют адреса по очереди, и до следующего доходят только после таймаута соединения. Сортировка `getaddrinfo` по RFC 6724 может переставить адреса обратно и свести чередование на нет. Поэтому DNS-балансировку применяют **между** площадками и регионами, а внутри площадки ставят балансировщик с проверками здоровья.';

export const STICKY_ROWS: { k: string; d: string; tone?: 'warn' | 'err' }[] = [
  { k: 'Долгие соединения', d: 'Keep-alive, HTTP/2, WebSocket, пул соединений к базе: адрес спрашивали один раз при подключении. Новый TTL на них не действует — переподключиться должен сам клиент.', tone: 'err' },
  { k: 'Кеш в приложении', d: 'Клиент, который сам кеширует адрес (часть HTTP-агентов, старые JVM, конфиг с адресом вместо имени), может держать его до перезапуска.', tone: 'err' },
  { k: 'Резолверы с минимумом', d: 'Часть резолверов поднимает слишком короткий TTL до своего нижнего предела. TTL 5 секунд — не гарантия 5 секунд.', tone: 'warn' },
  { k: 'Негативный кеш', d: 'Новое имя, которое кто-то спросил до создания, остаётся «несуществующим» на срок `minimum` из SOA.', tone: 'warn' },
];

// ─── Браузер и Node ─────────────────────────────────────────────────────────────────────

export const BROWSER_NOTE =
  'Браузер спрашивает имя перед первым соединением с доменом, и это первый круг из трёх перед первым байтом. Его можно сделать заранее: `<link rel="dns-prefetch">` только узнаёт адрес, `preconnect` ещё и открывает соединение. Где ставить какую подсказку и чего она стоит — в теме [«Сеть и кеширование»](/platform/network/#s4). Там же — почему обычный DNS виден всем по дороге и что меняют DoH и DoT: тот же вопрос внутри HTTPS или TLS к резолверу, которому доверяет браузер. Отсюда следствие для отладки: если браузер включил DoH, он спрашивает **не** тот резолвер, что `dig` в терминале, и ответы могут различаться.';

export const HTTPS_ROWS: { hex: string; field: string; value: string }[] = [
  { hex: '00 01', field: 'SvcPriority', value: '1 — рабочая запись (0 значил бы «псевдоним», как CNAME, но разрешённый на вершине)' },
  { hex: '00', field: 'TargetName', value: '`.` — «тот же хост, что спросили»' },
  { hex: '00 01', field: 'ключ', value: '1 — `alpn`, список протоколов' },
  { hex: '00 06', field: 'длина значения', value: '6 байт' },
  { hex: '02 68 33 02 68 32', field: 'значение', value: '`h3`, `h2` — строки с длиной впереди' },
];

export const DIG_HTTPS = {
  cmd: 'dig @127.0.0.1 -p 5072 +norec +noall +answer shop.test TYPE65',
  out: 'shop.test.		3600	IN	TYPE65	\\# 13 00010000010006026833026832',
};

export const HTTPS_NOTE =
  'Запись `HTTPS` (тип 65, RFC 9460) сообщает до соединения то, что раньше приходило только в ответе сервера: какие протоколы он умеет (`alpn`), на каком порту, а с ECH — и ключ для шифрования имени сайта. Браузер, спросивший её вместе с адресом, может идти по HTTP/3 с первого соединения — подробнее в теме [«HTTP/2 и HTTP/3»](/platform/http2-http3/#s6). Тип ещё молод для инструментов: `dig` 9.10 печатает его сырыми байтами как `TYPE65`, `dns-packet` 5.6.1 не знает его по имени, а `resolver.resolve(name, \'HTTPS\')` в Node 24 бросает `ERR_INVALID_ARG_VALUE`.';

export const ACME_NOTE =
  'Ещё одна запись, ради которой фронтенд трогает DNS, — TXT `_acme-challenge.<домен>` при выпуске сертификата вызовом `dns-01`: так доказывают владение доменом, и только так дают сертификат со звёздочкой. Как устроен вызов — в теме [«TLS и сертификаты»](/delivery/tls-certificates/#s5). Для DNS здесь важно одно: УЦ спрашивает запись через свои резолверы, поэтому TXT, созданный секунду назад, может ещё не дойти, а неудачная проверка до создания записи упрётся в негативный кеш.';

export const NODE_RESOLVE_CODE = `import dns from 'node:dns';

const resolver = new dns.promises.Resolver();
resolver.setServers(['127.0.0.1:5073']); // рекурсивный резолвер стенда

console.log(await resolver.resolve4('shop.test', { ttl: true }));
console.log(await resolver.resolve4('www.shop.test')); // CNAME пройден за нас
for (const name of ['nope.shop.test', 'api.shop.test']) {
  try {
    await resolver.resolve6(name);
  } catch (e) {
    console.log(name, e.code);
  }
}`;

export const NODE_RESOLVE_OUT = `[ { address: '203.0.113.10', ttl: 3600 } ]
[ '203.0.113.50', '203.0.113.51' ]
nope.shop.test ENOTFOUND
api.shop.test ENODATA`;

export const NODE_ROWS: { k: string; how: string; hosts: string; pool: string; tone?: 'warn' | 'ok' }[] = [
  {
    k: '`dns.lookup`',
    how: 'системный `getaddrinfo`: то же, что у `ping` и `curl`',
    hosts: 'да: `/etc/hosts`, настройки ОС, кеш ОС',
    pool: 'да — блокирующий вызов в пуле libuv',
    tone: 'warn',
  },
  {
    k: '`dns.resolve*`, `dns.Resolver`',
    how: 'библиотека c-ares сама шлёт пакеты DNS-серверу',
    hosts: 'нет: только DNS-сервер, TTL доступен (`{ ttl: true }`)',
    pool: 'нет — сокет в цикле событий',
    tone: 'ok',
  },
];

export const NODE_NOTE =
  '`http.get`, `fetch` и `net.connect` по имени зовут `dns.lookup`: им важно видеть `/etc/hosts` и настройки ОС. Обратная сторона — `getaddrinfo` блокирующий, и Node выполняет его в пуле потоков. Пул по умолчанию из четырёх потоков и общий с файлами, хешами и сжатием — как он устроен и почему `getaddrinfo` занимает не больше половины потоков, разобрано в теме [«Цикл событий Node»](/js/node-event-loop/#s6). Ни `lookup`, ни `Resolver` ничего не кешируют: три `resolve4` подряд на стенде — три запроса на сервер.';

export const POOL_PROBE_CODE = `const dns = require('node:dns');
const crypto = require('node:crypto');
const resolver = new dns.Resolver();
resolver.setServers(['127.0.0.1:5073']);
const log = (s) => console.log(s);

// четыре долгих хеша занимают пул
for (let i = 1; i <= 4; i++) {
  crypto.pbkdf2('x', 'y', 300000, 32, 'sha256', () => log('pbkdf2 ' + i));
}
dns.lookup('localhost', () => log('dns.lookup localhost'));
resolver.resolve4('shop.test', () => log('resolver.resolve4 shop.test'));`;

/** Порядок при `UV_THREADPOOL_SIZE=2`: хеши между собой могут меняться местами, края — нет. */
export const POOL_PROBE_OUT = `resolver.resolve4 shop.test
pbkdf2 2
pbkdf2 1
pbkdf2 3
pbkdf2 4
dns.lookup localhost`;

export const POOL_NOTE =
  'Пул из двух потоков, четыре хеша в очереди впереди. `resolve4` ушёл в сокет и вернулся первым: пул ему не нужен. `dns.lookup` встал в очередь пула за хешами и начался, только когда они освободили поток, — хотя спрашивал всего лишь `localhost`. С пулом из четырёх потоков картина та же, только ждать приходится первого освободившегося. Так в настоящем сервисе выглядит «медленный DNS» без единого медленного DNS-сервера.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'TTL понижают заранее, а не в момент смены',
    d: 'Новый TTL узнают только те, кто спросит запись после правки. Все, кто взял её раньше, держат старый срок до конца. В демо при понижении за десять с половиной минут до смены старый адрес жил после смены ещё 39 минут. Понижать — за старый TTL до смены.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Сменили адрес — старые серверы ещё нужны',
    d: 'TTL ограничивает кеши, но не соединения. Keep-alive, HTTP/2, WebSocket и пулы к базе спросили адрес один раз. Старый адрес выключают, когда на него перестали приходить запросы, а не когда прошёл TTL.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Проверка имени до создания записи',
    d: 'Открыли новый поддомен в браузере до того, как добавили запись, — и резолвер запомнил NXDOMAIN на срок `minimum` из SOA. Запись уже есть, а у вас «такого сайта нет». Сначала запись, потом проверка.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'CNAME не живёт рядом с другими записями',
    d: 'На вершине зоны его нельзя вообще: там обязаны быть SOA и NS. На поддомене нельзя поставить CNAME и рядом MX или TXT. ALIAS и CNAME flattening — функции провайдера, а не стандарт: при переезде их придётся заменить.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`dig` и приложение спрашивают разных',
    d: '`dig` идёт прямо к DNS-серверу, мимо `/etc/hosts` и кеша ОС. Браузер может спрашивать свой резолвер по DoH, `dns.lookup` в Node — ОС. Сверяя ответы, сравнивайте одинаковые пути.',
  },
  {
    n: '06',
    t: '`ENOTFOUND` и `ENODATA` — разные «нет»',
    d: 'NXDOMAIN — имени нет совсем. NODATA — имя есть, нет записи этого типа: у `api.shop.test` есть IPv4, но нет IPv6. Первое говорит об опечатке или не созданной записи, второе — о неполной.',
  },
  {
    n: '07',
    t: 'DNS-балансировка не знает о здоровье',
    d: 'Упавший адрес раздаётся, пока его не уберут руками, и ещё TTL после этого. Клиент переходит к следующему адресу только после таймаута соединения. Для отказоустойчивости внутри площадки нужен балансировщик с проверками.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`dns.lookup` ждёт пула потоков',
    d: 'Каждое соединение по имени в Node начинается с `getaddrinfo` в пуле libuv. Занятый хешами или сжатием пул задерживает подключения даже к `localhost`. Для массовых запросов к внешним именам — `dns.Resolver` или кеш адресов в агенте.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Адрес DNS-сервера живёт и в родительской зоне',
    d: 'Glue — копия адреса вашего NS в зоне выше, со своим TTL (у `test.` в примере — час, у корня — двое суток). Переезжая на другой DNS-сервер, адрес меняют у регистратора, и старый сервер держат с правильной зоной, пока не истечёт TTL делегирования.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  { title: 'RFC 1034 — Domain Names: Concepts and Facilities', href: 'https://www.rfc-editor.org/rfc/rfc1034', what: 'зоны, делегирование, алгоритм авторитетного сервера (4.3.2) и резолвера (5.3.3), CNAME (3.6.2)' },
  { title: 'RFC 1035 — Domain Names: Implementation and Specification', href: 'https://www.rfc-editor.org/rfc/rfc1035', what: 'формат пакета, заголовок и флаги, сжатие имён (4.1.4), предел 512 байт для UDP' },
  { title: 'RFC 2181 — Clarifications to the DNS Specification', href: 'https://www.rfc-editor.org/rfc/rfc2181', what: 'CNAME без соседей (10.1), TTL набора записей (5.2), доверие к glue (5.4.1)' },
  { title: 'RFC 2308 — Negative Caching of DNS Queries', href: 'https://www.rfc-editor.org/rfc/rfc2308', what: 'NXDOMAIN и NODATA, срок отказа по SOA' },
  { title: 'RFC 9499 — DNS Terminology', href: 'https://www.rfc-editor.org/rfc/rfc9499', what: 'stub-резолвер, glue, вершина зоны и прочие слова темы' },
  { title: 'RFC 9460 — SVCB and HTTPS Resource Records', href: 'https://www.rfc-editor.org/rfc/rfc9460', what: 'запись `HTTPS`, `alpn`, `ech`, формат данных' },
  { title: 'RFC 8484 (DoH) и RFC 7858 (DoT)', href: 'https://www.rfc-editor.org/rfc/rfc8484', what: 'DNS внутри HTTPS и TLS' },
  { title: 'RFC 6891 — EDNS(0)', href: 'https://www.rfc-editor.org/rfc/rfc6891', what: 'размер ответа больше 512 байт' },
  { title: 'RFC 6761 и RFC 5737', href: 'https://www.rfc-editor.org/rfc/rfc6761', what: 'зарезервированный домен `test.` и адреса для документации, на которых построен пример' },
  { title: 'Node.js — dns, Implementation considerations', href: 'https://nodejs.org/api/dns.html#implementation-considerations', what: '`dns.lookup` через `getaddrinfo` в пуле, `dns.resolve*` через c-ares; проверено на 24.11.0' },
  { title: 'dns-packet', href: 'https://github.com/mafintosh/dns-packet', what: 'разбор пакетов стенда; 5.6.1' },
  { title: 'Cloudflare — CNAME flattening', href: 'https://developers.cloudflare.com/dns/cname-flattening/', what: 'CNAME на вершине зоны у Cloudflare' },
  { title: 'Amazon Route 53 — Choosing between alias and non-alias records', href: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html', what: 'alias-записи на ресурсы AWS' },
  { title: 'DNSimple — ALIAS record', href: 'https://support.dnsimple.com/articles/alias-record/', what: 'ALIAS на вершине зоны' },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Транспорт и RTT-бюджет»](/platform/network/#s1) — цена DNS в загрузке страницы, DoH и ECH; [раздел «Приоритеты загрузки»](/platform/network/#s4) — `dns-prefetch` и `preconnect`. [HTTP/2 и HTTP/3](/platform/http2-http3/#s6) — запись `HTTPS` и `Alt-Svc`. [TLS и сертификаты, раздел «ACME»](/delivery/tls-certificates/#s5) — вызов `dns-01`. [GitHub Pages, раздел «Базовый путь»](/delivery/github-pages/#s2) — свой домен: `A` на вершине и `CNAME` на `www`. [CDN изнутри](/platform/cdn-cache/#s5) — маршрутизация через DNS и anycast. [Балансировка нагрузки, раздел «Плавный вывод»](/delivery/load-balancing/#s7) — как снимать сервер, к которому ещё держат соединения. [StatefulSet, раздел «Имя и адрес»](/delivery/statefulset/#s1) — DNS-имена подов и негативный кеш CoreDNS. [Безопасность бэкенда, раздел «Запрос на адрес пользователя»](/platform/backend-security/#s2) — DNS rebinding. [Цикл событий Node, раздел «Пул потоков»](/js/node-event-loop/#s6).';
