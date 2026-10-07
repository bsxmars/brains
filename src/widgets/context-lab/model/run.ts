import type { Ctx, LogEntry, MiniApi } from './types';

/**
 * Демо и тест исполняют одни и те же строки темы «Асинхронный контекст»:
 * `GLOBAL_CODE`, `MINI_CODE`, сценарии `SCENARIOS` и `SLEEP_CODE`.
 *
 * `tests/unit/async-context.test.ts` прогоняет сценарии здесь же с настоящим
 * `AsyncLocalStorage` и сверяет журналы: учебной обёртки — с ALS, всех трёх — с литералами
 * темы. Ни DOM, ни Vue — чтобы модуль мог импортировать юнит-тест.
 */

/** «Текущий запрос» в одной переменной — `GLOBAL_CODE`. Каждый вызов даёт новую ячейку. */
export function loadGlobal(code: string): Ctx {
  return new Function(`${code}\nreturn ctx;`)() as Ctx;
}

/** Учебная переменная контекста — `MINI_CODE`. Подмена глобальных функций — только в `install`. */
export function loadMini(code: string): MiniApi {
  return new Function(`${code}\nreturn { Variable, wrap, install, uninstall };`)() as MiniApi;
}

/** Адаптер `ctx` поверх переменной из `MINI_CODE`. */
export function miniCtx(mini: MiniApi): Ctx {
  const v = new mini.Variable();
  return { run: (value, fn) => v.run(value, fn), get: () => v.get() };
}

/**
 * Исполнить сценарий: `sleep` объявлен строкой `SLEEP_CODE` и ищет `setTimeout` в момент
 * вызова — поэтому при включённой обёртке он идёт через подменённый таймер.
 */
export async function runScenario(code: string, sleepCode: string, ctx: Ctx): Promise<LogEntry[]> {
  const logs: LogEntry[] = [];
  const log = (who: string, what: string) => {
    logs.push({ who, what, seen: ctx.get() ?? null });
  };
  const fn = new Function('ctx', 'log', `${sleepCode}\n${code}`) as (c: Ctx, l: typeof log) => unknown;
  await fn(ctx, log);
  return logs;
}

/** Сценарий под учебной обёрткой: подменить, исполнить, вернуть подмену назад при любом исходе. */
export async function runMini(code: string, sleepCode: string, mini: MiniApi): Promise<LogEntry[]> {
  mini.install();
  try {
    return await runScenario(code, sleepCode, miniCtx(mini));
  } finally {
    mini.uninstall();
  }
}
