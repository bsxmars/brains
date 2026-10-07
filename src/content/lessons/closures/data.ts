import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ScopeProgram } from '@/widgets/scope-lab/model/types';

/**
 * Данные темы «Замыкания и области видимости: что функция уносит с собой».
 *
 * Тема написана 2026-10-01. Уже разобранное в других темах здесь дано фразой со ссылкой:
 * устройство Context по слотам, `%DebugPrint` с `FunctionContext[N]` и вид Context в снимке
 * кучи — «Память и GC», раздел «Замыкания» (`/js/memory-gc/#s3`); утечка через
 * колбэк, который держит чужой Context, с замером на двадцати подписках — «Колбэки», раздел
 * «Отмена» (`/js/callbacks/#s8`); поиск такой утечки в DevTools — «Профилирование памяти»,
 * раздел «Retainers»; `#`-поля и приватность через `WeakMap` — «Объектная модель», раздел
 * «Классы»; области видимости глазами линтера (`scopeManager` ESLint) — «AST и линтеры»,
 * раздел «Области видимости»; мёртвая зона в циклических импортах — «Модули и сборка»,
 * раздел «Привязки и циклы». Тема идёт глубже в сам механизм: окружения и их цепочка по
 * спецификации, подъём и мёртвая зона, `for (let …)` и копирование в окружение итерации,
 * что именно V8 кладёт в Context в разных случаях и что делают с этим `eval` и `with`.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6.233.10), Chromium **153.0.8010.12**, Firefox 155.0, WebKit 26.6
 * (Playwright 1.63). Каталог стенда — `scratchpad/agent-closures/`, портов не понадобилось:
 * браузеры исполняли код через `page.evaluate` на пустой странице. Таймерных замеров нет —
 * только вывод, тексты ошибок, имена слотов и счёт объектов.
 *
 *   — тексты ошибок (`ERROR_ROWS`): Node — `vm.runInNewContext` со строкой `"use strict"`;
 *     три браузера — `new Function` той же строкой. Колонки Firefox и WebKit сняты только
 *     стендом, колонку V8 тест повторяет в Node и в Chromium;
 *   — глобальное окружение (`GLOBAL_*`): три `<script>`, вставленных по очереди, в трёх
 *     браузерах одинаково (`number/true/false`); повторное `let` — SyntaxError у всех, тексты
 *     разные: Chromium обернул его в `Failed to execute 'append' on 'Element': …`, потому что
 *     скрипт вставлялся из JS, Firefox — `redeclaration of let gl`, WebKit отдал в `onerror`
 *     только «Script error.». Тест повторяет это в `vm` (три `runInContext` в одном контексте);
 *   — состав Context (`CONTEXT_*`): `v8.getHeapSnapshot()` в отдельном процессе, у каждой
 *     функции — ребро `context` и рёбра типа `context` у найденного объекта: это имена слотов.
 *     Значения — объекты, а не числа: малое целое (Smi) V8 хранит прямо в слоте, и ребра
 *     в снимке у него нет. Те же случаи `%DebugPrint` (`--allow-natives-syntax`): `FunctionContext[3]`
 *     без захвата `big`, `[4]` с соседом, `[7]`/`[8]` с `eval`, `WithContext[3]` у `with`;
 *     у двух стрелок из двух итераций `for (let …)` — **разные** `BlockContext[3]`, у `for (var …)` —
 *     один и тот же `FunctionContext`;
 *   — удержание (`RETAIN_*`): `v8.queryObjects(Big, { format: 'count' })` — по документации
 *     Node считает объекты после полной сборки мусора. В 24.11 функция ещё печатает
 *     `ExperimentalWarning`; экспериментальной её перестали считать в 24.13.1 и 25.4.0.
 *     Три прогона подряд — `0 10 10 0`;
 *   — отладчик (`DEBUG_*`): `node:inspector`, `Debugger.evaluateOnCallFrame` в паузе на
 *     `debugger`. То же через CDP в Chromium 153 (`newCDPSession`): `x → 42`,
 *     `big → ReferenceError: big is not defined`. Тест повторяет Node-часть;
 *   — `(0, eval)` не видит локальных имён (`typeof x` → `undefined`) и своего Context
 *     функции не требует: её `context` в снимке — окружение модуля;
 *   — `with` в строгом режиме — `SyntaxError: Strict mode code may not include a with statement`.
 *
 * Учебный интерпретатор (`ENV_CODE` … `EVAL_CODE`) разбирает текст espree и исполняет
 * подмножество JS в строгом режиме. Тест прогоняет им все программы темы и ещё два десятка
 * своих и сверяет вывод и тексты ошибок с `vm` в Node и с Chromium. Расхождений нет.
 * Программы демо стенд прогнал и в Firefox 155 и WebKit 26.6 (`new Function`, как в демо):
 * вывод тот же, отличается только текст ошибки в «Мёртвой зоне» — это и сказано в подписи.
 *
 *   — `for (let …)` без замыкания в теле контекста не заводит: `node --print-bytecode
 *     --print-bytecode-filter=<имя>` — у функции без замыкания в цикле нет ни одной инструкции
 *     `CreateBlockContext`/`PushContext`, с замыканием — `CreateBlockContext` в теле цикла.
 *
 * Только по спецификации, без отдельного запуска: какие окружения создаются для модуля,
 * `catch` и `with` (таблица `ENV_KINDS`).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'окружение (Environment Record)',
    d: 'Таблица имён одного места кода: какие переменные, функции и параметры объявлены именно здесь и что в них сейчас лежит. Своё окружение получают программа, модуль, каждый вызов функции и каждый вход в блок.',
  },
  {
    k: '`outer`',
    d: 'Ссылка окружения на окружение снаружи. Если имени нет в своём окружении, его ищут по этой ссылке, потом дальше — до глобального. Цепочку таких ссылок и называют цепочкой областей видимости.',
  },
  {
    k: 'привязка (binding)',
    d: 'Запись «имя → значение» в окружении. У `let` и `const` привязка бывает в особом состоянии: имя уже есть, а значения ещё нет.',
  },
  {
    k: 'подъём (hoisting)',
    d: 'Движок заводит все объявленные имена при входе в функцию или блок — до первой строки. Код при этом никуда не переносится: меняется только момент, с которого имя известно.',
  },
  {
    k: 'TDZ, временная мёртвая зона',
    d: 'Время от входа в блок до строки с `let` или `const`. Имя уже заведено, но любое обращение к нему бросает `ReferenceError`.',
  },
  {
    k: 'замыкание',
    d: 'Функция вместе со ссылкой на окружение, где её создали. В спецификации эта ссылка — скрытое поле функции `[[Environment]]`.',
  },
  {
    k: 'Context (V8)',
    d: 'Объект в куче, в котором V8 хранит те переменные окружения, что нужны замыканиям. Остальные переменные живут на стеке и пропадают вместе с вызовом.',
  },
];

export const PLAIN_CLOSURE =
  'Функция — как письмо с обратным адресом. Где бы его ни прочли, ответ уйдёт туда, откуда письмо отправили, а не туда, где его читают. Обратный адрес функции — место, где её создали. По нему она находит свои переменные, даже когда функция, которая её создала, давно вернулась.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну договорённость о самих примерах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Функция — это значение',
    d: 'Функцию кладут в переменную, возвращают из другой функции, передают аргументом. Пока на объект функции есть ссылка, он живёт — и держит всё, что держит сам.',
    href: '/js/callbacks/#s2',
    hrefLabel: '«Колбэки», раздел «Функция как значение»',
    tone: 'info',
  },
  {
    t: 'Стек вызовов',
    d: 'Вызов функции кладёт кадр на стек, возврат снимает его. Локальные переменные обычно живут в кадре и исчезают с ним. Замыкание — способ это пережить.',
    href: '/js/callbacks/#s1',
    hrefLabel: '«Колбэки», раздел «Стек»',
    tone: 'info',
  },
  {
    t: 'Колбэк таймера — потом',
    d: '`setTimeout(fn, 0)` не вызывает `fn` сразу. Колбэк выполнится отдельной задачей, когда весь текущий синхронный код дойдёт до конца. Поэтому цикл успевает закончиться раньше первого колбэка.',
    href: '/js/event-loop/#s4',
    hrefLabel: '«Event Loop», раздел «Таймеры»',
    tone: 'info',
  },
  {
    t: 'Примеры — в строгом режиме',
    d: 'Все примеры темы исполняются в строгом режиме: в нём всегда работают модули и классы. Для темы важно одно отличие: присваивание необъявленному имени бросает `ReferenceError`, а не создаёт молча глобальную переменную.',
    tone: 'info',
  },
];

// ─── Раздел 1. Окружения ───────────────────────────────────────────────────────────────────

export const PLAIN_ENV =
  'Как поиск ключей дома. Сначала карман, потом прихожая, потом ящик у соседей — всегда в этом порядке, изнутри наружу. Обратно не работает: из прихожей не видно, что у вас в кармане. Окружение — это карман или прихожая, а `outer` — записка «не нашёл — смотри дальше вот там».';

export const ENV_KINDS = [
  {
    k: 'глобальное',
    when: 'один раз на страницу, iframe, воркер или контекст `vm`',
    what: '`var` и `function` верхнего уровня — свойствами `globalThis`; `let`, `const` и `class` — в отдельной части, общей для всех `<script>` страницы',
    outer: 'нет',
  },
  {
    k: 'модуля',
    when: 'при загрузке модуля, одно на модуль',
    what: 'всё, что объявлено в модуле; импорты — ссылками на переменные другого модуля',
    outer: 'глобальное',
  },
  {
    k: 'функции',
    when: 'при **каждом** вызове',
    what: 'параметры, `var`, `let` и `const` тела, `this` и `arguments`',
    outer: '`[[Environment]]` вызванной функции — окружение, где её создали',
  },
  {
    k: 'блока',
    when: 'при каждом входе в `{ … }`',
    what: '`let`, `const`, `class` и, в строгом режиме, `function` этого блока',
    outer: 'окружение вокруг блока',
  },
  {
    k: 'итерации `for`',
    when: 'на каждом шаге `for (let …)`',
    what: 'копии переменных цикла',
    outer: 'окружение вокруг цикла',
  },
  {
    k: '`catch`, `with`',
    when: 'при входе в `catch (e)` или `with (obj)`',
    what: '`e`; у `with` — сам объект: имена ищутся в его свойствах',
    outer: 'окружение вокруг',
  },
];

/** Глобальное окружение: два скрипта одной страницы. Тест исполняет их в одном контексте `vm`. */
export const GLOBAL_SCRIPT = `var gv = 1;
let gl = 2;`;

export const GLOBAL_REDECLARE = `let gl = 3;`;

export const GLOBAL_CODE = `<script>
  ${GLOBAL_SCRIPT.split('\n').join('\n  ')}
</script>

<script>
  ${GLOBAL_REDECLARE}   // SyntaxError: Identifier 'gl' has already been declared
</script>`;

/** Пробы из второго скрипта той же страницы. `out` сверяет тест. */
export const GLOBAL_PROBES = [
  { expr: "'gv' in globalThis", out: 'true', why: '`var` верхнего уровня скрипта стал свойством глобального объекта.' },
  { expr: "'gl' in globalThis", out: 'false', why: '`let` — нет: он лежит в другой, декларативной части глобального окружения.' },
  { expr: 'typeof gl', out: "'number'", why: 'Но эта часть общая для всех скриптов страницы: второй `<script>` видит `gl` первого.' },
];

export const GLOBAL_NOTE =
  'Из-за общей части повторное `let gl` в другом скрипте — не новая переменная, а `SyntaxError`, и весь этот скрипт не выполняется ни строкой. У модулей так не бывает: у каждого модуля своё окружение, и одинаковые имена в двух модулях друг другу не мешают.';

export const ENV_NOTE =
  'Это вся механика имён. Окружение — `Map` имён и ссылка `outer`. `lookup` идёт по цепочке наружу и останавливается на первом найденном имени: внутренний `x` закрывает внешний, это и есть затенение. Не нашлось нигде — `ReferenceError: x is not defined`. Нашлось, но `ready: false` — та же ошибка с другим текстом. Тексты ошибок — те же, что пишет V8.';

// ─── Учебный интерпретатор ─────────────────────────────────────────────────────────────────
// Пять строк ниже — один интерпретатор, разрезанный по разделам. Их печатает тема, собирает
// `widgets/scope-lab/model/run.ts` и сверяет с V8 `tests/unit/closures.test.ts`.

export const ENV_CODE = `// Окружение (Environment Record): имена одного места кода и ссылка outer
// на окружение снаружи. Привязка имени — { kind, value, ready }.
// ready: false — имя уже есть, а значения ещё нет: это временная мёртвая зона.
function newEnv(kind, outer, name = '') {
  return { id: ++envCount, kind, name, outer, vars: new Map() };
}

function declare(env, name, kind) {
  const early = kind === 'var' || kind === 'function' || kind === 'param' || kind === 'host';
  env.vars.set(name, { kind, value: undefined, ready: early });
}

function initialize(env, name, value) {
  const b = env.vars.get(name);
  b.value = value;
  b.ready = true;
}

// Поиск имени: своё окружение, потом outer, потом его outer — до глобального.
function lookup(env, name) {
  for (let e = env; e !== null; e = e.outer) {
    if (e.vars.has(name)) return e;
  }
  return null;
}

function fail(name, message) {
  throw { jsError: true, name, message };
}

function binding(env, name) {
  const found = lookup(env, name);
  if (!found) fail('ReferenceError', \`\${name} is not defined\`);
  const b = found.vars.get(name);
  if (!b.ready) fail('ReferenceError', \`Cannot access '\${name}' before initialization\`);
  return b;
}

function read(env, name) {
  return binding(env, name).value;
}

function write(env, name, value) {
  const b = binding(env, name);       // необъявленное имя — ошибка: строгий режим
  if (b.kind === 'const') fail('TypeError', 'Assignment to constant variable.');
  b.value = value;
}`;

export const HOIST_CODE = `// var виден во всей функции: имена собираются из блоков и циклов,
// но не из вложенных функций — у тех свой подъём.
function varNames(statements, out = []) {
  for (const s of statements) {
    if (!s) continue;
    if (s.type === 'VariableDeclaration' && s.kind === 'var') {
      for (const d of s.declarations) out.push(d.id.name);
    } else if (s.type === 'BlockStatement') varNames(s.body, out);
    else if (s.type === 'IfStatement') varNames([s.consequent, s.alternate], out);
    else if (s.type === 'ForStatement') varNames([s.init, s.body], out);
  }
  return out;
}

// Вход в блок: let и const — без значения (TDZ), function — сразу с замыканием.
function enterBlock(statements, env) {
  for (const s of statements) {
    if (s.type === 'VariableDeclaration' && s.kind !== 'var') {
      for (const d of s.declarations) declare(env, d.id.name, s.kind);
    }
  }
  for (const s of statements) {
    if (s.type === 'FunctionDeclaration') {
      declare(env, s.id.name, 'function');
      initialize(env, s.id.name, makeClosure(s, env));
    }
  }
}

// Вход в функцию или программу: var — сразу undefined, остальное — как у блока.
function hoist(statements, env) {
  for (const name of varNames(statements)) {
    if (!env.vars.has(name)) declare(env, name, 'var');
  }
  enterBlock(statements, env);
}`;

export const CALL_CODE = `// Замыкание — код функции плюс ссылка на окружение, где её СОЗДАЛИ.
// В спецификации это слот [[Environment]].
function makeClosure(node, env) {
  return { closure: true, node, name: node.id ? node.id.name : '', env };
}

function callFunction(fn, args, calleeText) {
  if (typeof fn === 'function') return fn(...args);      // console.log, setTimeout
  if (!fn || !fn.closure) fail('TypeError', \`\${calleeText} is not a function\`);
  // outer нового окружения — из [[Environment]], а не окружение того, кто вызвал.
  const env = newEnv('function', fn.env, fn.name);
  fn.node.params.forEach((p, i) => {
    declare(env, p.name, 'param');
    initialize(env, p.name, args[i]);
  });
  frames.push(env);
  try {
    if (fn.node.body.type !== 'BlockStatement') {        // стрелка-выражение
      step('call', fn.node.body, env);
      return evaluate(fn.node.body, env);
    }
    hoist(fn.node.body.body, env);
    step('call', fn.node, env);
    const result = execList(fn.node.body.body, env);
    return result ? result.value : undefined;
  } finally {
    frames.pop();
  }
}`;

export const LOOP_CODE = `// for (let …): окружение для init, а потом — новое на каждую итерацию.
function execFor(node, env) {
  const init = node.init;
  let loopEnv = env;
  let perIteration = [];                 // имена, которые копируются из итерации в итерацию
  if (init && init.type === 'VariableDeclaration' && init.kind !== 'var') {
    loopEnv = newEnv('for', env);
    enterBlock([init], loopEnv);
    step('for', init, loopEnv);
    exec(init, loopEnv);
    if (init.kind === 'let') perIteration = init.declarations.map((d) => d.id.name);
  } else if (init) {
    if (init.type === 'VariableDeclaration') exec(init, env);
    else evaluate(init, env);
  }
  let iterEnv = nextIteration(perIteration, loopEnv, env);
  while (!node.test || evaluate(node.test, iterEnv)) {
    const result = exec(node.body, iterEnv);
    if (result) return result;           // return из тела
    iterEnv = nextIteration(perIteration, iterEnv, env);
    if (node.update) evaluate(node.update, iterEnv);
  }
}

// CreatePerIterationEnvironment: свежее окружение, в которое КОПИРУЮТСЯ
// текущие значения. Замыкания прошлой итерации остаются со старым.
function nextIteration(names, last, outer) {
  if (names.length === 0) return last;   // var: одна переменная на весь цикл
  const fresh = newEnv('iteration', outer);
  for (const name of names) {
    declare(fresh, name, 'let');
    initialize(fresh, name, read(last, name));
  }
  step('copy', null, fresh);
  return fresh;
}`;

export const EVAL_CODE = `// Остальное: инструкции, выражения и запуск. Подмножество JS — то, что
// разобрано в switch ниже; на всём прочем интерпретатор честно сдаётся.
function execList(statements, env) {
  for (const s of statements) {
    const result = exec(s, env);
    if (result) return result;
  }
}

function exec(node, env) {
  switch (node.type) {
    case 'BlockStatement': {
      const inner = newEnv('block', env);
      enterBlock(node.body, inner);
      step('block', node, inner);
      return execList(node.body, inner);
    }
    case 'ForStatement':
      step('stmt', node, env);
      return execFor(node, env);
    case 'FunctionDeclaration':
      return;                            // уже создана при подъёме
    case 'EmptyStatement':
      return;
  }
  step('stmt', node, env);
  switch (node.type) {
    case 'VariableDeclaration':
      for (const d of node.declarations) {
        const value = d.init ? evaluate(d.init, env) : undefined;
        if (value && value.closure && !value.name) value.name = d.id.name;
        if (node.kind === 'var') {
          if (d.init) write(env, d.id.name, value);
        } else initialize(env, d.id.name, value);
      }
      return;
    case 'ExpressionStatement':
      evaluate(node.expression, env);
      return;
    case 'ReturnStatement':
      return { value: node.argument ? evaluate(node.argument, env) : undefined };
    case 'IfStatement':
      if (evaluate(node.test, env)) return exec(node.consequent, env);
      if (node.alternate) return exec(node.alternate, env);
      return;
  }
  unsupported(node);
}

const BINARY = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '%': (a, b) => a % b,
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b,
  '>=': (a, b) => a >= b, '===': (a, b) => a === b, '!==': (a, b) => a !== b,
};

function evaluate(node, env) {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'Identifier':
      return read(env, node.name);
    case 'TemplateLiteral':
      return node.quasis.map((q, i) =>
        q.value.cooked + (i < node.expressions.length ? show(evaluate(node.expressions[i], env)) : '')).join('');
    case 'ArrowFunctionExpression':
    case 'FunctionExpression':
      return makeClosure(node, env);
    case 'UnaryExpression':
      if (node.operator === 'typeof') {
        // Необъявленное имя — не ошибка: typeof отвечает 'undefined'.
        // Объявленное, но в TDZ — ошибка: read бросит ReferenceError.
        const a = node.argument;
        if (a.type === 'Identifier' && !lookup(env, a.name)) return 'undefined';
        const v = evaluate(a, env);
        return v && v.closure ? 'function' : typeof v;
      }
      if (node.operator === '!') return !evaluate(node.argument, env);
      if (node.operator === '-') return -evaluate(node.argument, env);
      break;
    case 'BinaryExpression':
      if (BINARY[node.operator]) return BINARY[node.operator](evaluate(node.left, env), evaluate(node.right, env));
      break;
    case 'LogicalExpression': {
      const left = evaluate(node.left, env);
      if (node.operator === '&&') return left && evaluate(node.right, env);
      if (node.operator === '||') return left || evaluate(node.right, env);
      break;
    }
    case 'ConditionalExpression':
      return evaluate(node.test, env) ? evaluate(node.consequent, env) : evaluate(node.alternate, env);
    case 'AssignmentExpression': {
      if (node.left.type !== 'Identifier') break;
      const name = node.left.name;
      let value;
      if (node.operator === '=') value = evaluate(node.right, env);
      else if (node.operator === '+=') value = read(env, name) + evaluate(node.right, env);
      else if (node.operator === '-=') value = read(env, name) - evaluate(node.right, env);
      else break;
      if (value && value.closure && !value.name) value.name = name;
      write(env, name, value);
      return value;
    }
    case 'UpdateExpression': {
      if (node.argument.type !== 'Identifier') break;
      const old = read(env, node.argument.name);
      const next = node.operator === '++' ? old + 1 : old - 1;
      write(env, node.argument.name, next);
      return node.prefix ? next : old;
    }
    case 'MemberExpression':                 // только console.log
      if (node.computed) break;
      return evaluate(node.object, env)[node.property.name];
    case 'CallExpression': {
      const fn = evaluate(node.callee, env);
      const args = node.arguments.map((a) => evaluate(a, env));
      const text = node.callee.type === 'Identifier' ? node.callee.name : 'callee';
      return callFunction(fn, args, text);
    }
  }
  unsupported(node);
}

function unsupported(node) {
  throw { unsupported: true, node };
}

function show(v) {
  if (v && v.closure) return \`[Function: \${v.name || '(anonymous)'}]\`;
  return String(v);
}

let envCount = 0;
const frames = [];
const timers = [];

// Программа целиком: подъём в глобальном окружении, тело, потом таймеры.
function run(program, print) {
  envCount = 0;
  frames.length = 0;
  timers.length = 0;
  const global = newEnv('global', null);
  declare(global, 'console', 'host');
  initialize(global, 'console', { log: (...args) => print(args.map(show).join(' ')) });
  declare(global, 'undefined', 'host');
  declare(global, 'setTimeout', 'host');
  let order = 0;
  initialize(global, 'setTimeout', (fn, ms = 0) => { timers.push({ fn, ms, order: order++ }); });
  const report = (e) => {
    if (!e || !e.jsError) throw e;
    step('error', null, null);
    print(\`\${e.name}: \${e.message}\`, true);
  };
  try {
    hoist(program.body, global);
    step('start', null, global);
    execList(program.body, global);
  } catch (e) { report(e); }
  // Таймеры — после всей программы, по возрастанию задержки.
  while (timers.length > 0) {
    timers.sort((a, b) => a.ms - b.ms || a.order - b.order);
    const { fn } = timers.shift();
    step('timer', fn.node, fn.env);
    try { callFunction(fn, [], 'callback'); } catch (e) { report(e); }
  }
  step('end', null, global);
}`;

export const INTERPRETER_CODES = [ENV_CODE, HOIST_CODE, CALL_CODE, LOOP_CODE, EVAL_CODE];

// ─── Раздел 2. Подъём и мёртвая зона ───────────────────────────────────────────────────────

export const HOIST_NOTE =
  '`var` заводится сразу со значением `undefined` и виден во всей функции, сквозь блоки и циклы. `function` заводится сразу с готовой функцией — её можно вызвать выше объявления. `let` и `const` тоже заводятся заранее, но с `ready: false`: имя занято, значения нет. Поднимаются все — разница только в том, с чем.';

export const DECL_ROWS = [
  { k: '`var`', scope: 'вся функция или скрипт, сквозь блоки', before: '`undefined`', again: 'можно, молча' },
  { k: '`function`', scope: 'вся функция; в блоке строгого кода — блок', before: 'сама функция: вызов выше объявления работает', again: 'можно' },
  { k: '`let`', scope: 'блок', before: 'мёртвая зона — `ReferenceError`', again: '`SyntaxError`' },
  { k: '`const`', scope: 'блок', before: 'мёртвая зона; запись потом — `TypeError`', again: '`SyntaxError`' },
  { k: '`class`', scope: 'блок', before: 'мёртвая зона', again: '`SyntaxError`' },
  { k: 'параметр', scope: 'функция', before: 'аргумент вызова', again: '—' },
];

export const PLAIN_TDZ =
  'Как место в зале, на котором уже лежит табличка с вашей фамилией, а вас ещё нет. Место занято — сесть на него никто другой не может. Но и спросить у этого места что-то нельзя: человек не пришёл. Табличка — объявление `let`, приход — строка, где переменная получает значение.';

/** Каждый случай исполняет тест в строгом режиме и сверяет `out`. */
export const TDZ_CASES = [
  {
    code: 'typeof nope;',
    out: "'undefined'",
    why: 'Имени нет нигде. `typeof` отвечает строкой и не бросает — так проверяют, существует ли глобальное имя.',
  },
  {
    code: 'typeof x;\nlet x = 1;',
    out: "ReferenceError: Cannot access 'x' before initialization",
    why: 'Имя есть, но в мёртвой зоне. `typeof` здесь уже не спасает.',
  },
  {
    code: 'let x = x;',
    out: "ReferenceError: Cannot access 'x' before initialization",
    why: 'Справа — уже новый `x`, ещё без значения, а не какой-то внешний.',
  },
  {
    code: 'let x = 1;\n{\n  x;\n  let x = 2;\n}',
    out: "ReferenceError: Cannot access 'x' before initialization",
    why: 'Внутренний `let x` действует с первой строки блока: он закрывает внешний `x` раньше, чем получает значение.',
  },
  {
    code: 'function f(a = b, b = 1) {\n  return a;\n}\nf();',
    out: "ReferenceError: Cannot access 'b' before initialization",
    why: 'Параметры заводятся слева направо, и у каждого своя мёртвая зона.',
  },
  {
    code: 'function f() {\n  return z;\n}\nlet z = 5;\nf();',
    out: '5',
    why: 'Мёртвая зона — время, а не место. Функция написана выше `let`, но вызвана после этой строки.',
  },
];

export const TYPEOF_NOTE =
  'Почему `typeof` ведёт себя по-разному. Спецификация говорит: если имя **не найдено** ни в одном окружении, `typeof` возвращает `"undefined"`. Имя в мёртвой зоне найдено — привязка есть, просто без значения. Значит, `typeof` пытается прочитать значение и получает ту же ошибку, что и обычное чтение. В интерпретаторе это две строки: `lookup` вернул `null` — ответ готов; не `null` — дальше обычный `read`.';

/** Тексты ошибок в трёх движках. Колонку V8 повторяет тест, остальные — снимок стенда. */
export const ERROR_ROWS = [
  {
    k: 'чтение в мёртвой зоне',
    v8: "ReferenceError: Cannot access 'x' before initialization",
    ff: "ReferenceError: can't access lexical declaration 'x' before initialization",
    wk: "ReferenceError: Cannot access 'x' before initialization.",
  },
  {
    k: 'необъявленное имя',
    v8: 'ReferenceError: nope is not defined',
    ff: 'ReferenceError: nope is not defined',
    wk: "ReferenceError: Can't find variable: nope",
  },
  {
    k: 'запись в `const`',
    v8: 'TypeError: Assignment to constant variable.',
    ff: "TypeError: invalid assignment to const 'c'",
    wk: 'TypeError: Attempted to assign to readonly property.',
  },
];

/** Код строк таблицы — то, что исполнялось. */
export const ERROR_SOURCES = ['x;\nlet x = 1;', 'nope;', 'const c = 1;\nc = 2;'];

export const ERROR_NOTE =
  'Тип ошибки задаёт спецификация, поэтому он везде один: `ReferenceError` и `TypeError`. Текст каждый движок пишет свой. Ловить ошибку по `message` поэтому нельзя — только по типу, да и тот здесь говорит об ошибке в коде, а не о ситуации, которую стоит обрабатывать.';

// ─── Демо: программы ───────────────────────────────────────────────────────────────────────

export const COUNTER_PROGRAM: ScopeProgram = {
  id: 'counter',
  label: 'Счётчик',
  code: `function makeCounter() {
  let count = 0;
  return () => {
    count++;
    return count;
  };
}
const a = makeCounter();
const b = makeCounter();
console.log(a(), a(), b());`,
  note: 'Два вызова `makeCounter` — два окружения, в каждом свой `count`. Вызов вернулся, а окружение осталось: на него ссылается стрелка из `a` или `b`. В демо такие окружения подписаны «держит замыкание».',
};

export const LEXICAL_PROGRAM: ScopeProgram = {
  id: 'lexical',
  label: 'Где ищут имя',
  code: `const who = 'глобальный';
function speak() {
  return who;
}
function caller() {
  const who = 'вызывающий';
  return speak();
}
console.log(caller());`,
  note: 'У `speak` внешнее окружение — глобальное, где её написали. Окружение `caller` в её цепочку не входит, хоть `caller` её и вызвал.',
};

export const HOIST_PROGRAM: ScopeProgram = {
  id: 'hoist',
  label: 'Подъём',
  code: `console.log(v, hoisted());
var v = 1;
function hoisted() {
  return 'объявлена заранее';
}
console.log(v);`,
  note: 'На первом шаге в глобальном окружении уже есть и `v`, и `hoisted`. Только у `v` пока `undefined`, а у `hoisted` — готовая функция.',
};

export const TDZ_PROGRAM: ScopeProgram = {
  id: 'tdz',
  label: 'Мёртвая зона',
  code: `function show() {
  return label;
}
console.log(typeof missing);
console.log(show());
let label = 'готово';`,
  note: '`label` заведён с самого начала, но без значения. `typeof missing` безопасен: такого имени нет вовсе. А `show()` читает `label` раньше строки с `let` — и падает.',
};

export const LOOP_VAR_PROGRAM: ScopeProgram = {
  id: 'loop-var',
  label: 'var в цикле',
  code: `for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}`,
  note: 'Окружение итерации не появляется: `i` одна, в глобальном окружении. Три стрелки создаются в трёх разных блоках, но все блоки смотрят наружу, на ту же `i`.',
};

export const LOOP_LET_PROGRAM: ScopeProgram = {
  id: 'loop-let',
  label: 'let в цикле',
  code: `for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}`,
  note: 'Каждый шаг заводит окружение итерации и копирует в него `i`. К моменту таймеров удержаны три окружения итераций со значениями 0, 1 и 2.',
};

export const PEEK_PROGRAM: ScopeProgram = {
  id: 'peek',
  label: 'Копия итерации',
  code: `for (let i = 0, peek = () => i; i < 3; i++) {
  console.log(i, peek());
}`,
  note: '`peek` создана в части до первой `;` и держит окружение `for: init`. Итерации работают с копиями, а исходная `i` так и остаётся нулём.',
};

export const PROGRAMS: ScopeProgram[] = [
  COUNTER_PROGRAM,
  LEXICAL_PROGRAM,
  HOIST_PROGRAM,
  TDZ_PROGRAM,
  LOOP_VAR_PROGRAM,
  LOOP_LET_PROGRAM,
  PEEK_PROGRAM,
];

/** Что печатает каждая программа. Тест сверяет с интерпретатором и с V8. */
export const PROGRAM_OUT: Record<string, string[]> = {
  counter: ['1 2 1'],
  lexical: ['глобальный'],
  hoist: ['undefined объявлена заранее', '1'],
  tdz: ['undefined', "ReferenceError: Cannot access 'label' before initialization"],
  'loop-var': ['3', '3', '3'],
  'loop-let': ['0', '1', '2'],
  peek: ['0 0', '1 0', '2 0'],
};

export const DEMO_CAPTION =
  'Окружения на каждом шаге считает интерпретатор темы — тот же код, что напечатан в разделах. «Держит замыкание» — окружение, до которого ещё можно дойти через функцию в переменной или в очереди таймеров; до остальных дойти нельзя, они уже мусор. Второй вывод — та же программа, исполненная движком вашего браузера. В Chromium он совпадает строка в строку, в Firefox и Safari различается только текст ошибки. Программу можно изменить: что понимает интерпретатор, видно по его коду.';

// ─── Раздел 3. Замыкание ───────────────────────────────────────────────────────────────────

export const CALL_NOTE =
  'Главная строка — `newEnv(\'function\', fn.env, fn.name)`. Внешнее окружение вызова берётся **у функции**, из окружения, где её создали, а не у того, кто её вызвал. Это и называют лексической областью видимости: имена ищут по тексту программы. Вызывающий может объявить у себя что угодно — функция этого не увидит.';

/** Соседи по окружению видят записи друг друга. */
export const WALLET_PROGRAM = `let add;
let show;
function makeWallet() {
  let money = 0;
  add = (sum) => { money += sum; };
  show = () => money;
}
makeWallet();
add(5);
add(10);
console.log(show());`;

export const WALLET_OUT = '15';

export const CLOSURE_FACTS = [
  {
    t: 'Каждый вызов — новое окружение',
    d: 'Два вызова `makeCounter` дают два независимых `count`: `a(), a(), b()` печатают `1 2 1`. Функция одна, окружений столько, сколько было вызовов.',
  },
  {
    t: 'Соседи делят одно окружение',
    d: '`add` и `show` созданы одним вызовом `makeWallet`, и у обеих в `[[Environment]]` одно и то же окружение. `add(5)` и `add(10)` пишут в тот же `money`, который читает `show`: она печатает `15`.',
  },
  {
    t: 'Окружение живёт, пока до него можно дойти',
    d: 'Вызов вернулся, кадр снят со стека, а окружение осталось: на него ссылается функция, которая лежит в переменной. Нет ни одной такой функции — окружение становится мусором, как любой объект.',
  },
];

// ─── Раздел 4. Цикл for ────────────────────────────────────────────────────────────────────

export const LOOP_VAR_NOTE =
  'С `var` переменная `i` одна на весь цикл: она живёт в окружении функции или скрипта. Три стрелки запоминают окружения своих блоков, но поиск `i` из любого блока уходит наружу, к той же самой `i`. Таймеры срабатывают после цикла, когда `i` уже `3`.';

export const LOOP_LET_NOTE =
  'С `let` окружений четыре: одно для части до первой `;` и по одному на каждую итерацию. Каждая стрелка запоминает окружение своей итерации, и в нём своя `i`.';

export const FOR_STEPS = [
  {
    k: '1. init',
    d: 'Новое окружение для `let i = 0`. Внешнее — то, где стоит цикл.',
  },
  {
    k: '2. Копия перед первой итерацией',
    d: 'Ещё до проверки условия создаётся окружение итерации, и в него **копируется** текущее значение `i`. Спецификация называет этот шаг `CreatePerIterationEnvironment`.',
  },
  {
    k: '3. Условие и тело',
    d: 'Выполняются в окружении итерации. Стрелка, созданная в теле, запоминает именно его.',
  },
  {
    k: '4. Копия, потом `i++`',
    d: 'Тело закончилось — снова новое окружение с копией. И только потом `i++`, уже **в новом** окружении. Старое остаётся с прежним значением — его и прочтёт стрелка прошлой итерации.',
  },
];

/** Изменение `i` в теле переходит в следующую итерацию: копируется значение на конец тела. */
export const BODY_INC_PROGRAM = `let first;
let second;
for (let i = 0; i < 5; i++) {
  if (i === 0) first = () => i;
  if (i === 2) second = () => i;
  i++;
}
console.log(first(), second());`;

export const BODY_INC_OUT = '1 3';

export const COPY_NOTE =
  'Два опыта доказывают, что это копия, а не «своя переменная с номером итерации». В программе «Копия итерации» стрелка `peek` создана в части до первой `;`: она держит окружение `init`, а все `i++` случаются в копиях. Поэтому `peek()` всегда `0`. А здесь тело само меняет `i`: в окружение следующей итерации уходит значение на конец тела, и стрелки видят `1` и `3`, а не `0` и `2`.';

/** Как обходили ловушку до `let`: вызов функции — новое окружение на каждый шаг. */
export const IIFE_PROGRAM = `for (var i = 0; i < 3; i++) {
  (function (j) {
    setTimeout(() => console.log(j), 0);
  })(i);
}`;

export const IIFE_OUT = ['0', '1', '2'];

export const IIFE_NOTE =
  'До `let` окружение на шаг делали вызовом функции: каждый вызов заводит окружение с параметром `j`, а в него попадает значение `i` на момент вызова. `let` в заголовке цикла делает то же самое без функции.';

export const LOOP_V8_NOTE =
  'В V8 окружение итерации — это `BlockContext` в куче. У двух стрелок из двух итераций `for (let …)` `%DebugPrint` показывает два разных контекста, у двух стрелок из `for (var …)` — один и тот же `FunctionContext`. Контекст заводится, только если в теле есть замыкание над переменной цикла: иначе `i` живёт в регистре, и копирование ничего не стоит.';

// ─── Раздел 5. Что держит V8 ───────────────────────────────────────────────────────────────

/** Состав Context по снимку кучи. Тест исполняет этот код в отдельном процессе и читает снимок. */
export const CONTEXT_CODE = `function plain() {
  const big = [{}], x = {}, unused = {};
  return function fromPlain() { return x; };
}
function sibling() {
  const big = [{}], x = {}, unused = {};
  const peek = () => big;
  return function fromSibling() { return x; };
}
function withEval() {
  const big = [{}], x = {}, unused = {};
  return function fromEval() { return eval('x'); };
}
function indirect() {
  const big = [{}], x = {}, unused = {};
  return function fromIndirect() { return (0, eval)('typeof x'); };
}
const kept = [plain(), sibling(), withEval(), indirect()];
// v8.getHeapSnapshot(): у каждой функции ребро context,
// у контекста — рёбра с именами переменных`;

export const CONTEXT_ROWS = [
  {
    fn: '`fromPlain`',
    slots: '`x`',
    why: 'Только то, что функция использует. `big` и `unused` не нужны ни одному замыканию — они жили на стеке и исчезли с вызовом.',
    tone: 'ok' as const,
  },
  {
    fn: '`fromSibling`',
    slots: '`big`, `x`',
    why: 'Соседняя стрелка `peek` читает `big`. Context один на вызов, поэтому `fromSibling` держит `big`, хотя сама его не трогает.',
    tone: 'warn' as const,
  },
  {
    fn: '`fromEval`',
    slots: '`this`, `.new.target`, `big`, `x`, `unused`, `arguments`',
    why: 'Строка в `eval` может назвать любое имя, и заранее V8 этого не знает. Поэтому в Context уезжает всё, что видно из этого места, вместе с `this` и `arguments`.',
    tone: 'err' as const,
  },
  {
    fn: '`fromIndirect`',
    slots: 'своего Context нет',
    why: '`(0, eval)` — непрямой вызов: строка исполняется в глобальном окружении и локальных имён не видит (`typeof x` — `undefined`). Функция ничего не захватила, её `context` — окружение модуля.',
    tone: 'ok' as const,
  },
];

export const CONTEXT_NOTE =
  'Значения — объекты, а не числа, и это не случайность: малое целое V8 хранит прямо в слоте, и в снимке у него нет ребра с именем. С объектами видно, какие имена в Context есть.';

/** Сколько объектов `Big` переживают сборку. Тест исполняет этот код в отдельном процессе. */
export const RETAIN_CODE = `const { queryObjects } = require('node:v8');
class Big { constructor() { this.data = new Array(1000).fill(0); } }

const variants = {
  alone:    () => { const big = new Big(); const n = 1; return () => n; },
  sibling:  () => { const big = new Big(); const n = 1; const peek = () => big; return () => n; },
  withEval: () => { const big = new Big(); const n = 1; return () => eval('n'); },
  nulled:   () => { let big = new Big(); const n = 1; const peek = () => big; big = null; return () => n; },
};

for (const [name, make] of Object.entries(variants)) {
  const held = [];
  for (let k = 0; k < 10; k++) held.push(make());
  console.log(name, queryObjects(Big, { format: 'count' }));
}`;

export const RETAIN_OUT = ['alone 0', 'sibling 10', 'withEval 10', 'nulled 0'];

export const RETAIN_NOTE =
  '`queryObjects` считает живые экземпляры класса после полной сборки мусора. Десять замыканий в каждом случае одинаковы: стрелка `() => n`. Держат они очень разное. Сосед `peek` уже собран — он нигде не лежит, — но его захват оставил `big` в общем Context. `eval` делает то же без всякого соседа. Помогает обнулить переменную до возврата: Context остаётся, а ссылки на объект в нём больше нет.';

/** Отладчик в паузе внутри замыкания. Тест исполняет код под `node:inspector`. */
export const DEBUG_CODE = `function make() {
  const big = { size: 1 };
  const x = 42;
  return () => {
    debugger;
    return x;
  };
}
make()();`;

export const DEBUG_ROWS = [
  { expr: 'x', out: '42' },
  { expr: 'big', out: 'ReferenceError: big is not defined' },
];

export const DEBUG_NOTE =
  'Пауза на `debugger`, и отладчик спрашивают о двух именах из одной и той же функции `make`. `x` на месте, `big` — «не определено», хотя в коде оно строкой выше. Это не баг отладчика: `big` никто не захватил, и к этому моменту переменной уже нет. Так ведут себя и Node, и DevTools в Chromium — у них один движок.';

export const EVAL_FACTS = [
  {
    t: 'Прямой `eval` — всё в Context',
    d: 'И в самой функции, и во вложенной: `eval` во внутренней стрелке заставил V8 положить в Context все переменные **внешней** функции. Они живут, пока жива стрелка.',
    tone: 'err' as const,
  },
  {
    t: '`with` — поиск при каждом чтении',
    d: '`with (obj)` создаёт окружение, которое ищет имена в свойствах объекта. В V8 это `WithContext` со слотом для самого объекта. Заранее не известно, чьё имя `a` — свойство или переменная, и ответ ищется заново при каждом чтении. В строгом режиме `with` запрещён: `SyntaxError`.',
    tone: 'warn' as const,
  },
  {
    t: '`(0, eval)` безопасен для окружений',
    d: 'Непрямой вызов исполняет строку в глобальном окружении. Локальных имён он не видит, поэтому и класть их в Context незачем.',
    tone: 'ok' as const,
  },
];

// ─── Раздел 6. Приватность ─────────────────────────────────────────────────────────────────

/** Модульный паттерн: состояние в окружении немедленно вызванной функции. Тест исполняет. */
export const MODULE_CODE = `const counter = (function () {
  let count = 0;                       // снаружи не достать ничем
  function change(by) {
    count += by;
  }
  return {
    inc() { change(1); return count; },
    get value() { return count; },
  };
})();

counter.inc();
counter.inc();
counter.value;                         // 2
counter.count;                         // undefined
Object.keys(counter);                  // ['inc', 'value']`;

export const MODULE_NOTE =
  'Функция вызвана сразу и больше не нужна, но её окружение живёт: на него ссылаются методы возвращённого объекта. `count` и `change` лежат в этом окружении, а не в объекте. Снаружи до них нет ни одного пути, кроме этих методов. До модулей так прятали код библиотек: файл целиком заворачивали в такую функцию.';

/** Фабрика на замыканиях против класса с `#`-полем. Тест исполняет. */
export const FACTORY_CODE = `function makeCounter() {
  let count = 0;
  return { inc: () => ++count };
}

class Counter {
  #count = 0;
  inc() { return ++this.#count; }
}

makeCounter().inc === makeCounter().inc;   // false
new Counter().inc === new Counter().inc;   // true`;

export const PRIVACY_ROWS = [
  {
    k: 'замыкание (фабрика)',
    where: 'в окружении вызова фабрики',
    cost: 'свои копии методов у каждого объекта: `inc` двух счётчиков — разные функции',
    check: 'нет: снаружи не отличить «свой» объект от похожего',
  },
  {
    k: 'окружение модуля',
    where: 'в модуле, одна копия на всё приложение',
    cost: 'ничего, но и состояние одно на всех',
    check: 'не нужна',
  },
  {
    k: '`#`-поле',
    where: 'в самом объекте, отдельно от свойств',
    cost: 'методы общие, в прототипе',
    check: '`#count in obj` — не подделать',
  },
];

export const PRIVACY_NOTE =
  'Замыкание и `#`-поле прячут одинаково надёжно: ни перебор ключей, ни `JSON.stringify` их не находят. Разница — в цене и в устройстве. Как `#`-поля хранятся в объекте и чем они лучше `WeakMap`, разобрано в [«Объектной модели», раздел «Классы»](/js/object-model/#s4).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`var` в цикле с асинхронным колбэком',
    d: 'Переменная одна на весь цикл, и колбэки читают её, когда цикл уже закончился: `3 3 3`. Лечится `let` в заголовке цикла — не `const` внутри тела и не переименованием.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`let` копирует значение, а не номер итерации',
    d: 'Если тело меняет `i`, в следующую итерацию уходит значение на конец тела. Стрелки из такого цикла видят `1` и `3`, а не `0` и `2`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Замыкание в части `init` видит только первую копию',
    d: '`for (let i = 0, peek = () => i; …)` — `peek()` всегда `0`. Итерации работают с копиями, а `peek` держит окружение, которое создано до них.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`typeof` не защищает от мёртвой зоны',
    d: 'Проверка `typeof x === "undefined"` для имени, объявленного ниже через `let` или `class`, бросает `ReferenceError`. Безопасна она только для имени, которого нет вовсе.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Мёртвая зона — время, а не место',
    d: 'Функция, написанная выше `let`, работает, если её вызвали после строки объявления, и падает, если раньше — например, из обработчика, который сработал во время загрузки.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Безобидное замыкание держит чужие данные',
    d: 'Context один на вызов. Если хоть одна функция из этого вызова захватила тяжёлый объект, его держит любая соседняя функция, пока жива. Разбор с замером — в «Памяти и GC».',
    tone: 'err',
  },
  {
    n: '07',
    t: '`eval` захватывает всё',
    d: 'Прямой `eval` в функции или в любой вложенной в неё кладёт в Context все переменные, вместе с `this` и `arguments`. Десять стрелок `() => eval("n")` держат десять больших объектов, которых в их коде нет.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Отладчик не видит незахваченное',
    d: 'В паузе внутри замыкания внешняя переменная, которую замыкание не использует, — `ReferenceError: … is not defined`. Переменная не спрятана — её уже нет.',
  },
  {
    n: '09',
    t: 'Глобальный `let` общий для всех скриптов',
    d: 'Это не свойство `window`, но второй `<script>` его видит. Повторное `let` с тем же именем в другом скрипте — `SyntaxError`, и тот скрипт не выполняется целиком.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Текст ошибки — не контракт',
    d: 'Мёртвую зону V8 описывает как `Cannot access … before initialization`, Firefox — как `can\'t access lexical declaration …`. Общий у движков только тип ошибки.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-262 — Environment Records',
    href: 'https://tc39.es/ecma262/#sec-environment-records',
    what: 'виды окружений, `[[OuterEnv]]`, состояние «не инициализировано» у привязок',
  },
  {
    title: 'ECMA-262 — CreatePerIterationEnvironment',
    href: 'https://tc39.es/ecma262/#sec-createperiterationenvironment',
    what: 'копирование переменных `for (let …)` в окружение каждой итерации',
  },
  {
    title: 'ECMA-262 — FunctionDeclarationInstantiation',
    href: 'https://tc39.es/ecma262/#sec-functiondeclarationinstantiation',
    what: 'подъём при входе в функцию: параметры, `var`, `function`, лексические имена',
  },
  {
    title: 'ECMA-262 — The typeof Operator',
    href: 'https://tc39.es/ecma262/#sec-typeof-operator',
    what: 'почему `typeof` необъявленного имени не бросает',
  },
  {
    title: 'MDN — Closures',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures',
    what: 'лексическая область видимости, фабрики, модульный паттерн',
  },
  {
    title: 'MDN — let, Temporal dead zone',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let',
    what: 'мёртвая зона, `typeof`, повторное объявление',
  },
  {
    title: 'V8 — Blazingly fast parsing, part 2: lazy parsing',
    href: 'https://v8.dev/blog/preparser',
    what: 'как V8 ещё при разборе решает, какие переменные класть в Context',
  },
  {
    title: 'Node.js — `v8.queryObjects`',
    href: 'https://nodejs.org/api/v8.html#v8queryobjectsctor-options',
    what: 'счёт живых объектов после полной сборки; на 24.11 ещё экспериментальная',
  },
];

export const RELATED =
  'Смежное на сайте: [Память и GC, раздел «Замыкания»](/js/memory-gc/#s3) — слоты Context и его вид в снимке кучи. [Колбэки, раздел «Отмена»](/js/callbacks/#s8) — утечка через колбэк, который держит чужой Context, с замером. [Профилирование памяти, раздел «Retainers»](/js/memory-profiling/#s5) — как найти такую утечку в DevTools. [AST и линтеры, раздел «Области видимости»](/tooling/ast-linters/#s3) — те же области глазами ESLint. [Модули и сборка, раздел «Привязки и циклы»](/tooling/modules/#s2) — мёртвая зона в циклических импортах. [Объектная модель, раздел «Классы»](/js/object-model/#s4) — `#`-поля.';
