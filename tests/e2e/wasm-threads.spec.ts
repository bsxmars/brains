import { expect, test, type Page } from '@playwright/test';
import {
  MODULE_BYTES,
  SHARED_BROWSER,
  SHARED_BYTES,
  SIMD_BYTES,
  JS_STRING_BYTES,
} from '../../src/content/lessons/wasm-threads/data';

/**
 * «WebAssembly: память, потоки и граница с JS» — утверждения темы, которые может проверить
 * только браузер: общая память без изоляции и с ней, ловушка `wait` в главном потоке, CSP.
 *
 * Страница здесь — не собранный сайт, а пустой документ, отданный перехватом запроса на
 * `http://localhost` (порт выдуманный, запрос до сети не доходит): так можно поставить или
 * не поставить заголовки `COOP`/`COEP` и `Content-Security-Policy`, не трогая сайт.
 * `localhost` выбран намеренно — изоляция требует безопасного контекста, и на `http://wasm.test`
 * те же заголовки `crossOriginIsolated` не включают.
 *
 * Сам сайт не изолирован (см. AGENTS.md), поэтому то, что читатель увидит в демо темы, —
 * левая колонка `SHARED_BROWSER`.
 *
 * ⚠️ Имя ошибки нормативно, текст — нет: сверяется `name`; единственный текст, который
 * проверяется, — `crossOriginIsolated` в сообщении `DataCloneError`, потому что тема цитирует
 * именно его как причину.
 */

const ORIGIN = 'http://localhost:5997';

const WORKER = `onmessage = (e) => {
  try {
    const inst = new WebAssembly.Instance(e.data.module, { env: { mem: e.data.memory } });
    inst.exports.bump(0, 1000);
    postMessage(new Int32Array(e.data.memory.buffer)[0]);
  } catch (x) { postMessage(x.name); }
};`;

async function open(page: Page, headers: Record<string, string>) {
  await page.route(`${ORIGIN}/**`, (route) => {
    const isWorker = route.request().url().endsWith('/w.js');
    route.fulfill({
      status: 200,
      headers: { 'content-type': isWorker ? 'text/javascript' : 'text/html', ...headers },
      body: isWorker ? WORKER : '<!doctype html><title>wasm</title>',
    });
  });
  await page.goto(`${ORIGIN}/`);
}

interface SharedReport {
  isolated: boolean;
  sab: string;
  tag: string;
  validate: boolean;
  bump: number;
  wait: string;
  worker: string | number;
  cloneMessage: string;
}

function probe(page: Page) {
  return page.evaluate(async (bytes): Promise<SharedReport> => {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    const module = new WebAssembly.Module(new Uint8Array(bytes));
    const inst = new WebAssembly.Instance(module, { env: { mem: memory } });
    const e = inst.exports as unknown as {
      bump: (a: number, n: number) => void;
      wait: (a: number, v: number, ns: bigint) => number;
    };
    e.bump(0, 10);
    let wait: string;
    try {
      wait = String(e.wait(64, 0, 0n));
    } catch (x) {
      wait = (x as Error).name;
    }
    let cloneMessage = '';
    try {
      structuredClone(memory);
    } catch (x) {
      cloneMessage = `${(x as Error).name}: ${(x as Error).message}`;
    }
    const worker = await new Promise<string | number>((resolve) => {
      try {
        const w = new Worker('/w.js');
        w.onmessage = (m) => resolve(m.data);
        w.postMessage({ module, memory });
      } catch (x) {
        resolve((x as Error).name);
      }
    });
    return {
      isolated: crossOriginIsolated,
      sab: typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer,
      tag: Object.prototype.toString.call(memory.buffer),
      validate: WebAssembly.validate(new Uint8Array(bytes)),
      bump: new Int32Array(memory.buffer)[0],
      wait,
      worker,
      cloneMessage,
    };
  }, SHARED_BYTES);
}

/** Строка таблицы темы по началу ключа — чтобы проверка сверялась с текстом, а не с копией. */
function row(prefix: string) {
  const found = SHARED_BROWSER.find((r) => r.k.startsWith(prefix));
  if (!found) throw new Error(`в SHARED_BROWSER нет строки «${prefix}…»`);
  return found;
}

test.describe('общая память WebAssembly в Chromium', () => {
  test('без изоляции: память создаётся и считает, но в воркер не уходит', async ({ page }) => {
    await open(page, {});
    const r = await probe(page);

    expect(r.isolated).toBe(false);
    expect(row('`crossOriginIsolated`').plain).toBe('`false`');
    expect(r.sab).toBe('undefined');
    expect(row('`typeof SharedArrayBuffer`').plain).toBe('`undefined`');
    expect(r.tag).toBe('[object SharedArrayBuffer]');
    expect(row('`new WebAssembly.Memory').plain).toContain('[object SharedArrayBuffer]');
    expect(r.validate).toBe(true);
    expect(r.bump).toBe(10);
    expect(r.worker).toBe('DataCloneError');
    expect(r.cloneMessage).toMatch(/^DataCloneError: .*crossOriginIsolated/);
    expect(row('`worker.postMessage').plain).toContain('DataCloneError');
    expect(r.wait).toBe('RuntimeError');
    expect(row('`memory.atomic.wait32`').plain).toContain('RuntimeError');
  });

  test('с COOP и COEP: память уходит в воркер, а wait в главном потоке — всё равно ловушка', async ({ page }) => {
    await open(page, {
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    const r = await probe(page);

    expect(r.isolated).toBe(true);
    expect(r.sab).toBe('function');
    expect(r.worker, '10 из главного потока + 1000 из воркера').toBe(1010);
    expect(row('`worker.postMessage').isolated).toContain('1010');
    expect(r.wait).toBe('RuntimeError');
    expect(row('`memory.atomic.wait32`').isolated).toContain('RuntimeError');
  });
});

test.describe('остальное, что тема утверждает про Chromium', () => {
  test('SIMD, JS String Builtins, растягиваемый буфер и рост с отсоединением', async ({ page }) => {
    await open(page, {});
    const r = await page.evaluate(
      async ({ simd, jsString, teaching }) => {
        const m = await WebAssembly.compile(new Uint8Array(jsString), { builtins: ['js-string'] } as never);
        const len = ((await WebAssembly.instantiate(m, {})).exports as { len: (s: string) => number }).len('привет');

        const { instance } = await WebAssembly.instantiate(new Uint8Array(teaching), { env: { report() {} } });
        const memory = instance.exports.memory as WebAssembly.Memory;
        const old = memory.buffer;
        memory.grow(1);

        const fresh = new WebAssembly.Memory({ initial: 1, maximum: 4 }) as WebAssembly.Memory & {
          toResizableBuffer: () => ArrayBuffer;
        };
        const buffer = fresh.toResizableBuffer();
        const view = new Uint8Array(buffer);
        fresh.grow(1);

        return {
          simd: WebAssembly.validate(new Uint8Array(simd)),
          len,
          oldLength: old.byteLength,
          resizableLength: view.length,
          resizableSame: fresh.buffer === buffer,
        };
      },
      { simd: SIMD_BYTES, jsString: JS_STRING_BYTES, teaching: MODULE_BYTES },
    );

    expect(r).toEqual({ simd: true, len: 6, oldLength: 0, resizableLength: 131072, resizableSame: true });
  });

  test("CSP без 'wasm-unsafe-eval': validate — true, компиляция — CompileError", async ({ page }) => {
    await open(page, { 'content-security-policy': "script-src 'self'" });
    const denied = await page.evaluate(async (bytes) => {
      const validate = WebAssembly.validate(new Uint8Array(bytes));
      try {
        await WebAssembly.compile(new Uint8Array(bytes));
        return { validate, compile: 'ok' };
      } catch (x) {
        return { validate, compile: (x as Error).name };
      }
    }, SIMD_BYTES);
    expect(denied).toEqual({ validate: true, compile: 'CompileError' });
  });

  test("CSP с 'wasm-unsafe-eval': компиляция проходит", async ({ page }) => {
    await open(page, { 'content-security-policy': "script-src 'self' 'wasm-unsafe-eval'" });
    const ok = await page.evaluate(async (bytes) => {
      await WebAssembly.compile(new Uint8Array(bytes));
      return 'ok';
    }, SIMD_BYTES);
    expect(ok).toBe('ok');
  });
});
