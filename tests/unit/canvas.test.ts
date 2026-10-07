import { createServer, type Server } from 'node:http';
import { deflateSync } from 'node:zlib';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/canvas/data';
import { columnsKey, loadProbe, loadRaster, loadSpinner, sameColumns } from '@/widgets/canvas-lab/model/run';
import type { LineKind } from '@/widgets/canvas-lab/model/types';

/**
 * Тема «Canvas 2D и OffscreenCanvas: рисовать вне DOM».
 *
 * `RASTER_CODE` — учебная модель покрытия пикселя, строкой из темы: напечатана на странице
 * и исполняется демо. Здесь она сверяется с альфой Chromium (`STAND_COLUMNS`) во всех 64
 * случаях, а сам литерал снимается заново: тест поднимает Chromium из Playwright и исполняет
 * в нём `PROBE_CODE` — ту же строку, которой снят стенд и которую демо исполняет в браузере
 * читателя.
 *
 * Остальные строки кода темы (`HIT_CODE`, `FIT_CODE`, `STATE_CODE`, `PATH_CODE`, `CLEAR_CODE`,
 * `FRAME_CODE`, `TAINT_*`, `SPINNER_*`, `BITMAP_CODE`) исполняются в странице как есть;
 * адрес `cdn.example.com` подменяется вторым сервером на соседнем порту — другим origin.
 * Таймеров нет: воркер проверяется порядком (кадры внутри окна блокировки есть у воркера
 * и нет у страницы), а не частотой.
 */

const PORT_A = 53190;
const PORT_B = 53191;
const A = `http://127.0.0.1:${PORT_A}`;
const B = `http://127.0.0.1:${PORT_B}`;

const raster = loadRaster(t.RASTER_CODE);
const probeLocal = loadProbe(t.PROBE_CODE); // в Node не исполняется — только собирается

/** PNG w×h одним цветом — без библиотек, как на стенде. */
function png(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgba, y * (1 + w * 4) + 1 + x * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const IMG = png(4, 4, [200, 30, 30, 255]);
const requests: { port: number; path: string; origin: string | null }[] = [];
const pages: Record<string, string> = {};

function serve(port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    requests.push({ port, path: url.pathname + url.search, origin: (req.headers.origin as string) ?? null });
    if (url.pathname === '/img.png' || url.pathname === '/photo.png') {
      const h: Record<string, string> = { 'content-type': 'image/png', 'cache-control': 'no-store' };
      if (url.searchParams.get('cors') === '1') h['access-control-allow-origin'] = '*';
      res.writeHead(200, h);
      return res.end(IMG);
    }
    if (url.pathname === '/spinner.js') {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      return res.end(t.SPINNER_WORKER_CODE);
    }
    const body = pages[url.pathname] ?? '<!doctype html><meta charset=utf-8><body style="margin:0">';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok(srv)));
}

let srvA: Server;
let srvB: Server;
let browser: Browser;

beforeAll(async () => {
  srvA = await serve(PORT_A);
  srvB = await serve(PORT_B);
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await Promise.all([srvA, srvB].map((s) => new Promise((ok) => s?.close(ok))));
});

async function open(path = '/', dpr = 1, viewport = { width: 400, height: 300 }): Promise<Page> {
  const ctx = await browser.newContext({ deviceScaleFactor: dpr, viewport });
  const page = await ctx.newPage();
  await page.goto(A + path);
  return page;
}

/** Исполнить строку кода темы в странице: `ctx` и `canvas` — холст w×h; `tail` — что вернуть. */
async function runCode(page: Page, code: string, tail: string, size: [number, number] = [20, 4]) {
  return page.evaluate(
    async ({ code, tail, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size[0];
      canvas.height = size[1];
      const ctx = canvas.getContext('2d')!;
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      try {
        return { ok: true, v: await new AsyncFunction('canvas', 'ctx', `${code}\n${tail}`)(canvas, ctx) };
      } catch (e) {
        return { ok: false, name: (e as Error).name, msg: (e as Error).message };
      }
    },
    { code, tail, size },
  );
}

const ALPHA = (xs: number[], y: number) => `return [${xs.join(',')}].map((x) => ctx.getImageData(x, ${y}, 1, 1).data[3]);`;

describe('модель покрытия против Chromium', () => {
  const keys = () => {
    const out: [LineKind, number, number, number][] = [];
    for (const k of t.LINE_CASES.kinds)
      for (const s of t.LINE_CASES.scales)
        for (const x of t.LINE_CASES.xs) for (const w of t.LINE_CASES.widths) out.push([k.value, s, x, w]);
    return out;
  };

  it('в литерале ровно 64 случая — все варианты демо', () => {
    expect(keys()).toHaveLength(64);
    expect(Object.keys(t.STAND_COLUMNS).sort()).toEqual(keys().map(([k, s, x, w]) => columnsKey(k, s, x, w)).sort());
    expect(typeof probeLocal).toBe('function');
  });

  it('rasterColumns совпадает с альфой Chromium с допуском 1: расходятся 43 ячейки из 1152', () => {
    let diff = 0;
    let max = 0;
    for (const [k, s, x, w] of keys()) {
      const model = raster.rasterColumns(k, x, w, s);
      const stand = t.STAND_COLUMNS[columnsKey(k, s, x, w)];
      expect(sameColumns(model, stand), `${k} ${s} ${x} ${w}`).toBe(true);
      model.forEach((v, i) => {
        const d = Math.abs(v - stand[i]);
        if (d) diff++;
        max = Math.max(max, d);
      });
    }
    expect(max).toBe(1);
    expect(diff).toBe(43);
    expect(t.DEMO_CAPTION).toContain('не больше единицы');
  });

  it('PROBE_CODE в Chromium заново даёт литерал стенда — при DPR страницы 1 и 2', async () => {
    for (const dpr of [1, 2]) {
      const page = await open('/', dpr);
      const got = await page.evaluate(
        ({ code, cases }) => {
          const probe = new Function(`${code}\nreturn probeColumns;`)();
          return cases.map(([k, s, x, w]) => probe(k, x, w, s));
        },
        { code: t.PROBE_CODE, cases: keys() },
      );
      keys().forEach(([k, s, x, w], i) => expect(got[i], `${dpr}: ${k} ${s} ${x} ${w}`).toEqual(t.STAND_COLUMNS[columnsKey(k, s, x, w)]));
      await page.context().close();
    }
  }, 60_000);

  it('таблица LINE_ROWS — из литерала', () => {
    const c = (k: LineKind, s: number, x: number, w: number) => t.STAND_COLUMNS[columnsKey(k, s, x, w)];
    expect(c('stroke', 1, 3, 1).slice(2, 4)).toEqual([127, 128]);
    expect(c('stroke', 1, 3.5, 1).filter(Boolean)).toEqual([255]);
    expect(c('stroke', 1, 3.5, 1)[3]).toBe(255);
    expect(c('fill', 1, 3, 1)[3]).toBe(255);
    expect(c('fill', 1, 3, 1).filter(Boolean)).toHaveLength(1);
    expect(c('stroke', 1, 3, 2).slice(2, 4)).toEqual([255, 255]);
    expect(c('stroke', 2, 3, 1).slice(5, 7)).toEqual([255, 255]);
    expect(c('stroke', 2, 3, 1).filter(Boolean)).toHaveLength(2);
    expect(c('stroke', 1.5, 3.5, 1).slice(4, 6)).toEqual([128, 255]);
    // LINE_NOTE: на DPR 2 чётко и на 3, и на 3.5, мажется на 3.25; на DPR 3 целая — серые края
    expect(c('stroke', 2, 3.5, 1).filter(Boolean)).toEqual([255, 255]);
    expect(c('stroke', 2, 3.25, 1).filter(Boolean)).toEqual([127, 255, 127]);
    expect(c('stroke', 3, 3, 1).filter(Boolean)).toEqual([127, 255, 255, 127]);
    expect(t.LINE_NOTE).toContain('`127, 255, 255, 127`');
    // на DPR 1.5 чёткой линии в 1px нет ни на одной из четырёх координат
    for (const x of t.LINE_CASES.xs) expect(c('stroke', 1.5, x, 1).some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('crispX кладёт линию на целые точки — по модели и в Chromium', async () => {
    const page = await open('/');
    for (const s of [1, 2, 3]) {
      for (const x of [3, 3.25, 3.5, 3.75, 10]) {
        for (const w of [1, 2]) {
          const cx = raster.crispX(x, w, s);
          expect(Math.abs(cx - x)).toBeLessThanOrEqual(0.5 / s + 1e-9);
          const model = raster.rasterColumns('stroke', cx, w, s, 40);
          expect(model.every((v) => v === 0 || v === 255), `${s} ${x} ${w}`).toBe(true);
          const real = await page.evaluate(
            ({ code, cx, w, s }) => new Function(`${code}\nreturn probeColumns;`)()('stroke', cx, w, s, 40),
            { code: t.PROBE_CODE, cx, w, s },
          );
          expect(real).toEqual(model);
        }
      }
    }
    await page.context().close();
  }, 30_000);
});

describe('два размера холста', () => {
  it('буфер по умолчанию 300×150 при CSS 100×50', async () => {
    const page = await open('/');
    const r = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.style.cssText = 'width:100px;height:50px;display:block';
      document.body.append(c);
      return { buffer: [c.width, c.height], client: [c.clientWidth, c.clientHeight] };
    });
    expect(r).toEqual(t.SIZE_DEFAULT);
    await page.context().close();
  });

  it('BLUR_ROWS: NAIVE_CODE мылится, FIT_CODE — нет; снимки экрана при DPR 1, 2, 3', async () => {
    pages['/blur'] = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff">
<canvas id=naive style="width:40px;height:20px;display:block"></canvas>
<canvas id=fit style="width:40px;height:20px;display:block"></canvas>
<script>
function line(ctx) {
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 40, 20);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(10.5, 0); ctx.lineTo(10.5, 20); ctx.stroke();
}
{ const canvas = document.getElementById('naive');
${t.NAIVE_CODE}
line(canvas.getContext('2d')); }
${t.FIT_CODE}
line(fitCanvas(document.getElementById('fit')));
</script>`;
    const reader = await open('/');
    for (const row of t.BLUR_ROWS) {
      const page = await open('/blur', row.dpr, { width: 200, height: 100 });
      const sizes = await page.evaluate(() => ['naive', 'fit'].map((id) => {
        const c = document.getElementById(id) as HTMLCanvasElement;
        return [c.width, c.height];
      }));
      expect(sizes).toEqual([row.naiveBuffer, row.fitBuffer]);
      expect(raster.bufferSize(40, 20, row.dpr)).toEqual({ width: row.fitBuffer[0], height: row.fitBuffer[1] });
      for (const id of ['naive', 'fit'] as const) {
        const shot = await page.locator('#' + id).screenshot();
        const dark = await reader.evaluate(async (b64) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext('2d')!;
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, Math.floor(c.height / 2), c.width, 1).data;
          const out: [number, number][] = [];
          for (let i = 0; i < c.width; i++) if (d[i * 4] < 255) out.push([i, d[i * 4]]);
          return out;
        }, shot.toString('base64'));
        expect(dark, `${id} @${row.dpr}`).toEqual(row[id]);
      }
      await page.context().close();
    }
    await reader.context().close();
    expect(t.BLUR_NOTE).toContain('`191, 63, 63, 191`');
  }, 60_000);

  it('MEMORY_ROWS: байты буфера 800×600 × DPR', async () => {
    for (const row of t.MEMORY_ROWS) {
      const page = await open('/', row.dpr, { width: 1000, height: 700 });
      const r = await page.evaluate(`(() => {
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'width:800px;height:600px;display:block';
        document.body.append(canvas);
        ${t.FIT_CODE}
        const ctx = fitCanvas(canvas);
        return { buffer: [canvas.width, canvas.height], bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data.byteLength };
      })()`);
      expect(r).toEqual({ buffer: row.buffer, bytes: row.bytes });
      await page.context().close();
    }
    expect(t.MEMORY_NOTE).toContain('17,3 МБ');
    expect((t.MEMORY_ROWS[2].bytes / 1e6).toFixed(1)).toBe('17.3');
    expect(t.MEMORY_ROWS[2].bytes / t.MEMORY_ROWS[0].bytes).toBe(9);
  }, 30_000);
});

describe('битмап, а не дерево', () => {
  it('HIT_CODE: событие на холсте, попадание — isPointInPath; SVG — три узла', async () => {
    const page = await open('/');
    const log: string[] = [];
    page.on('console', (m) => log.push(m.text()));
    const r = await page.evaluate((code) => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 50;
      c.style.cssText = 'position:absolute;left:0;top:0';
      document.body.append(c);
      const out: Record<string, unknown> = {};
      const patched = code
        .replace('document.elementFromPoint(25, 25);', 'out.target = document.elementFromPoint(25, 25).tagName;')
        .replace('canvas.childNodes.length;', 'out.children = canvas.childNodes.length;');
      new Function('out', `${patched}\nout.inPath = [ctx.isPointInPath(dot, 25, 25), ctx.isPointInPath(dot, 50, 25)];`)(out);
      return out;
    }, t.HIT_CODE);
    expect(r).toEqual({ target: t.HIT.canvasTarget, children: t.HIT.canvasChildren, inPath: t.HIT.isPointInPath });
    await page.mouse.click(25, 25);
    await page.mouse.click(50, 25);
    await page.waitForTimeout(50);
    expect(log).toEqual(['круг']);

    const svg = await page.evaluate(() => {
      document.body.innerHTML =
        '<svg width="100" height="50" style="position:absolute;left:0;top:0"><circle cx="25" cy="25" r="10"/><circle cx="50" cy="25" r="10"/><circle cx="75" cy="25" r="10"/></svg>';
      const s = document.querySelector('svg')!;
      return { target: document.elementFromPoint(25, 25)!.tagName, children: s.childNodes.length };
    });
    expect(svg).toEqual({ target: t.HIT.svgTarget, children: t.HIT.svgChildren });
    await page.context().close();
  });

  it('AX_TREE: нарисованный текст не в дереве, запасное содержимое — в дереве и в Tab', async () => {
    pages['/a11y'] = `<!doctype html><html lang=ru><meta charset=utf-8><body>${t.A11Y_HTML}`;
    const page = await open('/a11y');
    const cdp = await page.context().newCDPSession(page);
    type AX = { nodeId: string; ignored: boolean; role?: { value: string }; name?: { value: string }; childIds?: string[] };
    const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as { nodes: AX[] };
    const byId = new Map(nodes.map((n) => [n.nodeId, n]));
    const lines: string[] = [];
    const SKIP = new Set(['RootWebArea', 'InlineTextBox']);
    const walk = (n: AX, depth: number, top: boolean) => {
      const role = n.role?.value ?? '';
      // обёртки верхнего уровня (`body`) — `generic` без имени — не показываются
      const blank = role === 'StaticText' && !n.name?.value.trim(); // перевод строки в разметке
      const skip = n.ignored || SKIP.has(role) || blank || (top && role === 'generic' && !n.name?.value);
      if (!skip) lines.push(`${'  '.repeat(depth)}${role}${n.name?.value ? ` "${n.name.value}"` : ''}`);
      for (const c of n.childIds ?? []) walk(byId.get(c)!, skip ? depth : depth + 1, skip && top);
    };
    walk(nodes[0], 0, true);
    expect(lines.join('\n')).toBe(t.AX_TREE);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement!.outerHTML)).toBe(t.A11Y_FIRST_TAB);
    await page.context().close();
  });
});

describe('состояние и путь', () => {
  it('STATE_CODE: save/restore возвращает цвет, толщину и матрицу; лишний restore молчит', async () => {
    const page = await open('/');
    const lines = t.STATE_CODE.split('\n');
    const upToTranslate = lines.slice(0, lines.findIndex((l) => l.includes('translate')) + 1).join('\n');
    const upToRestore = lines.slice(0, lines.findIndex((l) => l.includes('всё вернулось')) + 1).join('\n');
    const read = 'return [ctx.fillStyle, ctx.lineWidth, ctx.getTransform().e];';
    const got = [
      await runCode(page, upToTranslate, read),
      await runCode(page, upToRestore, read),
      await runCode(page, t.STATE_CODE, read),
    ];
    expect(got.map((g) => g.v)).toEqual(t.STATE_LOG);
    expect(t.STATE_CODE).toContain("'#ff0000'");

    // путь в состояние не входит: restore не стирает набранный путь
    const path = await runCode(page, 'ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 5, 4); ctx.restore(); ctx.fill();', ALPHA([2], 2));
    expect(path.v).toEqual([255]);
    await page.context().close();
  });

  it('PATH_CODE: без beginPath 175, 148, 112, 64; с ним — по 64', async () => {
    const page = await open('/');
    const cols = ALPHA([2, 6, 10, 14], 2);
    const without = await runCode(page, t.PATH_CODE, cols);
    const withBegin = await runCode(page, t.PATH_CODE.replace(/\/\/ ctx\.beginPath\(\);.*$/m, 'ctx.beginPath();'), cols);
    expect(without.v).toEqual(t.PATH_ALPHA.without);
    expect(withBegin.v).toEqual(t.PATH_ALPHA.with);
    // 1 − 0.75ⁿ — формула из PATH_NOTE
    expect([4, 3, 2, 1].map((n) => Math.round(255 * (1 - 0.75 ** n)))).toEqual([174, 147, 112, 64]);
    expect(t.PATH_NOTE).toContain('`175, 148, 112, 64`');
    await page.context().close();
  });

  it('CLEAR_CODE: clearRect под сдвигом стирает не то', async () => {
    const page = await open('/');
    const lines = t.CLEAR_CODE.split('\n');
    const partial = await runCode(page, lines.slice(0, 3).join('\n'), 'ctx.setTransform(1,0,0,1,0,0);' + ALPHA([5, 15], 2));
    const full = await runCode(page, t.CLEAR_CODE, ALPHA([5, 15], 2));
    expect(partial.v).toEqual(t.CLEAR_ALPHA.underTranslate);
    expect(full.v).toEqual(t.CLEAR_ALPHA.afterReset);
    await page.context().close();
  });

  it('canvas.width = canvas.width сбрасывает буфер и состояние', async () => {
    const page = await open('/');
    const r = await runCode(
      page,
      "ctx.fillStyle = 'red'; ctx.translate(3, 0); ctx.lineWidth = 5; ctx.fillRect(0, 0, 5, 4);\nconst read = () => [ctx.getImageData(4, 2, 1, 1).data[3], ctx.fillStyle, ctx.lineWidth, ctx.getTransform().e];\nconst before = read();\ncanvas.width = canvas.width;",
      'return { before, after: read() };',
    );
    expect(r.v).toEqual(t.RESET);
    await page.context().close();
  });
});

describe('цена кадра', () => {
  it('FRAME_CODE рисует фон из OffscreenCanvas одной копией', async () => {
    const page = await open('/');
    const r = await runCode(
      page,
      `let ships = 0;
const drawBackground = (g) => { g.fillStyle = '#00f'; g.fillRect(0, 0, 2, 2); };
const drawShip = (g) => { ships++; g.fillRect(10, 1, 1, 1); };
const calls = [];
const orig = ctx.drawImage.bind(ctx);
ctx.drawImage = (...a) => { calls.push(a[0].constructor.name); return orig(...a); };
${t.FRAME_CODE}
await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));`,
      'return { bg: Array.from(ctx.getImageData(0, 0, 1, 1).data), ship: ctx.getImageData(10, 1, 1, 1).data[3], ships, kinds: [...new Set(calls)] };',
    );
    const v = r.v as { bg: number[]; ship: number; ships: number; kinds: string[] };
    expect(v.bg).toEqual([0, 0, 255, 255]);
    expect(v.ship).toBe(255);
    expect(v.ships).toBeGreaterThanOrEqual(1);
    expect(v.kinds).toEqual(['OffscreenCanvas']);
    await page.context().close();
  });

  it('LAYERS: каждый 2D-холст — свой слой с причиной Canvas; то же с willReadFrequently и WebGL', async () => {
    const mk = (kind: '2d' | 'wrf' | 'webgl') => `<!doctype html><body style="margin:0"><div style="position:relative;width:300px;height:150px">
<canvas id=bg width=300 height=150 style="position:absolute;inset:0"></canvas>
<canvas id=fg width=300 height=150 style="position:absolute;inset:0"></canvas></div>
<canvas id=small width=20 height=20></canvas>
<script>
const opt = ${kind === 'wrf' ? '{ willReadFrequently: true }' : '{}'};
${kind === 'webgl' ? "bg.getContext('webgl').clearColor(1,0,0,1);" : "const g1 = bg.getContext('2d', opt); g1.fillStyle = '#eef'; g1.fillRect(0,0,300,150);"}
fg.getContext('2d', opt).fillRect(10,10,5,5);
small.getContext('2d', opt).fillRect(0,0,5,5);
</script>`;
    for (const kind of ['2d', 'wrf', 'webgl'] as const) {
      pages[`/layers-${kind}`] = mk(kind);
      const page = await open(`/layers-${kind}`, 1, { width: 1280, height: 720 });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('DOM.getDocument');
      type L = { layerId: string; backendNodeId?: number; width: number; height: number };
      let layers: L[] = [];
      cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: L[] }) => {
        if (e.layers) layers = e.layers;
      });
      await cdp.send('LayerTree.enable');
      await page.evaluate(() => {
        document.body.style.background = '#fafafa';
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await page.screenshot();
      const rows: [string, string, string][] = [];
      for (const l of layers) {
        if (!l.backendNodeId) continue;
        const d = (await cdp.send('DOM.describeNode', { backendNodeId: l.backendNodeId })) as { node: { localName: string; attributes?: string[] } };
        if (d.node.localName !== 'canvas') continue;
        const a = d.node.attributes ?? [];
        const r = (await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId })) as { compositingReasonIds: string[] };
        rows.push([`canvas#${a[a.indexOf('id') + 1]}`, `${l.width}×${l.height}`, r.compositingReasonIds.join('+')]);
      }
      expect(rows.sort(), kind).toEqual([...t.LAYERS.rows].sort());
      await page.context().close();
    }
  }, 60_000);

  it('READBACK_WARNING: предупреждение после серии getImageData', async () => {
    const page = await open('/');
    const log: string[] = [];
    page.on('console', (m) => log.push(m.text()));
    await page.evaluate(() => {
      const g = document.createElement('canvas').getContext('2d')!;
      for (let i = 0; i < 6; i++) g.getImageData(0, 0, 1, 1);
    });
    await page.waitForTimeout(50);
    expect(log.some((l) => l.startsWith(t.READBACK_WARNING))).toBe(true);
    await page.context().close();
  });
});

describe('чужие пиксели', () => {
  const foreign = (code: string, query = '') => code.replace('https://cdn.example.com/chart.png', `${B}/img.png${query}`);

  it('TAINT_CODE: рисуется, getImageData — SecurityError; TAINT_OK_CODE — пиксель 200,30,30,255', async () => {
    const page = await open('/');
    const bad = await runCode(page, foreign(t.TAINT_CODE, '?case=taint'), '', [4, 4]);
    expect(bad).toMatchObject({ ok: false, name: 'SecurityError', msg: t.TAINT_ERRORS.getImageData });
    const ok = await runCode(page, foreign(t.TAINT_OK_CODE, '?cors=1&case=ok').replace(/\.data;(.*)$/m, '.data;'), 'return Array.from(ctx.getImageData(0, 0, 1, 1).data);', [4, 4]);
    expect(ok.v).toEqual([200, 30, 30, 255]);
    expect(t.TAINT_OK_CODE).toContain('[200, 30, 30, 255]');
    await page.context().close();
  });

  it('TAINT_ROWS и TAINT_FACTS', async () => {
    requests.length = 0;
    const page = await open('/');
    const r = await page.evaluate(
      async ({ A, B }) => {
        const load = (src: string, co?: string) =>
          new Promise<HTMLImageElement | null>((res) => {
            const i = new Image();
            if (co) i.crossOrigin = co;
            i.onload = () => res(i);
            i.onerror = () => res(null);
            i.src = src;
          });
        const tryIt = (f: () => unknown) => {
          try {
            return f();
          } catch (e) {
            return (e as Error).name;
          }
        };
        const mk = () => {
          const c = document.createElement('canvas');
          c.width = 4;
          c.height = 4;
          return [c, c.getContext('2d')!] as const;
        };
        const out: Record<string, unknown> = {};
        const same = (await load(`${A}/img.png?case=same`))!;
        {
          const [c, g] = mk();
          g.drawImage(same, 0, 0);
          out.same = [Array.from(g.getImageData(0, 0, 1, 1).data).join(','), c.toDataURL().slice(0, 22)];
        }
        const img = (await load(`${B}/img.png?case=nocors`))!;
        const [c, g] = mk();
        out.draw = tryIt(() => (g.drawImage(img, 0, 0), 'drawn'));
        out.read = tryIt(() => g.getImageData(0, 0, 1, 1));
        out.toDataURL = tryIt(() => c.toDataURL());
        out.toDataURLmsg = (() => {
          try {
            c.toDataURL();
          } catch (e) {
            return (e as Error).message;
          }
        })();
        out.toBlob = tryIt(() => c.toBlob(() => {}));
        g.clearRect(0, 0, 4, 4);
        out.afterClear = tryIt(() => g.getImageData(0, 0, 1, 1));
        {
          const [, g2] = mk();
          g2.drawImage(c, 0, 0);
          out.spread = tryIt(() => g2.getImageData(0, 0, 1, 1));
        }
        c.width = 4;
        out.afterWidth = tryIt(() => g.getImageData(0, 0, 1, 1).data[3]);
        out.corsNoHeader = (await load(`${B}/img.png?case=noheader`, 'anonymous')) ? 'loaded' : 'onerror';
        {
          const bm = await createImageBitmap(img);
          const [, g3] = mk();
          g3.drawImage(bm, 0, 0);
          out.bitmap = [bm.width, bm.height, tryIt(() => g3.getImageData(0, 0, 1, 1))];
        }
        {
          const oc = new OffscreenCanvas(4, 4);
          const og = oc.getContext('2d')!;
          og.drawImage(img, 0, 0);
          out.offscreen = [tryIt(() => og.getImageData(0, 0, 1, 1)), await oc.convertToBlob().then(() => 'ok', (e: Error) => e.name)];
        }
        out.fetch = await fetch(`${B}/img.png?case=fetch`).then(() => 'ok', (e: Error) => e.name);
        return out;
      },
      { A, B },
    );
    expect(r.same).toEqual(['200,30,30,255', 'data:image/png;base64,']);
    expect(r.draw).toBe('drawn');
    expect(r.read).toBe('SecurityError');
    expect(r.toDataURL).toBe('SecurityError');
    expect(r.toDataURLmsg).toBe(t.TAINT_ERRORS.toDataURL);
    expect(r.toBlob).toBe('SecurityError');
    expect(r.afterClear).toBe('SecurityError');
    expect(r.spread).toBe('SecurityError');
    expect(r.afterWidth).toBe(0); // Chromium снимает пятно — TAINT_ENGINES
    expect(t.TAINT_ENGINES[0]).toMatchObject({ engine: 'Chromium 153', tone: 'ok' });
    expect(r.corsNoHeader).toBe('onerror');
    expect(r.bitmap).toEqual([4, 4, 'SecurityError']);
    expect(r.offscreen).toEqual(['SecurityError', 'SecurityError']);
    expect(r.fetch).toBe('TypeError');
    // запрос без crossOrigin ушёл без Origin, с crossOrigin — с ним
    const byCase = (c: string) => requests.find((q) => q.path.includes(`case=${c}`));
    expect(byCase('nocors')?.origin).toBeNull();
    expect(byCase('noheader')?.origin).toBe(A);
    await page.context().close();
  });
});

describe('OffscreenCanvas и ImageBitmap', () => {
  it('SPINNER_*: при занятом главном потоке воркер рисует кадры, страница — ни одного', async () => {
    pages['/spin'] = `<!doctype html><meta charset=utf-8><body style="margin:0">
<canvas id=spinner width=40 height=40></canvas><canvas id=main width=40 height=40></canvas>
<script>
window.marks = [];
const realWorker = window.Worker;
window.Worker = class extends realWorker {
  constructor(url) { super(url); this.addEventListener('message', ({ data }) => marks.push({ src: 'worker', ...data, got: performance.timeOrigin + performance.now() })); }
};
${t.SPINNER_MAIN_CODE}
const drawSpinner = new Function('self', ${JSON.stringify(t.SPINNER_WORKER_CODE)} + '\\nreturn drawSpinner;')({});
const g = document.getElementById('main').getContext('2d');
let f = 0;
(function tick() { f++; drawSpinner(g, f, '#000'); marks.push({ src: 'main', frame: f, at: performance.timeOrigin + performance.now() }); requestAnimationFrame(tick); })();
window.busy = (ms) => { const t0 = performance.timeOrigin + performance.now(); while (performance.timeOrigin + performance.now() - t0 < ms) {} return [t0, performance.timeOrigin + performance.now()]; };
</script>`;
    const page = await open('/spin');
    await page.waitForFunction(() => (window as unknown as { marks: { src: string }[] }).marks.filter((m) => m.src === 'worker').length > 5);
    const [t0, t1] = await page.evaluate(
      (ms) => (window as unknown as { busy: (ms: number) => [number, number] }).busy(ms),
      t.WORKER_RUNS[0].busyMs,
    );
    await page.waitForTimeout(200);
    const r = await page.evaluate(
      ([t0, t1]) => {
        const marks = (window as unknown as { marks: { src: string; at: number; got?: number }[] }).marks;
        const inside = (src: string) => marks.filter((m) => m.src === src && m.at > t0 && m.at < t1);
        return {
          worker: inside('worker').length,
          main: inside('main').length,
          lateDelivery: inside('worker').every((m) => (m.got ?? 0) >= t1),
        };
      },
      [t0, t1],
    );
    expect(r.main).toBe(0);
    expect(r.worker).toBeGreaterThan(10);
    expect(r.lateDelivery).toBe(true);
    expect(t.WORKER_RUNS.every((w) => w.mainFrames === 0 && w.workerFrames > 0)).toBe(true);
    expect(t.WORKER_NOTE).toContain('около шестидесяти');
    await page.context().close();
  }, 30_000);

  it('loadSpinner достаёт drawSpinner из файла воркера, не трогая onmessage', () => {
    const draw = loadSpinner(t.SPINNER_WORKER_CODE);
    const calls: string[] = [];
    const fake = new Proxy(
      { canvas: { width: 40, height: 20 } } as Record<string, unknown>,
      {
        get: (o, k) => (k in o ? o[k as string] : (...a: unknown[]) => calls.push(`${String(k)}(${a.length})`)),
        set: (o, k, v) => ((o[k as string] = v), true),
      },
    );
    draw(fake as unknown as CanvasRenderingContext2D, 1, '#000');
    expect(calls).toEqual(['clearRect(4)', 'beginPath(0)', 'arc(5)', 'stroke(0)']);
  });

  it('BITMAP_CODE и BITMAP_ROWS', async () => {
    const page = await open('/');
    const code = t.BITMAP_CODE.replace(/^bitmap\.width;\s+\/\/ 4.*$/m, 'const w1 = bitmap.width;').replace(
      /^bitmap\.width;\s+\/\/ 0$/m,
      'const w2 = bitmap.width;',
    );
    const r = await runCode(page, code, 'return [w1, bitmap.height, w2, ctx.getImageData(0, 0, 1, 1).data[3]];', [8, 8]);
    expect(r.v).toEqual([4, 0, 0, 255]);

    const facts = await page.evaluate(async () => {
      const tryIt = (f: () => unknown) => {
        try {
          return f();
        } catch (e) {
          return (e as Error).name;
        }
      };
      const out: Record<string, unknown> = {};
      const bm = await createImageBitmap(new ImageData(8, 8), { resizeWidth: 4, resizeHeight: 2 });
      out.resize = [bm.width, bm.height];
      const closed = await createImageBitmap(new ImageData(8, 8));
      closed.close();
      out.close = [closed.width, closed.height, tryIt(() => document.createElement('canvas').getContext('2d')!.drawImage(closed, 0, 0))];
      const moved = await createImageBitmap(new ImageData(8, 8));
      const w = new Worker(URL.createObjectURL(new Blob(['onmessage = () => {}'])));
      w.postMessage(moved, [moved]);
      out.moved = [moved.width, moved.height];
      w.terminate();
      const oc = new OffscreenCanvas(4, 4);
      const og = oc.getContext('2d')!;
      og.fillRect(0, 0, 4, 4);
      const frame = oc.transferToImageBitmap();
      out.transferTo = [frame.width, frame.height, og.getImageData(0, 0, 1, 1).data[3]];
      const shown = document.createElement('canvas');
      shown.getContext('bitmaprenderer')!.transferFromImageBitmap(frame);
      out.transferFrom = [frame.width, frame.height];
      const el = document.createElement('canvas');
      el.transferControlToOffscreen();
      out.element = [
        tryIt(() => el.getContext('2d')),
        tryIt(() => {
          el.width = 20;
        }),
        tryIt(() => el.transferControlToOffscreen()),
      ];
      const ww = new Worker(
        URL.createObjectURL(
          new Blob([
            'postMessage([typeof OffscreenCanvas, typeof createImageBitmap, typeof requestAnimationFrame, typeof devicePixelRatio, typeof document])',
          ]),
        ),
      );
      out.worker = await new Promise((res) => (ww.onmessage = (e) => res(e.data)));
      return out;
    });
    expect(facts.resize).toEqual([4, 2]);
    expect(facts.close).toEqual([0, 0, 'InvalidStateError']);
    expect(facts.moved).toEqual([0, 0]);
    expect(facts.transferTo).toEqual([4, 4, 0]);
    expect(facts.transferFrom).toEqual([0, 0]);
    expect(facts.element).toEqual(['InvalidStateError', 'InvalidStateError', 'InvalidStateError']);
    expect(facts.worker).toEqual(['function', 'function', 'function', 'undefined', 'undefined']);
    await page.context().close();
  });
});

describe('ссылки и текст', () => {
  it('ссылки «Где разобрано» и «Смежное» ведут на существующие разделы', async () => {
    const { readFileSync } = await import('node:fs');
    const all = [t.RELATED, t.CHOICE_NOTE, t.MEMORY_NOTE, t.LAYER_NOTE, t.WORKER_LINK, ...t.A11Y_FACTS.map((f) => f.d), ...t.PREREQ.map((p) => p.href ?? '')].join(' ');
    const links = [...all.matchAll(/\/(js|render|platform)\/([a-z0-9-]+)\/#(s\d+)/g)];
    expect(links.length).toBeGreaterThan(10);
    for (const [, dir, slug, anchor] of links) {
      const col = dir === 'js' ? 'lessons' : dir;
      const mdx = readFileSync(new URL(`../../src/content/${col}/${slug}/index.mdx`, import.meta.url), 'utf8');
      expect(mdx, `${dir}/${slug}#${anchor}`).toMatch(new RegExp(`\\{ id: ${anchor},`));
    }
  });
});
