/**
 * Крошечная модель промиса на уровне спеки: четыре скрытых поля, очередь микрозадач и три
 * операции, из которых выводится вся таблица стоимости.
 *
 * Зачем модель, если рядом уже есть настоящий замер. Замер отвечает «сколько», но не «почему»:
 * в консоли видно, что результат выпал после второй ступени линейки, и не видно, какие job
 * этому предшествовали. Модель рассказывает вторую половину — что именно исполнилось на каждом
 * тике и как это называется в спеке.
 *
 * Честность обеспечивается снаружи: `tests/unit/promise-sim.test.ts` сверяет цену, посчитанную
 * моделью, с ценой, которую даёт настоящий движок на том же примере. Разойдутся — тест упадёт,
 * и это ровно тот случай, ради которого он написан: модель, которую никто не проверяет,
 * рассказывает красивую историю про несуществующий порядок.
 *
 * Один и тот же рантайм обслуживает оба демо урока: линейка прогоняет программу до конца
 * (`simulate`), а живой объект промиса дёргает те же операции по кнопкам и сливает очередь
 * по шагам (`createRuntime`). Семантика обязана быть одна — иначе два демо на одной странице
 * начнут рассказывать разное.
 *
 * Чего здесь намеренно нет: отказов, `[[PromiseIsHandled]]`, комбинаторов как таковых. Модель
 * объясняет цену подписки и резолва, а не заменяет движок.
 */

export type JobKind = 'reaction' | 'thenable-job' | 'then-reaction' | 'plain';

/** Одна микрозадача в очереди — и одна строка на ленте. */
export interface TraceStep {
  tick: number;
  /** Имя из спеки: так это называется в тексте урока. */
  job: string;
  /** Что job делает. */
  note: string;
  kind: JobKind;
  /** Тот самый тик, на котором становится виден результат. */
  hit: boolean;
}

export interface Job {
  job: string;
  note: string;
  kind: JobKind;
  run: () => void;
}

export interface SimPromise {
  state: 'pending' | 'fulfilled';
  /** `[[PromiseFulfillReactions]]`: пока промис pending, это просто список. */
  reactions: Job[];
}

/** Объект с методом `then`, который зовёт `resolveFn` синхронно, — «чужой» thenable. */
export interface SyncThenable {
  thenable: true;
  label: string;
}

export interface Runtime {
  /** Уже завершённый промис. */
  settled(): SimPromise;
  /** Промис в ожидании: `new Promise`, промис async-функции, звено цепочки. */
  pending(): SimPromise;
  /** Объект с `then`, зовущим `resolveFn` сразу. */
  syncThenable(label: string): SyncThenable;

  /**
   * Операция 1. Подписка: на pending — запись в список (0 тиков), на settled — сразу job.
   * `hit: true` помечает реакцию, ради которой всё и считается.
   */
  performPromiseThen(
    target: SimPromise,
    label: string,
    options?: { hit?: boolean; then?: () => void },
  ): void;

  /** Операция 2. Резолв: значением — сразу, thenable — через job разворачивания. */
  resolvePromise(target: SimPromise, value: SimPromise | SyncThenable | 'value'): void;

  /** Операция 3. Вход: нативный промис возвращается как есть, остальное заворачивается. */
  promiseResolve(value: SimPromise | 'value'): SimPromise;

  /** Микрозадача без промиса вообще — `queueMicrotask`. */
  enqueue(job: string, note: string, options?: { hit?: boolean }): void;
}

export interface SimRuntime extends Runtime {
  /** Очередь микрозадач — её видно в демо. */
  readonly queue: Job[];
  /** Сколько тиков уже потрачено. */
  readonly tick: number;
  /** Тик, на котором сработала помеченная реакция; 0 — ещё не сработала. */
  readonly price: number;
  /** Исполнить одну микрозадачу. `null` — очередь пуста. */
  step(): TraceStep | null;
  /** Слить очередь до конца. */
  drain(limit?: number): TraceStep[];
}

export type Program = (rt: Runtime) => void;

export interface SimResult {
  steps: TraceStep[];
  /** Цена в тиках: номер тика, на котором сработала помеченная реакция. */
  price: number;
}

export function createRuntime(): SimRuntime {
  const queue: Job[] = [];
  let tick = 0;
  let hitTick = 0;

  const fulfill = (target: SimPromise) => {
    target.state = 'fulfilled';
    // Списки реакций опустошаются в очередь — вот здесь и тратятся тики.
    for (const reaction of target.reactions.splice(0)) queue.push(reaction);
  };

  const rt: SimRuntime = {
    get queue() {
      return queue;
    },
    get tick() {
      return tick;
    },
    get price() {
      return hitTick;
    },

    settled: () => ({ state: 'fulfilled', reactions: [] }),
    pending: () => ({ state: 'pending', reactions: [] }),
    syncThenable: (label) => ({ thenable: true, label }),

    performPromiseThen(target, label, options = {}) {
      const reaction: Job = {
        job: 'реакция',
        note: label,
        kind: 'reaction',
        run: () => {
          if (options.hit) hitTick = tick;
          options.then?.();
        },
      };
      if (target.state === 'pending') {
        // Подписка на pending не стоит ничего: это запись в массив.
        target.reactions.push(reaction);
      } else {
        queue.push(reaction);
      }
    },

    resolvePromise(target, value) {
      if (value === 'value') {
        fulfill(target);
        return;
      }

      // Всё, у чего `then` оказался функцией, разворачивается через отдельную job.
      queue.push({
        job: 'NewPromiseResolveThenableJob',
        note:
          'thenable' in value
            ? `job зовёт then(resolveFn) — ${value.label} зовёт resolveFn прямо здесь`
            : 'job зовёт then(resolveFn) нативного промиса',
        kind: 'thenable-job',
        run: () => {
          if ('thenable' in value) {
            // Синхронный thenable зовёт resolveFn внутри самой job — лишнего тика нет.
            fulfill(target);
          } else {
            // У нативного промиса свой `then`: он ставит ещё одну реакцию, и это второй тик.
            rt.performPromiseThen(value, 'resolveFn фулфилит промис', {
              then: () => fulfill(target),
            });
          }
        },
      });
    },

    promiseResolve(value) {
      // Нативный промис проходит без обёртки — ровно этим вход отличается от выхода.
      if (value !== 'value') return value;
      return { state: 'fulfilled', reactions: [] };
    },

    enqueue(job, note, options = {}) {
      queue.push({
        job,
        note,
        kind: 'plain',
        run: () => {
          if (options.hit) hitTick = tick;
        },
      });
    },

    step() {
      const job = queue.shift();
      if (!job) return null;
      tick += 1;
      const before = hitTick;
      job.run();
      return { tick, job: job.job, note: job.note, kind: job.kind, hit: hitTick !== before };
    },

    drain(limit = 32) {
      const steps: TraceStep[] = [];
      while (queue.length && steps.length < limit) {
        const step = rt.step();
        if (!step) break;
        steps.push(step);
      }
      return steps;
    },
  };

  return rt;
}

export function simulate(program: Program): SimResult {
  const rt = createRuntime();
  program(rt);
  const steps = rt.drain();
  return { steps, price: rt.price };
}
