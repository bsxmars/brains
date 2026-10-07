import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { build, transform } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/transpilation/data';
import { loadDecide } from '@/widgets/transpile-lab/model/run';
import type { CompatTable, Targets } from '@/widgets/transpile-lab/model/types';

/**
 * Тема «Транспиляция и полифилы».
 *
 * `DECIDE_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с `@babel/helper-compilation-targets` (цели) и с решением `@babel/preset-env`
 * (вывод `debug`) на двух десятках запросов browserslist, а с `useBuiltIns: 'usage'` —
 * на модулях core-js. Литералы стенда (`PRESETS`, `SNIPPETS`, `COMPAT`, `ESBUILD`, …)
 * пересобираются теми же вызовами, что в шапке `data.ts`, и сравниваются как есть: сменится
 * версия Babel, core-js, браузерных данных или esbuild — покраснеет здесь.
 *
 * Всё, что трогает глобальные объекты (core-js, удаление встроенных функций), идёт
 * в отдельном процессе Node или в отдельном realm `vm`: процесс vitest общий для тестов.
 */

const require = createRequire(import.meta.url);
const babel = require('@babel/core') as typeof import('@babel/core');
const browserslist = require('browserslist') as (q: string, o?: object) => string[];
const targetsLib = require('@babel/helper-compilation-targets') as {
  default: (t: { browsers: string }) => Record<string, string>;
};
const presetData = require('@babel/preset-env/lib/plugins-compat-data.js') as {
  plugins: CompatTable;
  overlappingPlugins: Record<string, string[]>;
};
const pluginsCompat = require('@babel/compat-data/plugins') as CompatTable;
const coreCompat = require('core-js-compat/data.json') as CompatTable;
const ts = require('typescript') as typeof import('typescript');

const api = loadDecide(t.DECIDE_CODE);
const ROOT = process.cwd();
const B = (s: string) => Buffer.byteLength(s);
const gz = (s: string) => gzipSync(Buffer.from(s), { level: 9 }).length;
const min = async (code: string, format: 'esm' | undefined = 'esm') =>
  (await transform(code, { minify: true, charset: 'utf8', ...(format ? { format } : {}) })).code;

/** preset-env с перехватом вывода `debug` и предупреждений. */
function env(code: string, targets: string, extra: Record<string, unknown> = {}) {
  const logs: string[] = [];
  const warns: string[] = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...a: unknown[]) => void logs.push(a.join(' '));
  console.warn = (...a: unknown[]) => void warns.push(a.join(' '));
  try {
    const r = babel.transformSync(code, {
      configFile: false,
      babelrc: false,
      browserslistConfigFile: false,
      filename: 'cart.js',
      presets: [['@babel/preset-env', { targets, modules: false, ...extra }]],
    });
    return { code: r?.code ?? '', log: logs.join('\n'), warn: warns.join('\n') };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/** Плагины-преобразования из `debug`: имена `proposal-…` — старые имена тех же `transform-…`. */
function debugPlugins(log: string): string[] {
  const block = log.split('Using plugins:')[1].split('\n\n')[0];
  return block
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => !s.startsWith('syntax-'))
    .map((s) => s.split(' ')[0].replace(/^proposal-/, 'transform-'));
}

const modules = (code: string) =>
  code
    .split('\n')
    .filter((l) => l.startsWith('import "core-js'))
    .map((l) => /modules\/(.*)\.js/.exec(l)![1]);

async function bundle(mods: string[]) {
  const r = await build({
    stdin: { contents: mods.map((m) => `import "core-js/modules/${m}.js";`).join('\n'), resolveDir: ROOT },
    bundle: true,
    minify: true,
    write: false,
    format: 'iife',
    charset: 'utf8',
    logLevel: 'silent',
  });
  const text = r.outputFiles[0].text;
  return { bytes: B(text), gzip: gz(text) };
}

const strip = (v: string) => v.replace(/(\.0)+$/, '');
const normTargets = (o: Targets) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, strip(v)]).sort());

/** Запросы для сверки: пять из демо и ещё шестнадцать — с мобильными, Node, диапазонами и пустыми целями. */
const QUERIES = [
  ...t.PRESETS.map((p) => p.query),
  'last 2 versions',
  '> 1%',
  'firefox esr',
  'supports es6-module',
  'node 18',
  'ios_saf 15.4',
  'and_chr 120',
  'samsung 20',
  'op_mini all',
  'last 2 versions, not dead',
  'cover 99.5%',
  'safari 14.1',
  'android 4.4.3',
  'opera 60',
  'edge 18',
  'ie 11, chrome 100',
];

describe('DECIDE_CODE против Babel', () => {
  it.each(QUERIES)('цели для «%s» — как у helper-compilation-targets', (q) => {
    const mine = api.lowestVersions(browserslist(q, { mobileToDesktop: true }));
    const theirs = targetsLib.default({ browsers: q });
    expect(normTargets(mine)).toEqual(normTargets(theirs));
  });

  it.each(QUERIES)('плагины для «%s» — как в выводе debug у preset-env', (q) => {
    const targets = api.lowestVersions(browserslist(q, { mobileToDesktop: true }));
    const mine = new Set(api.required(presetData.plugins, targets));
    // preset-env ещё выбрасывает bugfix-плагины, которые покрыты полным плагином.
    for (const [full, covered] of Object.entries(presetData.overlappingPlugins)) {
      if (mine.has(full)) covered.forEach((c) => mine.delete(c));
    }
    const theirs = debugPlugins(env('1;', q, { debug: true }).log);
    expect([...mine].sort()).toEqual([...theirs].sort());
  });

  it('пустые цели: op_mini all — Babel переписывает всё, 46 плагинов, больше, чем для IE 11', () => {
    expect(api.lowestVersions(browserslist('op_mini all', { mobileToDesktop: true }))).toEqual({});
    const opMini = debugPlugins(env('1;', 'op_mini all', { debug: true }).log);
    const ie = t.PRESETS.find((p) => p.id === 'ie-11')!;
    expect(opMini).toHaveLength(46);
    expect(ie.plugins).toBe(42);
    expect(t.DECIDE_NOTE).toContain('все 46 плагинов: на четыре больше, чем для IE 11');
  });

  it('строки демо: решение по COMPAT и CORE_COMPAT совпадает с preset-env и usage на каждом запросе', () => {
    const sample = t.SAMPLE_CODE;
    for (const p of t.PRESETS) {
      const targets = api.lowestVersions(p.browsers);
      const plugins = new Set(debugPlugins(env(sample, p.query, { debug: true }).log));
      const usage = new Set(modules(env(sample, p.query, { useBuiltIns: 'usage', corejs: '3.50' }).code));
      for (const f of t.FEATURES) {
        const table = f.kind === 'syntax' ? t.COMPAT : t.CORE_COMPAT;
        const needed = api.required({ [f.item]: table[f.item] }, targets).length > 0;
        const babelSays = f.kind === 'syntax' ? plugins.has(f.item) : usage.has(f.item);
        expect(needed, `${p.query}: ${f.item}`).toBe(babelSays);
      }
    }
  });
});

describe('литералы стенда совпадают с тем, что выдают инструменты сейчас', () => {
  it('COMPAT и CORE_COMPAT — строки настоящих таблиц', () => {
    const ENVS = ['chrome', 'android', 'edge', 'firefox', 'safari', 'ios', 'opera', 'opera_mobile', 'samsung', 'ie', 'node'];
    const pick = (o: Record<string, string>) => Object.fromEntries(ENVS.filter((e) => e in o).map((e) => [e, o[e]]));
    for (const [k, v] of Object.entries(t.COMPAT)) expect(v, k).toEqual(pick(pluginsCompat[k]));
    for (const [k, v] of Object.entries(t.CORE_COMPAT)) expect(v, k).toEqual(pick(coreCompat[k]));
    // Пустая строка таблицы — это «не умеет никто», а не «нет данных».
    expect(t.CORE_COMPAT['web.structured-clone']).toEqual({});
    expect(t.CORE_COMPAT['es.promise.with-resolvers'].chrome).toBe('119');
  });

  it('исходник: байты после минификации и gzip', async () => {
    const m = await min(t.SAMPLE_CODE);
    expect({ bytes: B(t.SAMPLE_CODE), min: B(m), gzip: gz(m) }).toEqual(t.SOURCE_BYTES);
  });

  it.each(t.PRESETS.map((p) => [p.query, p] as const))('запрос «%s»: список, код, байты, полифилы', async (_q, p) => {
    expect(browserslist(p.query, { mobileToDesktop: true })).toEqual(p.browsers);
    const r = env(t.SAMPLE_CODE, p.query, { debug: true });
    expect(r.code).toBe(p.code);
    expect(debugPlugins(r.log)).toHaveLength(p.plugins);
    const m = await min(r.code);
    expect([B(m), gz(m)]).toEqual([p.min, p.gzip]);
    const usage = modules(env(t.SAMPLE_CODE, p.query, { useBuiltIns: 'usage', corejs: '3.50' }).code);
    expect(usage).toEqual(p.usage);
    expect(await bundle(usage)).toEqual({ bytes: p.usageBytes, gzip: p.usageGzip });
    const entry = modules(env('import "core-js/stable";', p.query, { useBuiltIns: 'entry', corejs: '3.50' }).code);
    expect(entry).toHaveLength(p.entry);
    expect(await bundle(entry)).toEqual({ bytes: p.entryBytes, gzip: p.entryGzip });
  }, 60_000);

  it('SNIPPETS: одна конструкция — один плагин', async () => {
    for (const [k, s] of Object.entries(t.SNIPPETS)) {
      const out = babel.transformSync(s.code, {
        configFile: false,
        babelrc: false,
        filename: 'x.js',
        sourceType: 'module',
        plugins: s.plugins.map((name) => require.resolve(`@babel/plugin-${name}`)),
      })!.code;
      expect(out, k).toBe(s.out);
      expect(B(await min(s.code, undefined)), k).toBe(s.before);
      expect(B(await min(out!, undefined)), k).toBe(s.after);
    }
  });

  it('esbuild: байты на одних целях, отказ на других', async () => {
    for (const [target, want] of Object.entries(t.ESBUILD)) {
      try {
        const r = await transform(t.SAMPLE_CODE, { target, format: 'esm', charset: 'utf8', minify: true, logLevel: 'silent' });
        expect({ bytes: B(r.code) }, target).toEqual(want);
        // Полифилов esbuild не добавляет: вызовы остаются как были.
        expect(r.code).toContain('structuredClone(');
        expect(r.code).toContain('Promise.withResolvers()');
        expect(r.warnings).toHaveLength(0);
      } catch (e) {
        const errors = (e as { errors?: { text: string }[] }).errors;
        if (!errors) throw e;
        expect({ errors: errors.length }, target).toEqual(want);
        if (target === 'safari13') expect(errors[0].text).toMatch(/^Transforming destructuring/);
      }
    }
    expect(t.ESBUILD_REFUSE_NOTE).toContain('двенадцать мест');
    expect(t.ESBUILD.es5.errors).toBe(12);
  });

  it('tsc: байты на трёх целях, ES5 — устаревший в TypeScript 6', async () => {
    for (const [name, want] of Object.entries(t.TSC)) {
      const target = ts.ScriptTarget[name as keyof typeof ts.ScriptTarget];
      const out = ts.transpileModule(t.SAMPLE_CODE, { compilerOptions: { target, module: ts.ModuleKind.ESNext } }).outputText;
      expect(B(await min(out)), name).toBe(want);
    }
    const es5 = ts.transpileModule(t.SAMPLE_CODE, { compilerOptions: { target: ts.ScriptTarget.ES5 }, reportDiagnostics: true });
    const text = es5.diagnostics!.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n');
    expect(text).toContain('deprecated');
    expect(text).toContain('ignoreDeprecations');
    expect(text).toContain('7.0');
  });

  it('bugfixes: chrome 80 и safari 14.1', async () => {
    expect(env(t.BUGFIX.source, 'chrome 80').code).toBe(t.BUGFIX.plain);
    expect(env(t.BUGFIX.source, 'chrome 80', { bugfixes: true }).code).toBe(t.BUGFIX.bugfixes);
    expect(B(await min(env(t.SAMPLE_CODE, 'safari 14.1').code))).toBe(t.BABEL_SAFARI_141);
    expect(B(await min(env(t.SAMPLE_CODE, 'safari 14.1', { bugfixes: true }).code))).toBe(t.BABEL_SAFARI_141_BUGFIXES);
    expect(t.BABEL_SAFARI_141_BUGFIXES).toBe(t.SOURCE_BYTES.min);
    // Почему переписан ?. в Chrome 80: в таблице стоит 91, а не 80.
    expect(pluginsCompat['transform-optional-chaining'].chrome).toBe('91');
    expect(t.BUGFIX_NOTE).toContain(`${t.BABEL_SAFARI_141} байт вместо ${t.SOURCE_BYTES.min}`);
  });

  it('вывод debug в теме — подмножество настоящего', () => {
    const log = env(t.SAMPLE_CODE, 'safari >= 13', { debug: true }).log;
    for (const line of t.DEBUG_OUT.split('\n')) {
      if (line === '  …' || line === '') continue;
      expect(log).toContain(line);
    }
  });
});

describe('полифилы', () => {
  it('учебный полифил .at совпадает с родным, наивный виден в for…in', () => {
    const cases = [
      '[1,2,3].at(-1)', '[1,2,3].at(0)', '[1,2,3].at(3)', '[1,2,3].at(-4)', '[1,2,3].at(1.7)', '[1,2,3].at(-0.5)',
      '[1,2,3].at(NaN)', '[1,2,3].at("1")', '[1,2,3].at(Infinity)', '[1,2,3].at(-Infinity)', '[].at(0)',
      'Array.prototype.at.call({ length: 2, 0: "a", 1: "b" }, -1)', 'Array.prototype.at.call("xyz", 1)',
      '[1,2,3].at()', '[,2].at(0)',
    ];
    const run = (prelude: string) =>
      vm.runInNewContext(`${prelude}\n;(${JSON.stringify(cases)}).map((c) => { try { return String(eval(c)); } catch (e) { return e.name; } })`);
    const native = run('');
    const poly = run(`delete Array.prototype.at;\n${t.POLYFILL_AT_CODE}`);
    expect(poly).toEqual(native);
    const keys = vm.runInNewContext(`delete Array.prototype.at;\n${t.POLYFILL_AT_CODE}\nconst k = []; for (const key in ['a', 'b']) k.push(key); k`);
    expect([...keys]).toEqual(['0', '1']);
    const naive = vm.runInNewContext(
      `delete Array.prototype.at;\nconst out = []; const console = { log: (x) => out.push(x) };\n${t.NAIVE_AT_CODE}\nout`,
    );
    expect([...naive]).toEqual(['0', '1', 'at']);
  });

  it('API_ROWS: модули для трёх вызовов', () => {
    const use = (code: string, q: string) => modules(env(code, q, { useBuiltIns: 'usage', corejs: '3.50' }).code);
    expect(use('items.at(-1);', 'safari >= 13')).toEqual(['es.array.at', 'es.string.at-alternative']);
    expect(use('[1, 2].at(-1);', 'safari >= 13')).toEqual(['es.array.at']);
    expect(use('Promise.withResolvers();', 'safari >= 13')).toEqual(['es.promise.with-resolvers']);
    expect(use('Promise.withResolvers();', 'ie 11').sort()).toEqual(['es.object.to-string', 'es.promise', 'es.promise.with-resolvers']);
    expect(use('structuredClone(x);', 'last 2 chrome versions')).toEqual(['web.dom-exception.stack', 'web.structured-clone']);
    expect(use('structuredClone(x);', 'ie 11')).toHaveLength(9);
    expect(t.API_ROWS[2].modules).toContain('девять модулей');
    // Для Safari 13 — девять модулей на три вызова: часть пришла из хелперов Babel.
    const safari = t.PRESETS.find((p) => p.id === 'safari-13')!;
    expect(safari.usage).toHaveLength(9);
    expect(safari.usage).toContain('es.weak-map.get-or-insert');
    expect(safari.usage).toContain('es.error.cause');
    expect(t.HELPER_POLYFILL_NOTE).toContain('девять модулей');
  });

  it('exclude убирает structuredClone из usage', () => {
    const out = env(t.SAMPLE_CODE, 'defaults', { useBuiltIns: 'usage', corejs: '3.50', exclude: ['web.structured-clone'] }).code;
    expect(modules(out)).not.toContain('web.structured-clone');
  });

  it('corejs: "3" молчит, "3.50" подключает, без corejs — предупреждение', () => {
    const code = 'Promise.withResolvers(); [1].at(-1); structuredClone(1);';
    const three = env(code, 'safari >= 13', { useBuiltIns: 'usage', corejs: '3' });
    expect(modules(three.code)).toEqual([]);
    expect(three.warn).toBe('');
    const full = modules(env(code, 'safari >= 13', { useBuiltIns: 'usage', corejs: '3.50' }).code);
    expect(full).toEqual(expect.arrayContaining(['es.array.at', 'es.promise.with-resolvers', 'web.structured-clone']));
    expect(env('Promise.withResolvers();', 'safari >= 13', { useBuiltIns: 'usage' }).warn).toContain('core-js');
  });

  it('SC_CODE: core-js подменяет родной structuredClone (отдельный процесс)', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', t.SC_CODE], { cwd: ROOT, encoding: 'utf8' });
    expect(out.trim()).toBe(t.SC_OUT);
    const chrome = t.PRESETS.find((p) => p.id === 'chrome-last')!;
    expect(chrome.usage).toEqual(['web.dom-exception.stack', 'web.structured-clone']);
    expect(t.SC_NOTE).toContain(chrome.usageBytes.toLocaleString('ru-RU').replace(/\s/g, ' '));
    expect(t.SC_NOTE).toContain(chrome.usageGzip.toLocaleString('ru-RU').replace(/\s/g, ' '));
  });
});

describe('чего не сделать и где копия расходится', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'transpilation-')));
  const write = (name: string, code: string) => {
    writeFileSync(join(dir, name), code);
    return join(dir, name);
  };

  it('переписанная корзина ведёт себя так же; расходятся тег async и текст ошибки', () => {
    const files = ['chrome-last', 'safari-13', 'ie-11'].map((id) => write(`${id}.mjs`, t.PRESETS.find((p) => p.id === id)!.code));
    const script = `
      const out = [];
      for (const f of ${JSON.stringify(files)}) {
        const { Cart, deferred } = await import(f);
        const c = new Cart().add({ id: 1, title: 'Кофе' }, { id: 2, title: 'Круассан' });
        const sum = await c.total(async (id) => id * 100);
        let err; try { Object.getOwnPropertyDescriptor(Cart.prototype, 'last').get.call({}); } catch (e) { err = [e.name, e.message]; }
        out.push({ last: c.last, sum, tag: Object.prototype.toString.call(c.total), ctor: c.total.constructor.name, err, d: typeof deferred().resolve });
      }
      console.log(JSON.stringify(out));`;
    const [native, safari, ie] = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
    for (const r of [safari, ie]) {
      expect(r.last).toBe(native.last);
      expect(r.sum).toEqual(native.sum);
      expect(r.err[0]).toBe('TypeError');
    }
    expect(native.tag).toBe('[object AsyncFunction]');
    expect(ie.tag).toBe('[object Function]');
    expect(ie.ctor).toBe('Function');
    expect(native.err[1]).toContain('Cannot read private member #items');
    expect(ie.err[1]).toBe('Private element is not present on this object');
    expect(t.PRESETS.find((p) => p.id === 'ie-11')!.code).toContain('function _typeof(');
  });

  it('без полифилов переписанная для Safari 13 корзина падает только в last и total', () => {
    const file = write('safari-bare.mjs', t.PRESETS.find((p) => p.id === 'safari-13')!.code);
    const script = `
      delete Array.prototype.at; delete String.prototype.at; delete globalThis.structuredClone;
      const { Cart } = await import(${JSON.stringify(file)});
      const c = new Cart().add({ id: 1, title: 'Кофе' });
      const r = [];
      try { c.last; r.push('ok'); } catch (e) { r.push(e.name); }
      try { await c.total(async () => 1); r.push('ok'); } catch (e) { r.push(e.name); }
      console.log(JSON.stringify(r));`;
    expect(JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }))).toEqual([
      'TypeError',
      'ReferenceError',
    ]);
  });

  it('Proxy и WeakRef: Babel, usage и esbuild молчат', async () => {
    const code = 'const p = new Proxy({}, {}); const r = new WeakRef(p); const f = new FinalizationRegistry(() => {});';
    const r = env(code, 'ie 11', { useBuiltIns: 'usage', corejs: '3.50' });
    expect(modules(r.code)).toEqual([]);
    expect(r.code).toContain('new Proxy(');
    expect(r.code).toContain('new WeakRef(');
    expect(Object.keys(coreCompat).filter((k) => /proxy|weak-ref|finaliz/.test(k))).toEqual([]);
    const e = await transform(code, { target: 'es2015' });
    expect(e.code).toContain('new Proxy(');
    expect(e.warnings).toHaveLength(0);
  });

  it('просмотр назад: Babel не трогает, esbuild переписывает в new RegExp, Safari — с 16.4', async () => {
    const src = 'const price = /(?<=\\$)\\d+/.exec(text);';
    const babelOut = env(src, 'safari >= 13').code;
    const esbuildOut = (await transform(src, { target: 'safari13' })).code.trim();
    const parts = t.LOOKBEHIND_CODE.split('\n').filter((l) => l.startsWith('const'));
    expect(parts).toEqual([src, babelOut, esbuildOut]);
    const without = browserslist('safari >= 13 and not supports js-regexp-lookbehind');
    expect(without[0]).toBe('safari 16.3');
    expect(t.CANT_ROWS[2].what).toContain('Safari до 16.4');
  });

  it('BigInt: ** становится Math.pow и бросает TypeError там, где исходник работал', () => {
    const out = env('const big = 10n ** 20n;', 'ie 11, chrome 100').code;
    expect(t.BIGINT_CODE).toContain(out);
    expect(new Function('return 10n ** 20n')()).toBe(10n ** 20n);
    expect(() => new Function(out)()).toThrow(TypeError);
  });
});

describe('числа в тексте совпадают с литералами', () => {
  const mdx = readFileSync(new URL('../../src/content/tooling/transpilation/index.mdx', import.meta.url), 'utf8');
  const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');

  it('defaults: 35 версий, цели chrome 109 и firefox 140, usage 3 против entry 78', () => {
    const d = t.PRESETS.find((p) => p.id === 'defaults')!;
    const targets = api.lowestVersions(d.browsers);
    expect(d.browsers).toHaveLength(35);
    expect(t.DECIDE_CHIPS[1].label).toBe('browserslist: 35 версий');
    expect(targets.chrome).toBe('109');
    expect(targets.firefox).toBe('140');
    expect(targets.safari).toBe('26.5');
    expect(d.usage).toHaveLength(3);
    expect(d.entry).toBe(78);
    expect(mdx).toContain(`${fmt(d.usageBytes)} байт против ${fmt(d.entryBytes)}`);
    // Babel не знает этих браузеров, и они выпадают из целей.
    for (const name of ['op_mini', 'kaios', 'and_uc', 'and_qq']) {
      const line = d.browsers.find((b) => b.startsWith(`${name} `))!;
      expect(api.lowestVersions([line])).toEqual({});
    }
  });

  it('spread: 21 → 767 байт и шесть хелперов; async → ES5 — 2 772', () => {
    const s = t.SNIPPETS.spread;
    expect(mdx).toContain(`${s.before} байта становится ${s.after}`);
    expect(s.out.split('\n').filter((l) => l.startsWith('function _'))).toHaveLength(6);
    expect(t.SNIPPET_NOTE_ASYNC).toContain(fmt(t.SNIPPETS.asyncEs5.after));
  });

  it('учебная функция — полсотни строк', () => {
    const lines = t.DECIDE_CODE.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(45);
    expect(lines).toBeLessThanOrEqual(55);
    expect(mdx).toContain('полсотни строк');
  });
});
