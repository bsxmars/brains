import { readFileSync } from 'node:fs';
import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import {
  DPIP_CODE,
  DPIP_MARKUP,
  DPIP_FACTS,
  DPIP_OUT,
  FOCUS_ROWS,
  GDM_AUDIO,
  GDM_CODE,
  GDM_MARKUP,
  GDM_ERRORS,
  GDM_OUT,
  HEADLESS_NOTE,
  MS_ACTIONS,
  MS_BASE_ACTIONS,
  MS_CODE,
  MS_MARKUP,
  MS_LIMITS,
  MS_OUT,
  MS_POSITION,
  MS_POSITION_NOTE,
  PIP_CODE,
  PIP_MARKUP,
  PIP_ERRORS,
  PIP_OUT,
  PIP_RULES,
  PITFALLS,
  PLAIN_ACTIVATION,
  STOP_NOTE,
} from '../../src/content/lessons/media-outside/data';

/**
 * «Плеер вне вкладки: Picture-in-Picture, Media Session и захват экрана» — запуском.
 *
 * Страницы отдаются `page.route` с выдуманного `https://media-outside.test`: https даёт безопасный
 * контекст, без которого нет ни Document PiP, ни `navigator.mediaDevices`. Код из `data.ts`
 * вставляется в страницу дословно, вывод сверяется с `*_OUT` по консоли.
 *
 * ⚠️ `page.evaluate` даёт странице временную активацию (Chromium и Firefox), поэтому «без клика»
 * проверяется скриптом, который исполняется при загрузке, а «с кликом» — настоящим `page.click`.
 *
 * Движки запускаются прямо из теста: тема сравнивает Chromium, Firefox и WebKit, а захват экрана
 * требует флагов запуска. Нужны бинари всех трёх (`npx playwright install firefox webkit`).
 * Страницы курса не нужны.
 */

/** В lib.dom TypeScript Document PiP ещё нет — минимум, который нужен тесту. */
type DocPip = { documentPictureInPicture: { window: Window | null } };

const ORIGIN = 'https://media-outside.test';
const CLIP = readFileSync('tests/fixtures/media-outside/clip.webm');
const TONE = readFileSync('tests/fixtures/media-outside/tone.webm');
const FAKE_SCREEN = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

const ENGINES: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

/** Страница из куска разметки; ролики — с того же источника. */
async function open(browser: Browser, body: string, origin = ORIGIN): Promise<{ page: Page; logs: string[] }> {
  const page = await browser.newPage();
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/clip.webm') return route.fulfill({ contentType: 'video/webm', body: CLIP });
    if (path === '/tone.webm' || path === '/ep-11.webm' || path === '/ep-12.webm') return route.fulfill({ contentType: 'audio/webm', body: TONE });
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">${body}` });
  });
  await page.goto(`${origin}/`);
  return { page, logs };
}

const BIG_BUTTON = 'style="display:block;width:200px;height:48px"';

/** Ждать метаданных видео без `evaluate` — чтобы не выдать странице активацию раньше времени. */
const WAIT_META = `const meta = (v) => v.readyState >= 1 ? Promise.resolve() : new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
const report = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('timeout'), 4000))]).then((x) => console.log(x), (e) => console.log(e.name));`;

// ─── Раздел «Картинка в картинке» ───────────────────────────────────────────────────────────

test.describe('раздел «Картинка в картинке»', () => {
  test('PIP_CODE: два клика — вход и выход, окно по кадру ролика', async () => {
    const browser = await chromium.launch();
    try {
      const { page, logs } = await open(
        browser,
        `${PIP_MARKUP}<script>${PIP_CODE}</script>`,
      );
      await expect.poll(() => page.evaluate(() => document.querySelector('video')!.readyState)).toBeGreaterThanOrEqual(1);
      await page.click('#pip');
      await expect.poll(() => logs.length).toBeGreaterThanOrEqual(3);
      await page.click('#pip');
      await expect.poll(() => logs.length).toBeGreaterThanOrEqual(4);
      expect(logs).toEqual(PIP_OUT.split('\n'));
    } finally {
      await browser.close();
    }
  });

  /** Каждый случай таблицы — отдельная страница: так активация одного не достаётся другому. */
  const CASES: { row: number; body: string; click: boolean }[] = [
    {
      row: 0,
      body: `<video src="/clip.webm" muted></video><script>${WAIT_META}
        const v = document.querySelector('video'); meta(v).then(() => report(v.requestPictureInPicture().then(() => 'окно открыто')));</script>`,
      click: false,
    },
    {
      row: 1,
      body: `<video src="/clip.webm" muted disablepictureinpicture></video><button id="b" ${BIG_BUTTON}>b</button><script>${WAIT_META}
        const v = document.querySelector('video'); b.onclick = () => report(v.requestPictureInPicture().then(() => 'окно открыто'));</script>`,
      click: true,
    },
    {
      row: 2,
      body: `<button id="b" ${BIG_BUTTON}>b</button><script>${WAIT_META}
        const v = document.createElement('video'); b.onclick = () => report(v.requestPictureInPicture().then(() => 'окно открыто'));</script>`,
      click: true,
    },
    {
      row: 3,
      body: `<video src="/tone.webm"></video><button id="b" ${BIG_BUTTON}>b</button><script>${WAIT_META}
        const v = document.querySelector('video'); b.onclick = () => report(meta(v).then(() => v.requestPictureInPicture()).then(() => 'окно открыто'));</script>`,
      click: true,
    },
    {
      row: 4,
      body: `<video src="/clip.webm" muted></video><button id="b" ${BIG_BUTTON}>b</button><script>${WAIT_META}
        const v = document.querySelector('video'); b.onclick = () => report(meta(v).then(() => v.requestPictureInPicture()).then(() => 'окно открыто'));</script>`,
      click: true,
    },
  ];

  for (const [name, type] of ENGINES) {
    test(`таблица отказов requestPictureInPicture: ${name}`, async () => {
      const browser = await type.launch();
      try {
        for (const c of CASES) {
          const { page, logs } = await open(browser, c.body);
          if (c.click) {
            await page.waitForTimeout(300);
            await page.click('#b');
          }
          await expect.poll(() => logs.length, { timeout: 8000 }).toBeGreaterThanOrEqual(1);
          const expected = PIP_ERRORS[c.row][name as 'chromium' | 'firefox' | 'webkit'];
          expect(logs[0], `${name}: ${PIP_ERRORS[c.row].k}`).toBe(expected);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    });
  }

  for (const [name, type] of ENGINES.slice(0, 2)) {
    test(`одно окно на документ и удаление видео: ${name}`, async () => {
      const browser = await type.launch();
      try {
        const { page } = await open(
          browser,
          `<video id="v1" src="/clip.webm" muted></video><video id="v2" src="/clip.webm" muted></video>
          <button id="a" ${BIG_BUTTON}>a</button><button id="c" ${BIG_BUTTON}>c</button><script>
          window.L = [];
          for (const x of [v1, v2]) {
            x.addEventListener('enterpictureinpicture', () => L.push('enter ' + x.id));
            x.addEventListener('leavepictureinpicture', () => L.push('leave ' + x.id));
          }
          a.onclick = () => v1.requestPictureInPicture();
          c.onclick = async () => {
            await v2.requestPictureInPicture();
            try { await document.exitPictureInPicture(); await document.exitPictureInPicture(); } catch (e) { L.push('exit ' + e.name); }
            await v2.requestPictureInPicture();
            v2.remove();
            setTimeout(() => L.push('after remove ' + (document.pictureInPictureElement ? 'element' : 'null')), 500);
          };</script>`,
        );
        await page.waitForTimeout(500);
        await page.click('#a');
        await page.waitForTimeout(500);
        await page.click('#c');
        await expect.poll(() => page.evaluate(() => (window as unknown as { L: string[] }).L.at(-1)), { timeout: 5000 }).toContain('after remove');
        const got = await page.evaluate(() => (window as unknown as { L: string[] }).L);

        // Вторая картинка в картинке закрывает первую; второй exit подряд — InvalidStateError.
        // Firefox присылает leave после промиса exit, Chromium — до, поэтому порядок здесь не сверяется.
        expect(got.slice(0, 3)).toEqual(['enter v1', 'leave v1', 'enter v2']);
        expect(got).toContain('leave v2');
        expect(got).toContain('exit InvalidStateError');
        expect(PIP_RULES.join(' ')).toContain('`InvalidStateError`');

        // Удалённое видео: Chromium окно оставляет, Firefox закрывает.
        if (name === 'chromium') {
          expect(got.at(-1)).toBe('after remove element');
          expect(got.filter((x) => x === 'leave v2')).toHaveLength(1);
        } else {
          expect(got.at(-1)).toBe('after remove null');
          expect(got.filter((x) => x === 'leave v2')).toHaveLength(2);
        }
        expect(PIP_RULES.join(' ')).toContain('Firefox окно закрывает');
      } finally {
        await browser.close();
      }
    });
  }
});

// ─── Временная активация ────────────────────────────────────────────────────────────────────

test.describe('временная активация', () => {
  for (const [name, type] of ENGINES) {
    test(`живёт около пяти секунд: ${name}`, async () => {
      test.setTimeout(60_000);
      const browser = await type.launch();
      try {
        const { page, logs } = await open(
          browser,
          `<button id="b" ${BIG_BUTTON}>b</button><script>
          console.log('при загрузке ' + navigator.userActivation.isActive);
          b.onclick = () => { for (const ms of [4500, 5500]) setTimeout(() => console.log(ms + ' ' + navigator.userActivation.isActive), ms); };</script>`,
        );
        await expect.poll(() => logs.length).toBe(1);
        await page.click('#b');
        await expect.poll(() => logs.length, { timeout: 10_000 }).toBe(3);
        expect(logs).toEqual(['при загрузке false', '4500 true', '5500 false']);
        expect(PLAIN_ACTIVATION).toContain('между 4,5 и 5,5 секундами');
      } finally {
        await browser.close();
      }
    });
  }

  for (const [name, type] of ENGINES.slice(0, 2)) {
    test(`page.evaluate выдаёт активацию, а requestWindow её тратит: ${name}`, async () => {
      const browser = await type.launch();
      try {
        const { page } = await open(
          browser,
          `<button id="b" ${BIG_BUTTON}>b</button><script>
          window.R = null;
          b.onclick = async () => {
            await documentPictureInPicture.requestWindow();
            try { await documentPictureInPicture.requestWindow(); window.R = 'ok'; } catch (e) { window.R = e.name; }
          };</script>`,
        );
        await page.waitForTimeout(6000);
        expect(await page.evaluate(() => navigator.userActivation.isActive)).toBe(true);
        expect(PITFALLS.find((p) => p.t.includes('page.evaluate'))?.d).toContain('`navigator.userActivation.isActive === true`');

        await page.waitForTimeout(5500);
        await page.click('#b');
        await expect.poll(() => page.evaluate(() => (window as unknown as { R: string | null }).R)).toBe('NotAllowedError');
        expect(PLAIN_ACTIVATION).toContain('одно открытие окна его гасит');
      } finally {
        await browser.close();
      }
    });
  }
});

// ─── Раздел «Целая страница в окне» ─────────────────────────────────────────────────────────

test.describe('раздел «Document Picture-in-Picture»', () => {
  for (const [name, type] of ENGINES.slice(0, 2)) {
    test(`DPIP_CODE: элемент уезжает в окно и возвращается: ${name}`, async () => {
      const browser = await type.launch();
      try {
        const context = await browser.newContext();
        await context.route('https://cdn.media-outside.test/**', (r) =>
          r.fulfill({ contentType: 'text/css', body: '.from-cdn { color: rgb(9, 8, 7) }' }),
        );
        const page = await context.newPage();
        const logs: string[] = [];
        page.on('console', (m) => logs.push(m.text()));
        page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
        await page.route(`${ORIGIN}/**`, (r) =>
          r.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><meta charset="utf-8"><style>#player { color: rgb(1, 2, 3) }</style>
            <link rel="stylesheet" href="https://cdn.media-outside.test/a.css">
            ${DPIP_MARKUP}<script>${DPIP_CODE}</script>`,
          }),
        );
        await page.goto(`${ORIGIN}/`);

        // Чужая таблица правил не отдаёт — ради этого в примере catch со ссылкой.
        expect(
          await page.evaluate(() => {
            try {
              void document.styleSheets[1].cssRules;
              return 'ok';
            } catch (e) {
              return (e as Error).name;
            }
          }),
        ).toBe('SecurityError');
        expect(PITFALLS.find((p) => p.t.includes('Document PiP'))?.d).toContain('`SecurityError`');

        await page.waitForTimeout(5500); // активация от evaluate истекла — клик ниже настоящий
        await page.click('#float');
        await expect.poll(() => logs.length).toBeGreaterThanOrEqual(2);

        const inWindow = await page.evaluate(() => {
          const w = (globalThis as unknown as DocPip).documentPictureInPicture.window!;
          const p = w.document.getElementById('player')!;
          return { url: w.location.href, origin: w.origin, opener: w.opener === window, color: w.getComputedStyle(p).color };
        });
        expect(inWindow).toEqual({ url: 'about:blank', origin: ORIGIN, opener: true, color: 'rgb(1, 2, 3)' });

        await page.evaluate(() => (globalThis as unknown as DocPip).documentPictureInPicture.window!.close());
        await expect.poll(() => logs.length).toBeGreaterThanOrEqual(3);
        expect(logs).toEqual(DPIP_OUT.split('\n'));
      } finally {
        await browser.close();
      }
    });
  }

  test('второе окно закрывает первое (Firefox)', async () => {
    const browser = await firefox.launch();
    try {
      const { page } = await open(
        browser,
        `<button id="b" ${BIG_BUTTON}>b</button><script>
        window.L = []; let first;
        b.onclick = async () => {
          const w = await documentPictureInPicture.requestWindow({ width: 300, height: 200 });
          if (!first) { first = w; return; }
          setTimeout(() => L.push({ same: w === first, firstClosed: first.closed, current: documentPictureInPicture.window === w }), 300);
        };</script>`,
      );
      await page.click('#b');
      await page.waitForTimeout(800);
      await page.click('#b');
      await expect.poll(() => page.evaluate(() => (window as unknown as { L: unknown[] }).L.length)).toBe(1);
      expect(await page.evaluate(() => (window as unknown as { L: unknown[] }).L[0])).toEqual({ same: false, firstClosed: true, current: true });
      expect(DPIP_FACTS[0]).toContain('Второй `requestWindow` закрывает первое окно');
    } finally {
      await browser.close();
    }
  });

  test('размер — пожелание: width без height — RangeError, большое окно урезано (Firefox)', async () => {
    const browser = await firefox.launch();
    try {
      const { page } = await open(
        browser,
        `<button id="b" ${BIG_BUTTON}>b</button><button id="c" ${BIG_BUTTON}>c</button><script>
        window.L = [];
        b.onclick = () => documentPictureInPicture.requestWindow({ width: 300 }).then(() => L.push('ok'), (e) => L.push(e.name));
        c.onclick = async () => { const w = await documentPictureInPicture.requestWindow({ width: 5000, height: 5000 });
          L.push(w.innerWidth < screen.width && w.innerHeight < screen.height); };</script>`,
      );
      await page.click('#b');
      await page.click('#c');
      await expect.poll(() => page.evaluate(() => (window as unknown as { L: unknown[] }).L.length)).toBe(2);
      expect(await page.evaluate(() => (window as unknown as { L: unknown[] }).L)).toEqual(['RangeError', true]);
      expect(DPIP_FACTS.join(' ')).toContain('`RangeError`');
    } finally {
      await browser.close();
    }
  });

  test('где есть: Chromium и Firefox — да, WebKit — нет; на http: — нигде', async () => {
    const got: Record<string, unknown> = {};
    for (const [name, type] of ENGINES) {
      const browser = await type.launch();
      try {
        for (const origin of ['http://media-outside.test', ORIGIN]) {
          const { page } = await open(browser, '<video></video>', origin);
          got[`${name} ${origin.split(':')[0]}`] = await page.evaluate(() => ({
            dpip: 'documentPictureInPicture' in window,
            mediaDevices: navigator.mediaDevices !== undefined,
            mediaSession: 'mediaSession' in navigator,
            pip: typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function',
            captureController: typeof (window as { CaptureController?: unknown }).CaptureController === 'function',
          }));
          await page.close();
        }
      } finally {
        await browser.close();
      }
    }
    const insecure = { dpip: false, mediaDevices: false, mediaSession: true, pip: true, captureController: false };
    expect(got).toEqual({
      'chromium http': insecure,
      'chromium https': { dpip: true, mediaDevices: true, mediaSession: true, pip: true, captureController: true },
      'firefox http': insecure,
      'firefox https': { dpip: true, mediaDevices: true, mediaSession: true, pip: true, captureController: false },
      'webkit http': insecure,
      'webkit https': { dpip: false, mediaDevices: true, mediaSession: true, pip: true, captureController: false },
    });
    expect(DPIP_FACTS.join(' ')).toContain('Chromium и Firefox 155 — да, WebKit — нет');
  });
});

// ─── Раздел «Media Session» ─────────────────────────────────────────────────────────────────

test.describe('раздел «Кнопки в системе: Media Session»', () => {
  test('MS_CODE обрабатывает ранний timeupdate и отказ play', async () => {
    const browser = await chromium.launch();
    try {
      const { page, logs } = await open(browser, `${MS_MARKUP}<script>${MS_CODE}
        audio.dispatchEvent(new Event('timeupdate'));
        console.log('ранняя позиция обработана');
        audio.play = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        play();
      </script>`);
      await expect.poll(() => logs.includes('play: NotAllowedError')).toBe(true);
      expect(logs).toContain('ранняя позиция обработана');
      expect(logs.some((line) => line.startsWith('pageerror:'))).toBe(false);
      await page.close();
    } finally { await browser.close(); }
  });

  for (const [name, type] of ENGINES) {
    test(`MS_CODE и таблицы действий и позиции: ${name}`, async () => {
      const browser = await type.launch();
      try {
        const { page, logs } = await open(browser, `${MS_MARKUP}<script>${MS_CODE}</script>`);
        await expect.poll(() => logs.length).toBeGreaterThanOrEqual(1);
        expect(logs).toEqual([MS_OUT]);

        const got = await page.evaluate(
          ({ actions }) => {
            const ms = navigator.mediaSession;
            const known = (a: string) => {
              try {
                ms.setActionHandler(a as MediaSessionAction, () => {});
                return true;
              } catch (e) {
                return (e as Error).name === 'TypeError' ? false : (e as Error).name;
              }
            };
            const call = (arg?: MediaPositionState) => {
              try {
                if (arg === undefined) ms.setPositionState();
                else ms.setPositionState(arg);
                return 'ok';
              } catch (e) {
                return (e as Error).name;
              }
            };
            const bothNegative = [call({ duration: -1 }), call({ duration: 10, position: -1 })];
            ms.playbackState = 'playing';
            (ms as { playbackState: string }).playbackState = 'buffering';
            return {
              known: Object.fromEntries(actions.map((a) => [a, known(a)])),
              unknown: known('нет-такого-действия'),
              nullHandler: (() => {
                try {
                  ms.setActionHandler('play', null);
                  return 'ok';
                } catch (e) {
                  return (e as Error).name;
                }
              })(),
              position: [
                call({ duration: 180, position: 30, playbackRate: 1 }),
                call(),
                call({} as MediaPositionState),
                call({ position: 10 } as MediaPositionState),
                call({ duration: NaN }),
                call({ duration: Infinity, position: 5 }),
                call({ duration: 10, position: 20 }),
                bothNegative[0] === bothNegative[1] ? bothNegative[0] : bothNegative.join('/'),
                call({ duration: 10, position: 1, playbackRate: 0 }),
                call({ duration: 10, position: 1, playbackRate: -1 }),
              ],
              playbackState: ms.playbackState,
              artworkFrozen: Object.isFrozen(ms.metadata!.artwork),
            };
          },
          { actions: [...MS_BASE_ACTIONS, ...MS_ACTIONS.map((a) => a.k)] },
        );

        const engine = name as 'chromium' | 'firefox' | 'webkit';
        expect(got.known).toEqual(
          Object.fromEntries([...MS_BASE_ACTIONS.map((a) => [a, true]), ...MS_ACTIONS.map((a) => [a.k, a[engine]])]),
        );
        expect(got.unknown).toBe(false);
        expect(got.nullHandler).toBe('ok');
        expect(got.position).toEqual(MS_POSITION.map((r) => r[engine]));
        expect(got.playbackState, 'неверная строка в playbackState молча не действует').toBe('playing');
        expect(got.artworkFrozen).toBe(true);
        expect(MS_POSITION_NOTE).toContain('молча не действует');
      } finally {
        await browser.close();
      }
    });
  }

  test('медиаклавиша из Playwright — keydown, обработчик сессии не вызывается', async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    try {
      const { page } = await open(
        browser,
        `<video src="/clip.webm" loop></video><button id="b" ${BIG_BUTTON}>b</button><script>
        window.L = [];
        navigator.mediaSession.setActionHandler('pause', () => L.push('сессия: pause'));
        navigator.mediaSession.setActionHandler('play', () => L.push('сессия: play'));
        document.addEventListener('keydown', (e) => L.push('keydown ' + e.key));
        b.onclick = () => document.querySelector('video').play().then(() => L.push('играет'));</script>`,
      );
      await page.click('#b');
      await expect.poll(() => page.evaluate(() => (window as unknown as { L: string[] }).L)).toEqual(['играет']);
      await page.keyboard.press('MediaPlayPause');
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => (window as unknown as { L: string[] }).L)).toEqual(['играет', 'keydown MediaPlayPause']);
      expect(MS_LIMITS).toContain('обычным `keydown`');
    } finally {
      await browser.close();
    }
  });
});

// ─── Раздел «Захват экрана» ─────────────────────────────────────────────────────────────────

test.describe('раздел «Захват экрана»', () => {
  test('показанный контроллер очищает поздний поток и оставшееся аудио', async () => {
    const browser = await chromium.launch();
    try {
      const fixture = `<script>
        const captures = window.captures = [];
        const audioContext = new AudioContext();
        navigator.mediaDevices.getDisplayMedia = () => {
          const canvas = document.createElement('canvas');
          const audio = audioContext.createMediaStreamDestination().stream;
          const stream = new MediaStream([...canvas.captureStream(1).getTracks(), ...audio.getTracks()]);
          captures.push(stream);
          return new Promise((resolve) => { window.finishChoice = () => resolve(stream); });
        };
      </script>`;
      const { page, logs } = await open(browser, `${GDM_MARKUP}${fixture}<script>${GDM_CODE}</script>`);
      await page.click('#stop'); // Остановка безопасна до первого запроса.
      await page.click('#share');
      await page.click('#share'); // Один незавершённый выбор не создаёт второй поток.
      await page.click('#stop');
      await page.evaluate(() => (window as unknown as { finishChoice: () => void }).finishChoice());
      await expect.poll(() => page.evaluate(() => {
        const captures = (window as unknown as { captures: MediaStream[] }).captures;
        return captures.length === 1 && captures[0].getTracks().every((track) => track.readyState === 'ended');
      })).toBe(true);

      await page.click('#share');
      await page.evaluate(() => (window as unknown as { finishChoice: () => void }).finishChoice());
      await expect.poll(() => page.evaluate(() => document.querySelector('video')!.srcObject !== null)).toBe(true);
      await page.evaluate(() => {
        const stream = (window as unknown as { captures: MediaStream[] }).captures[1];
        const [video] = stream.getVideoTracks();
        video.stop();
        // Доставляем ended управляемо: кнопку браузера тест не нажимает.
        video.dispatchEvent(new Event('ended'));
      });
      expect(await page.evaluate(() => ({
        states: (window as unknown as { captures: MediaStream[] }).captures[1].getTracks().map((track) => track.readyState),
        preview: document.querySelector('video')!.srcObject,
      }))).toEqual({ states: ['ended', 'ended'], preview: null });
      expect(logs.some((line) => line.startsWith('pageerror:'))).toBe(false);
    } finally { await browser.close(); }
  });

  test('GDM_CODE: вкладка со звуком, stop() без события ended', async () => {
    const browser = await chromium.launch({ args: FAKE_SCREEN });
    try {
      const { page, logs } = await open(
        browser,
        `${GDM_MARKUP}<script>${GDM_CODE}</script>`,
      );
      await page.click('#share');
      await expect.poll(() => logs.length).toBeGreaterThanOrEqual(1);
      await page.click('#stop');
      await expect.poll(() => logs.length).toBeGreaterThanOrEqual(2);
      await page.waitForTimeout(500); // ended пришёл бы за это время
      expect(logs).toEqual(GDM_OUT.split('\n'));
      expect(STOP_NOTE).toContain('события **нет**');
      expect(GDM_AUDIO).toContain('`Fake audio`');
    } finally {
      await browser.close();
    }
  });

  test('setFocusBehavior: когда можно и когда поздно', async () => {
    const browser = await chromium.launch({ args: FAKE_SCREEN });
    try {
      const { page } = await open(
        browser,
        `<button id="b" ${BIG_BUTTON}>b</button><script>
        const t = (f) => { try { f(); return 'ok'; } catch (e) { return e.name; } };
        const gdm = (video, controller) => navigator.mediaDevices.getDisplayMedia({ video, controller });
        window.R = null;
        b.onclick = async () => {
          const o = {};
          const c0 = new CaptureController();
          o.before = t(() => c0.setFocusBehavior('no-focus-change'));
          const c1 = new CaptureController();
          await gdm({ displaySurface: 'browser' }, c1);
          o.afterAwait = t(() => c1.setFocusBehavior('no-focus-change'));
          const c2 = new CaptureController();
          await gdm(true, c2);
          o.monitor = t(() => c2.setFocusBehavior('no-focus-change'));
          const c3 = new CaptureController();
          await gdm({ displaySurface: 'browser' }, c3);
          await Promise.resolve();
          o.microtask = t(() => c3.setFocusBehavior('no-focus-change'));
          try { await gdm(true, c3); o.reuse = 'ok'; } catch (e) { o.reuse = e.name; }
          window.R = o;
        };</script>`,
      );
      await page.click('#b');
      await expect.poll(() => page.evaluate(() => (window as unknown as { R: unknown }).R)).not.toBeNull();
      expect(await page.evaluate(() => (window as unknown as { R: unknown }).R)).toEqual({
        before: 'ok',
        afterAwait: 'ok',
        monitor: 'InvalidStateError',
        microtask: 'InvalidStateError',
        reuse: 'InvalidStateError',
      });
      expect(FOCUS_ROWS.map((r) => r.tone)).toEqual(['ok', 'ok', 'err', 'err', 'err']);
    } finally {
      await browser.close();
    }
  });

  test('ограничения: размер и частота — пожелания, min и exact — TypeError, video: false — отказ', async () => {
    const browser = await chromium.launch({ args: FAKE_SCREEN });
    try {
      const { page } = await open(
        browser,
        `<button id="b" ${BIG_BUTTON}>b</button><script>
        const gdm = (o) => navigator.mediaDevices.getDisplayMedia(o).then((s) => s.getVideoTracks()[0].getSettings(), (e) => e.name);
        window.R = null;
        b.onclick = async () => {
          window.R = {
            plain: await gdm({ video: true }),
            sized: await gdm({ video: { width: 640, height: 360, frameRate: 5 } }),
            min: await gdm({ video: { width: { min: 640 } } }),
            exact: await gdm({ video: { displaySurface: { exact: 'window' } } }),
            noVideo: await gdm({ video: false, audio: true }),
          };
        };</script>`,
      );
      await page.click('#b');
      await expect.poll(() => page.evaluate(() => (window as unknown as { R: unknown }).R)).not.toBeNull();
      const r = (await page.evaluate(() => (window as unknown as { R: unknown }).R)) as Record<string, MediaTrackSettings | string>;
      const plain = r.plain as MediaTrackSettings;
      const sized = r.sized as MediaTrackSettings;
      expect([plain.displaySurface, plain.width, plain.height]).toEqual(['monitor', 1280, 720]);
      expect([sized.width, sized.height, sized.frameRate]).toEqual([640, 360, 5]);
      expect([r.min, r.exact, r.noVideo]).toEqual(['TypeError', 'TypeError', 'NotFoundError']);
      expect(HEADLESS_NOTE).toContain('поддельный экран 1280×720');
      expect(GDM_ERRORS.find((e) => e.k.includes('video: false'))?.v).toContain('`NotFoundError`');
    } finally {
      await browser.close();
    }
  });

  test('отказ: флаг =deny и фрейм без allow="display-capture" — NotAllowedError', async () => {
    const deny = await chromium.launch({ args: ['--use-fake-ui-for-media-stream=deny', '--use-fake-device-for-media-stream'] });
    try {
      const { page, logs } = await open(
        deny,
        `<button id="b" ${BIG_BUTTON}>b</button><script>
        b.onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => console.log('ok'), (e) => console.log(e.name));</script>`,
      );
      await page.click('#b');
      await expect.poll(() => logs).toEqual(['NotAllowedError']);
      expect(HEADLESS_NOTE).toContain('`--use-fake-ui-for-media-stream=deny`');
    } finally {
      await deny.close();
    }

    const browser = await chromium.launch({ args: FAKE_SCREEN });
    try {
      const page = await browser.newPage();
      const other = 'https://frame.media-outside.test';
      const inner = (`<!doctype html><button id="b" ${BIG_BUTTON}>b</button><script>
        b.onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => parent.postMessage('ok', '*'), (e) => parent.postMessage(e.name, '*'));</script>`);
      await page.route(`${other}/**`, (r) => r.fulfill({ contentType: 'text/html', body: inner }));
      const got: Record<string, string> = {};
      for (const allow of ['', 'allow="display-capture"']) {
        await page.route(`${ORIGIN}/**`, (r) =>
          r.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><iframe id="f" ${allow} src="${other}/" width="400" height="200"></iframe><script>window.M = null; addEventListener('message', (e) => { window.M = e.data; });</script>`,
          }),
        );
        await page.goto(`${ORIGIN}/`);
        await page.frameLocator('#f').locator('#b').click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { M: string | null }).M)).not.toBeNull();
        got[allow || 'без allow'] = (await page.evaluate(() => (window as unknown as { M: string }).M));
        await page.unroute(`${ORIGIN}/**`);
      }
      expect(got).toEqual({ 'без allow': 'NotAllowedError', 'allow="display-capture"': 'ok' });
      expect(GDM_ERRORS.find((e) => e.k.includes('display-capture'))?.v).toContain('`NotAllowedError`');
    } finally {
      await browser.close();
    }
  });

  test('без клика: Firefox и WebKit — InvalidStateError', async () => {
    for (const type of [firefox, webkit]) {
      const browser = await type.launch();
      try {
        const { logs } = await open(
          browser,
          `<script>navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => console.log('ok'), (e) => console.log(e.name));</script>`,
        );
        await expect.poll(() => logs).toEqual(['InvalidStateError']);
      } finally {
        await browser.close();
      }
    }
    expect(GDM_ERRORS.find((e) => e.k === 'без клика')?.v).toContain('Firefox и WebKit — `InvalidStateError`');
  });

  test('WebKit: audio: true — поток без звука, video: false и min — TypeError', async () => {
    const browser = await webkit.launch();
    try {
      const { page } = await open(
        browser,
        `<button id="a" ${BIG_BUTTON}>a</button><button id="b" ${BIG_BUTTON}>b</button><button id="c" ${BIG_BUTTON}>c</button><script>
        window.R = {};
        const gdm = (o) => navigator.mediaDevices.getDisplayMedia(o);
        // Каждый вызов — своим кликом: WebKit тратит активацию, и второй вызов в том же обработчике — InvalidStateError.
        a.onclick = () => gdm({ video: true, audio: true }).then((s) => { R.audio = s.getAudioTracks().length; R.video = s.getVideoTracks().length; });
        b.onclick = () => gdm({ video: false, audio: true }).then(() => { R.noVideo = 'ok'; }, (e) => { R.noVideo = e.name; });
        c.onclick = () => gdm({ video: { width: { min: 640 } } }).then(() => { R.min = 'ok'; }, (e) => { R.min = e.name; });</script>`,
      );
      for (const id of ['#a', '#b', '#c']) {
        await page.click(id);
        await page.waitForTimeout(300);
      }
      await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { R: object }).R).length)).toBe(4);
      expect(await page.evaluate(() => (window as unknown as { R: unknown }).R)).toEqual({ audio: 0, video: 1, noVideo: 'TypeError', min: 'TypeError' });
      expect(GDM_AUDIO).toContain('Firefox и WebKit на `audio: true` не бросают');
    } finally {
      await browser.close();
    }
  });

  test('Chromium без окна: без флагов NotSupportedError, с одним fake-ui — NotReadableError', async () => {
    const got: string[] = [];
    for (const args of [[], ['--use-fake-ui-for-media-stream']]) {
      const browser = await chromium.launch({ args });
      try {
        const { page, logs } = await open(
          browser,
          `<button id="b" ${BIG_BUTTON}>b</button><script>
          b.onclick = () => navigator.mediaDevices.getDisplayMedia({ video: true }).then(() => console.log('ok'), (e) => console.log(e.name));</script>`,
        );
        await page.click('#b');
        await expect.poll(() => logs.length).toBe(1);
        got.push(logs[0]);
      } finally {
        await browser.close();
      }
    }
    expect(got).toEqual(['NotSupportedError', 'NotReadableError']);
    expect(HEADLESS_NOTE).toContain('`NotSupportedError`');
    expect(HEADLESS_NOTE).toContain('`NotReadableError`');
  });
});
