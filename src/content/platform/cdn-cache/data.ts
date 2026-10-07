import type { StampedeDiagramData } from '@/widgets/cdn-cache-stampede-diagram/model/types';
import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { StoreCase } from '@/widgets/cdn-stream/model/lab';

/**
 * Данные темы «CDN и серверный кеш».
 *
 * Тема написана здесь. До неё предмет висел двумя строками «Отдельная тема — готовится»
 * в «Что осталось за кадром» у «Сети и кеширования»: «Кеширование на стороне сервера»
 * и «CDN изнутри». Браузерный HTTP-кеш — свежесть, валидация, `ETag`, `Vary` со стороны
 * браузера, хеш в имени файла — разобран там, в разделе «Кеш и валидация», и здесь
 * не повторяется: тема начинается с кеша, одна копия в котором отвечает многим.
 *
 * ── Как проверено ─────────────────────────────────────────────────────────────────────────
 * Всё поведение кеша — запуском, Node 26.8.2, сентябрь 2026 (`tests/unit/cdn-cache.test.ts`):
 *   — учебная прослойка — строки `RULES_CODE` и `CACHE_CODE`, напечатанные в теме, — поднята
 *     на `node:http` (`PROXY_CODE`) против своего origin на локальной петле; тест считает
 *     запросы, дошедшие до origin, и читает `Age` и `Cache-Status` ответов;
 *   — время — виртуальные часы (`now` подменён), одновременность — ворота на промисах,
 *     а не таймеры: ни одно число темы не снято секундомером;
 *   — таблицы «можно ли хранить», «ключ», «доля попаданий», «XFetch», «джиттер», «PoP и щит»
 *     и «гонка cache-aside» — литералы ниже; тест пересчитывает их теми же функциями,
 *     что напечатаны в теме (`widgets/cdn-stream/model/lab.ts`), и сверяет;
 *   — числа демо (`STREAM_NUMBERS`) пересчитываются тем же `runStream`, что крутит демо.
 *
 * ── Что НЕ проверено запуском ─────────────────────────────────────────────────────────────
 * Поведение настоящих CDN (Cloudflare, Fastly, Akamai, CloudFront): anycast, скорость purge,
 * как конкретный CDN читает пару `s-maxage` + `stale-while-revalidate`, ключи по умолчанию,
 * отношение к `Set-Cookie`. Это описано по RFC и документации и в тексте подписано так.
 * Учебная прослойка следует **букве** RFC 9111 и RFC 5861 — где CDN отступают от буквы,
 * тема это говорит, а не выдаёт прослойку за CDN.
 * Redis — по документации (`maxmemory-policy`, приближённый LRU), сервер Redis не поднимался.
 */

// ─── Зачин ───────────────────────────────────────────────────────────────────────────────

export const PLAIN_SHARED =
  'Браузерный кеш — ваш холодильник: что положили, то и едите. Общий кеш — раздача в столовой: одну кастрюлю разливают всем. Поэтому в неё нельзя класть то, что готовили лично для вас, у одного блюда может быть несколько кастрюль (с луком и без), а когда суп кончился, очередь не должна всей толпой бежать на кухню.';

export const GLOSSARY = [
  {
    k: 'origin',
    d: 'Сервер-источник за кешем: приложение или хранилище файлов. Всё, чего нет в кеше, берут у него, и цель кеша — ходить к нему как можно реже.',
  },
  {
    k: 'общий кеш (shared)',
    d: 'Кеш, одна копия в котором отвечает многим пользователям: CDN, обратный прокси, кеш перед API. Его противоположность — приватный кеш браузера.',
  },
  {
    k: 'PoP',
    d: 'Point of Presence — площадка CDN в конкретном городе или у провайдера. Запрос обслуживает ближайшая, и у каждой свой кеш: копия во Франкфурте ничего не знает о копии в Варшаве.',
  },
  {
    k: 'hit, miss, hit ratio',
    d: 'Попадание — ответ нашёлся в кеше, промах — пришлось идти к origin. Hit ratio — доля запросов, отвеченных из кеша.',
  },
  {
    k: 'TTL',
    d: 'Time To Live — сколько запись живёт в кеше. В HTTP это срок свежести из `s-maxage` или `max-age`, в Redis — срок ключа.',
  },
  {
    k: 'ревалидация',
    d: 'Условный запрос к origin с `If-None-Match`: «у меня версия `"v1"`, она ещё годится?». Ответ `304` продлевает копию без передачи тела.',
  },
  {
    k: 'purge',
    d: 'Принудительное удаление из кеша до истечения срока — по адресу или по тегу, которым origin пометил ответы.',
  },
  {
    k: 'Redis',
    d: 'Отдельный сервер «ключ — значение» в памяти. Общий кеш для нескольких процессов приложения: в отличие от `Map` в процессе, его видят все экземпляры сразу.',
  },
];

export const PREREQ = [
  {
    t: 'Свежесть и валидация',
    d: 'Пока ответ свеж, кеш отдаёт его без сети; когда срок вышел, спрашивает сервер с `If-None-Match` и получает `304` или новый ответ. Здесь те же две фазы, только у кеша, одного на всех.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info' as const,
  },
  {
    t: 'Хеш в имени файла',
    d: 'Файл с хешем содержимого в имени можно кешировать навсегда: новая версия — новый адрес. Нужно для раздела про сброс: версия в адресе — главная альтернатива purge.',
    href: '/delivery/github-pages/#s4',
    hrefLabel: '«GitHub Pages», раздел «Кеш и инвалидация статики»',
    tone: 'info' as const,
  },
  {
    t: 'RTT и цена соединения',
    d: 'Каждое новое соединение — несколько кругов до сервера и обратно. CDN выигрывает прежде всего тем, что сокращает длину круга, а не тем, что «быстрее отдаёт».',
    href: '/platform/network/#s1',
    hrefLabel: '«Сеть и кеширование», раздел «Транспорт и RTT-бюджет»',
    tone: 'info' as const,
  },
  {
    t: 'Толпа и джиттер',
    d: 'Тысяча клиентов, одновременно пришедших за одним и тем же, кладёт сервер; случайная добавка к задержке размазывает их по времени. Здесь то же случается с истечением кеша.',
    href: '/platform/realtime/#s6',
    hrefLabel: '«Долгие соединения», раздел «Переподключение и heartbeat»',
    tone: 'info' as const,
  },
];

// ─── Код темы ───────────────────────────────────────────────────────────────────────────

export const RULES_CODE = `// Правила общего кеша по RFC 9111. Имена заголовков — в нижнем регистре.

function directives(value) {
  const out = {};
  for (const [, name, arg] of String(value ?? '').matchAll(/([\\w-]+)(?:=("[^"]*"|[^,\\s]*))?/g)) {
    out[name.toLowerCase()] = arg === undefined ? true : arg.replace(/^"|"$/g, '');
  }
  return out;
}

// CDN-Cache-Control (RFC 9213) адресован CDN: если он есть, Cache-Control не читается вовсе.
function policy(res) {
  return directives(res.headers['cdn-cache-control'] ?? res.headers['cache-control']);
}

// Статусы, которые можно хранить и без явного срока (RFC 9110 §15.1).
const HEURISTIC = [200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414, 501];

// null — хранить можно; строка — почему нельзя (RFC 9111 §3 и §3.5).
function whyNotStore(req, res) {
  const cc = policy(res);
  if (req.method !== 'GET') return \`метод \${req.method}\`;
  if (directives(req.headers['cache-control'])['no-store']) return 'no-store в запросе';
  if (cc['no-store']) return 'no-store';
  if (cc.private === true) return 'private';
  if (req.headers.authorization && !(cc.public || 's-maxage' in cc || cc['must-revalidate'])) {
    return 'Authorization без public, s-maxage или must-revalidate';
  }
  if (String(res.headers.vary ?? '').trim() === '*') return 'Vary: * не совпадёт ни с одним запросом';
  const explicit = cc.public || 's-maxage' in cc || 'max-age' in cc || res.headers.expires;
  if (!explicit && !HEURISTIC.includes(res.status)) return \`статус \${res.status} без явного срока\`;
  return null;
}

// Сколько секунд ответ свеж: s-maxage, потом max-age, потом Expires, потом эвристика.
function lifetime(res) {
  const cc = policy(res);
  if (cc['no-cache'] === true) return 0; // хранить можно, отдавать — только после проверки
  if ('s-maxage' in cc) return Number(cc['s-maxage']);
  if ('max-age' in cc) return Number(cc['max-age']);
  const date = Date.parse(res.headers.date);
  if (res.headers.expires) return Math.max(0, (Date.parse(res.headers.expires) - date) / 1000) || 0;
  const modified = Date.parse(res.headers['last-modified']);
  return modified < date ? Math.floor((date - modified) / 10000) : 0; // 10 % возраста документа
}

// Когда устаревшее нельзя отдать без проверки. s-maxage несёт в себе proxy-revalidate (§5.2.2.10).
function staleForbidden(res) {
  const cc = policy(res);
  return Boolean(cc['no-cache'] || cc['must-revalidate'] || cc['proxy-revalidate'] || 's-maxage' in cc);
}`;

export const CACHE_CODE = `// Учебный общий кеш: ключ с Vary, свежесть, устаревание, коллапс и purge.
// Нет HEAD, Range, вытеснения, и на условный запрос клиента он сам 304 не отвечает.

const tagsOf = (res) =>
  \`\${res.headers['surrogate-key'] ?? ''} \${res.headers['cache-tag'] ?? ''}\`.split(/[\\s,]+/).filter(Boolean);

function createCache({ now, fetchOrigin, coalesce = true, normalize = (url) => url, name = 'cache' }) {
  const store = new Map(); // первичный ключ → варианты по Vary
  const inflight = new Map(); // первичный ключ → идущий к origin запрос

  const keyOf = (req) => \`\${req.method} \${normalize(req.url)}\`;
  const varyOf = (res) =>
    String(res.headers.vary ?? '').toLowerCase().split(',').map((h) => h.trim()).filter(Boolean);
  const matches = (entry, req) => varyOf(entry.res).every((h) => (req.headers[h] ?? '') === entry.sent[h]);
  const ageOf = (entry) => Math.floor(entry.initialAge + now() - entry.storedAt);
  const find = (key, req) => store.get(key)?.find((e) => matches(e, req));

  function save(key, req, res) {
    const hidden = typeof policy(res).private === 'string' ? policy(res).private.toLowerCase().split(/\\s*,\\s*/) : [];
    const kept = { ...res, headers: Object.fromEntries(Object.entries(res.headers).filter(([h]) => !hidden.includes(h))) };
    const sent = Object.fromEntries(varyOf(res).map((h) => [h, req.headers[h] ?? '']));
    const entry = { res: kept, sent, storedAt: now(), initialAge: Number(res.headers.age ?? 0), tags: tagsOf(res) };
    store.set(key, [...(store.get(key) ?? []).filter((e) => !matches(e, req)), entry]);
  }

  function reply(res, status, age) {
    const headers = { ...res.headers };
    if (age !== undefined) headers.age = String(age);
    const upstream = res.headers['cache-status'];
    headers['cache-status'] = upstream ? \`\${upstream}, \${name}; \${status}\` : \`\${name}; \${status}\`;
    return { status: res.status, headers, body: res.body };
  }

  // Поход к origin: за новой копией или условный — проверить устаревшую.
  async function forward(key, req, entry) {
    const { 'if-none-match': _, 'if-modified-since': __, ...headers } = req.headers;
    if (entry?.res.headers.etag) headers['if-none-match'] = entry.res.headers.etag;
    if (entry?.res.headers['last-modified']) headers['if-modified-since'] = entry.res.headers['last-modified'];
    let res;
    try {
      res = await fetchOrigin({ ...req, headers });
    } catch {
      res = { status: 502, headers: {}, body: 'origin недоступен' };
    }
    if (entry && res.status === 304) {
      const kept = entry.res.headers['cache-status'];
      entry.res = { ...entry.res, headers: { ...entry.res.headers, ...res.headers, 'cache-status': kept } };
      entry.storedAt = now();
      entry.initialAge = Number(res.headers.age ?? 0);
      return { res: entry.res, fwdStatus: 304, stored: true };
    }
    const stored = res.status < 500 && whyNotStore(req, res) === null;
    if (stored) save(key, req, res);
    return { res, fwdStatus: res.status, stored };
  }

  function track(key, job) {
    if (!coalesce) return job;
    inflight.set(key, job);
    job.finally(() => inflight.get(key) === job && inflight.delete(key));
    return job;
  }

  async function handle(req, waited = '') {
    if (req.method !== 'GET') {
      const { res } = await forward(null, req);
      if (res.status < 400) store.delete(\`GET \${normalize(req.url)}\`); // RFC 9111 §4.4
      return reply(res, 'fwd=method');
    }
    const key = keyOf(req);
    const entry = find(key, req);

    if (entry) {
      const age = ageOf(entry);
      const ttl = lifetime(entry.res) - age;
      if (ttl > 0) return reply(entry.res, waited ? \`fwd=\${waited}; ttl=\${ttl}; collapsed\` : \`hit; ttl=\${ttl}\`, age);
      const swr = Number(policy(entry.res)['stale-while-revalidate'] ?? 0);
      if (!staleForbidden(entry.res) && -ttl < swr) {
        if (!inflight.has(key)) track(key, forward(key, req, entry)); // обновить в фоне
        return reply(entry.res, \`hit; ttl=\${ttl}; detail=stale-while-revalidate\`, age);
      }
    }

    const reason = entry ? 'stale' : store.has(key) ? 'vary-miss' : 'uri-miss';
    if (coalesce && !waited && inflight.has(key)) {
      await inflight.get(key); // за этим ключом уже пошли — ждём их ответа
      return handle(req, reason);
    }

    const { res, fwdStatus, stored } = await track(key, forward(key, req, entry));
    if (entry && fwdStatus >= 500) {
      const sie = Number(policy(entry.res)['stale-if-error'] ?? 0);
      const staleFor = ageOf(entry) - lifetime(entry.res);
      if (!staleForbidden(entry.res) && staleFor < sie) {
        return reply(entry.res, \`fwd=stale; fwd-status=\${fwdStatus}; detail=stale-if-error\`, ageOf(entry));
      }
    }
    const fresh = stored ? find(key, req) : undefined;
    return reply(res, \`fwd=\${reason}; fwd-status=\${fwdStatus}\${stored ? '; stored' : ''}\`, fresh && ageOf(fresh));
  }

  function purgeTag(tag) {
    let purged = 0;
    for (const [key, list] of store) {
      const keep = list.filter((e) => !e.tags.includes(tag));
      purged += list.length - keep.length;
      if (keep.length) store.set(key, keep);
      else store.delete(key);
    }
    return purged;
  }

  function purgeUrl(url) {
    const key = \`GET \${normalize(url)}\`;
    const purged = store.get(key)?.length ?? 0;
    store.delete(key);
    return purged;
  }

  return { handle, purgeTag, purgeUrl };
}`;

export const PROXY_CODE = `// Прослойка на node:http: принимает запрос, спрашивает кеш, кеш при нужде идёт к origin.
// Метод PURGE сбрасывает тег из заголовка Surrogate-Key или один адрес.

const HOP = ['connection', 'keep-alive', 'transfer-encoding', 'host'];
const clean = (headers) => Object.fromEntries(Object.entries(headers).filter(([h]) => !HOP.includes(h)));

function originFetch(http, base) {
  return (req) =>
    new Promise((resolve, reject) => {
      const out = http.request(base + req.url, { method: req.method, headers: clean(req.headers) }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: clean(res.headers), body }));
      });
      out.on('error', reject);
      out.end();
    });
}

function listen(http, cache) {
  return http.createServer(async (req, res) => {
    if (req.method === 'PURGE') {
      const tag = req.headers['surrogate-key'];
      const purged = tag ? cache.purgeTag(tag) : cache.purgeUrl(req.url);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ purged }));
      return;
    }
    const out = await cache.handle({ method: req.method, url: req.url, headers: clean(req.headers) });
    res.writeHead(out.status, out.headers).end(out.body);
  });
}`;

export const NORMALIZE_CODE = `// Нормализация ключа: одна страница — одна запись, как бы ни был записан адрес.
function normalize(url) {
  const u = new URL(url, 'http://key.invalid');
  const params = [...u.searchParams].filter(([k]) => !k.startsWith('utm_') && k !== 'fbclid');
  params.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  return u.pathname + (query ? \`?\${query}\` : '');
}`;

export const XFETCH_CODE = `// XFetch (Vattani, Chierichetti, Lowenstein, 2015): каждый читатель сам решает,
// не пересчитать ли значение раньше срока. delta — сколько длится пересчёт;
// beta > 1 — пересчитывать раньше, beta < 1 — позже.
function shouldRecompute(now, expiry, delta, beta = 1, random = Math.random) {
  return now - delta * beta * Math.log(random()) >= expiry;
}`;

export const LRU_CODE = `// LRU на Map: Map помнит порядок вставки, значит первый ключ — самый давний.
class LRU {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); // переставить в конец: использован последним
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    // Новый итератор каждый раз перешагивает «дыры» от удалённых ключей — на кешах
    // в сотни тысяч записей это дорожает; лекарство — в «Кешах с вытеснением».
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
}`;

export const ASIDE_CODE = `// cache-aside: приложение само спрашивает кеш и само его наполняет.
async function getUser(id, { db, cache, ttl }) {
  const key = \`user:\${id}\`;
  const cached = await cache.get(key);
  if (cached !== undefined) return cached;
  const user = await db.read(id);
  await cache.set(key, user, ttlWithJitter(ttl));
  return user;
}

async function renameUser(id, name, { db, cache }) {
  await db.write(id, { name });
  await cache.del(\`user:\${id}\`); // удалить, а не записать: следующий читатель возьмёт из базы
}

// Разброс ±spread: ключи, прогретые разом, не истекут в одну секунду.
function ttlWithJitter(ttl, spread = 0.1, random = Math.random) {
  return Math.round(ttl * (1 - spread + 2 * spread * random()));
}`;

// ─── Раздел 1. Кто вправе хранить ────────────────────────────────────────────────────────

/**
 * Решения по RFC 9111 для общего кеша. `expect` — литерал; тест пересчитывает его
 * `whyNotStore` и `lifetime` из `RULES_CODE` и сверяет. `note` — пояснение для читателя.
 */
export const STORE_CASES: (StoreCase & {
  expect: { store: boolean; fresh: number | null; why: string | null };
  note: string;
})[] = [
  {
    req: {},
    res: { headers: { 'Cache-Control': 'max-age=60' } },
    expect: { store: true, fresh: 60, why: null },
    note: 'обычный ответ: `public` для него не нужен',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'max-age=60, s-maxage=600' } },
    expect: { store: true, fresh: 600, why: null },
    note: 'браузер читает `max-age`, общий кеш — `s-maxage`',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'private, max-age=60' } },
    expect: { store: false, fresh: null, why: 'private' },
    note: 'браузеру можно на минуту, CDN нельзя вовсе',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'no-store' } },
    expect: { store: false, fresh: null, why: 'no-store' },
    note: 'никому и нигде',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'no-cache', ETag: '"v1"' } },
    expect: { store: true, fresh: 0, why: null },
    note: 'хранит, но перед каждой выдачей спрашивает origin; тот отвечает `304` без тела',
  },
  {
    req: { headers: { Authorization: 'Bearer …' } },
    res: { headers: { 'Cache-Control': 'max-age=60' } },
    expect: { store: false, fresh: null, why: 'Authorization без public, s-maxage или must-revalidate' },
    note: 'ответ на запрос с учётными данными по умолчанию личный',
  },
  {
    req: { headers: { Authorization: 'Bearer …' } },
    res: { headers: { 'Cache-Control': 'public, max-age=60' } },
    expect: { store: true, fresh: 60, why: null },
    note: '`public` здесь — явное разрешение раздать этот ответ всем',
  },
  {
    req: { headers: { Authorization: 'Bearer …' } },
    res: { headers: { 'Cache-Control': 's-maxage=60' } },
    expect: { store: true, fresh: 60, why: null },
    note: '`s-maxage` разрешает то же самое',
  },
  {
    req: {},
    res: {
      headers: { Date: 'Mon, 21 Sep 2026 12:00:00 GMT', 'Last-Modified': 'Fri, 11 Sep 2026 12:00:00 GMT' },
    },
    expect: { store: true, fresh: 86400, why: null },
    note: 'срока нет, статус 200: эвристика — 10 % от возраста документа, то есть сутки',
  },
  {
    req: {},
    res: { status: 302, headers: { Location: '/login' } },
    expect: { store: false, fresh: null, why: 'статус 302 без явного срока' },
    note: '302 эвристически не кешируется',
  },
  {
    req: { method: 'POST' },
    res: { headers: { 'Cache-Control': 'max-age=60' } },
    expect: { store: false, fresh: null, why: 'метод POST' },
    note: 'ключ кеша — это `GET`',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'public, max-age=60', 'Set-Cookie': 'sid=a1b2' } },
    expect: { store: true, fresh: 60, why: null },
    note: '⚠️ RFC не запрещает: кука уедет каждому, кто получит копию',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'private="Set-Cookie", max-age=60', 'Set-Cookie': 'sid=a1b2' } },
    expect: { store: true, fresh: 60, why: null },
    note: 'хранится **без** `Set-Cookie`: `private` с именем поля закрывает только это поле',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'max-age=60', Vary: '*' } },
    expect: { store: false, fresh: null, why: 'Vary: * не совпадёт ни с одним запросом' },
    note: 'хранить формально можно, но толку нет — прослойка не хранит',
  },
  {
    req: {},
    res: { headers: { 'Cache-Control': 'private', 'CDN-Cache-Control': 'max-age=600' } },
    expect: { store: true, fresh: 600, why: null },
    note: '⚠️ CDN, понимающий адресный заголовок, `Cache-Control` не читает вовсе',
  },
  {
    req: { headers: { 'Cache-Control': 'no-store' } },
    res: { headers: { 'Cache-Control': 'max-age=60' } },
    expect: { store: false, fresh: null, why: 'no-store в запросе' },
    note: 'запрет может прийти и от клиента',
  },
];

const shown = (headers: Record<string, string> = {}) => Object.entries(headers).map(([k, v]) => `${k}: ${v}`);

/** Строки таблицы на странице — из тех же случаев, что сверяет тест. */
export const STORE_ROWS = STORE_CASES.map((c) => ({
  req: [c.req.method ?? 'GET', ...shown(c.req.headers)].join(' · '),
  res: [String(c.res.status ?? 200), ...shown(c.res.headers)].join(' · '),
  verdict: c.expect.store ? 'да' : `нет: ${c.expect.why}`,
  fresh: c.expect.fresh === null ? '—' : String(c.expect.fresh),
  note: c.note,
  tone: c.expect.store ? ('ok' as const) : ('err' as const),
}));

export const RULES_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`s-maxage` — срок только для общих кешей',
    d: 'Перекрывает `max-age` в CDN и прокси, браузер его не читает. Отсюда привычная пара `max-age=60, s-maxage=3600`: у читателя минута, в CDN час — и сбросить CDN вы можете, а браузер нет.',
  },
  {
    t: '`no-cache` — не «не кешировать»',
    d: 'Хранить можно, отдавать без проверки нельзя: каждый запрос превращается в условный, origin отвечает `304` без тела. «Не хранить нигде» — это `no-store`. Разница в том, что `no-cache` экономит трафик, но не походы к origin.',
  },
  {
    t: '`Authorization` закрывает ответ по умолчанию',
    d: 'Ответ на запрос с учётными данными общий кеш хранит, только если origin явно разрешил: `public`, `s-maxage` или `must-revalidate`. Правило про заголовок **запроса** — ответ может выглядеть совсем обычным.',
    tone: 'warn',
  },
  {
    t: '`CDN-Cache-Control` — адресная политика',
    d: 'RFC 9213: CDN, который понимает этот заголовок, берёт политику из него и `Cache-Control` игнорирует целиком, а браузер наоборот. Так CDN и браузеру задают разные сроки, не смешивая их в одной строке. Похожий и более старый — `Surrogate-Control` у Fastly.',
    tone: 'info',
  },
];

export const SMAXAGE_NOTE =
  '**`s-maxage` несёт в себе `proxy-revalidate`** (RFC 9111, §5.2.2.10): истёкшую копию общий кеш обязан проверить у origin, прежде чем отдать. По букве RFC это отключает и `stale-while-revalidate`, и `stale-if-error` в той же строке — §4.2.4 прямо называет `s-maxage` среди запретов отдавать устаревшее. Учебная прослойка следует букве, и в демо ниже `stale-while-revalidate` рядом с `s-maxage` не действует. Многие платформы (Vercel в документации — прямо) рекомендуют именно пару `s-maxage` + `stale-while-revalidate` и отдают устаревшее, то есть читают её мягче RFC. Как поступает ваш CDN, скажет только его документация или замер; без двусмысленности та же политика записывается как `CDN-Cache-Control: max-age=…, stale-while-revalidate=…`.';

// ─── Раздел 2. Ключ и Vary ───────────────────────────────────────────────────────────────

export const PLAIN_KEY =
  'Ключ кеша — надпись на кастрюле. Если на одной написано «борщ», а на другой «Борщ», повар сварит два одинаковых борща. Если на кастрюле написано только «суп», а внутри то с грибами, то с курицей, кто-то получит не своё. Нормализация — договор писать надписи одинаково, `Vary` — дописка «для кого».';

export const KEY_URLS = [
  '/news?b=2&a=1',
  '/news?a=1&b=2',
  '/news?a=1&b=2&utm_source=tg',
  '/news?fbclid=xyz&a=1&b=2',
];

/** Ключи прослойки для `KEY_URLS` — без нормализации и с `NORMALIZE_CODE`. Сверяет тест. */
export const KEY_ROWS = [
  { url: '/news?b=2&a=1', raw: 'GET /news?b=2&a=1', normal: 'GET /news?a=1&b=2' },
  { url: '/news?a=1&b=2', raw: 'GET /news?a=1&b=2', normal: 'GET /news?a=1&b=2' },
  { url: '/news?a=1&b=2&utm_source=tg', raw: 'GET /news?a=1&b=2&utm_source=tg', normal: 'GET /news?a=1&b=2' },
  { url: '/news?fbclid=xyz&a=1&b=2', raw: 'GET /news?fbclid=xyz&a=1&b=2', normal: 'GET /news?a=1&b=2' },
];

export const KEY_ORIGIN = { raw: 4, normal: 1 };

export const KEY_NOTE = `Прослойка перед настоящим origin: ${KEY_URLS.length} запроса из таблицы без нормализации — ${KEY_ORIGIN.raw} похода к origin, с \`normalize\` — ${KEY_ORIGIN.normal}.`;

export const KEY_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Первичный ключ — метод и адрес',
    d: 'RFC 9111 определяет ключ как метод и целевой URI, и почти все кеши на практике хранят только `GET`. Схема и хост в ключ входят тоже — у прослойки один origin, поэтому она их опускает.',
  },
  {
    t: '`Vary` — вторичный ключ',
    d: 'Кеш запоминает значения перечисленных заголовков запроса рядом с копией и отдаёт её только запросу с теми же значениями. Первый запрос нового варианта — промах, в `Cache-Status` он виден как `fwd=vary-miss`.',
  },
  {
    t: 'Нормализация — обещание за origin',
    d: 'Выбросить `utm_source` из ключа можно только потому, что origin его не читает. Выбросите параметр, от которого ответ зависит, — и разные ответы лягут под один ключ: читатель получит чужую страницу.',
    tone: 'warn',
  },
];

export const VARY_NOTE =
  'Со стороны браузера `Vary` и число вариантов разобраны в [«Сети и кешировании»](/platform/network/#s2). В общем кеше у каждого варианта своя цена: копии одной страницы делят между собой память и попадания. Хуже всех `Vary: Cookie` — по RFC каждый новый набор кук становится новым вариантом, то есть у каждого залогиненного читателя своя копия. Таблица ниже считает, во что обходятся форма спроса, размер кеша и варианты.';

/**
 * Доля попаданий LRU-кеша на 100 000 адресах при распределении Ципфа, 200 000 запросов
 * (считая прогрев), зерно 7. Пересчитывает `hitRatio` из `widgets/cdn-stream/model/lab.ts`
 * тем же `LRU` из `LRU_CODE`.
 */
export const HIT_ROWS: {
  k: string;
  s: number;
  capacity: number;
  variants: number;
  hit: number;
  note: string;
  tone?: 'ok' | 'warn' | 'err';
}[] = [
  { k: 'популярное сверху, кеш 1 %', s: 1, capacity: 1000, variants: 1, hit: 0.5058, note: 'тысяча записей закрывает половину трафика', tone: 'ok' },
  { k: 'популярное сверху, кеш 10 %', s: 1, capacity: 10000, variants: 1, hit: 0.7263, note: 'вдесятеро больше памяти — всего +22 пункта', tone: 'ok' },
  { k: 'длинный хвост, кеш 1 %', s: 0.8, capacity: 1000, variants: 1, hit: 0.2053, note: 'тот же кеш, но спрос размазан по редким адресам', tone: 'warn' },
  { k: 'длинный хвост, кеш 10 %', s: 0.8, capacity: 10000, variants: 1, hit: 0.4606, note: 'хвост не помещается и в десятикратный кеш', tone: 'warn' },
  { k: 'популярное сверху, 10 %, `Vary` на 12 значений', s: 1, capacity: 10000, variants: 12, hit: 0.4815, note: 'вариант умножает адреса: кеш как будто стал в 12 раз меньше', tone: 'warn' },
  { k: 'популярное сверху, 10 %, `Vary: Cookie`', s: 1, capacity: 10000, variants: 1000, hit: 0.0878, note: 'тысяча разных кук — и общий кеш почти перестаёт быть общим', tone: 'err' },
];

export const HIT_NOTE =
  'Показатель Ципфа `s` задаёт форму спроса: при `s = 1` десятый по популярности адрес спрашивают в десять раз реже первого, при `s = 0,8` — только в шесть с небольшим, и спрос сильнее утекает в хвост. Хвост — это адреса, которые спрашивают раз в сутки: каждый такой запрос — промах, потому что запись вытеснена задолго до следующего. Поэтому hit ratio падает не от «плохого CDN», а от формы трафика, и лечится не памятью, а ключом: меньше вариантов, нормализованные адреса, всё одноразовое — мимо кеша.';

// ─── Раздел 3. Срок вышел: устаревшее и толпа ────────────────────────────────────────────

export const PLAIN_STAMPEDE =
  'Кастрюля кончилась, новую варят полторы минуты. Без правил каждый, кто подходит к раздаче, идёт на кухню сам и ставит свою кастрюлю — через минуту на плите их двадцать. Коллапс — это «за супом уже пошли, подождите здесь». `stale-while-revalidate` — «пока варят новый, налью вам из вчерашнего».';

export const CACHE_NOTE =
  'Ключ с `Vary`, свежесть и `Age`, фоновое обновление, `stale-if-error`, коллапс одновременных промахов и purge — в одной функции. Правила хранения — `policy`, `whyNotStore`, `lifetime`, `staleForbidden` — из раздела «Кто вправе хранить». Время кеш берёт из `now()`, а не из системных часов: так демо прокручивает минуту трафика мгновенно, и числа не зависят от скорости машины.';

export const PROXY_NOTE =
  'Этих строк достаточно, чтобы поставить `createCache` перед настоящим сервером и считать, сколько запросов до него дошло. В демо ниже тот же `createCache` работает без сети: origin там — функция, отвечающая через полторы виртуальных секунды.';

export const STALE_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`stale-while-revalidate=N`',
    d: 'N секунд после истечения кеш отдаёт старую копию сразу, а за новой идёт в фоне. Никто не ждёт origin, цена — один запрос с устаревшим ответом. В `Cache-Status` это `hit` с отрицательным `ttl`: копия уже просрочена на столько секунд.',
    tone: 'ok',
  },
  {
    t: '`stale-if-error=N`',
    d: 'Если origin ответил 5xx или не ответил вовсе, кеш N секунд после истечения отдаёт старую копию вместо ошибки. Прослойка пишет это как `fwd=stale; fwd-status=503; detail=stale-if-error`: к origin ходили, он упал, читатель этого не заметил.',
    tone: 'ok',
  },
  {
    t: 'Коллапс запросов',
    d: 'Одновременные промахи по одному ключу превращаются в один поход к origin, остальные ждут его ответа. В `Cache-Status` ожидавшие помечены `collapsed`. У Varnish это очередь ожидания, у nginx — `proxy_cache_lock`, у CDN — встроенное поведение, которое обычно не выключить.',
  },
  {
    t: 'Толпа при истечении',
    d: 'Stampede, dog-piling — момент, когда у популярной записи вышел срок и все, кто пришёл за время похода к origin, идут туда сами. Чем дольше отвечает origin и чем популярнее запись, тем больше толпа; а толпа ещё и замедляет origin, и окно растёт.',
    tone: 'err',
  },
];

export const DEMO_CAPTION =
  'Одна страница `/news`, четыре запроса в секунду в течение минуты, origin отвечает за 1,5 с, на двадцатой секунде выходит новая версия. Ниже поток — квадратик на каждый запрос, в каждом столбце одна секунда; под ним — походы к origin: одновременные стоят друг над другом, и высота стопки — это толпа.';

/**
 * Числа демо, на которые опирается текст. Пересчитывает `runStream` —
 * тот же, что крутит демо; сверяет тест.
 */
export const STREAM_NUMBERS = {
  /** `s-maxage=10`, коллапс включён, остальное выключено — как демо открывается. */
  base: { origin: 6, peak: 1, oldUntil: 22750 },
  /** То же без коллапса. */
  noCoalesce: { origin: 35, peak: 7 },
  /** `stale-while-revalidate=20` рядом с `s-maxage`: не действует, числа те же, что у `base`. */
  swrSmaxage: { origin: 6, stale: 0 },
  /** `stale-while-revalidate=20` в `CDN-Cache-Control`: ждали только первые запросы минуты. */
  swrCdn: { origin: 6, stale: 35, waits: 6 },
  /** `Vary: User-Agent` на 12 значений: коллапс включён, но ожидающие ждут чужой вариант. */
  uaCoalesce: { origin: 58, collapsed: 0, maxWait: 2750 },
  uaNoCoalesce: { origin: 60, maxWait: 1500 },
  /** Purge тега при публикации: старую версию после 20-й секунды не получил никто. */
  purge: { oldUntil: null as number | null },
};

export const INTRO_CALLOUT = `Общий кеш отличается от браузерного не местом, а тем, что **одна копия отвечает многим**. Отсюда вопросы, которых у браузера нет: вправе ли кеш показать этот ответ другому человеку, сколько разных копий у одного адреса и что будет, когда срок выйдет у всех читателей в одну и ту же секунду. В демо этой темы минута трафика на одну страницу с \`s-maxage=10\` стоит origin ${STREAM_NUMBERS.base.origin} обращений с коллапсом запросов и ${STREAM_NUMBERS.noCoalesce.origin} без него — и до ${STREAM_NUMBERS.noCoalesce.peak} одновременных запросов к origin в момент истечения.`;

/**
 * Истечение одной копии по шагам — и три механизма на нём. Автор курса (2026-09-29): трудное
 * не сокращать, а объяснять подробно и просто. `STALE_FACTS` называли механизмы, демо
 * показывало итог, но момент истечения не был разобран на пальцах: кто куда идёт в эти
 * полторы секунды. Числа — `STREAM_NUMBERS` (их пересчитывает `tests/unit/cdn-cache.test.ts`
 * тем же `runStream`, что крутит демо) и `STORM_NOTE`; правило про `s-maxage` — `SMAXAGE_NOTE`
 * (RFC 9111). Условия сцены — те же, что у демо (`DEMO_CAPTION`).
 */
export const STAMPEDE_SCENE_CODE = `Страница /news, ответ с Cache-Control: s-maxage=10
Читают 4 раза в секунду. Origin собирает страницу 1,5 с.

10,0 с   копия истекла; приходит читатель №1
10,0–11,5 с  origin собирает новую копию,
         а читатели продолжают приходить — 4 в секунду
11,5 с   новая копия готова`;

export const STAMPEDE_SCENE_NOTE =
  `Что будет **без всякой защиты**. Читатель №1 находит копию истёкшей и идёт к origin. Через четверть секунды приходит №2 — копия всё ещё истёкшая, новой пока нет, и он тоже идёт к origin. За полторы секунды так поступают все, кто успел прийти: в демо это до ${STREAM_NUMBERS.noCoalesce.peak} одновременных запросов к origin за одной и той же страницей, а за минуту — ${STREAM_NUMBERS.noCoalesce.origin} походов вместо ${STREAM_NUMBERS.base.origin}. Все они собирают одинаковый ответ. В учебной модели origin отвечает всегда за 1,5 с; настоящий под толпой отвечает медленнее — окно растёт, и в него попадает ещё больше читателей. Это и есть толпа при истечении. Три механизма раздела отвечают на один вопрос: сколько читателей из этого окна пойдут к origin сами — и сколько из них будут ждать.`;

export const STAMPEDE_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Коллапс запросов',
    when: 'читатель №2 приходит, пока поход №1 к origin ещё в пути',
    what: `Кеш видит, что за этим ключом уже пошли, и ставит №2 в очередь за ответом №1. Так же — все остальные в окне. К origin в каждый момент идёт один запрос: в демо ${STREAM_NUMBERS.base.origin} походов за минуту и ни разу не больше ${STREAM_NUMBERS.base.peak} одновременно. В \`Cache-Status\` ожидавшие помечены \`collapsed\`.`,
    cost: 'Ждут все, кто попал в окно: до полутора секунд — столько, сколько отвечает origin. И коллапс работает только по одинаковому ключу: с `Vary: User-Agent` ожидающий ждёт чужой вариант и потом идёт к origin сам.',
  },
  {
    k: '`stale-while-revalidate`',
    when: 'копия истекла, но не дольше N секунд назад',
    what: `Кеш отдаёт №1 старую копию **сразу** и сам, в фоне, идёт за новой. №2, №3 и дальше тоже получают старую копию мгновенно, пока новая не приедет. В демо с \`CDN-Cache-Control: max-age=10, stale-while-revalidate=20\` ждали только первые ${STREAM_NUMBERS.swrCdn.waits} запросов минуты — пока копии не было вовсе, — а ${STREAM_NUMBERS.swrCdn.stale} ответов ушли устаревшими.`,
    cost: `Читатель несколько секунд видит прошлую версию. И рядом с \`s-maxage\` директива по букве RFC не действует: \`s-maxage\` запрещает общему кешу отдавать устаревшее, и в демо устаревших ответов тогда ${STREAM_NUMBERS.swrSmaxage.stale}.`,
  },
  {
    k: 'Пересчёт заранее (XFetch)',
    when: 'кеш в приложении: читатель пришёл **до** истечения, но близко к нему',
    what: 'Каждый читатель бросает монетку: чем ближе срок, тем чаще она велит пересчитать. Кто-то начинает пересчёт раньше, чем копия истекла, — и к сроку новое значение уже лежит в кеше. Окно «копия истекла, новой нет» почти не возникает: в модели из таблицы ниже ни один читатель не застал ключ истёкшим — кроме одного цикла из тысячи при самом осторожном β.',
    cost: 'Монетка не блокировка: пока идёт один пересчёт, второй читатель тоже может выиграть и начать свой. В модели из таблицы ниже пересчётов выходит два-три на цикл вместо одного. Где лишний пересчёт дорог, монетку совмещают с замком.',
  },
];

/**
 * Схема к «Полторы секунды после истечения»: читатели из `STAMPEDE_SCENE_CODE` (4 в секунду,
 * №2 — через четверть секунды после №1) под тремя режимами — без защиты
 * (`STAMPEDE_SCENE_NOTE`), коллапс и `stale-while-revalidate` (`STAMPEDE_STEPS`). XFetch
 * сюда не входит: он работает **до** истечения и в кеше приложения, а схема — про окно после.
 * `stale-while-revalidate` подписан через `CDN-Cache-Control`: рядом с `s-maxage` он по RFC
 * не действует, и схема не должна обещать обратного.
 */
export const STAMPEDE_DIAGRAM: StampedeDiagramData = {
  title: 'Одни и те же читатели в окне истечения — три режима кеша',
  arrivals: ['№1 · 10,0 с', '№2 · 10,25 с', '№3 · 10,5 с', '… до 11,5 с'],
  rows: [
    {
      k: 'Без защиты',
      cells: [
        { text: '→ origin, ждёт ответ', tone: 'warn' },
        { text: '→ origin сам: новой копии ещё нет', tone: 'err' },
        { text: '→ origin сам', tone: 'err' },
        { text: 'каждый → origin сам', tone: 'err' },
      ],
      verdict: 'к origin идёт каждый, кто пришёл в окне, — и все собирают одинаковый ответ',
      tone: 'err',
    },
    {
      k: 'Коллапс запросов',
      cells: [
        { text: '→ origin, ждёт ответ', tone: 'warn' },
        { text: 'ждёт ответ №1 · `collapsed`', tone: 'warn' },
        { text: 'ждёт ответ №1 · `collapsed`', tone: 'warn' },
        { text: 'ждут ответ №1', tone: 'warn' },
      ],
      verdict: 'к origin — один запрос, но ждут все в окне: до полутора секунд',
      tone: 'warn',
    },
    {
      k: '`stale-while-revalidate` через `CDN-Cache-Control`',
      cells: [
        { text: 'старая копия сразу; кеш сам в фоне идёт к origin', tone: 'ok' },
        { text: 'старая копия сразу', tone: 'ok' },
        { text: 'старая копия сразу', tone: 'ok' },
        { text: 'старая копия сразу', tone: 'ok' },
      ],
      verdict: 'никто не ждёт, но несколько секунд читатели видят прошлую версию',
      tone: 'ok',
    },
  ],
  caption:
    'Красное — лишний поход к origin, янтарное — ожидание чужого ответа, зелёное — ответ сразу, но устаревший.',
};

export const DEMO_NOTE =
  'Что стоит переключить. Выключите коллапс — к origin пойдёт по семь запросов разом на каждом истечении. Включите `stale-while-revalidate` — рядом с `s-maxage` ничего не изменится (так велит RFC), а с `CDN-Cache-Control` ожидание исчезнет совсем. Поставьте `Vary: User-Agent` — двенадцать браузеров превратят одну страницу в двенадцать, и коллапс уже не спасает: ожидающие ждут чужой вариант и потом идут к origin сами, а самое долгое ожидание растёт с 1,5 до 2,75 с. И посмотрите на строку «старую версию отдавали до»: без purge новость, вышедшая на 20-й секунде, доезжает до читателя только с истечением копии.';

export const XFETCH_PLAIN =
  'Вместо того чтобы ждать, пока суп кончится, каждый подходящий к раздаче бросает монетку: «не поставить ли новую кастрюлю?». Далеко до конца — монетка почти никогда не выпадает, у самого дна — почти всегда. Кто-то один поставит кастрюлю заранее, и очередь не заметит перехода.';

export const XFETCH_FORMULA = 'пересчитать, если   now − Δ · β · ln(rand())  ≥  expiry';

export const XFETCH_NOTE =
  '`rand()` — случайное число из (0, 1], его логарифм отрицателен, поэтому `−Δ · β · ln(rand())` — случайная добавка к текущему времени. Δ — сколько длится пересчёт (замеряется при последнем пересчёте и хранится рядом со значением), β — смелость. Вероятность пересчитать за `g` дельт до истечения — `exp(−g / β)`: при β = 1 за одну дельту это 37 %, за три — 5 %. Функция не требует ни блокировки, ни координации: каждый решает сам, а длинные пересчёты начинаются раньше коротких.';

/** Доля «пересчитать» за `gap` дельт до истечения. Сверяется и с формулой, и с бросками функции. */
export const XFETCH_ROWS: { gap: string; g: number; b05: string; b1: string; b2: string }[] = [
  { gap: '3Δ', g: 3, b05: '0,2 %', b1: '5,0 %', b2: '22,3 %' },
  { gap: '2Δ', g: 2, b05: '1,8 %', b1: '13,5 %', b2: '36,8 %' },
  { gap: '1Δ', g: 1, b05: '13,5 %', b1: '36,8 %', b2: '60,7 %' },
  { gap: '0,5Δ', g: 0.5, b05: '36,8 %', b1: '60,7 %', b2: '77,9 %' },
  { gap: 'в момент истечения', g: 0, b05: '100 %', b1: '100 %', b2: '100 %' },
];

/**
 * Один цикл истечения ключа: TTL 60 с, пересчёт 2 с, чтение каждые 20 мс (50 в секунду),
 * блокировки нет. По 1000 циклов на строку, зёрна 1…1000. Пересчитывает `expiryStorm`.
 */
export const STORM_ROWS: {
  k: string;
  beta: number | null;
  mean: string;
  median: number;
  max: number;
  waitedCycles: number;
  tone?: 'ok' | 'warn' | 'err';
}[] = [
  { k: 'только по истечении', beta: null, mean: '100', median: 100, max: 100, waitedCycles: 1000, tone: 'err' },
  { k: 'XFetch, β = 0,5', beta: 0.5, mean: '7,1', median: 5, max: 57, waitedCycles: 1, tone: 'warn' },
  { k: 'XFetch, β = 1', beta: 1, mean: '2,7', median: 2, max: 13, waitedCycles: 0, tone: 'ok' },
  { k: 'XFetch, β = 2', beta: 2, mean: '1,7', median: 1, max: 6, waitedCycles: 0, tone: 'ok' },
];

export const STORM_NOTE =
  'Ключ живёт 60 с, пересчёт длится 2 с, читают его 50 раз в секунду, блокировки нет; тысяча циклов истечения на строку. XFetch — не блокировка: второй читатель, бросивший монетку во время чужого пересчёта, тоже пересчитает. Поэтому пересчётов не один, а два-три, зато ни один читатель не застал ключ истёкшим — кроме одного цикла из тысячи при слишком осторожном β = 0,5. Где лишний пересчёт дорог, XFetch совмещают с блокировкой: монетка решает, **когда** начать, замок — **кто** начнёт.';

// ─── Раздел 4. Сброс ─────────────────────────────────────────────────────────────────────

export const PURGE_CODE = `HTTP/1.1 200 OK
Cache-Control: public, max-age=60, s-maxage=86400
Surrogate-Key: news article-1842 author-17
Cache-Tag: news,article-1842,author-17

# редакция поправила статью 1842:
PURGE /  Surrogate-Key: article-1842     → сама статья, лента, где она в анонсе, RSS
# у автора 17 сменилось фото:
PURGE /  Surrogate-Key: author-17         → все его статьи разом`;

export const PURGE_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Purge по адресу',
    d: 'Удаляет одну запись со всеми её вариантами по `Vary`. Годится, когда вы точно знаете адрес. Не годится, когда одна правка меняет десятки страниц: ленту, анонсы, RSS, выдачу по тегу, — перечислить их все никто не сможет.',
  },
  {
    t: 'Purge по тегу',
    d: 'Origin метит ответ тегами — `Surrogate-Key` у Fastly, `Cache-Tag` у Cloudflare, `Edge-Cache-Tag` у Akamai, — и одна команда сбрасывает всё, что помечено. Тег описывает **данные** («статья 1842»), а не адрес: страница, собранная из трёх статей, несёт три тега.',
    tone: 'ok',
  },
  {
    t: 'Мягкий purge',
    d: 'Не удаляет запись, а объявляет её устаревшей. Дальше работают обычные правила: с `stale-while-revalidate` читатель получит старое мгновенно, а новое уйдёт в фон; с `stale-if-error` упавший origin не превратит purge в ошибку. У Fastly это soft purge.',
  },
  {
    t: 'Purge не догоняет браузер',
    d: 'Сбросить можно только тот кеш, которым вы управляете. Копия, уже лежащая у читателя с `max-age=3600`, проживёт свой час. Поэтому `max-age` держат коротким, а долгий срок пишут в `s-maxage` — туда, куда purge дотягивается.',
    tone: 'warn',
  },
];

export const VERSION_ROWS: { k: string; version: string; purge: string }[] = [
  { k: 'Что меняется при обновлении', version: 'адрес: `app.3f9a1c.js` → `app.b72e04.js`', purge: 'ничего: адрес тот же, копию выбрасывают' },
  { k: 'Срок кеша', version: 'год и `immutable` — файл по этому адресу не изменится никогда', purge: 'любой, но браузерная часть должна быть короткой' },
  { k: 'Кого достаёт', version: 'всех: браузеры, CDN, прокси — новый адрес для всех новый', purge: 'только кеши, у которых есть API purge' },
  { k: 'Гонки', version: 'нет: старый и новый файл живут рядом', purge: 'есть: ответ, запрошенный до purge, может лечь в кеш после него' },
  { k: 'Где не работает', version: 'адреса, которые нельзя менять: HTML-страницы, API, `/robots.txt`', purge: '—' },
];

export const VERSION_NOTE =
  'Версия в адресе и purge не соперники, а два этажа одной схемы: файлы с хешем в имени кешируются навсегда и не сбрасываются никогда, а HTML, который на них ссылается, живёт под постоянным адресом с коротким `max-age` и сбрасывается purge. Как устроен хеш в имени — в [«GitHub Pages»](/delivery/github-pages/#s4) и [«Сети и кешировании»](/platform/network/#s2).';

export const PURGE_RACE_NOTE =
  'Гонка purge с походом к origin воспроизводится и на учебной прослойке. Запрос ушёл к origin до публикации, purge пришёл, пока он в пути, ответ со старой версией лёг в кеш **после** purge — и продержится весь свой срок. Лечится повторным purge через время, заведомо большее ответа origin, или мягким purge, который не даёт старой копии свежести.';

// ─── Раздел 5. CDN изнутри ───────────────────────────────────────────────────────────────

export const CDN_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'PoP и зачем он близко',
    d: 'Сотни площадок по миру, у каждой свой кеш. Выигрыш — в RTT: TLS-рукопожатие и первые байты ответа идут до соседнего города, а не через океан. Даже промах выгоден: от PoP до origin CDN держит тёплые долгие соединения, и холодный старт TCP и TLS платится на коротком плече.',
  },
  {
    t: 'Anycast',
    d: 'Один и тот же IP-адрес объявлен по BGP из всех PoP сразу, и маршрутизация сама доставляет пакет в «ближайший» — ближайший по маршрутам, а не по карте. Отказ PoP — это снятое объявление: трафик уходит к соседу без смены DNS.',
  },
  {
    t: 'Маршрутизация через DNS',
    d: 'Авторитетный DNS CDN отвечает разным резолверам разными адресами — по расположению резолвера или по подсети клиента из EDNS Client Subnet. Короткий TTL у таких записей нужен, чтобы увести трафик с больной площадки за минуты.',
  },
  {
    t: 'Щит (tiered cache, origin shield)',
    d: 'Промах в PoP идёт не к origin, а к кешу уровнем выше — одному на регион или на весь мир. Сто PoP, промахнувшихся по одному адресу, превращаются в один запрос к origin. Цена — лишнее плечо на промахе и ещё один кеш, который тоже надо сбрасывать.',
    tone: 'ok',
  },
];

/** PoP → щит → origin на виртуальных часах. Пересчитывает `tierLog`. */
export const TIER_LOG: { t: number; pop: string; age: string; cacheStatus: string }[] = [
  { t: 0, pop: 'Франкфурт', age: '0', cacheStatus: 'shield; fwd=uri-miss; fwd-status=200; stored, fra; fwd=uri-miss; fwd-status=200; stored' },
  { t: 30, pop: 'Варшава', age: '30', cacheStatus: 'shield; hit; ttl=30, waw; fwd=uri-miss; fwd-status=200; stored' },
  { t: 45, pop: 'Варшава', age: '45', cacheStatus: 'shield; hit; ttl=30, waw; hit; ttl=15' },
  { t: 61, pop: 'Варшава', age: '0', cacheStatus: 'shield; fwd=stale; fwd-status=304; stored, waw; fwd=stale; fwd-status=200; stored' },
  { t: 62, pop: 'Франкфурт', age: '1', cacheStatus: 'shield; hit; ttl=59, fra; fwd=stale; fwd-status=200; stored' },
];

export const TIER_ORIGIN = 2;

export const TIER_NOTE =
  'Ответ с `max-age=60`, два PoP за одним щитом, пять запросов за минуту — и два обращения к origin: первое и ревалидация. Три вещи, которые видно в журнале. **Варшава получила копию с `Age: 30`** — щит хранил её полминуты, и эти полминуты вычтены из срока: переложив копию, свежее её не сделать, поэтому `ttl=15` на 45-й секунде. **`Cache-Status` читается слева направо от origin к читателю**: первым пишет щит, последним — PoP, который ответил. **Запись щита в строке 45-й секунды — старая**: она приехала вместе с копией на 30-й и хранится в ней; что щит делает сейчас, из этой строки не узнать.';

export const CACHE_STATUS_CODE = `Cache-Status: shield; hit; ttl=30, waw; fwd=uri-miss; fwd-status=200; stored
              └──── щит ──────┘  └──────────── PoP, ближайший к читателю ────────┘`;

export const CACHE_STATUS_ROWS: { k: string; d: string }[] = [
  { k: 'hit', d: 'ответ отдан из кеша, к origin не ходили' },
  { k: 'fwd=…', d: 'почему пошли дальше: `uri-miss` — записи нет, `vary-miss` — нет нужного варианта, `stale` — копия устарела, `method` — метод не кешируется, `bypass` — кеш настроен не хранить, `request` — так попросил клиент' },
  { k: 'fwd-status', d: 'что ответили дальше по цепочке: `304` при ревалидации, `503`, если origin упал' },
  { k: 'ttl', d: 'сколько секунд копия ещё свежа; отрицательное — насколько уже просрочена' },
  { k: 'stored', d: 'ответ, пришедший дальше по цепочке, положен в кеш' },
  { k: 'collapsed', d: 'запрос не пошёл сам, а дождался чужого похода за тем же ключом' },
  { k: 'key, detail', d: 'ключ записи и свободное пояснение — прослойка пишет туда `stale-while-revalidate` и `stale-if-error`' },
];

export const DIAG_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`Age`',
    d: 'Сколько секунд копия провела в кешах по пути, включая все уровни. Браузер вычитает его из `max-age`: ответ с `max-age=60` и `Age: 45` свеж у читателя 15 секунд, а не минуту.',
  },
  {
    t: '`X-Cache`',
    d: '`HIT`, `MISS`, `HIT, MISS` — самодельный заголовок, у каждого CDN свой формат и свой порядок записей. Читается, но сравнивать между CDN нельзя.',
  },
  {
    t: '`Cache-Status` (RFC 9211)',
    d: 'Стандартная замена: список, по записи на кеш, с именем кеша и параметрами из таблицы выше. Имя — любое, его выбирает кеш: у прослойки это `edge`, `shield`, `fra`, `waw`.',
    tone: 'ok',
  },
];

// ─── Раздел 6. Кеш в приложении ──────────────────────────────────────────────────────────

export const APP_LAYERS: { k: string; mem: string; redis: string }[] = [
  { k: 'Где живёт', mem: 'в куче процесса, `Map` или LRU', redis: 'отдельный сервер, по сети' },
  { k: 'Цена чтения', mem: 'вызов функции', redis: 'сетевой круг, сериализация и разбор' },
  { k: 'Кто видит запись', mem: 'только этот процесс; у восьми экземпляров восемь разных копий', redis: 'все экземпляры сразу' },
  { k: 'Переживает рестарт и деплой', mem: 'нет: каждый деплой — холодный кеш и толпа к базе', redis: 'да' },
  { k: 'Инвалидация', mem: 'надо разослать всем процессам — чаще просто короткий TTL', redis: 'одна команда `DEL`' },
  { k: 'Чем ограничен', mem: 'кучей процесса — большой кеш двигает лимит памяти и паузы GC', redis: '`maxmemory` и политикой вытеснения' },
];

export const APP_LAYERS_NOTE =
  'Их часто ставят вместе: маленький LRU в процессе на секунды перед Redis на минуты. Первый снимает самые горячие ключи без сети, второй — всё остальное без базы. Почему кеш в куче процесса не бесплатен — в [«Память в Node»](/js/node-memory/).';

export const LRU_NOTE =
  '`Map` помнит порядок вставки — на этом держится весь LRU. Чтение переставляет ключ в конец, вставка сверх лимита выбрасывает первый. Этим же классом посчитана таблица долей попаданий в разделе «Ключ и Vary». Redis честного LRU не держит: при нехватке памяти он берёт несколько случайных ключей (`maxmemory-samples`, по умолчанию 5) и вытесняет самый давний из них — приближение, которое не требует списка на все ключи. По умолчанию же политика `noeviction`: память кончилась — запись падает с ошибкой.';

export const PATTERN_ROWS: { k: string; read: string; write: string; risk: string }[] = [
  { k: 'cache-aside', read: 'приложение смотрит в кеш, при промахе читает базу и кладёт в кеш', write: 'пишет в базу и удаляет ключ', risk: 'гонка ниже; зато кеш можно выключить — всё работает, только медленнее' },
  { k: 'read-through', read: 'приложение спрашивает только кеш, базу при промахе читает он сам', write: 'как в cache-aside', risk: 'та же гонка, спрятанная в библиотеку' },
  { k: 'write-through', read: 'из кеша', write: 'запись идёт через кеш: он пишет в базу и держит новое значение', risk: 'каждая запись дороже; кеш забивается тем, что никто не читает' },
  { k: 'write-behind', read: 'из кеша', write: 'кеш принимает запись и сбрасывает в базу позже, пачками', risk: 'упал кеш до сброса — записи потеряны' },
];

export const PLAIN_RACE =
  'Вы переписали адрес в записной книжке и зачеркнули старую бумажку на холодильнике. Но сосед успел прочитать книжку за минуту до этого и как раз сейчас приклеивает на холодильник новую бумажку — со старым адресом. Каждый действовал правильно, а результат неверный: порядок событий решил за них.';

/** Что сделал `raceAside` с `ASIDE_CODE`. Сверяет тест. */
export const RACE_LOG = [
  'get user:1 → промах',
  'читатель: база → Анна',
  'писатель: база ← Мария',
  'писатель: del user:1',
  'читатель: кеш ← Анна',
  'get user:1 → Анна',
];

export const RACE_RESULT = { db: 'Мария', cached: 'Анна' };

export const RACE_NOTE =
  'В базе «Мария», в кеше «Анна» — и так до конца TTL. Удаление ключа после записи этого не лечит: удалили раньше, чем читатель положил старое. Что помогает: TTL как предохранитель — гонка не вечна; повторное удаление через время, большее самого долгого чтения; версия в значении, когда запись принимается, только если она новее. И главное — знать, что cache-aside не даёт согласованности, а даёт «в конце концов, через TTL».';

/** Десять тысяч ключей с TTL 3600 с, прогретых в одну секунду. Пересчитывает `expiryPeak`. */
export const JITTER_ROWS: { k: string; spread: number | null; peak: number; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'без джиттера', spread: null, peak: 10000, tone: 'err' },
  { k: '`ttlWithJitter(3600, 0.01)` — ±1 %', spread: 0.01, peak: 159, tone: 'warn' },
  { k: '`ttlWithJitter(3600, 0.1)` — ±10 %', spread: 0.1, peak: 26, tone: 'ok' },
];

export const JITTER_NOTE =
  'Прогрели кеш при деплое — и ровно через час все десять тысяч ключей истекут в одну и ту же секунду, и все десять тысяч чтений уйдут в базу. Джиттер в ±10 % размазывает истечение на двенадцать минут, и в худшую секунду база получает 26 запросов вместо десяти тысяч. Это та же толпа, что в разделе «Срок вышел», только по многим ключам сразу.';

// ─── Тонкие места ────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`private` в `Cache-Control` не действует, если есть `CDN-Cache-Control`',
    d: 'CDN, понимающий адресный заголовок (RFC 9213), берёт политику только из него. `Cache-Control: private` рядом с `CDN-Cache-Control: max-age=600` для такого CDN не существует — личный ответ будет роздан всем. Запрет для CDN пишут в адресный заголовок: `CDN-Cache-Control: no-store`.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`Set-Cookie` в кешируемом ответе',
    d: 'RFC не запрещает общему кешу хранить ответ с `Set-Cookie`. Страница с `public, max-age=60`, выставившая сессионную куку, раздаст эту куку каждому следующему читателю. Многие CDN по умолчанию такие ответы не кешируют, но полагаться на умолчание чужого сервиса — значит однажды его сменить. Надёжно: `private="Set-Cookie"` или не ставить куки на кешируемых адресах.',
    code: 'Cache-Control: public, max-age=60\nSet-Cookie: sid=a1b2        ← уедет всем, кто получит копию',
    tone: 'err',
  },
  {
    n: '03',
    t: '`s-maxage` выключает `stale-while-revalidate` — по букве RFC',
    d: '`s-maxage` несёт семантику `proxy-revalidate`, а она запрещает отдавать устаревшее без проверки. Учебная прослойка следует букве, и в демо пара `s-maxage=10, stale-while-revalidate=20` даёт ровно то же, что `s-maxage=10`. Многие CDN читают эту пару мягче, но это их решение, а не стандарт.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Коллапс не помогает, когда вариантов много',
    d: 'Ожидание идёт по первичному ключу, а ответ подходит только своему варианту. С `Vary: User-Agent` ожидающий дождался чужого ответа, не подошёл под него и пошёл к origin сам: в демо самое долгое ожидание с коллапсом — 2,75 с, без коллапса — 1,5 с. Обращений к origin почти столько же (58 против 60), а ждут почти вдвое дольше.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Purge во время похода к origin',
    d: 'Ответ, запрошенный до purge, ложится в кеш после него и живёт полный срок со старой версией. Прослойка воспроизводит это тестом. Второй purge через время больше самого долгого ответа origin или мягкий purge закрывают окно.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Заголовок, от которого зависит ответ, но которого нет в ключе',
    d: 'Origin строит ссылки из `X-Forwarded-Host`, а в ключ и `Vary` этот заголовок не входит. Один запрос с подменённым заголовком — и в общий кеш ложится страница со ссылками на чужой домен, которую получат все. Это отравление кеша: всё, что читает origin, должно быть либо в ключе, либо проигнорировано им.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Нормализация, выбросившая значимый параметр',
    d: 'Отрезать `utm_*` безопасно, потому что origin их не читает. Отрезать `?page=2` — значит отдавать первую страницу вместо второй. Так же опасно приводить путь к нижнему регистру: для статического сервера на Linux `/News` и `/news` — разные файлы.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`POST` выбрасывает копию только из одного кеша',
    d: 'Успешный небезопасный запрос на адрес инвалидирует копию этого адреса (RFC 9111, §4.4) — в том кеше, через который прошёл. Соседний PoP о нём не узнает, браузер читателя тоже. Прослойка это делает, но полагаться на это как на механизм сброса нельзя.',
  },
  {
    n: '09',
    t: 'Удаление ключа после записи не делает cache-aside согласованным',
    d: 'Читатель, прочитавший базу до записи, кладёт старое значение после удаления — и оно живёт весь TTL. Прогон `ASIDE_CODE` воспроизводит это без единого таймера. Без TTL такой кеш врёт вечно.',
    tone: 'err',
  },
  {
    n: '10',
    t: 'Копия не свежеет, переезжая между уровнями',
    d: 'Щит отдаёт копию вместе с `Age`, и PoP вычитает его из срока. Если PoP показывает `ttl` меньше `s-maxage` сразу после промаха, это не ошибка: копия пролежала это время в щите.',
  },
];

// ─── Источники ───────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'RFC 9111 — HTTP Caching',
    href: 'https://www.rfc-editor.org/rfc/rfc9111',
    what: '§3 и §3.5 — когда общий кеш вправе хранить, §4.2 — свежесть и `Age`, §4.2.4 — когда нельзя отдавать устаревшее, §4.4 — инвалидация небезопасным методом, §5.2.2.10 — `s-maxage` и `proxy-revalidate`',
  },
  {
    title: 'RFC 5861 — HTTP Cache-Control Extensions for Stale Content',
    href: 'https://www.rfc-editor.org/rfc/rfc5861',
    what: '`stale-while-revalidate` и `stale-if-error`',
  },
  {
    title: 'RFC 9211 — The Cache-Status HTTP Response Header Field',
    href: 'https://www.rfc-editor.org/rfc/rfc9211',
    what: 'формат записи, порядок кешей в списке, параметры `hit`, `fwd`, `fwd-status`, `ttl`, `stored`, `collapsed`, `key`, `detail`',
  },
  {
    title: 'RFC 9213 — Targeted HTTP Cache Control',
    href: 'https://www.rfc-editor.org/rfc/rfc9213',
    what: '`CDN-Cache-Control` и правило «адресный заголовок заменяет `Cache-Control` целиком»',
  },
  {
    title: 'RFC 9110 — HTTP Semantics, §15.1',
    href: 'https://www.rfc-editor.org/rfc/rfc9110#section-15.1',
    what: 'какие статусы кешируются эвристически',
  },
  {
    title: 'Vattani, Chierichetti, Lowenstein — Optimal Probabilistic Cache Stampede Prevention (VLDB 2015)',
    href: 'https://www.vldb.org/pvldb/vol8/p886-vattani.pdf',
    what: 'формула XFetch и параметр β',
  },
  {
    title: 'Fastly — Purging with surrogate keys',
    href: 'https://docs.fastly.com/en/guides/working-with-surrogate-keys',
    what: '`Surrogate-Key`, мягкий purge',
  },
  {
    title: 'Redis — Key eviction',
    href: 'https://redis.io/docs/latest/develop/reference/eviction/',
    what: 'политики `maxmemory-policy`, приближённый LRU и `maxmemory-samples`',
  },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, «Кеш и валидация»](/platform/network/#s2) — браузерная половина: свежесть, `ETag`, `304`, `Vary` со стороны браузера и три слоя кеша. [GitHub Pages, «Кеш и инвалидация статики»](/delivery/github-pages/#s4) — хеш в имени файла, когда заголовки пишете не вы. [Долгие соединения, «Переподключение и heartbeat»](/platform/realtime/#s6) — та же толпа и тот же джиттер, только у клиентов, а не у ключей. [Вход в кластер, «SPA, кеш, WebSocket»](/delivery/ingress/#s7) — обратный прокси перед приложением в Kubernetes. [Память в Node](/js/node-memory/) — во что обходится кеш в куче процесса. [Сжатие в вебе](/platform/compression/) — выбор кодировки по `Accept-Encoding`, уровни, словари сжатия и BREACH. [Кеши с вытеснением](/algorithms/eviction/) — LRU на `Map` и в `lru-cache`, провалы LRU на скане и цикле, LFU, W-TinyLFU и SIEVE.';
