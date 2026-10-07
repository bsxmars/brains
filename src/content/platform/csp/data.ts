import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MatrixRow, Preset, Probe } from '@/widgets/csp-lab/model/types';

/**
 * Данные темы «CSP и Trusted Types: как внедрить и не сломать сайт».
 *
 * Тема написана здесь, 2026-10-01, для направления «Сеть и безопасность». Обзор CSP, nonce
 * и `'strict-dynamic'` в трёх политиках, требования к nonce и первые шаги Trusted Types —
 * в «Безопасности фронтенда» (разделы «CSP» и «XSS»); здесь они не пересказываются.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** из Playwright 1.63 (headless shell), Node 24.11.0, esbuild 0.28.2,
 * Vue 3.5.42 (`@vue/compiler-dom` + `runtime-dom`), React 19.3.0 + react-dom 19.3.0 — всё
 * из `node_modules` проекта. Октябрь 2026.
 *
 * Сервер — свой `node:http` на двух портах: сайт и «чужой» источник (CDN). Chromium запущен
 * с `--host-resolver-rules`, поэтому они видны как `http://site.test` и `http://cdn.test`, —
 * в политиках и журналах стоят читаемые имена, а не номера портов. Порты сайта и CDN разные,
 * значит это разные origin.
 *
 * Как снято:
 *   — **матрица** (`MATRIX`): страница `PAGE_HTML` отдаётся 31 раз с разными заголовками
 *     `Content-Security-Policy` (строка `csp`). До загрузки страницы Playwright ставит `MARK_CODE`
 *     через `addInitScript` (он CSP не подчиняется), после загрузки `AFTER_LOAD_CODE` исполняется
 *     через CDP `Runtime.evaluate` с `allowUnsafeEvalBlockedByCSP: false` — иначе DevTools
 *     разрешает `eval` сам себе, и проба `eval` ничего не мерит. «Выполнилось» — id попал в
 *     `window.ran`. 31 × 15 = 465 пар; `CSP_CHECK_CODE` совпал на всех;
 *   — **тексты консоли** (`CONSOLE_*`) — из `page.on('console')` тех же прогонов, дословно;
 *   — **отчёты**: `report-uri` — тело POST, принятое сервером (`REPORT_URI_BODY`);
 *     `report-to` — тело из `ReportingObserver` на странице и из CDP
 *     `Network.reportingApiReportAdded` (совпадают поле в поле — `REPORT_TO_BODY`). ⚠️ Доставку
 *     `report-to` на сервер увидеть **не удалось**: ни по http, ни по https с сертификатом,
 *     разрешённым через `--ignore-certificate-errors-spki-list`, ни с `--short-reporting-delay`
 *     за 100 с. CDP показывал, что конечная точка зарегистрирована, а отчёт ходит по кругу
 *     `Queued → Pending → Queued` с нулём попыток. Поэтому вид POST от `report-to` (массив,
 *     `application/reports+json`) — **по спецификации Reporting API**, не снят;
 *   — **`<meta>`, Trusted Types, фреймворки** — те же сервер и браузер; фикстуры Vue и React
 *     собраны esbuild (`format: 'iife'`, `NODE_ENV=production`), шаблон Vue скомпилирован
 *     `@vue/compiler-dom` (для «большой статики» — с `hoistStatic`, он даёт `createStaticVNode`).
 *
 * Всё перечисленное, кроме доставки `report-to`, пересобирается `tests/unit/csp.test.ts` —
 * тот поднимает тот же сервер, тот же Chromium и сверяет литералы ниже с тем, что браузер
 * делает сейчас; хеши пересчитывает `node:crypto`.
 *
 * ── Что взято из спецификаций, а не снято ─────────────────────────────────────────────────
 *   — исследование списков доменов (Weichselbaum и др., ACM CCS 2016) — упомянуто одной фразой
 *     со ссылкой на «Безопасность фронтенда», где разобрано;
 *   — устройство JSONP и «гаджетов» — принцип, без проверки на реальных сайтах (намеренно);
 *   — CSSOM не проверяется CSP — разобрано в «Безопасности фронтенда», здесь не повторяется;
 *   — поддержка в Firefox и Safari не снималась: все утверждения о поведении — Chromium 153.
 *
 * ── Расхождение с соседней темой ──────────────────────────────────────────────────────────
 * В «Безопасности фронтенда» (`REPORT_FACTS`) сказано, что `blocked-uri` для cross-origin
 * ресурса урезается до origin. На стенде Chromium 153 прислал полный адрес чужого скрипта
 * вместе со строкой запроса (`http://cdn.test/s/cdn.js?token=SECRET123`) — и в `report-uri`,
 * и в событии, и в `ReportingObserver`. Спецификация урезает адрес только после
 * cross-origin **редиректа**; здесь редиректа не было. Сообщено владельцу той темы.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'директива',
    d: 'Одно правило в заголовке CSP: имя и список значений через пробел, правила — через `;`. `script-src \'self\'` — директива `script-src` со значением `\'self\'`.',
  },
  {
    k: 'источник (source)',
    d: 'Одно значение в директиве: адрес (`cdn.test`, `https:`), ключевое слово в кавычках (`\'self\'`, `\'unsafe-inline\'`), nonce или хеш. Скрипт выполнится, если подошёл хоть один источник.',
  },
  {
    k: 'инлайн-скрипт и обработчик',
    d: 'Инлайн-скрипт — `<script>` с кодом внутри, без `src`. Обработчик в атрибуте — код в `onclick="…"` и подобных атрибутах. Для CSP это разные вещи, и проверяют их разные директивы.',
  },
  {
    k: 'nonce',
    d: 'Случайная строка, которую сервер пишет в заголовок CSP и в атрибут `nonce` своих `<script>`. Новая на каждый ответ, поэтому внедрённый тег её не знает.',
  },
  {
    k: 'хеш (hash)',
    d: 'Отпечаток текста скрипта: SHA-256, записанный в base64. Изменился хоть один символ, включая пробел или перевод строки, — отпечаток другой.',
  },
  {
    k: 'вставлен парсером',
    d: 'Скрипт, который браузер нашёл, разбирая HTML: в ответе сервера, в `innerHTML`, в `document.write`. Противоположность — скрипт, созданный кодом через `document.createElement`.',
  },
  {
    k: 'место вставки (sink)',
    d: 'Свойство или функция, где строка превращается в разметку или код: `innerHTML`, `eval`, `script.src`. Через них работает DOM-XSS, и именно их перекрывают Trusted Types.',
  },
  {
    k: 'report-only',
    d: 'Режим «только отчитываться»: заголовок `Content-Security-Policy-Report-Only`. Браузер ничего не блокирует, а сообщает, что заблокировал бы.',
  },
];

export const PLAIN_CSP =
  'Как охрана на входе в офис. Список гостей можно составить по фирмам: «всех из „Ромашки“ пускать» — но тогда пройдёт любой, кто назовётся сотрудником „Ромашки“. Надёжнее выдавать на утро браслет нового цвета (nonce) или сверять отпечаток пальца (хеш). А правило «кого провёл гость с браслетом, тоже пускать» — это `\'strict-dynamic\'`.';

export const PREREQ_NOTE =
  'Тема — о том, как внедрять политику на живом сайте. Что такое CSP и XSS, объяснено в другой теме, здесь — продолжение.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Что такое CSP и зачем nonce',
    d: 'Заголовок, в котором сервер перечисляет, откуда странице можно брать скрипты. Почему список доменов слабее nonce и что значит `\'strict-dynamic\'` на трёх политиках.',
    href: '/platform/security/#s3',
    hrefLabel: '«Безопасность фронтенда», раздел «CSP»',
    tone: 'info',
  },
  {
    t: 'Как работает XSS',
    d: 'Чужие данные попадают туда, где браузер читает их как разметку или код: `innerHTML`, `v-html`, атрибут `href`. CSP и Trusted Types — второй рубеж поверх экранирования.',
    href: '/platform/security/#s4',
    hrefLabel: '«Безопасность фронтенда», раздел «XSS»',
    tone: 'info',
  },
  {
    t: 'Заголовки ответа ставит сервер или прокси',
    d: 'CSP — заголовок HTTP-ответа. Его пишет бэкенд или nginx перед ним, и у nginx есть ловушка: своя `add_header` в `location` отменяет все заголовки уровнем выше.',
    href: '/delivery/nginx-proxy/#s4',
    hrefLabel: '«nginx перед приложением», раздел «Заголовки к бэкенду»',
    tone: 'info',
  },
  {
    t: 'Хеш-функция и base64',
    d: 'SHA-256 превращает любой текст в 32 байта; одинаковый текст — одинаковые байты, другой — совсем другие. Base64 записывает эти байты 44 символами из букв, цифр, `+`, `/` и `=`.',
    tone: 'info',
  },
];

// ─── Раздел 1. Как браузер решает ─────────────────────────────────────────────────────────

export const SITE = 'http://site.test';
export const CDN = 'http://cdn.test';
export const NONCE = 'r4nd0m';

/** Содержимое внешних скриптов стенда: каждый сообщает свой id. */
export const SCRIPT_FILES: Record<string, string> = {
  [`${SITE}/s/self.js`]: "mark('self-src')",
  [`${SITE}/s/hashed.js`]: "mark('ext-hash')",
  [`${SITE}/s/dyn.js`]: "mark('dyn-self')",
  [`${CDN}/s/cdn.js`]: "mark('cdn-src')",
  [`${CDN}/s/cdn-n.js`]: "mark('nonce-src')",
  [`${CDN}/s/dyn-cdn.js`]: "mark('dyn-cdn')",
};

/** Ставится до загрузки страницы (в обход CSP): так проба может сообщить, что выполнилась. */
export const MARK_CODE = `window.ran = [];
window.mark = (id) => ran.push(id);`;

/** Сквозная страница: двенадцать проб в разметке. Nonce — `r4nd0m`, в жизни он новый на каждый ответ. */
export const PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Пробы CSP</title></head><body>
<script src="/s/self.js"></script>
<script src="http://cdn.test/s/cdn.js"></script>
<script nonce="r4nd0m" src="http://cdn.test/s/cdn-n.js"></script>
<script>mark('inline')</script>
<script nonce="r4nd0m">mark('inline-nonce')</script>
<script>mark('inline-hash')</script>
<script src="/s/hashed.js" integrity="sha256-JAVK8IY3qGj0kQxpWAET8LLbnPJvExXtBJcHR/0Q8V4="></script>
<button id="b1" onclick="mark('onclick')">1</button>
<button id="b2" onclick="mark('onclick-hash')">2</button>
<a id="j" href="javascript:mark('js-url')">3</a>
</body></html>`;

/** То, что делает код уже после загрузки: ещё пять проб. */
export const AFTER_LOAD_CODE = `// Скрипты, созданные кодом, а не парсером
for (const src of ['/s/dyn.js', 'http://cdn.test/s/dyn-cdn.js']) {
  const s = document.createElement('script');
  s.src = src;
  document.head.append(s);
}
// Обработчики и javascript:-ссылка — нажатием
document.getElementById('b1').click();
document.getElementById('b2').click();
document.getElementById('j').click();
// Строка как код
try { eval("mark('eval')"); } catch {}
try { new Function("mark('new-function')")(); } catch {}
setTimeout("mark('timeout-string')", 0);`;

/** Хеши текстов проб. Пересчитывает `node:crypto` в тесте. */
export const HASHES = {
  inline: 'dDidRDUGR+dufPD+GMvCnSYvHMbwzikuV6eJwHAjMPA=',
  inlineNonce: '026fu9XTqJRH3nUuDV4n0Ni9/JAyWptKpHst9FiZoWo=',
  inlineHash: 'C2BmX+g+xWBNshtAcNBBlmIbqx9H6BKoCCpcQ/poytA=',
  extHash: 'JAVK8IY3qGj0kQxpWAET8LLbnPJvExXtBJcHR/0Q8V4=',
  onclick: 'Hd4Zzt1fN9HvGp4y6MW9R+Oxo77gi1oBF3VuRlcrmhg=',
  onclickHash: 'QZ5tsiRPUfAuXVkfMNDvw8M9q8BxpYFOsPUCr4BHowI=',
  /** От всего адреса `javascript:mark('js-url')`. */
  jsUrl: 'gNYAV13BAe46HbTa6SpRhg0sSNMzHvOoHkHfTFfQY+A=',
  /** От одного кода `mark('js-url')`, без `javascript:`. */
  jsUrlBody: 'n2+A7p/1S2w6/cE6TZTTZcW5zUCDAbOmHu+O7nlq+dU=',
};

export const PROBES: Probe[] = [
  { id: 'self-src', code: '<script src="/s/self.js">', req: { type: 'script', url: `${SITE}/s/self.js`, parser: true } },
  { id: 'cdn-src', code: '<script src="http://cdn.test/s/cdn.js">', req: { type: 'script', url: `${CDN}/s/cdn.js`, parser: true } },
  { id: 'nonce-src', code: '<script nonce="r4nd0m" src="http://cdn.test/…">', req: { type: 'script', url: `${CDN}/s/cdn-n.js`, parser: true, nonce: NONCE } },
  { id: 'inline', code: "<script>mark('inline')</script>", req: { type: 'inline', hash: HASHES.inline } },
  { id: 'inline-nonce', code: '<script nonce="r4nd0m">…</script>', req: { type: 'inline', nonce: NONCE, hash: HASHES.inlineNonce } },
  { id: 'inline-hash', code: "<script>mark('inline-hash')</script>", req: { type: 'inline', hash: HASHES.inlineHash } },
  { id: 'ext-hash', code: '<script src="/s/hashed.js" integrity="sha256-…">', req: { type: 'script', url: `${SITE}/s/hashed.js`, parser: true, integrity: HASHES.extHash } },
  { id: 'dyn-self', code: "createElement('script'), src = '/s/dyn.js'", req: { type: 'script', url: `${SITE}/s/dyn.js`, parser: false } },
  { id: 'dyn-cdn', code: "createElement('script'), src = 'http://cdn.test/…'", req: { type: 'script', url: `${CDN}/s/dyn-cdn.js`, parser: false } },
  { id: 'onclick', code: '<button onclick="mark(\'onclick\')">', req: { type: 'handler', hash: HASHES.onclick } },
  { id: 'onclick-hash', code: '<button onclick="mark(\'onclick-hash\')">', req: { type: 'handler', hash: HASHES.onclickHash } },
  { id: 'js-url', code: '<a href="javascript:mark(\'js-url\')">', req: { type: 'js-url', hash: HASHES.jsUrl } },
  { id: 'eval', code: 'eval("…")', req: { type: 'eval' } },
  { id: 'new-function', code: 'new Function("…")', req: { type: 'eval' } },
  { id: 'timeout-string', code: 'setTimeout("…", 0)', req: { type: 'eval' } },
];

/** Журнал Chromium 153: какие пробы `PAGE_HTML` + `AFTER_LOAD_CODE` выполнились под каждой политикой. */
export const MATRIX: MatrixRow[] = [
  { id: 'none', csp: null, ran: ['self-src', 'cdn-src', 'nonce-src', 'inline', 'inline-nonce', 'inline-hash', 'ext-hash', 'dyn-self', 'dyn-cdn', 'onclick', 'onclick-hash', 'js-url', 'eval', 'new-function', 'timeout-string'] },
  { id: 'self', csp: "script-src 'self'", ran: ['self-src', 'ext-hash', 'dyn-self'] },
  { id: 'self-cdn', csp: "script-src 'self' cdn.test", ran: ['self-src', 'cdn-src', 'nonce-src', 'ext-hash', 'dyn-self', 'dyn-cdn'] },
  { id: 'self-inline', csp: "script-src 'self' 'unsafe-inline'", ran: ['self-src', 'inline', 'inline-nonce', 'inline-hash', 'ext-hash', 'dyn-self', 'onclick', 'onclick-hash', 'js-url'] },
  { id: 'self-inline-eval', csp: "script-src 'self' 'unsafe-inline' 'unsafe-eval'", ran: ['self-src', 'inline', 'inline-nonce', 'inline-hash', 'ext-hash', 'dyn-self', 'onclick', 'onclick-hash', 'js-url', 'eval', 'new-function', 'timeout-string'] },
  { id: 'nonce', csp: "script-src 'nonce-r4nd0m'", ran: ['nonce-src', 'inline-nonce'] },
  { id: 'nonce-inline', csp: "script-src 'nonce-r4nd0m' 'unsafe-inline'", ran: ['nonce-src', 'inline-nonce'] },
  { id: 'nonce-sd', csp: "script-src 'nonce-r4nd0m' 'strict-dynamic'", ran: ['nonce-src', 'inline-nonce', 'dyn-self', 'dyn-cdn'] },
  { id: 'nonce-sd-fallback', csp: "script-src 'nonce-r4nd0m' 'strict-dynamic' 'self' cdn.test http: 'unsafe-inline'", ran: ['nonce-src', 'inline-nonce', 'dyn-self', 'dyn-cdn'] },
  { id: 'sd-only', csp: "script-src 'strict-dynamic'", ran: ['dyn-self', 'dyn-cdn'] },
  { id: 'hash', csp: "script-src 'sha256-C2BmX+g+xWBNshtAcNBBlmIbqx9H6BKoCCpcQ/poytA='", ran: ['inline-hash'] },
  { id: 'hash-inline', csp: "script-src 'sha256-C2BmX+g+xWBNshtAcNBBlmIbqx9H6BKoCCpcQ/poytA=' 'unsafe-inline'", ran: ['inline-hash'] },
  { id: 'hash-ext', csp: "script-src 'sha256-JAVK8IY3qGj0kQxpWAET8LLbnPJvExXtBJcHR/0Q8V4='", ran: ['ext-hash'] },
  { id: 'hash-onclick', csp: "script-src 'self' 'sha256-QZ5tsiRPUfAuXVkfMNDvw8M9q8BxpYFOsPUCr4BHowI='", ran: ['self-src', 'ext-hash', 'dyn-self'] },
  { id: 'unsafe-hashes', csp: "script-src 'self' 'unsafe-hashes' 'sha256-QZ5tsiRPUfAuXVkfMNDvw8M9q8BxpYFOsPUCr4BHowI='", ran: ['self-src', 'ext-hash', 'dyn-self', 'onclick-hash'] },
  { id: 'unsafe-hashes-jsurl-full', csp: "script-src 'unsafe-hashes' 'sha256-gNYAV13BAe46HbTa6SpRhg0sSNMzHvOoHkHfTFfQY+A='", ran: ['js-url'] },
  { id: 'unsafe-hashes-jsurl-body', csp: "script-src 'unsafe-hashes' 'sha256-n2+A7p/1S2w6/cE6TZTTZcW5zUCDAbOmHu+O7nlq+dU='", ran: [] },
  { id: 'star', csp: 'script-src *', ran: ['self-src', 'cdn-src', 'nonce-src', 'ext-hash', 'dyn-self', 'dyn-cdn'] },
  { id: 'scheme-http', csp: 'script-src http:', ran: ['self-src', 'cdn-src', 'nonce-src', 'ext-hash', 'dyn-self', 'dyn-cdn'] },
  { id: 'none-kw', csp: "script-src 'none'", ran: [] },
  { id: 'default-self', csp: "default-src 'self'", ran: ['self-src', 'ext-hash', 'dyn-self'] },
  { id: 'elem-only', csp: "script-src-elem 'self'", ran: ['self-src', 'ext-hash', 'dyn-self', 'onclick', 'onclick-hash', 'eval', 'new-function', 'timeout-string'] },
  { id: 'attr-inline', csp: "script-src 'self'; script-src-attr 'unsafe-inline'", ran: ['self-src', 'ext-hash', 'dyn-self', 'onclick', 'onclick-hash'] },
  { id: 'elem-vs-src', csp: "script-src 'self' 'unsafe-eval'; script-src-elem 'nonce-r4nd0m'", ran: ['nonce-src', 'inline-nonce', 'eval', 'new-function', 'timeout-string'] },
  { id: 'two-policies', csp: "script-src 'self' 'unsafe-inline', script-src 'nonce-r4nd0m' 'self'", ran: ['self-src', 'inline-nonce', 'ext-hash', 'dyn-self'] },
  { id: 'eval-only', csp: "script-src 'unsafe-eval'", ran: ['eval', 'new-function', 'timeout-string'] },
  { id: 'cdn-path', csp: "script-src cdn.test/s/cdn.js 'self'", ran: ['self-src', 'cdn-src', 'ext-hash', 'dyn-self'] },
  { id: 'cdn-dir', csp: "script-src cdn.test/s/ 'nonce-r4nd0m'", ran: ['cdn-src', 'nonce-src', 'inline-nonce', 'dyn-cdn'] },
  { id: 'wrong-port', csp: "script-src cdn.test:8080 'self'", ran: ['self-src', 'ext-hash', 'dyn-self'] },
  { id: 'wildcard-host', csp: 'script-src *.test', ran: ['self-src', 'cdn-src', 'nonce-src', 'ext-hash', 'dyn-self', 'dyn-cdn'] },
  { id: 'self-sd', csp: "script-src 'self' 'strict-dynamic'", ran: ['dyn-self', 'dyn-cdn'] },
];

/** Политики, которые демо предлагает первыми. Остальные из `MATRIX` доступны там же списком. */
export const PRESETS: Preset[] = [
  { id: 'self-cdn', label: 'список доменов' },
  { id: 'self-inline', label: "'unsafe-inline'" },
  { id: 'nonce-inline', label: "nonce + 'unsafe-inline'" },
  { id: 'nonce-sd', label: "nonce + 'strict-dynamic'" },
  { id: 'self-sd', label: "'self' + 'strict-dynamic'" },
  { id: 'hash', label: 'хеш' },
  { id: 'unsafe-hashes', label: "'unsafe-hashes'" },
  { id: 'elem-only', label: 'только script-src-elem' },
  { id: 'two-policies', label: 'две политики' },
];

export const DEMO_CAPTION =
  'Решение в каждой строке считает функция `checkScript` выше, по тексту заголовка. Отметка Chromium — журнал настоящего браузера на той же странице под той же политикой; на всех 31 политиках стенда и всех 15 пробах они совпали. Поменяйте заголовок руками — функция ответит и на него, а журнала для своей политики уже не будет.';

export const PLAIN_FALLBACK =
  'Как правила в общежитии. На двери кухни висит своё правило — действует оно. Своего нет — смотрят правило этажа, нет и его — общее правило общежития. А если ничего не написано, на кухню можно всем: молчание CSP — это разрешение, а не запрет.';

/** Кто какую директиву спрашивает и куда идёт, если её нет. Сверено с журналом: `elem-only`, `attr-inline`, `elem-vs-src`. */
export const FALLBACK_ROWS: { k: string; own: string; chain: string; tone?: 'warn' }[] = [
  { k: '`<script src>` и `<script>` с текстом', own: '`script-src-elem`', chain: '→ `script-src` → `default-src`' },
  { k: '`onclick="…"` и другие атрибуты `on*`', own: '`script-src-attr`', chain: '→ `script-src` → `default-src`' },
  { k: 'переход по `javascript:`-ссылке', own: '`script-src-elem`', chain: '→ `script-src` → `default-src`. Не `-attr`, хотя ссылка — атрибут', tone: 'warn' },
  { k: '`eval`, `new Function`, `setTimeout` со строкой', own: '`script-src`', chain: '→ `default-src`. На `script-src-elem` и `-attr` не смотрит', tone: 'warn' },
];

export const CSP_CHECK_CODE = `// Заголовок → политики (через запятую) → директивы (через «;»).
// Повтор директивы в одной политике браузер пропускает — берём первую.
function parseCsp(header) {
  return header.split(',').map((text) => {
    const policy = new Map();
    for (const part of text.split(';')) {
      const [name, ...values] = part.trim().split(/\\s+/);
      if (name && !policy.has(name.toLowerCase())) policy.set(name.toLowerCase(), values);
    }
    return policy;
  });
}

// Какая директива решает: своя, а если её нет — следующая в цепочке.
const FALLBACK = {
  'script-src-elem': ['script-src-elem', 'script-src', 'default-src'],
  'script-src-attr': ['script-src-attr', 'script-src', 'default-src'],
  'script-src': ['script-src', 'default-src'],
};

const DEFAULT_PORT = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

// Совпадает ли адрес скрипта с одним источником из списка.
// Упрощено: нет перехода http → https для 'self' и нет редиректов.
function matchUrl(source, url, page) {
  if (source === "'self'") return url.origin === page.origin;
  if (source === '*') return url.protocol in DEFAULT_PORT;
  if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {           // схема: https:
    return url.protocol === source || (source === 'http:' && url.protocol === 'https:');
  }
  if (source.startsWith("'")) return false;              // nonce, хеш, ключевые слова
  const m = /^(?:([a-z][a-z0-9+.-]*):\\/\\/)?(\\*|(?:\\*\\.)?[^:/]+)(?::(\\d+|\\*))?(\\/.*)?$/i.exec(source);
  if (!m) return false;
  const [, scheme, host, port, path] = m;
  const proto = scheme ? scheme + ':' : page.protocol;   // без схемы — схема страницы
  if (url.protocol !== proto && !(proto === 'http:' && url.protocol === 'https:')) return false;
  const hostOk = host === '*' || (host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host);
  if (!hostOk) return false;
  const urlPort = url.port || DEFAULT_PORT[url.protocol];
  if (port !== '*' && urlPort !== (port ?? DEFAULT_PORT[url.protocol])) return false;
  if (!path) return true;
  return path.endsWith('/') ? url.pathname.startsWith(path) : url.pathname === path;
}

// Пропускает ли один список источников этот скрипт.
function allowsBy(list, req, page) {
  const has = (s) => list.includes(s);
  if (req.type === 'eval') return has("'unsafe-eval'");
  const nonceOk = Boolean(req.nonce) && has(\`'nonce-\${req.nonce}'\`);
  const hashOk = (h) => Boolean(h) && has(\`'sha256-\${h}'\`);
  const strict = has("'strict-dynamic'");
  // 'unsafe-inline' молча выключается, если рядом есть nonce, хеш или 'strict-dynamic'.
  const anyInline = has("'unsafe-inline'") && !strict &&
    !list.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));

  if (req.type === 'script') {                           // <script src>
    if (nonceOk || hashOk(req.integrity)) return true;
    if (strict) return !req.parser;                      // адреса и 'self' больше не смотрят
    return list.some((s) => matchUrl(s, new URL(req.url), page));
  }
  if (req.type === 'inline') return nonceOk || hashOk(req.hash) || anyInline;
  // onclick и javascript: — nonce повесить некуда, хеш считается только с 'unsafe-hashes'.
  return anyInline || (has("'unsafe-hashes'") && hashOk(req.hash));
}

function checkScript(header, req, pageUrl) {
  const page = new URL(pageUrl);
  const effective = req.type === 'handler' ? 'script-src-attr'
    : req.type === 'eval' ? 'script-src' : 'script-src-elem';
  let used = null;
  for (const policy of header ? parseCsp(header) : []) {
    const name = FALLBACK[effective].find((n) => policy.has(n));
    if (!name) continue;                                 // эта политика о скриптах молчит
    used ??= name;
    if (!allowsBy(policy.get(name), req, page)) return { allowed: false, effective, directive: name };
  }
  return { allowed: true, effective, directive: used };  // null — ни одна политика не спросила
}`;

export const CHECK_NOTE =
  'Две вещи из этой функции удивляют чаще всего. Первая — **несколько политик**: два заголовка `Content-Security-Policy` (или одна строка через запятую) — это две независимые проверки, и скрипт должен пройти обе. Под политикой «две политики» инлайн без nonce не выполнился, хотя в первой половине есть `\'unsafe-inline\'`. Вторая — **отказ называется своей директивой**: в отчёте и в событии стоит `script-src-elem`, даже если в заголовке написан только `script-src`. Chromium пишет об этом в консоли прямо: «`script-src-elem` was not explicitly set, so `script-src` is used as a fallback».';

// ─── Раздел 2. Nonce, хеш и 'strict-dynamic' ──────────────────────────────────────────────

export const ALLOWLIST_NOTE =
  'Почему список доменов почти всегда обходится, разобрано в [«Безопасности фронтенда»](/platform/security/#s3). Суть в одной фразе: «разрешить домен» значит разрешить **любой** файл на нём. Если на разрешённом CDN лежит старая библиотека, которая исполняет код из разметки, или адрес, который возвращает JavaScript с подставленным из запроса именем функции (JSONP), атакующему не нужен свой сервер — достаточно сослаться на ваш же разрешённый. Политика из матрицы `script-src \'self\' cdn.test` пропустила все три внешних скрипта с `cdn.test`, в том числе созданный кодом: она проверяет, **откуда** файл, а не **кто** его вставил.';

export const HASH_CODE = `import { createHash } from 'node:crypto';

// Хеш считают от текста между <script> и </script> — байт в байт.
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

sha("mark('inline-hash')");     // 'C2BmX+g+xWBNshtAcNBBlmIbqx9H6BKoCCpcQ/poytA='
sha("mark('inline-hash')\\n");   // другой хеш: перевод строки — тоже текст
sha(" mark('inline-hash')");    // и пробел в начале — тоже`;

export const HASH_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Браузер сам подсказывает хеш',
    d: 'Заблокировав инлайн-скрипт, Chromium пишет в консоль его хеш: «Either the `\'unsafe-inline\'` keyword, a hash (`\'sha256-dDidRDUGR+…\'`), or a nonce is required». Удобно для разового скрипта, опасно как привычка: так легко разрешить хешем и внедрённый код, если копировать из консоли не глядя.',
    tone: 'warn',
  },
  {
    t: 'Хеш подходит для статичного текста',
    d: 'Скрипт, в который сервер подставляет данные (`window.__STATE__ = {…}`), меняется от ответа к ответу — хеш у него каждый раз новый. Для него nonce. Хеш хорош для неизменных кусков: загрузчик темы, сниппет аналитики, страница, собранная заранее.',
  },
  {
    t: 'Внешний скрипт по хешу — только с `integrity`',
    d: 'Проба `<script src="/s/hashed.js" integrity="sha256-…">` прошла под политикой из одного хеша, без `\'self\'` и без адреса. Браузер сверил хеш атрибута `integrity` с политикой и проверил, что файл ему соответствует. Без `integrity` хеш к внешнему файлу не применяется.',
  },
  {
    t: 'Хеш действует только на `<script>`',
    d: 'Под `script-src \'self\' \'sha256-<хеш текста onclick>\'` обработчик не выполнился, хотя хеш верный. Chromium объясняет: «hashes do not apply to event handlers, style attributes and javascript: navigations unless the `\'unsafe-hashes\'` keyword is present».',
    tone: 'warn',
  },
];

export const CONSOLE_UNSAFE_INLINE =
  "Executing inline script violates the following Content Security Policy directive 'script-src 'nonce-r4nd0m' 'unsafe-inline''. Note that 'unsafe-inline' is ignored if either a hash or nonce value is present in the source list. The action has been blocked.";

export const CONSOLE_STRICT_DYNAMIC =
  `Loading the script 'http://site.test/s/self.js' violates the following Content Security Policy directive: "script-src 'self' 'strict-dynamic'". Note that 'strict-dynamic' is present, so host-based allowlisting is disabled. Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.`;

export const UNSAFE_INLINE_NOTE =
  '`\'unsafe-inline\'` рядом с nonce не ослабляет политику: браузер, который понимает nonce, его просто вычёркивает. Матрица это подтверждает — `script-src \'nonce-r4nd0m\'` и `script-src \'nonce-r4nd0m\' \'unsafe-inline\'` пропустили одно и то же. Зачем тогда писать? Для очень старого браузера, который nonce не знает: тот увидит `\'unsafe-inline\'` и не сломает страницу.';

export const STRICT_DYNAMIC_ROWS: { k: string; what: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`\'nonce-…\'`, `\'sha256-…\'`', what: 'работают как обычно: это вход доверия', tone: 'ok' },
  { k: 'скрипт, созданный кодом (`createElement`)', what: 'выполняется с **любого** адреса — `dyn-cdn` прошёл, хотя `cdn.test` в политике нет', tone: 'ok' },
  { k: '`\'self\'`, адреса, схемы (`https:`, `cdn.test`)', what: 'вычеркнуты. `\'self\' \'strict-dynamic\'` не пустил собственный `/s/self.js`', tone: 'err' },
  { k: '`\'unsafe-inline\'`', what: 'вычеркнут, как и рядом с nonce', tone: 'err' },
  { k: '`<script src>` прямо в HTML без nonce', what: 'не выполняется: его вставил парсер, а парсеру доверие не передаётся', tone: 'err' },
];

export const STRICT_DYNAMIC_NOTE =
  'Отсюда рецепт «строгой политики» — `script-src \'nonce-…\' \'strict-dynamic\' https: \'unsafe-inline\'`. Хвост `https: \'unsafe-inline\'` современный браузер не читает (политика `nonce-sd-fallback` в матрице дала ровно то же, что `nonce-sd`), а старый, не знающий `\'strict-dynamic\'`, хотя бы не сломает сайт. Ловушка — обратная сборка: `\'self\' \'strict-dynamic\'` без nonce. Выглядит как «свои скрипты плюс их чанки», а на деле не пускает ни одного своего `<script src>` в разметке.';

export const NONCE_SERVER_CODE = `// На каждый ответ — новый nonce: 16 случайных байт в base64.
// Метку {{nonce}} автор пишет в шаблоне руками, только у своих <script>.
function render(template) {
  const nonce = randomBytes(16).toString('base64');
  return {
    headers: {
      'Content-Security-Policy':
        \`script-src 'nonce-\${nonce}' 'strict-dynamic'; object-src 'none'; base-uri 'none'\`,
      'Cache-Control': 'no-store',
    },
    body: template.replaceAll('{{nonce}}', nonce),
  };
}`;

/** Шаблон для `NONCE_SERVER_CODE`: свой скрипт с меткой и «комментарий пользователя» без неё. */
export const NONCE_TEMPLATE = `<!doctype html><meta charset="utf-8">
<script nonce="{{nonce}}">mark('свой')</script>
<p>Комментарий: <script>mark('внедрённый')</script></p>`;

export const NONCE_SERVER_NOTE =
  'Метка в шаблоне, а не замена `<script` на `<script nonce=…>` по готовому HTML. Такая замена кажется удобной и раздаёт nonce всем подряд — в том числе тегу, который пришёл из комментария пользователя. На стенде этот шаблон дал выполниться только своему скрипту. `Cache-Control: no-store` нужен потому, что страница из общего кеша приходит всем с одним и тем же nonce.';

// ─── Раздел 3. Обработчики и javascript: ──────────────────────────────────────────────────

export const HANDLER_ROWS: { k: string; onclick: string; jsurl: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: "`script-src 'self'`", onclick: 'нет', jsurl: 'нет' },
  { k: "`script-src 'self' 'unsafe-inline'`", onclick: '**да**', jsurl: '**да**', tone: 'err' },
  { k: "`script-src 'nonce-r4nd0m'`", onclick: 'нет: nonce у атрибута некуда поставить', jsurl: 'нет' },
  { k: "`script-src 'self' 'sha256-<onclick>'`", onclick: 'нет: хеш без `\'unsafe-hashes\'` к атрибутам не применяется', jsurl: 'нет' },
  { k: "`script-src 'self' 'unsafe-hashes' 'sha256-<onclick>'`", onclick: 'только тот, чей текст совпал с хешем', jsurl: 'нет', tone: 'warn' },
  { k: "`script-src 'unsafe-hashes' 'sha256-<javascript:…>'`", onclick: 'нет', jsurl: 'да, если хеш от **всего** адреса вместе с `javascript:`', tone: 'warn' },
  { k: "`script-src 'self'; script-src-attr 'unsafe-inline'`", onclick: '**да**', jsurl: 'нет: ссылку проверяет `-elem`', tone: 'warn' },
  { k: "`script-src-elem 'self'`", onclick: '**да**: для атрибутов политики нет вовсе', jsurl: 'нет', tone: 'err' },
];

export const HANDLER_NOTE =
  'Проверка обработчика срабатывает не при загрузке страницы, а когда браузер впервые собирает код атрибута — обычно при первом событии. Поэтому сломанные `onclick` под новой политикой не видны на открытой странице: всё нарисовано, кнопка на месте, и только нажатие пишет ошибку в консоль. Тесты, которые лишь открывают страницу, такую поломку не ловят.';

export const UNSAFE_HASHES_NOTE =
  '`\'unsafe-hashes\'` — временная мера для старой разметки, которую нельзя переписать сразу. Хеш привязан к точному тексту атрибута: `onclick="save()"` и `onclick="save( )"` — разные хеши. Для `javascript:`-ссылки хеш считают от всего адреса: на стенде хеш одного `mark(\'js-url\')` не сработал, хеш `javascript:mark(\'js-url\')` — сработал.';

export const REFACTOR_BEFORE = `<!-- до: обработчик в атрибуте — под nonce-политикой не сработает -->
<button onclick="save()">Сохранить</button>`;

/** «После»: тот же обработчик из своего скрипта. Тест открывает его под nonce-политикой и нажимает кнопку. */
export const REFACTOR_AFTER = `<!-- после: разметка без кода, обработчик вешает свой скрипт -->
<button data-action="save">Сохранить</button>
<script nonce="r4nd0m">
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="save"]')) mark('save');
  });
</script>`;

// ─── Раздел 4. Отчёты и поэтапное внедрение ──────────────────────────────────────────────

export const REPORT_HEADERS_CODE = `# Старый способ: отчёт сразу уходит POST-запросом на адрес
Content-Security-Policy-Report-Only: script-src 'nonce-r4nd0m' 'report-sample';
  report-uri /csp-uri

# Новый способ: имя группы в политике, адрес — в отдельном заголовке
Content-Security-Policy-Report-Only: script-src 'nonce-r4nd0m' 'report-sample';
  report-to csp
Reporting-Endpoints: csp="https://site.test/csp-to"`;

/** Страница для отчётов: свой скрипт с nonce, инлайн без него, чужой скрипт с токеном в адресе, обработчик. */
export const REPORT_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script nonce="r4nd0m">window.ok = 1</script>
<script>console.log('inline ran')</script>
<script src="http://cdn.test/s/cdn.js?token=SECRET123"></script>
<button id="b" onclick="console.log('onclick ran')">b</button>
</body></html>`;

/** Тело POST от `report-uri` для инлайн-скрипта, как его принял сервер (`Content-Type: application/csp-report`). */
export const REPORT_URI_BODY = `{
  "csp-report": {
    "document-uri": "http://site.test/r/uri",
    "referrer": "",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "script-src 'nonce-r4nd0m' 'report-sample'; report-uri /csp-uri",
    "disposition": "report",
    "blocked-uri": "inline",
    "line-number": 3,
    "source-file": "http://site.test/r/uri",
    "status-code": 200,
    "script-sample": "console.log('inline ran')"
  }
}`;

/** Тело отчёта `report-to` о том же инлайне — из `ReportingObserver` и CDP (совпали). */
export const REPORT_TO_BODY = `{
  "type": "csp-violation",
  "url": "http://site.test/r/to",
  "body": {
    "sourceFile": "http://site.test/r/to",
    "lineNumber": 3,
    "columnNumber": 0,
    "documentURL": "http://site.test/r/to",
    "referrer": "",
    "blockedURL": "inline",
    "effectiveDirective": "script-src-elem",
    "originalPolicy": "script-src 'nonce-r4nd0m' 'report-sample'; report-to csp",
    "sample": "console.log('inline ran')",
    "disposition": "report",
    "statusCode": 200
  }
}`;

export const REPORT_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Два формата с разными именами полей',
    d: '`report-uri` шлёт по POST-запросу на каждое нарушение, поля через дефис (`blocked-uri`, `script-sample`). `report-to` кладёт отчёт в очередь браузера, поля в верблюжьем стиле (`blockedURL`, `sample`), и по спецификации приходит массивом с `Content-Type: application/reports+json`. Сборщик отчётов должен понимать оба.',
  },
  {
    t: 'Есть `report-to` — `report-uri` молчит',
    d: 'Политика с обеими директивами в Chromium не прислала на адрес `report-uri` ни одного запроса. Пишут обе ради браузеров, которые `report-to` не знают; но проверять сборщик по `report-uri` в Chromium бесполезно.',
    tone: 'warn',
  },
  {
    t: '`\'report-sample\'` — первые 40 символов кода',
    d: 'Без этого слова поле `script-sample` пустое. С ним в отчёт попадает начало заблокированного инлайн-скрипта или обработчика. Для внешнего скрипта образца нет: файл не загружен. По образцу видно, что именно сломалось — ваш сниппет или чужая вставка.',
  },
  {
    t: 'Адрес чужого скрипта приходит целиком',
    d: 'Скрипт `http://cdn.test/s/cdn.js?token=SECRET123` попал в отчёт с токеном в строке запроса — и в `report-uri`, и в `report-to`. Урезание до origin спецификация делает только после редиректа на чужой источник. Хранилище отчётов — такое же место утечки, как логи: строку запроса там стоит вырезать.',
    tone: 'err',
  },
  {
    t: 'Событие на самой странице',
    d: 'Кроме отчёта на сервер, браузер бросает в документ событие `securitypolicyviolation` с теми же полями. Его слышит код страницы — удобно в разработке и в e2e-тестах: отказ становится ошибкой теста, а не строкой в консоли.',
  },
];

export const VIOLATION_LISTENER_CODE = `document.addEventListener('securitypolicyviolation', (e) => {
  console.log(e.disposition, e.effectiveDirective, e.blockedURI, e.sample);
});
// report  script-src-elem  inline  console.log('inline ran')
// report  script-src-elem  http://cdn.test/s/cdn.js?token=SECRET123
// report  script-src-attr  inline  console.log('onclick ran')`;

export const TWO_HEADERS_CODE = `# Применяется: то, что сайт уже выдерживает
Content-Security-Policy: script-src 'nonce-r4nd0m' 'unsafe-inline' http://cdn.test

# Только отчитывается: следующий шаг
Content-Security-Policy-Report-Only: script-src 'nonce-r4nd0m' 'strict-dynamic';
  report-uri /csp-ro2`;

export const TWO_HEADERS_NOTE =
  'Обе политики проверяются независимо, и консоль это различает: отказ применённой — `[error]` и «The action has been blocked», отказ report-only — `[info]` и «The policy is report-only, so the violation has been logged but no further action has been taken». Чужой скрипт с `cdn.test` здесь выполнился (первая политика его пускает), а отчёт о нём пришёл от второй: так видно, что сломается на следующем шаге.';

export const ROLLOUT_STEPS = [
  '**Опись.** Включить целевую политику в `Content-Security-Policy-Report-Only` с `\'report-sample\'` и отчётами. Ничего не ломается, а через неделю у вас список всех инлайн-скриптов, обработчиков и чужих доменов, о которых никто не помнил.',
  '**Фильтр шума.** Отбросить отчёты, где `sourceFile` или `blockedURL` начинается с `chrome-extension:`, `moz-extension:`, `safari-web-extension:` — это расширения пользователей, а не ваш сайт. Отделить по `sample` свои сниппеты от чужих вставок.',
  '**Починка.** Обработчики из атрибутов — в `addEventListener`. Свои `<script>` в шаблоне — с меткой nonce. Загрузку чанков — через код (её пропустит `\'strict-dynamic\'`). `eval` в зависимостях — заменить библиотеку или осознанно оставить `\'unsafe-eval\'`.',
  '**Включение.** Перенести политику в `Content-Security-Policy`, оставив рядом report-only со следующим ужесточением. Отчёты о применённой политике теперь значат «у кого-то не работает кнопка», и на них нужен сигнал, а не только график.',
  '**Trusted Types.** Тем же путём: `require-trusted-types-for \'script\'` сначала в report-only. Список нарушений — это опись мест, где код пишет строку в DOM.',
];

// ─── Раздел 5. Заголовок или <meta> ───────────────────────────────────────────────────────

export const META_PAGE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<script>window.before = 'выполнился'</script>
<meta http-equiv="Content-Security-Policy"
      content="script-src 'nonce-r4nd0m'; frame-ancestors 'none'; report-uri /meta-report; sandbox">
<script>window.after = 'выполнился'</script>
</head><body>
<script nonce="r4nd0m">window.nonced = 'выполнился'</script>
</body></html>`;

export const META_ROWS: { k: string; what: string; console: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'скрипт **до** `<meta>`', what: '**выполнился**: политика действует с того места, где браузер её прочитал', console: '—', tone: 'err' },
  { k: 'скрипт после `<meta>` без nonce', what: 'заблокирован, nonce-скрипт в `<body>` выполнился', console: 'обычная ошибка CSP', tone: 'ok' },
  { k: '`frame-ancestors`', what: 'не действует: страницу встроили с чужого origin', console: "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.", tone: 'err' },
  { k: '`report-uri`', what: 'не действует: ни одного отчёта', console: "The Content Security Policy directive 'report-uri' is ignored when delivered via a <meta> element.", tone: 'err' },
  { k: '`sandbox`', what: 'не действует', console: "The Content Security Policy directive 'sandbox' is ignored when delivered via a <meta> element.", tone: 'err' },
  { k: '`<meta>` с `Content-Security-Policy-Report-Only`', what: 'вся политика выброшена', console: "The report-only Content Security Policy 'script-src 'none'' was delivered via a <meta> element, which is disallowed. The policy has been ignored.", tone: 'err' },
  { k: '`<meta>` в `<body>`', what: 'вся политика выброшена, скрипт после неё выполнился', console: "The Content Security Policy 'script-src 'none'' was delivered via a <meta> element outside the document's <head>, which is disallowed. The policy has been ignored.", tone: 'err' },
];

export const META_NOTE =
  '`<meta>` — запасной путь для хостинга, где заголовки не настроить: из `script-src` и соседей он годится. Отчётов, `frame-ancestors` и режима report-only в нём нет, а значит, нет и безопасного поэтапного внедрения: включать придётся сразу и вслепую. Поставить `<meta>` нужно первым элементом `<head>` — всё, что выше, уже выполнилось. Где заголовки есть, их ставит сервер или прокси; у nginx своя `add_header` в `location` отменяет все `add_header` уровнем выше, и CSP пропадает молча — тот же механизм, что у `proxy_set_header`, разобран в [«nginx перед приложением»](/delivery/nginx-proxy/#s4). На хостинге без заголовков вроде GitHub Pages остаётся только `<meta>` — см. [«GitHub Pages», раздел «Ограничения»](/delivery/github-pages/#s6).';

export const FRAME_NOTE =
  'Проверено встраиванием: страница с `frame-ancestors \'none\'` в заголовке в чужом `<iframe>` не открылась, Chromium написал «Framing … violates the following Content Security Policy directive: "frame-ancestors \'none\'"». Та же директива в `<meta>` — страница открылась, внутри фрейма виден её текст.';

// ─── Раздел 6. Trusted Types ──────────────────────────────────────────────────────────────

export const PLAIN_TT =
  'Как вход в серверную по пропуску. Раньше охранник проверял каждого посетителя на вид — и рано или поздно пропускал не того. Теперь в серверную пускают только с пропуском, а выдаёт пропуска одно бюро. Проверять надо не тысячу дверей, а одно бюро: Trusted Types — это пропуск, политика — бюро.';

export const TT_HEADER_CODE = `Content-Security-Policy: require-trusted-types-for 'script'; trusted-types app`;

/** Пробы мест вставки под `require-trusted-types-for 'script'`; `type` — что требует браузер, `sample` — образец в отчёте. */
export const SINK_ROWS: { k: string; type: string; sample: string }[] = [
  { k: '`el.innerHTML = …`', type: 'TrustedHTML', sample: 'Element innerHTML|<b>x</b>' },
  { k: '`el.outerHTML = …`', type: 'TrustedHTML', sample: 'Element outerHTML|<b>y</b>' },
  { k: '`el.insertAdjacentHTML(…)`', type: 'TrustedHTML', sample: 'Element insertAdjacentHTML|<b>z</b>' },
  { k: '`iframe.srcdoc = …`', type: 'TrustedHTML', sample: 'HTMLIFrameElement srcdoc|<b>x</b>' },
  { k: '`new DOMParser().parseFromString(…)`', type: 'TrustedHTML', sample: 'DOMParser parseFromString|<b>x</b>' },
  { k: '`range.createContextualFragment(…)`', type: 'TrustedHTML', sample: 'Range createContextualFragment|<b>x</b>' },
  { k: '`el.setHTMLUnsafe(…)`', type: 'TrustedHTML', sample: 'Element setHTMLUnsafe|<b>x</b>' },
  { k: '`script.src = …`', type: 'TrustedScriptURL', sample: 'HTMLScriptElement src|/s/dyn.js' },
  { k: '`script.text`, `script.textContent`', type: 'TrustedScript', sample: 'HTMLScriptElement text|1' },
  { k: "`el.setAttribute('onclick', …)`", type: 'TrustedScript', sample: 'Element onclick|f()' },
  { k: '`setTimeout(строка)`', type: 'TrustedScript', sample: 'Window setTimeout|void 0' },
  { k: '`eval`, `new Function`', type: 'TrustedScript', sample: 'eval|1+1' },
];

/** Что под той же политикой прошло без всяких типов. */
export const SINK_FREE = ['el.setHTML(…)', 'div.textContent = …', 'img.src = …', "a.href = 'javascript:…'"];

export const SINK_NOTE =
  'Под `require-trusted-types-for \'script\'` голая строка в любом из этих мест — исключение `TypeError` («This document requires \'TrustedHTML\' assignment»), а у `eval` и `new Function` — `EvalError`. Без исключений прошли `setHTML` (он сам вычищает опасное), `textContent` у обычного элемента, `img.src` и даже присваивание `javascript:`-адреса ссылке: его остановит обычный CSP при переходе, а не Trusted Types. Образец в отчёте устроен как «где|что»: имя места вставки, черта и начало строки — по нему сразу видно, какая строка кода сломалась.';

export const TT_POLICY_CODE = `// Одна политика на приложение: всё, что идёт в innerHTML, проходит через неё.
const escapeHtml = trustedTypes.createPolicy('app', {
  createHTML: (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;'),
});

const box = document.createElement('div');
box.innerHTML = escapeHtml.createHTML('<img src=x onerror=alert(1)>');
console.log(box.innerHTML);        // &lt;img src=x onerror=alert(1)&gt;
box.innerHTML = '<b>строка</b>';    // TypeError: … requires 'TrustedHTML' assignment.`;

export const TT_NAMES_ROWS: { k: string; what: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'нет директивы `trusted-types`', what: 'создать можно политику с **любым** именем, и сколько угодно раз', tone: 'warn' },
  { k: '`trusted-types app`', what: "`createPolicy('other')` — `TypeError: … Policy \"other\" disallowed.`; второй `createPolicy('app')` — `Policy with name \"app\" already exists.`", tone: 'ok' },
  { k: "`trusted-types app other 'allow-duplicates'`", what: 'обе политики и повтор имени — без ошибок' },
  { k: "`trusted-types 'none'`", what: 'ни одной политики создать нельзя', tone: 'err' },
];

export const TT_NAMES_NOTE =
  'Список имён — то, что делает Trusted Types проверяемыми. Без него любой код на странице, в том числе зависимость, может создать политику-пустышку `createHTML: (s) => s` и превратить ею что угодно в `TrustedHTML`. Со списком «объявить источники доверия» значит буквально прочитать N функций с этими именами — и в CI можно проверять, что новых имён не появилось.';

export const DEFAULT_POLICY_CODE = `// default — запасная политика: браузер зовёт её сам,
// когда в опасное место пришла голая строка.
trustedTypes.createPolicy('default', {
  createHTML(value, type, sink) {
    console.log(\`\${sink}: \${value}\`);
    return value.includes('onerror') ? null : value;   // null — отказ
  },
});

const box = document.createElement('div');
box.innerHTML = '<b>можно</b>';
box.insertAdjacentHTML('beforeend', '<i>и так</i>');
box.innerHTML = '<img src=x onerror=alert(1)>';`;

/** Что напечатала консоль на `DEFAULT_POLICY_CODE` (последняя строка — необработанное исключение). */
export const DEFAULT_POLICY_LOG = `Element innerHTML: <b>можно</b>
Element insertAdjacentHTML: <i>и так</i>
Element innerHTML: <img src=x onerror=alert(1)>
TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment and the 'default' policy failed to execute.`;

export const DEFAULT_POLICY_NOTE =
  'Политика с именем `default` — мост для кода, который вы не можете переписать: старые библиотеки, виджеты партнёров. Третьим аргументом браузер передаёт место вставки (`Element innerHTML`, `HTMLScriptElement src`, `eval`), так что в ней видно, кто и куда пишет. Но это дыра по замыслу: если `default` возвращает строку как есть, Trusted Types больше ничего не перекрывают. Её делают узкой — санитайзер или отказ — и логируют каждый вызов, чтобы со временем убрать.';

// ─── Раздел 7. Фреймворки ─────────────────────────────────────────────────────────────────

/** Кусок `@vue/runtime-dom` 3.5.42 (esm-bundler), дословно. Тест ищет его в установленном пакете. */
export const VUE_SOURCE = `const tt = typeof window !== "undefined" && window.trustedTypes;
if (tt) {
  try {
    policy = /* @__PURE__ */ tt.createPolicy("vue", {
      createHTML: (val) => val
    });
  } catch (e) {`;

export const VUE_SOURCE_LINE = `el[key] = key === "innerHTML" ? unsafeToTrustedHTML(value) : value;`;

export const FW_HEADERS = {
  none: null,
  any: "require-trusted-types-for 'script'",
  app: "require-trusted-types-for 'script'; trusted-types app",
  vue: "require-trusted-types-for 'script'; trusted-types app vue",
} as const;

/** Что вышло на стенде: `ok` — разметка вставлена, иначе — что бросил браузер. */
export const FW_ROWS: { k: string; none: string; any: string; app: string; vue: string }[] = [
  { k: 'Vue: `v-html` со строкой', none: 'вставлено', any: '**вставлено**', app: 'TypeError', vue: '**вставлено**' },
  { k: 'Vue: `v-html` с `TrustedHTML` своей политики', none: '—', any: '—', app: 'вставлено', vue: '—' },
  { k: 'Vue: шаблон с большой статикой', none: 'вставлено', any: 'вставлено', app: '**TypeError**', vue: 'вставлено' },
  { k: 'React 19: `dangerouslySetInnerHTML` со строкой', none: 'вставлено', any: 'TypeError', app: 'TypeError', vue: 'TypeError' },
  { k: 'React 19: `dangerouslySetInnerHTML` с `TrustedHTML`', none: 'вставлено', any: 'вставлено', app: 'вставлено', vue: 'вставлено' },
];

export const VUE_NOTE =
  'Vue при загрузке создаёт свою политику `vue`, которая ничего не проверяет, и пропускает через неё **и** статические куски шаблонов, **и** `v-html`. Отсюда неожиданность: включили `require-trusted-types-for` без списка имён — `v-html` с пользовательской строкой молча работает, Trusted Types его не видят. Запретите имя `vue` списком — `v-html` начнёт требовать `TrustedHTML` (и примет его из вашей политики), но сломаются шаблоны с большой статикой: компилятор склеивает длинные неизменные куски в одну строку HTML и вставляет её через `innerHTML`. На стенде шаблон из 25 статических `<li>` под `trusted-types app` упал с `TypeError`.';

export const VUE_CHOICE =
  'Практический выбор для Vue — `trusted-types app vue`: шаблоны работают, а `v-html` остаётся вне Trusted Types, и его сторожат по-старому — правилом линтера `vue/no-v-html` и ревью. Trusted Types при этом закрывают ваш собственный код и зависимости: `innerHTML`, `insertAdjacentHTML`, `script.src`, `eval`.';

export const REACT_TT_CODE = `const policy = trustedTypes.createPolicy('app', {
  createHTML: (s) => sanitize(s),        // ваш санитайзер, например DOMPurify
});

function Comment({ html }) {
  // Строка здесь — TypeError, TrustedHTML — проходит
  return <div className="comment" dangerouslySetInnerHTML={{ __html: policy.createHTML(html) }} />;
}`;

export const REACT_NOTE =
  'React 19 своей политики не создаёт и значение `__html` передаёт в `innerHTML` как есть. Поэтому строка в `dangerouslySetInnerHTML` под Trusted Types — `TypeError` при монтировании, а `TrustedHTML` из вашей политики проходит. Для React Trusted Types работают ровно так, как задумано: каждое место с `dangerouslySetInnerHTML` обязано пройти через политику.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: "`'self' 'strict-dynamic'` не пускает ваши же скрипты",
    d: 'С `\'strict-dynamic\'` адреса и `\'self\'` вычеркиваются. Без nonce или хеша в политике не остаётся ни одного входа доверия, и `<script src="/app.js">` в разметке заблокирован. Chromium пишет: «`\'strict-dynamic\'` is present, so host-based allowlisting is disabled».',
    tone: 'err',
  },
  {
    n: '02',
    t: "`'unsafe-inline'` рядом с nonce ничего не разрешает",
    d: 'Браузер, понимающий nonce или хеш, вычёркивает `\'unsafe-inline\'` — инлайн без nonce заблокирован. Если вы добавили его «чтобы заработало» и не заработало — причина в этом.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Сломанный `onclick` виден только по нажатию',
    d: 'Обработчик в атрибуте проверяется, когда браузер собирает его код, — при первом событии. Страница под новой политикой выглядит целой, тесты «открыть и сделать скриншот» зелёные.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`script-src-elem` без `script-src` оставляет атрибуты открытыми',
    d: 'Политика `script-src-elem \'self\'` пропустила оба `onclick` и `eval`: у атрибутов и строк-кода своей директивы нет, запасной `script-src` не написан, а молчание CSP — разрешение.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`javascript:`-ссылку проверяет `script-src-elem`',
    d: 'Хотя `href` — атрибут, переход по `javascript:` относится к `-elem`. `script-src-attr \'unsafe-inline\'` откроет `onclick`, но не ссылки; хеш для `\'unsafe-hashes\'` считают от всего адреса вместе с `javascript:`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Хеш ломается от пробела',
    d: 'Хеш считается от текста между тегами байт в байт. Форматировщик HTML, добавивший перевод строки, или минификатор, убравший пробел, молча делают хеш неверным.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`<meta>` не умеет отчётов и `frame-ancestors`',
    d: 'Обе директивы в `<meta>` игнорируются с сообщением в консоли, а report-only в `<meta>` выбрасывается целиком. Скрипты выше `<meta>` выполняются без проверки.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Отчёт уносит полный адрес чужого скрипта',
    d: 'Строка запроса вместе с токеном попала в `blocked-uri` и `blockedURL`. Сборщик отчётов — место, где оседают чужие URL, и его чистят как логи.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'С `report-to` Chromium не шлёт `report-uri`',
    d: 'Обе директивы пишут ради старых браузеров, но в Chromium при наличии `report-to` запросов на `report-uri` нет. Проверяя сборщик в Chromium, проверяйте приём формата Reporting API.',
  },
  {
    n: '10',
    t: 'Vue обходит Trusted Types через свою политику',
    d: 'Без списка `trusted-types` или с `vue` в нём `v-html` со строкой работает молча. Без `vue` в списке ломаются шаблоны с большой статикой. Для Vue `v-html` сторожат линтером, а не Trusted Types.',
    tone: 'err',
  },
  {
    n: '11',
    t: 'Без списка имён Trusted Types можно обойти политикой-пустышкой',
    d: 'Если директивы `trusted-types` нет, любой код создаёт политику `createHTML: (s) => s` и превращает строку в `TrustedHTML`. Список имён — обязательная часть внедрения, а не украшение.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Content Security Policy Level 3',
    href: 'https://www.w3.org/TR/CSP3/',
    what: 'цепочка директив, `\'strict-dynamic\'`, `\'unsafe-hashes\'`, хеши внешних скриптов, `<meta>`, формат отчёта и `securitypolicyviolation`',
  },
  {
    title: 'W3C — Trusted Types',
    href: 'https://www.w3.org/TR/trusted-types/',
    what: '`require-trusted-types-for`, `trusted-types`, места вставки, политика `default`',
  },
  {
    title: 'W3C — Reporting API',
    href: 'https://www.w3.org/TR/reporting-1/',
    what: '`Reporting-Endpoints`, формат `application/reports+json`, `ReportingObserver`',
  },
  {
    title: 'web.dev — Mitigate cross-site scripting (XSS) with a strict Content Security Policy',
    href: 'https://web.dev/articles/strict-csp',
    what: 'рецепт `\'nonce-…\' \'strict-dynamic\' https: \'unsafe-inline\'` и порядок внедрения',
  },
  {
    title: 'Vue — Security',
    href: 'https://vuejs.org/guide/best-practices/security',
    what: '`v-html` и рекомендации по пользовательскому HTML; поведение политики `vue` — из исходника `@vue/runtime-dom` 3.5.42',
  },
  {
    title: 'MDN — Trusted Types API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Trusted_Types_API',
    what: 'обзор API и список мест вставки',
  },
];

export const RELATED =
  'Смежное на сайте: [Безопасность фронтенда, раздел «CSP»](/platform/security/#s3) — зачем CSP, почему список доменов обходится, три политики на одной странице. [Безопасность фронтенда, раздел «XSS»](/platform/security/#s4) — откуда берётся DOM-XSS и санитайзеры. [Расширения браузера, раздел «Фон и CSP»](/render/browser-extensions/#s4) — CSP самого расширения и почему CSP страницы не останавливает контент-скрипт. [nginx перед приложением, раздел «Заголовки к бэкенду»](/delivery/nginx-proxy/#s4) — наследование `add_header`. [XS-Leaks, раздел «CORP, COOP, frame-ancestors»](/platform/xs-leaks/#s5) — `frame-ancestors` против утечек через встраивание. [Цепочка поставок](/platform/supply-chain/) — скрипты установки, `integrity` в lock-файле, SRI в браузере и путаница зависимостей.';
