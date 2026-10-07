import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AePreset, LabFile } from '@/widgets/compress-lab/model/types';

/**
 * Данные темы «Сжатие в вебе: gzip, Brotli, zstd».
 *
 * Тема написана здесь, 2026-10-02, для направления «Сеть и безопасность». Что уже разобрано
 * в других темах и здесь не повторяется: базовая таблица форматов на `vue.global.prod.js`,
 * `ETag` у сжатого варианта и лучший случай словаря (правка в 25 байт) — «Сеть и кеширование»,
 * раздел «Кеш и валидация»; конфиг `gzip` в nginx (`gzip_types`, `gzip_proxied`, `gzip_vary`) —
 * «Nginx как обратный прокси», раздел «Кеш и gzip»; цена вариантов `Vary` в общем кеше —
 * «CDN и серверный кеш», раздел «Ключ и Vary»; `CompressionStream` — «Стримы», раздел
 * «Итерация и байты»; HPACK — «HTTP/2 и HTTP/3». Устройство LZ77 и Хаффмана — не здесь.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (`zlib` 1.3.1, brotli 1.1.0, zstd 1.5.7), Chromium **153.0.8010.12**
 * (Playwright 1.63, headless), sirv 3.0.2 и h3 1.15.11 из `node_modules` курса, negotiator
 * 1.0.0 (из другого проекта на диске — **только на стенде**, в тест не входит), curl 8.7.1.
 * Октябрь 2026. Свои серверы `node:http`/`node:https`/`node:net` на портах 4910–4917;
 * `--host-resolver-rules` даёт адреса `compress.test` и `dict.test` — «обычный» http-хост,
 * не `localhost`. Скрипты стенда — в scratchpad автора, не в репозитории.
 *
 * Файлы — настоящие файлы курса из `dist/` (сборку не запускали: читали то, что лежало
 * 2026-10-02 12:48) и картинка из `node_modules`. У каждого записан sha-256 (первые 16 знаков):
 * тест сверяет точные размеры, только если файл в `dist/` тот же, иначе — отношения.
 *
 * Что снято:
 *   — `AE_ROWS`: заголовок `Accept-Encoding` в Chromium по видам запроса (навигация, стиль,
 *     скрипт, картинка, шрифт, `<video>`, `fetch`, `fetch` с `Range`, `fetch` со своим
 *     `Accept-Encoding`, воркер) на `http://localhost`, `http://127.0.0.1`, `https://localhost`,
 *     `https://compress.test` и `http://compress.test`; Node `fetch` по http и https; curl;
 *   — `FILE_SIZES`: `zlib.gzipSync` уровни 1–9, `brotliCompressSync` 0–11 (с `SIZE_HINT`),
 *     `zstdCompressSync` 1–22 — **байты, не время**. Время сжатия не мерялось нигде: что высокие
 *     уровни дороги по процессору — из документации brotli и zstd;
 *   — `CALLS`: свой сервер считает вызовы `zlib` на 21 запрос Chromium к каждому варианту;
 *   — `LENGTH_ROWS`: что Chromium делает с ошибками длины и кодировки (сырые ответы через
 *     `node:net`); «висел, пока сервер не закрыл соединение» — сервер закрывал через 4 с,
 *     `fetch` вернулся позже 3 с: это пометка, а не замер времени;
 *   — `SERVER_ROWS`, `RANGE_CODE`: sirv и h3 подняты над одной папкой (`app.js`, `.br`, `.gz`),
 *     запросы с заданными заголовками из `node:http`; negotiator спрошен теми же заголовками;
 *   — `DICT_*`: настоящий обмен Compression Dictionary Transport Chromium 153 ↔ `node:http` на
 *     `localhost:4913`; тело `dcz` = 8 байт магии + sha-256 словаря + `zstdCompressSync(v2,
 *     { dictionary: v1 })` уровня 19. `encodedBodySize` 133, `decodedBodySize` 32 673,
 *     sha-256 распакованного совпал со второй версией. Контроль — `http://dict.test`;
 *   — `BREACH_*`: длины `gzipSync` (уровень по умолчанию — 6), детерминированы.
 *
 * Что по документации, а не снято: формат `dcb` (Node 24.11 не умеет brotli со словарём —
 * опция `dictionary` молча игнорируется, это как раз снято); окно zstd 8 МБ / 1,25 словаря;
 * причины, по которым Chromium не шлёт `br` и `zstd` по http; цена уровней по процессору;
 * история атаки BREACH.
 *
 * Пересобирает `tests/unit/compression.test.ts`: `NEGOTIATE_CODE` против RFC 9110, заголовков
 * стенда и negotiator-колонки `SERVER_ROWS`; sirv и h3 поднимаются заново; размеры — по `dist/`
 * (если файлы те же) и по картинке из `node_modules`; словарь — правками `DICT_EDITS`; BREACH —
 * целиком; Node `fetch` — заново. Журнал Chromium (`AE_ROWS`, `LENGTH_ROWS`, обмен словарём) —
 * литерал стенда.
 */

const n = (x: number) => x.toLocaleString('ru-RU');
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1).replace('.', ',')}%`;
/** «203 байта», «85 байт», «81 байт». */
const bytes = (x: number) => {
  const d = x % 10;
  const dd = x % 100;
  return `${n(x)} ${d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? 'байта' : 'байт'}`;
};
const less = (a: number, b: number) => `${(((b - a) / b) * 100).toFixed(1).replace('.', ',')}%`;

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const PLAIN_CODING =
  'Как посылка с вещами в вакуумном пакете. Получатель заранее пишет: «у меня дома есть насос для пакетов вот таких типов». Отправитель пакует тем, что есть у обоих, и пишет на коробке, чем упаковано. Вещи те же, коробка меньше. Перепутает надпись — получатель вскроет и найдёт мешанину.';

export const GLOSSARY = [
  {
    k: 'кодировка содержимого',
    d: 'Способ упаковать тело ответа: `gzip`, `br` (Brotli), `zstd` (Zstandard), `deflate`. Её имя сервер пишет в `Content-Encoding`, браузер распаковывает сам. `identity` — «без упаковки».',
  },
  {
    k: '`Accept-Encoding`',
    d: 'Заголовок запроса: кодировки, которые клиент умеет распаковать. Браузер ставит его сам, из JS его не заменить.',
  },
  {
    k: 'вес, q-значение',
    d: 'Число от 0 до 1 после `;q=` у кодировки в `Accept-Encoding`. Больше — желаннее, `0` — «не присылать». Без `q` вес равен 1.',
  },
  {
    k: '`Vary`',
    d: 'Заголовок ответа: от каких заголовков запроса зависят байты. `Vary: Accept-Encoding` говорит кешу, что у адреса несколько вариантов и выдавать их надо по этому заголовку.',
  },
  {
    k: 'предсжатие',
    d: 'Файлы сжимают при сборке и кладут рядом: `app.js.br`, `app.js.gz`. На запрос сервер только выбирает готовый файл и ничего не сжимает.',
  },
  {
    k: 'словарь сжатия',
    d: 'Байты, которые заранее есть и у отправителя, и у получателя. Сжатие ссылается на куски словаря вместо того, чтобы передавать их заново.',
  },
  {
    k: 'безопасный контекст',
    d: 'Страница по HTTPS, а также по `http://localhost` и `http://127.0.0.1`. Часть возможностей браузер включает только в нём.',
  },
];

export const PREREQ_NOTE =
  'Тема опирается на две вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кеш HTTP и ETag',
    d: 'Браузер берёт ответ из кеша по `Cache-Control` и сверяет его с сервером по `ETag`. Ключ записи в кеше — адрес; `Vary` дописывает к ключу заголовки запроса.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
  {
    t: 'Общий кеш и варианты',
    d: 'CDN и прокси хранят один ответ для многих пользователей. Каждый вариант по `Vary` — отдельная копия, и отдать чужой вариант — ошибка.',
    href: '/platform/cdn-cache/#s2',
    hrefLabel: '«CDN и серверный кеш», раздел «Ключ и Vary»',
    tone: 'info',
  },
  {
    t: 'Сжатие без потерь',
    d: 'Компрессор находит в тексте повторы и заменяет их короткими ссылками назад, а частые символы — короткими кодами. Как именно — для этой темы неважно. Важно другое: в HTML, CSS и JS повторов много, а в картинках и шрифтах их уже убрал их собственный формат.',
    tone: 'info',
  },
];

// ─── Стенд: файлы и размеры ────────────────────────────────────────────────────────────────

export interface FileSizes {
  id: string;
  label: string;
  /** Путь от корня проекта. */
  file: string;
  type: string;
  /** Первые 16 знаков sha-256: по ним тест узнаёт, тот ли это файл. */
  sha: string;
  raw: number;
  /** Уровни 1–9. */
  gzip: number[];
  /** Уровни 0–11. */
  br: number[];
  /** Уровни 1, 3, 6, 9, 12, 15, 19, 22. */
  zstd: Record<number, number>;
}

export const ZSTD_LEVELS = [1, 3, 6, 9, 12, 15, 19, 22];

export const FILE_SIZES: FileSizes[] = [
  {
    id: 'html',
    label: 'HTML темы «Сеть и кеширование»',
    file: 'dist/platform/network/index.html',
    type: 'text/html',
    sha: '6f5bdde4166baa99',
    raw: 248520,
    gzip: [68004, 64516, 62416, 58470, 56157, 55312, 55199, 55110, 55109],
    br: [68176, 62679, 59498, 57411, 54739, 49980, 48678, 47430, 46919, 46628, 43701, 43126],
    zstd: { 1: 61501, 3: 56093, 6: 51510, 9: 49864, 12: 48553, 15: 46428, 19: 45996, 22: 45977 },
  },
  {
    id: 'css',
    label: 'CSS общего каркаса',
    file: 'dist/_astro/BaseLayout.EQ_Golna.css',
    type: 'text/css',
    sha: '232eb63fcd97fcf4',
    raw: 64312,
    gzip: [22376, 21884, 21473, 20780, 20138, 19948, 19825, 19797, 19796],
    br: [22933, 21875, 20559, 20303, 19355, 18339, 18229, 18132, 18089, 18055, 17508, 17294],
    zstd: { 1: 21343, 3: 20403, 6: 19315, 9: 19026, 12: 18887, 15: 18641, 19: 18525, 22: 18523 },
  },
  {
    id: 'js',
    label: 'JS: чанк Vue runtime-core',
    file: 'dist/_astro/runtime-core.esm-bundler.CIbLXjQd.js',
    type: 'text/javascript',
    sha: '7b9716716e56815b',
    raw: 85367,
    gzip: [36221, 35423, 34941, 33877, 33064, 32923, 32905, 32901, 32901],
    br: [38982, 37637, 34668, 34482, 33903, 32181, 32045, 31949, 31902, 31885, 30132, 29705],
    zstd: { 1: 36849, 3: 34524, 6: 32816, 9: 32348, 12: 32184, 15: 31426, 19: 31264, 22: 31264 },
  },
  {
    id: 'woff2',
    label: 'шрифт woff2',
    file: 'dist/_astro/newsreader-normal-300-700-latin.DBQoWVJ5.woff2',
    type: 'font/woff2',
    sha: '01817351be3edfc1',
    raw: 131848,
    gzip: [131774, 131771, 131771, 131767, 131767, 131767, 131767, 131767, 131767],
    br: [131853, 131853, 131855, 131855, 131853, 131853, 131853, 131853, 131853, 131853, 131853, 131853],
    zstd: { 1: 131863, 3: 131863, 6: 131863, 9: 131863, 12: 131863, 15: 131863, 19: 131863, 22: 131863 },
  },
  {
    id: 'png',
    label: 'картинка PNG',
    file: 'node_modules/playwright-core/lib/server/chromium/appIcon.png',
    type: 'image/png',
    sha: '6ba994f05c5cf18e',
    raw: 16565,
    gzip: [16079, 16079, 16075, 16075, 16074, 16074, 16074, 16072, 16072],
    br: [16148, 16082, 16127, 16073, 16054, 16050, 16050, 16050, 16050, 16054, 16092, 16037],
    zstd: { 1: 16070, 3: 16101, 6: 16044, 9: 16044, 12: 16043, 15: 16036, 19: 16028, 22: 16028 },
  },
  {
    id: 'tiny',
    label: 'крошечный чанк, 84 байта',
    file: 'dist/_astro/_plugin-vue_export-helper.BDNMzG2s.js',
    type: 'text/javascript',
    sha: '27e87fe62aa76022',
    raw: 84,
    gzip: [99, 99, 99, 99, 99, 99, 99, 99, 99],
    br: [88, 88, 88, 77, 76, 78, 78, 78, 78, 78, 82, 88],
    zstd: { 1: 86, 3: 86, 6: 86, 9: 86, 12: 86, 15: 81, 19: 81, 22: 81 },
  },
];

const F = Object.fromEntries(FILE_SIZES.map((f) => [f.id, f])) as Record<string, FileSizes>;

// ─── Раздел «Договор заголовков» ───────────────────────────────────────────────────────────

/** Ответ sirv на запрос Chromium: заголовки сняты стендом, `Last-Modified` и `ETag` опущены. */
export const HANDSHAKE_CODE = `GET /app.js HTTP/1.1
Accept-Encoding: gzip, deflate, br, zstd

HTTP/1.1 200 OK
Content-Type: text/javascript
Content-Encoding: br              ← чем упаковано
Content-Length: ${F.js.br[11]}            ← длина упакованного
Vary: Accept-Encoding             ← у адреса есть другие варианты`;

export const HANDSHAKE_NOTE = `Файл — чанк Vue из сборки этого сайта, ${n(F.js.raw)} байт. Сервер выбрал готовый \`app.js.br\` (brotli 11) и отдал ${n(F.js.br[11])}. Скрипт страницы получает уже распакованный текст. Разница видна только в записи о загрузке: \`encodedBodySize\` — ${n(F.js.br[11])}, \`decodedBodySize\` — ${n(F.js.raw)}. Зачем \`Vary\` и почему у сжатого варианта свой \`ETag\` — в [«Сети и кешировании», раздел «Кеш и валидация»](/platform/network/#s2).`;

export const CHROMIUM_AE = 'gzip, deflate, br, zstd';

/** Что пришло на сервер стенда в `Accept-Encoding`. */
export const AE_ROWS: { who: string; when: string; ae: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { who: 'Chromium 153', when: 'навигация, стиль, скрипт, картинка, шрифт, `fetch`, воркер — по HTTPS и на `localhost`', ae: CHROMIUM_AE, tone: 'ok' },
  { who: 'Chromium 153', when: 'то же по `http://` на обычном адресе', ae: 'gzip, deflate', tone: 'warn' },
  { who: 'Chromium 153', when: 'запрос, под который есть словарь', ae: 'gzip, deflate, br, zstd, dcb, dcz', tone: 'ok' },
  { who: 'Chromium 153', when: '`<video>`: запросы с `Range`', ae: 'identity;q=1, *;q=0' },
  { who: 'Chromium 153', when: '`fetch` с заголовком `Range`', ae: 'identity' },
  { who: 'Chromium 153', when: '`fetch` со своим `Accept-Encoding: identity`', ae: CHROMIUM_AE, tone: 'warn' },
  { who: 'Node 24.11, `fetch`', when: 'по https / по http / с `Range`', ae: '`br, gzip, deflate` / `gzip, deflate` / `identity`' },
  { who: 'curl 8.7.1', when: 'с флагом `--compressed`', ae: 'deflate, gzip' },
];

export const AE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'По `http://` — только gzip',
    d: 'На `http://compress.test` Chromium перечислил одни `gzip, deflate`: ни `br`, ни `zstd`. На `http://localhost`, `http://127.0.0.1` и любом HTTPS — все четыре. Новые форматы браузер просит только в безопасном контексте: по документации — потому что старые прокси по дороге портят незнакомые им кодировки, а в шифрованный трафик не лезут.',
    tone: 'warn',
  },
  {
    t: 'Свой `Accept-Encoding` из `fetch` не уйдёт',
    d: 'Заголовок входит в список запрещённых для JS: `fetch` с `Accept-Encoding: identity` ушёл со стандартным `gzip, deflate, br, zstd`, без ошибки. Прочитать сжатые байты ответа страница тоже не может — тело приходит распакованным. Сжать или распаковать данные в JS самому — `CompressionStream`, он в [«Стримах и обратном давлении», раздел «Итерация и байты»](/platform/streams/#s6).',
    tone: 'warn',
  },
  {
    t: 'С `Range` браузер просит без сжатия',
    d: 'Стандарт Fetch добавляет `Accept-Encoding: identity` к любому запросу с `Range`, а `<video>` шлёт `identity;q=1, *;q=0` — «только без сжатия». Диапазон байтов сжатого файла бесполезен браузеру, и он заранее от сжатия отказывается.',
  },
  {
    t: 'Порядок в списке — не предпочтение',
    d: 'Chromium пишет `gzip` первым, но веса у всех четырёх одинаковые — 1. Как выбирать среди равных, стандарт не диктует — решает сервер. Сервер, который берёт первое имя из списка, отдаст Chromium gzip, хотя у него лежит меньший brotli.',
  },
];

// ─── Раздел «Выбор по q» ───────────────────────────────────────────────────────────────────

export const PLAIN_Q =
  'Как заказ в кафе: «капучино, а если нет — латте, только не американо». Первое — вес 1, второе — 0,5, третье — 0, то есть «нельзя». Звёздочка — «что угодно ещё». Бариста выбирает из того, что есть на кухне, самое желанное; если у вас нет запретов, вода без всего подходит всегда.';

export const Q_RULES = [
  'Заголовка нет — клиент примет любую кодировку. На деле серверы тогда не сжимают: так поступают все три сервера стенда и функция `negotiate`.',
  '«Без сжатия» (`identity`) годится всегда, пока его не запретили явно: `identity;q=0` или `*;q=0` без отдельной записи для `identity`.',
  'Кодировка из списка годится, если её вес не 0. Среди годных берут самую тяжёлую. Пустой заголовок означает «только без сжатия».',
];

export const NEGOTIATE_CODE = `// RFC 9110, раздел 12.5.3. Заголовок → список { coding, q }.
function parseAcceptEncoding(header) {
  const list = [];
  for (const part of header.split(',')) {
    const [name, ...params] = part.split(';').map((s) => s.trim());
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^q=([01](?:\\.\\d{0,3})?)$/i.exec(p);
      if (!m || Number(m[1]) > 1) { q = null; break; }  // q=2, q=abc — запись брошена
      q = Number(m[1]);
    }
    if (q !== null) list.push({ coding: name.toLowerCase(), q });
  }
  return list;
}

// Вес одной кодировки: своя запись, иначе «*», иначе по умолчанию.
function weight(list, coding) {
  const own = list.find((e) => e.coding === coding);
  if (own) return own.q;
  const star = list.find((e) => e.coding === '*');
  if (star) return star.q;
  // «Без сжатия» годится, пока его не запретили, — но идёт последним.
  return coding === 'identity' ? Number.MIN_VALUE : 0;
}

// offers — что есть у сервера для этого файла, в порядке его предпочтения.
// Ответ — имя для Content-Encoding, 'identity' или null: подходящего нет.
function negotiate(header, offers) {
  if (header === null) return 'identity';  // заголовка нет — сжатия не просили
  const list = parseAcceptEncoding(header);
  let best = null;
  let bestQ = 0;
  for (const coding of [...offers, 'identity']) {
    const q = weight(list, coding);
    if (q > bestQ) { best = coding; bestQ = q; }  // при равенстве остаётся первый
  }
  return best;
}`;

export const NEGOTIATE_NOTE =
  'Два решения в функции не записаны в RFC явно. Неявный `identity` получает самый маленький вес, поэтому `gzip;q=0.5` всё равно выберет gzip: так же поступает negotiator. Запись с неверным весом (`q=2`, `q=abc`) выброшена целиком, как будто её не было; negotiator здесь мягче и верит `q=2`. `null` в ответе значит, что годного варианта нет: сервер вправе ответить `406 Not Acceptable` или проигнорировать заголовок и отдать как есть.';

/** Примеры из RFC 9110, раздел 12.5.3, и что по ним выберет сервер с `br` и `gzip`. Сверяет тест. */
export const RFC_CASES: { ae: string; offers: string[]; pick: string | null }[] = [
  { ae: 'compress, gzip', offers: ['br', 'gzip'], pick: 'gzip' },
  { ae: '', offers: ['br', 'gzip'], pick: 'identity' },
  { ae: '*', offers: ['br', 'gzip'], pick: 'br' },
  { ae: 'compress;q=0.5, gzip;q=1.0', offers: ['br', 'gzip'], pick: 'gzip' },
  { ae: 'gzip;q=1.0, identity; q=0.5, *;q=0', offers: ['br', 'gzip'], pick: 'gzip' },
  { ae: 'gzip;q=1.0, identity; q=0.5, *;q=0', offers: ['br'], pick: 'identity' },
  { ae: 'identity;q=0', offers: [], pick: null },
  { ae: '*;q=0', offers: ['br', 'gzip'], pick: null },
];

/** Пресеты демо: заголовки, снятые стендом, и несколько нарочно трудных. */
export const AE_PRESETS: AePreset[] = [
  { id: 'chromium', label: 'Chromium', header: CHROMIUM_AE, note: 'Chromium 153 по HTTPS и на `localhost`: навигация, скрипты, стили, картинки, шрифты, `fetch`.' },
  { id: 'chromium-http', label: 'по http://', header: 'gzip, deflate', note: 'Chromium 153 на обычном `http://`-адресе: новых форматов нет.' },
  { id: 'video', label: '<video>', header: 'identity;q=1, *;q=0', note: 'Chromium 153, запросы `<video>` с `Range`: только без сжатия.' },
  { id: 'node', label: 'Node fetch', header: 'br, gzip, deflate', note: '`fetch` в Node 24.11 по https: `zstd` в списке нет.' },
  { id: 'none', label: 'без заголовка', header: null, note: 'Заголовка нет вовсе: curl без `--compressed`, самописные клиенты.' },
];

export const AE_TRICKY: { header: string; note: string }[] = [
  { header: 'br;q=0, gzip', note: 'brotli прямо запрещён' },
  { header: 'gzip;q=0', note: 'gzip запрещён, остальное не названо' },
  { header: 'br;q=0.5, gzip;q=1', note: 'gzip желаннее brotli' },
  { header: 'gzip;q=1.0, identity; q=0.5, *;q=0', note: 'пример из RFC 9110' },
  { header: '*;q=0', note: 'запрещено всё, даже «без сжатия»' },
  { header: 'identity;q=0', note: 'запрещено только «без сжатия»' },
  { header: '', note: 'пустой заголовок' },
  { header: 'BR', note: 'имя заглавными' },
];

export const LAB_FILES: LabFile[] = ['js', 'css', 'html', 'woff2'].map((id) => ({
  id,
  label: { js: 'JS', css: 'CSS', html: 'HTML', woff2: 'шрифт' }[id] ?? id,
  type: F[id].type,
  raw: F[id].raw,
  sizes: { br: F[id].br[11], zstd: F[id].zstd[19], gzip: F[id].gzip[8] },
}));

export const DEMO_CAPTION =
  'Решение принимает `negotiate` из листинга выше, вес каждой строки — `weight`. Размеры сняты стендом на файлах этого сайта: brotli 11, zstd 19 и gzip 9 — то, что кладут рядом с файлом при сборке. Заголовок можно править руками.';

/** Как выбрали три настоящих сервера (снято стендом), у сервера есть `app.js`, `.br` и `.gz`. */
export const SERVER_ROWS: { ae: string | null; negotiator: string; sirv: string; h3: string }[] = [
  { ae: CHROMIUM_AE, negotiator: 'br', sirv: 'br', h3: 'gzip' },
  { ae: 'gzip, deflate', negotiator: 'gzip', sirv: 'gzip', h3: 'gzip' },
  { ae: 'gzip;q=0', negotiator: 'identity', sirv: 'gzip', h3: 'identity' },
  { ae: 'br;q=0, gzip', negotiator: 'gzip', sirv: 'br', h3: 'gzip' },
  { ae: 'br;q=0.5, gzip;q=1', negotiator: 'gzip', sirv: 'br', h3: 'identity' },
  { ae: 'br;q=1.0, gzip;q=0.8', negotiator: 'br', sirv: 'br', h3: 'identity' },
  { ae: 'identity;q=1, *;q=0', negotiator: 'identity', sirv: 'identity', h3: 'identity' },
  { ae: '*', negotiator: 'br', sirv: 'identity', h3: 'identity' },
  { ae: 'gzip, *;q=0', negotiator: 'gzip', sirv: 'gzip', h3: 'gzip' },
  { ae: 'BR', negotiator: 'br', sirv: 'br', h3: 'identity' },
  { ae: '', negotiator: 'identity', sirv: 'identity', h3: 'identity' },
  { ae: null, negotiator: 'identity', sirv: 'identity', h3: 'identity' },
];

/** Две строки sirv 3.0.2, которые выбирают файл. Тест проверяет, что они дословно в `node_modules/sirv/build.js`. */
export const SIRV_SNIPPET = `if (gzips && val.includes('gzip')) extns.unshift(...gzips);
if (brots && /(br|brotli)/i.test(val)) extns.unshift(...brots);`;

export const SERVER_NOTE = `Колонка negotiator совпала с функцией темы на всех строках. sirv ищет в заголовке подстроку: \`gzip;q=0\` для него «есть gzip», \`br;q=0, gzip\` — «есть br», то есть он присылает ровно то, что клиент запретил. h3 сравнивает имена целиком в том порядке, в каком их написал клиент: Chromium получил от него gzip — ${n(F.js.gzip[8])} байт вместо ${n(F.js.br[11])} у brotli, на ${pct(F.js.gzip[8] - F.js.br[11], F.js.br[11])} больше. А \`br;q=1.0\` и \`BR\` h3 не узнал вовсе. Для обычного трафика браузера ошибки sirv не видны — Chromium весов не шлёт, а «только без сжатия» у \`<video>\` sirv понимает верно.`;

// ─── Раздел «Заранее или на лету» ──────────────────────────────────────────────────────────

const row = (f: FileSizes) => [
  f.label,
  n(f.raw),
  n(f.gzip[5]),
  n(f.gzip[8]),
  n(f.br[5]),
  n(f.br[11]),
  n(f.zstd[3]),
  n(f.zstd[19]),
];

export const LEVEL_HEAD = ['файл', 'исходный', 'gzip 6', 'gzip 9', 'br 5', 'br 11', 'zstd 3', 'zstd 19'];
export const LEVEL_ROWS = ['html', 'css', 'js'].map((id) => row(F[id]));

export const LEVEL_NOTE = `Что видно на файлах сайта. **gzip выше 6 почти ничего не даёт:** HTML с уровня 6 на 9 похудел на ${bytes(F.html.gzip[5] - F.html.gzip[8])} из ${n(F.html.gzip[5])}. **brotli до уровня 4 — почти gzip:** у HTML ${n(F.html.br[4])} против ${n(F.html.gzip[8])} у gzip 9. Дальше два скачка — на уровне 5 и на 10–11: HTML с 9 на 11 — минус ${less(F.html.br[11], F.html.br[9])}. Итог brotli 11 против gzip 9: HTML на ${less(F.html.br[11], F.html.gzip[8])} меньше, CSS — на ${less(F.css.br[11], F.css.gzip[8])}, JS — на ${less(F.js.br[11], F.js.gzip[8])}. **zstd между ними:** на уровне 3 он близок к gzip 6, на 19 — к brotli 9.`;

export const CPU_NOTE =
  `Время сжатия сильно зависит от машины, поэтому в таблице только байты. По документации brotli уровни 10 и 11 включают другой, намного более тщательный и медленный поиск повторов, а zstd 20–22 рассчитаны только на сжатие заранее — и на HTML сайта уровень 22 выиграл у 19 всего ${F.html.zstd[19] - F.html.zstd[22]} байт. Отсюда и правило: высокие уровни — только там, где сжимают **один раз**.`;

/** Счёт вызовов `zlib` на сервере стенда: 21 запрос Chromium к каждому варианту. */
export const CALLS = { requests: 21, static: 2, dynamic: 21, cached: 1 };

export const CALLS_ROWS: { k: string; calls: string; how: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'предсжатие', calls: `${CALLS.static} — при сборке`, how: '`app.js.br` (brotli 11) и `app.js.gz` (gzip 9) лежат на диске. На запрос сервер выбирает файл и знает его длину заранее: `Content-Length` есть.', tone: 'ok' },
  { k: 'на лету', calls: `${CALLS.dynamic} — по одному на запрос`, how: `gzip 6 потоком: ${n(CALLS.dynamic)} раз по ${n(F.js.raw)} байт, ${n(CALLS.dynamic * F.js.raw)} байт через компрессор. Длины заранее нет — ответ идёт кусками.`, tone: 'warn' },
  { k: 'на лету + память', calls: `${CALLS.cached} — на первый запрос`, how: 'Результат сжатия сохранён по ключу «адрес + кодировка». Так работает и CDN, который сжимает сам: один раз на вариант, дальше из кеша.' },
];

export const STATIC_NOTE =
  'Предсжатие подходит всему, что не меняется между запросами: бандлам, CSS, статическому HTML. Сервер должен уметь найти готовый файл рядом — в nginx это `gzip_static` и сторонний модуль `brotli_static`, у sirv — флаги `gzip` и `brotli`. Сжатие на лету остаётся для ответов, которые собираются на каждый запрос: API, страницы с данными пользователя. Как включают gzip на лету в nginx и почему он по умолчанию не сжимает ответы для CDN — в [«Nginx как обратном прокси», раздел «Кеш и gzip»](/delivery/nginx-proxy/#s7).';

export const SKIP_ROWS = ['woff2', 'png', 'tiny'].map((id) => [
  F[id].label,
  n(F[id].raw),
  n(F[id].gzip[8]),
  n(F[id].br[11]),
  n(F[id].zstd[19]),
]);

export const SKIP_NOTE = `**Шрифт woff2** внутри уже сжат brotli: brotli 11 сделал его на ${F.woff2.br[11] - F.woff2.raw} байт **больше**, zstd 19 — на ${F.woff2.zstd[19] - F.woff2.raw}, gzip 9 выиграл ${F.woff2.raw - F.woff2.gzip[8]} байт из ${n(F.woff2.raw)}. **PNG** сжат deflate своим форматом — минус ${less(F.png.br[11], F.png.raw)} в лучшем случае. С JPEG, WebP, AVIF, видео и архивами то же. **Крошечный файл** в ${bytes(F.tiny.raw)} после gzip весит ${F.tiny.gzip[8]}: у gzip 18 байт заголовка и хвоста, сжимать в таком файле нечего. Процессор на всё это потрачен зря, поэтому сжимают по списку типов — текстовых: HTML, CSS, JS, JSON, SVG, XML — и с порогом по размеру.`;

// ─── Раздел «Длина и Range» ────────────────────────────────────────────────────────────────

/** Сколько символов получил `fetch().text()`: обрезанный по длине ответ и ответ, сжатый дважды. */
export const LENGTH_CUT = 85192;
export const LENGTH_DOUBLE = 31177;

export const LENGTH_ROWS: { k: string; got: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: `предсжатый brotli, \`Content-Length: ${F.js.br[11]}\``, got: `принят; \`encodedBodySize\` ${n(F.js.br[11])}, \`decodedBodySize\` ${n(F.js.raw)}`, tone: 'ok' },
  { k: 'gzip на лету, длины нет', got: 'принят; по HTTP/1.1 в ответе `Transfer-Encoding: chunked` — «длина неизвестна, шлю кусками»', tone: 'ok' },
  { k: `\`Content-Length\` несжатого файла (${n(F.js.raw)}), тело gzip, соединение закрыто`, got: 'принят целиком, без ошибки: поток gzip сам знает, где кончается', tone: 'warn' },
  { k: 'то же, соединение оставлено открытым', got: 'ответ висел, пока сервер не закрыл соединение; потом принят', tone: 'err' },
  { k: '`Content-Length` на 100 байт меньше тела gzip', got: `**молча обрезан**: ${n(LENGTH_CUT)} символов из ${n(F.js.raw)}, ошибки нет`, tone: 'err' },
  { k: 'без сжатия, `Content-Length` больше тела', got: '`ERR_CONTENT_LENGTH_MISMATCH` — для сравнения: без сжатия та же ошибка ловится', tone: 'ok' },
  { k: '`Content-Encoding: gzip`, тело не сжато', got: '`ERR_CONTENT_DECODING_FAILED`, `fetch` — `TypeError`' },
  { k: 'сжато дважды, заголовок один', got: `**принят без ошибки**, в JS пришли ${n(LENGTH_DOUBLE)} символов двоичного мусора: снят только внешний слой`, tone: 'err' },
];

export const LENGTH_NOTE =
  '`Content-Length` у сжатого ответа — длина **сжатых** байтов. Её знает тот, кто сжал заранее; компрессор на лету не знает, пока не закончит, и шлёт ответ кусками. Ошибки длины Chromium прощает по-разному: слишком большая длина при закрытом соединении сходит с рук, слишком маленькая молча режет файл. Обрезанный скрипт потом падает синтаксической ошибкой где-то в середине — и ни одного сетевого сообщения об этом. Двойное сжатие обычно рождается из двух слоёв, каждый из которых «на всякий случай» сжимает сам: приложение и прокси перед ним.';

/** Ответы sirv на запросы с `Range`: сняты стендом, `ETag` и `Last-Modified` опущены. */
export const RANGE_CODE = `GET /app.js
Accept-Encoding: gzip, deflate, br, zstd
Range: bytes=0-99

HTTP/1.1 206 Partial Content
Content-Encoding: br
Content-Range: bytes 0-99/${F.js.br[11]}       ← из ${n(F.js.br[11])} байт brotli
Content-Length: 100

GET /app.js
Accept-Encoding: identity              ← так шлёт fetch с Range
Range: bytes=0-99

HTTP/1.1 206 Partial Content
Content-Range: bytes 0-99/${F.js.raw}       ← из ${n(F.js.raw)} байт исходника`;

export const RANGE_NOTE =
  'Диапазон считается в байтах того варианта, который выбран, — со сжатием, если оно есть. sirv так и сделал: на просьбу с `br` отдал первые 100 байт файла `app.js.br`, и в `Content-Range` стоит его длина. Кусок из середины сжатого потока сам по себе не распаковать, поэтому браузер, прося диапазон, сжатие отключает — `fetch` пишет `identity`. Отсюда же требование к валидаторам: у каждого варианта свой `ETag`. sirv берёт его из размера файла: `W/"29705-…"` у brotli и `W/"85367-…"` у исходника. Чем грозит общий `ETag` у двух вариантов — в тонких местах [«Сети и кеширования»](/platform/network/#s6).';

// ─── Раздел «Словари» ──────────────────────────────────────────────────────────────────────

export const PLAIN_DICT =
  'Как правка договора между двумя юристами. Новую редакцию не пересылают целиком — пишут «как в редакции от 1 марта, но в пункте 4 другая сумма». Работает, только если у обоих одна и та же редакция от 1 марта. Поэтому браузер называет не имя файла, а его отпечаток — хеш.';

/** Правки, превращающие первую версию бандла во вторую. Тест повторяет их над файлом из `dist/`. */
export const DICT_EDITS: [string, string][] = [
  ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-core.esm-bundler.D9fKq2Lx.js'],
  ['`Ничего не найдено.`', '`Ничего не найдено — попробуйте другое слово.`'],
  ['data-v-1875c2d8', 'data-v-4b0e91a7'],
  ['var bt=', 'function zt(e){return e.trim().toLowerCase().normalize(`NFKC`)}var bt='],
];

export const DICT_FILE = { file: 'dist/_astro/FuzzyLab.BmwIWsFT.js', sha: '984889d6337663aa', v1: 32561, v2: 32673 };
export const DICT_HTML = { dict: 'dist/platform/network/index.html', target: 'dist/platform/cdn-cache/index.html', targetSha: 'a664854b84febcbd' };
export const DICT_MICRO = { file: 'dist/_astro/MicroProbe.Dtmj0LIb.js', sha: 'e094a52bbb310bfd' };

/** Обмен Chromium 153 ↔ сервер стенда, заголовки дословно (лишние опущены). */
export const DICT_CODE = `# 1. Первая версия — обычный ответ с пометкой «годится в словари»
GET /v1/app.js
→ Accept-Encoding: gzip, deflate, br, zstd
← Cache-Control: max-age=3600
← Use-As-Dictionary: match="/v*/app.js", id="fuzzy-v1"

# 2. Вторая версия — браузер сам называет, какой словарь у него есть
GET /v2/app.js
→ Accept-Encoding: gzip, deflate, br, zstd, dcb, dcz
→ Available-Dictionary: :mEiJ1jN2Y6o086kv1m2s0bWRxt4Fb44GEC/pNHfmNjY=:
→ Dictionary-ID: "fuzzy-v1"
← Content-Encoding: dcz
← Vary: accept-encoding, available-dictionary
← Content-Length: 133`;

export const DICT_V1_HASH = 'mEiJ1jN2Y6o086kv1m2s0bWRxt4Fb44GEC/pNHfmNjY=';

export const DICT_NOTE =
  'Первый ответ — самый обычный, только с заголовком `Use-As-Dictionary`: `match` — шаблон адресов, для которых файл пригодится, `id` — метка для сервера. Браузер кладёт ответ в HTTP-кеш и запоминает шаблон. Следующий запрос под шаблон уходит с хешем sha-256 этого файла в `Available-Dictionary`, меткой в `Dictionary-ID` и двумя новыми кодировками: `dcb` — brotli со словарём, `dcz` — zstd со словарём. Сервер ищет у себя файл с таким хешем, сжимает новую версию относительно него и начинает тело с того же хеша. Кодировку выбирают обычным `Accept-Encoding`, а словарь — отдельным заголовком.';

export const DICT_EDITS_NOTE = `Вторая версия — тот же чанк с четырьмя правками, какие приносит обычный релиз: у зависимости сменился хеш в имени файла, поменялась строка интерфейса, у scoped-стилей сменился хеш \`data-v-…\`, добавилась маленькая функция. Было ${n(DICT_FILE.v1)} байт, стало ${n(DICT_FILE.v2)}.`;

export const DICT_ROWS: { k: string; raw: number; br11: number; zstd19: number; dcz: number; tone?: 'ok' | 'warn' }[] = [
  { k: 'FuzzyLab v2, словарь — v1', raw: 32673, br11: 10554, zstd19: 11637, dcz: 133, tone: 'ok' },
  { k: 'FuzzyLab v2, словарь — соседний чанк MicroProbe', raw: 32673, br11: 10554, zstd19: 11637, dcz: 11061 },
  { k: 'FuzzyLab v2, словарь — CSS каркаса', raw: 32673, br11: 10554, zstd19: 11637, dcz: 11656, tone: 'warn' },
  { k: 'страница «CDN и серверный кеш», словарь — страница «Сеть и кеширование»', raw: 177996, br11: 29029, zstd19: 31717, dcz: 21408, tone: 'ok' },
];

/** zstd 3 со словарём v1 — уровень, на котором сжимают на лету. */
export const DICT_DCZ3 = 145;

export const DICT_ROWS_NOTE = `Из 133 байт по сети 40 — заголовок \`dcz\`: восемь байт метки и хеш словаря. Сжатие со словарём заменяет целые неизменённые функции ссылкой «скопируй столько-то байт с такого-то места словаря», поэтому платить приходится только за правки. Даже zstd 3, который годится для сжатия на лету, дал ${DICT_DCZ3} байт. Чужой словарь помогает, пока похож: соседний виджет написан тем же компилятором Vue и сэкономил ${n(DICT_ROWS[0].zstd19 - DICT_ROWS[1].dcz)} байт против zstd 19 без словаря (но brotli 11 без всякого словаря всё равно меньше), а CSS как словарь для JS не дал ничего — ${n(DICT_ROWS[2].dcz)} против ${n(DICT_ROWS[2].zstd19)}. Две разные страницы сайта делят каркас, навигацию и стили: на ${less(DICT_ROWS[3].dcz, DICT_ROWS[3].br11)} меньше brotli 11. Chromium принял эту страницу навигацией: \`encodedBodySize\` ${n(DICT_ROWS[3].dcz)}, \`decodedBodySize\` ${n(DICT_ROWS[3].raw)}.`;

export const DICT_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Хеш в теле сверяется',
    d: 'Сервер стенда нарочно сжал ответ чужим словарём и записал в начало тела его хеш. Chromium отказался: `ERR_UNEXPECTED_CONTENT_DICTIONARY_HEADER`, `fetch` бросил `TypeError`. Сервер обязан сжимать ровно тем файлом, чей хеш пришёл в `Available-Dictionary`, — а если такого нет, отвечать обычным сжатием.',
    tone: 'err',
  },
  {
    t: 'Только в безопасном контексте',
    d: 'На `http://dict.test` Chromium не прислал ни `Available-Dictionary`, ни `dcb, dcz`, хотя `Use-As-Dictionary` получил. Вторая версия приехала целиком. RFC 9842 требует HTTPS: прокси по дороге не должны видеть незнакомую кодировку.',
    tone: 'warn',
  },
  {
    t: '`match-dest` сужает словарь',
    d: 'Страница отдана с `match-dest=("document")`. Следующая страница под шаблон пришла со словарём, а стили с тех же адресов — без него: у них назначение `style`. Без `match-dest` словарь подходит запросу любого вида.',
  },
  {
    t: 'brotli со словарём Node не сделает',
    d: `\`brotliCompressSync(v2, { dictionary: v1 })\` в Node 24.11 вернул ${n(10554)} байт — ровно столько же, сколько без словаря. Опция молча проигнорирована. У zstd словарь работает (\`zstdCompressSync(v2, { dictionary: v1 })\`), поэтому \`dcz\` из Node собрать можно, а \`dcb\` — только внешним brotli с поддержкой общих словарей. И ещё одна ловушка на обратном пути: \`zstdDecompressSync\` на целом теле \`dcz\` вернул **пустой** буфер — остановился на служебном кадре с хешем. Первые 40 байт надо отрезать самому.`,
    tone: 'warn',
  },
  {
    t: 'Окно zstd',
    d: 'zstd видит словарь, пока не сжал больше окна. RFC 9842 обязывает клиента принять окно не меньше 8 МБ или 1,25 размера словаря, но не больше 128 МБ. Для бандлов это не предел, для больших файлов — да; brotli видит словарь целиком. По спецификации, не проверялось.',
  },
  {
    t: 'Цена — на сервере',
    d: 'Для каждой пары «старая версия → новая» нужен свой сжатый файл, а прошлые версии надо хранить. Ответ обязан нести `Vary: accept-encoding, available-dictionary`, иначе общий кеш отдаст байты под словарь тому, у кого его нет. Словарь живёт в HTTP-кеше и работает, пока свеж: ответ с `no-store` словарём не становится — пример в [«Сети и кешировании», раздел «Кеш и валидация»](/platform/network/#s2).',
  },
];

// ─── Раздел «BREACH» ───────────────────────────────────────────────────────────────────────

export const BREACH_CODE = `// Страница: секрет и то, что пользователь искал, — в одном ответе.
const CSRF = '7c3fa91e';
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');

function render(query) {
  return [
    '<!doctype html><html><body>',
    '<a href="/logout?csrf=' + CSRF + '">Выйти</a>',
    '<p>Вы искали: ' + escapeHtml(query) + '</p>',
    '</body></html>',
  ].join('\\n');
}

// Атакующий видит только длину ответа — например, в сетевом трафике.
const size = (query) => gzipSync(render(query)).length;`;

export const BREACH_SECRET = '7c3fa91e';
export const BREACH_WRONG = '0b2e8d4f';

/** `size('csrf=' + префикс)` для верного и неверного префикса длиной k. Сверяет тест. */
export const BREACH_ROWS: { k: number; right: number; wrong: number }[] = [
  { k: 0, right: 127, wrong: 127 },
  { k: 1, right: 127, wrong: 128 },
  { k: 2, right: 127, wrong: 129 },
  { k: 4, right: 127, wrong: 131 },
  { k: 6, right: 127, wrong: 133 },
  { k: 8, right: 127, wrong: 135 },
];

export const PLAIN_BREACH =
  'Как угадывать слово по счёту за телеграмму, где повтор уже написанного стоит копейку, а новое слово — рубль. Вы дописываете в телеграмму свою догадку и смотрите на счёт. Совпала догадка с тем, что уже есть в тексте, — счёт почти не вырос. Не совпала — вырос на рубль.';

export const BREACH_NOTE =
  'Верный префикс токена совпадает с текстом страницы и становится ссылкой назад — длина ответа не меняется. Каждый неверный знак стоит байт. Перебирая по одному знаку, тест темы восстановил весь токен `7c3fa91e` за 8 × 16 = 128 запросов. Экранирование не мешает: в догадке `csrf=7c3` нет ни одного опасного символа. HTTPS тоже не мешает: шифрование прячет байты, а не их число. Это атака BREACH (2013): нужны сжатие ответа, секрет в теле, отражённый ввод и возможность слать запросы от имени жертвы и видеть размер ответа. Как браузер сам выдаёт размеры чужих ответов — в [«XS-Leaks», раздел «Классы утечек»](/platform/xs-leaks/#s2).';

export const BREACH_FIXES = [
  'Не сжимать ответы, где рядом лежат секрет и то, что прислал пользователь. Статика и публичные страницы — сжимать спокойно.',
  'Маскировать токен в каждом ответе заново: случайная маска и токен, сложенные XOR, — в разметке каждый раз другие байты, угадывать нечего.',
  'Держать секреты отдельно от отражённого ввода: токен — в отдельном ответе или в куке, а не в той же странице.',
  'Не принимать чужие запросы с куками: `SameSite` и проверка `Sec-Fetch-Site` лишают атакующего возможности слать запросы от имени жертвы.',
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Первое в списке — не самое желанное',
    d: `Chromium пишет \`gzip, deflate, br, zstd\`, и у всех вес 1. Сервер, который берёт первое имя (так поступил h3), отдаёт gzip — на стенде ${n(F.js.gzip[8])} байт вместо ${n(F.js.br[11])}. Среди равных выбирает сервер, по своему порядку.`,
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Поиск подстроки не читает `q=0`',
    d: 'sirv на `br;q=0, gzip` прислал brotli — именно то, что клиент запретил. Проверка `includes(\'gzip\')` видит имя, но не вес. Браузерам это не мешает, клиентам с весами — да.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Без `Vary` общий кеш раздаёт чужой вариант',
    d: 'Ответ сжат brotli, а `Vary: Accept-Encoding` нет — CDN сохранит brotli под голым адресом и отдаст его клиенту, который brotli не умеет. Со словарями то же, и `Vary` должен называть ещё `available-dictionary`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Неверный `Content-Length` у сжатого ответа',
    d: 'Длина меньше тела — Chromium молча обрезал файл. Больше тела при открытом соединении — ответ висел до закрытия. Без сжатия та же ошибка была бы видна сразу, `ERR_CONTENT_LENGTH_MISMATCH`.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Двойное сжатие проходит без ошибки',
    d: 'Приложение сжало ответ, прокси сжал ещё раз и оставил один `Content-Encoding: gzip`. Браузер снял один слой, скрипт получил двоичный мусор, сеть — ни одной ошибки. Сжимать должен один слой.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Сжатие картинок и шрифтов — работа впустую',
    d: 'woff2 после brotli 11 стал на 5 байт больше, PNG — на 3% меньше в лучшем случае. Процессор потрачен, байты те же. Сжимают по списку текстовых типов.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`Range` считает сжатые байты',
    d: 'На запрос с `br` и `Range` sirv отдал кусок файла `app.js.br`. Клиент, который сам ставит и `Range`, и `Accept-Encoding: br`, получит середину сжатого потока, которую не распаковать отдельно. Браузер поэтому шлёт с `Range` только `identity`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'brotli со словарём в Node молча не работает',
    d: 'Опция `dictionary` у `brotliCompressSync` не даёт ошибки и не меняет результат. Похоже на успех, пока не сравнишь размеры. Для `dcz` словарь в Node есть, для `dcb` — нет.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`Accept-Encoding` из JS не задать',
    d: 'Заголовок запрещён для страниц: `fetch` молча заменил `identity` на стандартный список. Получить сжатые байты как есть страница не может — тело всегда распаковано.',
  },
  {
    n: '10',
    t: 'HTTPS не прячет длину',
    d: 'BREACH читает секрет по размеру сжатого ответа, а шифрование размер почти не меняет. Ответы с секретом и отражённым вводом не сжимают либо маскируют секрет заново в каждом ответе.',
    tone: 'err',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'RFC 9110 — HTTP Semantics, раздел 12.5.3 «Accept-Encoding»',
    href: 'https://www.rfc-editor.org/rfc/rfc9110#section-12.5.3',
    what: 'три правила выбора кодировки, `identity`, `*`, пустой заголовок; примеры из `RFC_CASES`',
  },
  {
    title: 'RFC 9110, раздел 8.4 «Content-Encoding»',
    href: 'https://www.rfc-editor.org/rfc/rfc9110#section-8.4',
    what: 'кодировка — свойство представления; `Content-Length` и `Range` считают его байты',
  },
  {
    title: 'RFC 9842 — Compression Dictionary Transport',
    href: 'https://www.rfc-editor.org/rfc/rfc9842',
    what: '`Use-As-Dictionary`, `Available-Dictionary`, `Dictionary-ID`, форматы `dcb` и `dcz`, окно zstd, требование HTTPS',
  },
  {
    title: 'Fetch Standard — HTTP-network-or-cache fetch',
    href: 'https://fetch.spec.whatwg.org/#http-network-or-cache-fetch',
    what: '`Accept-Encoding: identity` при `Range`; список запрещённых заголовков — там же',
  },
  {
    title: 'Node.js — zlib',
    href: 'https://nodejs.org/api/zlib.html',
    what: '`gzipSync`, `brotliCompressSync`, `zstdCompressSync` и их параметры; проверено на 24.11.0',
  },
  {
    title: 'Chrome for Developers — Compression dictionary transport',
    href: 'https://developer.chrome.com/blog/shared-dictionary-compression',
    what: 'как Chromium включает словари и что требует от сервера',
  },
  {
    title: 'BREACH',
    href: 'https://www.breachattack.com/',
    what: 'условия атаки и меры защиты от авторов',
  },
  {
    title: 'negotiator, sirv, h3',
    href: 'https://github.com/jshttp/negotiator',
    what: 'negotiator 1.0.0 — выбор по весам; sirv 3.0.2 и h3 1.15 — их код в `node_modules` курса',
  },
];

export const RELATED =
  'Смежное на сайте: [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — `ETag` у сжатого варианта, первый замер форматов и словарь в лучшем случае. [CDN и серверный кеш, раздел «Ключ и Vary»](/platform/cdn-cache/#s2) — сколько стоят варианты в общем кеше. [Nginx как обратный прокси, раздел «Кеш и gzip»](/delivery/nginx-proxy/#s7) — gzip на лету в nginx. [Стримы и обратное давление, раздел «Итерация и байты»](/platform/streams/#s6) — `CompressionStream` в JS. [HTTP/2 и HTTP/3, раздел «HPACK»](/platform/http2-http3/#s4) — сжатие заголовков, а не тела. [REST, GraphQL и gRPC-web, раздел «gRPC-web»](/platform/api-styles/#s6) — JSON и protobuf после сжатия. [XS-Leaks, раздел «Классы утечек»](/platform/xs-leaks/#s2) — размер ответа как канал утечки. [Что внутри gzip](/algorithms/deflate/) — LZ77, коды Хаффмана и блоки DEFLATE по битам. [Бюджеты производительности](/tooling/performance-budgets/) — вес страницы по графу чанков и проверка бюджета в CI на примере этого курса.';
