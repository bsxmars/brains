import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Face, Metrics, StandRun } from '@/widgets/font-display-lab/model/types';

/**
 * Данные темы «Шрифты и текст: от загрузки до пикселей».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63, `chromium.launch()`),
 * Node 24.11.0, macOS, октябрь 2026. Скрипты стенда — вне проекта, в рабочем каталоге автора
 * темы (`server.mjs`, `stand1-triggers.mjs` … `stand5-api.mjs`).
 *
 * Сервер — свой `node:http` на localhost. Он отдаёт страницы из памяти и woff2-файлы с
 * **искусственной задержкой**: `?delay=мс` в адресе шрифта. Задержка — параметр сервера, а не
 * замер сети; это не бенчмарк. Сервер записывает каждый запрос: путь, момент прихода,
 * заголовок `Sec-Fetch-Mode`. Каждый случай открывается в новом контексте браузера (пустой кеш).
 *
 * Шрифты — файлы самого сайта из `src/shared/styles/fonts/` (их правила — `fonts.css`):
 * Newsreader latin (`newsreader-normal-300-700-latin`, 131 848 байт, переменный, оси `wght`
 * и `opsz`, unitsPerEm 2000, ascent 1470, descent −530, lineGap 0) и IBM Plex Mono 400 —
 * подмножества latin (10 052 байта) и cyrillic (5 476 байт). Запасной — системная Georgia
 * macOS (unitsPerEm 2048, hhea 1878 / −449 / 0). Метрики прочитаны `fontkitten` 1.0.3,
 * диапазоны файлов — `fontace`. Диапазоны `unicode-range` в CSS стенда — те же, что в `fonts.css`
 * сайта (`U+0000-00FF, …` для latin и `U+0301, U+0400-045F, …` для cyrillic), семейство — как
 * `--serif` в `theme.ts`: `'Newsreader', Georgia, serif`.
 *
 * Что снято:
 *   — когда начинается загрузка (`TRIGGER_ROWS`): запросы, которые увидел сервер за 1,5 с;
 *   — фазы `font-display` (`STAND_RUNS`): страница с одним абзацем «Hamburgefonstiv» 40px,
 *     `font-family: Demo, Georgia`. Блок снимается через CDP `Page.captureScreenshot` много раз
 *     подряд (раз в ~30 мс), и каждый снимок сравнивается побайтно с тремя эталонами: пусто,
 *     Georgia, Newsreader. ⚠️ `page.screenshot()` Playwright сам ждёт `document.fonts.ready` —
 *     им фазу не увидеть, первый вариант стенда показывал «шрифт» с нулевой миллисекунды.
 *     Времена — от прихода запроса шрифта на сервер; точность — длительность одного снимка
 *     (~30 мс). При записи сюда начало первого отрезка приведено к 0, а конец — к 6000;
 *   — сдвиг при подмене (`CLS_ROWS`): колонка текста 18px, `font-display: swap`, задержка
 *     800 мс, сдвиги из `PerformanceObserver({ type: 'layout-shift', buffered: true })`,
 *     высоты и координаты — `getBoundingClientRect` до и после `document.fonts.ready`;
 *   — подмножества (`RANGE_RUNS`) и какие шрифты рисуют фразу — CDP
 *     `CSS.getPlatformFontsForNode` (`COURSE_GLYPHS`);
 *   — `preload` (`PRELOAD_ROWS`), `document.fonts` (`API_ROWS`), `measureText` (`SHAPING_ROWS`).
 *
 * `stand6-extra.mjs`: `measureText` до загрузки шрифта (`SHAPING_FACTS`) и новый промис `ready`
 * после новой загрузки (`API_ROWS`).
 *
 * Без проверки, только по документации: что шейпер Chromium — HarfBuzz; значения периодов
 * в спецификации CSS Fonts 4 и причина, по которой Chromium держит `auto` невидимым 2 секунды, а не 3, — стенд показывает
 * только сам факт. Как ведут себя Firefox и Safari, стенд не снимал.
 *
 * Тест `tests/unit/fonts-text.test.ts` прогоняет `FONT_DISPLAY_CODE`, `OVERRIDES_CODE`
 * и `RANGE_CODE` (те же строки, что на странице и в демо) против литералов стенда и
 * перечитывает метрики из файлов шрифтов `fontkitten`, когда файлы есть на диске.
 * Сам браузер в тесте не поднимается: стенд перезапускается руками, если сменится Chromium.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'веб-шрифт и `@font-face`',
    d: 'Шрифт, который страница приносит с собой файлом. Правило `@font-face` даёт ему имя для `font-family` и адрес файла. Само правило ничего не качает — это только объявление.',
  },
  {
    k: 'запасной шрифт (fallback)',
    d: 'Следующий шрифт в списке `font-family`, обычно системный. Им браузер рисует текст, пока веб-шрифта нет, и им же — буквы, которых в веб-шрифте нет вовсе.',
  },
  {
    k: 'период блокировки и период подмены',
    d: 'Два отрезка времени от начала загрузки. В период блокировки текст не видно, но место под него занято. В период подмены виден запасной шрифт, и пришедший веб-шрифт его заменит. После обоих периодов подмены уже не будет.',
  },
  {
    k: 'FOIT и FOUT',
    d: 'Flash of Invisible Text — текст сначала невидим, потом появляется. Flash of Unstyled Text — сначала виден запасной шрифт, потом его сменяет веб-шрифт. Какой из двух получит читатель, решает `font-display`.',
  },
  {
    k: 'метрики шрифта',
    d: 'Числа из файла: размер сетки (`unitsPerEm`), высота над базовой линией (ascent), глубина под ней (descent), межстрочный зазор (line gap) и ширина каждой буквы. Из них браузер складывает высоту строки и её длину.',
  },
  {
    k: 'шейпинг (shaping)',
    d: 'Шаг, на котором строка символов превращается в ряд глифов с координатами. Здесь применяются кернинг (сдвиг пар вроде «AV») и лигатуры (`fi` → один глиф). Поэтому ширина слова — не сумма ширин букв.',
  },
];

export const PLAIN_FONTS =
  'Как вывеска, которую заказали у художника. Пока её везут, на фасаде можно ничего не вешать — прохожие видят пустую стену, — или повесить временную табличку от руки. Привезли — вывеску меняют. Если табличка была другого размера, соседние витрины придётся двигать. `font-display` решает, что висит в ожидании и как долго ждут, а подгонка метрик — чтобы табличка была ровно того же размера.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из соседних тем и одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кадр: стили, раскладка, отрисовка',
    d: 'Браузер сначала вычисляет стили, потом считает геометрию (layout), потом рисует. Шрифт нужен уже раскладке: без его метрик не узнать, где перенести строку.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'CLS — метрика сдвигов',
    d: 'Сдвиг считается, когда видимый элемент меняет место между кадрами. Счёт — доля экрана, которую задело, умноженная на долю, на которую уехало.',
    href: '/render/rendering-crp/#s3',
    hrefLabel: '«Критический путь и Web Vitals», раздел «CLS»',
    tone: 'info',
  },
  {
    t: '`preload` и приоритеты загрузки',
    d: '`<link rel="preload">` просит скачать ресурс раньше, чем браузер сам до него дойдёт. Зачем `as` и `crossorigin` и почему без них файл качается дважды, — в теме про сеть.',
    href: '/platform/network/#s4',
    hrefLabel: '«Сеть и кеширование», раздел «Приоритеты загрузки»',
    tone: 'info',
  },
  {
    t: 'Единица `em` и сетка шрифта',
    d: 'Буквы в файле нарисованы на квадратной сетке, обычно 1000 или 2048 единиц (`unitsPerEm`). При `font-size: 18px` вся сетка — 18 пикселей, и любое число из файла переводится в пиксели одной пропорцией.',
    tone: 'info',
  },
];

// ─── Раздел 1. Когда шрифт качается ───────────────────────────────────────────────────────

export const LAZY_CODE = `@font-face {
  font-family: Demo;
  src: url(/fonts/newsreader-latin.woff2) format('woff2');
}

/* Запрос уйдёт только сейчас: элементу нужен Demo, и у него есть текст */
p { font-family: Demo, Georgia, serif; }`;

export const PLAIN_LAZY =
  'Как меню ресторана: в нём перечислены блюда, но повар начинает готовить, только когда кто-то заказал. `@font-face` — строчка в меню. Заказ — текст на странице, который нужно нарисовать этим шрифтом.';

/** Что увидел сервер стенда за 1,5 с после открытия страницы. Все запросы — `Sec-Fetch-Mode: cors`. */
export const TRIGGER_ROWS: { k: string; how: string; fetched: string; tone?: 'ok' | 'warn' }[] = [
  { k: '`@font-face` есть, ссылок нет', how: 'Правило объявлено, ни один элемент не называет `Demo`.', fetched: 'нет' },
  { k: 'элемент с текстом', how: '`<p>Hello</p>` с `font-family: Demo`.', fetched: '**да**', tone: 'ok' },
  { k: '`display: none`', how: 'Тот же абзац, но скрыт: в раскладку не попадает.', fetched: 'нет' },
  { k: '`visibility: hidden`', how: 'Абзац невидим, но место занимает — раскладка его считает.', fetched: '**да**', tone: 'warn' },
  { k: 'пустой элемент', how: '`<p></p>` с `font-family: Demo`: рисовать нечего.', fetched: 'нет' },
  { k: 'текст далеко внизу', how: 'Абзац на 5000 px ниже первого экрана.', fetched: '**да**', tone: 'warn' },
  { k: 'второй в списке', how: '`font-family: Georgia, Demo` — Georgia нашлась и покрыла все буквы.', fetched: 'нет' },
  { k: 'текст из `::before`', how: '`content: \'Hi\'` с `font-family: Demo` у псевдоэлемента.', fetched: '**да**', tone: 'ok' },
  { k: 'элемент вставлен позже', how: 'Скрипт добавил абзац с `Demo` через 800 мс.', fetched: '**да**, через 800 мс', tone: 'warn' },
  { k: '`document.fonts.load()`', how: '`load(\'16px Demo\')` из скрипта, текста с `Demo` на странице нет.', fetched: '**да**', tone: 'ok' },
];

export const LAZY_NOTE =
  'Правило одно: файл запрашивается, когда **раскладке** понадобился символ этого шрифта. Не стилям, не отрисовке. Поэтому `visibility: hidden` и текст за пределами экрана шрифт тянут — раскладка считает их, — а `display: none` и пустой элемент не тянут. Отсюда же главная задержка: браузер узнаёт о шрифте, только когда скачал HTML, скачал CSS, построил стили и дошёл до раскладки.';

/** CDP `CSS.getPlatformFontsForNode` для фразы при `font-family` и диапазонах, как у этого сайта. */
export const COURSE_SENTENCE = 'Шрифт качается, когда нужен: 3 случая.';

export const COURSE_GLYPHS = [
  { font: 'Newsreader (веб-шрифт)', glyphs: 9, what: 'пять пробелов, запятая, двоеточие, цифра 3 и точка' },
  { font: 'Georgia (системный)', glyphs: 29, what: 'все русские буквы' },
];

export const COURSE_NOTE =
  'Шрифт выбирается **для каждого символа отдельно**. У основного шрифта этого сайта — Newsreader — нет кириллицы, поэтому в русской фразе выше его буквы — только пробелы и знаки, а всё остальное рисует следующий в списке `font-family`, Georgia. Браузер не сообщает об этом ни ошибкой, ни предупреждением: строка просто собрана из двух шрифтов.';

// ─── Раздел 2. font-display: что видно, пока шрифт едет ───────────────────────────────────

export const PLAIN_DISPLAY =
  'Как ждать опаздывающего докладчика. Можно держать зал в тишине (блокировка). Можно сразу пустить запасного докладчика и сменить его, когда придёт основной (подмена). А можно сказать: «опоздал — значит, сегодня выступает запасной», и не менять никого.';

export const DISPLAY_ROWS: { k: string; block: string; swap: string; when: string }[] = [
  { k: '`block`', block: '3 с', swap: 'бесконечно', when: 'Текст без этого шрифта бессмыслен: иконочный шрифт, логотип набором.' },
  { k: '`swap`', block: '0', swap: 'бесконечно', when: 'Текст важнее вида: читать можно сразу, шрифт догонит.' },
  { k: '`fallback`', block: '100 мс', swap: '3 с', when: 'Опоздавший больше чем на 3 с шрифт уже не нужен: читатель привык к запасному.' },
  { k: '`optional`', block: '100 мс', swap: '0', when: 'Шрифт — украшение. Нет сразу — эта страница обойдётся без него, а файл ляжет в кеш до следующей.' },
  { k: '`auto`', block: 'на усмотрение браузера; Chromium — 2 с', swap: 'бесконечно', when: 'Значение по умолчанию. Ведёт себя почти как `block`.' },
];

export const FONT_DISPLAY_CODE = `// Длины периодов, мс от начала загрузки шрифта: рекомендации CSS Fonts 4
// («3 с», «100 мс или меньше») так, как их выдержал Chromium 153.
// auto спецификация оставляет браузеру; Chromium держит 2000.
const PERIODS = {
  auto:     { block: 2000, swap: Infinity },
  block:    { block: 3000, swap: Infinity },
  swap:     { block: 0,    swap: Infinity },
  fallback: { block: 100,  swap: 3000 },
  optional: { block: 100,  swap: 0 },
};

// Что видно в момент t, если файл пришёл через loadMs:
// 'invisible' — место занято, букв нет; 'fallback' — запасной шрифт;
// 'font' — веб-шрифт.
function fontPhase(display, loadMs, t, preloaded = false) {
  const { block, swap } = PERIODS[display];
  if (display === 'optional') {
    // Chromium не ждёт optional-шрифт, который не позвали через preload:
    // первый кадр рисуется запасным, и подмены уже не будет. С preload
    // отрисовка страницы ждёт шрифт, но не дольше периода блокировки.
    return preloaded && loadMs <= block ? 'font' : 'fallback';
  }
  if (t >= loadMs && loadMs <= block + swap) return 'font';
  if (t < block) return 'invisible';
  return 'fallback';
}`;

/** Прогоны стенда: какое состояние показал Chromium на каждом отрезке. См. шапку файла. */
export const STAND_RUNS: StandRun[] = [
  { display: 'auto', delay: 30, preload: false, loaded: 31, segs: [['invisible', 0, 12], ['font', 15, 6000]] },
  { display: 'auto', delay: 300, preload: false, loaded: 303, segs: [['invisible', 0, 312], ['font', 314, 6000]] },
  { display: 'auto', delay: 1500, preload: false, loaded: 1503, segs: [['invisible', 0, 1479], ['font', 1481, 6000]] },
  { display: 'auto', delay: 2500, preload: false, loaded: 2501, segs: [['invisible', 0, 1981], ['fallback', 1982, 2480], ['font', 2481, 6000]] },
  { display: 'auto', delay: 4000, preload: false, loaded: 4001, segs: [['invisible', 0, 1969], ['fallback', 1973, 3996], ['font', 3997, 5995]] },
  { display: 'auto', delay: 5000, preload: false, loaded: 5002, segs: [['invisible', 0, 1987], ['fallback', 1989, 4988], ['font', 4989, 6000]] },
  { display: 'block', delay: 30, preload: false, loaded: 33, segs: [['invisible', 0, 10], ['font', 14, 6000]] },
  { display: 'block', delay: 300, preload: false, loaded: 301, segs: [['invisible', 0, 277], ['font', 278, 6000]] },
  { display: 'block', delay: 1500, preload: false, loaded: 1502, segs: [['invisible', 0, 1476], ['font', 1477, 6000]] },
  { display: 'block', delay: 2500, preload: false, loaded: 2501, segs: [['invisible', 0, 2480], ['font', 2481, 5998]] },
  { display: 'block', delay: 4000, preload: false, loaded: 4005, segs: [['invisible', 0, 2996], ['fallback', 2999, 3995], ['font', 3996, 5996]] },
  { display: 'block', delay: 5000, preload: false, loaded: 5002, segs: [['invisible', 0, 2980], ['fallback', 2981, 4979], ['font', 4980, 6000]] },
  { display: 'swap', delay: 30, preload: false, loaded: 31, segs: [['fallback', 0, 13], ['font', 17, 6000]] },
  { display: 'swap', delay: 300, preload: false, loaded: 302, segs: [['fallback', 0, 280], ['font', 281, 6000]] },
  { display: 'swap', delay: 1500, preload: false, loaded: 1502, segs: [['fallback', 0, 1480], ['font', 1481, 6000]] },
  { display: 'swap', delay: 2500, preload: false, loaded: 2501, segs: [['fallback', 0, 2479], ['font', 2480, 6000]] },
  { display: 'swap', delay: 4000, preload: false, loaded: 4002, segs: [['fallback', 0, 4014], ['font', 4016, 6000]] },
  { display: 'swap', delay: 5000, preload: false, loaded: 5003, segs: [['fallback', 0, 4981], ['font', 4982, 6000]] },
  { display: 'fallback', delay: 30, preload: false, loaded: 32, segs: [['invisible', 0, 18], ['font', 22, 6000]] },
  { display: 'fallback', delay: 300, preload: false, loaded: 302, segs: [['invisible', 0, 79], ['fallback', 80, 282], ['font', 283, 6000]] },
  { display: 'fallback', delay: 1500, preload: false, loaded: 1502, segs: [['invisible', 0, 81], ['fallback', 82, 1482], ['font', 1483, 6000]] },
  { display: 'fallback', delay: 2500, preload: false, loaded: 2502, segs: [['invisible', 0, 77], ['fallback', 78, 2511], ['font', 2513, 6000]] },
  { display: 'fallback', delay: 4000, preload: false, loaded: 4000, segs: [['invisible', 0, 79], ['fallback', 80, 6000]] },
  { display: 'fallback', delay: 5000, preload: false, loaded: 5003, segs: [['invisible', 0, 86], ['fallback', 87, 6000]] },
  { display: 'optional', delay: 30, preload: false, loaded: 32, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 300, preload: false, loaded: 302, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 1500, preload: false, loaded: 1502, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 2500, preload: false, loaded: 2501, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 4000, preload: false, loaded: 4000, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 5000, preload: false, loaded: 5002, segs: [['fallback', 0, 6000]] },
  { display: 'swap', delay: 30, preload: true, loaded: 31, segs: [['font', 0, 2021]] },
  { display: 'swap', delay: 300, preload: true, loaded: 302, segs: [['fallback', 0, 285], ['font', 286, 2021]] },
  { display: 'optional', delay: 30, preload: true, loaded: 31, segs: [['font', 0, 2020]] },
  { display: 'optional', delay: 300, preload: true, loaded: 302, segs: [['fallback', 0, 2004]] },
  { display: 'optional', delay: 1500, preload: true, loaded: 1504, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 2500, preload: true, loaded: 2504, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 4000, preload: true, loaded: 4003, segs: [['fallback', 0, 6000]] },
  { display: 'optional', delay: 5000, preload: true, loaded: 5002, segs: [['fallback', 0, 6000]] },
];

export const DEMO_TEXT = 'Hamburgefonstiv';

export const DEMO_CAPTION =
  'Полосы считает функция `fontPhase` выше; полоса Chromium — то, что стенд снял с экрана при той же задержке шрифта. Сравните `block` и `auto` при 4000 мс: оба начинают с пустого места, но `auto` сдаётся на две секунды раньше. И `optional`: без `preload` веб-шрифт не появляется даже при задержке 30 мс.';

export const STAND_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Невидимый текст уже занимает место',
    d: 'Ширина строки в период блокировки — 310.38 px, ровно как у Georgia, а у Newsreader — 295.72 px. Браузер раскладывает текст запасным шрифтом и просто не рисует буквы. Поэтому `block` не спасает от сдвига: подмена всё равно меняет геометрию.',
  },
  {
    t: '`auto` в Chromium — не `block`',
    d: 'При задержке 4000 мс `block` держал пустое место до 3 с, `auto` — до 2 с, потом показывал Georgia. Спецификация разрешает браузеру выбирать поведение `auto` самому — и Chromium выбрал своё.',
    tone: 'warn',
  },
  {
    t: '`optional` без `preload` не показал шрифт ни разу',
    d: 'Даже при задержке 30 мс, когда файл приходит задолго до конца 100 мс. Первый кадр Chromium рисует сразу запасным шрифтом, а `optional` подмену запрещает. С `preload` при 30 мс шрифт был с первого кадра, при 300 мс — нет.',
    tone: 'warn',
  },
  {
    t: '`swap` — сразу запасной',
    d: 'Ни одного пустого кадра ни при какой задержке: блокировки у `swap` в Chromium нет вовсе. Цена — сдвиг при подмене, если метрики шрифтов разные.',
  },
];

// ─── Раздел 3. Сдвиг при подмене ──────────────────────────────────────────────────────────

export const PLAIN_OVERRIDES =
  'Как временная табличка вместо вывески: если вырезать её ровно по размеру вывески, при замене соседние витрины двигать не придётся. Буквы на табличке другие, но место она занимает то же.';

/** Метрики из файлов (`fontkitten`). Georgia — системная macOS, её метрики заменяются целиком. */
export const NEWSREADER_METRICS: Metrics = { upm: 2000, ascent: 1470, descent: -530, lineGap: 0 };
export const GEORGIA_METRICS: Metrics = { upm: 2048, ascent: 1878, descent: -449, lineGap: 0 };

/** `measureText` фразы `CLS_SAMPLE` на стенде, px. У Newsreader ось `opsz`: ширина зависит от размера. */
export const CLS_SAMPLE = 'The quick brown fox jumps over the lazy dog';
export const SAMPLE_WIDTHS = [
  { size: 16, newsreader: 303.9, georgia: 314.83 },
  { size: 18, newsreader: 326.58, georgia: 354.18 },
  { size: 100, newsreader: 2007.5, georgia: 1967.68 },
];

export const OVERRIDES_CODE = `// Метрики веб-шрифта — из его файла, в единицах сетки (upm).
// webWidth и fallbackWidth — ширина одного образца текста в обоих
// шрифтах при одном размере: её даёт ctx.measureText(образец).width.
function fallbackOverrides(web, webWidth, fallbackWidth) {
  const size = webWidth / fallbackWidth;   // во сколько раз ужать запасной
  const pct = (x) => (x * 100).toFixed(2) + '%';
  return {
    'size-adjust': pct(size),
    // override задаётся в долях font-size, а size-adjust потом умножит
    // и его, поэтому делим заранее
    'ascent-override': pct(web.ascent / web.upm / size),
    'descent-override': pct(-web.descent / web.upm / size),
    'line-gap-override': pct(web.lineGap / web.upm / size),
  };
}`;

export const FALLBACK_FACE_CODE = `/* Запасной шрифт под видом отдельного семейства — с подогнанными метриками */
@font-face {
  font-family: 'Newsreader Fallback';
  src: local('Georgia');
  size-adjust: 92.21%;
  ascent-override: 79.71%;
  descent-override: 28.74%;
  line-gap-override: 0.00%;
}

body {
  font-family: Newsreader, 'Newsreader Fallback', serif;
}`;

/** Колонка 360px, 18px, `font-display: swap`, шрифт приходит через 800 мс. Viewport 800×600. */
export const CLS_ROWS: { k: string; css: string; pH: string; cta: string; cls: string; tone: 'err' | 'warn' | 'ok' }[] = [
  { k: 'как есть', css: '`Newsreader, Georgia`, `line-height: normal`', pH: '147 → 108', cta: '208 → 166', cls: '0.0387', tone: 'err' },
  { k: 'фиксированная высота строки', css: '`line-height: 1.5`', pH: '189 → 162', cta: '256 → 229', cls: '0.0188', tone: 'warn' },
  { k: 'только ширина', css: '`size-adjust: 92.21%`', pH: '114 → 108', cta: '173 → 166', cls: '0.0035', tone: 'warn' },
  { k: 'ширина и высота', css: '`size-adjust` + `ascent-` / `descent-` / `line-gap-override`', pH: '108 → 108', cta: '166 → 166', cls: '0', tone: 'ok' },
  { k: 'то же + `line-height: 1.5`', css: 'все четыре дескриптора', pH: '162 → 162', cta: '229 → 229', cls: '0', tone: 'ok' },
];

export const CLS_NOTE =
  'Сдвиг из двух частей. **Ширина**: у Georgia строка длиннее, абзац переносится в семь строк вместо шести. **Высота строки**: при `line-height: normal` она берётся из метрик шрифта — у Georgia (1878 + 449) / 2048 ≈ 1.14 em, у Newsreader (1470 + 530) / 2000 = 1.0 em. Фиксированный `line-height` убирает вторую часть, но не первую: строк всё равно семь. `size-adjust` выравнивает ширину, override-дескрипторы — высоту, и вместе они дали ноль.';

export const OPSZ_NOTE =
  'Подгонка точна для одного размера. У Newsreader есть ось оптического размера `opsz`: на мелком кегле буквы шире и проще, на крупном — уже. Образец в 18px у Newsreader — 92.21% от Georgia, в 16px — 96.53%, в 100px — 102.02%. Одно `size-adjust` на всё семейство — компромисс; на стенде абзацы в 16px и 28px с теми же 92.21% переносились так же и не сдвинулись, но гарантии этому нет.';

// ─── Раздел 4. Подмножества и unicode-range ───────────────────────────────────────────────

export const PLAIN_RANGE =
  'Как разговорник, разрезанный на тонкие брошюры: английская, русская, вьетнамская. В поездку берут только те, чьи слова встретятся. `unicode-range` — надпись на обложке: «здесь буквы от сих до сих».';

export const SUBSET_CODE = `/* Одно семейство — два файла. Браузер сам решит, какие скачать */
@font-face {
  font-family: Plex;
  src: url(/fonts/plex-latin.woff2) format('woff2');        /* 10 052 байта */
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, /* … */ U+2000-206F;
}
@font-face {
  font-family: Plex;
  src: url(/fonts/plex-cyrillic.woff2) format('woff2');     /* 5 476 байт */
  unicode-range: U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116;
}`;

export const RANGE_CODE = `// 'U+0400-045F, U+2116, U+4??' → [[0x400, 0x45f], [0x2116, 0x2116], [0x400, 0x4ff]]
function parseRange(css) {
  return css.split(',').map((part) => {
    const p = part.trim().slice(2);               // без «U+»
    if (p.includes('?')) {                        // U+4?? — от 400 до 4FF
      return [parseInt(p.replaceAll('?', '0'), 16), parseInt(p.replaceAll('?', 'F'), 16)];
    }
    const [a, b = a] = p.split('-');
    return [parseInt(a, 16), parseInt(b, 16)];
  });
}

const covers = (ranges, cp) => ranges.some(([a, b]) => cp >= a && cp <= b);

// Какие файлы семейства браузер скачает под этот текст.
function facesToFetch(text, faces) {
  const ranges = faces.map((f) => parseRange(f.range));
  const need = new Set();
  let orphan = false;                 // символ, которого нет ни в одном файле
  for (const ch of text) {
    // Диапазоны пересекаются — побеждает файл, объявленный последним.
    const i = ranges.findLastIndex((r) => covers(r, ch.codePointAt(0)));
    if (i >= 0) need.add(i);
    else orphan = true;
  }
  // Chromium 153: если такой символ есть, качается и файл с пробелом.
  if (orphan) {
    const i = ranges.findLastIndex((r) => covers(r, 0x20));
    if (i >= 0) need.add(i);
  }
  return faces.filter((_, i) => need.has(i)).map((f) => f.file);
}`;

/** Диапазоны — как в CSS курса для IBM Plex Mono 400. */
export const PLEX_FACES: Face[] = [
  {
    file: 'plex-latin.woff2',
    range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  { file: 'plex-cyrillic.woff2', range: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116' },
];

/** Что запросил Chromium под текст абзаца с `font-family: Plex, monospace`. */
export const RANGE_RUNS: { text: string; fetched: string[]; note: string }[] = [
  { text: 'Hello', fetched: ['plex-latin.woff2'], note: 'только латиница' },
  { text: 'Привет', fetched: ['plex-cyrillic.woff2'], note: 'без пробела latin не нужен' },
  { text: 'Привет мир', fetched: ['plex-latin.woff2', 'plex-cyrillic.woff2'], note: 'пробел U+0020 — в диапазоне latin' },
  { text: '2026', fetched: ['plex-latin.woff2'], note: 'цифры — в latin' },
  { text: '你好', fetched: ['plex-latin.woff2'], note: 'иероглифов нет ни в одном файле — а latin всё равно скачан' },
];

export const RANGE_NOTE =
  'Пробел решает больше, чем кажется. Русская фраза из одного слова скачала только кириллический файл, а из двух слов — оба: пробел, запятая и цифры живут в latin. А текст, которого нет ни в одном подмножестве, всё равно потянул latin — тот файл, где есть пробел. На стенде это повторилось и со звёздочкой ★, а при диапазоне latin без пробела (`U+0041-007A`) иероглифы не потянули ничего.';

// ─── Раздел 5. preload и document.fonts ───────────────────────────────────────────────────

export const PRELOAD_CODE = `<link rel="preload" href="/fonts/newsreader-latin.woff2"
      as="font" type="font/woff2" crossorigin>`;

/** Порядок запросов на стенде; шрифт отвечает через 300 мс. Время — от запроса HTML, localhost. */
export const PRELOAD_ROWS: { k: string; requests: string; note: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'без preload', requests: 'HTML → CSS (15 мс) → шрифт (33 мс)', note: 'Шрифт ждёт CSS, стили и раскладку.' },
  { k: 'preload с `crossorigin`', requests: 'HTML → шрифт (3 мс) → CSS (4 мс)', note: 'Шрифт ушёл раньше CSS, запрос один.', tone: 'ok' },
  { k: 'preload без `crossorigin`', requests: 'HTML → шрифт `no-cors` (7 мс) → CSS → шрифт `cors` (312 мс)', note: 'Два запроса. Второй ушёл, когда первый уже скачался и оказался не тем.', tone: 'err' },
  { k: 'preload, шрифт не нужен', requests: 'HTML → шрифт (4 мс)', note: 'Скачан зря; в консоли — предупреждение через несколько секунд после `load`.', tone: 'warn' },
];

export const PRELOAD_WARNING =
  "A preload for '…/news.woff2' is found, but is not used because the request credentials mode does not match. Consider taking a look at crossorigin attribute.";

export const PRELOAD_NOTE =
  'Шрифт из CSS браузер всегда запрашивает в режиме CORS — на стенде у каждого такого запроса `Sec-Fetch-Mode: cors`, даже со своего адреса. `preload` без `crossorigin` идёт в режиме `no-cors`, и готовый ответ не подходит. Chromium сказал об этом в консоли и скачал файл второй раз.';

export const FONTS_API_CODE = `// @font-face для Demo объявлен, текста с Demo на странице нет
document.fonts.status;                  // 'loaded' — сейчас ничего не грузится
document.fonts.check('16px Demo');      // false — шрифт есть, но не загружен
document.fonts.check('16px NoSuchFont'); // true — грузить нечего!

const faces = await document.fonts.load('16px Demo'); // запрос уходит сейчас
faces.length;                           // 1 — загруженные FontFace
document.fonts.check('16px Demo');      // true

// load() смотрит на unicode-range: под 'Hello' кириллический файл не нужен
await document.fonts.load('16px Cyr', 'Hello');   // [] — ничего не скачано
await document.fonts.load('16px Cyr', 'Привет');  // [FontFace]

await document.fonts.ready;             // ждёт, пока не останется загрузок`;

export const API_ROWS: { k: string; what: string; tone?: 'warn' }[] = [
  { k: '`document.fonts`', what: 'Набор `FontFace` документа: и из `@font-face` в CSS, и добавленных скриптом через `document.fonts.add(new FontFace(…))`.' },
  { k: '`status`', what: '`loading`, пока хоть один шрифт грузится, иначе `loaded`. «Loaded» не значит «всё скачано» — значит «сейчас ничего не качается»: на стенде до первого запроса было `loaded`, а у самого `FontFace` — `unloaded`.', tone: 'warn' },
  { k: '`check(font, text?)`', what: 'Можно ли нарисовать текст этим шрифтом **без загрузки**. Для имени, у которого нет ни одного `@font-face`, ответ `true`: грузить нечего — опечатка в имени семейства проходит молча.', tone: 'warn' },
  { k: '`load(font, text?)`', what: 'Запускает загрузку подходящих файлов и отдаёт массив `FontFace`. С `unicode-range` учитывает текст: файл, чей диапазон с текстом не пересекается, не качается.' },
  { k: '`ready`', what: 'Промис, который выполняется, когда загрузок не осталось. Новая загрузка после этого не делает старый `ready` снова ожидающим — берите свойство заново.' },
];

// ─── Раздел 6. Шейпинг: ширина строки ─────────────────────────────────────────────────────

export const PLAIN_SHAPING =
  'Как набор в типографии вручную. Наборщик не ставит литеры вплотную с одинаковым зазором: «A» и «V» он подвигает друг к другу, а «f» и «i» берёт одной литерой «fi». Длина строки получается короче, чем сумма длин отдельных литер.';

export const MEASURE_CODE = `const ctx = document.createElement('canvas').getContext('2d');
await document.fonts.load('40px Newsreader');
ctx.font = '40px Newsreader';

const whole = ctx.measureText('AVATAR').width;                      // 149.31
const sum = [...'AVATAR'].reduce((w, ch) => w + ctx.measureText(ch).width, 0); // 164.95

ctx.fontKerning = 'none';               // в CSS — font-kerning: none
ctx.measureText('AVATAR').width;        // 164.95 — без кернинга сумма сошлась`;

/** canvas `measureText`, 40px, Newsreader с сервера стенда и системная Georgia. px. */
export const SHAPING_ROWS: { font: string; kerning: string; s: string; whole: number; sum: number }[] = [
  { font: 'Newsreader', kerning: 'auto', s: 'AVATAR', whole: 149.31, sum: 164.95 },
  { font: 'Newsreader', kerning: 'auto', s: 'To Yo', whole: 97.05, sum: 105.69 },
  { font: 'Newsreader', kerning: 'auto', s: 'Wave', whole: 91.9, sum: 96.73 },
  { font: 'Newsreader', kerning: 'auto', s: 'office', whole: 91.16, sum: 94.99 },
  { font: 'Newsreader', kerning: 'none', s: 'AVATAR', whole: 164.95, sum: 164.95 },
  { font: 'Newsreader', kerning: 'none', s: 'office', whole: 91.32, sum: 94.99 },
  { font: 'Georgia', kerning: 'auto', s: 'AVATAR', whole: 159.98, sum: 159.98 },
];

/** Ширина `<span>` 40px Newsreader в DOM, px. */
export const DOM_ROWS: { css: string; avatar: number; office: number }[] = [
  { css: 'по умолчанию', avatar: 149.31, office: 91.16 },
  { css: '`font-kerning: none`', avatar: 164.95, office: 91.33 },
  { css: '`font-variant-ligatures: none`', avatar: 149.31, office: 97.48 },
];

export const SHAPING_NOTE =
  '`AVATAR` короче суммы букв на 15.64 px — это кернинг: пары `AV`, `VA`, `TA` сдвинуты друг к другу. `office` короче на 3.83 px из-за лигатуры: `ffi` нарисован одним глифом, и `font-kerning: none` её не трогает. Выключить лигатуры может только `font-variant-ligatures: none` — и тогда `office` даже **шире** суммы (97.48 px): кернинг раздвигает пару `ff`. Системная Georgia на стенде пар не сдвинула ни одной: сумма совпала с целым. Вывод: ширину строки знает только тот, кто её отшейпил, — браузер. Своя таблица ширин букв ошибается на разных шрифтах по-разному.';

export const SHAPING_FACTS: { t: string; d: string; tone?: 'warn' }[] = [
  {
    t: 'Ширина строки — после шейпинга',
    d: 'Шейпер (в Chromium — HarfBuzz) получает строку целиком: пары, лигатуры, контекстные формы зависят от соседей. Поэтому раскладка измеряет отрезки текста, а не буквы, и перенос строки ищется на уже отшейпленных отрезках.',
  },
  {
    t: '`measureText` — тот же шейпинг',
    d: 'Ширина из canvas совпала с шириной `<span>` в DOM до сотой (149.31 и 149.31). Если нужно заранее знать длину подписи, спросите `measureText` с тем же шрифтом — и только после загрузки шрифта.',
  },
  {
    t: 'Измерили до загрузки — получили запасной шрифт',
    d: 'На стенде `measureText(\'AVATAR\')` до загрузки Newsreader вернул 159.98 px — ровно ширину Georgia, а после — 149.31. Сам вызов загрузку запустил (`document.fonts.status` стал `loading`), но ответ не ждал и ошибки не дал. Подписи на графиках, рассчитанные так, наезжают друг на друга после подмены. Сначала `await document.fonts.load(…)`, потом мерить.',
    tone: 'warn',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Шрифт качается поздно, потому что о нём узнают поздно',
    d: 'Запрос уходит, когда раскладке понадобился символ, а не когда браузер прочитал `@font-face`. Перед этим — HTML, CSS, стили. Для шрифта первого экрана это решается `preload` — с `crossorigin`.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`preload` без `crossorigin` — два скачивания',
    d: 'Шрифты всегда запрашиваются в режиме CORS, а preload без атрибута — в `no-cors`. На стенде второй запрос ушёл после того, как первый уже скачался, — то есть файл пришёл позже, чем вообще без preload.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`block` не спасает от сдвига',
    d: 'Невидимый текст раскладывается запасным шрифтом: место под него уже посчитано с чужими метриками. При подмене строки меняются так же, как при `swap`, — только читатель до этого смотрел на пустоту.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`optional` в Chromium без `preload` — шрифта не будет на первом заходе',
    d: 'Даже если файл пришёл за 30 мс. Он ляжет в кеш и появится на следующей странице. Хотите `optional` и шрифт с первого захода — нужен preload, и успеть надо за 100 мс.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`document.fonts.check()` отвечает `true` на опечатку',
    d: 'Для семейства без единого `@font-face` грузить нечего, и `check(\'16px NoSuchFont\')` — `true`. Проверка «шрифт готов» через `check` пропустит ошибку в имени.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Подмножество тянется из-за пробела',
    d: 'Русский текст с пробелами качает и латинский файл: пробел, цифры и знаки препинания живут там. Это нормально, но latin-файл — не «лишний для русского сайта», и `preload` для кириллического файла без латинского выигрывает меньше, чем кажется.',
  },
  {
    n: '07',
    t: 'Основной шрифт может не рисовать ни одной буквы',
    d: 'Если в веб-шрифте нет нужной письменности, браузер молча берёт буквы у следующего в `font-family`. У Newsreader нет кириллицы — русский текст этого сайта рисует Georgia, а Newsreader — пробелы, цифры и знаки.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Подгонка метрик верна для одного размера',
    d: '`size-adjust` считают по ширине образца, а у переменного шрифта с осью `opsz` ширина зависит от кегля: у Newsreader 92.21% в 18px и 96.53% в 16px. Считайте для размера основного текста.',
  },
  {
    n: '09',
    t: 'Ширина слова — не сумма ширин букв',
    d: 'Кернинг и лигатуры меняют её на проценты: `AVATAR` в Newsreader на 9.5% короче суммы. Своя таблица ширин для обрезки текста или раскладки подписей промахнётся; мерить надо `measureText` после загрузки шрифта.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'CSS Fonts Module Level 4 — `font-display`',
    href: 'https://www.w3.org/TR/css-fonts-4/#font-display-desc',
    what: 'значения `font-display`, рекомендуемые длины периодов блокировки и подмены',
  },
  {
    title: 'CSS Fonts Module Level 4 — The Font Display Timeline',
    href: 'https://www.w3.org/TR/css-fonts-4/#font-display-timeline',
    what: 'три периода загрузки шрифта: блокировка, подмена, отказ',
  },
  {
    title: 'CSS Fonts Module Level 4 — `unicode-range`',
    href: 'https://www.w3.org/TR/css-fonts-4/#unicode-range-desc',
    what: 'запись диапазонов, `?` в конце, порядок при пересечении',
  },
  {
    title: 'CSS Fonts Module Level 4 — Font loading guidelines',
    href: 'https://www.w3.org/TR/css-fonts-4/#font-face-loading',
    what: 'когда браузер обязан и когда не должен качать шрифт',
  },
  {
    title: 'CSS Fonts Module Level 5',
    href: 'https://www.w3.org/TR/css-fonts-5/',
    what: '`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`',
  },
  {
    title: 'CSS Font Loading Module Level 3',
    href: 'https://www.w3.org/TR/css-font-loading-3/',
    what: '`FontFace`, `FontFaceSet`: `status`, `load`, `check`, `ready`',
  },
  {
    title: 'web.dev — Prevent layout shifting and flashes of invisible text by preloading optional fonts',
    href: 'https://web.dev/articles/preload-optional-fonts',
    what: 'preload + `optional` в Chromium с версии 83: отрисовка ждёт шрифт до 100 мс',
  },
  {
    title: 'MDN — `CanvasRenderingContext2D.measureText()`',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText',
    what: '`TextMetrics`, `fontKerning`',
  },
  {
    title: 'Layout Instability API',
    href: 'https://wicg.github.io/layout-instability/',
    what: '`layout-shift`, `hadRecentInput`, как считается значение сдвига',
  },
];

export const RELATED =
  'Смежное на сайте: [Критический путь и Web Vitals, раздел «CLS»](/render/rendering-crp/#s3) — как считается сдвиг и окна сдвигов. [Сеть и кеширование, раздел «Приоритеты загрузки»](/platform/network/#s4) — `preload`, приоритеты и двойные загрузки. [Кадр браузера, раздел «Кадр по шагам»](/render/render-pipeline/#s1) — где в кадре раскладка. [Раскладка изнутри, раздел «Размеры содержимого»](/render/layout-internals/#s1) — min-content и max-content текста. [Стили веб-компонентов, раздел «Сброс и шрифт»](/render/web-components-styles/#s8) — `@font-face` внутри теневого корня. [Адаптивность изнутри](/render/responsive/) — вьюпорт, `svh`/`dvh`, `em` в медиазапросах, что ломает `container-type` и `clamp` при масштабе.';
