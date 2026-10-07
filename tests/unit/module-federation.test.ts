import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApps, compileFederation, simulate } from '@/widgets/mf-share-scope/model/federation';
import type { MfCopy, MfLogEntry, MfScope, MfState } from '@/widgets/mf-share-scope/model/types';
import {
  CONSUME_ROWS,
  CONTAINER_CODE,
  DEMO_DEFAULT,
  DEMO_PRESETS,
  FEDERATION_CODE,
  HOST_CODE,
  REACT_TWIN_CODE,
  REACT_TWIN_RUNS,
  SCOPE_CODE,
  SEMVER_MIN_CODE,
  STAND_CODE,
  STAND_HOST_CODE,
  STAND_LIB_CODE,
  STAND_REMOTE_CODE,
  STAND_RUNS,
} from '@/content/tooling/module-federation/data';

/**
 * Тема «Микрофронтенды и Module Federation».
 *
 * Настоящего Module Federation в проекте нет (и поставить его без сети нельзя), поэтому тема
 * показывает механику учебной федерацией — строкой `FEDERATION_CODE`, которую печатает по частям
 * и исполняет в демо. Здесь исполняется **она же**, а не копия:
 *
 * 1. **semver.** Урезанная проверка диапазонов сверяется с настоящим `semver` 7.8.5 — взятым
 *    от лица Astro: в корне `node_modules` лежит шестая версия, поднятая ради Babel.
 * 2. **Таблица выбора версии** `CONSUME_ROWS` — каждая строка прогоняется через `consume`.
 * 3. **Сценарии демо**: совместимые версии → одна копия; несовместимые при singleton →
 *    предупреждение; `strictVersion` → ошибка; remote упал или завис → fallback.
 * 4. **Две копии на самом деле**: строки стенда `STAND_*_CODE` исполняются в Node из файлов,
 *    и результат сверяется с тем, что снято в Chromium; две копии React 19.3.0 рендерятся
 *    в обеих сборках.
 *
 * Правила выбора версии в самой строке сверены с исходником webpack v5.111.1 (см. шапку `data.ts`).
 * Webpack в проекте не установлен, поэтому тест держит согласованность темы с её кодом, а с webpack
 * её связывает только блок «как в рантайме webpack» ниже — два места, где пересказ уже расходился.
 */

const F = compileFederation(FEDERATION_CODE);

const semver = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))('semver') as {
  satisfies(v: string, r: string): boolean;
  compare(a: string, b: string): number;
};

const tmp = mkdtempSync(join(tmpdir(), 'mf-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('код темы — это код демо', () => {
  it('FEDERATION_CODE склеен ровно из пяти напечатанных блоков', () => {
    expect(FEDERATION_CODE).toBe([SEMVER_MIN_CODE, SCOPE_CODE, CONTAINER_CODE, HOST_CODE, STAND_CODE].join('\n\n'));
  });

  it('каждый блок выведен в теме, а демо получает всю строку', () => {
    const mdx = readFileSync(new URL('../../src/content/tooling/module-federation/index.mdx', import.meta.url), 'utf8');
    for (const name of ['SEMVER_MIN_CODE', 'SCOPE_CODE', 'CONTAINER_CODE', 'HOST_CODE', 'STAND_CODE']) {
      expect(mdx, `${name} не напечатан`).toContain(`code={${name}}`);
    }
    expect(mdx).toMatch(/<MfShareScope[^>]*code=\{FEDERATION_CODE\}/);
  });
});

describe('semver: учебная проверка против пакета semver 7', () => {
  const versions: string[] = [];
  for (const a of [0, 1, 2]) for (const b of [0, 1, 2, 3]) for (const c of [0, 1, 2, 5]) versions.push(`${a}.${b}.${c}`);
  versions.push('18.2.0', '18.3.1', '19.0.0', '19.1.0', '20.0.0');
  const ranges = ['*', ...versions.flatMap((v) => ['', '^', '~', '>='].map((op) => op + v))];

  it('satisfies совпадает на всей сетке', () => {
    const wrong: string[] = [];
    for (const r of ranges) for (const v of versions) if (F.satisfies(v, r) !== semver.satisfies(v, r)) wrong.push(`${v} ∈ ${r}`);
    expect(wrong).toEqual([]);
  });

  it('compare совпадает на всех парах', () => {
    const wrong: string[] = [];
    for (const a of versions) for (const b of versions) if (F.compare(a, b) !== semver.compare(a, b)) wrong.push(`${a} vs ${b}`);
    expect(wrong).toEqual([]);
  });

  it('чего не разбирает, то отвергает, а не угадывает', () => {
    expect(() => F.satisfies('1.0.0', '^1.0.0 || ^2.0.0')).toThrow();
    expect(() => F.satisfies('1.0.0-beta.1', '^1.0.0')).toThrow();
    expect(() => F.satisfies('1.0.0', '1.x')).toThrow();
  });
});

describe('shareScope: регистрация и выбор версии', () => {
  const copyOf = (owner: string, version: string) => () => ({ pkg: 'react', version, owner }) as MfCopy;

  it('одну версию от двух сборок держит та, чьё имя больше по строке, — пока никто не eager', () => {
    const scope: MfScope = {};
    F.register(scope, 'react', '18.3.1', 'host', false, copyOf('host', '18.3.1'));
    F.register(scope, 'react', '18.3.1', 'cart', false, copyOf('cart', '18.3.1'));
    expect(scope.react['18.3.1'].from).toBe('host');
    F.register(scope, 'react', '18.3.1', 'zeta', false, copyOf('zeta', '18.3.1'));
    expect(scope.react['18.3.1'].from).toBe('zeta');
    F.register(scope, 'react', '18.3.1', 'cart', true, copyOf('cart', '18.3.1'));
    expect(scope.react['18.3.1'].from, 'eager побеждает имя').toBe('cart');
  });

  it.each(CONSUME_ROWS.map((row, i) => ({ ...row, i })))(
    'строка $i: singleton=$cfg.singleton, strict=$cfg.strictVersion, требует $required → $got',
    (row) => {
      const scope: MfScope = {};
      F.register(scope, 'react', '18.3.1', 'host', false, copyOf('host', '18.3.1'));
      F.register(scope, 'react', '19.1.0', 'cart', false, copyOf('cart', '19.1.0'));
      if (row.loaded) scope.react[row.loaded].loaded = true;
      const log: MfLogEntry[] = [];
      const own = copyOf('своя копия', row.required.replace(/^[\^~]/, ''));
      const cfg = { ...row.cfg, requiredVersion: row.required };

      if (row.level === 'error') {
        expect(() => F.consume(scope, 'react', cfg, own, 'catalog', log)).toThrow(/^Unsatisfied version 19\.1\.0 from cart/);
        return;
      }
      const got = F.consume(scope, 'react', cfg, own, 'catalog', log);
      expect(got.version).toBe(row.got);
      expect(got.owner).toBe(row.from);
      expect(log.length > 0 ? 'warn' : 'ok').toBe(row.level);
    },
  );
});

describe('как в рантайме webpack 5.111 (ConsumeSharedRuntimeModule)', () => {
  const copyOf = (owner: string, version: string) => () => ({ pkg: 'react', version, owner }) as MfCopy;
  // `loadVersion`: без подходящей версии берётся `findLatestVersion` — просто старшая,
  // загруженность не учитывается. Пересказ «по памяти» брал здесь singleton-правило.
  it('нестрогий не-singleton берёт старшую, даже если младшая уже загружена', () => {
    const scope: MfScope = {};
    F.register(scope, 'react', '18.3.1', 'host', false, copyOf('host', '18.3.1'));
    F.register(scope, 'react', '19.1.0', 'cart', false, copyOf('cart', '19.1.0'));
    scope.react['18.3.1'].loaded = true;
    const log: MfLogEntry[] = [];
    const cfg = { singleton: false, strictVersion: false, requiredVersion: '^20.0.0' };
    const got = F.consume(scope, 'react', cfg, copyOf('своя копия', '20.0.0'), 'catalog', log);
    expect(got.version).toBe('19.1.0');
    // Текст — `getInvalidVersionMessage`: без выдуманного «, using X», со списком версий.
    expect(log.map((l) => l.text)).toEqual([
      'No satisfying version (^20.0.0) of shared module react found in shared scope default.\n' +
        'Available versions: 18.3.1 from host, 19.1.0 from cart',
    ]);
  });
});

const TIMEOUT = 20;
const run = (state: MfState) => simulate(F, state, TIMEOUT);
const preset = (label: string) => {
  const p = DEMO_PRESETS.find((x) => x.label === label);
  if (!p) throw new Error(`пресета «${label}» нет в DEMO_PRESETS`);
  return p.state;
};

describe('сценарии демо — прогоном той же строки', () => {
  it('requiredVersion выводится как ^ от своей версии', () => {
    const { host, remotes } = buildApps(DEMO_DEFAULT);
    expect(host.lib.requiredVersion).toBe('^18.3.1');
    expect(remotes.map((r) => r.lib.requiredVersion)).toEqual(['^18.2.0', '^18.3.1']);
  });

  it('совместимые версии → одна копия, старшая, без предупреждений', async () => {
    const { world, run: r } = await run(preset('совместимые версии'));
    expect(world.copies.map((c) => `${c.version}@${c.owner}`)).toEqual(['18.3.1@host']);
    expect(world.log).toEqual([]);
    expect(r.results.catalog?.html).toBe('catalog: useState → 0');
    expect(r.results.cart?.html).toBe('cart: useState → 0');
  });

  it('совместимые версии без singleton → тоже одна копия: 18.3.1 попадает в ^18.2.0', async () => {
    const { world } = await run({ ...DEMO_DEFAULT, singleton: false });
    expect(world.copies).toHaveLength(1);
  });

  it('singleton при несовместимых → одна копия 19.1.0 для всех и предупреждения', async () => {
    const { world, run: r } = await run(preset('cart перешёл на 19'));
    expect(world.copies.map((c) => `${c.version}@${c.owner}`)).toEqual(['19.1.0@cart']);
    expect(r.host?.version).toBe('19.1.0');
    expect(world.log.map((l) => `${l.level} ${l.who}`)).toEqual(['warn host', 'warn catalog']);
    expect(world.log[0].text).toBe('Unsatisfied version 19.1.0 from cart of shared singleton module react (required ^18.3.1)');
  });

  it('без singleton при несовместимых → две копии, и хук чужой копии падает', async () => {
    const { world, run: r } = await run(preset('то же без singleton'));
    expect(world.copies.map((c) => `${c.version}@${c.owner}`)).toEqual(['18.3.1@host', '19.1.0@cart']);
    expect(r.results.catalog?.html).toBe('catalog: useState → 0');
    expect(r.results.cart?.fallback).toBe(true);
    // Та же ошибка, что у настоящего React в продакшен-сборке (REACT_TWIN_RUNS ниже).
    expect(r.results.cart?.error).toBe(REACT_TWIN_RUNS[1].thrown.replace(/^TypeError: /, ''));
  });

  it('строгий singleton без eager → падает host целиком', async () => {
    const { world, run: r } = await run(preset('строгий singleton'));
    expect(r.host).toBeNull();
    expect(world.copies).toEqual([]);
    expect(world.log).toHaveLength(1);
    expect(world.log[0]).toMatchObject({ level: 'error', who: 'host' });
  });

  it('строгий singleton с eager в host → host жив, падает только cart', async () => {
    const { world, run: r } = await run(preset('строгий singleton + eager'));
    expect(r.host?.version).toBe('18.3.1');
    expect(r.results.catalog?.html).toBe('catalog: useState → 0');
    expect(r.results.cart?.fallback).toBe(true);
    expect(world.log.map((l) => `${l.level} ${l.who}`)).toEqual(['error cart']);
    expect(world.log[0].text).toMatch(/^Unsatisfied version 18\.3\.1 from host .* \(required \^19\.1\.0\)$/);
  });

  it('remote упал или завис → fallback, host жив, завис — по таймауту', async () => {
    const { world, run: r } = await run(preset('catalog упал, cart завис'));
    expect(r.host?.version).toBe('18.3.1');
    expect(r.results.catalog).toEqual({ fallback: true });
    expect(r.results.cart).toEqual({ fallback: true });
    expect(world.log.map((l) => l.text)).toEqual([
      'Loading script failed: https://catalog.example.com/remoteEntry.js',
      `Timeout ${TIMEOUT} ms: https://cart.example.com/remoteEntry.js`,
    ]);
  });
});

describe('две копии на самом деле', () => {
  /** Строки стенда — в файлы, как их отдавал сервер: host и remote в разных каталогах. */
  function writeStand() {
    const root = join(tmp, 'stand');
    for (const [path, code] of [
      ['host/app.js', STAND_HOST_CODE],
      ['host/lib.js', STAND_LIB_CODE],
      ['remote/remoteEntry.js', STAND_REMOTE_CODE],
      ['remote/lib.js', STAND_LIB_CODE],
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), code);
    }
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    return root;
  }

  it('ESM-стенд в Node повторяет Chromium: два адреса — две копии, общий объект — одна', () => {
    const root = writeStand();
    for (const row of STAND_RUNS.filter((r) => r.remote.startsWith('127.0.0.1:49231'))) {
      const script = `const { start } = await import(${JSON.stringify(pathToFileURL(join(root, 'host/app.js')).href)});
console.log(JSON.stringify(await start({ remoteUrl: ${JSON.stringify(pathToFileURL(join(root, 'remote/remoteEntry.js')).href)}, share: ${row.share} })));`;
      const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
      expect(out.evaluations, row.k).toBe(row.evaluations);
      expect(out.instanceofWorks, row.k).toBe(row.instanceofWorks);
    }
  });

  it('упавший remote host ловит и отдаёт fallback', () => {
    const root = writeStand();
    const script = `const { start } = await import(${JSON.stringify(pathToFileURL(join(root, 'host/app.js')).href)});
console.log(JSON.stringify(await start({ remoteUrl: ${JSON.stringify(pathToFileURL(join(root, 'nowhere/remoteEntry.js')).href)}, share: true })));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
    expect(out.fallback).toBe(true);
  });

  it.each(REACT_TWIN_RUNS.map((r, i) => ({ ...r, prod: i === 1 })))('две копии React одной версии, сборка $build', (row) => {
    const root = join(tmp, 'react-twin');
    const nodeModules = join(dirname(createRequire(import.meta.url).resolve('react/package.json')), '..');
    cpSync(join(nodeModules, 'react'), join(root, 'twin/node_modules/react'), { recursive: true });
    const script = `const errors = [];
console.error = (first) => errors.push(String(first).split('\\n')[0]);
let thrown = '';
try {
${REACT_TWIN_CODE}
} catch (e) { thrown = e.constructor.name + ': ' + e.message; }
process.stdout.write(JSON.stringify({ thrown, errors, same: require('react') === require('./twin/node_modules/react') }));`;
    writeFileSync(join(root, 'twin.cjs'), script);
    const out = JSON.parse(
      execFileSync(process.execPath, [join(root, 'twin.cjs')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, NODE_PATH: nodeModules, NODE_ENV: row.prod ? 'production' : 'development' },
      }),
    );
    expect(out.same).toBe(false);
    expect(out.thrown).toBe(row.thrown);
    if (row.prod) expect(out.errors).toEqual([]);
    else expect(out.errors[0]?.startsWith(row.console.replace(/ …$/, '')), out.errors[0]).toBe(true);
  });
});
