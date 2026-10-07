import type { PoolOrder, RunLoop } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `LOOP_CODE` и `POOL_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/node-event-loop.test.ts` против настоящего Node: сценарии темы запускаются
 * в отдельных процессах, и их вывод сверяется с выводом модели. Копии нет — если показанный
 * код разойдётся с Node, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadLoop(code: string): RunLoop {
  return new Function(`${code}\nreturn runLoop;`)() as RunLoop;
}

export function loadPool(code: string): PoolOrder {
  return new Function(`${code}\nreturn poolOrder;`)() as PoolOrder;
}

/** Вывод одной строкой — так он хранится в `real` у сценария. */
export const joinOut = (out: string[]) => out.join(' ');

/**
 * Допустимые порядки: модель на быстрой (`slack` 0) и медленной (1 мс) машине.
 * Один элемент — порядок от скорости не зависит.
 */
export function allowedOrders(runLoop: RunLoop, code: string): string[] {
  return [...new Set([0, 1].map((slack) => joinOut(runLoop(code, slack).out)))];
}
