import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FontChoice } from '@/widgets/responsive-lab/model/types';

/**
 * Данные темы «Адаптивность изнутри: медиазапросы, container queries, единицы вьюпорта».
 *
 * Тема написана 2026-10-02.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium 153.0.8010.12 (Playwright 1.63, headless), Node 24, macOS, октябрь 2026. Скрипты —
 * в каталоге агента в scratchpad; всё, что ниже помечено «снято», снимается заново
 * `tests/unit/responsive.test.ts`.
 *
 * Как снято:
 *   — вьюпорт телефона: контекст Playwright `devices['Pixel 7']` (412×839, DPR 2.625,
 *     `isMobile: true`, `hasTouch: true`), страница через `setContent` с разными `<meta viewport>`;
 *     читаются `innerWidth`, `documentElement.clientWidth`, `visualViewport.{width,height,scale}`
 *     и `matchMedia('(width: …)')`. Без `isMobile` мета-тег не действует (412 при любом meta);
 *   — щипок: CDP `Emulation.setPageScaleFactor` (2) и `Input.synthesizePinchGesture` (2.5, touch);
 *   — полоса прокрутки: в headless на macOS полоса — наложение шириной 0, и Playwright запускает
 *     Chromium с `--hide-scrollbars`. Для замера флаг снят (`ignoreDefaultArgs`), а полоса задана
 *     `::-webkit-scrollbar { width: 12px }` — тот же приём, что в «Прокрутке»;
 *   — шрифт браузера: CDP `Page.setFontSizes({ fontSizes: { standard: 20 } })` — то же, что
 *     настройка «Размер шрифта» в браузере;
 *   — prefers-*: `page.emulateMedia` (`colorScheme`, `reducedMotion`, `contrast`, `forcedColors`),
 *     `prefers-reduced-transparency` — CDP `Emulation.setEmulatedMedia`;
 *   — масштаб страницы (Ctrl +) **эмулирован**, а не нажат: в headless нет интерфейса браузера.
 *     Масштаб Z на окне 1280 физических пикселей — это окно 1280/Z CSS-пикселей и
 *     `devicePixelRatio` Z: ровно так масштаб устроен в Chromium (меняется DPR и CSS-ширина окна).
 *     «Физический размер» шрифта = вычисленный `font-size` × `devicePixelRatio`;
 *   — контейнеры: `getBoundingClientRect` и `getComputedStyle` на разметке из `SHRINK_ROWS`,
 *     `CQ_FACTS`, `STYLE_ROWS`;
 *   — учебная функция `RESOLVE_CODE` сверена с Chromium: карточка `CARD_CSS` на сетке ширин окна
 *     и контейнера при шрифте браузера 16/20/24 плюс случайные наборы правил (`@media`
 *     и `@container` с px/em/rem, диапазонами, `and`/`or`/`not`, именами контейнеров; значения
 *     с `clamp`/`min`/`max`/`calc` и единицами px/em/rem/vw/vh/vmin/vmax/cqi/cqw/cqb/cqmin):
 *     `setViewportSize` по 17 ширинам × 2 высоты, `getComputedStyle` — расхождение не больше
 *     0.02px. Проверка различает ошибки: если в модели считать em в `@media` от `html`,
 *     em в `@container` — от `html`, или взять для `cqi` дальний контейнер вместо ближнего,
 *     расходятся сотни значений.
 *
 * Не снято, взято из спецификаций и документации (в тексте сказано, откуда):
 *   — разница `svh`/`lvh`/`dvh`. Эмуляция устройства в Chromium (и в DevTools тоже) не рисует
 *     выезжающую адресную строку: на Pixel 7 все три дают 839px, и после прокрутки тоже.
 *     Что `vh` равен большому вьюпорту, а `dvh` меняется при прокрутке, — CSS Values 4, §6.1.2.1;
 *   — экранная клавиатура: в Chrome на Android с версии 108 она уменьшает только visual
 *     viewport (блог Chrome «viewport-resize-behavior»), `interactive-widget` в meta меняет это.
 *     Клавиатуру эмуляция не показывает;
 *   — разрыв `max-width: 639px` / `min-width: 640px` при дробной ширине — пример из Media
 *     Queries 4 (§2.4.3); дробную ширину окна в Playwright не задать (iframe 639.5px Chromium
 *     округлил до 640);
 *   — по спецификации (CSS Values 4, §6.1.2.1) при `overflow: scroll` или `scrollbar-gutter:
 *     stable` на корне `vw` должен уменьшаться на полосу. Chromium 153 этого **не делает** —
 *     снято: `100vw` = 800 при окне 800 и полосе 12px во всех трёх вариантах.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'вьюпорт (viewport)',
    d: 'Прямоугольник, через который видно страницу. Его ширину в CSS-пикселях браузер подставляет в `100vw` и сравнивает с `@media (width …)`.',
  },
  {
    k: 'layout viewport',
    d: 'Вьюпорт, по которому раскладывается страница: от него считаются `vw`, медиазапросы и `position: fixed`. Щипок его не меняет.',
  },
  {
    k: 'visual viewport',
    d: 'Часть страницы, видимая прямо сейчас. При щипке и при открытой клавиатуре она меньше layout viewport. Из JS — `window.visualViewport`.',
  },
  {
    k: 'CSS-пиксель и DPR',
    d: 'CSS-пиксель — единица вёрстки, физический пиксель — точка экрана. `devicePixelRatio` (DPR) — сколько физических в одном CSS-пикселе: 2.625 на Pixel 7.',
  },
  {
    k: 'медиазапрос',
    d: 'Условие `@media (…)` про окно и устройство: ширина, высота, тип указателя, тема. Правила внутри попадают в каскад, только пока условие верно.',
  },
  {
    k: 'контейнерный запрос',
    d: 'Условие `@container (…)` про размер ближайшего предка-контейнера, а не окна. Нужен, чтобы компонент подстраивался под место, куда его поставили.',
  },
  {
    k: 'изоляция размера (size containment)',
    d: 'Обещание «мой размер не зависит от детей». Браузер считает размер такого элемента так, будто внутри пусто.',
  },
  {
    k: 'начальный шрифт',
    d: 'Размер шрифта из настроек браузера, обычно 16px. От него, а не от `html`, считаются `em` и `rem` в медиазапросах.',
  },
];

export const PLAIN_RESPONSIVE =
  'Как портной и манекены. Медиазапрос спрашивает рост заказчика — ширину окна — и шьёт по нему весь костюм. Контейнерный запрос спрашивает размер конкретного кармана: одну и ту же пуговицу пришивают по-разному в нагрудный и в боковой карман, и рост заказчика тут ни при чём.';

export const PREREQ_NOTE =
  'Тема опирается на каскад, на то, как раскладка спрашивает размеры у содержимого, и на свойство `contain`. Всё это разобрано отдельно.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Каскад: кто побеждает при споре',
    d: 'Когда два правила задают одно свойство одному элементу, решают происхождение, слои, специфичность и порядок. Обёртки `@media` и `@container` специфичности не добавляют: из двух подошедших правил побеждает то, что ниже в файле.',
    href: '/render/css-cascade/#s1',
    hrefLabel: '«Каскад и вычисление стилей», раздел «Шесть критериев»',
    tone: 'info',
  },
  {
    t: 'min-content и max-content',
    d: 'Ширина «по содержимому»: самая узкая без вылезания и самая широкая без переносов. Ей пользуются `inline-block`, `float`, флекс-элемент и колонка грида `auto` — и именно её отнимает контейнерный запрос.',
    href: '/render/layout-internals/#s1',
    hrefLabel: '«Раскладка изнутри», раздел «Размеры содержимого»',
    tone: 'info',
  },
  {
    t: 'Свойство `contain`',
    d: 'Обещание браузеру, что пересчёт внутри элемента не выйдет наружу. `contain: size` — «размер не зависит от детей»; без явного размера элемент схлопывается.',
    href: '/render/render-pipeline/#s3',
    hrefLabel: '«Кадр браузера», раздел «Чтение и запись»',
    tone: 'info',
  },
  {
    t: 'Полоса прокрутки занимает место',
    d: 'Классическая полоса (Windows, Linux) отнимает ширину у содержимого, наложение (macOS по умолчанию) — нет. `scrollbar-gutter` резервирует место заранее.',
    href: '/render/scrolling/#s7',
    hrefLabel: '«Прокрутка изнутри», раздел «Полоса»',
    tone: 'info',
  },
];

// ─── Раздел 1. Вьюпорт ─────────────────────────────────────────────────────────────────────

export const PLAIN_VIEWPORTS =
  'Как газета и лупа. Газету сверстали на листе определённой ширины — это layout viewport: колонки, заголовки и всё «во всю ширину» считаются от него. Вы смотрите на лист через лупу — это visual viewport. Двигаете лупу или подносите ближе — видите меньше, но газета от этого не переверстается.';

export const META_CODE = `<!-- без этой строки телефон верстает страницу на 980px и уменьшает -->
<meta name="viewport" content="width=device-width, initial-scale=1">`;

/** Pixel 7 в эмуляции Chromium 153 (412×839, DPR 2.625, `isMobile`). Снято, см. шапку. */
export const META_ROWS: { k: string; layout: string; scale: string; note: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'meta нет', layout: '980', scale: '0.42', note: '`(width: 980px)` верно, `(width: 412px)` — нет. Текст 16px на экране — около 6.7px', tone: 'err' },
  { k: '`width=device-width, initial-scale=1`', layout: '412', scale: '1', note: 'ширина вёрстки = ширина экрана в CSS-пикселях', tone: 'ok' },
  { k: '`width=device-width`', layout: '412', scale: '1', note: 'то же самое', tone: 'ok' },
  { k: '`initial-scale=1`', layout: '412', scale: '1', note: 'масштаб 1 сам по себе даёт ширину экрана' },
  { k: '`width=600`', layout: '600', scale: '0.69', note: 'страница уже экрана не станет: вёрстка на 600 и уменьшение', tone: 'warn' },
];

export const META_NOTE =
  'Число 980 — наследие первых смартфонов: сайты тогда верстали под мониторы, и телефон делал вид, что у него окно ноутбука, а потом уменьшал картинку целиком. Без мета-тега медиазапросы честно видят 980px, и «мобильная» вёрстка не включается вообще. Мета-тег действует только в мобильном браузере: в обычном окне шириной 412px страница и без него верстается на 412.';

/** Pixel 7, `width=device-width, initial-scale=1`, щипок ×2 (CDP). Снято, см. шапку. */
export const PINCH_ROWS: { k: string; before: string; after: string }[] = [
  { k: '`innerWidth`, `clientWidth`', before: '412', after: '412' },
  { k: '`100vw`', before: '412px', after: '412px' },
  { k: '`@media (width: 412px)`', before: 'верно', after: 'верно' },
  { k: '`visualViewport.width × height`', before: '412 × 839', after: '206 × 419.5' },
  { k: '`visualViewport.scale`', before: '1', after: '2' },
  { k: 'события', before: '—', after: 'только `resize` у `visualViewport`, у `window` — нет' },
];

export const PINCH_NOTE =
  'Щипок увеличивает картинку, а не страницу: вёрстка, единицы и медиазапросы остаются прежними, меняется только visual viewport. После жеста «увеличить в 2.5 раза у точки (200, 300)» видимая область — 164.8 × 335.6 CSS-пикселя, а её левый верхний угол сдвинулся внутрь страницы: `offsetLeft` 120, `offsetTop` 180.';

/**
 * Панель над клавиатурой. Исполняется тестом в Chromium: щипок ×2 (CDP), после него
 * `transform` у панели должен поднять её к нижнему краю видимой области.
 */
export const VV_CODE = `// Панель «Отправить» должна висеть у нижнего края ВИДИМОЙ области,
// даже когда клавиатура или щипок её уменьшили.
const bar = document.querySelector('.send-bar');   // position: fixed; bottom: 0
const vv = window.visualViewport;

function stick() {
  // fixed прижат к layout viewport; разница — то, что закрыто снизу
  const hidden = innerHeight - (vv.offsetTop + vv.height);
  bar.style.transform = 'translateY(' + -hidden + 'px)';
}
vv.addEventListener('resize', stick);
vv.addEventListener('scroll', stick);
stick();`;

export const KEYBOARD_NOTE =
  'Клавиатура устроена так же, как щипок. По документации Chrome, с версии 108 на Android она уменьшает только visual viewport, как Safari на iOS: `innerHeight`, `vh` и медиазапросы остаются прежними, а `position: fixed; bottom: 0` уезжает под клавиатуру. Вернуть старое поведение — уменьшать и layout viewport — можно ключом `interactive-widget=resizes-content` в том же мета-теге.';

export const ZOOM_LOCK_NOTE =
  '`user-scalable=no` и `maximum-scale=1` в мета-теге запрещают щипок: в эмуляции Pixel 7 жест «×2.5» оставил `visualViewport.scale` равным 1. Для слабовидящего это запрет увеличить текст, то есть нарушение WCAG 1.4.4. Часть мобильных браузеров запрет игнорирует, но полагаться на это нельзя — эти ключи просто не ставят.';

// ─── Раздел 2. Единицы окна ────────────────────────────────────────────────────────────────

export const PLAIN_TOOLBAR =
  'Как штора на окне поезда. Окно — экран телефона, штора — адресная строка: она то опущена, то поднята. `lvh` меряет окно с поднятой шторой, `svh` — с опущенной, `dvh` — как штора висит сейчас. Старый `vh` на телефонах меряет окно с поднятой шторой, поэтому блок высотой `100vh` уходит под штору, когда она опущена.';

export const UNITS_ROWS: { k: string; what: string; when: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`vh`, `lvh`', what: 'большой вьюпорт: адресная строка и панели убраны', when: 'не меняется при прокрутке; пока панели видны, `100vh` выше видимой части', tone: 'warn' },
  { k: '`svh`', what: 'маленький вьюпорт: всё выдвинуто', when: 'не меняется; блок `100svh` виден целиком всегда, но после прокрутки под ним появляется зазор', tone: 'ok' },
  { k: '`dvh`', what: 'то, что видно сейчас', when: 'меняется при прокрутке — и с ним раскладка всего, что от него зависит', tone: 'err' },
  { k: '`vw`, `svw`, `lvw`, `dvw`', what: 'то же по ширине', when: 'ширину панели браузера обычно не меняют, но полоса прокрутки — отдельная история', tone: undefined },
];

export const VH_CODE = `.hero {
  min-height: 100vh;    /* запасной вариант для старых браузеров */
  min-height: 100svh;   /* виден целиком, даже когда адресная строка выдвинута */
}

.sheet {                /* нижняя шторка, которая должна точно касаться края */
  height: 100dvh;       /* пересчитывается на каждом шаге прокрутки */
}`;

export const VH_NOTE =
  'Разница трёх единиц есть только там, где у браузера выезжают панели, — на телефоне. Эмуляция устройства в Chromium и в DevTools панелей не рисует: на Pixel 7 все три дают 839px и до, и после прокрутки. Проверять `svh` против `lvh` приходится на настоящем телефоне. Определения — в CSS Values 4: `vh` нарочно равен большому вьюпорту, чтобы прокрутка не двигала вёрстку.';

export const VW_CODE = `.promo { width: 100vw; }   /* «на всю ширину» — и горизонтальная прокрутка */

/* Окно 800px, классическая полоса 12px:
   100vw = 800, а места для содержимого — 788. */

.promo { width: 100%; }    /* от родителя, а полосу родитель уже вычел */`;

/** Окно 800px, полоса 12px (`::-webkit-scrollbar`), страница длиннее окна. Снято, см. шапку. */
export const VW_ROWS: { k: string; vw: number; client: number; scroll: number; tone?: 'ok' | 'err' }[] = [
  { k: 'длинная страница', vw: 800, client: 788, scroll: 800, tone: 'err' },
  { k: '`html { scrollbar-gutter: stable }`', vw: 800, client: 788, scroll: 800, tone: 'err' },
  { k: '`html { overflow-y: scroll }`', vw: 800, client: 788, scroll: 800, tone: 'err' },
  { k: 'короткая страница, полосы нет', vw: 800, client: 800, scroll: 800, tone: 'ok' },
];

export const VW_NOTE =
  '`100vw` всегда считает полосу прокрутки своей. Когда полоса классическая, блок шириной `100vw` на 12px шире места, и у страницы появляется горизонтальная прокрутка. Спецификация обещает, что при `overflow: scroll` или `scrollbar-gutter: stable` на корне `vw` уменьшится на полосу, но в Chromium 153 этого нет: во всех трёх вариантах `100vw` = 800. На Mac с полосами-наложениями ошибку не видно вовсе — она живёт у пользователей Windows.';

// ─── Раздел 3. Медиазапросы ────────────────────────────────────────────────────────────────

export const RANGE_CODE = `/* старая запись: «не меньше» и «не больше» */
@media (min-width: 640px) and (max-width: 799px) { … }

/* запись диапазоном: строгое и нестрогое неравенство явно */
@media (640px <= width < 800px) { … }

/* соседние диапазоны стыкуются без щели и без нахлёста */
@media (width < 640px)  { … }
@media (width >= 640px) { … }`;

export const RANGE_NOTE =
  '`min-width` — это всегда «больше или равно», `max-width` — «меньше или равно». Поэтому соседние диапазоны в старой записи либо перекрываются на один пиксель (`max-width: 640px` и `min-width: 640px` — оба верны при 640), либо оставляют щель, если сдвинуть границу на единицу. Media Queries 4 приводит именно этот пример: ширина окна бывает дробной, и между `max-width: 639px` и `min-width: 640px` не сработает ни одно. Запись `width < 640px` и `width >= 640px` такой щели не оставляет. В Chromium 153 запрос `(640px <= width < 800px)` верен при 640 и 799 и неверен при 800.';

export const EM_CODE = `html { font-size: 32px; }            /* крупный шрифт для всей страницы */

@media (min-width: 40em) { … }       /* срабатывает при 640px, а не при 1280 */
@media (min-width: 40rem) { … }      /* тоже 640: rem здесь — не от html */
@media (min-width: 640px) { … }`;

/** Когда срабатывают три запроса из `EM_CODE`. Снято, см. шапку. */
export const EM_ROWS: { k: string; em: string; rem: string; px: string }[] = [
  { k: '`html { font-size: 32px }`, шрифт браузера 16', em: 'с 640', rem: 'с 640', px: 'с 640' },
  { k: 'шрифт браузера 20 (настройки)', em: 'с 800', rem: 'с 800', px: 'с 640' },
];

export const EM_NOTE =
  'Медиазапрос проверяется раньше, чем применяются стили страницы, поэтому `em` и `rem` в нём не могут зависеть от правил на `html`. Media Queries 4 говорит прямо: относительные единицы в запросе считаются от начального значения, то есть от размера шрифта в настройках браузера. Отсюда и довод за `em`-границы: человек, который поставил в настройках шрифт 20 вместо 16, получает перестройку вёрстки раньше, при 800px. Его текст крупнее, и колонкам нужно больше места. Граница в `px` от этой настройки не сдвинется.';

export const MQ_SCROLL_NOTE =
  'И ещё одно расхождение, на котором ломаются скрипты. Медиазапрос сравнивает ширину окна **вместе с полосой прокрутки**: при окне 800 и полосе 12px верно `(width: 800px)`, хотя `document.documentElement.clientWidth` — 788. Если код решает «мобильная или нет» по `clientWidth`, а CSS — по `@media`, в полосе шириной 12px они разойдутся. В JS тот же вопрос задают тем же языком: `matchMedia(\'(width >= 800px)\').matches`.';

/** Снято `matchMedia` в Chromium 153; эмуляция — `emulateMedia` и CDP, указатель — Pixel 7. */
export const PREFERS_ROWS: { k: string; what: string; how: string }[] = [
  { k: '`prefers-color-scheme: dark`', what: 'тёмная тема в системе', how: 'DevTools → Rendering; Playwright `emulateMedia({ colorScheme })`' },
  { k: '`prefers-reduced-motion: reduce`', what: 'просьба убрать движение', how: '`emulateMedia({ reducedMotion })`' },
  { k: '`prefers-contrast: more`', what: 'просьба о большем контрасте', how: '`emulateMedia({ contrast })`' },
  { k: '`forced-colors: active`', what: 'система навязывает свою палитру (высококонтрастный режим Windows)', how: '`emulateMedia({ forcedColors })`' },
  { k: '`prefers-reduced-transparency: reduce`', what: 'просьба убрать полупрозрачность', how: 'CDP `Emulation.setEmulatedMedia`' },
  { k: '`hover: none`, `pointer: coarse`', what: 'главный указатель — палец: наведения нет, попадание неточное', how: 'эмуляция телефона: на Pixel 7 `hover: hover` неверно, `pointer: coarse` верно' },
];

export const PREFERS_NOTE =
  'Эти условия спрашивают не про размер, а про человека и устройство. Ширина окна ничего не говорит о том, есть ли мышь: планшет с клавиатурой широкий, но без наведения. Для «есть ли наведение» есть свой запрос, и меню, которое раскрывается по `:hover`, прячут за `@media (hover: hover)`.';

export const SRCSET_NOTE =
  'Для картинок медиазапрос живёт ещё и в атрибуте `sizes`. Там его читает не каскад, а упреждающий загрузчик, до CSS и раскладки, — это разобрано в теме [«Картинки: загрузка, декодирование и выбор размера», раздел «srcset и sizes»](/render/images/#s1).';

// ─── Раздел 4. Контейнеры ──────────────────────────────────────────────────────────────────

export const CQ_CODE = `.slot {                          /* место, куда ставят карточку */
  container: slot / inline-size;  /* имя slot, запрос по ширине */
}

.card { display: flex; flex-direction: column; }

@container slot (width >= 400px) {
  .card { flex-direction: row; }  /* в широком месте — картинка слева */
}`;

export const CQ_LEAD_NOTE =
  'Почему контейнеру обязательна изоляция и почему style-запросу (`@container style(--x: …)`) она не нужна, разобрано в теме [«Каскад и вычисление стилей», раздел «Переменные и инвалидация»](/render/css-cascade/#s5). Здесь — что именно ломается от изоляции и как контейнер выбирается.';

export const PLAIN_CONTAINMENT =
  'Как рамка для картины, заказанная заранее. Обычно рамку подгоняют под холст. Контейнер работает наоборот: размер рамки известен до того, как в неё вставили холст, и холст подстраивается под рамку. А если размер рамки никто не назвал, её делают по пустому месту — нулевой.';

/**
 * У каждого блока `container-type: inline-size; padding: 0 10px`, внутри — «Длинный текст
 * карточки». Окно 1000px. Снято, см. шапку.
 */
export const SHRINK_ROWS: { k: string; plain: string; cq: string; tone?: 'ok' | 'err' }[] = [
  { k: '`display: inline-block`', plain: '189.8', cq: '20 — текст вылез наружу', tone: 'err' },
  { k: 'колонка грида `auto`', plain: '189.8', cq: '20', tone: 'err' },
  { k: 'флекс-элемент, `flex: none` и по умолчанию', plain: 'по тексту', cq: '20', tone: 'err' },
  { k: '`position: absolute` без ширины', plain: 'по тексту', cq: '20', tone: 'err' },
  { k: '`float: left`', plain: 'по тексту', cq: '20', tone: 'err' },
  { k: '`width: fit-content`', plain: 'по тексту', cq: '20', tone: 'err' },
  { k: 'обычный блок', plain: '1000', cq: '1000 — ширину даёт родитель', tone: 'ok' },
];

export const SHRINK_NOTE =
  'Всё, что берёт ширину «по содержимому», с `container-type: inline-size` получает ширину пустого блока: только отступы, 20px. Текст при этом никуда не девается и вылезает наружу. Отсюда правило: контейнер — это обёртка, которой ширину задаёт снаружи родитель (блок, ячейка грида с `1fr`, флекс-элемент с `flex: 1`). Запрос по ширине и высоте, `container-type: size`, без явной высоты делает элемент нулевым и по высоте: на стенде 1000 × 0.';

export const CQ_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Ширина — это content-box',
    d: 'Контейнер `width: 500px` с `box-sizing: border-box` и отступами по 20px отвечает на запрос шириной 460: `(width > 450px)` верно, `(width > 470px)` — нет. `10cqi` внутри него — 46px.',
  },
  {
    t: 'Себя элемент не спрашивает',
    d: '`@container` ищет контейнер среди **предков**. Правило для `.slot` внутри `@container (…)` сравнивает ширину внешнего контейнера, а не самого `.slot`. Контейнер без контейнеров выше не попадёт в такое правило никогда.',
    tone: 'warn',
  },
  {
    t: 'Без имени — ближайший, с именем — ближайший с этим именем',
    d: '`@container slot (…)` проскакивает безымянные контейнеры и ищет предка с `container-name: slot`. Если такого нет, правило не сработает — без ошибки и без предупреждения в консоли.',
    tone: 'err',
  },
  {
    t: '`em` в условии — от шрифта контейнера',
    d: 'В `@media` `em` считается от шрифта браузера. В `@container` — от шрифта самого контейнера: при `font-size: 25px` граница `21em` — это 525px. `rem` — от `html`, как в обычных стилях.',
    tone: 'warn',
  },
  {
    t: '`cqi` без контейнера — это ширина окна',
    d: 'Нет подходящего предка — единица берёт маленький вьюпорт: `10cqi` при окне 1000 и без контейнеров — 100px. `cqb` внутри контейнера `inline-size` тоже падает на окно: у такого контейнера нет высоты для запросов, и `10cqb` при окне высотой 600 — 60px.',
  },
];

/** Снято в Chromium 153: применилось ли правило и что ответил `CSS.supports`. */
export const STYLE_ROWS: { k: string; v: string; tone?: 'ok' | 'err' }[] = [
  { k: '`@container style(--theme: dark)`', v: 'работает; `container-type` не нужен', tone: 'ok' },
  { k: '`@container style(--n > 5)` — диапазон по переменной', v: 'работает при `--n: 7`', tone: 'ok' },
  { k: '`@container style(color: red)` — обычное свойство', v: 'правило разобрано, но не срабатывает никогда', tone: 'err' },
  { k: '`color: if(style(--theme: dark): …; else: …)`', v: 'работает: условие прямо в значении', tone: 'ok' },
  { k: '`container-type: scroll-state`', v: 'поддерживается: запросы «прилип ли», «можно ли прокрутить»', tone: 'ok' },
];

// ─── Раздел 5. Какое правило сработает ─────────────────────────────────────────────────────

export const PLAIN_RESOLVE =
  'Как контролёр, который проверяет пропуска по списку. Для каждого правила он смотрит, чей размер спрашивают (окна или контейнера), переводит порог в пиксели по нужному шрифту и сравнивает. Подошедшие правила ложатся друг на друга по порядку, и у каждого свойства остаётся последнее слово.';

/**
 * Учебная модель: какие `@media` и `@container` сработают и что выйдет в пикселях.
 * Печатается в теме, исполняется демо (`widgets/responsive-lab/model/run.ts`) и сверяется
 * с Chromium в `tests/unit/responsive.test.ts`. Ограничения модели названы в комментариях:
 * один уровень вложенности, все контейнеры — `inline-size`, svh = lvh = dvh.
 */
export const RESOLVE_CODE = String.raw`// Окно, шрифты и цепочка контейнеров снаружи внутрь. width — content-box.
// env = { viewport: { width: 412, height: 839 }, initialFont: 16, rootFont: 16,
//         containers: [{ name: 'slot', width: 380, font: 16 }] }

function parseRules(css) {
  const rules = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; src.indexOf('{', i) >= 0; ) {
    const open = src.indexOf('{', i);
    const head = src.slice(i, open).trim();
    let depth = 1, j = open + 1;
    for (; depth > 0; j++) depth += src[j] === '{' ? 1 : src[j] === '}' ? -1 : 0;
    const body = src.slice(open + 1, j - 1);
    if (head.startsWith('@')) {
      for (const inner of parseRules(body)) rules.push({ ...inner, when: head });
    } else {
      const decls = body.split(';').filter((d) => d.includes(':')).map((d) => {
        const at = d.indexOf(':');
        return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
      });
      rules.push({ when: null, selector: head, decls });
    }
    i = j;
  }
  return rules;
}

// Сколько пикселей в одной единице. Маленький, большой и динамический
// вьюпорт здесь равны — так на десктопе; на телефоне svh < dvh <= lvh.
function units(env, em) {
  const { width: vw, height: vh } = env.viewport;
  const box = env.containers.at(-1);              // ближайший контейнер
  const cqi = box ? box.width : vw;               // нет контейнера — окно
  const cqb = vh;                                 // inline-size не даёт высоты: окно
  return {
    px: 1, em, rem: env.rootFont,
    vw: vw / 100, svw: vw / 100, lvw: vw / 100, dvw: vw / 100, vi: vw / 100,
    vh: vh / 100, svh: vh / 100, lvh: vh / 100, dvh: vh / 100, vb: vh / 100,
    vmin: Math.min(vw, vh) / 100, vmax: Math.max(vw, vh) / 100,
    cqi: cqi / 100, cqw: cqi / 100, cqb: cqb / 100, cqh: cqb / 100,
    cqmin: Math.min(cqi, cqb) / 100, cqmax: Math.max(cqi, cqb) / 100,
  };
}

// calc(), min(), max(), clamp() и числа с единицами. clamp оставляет след в trace.
function evalLength(text, U, trace = []) {
  const tokens = text.match(/-?\d*\.?\d+[a-z%]*|[a-z-]+\(|[()+*/,]|-/gi);
  let pos = 0;
  const sum = () => {
    let v = product();
    while (tokens[pos] === '+' || tokens[pos] === '-') v = tokens[pos++] === '+' ? v + product() : v - product();
    return v;
  };
  const product = () => {
    let v = atom();
    while (tokens[pos] === '*' || tokens[pos] === '/') v = tokens[pos++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const atom = () => {
    const t = tokens[pos++];
    if (t === '(') { const v = sum(); pos++; return v; }
    if (t.endsWith('(')) {
      const args = [sum()];
      while (tokens[pos++] === ',') args.push(sum());   // съедает и «,», и «)»
      const fn = t.slice(0, -1);
      if (fn === 'min') return Math.min(...args);
      if (fn === 'max') return Math.max(...args);
      if (fn === 'clamp') {
        const [min, val, max] = args;
        const out = Math.max(min, Math.min(val, max)); // min сильнее max
        trace.push({ min, val, max, out, pinned: out === val ? null : out === min ? 'min' : 'max' });
        return out;
      }
      return args[0];                                   // calc()
    }
    const [, num, unit] = t.match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
    if (!unit) return Number(num);
    if (!(unit in U)) throw new Error('единица не поддержана: ' + unit);
    return Number(num) * U[unit];
  };
  return sum();
}

const OPS = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b };
const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };
const AXIS = { width: 'width', 'inline-size': 'width', height: 'height', 'block-size': 'height' };

// Одно условие в скобках → сравнения «что есть ОП порог».
function checkFeature(f, size, U) {
  const px = (t) => evalLength(t, U);
  let m = f.match(/^(min|max)-([a-z-]+)\s*:\s*(.+)$/);
  if (m) return [{ feature: m[2], actual: size[AXIS[m[2]]], op: m[1] === 'min' ? '>=' : '<=', limit: px(m[3]) }];
  m = f.match(/^orientation\s*:\s*(\w+)$/);
  if (m) {
    const now = size.height >= size.width ? 'portrait' : 'landscape';
    return [{ feature: 'orientation', actual: now, op: '=', limit: m[1] }];
  }
  m = f.match(/^([a-z-]+)\s*:\s*(.+)$/);
  if (m) return [{ feature: m[1], actual: size[AXIS[m[1]]], op: '=', limit: px(m[2]) }];
  const parts = f.split(/\s*(<=|>=|<|>|=)\s*/);     // «a ОП b» или «a ОП width ОП b»
  if (parts.length === 3 && parts[0] in AXIS) {
    return [{ feature: parts[0], actual: size[AXIS[parts[0]]], op: parts[1], limit: px(parts[2]) }];
  }
  if (parts.length === 3) {
    return [{ feature: parts[2], actual: size[AXIS[parts[2]]], op: FLIP[parts[1]], limit: px(parts[0]) }];
  }
  const feature = parts[2], actual = size[AXIS[feature]];
  return [
    { feature, actual, op: FLIP[parts[1]], limit: px(parts[0]) },
    { feature, actual, op: parts[3], limit: px(parts[4]) },
  ];
}

// Условие целиком: not, and, or (без смешивания — CSS его тоже запрещает).
function checkCondition(cond, size, U) {
  const negate = /^not\s/.test(cond);
  const groups = [...cond.matchAll(/\(([^()]*)\)/g)].map((g) => checkFeature(g[1].trim(), size, U));
  for (const checks of groups) for (const c of checks) c.ok = OPS[c.op](c.actual, c.limit);
  const each = groups.map((checks) => checks.every((c) => c.ok));
  const ok = / or /.test(cond) ? each.some(Boolean) : each.every(Boolean);
  return { checks: groups.flat(), ok: negate ? !ok : ok };
}

function matchRule(env, when) {
  if (!when) return { kind: 'always', ok: true, checks: [] };
  if (when.startsWith('@media')) {
    // em и rem в @media — от НАЧАЛЬНОГО шрифта браузера, а не от html
    const U = { ...units(env, env.initialFont), rem: env.initialFont };
    const cond = when.slice(6).trim().replace(/^(only\s+)?(screen|all)\s+and\s+/, '');
    if (/^(only\s+)?print$/.test(cond)) return { kind: 'media', ok: false, checks: [] };
    return { kind: 'media', ...checkCondition(cond, env.viewport, U) };
  }
  // @container [имя] (условие): ближайший предок-контейнер с таким именем
  const [, name, cond] = when.match(/^@container\s+(?:([a-z][\w-]*)\s+)?(.+)$/i);
  const box = [...env.containers].reverse().find((c) => !name || c.name === name);
  if (!box) return { kind: 'container', name, box: null, ok: false, checks: [] };
  // а em в @container — от шрифта самого контейнера
  const U = { ...units(env, box.font), rem: env.rootFont };
  return { kind: 'container', name, box, ...checkCondition(cond, { width: box.width, height: 0 }, U) };
}

function resolve(env, css) {
  const rules = parseRules(css).map((r, index) => ({ index, ...r, ...matchRule(env, r.when) }));
  const elements = {};
  for (const r of rules) {
    if (!r.ok) continue;
    const el = (elements[r.selector] ??= {});
    for (const [prop, text] of r.decls) el[prop] = { text, from: r.index }; // ниже — сильнее
  }
  const parentFont = env.containers.at(-1)?.font ?? env.rootFont;
  const compute = (decl, em) => {
    if (!/^(-?[\d.]|calc\(|min\(|max\(|clamp\()/.test(decl.text)) return;   // ключевое слово
    decl.clamps = [];
    decl.px = evalLength(decl.text, units(env, em), decl.clamps);
  };
  for (const el of Object.values(elements)) {
    if (el['font-size']) compute(el['font-size'], parentFont);            // em шрифта — от родителя
    const font = el['font-size']?.px ?? parentFont;
    for (const [prop, decl] of Object.entries(el)) if (prop !== 'font-size') compute(decl, font);
  }
  return { rules, elements };
}`;

export const RESOLVE_NOTE =
  'Три места в коде делают всю работу темы. `units` решает, от чего считается `cqi`: от ближайшего контейнера, а без него — от окна. `matchRule` берёт для `@media` шрифт браузера, а для `@container` — шрифт найденного контейнера. `resolve` сначала считает `font-size`, потому что `em` во всех остальных свойствах — от него.';

/**
 * Карточка демо. Печатается в теме и разбирается той же `parseRules`; тест сверяет результат
 * `resolve` с Chromium на этой разметке (`.slot` — контейнер, внутри элементы с этими классами).
 */
export const CARD_CSS = `.slot  { container: slot / inline-size; }

.card  { display: flex; flex-direction: column; gap: 12px;
         padding: clamp(8px, 2vw, 24px); }
.thumb { width: auto; }
.title { font-size: clamp(1rem, 0.6rem + 2.5cqi, 1.75rem); }
.meta  { display: none; }

@container slot (width >= 400px) {
  .card  { flex-direction: row; gap: 1em; }
  .thumb { width: 35cqi; }
}
@container slot (width >= 40em) {
  .meta  { display: block; }
}
@media (width < 40em) {
  .card  { gap: 8px; }
}`;

export const FONT_CHOICES: FontChoice[] = [
  { value: 'b16', label: 'браузер 16', initial: 16, root: 16 },
  { value: 'b20', label: 'браузер 20', initial: 20, root: 20 },
  { value: 'h20', label: 'html 20px', initial: 16, root: 20 },
];

export const DEMO_CAPTION =
  'Два `40em` в `CARD_CSS` значат разное. В `@media` это 40 шрифтов браузера, в `@container` — 40 шрифтов контейнера, а контейнер наследует шрифт от `html`. При шрифте браузера 20 сдвигаются обе границы, до 800px. При `html { font-size: 20px }` расходятся: медиазапрос остаётся на 640, контейнерный уходит на 800. А `clamp` у отступа упирается в `8px` на узком окне и в `24px` на широком и в середине растёт вместе с окном, а не с местом под карточку.';

// ─── Раздел 6. clamp и масштаб ─────────────────────────────────────────────────────────────

export const PLAIN_CLAMP =
  'Как регулятор громкости с ограничителем. Ручка — ширина окна: крутите, и звук растёт. Но ниже порога он не опускается, чтобы было слышно, и выше потолка не поднимается, чтобы не оглушить. `clamp(MIN, ЗНАЧЕНИЕ, MAX)` — ровно это: пол, ручка и потолок.';

/**
 * Прямая через две точки: размер шрифта `minPx` при окне `fromVw` и `maxPx` при `toVw`.
 * Исполняется тестом: строка, которую возвращает `fluid`, ставится в Chromium и даёт 16px
 * при окне 360 и 28px при окне 1280.
 */
export const FLUID_CODE = `// Шрифт растёт с 16px при окне 360 до 28px при окне 1280.
function fluid(minPx, maxPx, fromVw, toVw, root = 16) {
  const slope = (maxPx - minPx) / (toVw - fromVw);   // пикселей шрифта на пиксель окна
  const base = minPx - slope * fromVw;               // где прямая пересекает ось
  const r = (n) => +n.toFixed(4);
  return 'clamp(' + r(minPx / root) + 'rem, ' +
    r(base / root) + 'rem + ' + r(slope * 100) + 'vw, ' + r(maxPx / root) + 'rem)';
}

fluid(16, 28, 360, 1280);
// → 'clamp(1rem, 0.7065rem + 1.3043vw, 1.75rem)'`;

export const FLUID_NOTE =
  'Пол и потолок — в `rem`, а не в `px`: так они уважают шрифт из настроек браузера. Середина — сумма `rem` и `vw`, и от доли `vw` в ней зависит, как текст переживёт масштаб страницы.';

/**
 * Окно 1280 физических пикселей, масштаб страницы эмулирован (см. шапку): физический
 * размер шрифта = `font-size` × `devicePixelRatio`. Снято.
 */
export const ZOOM_ROWS: { k: string; z100: number; z200: number; z300: number; z400: number; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`16px` или `1rem`', z100: 16, z200: 32, z300: 48, z400: 64, tone: 'ok' },
  { k: '`2.5vw`', z100: 32, z200: 32, z300: 32, z400: 32, tone: 'err' },
  { k: '`clamp(1rem, 0.5rem + 2vw, 2rem)`', z100: 32, z200: 41.6, z300: 49.62, z400: 64, tone: 'warn' },
  { k: '`clamp(1rem, 1rem + 1vw, 2.5rem)`', z100: 28.8, z200: 44.8, z300: 60.81, z400: 76.8, tone: 'warn' },
];

export const ZOOM_NOTE =
  'Масштаб страницы (Ctrl + на ноутбуке) не увеличивает картинку, как щипок, а уменьшает окно в CSS-пикселях: 1280 физических пикселей при 200% — это окно 640 CSS-пикселей с DPR 2. Пиксели и `rem` от этого растут вдвое. `vw` уменьшается ровно во столько же раз, во сколько растёт DPR, и текст на `vw` остаётся того же физического размера при любом масштабе. WCAG 1.4.4 требует, чтобы текст увеличивался до 200%, и разбор неудач F94 называет текст на одних единицах окна прямо. `clamp` с `rem` внутри растёт, но медленнее: первый вариант при 200% вырос в 1.3 раза, второй — в 1.56. Чем больше доля `vw` в середине, тем хуже работает масштаб.';

export const REFLOW_NOTE =
  'Масштаб 400% на окне 1280 даёт окно 320 CSS-пикселей — то же, что телефон. Поэтому критерий WCAG 1.4.10 «перекомпоновка» формулируется через ширину 320: страница при ней должна читаться без горизонтальной прокрутки. Медиазапросы, которые уже работают для телефона, работают и для человека с увеличенным масштабом.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Без `<meta viewport>` телефон видит 980px',
    d: 'Медиазапросы для узкого экрана не включаются вовсе: `(width: 980px)` верно на Pixel 7 шириной 412. Страница уменьшается целиком, текст 16px на экране — около 6.7px.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`100vh` на телефоне выше видимой части',
    d: '`vh` равен большому вьюпорту — с убранной адресной строкой. Пока строка видна, низ блока `100vh` под ней. Эмуляция устройства этого не покажет: там все три единицы равны.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`100vw` шире страницы на полосу прокрутки',
    d: 'При классической полосе 12px — горизонтальная прокрутка на 12px. `scrollbar-gutter: stable` и `overflow-y: scroll` на `html` в Chromium 153 `vw` не уменьшают. На Mac с полосами-наложениями не видно.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`em` в `@media` — не от `html`',
    d: '`html { font-size: 62.5% }` не превращает `40em` в 400px: граница остаётся на 640 при шрифте браузера 16. Зато настройка шрифта в браузере её сдвигает.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Контейнер по ширине содержимого схлопывается',
    d: '`inline-block`, `float`, колонка `auto`, флекс-элемент без `flex: 1` с `container-type: inline-size` получают ширину пустого блока, и текст вылезает наружу.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Опечатка в имени контейнера молчит',
    d: '`@container sidebar (…)` без предка с этим именем не срабатывает никогда, и консоль ничего не скажет. То же с контейнером, который спрашивает сам себя: правило сравнит ширину внешнего контейнера.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Медиазапрос и `clientWidth` расходятся на полосу',
    d: '`@media` считает окно с полосой прокрутки, `clientWidth` — без. Решать «мобильная или нет» в JS надо через `matchMedia`, тем же условием, что в CSS.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Текст на `vw` не растёт при масштабе',
    d: 'Физический размер `2.5vw` на 100% и 400% одинаковый — это провал WCAG 1.4.4 (F94). `clamp` с `rem` внутри растёт, но медленнее, чем `rem`: проверять масштаб 200% глазами.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Щипок не меняет ни вёрстку, ни `resize` окна',
    d: 'При щипке и клавиатуре меняется только visual viewport: `innerWidth`, `vw` и медиазапросы прежние, событие приходит только у `visualViewport`. Слушать надо его.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'CSS Values and Units 4 — Viewport-percentage lengths',
    href: 'https://drafts.csswg.org/css-values-4/#viewport-relative-lengths',
    what: 'большой, маленький и динамический вьюпорт, `vh` = `lvh`, правило про полосу прокрутки',
  },
  {
    title: 'Media Queries 4 — Units, Range context',
    href: 'https://drafts.csswg.org/mediaqueries-4/#units',
    what: '`em` от начального значения; запись диапазоном и пример с дробной шириной — §2.4.3',
  },
  {
    title: 'CSS Conditional 5 — Container queries',
    href: 'https://drafts.csswg.org/css-conditional-5/#container-queries',
    what: '`container-type`, `container-name`, выбор контейнера, style-запросы, единицы `cq*` (#container-lengths)',
  },
  {
    title: 'CSS Containment 2 — Size containment',
    href: 'https://drafts.csswg.org/css-contain-2/#size-containment',
    what: 'почему изолированный элемент меряется как пустой',
  },
  {
    title: 'CSS Viewport — meta viewport',
    href: 'https://drafts.csswg.org/css-viewport/',
    what: 'ключи `width`, `initial-scale`, `interactive-widget`',
  },
  {
    title: 'Visual Viewport API',
    href: 'https://wicg.github.io/visual-viewport/',
    what: '`window.visualViewport`, события `resize` и `scroll`',
  },
  {
    title: 'Chrome — Prepare for viewport resize behavior changes',
    href: 'https://developer.chrome.com/blog/viewport-resize-behavior',
    what: 'клавиатура в Chrome 108+ уменьшает только visual viewport',
  },
  {
    title: 'web.dev — The large, small, and dynamic viewport units',
    href: 'https://web.dev/blog/viewport-units',
    what: '`svh`/`lvh`/`dvh` в картинках с адресной строкой',
  },
  {
    title: 'WCAG 2.2 — Understanding 1.4.4 Resize Text',
    href: 'https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html',
    what: 'текст увеличивается до 200%',
  },
  {
    title: 'WCAG 2.2 — F94: incorrectly using viewport units to resize text',
    href: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F94',
    what: 'текст на `vw` как провал 1.4.4',
  },
  {
    title: 'WCAG 2.2 — Understanding 1.4.10 Reflow',
    href: 'https://www.w3.org/WAI/WCAG22/Understanding/reflow.html',
    what: 'ширина 320 CSS-пикселей = 1280 при масштабе 400%',
  },
  {
    title: 'MDN — `<meta name="viewport">`',
    href: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport',
    what: 'ключи мета-тега и их поддержка',
  },
];

export const RELATED =
  'Смежное на сайте: [Каскад и вычисление стилей, раздел «Переменные и инвалидация»](/render/css-cascade/#s5) — зачем контейнеру изоляция и как работают style-запросы. [Картинки: загрузка, декодирование и выбор размера, раздел «srcset и sizes»](/render/images/#s1) — медиазапросы в `sizes`. [Раскладка изнутри, раздел «Размеры содержимого»](/render/layout-internals/#s1) — min-content и max-content. [Кадр браузера, раздел «Чтение и запись»](/render/render-pipeline/#s3) — виды `contain`. [Прокрутка изнутри, раздел «Полоса»](/render/scrolling/#s7) — `scrollbar-gutter`. [Шрифты и текст: от загрузки до пикселей](/render/fonts-text/) — откуда берётся ширина строки. [Наблюдатели](/render/observers/) — когда срабатывают Intersection-, Resize- и MutationObserver и где браузеры расходятся со спецификацией.';
