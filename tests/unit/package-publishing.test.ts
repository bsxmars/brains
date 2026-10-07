import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkPackage, createPackageFromTarballData } from '@arethetypeswrong/core';
import { publint } from 'publint';
import ts from 'typescript';
import { defaultClientConditions } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/package-publishing/data';
import { loadResolver } from '@/widgets/exports-lab/model/run';

/**
 * Тема «Публикация npm-пакета: exports, ESM и CJS, типы».
 *
 * Фикстуры (`FIXTURES`) пишутся на диск, и всё, что тема утверждает о них, спрашивается
 * заново: Node 24 (`import.meta.resolve`, `require.resolve`, настоящий `import()`),
 * TypeScript (`resolveModuleName`, трассировка, диагностика), publint и attw, `npm pack
 * --dry-run --json`. `RESOLVE_CODE` — строка из темы, та же, что исполняет демо, —
 * сверяется с Node на каждом спецификаторе в четырёх режимах. Ничего не публикуется.
 */

const R = loadResolver(t.RESOLVE_CODE);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'package-publishing-')));
const app = join(root, 'app');
const nm = join(app, 'node_modules');

function writePackage(dir: string, pkg: object, files: Record<string, string>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
}

const node = (args: string[], cwd = app) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8' });

/** Скрипт, который резолвит список спецификаторов и печатает JSON «спецификатор → путь или код». */
function probeScript(specs: string[], esm: boolean): string {
  const how = esm ? 'import.meta.resolve(s)' : 'require.resolve(s)';
  return `const o = {};
for (const s of ${JSON.stringify(specs)}) {
  try { o[s] = ${how}.replace(/^.*node_modules\\//, ''); } catch (e) { o[s] = e.code; }
}
console.log(JSON.stringify(o));`;
}

function askNode(dir: string, specs: string[], mode: (typeof t.NODE_MODES)[number]): Record<string, string> {
  const esm = mode.id.startsWith('import');
  const file = join(dir, esm ? 'probe.mjs' : 'probe.cjs');
  writeFileSync(file, probeScript(specs, esm));
  return JSON.parse(node([...mode.flags, file], dir));
}

const ALL_SPECS = Object.values(t.SPECS).flat();
let live: Record<string, string[]> = {};

beforeAll(() => {
  for (const [name, { pkg, files }] of Object.entries(t.FIXTURES)) writePackage(join(nm, name), pkg, files);
  writeFileSync(join(app, 'package.json'), '{ "name": "app", "private": true }\n');
  const byMode = t.NODE_MODES.map((m) => askNode(app, ALL_SPECS, m));
  live = Object.fromEntries(ALL_SPECS.map((s) => [s, byMode.map((r) => r[s])]));
}, 60_000);

describe('Node 24 на фикстурах — как в NODE_TABLE', () => {
  it('каждый спецификатор в четырёх режимах', () => {
    expect(Object.keys(t.NODE_TABLE).sort()).toEqual([...ALL_SPECS].sort());
    for (const s of ALL_SPECS) expect(live[s], s).toEqual(t.NODE_TABLE[s]);
  });

  it('import.meta.resolve не проверяет файл, а настоящий import() падает ERR_MODULE_NOT_FOUND', () => {
    expect(t.NODE_TABLE['price-kit/plugins/card.js'][0]).toBe('price-kit/dist/plugins/card.js.js');
    const out = node(['--input-type=module', '-e', `for (const s of ['price-kit/plugins/card.js', 'price-kit/plugins/missing', 'gap-kit']) await import(s).catch((e) => console.log(e.code));`]);
    expect(out.trim().split('\n')).toEqual(['ERR_MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND']);
    expect(t.NODE_NOTE).toContain('`card.js.js`');
  });

  it('notype-kit (ESM-синтаксис без type) грузится и через import, и через require', () => {
    const out = node(['--input-type=module', '-e', `import { createRequire } from 'node:module'; const m = await import('notype-kit'); console.log(m.file, createRequire(process.cwd() + '/x.js')('notype-kit').file);`]);
    expect(out.trim()).toBe('index.js index.js');
  });
});

describe('RESOLVE_CODE против Node', () => {
  it('на всех спецификаторах и во всех режимах ответ совпадает', () => {
    let checked = 0;
    for (const [fixture, specs] of Object.entries(t.SPECS)) {
      const { pkg, files } = t.FIXTURES[fixture];
      if (!pkg.exports) continue;
      for (const spec of specs) {
        t.NODE_MODES.forEach((mode, i) => {
          const [name, subpath] = R.splitSpecifier(spec);
          expect(name).toBe(pkg.name);
          const r = R.resolveExports(pkg.exports!, subpath, [...mode.conditions]);
          const want = t.NODE_TABLE[spec][i];
          if (want === 'MODULE_NOT_FOUND') {
            // require.resolve проверяет файл: резолвер дал путь, но файла в пакете нет.
            expect(r.error, `${spec} ${mode.id}`).toBeNull();
            expect(files[r.file!.slice(2)], `${spec} ${mode.id}`).toBeUndefined();
          } else {
            expect(r.error ?? `${name}/${r.file!.slice(2)}`, `${spec} ${mode.id}`).toBe(want);
          }
          checked++;
        });
      }
    }
    expect(checked).toBeGreaterThan(120);
  });

  it('шаблон: побеждает самый длинный префикс, а не порядок ключей', () => {
    const map = { './plugins/*': './a/*.js', './plugins/internal/*': null };
    const reversed = { './plugins/internal/*': null, './plugins/*': './a/*.js' };
    expect(R.resolveExports(map, './plugins/internal/x', ['import']).error).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(R.resolveExports(reversed, './plugins/internal/x', ['import']).error).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(R.splitSpecifier('@scope/pkg/a/b')).toEqual(['@scope/pkg', './a/b']);
    expect(R.splitSpecifier('@scope/pkg')).toEqual(['@scope/pkg', '.']);
  });

  it('пресеты демо — это фикстуры стенда, а среды Node в демо — наборы NODE_MODES', () => {
    for (const p of t.PRESETS) {
      expect(p.exports).toEqual(t.FIXTURES[p.id].pkg.exports);
      expect(p.specifiers).toEqual(t.SPECS[p.id]);
    }
    expect(t.ENVS.find((e) => e.id === 'node-import')!.conditions).toEqual([...t.NODE_MODES[0].conditions]);
    expect(t.ENVS.find((e) => e.id === 'node-require')!.conditions).toEqual([...t.NODE_MODES[1].conditions]);
    // Набор Vite в демо — из её собственных констант.
    expect(defaultClientConditions).toEqual(['module', 'browser', 'development|production']);
    const vite = t.ENVS.find((e) => e.id === 'vite')!.conditions;
    expect(vite).toEqual(expect.arrayContaining(['module', 'browser', 'development', 'import']));
  });

  it('order-kit: default первым — один файл везде', () => {
    for (const env of t.ENVS) {
      expect(R.resolveExports(t.FIXTURES['order-kit'].pkg.exports!, '.', env.conditions).file).toBe('./dist/index.js');
    }
  });
});

describe('TypeScript 6.0.3', () => {
  const MODES: [ts.CompilerOptions, ts.ResolutionMode][] = [
    [{ module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 }, ts.ModuleKind.ESNext],
    [{ module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16 }, ts.ModuleKind.CommonJS],
    [{ module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }, undefined],
  ];

  function traceOf(spec: string, opts: ts.CompilerOptions, mode: ts.ResolutionMode) {
    const lines: string[] = [];
    const host = { ...ts.sys, trace: (s: string) => lines.push(s.replace(/\/[^']*node_modules\//g, '')) };
    const r = ts.resolveModuleName(spec, join(app, 'index.ts'), { ...opts, traceResolution: true }, host, undefined, undefined, mode);
    return { lines, file: r.resolvedModule ? r.resolvedModule.resolvedFileName.replace(/^.*node_modules\//, '') : null };
  }

  it('resolveModuleName — как в TS_TABLE', () => {
    expect(ts.version).toBe('6.0.3');
    for (const name of Object.keys(t.FIXTURES)) {
      expect(MODES.map(([o, m]) => traceOf(name, o, m).file), name).toEqual(t.TS_TABLE[name]);
    }
  });

  it('условия TypeScript и трассировка types-last', () => {
    MODES.forEach(([o, m], i) => {
      expect(traceOf('dual-kit', o, m).lines).toContain(t.TS_CONDITIONS[i].v);
    });
    const trace = traceOf('types-last', MODES[0][0], MODES[0][1]).lines;
    for (const line of t.TYPES_LAST_TRACE.split('\n')) expect(trace, line).toContain(line);
    // TypeScript возвращается из условия, Node — нет.
    expect(t.TS_TABLE['gap-kit'][0]).toBe('gap-kit/index.d.ts');
    expect(t.NODE_TABLE['gap-kit'][0]).toBe('gap-kit/missing.js');
  });

  it('TS1479 на require ESM-пакета: node16 и node18 — да, node20 и nodenext — нет', () => {
    writeFileSync(join(app, 'use.cts'), "import { file } from 'esm-only';\nexport const f = file;\n");
    const codes = (module: ts.ModuleKind, moduleResolution: ts.ModuleResolutionKind) => {
      const program = ts.createProgram([join(app, 'use.cts')], { module, moduleResolution, noEmit: true, strict: true, types: [] });
      return ts.getPreEmitDiagnostics(program).map((d) => d.code);
    };
    const MR = ts.ModuleResolutionKind;
    expect(codes(ts.ModuleKind.Node16, MR.Node16)).toContain(1479);
    expect(codes(ts.ModuleKind.Node18, MR.Node16)).toContain(1479);
    expect(codes(ts.ModuleKind.Node20, MR.Node16)).not.toContain(1479);
    expect(codes(ts.ModuleKind.NodeNext, MR.NodeNext)).not.toContain(1479);
    expect(t.TS_REQUIRE_NOTE).toContain('TS1479');
  });
});

describe('publint 0.3.25 и attw 0.18.5', () => {
  it('сообщения по каждой фикстуре — как в LINT_TABLE', async () => {
    const tgz = join(root, 'tgz');
    mkdirSync(tgz, { recursive: true });
    for (const name of Object.keys(t.FIXTURES)) {
      const dir = join(nm, name);
      const pl = await publint({ pkgDir: dir, pack: 'npm' });
      const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', tgz], { cwd: dir, encoding: 'utf8' }));
      const res = await checkPackage(createPackageFromTarballData(new Uint8Array(readFileSync(join(tgz, packed[0].filename)))));
      const attw = res.types === false ? null : [...new Set(res.problems.map((p) => p.kind + ('resolutionKind' in p ? `:${p.resolutionKind}` : '')))];
      expect({ publint: pl.messages.map((m) => `${m.type}:${m.code}`), attw }, name).toEqual(t.LINT_TABLE[name]);
    }
  }, 120_000);

  it('таблица маскарада согласована с LINT_TABLE', () => {
    expect(t.LINT_TABLE['mask-cjs'].attw).toContain('FalseCJS');
    expect(t.LINT_TABLE['mask-esm'].attw).toContain('FalseESM');
    // Маскарад price-kit видит только attw.
    expect(t.LINT_TABLE['price-kit'].attw).toContain('FalseESM');
    expect(t.LINT_TABLE['price-kit'].publint.join()).not.toContain('TYPES');
    expect(t.LINT_TABLE['gap-kit'].publint).toContain('error:FILE_DOES_NOT_EXIST');
    expect(t.LINT_TABLE['mixed-kit'].publint).toEqual([]);
    expect(t.LINT_TABLE['order-kit'].publint).toEqual(expect.arrayContaining(['error:EXPORTS_DEFAULT_SHOULD_BE_LAST', 'error:EXPORTS_TYPES_SHOULD_BE_FIRST']));
    expect(t.LINT_TABLE['dual-kit'].attw).toEqual(['NoResolution:node10']);
  });
});

describe('рантайм: двойной пакет и require(esm)', () => {
  it('HAZARD_CODE печатает HAZARD_OUT', () => {
    writeFileSync(join(app, 'hazard.mjs'), t.HAZARD_CODE);
    expect(node([join(app, 'hazard.mjs')]).trim()).toBe(t.HAZARD_OUT);
  });

  it('REQUIRE_ESM_CODE печатает REQUIRE_ESM_OUT', () => {
    writeFileSync(join(app, 'check.cjs'), t.REQUIRE_ESM_CODE);
    expect(node([join(app, 'check.cjs')]).trim()).toBe(t.REQUIRE_ESM_OUT);
  });

  it('REQUIRE_DEFAULT_CODE: default — обёрткой, "module.exports" — как есть', () => {
    const [def, whole] = t.REQUIRE_DEFAULT_CODE.split('\n\n');
    writeFileSync(join(app, 'def.mjs'), def);
    writeFileSync(join(app, 'whole.mjs'), whole);
    const out = node(['-e', "const a = require('./def.mjs'); const b = require('./whole.mjs'); console.log(Object.keys(a).join(), a.__esModule, typeof a.default, typeof b, b(5));"]);
    expect(out.trim()).toBe('__esModule,default true function function 5 ₽');
  });
});

describe('тарбол: npm pack --dry-run --json', () => {
  it('четыре раскладки — как в PACK_CASES, publint замечает пропавший dist', async () => {
    for (const c of t.PACK_CASES) {
      const dir = join(root, 'pack', c.id);
      rmSync(dir, { recursive: true, force: true });
      const pkg = { name: 'kit', version: '1.0.0', type: 'module', exports: './dist/index.js', ...(c.files ? { files: c.files } : {}) };
      writePackage(dir, pkg, { ...t.PACK_PROJECT, ...(c.gitignore ? { '.gitignore': c.gitignore } : {}), ...(c.npmignore ? { '.npmignore': c.npmignore } : {}) });
      const out = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: dir, encoding: 'utf8' }));
      expect(out[0].files.map((f: { path: string }) => f.path).sort(), c.id).toEqual([...c.got].sort());
      if (c.id === 'a' || c.id === 'c') {
        const codes = (await publint({ pkgDir: dir, pack: 'npm' })).messages.map((m) => m.code);
        expect(codes).toContain('USE_FILES');
        expect(codes.includes('FILE_NOT_PUBLISHED'), c.id).toBe(c.id === 'c');
      }
    }
  }, 60_000);
});

describe('что ломает версию', () => {
  it('Node до и после каждой правки — как в BREAK_CASES; резолвер темы согласен', () => {
    t.BREAK_CASES.forEach((c, i) => {
      const mode = t.NODE_MODES.find((m) => m.id === c.mode)!;
      const got = [c.v1, c.v2].map((pkg, v) => {
        const dir = join(root, 'break', `${i}-${v}`);
        writePackage(join(dir, 'node_modules', 'semver-kit'), pkg, c.files);
        writeFileSync(join(dir, 'package.json'), '{ "private": true }\n');
        const res = askNode(dir, [c.spec], mode)[c.spec];
        if (pkg.exports) {
          const r = R.resolveExports(pkg.exports, R.splitSpecifier(c.spec)[1], [...mode.conditions]);
          expect(r.error ?? `semver-kit/${r.file!.slice(2)}`, c.change).toBe(res);
        }
        return res;
      });
      expect(got, c.change).toEqual([c.before, c.after]);
    });
  }, 60_000);
});
