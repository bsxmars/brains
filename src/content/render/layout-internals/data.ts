import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FlexItem, FlexScenario, FrTrack, Placed } from '@/widgets/flex-lab/model/types';

/**
 * Данные темы «Раскладка изнутри: flex и grid».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63, `chromium.launch()`),
 * Node 24.11.0, macOS, октябрь 2026. Скрипты стенда — вне проекта, в рабочем каталоге
 * автора темы (`stand.mjs`, `stand2.mjs` … `stand4.mjs`): каждая фикстура ставится
 * `page.setContent`, размеры снимаются `getBoundingClientRect()` у контейнера и элементов.
 *
 * Общий стиль всех фикстур: `* { box-sizing: border-box; margin: 0; padding: 0 }`,
 * `body { font: 16px/1.25 monospace }`. Пустые элементы — `<div>` без содержимого (их
 * min-content равен 0). Текст — моноширинный шрифт системы стенда, поэтому **ширины текста
 * зависят от машины**: на другой системе слово «Раскладка» может выйти не 68.41 px. Отношения
 * при этом не меняются — функции темы получают min-content и max-content на вход.
 *
 * Что снято:
 *   — внутренние размеры: `width: min-content | max-content | fit-content` на тексте
 *     «Раскладка считает размеры дважды» (`INTRINSIC_*`) и min/max-content коротких строк
 *     (`TEXT_SIZES`);
 *   — одиннадцать флекс-строк (`FLEX_FIXTURES`), девять сеток (`FR_FIXTURES`), авторасстановка
 *     `row` и `row dense` (`PLACE_*`);
 *   — вычисленные `flex-grow`, `flex-shrink`, `flex-basis`, `min-width` для сокращений `flex`
 *     через `getComputedStyle` (`SHORTHAND_ROWS`);
 *   — шесть способов дать ссылке сжаться (`FIX_ROWS`).
 *
 * Координаты Chromium хранит в 1/64 пикселя (LayoutUnit): 580 / 3 приходит как 193.328125,
 * а не 193.333…. Поэтому тест сверяет функции темы с замерами с допуском **1/64 px**.
 *
 * Литералы ниже — замеры как есть. `tests/unit/layout-internals.test.ts` гоняет `FLEX_CODE`,
 * `FR_CODE` и `PLACE_CODE` (те самые строки, что напечатаны на странице и исполняются демо)
 * на входах фикстур и сверяет результат с замерами, без запуска браузера. Сам браузер
 * в тесте не поднимается: стенд перезапускается руками, если сменится версия Chromium.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'раскладка (layout)',
    d: 'Шаг кадра, на котором браузер считает размеры и координаты каждого прямоугольника страницы. До него `width: 50%` — обещание, после — число в пикселях.',
  },
  {
    k: 'min-content и max-content',
    d: 'Два размера, которые содержимое называет само. min-content — самая узкая ширина без вылезания: текст переносится везде, где можно. max-content — ширина в одну строку, без переносов.',
  },
  {
    k: 'главная ось',
    d: 'Направление, вдоль которого флекс-контейнер ставит элементы: при `flex-direction: row` это ширина. Всё, что тема говорит про ширину, для `column` верно про высоту.',
  },
  {
    k: 'базовый размер (flex base size)',
    d: 'Ширина элемента до раздачи места. Берётся из `flex-basis`; если там `auto` — из `width`; если и там `auto` — из max-content содержимого.',
  },
  {
    k: 'свободное место',
    d: 'Ширина контейнера минус сумма базовых размеров. Положительное — элементы растут, отрицательное — сжимаются.',
  },
  {
    k: 'трек и `fr`',
    d: 'Трек — колонка или строка грида. `fr` — единица доли: `1fr 2fr` делит оставшееся место в отношении 1 : 2.',
  },
];

export const PLAIN_LAYOUT =
  'Как расставить мебель вдоль стены. Сначала у каждого предмета спрашивают два числа: уже какой ширины его не сделать (шкаф не согнёшь) и сколько он займёт, если ему ничего не мешает. Потом делят стену. flex делит одну стену по очереди, по правилам «кто сколько просит». grid сначала чертит на полу клетки, а мебель ставит уже в них.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из соседних тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Раскладка — один из шагов кадра',
    d: 'Сначала браузер вычисляет стили каждого элемента, потом считает геометрию — это шаг layout, — потом рисует. Здесь разбирается, что происходит внутри этого шага для flex и grid.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Число для `width` появляется только после раскладки',
    d: '`flex: 1` или `width: 50%` — это обещание, а не размер. В пиксели оно превращается на шаге layout, и `getComputedStyle(el).width` возвращает уже посчитанное число.',
    href: '/render/css-cascade/#s4',
    hrefLabel: '«Каскад и вычисление стилей», раздел «Стадии значения и цена чтения из JS»',
    tone: 'info',
  },
  {
    t: 'Чтение размеров запускает раскладку',
    d: '`getBoundingClientRect()` после правки стилей заставляет браузер посчитать раскладку немедленно. Все замеры этой темы сняты именно так — на готовой странице, где это ничего не стоит.',
    href: '/render/render-pipeline/#s3',
    hrefLabel: '«Кадр браузера», раздел «Чтение и запись»',
    tone: 'info',
  },
  {
    t: 'Блочная модель и `box-sizing`',
    d: 'Ширина элемента складывается из содержимого, внутренних полей (`padding`) и рамки. При `box-sizing: border-box` `width` и `flex-basis` задают всё вместе — так устроены все примеры темы, и числа в них сходятся без поправок. При обычном `content-box` к ним добавятся поля и рамка.',
    tone: 'info',
  },
];

// ─── Замеры стенда ─────────────────────────────────────────────────────────────────────────

/** Ширины текста, px: `display: inline-block; width: min-content | max-content`. */
export const TEXT_SIZES = {
  /** «example.com/very/long/path» — слово без единого места для переноса. */
  url: { min: 249.640625, max: 249.640625 },
  ok: { min: 19.203125, max: 19.203125 },
  /** «Короткий». */
  short: { min: 67.375, max: 67.375 },
  /** «Заметно более длинный текст». */
  long: { min: 58.40625, max: 219.453125 },
};

/** Допуск сверки: Chromium хранит координаты в 1/64 px. */
export const LAYOUT_UNIT = 1 / 64;

/** Число для текста: две цифры после точки, без хвостовых нулей. */
export const px = (n: number) => String(Math.round(n * 100) / 100);

// ─── Раздел 1. Два размера содержимого ─────────────────────────────────────────────────────

export const INTRINSIC_TEXT = 'Раскладка считает размеры дважды';

export const INTRINSIC_CODE = `<div style="width: 1000px">
  <p style="width: min-content">Раскладка считает размеры дважды</p>
  <p style="width: max-content">Раскладка считает размеры дважды</p>
  <p style="width: fit-content">Раскладка считает размеры дважды</p>
</div>
<div style="width: 200px">
  <p style="width: fit-content">Раскладка считает размеры дважды</p>
</div>`;

export const PLAIN_INTRINSIC =
  'Представьте строку книг, которую нужно поставить на полку. Если полка узкая, книги можно поставить стопками — но не уже, чем самая толстая книга: её не разрежешь. Это min-content. Если полка бесконечная, все книги встанут в один ряд — это max-content. Любая настоящая полка где-то между, и браузер решает, где именно.';

/** Замер: ширина и высота абзаца. Высота показывает число строк (одна строка — 20 px). */
export const INTRINSIC_ROWS = [
  { k: '`width: min-content`', w: 68.40625, h: 80, d: 'Четыре строки. Ширина — слово «Раскладка», самое длинное: уже нельзя, иначе оно вылезет.' },
  { k: '`width: max-content`', w: 257.921875, h: 20, d: 'Одна строка, ни одного переноса.' },
  { k: '`width: fit-content`, контейнер 1000 px', w: 257.921875, h: 20, d: 'Места хватает — берётся max-content.' },
  { k: '`width: fit-content`, контейнер 200 px', w: 200, h: 40, d: 'max-content не влезает — берётся всё доступное место, но не меньше min-content. Две строки.' },
];

/** Отдельно снятая ширина слова «Раскладка» в одну строку: она же min-content абзаца. */
export const WORD_WIDTH = 68.40625;

export const INTRINSIC_NOTE =
  '`fit-content` — это формула из двух чисел: `min(max-content, max(min-content, доступно))`. Те же два числа flex и grid берут, когда размер не задан явно. Базовый размер флекс-элемента с `flex-basis: auto` и без `width` — его max-content. Нижняя граница элемента с `min-width: auto` — его min-content. Колонка `1fr` в гриде тоже не бывает уже min-content своего содержимого. Поэтому длинная ссылка, `<pre>` или широкая таблица так часто ломают раскладку: у них огромный min-content.';

// ─── Раздел 2. Рост: как flex раздаёт свободное место ──────────────────────────────────────

export const PLAIN_GROW =
  'Как делят премию в отделе. Сначала каждый получает свою ставку — это базовый размер. Остаток делят по долям: у кого доля 2, тот получит вдвое больше прибавки, чем у кого доля 1. Но у премии есть потолок — `max-width`. Кому насчитали больше потолка, тот получает потолок, а излишек снова делят между остальными. Это и есть повторный проход.';

export const FLEX_STEPS = [
  { k: '1. Базовый размер', d: 'У каждого элемента: `flex-basis`, если он задан числом; иначе `width`; иначе max-content. Этот размер ещё не зажат в `min-width` и `max-width`.' },
  { k: '2. Растём или сжимаемся', d: 'Браузер зажимает базовые размеры в min и max и складывает. Сумма меньше контейнера — работает `flex-grow`, больше — `flex-shrink`. У кого нужный фактор 0, тот сразу заморожен.' },
  { k: '3. Раздать', d: 'Свободное место — контейнер минус размеры замороженных и базовые размеры остальных. При росте каждый получает долю по `flex-grow`, при сжатии — по `flex-shrink` × базовый размер.' },
  { k: '4. Зажать и повторить', d: 'Новые размеры зажимают в min и max. Кто упёрся, тот заморожен на границе, а место, которое он не взял или недоотдал, делится заново между остальными. Проходов столько, сколько нужно, чтобы все замёрзли.' },
];

export const FLEX_CODE = `// Одна строка флекс-контейнера: кто сколько получит по главной оси.
// CSS Flexbox, §9.7 «Resolving Flexible Lengths»; без margin и gap.
// item: { basis, grow, shrink, min, max } в пикселях. min — уже посчитанный
// минимум: для min-width: auto это min-content. max: null — без предела.
function resolveFlex(container, items) {
  const clamp = (it, v) => Math.max(it.min, Math.min(it.max ?? Infinity, v));

  // 1–2. Растём или сжимаемся — по сумме размеров, зажатых в min/max.
  const hypo = items.map((it) => clamp(it, it.basis));
  const mode = hypo.reduce((s, v) => s + v, 0) < container ? 'grow' : 'shrink';
  const factor = (it) => (mode === 'grow' ? it.grow : it.shrink);
  // Вес при раздаче: рост — flex-grow, сжатие — flex-shrink × базовый размер.
  const weight = (it) => (mode === 'grow' ? it.grow : it.shrink * it.basis);

  // Сразу замораживаем тех, кто не участвует: фактор 0 или min/max
  // уже тянет против направления. Их размер — зажатый базовый.
  const frozen = items.map((it, i) =>
    factor(it) === 0 || (mode === 'grow' ? it.basis > hypo[i] : it.basis < hypo[i]));
  const size = items.map((it, i) => (frozen[i] ? hypo[i] : it.basis));
  const freeSpace = () =>
    container - items.reduce((s, it, i) => s + (frozen[i] ? size[i] : it.basis), 0);
  const initialFree = freeSpace();
  const rounds = [];

  // 3–4. Раздать, зажать в min/max, заморозить упёршихся — и снова.
  while (frozen.includes(false)) {
    const open = items.filter((_, i) => !frozen[i]);
    let free = freeSpace();
    const sumFactors = open.reduce((s, it) => s + factor(it), 0);
    if (sumFactors < 1 && Math.abs(initialFree * sumFactors) < Math.abs(free)) {
      free = initialFree * sumFactors;     // сумма факторов меньше 1: раздаём только долю
    }
    const sumWeights = open.reduce((s, it) => s + weight(it), 0);
    let violation = 0;
    const hit = [];
    items.forEach((it, i) => {
      if (frozen[i]) return;
      const raw = it.basis + (sumWeights ? (free * weight(it)) / sumWeights : 0);
      size[i] = clamp(it, raw);
      violation += size[i] - raw;
      if (size[i] !== raw) hit.push({ i, by: size[i] > raw ? 'min' : 'max' });
    });
    // Перебор вверх — замораживаем упёршихся в min, вниз — в max, ноль — всех.
    const now = violation === 0
      ? items.map((_, i) => i).filter((i) => !frozen[i])
      : hit.filter((h) => h.by === (violation > 0 ? 'min' : 'max')).map((h) => h.i);
    now.forEach((i) => (frozen[i] = true));
    rounds.push({ free, sizes: [...size], frozen: now, hit });
  }

  const used = size.reduce((s, v) => s + v, 0);
  return { mode, sizes: size, rounds, overflow: Math.max(0, used - container) };
}`;

export const FLEX_CODE_NOTE =
  'Это алгоритм спецификации почти дословно, только без `margin`, `gap` и переноса строк. Функция получает min уже посчитанным: откуда он берётся у элемента с текстом, разобрано в разделе «Сжатие и `min-width: auto`». Каждая строка таблиц ниже — эта функция на входах фикстуры против того, что Chromium вернул из `getBoundingClientRect`.';

export interface FlexFixture {
  id: string;
  /** CSS элементов фикстуры — так, как он стоял на стенде. */
  css: string;
  container: number;
  items: FlexItem[];
  /** Ширины элементов в Chromium, px. */
  measured: number[];
  /** Как получилось — словами. */
  how: string;
}

const item = (name: string, basis: number, grow: number, shrink: number, min = 0, max: number | null = null): FlexItem => ({
  name,
  basis,
  grow,
  shrink,
  min,
  max,
});

const T = TEXT_SIZES;

export const FLEX_FIXTURES: FlexFixture[] = [
  {
    id: 'grow',
    css: 'контейнер 600 px; `flex: 1 1 100px`, `2 1 100px`, `3 1 100px`',
    container: 600,
    items: [item('A', 100, 1, 1), item('B', 100, 2, 1), item('C', 100, 3, 1)],
    measured: [150, 200, 250],
    how: 'Свободно 600 − 300 = 300. Долей 1 + 2 + 3 = 6, одна доля — 50 px. Прибавка 50, 100 и 150.',
  },
  {
    id: 'grow-max',
    css: 'контейнер 600 px; три `flex: 1 1 100px`, у A `max-width: 120px`',
    container: 600,
    items: [item('A', 100, 1, 1, 0, 120), item('B', 100, 1, 1), item('C', 100, 1, 1)],
    measured: [120, 240, 240],
    how: 'Первый проход: всем по 200. A упёрся в 120 и заморожен. Второй проход: свободно 600 − 120 − 200 = 280, B и C получают по 140.',
  },
  {
    id: 'grow-fraction',
    css: 'контейнер 600 px; два `flex: 0.25 1 100px`',
    container: 600,
    items: [item('A', 100, 0.25, 1), item('B', 100, 0.25, 1)],
    measured: [200, 200],
    how: 'Сумма `flex-grow` 0.5 меньше единицы — раздаётся только половина свободных 400 px. Ещё 200 px остаются пустыми.',
  },
  {
    id: 'flex-1',
    css: 'контейнер 700 px; `flex: 1` у «Короткий» и у «Заметно более длинный текст»',
    container: 700,
    items: [item('A', 0, 1, 1, T.short.min), item('B', 0, 1, 1, T.long.min)],
    measured: [350, 350],
    how: '`flex: 1` — это базовый размер `0%`. Свободно все 700 px, делятся поровну. Длина текста не участвует.',
  },
  {
    id: 'flex-auto',
    css: 'контейнер 700 px; `flex: auto` у тех же двух текстов',
    container: 700,
    items: [item('A', T.short.max, 1, 1, T.short.min), item('B', T.long.max, 1, 1, T.long.min)],
    measured: [273.953125, 426.046875],
    how: '`flex: auto` — базовый размер по содержимому: 67.38 и 219.45. Свободные 413.17 делятся поровну, по 206.59, поверх разных стартов.',
  },
  {
    id: 'shrink',
    css: 'контейнер 300 px; `flex: 0 1 300px`, `0 1 200px`, `0 1 100px`',
    container: 300,
    items: [item('A', 300, 0, 1), item('B', 200, 0, 1), item('C', 100, 0, 1)],
    measured: [150, 100, 50],
    how: 'Не хватает 300 px. Веса — `flex-shrink` × базовый: 300, 200, 100. A отдаёт половину нехватки, 150, B — треть, C — шестую часть. Каждый сжался ровно вдвое.',
  },
  {
    id: 'shrink-auto',
    css: 'контейнер 300 px; `flex: 0 1 200px` у ссылки и у «ok»',
    container: 300,
    items: [item('A', 200, 0, 1, T.url.min), item('B', 200, 0, 1, T.ok.min)],
    measured: [249.640625, 50.359375],
    how: 'Минимум ссылки — её min-content, 249.64, а это больше базовых 200. Ссылка заморожена сразу, ещё **шире** базового размера. Всё сжатие достаётся «ok»: 300 − 249.64 = 50.36.',
  },
  {
    id: 'shrink-zero',
    css: 'то же, у ссылки `min-width: 0`',
    container: 300,
    items: [item('A', 200, 0, 1, 0), item('B', 200, 0, 1, T.ok.min)],
    measured: [150, 150],
    how: 'Минимума нет — оба сжимаются поровну, по 50. Текст ссылки вылезает из своего элемента, но строка в контейнер влезла.',
  },
  {
    id: 'shrink-overflow-hidden',
    css: 'то же, у ссылки `overflow: hidden` вместо `min-width: 0`',
    container: 300,
    items: [item('A', 200, 0, 1, 0), item('B', 200, 0, 1, T.ok.min)],
    measured: [150, 150],
    how: 'У элемента с `overflow` не `visible` автоматического минимума нет — тот же результат, что с `min-width: 0`. Лишний текст обрезан.',
  },
  {
    id: 'flex-1-narrow',
    css: 'контейнер 150 px с `overflow: hidden`; `flex: 1` у ссылки и у «ok»',
    container: 150,
    items: [item('A', 0, 1, 1, T.url.min), item('B', 0, 1, 1, T.ok.min)],
    measured: [249.640625, 19.203125],
    how: 'Сумма минимумов 268.84 больше контейнера. Оба элемента стоят на своих min-content, и строка вылезает за контейнер на 118.84 px.',
  },
];

export const flexFixture = (id: string) => {
  const f = FLEX_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`нет фикстуры ${id}`);
  return f;
};

const fixtureRow = (f: FlexFixture) => [f.css, f.how, f.measured.map(px).join(' · ')];

export const GROW_ROWS = ['grow', 'grow-max', 'grow-fraction'].map((id) => fixtureRow(flexFixture(id)));

/** `getComputedStyle` у флекс-элемента с разными `flex`, и у обычного блока для сравнения. */
export const SHORTHAND_ROWS = [
  { flex: '(не задан)', grow: '0', shrink: '1', basis: 'auto' },
  { flex: '`flex: 1`', grow: '1', shrink: '1', basis: '0%' },
  { flex: '`flex: 2`', grow: '2', shrink: '1', basis: '0%' },
  { flex: '`flex: auto`', grow: '1', shrink: '1', basis: 'auto' },
  { flex: '`flex: none`', grow: '0', shrink: '0', basis: 'auto' },
  { flex: '`flex: 1 0`', grow: '1', shrink: '0', basis: '0%' },
  { flex: '`flex: 0 0 120px`', grow: '0', shrink: '0', basis: '120px' },
];

/** `getComputedStyle(el).minWidth` на стенде. */
export const MIN_WIDTH_COMPUTED = { flexItem: 'auto', block: '0px' };

export const SHORTHAND_NOTE =
  'Главная разница — в базовом размере. `flex: 1` ставит базовый размер `0%`, и всё место делится по долям: колонки равны, сколько бы текста в них ни было. `flex: auto` начинает с ширины содержимого и делит только остаток — длинный текст получает больше.';

export const BASIS_ROWS = ['flex-1', 'flex-auto'].map((id) => fixtureRow(flexFixture(id)));

// ─── Раздел 3. Сжатие и min-width: auto ────────────────────────────────────────────────────

export const PLAIN_SHRINK =
  'Как урезают бюджет. Режут не поровну, а пропорционально размеру статьи: с большой статьи снимают больше. Но у некоторых статей есть неснижаемый минимум — зарплаты. Их урезают только до него, а недостачу добирают с остальных. А если неснижаемые минимумы вместе больше бюджета — перерасход. В раскладке перерасход — это переполнение: строка вылезает за контейнер.';

export const SHRINK_ROWS = ['shrink', 'shrink-auto', 'shrink-zero', 'shrink-overflow-hidden', 'flex-1-narrow'].map((id) =>
  fixtureRow(flexFixture(id)),
);

export const MIN_AUTO_NOTE =
  'У обычного блока `min-width: auto` означает ноль. У флекс-элемента — **автоматический минимум**: его min-content, а если задана `width` — меньшее из двух. Элемент с текстом поэтому не сжимается уже самого длинного слова. Для ссылки или `<pre>` «самое длинное слово» — вся строка целиком. Автоматического минимума нет у элемента с `overflow`, отличным от `visible`: у него минимум ноль.';

export const MIN_AUTO_COMPUTED_NOTE =
  'Из JS этот минимум не прочитать: `getComputedStyle(el).minWidth` у флекс-элемента на стенде вернул строку `auto`, у обычного блока — `0px`. Число 249.64 существует только внутри раскладки.';

/** Ссылка в контейнере 300 px рядом с «ok», оба `flex: 0 1 200px`: ширина ссылки и строк. */
export const FIX_ROWS = [
  { k: 'ничего', w: 249.640625, lines: 1, d: 'Стоит на min-content, «ok» сжался до 50.36.', tone: 'err' as const },
  { k: '`min-width: 0`', w: 150, lines: 1, d: 'Сжалась, текст вылезает из элемента поверх соседа.', tone: 'warn' as const },
  { k: '`overflow: hidden`', w: 150, lines: 1, d: 'Сжалась, лишнее обрезано.', tone: 'ok' as const },
  { k: '`overflow-wrap: anywhere`', w: 150, lines: 2, d: 'Сжалась и перенеслась на две строки: перенос внутри слова уменьшает сам min-content.', tone: 'ok' as const },
  { k: '`word-break: break-all`', w: 150, lines: 2, d: 'То же, но рвёт и обычные слова в любом месте.', tone: 'ok' as const },
  { k: '`overflow-wrap: break-word`', w: 249.640625, lines: 1, d: '**Не помогла.** Этот перенос включается, только когда слово уже вылезло, и min-content не трогает.', tone: 'err' as const },
];

export const FIX_NOTE =
  'Выбор зависит от того, что нужно увидеть. Длинное имя файла в карточке — `min-width: 0` и `text-overflow: ellipsis` с `overflow: hidden`. Ссылка в тексте сообщения — `overflow-wrap: anywhere`. Вложенный флекс, где сжаться должен внутренний контейнер, — `min-width: 0` на **каждом** уровне: автоматический минимум внешнего элемента — это min-content внутреннего, вместе со всем его содержимым.';

export const DEMO_SCENARIOS: FlexScenario[] = [
  {
    id: 'grow',
    label: 'Рост',
    container: 600,
    items: flexFixture('grow').items,
    note: 'Три элемента по 100 px, `flex-grow` 1, 2 и 3. Пока базовые размеры влезают, свободное место делится по долям 1 : 2 : 3 при любой ширине контейнера. Если контейнер уже 300 px, работает `flex-shrink`, и доли роста ничего не значат.',
  },
  {
    id: 'max',
    label: 'Упор в max',
    container: 600,
    items: flexFixture('grow-max').items,
    note: 'У A `max-width: 120px`. Первый проход даёт ему больше потолка — его замораживают, и излишек уходит соседям во втором проходе.',
  },
  {
    id: 'shrink',
    label: 'Сжатие',
    container: 300,
    items: flexFixture('shrink').items,
    note: 'Базовые размеры 300, 200 и 100 в контейнере 300. Нехватка делится по весу `flex-shrink` × базовый размер: широкий отдаёт больше.',
  },
  {
    id: 'word',
    label: 'Длинное слово',
    container: 300,
    items: flexFixture('shrink-auto').items,
    note: 'Минимум A — min-content ссылки, 249.64 px: так работает `min-width: auto`. Пока контейнер шире суммы минимумов, сжимается только B; уже 268.84 px строка вылезает за край.',
  },
];

export const DEMO_CAPTION =
  'Полосы «по функции» считает `resolveFlex` выше — та самая строка, что напечатана на странице. Полосы «в браузере» — настоящий флекс-контейнер с теми же `flex`, `min-width` и `max-width`: его ширины прочитаны из `getBoundingClientRect` прямо в вашей вкладке. Если они разойдутся больше чем на 1/64 px, расхождение будет видно в таблице.';

// ─── Раздел 4. Grid: треки и fr ────────────────────────────────────────────────────────────

export const PLAIN_FR =
  'Как делят пиццу на компанию. Сначала откладывают куски, которые заказали заранее, — это колонки в пикселях и промежутки `gap`. Остаток делят по долям: `1fr` — одна доля, `2fr` — две. Но если кто-то не наедается своей долей — его колонка не может быть уже содержимого, — ему отдают сколько нужно, и остаток делят между остальными заново.';

export const FR_CODE = `// Ширины колонок грида. CSS Grid, §12.7 «Expand Flexible Tracks».
// track: { px } — фиксированная; { fr, min } — гибкая. min — нижняя граница:
// у 1fr (это minmax(auto, 1fr)) — min-content содержимого, у minmax(0, 1fr) — 0.
function resolveFr(container, tracks, gap = 0) {
  const space = container - gap * (tracks.length - 1);
  const asFixed = new Set();             // гибкие, которым доля оказалась мала
  for (;;) {
    let leftover = space;
    let sumFr = 0;
    tracks.forEach((t, i) => {
      if (t.fr == null) leftover -= t.px;
      else if (asFixed.has(i)) leftover -= t.min;
      else sumFr += t.fr;
    });
    const frSize = leftover / Math.max(1, sumFr);   // сумма меньше 1 — делим на 1
    const tooSmall = tracks
      .map((_, i) => i)
      .filter((i) => tracks[i].fr != null && !asFixed.has(i)
        && frSize * tracks[i].fr < tracks[i].min);
    if (!tooSmall.length) {
      return {
        frSize,
        sizes: tracks.map((t, i) =>
          t.fr == null ? t.px : asFixed.has(i) ? t.min : frSize * t.fr),
      };
    }
    tooSmall.forEach((i) => asFixed.add(i));   // такой трек считаем фиксированным
  }
}

// repeat(auto-fill | auto-fit, minmax(min, 1fr)): сколько колонок поставить.
function autoRepeat(container, min, gap, itemCount, fit) {
  const count = Math.max(1, Math.floor((container + gap) / (min + gap)));
  return fit ? Math.min(count, itemCount) : count;   // auto-fit убирает пустые
}`;

export interface FrFixture {
  id: string;
  css: string;
  container: number;
  gap: number;
  tracks: FrTrack[];
  measured: number[];
  how: string;
}

export const FR_FIXTURES: FrFixture[] = [
  {
    id: 'fr',
    css: '600 px; `1fr 2fr`',
    container: 600,
    gap: 0,
    tracks: [{ fr: 1, min: 0 }, { fr: 2, min: 0 }],
    measured: [200, 400],
    how: 'Одна доля — 600 / 3 = 200.',
  },
  {
    id: 'fr-gap',
    css: '600 px; `1fr 2fr`, `column-gap: 20px`',
    container: 600,
    gap: 20,
    tracks: [{ fr: 1, min: 0 }, { fr: 2, min: 0 }],
    measured: [193.328125, 386.671875],
    how: 'Сначала вычитается промежуток: 580 / 3. Chromium округлил долю до 1/64 px.',
  },
  {
    id: 'fr-fixed',
    css: '800 px; `200px 1fr 1fr`',
    container: 800,
    gap: 0,
    tracks: [{ px: 200 }, { fr: 1, min: 0 }, { fr: 1, min: 0 }],
    measured: [200, 300, 300],
    how: 'Фиксированная колонка забирает своё, остаток 600 делится на две доли.',
  },
  {
    id: 'fr-sum-lt1',
    css: '600 px; `0.25fr 0.25fr`',
    container: 600,
    gap: 0,
    tracks: [{ fr: 0.25, min: 0 }, { fr: 0.25, min: 0 }],
    measured: [150, 150],
    how: 'Сумма долей 0.5 — делим на 1, а не на 0.5. Каждой колонке четверть, половина места пуста.',
  },
  {
    id: 'fr-auto-min',
    css: '400 px; `1fr 1fr`, в первой колонке ссылка',
    container: 400,
    gap: 0,
    tracks: [{ fr: 1, min: T.url.min }, { fr: 1, min: T.ok.min }],
    measured: [249.640625, 150.359375],
    how: 'Доля 200 меньше min-content ссылки. Её колонка становится фиксированной на 249.64, вторая получает остаток 150.36.',
  },
  {
    id: 'fr-zero-min',
    css: '400 px; `minmax(0, 1fr) 1fr`, ссылка в первой',
    container: 400,
    gap: 0,
    tracks: [{ fr: 1, min: 0 }, { fr: 1, min: T.ok.min }],
    measured: [200, 200],
    how: 'У первой колонки нижняя граница 0 — колонки равны, ссылка вылезает из своей клетки.',
  },
  {
    id: 'fr-auto-min-narrow',
    css: '200 px; `1fr 1fr`, ссылка в первой',
    container: 200,
    gap: 0,
    tracks: [{ fr: 1, min: T.url.min }, { fr: 1, min: T.ok.min }],
    measured: [249.640625, 19.203125],
    how: 'Обе колонки на своих min-content, сетка шире контейнера на 68.84.',
  },
];

export const FR_ROWS = FR_FIXTURES.map((f) => [f.css, f.how, f.measured.map(px).join(' · ')]);

export const FR_NOTE =
  '`1fr` — сокращение от `minmax(auto, 1fr)`, и `auto` в нижней границе означает то же, что `min-width: auto` у флекс-элемента: min-content содержимого. Поэтому «равные» колонки `1fr 1fr` равны, только пока содержимое помещается в долю. Если нужны равные при любом содержимом — `repeat(2, minmax(0, 1fr))`.';

export const FR_VS_FLEX_NOTE =
  'Сумма долей меньше единицы ведёт себя в обеих раскладках одинаково по смыслу: место остаётся пустым. Но числа разные. Флекс с `flex: 0.25 1 100px` дал 200 и 200 — базовые 100 плюс четверть свободных 400. Грид с `0.25fr 0.25fr` — 150 и 150: у трека нет базового размера, четверть берётся от всех 600.';

export interface RepeatFixture {
  id: 'auto-fill' | 'auto-fit';
  css: string;
  container: number;
  gap: number;
  min: number;
  items: number;
  /** Ширины и левые края двух элементов в Chromium. */
  measured: number[];
  x: number[];
  d: string;
}

export const REPEAT_FIXTURES: RepeatFixture[] = [
  {
    id: 'auto-fill',
    css: '`repeat(auto-fill, minmax(150px, 1fr))`',
    container: 700,
    gap: 10,
    min: 150,
    items: 2,
    measured: [167.5, 167.5],
    x: [0, 177.5],
    d: 'Влезает четыре колонки по 150 с промежутками: (700 + 10) / (150 + 10) = 4.4. Четыре колонки по 167.5; две заняты, две стоят пустыми.',
  },
  {
    id: 'auto-fit',
    css: '`repeat(auto-fit, minmax(150px, 1fr))`',
    container: 700,
    gap: 10,
    min: 150,
    items: 2,
    measured: [345, 345],
    x: [0, 355],
    d: 'Те же четыре колонки, но пустые схлопываются в ноль вместе с промежутками. Две оставшиеся делят всё место: (700 − 10) / 2 = 345.',
  },
];

// ─── Раздел 5. Авторасстановка ─────────────────────────────────────────────────────────────

export const PLACE_CODE = `// Авторасстановка по строкам: grid-auto-flow: row | row dense.
// CSS Grid, §8.5. spans — сколько колонок занимает каждый элемент.
function autoPlace(columns, spans, dense) {
  const taken = [];                        // taken[строка][колонка]
  const fits = (r, c, span) => {
    for (let k = 0; k < span; k++) {
      if (c + k >= columns || taken[r]?.[c + k]) return false;
    }
    return true;
  };
  let row = 0, col = 0;                    // курсор
  return spans.map((span) => {
    if (dense) { row = 0; col = 0; }       // dense ищет с самого начала
    while (!fits(row, col, span)) {
      col++;
      if (col + span > columns) { col = 0; row++; }
    }
    for (let k = 0; k < span; k++) (taken[row] ??= [])[col + k] = true;
    const placed = { row: row + 1, col: col + 1, span };
    col += span;                           // без dense курсор только вперёд
    return placed;
  });
}`;

export const PLACE_COLUMNS = 3;
export const PLACE_SPANS = [2, 2, 1, 1];
export const PLACE_NAMES = ['A', 'B', 'C', 'D'];

/** Chromium, сетка `repeat(3, 100px)`, элементы `grid-column: span N`, позиции по координатам. */
export const PLACE_SPARSE: Placed[] = [
  { row: 1, col: 1, span: 2 },
  { row: 2, col: 1, span: 2 },
  { row: 2, col: 3, span: 1 },
  { row: 3, col: 1, span: 1 },
];
export const PLACE_DENSE: Placed[] = [
  { row: 1, col: 1, span: 2 },
  { row: 2, col: 1, span: 2 },
  { row: 1, col: 3, span: 1 },
  { row: 2, col: 3, span: 1 },
];

export const PLACE_CSS = `.grid {
  display: grid;
  grid-template-columns: repeat(3, 100px);
  grid-auto-flow: row;          /* или row dense */
}
.a, .b { grid-column: span 2; }  /* C и D — по одной колонке */`;

export const PLACE_NOTE =
  'Без `dense` B не влез в первую строку рядом с A — осталась дыра в третьей колонке. Курсор ушёл вперёд, и C с D её уже не видят: C встал после B, D — в третью строку. С `dense` поиск каждый раз начинается с начала сетки: C занял дыру, D встал под ним, сетка стала на строку ниже. Порядок на экране теперь A, C, B, D — а в DOM он прежний.';

export const PLACE_WARN =
  'Порядок клавиши Tab и экранного диктора идёт по DOM, а не по картинке. После `dense` пользователь с клавиатуры прыгает из первой строки во вторую и обратно. Для галереи одинаковых карточек это неважно, для формы или меню — важно.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`flex: 1` не гарантирует равных колонок',
    d: 'Базовый размер у всех ноль, но нижняя граница — min-content. Колонка с длинной ссылкой не станет уже ссылки: в контейнере 300 px она заняла 249.64, сосед — остальное. Лечится `min-width: 0` или `overflow: hidden` на элементе.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`flex-shrink` сжимает не поровну',
    d: 'Нехватка делится по `flex-shrink` × базовый размер. Три элемента 300, 200 и 100 в контейнере 300 отдали 150, 100 и 50: каждый сжался вдвое, а не на одинаковые 100 px. Узкий элемент почти не теряет, широкий теряет много.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`1fr` — это `minmax(auto, 1fr)`',
    d: 'Ссылка в колонке `1fr 1fr` на 400 px сделала колонки 249.64 и 150.36. Равные колонки при любом содержимом — `minmax(0, 1fr)`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Минимум флекс-элемента не прочитать из стилей',
    d: '`getComputedStyle(el).minWidth` у флекс-элемента — `auto`, у блока — `0px`. Настоящий минимум считается внутри раскладки. Узнать его можно только косвенно: поставить элементу `width: min-content` и измерить.',
  },
  {
    n: '05',
    t: '`overflow-wrap: break-word` не спасает флекс-элемент',
    d: 'Он переносит слово, только когда оно уже вылезло, и min-content не меняет: ссылка осталась 249.64 px. `overflow-wrap: anywhere` уменьшает min-content — ссылка сжалась до 150 и перенеслась.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`overflow: hidden` меняет размер, а не только обрезку',
    d: 'У элемента с `overflow`, отличным от `visible`, автоматического минимума нет. Добавили `overflow: hidden` ради скругления углов — и колонка вдруг стала сжиматься. Это не ошибка, а то же правило.',
  },
  {
    n: '07',
    t: 'Сумма долей меньше 1 оставляет место пустым',
    d: 'Два `flex-grow: 0.25` раздают только половину свободного места, две колонки `0.25fr` занимают только половину сетки. Результат разный — 200 против 150 при тех же 600 px, — потому что у флекса есть базовый размер, а у трека нет.',
  },
  {
    n: '08',
    t: 'Размеры дробные, и не в десятичных долях',
    d: 'Chromium хранит координаты в 1/64 пикселя. `1fr 2fr` с промежутком 20 в 600 px — это 193.328125, а не 193.333…. Сравнивать `getBoundingClientRect` с расчётом строго нельзя — только с допуском.',
  },
  {
    n: '09',
    t: '`dense` переставляет элементы на экране, но не в DOM',
    d: 'Клавиатура и диктор идут по DOM. С `dense` элемент C оказался в первой строке, а Tab попадёт на него после B из второй.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'CSS Flexible Box Layout Level 1 — §9.7 Resolving Flexible Lengths',
    href: 'https://www.w3.org/TR/css-flexbox-1/#resolve-flexible-lengths',
    what: 'алгоритм раздачи: гипотетический размер, заморозка, сумма факторов меньше 1, взвешенный `flex-shrink`',
  },
  {
    title: 'CSS Flexible Box Layout Level 1 — §4.5 Automatic Minimum Size',
    href: 'https://www.w3.org/TR/css-flexbox-1/#min-size-auto',
    what: 'откуда у флекс-элемента минимум min-content и почему его нет у скролл-контейнера',
  },
  {
    title: 'CSS Grid Layout Level 2 — §12.7 Expand Flexible Tracks',
    href: 'https://www.w3.org/TR/css-grid-2/#algo-flex-tracks',
    what: 'поиск размера `fr`, треки, которые перестают быть гибкими',
  },
  {
    title: 'CSS Grid Layout Level 2 — §8.5 Grid Item Placement Algorithm',
    href: 'https://www.w3.org/TR/css-grid-2/#auto-placement-algo',
    what: 'курсор авторасстановки, `dense`',
  },
  {
    title: 'CSS Box Sizing Level 3 — Intrinsic Size Determination',
    href: 'https://www.w3.org/TR/css-sizing-3/#intrinsic-sizes',
    what: 'min-content, max-content, fit-content',
  },
  {
    title: 'CSS Text Level 3 — `overflow-wrap`',
    href: 'https://www.w3.org/TR/css-text-3/#overflow-wrap-property',
    what: 'почему `anywhere` влияет на min-content, а `break-word` — нет',
  },
];

export const RELATED =
  'Смежное на сайте: [Кадр браузера, раздел «Чтение и запись»](/render/render-pipeline/#s3) — когда раскладку считают вне очереди и как `contain` сужает её пересчёт. [Каскад и вычисление стилей, раздел «Стадии значения и цена чтения из JS»](/render/css-cascade/#s4) — почему `width` известна только после раскладки. [Критический путь и Web Vitals, раздел «CLS»](/render/rendering-crp/#s3) — что видит пользователь, когда размер меняется после первой отрисовки. [Длинные списки, раздел «Разная высота»](/render/virtual-lists/#s3) — что делать, когда высоту строки знают только после раскладки. [Адаптивность изнутри](/render/responsive/) — вьюпорт, `svh`/`dvh`, `em` в медиазапросах, что ломает `container-type` и `clamp` при масштабе.';
