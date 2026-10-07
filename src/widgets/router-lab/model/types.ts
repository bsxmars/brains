/** Строки учебного роутера из темы «Роутер изнутри». Демо и тест собирают их одинаково. */
export interface RouterCodes {
  /** `tokenize` и `compile`: шаблон пути → токены → регулярка и вес. */
  match: string;
  /** `compareSegment`, `compareRoutes`: кто сильнее. */
  rank: string;
  /** `createMatcher`: дерево маршрутов → список по весу, `resolve(path)`. */
  matcher: string;
  /** `createRouter`: guards по этапам, отмена, перенаправление. */
  navigate: string;
  /** Сессия, `requireLogin`, `installGuards`, компонент `Settings`. */
  guards: string;
  /** Сквозная таблица маршрутов `routes`. */
  routes: string;
  /** Вложенный магазин `shopRoutes` для водопада. */
  shop: string;
  /** Четыре способа загрузить данные: `inComponent`, `parallel`, `serial`, `early`. */
  loaders: string;
}

export interface Token {
  type: 'text' | 'param';
  value: string;
  regexp?: string;
  optional?: boolean;
  repeatable?: boolean;
}

export interface ParamKey {
  name: string;
  repeatable: boolean;
  optional: boolean;
}

export interface Compiled {
  re: RegExp;
  keys: ParamKey[];
  score: number[][];
}

/** Запись маршрута в том виде, в каком её пишут в `routes`. */
export interface RouteRaw {
  path: string;
  name?: string;
  component?: unknown;
  beforeEnter?: (to: Resolved, from: Resolved) => unknown;
  meta?: Record<string, unknown>;
  children?: RouteRaw[];
  redirect?: string;
}

/** Запись после `createMatcher`: полный путь, родитель, регулярка и вес. */
export interface MatcherRecord extends RouteRaw, Compiled {
  parent: MatcherRecord | null;
}

export interface Resolved {
  path: string;
  name?: string;
  record?: MatcherRecord;
  params: Record<string, string | string[]>;
  matched: MatcherRecord[];
}

export interface Matcher {
  list: MatcherRecord[];
  resolve(path: string): Resolved | null;
}

export interface Failure {
  type: number;
}

export type Guard = (to: Resolved, from: Resolved) => unknown;

export interface MiniRouter {
  current: Resolved;
  entries: string[];
  push(path: string): Promise<Failure | undefined>;
  beforeEach(fn: Guard): void;
  beforeResolve(fn: Guard): void;
  afterEach(fn: (to: Resolved, from: Resolved, failure: Failure | null) => unknown): void;
}

export interface RouterApi {
  tokenize(path: string): Token[][];
  compile(segments: Token[][]): Compiled;
  compareRoutes(a: Compiled, b: Compiled): number;
  createMatcher(routes: RouteRaw[]): Matcher;
  createRouter(matcher: Matcher): MiniRouter;
}

export interface Session {
  user: string | null;
  admin: boolean;
  dirty: boolean;
}

/** Что даёт исполнение `guards` + `routes`: таблица, сессия и глобальные guards. */
export interface AppParts {
  routes: RouteRaw[];
  session: Session;
  installGuards(router: { beforeEach(fn: Guard): void }): void;
  Settings: Record<string, unknown>;
}

/** Сценарий навигации: с какого адреса, в каком состоянии сессии, куда. */
export interface GuardScenario {
  id: string;
  label: string;
  /** Что увидеть. Строчная разметка. */
  note: string;
  session: Partial<Session>;
  /** Переходы до начала записи — привести роутер на исходный адрес. */
  setup: string[];
  /** Переходы, которые пишутся в журнал. Два адреса — второй стартует, пока первый в пути. */
  go: string[];
}

export interface GuardRun {
  from: string;
  to: string;
  failures: (number | null)[];
  log: string[];
}

/** Уровень магазина: имя, сколько грузится чанк и сколько — данные, мс. */
export interface ShopLevel {
  name: string;
  chunk: number;
  data: number;
}

export type Strategy = 'inComponent' | 'parallel' | 'serial' | 'early';

export interface TimelineEvent {
  t: number;
  what: string;
}

export interface Span {
  label: string;
  kind: 'chunk' | 'data';
  from: number;
  to: number;
}

export interface WaterfallRun {
  events: TimelineEvent[];
  spans: Span[];
  /** Когда сменился адрес. */
  commit: number;
  /** Когда нарисован последний уровень с данными. */
  ready: number;
}

export interface RankRow {
  path: string;
  name: string;
  score: number[][];
  re: string;
  /** Регулярка подходит к адресу. */
  fits: boolean;
}

export interface MatchView {
  rows: RankRow[];
  /** Индекс победителя в `rows`, `-1` — ни один не подошёл. */
  winner: number;
  params: Record<string, string | string[]>;
  matched: string[];
}
