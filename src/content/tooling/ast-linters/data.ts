import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AstExample } from '@/widgets/ast-lab/model/types';

/**
 * Данные темы «AST и линтеры: как ESLint читает ваш код».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Всё из `node_modules` проекта, ничего не ставилось: ESLint **10.10.0** и его зависимости —
 * espree 11.2.0, eslint-scope 9.1.2, eslint-visitor-keys 5.0.1, esquery 1.7.0; typescript-eslint
 * 8.70.0 (`@typescript-eslint/parser` и `typescript-estree`); `@babel/parser`, `@babel/traverse`,
 * `@babel/generator`, `@babel/types` 7.29.8; Prettier 3.9.6; rolldown 1.2.8 (`rolldown/parseAst`,
 * парсер oxc). Node 24.11.0, октябрь 2026.
 *
 * ESLint вызывался программно — `new Linter()` с плоским конфигом-массивом, `verify` и
 * `verifyAndFix`, — на фикстурах в каталоге стенда; конфиг проекта не трогался. Число проходов
 * автоисправления снято служебным правилом, у которого `create()` считает вызовы: ESLint зовёт
 * `create` каждого правила один раз на каждый `verify`, а `verifyAndFix` делает `verify` на каждом
 * проходе. Порядок обхода снят правилом с обработчиками `'*'` и `'*:exit'`. Области видимости —
 * `context.sourceCode.scopeManager` в `Program:exit`. Плоский конфиг — `ESLint`
 * c `overrideConfigFile: true` и `calculateConfigForFile` на файлах-пустышках; для «живого
 * примера» тот же `calculateConfigForFile` по настоящему `eslint.config.js` проекта (только чтение).
 *
 * Учебные строки (`WALK_CODE`, `RULES_CODE`, `LINT_CODE`, `UNUSED_CODE`, `CONFIG_CODE`,
 * `CODEMOD_CODE`, `REPRINT_CODE`) напечатаны на странице, исполняются виджетом `ast-lab` и
 * сверяются `tests/unit/ast-linters.test.ts` с настоящим ESLint: тот же порядок посещения узлов
 * (на фикстурах темы и на всех `.js` из `node_modules/eslint/lib` — на стенде 375 файлов,
 * 213 396 узлов), те же сообщения, тот же текст после исправлений и то же число проходов.
 * Правила `RULES_CODE` подключаются в ESLint как плагин — тем же объектом, что исполняет учебный
 * линтер.
 *
 * Расхождения учебных версий с настоящими — намеренные и проверены тестом как расхождения:
 *   — `findUnused` считает чтением любое чтение, а `no-unused-vars` не считает чтение,
 *     которое идёт только на запись в ту же переменную (`count = count + 1`, `n++`);
 *   — в `verifyAndFix` нет защиты от круговых правок (у ESLint есть: текст, совпавший с текстом
 *     два прохода назад, останавливает цикл с предупреждением `ESLintCircularFixesWarning`);
 *   — `traverse` знает только селекторы по типу и `*`, без синтаксиса esquery.
 *
 * Только по документации, без запуска: recast и jscodeshift в проекте не установлены — что
 * recast перепечатывает лишь изменённые узлы, взято из его README. Срок «правила оформления
 * доступны до ESLint 11» — из `meta.deprecated.availableUntil` самих правил (это данные пакета,
 * а не запуск).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'токен',
    d: 'Неделимый кусок текста программы: слово `if`, имя `code`, строка `\'SALE\'`, знак `==`. Первое, что делает парсер, — режет текст на токены и выбрасывает пробелы.',
  },
  {
    k: 'AST (абстрактное синтаксическое дерево)',
    d: 'Программа в виде дерева: узел «условие» держит узел «сравнение», тот — «строку» и «имя». Скобки, точки с запятой и пробелы в дерево не попадают — отсюда «абстрактное».',
  },
  {
    k: 'ESTree',
    d: 'Общее соглашение, как называются узлы и поля дерева JavaScript: `Program`, `CallExpression`, поле `callee`. По нему пишут парсеры espree, acorn, typescript-estree и oxc, поэтому правило ESLint работает с любым из них.',
  },
  {
    k: '`range` и `loc`',
    d: 'Где узел лежит в тексте. `range` — смещения от начала файла: `[93, 107]`. `loc` — строка (с единицы) и колонка (с нуля) начала и конца.',
  },
  {
    k: 'селектор',
    d: 'Ключ в объекте, который возвращает правило: `BinaryExpression`, `Identifier:exit`, `IfStatement > BinaryExpression`. ESLint вызывает функцию по ключу, когда обход доходит до подходящего узла.',
  },
  {
    k: 'область видимости (scope)',
    d: 'Участок кода, где имя что-то значит: модуль, функция, блок `{}`. ESLint строит их отдельно от дерева: в каждой — список объявленных переменных и ссылок на них.',
  },
  {
    k: 'автоисправление (fix)',
    d: 'Правка, которую правило прикладывает к сообщению: «замени символы с 75-го по 77-й на `===`». Это правка текста по смещениям, а не перестройка дерева.',
  },
  {
    k: 'codemod',
    d: 'Программа, которая массово переписывает код: разбирает файл, находит узлы, меняет их и записывает файл обратно. Так переезжают на новое API во всём проекте сразу.',
  },
];

export const PLAIN_AST =
  'Как разбор предложения в школе. «Мама мыла раму»: подчеркнуть подлежащее, сказуемое, дополнение и провести стрелки, что от чего зависит. Пробелы и запятые в такой схеме не нужны — нужна только структура. Парсер делает с кодом то же самое, а линтер потом задаёт вопросы уже схеме: «есть ли сравнение, где слева строка?»';

export const PREREQ_NOTE =
  'Тема опирается на две вещи из других тем и на одну, которой на сайте отдельно нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Текст программы разбирают в дерево',
    d: 'Прежде чем что-то делать с кодом, инструмент превращает текст в дерево узлов и дальше работает с деревом. Как это выглядит на маленьком языке шаблонов — разбор, анализ, генерация кода — показано на учебном компиляторе.',
    href: '/frameworks/framework-compilers/#s2',
    hrefLabel: '«Компиляторы фреймворков», раздел «Учебный компилятор»',
    tone: 'info',
  },
  {
    t: 'Строки и колонки считают по-разному',
    d: 'Строку обычно считают с единицы, а колонку — где с нуля, где с единицы. Здесь это всплывёт трижды: в `loc` узла, в сообщении ESLint и в смещениях `range`.',
    href: '/tooling/source-maps/#s3',
    hrefLabel: '«Source maps изнутри», раздел «От стека к исходнику»',
    tone: 'info',
  },
  {
    t: 'Область видимости',
    d: 'Имя, объявленное через `const` внутри функции, видно только в ней; внутри блока `{}` — только в блоке. Когда код обращается к имени, движок ищет его сначала в ближайшей области, потом во внешней, и так до глобальной.',
    tone: 'info',
  },
];

// ─── Раздел 1. От текста к дереву ──────────────────────────────────────────────────────────

/** Сквозной пример. На нём сняты токены, дерево, обход, области видимости и исправления. */
export const DISCOUNT_CODE = `export function discount(price, code) {
  const unused = 0;
  if ('string' == typeof code && 'SALE' == code) {
    return price * 0.9;
  }
  return price;
}
`;

/** Сколько всего в сквозном примере: символов, токенов, узлов. Сверяется тестом. */
export const DISCOUNT_STATS = { chars: 157, tokens: 36, nodes: 27 };

/** Токены третьей строки — `espree.parse(…, { tokens: true })`. */
export const TOKENS_LINE3 = [
  { type: 'Keyword', value: 'if', range: [62, 64] },
  { type: 'Punctuator', value: '(', range: [65, 66] },
  { type: 'String', value: "'string'", range: [66, 74] },
  { type: 'Punctuator', value: '==', range: [75, 77] },
  { type: 'Keyword', value: 'typeof', range: [78, 84] },
  { type: 'Identifier', value: 'code', range: [85, 89] },
  { type: 'Punctuator', value: '&&', range: [90, 92] },
  { type: 'String', value: "'SALE'", range: [93, 99] },
  { type: 'Punctuator', value: '==', range: [100, 102] },
  { type: 'Identifier', value: 'code', range: [103, 107] },
  { type: 'Punctuator', value: ')', range: [107, 108] },
  { type: 'Punctuator', value: '{', range: [109, 110] },
];

export const TOKENS_NOTE =
  'Пробелов среди токенов нет, но они не пропали бесследно: между `==` и `typeof` разрыв в один символ — смещение 77 сменяется на 78. Скобки `(` и `)` вокруг условия — токены, а в дереве их не будет: условие `if` и так знает, где кончается.';

/** Узел `'SALE' == code` из дерева сквозного примера — только поля ESTree. Тест сверяет с espree. */
export const NODE_PRINT = `{
  type: 'BinaryExpression',
  operator: '==',
  left:  { type: 'Literal', value: 'SALE', raw: "'SALE'", range: [93, 99] },
  right: { type: 'Identifier', name: 'code', range: [103, 107] },
  range: [93, 107],
  loc: { start: { line: 3, column: 33 }, end: { line: 3, column: 47 } },
}`;

export const NODE_NOTE =
  'Так выглядит второе сравнение в условии — `\'SALE\' == code`. У каждого узла есть `type`; остальные поля зависят от типа: у сравнения — `operator`, `left` и `right`, у строки — `value` и `raw` (как она записана, с кавычками), у имени — `name`. У `left` и `right` тоже есть `loc` — здесь он опущен. espree добавляет ещё `start` и `end`: это те же два числа, что в `range`.';

export const AST_FACTS = [
  {
    t: 'Комментарии — не в дереве',
    d: 'Узла «комментарий» в ESTree нет. Парсер складывает комментарии отдельным списком `comments` рядом с `tokens`, у каждого свой `range`. Инструмент, который печатает файл заново из дерева, должен сам решить, к какому узлу комментарий прилепить.',
    tone: 'warn' as const,
  },
  {
    t: '`range` — в символах UTF-16',
    d: 'Смещения считаются так же, как индексы строки в JS: `text.slice(93, 107)` вернёт ровно `\'SALE\' == code`. В строке `const s = \'🙂 привет\'; const x = 1;` второе объявление начинается на 23 — хотя в байтах UTF-8 до него 31. Так отдают все три парсера стенда: espree, typescript-estree и oxc в `rolldown/parseAst`.',
  },
  {
    t: 'Типы — забота другого парсера',
    d: 'espree понимает только JavaScript. На `(name: string) =>` он отвечает `Parsing error: Unexpected token :` в колонке 20. Парсер typescript-eslint строит то же ESTree и добавляет узлы типов: `TSTypeAnnotation`, `TSStringKeyword`. Правила про обычный JS работают и там.',
  },
];

/** Парсеры, которые подключает `eslint.config.js` этого сайта. */
export const PARSER_ROWS = [
  { k: 'espree', files: '`.js`, `.mjs` — по умолчанию', how: 'Парсер самого ESLint поверх acorn. Отдаёт ESTree с `range`, `loc`, `tokens` и `comments`.' },
  { k: '`@typescript-eslint/parser`', files: '`.ts`, `.tsx`', how: 'Разбирает компилятором TypeScript и переводит его дерево в ESTree с узлами `TS*`.' },
  { k: '`vue-eslint-parser`', files: '`.vue`', how: 'Разбирает шаблон в своё дерево и отдаёт `<script>` вложенному парсеру — в конфиге сайта это парсер TypeScript.' },
  { k: '`astro-eslint-parser`', files: '`.astro`', how: 'То же для Astro: разметка — своим разбором, фронтматтер и скрипты — парсером TypeScript.' },
];

// ─── Раздел 2. Обход: вход, выход, селекторы ───────────────────────────────────────────────

export const PLAIN_TRAVERSE =
  'Как экскурсовод в музее, где залы вложены друг в друга. Он входит в зал, обходит по порядку всё, что внутри, — в том числе вложенные залы целиком, — и только потом выходит. Сказать «в этом зале было три картины» можно лишь на выходе: на входе ещё ничего не посчитано.';

export const WALK_CODE = `// Обход в глубину: «вход» в узел, дети по порядку, «выход».
// KEYS — какие поля узла считать детьми и в каком порядке
// (таблица VisitorKeys из espree, та же, что у ESLint).
function traverse(ast, listeners) {
  const call = (selector, node) => {
    for (const fn of listeners[selector] ?? []) fn(node);
  };
  (function visit(node, parent) {
    node.parent = parent;
    call('*', node);                  // «любой узел» — раньше, чем селектор по типу
    call(node.type, node);
    for (const key of KEYS[node.type] ?? []) {
      const child = node[key];
      for (const c of Array.isArray(child) ? child : [child]) {
        if (c) visit(c, node);        // в массиве бывают дыры: [a, , b]
      }
    }
    call('*:exit', node);
    call(node.type + ':exit', node);
  })(ast, null);
}`;

export const WALK_NOTE =
  'Обработчики — это и есть правило: объект «селектор → функция». ESLint собирает обработчики всех включённых правил в один такой объект и обходит дерево **один раз** на все правила. Поле `parent` парсер не ставит — его дописывает обход, поэтому правило может подняться от узла к предкам.';

/** Вход и выход по условию `if` сквозного примера: `'*'` и `'*:exit'` в настоящем ESLint. */
export const VISIT_TRACE = `→ LogicalExpression &&
  → BinaryExpression ==          // demo/yoda, demo/no-loose-eq
    → Literal 'string'
    ← Literal
    → UnaryExpression typeof
      → Identifier code
      ← Identifier
    ← UnaryExpression
  ← BinaryExpression
  → BinaryExpression ==          // demo/yoda, demo/no-loose-eq
    → Literal 'SALE'
    ← Literal
    → Identifier code
    ← Identifier
  ← BinaryExpression
← LogicalExpression`;

export const VISIT_NOTE =
  'Каждый узел посещается дважды. Правила из раздела про своё правило подписаны на вход в `BinaryExpression` — их вызовы отмечены справа. На входе в `LogicalExpression` правая часть ещё не посещена, но уже есть в дереве: всё дерево построено до начала обхода, и правило может заглянуть в любую его часть.';

export const TEMPLATE_CODE = 'const msg = `Итого: ${sum} ₽, скидка ${off}`;';

/** Порядок посещения детей шаблонной строки в ESLint. Сверяется тестом. */
export const TEMPLATE_ORDER = [
  'TemplateElement «Итого: »',
  'TemplateElement « ₽, скидка »',
  'TemplateElement «»',
  'Identifier sum',
  'Identifier off',
];

export const TEMPLATE_NOTE =
  'Порядок детей задаёт не текст, а таблица ключей. Для шаблонной строки в ней `quasis`, потом `expressions`: сначала все три куска текста, потом оба выражения — хотя в исходнике они перемежаются. Если перебирать поля узла в том порядке, в каком их создал espree, выйдет наоборот: у него `expressions` записаны раньше. Такой «самодельный» обход на стенде разошёлся с ESLint в 125 файлах из 375 — во всех из-за шаблонных строк.';

/** Порядок вызова для `if (a == b) {}`: какие селекторы и в какой очерёдности сработали на сравнении. */
export const SELECTOR_ORDER = [
  '*',
  'BinaryExpression',
  'IfStatement > BinaryExpression',
  'BinaryExpression[operator="=="]',
];

export const SELECTOR_NOTE =
  'Селекторы ESLint — язык esquery, похожий на CSS: `IfStatement > BinaryExpression` — «сравнение прямо внутри `if`», `BinaryExpression[operator="=="]` — «сравнение с оператором `==`». Если на один узел подходят несколько, их вызывают по возрастанию специфичности, тоже как в CSS: `*`, потом тип, потом тип с родителем, потом тип с атрибутом. На выходе — так же: `*:exit`, затем `BinaryExpression:exit`. Учебный `traverse` знает только тип и `*`.';

export const DEMO_EXAMPLES: AstExample[] = [
  {
    id: 'discount',
    label: 'Скидка',
    code: DISCOUNT_CODE,
    note: 'Сквозной пример. В условии два сравнения с литералом слева, и только одно из них можно исправить молча.',
  },
  {
    id: 'template',
    label: 'Шаблонная строка',
    code: `${TEMPLATE_CODE}\n`,
    note: 'Посмотрите, в каком порядке обход посещает куски текста и подстановки внутри шаблонной строки.',
  },
  {
    id: 'chain',
    label: 'Три сравнения',
    code: "if (typeof a == 'string' && 'b' == typeof c && d != 0) {\n  run();\n}\n",
    note: 'Три сравнения: первое правится за один проход, второе ждёт второго, третье исправить молча нельзя.',
  },
];

export const DEMO_CAPTION =
  'Разбирает текст espree — тот же парсер, что у ESLint, а обход, правила, проходы и правки считают строки `traverse`, `noLooseEq`, `yoda` и `verifyAndFix`, напечатанные в теме. На обходе видно, что правило получает узел целиком — с детьми, родителем и местом в тексте. На исправлениях видно, что отложенная правка не теряется: правило находит ту же ошибку на следующем проходе, уже в новом тексте и с новым `range`.';

// ─── Раздел 3. Области видимости ───────────────────────────────────────────────────────────

export const PLAIN_SCOPE =
  'Как телефонные справочники: у квартиры свой, у подъезда свой, у города свой. Услышав имя, сначала ищут в справочнике квартиры, потом подъезда, потом города. Анализатор областей заранее проходит по всем «звонкам» в коде и записывает, в каком справочнике нашлось каждое имя — или что не нашлось нигде.';

/** Области сквозного примера без глобальной. Снято `scopeManager.scopes` в ESLint. */
export const SCOPE_ROWS = [
  {
    scope: '`module`',
    block: '`Program`',
    vars: '`discount`',
    refs: '—',
  },
  {
    scope: '`function`',
    block: '`FunctionDeclaration`',
    vars: '`arguments`, `price`, `code`, `unused`',
    refs: '`unused` — запись; `code` — чтение ×2; `price` — чтение',
  },
  {
    scope: '`block`',
    block: '`BlockStatement` (тело `if`)',
    vars: '—',
    refs: '`price` — чтение, найдено выше, в `function`',
  },
];

/** Сколько имён в глобальной области без всяких `globals`: встроенные ES. Сверяется тестом. */
export const GLOBAL_VARS = 73;

export const SCOPE_NOTE =
  'Областей четыре: ещё глобальная, в ней 73 встроенных имени вроде `Math` и `Promise`. Тело функции своей блочной области не получает — его покрывает область функции. А тело `if` получает, хоть в нём и не объявлено ничего. Ссылка на `price` оттуда числится в списке `through` блока — «прошла насквозь» — и привязана к переменной области функции. Если имя не найдено нигде, ссылка остаётся непривязанной: на этом построено правило `no-undef`.';

export const UNUSED_CODE = `// Переменная «не используется», если ни одна ссылка на неё её не читает.
function findUnused(scopeManager) {
  const unused = [];
  for (const scope of scopeManager.scopes) {
    if (scope.type === 'global' || scope.type === 'class') continue;
    for (const variable of scope.variables) {
      const def = variable.defs[0];
      if (!def) continue;                           // неявная: arguments
      if (def.type === 'Parameter') continue;       // у параметров свои правила
      const decl = def.type === 'Variable' ? def.parent : def.node;
      if (decl.parent.type.startsWith('Export')) continue;   // export — тоже чтение
      if (!variable.references.some((ref) => ref.isRead())) unused.push(variable.name);
    }
  }
  return unused;
}`;

export const UNUSED_NOTE =
  'Пропуск области `class` — не прихоть. Объявление `class A {}` заводит имя `A` дважды: снаружи и внутри самого класса, чтобы класс мог сослаться на себя. Без пропуска `A` попал бы в список два раза.';

/** Учебная функция против `no-unused-vars` с настройками по умолчанию. Каждая строка — прогон теста. */
export const UNUSED_CASES = [
  { code: DISCOUNT_CODE.split('\n')[1].trim() + ' // в функции discount', core: '`unused`', mine: '`unused`', same: true },
  { code: 'const { a, ...rest } = obj; console.log(rest);', core: '`a`', mine: '`a`', same: true },
  { code: 'export const y = 2; function helper() {} class A {}', core: '`helper`, `A`', mine: '`helper`, `A`', same: true },
  { code: 'let count = 0; count = count + 1;', core: '`count`', mine: '—', same: false },
  { code: 'let n = 0; n++;', core: '`n`', mine: '—', same: false },
];

export const UNUSED_DIFF_NOTE =
  'Расходятся две последние строки, и права здесь `no-unused-vars`. В `count = count + 1` чтение есть, но его результат идёт только обратно в `count`: значение никто не использует. Настоящее правило проверяет, где стоит чтение, — внутри присваивания той же переменной или в `count++`, — и такое чтение не засчитывает. Для этого ему мало списка ссылок, оно смотрит на соседние узлы дерева.';

export const PARAMS_NOTE =
  'Параметры функции правило по умолчанию проверяет иначе — режим `after-used`. В `function f(a, b) { return b; }` неиспользуемый `a` прощён: убрать его нельзя, не сдвинув `b`. А в `function f(a, b) { return a; }` правило укажет на `b` — он последний, и его можно просто стереть.';

// ─── Раздел 4. Своё правило ────────────────────────────────────────────────────────────────

export const RULES_CODE = `const isTypeof = (n) => n.type === 'UnaryExpression' && n.operator === 'typeof';

const noLooseEq = {
  meta: { type: 'suggestion', fixable: 'code' },
  create(context) {
    const { sourceCode } = context;
    return {
      BinaryExpression(node) {
        if (node.operator !== '==' && node.operator !== '!=') return;
        // Сам оператор — первый токен после левой части с таким значением.
        const op = sourceCode.ast.tokens.find(
          (t) => t.range[0] >= node.left.range[1] && t.value === node.operator,
        );
        // Чинить молча можно, только если смысл не изменится:
        // typeof всегда даёт строку, у двух литералов тип виден сразу.
        const safe = isTypeof(node.left) || isTypeof(node.right) ||
          (node.left.type === 'Literal' && node.right.type === 'Literal' &&
            typeof node.left.value === typeof node.right.value);
        context.report({
          node,
          loc: op.loc,
          message: \`Нестрогое «\${node.operator}»: нужно «\${node.operator}=».\`,
          fix: safe ? (fixer) => fixer.replaceText(op, node.operator + '=') : undefined,
        });
      },
    };
  },
};

const yoda = {
  meta: { type: 'suggestion', fixable: 'code' },
  create(context) {
    const { sourceCode } = context;
    return {
      BinaryExpression(node) {
        if (!['==', '===', '!=', '!=='].includes(node.operator)) return;
        // Литерал слева, а справа — имя или typeof: 'SALE' == code.
        const simple = node.right.type === 'Identifier' || isTypeof(node.right);
        if (node.left.type !== 'Literal' || !simple) return;
        context.report({
          node,
          message: \`Литерал слева от «\${node.operator}»: переставьте части.\`,
          fix: (fixer) => fixer.replaceText(node,
            \`\${sourceCode.getText(node.right)} \${node.operator} \${sourceCode.getText(node.left)}\`),
        });
      },
    };
  },
};

const rules = { 'demo/no-loose-eq': noLooseEq, 'demo/yoda': yoda };`;

export const RULE_PARTS = [
  {
    k: '`meta`',
    d: 'Паспорт правила. `type` — «ошибка», «совет» или «оформление»; `fixable: \'code\'` — обещание, что правило умеет исправлять. Без него ESLint не примет `fix` и бросит исключение: `Fixable rules must set the meta.fixable property`.',
  },
  {
    k: '`create(context)`',
    d: 'Вызывается один раз на файл (точнее, на проход) и возвращает обработчики. Через `context` правило видит текст и дерево (`context.sourceCode`) и сообщает о проблеме (`context.report`).',
  },
  {
    k: '`context.report`',
    d: 'Сообщение о проблеме: узел (`node`) или точное место (`loc`), текст и, если можно, `fix`. Место нужно для подсказки в редакторе — `noLooseEq` подчёркивает только оператор, а `yoda` — всё сравнение.',
  },
  {
    k: '`fix(fixer)`',
    d: 'Функция, которая возвращает правку: `{ range: [75, 77], text: \'===\' }`. `fixer.replaceText(узел, текст)` — просто удобная запись: берёт `range` у узла или токена.',
  },
];

export const PLUGIN_CODE = `// eslint.config.js — правила подключаются плагином, имя правила — «плагин/правило»
import { noLooseEq, yoda } from './rules.js';

export default [
  {
    plugins: { demo: { rules: { 'no-loose-eq': noLooseEq, yoda } } },
    rules: { 'demo/no-loose-eq': 'error', 'demo/yoda': 'error' },
  },
];`;

/** Что учебный `verify` и ESLint с теми же правилами говорят о сквозном примере. */
export const DISCOUNT_MESSAGES = [
  { pos: '3:7–3:30', rule: 'demo/yoda', message: 'Литерал слева от «==»: переставьте части.', fix: "`[66, 89]` → `typeof code == 'string'`" },
  { pos: '3:16–3:18', rule: 'demo/no-loose-eq', message: 'Нестрогое «==»: нужно «===».', fix: '`[75, 77]` → `===`' },
  { pos: '3:34–3:48', rule: 'demo/yoda', message: 'Литерал слева от «==»: переставьте части.', fix: "`[93, 107]` → `code == 'SALE'`" },
  { pos: '3:41–3:43', rule: 'demo/no-loose-eq', message: 'Нестрогое «==»: нужно «===».', fix: 'нет: `code` может оказаться числом' },
];

export const SAFE_NOTE =
  '`noLooseEq` не чинит `\'SALE\' == code` — и это не лень. Если `code` придёт числом, `5 == \'5\'` даёт `true`, а `5 === \'5\'` — `false`: замена изменила бы поведение программы. Встроенное правило `eqeqeq` поступает так же: на сквозном примере оно дало правку для сравнения с `typeof`, а для `\'SALE\' == code` — только сообщение. Автоисправление обязано сохранять смысл; где это не гарантировано, правило только сообщает.';

// ─── Раздел 5. Автоисправления и проходы ───────────────────────────────────────────────────

export const PLAIN_FIX =
  'Как корректура в типографии. Корректор отмечает правки на распечатке по номерам символов. Две правки, которые задевают одно место, внести сразу нельзя: после первой номера символов в этом месте поедут. Вторую откладывают до новой распечатки — и там корректор найдёт ошибку заново, уже на новом месте.';

export const LINT_CODE = `const fixer = {
  replaceText: (nodeOrToken, text) => ({ range: nodeOrToken.range, text }),
  replaceTextRange: (range, text) => ({ range, text }),
};

// Один проход: каждое правило вешает обработчики, обход их вызывает.
function verify(text, ast, rules) {
  const messages = [];
  const listeners = {};
  for (const [ruleId, rule] of Object.entries(rules)) {
    const context = {
      sourceCode: { text, ast, getText: (n) => text.slice(n.range[0], n.range[1]) },
      report({ node, loc = node.loc, message, fix }) {
        messages.push({
          ruleId, message,
          line: loc.start.line, column: loc.start.column + 1,   // колонки — с единицы
          endLine: loc.end.line, endColumn: loc.end.column + 1,
          fix: fix ? fix(fixer) : undefined,
        });
      },
    };
    for (const [selector, fn] of Object.entries(rule.create(context))) {
      (listeners[selector] ??= []).push(fn);
    }
  }
  traverse(ast, listeners);
  return messages.sort((a, b) => a.line - b.line || a.column - b.column);
}

// Правки идут слева направо. Та, что заходит на уже внесённую (или стоит
// к ней вплотную), откладывается: правило найдёт ошибку снова — в новом тексте.
function applyFixes(text, messages) {
  const fixes = messages.filter((m) => m.fix)
    .sort((a, b) => a.fix.range[0] - b.fix.range[0] || a.fix.range[1] - b.fix.range[1]);
  const applied = [], skipped = [];
  let output = '', lastPos = -Infinity;
  for (const m of fixes) {
    const [start, end] = m.fix.range;
    if (lastPos >= start) { skipped.push(m); continue; }
    output += text.slice(Math.max(0, lastPos), start) + m.fix.text;
    lastPos = end;
    applied.push(m);
  }
  output += text.slice(Math.max(0, lastPos));
  return { output, applied, skipped };
}

const MAX_PASSES = 10;

function verifyAndFix(text, rules) {
  const passes = [];
  let messages, result;
  do {
    messages = verify(text, parse(text), rules);   // заново: старое дерево устарело
    result = applyFixes(text, messages);
    passes.push({ text, messages, ...result });
    text = result.output;
  } while (result.applied.length && passes.length < MAX_PASSES);
  // Упёрлись в потолок, не дочинив: проверить итог ещё раз.
  const recheck = result.applied.length > 0;
  if (recheck) messages = verify(text, parse(text), rules);
  return { output: text, messages, passes, recheck };
}`;

export const LINT_NOTE =
  'Колонку в сообщении ESLint считает с единицы, хотя в `loc` она с нуля, — отсюда `+ 1`. Правки сортируются по началу, и внесённая правка «занимает» текст до своего конца: следующая, которая начинается раньше этого конца **или ровно на нём**, откладывается. После прохода дерево устарело — смещения в нём указывают в старый текст, — поэтому следующий проход разбирает файл заново и заново зовёт все правила.';

/** Проходы `verifyAndFix` на сквозном примере. Совпадают у учебной версии и у ESLint. */
export const PASS_ROWS = [
  { n: '1', messages: '4', applied: 'обе `yoda`: `[66, 89]` и `[93, 107]`', skipped: '`no-loose-eq` `[75, 77]` — внутри `[66, 89]`' },
  { n: '2', messages: '2', applied: '`no-loose-eq` `[78, 80]`: `==` → `===` в `typeof code == \'string\'`', skipped: '—' },
  { n: '3', messages: '1', applied: '—', skipped: '— (правок нет — цикл окончен)' },
];

export const DISCOUNT_FIXED = `export function discount(price, code) {
  const unused = 0;
  if (typeof code === 'string' && code == 'SALE') {
    return price * 0.9;
  }
  return price;
}
`;

export const FIXED_NOTE =
  'Три прохода, и третий нужен только чтобы убедиться, что править больше нечего. Осталось одно сообщение — `==` в `code == \'SALE\'`, у которого правки нет. Отложенная правка второго прохода — не та же самая, что на первом: на первом `==` занимал символы 75–77 в `\'string\' == typeof code`, на втором — 78–80 в `typeof code == \'string\'`. Правило нашло его заново и выдало новую правку с новым `range`.';

/** Сколько раз ESLint вызвал `verify` (= `create` каждого правила) в разных случаях. */
export const PASS_FACTS = [
  {
    t: 'Встроенные правила ведут себя так же',
    d: '`yoda` + `eqeqeq` на сквозном примере: три прохода и **тот же** итоговый текст, что у учебных правил. Пара `no-var` + `prefer-const` превращает `var total = 1` в `let`, а `let` — в `const` тоже за три: второе правило видит работу только после первого прохода.',
  },
  {
    t: 'Потолок — десять',
    d: 'Правило, которое на каждом проходе находит, что дописать (на стенде — «допиши `;` в конец файла»), остановится на десятом проходе: в файле десять точек с запятой. ESLint вызовет правила одиннадцать раз — после десятого прохода ещё одна проверка, чтобы отчёт описывал итоговый текст.',
    tone: 'warn' as const,
  },
  {
    t: 'Круговые правки ловятся',
    d: 'Два правила, одно меняет `a` на `b`, другое `b` на `a`. Учебная версия честно сделает десять проходов. ESLint замечает, что текст совпал с тем, что был два прохода назад, останавливается после трёх и печатает `ESLintCircularFixesWarning`.',
  },
];

// ─── Раздел 6. Плоский конфиг ──────────────────────────────────────────────────────────────

export const PLAIN_FLAT =
  'Как стопка прозрачных плёнок на проекторе. Каждая следующая закрывает только то, что на ней нарисовано, а остальное видно с нижних. Плёнка, где написано лишь «строгость: предупреждение», меняет строгость, но не стирает подпись снизу — настройки правила остаются прежними.';

export const CONFIG_EXAMPLE = `export default [
  { ignores: ['dist/**'] },
  { rules: { eqeqeq: ['error', 'smart'], 'no-console': ['error', { allow: ['warn'] }] } },
  { files: ['src/**/*.js'], rules: { 'no-console': 'warn', 'no-var': 'error' } },
  { files: ['src/legacy/**'], rules: { 'no-var': 'off', eqeqeq: ['warn'] } },
];`;

export const CONFIG_CODE = `// Какие правила достанутся файлу. match(path, pattern) — сравнение с маской.
function rulesFor(path, configs, match) {
  const hit = (patterns = []) => patterns.some((p) => match(path, p));
  // Блок, где нет ничего, кроме ignores, исключает файл целиком.
  const onlyIgnores = (c) => Object.keys(c).length === 1 && c.ignores;
  if (configs.some((c) => onlyIgnores(c) && hit(c.ignores))) return undefined;
  // Файл берут в работу, только если его называет хоть один files.
  if (!configs.some((c) => c.files && hit(c.files))) return undefined;

  const rules = {};
  for (const c of configs) {                        // сверху вниз
    if (onlyIgnores(c)) continue;
    if (c.files && !hit(c.files)) continue;
    if (c.ignores && hit(c.ignores)) continue;
    for (const [name, value] of Object.entries(c.rules ?? {})) {
      const [level, ...options] = [].concat(value);
      const severity = { off: 0, warn: 1, error: 2 }[level] ?? level;
      // Одна строгость — старые настройки правила остаются.
      // Строгость с настройками — настройки заменяются целиком.
      rules[name] = options.length
        ? [severity, ...options]
        : [severity, ...(rules[name]?.slice(1) ?? [])];
    }
  }
  return rules;
}`;

/** ESLint сам ставит эти блоки перед вашими. Учебной функции их передают явно. */
export const DEFAULT_FILES = ['**/*.js', '**/*.mjs', '**/*.cjs'];

export const CONFIG_NOTE =
  'Перед вашим массивом ESLint ставит свои блоки: `files` для всех `.js`, `.mjs` и `.cjs` и `ignores` для `node_modules` и `.git`. Учебной функции этот блок `files` передают первым элементом массива. Блок без `files` действует на все файлы, которые линтер **и так** проверяет, — но сам файл в проверку не добавляет.';

/** Итог для файлов: `rulesFor` и `ESLint#calculateConfigForFile` на том же массиве. 0 — off, 1 — warn, 2 — error. */
export const CONFIG_ROWS = [
  { file: 'src/app.js', rules: "`eqeqeq: [2, 'smart']`, `no-console: [1, { allow: ['warn'] }]`, `no-var: [2]`", why: 'Второй и третий блоки. `\'warn\'` сменил строгость `no-console`, а `allow` остался от второго блока.' },
  { file: 'src/legacy/old.js', rules: "`eqeqeq: [1, 'smart']`, `no-console: [1, …]`, `no-var: [0]`", why: 'Четвёртый блок поверх: `[\'warn\']` — массив из одной строгости, и `\'smart\'` всё равно сохранился.' },
  { file: 'tools/run.cjs', rules: "`eqeqeq: [2, 'smart']`, `no-console: [2, { allow: ['warn'] }]`", why: 'Только второй блок: третий называет лишь `.js` внутри `src`.' },
  { file: 'dist/x.js', rules: 'не проверяется', why: 'Первый блок — глобальное `ignores`.' },
  { file: 'src/a.ts', rules: 'не проверяется', why: 'Ни один `files` не называет `.ts`. ESLint отвечает: файл пропущен, подходящей конфигурации нет.' },
];

export const PROJECT_NOTE =
  'Живой пример — `eslint.config.js` этого сайта. Правило `no-restricted-imports` в нём держит границы слоёв: виджет не импортирует страницы, а компоненты библиотеки берутся только через `@/shared/ui`. Раньше это были разные блоки, и последний подошедший заменял настройки правила целиком: для файлов виджетов от запрета на прямой импорт библиотеки не оставалось ничего. Теперь у каждого файла один блок со всеми ограничениями сразу. Для `src/widgets/source-map-lab/ui/SourceMapLab.vue` ESLint собирает 214 правил, и у `no-restricted-imports` в итоге три запрещённых пути библиотеки и две маски: `@/pages/*` и `d3-*`.';

// ─── Раздел 7. Codemod и форматтер ─────────────────────────────────────────────────────────

export const PLAIN_CODEMOD =
  'Есть два способа поправить слово в рукописи. Можно взять ручку и исправить только это слово — остальные страницы останутся как были, с пометками на полях и пятном от кофе. А можно перенабрать книгу заново: текст тот же, но вёрстка — уже типографии. Codemod по `range` — ручка, печать из дерева — перенабор.';

export const MONEY_CODE = `import { formatPrice } from './money';

// Итог корзины. Валюту передают вторым аргументом.
export const total = (cart) =>
  formatPrice( cart.sum , 'RUB' );   // пробелы — как было


const hint = formatPrice(cart.sum, "USD") // двойные кавычки
`;

export const CODEMOD_CODE = `// formatPrice(x, cur)  →  formatMoney(x, { currency: cur })
function codemod(text) {
  const ast = parse(text);
  const src = (n) => text.slice(n.range[0], n.range[1]);
  const edits = [];
  traverse(ast, {
    ImportSpecifier: [(node) => {
      if (node.imported.name === 'formatPrice') edits.push({ range: node.imported.range, text: 'formatMoney' });
    }],
    CallExpression: [(node) => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'formatPrice') return;
      const currency = node.arguments[1];
      edits.push({ range: node.callee.range, text: 'formatMoney' });
      edits.push({ range: currency.range, text: \`{ currency: \${src(currency)} }\` });
    }],
  });
  // Те же правки по range, что у автоисправлений, только за один проход.
  return applyFixes(text, edits.map((fix) => ({ fix }))).output;
}`;

export const CODEMOD_OUT = `import { formatMoney } from './money';

// Итог корзины. Валюту передают вторым аргументом.
export const total = (cart) =>
  formatMoney( cart.sum , { currency: 'RUB' } );   // пробелы — как было


const hint = formatMoney(cart.sum, { currency: "USD" }) // двойные кавычки
`;

export const REPRINT_CODE = `// Тот же codemod через Babel: поменять узлы и напечатать всё дерево заново.
function codemodReprint(text) {
  const ast = babel.parse(text, { sourceType: 'module' });
  babel.traverse(ast, {
    ImportSpecifier({ node }) {
      if (node.imported.name === 'formatPrice') node.imported.name = node.local.name = 'formatMoney';
    },
    CallExpression({ node }) {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'formatPrice') return;
      node.callee.name = 'formatMoney';
      const t = babel.types;
      node.arguments[1] = t.objectExpression([
        t.objectProperty(t.identifier('currency'), node.arguments[1]),
      ]);
    },
  });
  return babel.generate(ast, {}, text).code;
}`;

export const REPRINT_OUT = `import { formatMoney } from './money';

// Итог корзины. Валюту передают вторым аргументом.
export const total = cart => formatMoney(cart.sum, {
  currency: 'RUB'
}); // пробелы — как было

const hint = formatMoney(cart.sum, {
  currency: "USD"
}); // двойные кавычки`;

export const PRETTIER_OUT = `import { formatMoney } from "./money";

// Итог корзины. Валюту передают вторым аргументом.
export const total = (cart) => formatMoney(cart.sum, { currency: "RUB" }); // пробелы — как было

const hint = formatMoney(cart.sum, { currency: "USD" }); // двойные кавычки
`;

export const CODEMOD_NOTE =
  'Правки по `range` изменили три строки из восьми — ровно те, где был `formatPrice`; лишние пробелы, две пустые строки и разные кавычки остались, потому что этих мест никто не касался. Babel заменил узлы так же верно, но напечатал **весь** файл из дерева: убрал скобки вокруг `cart`, склеил стрелку в одну строку, разложил новый объект на три, добавил точки с запятой и схлопнул пустые строки. Комментарии он сохранил — Babel прикрепляет их к узлам при разборе. В ревью такой codemod выглядит как переписанный файл.';

export const CODEMOD_ALIAS_NOTE =
  'У учебного codemod есть слепое пятно: `import { formatPrice as fp }` он переименует, а вызовы `fp(…)` не найдёт — ищет по имени, а не по переменной. Честный codemod идёт через области видимости: берёт переменную импорта и правит все её ссылки, как это делает `no-unused-vars`.';

export const APPROACH_ROWS = [
  { k: 'правки по `range`', who: 'автоисправления ESLint, учебный `codemod`', keeps: 'всё, чего правка не касается: пробелы, кавычки, комментарии, пустые строки', cost: 'новый текст для узла пишете сами; пересекающиеся правки — только по очереди', tone: 'ok' as const },
  { k: 'перепечатать изменённое', who: 'recast — под капотом у jscodeshift', keeps: 'исходный текст нетронутых узлов; заново печатаются только изменённые', cost: 'отдельная библиотека; в проекте сайта её нет, описано по документации', tone: undefined },
  { k: 'перепечатать всё дерево', who: 'Babel (`@babel/generator`), esbuild, минификаторы', keeps: 'смысл и, у Babel, комментарии; форму — нет', cost: 'диф на весь файл', tone: 'warn' as const },
  { k: 'форматтер', who: 'Prettier', keeps: 'смысл, комментарии, пустые строки (не больше одной подряд)', cost: 'форма своя по определению — ради этого его и ставят', tone: undefined },
];

export const PRETTIER_NOTE =
  'Prettier — не линтер с исправлениями, а принтер: разбирает файл в дерево и печатает его с нуля по своим правилам, не глядя, как файл был свёрстан. Поэтому `\'RUB\'` стало `"RUB"`, а вызов, который влез в 80 символов, собрался в одну строку. Исходную форму он учитывает в двух местах: оставляет одну пустую строку там, где их было несколько, и не сворачивает объект, если после `{` в исходнике стоял перенос. Повторный прогон по своему же выводу не меняет ни символа.';

export const PRETTIER_OBJECT_IN = `const order = {
  id: 1, total: 990 };
const flat = { id: 1,
  total: 990 };
`;

export const PRETTIER_OBJECT_OUT = `const order = {
  id: 1,
  total: 990,
};
const flat = { id: 1, total: 990 };
`;

/** Встроенные правила ESLint 10.10.0: всего, устаревших, с автоисправлением. Сверяется тестом. */
export const RULE_COUNTS = { total: 292, deprecated: 93, fixable: 106 };

export const FORMAT_RULES_NOTE =
  'Отсюда и разделение труда. Правила оформления — отступы, кавычки, точки с запятой — ESLint объявил устаревшими в версии 8.53: из 292 встроенных правил 10.10.0 устаревших 93, и у `indent`, `semi`, `quotes` в паспорте написано, что они доступны до ESLint 11. Им на смену пришёл отдельный плагин ESLint Stylistic, а большинство проектов отдаёт форму Prettier. Линтеру остаются ошибки: сравнения, неиспользуемое, недостижимое.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Порядок обхода — по таблице, а не по тексту',
    d: 'У шаблонной строки ESLint сначала посещает все куски текста, потом все выражения. Правило, которое собирает что-то «в порядке появления в файле», на шаблонной строке с двумя подстановками получит сначала весь текст, потом обе подстановки. Если порядок важен — сортируйте по `range`.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Вплотную — тоже пересечение',
    d: 'Правка, которая начинается ровно там, где кончилась предыдущая, откладывается до следующего прохода: ESLint сравнивает `lastPos >= start`, а не `>`. Две правки соседних токенов `[0, 1]` и `[1, 2]` займут два прохода.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Автоисправление не должно менять смысл',
    d: 'Замена `==` на `===` безопасна только там, где типы заранее известны. `eqeqeq` поэтому чинит `typeof x == \'string\'`, а `code == \'SALE\'` — нет. Своё правило с «удобным» безусловным `fix` молча сломает чей-то код при `eslint --fix`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Дерево после правки устарело',
    d: 'Смещения в дереве указывают в текст, по которому оно построено. Внести две пересекающиеся правки по старым смещениям нельзя — поэтому ESLint откладывает вторую и разбирает файл заново. Codemod, который копит правки, обязан следить за тем же.',
  },
  {
    n: '05',
    t: '`range` — в символах UTF-16, не в байтах',
    d: '`text.slice(...range)` работает. А инструмент, который считает в байтах UTF-8, промахнётся на первой кириллице или эмодзи: `const x` после `\'🙂 привет\'` стоит на 23-м символе и на 31-м байте.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Одна строгость не сбрасывает настройки',
    d: '`\'no-console\': \'warn\'` поверх `[\'error\', { allow: [\'warn\'] }]` даёт `[1, { allow: [\'warn\'] }]`. А строгость с новыми настройками заменяет старые целиком — списки не сливаются. На этом в конфиге сайта терялась половина запретов импорта.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Блок без `files` не добавляет файлы',
    d: 'Конфиг из одного `{ rules: … }` не заставит ESLint проверять `.ts`: файл, который не назван ни одним `files`, пропускается с сообщением «нет подходящей конфигурации». Новый тип файлов — новый блок с `files`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`no-unused-vars` умнее «нет чтений»',
    d: '`count = count + 1` читает `count`, но правило всё равно скажет «не используется»: чтение уходит только в ту же переменную. Самодельная проверка по `isRead()` такие случаи пропустит.',
  },
  {
    n: '09',
    t: 'Codemod по имени промахивается мимо псевдонимов',
    d: 'Поиск вызовов по имени `formatPrice` не найдёт `fp(…)` после `import { formatPrice as fp }`. Надёжнее идти от переменной в области видимости к её ссылкам.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ESLint — Custom Rules',
    href: 'https://eslint.org/docs/latest/extend/custom-rules',
    what: '`meta`, `create(context)`, `context.report`, `fixer`, правила о безопасных исправлениях',
  },
  {
    title: 'ESLint — Selectors',
    href: 'https://eslint.org/docs/latest/extend/selectors',
    what: 'синтаксис селекторов, `:exit`, порядок по специфичности',
  },
  {
    title: 'ESLint — Configuration Files',
    href: 'https://eslint.org/docs/latest/use/configure/configuration-files',
    what: 'плоский конфиг: `files`, `ignores`, глобальные исключения, слияние блоков',
  },
  {
    title: 'ESLint — исходники `linter.js` и `source-code-fixer.js`',
    href: 'https://github.com/eslint/eslint/tree/main/lib/linter',
    what: '`MAX_AUTOFIX_PASSES = 10`, условие `lastPos >= start`, проверка круговых правок; версия 10.10.0 на стенде',
  },
  {
    title: 'ESTree Specification',
    href: 'https://github.com/estree/estree',
    what: 'имена узлов и полей: `Program`, `BinaryExpression`, `TemplateLiteral.quasis`',
  },
  {
    title: 'espree',
    href: 'https://github.com/eslint/js/tree/main/packages/espree',
    what: 'парсер ESLint: `range`, `loc`, `tokens`, `comment`, `VisitorKeys`',
  },
  {
    title: 'eslint-scope',
    href: 'https://github.com/eslint/js/tree/main/packages/eslint-scope',
    what: '`scopeManager`, области, переменные, ссылки, `through`',
  },
  {
    title: 'Deprecation of formatting rules',
    href: 'https://eslint.org/blog/2023/10/deprecating-formatting-rules/',
    what: 'почему правила оформления ушли из ядра в ESLint Stylistic',
  },
  {
    title: 'recast',
    href: 'https://github.com/benjamn/recast',
    what: 'перепечатка только изменённых узлов; на ней построен jscodeshift — на стенде не запускался',
  },
  {
    title: 'Prettier — Rationale',
    href: 'https://prettier.io/docs/rationale',
    what: 'что Prettier сохраняет из исходника: пустые строки, перенос после `{` у объектов',
  },
];

export const RELATED =
  'Смежное на сайте: [Транспиляция и полифилы, раздел «От запроса к плагинам»](/tooling/transpilation/#s2) — Babel тоже работает с деревом: плагины переписывают узлы синтаксиса. [Тест-раннеры изнутри, раздел «Моки и подъём»](/tooling/test-runners/#s3) — `jest.mock` поднимает наверх Babel-плагин, то есть правка дерева. [Бандлер изнутри, раздел «Граф модулей»](/tooling/bundler-internals/#s1) — сборщик тоже разбирает файлы, но ищет в них только импорты. [Source maps изнутри](/tooling/source-maps/) — как позиции в тексте переживают сборку. [TypeScript на уровне типов](/tooling/typescript/) — что делает компилятор, чьё дерево typescript-eslint переводит в ESTree. [CSS-инструменты](/tooling/css-tooling/) — то же дерево и обход, но для CSS: PostCSS, CSS-модули и сканер Tailwind. [Форматтер изнутри](/tooling/formatter/) — Doc и печать по ширине: как Prettier решает, где ломать строку.';
