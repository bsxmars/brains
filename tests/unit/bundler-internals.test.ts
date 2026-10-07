import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build, type BuildOptions } from 'esbuild';
import { rolldown, type RolldownPlugin } from 'rolldown';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/bundler-internals/data';
import { loadBundler, loadChunkHashes } from '@/widgets/bundler-lab/model/run';

/**
 * Тема «Бандлер изнутри».
 *
 * `GRAPH_CODE`, `SHAKE_CODE`, `HOIST_CODE` и `HASH_CODE` — строки из темы: напечатаны на
 * странице и исполняются демо. Здесь учебный сборщик сверяется с настоящим rolldown
 * **посимвольно** на всех сценариях демо, а учебный хеш — по набору переименованных файлов.
 * Литералы стенда (выводы rolldown и esbuild, таблица эффектов, байты обёрток, имена чанков)
 * пересобираются теми же вызовами, что в шапке `data.ts`: сменится версия сборщика и вывод —
 * покраснеет здесь, а не останется неправдой на странице.
 */

const api = loadBundler(t.GRAPH_CODE, t.SHAKE_CODE, t.HOIST_CODE);
const chunkHashes = loadChunkHashes(t.HASH_CODE);

/** Настоящий путь: через `/tmp → /private/tmp` rolldown пишет в `//#region` путь с `../`. */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'bundler-internals-')));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
function project(files: Record<string, string>, dir = join(root, `p${seq++}`)): string {
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), code);
  }
  return dir;
}

const tabs = (s: string) => s.replace(/^\t+/gm, (m) => '  '.repeat(m.length));

async function rd(dir: string, entry = 'src/main.js', plugins: RolldownPlugin[] = []) {
  const logs: string[] = [];
  const bundle = await rolldown({
    input: join(dir, entry),
    cwd: dir,
    plugins,
    onLog: (_level, log) => {
      logs.push(log.code ?? log.message);
    },
  });
  const { output } = await bundle.generate({ format: 'esm' });
  return { chunk: output[0], code: output[0].code, logs };
}

async function es(dir: string, entry = 'src/main.js', extra: BuildOptions = {}) {
  const r = await build({
    entryPoints: [join(dir, entry)],
    absWorkingDir: dir,
    bundle: true,
    format: 'esm',
    write: false,
    charset: 'utf8',
    logLevel: 'silent',
    ...extra,
  });
  const files = r.outputFiles ?? [];
  return { code: files[0].text, warnings: r.warnings.map((w) => w.id), files };
}

describe('учебный сборщик против rolldown 1.2.8', () => {
  it.each(t.SCENARIOS.map((s) => [s.id, s] as const))('сценарий %s: литерал = rolldown = bundle()', async (_id, s) => {
    const real = await rd(project(s.files), s.entry);
    expect(tabs(real.code)).toBe(s.rolldown);
    expect(api.bundle(s.files, s.entry).code).toBe(s.rolldown);
  });

  it('порядок модулей: buildGraph = moduleIds у rolldown = APP_ORDER', async () => {
    const real = await rd(project(t.APP_FILES));
    const dir = real.chunk.moduleIds[0].slice(0, real.chunk.moduleIds[0].indexOf('/src/') + 1);
    expect(real.chunk.moduleIds.map((m) => m.replace(dir, ''))).toEqual(t.APP_ORDER);
    expect(api.buildGraph(t.APP_FILES, 'src/main.js').order.map((m) => m.path)).toEqual(t.APP_ORDER);
  });

  it('отбор на магазине — как в SHAKE_STEPS', () => {
    const graph = api.buildGraph(t.APP_FILES, 'src/main.js');
    const { kept } = api.shake(graph);
    const why = (path: string, start: string) => {
      const st = graph.modules.get(path)!.body.find((s) => s.code.startsWith(start))!;
      const w = kept.get(st);
      return w === undefined ? 'выброшен' : w === 'эффект' ? 'эффект' : 'ссылка';
    };
    expect(why('src/main.js', 'console.log(formatPrice')).toBe('эффект');
    expect(why('src/main.js', 'console.log(describe')).toBe('эффект');
    expect(why('src/analytics.js', 'globalThis.analyticsQueue')).toBe('эффект');
    expect(why('src/analytics.js', 'queue.push("start")')).toBe('эффект');
    expect(why('src/cart.js', 'function describe')).toBe('ссылка');
    expect(why('src/cart.js', 'function label')).toBe('ссылка');
    expect(why('src/cart.js', 'const cart')).toBe('ссылка');
    expect(why('src/format.js', 'function label')).toBe('ссылка');
    expect(why('src/analytics.js', 'const queue')).toBe('ссылка');
    expect(why('src/format.js', 'function formatDate')).toBe('выброшен');
    expect(why('src/analytics.js', 'function track')).toBe('выброшен');
    // Текст раздела называет выброшенными ровно эти две
    expect(t.SHAKE_STEPS[2]).toContain('`formatDate` и `track`');
  });

  it('раздача имён на четырёх модулях: rolldown x$3…x, esbuild x…x4, bundle() как rolldown', async () => {
    const dir = project(t.COLLIDE_FILES);
    const names = (code: string) => [...code.matchAll(/^function ([\w$]+)\(/gm)].map((m) => m[1]);
    const real = tabs((await rd(dir)).code);
    expect(names(real)).toEqual(t.COLLIDE_ROLLDOWN);
    expect(names((await es(dir)).code)).toEqual(t.COLLIDE_ESBUILD);
    expect(api.bundle(t.COLLIDE_FILES, 'src/main.js').code).toBe(real);
  });
});

describe('литералы стенда совпадают с тем, что пишут сборщики сейчас', () => {
  it('BASE_ESBUILD и BASE_ROLLDOWN', async () => {
    const dir = project(t.APP_FILES);
    expect((await es(dir)).code).toBe(t.BASE_ESBUILD);
    expect(t.BASE_ROLLDOWN).toBe(t.SCENARIOS[0].rolldown);
    // label$1 у format.js (rolldown), label2 у cart.js (esbuild)
    expect(t.BASE_ROLLDOWN).toMatch(/region src\/format\.js\nfunction label\$1\(n\)/);
    expect(t.BASE_ESBUILD).toMatch(/src\/cart\.js\nfunction label2\(text\)/);
  });

  it('//#region пишется только в несжатой сборке', async () => {
    const bundle = await rolldown({ input: join(project(t.APP_FILES), 'src/main.js'), logLevel: 'silent' });
    const { output } = await bundle.generate({ format: 'esm', minify: true });
    expect(output[0].code).not.toContain('#region');
    expect(t.BASE_ROLLDOWN).toContain('//#region src/main.js');
  });

  it('call: rolldown оставил только вызов, esbuild — всю строку', async () => {
    const s = t.SCENARIOS.find((x) => x.id === 'call')!;
    expect(s.rolldown).toContain('\ncreateTheme("dark");\n');
    expect(s.rolldown).not.toContain('theme =');
    expect((await es(project(s.files))).code).toContain('var theme = createTheme("dark");');
  });

  it('pure: вызов и функция исчезли у обоих', async () => {
    const s = t.SCENARIOS.find((x) => x.id === 'pure')!;
    expect(s.rolldown).not.toContain('createTheme');
    expect((await es(project(s.files))).code).not.toContain('createTheme');
  });

  it('pkg: голый импорт выброшен; rolldown молчит, esbuild предупреждает ignored-bare-import', async () => {
    const s = t.SCENARIOS.find((x) => x.id === 'pkg')!;
    const dir = project(s.files);
    const r = await rd(dir);
    const e = await es(dir);
    expect(r.code).not.toContain('analyticsQueue');
    expect(e.code).not.toContain('analyticsQueue');
    expect(r.logs).toEqual([]);
    expect(e.warnings).toContain('ignored-bare-import');
  });

  it('pkgUsed: взят track — вернулись все эффекты модуля', () => {
    const s = t.SCENARIOS.find((x) => x.id === 'pkgUsed')!;
    for (const line of ['const queue = [];', 'globalThis.analyticsQueue = queue;', 'queue.push("start");', 'function track(event)']) {
      expect(s.rolldown).toContain(line);
    }
  });

  it('живая привязка: let count и count++ доходят до бандла как есть', async () => {
    const [counter, main] = t.LIVE_SRC.replace('// counter.js\n', '').split('\n// main.js\n');
    const dir = project({ 'src/counter.js': counter, 'src/main.js': main });
    const r = tabs((await rd(dir)).code);
    expect(r).toContain('let count = 0;');
    expect(r).toContain('  count++;');
    expect(r).toContain('console.log(count);');
  });

  it('подстановка константы: у rolldown currency нет, у esbuild есть', async () => {
    const dir = project(t.INLINE_FILES);
    const r = tabs((await rd(dir)).code);
    const e = (await es(dir)).code;
    expect(r).toContain('function formatPrice(n) {\n  return n + " ₽";\n}');
    expect(r).not.toContain('currency');
    expect(e).toContain('var currency = "₽";');
    expect(t.INLINE_CODE).toContain(t.INLINE_FILES['src/format.js']);
  });
});

describe('PURITY_ROWS: каждая строка собрана обоими сборщиками', () => {
  const variant = (line: string) => ({
    'src/lib.js': t.PURITY_SETUP + line + '\nexport const used = 1;\n',
    'src/main.js': 'import { used } from "./lib.js";\nconsole.log(used);\n',
  });
  let base: { rd: string; es: string } | undefined;
  const both = async (line: string) => {
    const dir = project(variant(line));
    return { rd: (await rd(dir)).code.replace(dir, ''), es: (await es(dir)).code };
  };

  it.each(t.PURITY_ROWS.map((r) => [r.code, r] as const))('%s', async (_code, row) => {
    base ??= await both('');
    const got = await both(row.code);
    const verdict = (a: string, b: string) => (a === b ? 'выбросил' : 'оставил');
    expect(verdict(got.rd, base.rd), 'rolldown').toBe(row.rolldown);
    expect(verdict(got.es, base.es), 'esbuild').toBe(row.esbuild);
  });
});

describe('обёртки: CommonJS и пространство имён', () => {
  it('фрагменты и байты служебного кода', async () => {
    const dir = project({ 'src/main.js': t.WRAP_MAIN, 'src/format.cjs': t.WRAP_FORMAT_CJS, 'src/icons.js': t.WRAP_ICONS });
    const r = (await rd(dir)).code;
    expect(tabs(r)).toBe(t.WRAP_ROLLDOWN);
    for (const line of ['__commonJSMin', '(0, import_format.formatPrice)(430)', '__exportAll({', 'cart: () => cart', 'user: () => user']) {
      expect(r).toContain(line);
    }
    // Обёртка format.cjs стоит в регионе src/icons.js — тонкое место «//#region — подсказка»
    expect(t.WRAP_ROLLDOWN).toMatch(/\/\/#region src\/icons\.js\nvar import_format = /);
    const runtime = r.slice(r.indexOf('\n') + 1, r.indexOf('//#endregion'));
    expect(Buffer.byteLength(runtime)).toBe(t.WRAP_BYTES.rolldownRuntime);
    expect(Buffer.byteLength(r)).toBe(t.WRAP_BYTES.rolldownTotal);

    const e = (await es(dir)).code;
    expect(Buffer.byteLength(e.slice(0, e.indexOf('// src/format.cjs')))).toBe(t.WRAP_BYTES.esbuildHelpers);
    expect(Buffer.byteLength(e)).toBe(t.WRAP_BYTES.esbuildTotal);
    for (const n of Object.values(t.WRAP_BYTES)) expect(t.WRAP_NOTE).toContain(String(n));
  });
});

/** Сборка с чанками: имена файлов, код и строки с заглушками из `renderChunk`. */
async function chunks(files: Record<string, string>, dir: string) {
  project(files, dir);
  const raw: Record<string, { code: string; deps: string[] }> = {};
  const bundle = await rolldown({
    input: join(dir, 'src/main.js'),
    cwd: dir,
    logLevel: 'silent',
    plugins: [
      {
        name: 'peek',
        renderChunk(code, c) {
          raw[c.fileName] = { code, deps: [...c.imports, ...c.dynamicImports] };
        },
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'esm', entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js' });
  const e = await build({
    entryPoints: [join(dir, 'src/main.js')],
    absWorkingDir: dir,
    bundle: true,
    splitting: true,
    format: 'esm',
    write: false,
    outdir: join(dir, 'dist'),
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    charset: 'utf8',
  });
  const nameOf = (f: string) => f.replace(/-[^-]+\.js$/, '').replace(/-!~\{\d+\}~$/, '');
  const stripPh = (f: string) => f.replace(/-!~\{\d+\}~\.js$/, '');
  const input = Object.fromEntries(
    Object.entries(raw).map(([f, v]) => [stripPh(f), { code: v.code, deps: v.deps.map(stripPh) }]),
  );
  return {
    output,
    raw,
    rolldown: Object.fromEntries(output.map((o) => [o.name, o.fileName])),
    esbuild: Object.fromEntries(e.outputFiles.map((o) => {
      const file = o.path.split('/').pop()!;
      return [nameOf(file), file];
    })),
    esbuildFiles: e.outputFiles,
    mini: Object.fromEntries(chunkHashes(input)),
  };
}

describe('чанки и хеши', () => {
  const dir = join(root, 'chunks');

  it('CHUNK_ROLLDOWN, CHUNK_ESBUILD_* и PLACEHOLDER_LINES', async () => {
    const c = await chunks(t.CHUNK_FILES, dir);
    expect(c.output.map((o) => ({ file: o.fileName, code: tabs(o.type === 'chunk' ? o.code : '') }))).toEqual(t.CHUNK_ROLLDOWN);
    expect(c.esbuildFiles.map((o) => o.path.split('/').pop())).toEqual(t.CHUNK_ESBUILD_FILES);
    expect(c.esbuildFiles.find((o) => o.path.includes('/chunk-'))!.text).toBe(t.CHUNK_ESBUILD_SHARED);
    const lines = Object.values(c.raw).flatMap((v) => v.code.split('\n').filter((l) => /import|export/.test(l)));
    expect(lines.join('\n')).toBe(t.PLACEHOLDER_LINES);
    expect(t.PLACEHOLDER_LINES).toContain('!~{001}~');
    // восемь знаков base64url у rolldown, восемь заглавных у esbuild
    for (const f of Object.values(c.rolldown)) expect(f).toMatch(/-[A-Za-z0-9_-]{8}\.js$/);
    for (const f of Object.values(c.esbuild)) expect(f).toMatch(/-[A-Z0-9]{8}\.js$/);
  });

  it('esbuild режет на чанки только в esm', async () => {
    await expect(
      build({ entryPoints: [join(dir, 'src/main.js')], bundle: true, splitting: true, format: 'iife', write: false, outdir: join(dir, 'x'), logLevel: 'silent' }),
    ).rejects.toThrow(t.ESBUILD_IIFE_ERROR);
  });

  it('HASH_EDITS: сменившиеся имена у rolldown, esbuild и учебной chunkHashes', async () => {
    const before = await chunks(t.CHUNK_FILES, dir);
    for (const edit of t.HASH_EDITS) {
      const src = t.CHUNK_FILES[edit.file];
      const changed = edit.find === '' ? edit.replace + src : src.replace(edit.find, edit.replace);
      expect(changed, edit.k).not.toBe(src);
      const after = await chunks({ ...t.CHUNK_FILES, [edit.file]: changed }, dir);
      const diff = (a: Record<string, string>, b: Record<string, string>) =>
        Object.keys(a).filter((k) => a[k] !== b[k]).sort();
      expect(diff(after.rolldown, before.rolldown), `rolldown: ${edit.k}`).toEqual(edit.rolldown);
      expect(diff(after.esbuild, before.esbuild), `esbuild: ${edit.k}`).toEqual(edit.esbuild);
      expect(diff(after.mini, before.mini), `chunkHashes: ${edit.k}`).toEqual(edit.rolldown);
    }
    // вернуть исходники на место для соседних проверок
    project(t.CHUNK_FILES, dir);
  });
});
