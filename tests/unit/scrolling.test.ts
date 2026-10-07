import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/scrolling/data';
import { loadAnchor, loadSticky, SNAPSHOT_JS } from '@/widgets/scroll-lab/model/run';
import type { ScrollSnapshot, StickyInput } from '@/widgets/scroll-lab/model/types';

/**
 * Тема «Прокрутка изнутри».
 *
 * `STICKY_CODE` и `ANCHOR_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с Chromium из Playwright:
 *   — `stickyOffset` — с `getBoundingClientRect` липкого элемента (место в потоке — тот же
 *     замер с `position: static`) на примере темы и на 150 случайных раскладках;
 *   — `selectAnchor` — по последствиям, потому что спросить у страницы «кто якорь» нельзя.
 *     Перед каждым узлом дерева по очереди вставляется блок 100px; сдвиг `scrollTop` браузера
 *     обязан совпасть с тем, на сколько эта вставка сдвинула выбранный моделью якорь (замер
 *     с `overflow-anchor: none`, где браузер ничего не поправляет). Если модель сказала «якоря
 *     нет», сдвиг обязан быть нулём при любой вставке.
 * Все таблицы темы (`*_ROWS`) снимаются заново теми же страницами. Таймеры здесь — только
 * ожидание, что жест или плавная прокрутка доехали, а не замер времени.
 */

const sticky = loadSticky(t.STICKY_CODE);
const selectAnchor = loadAnchor(t.ANCHOR_CODE);

let browser: Browser;
let ctx: BrowserContext;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, hasTouch: true });
  page = await ctx.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

const open = (body: string, htmlStyle = '') =>
  page.setContent(`<!doctype html><html style="${htmlStyle}"><body style="margin:0">${body}</body></html>`);

const snap = (selector: string) =>
  page.evaluate(`(${SNAPSHOT_JS})(document.querySelector(${JSON.stringify(selector)}))`) as Promise<ScrollSnapshot>;

/** Детерминированный генератор (mulberry32): случайные раскладки одни и те же от прогона к прогону. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return Math.floor((((x ^ (x >>> 14)) >>> 0) / 4294967296) * n);
  };
}

// ─── Липкость ─────────────────────────────────────────────────────────────────────────────

/** Геометрия липкого `#el` в контейнере `#sc` — вход модели и ответ браузера. */
async function stickyProbe(st: number): Promise<{ input: StickyInput; real: number }> {
  return page.evaluate((st) => {
    const sc = document.getElementById('sc')!;
    const el = document.getElementById('el')!;
    sc.scrollTop = st;
    const base = sc.getBoundingClientRect().top + sc.clientTop - sc.scrollTop;
    const real = el.getBoundingClientRect().top - base;
    const was = el.style.position;
    el.style.position = 'static';
    const normal = el.getBoundingClientRect().top - base;
    el.style.position = was;
    const s = getComputedStyle(el);
    const scs = getComputedStyle(sc);
    const cb = el.parentElement!;
    const cs = getComputedStyle(cb);
    const r = cb.getBoundingClientRect();
    const px = (v: string) => parseFloat(v) || 0;
    return {
      real: real - normal,
      input: {
        scrollTop: sc.scrollTop,
        portHeight: sc.clientHeight,
        padTop: px(scs.paddingTop),
        padBottom: px(scs.paddingBottom),
        top: s.top === 'auto' ? null : px(s.top),
        bottom: s.bottom === 'auto' ? null : px(s.bottom),
        elTop: normal,
        elHeight: el.getBoundingClientRect().height,
        marginTop: px(s.marginTop),
        marginBottom: px(s.marginBottom),
        cbTop: r.top - base + px(cs.borderTopWidth) + px(cs.paddingTop),
        cbBottom: r.bottom - base - px(cs.borderBottomWidth) - px(cs.paddingBottom),
      },
    };
  }, st);
}

describe('stickyOffset против Chromium', () => {
  it('пример темы: STICKY_HTML даёт STICKY_ROWS, и модель считает то же', async () => {
    await open(t.STICKY_HTML.replace('class="feed"', 'id="sc"'));
    for (const row of t.STICKY_ROWS) {
      const got = await page.evaluate((st) => {
        const sc = document.getElementById('sc')!;
        sc.scrollTop = st;
        const top = sc.getBoundingClientRect().top;
        return [...sc.querySelectorAll('h2')].map((h) => Math.round(h.getBoundingClientRect().top - top));
      }, row.st);
      expect(got, `scrollTop ${row.st}`).toEqual([row.first, row.second]);

      // Те же числа — из модели, по геометрии из той же страницы.
      for (const [i, want] of [row.first, row.second].entries()) {
        const model = await page.evaluate(
          ([st, i]) => {
            const sc = document.getElementById('sc')!;
            sc.scrollTop = st;
            const h = sc.querySelectorAll('h2')[i] as HTMLElement;
            const base = sc.getBoundingClientRect().top - sc.scrollTop;
            const was = h.style.position;
            h.style.position = 'static';
            const normal = h.getBoundingClientRect().top - base;
            h.style.position = was;
            const r = h.parentElement!.getBoundingClientRect();
            return { st: sc.scrollTop, normal, cbTop: r.top - base, cbBottom: r.bottom - base, h: h.getBoundingClientRect().height };
          },
          [row.st, i] as const,
        );
        const off = sticky({
          scrollTop: model.st, portHeight: 300, padTop: 0, padBottom: 0, top: 0, bottom: null,
          elTop: model.normal, elHeight: model.h, marginTop: 0, marginBottom: 0, cbTop: model.cbTop, cbBottom: model.cbBottom,
        });
        expect(Math.round(model.normal + off - row.st), `модель, шапка ${i}, scrollTop ${row.st}`).toBe(want);
      }
    }
    // Подпись под таблицей: шапка 40px в секции 400px сдвигается не дальше 360.
    expect(t.STICKY_HTML).toContain('height: 400px');
    expect(t.STICKY_HTML).toContain('height: 40px');
  }, 60_000);

  it('150 случайных раскладок: padding контейнера и секции, поля, top и bottom вместе', async () => {
    const rnd = rng(7);
    let checked = 0;
    for (let k = 0; k < 150; k++) {
      const c = {
        port: [80, 150, 300][rnd(3)], padT: rnd(3) * 15, padB: rnd(3) * 15, before: rnd(400),
        secPadT: rnd(3) * 20, secPadB: rnd(3) * 20, secH: 50 + rnd(500), pre: rnd(200), h: 20 + rnd(60),
        mt: rnd(2) * 10, mb: rnd(2) * 10, top: [null, 0, 10, 35, 60][rnd(5)], bottom: [null, 0, 20, 50][rnd(4)],
      };
      if (c.top === null && c.bottom === null) c.top = 0;
      await open(
        `<div id=sc style="height:${c.port}px;overflow:auto;padding:${c.padT}px 0 ${c.padB}px"><div style="height:${c.before}px"></div>` +
          `<section style="padding:${c.secPadT}px 0 ${c.secPadB}px;height:${c.secH}px"><div style="height:${c.pre}px"></div>` +
          `<div id=el style="position:sticky;height:${c.h}px;margin:${c.mt}px 0 ${c.mb}px;${c.top !== null ? `top:${c.top}px;` : ''}${c.bottom !== null ? `bottom:${c.bottom}px;` : ''}"></div>` +
          `</section><div style="height:1200px"></div></div>`,
      );
      const { input, real } = await stickyProbe(rnd(900));
      expect(sticky(input), JSON.stringify({ c, input })).toBeCloseTo(real, 0);
      checked++;
    }
    expect(checked).toBe(150);
  }, 120_000);

  it('спор top и bottom: побеждает top; поле снизу уменьшает ход', async () => {
    await open(
      `<div id=sc style="height:100px;overflow:auto"><div style="height:150px"></div><section style="height:600px">` +
        `<div style="height:200px"></div><div id=el style="position:sticky;top:50px;bottom:40px;height:40px"></div></section><div style="height:900px"></div></div>`,
    );
    for (const st of [0, 250, 300, 700]) {
      const { input, real } = await stickyProbe(st);
      expect(sticky(input), `scrollTop ${st}`).toBeCloseTo(real, 0);
    }
    // scrollTop 250: bottom тянет вверх (на 270), top держит на 300 — и браузер ставит 300.
    const { input } = await stickyProbe(250);
    expect(input.elTop + sticky(input)).toBe(300);

    await open(
      `<div id=sc style="height:300px;overflow:auto"><section style="height:200px;display:flow-root">` +
        `<div id=el style="position:sticky;top:0;height:40px;margin-bottom:30px"></div></section><div style="height:900px"></div></div>`,
    );
    const r = await stickyProbe(170);
    expect(r.input.elTop + r.real).toBe(130); // без поля было бы 160
    expect(sticky(r.input)).toBeCloseTo(r.real, 0);
  }, 30_000);
});

describe('ближайший контейнер прокрутки: SCROLLER_ROWS, HIDDEN_SCROLL_NOTE, FIND_SCROLLER_CODE', () => {
  const find = `(${t.FIND_SCROLLER_CODE.replace(/^\/\/.*\n/, '')})`;
  const head = (id = 'h') => `<h2 id=${id} style="position:sticky;top:0;height:40px;margin:0">h</h2>`;

  it('overflow: hidden между шапкой и рамкой — шапка уезжает; clip — липнет', async () => {
    for (const [ov, want] of [['hidden', -100], ['clip', 0]] as const) {
      await open(`<div id=sc style="height:300px;overflow:auto"><div id=mid style="overflow:${ov}"><section style="height:400px">${head()}</section></div><div style="height:600px"></div></div>`);
      const got = await page.evaluate(() => {
        const sc = document.getElementById('sc')!;
        sc.scrollTop = 100;
        return Math.round(document.getElementById('h')!.getBoundingClientRect().top - sc.getBoundingClientRect().top);
      });
      expect(got, ov).toBe(want);
      const holder = await page.evaluate((f) => (new Function(`return ${f}`)() as (el: Element) => Element)(document.getElementById('h')!).id, find);
      expect(holder, ov).toBe(ov === 'hidden' ? 'mid' : 'sc');
    }
    expect(t.SCROLLER_ROWS[0].got).toContain('−100');
  }, 30_000);

  it('overflow-x: hidden делает overflow-y auto — шапка липнет к обёртке', async () => {
    await open(`<div id=w style="overflow-x:hidden"><div style="height:50px"></div>${head('s')}<div style="height:3000px"></div></div>`);
    const r = await page.evaluate((f) => {
      scrollTo(0, 800);
      const s = document.getElementById('s')!;
      const holder = (new Function(`return ${f}`)() as (el: Element) => Element)(s);
      return { top: Math.round(s.getBoundingClientRect().top), oy: getComputedStyle(document.getElementById('w')!).overflowY, holder: holder.id };
    }, find);
    expect(r).toEqual({ top: -750, oy: 'auto', holder: 'w' });
  });

  it('сетка: растянутое меню не липнет, с align-self: start — липнет', async () => {
    const res: Record<string, [number, number]> = {};
    for (const align of ['stretch', 'start']) {
      await open(`<div style="display:grid;grid-template-columns:200px 1fr;align-items:${align}"><aside id=s style="position:sticky;top:0">меню</aside><main style="height:3000px"></main></div>`);
      res[align] = await page.evaluate(() => {
        scrollTo(0, 800);
        const r = document.getElementById('s')!.getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.height)] as [number, number];
      });
    }
    expect(res.stretch).toEqual([-800, 3000]);
    expect(res.start[0]).toBe(0);
    expect(t.SCROLLER_ROWS[3].got).toContain('3000px');
  });

  it('padding рамки: шапка держится у его края', async () => {
    await open(`<div id=sc style="height:300px;overflow:auto;padding-top:20px"><section style="height:400px">${head()}</section><div style="height:600px"></div></div>`);
    const got = await page.evaluate(() => {
      const sc = document.getElementById('sc')!;
      return [0, 100].map((st) => {
        sc.scrollTop = st;
        return Math.round(document.getElementById('h')!.getBoundingClientRect().top - sc.getBoundingClientRect().top);
      });
    });
    expect(got).toEqual([20, 20]);
  });

  it('overflow: hidden прокручивается присваиванием, overflow: clip — нет', async () => {
    await open(`<div id=h style="overflow:hidden;height:100px"><div style="height:500px"></div></div><div id=c style="overflow:clip;height:100px"><div style="height:500px"></div></div>`);
    const got = await page.evaluate(() => {
      const h = document.getElementById('h')!;
      const c = document.getElementById('c')!;
      h.scrollTop = 100;
      c.scrollTop = 100;
      return [h.scrollTop, c.scrollTop];
    });
    expect(got).toEqual([100, 0]);
    expect(t.HIDDEN_SCROLL_NOTE).toContain('`scrollTop = 100` прокрутил его на 100');
  });
});

// ─── Якорь ────────────────────────────────────────────────────────────────────────────────

/**
 * Вставка блока 100px перед `#id` при прокрутке `st`. Режим `auto` — сдвиг прокрутки
 * браузером; режим `none` — на сколько сдвинулся узел `anchorId` (браузер не поправляет).
 */
async function insertBefore(html: string, scStyle: string, st: number, id: string, mode: 'auto' | 'none', anchorId: string | null) {
  await open(`<div style="height:40px"></div><div id=sc style="height:300px;overflow:auto;${scStyle}">${html}</div>`);
  return page.evaluate(
    ([st, id, mode, aid]) => {
      const sc = document.getElementById('sc')!;
      if (mode === 'none') sc.style.overflowAnchor = 'none';
      sc.scrollTop = st;
      void sc.offsetHeight;
      const before = sc.scrollTop;
      const a = aid ? document.getElementById(aid) : null;
      const y0 = a ? a.getBoundingClientRect().top : 0;
      const block = document.createElement('div');
      block.style.height = '100px';
      const ref = document.getElementById(id)!;
      ref.parentNode!.insertBefore(block, ref);
      const shift = sc.scrollTop - before;
      return mode === 'none' ? (a ? a.getBoundingClientRect().top - y0 : 0) : shift;
    },
    [st, id, mode, anchorId] as const,
  );
}

/** Модель против браузера на одном дереве: вставка перед каждым узлом по очереди. */
async function checkAnchor(html: string, scStyle: string, st: number) {
  await open(`<div style="height:40px"></div><div id=sc style="height:300px;overflow:auto;${scStyle}">${html}</div>`);
  const s = await page.evaluate(
    ([st, js]) => {
      const sc = document.getElementById('sc')!;
      sc.scrollTop = st;
      return (new Function(`return (${js})`)() as (el: Element) => unknown)(sc);
    },
    [st, SNAPSHOT_JS] as const,
  );
  const anchor = selectAnchor(s as ScrollSnapshot);
  const ids = [...html.matchAll(/id=["]?([\w-]+)/g)].map((m) => m[1]);
  for (const id of ids) {
    const browserShift = await insertBefore(html, scStyle, st, id, 'auto', null);
    const anchorMoved = await insertBefore(html, scStyle, st, id, 'none', anchor?.id ?? null);
    expect(browserShift, `якорь ${anchor?.id ?? 'нет'}, вставка перед ${id}, scrollTop ${st}, ${scStyle}\n${html}`).toBe(anchorMoved);
  }
  return anchor;
}

const rows = (n: number, style: (i: number) => string = () => '') =>
  Array.from({ length: n }, (_, i) => `<div id=r${i} style="height:50px;${style(i)}"></div>`).join('');

describe('selectAnchor против Chromium', () => {
  /** Каждая строка ANCHOR_ROWS — своя разметка; порядок тот же. */
  const cases: { html: string; sc: string; st: number; anchor: string | null }[] = [
    { html: rows(20), sc: '', st: 250, anchor: 'r5' },
    { html: rows(20), sc: '', st: 225, anchor: 'r4' },
    { html: rows(20), sc: '', st: 0, anchor: null },
    { html: rows(20), sc: 'overflow-anchor:none', st: 250, anchor: null },
    { html: rows(20, (i) => (i === 5 ? 'overflow-anchor:none' : '')), sc: '', st: 250, anchor: 'r6' },
    { html: rows(20, (i) => (i === 5 ? 'height:0' : '')), sc: '', st: 250, anchor: 'r6' },
    { html: rows(20), sc: 'scroll-padding-top:100px', st: 250, anchor: 'r7' },
    { html: `<div id=hd style="position:sticky;top:0;height:30px"></div>${rows(20)}`, sc: '', st: 250, anchor: 'r4' },
  ];

  it('ANCHOR_ROWS: якорь модели, сдвиг браузера и совпадение на каждой вставке', async () => {
    expect(cases).toHaveLength(t.ANCHOR_ROWS.length);
    for (const [i, c] of cases.entries()) {
      const anchor = await checkAnchor(c.html, c.sc, c.st);
      expect(anchor?.id ?? null, t.ANCHOR_ROWS[i].k).toBe(c.anchor);
      const first = c.html.match(/id=["]?([\w-]+)/)![1];
      // Сдвиг из таблицы — вставка перед первым узлом ленты (над всем).
      expect(await insertBefore(c.html, c.sc, c.st, first === 'hd' ? 'r0' : first, 'auto', null), t.ANCHOR_ROWS[i].k).toBe(t.ANCHOR_ROWS[i].shift);
      if (c.anchor) expect(t.ANCHOR_ROWS[i].anchor).toContain(`\`${c.anchor}\``);
    }
    // ANCHOR_ROWS_NOTE: при прокрутке 225 вставка перед r5 прокрутку не двигает.
    expect(await insertBefore(rows(20), '', 225, 'r5', 'auto', null)).toBe(0);
    expect(t.ANCHOR_ROWS_NOTE).toContain('перед `r5` при прокрутке 225');
  }, 180_000);

  it('25 случайных деревьев: sticky, absolute, relative со сдвигом, пустые блоки, scroll-padding', async () => {
    const rnd = rng(11);
    const kinds = { anchor: 0, none: 0 };
    for (let k = 0; k < 25; k++) {
      let n = 0;
      const gen = (depth: number): string => {
        let out = '';
        for (let i = 1 + rnd(4); i > 0; i--) {
          const id = `e${n++}`;
          const r = rnd(20);
          let style = '';
          if (r === 0) style = 'overflow-anchor:none;';
          else if (r === 1) style = 'position:sticky;top:0;';
          else if (r === 2) style = `position:absolute;top:${rnd(600)}px;width:20px;`;
          else if (r === 3) style = `position:relative;top:${rnd(200) - 100}px;`;
          else if (r === 4) style = 'height:0;';
          if (depth < 3 && r !== 4 && rnd(3) === 0) out += `<div id=${id} style="${style}">${gen(depth + 1)}</div>`;
          else out += `<div id=${id} style="height:${r === 4 ? 0 : 20 + rnd(160)}px;${style}"></div>`;
        }
        return out;
      };
      const html = gen(0) + gen(1) + '<div id=tail style="height:900px"></div>';
      const sc = `${rnd(2) ? 'position:relative;' : ''}${rnd(3) === 0 ? `scroll-padding-top:${rnd(120)}px;` : ''}${rnd(4) === 0 ? `scroll-padding-bottom:${rnd(120)}px;` : ''}`;
      await open(`<div style="height:40px"></div><div id=sc style="height:300px;overflow:auto;${sc}">${html}</div>`);
      const max = await page.evaluate(() => {
        const el = document.getElementById('sc')!;
        return el.scrollHeight - el.clientHeight;
      });
      const st = rnd(5) === 0 ? 0 : 1 + rnd(max - 1);
      const anchor = await checkAnchor(html, sc, st);
      kinds[anchor ? 'anchor' : 'none']++;
    }
    // Оба исхода встретились, иначе проверка однобока.
    expect(kinds.anchor).toBeGreaterThan(10);
    expect(kinds.none).toBeGreaterThan(0);
  }, 300_000);

  it('SUPPRESS_ROWS: изменения у якоря и его предков отменяют поправку', async () => {
    const codes = [
      '',
      'wrap.style.position = "relative"',
      'wrap.style.top = "1px"',
      'wrap.style.transform = "translateY(0px)"',
      'wrap.style.minHeight = "10px"; wrap.style.paddingTop = "1px"',
      'document.getElementById("j10").style.height = "60px"',
      'document.getElementById("j15").style.height = "60px"',
    ];
    expect(codes).toHaveLength(t.SUPPRESS_ROWS.length);
    for (const [i, code] of codes.entries()) {
      const wrapStyle = i === 2 ? 'position:relative' : '';
      await open(`<div id=sc style="height:300px;overflow:auto">${rows(4)}<div id=wrap style="${wrapStyle}">${rows(20).replaceAll('id=r', 'id=j')}</div></div>`);
      const shift = await page.evaluate((code) => {
        const sc = document.getElementById('sc')!;
        sc.scrollTop = 700;
        void sc.offsetHeight;
        const before = sc.scrollTop;
        document.getElementById('r0')!.style.height = '150px';
        new Function('wrap', code)(document.getElementById('wrap'));
        return sc.scrollTop - before;
      }, code);
      expect(shift, t.SUPPRESS_ROWS[i].k).toBe(t.SUPPRESS_ROWS[i].shift);
    }
    // Отдельно: margin-top у самого якоря и padding-top у обёртки — каждое само по себе.
    for (const code of ['document.getElementById("j10").style.marginTop = "1px"', 'wrap.style.paddingTop = "1px"']) {
      await open(`<div id=sc style="height:300px;overflow:auto">${rows(4)}<div id=wrap>${rows(20).replaceAll('id=r', 'id=j')}</div></div>`);
      const shift = await page.evaluate((code) => {
        const sc = document.getElementById('sc')!;
        sc.scrollTop = 700;
        void sc.offsetHeight;
        const before = sc.scrollTop;
        document.getElementById('r0')!.style.height = '150px';
        new Function('wrap', code)(document.getElementById('wrap'));
        return sc.scrollTop - before;
      }, code);
      expect(shift, code).toBe(0);
    }
    // Якорь в этом опыте — j10: модель выбирает его по той же разметке.
    await open(`<div id=sc style="height:300px;overflow:auto">${rows(4)}<div id=wrap>${rows(20).replaceAll('id=r', 'id=j')}</div></div>`);
    await page.evaluate(() => (document.getElementById('sc')!.scrollTop = 700));
    expect(selectAnchor(await snap('#sc'))?.id).toBe('j10');
  }, 60_000);

  it('лента демо: с auto якорь держит место, с none и в нуле всё уезжает вниз', async () => {
    const feed = (groups: typeof t.DEMO_FEED) =>
      groups
        .map((g) => `<section data-sid=${g.id}><div data-sid=${g.id}-h style="position:sticky;top:0;height:34px">${g.day}</div>${g.msgs.map((m, i) => `<div data-sid=${g.id}-${i + 1} style="margin:8px 12px;padding:8px 12px">${m}</div>`).join('')}</section>`)
        .join('');
    for (const [mode, at] of [['auto', 'bottom'], ['none', 'bottom'], ['auto', 'top']] as const) {
      await open(`<div id=sc style="width:400px;height:300px;overflow:auto;overflow-anchor:${mode}">${feed(t.DEMO_FEED)}</div>`);
      await page.evaluate((at) => {
        const sc = document.getElementById('sc')!;
        sc.scrollTop = at === 'top' ? 0 : sc.scrollHeight;
      }, at);
      const s = await snap('#sc');
      const log: [string, string][] = [];
      const anchor = selectAnchor(s, log);
      const r = await page.evaluate(
        ([html, sid]) => {
          const sc = document.getElementById('sc')!;
          const st0 = sc.scrollTop;
          const h0 = sc.scrollHeight;
          const a = sid ? sc.querySelector(`[data-sid="${sid}"]`) : null;
          const y0 = a ? a.getBoundingClientRect().top : 0;
          sc.insertAdjacentHTML('afterbegin', html);
          return { shift: sc.scrollTop - st0, added: sc.scrollHeight - h0, moved: a ? a.getBoundingClientRect().top - y0 : null };
        },
        [feed(t.DEMO_OLDER.slice(0, 1)), anchor ? anchor.id.replace(' · текст', '') : null] as const,
      );
      expect(r.added).toBeGreaterThan(100);
      if (mode === 'auto' && at === 'bottom') {
        expect(anchor, 'якорь у ленты, прокрученной вниз').not.toBeNull();
        expect(r.shift).toBe(r.added);
        expect(Math.abs(r.moved!)).toBeLessThan(1);
        // Липкие шапки якорем не бывают — журнал говорит «исключён».
        expect(log.some(([id, v]) => id.endsWith('-h') && v.startsWith('исключён: position: sticky'))).toBe(true);
      } else {
        expect(r.shift, `${mode}, ${at}`).toBe(0);
      }
      if (at === 'top') expect(anchor).toBeNull();
    }
    expect(t.DEMO_CAPTION).toContain('В самом верху ленты якоря нет');
  }, 60_000);
});

// ─── Жесты, цепочка, snap, события ────────────────────────────────────────────────────────

describe('touch-action, цепочка и упор', () => {
  it('TOUCH_ROWS: касание вниз и вправо', async () => {
    const cdp = await ctx.newCDPSession(page);
    for (const row of t.TOUCH_ROWS) {
      await open(`<div id=box style="height:300px;width:300px;overflow:auto;touch-action:${row.css}"><div style="height:1200px;width:1200px"></div></div>`);
      await cdp.send('Input.synthesizeScrollGesture', { x: 150, y: 150, yDistance: -200, gestureSourceType: 'touch', speed: 2000 });
      await cdp.send('Input.synthesizeScrollGesture', { x: 150, y: 150, xDistance: -200, gestureSourceType: 'touch', speed: 2000 });
      await page.waitForTimeout(300);
      const [down, right] = await page.evaluate(() => {
        const b = document.getElementById('box')!;
        return [b.scrollTop, b.scrollLeft];
      });
      expect([down > 0, right > 0], row.css).toEqual([row.down, row.right]);
    }
    await cdp.detach();
  }, 60_000);

  it('CHAIN_ROWS: колесо и палец над упёршимся блоком', async () => {
    const cdp = await ctx.newCDPSession(page);
    for (const row of t.CHAIN_ROWS) {
      for (const src of ['wheel', 'touch'] as const) {
        await open(`<div style="height:3000px"><div id=box style="margin-top:100px;height:300px;overflow:auto;overscroll-behavior:${row.css}"><div style="height:600px"></div></div></div>`);
        await page.evaluate(() => {
          scrollTo(0, 0);
          document.getElementById('box')!.scrollTop = 300;
        });
        if (src === 'wheel') {
          await page.mouse.move(100, 250);
          await page.mouse.wheel(0, 200);
        } else {
          await cdp.send('Input.synthesizeScrollGesture', { x: 100, y: 250, yDistance: -200, gestureSourceType: 'touch', speed: 2000 });
        }
        await page.waitForTimeout(500);
        const [box, y] = await page.evaluate(() => [document.getElementById('box')!.scrollTop, scrollY]);
        expect(box).toBe(300);
        if (src === 'wheel') expect(y, `${row.css}, колесо`).toBe(row.wheel);
        else expect(y > 0, `${row.css}, палец`).toBe(row.touch === 'прокрутилась');
      }
    }
    await cdp.detach();
  }, 60_000);

  it('LATCH: жест не переходит на страницу посреди себя', async () => {
    await open(`<div style="height:3000px"><div id=box style="margin-top:100px;height:300px;overflow:auto"><div style="height:600px"></div></div></div>`);
    await page.evaluate((y) => {
      scrollTo(0, 0);
      document.getElementById('box')!.scrollTop = y;
    }, t.LATCH.boxBefore);
    await page.mouse.move(100, 250);
    const read = () => page.evaluate(() => ({ box: document.getElementById('box')!.scrollTop, page: scrollY }));
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500);
    expect(await read()).toEqual(t.LATCH.first);
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500);
    expect(await read()).toEqual(t.LATCH.second);
    expect(t.LATCH.boxEnd - t.LATCH.boxBefore).toBe(50);
  }, 30_000);
});

describe('scroll snap и scrollend', () => {
  const carousel = (type: string) =>
    `<div id=box style="height:300px;overflow:auto;scroll-snap-type:${type}">${[0, 1, 2, 3, 4].map((i) => `<div id=s${i} style="height:300px;scroll-snap-align:start">${i}</div>`).join('')}</div>`;

  /** Ждём `scrollend` (или паузу, если прокрутки не будет) и читаем журнал. */
  async function settle() {
    await page.waitForFunction(() => (window as unknown as { log: { scrollend: number } }).log.scrollend > 0, null, { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(150);
    return page.evaluate(() => ({ top: document.getElementById('box')!.scrollTop, ...(window as unknown as { log: object }).log }) as { top: number; scroll: number; scrollend: number; change: (string | null)[] });
  }
  const arm = () =>
    page.evaluate(() => {
      const w = window as unknown as { log: { scroll: number; scrollend: number; change: (string | null)[] } };
      w.log = { scroll: 0, scrollend: 0, change: [] };
      const b = document.getElementById('box')!;
      b.onscroll = () => w.log.scroll++;
      b.onscrollend = () => w.log.scrollend++;
      // Свойство, а не addEventListener: arm() зовётся дважды на одной странице.
      (b as unknown as { onscrollsnapchange: (e: Event & { snapTargetBlock: Element | null }) => void }).onscrollsnapchange = (e) =>
        w.log.change.push(e.snapTargetBlock?.id ?? null);
    });

  it('SNAP_ROWS: колесо на 100px и scrollTo(760) в трёх режимах', async () => {
    expect(await page.evaluate(() => 'onscrollsnapchange' in window && 'onscrollsnapchanging' in window && 'onscrollend' in window)).toBe(true);
    const types = ['y mandatory', 'y proximity', 'none'];
    for (const [i, row] of t.SNAP_ROWS.entries()) {
      await open(carousel(types[i]));
      await arm();
      await page.mouse.move(100, 150);
      await page.mouse.wheel(0, 100);
      const w = await settle();
      expect(String(w.top), row.type).toBe(row.wheel.split(' ')[0]);
      expect(w.scrollend).toBe(1);
      if (i === 0) {
        // SCROLLEND_ROWS: доводка — несколько кадров `scroll` и один `scrollend`.
        expect(w.scroll).toBeGreaterThan(1);
      }

      await arm();
      await page.evaluate(() => document.getElementById('box')!.scrollTo({ top: 760 }));
      const s = await settle();
      expect(String(s.top), row.type).toBe(row.to760.split(' ')[0]);
      const want = row.change === 'нет события' ? [] : [row.change === '`null`' ? null : row.change.replaceAll('`', '')];
      expect(s.change, row.type).toEqual(want);
    }
    expect(t.SNAP_HTML).toContain('scroll-snap-type: y mandatory');
  }, 60_000);

  it('SCROLLEND_ROWS: присваивание, то же значение, плавная прокрутка', async () => {
    await open(`<div id=box style="height:300px;overflow:auto"><div style="height:3000px"></div></div>`);
    const run = (code: string) =>
      page.evaluate(async (code) => {
        const b = document.getElementById('box')!;
        let scroll = 0;
        let end = 0;
        b.onscroll = () => scroll++;
        b.onscrollend = () => end++;
        new Function('box', code)(b);
        // Ждём конца: scrollend либо три кадра без событий.
        for (let quiet = 0, last = -1; quiet < 3 || (scroll > 0 && end === 0); ) {
          await new Promise((r) => requestAnimationFrame(r));
          quiet = scroll === last ? quiet + 1 : 0;
          last = scroll;
        }
        return { scroll, end, top: b.scrollTop };
      }, code);
    const a = await run(t.SCROLLEND_ROWS[0].k.replaceAll('`', ''));
    expect(a).toEqual({ scroll: 1, end: 1, top: 500 });
    const same = await run(t.SCROLLEND_ROWS[0].k.replaceAll('`', ''));
    expect(same).toEqual({ scroll: 0, end: 0, top: 500 });
    const smooth = await run(t.SCROLLEND_ROWS[2].k.replaceAll('`', ''));
    expect(smooth.top).toBe(1500);
    expect(smooth.end).toBe(1);
    expect(smooth.scroll).toBeGreaterThan(5);
    expect(t.SCROLLEND_ROWS.map((r) => r.scrollend)).toEqual([1, 0, 1, 1]);
  }, 30_000);
});

describe('цель под липкой шапкой: INTO_VIEW_ROWS', () => {
  const doc = (htmlStyle: string, tgt: string) =>
    open(`<header style="position:sticky;top:0;height:60px;background:#ccc">шапка</header><div style="height:1500px"></div><h2 id=t style="margin:0;height:40px;${tgt}">цель</h2><div style="height:1500px"></div>`, htmlStyle);
  const setups: [string, string][] = [
    ['', ''],
    ['scroll-padding-top:60px', ''],
    ['scroll-padding-top:60px', 'scroll-margin-top:16px'],
    ['', 'scroll-margin-top:76px'],
  ];

  it('scrollIntoView и переход по #t дают одно и то же', async () => {
    expect(setups).toHaveLength(t.INTO_VIEW_ROWS.length);
    for (const [i, [h, tg]] of setups.entries()) {
      const row = t.INTO_VIEW_ROWS[i];
      await page.goto('about:blank');
      await doc(h, tg);
      const v = await page.evaluate(() => {
        const el = document.getElementById('t')!;
        el.scrollIntoView();
        const top = el.getBoundingClientRect().top;
        return { top, hit: document.elementFromPoint(10, top + 5)!.tagName };
      });
      expect(v.top, row.k).toBe(row.top);
      expect(v.hit === 'HEADER', row.k).toBe(row.tone === 'err');
      const viaHash = await page.evaluate(async () => {
        scrollTo(0, 0);
        location.hash = '#t';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return document.getElementById('t')!.getBoundingClientRect().top;
      });
      expect(viaHash, `#t: ${row.k}`).toBe(row.top);
    }
  }, 30_000);

  it('focus() ставит цель в середину окна под шапкой: 280 и 310', async () => {
    const got: number[] = [];
    for (const h of ['', 'scroll-padding-top:60px']) {
      await doc(h, '');
      got.push(
        await page.evaluate(() => {
          scrollTo(0, 0);
          const el = document.getElementById('t')!;
          el.tabIndex = -1;
          el.focus();
          return el.getBoundingClientRect().top;
        }),
      );
    }
    expect(got).toEqual([280, 310]);
    expect(t.INTO_VIEW_NOTE).toContain('на 280 без него и на 310 с ним');
  });
});

describe('scrollbar-gutter: GUTTER_ROWS', () => {
  it('ширина для содержимого с полосой 12px и без флага --hide-scrollbars', async () => {
    const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      const p = await b.newPage();
      const box = (css: string, h: number) => `<div class=c style="${css.replaceAll('`', '')}"><div style="height:${h}px"></div></div>`;
      await p.setContent(
        `<style>.c{width:200px;height:100px}.c::-webkit-scrollbar{width:12px;background:#eee}.c::-webkit-scrollbar-thumb{background:#888}</style>` +
          t.GUTTER_ROWS.map((r) => box(r.k, 50) + box(r.k, 500)).join(''),
      );
      const widths = await p.evaluate(() => [...document.querySelectorAll('.c')].map((d) => d.clientWidth));
      expect(widths).toEqual(t.GUTTER_ROWS.flatMap((r) => [r.short, r.long]));

      // Системная полоса на стенде — наложение: места не занимает (GUTTER_FACTS, «На Mac»).
      await p.setContent('<div id=d style="overflow:scroll;width:100px;height:100px"></div>');
      const sys = await p.evaluate(() => {
        const d = document.getElementById('d')!;
        return d.offsetWidth - d.clientWidth;
      });
      if (process.platform === 'darwin') expect(sys).toBe(0);
    } finally {
      await b.close();
    }
  }, 60_000);
});

describe('возврат на место: RESTORE_ROWS', () => {
  it('auto, manual, рост до load и после load', async () => {
    const pageA = (extra: string, h: number) =>
      `<!doctype html><body style="margin:0"><div id=list style="height:${h}px">a</div><a href="/b">b</a>${extra}` +
      `<script>addEventListener('pageshow', (e) => { window.persisted = e.persisted; });</script></body>`;
    const routes: Record<string, string> = {
      '/auto': pageA('', 4000),
      '/manual': pageA(`<script>history.scrollRestoration = 'manual'</script>`, 4000),
      '/early': pageA(`<img src="/slow.png"><script>setTimeout(() => { document.getElementById('list').style.height = '4000px'; }, 200);</script>`, 100),
      '/late': pageA(`<script>addEventListener('load', () => setTimeout(() => { document.getElementById('list').style.height = '4000px'; window.grown = true; }, 300));</script>`, 100),
      '/b': '<!doctype html><body style="margin:0;height:4000px">b</body>',
    };
    const server = http.createServer((req, res) => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      res.setHeader('cache-control', 'no-store');
      if (path === '/slow.png') {
        setTimeout(() => res.end(), 600);
        return;
      }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(routes[path] ?? '');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const got: number[] = [];
      for (const path of ['/auto', '/manual', '/early', '/late']) {
        const c = await browser.newContext({ viewport: { width: 800, height: 600 } });
        const p = await c.newPage();
        await p.goto(origin + path);
        await p.evaluate(() => {
          document.getElementById('list')!.style.height = '4000px';
          scrollTo(0, 1500);
        });
        await p.evaluate(() => (location.href = '/b'));
        await p.waitForURL('**/b');
        await p.goBack();
        if (path === '/late') await p.waitForFunction(() => (window as unknown as { grown?: boolean }).grown === true);
        else await p.waitForLoadState('load');
        await p.waitForTimeout(100);
        const r = await p.evaluate(() => ({ y: scrollY, persisted: (window as unknown as { persisted: boolean }).persisted }));
        // Кеш «назад-вперёд» в этом прогоне не участвует: позицию ставит браузер при загрузке.
        expect(r.persisted, path).toBe(false);
        got.push(r.y);
        await c.close();
      }
      expect(got).toEqual(t.RESTORE_ROWS.map((r) => r.y));
    } finally {
      server.close();
    }
  }, 60_000);
});

describe('тексты темы называют то же, что сняли', () => {
  it('ссылки «Где разобрано» и «Смежное» ведут в разделы, которые есть в nav', async () => {
    const { readFileSync } = await import('node:fs');
    const links = [...t.PREREQ.map((p) => p.href ?? ''), t.RELATED, t.STACK_NOTE, t.VLIST_NOTE, ...t.RESTORE_FACTS.map((f) => f.d)]
      .join(' ')
      .matchAll(/\/(render|frameworks|platform)\/([\w-]+)\/#(s\d+)/g);
    let n = 0;
    for (const [, col, slug, id] of links) {
      const mdx = readFileSync(new URL(`../../src/content/${col}/${slug}/index.mdx`, import.meta.url), 'utf8');
      expect(mdx, `${col}/${slug}#${id}`).toMatch(new RegExp(`id: ${id},`));
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});
