import type {
  AngularApi,
  DiError,
  DiSpec,
  DiState,
  Flags,
  Mode,
  Provider,
  ProvideValue,
  ReactApi,
  ReactTree,
  ReadStep,
  TraceStep,
  VueApi,
  VueApp,
  VueSpec,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `ANGULAR_DI_CODE`, `VUE_PROVIDE_CODE`
 * и `REACT_CONTEXT_CODE` из темы «Внедрение зависимостей».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/dependency-injection.test.ts` против настоящих Angular 21, Vue 3.5 и React 19
 * на одних и тех же деревьях. Остальное в файле — клей: в каком порядке создаются компоненты,
 * как дерево в форме Angular превращается в вызовы `provide` и `<Ctx value>`.
 *
 * Ни DOM, ни Vue-компонентов: чистые функции, чтобы их мог импортировать юнит-тест.
 */

export function loadAngular(code: string): AngularApi {
  return new Function(`${code}\nreturn { createInjectors, resolve };`)() as AngularApi;
}

export function loadVue(code: string): VueApi {
  return new Function(`${code}\nreturn { createVueApp, inject };`)() as VueApi;
}

export function loadReact(code: string): ReactApi {
  return new Function(`${code}\nreturn { readContext };`)() as ReactApi;
}

const kidsOf = (spec: DiSpec, id: string | null) => spec.components.filter((c) => c.parent === id).map((c) => c.id);

/**
 * Порядок конструкторов в Angular: сначала все компоненты одного шаблона, потом — вглубь
 * каждого из них. Тест сверяет его с тем, в каком порядке их вызвал настоящий Angular.
 */
export function creationOrder(spec: DiSpec): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    const kids = kidsOf(spec, id);
    out.push(...kids);
    kids.forEach(visit);
  };
  for (const root of kidsOf(spec, null)) {
    out.push(root);
    visit(root);
  }
  return out;
}

/** Порядок `setup` во Vue и вызовов компонентов в React: в глубину, родитель раньше детей. */
export function setupOrder(spec: DiSpec): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    kidsOf(spec, id).forEach(visit);
  };
  kidsOf(spec, null).forEach(visit);
  return out;
}

/** Значение для показа и сравнения: экземпляр — его меткой, массив — поэлементно. */
export function show(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(show);
  if (v && typeof v === 'object' && 'label' in v) return (v as { label: string }).label;
  return v;
}

// ─── Дерево Angular → provide() во Vue и <Ctx value> в React ────────────────────────────

function toValue(p: Provider): { key: string; value: ProvideValue; multi: boolean } {
  if (typeof p === 'string') return { key: p, value: { cls: p }, multi: false };
  const multi = Boolean(p.multi);
  if ('useValue' in p) return { key: p.provide, value: { value: p.useValue }, multi };
  if (p.useClass) return { key: p.provide, value: { cls: p.useClass }, multi };
  throw new Error(`У провайдера ${p.provide} нет аналога во Vue и React: useExisting и useFactory — только Angular`);
}

/** Провайдеры одного места → записи `provide`: несколько `multi` одного токена — один массив. */
function toEntries(providers: Provider[]) {
  const out: { key: string; value: ProvideValue }[] = [];
  for (const p of providers) {
    const { key, value, multi } = toValue(p);
    const prev = out.find((e) => e.key === key);
    if (multi && prev && 'multi' in prev.value) prev.value.multi.push(value);
    else if (multi) out.push({ key, value: { multi: [value] } });
    else if (prev) prev.value = value;
    else out.push({ key, value });
  }
  return out;
}

/**
 * Дерево в форме Angular → вызовы `provide`. Провайдеры окружения и классы с
 * `providedIn: 'root'` уходят в `app.provide`; `providers` и `viewProviders` компонента — в
 * его `provide()`: у Vue нет разницы между ними.
 */
export function toVue(spec: DiSpec): VueSpec {
  const rootClasses = Object.entries(spec.classes)
    .filter(([, c]) => c.providedIn === 'root')
    .map(([name]) => name as Provider);
  return {
    appProvides: toEntries([...rootClasses, ...spec.env[0].providers]),
    components: setupOrder(spec).map((id) => {
      const c = spec.components.find((x) => x.id === id)!;
      return { id, parent: c.parent, provides: toEntries([...(c.providers ?? []), ...(c.viewProviders ?? [])]) };
    }),
  };
}

/** Фабрика значений: экземпляр класса получает метку `Store#2` по своему счётчику. */
export function makeValues() {
  const counters: Record<string, number> = {};
  const make = (v: ProvideValue): unknown => {
    if ('value' in v) return v.value;
    if ('multi' in v) return v.multi.map(make);
    counters[v.cls] = (counters[v.cls] ?? 0) + 1;
    return { label: `${v.cls}#${counters[v.cls]}`, deps: [] };
  };
  return make;
}

/** Приложение Vue по дереву: `app.provide`, потом `setup` компонентов в порядке Vue. */
export function mountVue(api: VueApi, spec: DiSpec): { vue: VueApp; vspec: VueSpec } {
  const vspec = toVue(spec);
  const vue = api.createVueApp(vspec, makeValues());
  vspec.components.forEach((c) => vue.setup(c));
  return { vue, vspec };
}

/** Дерево React: провайдеры окружения — над корнем, компонент создаёт свои значения при вызове. */
export function mountReact(spec: DiSpec, defaults: Record<string, unknown>): ReactTree {
  const make = makeValues();
  const vspec = toVue(spec);
  const top = new Map(vspec.appProvides.map((e) => [e.key, make(e.value)]));
  const values = new Map<string, Map<string, unknown>>();
  for (const c of vspec.components) values.set(c.id, new Map(c.provides.map((e) => [e.key, make(e.value)])));
  return { parent: new Map(spec.components.map((c) => [c.id, c.parent])), values, top, defaults };
}

// ─── Демо: один запрос в выбранной семантике ────────────────────────────────────────────

export interface LabAnswer {
  /** Значение для показа; `undefined` вместе с `error` — запрос упал. */
  value?: unknown;
  error?: { code: string; message: string };
  /** Шаги Angular — с глубиной и токеном; Vue и React — плоский путь вверх. */
  trace: (TraceStep | (ReadStep & { token: string; depth: number }))[];
  /** Vue: значение пришло из второго аргумента `inject`. */
  fallback?: boolean;
  /** Vue: предупреждение `injection "…" not found.` */
  warn?: string;
}

export interface LabCodes {
  angular: string;
  vue: string;
  react: string;
}

/**
 * Состояние демо: три приложения по одному дереву. Экземпляры живут между запросами —
 * второй запрос того же токена в Angular покажет «уже создан», а не новый экземпляр.
 */
export function createLab(spec: DiSpec, codes: LabCodes, defaults: Record<string, unknown>) {
  const ng = loadAngular(codes.angular);
  const vueApi = loadVue(codes.vue);
  const reactApi = loadReact(codes.react);
  let di: DiState;
  let vue: { vue: VueApp; vspec: VueSpec };
  let react: ReactTree;
  const reset = () => {
    di = ng.createInjectors(spec);
    vue = mountVue(vueApi, spec);
    react = mountReact(spec, defaults);
  };
  reset();

  function ask(mode: Mode, node: string, token: string, opts: { flags?: Flags; fallback?: unknown } = {}): LabAnswer {
    if (mode === 'angular') {
      const trace: TraceStep[] = [];
      try {
        return { value: ng.resolve(di, { node }, token, opts.flags ?? {}, trace), trace };
      } catch (e) {
        const err = e as DiError;
        return { error: { code: err.code, message: err.message }, trace };
      }
    }
    if (mode === 'vue') {
      const fb = 'fallback' in opts ? { value: opts.fallback } : undefined;
      const r = vueApi.inject(vue.vue, vue.vspec, node, token, fb);
      return { value: r.value, trace: r.trace.map((s) => ({ ...s, token, depth: 0 })), fallback: r.fallback, warn: r.warn };
    }
    const r = reactApi.readContext(react, node, token);
    return { value: r.value, trace: r.trace.map((s) => ({ ...s, token, depth: 0 })) };
  }

  return { ask, reset };
}
