/**
 * Описание дерева для учебного инжектора — одно на три семантики: Angular, Vue и React.
 *
 * Токены — строки. Тест превращает их в настоящие токены Angular (класс, если имя есть
 * в `classes`, иначе `InjectionToken`), ключи `provide` во Vue и контексты React.
 */

/** Провайдер в форме Angular. Строка — короткая запись класса: `'Store'` = `{ provide: 'Store', useClass: 'Store' }`. */
export type Provider =
  | string
  | {
      provide: string;
      multi?: boolean;
      useValue?: unknown;
      useClass?: string;
      useExisting?: string;
      useFactory?: (...deps: never[]) => unknown;
      deps?: string[];
    };

export interface ClassSpec {
  /** Что класс просит через `inject()` в своих полях. */
  deps?: string[];
  /** `@Injectable({ providedIn: 'root' })`. */
  providedIn?: 'root';
}

/** Инжектор окружения (`EnvironmentInjector`). Первый в списке — корневой. */
export interface EnvSpec {
  id: string;
  parent: string | null;
  /** Область `root`: здесь заводятся записи классов с `providedIn: 'root'`. */
  root?: boolean;
  providers: Provider[];
}

/** Компонент. Ребёнок объявлен в шаблоне родителя. */
export interface CompSpec {
  id: string;
  parent: string | null;
  /** У корневого компонента — инжектор окружения, к которому он подключён. */
  env?: string;
  providers?: Provider[];
  viewProviders?: Provider[];
}

export interface DiSpec {
  classes: Record<string, ClassSpec>;
  env: EnvSpec[];
  components: CompSpec[];
}

export interface Flags {
  optional?: boolean;
  self?: boolean;
  skipSelf?: boolean;
  host?: boolean;
}

/** Откуда спрашивают: из конструктора компонента или у инжектора окружения. */
export type From = { node: string; ownView?: boolean } | { env: string };

export type Step = 'skip' | 'miss' | 'host-miss' | 'create' | 'hit' | 'cycle' | 'null';

export interface TraceStep {
  at: string;
  token: string;
  step: Step;
  /** Глубина: 0 — сам запрос, 1 — зависимость того, что создаётся, и так далее. */
  depth: number;
}

/** Экземпляр класса в учебной версии и в тесте: метка `Store#2` и зависимости. */
export interface Instance {
  label: string;
  deps: unknown[];
}

export type DiState = unknown;

export interface DiError extends Error {
  code: 'NG0200' | 'NG0201';
  path: string[];
}

export interface AngularApi {
  createInjectors(spec: DiSpec): DiState;
  resolve(di: DiState, from: From, token: string, flags?: Flags, trace?: TraceStep[]): unknown;
}

// ─── Vue и React ────────────────────────────────────────────────────────────────────────

/** Значение для `provide`: готовое значение, новый экземпляр класса или массив (бывший `multi`). */
export type ProvideValue = { value: unknown } | { cls: string } | { multi: ProvideValue[] };

export interface ProvideEntry {
  key: string;
  value: ProvideValue;
}

export interface VueSpec {
  appProvides: ProvideEntry[];
  components: { id: string; parent: string | null; provides: ProvideEntry[] }[];
}

export interface VueApp {
  app: Record<string, unknown>;
  owner: Map<object, string>;
  provides: Map<string, Record<string, unknown>>;
  setup(c: VueSpec['components'][number]): void;
}

export interface ReadStep {
  at: string;
  step: 'hit' | 'miss' | 'default';
}

export interface VueRead {
  value: unknown;
  trace: ReadStep[];
  fallback?: boolean;
  warn?: string;
}

export interface VueApi {
  createVueApp(spec: VueSpec, make: (v: ProvideValue) => unknown): VueApp;
  inject(vue: VueApp, spec: VueSpec, id: string, key: string, fallback?: { value: unknown }): VueRead;
}

export interface ReactTree {
  parent: Map<string, string | null>;
  values: Map<string, Map<string, unknown>>;
  /** Провайдеры над корнем: `<Ctx value>` вокруг `<App />`. */
  top: Map<string, unknown>;
  defaults: Record<string, unknown>;
}

export interface ReactApi {
  readContext(tree: ReactTree, id: string, key: string): { value: unknown; trace: ReadStep[] };
}

// ─── Демо ───────────────────────────────────────────────────────────────────────────────

export type Mode = 'angular' | 'vue' | 'react';

export interface DemoToken {
  id: string;
  /** Подпись в демо. Строчная разметка. */
  note: string;
  /** Подпись в режимах Vue и React, если она другая. Строчная разметка. */
  plainNote?: string;
  /** Есть ли у токена смысл во Vue и React (у цикла через `inject()` его нет). */
  plain: boolean;
}
