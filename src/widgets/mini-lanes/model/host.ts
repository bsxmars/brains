import type { LanesHostConfig } from './build';

/**
 * Хост с виртуальными часами.
 *
 * Время здесь не течёт само: его двигает только `advance(ms)` — компонент сценария зовёт
 * `work(ms)`, и это значит «я считал столько-то миллисекунд». Поэтому квант в 5 мс,
 * прерывание и просрочка полос воспроизводятся одинаково в тесте, в демо и на любой машине:
 * ни `performance.now()`, ни настоящих таймеров в прогоне нет.
 *
 * Очередей две, как у цикла событий: микрозадачи и макрозадачи. `runOne()` выполняет один
 * колбэк по правилу цикла — пока есть микрозадачи, они; потом одна макрозадача.
 */
export interface ClockHost {
  host: LanesHostConfig;
  advance: (ms: number) => void;
  time: () => number;
  /** Что сейчас «на экране» — разметка последнего коммита. */
  markup: () => string;
  commits: string[];
  /** Выполнить один колбэк; `null` — очереди пусты. */
  runOne: () => 'micro' | 'task' | null;
  /** Разобрать очереди до конца. */
  drain: () => number;
  micro: () => number;
  tasks: () => number;
}

/** Страховка: демо не имеет права повесить вкладку бесконечным перепланированием. */
const DRAIN_LIMIT = 10_000;

export interface ClockHostOptions {
  onCommit?: (markup: string) => void;
  onSchedule?: (kind: 'micro' | 'task', name: string) => void;
}

export function createClockHost(options: ClockHostOptions = {}): ClockHost {
  let now = 0;
  let screen = '';
  const commits: string[] = [];
  const micro: Array<() => void> = [];
  const tasks: Array<() => void> = [];

  const host: LanesHostConfig = {
    now: () => now,
    postTask(callback) {
      tasks.push(callback);
      options.onSchedule?.('task', callback.name);
    },
    scheduleMicrotask(callback) {
      micro.push(callback);
      options.onSchedule?.('micro', callback.name);
    },
    commit(markup) {
      screen = markup;
      commits.push(markup);
      options.onCommit?.(markup);
    },
  };

  const runOne = () => {
    if (micro.length) {
      micro.shift()!();
      return 'micro' as const;
    }
    if (tasks.length) {
      tasks.shift()!();
      return 'task' as const;
    }
    return null;
  };

  const drain = () => {
    let done = 0;
    while (runOne()) {
      if (++done >= DRAIN_LIMIT) throw new Error(`очередь хоста не опустела за ${DRAIN_LIMIT} колбэков`);
    }
    return done;
  };

  return {
    host,
    advance: (ms) => {
      now += ms;
    },
    time: () => now,
    markup: () => screen,
    commits,
    runOne,
    drain,
    micro: () => micro.length,
    tasks: () => tasks.length,
  };
}
