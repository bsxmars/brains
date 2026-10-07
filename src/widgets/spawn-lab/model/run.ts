import { createMiniPromise, preview, type MiniJob } from './mini-promise';
import type { SpawnFixture, SpawnScenario, SpawnStep, SpawnTrace } from './types';

/**
 * Демо и тест исполняют одни и те же строки темы: `SPAWN_CODE`, `HELPERS_CODE`, `DRIVER_CODE`
 * и код сценариев. Копий нет — строки собираются `new Function`.
 *
 * Два способа исполнить сценарий:
 * — `runNative` — на настоящем `Promise` движка: и `async`-версию, и версию через `spawn`;
 * — `traceScenario` — версию через `spawn` на `MiniPromise`, чтобы показать очередь по шагам.
 *
 * Тест требует, чтобы все три вывода совпали; демо в браузере сверяет то же самое на месте.
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

type Spawn = (genFn: (...a: unknown[]) => Iterator<unknown>, ...args: unknown[]) => unknown;

export function loadSpawn(spawnCode: string, PromiseImpl: unknown = Promise): Spawn {
  return new Function('Promise', `${spawnCode}\nreturn spawn;`)(PromiseImpl) as Spawn;
}

/** Тело программы сценария: «запросы», функция `load` и код, который её зовёт. */
function program(fx: SpawnFixture, loadCode: string): string {
  return `${fx.helpersCode}\n${loadCode}\n${fx.driverCode}`;
}

/** Дождаться, пока очередь микрозадач опустеет: таймер — следующая задача. */
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

/** Сценарий на настоящем `Promise`. `code` — `asyncCode` или `genCode` сценария. */
export async function runNative(fx: SpawnFixture, code: string): Promise<string[]> {
  const out: string[] = [];
  const spawn = loadSpawn(fx.spawnCode);
  new Function('spawn', 'log', program(fx, code))(spawn, (s: string) => out.push(s));
  await drain();
  return out;
}

/** Номера строк кода (с нуля), где стоит слово — `yield` или `await`. */
export function linesWith(code: string, word: 'yield' | 'await'): number[] {
  const re = new RegExp(`\\b${word}\\b`);
  return code.split('\n').flatMap((line, i) => (re.test(line) ? [i] : []));
}

/**
 * Пошаговое исполнение версии через `spawn` на `MiniPromise`.
 *
 * Шаг 0 — синхронная часть программы; каждый следующий — одна микрозадача. Генератор,
 * который сценарий отдаёт в `spawn`, обёрнут: обёртка записывает каждый `next`/`throw`
 * и его итог, чтобы подписать шаг словами. Сам генератор и `spawn` исполняются как есть.
 */
export function traceScenario(fx: SpawnFixture, sc: SpawnScenario, limit = 200): SpawnTrace {
  const queue: MiniJob[] = [];
  const Mini = createMiniPromise(queue);
  const spawn = loadSpawn(fx.spawnCode, Mini);

  const out: string[] = [];
  let pause = 0;
  let done = false;
  let state = 'не создан';
  let events: string[] = [];

  /** Значение для подписи: промис и thenable — словом, остальное — кодом. */
  const show = (v: unknown) => {
    const p = preview(v, Mini);
    return p === 'промис' || p === 'thenable' ? p : `\`${p}\``;
  };

  function wrap(genFn: (...a: unknown[]) => Iterator<unknown>) {
    return function (this: unknown, ...args: unknown[]) {
      const gen = genFn.apply(this, args);
      state = 'создан, тело не выполнялось';
      const call = (method: 'next' | 'throw', arg: unknown) => {
        const first = pause === 0;
        events.push(
          method === 'next'
            ? first
              ? '`gen.next()` — тело генератора пошло с начала.'
              : `\`gen.next(${preview(arg, Mini)})\` — генератор продолжил с паузы, \`yield\` вернул ${show(arg)}.`
            : `\`gen.throw(${preview(arg, Mini)})\` — ошибка брошена внутрь генератора, в точку паузы.`,
        );
        let r: IteratorResult<unknown>;
        try {
          r = method === 'next' ? gen.next(arg) : gen.throw!(arg);
        } catch (e) {
          done = true;
          state = `завершён: бросил ${preview(e, Mini)}`;
          events.push(`Ошибка вылетела из генератора — \`spawn\` передаёт в \`reject\` ${show(e)}, промис \`load\` отклонён.`);
          throw e;
        }
        if (r.done) {
          done = true;
          state = `завершён: вернул ${preview(r.value, Mini)}`;
          events.push(`Генератор дошёл до \`return\` — \`spawn\` передаёт в \`resolve\` ${show(r.value)}.`);
        } else {
          pause += 1;
          state = `стоит на yield №${pause}`;
          events.push(
            `Генератор встал на \`yield\` и отдал ${show(r.value)} — \`spawn\` подписывается на него через \`then\`.`,
          );
        }
        return r;
      };
      return {
        next: (v: unknown) => call('next', v),
        throw: (e: unknown) => call('throw', e),
        return: (v: unknown) => gen.return!(v),
      };
    };
  }

  const tracedSpawn: Spawn = (genFn, ...args) => spawn(wrap(genFn), ...args);

  const snap = (title: string): SpawnStep => {
    const step: SpawnStep = {
      title,
      detail: events.join(' '),
      queue: queue.map((j) => j.label),
      console: [...out],
      pause,
      done,
      state,
    };
    events = [];
    return step;
  };

  const steps: SpawnStep[] = [];
  new Function('spawn', 'log', 'Promise', program(fx, sc.genCode))(tracedSpawn, (s: string) => out.push(s), Mini);
  steps.push(snap('Синхронный код программы: от вызова `load(1)` до последней строки.'));

  while (queue.length && steps.length < limit) {
    const job = queue.shift()!;
    job.run();
    steps.push(snap(/^[а-яё]/i.test(job.label) ? `Микрозадача: ${job.label}.` : `Микрозадача \`${job.label}\`.`));
  }

  return { steps, log: out };
}
