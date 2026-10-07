import { readFileSync } from 'node:fs';
import { type Browser, type BrowserContext, chromium, devices, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/responsive/data';
import { loadResolve } from '@/widgets/responsive-lab/model/run';
import type { Box, Env } from '@/widgets/responsive-lab/model/types';

/**
 * Тема «Адаптивность изнутри».
 *
 * `RESOLVE_CODE` — строка из темы: напечатана на странице и считает демо. Здесь она сверяется
 * с Chromium: та же разметка и тот же CSS ставятся в страницу, окно меняется
 * `setViewportSize`, итог читается `getComputedStyle`. Литералы стенда (таблицы вьюпорта,
 * щипка, полосы, `em`, контейнеров, масштаба) снимаются заново тем же способом, что в шапке
 * `data.ts`: сменится поведение браузера — покраснеет здесь, а не останется неправдой на странице.
 */

const resolve = loadResolve(t.RESOLVE_CODE);

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** Контекст с заданным шрифтом браузера (настройка «Размер шрифта» — через CDP). */
async function openWithFont(initialFont: number, viewport = { width: 800, height: 700 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: initialFont } });
  return { ctx, page };
}

/** Страница: `html` со своим шрифтом, цепочка контейнеров, внутри — по элементу на класс. */
function pageHtml(env: Env, css: string, classes: string[], containerTags?: string[]) {
  const boxes = env.containers
    .map((c, i) => `.k${i}{container: ${c.name} / inline-size; width:${c.width}px; font-size:${c.font}px}`)
    .join('\n');
  const tags = containerTags ?? env.containers.map((_, i) => `k${i}`);
  return `<!doctype html><style>${env.rootFont !== env.initialFont ? `html{font-size:${env.rootFont}px}` : ''}
body{margin:0} ${classes.map((c) => `.${c}`).join(',')}{display:block}
${boxes}
${css}</style><body>${tags.map((k) => `<div class="${k}">`).join('')}${classes.map((c) => `<div class="${c}"></div>`).join('')}`;
}

const LENGTHS = ['font-size', 'padding-left', 'margin-left', 'letter-spacing', 'width', 'gap', 'padding'];

async function readComputed(page: Page, classes: string[]) {
  return page.evaluate(
    ({ classes, props }) =>
      Object.fromEntries(
        classes.map((c) => {
          const s = getComputedStyle(document.querySelector('.' + c)!);
          return [c, Object.fromEntries([...props, 'display', 'flex-direction'].map((p) => [p, s.getPropertyValue(p)]))];
        }),
      ),
    { classes, props: LENGTHS },
  );
}

/** Сравнить модель с Chromium; вернуть число сверок и список расхождений. */
function compare(env: Env, css: string, real: Record<string, Record<string, string>>, classes: string[]) {
  const model = resolve(env, css);
  const bad: string[] = [];
  let n = 0;
  const parentFont = env.containers.at(-1)?.font ?? env.rootFont;
  for (const c of classes) {
    const el = model.elements['.' + c] ?? {};
    const font = el['font-size']?.px ?? parentFont;
    n++;
    if (Math.abs(font - parseFloat(real[c]['font-size'])) > 0.02) bad.push(`${c} font-size ${font} ≠ ${real[c]['font-size']}`);
    for (const [prop, d] of Object.entries(el)) {
      if (prop === 'font-size' || d.text === 'auto') continue; // auto вычисляется в пиксели раскладкой
      n++;
      const got = real[c][prop];
      if (d.px !== undefined) {
        if (Math.abs(d.px - parseFloat(got)) > 0.02) bad.push(`${c} ${prop}: ${d.text} → ${d.px} ≠ ${got}`);
      } else if (d.text !== got) {
        bad.push(`${c} ${prop}: ${d.text} ≠ ${got}`);
      }
    }
  }
  return { n, bad };
}

const WIDTHS = [320, 360, 390, 412, 480, 560, 600, 639, 640, 700, 768, 800, 880, 960, 1024, 1100, 1280, 1440];

describe('RESOLVE_CODE против Chromium', () => {
  it('карточка CARD_CSS: окно × место × шрифты из демо', async () => {
    const classes = ['card', 'thumb', 'title', 'meta'];
    let total = 0;
    const bad: string[] = [];
    for (const f of t.FONT_CHOICES) {
      const { ctx, page } = await openWithFont(f.initial);
      for (const slot of [160, 240, 320, 399, 400, 480, 560, 639, 640, 800, 1000]) {
        const env: Env = {
          viewport: { width: 800, height: 700 },
          initialFont: f.initial,
          rootFont: f.root,
          containers: [{ name: 'slot', width: slot, font: f.root }],
        };
        // контейнер — сам `.slot` из CARD_CSS; ширина и шрифт задаются отдельным правилом
        const css = `${t.CARD_CSS}\n.slot{width:${slot}px}`;
        const html = pageHtml({ ...env, containers: [] }, css, classes, ['slot']);
        await page.setContent(html);
        for (const w of WIDTHS) {
          await page.setViewportSize({ width: w, height: 700 });
          env.viewport.width = w;
          const r = compare(env, t.CARD_CSS, await readComputed(page, classes), classes);
          total += r.n;
          bad.push(...r.bad.map((b) => `${f.value} slot ${slot} w ${w}: ${b}`));
        }
      }
      await ctx.close();
    }
    expect(bad).toEqual([]);
    expect(total).toBeGreaterThan(2000);
  }, 120_000);

  it('случайные наборы @media и @container: px/em/rem, диапазоны, имена, clamp и единицы', async () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const len = () => pick(['8px', '12px', '1em', '1.5rem', '2vw', '3cqi', '5cqw', '10vh', '2vmin', '4cqb', '3cqmin', '0.5em', '1vmax']);
    const thr = () => pick(['360px', '480px', '600px', '40em', '30rem', '52em', '700px', '25em']);
    const values = [
      () => len(),
      () => `clamp(${pick(['8px', '1rem', '0.75em'])}, ${pick(['0.5rem + 2vw', '1em + 1cqi', '4cqi', '3vw - 4px', 'calc(2vw + 2cqi)'])}, ${pick(['2rem', '40px', '3em', '1.5rem'])})`,
      () => `min(${len()}, ${len()})`,
      () => `max(${len()}, ${len()})`,
      () => `calc(${len()} * 2 + ${len()})`,
      () => `calc((${len()} + ${len()}) / 2)`,
    ];
    const conds = [
      () => `@media (min-width: ${thr()})`,
      () => `@media (max-width: ${thr()})`,
      () => `@media (width >= ${thr()})`,
      () => `@media (${thr()} <= width < ${pick(['900px', '64em', '1100px'])})`,
      () => `@media screen and (width > ${thr()}) and (orientation: ${pick(['portrait', 'landscape'])})`,
      () => `@media not (width < ${thr()})`,
      () => `@media (width < ${thr()}) or (height < 500px)`,
      () => `@container (width > ${thr()})`,
      () => `@container outer (inline-size >= ${thr()})`,
      () => `@container inner (min-width: ${thr()})`,
      () => `@container ghost (width > 1px)`,
      () => `@container (${pick(['200px', '15em'])} < width <= ${thr()})`,
      () => null,
    ];
    const randomCss = () =>
      Array.from({ length: 6 }, () => {
        const props = ['font-size', pick(['padding-left', 'width', 'margin-left', 'letter-spacing'])].slice(0, 1 + Math.floor(rnd() * 2));
        const body = `${pick(['.a', '.b'])} { ${props.map((p) => `${p}: ${pick(values)()}`).join('; ')}; }`;
        const c = pick(conds)();
        return c ? `${c} { ${body} }` : body;
      }).join('\n');

    let total = 0;
    const bad: string[] = [];
    for (const initialFont of [16, 20]) {
      const { ctx, page } = await openWithFont(initialFont);
      for (let s = 0; s < 12; s++) {
        const css = randomCss();
        const containers: Box[] = [
          { name: 'outer', width: pick([900, 640, 500]), font: pick([16, 20, 25]) },
          { name: 'inner', width: pick([300, 420, 560]), font: pick([16, 14, 22]) },
        ].slice(0, 1 + Math.floor(rnd() * 2));
        const env: Env = { viewport: { width: 0, height: 0 }, initialFont, rootFont: pick([initialFont, 32, 12]), containers };
        await page.setContent(pageHtml(env, css, ['a', 'b']));
        for (const w of WIDTHS) {
          for (const h of [480, 800]) {
            await page.setViewportSize({ width: w, height: h });
            env.viewport = { width: w, height: h };
            const r = compare(env, css, await readComputed(page, ['a', 'b']), ['a', 'b']);
            total += r.n;
            bad.push(...r.bad.map((b) => `${w}×${h}: ${b}\n${css}`));
          }
        }
      }
      await ctx.close();
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(total).toBeGreaterThan(2000);
  }, 180_000);

  it('отчёт о правилах: какие сработали и почему', () => {
    const env: Env = { viewport: { width: 800, height: 700 }, initialFont: 16, rootFont: 20, containers: [{ name: 'slot', width: 700, font: 20 }] };
    const r = resolve(env, t.CARD_CSS);
    const byWhen = Object.fromEntries(r.rules.filter((x) => x.when).map((x) => [`${x.when} ${x.selector}`, x]));
    // html 20px: @media 40em = 640 (шрифт браузера), @container 40em = 800 (шрифт контейнера)
    expect(byWhen['@media (width < 40em) .card'].checks[0].limit).toBe(640);
    expect(byWhen['@container slot (width >= 40em) .meta'].checks[0].limit).toBe(800);
    expect(byWhen['@container slot (width >= 40em) .meta'].ok).toBe(false);
    expect(byWhen['@container slot (width >= 400px) .card'].ok).toBe(true);
    // clamp у отступа: окно 800 → 2vw = 16, между полом и потолком
    expect(r.elements['.card'].padding.clamps).toEqual([{ min: 8, val: 16, max: 24, out: 16, pinned: null }]);
    const narrow = resolve({ ...env, viewport: { width: 320, height: 700 } }, t.CARD_CSS);
    expect(narrow.elements['.card'].padding.clamps?.[0].pinned).toBe('min');
    const wide = resolve({ ...env, viewport: { width: 1440, height: 700 } }, t.CARD_CSS);
    expect(wide.elements['.card'].padding.clamps?.[0].pinned).toBe('max');
    // подпись демо: при шрифте браузера 20 обе границы — 800
    const b20 = resolve({ ...env, initialFont: 20 }, t.CARD_CSS);
    expect(b20.rules.find((x) => x.when === '@media (width < 40em)')!.checks[0].limit).toBe(800);
    expect(t.DEMO_CAPTION).toMatch(/медиазапрос остаётся на 640, контейнерный уходит на 800/);
  });
});

describe('вьюпорт телефона', () => {
  const probe = () => ({
    layout: document.documentElement.clientWidth,
    scale: Math.round(visualViewport!.scale * 100) / 100,
  });

  it('META_ROWS: ширина вёрстки и масштаб при разных мета-тегах (Pixel 7)', async () => {
    const metas: Record<string, string> = {
      'meta нет': '',
      '`width=device-width, initial-scale=1`': 'width=device-width, initial-scale=1',
      '`width=device-width`': 'width=device-width',
      '`initial-scale=1`': 'initial-scale=1',
      '`width=600`': 'width=600',
    };
    for (const row of t.META_ROWS) {
      const ctx = await browser.newContext({ ...devices['Pixel 7'] });
      const page = await ctx.newPage();
      const meta = metas[row.k];
      await page.setContent(`<!doctype html>${meta ? `<meta name="viewport" content="${meta}">` : ''}<body><p>x</p>`);
      const got = await page.evaluate(probe);
      expect(String(got.layout), row.k).toBe(row.layout);
      expect(String(got.scale), row.k).toBe(row.scale);
      if (!meta) {
        expect(await page.evaluate(() => [matchMedia('(width: 980px)').matches, matchMedia('(width: 412px)').matches])).toEqual([true, false]);
        // «около 6.7px»: 16 CSS-пикселей × масштаб
        expect(16 * got.scale).toBeCloseTo(6.7, 1);
      }
      await ctx.close();
    }
    // без isMobile мета-тег не действует
    const desk = await browser.newPage({ viewport: { width: 412, height: 839 } });
    await desk.setContent('<!doctype html><p>x</p>');
    expect(await desk.evaluate(() => document.documentElement.clientWidth)).toBe(412);
    await desk.close();
  });

  async function phone(meta = 'width=device-width, initial-scale=1'): Promise<{ ctx: BrowserContext; page: Page }> {
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    await page.setContent(
      `<!doctype html><meta name="viewport" content="${meta}"><body style="margin:0;height:3000px"><div id=v style="width:100vw;height:10px"></div>` +
        '<div class="send-bar" style="position:fixed;bottom:0;left:0;right:0;height:40px"></div>',
    );
    return { ctx, page };
  }

  it('PINCH_ROWS: щипок ×2 меняет только visual viewport', async () => {
    const { ctx, page } = await phone();
    await page.evaluate(() => {
      const w = window as unknown as { ev: string[] };
      w.ev = [];
      visualViewport!.addEventListener('resize', () => w.ev.push('vv'));
      addEventListener('resize', () => w.ev.push('win'));
    });
    const read = () =>
      page.evaluate(() => ({
        inner: innerWidth,
        client: document.documentElement.clientWidth,
        vw: document.getElementById('v')!.getBoundingClientRect().width,
        mq: matchMedia('(width: 412px)').matches,
        vv: `${visualViewport!.width} × ${visualViewport!.height}`,
        scale: visualViewport!.scale,
        ev: [...new Set((window as unknown as { ev: string[] }).ev)],
      }));
    await page.waitForTimeout(300);
    await page.evaluate(() => ((window as unknown as { ev: string[] }).ev.length = 0)); // события первой раскладки — не от щипка
    const before = await read();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForTimeout(300);
    const after = await read();
    const row = (k: string) => t.PINCH_ROWS.find((r) => r.k.startsWith(k))!;
    expect([before.inner, before.client].join()).toBe('412,412');
    expect([after.inner, after.client].join()).toBe('412,412');
    expect(row('`100vw`').after).toBe(`${after.vw}px`);
    expect(after.mq).toBe(true);
    expect(row('`visualViewport.width').before).toBe(before.vv);
    expect(row('`visualViewport.width').after).toBe(after.vv);
    expect(row('`visualViewport.scale').after).toBe(String(after.scale));
    expect(after.ev).toEqual(['vv']);
    await ctx.close();
  });

  it('PINCH_NOTE: жест ×2.5 у точки (200, 300)', async () => {
    const { ctx, page } = await phone();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Input.synthesizePinchGesture', { x: 200, y: 300, scaleFactor: 2.5, gestureSourceType: 'touch' });
    await page.waitForTimeout(400);
    const vv = await page.evaluate(() => [visualViewport!.width, visualViewport!.height, visualViewport!.offsetLeft, visualViewport!.offsetTop].map((n) => Math.round(n * 10) / 10));
    expect(vv).toEqual([164.8, 335.6, 120, 180]);
    expect(t.PINCH_NOTE).toContain('164.8 × 335.6');
    await ctx.close();
  });

  it('VV_CODE поднимает панель к нижнему краю видимой части', async () => {
    const { ctx, page } = await phone();
    await page.evaluate((code) => new Function(code)(), t.VV_CODE);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await page.waitForTimeout(300);
    const got = await page.evaluate(() => ({
      transform: (document.querySelector('.send-bar') as HTMLElement).style.transform,
      bottom: document.querySelector('.send-bar')!.getBoundingClientRect().bottom,
      visibleBottom: visualViewport!.offsetTop + visualViewport!.height,
    }));
    expect(got.transform).toBe('translateY(-419.5px)');
    expect(got.bottom).toBeCloseTo(got.visibleBottom, 1);
    await ctx.close();
  });

  it('ZOOM_LOCK_NOTE: user-scalable=no и maximum-scale=1 запрещают щипок', async () => {
    for (const meta of ['width=device-width, initial-scale=1, user-scalable=no', 'width=device-width, initial-scale=1, maximum-scale=1', 'width=device-width, initial-scale=1']) {
      const { ctx, page } = await phone(meta);
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.synthesizePinchGesture', { x: 200, y: 300, scaleFactor: 2.5, gestureSourceType: 'touch' });
      await page.waitForTimeout(400);
      const scale = await page.evaluate(() => Math.round(visualViewport!.scale * 10) / 10);
      expect(scale, meta).toBe(meta.includes('=no') || meta.includes('maximum') ? 1 : 2.5);
      await ctx.close();
    }
  });

  it('VH_NOTE: эмуляция Pixel 7 не различает svh, lvh и dvh — 839 до и после прокрутки', async () => {
    const { ctx, page } = await phone();
    const units = () =>
      page.evaluate(() =>
        ['vh', 'svh', 'lvh', 'dvh'].map((u) => {
          const d = document.createElement('div');
          d.style.cssText = `position:absolute;height:100${u}`;
          document.body.append(d);
          const h = d.getBoundingClientRect().height;
          d.remove();
          return h;
        }),
      );
    expect(await units()).toEqual([839, 839, 839, 839]);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    expect(await units()).toEqual([839, 839, 839, 839]);
    expect(t.VH_NOTE).toContain('839px');
    await ctx.close();
  });
});

describe('полоса прокрутки', () => {
  it('VW_ROWS и MQ_SCROLL_NOTE: 100vw = окно вместе с полосой', async () => {
    // Полоса видна только без --hide-scrollbars и с явной шириной (см. шапку data.ts)
    const b = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    const extra: Record<string, string> = {
      'длинная страница': '',
      '`html { scrollbar-gutter: stable }`': 'html{scrollbar-gutter:stable}',
      '`html { overflow-y: scroll }`': 'html{overflow-y:scroll}',
      'короткая страница, полосы нет': '',
    };
    for (const row of t.VW_ROWS) {
      const page = await b.newPage({ viewport: { width: 800, height: 600 } });
      const tall = row.k.startsWith('короткая') ? 100 : 3000;
      await page.setContent(
        `<!doctype html><style>::-webkit-scrollbar{width:12px} body{margin:0} ${extra[row.k]}</style><div style="height:${tall}px"><div id=f style="width:100vw;height:20px"></div></div>`,
      );
      const got = await page.evaluate(() => ({
        vw: document.getElementById('f')!.getBoundingClientRect().width,
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
        mq: matchMedia('(width: 800px)').matches,
      }));
      expect({ vw: got.vw, client: got.client, scroll: got.scroll }, row.k).toEqual({ vw: row.vw, client: row.client, scroll: row.scroll });
      expect(got.mq).toBe(true);
      await page.close();
    }
    await b.close();
  });
});

describe('медиазапросы', () => {
  const EM_PAGE = (htmlFont: string) =>
    `<!doctype html><style>${htmlFont} @media (min-width: 40em){#a{color:rgb(1,1,1)}} @media (min-width: 40rem){#b{color:rgb(1,1,1)}} @media (min-width: 640px){#c{color:rgb(1,1,1)}} @media (640px <= width < 800px){#r{color:rgb(1,1,1)}}</style><i id=a></i><i id=b></i><i id=c></i><i id=r></i>`;
  /** С какой ширины срабатывает каждый из трёх запросов: первая ширина из списка. */
  async function thresholds(initialFont: number, htmlFont: string) {
    const { ctx, page } = await openWithFont(initialFont);
    await page.setContent(EM_PAGE(htmlFont));
    const first: Record<string, number> = {};
    for (const w of [600, 639, 640, 700, 799, 800, 1279, 1280]) {
      await page.setViewportSize({ width: w, height: 400 });
      const on = await page.evaluate(() => ['a', 'b', 'c'].map((id) => getComputedStyle(document.getElementById(id)!).color === 'rgb(1, 1, 1)'));
      ['em', 'rem', 'px'].forEach((k, i) => {
        if (on[i] && first[k] === undefined) first[k] = w;
      });
    }
    await ctx.close();
    return first;
  }

  it('EM_ROWS: em и rem — от шрифта браузера, не от html', async () => {
    const big = await thresholds(16, 'html{font-size:32px}');
    const f20 = await thresholds(20, '');
    const fmt = (o: Record<string, number>) => ({ em: `с ${o.em}`, rem: `с ${o.rem}`, px: `с ${o.px}` });
    expect(fmt(big)).toEqual({ em: t.EM_ROWS[0].em, rem: t.EM_ROWS[0].rem, px: t.EM_ROWS[0].px });
    expect(fmt(f20)).toEqual({ em: t.EM_ROWS[1].em, rem: t.EM_ROWS[1].rem, px: t.EM_ROWS[1].px });
  });

  it('RANGE_NOTE: (640px <= width < 800px) верно при 640 и 799, неверно при 800', async () => {
    const page = await browser.newPage();
    await page.setContent(EM_PAGE(''));
    const at = async (w: number) => {
      await page.setViewportSize({ width: w, height: 400 });
      return page.evaluate(() => getComputedStyle(document.getElementById('r')!).color === 'rgb(1, 1, 1)');
    };
    expect([await at(639), await at(640), await at(799), await at(800)]).toEqual([false, true, true, false]);
    await page.close();
  });

  it('PREFERS_ROWS: каждое условие включается названным способом', async () => {
    const page = await browser.newPage();
    const q = (list: string[]) => page.evaluate((l) => l.map((x) => matchMedia(x).matches), list);
    const emulated = ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)', '(prefers-contrast: more)', '(forced-colors: active)'];
    expect(await q(emulated)).toEqual([false, false, false, false]);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce', contrast: 'more', forcedColors: 'active' });
    expect(await q(emulated)).toEqual([true, true, true, true]);
    expect(await q(['(prefers-reduced-transparency: reduce)'])).toEqual([false]);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    expect(await q(['(prefers-reduced-transparency: reduce)'])).toEqual([true]);
    await page.close();
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const p = await ctx.newPage();
    expect(await p.evaluate(() => [matchMedia('(hover: hover)').matches, matchMedia('(pointer: coarse)').matches])).toEqual([false, true]);
    await ctx.close();
    for (const row of t.PREFERS_ROWS.slice(0, 5)) expect(row.k).toMatch(/^`(prefers|forced)/);
  });
});

describe('контейнеры', () => {
  it('SHRINK_ROWS: всё «по содержимому» схлопывается до отступов', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const TXT = 'Длинный текст карточки';
    await page.setContent(`<!doctype html><body style="margin:0"><style>.c{container-type:inline-size;padding:0 10px}</style>
<div><span id=ib class=c style="display:inline-block"><span>${TXT}</span></span></div>
<div><span id=ib0 style="display:inline-block;padding:0 10px"><span>${TXT}</span></span></div>
<div style="display:grid;grid-template-columns:auto 1fr"><div id=gr class=c>${TXT}</div><div>сосед</div></div>
<div style="display:grid;grid-template-columns:auto 1fr"><div id=gr0 style="padding:0 10px">${TXT}</div><div>сосед</div></div>
<div style="display:flex"><div id=fx class=c style="flex:none">${TXT}</div><div id=fx2 class=c>${TXT}</div><div style="flex:1">сосед</div></div>
<div style="position:relative;height:40px"><div id=ab class=c style="position:absolute">${TXT}</div></div>
<div id=fl class=c style="float:left">${TXT}</div><div style="clear:both"></div>
<div id=fc class=c style="width:fit-content">${TXT}</div>
<div id=blk class=c>${TXT}</div>
<div id=sz style="container-type:size">${TXT}</div>`);
    const got = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[id]')].map((e) => {
          const r = e.getBoundingClientRect();
          return [e.id, { w: Math.round(r.width * 10) / 10, h: Math.round(r.height), over: e.scrollWidth > e.clientWidth }];
        }),
      ),
    );
    const cq = (k: string) => t.SHRINK_ROWS.find((r) => r.k.startsWith(k))!;
    expect(String(got.ib0.w)).toBe(cq('`display: inline-block`').plain);
    expect(String(got.gr0.w)).toBe(cq('колонка грида').plain);
    for (const id of ['ib', 'gr', 'fx', 'fx2', 'ab', 'fl', 'fc']) {
      expect(got[id].w, id).toBe(20);
      expect(got[id].over, id).toBe(true);
    }
    expect(got.blk.w).toBe(1000);
    expect([got.sz.w, got.sz.h]).toEqual([1000, 0]);
    expect(t.SHRINK_NOTE).toContain('1000 × 0');
    await page.close();
  });

  it('CQ_FACTS: content-box, предки, имена, em контейнера и откат единиц на окно', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    await page.setContent(`<!doctype html><body style="margin:0"><style>
*{box-sizing:border-box}
.outer{container: page / inline-size; width:800px}
.mid{container-type:inline-size; width:500px; padding:0 20px}
@container (width > 470px){ .t470{background-color:rgb(1,1,1)} }
@container (width > 450px){ .t450{background-color:rgb(1,1,1)} }
@container page (width > 700px){ .tnamed{background-color:rgb(1,1,1)} }
@container nope (width > 1px){ .tmissing{background-color:rgb(1,1,1)} }
@container (width > 600px){ .mid{background-color:rgb(1,1,1)} }
.solo{container-type:inline-size; width:900px}
@container (width > 1px){ .solo{background-color:rgb(1,1,1)} }
.u1{width:10cqi} .u3{height:10cqb} .free{width:10cqi}
.f{container-type:inline-size; width:500px; font-size:25px}
@container (width > 19em){ .e19{background-color:rgb(1,1,1)} }
@container (width > 21em){ .e21{background-color:rgb(1,1,1)} }
</style>
<div class=outer><div class=mid><div><i class=t470></i><i class=t450></i><i class=tnamed></i><i class=tmissing></i><div class=u1></div><div class=u3></div></div></div></div>
<div class=solo></div><div class=free></div>
<div class=f><i class=e19></i><i class=e21></i></div>`);
    const got = await page.evaluate(() => {
      const on = (c: string) => getComputedStyle(document.querySelector('.' + c)!).backgroundColor === 'rgb(1, 1, 1)';
      const px = (c: string, p: string) => getComputedStyle(document.querySelector('.' + c)!).getPropertyValue(p);
      return {
        t470: on('t470'), t450: on('t450'), named: on('tnamed'), missing: on('tmissing'), mid: on('mid'), solo: on('solo'),
        e19: on('e19'), e21: on('e21'),
        u1: px('u1', 'width'), u3: px('u3', 'height'), free: px('free', 'width'),
      };
    });
    expect(got).toEqual({
      t470: false, t450: true, named: true, missing: false, mid: true, solo: false,
      e19: true, e21: false,
      u1: '46px', u3: '60px', free: '100px',
    });
    const text = t.CQ_FACTS.map((f) => f.d).join(' ');
    for (const s of ['`10cqi` внутри него — 46px', '`21em` — это 525px', '— 100px', '— 60px']) expect(text).toContain(s);
    // та же логика в модели темы
    const env: Env = { viewport: { width: 1000, height: 600 }, initialFont: 16, rootFont: 16, containers: [{ name: 'page', width: 800, font: 16 }, { name: '', width: 460, font: 16 }] };
    const m = resolve(env, '@container nope (width > 1px) { .x { width: 1px } } .y { width: 10cqi; height: 10cqb }');
    expect(m.rules[0].ok).toBe(false);
    expect([m.elements['.y'].width.px, m.elements['.y'].height.px]).toEqual([46, 60]);
    await page.close();
  });

  it('STYLE_ROWS: style-запросы и if() в Chromium 153', async () => {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><style>
#box{--theme: dark; --n: 7}
@container style(--theme: dark){ #s1{color: rgb(1,1,1)} }
@container style(--n > 5){ #s3{color: rgb(1,1,1)} }
#box2{color:red}
@container style(color: red){ #s4{color: rgb(1,1,1)} }
#s5{color: if(style(--theme: dark): rgb(1,1,1); else: rgb(2,2,2))}
</style><div id=box><i id=s1></i><i id=s3></i><i id=s5></i></div><div id=box2><i id=s4></i></div>`);
    const got = await page.evaluate(() => ({
      c: ['s1', 's3', 's4', 's5'].map((id) => getComputedStyle(document.getElementById(id)!).color),
      parsed: [...document.styleSheets[0].cssRules].some((r) => r.cssText.startsWith('@container style(color: red)')),
      scrollState: CSS.supports('container-type', 'scroll-state'),
    }));
    expect(got.c).toEqual(['rgb(1, 1, 1)', 'rgb(1, 1, 1)', 'rgb(255, 0, 0)', 'rgb(1, 1, 1)']);
    expect(got.parsed).toBe(true);
    expect(got.scrollState).toBe(true);
    expect(t.STYLE_ROWS.map((r) => r.tone)).toEqual(['ok', 'ok', 'err', 'ok', 'ok']);
    await page.close();
  });
});

describe('clamp и масштаб', () => {
  it('FLUID_CODE: строка и концы прямой в Chromium', async () => {
    const fluid = new Function(`${t.FLUID_CODE.replace(/\nfluid\(16[^\n]*\n\/\/[^\n]*$/, '')}\nreturn fluid;`)() as (...a: number[]) => string;
    const out = fluid(16, 28, 360, 1280);
    expect(t.FLUID_CODE).toContain(`// → '${out}'`);
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><p id=p style="font-size:${out}">x</p>`);
    const at = async (w: number) => {
      await page.setViewportSize({ width: w, height: 400 });
      return page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('p')!).fontSize));
    };
    expect(await at(320)).toBe(16);
    expect(await at(360)).toBeCloseTo(16, 1);
    expect(await at(1280)).toBeCloseTo(28, 1);
    expect(await at(1600)).toBe(28);
    await page.close();
  });

  it('ZOOM_ROWS: физический размер при эмулированном масштабе страницы', async () => {
    const fonts = ['16px', '1rem', '2.5vw', 'clamp(1rem, 0.5rem + 2vw, 2rem)', 'clamp(1rem, 1rem + 1vw, 2.5rem)'];
    const table: Record<number, number[]> = {};
    for (const z of [1, 2, 3, 4]) {
      const ctx = await browser.newContext({ viewport: { width: Math.round(1280 / z), height: 800 }, deviceScaleFactor: z });
      const page = await ctx.newPage();
      await page.setContent(`<!doctype html>${fonts.map((f, i) => `<p id=f${i} style="font-size:${f}">x</p>`).join('')}`);
      table[z] = await page.evaluate(
        (n) => Array.from({ length: n }, (_, i) => +(parseFloat(getComputedStyle(document.getElementById('f' + i)!).fontSize) * devicePixelRatio).toFixed(2)),
        fonts.length,
      );
      await ctx.close();
    }
    const col = (i: number) => [table[1][i], table[2][i], table[3][i], table[4][i]];
    expect(col(0)).toEqual(col(1));
    const rows = t.ZOOM_ROWS.map((r) => [r.z100, r.z200, r.z300, r.z400]);
    // окно 1280/3 округляется до 427 CSS-пикселей, отсюда сотые доли: допуск 0.05
    const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 0.05);
    for (const [i, c] of [0, 2, 3, 4].entries()) expect(near(rows[i], col(c)), `${t.ZOOM_ROWS[i].k}: ${col(c)}`).toBe(true);
    expect(t.ZOOM_NOTE).toContain('в 1.3 раза');
    expect(+(col(3)[1] / col(3)[0]).toFixed(2)).toBe(1.3);
    expect(+(col(4)[1] / col(4)[0]).toFixed(2)).toBe(1.56);
  });
});

describe('ссылки', () => {
  it('«Где разобрано» и «Смежное» ведут на существующие разделы', () => {
    const all = [t.RELATED, t.SRCSET_NOTE, t.CQ_LEAD_NOTE, ...t.PREREQ.map((p) => p.href ?? '')].join(' ');
    const links = [...all.matchAll(/\/(js|render|platform|tooling)\/([a-z0-9-]+)\/#(s\d+)/g)];
    expect(links.length).toBeGreaterThan(8);
    for (const [, dir, slug, anchor] of links) {
      const col = dir === 'js' ? 'lessons' : dir;
      const mdx = readFileSync(new URL(`../../src/content/${col}/${slug}/index.mdx`, import.meta.url), 'utf8');
      expect(mdx, `${dir}/${slug}#${anchor}`).toMatch(new RegExp(`\\{ id: ${anchor},`));
    }
  });
});
