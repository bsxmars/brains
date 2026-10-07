import { mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FileStore } from '@tus/file-store';
import { Server as TusServer } from '@tus/server';
import { type Browser, chromium } from 'playwright';
import * as tus from 'tus-js-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/uploads/data';
import {
  loadMultipart,
  loadPresign,
  loadSafety,
  loadTusClient,
  loadTusServer,
  makeLossyFetch,
  printBytes,
} from '@/widgets/upload-lab/model/run';
import type { MiniFetch, MultipartEntry, TusLogRow } from '@/widgets/upload-lab/model/types';

/**
 * Тема «Загрузка файлов».
 *
 * Строки-функции темы (`MULTIPART_CODE`, `TUS_CLIENT_CODE`, `TUS_SERVER_CODE`, `PRESIGN_CODE`,
 * `SAFETY_CODE`) напечатаны на странице и исполняются демо. Здесь они сверяются с настоящими
 * реализациями: `fetch(FormData)` в Node и в Chromium, `Response.formData()`, `@tus/server`,
 * `tus-js-client`, пример подписи из документации AWS. Литералы стенда (`MP_BODY_PRINT`,
 * `TUS_LOG`, числа в тексте) пересобираются теми же запусками.
 *
 * Серверы слушают порт 0 — свободный, выданный системой: рядом идут чужие прогоны.
 */

const mp = loadMultipart(t.MULTIPART_CODE);
const tusUpload = loadTusClient(t.TUS_CLIENT_CODE);
const createTusServer = loadTusServer(t.TUS_SERVER_CODE);
const sign = loadPresign(t.PRESIGN_CODE);
const safety = loadSafety(t.SAFETY_CODE);

const enc = new TextEncoder();

function entriesFromSpec(): MultipartEntry[] {
  return t.MP_ENTRIES_SPEC.map((e): MultipartEntry => {
    if ('value' in e) return [e.name, e.value];
    const bytes = 'text' in e ? enc.encode(e.text) : new Uint8Array(e.bytes);
    return [e.name, { filename: e.filename, type: e.type, bytes }];
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

interface Captured {
  url: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

/** Сервер, который сохраняет тела запросов байт в байт и отдаёт пустую страницу на GET. */
function captureServer() {
  const got: Captured[] = [];
  const server = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'GET') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset=utf-8><body>stand</body>');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      got.push({ url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
      res.end('ok');
    });
  });
  return { server, got };
}

const boundaryOf = (c: Captured) => String(c.headers['content-type']).split('boundary=')[1];

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

// ─── multipart ─────────────────────────────────────────────────────────────────────────────

describe('multipart: сборщик темы против fetch(FormData) в Node и Chromium', () => {
  const { server, got } = captureServer();
  let base = '';
  const byUrl = (u: string) => {
    const c = got.find((g) => g.url === u);
    if (!c) throw new Error(`нет запроса ${u}`);
    return c;
  };

  // MP_FORM_CODE исполняется как есть; `fetch('/upload')` направляется на свой сервер.
  const runForm = `return (async () => { ${t.MP_FORM_CODE} })()`;
  const probe = `
    const a = new FormData();
    a.append('note', 'a\\nb\\rc\\r\\nd');
    a.append('na"m\\ne', 'x');
    a.append('f', new Blob(['z']));
    a.append('g', new File(['q'], 'line\\nbreak.txt', { type: 'text/plain' }));
    a.append('h', new File(['x'], '../../etc/passwd'));
    return a;`;

  beforeAll(async () => {
    const port = await listen(server);
    base = `http://localhost:${port}`;
    const nodeFetch = (u: string, init: RequestInit) => fetch(new URL(u.replace('/upload', '/node'), base), init);
    await new Function('fetch', runForm)(nodeFetch);
    await fetch(`${base}/node-probe`, { method: 'POST', body: new Function(probe)() });
    await fetch(`${base}/node-manual`, {
      method: 'POST',
      body: new Function(probe)(),
      headers: { 'content-type': 'multipart/form-data' },
    });

    const page = await browser.newPage();
    await page.goto(base + '/');
    await page.evaluate(
      async ([form, pr]) => {
        const f = (u: string, init: RequestInit) => fetch(u.replace('/upload', '/chromium'), init);
        await new Function('fetch', form)(f);
        await fetch('/chromium-probe', { method: 'POST', body: new Function(pr)() });
        await fetch('/chromium-manual', {
          method: 'POST',
          body: new Function(pr)(),
          headers: { 'content-type': 'multipart/form-data' },
        });
      },
      [runForm, probe],
    );
    await page.close();
  }, 60_000);
  afterAll(() => server.close());

  it('Node и Chromium шлют одно и то же тело, кроме границы; длины — как в тексте', () => {
    const node = byUrl('/node');
    const chr = byUrl('/chromium');
    expect(boundaryOf(node)).toMatch(/^----formdata-undici-0\d{11}$/);
    expect(boundaryOf(chr)).toMatch(/^----WebKitFormBoundary[A-Za-z0-9]{16}$/);
    expect(boundaryOf(node).length).toBe(t.MP_BOUNDARY_NODE.length);
    expect(boundaryOf(chr).length).toBe(t.MP_BOUNDARY_CHROMIUM.length);
    const strip = (c: Captured) => c.body.toString('latin1').replaceAll(boundaryOf(c), 'B');
    expect(strip(node)).toBe(strip(chr));
    expect(node.body.length).toBe(443);
    expect(chr.body.length).toBe(467);
    expect(node.headers['content-length']).toBe('443');
    expect(chr.headers['content-length']).toBe('467');
    expect(node.headers['transfer-encoding']).toBeUndefined();
    expect(t.MP_HEADER_CODE).toContain('Content-Length: 467');
    expect(t.MP_ROWS[1].node).toContain('443');
    expect(t.MP_ROWS[1].chromium).toContain('467');
    // «граница длиннее на 6 символов, а встречается она 4 раза»
    expect(t.MP_BOUNDARY_CHROMIUM.length - t.MP_BOUNDARY_NODE.length).toBe(6);
    expect(strip(chr).split('B').length - 1).toBe(4);
  });

  it('encodeMultipart даёт те же байты, что fetch, с той же границей', () => {
    for (const c of [byUrl('/node'), byUrl('/chromium')]) {
      const mine = Buffer.from(mp.encodeMultipart(entriesFromSpec(), boundaryOf(c)));
      expect(mine.equals(c.body), c.url).toBe(true);
    }
  });

  it('MP_BODY_PRINT — это printBytes тела Chromium', () => {
    const chr = byUrl('/chromium');
    expect(printBytes(chr.body).replaceAll(boundaryOf(chr), t.MP_BOUNDARY_CHROMIUM)).toBe(t.MP_BODY_PRINT);
    expect(printBytes(mp.encodeMultipart(entriesFromSpec(), t.MP_BOUNDARY_CHROMIUM))).toBe(t.MP_BODY_PRINT);
  });

  it('нормализация переводов строк и экранирование имён — как у Node и Chromium', () => {
    const entries: MultipartEntry[] = [
      ['note', 'a\nb\rc\r\nd'],
      ['na"m\ne', 'x'],
      ['f', { filename: 'blob', type: '', bytes: enc.encode('z') }],
      ['g', { filename: 'line\nbreak.txt', type: 'text/plain', bytes: enc.encode('q') }],
      ['h', { filename: '../../etc/passwd', type: '', bytes: enc.encode('x') }],
    ];
    for (const c of [byUrl('/node-probe'), byUrl('/chromium-probe')]) {
      const mine = Buffer.from(mp.encodeMultipart(entries, boundaryOf(c)));
      expect(mine.equals(c.body), c.url).toBe(true);
      const text = c.body.toString('utf8');
      expect(text).toContain('a\r\nb\r\nc\r\nd');
      expect(text).toContain('name="na%22m%0D%0Ae"');
      expect(text).toContain('filename="line%0Abreak.txt"');
      expect(text).toContain('filename="blob"');
      expect(text).toContain('filename="../../etc/passwd"');
    }
    expect(t.SAFETY_RULES[2]).toContain('../../etc/passwd');
  });

  it('Content-Type руками — граница пропадает (тонкое место 01)', () => {
    for (const u of ['/node-manual', '/chromium-manual']) {
      expect(byUrl(u).headers['content-type']).toBe('multipart/form-data');
    }
    expect(t.PITFALLS[0].d).toContain('boundary');
  });

  it('parseMultipart против Response.formData() в Node; Chromium не раскодирует %22', async () => {
    const node = byUrl('/node');
    const parsed = mp.parseMultipart(new Uint8Array(node.body), boundaryOf(node));
    const fd = await new Response(new Uint8Array(node.body), { headers: { 'content-type': String(node.headers['content-type']) } }).formData();
    const want = await Promise.all(
      [...fd].map(async ([name, v]) =>
        typeof v === 'string'
          ? { name, value: v }
          : { name, filename: v.name, type: v.type, bytes: new Uint8Array(await v.arrayBuffer()) },
      ),
    );
    expect(parsed).toEqual(want);
    expect(want[2]).toMatchObject({ filename: 'a"b.bin' });

    const page = await browser.newPage();
    const names = await page.evaluate(
      async ([bytes, ct]) => {
        const f = await new Response(new Uint8Array(bytes), { headers: { 'content-type': ct } }).formData();
        return [...f].map(([, v]) => (typeof v === 'string' ? v : v.name));
      },
      [[...node.body], String(node.headers['content-type'])] as const,
    );
    await page.close();
    expect(names).toEqual(['Отчёт за май', 'май.csv', 'a%22b.bin']);
    expect(t.MP_RULES[1]).toContain('в Chromium — `a%22b.bin`');
  });

  it('разбор переживает круг на пробах с переводами строк и бинарными байтами', () => {
    const entries: MultipartEntry[] = [
      ['t', 'строка\r\nвторая'],
      ['bin', { filename: 'x"y\nz', type: 'image/png', bytes: new Uint8Array([0, 13, 10, 45, 45, 255, 0x89]) }],
    ];
    const body = mp.encodeMultipart(entries, 'XyZ');
    expect(mp.parseMultipart(body, 'XyZ')).toEqual([
      { name: 't', value: 'строка\r\nвторая' },
      { name: 'bin', filename: 'x"y\nz', type: 'image/png', bytes: new Uint8Array([0, 13, 10, 45, 45, 255, 0x89]) },
    ]);
  });
});

// ─── прогресс ──────────────────────────────────────────────────────────────────────────────

describe('прогресс отправки в Chromium', () => {
  let received = 0;
  const slow = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html>p');
      return;
    }
    if (req.url === '/received') {
      res.end(String(received));
      return;
    }
    received = 0;
    req.on('data', (c: Buffer) => {
      received += c.length;
      req.pause();
      setTimeout(() => req.resume(), 15);
    });
    req.on('end', () => res.end(String(received)));
  });
  const xlog: string[] = [];
  const cross = createServer((req, res) => {
    xlog.push(`${req.method} ${req.url}`);
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'POST');
    res.setHeader('access-control-allow-headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    req.resume();
    req.on('end', () => res.end('ok'));
  });
  let slowPort = 0;
  let crossPort = 0;
  beforeAll(async () => {
    slowPort = await listen(slow);
    crossPort = await listen(cross);
  });
  afterAll(() => {
    slow.close();
    cross.close();
  });

  it('PROGRESS_CODE: событий больше одного, на 100% медленный сервер прочёл не всё', async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${slowPort}/`);
    const SIZE = 8 * 1024 * 1024;
    const r = await page.evaluate(
      async ([code, size]) => {
        const upload = new Function(`${code}\nreturn upload;`)();
        const loaded: number[] = [];
        let atFull = -1;
        const status = await upload('/sink', new Blob([new Uint8Array(size)]), (l: number, total: number) => {
          loaded.push(l);
          if (l === total && atFull < 0) {
            atFull = 0;
            fetch('/received').then(async (res) => (atFull = Number(await res.text())));
          }
        });
        await new Promise((res) => setTimeout(res, 100));
        return { status, count: loaded.length, first: loaded[0], last: loaded.at(-1), atFull };
      },
      [t.PROGRESS_CODE, SIZE] as const,
    );
    await page.close();
    expect(r.status).toBe(200);
    expect(r.count).toBeGreaterThan(1);
    expect(r.last).toBe(SIZE);
    expect(r.first).toBeGreaterThan(0);
    expect(r.atFull).toBeGreaterThan(0);
    expect(r.atFull).toBeLessThan(SIZE);
  }, 60_000);

  it('слушатель на xhr.upload добавляет preflight, fetch тем же запросом — нет', async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${slowPort}/`);
    await page.evaluate(async (port) => {
      for (const listen of [false, true]) {
        await new Promise<void>((resolve) => {
          const x = new XMLHttpRequest();
          if (listen) x.upload.onprogress = () => {};
          x.onloadend = () => resolve();
          x.open('POST', `http://localhost:${port}/${listen ? 'with' : 'without'}`);
          x.setRequestHeader('content-type', 'text/plain');
          x.send('hello');
        });
      }
      await fetch(`http://localhost:${port}/fetch`, { method: 'POST', body: 'hello', headers: { 'content-type': 'text/plain' } });
    }, crossPort);
    await page.close();
    expect(xlog).toEqual(['POST /without', 'OPTIONS /with', 'POST /with', 'POST /fetch']);
  }, 30_000);

  it('fetch с телом-стримом по HTTP/1.1 — TypeError', async () => {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${slowPort}/`);
    const r = await page.evaluate(async () => {
      const body = new ReadableStream({
        pull(c) {
          c.enqueue(new Uint8Array(10));
          c.close();
        },
      });
      try {
        await fetch('/sink', { method: 'POST', body, duplex: 'half' } as RequestInit);
        return 'ok';
      } catch (e) {
        return (e as Error).name + ': ' + (e as Error).message;
      }
    });
    await page.close();
    expect(r).toBe('TypeError: Failed to fetch');
    expect(t.FETCH_PROGRESS_NOTE).toContain('TypeError: Failed to fetch');
  }, 30_000);
});

// ─── tus ───────────────────────────────────────────────────────────────────────────────────

interface ProxyRow {
  method: string;
  offset: string;
  sent: number;
  status: number | null;
  resOffset: string;
}

/**
 * «Плохая сеть»: ведёт журнал и рвёт PATCH, пропустив `cutAt` байт тела суммарно (один раз).
 * Сначала байты доходят до сервера, потом рвутся обе стороны. По желанию отдаёт страницу
 * с `tus.min.js` — тогда браузер ходит с того же источника.
 */
function cutProxy(target: number, cutAt: number, opts: { page?: boolean; close?: boolean } = {}) {
  const log: ProxyRow[] = [];
  let seen = 0;
  let armed = true;
  const tusJs = opts.page
    ? readFileSync(join(process.cwd(), 'node_modules/tus-js-client/dist/tus.min.js'))
    : Buffer.alloc(0);
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><meta charset=utf-8><script src="/tus.js"></script>');
      return;
    }
    if (req.url === '/tus.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(tusJs);
      return;
    }
    const row: ProxyRow = {
      method: req.method ?? '',
      offset: String(req.headers['upload-offset'] ?? ''),
      sent: 0,
      status: null,
      resOffset: '',
    };
    log.push(row);
    let cut = false;
    const up = httpRequest(
      { host: '127.0.0.1', port: target, method: req.method, path: req.url, headers: req.headers },
      (ur) => {
        row.status = ur.statusCode ?? null;
        row.resOffset = String(ur.headers['upload-offset'] ?? '');
        res.writeHead(ur.statusCode ?? 500, opts.close ? { ...ur.headers, connection: 'close' } : ur.headers);
        ur.pipe(res);
      },
    );
    up.on('error', () => {});
    req.on('data', (chunk: Buffer) => {
      if (cut) return;
      if (req.method === 'PATCH' && armed && seen + chunk.length > cutAt) {
        const part = chunk.subarray(0, cutAt - seen);
        seen += part.length;
        row.sent += part.length;
        cut = true;
        armed = false;
        up.write(part, () =>
          setTimeout(() => {
            up.destroy();
            req.socket.destroy();
          }, 300),
        );
        return;
      }
      seen += chunk.length;
      row.sent += chunk.length;
      up.write(chunk);
    });
    req.on('end', () => {
      if (!cut) up.end();
    });
  });
  return { server, log };
}

/** Учебный tus-сервер на `node:http`: обрыв посреди тела отдаёт `handle` дошедшие байты. */
function miniTusHttp() {
  const mini = createTusServer();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (complete: boolean) => {
      if (done) return;
      done = true;
      const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
      const out = mini.handle({ method: req.method ?? '', path: req.url ?? '', headers, body: new Uint8Array(Buffer.concat(chunks)) });
      if (complete) {
        res.writeHead(out.status, out.headers);
        res.end();
      }
    };
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => finish(true));
    req.on('close', () => finish(false));
  });
  return { server, mini };
}

const SIZE = 300_000;
const CHUNK = 100_000;
const CUT = 150_000;
const fileBytes = () => {
  const b = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) b[i] = (i * 7) & 255;
  return b;
};

/** Журнал в виде, который сравнивается с `TUS_LOG`. */
const shape = (rows: (ProxyRow | TusLogRow)[]) =>
  rows.map((r) => [r.method, r.offset, r.sent, r.status, r.resOffset].join(' '));

const EXPECTED = [
  'POST  0 201 ',
  'PATCH 0 100000 204 100000',
  'PATCH 100000 50000  ',
  'HEAD  0 200 150000',
  'PATCH 150000 100000 204 250000',
  'PATCH 250000 50000 204 300000',
];

function tusJsNode(endpoint: string, data: Uint8Array) {
  return new Promise<void>((resolveUp, reject) => {
    const up = new tus.Upload(Buffer.from(data), {
      endpoint,
      chunkSize: CHUNK,
      retryDelays: [0, 100, 500],
      onError: reject,
      onSuccess: () => resolveUp(),
    });
    up.start();
  });
}

describe('tus: обрыв посреди PATCH и докачка', () => {
  let dir = '';
  let tusHttp: Server;
  let tusPort = 0;
  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'uploads-tus-')));
    const tusServer = new TusServer({ path: '/files', datastore: new FileStore({ directory: dir }), relativeLocation: true });
    tusHttp = createServer((req, res) => tusServer.handle(req, res));
    tusPort = await listen(tusHttp);
  });
  afterAll(() => tusHttp.close());

  const storedEquals = (id: string, data: Uint8Array) => Buffer.from(readFileSync(join(dir, id))).equals(Buffer.from(data));

  it('tus-js-client → @tus/server: последовательность TUS_LOG, файл цел', async () => {
    const { server, log } = cutProxy(tusPort, CUT);
    const port = await listen(server);
    const before = new Set(readdirSync(dir));
    const data = fileBytes();
    await tusJsNode(`http://localhost:${port}/files`, data);
    server.close();
    expect(shape(log)).toEqual(EXPECTED);
    const id = readdirSync(dir).find((f) => !before.has(f) && !f.endsWith('.json'));
    expect(storedEquals(id ?? '', data)).toBe(true);
    // Таблица в теме описывает ту же последовательность.
    expect(t.TUS_LOG.map((r) => r.req.split(',')[0].replace(/`/g, '').split(' ')[0])).toEqual(log.map((r) => r.method));
    expect(t.TUS_LOG[3].res).toContain('150000');
    expect(t.TUS_LOG[5].req).toContain('тело 50 000');
  }, 60_000);

  it('учебный клиент → @tus/server: та же последовательность', async () => {
    const { server, log } = cutProxy(tusPort, CUT);
    const port = await listen(server);
    const data = fileBytes();
    const url = await tusUpload(fetch as unknown as MiniFetch, `http://localhost:${port}/files`, data, CHUNK);
    server.close();
    expect(shape(log)).toEqual(EXPECTED);
    expect(storedEquals(url.split('/').pop() ?? '', data)).toBe(true);
  }, 60_000);

  it('tus-js-client → учебный сервер: та же последовательность, байты на месте', async () => {
    const { server: miniHttp, mini } = miniTusHttp();
    const miniPort = await listen(miniHttp);
    const { server, log } = cutProxy(miniPort, CUT);
    const port = await listen(server);
    const data = fileBytes();
    await tusJsNode(`http://localhost:${port}/files`, data);
    server.close();
    miniHttp.close();
    expect(shape(log)).toEqual(EXPECTED);
    const stored = [...mini.uploads.values()][0];
    expect(stored.offset).toBe(SIZE);
    expect(Buffer.from(stored.data).equals(Buffer.from(data))).toBe(true);
  }, 60_000);

  it('демо: учебные клиент и сервер через makeLossyFetch дают ту же последовательность', async () => {
    const mini = createTusServer();
    const log: TusLogRow[] = [];
    const data = fileBytes();
    await tusUpload(makeLossyFetch(mini, CUT, log), 'http://demo/files', data, CHUNK);
    expect(shape(log)).toEqual(EXPECTED);
    expect(Buffer.from([...mini.uploads.values()][0].data).equals(Buffer.from(data))).toBe(true);
  });

  it('неверное смещение — 409 у обоих серверов; Upload-Length больше maxSize — 413', async () => {
    const mini = createTusServer();
    const created = mini.handle({ method: 'POST', path: '/files', headers: { 'tus-resumable': '1.0.0', 'upload-length': '10' }, body: new Uint8Array() });
    const loc = created.headers.Location;
    const wrong = { 'tus-resumable': '1.0.0', 'upload-offset': '5', 'content-type': 'application/offset+octet-stream' };
    expect(mini.handle({ method: 'PATCH', path: loc, headers: wrong, body: new Uint8Array(5) }).status).toBe(409);

    const h = { 'Tus-Resumable': '1.0.0' };
    const c = await fetch(`http://localhost:${tusPort}/files`, { method: 'POST', headers: { ...h, 'Upload-Length': '10' } });
    const url = new URL(c.headers.get('location') ?? '', `http://localhost:${tusPort}/files`);
    const r = await fetch(url, {
      method: 'PATCH',
      headers: { ...h, 'Upload-Offset': '5', 'Content-Type': 'application/offset+octet-stream' },
      body: new Uint8Array(5),
    });
    expect(r.status).toBe(409);

    const limited = new TusServer({ path: '/files', datastore: new FileStore({ directory: dir }), maxSize: 1000 });
    const lh = createServer((req, res) => limited.handle(req, res));
    const lp = await listen(lh);
    const big = await fetch(`http://localhost:${lp}/files`, { method: 'POST', headers: { ...h, 'Upload-Length': '1001' } });
    lh.close();
    expect(big.status).toBe(413);
    expect(t.SAFETY_RULES[1]).toContain('`413` до первого байта');
  });

  it('Chromium сам повторяет PATCH на переиспользованном соединении → 409; после перезагрузки докачка из localStorage', async () => {
    const run = async (close: boolean) => {
      const { server, log } = cutProxy(tusPort, CUT, { page: true, close });
      const port = await listen(server);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${port}/`);
      const mk = `(() => { const b = new Uint8Array(${SIZE}); for (let i = 0; i < b.length; i++) b[i] = (i * 7) & 255;
        return new File([b], 'video.mp4', { type: 'video/mp4', lastModified: 1767225600000 }); })()`;
      const first = await page.evaluate(
        (code) =>
          new Promise<string>((done) => {
            const file = (0, eval)(code);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const T = (window as any).tus;
            const up = new T.Upload(file, {
              endpoint: '/files',
              chunkSize: 100000,
              retryDelays: null,
              onError: (e: Error) => done(String(e.message).split(',')[0]),
              onSuccess: () => done('ok'),
            });
            up.start();
          }),
        mk,
      );
      const keys = await page.evaluate(() => Object.keys(localStorage));
      await page.reload();
      const second = await page.evaluate(
        (code) =>
          new Promise<string>((done) => {
            const file = (0, eval)(code);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const T = (window as any).tus;
            const up = new T.Upload(file, {
              endpoint: '/files',
              chunkSize: 100000,
              retryDelays: null,
              onError: (e: Error) => done('error ' + e.message),
              onSuccess: () => done('ok'),
            });
            up.findPreviousUploads().then((prev: unknown[]) => {
              if (prev.length) up.resumeFromPreviousUpload(prev[0]);
              up.start();
            });
          }),
        mk,
      );
      const left = await page.evaluate(() => localStorage.length);
      await ctx.close();
      server.close();
      return { first, keys, second, left, log: shape(log) };
    };

    const reused = await run(false);
    expect(reused.first).toBe('tus: unexpected response while uploading chunk');
    expect(reused.log).toEqual([
      'POST  0 201 ',
      'PATCH 0 100000 204 100000',
      'PATCH 100000 50000  ',
      'PATCH 100000 100000 409 ',
      'HEAD  0 200 150000',
      'PATCH 150000 100000 204 250000',
      'PATCH 250000 50000 204 300000',
    ]);
    expect(reused.keys).toHaveLength(1);
    expect(reused.keys[0]).toMatch(/^tus::tus-br-video\.mp4-video\/mp4-300000-1767225600000-\/files::/);
    expect(reused.second).toBe('ok');
    expect(reused.left).toBe(1);

    // Контроль: соединение не переиспользуется — повтора нет, клиент видит сетевую ошибку.
    const fresh = await run(true);
    expect(fresh.first).toBe('tus: failed to upload chunk at offset 100000');
    expect(fresh.log.filter((l) => l.includes('409'))).toEqual([]);
    expect(fresh.second).toBe('ok');
  }, 90_000);
});

// ─── подпись ───────────────────────────────────────────────────────────────────────────────

describe('presigned URL: пример из документации AWS', () => {
  it('подпись, хеш канонического запроса и URL совпадают с опубликованными', async () => {
    const r = await sign.presign(t.AWS_EXAMPLE);
    expect(r.signature).toBe(t.AWS_SIGNATURE);
    expect(r.stringToSign.split('\n')[3]).toBe(t.AWS_CANONICAL_HASH);
    expect(r.url).toBe(
      'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404',
    );
    expect(r.canonicalRequest).toBe(
      [
        'GET',
        '/test.txt',
        'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
        'host:examplebucket.s3.amazonaws.com',
        '',
        'host',
        'UNSIGNED-PAYLOAD',
      ].join('\n'),
    );
  });

  it('проверка: круг, подмена пути, метода, срока, чужой секрет', async () => {
    const { url } = await sign.presign(t.AWS_EXAMPLE);
    const secret = () => t.AWS_EXAMPLE.secret;
    const t0 = Date.UTC(2013, 4, 24, 1);
    expect(await sign.verifyPresigned('GET', url, secret, t0)).toEqual({ ok: true, reason: 'подпись верна' });
    expect((await sign.verifyPresigned('GET', url.replace('test.txt', 'other.txt'), secret, t0)).ok).toBe(false);
    expect((await sign.verifyPresigned('PUT', url, secret, t0)).ok).toBe(false);
    expect((await sign.verifyPresigned('GET', url.replace('Expires=86400', 'Expires=999999'), secret, t0)).ok).toBe(false);
    expect((await sign.verifyPresigned('GET', url, () => 'другой', t0)).ok).toBe(false);
    expect(await sign.verifyPresigned('GET', url, secret, Date.UTC(2013, 4, 25, 0, 0, 1))).toEqual({ ok: false, reason: 'срок истёк' });
    expect(await sign.verifyPresigned('GET', url, secret, Date.UTC(2013, 4, 25, 0, 0, 0))).toEqual({ ok: true, reason: 'подпись верна' });
  });
});

// ─── проверки на сервере ───────────────────────────────────────────────────────────────────

describe('проверки на сервере', () => {
  it('sniffType узнаёт файлы, которые закодировал Chromium, и не верит имени', async () => {
    const page = await browser.newPage();
    const made = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      c.getContext('2d')?.fillRect(0, 0, 2, 2);
      const out: Record<string, number[]> = {};
      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type));
        out[type] = [...new Uint8Array(await (blob as Blob).arrayBuffer()).subarray(0, 16)];
      }
      return out;
    });
    await page.close();
    for (const [type, bytes] of Object.entries(made)) {
      expect(safety.sniffType(new Uint8Array(bytes))).toBe(type);
    }
    expect(safety.sniffType(enc.encode('GIF89a\x01\x00'))).toBe('image/gif');
    expect(safety.sniffType(enc.encode('%PDF-1.7\n'))).toBe('application/pdf');
    expect(safety.sniffType(enc.encode('<html><script>'))).toBeNull();
    expect(safety.sniffType(new Uint8Array(0))).toBeNull();
  }, 30_000);

  it('displayName не даёт выйти из каталога', () => {
    const dir = resolve(tmpdir(), 'uploads-root');
    const names = t.BAD_NAMES.map(safety.displayName);
    expect(names).toEqual(['passwd', 'b.txt', 'file', 'ab.png', 'htaccess', 'file']);
    for (const n of names) expect(resolve(dir, n).startsWith(dir + sep)).toBe(true);
    // А без очистки — выходит.
    expect(resolve(dir, t.BAD_NAMES[0]).startsWith(dir + sep)).toBe(false);
  });
});
