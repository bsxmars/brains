import type {
  DepRow,
  LogEntry,
  MiniComputed,
  MiniDep,
  MiniEffect,
  MiniScenario,
  MiniVue,
  ReactivityApi,
  StepResult,
  SubRef,
} from './types';

/**
 * Демо и тест спрашивают реактивность одним и тем же кодом — этим модулем.
 *
 * `loadMiniVue` собирает мини-реализацию из строки `MINI_VUE_CODE`: той, что напечатана
 * в теме по шагам. Копии нет — если текст на странице разойдётся с поведением,
 * покраснеет `tests/unit/vue-internals.test.ts`, который берёт ту же строку.
 *
 * `compileScenario` исполняет сценарий против **любой** реализации с публичными именами Vue.
 * Демо подставляет мини-версию, тест — ещё и `@vue/runtime-core` в обеих сборках. Поэтому
 * фраза «мини-версия ведёт себя как Vue» здесь не пересказ, а сверка одного кода.
 *
 * Ни DOM, ни Vue-компонентов: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Имена, под которыми сценарий видит реализацию. Порядок = порядок параметров функции. */
export const API_NAMES = [
  'reactive',
  'toRaw',
  'ref',
  'shallowRef',
  'computed',
  'effect',
  'stop',
  'watch',
  'watchEffect',
  'nextTick',
] as const satisfies readonly (keyof ReactivityApi)[];

/** Свежий экземпляр мини-Vue: у каждого свой `targetMap` и своя очередь. */
export function loadMiniVue(code: string): MiniVue {
  return new Function(code)() as MiniVue;
}

export interface CompiledScenario {
  state: object;
  act: (index: number) => void;
}

/**
 * Собрать сценарий: код установки плюс по ветке `switch` на каждую кнопку.
 *
 * Кнопки обязаны видеть локальные имена установки (`state`, `total`), поэтому они живут
 * в одном теле функции с ней, а не отдельными функциями.
 */
export function compileScenario(
  api: ReactivityApi,
  scenario: MiniScenario,
  log: (text: string) => void,
): CompiledScenario {
  const cases = scenario.actions.map((code, i) => `case ${i}: { ${code} } break;`).join('\n');
  const body = `${scenario.setup}\nreturn { state, act(i) { switch (i) {\n${cases}\n} } };`;
  const factory = new Function(...API_NAMES, 'log', body);
  return factory(...API_NAMES.map((name) => api[name]), log) as CompiledScenario;
}

const nameOf = (e: MiniEffect | null): string | null => (e ? e.fn.name || 'анонимный' : null);

function subRef(e: MiniEffect): SubRef {
  return { name: nameOf(e) ?? '', kind: e.computed ? 'computed' : e.scheduler ? 'job' : 'effect' };
}

/**
 * Снимок графа: всё, что лежит в `targetMap` для объекта `state`, плюс `Dep` каждого
 * `computed`, до которого можно дойти по подписчикам.
 *
 * `targetMap` — `WeakMap`, обойти её нельзя, и это правильно: демо спрашивает её ровно
 * так же, как спрашивает сама реализация, — `targetMap.get(исходный объект)`.
 */
export function snapshotGraph(mini: MiniVue, state: object): DepRow[] {
  const rows: DepRow[] = [];
  const depsMap = mini.targetMap.get(mini.toRaw(state));
  const pending: MiniComputed[] = [];
  const seen = new Set<MiniComputed>();

  const collect = (dep: MiniDep) =>
    [...dep].map((e) => {
      if (e.computed && !seen.has(e.computed)) {
        seen.add(e.computed);
        pending.push(e.computed);
      }
      return subRef(e);
    });

  for (const [key, dep] of depsMap ?? []) {
    const iterate = key === mini.ITERATE_KEY;
    rows.push({
      label: iterate ? 'state · перебор ключей' : `state.${String(key)}`,
      kind: iterate ? 'iterate' : 'key',
      version: dep.version,
      subs: collect(dep),
    });
  }

  while (pending.length) {
    const c = pending.shift()!;
    rows.push({
      label: `${nameOf(c.effect)} · computed`,
      kind: 'computed',
      version: c.dep.version,
      subs: collect(c.dep),
      dirty: c.dirty,
    });
  }

  return rows;
}

/**
 * Живой сеанс демо: одна мини-реализация, один сценарий, журнал.
 *
 * Каждый шаг идёт в два приёма, как и в настоящем Vue: синхронная часть (запись и всё,
 * что проснулось сразу) — и микрозадача, в которой сливается очередь. Между ними снимается
 * содержимое очереди: это единственный момент, когда его вообще можно увидеть.
 */
export class MiniSession {
  readonly mini: MiniVue;
  private readonly source: MiniScenario;
  private scenario: CompiledScenario | null = null;
  private lines: LogEntry[] = [];

  constructor(code: string, source: MiniScenario) {
    this.mini = loadMiniVue(code);
    this.source = source;
  }

  private log = (text: string) => {
    this.lines.push({ text, active: nameOf(this.mini.getActiveEffect()) });
  };

  private async step(run: () => void): Promise<StepResult> {
    this.lines = [];
    run();
    const sync = this.lines;
    const queued = {
      pre: this.mini.queue.map((job) => nameOf(job.effect) ?? ''),
      post: this.mini.postQueue.map((job) => nameOf(job.effect) ?? ''),
    };

    this.lines = [];
    await this.mini.nextTick();
    const flush = this.lines;
    this.lines = [];

    return { sync, queued, flush, graph: this.graph(), active: nameOf(this.mini.getActiveEffect()) };
  }

  /** Выполнить установку сценария: первые прогоны эффектов и первое наполнение графа. */
  start(): Promise<StepResult> {
    return this.step(() => {
      this.scenario = compileScenario(this.mini, this.source, this.log);
    });
  }

  /** Нажать кнопку сценария. */
  act(index: number): Promise<StepResult> {
    return this.step(() => this.scenario?.act(index));
  }

  graph(): DepRow[] {
    return this.scenario ? snapshotGraph(this.mini, this.scenario.state) : [];
  }
}
