/** Где Vitest и Jest расходятся — переключатели учебного раннера (`FLAVORS` в `RUNNER_CODE`). */
export interface Flavor {
  /** `true` — тело `describe` исполняется после тела родителя (Vitest), `false` — сразу (Jest). */
  lazyDescribe: boolean;
  /** `stack` — after-хуки одного блока в обратном порядке (Vitest), `list` — в порядке объявления (Jest). */
  afterHooks: 'stack' | 'list';
  /** `skip` — после упавшего `beforeAll` тесты блока пропущены (Vitest), `fail` — провалены (Jest). */
  beforeAllFails: 'skip' | 'fail';
}

export type RunnerName = 'vitest' | 'jest';

export type TestState = 'pass' | 'fail' | 'skip';

export interface TestResult {
  name: string;
  state: TestState;
  /** Текст ошибки у упавшего теста — только в ответе учебного раннера. */
  error?: string;
}

/** То, что тестовый файл видит как глобальные функции раннера. */
export interface TestApi {
  describe(name: string, body: (api: TestApi) => void): void;
  test(name: string, fn: () => unknown): void;
  beforeAll(fn: () => unknown): void;
  beforeEach(fn: () => unknown): void;
  afterEach(fn: () => unknown): void;
  afterAll(fn: () => unknown): void;
}

/** Узел дерева после сбора. Демо и тест его не разбирают — только передают в `run`. */
export type SuiteNode = { kind: 'suite'; name: string } & Record<string, unknown>;

export interface RunnerApi {
  FLAVORS: Record<RunnerName, Flavor>;
  collect(file: (api: TestApi) => void, flavor: Flavor): SuiteNode;
  run(root: SuiteNode, flavor: Flavor): Promise<TestResult[]>;
}

/** Что выдал настоящий раннер на стенде: строки `log(…)` по порядку и итог каждого теста. */
export interface RealRun {
  log: string[];
  results: { name: string; state: TestState }[];
}

/** Фикстура для демо «Сбор и исполнение». */
export interface Scenario {
  id: string;
  label: string;
  /** Текст тестового файла: его же исполняли настоящие Vitest и Jest. */
  code: string;
  /** Подпись над фикстурой. Строчная разметка. */
  note: string;
  real: Record<RunnerName, RealRun>;
}

export interface PendingTimer {
  id: number;
  at: number;
  /** Период интервала; `0` у обычного таймера. */
  every: number;
  order: number;
}

export interface Clock {
  setTimeout(fn: () => void, ms?: number): number;
  setInterval(fn: () => void, ms?: number): number;
  clearTimeout(id: number): void;
  clearInterval(id: number): void;
  now(): number;
  count(): number;
  pending(): PendingTimer[];
  advance(ms: number): void;
  runAll(limit?: number): void;
}

export type CreateClock = (start?: number) => Clock;

export interface Spy {
  (...args: unknown[]): unknown;
  mock: {
    calls: unknown[][];
    results: { type: 'incomplete' | 'return' | 'throw'; value: unknown }[];
    contexts: unknown[];
  };
  mockRestore?: () => void;
}

export interface SpyApi {
  fn(impl?: (...args: never[]) => unknown): Spy;
  spyOn(object: object, key: string): Spy;
}

export interface ModuleSystem {
  require(path: string): unknown;
  registry: Map<string, unknown>;
}

export interface ModulesApi {
  createModuleSystem(files: Record<string, string>, globals: Record<string, unknown>): ModuleSystem;
  hoistMocks(source: string): string;
}
