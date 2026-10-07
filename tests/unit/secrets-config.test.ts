import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import vm from 'node:vm';
import { build as esbuild } from 'esbuild';
import { loadEnv } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/secrets-config/data';
import { judge, loadEnvApi, loadScan } from '@/widgets/env-lab/model/run';

/**
 * Тема «Секреты и конфигурация: что попадает в бандл».
 *
 * `LOAD_ENV_CODE` и `SCAN_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь первая сверяется с `loadEnv` настоящего Vite на всех сочетаниях файлов фикстуры,
 * вторая — прогоняется по бандлам, которые собирают Vite и esbuild. Литералы стенда
 * (`BUNDLE_ROWS`, `ESBUILD_ROWS`, выводы Node, YAML Secret, история git, `SCAN_STATS`)
 * пересобираются теми же вызовами: сменится версия сборщика — покраснеет здесь.
 *
 * Не пересобирается только Docker (`PROC_TRANSCRIPT`) — см. шапку `data.ts`.
 */

const require = createRequire(import.meta.url);
const PROJECT = resolve(dirname(require.resolve('vite/package.json')), '../..');
const env = loadEnvApi(t.LOAD_ENV_CODE);
const scan = loadScan(t.SCAN_CODE);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'secrets-config-')));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const node = (args: string[], opts: { env?: NodeJS.ProcessEnv; cwd?: string } = {}) =>
  execFileSync(process.execPath, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] }).toString().replace(/\n$/, '');

describe('.env-файлы: loadEnvFiles совпадает с loadEnv из Vite', () => {
  it('разбор файла совпадает с util.parseEnv, которым читает Vite', () => {
    for (const text of [...Object.values(t.ENV_FILES), t.BUNDLE_ENV]) {
      expect(env.parseDotenv(text)).toEqual(parseEnv(text));
    }
  });

  it('все сочетания: 3 режима × 64 набора файлов × оболочка × 2 набора префиксов', () => {
    const grid = join(dir, 'grid');
    const names = Object.keys(t.ENV_FILES);
    const saved = process.env.VITE_API_URL;
    let cases = 0;
    try {
      for (const mode of t.ENV_MODES) {
        for (let mask = 0; mask < 1 << names.length; mask++) {
          rmSync(grid, { recursive: true, force: true });
          mkdirSync(grid);
          const files: Record<string, string> = {};
          names.forEach((name, i) => {
            if (mask & (1 << i)) {
              files[name] = t.ENV_FILES[name];
              writeFileSync(join(grid, name), t.ENV_FILES[name]);
            }
          });
          for (const withShell of [false, true]) {
            if (withShell) process.env.VITE_API_URL = t.SHELL_VAR.VITE_API_URL;
            else delete process.env.VITE_API_URL;
            for (const set of t.ENV_PREFIX_SETS) {
              const real = loadEnv(mode, grid, set.prefixes);
              const mine = env.loadEnvFiles(mode, files, withShell ? t.SHELL_VAR : {}, set.prefixes).env;
              expect(mine, `${mode} ${Object.keys(files).join(',')} shell=${withShell} ${set.label}`).toEqual(real);
              cases++;
            }
          }
        }
      }
    } finally {
      if (saved === undefined) delete process.env.VITE_API_URL;
      else process.env.VITE_API_URL = saved;
    }
    expect(cases).toBe(768);
  });

  it('утверждения раздела: порядок, оболочка, подстановка, режим local', () => {
    const all = t.ENV_FILES;
    const two = { '.env.local': all['.env.local'], '.env.production': all['.env.production'] };
    expect(env.loadEnvFiles('production', two, {}).from.VITE_API_URL).toBe('.env.production');
    expect(env.loadEnvFiles('development', { '.env': all['.env'], '.env.local': all['.env.local'] }, {}).env.VITE_API_URL).toBe(
      'http://localhost:8080',
    );
    expect(env.loadEnvFiles('production', all, t.SHELL_VAR).from.VITE_API_URL).toBe('оболочка');
    expect(env.loadEnvFiles('production', all, {}).env.VITE_DEBUG_DB).toBe('pg-Zx81-secret');
    expect(env.loadEnvFiles('production', all, {}).env.DB_PASSWORD).toBeUndefined();
    expect(() => env.envFilesFor('local')).toThrow();
    expect(() => loadEnv('local', dir)).toThrow(/local/);
  });

  it('ENV_FACTS: .env не трогает process.env сборки, NODE_ENV из файла становится VITE_USER_NODE_ENV', () => {
    const d = join(dir, 'facts');
    mkdirSync(d);
    writeFileSync(join(d, '.env'), 'NODE_ENV=development\nDB_PASSWORD=pg-Zx81-secret\nVITE_X=1\n');
    const code = `import { loadEnv } from ${JSON.stringify(pathToFileURL(require.resolve('vite')).href)};
const e = loadEnv('production', ${JSON.stringify(d)});
console.log(JSON.stringify([e, process.env.DB_PASSWORD ?? null, process.env.NODE_ENV ?? null]));`;
    const [loaded, pw, nodeEnv] = JSON.parse(node(['--input-type=module', '-e', code], { env: { PATH: process.env.PATH } }));
    expect(loaded).toEqual({ VITE_X: '1', VITE_USER_NODE_ENV: 'development' });
    expect(pw).toBeNull();
    expect(nodeEnv).toBeNull();
  });
});

describe('бандлы: BUNDLE_ROWS — то, что vite build пишет сейчас', () => {
  let outs: Record<string, string> = {};
  let prefixError = '';

  beforeAll(() => {
    const runner = join(dir, 'build-all.mjs');
    writeFileSync(
      runner,
      `import { build } from ${JSON.stringify(pathToFileURL(require.resolve('vite')).href)};
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
delete process.env.__CF_USER_TEXT_ENCODING; // macOS добавляет его каждому процессу
const [rows, envText, leakConfig, base, nm] = JSON.parse(process.argv[2]);
const out = {};
for (const row of rows) {
  const root = join(base, row.id);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, '.env'), envText);
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.js"></script>');
  writeFileSync(join(root, 'src/main.js'), row.src);
  const options = { root, mode: 'production', logLevel: 'silent', build: { outDir: join(root, 'dist'), modulePreload: { polyfill: false } } };
  if (row.config?.leakConfig) {
    symlinkSync(nm, join(root, 'node_modules'));
    writeFileSync(join(root, 'vite.config.js'), leakConfig);
    process.chdir(root);
  } else {
    options.configFile = false;
    if (row.config?.envPrefix) options.envPrefix = row.config.envPrefix;
  }
  await build(options);
  out[row.id] = readdirSync(join(root, 'dist/assets')).map((f) => readFileSync(join(root, 'dist/assets', f), 'utf8')).join('');
}
let prefixError = '';
try { await build({ root: join(base, 'named'), configFile: false, logLevel: 'silent', envPrefix: '' }); } catch (e) { prefixError = e.message; }
console.log(JSON.stringify({ out, prefixError, pw: process.env.DB_PASSWORD ?? null }));`,
    );
    const shell = { PATH: '/usr/bin:/bin', ...t.BUILD_SHELL };
    const args = JSON.stringify([t.BUNDLE_ROWS, t.BUNDLE_ENV, t.VITE_CONFIG_LEAK_CODE, join(dir, 'bundles'), join(PROJECT, 'node_modules')]);
    const res = JSON.parse(node([runner, args], { env: shell }));
    outs = res.out;
    prefixError = res.prefixError;
    expect(res.pw).toBeNull();
  }, 120_000);

  for (const row of t.BUNDLE_ROWS) {
    it(`${row.id}: ${row.src.split('\n')[0]}`, () => {
      expect(outs[row.id].replace(/\n$/, '')).toBe(row.out);
    });
  }

  it('envPrefix: "" — ошибка сборки, текст как в теме', () => {
    expect(prefixError).toBe(t.ENVPREFIX_ERROR);
  });

  it('утечки, названные в таблице, действительно в бандле', () => {
    const has = (id: string, s: string) => t.BUNDLE_ROWS.find((r) => r.id === id)!.out.includes(s);
    expect(has('nonprefix', 'pg-Zx81-secret')).toBe(false);
    expect(has('devbranch', 'sentry')).toBe(false);
    for (const id of ['whole', 'dynamic', 'expand', 'prefix2', 'defineAll']) expect(has(id, 'pg-Zx81-secret')).toBe(true);
    expect(has('defineAll', t.BUILD_SHELL.DEPLOY_TOKEN)).toBe(true);
    expect(t.BUNDLE_ROWS.every((r) => !r.out.includes('VITE_API_URL:') || r.id !== 'named')).toBe(true);
  });
});

describe('esbuild: ESBUILD_ROWS', () => {
  for (const row of t.ESBUILD_ROWS) {
    it(row.k, async () => {
      const define = row.define?.['process.env']?.startsWith('<')
        ? { 'process.env': JSON.stringify(t.ESBUILD_ENV) }
        : row.define;
      const r = await esbuild({
        stdin: { contents: t.ESBUILD_SRC, loader: 'js' },
        bundle: true,
        minify: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        logLevel: 'silent',
        define,
      });
      expect(r.outputFiles[0].text.replace(/\n$/, '')).toBe(row.out);
    });
  }

  it('без define код падает в браузере: process нет', () => {
    const ctx = vm.createContext({ console: { log() {} } });
    expect(() => vm.runInContext(t.ESBUILD_ROWS[0].out, ctx)).toThrow(expect.objectContaining({ name: 'ReferenceError' }));
  });

  it('значение define — текст кода: строка без кавычек отвергается', async () => {
    await expect(
      esbuild({ stdin: { contents: t.ESBUILD_SRC }, write: false, logLevel: 'silent', define: { 'process.env.API_URL': 'https://api.shop.example' } }),
    ).rejects.toThrow(/must be an entity name or JS literal/);
  });
});

describe('конфиг при запуске: RENDER_CONFIG_CODE', () => {
  const renderConfig = new Function(`${t.RENDER_CONFIG_CODE}\nreturn renderConfig;`)() as (e: Record<string, string>) => string;

  it('вывод на окружении примера — RUNTIME_OUT, пароля нет', () => {
    expect(renderConfig(t.RUNTIME_ENV)).toBe(t.RUNTIME_OUT);
    expect(t.RUNTIME_OUT).not.toContain('pg-Zx81-secret');
  });

  it('`<` экранирован, а значение после исполнения то же', () => {
    const evil = '</script><script>alert(1)</script>';
    const out = renderConfig({ API_URL: evil });
    expect(out).not.toContain('<');
    const ctx = vm.createContext({ window: {} as Record<string, unknown> });
    vm.runInContext(out, ctx);
    expect((ctx.window as { __CONFIG__: Record<string, string> }).__CONFIG__).toEqual({ API_URL: evil });
  });
});

describe('секрет на сервере: выводы Node', () => {
  it('ENV_STRINGS_CODE', () => {
    expect(node(['-e', t.ENV_STRINGS_CODE], { env: { PATH: process.env.PATH } })).toBe(t.ENV_STRINGS_OUT);
    expect(Number('')).toBe(0);
  });

  it('CHILD_ENV_CODE', () => {
    expect(node(['-e', t.CHILD_ENV_CODE], { env: { PATH: process.env.PATH } })).toBe(t.CHILD_ENV_OUT);
  });

  it('REPORT_CODE: окружение в отчёте, и его нет с --report-exclude-env', () => {
    expect(node(['-e', t.REPORT_CODE])).toBe('pg-Zx81-secret');
    expect(node(['--report-exclude-env', '-e', t.REPORT_CODE])).toBe('undefined');
  });

  it('SECRET_YAML: base64 — это пароль', () => {
    const value = /DB_PASSWORD: (\S+)/.exec(t.SECRET_YAML)![1];
    expect(Buffer.from(value, 'base64').toString()).toBe('pg-Zx81-secret');
    expect(Buffer.from('pg-Zx81-secret').toString('base64')).toBe(value);
  });

  const kubectl = spawnSync('kubectl', ['version', '--client'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!kubectl)('SECRET_YAML дословно пишет kubectl --dry-run=client', () => {
    const out = execFileSync('kubectl', [
      'create', 'secret', 'generic', 'db', '--from-literal=DB_PASSWORD=pg-Zx81-secret', '--dry-run=client', '-o', 'yaml',
    ]).toString();
    expect(out.trim()).toBe(t.SECRET_YAML);
  });
});

describe('история git: GIT_TRANSCRIPT', () => {
  const git = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
  it.skipIf(!git)('удалённый коммитом .env находится в истории', () => {
    const repo = join(dir, 'repo');
    mkdirSync(repo);
    const gitEnv = {
      PATH: process.env.PATH,
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'dev',
      GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'dev',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
      GIT_AUTHOR_DATE: '2026-09-01T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-09-01T10:00:00Z',
    };
    const sh = (cmd: string) => {
      const r = spawnSync('sh', ['-c', cmd], { cwd: repo, env: gitEnv });
      return { code: r.status, out: r.stdout.toString().trim() };
    };
    sh("git init -q -b main && echo 'console.log(1)' > app.js && git add . && git commit -qm init");
    // Строки транскрипта с «$ » до первой проверки исполняются как есть.
    for (const line of t.GIT_TRANSCRIPT.split('\n').filter((l) => l.startsWith('$ ')).slice(0, 4)) {
      expect(sh(line.slice(2)).code).toBe(0);
    }
    expect(sh('git grep sk_live HEAD').code).toBe(1);
    const log = sh('git log --oneline -S sk_live_ --all').out;
    expect(t.GIT_TRANSCRIPT).toContain(log);
    const added = log.split('\n')[1].split(' ')[0];
    expect(t.GIT_TRANSCRIPT).toContain(`git show ${added}:.env`);
    expect(sh(`git show ${added}:.env`).out).toBe('STRIPE_SECRET=sk_live_51HqLyjWDarjtT1zdp7dc');
  });
});

describe('сканер: SCAN_CODE на настоящих бандлах', () => {
  const LIBS: Record<string, string> = {
    'Vue 3.5.42': "export * from 'vue'",
    'React 19.3.0 + react-dom': "export * from 'react'; export * from 'react-dom/client'",
    'd3-scale + d3-shape': "export * from 'd3-scale'; export * from 'd3-shape'",
  };
  const bundles: Record<string, string> = {};

  beforeAll(async () => {
    for (const [lib, contents] of Object.entries(LIBS)) {
      const r = await esbuild({
        stdin: { contents, resolveDir: PROJECT },
        bundle: true,
        minify: true,
        write: false,
        format: 'esm',
        charset: 'utf8',
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': '"production"' },
      });
      bundles[lib] = r.outputFiles[0].text;
    }
  }, 60_000);

  it('версии библиотек — как в SCAN_STATS', () => {
    expect(require('vue/package.json').version).toBe('3.5.42');
    expect(require('react/package.json').version).toBe('19.3.0');
    expect(require('react-dom/package.json').version).toBe('19.3.0');
  });

  it('SCAN_STATS: байты и число находок при каждом пороге', () => {
    for (const s of t.SCAN_STATS) {
      const text = bundles[s.lib];
      expect(text.length, s.lib).toBe(s.bytes);
      for (const minBits of t.SCAN_THRESHOLDS) {
        expect(scan.scanSecrets(text, { minBits, needDigit: false }).length, `${s.lib} ${minBits}`).toBe(s.hits[String(minBits)]);
        expect(scan.scanSecrets(text, { minBits, needDigit: true }).length, `${s.lib} ${minBits} d`).toBe(s.hits[`${minBits}d`]);
      }
    }
  });

  it('REACT_LITERALS — кандидаты сканера в бандле React', () => {
    const vals = [...new Set(scan.scanSecrets(bundles['React 19.3.0 + react-dom'], { minBits: 3.5, needDigit: false }).map((f) => f.value))];
    expect(vals).toEqual(t.REACT_LITERALS);
  });

  it('потолок энтропии: 20 символов — не больше log2(20)', () => {
    expect(scan.entropy('Kq8vT3nB0xLwYz5RpA7m')).toBeCloseTo(Math.log2(20), 10);
    expect(Math.log2(20)).toBeCloseTo(4.32, 2);
    const d = scan.entropy('dangerouslySetInnerHTML');
    expect(d).toBeGreaterThanOrEqual(4);
    expect(d).toBeLessThan(4.5);
  });

  it('образцы демо: пойманное, пропущенное и ложная тревога — как в тексте', () => {
    const at = (id: string, minBits: number, needDigit = true) => {
      const sample = t.SCAN_SAMPLES.find((s) => s.id === id)!;
      return judge(sample, scan.scanSecrets(sample.text, { minBits, needDigit }));
    };
    // Модуль с ключами: при 4.5 пропущен 20-символьный ключ, pk_live — ложная тревога всегда.
    expect(at('config', 4).missed).toEqual([]);
    expect(at('config', 4.5).missed).toEqual(['Kq8vT3nB0xLwYz5RpA7m']);
    for (const b of t.SCAN_THRESHOLDS) expect(at('config', b).noise.map((f) => f.value)).toEqual(['pk_live_51HqLyjWDarjtT1zdAbCdEf']);
    // DSN Sentry не находится ни при каком пороге.
    for (const b of t.SCAN_THRESHOLDS) expect(at('config', b, false).noise.some((f) => f.value.includes('sentry'))).toBe(false);
    // Бандл с define: пароль базы энтропия не видит ни при каком пороге.
    for (const b of t.SCAN_THRESHOLDS) for (const d of [true, false]) expect(at('define', b, d).missed).toEqual(['pg-Zx81-secret']);
    // React: без требования цифры при 4.0 — одна строка, с ним — ничего.
    expect(new Set(at('react', 4, false).noise.map((f) => f.value))).toEqual(new Set(['dangerouslySetInnerHTML']));
    for (const b of t.SCAN_THRESHOLDS) expect(at('react', b, true).noise).toEqual([]);
  });
});
