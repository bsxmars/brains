import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import {
  FORMAT_DEFAULT,
  FORMAT_SUPPORT,
  FORMAT_TYPES,
  PERMISSION_CODE,
  PERMISSION_OUT_DENIED,
  PERMISSION_OUT_GRANTED,
  PROCESSING_CODE,
  PROCESSING_OUT,
  RECOGNIZE_CODE,
  RECORD_CODE,
  RECORD_OUT,
  SPEAK_CODE,
  SPEAK_OUT,
  STOP_CODE,
  UPLOAD_CODE,
} from '../../src/content/lessons/media-voice/data';
import { withBrowser } from '../helpers/with-browser';

/**
 * «Голос: запись с микрофона и речь» — каждое утверждение темы о поведении браузера.
 *
 * Страницы отдаются `page.route` с выдуманного `https://voice.test` (https — безопасный контекст).
 * Микрофон поддельный: в Chromium флаги `--use-fake-device-for-media-stream` и
 * `--use-fake-ui-for-media-stream` (с `=deny` — человек отказал), в Firefox — `media.navigator.streams.fake`,
 * в WebKit — встроенный «Mock audio device». Браузеры запускаются из теста: важно сравнение
 * движков и разные флаги, а проект `chromium` в конфиге один. Страница курса не нужна.
 *
 * Распознавание речи — в полном Chromium (`channel: 'chromium'`): в headless shell
 * `SpeechRecognition.available()` роняет вкладку. Что распознавание вернёт на живой речи,
 * здесь не проверяется — у поддельного микрофона речи нет.
 *
 * Синтез на macOS звучит из динамиков, поэтому громкость глушится обёрткой над
 * `speechSynthesis.speak` до загрузки страницы; код примера при этом исполняется как есть.
 */

const ORIGIN = 'https://voice.test';
const FAKE = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
const MUTE_SPEECH = `{
  const speak = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { u.volume = 0; speak(u); };
}`;

type Logged = string[];

async function open(
  browser: Browser,
  body: string,
  opts: { permissions?: string[]; headers?: Record<string, string>; origin?: string; init?: string } = {},
): Promise<{ page: Page; logged: Logged; uploads: Map<string, Buffer> }> {
  // `permissions: []` в Playwright — не «не спрашивали», а «отказано во всём»: состояние `denied`.
  const ctx = await browser.newContext(opts.permissions ? { permissions: opts.permissions } : {});
  const page = await ctx.newPage();
  if (opts.init) await page.addInitScript(opts.init);
  const origin = opts.origin ?? ORIGIN;
  const uploads = new Map<string, Buffer>();
  await page.route(`${origin}/**`, (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/voice/')) {
      uploads.set(path + new URL(req.url()).search, req.postDataBuffer() ?? Buffer.alloc(0));
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ contentType: 'text/html', headers: opts.headers, body });
  });
  const logged: Logged = [];
  page.on('console', (m) => logged.push(m.text()));
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.message}`));
  await page.goto(`${origin}/`);
  return { page, logged, uploads };
}

const html = (code: string, extra = '') =>
  `<!doctype html><meta charset="utf-8">${extra}<script type="module">${code}</script>`;

test.describe('раздел «Запись с микрофона»', () => {
  test('RECORD_CODE: куски каждые 500 мс, тип WebM/Opus, у <audio> длительность Infinity', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { page, logged } = await open(browser, html(RECORD_CODE, '<audio controls></audio>'), { permissions: ['microphone'] });
      await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);

      const [count, type, bytes] = logged.map((l) => l.split(': ')[1]);
      const [, typeOut] = RECORD_OUT.split('\n').map((l) => l.split(': ')[1]);
      expect(type).toBe(typeOut);
      expect(Number(count)).toBeGreaterThanOrEqual(4);
      expect(Number(count)).toBeLessThanOrEqual(6);
      expect(Number(RECORD_OUT.split('\n')[0].split(': ')[1])).toBeGreaterThanOrEqual(4);
      expect(Number(bytes)).toBeGreaterThan(0);

      const duration = await page.evaluate(async () => {
        const audio = document.querySelector('audio')!;
        if (audio.readyState < 1) await new Promise((r) => (audio.onloadedmetadata = r));
        return String(audio.duration);
      });
      expect(duration, 'MediaRecorder не пишет длительность в заголовок').toBe('Infinity');
    });
  });

  test('заголовок только в первом куске; mimeType пуст сразу после start', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { page } = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      const got = await page.evaluate(async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.start(500);
        const mimeAfterStart = recorder.mimeType;
        await new Promise((r) => setTimeout(r, 1600));
        await new Promise((r) => {
          recorder.onstop = r;
          recorder.stop();
        });
        stream.getTracks().forEach((t) => t.stop());
        const head = async (b: Blob) => [...new Uint8Array(await b.slice(0, 4).arrayBuffer())].map((x) => x.toString(16).padStart(2, '0')).join(' ');
        const decode = async (parts: Blob[]) => {
          try {
            return (await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await new Blob(parts).arrayBuffer())).duration;
          } catch (e) {
            return (e as Error).name;
          }
        };
        return {
          mimeAfterStart,
          chunkType: chunks[0].type,
          head0: await head(chunks[0]),
          head1: await head(chunks[1]),
          second: await decode([chunks[1]]),
          all: await decode(chunks),
        };
      });
      expect(got.mimeAfterStart).toBe('');
      expect(got.chunkType).toBe(FORMAT_DEFAULT.chromium);
      expect(got.head0).toBe('1a 45 df a3');
      expect(got.head1).not.toBe('1a 45 df a3');
      expect(got.second).toBe('EncodingError');
      expect(typeof got.all).toBe('number');
    });
  });

  const ENGINES: [keyof typeof FORMAT_SUPPORT, BrowserType, Parameters<BrowserType['launch']>[0], string[]][] = [
    ['chromium', chromium, { args: FAKE }, ['microphone']],
    ['firefox', firefox, { firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } }, []],
    ['webkit', webkit, {}, ['microphone']],
  ];

  for (const [name, type, launch, permissions] of ENGINES) {
    test(`форматы в ${name}: isTypeSupported и тип по умолчанию`, async () => {
      await withBrowser(type, launch, async (browser) => {
        const { page } = await open(browser, '<p>стенд</p>', { permissions });
        const got = await page.evaluate(async (types) => {
          const support = types.map((t) => MediaRecorder.isTypeSupported(t));
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const recorder = new MediaRecorder(stream);
          const first = new Promise<string>((r) => (recorder.ondataavailable = (e) => r(e.data.type)));
          recorder.start(300);
          const chunkType = await first;
          recorder.stop();
          stream.getTracks().forEach((t) => t.stop());
          return { support, chunkType };
        }, [...FORMAT_TYPES]);
        expect(got.support).toEqual(FORMAT_SUPPORT[name]);
        expect(got.chunkType).toBe(FORMAT_DEFAULT[name]);
      });
    });
  }
});

test.describe('раздел «Разрешение и индикатор»', () => {
  test('PERMISSION_CODE: с правом — granted и имя микрофона', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { logged } = await open(browser, html(PERMISSION_CODE), { permissions: ['microphone'] });
      await expect.poll(() => logged.length).toBeGreaterThanOrEqual(2);
      expect(logged).toEqual(PERMISSION_OUT_GRANTED.split('\n'));
    });
  });

  test('PERMISSION_CODE: человек отказал — prompt и NotAllowedError; до разрешения имён устройств нет', async () => {
    await withBrowser(chromium, { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream=deny'] }, async (browser) => {
      const { page, logged } = await open(browser, html(PERMISSION_CODE));
      await expect.poll(() => logged.length).toBeGreaterThanOrEqual(2);
      expect(logged).toEqual(PERMISSION_OUT_DENIED.split('\n'));
      const labels = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => d.label));
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((l) => l === '')).toBe(true);
    });
  });

  test('ошибки getUserMedia: Permissions-Policy, exact, пустой запрос, http', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const err = (p: Page, c: MediaStreamConstraints) =>
        p.evaluate(async (c) => {
          try {
            await navigator.mediaDevices.getUserMedia(c);
            return 'ok';
          } catch (e) {
            return `${(e as Error).name}/${(e as { constraint?: string }).constraint ?? ''}`;
          }
        }, c);

      const policy = await open(browser, '<p>стенд</p>', { permissions: ['microphone'], headers: { 'Permissions-Policy': 'microphone=()' } });
      expect(await err(policy.page, { audio: true })).toBe('NotAllowedError/');

      const plain = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      expect(await err(plain.page, { audio: { deviceId: { exact: 'нет-такого' } } })).toBe('OverconstrainedError/deviceId');
      expect(await err(plain.page, {})).toBe('TypeError/');

      const insecure = await open(browser, '<p>стенд</p>', { permissions: ['microphone'], origin: 'http://voice.test' });
      expect(await insecure.page.evaluate(() => [isSecureContext, typeof navigator.mediaDevices])).toEqual([false, 'undefined']);
    });
  });

  test('NotFoundError, когда устройств нет (снято на камере: поддельные микрофоны не убираются)', async () => {
    await withBrowser(chromium, { args: ['--use-fake-device-for-media-stream=device-count=0', '--use-fake-ui-for-media-stream'] }, async (browser) => {
      const { page } = await open(browser, '<p>стенд</p>', { permissions: ['camera'] });
      const name = await page.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'ok', (e: Error) => e.name));
      expect(name).toBe('NotFoundError');
    });
  });

  test('STOP_CODE: остановленная дорожка заканчивает запись сама', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { page, logged } = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      const state = await page.evaluate(async (code) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const stopped = new Promise((r) => (recorder.onstop = r));
        recorder.start();
        await new Promise((r) => setTimeout(r, 300));
        await new Function('stream', 'recorder', code)(stream, recorder);
        await Promise.race([stopped, new Promise((r) => setTimeout(r, 3000))]);
        return recorder.state;
      }, STOP_CODE);
      expect(logged).toEqual(['ended', 'false']);
      expect(state).toBe('inactive');
    });
  });
});

test.describe('раздел «Обработка звука микрофона»', () => {
  test('PROCESSING_CODE: выключенная обработка видна в getSettings', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { logged } = await open(browser, html(PROCESSING_CODE), { permissions: ['microphone'] });
      await expect.poll(() => logged.length).toBeGreaterThanOrEqual(2);
      expect(logged).toEqual(PROCESSING_OUT.split('\n'));
    });
  });

  test('по умолчанию обработка включена; applyConstraints молча не включает её', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { page } = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      const got = await page.evaluate(async () => {
        const on = (await navigator.mediaDevices.getUserMedia({ audio: true })).getAudioTracks()[0].getSettings();
        const off = (await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })).getAudioTracks()[0];
        await off.applyConstraints({ echoCancellation: true });
        return { on: [on.echoCancellation, on.noiseSuppression, on.autoGainControl, on.sampleRate], afterApply: off.getSettings().echoCancellation };
      });
      expect(got.on).toEqual([true, true, true, 48000]);
      expect(got.afterApply, 'applyConstraints выполнился, а обработка не включилась').toBe(false);
    });
  });
});

test.describe('раздел «Синтез речи»', () => {
  test('getVoices() сначала пуст, список приходит событием voiceschanged — в трёх движках', async () => {
    for (const type of [chromium, firefox, webkit]) {
      await withBrowser(type, {}, async (browser) => {
        const { page } = await open(browser, '<p>стенд</p>');
        const got = await page.evaluate(
          () =>
            new Promise<[number, number]>((resolve) => {
              const first = speechSynthesis.getVoices().length;
              speechSynthesis.addEventListener('voiceschanged', () => resolve([first, speechSynthesis.getVoices().length]), { once: true });
            }),
        );
        expect(got[0], type.name()).toBe(0);
        expect(got[1], type.name()).toBeGreaterThan(0);
      });
    }
  });

  test('SPEAK_CODE: по клику — «сказано», без действия человека в Chromium — not-allowed', async () => {
    await withBrowser(chromium, {}, async (browser) => {
      const clicked = await open(browser, html(SPEAK_CODE, '<button>Сказать</button>'), { init: MUTE_SPEECH });
      await clicked.page.click('button');
      await expect.poll(() => clicked.logged, { timeout: 10_000 }).toEqual([SPEAK_OUT]);

      const onLoad = await open(browser, html(`${SPEAK_CODE}\nsay('Запись пошла');`, '<button>Сказать</button>'), { init: MUTE_SPEECH });
      await expect.poll(() => onLoad.logged, { timeout: 10_000 }).toEqual(['ошибка: not-allowed']);
    });
  });

  test('без действия человека Firefox и WebKit говорят', async () => {
    for (const type of [firefox, webkit]) {
      await withBrowser(type, {}, async (browser) => {
        const { logged } = await open(browser, html(`${SPEAK_CODE}\nsay('Запись пошла');`, '<button>Сказать</button>'), { init: MUTE_SPEECH });
        await expect.poll(() => logged, { timeout: 10_000, message: type.name() }).toEqual([SPEAK_OUT]);
      });
    }
  });

  test('очередь, cancel и края диапазонов', async () => {
    await withBrowser(chromium, {}, async (browser) => {
      const { page } = await open(browser, '<p>стенд</p>', { init: MUTE_SPEECH });
      const got = await page.evaluate(async () => {
        if (!speechSynthesis.getVoices().length) await new Promise((r) => speechSynthesis.addEventListener('voiceschanged', r, { once: true }));
        const events: string[] = [];
        const make = (text: string, tag: string) => {
          const u = new SpeechSynthesisUtterance(text);
          u.lang = 'ru-RU';
          for (const e of ['start', 'end', 'error']) u.addEventListener(e, (x) => events.push(`${tag}:${e}${(x as SpeechSynthesisErrorEvent).error ? ':' + (x as SpeechSynthesisErrorEvent).error : ''}`));
          return u;
        };
        const a = make('раз', 'a');
        const b = make('два', 'b');
        speechSynthesis.speak(a);
        speechSynthesis.speak(b);
        const queued = [speechSynthesis.speaking, speechSynthesis.pending];
        await new Promise((r) => b.addEventListener('end', r));
        const queue = events.splice(0);
        const c = make('три четыре пять шесть семь восемь девять десять одиннадцать', 'c');
        speechSynthesis.speak(c);
        await new Promise((r) => c.addEventListener('start', r));
        speechSynthesis.cancel();
        await new Promise((r) => setTimeout(r, 500));
        const u = new SpeechSynthesisUtterance('x');
        u.rate = 20;
        u.pitch = 5;
        return { queued, queue, cancel: events, rate: u.rate, pitch: u.pitch };
      });
      expect(got.queued).toEqual([true, true]);
      expect(got.queue).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
      expect(got.cancel).toEqual(['c:start', 'c:error:interrupted']);
      expect([got.rate, got.pitch]).toEqual([10, 2]);
    });
  });
});

test.describe('раздел «Распознавание речи»', () => {
  test('где есть распознавание и его локальный режим', async () => {
    const probe = () => {
      const C = (globalThis as { SpeechRecognition?: { prototype: object } }).SpeechRecognition;
      const W = (globalThis as { webkitSpeechRecognition?: { prototype: object } }).webkitSpeechRecognition;
      const any = (C ?? W) as (Record<string, unknown> & { prototype: object }) | undefined;
      return {
        standard: typeof C === 'function',
        webkit: typeof W === 'function',
        same: C !== undefined && C === W,
        processLocally: any ? 'processLocally' in any.prototype : false,
        available: any ? typeof any.available === 'function' : false,
      };
    };
    const expected = {
      chromium: { standard: true, webkit: true, same: true, processLocally: true, available: true },
      webkit: { standard: false, webkit: true, same: false, processLocally: false, available: false },
      firefox: { standard: false, webkit: false, same: false, processLocally: false, available: false },
    };
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit], ['firefox', firefox]] as const) {
      await withBrowser(type, {}, async (browser) => {
        const { page } = await open(browser, '<p>стенд</p>');
        expect(await page.evaluate(probe), name).toEqual(expected[name]);
      });
    }
  });

  test('RECOGNIZE_CODE: в Firefox — «распознавания нет»', async () => {
    await withBrowser(firefox, {}, async (browser) => {
      const { logged } = await open(browser, html(RECOGNIZE_CODE, '<button>Распознать</button>'));
      await expect.poll(() => logged).toEqual(['распознавания нет']);
    });
  });

  test('RECOGNIZE_CODE в полном Chromium на поддельном микрофоне: ни результата, только no-speech', async () => {
    await withBrowser(chromium, { channel: 'chromium', args: FAKE }, async (browser) => {
      const { page, logged } = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      const states = await page.evaluate(async () => {
        const R = (globalThis as unknown as { SpeechRecognition: { available(o: object): Promise<string> } }).SpeechRecognition;
        return [await R.available({ langs: ['ru-RU'], processLocally: true }), await R.available({ langs: ['ru-RU'], processLocally: false })];
      });
      expect(states).toEqual(['downloadable', 'available']);
      await page.setContent('<button>Распознать</button>');
      await page.evaluate((code) => new Function(code)(), RECOGNIZE_CODE);
      await page.click('button');
      await expect.poll(() => logged, { timeout: 20_000 }).toEqual(['ошибка: no-speech', 'конец']);
    });
  });
});

test.describe('раздел «Голос на сервер»', () => {
  test('UPLOAD_CODE: сервер склеивает куски по номеру; первый обязателен, пропуск в середине молчит', async () => {
    await withBrowser(chromium, { args: FAKE }, async (browser) => {
      const { page, uploads } = await open(browser, '<p>стенд</p>', { permissions: ['microphone'] });
      await page.evaluate(async (code) => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const send = new Function(code + '\nreturn uploadRecording;')();
        const uploaded = send(recorder, 'abc');
        await new Promise((r) => setTimeout(r, 3100));
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        await uploaded;
      }, UPLOAD_CODE);
      await expect.poll(() => [...uploads.keys()].some((k) => k.startsWith('/voice/abc/done'))).toBe(true);

      const done = [...uploads.keys()].find((k) => k.startsWith('/voice/abc/done'))!;
      const count = Number(new URL(done, ORIGIN).searchParams.get('count'));
      await expect.poll(() => uploads.size).toBe(count + 1);
      const parts = Array.from({ length: count }, (_, n) => [...uploads.get(`/voice/abc/${n}`)!]);
      expect(count).toBeGreaterThanOrEqual(3);

      const got = await page.evaluate(async (parts) => {
        const decode = async (list: number[][]) => {
          try {
            const bytes = new Uint8Array(list.flat());
            return (await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(bytes.buffer)).duration;
          } catch (e) {
            return (e as Error).name;
          }
        };
        return {
          all: await decode(parts),
          firstTwo: await decode(parts.slice(0, 2)),
          noMiddle: await decode(parts.filter((_, i) => i !== 1)),
          noFirst: await decode(parts.slice(1)),
        };
      }, parts);
      expect(typeof got.all).toBe('number');
      expect(typeof got.firstTwo).toBe('number');
      expect(got.firstTwo as number).toBeLessThan(got.all as number);
      expect(typeof got.noMiddle).toBe('number');
      expect(got.noMiddle as number).toBeLessThan(got.all as number);
      expect(got.noFirst).toBe('EncodingError');
    });
  });
});
