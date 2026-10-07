import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ModuleFile, TwFile } from '@/widgets/css-tooling-lab/model/types';

/**
 * Данные темы «CSS-инструменты: PostCSS, CSS-модули и Tailwind».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Всё из `node_modules` проекта, конфиги проекта не тронуты — каждая библиотека вызвана из Node
 * на фикстурах в каталоге стенда: postcss **8.5.28**, lightningcss **1.33.0**, browserslist
 * 4.28.9, caniuse-lite 1.0.30001810, tailwindcss / `@tailwindcss/postcss` / `@tailwindcss/node` /
 * `@tailwindcss/oxide` **4.3.3**, Vite **8.3.0** (внутри — postcss-modules 9.0.1 и string-hash
 * 1.1.3), `@vitejs/plugin-vue` 6.0.8, Vue 3.5.42. Node 24.11.0, Chromium 153.0.8010.12
 * (Playwright 1.63), октябрь 2026.
 *
 * Что снято:
 *   — дерево PostCSS: `postcss.parse(BUTTON_CSS)`, тип узла, селектор/имя/свойство и
 *     `source.start`. Плагины `PREFIX_PLUGIN_CODE` и `NAIVE_PLUGIN_CODE` исполнены настоящим
 *     `postcss([…]).process`; число заходов посчитано счётчиком в посетителе;
 *   — lightningcss: `transform({ targets: browserslistToTargets(browserslist(q)) })` для трёх
 *     запросов из `LOWER_TARGETS`; предупреждений ноль во всех трёх. Версии поддержки `@layer`
 *     и вложенности — из caniuse-lite (`css-cascade-layers`, `css-nesting`);
 *   — Vite: `build({ configFile: false })` фикстуры с тремя CSS-модулями и двумя SFC; имена
 *     классов, экспорт модулей и CSS сборки (`minify: false`). Id `data-v-…` — сборка и
 *     dev-сервер (`createServer` в `middlewareMode`, `transformRequest`). Вложенный рендер
 *     `Card` → `Button` — SSR-сборка той же фикстуры и `renderToString`;
 *   — Vite и понижение CSS: та же `BUTTON_CSS` через `build` с `minify: true` и `false`
 *     и через dev-сервер — с `css.transformer` по умолчанию и с `'lightningcss'`;
 *   — Tailwind: кандидаты — `new Scanner({}).getCandidatesWithPositions` из oxide, CSS —
 *     `compile('@import "tailwindcss" source(none);').build(кандидаты)` из `@tailwindcss/node`
 *     и, для всех файлов сразу, `@tailwindcss/postcss` с `source("./src")`. Байты —
 *     `Buffer.byteLength` несжатого вывода, без минификации;
 *   — порядок и слои — в Chromium 153 через `page.setContent` и `getComputedStyle`: CSS сборки
 *     `ORDER_*` и вывод Tailwind с `p-4` плюс правило `.btn` в трёх вариантах (`LAYER_PROBE`).
 *     Это единственное, что тест не пересобирает: в нём проверяется порядок правил в CSS
 *     сборки, а вывод «кто победил» следует из каскада.
 *
 * Только из документации, без запуска: autoprefixer (на стенде его нет — его работу показывает
 * учебный плагин и lightningcss), поведение браузеров, которые не знают `@layer` (выбрасывают
 * блок целиком — по CSS Syntax; Chrome 90 на стенде нет).
 *
 * Учебные функции — строки `MODULE_NAME_CODE` и `TW_SCAN_CODE`. Их печатает `CodeBlock`,
 * исполняют демо и `tests/unit/css-tooling.test.ts`: имена CSS-модулей сверяются с Vite
 * посимвольно, сканер — с oxide по набору сгенерированных утилит.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'PostCSS',
    d: 'Программа, которая разбирает CSS в дерево, отдаёт дерево плагинам и печатает результат обратно в текст. Сама она стили не меняет — меняют плагины.',
  },
  {
    k: 'узел дерева',
    d: 'Кусок CSS в разобранном виде: правило с селектором, объявление «свойство: значение», at-правило вроде `@layer` или `@media`. У каждого узла есть тип, родитель и место в исходнике.',
  },
  {
    k: 'targets (цели)',
    d: 'Список браузеров и версий, под которые собирается CSS. По нему инструмент решает, что оставить как есть, а что переписать старыми средствами.',
  },
  {
    k: 'CSS-модуль',
    d: 'Файл `*.module.css`. Сборщик переименовывает в нём каждый класс в уникальное имя и отдаёт в JS объект «старое имя → новое».',
  },
  {
    k: '`scoped` во Vue',
    d: 'Атрибут у `<style>` в однофайловом компоненте. Компилятор помечает элементы компонента атрибутом `data-v-…` и дописывает этот атрибут в каждый селектор.',
  },
  {
    k: 'утилитарный класс',
    d: 'Класс, который делает одну вещь: `px-4` — отступы слева и справа, `bg-red-500` — цвет фона. Tailwind состоит из таких классов.',
  },
  {
    k: 'кандидат',
    d: 'Слово из исходников, похожее на класс Tailwind. Сканер собирает кандидатов из всех файлов, а Tailwind пишет CSS только для тех, кого узнал.',
  },
  {
    k: '`@layer`',
    d: 'Каскадный слой: группа правил с общим приоритетом. Правило из более позднего слоя побеждает правило из раннего, даже если его селектор слабее.',
  },
];

export const PLAIN_PIPELINE =
  'Как редактура рукописи. Автор пишет как удобно ему: с сокращениями, своими пометками, без оглядки на тираж. Редакторы по очереди проходят текст: один расшифровывает сокращения для читателей со старым словарём, другой добавляет на каждую страницу уникальный колонтитул, чтобы листы из разных книг не перепутались. До типографии доходит текст, который автор не писал, но который значит то же самое.';

export const PREREQ_NOTE =
  'Тема собирает в одном месте то, что на сайте разобрано по частям: каскад, дерево разбора, цели сборки и блокировку рендеринга. Каждая часть здесь — одной фразой и ссылкой.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Каскад и слои',
    d: 'Когда два правила задают одно свойство, браузер решает спор по порядку проверок: происхождение и `!important`, слой, специфичность, порядок в файле. Слой сильнее специфичности, порядок слабее всего.',
    href: '/render/css-cascade/#s1',
    hrefLabel: '«Каскад и вычисление стилей», раздел «Шесть критериев»',
    tone: 'info',
  },
  {
    t: 'Текст разбирают в дерево и обходят',
    d: 'Инструмент превращает текст в дерево узлов, обходит его в глубину и вызывает обработчики на входе в узлы нужного типа. ESLint делает так с JavaScript, PostCSS — с CSS.',
    href: '/tooling/ast-linters/#s2',
    hrefLabel: '«AST и линтеры», раздел «Обход и селекторы»',
    tone: 'info',
  },
  {
    t: 'Цели сборки и browserslist',
    d: 'Строка вроде `chrome 90, safari 14` превращается в список версий, а таблица «с какой версии браузер умеет» решает, что переписывать. Для CSS таблица своя, логика та же.',
    href: '/tooling/transpilation/#s2',
    hrefLabel: '«Транспиляция и полифилы», раздел «От запроса к плагинам»',
    tone: 'info',
  },
  {
    t: 'CSS задерживает первый кадр',
    d: 'Браузер не рисует страницу, пока не загрузит и не разберёт CSS из `<head>`. Поэтому размер и число CSS-файлов сказываются на том, когда пользователь увидит страницу.',
    href: '/render/rendering-crp/#s1',
    hrefLabel: '«Критический путь и Web Vitals», раздел «Критический путь»',
    tone: 'info',
  },
];

// ─── Раздел 1. PostCSS: CSS как дерево ─────────────────────────────────────────────────────

/** Сквозной пример: стиль кнопки. На нём сняты дерево, плагин, lightningcss и Vite. */
export const BUTTON_CSS = `@layer components {
  .button {
    padding: 8px 16px;
    color: white;
    background: oklch(62% 0.19 255);
    border: 1px solid color-mix(in oklch, oklch(62% 0.19 255) 70%, black);
    user-select: none;

    &:hover {
      background: color-mix(in oklch, var(--brand) 85%, white);
    }
  }
}
`;

export const PLAIN_TREE =
  'Как оглавление книги вместо сплошного текста. В тексте трудно найти «все абзацы про цвет во второй главе». В оглавлении видно, что внутри чего лежит: глава, раздел, пункт. Плагину PostCSS не нужно искать по тексту фигурные скобки — он идёт по оглавлению и смотрит только на нужные пункты.';

/** Дерево `postcss.parse(BUTTON_CSS)`: глубина, тип узла, что в нём, строка:колонка начала. */
export const POSTCSS_TREE: { depth: number; type: string; text: string; pos: string }[] = [
  { depth: 0, type: 'root', text: '', pos: '1:1' },
  { depth: 1, type: 'atrule', text: '@layer components', pos: '1:1' },
  { depth: 2, type: 'rule', text: '.button', pos: '2:3' },
  { depth: 3, type: 'decl', text: 'padding: 8px 16px', pos: '3:5' },
  { depth: 3, type: 'decl', text: 'color: white', pos: '4:5' },
  { depth: 3, type: 'decl', text: 'background: oklch(62% 0.19 255)', pos: '5:5' },
  { depth: 3, type: 'decl', text: 'border: 1px solid color-mix(in oklch, oklch(62% 0.19 255) 70%, black)', pos: '6:5' },
  { depth: 3, type: 'decl', text: 'user-select: none', pos: '7:5' },
  { depth: 3, type: 'rule', text: '&:hover', pos: '9:5' },
  { depth: 4, type: 'decl', text: 'background: color-mix(in oklch, var(--brand) 85%, white)', pos: '10:7' },
];

/** Дерево для печати: отступ — вложенность. Собирается из `POSTCSS_TREE`, чтобы не разойтись. */
export const POSTCSS_TREE_PRINT = POSTCSS_TREE.map(
  (n) => `${'  '.repeat(n.depth)}${n.type === 'root' ? 'Root' : n.type === 'atrule' ? 'AtRule' : n.type === 'rule' ? 'Rule' : 'Declaration'}${n.text ? `  ${n.text}` : ''}    ${n.pos}`,
).join('\n');

export const NODE_TYPES = [
  { k: 'Root', v: '`root`', d: 'Весь файл. Его дети — правила и at-правила верхнего уровня.' },
  { k: 'AtRule', v: '`atrule`', d: 'Всё, что начинается с `@`: `@layer`, `@media`, `@import`. Имя (`name`) и всё после него (`params`) хранятся отдельно; тело может быть, а может и не быть.' },
  { k: 'Rule', v: '`rule`', d: 'Селектор и блок в фигурных скобках. Селектор — просто строка: PostCSS его не разбирает, для этого есть отдельные парсеры селекторов.' },
  { k: 'Declaration', v: '`decl`', d: 'Свойство и значение. Значение — тоже строка: `color-mix(…)` для PostCSS ничем не отличается от `white`.' },
  { k: 'Comment', v: '`comment`', d: 'Комментарий. В дереве он есть, поэтому плагин может его прочитать или удалить.' },
];

/**
 * Учебный автопрефиксер на одно свойство. Исполняется тестом настоящим `postcss` — вывод
 * совпадает с `PREFIX_OUT`, а посетитель вызывается ровно один раз.
 */
export const PREFIX_PLUGIN_CODE = `// Плагин — функция, которая возвращает объект с посетителями.
const prefixUserSelect = () => ({
  postcssPlugin: 'prefix-user-select',
  // Посетитель только для объявлений со свойством user-select.
  Declaration: {
    'user-select'(decl) {
      decl.cloneBefore({ prop: '-webkit-user-select' });
    },
  },
});
prefixUserSelect.postcss = true;

// postcss([prefixUserSelect]).process(css, { from: 'button.css' })`;

/** Строки 6–8 вывода: всё остальное PostCSS напечатал байт в байт как было. */
export const PREFIX_OUT = `    border: 1px solid color-mix(in oklch, oklch(62% 0.19 255) 70%, black);
    -webkit-user-select: none;
    user-select: none;
`;

export const POSTCSS_FACTS = [
  {
    t: 'Дерево помнит пробелы',
    d: 'У каждого узла есть `raws` — отступ перед ним, пробел после двоеточия, точка с запятой в конце. Поэтому `root.toString()` на нетронутом дереве возвращает исходный файл байт в байт, а плагин меняет только то, к чему прикоснулся.',
  },
  {
    t: 'Изменённый узел обходят ещё раз',
    d: 'PostCSS повторяет обход, пока дерево меняется. Плагин выше добавил узел — и тот тоже пришёл в посетители: счётчик на всех объявлениях насчитал **7 заходов на 6 исходных деклараций**. Так плагины видят работу друг друга без отдельного прохода на каждый.',
    tone: 'warn' as const,
  },
  {
    t: 'Плагины работают в одном обходе',
    d: 'В PostCSS 8 плагины не идут по дереву по очереди. Обход один, и на каждом узле вызываются посетители всех плагинов подряд. Поэтому десять плагинов не означают десяти проходов по файлу.',
  },
];

/** Ошибка, которую ловит повторный обход: фильтр пропускает и свой же результат. */
export const NAIVE_PLUGIN_CODE = `Declaration(decl) {
  // -webkit-user-select тоже кончается на user-select —
  // клон снова попадает сюда и клонирует себя, и так без конца
  if (decl.prop.endsWith('user-select')) {
    decl.cloneBefore({ prop: '-webkit-user-select' });
  }
}`;

export const NAIVE_NOTE =
  'Защиты от зацикливания в PostCSS нет. Тест темы останавливает такой плагин счётчиком на 51-м заходе — сам PostCSS крутился бы дальше. Посетитель с именем свойства (`\'user-select\'`) или проверка «префикс уже стоит» обрывают цикл.';

// ─── Раздел 2. Понижение: lightningcss и targets ───────────────────────────────────────────

export const PLAIN_FALLBACK =
  'Как табличка на двух языках. Сначала надпись, понятная всем, ниже — точнее, но на языке, который знают не все. Старый браузер читает строку `background: lab(…)`, не понимает её и пропускает: в силе остаётся предыдущая, `background: #1d84f5`. Новый понимает обе и применяет последнюю.';

export const LOWER_TARGETS: { id: string; label: string; query: string; out: string; bytes: number }[] = [
  {
    id: 'old',
    label: 'старые браузеры',
    query: 'chrome 90, safari 14, firefox 88',
    out: `@layer components {
  .button {
    color: #fff;
    -webkit-user-select: none;
    user-select: none;
    background: #1d84f5;
    background: color(display-p3 .251502 .511625 .928377);
    background: lab(54.4886% 3.96594 -65.2307);
    border: 1px solid #004da9;
    border: 1px solid color(display-p3 -.0291501 .281579 .683413);
    border: 1px solid lab(32.3348% 13.6562 -64.8785);
    padding: 8px 16px;
  }

  .button:hover {
    background: color-mix(in oklch, var(--brand) 85%, white);
  }
}
`,
    bytes: 501,
  },
  {
    id: 'vite',
    label: 'цель Vite 8 по умолчанию',
    query: 'chrome 111, edge 111, firefox 114, safari 16.4, ios_saf 16.4',
    out: `@layer components {
  .button {
    color: #fff;
    -webkit-user-select: none;
    user-select: none;
    background: oklch(62% .19 255);
    border: 1px solid oklch(43.4% .19 255);
    padding: 8px 16px;
  }

  .button:hover {
    background: color-mix(in oklch, var(--brand) 85%, white);
  }
}
`,
    bytes: 297,
  },
  {
    id: 'fresh',
    label: 'свежие браузеры',
    query: 'chrome 130, safari 18, firefox 130',
    out: `@layer components {
  .button {
    color: #fff;
    -webkit-user-select: none;
    user-select: none;
    background: oklch(62% .19 255);
    border: 1px solid oklch(43.4% .19 255);
    padding: 8px 16px;

    &:hover {
      background: color-mix(in oklch, var(--brand) 85%, white);
    }
  }
}
`,
    bytes: 297,
  },
];

export const LOWER_CODE = `import { transform, browserslistToTargets } from 'lightningcss';
import browserslist from 'browserslist';

const { code } = transform({
  filename: 'button.css',
  code: Buffer.from(css),
  targets: browserslistToTargets(browserslist('chrome 90, safari 14, firefox 88')),
});`;

/** Что lightningcss сделал с каждой конструкцией `BUTTON_CSS` под три цели. */
export const LOWER_ROWS: { k: string; old: string; vite: string; fresh: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`&:hover` внутри `.button`', old: 'развёрнуто в `.button:hover`', vite: 'развёрнуто', fresh: 'оставлено', tone: 'ok' },
  { k: '`oklch(62% 0.19 255)`', old: 'три строки: hex, `display-p3`, `lab`', vite: 'оставлено', fresh: 'оставлено', tone: 'ok' },
  { k: '`color-mix(…)` из констант', old: 'вычислено и переписано тремя строками', vite: 'вычислено: `oklch(43.4% .19 255)`', fresh: 'вычислено', tone: 'ok' },
  { k: '`color-mix(…)` с `var(--brand)`', old: '**оставлено как есть**', vite: 'оставлено', fresh: 'оставлено', tone: 'err' },
  { k: '`user-select`', old: 'добавлен `-webkit-`', vite: 'добавлен', fresh: 'добавлен', tone: 'ok' },
  { k: '`@layer components`', old: '**оставлено как есть**', vite: 'оставлено', fresh: 'оставлено', tone: 'err' },
];

export const LOWER_FACTS = [
  {
    t: 'Переписать можно только то, что известно при сборке',
    d: 'Смесь двух констант lightningcss посчитал сам. Смесь с `var(--brand)` посчитать нельзя: значение переменной станет известно только в браузере. Такая строка уходит как есть, и браузер без `color-mix` её просто выбросит. Предупреждений при этом ноль.',
    tone: 'err' as const,
  },
  {
    t: '`@layer` не понижается',
    d: 'Слои поддерживаются с Chrome 99, Safari 15.4 и Firefox 97. Все три старые цели младше, но блок `@layer` остался нетронутым и без предупреждения. Браузер, который не знает at-правила, выбрасывает блок целиком — вместе с кнопкой.',
    tone: 'err' as const,
  },
  {
    t: 'Префиксы — тоже понижение',
    d: '`-webkit-user-select` lightningcss добавил под все три цели: Safari до сих пор требует префикс. Это та же работа, что у autoprefixer — плагина PostCSS, который делает только её, по тем же таблицам caniuse.',
  },
  {
    t: 'Порядок деклараций меняется',
    d: '`padding` переехал в конец правила: lightningcss собирает и перепечатывает объявления сам. На результат это не влияет, пока одно свойство не задано дважды, — тогда порядок решает всё, и запасные строки он ставит строго перед основной.',
  },
];

/** Где в Vite 8 происходит понижение CSS. Снято на `BUTTON_CSS`. */
export const VITE_LOWER_ROWS: { k: string; how: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`vite build`', how: 'Понижено: вложенность развёрнута, `color-mix` из констант вычислен, префикс добавлен. Делает это минификатор — lightningcss с целью `build.cssTarget`.', tone: 'ok' },
  { k: '`vite build` с `minify: false`', how: 'Файл ушёл как написан: с `&:hover` внутри правила. Минификатор выключен — выключено и понижение.', tone: 'err' },
  { k: '`vite` (dev-сервер)', how: 'Тоже как написан. На dev-сервере минификации нет.', tone: 'warn' },
  { k: 'dev-сервер с `css.transformer: \'lightningcss\'`', how: 'Понижено, как в сборке: lightningcss обрабатывает каждый файл, а не только итоговый бандл.', tone: 'ok' },
];

export const VITE_LOWER_NOTE =
  'По умолчанию Vite 8 обрабатывает CSS через PostCSS, а lightningcss вызывает только для сжатия готового бандла — и заодно понижает. Цель по умолчанию — `chrome111`, `edge111`, `firefox114`, `safari16.4`, `ios16.4`. Отсюда расхождение: в dev браузер получает вложенность как есть, в продакшене — развёрнутой. В свежем браузере разницы не видно, в Safari 16.4 — видно.';

// ─── Раздел 3. CSS-модули ──────────────────────────────────────────────────────────────────

export const PLAIN_MODULES =
  'Как бирки в гардеробе. Курток с названием «чёрная» в зале десяток, и по названию свою не найти. Гардеробщик вешает на каждую номерок, а вам отдаёт жетон с тем же номером. Вы по-прежнему говорите «моя чёрная куртка», но выдают её по номерку — и чужую не перепутают.';

/** CSS-модуль кнопки. Путь в фикстуре — `src/components/Button.module.css`. */
export const MODULE_CSS = `.button {
  padding: 8px 16px;
  border-radius: 6px;
}

.primary {
  composes: button;
  background: oklch(62% 0.19 255);
}

:global(.dark) .primary {
  background: oklch(45% 0.15 255);
}
`;

/** Модуль карточки: тот же класс `.button`, другой файл. */
export const CARD_MODULE_CSS = `.button {
  border: 0;
  background: none;
}
`;

export const MODULE_USE_CODE = `import styles from './Button.module.css';
import card from '../card/Card.module.css';

styles.button;   // '_button_1dyov_1'
styles.primary;  // '_primary_1dyov_6 _button_1dyov_1'
card.button;     // '_button_1ybt6_1'

// <button class={styles.primary}>Оплатить</button>`;

/** CSS сборки Vite для `MODULE_CSS` (`minify: false`). */
export const MODULE_CSS_OUT = `._button_1dyov_1 {
  padding: 8px 16px;
  border-radius: 6px;
}

._primary_1dyov_6 {
  background: oklch(62% 0.19 255);
}

.dark ._primary_1dyov_6 {
  background: oklch(45% 0.15 255);
}`;

/** Экспорт модулей в сборке Vite: тест сверяет и с Vite, и с `moduleExports`. */
export const MODULE_EXPORTS: Record<string, Record<string, string>> = {
  'src/components/Button.module.css': { button: '_button_1dyov_1', primary: '_primary_1dyov_6 _button_1dyov_1' },
  'src/card/Card.module.css': { button: '_button_1ybt6_1' },
  'src/copy/Button.module.css': { button: '_button_1dyov_1', primary: '_primary_1dyov_6 _button_1dyov_1' },
};

/**
 * Учебная функция — имена CSS-модулей Vite по умолчанию. `stringHash` и `scopedName` повторяют
 * postcss-modules внутри Vite 8 дословно; `moduleExports` упрощена (см. комментарий в коде).
 * Исполняется демо и тестом; тест сверяет с Vite на фикстурах и на правках.
 */
export const MODULE_NAME_CODE = String.raw`// string-hash: этим хешем postcss-modules внутри Vite считает имена.
function stringHash(str) {
  let hash = 5381, i = str.length;
  while (i) hash = (hash * 33) ^ str.charCodeAt(--i);
  return hash >>> 0;                 // беззнаковое 32-битное число
}

// Имя по умолчанию: _<класс>_<5 знаков хеша>_<строка>.
// Хеш считается от текста всего файла. Путь к файлу в нём не участвует.
function scopedName(name, css) {
  const at = css.indexOf('.' + name);
  const line = css.slice(0, at).split(/[\r\n]/).length;
  return '_' + name + '_' + stringHash(css).toString(36).slice(0, 5) + '_' + line;
}

// Что модуль отдаёт в JS. Упрощено: правила без вложенности,
// :global(...) пропускается, composes — только классы этого же файла.
function moduleExports(css) {
  const out = {};
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const local = selector.replace(/:global\([^)]*\)/g, '');
    const names = [...local.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
    for (const n of names) out[n] ??= scopedName(n, css);
    const composes = /composes:\s*([^;]+);/.exec(body);
    if (!composes) continue;
    for (const n of names) {
      for (const c of composes[1].trim().split(/\s+/)) out[n] += ' ' + scopedName(c, css);
    }
  }
  return out;
}`;

export const MODULE_STEPS = [
  { k: '1. Хеш файла', d: '`stringHash` проходит весь текст `Button.module.css` с конца и даёт число 3 021 109 791. В записи по основанию 36 это `1dyov8f`, от него берутся первые пять знаков: `1dyov`.' },
  { k: '2. Номер строки', d: 'Первое вхождение `.button` — на первой строке, `.primary` — на шестой. Номер строки нужен, чтобы два класса одного файла с общим началом имени не столкнулись.' },
  { k: '3. Имя', d: 'Подчёркивание, исходное имя, хеш, строка: `_button_1dyov_1`, `_primary_1dyov_6`. В CSS сборки селекторы переписаны, в JS уходит объект «старое имя → новое».' },
  { k: '4. `composes`', d: 'Правило из CSS исчезает. Вместо него в JS к имени `primary` дописано имя `button` через пробел. Элемент получает два класса, и стили не копируются.' },
];

export const MODULE_DEMO_FILES: ModuleFile[] = [
  { id: 'button', label: 'Button.module.css', path: 'src/components/Button.module.css', css: MODULE_CSS },
  { id: 'card', label: 'Card.module.css', path: 'src/card/Card.module.css', css: CARD_MODULE_CSS },
  { id: 'copy', label: 'копия Button', path: 'src/copy/Button.module.css', css: MODULE_CSS },
];

export const MODULE_DEMO_CAPTION =
  'Имена считает `moduleExports` из листинга выше — тем же хешем, что Vite. Поменяйте в файле один пробел: сменятся имена **всех** классов файла, потому что хеш берётся от текста целиком. Копия кнопки в другой папке получает те же имена — путь в хеш не входит.';

export const MODULE_FACTS = [
  {
    t: 'Конфликт имён решён переименованием',
    d: '`.button` есть и в кнопке, и в карточке, но в CSS сборки это `_button_1dyov_1` и `_button_1ybt6_1` — разные классы. Каскаду больше не из чего выбирать: одно правило не может случайно задеть элемент другого компонента.',
    tone: 'ok' as const,
  },
  {
    t: '`:global` — выход из модуля',
    d: '`:global(.dark)` не переименовывается: в сборке это просто `.dark`. Так модуль реагирует на класс, который поставил кто-то снаружи, — тему, состояние страницы, класс библиотеки.',
  },
  {
    t: 'Одинаковый текст — одинаковые имена',
    d: 'Копия `Button.module.css` в папке `copy/` получила ровно `_button_1dyov_1`. В сборке без сжатия оба набора правил лежат подряд, сжатая сборка оставила один: lightningcss выбросил повтор. Вреда нет — правила те же.',
    tone: 'warn' as const,
  },
  {
    t: 'В режиме lightningcss — хеш от пути',
    d: 'С `css.transformer: \'lightningcss\'` модули переименовывает lightningcss, и формат другой: `S36ykG_button`, хеш спереди. Хеш считается от пути, поэтому копия файла в другой папке получила `kOwm9q_button`.',
  },
];

// ─── Раздел 4. Vue scoped ──────────────────────────────────────────────────────────────────

export const SCOPED_VUE = `<template>
  <button class="button"><slot /></button>
</template>

<style scoped>
.button {
  padding: 8px 16px;
}
.button:hover {
  color: white;
}
</style>
`;

export const CARD_VUE = `<template>
  <div class="card">
    <h3 class="title">Заказ</h3>
    <Button>Оплатить</Button>
  </div>
</template>

<script setup>
import Button from './Button.vue';
</script>

<style scoped>
.button {
  margin-top: 12px;
}
</style>
`;

/** CSS сборки для `SCOPED_VUE`: имя класса осталось, добавился атрибут. */
export const SCOPED_CSS_OUT = `.button[data-v-6d1c2ff8] {
  padding: 8px 16px;
}
.button[data-v-6d1c2ff8]:hover {
  color: white;
}`;

/** Как `@vitejs/plugin-vue` 6.0.8 считает id компонента. Исполняется тестом с `node:crypto`. */
export const SCOPE_ID_CODE = `// path — путь от корня проекта: 'src/components/Button.vue'
function scopeId(path, source, isProduction) {
  const text = path + (isProduction ? source : '');
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

scopeId('src/components/Button.vue', source, true);   // '6d1c2ff8' — сборка
scopeId('src/components/Button.vue', source, false);  // '3c9d0845' — dev-сервер`;

/** Вложенный рендер `Card` → `Button` (SSR-сборка фикстуры, `renderToString`). */
export const SCOPED_HTML = `<div class="card" data-v-91edec25>
  <h3 class="title" data-v-91edec25>Заказ</h3>
  <button class="button" data-v-91edec25 data-v-6d1c2ff8>Оплатить</button>
</div>`;

/** Что компилятор Vue делает с селекторами (`compileStyle`, `scoped: true`, id кнопки). */
export const SCOPED_RULES: { k: string; out: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '.button:hover', out: '.button[data-v-6d1c2ff8]:hover', d: 'Атрибут встаёт в последнюю часть селектора, перед псевдоклассом.' },
  { k: '.list > li span', out: '.list > li span[data-v-6d1c2ff8]', d: 'Помечена только последняя часть. `.list` и `li` могут быть в любом компоненте выше.', tone: 'warn' },
  { k: '.card :deep(.title)', out: '.card[data-v-6d1c2ff8] .title', d: '`:deep` переносит атрибут левее: `.title` найдётся и внутри дочерних компонентов.' },
  { k: ':slotted(p)', out: 'p[data-v-6d1c2ff8-s]', d: 'Для содержимого слота — отдельный атрибут с суффиксом `-s`.' },
  { k: ':global(.dark) .button', out: '.dark', d: 'Всё после `:global(…)` выброшено. Правило красит **любой** `.dark` на странице.', tone: 'err' },
];

export const SCOPED_FACTS = [
  {
    t: 'Корень дочернего компонента — общий',
    d: 'Кнопка внутри карточки получила два атрибута: свой и карточки. Поэтому `.button { margin-top: 12px }` из карточки дотягивается до корня `Button`, но не глубже — `<span>` внутри кнопки уже чужой.',
    tone: 'warn' as const,
  },
  {
    t: 'Защищает от утечки наружу, но не внутрь',
    d: 'Правило компонента не заденет чужие элементы: у них нет атрибута. А глобальное `.button { … }` со страницы заденет кнопку компонента — класс-то у неё прежний.',
    tone: 'warn' as const,
  },
  {
    t: 'В продакшене id зависит от текста',
    d: 'В сборке в хеш входит весь файл `.vue`, в dev — только путь. Любая правка компонента, даже в шаблоне, меняет id в сборке, а с ним — все селекторы его стилей.',
  },
];

/** Четыре способа изолировать стиль компонента. */
export const ISOLATION_ROWS: { k: string; how: string; inside: string; outside: string }[] = [
  { k: 'CSS-модули', how: 'Новое имя класса при сборке', inside: 'Глобальные правила по тегу (`button { … }`) — да; по классу — нет: у элемента другое имя', outside: 'Нет, кроме `:global`' },
  { k: 'Vue `scoped`', how: 'Атрибут `data-v-…` в разметке и в селекторе', inside: 'Да: имя класса прежнее, любое глобальное `.button` его заденет', outside: 'Только корень дочернего компонента и `:deep`' },
  { k: 'Shadow DOM', how: 'Отдельное дерево: селекторы страницы внутрь не смотрят', inside: 'Только наследуемые свойства и переменные', outside: 'Нет' },
  { k: '`@scope`', how: 'Правило каскада: область ограничена корнем и нижней границей', inside: 'Да, это обычный CSS документа', outside: 'Нет — за нижней границей правило не действует' },
];

// ─── Раздел 5. Tailwind: сканер кандидатов ─────────────────────────────────────────────────

export const PLAIN_SCAN =
  'Как повар, который закупает продукты по рецептам, не читая их внимательно. Он пробегает глазами все тетради на кухне и выписывает каждое слово, похожее на продукт. Лишнего купит немного — слово «соль» из фразы «в этом вся соль» тоже окажется в списке. Но продукт, записанный как «то, что любит гость», он не купит никогда: такого слова нет ни в одной тетради.';

export const TW_INPUT_CSS = `/* app.css — вход Tailwind v4 */
@import "tailwindcss" source("./src");`;

/** Файлы-фикстуры: тексты и байты несжатого CSS, если Tailwind просканирует только этот файл. */
export const TW_FILES: TwFile[] = [
  {
    id: 'button',
    name: 'src/Button.vue',
    text: `<template>
  <button class="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700">
    <slot />
  </button>
</template>
`,
    bytes: 5201,
  },
  {
    id: 'badge',
    name: 'src/Badge.tsx',
    text:
      "// Цвет приходит пропом: 'red' | 'green'\n" +
      'export function Badge({ color, text }) {\n' +
      "  const cls = 'bg-' + color + '-500';\n" +
      '  return <span className={`rounded ${cls} px-2`}>{text}</span>;\n' +
      '}\n' +
      '\n' +
      "const TONES = { red: 'bg-red-500', green: 'bg-green-500' };\n" +
      'export function SafeBadge({ color, text }) {\n' +
      "  return <span className={'rounded px-2 ' + TONES[color]}>{text}</span>;\n" +
      '}\n',
    bytes: 4977,
  },
  {
    id: 'notes',
    name: 'src/notes.js',
    text: `// TODO: вернуть shadow-lg когда дизайнер согласует
export const hint = 'Press the block button to hide the table';
`,
    bytes: 6915,
  },
];

/** CSS каждой утилиты из фикстур — содержимое `@layer utilities` из `build([кандидат])`. */
export const TW_RULES: Record<string, string> = {
  'px-4': '.px-4 {\n  padding-inline: calc(var(--spacing) * 4);\n}',
  'py-2': '.py-2 {\n  padding-block: calc(var(--spacing) * 2);\n}',
  'rounded-md': '.rounded-md {\n  border-radius: var(--radius-md);\n}',
  'bg-blue-600': '.bg-blue-600 {\n  background-color: var(--color-blue-600);\n}',
  'text-white': '.text-white {\n  color: var(--color-white);\n}',
  'hover:bg-blue-700': '@media (hover: hover) {\n  .hover\\:bg-blue-700:hover {\n    background-color: var(--color-blue-700);\n  }\n}',
  rounded: '.rounded {\n  border-radius: 0.25rem;\n}',
  'px-2': '.px-2 {\n  padding-inline: calc(var(--spacing) * 2);\n}',
  'bg-red-500': '.bg-red-500 {\n  background-color: var(--color-red-500);\n}',
  'bg-green-500': '.bg-green-500 {\n  background-color: var(--color-green-500);\n}',
  'shadow-lg':
    '.shadow-lg {\n  --tw-shadow: 0 10px 15px -3px var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 4px 6px -4px var(--tw-shadow-color, rgb(0 0 0 / 0.1));\n  box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow);\n}',
  block: '.block {\n  display: block;\n}',
  table: '.table {\n  display: table;\n}',
};

/** Байты CSS без единого кандидата: preflight и переменные темы, которые нужны ему самому. */
export const TW_EMPTY_BYTES = 4614;
/** Все три файла разом через `@tailwindcss/postcss`. */
export const TW_ALL_BYTES = 7835;

/**
 * Учебный сканер. Правила упрощены против oxide (Rust), но на фикстурах темы дают тот же набор
 * утилит — это и проверяет тест. Расхождения на краях перечислены в `SCAN_DIFF`.
 */
export const TW_SCAN_CODE = String.raw`// Упрощённый сканер Tailwind: правила короче настоящих, устроены так же.
// Перед кандидатом — начало текста, пробел, кавычка или «>»,
// после него — конец текста, пробел, кавычка, «<» или «=».
const BEFORE = /[\s"'\`>]/;
const AFTER = /[\s"'\`<=]/;
// Внутри: буквы, цифры, - _ : / . ! %; в скобках [ ] и ( ) — всё, кроме пробела.
const BODY = /[\w\-:/.!%]/;
// Начало — строчная буква, «-», «!» или «[»; конец — буква, цифра, ] ) ! %.
const SHAPE = /^[-!]?[a-z[](.*[a-z0-9\])!%])?$/;

function scanCandidates(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (i > 0 && !BEFORE.test(text[i - 1])) { i++; continue; }
    let j = i, depth = 0;
    while (j < text.length) {
      const c = text[j];
      if (c === '[' || c === '(') depth++;
      else if ((c === ']' || c === ')') && depth > 0) depth--;
      else if (depth > 0 ? /\s/.test(c) : !BODY.test(c)) break;
      j++;
    }
    const word = text.slice(i, j);
    const endsWell = j === text.length || AFTER.test(text[j]);
    if (word && depth === 0 && endsWell && SHAPE.test(word)) {
      found.push({ candidate: word, start: i });
    }
    i = Math.max(j, i + 1);
  }
  return found;
}`;

export const TW_DEMO_CAPTION =
  'Кандидатов ищет `scanCandidates` из листинга выше, прямо в вашем браузере. Какие из них Tailwind узнал и какой CSS написал — снято настоящим Tailwind 4.3.3 на этих же файлах, и тест сверяет, что учебный сканер даёт тот же набор утилит.';

export const SCAN_STEPS = [
  { k: '1. Найти файлы', d: 'Tailwind v4 сам обходит проект от корня или от пути в `source(…)`. Пропускает то, что в `.gitignore`, `node_modules`, бинарные файлы и CSS. Тип файла почти не важен: `.vue`, `.tsx`, `.md`, `.js` читаются одинаково — как текст.' },
  { k: '2. Выписать кандидатов', d: 'Сканер (oxide, на Rust) режет текст на слова по своим правилам границ и оставляет похожие на класс. Ни JSX, ни шаблон Vue он не разбирает. Кандидатов всегда больше, чем классов: в `Badge.tsx` их 14 разных, включая `export` и `const`.' },
  { k: '3. Узнать утилиты', d: 'Каждого кандидата компилятор пытается разобрать: вариант (`hover:`), корень (`bg`), значение (`blue-700`). Не разобрался — молча выбросил. `export`, `button` и `bg-blue` (у `bg` нет значения `blue`) CSS не дают.' },
  { k: '4. Написать CSS', d: 'Для узнанных — правило в `@layer utilities` и переменные темы, на которые оно ссылается. Тема целиком в вывод не попадает: `--color-red-500` появится, только если кто-то использует красный 500.' },
];

export const DYNAMIC_BAD_CODE = `// Полного имени класса в тексте нет —
// есть только куски 'bg-' и '-500'. CSS не будет.
const cls = 'bg-' + color + '-500';
const cls2 = \`bg-\${color}-500\`;`;

export const DYNAMIC_OK_CODE = `// Полные имена лежат в тексте — сканер их видит.
const TONES = { red: 'bg-red-500', green: 'bg-green-500' };
const cls = TONES[color];`;

export const SOURCE_INLINE_CODE = `/* Если имена приходят с сервера — перечислить их в CSS */
@import "tailwindcss";
@source inline("bg-{red,green,blue}-500");`;

export const SCAN_FACTS = [
  {
    t: 'Склеенный класс не существует',
    d: 'Сканер видит текст файла, а не то, что получится при исполнении. В `\'bg-\' + color + \'-500\'` он нашёл только `color`. Ошибки нет: кнопка просто без фона. Лечится полными именами в тексте или `@source inline(…)` — тогда Tailwind сгенерирует все перечисленные классы.',
    tone: 'err' as const,
  },
  {
    t: 'Комментарии и проза тоже текст',
    d: '`shadow-lg` из комментария `TODO` в CSS попал. Попали и `block` и `table` из строки подсказки: это настоящие утилиты (`display: block`, `display: table`). Лишнего немного, зато сканер не обязан понимать ни один язык.',
    tone: 'warn' as const,
  },
  {
    t: 'Граница слова решает',
    d: 'В тексте «вернуть shadow-lg, когда» сканер `shadow-lg` не нашёл: после кандидата стоит запятая, а запятая для oxide не граница. Без запятой — нашёл. Учебный сканер ведёт себя так же: запятая обрывает слово, и проверка концовки его отбрасывает.',
  },
];

/** Где учебный сканер расходится с oxide — проверено тестом. Набор утилит на фикстурах это не меняет. */
export const SCAN_DIFF =
  'Где учебный сканер проще настоящего: из `hover:` — варианта без утилиты — oxide выписывает кандидата `hover`, учебный не выписывает ничего; oxide учитывает формат файла (в `.vue`, `.svelte`, `.pug` есть свои предобработчики) и больше видов границ. Утилит это на фикстурах не меняет: такие кандидаты Tailwind всё равно отбросил бы.';

// ─── Раздел 6. Что выходит в CSS: слои и байты ─────────────────────────────────────────────

export const TW_LAYERS_CODE = `/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */
@layer theme, base, components, utilities;
@layer theme {
  :root, :host {
    --color-blue-600: oklch(54.6% 0.245 262.881);
    --spacing: 0.25rem;
    /* …только переменные, которые нужны использованным утилитам */
  }
}
@layer base {
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    box-sizing: border-box;
    margin: 0;
    /* …preflight: сброс стилей браузера */
  }
}
@layer utilities {
  .px-4 { padding-inline: calc(var(--spacing) * 4); }
  /* … */
}`;

/** Chromium 153: `<button class="btn p-4">`, вывод Tailwind с `p-4` и правило `.btn` в трёх видах. */
export const LAYER_PROBE: { k: string; padding: string; d: string; tone: 'ok' | 'err' }[] = [
  { k: '.btn { padding: 0; }', padding: '0px', d: 'Правило вне слоёв сильнее любого слоя — `p-4` проиграл, хотя специфичность у них одинаковая.', tone: 'err' },
  { k: '#app .btn { padding: 0; }', padding: '0px', d: 'То же самое, только теперь виноватым кажется специфичность. Она не участвовала: спор решён раньше, на слоях.', tone: 'err' },
  { k: '@layer components { .btn { padding: 0; } }', padding: '16px', d: 'Свой код в слое `components`: утилиты объявлены позже и побеждают — класс в разметке решает, как и задумано.', tone: 'ok' },
];

/** Байты несжатого CSS: каждый k-й класс из полного списка Tailwind (`getClassList`, 23 286 имён). */
export const TW_BYTES_ROWS: { n: number; bytes: number }[] = [
  { n: 0, bytes: 4614 },
  { n: 10, bytes: 13216 },
  { n: 100, bytes: 41553 },
  { n: 1000, bytes: 253265 },
];
export const TW_CLASS_COUNT = 23286;

/** Сколько байт добавляет набор классов к пустому выводу (4614 байт). */
export const TW_MARGINAL_ROWS: { k: string; bytes: number; d: string }[] = [
  { k: 'flex', bytes: 36, d: 'одно правило, одна декларация' },
  { k: 'p-4', bytes: 79, d: 'правило и переменная `--spacing`' },
  { k: 'p-4 p-2', bytes: 131, d: 'второе правило; `--spacing` уже есть' },
  { k: 'bg-red-500', bytes: 115, d: 'правило и переменная цвета' },
  { k: 'hover:bg-red-500', bytes: 164, d: 'то же внутри `@media (hover: hover)`' },
  { k: 'shadow-lg', bytes: 2231, d: '14 регистраций `@property` и запасной слой для движков без них' },
  { k: 'shadow-lg shadow-md', bytes: 2521, d: 'вторая тень — 290 байт: служебное уже есть' },
];

export const BYTES_NOTE =
  'Размер растёт с числом **разных** классов, а не с числом мест, где класс написан: `p-4` на тысяче кнопок — одно правило. Рост не линейный: первая тень тянет за собой служебные переменные на 2 КБ, каждая следующая обходится в сотни байт. На тысяче разных классов вышло 253 КБ без сжатия — примерно 250 байт на класс.';

// ─── Раздел 7. Порядок подключения и критический CSS ───────────────────────────────────────

export const ORDER_A_CODE = `// a.js
import danger from './danger.module.css';  // .text { color: red }
import base from './base.module.css';      // .button { color: black }

el.className = \`\${base.button} \${danger.text}\`;
// CSS сборки: сначала ._text_xlfbh_1, потом ._button_1kgoy_1
// Chromium: color — rgb(0, 0, 0), чёрный`;

export const ORDER_B_CODE = `// b.js — те же два файла, импорты переставлены
import base from './base.module.css';
import danger from './danger.module.css';

el.className = \`\${base.button} \${danger.text}\`;
// CSS сборки: сначала ._button_1kgoy_1, потом ._text_xlfbh_1
// Chromium: color — rgb(255, 0, 0), красный`;

export const ORDER_NOTE =
  'Порядок классов в атрибуте `class` на каскад не влияет никак. У двух классов одинаковая специфичность, и побеждает правило, которое стоит в CSS ниже. А стоит оно там, где его поставил сборщик: Vite кладёт CSS модулей в порядке обхода импортов. Переставили две строки `import` — поменялся цвет.';

export const ORDER_FACTS = [
  {
    t: 'CSS входа — ссылкой в `<head>`',
    d: 'Vite собрал CSS всех статических импортов в один файл и вписал `<link rel="stylesheet">` в `<head>` рядом со скриптом. Этот файл задерживает первый кадр, как любой CSS в `<head>`.',
  },
  {
    t: 'CSS ленивого чанка — перед его кодом',
    d: 'У `import(\'./lazy.js\')` свой файл `lazy-….css`. Vite подгружает его вместе с чанком (`__vitePreload` со списком из JS и CSS) и исполняет чанк, когда стиль на месте. Такой CSS встаёт в документ позже — и в споре равных селекторов побеждает.',
    tone: 'warn' as const,
  },
  {
    t: 'Критический CSS — часть файла, нужная первому экрану',
    d: 'Его вставляют прямо в `<style>` в HTML, а остальное грузят без блокировки. Чем меньше итоговый CSS, тем реже это нужно: вывод Tailwind на фикстурах темы — 7,8 КБ без сжатия, его выгоднее отдать целиком.',
  },
];

export const CRP_NOTE =
  'Почему CSS в `<head>` держит первый кадр, как это видно на таймлайне и чем это лечат (`media`, разделение файлов) — в теме [«Критический путь и Web Vitals»](/render/rendering-crp/#s1). Инструменты из этой темы влияют на то же самое с другой стороны: сколько байт и в скольких файлах приходит.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Понижение не переписывает то, что зависит от браузера',
    d: '`color-mix` с `var(--brand)` и `@layer` lightningcss оставил как есть под Chrome 90 — без единого предупреждения. Под старую цель сборка зелёная, а браузер выбрасывает правило или весь слой.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'В dev и в сборке Vite разный CSS',
    d: 'По умолчанию CSS понижает только минификатор: dev-сервер и сборка с `minify: false` отдают вложенность как написана. Проверять Safari 16 надо на продакшен-сборке — или включить `css.transformer: \'lightningcss\'`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Плагин PostCSS видит свои же правки',
    d: 'Изменённый или добавленный узел обходят ещё раз. Посетитель, который реагирует на собственный результат, крутится без конца: защиты в PostCSS нет.',
    code: NAIVE_PLUGIN_CODE,
    tone: 'err',
  },
  {
    n: '04',
    t: 'Склеенный класс Tailwind не попадёт в CSS',
    d: '`\'bg-\' + color + \'-500\'` в тексте файла не содержит ни одного полного имени. Сканер его не видит, утилита не генерируется, ошибки нет. Полные имена в коде или `@source inline(…)`.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Свой CSS вне слоя перебивает утилиты',
    d: 'Вывод Tailwind целиком лежит в слоях, а правило без `@layer` сильнее любого слоя. `.btn { padding: 0 }` победил `p-4` при равной специфичности. Свои стили — в `@layer components`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Порядок классов в `class` не важен — важен порядок импортов',
    d: 'Два CSS-модуля с равными селекторами спорят порядком в собранном CSS, а его задаёт порядок `import`. Перестановка импортов меняет вид, хотя ни один стиль не тронут.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`:global(.x) .y` в Vue `scoped` — это просто `.x`',
    d: 'В CSS-модулях такой селектор оставит и `.y`. Во Vue компилятор выбрасывает всё после `:global(…)`, и правило красит любой `.x` на странице.',
    tone: 'err',
  },
  {
    n: '08',
    t: '`scoped` не защищает корень дочернего компонента',
    d: 'Корневой элемент дочернего компонента несёт атрибуты обоих. Правило родителя по классу `.button` заденет корень кнопки — иногда это удобно, иногда это баг.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Имя CSS-модуля зависит от всего файла',
    d: 'Хеш Vite считается от текста файла целиком: правка одной строки меняет имена всех классов в нём. Завязываться на `_button_1dyov_1` в тестах или в чужом CSS нельзя — только на объект, который отдаёт модуль.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'PostCSS — Writing a PostCSS Plugin',
    href: 'https://postcss.org/docs/writing-a-postcss-plugin',
    what: 'посетители `Declaration`, `Rule`, `AtRule`, повторный обход изменённых узлов; версия 8.5.28 на стенде',
  },
  {
    title: 'PostCSS API',
    href: 'https://postcss.org/api/',
    what: 'типы узлов, `raws`, `cloneBefore`',
  },
  {
    title: 'Lightning CSS — Transpilation',
    href: 'https://lightningcss.dev/transpilation.html',
    what: '`targets`, `browserslistToTargets`, понижение вложенности и цветов, префиксы',
  },
  {
    title: 'Vite — CSS: CSS Modules, Lightning CSS',
    href: 'https://vite.dev/guide/features#css',
    what: '`*.module.css`, `css.transformer`, `build.cssTarget`, `build.cssMinify`',
  },
  {
    title: 'CSS Modules',
    href: 'https://github.com/css-modules/css-modules',
    what: '`composes`, `:global`, локальные имена по умолчанию',
  },
  {
    title: 'Vue — Scoped CSS',
    href: 'https://vuejs.org/api/sfc-css-features.html#scoped-css',
    what: '`data-v-…`, корень дочернего компонента, `:deep`, `:slotted`, `:global`',
  },
  {
    title: 'Tailwind CSS — Detecting classes in source files',
    href: 'https://tailwindcss.com/docs/detecting-classes-in-source-files',
    what: 'сканирование как текста, динамические имена, `@source`, `source(none)`, `@source inline`',
  },
  {
    title: 'CSS Cascading and Inheritance Level 5 — Cascade Layers',
    href: 'https://www.w3.org/TR/css-cascade-5/#layering',
    what: 'правила вне слоёв сильнее слоёв при обычной важности',
  },
];

export const RELATED =
  'Смежное на сайте: [Каскад и вычисление стилей, раздел «Шесть критериев»](/render/css-cascade/#s1) — слои и специфичность, на которых стоит всё про Tailwind. [AST и линтеры](/tooling/ast-linters/#s2) — обход дерева на примере ESLint. [Транспиляция и полифилы](/tooling/transpilation/#s2) — те же цели сборки для JavaScript. [Стили веб-компонентов](/render/web-components-styles/#s1) — изоляция через Shadow DOM. [Критический путь и Web Vitals](/render/rendering-crp/#s1) — почему CSS держит первый кадр. [Бандлер изнутри, раздел «Хеши в именах»](/tooling/bundler-internals/#s5) — хеши от содержимого для файлов. [HMR изнутри](/tooling/hmr/) — почему правка CSS-модуля обновляет страницу иначе, чем обычный CSS. [Форматтер изнутри](/tooling/formatter/) — Doc и печать по ширине: как Prettier решает, где ломать строку.';
