import type { GraphScenario, GraphStep, MiniSignals, SignalsApi, TraceEntry } from './types';

/**
 * Сборка реализаций из строк и прогон сценариев графа.
 *
 * Демо и тест собирают реализацию одним и тем же кодом — этим модулем. Строки напечатаны
 * в теме по шагам; если текст на странице разойдётся с поведением, покраснеет
 * `tests/unit/signals.test.ts`, который берёт те же строки и гоняет те же сценарии ещё
 * и на `@vue/reactivity` и alien-signals.
 *
 * Ни DOM, ни Vue-компонентов: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Имена, под которыми код примеров видит реализацию. Порядок = порядок параметров. */
export const API_NAMES = ['signal', 'computed', 'effect', 'batch'] as const satisfies readonly (keyof SignalsApi)[];

/** Свежий экземпляр: у каждого свой граф, своя очередь и свой счётчик пакетов. */
export function loadSignals(code: string): MiniSignals {
  return new Function(code)() as MiniSignals;
}

/**
 * Применить подмены по одной строке. Каждый подменяемый текст обязан существовать: иначе
 * «сломанный вариант» молча совпал бы с оригиналом и доказывал бы несуществующее.
 */
export function patchCode(code: string, patches: readonly (readonly [find: string, replace: string])[]): string {
  let out = code;
  for (const [find, replace] of patches) {
    if (!out.includes(find)) throw new Error(`В коде нет строки «${find.trim()}» — шаг переписан, подмена устарела`);
    out = out.replace(find, replace);
  }
  return out;
}

/**
 * Живой сценарий графа на одной реализации.
 *
 * `count(имя)` и `log(текст, согласовано?)` — единственное, что сценарий сообщает наружу;
 * оба одинаково честны для любой реализации, потому что вызываются из кода сценария,
 * а не читают её внутренности.
 */
export class GraphLab {
  private readonly counts: Record<string, number> = {};
  private trace: TraceEntry[] = [];
  private readonly act: (index: number) => void;

  constructor(api: SignalsApi, scenario: Pick<GraphScenario, 'setup' | 'actions'>) {
    const cases = scenario.actions.map((code, i) => `case ${i}: { ${code} } break;`).join('\n');
    const body = `${scenario.setup}\nreturn function act(i) { switch (i) {\n${cases}\n} };`;
    const factory = new Function(...API_NAMES, 'count', 'log', body);
    const count = (name: string) => {
      this.counts[name] = (this.counts[name] ?? 0) + 1;
      this.trace.push({ kind: 'run', name });
    };
    const log = (text: string, consistent?: boolean) => {
      this.trace.push(consistent === undefined ? { kind: 'log', text } : { kind: 'log', text, consistent });
    };
    this.act = factory(...API_NAMES.map((name) => api[name]), count, log) as (index: number) => void;
  }

  /** Всё, что случилось при установке, — первый шаг. */
  start(): GraphStep {
    return this.take();
  }

  step(index: number): GraphStep {
    this.act(index);
    return this.take();
  }

  private take(): GraphStep {
    const out = { trace: this.trace, counts: { ...this.counts } };
    this.trace = [];
    return out;
  }
}
