import sharp from 'sharp';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/stacking/data';
import { countNodes, cssText, layoutTree, loadStacking, STAGE_STYLE } from '@/widgets/stacking-lab/model/run';
import type { Css, StackNode } from '@/widgets/stacking-lab/model/types';

/**
 * Тема «Контекст наложения, z-index и верхний слой».
 *
 * `STACKING_CODE` — учебная модель приложения E строкой из темы: напечатана на странице
 * и исполняется демо. Здесь она сверяется с Chromium из Playwright: дерево раскладывается
 * `layoutTree` (той же функцией, что в демо) так, что все блоки накрывают одну точку,
 * и `document.elementsFromPoint` в ней отдаёт порядок отрисовки сверху вниз. Сверка идёт
 * на сценах демо, на сквозном примере, на каждой строке `TRIGGER_ROWS` и на 300 случайных
 * деревьях с фиксированным зерном.
 *
 * Факты о верхнем слое и модальности (`TOP_*`, `ORDER_CODE`, `MODAL_*`) снимаются заново
 * тем же браузером: `:modal`, `:popover-open`, `:fullscreen`, `elementFromPoint`, пиксель
 * снимка экрана и дерево доступности из протокола отладчика. Таймеров нет.
 */

const api = loadStacking(t.STACKING_CODE);

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

/** Страница, где все блоки дерева накрывают точку `probe`, — как сцена демо. */
function treeHtml(tree: StackNode[]): { html: string; probe: number } {
  const { styles, probe } = layoutTree(tree);
  const render = (list: StackNode[]): string =>
    list
      .map((n) => `<div id="${n.id}" style="${cssText(styles[n.id])};background:#ddd;${cssText(n.css)}">${render(n.kids ?? [])}</div>`)
      .join('');
  return { html: `<!doctype html><body style="margin:0;${cssText(STAGE_STYLE)}">${render(tree)}</body>`, probe };
}

/** Порядок отрисовки в Chromium снизу вверх — только блоки дерева. */
async function chromiumOrder(tree: StackNode[]): Promise<string[]> {
  const { html, probe } = treeHtml(tree);
  await page.setContent(html);
  const ids = new Set<string>();
  const walk = (l: StackNode[]) => l.forEach((n) => (ids.add(n.id), walk(n.kids ?? [])));
  walk(tree);
  const got = await page.evaluate((p) => document.elementsFromPoint(p, p).map((e) => e.id), probe);
  return got.filter((id) => ids.has(id)).reverse();
}

const modelOrder = (tree: StackNode[]) => api.paintOrder(tree).order.map((e) => e.id);

describe('paintOrder против Chromium', () => {
  it('сквозной пример: LAYERS_HTML — та же сцена, что «Семь шагов» в демо, порядок LAYERS_ORDER', async () => {
    const scene = t.DEMO_SCENES.find((s) => s.id === 'layers')!;
    // Разметка в тексте и дерево сцены — одно и то же: id и стили по порядку.
    const fromHtml = [...t.LAYERS_HTML.matchAll(/id="(\w+)"(?:\s+style="([^"]*)")?/g)].map((m) => [m[1], (m[2] ?? '').replace(/\s/g, '')]);
    const flat: [string, string][] = [];
    const walk = (l: StackNode[]) => l.forEach((n) => (flat.push([n.id, cssText(n.css).replace(/\s/g, '')]), walk(n.kids ?? [])));
    walk(scene.tree);
    expect(fromHtml).toEqual(flat);

    expect(modelOrder(scene.tree)).toEqual(t.LAYERS_ORDER);
    expect(await chromiumOrder(scene.tree)).toEqual(t.LAYERS_ORDER);
    expect(api.paintOrder(scene.tree).order.map((e) => e.step)).toEqual([6, 2, 3, 4, 5, 6, 7]);
    expect(t.LAYERS_NOTE).toContain(t.LAYERS_ORDER.map((id) => `\`${id}\``).join(', '));
    expect(t.PAINT_STEPS).toHaveLength(7);
  });

  it('сцены демо: модель совпадает с Chromium, и сверху тот, о ком говорит подпись', async () => {
    const tops: Record<string, string> = {};
    for (const s of t.DEMO_SCENES) {
      const want = modelOrder(s.tree);
      expect(await chromiumOrder(s.tree), s.id).toEqual(want);
      tops[s.id] = want.at(-1)!;
    }
    expect(tops).toEqual({ trap: 'main', leak: 'badge', layers: 'pos', negative: 'parent' });
  });

  it('подсказки в подписях сцен: шапка без z-index, isolation у карточки и у родителя', async () => {
    const edit = (id: string, path: string, css: Css) => {
      const tree = structuredClone(t.DEMO_SCENES.find((s) => s.id === id)!.tree);
      const find = (l: StackNode[]): StackNode | undefined => l.map((n) => (n.id === path ? n : find(n.kids ?? []))).find(Boolean);
      const node = find(tree)!;
      node.css = css;
      return tree;
    };
    const cases: [StackNode[], string][] = [
      [edit('trap', 'header', { position: 'relative' }), 'modal'],
      [edit('leak', 'card', { isolation: 'isolate' }), 'header'],
      [edit('negative', 'parent', { isolation: 'isolate' }), 'child'],
      [edit('negative', 'parent', { opacity: '0.9' }), 'child'],
    ];
    for (const [tree, top] of cases) {
      expect(modelOrder(tree).at(-1)).toBe(top);
      expect((await chromiumOrder(tree)).at(-1)).toBe(top);
    }
  });

  it('300 случайных деревьев: порядок отрисовки модели и Chromium совпадает целиком', async () => {
    let seed = 20261002;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
    const effects = t.DEMO_OPTIONS.effect.map((o) => o.css).concat([{ 'will-change': 'z-index' }, { opacity: '0' }]);
    const gen = (n: number, depth: number): StackNode[] =>
      Array.from({ length: n }, () => {
        const css: Css = {
          ...pick(t.DEMO_OPTIONS.position).css,
          ...pick([...t.DEMO_OPTIONS.z, ...t.DEMO_OPTIONS.z.slice(0, 1).concat(t.DEMO_OPTIONS.z.slice(0, 1))]).css,
          ...pick([{}, {}, {}, ...effects]),
          ...pick([...t.DEMO_OPTIONS.kind, t.DEMO_OPTIONS.kind[0], { css: { display: 'grid' } }]).css,
        };
        return { id: '', css, kids: depth < 3 && rnd() < 0.5 ? gen(1 + Math.floor(rnd() * 3), depth + 1) : [] };
      });
    let done = 0;
    let steps = new Set<number>();
    while (done < 300) {
      const tree = gen(1 + Math.floor(rnd() * 4), 0);
      if (countNodes(tree) > 8) continue;
      let i = 0;
      const label = (l: StackNode[]) => l.forEach((n) => ((n.id = `e${i++}`), label(n.kids ?? [])));
      label(tree);
      const model = api.paintOrder(tree);
      model.order.forEach((e) => steps.add(e.step));
      const got = await chromiumOrder(tree);
      expect(got, JSON.stringify(tree)).toEqual(model.order.map((e) => e.id));
      done++;
    }
    // Все шаги приложения E встретились, то есть проверка их покрывает.
    expect([...steps].sort()).toEqual([2, 3, 4, 5, 6, 7]);
    steps = new Set();
  }, 120_000);

  it('demo caption обещает ровно эту проверку', () => {
    expect(t.DEMO_CAPTION).toContain('трёхстах случайных деревьях');
  });
});

describe('кто создаёт контекст: TRIGGER_ROWS', () => {
  /** Родитель со свойством и ребёнок с z-index: -1: ребёнок над фоном родителя — значит, контекст. */
  async function isContext(css: string, parent?: string): Promise<boolean> {
    const wrap = parent ? `<div style="display:${parent}">` : '<div>';
    await page.setContent(
      `<!doctype html><body style="margin:0">${wrap}<div id=P style="width:100px;height:100px;background:#ccc;${css}"><div id=C style="position:relative;z-index:-1;width:100px;height:100px;background:#f00"></div></div></div>`,
    );
    return page.evaluate(() => document.elementFromPoint(50, 50)?.id === 'C');
  }
  const parse = (s: string): Css => Object.fromEntries(s.split(';').map((d) => d.split(':').map((x) => x.trim()) as [string, string]));

  it('каждая строка: Chromium и contextReason отвечают одинаково и как в таблице', async () => {
    for (const row of t.TRIGGER_ROWS) {
      expect(await isContext(row.css, row.parent), `${row.css} ${row.parent ?? ''}`).toBe(row.sc);
      const reason = api.contextReason(parse(row.css), row.parent ? { display: row.parent } : {});
      expect(reason !== null, `модель: ${row.css}`).toBe(row.sc);
    }
  }, 60_000);

  it('примечания в таблице тоже проверены: opacity 0, layout/content/strict, mask-image, perspective, contain: style, container-type: size', async () => {
    for (const [css, sc] of [
      ['opacity: 0', true],
      ['contain: layout', true],
      ['contain: content', true],
      ['contain: strict', true],
      ['contain: style', false],
      ['container-type: size', false],
      ['mask-image: linear-gradient(#000, #000)', true],
      ['perspective: 100px', true],
      ['translate: 1px', true],
      ['rotate: 0deg', true],
      ['filter: blur(0)', true],
      ['will-change: opacity', true],
      ['will-change: z-index', false],
      ['will-change: z-index; position: relative', true],
    ] as const) {
      expect(await isContext(css), css).toBe(sc);
      expect(api.contextReason(parse(css)) !== null, `модель: ${css}`).toBe(sc);
    }
  }, 60_000);

  it('content-visibility: auto — контекст не сразу, а после кадров (TRIGGER_NOTE)', async () => {
    // Вставка и первый замер — в одной задаче, без кадра между ними: иначе гонка с отрисовкой.
    await page.setContent('<!doctype html><body style="margin:0">');
    const before = await page.evaluate(() => {
      document.body.innerHTML =
        '<div><div id=P style="width:100px;height:100px;background:#ccc;content-visibility:auto"><div id=C style="position:relative;z-index:-1;width:100px;height:100px;background:#f00"></div></div></div>';
      return document.elementFromPoint(50, 50)?.id;
    });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const after = await page.evaluate(() => document.elementFromPoint(50, 50)?.id);
    expect([before, after]).toEqual(['P', 'C']);
    expect(t.TRIGGER_NOTE).toContain('после пары кадров');
  });
});

describe('ловушка и isolation — код темы как напечатан', () => {
  it('TRAP_HTML: сверху main; без z-index у шапки — модальное окно', async () => {
    await page.setContent(`<!doctype html><body style="margin:0">${t.TRAP_HTML.replace('<main', '<main id="main"').replace('class="modal"', 'id="modal" class="modal"').replace('…', '<div style="height:500px"></div>')}`);
    expect(await page.evaluate(() => document.elementFromPoint(400, 300)?.closest('[id]')?.id)).toBe('main');
    await page.evaluate(() => (document.querySelector('header')!.style.zIndex = 'auto'));
    expect(await page.evaluate(() => document.elementFromPoint(400, 300)?.closest('[id]')?.id)).toBe('modal');
  });

  it('LEAK_HTML: значок над шапкой; isolation: isolate на карточке — шапка сверху', async () => {
    await page.setContent(
      `<!doctype html><style>header{height:60px;background:#eee}.card{display:block;margin-top:-40px;height:200px;background:#ccc}.badge{display:block;width:80px;height:80px;background:#f00}</style><body style="margin:0">${t.LEAK_HTML}`,
    );
    const top = () => page.evaluate(() => document.elementFromPoint(20, 20)?.tagName);
    expect(await top()).toBe('SPAN');
    await page.evaluate(() => (document.querySelector<HTMLElement>('.card')!.style.isolation = 'isolate'));
    expect(await top()).toBe('HEADER');
  });
});

/** Цвет пикселя снимка экрана. */
async function pixel(x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(await page.screenshot()).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [...data.subarray(i, i + 3)];
}

describe('верхний слой', () => {
  it('TOP_HTML + TOP_CODE: диалог поверх стены с z-index 2147483647, в центре окна, без opacity предка', async () => {
    await page.setContent(`<!doctype html><body style="margin:0">${t.TOP_HTML.replace('…', '<button>ок</button>')}`);
    expect(await page.evaluate(() => document.elementFromPoint(400, 300)?.className)).toBe('wall');
    // Строки TOP_CODE исполняются как есть; комментарии — ожидаемые значения.
    const lines = t.TOP_CODE.split('\n').filter(Boolean);
    const results = await page.evaluate((src) => src.map((l) => String(new Function('dlg', `return (${l.replace(/;\s*\/\/.*$/, '').replace(/;$/, '')})`)(document.getElementById('dlg')))), lines);
    expect(results.slice(1)).toEqual(lines.slice(1).map((l) => /\/\/ '?(\w+)'?/.exec(l)![1]));

    const rect = await page.evaluate(() => {
      const r = document.getElementById('dlg')!.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    expect(rect[0] * 2 + rect[2]).toBe(800);
    expect(rect[1] * 2 + rect[3]).toBe(600);
    // Пиксель в центре — чистый цвет фона диалога: opacity предка не применилась.
    await page.evaluate(() => (document.getElementById('dlg')!.style.background = 'rgb(255, 0, 0)'));
    await page.evaluate(() => document.getElementById('dlg')!.blur());
    expect(await pixel(400, 300)).toEqual([255, 0, 0]);
    // Подложка: rgba(0,0,0,.1) на белом — 229; клик по ней — это сам dialog.
    await page.evaluate(() => document.querySelector<HTMLElement>('.wall')!.remove());
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('dlg')!, '::backdrop').backgroundColor)).toBe('rgba(0, 0, 0, 0.1)');
    expect(await pixel(20, 20)).toEqual([229, 229, 229]);
    expect(await page.evaluate(() => document.elementFromPoint(20, 20)?.id)).toBe('dlg');
    expect(t.TOP_FACTS[2].d).toContain('`229, 229, 229`');
  });

  it('наследование и всплытие остаются: шрифт берётся у предка, клик доходит до предка', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><div id=wrap style="font-family: monospace; transform: scale(.5)"><dialog id=dlg><button id=b>ок</button></dialog></div>`,
    );
    await page.evaluate(() => {
      (window as unknown as { hits: string[] }).hits = [];
      document.getElementById('wrap')!.addEventListener('click', () => (window as unknown as { hits: string[] }).hits.push('wrap'));
      (document.getElementById('dlg') as HTMLDialogElement).showModal();
    });
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('dlg')!).fontFamily)).toBe('monospace');
    await page.click('#b');
    expect(await page.evaluate(() => (window as unknown as { hits: string[] }).hits)).toEqual(['wrap']);
  });

  it('ORDER_CODE: порядок — время открытия, z-index не работает', async () => {
    await page.setContent(
      `<!doctype html><style>[popover]{inset:auto;left:300px;top:250px;margin:0;width:200px;height:100px}</style><body><div id=a popover=manual></div><div id=b popover=manual></div>`,
    );
    const tops: string[] = [];
    for (const line of t.ORDER_CODE.split('\n')) {
      await page.evaluate((l) => new Function('a', 'b', l)(document.getElementById('a'), document.getElementById('b')), line);
      const m = /сверху (?:всё ещё )?(\w)/.exec(line);
      if (m) tops.push(m[1], (await page.evaluate(() => document.elementFromPoint(400, 300)?.id)) ?? '');
    }
    expect(tops).toEqual(['a', 'a', 'b', 'b', 'b', 'b', 'a', 'a']);
    expect(await page.evaluate(() => [getComputedStyle(document.getElementById('a')!).position, getComputedStyle(document.getElementById('a')!, '::backdrop').backgroundColor])).toEqual([
      'fixed',
      'rgba(0, 0, 0, 0)',
    ]);
  });

  it('ORDER_NOTE: подложка диалога над поповером, открытым раньше, и под открытым позже; overlay — auto/none', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><div id=A popover=manual style="inset:auto;left:0;top:0;margin:0;width:100px;height:100px;background:#fff;border:0"></div><dialog id=d style="width:100px;height:100px;border:0;padding:0">d</dialog>`,
    );
    const ov = () => page.evaluate(() => ['A', 'd'].map((id) => getComputedStyle(document.getElementById(id)!).getPropertyValue('overlay')));
    expect(await ov()).toEqual(['none', 'none']);
    await page.evaluate(() => {
      (document.getElementById('A') as HTMLElement).showPopover();
      (document.getElementById('d') as HTMLDialogElement).showModal();
    });
    expect(await pixel(50, 50)).toEqual([229, 229, 229]);
    expect(await ov()).toEqual(['auto', 'auto']);
    await page.evaluate(() => {
      const A = document.getElementById('A') as HTMLElement;
      const d = document.getElementById('d') as HTMLDialogElement;
      d.close();
      A.hidePopover();
      d.showModal();
      A.showPopover();
    });
    expect(await pixel(50, 50)).toEqual([255, 255, 255]);
    expect(t.OVERLAY_NOTE).toContain('`auto`');
  });

  it('TOP_ROWS: show() — не верхний слой; auto-поповер закрывается кликом мимо, Esc и другим auto', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><div id=wall style="position:fixed;inset:0;z-index:5"></div><dialog id=d style="margin:0;inset:auto;left:0;top:0">x</dialog><div id=C popover>C</div><div id=D popover>D</div>`,
    );
    const open = () => page.evaluate(() => [...document.querySelectorAll(':popover-open, dialog[open]')].map((e) => e.id));
    await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).show());
    expect(await page.evaluate(() => [document.elementFromPoint(5, 5)?.id, (document.getElementById('d') as HTMLDialogElement).matches(':modal')])).toEqual(['wall', false]);
    await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).close());
    await page.evaluate(() => document.getElementById('wall')!.remove());

    await page.evaluate(() => document.getElementById('C')!.showPopover());
    await page.evaluate(() => document.getElementById('D')!.showPopover());
    expect(await open()).toEqual(['D']);
    await page.mouse.click(5, 590);
    expect(await open()).toEqual([]);
    await page.evaluate(() => document.getElementById('C')!.showPopover());
    await page.keyboard.press('Escape');
    expect(await open()).toEqual([]);
  });

  it('requestFullscreen: без действия пользователя — отказ; по клику — верхний слой с чёрной подложкой', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><div id=wall style="position:fixed;inset:0;z-index:2147483647;pointer-events:none"></div><button id=go>во весь экран</button><div id=fs style="width:50px;height:50px"></div>`,
    );
    // page.evaluate и setContent Playwright исполняет как действие пользователя
    // (navigator.userActivation.isActive — true). Отказ проверяется скриптом самой страницы,
    // загруженной через goto: там активации нет.
    const fresh = await browser.newPage();
    const html = `<div id=fs>x</div><script>window.act = navigator.userActivation.isActive; document.getElementById('fs').requestFullscreen().then(() => (window.r = 'ok'), (e) => (window.r = e.name))</script>`;
    await fresh.goto('data:text/html,' + encodeURIComponent(html));
    await fresh.waitForFunction(() => (window as unknown as { r?: string }).r);
    expect(await fresh.evaluate(() => [(window as unknown as { act: boolean }).act, (window as unknown as { r: string }).r])).toEqual([false, 'TypeError']);
    await fresh.close();
    await page.evaluate(() => (document.getElementById('go')!.onclick = () => void document.getElementById('fs')!.requestFullscreen()));
    await page.click('#go');
    await page.waitForFunction(() => document.fullscreenElement);
    expect(
      await page.evaluate(() => [
        document.querySelector(':fullscreen')?.id,
        document.elementFromPoint(400, 300)?.id,
        getComputedStyle(document.getElementById('fs')!, '::backdrop').backgroundColor,
      ]),
    ).toEqual(['fs', 'fs', 'rgb(0, 0, 0)']);
    await page.evaluate(() => document.exitFullscreen());
  });
});

describe('модальное окно: MODAL_ROWS и MODAL_FACTS', () => {
  it('снаружи — ни кликов, ни фокуса, ни узлов в дереве доступности; Tab, Esc, autofocus', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><button id=open style="position:fixed;left:10px;top:10px;width:100px;height:40px">Открыть</button><dialog id=d><button id=b1>Один</button><button id=b2>Два</button></dialog><dialog id=d3><button id=b3 autofocus>auto</button></dialog>`,
    );
    await page.evaluate(() => {
      (window as unknown as { clicks: number }).clicks = 0;
      document.getElementById('open')!.onclick = () => (window as unknown as { clicks: number }).clicks++;
    });
    await page.focus('#open');
    await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).showModal());
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('b1');
    expect(await page.evaluate(() => document.elementFromPoint(50, 30)?.id)).toBe('d');
    await page.mouse.click(50, 30);
    expect(await page.evaluate(() => (window as unknown as { clicks: number }).clicks)).toBe(0);
    await page.evaluate(() => document.getElementById('b1')!.focus());
    expect(await page.evaluate(() => {
      const out = document.getElementById('open') as HTMLButtonElement;
      out.focus();
      return [document.activeElement?.id, out.inert, out.hasAttribute('inert')];
    })).toEqual(['b1', false, false]);

    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      seq.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName || ''));
    }
    expect(seq).toEqual(['b2', 'BODY', 'b1', 'b2']);

    const cdp = await page.context().newCDPSession(page);
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes: { ignored: boolean; role?: { value: string }; name?: { value: string }; properties?: { name: string; value: { value: unknown } }[] }[];
    };
    const buttons = nodes.filter((n) => !n.ignored && n.role?.value === 'button').map((n) => n.name?.value);
    expect(buttons).toEqual(['Один', 'Два']);
    const dlg = nodes.find((n) => n.role?.value === 'dialog');
    expect(dlg?.properties?.find((p) => p.name === 'modal')?.value.value).toBe(true);
    await cdp.detach();

    // Esc закрывает и возвращает фокус на кнопку, бывшую в фокусе до открытия.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => [(document.getElementById('d') as HTMLDialogElement).open, document.activeElement?.id])).toEqual([false, 'open']);
    await page.evaluate(() => (document.getElementById('d3') as HTMLDialogElement).showModal());
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('b3');
  }, 30_000);

  it('closedby="any": клик по подложке закрывает модальный диалог', async () => {
    await page.setContent(`<!doctype html><body><dialog id=d closedby="any" style="width:100px;height:100px">x</dialog>`);
    await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).showModal());
    await page.mouse.click(700, 500);
    expect(await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).open)).toBe(false);
    expect(t.MODAL_NOTE).toContain('closedby="any"');
  });

  it('showModal закрывает auto-поповер, manual остаётся; manual после модального — виден, но не в hit-test', async () => {
    await page.setContent(
      `<!doctype html><style>[popover],dialog{width:200px;height:100px;padding:0;border:0;margin:0;inset:auto;left:300px;top:250px}</style><body style="margin:0"><div id=A popover=manual></div><div id=B popover=manual style="background:rgb(0,0,255)"></div><div id=C popover></div><dialog id=dlg><div id=E popover style="background:rgb(255,0,0)"></div></dialog>`,
    );
    const open = () => page.evaluate(() => [...document.querySelectorAll(':popover-open, :modal')].map((e) => e.id).sort());
    await page.evaluate(() => {
      document.getElementById('A')!.showPopover();
      document.getElementById('C')!.showPopover();
      (document.getElementById('dlg') as HTMLDialogElement).showModal();
    });
    expect(await open()).toEqual(['A', 'dlg']);
    await page.evaluate(() => document.getElementById('E')!.showPopover());
    expect(await page.evaluate(() => document.elementFromPoint(400, 300)?.id)).toBe('E');
    await page.evaluate(() => document.getElementById('B')!.showPopover());
    expect(await pixel(310, 260)).toEqual([0, 0, 255]);
    expect(await page.evaluate(() => document.elementsFromPoint(400, 300).map((e) => e.id || e.tagName))).toEqual(['E', 'dlg', 'HTML']);
  });

  it('диалог в display: none — модален, невидим, страница инертна', async () => {
    await page.setContent(`<!doctype html><body><button id=b>кнопка</button><div style="display:none"><dialog id=dn>x</dialog></div>`);
    const r = await page.evaluate(() => {
      const dn = document.getElementById('dn') as HTMLDialogElement;
      dn.showModal();
      const b = document.getElementById('b')!.getBoundingClientRect();
      return [dn.open, dn.matches(':modal'), dn.getBoundingClientRect().width, document.elementFromPoint(b.x + 3, b.y + 3)?.tagName];
    });
    expect(r).toEqual([true, true, 0, 'HTML']);
  });

  it('полный экран в Chromium: всё вне элемента инертно, даже поповер поверх; поповер внутри — живой', async () => {
    await page.setContent(
      `<!doctype html><body style="margin:0"><button id=go>go</button><div id=A popover=manual style="inset:auto;left:300px;top:250px;margin:0;width:200px;height:100px"><button id=inA>в поповере</button></div><div id=fs style="background:#f0f"><div id=P2 popover=manual style="inset:auto;left:100px;top:100px;margin:0;width:100px;height:50px"><button id=inP2>внутри</button></div></div>`,
    );
    await page.evaluate(() => (document.getElementById('go')!.onclick = () => void document.getElementById('fs')!.requestFullscreen()));
    await page.click('#go');
    await page.waitForFunction(() => document.fullscreenElement);
    const r = await page.evaluate(() => {
      document.getElementById('A')!.showPopover();
      document.getElementById('P2')!.showPopover();
      const hitA = document.elementsFromPoint(400, 300).map((e) => e.id || e.tagName);
      const hitP2 = document.elementsFromPoint(150, 120).map((e) => e.id || e.tagName);
      document.getElementById('inA')!.focus();
      const fa = document.activeElement?.id;
      document.getElementById('inP2')!.focus();
      return { hitA, hitP2, fa, fp: document.activeElement?.id };
    });
    expect(r.fa).not.toBe('inA');
    expect({ ...r, fa: null }).toEqual({ hitA: ['fs', 'HTML'], hitP2: ['inP2', 'P2', 'fs', 'HTML'], fa: null, fp: 'inP2' });
    await page.evaluate(() => document.exitFullscreen());
  });
});
