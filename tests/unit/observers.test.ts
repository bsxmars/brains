import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/observers/data';
import { depthMap, loadIo, loadResizeFrame } from '@/widgets/observer-lab/model/run';
import type { Rect } from '@/widgets/observer-lab/model/types';

/**
 * Тема «Наблюдатели: Intersection, Resize, Mutation — когда они срабатывают».
 *
 * `IO_CODE` и `RO_CODE` — учебные модели строкой из темы: напечатаны на странице и исполняются
 * демо. Здесь они сверяются с настоящим Chromium из Playwright: `IO_CODE` — на сетке случайных
 * геометрий с фиксированным зерном (корень, цель, `rootMargin`, пороги, затем перестановка
 * цели), `RO_CODE` — на случайных деревьях с реакциями колбэка и на сценах демо.
 *
 * Остальные строки (`ORDER_CODE`, `MO_CODE`, `LAZY_CODE`, `SENTINEL_*`, `RO_LOOP_BAD_CODE`)
 * исполняются в странице как есть, и их вывод сверяется с литералами и утверждениями текста.
 * Таймеров-замеров нет: только порядок, число вызовов и геометрия.
 */

const io = loadIo(t.IO_CODE);
const resizeFrame = loadResizeFrame(t.RO_CODE);

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const blank = () => page.setContent('<!doctype html><body style="margin:0">');

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Порядок в кадре ───────────────────────────────────────────────────────────────────────

describe('ORDER_CODE даёт в Chromium журнал ORDER_LOG', () => {
  it('три прогона подряд — один и тот же журнал', async () => {
    for (let i = 0; i < 3; i++) {
      await page.setContent(`<!doctype html><body style="margin:0">${t.ORDER_HTML}`);
      const log = await page.evaluate(`(async () => { ${t.ORDER_CODE}\nreturn probe(); })()`);
      expect(log).toEqual(t.ORDER_LOG);
    }
  }, 30_000);

  it('текст говорит то, что показывает журнал', () => {
    const at = (s: string) => t.ORDER_LOG.findIndex((l) => l.endsWith(s));
    expect(at('MutationObserver, записей: 1')).toBeLessThan(at('setTimeout 0'));
    expect(at('rAF')).toBeLessThan(at('ResizeObserver'));
    expect(at('setTimeout из ResizeObserver')).toBeLessThan(at('IntersectionObserver'));
    expect(t.ORDER_LOG.at(-1)).toMatch(/^кадр \+1 · IntersectionObserver$/);
    expect(t.ORDER_NOTE).toContain('даже позже `setTimeout`, поставленного из `ResizeObserver`');
  });
});

// ─── IntersectionObserver ──────────────────────────────────────────────────────────────────

interface IoCase {
  root: Rect;
  rootMargin: string;
  thresholds: number[];
  a: Rect;
  b: Rect;
}

interface RealEntry {
  rootBounds: Rect;
  intersectionRect: Rect;
  intersectionRatio: number;
  isIntersecting: boolean;
}

/** Каждый случай — свой корень с `overflow: hidden` и свой наблюдатель; потом цель переставляется. */
async function runIoCases(cases: IoCase[]): Promise<{ first: RealEntry[]; second: RealEntry[] }[]> {
  await blank();
  return page.evaluate(async (cases) => {
    const out = cases.map(() => ({ first: [] as RealEntry[], second: [] as RealEntry[] }));
    let phase: 'first' | 'second' = 'first';
    const rect = (r: DOMRectReadOnly | null) => ({ x: r!.x, y: r!.y, width: r!.width, height: r!.height });
    const moves = cases.map((c, i) => {
      const root = document.createElement('div');
      root.style.cssText = `position:absolute;left:${c.root.x}px;top:${c.root.y}px;width:${c.root.width}px;height:${c.root.height}px;overflow:hidden`;
      const el = document.createElement('div');
      const place = (g: Rect) => {
        el.style.cssText = `position:absolute;left:${g.x - c.root.x}px;top:${g.y - c.root.y}px;width:${g.width}px;height:${g.height}px`;
      };
      place(c.a);
      root.append(el);
      document.body.append(root);
      const obs = new IntersectionObserver(
        (es) => {
          for (const e of es)
            out[i][phase].push({
              rootBounds: rect(e.rootBounds),
              intersectionRect: rect(e.intersectionRect),
              intersectionRatio: e.intersectionRatio,
              isIntersecting: e.isIntersecting,
            });
        },
        { root, rootMargin: c.rootMargin, threshold: c.thresholds },
      );
      obs.observe(el);
      return () => place(c.b);
    });
    const settle = () =>
      new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 100))));
    await settle();
    phase = 'second';
    moves.forEach((m) => m());
    await settle();
    return out;
  }, cases);
}

function randomIoCases(seed: number, n: number): IoCase[] {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const margins = ['-5%', '7% -3%', '-10.5px', '0px', '20px', '-20px', '50px 0px', '0px 0px -30px 0px', '10%', '25% 0%', '-10% 5%', '10px 20px 30px 40px', '0px 0px 50% 0px'];
  const all = [0, 0.1, 0.25, 0.5, 0.75, 1];
  const geom = (root: Rect): Rect => ({
    x: root.x + int(-15, 25) * 10 - 50,
    y: root.y + int(-15, 25) * 10 - 50,
    width: int(0, 15) * 10,
    height: int(0, 15) * 10,
  });
  return Array.from({ length: n }, () => {
    const root = { x: 300, y: 250, width: int(100, 300), height: int(60, 200) };
    const th = all.filter(() => rnd() < 0.4);
    return { root, rootMargin: margins[int(0, margins.length - 1)], thresholds: th.length ? th : [0], a: geom(root), b: geom(root) };
  });
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const sameRect = (a: Rect, b: Rect) => near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);

describe('IO_CODE совпадает с IntersectionObserver Chromium', () => {
  for (const seed of [23, 7]) {
    it(`сетка из 400 случайных геометрий, зерно ${seed}`, async () => {
      const cases = randomIoCases(seed, 400);
      const real = await runIoCases(cases);
      let fired = 0;
      let touching = 0;
      let belowFirst = 0;
      cases.forEach((c, i) => {
        const ea = io.computeEntry(c.a, c.root, c.rootMargin, c.thresholds);
        const eb = io.computeEntry(c.b, c.root, c.rootMargin, c.thresholds);
        const { first, second } = real[i];
        const where = JSON.stringify(c);
        // первая запись приходит всегда — ступенька −1 после observe()
        expect(first.length, where).toBe(1);
        expect(io.compareFrames({ thresholdIndex: -1 }, ea, c.thresholds).fires).toBe(true);
        for (const [model, got] of [[ea, first[0]], ...(second.length ? [[eb, second[0]]] : [])] as const) {
          expect(sameRect(got.rootBounds, model.rootBounds), where).toBe(true);
          expect(sameRect(got.intersectionRect, model.intersectionRect), where).toBe(true);
          expect(got.intersectionRatio, where).toBeCloseTo(model.intersectionRatio, 6);
          expect(got.isIntersecting, where).toBe(model.isIntersecting);
        }
        expect(second.length === 1, where).toBe(io.compareFrames(ea, eb, c.thresholds).fires);
        if (second.length) fired++;
        if (ea.isIntersecting && ea.intersectionRatio === 0 && c.a.width * c.a.height > 0) touching++;
        if (ea.intersectionRatio > 0 && !ea.isIntersecting) belowFirst++;
      });
      // сетка действительно задевает трудные места
      expect(fired).toBeGreaterThan(100);
      expect(touching).toBeGreaterThan(0);
      expect(belowFirst).toBeGreaterThan(10);
    }, 60_000);
  }

  it('шесть разобранных геометрий IO_CASES — и в модели, и в браузере', async () => {
    const cases = t.IO_CASES.map((c) => ({ root: { ...t.IO_ROOT, x: 300, y: 250 }, rootMargin: c.rootMargin, thresholds: c.thresholds, a: { ...c.target, x: c.target.x + 300, y: c.target.y + 250 }, b: { ...c.target, x: c.target.x + 300, y: c.target.y + 250 } }));
    const real = await runIoCases(cases);
    t.IO_CASES.forEach((c, i) => {
      const e = io.computeEntry(c.target, t.IO_ROOT, c.rootMargin, c.thresholds);
      expect(e.intersectionRatio, c.k).toBeCloseTo(c.ratio, 9);
      expect(e.isIntersecting, c.k).toBe(c.isIntersecting);
      expect(real[i].first[0].intersectionRatio, c.k).toBeCloseTo(c.ratio, 6);
      expect(real[i].first[0].isIntersecting, c.k).toBe(c.isIntersecting);
    });
  }, 30_000);

  it('между порогами — тишина: [0, 1], цель едет с 10 % до 90 %', async () => {
    const root = { x: 300, y: 250, width: 200, height: 100 };
    const a = { x: 320, y: 340, width: 50, height: 100 }; // видно 10 из 100
    const b = { x: 320, y: 260, width: 50, height: 100 }; // видно 90
    const [r] = await runIoCases([{ root, rootMargin: '0px', thresholds: [0, 1], a, b }]);
    expect(r.first[0].intersectionRatio).toBeCloseTo(0.1, 6);
    expect(r.second).toHaveLength(0);
    expect(io.compareFrames(io.computeEntry(a, root, '0px', [0, 1]), io.computeEntry(b, root, '0px', [0, 1]), [0, 1]).fires).toBe(false);
  }, 30_000);

  it('опции и края: округление rootMargin, ошибки, сортировка, чужая ветка, display: none, v2', async () => {
    await blank();
    const r = await page.evaluate(async () => {
      const out: Record<string, unknown> = {};
      const err = (f: () => unknown) => {
        try {
          f();
          return 'ok';
        } catch (e) {
          return `${(e as Error).name}: ${(e as Error).message}`;
        }
      };
      out.px = new IntersectionObserver(() => {}, { rootMargin: '-10.5px 0.3px' }).rootMargin;
      out.em = err(() => new IntersectionObserver(() => {}, { rootMargin: '1em' }));
      out.range = err(() => new IntersectionObserver(() => {}, { threshold: [1.5] }));
      out.sorted = new IntersectionObserver(() => {}, { threshold: [0.5, 0, 1, 0.5] }).thresholds;
      out.v2NoDelay = err(() => new IntersectionObserver(() => {}, { trackVisibility: true } as IntersectionObserverInit));
      const first = (el: Element, init?: IntersectionObserverInit) =>
        new Promise<IntersectionObserverEntry>((ok) => {
          const o = new IntersectionObserver((es) => {
            o.disconnect();
            ok(es[0]);
          }, init);
          o.observe(el);
        });
      const pick = (e: IntersectionObserverEntry) => [e.isIntersecting, e.intersectionRatio, e.boundingClientRect.width];
      const rootA = document.createElement('div');
      rootA.style.cssText = 'width:200px;height:200px;overflow:hidden';
      const other = document.createElement('div');
      other.style.cssText = 'width:50px;height:50px';
      document.body.append(rootA, other);
      out.notDescendant = pick(await first(other, { root: rootA }));
      const hidden = document.createElement('div');
      hidden.style.cssText = 'display:none;width:50px;height:50px';
      document.body.append(hidden);
      out.none = pick(await first(hidden));
      out.detached = pick(await first(document.createElement('div')));
      const far = document.createElement('div');
      far.style.cssText = 'position:absolute;top:5000px;width:50px;height:50px';
      document.body.append(far);
      out.far = pick(await first(far));
      const veil = document.createElement('div');
      veil.style.opacity = '.5';
      const inner = document.createElement('p');
      inner.textContent = 'x';
      veil.append(inner);
      const plain = document.createElement('p');
      plain.textContent = 'y';
      document.body.prepend(veil, plain);
      const v2 = { trackVisibility: true, delay: 100 } as IntersectionObserverInit;
      const e1 = (await first(inner, v2)) as IntersectionObserverEntry & { isVisible: boolean };
      const e2 = (await first(plain, v2)) as IntersectionObserverEntry & { isVisible: boolean };
      out.v2 = [e1.isIntersecting, e1.isVisible, e2.isIntersecting, e2.isVisible];
      return out;
    });
    expect(r.px).toBe('-11px 0px -11px 0px');
    expect(r.em).toMatch(/^SyntaxError: .*pixels or percent/);
    expect(r.range).toMatch(/^RangeError/);
    expect(r.sorted).toEqual([0, 0.5, 0.5, 1]);
    expect(r.v2NoDelay).toMatch(/^NotSupportedError: .*'delay' option with a value of at least 100/);
    expect(r.notDescendant).toEqual([false, 0, 0]);
    expect(r.none).toEqual([false, 0, 0]);
    expect(r.detached).toEqual([false, 0, 0]);
    expect(r.far).toEqual([false, 0, 50]);
    expect(r.v2).toEqual([true, false, true, true]);
    // текст называет ровно эти ответы
    expect(t.IO_OPTION_ROWS.find((o) => o.k === 'threshold')!.d).toContain('`[0, 0.5, 0.5, 1]`');
    expect(t.IO_V2_NOTE).toContain('`NotSupportedError`');
  }, 30_000);
});

// ─── ResizeObserver ────────────────────────────────────────────────────────────────────────

interface RoTree {
  ids: string[];
  parent: Record<string, string | null>;
  depthOf: Record<string, number>;
  observed: string[];
  reactions: Record<string, string[]>;
  /** Кого толкнуть после первых записей; `null` — сравнивать с самого observe(). */
  start: string | null;
}

const FRAMES = 4;

/** В браузере: дерево блоков с явными размерами, реакция колбэка — +1px к ширине. */
async function runRo(tree: RoTree): Promise<{ rounds: string[][]; error: string | false }[]> {
  return page.evaluate(
    async ({ tree, FRAMES }) => {
      document.body.innerHTML = '';
      const el: Record<string, HTMLElement> = {};
      for (const id of tree.ids) {
        const d = document.createElement('div');
        d.id = id;
        d.style.cssText = 'width:20px;height:10px';
        (tree.parent[id] ? el[tree.parent[id]!] : document.body).append(d);
        el[id] = d;
      }
      const frames = Array.from({ length: FRAMES }, () => ({ rounds: [] as string[][], error: false as string | false }));
      let frame = -1;
      let armed = tree.start === null;
      const onErr = (e: ErrorEvent) => {
        if (frame >= 0 && frame < FRAMES) frames[frame].error = e.message;
        e.preventDefault();
      };
      window.addEventListener('error', onErr);
      const grow = (id: string) => (el[id].style.width = parseFloat(el[id].style.width) + 1 + 'px');
      const ro = new ResizeObserver((entries) => {
        if (!armed || frame < 0 || frame >= FRAMES) return;
        frames[frame].rounds.push(entries.map((e) => e.target.id));
        for (const e of entries) for (const r of tree.reactions[e.target.id] ?? []) grow(r);
      });
      const nextFrame = () => new Promise((ok) => requestAnimationFrame(ok));
      if (tree.start !== null) {
        for (const id of tree.observed) ro.observe(el[id]);
        await nextFrame();
        await nextFrame();
      }
      await new Promise<void>((ok) =>
        requestAnimationFrame(() => {
          frame = 0;
          if (tree.start === null) for (const id of tree.observed) ro.observe(el[id]);
          else {
            armed = true;
            grow(tree.start);
          }
          const tick = () =>
            requestAnimationFrame(() => {
              frame++;
              if (frame < FRAMES) tick();
              else ok();
            });
          tick();
        }),
      );
      ro.disconnect();
      window.removeEventListener('error', onErr);
      return frames;
    },
    { tree, FRAMES },
  );
}

function modelRo(tree: RoTree) {
  const dirty = new Set(tree.start === null ? tree.observed : [tree.start]);
  return Array.from({ length: FRAMES }, () => {
    const f = resizeFrame(tree.depthOf, tree.observed, dirty, tree.reactions);
    return { rounds: f.rounds, error: f.error };
  });
}

function randomTrees(seed: number, n: number): RoTree[] {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  return Array.from({ length: n }, () => {
    const count = int(4, 8);
    const ids = Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));
    const parent: Record<string, string | null> = {};
    const depthOf: Record<string, number> = {};
    ids.forEach((id, i) => {
      parent[id] = i === 0 ? null : ids[int(0, i - 1)];
      depthOf[id] = parent[id] ? depthOf[parent[id]!] + 1 : 1;
    });
    const observed = ids.filter(() => rnd() < 0.7).sort(() => rnd() - 0.5);
    if (observed.length < 2) observed.push(...ids.filter((x) => !observed.includes(x)).slice(0, 2));
    const reactions: Record<string, string[]> = {};
    for (const id of observed) {
      const k = int(0, 2);
      if (k) reactions[id] = Array.from({ length: k }, () => ids[int(0, count - 1)]);
    }
    return { ids, parent, depthOf, observed, reactions, start: null };
  });
}

describe('RO_CODE совпадает с кругами ResizeObserver в Chromium', () => {
  it('100 случайных деревьев, четыре кадра: круги, порядок и ошибка', async () => {
    await blank();
    const trees = randomTrees(23, 100);
    let errors = 0;
    let multi = 0;
    for (const tree of trees) {
      const real = await runRo(tree);
      const model = modelRo(tree);
      for (const f of real) if (f.error) expect(f.error).toBe(t.RO_LOOP_MESSAGE);
      expect(real.map((f) => ({ rounds: f.rounds, error: !!f.error })), JSON.stringify(tree)).toEqual(model);
      if (model.some((f) => f.error)) errors++;
      if (model.some((f) => f.rounds.length > 1)) multi++;
    }
    expect(errors).toBeGreaterThan(20);
    expect(multi).toBeGreaterThan(20);
  }, 120_000);

  it('сцены демо — то же, что говорит их подпись', async () => {
    await blank();
    for (const s of t.RO_SCENES) {
      const tree: RoTree = {
        ids: s.nodes.map((n) => n.id),
        parent: Object.fromEntries(s.nodes.map((n) => [n.id, n.parent])),
        depthOf: depthMap(s),
        observed: s.observed,
        reactions: s.reactions,
        start: s.start,
      };
      const real = await runRo(tree);
      const model = modelRo(tree);
      expect(real.map((f) => ({ rounds: f.rounds, error: !!f.error })), s.id).toEqual(model);
      const first = model[0];
      if (s.id === 'down') expect(first).toEqual({ rounds: [['A'], ['B'], ['C']], error: false });
      if (s.id === 'up') expect([first, model[1]]).toEqual([{ rounds: [['C']], error: true }, { rounds: [['A']], error: false }]);
      if (s.id === 'sibling') expect([first, model[1]]).toEqual([{ rounds: [['B']], error: true }, { rounds: [['D']], error: false }]);
      if (s.id === 'self') expect(model.every((f) => f.error && f.rounds.length === 1)).toBe(true);
      if (s.id === 'mixed') expect([first, model[1]]).toEqual([{ rounds: [['A'], ['C'], ['D']], error: true }, { rounds: [['B']], error: false }]);
    }
  }, 60_000);
});

describe('ResizeObserver: коробки и факты из текста', () => {
  it('content-box, border-box, device-pixel-content-box, transform, display, сдвиг', async () => {
    await page.setContent(`<!doctype html><body style="margin:0">
      <div id="a" style="width:100.3px;height:50px;padding:10px;border:2px solid;margin-left:0.3px"></div>
      <div id="dp" style="width:100.3px;height:50px;margin-left:10.3px"></div>
      <div id="dq" style="width:100.3px;height:50px"></div>
      <div id="b" style="box-sizing:border-box;width:200px;height:200px;padding:10px"></div>
      <div id="z" style="width:0;height:0"></div><div id="n" style="display:none;width:50px;height:50px"></div><span id="i">текст</span>`);
    const r = await page.evaluate(async () => {
      const raf = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const log: [string, string, number, number, number][] = [];
      const mk = (box: string) =>
        new ResizeObserver((es) => {
          for (const e of es) log.push([box, e.target.id, e.contentBoxSize[0].inlineSize, e.borderBoxSize[0].inlineSize, e.devicePixelContentBoxSize[0].inlineSize]);
        });
      const $ = (id: string) => document.getElementById(id) as HTMLElement;
      const content = mk('content-box');
      for (const id of ['a', 'b', 'z', 'n', 'i']) content.observe($(id));
      mk('border-box').observe($('b'), { box: 'border-box' });
      const dev = mk('device-pixel-content-box');
      dev.observe($('dp'), { box: 'device-pixel-content-box' });
      dev.observe($('dq'), { box: 'device-pixel-content-box' });
      await raf();
      const initial = log.splice(0);
      $('b').style.padding = '30px';
      await raf();
      const pad = log.splice(0);
      $('a').style.transform = 'scale(2)';
      $('b').style.transform = 'scale(2)';
      await raf();
      const transform = log.splice(0).filter((e) => e[0] !== 'device-pixel-content-box');
      $('a').style.marginLeft = '40px';
      $('a').style.visibility = 'hidden';
      await raf();
      const moved = log.splice(0);
      $('a').style.display = 'none';
      $('n').style.display = 'block';
      await raf();
      const display = log.splice(0).map((e) => [e[1], e[2]]);
      return { initial, pad, transform, moved, display };
    });
    const at = (box: string, id: string) => r.initial.find((e) => e[0] === box && e[1] === id)!;
    expect(at('content-box', 'a').slice(2, 4)).toEqual([100.296875, 124.296875]);
    expect(at('device-pixel-content-box', 'dp')[4]).toBe(101);
    expect(at('device-pixel-content-box', 'dq')[4]).toBe(100);
    // первая запись — и про ноль, и про display: none, и про строчный элемент
    for (const id of ['z', 'n', 'i']) expect(at('content-box', id).slice(2)).toEqual([0, 0, 0]);
    expect(at('content-box', 'b')[2]).toBe(180);
    // padding 10 → 30 у border-box: content сжался, border-box промолчал
    expect(r.pad).toEqual([['content-box', 'b', 140, 200, 140]]);
    expect(r.transform).toEqual([]);
    expect(r.moved).toEqual([]);
    expect(r.display).toEqual([
      ['a', 0],
      ['n', 50],
    ]);
    expect(t.RO_BOX_ROWS[0].stand).toContain('`100.296875`');
    expect(t.RO_BOX_ROWS[1].stand).toContain('`124.296875`');
    expect(t.RO_BOX_ROWS[2].stand).toContain('`101`');
    expect(t.RO_BOX_NOTE).toContain('со 180 до 140');
  }, 30_000);

  it('RO_LOOP_BAD_CODE: два вызова и одна ошибка; aspect-ratio даёт ту же высоту', async () => {
    await page.setContent(`<!doctype html><body style="margin:0"><div id="card" style="width:300px"></div>
      <style>.card { aspect-ratio: 2 / 1; width: 300px }</style><div class="card" id="css"></div>`);
    const r = await page.evaluate(async (code) => {
      const errors: string[] = [];
      window.addEventListener('error', (e) => {
        errors.push(e.message);
        e.preventDefault();
      });
      const card = document.getElementById('card')!;
      let calls = 0;
      const Native = ResizeObserver;
      const Counting = class extends Native {
        constructor(cb: ResizeObserverCallback) {
          super((es, o) => {
            calls++;
            cb(es, o);
          });
        }
      };
      new Function('ResizeObserver', 'card', code)(Counting, card);
      await new Promise((ok) => setTimeout(ok, 300));
      return { calls, errors, height: card.offsetHeight, css: document.getElementById('css')!.offsetHeight };
    }, t.RO_LOOP_BAD_CODE);
    expect(r).toEqual({ calls: 2, errors: [t.RO_LOOP_MESSAGE], height: 150, css: 150 });
    expect(t.RO_LOOP_NOTE).toContain('два вызова и **одну** ошибку');
  }, 30_000);
});

// ─── MutationObserver ──────────────────────────────────────────────────────────────────────

describe('MutationObserver', () => {
  it('MO_CODE даёт MO_LOG', async () => {
    await page.setContent(`<!doctype html><body>${t.MO_HTML}`);
    const log = await page.evaluate(`(async () => { ${t.MO_CODE}\nreturn probeMutations(); })()`);
    expect(log).toEqual(t.MO_LOG);
    expect(t.MO_NOTE).toContain('**один** вызов с пятью записями');
  });

  it('стили, анимация и чужой атрибут без subtree записей не дают; ошибка без вида записей', async () => {
    await page.setContent('<!doctype html><style>#t{}</style><body><div id="t" class="a"><b id="c"></b></div>');
    const r = await page.evaluate(async () => {
      const el = document.getElementById('t')!;
      const take = (o: MutationObserver) => o.takeRecords().map((x) => `${x.type}:${x.attributeName}`);
      const deep = new MutationObserver(() => {});
      deep.observe(document.body, { subtree: true, attributes: true, childList: true });
      el.style.color = 'green';
      el.classList.add('x');
      const direct = take(deep);
      (document.styleSheets[0].cssRules[0] as CSSStyleRule).style.color = 'red';
      el.animate([{ opacity: 0 }, { opacity: 1 }], 20);
      await new Promise((ok) => setTimeout(ok, 60));
      const styleOnly = take(deep);
      const shallow = new MutationObserver(() => {});
      shallow.observe(el, { attributes: true });
      document.getElementById('c')!.title = 'x';
      const noSubtree = take(shallow);
      let kind = '';
      try {
        new MutationObserver(() => {}).observe(el, { subtree: true });
      } catch (e) {
        kind = `${(e as Error).name}: ${(e as Error).message}`;
      }
      return { direct, styleOnly, noSubtree, kind };
    });
    expect(r.direct).toEqual(['attributes:style', 'attributes:class']);
    expect(r.styleOnly).toEqual([]);
    expect(r.noSubtree).toEqual([]);
    expect(t.MO_KIND_ERROR).toContain(r.kind.replace("Failed to execute 'observe' on 'MutationObserver': ", ''));
  });
});

// ─── Применения ────────────────────────────────────────────────────────────────────────────

describe('примеры из раздела «Где что применять»', () => {
  it('LAZY_CODE: фоны грузятся в окне и в запасе 600px, остальные — после прокрутки', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    const tops = [0, 500, 1100, 1300, 2000, 3000];
    await page.setContent(
      `<!doctype html><body style="margin:0;height:5000px">${tops
        .map((y, i) => `<div data-bg="bg${i}.png" style="position:absolute;top:${y}px;width:100px;height:100px"></div>`)
        .join('')}`,
    );
    const loaded = () =>
      page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-bg]')].map((el) => el.style.backgroundImage !== ''));
    const settle = () => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(ok, 50)))));
    await page.evaluate(`(() => { ${t.LAZY_CODE} })()`);
    await settle();
    // окно 600 + запас 600 = 1200: верх блока 1100 внутри, 1300 — снаружи
    expect(await loaded()).toEqual([true, true, true, false, false, false]);
    await page.evaluate(() => window.scrollTo(0, 1000));
    await settle();
    expect(await loaded()).toEqual([true, true, true, true, true, false]);
    await page.setViewportSize({ width: 1200, height: 900 });
  }, 30_000);

  it('SENTINEL_CODE встаёт после одной загрузки; с SENTINEL_FIX_CODE — грузит до 1400px', async () => {
    await page.setViewportSize({ width: 800, height: 600 });
    const run = (code: string) =>
      page
        .setContent('<!doctype html><body style="margin:0"><div id="feed"></div><div id="feed-end"></div>')
        .then(() =>
          page.evaluate(async (code) => {
            let loads = 0;
            const feed = document.getElementById('feed')!;
            const loadNextPage = async () => {
              loads++;
              for (let i = 0; i < 3; i++) {
                const d = document.createElement('div');
                d.style.height = '40px';
                feed.append(d);
              }
            };
            new Function('loadNextPage', code)(loadNextPage);
            await new Promise((ok) => setTimeout(ok, 800));
            return { loads, height: feed.offsetHeight };
          }, code),
        );
    const stuck = await run(t.SENTINEL_CODE);
    expect(stuck).toEqual({ loads: 1, height: 120 });
    const target = / {2}await loadNextPage\(\);[^\n]*\n {2}loading = false;/;
    expect(t.SENTINEL_CODE).toMatch(target);
    const fixed = await run(t.SENTINEL_CODE.replace(target, t.SENTINEL_FIX_CODE));
    // сторож уезжает за окно 600 + запас 800
    expect(fixed.height).toBeGreaterThan(1400);
    expect(fixed.height - 120).toBeLessThanOrEqual(1400);
    expect(t.SENTINEL_NOTE).toContain('за 1400px');
    await page.setViewportSize({ width: 1200, height: 900 });
  }, 30_000);
});
