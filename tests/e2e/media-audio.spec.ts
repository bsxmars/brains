import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import {
  AUTOPLAY_CODE,
  AUTOPLAY_OUT,
  BUSY_CODE,
  CLICK_CODE,
  CLICK_OUT,
  DECODE_CODE,
  DECODE_OUT,
  ECHO_CODE,
  ECHO_OUT,
  FILTER_CODE,
  FILTER_OUT,
  FIRST_CODE,
  FIRST_HTML,
  FIRST_OUT,
  LATENCY_ROWS,
  START_CODE,
  START_OUT,
  SUSPEND_CODE,
  SUSPEND_OUT,
  WORKLET_MAIN_CODE,
  WORKLET_OUT,
  WORKLET_PROCESSOR_CODE,
} from '../../src/content/lessons/media-audio/data';

/**
 * «Звук: Web Audio API» — каждый пример темы с выводом, той же строкой, что видит читатель.
 *
 * Страница и файлы отдаются настоящим `node:http` на `localhost`, а не `page.route`:
 * `audioWorklet` есть только в безопасном контексте, а модуль ворклета Chromium грузит мимо
 * перехвата Playwright (`AbortError … Network error`). `localhost` безопасен и без https.
 *
 * ⚠️ `page.evaluate` Playwright считается жестом пользователя: контекст, созданный в нём,
 * сразу `running`. Поэтому примеры исполняет сама страница (`<script type="module">`),
 * а жест — настоящий `page.click`. Страница курса не нужна.
 *
 * Движки, кроме Chromium, запускаются прямо из теста там, где тема называет их поведение.
 */

const WAV = readFileSync(new URL('../fixtures/media-audio/tone-440.wav', import.meta.url));

/** Тело страницы на текущий тест: `/` отдаёт его, остальные пути — общие файлы. */
let pageBody = '';
let server: Server;
let origin = '';

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/quieter.js') {
      res.setHeader('content-type', 'text/javascript');
      return res.end(WORKLET_PROCESSOR_CODE);
    }
    if (req.url === '/tone-440.wav') {
      res.setHeader('content-type', 'audio/wav');
      return res.end(WAV);
    }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(pageBody);
  });
  await new Promise<void>((done) => server.listen(0, 'localhost', done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** Предупреждения и ошибки консоли последней открытой страницы — отдельно от вывода примера. */
const warnings: string[] = [];

/** Открыть страницу с примером и собирать её консоль. */
async function open(page: Page, code: string, html = '') {
  pageBody = `<!doctype html><meta charset="utf-8">${html}<script type="module">${code}</script>`;
  const logged: string[] = [];
  warnings.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'log') logged.push(m.text());
    else warnings.push(m.text());
  });
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
  await page.goto(`${origin}/`);
  return logged;
}

async function lines(page: Page, code: string, expected: string) {
  const logged = await open(page, code);
  const want = expected.split('\n');
  await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(want.length);
  expect(logged).toEqual(want);
}

const ENGINES: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

async function withEngine(type: BrowserType, run: (page: Page) => Promise<void>) {
  const browser: Browser = await type.launch();
  try {
    await run(await browser.newPage());
  } finally {
    await browser.close();
  }
}

// ─── Первый звук ───────────────────────────────────────────────────────────────────────────

for (const [name, type] of ENGINES) {
  test(`первый звук: suspended до клика, running после, нота доигрывает — ${name}`, async () => {
    await withEngine(type, async (page) => {
      const logged = await open(page, FIRST_CODE, FIRST_HTML);
      await expect.poll(() => logged.length).toBeGreaterThanOrEqual(1);
      await page.click('button');
      await expect.poll(() => logged.length, { timeout: 5000 }).toBeGreaterThanOrEqual(3);
      expect(logged).toEqual(FIRST_OUT.split('\n'));
    });
  });
}

for (const [name, type] of ENGINES) {
  test(`контекст, созданный в обработчике клика: сразу running или ещё нет — ${name}`, async () => {
    await withEngine(type, async (page) => {
      const logged = await open(
        page,
        `document.querySelector('button').onclick = () => console.log(new AudioContext().state);`,
        FIRST_HTML,
      );
      await page.click('button');
      await expect.poll(() => logged.length).toBe(1);
      expect(logged[0]).toBe(name === 'chromium' ? 'running' : 'suspended');
    });
  });
}

test('генератор одноразовый: второй start — InvalidStateError', async ({ page }) => {
  await page.setContent('<p>стенд</p>');
  const name = await page.evaluate(() => {
    const osc = new OscillatorNode(new OfflineAudioContext(1, 128, 48000));
    osc.start();
    try {
      osc.start();
      return 'ok';
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(name).toBe('InvalidStateError');
});

for (const [name, type] of ENGINES) {
  test(`без жеста resume() висит, клик его выполняет — ${name}`, async () => {
    await withEngine(type, async (page) => {
      const logged = await open(page, AUTOPLAY_CODE, FIRST_HTML);
      await page.waitForTimeout(1300);
      expect(logged, 'за секунду без жеста промис не выполнился').toEqual([AUTOPLAY_OUT.split('\n')[0]]);
      if (name === 'webkit') expect(warnings, 'WebKit молчит').toEqual([]);
      else expect(warnings.join('\n'), 'Chromium и Firefox предупреждают').toMatch(/user gesture/);
      await page.click('button');
      await expect.poll(() => logged.length).toBeGreaterThanOrEqual(3);
      expect(logged).toEqual(AUTOPLAY_OUT.split('\n'));
    });
  });
}

// ─── Граф ──────────────────────────────────────────────────────────────────────────────────

test('эхо: звучат ровно два сэмпла', ({ page }) => lines(page, ECHO_CODE, ECHO_OUT));

test('фильтр нижних частот глушит 6000 Гц, а 440 пропускает', ({ page }) => lines(page, FILTER_CODE, FILTER_OUT));

// ─── Время ─────────────────────────────────────────────────────────────────────────────────

test('start(when) попадает в сэмпл', ({ page }) => lines(page, START_CODE, START_OUT));

for (const [name, type] of [ENGINES[0], ENGINES[2]]) {
  test(`рывок громкости — скачок, спуск за 10 мс — нет — ${name}`, async () => {
    await withEngine(type, (page) => lines(page, CLICK_CODE, CLICK_OUT));
  });
}

for (const [name, type] of ENGINES) {
  test(`спуск без якоря идёт от нуля секунд, экспонента к нулю — RangeError — ${name}`, async () => {
    await withEngine(type, async (page) => {
      await page.setContent('<p>стенд</p>');
      const got = await page.evaluate(async () => {
        const ctx = new OfflineAudioContext(1, 4800, 48000);
        const one = new ConstantSourceNode(ctx);
        const g = new GainNode(ctx);
        one.connect(g).connect(ctx.destination);
        g.gain.linearRampToValueAtTime(0, 0.1);
        one.start();
        const out = (await ctx.startRendering()).getChannelData(0);
        let exp = 'ok';
        try {
          g.gain.exponentialRampToValueAtTime(0, 0.2);
        } catch (e) {
          exp = (e as Error).name;
        }
        return { ramp: [0, 1200, 2400, 3600, 4799].map((i) => Number(out[i].toFixed(3))), exp };
      });
      expect(got).toEqual({ ramp: [1, 0.75, 0.5, 0.25, 0], exp: 'RangeError' });
    });
  });
}

// ─── Блоки и задержка ──────────────────────────────────────────────────────────────────────

test('suspend округляет вверх до границы блока', ({ page }) => lines(page, SUSPEND_CODE, SUSPEND_OUT));

for (const [name, type] of ENGINES) {
  test(`часы звука шагают блоками, задержки совпадают с таблицей — ${name}`, async () => {
    await withEngine(type, async (page) => {
      await open(page, '', FIRST_HTML);
      await page.click('button'); // жест, чтобы контекст пошёл и в собственном коде страницы
      const got = await page.evaluate(async () => {
        const ctx = new AudioContext();
        await ctx.resume();
        await new Promise((r) => setTimeout(r, 400));
        const seen = new Set<number>();
        const t0 = performance.now();
        while (performance.now() - t0 < 50) seen.add(Math.round(ctx.currentTime * ctx.sampleRate));
        const hints: Record<string, number> = {};
        for (const hint of ['interactive', 'balanced', 'playback'] as const) {
          const c = new AudioContext({ latencyHint: hint });
          hints[hint] = Math.round(c.baseLatency * c.sampleRate);
          await c.close();
        }
        const quantum = (ctx as AudioContext & { renderQuantumSize?: number }).renderQuantumSize;
        return { frames: [...seen], hints, sampleRate: ctx.sampleRate, quantum };
      });
      expect(got.sampleRate).toBe(48000);
      expect(got.frames.every((f) => f % 128 === 0), 'все значения часов — на границе блока').toBe(true);
      if (name === 'firefox') expect(got.frames.length, 'в Firefox часы стоят всю задачу').toBe(1);
      else expect(got.frames.length, 'часы идут внутри задачи').toBeGreaterThan(5);
      const column = name === 'chromium' ? 'v' : name === 'firefox' ? 'w' : 'x';
      const want = LATENCY_ROWS.map((r) => (r[column] === '0' ? 0 : Number(r[column].split(' ')[0])));
      expect([got.hints.interactive, got.hints.balanced, got.hints.playback]).toEqual(want);
      expect(got.quantum).toBe(name === 'chromium' ? 128 : undefined);
    });
  });
}

test('renderSizeHint в Chromium меняет блок и для ворклета', async ({ page }) => {
  await open(page, '');
  const got = await page.evaluate(async () => {
    const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1024, sampleRate: 48000, renderSizeHint: 256 } as OfflineAudioContextOptions);
    await ctx.audioWorklet.addModule('quieter.js');
    const node = new AudioWorkletNode(ctx, 'quieter');
    const first = new Promise<string>((done) => (node.port.onmessage = (e) => done(e.data)));
    new ConstantSourceNode(ctx).connect(node).connect(ctx.destination);
    await ctx.startRendering();
    return { quantum: (ctx as OfflineAudioContext & { renderQuantumSize?: number }).renderQuantumSize, first: await first };
  });
  expect(got).toEqual({ quantum: 256, first: 'блок: 256, частота: 48000' });
});

// ─── AudioWorklet ──────────────────────────────────────────────────────────────────────────

test('ворклет: 10 блоков по 128, вдвое тише', ({ page }) => lines(page, WORKLET_MAIN_CODE, WORKLET_OUT));

for (const [name, type] of ENGINES) {
  test(`ворклет: что есть в его глобальной области и как он живёт при занятом главном потоке — ${name}`, async () => {
    await withEngine(type, async (page) => {
      const logged = await open(page, BUSY_CODE, FIRST_HTML);
      await page.click('button');
      await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
      const calls = Number(logged[0].match(/: (\d+) вызовов/)?.[1]);
      const blocks = Number(logged[1].match(/: (\d+)$/)?.[1]);
      expect(blocks).toBe(113);
      // Главный поток стоял; без отдельного потока вызовов было бы 0. Под нагрузкой бывало 94 из 113.
      expect(calls / blocks, logged[0]).toBeGreaterThan(0.6);
      expect(calls / blocks, logged[0]).toBeLessThan(1.1);

      const scope = await page.evaluate(async () => {
        const probe = `registerProcessor('scope', class extends AudioWorkletProcessor {
          constructor() { super(); this.port.postMessage({
            setTimeout: typeof setTimeout, fetch: typeof fetch, performance: typeof performance,
            queueMicrotask: typeof queueMicrotask, window: typeof globalThis.window,
            sampleRate: typeof sampleRate, currentTime: typeof currentTime, currentFrame: typeof currentFrame,
            Atomics: typeof Atomics }); }
          process() { return false; } });`;
        const url = URL.createObjectURL(new Blob([probe], { type: 'text/javascript' }));
        const ctx = new OfflineAudioContext(1, 128, 48000);
        await ctx.audioWorklet.addModule(url);
        const node = new AudioWorkletNode(ctx, 'scope');
        return new Promise((done) => (node.port.onmessage = (e) => done(e.data)));
      });
      expect(scope).toEqual({
        setTimeout: 'undefined',
        fetch: 'undefined',
        performance: 'undefined',
        queueMicrotask: 'undefined',
        window: 'undefined',
        sampleRate: 'number',
        currentTime: 'number',
        currentFrame: 'number',
        Atomics: 'object',
      });
    });
  });
}

test('без безопасного контекста audioWorklet нет, а AudioContext есть', async ({ page }) => {
  await page.route('http://media-audio.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<p>стенд</p>' }));
  await page.goto('http://media-audio.test/');
  const got = await page.evaluate(() => ({ secure: isSecureContext, worklet: typeof new AudioContext().audioWorklet }));
  expect(got).toEqual({ secure: false, worklet: 'undefined' });
});

// ─── Декодирование ─────────────────────────────────────────────────────────────────────────

test('decodeAudioData: пересчёт на частоту контекста, буфер отдан, работает без жеста', ({ page }) =>
  lines(page, DECODE_CODE, DECODE_OUT));

test('decodeAudioData: на 44 100 Гц длина как в файле, мусор — EncodingError', async ({ page }) => {
  await open(page, '');
  const got = await page.evaluate(async () => {
    const bytes = await (await fetch('tone-440.wav')).arrayBuffer();
    const off = new OfflineAudioContext(1, 1, 44100);
    const tone = await off.decodeAudioData(bytes);
    let bad = 'ok';
    try {
      await off.decodeAudioData(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer);
    } catch (e) {
      bad = (e as Error).name;
    }
    return { length: tone.length, bad };
  });
  expect(got).toEqual({ length: 4410, bad: 'EncodingError' });
});

test('WebKit не отсоединяет буфер после decodeAudioData', async () => {
  await withEngine(webkit, async (page) => {
    await open(page, '');
    const left = await page.evaluate(async () => {
      const bytes = await (await fetch('tone-440.wav')).arrayBuffer();
      await new AudioContext().decodeAudioData(bytes);
      return bytes.byteLength;
    });
    expect(left).toBe(8898);
  });
});

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

for (const [name, type] of ENGINES) {
  test(`второй источник из одного <audio> и suspend офлайн-контекста — ${name}`, async () => {
    await withEngine(type, async (page) => {
      await open(page, '', '<audio src="/tone-440.wav"></audio>');
      const got = await page.evaluate(() => {
        const el = document.querySelector('audio') as HTMLAudioElement;
        const ctx = new AudioContext();
        ctx.createMediaElementSource(el);
        let again = 'ok';
        try {
          ctx.createMediaElementSource(el);
        } catch (e) {
          again = (e as Error).name;
        }
        return { again, suspend: typeof OfflineAudioContext.prototype.suspend };
      });
      expect(got).toEqual(
        name === 'firefox' ? { again: 'ok', suspend: 'undefined' } : { again: 'InvalidStateError', suspend: 'function' },
      );
    });
  });
}
