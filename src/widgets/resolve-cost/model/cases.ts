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
    title: '`resolve(v)`, где `v` — не объект',
    why: 'Вторая развилка схемы: `v` не объект → `FulfillPromise(v)` прямо здесь, **+0**. Промис уже завершён к концу синхронного кода, и единственный тик уходит на саму подписку.',
    lanes: [
      {
        key: 'value',
        label: '`new Promise(r => r("x"))`',
        code: `new Promise(r => r('x')).then(() => console.log('${HIT}'));`,
        n: 1,
        tone: 'ok',
        note: 'Резолв не стоит ничего: состояние меняется синхронно, внутри самого `r("x")`. Тик тратит `PerformPromiseThen` на уже завершённом промисе — это операция 1, а не 2.',
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
    label: 'resolve(нативный промис)',
    title: '`resolve(v)`, где `v` — нативный промис',
    why: 'Последняя развилка: у промиса `then` — функция, узнать «своего» `ResolvePromise` не умеет. Отсюда `NewPromiseResolveThenableJob` (**+1**), а внутри него `then` промиса откладывает вызов `resolveFn` ещё на реакцию (**+1**).',
    lanes: [
      {
        key: 'native',
        label: '`new Promise(r => r(p))`',
        code: `const p = Promise.resolve('x');\nnew Promise(r => r(p)).then(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'warn',
        note: 'Те самые «+2 тика за промис». Не магия: две последовательные постановки в очередь — сам job и реакция внутри его `then`. Сравните с `Promise.resolve(p)`, где работает операция 3 и цена нулевая.',
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
    label: 'resolve(тенабл)',
    title: '`resolve(v)`, где `v` — синхронный thenable',
    why: 'Развилка та же, а цена другая: `NewPromiseResolveThenableJob` (**+1**) — и всё. Чужой `then` зовёт `resolveFn` прямо внутри job, откладывать ему нечем.',
    lanes: [
      {
        key: 'thenable',
        label: '`new Promise(r => r({ then: res => res("x") }))`',
        code: `new Promise(r => r({ then: res => res('x') })).then(() => console.log('${HIT}'));`,
        n: 2,
        tone: 'info',
        note: 'Второй тик берёт не job, а `then` того объекта, который развернули. У самодельного объекта его нет — поэтому он дешевле нативного промиса на целый тик.',
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
    title: 'Что вернуть из `.then`: значение, тенабл или промис',
    why: 'Звено цепочки резолвится тем, что вы вернули, — то есть идёт через `ResolvePromise`. Нативность здесь не помогает, а **мешает**: `Promise.resolve("x")` на выходе дороже самодельного `{ then: r => r("x") }`.',
    lanes: [
      {
        key: 'plain',
        label: 'вернуть **значение**',
        code: `Promise.resolve().then(() => 'x').then(() => console.log('${HIT}'));`,
        n: 2,
        tone: 'ok',
        note: 'Звено резолвится значением: `FulfillPromise` внутри самой реакции, **+0**. Два тика — это две реакции цепочки, и меньше здесь не бывает.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул строку — звено резолвится ЗНАЧЕНИЕМ', {
            then: () => rt.resolvePromise(link, 'value'),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
      {
        key: 'thenable',
        label: 'вернуть **тенабл** `{ then: r => r("x") }`',
        code: `Promise.resolve().then(() => ({ then: r => r('x') })).then(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'info',
        note: 'Плюс один тик к значению: `NewPromiseResolveThenableJob`. Внутри job чужой `then` зовёт `resolveFn` синхронно, и на этом разворачивание кончается.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул { then: r => r("x") } — звено резолвится ТЕНАБЛОМ', {
            then: () => rt.resolvePromise(link, rt.syncThenable('{ then: r => r("x") }')),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
      {
        key: 'native',
        label: 'вернуть **нативный промис** `Promise.resolve("x")`',
        code: `Promise.resolve().then(() => Promise.resolve('x')).then(() => console.log('${HIT}'));`,
        n: 4,
        tone: 'warn',
        note: 'Самый дорогой способ вернуть ту же строку — и единственный, который выглядит «правильным». Тонкое место «Нативность промиса помогает только на входе» ровно об этом: нативность помогает на входе (`await`, `Promise.resolve`) и мешает на выходе.',
        program: (rt) => {
          const link = rt.pending();
          rt.performPromiseThen(rt.settled(), 'колбэк вернул Promise.resolve("x") — звено резолвится ПРОМИСОМ', {
            then: () => rt.resolvePromise(link, rt.settled()),
          });
          rt.performPromiseThen(link, 'второй .then печатает результат', { hit: true });
        },
      },
    ],
    order: {
      code:
        `Promise.resolve().then(() => 'x').then(() => console.log('значение'));\n` +
        `Promise.resolve().then(() => ({ then: r => r('x') })).then(() => console.log('тенабл'));\n` +
        `Promise.resolve().then(() => Promise.resolve('x')).then(() => console.log('нативный'));`,
      expected: ['значение', 'тенабл', 'нативный'],
      note: 'Три цепочки одинаковой длины, запущенные в одну строку кода, приходят к финишу в разное время. Порядок — прямое следствие цены: 2, 3, 4 тика.',
    },
  },

  {
    key: 'rejected',
    label: 'resolve(отказ)',
    title: '`resolve(v)`, где `v` — уже отказавший промис',
    why: 'Развилка та же самая: `ResolvePromise` не смотрит на состояние `v`, он смотрит на `then`. Разворачивание идёт по тому же пути и стоит столько же — меняется только то, какой из двух колбэков `then` в конце позовут.',
    lanes: [
      {
        key: 'rejected',
        label: '`new Promise(r => r(Promise.reject("boom")))`',
        code: `const p = Promise.reject('boom');\nnew Promise(r => r(p)).catch(() => console.log('${HIT}'));`,
        n: 3,
        tone: 'warn',
        // Модели нет намеренно: `promise-sim` не знает отказов, и тащить их туда ради одной
        // дорожки значило бы переписать её докстринг вместе с семантикой.
        note: '`resolve` отказавшим промисом — это отказ, а не успех: `resolveFn` в конце разворачивания позовёт `rejectFn`. Цена та же, что у успешного промиса: три тика.',
      },
    ],
  },
];
