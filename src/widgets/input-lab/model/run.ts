import type { FieldRun, SimulateFn, WatchFn } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `SIM_CODE` и `WATCH_CODE` из темы
 * «Ввод текста в браузере».
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. `tests/unit/text-input.test.ts`
 * сверяет журнал `simulateField` с журналами Chromium (литералы стенда `STAND_RUNS`) на каждом
 * сценарии, а `watchField` исполняет в настоящем Chromium — этим кодом и сняты журналы.
 * Копии нет: разойдётся показанный код с браузером — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSimulate(code: string): SimulateFn {
  return new Function(`${code}\nreturn simulateField;`)() as SimulateFn;
}

export function loadWatch(code: string): WatchFn {
  return new Function(`${code}\nreturn watchField;`)() as WatchFn;
}

/** Совпадают ли два прогона целиком — журнал, значение и выделение. */
export function sameRun(a: FieldRun, b: FieldRun): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

/** Ключи в одном порядке: литерал стенда и журнал модели собраны в разном. */
function normalize(run: FieldRun) {
  const sortKeys = (o: object) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)));
  return { value: run.value, sel: run.sel, log: run.log.map(sortKeys) };
}
