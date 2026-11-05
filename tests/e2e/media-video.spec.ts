import { existsSync, readFileSync } from 'node:fs';
import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import {
  AUTOPLAY_CODE,
  AUTOPLAY_OUT,
  CODEC_CODE,
  CODEC_SNAPSHOT,
  FIRST_CODE,
  FIRST_OUT,
  FRAME_CODE,
  FRAME_OUT,
  MASTER_M3U8,
  MEDIA_M3U8,
  MSE_FEED_CODE,
  MSE_OUT,
  MSE_SETUP_CODE,
  PLAY_ERRORS_CODE,
  PLAY_ERRORS_OUT,
  STALL_CODE,
  STALL_OUT,
} from '../../src/content/lessons/media-video/data';

/**
 * «Видео в браузере»: каждый пример с выводом и каждое утверждение о движках.
 *
 * Страница — ровно строка из `data.ts`, ролики — `tests/fixtures/media-video/` (их делает
 * `gen.sh` там же). Всё отдаёт `page.route` с выдуманного источника; страница курса не нужна.
 * Движки запускаются прямо из теста: тема сравнивает Chromium, Firefox и WebKit, а проект
 * в конфиге один. Нужны бинари всех трёх и полный Chromium (`channel: 'chromium'`) для
 * таблицы кодеков — headless shell декодирует программно и отвечает иначе.
 *
 * Сверяется вывод `console.log`, а не время: числа отрисовок и миллисекунды машинозависимы.
 */
const ORIGIN = 'http://media-video.test';
const FIXTURES = 'tests/fixtures/media-video';

type Name = 'chromium' | 'firefox' | 'webkit';
const TYPES: Record<Name, BrowserType> = { chromium, firefox, webkit };
const ALL: Name[] = ['chromium', 'firefox', 'webkit'];

function contentType(path: string): string {
  if (path.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (path.endsWith('.webm')) return 'video/webm';
  return 'video/mp4';
}

/** Страница `html` на `ORIGIN/`, остальное — файлы стенда; нет файла — 404. */
async function serve(page: Page, html: string): Promise<string[]> {
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><meta charset="utf-8">${html}` });
    }
    const file = FIXTURES + path;
    if (!existsSync(file)) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ contentType: contentType(path), body: readFileSync(file) });
  });
  const logged: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'log') logged.push(m.text());
  });
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.name}`));
  return logged;
}

async function withBrowser<T>(name: Name, fn: (browser: Browser) => Promise<T>, channel?: string): Promise<T> {
  const browser = await TYPES[name].launch(channel ? { channel } : {});
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Открыть страницу и ждать, пока в консоли не наберётся `lines` строк (или не появится строка `last`). */
async function run(name: Name, html: string, lines: number | RegExp, after?: (page: Page) => Promise<void>): Promise<string[]> {
  return withBrowser(name, async (browser) => {
    const page = await browser.newPage();
    const logged = await serve(page, html);
    await page.goto(`${ORIGIN}/`);
    if (after) await after(page);
    if (typeof lines === 'number') {
      await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(lines);
    } else {
      await expect.poll(() => logged.some((l) => lines.test(l)), { timeout: 10_000 }).toBe(true);
    }
    await page.waitForTimeout(200); // лишняя строка, если она есть, тоже должна попасть в сверку
    return logged;
  });
}

test.describe.configure({ timeout: 90_000 });

for (const name of ALL) {
  test(`первый ролик в ${name}: события по порядку, play() выполнен вместе с playing`, async () => {
    expect(await run(name, FIRST_CODE, FIRST_OUT.split('\n').length)).toEqual(FIRST_OUT.split('\n'));
  });

  test(`отказы play() в ${name}: AbortError и NotSupportedError с кодом 4 на 404`, async () => {
    expect(await run(name, PLAY_ERRORS_CODE, 2)).toEqual(PLAY_ERRORS_OUT.split('\n'));
  });
}

for (const name of ['chromium', 'firefox'] as const) {
  test(`автоплей в ${name}: со звуком — NotAllowedError, без звука — играет, клик включает звук`, async () => {
    const expected = AUTOPLAY_OUT.split('\n');
    const got = await run(name, AUTOPLAY_CODE, expected.length, async (page) => {
      await expect.poll(() => page.evaluate(() => document.querySelector('video')!.paused === false)).toBe(true);
      await page.click('button');
    });
    expect(got).toEqual(expected);
  });
}

/** Правила автоплея, которые тема утверждает карточками, — скриптом самой страницы, без жеста. */
const POLICY_PAGE = `<video id="attr" src="clip.mp4" autoplay></video>
<video id="attrMuted" src="clip.mp4" autoplay muted></video>
<video id="silent" src="silent.webm"></video>
<script>
  window.r = {
    policy: typeof navigator.getAutoplayPolicy === 'function' ? navigator.getAutoplayPolicy('mediaelement') : 'нет метода',
    activeBefore: navigator.userActivation.hasBeenActive,
  };
  const silent = document.getElementById('silent');
  silent.addEventListener('canplay', () => silent.play().then(() => r.silent = 'ok', (e) => r.silent = e.name), { once: true });
  document.getElementById('attrMuted').addEventListener('playing', () => {
    setTimeout(() => {
      r.attrMuted = 'играет';
      r.attr = document.getElementById('attr').paused ? 'стоит' : 'играет';
    }, 500);
  }, { once: true });
</script>`;

const POLICY: Record<'chromium' | 'firefox', Record<string, unknown>> = {
  chromium: { policy: 'нет метода', activeBefore: false, silent: 'NotAllowedError', attr: 'стоит', attrMuted: 'играет' },
  firefox: { policy: 'allowed-muted', activeBefore: false, silent: 'ok', attr: 'стоит', attrMuted: 'играет' },
};

for (const name of ['chromium', 'firefox'] as const) {
  test(`правила автоплея в ${name}: атрибут autoplay, дорожка без звука, getAutoplayPolicy`, async () => {
    await withBrowser(name, async (browser) => {
      const page = await browser.newPage();
      const logged = await serve(page, POLICY_PAGE);
      await page.goto(`${ORIGIN}/`);
      // poll через evaluate безопасен: всё нужное страница уже записала сама, до первого evaluate
      await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { r: object }).r).length), { timeout: 8000 }).toBe(5);
      const r = await page.evaluate(() => (window as unknown as { r: object }).r);
      expect(r).toEqual(POLICY[name]);
      expect(logged, 'атрибут autoplay без muted молчит: ошибки нет').toEqual([]);
      expect(await page.evaluate(() => navigator.userActivation.hasBeenActive), 'page.evaluate засчитан как жест').toBe(true);
    });
  });
}

test('getAutoplayPolicy нет в WebKit', async () => {
  await withBrowser('webkit', async (browser) => {
    const page = await browser.newPage();
    await page.setContent('<p>стенд</p>');
    expect(await page.evaluate(() => typeof (navigator as { getAutoplayPolicy?: unknown }).getAutoplayPolicy)).toBe('undefined');
  });
});

const CODEC_CHANNEL: Record<Name, string | undefined> = { chromium: 'chromium', firefox: undefined, webkit: undefined };

for (const name of ALL) {
  test(`кодеки в ${name}: canPlayType, isTypeSupported и decodingInfo совпадают со снимком`, async () => {
    const got = await withBrowser(name, async (browser) => {
      const page = await browser.newPage();
      const logged = await serve(page, '<p>стенд</p>');
      await page.goto(`${ORIGIN}/`);
      await page.evaluate(`(async () => { ${CODEC_CODE} })()`);
      return logged;
    }, CODEC_CHANNEL[name]);
    expect(got).toEqual(CODEC_SNAPSHOT[name]);
  });
}

test('headless shell Chromium: HEVC не узнаёт и экономного декодера не видит', async () => {
  const got = await withBrowser('chromium', async (browser) => {
    const page = await browser.newPage();
    const logged = await serve(page, '<p>стенд</p>');
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(`(async () => { ${CODEC_CODE} })()`);
    return logged;
  });
  expect(got.find((l) => l.includes('hvc1'))).toContain('| "" false');
  expect(got.every((l) => l.endsWith('powerEfficient=false'))).toBe(true);
});

test('плейлисты в теме — те самые файлы стенда', () => {
  expect(readFileSync(`${FIXTURES}/hls/index.m3u8`, 'utf8')).toBe(MASTER_M3U8);
  expect(readFileSync(`${FIXTURES}/hls/low/index.m3u8`, 'utf8')).toBe(MEDIA_M3U8);
  expect(readFileSync(`${FIXTURES}/hls/high/index.m3u8`, 'utf8')).toBe(MEDIA_M3U8);
  expect(readFileSync(`${FIXTURES}/hls/low/init.mp4`).length).toBe(827);
});

const HLS_NATIVE: Record<Name, string> = { chromium: 'loadedmetadata 4', firefox: 'error 4', webkit: 'loadedmetadata 4' };

for (const name of ALL) {
  test(`HLS по ссылке на плейлист в ${name}: ${HLS_NATIVE[name]}`, async () => {
    await withBrowser(name, async (browser) => {
      const page = await browser.newPage();
      await serve(page, `<video src="hls/index.m3u8" muted></video><script>
        const v = document.querySelector('video');
        v.addEventListener('loadedmetadata', () => window.hls = 'loadedmetadata ' + v.duration);
        v.addEventListener('error', () => window.hls = 'error ' + v.error.code);
      </script>`);
      await page.goto(`${ORIGIN}/`);
      await expect.poll(() => page.evaluate(() => (window as unknown as { hls?: string }).hls), { timeout: 8000 }).toBe(HLS_NATIVE[name]);
    });
  });
}

const MSE_PAGE = `${MSE_SETUP_CODE}\n${MSE_FEED_CODE}`;
const STALL_PAGE = `${MSE_SETUP_CODE}\n${STALL_CODE}`;

for (const name of ALL) {
  test(`MediaSource в ${name}: init, четыре куска, смена качества на 2.0 с`, async () => {
    const expected = MSE_OUT.split('\n');
    // resize приходит, когда кадр уже на экране, а currentTime к этому моменту бывает и 2.1
    const got = (await run(name, MSE_PAGE, /^конец$/)).map((l) => l.replace(/^(кадр 320×180 на) 2\.[01] с$/, '$1 2.0 с'));
    if (name === 'chromium') {
      expect(got).toEqual(expected);
    } else {
      // первый resize Firefox и WebKit печатают в другом месте (WebKit — ещё и 0×0)
      const steady = (lines: string[]) => lines.filter((l) => !/^кадр (160×90|0×0) на 0\.0 с$/.test(l));
      expect(steady(got)).toEqual(steady(expected));
    }
  });
}

for (const name of ALL) {
  test(`waiting и перемотка в ${name}`, async () => {
    const expected = STALL_OUT.split('\n');
    const got = await run(name, STALL_PAGE, expected.length);
    if (name === 'chromium') {
      expect(got).toEqual(expected);
    } else if (name === 'firefox') {
      expect(got).toEqual([expected[0], expected[1].replace('readyState = 4', 'readyState = 3'), expected[2], expected[3]]);
    } else {
      // WebKit встаёт на 1.0, а на перемотке оставляет readyState 3
      expect(got).toEqual([
        'ждёт t = 1.0 readyState = 2 буфер 0.0–1.0',
        'играет t = 1.0 readyState = 3 буфер 0.0–2.0',
        'перематывает t = 3.2 readyState = 3 буфер 0.0–2.0',
        'перемотал t = 3.2 readyState = 3 буфер 0.0–2.0, 3.0–4.0',
      ]);
    }
  });
}

/** Мелочи MSE: второй append во время первого, paused при waiting, ended без endOfStream. */
const MSE_FACTS_PAGE = `${MSE_SETUP_CODE}
  const r = (window.r = {});
  r.changeType = typeof buffer.changeType;
  await append('hls/low/init.mp4');
  const bytes = await (await fetch('hls/low/0.m4s')).arrayBuffer();
  const done = new Promise((ok) => buffer.addEventListener('updateend', ok, { once: true }));
  buffer.appendBuffer(bytes);
  try { buffer.appendBuffer(bytes); r.second = 'нет ошибки'; } catch (e) { r.second = e.name; }
  await done;
  for (const n of [1, 2, 3]) await append(\`hls/low/\${n}.m4s\`);
  video.muted = true;
  video.addEventListener('ended', () => { r.ended = true; });
  video.addEventListener('waiting', () => {
    if (video.currentTime > 3) r.waitingPaused = video.paused;
  });
  await video.play();
  setTimeout(() => { r.done = true; }, 5500);
</script>`;

for (const name of ALL) {
  test(`MediaSource в ${name}: InvalidStateError, waiting — не пауза, без endOfStream нет ended`, async () => {
    await withBrowser(name, async (browser) => {
      const page = await browser.newPage();
      await serve(page, MSE_FACTS_PAGE);
      await page.goto(`${ORIGIN}/`);
      await expect.poll(() => page.evaluate(() => (window as unknown as { r?: { done?: boolean } }).r?.done), { timeout: 10_000 }).toBe(true);
      const r = await page.evaluate(() => (window as unknown as { r: Record<string, unknown> }).r);
      expect(r.second).toBe('InvalidStateError');
      expect(r.changeType).toBe('function');
      expect(r.ended, 'без endOfStream ended не приходит').toBeUndefined();
      if (name !== 'webkit') expect(r.waitingPaused, 'на конце буфера — waiting, а paused остаётся false').toBe(false);
    });
  });
}

for (const name of ['chromium', 'firefox', 'webkit'] as const) {
  test(`requestVideoFrameCallback в ${name}: по вызову на кадр ролика, реже кадров экрана`, async () => {
    const got = await run(name, FRAME_CODE, 4);
    const [, frames, paints] = /^кадров (\d+) · отрисовок экрана (\d+)$/.exec(got[3]) ?? [];
    if (name === 'firefox') {
      // Firefox обычно сообщает первый кадр дважды (21–22 вызова). В полном прогоне 2026-11-03
      // под нагрузкой повтора не было — 20 вызовов. Держим диапазон, а не точный повтор.
      expect(got[0]).toBe('кадр 1 время в ролике 0.0');
      expect(Number(frames)).toBeGreaterThanOrEqual(20);
      expect(Number(frames)).toBeLessThanOrEqual(22);
    } else {
      expect(Number(frames)).toBe(20);
    }
    expect(Number(paints)).toBeGreaterThan(3 * Number(frames));
    if (name === 'chromium') expect(got.slice(0, 3)).toEqual(FRAME_OUT.split('\n').slice(0, 3));
    expect(FRAME_OUT.split('\n')[3]).toMatch(/^кадров 20 · /);
  });
}

for (const name of ALL) {
  test(`кадр с чужого источника пачкает холст в ${name}`, async () => {
    await withBrowser(name, async (browser) => {
      const read = async (crossorigin: boolean) => {
        const page = await browser.newPage();
        await page.route('http://cdn.media-video.test/**', (route) =>
          route.fulfill({ contentType: 'video/mp4', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(`${FIXTURES}/clip.mp4`) }));
        await serve(page, `<video muted ${crossorigin ? 'crossorigin="anonymous"' : ''} src="http://cdn.media-video.test/clip.mp4"></video><script>
          const v = document.querySelector('video');
          v.addEventListener('loadeddata', () => {
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.drawImage(v, 0, 0);
            try { ctx.getImageData(0, 0, 1, 1); window.px = 'прочитан'; } catch (e) { window.px = e.name; }
          });
        </script>`);
        await page.goto(`${ORIGIN}/`);
        await expect.poll(() => page.evaluate(() => (window as unknown as { px?: string }).px)).toBeTruthy();
        const result = await page.evaluate(() => (window as unknown as { px: string }).px);
        await page.close();
        return result;
      };
      expect(await read(false)).toBe('SecurityError');
      expect(await read(true)).toBe('прочитан');
    });
  });
}

for (const name of ALL) {
  test(`preload, duration до метаданных и Picture-in-Picture в ${name}`, async () => {
    await withBrowser(name, async (browser) => {
      const page = await browser.newPage();
      await serve(page, `<video id="none" src="clip.mp4" preload="none"></video>
        <video id="meta" src="clip.mp4" preload="metadata"></video><script>
        window.ev = { none: [], meta: [] };
        for (const id of ['none', 'meta']) for (const e of ['loadstart', 'suspend', 'loadedmetadata', 'canplaythrough'])
          document.getElementById(id).addEventListener(e, () => ev[id].push(e));
      </script>`);
      await page.goto(`${ORIGIN}/`);
      await page.waitForTimeout(1500);
      const got = await page.evaluate(() => ({
        ev: (window as unknown as { ev: Record<string, string[]> }).ev,
        duration: (document.getElementById('none') as HTMLVideoElement).duration,
        pip: document.pictureInPictureEnabled,
        mms: typeof (window as unknown as { ManagedMediaSource?: unknown }).ManagedMediaSource,
      }));
      expect(got.ev.none).toEqual(['loadstart', 'suspend']);
      expect(Number.isNaN(got.duration)).toBe(true);
      expect(got.ev.meta).toContain('loadedmetadata');
      expect(got.ev.meta.includes('canplaythrough')).toBe(name !== 'webkit');
      expect(got.pip).toBe(true);
      expect(got.mms).toBe(name === 'webkit' ? 'function' : 'undefined');
    });
  });
}

test('<source>: Chromium без HEVC пропускает первый источник и берёт webm', async () => {
  await withBrowser('chromium', async (browser) => {
    const page = await browser.newPage();
    await serve(page, `<video muted>
      <source src="clip.mp4" type='video/mp4; codecs="hvc1.1.6.L93.B0"'>
      <source src="clip.webm" type="video/webm">
    </video>`);
    await page.goto(`${ORIGIN}/`);
    await expect.poll(() => page.evaluate(() => document.querySelector('video')!.currentSrc)).toBe(`${ORIGIN}/clip.webm`);
  });
});
