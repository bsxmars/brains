import { evalModule, VNODE_HELPERS } from './module';
import { DomProbe } from './probe';
import type { DomOp, MiniRef, MiniScope, MiniVapor, Scenario, VaporStep, VdomStep } from './types';

/**
 * Две стороны демо и теста: VDOM-компонент и тот же компонент на мини-vapor.
 *
 * Ни одна из сторон не пересказывает данные: VDOM-сторона исполняет литерал вывода
 * VDOM-компилятора на переданном ей Vue (в демо — 3.5 сайта, в тесте — 3.5 и 3.6),
 * мини-сторона компилирует шаблон строкой `MINI_VAPOR_CODE`. Обе меряются одним щупом
 * `DomProbe`, так что их DOM-операции — одно и то же число про одно и то же.
 *
 * Ни DOM-окружения, ни Vue-компонентов здесь нет: модуль импортирует юнит-тест.
 */

/** Имена ячеек компонента — порядок их объявления в `<script setup>`. */
export const BINDINGS = ['title', 'count', 'items'] as const;
type Refs = Record<(typeof BINDINGS)[number], MiniRef>;

/** Свежий мини-vapor: своя очередь, свои счётчики. */
export function loadMiniVapor(code: string): MiniVapor {
  return new Function(code)() as MiniVapor;
}

/** Исполнить действие над ячейками: `count.value++` и т. п. */
export function applyScenario(refs: Refs, code: string): void {
  new Function(...BINDINGS, code)(...BINDINGS.map((name) => refs[name]));
}

/** Минимум Vue, который нужен VDOM-стороне. Настоящие типы Vue сюда не тянутся нарочно. */
export interface VueLike {
  ref(value: unknown): MiniRef;
  nextTick(): Promise<void>;
  createApp(component: unknown): { mount(el: Element): unknown; unmount(): void };
  [helper: string]: unknown;
}

interface Component {
  setup: (...args: unknown[]) => (...args: unknown[]) => unknown;
}

export interface Measured<T> {
  step: T;
  ops: DomOp[];
}

export class VdomSide {
  readonly refs = {} as Refs;
  private counts = { render: 0, vnodes: 0 };
  private app: ReturnType<VueLike['createApp']>;

  /** `code` — вывод `compileScript` без `vapor`; `container` — пустой элемент в документе. */
  constructor(
    private readonly vue: VueLike,
    code: string,
    readonly container: Element,
    private readonly env?: ConstructorParameters<typeof DomProbe>[1],
  ) {
    const counts = this.counts;
    const created: MiniRef[] = [];
    const deps: Record<string, unknown> = { ...vue, ref: (v: unknown) => (created.push(vue.ref(v)), created.at(-1)) };
    for (const name of VNODE_HELPERS) {
      const original = vue[name] as ((...a: unknown[]) => unknown) | undefined;
      if (original)
        deps[name] = (...args: unknown[]) => {
          counts.vnodes++;
          return original(...args);
        };
    }
    const component = evalModule<Component>(code, deps);
    const setup = component.setup;
    // render-функция — то, что возвращает setup при inlineTemplate; считаем её вызовы
    component.setup = (...args) => {
      const render = setup(...args);
      return (...a: unknown[]) => {
        counts.render++;
        return render(...a);
      };
    };
    this.app = vue.createApp(component);
    this.app.mount(container);
    BINDINGS.forEach((name, i) => (this.refs[name] = created[i]));
  }

  async run(scenario: Pick<Scenario, 'code'>): Promise<Measured<VdomStep>> {
    this.counts.render = this.counts.vnodes = 0;
    const probe = new DomProbe(this.container, this.env).start();
    try {
      applyScenario(this.refs, scenario.code);
      await this.vue.nextTick();
    } finally {
      probe.stop();
    }
    return { step: { ...this.counts, ops: probe.ops.length }, ops: probe.ops };
  }

  destroy(): void {
    this.app.unmount();
  }
}

export class MiniSide {
  readonly refs = {} as Refs;
  readonly code: string;
  private root: MiniScope;
  private touched: DomOp[] = [];

  /** `template` — шаблон компонента, `initial` — начальные значения ячеек из `<script setup>`. */
  constructor(
    private readonly api: MiniVapor,
    template: string,
    initial: Record<(typeof BINDINGS)[number], unknown>,
    readonly container: Element,
    private readonly env?: ConstructorParameters<typeof DomProbe>[1],
  ) {
    for (const name of BINDINGS) this.refs[name] = api.ref(initial[name]);
    this.code = api.compile(template, [...BINDINGS]);
    api.hooks.touch = (node, kind) => this.touched.push({ kind, api: '', node });
    this.root = api.mount(api.build(this.code), this.refs, container);
  }

  /**
   * Два счёта одной работы: щуп DOM и собственный крючок `touch` мини-vapor. Демо показывает
   * второй (он знает, какой узел тронут), тест требует, чтобы они совпали.
   */
  async run(scenario: Pick<Scenario, 'code'>): Promise<Measured<VaporStep> & { touched: DomOp[] }> {
    this.api.stats.effects = 0;
    this.touched = [];
    const probe = new DomProbe(this.container, this.env).start();
    try {
      applyScenario(this.refs, scenario.code);
      await this.api.nextTick();
    } finally {
      probe.stop();
    }
    return { step: { effects: this.api.stats.effects, ops: probe.ops.length }, ops: probe.ops, touched: this.touched };
  }

  destroy(): void {
    this.api.dispose(this.root);
    this.api.hooks.touch = null;
  }
}
