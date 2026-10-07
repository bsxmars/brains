import type {
  Cache,
  ComponentView,
  Lab,
  LogLine,
  MiniApi,
  MiniCodes,
  Snapshot,
  Step,
  VirtualClock,
  Who,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки мини-кеша из темы «Кеш данных
 * на клиенте» (`KEY_CODE`, `CACHE_CODE`, `OBSERVE_CODE`, `INVALIDATE_CODE`, `OPTIMISTIC_CODE`,
 * `SHARE_CODE`).
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/data-cache.test.ts`: те же сценарии (`SCENARIOS`) тест исполняет на
 * `@tanstack/query-core` и сверяет, когда уходили запросы и что видел каждый наблюдатель.
 * Копии нет — разойдётся показанный код с библиотекой, покраснеет тест.
 *
 * Время — виртуальное: `createVirtualClock` двигается только по `advance`, поэтому пять минут
 * `gcTime` демо прокручивает мгновенно, и порядок событий не зависит от скорости машины.
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadMini(codes: MiniCodes): MiniApi {
  const body = [codes.key, codes.cache, codes.observe, codes.invalidate, codes.optimistic, codes.share].join('\n');
  return new Function(
    `${body}\nreturn { hashKey, startsWith, createCache, observe, onFocus, invalidate, cancel, getData, setData, addTodo, replaceEqualDeep };`,
  )() as MiniApi;
}

/** Дать доработать всем микрозадачам: промисы мини-кеша продолжаются в них. */
async function microtasks(): Promise<void> {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

export function createVirtualClock(): VirtualClock {
  let now = 0;
  let seq = 0;
  const timers: { at: number; seq: number; fn: () => void }[] = [];
  return {
    now: () => now,
    after(ms, fn) {
      const timer = { at: now + Math.max(0, ms), seq: seq++, fn };
      timers.push(timer);
      return () => {
        const i = timers.indexOf(timer);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    async advance(ms) {
      const end = now + ms;
      await microtasks();
      for (;;) {
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        now = next.at;
        next.fn();
        await microtasks();
      }
      now = end;
    },
  };
}

/** Состояние наблюдателя одной строкой — так его печатают демо, тест и таблицы темы. */
export function describe(s: Snapshot): string {
  const parts = [`${s.status} · ${s.fetchStatus}`];
  if (Array.isArray(s.data)) parts.push(`[${s.data.join(', ')}]`);
  if (s.failures) parts.push(`неудач: ${s.failures}`);
  return parts.join(' ');
}

/** Последовательность без повторов подряд: так сравниваются наблюдатели разных библиотек. */
export function collapse(list: string[]): string[] {
  return list.filter((x, i) => x !== list[i - 1]);
}

export const MOUNT = 'монтирование';
export const UNMOUNT = 'размонтирование';

export interface LabOptions {
  staleTime: number;
  /** Сколько сервер думает над запросом, мс. */
  latency: number;
  /** Что лежит на сервере с самого начала. */
  todos: string[];
}

/** Стенд демо: сервер, мини-кеш на виртуальных часах и два компонента с одним ключом `['todos']`. */
export function createLab(codes: MiniCodes, options: LabOptions): Lab {
  const api = loadMini(codes);
  const clock = createVirtualClock();
  const cache: Cache = api.createCache(clock);
  const key = ['todos'];

  const server = { todos: [...options.todos], failNext: 0 };
  const calls: number[] = [];
  const posts: number[] = [];
  const log: LogLine[] = [];
  const seen: Record<Who, string[]> = { A: [], B: [] };
  const comps = new Map<Who, ComponentView & { off: (() => void) | null }>([
    ['A', { id: 'A', mounted: false, last: null, seen: 0, off: null }],
    ['B', { id: 'B', mounted: false, last: null, seen: 0, off: null }],
  ]);

  const say = (who: LogLine['who'], text: string, tone?: LogLine['tone']) => log.push({ t: clock.now(), who, text, tone });

  const get = (): Promise<string[]> => {
    calls.push(clock.now());
    const n = calls.length;
    const fail = server.failNext > 0;
    if (fail) server.failNext--;
    say('сеть', `GET /todos №${n}`);
    return new Promise((resolve, reject) => {
      clock.after(options.latency, () => {
        if (fail) {
          say('сеть', `№${n} → 503`, 'err');
          reject(new Error('503'));
        } else {
          say('сеть', `№${n} → 200 [${server.todos.join(', ')}]`, 'ok');
          resolve([...server.todos]);
        }
      });
    });
  };

  const send = (fail: boolean) => (title: string): Promise<void> => {
    posts.push(clock.now());
    say('сеть', `POST /todos «${title}»`);
    return new Promise((resolve, reject) => {
      clock.after(options.latency, () => {
        if (fail) {
          say('сеть', 'POST → 500', 'err');
          reject(new Error('500'));
        } else {
          server.todos.push(title);
          say('сеть', 'POST → 201', 'ok');
          resolve();
        }
      });
    });
  };

  async function run(step: Step): Promise<void> {
    if (step.do === 'wait') {
      await clock.advance(step.ms);
      return;
    }
    if (step.do === 'mount' || step.do === 'unmount') {
      const c = comps.get(step.who)!;
      if ((step.do === 'mount') === c.mounted) return;
      if (step.do === 'mount') {
        seen[step.who].push(MOUNT);
        say(step.who, 'смонтирован', 'info');
        c.mounted = true;
        c.off = api.observe(cache, key, { fn: get, staleTime: options.staleTime }, (s) => {
          c.last = s;
          c.seen++;
          seen[step.who].push(describe(s));
          say(step.who, `видит ${describe(s)}`);
        });
      } else {
        c.off?.();
        c.off = null;
        c.mounted = false;
        seen[step.who].push(UNMOUNT);
        say(step.who, 'размонтирован', 'info');
      }
    } else if (step.do === 'focus') {
      say('кеш', 'окно снова в фокусе', 'info');
      api.onFocus(cache);
    } else if (step.do === 'serverFails') {
      server.failNext = step.n;
      say('кеш', `сервер ответит ошибкой ${step.n} раза подряд`, 'warn');
    } else if (step.do === 'add') {
      say('кеш', `оптимистично добавляем «${step.title}»`, 'info');
      void api.addTodo(cache, step.title, send(Boolean(step.fail)));
    }
    await clock.advance(0);
  }

  return {
    run,
    view() {
      const entry = cache.entries.get(api.hashKey(key));
      return {
        now: clock.now(),
        calls: [...calls],
        log: [...log],
        components: [...comps.values()].map(({ id, mounted, last, seen: n }) => ({ id, mounted, last, seen: n })),
        entry: entry
          ? {
              hash: entry.hash,
              status: entry.status,
              fetchStatus: entry.fetchStatus,
              data: Array.isArray(entry.data) ? `[${entry.data.join(', ')}]` : 'undefined',
              updatedAt: entry.updatedAt,
              stale: entry.data === undefined || entry.invalidated || clock.now() - entry.updatedAt >= options.staleTime,
              observers: entry.observers.size,
              inFlight: entry.promise !== null,
              failures: entry.failures,
            }
          : null,
      };
    },
    trace: () => ({ calls: [...calls], posts: [...posts], seen: { A: collapse(seen.A), B: collapse(seen.B) } }),
    stop() {
      for (const c of comps.values()) c.off?.();
    },
  };
}
