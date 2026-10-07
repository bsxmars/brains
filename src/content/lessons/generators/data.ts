import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { SpawnFixture, SpawnScenario } from '@/widgets/spawn-lab/model/types';

/**
 * Данные темы «Генераторы и асинхронные итераторы».
 *
 * Тема написана 2026-10-01. Синхронный генератор и протокол итератора уже разобраны
 * в «Объектной модели» (раздел «Итераторы и генераторы»: iterable против iterator, состояния
 * генератора, `next(v)`/`throw`/`return` в демо `generator-machine`, `return()` при `break`,
 * помощники итераторов, `using`). Здесь они даны одной фразой со ссылкой, а тема идёт глубже:
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
 *   — `TS_ES5_CODE` и `TS_AWAITER_CODE` — дословный вывод `ts.transpileModule` (ES5 и ES2016);
 *   — пропатченный `Promise.prototype.then`: `await` его не позвал ни разу, `spawn` — дважды;
 *   — стек: у `async` есть кадр `async outer`, у `spawn` вместо него `inner.next`, `step`,
 *     `onFulfilled`. Снято в отдельном процессе Node: vitest переписывает стеки;
 *   — асинхронные генераторы: очередь `next()`, `break` с `await` в `finally`, `return()` при
 *     висящем `await`, исправление через `AbortController` — выводы `*_LOG`.
 *
 * Всё перечисленное исполняет `tests/unit/generators.test.ts`: код примеров — эти же строки,
 * литералы выводов сверяются с тем, что движок печатает сейчас. Демо (`widgets/spawn-lab`)
 * исполняет `SPAWN_CODE` на промисе с видимой очередью; тест требует, чтобы его вывод совпал
 * с настоящим `async/await` на каждом сценарии.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
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

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Протокол итератора и обычный генератор',
    d: '`for…of` берёт у объекта итератор и зовёт `next()`, пока не придёт `done: true`. Генератор — итератор, который пишет язык: `next(v)` продолжает функцию, `return()` закрывает её и выполняет `finally`.',
    href: '/js/object-model/#s8',
    hrefLabel: '«Объектная модель», раздел «Итераторы и генераторы»',
    tone: 'info',
  },
  {
    t: 'Промис и `then`',
    d: 'Промис получает результат один раз. `then` не ставит ничего в очередь сразу: реакция встанет туда, когда промис выполнится или отклонится. `Promise.resolve(p)` возвращает сам `p`, если это настоящий промис.',
    href: '/js/promise-internals/#s2',
    hrefLabel: '«Промис изнутри», раздел «Три операции, которые всё объясняют»',
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
  'Генератор не знает, что лежит в промисе, который он отдал через `yield`. Он остановился и ждёт. Значение, которое вернёт `yield`, выбирает тот, кто позовёт `next(x)`. Здесь мы подсунули `\'Боб\'`, хотя `getUser` обещал `\'Аня\'`, и три поста вместо двух, — и генератор поверил. Если вызывающий будет ждать промис и передавать в `next` его результат, получится `await`. Ровно это делает функция `spawn` из следующего раздела.';

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
    t: '`return()` — просьба, а не приказ',
    d: '`return(\'стоп\')` продолжает генератор так, будто на месте `yield` стоит `return \'стоп\'`. Дальше работает обычный `finally`, и если в нём есть `yield`, генератор остановится там и ответит `done: false`. Закроется он, только когда `finally` доработает.',
  },
  {
    t: '`throw()` до первого `next()` не заходит в `try`',
    d: 'Генератор, тело которого ещё не начиналось, не стоит ни на одном `yield` — бросить ошибку «в точку паузы» некуда. Он сразу закрывается, а ошибка вылетает из `throw()` наружу. Ни `try`, ни `finally` тела не выполняются. С `return()` то же: генератор закрывается, не выполнив ни строки.',
  },
];

// ─── Раздел 2. async/await из генератора и промисов ────────────────────────────────────────

export const PLAIN_SPAWN =
  'Повар готовит по рецепту и на каждом «нужно: соус» протягивает руку и замирает. Откуда возьмётся соус, он не знает. Помощник смотрит, что попросили, ждёт, пока соус будет готов, и кладёт его в руку — повар продолжает. Если соус сгорел, помощник не молчит, а говорит «сгорел» — и повар решает, что делать, на том же шаге. Генератор — повар, `spawn` — помощник, `async/await` — оба в одном лице, встроенные в язык.';

/**
 * Учебная `spawn` — та же функция, что в библиотеке `co` и в `__awaiter` TypeScript, без
 * обработки крайних случаев. Её печатает страница, исполняют демо и тест.
 */
export const SPAWN_CODE = `function spawn(genFn, ...args) {
  return new Promise((resolve, reject) => {
    const gen = genFn(...args);

    function step(method, arg) {
      let r;
      try {
        r = gen[method](arg);     // продолжить генератор: next(x) или throw(e)
      } catch (err) {
        reject(err);              // ошибка вылетела из генератора
        return;
      }
      if (r.done) {
        resolve(r.value);         // return в генераторе — результат промиса
        return;
      }
      // yield отдал «то, чего ждать»: дождаться и продолжить
      Promise.resolve(r.value).then(
        function onFulfilled(v) { step('next', v); },
        function onRejected(e) { step('throw', e); },
      );
    }

    step('next', undefined);
  });
}`;

/** Код, который зовёт `load`, и «линейка» из трёх тиков рядом с ним. */
export const DRIVER_CODE = `load(1).then((n) => log('итог: ' + n), (e) => log('отказ: ' + e.message));
Promise.resolve()
  .then(() => log('тик 1'))
  .then(() => log('тик 2'))
  .then(() => log('тик 3'));
log('синхронный код после вызова');`;

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
    note: 'Каждый `yield` стоит ровно одну микрозадачу — как `await`. «Пользователь Аня» печатается раньше, чем «тик 1»: промис `getUser` уже выполнен, и `spawn` подписался на него раньше, чем линейка поставила свой первый тик.',
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

export const DEMO_CAPTION =
  'Шаг — одна микрозадача. Очередь, вывод и место остановки генератора считает та же `spawn`, что напечатана выше, на промисе с видимой очередью. Под демо её вывод сверен с настоящим `async/await` в вашем браузере.';

export const MATCH_FACTS = [
  {
    t: '`yield` в `spawn` стоит столько же, сколько `await`',
    d: '`Promise.resolve(p)` отдаёт сам `p`, если это настоящий промис, а `then` на нём — одна реакция. `await p` делает ровно то же: один тик. Поэтому линейка печатается в одинаковых местах.',
  },
  {
    t: '`return` и `throw` — тоже один в один',
    d: '`return x` в генераторе — `resolve(x)` у промиса `load`, как у async-функции. Ошибка, вылетевшая из генератора, — `reject`. Отказ промиса, на котором стоит `yield`, — `gen.throw(e)`, то есть исключение на строке с `yield`.',
  },
  {
    t: 'Синхронная часть выполняется сразу',
    d: 'Исполнитель `new Promise` синхронный, и первый `step` идёт в нём же. Поэтому «старт 1» печатается до «синхронного кода после вызова» — как у async-функции, которая до первого `await` работает как обычная.',
  },
];

/** Дословный вывод `ts.transpileModule(asyncCode сценария «Два await», { target: ES2016 })`. */
export const TS_AWAITER_CODE = `var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function load(id) {
    return __awaiter(this, void 0, void 0, function* () {
        log('старт ' + id);
        const user = yield getUser(id);
        log('пользователь ' + user);
        const posts = yield getPosts(user);
        return posts.length;
    });
}`;

export const TS_AWAITER_NOTE =
  'Так TypeScript компилирует `async` для `target` ниже ES2017: `__awaiter` — та же `spawn`, `adopt` — тот же `Promise.resolve`, `fulfilled` и `rejected` — `onFulfilled` и `onRejected`. На всех четырёх сценариях из демо этот вывод печатает то же, что и настоящий `async/await`. С `target: ES2017` и выше TypeScript оставляет `async` как есть.';

/** Тест исполняет эту строку в отдельном процессе Node вместе с `SPAWN_CODE`. */
export const THEN_PATCH_CODE = `let calls = 0;
const then = Promise.prototype.then;
Promise.prototype.then = function (...args) {
  calls += 1;
  return then.apply(this, args);
};

await (async () => { await Promise.resolve(1); await Promise.resolve(2); })();
const byAwait = calls;   // 0 — await не вызывает then у настоящего промиса

calls = 0;
await spawn(function* () { yield Promise.resolve(1); yield Promise.resolve(2); });
const bySpawn = calls;   // 2 — spawn зовёт then на каждом yield

Promise.prototype.then = then;`;

/** Тест исполняет эту строку в отдельном процессе Node и сверяет `STACK_FRAMES`. */
export const STACK_CODE = `const tick = () => new Promise((ok) => setTimeout(ok, 0));

async function inner() { await tick(); throw new Error('бум'); }
async function outer() { await inner(); }

const innerG = () => spawn(function* inner() { yield tick(); throw new Error('бум'); });
const outerG = () => spawn(function* outer() { yield innerG(); });`;

/** Имена кадров стека `e.stack` при ошибке из `inner`, без путей и номеров строк. */
export const STACK_FRAMES = {
  native: ['inner', 'async outer'],
  spawn: ['inner', 'inner.next', 'step', 'onFulfilled'],
};

export const DIFF_FACTS = [
  {
    t: '`await` не зовёт `then` у настоящего промиса',
    d: 'Подмените `Promise.prototype.then` — `await` его не заметит: движок подписывается на промис напрямую, внутренней операцией. `spawn` зовёт `then` как обычный метод, на каждом `yield`. Так ведут себя все библиотеки и полифиллы поверх генераторов.',
    tone: 'neutral' as const,
  },
  {
    t: 'Стек ошибки обрывается на первой паузе',
    d: 'У `async`-функций V8 восстанавливает цепочку ожидания: в стеке есть `at async outer`, хотя `outer` давно не на стеке. У `spawn` движок видит только колбэк промиса: `inner.next`, `step`, `onFulfilled` — и ни слова о том, кто ждал `inner`.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 3. Асинхронные итераторы и for await ───────────────────────────────────────────

export const PLAIN_ASYNC_ITER =
  'Обычный итератор — продавец, который сразу кладёт товар на прилавок. Асинхронный — окно заказов: на каждый `next()` вам выдают талон, а товар по нему принесут позже. Талон — промис, товар — `{ value, done }`. `for await` берёт талон, ждёт по нему товар и только потом идёт за следующим талоном.';

export const PROTOCOL_ROWS = [
  { k: 'как взять итератор', sync: '`obj[Symbol.iterator]()`', async: '`obj[Symbol.asyncIterator]()`' },
  { k: 'что возвращает `next()`', sync: '`{ value, done }`', async: 'промис `{ value, done }`' },
  { k: 'кто обходит', sync: '`for…of`, спред, деструктуризация', async: 'только `for await…of`' },
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
    d: 'Если у объекта нет `Symbol.asyncIterator`, цикл возьмёт `Symbol.iterator` и будет ждать каждое значение. По массиву **уже запущенных** промисов это опасно: отказ второго раньше первого никто не ждёт — см. [«Объектную модель», раздел «Итераторы и генераторы»](/js/object-model/#s8).',
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
    d: 'Очередь у генератора одна на все три метода. `return()`, позванный, пока генератор занят предыдущим `next()`, будет ждать своей очереди. Это главное свойство очереди — и главный сюрприз следующего раздела.',
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

export const SOURCES: { title: string; href: string; what: string }[] = [
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
    what: '`await` за один тик и восстановленный стек `at async …`',
  },
];

export const RELATED =
  'Смежное на сайте: [Объектная модель, раздел «Итераторы и генераторы»](/js/object-model/#s8) — протокол итератора, состояния генератора, помощники итераторов. [Память и GC, раздел «`using`»](/js/memory-gc/#s5) — `using` и `DisposableStack`: как закрыть генератор и любой ресурс на выходе из блока. [Промис изнутри, раздел «Линейка»](/js/promise-internals/#s3) — как считать тики и почему `return p` дороже. [Event Loop, раздел про checkpoint](/js/event-loop/#s3) — когда выполняется очередь микрозадач. [Стримы, раздел «Итерация над стримом и байтовые читатели»](/platform/streams/#s6) — `for await` по сетевому ответу. [Стримы Node, раздел про генераторы](/platform/node-streams/#s7) — асинхронный генератор как источник и звено `pipeline`.';
