import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { __unstable__loadDesignSystem, compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import tailwindPostcss from '@tailwindcss/postcss';
import vue from '@vitejs/plugin-vue';
import browserslist from 'browserslist';
import { browserslistToTargets, transform } from 'lightningcss';
import postcss, { type AcceptedPlugin, type ChildNode, type Root } from 'postcss';
import { build, createServer, type Rollup } from 'vite';
import { compileStyle } from 'vue/compiler-sfc';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/css-tooling/data';
import { loadModuleNamer, loadScanner } from '@/widgets/css-tooling-lab/model/run';

/**
 * Тема «CSS-инструменты: PostCSS, CSS-модули и Tailwind».
 *
 * Литералы стенда пересобираются теми же вызовами, что в шапке `data.ts`: PostCSS, lightningcss,
 * Vite 8 с `@vitejs/plugin-vue`, Tailwind 4.3.3. Учебные функции — строки из темы, которые
 * исполняет демо: `MODULE_NAME_CODE` сверяется с именами Vite посимвольно (на фикстурах и на
 * правках файла), `TW_SCAN_CODE` — с oxide по набору утилит, которые из кандидатов получаются.
 *
 * Не пересобирается только Chromium (`LAYER_PROBE` и цвет в `ORDER_*`): здесь проверяется
 * порядок правил в CSS сборки и то, что утилиты лежат в слое, — вывод «кто победил» из этого
 * следует по каскаду.
 */

const LESSON = realpathSync(process.cwd());
const namer = loadModuleNamer(t.MODULE_NAME_CODE);
const scan = loadScanner(t.TW_SCAN_CODE);

/** Каталог стенда во временной папке; `node_modules` — ссылкой на проект, как на стенде. */
function stand(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'css-tooling-')));
  symlinkSync(join(LESSON, 'node_modules'), join(dir, 'node_modules'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

/**
 * Сборка в режиме продакшена. vitest выставляет `NODE_ENV=test`, а Vite его не перезаписывает:
 * без этой обёртки `@vitejs/plugin-vue` считает сборку не продакшеном и ставит id от пути,
 * как на dev-сервере. На стенде (`node`) `NODE_ENV` не задан, и `vite build` ставит `production`.
 */
async function prodBuild(config: Parameters<typeof build>[0]): Promise<Rollup.RollupOutput> {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return (await build(config)) as Rollup.RollupOutput;
  } finally {
    process.env.NODE_ENV = prev;
  }
}

const cssOf = (out: Rollup.RollupOutput) =>
  out.output.filter((o): o is Rollup.OutputAsset => o.type === 'asset' && o.fileName.endsWith('.css')).map((o) => String(o.source));
/** Ключ без дефиса печатается без кавычек, с дефисом — в кавычках. */
const hasExport = (js: string, k: string, v: string) => js.includes(`${k}: "${v}"`) || js.includes(`"${k}": "${v}"`);
const jsOf = (out: Rollup.RollupOutput) =>
  out.output.filter((o): o is Rollup.OutputChunk => o.type === 'chunk').map((o) => o.code).join('\n');

// ─── PostCSS ───────────────────────────────────────────────────────────────────────────────

describe('PostCSS: дерево и плагины', () => {
  it('POSTCSS_TREE — это postcss.parse(BUTTON_CSS)', () => {
    const rows: typeof t.POSTCSS_TREE = [];
    const walk = (n: Root | ChildNode, depth: number) => {
      const text =
        n.type === 'atrule' ? `@${n.name} ${n.params}` : n.type === 'rule' ? n.selector : n.type === 'decl' ? `${n.prop}: ${n.value}` : '';
      rows.push({ depth, type: n.type, text, pos: `${n.source?.start?.line}:${n.source?.start?.column}` });
      if ('nodes' in n && n.nodes) for (const c of n.nodes) walk(c, depth + 1);
    };
    walk(postcss.parse(t.BUTTON_CSS, { from: 'button.css' }), 0);
    expect(rows).toEqual(t.POSTCSS_TREE);
    expect(t.POSTCSS_TREE_PRINT.split('\n')).toHaveLength(10);
  });

  it('нетронутое дерево печатается байт в байт', () => {
    expect(postcss.parse(t.BUTTON_CSS).toString()).toBe(t.BUTTON_CSS);
  });

  it('PREFIX_PLUGIN_CODE: вывод, один вызов посетителя, 7 заходов на 6 деклараций', async () => {
    const plugin = new Function(`${t.PREFIX_PLUGIN_CODE}\nreturn prefixUserSelect;`)() as () => { Declaration: Record<string, (d: unknown) => void> };
    let own = 0;
    const counted = () => {
      const p = plugin();
      const inner = p.Declaration['user-select'];
      return { ...p, Declaration: { 'user-select': (d: unknown) => (own++, inner(d)) } };
    };
    (counted as unknown as { postcss: boolean }).postcss = true;
    let all = 0;
    const counter = Object.assign(() => ({ postcssPlugin: 'count', Declaration: () => void all++ }), { postcss: true as const });

    const r = await postcss([counted as unknown as AcceptedPlugin, counter]).process(t.BUTTON_CSS, { from: 'button.css' });
    expect(r.css).toContain(t.PREFIX_OUT);
    expect(r.css.split('\n').slice(5, 8).join('\n') + '\n').toBe(t.PREFIX_OUT);
    expect(r.css).toBe(t.BUTTON_CSS.replace('    user-select', '    -webkit-user-select: none;\n    user-select'));
    expect(own).toBe(1);
    expect(all).toBe(7);
    expect(t.POSTCSS_FACTS[1].d).toContain('7 заходов на 6 исходных деклараций');
  });

  it('NAIVE_PLUGIN_CODE зацикливается: счётчик останавливает его на 51-м заходе', async () => {
    let n = 0;
    const visitor = new Function(`return ({ ${t.NAIVE_PLUGIN_CODE} }).Declaration;`)() as (d: unknown) => void;
    const naive = Object.assign(
      () => ({
        postcssPlugin: 'naive',
        Declaration(d: unknown) {
          if (++n > 50) throw new Error(`loop ${n}`);
          visitor(d);
        },
      }),
      { postcss: true as const },
    );
    await expect(postcss([naive]).process(t.BUTTON_CSS, { from: 'x' }).async()).rejects.toThrow('loop 51');
    expect(t.NAIVE_NOTE).toContain('51-м');
  });
});

// ─── lightningcss ──────────────────────────────────────────────────────────────────────────

describe('lightningcss: понижение под три цели', () => {
  it('вывод, байты и ноль предупреждений — как в LOWER_TARGETS', () => {
    for (const target of t.LOWER_TARGETS) {
      const r = transform({ filename: 'button.css', code: Buffer.from(t.BUTTON_CSS), targets: browserslistToTargets(browserslist(target.query)) });
      expect(r.code.toString(), target.id).toBe(target.out);
      expect(r.code.length, target.id).toBe(target.bytes);
      expect(r.warnings, target.id).toEqual([]);
    }
  });

  it('утверждения таблицы LOWER_ROWS видны в выводе', () => {
    const [old, vite, fresh] = t.LOWER_TARGETS.map((x) => x.out);
    expect(old).toContain('.button:hover');
    expect(vite).toContain('.button:hover');
    expect(fresh).toContain('&:hover');
    expect(old).toContain('background: #1d84f5;');
    expect(vite).toContain('oklch(43.4% .19 255)');
    for (const out of [old, vite, fresh]) {
      expect(out).toContain('color-mix(in oklch, var(--brand) 85%, white)');
      expect(out).toContain('@layer components {');
      expect(out).toContain('-webkit-user-select: none;');
    }
  });

  it('старая цель младше поддержки @layer — данные caniuse из LOWER_FACTS', () => {
    // У caniuse-lite нет типов: берём через require и описываем только то, что читаем.
    const { feature, features } = createRequire(import.meta.url)('caniuse-lite') as {
      feature: (packed: unknown) => { stats: Record<string, Record<string, string>> };
      features: Record<string, unknown>;
    };
    const first = (f: string, b: string) => {
      const stats = feature(features[f]).stats[b];
      return Object.entries(stats)
        .map(([v, s]) => [parseFloat(v), s] as const)
        .filter(([v, s]) => !Number.isNaN(v) && String(s).startsWith('y'))
        .sort((a, b) => a[0] - b[0])[0][0];
    };
    expect([first('css-cascade-layers', 'chrome'), first('css-cascade-layers', 'safari'), first('css-cascade-layers', 'firefox')]).toEqual([99, 15.4, 97]);
    expect(t.LOWER_FACTS[1].d).toContain('Chrome 99, Safari 15.4 и Firefox 97');
    expect(t.LOWER_TARGETS[0].query).toBe('chrome 90, safari 14, firefox 88');
  });
});

// ─── Vite: CSS-модули, scoped, понижение, порядок ──────────────────────────────────────────

let appDir: string;
let appOut: Rollup.RollupOutput;
let appOutMin: Rollup.RollupOutput;

beforeAll(async () => {
  appDir = stand({
    'index.html': '<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>',
    'src/components/Button.module.css': t.MODULE_CSS,
    'src/card/Card.module.css': t.CARD_MODULE_CSS,
    'src/copy/Button.module.css': t.MODULE_CSS,
    'src/components/Button.vue': t.SCOPED_VUE,
    'src/components/Card.vue': t.CARD_VUE,
    'src/main.js': [
      "import btn from './components/Button.module.css';",
      "import card from './card/Card.module.css';",
      "import copy from './copy/Button.module.css';",
      "import Card from './components/Card.vue';",
      'console.log(JSON.stringify({ btn, card, copy }), Card);',
    ].join('\n'),
    'src/ssr.js': [
      "import { createSSRApp } from 'vue';",
      "import { renderToString } from 'vue/server-renderer';",
      "import Card from './components/Card.vue';",
      'export const render = () => renderToString(createSSRApp(Card));',
    ].join('\n'),
  });
  const common = { root: appDir, configFile: false as const, logLevel: 'silent' as const, plugins: [vue()] };
  appOut = await prodBuild({ ...common, build: { write: false, minify: false } });
  appOutMin = await prodBuild({ ...common, build: { write: false, minify: true } });
}, 60_000);

describe('CSS-модули в Vite 8', () => {
  it('экспорт модулей в сборке — MODULE_EXPORTS', () => {
    const js = jsOf(appOut);
    for (const names of Object.values(t.MODULE_EXPORTS)) {
      for (const [k, v] of Object.entries(names)) expect(hasExport(js, k, v), `${k}: ${v}`).toBe(true);
    }
  });

  it('CSS сборки для Button.module.css — MODULE_CSS_OUT, глобальное .dark не переименовано', () => {
    const css = cssOf(appOut).join('\n');
    expect(css).toContain(t.MODULE_CSS_OUT);
    expect(css).toContain('.dark ._primary_1dyov_6');
    expect(css).not.toContain('composes');
  });

  it('копия файла дублируется без сжатия и остаётся одна со сжатием', () => {
    const count = (s: string) => s.split('._button_1dyov_1').length - 1;
    expect(count(cssOf(appOut).join(''))).toBe(2);
    expect(count(cssOf(appOutMin).join(''))).toBe(1);
  });

  it('учебный moduleExports совпадает с Vite на всех трёх файлах', () => {
    const texts: Record<string, string> = {
      'src/components/Button.module.css': t.MODULE_CSS,
      'src/card/Card.module.css': t.CARD_MODULE_CSS,
      'src/copy/Button.module.css': t.MODULE_CSS,
    };
    for (const [path, css] of Object.entries(texts)) expect(namer.moduleExports(css), path).toEqual(t.MODULE_EXPORTS[path]);
    for (const f of t.MODULE_DEMO_FILES) expect(namer.moduleExports(f.css)).toEqual(t.MODULE_EXPORTS[f.path]);
  });

  it('scopedName совпадает с Vite на правках файла: пробел, новая строка, другой класс, CRLF', async () => {
    const variants = [
      t.MODULE_CSS.replace('6px', '8px'),
      '\n' + t.MODULE_CSS,
      t.MODULE_CSS + '\n.ghost {\n  opacity: 0.5;\n}\n',
      t.MODULE_CSS.replaceAll('\n', '\r\n'),
      t.CARD_MODULE_CSS.replace('.button', '.button-icon {\n  width: 16px;\n}\n\n.button'),
    ];
    const files: Record<string, string> = { 'index.html': '<!doctype html><script type="module" src="/main.js"></script>' };
    variants.forEach((css, i) => (files[`v${i}.module.css`] = css));
    files['main.js'] = variants.map((_, i) => `import v${i} from './v${i}.module.css';`).join('\n') + `\nconsole.log(JSON.stringify([${variants.map((_, i) => `v${i}`).join(',')}]));`;
    const dir = stand(files);
    const out = (await build({ root: dir, configFile: false, logLevel: 'silent', build: { write: false, minify: false } })) as Rollup.RollupOutput;
    const js = jsOf(out);
    variants.forEach((css, i) => {
      for (const [k, v] of Object.entries(namer.moduleExports(css))) expect(hasExport(js, k, v), `v${i}.${k} = ${v}`).toBe(true);
    });
    // Правка одного значения меняет хеш всего файла; CRLF удваивает счёт строк.
    expect(namer.scopedName('button', variants[0])).not.toBe('_button_1dyov_1');
    expect(namer.scopedName('primary', variants[3])).toMatch(/_11$/);
  }, 60_000);

  it('шаги разбора: хеш файла, base36, строки', () => {
    const h = namer.stringHash(t.MODULE_CSS);
    expect(h).toBe(3021109791);
    expect(h.toString(36)).toBe('1dyov8f');
    expect(t.MODULE_STEPS[0].d).toContain('3 021 109 791');
    expect(t.MODULE_STEPS[0].d).toContain('`1dyov8f`');
  });

  it('lightningcss-модули: хеш от пути, копия получает другое имя', () => {
    const a = transform({ filename: 'src/components/Button.module.css', code: Buffer.from(t.MODULE_CSS), cssModules: true });
    const b = transform({ filename: 'src/copy/Button.module.css', code: Buffer.from(t.MODULE_CSS), cssModules: true });
    expect(a.exports?.button.name).toBe('S36ykG_button');
    expect(b.exports?.button.name).toBe('kOwm9q_button');
    expect(t.MODULE_FACTS[3].d).toContain('`S36ykG_button`');
    expect(t.MODULE_FACTS[3].d).toContain('`kOwm9q_button`');
  });
});

describe('Vue scoped', () => {
  it('CSS сборки — SCOPED_CSS_OUT, id по формуле SCOPE_ID_CODE', () => {
    expect(cssOf(appOut).join('\n')).toContain(t.SCOPED_CSS_OUT);
    const scopeId = new Function('createHash', `${t.SCOPE_ID_CODE.split('\n\nscopeId(')[0]}\nreturn scopeId;`)(createHash) as (
      p: string,
      s: string,
      prod: boolean,
    ) => string;
    expect(scopeId('src/components/Button.vue', t.SCOPED_VUE, true)).toBe('6d1c2ff8');
    expect(scopeId('src/components/Button.vue', t.SCOPED_VUE, false)).toBe('3c9d0845');
    expect(scopeId('src/components/Card.vue', t.CARD_VUE, true)).toBe('91edec25');
    expect(t.SCOPE_ID_CODE).toContain("'6d1c2ff8'");
    expect(t.SCOPE_ID_CODE).toContain("'3c9d0845'");
  });

  it('dev-сервер ставит id только от пути', async () => {
    const server = await createServer({
      root: appDir,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue()],
      server: { middlewareMode: true, hmr: false, ws: false },
    });
    try {
      const r = await server.transformRequest('/src/components/Button.vue');
      expect(r?.code).toContain('data-v-3c9d0845');
    } finally {
      await server.close();
    }
  });

  it('SCOPED_RULES — то, что делает compileStyle', () => {
    for (const row of t.SCOPED_RULES) {
      const r = compileStyle({ source: `${row.k} { color: red; }`, filename: 'Button.vue', id: 'data-v-6d1c2ff8', scoped: true });
      expect(r.errors).toEqual([]);
      expect(r.code.split('{')[0].trim(), row.k).toBe(row.out);
    }
  });

  it('SSR вложенного рендера: корень Button несёт оба атрибута', async () => {
    const out = await prodBuild({
      root: appDir,
      configFile: false,
      logLevel: 'silent',
      plugins: [vue()],
      build: { ssr: 'src/ssr.js', write: false },
    });
    const entry = out.output.find((o): o is Rollup.OutputChunk => o.type === 'chunk' && o.isEntry)!;
    const file = join(appDir, 'ssr-out.mjs');
    writeFileSync(file, entry.code);
    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { render: () => Promise<string> };
    const html = (await mod.render()).replaceAll('<!--[-->', '').replaceAll('<!--]-->', '');
    expect(html).toBe(t.SCOPED_HTML.replace(/\n\s*/g, ''));
  }, 60_000);
});

describe('Vite и понижение CSS', () => {
  let dir: string;
  beforeAll(() => {
    dir = stand({
      'index.html': '<!doctype html><script type="module" src="/src/main.js"></script>',
      'src/button.css': t.BUTTON_CSS,
      'src/main.js': "import './button.css';",
    });
  });
  const cssBuild = async (minify: boolean) =>
    cssOf((await build({ root: dir, configFile: false, logLevel: 'silent', build: { write: false, minify } })) as Rollup.RollupOutput).join('');

  it('сборка с минификацией понижает, без неё — нет', async () => {
    const min = await cssBuild(true);
    expect(min).toContain('.button:hover{');
    expect(min).toContain('-webkit-user-select:none');
    expect(min).toContain('oklch(43.4% .19 255)');
    const raw = await cssBuild(false);
    expect(raw).toContain('&:hover {');
    expect(raw).not.toContain('-webkit-user-select');
  }, 60_000);

  it('dev-сервер отдаёт как написано; с transformer lightningcss — понижает', async () => {
    for (const [transformer, lowered] of [[undefined, false], ['lightningcss', true]] as const) {
      const server = await createServer({
        root: dir,
        configFile: false,
        logLevel: 'silent',
        css: transformer ? { transformer } : {},
        server: { middlewareMode: true, hmr: false, ws: false },
      });
      try {
        const r = await server.transformRequest('/src/button.css?direct');
        expect(r?.code.includes('&:hover'), String(transformer)).toBe(!lowered);
        expect(r?.code.includes('-webkit-user-select'), String(transformer)).toBe(lowered);
      } finally {
        await server.close();
      }
    }
  }, 60_000);

  it('цель Vite 8 по умолчанию — та, что в LOWER_TARGETS и VITE_LOWER_NOTE', async () => {
    const src = readFileSync(join(LESSON, 'node_modules/vite/dist/node/chunks/node.js'), 'utf8');
    const m = /ESBUILD_BASELINE_WIDELY_AVAILABLE_TARGET = \[([^\]]+)\]/.exec(src);
    const list = m![1].match(/"([^"]+)"/g)!.map((s) => s.slice(1, -1));
    expect(list).toEqual(['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4']);
    for (const x of list) expect(t.VITE_LOWER_NOTE).toContain(`\`${x}\``);
  });
});

describe('порядок CSS модулей в сборке', () => {
  it('CSS идёт в порядке импортов; ленивый чанк — своим файлом через __vitePreload', async () => {
    const dir = stand({
      'a.html': '<!doctype html><html><head></head><body><script type="module" src="/src/a.js"></script></body></html>',
      'b.html': '<!doctype html><html><head></head><body><script type="module" src="/src/b.js"></script></body></html>',
      'src/base.module.css': '.button {\n  color: black;\n}\n',
      'src/danger.module.css': '.text {\n  color: red;\n}\n',
      'src/lazy.module.css': '.panel {\n  color: green;\n}\n',
      'src/lazy.js': "import s from './lazy.module.css';\nexport const panel = s.panel;\n",
      'src/a.js': "import danger from './danger.module.css';\nimport base from './base.module.css';\ndocument.body.className = `${base.button} ${danger.text}`;\nimport('./lazy.js');\n",
      'src/b.js': "import base from './base.module.css';\nimport danger from './danger.module.css';\ndocument.body.className = `${base.button} ${danger.text}`;\n",
    });
    const run = async (e: string) =>
      (await build({ root: dir, configFile: false, logLevel: 'silent', build: { write: false, minify: false, rollupOptions: { input: join(dir, `${e}.html`) } } })) as Rollup.RollupOutput;
    const a = await run('a');
    const b = await run('b');
    const main = (o: Rollup.RollupOutput, e: string) => String((o.output.find((x) => x.fileName.startsWith(`assets/${e}-`) && x.fileName.endsWith('.css')) as Rollup.OutputAsset).source);
    const order = (css: string) => [css.indexOf('._text_xlfbh_1'), css.indexOf('._button_1kgoy_1')];
    const [ta, ba] = order(main(a, 'a'));
    const [tb, bb] = order(main(b, 'b'));
    expect(ta).toBeLessThan(ba);
    expect(bb).toBeLessThan(tb);
    expect(t.ORDER_A_CODE).toContain('сначала ._text_xlfbh_1, потом ._button_1kgoy_1');
    expect(t.ORDER_B_CODE).toContain('сначала ._button_1kgoy_1, потом ._text_xlfbh_1');

    expect(cssOf(a).some((c) => c.includes('._panel_1sbzj_1'))).toBe(true);
    expect(main(a, 'a')).not.toContain('_panel_');
    expect(jsOf(a)).toMatch(/__vitePreload\(\(\) => import\("\.\/lazy-[\w-]+\.js"\)/);
    expect(jsOf(a)).toMatch(/"assets\/lazy-[\w-]+\.js","assets\/lazy-[\w-]+\.css"/);
    const html = String((a.output.find((x) => x.fileName === 'a.html') as Rollup.OutputAsset).source);
    expect(html).toMatch(/<head>[\s\S]*<link rel="stylesheet" crossorigin href="\/assets\/a-[\w-]+\.css">[\s\S]*<\/head>/);
  }, 60_000);
});

// ─── Tailwind ──────────────────────────────────────────────────────────────────────────────

const oxide = new Scanner({});
const oxideCandidates = (text: string, ext: string) => [...new Set(oxide.getCandidatesWithPositions({ content: text, extension: ext }).map((c) => c.candidate))];
const twCompile = () => compile('@import "tailwindcss" source(none);', { base: LESSON, onDependency() {} });

/** Содержимое `@layer utilities { … }` без отступа слоя — так записаны `TW_RULES`. */
function utilities(css: string): string {
  const i = css.indexOf('@layer utilities {');
  if (i < 0) return '';
  let depth = 0;
  let j = i;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) break;
  }
  return css
    .slice(css.indexOf('{', i) + 2, j)
    .replace(/^ {2}/gm, '')
    .trimEnd();
}

/** Набор селекторов-утилит, которые реально написал Tailwind. */
async function generated(candidates: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const c of candidates) if (utilities((await twCompile()).build([c]))) out.push(c);
  return out.sort();
}

describe('Tailwind 4.3.3: сканер и утилиты', () => {
  it('TW_RULES — это вывод Tailwind для каждого кандидата', async () => {
    for (const [c, rule] of Object.entries(t.TW_RULES)) expect(utilities((await twCompile()).build([c])), c).toBe(rule);
  });

  it('на каждом файле учебный сканер даёт тот же набор утилит, что oxide', async () => {
    for (const f of t.TW_FILES) {
      const ext = f.name.split('.').pop()!;
      const real = await generated(oxideCandidates(f.text, ext));
      const mini = await generated([...new Set(scan(f.text).map((c) => c.candidate))]);
      expect(mini, f.name).toEqual(real);
      // И демо право: утилита — ровно те кандидаты, что есть в TW_RULES.
      expect([...new Set(scan(f.text).map((c) => c.candidate))].filter((c) => c in t.TW_RULES).sort(), f.name).toEqual(real);
    }
  });

  it('позиции кандидатов учебного сканера указывают на сам кандидат', () => {
    for (const f of t.TW_FILES) for (const c of scan(f.text)) expect(f.text.slice(c.start, c.start + c.candidate.length)).toBe(c.candidate);
  });

  it('байты: по одному файлу, все сразу, пустой вывод', async () => {
    for (const f of t.TW_FILES) {
      const css = (await twCompile()).build(oxideCandidates(f.text, f.name.split('.').pop()!));
      expect(Buffer.byteLength(css), f.name).toBe(f.bytes);
    }
    expect(Buffer.byteLength((await twCompile()).build([]))).toBe(t.TW_EMPTY_BYTES);

    const dir = stand(Object.fromEntries(t.TW_FILES.map((f) => [f.name, f.text])));
    const r = await postcss([tailwindPostcss({ base: dir })]).process('@import "tailwindcss" source("./src");\n', { from: join(dir, 'app.css') });
    expect(Buffer.byteLength(r.css)).toBe(t.TW_ALL_BYTES);
    expect(t.TW_INPUT_CSS).toContain('@import "tailwindcss" source("./src");');
  }, 60_000);

  it('факты сканирования: склейка, комментарий, проза, запятая, bg-blue', async () => {
    const badge = t.TW_FILES.find((f) => f.id === 'badge')!.text;
    expect(oxideCandidates(badge, 'tsx')).toHaveLength(14);
    expect(oxideCandidates("const cls = 'bg-' + color + '-500';", 'js')).toEqual(['const', 'cls', 'color']);
    expect(oxideCandidates(t.DYNAMIC_BAD_CODE, 'js').filter((c) => c.startsWith('bg-'))).toEqual([]);
    expect(scan(t.DYNAMIC_BAD_CODE).filter((c) => c.candidate.startsWith('bg-'))).toEqual([]);
    expect(await generated(oxideCandidates(t.DYNAMIC_OK_CODE, 'js'))).toEqual(['bg-green-500', 'bg-red-500']);

    const notes = t.TW_FILES.find((f) => f.id === 'notes')!.text;
    expect(await generated(oxideCandidates(notes, 'js'))).toEqual(['block', 'shadow-lg', 'table']);
    for (const s of ['// TODO: вернуть shadow-lg, когда дизайнер согласует']) {
      expect(oxideCandidates(s, 'js')).not.toContain('shadow-lg');
      expect(scan(s).map((c) => c.candidate)).not.toContain('shadow-lg');
    }
    expect(await generated(['bg-blue', 'export', 'button'])).toEqual([]);
  });

  it('расхождения учебного сканера с oxide — только перечисленные в SCAN_DIFF', () => {
    const same = [
      '<div class="md:hover:bg-red-500/50 [&>p]:mt-2 w-[calc(100%-2rem)] -mt-4 !font-bold bg-(--brand)">',
      'bg-[#ff0] text-[14px] grid-cols-[1fr_2fr] bg-[url(/a.png)]',
      'w-1/2 px-2.5 size-[10px] text-red-500!',
      'p-4;mt-2 (p-4) x shadow-lg. P-4 Bg-red-500 4p 44 -4 p- -p a--b a__b :hover',
    ];
    for (const s of same) expect(scan(s).map((c) => c.candidate).sort(), s).toEqual(oxideCandidates(s, 'html').sort());
    expect(oxideCandidates('a hover: b', 'html')).toContain('hover');
    expect(scan('a hover: b').map((c) => c.candidate)).not.toContain('hover');
    expect(t.SCAN_DIFF).toContain('`hover`');
  });

  it('@source inline генерирует перечисленные классы без единого файла', async () => {
    const css = SOURCE_INLINE_CSS();
    const c = await compile(css, { base: LESSON, onDependency() {} });
    const u = utilities(c.build([]));
    for (const color of ['red', 'green', 'blue']) expect(u).toContain(`.bg-${color}-500 {`);
  });

  it('утилиты лежат в @layer utilities, порядок слоёв — как в TW_LAYERS_CODE', async () => {
    const css = (await twCompile()).build(['p-4']);
    expect(css).toContain('@layer theme, base, components, utilities;');
    expect(utilities(css)).toContain('.p-4 {');
    expect(t.TW_LAYERS_CODE).toContain('@layer theme, base, components, utilities;');
    // Тема — только используемые переменные.
    expect(css).toContain('--spacing: 0.25rem;');
    expect(css).not.toContain('--color-red-500');
    expect(t.LAYER_PROBE.map((r) => r.padding)).toEqual(['0px', '0px', '16px']);
  });

  it('байты от набора классов — TW_MARGINAL_ROWS', async () => {
    const empty = Buffer.byteLength((await twCompile()).build([]));
    for (const row of t.TW_MARGINAL_ROWS) {
      expect(Buffer.byteLength((await twCompile()).build(row.k.split(' '))) - empty, row.k).toBe(row.bytes);
    }
    expect(t.TW_MARGINAL_ROWS.find((r) => r.k === 'shadow-lg shadow-md')!.d).toContain('290 байт');
  });

  it('байты от числа классов — TW_BYTES_ROWS (каждый k-й из полного списка)', async () => {
    const ds = await __unstable__loadDesignSystem(readFileSync(join(LESSON, 'node_modules/tailwindcss/index.css'), 'utf8'), { base: LESSON });
    const list = ds.getClassList().map(([n]) => n);
    expect(list).toHaveLength(t.TW_CLASS_COUNT);
    for (const row of t.TW_BYTES_ROWS) {
      const step = Math.floor(list.length / Math.max(row.n, 1));
      const pick = row.n ? Array.from({ length: row.n }, (_, i) => list[i * step]) : [];
      expect(Buffer.byteLength((await twCompile()).build(pick)), String(row.n)).toBe(row.bytes);
    }
    expect(t.BYTES_NOTE).toContain('253 КБ');
  }, 60_000);
});

/** `SOURCE_INLINE_CODE` без комментария и с `source(none)`, чтобы не сканировать каталог. */
function SOURCE_INLINE_CSS(): string {
  return t.SOURCE_INLINE_CODE.split('\n')
    .filter((l) => !l.startsWith('/*'))
    .join('\n')
    .replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
}
