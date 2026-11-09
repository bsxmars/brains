import { chromium, firefox, webkit, type Browser, type BrowserType, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/iframe/data';
import { buildProbeDoc, cellsOf, readReport, sandboxValue, type ProbeResult } from '@/widgets/iframe-lab/model/probe';
import { withBrowser } from '../helpers/with-browser';

/**
 * Тема «iframe»: каждое утверждение о поведении снято в настоящих браузерах.
 *
 * Три сайта — `https://shop.example` (родитель), `https://widget.example` (встроенный виджет)
 * и `https://evil.example` (куда фрейм уводят) — существуют только в перехвате запросов
 * Playwright (`context.route`): ни DNS, ни сертификатов не нужно, а для браузера это три
 * разных сайта на https. Примеры кода — те же строки, что печатает тема.
 *
 * Тяжёлый тест: запускает Chromium, Firefox, WebKit и ещё раз полный Chromium.
 * Таймерный замер один — «Цена фрейма», и он закрепляет порядок величины, а не миллисекунды.
 */

const SHOP = 'https://shop.example/';
const WIDGET = 'https://widget.example/';
const EVIL = 'https://evil.example/';

/** Слушатель сообщений, который пишет всё в `window.msgs` — вставляется в документы стенда. */
const REC = '<meta charset="utf-8"><script>window.msgs=[];addEventListener("message",e=>msgs.push([e.origin,e.data]))</script>';

type Engine = 'chromium' | 'firefox' | 'webkit';
const TYPES: Record<Engine, BrowserType> = { chromium, firefox, webkit };
const ENGINES: Engine[] = ['chromium', 'firefox', 'webkit'];
const browsers = {} as Record<Engine, Browser>;

beforeAll(async () => {
  for (const e of ENGINES) browsers[e] = await TYPES[e].launch();
}, 120_000);

afterAll(async () => {
  for (const e of ENGINES) await browsers[e]?.close();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Свежий контекст, где адреса из `pages` отдаются перехватом, а всё остальное — 404.
 * `hits` — журнал запрошенных адресов (без query), по нему видно, что браузер загрузил.
 */
async function site<T>(
  browser: Browser,
  pages: Record<string, string>,
  fn: (page: Page, hits: string[]) => Promise<T>,
): Promise<T> {
  const ctx = await browser.newContext();
  const hits: string[] = [];
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    const key = u.origin + u.pathname;
    hits.push(key);
    const body = pages[key];
    if (body === undefined) return route.fulfill({ status: 404, body: 'нет' });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
  const page = await ctx.newPage();
  try {
    return await fn(page, hits);
  } finally {
    await ctx.close();
  }
}

const doc = (body: string) => `<!doctype html>${REC}${body}`;

describe.each(ENGINES)('%s', (engine) => {
  const b = () => browsers[engine];

  describe('«Как встроить»', () => {
    it('EMBED_CODE: у src — источник адреса, у srcdoc — источник родителя и адрес about:srcdoc', async () => {
      await site(b(), { [SHOP]: doc(t.EMBED_CODE), 'https://widget.example/chat': doc('<p>чат</p>') }, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const frames = page.frames().slice(1);
        const seen = await Promise.all(frames.map((f) => f.evaluate(() => [location.href, self.origin])));
        expect(seen).toContainEqual(['https://widget.example/chat', 'https://widget.example']);
        expect(seen).toContainEqual(['about:srcdoc', 'https://shop.example']);
        const titles = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => f.title));
        expect(titles).toEqual(['Чат поддержки', 'Документ из строки']);
      });
    });

    it('размер без атрибутов — 300 × 150 и рамка 2px inset (DEFAULT_SIZE)', async () => {
      await site(b(), { [SHOP]: doc('<iframe></iframe>') }, async (page) => {
        await page.goto(SHOP);
        const size = await page.evaluate(() => {
          const f = document.querySelector('iframe')!;
          const cs = getComputedStyle(f);
          return { client: [f.clientWidth, f.clientHeight], offset: [f.offsetWidth, f.offsetHeight], border: `${cs.borderTopWidth} ${cs.borderTopStyle}` };
        });
        expect(size).toEqual(t.DEFAULT_SIZE);
      });
    });

    it('loading="lazy": фрейм ниже экрана не запрошен до прокрутки', async () => {
      const pages = {
        [SHOP]: doc('<div style="height:6000px"></div><iframe loading="lazy" src="https://widget.example/lazy"></iframe>'),
        'https://widget.example/lazy': doc('lazy'),
      };
      await site(b(), pages, async (page, hits) => {
        await page.goto(SHOP);
        await wait(800);
        expect(hits).not.toContain('https://widget.example/lazy');
        await page.evaluate(() => document.querySelector('iframe')!.scrollIntoView());
        await expect.poll(() => hits.includes('https://widget.example/lazy'), { timeout: 5000 }).toBe(true);
      });
    });
  });

  describe('«Свой и чужой фрейм»', () => {
    it('ACCESS_CODE: каждая строка с комментарием-значением отвечает так, как написано', async () => {
      const pages = {
        [SHOP]: doc('<iframe id="own" src="/help"></iframe><iframe id="chat" src="https://widget.example/chat"></iframe>'),
        'https://shop.example/help': doc('<title>Помощь</title>'),
        'https://widget.example/chat': doc('чат'),
        'https://widget.example/faq': doc('faq'),
      };
      // Строка `выражение; // значение — пояснение`. Значение — первое слово комментария.
      const CHECK = /^(.*?);\s*\/\/ ('[^']*'|null|false|true|\d+|SecurityError|ок)(?=\s|$)/;
      const lines = t.ACCESS_CODE.split('\n');
      const checks: { expr: string; want: string }[] = [];
      const body = lines
        .map((line) => {
          const m = CHECK.exec(line);
          if (!m) return line;
          checks.push({ expr: m[1].trim(), want: m[2] });
          return `try { __r.push(__show(${m[1].trim()})); } catch (e) { __r.push(e.name); }`;
        })
        .join('\n');
      expect(checks.length).toBeGreaterThanOrEqual(7);

      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const got: string[] = await page.evaluate(
          `(() => { const __r = []; const __show = (v) => v === null ? 'null' : typeof v === 'string' ? "'" + v + "'" : String(v);\n${body}\nreturn __r; })()`,
        );
        const want = checks.map((c) => c.want);
        // «ок» — строка не бросила; присваивание возвращает адрес.
        const norm = got.map((g, i) => (want[i] === 'ок' && !/Error$/.test(g) ? 'ок' : g));
        expect(norm, checks.map((c) => c.expr).join(' | ')).toEqual(want);
        // и фрейм действительно ушёл по присвоенному адресу
        await expect.poll(() => page.frames().map((f) => f.url())).toContain('https://widget.example/faq');
      });
    });

    it('CROSS_ORIGIN_NAMES: у чужого окна ровно эти собственные свойства', async () => {
      await site(b(), { [SHOP]: doc('<iframe src="https://widget.example/"></iframe>'), [WIDGET]: doc('w') }, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const names = await page.evaluate(() =>
          Object.getOwnPropertyNames(document.querySelector('iframe')!.contentWindow!).filter((n) => !/^\d+$/.test(n)).sort(),
        );
        expect(names).toEqual(t.CROSS_ORIGIN_NAMES);
        // ESCAPE_NOTE: документу чужого источника свой тег не виден
        expect(await page.frames()[1].evaluate(() => window.frameElement)).toBeNull();
        expect(t.ACCESS_NOTE, 'тема называет число имён без then').toContain('13 имён');
        expect(t.CROSS_ORIGIN_NAMES.filter((n) => n !== 'then')).toHaveLength(13);
      });
    });
  });

  describe('«Разговор: postMessage»', () => {
    it('MESSAGE_*_CODE: виджет получает тему, фрейм evil.example с тем же ready — ничего', async () => {
      const pages = {
        [SHOP]: doc(`<iframe id="chat" src="https://widget.example/chat"></iframe><iframe id="evil" src="https://evil.example/"></iframe><script>${t.MESSAGE_PARENT_CODE}</script>`),
        'https://widget.example/chat': doc(`<script>${t.MESSAGE_CHILD_CODE}</script>`),
        [EVIL]: doc(`<script>parent.postMessage({ type: 'ready' }, '*')</script>`),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const chat = page.frames().find((f) => f.url().startsWith('https://widget.example'))!;
        await expect.poll(() => chat.evaluate(() => document.body.dataset.theme)).toBe('dark');
        const evil = page.frames().find((f) => f.url().startsWith(EVIL))!;
        await wait(200);
        expect(await evil.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs)).toEqual([]);
      });
    });

    it('сообщение до подписки теряется (тонкое место «Сообщение пришло раньше подписки»)', async () => {
      const pages = {
        [SHOP]: doc('<iframe src="https://widget.example/"></iframe>'),
        [WIDGET]: doc(`<script>parent.postMessage({ type: 'ready' }, '*')</script>`),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        await wait(300);
        const late = await page.evaluate(async () => {
          const got: unknown[] = [];
          addEventListener('message', (e) => got.push(e.data));
          await new Promise((r) => setTimeout(r, 300));
          return got;
        });
        expect(late).toEqual([]);
        // контроль: ранний слушатель из REC сообщение видел
        expect(await page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
      });
    });

    it('функция в данных — DataCloneError у отправителя (MESSAGE_NOTE)', async () => {
      await site(b(), { [SHOP]: doc('<iframe src="https://widget.example/"></iframe>'), [WIDGET]: doc('') }, async (page) => {
        await page.goto(SHOP);
        const name = await page.evaluate(() => {
          try {
            frames[0].postMessage({ fn: () => 1 }, '*');
            return 'ok';
          } catch (e) {
            return (e as Error).name;
          }
        });
        expect(name).toBe('DataCloneError');
        expect(t.MESSAGE_NOTE).toContain('`DataCloneError` у отправителя');
      });
    });

    it('TARGET_CODE и TARGET_ROWS: что получает фрейм, уведённый на evil.example', async () => {
      const pages = {
        [SHOP]: doc('<iframe id="chat" src="https://widget.example/"></iframe>'),
        [WIDGET]: doc('w'),
        [EVIL]: doc('evil'),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        await page.evaluate(() => {
          frames[0].location.href = 'https://evil.example/';
        });
        await expect.poll(() => page.frames()[1]?.url()).toBe(EVIL);
        await page.frames()[1].waitForLoadState('load');
        const evil = () => page.frames()[1].evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length);

        // Строки TARGET_CODE по одной: после каждой — сколько дошло до evil.example.
        const sends = t.TARGET_CODE.split('\n').filter((l) => l.startsWith('chat.contentWindow.postMessage'));
        expect(sends).toHaveLength(3);
        const outcome: string[] = [];
        for (const line of sends) {
          const before = await evil();
          const err = await page.evaluate(`(() => { const token = 'секрет'; const chat = document.querySelector('#chat');
            try { ${line.split(/;\s+\/\/ /)[0]}; return 'ok'; } catch (e) { return e.name; } })()`);
          await wait(250);
          const after = await evil();
          outcome.push(err !== 'ok' ? (err as string) : after > before ? 'получил' : 'не получил');
        }
        expect(outcome).toEqual(['получил', 'не получил', 'SyntaxError']);
        expect(sends.map((l) => l.split(/;\s+\/\/ /)[1])).toEqual(['доставлено evil.example', 'выброшено молча', 'SyntaxError: нет схемы']);

        // Строка с путём: путь отбрасывается.
        const before = await evil();
        await page.evaluate(() => frames[0].postMessage('x', 'https://evil.example/any/path'));
        await wait(250);
        expect(await evil()).toBe(before + 1);
        expect(t.TARGET_ROWS.map((r) => r.got)).toEqual(['получил', 'не получил', 'получил', 'SyntaxError']);
      });
    });

    it("фрейм в песочнице: источник отправителя \"null\", 'null' адресатом — SyntaxError, '*' доходит (TARGET_NOTE)", async () => {
      await site(b(), { [SHOP]: doc('') }, async (page) => {
        await page.goto(SHOP);
        await page.evaluate(() => {
          const f = document.createElement('iframe');
          f.sandbox.value = 'allow-scripts';
          f.srcdoc = '<script>addEventListener("message", e => parent.postMessage({ got: e.data }, "*")); parent.postMessage("ready", "*")</script>';
          document.body.append(f);
        });
        await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
        const errs = await page.evaluate(() => {
          const w = document.querySelector('iframe')!.contentWindow!;
          const out: string[] = [];
          for (const target of ['null', '*']) {
            try {
              w.postMessage(`через ${target}`, target);
              out.push(`${target}: ok`);
            } catch (e) {
              out.push(`${target}: ${(e as Error).name}`);
            }
          }
          return out;
        });
        expect(errs).toEqual(['null: SyntaxError', '*: ok']);
        await wait(300);
        const msgs = await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs);
        expect(msgs).toEqual([
          ['null', 'ready'],
          ['null', { got: 'через *' }],
        ]);
      });
    });
  });

  describe('«Песочница»', () => {
    it('SANDBOX_MATRIX: проба демо отвечает так, как написано в таблице', async () => {
      const probe = buildProbeDoc({ bg: '#fff', text: '#000', mono: 'monospace' });
      await site(b(), { [SHOP]: doc('<title>Родитель</title>') }, async (page) => {
        await page.goto(SHOP);
        for (const row of t.SANDBOX_MATRIX) {
          const sb = sandboxValue(row.setup);
          const raw = await page.evaluate(
            ([html, sb]) =>
              new Promise<{ data: unknown; outside: 'null' | 'document' }>((resolve) => {
                const f = document.createElement('iframe');
                if (sb !== null) f.setAttribute('sandbox', sb);
                f.srcdoc = html;
                let data: unknown = null;
                const on = (e: MessageEvent) => {
                  if (e.source === f.contentWindow) data = e.data;
                };
                addEventListener('message', on);
                f.addEventListener('load', () =>
                  setTimeout(() => {
                    removeEventListener('message', on);
                    const outside = f.contentDocument ? 'document' : 'null';
                    f.remove();
                    resolve({ data, outside });
                  }, 800),
                );
                document.body.append(f);
              }),
            [probe, sb] as const,
          );
          const result: ProbeResult = { report: readReport(raw.data), outside: raw.outside };
          const want = [...row.cells];
          if (engine === 'webkit' && row.webkitCookie) want[4] = row.webkitCookie;
          expect(cellsOf(result), `${engine}: ${row.attr}`).toEqual(want);
        }
        // проба ничего не оставила в хранилище
        expect(await page.evaluate(() => localStorage.getItem('iframe-lab'))).toBeNull();
      });
    });

    it('ESCAPE_CODE: с allow-scripts allow-same-origin фрейм снимает с себя песочницу', async () => {
      const inner = `<script>
        const opened = () => { try { const w = window.open('about:blank'); if (w) w.close(); return w ? 'window' : 'null'; } catch (e) { return e.name; } };
        if (frameElement.hasAttribute('sandbox')) {
          parent.postMessage({ phase: 'до', open: opened() }, '*');
          ${t.ESCAPE_CODE}
        } else {
          parent.postMessage({ phase: 'после', open: opened() }, '*');
        }
      </script>`;
      await site(b(), { [SHOP]: doc('') }, async (page) => {
        await page.goto(SHOP);
        await page.evaluate((html) => {
          const f = document.createElement('iframe');
          f.sandbox.value = 'allow-scripts allow-same-origin';
          f.srcdoc = html;
          document.body.append(f);
        }, inner);
        await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(2);
        const msgs = await page.evaluate(() => (window as unknown as { msgs: [string, { phase: string; open: string }][] }).msgs.map((m) => m[1]));
        expect(msgs[0].phase).toBe('до');
        expect(msgs[0].open).not.toBe('window');
        expect(msgs[1]).toEqual({ phase: 'после', open: 'window' });
        expect(await page.evaluate(() => document.querySelector('iframe')!.hasAttribute('sandbox'))).toBe(false);
      });
    });

    it('SANDBOX_FLAGS: окна, модалки, переход вкладки и событие submit', async () => {
      const probe = `<form id="f" action="https://shop.example/sent"></form><script>
        const out = {};
        try { const w = window.open('about:blank'); out.open = w ? 'window' : 'null'; if (w) w.close(); } catch (e) { out.open = e.name; }
        alert('x'); out.alert = 'вернулся';
        let ev = false; f.addEventListener('submit', (e) => { ev = true; e.preventDefault(); }); f.requestSubmit(); out.submitEvent = ev;
        parent.postMessage(out, '*');
      </script>`;
      const run = (sb: string) =>
        site(b(), { [SHOP]: doc('') }, async (page) => {
          let dialogs = 0;
          page.on('dialog', (d) => {
            dialogs++;
            void d.dismiss();
          });
          await page.goto(SHOP);
          await page.evaluate(
            ([html, sb]) => {
              const f = document.createElement('iframe');
              f.setAttribute('sandbox', sb);
              f.srcdoc = html;
              document.body.append(f);
            },
            [probe, sb] as const,
          );
          await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
          const out = await page.evaluate(() => (window as unknown as { msgs: [string, { open: string; alert: string; submitEvent: boolean }][] }).msgs[0][1]);
          return { ...out, dialogs };
        });

      const bare = await run('allow-scripts');
      expect(bare.open).toBe(engine === 'firefox' ? 'InvalidAccessError' : 'null');
      expect(bare.dialogs, 'alert без allow-modals молчит').toBe(0);
      expect(bare.alert).toBe('вернулся');
      expect(bare.submitEvent, 'WebKit запускает submit и без allow-forms').toBe(engine === 'webkit');

      const all = await run('allow-scripts allow-popups allow-modals allow-forms');
      expect(all.open).toBe('window');
      expect(all.dialogs).toBe(1);
      expect(all.submitEvent).toBe(true);

      const popups = t.SANDBOX_FLAGS.find((f) => f.k === '`allow-popups`')!;
      expect(popups.without).toContain('`InvalidAccessError` (Firefox)');
    });

    it('sandbox.supports(): каких флагов нет (FLAGS_NOTE)', async () => {
      await site(b(), { [SHOP]: doc('') }, async (page) => {
        await page.goto(SHOP);
        const missing = await page.evaluate(
          (asked) => asked.filter((f) => !document.createElement('iframe').sandbox.supports(f)),
          t.SUPPORTS_ASKED,
        );
        expect(missing).toEqual(t.SUPPORTS_MISSING[engine]);
        expect(await page.evaluate(() => document.createElement('iframe').sandbox.supports('allow-xyz'))).toBe(false);
      });
    });
  });

  describe('«Права фрейма»', () => {
    it('FULLSCREEN_ROWS: document.fullscreenEnabled внутри фрейма', async () => {
      const report = '<script>parent.postMessage(document.fullscreenEnabled, "*")</script>';
      const cases: [string, string][] = [
        ['<iframe src="https://widget.example/"></iframe>', 'false'],
        ['<iframe allow="fullscreen" src="https://widget.example/"></iframe>', 'true'],
        ['<iframe allowfullscreen src="https://widget.example/"></iframe>', 'true'],
        ['<iframe src="/inner"></iframe>', 'true'],
        [`<iframe allow="fullscreen 'none'" src="/inner"></iframe>`, 'false'],
      ];
      const got: string[] = [];
      for (const [tag] of cases) {
        got.push(
          await site(b(), { [SHOP]: doc(tag), [WIDGET]: doc(report), 'https://shop.example/inner': doc(report) }, async (page) => {
            await page.goto(SHOP);
            await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
            return String(await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs[0][1]));
          }),
        );
      }
      expect(got).toEqual(cases.map((c) => c[1]));
      expect(t.FULLSCREEN_ROWS.map((r) => r.v)).toEqual(cases.map((c) => c[1]));
    });

    it('TOPNAV_NOTE: чужой фрейм без клика не уводит вкладку, с allow-top-navigation — уводит', async () => {
      const go = '<script>let r = "ok"; try { top.location = "https://evil.example/"; } catch (e) { r = e.name; } parent.postMessage(r, "*")</script>';
      const run = (attr: string) =>
        site(b(), { [SHOP]: doc(`<iframe ${attr} src="https://widget.example/"></iframe>`), [WIDGET]: doc(go), [EVIL]: doc('evil') }, async (page) => {
          await page.goto(SHOP);
          await wait(900);
          if (page.url() !== SHOP) return page.url();
          return String(await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs[0]?.[1]));
        });
      expect(await run('')).toBe('SecurityError');
      expect(await run('sandbox="allow-scripts"')).toBe('SecurityError');
      expect(await run('sandbox="allow-scripts allow-top-navigation"')).toBe(EVIL);
    });

    it('REFERRER_ROWS: document.referrer чужого фрейма', async () => {
      const got: string[] = [];
      for (const attr of ['', 'referrerpolicy="no-referrer"', 'referrerpolicy="unsafe-url"']) {
        got.push(
          await site(
            b(),
            { 'https://shop.example/cart': doc(`<iframe ${attr} src="https://widget.example/"></iframe>`), [WIDGET]: doc('<script>parent.postMessage(document.referrer, "*")</script>') },
            async (page) => {
              await page.goto('https://shop.example/cart?id=42');
              await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
              return String(await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs[0][1]));
            },
          ),
        );
      }
      const shown = (v: string) => (v === '' ? 'пустая строка' : `\`${v}\``);
      expect(got.map(shown)).toEqual(t.REFERRER_ROWS.map((r) => r[engine]));
    });

    it('credentialless есть только в Chromium (CREDENTIALLESS_NOTE)', async () => {
      await site(b(), { [SHOP]: doc('') }, async (page) => {
        await page.goto(SHOP);
        expect(await page.evaluate(() => 'credentialless' in HTMLIFrameElement.prototype)).toBe(engine === 'chromium');
      });
    });
  });

  describe('«Высота по содержимому»', () => {
    it('RESIZE_*_CODE: высота растёт с содержимым и сжимается обратно, полосы прокрутки нет', async () => {
      const pages = {
        [SHOP]: doc(`<iframe id="chat" src="https://widget.example/chat"></iframe><script>${t.RESIZE_PARENT_CODE}</script>`),
        'https://widget.example/chat': doc(`<p>виджет</p><script>${t.RESIZE_CHILD_CODE}</script>`),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const chat = page.frames()[1];
        const height = () => page.evaluate(() => parseFloat(document.querySelector<HTMLIFrameElement>('#chat')!.style.height));
        await expect.poll(height).toBeGreaterThan(0);
        await wait(200);
        const one = await height();
        expect(one).toBeLessThan(150);

        await chat.evaluate(() => {
          for (let i = 0; i < 10; i++) document.body.append(Object.assign(document.createElement('p'), { textContent: `строка ${i}` }));
        });
        await expect.poll(height).toBeGreaterThan(one * 5);
        await wait(200);
        const fits = await chat.evaluate(() => document.documentElement.scrollHeight <= innerHeight);
        expect(fits, 'фрейм вмещает содержимое без прокрутки').toBe(true);

        await chat.evaluate(() => document.querySelectorAll('p').forEach((p, i) => i > 0 && p.remove()));
        await expect.poll(height).toBe(one);
      });
    });

    it('scrollHeight не даёт фрейму сжаться ниже окна (RESIZE_NOTE)', async () => {
      const child = `<p>виджет</p><script>new ResizeObserver(() => parent.postMessage(document.documentElement.scrollHeight, '*')).observe(document.documentElement)</script>`;
      await site(b(), { [SHOP]: doc('<iframe src="https://widget.example/"></iframe>'), [WIDGET]: doc(child) }, async (page) => {
        await page.goto(SHOP);
        await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
        expect(await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs[0][1])).toBe(150);
      });
    });

    it('GROW_NOTE: body { min-height: 100vh } с отступом раздувает фрейм без конца', async () => {
      const pages = {
        [SHOP]: doc(`<iframe id="chat" src="https://widget.example/chat"></iframe><script>${t.RESIZE_PARENT_CODE}</script>`),
        'https://widget.example/chat': doc(`<style>body { min-height: 100vh }</style><p>виджет</p><script>${t.RESIZE_CHILD_CODE}</script>`),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        const height = () => page.evaluate(() => parseFloat(document.querySelector<HTMLIFrameElement>('#chat')!.style.height) || 0);
        await wait(2000);
        const first = await height();
        expect(first, 'за пару секунд — больше тысячи пикселей').toBeGreaterThan(1000);
        await wait(300);
        expect(await height(), 'и продолжает расти').toBeGreaterThan(first);
      });
      expect(t.GROW_NOTE).toContain('до тысячи с лишним');
    });
  });

  describe('«История, фокус и клавиатура»', () => {
    it('HISTORY_ROWS: какие переходы фрейма добавляют запись, и что делает «Назад»', async () => {
      const pages: Record<string, string> = { [SHOP]: doc('<iframe src="https://widget.example/a"></iframe>') };
      for (const p of 'abcde') pages[`https://widget.example/${p}`] = doc(p);
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        const len = () => page.evaluate(() => history.length);
        const frameUrl = () => page.frames()[1]?.url();
        const start = await len();

        await page.evaluate(() => (frames[0].location.href = 'https://widget.example/b'));
        await expect.poll(frameUrl).toBe('https://widget.example/b');
        const afterNav = await len();

        await page.frames()[1].evaluate(() => location.replace('https://widget.example/c'));
        await expect.poll(frameUrl).toBe('https://widget.example/c');
        const afterReplace = await len();

        await page.evaluate(() => (document.querySelector('iframe')!.src = 'https://widget.example/d'));
        await expect.poll(frameUrl).toBe('https://widget.example/d');
        const afterSrc = await len();

        await page.evaluate(() => {
          const f = document.createElement('iframe');
          f.src = 'https://widget.example/e';
          document.querySelector('iframe')!.replaceWith(f);
        });
        await expect.poll(frameUrl).toBe('https://widget.example/e');
        const afterReplaceTag = await len();

        expect([afterNav - start, afterReplace - afterNav, afterSrc - afterReplace]).toEqual([1, 0, 1]);
        // Заменённый тег: новой записи нет нигде, а Firefox ещё и выбрасывает записи старого фрейма.
        if (engine === 'firefox') expect(afterReplaceTag - afterSrc).toBeLessThan(0);
        else expect(afterReplaceTag - afterSrc).toBe(0);
        expect(t.HISTORY_ROWS.map((r) => r.d.split(';')[0])).toEqual(['+1 запись', '+1 запись', 'без новой записи', 'без новой записи']);
        expect(t.HISTORY_ROWS[3].d).toContain('Firefox');
      });
    });

    it('HISTORY_NOTE: history.back() возвращает фрейм, а не страницу', async () => {
      const pages = {
        [SHOP]: doc('<iframe src="https://widget.example/a"></iframe>'),
        'https://widget.example/a': doc('a'),
        'https://widget.example/b': doc('b'),
      };
      await site(b(), pages, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        await page.evaluate(() => (frames[0].location.href = 'https://widget.example/b'));
        await expect.poll(() => page.frames()[1]?.url()).toBe('https://widget.example/b');
        await page.evaluate(() => history.back());
        await expect.poll(() => page.frames()[1]?.url()).toBe('https://widget.example/a');
        expect(page.url()).toBe(SHOP);
      });
    });

    it('KEYS_NOTE: клавиша во фрейме не доходит до keydown родителя, activeElement — сам iframe', async () => {
      const html = doc('<script>window.keys = 0; addEventListener("keydown", () => keys++)</script><iframe srcdoc="<input>"></iframe><input id="top">');
      await site(b(), { [SHOP]: html }, async (page) => {
        await page.goto(SHOP);
        await page.waitForLoadState('load');
        await page.frames()[1].locator('input').click();
        await page.keyboard.press('a');
        const inFrame = await page.evaluate(() => ({
          keys: (window as unknown as { keys: number }).keys,
          active: document.activeElement!.tagName,
          typed: document.querySelector('iframe')!.contentDocument!.querySelector('input')!.value,
        }));
        expect(inFrame).toEqual({ keys: 0, active: 'IFRAME', typed: 'a' });
        // контроль: та же клавиша на странице слушатель задевает
        await page.locator('#top').click();
        await page.keyboard.press('a');
        expect(await page.evaluate(() => (window as unknown as { keys: number }).keys)).toBe(1);
      });
    });
  });
});

/**
 * «Цена фрейма»: родитель занят 500 мс, фрейм тикает таймером раз в 10 мс и отдаёт самый
 * длинный промежуток. Отношение, а не миллисекунды: «ждал» — больше 300 мс, «не заметил» —
 * меньше 100. Полный Chromium (`channel: 'chromium'`) — потому что headless shell не выносит
 * фреймы в свои процессы.
 */
describe('THREAD_ROWS: тяжёлый скрипт родителя и таймеры фрейма', () => {
  const child =
    '<script>let last=performance.now(),gap=0;setInterval(()=>{const n=performance.now();gap=Math.max(gap,n-last);last=n},10);addEventListener("message",e=>{if(e.data==="reset"){gap=0;last=performance.now()}else parent.postMessage(Math.round(gap),"*")})</script>';

  async function gap(browser: Browser, src: string): Promise<number> {
    const pages = { [SHOP]: doc(`<iframe src="${src}"></iframe>`), 'https://shop.example/child': doc(child), 'https://widget.example/child': doc(child) };
    return site(browser, pages, async (page) => {
      await page.goto(SHOP);
      await page.waitForLoadState('load');
      await wait(300);
      await page.evaluate(() => frames[0].postMessage('reset', '*'));
      await wait(100);
      await page.evaluate(() => {
        const s = performance.now();
        while (performance.now() - s < 500);
      });
      await wait(100);
      await page.evaluate(() => frames[0].postMessage('ask', '*'));
      await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs.length)).toBe(1);
      return Number(await page.evaluate(() => (window as unknown as { msgs: [string, unknown][] }).msgs[0][1]));
    });
  }

  it.each(ENGINES)('%s: фрейм своего и чужого сайта ждут родителя', async (engine) => {
    expect(await gap(browsers[engine], 'https://shop.example/child')).toBeGreaterThan(300);
    expect(await gap(browsers[engine], 'https://widget.example/child')).toBeGreaterThan(300);
  });

  it('полный Chromium: фрейм чужого сайта в своём процессе не замечает занятого родителя', async () => {
    await withBrowser(chromium, { channel: 'chromium' }, async (browser) => {
      expect(await gap(browser, 'https://shop.example/child')).toBeGreaterThan(300);
      expect(await gap(browser, 'https://widget.example/child')).toBeLessThan(100);
    });
    expect(t.THREAD_ROWS[1].full).toContain('не заметил');
  }, 60_000);
});
