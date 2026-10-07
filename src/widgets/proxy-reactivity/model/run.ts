import type { JournalLine, ReactiveApi } from './types';

/**
 * Демо и тест гоняют одну и ту же строку — `REACTIVE_CODE` из темы «Proxy и Reflect».
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/proxy-reflect.test.ts` против `@vue/reactivity`. Копии нет: если показанный код
 * разойдётся с Vue, покраснеет тест. Ни DOM, ни Vue: чистые функции — их импортирует тест,
 * а настоящий Vue в демо подставляет компонент.
 */

/** Собрать мини-реактивность; `trace` получает строки `track …` и `trigger …`. */
export function loadMini(code: string, trace: (line: string) => void = () => {}): ReactiveApi {
  return new Function('trace', `${code}\nreturn { reactive, effect };`)(trace) as ReactiveApi;
}

/**
 * Тот же код, но с потерянным receiver: одна строка подменена на другую. Подменяемое сначала
 * ищется — если его в коде больше нет, лучше упасть, чем молча показать неподменённый код.
 */
export function replaceOnce(code: string, from: string, to: string): string {
  if (!code.includes(from)) throw new Error(`в коде нет строки «${from}» — подменять нечего`);
  return code.replace(from, to);
}

/** Выполнить сценарий над данной реализацией; `log` получает вывод эффектов. */
export function runScenario(api: ReactiveApi, scenario: string, log: (line: string) => void): void {
  new Function('reactive', 'effect', 'log', scenario)(api.reactive, api.effect, (x: unknown) => log(String(x)));
}

/** Журнал мини-версии: служебные строки и вывод эффектов в том порядке, в каком они случились. */
export function journal(code: string, scenario: string): JournalLine[] {
  const lines: JournalLine[] = [];
  const api = loadMini(code, (text) => lines.push({ kind: 'trace', text }));
  runScenario(api, scenario, (text) => lines.push({ kind: 'out', text }));
  return lines;
}

/** Только вывод эффектов — то, что сравнивается с Vue. */
export function outputOf(api: ReactiveApi, scenario: string): string[] {
  const out: string[] = [];
  runScenario(api, scenario, (text) => out.push(text));
  return out;
}
