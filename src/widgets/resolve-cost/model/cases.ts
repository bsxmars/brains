import { HIT } from './run';
import type { ResolveCase } from './types';

/**
 * Случаи `ResolvePromise(v)` — та же блок-схема, что нарисована рядом, только исполняемая.
 *
 * Схема утверждает цену на каждой развилке (`+0`, `+1`) картинкой. Здесь те же развилки
 * проходятся по-настоящему: значение, нативный промис, синхронный thenable, отказ. Ни одно
 * число не написано на виджете руками — каждое либо снято движком, либо посчитано моделью.
 *
 * Данные живут у виджета, а не в `data.ts` темы, по двум причинам. Во-первых, у дорожек есть
 * поле `program` — функция; пропы острова Astro сериализует, и функция до браузера не доезжает
 * (на этом уже обожглись, см. комментарий в `widgets/tick-ruler/ui/TickRuler.vue`). Во-вторых,
 * цена конструкции обязана быть в курсе одна, а не своя в каждом уроке.
 *
 * Цены проверены запуском (Node 26.8): 1 / 3 / 2 для трёх видов `v`, и 2 / 3 / 4 для того,
 * что вернули из `.then`.
 */
export const RESOLVE_CASES: ResolveCase[] = [
  {
    key: 'value',
    label: 'resolve(значение)',
    title: '`resolve(v)` обычным значением',
    why: 'Если `v` — не объект, промис получает результат сразу, внутри `resolve`, и тиков это не стоит. Единственный тик здесь уходит на `.then`: колбэк встаёт в очередь, потому что промис уже завершён.',
    lanes: [
      {
        key: 'value',
        label: '`new Promise(r => r("x"))`',
        code: `new Promise(r => r('x')).then(() => console.log('${HIT}'));`,
        n: 1,
        tone: 'ok',
        note: 'Сам `r("x")` ничего не стоит: промис завершается прямо в этом вызове. Тик тратит `.then` на уже завершённом промисе.',
        program: (rt) => {
          const created = rt.pending();
          // Не объект → FulfillPromise сразу, очередь пуста.
          rt.resolvePromise(created, 'value');
          rt.performPromiseThen(created, '.then печатает результат', { hit: true });
        },
      },
    ],
  },

  {
    key: 'native',
    label: 'resolve(промис)',
    title: '`resolve(v)` другим промисом',
    why: '`resolve` не отличает настоящий промис от любого объекта с методом `then`. Он ставит в очередь микрозадачу, которая вызовет `v.then` (**+1**), а `then` настоящего промиса сам откладывает ответ ещё на одну микрозадачу (**+1**).',
    lanes: [
      {
        key: 'native',
        label: '`new Promise(r => r(p))`',
        code: `const p = Promise.resolve('x');\nnew Promise(r => r(p)).then(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'warn',
        note: 'Те самые «+2 тика за промис»: две микрозадачи подряд — одна вызывает `p.then`, вторая — колбэк внутри него. Сравните с `Promise.resolve(p)`: он узнаёт настоящий промис и возвращает его без единого тика.',
        program: (rt) => {
          const p = rt.settled();
          const created = rt.pending();
          // r(p) — это ResolvePromise: нативность промиса ему ничем не помогает.
          rt.resolvePromise(created, p);
          rt.performPromiseThen(created, '.then печатает результат', { hit: true });
        },
      },
    ],
  },

  {
    key: 'thenable',
    label: 'resolve(объект с then)',
    title: '`resolve(v)` объектом с методом `then`',
    why: 'Путь тот же, что у промиса, а цена меньше: микрозадача, которая вызовет `v.then` (**+1**), — и всё. Этот `then` вызывает `res` сразу, ничего не откладывая.',
    lanes: [
      {
        key: 'thenable',
        label: '`new Promise(r => r({ then: res => res("x") }))`',
        code: `new Promise(r => r({ then: res => res('x') })).then(() => console.log('${HIT}'));`,
        n: 2,
        tone: 'info',
        note: 'Лишний тик у настоящего промиса берёт его собственный `then`: он всегда отвечает через очередь. Объект, который отвечает сразу, поэтому дешевле на тик.',
        program: (rt) => {
          const created = rt.pending();
          rt.resolvePromise(created, rt.syncThenable('{ then: res => res("x") }'));
          rt.performPromiseThen(created, '.then печатает результат', { hit: true });
        },
      },
    ],
  },

  {
    key: 'return',
    label: 'return из .then',
    title: 'Что вернуть из `.then`: значение, объект с `then` или промис',
    why: 'То, что вернул колбэк, становится результатом следующего промиса в цепочке — через тот же `resolve`. Поэтому вернуть настоящий промис здесь **дороже всего**: `Promise.resolve("x")` обходится на тик дороже, чем объект `{ then: r => r("x") }`, и на два — чем просто `"x"`.',
    lanes: [
      {
        key: 'plain',
        label: 'вернуть **значение**',
        code: `Promise.resolve().then(() => 'x').then(() => console.log('${HIT}'));`,
        n: 2,
        tone: 'ok',
        note: 'Значение завершает промис сразу, **+0**. Два тика — это два `.then` в цепочке, меньше здесь не бывает.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул строку — промис завершён значением', {
            then: () => rt.resolvePromise(link, 'value'),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
      {
        key: 'thenable',
        label: 'вернуть **объект с `then`** `{ then: r => r("x") }`',
        code: `Promise.resolve().then(() => ({ then: r => r('x') })).then(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'info',
        note: 'Плюс один тик к значению: микрозадача, которая вызывает `then` объекта. Тот сразу вызывает `r`, и на этом всё.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул { then: r => r("x") } — нужно вызвать его then', {
            then: () => rt.resolvePromise(link, rt.syncThenable('{ then: r => r("x") }')),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
      {
        key: 'native',
        label: 'вернуть **промис** `Promise.resolve("x")`',
        code: `Promise.resolve().then(() => Promise.resolve('x')).then(() => console.log('${HIT}'));`,
        n: 4,
        tone: 'warn',
        note: 'Самый дорогой способ вернуть ту же строку — хотя выглядит самым «правильным». `await` и `Promise.resolve` настоящий промис узнают и берут как есть, а при возврате из колбэка его разворачивают, как любой объект с `then`.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул Promise.resolve("x") — нужно вызвать его then', {
            then: () => rt.resolvePromise(link, rt.settled()),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
    ],
    order: {
      code:
        `Promise.resolve().then(() => 'x').then(() => console.log('значение'));\n` +
        `Promise.resolve().then(() => ({ then: r => r('x') })).then(() => console.log('объект с then'));\n` +
        `Promise.resolve().then(() => Promise.resolve('x')).then(() => console.log('промис'));`,
      expected: ['значение', 'объект с then', 'промис'],
      note: 'Три цепочки одинаковой длины, запущенные в одну строку кода, приходят к финишу в разное время. Порядок — прямое следствие цены: 2, 3, 4 тика.',
    },
  },

  {
    key: 'rejected',
    label: 'resolve(отказ)',
    title: '`resolve(v)` промисом, который уже отклонён',
    why: '`resolve` не смотрит, выполнен `v` или отклонён, — он смотрит только на метод `then`. Путь тот же и цена та же, меняется только то, какой из двух колбэков `then` вызовут в конце.',
    lanes: [
      {
        key: 'rejected',
        label: '`new Promise(r => r(Promise.reject("boom")))`',
        code: `const p = Promise.reject('boom');\nnew Promise(r => r(p)).catch(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'warn',
        // Модели нет намеренно: `promise-sim` не знает отказов, и тащить их туда ради одной
        // дорожки значило бы переписать её докстринг вместе с семантикой.
        note: '`resolve` отклонённым промисом — это отказ, а не успех: в конце вызовется обработчик ошибки. Цена та же, что у выполненного промиса: три тика.',
      },
    ],
  },
];
