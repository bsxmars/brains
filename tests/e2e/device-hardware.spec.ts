import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import {
  BT_CODE,
  BT_EMULATION_CODE,
  BT_OUT,
  ERROR_ROWS,
  HID_CODE,
  HID_OUT,
  MIDI_CODE,
  MIDI_OUT,
  MIDI_SAMPLES,
  PERMISSION_CODE,
  PERMISSION_OUT,
  SERIAL_CODE,
  SERIAL_OUT,
  SUPPORT,
  USB_CODE,
} from '../../src/content/lessons/device-hardware/data';

/**
 * «Доступ к железу»: всё, что тема утверждает о поведении, — запуском в настоящих движках.
 *
 * Страница отдаётся `page.route` с выдуманного `https://device-hardware.test` — это безопасный
 * контекст, без него API нет вовсе. Код примеров кладётся **в страницу** (`<script type="module">`),
 * а не в `page.evaluate`: Playwright выполняет `evaluate` с жестом пользователя, и проверка
 * «без клика — `SecurityError`» там ничего бы не доказала (это закреплено отдельной проверкой).
 *
 * Движки запускаются прямо из теста, как в `task-scheduling-engines.spec.ts`: проект `chromium`
 * в конфиге один, а здесь нужны и Firefox (тестовый порт Serial), и WebKit (сравнение поддержки).
 * Нужны бинарники всех трёх. Страница курса не нужна.
 *
 * Чего здесь нет и почему: обмена с USB и HID — подделки этих устройств в Chromium нет,
 * поэтому `USB_CODE` и `HID_CODE` доходят только до окна выбора (в headless shell оно
 * закрывается само, как «закрыли без выбора»).
 */

const ORIGIN = 'https://device-hardware.test';
const OTHER = 'https://other-site.test';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<void>;

const html = (code: string) =>
  `<!doctype html><meta charset="utf-8"><button id="connect">Подключить</button><script type="module">${code}</script>`;

/** Открыть страницу с кодом и собирать её консоль; ошибки страницы — строкой `pageerror: Имя`. */
async function open(page: Page, code: string, frames: Record<string, string> = {}) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const body = frames[url.origin] ?? html(code);
    return route.fulfill({ contentType: 'text/html', body });
  });
  const logged: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'log') logged.push(m.text());
  });
  page.on('pageerror', (e) => logged.push(`pageerror: ${e.name || e.message}`));
  await page.goto(`${ORIGIN}/`);
  return logged;
}

// ─── Поддержка в трёх движках ──────────────────────────────────────────────────────────────

const ENGINES: ['chromium' | 'firefox' | 'webkit', BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

for (const [name, type] of ENGINES) {
  test(`${name}: какие из пяти API есть на https и что остаётся на http`, async () => {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      await page.route('**/*', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>стенд' }));
      const probe = () => ({
        serial: typeof (navigator as unknown as Record<string, unknown>).serial === 'object',
        usb: typeof (navigator as unknown as Record<string, unknown>).usb === 'object',
        bluetooth: typeof (navigator as unknown as Record<string, unknown>).bluetooth === 'object',
        hid: typeof (navigator as unknown as Record<string, unknown>).hid === 'object',
        midi: typeof (navigator as unknown as Record<string, unknown>).requestMIDIAccess === 'function',
      });

      await page.goto(`${ORIGIN}/`);
      const secure = await page.evaluate(probe);
      expect(secure).toEqual(Object.fromEntries(SUPPORT.map((r) => [r.probe, r[name]])));

      await page.goto('http://device-hardware.test/');
      const insecure = await page.evaluate(probe);
      expect(Object.values(insecure), 'на http нет ни одного из пяти API').toEqual([false, false, false, false, false]);
    } finally {
      await browser.close();
    }
  });
}

// ─── Chromium: отказы, жест, фреймы ────────────────────────────────────────────────────────

test.describe('Chromium', () => {
  let browser: Browser;
  test.beforeAll(async () => {
    browser = await chromium.launch();
  });
  test.afterAll(async () => {
    await browser.close();
  });

  /** Одна строка `ERROR_ROWS` = один снятый факт; порядок тот же, что в таблице темы. */
  test('таблица «Что отвечает Chromium» снята, а не набрана', async () => {
    test.setTimeout(60_000);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const code = `
      const name = async (f) => { try { const v = await f(); return Array.isArray(v) && v.length === 0 ? 'пустой массив' : 'ok'; } catch (e) { return e.name; } };
      const out = {};
      out.serialLoad = await name(() => navigator.serial.requestPort());
      out.othersLoad = [
        await name(() => navigator.usb.requestDevice({ filters: [] })),
        await name(() => navigator.hid.requestDevice({ filters: [] })),
        await name(() => navigator.bluetooth.requestDevice({ acceptAllDevices: true })),
      ];
      out.getPorts = await name(() => navigator.serial.getPorts());
      out.midi = await name(() => navigator.requestMIDIAccess());
      const button = document.querySelector('#connect');
      button.onclick = async (e) => {
        if (!e.isTrusted) { out.synthetic = await name(() => navigator.serial.requestPort()); return; }
        out.clickSerial = await name(() => navigator.serial.requestPort());
        out.clickUsb = await name(() => navigator.usb.requestDevice({ filters: [] }));
        out.clickHid = await name(() => navigator.hid.requestDevice({ filters: [] }));
        await new Promise((r) => setTimeout(r, 5500));
        out.late = await name(() => navigator.serial.requestPort());
        console.log(JSON.stringify(out));
      };
      button.click();                       // из кода: обработчик вызван, жеста нет
    `;
    const frame = `<!doctype html><script type="module">
      try { await navigator.serial.getPorts(); console.log('frame: ok'); } catch (e) { console.log('frame: ' + e.name); }
    </script>`;
    const logged = await open(page, code, { [OTHER]: frame });
    await page.click('#connect');
    await expect.poll(() => logged.find((l) => l.startsWith('{')), { timeout: 20_000 }).toBeTruthy();
    const out = JSON.parse(logged.find((l) => l.startsWith('{'))!);

    // чужой iframe без allow — отдельная страница с фреймом
    const page2 = await ctx.newPage();
    const frameLog = await open(page2, '', {
      [ORIGIN]: `<!doctype html><iframe src="${OTHER}/"></iframe>`,
      [OTHER]: frame,
    });
    await expect.poll(() => frameLog.find((l) => l.startsWith('frame:'))).toBeTruthy();
    const framed = frameLog.find((l) => l.startsWith('frame:'))!.slice('frame: '.length);

    const sameName = new Set(out.othersLoad).size === 1 ? out.othersLoad[0] : `разные: ${out.othersLoad}`;
    const both = out.clickSerial === out.clickUsb ? out.clickSerial : `разные: ${out.clickSerial}, ${out.clickUsb}`;
    const code_ = (n: string) => '`' + n + '`';
    const got = [
      code_(out.serialLoad),
      code_(sameName),
      code_(out.synthetic),
      code_(out.late),
      code_(both),
      out.clickHid === 'пустой массив' ? 'пустой массив, без ошибки' : code_(out.clickHid),
      out.getPorts,
      code_(framed),
      code_(out.midi),
    ];
    expect(got).toEqual(ERROR_ROWS.map((r) => r.got));
    await ctx.close();
  });

  test('iframe с allow="serial" получает доступ, как главный фрейм', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const logged = await open(page, '', {
      [ORIGIN]: `<!doctype html><iframe src="${OTHER}/" allow="serial"></iframe>`,
      [OTHER]: `<!doctype html><script type="module">console.log('frame: ' + (await navigator.serial.getPorts()).length);</script>`,
    });
    await expect.poll(() => logged).toContain('frame: 0');
    await ctx.close();
  });

  test('page.evaluate в Playwright выполняется с жестом — поэтому код кладут в страницу', async () => {
    const page = await browser.newPage();
    await open(page, 'console.log("стенд")');
    expect(await page.evaluate(() => navigator.userActivation.isActive)).toBe(true);
    await page.close();
  });

  test('PERMISSION_CODE: при загрузке разрешённых портов нет', async () => {
    const page = await browser.newPage();
    const logged = await open(page, PERMISSION_CODE);
    await expect.poll(() => logged).toContain(PERMISSION_OUT.split('\n')[0]);
    await page.close();
  });

  test('USB_CODE и HID_CODE: окно выбора закрыто — NotFoundError и пустой массив', async () => {
    const ctx = await browser.newContext();
    const usb = await ctx.newPage();
    const usbLog = await open(usb, USB_CODE);
    await usb.click('#connect');
    await expect.poll(() => usbLog).toContain('ошибка: NotFoundError');

    const hid = await ctx.newPage();
    const hidLog = await open(hid, HID_CODE);
    await hid.click('#connect');
    await expect.poll(() => hidLog).toEqual([HID_OUT]);
    await ctx.close();
  });

  test('MIDI_CODE без клика, с разрешением: пустые порты и разбор сообщений', async () => {
    const ctx = await browser.newContext();
    // В Playwright доступ к MIDI выдаётся только парой: одного `midi` Chromium 153 мало.
    await ctx.grantPermissions(['midi', 'midi-sysex'], { origin: ORIGIN });
    const page = await ctx.newPage();
    const logged = await open(page, `window.activationBeforeMidi = navigator.userActivation.isActive;\n${MIDI_CODE}\nwindow.describe = describe;`);
    await expect.poll(() => logged).toEqual([MIDI_OUT]);
    expect(await page.evaluate(() => (window as unknown as { activationBeforeMidi: boolean }).activationBeforeMidi),
      'MIDI получает доступ в модуле без активации пользователя').toBe(false);
    const described = await page.evaluate(
      (samples) => samples.map((s) => (window as unknown as { describe: (b: number[]) => string }).describe(s)),
      MIDI_SAMPLES.map((s) => s.bytes),
    );
    expect(described).toEqual(MIDI_SAMPLES.map((s) => s.out));
    await ctx.close();
  });

  /** Эмуляция Bluetooth — на весь браузер (второй `enable` бросает), поэтому браузер свой. */
  test('BT_CODE на фальшивом устройстве: имя, заряд 87%, подписка', async () => {
    const own = await chromium.launch();
    try {
      const page = await own.newPage();
      const logged = await open(page, BT_CODE);
      await new AsyncFunction('browser', 'page', BT_EMULATION_CODE)(own, page);
      await page.click('#connect');
      await expect.poll(() => logged, { timeout: 10_000 }).toEqual(BT_OUT.split('\n'));
      await page.click('#connect');
      await expect(page.locator('#connect')).toHaveText('Подключить');
      expect(logged).toEqual(BT_OUT.split('\n'));
    } finally {
      await own.close();
    }
  });

  test('blocklist Bluetooth: HID в filters — SecurityError, неназванный сервис невидим', async () => {
    const own = await chromium.launch();
    const page = await own.newPage();
    const code = `
      const button = document.querySelector('#connect');
      const name = async (f) => { try { await f(); return 'ok'; } catch (e) { return e.name; } };
      button.onclick = async () => {
        const blocked = await name(() => navigator.bluetooth.requestDevice({ filters: [{ services: ['human_interface_device'] }] }));
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['battery_service'] }] });
        const server = await device.gatt.connect();
        const unnamed = await name(() => server.getPrimaryService('generic_access'));
        const listed = (await server.getPrimaryServices()).map((s) => s.uuid);
        console.log(JSON.stringify({ blocked, unnamed, listed }));
      };`;
    const logged = await open(page, code);
    await new AsyncFunction('browser', 'page', BT_EMULATION_CODE)(own, page);
    await page.click('#connect');
    await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(JSON.parse(logged[0])).toEqual({
      blocked: 'SecurityError',
      unnamed: 'SecurityError',
      listed: ['0000180f-0000-1000-8000-00805f9b34fb'],
    });
    await own.close();
  });
});

// ─── Firefox: тестовый порт Serial и MIDI без устройств ────────────────────────────────────

test.describe('Firefox', () => {
  /** Тестовый порт Firefox: Arduino Uno (0x2341:0x0043), возвращает записанное обратно. */
  const TEST_PORT = { 'dom.webserial.testing.enabled': true, 'dom.webserial.gated': false };

  test('SERIAL_CODE целиком на тестовом порту', async () => {
    const browser = await firefox.launch({ firefoxUserPrefs: TEST_PORT });
    try {
      const page = await browser.newPage();
      const logged = await open(page, SERIAL_CODE);
      await page.click('#connect');
      await expect.poll(() => logged, { timeout: 10_000 }).toEqual(SERIAL_OUT.split('\n'));
    } finally {
      await browser.close();
    }
  });

  test('PERMISSION_CODE: 0 → 1 → 0', async () => {
    const browser = await firefox.launch({ firefoxUserPrefs: TEST_PORT });
    try {
      const page = await browser.newPage();
      const logged = await open(page, PERMISSION_CODE);
      await expect.poll(() => logged).toHaveLength(1);
      await page.click('#connect');
      await expect.poll(() => logged, { timeout: 10_000 }).toEqual(PERMISSION_OUT.split('\n'));
    } finally {
      await browser.close();
    }
  });

  test('без жеста requestPort — SecurityError, как в Chromium', async () => {
    const browser = await firefox.launch();
    try {
      const page = await browser.newPage();
      const logged = await open(page, `try { await navigator.serial.requestPort(); } catch (e) { console.log(e.name); }`);
      await expect.poll(() => logged).toEqual(['SecurityError']);
    } finally {
      await browser.close();
    }
  });

  test('MIDI без устройств: отказ не сразу, а SecurityError через несколько секунд', async () => {
    test.setTimeout(60_000);
    const browser = await firefox.launch();
    try {
      const page = await browser.newPage();
      const logged = await open(
        page,
        `const t0 = performance.now();
         navigator.requestMIDIAccess().then(
           () => console.log('ok'),
           (e) => console.log(e.name + ' ' + (performance.now() - t0 > 3000 ? 'позже 3 с' : 'сразу')));`,
      );
      await expect.poll(() => logged, { timeout: 45_000 }).toEqual(['SecurityError позже 3 с']);
    } finally {
      await browser.close();
    }
  });
});
