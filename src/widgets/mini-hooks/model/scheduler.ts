import type { HooksHost } from './build';

/**
 * Планирование для мини-реализации: две очереди, разбираемые по правилу цикла событий —
 * пока есть микрозадачи, они; потом одна задача.
 *
 * Настоящие `queueMicrotask` и `setTimeout` дали бы тот же порядок, но асинхронно, а демо
 * и тесту нужен детерминированный прогон, который можно остановить посреди рендера,
 * вклинить событие и продолжить. Ровно это делает `runOne`.
 */

export interface HooksScheduler {
  host: HooksHost;
  /** Выполнить один колбэк; `false` — очереди пусты. */
  runOne: () => boolean;
  /** Разобрать очереди до конца. */
  drain: () => number;
  pending: () => number;
}

/** Предохранитель: бесконечное перепланирование не имеет права повесить вкладку. */
export const DRAIN_LIMIT = 2_000;

export function createScheduler(shouldYield: () => boolean = () => false): HooksScheduler {
  const micro: Array<() => void> = [];
  const tasks: Array<() => void> = [];

  const runOne = () => {
    const next = micro.length ? micro.shift() : tasks.shift();
    if (!next) return false;
    next();
    return true;
  };

  const drain = () => {
    let done = 0;
    while (runOne()) {
      if (++done >= DRAIN_LIMIT) {
        micro.length = 0;
        tasks.length = 0;
        throw new Error(`очереди не опустели за ${DRAIN_LIMIT} колбэков — похоже на бесконечный цикл обновлений`);
      }
    }
    return done;
  };

  return {
    host: {
      scheduleMicrotask: (callback) => void micro.push(callback),
      scheduleTask: (callback) => void tasks.push(callback),
      shouldYield,
    },
    runOne,
    drain,
    pending: () => micro.length + tasks.length,
  };
}
