import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LocationProbe, ProbeGroup } from '@/widgets/nginx-lab/model/types';

/**
 * Данные темы «Nginx как обратный прокси: от location до кеша».
 *
 * Тема написана здесь, 2026-10-01, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * nginx **1.30.0** (образ `nginx:1.30.0-alpine-slim`), для сравнения — **1.27.5**
 * (`nginx:1.27-alpine`). Docker Desktop на macOS, Node 24.11.0. Один контейнер, все конфиги
 * в `conf.d`, порты контейнера 8080–8088 проброшены наружу. Бэкенд — свой `node:http` на хосте,
 * в конфиге он виден под именем `app` (`docker run --add-host app:host-gateway`). Бэкенд пишет
 * в журнал каждый запрос: путь, версию HTTP и заголовки `Host`, `X-Forwarded-*`, `X-Real-IP`,
 * `Connection`. Клиент — скрипты на `node:http` и `node:net` (сырой запрос, чтобы управлять `Host`).
 *
 * ⚠️ Сначала бэкенд был адресован через `host.docker.internal`. Это имя в Docker Desktop
 * разрешается и в IPv4, и в IPv6; nginx пробовал IPv6, получал ошибку и шёл на IPv4 — для
 * журнала путей это ничего не меняло, но таймаут превращался в 502 вместо 504 (после таймаута
 * nginx шёл ко второму адресу). Всё ниже переснято с `app`, у которого адрес один.
 *
 * Что нормализовано:
 *   — в `LOC_CONF` и `LOC_JOURNAL` на стенде у каждой location была ещё строка
 *     `add_header X-Loc "<номер>" always;` — по ней журнал узнаёт, какая location ответила.
 *     В теме эта строка вырезана, а каждая location записана в одну строку; набор location,
 *     их порядок, модификаторы и `proxy_pass` — те же;
 *   — порт 52210 снаружи (клиент) и 8080 внутри (то, что nginx пишет в `Location`) оставлены
 *     как есть: расхождение — одно из наблюдений темы;
 *   — `172.17.0.1` — адрес клиента, каким его видит nginx в контейнере (шлюз сети Docker).
 *
 * Буферизация SSE (`STREAM_ROWS`) — это **порядок, а не замер скорости**: бэкенд шлёт пять
 * событий раз в 300 мс и пишет в журнал момент отправки каждого. Для каждого чтения клиента
 * считается, сколько событий бэкенд к этому моменту уже отправил. `[1,2,3,4,5]` — каждое
 * событие пришло отдельно; `[5]` — одно чтение после того, как ушли все пять. Прогон повторён
 * трижды на 1.30 и дважды на 1.27 — совпал.
 *
 * Кеш (`CACHE_*`) — последовательности запросов с паузами: `max-age=2` и пауза 3,2 с, потому что
 * nginx считает срок в целых секундах (с `max-age=1` и паузой 1,5 с запись иногда ещё свежая).
 * Толпа — 10 одновременных запросов к холодному ключу, бэкенд отвечает через 500 мс; число
 * походов к бэкенду — по журналу бэкенда. Повторено дважды — совпало.
 *
 * Размер gzip: тело — JSON из 60 записей, 2811 байт; nginx отдал 458. Тест сверяет: тот же
 * JSON, сжатый `zlib.gzipSync` с уровнем 1 (умолчание `gzip_comp_level`), — тоже 458.
 *
 * Сообщение браузера в `SPA_NOTE` — Chromium 153.0.8010.12 (Playwright), страница со старым
 * `<script type="module" src="/assets/app-1b7e04.js">`, отданная первым SPA-сервером стенда.
 *
 * Только по документации, не прогоном (помечено в тексте): что `proxy_read_timeout` меряет
 * паузу между двумя чтениями, а не весь ответ; что `Vary: *` запрещает кеширование; значения
 * `$upstream_cache_status`, которых не было на стенде (`BYPASS`, `UPDATING`, `REVALIDATED`);
 * смена умолчаний в 1.29.7 (по `CHANGES` nginx) — версия на стенде показывает её следствие.
 * Почему nginx 1.30 с `proxy_buffering on` отдаёт события из ответа с `chunked` сразу, в
 * документации не описано — в теме это записано как наблюдение стенда.
 *
 * `LOCATION_CODE`, `PROXY_CODE` и `SERVER_CODE` — учебная модель. `tests/unit/nginx-proxy.test.ts`
 * прогоняет её по всем адресам журналов `LOC_JOURNAL`, `NORM_JOURNAL` и `SERVER_JOURNAL`
 * и требует того же ответа, что дал nginx: какая location ответила, какой путь увидел бэкенд,
 * куда ушёл редирект, какой server ответил на `Host`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'обратный прокси',
    d: 'Сервер, который принимает запросы вместо вашего приложения и пересылает их ему. Браузер говорит только с прокси и про приложение за ним ничего не знает.',
  },
  {
    k: 'бэкенд (upstream)',
    d: 'Тот, кому прокси пересылает запрос: Node, Go, Python — что угодно, что отвечает по HTTP. В конфиге nginx — блок `upstream` или адрес прямо в `proxy_pass`.',
  },
  {
    k: '`server`',
    d: 'Блок конфига nginx про один сайт: на каком порту слушать (`listen`) и на какие имена отвечать (`server_name`).',
  },
  {
    k: '`location`',
    d: 'Блок внутри `server`: правило для части адресов — по префиксу, по точному пути или по регулярному выражению. Каждый запрос обслуживает ровно одна location.',
  },
  {
    k: '`proxy_pass`',
    d: 'Директива «переслать запрос туда-то». От того, есть ли после адреса бэкенда путь (хоть один `/`), зависит, какой путь бэкенд увидит.',
  },
  {
    k: 'нормализация адреса',
    d: 'То, что nginx делает с путём до сравнения: раскрывает `%XX`, склеивает `//` в `/`, разбирает `.` и `..`. Location сравнивается уже с результатом.',
  },
  {
    k: 'буферизация ответа',
    d: 'Прокси читает ответ бэкенда в свою память и отдаёт клиенту потом. Бэкенд освобождается быстрее, но то, что должно идти по кусочку, может прийти одной пачкой.',
  },
];

export const PLAIN_PROXY =
  'Как секретарь на входе в офис. Посетитель отдаёт письмо ему, а не директору. Секретарь смотрит на адрес на конверте и решает, в какой кабинет нести, может переписать адрес, приложить записку «от кого пришло» и подождать, пока письмо прочтут. Директор видит только то, что секретарь донёс.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем. Если что-то незнакомо — хватит раздела по ссылке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Хост и путь запроса',
    d: 'В каждом HTTP-запросе есть имя сайта — заголовок `Host` — и путь вроде `/api/users?page=2`. По этим двум вещам прокси решает, кому отдать запрос. В Kubernetes то же самое решает Ingress.',
    href: '/delivery/ingress/#s2',
    hrefLabel: '«Вход в кластер», раздел «Ingress: хост и путь»',
    tone: 'info',
  },
  {
    t: 'Контейнеры и имена сервисов',
    d: 'nginx в примерах запущен в контейнере, а бэкенд виден ему по имени `app`. Как контейнеры находят друг друга по именам и что такое проброс порта, разобрано в теме про Compose.',
    href: '/delivery/compose/#s1',
    hrefLabel: '«Docker Compose», раздел «Сервис, сеть и имена»',
    tone: 'info',
  },
  {
    t: 'Клиентский роутер SPA',
    d: 'Одностраничное приложение рисует `/profile/42` скриптом в браузере, а на диске у него один `index.html`. Сервер должен отдавать его на любой такой адрес.',
    href: '/delivery/github-pages/#s3',
    hrefLabel: '«GitHub Pages», раздел «Маршрутизация без сервера»',
    tone: 'info',
  },
  {
    t: 'HTTP-кеш и `max-age`',
    d: 'Ответ с `Cache-Control: max-age=60` можно хранить 60 секунд и отдавать без похода на сервер. Чем частный кеш браузера отличается от общего и что делать, когда срок вышел у всех сразу, — в двух темах.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
];

// ─── Раздел 1. Какой server ответит ────────────────────────────────────────────────────────

export const PLAIN_SERVER =
  'Как почтовый ящик на многоквартирном доме. Сначала письмо приходит по адресу дома — это порт. Потом его разносят по квартирам по фамилии на конверте — это `Host`. Если фамилии в доме нет, письмо не выбрасывают, а кладут в ящик «по умолчанию» — и если такой ящик не назначен, им становится первый по списку.';

/** Конфиг стенда для выбора server, как он был запущен. */
export const SERVER_CONF = `server {
    listen 8081;
    server_name first.test;
    return 200 "first.test\\n";
}
server {
    listen 8081;
    server_name shop.test www.shop.test;
    return 200 "shop.test\\n";
}
server {
    listen 8081;
    server_name *.shop.test;
    return 200 "*.shop.test\\n";
}
server {
    listen 8081;
    server_name shop.*;
    return 200 "shop.*\\n";
}
server {
    listen 8081;
    server_name ~^(?<branch>[a-z0-9-]+)\\.preview\\.test$;
    return 200 "preview: $branch\\n";
}
server {
    listen 8081;
    server_name ~\\.test$;
    return 200 "any .test\\n";
}
server {
    listen 8082;
    server_name shop.test;
    return 200 "shop.test\\n";
}
server {
    listen 8082 default_server;
    server_name _;
    return 444;
}`;

/** Журнал стенда: какой server ответил на `Host`. `null` — запрос HTTP/1.0 без `Host`. */
export const SERVER_JOURNAL: { port: number; host: string | null; answer: string }[] = [
  { port: 8081, host: 'shop.test', answer: 'shop.test' },
  { port: 8081, host: 'www.shop.test', answer: 'shop.test' },
  { port: 8081, host: 'api.shop.test', answer: '*.shop.test' },
  { port: 8081, host: 'a.b.shop.test', answer: '*.shop.test' },
  { port: 8081, host: 'shop.local', answer: 'shop.*' },
  { port: 8081, host: 'feat-42.preview.test', answer: 'preview: feat-42' },
  { port: 8081, host: 'blog.test', answer: 'any .test' },
  { port: 8081, host: 'unknown.example', answer: 'first.test' },
  { port: 8081, host: 'SHOP.TEST', answer: 'shop.test' },
  { port: 8081, host: 'shop.test:8081', answer: 'shop.test' },
  { port: 8081, host: 'shop.test.', answer: 'shop.test' },
  { port: 8081, host: '127.0.0.1', answer: 'first.test' },
  { port: 8081, host: null, answer: 'first.test' },
  { port: 8082, host: 'shop.test', answer: 'shop.test' },
  { port: 8082, host: 'www.shop.test', answer: 'закрыто без ответа' },
  { port: 8082, host: 'api.shop.test', answer: 'закрыто без ответа' },
  { port: 8082, host: 'unknown.example', answer: 'закрыто без ответа' },
  { port: 8082, host: '127.0.0.1', answer: 'закрыто без ответа' },
  { port: 8082, host: null, answer: 'закрыто без ответа' },
];

export const SERVER_STEPS = [
  { k: '1. Порт', d: 'Сначала nginx берёт только те `server`, у которых `listen` совпал с портом, на который пришло соединение. Имя тут ещё не смотрят.' },
  { k: '2. Точное имя', d: 'Имя из `Host` без порта и без точки в конце, в нижнем регистре: `SHOP.TEST`, `shop.test:8081` и `shop.test.` — всё это `shop.test`.' },
  { k: '3. Звёздочка в начале', d: 'Самое длинное имя вида `*.shop.test`. Звёздочка у nginx закрывает **любое число** меток: `a.b.shop.test` тоже подходит. Сам `shop.test` — нет.' },
  { k: '4. Звёздочка в конце', d: 'Самое длинное имя вида `shop.*`: `shop.local`, `shop.dev` и так далее.' },
  { k: '5. Регулярки', d: 'Имена с `~` в начале — по порядку в конфиге, первая совпавшая побеждает. Из регулярки можно достать кусок имени: `$branch` дал `feat-42`.' },
  { k: '6. Сервер по умолчанию', d: 'Ничего не совпало — отвечает `server` с `default_server` на этом порту, а если такого нет, **первый** по порядку в конфиге.' },
];

export const SERVER_NOTE =
  'Шестой шаг — главная ловушка. На порту 8081 `default_server` не указан, и на `unknown.example`, на голый IP и на запрос без `Host` ответил `first.test` — просто потому, что он первый в файле. Переставили файлы в `conf.d`, и чужие имена начал обслуживать другой сайт. На порту 8082 есть явный `default_server` с `return 444`: это особый код nginx «закрыть соединение, ничего не отвечая». Клиент видит обрыв, а сканер, который ходит по IP, не узнаёт, какие сайты здесь живут.';

/** Выбор server: учебная модель. Исполняется тестом на `SERVER_JOURNAL`. */
export const SERVER_CODE = `// server в конфиге: порт из listen, флаг default_server и имена.
function parseServers(conf) {
  return [...conf.matchAll(/server\\s*\\{([^}]*)\\}/g)].map((m, i) => {
    const listen = /listen\\s+(\\d+)([^;]*);/.exec(m[1]);
    const names = /server_name\\s+([^;]+);/.exec(m[1])?.[1].trim().split(/\\s+/) ?? [];
    return { index: i, port: Number(listen[1]), isDefault: /default_server/.test(listen[2]), names };
  });
}

// Выбор server по порядку из документации nginx: сначала порт, потом имя.
function findServer(servers, port, host) {
  const list = servers.filter((s) => s.port === port);
  // Порт и точка в конце из Host не участвуют, регистр не важен.
  const name = (host ?? '').toLowerCase().replace(/:\\d+$/, '').replace(/\\.$/, '');
  const longest = (test) => {
    let best = null;
    for (const s of list) for (const n of s.names) {
      if (test(n) && (!best || n.length > best.n.length)) best = { s, n };
    }
    return best;
  };
  const steps = [
    ['exact', longest((n) => n === name)],
    ['*.', longest((n) => n.startsWith('*.') && name.endsWith(n.slice(1)))],
    ['.*', longest((n) => n.endsWith('.*') && name.startsWith(n.slice(0, -1)))],
  ];
  for (const [by, hit] of steps) if (name && hit) return { server: hit.s, name: hit.n, by };
  // Регулярки — первая по порядку в конфиге.
  for (const s of list) for (const n of s.names) {
    if (name && n.startsWith('~') && new RegExp(n.slice(1)).test(name)) return { server: s, name: n, by: 'regex' };
  }
  // Никто не подошёл: default_server, а без него — первый server на этом порту.
  const def = list.find((s) => s.isDefault);
  return { server: def ?? list[0], name: null, by: def ? 'default_server' : 'first' };
}`;

export const SERVER_INGRESS_NOTE =
  'Звёздочка здесь шире, чем в Kubernetes. В Ingress `*.shop.test` закрывает ровно одну метку, и `a.b.shop.test` под него не попадает (это разобрано в [«Входе в кластер»](/delivery/ingress/#s2)). У nginx — попадает: на стенде `a.b.shop.test` ответил `*.shop.test`. Переносите правила между ними внимательно.';

// ─── Раздел 2. Какая location ответит ──────────────────────────────────────────────────────

export const PLAIN_LOCATION =
  'Как сортировка писем в большом офисе. Сначала ищут ящик с точным именем получателя. Нет такого — смотрят ящики отделов и выбирают самый узкий: «бухгалтерия, расчёт зарплат» точнее, чем просто «бухгалтерия». Но перед тем как опустить письмо туда, проверяют список особых правил — «всё со штампом СРОЧНО — секретарю». Правила читают сверху вниз, и срабатывает первое подошедшее, даже если ниже есть более точное.';

/**
 * Конфиг location со стенда. На стенде каждая location была многострочной и несла ещё
 * `add_header X-Loc "<номер>" always;` — см. шапку файла.
 */
export const LOC_CONF = `upstream backend {
    server app:52201;
}

server {
    listen 8080;

    location = /               { proxy_pass http://backend; }
    location /                 { proxy_pass http://backend; }
    location /api/             { proxy_pass http://backend/; }
    location /api/v1/          { proxy_pass http://backend/internal/v1/; }
    location /v2               { proxy_pass http://backend/; }
    location /images/          { proxy_pass http://backend/img; }
    location ^~ /static/       { proxy_pass http://backend; }
    location ~ \\.json$         { proxy_pass http://backend; }
    location ~ ^/api/v1/.+\\.json$ { proxy_pass http://backend; }
    location ~* \\.(png|jpe?g)$ { proxy_pass http://backend; }
}`;

export const LOC_STEPS = [
  { k: '1. Точное «=»', d: 'Если есть `location = /путь` и путь совпал целиком — ответ найден, дальше nginx не смотрит.' },
  { k: '2. Самый длинный префикс', d: 'Из всех обычных префиксов, с которых начинается путь, nginx запоминает самый длинный. Порядок в файле здесь не важен — важна длина.' },
  { k: '3. «^~» у самого длинного', d: 'Если у запомненного префикса стоит `^~`, ответ найден: регулярки не проверяются вовсе.' },
  { k: '4. Регулярки по порядку', d: 'Иначе nginx проверяет `~` (с учётом регистра) и `~*` (без) **сверху вниз**. Первая совпавшая побеждает — даже если запомненный префикс длиннее и «точнее».' },
  { k: '5. Иначе — префикс', d: 'Ни одна регулярка не подошла — отвечает префикс из шага 2. Если и его нет, запрос остался без location, и nginx ответит 404.' },
];

/** Журнал стенда: адрес → какая location ответила и что пришло к бэкенду. */
export const LOC_JOURNAL: LocationProbe[] = [
  { uri: '/', status: 200, location: '= /', backend: '/', redirect: null },
  { uri: '/index.html', status: 200, location: '/', backend: '/index.html', redirect: null },
  { uri: '/api/users?page=2', status: 200, location: '/api/', backend: '/users?page=2', redirect: null },
  { uri: '/api/v1/orders', status: 200, location: '/api/v1/', backend: '/internal/v1/orders', redirect: null },
  { uri: '/api/report.json', status: 200, location: '~ \\.json$', backend: '/api/report.json', redirect: null },
  { uri: '/api/v1/export.json', status: 200, location: '~ \\.json$', backend: '/api/v1/export.json', redirect: null },
  { uri: '/static/logo.png', status: 200, location: '^~ /static/', backend: '/static/logo.png', redirect: null },
  { uri: '/images/logo.png', status: 200, location: '~* \\.(png|jpe?g)$', backend: '/images/logo.png', redirect: null },
  { uri: '/images/cat.gif', status: 200, location: '/images/', backend: '/imgcat.gif', redirect: null },
  { uri: '/v2/users', status: 200, location: '/v2', backend: '//users', redirect: null },
  { uri: '/v2beta', status: 200, location: '/v2', backend: '/beta', redirect: null },
  { uri: '/API/users', status: 200, location: '/', backend: '/API/users', redirect: null },
  { uri: '/photo.JPG', status: 200, location: '~* \\.(png|jpe?g)$', backend: '/photo.JPG', redirect: null },
  { uri: '/api', status: 301, location: '/api/', backend: null, redirect: 'http://127.0.0.1:8080/api/' },
  { uri: '/api?x=1', status: 301, location: '/api/', backend: null, redirect: 'http://127.0.0.1:8080/api/?x=1' },
  { uri: '/static', status: 301, location: '^~ /static/', backend: null, redirect: 'http://127.0.0.1:8080/static/' },
  { uri: '/apiary', status: 200, location: '/', backend: '/apiary', redirect: null },
];

/** Тот же стенд: адреса с `%XX`, `..` и `//` — как nginx их нормализует. */
export const NORM_JOURNAL: LocationProbe[] = [
  { uri: '/api/v1', status: 301, location: '/api/v1/', backend: null, redirect: 'http://127.0.0.1:8080/api/v1/' },
  { uri: '/images', status: 301, location: '/images/', backend: null, redirect: 'http://127.0.0.1:8080/images/' },
  { uri: '/api/v1/x.JSON', status: 200, location: '/api/v1/', backend: '/internal/v1/x.JSON', redirect: null },
  { uri: '/api/a%20b', status: 200, location: '/api/', backend: '/a%20b', redirect: null },
  { uri: '/static/a%20b', status: 200, location: '^~ /static/', backend: '/static/a%20b', redirect: null },
  { uri: '/api/x/../users', status: 200, location: '/api/', backend: '/users', redirect: null },
  { uri: '/static/x/../logo', status: 200, location: '^~ /static/', backend: '/static/x/../logo', redirect: null },
  { uri: '/api//users', status: 200, location: '/api/', backend: '/users', redirect: null },
  { uri: '/%61pi/users', status: 200, location: '/api/', backend: '/users', redirect: null },
  { uri: '/api/caf%C3%A9', status: 200, location: '/api/', backend: '/caf%C3%A9', redirect: null },
  { uri: '/v2/../api/users', status: 200, location: '/api/', backend: '/users', redirect: null },
  { uri: '/api/a%23b', status: 200, location: '/api/', backend: '/a%23b', redirect: null },
  { uri: '/api/a%3Fb?q=%3F', status: 200, location: '/api/', backend: '/a%3Fb?q=%3F', redirect: null },
  { uri: '/api/a%2Fb', status: 200, location: '/api/', backend: '/a/b', redirect: null },
  { uri: '/api/a%2F..%2Fb', status: 200, location: '/api/', backend: '/b', redirect: null },
  { uri: '/api/%7Euser', status: 200, location: '/api/', backend: '/~user', redirect: null },
  { uri: '/v2/', status: 200, location: '/v2', backend: '//', redirect: null },
  { uri: '/v2', status: 200, location: '/v2', backend: '/', redirect: null },
];

/** Группы адресов для демо — все адреса из журналов стенда. */
export const PROBE_GROUPS: ProbeGroup[] = [
  {
    id: 'pick',
    label: 'Выбор location',
    uris: ['/', '/index.html', '/api/users?page=2', '/api/v1/orders', '/api/report.json', '/api/v1/export.json', '/static/logo.png', '/images/logo.png', '/API/users', '/photo.JPG'],
  },
  {
    id: 'slash',
    label: 'Слеш',
    uris: ['/images/cat.gif', '/v2/users', '/v2beta', '/v2', '/apiary', '/api', '/api?x=1', '/static'],
  },
  {
    id: 'norm',
    label: 'Нормализация',
    uris: ['/api//users', '/%61pi/users', '/v2/../api/users', '/api/x/../users', '/static/x/../logo', '/api/a%2F..%2Fb', '/api/a%20b', '/api/caf%C3%A9'],
  },
];

/** Выбор location: учебная модель. Исполняется демо и тестом на журналах стенда. */
export const LOCATION_CODE = `// location в конфиге: модификатор, путь и proxy_pass внутри.
function parseLocations(conf) {
  const re = /location\\s+(?:(=|\\^~|~\\*|~)\\s+)?(\\S+)\\s*\\{([^}]*)\\}/g;
  return [...conf.matchAll(re)].map((m) => ({
    mod: m[1] ?? '',
    path: m[2],
    pass: /proxy_pass\\s+([^;\\s]+);/.exec(m[3])?.[1] ?? null,
    text: (m[1] ? m[1] + ' ' : '') + m[2],
  }));
}

// Путь так, как nginx сравнивает его с location: %XX раскрыты,
// «//» склеены, «.» и «..» разобраны. Аргументы после «?» не участвуют.
function normalize(uri) {
  const q = uri.indexOf('?');
  const raw = q < 0 ? uri : uri.slice(0, q);
  const args = q < 0 ? null : uri.slice(q + 1);
  const decoded = raw
    .replace(/%([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\/{2,}/g, '/');
  const segs = decoded.split('/').slice(1);
  const out = [];
  segs.forEach((seg, i) => {
    if (seg === '..') out.pop();
    if (seg !== '.' && seg !== '..') out.push(seg);
    else if (i === segs.length - 1) out.push('');   // «/a/..» → «/»
  });
  return { path: '/' + out.join('/'), args };
}

const isPrefix = (l) => l.mod === '' || l.mod === '^~';
const isRegex = (l) => l.mod === '~' || l.mod === '~*';

// Выбор location — по шагам, как в документации nginx.
function findLocation(locs, uri) {
  const { path, args } = normalize(uri);
  const res = { path, args, exact: null, prefixes: [], longest: null,
                redirect: null, regexes: [], location: null, by: '' };
  // 1. Точное совпадение «=» — сразу ответ.
  res.exact = locs.find((l) => l.mod === '=' && l.path === path) ?? null;
  if (res.exact) return { ...res, location: res.exact, by: 'exact' };
  // 2. Все префиксы, с которых начинается путь, и самый длинный из них.
  res.prefixes = locs.filter((l) => isPrefix(l) && path.startsWith(l.path));
  for (const l of res.prefixes) {
    if (!res.longest || l.path.length > res.longest.path.length) res.longest = l;
  }
  // Путь без последнего слеша у location с proxy_pass — nginx отвечает 301.
  const slash = locs.find((l) => isPrefix(l) && l.pass && l.path === path + '/');
  if (slash && !locs.some((l) => isPrefix(l) && l.path === path)) {
    const to = slash.path + (args === null ? '' : '?' + args);
    return { ...res, location: slash, redirect: to, by: 'redirect' };
  }
  // 3. Самый длинный префикс с «^~» запрещает регулярки.
  if (res.longest?.mod === '^~') return { ...res, location: res.longest, by: '^~' };
  // 4. Регулярки по порядку в конфиге: первая совпавшая побеждает.
  for (const l of locs.filter(isRegex)) {
    const hit = new RegExp(l.path, l.mod === '~*' ? 'i' : '').test(path);
    res.regexes.push({ location: l, hit });
    if (hit) return { ...res, location: l, by: 'regex' };
  }
  // 5. Ни одна не совпала — остаётся самый длинный префикс.
  return { ...res, location: res.longest, by: res.longest ? 'prefix' : 'none' };
}`;

export const LOC_NOTE =
  'Два ответа журнала, ради которых стоит перечитать алгоритм. `/images/logo.png` ушёл не в `/images/`, а в регулярку для картинок: префикс только **запоминается**, а регулярка, если совпала, его перебивает. `/api/v1/export.json` ушёл в `~ \\.json$`, хотя ниже стоит регулярка, написанная ровно под него: регулярки не сравнивают по точности, первая по порядку побеждает. А `/static/logo.png` в регулярку не попал — его спас `^~`.';

export const DEMO_CAPTION =
  'Главное — на шаге с регулярками: проверка обрывается на первой совпавшей, и запомненный длинный префикс её не останавливает, если у него нет `^~`. На адресах с `%XX`, `//` и `..` сравните то, что прислал клиент, с путём, который nginx сравнивает на самом деле. Под разбором — ответ настоящего nginx на тот же адрес; для своего адреса такой строки нет, там отвечает только модель.';

// ─── Раздел 3. proxy_pass: слеш и путь ─────────────────────────────────────────────────────

export const PLAIN_PROXY_PASS =
  'Как пересылка письма с переадресацией. Без нового адреса на конверте секретарь несёт письмо как есть — с тем, что написал отправитель. С новым адресом он зачёркивает часть старого и вписывает свою: «отдел продаж, комната 5» превращается в «склад, полка». Что зачёркивается — ровно то, что совпало с правилом location, ни буквой больше.';

export const PROXY_RULES: { k: string; when: string; what: string; tone: 'ok' | 'warn' | 'info' }[] = [
  {
    k: '`proxy_pass http://backend;`',
    when: 'после адреса бэкенда ничего нет',
    what: 'Путь уходит **как прислал клиент**, не тронутый: `/static/x/../logo` — с `..`, `/static/a%20b` — с `%20`. Только так можно писать `proxy_pass` в location с регуляркой.',
    tone: 'info',
  },
  {
    k: '`proxy_pass http://backend/;`',
    when: 'после адреса есть путь, хоть один `/`',
    what: 'Часть **нормализованного** пути, совпавшая с location, заменяется этим путём. `location /api/` + `/` → `/api/users` становится `/users`.',
    tone: 'ok',
  },
  {
    k: '`location /images/` + `http://backend/img`',
    when: 'у location слеш есть, у замены — нет',
    what: 'Заменяется `/images/` целиком, вместе со слешем: `/images/cat.gif` → `/imgcat.gif`. Ошибки nginx не покажет.',
    tone: 'warn',
  },
  {
    k: '`location /v2` + `http://backend/`',
    when: 'у замены слеш есть, у location — нет',
    what: 'Заменяется только `/v2`, и слеш адреса остаётся: `/v2/users` → `//users`. А `/v2beta` тоже попал в эту location и стал `/beta`.',
    tone: 'warn',
  },
];

/** Какой путь увидит бэкенд: учебная модель. Исполняется демо и тестом. */
export const PROXY_CODE = `// Какой путь увидит бэкенд. Без URI в proxy_pass — адрес как прислал клиент.
// С URI — совпавшая с location часть нормализованного пути заменяется им.
function proxyPath(found, uri) {
  const pass = found.location?.pass;
  if (!pass || found.redirect) return null;
  const part = pass.replace(/^[a-z]+:\\/\\/[^/]+/, '');   // всё после хоста
  if (part === '') return uri;
  const rest = found.path.slice(found.location.path.length);
  // Пробел, #, %, ?, управляющие и не-ASCII байты nginx снова кодирует.
  const escaped = rest.replace(/[\\x00-\\x20#%?\\x7f-\\xff]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
  return part + escaped + (found.args === null ? '' : '?' + found.args);
}`;

export const NORM_NOTE =
  'Нормализация — не косметика. С URI в `proxy_pass` бэкенд получает путь **после** неё, и `/api/a%2F..%2Fb` доезжает как `/b`: `%2F` раскрылся в слеш, а потом `..` съел сегмент. Если бэкенд проверял права по префиксу пути, такой запрос может их обойти. Без URI всё наоборот: `/static/x/../logo` дошёл до бэкенда с `..` внутри, и разбирать его — уже забота бэкенда.';

export const DOUBLE_SLASH_NOTE =
  '`//users` — не только некрасиво. Бэкенд, который разбирает путь привычным `new URL(req.url, base)`, прочтёт `//users` как адрес **с хостом** `users` и путём `/`: в Node `new URL(\'//users\', \'http://x\').pathname` — это `/`. Бэкенд стенда на `/v2/` (путь `//`) так и упал с `TypeError: Invalid URL`, и nginx ответил 502.';

export const REDIRECT_NOTE =
  'Последняя строка про слеш. Если префикс location кончается на `/` и внутри стоит `proxy_pass`, то на тот же путь **без** слеша nginx сам отвечает `301` на путь со слешем: `/api` → `/api/`, `/static` → `/static/`, и аргументы сохраняются. Но адрес в `Location` абсолютный, и порт в нём — тот, что слушает nginx **внутри контейнера**: клиент пришёл на 52210, а его отправили на `http://127.0.0.1:8080/api/`. Лечится строкой `absolute_redirect off;` — тогда в ответе просто `Location: /api/`, и браузер подставит тот адрес, по которому пришёл.';

export const REGEX_PASS_ERROR = `$ nginx -t
nginx: [emerg] "proxy_pass" cannot have URI part in location given by regular
expression, or inside named location, or inside "if" statement, or inside
"limit_except" block in /etc/nginx/conf.d/default.conf:4
nginx: configuration file /etc/nginx/nginx.conf test failed`;

export const REGEX_PASS_CONF = `location ~ ^/api/(.*)$ {
    proxy_pass http://127.0.0.1:9/v2/;   # путь в proxy_pass у регулярки — нельзя
}`;

export const REGEX_PASS_NOTE =
  'В location с регуляркой nginx не знает, какую часть пути «заменить», и путь в `proxy_pass` там запрещён — конфиг не пройдёт проверку. Переписать путь в регулярке можно иначе: захватить кусок в группу и подставить его переменной, `proxy_pass http://backend/v2/$1;`, или директивой `rewrite`. Как то же самое делает Gateway API (`URLRewrite`), разобрано в [«Входе в кластер»](/delivery/ingress/#s5).';

// ─── Раздел 4. Заголовки к бэкенду ─────────────────────────────────────────────────────────

export const PLAIN_FORWARDED =
  'Секретарь, пересылая письмо, ставит на конверт свой обратный адрес. Директор видит «от секретаря» и не знает, кто писал на самом деле, — если секретарь не приложит записку «пришло от такого-то, по такому-то адресу». `X-Forwarded-For` и его соседи — эта записка. Писать её секретарь должен сам, а записке, которую принёс посетитель, верить нельзя.';

export const HEADER_CONF = `server {
    listen 8083;
    server_name shop.test;

    proxy_set_header X-Forwarded-Proto $scheme;   # на уровне server

    location /plain/ {
        proxy_pass http://backend/;
    }
    location /fwd/ {
        proxy_pass http://backend/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /inherit/ {
        proxy_pass http://backend/;
        proxy_set_header X-Real-IP $remote_addr;  # одна своя строка — и серверная пропала
    }
}`;

/** Что увидел бэкенд. Клиент слал `Host: shop.test:52213`; `—` — заголовка не было. */
export const HEADER_ROWS: { k: string; host: string; xff: string; xfp: string; xri: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`/plain/`', host: '`backend`', xff: '—', xfp: '`http`', xri: '—', tone: 'warn' },
  { k: '`/fwd/`', host: '`shop.test`', xff: '`172.17.0.1`', xfp: '`http`', xri: '`172.17.0.1`', tone: 'ok' },
  { k: '`/fwd/`, клиент прислал `X-Forwarded-For: 6.6.6.6`', host: '`shop.test`', xff: '`6.6.6.6, 172.17.0.1`', xfp: '`http`', xri: '`172.17.0.1`', tone: 'warn' },
  { k: '`/inherit/`', host: '`backend`', xff: '—', xfp: '—', xri: '`172.17.0.1`', tone: 'err' },
];

export const HEADER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: '`Host` без настройки — имя upstream',
    d: 'По умолчанию nginx шлёт `Host: $proxy_host` — то, что написано в `proxy_pass`. Бэкенд видит `backend` и не знает, на какой сайт пришли. Ломаются ссылки, которые он строит сам, редиректы и всё, что разделяет сайты по имени.',
    tone: 'warn',
  },
  {
    t: '`$host` теряет порт',
    d: 'Клиент слал `Host: shop.test:52213`, а `$host` — это `shop.test`. Если порт важен (разработка, нестандартный порт), нужен `$http_host` — заголовок как пришёл.',
    tone: 'info',
  },
  {
    t: '`X-Forwarded-For` дописывается, а не заменяется',
    d: '`$proxy_add_x_forwarded_for` берёт то, что прислал клиент, и добавляет через запятую адрес соединения. Клиент вписал `6.6.6.6` — бэкенд увидел `6.6.6.6, 172.17.0.1`. Доверять можно только правой части, которую дописали ваши прокси; самый левый адрес мог написать кто угодно.',
    tone: 'warn',
  },
  {
    t: '`X-Forwarded-Proto` — чтобы бэкенд знал про HTTPS',
    d: 'TLS обычно заканчивается на nginx, а к бэкенду идёт простой HTTP. Без этого заголовка бэкенд считает, что запрос пришёл по `http`, и строит ссылки и редиректы на `http://` или не ставит куки с `Secure`.',
    tone: 'info',
  },
];

export const INHERIT_NOTE =
  '**Своя `proxy_set_header` в location отменяет все серверные, а не добавляется к ним.** В `/inherit/` стоит одна строка про `X-Real-IP`, и `X-Forwarded-Proto` с уровня server до бэкенда не дошёл. В `/plain/`, где своих строк нет, — дошёл. Документация говорит об этом прямо: директивы наследуются, «только если на текущем уровне нет ни одной своей». То же правило у `add_header`.';

export const HTTP_VERSION_ROWS: { k: string; http: string; conn: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'nginx 1.27.5', http: '`1.0`', conn: '`close`', tone: 'warn' },
  { k: 'nginx 1.30.0', http: '`1.1`', conn: '—', tone: 'ok' },
];

export const HTTP_VERSION_NOTE =
  'Один и тот же конфиг `/plain/` на двух версиях nginx. До весны 2026 года nginx по умолчанию ходил к бэкенду по HTTP/1.0 с `Connection: close` — то есть новым соединением на каждый запрос, — и в половине инструкций в интернете стоят строки `proxy_http_version 1.1;` и `proxy_set_header Connection "";`. В 1.29.7 (а значит, и в стабильной 1.30) умолчание сменилось: HTTP/1.1, без `Connection: close`, с повторным использованием соединений. ⚠️ Дата и формулировка — по списку изменений nginx; на стенде видно следствие. От версии зависит и буферизация потоков — об этом следующий раздел.';

export const REDIRECT_HOST_NOTE =
  'Как `Host` бьёт по редиректам. Бэкенд стенда отвечает на `/redirect` кодом 302 на `<схема>://<Host>/login`. Через `/plain/` он построил `http://backend/login`, и клиент получил бы имя, которого нет в DNS, — если бы не `proxy_redirect default`: nginx узнал в ответе адрес из `proxy_pass` и переписал его в `http://shop.test:8083/plain/login`, снова с внутренним портом. Через `/fwd/` бэкенд построил `http://shop.test/login` — с правильным именем, но без порта и без префикса `/fwd/`. Вывод: бэкенд за прокси должен строить ссылки относительными или из заголовков, которые прокси ему честно передал.';

// ─── Раздел 5. Буферизация и таймауты ──────────────────────────────────────────────────────

export const PLAIN_BUFFERING =
  'Как курьер между складом и магазином. Можно возить каждую коробку сразу, как её вынесли со склада. А можно сначала набрать полную машину — складу удобнее, его быстрее отпускают. Для мебели это хорошо. Для газеты, которую ждут по листу, — плохо: читатель получит весь номер разом в конце дня.';

export const STREAM_CONF = `location /buffered/ {
    proxy_pass http://backend/;          # proxy_buffering on — по умолчанию
}
location /buffered-http10/ {
    proxy_pass http://backend/;
    proxy_http_version 1.0;              # как было по умолчанию до 1.29.7
}
location /buffered-gzip/ {
    proxy_pass http://backend/;
    gzip on;
    gzip_types text/event-stream;
}
location /unbuffered-http10/ {
    proxy_pass http://backend/;
    proxy_http_version 1.0;
    proxy_buffering off;
}`;

export const SSE_BACKEND_CODE = `// бэкенд: пять событий раз в 300 мс, потом конец ответа
res.writeHead(200, {
  'Content-Type': 'text/event-stream',
  // по ?xab=1 бэкенд сам просит nginx не буферизовать
  ...(xab ? { 'X-Accel-Buffering': 'no' } : {}),
});
for (let i = 1; i <= 5; i++) {
  res.write(\`data: \${i}\\n\\n\`);
  await sleep(300);
}
res.end();`;

/**
 * Каждое число — одно чтение клиента; значение — сколько событий бэкенд успел отправить
 * к этому моменту. `[1,2,3,4,5]` — по одному, `[5]` — пачкой в конце. См. шапку файла.
 */
export const STREAM_ROWS: { k: string; v130: number[]; v127: number[]; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`proxy_buffering on` (по умолчанию)', v130: [1, 2, 3, 4, 5], v127: [5], tone: 'warn' },
  { k: 'то же, HTTP/1.0 к бэкенду', v130: [5], v127: [5], tone: 'err' },
  { k: 'то же + `X-Accel-Buffering: no` от бэкенда', v130: [1, 2, 3, 4, 5], v127: [1, 2, 3, 4, 5], tone: 'ok' },
  { k: '`proxy_buffering on` + `gzip`', v130: [5], v127: [5], tone: 'err' },
  { k: 'то же + `X-Accel-Buffering: no`', v130: [1, 2, 3, 4, 5, 5], v127: [1, 2, 3, 4, 5, 5], tone: 'ok' },
  { k: '`proxy_buffering off`, HTTP/1.0', v130: [1, 2, 3, 4, 5], v127: [1, 2, 3, 4, 5], tone: 'ok' },
  { k: '`proxy_buffering off` + `gzip`', v130: [1, 2, 3, 4, 5, 5], v127: [1, 2, 3, 4, 5, 5], tone: 'ok' },
];

export const STREAM_NOTE =
  'Классическое «SSE залипает за nginx» на стенде воспроизводится ровно там, где его описывают старые инструкции: nginx 1.27 с умолчаниями отдал все пять событий одним куском после конца ответа. В 1.30 с умолчаниями события пошли по одному — но стоило вернуть HTTP/1.0 к бэкенду или включить `gzip` для `text/event-stream`, и пачка вернулась. Разница в том, как бэкенд отмечает границы: на HTTP/1.1 Node шлёт ответ кусками `chunked`, на HTTP/1.0 — сплошным потоком до закрытия. ⚠️ Почему 1.30 с буферизацией выпускает каждый `chunked`-кусок сразу, документация не говорит — это наблюдение стенда, а не обещание. Надёжный способ один и тот же на любой версии: бэкенд отвечает с `X-Accel-Buffering: no` или location с потоком получает `proxy_buffering off`. Шестое чтение в строках с `gzip` — хвост сжатого потока, пришедший с концом ответа.';

export const TIMEOUT_ROWS: { k: string; status: string; log: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'бэкенд думает 2,5 с, `proxy_read_timeout 1s`',
    status: '`504 Gateway Time-out`',
    log: '`upstream timed out (110: Operation timed out) while reading response header from upstream`',
    tone: 'warn',
  },
  { k: 'бэкенд думает 0,3 с, тот же таймаут', status: '`200`', log: '—', tone: 'ok' },
  {
    k: 'на порту бэкенда никто не слушает',
    status: '`502 Bad Gateway`',
    log: '`connect() failed (111: Connection refused) while connecting to upstream`',
    tone: 'err',
  },
];

export const TIMEOUT_NOTE =
  'Два кода, которые различают одной фразой: **502** — до бэкенда не достучались или он ответил мусором; **504** — достучались, но он не успел. Первое ищут в адресах и в том, жив ли процесс, второе — в медленных запросах. Умолчание `proxy_read_timeout` — 60 секунд, и по документации это пауза **между двумя чтениями**, а не время всего ответа. ⚠️ Последнее — по документации, на стенде мерили только паузу до заголовков. Отсюда правило для долгих соединений: поток, по которому минуту ничего не шло, nginx оборвёт, поэтому SSE и WebSocket шлют сердцебиение чаще. Как его устроить — в [«Долгих соединениях», раздел «Переподключение и heartbeat»](/platform/realtime/#s6).';

// ─── Раздел 6. SPA и try_files ─────────────────────────────────────────────────────────────

export const PLAIN_TRY_FILES =
  'Как библиотекарь со списком «если нет — дай вот это». Спросили книгу, которая есть, — выдал её. Нет — выдал путеводитель по библиотеке, и по нему читатель сам найдёт нужный зал. Для читателя это удобно. Но если так же ответить программе, которая просила конкретную деталь, она получит путеводитель вместо детали — и сломается, не поняв почему.';

export const SPA_CONF = `server {
    listen 8085;
    root /usr/share/nginx/html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 8086;
    root /usr/share/nginx/html;

    location / {
        try_files $uri $uri/ /index.html;
    }
    location /assets/ {
        try_files $uri =404;     # у ассета нет фолбэка
    }
    location /api/ {
        proxy_pass http://backend/;
    }
}`;

export const SPA_FILES = `html/
├── index.html                # <script type="module" src="/assets/app-3f2a9c.js">
└── assets/
    └── app-3f2a9c.js`;

export const SPA_ROWS: { k: string; one: string; two: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`/profile/42`', one: '200 `text/html` — `index.html`', two: '200 `text/html` — `index.html`', tone: 'ok' },
  { k: '`/assets/app-3f2a9c.js`', one: '200 `application/javascript`', two: '200 `application/javascript`', tone: 'ok' },
  { k: '`/assets/app-1b7e04.js` — старый хеш', one: '200 `text/html` — `index.html`', two: '404', tone: 'err' },
  { k: '`/favicon.ico` — файла нет', one: '200 `text/html` — `index.html`', two: '200 `text/html` — `index.html`', tone: 'warn' },
  { k: '`/api/users`', one: '200 `text/html` — `index.html`', two: '200 — ответ бэкенда', tone: 'err' },
];

export const SPA_NOTE =
  '`try_files $uri $uri/ /index.html` значит: «есть файл — отдай его, есть каталог — его `index`, иначе — `index.html`». Для клиентских маршрутов это правильно. Плохо то, что правило не различает адреса. После выката браузер с открытой старой вкладкой просит `app-1b7e04.js` — файла уже нет, и первый сервер отвечает **200 с HTML**. Chromium 153 пишет в консоль «Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html"», а мониторинг 404 не видит вовсе: ответ-то успешный. То же с забытым `/api/`: запрос к API получает страницу, и `res.json()` падает на `<!doctype`. Второй сервер лечит оба случая: у `/assets/` фолбэка нет (`=404`), а `/api/` описан отдельной location.';

export const SPA_LINK_NOTE =
  'На статическом хостинге без своего сервера переписывать адреса некому, и тот же фолбэк собирают из `404.html` — с теми же последствиями для кодов ответа. Это разобрано в [«GitHub Pages», раздел «Маршрутизация без сервера»](/delivery/github-pages/#s3). Почему Ingress сам такой фолбэк не умеет — в [«Входе в кластер»](/delivery/ingress/#s7).';

// ─── Раздел 7. Кеш и gzip ──────────────────────────────────────────────────────────────────

export const PLAIN_PROXY_CACHE =
  'Как секретарь, который снимает копию с каждого ответа директора и складывает в папку. Следующему с тем же вопросом он отдаёт копию, не беспокоя директора. На копии срок годности. Истёк — секретарь идёт к директору снова; а если директор занят или болен, может отдать и старую копию — если ему это разрешили.';

export const CACHE_CONF = `proxy_cache_path /var/cache/nginx/shop keys_zone=shop:1m max_size=10m inactive=10m;

server {
    listen 8087;
    add_header X-Cache-Status $upstream_cache_status always;

    location /plain/ {
        proxy_pass http://backend/cache/;
        proxy_cache shop;
    }
    location /stale/ {
        proxy_pass http://backend/cache/;
        proxy_cache shop;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503;
        proxy_cache_background_update on;
    }
    location /locked/ {
        proxy_pass http://backend/cache/;
        proxy_cache shop;
        proxy_cache_lock on;
    }
}`;

export const CACHE_STATUSES: { k: string; d: string }[] = [
  { k: '`MISS`', d: 'копии нет, ответ получен от бэкенда и, если можно, сохранён' },
  { k: '`HIT`', d: 'отдана свежая копия, бэкенд не трогали' },
  { k: '`EXPIRED`', d: 'копия была, но срок вышел — сходили к бэкенду и отдали его ответ' },
  { k: '`STALE`', d: 'срок вышел, а отдали старую копию — так разрешил `proxy_cache_use_stale`' },
  { k: '`UPDATING`', d: 'старая копия отдана, потому что её прямо сейчас обновляет другой запрос (`updating`)' },
  { k: '`BYPASS`', d: 'кеш пропущен по `proxy_cache_bypass`' },
  { k: '`REVALIDATED`', d: 'копию подтвердили условным запросом (`proxy_cache_revalidate`)' },
];

export const CACHE_STATUS_NOTE =
  '`X-Cache-Status` — не стандартный заголовок, а имя, под которым принято выводить переменную `$upstream_cache_status`. Первые четыре значения сняты стендом; ⚠️ три последних — по документации, на стенде их не было. Стандартный способ сообщить то же — заголовок `Cache-Status` из RFC 9211, он разобран в [«CDN и серверном кеше»](/platform/cdn-cache/).';

/** Последовательности стенда. `#N` — номер ответа бэкенда, который получил клиент. */
export const CACHE_RUNS: { k: string; steps: string[]; note: string }[] = [
  {
    k: '`/plain/a`, `max-age=2`',
    steps: ['`MISS` #1', '`HIT` #1', '⏱ 3,2 с', '`EXPIRED` #2', '`HIT` #2'],
    note: 'Срок взят из `Cache-Control: max-age=2` бэкенда — `proxy_cache_valid` в конфиге нет. После срока первый клиент ждёт бэкенд.',
  },
  {
    k: '`/stale/b`, `max-age=2`, фоновое обновление',
    steps: ['`MISS` #1', '`HIT` #1', '⏱ 3,2 с', '`STALE` #1', '`HIT` #2'],
    note: 'После срока клиент сразу получил старую копию, а nginx сходил за новой сам, в фоне. Следующий — уже свежую.',
  },
  {
    k: 'бэкенд отвечает 500',
    steps: ['`/stale/`: `STALE` 200 #1', '`/plain/`: `EXPIRED` 500'],
    note: 'Срок вышел, и бэкенд сломался. Location с `use_stale … http_500` отдала старую копию с кодом 200, location без неё — ошибку.',
  },
  {
    k: 'ответ с `Set-Cookie`',
    steps: ['`MISS` #1', '`MISS` #2'],
    note: 'nginx не кеширует ответ, в котором есть `Set-Cookie`: иначе одна сессия уехала бы всем. Каждый запрос идёт к бэкенду.',
  },
  {
    k: 'одна запись на две location',
    steps: ['`/plain/k`: `MISS` #1', '`/stale/k`: `HIT` #1', '`/locked/k`: `HIT` #1'],
    note: 'Ключ по умолчанию собран из адреса бэкенда, а не из адреса клиента. Три location пересылают на один и тот же `/cache/k` — и делят одну запись.',
  },
];

export const CROWD_ROWS: { k: string; origin: number; statuses: string; tone?: 'ok' | 'err' }[] = [
  { k: 'без `proxy_cache_lock`', origin: 10, statuses: '`MISS` × 10', tone: 'err' },
  { k: '`proxy_cache_lock on`', origin: 1, statuses: '`MISS` × 1, `HIT` × 9', tone: 'ok' },
];

export const CROWD_NOTE =
  'Десять одновременных запросов к холодному ключу, бэкенд отвечает полсекунды. Без блокировки все десять увидели пустой кеш и пошли к бэкенду сами — это и есть «толпа». С `proxy_cache_lock` пошёл один, девять подождали его ответа и получили копию. Ждать они готовы до `proxy_cache_lock_timeout` (по документации 5 с), потом идут сами. Блокировка работает на промахе, а на истечении срока ту же роль играет `proxy_cache_use_stale updating`. Почему толпа страшна и как с ней борются CDN — в [«CDN и серверном кеше», раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3).';

export const GZIP_CONF = `location /on/ {
    proxy_pass http://backend/;
    gzip on;                       # gzip_types по умолчанию — только text/html
}
location /json/ {
    proxy_pass http://backend/;
    gzip on;
    gzip_types application/json;
    gzip_vary on;
}`;

export const GZIP_ROWS: { k: string; enc: string; bytes: number; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`/on/`, `Accept-Encoding: gzip`', enc: '—', bytes: 2811, tone: 'warn' },
  { k: '`/json/`, `Accept-Encoding: gzip`', enc: '`gzip`', bytes: 458, tone: 'ok' },
  { k: '`/json/`, то же + `Via: 1.1 cdn`', enc: '—', bytes: 2811, tone: 'err' },
  { k: '`/json/`, без `Accept-Encoding`', enc: '—', bytes: 2811 },
];

export const GZIP_NOTE =
  'Три урока одной таблицы. `gzip on` без `gzip_types` сжимает только HTML — JSON ушёл как есть. С `gzip_types application/json` те же 2811 байт стали 458. А запрос с заголовком `Via` — так помечают запросы прокси и CDN — снова не сжат: по умолчанию `gzip_proxied off`, и nginx не сжимает ответы для тех, кто пришёл через прокси. Если перед nginx стоит CDN, без `gzip_proxied any` она будет получать и раздавать несжатое. `gzip_vary on` добавляет `Vary: Accept-Encoding`, чтобы общий кеш не отдал сжатую копию тому, кто gzip не просил.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Регулярка перебивает более длинный префикс',
    d: '`location /images/` не спасает картинки от `location ~* \\.(png|jpe?g)$`: префикс только запоминается, а совпавшая регулярка его перебивает. На стенде `/images/logo.png` ушёл в регулярку. Если префикс должен быть окончательным, ставьте `^~`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Регулярки выбираются по порядку, а не по точности',
    d: '`/api/v1/export.json` ушёл в `~ \\.json$`, хотя ниже была регулярка, написанная ровно под `/api/v1/`. Более узкую регулярку ставят **выше** общей.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`location /v2` без слеша ловит `/v2beta`',
    d: 'Префикс сравнивается посимвольно, не по сегментам: `/v2beta`, `/v2.json` и `/v20` тоже начинаются с `/v2`. В Ingress `Prefix` сравнивает сегменты — у nginx так не бывает.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Слеш в `proxy_pass` склеивает или удваивает',
    d: '`location /images/` + `http://backend/img` дал `/imgcat.gif`; `location /v2` + `http://backend/` дал `//users`. Правило запоминания одно: слеш на конце у location и у замены — оба или ни одного.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Без URI в `proxy_pass` бэкенд получает сырой путь',
    d: '`/static/x/../logo` дошёл до бэкенда с `..` внутри. Если бэкенд отдаёт файлы по пути, разбирать точки-сегменты и `%2F` он обязан сам.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Автоматический 301 уводит на внутренний порт',
    d: '`/api` → `http://127.0.0.1:8080/api/`: порт тот, что слушает nginx в контейнере. За пробросом порта или балансировщиком это ссылка в никуда. `absolute_redirect off;` оставляет в `Location` только путь.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Одна `proxy_set_header` в location отменяет все серверные',
    d: 'Наследование «всё или ничего»: добавили в location одну строку — пропали все заголовки, заданные выше. То же у `add_header`. Общие строки выносят в файл и подключают `include` в каждую location.',
    tone: 'err',
  },
  {
    n: '08',
    t: '`X-Forwarded-For` пишет и клиент',
    d: 'Бэкенд увидел `6.6.6.6, 172.17.0.1`, где первый адрес вписал сам клиент. Брать «первый адрес из `X-Forwarded-For`» как адрес пользователя — значит дать ему выбрать свой IP для лимитов и журналов.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`try_files … /index.html` отвечает 200 на пропавший ассет',
    d: 'Старый бандл после выката получает HTML с кодом 200, и ошибку видно только в консоли браузера. Для `/assets/` нужен `try_files $uri =404`, для API — своя location.',
    tone: 'err',
  },
  {
    n: '10',
    t: 'gzip выключен для CDN и для потока',
    d: 'По умолчанию nginx не сжимает ответ на запрос с `Via` (`gzip_proxied off`) — то есть ровно для CDN. А `gzip` на `text/event-stream` при включённой буферизации собирает поток в одну пачку.',
    tone: 'warn',
  },
  {
    n: '11',
    t: 'Кеш молча не работает на ответах с `Set-Cookie`',
    d: 'Бэкенд, который ставит куку на каждый ответ (сессия, A/B-метка), получает `MISS` всегда. Ошибки нет, просто нагрузка не падает. Смотрите `X-Cache-Status`, а не конфиг.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'nginx: How nginx processes a request',
    href: 'https://nginx.org/en/docs/http/request_processing.html',
    what: 'выбор server по порту и имени, сервер по умолчанию, порядок проверки location',
  },
  {
    title: 'nginx: Server names',
    href: 'https://nginx.org/en/docs/http/server_names.html',
    what: 'точные имена, звёздочки в начале и в конце, регулярки и их порядок, `return 444` для чужих имён',
  },
  {
    title: 'nginx: ngx_http_core_module — location',
    href: 'https://nginx.org/en/docs/http/ngx_http_core_module.html#location',
    what: 'модификаторы `=`, `^~`, `~`, `~*`, порядок выбора, нормализация пути, 301 на путь без слеша',
  },
  {
    title: 'nginx: ngx_http_core_module — try_files',
    href: 'https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files',
    what: 'проверка файлов по порядку и последний аргумент — путь или `=код`',
  },
  {
    title: 'nginx: ngx_http_proxy_module',
    href: 'https://nginx.org/en/docs/http/ngx_http_proxy_module.html',
    what: '`proxy_pass` с URI и без, `proxy_set_header` и наследование, `proxy_buffering` и `X-Accel-Buffering`, таймауты, `proxy_cache_*`, ключ кеша, что не кешируется',
  },
  {
    title: 'nginx: ngx_http_upstream_module — $upstream_cache_status',
    href: 'https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_cache_status',
    what: 'значения `MISS`, `BYPASS`, `EXPIRED`, `STALE`, `UPDATING`, `REVALIDATED`, `HIT`',
  },
  {
    title: 'nginx: ngx_http_gzip_module',
    href: 'https://nginx.org/en/docs/http/ngx_http_gzip_module.html',
    what: '`gzip_types` по умолчанию, `gzip_proxied` и заголовок `Via`, `gzip_vary`, `gzip_comp_level`',
  },
  {
    title: 'nginx: CHANGES',
    href: 'https://nginx.org/en/CHANGES',
    what: '1.29.7: `proxy_http_version 1.1` и keepalive к бэкенду по умолчанию, `Connection` больше не отправляется',
  },
  {
    title: 'MDN: X-Forwarded-For',
    href: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For',
    what: 'формат списка адресов и почему левому адресу нельзя доверять',
  },
  {
    title: 'RFC 7239 — Forwarded HTTP Extension',
    href: 'https://www.rfc-editor.org/rfc/rfc7239',
    what: 'стандартный заголовок `Forwarded`, заменяющий набор `X-Forwarded-*`',
  },
];

export const RELATED =
  'Смежное на сайте: [Вход в кластер: Ingress и Gateway API](/delivery/ingress/#s2) — тот же выбор по хосту и пути, но в Kubernetes и по сегментам. [CDN и серверный кеш, раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3) — `stale-while-revalidate`, коллапс запросов и `Cache-Status`. [GitHub Pages, раздел «Маршрутизация без сервера»](/delivery/github-pages/#s3) — SPA там, где нет `try_files`. [Долгие соединения, раздел «Переподключение и heartbeat»](/platform/realtime/#s6) — таймауты прокси для WebSocket и SSE. [Стримы и обратное давление, раздел «Трансформация»](/platform/streams/#s4) — формат SSE на клиенте. [HTTP/2 и HTTP/3](/platform/http2-http3/) — что меняется между браузером и nginx, когда к бэкенду по-прежнему идёт HTTP/1.1. [Docker Compose](/delivery/compose/#s1) — как nginx и бэкенд находят друг друга по имени. [Балансировка нагрузки](/delivery/load-balancing/) — взвешенный круг, кольцо хешей, проверки здоровья и повторы запросов. [Сжатие в вебе](/platform/compression/) — выбор кодировки по `Accept-Encoding`, уровни, словари сжатия и BREACH. [TLS и сертификаты](/delivery/tls-certificates/) — рукопожатие по сообщениям, цепочка доверия и ACME. [Ограничение частоты в API](/platform/rate-limits/) — 429 и `Retry-After`, джиттер, бюджет повторов и `RetryAgent` из undici.';
