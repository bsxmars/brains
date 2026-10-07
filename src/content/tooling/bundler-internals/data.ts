import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { BundleScenario } from '@/widgets/bundler-lab/model/types';

/**
 * Данные темы «Бандлер изнутри: граф, отбор, склейка и хеши».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 * Она идёт на шаг глубже «Модулей и сборки» (`tooling/modules`): что такое побочный эффект,
 * зачем `sideEffects` и `/*#__PURE__*\/`, раскраска чанков и сам факт каскада хешей разобраны
 * там (разделы «Tree shaking» и «Чанки и кеш») и здесь даются одной фразой со ссылкой. Здесь —
 * механика внутри сборщика: обход графа, отбор операторов, переименование при склейке,
 * обёртки, имена экспортов между чанками, заглушки вместо хешей.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * rolldown **1.2.8** и esbuild **0.28.2** из `node_modules` проекта (оба приходят с Vite),
 * Node 24.11.0, октябрь 2026. Вызов из Node, без записи на диск:
 *   — rolldown: `rolldown({ input, cwd, logLevel: 'silent' })` → `generate({ format: 'esm' })`;
 *     для чанков — `entryFileNames` и `chunkFileNames` вида `[name]-[hash].js`;
 *   — esbuild: `build({ bundle: true, format: 'esm', write: false, charset: 'utf8' })`,
 *     для чанков ещё `splitting: true`, `entryNames`/`chunkNames` `[name]-[hash]`.
 * Каталог стенда — настоящий путь (`realpath`): через символическую ссылку `/tmp → /private/tmp`
 * rolldown пишет в комментарии `//#region` путь с `../`, и меняются и код, и хеши.
 *
 * Вывод rolldown хранится с табуляцией, заменённой двумя пробелами (`tabs` в тесте), — иначе
 * исходники сценариев пришлось бы печатать табами. Больше в выводе ничего не тронуто.
 *
 * Что снято и чем закрыто (всё — `tests/unit/bundler-internals.test.ts`):
 *   — пять сценариев `SCENARIOS`: вывод rolldown совпадает с литералом `rolldown`, а учебный
 *     сборщик темы (`GRAPH_CODE` + `SHAKE_CODE` + `HOIST_CODE`) выдаёт тот же текст посимвольно;
 *     порядок модулей — с `chunk.moduleIds`;
 *   — `BASE_ESBUILD`, раздача имён `x`, `x$1`… на четырёх модулях (rolldown) и `x`, `x2`…
 *     (esbuild);
 *   — таблица `PURITY_ROWS`: каждая строка собрана обоими сборщиками отдельно;
 *   — обёртки `WRAP_*`: фрагменты и байты служебного кода;
 *   — чанки `CHUNK_*`, строки с заглушками `PLACEHOLDER_LINES`, каскад `HASH_EDITS` —
 *     и учебный `HASH_CODE` даёт тот же набор сменившихся файлов, что rolldown;
 *   — предупреждения: rolldown на выброшенный голый импорт молчит, esbuild пишет
 *     `ignored-bare-import`; esbuild с `splitting` и `format: 'iife'` — ошибка.
 *
 * Найдено по дороге, в текст не пошло: rolldown подставляет `const` с литералом прямо в место
 * чтения (`optimization.inlineConst`, по умолчанию `smart`) и после этого иногда теряет
 * `//#region` модуля — строка `globalThis.x = []` оказалась в регионе соседнего файла,
 * а в одном прогоне бандл начался с одинокого `//#endregion`. Поэтому в сквозном примере
 * совпадающие имена — функции, а не константы: их rolldown не подставляет.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'граф модулей',
    d: 'Список «кто кого импортирует», который сборщик строит, читая `import` в каждом файле. Код при этом не выполняется: импорты видны из текста.',
  },
  {
    k: 'точка входа',
    d: 'Файл, с которого сборщик начинает обход: обычно `main.js`. Всё, до чего от неё не дойти по импортам, в сборку не попадает вообще.',
  },
  {
    k: 'оператор верхнего уровня',
    d: 'Строчка модуля вне всех функций: объявление функции или переменной, вызов, присваивание. Сборщик решает «оставить или выбросить» по каждому такому оператору отдельно, а не по файлу целиком.',
  },
  {
    k: 'tree shaking',
    d: 'Отбор кода в сборку: берётся только то, что что-то делает само или нужно тому, что уже взято. Остальное в бандл не попадает.',
  },
  {
    k: 'scope hoisting (склейка)',
    d: 'Код всех модулей кладут в один файл и в одну область видимости, без обёрток вокруг каждого модуля. Импорт превращается в обычное имя переменной, а одинаковые имена из разных модулей переименовывают.',
  },
  {
    k: 'чанк',
    d: 'Один выходной файл сборки. Пока в приложении нет `import()`, чанк один; каждый динамический импорт и общий для нескольких чанков код дают новые файлы.',
  },
  {
    k: 'хеш в имени файла',
    d: 'Короткая «подпись» содержимого: `format-CM7ZQniE.js`. Поменялся код — поменялось имя. Поэтому такой файл можно кешировать навсегда: новая версия придёт под новым адресом.',
  },
  {
    k: '`//#region`',
    d: 'Комментарий, которым rolldown в несжатой сборке отмечает, из какого модуля пришёл код. На коде он никак не сказывается.',
  },
];

export const PLAIN_BUNDLER =
  'Как редактор, который собирает сборник рассказов из рукописей разных авторов. Он идёт по ссылкам «см. рассказ такой-то» от первого рассказа, берёт только нужные главы и выкладывает их в одну книгу. А если в двух рассказах есть свой Иван, одного из них в книге придётся назвать «Иван 2», иначе читатель их спутает.';

export const PREREQ_NOTE =
  'Три вещи тема берёт из «Модулей и сборки» и разбирает дальше, четвёртая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Импорты известны до запуска',
    d: '`import` стоит только на верхнем уровне файла и только со строкой в кавычках. Поэтому все зависимости видны из текста, и сборщик может обойти проект, не выполнив ни строчки.',
    href: '/tooling/modules/#s1',
    hrefLabel: '«Модули и сборка», раздел «Три фазы»',
    tone: 'info',
  },
  {
    t: 'Что сборщик называет побочным эффектом',
    d: 'Всё, что модуль меняет снаружи просто оттого, что выполнился: запись в `window`, регистрация, импорт стилей. Там же — что обещают `"sideEffects": false` и `/*#__PURE__*/` и во что обходится каждый способ помешать сборщику.',
    href: '/tooling/modules/#s4',
    hrefLabel: '«Модули и сборка», раздел «Tree shaking»',
    tone: 'info',
  },
  {
    t: 'Как модули раскладываются по чанкам',
    d: 'Модули с одинаковым набором «откуда до меня можно дойти» ложатся в один файл. Модуль, нужный двум ленивым маршрутам, уходит в общий чанк.',
    href: '/tooling/modules/#s5',
    hrefLabel: '«Модули и сборка», раздел «Чанки и кеш»',
    tone: 'info',
  },
  {
    t: 'Область видимости модуля',
    d: 'Переменная, объявленная в модуле вне функций, видна только в этом модуле. Два модуля могут спокойно объявить по своей `label` — пока они лежат в разных файлах, имена не встречаются.',
    tone: 'info',
  },
];

// ─── Раздел 1. Граф модулей ────────────────────────────────────────────────────────────────

/** Сквозной пример: маленький магазин из четырёх модулей. Табуляции нет — два пробела. */
export const APP_MAIN = `import { formatPrice } from "./format.js";
import { cart, describe } from "./cart.js";
import "./analytics.js";

console.log(formatPrice(cart.total()));

console.log(describe());
`;

export const APP_FORMAT = `function label(n) {
  return n + " ₽";
}

export function formatPrice(n) {
  return label(n);
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}
`;

export const APP_CART = `import { formatPrice } from "./format.js";

function label(text) {
  return "[" + text + "]";
}

export const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};

export function describe() {
  return label(formatPrice(cart.total()));
}
`;

export const APP_ANALYTICS = `const queue = [];

export function track(event) {
  queue.push(event);
}

globalThis.analyticsQueue = queue;

queue.push("start");
`;

export const APP_FILES: Record<string, string> = {
  'src/main.js': APP_MAIN,
  'src/format.js': APP_FORMAT,
  'src/cart.js': APP_CART,
  'src/analytics.js': APP_ANALYTICS,
};

export const GRAPH_CODE = `// Путь из import — в путь файла. Голое имя пакета ведёт в node_modules.
function resolve(spec, from) {
  if (!spec.startsWith(".")) return "node_modules/" + spec + "/index.js";
  const parts = from.split("/").slice(0, -1);
  for (const p of spec.split("/")) {
    if (p === "..") parts.pop();
    else if (p !== ".") parts.push(p);
  }
  return parts.join("/");
}

// Оператор верхнего уровня: что объявляет и делает ли что-то сам.
function parseStatement(text, path) {
  const exported = text.startsWith("export ");
  const code = text.replace(/^export /, "");
  let m = /^function ([\\w$]+)/.exec(code);
  if (m) return { path, code, exported, name: m[1], effect: false };
  m = /^(?:const|let|var) ([\\w$]+) = ([\\s\\S]*);$/.exec(code);
  if (m) {
    const init = m[2];
    const pure =
      init.startsWith("/* @__PURE__ */") ||  // автор пообещал: вызов чистый
      /^[[{"\\d]/.test(init) ||               // литерал: массив, объект, строка, число
      !init.includes("(");                   // ни одного вызова
    return { path, code, exported, name: m[1], init, effect: !pure };
  }
  return { path, code, exported, name: null, effect: true };  // вызов, присваивание
}

function parseModule(path, files) {
  const imports = [];
  const body = [];
  for (const block of files[path].trim().split(/\\n\\n+/)) {
    const rest = [];
    for (const line of block.split("\\n")) {
      const m = /^import (?:\\{ (.+) \\} from )?"(.+)";$/.exec(line);
      if (!m) { rest.push(line); continue; }
      const names = (m[1] ?? "").split(", ").filter(Boolean).map((s) => {
        const [imported, local = imported] = s.split(" as ");
        return { imported, local };
      });
      imports.push({ from: resolve(m[2], path), names });
    }
    if (rest.length) body.push(parseStatement(rest.join("\\n"), path));
  }
  // "sideEffects": false в package.json пакета — обещание автора пакета.
  const pkg = /^node_modules\\/[^/]+\\//.exec(path);
  const meta = pkg && files[pkg[0] + "package.json"];
  const noSideEffects = Boolean(meta) && JSON.parse(meta).sideEffects === false;
  return { path, imports, body, noSideEffects };
}

// Обход в глубину: модуль встаёт в порядок после всех своих зависимостей.
function buildGraph(files, entry) {
  const modules = new Map();
  const order = [];
  function visit(path) {
    if (modules.has(path)) return;
    const mod = parseModule(path, files);
    modules.set(path, mod);
    for (const imp of mod.imports) visit(imp.from);
    order.push(mod);
  }
  visit(entry);
  return { modules, order };
}`;

export const GRAPH_NOTE =
  'Модуль встаёт в порядок только **после** всех своих зависимостей: `visit` сначала обходит импорты, потом добавляет сам модуль. Для магазина выходит `format.js`, `cart.js`, `analytics.js`, `main.js` — тот же порядок, в каком их выполнил бы браузер, и тот же, в каком rolldown и esbuild выложили код в бандл. `format.js` импортируют двое, но в графе он один: второй `visit` видит его в `modules` и выходит сразу.';

/** Порядок обхода для магазина. Тест сверяет его с `buildGraph` и с `chunk.moduleIds` у rolldown. */
export const APP_ORDER = ['src/format.js', 'src/cart.js', 'src/analytics.js', 'src/main.js'];

export const GRAPH_FACTS: { t: string; d: string; more?: string }[] = [
  {
    t: 'Импорт без имён — тоже ребро',
    d: '`import "./analytics.js"` ничего не берёт, но `analytics.js` попадает в граф и в порядок. Он нужен ради того, что делает при выполнении: кладёт очередь в `globalThis`.',
  },
  {
    t: 'Голое имя ищется по правилам',
    d: 'В учебном `resolve` пакет — это всегда `node_modules/<имя>/index.js`. Настоящий сборщик читает `package.json`: поля `exports`, `module`, `main` и условия вроде `browser` или `import`.',
    more: 'Как одно имя пакета ведёт к разным файлам — «Модули и сборка», раздел [«CommonJS против ESM»](/tooling/modules/#s3).',
  },
  {
    t: 'Граф строится до отбора',
    d: 'На этом шаге из модуля ничего не выбрасывается: `formatDate` и `track` ещё в графе. Решать, что нужно, можно только когда известны все модули — кто кого вызывает.',
  },
];

// ─── Раздел 2. Что выживает ────────────────────────────────────────────────────────────────

export const PLAIN_MARK =
  'Как собирать рюкзак по списку дел. Сначала — дела, которые точно будут: «приготовить ужин». Потом всё, что нужно для них: для ужина — котелок, для котелка — горелка, для горелки — баллон газа. Вещь, которую не потребовало ни одно дело, остаётся дома, сколько бы места она ни занимала на полке.';

export const SHAKE_CODE = `const IDENT = /(?<![.\\w$])[A-Za-z_$][\\w$]*/g;

// Имя внутри модуля → оператор, который его объявил: свой или экспортёра.
function lookup(graph, mod, name) {
  const own = mod.body.find((st) => st.name === name);
  if (own) return { mod, st: own };
  for (const imp of mod.imports) {
    const binding = imp.names.find((b) => b.local === name);
    if (!binding) continue;
    const target = graph.modules.get(imp.from);
    const st = target.body.find((s) => s.exported && s.name === binding.imported);
    return st ? { mod: target, st } : null;
  }
  return null;
}

function shake(graph) {
  const kept = new Map();    // оператор → почему оставлен
  const needed = new Set();  // операторы, на которые кто-то сослался
  const used = new Set();    // модули, чьи эффекты уже взяты
  const queue = [];
  const keep = (st, why) => {
    if (kept.has(st)) return;
    kept.set(st, why);
    queue.push(st);
  };
  const useModule = (mod) => {
    if (used.has(mod)) return;
    used.add(mod);
    for (const st of mod.body) if (st.effect) keep(st, "эффект");
  };

  // 1. Эффекты всех модулей — кроме тех, чей пакет пообещал, что эффектов нет.
  for (const mod of graph.order) if (!mod.noSideEffects) useModule(mod);

  // 2. Всё, на что ссылается уже взятое, — пока список растёт.
  while (queue.length) {
    const st = queue.shift();
    for (const name of new Set(st.code.match(IDENT))) {
      const found = lookup(graph, graph.modules.get(st.path), name);
      if (!found || found.st === st) continue;
      needed.add(found.st);
      keep(found.st, st);
      useModule(found.mod);  // взяли экспорт — берём и эффекты его модуля
    }
  }
  return { kept, needed };
}`;

/** Как отбор идёт на магазине. Тест сверяет набор оставленных операторов с `shake`. */
export const SHAKE_STEPS = [
  '**Эффекты.** В `main.js` — два `console.log`, в `analytics.js` — запись `globalThis.analyticsQueue = queue` и вызов `queue.push("start")`. Объявления функций и литералы ничего не делают при выполнении, их на этом шаге не берут.',
  '**По ссылкам.** `console.log(describe())` требует `describe`, тот — `label` из `cart.js` и `formatPrice`, а `formatPrice` — свой `label` из `format.js`. Запись в `globalThis` требует `queue`, первый `console.log` — `cart`.',
  '**Не взято.** На `formatDate` и `track` не сослался никто — их нет в бандле, хотя оба экспортируются.',
];

export const SHAKE_NOTE =
  'Отбор идёт по **операторам**, а не по файлам: из `analytics.js` выпала функция `track`, но остались очередь и два эффекта. Поэтому вопрос «попадёт ли модуль в сборку» почти всегда неточен. Точный вопрос — какие его строки на что-то ссылаются и что из них делает что-то само.';

export const PROMISES = [
  {
    t: '`sideEffects: false` — пропустить шаг 1',
    d: 'Модуль пакета не отдаёт свои эффекты на первом шаге: `useModule` его не трогает. Если из модуля никто ничего не взял, он исчезает целиком, вместе с записью в `globalThis`. Но стоит кому-то сослаться на его экспорт — `useModule` вызывается во втором шаге, и **все** эффекты модуля возвращаются.',
  },
  {
    t: '`/*#__PURE__*/` — не считать вызов эффектом',
    d: 'В учебной версии это одна проверка в `parseStatement`. Сборщик не заглядывает внутрь функции и не сверяет пометку с её кодом. Помеченный вызов `createTheme` исчез вместе с `console.log` внутри — пометка оказалась неправдой, и сборщик об этом не узнал. Запись `/* @__PURE__ */` с `@` и `/*#__PURE__*/` с `#` равноправны; rolldown печатает первую.',
    tone: 'warn' as const,
  },
];

export const PURITY_SETUP = `const config = { theme: "dark" };
function makeTheme(name) {
  return { name, at: Date.now() };
}
function sideTheme(name) {
  console.log(name);
  return { name };
}
function start() { console.log("start"); return 0; }
class Widget { constructor() { console.log("w"); } }
`;

export const PURITY_ROWS: { code: string; rolldown: 'выбросил' | 'оставил'; esbuild: 'выбросил' | 'оставил'; why: string }[] = [
  { code: 'const x = makeTheme("dark");', rolldown: 'выбросил', esbuild: 'оставил', why: 'rolldown заглянул в тело `makeTheme`: там только объект и `Date.now()`. esbuild считает любой вызов чужой функции эффектом.' },
  { code: 'const x = sideTheme("dark");', rolldown: 'оставил', esbuild: 'оставил', why: 'Внутри `console.log` — эффект видят оба.' },
  { code: 'const x = /* @__PURE__ */ sideTheme("dark");', rolldown: 'выбросил', esbuild: 'выбросил', why: 'Пометке верят оба, хотя `console.log` внутри никуда не делся.' },
  { code: 'const x = config.theme;', rolldown: 'оставил', esbuild: 'оставил', why: 'Чтение свойства — эффект для обоих: свойство могло бы оказаться геттером.' },
  { code: 'const x = unknownGlobal;', rolldown: 'оставил', esbuild: 'оставил', why: 'Чтение необъявленного имени бросает `ReferenceError` — это тоже наблюдаемо.' },
  { code: 'const x = new Map();', rolldown: 'выбросил', esbuild: 'выбросил', why: 'Встроенный конструктор без аргументов оба знают как чистый.' },
  { code: 'const x = new Widget();', rolldown: 'оставил', esbuild: 'оставил', why: 'В конструкторе `Widget` — `console.log`.' },
  { code: 'const x = [1, 2, 3].map((n) => n * 2);', rolldown: 'оставил', esbuild: 'оставил', why: 'Вызов метода — эффект, даже у массива-литерала.' },
  { code: 'const x = JSON.parse("{}");', rolldown: 'оставил', esbuild: 'оставил', why: 'Встроенная, но может бросить исключение на плохой строке.' },
  { code: 'const x = Symbol("id");', rolldown: 'выбросил', esbuild: 'выбросил', why: 'Известная чистая встроенная функция.' },
  { code: 'const x = "" + config;', rolldown: 'выбросил', esbuild: 'оставил', why: 'Сложение строки с объектом зовёт у объекта `toString`. rolldown здесь эффекта не нашёл, esbuild перестраховался.' },
  { code: 'class X { static count = start(); }', rolldown: 'оставил', esbuild: 'оставил', why: 'Статическое поле вычисляется в момент объявления класса.' },
];

export const PURITY_NOTE =
  'Каждая строка собрана отдельно: модуль с заготовками выше, одна строка из таблицы и экспорт `used`, который `main.js` печатает. Переменную `x` никто не читает, вопрос только в том, считает ли сборщик правую часть эффектом. Учебный `parseStatement` устроен как esbuild — любой вызов без пометки для него эффект. rolldown строже к себе: он заглядывает в тело локальной функции и выбрасывает вызов, если не нашёл там ничего опасного.';

// ─── Раздел 3. Склейка ─────────────────────────────────────────────────────────────────────

export const PLAIN_HOIST =
  'Как слить два класса в один журнал. В каждом классе был свой Саша, и пока классы жили отдельно, путаницы не было. В общем журнале одного придётся записать «Саша 2». Кого именно — решает правило завуча. Ученикам не важно, какое это правило, лишь бы все записки «передать Саше 2» доходили до него.';

export const HOIST_CODE = `function hoist(graph, { kept, needed }) {
  // Одна область видимости на всех: одинаковые имена надо развести.
  // Имена раздаются от входа назад — вход сохраняет свои, ранние модули получают $1, $2…
  const finalName = new Map();
  const seen = new Map();
  for (const mod of [...graph.order].reverse()) {
    for (const st of mod.body) {
      if (!st.name || !kept.has(st)) continue;
      const n = seen.get(st.name) ?? 0;
      seen.set(st.name, n + 1);
      finalName.set(st, n ? st.name + "$" + n : st.name);
    }
  }

  let out = "";
  for (const mod of graph.order) {
    const sts = mod.body.filter((st) => kept.has(st));
    if (!sts.length) continue;  // модуль не дал ни строки — его нет и в бандле
    out += "//#region " + mod.path + "\\n";
    for (const st of sts) {
      // Переменную никто не читает, а вызов — эффект: остаётся только вызов.
      const code = st.init && !needed.has(st) ? st.init + ";" : st.code;
      out += code.replace(IDENT, (name) => {
        const found = lookup(graph, mod, name);
        return found && finalName.has(found.st) ? finalName.get(found.st) : name;
      }) + "\\n";
    }
    out += "//#endregion\\n";
  }
  return { code: out, finalName };
}

function bundle(files, entry) {
  const graph = buildGraph(files, entry);
  const shaken = shake(graph);
  return { graph, shaken, ...hoist(graph, shaken) };
}`;

export const BASE_ROLLDOWN = `//#region src/format.js
function label$1(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label$1(n);
}
//#endregion
//#region src/cart.js
function label(text) {
  return "[" + text + "]";
}
const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label(formatPrice(cart.total()));
}
//#endregion
//#region src/analytics.js
const queue = [];
globalThis.analyticsQueue = queue;
queue.push("start");
//#endregion
//#region src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
//#endregion
`;

export const BASE_ESBUILD = `// src/format.js
function label(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label(n);
}

// src/cart.js
function label2(text) {
  return "[" + text + "]";
}
var cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label2(formatPrice(cart.total()));
}

// src/analytics.js
var queue = [];
globalThis.analyticsQueue = queue;
queue.push("start");

// src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
`;

export const HOIST_FACTS: { t: string; d: string; more?: string }[] = [
  {
    t: 'Кого переименовать — у каждого своё правило',
    d: 'rolldown раздаёт имена от входа назад: `label` остаётся у `cart.js`, ближнего к `main.js`, а `format.js` получает `label$1`. esbuild идёт от начала бандла: `label` у `format.js`, `label2` у `cart.js`. На четырёх модулях с функцией `x` rolldown выдал `x$3`, `x$2`, `x$1`, `x`, esbuild — `x`, `x2`, `x3`, `x4`.',
  },
  {
    t: 'Импорт исчезает, ссылка остаётся',
    d: 'В бандле нет ни одного `import`: `formatPrice` в `cart.js` — это та же функция из `format.js`, и вызов идёт по имени напрямую. Никаких объектов-модулей и поиска экспорта во время работы.',
  },
  {
    t: 'Живая привязка ничего не стоит',
    d: 'Модуль, который делает `count++` у своей `export let count`, после склейки меняет обычную переменную, а импортёр читает ту же самую: `let count = 0;` и `count++` стоят в бандле как в исходнике.',
    more: 'Что такое живая привязка — «Модули и сборка», раздел [«Привязки и циклы»](/tooling/modules/#s2).',
  },
  {
    t: 'Переменная без читателей, но с вызовом',
    d: 'Для `export const theme = createTheme("dark")`, которую никто не читает, rolldown оставил только `createTheme("dark");`, а esbuild — всю строку `var theme = createTheme("dark");`. Вызов обязан случиться, имя — нет.',
  },
];

export const LIVE_SRC = `// counter.js
export let count = 0;

export function inc() {
  count++;
}

// main.js
import { count, inc } from "./counter.js";

inc();

console.log(count);
`;

/** Учебный пример раздачи имён: четыре модуля с одной и той же функцией `x`. */
export const COLLIDE_FILES: Record<string, string> = {
  'src/main.js': `import "./a.js";
import "./b.js";
import "./c.js";

function x() {
  return "main";
}

console.log(x());
`,
  'src/a.js': `function x() {
  return "a";
}

console.log(x());
`,
  'src/b.js': `function x() {
  return "b";
}

console.log(x());
`,
  'src/c.js': `function x() {
  return "c";
}

console.log(x());
`,
};

/** Совпадает с rolldown по порядку: от `a.js` к `main.js`. Сверяется тестом. */
export const COLLIDE_ROLLDOWN = ['x$3', 'x$2', 'x$1', 'x'];
export const COLLIDE_ESBUILD = ['x', 'x2', 'x3', 'x4'];

// ─── Раздел 3, подраздел. Когда склеить нельзя ─────────────────────────────────────────────

export const WRAP_MAIN = `import { formatPrice } from "./format.cjs";
import * as icons from "./icons.js";

const name = process.argv[2] || "cart";

console.log(formatPrice(430), icons[name]());
`;

export const WRAP_FORMAT_CJS = `exports.formatPrice = function (n) {
  return n + " ₽";
};
`;

export const WRAP_ICONS = `export function cart() {
  return "🛒";
}

export function user() {
  return "👤";
}
`;

export const WRAP_ROLLDOWN = `//#region \\0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __exportAll = (all, no_symbols) => {
  let target = {};
  for (var name in all) __defProp(target, name, {
    get: all[name],
    enumerable: true
  });
  if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
  return target;
};
//#endregion
//#region src/icons.js
var import_format = (/* @__PURE__ */ __commonJSMin(((exports) => {
  exports.formatPrice = function(n) {
    return n + " ₽";
  };
})))();
var icons_exports = /* @__PURE__ */ __exportAll({
  cart: () => cart,
  user: () => user
});
function cart() {
  return "🛒";
}
function user() {
  return "👤";
}
//#endregion
//#region src/main.js
const name = process.argv[2] || "cart";
console.log((0, import_format.formatPrice)(430), icons_exports[name]());
//#endregion
`;

export const WRAP_STEPS = [
  '**CommonJS.** `format.cjs` заполняет `exports` во время выполнения, и список его экспортов из текста не прочитать. Сборщик заворачивает модуль в функцию: `__commonJSMin` выполняет его код один раз и потом отдаёт тот же `module.exports`. Здесь её зовут сразу, на месте импорта.',
  '**Вызов через `(0, f)()`.** `formatPrice` теперь свойство объекта `import_format`. Запись `(0, import_format.formatPrice)(430)` вызывает функцию без `this` — так, как её вызвал бы обычный импорт.',
  '**Пространство имён с ключом из переменной.** `icons[name]` может достать любой экспорт, поэтому сборщику нужен настоящий объект модуля: `__exportAll` собирает его из геттеров, и в бандле остаются обе иконки, хотя нужна одна.',
];

export const WRAP_NOTE =
  'Служебный код — плата за обёртки: у rolldown 402 байта из 931 на этом примере, у esbuild 1504 из 2040. Модуль на ESM, импортированный по именам, не стоит ничего. Почему у CommonJS-модуля нельзя заранее узнать экспорты и как импорт `default` разъезжается между инструментами — «Модули и сборка», раздел [«CommonJS против ESM»](/tooling/modules/#s3).';

/** Служебный код обёрток, байты UTF-8. Сверяется тестом. */
export const WRAP_BYTES = { rolldownRuntime: 402, rolldownTotal: 931, esbuildHelpers: 1504, esbuildTotal: 2040 };

// ─── Раздел 3, демо. Сборка целиком ────────────────────────────────────────────────────────

export const FORMAT_THEME = `function label(n) {
  return n + " ₽";
}

export function formatPrice(n) {
  return label(n);
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function createTheme(name) {
  console.log("тема:", name);
  return { name };
}

export const theme = createTheme("dark");
`;

export const FORMAT_THEME_PURE = `function label(n) {
  return n + " ₽";
}

export function formatPrice(n) {
  return label(n);
}

export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function createTheme(name) {
  console.log("тема:", name);
  return { name };
}

export const theme = /* @__PURE__ */ createTheme("dark");
`;

export const MAIN_PKG = `import { formatPrice } from "./format.js";
import { cart, describe } from "./cart.js";
import "analytics";

console.log(formatPrice(cart.total()));

console.log(describe());
`;

export const MAIN_PKG_USED = `import { formatPrice } from "./format.js";
import { cart, describe } from "./cart.js";
import { track } from "analytics";

console.log(formatPrice(cart.total()));

console.log(describe());

track("open");
`;

export const ANALYTICS_PKG_JSON = `{ "name": "analytics", "type": "module", "main": "index.js", "sideEffects": false }
`;

export const SCENARIOS: BundleScenario[] = [
  {
    id: 'base',
    label: 'Магазин',
    files: APP_FILES,
    entry: 'src/main.js',
    note: 'Четыре модуля из раздела «Граф модулей». `formatDate` и `track` никому не нужны и выпадают, а две функции `label` встречаются в одной области видимости — одна становится `label$1`.',
    rolldown: BASE_ROLLDOWN,
  },
  {
    id: 'call',
    label: 'Вызов фабрики',
    files: { ...APP_FILES, 'src/format.js': FORMAT_THEME },
    entry: 'src/main.js',
    note: 'В `format.js` появилась тема: `export const theme = createTheme("dark")`. Переменную `theme` никто не читает, но вызов — эффект. Вызов остаётся, переменная исчезает.',
    rolldown: `//#region src/format.js
function label$1(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label$1(n);
}
function createTheme(name) {
  console.log("тема:", name);
  return { name };
}
createTheme("dark");
//#endregion
//#region src/cart.js
function label(text) {
  return "[" + text + "]";
}
const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label(formatPrice(cart.total()));
}
//#endregion
//#region src/analytics.js
const queue = [];
globalThis.analyticsQueue = queue;
queue.push("start");
//#endregion
//#region src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
//#endregion
`,
  },
  {
    id: 'pure',
    label: 'С пометкой PURE',
    files: { ...APP_FILES, 'src/format.js': FORMAT_THEME_PURE },
    entry: 'src/main.js',
    note: 'Тот же вызов с `/* @__PURE__ */`. Сборщик верит пометке и выбрасывает вызов, а за ним и `createTheme`. Строки «тема: dark» в консоли больше не будет: пометку никто не проверяет.',
    rolldown: `//#region src/format.js
function label$1(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label$1(n);
}
//#endregion
//#region src/cart.js
function label(text) {
  return "[" + text + "]";
}
const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label(formatPrice(cart.total()));
}
//#endregion
//#region src/analytics.js
const queue = [];
globalThis.analyticsQueue = queue;
queue.push("start");
//#endregion
//#region src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
//#endregion
`,
  },
  {
    id: 'pkg',
    label: 'sideEffects: false',
    files: {
      'src/main.js': MAIN_PKG,
      'src/format.js': APP_FORMAT,
      'src/cart.js': APP_CART,
      'node_modules/analytics/package.json': ANALYTICS_PKG_JSON,
      'node_modules/analytics/index.js': APP_ANALYTICS,
    },
    entry: 'src/main.js',
    note: 'Аналитика переехала в пакет `analytics`, и в его `package.json` стоит `"sideEffects": false`. `import "analytics"` ничего не берёт, поэтому модуль пропущен целиком — вместе с записью в `globalThis`.',
    rolldown: `//#region src/format.js
function label$1(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label$1(n);
}
//#endregion
//#region src/cart.js
function label(text) {
  return "[" + text + "]";
}
const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label(formatPrice(cart.total()));
}
//#endregion
//#region src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
//#endregion
`,
  },
  {
    id: 'pkgUsed',
    label: 'Экспорт пакета взят',
    files: {
      'src/main.js': MAIN_PKG_USED,
      'src/format.js': APP_FORMAT,
      'src/cart.js': APP_CART,
      'node_modules/analytics/package.json': ANALYTICS_PKG_JSON,
      'node_modules/analytics/index.js': APP_ANALYTICS,
    },
    entry: 'src/main.js',
    note: 'Теперь `main.js` вызывает `track("open")`. Взят один экспорт — и вернулись все эффекты модуля: `"sideEffects": false` позволяет пропустить модуль, только пока из него ничего не нужно.',
    rolldown: `//#region src/format.js
function label$1(n) {
  return n + " ₽";
}
function formatPrice(n) {
  return label$1(n);
}
//#endregion
//#region src/cart.js
function label(text) {
  return "[" + text + "]";
}
const cart = {
  items: [250, 180],
  total() {
    return this.items.reduce((sum, p) => sum + p, 0);
  }
};
function describe() {
  return label(formatPrice(cart.total()));
}
//#endregion
//#region node_modules/analytics/index.js
const queue = [];
function track(event) {
  queue.push(event);
}
globalThis.analyticsQueue = queue;
queue.push("start");
//#endregion
//#region src/main.js
console.log(formatPrice(cart.total()));
console.log(describe());
track("open");
//#endregion
`,
  },
];

export const DEMO_CAPTION =
  'Граф, отбор, имена и итоговый код считают `buildGraph`, `shake` и `hoist` — те самые функции, что напечатаны выше. Строка под бандлом сравнивает их результат с тем, что rolldown 1.2.8 собрал из тех же файлов (табуляция rolldown заменена двумя пробелами).';

// ─── Раздел 4. Чанки ───────────────────────────────────────────────────────────────────────

export const CHUNK_FILES: Record<string, string> = {
  'src/main.js': `const openA = () => import("./route-a.js");
const openB = () => import("./route-b.js");

openA().then((m) => console.log(m.renderA()));
openB().then((m) => console.log(m.renderB()));
`,
  'src/route-a.js': `import { formatPrice } from "./format.js";
import { table } from "./table.js";

export function renderA() {
  return table([formatPrice(250), formatPrice(180)]);
}
`,
  'src/route-b.js': `import { formatPrice } from "./format.js";

export function renderB() {
  return "Итого: " + formatPrice(430);
}
`,
  'src/format.js': `export function formatPrice(n) {
  return n + " ₽";
}
`,
  'src/table.js': `export function table(rows) {
  return rows.join("\\n");
}
`,
};

/** Для печати: пять файлов одним листингом. */
export const CHUNK_APP_CODE = Object.entries(CHUNK_FILES)
  .map(([path, code]) => `// ${path}\n${code}`)
  .join('\n');

export const CHUNK_ROLLDOWN: { file: string; code: string }[] = [
  { file: 'main-BJHq0jV6.js', code: `//#region src/main.js
const openA = () => import("./route-a-BgiS01g9.js");
const openB = () => import("./route-b-GpJVO21A.js");
openA().then((m) => console.log(m.renderA()));
openB().then((m) => console.log(m.renderB()));
//#endregion
` },
  { file: 'format-CM7ZQniE.js', code: `//#region src/format.js
function formatPrice(n) {
  return n + " ₽";
}
//#endregion
export { formatPrice as t };
` },
  { file: 'route-a-BgiS01g9.js', code: `import { t as formatPrice } from "./format-CM7ZQniE.js";
//#region src/table.js
function table(rows) {
  return rows.join("\\n");
}
//#endregion
//#region src/route-a.js
function renderA() {
  return table([formatPrice(250), formatPrice(180)]);
}
//#endregion
export { renderA };
` },
  { file: 'route-b-GpJVO21A.js', code: `import { t as formatPrice } from "./format-CM7ZQniE.js";
//#region src/route-b.js
function renderB() {
  return "Итого: " + formatPrice(430);
}
//#endregion
export { renderB };
` },
];

export const CHUNK_ESBUILD_SHARED = `// src/format.js
function formatPrice(n) {
  return n + " ₽";
}

export {
  formatPrice
};
`;

export const CHUNK_ESBUILD_FILES = ['main-EODEWUU2.js','route-a-SP2DFQ3Y.js','route-b-SVDJO3X4.js','chunk-BJMICGNS.js'];

export const CHUNK_FACTS: { t: string; d: string; more?: string }[] = [
  {
    t: 'Между чанками снова импорт — написанный сборщиком',
    d: 'Внутри одного файла `formatPrice` — просто имя. Маршрутам в отдельных файлах до него так не дотянуться, поэтому общий чанк экспортирует функцию, а маршруты её импортируют. Эти `import` и `export` сборщик дописал сам: в исходниках их не было в таком виде.',
  },
  {
    t: 'Экспорт чанка — не ваше имя',
    d: 'rolldown выдал `export { formatPrice as t }`, и маршруты пишут `import { t as formatPrice }`. Короткое имя `t` экономит байты в каждом импорте. esbuild оставил `formatPrice` как есть, а общий файл назвал `chunk-BJMICGNS.js` — без имени модуля.',
  },
  {
    t: 'Внутри чанка — та же склейка',
    d: 'В `route-a` лежат `table.js` и `route-a.js` подряд, в порядке графа, с общими правилами имён. Чанк — это маленький бандл со своим списком импортов сверху.',
  },
  {
    t: 'О соседе маршрут узнаёт после загрузки',
    d: '`main` знает только адрес `route-a`. Что маршруту нужен ещё `format`, браузер прочитает, когда скачает `route-a`, — второй запрос уйдёт позже первого. rolldown сам по себе этого не исправляет; Vite заворачивает `import()` в `__vitePreload` и запрашивает оба файла сразу.',
    more: 'Как Vite подгружает общий чанк заранее — «Модули и сборка», раздел [«Чанки и кеш»](/tooling/modules/#s5).',
  },
];

export const ESBUILD_IIFE_ERROR = 'Splitting currently only works with the "esm" format';

// ─── Раздел 5. Хеши в именах ───────────────────────────────────────────────────────────────

export const PLAIN_HASH =
  'Как оглавление книги. Пока главы не свёрстаны, в оглавлении стоит «стр. ХХ»: номер страницы ещё неизвестен. Сначала верстают главы, потом проставляют номера. А если вторая глава подросла на страницу, номера в оглавлении придётся перепечатать — хотя текст самого оглавления никто не менял.';

/** Строки импортов и экспортов в хуке `renderChunk` rolldown: имена файлов — ещё заглушки. */
export const PLACEHOLDER_LINES = `const openA = () => import("./route-a-!~{002}~.js");
const openB = () => import("./route-b-!~{003}~.js");
import { t as formatPrice } from "./format-!~{001}~.js";
export { renderA };
import { t as formatPrice } from "./format-!~{001}~.js";
export { renderB };
export { formatPrice as t };`;

export const HASH_CODE = `// FNV-1a: короткий хеш строки. У настоящих сборщиков хеш длиннее и крепче, суть та же.
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// chunks: { имя: { code, deps } }. В code имена других чанков — ещё заглушки,
// deps — чанки, на которые этот ссылается (import и import()).
function chunkHashes(chunks) {
  const done = new Map();
  const hashOf = (name) => {
    if (!done.has(name)) {
      const { code, deps } = chunks[name];
      // Свой код плюс готовые хеши зависимостей: сменился лист — сменились все,
      // кто на него ссылается, вплоть до входа. Кольцо чанков эта версия не умеет.
      done.set(name, fnv1a(code + deps.map(hashOf).join("")));
    }
    return done.get(name);
  };
  for (const name of Object.keys(chunks)) hashOf(name);
  return done;
}`;

export const HASH_NOTE =
  'Порядок у rolldown тот же, только вместо `fnv1a` свой хеш: восемь знаков из алфавита base64url — латинские буквы, цифры, `-` и `_`. Код каждого чанка рендерится один раз — с заглушками `!~{001}~` на месте чужих имён, — потом хеши считаются по готовым кускам, и в конце заглушки заменяются настоящими именами. Если подать учебной `chunkHashes` код с заглушками из `renderChunk`, она меняет хеши у тех же файлов, что и rolldown, — во всех правках таблицы ниже.';

export const HASH_EDITS: { k: string; file: string; find: string; replace: string; rolldown: string[]; esbuild: string[] }[] = [
  { k: 'строка в `formatPrice` (общий чанк)', file: 'src/format.js', find: '" ₽"', replace: '" руб."', rolldown: ['format', 'main', 'route-a', 'route-b'], esbuild: ['chunk', 'main', 'route-a', 'route-b'] },
  { k: 'комментарий в начале `format.js`', file: 'src/format.js', find: '', replace: '// форматирование цены\n', rolldown: [], esbuild: [] },
  { k: 'строка в `table.js` (внутри `route-a`)', file: 'src/table.js', find: '"\\n"', replace: '"; "', rolldown: ['main', 'route-a'], esbuild: ['main', 'route-a'] },
  { k: 'строка в `route-b.js`', file: 'src/route-b.js', find: 'Итого: ', replace: 'Всего: ', rolldown: ['main', 'route-b'], esbuild: ['main', 'route-b'] },
  { k: 'новая строка в `main.js`', file: 'src/main.js', find: '', replace: 'console.log("start");\n', rolldown: ['main'], esbuild: ['main'] },
];

export const HASH_FACTS = [
  {
    t: 'Хеш считают по выходу, а не по исходнику',
    d: 'Комментарий в `format.js` не дожил до бандла — и ни одно имя не сменилось, ни у rolldown, ни у esbuild. Правка, которая не доходит до бандла, кеш пользователей не сбрасывает.',
    tone: 'ok' as const,
  },
  {
    t: 'Вход меняется почти при любой правке',
    d: 'В `main` записаны имена обоих маршрутов, а значит, и их хеши. Поменялся любой маршрут или общий код — сменился и `main`. Поэтому входной файл, на который ссылается `index.html`, меняет имя почти при каждом деплое.',
    tone: 'warn' as const,
  },
  {
    t: 'Хеш наверх, а не вниз',
    d: 'Правка в `table.js` переименовала `route-a` и `main`, но не `format` и не `route-b`: каскад идёт только к тем, кто ссылается на изменённый чанк. Поэтому общий код, вынесенный в свой чанк, переживает правки маршрутов.',
  },
];

/** Подстановка констант: исходник для теста и сводка трёх версий для печати. */
export const INLINE_FILES: Record<string, string> = {
  'src/main.js': `import { formatPrice } from "./format.js";

console.log(formatPrice(430));
`,
  'src/format.js': `const currency = "₽";

export function formatPrice(n) {
  return n + " " + currency;
}
`,
};

export const INLINE_CODE = `// format.js — исходник
const currency = "₽";

export function formatPrice(n) {
  return n + " " + currency;
}

// rolldown 1.2.8 — currency подставлена
function formatPrice(n) {
  return n + " ₽";
}

// esbuild 0.28.2 — переменная на месте
var currency = "₽";`;

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`sideEffects: false` молча выбрасывает голый импорт',
    d: '`import "analytics"` из пакета с `"sideEffects": false` исчезает вместе с эффектом. rolldown 1.2.8 не пишет об этом ничего, esbuild 0.28.2 предупреждает: `Ignoring this import because … was marked as having no side effects`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Один взятый экспорт возвращает все эффекты модуля',
    d: 'Пакет с `"sideEffects": false` худеет, только пока из модуля ничего не нужно. Взяли `track` — в бандл вернулись очередь, запись в `globalThis` и `queue.push`. Модуль, где рядом с нужной функцией живёт тяжёлая регистрация, обещание не спасает.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Пометку PURE никто не проверяет',
    d: 'Вызов с `/* @__PURE__ */`, результат которого не нужен, исчезает вместе с тем, что функция делала внутри. В примере пропал `console.log("тема:", …)`. Ставить пометку на функцию с эффектом — значит потерять эффект в сборке и сохранить в разработке.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Два сборщика — два разных бандла',
    d: 'rolldown выбросил вызов `makeTheme("dark")` без всякой пометки, заглянув в тело функции; esbuild его оставил. Сложение строки с объектом — то же самое. При переезде с одного сборщика на другой размер и состав бандла меняются, хотя код тот же.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Имя в бандле — не ваше имя',
    d: 'Одна и та же функция стала `label$1` у rolldown и осталась `label` у esbuild, а у её соседки — наоборот. Искать функцию в несжатом бандле по имени ненадёжно, в сжатом — бесполезно. Дорогу назад знает карта исходников.',
    code: 'function label$1(n) {   // rolldown: это label из format.js\nfunction label2(text) {  // esbuild: это label из cart.js',
  },
  {
    n: '06',
    t: '`//#region` — подсказка, а не граница',
    d: 'В примере с обёртками rolldown положил обёртку `format.cjs` в регион `src/icons.js`. Регионы помогают глазами найти модуль в бандле, но точной разметки «эта строка из этого файла» не дают — её даёт карта исходников.',
  },
  {
    n: '07',
    t: 'Константы подставляются на место чтения',
    d: 'rolldown превратил `const currency = "₽"` и `n + " " + currency` в `n + " ₽"`: переменной `currency` в бандле нет. esbuild оставил `var currency = "₽"`. Если вы ищете в бандле переменную, которая точно была, — её могли подставить.',
    code: INLINE_CODE,
  },
  {
    n: '08',
    t: 'Правка в листе переименовывает вход',
    d: 'Одна строка в общем `format.js` сменила хеши всех четырёх файлов: маршрутов, которые его импортируют, и `main`, который ссылается на маршруты. После такого деплоя пользователь перекачает всё, хотя менялась одна функция.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Rolldown — документация',
    href: 'https://rolldown.rs/',
    what: 'параметры `treeshake` (`moduleSideEffects`, `annotations`, `propertyReadSideEffects`), `optimization.inlineConst`, имена чанков и хеши; версия 1.2.8 на стенде',
  },
  {
    title: 'Oxc — Dead code elimination',
    href: 'https://oxc.rs/docs/guide/usage/minifier/dead-code-elimination',
    what: 'на что ссылается rolldown в описании своих правил: пометки `@__PURE__`, чтение свойств и неизвестных глобальных имён',
  },
  {
    title: 'esbuild — Tree shaking, Splitting, Ignore annotations',
    href: 'https://esbuild.github.io/api/#tree-shaking',
    what: 'отбор по операторам, `sideEffects`, `/* @__PURE__ */`, разбиение на чанки только для `esm`; версия 0.28.2 на стенде',
  },
  {
    title: 'Rollup — treeshake и output.chunkFileNames',
    href: 'https://rollupjs.org/configuration-options/#treeshake',
    what: 'те же понятия у предшественника rolldown: `moduleSideEffects`, `[hash]` в имени файла',
  },
  {
    title: 'webpack — Tree Shaking',
    href: 'https://webpack.js.org/guides/tree-shaking/',
    what: 'откуда пришло поле `sideEffects` в `package.json` и как его читают',
  },
  {
    title: 'Rich Harris — Tree-shaking versus dead code elimination',
    href: 'https://medium.com/@Rich_Harris/tree-shaking-versus-dead-code-elimination-d3765df85c80',
    what: 'почему сборщик «включает нужное», а не «удаляет лишнее»',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «Tree shaking»](/tooling/modules/#s4) — что считается эффектом и во что обходится каждый способ помешать сборщику. [Модули и сборка, раздел «Чанки и кеш»](/tooling/modules/#s5) — раскраска модулей по чанкам, `__vitePreload` и повтор `import()`. [Source maps изнутри](/tooling/source-maps/) — как из `label$1` в бандле вернуться к исходнику. [HMR изнутри, раздел «Граф и метка в адресе»](/tooling/hmr/#s1) — граф модулей у dev-сервера, где склейки нет. [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — `immutable` для файлов с хешем. [CDN и серверный кеш, раздел «Purge и версии»](/platform/cdn-cache/#s4) — версия в адресе против сброса кеша. [Транспиляция и полифилы](/tooling/transpilation/) — во что Babel переписывает синтаксис под список браузеров и какие полифилы подтягивает core-js. [Публикация npm-пакета](/tooling/package-publishing/) — поле `exports` по шагам, двойной пакет, типы и что уезжает в тарбол. [Бюджеты производительности](/tooling/performance-budgets/) — вес страницы по графу чанков и проверка бюджета в CI на примере этого курса.';
