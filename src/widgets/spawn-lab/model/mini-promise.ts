/**
 * Промис с видимой очередью микрозадач — ровно настолько, насколько он нужен `spawn`.
 *
 * Зачем он: очередь настоящих микрозадач из JS не прочитать. Чтобы показать её по шагам,
 * строку `SPAWN_CODE` из темы исполняют с этим классом вместо `Promise` (параметром
 * `new Function`), а задания копятся в массиве, который демо выполняет по одному.
 *
 * Устройство повторяет спецификацию в тех местах, от которых зависит порядок:
 * — реакция встаёт в очередь, когда промис получил результат, а не при вызове `then`;
 * — `resolve(thenable)` не завершает промис сразу, а ставит задание «развернуть thenable»
 *   (NewPromiseResolveThenableJob), и уже оно зовёт `then` — отсюда лишние тики у `return p`;
 * — `Promise.resolve(p)` возвращает сам `p`, если это промис того же класса (PromiseResolve).
 *
 * Модель не притворяется движком: `tests/unit/generators.test.ts` прогоняет каждый сценарий
 * темы на ней и на настоящем `Promise` и требует одинакового вывода. Разойдутся — красный тест.
 */

export interface MiniJob {
  label: string;
  run: () => void;
}

type State = 'pending' | 'fulfilled' | 'rejected';

interface Reaction {
  onFulfilled: unknown;
  onRejected: unknown;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

/** Короткая запись значения для подписи задания: `'Аня'`, `[2]`, `Error('…')`. */
export function preview(v: unknown, Mini?: new (...a: never[]) => unknown): string {
  if (Mini && v instanceof Mini) return 'промис';
  if (typeof v === 'string') return `'${v}'`;
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return `Error('${v.message}')`;
  if (Array.isArray(v)) return `[${v.map((x) => preview(x, Mini)).join(', ')}]`;
  if (typeof v === 'object' && v !== null) return typeof (v as { then?: unknown }).then === 'function' ? 'thenable' : '{…}';
  return String(v);
}

/** Подпись колбэка: имя, если есть, иначе исходник одной строкой. */
function describe(fn: unknown, arg: unknown, Mini: new (...a: never[]) => unknown): string {
  if (typeof fn !== 'function') return 'передать результат дальше';
  if (fn.name) return `${fn.name}(${preview(arg, Mini)})`;
  const src = fn.toString().replace(/\s+/g, ' ');
  return src.length > 42 ? `${src.slice(0, 41)}…` : src;
}

export function createMiniPromise(queue: MiniJob[]) {
  class MiniPromise {
    state: State = 'pending';
    value: unknown = undefined;
    reactions: Reaction[] = [];

    constructor(executor: (resolve: (v?: unknown) => void, reject: (e?: unknown) => void) => void) {
      const { resolve, reject } = resolvingFunctions(this);
      try {
        executor(resolve, reject);
      } catch (e) {
        reject(e);
      }
    }

    then(onFulfilled?: unknown, onRejected?: unknown): MiniPromise {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const derived = new MiniPromise((a, b) => {
        resolve = a;
        reject = b;
      });
      const reaction: Reaction = { onFulfilled, onRejected, resolve, reject };
      if (this.state === 'pending') this.reactions.push(reaction);
      else enqueueReaction(reaction, this.state, this.value);
      return derived;
    }

    catch(onRejected?: unknown): MiniPromise {
      return this.then(undefined, onRejected);
    }

    static resolve(v?: unknown): MiniPromise {
      if (v instanceof MiniPromise && v.constructor === MiniPromise) return v;
      return new MiniPromise((r) => r(v));
    }

    static reject(e?: unknown): MiniPromise {
      return new MiniPromise((_, r) => r(e));
    }
  }

  function settle(p: MiniPromise, state: State, value: unknown) {
    p.state = state;
    p.value = value;
    const reactions = p.reactions;
    p.reactions = [];
    for (const r of reactions) enqueueReaction(r, state, value);
  }

  function enqueueReaction(r: Reaction, state: State, value: unknown) {
    const handler = state === 'fulfilled' ? r.onFulfilled : r.onRejected;
    queue.push({
      label: describe(handler, value, MiniPromise),
      run() {
        if (typeof handler !== 'function') {
          if (state === 'fulfilled') r.resolve(value);
          else r.reject(value);
          return;
        }
        let result: unknown;
        try {
          result = handler(value);
        } catch (e) {
          r.reject(e);
          return;
        }
        r.resolve(result);
      },
    });
  }

  function resolvingFunctions(p: MiniPromise) {
    let already = false;
    const reject = (e?: unknown) => {
      if (already) return;
      already = true;
      settle(p, 'rejected', e);
    };
    const resolve = (v?: unknown) => {
      if (already) return;
      already = true;
      if (v === p) {
        settle(p, 'rejected', new TypeError('промис не может завершиться самим собой'));
        return;
      }
      if ((typeof v !== 'object' || v === null) && typeof v !== 'function') {
        settle(p, 'fulfilled', v);
        return;
      }
      let then: unknown;
      try {
        then = (v as { then?: unknown }).then;
      } catch (e) {
        settle(p, 'rejected', e);
        return;
      }
      if (typeof then !== 'function') {
        settle(p, 'fulfilled', v);
        return;
      }
      queue.push({
        label: v instanceof MiniPromise ? 'развернуть промис: подписаться на него' : 'вызвать then у thenable',
        run() {
          const inner = resolvingFunctions(p);
          try {
            then.call(v, inner.resolve, inner.reject);
          } catch (e) {
            inner.reject(e);
          }
        },
      });
    };
    return { resolve, reject };
  }

  return MiniPromise;
}
