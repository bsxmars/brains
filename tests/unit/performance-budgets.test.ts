import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import * as acorn from 'acorn';
import { init, parse } from 'es-module-lexer';
import { build as esbuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { STAND_PAGES } from '@/content/frameworks/islands/data';
import * as t from '@/content/tooling/performance-budgets/data';
import { loadCi, loadGraph, loadManifest } from '@/widgets/budget-lab/model/run';
import type { Graph } from '@/widgets/budget-lab/model/types';

/**
 * Тема «Бюджеты производительности».
 *
 * `GRAPH_CODE`, `MANIFEST_CODE` и `CI_CODE` — строки из темы: напечатаны на странице
 * и исполняются демо. Здесь они сверяются:
 *   — разбор импортов — с `es-module-lexer` и `acorn` на каждом чанке `dist/_astro`;
 *   — замыкание — с логикой `tests/e2e/weight.spec.ts` на каждой собранной странице;
 *   — адаптеры манифеста — с настоящими `vite build` и `esbuild` на фикстуре темы;
 *   — отчёт CI — на двух настоящих сборках сайта (база из темы «Острова»).
 *
 * Числа сайта сняты с одной сборки. Снимок демо (`BUDGET_CHUNKS`, входы страниц, CSS, шрифты,
 * HTML «Source maps») сверяется всегда — с копией её файлов в `tests/fixtures/performance-budgets/`.
 * Числа, которым нужна вся сборка (число страниц у чанка, пороги «сейчас», медианы, воркер),
 * сверяются с `dist/`, только если это та же сборка (отпечаток `DIST_FINGERPRINT`), иначе
 * пропускаются с пометкой. Логика проверяется на любом `dist/`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');
const ASTRO = join(DIST, '_astro');
const HAS_DIST = existsSync(ASTRO);

const g = loadGraph(t.GRAPH_CODE);
const m = loadManifest(t.MANIFEST_CODE);
const ci = loadCi(t.CI_CODE);

const chunks = t.BUDGET_CHUNKS as unknown as Graph;
const pageOf = (route: string) => t.BUDGET_PAGES.find((p) => p.route === route)!;
const raw = (f: string) => t.BUDGET_CHUNKS[f].bytes;
const gzip = (f: string) => t.BUDGET_CHUNKS[f].gzip;
const closure = (route: string, dyn = false) => g.pageChunks(chunks, pageOf(route).entries, dyn);

// ─── Сайт с диска ──────────────────────────────────────────────────────────────────────────

const jsFiles = HAS_DIST ? readdirSync(ASTRO).filter((f) => f.endsWith('.js')).sort() : [];
const fingerprint = createHash('sha256').update(jsFiles.join('\n')).digest('hex').slice(0, 16);
const SAME_BUILD = HAS_DIST && fingerprint === t.DIST_FINGERPRINT;
const sources: Record<string, string> = Object.fromEntries(jsFiles.map((f) => [f, readFileSync(join(ASTRO, f), 'utf8')]));

/** Все `index.html` сборки → адрес страницы. */
function builtPages(): string[] {
  const out: string[] = [];
  const walkDir = (dir: string, route: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== '_astro') walkDir(join(dir, e.name), `${route}${e.name}/`);
      else if (e.name === 'index.html') out.push(route);
    }
  };
  if (HAS_DIST) walkDir(DIST, '/');
  return out.sort();
}
const PAGES = builtPages();
const htmlOf = (route: string) => readFileSync(join(DIST, `.${route}index.html`), 'utf8');
/** Входы страницы — тем же шаблоном, что weight.spec, и только существующие файлы. */
const entriesOf = (route: string) =>
  [...new Set([...htmlOf(route).matchAll(/\/_astro\/([^"'&]+?\.js)/g)].map((x) => x[1]))].filter((f) => f in sources);

// ─── Копия логики weight.spec ─────────────────────────────────────────────────────────────
// Дословно `staticImports` и `pageChunks` из tests/e2e/weight.spec.ts, только чтение — из
// `sources`. Импортировать спеку нельзя: она объявляет тесты Playwright при загрузке.
// Что копия не разошлась с оригиналом, сторожит проверка «weight.spec — тот же текст».
function specStaticImports(file: string): string[] {
  const source = sources[file];
  return [...source.matchAll(/(?:import|export)\s*(?:[\w*{}\s,$]*?from\s*)?["']\.\/([^"']+\.js)["']/g)].map((x) => x[1]);
}
function specPageChunks(page: string): string[] {
  const source = htmlOf(page);
  const queue = [...new Set([...source.matchAll(/\/_astro\/([^"'&]+?\.js)/g)].map((x) => x[1]))];
  const seen = new Set<string>();
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !(file in sources)) continue;
    seen.add(file);
    queue.push(...specStaticImports(file));
  }
  return [...seen];
}

// ─── Независимые разборщики ───────────────────────────────────────────────────────────────

const rel = (n: string | undefined) => (n?.startsWith('./') ? n.slice(2) : null);

function lexerImports(code: string) {
  const [imps] = parse(code);
  const pick = (type: number) => [...new Set(imps.filter((i) => i.t === type).map((i) => rel(i.n)).filter((x): x is string => !!x))].sort();
  return { imports: pick(1), dynamic: pick(2) };
}

function acornImports(code: string) {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const st = new Set<string>();
  const dy = new Set<string>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const n = node as { type?: string; source?: { type: string; value?: unknown; expressions?: unknown[]; quasis?: { value: { cooked: string } }[] } };
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) {
      const r = rel(String(n.source.value));
      if (r) st.add(r);
    }
    if (n.type === 'ImportExpression' && n.source) {
      const s = n.source;
      const value = s.type === 'Literal' ? String(s.value) : s.type === 'TemplateLiteral' && !s.expressions?.length ? s.quasis![0].value.cooked : undefined;
      const r = rel(value);
      if (r) dy.add(r);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') visit(v);
  };
  visit(ast);
  return { imports: [...st].sort(), dynamic: [...dy].sort() };
}

const sorted = (x: { imports: string[]; dynamic: string[] }) => ({ imports: [...x.imports].sort(), dynamic: [...x.dynamic].sort() });

beforeAll(async () => {
  await init;
});

// ─── Разбор импортов ──────────────────────────────────────────────────────────────────────

describe('parseImports против es-module-lexer и acorn', () => {
  it('пример темы: регулярка берёт fake.js из строки, лексер и acorn — нет', () => {
    const ours = g.parseImports(t.PARSE_SAMPLE);
    expect(ours).toEqual({ imports: ['x.js', 'y.js', 'z.js', 'w.js', 'v.js', 'fake.js'], dynamic: ['chart.js'] });
    const truth = { imports: ['v.js', 'w.js', 'x.js', 'y.js', 'z.js'], dynamic: ['chart.js'] };
    expect(lexerImports(t.PARSE_SAMPLE)).toEqual(truth);
    expect(acornImports(t.PARSE_SAMPLE)).toEqual(truth);
    // То, что напечатано под примером, — тот же результат.
    expect(t.PARSE_RESULT).toContain("imports: ['x.js', 'y.js', 'z.js', 'w.js', 'v.js', 'fake.js']");
    expect(t.PARSE_RESULT).toContain("dynamic: ['chart.js']");
  });

  it.skipIf(!HAS_DIST)(HAS_DIST ? `все ${jsFiles.length} чанков dist/_astro: совпадает с обоими` : 'чанки dist/ — ПРОПУЩЕНО: dist/ нет', () => {
    expect(jsFiles.length).toBeGreaterThan(50);
    for (const f of jsFiles) {
      const ours = sorted(g.parseImports(sources[f]));
      expect(ours, `${f}: es-module-lexer`).toEqual(lexerImports(sources[f]));
      expect(ours, `${f}: acorn`).toEqual(acornImports(sources[f]));
    }
  });
});

// ─── Замыкание против weight.spec ─────────────────────────────────────────────────────────

describe('замыкание темы = замыкание weight.spec', () => {
  it('weight.spec — тот же текст, что напечатан в теме, и те же пороги', () => {
    const spec = readFileSync(join(ROOT, 'tests/e2e/weight.spec.ts'), 'utf8');
    expect(spec).toContain(t.WEIGHT_SPEC_EXCERPT);
    expect(spec).toContain(t.WEIGHT_SPEC_WALK);
    // Шаблон статического импорта в GRAPH_CODE — символ в символ как в weight.spec.
    const re = /\/\(\?:import\|export\)[^\n]*?\.js\)\["'\]\/g/.exec(t.WEIGHT_SPEC_EXCERPT)![0];
    expect(t.GRAPH_CODE).toContain(`const STATIC_RE = ${re};`);

    for (const tier of t.WEIGHT_TIERS) {
      expect(spec, tier.name).toContain(`const ${tier.name} = ${tier.kb};`);
    }
    // Порог каждой страницы демо — тот, что weight.spec выдаёт этой странице.
    const sets = [...spec.matchAll(/const (\w+)_PAGES = new Set\(\[([^\]]*)\]\)/g)].map((x) => ({ name: `${x[1]}_BUDGET_KB`, list: x[2] }));
    for (const p of t.BUDGET_PAGES) {
      const set = sets.find((s) => s.list.includes(`'${p.route}'`));
      expect(p.budgetName, p.route).toBe(set?.name ?? 'LEAN_BUDGET_KB');
      expect(p.budgetKb, p.route).toBe(t.WEIGHT_TIERS.find((x) => x.name === p.budgetName)!.kb);
    }
  });

  it.skipIf(!HAS_DIST)(HAS_DIST ? `все ${PAGES.length} страниц сборки: те же файлы и те же байты` : 'страницы dist/ — ПРОПУЩЕНО: dist/ нет', () => {
    const graph = g.buildGraph(sources);
    let withJs = 0;
    for (const page of PAGES) {
      const spec = specPageChunks(page).sort();
      const ours = g.pageChunks(graph, entriesOf(page)).sort();
      expect(ours, page).toEqual(spec);
      const bytes = (l: string[]) => l.reduce((s, f) => s + Buffer.byteLength(sources[f]), 0);
      expect(g.weigh(ours, (f) => Buffer.byteLength(sources[f])), page).toBe(bytes(spec));
      if (ours.length) withJs++;
    }
    expect(withJs).toBeGreaterThan(100);
  });
});

// ─── Снимок: самосогласованность (без dist/) ──────────────────────────────────────────────

describe('снимок BUDGET_CHUNKS и числа в тексте', () => {
  it('Chromium скачал ровно замыкание, которое считают функции темы', () => {
    for (const tr of t.CHROMIUM_TRACE) {
      const st = closure(tr.route);
      expect(st.length, tr.route).toBe(tr.files);
      expect(g.weigh(st, raw), tr.route).toBe(tr.bytes);
      expect(tr.atLoad).toBe(0);
      if (tr.afterClick) {
        const all = closure(tr.route, true);
        expect(all.filter((f) => !st.includes(f)).sort()).toEqual([...tr.afterClick].sort());
      }
    }
  });

  it('числа «Source maps», SSR и «React против Vue»', () => {
    const sm = closure('/tooling/source-maps/');
    const vue = ['runtime-core.esm-bundler.CIbLXjQd.js', 'runtime-dom.esm-bundler.B73O2axo.js', 'client.CCGqtgYw.js'];
    expect(g.weigh(sm, raw)).toBe(124249);
    expect(g.weigh(vue, raw)).toBe(110853);
    expect(124249 - 110853).toBe(13396);
    for (const f of vue) expect(t.BUDGET_CHUNKS[f].pages).toBe(140);
    expect(pageOf('/tooling/source-maps/').note).toContain('13 396');

    expect(g.weigh(sm, gzip)).toBe(49292);
    const row = t.RESOURCE_ROWS.find((r) => r.k === 'JS')!;
    expect([row.files, row.raw, row.gzip]).toEqual(['9', '124 249', '49 292']);

    const ssr = closure('/frameworks/ssr-hydration/');
    const ssrAll = closure('/frameworks/ssr-hydration/', true);
    expect([ssr.length, g.weigh(ssr, raw)]).toEqual([11, 130993]);
    expect([ssrAll.length, g.weigh(ssrAll, raw)]).toEqual([14, 350234]);
    expect(t.CRITICAL_NOTE).toContain('130 993');
    expect(t.CRITICAL_NOTE).toContain('219 241');

    const rv = closure('/frameworks/react-vs-vue/');
    expect(g.weigh(rv, raw)).toBe(354054);
    expect(g.weigh(rv, gzip)).toBe(122322);
    expect((354054 / 124249).toFixed(2)).toBe('2.85');
    expect((122322 / 49292).toFixed(2)).toBe('2.48');
    // «React DOM жмётся лучше рантайма Vue»
    const ratio = (f: string) => gzip(f) / raw(f);
    expect(ratio('client.CXQRFzvJ.js')).toBeLessThan(ratio('runtime-core.esm-bundler.CIbLXjQd.js'));

    // Лид раздела «Какие байты»: 0, 48, 121 или 467 КБ (КБ = 1024 байта).
    const num = (x: string) => Number(x.replace(/\s/g, ''));
    const all = t.RESOURCE_ROWS.reduce((s, r) => s + num(r.raw), 0);
    expect([0, 49292, 124249, all].map((b) => Math.round(b / 1024))).toEqual([0, 48, 121, 467]);

    const labs = closure('/kit/labs/');
    expect(Math.round(g.weigh(labs, raw) / 1024)).toBe(355);
    expect(Math.round(g.weigh(closure('/js/event-loop/'), raw) / 1024)).toBe(175);
  });

  it('WHY_ROWS: цепочка верна по рёбрам и короче не бывает', () => {
    for (const w of t.WHY_ROWS) {
      const entries = pageOf(w.page).entries;
      const chain = g.whyIncluded(chunks, entries, w.target, !!w.dynamic);
      expect(chain, w.target).toEqual(w.chain);
      expect(entries).toContain(chain![0]);
      for (let i = 1; i < chain!.length; i++) {
        const from = t.BUDGET_CHUNKS[chain![i - 1]];
        expect([...from.imports, ...(w.dynamic ? from.dynamic : [])]).toContain(chain![i]);
      }
      // Независимо: расстояние до target волной по уровням.
      let level = new Set(entries);
      const seen = new Set(entries);
      let dist = 0;
      while (!level.has(w.target)) {
        const next = new Set<string>();
        for (const f of level) for (const d of [...t.BUDGET_CHUNKS[f].imports, ...(w.dynamic ? t.BUDGET_CHUNKS[f].dynamic : [])]) if (!seen.has(d)) { seen.add(d); next.add(d); }
        level = next;
        dist++;
      }
      expect(chain!.length - 1, w.target).toBe(dist);
    }
    // Без import() React DOM на SSR-странице не нужен вовсе.
    expect(g.whyIncluded(chunks, pageOf('/frameworks/ssr-hydration/').entries, 'client.CXQRFzvJ.js')).toBeNull();
    // «у ui.DIEeBnsz.js на «Цикле событий» пять импортёров»
    const el = closure('/js/event-loop/');
    expect(el.filter((f) => t.BUDGET_CHUNKS[f].imports.includes('ui.DIEeBnsz.js'))).toHaveLength(5);
    expect(t.WHY_NOTE).toContain('пять импортёров');
  });
});

// ─── Снимок против dist/ той же сборки ────────────────────────────────────────────────────

describe('снимок совпадает с фикстурой dist/ (всегда)', () => {
  // Копия файлов сборки 2026-10-02 16:15 в tests/fixtures/performance-budgets/dist/ — ровно то,
  // на чём сняты числа темы: HTML пяти страниц демо, их 53 чанка, BaseLayout.css и 7 шрифтов,
  // которые Chromium скачал для «Source maps». Пересборка сайта меняет хеши и размеры в dist/,
  // фикстуру — нет, поэтому эти проверки идут всегда.
  const FX = join(ROOT, 'tests/fixtures/performance-budgets/dist');
  const fxFile = (rel: string) => readFileSync(join(FX, rel));
  const fxText = (rel: string) => fxFile(rel).toString('utf8');
  const fxSources: Record<string, string> = Object.fromEntries(Object.keys(t.BUDGET_CHUNKS).map((f) => [f, fxText(`_astro/${f}`)]));
  const fxEntries = (route: string) =>
    [...new Set([...fxText(`.${route}index.html`).matchAll(/\/_astro\/([^"'&]+?\.js)/g)].map((x) => x[1]))].filter((f) => f in fxSources);

  it('чанки: байты, gzip, brotli, импорты; входы пяти страниц и их замыкания', () => {
    const graph = g.buildGraph(fxSources);
    for (const [f, c] of Object.entries(t.BUDGET_CHUNKS)) {
      const b = Buffer.from(fxSources[f]);
      expect(b.length, f).toBe(c.bytes);
      expect(zlib.gzipSync(b).length, f).toBe(c.gzip);
      expect(zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length, f).toBe(c.br);
      expect({ imports: graph[f].imports, dynamic: graph[f].dynamic }, f).toEqual({ imports: c.imports, dynamic: c.dynamic });
      // И независимым разборщиком — на тех же байтах.
      expect(sorted(graph[f]), f).toEqual(lexerImports(fxSources[f]));
    }
    for (const p of t.BUDGET_PAGES) {
      expect(fxEntries(p.route), p.route).toEqual(p.entries);
      // Замыкание по снимку = замыкание по файлам фикстуры, а оно — то, что видел бы weight.spec.
      expect(g.pageChunks(graph, p.entries, true).sort(), p.route).toEqual(g.pageChunks(chunks, p.entries, true).sort());
    }
  });

  it('CSS, шрифты и HTML «Source maps» — строки RESOURCE_ROWS', () => {
    const css = fxText('_astro/BaseLayout.EQ_Golna.css');
    expect(Buffer.byteLength(css)).toBe(64312);
    expect(zlib.gzipSync(css).length).toBe(19948);
    const inline = [...css.matchAll(/@font-face\{[^}]*url\((data:[^)]*)\)[^}]*\}/g)];
    expect(inline).toHaveLength(2);
    expect(inline.reduce((s, x) => s + x[1].length, 0)).toBe(10766);
    for (const x of inline) expect(x[0]).toMatch(/IBM Plex Mono[\s\S]*U\+1EA0-1EF9/);

    const html = fxFile('tooling/source-maps/index.html');
    expect([html.length, zlib.gzipSync(html).length]).toEqual([111045, 23582]);
    // Встроенные скрипты Astro: 5 905 байт.
    const inlineJs = [...html.toString('utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    expect(inlineJs.reduce((s, x) => s + Buffer.byteLength(x[1]), 0)).toBe(5905);
    expect(html.toString('utf8')).toContain('href="/_astro/BaseLayout.EQ_Golna.css"');

    const fonts = readdirSync(join(FX, '_astro')).filter((f) => f.endsWith('.woff2'));
    expect(fonts).toHaveLength(7);
    const bytes = fonts.reduce((s, f) => s + fxFile(`_astro/${f}`).length, 0);
    const gz = fonts.reduce((s, f) => s + zlib.gzipSync(fxFile(`_astro/${f}`)).length, 0);
    expect([bytes, gz]).toEqual([178604, 178661]);
    const row = (k: string) => t.RESOURCE_ROWS.find((r) => r.k === k)!;
    expect([row('шрифты').files, row('шрифты').raw, row('шрифты').gzip]).toEqual(['7', '178 604', '178 661']);
    expect([row('CSS').raw, row('CSS').gzip]).toEqual(['64 312', '19 948']);
    expect([row('HTML').raw, row('HTML').gzip]).toEqual(['111 045', '23 582']);
  });
});

describe('числа по всему сайту — только на той же сборке dist/', () => {
  // Эти числа требуют всей сборки (152 страницы, 313 чанков, 25 МБ HTML) — в фикстуру не влезают.
  const label = (what: string) => (SAME_BUILD ? what : `${what} — ПРОПУЩЕНО: в dist/ ${HAS_DIST ? 'другая сборка' : 'ничего нет'}`);

  it.skipIf(!SAME_BUILD)(label('число страниц у каждого чанка'), () => {
    const graph = g.buildGraph(sources);
    const used: Record<string, number> = {};
    for (const p of PAGES) for (const f of g.pageChunks(graph, entriesOf(p))) used[f] = (used[f] ?? 0) + 1;
    for (const [f, c] of Object.entries(t.BUDGET_CHUNKS)) expect(used[f] ?? 0, f).toBe(c.pages);
  });

  it.skipIf(!SAME_BUILD)(label('пороги «сейчас», медианы сжатия, import( и воркер'), () => {
    const graph = g.buildGraph(sources);
    const size = (f: string) => Buffer.byteLength(sources[f]);
    const kb = (p: string) => Math.round(g.weigh(g.pageChunks(graph, entriesOf(p)), size) / 1024);
    const now: Record<string, number> = {
      '/js/callbacks/': 174, '/js/object-model/': 201, '/js/event-loop/': 175, '/kit/': 133,
      '/kit/labs/': 355, '/frameworks/react-rerender/': 234, '/frameworks/react-vs-vue/': 346,
    };
    for (const [p, v] of Object.entries(now)) expect(kb(p), p).toBe(v);
    const spec = readFileSync(join(ROOT, 'tests/e2e/weight.spec.ts'), 'utf8');
    const named = [...spec.matchAll(/const \w+_PAGES = new Set\(\[([^\]]*)\]\)/g)].flatMap((x) => [...x[1].matchAll(/'([^']+)'/g)].map((y) => y[1]));
    const lean = PAGES.filter((p) => !named.includes(p)).map(kb);
    expect(Math.max(...lean)).toBe(174);

    // Медианы сжатия по страницам со скриптами: 40% gzip, 36% brotli.
    // Каждый файл жмётся один раз: страницы делят чанки, а Brotli 11 небыстрый.
    const memo = (fn: (f: string) => number) => {
      const cache = new Map<string, number>();
      return (f: string) => cache.get(f) ?? (cache.set(f, fn(f)), cache.get(f)!);
    };
    const gz = memo((f) => zlib.gzipSync(sources[f]).length);
    const br = memo((f) => zlib.brotliCompressSync(sources[f], { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length);
    const ratios = { gz: [] as number[], br: [] as number[] };
    for (const p of PAGES) {
      const l = g.pageChunks(graph, entriesOf(p));
      if (!l.length) continue;
      const r = g.weigh(l, size);
      ratios.gz.push(g.weigh(l, gz) / r);
      ratios.br.push(g.weigh(l, br) / r);
    }
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
    expect(ratios.gz).toHaveLength(141);
    expect(Math.round(med(ratios.gz) * 100)).toBe(40);
    expect(Math.round(med(ratios.br) * 100)).toBe(36);

    // `import(` подстрокой — в семи чанках, настоящий import() с адресом — в трёх.
    expect(jsFiles.filter((f) => sources[f].includes('import('))).toHaveLength(7);
    expect(jsFiles.filter((f) => lexerImports(sources[f]).dynamic.length)).toHaveLength(3);
    // Воркер не входит в замыкание ни одной страницы.
    const worker = 'worker-vzrt-GLW.js';
    expect(Buffer.byteLength(sources[worker])).toBe(9894);
    expect(PAGES.some((p) => g.pageChunks(graph, entriesOf(p), true).includes(worker))).toBe(false);
  }, 60_000);

  it.skipIf(!SAME_BUILD)(label('все шрифты сборки: 19 файлов woff2'), () => {
    const woff = readdirSync(ASTRO).filter((f) => f.endsWith('.woff2'));
    expect(woff).toHaveLength(19);
    expect(woff.reduce((s, f) => s + readFileSync(join(ASTRO, f)).length, 0)).toBe(606732);
  });
});

// ─── Манифест Vite и metafile esbuild ─────────────────────────────────────────────────────

describe('MANIFEST_CODE против настоящих сборщиков', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'perf-budgets-')));
  const read = (p: string) => readFileSync(join(dir, p), 'utf8');

  beforeAll(async () => {
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/main.js'), t.FX_MAIN);
    writeFileSync(join(dir, 'src/format.js'), t.FX_FORMAT);
    writeFileSync(join(dir, 'src/chart.js'), t.FX_CHART);
    writeFileSync(join(dir, 'index.html'), t.FX_HTML);
    await viteBuild({ root: dir, configFile: false, logLevel: 'silent', build: { manifest: true, outDir: 'dist-vite', emptyOutDir: true } });
  }, 60_000);

  it('Vite: манифест как напечатан, и его граф = граф из текстов чанков', () => {
    const manifest = JSON.parse(read('dist-vite/.vite/manifest.json'));
    expect(JSON.stringify(manifest, null, 2)).toBe(t.VITE_MANIFEST_PRINT);
    const fromManifest = m.fromViteManifest(manifest);
    const files = Object.fromEntries(Object.keys(fromManifest).map((f) => [basename(f), read(`dist-vite/${f}`)]));
    const parsed = g.buildGraph(files);
    for (const [f, node] of Object.entries(fromManifest)) {
      expect({ imports: node.imports.map((x) => basename(x)), dynamic: node.dynamic.map((x) => basename(x)) }, f).toEqual(parsed[basename(f)]);
    }
  });

  it('esbuild: fromMetafile как напечатан, и он же = граф из текстов', async () => {
    const r = await esbuild({
      absWorkingDir: dir, entryPoints: ['src/main.js'], bundle: true, splitting: true, format: 'esm', minify: true,
      outdir: 'dist-esb', metafile: true, write: true, entryNames: '[name]', chunkNames: 'chunk-[hash]', logLevel: 'silent',
    });
    const graph = m.fromMetafile(r.metafile);
    expect(graph).toEqual(JSON.parse(t.ESBUILD_GRAPH_PRINT));
    const files = Object.fromEntries(Object.keys(graph).map((f) => [basename(f), read(f)]));
    const parsed = g.buildGraph(files);
    for (const [f, node] of Object.entries(graph)) {
      expect({ imports: node.imports.map((x) => basename(x)), dynamic: node.dynamic.map((x) => basename(x)) }, f).toEqual(parsed[basename(f)]);
    }
    // «esbuild вынес общий format.js в отдельный чанк на 39 байт»
    expect(read('dist-esb/chunk-YUQMC27Y.js').length).toBe(39);
  });
});

// ─── Отчёт CI ─────────────────────────────────────────────────────────────────────────────

describe('CI_CODE на двух настоящих сборках сайта', () => {
  const headOf = (route: string, extra: string[] = []) =>
    Object.fromEntries(g.pageChunks(chunks, [...pageOf(route).entries, ...extra]).map((f) => [f, raw(f)]));

  it('базы — те же, что в теме «Острова»', () => {
    const bytesOf = (key: string) => Object.fromEntries(Object.entries(STAND_PAGES.find((p) => p.key === key)!.graph).map(([f, v]) => [f, v.bytes]));
    expect(t.CI_BASE_EVENT_LOOP).toEqual(bytesOf('event-loop'));
    expect(t.CI_BASE_REACT_VS_VUE).toEqual(bytesOf('react-vs-vue'));
  });

  it('«Цикл событий»: по полному имени двенадцать строк, по имени без хеша — одна', () => {
    const head = headOf('/js/event-loop/');
    const base = t.CI_BASE_EVENT_LOOP;
    const naive = [...Object.keys(base).filter((f) => !(f in head)), ...Object.keys(head).filter((f) => !(f in base))];
    expect(naive).toHaveLength(12);
    // Пять из шести переименованных — того же размера.
    const renamed = Object.keys(base).filter((f) => !(f in head));
    const sameSize = renamed.filter((f) => Object.entries(head).some(([h, b]) => ci.stripHash(h) === ci.stripHash(f) && b === base[f]));
    expect([renamed.length, sameSize.length]).toEqual([6, 5]);

    const r = ci.checkBudget({ base, head, budget: 230 * 1024, tolerance: 0 });
    expect(ci.report('/js/event-loop/', r)).toBe(t.CI_REPORT_EVENT_LOOP);
    expect(t.BUDGET_CHUNKS['Md.BKOm_4qz.js'].pages).toBe(135);
  });

  it('«React против Vue»: три client.*.js складываются в одну группу', () => {
    const head = headOf('/frameworks/react-vs-vue/');
    expect(Object.keys(head).filter((f) => ci.stripHash(f) === 'client.js')).toHaveLength(3);
    const r = ci.checkBudget({ base: t.CI_BASE_REACT_VS_VUE, head, budget: 400 * 1024, tolerance: 0 });
    expect(ci.report('/frameworks/react-vs-vue/', r)).toBe(t.CI_REPORT_REACT_VS_VUE);
  });

  it('утечка рендерера React в обычную тему: красный отчёт, React DOM — в строке client.js', () => {
    const base = headOf('/tooling/source-maps/');
    const head = headOf('/tooling/source-maps/', ['client.vyypPQp4.js']);
    const r = ci.checkBudget({ base, head, budget: 190 * 1024, tolerance: 100 });
    expect(r.over).toBe(true);
    expect(ci.report('/tooling/source-maps/', r)).toBe(t.CI_REPORT_LEAK);
    expect(t.CI_LEAK_NOTE).toContain('207 465');
    expect(raw('client.CXQRFzvJ.js')).toBe(207465);
  });
});
