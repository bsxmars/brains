import type { RulerPreset } from './types';

/**
 * Канонический набор конструкций для линейки тиков.
 *
 * Живёт у виджета, а не в уроке: линейку показывают и «Промис изнутри», и Event Loop, и цена
 * конструкции обязана быть в курсе одна. Раньше эти же числа стояли таблицей в каждом уроке
 * отдельно — и разошлись: в Event Loop они были относительными («+2»), в «Промисе» —
 * абсолютными, а два значения были просто неверны.
 *
 * У каждого пресета три независимых источника цены: число `n`, замер в браузере читателя
 * и прогон `program` по модели спеки. `tests/unit/promise-sim.test.ts` требует, чтобы все
 * три сходились.
 */
export const RULER_PRESETS: RulerPreset[] = [
  {
    label: 'await 42',
    n: 1,
    code: "(async () => { await 42; console.log('<-- здесь'); })();",
    why: 'PromiseResolve заворачивает не-промисное значение, продолжение приходит реакцией — один тик.',
    program: (rt) => {
      // PromiseResolve видит не объект → заворачивает в новый, уже завершённый промис.
      const wrapped = rt.promiseResolve('value');
      rt.performPromiseThen(wrapped, 'продолжение await печатает результат', { hit: true });
    },
  },
  {
    label: 'await nativePromise',
    n: 1,
    code: "const p = Promise.resolve('v');\n(async () => { await p; console.log('<-- здесь'); })();",
    why: 'PromiseResolve вернул тот же объект (0), подписка на уже settled — 1. Актуально везде: любой сегодняшний браузер, Node 20+.',
    program: (rt) => {
      const p = rt.settled();
      // Нативный промис проходит вход без обёртки — это и есть нулевая цена PromiseResolve.
      rt.performPromiseThen(rt.promiseResolve(p), 'продолжение await печатает результат', {
        hit: true,
      });
    },
  },
  {
    label: 'await thenable',
    n: 2,
    code: "(async () => { await { then: r => r() }; console.log('<-- здесь'); })();",
    why: 'PromiseResolve вернуть объект как есть не может: создаётся новый промис и резолвится thenable. Job разворачивания — 1, внутри него then синхронно зовёт r(), дальше реакция продолжения — 2. Нативный промис на этом месте стоил бы ещё тик: его then откладывает вызов.',
    program: (rt) => {
      const wrapper = rt.pending();
      rt.resolvePromise(wrapper, rt.syncThenable('then'));
      rt.performPromiseThen(wrapper, 'продолжение await печатает результат', { hit: true });
    },
  },
  {
    label: 'return p из async',
    n: 3,
    code: "const p = Promise.resolve('X');\nasync function f() { return p; }\nf().then(() => console.log('<-- здесь'));",
    why: 'Промис функции резолвится ПРОМИСОМ → ResolvePromise видит thenable → NewPromiseResolveThenableJob (1) → job зовёт p.then, а тот ставит свою реакцию (2) → resolveFn фулфилит → реакция .then (3).',
    program: (rt) => {
      const p = rt.settled();
      const fnPromise = rt.pending();
      // Промис async-функции резолвится промисом — значит, идёт по протоколу thenable.
      rt.resolvePromise(fnPromise, p);
      rt.performPromiseThen(fnPromise, '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'return await p',
    n: 2,
    code: "const p = Promise.resolve('X');\nasync function g() { return await p; }\ng().then(() => console.log('<-- здесь'));",
    why: 'await стоит 1 тик, дальше функция резолвится уже ЗНАЧЕНИЕМ, не промисом → ещё 1. На тик раньше, чем return p.',
    program: (rt) => {
      const p = rt.settled();
      const fnPromise = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'g возобновляется и резолвит ЗНАЧЕНИЕМ', {
        then: () => rt.resolvePromise(fnPromise, 'value'),
      });
      rt.performPromiseThen(fnPromise, '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'Promise.resolve(p)',
    n: 1,
    code: "const p = Promise.resolve('X');\nPromise.resolve(p).then(() => console.log('<-- здесь'));",
    why: 'Обёртка стоит 0 — возвращается ТОТ ЖЕ объект. Один тик уходит только на саму подписку.',
    program: (rt) => {
      const p = rt.settled();
      rt.performPromiseThen(rt.promiseResolve(p), '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'new Promise(r => r(p))',
    n: 3,
    code: "const p = Promise.resolve('X');\nnew Promise(r => r(p)).then(() => console.log('<-- здесь'));",
    why: 'Здесь PromiseResolve не участвует — работает ResolvePromise, а он обязан идти по протоколу thenable. +2 против Promise.resolve(p).',
    program: (rt) => {
      const p = rt.settled();
      const created = rt.pending();
      // r(p) — это ResolvePromise: узнать нативный промис он не умеет.
      rt.resolvePromise(created, p);
      rt.performPromiseThen(created, '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'await Promise.all([p])',
    n: 2,
    code: "const p = Promise.resolve('X');\n(async () => { await Promise.all([p]); console.log('<-- здесь'); })();",
    why: 'Promise.all подписывается .then на каждый элемент — это лишняя реакция (1). Массив результатов не thenable, поэтому резолв идёт без разворачивания, и остаётся реакция await (2). На тик дороже, чем await p.',
    program: (rt) => {
      const p = rt.settled();
      const all = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'resolveElement собирает элемент массива', {
        // Массив результатов — не thenable, поэтому резолв обходится без разворачивания.
        then: () => rt.resolvePromise(all, 'value'),
      });
      rt.performPromiseThen(all, 'продолжение await печатает результат', { hit: true });
    },
  },
  {
    label: 'await Promise.race([p])',
    n: 2,
    code: "const p = Promise.resolve('X');\n(async () => { await Promise.race([p]); console.log('<-- здесь'); })();",
    why: 'Та же цена, что у all, и по той же причине: race тоже подписывается .then на каждый элемент — лишняя реакция (1), затем реакция await (2). Разница между ними не в цене, а в том, чем завершится их собственный промис: all ждёт всех, race — первого любого.',
    program: (rt) => {
      const p = rt.settled();
      const race = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'реакция race резолвит свой промис первым исходом', {
        // Значение победителя — не thenable, поэтому резолв идёт без разворачивания.
        then: () => rt.resolvePromise(race, 'value'),
      });
      rt.performPromiseThen(race, 'продолжение await печатает результат', { hit: true });
    },
  },
  {
    label: 'queueMicrotask(fn)',
    n: 1,
    code: "queueMicrotask(() => console.log('<-- здесь'));",
    why: 'Ставит fn напрямую, без промиса-обёртки вообще. Самый дешёвый способ отложить на один тик.',
    program: (rt) => {
      rt.enqueue('queueMicrotask', 'fn встаёт в очередь напрямую, без промиса-обёртки', {
        hit: true,
      });
    },
  },
];
