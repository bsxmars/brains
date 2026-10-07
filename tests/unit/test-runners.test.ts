import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import FakeTimers from '@sinonjs/fake-timers';
import { fn as vitestFn } from '@vitest/spy';
import { expect as jestExpect } from 'expect';
import { ModuleMocker } from 'jest-mock';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/test-runners/data';
import { loadClock, loadModules, loadRunner, loadSpy, play, startScenario } from '@/widgets/test-runner-lab/model/run';
import type { Clock, RunnerName, TestState } from '@/widgets/test-runner-lab/model/types';

/**
 * Тема «Тест-раннеры изнутри: Vitest и Jest».
 *
 * Литералы стенда (`REAL`, `ISO_ROWS`, трансформации моков, журналы таймеров, шпионов,
 * перемешивания) пересобираются здесь настоящими vitest и jest: фикстуры из `data.ts`
 * пишутся во временный каталог с симлинком на `node_modules` проекта, и каждый раннер
 * запускается **отдельным процессом** с `cwd` в этом каталоге. Сам vitest этого прогона
 * их не исполняет: из окружения дочернего процесса убраны переменные `VITEST*`, иначе
 * вложенный раннер решил бы, что он воркер.
 *
 * Учебные строки (`RUNNER_CODE`, `MODULES_CODE`, `SPY_CODE`, `CLOCK_CODE`) — те, что
 * напечатаны на странице и исполняются демо, — сверяются с журналами настоящих раннеров,
 * с `@sinonjs/fake-timers`, `@vitest/spy` и `jest-mock`.
 *
 * Прогон долгий (около трёх десятков запусков раннеров), поэтому всё снимается один раз
 * в `beforeAll`, по очереди — машину параллельными раннерами не душим.
 */

const NM = join(process.cwd(), 'node_modules');
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'test-runners-')));

const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|__VITEST|JEST_WORKER|TINYPOOL|NODE_OPTIONS)/.test(k)));

function project(name: string, kind: RunnerName, files: Record<string, string>): string {
  const dir = join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  symlinkSync(NM, join(dir, 'node_modules'));
  writeFileSync(join(dir, 'package.json'), kind === 'vitest' ? '{"type":"module"}' : '{}');
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), c);
  }
  return dir;
}

interface Run {
  code: number | null;
  signal: string | null;
  text: string;
}

function runner(kind: RunnerName, dir: string, args: string[], opts: { env?: Record<string, string>; timeout?: number } = {}): Promise<Run> {
  const bin =
    kind === 'vitest'
      ? [join(NM, 'vitest/vitest.mjs'), 'run', '--root', dir]
      : [join(NM, 'jest/bin/jest.js'), '--rootDir', dir, '--cacheDirectory', join(dir, '.jest-cache')];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...bin, ...args],
      {
        cwd: dir,
        env: { ...cleanEnv(), NO_COLOR: '1', FORCE_COLOR: '0', ...opts.env },
        timeout: opts.timeout ?? 120_000,
        killSignal: 'SIGKILL',
        maxBuffer: 32 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number; signal?: string }) | null;
        resolve({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, signal: e?.signal ?? null, text: `${stdout}\n${stderr}` });
      },
    );
  });
}

/** Шапка фикстуры: как в стенде — `log` дописывает строку в файл журнала. */
const head = (kind: RunnerName, logFile: string, extra = '') =>
  (kind === 'vitest' ? "import { appendFileSync } from 'node:fs';\n" : "const { appendFileSync } = require('node:fs');\n") +
  `const log = (s) => appendFileSync(${JSON.stringify(logFile)}, s + '\\n');\n` +
  extra;
const withT = (kind: RunnerName) => (kind === 'vitest' ? "import { vi as T } from 'vitest';\n" : 'const T = jest;\n');
const readLog = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : []);
const KINDS: RunnerName[] = ['vitest', 'jest'];

/** Трансформации — нормализация из шапки `data.ts`. */
const normVitest = (c: string) =>
  c
    .split('//# sourceMappingSource')[0]
    .replace(/"\/@fs\/[^"]*\/node_modules\//g, '"/@fs/…/node_modules/')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const normJest = (c: string) =>
  c.split('\n').slice(1).join('\n').split('//# sourceMappingURL')[0].replace(/\n{3,}/g, '\n\n').trim();

const FIXTURES: Record<string, string> = Object.fromEntries(t.SCENARIOS.map((s) => [s.id, s.code]));

const got = {} as {
  real: Record<string, Record<RunnerName, { log: string[]; results: { name: string; state: TestState }[] }>>;
  allFailsVitestFailed: boolean;
  list: Record<RunnerName, string[]>;
  helpersError: string;
  iso: { counter: number; global: boolean; env: boolean; proto: boolean; sameProcess: boolean }[];
  vitestTransform: string;
  jestTransform: string;
  mockOk: Record<RunnerName, number | null>;
  tdz: Record<string, Run>;
  logs: Record<string, string[]>;
  realmVm: string[];
  seeds: { order: string[]; failed: number; text: string }[];
  open: Record<RunnerName, Run & { log: string[] }>;
};

beforeAll(async () => {
  // 1. Фикстуры хуков: шесть файлов в одном проекте на раннер, отчёт JSON.
  got.real = {};
  for (const kind of KINDS) {
    const files: Record<string, string> = {};
    const dirName = `hooks-${kind}`;
    for (const [id, code] of Object.entries(FIXTURES)) files[`${id}.test.js`] = head(kind, join(ROOT, dirName, `${id}.log`)) + code + '\n';
    const dir = project(dirName, kind, files);
    const json = join(dir, 'report.json');
    await runner(kind, dir, kind === 'vitest' ? ['--globals', '--reporter=json', `--outputFile=${json}`] : ['--json', `--outputFile=${json}`]);
    const rep = JSON.parse(readFileSync(json, 'utf8')) as {
      testResults: { name: string; status: string; assertionResults: { title: string; status: string }[] }[];
    };
    for (const id of Object.keys(FIXTURES)) {
      const file = rep.testResults.find((r) => r.name.endsWith(`/${id}.test.js`))!;
      got.real[id] ??= {} as never;
      got.real[id][kind] = {
        log: readLog(join(dir, `${id}.log`)),
        results: file.assertionResults.map((a) => ({
          name: a.title,
          state: a.status === 'passed' ? 'pass' : a.status === 'failed' ? 'fail' : 'skip',
        })),
      };
      if (kind === 'vitest' && id === 'all-fails') got.allFailsVitestFailed = file.status === 'failed';
    }
  }

  // 2. Поиск файлов.
  {
    const files = Object.fromEntries(t.FIND_ROWS.map((r) => [r.file, "test('x', () => {});\n"]));
    files['src/__tests__/helpers.js'] = 'module.exports = { money: (n) => `${n} ₽` };\n';
    const dv = project('find-v', 'vitest', files);
    const dj = project('find-j', 'jest', files);
    const vjson = join(dv, 'r.json');
    await runner('vitest', dv, ['--globals', '--reporter=json', `--outputFile=${vjson}`]);
    const lj = await runner('jest', dj, ['--listTests']);
    const vnames = (JSON.parse(readFileSync(vjson, 'utf8')) as { testResults: { name: string }[] }).testResults.map((r) => r.name);
    const all = t.FIND_ROWS.map((r) => r.file);
    got.list = {
      vitest: all.filter((f) => vnames.includes(join(dv, f))),
      jest: all.filter((f) => lj.text.includes(join(dj, f))),
    };
    const run = await runner('jest', dj, []);
    got.helpersError = run.text;
  }

  // 3. Изоляция: два файла и общий модуль, один воркер.
  const toEsm = (s: string) => s.replace("const { inc } = require('./counter.js');", "import { inc } from './counter.js';");
  got.iso = [];
  for (const [i, row] of t.ISO_ROWS.entries()) {
    const kind = row.runner;
    const logF = join(ROOT, `iso${i}.log`);
    const rec = `const record = (...a) => appendFileSync(${JSON.stringify(logF)}, [...a.map(String), process.pid].join(' ') + '\\n');\n`;
    const body = (n: string) => head(kind, '/dev/null') + rec + (kind === 'vitest' ? toEsm(t.isoTest(n)) : t.isoTest(n));
    const dir = project(`iso${i}`, kind, {
      'counter.js': kind === 'vitest' ? 'let n = 0;\nexport const inc = () => ++n;\n' : t.COUNTER_CODE + '\n',
      'a.test.js': body('a'),
      'b.test.js': body('b'),
    });
    await runner(kind, dir, kind === 'vitest' ? ['--globals', ...row.flags] : row.flags);
    const lines = readLog(logF).map((l) => l.split(' '));
    const first = lines[0][0][0];
    const second = lines.find((l) => l[0][0] !== first)!;
    got.iso.push({
      counter: Number(second[1]),
      global: second[2] !== 'undefined',
      env: second[3] !== 'undefined',
      proto: second[4] !== 'undefined',
      sameProcess: second[5] === lines[0][5],
    });
  }

  // 4. Моки: трансформации и ошибки фабрики.
  got.mockOk = {} as never;
  {
    const dir = project('mock-v', 'vitest', { 'price.js': t.PRICE_CODE + '\n', 'cart.js': t.CART_CODE + '\n', 'cart.test.js': t.MOCK_TEST_VITEST + '\n' });
    const r = await runner('vitest', dir, [], { env: { VITEST_DEBUG_DUMP: join(dir, 'dump') } });
    got.mockOk.vitest = r.code;
    const meta = JSON.parse(readFileSync(join(dir, 'dump/root/vitest-metadata.json'), 'utf8')) as { tmps: Record<string, string> };
    got.vitestTransform = readFileSync(meta.tmps['/cart.test.js'], 'utf8');
  }
  {
    const dir = project('mock-j', 'jest', { 'price.js': t.PRICE_CJS + '\n', 'cart.js': t.CART_CJS + '\n', 'cart.test.js': t.MOCK_TEST_JEST + '\n' });
    const r = await runner('jest', dir, []);
    got.mockOk.jest = r.code;
    const cache = join(dir, '.jest-cache');
    const tc = readdirSync(cache).find((d) => d.startsWith('jest-transform-cache'))!;
    let found = '';
    for (const sub of readdirSync(join(cache, tc))) {
      for (const f of readdirSync(join(cache, tc, sub))) if (f.startsWith('carttest_') && !f.endsWith('.map')) found = join(cache, tc, sub, f);
    }
    got.jestTransform = readFileSync(found, 'utf8');
  }
  got.tdz = {};
  for (const [name, kind, code] of [
    ['tdzV', 'vitest', t.TDZ_VITEST],
    ['tdzJ', 'jest', t.TDZ_JEST],
    ['tdzJP', 'jest', t.TDZ_JEST_PREFIX],
    ['fixV', 'vitest', t.FIX_VITEST],
    ['fixJ', 'jest', t.FIX_JEST],
  ] as const) {
    const files =
      kind === 'vitest'
        ? { 'price.js': t.PRICE_CODE + '\n', 'cart.js': t.CART_CODE + '\n', 'cart.test.js': code + t.FIX_TAIL + '\n' }
        : { 'price.js': t.PRICE_CJS + '\n', 'cart.js': t.CART_CJS + '\n', 'cart.test.js': code + t.FIX_TAIL + '\n' };
    got.tdz[name] = await runner(kind, project(name, kind, files), []);
  }

  // 5. Фикстуры с T: realm, шпион, таймеры — три файла в одном проекте на раннер.
  got.logs = {};
  for (const kind of KINDS) {
    const files: Record<string, string> = {};
    for (const [name, code] of [['realm', t.REALM_FIXTURE], ['spy', t.SPY_FIXTURE], ['timers', t.TIMERS_FIXTURE]] as const) {
      files[`${name}.test.js`] = head(kind, join(ROOT, `${name}-${kind}.log`), withT(kind)) + code + '\n';
    }
    await runner(kind, project(`fx-${kind}`, kind, files), kind === 'vitest' ? ['--globals'] : []);
    for (const name of ['realm', 'spy', 'timers']) got.logs[`${name}-${kind}`] = readLog(join(ROOT, `${name}-${kind}.log`));
  }
  {
    const logF = join(ROOT, 'realm-vm.log');
    const dir = project('realm-vm', 'vitest', { 'x.test.js': head('vitest', logF) + t.REALM_FIXTURE + '\n' });
    await runner('vitest', dir, ['--globals', '--pool=vmThreads']);
    got.realmVm = readLog(logF);
  }

  // 6. Перемешивание.
  got.seeds = [];
  for (const [i, row] of t.SEED_ROWS.entries()) {
    const logF = join(ROOT, `seed${i}.log`);
    const dir = project(`seed${i}`, row.runner, { 'x.test.js': head(row.runner, logF) + t.LEAK_FIXTURE + '\n' });
    const json = join(dir, 'r.json');
    const r = await runner(
      row.runner,
      dir,
      row.runner === 'vitest' ? ['--globals', '--reporter=default', '--reporter=json', `--outputFile=${json}`, ...row.flags] : ['--json', `--outputFile=${json}`, ...row.flags],
    );
    const rep = JSON.parse(readFileSync(json, 'utf8')) as { numFailedTests: number };
    got.seeds.push({ order: readLog(logF), failed: rep.numFailedTests, text: r.text });
  }

  // 7. Таймер, переживший свой тест, и интервал, который держит процесс.
  got.open = {} as never;
  for (const kind of KINDS) {
    const logF = join(ROOT, `open-${kind}.log`);
    const dir = project(`open-${kind}`, kind, { 'x.test.js': head(kind, logF) + t.OPEN_FIXTURE + '\n' });
    const r = await runner(kind, dir, kind === 'vitest' ? ['--globals'] : [], { timeout: 8000 });
    got.open[kind] = { ...r, log: readLog(logF) };
  }
}, 600_000);

const api = loadRunner(t.RUNNER_CODE);

describe('сбор и исполнение: литералы стенда — то, что выдают vitest и jest сейчас', () => {
  it('REAL совпадает с журналами и итогами настоящих раннеров на всех фикстурах', () => {
    for (const s of t.SCENARIOS) {
      for (const kind of KINDS) expect(got.real[s.id][kind], `${s.id} ${kind}`).toEqual(s.real[kind]);
    }
  });

  it('фикстуры с ошибками действительно отличаются от сквозной ровно хуком, который бросает', () => {
    expect(t.EACH_FAILS_FIXTURE).not.toBe(t.HOOKS_FIXTURE);
    expect(t.ALL_FAILS_FIXTURE).not.toBe(t.HOOKS_FIXTURE);
    expect(t.EACH_FAILS_FIXTURE.match(/throw/g)).toHaveLength(1);
    expect(t.ALL_FAILS_FIXTURE.match(/throw/g)).toHaveLength(1);
  });

  it('упавший beforeAll у Vitest: тесты «пропущены», но файл провален', () => {
    expect(t.REAL['all-fails'].vitest.results.filter((r) => r.state === 'skip').map((r) => r.name)).toEqual(['B', 'C']);
    expect(got.allFailsVitestFailed).toBe(true);
  });

  it('поиск файлов: какие пути раннеры считают тестами', () => {
    expect(got.list.vitest).toEqual(t.FIND_ROWS.filter((r) => r.vitest).map((r) => r.file));
    expect(got.list.jest).toEqual(t.FIND_ROWS.filter((r) => r.jest).map((r) => r.file));
    // helpers.js в __tests__ Jest запускает как тест — и роняет.
    expect(got.helpersError).toContain('Your test suite must contain at least one test');
    expect(got.helpersError).toContain('helpers.js');
    expect(t.FIND_NOTE).toContain('helpers.js');
  });
});

describe('RUNNER_CODE против настоящих vitest и jest', () => {
  it('на каждой фикстуре журнал и итоги учебного раннера = журнал настоящего', async () => {
    for (const s of t.SCENARIOS) {
      for (const kind of KINDS) {
        const r = await play(api, s.code, kind);
        expect(r.log, `${s.id} ${kind}`).toEqual(s.real[kind].log);
        expect(r.results.map(({ name, state }) => ({ name, state })), `${s.id} ${kind}`).toEqual(s.real[kind].results);
      }
    }
  });

  it('у раннеров разные журналы ровно на тех фикстурах, где заявлены различия', () => {
    const differs = (id: string) => JSON.stringify(t.REAL[id].vitest) !== JSON.stringify(t.REAL[id].jest);
    expect(t.SCENARIOS.map((s) => [s.id, differs(s.id)])).toEqual([
      ['hooks', true], // только строки сбора
      ['nested', true],
      ['two', true],
      ['each-fails', true], // только строки сбора
      ['all-fails', true],
      ['throws', true],
    ]);
    // Без строк сбора сквозная фикстура и падение beforeEach у раннеров совпадают.
    const run = (id: string, k: RunnerName) => t.REAL[id][k].log.filter((l) => !l.startsWith('сбор'));
    expect(run('hooks', 'vitest')).toEqual(run('hooks', 'jest'));
    expect(run('each-fails', 'vitest')).toEqual(run('each-fails', 'jest'));
    // Порядок тестов во вложенных блоках одинаковый.
    expect(run('nested', 'vitest')).toEqual(run('nested', 'jest'));
  });

  it('заголовок «Раннер в девяносто строк» не врёт', () => {
    const n = t.RUNNER_CODE.split('\n').length;
    expect(n).toBeGreaterThanOrEqual(85);
    expect(n).toBeLessThan(100);
    const spy = t.SPY_CODE.split('\n').length;
    expect(spy).toBeGreaterThanOrEqual(28);
    expect(spy).toBeLessThan(40);
  });
});

describe('изоляция', () => {
  it('ISO_ROWS — то, что сейчас видит первый тест второго файла', () => {
    expect(got.iso).toEqual(t.ISO_ROWS.map(({ counter, global, env, proto, sameProcess }) => ({ counter, global, env, proto, sameProcess })));
    // Вывод в тексте: по умолчанию между файлами не течёт ничего.
    expect(t.ISO_ROWS[0]).toMatchObject({ counter: 1, global: false, env: false, proto: false, sameProcess: false });
    expect(t.ISO_ROWS.find((r) => r.runner === 'jest')).toMatchObject({ counter: 1, global: false, env: false, sameProcess: true });
  });

  it('MODULES_CODE: реестр на файл даёт счётчик 1, общий реестр — 3, как --no-isolate', async () => {
    const mods = loadModules(t.MODULES_CODE);
    const files = { './counter.js': t.COUNTER_CODE, './a.test.js': t.isoTest('a'), './b.test.js': t.isoTest('b') };
    const play2 = async (shared: boolean) => {
      const seen: unknown[][] = [];
      // Свои globalThis, process и Array: учебный загрузчик не должен трогать процесс vitest.
      const globals: Record<string, unknown> = {
        record: (...a: unknown[]) => seen.push(a),
        globalThis: {},
        process: { env: {} },
        Array: { prototype: {} },
      };
      let sys = mods.createModuleSystem(files, globals);
      for (const f of ['./a.test.js', './b.test.js']) {
        if (!shared) sys = mods.createModuleSystem(files, globals);
        const root = api.collect((a) => {
          Object.assign(globals, a);
          sys.require(f);
        }, api.FLAVORS.jest);
        await api.run(root, api.FLAVORS.jest);
      }
      return seen.map((s) => s[1]);
    };
    expect(await play2(false)).toEqual([1, 2, 1, 2]);
    expect(await play2(true)).toEqual([1, 2, 3, 4]);
    expect(t.ISO_ROWS.find((r) => r.flags.includes('--no-isolate'))?.counter).toBe(3);
  });

  it('realm: в Jest и в vmThreads ошибка fs не instanceof Error, в forks — instanceof', () => {
    expect(got.logs['realm-vitest']).toEqual(t.REALM_LOG.vitest);
    expect(got.logs['realm-jest']).toEqual(t.REALM_LOG.jest);
    expect(t.REALM_LOG.jest).toContain('ошибка fs instanceof Error: false');
    expect(t.REALM_LOG.vitest).toContain('ошибка fs instanceof Error: true');
    // REALM_NOTE: vmThreads ведёт себя как Jest.
    expect(got.realmVm).toEqual(t.REALM_LOG.jest);
  });
});

describe('моки модулей', () => {
  it('тест с моком проходит в обоих раннерах', () => {
    expect(got.mockOk).toEqual({ vitest: 0, jest: 0 });
  });

  it('трансформации — как напечатаны', () => {
    expect(normVitest(got.vitestTransform)).toBe(t.VITEST_TRANSFORM);
    expect(normJest(got.jestTransform)).toBe(t.JEST_TRANSFORM);
    // vi.mock стоит раньше импортов, импорты стали динамическими.
    const v = t.VITEST_TRANSFORM;
    expect(v.indexOf('vi.mock(')).toBeLessThan(v.indexOf('__vite_ssr_dynamic_import__("/cart.js")'));
    const j = t.JEST_TRANSFORM;
    expect(j.indexOf('.mock(')).toBeLessThan(j.indexOf("require('./cart.js')"));
    expect(j).toContain('_getJestObj');
  });

  it('ошибки фабрики, читающей переменную, и оба исправления', () => {
    expect(got.tdz.tdzV.code).not.toBe(0);
    expect(got.tdz.tdzV.text).toContain(t.TDZ_ERRORS.vitest);
    expect(got.tdz.tdzJ.code).not.toBe(0);
    expect(got.tdz.tdzJ.text).toContain(t.TDZ_ERRORS.jest);
    expect(got.tdz.tdzJ.text).toContain('prefixed with `mock`');
    expect(got.tdz.tdzJP.code).not.toBe(0);
    expect(got.tdz.tdzJP.text).toContain(t.TDZ_ERRORS.jestPrefix);
    expect(got.tdz.fixV.code).toBe(0);
    expect(got.tdz.fixJ.code).toBe(0);
  });

  it('MODULES_CODE: без подъёма тест падает (cart.js взял настоящий total), с подъёмом — проходит', async () => {
    const mods = loadModules(t.MODULES_CODE);
    const spy = loadSpy(t.SPY_CODE);
    const files = { './price.js': t.PRICE_CJS, './cart.js': t.CART_CJS, './cart.test.js': t.MOCK_TEST_JEST };
    const hoisted = mods.hoistMocks(t.MOCK_TEST_JEST);
    expect(hoisted.startsWith("jest.mock('./price.js'")).toBe(true);

    const once = async (source: string) => {
      const globals: Record<string, unknown> = { expect: jestExpect, jest: { fn: spy.fn } };
      const sys = mods.createModuleSystem({ ...files, './cart.test.js': source }, globals);
      const root = api.collect((a) => {
        Object.assign(globals, a);
        sys.require('./cart.test.js');
      }, api.FLAVORS.jest);
      const results = await api.run(root, api.FLAVORS.jest);
      const cart = sys.registry.get('./cart.js') as { checkout: (i: unknown[]) => string };
      return { state: results[0].state, plain: (() => { try { return cart.checkout([]); } catch (e) { return (e as Error).message; } })() };
    };
    expect(await once(t.MOCK_TEST_JEST)).toEqual({ state: 'fail', plain: 'К оплате: 0' });
    expect(await once(hoisted)).toEqual({ state: 'pass', plain: 'Лимит превышен: 999' });
    expect(t.HOIST_NOTE).toContain('`К оплате: 0`');
  });
});

/** Сценарий шпиона: рекурсия, ошибка, вызов как метод. */
function spyScenario(make: (impl: (this: unknown, n: number) => number) => { (n: number): number; mock: { calls: unknown[][]; results: { type: string; value: unknown }[]; contexts: unknown[] } }) {
  const seen: string[] = [];
  const fact = make(function (n: number): number {
    seen.push(fact.mock.results.map((r) => r.type).join(','));
    if (n < 0) throw new Error('минус');
    return n <= 1 ? 1 : n * fact(n - 1);
  });
  fact(3);
  try {
    fact(-1);
  } catch {
    /* записано в results */
  }
  const obj = { k: 2, m: fact };
  obj.m(1);
  return {
    seen,
    calls: fact.mock.calls,
    results: fact.mock.results.map((r) => ({ type: r.type, value: r.type === 'throw' ? (r.value as Error).message : r.value })),
    ctx: fact.mock.contexts.map((c) => (c as { k?: number } | undefined)?.k ?? null),
  };
}

describe('шпионы', () => {
  it('SPY_LOG — журнал фикстуры в обоих раннерах', () => {
    expect(got.logs['spy-vitest']).toEqual(t.SPY_LOG.vitest);
    expect(got.logs['spy-jest']).toEqual(t.SPY_LOG.jest);
  });

  it('SPY_CODE пишет calls, results и contexts так же, как @vitest/spy и jest-mock', () => {
    const { fn } = loadSpy(t.SPY_CODE);
    const mocker = new ModuleMocker(globalThis);
    const mine = spyScenario((impl) => fn(impl as never) as never);
    expect(spyScenario((impl) => vitestFn(impl) as never)).toEqual(mine);
    expect(spyScenario((impl) => mocker.fn(impl) as never)).toEqual(mine);
    expect(mine.seen[1]).toBe('incomplete,incomplete');
  });

  it('spyOn зовёт оригинал и возвращает его на место', () => {
    const { spyOn } = loadSpy(t.SPY_CODE);
    const obj = { max: Math.max };
    const s = spyOn(obj, 'max');
    expect(obj.max(1, 5)).toBe(5);
    expect(s.mock.calls).toEqual([[1, 5]]);
    s.mockRestore?.();
    expect(obj.max).toBe(Math.max);
  });
});

/** Часы `@sinonjs/fake-timers` под интерфейсом учебных. */
function sinonClock(): Pick<Clock, 'setTimeout' | 'setInterval' | 'clearInterval' | 'now' | 'count' | 'advance'> {
  const c = FakeTimers.createClock(0);
  return {
    setTimeout: (f, ms) => c.setTimeout(f, ms) as unknown as number,
    setInterval: (f, ms) => c.setInterval(f, ms) as unknown as number,
    clearInterval: (id) => c.clearInterval(id as never),
    now: () => c.now,
    count: () => c.countTimers(),
    advance: (ms) => void c.tick(ms),
  };
}

describe('фейковые таймеры', () => {
  const createClock = loadClock(t.CLOCK_CODE);

  it('TIMERS_LOG — журнал фикстуры; различие только в предохранителе', () => {
    expect(got.logs['timers-vitest']).toEqual(t.TIMERS_LOG.vitest);
    expect(got.logs['timers-jest']).toEqual(t.TIMERS_LOG.jest);
    expect(t.TIMERS_LOG.vitest.slice(0, -2)).toEqual(t.TIMERS_LOG.jest.slice(0, -2));
    expect(t.TIMERS_LOG.vitest.slice(-2)).toEqual(['ошибка: Aborting after running 10000 timers, assuming an infinite loop!', 'часы: 100000']);
    expect(t.TIMERS_LOG.jest.slice(-2)).toEqual(['ошибка: Aborting after running 100000 timers, assuming an infinite loop!', 'часы: 1000000']);
    // Синхронная прокрутка: then из таймера 10 — после таймера 20.
    const sync = t.TIMERS_LOG.vitest.filter((l) => l.startsWith('sync'));
    expect(sync.indexOf('sync: then из таймера 10')).toBeGreaterThan(sync.indexOf('sync: таймер 20'));
    const as = t.TIMERS_LOG.vitest.filter((l) => l.startsWith('async'));
    expect(as.indexOf('async: then из таймера 10')).toBeLessThan(as.indexOf('async: таймер 20'));
    expect(t.TIMERS_LOG.vitest).toContain('51 мс: E (0, из D)');
  });

  it('CLOCK_SCENARIO_CODE на учебных часах даёт журнал первого теста фикстуры', () => {
    const log: string[] = [];
    const clock = startScenario(createClock, t.CLOCK_SCENARIO_CODE, (s) => log.push(s));
    log.unshift(`в очереди: ${clock.count()}`);
    clock.advance(120);
    log.push(`после 120 мс в очереди: ${clock.count()}`);
    expect(log).toEqual(t.TIMERS_LOG.vitest.slice(0, 9));
    // Подписи демо: номера таймеров по порядку постановки, C — интервал.
    expect(Object.values(t.TIMER_LABELS)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('runAll на вечном интервале — та же ошибка и те же часы, что у vitest и jest', () => {
    for (const [limit, kind] of [[10000, 'vitest'], [100000, 'jest']] as const) {
      const c = createClock(0);
      c.setInterval(() => {}, 10);
      let msg = '';
      try {
        c.runAll(limit);
      } catch (e) {
        msg = (e as Error).message;
      }
      expect([`ошибка: ${msg}`, `часы: ${c.now()}`]).toEqual(t.TIMERS_LOG[kind].slice(-2));
    }
  });

  it('createClock совпадает с @sinonjs/fake-timers на трёхстах случайных расписаниях', () => {
    let bad = 0;
    for (let seed = 1; seed <= 300; seed++) {
      let x = seed;
      const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
      const ops = Array.from({ length: 12 }, () => ({
        interval: rnd() < 0.2,
        ms: Math.floor(rnd() * 60),
        nest: rnd() < 0.3 ? Math.floor(rnd() * 20) : -1,
        adv: Math.floor(rnd() * 50),
      }));
      const playOn = (c: ReturnType<typeof sinonClock>) => {
        const log: string[] = [];
        const ids: number[] = [];
        let fired = 0;
        ops.forEach((o, k) => {
          const cb = () => {
            log.push(`${k}@${c.now()}`);
            if (o.nest >= 0) c.setTimeout(() => log.push(`${k}n@${c.now()}`), o.nest);
            if (o.interval && ++fired > 6) c.clearInterval(ids[k]);
          };
          ids[k] = o.interval ? c.setInterval(cb, o.ms || 5) : c.setTimeout(cb, o.ms);
          if (k % 3 === 2) c.advance(o.adv);
        });
        c.advance(200);
        log.push(`n=${c.count()}`);
        return log.join(',');
      };
      if (playOn(createClock(0)) !== playOn(sinonClock())) bad++;
    }
    expect(bad).toBe(0);
  });
});

describe('почему тесты текут', () => {
  it('SEED_ROWS: порядок и число упавших на тех же зёрнах', () => {
    expect(got.seeds.map(({ order, failed }) => ({ order, failed }))).toEqual(t.SEED_ROWS.map(({ order, failed }) => ({ order, failed })));
    // По порядку зелёный, на каком-то зерне каждого раннера — красный.
    for (const kind of KINDS) {
      const rows = t.SEED_ROWS.filter((r) => r.runner === kind);
      expect(rows[0].flags).toEqual([]);
      expect(rows[0].failed).toBe(0);
      expect(rows.some((r) => r.failed > 0)).toBe(true);
    }
  });

  it('SEED_NOTE: зерно печатается в отчёте обоих раннеров', () => {
    const v = got.seeds[t.SEED_ROWS.findIndex((r) => r.runner === 'vitest' && r.flags.length)];
    const j = got.seeds[t.SEED_ROWS.findIndex((r) => r.runner === 'jest' && r.flags.length)];
    expect(v.text).toMatch(/Running tests with seed "\d+"/);
    expect(j.text).toMatch(/Seed:\s+\d+/);
  });

  it('OPEN_FIXTURE: таймер A срабатывает в тесте B; Jest не выходит, Vitest выходит', () => {
    expect(got.open.vitest.log).toEqual(t.OPEN_LOG);
    expect(got.open.jest.log).toEqual(t.OPEN_LOG);
    expect(t.OPEN_LOG[2]).toBe('таймер из A сработал во время: B: ждёт 300 мс');
    expect(got.open.vitest.code).toBe(0);
    expect(got.open.jest.signal).toBe('SIGKILL');
    expect(got.open.jest.text).toContain(t.OPEN_JEST_TAIL);
  });
});
