import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
import type { GuaranteeRow, CompareRow } from '@/widgets/callback-guarantees/model/types';
import type { StackMode } from '@/widgets/callback-stack/model/types';
import type { IocRow } from '@/widgets/ioc-boundary/model/types';
import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { ThisOption } from '@/widgets/this-in-callback/model/types';
import type { ZalgoMode } from '@/widgets/zalgo-demo/model/types';

/**
 * Данные урока «Колбэки».
 *
 * Перенесены из `legacy/extracted/callbacks/logic.js`. Здесь лежат данные демо, таблицы
 * и примеры кода; связный текст живёт в `index.mdx`. Прозу печатают через Md или текстовые
 * пропы компонентов со строчной разметкой. Исходники примеров используют и страница,
 * и модели/проверки поведения.
 *
 * Что изменилось против оригинала:
 *   редактура 2026-11  простой колбэк не гарантирует асинхронность; новый вводный исходник,
 *                        bind/отписка, адаптер в Promise и граница добавления DOM-слушателя
 *                        исполняются теми же строками в callbacks.test.ts / callbacks-settimeout.spec.ts.
 *                        Замыкание отделено от активного кадра; подробности ALS — в async-context.
 *
 *   AbortController      в примере стояло `emitter.on('tick', onTick, { signal })` — у
 *                        EventEmitter третьего аргумента нет, слушатель НЕ отписывался.
 *                        Проверено на Node 24.11: после `ac.abort()` счётчик слушателей
 *                        остаётся 1 и `emit` его зовёт. Заменено на `events.addAbortListener`
 *                        (проверено там же: 1 → 0);
 *   утечка замыканием    пример «колбэк не трогает huge, но huge жив» утечкой не был.
 *                        Проверено на Node 24.11 с `--expose-gc`, 20 вызовов: если `huge`
 *                        не захвачен НИ ОДНИМ замыканием скоупа, куча остаётся 3 МБ —
 *                        V8 не кладёт такой слот в Context. Стоит появиться соседнему
 *                        замыканию, которое `huge` использует, — 156 МБ. Пример переписан
 *                        так, чтобы утечка действительно была;
 *   setTimeout(fn())     «молча ничего не делает» — это про браузер. В Node 24.11 бросается
 *                        ERR_INVALID_ARG_TYPE (проверено). Среда названа явно;
 *   lastThis             в бандле идентификатор был испорчен экспортом до
 *                        `sc-camel-last-this`; восстановлено как `lastThis`;
 *   консоль Zalgo        в холодной ветке демо не показывало `spinner shown`, хотя в горячей
 *                        показывало. Добавлено: порядок сверен запуском (Node 24.11);
 *   «Проверь себя»       и «Всё сводится к четырём фразам» не переносятся.
 */

// ---- Вводный блок: что переходит на чужую сторону ----

/** Вводный вызов: передача функции не делает исполнение асинхронным. */
export const CALLBACK_START_CODE = `function useValue(value, callback) {
  return callback(value);
}

const out = ['до'];
useValue(7, value => out.push('получили ' + value));
out.push('после');
console.log(out.join(' → ')); // до → получили 7 → после`;

export const MAP_PARSE_CODE = `const values = ['1', '2', '3'];
console.log(values.map(parseInt));                // [1, NaN, NaN]
console.log(values.map(s => parseInt(s, 10)));    // [1, 2, 3]`;

export const IOC_ROWS: IocRow[] = [
  { k: 'КОГДА', v: 'вызвать — сейчас или в другом обороте цикла' },
  { k: 'СКОЛЬКО', v: 'раз — ноль, один, сорок тысяч' },
  { k: 'С ЧЕМ', v: 'вызвать — сколько аргументов и каких' },
  { k: 'С КАКИМ', v: 'this — его определит то, как функцию вызовет чужой код' },
  { k: 'КУДА', v: 'уйдёт ваш throw — в ваш catch, в глобальный обработчик, в отказ промиса' },
  { k: 'ОТПУСТИТ', v: 'ли ссылку потом — или будет держать навсегда' },
];

// ---- Раздел 1: граница синхронного и асинхронного ----

export const STACK_MODES: StackMode[] = [
  {
    key: 'sync',
    /* ⚠️ Ярлык обещал `arr.map(fn)`, а в листинге под ним стоит `each` — кнопка и код
       говорили о разном. Имя приведено к тому, что читатель видит. */
    label: 'each(arr, fn) — синхронный',
    code: [
      '// своя функция обхода: важно, что она зовёт колбэк',
      '// прямо сейчас, не откладывая',
      'function each(arr, cb) {',
      '  for (const x of arr) cb(x);',
      '}',
      '',
      'try {',
      '  each([1, 2, 3], (x) => {',
      "    if (x === 2) throw new Error('стоп');",
      '    console.log(x);',
      '  });',
      '} catch (e) {',
      "  console.log('поймали:', e.message);",
      '}',
    ],
    /*
     * ⚠️ `line` — индекс в массиве `code`, счёт **с нуля**: так подсвечивает `CodeListing`
     * (`i === active`). Первый пересчёт после того, как в листинг добавилось тело `each`,
     * велся с единицы, и подсветка съехала на строку: бросок показывался на `console.log(x)`,
     * который при x = 2 как раз не выполняется. `anchor` — фрагмент кода, который обязан
     * стоять в подсвеченной строке; сверяет их `tests/unit/demo-steps.test.ts`.
     */
    steps: [
      {
        message: 'try начинает выполняться, вызывается each.',
        line: 7,
        anchor: 'each([1, 2, 3]',
        frames: ['ваш код', 'each'],
        out: [],
        guard: 'try активен — его фрейм на стеке',
      },
      {
        message: 'each вызывает cb(1). Печатается 1, фрейм cb снимается.',
        line: 3,
        anchor: 'cb(x)',
        frames: ['ваш код', 'each', 'cb'],
        out: ['1'],
        guard: 'try активен — его фрейм на стеке',
      },
      {
        message: 'cb(2) — бросается ошибка. Она разматывает стек вверх.',
        tone: 'err',
        line: 8,
        anchor: 'throw',
        frames: ['ваш код', 'each', 'cb'],
        out: ['1'],
        guard: 'try активен — его фрейм на стеке',
      },
      {
        message:
          'Со стека снимается cb, затем each — в нём нет try. Цикл в each НЕ досчитал: исключение из колбэка прервало чужой цикл.',
        tone: 'warn',
        line: 10,
        anchor: '});',
        frames: ['ваш код'],
        out: ['1'],
        guard: 'try активен — ошибка дошла до него',
      },
      {
        message: 'catch поймал. 3 не печатается.',
        tone: 'ok',
        line: 12,
        anchor: "console.log('поймали:'",
        frames: ['ваш код'],
        out: ['1', 'поймали: стоп'],
        guard: '✓ ваш try/catch отработал',
      },
    ],
  },
  {
    key: 'async',
    label: 'setTimeout(fn, 0) — асинхронный',
    code: [
      'try {',
      "  console.log('A');",
      '  setTimeout(() => {',
      "    console.log('C');",
      '  }, 0);',
      "  console.log('B');",
      '} catch (e) {',
      "  console.log('сюда ничего не придёт');",
      '}',
    ],
    steps: [
      {
        message: 'Печатается A.',
        line: 1,
        anchor: "console.log('A')",
        frames: ['ваш код'],
        out: ['A'],
        guard: 'try активен — его фрейм на стеке',
      },
      {
        message:
          'setTimeout вызывается СИНХРОННО: заводит таймер и сразу возвращает его номер (id). Ваша функция не вызвана — ссылку на неё положили в таблицу таймеров.',
        line: 2,
        anchor: 'setTimeout(',
        frames: ['ваш код', 'setTimeout'],
        out: ['A'],
        guard: 'try активен — но колбэк ещё не вызван',
      },
      {
        message: 'Печатается B. Синхронный скрипт кончился.',
        line: 5,
        anchor: "console.log('B')",
        frames: ['ваш код'],
        out: ['A', 'B'],
        guard: 'try активен последний раз',
      },
      {
        message: 'Стек пуст: ваш код закончился, и вместе с ним исчез try. Начался следующий оборот цикла.',
        tone: 'warn',
        line: -1,
        frames: [],
        out: ['A', 'B'],
        guard: '✗ try/catch больше не существует',
      },
      {
        message: 'Время таймера вышло, задача взята из очереди. Ваша функция вызывается, и под ней ПУСТОЙ стек.',
        tone: 'err',
        line: 3,
        anchor: "console.log('C')",
        frames: ['cb'],
        out: ['A', 'B', 'C'],
        guard: '✗ брось здесь — улетит в window.onerror',
      },
    ],
  },
];

export const CALLER_ROWS = [
  ['Обычный вызов JS', 'map, sort, forEach, executor в new Promise', 'сразу, до возврата из API'],
  ['Микрозадача', '.then, queueMicrotask', 'после текущего синхронного кода'],
  ['Таймер или ввод-вывод', 'setTimeout, fs.readFile', 'позже'],
  ['Явная рассылка события', 'dispatchEvent, EventEmitter.emit', 'слушатели внутри этого вызова'],
  ['Кадр или простой', '[requestAnimationFrame, requestIdleCallback](/js/task-scheduling/)', 'позже'],
  ['Библиотека или ваш код', 'next, middleware, свои helper-функции', 'по контракту API'],
];

// ---- Раздел 3: Zalgo ----

/*
 * ⚠️ Тело `getUser` добавлено в листинг. Весь тезис демо держится на том, что при попадании
 * в кеш колбэк зовётся синхронно, — а этой строки читатель не видел: `getUser`, `showSpinner`
 * и `render` приходили ниоткуда, и поверить в две разные ветки приходилось на слово.
 */
export const ZALGO_CODE = [
  '// развилка: при попадании в кеш колбэк',
  '// зовётся СРАЗУ, при промахе — из таймера',
  'function getUser(id, cb) {',
  '  if (cache.has(id)) return cb(null, cache.get(id));',
  '  fetchUser(id, (err, user) => {',
  '    cache.set(id, user);',
  '    cb(err, user);',
  '  });',
  '}',
  '',
  'function load(id) {',
  '  let spinner = null;',
  '',
  '  getUser(id, (err, user) => {',
  '    if (spinner) spinner.hide();',
  '    render(user);',
  '  });',
  '',
  '  spinner = showSpinner();',
  '}',
];

export const ZALGO_MODES: ZalgoMode[] = [
  {
    key: 'hot',
    label: 'горячий (попадание)',
    tone: 'err',
    verdict:
      '✗ Спиннер висит поверх готовой страницы, и скрыть его теперь некому. Баг проявляется только при повторном открытии, а в тестах с пустым кешем не ловится.',
    steps: [
      /*
       * ⚠️ `line` — индекс с нуля, как в демо стека. После того как в листинг добавилось
       * тело `getUser`, номера пересчитали с единицы, и все шаги съехали на строку вниз:
       * на пустые строки, на `fetchUser` вместо попадания в кеш, на `}` вместо `showSpinner`.
       * `anchor` называет код, который обязан стоять в подсвеченной строке.
       */
      { message: 'load(1). spinner = null.', line: 11, anchor: 'let spinner = null', spinner: 'null', stack: 'load', out: [] },
      {
        message: 'getUser находит id в кеше и вызывает cb ПРЯМО СЕЙЧАС, не возвращаясь.',
        tone: 'warn',
        line: 3,
        anchor: 'return cb(',
        spinner: 'null',
        stack: 'load → getUser → cb',
        out: [],
      },
      {
        message:
          'Внутри cb переменная spinner ещё null — присваивание стоит ниже в load, до него не дошли.',
        tone: 'err',
        line: 14,
        anchor: 'if (spinner)',
        spinner: 'null',
        stack: 'load → getUser → cb',
        out: [],
      },
      {
        message: 'Условие if (spinner) ложно → hide() НЕ вызывается. Печатается render.',
        tone: 'err',
        line: 15,
        anchor: 'render(user)',
        spinner: 'null',
        stack: 'load → getUser → cb',
        out: [{ text: 'render Ann', tone: 'warn' }],
      },
      {
        message: 'cb возвращается, getUser возвращается.',
        line: 16,
        anchor: '});',
        spinner: 'null',
        stack: 'load',
        out: [{ text: 'render Ann', tone: 'warn' }],
      },
      {
        message:
          'Только теперь spinner = showSpinner() — спиннер показывается ПОСЛЕ того, как контент уже отрисован.',
        tone: 'err',
        line: 18,
        anchor: 'spinner = showSpinner()',
        spinner: '{ hide: ƒ }',
        stack: 'load',
        out: [
          { text: 'render Ann', tone: 'warn' },
          { text: 'spinner shown', tone: 'warn' },
        ],
      },
    ],
  },
  {
    key: 'cold',
    label: 'холодный (промах)',
    tone: 'ok',
    verdict: '✓ Порядок такой, как предполагал автор кода.',
    steps: [
      { message: 'load(2). spinner = null.', line: 11, anchor: 'let spinner = null', spinner: 'null', stack: 'load', out: [] },
      {
        message: 'getUser не находит id в кеше, вызывает fetchUser и ВОЗВРАЩАЕТСЯ. Колбэк только зарегистрирован.',
        line: 4,
        anchor: 'fetchUser(',
        spinner: 'null',
        stack: 'load',
        out: [],
      },
      {
        message: 'Выполняется spinner = showSpinner(). Спиннер показан, переменная заполнена.',
        line: 18,
        anchor: 'spinner = showSpinner()',
        spinner: '{ hide: ƒ }',
        stack: 'load',
        out: [{ text: 'spinner shown' }],
      },
      {
        message: 'load вернулась. Стек пуст. Проходит время.',
        line: -1,
        spinner: '{ hide: ƒ }',
        stack: 'пусто',
        out: [{ text: 'spinner shown' }],
      },
      {
        /* Под колбэком из `load` на стеке стоит колбэк `fetchUser`: это он зовёт `cb`. Пусто
           под ними обоими — кадра `load` уже нет. */
        message: 'Приходит ответ базы данных. Колбэк вызывается в другом обороте цикла.',
        line: 13,
        anchor: 'getUser(id, (err, user)',
        spinner: '{ hide: ƒ }',
        stack: 'колбэк fetchUser → cb',
        out: [{ text: 'spinner shown' }],
      },
      {
        message: 'spinner уже не null → hide() → спиннер скрыт. Всё корректно.',
        tone: 'ok',
        line: 14,
        anchor: 'if (spinner)',
        spinner: '{ hide: ƒ }',
        stack: 'колбэк fetchUser → cb',
        out: [{ text: 'spinner shown' }, { text: 'hide' }, { text: 'render from db' }],
      },
    ],
  },
];

export const ZALGO_FIX = `if (cache.has(id)) {
  const user = cache.get(id);
  queueMicrotask(() => cb(null, user));
  return;
}`;

export const ZALGO_PROMISE = `const p = Promise.resolve(42);  // УЖЕ выполнен
console.log('до');
p.then(v => console.log('then', v));
console.log('после');
// до, после, then 42`;

// ---- Раздел 4: this ----

export const THIS_OPTIONS: ThisOption[] = [
  {
    label: 'arr.map(api.get)',
    code: "class Api {\n  constructor(b) { this.base = b }\n  get(path) { return fetch(this.base + path) }\n}\n\n['/a'].map(api.get);",
    site: 'cb(element, index, array)',
    value: 'undefined → TypeError',
    tone: 'err',
    note: 'api.get — это чтение свойства. Оно возвращает саму функцию и не запоминает, что её достали из api. Тела методов класса всегда в строгом режиме (strict), поэтому при вызове без точки this === undefined.',
    cost: 'В обычной не-class функции без strict было бы хуже: this === globalThis, конкатенация даст "undefined/a" — вместо ошибки вы получите 404.',
  },
  {
    label: 'const { get } = api',
    code: 'const { get } = api;\nget("/a");',
    site: 'get("/a")',
    value: 'undefined → TypeError',
    tone: 'err',
    note: 'Деструктуризация — то же чтение свойства. Функция уезжает без объекта.',
    cost: 'Метод теряет объект при любом «отрыве»: присваивании в переменную, деструктуризации, передаче в setTimeout, map, then.',
  },
  {
    label: 'el.addEventListener(t, api.get)',
    code: "el.addEventListener('click', api.get);",
    site: 'listener.call(currentTarget, event)',
    value: 'el — элемент, не api',
    tone: 'warn',
    note: 'DOM вызывает слушатель с this === currentTarget, то есть с элементом. Это не undefined, но и не ваш объект. Часто так даже хуже: код не падает сразу, а тихо читает свойства не того объекта.',
    cost: 'Со стрелочным слушателем этого не происходит — у стрелки нет своего this, DOM нечего ей подставить.',
  },
  {
    label: 'api.get.bind(api)',
    code: 'const bound = api.get.bind(api);\n["/a"].map(bound);',
    site: 'bound(element, index, array)',
    value: 'api ✓',
    tone: 'ok',
    note: 'bind возвращает особую привязанную функцию (bound function): в её скрытом поле [[BoundThis]] записан объект. Привязку не отменить: повторный bind может добавить аргументы, но this уже не поменяет.',
    cost: 'Каждый bind создаёт новую функцию. Для removeEventListener нужна сохранённая ссылка: ещё один bind не найдёт прежний слушатель.',
  },
  {
    label: 'get = (p) => … (поле класса)',
    code: 'class Api2 {\n  base = "/v1";\n  get = (path) => fetch(this.base + path);\n}',
    site: 'cb(element, index, array)',
    value: 'api ✓',
    tone: 'ok',
    note: 'У стрелки нет своего this: его ищут во внешних областях видимости, как любую переменную, объявленную снаружи. Здесь снаружи — конструктор, а там this — новый объект.',
    cost: 'Цена: это поле экземпляра, а не метод прототипа. Своя копия на каждый объект, метода не видно в `Класс.prototype`, замокать через прототип нельзя.',
  },
  {
    label: '(p) => api.get(p)',
    code: '["/a"].map((p) => api.get(p));',
    site: 'api.get(p) — вызов с точкой',
    value: 'api ✓',
    tone: 'ok',
    note: 'Здесь this === api, потому что метод вызван через точку. Ничего не создаётся навсегда, метод остаётся на прототипе.',
    cost: 'Цена: новая стрелка на каждый вызов map. В React это ломает мемоизацию, если стрелка попадает в props.',
  },
  {
    label: 'map(api.get, api) — thisArg',
    code: '["/a"].map(api.get, api);',
    site: 'Call(fn, thisArg, ...)',
    value: 'api ✓',
    tone: 'ok',
    note: 'thisArg принимают map, forEach, filter, some, every, find, findIndex, findLast, findLastIndex, flatMap, Array.from. У reduce, reduceRight и sort его НЕТ.',
    cost: 'Бесполезен со стрелочной функцией: привязывать нечего. Имеет смысл только с обычной функцией или оторванным методом.',
  },
  {
    label: 'addEventListener(t, this)',
    code: 'class Widget {\n  constructor(el) { el.addEventListener("click", this) }\n  handleEvent(e) { this.count++ }\n}',
    site: 'obj.handleEvent(event)',
    value: 'сам Widget ✓',
    tone: 'ok',
    note: 'addEventListener принимает не только функцию, но и объект с методом handleEvent. Вызов идёт как метод — this сохраняется сам собой.',
    cost: 'Единственный способ подписаться без новой функции и без bind. Отписаться тоже просто: removeEventListener("click", this) получает ту же ссылку.',
  },
];

export const BIND_TRAP = `const el = new EventTarget();
const view = { calls: 0, onClick() { this.calls++; } };
const listener = view.onClick.bind(view); // сохранить именно эту функцию
el.addEventListener('click', listener);

el.removeEventListener('click', view.onClick.bind(view)); // НЕ СНИМЕТ
el.dispatchEvent(new Event('click'));
console.log(view.calls); // 1: listener остался

el.removeEventListener('click', listener); // та же ссылка — снят
el.dispatchEvent(new Event('click'));
console.log(view.calls); // 1: новых вызовов нет`;

/** Сравниваются ссылки на функции, не их код и не значение this. */
export const LISTENER_DIAGRAM: ConceptDiagramData = {
  id: 'callback-listener-identity',
  title: 'Для отписки нужна та же функция',
  description: 'На el подписана функция listener, полученная одним вызовом bind(view). При удалении EventTarget ищет эту ссылку. Повторный bind того же метода с тем же view создаёт другую функцию.',
  width: 920,
  height: 580,
  nodes: [
    { id: 'fresh', x: 24, y: 64, width: 220, height: 190, label: 'Снова bind(view)', detail: 'Создана новая функция.', tone: 'warn' },
    { id: 'mismatch', x: 350, y: 64, width: 220, height: 190, label: 'Ссылки разные', detail: 'Новая функция не равна listener.', tone: 'warn' },
    { id: 'stays', x: 676, y: 64, width: 220, height: 190, label: 'Слушатель остался', detail: 'Следующий click вызовет listener.', tone: 'err' },
    { id: 'saved', x: 24, y: 364, width: 220, height: 190, label: 'Передать listener', detail: 'Используется сохранённая ссылка.', tone: 'info' },
    { id: 'match', x: 350, y: 364, width: 220, height: 190, label: 'Ссылка совпала', detail: 'Найден подписанный listener.', tone: 'info' },
    { id: 'removed', x: 676, y: 364, width: 220, height: 190, label: 'Слушатель снят', detail: 'Следующий click его не вызовет.', tone: 'ok' },
  ],
  edges: [
    { from: 'fresh', to: 'mismatch', label: 'removeEventListener с новым bind', labelX: 460, labelY: 30 },
    { from: 'mismatch', to: 'stays' },
    { from: 'saved', to: 'match', label: 'removeEventListener с listener', labelX: 460, labelY: 330 },
    { from: 'match', to: 'removed' },
  ],
  note: 'Статическая схема двух попыток удаления из исходника. В примере имя события и capture одинаковы; различается ссылка на функцию. Для addEventListener удаление также должно совпасть по типу события и capture.',
};

// ---- Раздел 5: ошибки ----

export const NODE_ERROR_FIRST = `fs.readFile(path, (err, data) => {
  if (err) return handle(err);   // всегда первой строкой
  use(data);
});`;

export const LOST_ROWS = [
  {
    n: '01',
    t: 'Забыли проверить err',
    code: 'fs.readFile(p, (err, data) => {\n  const cfg = JSON.parse(data);\n});',
    q: 'Файл не прочитался. Где окажется ошибка?',
    why: 'При ошибке `data === undefined`, и `JSON.parse` бросает исключение — в колбэке, под которым пустой стек. В Node это `uncaughtException` и падение процесса. В браузере такое исключение уходит в `window.onerror`, а страница живёт дальше. Это хуже: приложение остаётся наполовину сломанным, и без системы сбора ошибок об этом никто не узнает.',
    fix: '→ if (err) return handle(err); первой строкой.',
  },
  {
    n: '02',
    t: 'Бросили внутри колбэка',
    code: 'fs.readFile(p, (err, data) => {\n  if (err) throw err;   // никто не поймает\n});',
    q: 'Файл не прочитался, и колбэк бросил err. Кто его поймает?',
    why: 'Под колбэком пусто. Ошибку, брошенную из асинхронного колбэка, некому поймать.',
    fix: '→ единственный корректный способ — передать неудачу дальше по своему каналу: следующий колбэк, отказ промиса, событие. Что именно даёт отказ промиса взамен броска — в теме про [устройство промиса](/js/promise-internals/).',
  },
  {
    n: '03',
    t: 'Синхронный бросок из асинхронной функции',
    code: "function read(p, cb) {\n  if (typeof p !== 'string')\n    throw new TypeError('...');   // Zalgo\n  fs.readFile(p, cb);\n}",
    q: 'Вызвали `read(42, cb)`. Куда придёт ошибка — в `cb` или куда-то ещё?',
    why: 'Код, который проверяет только `if (err)` в колбэке, эту ошибку не увидит: она вылетит синхронным исключением прямо из строки вызова. Сам Node здесь непоследователен: ошибки в типах аргументов он бросает синхронно, и это задокументированное исключение из его же соглашения.',
    fix: '→ тоже через колбэк: return queueMicrotask(() => cb(new TypeError(...))). Чем микрозадача отличается от таймера и почему здесь берут именно её — в теме про [цикл событий](/js/event-loop/).',
  },
];

// ---- Раздел 6: гарантии ----

/** Колбэк может ответить дважды, но промис сохраняет только первый исход. */
export const CALLBACK_PROMISE_CODE = `function readTwice(callback) {
  callback(null, 'первый ответ');
  callback(null, 'повторный ответ');
}

function readValue() {
  return new Promise((resolve, reject) => {
    readTwice((err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}

const result = readValue();
result.then(value => console.log(value)); // первый ответ`;

export const GUARANTEES: GuaranteeRow[] = [
  { name: 'Одна подписка — не более одного вызова', cb: 'нет', pr: 'да', how: '[[PromiseState]] меняется раз, alreadyResolved' },
  { name: 'Повторный resolve не меняет результат', cb: 'нет', pr: 'да', how: '[[PromiseResult]] фиксируется с состоянием' },
  { name: 'Вызов всегда асинхронный', cb: 'нет', pr: 'да', how: 'HostEnqueuePromiseJob при любой подписке' },
  { name: 'Можно подписаться ПОСЛЕ события', cb: 'нет', pr: 'да', how: 'завершённый (settled) промис ставит реакцию в очередь сразу' },
  { name: 'Хост узнает о необработанном отказе', cb: 'нет', pr: 'да', how: '[[PromiseIsHandled]] → unhandledrejection' },
  { name: 'Несколько независимых потребителей', cb: 'нет', pr: 'да', how: 'список реакций, а не одна ссылка' },
  { name: 'Вызовется хотя бы один раз', cb: 'нет', pr: 'нет', how: 'промис, навсегда оставшийся в ожидании, не вызовет ничего' },
];

export const HELL_ROWS = [
  {
    n: 'проблема 1',
    t: 'Результат нельзя вернуть',
    why: 'Асинхронный API возвращает управление раньше результата. Нельзя вернуть готовые данные из ещё не вызванного колбэка. Следующий шаг приходится запускать из него или отдельно договариваться о передаче результата.',
    fix: 'Промис — обычное значение: его можно вернуть, сохранить, передать дальше. Следующий шаг пишется рядом, а не внутрь.',
  },
  {
    n: 'проблема 2',
    t: 'Ошибку нельзя обработать в одном месте',
    why: 'Каждый уровень обязан сам проверить ошибку и передать её наверх: `if (err) return done(err)`. Забыли одну такую строку, и ошибка пропала без следа. А исключение, брошенное внутри колбэка, этой проверкой не ловится совсем.',
    fix: 'Отказ сам идёт по цепочке до ближайшего `.catch`. Один `.catch` в конце ловит и отказы, и исключения из любого `.then`.',
  },
  {
    n: 'проблема 3',
    t: 'Параллельные операции надо собирать руками',
    why: 'Чтобы дождаться нескольких операций, нужен счётчик готовых, флаг «уже ответили», запись результата по индексу, а не `push`, и отдельный случай для пустого списка. Пропустите любой пункт, и получите баг.',
    fix: '`Promise.all` делает это правильно без ваших флагов: промис может завершиться только один раз, и лишний ответ просто ничего не изменит.',
  },
];

export const COMPARE_ROWS: CompareRow[] = [
  { need: 'Вернуть результат наверх', cb: 'невозможно, только внутрь колбэка', pr: 'return promise' },
  { need: 'Одна обработка ошибок', cb: 'if (err) return cb(err) на каждом уровне', pr: 'один .catch в конце' },
  { need: 'Синхронный бросок внутри шага', cb: 'улетает в глобальный обработчик', pr: 'становится отказом цепочки' },
  { need: 'Параллельно N операций', cb: 'счётчик + флаг + запись по индексу', pr: 'Promise.all(ids.map(getUser))' },
  { need: 'Ограничить число одновременных операций', cb: 'вручную, поверх счётчика', pr: 'пул поверх all — всё равно вручную', manual: true },
  { need: 'Отмена', cb: 'вручную', pr: 'вручную (AbortController)', manual: true },
];

// ---- Раздел 7: реентерантность ----

export const REENTRANT = [
  {
    code: 'arr.sort((a, b) => {\n  arr.pop();\n  return a - b;\n});',
    why: 'Если функция сравнения меняет массив, спецификация оставляет результат на усмотрение движка (implementation-defined). Правильного ответа нет: каждый движок и каждая версия могут сделать по-своему. Даже «массив станет короче» неверно. V8 сортирует **свою копию** и потом записывает её обратно, поэтому после `sort` длина прежняя, хотя во время сортировки может упасть до нуля.',
  },
  {
    code: "emitter.on('tick', () =>\n  emitter.emit('tick')\n);",
    why: 'Бесконечная рекурсия и переполнение стека: слушатель сам отправляет то событие, на которое подписан.',
  },
  {
    code: 'const a = [1, 2, 3, 4];\na.forEach((x, i) => {\n  if (x === 2) a.splice(i, 1);\n  console.log(x);\n});\n// 1, 2, 4 — тройка пропущена',
    why: '`forEach` хранит собственный индекс и читает `a[i]` на каждом шаге. После `splice(1, 1)` элемент `3` переехал на индекс 1, а счётчик уже на 2 — значит, следующим прочитается `a[2] === 4`. То же с `map`, `filter`, `some`.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 5 · чего у колбэка нет: контекст и стек через асинхронную границу
// ---------------------------------------------------------------------------

/**
 * Пробел, которого не было и в исходном конспекте.
 *
 * Тема подробно разбирает, что `try/catch` не видит асинхронный колбэк, — но молчит
 * о втором следствии пустого стека: вместе с фреймом теряется и **происхождение** вызова.
 * Для темы, которая называется «внутренности», это существенно: именно отсюда растут
 * `AsyncLocalStorage`, async stack traces и вопрос «кто нас позвал».
 */
export const ASYNC_CONTEXT_CODE = `function handler(id) {
  setTimeout(() => {
    throw new Error('упало');   // стек начинается в колбэке
  }, 0);
}
handler(42);                    // ← этого кадра в стеке уже не будет`;

export const ASYNC_CONTEXT_FACTS = [
  {
    k: 'стек обрывается на границе',
    d: 'У колбэка таймера новая цепочка вызовов: кадр функции, поставившей таймер, уже завершён. Для `await` движки достраивают асинхронный стек (async stack traces), а для простого `setTimeout` восстанавливать нечего.',
  },
  {
    k: 'контекст тоже не переезжает',
    d: 'Замыкание сохраняет захваченные переменные, даже когда создавший его вызов завершился. А общая изменяемая переменная «текущий запрос» может оказаться уже перезаписана другим запросом. Автоматическое распространение контекста решает отдельную задачу.',
  },
  {
    k: '`AsyncLocalStorage` — встроенный ответ Node',
    d: 'Хранилище, которое не теряется между синхронным кодом и колбэком: `als.run(ctx, fn)` — и любой колбэк, запланированный внутри, читает тот же `als.getStore()`. Так передают идентификатор запроса через все слои, не протаскивая его параметром.',
  },
  {
    k: 'чего это стоит и где работает',
    d: 'Механизм и его ограничения разобраны в теме [«Асинхронный контекст»](/js/async-context/). Явная передача параметром и замыкание остаются отдельными способами сохранить нужные данные.',
  },
];

/**
 * Три разных исхода у трёх похожих ошибок — сведены в одно место намеренно.
 *
 * В теме они разбросаны: бросок из синхронного колбэка объясняется в разделе про стек,
 * `unhandledRejection` упомянут строкой в таблице гарантий, `uncaughtException` — в тонком
 * месте. Читателю нужен ответ на вопрос «куда это попадёт», а он собирается по кусочкам.
 */
export const ERROR_DESTINATIONS = [
  {
    k: 'бросок в синхронном колбэке',
    d: 'Идёт вверх по стеку к вызывающему: `try/catch` вокруг `arr.map(...)` его поймает, потому что колбэк выполняется, пока ваша функция **ещё на стеке**.',
    tone: 'ok' as const,
  },
  {
    k: 'бросок в асинхронном колбэке',
    d: 'Под ним пусто. В Node — `uncaughtException` и по умолчанию падение процесса; в браузере — `window.onerror`, страница живёт дальше наполовину сломанной.',
    tone: 'err' as const,
  },
  {
    k: 'отказ промиса без `.catch`',
    d: 'Это вовсе не исключение: промис запоминает причину и ждёт подписчика. Если подписчик не появился, пока выполнялись микрозадачи после текущего кода, — `unhandledRejection` (Node) или `unhandledrejection` (браузер). В Node это тоже завершает процесс.',
    tone: 'warn' as const,
  },
];

export const ERROR_DESTINATIONS_NOTE =
  'Каналы разные, и один не подменяет другой. Обработчик `unhandledRejection` не увидит исключение из таймера, а `uncaughtException` получит отказ промиса, только если слушателя `unhandledRejection` нет: тогда Node поднимает отказ как исключение. Приложению нужны оба, плюс `window.onerror` и `unhandledrejection` на стороне браузера.';

/**
 * Вывод обоих сценариев проверен запуском в Node 24.11.
 *
 * ⚠️ Оговорка про вторую строку: `EventTarget` там снимался тоже **в Node**, а не в браузере.
 * Совпало — демо `widgets/dispatch-lab` снимает её с настоящего браузерного `EventTarget`
 * и даёт то же самое, — но знать, откуда взято число, важнее, чем то, что оно сошлось.
 */
export const DISPATCH_EMITTER = 'a → b → c\na → c';
export const DISPATCH_DOM = 'a → c\na → c';

/**
 * Сценарий, на котором сняты `DISPATCH_EMITTER` и `DISPATCH_DOM`, — раньше его на странице
 * не было: два литерала вывода стояли без кода, который их даёт. Код повторяет сценарий
 * `tests/unit/callbacks.test.ts` («первый слушатель снимает второго, потом два вызова подряд»).
 * Разбор по шагам — по той же просьбе автора (2026-09-29) «описывай просто подробно».
 * Случай «без копии» — это ловушка `forEach` + `splice` из `REENTRANT`, перенесённая на список
 * слушателей; движок тут не утверждается, это арифметика индексов.
 */
/** Список текущего target/фазы и дальнейший путь всплытия — разные границы. */
export const DOM_LATE_LISTENER_CODE = `const parent = document.createElement('div');
const button = document.createElement('button');
parent.append(button);
const out = [];

button.addEventListener('click', () => {
  out.push('button');
  parent.addEventListener('click', () => out.push('parent'), { once: true });
});
button.dispatchEvent(new Event('click', { bubbles: true }));
out; // ['button', 'parent']: слушатель предка уже участвует в этом событии`;

export const DISPATCH_SCENE_CODE = `const a = () => { log('a'); off(b); };   // a снимает b
const b = () => log('b');
const c = () => log('c');

on(a); on(b); on(c);
emit();   // первая рассылка: b сняли посреди неё
emit();   // вторая: b в списке уже нет`;

export const DISPATCH_SCENE_NOTE =
  'Что было бы, если бы рассылка шла **прямо по живому списку**, без копии. Список `[a, b, c]`, счётчик на `0` — зовём `a`, и `a` вырезает `b`: список стал `[a, c]`. Счётчик переходит на `1` и находит там `c`. Здесь повезло: ответ `a → c` выглядит разумно. Но пусть `a` снимет **себя** — список станет `[b, c]`, счётчик на `1` найдёт `c`, и `b`, которого никто не снимал, молча пропущен. Это та же ловушка, что `forEach` со `splice` выше. Поэтому оба API сначала копируют список и обходят копию; расходятся они в том, что делать со снятыми.';

export const DISPATCH_STEPS: { k: string; what: string; cost: string }[] = [
  {
    k: 'Node EventEmitter',
    what: 'Перед рассылкой копирует список слушателей и идёт по копии. `a` убирает `b` из настоящего списка, но в копии `b` остался, поэтому событие он всё равно получит: **a → b → c**. Ко второй рассылке `b` в списке уже нет: **a → c**.',
    cost: 'Снятый слушатель может сработать ещё раз — в той рассылке, которая уже идёт. Если его сняли потому, что компонент убран, колбэк обратится к уже убранному компоненту.',
  },
  {
    k: 'DOM EventTarget',
    what: 'Тоже идёт по копии, но снятого слушателя помечает как удалённого и перед каждым вызовом проверяет эту пометку. `b` помечен раньше, чем до него дошла очередь, поэтому его пропускают уже в первой рассылке: **a → c**. Во второй — тоже **a → c**.',
    cost: 'Проверка пометки перед каждым вызовом. Зато снятый слушатель перестаёт вызываться сразу, а не со следующей рассылки.',
  },
];

export const PLAIN_DISPATCH =
  'Секретарь обзванивает гостей по распечатанному списку. Первый гость по телефону просит вычеркнуть второго. **Node** вычёркивает во всех будущих распечатках, но звонит по той, что в руках, — второму всё равно позвонят сегодня. **DOM** ставит у имени в общей книге пометку «отказался» и перед каждым звонком в неё заглядывает — второму не позвонят уже сегодня.';

// ---------------------------------------------------------------------------
// Раздел 4 · цена привязки
// ---------------------------------------------------------------------------

/**
 * Чего в теме не было: `bind` и стрелка-поле сравнивались только по `this`
 * и по идентичности ссылки, но не по тому, во что они обходятся.
 */
export const BIND_COST = [
  {
    k: 'метод на прототипе',
    d: 'Одна функция на весь класс, сколько бы ни было экземпляров. Но если метод оторвать от объекта, `this` теряется — ради этого и придуманы остальные способы.',
    tone: 'ok' as const,
  },
  {
    k: '`bind` в конструкторе',
    d: 'Новая функция **на каждый экземпляр**: привязанная (bound) функция хранит в скрытых полях исходную функцию, `this` и аргументы. Зато ссылку можно сохранить и потом снять слушателя.',
    tone: 'warn' as const,
  },
  {
    k: 'поле-стрелка класса',
    d: 'Тоже своя функция на каждый экземпляр — поле заполняется в конструкторе. Плюс: `this` берётся из окружения и не теряется. Минус тот же: на прототипе её нет, и методом класса она не является.',
    tone: 'warn' as const,
  },
  {
    k: '`bind` прямо в аргументе',
    d: 'Худший вариант: новая функция создаётся **на каждую подписку**, ссылки не остаётся, снять слушателя нечем. К беде из тонкого места про `removeEventListener` («такого слушателя не снять») добавляется память: каждая подписка оставляет ещё одну функцию.',
    tone: 'err' as const,
  },
];

export const BIND_COST_NOTE =
  'Сохраняйте созданную функцию, если будете снимать подписку по ссылке. Привязка на каждый экземпляр или подписку может быть оправдана; ошибка — создавать другую функцию вместо прежней при удалении. Сигнал отмены упрощает снятие группы подписок, но не задаёт `this` колбэка.';

// ---- Раздел 8: тонкие места ----

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'AbortController не снимает слушателя `EventEmitter`',
    code: "emitter.on('tick', onTick, { signal });  // третий аргумент ИГНОРИРУЕТСЯ\n\n// работают эти два:\nevents.addAbortListener(signal, () => emitter.off('tick', onTick));\nfor await (const [v] of events.on(emitter, 'tick', { signal })) { /* … */ }",
    d: 'У `EventEmitter#on` два параметра. Лишний аргумент молча отбрасывается, и после `abort()` слушатель остаётся подписанным: счётчик слушателей по-прежнему 1, и `emit` его зовёт (Node 24.11). Два способа из кода выше работают — счётчик после `abort()` падает до нуля. Опцию `signal` понимают `addEventListener` и `fetch`, но не `EventEmitter#on`.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`setTimeout(fn())` ведёт себя по-разному в браузере и в Node',
    code: 'setTimeout(fn(), 100);\n// Node: fn() выполнилась, затем\n//   TypeError [ERR_INVALID_ARG_TYPE]\n// браузер: fn() выполнилась, таймер завёлся,\n//   ни ошибки, ни строчки в консоли',
    d: 'В показанном случае с `undefined` Node сразу бросает `ERR_INVALID_ARG_TYPE` — ошибку видно на первом же запуске. Браузер по стандарту HTML поступает иначе: значение `undefined` он приводит к строке и после задержки **исполняет как код**. `undefined` исполняется впустую — ни исключения, ни записи в консоли, так ведут себя Chromium, Firefox и Safari. Поэтому в браузере ошибка живёт незамеченной. А если `fn()` вернула строку, та выполнится как код.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Утечка не там, где её обычно рисуют',
    code: "const huge = new Array(1e6).fill('x');\nbus.on('tick', () => log('tick'));\n// huge никем не захвачен → V8 его НЕ держит",
    d: 'Без соседнего замыкания, которое читает `huge`, утечки нет: V8 кладёт в Context только захваченные переменные. Утечку создаёт захват, а не соседство. Пример и замер — в [«Памяти и GC», раздел «Замыкания»](/js/memory-gc/#s3).',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`removeEventListener` сравнивает по идентичности ссылки',
    code: "el.addEventListener('click', fn.bind(this));\nel.removeEventListener('click', fn.bind(this));   // не снимет",
    d: 'Каждый `bind` создаёт новую функцию, поэтому второй `bind` отписывает не того, кого подписали, — и молча. Разбор и цена каждого способа привязки — в разделе [«`this` в колбэке»](#s4).',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Выполнение продолжается после cb(err)',
    code: "fs.readFile(p, (err, data) => {\n  if (err) cb(err);          // забыли return\n  cb(null, data.toString());  // data === undefined → TypeError\n});",
    d: 'Без `return` после `cb(err)` выполнение продолжается. Возможен второй ответ, но в этом листинге `data === undefined`: второй колбэк ещё не вызван, а `data.toString()` уже бросает `TypeError`. Первый ответ об ошибке успел уйти потребителю; исключение из отложенного колбэка внешний `try/catch` не перехватит. Обёртка `once` здесь **не помогает**, и это неочевидно: аргумент `data.toString()` вычисляется **до** вызова обёртки, поэтому бросок случится раньше, чем она успеет отбросить повтор. `once` — страховка от чужого кода, а не замена собственному `return`.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`thisArg` есть не у всех методов массива',
    code: "['a'].map(fn, obj);      // this === obj\n['a'].sort(fn, obj);     // второй аргумент проигнорирован\n// Array.prototype.sort.length === 1",
    d: '`thisArg` принимают одиннадцать методов: `map`, `forEach`, `filter`, `some`, `every`, `find`, `findIndex`, `findLast`, `findLastIndex`, `flatMap` и `Array.from`. У `sort` его нет: второй аргумент отбрасывается молча, без ошибки, и `Array.prototype.sort.length === 1`. А вот у `reduce` и `reduceRight` второй аргумент тоже есть, но он **занят начальным значением**. Это хуже молчания: объект, переданный туда ради `this`, станет аккумулятором первого шага. И со стрелкой `thisArg` бесполезен в любом случае: привязывать у неё нечего.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`forEach` не умеет ждать `async`-колбэк',
    code: "ids.forEach(async (id) => {\n  await load(id);\n  console.log('готов', id);\n});\nconsole.log('всё?');   // напечатается ПЕРВЫМ",
    d: '`forEach` выбрасывает промис, который вернул колбэк: дождаться нельзя, а ошибка уходит мимо `try/catch`. → последовательно — `for…of` с `await`; параллельно — `Promise.all(ids.map(load))`. Шкала времени и пул на N задач — в [«Промис изнутри», раздел «Комбинаторы и одновременная работа»](/js/promise-internals/#s4).',
    tone: 'err',
  },
];

// ---------------------------------------------------------------------------
// Раздел 8 · песочница
// ---------------------------------------------------------------------------

/**
 * Заготовки для песочницы: утверждения темы, которые интереснее проверить самому.
 *
 * Код уходит в воркер (`features/run-snippet/lib/worker.ts`), поэтому здесь нельзя
 * верхнеуровневый `import`/`export`, а объекты надо печатать через `JSON.stringify`:
 * `console.log` в воркере склеивает аргументы через `String(...)`. Бесконечный цикл вкладку
 * не убьёт — воркер снимается по таймауту.
 *
 * ⚠️ Подписи ниже опираются на прогон, а не на память: каждая заготовка выполнена, и вывод
 * сверен. Это ровно то правило, которому учит сама тема — заявленный порядок обязан быть снят.
 */
export const LAB_SNIPPETS = [
  {
    label: 'Zalgo',
    code: `const cache = new Map();

function getUser(id, cb) {
  if (cache.has(id)) return cb(cache.get(id));   // синхронно!
  setTimeout(() => { cache.set(id, {id}); cb({id}); }, 0);
}

// Холодный кеш: колбэк уедет в конец.
console.log('до (холодный)');
getUser(1, () => console.log('колбэк 1 — холодный кеш'));
console.log('после (холодный)');

// Дадим таймеру сработать — теперь запись в кеше есть.
setTimeout(() => {
  console.log('до (горячий)');
  getUser(1, () => console.log('колбэк 2 — ГОРЯЧИЙ кеш, синхронно'));
  console.log('после (горячий)');
}, 10);`,
    note: 'Смотрите на две тройки строк. В холодной колбэк напечатался **после** «после», в горячей — **между** «до» и «после», то есть посреди вашего кода. Один и тот же вызов, два разных порядка — это и есть Zalgo. Почините: оберните синхронную ветку в `queueMicrotask(() => cb(...))`, и обе тройки станут одинаковыми.',
  },
  {
    label: 'арность колбэка',
    code: `// Печатаем по элементам: JSON.stringify превратил бы NaN в null и запутал.
console.log(['1', '2', '3'].map(parseInt).join(', '));

// почему так — посмотрите, что реально приходит в колбэк:
['1', '2', '3'].map((value, index) => {
  console.log('value =', value, '· index =', index, '→ parseInt даёт', parseInt(value, index));
});`,
    note: '`map` передаёт колбэку три аргумента, а `parseInt` принимает два — и второй у него это система счисления. Отсюда `NaN`: во втором вызове основание 1, в третьем — 2, а цифры «2» в двоичной системе нет. Лечится обёрткой, которая берёт ровно один аргумент: `.map(Number)` или `.map((s) => parseInt(s, 10))`.',
  },
  {
    label: 'executor против then',
    code: `console.log('до');

new Promise((resolve) => {
  console.log('executor — выполняется СИНХРОННО');
  resolve(42);
}).then((v) => console.log('then', v, '— всегда асинхронно'));

console.log('после');`,
    note: 'Тело `new Promise` выполняется сразу, а реакция `.then` — всегда в микрозадаче, даже если промис уже исполнен. Случая, где `then` сработал бы синхронно, нет: так требует спецификация языка, библиотека тут ничего не решает.',
  },
  {
    label: 'мутация во время обхода',
    code: `const a = [1, 2, 3, 4];

a.forEach((x, i) => {
  if (x === 2) a.splice(i, 1);
  console.log('видим', x);
});

console.log('массив стал', JSON.stringify(a));`,
    note: 'Тройка пропущена: обход хранит собственный индекс, а `splice` сдвинул элементы под ним. Попробуйте `map` и `filter` — то же самое. Правило: синхронный колбэк не должен менять структуру, по которой его зовут; собирайте изменения в отдельный список и применяйте после обхода.',
  },
  {
    label: 'forEach и async',
    code: `const ids = [1, 2, 3];
const load = (id) => new Promise((r) => setTimeout(() => r(id), 10));

ids.forEach(async (id) => {
  await load(id);
  console.log('готов', id);
});

console.log('всё? — а вот и нет');`,
    note: '`forEach` игнорирует возвращаемое значение колбэка, поэтому промис отбрасывается: дождаться нельзя, ошибка внутри уйдёт в `unhandledRejection` мимо вашего `try/catch`, а на большом массиве все запросы уйдут разом. Последовательно — `for…of` с `await`; параллельно — `Promise.all(ids.map(load))`.',
  },
  {
    label: 'потерянный this',
    code: `const user = {
  name: 'Аня',
  greet() { return 'привет, ' + this.name; },
};

console.log('вызов методом:', user.greet());

const torn = user.greet;              // оторвали от объекта
console.log('оторванный:', torn());   // this уже не user

// Тот же отрыв в строгом режиме — и ответ другой:
const strictGreet = new Function('"use strict"; return this === undefined');
console.log('в strict this === undefined:', strictGreet());

console.log('через bind:', user.greet.bind(user)());
console.log('bind(o) !== bind(o):', user.greet.bind(user) !== user.greet.bind(user));`,
    note: '`this` вычисляется в момент вызова по точке вызова, а не по тому, где функция написана. ⚠️ Обратите внимание на режим: здесь код нестрогий, поэтому у оторванного метода `this` стал глобальным объектом. Песочница — воркер, а у его глобального объекта `name` — пустая строка: вышло «привет, » без имени. В модуле или теле класса — всегда strict, и там тот же отрыв даёт `TypeError`. Последняя строка — причина тонкого места про `removeEventListener`: каждый `bind` создаёт **новую** функцию, поэтому снять слушателя «таким же» выражением невозможно.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 9 · источники
// ---------------------------------------------------------------------------

/*
 * Блока «За кадром» у темы больше нет. Второй проход снял `MaxListeners`, `util.promisify`
 * и предел задержки таймера (разобраны в теме). Третий — последние три пункта, каждый подробно
 * разобран в соседней теме и стал фразой со ссылкой там, где читатель о нём спотыкается:
 * `passive` — в разделе «Отмена» рядом с опцией `signal`; колбэк через границу потока —
 * в конце раздела «Функция как значение» (`DataCloneError` проверен в Node 26.8.2);
 * ограничение конкурентности — ссылка на пул уже стояла в разделе «Гарантии».
 */

/**
 * Источники: нормативные тексты отдельно от объяснений.
 *
 * ⚠️ Вторая строка обязательна — без неё ссылка означает «я это где-то видел».
 */
export const SOURCES: Source[] = [
  {
    title: 'ECMA-262 · CreateResolvingFunctions',
    href: 'https://tc39.es/ecma262/#sec-createresolvingfunctions',
    what: 'Флаг `alreadyResolved` — механизм, из-за которого промис не может быть исполнен дважды.',
  },
  {
    title: 'ECMA-262 · Jobs and Host Operations',
    href: 'https://tc39.es/ecma262/#sec-jobs',
    what: '`HostEnqueuePromiseJob`: почему реакции `.then` асинхронны всегда, а executor — синхронен.',
  },
  {
    title: 'ECMA-262 · Array.prototype.forEach',
    href: 'https://tc39.es/ecma262/#sec-array.prototype.foreach',
    what: 'Обход хранит собственный индекс и читает элемент на каждом шаге — отсюда пропуск после `splice`.',
  },
  {
    title: 'WHATWG DOM · 2.9 Dispatching events',
    href: 'https://dom.spec.whatwg.org/#concept-event-dispatch',
    what: 'Копия списка берётся для текущей цели и фазы; снятые записи помечаются removed. Поэтому добавление слушателя предку до всплытия отличается от добавления в уже обходимый список.',
  },
  {
    title: 'Node.js · Events: emitter.emit',
    href: 'https://nodejs.org/api/events.html#emitteremiteventname-args',
    what: 'Диспетчеризация по копии списка — отсюда другое поведение при снятии слушателя на лету.',
  },
  {
    title: 'Node.js · AsyncLocalStorage',
    href: 'https://nodejs.org/api/async_context.html#class-asynclocalstorage',
    what: 'Штатный способ пронести контекст через асинхронную границу, где обрывается стек.',
  },
  {
    title: 'Isaac Z. Schlueter · Designing APIs for Asynchrony',
    href: 'https://blog.izs.me/2013/08/designing-apis-for-asynchrony/',
    what: 'Тот самый текст, который дал имя Zalgo и сформулировал правило «либо всегда sync, либо всегда async».',
  },
  {
    title: 'MDN · EventTarget.addEventListener',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener',
    what: 'Опции `once`, `capture`, `passive`, `signal` — и правило сравнения слушателей по идентичности.',
  },
];

/* ──────────────────── Вводный раздел · словарь темы ──────────────────── */

/**
 * Слова, которыми тема пользуется раньше, чем объясняет.
 *
 * Тема вторая в направлении, а опирается на понятия из четвёртой, третьей и девятой — так
 * вышло исторически, и словарь здесь не украшение, а способ не отправлять читателя вперёд
 * по списку за каждым вторым термином.
 */
export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'инверсия управления',
    d: 'Передать функцию — значит **передать право её вызвать**. Когда, сколько раз, с какими аргументами и с каким `this` — решает уже чужой код. Отсюда все шесть источников багов, о которых эта тема.',
  },
  {
    k: 'арность',
    d: 'Сколько параметров объявлено у функции. Важна потому, что чужой код передаёт аргументы **по позиции**: известный пример `["1","2","3"].map(parseInt)` ломается как раз на этом.',
  },
  {
    k: '`thisArg`',
    d: 'Значение `this`, с которым чужой код вызовет ваш колбэк; `map` и соседние методы принимают его вторым аргументом. Назначает его вызывающая сторона, а не вы, поэтому метод, переданный по ссылке, теряет свой объект. Так устроен любой вызов в JS.',
  },
  {
    k: 'Zalgo',
    d: 'Функция, которая иногда зовёт колбэк синхронно (сразу), а иногда асинхронно (потом). Название взято из статьи Айзека Шлютера. Опасно это тем, что порядок выполнения строк становится непредсказуемым, и баг воспроизводится через раз.',
  },
  {
    k: 'error-first',
    d: 'Соглашение Node: первый аргумент колбэка — ошибка либо `null`. Язык его не проверяет, это договорённость, поэтому она ломается там, где кто-то её не соблюдает.',
  },
  {
    k: '`Environment Record` и `[[Environment]]`',
    d: 'Environment Record — запись, где хранятся переменные одной области видимости (скоупа). `[[Environment]]` — скрытое поле функции со ссылкой на запись того места, где её создали. Это и есть замыкание: функция держит **всю запись** целиком, а не отдельные переменные.',
  },
  {
    k: 'Context (V8)',
    d: 'Так эта запись устроена внутри движка V8: один объект **на скоуп**, а не на каждую переменную. Поэтому замыкание, которое использует одну переменную, держит в памяти и всё, что используют соседние функции того же скоупа.',
  },
  {
    k: 'detached-узел',
    d: 'DOM-узел, который убрали из документа, но на который ещё есть ссылка из JS — например, из списка слушателей. Он остаётся в памяти вместе со всем поддеревом. Это самый частый вид утечки через забытых слушателей.',
  },
  {
    k: 'задача и микрозадача',
    d: 'Две очереди, из которых достают ваш колбэк. Разница в одном: микрозадачи выполняются сразу за текущим кодом, **не дожидаясь** следующей задачи, то есть поток они не отпускают. От этого зависит, доживёт ли ваш `try` до вызова.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

/* ⚠️ Здесь стоял лид «Три факта тема берёт готовыми: где…, что…, что…» — пересказ трёх карточек под ним. Снят 2026-09-30. */
export const PREREQ_NOTE = '';

export const PREREQ: Prereq[] = [
  {
    t: 'Что колбэк исполняется в пустом стеке',
    d: 'Асинхронный колбэк вызывается **новой задачей**, и вашей функции на стеке под ним уже нет: `try/catch` вокруг подписки до него не дотягивается, а `return` из него никто не получит. Очереди, из которых его достают, разобраны отдельно.',
    href: '/js/event-loop/',
    hrefLabel: 'Event Loop',
    tone: 'err' as const,
  },
  {
    t: 'Что промис гарантирует колбэку',
    d: 'Функция, переданная в `new Promise(…)`, выполняется **сразу и синхронно** — ещё до того, как `new` вернёт промис. Колбэк из `then` — наоборот, **всегда асинхронно**, микрозадачей: даже если промис к моменту подписки уже выполнен. Состояние меняется **один раз**: повторный `resolve` или `reject` ничего не делает, а результат запоминается — поздний `then` получит тот же ответ.',
    href: '/js/promise-internals/',
    hrefLabel: 'Промис изнутри',
    tone: 'warn' as const,
  },
  {
    t: 'Что замыкание держит скоуп целиком',
    d: 'Замыкание держит не одну переменную, а `Context` — один объект на весь скоуп. Поэтому забытый слушатель удерживает не «пару байт», а всё, что захвачено рядом, вместе с узлами DOM.',
    href: '/js/memory-gc/',
    hrefLabel: 'Память и GC',
    tone: 'info' as const,
  },
];

/*
 * Лиды демо: виджеты стояли встык, без слов о том, что в них смотреть.
 *
 * ⚠️ Приём был заведён, но доведён только до двух демо из семи. Остальные пять читатель
 * встречал молча — переключатель, плеер, полдюжины панелей и ни слова о том, что нажать.
 * Ниже недостающие; каждая называет органы управления так, как они подписаны на экране.
 */

export const STACK_DEMO_NOTE =
  'Одна и та же ошибка в колбэке, два способа его передать. Синхронно через `each` — кадр вашего кода остаётся под колбэком, бросок поднимается по стеку и попадает в `catch`. Отложенно через `setTimeout` — к моменту вызова кадр вашего кода уже завершён, и внешний `catch` недоступен: ошибка уходит в глобальный обработчик.';

export const ZALGO_DEMO_NOTE =
  'Код один и тот же, а исход разный. При промахе колбэк зовётся из таймера, когда `showSpinner()` уже отработал, — спиннер прячется, как задумано. При попадании колбэк зовётся сразу, внутри `getUser`, когда `spinner` ещё `null`: прятать нечего, а строкой ниже спиннер появится — и останется висеть навсегда.';

export const THIS_DEMO_NOTE =
  'Один метод, восемь способов его передать. `this` правильный только там, где его кто-то явно обеспечил: `bind`, стрелка-обёртка, поле-стрелка, `thisArg` у `map`, объект с `handleEvent`. Передали метод как есть — и `this` станет тем, что подставит чужой код: `undefined` у `map` и деструктуризации, DOM-элемент у `addEventListener`. Ответы и текст ошибок считает ваш браузер.';

export const DISPATCH_DEMO_NOTE =
  'Здесь то же на живом коде: настоящий `EventTarget` вашего браузера, эмиттер в стиле Node и три способа испортить обход, меняя структуру прямо во время него. Янтарным помечен слушатель, **снятый во время рассылки и всё равно вызванный** — такое бывает только у эмиттера в стиле Node.';

export const LAB_DEMO_NOTE =
  'Вывод настоящий, из вашего браузера. Код выполняется в отдельном потоке, поэтому `while (true)` остановит только этот поток, а не страницу.';

/*
 * ⚠️ Подпись обещала две вещи, которых у демо нет: «смотреть надо на последний столбец»
 * (столбцов у виджета нет вовсе — переключатель случаев, листинг, вопрос и два блока ответа)
 * и «ошибка брошена по-настоящему» (виджет ничего не исполняет, он раскрывает разбор).
 * Та же беда, что «смотреть надо на шаги слева» в теме про объектную модель: подпись
 * описывала не то демо, которое стоит на странице.
 */
export const ERRORS_DEMO_NOTE =
  'Во всех трёх случаях файл не прочитался, а ошибка уходит не туда, куда ждали. В первых двух бросок случается позже и в другом стеке, где ловить уже некому. В третьем — наоборот, раньше, чем обещает соглашение: синхронно, мимо `cb`. Это учебный разбор маршрутов ошибки: код внутри виджета не исполняется.';

/*
 * Врезки «на пальцах»: то же, что термин, словами читателя. Стоят там, где понятие
 * встречается впервые; образец приёма — `lessons/object-model` (`PLAIN_*`).
 */

export const PLAIN_IOC =
  'Передать колбэк — как отдать ключи от машины парковщику. Машина по-прежнему ваша, но когда её заведут, сколько раз, куда поедут и вернут ли ключи, решаете уже не вы. С колбэком так же: когда его вызвать, сколько раз, с какими аргументами, с каким `this`, куда уйдёт ошибка и отпустят ли ссылку — решает чужой код.';

export const PLAIN_STACK =
  '`try/catch` ловит ошибку, пока ваша функция ещё выполняется, — он привязан к моменту, а не к строчкам. Синхронный колбэк зовут прямо сейчас, пока вы на месте. Асинхронный — потом, когда ваша функция давно вернулась. Как звонок на домашний телефон: позвонили, пока вы дома, — трубку взяли; позвонили через час, когда вы ушли, — звонок уйдёт в пустую квартиру.';

export const PLAIN_CONTEXT =
  'Замыкание сохраняет доступ к нужным внешним переменным. В V8 несколько функций одного вызова могут делить общую «комнату»: в ней лежат переменные, захваченные хотя бы одной из них. Пока функция жива — например, числится в списке подписчиков, — комнату не освобождают целиком. Как ключ от ячейки камеры хранения: вам нужна одна сумка, но пока ключ у вас, ячейку не освободят со всем содержимым.';

export const PLAIN_ZALGO =
  'Функция с колбэком обязана выбрать одно из двух: звать его всегда сразу или всегда потом. Zalgo — когда выбор зависит от обстоятельств, например от того, есть ли ответ в кеше. Код вокруг рассчитан на один порядок строк и ломается на другом. Как доставка, которая обычно едет час, а если товар на ближнем складе — звонит в дверь, пока вы ещё не дописали адрес.';

export const PLAIN_THIS =
  '`this` — как слово «я»: оно означает того, кто говорит, а не того, кто написал фразу. Вызвали `api.get()` через точку — «я» это `api`. Отдали `api.get` чужому коду — и «я» станет тем, кого подставит он при вызове: `undefined`, DOM-элемент или что-то ещё.';

export const RELATED =
  'Смежное на сайте: [цикл событий](/js/event-loop/) — очереди, из которых ваш колбэк достают. [Промис изнутри](/js/promise-internals/) — те самые гарантии, разобранные по шагам спецификации. [Память и сборщик](/js/memory-gc/) — почему забытый слушатель держит целое поддерево. [Отмена: AbortController и AbortSignal](/js/abort-controller/) — сигнал, `any` и `timeout`, что отменяет `fetch` и как не оставить слушателей на долгоживущем сигнале. [Debounce, throttle и token bucket](/algorithms/rate-limiting/) — обёртки, которые зовут ваш колбэк реже, чем приходят события, и ограничители частоты.';
