import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/islands/data';
import { htmlRefBytes, loadPlan, planPage } from '@/widgets/islands-lab/model/run';
import type { PlanStep, StandPage, TraceStep } from '@/widgets/islands-lab/model/types';

/**
 * Тема «Острова и resumability».
 *
 * `PLAN_CODE`, `REVIVE_CODE`, `LATE_CODE` и `RESUME_CODE` — строки из темы: напечатаны на
 * странице, первую ещё и исполняет демо. Здесь они сверяются:
 *   — `planLoads` — с тем, что Chromium запросил при прокрутке собранных страниц сайта
 *     (литералы стенда `STAND_PAGES`, `DIRECTIVE_STAND`, см. шапку `data.ts`);
 *   — восстановление пропсов — с настоящими `serializeProps` и восстановителем из
 *     `astro/dist/runtime/server/astro-island.js` той версии Astro, что стоит в проекте;
 *   — исходник директивы `visible` и размеры встроенных скриптов — с файлами пакета.
 * Сборка `dist/` тесту не нужна. Если она есть — последний блок проверяет её инварианты.
 */

const require = createRequire(import.meta.url);
const ASTRO = dirname(require.resolve('astro/package.json'));
const astroFile = (p: string) => readFileSync(join(ASTRO, 'dist', p), 'utf8');

const plan = loadPlan(t.PLAN_CODE);
const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Шаги расчёта в форме записи стенда: только шаги с запросами, списки отсортированы. */
function asTrace(steps: PlanStep[]): TraceStep[] {
  return steps
    .filter((s) => s.y === 0 || s.files.length)
    .map((s) => ({ y: s.y, islands: [...s.islands].sort(), files: [...s.files].sort() }));
}
const sortTrace = (trace: TraceStep[]) => trace.map((s) => ({ y: s.y, islands: [...s.islands].sort(), files: [...s.files].sort() }));
const page = (key: string) => t.STAND_PAGES.find((p) => p.key === key) as StandPage;

describe('planLoads против Chromium на страницах этого сайта', () => {
  for (const p of t.STAND_PAGES) {
    it(`${p.route}: как собрано (client:visible) — те же файлы и острова на каждом шаге`, () => {
      expect(asTrace(planPage(plan, p, null))).toEqual(sortTrace(p.trace));
    });
    it(`${p.route}: все острова на client:load и client:idle — всё на первом шаге`, () => {
      expect(asTrace(planPage(plan, p, 'load'))).toEqual(sortTrace(p.traceLoad));
      expect(asTrace(planPage(plan, p, 'idle'))).toEqual(sortTrace(p.traceIdle));
    });
  }

  it('без учёта сдвига расчёт ошибается: TimerClamp «ожил бы» на 12 000 вместо 14 400', () => {
    const p = page('event-loop');
    const flat = { ...p, islands: p.islands.map((i) => ({ ...i, liveHeight: i.ssrHeight })) };
    const wrong = planPage(plan, flat, null).find((s) => s.islands.includes('TimerClamp'));
    const right = planPage(plan, p, null).find((s) => s.islands.includes('TimerClamp'));
    expect(wrong?.y).toBe(12000);
    expect(right?.y).toBe(14400);
    expect(p.trace.find((s) => s.islands.includes('TimerClamp'))?.y).toBe(14400);
    const probe = p.islands.find((i) => i.id === 'MicroProbe');
    expect([probe?.ssrHeight, probe?.liveHeight]).toEqual([700, 2606]);
    expect(t.WEIGHT_FACTS[1].d).toContain('1 906 px');
    expect(t.WEIGHT_FACTS[1].d).toContain('14 400 вместо 12 000');
  });
});

describe('числа в тексте посчитаны из литералов стенда', () => {
  it('«Цикл событий»: ноль на старте, первый остров 15 файлов и 127 577 байт, рантайм Vue 109 839', () => {
    const p = page('event-loop');
    const steps = planPage(plan, p, null).filter((s) => s.files.length);
    expect(p.trace[0]).toEqual({ y: 0, islands: [], files: [] });
    expect(steps[0].files).toHaveLength(15);
    expect(steps[0].bytes).toBe(127577);
    const runtime = p.graph['runtime-core.esm-bundler.CIbLXjQd.js'].bytes + p.graph['runtime-dom.esm-bundler.B73O2axo.js'].bytes;
    expect(runtime).toBe(109839);
    expect(steps.slice(1).map((s) => s.bytes)).toEqual([3079, 28559, 16702, 2819]);
    const all = Object.values(p.graph).reduce((n, g) => n + g.bytes, 0);
    expect([Object.keys(p.graph).length, all]).toEqual([21, 178736]);
    for (const n of [127577, 109839, 3079, 28559, 16702, 2819]) expect(t.SITE_FACTS[2].d).toContain(fmt(n));
    expect(t.WEIGHT_FACTS[2].d).toContain('21 файл');
    expect(t.WEIGHT_FACTS[2].d).toContain(fmt(178736));
  });

  it('«React против Vue»: по ссылкам из HTML 16 101 байт, скачано 353 985, React DOM 207 465 — не по ссылке', () => {
    const p = page('react-vs-vue');
    const all = Object.values(p.graph).reduce((n, g) => n + g.bytes, 0);
    const roots = new Set(p.islands.flatMap((i) => i.files));
    expect(htmlRefBytes(p)).toBe(16101);
    expect(roots.size).toBe(5);
    expect([Object.keys(p.graph).length, all]).toEqual([18, 353985]);
    expect(p.graph['client.CXQRFzvJ.js'].bytes).toBe(207465);
    expect(roots.has('client.CXQRFzvJ.js')).toBe(false);
    for (const n of [16101, 353985, 207465]) expect(t.WEIGHT_FACTS[0].d).toContain(fmt(n));
    expect(t.PITFALLS[2].d).toContain(fmt(16101));
  });

  it('общая шина: bus-чанк импортируют три острова, а в шаге стенда он один раз', () => {
    const p = page('react-vs-vue');
    const users = Object.entries(p.graph).filter(([, g]) => g.imports.includes('bus.DvQz9C0S.js')).map(([f]) => f);
    expect(users.sort()).toEqual(['Controls.VJtZrBdZ.js', 'ReactPane.niBPb5DR.js', 'VuePane.55zLwSc6.js']);
    expect(p.trace[1].files.filter((f) => f.startsWith('bus.'))).toEqual(['bus.DvQz9C0S.js']);
    expect(p.trace[1].islands).toHaveLength(3);
  });
});

describe('стенд директив', () => {
  for (const run of t.DIRECTIVE_STAND.runs) {
    it(`окно ${run.width}: planLoads оживляет те же острова на тех же шагах`, () => {
      const graph = Object.fromEntries(t.DIRECTIVE_STAND.islands.flatMap((i) => i.files).map((f) => [f, { bytes: 0, imports: [] }]));
      const steps = plan(t.DIRECTIVE_STAND.islands, graph, {
        viewport: 800,
        scrolls: t.DIRECTIVE_STAND.scrolls,
        matches: (q) => q === '(max-width: 600px)' && run.matches,
      });
      expect(steps.map((s) => ({ y: s.y, islands: [...s.islands].sort() }))).toEqual(
        run.steps.map((s) => ({ y: s.y, islands: [...s.islands].sort() })),
      );
      const woke = new Set(steps.flatMap((s) => s.islands));
      expect(woke.has('visible-text')).toBe(false);
      expect(woke.has('visible-hidden')).toBe(false);
    });
  }

  it('VISIBLE_SOURCE — дословно директива из пакета; наблюдают детей элемента', () => {
    expect(astroFile('runtime/client/visible.js')).toContain(t.VISIBLE_SOURCE);
    expect(t.VISIBLE_SOURCE).toContain('for (const child of el.children)');
  });

  it('idle, media, only, load — так, как написано в таблице', () => {
    const idle = astroFile('runtime/client/idle.js');
    expect(idle).toContain('window.requestIdleCallback(cb, idleOptions)');
    expect(idle).toContain('setTimeout(cb, idleOptions.timeout || 200)');
    const media = astroFile('runtime/client/media.js');
    expect(media).toContain('matchMedia(options.value)');
    expect(media).toContain('mql.addEventListener("change", cb, { once: true })');
    const vue = readFileSync(require.resolve('@astrojs/vue/client.js'), 'utf8');
    expect(vue).toContain('const isHydrate = client !== "only"');
    expect(vue).toContain('const bootstrap = isHydrate ? createSSRApp : createApp');
    // appEntrypoint: setup(app) — внутри функции, которую рендерер зовёт на каждый остров.
    expect(vue).toMatch(/var client_default = \(element\) => async[\s\S]*await setup\(app\)/);
  });

  it('встроенные скрипты: 372 байта директивы visible и 4 380 байт <astro-island>', async () => {
    const island = (await import('astro/runtime/server/astro-island.prebuilt.js')).default as string;
    const visible = (await import('astro/runtime/client/visible.prebuilt.js')).default as string;
    expect(visible.length).toBe(t.SITE.inlineVisible);
    expect(island.length).toBe(t.SITE.inlineIsland);
    expect(Buffer.byteLength(island)).toBe(island.length);
    for (const n of [372, 4380]) expect(t.SITE_FACTS[1].d).toContain(fmt(n));
  });

  it('жизненный цикл острова — по исходнику astro-island.js', () => {
    const src = astroFile('runtime/server/astro-island.js');
    expect(src).toContain('this.hasAttribute("await-children")');
    expect(src).toContain('this.lastChild.nodeValue === "astro:end"');
    expect(src).toContain('window.addEventListener(`astro:${directive}`');
    expect(src).toContain('parsed.searchParams.set("astro-retry"');
    expect(src).toContain('closest("astro-island[ssr]")');
    expect(src).toContain('this.removeAttribute("ssr")');
    expect(astroFile('runtime/server/astro-island-styles.js')).toContain('astro-island,astro-slot,astro-static-slot{display:contents}');
  });
});

describe('пропсы: REVIVE_CODE против настоящего Astro', () => {
  type Revive = (attr: string) => Record<string, unknown>;
  const mine = new Function(`${t.REVIVE_CODE}\nreturn reviveProps;`)() as Revive;

  // Восстановитель из пакета: тот же блок, что работает в браузере внутри <astro-island>.
  const src = astroFile('runtime/server/astro-island.js');
  const block = src.slice(src.indexOf('const propTypes'), src.indexOf('class AstroIsland'));
  const realObject = new Function(`${block}\nreturn reviveObject;`)() as (raw: unknown) => Record<string, unknown>;
  const real: Revive = (attr) => realObject(JSON.parse(attr));

  const valueOf = (expr: string) => new Function(`${t.PROP_SETUP_CODE}\nreturn [(${expr}), Point];`)() as [unknown, new (...a: number[]) => unknown];

  it('восстановитель вырезан из пакета, а не пуст', () => {
    expect(block).toContain('11: (value) => Number.POSITIVE_INFINITY * value');
    expect(Object.keys(real('{"a":[3,"2026-01-01T00:00:00.000Z"]}'))).toEqual(['a']);
  });

  for (const row of t.PROP_ROWS.filter((r) => r.id !== 'cycle')) {
    it(`${row.expr} → ${row.wire}`, async () => {
      const { serializeProps } = await import('astro/runtime/server/serialize.js');
      const [value, Point] = valueOf(row.expr);
      const attr = serializeProps({ v: value }, { displayName: 'X', hydrate: 'load' } as never);
      expect(JSON.stringify(JSON.parse(attr).v)).toBe(row.wire);
      const a = mine(attr);
      const b = real(attr);
      expect(a).toEqual(b);
      expect('v' in a).toBe(true);
      const v = a.v as Record<string, unknown> | null;
      switch (row.id) {
        case 'undef': expect(v).toBeUndefined(); break;
        case 'nan':
        case 'fn':
        case 'sym': expect(v).toBeNull(); break;
        case 'inf': expect(v).toBe(Infinity); break;
        case 'big': expect(v).toBe(10n); break;
        case 're': expect([(v as unknown as RegExp).source, (v as unknown as RegExp).flags]).toEqual(['ab+c', '']); break;
        case 'date': expect(v).toBeInstanceOf(Date); break;
        case 'map': expect(v).toEqual(new Map([['k', 1]])); break;
        case 'set': expect(v).toEqual(new Set([1, 2])); break;
        case 'url': expect(v).toBeInstanceOf(URL); break;
        case 'u8': expect(v).toBeInstanceOf(Uint8Array); break;
        case 'f64': expect(Object.getPrototypeOf(v)).toBe(Object.prototype); expect(v).toEqual({ 0: 1.5 }); break;
        case 'nested': expect((v as { when: unknown }).when).toBeInstanceOf(Date); break;
        case 'class': expect(v instanceof Point).toBe(false); expect(v).toEqual({ x: 1, y: 2 }); expect('length' in (v as object)).toBe(false); break;
        default: expect(v).toBe('текст');
      }
    });
  }

  it('цикл роняет сериализацию', async () => {
    const { serializeProps } = await import('astro/runtime/server/serialize.js');
    const [loop] = valueOf('loop');
    expect(() => serializeProps({ v: loop }, { displayName: 'X', hydrate: 'load' } as never)).toThrow(/Cyclic reference detected/);
  });
});

describe('связь между островами и возобновление', () => {
  it('LATE_CODE: остров, подписавшийся позже, слышит стор, но не событие', () => {
    const log = new Function('window', `${t.LATE_CODE}\nreturn log;`)(new EventTarget());
    expect(log).toEqual(t.LATE_LOG);
  });

  it('RESUME_CODE: гидратация исполняет три setup, возобновление — ни одного до клика', async () => {
    const win = new Window();
    const doc = win.document as unknown as Document;
    const html = `<script type="app/state">{"count":5}</script>` +
      [0, 1, 2].map((i) => `<button id="b${i}" data-component="counter" data-props='{"count":5}' data-on-click="counter.js#inc">5</button>`).join('');
    const { hydrate, resume } = new Function(`${t.RESUME_CODE}\nreturn { hydrate, resume };`)() as {
      hydrate: (d: Document, im: (u: string) => Promise<unknown>) => Promise<void>;
      resume: (d: Document, im: (u: string) => Promise<unknown>) => void;
    };
    const make = () => {
      const stat = { loads: 0, setups: 0 };
      const cache = new Map<string, unknown>();
      const counter = {
        setup(el: HTMLElement, props: { count: number }) {
          stat.setups++;
          let n = props.count;
          el.addEventListener('click', () => { el.textContent = String(++n); });
        },
        inc(state: { count: number }, el: HTMLElement) { el.textContent = String(++state.count); },
      };
      const importModule = async (url: string) => {
        if (!cache.has(url)) { stat.loads++; cache.set(url, counter); }
        return cache.get(url);
      };
      return { stat, importModule };
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    doc.body.innerHTML = html;
    const h = make();
    await hydrate(doc, h.importModule);
    expect(h.stat).toEqual({ loads: 1, setups: 3 });

    doc.body.innerHTML = html;
    const r = make();
    resume(doc, r.importModule);
    expect(r.stat).toEqual({ loads: 0, setups: 0 });
    const b1 = doc.getElementById('b1') as HTMLElement;
    b1.click();
    await flush();
    expect(r.stat).toEqual({ loads: 1, setups: 0 });
    expect(b1.textContent).toBe('6');
    b1.click();
    await flush();
    expect([r.stat.loads, b1.textContent]).toEqual([1, '7']);

    expect(t.RESUME_ROWS.rows[0].slice(1, 3)).toEqual(['3', '1 — компонент, общий для трёх кнопок']);
    expect(t.RESUME_ROWS.rows[1].slice(1, 3)).toEqual(['0', '0']);
    expect(t.RESUME_ROWS.rows[1][3]).toContain('с 5');
    await win.happyDOM.close();
  });
});

// ─── Собранный сайт: только если dist/ есть ────────────────────────────────────────────────

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const hasDist = existsSync(join(DIST, 'index.html'));

describe.skipIf(!hasDist)(hasDist ? 'собранный dist/: инварианты, на которых стоит тема' : 'собранный dist/ — ПРОПУЩЕНО: нет dist/, соберите сайт', () => {
  const pages: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== '_astro') walk(p); } else if (f === 'index.html') pages.push(p);
    }
  };
  if (hasDist) walk(DIST);
  const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it('у каждого острова есть ssr, client и await-children; встроенные скрипты — из пакета', async () => {
    const island = (await import('astro/runtime/server/astro-island.prebuilt.js')).default as string;
    let count = 0;
    for (const p of pages) {
      const html = readFileSync(p, 'utf8');
      // Только тело: в <meta name="description"> темы про острова сам тег упомянут текстом,
      // а в значении атрибута `<` допустим и браузером тегом не считается.
      const body = html.slice(html.indexOf('<body'));
      const tags = body.match(/<astro-island[^>]*>/g) ?? [];
      if (!tags.length) continue;
      expect(html, p).toContain(island);
      for (const tag of tags) {
        count++;
        expect(tag).toMatch(/ ssr /);
        const client = /client="(\w+)"/.exec(tag)?.[1] as string;
        expect(['load', 'idle', 'visible', 'media', 'only']).toContain(client);
        const directive = (await import(`astro/runtime/client/${client}.prebuilt.js`)).default as string;
        expect(html, p).toContain(directive);
        if (client !== 'only') expect(tag).toContain('await-children');
      }
    }
    expect(count).toBeGreaterThan(100);
  });

  it('ссылки из HTML занижают вес: у страниц с Vue-островом рантайм Vue не упомянут в HTML', () => {
    let checked = 0;
    for (const p of pages) {
      const html = readFileSync(p, 'utf8');
      if (!html.includes('<astro-island')) continue;
      const refs = new Set(html.match(/\/_astro\/[\w.-]+\.js/g) ?? []);
      const roots = [...refs].map((u) => u.slice('/_astro/'.length));
      const seen = new Set<string>();
      const visit = (f: string) => {
        if (seen.has(f)) return;
        seen.add(f);
        const src = readFileSync(join(DIST, '_astro', f), 'utf8');
        for (const m of src.matchAll(/(?:import|export)\s*(?:[\w${},*\s]+from\s*)?["']\.\/([^"']+\.js)["']/g)) visit(m[1]);
      };
      roots.forEach(visit);
      const runtime = [...seen].filter((f) => f.startsWith('runtime-core.esm-bundler.'));
      if (!runtime.length) continue;
      checked++;
      expect(roots.some((f) => f.startsWith('runtime-core.')), p).toBe(false);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('пропсы копируются в каждый остров: одна строка code трижды на /frameworks/react-hooks-internals/', () => {
    const file = join(DIST, 'frameworks/react-hooks-internals/index.html');
    if (!existsSync(file)) return;
    const html = readFileSync(file, 'utf8');
    const codes = [...html.matchAll(/ props="([^"]*)"/g)].map((m) => (JSON.parse(unesc(m[1])) as { code?: [number, string] }).code?.[1]);
    expect(codes.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(new Set(codes).size).toBe(1);
  });
});
