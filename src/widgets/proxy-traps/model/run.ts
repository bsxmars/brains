import type { ProxyOp, TrapCall } from './types';

/**
 * Пульт ловушек спрашивает движок, а не таблицу.
 *
 * До 2026-10-02 демо листало литерал `PROXY_OPS`: последовательности ловушек были сняты одним
 * разовым запуском и дальше жили строками. Теперь каждую операцию исполняет строка `TRACE_CODE`
 * из темы «Proxy и Reflect» — тот самый handler, что напечатан на странице: тринадцать ловушек,
 * каждая отмечается в журнале и делегирует в `Reflect`. Литерал в `data.ts` остался ради
 * подписей к ловушкам, а совпадение литерала с журналом движка сторожит
 * `tests/unit/proxy-reflect.test.ts`, вызывая **этот же модуль**.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** То, что возвращает `trace(target)` из `TRACE_CODE`. */
export interface Traced {
  p: object;
  log: string[];
}

export type TraceFn = (target: object) => Traced;

export interface OpRun {
  /** Журнал, свёрнутый по подряд идущим одинаковым ловушкам: `getOwnPropertyDescriptor × 2`. */
  calls: TrapCall[];
  /** Всего обращений к handler'у. */
  total: number;
  /** Результат операции в записи, как в литерале `res`: `'Аня'`, `['name', 'age']`, `p`, имя ошибки. */
  res: string;
  threw: boolean;
}

export function loadTrace(code: string): TraceFn {
  return new Function(`${code}\nreturn trace;`)() as TraceFn;
}

/** Свернуть журнал: подряд идущие одинаковые имена — одна строка с `times`. */
export function groupLog(log: string[]): TrapCall[] {
  const out: TrapCall[] = [];
  for (const name of log) {
    const last = out[out.length - 1];
    if (last && last.name === name) last.times = (last.times ?? 1) + 1;
    else out.push({ name });
  }
  return out;
}

/** Значение — в ту запись, которой подписан результат на странице. */
export function formatValue(value: unknown, proxy: object): string {
  if (value === proxy) return 'p';
  if (typeof value === 'string') return `'${value}'`;
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v, proxy)).join(', ')}]`;
  return String(value);
}

/**
 * Выполнить операцию над прокси с журналом. Тело — `code`, а если его нет, сама подпись `op`
 * как выражение (перевод строки после неё обязателен: подпись может кончаться комментарием).
 * `target` — выражение, создающее цель; по умолчанию — общая цель пульта. Внутри тела видны
 * и прокси `p`, и сама цель `target` — для операции `p === target`.
 */
export function runOp(trace: TraceFn, op: ProxyOp, defaultTarget: string): OpRun {
  const target = new Function(`"use strict"; return (${op.target ?? defaultTarget});`)() as object;
  const { p, log } = trace(target);
  const body = op.code ?? `return (\n${op.op}\n);`;
  let res: string;
  let threw = false;
  try {
    res = formatValue(new Function('p', 'target', `"use strict";\n${body}`)(p, target), p);
  } catch (error) {
    threw = true;
    res = (error as Error).name;
  }
  // Ловушки, вызванные после броска, в журнал не попадают: бросок прерывает операцию.
  const calls = groupLog(log);
  return { calls, total: log.length, res, threw };
}
