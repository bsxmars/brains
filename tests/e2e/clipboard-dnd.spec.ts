import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  chromium,
  expect,
  firefox,
  test,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type Page,
} from '@playwright/test';
import {
  COPY_CODE,
  COPY_EVENT_CODE,
  COPY_EVENT_MARKUP,
  COPY_EVENT_OUT,
  COPY_MARKUP,
  COPY_OUT,
  COPY_ROWS,
  DRAG_CODE,
  DRAG_MARKUP,
  DRAG_OUT,
  ENGINE_ROWS,
  FILE_DROP_CODE,
  FILE_DROP_MARKUP,
  FILE_DROP_OUT,
  GUARD_CODE,
  ITEM_CODE,
  ITEM_OUT,
  LATE_CODE,
  MODES_ROWS,
  PASTE_IMAGE_CODE,
  PASTE_IMAGE_OUT,
  READ_CODE,
  READ_OUT_DENIED,
  READ_OUT_GRANTED,
  SANITIZE_CODE,
  SANITIZE_OUT,
  SUPPORTS_ROWS,
  WEB_FORMAT_CODE,
  WEB_FORMAT_OUT,
} from '../../src/content/lessons/clipboard-dnd/data';

/**
 * «Буфер обмена и перетаскивание» — каждый пример и каждая строка таблиц запуском.
 *
 * Страница отдаётся с выдуманного `https://clipboard-dnd.test` через `page.route`:
 * `navigator.clipboard` есть только в безопасном контексте, а `https:` под `route` им считается.
 * Примеры кода — те же строки, что напечатаны в теме: разметка `*_MARKUP` и `<script>` с `*_CODE`.
 *
 * ⚠️ Две ловушки стенда (подробно — в шапке `data.ts`):
 *   — `page.evaluate` исполняется **с жестом пользователя**. Всё, что утверждает «без клика»,
 *     снимается скриптом самой страницы до первого `evaluate`, а ждётся `waitForTimeout`;
 *   — headless shell без выданного `clipboard-write` отказывает в записи и по клику. Настоящий
 *     Chrome выдаёт запись сам, поэтому строки «по клику» сняты с `clipboard-write`.
 *
 * Firefox и WebKit запускаются прямо отсюда, как в `task-scheduling-engines.spec.ts`: нужны их
 * бинари. Полный Chromium (`channel: 'chromium'`) — для фокуса документа и для файла, брошенного
 * мимо зоны: headless shell считает каждую вкладку в фокусе и брошенный файл не открывает.
 * Буфер обмена у браузеров Playwright свой — системный буфер прогон не трогает.
 */

const ORIGIN = 'https://clipboard-dnd.test';
const FIXTURES = resolve('tests/fixtures/clipboard-dnd');
const DOT_PNG = readFileSync(join(FIXTURES, 'dot.png'));

const html = (body: string, script = '', module = false) =>
  `<!doctype html><meta charset="utf-8"><style>div{width:220px;height:70px;margin:12px}</style>` +
  `<body>${body}<script${module ? ' type="module"' : ''}>${script}</script></body>`;

interface Stand {
  page: Page;
  context: BrowserContext;
  logs: string[];
}

async function stand(
  browser: Browser,
  body: string,
  { perms = [], routes = {} }: { perms?: string[]; routes?: Record<string, () => Promise<string>> } = {},
): Promise<Stand> {
  const context = await browser.newContext();
  if (perms.length) await context.grantPermissions(perms, { origin: ORIGIN });
  const page = await context.newPage();
  await page.route(`${ORIGIN}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (routes[path]) return route.fulfill({ contentType: 'text/plain', body: await routes[path]() });
    return route.fulfill({ contentType: 'text/html', body });
  });
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.goto(`${ORIGIN}/`);
  return { page, context, logs };
}

/** Исполнить строку примера в странице как тело асинхронной функции (с жестом — см. шапку). */
const run = (page: Page, code: string) => page.evaluate(`(async () => {\n${code}\n})()`);

async function withBrowser<T>(type: BrowserType, fn: (b: Browser) => Promise<T>, opts = {}): Promise<T> {
  const browser = await type.launch(opts);
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

const selectAll = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(s)!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  }, selector);

/** Настоящий `drop` файлов системы: CDP `Input.dispatchDragEvent` с путями на диске. */
async function dropFiles(s: Stand, x: number, y: number, files: string[]) {
  const cdp = await s.context.newCDPSession(s.page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  }
}

// ─── Раздел «Копировать по кнопке» ─────────────────────────────────────────────────────────

test.describe('копировать по кнопке', () => {
  test('COPY_CODE пишет по клику, READ_CODE читает только с разрешения', async ({ browser }) => {
    const s = await stand(browser, html(COPY_MARKUP, `${COPY_CODE}\n${READ_CODE}`), { perms: ['clipboard-write'] });
    await s.page.click('#copy');
    await expect.poll(() => s.logs).toContain(COPY_OUT);
    await s.page.click('#paste');
    await expect.poll(() => s.logs).toContain(READ_OUT_DENIED);
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    await s.page.click('#paste');
    await expect.poll(() => s.logs).toContain(READ_OUT_GRANTED);
    expect(s.logs.filter((l) => l.startsWith('pageerror'))).toEqual([]);
    await s.context.close();
  });

  test('строки COPY_ROWS: без клика, через 3 и 6 с, с разрешением на чтение', async ({ browser }) => {
    const probe = `window.out = {};
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const res = (k, p) => p.then(() => out[k] = 'ok', (e) => out[k] = e.name);
      setTimeout(() => { res('loadWrite', navigator.clipboard.writeText('a')); res('loadRead', navigator.clipboard.readText()); }, 200);
      document.querySelector('#copy').onclick = async () => {
        res('clickWrite', navigator.clipboard.writeText('b'));
        await sleep(3000); res('after3', navigator.clipboard.writeText('c'));
        await sleep(3000); res('after6', navigator.clipboard.writeText('d'));
      };`;
    const s = await stand(browser, html(COPY_MARKUP, probe), { perms: ['clipboard-write'] });
    await s.page.waitForTimeout(1000); // без evaluate: он дал бы жест
    await s.page.click('#copy');
    await s.page.waitForTimeout(6800);
    const out = (await s.page.evaluate('window.out')) as Record<string, string>;
    expect(out).toEqual({
      loadWrite: 'NotAllowedError',
      loadRead: 'NotAllowedError',
      clickWrite: 'ok',
      after3: 'ok',
      after6: 'NotAllowedError',
    });
    expect(COPY_ROWS[0].write).toBe('проходит');
    expect(COPY_ROWS[1].write).toContain(out.loadWrite);
    expect(COPY_ROWS[2].write).toContain(out.after6);
    await s.context.close();

    // сайту разрешено чтение — запись проходит без клика
    const g = await stand(
      browser,
      html('', `setTimeout(() => navigator.clipboard.writeText('x').then(() => window.r = 'ok', (e) => window.r = e.name), 200);`),
      { perms: ['clipboard-read', 'clipboard-write'] },
    );
    await g.page.waitForTimeout(1000);
    expect(await g.page.evaluate('window.r')).toBe('ok');
    expect(COPY_ROWS[3].write).toContain('проходит');
    await g.context.close();
  });

  test('документ без фокуса: «Document is not focused» (полный Chromium)', async () => {
    await withBrowser(
      chromium,
      async (browser) => {
        const s = await stand(browser, html('<input>'), { perms: ['clipboard-read', 'clipboard-write'] });
        const cdp = await s.context.newCDPSession(s.page);
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
        const other = await s.context.newPage();
        await other.goto('about:blank');
        await other.bringToFront();
        const got = await s.page.evaluate(async () => ({
          focus: document.hasFocus(),
          write: await navigator.clipboard.writeText('z').then(() => 'ok', (e: Error) => `${e.name}: ${e.message}`),
          read: await navigator.clipboard.readText().then(() => 'ok', (e: Error) => `${e.name}: ${e.message}`),
        }));
        expect(got.focus).toBe(false);
        expect(got.write).toMatch(/^NotAllowedError: .*Document is not focused/);
        expect(got.read).toMatch(/^NotAllowedError: .*Document is not focused/);
        expect(COPY_ROWS[4].write).toContain('Document is not focused');
      },
      { channel: 'chromium' },
    );
  });

  test('LATE_CODE: ClipboardItem с промисом дожидается ответа дольше жизни жеста', async ({ browser }) => {
    const invite = 'https://clipboard-dnd.test/invite/7f3a';
    const s = await stand(browser, html(COPY_MARKUP, `const copy = document.querySelector('#copy');\n${LATE_CODE}`), {
      perms: ['clipboard-write'],
      routes: { '/api/invite': () => new Promise((r) => setTimeout(() => r(invite), 6500)) },
    });
    await s.page.click('#copy');
    await s.page.waitForTimeout(7200);
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
    expect(await s.page.evaluate(() => navigator.clipboard.readText())).toBe(invite);
    await s.context.close();
  });
});

const ENGINES: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

for (const [name, type] of ENGINES) {
  test(`ENGINE_ROWS и жест в ${name}: запись по клику, чтение по своим правилам, промис ждёт`, async () => {
    test.setTimeout(60_000); // два ожидания по 7 с: жизнь жеста и поздний промис
    const row = ENGINE_ROWS.find((r) => r.engine.toLowerCase().startsWith(name))!;
    await withBrowser(type, async (browser) => {
      const probe = `window.out = {};
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const res = (k, p) => p.then(() => out[k] = 'ok', (e) => out[k] = e.name);
        setTimeout(() => { res('loadWrite', navigator.clipboard.writeText('a')); res('loadRead', navigator.clipboard.readText()); }, 200);
        document.querySelector('#copy').onclick = async () => {
          res('foreignRead', navigator.clipboard.readText());   // в буфере не наше
          const w = navigator.clipboard.writeText('b');
          res('clickWrite', w);
          w.then(() => res('ownRead', navigator.clipboard.readText()));   // в буфере наше
          await sleep(3000); res('after3', navigator.clipboard.writeText('c'));
          await sleep(3000); res('after6', navigator.clipboard.writeText('d'));
        };
        document.querySelector('#paste').onclick = () => res('lateItem', navigator.clipboard.write([new ClipboardItem({
          'text/plain': sleep(6500).then(() => new Blob(['поздно'], { type: 'text/plain' })) })]));`;
      const s = await stand(browser, html(COPY_MARKUP, probe), { perms: name === 'chromium' ? ['clipboard-write'] : [] });
      await s.page.waitForTimeout(1000);
      await s.page.click('#copy');
      await s.page.waitForTimeout(6800);
      await s.page.click('#paste');
      await s.page.waitForTimeout(7200);
      const out = (await s.page.evaluate('window.out')) as Record<string, string>;
      expect(out.loadWrite).toBe('NotAllowedError');
      expect(out.loadRead).toBe('NotAllowedError');
      expect(out.clickWrite).toBe('ok');
      expect(out.after3).toBe('ok');
      expect(out.after6).toBe('NotAllowedError');
      expect(out.lateItem).toBe('ok');
      expect(row.write).toContain('по жесту');
      // чтение по клику. Chromium — нужно разрешение. Firefox своё отдаёт сразу, а чужое ждёт кнопки
      // «Вставить»: промис не разрешился за 14 с. WebKit без кнопки отказывает в обоих случаях.
      // 2026-11-03 в полном прогоне Firefox 3 раза из 3 отклонил чужое чтение сразу (`NotAllowedError`),
      // а при написании темы промис ждал кнопки дольше 14 с. Похоже, решает содержимое системного
      // буфера и возможность показать кнопку; тема так и говорит — допускаем оба исхода, но не `ok`.
      if (name === 'firefox') {
        expect([undefined, 'NotAllowedError']).toContain(out.foreignRead);
        expect(out.ownRead).toBe('ok');
      } else {
        expect({ foreignRead: out.foreignRead, ownRead: out.ownRead }).toEqual({ foreignRead: 'NotAllowedError', ownRead: 'NotAllowedError' });
      }
      expect(row.read).toContain(name === 'chromium' ? 'clipboard-read' : name === 'firefox' ? 'либо ждёт, либо отклоняется' : 'NotAllowedError');
    });
  });
}

// ─── Раздел «События copy, cut и paste» ────────────────────────────────────────────────────

test.describe('события copy, cut и paste', () => {
  test('COPY_EVENT_CODE подменяет копируемое; без preventDefault setData пропадает', async ({ browser }) => {
    const s = await stand(browser, html(COPY_EVENT_MARKUP, COPY_EVENT_CODE), { perms: ['clipboard-read', 'clipboard-write'] });
    await selectAll(s.page, 'p');
    await s.page.keyboard.press('ControlOrMeta+c');
    await expect.poll(() => s.page.evaluate(() => navigator.clipboard.readText())).toBe(COPY_EVENT_OUT);
    await s.context.close();

    const probe = `window.log = [];
      document.addEventListener('copy', (e) => { log.push(e.clipboardData.types.length); e.clipboardData.setData('text/plain', 'своё'); });
      document.addEventListener('cut', (e) => log.push('cut ' + e.target.nodeName));
      setTimeout(() => log.push('exec-load ' + document.execCommand('copy')), 100);
      document.querySelector('button').onclick = () => log.push('exec-click ' + document.execCommand('copy'));`;
    const n = await stand(browser, html(`${COPY_EVENT_MARKUP}<button>b</button>`, probe), { perms: ['clipboard-read', 'clipboard-write'] });
    await n.page.waitForTimeout(500);
    await selectAll(n.page, 'p');
    await n.page.keyboard.press('ControlOrMeta+c');
    await n.page.waitForTimeout(100);
    expect(await n.page.evaluate(() => navigator.clipboard.readText())).toBe('Цена: 1 990 ₽');
    await n.page.keyboard.press('ControlOrMeta+x');
    await n.page.click('button');
    const log = (await n.page.evaluate('window.log')) as (string | number)[];
    expect(log[0]).toBe('exec-load false');
    expect(log[1]).toBe(0); // в начале copy clipboardData пуст
    expect(log).toContain('cut P');
    expect(log).toContain('exec-click true');
    expect(await n.page.textContent('p')).toBe('Цена: 1 990 ₽');
    await n.context.close();
  });

  test('PASTE_IMAGE_CODE: картинка из буфера приходит файлом image.png, перекодированной', async ({ browser }) => {
    const probe = `${PASTE_IMAGE_CODE}
      document.addEventListener('paste', (e) => { window.got = { target: e.target.nodeName, types: [...e.clipboardData.types], size: e.clipboardData.files[0]?.size };
        window.saved = e.clipboardData; setTimeout(() => window.later = [saved.types.length, saved.files.length, saved.items.length]); });`;
    const s = await stand(browser, html('<button>кнопка</button>', probe), { perms: ['clipboard-read', 'clipboard-write'] });
    const b64 = DOT_PNG.toString('base64');
    const bad = await s.page.evaluate(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
      return navigator.clipboard
        .write([new ClipboardItem({ 'image/png': new Blob(['не картинка'], { type: 'image/png' }) })])
        .then(() => 'ok', (e: Error) => e.name);
    }, b64);
    expect(bad).toBe('DataError');
    await s.page.click('button');
    await s.page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => s.logs).toContain(PASTE_IMAGE_OUT);
    await s.page.waitForTimeout(100);
    const got = (await s.page.evaluate('[window.got, window.later]')) as [{ target: string; types: string[]; size: number }, number[]];
    expect(got[0].target).toBe('BUTTON');
    expect(got[0].types).toEqual(['Files']);
    expect(got[0].size).not.toBe(DOT_PNG.length); // браузер раскодировал и закодировал заново
    expect(got[1]).toEqual([0, 0, 0]); // после события clipboardData пуст
    await s.context.close();
  });
});

// ─── Раздел «Форматы» ──────────────────────────────────────────────────────────────────────

test.describe('форматы', () => {
  test('ITEM_CODE, SANITIZE_CODE и WEB_FORMAT_CODE в Chromium', async ({ browser }) => {
    const s = await stand(browser, html(''), { perms: ['clipboard-read', 'clipboard-write'] });
    for (const [code, out] of [
      [ITEM_CODE, ITEM_OUT],
      [SANITIZE_CODE, SANITIZE_OUT],
      [WEB_FORMAT_CODE, WEB_FORMAT_OUT],
    ] as const) {
      s.logs.length = 0;
      await run(s.page, code);
      expect(s.logs).toEqual([...out]);
    }
    const mismatch = await s.page.evaluate(() =>
      navigator.clipboard
        .write([new ClipboardItem({ 'text/plain': new Blob(['x'], { type: 'text/html' }) })])
        .then(() => 'ok', (e: Error) => e.name),
    );
    expect(mismatch).toBe('NotAllowedError');
    await s.context.close();
  });

  test('Firefox тоже чистит HTML и не слушает unsanitized; web-формат ему неизвестен', async () => {
    await withBrowser(firefox, async (browser) => {
      const s = await stand(browser, html(''));
      await run(s.page, SANITIZE_CODE);
      expect(s.logs).toHaveLength(2);
      for (const line of s.logs) {
        expect(line).toContain('<b>жирный</b>');
        expect(line).not.toContain('onerror');
        expect(line).not.toContain('<script');
      }
      const err = await s.page.evaluate(() => {
        try {
          new ClipboardItem({ 'web application/x-board+json': new Blob(['{}']) });
          return 'ok';
        } catch (e) {
          return (e as Error).name;
        }
      });
      expect(err).toBe('TypeError');
    });
  });

  for (const [name, type] of ENGINES) {
    test(`SUPPORTS_ROWS в ${name}`, async () => {
      await withBrowser(type, async (browser) => {
        const s = await stand(browser, html(''));
        const types = SUPPORTS_ROWS.map((r) => r.type.replaceAll('`', ''));
        const got = await s.page.evaluate((ts) => ts.map((t) => ClipboardItem.supports(t)), types);
        const expected = SUPPORTS_ROWS.map((r) => r[name as 'chromium' | 'firefox' | 'webkit'] === 'да');
        expect(got).toEqual(expected);
        if (name === 'webkit') {
          // WebKit неподдержанный тип не отклонил — утверждение SUPPORTS_NOTE
          const w = await s.page.evaluate(() =>
            navigator.clipboard
              .write([new ClipboardItem({ 'image/jpeg': new Blob(['x'], { type: 'image/jpeg' }) })])
              .then(() => 'ok', (e: Error) => e.name),
          );
          expect(w).toBe('ok');
        }
      });
    });

    test(`свой MIME через copy доходит до paste в ${name}, а read() его не видит`, async () => {
      await withBrowser(type, async (browser) => {
        const probe = `window.log = [];
          document.addEventListener('copy', (e) => { e.clipboardData.setData('text/plain', 'плоско'); e.clipboardData.setData('application/x-card', '{"id":1}'); e.preventDefault(); });
          document.addEventListener('paste', (e) => log.push([e.clipboardData.types.includes('application/x-card'), e.clipboardData.getData('application/x-card')]));`;
        const s = await stand(browser, html('<p>текст</p>', probe), { perms: name === 'chromium' ? ['clipboard-read', 'clipboard-write'] : [] });
        await s.page.waitForTimeout(300);
        await selectAll(s.page, 'p');
        await s.page.keyboard.press('ControlOrMeta+c');
        await s.page.evaluate(() => getSelection()!.removeAllRanges());
        await s.page.keyboard.press('ControlOrMeta+v');
        await s.page.waitForTimeout(200);
        expect(await s.page.evaluate('window.log')).toEqual([[true, '{"id":1}']]);
        if (name !== 'webkit') {
          const types = await s.page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
          expect(types).toEqual(['text/plain']);
        }
      });
    });
  }

  test('формат с web в событии paste не виден', async ({ browser }) => {
    const s = await stand(browser, html('', `document.addEventListener('paste', (e) => window.types = [...e.clipboardData.types]);`), {
      perms: ['clipboard-read', 'clipboard-write'],
    });
    await run(s.page, WEB_FORMAT_CODE);
    await s.page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => s.page.evaluate('window.types')).toEqual(['text/plain']);
    await s.context.close();
  });
});

// ─── Разделы «Перетаскивание» и «Режимы DataTransfer» ──────────────────────────────────────

test.describe('перетаскивание', () => {
  test('DRAG_CODE: dragenter видит только тип, drop — данные, dragend — move', async ({ browser }) => {
    const s = await stand(browser, html(DRAG_MARKUP, DRAG_CODE));
    await s.page.dragAndDrop('#card-42', '#paid');
    await expect.poll(() => s.logs.length).toBeGreaterThanOrEqual(3);
    expect(s.logs).toEqual(DRAG_OUT);
    expect(await s.page.locator('#paid #card-42').count()).toBe(1);
    expect(MODES_ROWS[1].what).toContain('пустая строка');
    await s.context.close();
  });

  test('без preventDefault в dragover и при чужом dropEffect drop не приходит', async ({ browser }) => {
    const probe = `window.log = [];
      const card = document.querySelector('#card');
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('Application/X-Card', '1'); e.dataTransfer.effectAllowed = 'move'; log.push(e.dataTransfer.types.join()); window.saved = e.dataTransfer; });
      card.addEventListener('dragend', (e) => log.push('dragend ' + e.dataTransfer.dropEffect + ' later:' + JSON.stringify(saved.getData('application/x-card'))));
      document.querySelector('#copy').addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      for (const z of document.querySelectorAll('.zone')) z.addEventListener('drop', (e) => { e.preventDefault(); log.push('drop ' + z.id); });
      document.querySelector('#yes').addEventListener('dragover', (e) => e.preventDefault());`;
    const body = '<div id="card" draggable="true">карточка</div><div class="zone" id="yes">да</div><div class="zone" id="no">нет</div><div class="zone" id="copy">copy</div>';
    const s = await stand(browser, html(body, probe));
    const take = async () => {
      const l = (await s.page.evaluate('window.log')) as string[];
      await s.page.evaluate('window.log = []');
      return l;
    };
    await s.page.dragAndDrop('#card', '#no');
    await s.page.waitForTimeout(100);
    expect(await take()).toEqual(['application/x-card', 'dragend none later:""']);
    await s.page.dragAndDrop('#card', '#copy');
    await s.page.waitForTimeout(100);
    expect(await take()).toEqual(['application/x-card', 'dragend none later:""']);
    await s.page.dragAndDrop('#card', '#yes'); // только dragover, без dragenter
    await s.page.waitForTimeout(100);
    expect(await take()).toEqual(['application/x-card', 'drop yes', 'dragend move later:""']);
    await s.context.close();
  });

  for (const [name, type] of ENGINES) {
    test(`draggable по умолчанию, tabIndex и синтетический DragEvent в ${name}`, async () => {
      await withBrowser(type, async (browser) => {
        const body = '<div id="card" draggable="true">к</div><div id="plain">д</div><img id="im" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><a id="ln" href="/x">с</a>';
        const s = await stand(browser, html(body));
        const got = await s.page.evaluate(() => {
          const $ = (id: string) => document.getElementById(id) as HTMLElement;
          const dt = new DataTransfer();
          dt.setData('text/plain', 'из кода');
          let seen: [boolean, string] | null = null;
          $('plain').addEventListener('dragover', (e) => (seen = [e.isTrusted, e.dataTransfer!.getData('text/plain')]));
          $('plain').dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          return {
            div: $('plain').draggable,
            img: $('im').draggable,
            a: $('ln').draggable,
            tabIndex: $('card').tabIndex,
            seen,
            handle: typeof (DataTransferItem.prototype as { getAsFileSystemHandle?: unknown }).getAsFileSystemHandle,
          };
        });
        expect(got).toEqual({
          div: false,
          img: true,
          a: true,
          tabIndex: -1,
          seen: [false, 'из кода'],
          handle: name === 'chromium' ? 'function' : 'undefined',
        });
      });
    });
  }

  test('Firefox отдаёт данные в dragover и после события', async () => {
    await withBrowser(firefox, async (browser) => {
      const probe = `window.log = [];
        const card = document.querySelector('#card');
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', 'card-1'); window.saved = e.dataTransfer; });
        card.addEventListener('dragend', () => log.push('later ' + saved.getData('text/plain')));
        const z = document.querySelector('#zone');
        z.addEventListener('dragover', (e) => { e.preventDefault(); if (!log.length) log.push('dragover ' + e.dataTransfer.getData('text/plain')); });
        z.addEventListener('drop', (e) => e.preventDefault());`;
      const s = await stand(browser, html('<div id="card" draggable="true">к</div><div id="zone">з</div>', probe));
      await s.page.dragAndDrop('#card', '#zone');
      await s.page.waitForTimeout(200);
      expect(await s.page.evaluate('window.log')).toEqual(['dragover card-1', 'later card-1']);
    });
  });
});

// ─── Раздел «Файлы и папки из системы» ─────────────────────────────────────────────────────

test.describe('файлы из системы', () => {
  const note = join(FIXTURES, 'drop/note.txt');
  const photos = join(FIXTURES, 'drop/photos');

  test('FILE_DROP_CODE обходит папку; dragover видит только Files', async ({ browser }) => {
    const probe = `${FILE_DROP_CODE}
      zone.addEventListener('dragover', (e) => { window.over ??= [[...e.dataTransfer.types], e.dataTransfer.files.length, [...e.dataTransfer.items].map((i) => i.kind)]; });
      zone.addEventListener('drop', async (e) => {
        const files = [...e.dataTransfer.files];
        const items = [...e.dataTransfer.items];
        const dir = files.find((f) => f.name === 'photos');
        const handles = await Promise.all(items.map((i) => i.getAsFileSystemHandle()));
        window.folder = { type: dir.type, read: await dir.text().then(() => 'ok', (err) => err.name), kinds: handles.map((h) => h.kind) };
        await new Promise((r) => setTimeout(r));
        window.after = [items[0].kind, items[0].getAsFile(), e.dataTransfer.files.length, (await files[0].text()).length > 0];
      });`;
    const s = await stand(browser, html(FILE_DROP_MARKUP, probe));
    const box = (await s.page.locator('#zone').boundingBox())!;
    await dropFiles(s, box.x + 20, box.y + 20, [note, photos]);
    await expect.poll(() => s.logs.length).toBeGreaterThanOrEqual(3);
    expect([...s.logs].sort()).toEqual([...FILE_DROP_OUT].sort());
    await expect.poll(() => s.page.evaluate('window.after')).toEqual(['', null, 0, true]);
    expect(await s.page.evaluate('window.over')).toEqual([['Files'], 0, ['file', 'file']]);
    expect(await s.page.evaluate('window.folder')).toEqual({ type: '', read: 'NotFoundError', kinds: ['file', 'directory'] });
    await s.context.close();
  });

  test('readEntries отдаёт папку пачками по сто', async ({ browser }) => {
    const dir = mkdtempSync(join(tmpdir(), 'clipboard-dnd-'));
    try {
      const many = join(dir, 'many');
      mkdirSync(many);
      for (let i = 0; i < 150; i++) writeFileSync(join(many, `f${i}.txt`), 'x');
      const probe = `${FILE_DROP_CODE}
        zone.addEventListener('drop', async (e) => {
          const reader = e.dataTransfer.items[0].webkitGetAsEntry().createReader();
          const batches = [];
          for (;;) { const b = await new Promise((ok) => reader.readEntries(ok)); if (!b.length) break; batches.push(b.length); }
          window.batches = batches;
        });`;
      const s = await stand(browser, html(FILE_DROP_MARKUP, probe));
      const box = (await s.page.locator('#zone').boundingBox())!;
      await dropFiles(s, box.x + 20, box.y + 20, [many]);
      await expect.poll(() => s.page.evaluate('window.batches')).toEqual([100, 50]);
      await expect.poll(() => s.logs.length).toBe(150); // walk из примера прошёл все пачки
      await s.context.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('файл мимо зоны Chromium открывает во вкладке; GUARD_CODE это отменяет', async () => {
    await withBrowser(
      chromium,
      async (browser) => {
        for (const guard of [false, true]) {
          const s = await stand(browser, html('<p>страница</p>', guard ? GUARD_CODE : ''));
          await dropFiles(s, 50, 50, [note]);
          await s.page.waitForTimeout(1500);
          const opened = s.context.pages().map((p) => p.url()).filter((u) => u.startsWith('file://'));
          expect(opened.length, guard ? 'с GUARD_CODE файл не открылся' : 'без защиты файл открылся').toBe(guard ? 0 : 1);
          await s.context.close();
        }
      },
      { channel: 'chromium' },
    );
  });
});
