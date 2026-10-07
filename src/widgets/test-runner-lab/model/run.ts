import type { CreateClock, ModulesApi, RunnerApi, RunnerName, SpyApi, TestApi, TestResult } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `RUNNER_CODE`, `CLOCK_CODE`,
 * `SPY_CODE` и `MODULES_CODE` из темы «Тест-раннеры изнутри».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/test-runners.test.ts`: порядок строк и итоги тестов учебного раннера
 * сверяются с тем, что выдали настоящие Vitest и Jest на тех же фикстурах, часы — с
 * `@sinonjs/fake-timers`, шпион — с `@vitest/spy` и `jest-mock`. Копии нет — разойдётся
 * показанный код с настоящим раннером, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadRunner(code: string): RunnerApi {
  return new Function(`${code}\nreturn { FLAVORS, collect, run };`)() as RunnerApi;
}

export function loadClock(code: string): CreateClock {
  return new Function(`${code}\nreturn createClock;`)() as CreateClock;
}

export function loadSpy(code: string): SpyApi {
  return new Function(`${code}\nreturn { fn, spyOn };`)() as SpyApi;
}

export function loadModules(code: string): ModulesApi {
  return new Function(`${code}\nreturn { createModuleSystem, hoistMocks };`)() as ModulesApi;
}

/**
 * Прогнать фикстуру учебным раннером так, как её прогоняли настоящие: функции раннера
 * приходят глобальными именами, `log` записывает строку.
 */
export async function play(
  api: RunnerApi,
  fixture: string,
  runner: RunnerName,
): Promise<{ log: string[]; results: TestResult[] }> {
  const log: string[] = [];
  const file = new Function(
    'api',
    'log',
    `const { describe, test, beforeAll, beforeEach, afterEach, afterAll } = api;\n${fixture}`,
  ) as (api: TestApi, log: (s: string) => void) => void;
  const flavor = api.FLAVORS[runner];
  const root = api.collect((a) => file(a, (s) => log.push(s)), flavor);
  const results = await api.run(root, flavor);
  return { log, results };
}

/** Часы со сценарием из темы: `CLOCK_SCENARIO_CODE` ставит таймеры и пишет в `log`. */
export function startScenario(createClock: CreateClock, scenario: string, log: (s: string) => void) {
  return new Function('createClock', 'log', `${scenario}\nreturn clock;`)(createClock, log) as ReturnType<CreateClock>;
}
