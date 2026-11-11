import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { SpawnFixture, SpawnScenario } from '@/widgets/spawn-lab/model/types';
import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';

/**
 * Данные темы «Генераторы и асинхронные итераторы».
 *
 * Тема написана 2026-10-01. Протокол iterable/iterator остаётся в «Объектной модели».
 * Синхронный генератор, его состояния и next(v)/throw/return перенесены сюда 2026-11-11;
 * дальше тема раскрывает:
 * во что генератор превращается без поддержки движка, как из него и промисов собирается
 * `async/await`, асинхронные итераторы, очередь запросов у асинхронного генератора и закрытие
 * ресурса при раннем выходе.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6), TypeScript **6.0.3** из `node_modules` проекта, октябрь 2026.
 * Без таймерных замеров: всё, что утверждает тема, — порядок событий и значения.
 *
 *   — сценарии `SCENARIOS` исполнены трижды: `async`-версия на настоящем `Promise`, версия через
 *     `spawn` на настоящем `Promise` и та же через `__awaiter`, который TypeScript пишет для
 *     `target: ES2016`. Все три вывода совпали построчно — это `SCENARIO_LOGS`;
 *   — `TS_ES5_CODE` — дословный вывод `ts.transpileModule` для ES5;
 *   — асинхронные генераторы: очередь `next()`, `break` с `await` в `finally`, `return()` при
 *     висящем `await`, исправление через `AbortController` — выводы `*_LOG`.
 *
 * Всё перечисленное исполняет `tests/unit/generators.test.ts`: код примеров — эти же строки,
 * литералы выводов сверяются с тем, что движок печатает сейчас. Что кадров `at async` у
 * собранного кода нет, проверяет `tests/unit/errors.test.ts` (текст — в «Ошибках и стеках»).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'итератор и `{ value, done }`',
    d: 'Объект с методом `next()`. Каждый вызов возвращает очередной результат в виде `{ value, done }`: `value` — значение, `done: true` — значений больше нет.',
  },
  {
    k: 'объект-генератор',
    d: 'То, что возвращает вызов `function*`. Это итератор, и он помнит, где остановилась функция: на каком `yield` и с какими значениями переменных.',
  },
  {
    k: 'микрозадача',
    d: 'Короткое задание в очереди движка, которое выполнится, как только опустеет стек вызовов. Реакции промисов (`then`) и продолжения после `await` — микрозадачи.',
  },
  {
    k: 'тик',
    d: 'Одна микрозадача в очереди. «Стоит один тик» значит: продолжение встанет в очередь одним заданием, и всё, что уже стоит перед ним, выполнится раньше.',
  },
  {
    k: 'thenable',
    d: 'Любой объект с методом `then`. Промис — частный случай. `await` и `Promise.resolve` принимают и «чужие» thenable: зовут их `then` и ждут.',
  },
  {
    k: 'асинхронный итератор',
    d: 'Итератор, у которого `next()` возвращает не `{ value, done }`, а **промис** такого объекта. Его обходит цикл `for await…of`.',
  },
];

export const PLAIN_PAUSE =
  'Обычная функция похожа на телефонный звонок: пока разговор не закончен, линия занята. Генератор — переписка. Он пишет часть письма, отправляет и ждёт. Когда приходит ответ, он продолжает с того же места и помнит, о чём шла речь. А в ответ можно вложить что угодно — это и есть `next(x)`.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи, разобранные в других темах. Если какая-то из них незнакома, начните со ссылки на карточке.';

export const PREREQ: Prereq[] = [
  {
    t: 'Протокол итератора и обычный генератор',
    d: '`for…of` берёт у объекта итератор и зовёт `next()`, пока не придёт `done: true`. Генератор — итератор, который пишет язык: `next(v)` продолжает функцию, `return()` закрывает её и выполняет `finally`.',
    href: '/js/object-model/#s8',
    hrefLabel: '«Объектная модель», раздел «Протокол итератора»',
    tone: 'info',
  },
  {
    t: 'Промис и `then`',
    d: 'Промис получает результат один раз. `then` ставит реакцию в очередь, когда промис выполнится или отклонится, а у уже выполненного — сразу. `Promise.resolve(p)` возвращает сам `p`, если это настоящий промис.',
    href: '/js/promise-internals/#s2',
    hrefLabel: '«Промис изнутри», раздел «Три операции, из которых складывается цена»',
    tone: 'info',
  },
  {
    t: 'Очередь микрозадач',
    d: 'Реакции промисов ждут в очереди и выполняются по одной, когда опустеет стек вызовов. Новые задания встают в конец той же очереди.',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event Loop», раздел про checkpoint',
    tone: 'info',
  },
];

// ─── Раздел 1. Пауза генератора ────────────────────────────────────────────────────────────

/**
 * Сквозной пример темы: «запросы», которые отвечают сразу. Готовые промисы, а не таймеры —
 * поэтому порядок зависит только от очереди микрозадач и одинаков на любой машине.
 */
export const LOG_CODE = 'const log = console.log;';

export const HELPERS_CODE = `const getUser = (id) => Promise.resolve('Аня');
const getPosts = (user) => Promise.resolve(['пост 1', 'пост 2']);
const broken = () => Promise.reject(new Error('нет сети'));`;

/** Генератор, которым управляют руками. Тест исполняет эту строку и сверяет `STEPS_RESULTS`. */
export const STEPS_CODE = `function* loadSteps(id) {
  log('старт ' + id);
  const user = yield getUser(id);
  log('пользователь ' + user);
  const posts = yield getPosts(user);
  return posts.length;
}

const it = loadSteps(1);   // тело ещё не выполнялось
const r1 = it.next();      // лог «старт 1»; r1.value — промис из getUser
const r2 = it.next('Боб'); // лог «пользователь Боб» — не «Аня»!
const r3 = it.next(['a', 'b', 'c']);
// r3: { value: 3, done: true }`;

export const STEPS_NOTE =
  'Генератор не знает, что лежит в промисе, который он отдал через `yield`. Он остановился и ждёт. Значение, которое вернёт `yield`, выбирает тот, кто позовёт `next(x)`. Здесь мы подсунули `\'Боб\'`, хотя `getUser` обещал `\'Аня\'`, и три поста вместо двух, — и генератор поверил. Если вызывающий будет ждать промис и передавать в `next` его результат, получится учебная модель ожидания. Её реализация — `spawn` в разделе [«Модель await через генератор»](#s5).';

export const PLAIN_STATE =
  'Как повар, которого отвлекают. Чтобы вернуться к блюду, ему нужны две вещи: номер шага в рецепте, на котором он остановился, и продукты, уже нарезанные на столе. Генератор хранит то же самое: место остановки и значения локальных переменных. Всё остальное — обычный код.';

/** Дословный вывод `ts.transpileModule(…, { target: ES5 })` для `loadSteps`; без помощника `__generator`. */
export const TS_ES5_CODE = `function loadSteps(id) {
    var user, posts;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                log('старт ' + id);
                return [4 /*yield*/, getUser(id)];
            case 1:
                user = _a.sent();
                log('пользователь ' + user);
                return [4 /*yield*/, getPosts(user)];
            case 2:
                posts = _a.sent();
                return [2 /*return*/, posts.length];
        }
    });
}`;

export const TS_ES5_FACTS = [
  {
    t: 'Переменные вынесены наружу',
    d: '`var user, posts` объявлены вне функции-шага. Она вызывается заново на каждый `next()`, а переменные живут между вызовами в замыкании. Это и есть «продукты на столе».',
  },
  {
    t: '`_a.label` — место остановки',
    d: 'Номер `case`, с которого продолжить. Каждый `yield` разрезает функцию: всё до него — один `case`, всё после — следующий.',
  },
  {
    t: '`_a.sent()` — аргумент `next(x)`',
    d: 'То, что передали в `next`, становится результатом выражения `yield`. Для `throw(e)` помощник бросает `e` в этом же месте, и его ловит `try`, если он вокруг есть.',
  },
];

/** Тонкости `return()` и `throw()`. Тест исполняет строку и сверяет `r1…r3`, `caught` и `log`. */
export const EDGE_CODE = `const log = [];

function* job() {
  try {
    log.push('работаю');
    yield 1;
    yield 2;
  } finally {
    log.push('уборка');
    yield 'ещё не всё';      // finally может остановиться снова
    log.push('уборка закончена');
  }
}

const a = job();
const r1 = a.next();         // { value: 1, done: false }
const r2 = a.return('стоп'); // { value: 'ещё не всё', done: false }
const r3 = a.next();         // { value: 'стоп', done: true }

const b = job();
let caught;
try { b.throw(new Error('рано')); } catch (e) { caught = e.message; }
// caught: 'рано' — тело b не выполнялось, его try тоже
// log: 'работаю', 'уборка', 'уборка закончена'`;

export const EDGE_FACTS = [
  {
    t: '`return()` сначала выполняет `finally`',
    d: '`return(\'стоп\')` продолжает генератор так, будто на месте `yield` стоит `return \'стоп\'`. Дальше работает обычный `finally`, и если в нём есть `yield`, генератор остановится там и ответит `done: false`. Закроется он, только когда `finally` доработает.',
  },
  {
    t: '`throw()` до первого `next()` не заходит в `try`',
    d: 'Генератор, тело которого ещё не начиналось, не стоит ни на одном `yield` — бросить ошибку «в точку паузы» некуда. Он сразу закрывается, а ошибка вылетает из `throw()` наружу. Ни `try`, ни `finally` тела не выполняются. С `return()` то же: генератор закрывается, не выполнив ни строки.',
  },
];

// ─── Раздел 2. async/await из генератора и промисов ────────────────────────────────────────

export const PLAIN_SPAWN =
  'Генератор похож на повара, который остановился, ожидая ингредиент. `spawn` — помощник: он ждёт доставку и передаёт готовый ингредиент повару. Если доставка сорвалась, помощник сообщает об этом в ту же точку рецепта, и повар может обработать отказ. Так можно построить учебную модель ожидания и продолжения функции.';

export const SPAWN_WHY =
  'Генератор и `spawn` — **учебная модель** ожидания и продолжения, а не обязательное устройство нативной async-функции. Спецификация описывает async-функцию отдельными операциями `AsyncFunctionStart` и `Await`: её выполнение приостанавливается и позже возобновляется с результатом или исключением. Создавать для этого JavaScript-генератор стандарт не требует. У модели есть практическое применение: TypeScript для ES2015 или ES2016 и Babel с async-to-generator преобразуют async-функции в генератор с обёрткой `__awaiter` или `_asyncToGenerator`. Сходный приём используют redux-saga и MobX flow. Восстановление стека у нативного await и собранного кода может различаться — подробнее в [«Ошибках и стеках», раздел «Асинхронный стек»](/js/errors/#s4).';

/**
 * Учебный драйвер `spawn` использует тот же принцип, что co и __awaiter TypeScript,
 * с ограниченным набором случаев. Показанный исходник исполняют проверки темы.
 */
export const SPAWN_CODE = `function spawn(genFn, ...args) {
  return new Promise((resolve, reject) => {
    const gen = genFn(...args);

    function step(method, arg) {
      let r;
      try {
        r = gen[method](arg);     // будим генератор: next(значение) или throw(ошибка)
      } catch (err) {
        reject(err);              // генератор бросил ошибку — spawn отклоняется
        return;
      }
      if (r.done) {
        resolve(r.value);         // генератор дошёл до return — это результат spawn
        return;
      }
      // генератор встал на yield и отдал промис: ждём его, потом будим генератор
      Promise.resolve(r.value).then(
        function onFulfilled(v) { step('next', v); },
        function onRejected(e) { step('throw', e); },
      );
    }

    step('next', undefined);
  });
}`;

/** Вызов использует те же loadSteps, помощники и spawn, которые показаны выше. */
export const SPAWN_USE_CODE = `const count = await spawn(loadSteps, 1);
log('постов: ' + count);

try {
  await spawn(function* () { yield broken(); });
} catch (error) {
  log('отказ: ' + error.message);
}`;

export const SPAWN_USE_OUT = ['старт 1', 'пользователь Аня', 'постов: 2', 'отказ: нет сети'];

/** Полный исполняемый пример, собранный из единственных источников каждого фрагмента. */
export const SPAWN_EXAMPLE_CODE = [
  LOG_CODE,
  HELPERS_CODE,
  SPAWN_CODE,
  STEPS_CODE.slice(0, STEPS_CODE.indexOf('\n\n')),
  SPAWN_USE_CODE,
].join('\n\n');


/** Код, который зовёт `load`, и «линейка» из трёх тиков рядом с ним. */
export const DRIVER_CODE = `load(1).then((n) => log('итог: ' + n), (e) => log('отказ: ' + e.message));
Promise.resolve()
  .then(() => log('тик 1'))
  .then(() => log('тик 2'))
  .then(() => log('тик 3'));
log('синхронный код после вызова');`;

/**
 * Демо «по шагам» со страницы снято (решение автора 2026-11-09): сравнение `spawn` с `await`
 * читателю не нужно. Сценарии остались — по ним тест сверяет учебную `spawn` с настоящим
 * `async/await` и с `__awaiter`, то есть то, что утверждает `SPAWN_WHY`.
 */
export const FIXTURE: SpawnFixture = {
  spawnCode: SPAWN_CODE,
  helpersCode: HELPERS_CODE,
  driverCode: DRIVER_CODE,
};

export const SCENARIOS: SpawnScenario[] = [
  {
    id: 'two',
    label: 'Два await',
    asyncCode: `async function load(id) {
  log('старт ' + id);
  const user = await getUser(id);
  log('пользователь ' + user);
  const posts = await getPosts(user);
  return posts.length;
}`,
    genCode: `function load(id) {
  return spawn(function* () {
    log('старт ' + id);
    const user = yield getUser(id);
    log('пользователь ' + user);
    const posts = yield getPosts(user);
    return posts.length;
  });
}`,
    note: 'В этом сценарии каждый `yield` ждёт уже выполненный обычный промис и продолжает генератор через одну реакцию — порядок совпадает с показанной async-версией. «Пользователь Аня» печатается раньше, чем «тик 1»: промис `getUser` уже выполнен, и `spawn` подписался на него раньше, чем линейка поставила свой первый тик.',
  },
  {
    id: 'reject',
    label: 'Отказ и try/catch',
    asyncCode: `async function load(id) {
  try {
    await broken();
  } catch (e) {
    log('поймал: ' + e.message);
  }
  return 0;
}`,
    genCode: `function load(id) {
  return spawn(function* () {
    try {
      yield broken();
    } catch (e) {
      log('поймал: ' + e.message);
    }
    return 0;
  });
}`,
    note: 'Промис отклонён — `spawn` зовёт `gen.throw(e)`. Ошибка возникает внутри генератора, на строке с `yield`, и её ловит обычный `try/catch`. Так `await` превращает отказ промиса в исключение.',
  },
  {
    id: 'return-promise',
    label: 'return промиса',
    asyncCode: `async function load(id) {
  log('старт ' + id);
  return getPosts('Аня');
}`,
    genCode: `function load(id) {
  return spawn(function* () {
    log('старт ' + id);
    return getPosts('Аня');
  });
}`,
    note: 'Ни одного `yield`: генератор закончил за один `next()` и вернул промис. `resolve` с промисом не завершает `load` сразу — ставит задание «развернуть промис», и итог приходит только после «тик 2». Почему так и сколько это стоит — в [«Промисе изнутри»](/js/promise-internals/#s3).',
  },
  {
    id: 'thenable',
    label: 'await thenable',
    asyncCode: `async function load(id) {
  const v = await { then(ok) { log('then вызван'); ok(7); } };
  log('получил ' + v);
  return v;
}`,
    genCode: `function load(id) {
  return spawn(function* () {
    const v = yield { then(ok) { log('then вызван'); ok(7); } };
    log('получил ' + v);
    return v;
  });
}`,
    note: 'Объект с методом `then` — не промис. `Promise.resolve` в `spawn`, как и `await`, оборачивает его в новый промис и зовёт его `then` отдельной микрозадачей. Поэтому «then вызван» печатается после синхронного кода, а не во время `load(1)`.',
  },
];

/** Вывод каждого сценария. Одинаков у `async`, у `spawn` и у `__awaiter` — сверяет тест. */
export const SCENARIO_LOGS: Record<string, string[]> = {
  two: ['старт 1', 'синхронный код после вызова', 'пользователь Аня', 'тик 1', 'тик 2', 'итог: 2', 'тик 3'],
  reject: ['синхронный код после вызова', 'поймал: нет сети', 'тик 1', 'итог: 0', 'тик 2', 'тик 3'],
  'return-promise': ['старт 1', 'синхронный код после вызова', 'тик 1', 'тик 2', 'итог: пост 1,пост 2', 'тик 3'],
  thenable: ['синхронный код после вызова', 'then вызван', 'тик 1', 'получил 7', 'тик 2', 'итог: 7', 'тик 3'],
};

// ─── Раздел 3. Асинхронные итераторы и for await ───────────────────────────────────────────

export const PLAIN_ASYNC_ITER =
  'Обычный итератор — продавец, который сразу кладёт товар на прилавок. Асинхронный — окно заказов: на каждый `next()` вам выдают талон, а товар по нему принесут позже. Талон — промис, товар — `{ value, done }`. `for await` берёт талон, ждёт по нему товар и только потом идёт за следующим талоном.';

export const PROTOCOL_ROWS = [
  { k: 'как взять итератор', sync: '`obj[Symbol.iterator]()`', async: '`obj[Symbol.asyncIterator]()`' },
  { k: 'что возвращает `next()`', sync: '`{ value, done }`', async: 'промис `{ value, done }`' },
  { k: 'кто обходит', sync: '`for…of`, спред, деструктуризация', async: '`for await…of`, `Array.fromAsync`' },
  { k: 'генератор', sync: '`function*` → `[object Generator]`', async: '`async function*` → `[object AsyncGenerator]`' },
  { k: 'ранний выход', sync: '`return()` — сразу', async: '`return()` — промис, цикл его ждёт' },
];

/**
 * Пагинация: ручной асинхронный итератор и асинхронный генератор над одним «сервером».
 * Первая страница отвечает дольше остальных: в последовательном обходе это ни на что
 * не влияет, а в разделе об очереди решает всё. Тест исполняет строку целиком.
 */
export const PAGER_CODE = `const log = [];

// «Сервер»: три страницы, первая отвечает дольше остальных
function fetchPage(n) {
  log.push('запрос ' + n);
  return new Promise((ok) => setTimeout(() => {
    log.push('ответ ' + n);
    ok(n <= 3 ? 'стр ' + n : null);
  }, n === 1 ? 30 : 5));
}

// Руками: next() возвращает промис { value, done }
const pages = {
  [Symbol.asyncIterator]() {
    let page = 0;
    return {
      async next() {
        const data = await fetchPage(page + 1);
        page += 1;                       // сдвигаем, когда страница пришла
        return data ? { value: data, done: false } : { value: undefined, done: true };
      },
    };
  },
};

// То же асинхронным генератором
async function* pagesGen() {
  for (let n = 1; ; n++) {
    const data = await fetchPage(n);
    if (!data) return;
    yield data;
  }
}

const viaObject = [];
for await (const p of pages) viaObject.push(p);
const viaGen = [];
for await (const p of pagesGen()) viaGen.push(p);
// viaObject и viaGen: ['стр 1', 'стр 2', 'стр 3']`;

export const ASYNC_ITER_FACTS = [
  {
    t: '`for await` не просит следующее, пока не доработало тело',
    d: 'Цикл зовёт `next()`, ждёт промис, выполняет тело — и только потом зовёт `next()` снова. Источник не может завалить потребителя. Этот же порядок держит чтение стрима по кускам — см. [«Стримы», раздел «Итерация над стримом и байтовые читатели»](/platform/streams/#s6).',
  },
  {
    t: '`yield` в асинхронном генераторе ждёт значение',
    d: '`yield промис` отдаёт наружу не промис, а его результат. А если промис отклонён, ошибка возникает внутри генератора, на строке с `yield`, и её ловит `try` вокруг. Наружу отклонённый промис как значение не выходит никогда.',
  },
  {
    t: '`for await` берёт и обычные итерируемые',
    d: 'Если у объекта нет `Symbol.asyncIterator`, цикл возьмёт `Symbol.iterator` и будет ждать каждое значение. По массиву **уже запущенных** промисов это опасно: пока цикл ждёт первый, второй может отклониться без обработчика. Если нужны результаты всех уже запущенных операций, их можно сразу передать в `Promise.allSettled`.',
  },
];

/** `yield` ждёт значение, отказ превращается в исключение. Тест исполняет строку. */
export const YIELD_AWAIT_CODE = `async function* values() {
  try {
    yield Promise.resolve(1);
    yield Promise.reject(new Error('плохое значение'));
  } catch (e) {
    yield 'поймал: ' + e.message;
  }
}

const got = [];
for await (const v of values()) got.push(v);
// got: [1, 'поймал: плохое значение']`;

// ─── Раздел 4. Очередь next() у асинхронного генератора ────────────────────────────────────

export const PLAIN_QUEUE =
  'Окно выдачи с одним поваром. Заказы принимают сразу, сколько бы их ни было, и каждому выдают номерок. Но повар готовит по одному: следующий заказ он начинает, только отдав предыдущий. Поэтому номерки выдаются в том порядке, в каком приняты заказы, — даже если второе блюдо проще первого.';

/** Три `next()` разом, без ожидания. Продолжение `PAGER_CODE`: тест исполняет их вместе. */
export const QUEUE_CODE = `log.length = 0;
const manual = pages[Symbol.asyncIterator]();
const fromObject = await Promise.all([manual.next(), manual.next(), manual.next()]);
// fromObject: три раза 'стр 1'
// log: 'запрос 1', 'запрос 1', 'запрос 1', 'ответ 1', 'ответ 1', 'ответ 1'

log.length = 0;
const gen = pagesGen();
const fromGen = await Promise.all([gen.next(), gen.next(), gen.next()]);
// fromGen: 'стр 1', 'стр 2', 'стр 3'
// log: 'запрос 1', 'ответ 1', 'запрос 2', 'ответ 2', 'запрос 3', 'ответ 3'`;

export const QUEUE_OBJECT_LOG = ['запрос 1', 'запрос 1', 'запрос 1', 'ответ 1', 'ответ 1', 'ответ 1'];
export const QUEUE_GEN_LOG = ['запрос 1', 'ответ 1', 'запрос 2', 'ответ 2', 'запрос 3', 'ответ 3'];

export const QUEUE_NOTE =
  'Ручной итератор принял три `next()` и выполнил их одновременно. Все три прочли `page`, пока первая страница ещё не пришла, — и все трижды запросили первую. Асинхронный генератор принял те же три вызова в очередь и выполнял их по одному: второй `next()` пошёл в работу, только когда первый дошёл до `yield`.';

export const CONCURRENT_ROWS = [
  { k: 'обычный генератор', what: '`next()` изнутри самого генератора, пока он работает', how: '`TypeError: Generator is already running`', tone: 'err' as const },
  { k: 'асинхронный генератор', what: 'несколько `next()` подряд, не дожидаясь', how: 'очередь: выполняются по одному, промисы выполняются по порядку вызовов', tone: 'ok' as const },
  { k: 'итератор, написанный руками', what: 'то же самое', how: 'что напишете: без своей очереди вызовы идут одновременно', tone: 'warn' as const },
];

export const QUEUE_FACTS = [
  {
    t: 'В очередь встают и `return()`, и `throw()`',
    d: 'Очередь у генератора одна на все три метода. `return()`, позванный, пока генератор занят предыдущим `next()`, будет ждать своей очереди. Поэтому `return()` не может прервать генератор, который ждёт на `await`, — разбор в разделе [«Ранний выход»](#s4).',
  },
  {
    t: 'Кому нужна такая очередь',
    d: 'Тому, кто раздаёт итератор нескольким потребителям: два воркера, которые берут задания из одного источника, или `Promise.all` над несколькими `next()`. С асинхронным генератором каждый получит своё значение, и ни одно не продублируется.',
  },
];

// ─── Раздел 5. Ранний выход и закрытие ресурса ─────────────────────────────────────────────

/** `break` ждёт асинхронный `finally`. Тест исполняет строку и сверяет `BREAK_LOG`. */
export const BREAK_CODE = `const log = [];

async function* lines() {
  try {
    yield 'a'; yield 'b'; yield 'c';
  } finally {
    log.push('finally: закрываю');
    await new Promise((ok) => setTimeout(ok, 5));   // например, закрыть файл
    log.push('finally: закрыл');
  }
}

for await (const line of lines()) {
  log.push('тело ' + line);
  if (line === 'b') break;      // break зовёт return() и ждёт его промис
}
log.push('после цикла');`;

export const BREAK_LOG = ['тело a', 'тело b', 'finally: закрываю', 'finally: закрыл', 'после цикла'];

export const BREAK_NOTE =
  'С обычным генератором `break` зовёт `return()` и идёт дальше. У асинхронного `return()` возвращает промис, и цикл его **ждёт**: «после цикла» печатается, только когда `finally` закрыл ресурс. Как бы ни закончился цикл — `break`, `return` из функции или исключение в теле, — `finally` генератора выполнится до следующей строки после цикла.';

/** `return()` не прерывает висящий `await`. Тест исполняет строку и сверяет `RACE_LOG`. */
export const RACE_CODE = `const log = [];
const sleep = (ms, v) => new Promise((ok) => setTimeout(() => ok(v), ms));

async function* updates() {
  try {
    while (true) {
      log.push('жду ответ');
      const v = await sleep(30, 'ответ');   // медленный запрос
      log.push('получил ' + v);
      yield v;
    }
  } finally {
    log.push('finally: закрыт');
  }
}

const it = updates();
const first = await Promise.race([it.next(), sleep(5, 'таймаут')]);
log.push('race: ' + first);
await it.return('стоп');        // встаёт в очередь за висящим next()
log.push('return() завершился');`;

export const RACE_LOG = ['жду ответ', 'race: таймаут', 'получил ответ', 'finally: закрыт', 'return() завершился'];

export const RACE_NOTE =
  'Таймаут сработал, но генератор в это время стоит не на `yield`, а на `await` внутри — он занят первым `next()`. `return()` встаёт в очередь за ним. Генератор дождался ответа, дошёл до `yield`, отдал значение промису, который уже никто не ждёт, — и только тогда принял `return()` и выполнил `finally`. Таймаут ничего не отменил: он лишь перестал ждать.';

/** Исправление: отмена через сигнал. Тест исполняет строку и сверяет `ABORT_LOG`. */
export const ABORT_CODE = `const log = [];
const sleep = (ms, v) => new Promise((ok) => setTimeout(() => ok(v), ms));

// Запрос, который умеет прерываться по сигналу — как fetch(url, { signal })
function request(signal) {
  return new Promise((ok, fail) => {
    const t = setTimeout(() => ok('ответ'), 30);
    signal.addEventListener('abort', () => { clearTimeout(t); fail(signal.reason); });
  });
}

async function* updates(signal) {
  try {
    while (true) {
      log.push('жду ответ');
      yield await request(signal);
    }
  } finally {
    log.push('finally: закрыт');
  }
}

const ac = new AbortController();
const it = updates(ac.signal);
const pending = it.next();
const first = await Promise.race([pending, sleep(5, 'таймаут')]);
log.push('race: ' + first);
ac.abort();                     // прерывает сам await внутри генератора
await it.return('стоп');
log.push('return() завершился');
try { await pending; } catch (e) { log.push('первый next(): ' + e.name); }`;

export const ABORT_LOG = ['жду ответ', 'race: таймаут', 'finally: закрыт', 'return() завершился', 'первый next(): AbortError'];

export const ABORT_NOTE =
  'Прервать генератор, который ждёт, может только то, чего он ждёт. Сигнал отклоняет промис `request`, ошибка возникает на строке с `await`, генератор выходит через `finally` — сразу, а не через 30 мс. `return()` после этого находит генератор закрытым и отвечает немедленно. Висящий первый `next()` отклоняется с `AbortError`: его стоит обработать, чтобы отказ не остался без внимания.';

export const ASYNC_QUEUE_DIAGRAM: ConceptDiagramData = {
  id: 'generators-queue-and-abort',
  title: 'Схема: очередь запросов и отмена операции',
  description:
    'В обоих примерах первый it.next() занимает генератор, пока тот ждёт на await. Вызов it.return() ждёт за ним в очереди. Сигнал отмены обращается к самой операции, минуя эту очередь.',
  width: 910,
  height: 510,
  nodes: [
    { id: 'queued-return', x: 0, y: 60, width: 240, height: 130, label: '`it.return()`', detail: 'В очереди за первым `next()`', tone: 'warn' },
    { id: 'active-next', x: 300, y: 60, width: 240, height: 130, label: 'Активный `it.next()`', detail: 'Генератор ждёт на `await`', tone: 'info' },
    { id: 'operation', x: 600, y: 60, width: 240, height: 130, label: 'Операция', detail: '`sleep(…)` или `request(signal)`', tone: 'neutral' },
    { id: 'process-return', x: 0, y: 350, width: 240, height: 130, label: 'Запрос `return()`', detail: 'Теперь обрабатывается', tone: 'ok' },
    { id: 'settled-next', x: 300, y: 350, width: 240, height: 130, label: '`next()` завершён', detail: 'Значение после `yield` или отказ', tone: 'info' },
    { id: 'abort', x: 600, y: 350, width: 240, height: 130, label: '`ac.abort()`', detail: 'Вариант с `request(signal)`', tone: 'err' },
  ],
  edges: [
    { from: 'active-next', to: 'operation', label: 'await', labelX: 570, labelY: 30 },
    { from: 'queued-return', to: 'process-return', fromSide: 'bottom', toSide: 'top', dashed: true, label: 'ждёт', labelX: 120, labelY: 275 },
    { from: 'operation', to: 'settled-next', fromSide: 'bottom', toSide: 'top', via: [[720, 270], [420, 270]], label: 'результат / отказ', labelX: 570, labelY: 255 },
    { from: 'settled-next', to: 'process-return', fromSide: 'left', toSide: 'right', label: 'затем', labelX: 270, labelY: 403 },
    { from: 'abort', to: 'operation', fromSide: 'right', toSide: 'right', via: [[890, 415], [890, 125]], label: 'abort', labelX: 865, labelY: 285 },
  ],
  note:
    'У sleep нет пути отмены; request(signal) отклоняет свой промис по сигналу. В примере с отменой первый next() сам выходит через finally, и return() находит генератор уже закрытым. Вообще обработка return() может выполнять finally с await или yield: вызов не гарантирует немедленного завершения.',
};

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Код в тонких местах тоже исполняется тестом. */
export const REENTRY_CODE = `function* g() {
  yield it.next();     // next() изнутри самого генератора
}
const it = g();
it.next();             // TypeError: Generator is already running`;

export const FINALLY_LOST_CODE = `async function* g() {
  try { yield 1; } finally { throw new Error('из finally'); }
}
let caught;
try {
  for await (const v of g()) throw new Error('из тела');
} catch (e) {
  caught = e.message;  // 'из тела' — ошибка finally пропала
}`;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`return()` не всегда закрывает генератор',
    d: 'Он выполняет `finally`, а `finally` может остановиться на `yield`. Тогда `return()` вернёт `done: false`, и генератор закроется только на следующем `next()`. Не пишите `yield` в `finally`, если генератор будут закрывать снаружи.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`throw()` и `return()` до первого `next()` не заходят в тело',
    d: 'Генератор ещё ни разу не останавливался, и точки паузы нет. Он просто закрывается: `try` не ловит, `finally` не выполняется. Если в `finally` закрывается ресурс, открытый вне генератора, — он останется открытым.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Генератор нельзя продолжить изнутри',
    d: 'Пока тело выполняется, повторный `next()` — `TypeError`. Обычно так случается, когда колбэк, вызванный из генератора, синхронно зовёт его же `next()`. У асинхронного генератора ошибки нет — вызов встанет в очередь.',
    code: REENTRY_CODE,
  },
  {
    n: '04',
    t: '`spawn` и `await` различаются на подменённом `then`',
    d: 'Порядок событий у них одинаковый, но `await` подписывается на настоящий промис внутренней операцией, а `spawn` зовёт `then`. Инструменты, которые подменяют `Promise.prototype.then` ради трассировки, видят код на генераторах и не видят `await`.',
  },
  {
    n: '05',
    t: 'Стек у кода на генераторах короче',
    d: 'Восстановленные кадры `at async …` V8 строит только для настоящих `async`-функций. Код, собранный под старый `target` (`__awaiter`), в стеке ошибки теряет всех, кто ждал. Это повод поднять `target` до ES2017 и выше, если старые браузеры не нужны.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Ручной асинхронный итератор не готов к параллельным `next()`',
    d: 'В `for await` он работает, потому что цикл зовёт `next()` по одному. Отдайте его двум потребителям или `Promise.all` — и вызовы пойдут одновременно, с общим состоянием. Асинхронный генератор выстраивает их в очередь сам.',
    tone: 'err',
  },
  {
    n: '07',
    t: '`return()` не прерывает `await` внутри генератора',
    d: 'Он встаёт в очередь и ждёт, пока генератор дойдёт до `yield`. Таймаут через `Promise.race` перестаёт ждать, но ресурс закроется, только когда придёт ответ. Прерывать надо само ожидание — сигналом `AbortController`.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Ошибка из `finally` пропадает, если тело уже бросило',
    d: 'Исключение в теле `for await` закрывает генератор через `return()`. Если `finally` генератора тоже бросит, наружу выйдет ошибка тела, а ошибка закрытия исчезнет без следа. При `break` та же ошибка `finally` вылетает наружу.',
    code: FINALLY_LOST_CODE,
    tone: 'warn',
  },
];

export const SOURCES: Source[] = [
  {
    title: 'ECMA-262 — AsyncFunctionStart и Await',
    href: 'https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-async-functions-abstract-operations-asyncfunctionstart',
    what: 'самостоятельные операции нативной async-функции: сохранение контекста и возобновление; стандарт не требует создавать JS-генератор',
  },
  {
    title: 'ECMA-262 — Generator Objects',
    href: 'https://tc39.es/ecma262/#sec-generator-objects',
    what: '`next`, `return`, `throw`; состояния генератора и `TypeError` при повторном входе',
  },
  {
    title: 'ECMA-262 — AsyncGenerator Objects',
    href: 'https://tc39.es/ecma262/#sec-asyncgenerator-objects',
    what: 'очередь запросов `[[AsyncGeneratorQueue]]`: `next`, `return`, `throw` встают в неё и выполняются по одному',
  },
  {
    title: 'ECMA-262 — Await',
    href: 'https://tc39.es/ecma262/#await',
    what: '`await` — `PromiseResolve` и `PerformPromiseThen` без вызова `then` у настоящего промиса',
  },
  {
    title: 'ECMA-262 — ForIn/OfStatement и AsyncIteratorClose',
    href: 'https://tc39.es/ecma262/#sec-asynciteratorclose',
    what: 'закрытие итератора при раннем выходе; почему ошибка тела перекрывает ошибку `return()`',
  },
  {
    title: 'tc39 — proposal-async-iteration',
    href: 'https://github.com/tc39/proposal-async-iteration',
    what: 'исходное предложение: `Symbol.asyncIterator`, `for await`, асинхронные генераторы и их очередь',
  },
  {
    title: 'co — библиотека TJ Holowaychuk',
    href: 'https://github.com/tj/co',
    what: 'исторический `spawn`: async/await на генераторах до появления `async`',
  },
  {
    title: 'TypeScript — tslib, `__awaiter` и `__generator`',
    href: 'https://github.com/microsoft/tslib',
    what: 'помощники, которые TypeScript вставляет для старого `target`; на стенде — 6.0.3',
  },
  {
    title: 'V8 — Faster async functions and promises',
    href: 'https://v8.dev/blog/fast-async',
    what: 'приостановка и возобновление async-функции, оптимизация ожидания и восстановленный стек `at async …`',
  },
];

export const RELATED =
  'Смежное на сайте: [Объектная модель, раздел «Протокол итератора»](/js/object-model/#s8) — протокол итератора, повторный обход, закрытие и помощники итераторов. [Память и GC, раздел «`using`»](/js/memory-gc/#s5) — `using` и `DisposableStack`: как закрыть генератор и любой ресурс на выходе из блока. [Промис изнутри, раздел «Линейка»](/js/promise-internals/#s3) — как считать тики и почему `return p` дороже. [Event Loop, раздел про checkpoint](/js/event-loop/#s3) — когда выполняется очередь микрозадач. [Стримы, раздел «Итерация над стримом и байтовые читатели»](/platform/streams/#s6) — `for await` по сетевому ответу. [Стримы Node, раздел про генераторы](/platform/node-streams/#s7) — асинхронный генератор как источник и звено `pipeline`.';


// Основы диалога с генератором перенесены из «Объектной модели».
export const COROUTINE_NOTE =
  'Обычную функцию нельзя остановить на середине: она идёт до `return` или до исключения, и всё это время поток занят ею. Генератор умеет **встать на паузу** и вернуть управление вызвавшему, а потом продолжить с того же места, сохранив все локальные переменные. Функция с таким свойством называется корутиной: она не «источник значений», а собеседник — ей можно и передать значение внутрь (`next(v)`), и бросить в неё ошибку (`throw`), и попросить закончить (`return`).';

export const GEN_CODE = [
  'function* dialog() {',
  '  try {',
  "    const name = yield 'Как тебя зовут?'",
  '    const age  = yield `Привет, ${name}…`',
  '    return `${name}, ${age}`',
  '  } finally {',
  "    console.log('очистка')",
  '  }',
  '}',
];

export const GEN_LINES = [-1, 2, 3, 6];

export const GEN_LABELS = [
  'suspended-start · тело не выполнялось',
  'suspended · стоит на первом yield',
  'suspended · стоит на втором yield',
  'completed · закрыт навсегда',
];

export const GEN_FACTS = [
  {
    t: '`for…of` и спред не включают результат return',
    d: '`for…of` и спред его игнорируют. Должно попасть наружу — это `yield`, а не `return`.',
  },
  {
    t: '`yield*` пробрасывает внутрь всё, а не только значения',
    d: 'Цикл с `yield` внутри передал бы наружу одни значения. `yield*` связывает генераторы напрямую: `next(v)`, `throw`, `return` пробрасываются внутрь, а `return` вложенного становится значением выражения. На этом до появления `async`/`await` писали асинхронный код (библиотеки co, redux-saga): обёртка ждала промис и звала `next(результат)` при успехе и `throw(ошибка)` при отказе.',
  },
  {
    t: '`for await…of` не берёт следующее, пока не доделал текущее',
    d: 'Цикл дожидается тела, прежде чем запросить следующее значение, — источник не может завалить потребителя (это называют backpressure). `Promise.all` запускает всё разом и легко перегружает сервер. Ловушка: `for await` по массиву **уже запущенных** промисов ждёт их по одному, и если второй отклонится раньше первого — `unhandledrejection`. Тут нужен `Promise.allSettled`.',
  },
];

export const GEN_DEMO_NOTE =
  'Учебная модель показывает, как генератор отвечает на вызовы: `next(v)`, `throw(err)`, `return()`. Два места стоят внимания. Аргумент **первого** `next()` теряется: генератор ещё не дошёл ни до одного `yield`, принять значение ему негде. А `throw()` бросает не снаружи, а внутри, в точке паузы, — и `try` внутри генератора может его поймать.';
