import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ImageFile, Scenario, StandPick } from '@/widgets/srcset-lab/model/types';

/**
 * Данные темы «Картинки: загрузка, декодирование и выбор размера».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63.0, `chromium.launch()`),
 * Node 24.11.0, macOS, октябрь 2026. Картинки — **sharp 0.35.4** (libvips 8.18.6, mozjpeg,
 * libwebp 1.6.0, aom 3.15.0), из сети ничего не качалось. Скрипты стенда — вне проекта,
 * в рабочем каталоге автора темы (`server.mjs`, `gen.mjs`, `stand1-srcset.mjs` …
 * `stand8-auto.mjs`).
 *
 * Исходник всех файлов — детерминированная «фотография» 2400×1600: небо с облаками, солнце,
 * два ряда холмов с шумовой текстурой травы (value noise на своём ГПСЧ). Тот же генератор
 * переписан в `tests/unit/images.test.ts`, и тест пересобирает из него байты файлов `sharp`.
 * Кандидаты `p-{400,800,1200,1600,2400}.{jpg,webp,avif}` — `resize(w)`, JPEG и WebP с
 * `quality: 75`, AVIF с `quality: 50`. Картинка синтетическая: на настоящей фотографии
 * отношения размеров между форматами будут другими, это пример, а не таблица на все случаи.
 *
 * Сервер — свой `node:http` на localhost. Он отдаёт страницы из памяти и картинки из каталога,
 * `?delay=мс` задерживает ответ (параметр сервера, а не замер сети), и записывает каждый
 * запрос: путь, момент прихода, `Accept`, `Sec-Fetch-Dest`. Каждый случай — новый контекст
 * браузера (пустой кеш), если не сказано иное.
 *
 * Что снято:
 *   — выбор из `srcset` (`SCENARIOS[*].runs`): какой файл пришёл на сервер и `currentSrc`
 *     при viewport 320…1920 и `deviceScaleFactor` 1 / 1.5 / 2 / 3; запрос и `currentSrc`
 *     совпали во всех 57 прогонах;
 *   — кеш (`CACHE_ROWS`): ресайз страницы и переход в том же контексте; случай «упреждающий
 *     парсер качает свой выбор, а элемент берёт файл из кеша» повторён 3 раза из 3, и для
 *     сравнения — та же картинка, вставленная скриптом, без запроса (3/3);
 *   — `<picture>` (`PICTURE_ROWS`) — запрошенный файл, `currentSrc` и заголовок `Accept`;
 *   — `loading="lazy"` (`LAZY_ROWS`): двоичный поиск расстояния, с которого запрос перестаёт
 *     уходить за 0.7 с после `load`. Тип сети — `navigator.connection.effectiveType`:
 *     по умолчанию в headless `4g`; `3g`, `2g`, `slow-2g` получены троттлингом DevTools
 *     (`Network.emulateNetworkConditions`: задержка 400 / 1800 / 3000 мс). Флаг
 *     `--force-effective-connection-type` на тип не повлиял;
 *   — LCP и приоритеты (`LCP_ROWS`, `PRIORITY_ROWS`): CSS отвечает через 400 мс, картинка —
 *     через 200 мс; время запроса — по журналу сервера от запроса HTML, LCP — из
 *     `PerformanceObserver`, приоритеты — CDP `Network.requestWillBeSent.initialPriority` и
 *     `Network.resourceChangedPriority`. Три прогона, в таблице медиана;
 *   — память декодированного битмапа (`DECODE_ROWS`): снимок memory-infra через CDP браузера
 *     (`Tracing.start` с категорией `disabled-by-default-memory-infra`,
 *     `Tracing.requestMemoryDump`), записи `cc/image_memory/…/image_N`. Каждый случай —
 *     отдельный запуск браузера, снимок через 1.2 с после `load`;
 *   — `img.decode()` (`DECODE_API_ROWS`), место под картинку и CLS (`RATIO_ROWS`, viewport 375,
 *     картинка приходит через 800 мс, сдвиги — `layout-shift` из `PerformanceObserver`);
 *   — размеры и PSNR форматов (`FORMAT_ROWS`) — `sharp`, PSNR посчитан по RGB против
 *     исходника 1200×800 до сжатия.
 *
 * Без проверки, только по документации и исходникам Chromium: что при нескольких файлах
 * в кеше берётся самый плотный (`html_srcset_parser.cc`, проверен случай с одним файлом);
 * что `decoding="async"` разрешает показать кадр без картинки, пока та декодируется,
 * — стенд этого не различает; поведение Firefox и Safari — стенд снимал только Chromium.
 *
 * Тест `tests/unit/images.test.ts` прогоняет `SRCSET_CODE` (ту же строку, что на странице
 * и в демо) против всех прогонов стенда, пересобирает байты файлов и таблицу форматов
 * `sharp` и пересчитывает числа из текста. Браузер в тесте не поднимается: стенд
 * перезапускается руками, если сменится Chromium.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'CSS-пиксель и DPR',
    d: 'Ширины в CSS — в CSS-пикселях. На экране телефона в одном CSS-пикселе 2–3 физических точки: это число и есть `devicePixelRatio` (DPR). Картинке в 300 CSS-пикселей на таком экране нужно 600–900 точек по ширине, чтобы не мылиться.',
  },
  {
    k: 'кандидат `srcset`',
    d: 'Один файл из списка `srcset` с подписью: `800w` — «ширина файла 800 точек», `2x` — «для экрана с плотностью 2». Браузер выбирает одного кандидата, остальные не качает.',
  },
  {
    k: 'слот (`sizes`)',
    d: 'Ширина, которую картинка займёт на странице, в CSS-пикселях. Браузер должен знать её до раскладки, поэтому её пишут в атрибуте `sizes` — заранее, словами медиазапросов.',
  },
  {
    k: 'упреждающий парсер (preload scanner)',
    d: 'Помощник браузера, который бежит по HTML вперёд основного разбора и сразу заказывает найденные адреса: `src`, `srcset`, `href`. Стилей и раскладки он не знает — только разметку и размер экрана.',
  },
  {
    k: 'декодирование',
    d: 'Превращение сжатого файла (JPEG, WebP, AVIF, PNG) в битмап — таблицу пикселей, которую можно рисовать. Битмап занимает в памяти ширину × высоту × 4 байта (красный, зелёный, синий, прозрачность), сколько бы ни весил файл.',
  },
];

export const PLAIN_IMAGES =
  'Как заказ мебели по каталогу. В каталоге один диван в пяти размерах, и магазин хочет привезти тот, что встанет в вашу нишу, — но померить нишу курьер не может: он едет раньше, чем вы расставили комнату. Поэтому размер ниши вы пишете в заказе заранее (`sizes`), а курьер выбирает из каталога (`srcset`). Диван в упаковке (файл) занимает мало места в машине, а распакованный (битмап) — всю нишу, и упаковка на это не влияет.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из соседних тем. Метрики LCP и CLS здесь не объясняются заново — только то, что делают с ними картинки.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'LCP и из чего он складывается',
    d: 'LCP — момент, когда нарисован самый крупный элемент первого экрана, часто картинка. Его время делят на четыре части: ожидание сервера, задержку до старта загрузки, саму загрузку и отрисовку.',
    href: '/render/rendering-crp/#s2',
    hrefLabel: '«Критический путь и Web Vitals», раздел «LCP»',
    tone: 'info',
  },
  {
    t: 'CLS — метрика сдвигов',
    d: 'Сдвиг считается, когда видимый элемент меняет место между кадрами. Картинка без зарезервированного места — классическая причина: приехала и растолкала текст.',
    href: '/render/rendering-crp/#s3',
    hrefLabel: '«Критический путь и Web Vitals», раздел «CLS»',
    tone: 'info',
  },
  {
    t: 'Приоритеты загрузки и `fetchpriority`',
    d: 'Браузер сам решает, какой запрос важнее, и шлёт их в этом порядке. `fetchpriority` — подсказка, которая этот порядок правит.',
    href: '/platform/network/#s4',
    hrefLabel: '«Сеть и кеширование», раздел «Приоритеты загрузки»',
    tone: 'info',
  },
  {
    t: 'HTTP-кеш',
    d: 'Ответ с `Cache-Control: max-age` браузер хранит и при повторном запросе берёт у себя, не спрашивая сервер. Отсюда в теме история «браузер взял файл больше нужного, потому что он уже был».',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
];

// ─── Раздел 1. srcset и sizes ─────────────────────────────────────────────────────────────

export const PLAIN_SRCSET =
  'Как выбрать плитку для ванной по каталогу. Ниша 60 см, а плитку продают листами 40, 80, 120 см. Меньше ниши — будет дыра, поэтому берут первый лист, который не меньше ниши, — 80 см, хотя 40 почти подошёл. На экране с DPR 2 «ниша» вдвое шире в точках: 60 см превращаются в 120.';

/** Разметка, на которой снят стенд. Файлы — `FILES`. */
export const SRCSET_W = 'p-400.jpg 400w, p-800.jpg 800w, p-1200.jpg 1200w, p-1600.jpg 1600w, p-2400.jpg 2400w';
export const SIZES = '(min-width: 1000px) 600px, (min-width: 600px) 50vw, 100vw';
export const SRCSET_X = 'a-1x.jpg, a-2x.jpg 2x, a-3x.jpg 3x';

export const MARKUP_CODE = `<img srcset="p-400.jpg 400w, p-800.jpg 800w, p-1200.jpg 1200w,
             p-1600.jpg 1600w, p-2400.jpg 2400w"
     sizes="(min-width: 1000px) 600px,
            (min-width: 600px) 50vw,
            100vw"
     src="p-400.jpg" width="1200" height="800" alt="Холмы">`;

export const SRCSET_CODE = `// 'a.jpg 400w, b.jpg 800w' или 'a.jpg, b.jpg 2x'. Упрощение: в адресах
// нет запятых и пробелов, дескрипторы w и x в одном списке не смешаны.
function parseSrcset(srcset) {
  return srcset.split(',').map((part) => {
    const [url, d = '1x'] = part.trim().split(/\\s+/);
    return d.endsWith('w') ? { url, w: parseFloat(d) } : { url, x: parseFloat(d) };
  });
}

// Ширина слота из sizes. Упрощение: условия — только (min-width) и
// (max-width) в px, длины — только px и vw. Настоящий браузер понимает
// любой медиазапрос и любую длину CSS, вплоть до calc().
function slotWidth(sizes, env) {
  for (const part of (sizes ?? '').split(',')) {
    const m = part.trim().match(/^(?:\\((min|max)-width:\\s*(\\d+)px\\)\\s+)?(auto|[\\d.]+(?:px|vw))$/);
    if (!m) continue;                        // не разобрали — пропуск, как в браузере
    const [, kind, edge, len] = m;
    if (kind === 'min' && env.vw < Number(edge)) continue;
    if (kind === 'max' && env.vw > Number(edge)) continue;
    if (len === 'auto') {                    // только у loading="lazy"
      if (env.lazy && env.layoutWidth) return { px: env.layoutWidth, rule: part.trim() };
      continue;
    }
    const px = len.endsWith('vw') ? (env.vw * parseFloat(len)) / 100 : parseFloat(len);
    return { px, rule: part.trim() };
  }
  return { px: env.vw, rule: null };         // ничего не подошло — 100vw
}

function pickCandidate(srcset, sizes, env) {
  const slot = slotWidth(sizes, env);
  // Плотность кандидата: сколько точек файла придётся на один CSS-пиксель слота.
  const list = parseSrcset(srcset)
    .map((c) => ({ url: c.url, density: c.w ? c.w / slot.px : c.x }))
    .sort((a, b) => a.density - b.density);
  // Первый, чья плотность не меньше DPR экрана; если таких нет — самый плотный.
  const pick = list.find((c) => c.density >= env.dpr) ?? list.at(-1);
  // Файл плотнее уже в кеше — элемент возьмёт его и ничего не скачает.
  const better = list.filter((c) => c.density > pick.density && env.cached?.includes(c.url));
  return { slot, list, pick: pick.url, shown: (better.at(-1) ?? pick).url };
}`;

/** Файлы стенда: байты — `sharp`, пересобираются тестом. */
export const FILES: Record<string, ImageFile> = {
  'p-400.jpg': { bytes: 9679, w: 400, h: 267 },
  'p-800.jpg': { bytes: 26140, w: 800, h: 533 },
  'p-1200.jpg': { bytes: 45983, w: 1200, h: 800 },
  'p-1600.jpg': { bytes: 69681, w: 1600, h: 1067 },
  'p-2400.jpg': { bytes: 121624, w: 2400, h: 1600 },
  'a-1x.jpg': { bytes: 6301, w: 300, h: 200 },
  'a-2x.jpg': { bytes: 17409, w: 600, h: 400 },
  'a-3x.jpg': { bytes: 30568, w: 900, h: 600 },
};

const runs = (rows: [number, number, string][]): StandPick[] => rows.map(([vw, dpr, got]) => ({ vw, dpr, got }));

/** Что Chromium запросил (и показал в `currentSrc`) — по одному прогону на строку. */
export const SCENARIOS: Scenario[] = [
  {
    id: 'w',
    label: 'w + sizes',
    srcset: SRCSET_W,
    sizes: SIZES,
    runs: runs([
      [320, 1, 'p-400.jpg'], [320, 1.5, 'p-800.jpg'], [320, 2, 'p-800.jpg'], [320, 3, 'p-1200.jpg'],
      [375, 1, 'p-400.jpg'], [375, 1.5, 'p-800.jpg'], [375, 2, 'p-800.jpg'], [375, 3, 'p-1200.jpg'],
      [414, 1, 'p-800.jpg'], [414, 1.5, 'p-800.jpg'], [414, 2, 'p-1200.jpg'], [414, 3, 'p-1600.jpg'],
      [600, 1, 'p-400.jpg'], [600, 1.5, 'p-800.jpg'], [600, 2, 'p-800.jpg'], [600, 3, 'p-1200.jpg'],
      [768, 1, 'p-400.jpg'], [768, 1.5, 'p-800.jpg'], [768, 2, 'p-800.jpg'], [768, 3, 'p-1200.jpg'],
      [1000, 1, 'p-800.jpg'], [1000, 1.5, 'p-1200.jpg'], [1000, 2, 'p-1200.jpg'], [1000, 3, 'p-2400.jpg'],
      [1280, 1, 'p-800.jpg'], [1280, 1.5, 'p-1200.jpg'], [1280, 2, 'p-1200.jpg'], [1280, 3, 'p-2400.jpg'],
      [1440, 1, 'p-800.jpg'], [1440, 1.5, 'p-1200.jpg'], [1440, 2, 'p-1200.jpg'], [1440, 3, 'p-2400.jpg'],
      [1920, 1, 'p-800.jpg'], [1920, 1.5, 'p-1200.jpg'], [1920, 2, 'p-1200.jpg'], [1920, 3, 'p-2400.jpg'],
    ]),
  },
  {
    id: 'nosizes',
    label: 'w без sizes',
    srcset: SRCSET_W,
    sizes: null,
    runs: runs([
      [375, 1, 'p-400.jpg'], [375, 2, 'p-800.jpg'], [800, 1, 'p-800.jpg'], [800, 2, 'p-1600.jpg'],
      [1280, 1, 'p-1600.jpg'], [1280, 2, 'p-2400.jpg'], [1920, 1, 'p-2400.jpg'], [1920, 2, 'p-2400.jpg'],
    ]),
  },
  {
    id: 'x',
    label: 'x-дескрипторы',
    srcset: SRCSET_X,
    sizes: null,
    runs: runs([
      [800, 1, 'a-1x.jpg'], [800, 1.1, 'a-2x.jpg'], [800, 1.25, 'a-2x.jpg'], [800, 1.3, 'a-2x.jpg'],
      [800, 1.4, 'a-2x.jpg'], [800, 1.5, 'a-2x.jpg'], [800, 1.75, 'a-2x.jpg'], [800, 2, 'a-2x.jpg'],
      [800, 2.4, 'a-3x.jpg'], [800, 2.5, 'a-3x.jpg'], [800, 2.625, 'a-3x.jpg'], [800, 3, 'a-3x.jpg'],
      [800, 4, 'a-3x.jpg'],
    ]),
  },
];

/** Граница «плотность ровно равна DPR»: viewport 399 / 400 / 401, DPR 1, тот же `SIZES`. */
export const EDGE_RUNS: StandPick[] = runs([[399, 1, 'p-400.jpg'], [400, 1, 'p-400.jpg'], [401, 1, 'p-800.jpg']]);

export const DEMO_CAPTION =
  'Полоски — плотность каждого файла: сколько его точек приходится на CSS-пиксель слота. Вертикальная черта — DPR экрана. Браузер берёт первый файл правее черты. Сравните 375 и 414 пикселей при DPR 1: слот вырос на 39 пикселей, `p-400.jpg` перестал дотягивать, и браузер скачал файл в 2.7 раза тяжелее.';

export const SRCSET_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Правило одно: первый, кто не меньше',
    d: 'Во всех 57 прогонах стенда Chromium взял первый по возрастанию файл, чья плотность не меньше DPR, а если таких нет — самый плотный. Плотность ровно равная DPR подходит: при viewport 400 и DPR 1 выбран `p-400.jpg`, при 401 — уже `p-800.jpg`.',
  },
  {
    t: 'Нет `sizes` — слот на весь экран',
    d: 'Без `sizes` браузер считает слот равным `100vw`. На ноутбуке 1280 px с DPR 1 он скачал `p-1600.jpg` (69 681 байт) — даже если картинка на странице шириной 300 px.',
    tone: 'warn',
  },
  {
    t: 'Порог режет по живому',
    d: 'Файл на пару пикселей уже слота уже не годится. При viewport 414 и DPR 1 Chromium скачал `p-800.jpg` (26 140 байт) вместо `p-400.jpg` (9 679): 400 < 414. Набор ширин стоит подбирать под реальные слоты, а не круглыми числами.',
    tone: 'warn',
  },
];

/** Карточка 300 px, viewport 1440: что запросил Chromium при разных `sizes`. */
export const SIZES_ROWS: { k: string; markup: string; dpr1: string; dpr2: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`sizes` нет', markup: '`srcset` с `w`', dpr1: '`p-1600.jpg` · 69 681 Б', dpr2: '`p-2400.jpg` · 121 624 Б', tone: 'err' },
  { k: 'честный `sizes`', markup: '`sizes="300px"`', dpr1: '`p-400.jpg` · 9 679 Б', dpr2: '`p-800.jpg` · 26 140 Б', tone: 'ok' },
  { k: '`sizes="auto"` + lazy', markup: '`sizes="auto" loading="lazy"`', dpr1: '`p-400.jpg` · 9 679 Б', dpr2: '`p-800.jpg` · 26 140 Б', tone: 'ok' },
  { k: '`sizes="auto"` без lazy', markup: '`sizes="auto"`', dpr1: '`p-1600.jpg` · 69 681 Б', dpr2: '`p-2400.jpg` · 121 624 Б', tone: 'warn' },
];

export const SIZES_NOTE =
  '`sizes` — обещание, которое браузер не проверяет. Упреждающий парсер видит HTML раньше CSS и раскладки, поэтому верит написанному. Пропущенный `sizes` у карточки в 300 px стоил в 7.2 раза больше байт при DPR 1. `sizes="auto"` берёт ширину из раскладки, но работает только с `loading="lazy"`: ленивую картинку и так качают после раскладки. У обычной `auto` пропускается, и слот снова `100vw`.';

// ─── Раздел 2. x-дескрипторы и кеш ────────────────────────────────────────────────────────

export const X_CODE = `<!-- Картинка фиксированной ширины 300 CSS px: размер слота известен -->
<img srcset="a-1x.jpg, a-2x.jpg 2x, a-3x.jpg 3x" src="a-1x.jpg" width="300" alt="">`;

export const X_NOTE =
  '`x`-дескрипторы — для картинок фиксированного размера: аватар, логотип, иконка. Слот не нужен, плотность записана прямо в разметке. Правило выбора то же: при DPR 1.1 Chromium взял `a-2x.jpg`, хотя до 1x не хватало десятой доли. При DPR 2.4 — уже `a-3x.jpg`. Округления в сторону меньшего файла нет.';

/** Что сделал Chromium, когда подходящий по правилу файл не совпал с тем, что уже скачано. DPR 2. */
export const CACHE_ROWS: { k: string; how: string; req: string; shown: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'окно сузили', how: '1440 → 375 px на той же странице; в кеше `p-1200.jpg`', req: 'нет', shown: '`p-1200.jpg`', tone: 'ok' },
  { k: 'окно расширили', how: '375 → 1440 px; в кеше `p-800.jpg`', req: '`p-1200.jpg`', shown: '`p-1200.jpg`' },
  { k: 'переход на страницу', how: 'та же разметка на другой странице, viewport 375; в кеше `p-1200.jpg`', req: '`p-800.jpg`', shown: '`p-1200.jpg`', tone: 'err' },
  { k: 'картинка из скрипта', how: 'то же, но `<img>` вставлен скриптом', req: 'нет', shown: '`p-1200.jpg`', tone: 'ok' },
];

export const CACHE_NOTE =
  'Браузер вправе показать файл плотнее нужного, если тот уже скачан: качество выше, а запроса нет. Именно это делает последняя строка `pickCandidate`. Но решают двое. Упреждающий парсер не смотрит в кеш картинок и заказывает свой выбор. Элемент `<img>` смотрит — и показывает файл из кеша. На стенде при переходе на вторую страницу `p-800.jpg` скачался, а на экране оказался `p-1200.jpg`. Та же картинка, вставленная скриптом, упреждающего парсера миновала, и запроса не было ни в одном из трёх повторов.';

// ─── Раздел 3. picture ────────────────────────────────────────────────────────────────────

export const PICTURE_CODE = `<picture>
  <!-- Формат: первый source, чей type браузер понимает -->
  <source type="image/avif" srcset="p-800.avif">
  <source type="image/webp" srcset="p-800.webp">
  <!-- Кадр: на узком экране — другая картинка и другие пропорции -->
  <source media="(max-width: 599px)" srcset="sq-600.jpg" width="600" height="600">
  <img src="p-800.jpg" width="1200" height="800" alt="Холмы">
</picture>`;

export const PLAIN_PICTURE =
  '`<picture>` — как список «если — то» в инструкции: браузер читает `<source>` сверху вниз и останавливается на первом, который подошёл по `type` и `media`. Сам `<img>` внутри обязателен: это и запасной вариант, и тот элемент, который на самом деле рисуется. `<source>` только подсказывает ему адрес.';

/** Что запросил Chromium. viewport 800, если не указан. */
export const PICTURE_ROWS: { k: string; markup: string; got: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'AVIF, WebP, JPEG', markup: '`source` avif → `source` webp → `img` jpg', got: '`p-800.avif`', tone: 'ok' },
  { k: 'неизвестный `type`', markup: '`source type="image/jxl"` → webp → jpg', got: '`p-800.webp` — JPEG XL пропущен, запроса за ним нет' },
  { k: '`type` не совпал с файлом', markup: '`source type="image/avif" srcset="p-800.webp"`', got: '`p-800.webp` скачан и показан: `type` — подсказка до запроса, содержимое не сверяется', tone: 'warn' },
  { k: '`media`, viewport 375', markup: '`source media="(max-width: 599px)"` → `img`', got: '`crop-400.webp` из `source`', tone: 'ok' },
  { k: '`media`, viewport 800', markup: 'то же', got: '`p-800.jpg` из `img`' },
  { k: 'порядок `source`, viewport 1280', markup: '`(min-width: 400px)` → 800, затем `(min-width: 1000px)` → 1600', got: '`p-800.webp`: первый подошедший, до второго очередь не дошла', tone: 'err' },
];

export const ACCEPT_HEADER = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

export const ACCEPT_NOTE =
  'С каждой картинкой Chromium 153 шлёт заголовок `Accept`, и в нём перечислены форматы, которые он умеет: AVIF, WebP, APNG, SVG. Поэтому формат может выбрать и сервер: один адрес `/hero`, а отдаётся AVIF, если он есть в `Accept`. Тогда ответ обязан нести `Vary: Accept`, иначе общий кеш выдаст AVIF браузеру, который его не понимает. Как `Vary` дробит ключ кеша — в [«Кеширование на CDN», раздел «Ключ и Vary»](/platform/cdn-cache/#s2).';

// ─── Раздел 4. Форматы ────────────────────────────────────────────────────────────────────

/** Одна и та же картинка 1200×800, `sharp`. PSNR — по RGB против исходника до сжатия, дБ. */
export const FORMAT_ROWS: { fmt: string; q: string; bytes: number; psnr: string }[] = [
  { fmt: 'JPEG', q: '40', bytes: 23868, psnr: '39.45' },
  { fmt: 'JPEG', q: '60', bytes: 32913, psnr: '41.13' },
  { fmt: 'JPEG', q: '75', bytes: 45983, psnr: '42.69' },
  { fmt: 'JPEG', q: '90', bytes: 85820, psnr: '45.39' },
  { fmt: 'WebP', q: '40', bytes: 13196, psnr: '39.76' },
  { fmt: 'WebP', q: '60', bytes: 17286, psnr: '40.73' },
  { fmt: 'WebP', q: '75', bytes: 20942, psnr: '41.63' },
  { fmt: 'WebP', q: '90', bytes: 43236, psnr: '44.58' },
  { fmt: 'AVIF', q: '30', bytes: 7432, psnr: '41.88' },
  { fmt: 'AVIF', q: '40', bytes: 10651, psnr: '43.57' },
  { fmt: 'AVIF', q: '50', bytes: 16067, psnr: '45.28' },
  { fmt: 'AVIF', q: '60', bytes: 21393, psnr: '46.24' },
  { fmt: 'AVIF', q: '75', bytes: 31770, psnr: '47.58' },
  { fmt: 'PNG', q: 'без потерь', bytes: 375123, psnr: '∞' },
  { fmt: 'WebP', q: 'без потерь', bytes: 228170, psnr: '∞' },
];

export const PLAIN_PSNR =
  'PSNR — грубая линейка «насколько картинка после сжатия отличается от исходной», в децибелах. Больше — ближе к оригиналу. Линейка грубая: глаз замечает не все ошибки одинаково, и для решений «можно ли сжать сильнее» смотрят глазами или метриками вроде SSIM. Но сравнить форматы на одной картинке она позволяет.';

export const FORMAT_NOTE =
  '**«Качество 75» в разных форматах — разные вещи.** Шкала `quality` у каждого кодека своя. При 75 AVIF весит больше WebP (31 770 против 20 942 байт), но и ближе к оригиналу (47.58 против 41.63 дБ). Сравнивать надо при одинаковом PSNR: около 41–42 дБ JPEG весит 32 913 байт, WebP — 20 942, AVIF — 7 432. AVIF в 4.4 раза легче JPEG. PNG без потерь — 375 123 байта: для фотографии это формат не того рода, он хорош для скриншотов, схем и плоских заливок.';

// ─── Раздел 5. loading="lazy" ─────────────────────────────────────────────────────────────

export const LAZY_CODE = `<!-- Ниже первого экрана: качать, когда подъедет -->
<img src="p-800.jpg" loading="lazy" width="800" height="533" alt="">

<!-- Главная картинка первого экрана: сразу и вперёд очереди -->
<img src="hero.avif" fetchpriority="high" width="1200" height="800" alt="">`;

export const PLAIN_LAZY =
  'Как официант, который приносит следующее блюдо, когда вы доедаете текущее, а не ставит всё меню на стол сразу. Но «доедаете» он оценивает с запасом: несёт заранее, пока вы ещё на середине тарелки. Этот запас — расстояние от края экрана, с которого начинается загрузка.';

/** На каком расстоянии от края экрана (или края скроллера) Chromium ещё начинает загрузку. */
export const LAZY_ROWS: { where: string; net: string; last: number; first: number }[] = [
  { where: 'ниже экрана', net: '`4g` — headless по умолчанию', last: 2999, first: 3000 },
  { where: 'ниже экрана', net: '`3g`', last: 2499, first: 2500 },
  { where: 'ниже экрана', net: '`2g`', last: 5999, first: 6000 },
  { where: 'ниже экрана', net: '`slow-2g`', last: 7999, first: 8000 },
  { where: 'правее края горизонтального скроллера', net: '`4g`', last: 1499, first: 1500 },
];

export const LAZY_NOTE =
  'Запас — в CSS-пикселях, а не в экранах: при высоте окна 600 и 900 px граница одна и та же, 3000 px. На медленной сети он больше — картинке нужно больше времени, чтобы успеть к прокрутке. Внутри прокручиваемого контейнера запас вдвое меньше. Картинка с `display: none` не качается вовсе, а `loading="lazy"` у картинки вне `<img>` (CSS-фон) не бывает.';

/** CSS отвечает через 400 мс, картинка — через 200 мс. Медиана трёх прогонов, мс от запроса HTML. */
export const LCP_ROWS: { k: string; req: number; prio: string; lcp: number; tone?: 'ok' | 'err' }[] = [
  { k: 'обычная', req: 14, prio: 'Medium', lcp: 428 },
  { k: '`fetchpriority="high"`', req: 6, prio: 'High', lcp: 420, tone: 'ok' },
  { k: '`loading="lazy"`', req: 426, prio: 'Low', lcp: 632, tone: 'err' },
  { k: '`lazy` + `fetchpriority="high"`', req: 413, prio: 'High', lcp: 620, tone: 'err' },
];

export const LCP_NOTE =
  'Обычную картинку упреждающий парсер заказал на 14-й миллисекунде, вместе с CSS. Она приехала раньше стилей и ждала их: LCP 428 мс почти совпал с приходом CSS. Ленивую парсер пропускает: чтобы решить, близко ли она к экрану, нужна раскладка, а для раскладки — CSS. Запрос ушёл на 426-й миллисекунде, и LCP съехал на 632 мс — ровно на время загрузки картинки. `fetchpriority="high"` поднял приоритет, но не время старта. Почему задержка старта — отдельная часть LCP, разобрано в [«Критическом пути», раздел «LCP»](/render/rendering-crp/#s2).';

/** Семь картинок 400×267 подряд и восьмая на 4000 px ниже; отдельно — три иконки 50×50. */
export const PRIORITY_ROWS: { k: string; prio: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'первые пять картинок документа', prio: 'Medium с самого начала' },
  { k: 'шестая и седьмая, видны на экране', prio: 'Low → High после раскладки', tone: 'ok' },
  { k: 'восьмая, далеко внизу', prio: 'Low' },
  { k: 'обычная картинка на 3000 px ниже экрана — одна на странице', prio: 'Medium: она в первой пятёрке', tone: 'warn' },
  { k: 'иконки 50×50 в начале документа', prio: 'Low: маленькие в пятёрку не входят' },
  { k: '`loading="lazy"`', prio: 'Low, запрос после раскладки' },
];

export const PRIORITY_NOTE =
  'Картинка, про которую браузер ещё ничего не знает, получает Low и ждёт раскладки: только тогда выяснится, видна ли она. Пять первых крупных картинок Chromium 153 стартует с Medium — на случай, если среди них главная. Видно, что эвристика слепа: картинка на 3000 px ниже экрана получила Medium, потому что была первой. `fetchpriority="high"` — единственный способ сказать «главная — эта» до раскладки.';

// ─── Раздел 6. Декодирование и память ─────────────────────────────────────────────────────

export const PLAIN_DECODE =
  'Файл картинки — как архив: в нём записано, как восстановить пиксели, а не сами пиксели. Чтобы нарисовать, архив надо распаковать в битмап — ровную таблицу, где на каждый пиксель четыре байта. Сколько весил архив, уже неважно: 1600 × 1067 пикселей — это 6.8 миллиона байт и для AVIF в 23 КБ, и для PNG в 712 КБ.';

export const BITMAP_CODE = `// Память под декодированную картинку: 4 байта на пиксель (RGBA).
const bitmapBytes = (w, h) => w * h * 4;

bitmapBytes(1600, 1067);   // 6 828 800 — файл AVIF был 23 253 байта
bitmapBytes(2400, 1600);   // 15 360 000 — файл JPEG был 121 624 байта`;

/** Снимок memory-infra, записи `cc/image_memory/…/image_N`, байты. См. шапку файла. */
export const DECODE_ROWS: { k: string; file: string; fileBytes: number | null; bitmaps: number[]; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'AVIF 1600×1067, показан в 1600 px', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [6832128] },
  { k: 'JPEG 1600×1067, показан в 1600 px', file: 'p-1600.jpg', fileBytes: 69681, bitmaps: [6832128] },
  { k: 'PNG 1600×1067, показан в 1600 px', file: 'm-1600.png', fileBytes: 711884, bitmaps: [6832128] },
  { k: 'JPEG 2400×1600, показан в 2400 px', file: 'p-2400.jpg', fileBytes: 121624, bitmaps: [15368192] },
  { k: 'AVIF 1600, показан в 800 px', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [6832128, 1720320], tone: 'warn' },
  { k: 'JPEG 1600, показан в 400 px', file: 'p-1600.jpg', fileBytes: 69681, bitmaps: [6832128, 442368], tone: 'warn' },
  { k: 'JPEG 1600, показан в 200 px', file: 'p-1600.jpg', fileBytes: 69681, bitmaps: [6832128, 114688], tone: 'warn' },
  { k: 'загружена, но на 5000 px ниже экрана', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [], tone: 'ok' },
  { k: '`display: none`', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [], tone: 'ok' },
  { k: 'ниже экрана, но вызван `img.decode()`', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [6832128] },
  { k: '`new Image()` вне документа + `decode()`', file: 'p-1600.avif', fileBytes: 23253, bitmaps: [6832128] },
];

export const DECODE_NOTE =
  'Битмап 1600 × 1067 занял 6 832 128 байт при любом формате — формула даёт 6 828 800, разница меньше 0.1%. Файл AVIF был в 294 раза меньше. Из таблицы видно ещё две вещи. Уменьшение в CSS память не экономит, а добавляет: Chromium держит полный битмап и рядом уменьшенную копию под размер показа. И декодирование ленивое: скачанная картинка, до которой не долистали, места не занимает, пока её не начнут рисовать.';

export const DECODE_API_CODE = `const img = new Image();
img.src = 'p-1600.avif';
await img.decode();   // файл скачан и распакован — первый кадр с ним не будет ждать
document.body.append(img);

// Ошибки decode() — всегда EncodingError, без подробностей:
// не картинка, 404, src не задан, src сменили, пока шло декодирование.`;

export const DECODE_API_ROWS: { k: string; what: string; tone?: 'warn' | 'err' }[] = [
  { k: '`decode()` у нормального файла', what: 'Выполняется после `load`: на стенде порядок `load → decode`. Битмап после этого в кеше декодированных картинок, даже если `<img>` нет в документе.' },
  { k: 'не картинка, 404, нет `src`', what: 'Отклоняется с `EncodingError` — во всех трёх случаях одно имя ошибки, причину не узнать.', tone: 'warn' },
  { k: '`src` сменили до конца', what: 'Отклоняется с `EncodingError`: обещание было про старый адрес.' },
  { k: 'обрезанный файл', what: 'JPEG, от которого осталось 3000 байт из 26 140, дал `load`, размер 800×533 и успешный `decode()`. Браузер рисует то, что успел разобрать. Ошибки нет.', tone: 'err' },
  { k: '`decoding`', what: 'Подсказка `sync` / `async` / `auto`, по умолчанию `auto`; неизвестное значение читается как `auto`. `async` разрешает браузеру показать кадр без картинки, пока та декодируется, вместо того чтобы задержать весь кадр.' },
];

// ─── Раздел 7. Место под картинку ─────────────────────────────────────────────────────────

/** viewport 375, картинка 1200×800 приходит через 800 мс; абзац под ней. */
export const RATIO_ROWS: { k: string; css: string; ar: string; before: string; after: string; cls: string; tone: 'ok' | 'warn' | 'err' }[] = [
  { k: 'без атрибутов', css: '`max-width: 100%; height: auto`', ar: '`auto`', before: '0×0', after: '375×250', cls: '0.0173', tone: 'err' },
  { k: '`width` и `height`', css: 'то же', ar: '`auto 1200 / 800`', before: '375×250', after: '375×250', cls: '0', tone: 'ok' },
  { k: '`aspect-ratio` в CSS', css: '`width: 100%; height: auto; aspect-ratio: 3/2`', ar: '`3 / 2`', before: '375×250', after: '375×250', cls: '0', tone: 'ok' },
  { k: 'атрибуты, но без `height: auto`', css: '`max-width: 100%`', ar: '`auto 1200 / 800`', before: '375×800', after: '375×800 — растянута', cls: '0', tone: 'err' },
  { k: 'атрибуты не те', css: '`width="1200" height="600"`', ar: '`auto 1200 / 600`', before: '375×188', after: '375×250', cls: '0.0046', tone: 'warn' },
  { k: '`<source>` 600×600 без атрибутов', css: 'кадр под узкий экран', ar: '`auto 1200 / 800` — от `<img>`', before: '375×250', after: '375×375', cls: '0.0092', tone: 'warn' },
  { k: '`<source width="600" height="600">`', css: 'то же', ar: '`auto 600 / 600`', before: '375×375', after: '375×375', cls: '0', tone: 'ok' },
];

export const RATIO_NOTE =
  'Атрибуты `width` и `height` превращаются в CSS-свойство `aspect-ratio: auto 1200 / 800` — это видно в `getComputedStyle`. Слово `auto` значит «пока файла нет — эта пропорция, пришёл — его собственная». Ширину задаёт CSS, высота считается из пропорции, и место готово до первого байта. Нужен и `height: auto` в CSS. Без него атрибут `height="800"` остаётся высотой в 800 пикселей, и картинка растягивается. Как считается сам балл сдвига — в [«Критическом пути», раздел «CLS»](/render/rendering-crp/#s3).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`srcset` с `w` без `sizes` — слот во весь экран',
    d: 'Браузер не знает ширину картинки до раскладки и считает `100vw`. Карточка в 300 px на экране 1280 получает файл 1600: на стенде 69 681 байт вместо 9 679.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`sizes` никто не проверяет',
    d: 'Разошёлся `sizes` с настоящей шириной после редизайна — браузер молча качает не тот файл. Ошибки нет ни в консоли, ни в Lighthouse по умолчанию. `sizes="auto"` снимает вопрос, но только у `loading="lazy"`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Файл чуть уже слота — уже следующий',
    d: 'Округления нет: 400 точек на слот 414 — мало, и браузер берёт 800. С `x` так же: DPR 1.1 получает `2x`. Ширины в `srcset` подбирают под реальные слоты и DPR.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Файл из кеша может оказаться больше нужного — и скачается ещё один',
    d: 'Элемент покажет более плотный файл из кеша, но упреждающий парсер об этом не знает и закажет свой выбор. На стенде при переходе между страницами скачанный файл не пригодился.',
  },
  {
    n: '05',
    t: '`<source>` читаются сверху вниз до первого подходящего',
    d: 'Медиазапросы `min-width` в порядке возрастания — ошибка: широкий экран подходит под первый же и до своего `<source>` не доходит. Порядок — от самого узкого условия к общему, или `max-width`.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`type` не проверяется по содержимому',
    d: '`<source type="image/avif">` с WebP внутри браузер скачает и покажет. Атрибут нужен, чтобы пропустить незнакомый формат **до** запроса, а не чтобы проверить файл.',
  },
  {
    n: '07',
    t: '`loading="lazy"` на картинке первого экрана',
    d: 'Ленивую картинку упреждающий парсер пропускает, и запрос уходит после CSS и раскладки. На стенде LCP вырос с 428 до 632 мс. `fetchpriority="high"` рядом с `lazy` не помогает: он про приоритет, а не про время старта.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Ленивые картинки качаются задолго до экрана',
    d: 'В Chromium 153 запас — 3000 px на быстрой сети и до 8000 px на медленной. На короткой странице `loading="lazy"` не сэкономит ничего: всё и так в пределах запаса.',
  },
  {
    n: '09',
    t: 'Лёгкий файл — не лёгкая картинка',
    d: 'Память считается по пикселям: 1600×1067 — 6.8 МБ при любом формате. Галерея из двадцати таких — больше 130 МБ битмапов. Уменьшение в CSS не помогает: держится и полный битмап, и уменьшенная копия.',
    tone: 'warn',
  },
  {
    n: '10',
    t: '`width`/`height` без `height: auto`',
    d: 'Атрибут `height` — это ещё и высота элемента. С `max-width: 100%`, но без `height: auto` картинка 1200×800 на экране 375 стала 375×800 — растянутой.',
    tone: 'err',
  },
  {
    n: '11',
    t: 'Обрезанный файл — не ошибка',
    d: 'Недокачанный JPEG даёт `load` и успешный `decode()`, а на экране — только то, что успело приехать. Ловить такое надо на сервере (длина ответа), а не в `onerror`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'HTML Standard — Images',
    href: 'https://html.spec.whatwg.org/multipage/images.html',
    what: 'разбор `srcset` и `sizes`, выбор источника, реакция на смену окружения, `sizes="auto"`',
  },
  {
    title: 'HTML Standard — The img element',
    href: 'https://html.spec.whatwg.org/multipage/embedded-content.html#the-img-element',
    what: '`decoding`, `decode()`, `fetchpriority`, `loading`, `<picture>` и `<source>`',
  },
  {
    title: 'HTML Standard — Lazy loading attributes',
    href: 'https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes',
    what: 'когда ленивая картинка начинает загрузку; запас оставлен на усмотрение браузера',
  },
  {
    title: 'Chromium — html_srcset_parser.cc',
    href: 'https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/html/parser/html_srcset_parser.cc',
    what: 'выбор кандидата по плотности и предпочтение файла, уже лежащего в кеше',
  },
  {
    title: 'web.dev — Browser-level image lazy loading for the web',
    href: 'https://web.dev/articles/browser-level-image-lazy-loading',
    what: 'пороги расстояния в Chromium и их зависимость от типа сети',
  },
  {
    title: 'web.dev — Optimize resource loading with the Fetch Priority API',
    href: 'https://web.dev/articles/fetch-priority',
    what: '`fetchpriority`, стартовые приоритеты картинок',
  },
  {
    title: 'CSS Box Sizing Module Level 4 — aspect-ratio',
    href: 'https://www.w3.org/TR/css-sizing-4/#aspect-ratio',
    what: '`aspect-ratio: auto <ratio>` и как из него считается размер',
  },
  {
    title: 'Chromium — MemoryInfra',
    href: 'https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/README.md',
    what: 'снимки памяти по аллокаторам, которыми стенд измерил битмапы',
  },
  {
    title: 'sharp — Output options',
    href: 'https://sharp.pixelplumbing.com/api-output',
    what: '`quality` и `lossless` для JPEG, WebP, AVIF и PNG',
  },
];

export const RELATED =
  'Смежное на сайте: [Критический путь и Web Vitals, раздел «LCP»](/render/rendering-crp/#s2) — четыре части LCP и почему картинка в CSS-фоне стартует поздно. [Там же, раздел «CLS»](/render/rendering-crp/#s3) — как считается балл сдвига. [Сеть и кеширование, раздел «Приоритеты загрузки»](/platform/network/#s4) — приоритеты, `preload` и `fetchpriority` для всех ресурсов. [Кеширование на CDN, раздел «Ключ и Vary»](/platform/cdn-cache/#s2) — выбор формата по `Accept` и `Vary`. [Шрифты и текст, раздел «Когда шрифт качается»](/render/fonts-text/#s1) — другой ресурс, о котором браузер узнаёт только из раскладки. [WebGL и конвейер GPU, раздел «Конвейер GPU»](/render/webgl/#s2) — та же арифметика битмапа для текстур в видеопамяти. [Адаптивность изнутри](/render/responsive/) — вьюпорт, `svh`/`dvh`, `em` в медиазапросах, что ломает `container-type` и `clamp` при масштабе. [Наблюдатели](/render/observers/) — когда срабатывают Intersection-, Resize- и MutationObserver и где браузеры расходятся со спецификацией.';
