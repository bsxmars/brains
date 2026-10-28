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
    why: '`await` заворачивает число в готовый промис, и продолжение функции встаёт в очередь — один тик.',
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
    why: 'Настоящий промис `await` берёт как есть, без обёртки (0). Промис уже выполнен, поэтому продолжение сразу встаёт в очередь — 1.',
    program: (rt) => {
      const p = rt.settled();
      // Нативный промис проходит вход без обёртки — это и есть нулевая цена PromiseResolve.
      rt.performPromiseThen(rt.promiseResolve(p), 'продолжение await печатает результат', {
        hit: true,
      });
    },
  },
  {
    label: 'await объекта с then',
    n: 2,
    code: "(async () => { await { then: r => r() }; console.log('<-- здесь'); })();",
    why: 'Объект с методом `then` — не настоящий промис, поэтому `await` заворачивает его в новый промис и разворачивает: микрозадача вызывает его `then` (1), тот сразу вызывает `r()`, затем продолжение функции (2). Настоящий промис здесь стоил бы на тик больше: его `then` отвечает через очередь.',
    program: (rt) => {
      const wrapper = rt.pending();
      rt.resolvePromise(wrapper, rt.syncThenable('{ then: r => r() }'));
      rt.performPromiseThen(wrapper, 'продолжение await печатает результат', { hit: true });
    },
  },
  {
    label: 'return p из async',
    n: 3,
    code: "const p = Promise.resolve('X');\nasync function f() { return p; }\nf().then(() => console.log('<-- здесь'));",
    why: 'Промис функции завершается другим промисом `p`, и его приходится разворачивать: микрозадача вызывает `p.then` (1), `p` отвечает через очередь (2), и только потом срабатывает `.then` снаружи (3).',
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
    why: '`await p` стоит один тик, после него функция возвращает уже значение, а не промис, — и разворачивать нечего: ещё один тик. Итого на тик меньше, чем `return p`.',
    program: (rt) => {
      const p = rt.settled();
      const fnPromise = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'функция продолжается и возвращает значение', {
        then: () => rt.resolvePromise(fnPromise, 'value'),
      });
      rt.performPromiseThen(fnPromise, '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'Promise.resolve(p)',
    n: 1,
    code: "const p = Promise.resolve('X');\nPromise.resolve(p).then(() => console.log('<-- здесь'));",
    why: 'Обёртки нет: `Promise.resolve(p)` возвращает **тот же** промис (0). Один тик уходит только на `.then`.',
    program: (rt) => {
      const p = rt.settled();
      rt.performPromiseThen(rt.promiseResolve(p), '.then печатает результат', { hit: true });
    },
  },
  {
    label: 'new Promise(r => r(p))',
    n: 3,
    code: "const p = Promise.resolve('X');\nnew Promise(r => r(p)).then(() => console.log('<-- здесь'));",
    why: '`r(p)` не узнаёт настоящий промис и разворачивает его, как любой объект с `then`: микрозадача вызывает `p.then`, `p` отвечает через очередь. На два тика дороже, чем `Promise.resolve(p)`.',
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
    why: '`Promise.all` подписывается `.then` на каждый элемент — это лишний тик (1). Массив результатов разворачивать не нужно, и остаётся продолжение `await` (2). На тик дороже, чем `await p`.',
    program: (rt) => {
      const p = rt.settled();
      const all = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'Promise.all складывает результат в массив', {
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
    why: 'Та же цена, что у `all`, и по той же причине: `race` тоже подписывается `.then` на каждый элемент (1), затем продолжение `await` (2). Разница не в цене, а в том, чего они ждут: `all` — всех, `race` — первого.',
    program: (rt) => {
      const p = rt.settled();
      const race = rt.pending();
      rt.performPromiseThen(rt.promiseResolve(p), 'Promise.race завершает свой промис первым результатом', {
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
    why: 'Ставит `fn` в очередь напрямую, без всякого промиса. Самый дешёвый способ отложить код на один тик.',
    program: (rt) => {
      rt.enqueue('queueMicrotask', 'fn встаёт в очередь напрямую, без промиса-обёртки', {
        hit: true,
      });
    },
  },
];
