import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RealRun, RunnerName, Scenario } from '@/widgets/test-runner-lab/model/types';

/**
 * Данные темы «Тест-раннеры изнутри: Vitest и Jest».
 *
 * Тема написана здесь, 2026-10-01, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * vitest **5.0.0** (vite 8.3.0, пул по умолчанию `forks`), jest **30.5.2** (jest-circus 30.5.2,
 * babel-jest 30.5.2, babel-plugin-jest-hoist 30.5.0, @jest/fake-timers 30.5.2 поверх
 * @sinonjs/fake-timers 15.4.0), `@vitest/spy` 5.0.0, `jest-mock` 30.5.2 — всё из `node_modules`
 * проекта. Node 24.11.0, macOS, октябрь 2026.
 *
 * Как снято: каждая фикстура ниже записана файлом во временный каталог (рядом — симлинк на
 * `node_modules` проекта) и прогнана настоящими раннерами в отдельном процессе:
 * `vitest run --globals` и `jest` без конфига. Для Vitest файл начинается с
 * `import { appendFileSync } from 'node:fs'`, для Jest — с `require('node:fs')`; дальше одна
 * строка `const log = (s) => appendFileSync(<файл журнала>, s + '\n')`. Больше ничего
 * не добавлено. Журнал — это `log` в литералах `real`.
 *
 * Что нормализовано:
 *   — трансформации моков: абсолютный путь до `node_modules` заменён на `…`, хвост с картой
 *     исходников и служебными комментариями отрезан, подряд идущие пустые строки схлопнуты
 *     в одну; у Jest снята первая строка файла кеша (хеш);
 *   — тексты ошибок — только первые строки, без стека и кадра с кодом;
 *   — таблица изоляции: номер процесса заменён на «тот же / другой».
 *
 * Трансформации сняты так: Vitest — `VITEST_DEBUG_DUMP=<каталог>`, он пишет
 * `vitest-metadata.json` со ссылками на файлы преобразованных модулей; Jest — `--cacheDirectory`,
 * преобразованный Babel файл лежит в `jest-transform-cache-*`.
 *
 * Всё перечисленное пересобирается `tests/unit/test-runners.test.ts`: тест пишет те же
 * фикстуры, запускает те же раннеры в отдельных процессах и сверяет с литералами здесь, а
 * учебные функции (`RUNNER_CODE`, `MODULES_CODE`, `SPY_CODE`, `CLOCK_CODE`) — с настоящими
 * раннерами и библиотеками.
 *
 * Только по документации, без запуска: `clearMocks`/`restoreMocks` в конфиге, `vi.resetModules`
 * и `jest.isolateModules`, перемешивание файлов (а не тестов) у `--sequence.shuffle`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'тест-раннер',
    d: 'Программа, которая находит тестовые файлы, исполняет их и собирает отчёт. Vitest и Jest — раннеры. `expect` — отдельная библиотека проверок, которую они кладут в комплект.',
  },
  {
    k: '`describe`, `test` и `it`',
    d: '`test` записывает один тест: имя и функцию. `describe` объединяет тесты в блок, у блока могут быть свои хуки. `it` — второе имя `test`, разницы нет.',
  },
  {
    k: 'хук',
    d: 'Функция, которую раннер зовёт вокруг тестов. `beforeAll` и `afterAll` — один раз на блок, `beforeEach` и `afterEach` — вокруг каждого теста блока, в том числе вложенных.',
  },
  {
    k: 'воркер',
    d: 'Отдельный процесс или поток, в котором раннер исполняет тестовые файлы. Несколько воркеров дают параллельность. Vitest по умолчанию заводит новый процесс на каждый файл.',
  },
  {
    k: 'vm-контекст',
    d: 'Ещё один глобальный объект со своими `Array`, `Object` и `Error` внутри того же процесса Node — модуль `node:vm`. Jest исполняет в таком каждый тестовый файл.',
  },
  {
    k: 'реестр модулей',
    d: 'Таблица «путь → уже исполненный модуль». Повторный `require` или `import` того же файла берёт ответ из неё и код файла второй раз не запускает.',
  },
  {
    k: 'мок модуля',
    d: 'Подмена файла: вместо настоящего модуля импорт получает объект, который вернула фабрика из `vi.mock` или `jest.mock`.',
  },
  {
    k: 'шпион',
    d: 'Функция-обёртка, которая записывает каждый вызов: аргументы, `this`, результат или ошибку. Это `vi.fn`, `jest.fn` и `spyOn`.',
  },
  {
    k: 'фейковые таймеры',
    d: 'Подменённые `setTimeout`, `setInterval` и `Date`. Таймеры копятся в очереди и срабатывают, только когда тест сам прокручивает часы.',
  },
];

export const PLAIN_RUNNER =
  'Как репетиция спектакля. Сначала режиссёр читает пьесу целиком и раскладывает сцены по карточкам — ни один актёр ещё не вышел. Потом труппа играет сцену за сценой: перед каждой грим (`beforeEach`), после — смыть грим (`afterEach`). Если декорации для целого акта (`beforeAll`) не привезли, режиссёр решает, играть ли этот акт вовсе. Vitest и Jest решают по-разному.';

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, разобранные в других темах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Модуль исполняется один раз',
    d: 'Второй импорт того же файла не запускает его код снова, а отдаёт уже готовый модуль из карты модулей. На этом держится и изоляция тестов, и моки.',
    href: '/tooling/modules/#s1',
    hrefLabel: '«Модули и сборка», раздел «Три фазы»',
    tone: 'info',
  },
  {
    t: 'Таймеры и очередь задач',
    d: '`setTimeout` не ждёт, а ставит запись в список таймеров. Когда время подошло, колбэк становится задачей, а после каждой задачи выполняются все микрозадачи — продолжения промисов.',
    href: '/js/event-loop/#s4',
    hrefLabel: '«Event Loop», раздел «Таймеры»',
    tone: 'info',
  },
  {
    t: 'Чужие встроенные объекты',
    d: 'У каждого iframe и каждого vm-контекста свои `Array` и `Error`. Массив из другого такого мира для `instanceof Array` чужой, хотя массив настоящий.',
    href: '/js/object-model/#s3',
    hrefLabel: '«Объектная модель», раздел «Наследование и instanceof»',
    tone: 'info',
  },
  {
    t: 'Код переписывают до запуска',
    d: 'Тестовый файл не исполняется как написан: Jest пропускает его через Babel, Vitest — через конвейер Vite. Так в нём меняется порядок строк.',
    href: '/tooling/transpilation/#s2',
    hrefLabel: '«Транспиляция и полифилы», раздел «От запроса к плагинам»',
    tone: 'info',
  },
];

// ─── Раздел 1. Сбор, потом исполнение ──────────────────────────────────────────────────────

/** Какие файлы раннер считает тестами без конфига. Сняты `vitest list --filesOnly` и `jest --listTests`. */
export const FIND_ROWS: { file: string; vitest: boolean; jest: boolean }[] = [
  { file: 'src/cart.test.js', vitest: true, jest: true },
  { file: 'src/cart.spec.ts', vitest: true, jest: true },
  { file: 'src/Cart.test.tsx', vitest: true, jest: true },
  { file: 'src/utils/format.test.mjs', vitest: true, jest: true },
  { file: 'src/e2e.spec.cjs', vitest: true, jest: true },
  { file: 'src/__tests__/price.js', vitest: false, jest: true },
  { file: 'src/__tests__/helpers.js', vitest: false, jest: true },
  { file: 'src/cart.tests.js', vitest: false, jest: false },
  { file: 'src/cart_test.js', vitest: false, jest: false },
  { file: 'dist/cart.test.js', vitest: true, jest: true },
  { file: 'node_modules/lib/x.test.js', vitest: false, jest: false },
];

export const FIND_PATTERNS = {
  vitest: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  vitestExclude: ['**/node_modules/**', '**/.git/**'],
  jest: ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
  jestIgnore: ['/node_modules/'],
};

export const FIND_NOTE =
  'Поиск — это просто шаблоны путей. У Vitest шаблон один: `*.test.*` или `*.spec.*`. Jest вдобавок берёт **любой** файл в папке `__tests__` — и вспомогательный `helpers.js` там станет «тестом без тестов» и упадёт. Собранная папка `dist/` по умолчанию не исключена ни у того, ни у другого: тест, попавший в сборку, запустится дважды.';

/** Сквозная фикстура раздела. `log` дописывает строку в журнал — так виден порядок. */
export const HOOKS_FIXTURE = `log('сбор: начало файла');
beforeAll(() => log('beforeAll внешний'));
beforeEach(() => log('beforeEach внешний'));
afterEach(() => log('afterEach внешний'));
afterAll(() => log('afterAll внешний'));

test('A', () => log('тест A'));

describe('корзина', () => {
  log('сбор: тело describe');
  beforeAll(() => log('beforeAll внутренний'));
  beforeEach(() => log('beforeEach внутренний'));
  afterEach(() => log('afterEach внутренний'));
  afterAll(() => log('afterAll внутренний'));
  test('B', () => log('тест B'));
  test('C', () => log('тест C'));
});

test('D', () => log('тест D'));
log('сбор: конец файла');`;

export const NESTED_FIXTURE = `log('сбор: файл, начало');
describe('X', () => {
  log('сбор: X, начало');
  describe('Y', () => {
    log('сбор: Y');
    describe('Z', () => {
      log('сбор: Z');
      test('z', () => log('тест z'));
    });
    test('y', () => log('тест y'));
  });
  log('сбор: X, конец');
  test('x', () => log('тест x'));
});
describe('W', () => {
  log('сбор: W');
  test('w', () => log('тест w'));
});
log('сбор: файл, конец');`;

export const TWO_HOOKS_FIXTURE = `beforeAll(() => log('beforeAll 1'));
beforeAll(() => log('beforeAll 2'));
beforeEach(() => log('beforeEach 1'));
beforeEach(() => log('beforeEach 2'));
afterEach(() => log('afterEach 1'));
afterEach(() => log('afterEach 2'));
afterAll(() => log('afterAll 1'));
afterAll(() => log('afterAll 2'));
test('T', () => log('тест T'));`;

/** Та же сквозная фикстура, но внутренний `beforeEach` бросает. Тест проверяет, что замена сработала. */
export const EACH_FAILS_FIXTURE = HOOKS_FIXTURE.replace(
  "beforeEach(() => log('beforeEach внутренний'));",
  "beforeEach(() => {\n    log('beforeEach внутренний');\n    throw new Error('нет базы');\n  });",
);

export const ALL_FAILS_FIXTURE = HOOKS_FIXTURE.replace(
  "beforeAll(() => log('beforeAll внутренний'));",
  "beforeAll(() => {\n    log('beforeAll внутренний');\n    throw new Error('нет базы');\n  });",
);

/** Первый хук каждого вида бросает: видно, кто зовёт оставшиеся. */
export const THROWS_FIXTURE = `beforeAll(() => { log('beforeAll 1'); throw new Error('x'); });
beforeAll(() => log('beforeAll 2'));
beforeEach(() => { log('beforeEach 1'); throw new Error('x'); });
beforeEach(() => log('beforeEach 2'));
afterEach(() => { log('afterEach 1'); throw new Error('x'); });
afterEach(() => log('afterEach 2'));
afterAll(() => { log('afterAll 1'); throw new Error('x'); });
afterAll(() => log('afterAll 2'));
test('T', () => log('тест T'));`;

/** Журналы настоящих раннеров на фикстурах выше. Пересобираются тестом. */
export const REAL: Record<string, Record<RunnerName, RealRun>> = {
  hooks: {
    vitest: {
      log: [
        'сбор: начало файла',
        'сбор: конец файла',
        'сбор: тело describe',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'тест B',
        'afterEach внутренний',
        'afterEach внешний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'тест C',
        'afterEach внутренний',
        'afterEach внешний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'pass' }, { name: 'C', state: 'pass' }, { name: 'D', state: 'pass' }],
    },
    jest: {
      log: [
        'сбор: начало файла',
        'сбор: тело describe',
        'сбор: конец файла',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'тест B',
        'afterEach внутренний',
        'afterEach внешний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'тест C',
        'afterEach внутренний',
        'afterEach внешний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'pass' }, { name: 'C', state: 'pass' }, { name: 'D', state: 'pass' }],
    },
  },
  nested: {
    vitest: {
      log: [
        'сбор: файл, начало',
        'сбор: файл, конец',
        'сбор: X, начало',
        'сбор: X, конец',
        'сбор: Y',
        'сбор: Z',
        'сбор: W',
        'тест z',
        'тест y',
        'тест x',
        'тест w',
      ],
      results: [{ name: 'z', state: 'pass' }, { name: 'y', state: 'pass' }, { name: 'x', state: 'pass' }, { name: 'w', state: 'pass' }],
    },
    jest: {
      log: [
        'сбор: файл, начало',
        'сбор: X, начало',
        'сбор: Y',
        'сбор: Z',
        'сбор: X, конец',
        'сбор: W',
        'сбор: файл, конец',
        'тест z',
        'тест y',
        'тест x',
        'тест w',
      ],
      results: [{ name: 'z', state: 'pass' }, { name: 'y', state: 'pass' }, { name: 'x', state: 'pass' }, { name: 'w', state: 'pass' }],
    },
  },
  two: {
    vitest: {
      log: [
        'beforeAll 1',
        'beforeAll 2',
        'beforeEach 1',
        'beforeEach 2',
        'тест T',
        'afterEach 2',
        'afterEach 1',
        'afterAll 2',
        'afterAll 1',
      ],
      results: [{ name: 'T', state: 'pass' }],
    },
    jest: {
      log: [
        'beforeAll 1',
        'beforeAll 2',
        'beforeEach 1',
        'beforeEach 2',
        'тест T',
        'afterEach 1',
        'afterEach 2',
        'afterAll 1',
        'afterAll 2',
      ],
      results: [{ name: 'T', state: 'pass' }],
    },
  },
  'each-fails': {
    vitest: {
      log: [
        'сбор: начало файла',
        'сбор: конец файла',
        'сбор: тело describe',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'afterEach внутренний',
        'afterEach внешний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'afterEach внутренний',
        'afterEach внешний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'fail' }, { name: 'C', state: 'fail' }, { name: 'D', state: 'pass' }],
    },
    jest: {
      log: [
        'сбор: начало файла',
        'сбор: тело describe',
        'сбор: конец файла',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'afterEach внутренний',
        'afterEach внешний',
        'beforeEach внешний',
        'beforeEach внутренний',
        'afterEach внутренний',
        'afterEach внешний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'fail' }, { name: 'C', state: 'fail' }, { name: 'D', state: 'pass' }],
    },
  },
  'all-fails': {
    vitest: {
      log: [
        'сбор: начало файла',
        'сбор: конец файла',
        'сбор: тело describe',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'skip' }, { name: 'C', state: 'skip' }, { name: 'D', state: 'pass' }],
    },
    jest: {
      log: [
        'сбор: начало файла',
        'сбор: тело describe',
        'сбор: конец файла',
        'beforeAll внешний',
        'beforeEach внешний',
        'тест A',
        'afterEach внешний',
        'beforeAll внутренний',
        'afterEach внутренний',
        'afterEach внешний',
        'afterEach внутренний',
        'afterEach внешний',
        'afterAll внутренний',
        'beforeEach внешний',
        'тест D',
        'afterEach внешний',
        'afterAll внешний',
      ],
      results: [{ name: 'A', state: 'pass' }, { name: 'B', state: 'fail' }, { name: 'C', state: 'fail' }, { name: 'D', state: 'pass' }],
    },
  },
  throws: {
    vitest: {
      log: [
        'beforeAll 1',
        'afterAll 2',
        'afterAll 1',
      ],
      results: [{ name: 'T', state: 'skip' }],
    },
    jest: {
      log: [
        'beforeAll 1',
        'beforeAll 2',
        'afterEach 1',
        'afterEach 2',
        'afterAll 1',
        'afterAll 2',
      ],
      results: [{ name: 'T', state: 'fail' }],
    },
  },
};

export const SCENARIOS: Scenario[] = [
  {
    id: 'hooks',
    label: 'Порядок хуков',
    code: HOOKS_FIXTURE,
    note: 'Сквозная фикстура: хуки на уровне файла, блок `корзина` со своими хуками, тесты до и после блока.',
    real: REAL.hooks,
  },
  {
    id: 'nested',
    label: 'Вложенные describe',
    code: NESTED_FIXTURE,
    note: 'Три уровня вложенности. Тесты идут в одном порядке у обоих, а тела блоков — в разном.',
    real: REAL.nested,
  },
  {
    id: 'two',
    label: 'Два хука в блоке',
    code: TWO_HOOKS_FIXTURE,
    note: 'По два хука каждого вида в одном блоке. Смотрите на порядок `afterEach` и `afterAll`.',
    real: REAL.two,
  },
  {
    id: 'each-fails',
    label: 'Падает beforeEach',
    code: EACH_FAILS_FIXTURE,
    note: 'Внутренний `beforeEach` бросает ошибку. Тела тестов B и C не запускаются, а `afterEach` — запускаются.',
    real: REAL['each-fails'],
  },
  {
    id: 'all-fails',
    label: 'Падает beforeAll',
    code: ALL_FAILS_FIXTURE,
    note: 'Внутренний `beforeAll` бросает ошибку. Здесь раннеры расходятся сильнее всего.',
    real: REAL['all-fails'],
  },
  {
    id: 'throws',
    label: 'Бросает каждый хук',
    code: THROWS_FIXTURE,
    note: 'Первый хук каждого вида бросает ошибку. Кто после этого зовёт второй хук того же вида, а кто — нет?',
    real: REAL.throws,
  },
];

export const HOOKS_NOTE =
  'Строки `сбор: …` напечатаны раньше всех хуков: раннер сначала исполнил файл целиком и только записал, что в нём объявлено. Хуки внешнего блока обнимают и тесты вложенного: `beforeEach внешний` стоит перед `beforeEach внутренний`, а `afterEach` идут в обратную сторону — от внутреннего к внешнему. `beforeAll` внутреннего блока ждёт, пока до блока дойдёт очередь: он идёт после теста A.';

export const PLAIN_TWO_PHASES =
  'Как список покупок. Пока вы пишете список, в магазин никто не идёт: строчка «молоко» — это запись, а не действие. Магазин начинается, когда список готов. Код внутри `test(…)` — такая же строчка в списке: при сборе раннер только запоминает функцию, а вызывает её во второй фазе.';

/**
 * Учебный раннер: сбор дерева и исполнение с хуками. Демо и тест исполняют эту строку;
 * тест сверяет журнал и итоги с настоящими Vitest и Jest на всех фикстурах `SCENARIOS`.
 */
export const RUNNER_CODE = `// Где два раннера расходятся — три переключателя.
const FLAVORS = {
  vitest: { lazyDescribe: true, afterHooks: 'stack', beforeAllFails: 'skip' },
  jest: { lazyDescribe: false, afterHooks: 'list', beforeAllFails: 'fail' },
};

// Фаза 1 — сбор. Файл исполняется, describe и test только записывают узлы дерева.
function collect(file, flavor) {
  const newSuite = (name, body) => ({
    kind: 'suite', name, body, children: [],
    beforeAll: [], beforeEach: [], afterEach: [], afterAll: [],
  });
  const root = newSuite('файл', file);
  let current = root;

  function enter(suite) {
    const parent = current;
    current = suite;
    try { suite.body(api); } finally { current = parent; }
    // vitest открывает вложенные describe, когда тело родителя уже доработало
    if (flavor.lazyDescribe) {
      for (const child of suite.children) if (child.kind === 'suite') enter(child);
    }
  }

  const api = {
    describe(name, body) {
      const suite = newSuite(name, body);
      current.children.push(suite);
      if (!flavor.lazyDescribe) enter(suite);   // jest: тело — сразу
    },
    test(name, fn) { current.children.push({ kind: 'test', name, fn }); },
    beforeAll(fn) { current.beforeAll.push(fn); },
    beforeEach(fn) { current.beforeEach.push(fn); },
    afterEach(fn) { current.afterEach.push(fn); },
    afterAll(fn) { current.afterAll.push(fn); },
  };
  enter(root);
  return root;
}

// Фаза 2 — исполнение. Обход дерева с хуками вокруг каждого теста.
async function run(root, flavor) {
  const results = [];
  const after = (list) => (flavor.afterHooks === 'stack' ? [...list].reverse() : list);
  const attempt = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

  async function runTest(test, chain, broken) {
    let error = broken;
    // beforeEach — от внешнего блока к внутреннему, до первой ошибки
    for (const suite of chain) {
      for (const hook of suite.beforeEach) if (!error) error = await attempt(hook);
    }
    if (!error) error = await attempt(test.fn);
    // afterEach — от внутреннего к внешнему, и все, даже после ошибки
    for (const suite of [...chain].reverse()) {
      for (const hook of after(suite.afterEach)) error = (await attempt(hook)) ?? error;
    }
    results.push(error
      ? { name: test.name, state: 'fail', error: String(error.message ?? error) }
      : { name: test.name, state: 'pass' });
  }

  function skipAll(suite) {
    for (const child of suite.children) {
      if (child.kind === 'suite') skipAll(child);
      else results.push({ name: child.name, state: 'skip' });
    }
  }

  async function runSuite(suite, chain, broken) {
    for (const hook of suite.beforeAll) {
      if (broken && flavor.beforeAllFails === 'skip') break;
      broken = (await attempt(hook)) ?? broken;
    }
    if (broken && flavor.beforeAllFails === 'skip') {
      skipAll(suite);                               // vitest: тесты блока пропущены
    } else {
      for (const child of suite.children) {
        if (child.kind === 'suite') await runSuite(child, [...chain, child], broken);
        else await runTest(child, chain, broken);   // jest: тест упадёт, не начавшись
      }
    }
    for (const hook of after(suite.afterAll)) await attempt(hook);
  }

  await runSuite(root, [root], null);
  return results;
}`;

export const RUNNER_NOTE =
  'Сбор — это обычный вызов функций: `describe` кладёт узел в дерево и заходит в него, `test` кладёт лист. Исполнение — обход того же дерева. Цепочка `chain` — путь от файла до текущего блока: по ней и собираются `beforeEach` и `afterEach` всех уровней. Три различия раннеров сведены в `FLAVORS`, всё остальное у Vitest и Jest совпадает.';

export const DEMO_CAPTION =
  'Обе колонки считает `RUNNER_CODE` выше: та же фикстура, разные `FLAVORS`. Выделены строки, которых нет в журнале соседа или которые стоят у него в другом месте. Отметка под колонкой сравнивает ответ учебного раннера с журналом, который на этой же фикстуре выдал настоящий раннер.';

export const DIFF_ROWS = [
  {
    k: 'Тело `describe`',
    v: 'Исполняется, когда доработало тело родителя: сначала весь файл, потом блоки по порядку.',
    j: 'Исполняется сразу, в момент вызова `describe`.',
  },
  {
    k: 'Два `afterEach` или `afterAll` в одном блоке',
    v: 'В обратном порядке, как стек: последний объявленный — первым.',
    j: 'В порядке объявления.',
  },
  {
    k: '`beforeAll` бросил ошибку',
    v: 'Следующие `beforeAll` блока не зовутся. Тесты блока **пропущены** (`skipped`), их `beforeEach` и `afterEach` не зовутся. `afterAll` зовутся.',
    j: 'Следующие `beforeAll` зовутся. Тесты блока **провалены** без запуска тела, `beforeEach` не зовутся, а `afterEach` — зовутся. `afterAll` зовутся.',
  },
  {
    k: '`beforeEach` бросил ошибку',
    v: 'Одинаково: следующие `beforeEach` не зовутся, тело теста не запускается, все `afterEach` зовутся, тест провален.',
    j: 'То же самое.',
  },
];

export const DIFF_NOTE =
  'Отсюда практическое правило: тест, которому важно, в каком порядке выполнились два `afterEach` одного блока, переносится между раннерами с ошибкой. Порядок между блоками — внутренний `afterEach` раньше внешнего — у обоих одинаковый, на него опираться можно.';

// ─── Раздел 2. Изоляция ────────────────────────────────────────────────────────────────────

export const PLAIN_ISOLATION =
  'Как экзамен в отдельных аудиториях. Каждый файл сдаёт в своей комнате со своим комплектом бумаги — что он исписал, следующий не увидит. А тесты одного файла сидят за одной партой и пишут на одних листах: что первый оставил на столе, второй найдёт.';

export const COUNTER_CODE = `let n = 0;
module.exports = { inc: () => ++n };`;

/** Тестовый файл изоляции. Второй файл (`b.test.js`) — тот же текст с буквой `b`. */
export const isoTest = (name: string) => `const { inc } = require('./counter.js');

test('${name}1', () => {
  record('${name}1', inc(), globalThis.marker, process.env.MARKER, Array.prototype.marker);
  globalThis.marker = '${name}';
  process.env.MARKER = '${name}';
  Array.prototype.marker = '${name}';
});

test('${name}2', () => {
  record('${name}2', inc(), globalThis.marker, process.env.MARKER, Array.prototype.marker);
});`;

export const ISO_TEST_CODE = isoTest('a');

/** Что увидел **первый тест второго файла** при одном воркере. Пересобирается тестом. */
export const ISO_ROWS: GenIsoRow[] = [
  {
    "k": "Vitest, пул `forks` (по умолчанию)",
    "runner": "vitest",
    "flags": [
      "--maxWorkers=1"
    ],
    "counter": 1,
    "global": false,
    "env": false,
    "proto": false,
    "sameProcess": false
  },
  {
    "k": "Vitest, `--pool=threads`",
    "runner": "vitest",
    "flags": [
      "--maxWorkers=1",
      "--pool=threads"
    ],
    "counter": 1,
    "global": false,
    "env": false,
    "proto": false,
    "sameProcess": true
  },
  {
    "k": "Vitest, `--pool=vmThreads`",
    "runner": "vitest",
    "flags": [
      "--maxWorkers=1",
      "--pool=vmThreads"
    ],
    "counter": 1,
    "global": false,
    "env": true,
    "proto": false,
    "sameProcess": true
  },
  {
    "k": "Vitest, `--no-isolate`",
    "runner": "vitest",
    "flags": [
      "--maxWorkers=1",
      "--no-isolate"
    ],
    "counter": 3,
    "global": true,
    "env": true,
    "proto": true,
    "sameProcess": true
  },
  {
    "k": "Jest, `--runInBand`",
    "runner": "jest",
    "flags": [
      "--runInBand"
    ],
    "counter": 1,
    "global": false,
    "env": false,
    "proto": false,
    "sameProcess": true
  }
];

export interface GenIsoRow {
  /** Как запущено. */
  k: string;
  runner: RunnerName;
  flags: string[];
  /** Значение счётчика в первом тесте второго файла: 1 — модуль свежий. */
  counter: number;
  /** Увидел ли второй файл метку первого. */
  global: boolean;
  env: boolean;
  proto: boolean;
  /** Тот же процесс, что у первого файла. */
  sameProcess: boolean;
}

export const ISO_NOTE =
  'Внутри одного файла утечка есть всегда: второй тест получает счётчик `2` и все три метки первого. Модуль `counter.js` исполнился один раз на файл, и оба теста держат один и тот же экземпляр. Между файлами по умолчанию не течёт ничего — но по разным причинам. Vitest в режиме `forks` заводит новый процесс на каждый файл. Jest остаётся в одном процессе, но исполняет каждый файл в новом vm-контексте и со своим реестром модулей.';

/** Учебный загрузчик: реестр модулей на файл, моки и подъём. Сверяется тестом с Jest. */
export const MODULES_CODE = `// Учебный загрузчик CommonJS. Раннер заводит такой на каждый тестовый файл.
function createModuleSystem(files, globals) {
  const registry = new Map();     // путь → exports: модуль исполняется один раз
  const factories = new Map();    // путь → фабрика мока

  const jest = {
    ...globals.jest,
    mock(path, factory) { factories.set(path, factory); },
  };

  function require(path) {
    if (registry.has(path)) return registry.get(path);
    if (factories.has(path)) {
      const exports = factories.get(path)();   // мок: файл не исполняется вовсе
      registry.set(path, exports);
      return exports;
    }
    const module = { exports: {} };
    registry.set(path, module.exports);
    const names = Object.keys(globals);
    const body = new Function('module', 'exports', 'require', ...names, files[path]);
    body(module, module.exports, require, ...names.map((n) => (n === 'jest' ? jest : globals[n])));
    registry.set(path, module.exports);
    return module.exports;
  }

  return { require, registry };
}

// Подъём моков: вызовы jest.mock(...) переезжают в начало файла, выше всех require.
function hoistMocks(source) {
  const calls = source.match(/^jest\\.mock\\([\\s\\S]*?\\);$/gm) ?? [];
  const rest = calls.reduce((code, call) => code.replace(call, ''), source);
  return [...calls, rest].join('\\n');
}`;

export const MODULES_NOTE =
  'Весь секрет изоляции — в том, **сколько таких `registry` живёт**. Один на файл — и `counter.js` в каждом файле начинается с нуля. Один на всех — и второй файл получит счётчик `3`, как Vitest с `--no-isolate`. Тест темы прогоняет фикстуру изоляции через этот загрузчик в обоих вариантах и получает те же числа, что настоящие раннеры. Глобальный объект учебный загрузчик не подменяет — это делает vm-контекст.';

export const REALM_FIXTURE = `test('realm', () => {
  const fs = process.getBuiltinModule('node:fs');
  const list = fs.readdirSync('.');
  log(\`readdirSync instanceof Array: \${list instanceof Array}\`);
  log(\`Array.isArray: \${Array.isArray(list)}\`);
  let err;
  try { fs.readFileSync('/нет-такого-файла'); } catch (e) { err = e; }
  log(\`ошибка fs instanceof Error: \${err instanceof Error}\`);
  log(\`Error.isError: \${Error.isError(err)}\`);
});`;

/** Журнал фикстуры `REALM_FIXTURE`. Пересобирается тестом. */
export const REALM_LOG: Record<RunnerName, string[]> = {
  "vitest": [
    "readdirSync instanceof Array: true",
    "Array.isArray: true",
    "ошибка fs instanceof Error: true",
    "Error.isError: true"
  ],
  "jest": [
    "readdirSync instanceof Array: false",
    "Array.isArray: true",
    "ошибка fs instanceof Error: false",
    "Error.isError: true"
  ]
};

export const REALM_NOTE =
  'Массив и ошибку создал сам Node — в своём, главном мире. Тест в Jest живёт в vm-контексте со своими `Array` и `Error`, и для его `instanceof` эти объекты чужие. Так ломаются `expect(…).toBeInstanceOf(Error)` и `catch (e) { if (e instanceof Error) … }` на ошибках из `fs`, `http` и нативных модулей. Проверки по устройству — `Array.isArray` и `Error.isError` — работают везде. Vitest с пулом `vmThreads` устроен так же, как Jest, и ведёт себя так же.';

// ─── Раздел 3. Моки модулей ────────────────────────────────────────────────────────────────

export const PRICE_CODE = `export function total(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}`;

export const CART_CODE = `import { total } from './price.js';

export function checkout(items) {
  const sum = total(items);
  if (sum > 500) throw new Error(\`Лимит превышен: \${sum}\`);
  return \`К оплате: \${sum}\`;
}`;

export const MOCK_TEST_VITEST = `import { expect, test, vi } from 'vitest';
import { checkout } from './cart.js';
import { total } from './price.js';

vi.mock('./price.js', () => ({ total: vi.fn(() => 999) }));

test('сумма больше лимита', () => {
  expect(() => checkout([])).toThrow('Лимит превышен: 999');
  expect(total).toHaveBeenCalledTimes(1);
  expect(total.mock.calls).toEqual([[[]]]);
});`;

/** Тот же файл, каким его исполнил Vitest. Снят `VITEST_DEBUG_DUMP`, пересобирается тестом. */
export const VITEST_TRANSFORM = `const __vite_ssr_import_0__ = await __vite_ssr_import__("/@fs/…/node_modules/vitest/dist/index.js", {"importedNames":["expect","test","vi"]});
__vite_ssr_import_0__.vi.mock('./price.js', () => ({ total: __vite_ssr_import_0__.vi.fn(() => 999) }));
const __vi_import_0__ = await __vite_ssr_dynamic_import__("/cart.js");
const __vi_import_1__ = await __vite_ssr_dynamic_import__("/price.js");

(0,__vite_ssr_import_0__.test)('сумма больше лимита', () => {
  (0,__vite_ssr_import_0__.expect)(() => __vi_import_0__.checkout([])).toThrow('Лимит превышен: 999');
  (0,__vite_ssr_import_0__.expect)(__vi_import_1__.total).toHaveBeenCalledTimes(1);
  (0,__vite_ssr_import_0__.expect)(__vi_import_1__.total.mock.calls).toEqual([[[]]]);
});`;

export const PRICE_CJS = `function total(items) {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
module.exports = { total };`;

export const CART_CJS = `const { total } = require('./price.js');

function checkout(items) {
  const sum = total(items);
  if (sum > 500) throw new Error(\`Лимит превышен: \${sum}\`);
  return \`К оплате: \${sum}\`;
}
module.exports = { checkout };`;

export const MOCK_TEST_JEST = `const { checkout } = require('./cart.js');
const { total } = require('./price.js');

jest.mock('./price.js', () => ({ total: jest.fn(() => 999) }));

test('сумма больше лимита', () => {
  expect(() => checkout([])).toThrow('Лимит превышен: 999');
  expect(total).toHaveBeenCalledTimes(1);
  expect(total.mock.calls).toEqual([[[]]]);
});`;

/** Тот же файл после babel-jest. Снят из `--cacheDirectory`, пересобирается тестом. */
export const JEST_TRANSFORM = `_getJestObj().mock('./price.js', () => ({
  total: jest.fn(() => 999)
}));
function _getJestObj() {
  const {
    jest
  } = require("@jest/globals");
  _getJestObj = () => jest;
  return jest;
}
const {
  checkout
} = require('./cart.js');
const {
  total
} = require('./price.js');
test('сумма больше лимита', () => {
  expect(() => checkout([])).toThrow('Лимит превышен: 999');
  expect(total).toHaveBeenCalledTimes(1);
  expect(total.mock.calls).toEqual([[[]]]);
});`;

export const HOIST_STEPS = [
  {
    k: 'Почему мок нельзя оставить на месте',
    d: 'Строка `import { checkout } from \'./cart.js\'` выполняется раньше любой строки тела файла: так устроены модули. К моменту, когда дело дошло бы до `vi.mock`, `cart.js` уже загрузил настоящий `price.js` и держит его `total`. Подменять в реестре поздно — запись уже занята.',
  },
  {
    k: 'Что делает Vitest',
    d: 'Ставит `vi.mock` первой строкой, а статические `import` превращает в `await __vite_ssr_dynamic_import__(…)` **после** него. Импорт стал обычным выражением и выполняется по порядку — уже когда мок записан.',
  },
  {
    k: 'Что делает Jest',
    d: 'Babel-плагин `babel-plugin-jest-hoist` поднимает `jest.mock` выше всех `require`. Сами `require` и так выполняются по порядку: это вызовы функции, а не объявления. `jest` при этом берётся из `@jest/globals` ленивой функцией `_getJestObj`.',
  },
  {
    k: 'Что происходит при импорте',
    d: '`cart.js` просит `./price.js`. Загрузчик тестового файла сначала смотрит в таблицу моков, находит фабрику, вызывает её и кладёт результат в реестр. Настоящий `price.js` не исполняется ни разу.',
  },
];

export const HOIST_NOTE =
  'Учебный `hoistMocks` из раздела про изоляцию делает то же, что Babel, — грубо, по регулярному выражению. Тест темы исполняет фикстуру Jest через `createModuleSystem` дважды. Без подъёма тест падает: `checkout([])` возвращает `К оплате: 0`, потому что `cart.js` успел взять настоящий `total`. С подъёмом — проходит.';

export const TDZ_VITEST = `import { expect, test, vi } from 'vitest';
import { checkout } from './cart.js';

const total = vi.fn(() => 999);
vi.mock('./price.js', () => ({ total }));`;

export const TDZ_JEST = `const { checkout } = require('./cart.js');

const total = jest.fn(() => 999);
jest.mock('./price.js', () => ({ total: total }));`;

export const TDZ_JEST_PREFIX = `const { checkout } = require('./cart.js');

const mockTotal = jest.fn(() => 999);
jest.mock('./price.js', () => ({ total: mockTotal }));`;

/** Первые строки ошибок. Пересобираются тестом. */
export const TDZ_ERRORS: { vitest: string; jest: string; jestPrefix: string } = {
  "vitest": "Caused by: ReferenceError: Cannot access 'total' before initialization",
  "jest": "The module factory of `jest.mock()` is not allowed to reference any out-of-scope variables.",
  "jestPrefix": "ReferenceError: Cannot access 'mockTotal' before initialization"
};

export const FIX_VITEST = `import { expect, test, vi } from 'vitest';
import { checkout } from './cart.js';

// vi.hoisted поднимается вместе с vi.mock — и раньше него
const { total } = vi.hoisted(() => ({ total: vi.fn(() => 999) }));
vi.mock('./price.js', () => ({ total }));`;

export const FIX_JEST = `const { checkout } = require('./cart.js');

const mockTotal = jest.fn(() => 999);
// фабрика не читает mockTotal сразу — только когда total вызовут
jest.mock('./price.js', () => ({ total: (...args) => mockTotal(...args) }));`;

/** Хвост обеих исправленных фикстур: тот же тест, что выше. */
export const FIX_TAIL = `

test('сумма больше лимита', () => {
  expect(() => checkout([])).toThrow('Лимит превышен: 999');
});`;

export const TDZ_NOTE =
  'Подъём переносит строку, но не переменные, которые она читает. Фабрика вызывается при импорте `cart.js` — а это теперь самое начало файла, когда `const total` ещё не выполнилась. Jest ловит это заранее, при переписывании: фабрике запрещено трогать внешние имена, кроме глобальных и тех, что начинаются с `mock`. Префикс `mock` — обещание «я прочитаю её позже», а не защита: прочитаете сразу — получите ту же ошибку, только уже при запуске.';

// ─── Раздел 4. Шпионы ──────────────────────────────────────────────────────────────────────

export const SPY_CODE = `// Шпион: функция, которая записывает каждый вызов, а потом зовёт настоящую реализацию.
function fn(impl = () => undefined) {
  const mock = { calls: [], results: [], contexts: [] };
  function spy(...args) {
    mock.calls.push(args);
    mock.contexts.push(this);
    // Запись результата появляется до вызова: рекурсивный вызов видит её «незавершённой»
    const result = { type: 'incomplete', value: undefined };
    mock.results.push(result);
    try {
      result.value = impl.apply(this, args);
      result.type = 'return';
      return result.value;
    } catch (error) {
      result.type = 'throw';
      result.value = error;
      throw error;
    }
  }
  spy.mock = mock;
  spy._isMockFunction = true;             // по этому флагу expect узнаёт шпиона
  spy.getMockName = () => 'spy';
  return spy;
}

// spyOn: подменить метод объекта шпионом, который зовёт оригинал.
function spyOn(object, key) {
  const original = object[key];
  const spy = fn(original);
  spy.mockRestore = () => { object[key] = original; };
  object[key] = spy;
  return spy;
}`;

export const SPY_FIXTURE = `test('шпион', () => {
  const price = T.fn((qty) => {
    if (qty < 0) throw new Error('минус');
    return qty * 250;
  });
  price(2);
  price(1);
  try { price(-1); } catch {}
  log(JSON.stringify(price.mock.calls));
  log(JSON.stringify(price.mock.results.map((r) => [r.type, r.type === 'throw' ? r.value.message : r.value])));
  log(Object.keys(price.mock).sort().join(', '));

  const max = T.spyOn(Math, 'max');
  Math.max(1, 5);
  log(JSON.stringify(max.mock.calls));
  max.mockRestore();
  log(String(T.isMockFunction(Math.max)));
});`;

/** Журнал `SPY_FIXTURE`. Пересобирается тестом. */
export const SPY_LOG: Record<RunnerName, string[]> = {
  "vitest": [
    "[[2],[1],[-1]]",
    "[[\"return\",500],[\"return\",250],[\"throw\",\"минус\"]]",
    "calls, contexts, instances, invocationCallOrder, lastCall, results, settledResults",
    "[[1,5]]",
    "false"
  ],
  "jest": [
    "[[2],[1],[-1]]",
    "[[\"return\",500],[\"return\",250],[\"throw\",\"минус\"]]",
    "calls, contexts, instances, invocationCallOrder, lastCall, results",
    "[[1,5]]",
    "false"
  ]
};

export const SPY_NOTE =
  '`expect(total).toHaveBeenCalledTimes(1)` — это просто `total.mock.calls.length === 1`, проверенное с красивым сообщением. Никакой магии в шпионе нет: массивы, которые растут при каждом вызове. Поэтому они и **копятся**: шпион, созданный на уровне файла, помнит вызовы всех предыдущих тестов, пока его не очистят — `mockClear()` вручную или `clearMocks: true` в конфиге.';

// ─── Раздел 5. Фейковые таймеры ────────────────────────────────────────────────────────────

export const PLAIN_FAKE_TIMERS =
  'Как настольная игра с колодой событий вместо часов. Каждое `setTimeout` кладёт карточку «в 100 мс: сделать A». Время само не идёт: оно сдвигается, только когда игрок говорит «прошло 50 мс», — и тогда открываются все карточки до этой отметки, по порядку.';

/** `T` — это `vi` у Vitest и `jest` у Jest: имена методов совпадают. */
export const TIMERS_FIXTURE = `test('очередь таймеров', () => {
  T.useFakeTimers({ now: 0 });
  const at = (s) => log(\`\${Date.now()} мс: \${s}\`);
  setTimeout(() => at('A (100)'), 100);
  setTimeout(() => at('B (50)'), 50);
  const id = setInterval(() => at('C (каждые 40)'), 40);
  setTimeout(() => {
    at('D (50)');
    setTimeout(() => at('E (0, из D)'), 0);
  }, 50);
  log(\`в очереди: \${T.getTimerCount()}\`);
  T.advanceTimersByTime(120);
  log(\`после 120 мс в очереди: \${T.getTimerCount()}\`);
  clearInterval(id);
  T.useRealTimers();
});

test('микрозадачи между таймерами', async () => {
  T.useFakeTimers({ now: 0 });
  for (const mode of ['sync', 'async']) {
    setTimeout(() => {
      log(\`\${mode}: таймер 10\`);
      Promise.resolve().then(() => log(\`\${mode}: then из таймера 10\`));
    }, 10);
    setTimeout(() => log(\`\${mode}: таймер 20\`), 20);
    if (mode === 'sync') T.advanceTimersByTime(30);
    else await T.advanceTimersByTimeAsync(30);
    log(\`\${mode}: вернулись из прокрутки\`);
    await Promise.resolve();
  }
  T.useRealTimers();
});

test('runAllTimers и вечный интервал', () => {
  T.useFakeTimers({ now: 0 });
  setInterval(() => {}, 10);
  try { T.runAllTimers(); } catch (e) { log(\`ошибка: \${e.message.split('\\n')[0]}\`); }
  log(\`часы: \${Date.now()}\`);
  T.useRealTimers();
});`;

/** Журнал `TIMERS_FIXTURE`. Пересобирается тестом. */
export const TIMERS_LOG: Record<RunnerName, string[]> = {
  "vitest": [
    "в очереди: 4",
    "40 мс: C (каждые 40)",
    "50 мс: B (50)",
    "50 мс: D (50)",
    "51 мс: E (0, из D)",
    "80 мс: C (каждые 40)",
    "100 мс: A (100)",
    "120 мс: C (каждые 40)",
    "после 120 мс в очереди: 1",
    "sync: таймер 10",
    "sync: таймер 20",
    "sync: вернулись из прокрутки",
    "sync: then из таймера 10",
    "async: таймер 10",
    "async: then из таймера 10",
    "async: таймер 20",
    "async: вернулись из прокрутки",
    "ошибка: Aborting after running 10000 timers, assuming an infinite loop!",
    "часы: 100000"
  ],
  "jest": [
    "в очереди: 4",
    "40 мс: C (каждые 40)",
    "50 мс: B (50)",
    "50 мс: D (50)",
    "51 мс: E (0, из D)",
    "80 мс: C (каждые 40)",
    "100 мс: A (100)",
    "120 мс: C (каждые 40)",
    "после 120 мс в очереди: 1",
    "sync: таймер 10",
    "sync: таймер 20",
    "sync: вернулись из прокрутки",
    "sync: then из таймера 10",
    "async: таймер 10",
    "async: then из таймера 10",
    "async: таймер 20",
    "async: вернулись из прокрутки",
    "ошибка: Aborting after running 100000 timers, assuming an infinite loop!",
    "часы: 1000000"
  ]
};

export const CLOCK_CODE = `// Фейковые часы: очередь таймеров и ручная прокрутка. Настоящего времени нет вовсе.
function createClock(start = 0) {
  let now = start;
  let nextId = 1;
  let order = 0;                          // очерёдность среди таймеров на одно время
  let ticking = false;
  const timers = new Map();               // id → { at, order, fn, every }

  function add(fn, delay, every) {
    const id = nextId++;
    // 0 мс, назначенные во время прокрутки, становятся 1 мс — как в @sinonjs/fake-timers
    const ms = delay || (ticking ? 1 : 0);
    timers.set(id, { at: now + ms, order: order++, fn, every: every ? ms : 0 });
    return id;
  }

  // Ближайший таймер не позже limit; при равном времени — кто раньше встал в очередь.
  function next(limit) {
    let best = null;
    for (const [id, t] of timers) {
      if (t.at > limit) continue;
      if (!best || t.at < best.t.at || (t.at === best.t.at && t.order < best.t.order)) best = { id, t };
    }
    return best;
  }

  function fire({ id, t }) {
    now = t.at;
    if (t.every) {                        // интервал встаёт в конец очереди снова
      t.at += t.every;
      t.order = order++;
    } else timers.delete(id);
    t.fn();
  }

  return {
    setTimeout: (fn, ms) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    now: () => now,
    count: () => timers.size,
    pending: () => [...timers]
      .map(([id, t]) => ({ id, at: t.at, every: t.every, order: t.order }))
      .sort((a, b) => a.at - b.at || a.order - b.order),
    // Прокрутить на ms: выполнить по порядку всё, что успевает сработать.
    advance(ms) {
      const end = now + ms;
      ticking = true;
      try {
        for (let n = next(end); n; n = next(end)) fire(n);
      } finally { ticking = false; }
      now = end;
    },
    // Выполнять, пока очередь не опустеет, — с предохранителем от вечного интервала.
    runAll(limit = 10000) {
      ticking = true;
      try {
        for (let i = 0; i < limit; i++) {
          const n = next(Infinity);
          if (!n) return;
          fire(n);
        }
      } finally { ticking = false; }
      throw new Error(\`Aborting after running \${limit} timers, assuming an infinite loop!\`);
    },
  };
}`;

/** Расписание из первого теста `TIMERS_FIXTURE` — на учебных часах. Его открывает демо. */
export const CLOCK_SCENARIO_CODE = `const clock = createClock(0);
const at = (s) => log(\`\${clock.now()} мс: \${s}\`);
clock.setTimeout(() => at('A (100)'), 100);
clock.setTimeout(() => at('B (50)'), 50);
const id = clock.setInterval(() => at('C (каждые 40)'), 40);
clock.setTimeout(() => {
  at('D (50)');
  clock.setTimeout(() => at('E (0, из D)'), 0);
}, 50);`;

/** Подписи таймеров демо по номеру: номера выдаёт `createClock` по порядку. */
export const TIMER_LABELS: Record<number, string> = { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' };

export const CLOCK_CAPTION =
  'Часы и очередь считает `createClock` выше, расписание — `CLOCK_SCENARIO_CODE`. Прокрутка на 120 мс даёт ровно тот журнал, который на первом тесте фикстуры выдали Vitest и Jest. «Выполнить всё» на вечном интервале упирается в предохранитель — как `runAllTimers`.';

export const TIMER_FACTS = [
  {
    t: 'Одно время — порядок постановки',
    d: 'B и D назначены на 50 мс. Сработали в том порядке, в каком их поставили. Интервал C после каждого срабатывания встаёт в очередь заново — уже последним среди таймеров на то же время.',
  },
  {
    t: '`0` внутри прокрутки — это 1 мс',
    d: 'E поставлен с задержкой `0` из колбэка D и сработал на **51** мс, а не на 50. Так делает `@sinonjs/fake-timers`, на котором стоят оба раннера: иначе таймер, ставящий сам себя с нулём, крутился бы на одном месте вечно.',
  },
  {
    t: 'Синхронная прокрутка не пускает промисы',
    d: '`advanceTimersByTime` выполняет все таймеры подряд одним вызовом. `then`, поставленный из таймера 10, ждёт, пока прокрутка вернёт управление, — после таймера 20. `advanceTimersByTimeAsync` между таймерами отдаёт ход микрозадачам, и порядок становится как в жизни.',
    tone: 'warn' as const,
  },
  {
    t: 'Вечный интервал и предохранитель',
    d: '`runAllTimers` крутит, пока очередь не опустеет, а интервал не кончается никогда. Vitest сдаётся после 10 000 срабатываний, Jest — после 100 000. Часы при этом убегают на 100 000 и 1 000 000 мс.',
  },
];

// ─── Раздел 6. Почему тесты текут ──────────────────────────────────────────────────────────

export const LEAK_FIXTURE = `const users = new Map();
function getUser(id) {
  if (!users.has(id)) users.set(id, { id, name: 'гость' });
  return users.get(id);
}

test('новый пользователь — гость', () => {
  log('гость');
  expect(getUser(1).name).toBe('гость');
});

test('переименование', () => {
  log('переименование');
  getUser(1).name = 'Аня';
  expect(getUser(1).name).toBe('Аня');
});

test('сумма', () => {
  log('сумма');
  expect(1 + 1).toBe(2);
});`;

export interface SeedRow {
  runner: RunnerName;
  flags: string[];
  order: string[];
  failed: number;
}

/** Порядок и итог на разных зёрнах. Пересобирается тестом. */
export const SEED_ROWS: SeedRow[] = [
  {
    "runner": "vitest",
    "flags": [],
    "order": [
      "гость",
      "переименование",
      "сумма"
    ],
    "failed": 0
  },
  {
    "runner": "vitest",
    "flags": [
      "--sequence.shuffle",
      "--sequence.seed=2"
    ],
    "order": [
      "переименование",
      "гость",
      "сумма"
    ],
    "failed": 1
  },
  {
    "runner": "vitest",
    "flags": [
      "--sequence.shuffle",
      "--sequence.seed=8"
    ],
    "order": [
      "сумма",
      "гость",
      "переименование"
    ],
    "failed": 0
  },
  {
    "runner": "jest",
    "flags": [],
    "order": [
      "гость",
      "переименование",
      "сумма"
    ],
    "failed": 0
  },
  {
    "runner": "jest",
    "flags": [
      "--randomize",
      "--seed=3"
    ],
    "order": [
      "переименование",
      "гость",
      "сумма"
    ],
    "failed": 1
  },
  {
    "runner": "jest",
    "flags": [
      "--randomize",
      "--seed=4"
    ],
    "order": [
      "гость",
      "сумма",
      "переименование"
    ],
    "failed": 0
  }
];

export const SEED_NOTE =
  'По порядку файл зелёный — и зелёный он только по случайности: тест «гость» успевает пройти до того, как «переименование» испортит общий `users`. Перемешивание это вскрывает. Зерно (`seed`) делает перемешивание повторяемым: раннер печатает его в отчёте, и тот же порядок можно воспроизвести. Номер зерна, на котором падает, у Vitest и Jest свой и может смениться с версией раннера.';

export const OPEN_FIXTURE = `test('A: ставит таймер и не ждёт', () => {
  setTimeout(() => log(\`таймер из A сработал во время: \${expect.getState().currentTestName}\`), 50);
  log('A закончился');
});

test('B: ждёт 300 мс', async () => {
  log('B начался');
  await new Promise((r) => setTimeout(r, 300));
  log('B закончился');
});

test('C: оставляет интервал', () => {
  setInterval(() => {}, 1000);
});`;

/** Журнал `OPEN_FIXTURE` (одинаковый у обоих) и что раннеры сказали в конце. Пересобирается тестом. */
export const OPEN_LOG: string[] = [
  "A закончился",
  "B начался",
  "таймер из A сработал во время: B: ждёт 300 мс",
  "B закончился"
];
export const OPEN_JEST_TAIL = 'Jest did not exit one second after the test run has completed.';

export const LEAK_CAUSES = [
  {
    t: 'Состояние модуля',
    d: '`const users = new Map()` на верхнем уровне файла живёт, пока живёт файл. Лечение — создавать состояние в `beforeEach` или давать модулю функцию сброса.',
  },
  {
    t: 'Глобальные объекты',
    d: '`globalThis`, `process.env`, прототипы. Внутри файла их не защищает никто. Между файлами — зависит от пула: `vmThreads` у Vitest делит `process.env` между файлами одного потока.',
    tone: 'warn' as const,
  },
  {
    t: 'Таймеры, которые никто не ждал',
    d: 'Колбэк из теста A сработал посреди теста B и мог записать в общее состояние уже там. Таймер или соединение, оставленные открытыми, не дают Jest завершиться. Vitest завершается, но колбэк всё равно успевает отработать в чужом тесте.',
    tone: 'err' as const,
  },
  {
    t: 'Записи шпионов и подмены',
    d: '`mock.calls` копятся между тестами, `spyOn` без `mockRestore` оставляет подмену следующему тесту. Конфиг `clearMocks`, `restoreMocks` делает это за вас перед каждым тестом.',
  },
];

export const ISO_HEAD = ['как запущено', 'счётчик', '`globalThis`', '`process.env`', '`Array.prototype`', 'процесс'];

const seen = (v: boolean) => (v ? '**видит** метку `a`' : 'чисто');

/** Таблица изоляции для печати: строится из `ISO_ROWS`, не набирается руками. */
export const ISO_TABLE = ISO_ROWS.map((r) => [
  r.k,
  r.counter === 1 ? '`1` — свежий модуль' : `**\`${r.counter}\`** — модуль первого файла`,
  seen(r.global),
  seen(r.env),
  seen(r.proto),
  r.sameProcess ? 'тот же' : 'новый',
]);

export const ISO_TONES = ISO_ROWS.map((r) => (r.counter > 1 ? ('err' as const) : r.env ? ('warn' as const) : ('ok' as const)));

export const OPEN_NOTE =
  'Тест A закончился, а его таймер — нет. Через 50 мс он сработал, и раннер в этот момент уже считал текущим тест B. Запиши колбэк A что-нибудь в общий массив или шпион — упадёт B, хотя он ни в чём не виноват. Интервал из теста C не даёт процессу завершиться: Jest печатает отчёт, а через секунду — предупреждение и продолжает висеть, пока его не убьют. Vitest по умолчанию завершается: процесс-воркер он закрывает сам.';

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Код в теле `describe` выполняется при сборе',
    d: 'Запрос к базе, `fetch` или чтение файла прямо в `describe` — не подготовка теста, а работа во время сбора, до всех `beforeAll`. Ошибка в нём роняет весь файл. Подготовка — только в хуках.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Порядок двух `afterEach` одного блока у раннеров разный',
    d: 'Vitest зовёт их с конца, Jest — с начала. Уборка, в которой второй хук рассчитывает на работу первого, сломается при переезде. Между блоками порядок общий: внутренний раньше внешнего.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Упавший `beforeAll`: «пропущено» или «провалено»',
    d: 'Vitest пометит тесты блока пропущенными, но файл и запуск всё равно провалены. Jest провалит каждый тест блока и при этом позовёт их `afterEach` — хук уборки должен переживать то, что подготовки не было.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Модуль один на файл, а не на тест',
    d: 'Изоляция раннера — между файлами. Тесты одного файла делят модули, их переменные, кеши и синглтоны. Свежий модуль на каждый тест даёт только `vi.resetModules()` или `jest.isolateModules()` с повторным импортом.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`instanceof Error` в Jest ложен для ошибок Node',
    d: 'Ошибка из `fs` создана в главном мире процесса, а тест сравнивает её со своим `Error` из vm-контекста. Проверка по устройству — `Error.isError(e)` или `e?.code` — работает в обоих раннерах.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Фабрика мока выполняется раньше ваших переменных',
    d: 'Мок поднят наверх файла, а `const` под ним ещё не выполнилась. Vitest: `vi.hoisted`. Jest: имя с префиксом `mock` и чтение внутри функции, а не сразу.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Синхронная прокрутка часов не пропускает промисы',
    d: 'Код, который ставит таймер, ждёт `await`, а потом ставит следующий таймер, под `advanceTimersByTime` застрянет: второй таймер появится только после прокрутки. Для асинхронного кода — `advanceTimersByTimeAsync`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`runAllTimers` на интервале — не «всё», а предохранитель',
    d: 'Вечный интервал не кончается, и раннер сдаётся через 10 000 (Vitest) или 100 000 (Jest) срабатываний с ошибкой. Для интервала — `advanceTimersByTime` на нужный срок или `runOnlyPendingTimers`.',
  },
  {
    n: '09',
    t: 'Зелёный по порядку — не значит независимый',
    d: 'Тест, который проходит только после соседа или только раньше него, виден лишь при перемешивании. `--sequence.shuffle` у Vitest, `--randomize` у Jest; зерно из отчёта повторяет тот же порядок.',
  },
  {
    n: '10',
    t: 'Таймер теста срабатывает в чужом тесте',
    d: 'Невыжданный `setTimeout` из теста A отработал посреди теста B. Ждите всё, что запустили, или снимайте в `afterEach`; таймеры, которые нельзя дождаться, — под фейковые часы.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Vitest — Test Lifecycle',
    href: 'https://vitest.dev/guide/lifecycle',
    what: 'сбор и исполнение, порядок хуков, `sequence.hooks`',
  },
  {
    title: 'Vitest — Improving Performance: изоляция и пулы',
    href: 'https://vitest.dev/guide/improving-performance',
    what: '`isolate`, `pool: forks | threads | vmThreads`',
  },
  {
    title: 'Vitest — `vi.mock` и `vi.hoisted`',
    href: 'https://vitest.dev/api/vi',
    what: 'подъём моков, фабрика, `vi.hoisted`, фейковые таймеры',
  },
  {
    title: 'Jest — Order of Execution',
    href: 'https://jestjs.io/docs/setup-teardown#order-of-execution',
    what: 'сбор `describe` до тестов, порядок хуков',
  },
  {
    title: 'Jest — Manual mocks и `jest.mock`',
    href: 'https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options',
    what: 'фабрика, запрет внешних имён и префикс `mock`',
  },
  {
    title: 'Jest — Timer Mocks',
    href: 'https://jestjs.io/docs/timer-mocks',
    what: '`useFakeTimers`, `advanceTimersByTime`, `runAllTimers`',
  },
  {
    title: '`@sinonjs/fake-timers`',
    href: 'https://github.com/sinonjs/fake-timers',
    what: 'часы, на которых стоят фейковые таймеры обоих раннеров; `loopLimit`',
  },
  {
    title: 'Node.js — `node:vm`',
    href: 'https://nodejs.org/api/vm.html',
    what: 'контексты со своими встроенными объектами',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «Три фазы»](/tooling/modules/#s1) — карта модулей и почему модуль исполняется один раз. [Модули и сборка, раздел «CommonJS против ESM»](/tooling/modules/#s3) — `require`, `module.exports` и кеш `require`. [HMR изнутри](/tooling/hmr/) — тот же конвейер Vite, что переписывает тестовые файлы Vitest. [Event Loop, раздел «Таймеры»](/js/event-loop/#s4) — настоящие таймеры, которые подменяют фейковые. [Транспиляция и полифилы](/tooling/transpilation/) — Babel, через который Jest пропускает тесты. [Тесты в браузере изнутри](/tooling/e2e-testing/) — локаторы, авто-ожидание Playwright и почему e2e-тесты мигают. [Внедрение зависимостей](/frameworks/dependency-injection/) — `provide`/`inject` во Vue, контекст React и иерархия инжекторов Angular.';
