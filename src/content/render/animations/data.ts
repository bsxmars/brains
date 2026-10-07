import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AnimCase, AnimSpec, LayerScene, StandFrame } from '@/widgets/anim-lab/model/types';

/**
 * Данные темы «Анимации и композитор: почему transform дешёвый».
 *
 * Тема написана 2026-10-01. Базовое — шаги кадра, что такое слой, `will-change` как обмен,
 * причины слоя на типичных случаях, проверка блокировкой — разобрано в «Кадре браузера»
 * (`/render/render-pipeline/`, разделы «Кадр по шагам» и «Что дешевле двигать») и здесь
 * не пересказывается. Эта тема идёт глубже: что именно Chromium берёт на композитор, как
 * решается смесь свойств, кто считает значение (CSS, WAAPI, rAF), сколько стоят слои
 * и что делать с `prefers-reduced-motion`.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63), Node 24.11.0, окно 800×600,
 * DPR 1 (один замер — DPR 2). Скрипт `stand.mjs` в каталоге стенда, протокол отладчика (CDP).
 * Прогон повторён десять раз по мере добавления сценариев; булевы выводы (идёт на композитор
 * или нет, есть ли layout/paint на кадр, двигался ли элемент при занятом потоке) не менялись
 * ни разу, счётчики гуляли на ±1–3 (у `filter: blur()` в последнем прогоне 68 пересчётов
 * при 78 `Commit` — машина была загружена, кадров в окно попало больше). Литералы — из
 * последнего прогона.
 *
 * A. **Свойство → работа на кадр** (`STAND.props`, `STAND.drivers`). На каждый сценарий —
 *    своя страница с блоком 100×100; анимация 1 с, `infinite alternate`, включается после
 *    старта трассировки. Через 100 мс снимаются `Performance.getMetrics`, ещё через 1000 мс —
 *    снова; в литерале разница `LayoutCount` и `RecalcStyleCount` за эту секунду. Это
 *    **счётчики вызовов, не время**. Из трассировки (`Tracing.start`, категории
 *    `blink.animations,devtools.timeline,disabled-by-default-devtools.timeline`) — число
 *    событий `Paint` и `Commit` за весь прогон (≈1.1 с) и поле `compositeFailed` /
 *    `unsupportedProperties` события `Animation`: Chromium пишет его, когда анимация
 *    **не** ушла на композитор. Кадров в секунду — 60 (это видно по `Commit` ≈ 66–68
 *    у анимаций на главном потоке: 1.1 с × 60).
 *    Контроль: страница с одним только циклом `requestAnimationFrame` — `Commit` 67,
 *    а `RecalcStyleCount` и `LayoutCount` — 0. Значит счётчик стиля растёт от работы,
 *    а не от факта кадра.
 * B. **Слои** (`STAND.layers`). `LayerTree.enable` до загрузки страницы, последнее событие
 *    `layerTreeDidChange` после двух кадров и 150 мс, у каждого слоя с содержимым ненулевого
 *    размера — `LayerTree.compositingReasons` (поле `compositingReasonIds`). Байты —
 *    арифметика `ширина × высота × DPR² × 4` по размерам слоёв (CDP памяти слоя не отдаёт).
 *    `(пусто)` — слой есть, а список причин у него пуст. Жизнь слоя анимации
 *    (`STAND.layerLifetime`): слоёв до `element.animate` — 1, через 250 мс — 2, после
 *    `finished` — снова 1. Отдельный пробный скрипт (`probe5.mjs` там же): сто карточек поверх
 *    анимации с `opacity: .9`, `overflow: hidden`, `z-index: 1`, `filter: grayscale(1)`,
 *    `clip-path: inset(2px)`, `isolation: isolate` — всякий раз 3 слоя (склейка), с
 *    `will-change` — 102; карточки **под** анимацией — 2 слоя.
 * C. **Занятый главный поток** (`STAND.block`). Одна страница 800×800, пятнадцать полос,
 *    анимации 2 с. Скринкаст (`Page.startScreencast`, PNG, каждый кадр) — его кадры приходят
 *    и во время блокировки (приём из `tests/e2e/scroll-timeline.spec.ts`; `page.screenshot()`
 *    ждёт главный поток и не годится). Главный поток занят циклом `while` 1000 мс; кадры
 *    внутри окна блокировки (с отступом 50 мс с краёв, их 50–55) декодируются `sharp`.
 *    Положение — первый тёмный пиксель в строке полосы; цвет, прозрачность, фильтр — значение
 *    пикселя в точке. «Двигался» — у полосы больше одного значения за окно. Контроль —
 *    кадры после цикла: там двигались все, кроме `clip-path` (его точка к тому моменту
 *    стабильно в отрезанной зоне; во время цикла она менялась 0 → 255).
 * D. **Animation-домен и `prefers-reduced-motion`** (`STAND.animTypes`, `STAND.reduced`,
 *    `STAND.reducedGlobal`): `Animation.enable` + `animationStarted`; контекст с
 *    `reducedMotion: 'reduce'`; второй прогон — с глобальным правилом «длительность
 *    .001ms !important», как в `src/shared/styles/motion.css` этого сайта.
 *
 * Названия битов `compositeFailed` взяты из исходника Chromium —
 * `third_party/blink/renderer/core/animation/compositor_animations.h`, перечисление
 * `FailureReason` (ветка main, октябрь 2026): 1<<5 `kTargetHasInvalidCompositingState`,
 * 1<<12 `kFilterRelatedPropertyMayMovePixels`, 1<<13 `kUnsupportedCSSProperty`. ⚠️ Это
 * внутренние имена, не API; запуском проверены только числа, имена — по исходнику.
 *
 * ⚠️ Всё снято в **одном движке**. Набор свойств, которые идут на композитор, — решение
 * Chromium, а не спецификации: `background-color` и `clip-path` в нём композитные, в других
 * движках это не проверялось. Headless shell рисует без видеокарты (программный растр),
 * но решение «композитор или главный поток» принимает Blink до этого, и от растра оно
 * не зависит; память слоёв в видеопамяти не измерялась.
 *
 * `tests/unit/animations.test.ts` сверяет `FRAME_PLAN_CODE` и `LAYER_CODE` с литералами
 * стенда на каждом сценарии и исполняет примеры (`WAAPI_CODE`, `RAF_CODE`, `REDUCED_CODE`)
 * на заглушках. Браузерный прогон в тесте не повторяется.
 */

// ─── Литералы стенда ────────────────────────────────────────────────────────────────────────

const f = (layout: number, style: number, paint: number, commit: number, compositeFailed = 0, unsupported: string[] = []): StandFrame => ({
  layout,
  style,
  paint,
  commit,
  compositeFailed,
  unsupported,
});

export const STAND = {
  chromium: '153.0.8010.12',
  fps: 60,
  /** Свойство → за 1 с анимации. Ключ — подпись в таблице; `p`, `from`, `to` — ключевые кадры. */
  props: [
    { label: 'transform', p: 'transform', from: 'translateX(0)', to: 'translateX(300px)', ...f(0, 0, 3, 2) },
    { label: 'translate', p: 'translate', from: '0px', to: '300px', ...f(0, 0, 3, 2) },
    { label: 'rotate', p: 'rotate', from: '0deg', to: '90deg', ...f(0, 0, 3, 2) },
    { label: 'scale', p: 'scale', from: '1', to: '1.5', ...f(0, 0, 5, 2) },
    { label: 'opacity', p: 'opacity', from: '1', to: '0.2', ...f(0, 0, 2, 2) },
    { label: 'filter: brightness()', p: 'filter', from: 'brightness(1)', to: 'brightness(0)', ...f(0, 0, 2, 2) },
    { label: 'filter: blur()', p: 'filter', from: 'blur(0px)', to: 'blur(8px)', ...f(0, 68, 2, 78, 4096) },
    { label: 'background-color', p: 'background-color', from: 'red', to: 'blue', ...f(0, 0, 2, 2) },
    { label: 'clip-path', p: 'clip-path', from: 'inset(0px)', to: 'inset(30px)', ...f(0, 0, 2, 2) },
    { label: 'left', p: 'left', from: '0px', to: '300px', ...f(60, 60, 132, 67, 8224, ['left']) },
    { label: 'top', p: 'top', from: '0px', to: '300px', ...f(60, 60, 130, 66, 8224, ['top']) },
    { label: 'width', p: 'width', from: '100px', to: '300px', ...f(60, 60, 130, 66, 8224, ['width']) },
    { label: 'height', p: 'height', from: '100px', to: '300px', ...f(60, 60, 130, 66, 8224, ['height']) },
    { label: 'margin-left', p: 'margin-left', from: '0px', to: '300px', ...f(60, 60, 131, 68, 8224, ['margin-left']) },
    { label: 'padding-left', p: 'padding-left', from: '0px', to: '50px', ...f(61, 61, 132, 67, 8224, ['padding-left']) },
    { label: 'font-size', p: 'font-size', from: '16px', to: '32px', ...f(60, 60, 132, 66, 8224, ['font-size']) },
    { label: 'box-shadow', p: 'box-shadow', from: '0 0 0 red', to: '0 0 30px red', ...f(0, 60, 133, 68, 8224, ['box-shadow']) },
    { label: 'color', p: 'color', from: 'red', to: 'blue', ...f(0, 60, 132, 66, 8224, ['color']) },
    {
      label: 'border-radius',
      p: 'border-radius',
      from: '0px',
      to: '50px',
      ...f(0, 60, 131, 68, 8224, ['border-bottom-left-radius', 'border-bottom-right-radius', 'border-top-left-radius', 'border-top-right-radius']),
    },
  ],
  /** Кто ведёт анимацию и смеси свойств — тот же замер за 1 с. */
  drivers: {
    'none + rAF': f(0, 0, 0, 67),
    'css transform + rAF': f(0, 60, 2, 68),
    'waapi transform': f(0, 0, 4, 4),
    'transition transform': f(0, 0, 2, 3),
    'raf transform': f(0, 61, 1, 67),
    'raf left': f(60, 60, 132, 66),
    'one keyframes transform+box-shadow': f(0, 60, 134, 68, 8192, ['box-shadow']),
    'two animations transform, box-shadow': f(0, 61, 134, 68, 8192, ['box-shadow']),
    'transition transform, box-shadow': f(0, 60, 132, 67, 8192, ['box-shadow']),
    'box-shadow unchanged in keyframes': f(0, 0, 2, 3),
  } as Record<string, StandFrame>,
  /** Главный поток занят циклом 1000 мс: двигалась ли полоса в кадрах скринкаста. */
  block: {
    blockMs: 1000,
    framesDuring: 55,
    moved: {
      'css-transform': true,
      'css-left': false,
      'waapi-transform': true,
      'raf-transform': false,
      'transition-transform': true,
      'transform+box-shadow': false,
      'transform, box-shadow отдельно': true,
      'transition transform, box-shadow': true,
      'css-opacity': true,
      'css-background-color': true,
      'filter-brightness': true,
      'filter-blur': false,
      'css-box-shadow': false,
      'css-clip-path': true,
      'waapi-left': false,
    } as Record<string, boolean>,
  },
  /** Слои с содержимым: сколько, по каким причинам, байты по арифметике (вместе с корневым). */
  layers: {
    'обычный блок': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'transform: translateX(10px)': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'transform: translateZ(0)': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, '(пусто)': 1 }, bytes: 1_960_000 },
    'will-change: transform': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, WillChangeTransform: 1 }, bytes: 1_960_000 },
    'will-change: opacity': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, WillChangeOpacity: 1 }, bytes: 1_960_000 },
    'идёт анимация transform': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveTransformAnimation: 1 }, bytes: 1_960_000 },
    'идёт анимация opacity': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveOpacityAnimation: 1 }, bytes: 1_960_000 },
    'идёт анимация filter: grayscale()': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveFilterAnimation: 1 }, bytes: 1_960_000 },
    'идёт анимация filter: blur()': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveFilterAnimation: 1 }, bytes: 1_960_000 },
    'идёт анимация transform + box-shadow (одни keyframes)': {
      count: 2,
      reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveTransformAnimation: 1 },
      bytes: 1_971_984,
    },
    'идёт анимация clip-path': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'идёт анимация left': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'идёт анимация background-color': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'transform в rAF': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    'position: fixed': { count: 2, reasons: { RootScroller: 1, OverflowScrolling: 1, Overlap: 1 }, bytes: 9_640_000 },
    '100 карточек': { count: 1, reasons: { RootScroller: 1, OverflowScrolling: 1 }, bytes: 1_920_000 },
    '100 карточек с will-change': { count: 101, reasons: { RootScroller: 1, OverflowScrolling: 1, WillChangeTransform: 100 }, bytes: 2_880_000 },
    '100 карточек поверх анимации': {
      count: 3,
      reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveTransformAnimation: 1, Overlap: 1 },
      bytes: 4_307_200,
    },
    '100 карточек с will-change поверх анимации': {
      count: 102,
      reasons: { RootScroller: 1, OverflowScrolling: 1, ActiveTransformAnimation: 1, WillChangeTransform: 100 },
      bytes: 4_000_000,
    },
    '100 карточек с will-change, DPR 2': { count: 101, reasons: { RootScroller: 1, OverflowScrolling: 1, WillChangeTransform: 100 }, bytes: 11_520_000 },
  } as Record<string, { count: number; reasons: Record<string, number>; bytes: number }>,
  /** Размеры слоёв в сценах со ста карточками (CSS-пиксели). */
  layerSizes: { root: [800, 600], card: [60, 40], anim: [700, 400], squashed: [800, 396], fixedRoot: [800, 3000] },
  layerLifetime: { before: 1, during: 2, after: 1 },
  /** `Animation.animationStarted`: тип на каждый способ. */
  animTypes: [
    { type: 'CSSAnimation', name: 'k' },
    { type: 'WebAnimation', name: '' },
    { type: 'CSSTransition', name: 'transform' },
  ],
  /** `reducedMotion: 'reduce'`: анимаций у элемента (`getAnimations().length`). */
  reduced: {
    matches: true,
    cssWithoutMedia: 1,
    cssWithMedia: 0,
    transition: 1,
    waapi: 1,
    classes: ['CSSAnimation', 'CSSTransition', 'Animation'],
  },
  /** То же с глобальным правилом `.001ms !important`, через 100 мс после старта. */
  reducedGlobal: { css: 0, transition: 0, waapi: { playState: 'running', duration: 1000 }, rafFrames: 10 },
};

/** Строка таблицы свойств по подписи — индексы при добавлении свойств сдвигаются. */
export const prop = (label: string) => {
  const row = STAND.props.find((r) => r.label === label);
  if (!row) throw new Error(`в STAND.props нет «${label}»`);
  return row;
};

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'главный поток (main thread)',
    d: 'Поток вкладки, где выполняется ваш JavaScript и где браузер считает стили, раскладку и рисует. Пока там крутится долгая задача, ничего из этого не происходит.',
  },
  {
    k: 'композитор (compositor)',
    d: 'Отдельный поток, который собирает кадр из готовых слоёв: сдвигает их, поворачивает, меняет прозрачность. Главному потоку он не ждёт.',
  },
  {
    k: 'слой (layer)',
    d: 'Кусок страницы, нарисованный отдельной картинкой. Композитор умеет двигать её целиком, не перерисовывая содержимое.',
  },
  {
    k: 'композитная анимация',
    d: 'Анимация, которую браузер целиком отдал композитору: ключевые кадры, длительность, кривую. Промежуточные значения считает композитор, главный поток в этом не участвует.',
  },
  {
    k: 'ключевые кадры (keyframes)',
    d: 'Значения свойства в опорных точках анимации: «в начале `translateX(0)`, в конце `translateX(300px)`». Всё между ними браузер считает сам.',
  },
  {
    k: 'Web Animations API (WAAPI)',
    d: 'JS-интерфейс к тому же механизму, что и CSS-анимации: `element.animate(keyframes, options)` возвращает объект `Animation` с `pause()`, `reverse()` и промисом `finished`.',
  },
  {
    k: '`LayoutCount`, `RecalcStyleCount`',
    d: 'Счётчики из протокола отладчика Chromium (`Performance.getMetrics`): сколько раз с начала жизни страницы браузер считал раскладку и стили. Не время, а число раз.',
  },
];

export const PLAIN_COMPOSITED =
  'Как оркестр с нотами. Если дирижёр заранее раздал партитуру — все ноты, темп, длительность, — оркестр доиграет, даже если дирижёра срочно позвали к телефону. Это композитная анимация: композитор получил ключевые кадры и длительность и считает каждый кадр сам. Анимация через `requestAnimationFrame` — дирижёр, который показывает каждую долю рукой: отвлёкся — музыка встала.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем. Базовую картину слоёв и композитора она не повторяет, а продолжает.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' | 'warn' }[] = [
  {
    t: 'Шаги кадра',
    d: 'Между двумя обновлениями экрана браузер делает style → layout → paint → composite. Первые три идут на главном потоке, последний — уже без него. Дорогая анимация та, что запускает ранние шаги на каждом кадре.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Что такое слой и зачем `will-change`',
    d: 'Слой — отдельная картинка, которую композитор двигает без перерисовки. `will-change` просит слой заранее, ценой памяти и нового контекста наложения.',
    href: '/render/render-pipeline/#s4',
    hrefLabel: '«Кадр браузера», раздел «Что дешевле двигать»',
    tone: 'info',
  },
  {
    t: 'Главный поток и поток композитора',
    d: 'У вкладки один главный поток на процесс и отдельный поток композитора. Поэтому зависший JS останавливает одно и не трогает другое.',
    href: '/js/browser-architecture/#s3',
    hrefLabel: '«Устройство браузера», раздел «Потоки»',
    tone: 'info',
  },
  {
    t: 'Долгая задача',
    d: 'Цикл событий не берёт следующую работу, пока не закончилась текущая. Синхронный цикл на секунду — это секунда без кадров главного потока.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Оборот»',
    tone: 'warn',
  },
];

// ─── Раздел 1. Цена свойства ──────────────────────────────────────────────────────────────

const yes = (n: number) => (n >= STAND.fps / 2 ? `да, +${n}` : `нет, +${n}`);

/** Таблица «свойство → работа на кадр» — строки собраны из литерала стенда, а не набраны. */
export const PROP_ROWS: string[][] = STAND.props.map((r) => [
  `\`${r.label}\``,
  r.compositeFailed ? 'нет' : '**да**',
  yes(r.style),
  yes(r.layout),
  r.paint > STAND.fps ? `да, ${r.paint}` : `нет, ${r.paint}`,
]);
export const PROP_TONES: ('ok' | 'warn' | 'err')[] = STAND.props.map((r) =>
  !r.compositeFailed ? 'ok' : r.layout >= STAND.fps / 2 ? 'err' : 'warn',
);

export const PROP_NOTE =
  'Числа — за одну секунду анимации при 60 кадрах в секунду. «Да, +60» значит «на каждом кадре». У композитных анимаций за всю секунду ноль пересчётов стиля и ноль раскладок: главный поток про анимацию просто не вспоминает. События `Paint` у них — единицы за весь прогон: это первая отрисовка, а не кадры анимации.';

export const PROP_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Набор шире, чем «transform и opacity»',
    d: 'В Chromium 153 на композитор ушли ещё `filter`, `background-color` и `clip-path`. `translate`, `rotate`, `scale` — отдельные свойства того же преобразования — тоже. Но это решение одного движка: правило «двигайте `transform` и `opacity`» переносится между браузерами, а цвет фона — нет.',
    tone: 'ok',
  },
  {
    t: '`filter` — смотря какой',
    d: '`brightness()` композитор взял, `blur()` — нет. Размытие выводит пиксели за край элемента, и Chromium отказывает с причиной `kFilterRelatedPropertyMayMovePixels`. Зато перерисовки нет и тут: главный поток каждый кадр пересчитывает стиль, а картинку размывает уже композитор.',
    tone: 'warn',
  },
  {
    t: 'Раскладка тянет за собой отрисовку',
    d: '`left`, `top`, `width`, `height`, отступы и `font-size` дали по 60 раскладок за секунду и вдвое больше событий `Paint`. Сдвиг в раскладке меняет «где», а значит, картинку приходится рисовать заново.',
    tone: 'err',
  },
  {
    t: 'Без раскладки, но с отрисовкой',
    d: '`box-shadow`, `color`, `border-radius` геометрию не трогают — раскладок ноль. Но каждый кадр — новый стиль и новая отрисовка. Цена отрисовки растёт с площадью: тень на весь экран дороже тени на кнопке.',
    tone: 'warn',
  },
];

export const FAIL_ROWS: string[][] = [
  ['8192', '`kUnsupportedCSSProperty`', 'Свойство не из списка, который композитор умеет считать. Рядом трассировка называет его: `unsupportedProperties: ["box-shadow"]`.'],
  ['32', '`kTargetHasInvalidCompositingState`', 'У элемента нет слоя, который композитор мог бы двигать. `8224` у `left` — это 8192 + 32.'],
  ['4096', '`kFilterRelatedPropertyMayMovePixels`', 'Фильтр выводит пиксели за границу элемента: `blur()`, `drop-shadow()`.'],
];

export const FAIL_NOTE =
  'Отказ записан в трассировке: событие `Animation` с полем `compositeFailed` — это битовая маска причин. Если поля нет, анимация ушла на композитор. Имена битов — из исходника Chromium, перечисление `FailureReason` в `compositor_animations.h`. Это внутренние имена: от версии к версии они меняются.';

// ─── Раздел 2. Одна анимация — одно решение ───────────────────────────────────────────────

export const MIX_ROWS: string[][] = [
  ['одни `@keyframes`: `transform` + `box-shadow`', '`transform` **встал** вместе с тенью', 'Анимация уходит на композитор целиком или не уходит вовсе. Одно неподходящее свойство держит на главном потоке и `transform`.'],
  ['две анимации: `transform` и отдельно `box-shadow`', '`transform` идёт', 'Каждая анимация решается сама. Тень по-прежнему стоит кадру отрисовки, но сдвиг ей не мешает.'],
  ['`transition: transform .3s, box-shadow .3s`', '`transform` идёт', 'Переход на два свойства — это два объекта `CSSTransition`, по одному на свойство. То есть две анимации, а не одна.'],
  ['`box-shadow` в `@keyframes`, но одинаковый в начале и в конце', 'на композиторе', 'Свойство, которое не меняется, браузер в расчёт не берёт: отказа нет, трассировка молчит.'],
];

export const FRAME_PLAN_CODE = `// Что Chromium 153 анимирует на композиторе — снято стендом темы.
const ON_COMPOSITOR = ['transform', 'translate', 'rotate', 'scale',
  'opacity', 'filter', 'background-color', 'clip-path'];
// От этих свойств зависит геометрия: их смена — новая раскладка.
const GEOMETRY = ['left', 'top', 'width', 'height',
  'margin-left', 'padding-left', 'font-size'];
// Эти меняют готовую картинку целиком, без перерисовки.
const EFFECTS = ['transform', 'translate', 'rotate', 'scale', 'opacity', 'filter'];

// Фильтр, который выводит пиксели за край, композитор не берёт.
const movesPixels = (value) => /blur|drop-shadow/.test(value);

function compositable(prop, [from, to]) {
  if (!ON_COMPOSITOR.includes(prop)) return false;
  if (prop === 'filter') return !movesPixels(from) && !movesPixels(to);
  return true;
}

// animation: { by: 'css' | 'waapi' | 'raf', keyframes: { свойство: [from, to] } }
function planAnimation({ by, keyframes }) {
  // Свойство, которое не меняется, браузер в расчёт не берёт.
  const props = Object.keys(keyframes)
    .filter((p) => keyframes[p][0] !== keyframes[p][1]);
  const blockers = by === 'raf'
    ? ['requestAnimationFrame']      // значение считает ваш JS
    : props.filter((p) => !compositable(p, keyframes[p]));
  if (blockers.length === 0) {
    return { props, thread: 'compositor', blockers,
      style: false, layout: false, paint: false };
  }
  // Одно неподходящее свойство — и на главном потоке вся анимация.
  return {
    props, thread: 'main', blockers,
    style: true,
    layout: props.some((p) => GEOMETRY.includes(p)),
    paint: props.some((p) => !EFFECTS.includes(p)),
  };
}

// Анимации элемента решаются каждая сама; кадр платит за все сразу.
function framePlan(animations) {
  const plans = animations.map(planAnimation);
  const any = (key) => plans.some((plan) => plan[key]);
  return { plans, style: any('style'), layout: any('layout'),
    paint: any('paint'), composite: plans.length > 0 };
}`;

export const FRAME_PLAN_NOTE =
  'Функция отвечает на два вопроса: на каком потоке считается каждая анимация и какие шаги кадра она запускает. Списки свойств — не из спецификации, а из стенда: свойство попадало в `ON_COMPOSITOR`, только если за секунду его анимации Chromium не пересчитал стиль ни разу. Свойства из `EFFECTS` даже на главном потоке не требуют перерисовки: `transform` в `requestAnimationFrame` дал 60 пересчётов стиля и ни одной лишней отрисовки.';

const kf = (keyframes: Record<string, [string, string]>, by: AnimSpec['by'] = 'css'): AnimSpec => ({ by, keyframes });

export const DEMO_CASES: AnimCase[] = [
  {
    id: 'transform',
    label: 'transform',
    code: `@keyframes move {
  to { transform: translateX(300px); }
}
.box { animation: move 1s infinite alternate; }`,
    animations: [kf({ transform: ['translateX(0)', 'translateX(300px)'] })],
    chromium: prop('transform'),
    movedWhileBlocked: STAND.block.moved['css-transform'],
    note: 'Эталон: за секунду ни одного пересчёта стиля. Композитор получил ключевые кадры и двигает готовый слой сам.',
  },
  {
    id: 'opacity',
    label: 'opacity',
    code: `@keyframes fade {
  to { opacity: 0.2; }
}
.box { animation: fade 1s infinite alternate; }`,
    animations: [kf({ opacity: ['1', '0.2'] })],
    chromium: prop('opacity'),
    movedWhileBlocked: STAND.block.moved['css-opacity'],
    note: 'Прозрачность композитор применяет к слою при сборке кадра — картинку перерисовывать не нужно.',
  },
  {
    id: 'brightness',
    label: 'filter: brightness()',
    code: `@keyframes dim {
  to { filter: brightness(0); }
}
.box { animation: dim 1s infinite alternate; }`,
    animations: [kf({ filter: ['brightness(1)', 'brightness(0)'] })],
    chromium: prop('filter: brightness()'),
    movedWhileBlocked: STAND.block.moved['filter-brightness'],
    note: 'Яркость меняет каждый пиксель на месте и за край не выходит — фильтр такого рода композитор берёт.',
  },
  {
    id: 'blur',
    label: 'filter: blur()',
    code: `@keyframes soften {
  to { filter: blur(8px); }
}
.box { animation: soften 1s infinite alternate; }`,
    animations: [kf({ filter: ['blur(0px)', 'blur(8px)'] })],
    chromium: prop('filter: blur()'),
    movedWhileBlocked: STAND.block.moved['filter-blur'],
    note: 'То же свойство, другой фильтр — и отказ: размытие выводит пиксели за край. Стиль считается каждый кадр, а при занятом потоке размытие замирает.',
  },
  {
    id: 'bg',
    label: 'background-color',
    code: `@keyframes flash {
  to { background-color: blue; }
}
.box { animation: flash 1s infinite alternate; }`,
    animations: [kf({ 'background-color': ['red', 'blue'] })],
    chromium: prop('background-color'),
    movedWhileBlocked: STAND.block.moved['css-background-color'],
    note: 'В Chromium 153 цвет фона анимируется без главного потока — и при этом без своего слоя. В других движках это не проверялось.',
  },
  {
    id: 'clip',
    label: 'clip-path',
    code: `@keyframes crop {
  to { clip-path: inset(30px); }
}
.box { animation: crop 1s infinite alternate; }`,
    animations: [kf({ 'clip-path': ['inset(0px)', 'inset(30px)'] })],
    chromium: prop('clip-path'),
    movedWhileBlocked: STAND.block.moved['css-clip-path'],
    note: 'Ещё одно свойство, которое Chromium 153 считает на композиторе. Слоя элементу оно тоже не даёт.',
  },
  {
    id: 'left',
    label: 'left',
    code: `@keyframes slide {
  to { left: 300px; }
}
.box { position: relative; animation: slide 1s infinite alternate; }`,
    animations: [kf({ left: ['0px', '300px'] })],
    chromium: prop('left'),
    movedWhileBlocked: STAND.block.moved['css-left'],
    note: 'Полная цена каждый кадр: стиль, раскладка, отрисовка. Поток занят — блок стоит.',
  },
  {
    id: 'shadow',
    label: 'box-shadow',
    code: `@keyframes glow {
  to { box-shadow: 0 0 30px red; }
}
.box { animation: glow 1s infinite alternate; }`,
    animations: [kf({ 'box-shadow': ['0 0 0 red', '0 0 30px red'] })],
    chromium: prop('box-shadow'),
    movedWhileBlocked: STAND.block.moved['css-box-shadow'],
    note: 'Раскладка не нужна, отрисовка — каждый кадр. Чем больше тень, тем больше пикселей перерисовывать.',
  },
  {
    id: 'mixed',
    label: 'transform + box-shadow',
    code: `@keyframes lift {
  to { transform: translateY(-8px); box-shadow: 0 0 20px red; }
}
.box { animation: lift 1s infinite alternate; }`,
    animations: [kf({ transform: ['none', 'translateY(-8px)'], 'box-shadow': ['0 0 0 red', '0 0 20px red'] })],
    chromium: STAND.drivers['one keyframes transform+box-shadow'],
    movedWhileBlocked: STAND.block.moved['transform+box-shadow'],
    note: 'Одни ключевые кадры — одно решение. Тень не пустила на композитор и сдвиг: при занятом потоке стоят оба.',
  },
  {
    id: 'split',
    label: 'две анимации',
    code: `@keyframes rise {
  to { transform: translateY(-8px); }
}
@keyframes glow {
  to { box-shadow: 0 0 20px red; }
}
.box { animation: rise 1s infinite alternate,
                  glow 1s infinite alternate; }`,
    animations: [kf({ transform: ['none', 'translateY(-8px)'] }), kf({ 'box-shadow': ['0 0 0 red', '0 0 20px red'] })],
    chromium: STAND.drivers['two animations transform, box-shadow'],
    movedWhileBlocked: STAND.block.moved['transform, box-shadow отдельно'],
    note: 'Те же свойства, разнесённые по двум анимациям. Тень по-прежнему стоит отрисовки на каждом кадре, но сдвиг ушёл на композитор и при занятом потоке едет.',
  },
  {
    id: 'raf',
    label: 'transform в rAF',
    code: `let x = 0;
function step() {
  box.style.transform = \`translateX(\${x++}px)\`;
  requestAnimationFrame(step);
}
requestAnimationFrame(step);`,
    animations: [kf({ transform: ['translateX(0)', 'translateX(300px)'] }, 'raf')],
    chromium: STAND.drivers['raf transform'],
    movedWhileBlocked: STAND.block.moved['raf-transform'],
    note: 'Свойство то же, что в эталоне, а исполнитель другой: значение на каждый кадр пишет ваш JS. Раскладки и лишней отрисовки нет, стиль — каждый кадр, а при занятом потоке движение встаёт.',
  },
];

export const DEMO_CAPTION =
  'Шаги кадра считает функция `framePlan` выше, счётчики рядом — снятые в Chromium 153 на том же коде. Кнопка «занять поток» запускает в вашей вкладке цикл `while` на секунду. Живой блок запускается через `element.animate` с теми же ключевыми кадрами: CSS-анимация и `element.animate` решаются одинаково. Сценарий с `requestAnimationFrame` идёт настоящим циклом rAF.';

export const DEMO_REDUCED =
  'В системе включено «уменьшить движение» — живой блок не запускается. Шаги кадра и замеры Chromium работают как обычно.';

// ─── Раздел 3. Занятый поток ──────────────────────────────────────────────────────────────

export const BLOCK_ROWS: { k: string; id: string; how: string }[] = [
  { k: 'CSS-анимация `transform`', id: 'css-transform', how: 'положение' },
  { k: '`element.animate` по `transform`', id: 'waapi-transform', how: 'положение' },
  { k: '`transition` по `transform`', id: 'transition-transform', how: 'положение' },
  { k: '`transition` по `transform` и `box-shadow`', id: 'transition transform, box-shadow', how: 'положение' },
  { k: 'две анимации: `transform` и `box-shadow`', id: 'transform, box-shadow отдельно', how: 'положение' },
  { k: 'CSS-анимация `opacity`', id: 'css-opacity', how: 'яркость пикселя' },
  { k: 'CSS-анимация `background-color`', id: 'css-background-color', how: 'цвет пикселя' },
  { k: 'CSS-анимация `filter: brightness()`', id: 'filter-brightness', how: 'цвет пикселя' },
  { k: 'CSS-анимация `clip-path`', id: 'css-clip-path', how: 'пиксель у края' },
  { k: 'одни `@keyframes`: `transform` + `box-shadow`', id: 'transform+box-shadow', how: 'положение' },
  { k: 'CSS-анимация `left`', id: 'css-left', how: 'положение' },
  { k: '`element.animate` по `left`', id: 'waapi-left', how: 'положение' },
  { k: '`transform` в `requestAnimationFrame`', id: 'raf-transform', how: 'положение' },
  { k: 'CSS-анимация `filter: blur()`', id: 'filter-blur', how: 'пиксель за краем' },
  { k: 'CSS-анимация `box-shadow`', id: 'css-box-shadow', how: 'пиксель за краем' },
];

export const BLOCK_NOTE = `Пятнадцать полос на одной странице, главный поток занят циклом \`while\` на ${STAND.block.blockMs} мс. Кадры снимал скринкаст протокола отладчика — он получает их от композитора и во время цикла: за секунду пришло ${STAND.block.framesDuring}. Полоса «двигалась», если в этих кадрах у неё было больше одного положения или цвета. После цикла пошли все.`;

export const BLOCK_STYLE_FACT =
  'Композитной анимации главный поток не нужен — но если он всё равно рисует кадры, Chromium заодно обновляет её стиль. Стенд: CSS-анимация `transform` одна — 0 пересчётов стиля за секунду; та же анимация рядом с пустым циклом `requestAnimationFrame` — 60. Сам цикл без анимации — 0. Значит, «композитная» описывает, кто двигает картинку, а не обещает, что главный поток про анимацию забыл. Если на странице крутится rAF (игровой цикл, график, библиотека плавной прокрутки), каждая композитная анимация добавит ему по пересчёту стиля на кадр.';

// ─── Раздел 4. CSS, WAAPI, rAF ────────────────────────────────────────────────────────────

export const DRIVER_ROWS: string[][] = [
  ['`transition`', 'браузер, по старому и новому значению', '`CSSTransition`, по объекту на свойство', 'да, если свойство подходит'],
  ['`@keyframes` + `animation`', 'браузер, по ключевым кадрам', '`CSSAnimation`', 'да, если подходят все свойства'],
  ['`element.animate()`', 'браузер, по ключевым кадрам из JS', '`Animation` (в протоколе отладчика — `WebAnimation`)', 'да, на тех же условиях'],
  ['`requestAnimationFrame`', '**ваш JS**, на каждый кадр', 'нет — браузер видит только запись в `style`', 'нет никогда'],
];

export const DRIVER_NOTE =
  'Три первых способа — один механизм. Браузер знает траекторию заранее, поэтому может отдать её композитору, показать в панели Animations DevTools и вернуть из `document.getAnimations()`. С `requestAnimationFrame` браузер видит только поток присваиваний `style.transform = …`: анимации как объекта нет, и слоя у элемента тоже нет — стенд `LayerTree` насчитал один корневой слой.';

export const WAAPI_CODE = `const anim = card.animate(
  [
    { transform: 'translateY(8px)', opacity: 0 },
    { transform: 'none', opacity: 1 },
  ],
  { duration: 200, easing: 'ease-out' },
);
anim.finished.then(() => card.classList.add('shown'));`;

export const WAAPI_NOTE =
  'Ключевые кадры здесь только из `transform` и `opacity` — анимация целиком уходит на композитор, как CSS-анимация. Преимущество перед CSS — объект в руках: `anim.pause()`, `anim.reverse()`, `anim.currentTime`, промис `finished`, и не нужно заводить класс и ждать `animationend`.';

export const RAF_CODE = `let x = 0;
let target = 0;
addEventListener('pointermove', (e) => { target = e.clientX; });

function tick() {
  x += (target - x) * 0.2;   // каждый кадр — пятая часть оставшегося пути
  dot.style.transform = \`translateX(\${x}px)\`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);`;

export const RAF_NOTE =
  'Где `requestAnimationFrame` честно нужен: цель меняется каждый кадр, и траекторию нельзя объявить заранее. Здесь точка догоняет указатель — после десяти кадров она прошла 89% пути (1 − 0.8¹⁰). Раскладки нет, перерисовки нет, но значение считает главный поток, и при занятом потоке точка встаёт. Если цель известна заранее — это работа для `element.animate`.';

// ─── Раздел 5. Слои ───────────────────────────────────────────────────────────────────────

export const PLAIN_SQUASH =
  'Как стопка калек на световом столе. Каждая анимация с `will-change` требует своей кальки — её можно двигать отдельно. Обычные карточки, которые лежат поверх движущейся кальки, браузер не может оставить на нижнем листе — они окажутся под ней. Поэтому он рисует их все на одной общей кальке сверху: одна калька на сто карточек, а не сто калек.';

const k = (key: string) => STAND.layers[key];

export const LAYER_ROWS: string[][] = [
  'transform: translateX(10px)',
  'transform: translateZ(0)',
  'will-change: transform',
  'идёт анимация transform',
  'идёт анимация opacity',
  'идёт анимация filter: blur()',
  'идёт анимация transform + box-shadow (одни keyframes)',
  'идёт анимация background-color',
  'идёт анимация clip-path',
  'transform в rAF',
  'position: fixed',
].map((key) => {
  const r = k(key);
  const own = Object.keys(r.reasons).filter((x) => x !== 'RootScroller' && x !== 'OverflowScrolling');
  return [key, r.count > 1 ? '**слой**' : 'нет', own.length ? own.map((x) => `\`${x}\``).join(', ') : '—'];
});

export const LAYER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Свой слой и композитная анимация — разные вещи',
    d: 'Анимация `filter: blur()` идёт на главном потоке, а слой получила (`ActiveFilterAnimation`). Анимации `background-color` и `clip-path` идут на композиторе — а своего слоя у элемента нет. Слой выдаётся за то, **что** анимируется (преобразование, прозрачность, фильтр), а не за то, где считается.',
    tone: 'warn',
  },
  {
    t: 'Слой анимации живёт ровно столько, сколько анимация',
    d: `\`LayerTree\`: до \`element.animate\` — ${STAND.layerLifetime.before} слой, во время — ${STAND.layerLifetime.during}, после \`finished\` — снова ${STAND.layerLifetime.after}. Поэтому \`will-change\` для коротких анимаций по \`transform\` и \`opacity\` не нужен: слой появится сам и сам уйдёт.`,
    tone: 'ok',
  },
  {
    t: '`translateZ(0)` — слой без названной причины',
    d: 'Старый приём «включить аппаратное ускорение» работает: слой есть. Но в списке `compositingReasons` у него пусто, а `will-change` оставляет внятную причину, которую видно в DevTools.',
  },
];

const bytesOf = (w: number, h: number, n = 1, dpr = 1) => w * h * dpr * dpr * 4 * n;
const [cw, ch] = STAND.layerSizes.card;
const [sw, sh] = STAND.layerSizes.squashed;

export const LAYER_COST = {
  cards: bytesOf(cw, ch, 100),
  cardsDpr2: bytesOf(cw, ch, 100, 2),
  squashed: bytesOf(sw, sh),
};

export const EXPLOSION_ROWS: string[][] = [
  ['100 обычных карточек', String(k('100 карточек').count), '—'],
  ['100 карточек с `will-change: transform`', String(k('100 карточек с will-change').count), `${LAYER_COST.cards.toLocaleString('ru-RU')} байт на карточки; при DPR 2 — ${LAYER_COST.cardsDpr2.toLocaleString('ru-RU')}`],
  ['100 обычных карточек поверх идущей анимации', String(k('100 карточек поверх анимации').count), `один общий слой ${sw}×${sh} — ${LAYER_COST.squashed.toLocaleString('ru-RU')} байт`],
  ['100 карточек с `will-change` поверх анимации', String(k('100 карточек с will-change поверх анимации').count), 'объявленные слои не склеиваются'],
];

export const EXPLOSION_NOTE =
  'Число слоёв — вместе с корневым слоем прокрутки, байты — арифметика «ширина × высота × DPR² × 4» по размерам, которые отдал `LayerTree`. Обратите внимание на третью строку: склеенный слой один, но размером почти с окно, и по байтам он больше ста маленьких. Счёт слоёв — не счёт памяти. Цену «взрыва» делает другое: каждый слой композитор держит, растеризует и собирает в кадр отдельно, и `will-change` на сотне элементов — это сотня таких забот, даже когда ничего не движется.';

export const LAYER_CODE = `// Свойства, анимация которых даёт элементу слой на время анимации.
const LAYER_BY_ANIMATION = {
  transform: 'ActiveTransformAnimation', translate: 'ActiveTransformAnimation',
  rotate: 'ActiveTransformAnimation', scale: 'ActiveTransformAnimation',
  opacity: 'ActiveOpacityAnimation', filter: 'ActiveFilterAnimation',
};

// el: { willChange, transform, animations, position, overLayer }
function ownLayer(el) {
  const willChange = el.willChange ?? [];
  if (willChange.includes('transform')) return { layer: true, reason: 'WillChangeTransform' };
  if (willChange.includes('opacity')) return { layer: true, reason: 'WillChangeOpacity' };
  // 3D-преобразование: слой есть, а причина в списке не названа.
  if (/translateZ|translate3d|rotate[XY]|perspective/.test(el.transform ?? '')) {
    return { layer: true, reason: null };
  }
  for (const animation of el.animations ?? []) {
    if (animation.by === 'raf') continue;   // для браузера это не анимация
    for (const p of planAnimation(animation).props) {
      if (LAYER_BY_ANIMATION[p]) return { layer: true, reason: LAYER_BY_ANIMATION[p] };
    }
  }
  // Не едет со страницей — значит, лежит поверх прокручиваемого слоя.
  if (el.position === 'fixed') return { layer: true, reason: 'Overlap' };
  // Нарисован поверх чужого слоя и перекрывает его.
  if (el.overLayer) return { layer: true, reason: 'Overlap' };
  return { layer: false, reason: null };
}

function countLayers(elements) {
  let count = 1;                                       // корневой слой прокрутки
  const reasons = { RootScroller: 1, OverflowScrolling: 1 };
  let squashed = false;
  for (const el of elements) {
    const { layer, reason } = ownLayer(el);
    if (!layer) continue;
    // Неявные слои соседей склеиваются в один; объявленные — никогда.
    if (el.overLayer && reason === 'Overlap') {
      if (squashed) continue;
      squashed = true;
    }
    count += 1;
    const key = reason ?? '(пусто)';
    reasons[key] = (reasons[key] ?? 0) + 1;
  }
  return { count, reasons };
}`;

export const LAYER_CODE_NOTE =
  'Это не алгоритм Chromium, а его поведение на снятых случаях, записанное правилами. Склейка в настоящем движке условна: соседи склеиваются, если лежат подряд в порядке отрисовки и не мешают друг другу. На стенде сто карточек поверх анимации склеились в один слой при любом из пробованных стилей — `opacity`, `overflow: hidden`, `z-index`, `filter`, `clip-path`, `isolation`; не склеил их только `will-change`.';

const cards = (n: number, el: LayerScene['elements'][number]) => Array.from({ length: n }, () => ({ ...el }));
const animated: LayerScene['elements'][number] = { animations: [{ by: 'css', keyframes: { transform: ['none', 'translateX(300px)'] } }] };

export const LAYER_SCENES: LayerScene[] = [
  {
    id: 'cards',
    label: '100 карточек',
    elements: cards(100, {}),
    chromium: k('100 карточек'),
    note: 'Сто обычных карточек рисуются в корневой слой. Слой один, причины только у корня.',
  },
  {
    id: 'wc',
    label: '+ will-change',
    elements: cards(100, { willChange: ['transform'] }),
    chromium: k('100 карточек с will-change'),
    note: 'Каждой карточке — свой слой: `will-change` просит слой явно, и браузер не склеивает объявленное.',
  },
  {
    id: 'over',
    label: 'поверх анимации',
    elements: [animated, ...cards(100, { overLayer: true })],
    chromium: k('100 карточек поверх анимации'),
    note: 'Под карточками едет большой блок со своим слоем. Карточки нельзя оставить в корне — окажутся под ним. Браузер выдаёт им слой с причиной `Overlap`, но один на всех: склейка.',
  },
  {
    id: 'wc-over',
    label: 'will-change поверх анимации',
    elements: [animated, ...cards(100, { willChange: ['transform'], overLayer: true })],
    chromium: k('100 карточек с will-change поверх анимации'),
    note: 'Классический «взрыв»: анимация внизу и `will-change` на карточках над ней. Склеивать нечего — каждый слой объявлен.',
  },
  {
    id: 'fixed',
    label: 'position: fixed',
    elements: [{ position: 'fixed' }],
    chromium: k('position: fixed'),
    note: 'Фиксированный блок не едет вместе со страницей, значит, лежит поверх прокручиваемого слоя — и получает свой с причиной `Overlap`.',
  },
  {
    id: 'raf',
    label: 'transform в rAF',
    elements: [{ transform: 'translateX(10px)', animations: [{ by: 'raf', keyframes: { transform: ['translateX(0)', 'translateX(300px)'] } }] }],
    chromium: k('transform в rAF'),
    note: 'Блок, который двигает `requestAnimationFrame`. Для браузера это просто новое значение стиля каждый кадр — слоя нет.',
  },
];

export const LAYER_DEMO_CAPTION =
  'Число слоёв и причины считает `countLayers` выше, рядом — что снял `LayerTree` в Chromium 153 на такой же странице. Байты — арифметика по размерам слоёв при DPR 1, вместе с корневым слоем 800×600.';

// ─── Раздел 6. Меньше движения ────────────────────────────────────────────────────────────

export const REDUCED_CSS = `.toast { transition: transform .2s ease-out, opacity .2s; }
.toast.hidden { transform: translateY(100%); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  /* без сдвига — только проявление */
  .toast { transition: opacity .2s; }
  .toast.hidden { transform: none; }
}`;

export const REDUCED_CODE = `const reduce = matchMedia('(prefers-reduced-motion: reduce)');

function show(card) {
  return card.animate(
    reduce.matches
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    { duration: 200, easing: 'ease-out' },
  );
}`;

export const REDUCED_ROWS: string[][] = [
  ['CSS-анимация без `@media`', `идёт: анимаций у элемента — ${STAND.reduced.cssWithoutMedia}`, `гасится: ${STAND.reducedGlobal.css}`],
  ['CSS-анимация с `@media (prefers-reduced-motion: reduce)`', `не запущена: ${STAND.reduced.cssWithMedia}`, '—'],
  ['`transition`', `идёт: ${STAND.reduced.transition}`, `гасится: ${STAND.reducedGlobal.transition}`],
  ['`element.animate()`', `идёт: ${STAND.reduced.waapi}`, `**идёт**: \`${STAND.reducedGlobal.waapi.playState}\`, длительность ${STAND.reducedGlobal.waapi.duration} мс`],
  ['`requestAnimationFrame`', 'идёт', `**идёт**: ${STAND.reducedGlobal.rafFrames} кадров из ${STAND.reducedGlobal.rafFrames}`],
];

export const REDUCED_NOTE =
  'Браузер сам не гасит ни один способ: при включённой настройке все анимации на месте. Глобальное правило с `!important` (на этом сайте оно лежит в общих стилях) сжимает CSS-анимации и переходы до 0.001 мс — но `element.animate()` и `requestAnimationFrame` это правило не видят: у них длительность задана в JS. Значит, в JS-анимациях настройку проверяют сами, через `matchMedia`.';

export const REDUCED_FACT =
  '«Меньше движения» не значит «никакой анимации». Просьба — убрать перемещение, масштаб, параллакс, то есть то, что укачивает. Проявление по прозрачности обычно остаётся: оно сообщает, что состояние сменилось, и никуда не едет. Тот же вывод для переходов между состояниями — в [«View Transitions», раздел «Меньше движения»](/render/view-transitions/#s6).';

// ─── Тонкие места ─────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Одно свойство в `@keyframes` держит на главном потоке всю анимацию',
    d: '`transform` и `box-shadow` в одних ключевых кадрах: при занятом потоке стоит и сдвиг. Разнесите их по двум анимациям — сдвиг уйдёт на композитор. `transition` на два свойства уже даёт две анимации.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`filter` бывает композитным, а бывает нет',
    d: '`brightness()`, `grayscale()` и подобные фильтры, которые меняют пиксель на месте, композитор берёт. `blur()` и `drop-shadow()` — нет: они выводят пиксели за край. Проверять по трассировке: `compositeFailed` 4096.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`background-color` и `clip-path` композитны только в Chromium',
    d: 'Это решение движка, а не спецификации. Код, который опирается на «цвет фона не нагружает главный поток», в другом браузере может вести себя иначе: другие движки стенд не проверял.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Композитная анимация рядом с циклом rAF всё-таки нагружает главный поток',
    d: 'Без rAF — ноль пересчётов стиля в секунду, с пустым циклом rAF рядом — шестьдесят. Если главный поток всё равно рисует кадры, Chromium обновляет на них и стиль композитной анимации.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Слой не значит «на композиторе»',
    d: 'Анимация `blur()` получила слой и при этом считается на главном потоке. Анимация `background-color` идёт на композиторе без своего слоя. По панели Layers не понять, композитна ли анимация, — для этого есть трассировка и панель Animations.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`will-change` для `element.animate` по `transform` лишний',
    d: 'Слой появляется со стартом анимации и пропадает после `finished`. Постоянный `will-change` держит слой всегда — и на сотне карточек даёт сотню слоёв, которые браузер не склеит.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Глобальное правило `prefers-reduced-motion` не трогает JS-анимации',
    d: '`animation-duration: .001ms !important` гасит CSS-анимации и переходы. `element.animate()` и `requestAnimationFrame` продолжают двигать: их длительность в JS. Там проверяют `matchMedia(\'(prefers-reduced-motion: reduce)\')` сами.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Неизменное свойство в ключевых кадрах не мешает',
    d: 'Если `box-shadow` одинаков в начале и в конце, Chromium его не учитывает, и анимация остаётся на композиторе. Отказ трассировка пишет только за свойство, которое действительно меняется.',
  },
  {
    n: '09',
    t: 'Счётчик — не секундомер',
    d: '`LayoutCount` и `RecalcStyleCount` говорят, сколько раз шаг случился, а не сколько он длился. 60 раскладок маленького блока могут занять меньше одной раскладки большой таблицы. Счётчик отвечает на вопрос «запускает ли анимация этот шаг на каждом кадре», а цену меряет панель Performance.',
  },
];

// ─── Источники ────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Web Animations Level 1',
    href: 'https://www.w3.org/TR/web-animations-1/',
    what: 'модель анимации: `Animation`, эффекты, ключевые кадры, `finished`, `getAnimations()`',
  },
  {
    title: 'CSS Animations Level 1',
    href: 'https://www.w3.org/TR/css-animations-1/',
    what: '`@keyframes`, `animation-*`, объект `CSSAnimation`',
  },
  {
    title: 'CSS Transitions Level 1',
    href: 'https://www.w3.org/TR/css-transitions-1/',
    what: '`transition-*`; переход заводится на каждое свойство отдельно',
  },
  {
    title: 'Media Queries Level 5 — `prefers-reduced-motion`',
    href: 'https://www.w3.org/TR/mediaqueries-5/#prefers-reduced-motion',
    what: 'что означает настройка и какие значения у запроса',
  },
  {
    title: 'Chromium — compositor_animations.h',
    href: 'https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/core/animation/compositor_animations.h',
    what: 'перечисление `FailureReason`: имена битов `compositeFailed`',
  },
  {
    title: 'Chrome DevTools Protocol — LayerTree, Animation, Performance',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/LayerTree/',
    what: '`layerTreeDidChange`, `compositingReasons`; рядом домены `Animation` и `Performance` (`getMetrics`)',
  },
  {
    title: 'Chromium — How cc Works',
    href: 'https://chromium.googlesource.com/chromium/src/+/main/docs/how_cc_works.md',
    what: 'устройство композитора: слои, деревья свойств, анимации на потоке композитора',
  },
];

export const RELATED =
  'Смежное на сайте: [Кадр браузера, раздел «Что дешевле двигать»](/render/render-pipeline/#s4) — слои, `will-change`, перекрытие и анимации по прокрутке. [View Transitions, раздел «Меньше движения»](/render/view-transitions/#s6) — то же предпочтение для переходов между состояниями. [Критический путь и Web Vitals, раздел «INP»](/render/rendering-crp/#s4) — почему занятый главный поток бьёт по отклику. [Устройство браузера, раздел «Потоки»](/js/browser-architecture/#s3) — главный поток и поток композитора. [WebGL и конвейер GPU](/render/webgl/) — что происходит с картинкой после композитора. [Контекст наложения](/render/stacking/) — порядок отрисовки, почему не помогает `z-index: 9999` и верхний слой.';
