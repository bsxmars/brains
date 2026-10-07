import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import http2 from 'node:http2';
import { createServer as createHttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Browser, type BrowserType, chromium, firefox, webkit } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCEPT_STEPS,
  CLIENT_CODE,
  CLOSE_CODES_NOTE,
  CLOSE_ROWS,
  CSWSH_ROWS,
  FRAME_CODE,
  FRAME_DEMO_NOTE,
  PITFALLS,
  SEND_ALL_CODE,
  SEND_ALL_NOTE,
  SERVER_CODE,
  STREAM_CODE,
  STREAM_NOTE,
  WT_NOTE,
} from '@/content/platform/realtime/data';
import { buildFrame, loadFrameCode, RFC_MASK } from '@/widgets/rt-frame/model/frame';
import { loadBackoff, simulateHerd } from '@/widgets/rt-herd/model/herd';

/**
 * «Долгие соединения»: учебный код темы исполняется здесь — именно он, а не копия.
 *
 * `FRAME_CODE`, `SERVER_CODE`, `CLIENT_CODE`, `SEND_ALL_CODE` и `STREAM_CODE` кладутся файлами
 * во временный каталог и импортируются как настоящие модули. На `SERVER_CODE` поднимается
 * сервер, к нему подключаются клиент Node (глобальный `WebSocket`) и Chromium через Playwright.
 * Всё, что тема утверждает о кодах закрытия, маске, `bufferedAmount`, `WebSocketStream`,
 * HTTP/2 и CSWSH, сверяется с тем, что сделали эти клиенты.
 *
 * Два сайта — через `--host-resolver-rules` (`a.test`, `sub.a.test`, `b.test` → 127.0.0.1):
 * два порта на `localhost` — это один сайт, и кросс-сайтовое поведение кук на них не видно.
 * TLS — самоподписанный сертификат из `tests/fixtures/realtime-tls` (до 2036 года).
 *
 * ⚠️ Таймеров-замеров здесь нет: ожидания — это «дать событиям дойти», а не измерение времени.
 * Единственное утверждение темы о времени — 60 секунд до `close` на немом соединении —
 * снято стендом и сюда сознательно не взято: минута ожидания в юнит-тесте неуместна.
 */

const PORT = 49610;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TLS = {
  key: readFileSync(new URL('../fixtures/realtime-tls/key.pem', import.meta.url)),
  cert: readFileSync(new URL('../fixtures/realtime-tls/cert.pem', import.meta.url)),
};

/* eslint-disable @typescript-eslint/no-explicit-any -- модули темы — чистый JS без типов */
interface Conn {
  socket: import('node:net').Socket;
  onMessage: ((text: string) => void) | null;
  onPong: ((payload: Uint8Array) => void) | null;
  onClose: ((code: number, reason: string) => void) | null;
  send(text: string): void;
  ping(data?: Uint8Array): void;
  close(code?: number, reason?: string): void;
}
interface ServerModule {
  acceptKey(key: string): string;
  attach(
    server: any,
    options: { origins: string[] | null; onOpen: (conn: Conn, req: import('node:http').IncomingMessage) => void },
  ): any;
}
let serverModule: ServerModule;
let clientModule: { nextDelay: any; connect: any };
let sendAllModule: { sendAll: (ws: any, chunks: Iterable<string>, limit?: number) => Promise<void> };
/* eslint-enable @typescript-eslint/no-explicit-any */

const frame = loadFrameCode(FRAME_CODE);

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'realtime-'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'frame.js'), FRAME_CODE);
  writeFileSync(join(dir, 'server.js'), SERVER_CODE);
  writeFileSync(join(dir, 'client.js'), CLIENT_CODE);
  writeFileSync(join(dir, 'sendall.js'), SEND_ALL_CODE);
  const load = (name: string) => import(/* @vite-ignore */ pathToFileURL(join(dir, name)).href);
  serverModule = await load('server.js');
  clientModule = await load('client.js');
  sendAllModule = await load('sendall.js');
});

/**
 * Сокеты после `101` отцеплены от HTTP-сервера: ни `close()`, ни `closeAllConnections()` их
 * не видят, и сервер ждал бы их вечно. Поэтому соединения считаются здесь и рвутся руками.
 */
const tracked = new WeakMap<object, Set<import('node:net').Socket>>();
const listen = (server: Server | http2.Http2SecureServer, port: number) =>
  new Promise<void>((resolve) => {
    const sockets = new Set<import('node:net').Socket>();
    tracked.set(server, sockets);
    server.on('connection', (s: import('node:net').Socket) => sockets.add(s));
    server.on('secureConnection', (s: import('node:net').Socket) => sockets.add(s));
    server.listen(port, '127.0.0.1', () => resolve());
  });
const shut = (server: Server | http2.Http2SecureServer) =>
  new Promise<void>((resolve) => {
    for (const s of tracked.get(server) ?? []) s.destroy();
    server.close(() => resolve());
  });

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
const utf8 = (s: string) => new TextEncoder().encode(s);

/* ─────────────────────────── кадр: RFC 6455, §5.7 ─────────────────────────── */

describe('FRAME_CODE — кадр по примерам RFC 6455', () => {
  it('«Hello» без маски — 81 05 48 65 6c 6c 6f', () => {
    expect(hex(frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('Hello') }))).toBe('81 05 48 65 6c 6c 6f');
  });

  it('«Hello» с маской 37 fa 21 3d — байты из RFC, и демо стартует с них же', () => {
    const bytes = frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('Hello'), mask: RFC_MASK });
    expect(hex(bytes)).toBe('81 85 37 fa 21 3d 7f 9f 4d 51 58');
    // Тема обещает читателю ровно эти байты.
    expect(FRAME_DEMO_NOTE).toContain('81 85 37 fa 21 3d 7f 9f 4d 51 58');

    const view = buildFrame(frame, { text: 'Hello', kind: 'text', fromClient: true, size: 'as-is', mask: RFC_MASK });
    expect(view.cells.map((c) => c.hex).join(' ')).toBe('81 85 37 fa 21 3d 7f 9f 4d 51 58');
  });

  it('ping «Hello» — 89 05, длины 256 и 65536 — через 126 и 127', () => {
    expect(hex(frame.encodeFrame({ opcode: frame.OP.ping, payload: utf8('Hello') })).slice(0, 5)).toBe('89 05');
    expect(hex(frame.encodeFrame({ opcode: frame.OP.binary, payload: new Uint8Array(256) }).slice(0, 4))).toBe(
      '82 7e 01 00',
    );
    expect(hex(frame.encodeFrame({ opcode: frame.OP.binary, payload: new Uint8Array(65536) }).slice(0, 10))).toBe(
      '82 7f 00 00 00 00 00 01 00 00',
    );
  });

  it('decodeFrame снимает маску, а неполный кадр — это null, а не мусор', () => {
    const bytes = frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('привет'), mask: RFC_MASK });
    const f = frame.decodeFrame(bytes)!;
    expect(new TextDecoder().decode(f.payload)).toBe('привет');
    expect(f.size).toBe(bytes.length);
    for (let cut = 0; cut < bytes.length; cut++) expect(frame.decodeFrame(bytes.slice(0, cut))).toBeNull();
  });

  it('close: код — два байта, пустое тело читается как 1005', () => {
    expect(frame.readClose(frame.closePayload(4401, 'уходи'))).toEqual({ code: 4401, reason: 'уходи' });
    expect(frame.readClose(new Uint8Array(0)).code).toBe(1005);
  });

  it('демо: 7, 16 и 64 бита длины и управляющий кадр длиннее 125 байт', () => {
    const base = { text: 'ё', fromClient: false, mask: RFC_MASK } as const;
    expect(buildFrame(frame, { ...base, kind: 'text', size: 'as-is' }).len7).toBe(2);
    const mid = buildFrame(frame, { ...base, kind: 'text', size: '200' });
    expect([mid.len7, mid.payload.length, mid.headerBytes]).toEqual([126, 200, 4]);
    const big = buildFrame(frame, { ...base, kind: 'text', size: '70000' });
    expect([big.len7, big.payload.length, big.headerBytes]).toEqual([127, 70000, 10]);
    expect(buildFrame(frame, { ...base, kind: 'ping', size: '200' }).tooLongControl).toBe(true);
    expect(buildFrame(frame, { ...base, kind: 'close', size: 'as-is' }).roundTrip).toContain('код 1000');
  });
});

/* ─────────────────────────── рукопожатие и клиент Node ─────────────────────────── */

describe('SERVER_CODE и клиент Node 26', () => {
  let server: Server;
  let behaviour: ((conn: Conn, req: import('node:http').IncomingMessage) => void) | null = null;

  beforeAll(async () => {
    server = serverModule.attach(createServer(), { origins: null, onOpen: (c, r) => behaviour?.(c, r) });
    await listen(server, PORT);
  });
  afterAll(() => shut(server));

  interface Run {
    serverSaw?: { code: number; reason: string };
    client?: { code: number; reason: string; wasClean: boolean };
    events: string[];
    msgs: string[];
    readyState?: number;
    origin?: string;
    threw?: string;
    pong?: string;
  }

  function run(onServer: ((c: Conn, out: Run) => void) | null, onClient?: (ws: WebSocket, out: Run) => void, wait = 400) {
    return new Promise<Run>((resolve) => {
      const out: Run = { events: [], msgs: [] };
      behaviour = (conn, req) => {
        out.origin = req.headers.origin;
        conn.onClose = (code, reason) => (out.serverSaw = { code, reason });
        onServer?.(conn, out);
      };
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
      ws.onopen = () => {
        out.events.push('open');
        onClient?.(ws, out);
      };
      ws.onmessage = (e) => out.msgs.push(String(e.data));
      ws.onerror = () => out.events.push('error');
      ws.onclose = (e) => {
        out.events.push('close');
        out.client = { code: e.code, reason: e.reason, wasClean: e.wasClean };
      };
      setTimeout(() => {
        out.readyState = ws.readyState;
        resolve(out);
      }, wait);
    });
  }

  it('Accept для ключа из RFC совпадает с примером — и с тем, что написано в теме', () => {
    const accept = serverModule.acceptKey('dGhlIHNhbXBsZSBub25jZQ==');
    expect(accept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    expect(ACCEPT_STEPS.join(' ')).toContain(accept);
  });

  it('эхо в UTF-8, и клиент Node не шлёт Origin', async () => {
    const r = await run(
      (c) => (c.onMessage = (t) => c.send(`эхо: ${t}`)),
      (ws) => ws.send('привет'),
    );
    expect(r.msgs).toEqual(['эхо: привет']);
    expect(r.origin).toBeUndefined();
  });

  it('сервер закрыл с 1000 — клиент видит 1000 и wasClean', async () => {
    const r = await run((c) => setTimeout(() => c.close(1000, 'bye'), 30));
    expect(r.client).toEqual({ code: 1000, reason: 'bye', wasClean: true });
  });

  it('сервер оборвал TCP без кадра — 1006 у обеих сторон; у Node перед ним error', async () => {
    const r = await run((c) => setTimeout(() => c.socket.destroy(), 30));
    expect(r.client).toMatchObject({ code: 1006, wasClean: false });
    expect(r.serverSaw?.code).toBe(1006);
    expect(r.events).toEqual(['open', 'error', 'close']);
  });

  it('ws.close() без кода — сервер разбирает 1005; close(4000) — 4000', async () => {
    expect((await run(null, (ws) => ws.close())).serverSaw?.code).toBe(1005);
    expect((await run(null, (ws) => ws.close(4000, 'x'))).serverSaw).toEqual({ code: 4000, reason: 'x' });
  });

  it('ws.close(1001) — InvalidAccessError, как и обещает тема', async () => {
    const r = await run(null, (ws, out) => {
      try {
        ws.close(1001);
      } catch (e) {
        out.threw = (e as Error).name;
      }
    });
    expect(r.threw).toBe('InvalidAccessError');
    expect(CLOSE_CODES_NOTE).toContain('`InvalidAccessError`');
  });

  it('маска от сервера и ping длиннее 125 байт — серверу 1002, клиенту 1006', async () => {
    const masked = await run((c) =>
      setTimeout(
        () => c.socket.write(frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('hi'), mask: RFC_MASK })),
        30,
      ),
    );
    expect(masked.serverSaw?.code).toBe(1002);
    expect(masked.client?.code).toBe(1006);

    const big = await run((c) =>
      setTimeout(() => c.socket.write(frame.encodeFrame({ opcode: frame.OP.ping, payload: new Uint8Array(200) })), 30),
    );
    expect(big.serverSaw?.code).toBe(1002);
    expect(big.client?.code).toBe(1006);
  });

  it('ping от сервера — pong с тем же телом, без участия кода клиента', async () => {
    const r = await run((c, out) => {
      c.onPong = (p) => (out.pong = new TextDecoder().decode(p));
      setTimeout(() => c.ping(utf8('hb-1')), 30);
    });
    expect(r.pong).toBe('hb-1');
    expect(r.events).toEqual(['open']);
  });

  it('немой сервер: никаких событий, readyState 1', async () => {
    const r = await run((c) => c.socket.pause(), undefined, 1500);
    expect(r.events).toEqual(['open']);
    expect(r.readyState).toBe(1);
  });

  it('неверный Accept — error и 1006, open не было', async () => {
    const bad = createServer();
    bad.on('upgrade', (_req, socket) =>
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Accept: AAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n\r\n',
      ),
    );
    await listen(bad, PORT + 1);
    const events = await new Promise<string[]>((resolve) => {
      const ev: string[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${PORT + 1}/`);
      ws.onopen = () => ev.push('open');
      ws.onerror = () => ev.push('error');
      ws.onclose = (e) => resolve([...ev, `close ${e.code}`]);
    });
    await shut(bad);
    expect(events).toEqual(['error', 'close 1006']);
  });

  it('bufferedAmount: 64 × 1 МиБ серверу, который не читает, — 64 МиБ в памяти, send не ждёт', async () => {
    const r = await run(
      (c) => c.socket.pause(),
      (ws, out) => {
        const chunk = 'x'.repeat(2 ** 20);
        for (let i = 0; i < 64; i++) {
          ws.send(chunk);
          if (i % 16 === 15) out.msgs.push(String(ws.bufferedAmount));
        }
      },
      300,
    );
    expect(r.msgs.map(Number)).toEqual([16, 32, 48, 64].map((m) => m * 2 ** 20));
  });

  it('SEND_ALL_CODE: при немом сервере в сокет уходит лишь несколько сообщений, остальные ждут', async () => {
    let conn: Conn | null = null;
    let got = 0;
    behaviour = (c) => {
      conn = c;
      c.onMessage = () => got++;
      c.socket.pause();
    };
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    await new Promise((r) => (ws.onopen = r));
    let pulled = 0;
    function* chunks() {
      for (let i = 0; i < 64; i++) {
        pulled++;
        yield 'x'.repeat(2 ** 20);
      }
    }
    const done = sendAllModule.sendAll(ws, chunks());
    await sleep(800);
    const pausedPulled = pulled;
    conn!.socket.resume();
    await done;
    for (let i = 0; i < 100 && got < 64; i++) await sleep(50);
    ws.close();

    // Взято из генератора = отправлено + одно, ждущее порога.
    expectFewSent(pausedPulled - 1);
    expect(got).toBe(64);
  }, 20_000);
});

/**
 * Сколько мегабайтных сообщений `sendAll` с порогом 4 МиБ отдаёт немому серверу. Четыре
 * пропускает порог, остальное зависит от того, сколько заберут буферы ОС, — поэтому здесь
 * закреплено отношение «порог плюс немного», а точное число (шесть, macOS) подписано в теме.
 */
function expectFewSent(sent: number) {
  expect(sent).toBeGreaterThanOrEqual(4);
  expect(sent).toBeLessThanOrEqual(8);
  expect(SEND_ALL_NOTE).toContain('**шесть**');
}

/* ─────────────────────────── переподключение ─────────────────────────── */

describe('CLIENT_CODE — задержка и переподключение', () => {
  it('nextDelay: потолок удваивается, упирается в cap, джиттер — от нуля до потолка', () => {
    const { nextDelay } = clientModule;
    const top = (a: number, o = {}) => nextDelay(a, { random: () => 0.999999, ...o });
    expect([0, 1, 2, 3, 6, 7, 20].map((a) => top(a))).toEqual([499, 999, 1999, 3999, 29999, 29999, 29999]);
    expect(nextDelay(5, { random: () => 0 })).toBe(0);
    expect(top(4, { cap: 8000 })).toBe(7999);
  });

  it('без джиттера клиенты возвращаются волнами по 0,5, 1,5, 3,5, 7,5 с — как в тонком месте', () => {
    const nd = loadBackoff(CLIENT_CODE);
    let t = 0;
    const waves = [0, 1, 2, 3].map((a) => (t += nd(a, { random: () => 1 })) / 1000);
    expect(waves).toEqual([0.5, 1.5, 3.5, 7.5]);
    expect(PITFALLS.find((p) => p.n === '04')!.d).toContain('0,5, 1,5, 3,5, 7,5');
  });

  describe('против SERVER_CODE', () => {
    let server: Server;
    const log: string[] = [];
    let mode = 'normal';
    let n = 0;

    beforeAll(async () => {
      server = serverModule.attach(createServer(), {
        origins: null,
        onOpen(conn) {
          const id = ++n;
          log.push(`open ${mode}`);
          conn.onMessage = (t) => t === 'ping' && mode !== 'silent' && conn.send('pong');
          conn.onClose = (code) => log.push(`close ${code}`);
          if (mode === 'destroy') setTimeout(() => conn.socket.destroy(), 20);
          if (mode === 'silent') conn.socket.pause();
          if (mode === '4401') setTimeout(() => conn.close(4401, 'go away'), 20);
          if (mode !== '4401') mode = 'normal';
          void id;
        },
      });
      await listen(server, PORT + 2);
    });
    afterAll(() => shut(server));

    const opts = { beat: 50, grace: 150, base: 20, cap: 100 };
    const opens = () => log.filter((l) => l.startsWith('open')).length;

    it('обрыв TCP — новый сокет', async () => {
      log.length = 0;
      mode = 'destroy';
      const c = clientModule.connect(`ws://127.0.0.1:${PORT + 2}/`, opts);
      await sleep(500);
      c.stop();
      await sleep(100);
      expect(log.slice(0, 3)).toEqual(['open destroy', 'close 1006', 'open normal']);
    });

    it('немой сервер — heartbeat не дождался pong, и клиент переподключился, не дожидаясь close', async () => {
      log.length = 0;
      mode = 'silent';
      const c = clientModule.connect(`ws://127.0.0.1:${PORT + 2}/`, opts);
      await sleep(900);
      c.stop();
      await sleep(100);
      // Немой сокет так и не закрылся (Node на нём close не выдаёт), а новый уже открыт.
      expect(log[0]).toBe('open silent');
      expect(log[1]).toBe('open normal');
    });

    it('код 4401 — больше ни одной попытки', async () => {
      log.length = 0;
      mode = '4401';
      const c = clientModule.connect(`ws://127.0.0.1:${PORT + 2}/`, opts);
      await sleep(600);
      c.stop();
      mode = 'normal';
      expect(opens()).toBe(1);
      expect(log).toContain('close 4401');
    });

    it('stop() — закрытие с 1000 и тишина', async () => {
      log.length = 0;
      const c = clientModule.connect(`ws://127.0.0.1:${PORT + 2}/`, opts);
      await sleep(200);
      c.stop();
      await sleep(400);
      expect(log).toEqual(['open normal', 'close 1000']);
    });
  });

  it('стадо на виртуальных часах: без джиттера — стена, с джиттером — ровно', () => {
    const nd = loadBackoff(CLIENT_CODE);
    const base = { clients: 1000, outage: 5000, capacity: 100, bucket: 500, horizon: 60_000, cap: 30_000, seed: 7 };
    const fixed = simulateHerd(nd, { ...base, strategy: 'fixed' });
    const exp = simulateHerd(nd, { ...base, strategy: 'exp' });
    const jitter = simulateHerd(nd, { ...base, strategy: 'jitter' });

    expect(fixed.peakAfterUp).toBe(1000);
    expect(fixed.connected).toBe(1000);
    // «За минуту подключается меньше трети» — тонкое место 04.
    expect(exp.connected).toBeLessThan(1000 / 3);
    expect(exp.peakAfterUp).toBe(1000);
    expect(jitter.connected).toBe(1000);
    expect(jitter.peakAfterUp).toBeLessThan(200);
    expect(jitter.rejectedAfterUp).toBeLessThan(fixed.rejectedAfterUp / 10);
    expect(PITFALLS.find((p) => p.n === '04')!.d).toContain('меньше трети');
  });
});

/* ─────────────────────────── Chromium ─────────────────────────── */

describe('Chromium 153 против SERVER_CODE', () => {
  let browser: Browser;
  let server: Server;
  const conns = new Map<string, { saw?: { code: number; reason: string }; masks: string[]; origin?: string; conn: Conn }>();
  const behaviours = new Map<string, (c: Conn) => void>();
  const ORIGIN = `http://127.0.0.1:${PORT + 3}`;

  beforeAll(async () => {
    server = serverModule.attach(
      createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>t</title>')),
      {
        origins: null,
        onOpen(conn, req) {
          const id = new URL(req.url ?? '/', ORIGIN).searchParams.get('id') ?? '';
          const rec = { masks: [] as string[], origin: req.headers.origin, conn } as {
            saw?: { code: number; reason: string };
            masks: string[];
            origin?: string;
            conn: Conn;
          };
          conns.set(id, rec);
          let seenBytes = new Uint8Array(0);
          conn.socket.prependListener('data', (chunk: Buffer) => {
            seenBytes = new Uint8Array(Buffer.concat([seenBytes, chunk]));
            for (let f = frame.decodeFrame(seenBytes); f; f = frame.decodeFrame(seenBytes)) {
              if (f.mask) rec.masks.push(hex(f.mask));
              seenBytes = seenBytes.slice(f.size);
            }
          });
          conn.onClose = (code, reason) => (rec.saw = { code, reason });
          behaviours.get(id)?.(conn);
        },
      },
    );
    await listen(server, PORT + 3);
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await shut(server);
  });

  async function page() {
    const p = await browser.newPage();
    await p.goto(`${ORIGIN}/`);
    return p;
  }

  /** Открыть сокет со страницы, выполнить сценарий, вернуть события страницы. */
  async function open(p: import('playwright').Page, id: string, script = '', wait = 300) {
    return p.evaluate(
      async ({ port, id, script, wait }) => {
        const res: { events: string[]; close?: { code: number; reason: string; wasClean: boolean }; threw?: string } = {
          events: [],
        };
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=${id}`);
        (window as unknown as Record<string, WebSocket>)[`ws_${id}`] = ws;
        ws.onerror = () => res.events.push('error');
        ws.onclose = (e) => {
          res.events.push('close');
          res.close = { code: e.code, reason: e.reason, wasClean: e.wasClean };
        };
        await new Promise((r) => {
          ws.onopen = () => {
            res.events.push('open');
            r(null);
          };
          setTimeout(r, 1000);
        });
        if (script) await new Function('ws', 'res', script)(ws, res);
        await new Promise((r) => setTimeout(r, wait));
        return res;
      },
      { port: PORT + 3, id, script, wait },
    );
  }

  /** Сценарии `CLOSE_ROWS`: ключ строки таблицы → что сняли и в какой колонке это обязано стоять. */
  const measured = new Map<string, { column: 'page' | 'server'; value: string }>();

  it('рукопожатие: Origin есть, каждый кадр замаскирован новым ключом', async () => {
    const p = await page();
    await open(p, 'masks', "for (let i = 0; i < 4; i++) ws.send('k' + i)");
    await sleep(100);
    const rec = conns.get('masks')!;
    expect(rec.origin).toBe(ORIGIN);
    expect(rec.masks.length).toBe(4);
    expect(new Set(rec.masks).size).toBe(4);
    await p.close();
  });

  it('коды закрытия — те, что в таблице темы', async () => {
    const p = await page();

    behaviours.set('srv1000', (c) => setTimeout(() => c.close(1000, 'bye'), 30));
    const a = await open(p, 'srv1000');
    expect(a.close).toEqual({ code: 1000, reason: 'bye', wasClean: true });
    measured.set('сервер: `close(1000, "bye")`', { column: 'page', value: '1000, «bye», `wasClean: true`' });

    behaviours.set('srv4001', (c) => setTimeout(() => c.close(4001, 'kicked'), 30));
    const b = await open(p, 'srv4001');
    expect(b.close).toEqual({ code: 4001, reason: 'kicked', wasClean: true });
    measured.set('сервер: `close(4001, "kicked")`', { column: 'page', value: '4001, «kicked», `wasClean: true`' });

    await open(p, 'cl', 'ws.close()');
    await sleep(100);
    expect(conns.get('cl')!.saw?.code).toBe(1005);
    measured.set('страница: `ws.close()`', { column: 'server', value: '1005' });

    await open(p, 'cl1000', "ws.close(1000, 'done')");
    await sleep(100);
    expect(conns.get('cl1000')!.saw).toEqual({ code: 1000, reason: 'done' });
    measured.set('страница: `ws.close(1000, "done")`', { column: 'server', value: '1000, «done»' });

    const c = await open(p, 'cl1001', 'try { ws.close(1001) } catch (e) { res.threw = e.name + ": " + e.message }');
    expect(c.threw).toMatch(/^InvalidAccessError: .*1000, or between 3000 and 4999/);
    expect(CLOSE_CODES_NOTE).toContain('The close code must be either 1000, or between 3000 and 4999');
    measured.set('страница: `ws.close(1001)`', { column: 'page', value: '`InvalidAccessError`' });

    behaviours.set('destroy', (conn) => setTimeout(() => conn.socket.destroy(), 30));
    const d = await open(p, 'destroy');
    expect(d.close).toEqual({ code: 1006, reason: '', wasClean: false });
    expect(d.events).toEqual(['open', 'close']); // события error в Chromium нет
    measured.set('сервер оборвал TCP без кадра', { column: 'page', value: '**1006**, `wasClean: false`, без `error`' });

    behaviours.set('mask', (conn) =>
      setTimeout(
        () => conn.socket.write(frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('hi'), mask: RFC_MASK })),
        30,
      ),
    );
    const e = await open(p, 'mask');
    await sleep(100);
    expect(e.events).toEqual(['open', 'error', 'close']);
    expect(e.close?.code).toBe(1006);
    expect(conns.get('mask')!.saw).toEqual({ code: 1002, reason: 'Masked frame from server' });
    measured.set('нарушение протокола сервером', { column: 'server', value: '1002' });

    behaviours.set('bigping', (conn) =>
      setTimeout(() => conn.socket.write(frame.encodeFrame({ opcode: frame.OP.ping, payload: new Uint8Array(200) })), 30),
    );
    const f = await open(p, 'bigping');
    await sleep(100);
    expect(f.close?.code).toBe(1006);
    expect(conns.get('bigping')!.saw?.code).toBe(1002);

    behaviours.set('silent', (conn) => conn.socket.pause());
    const g = await open(p, 'silent', '', 1500);
    expect(g.events).toEqual(['open']);
    expect(await p.evaluate(() => (window as unknown as Record<string, WebSocket>).ws_silent.readyState)).toBe(1);
    measured.set('сервер замолчал, TCP жив', { column: 'page', value: '`readyState` 1' });

    let pong = '';
    behaviours.set('ping', (conn) => {
      conn.onPong = (payload) => (pong = new TextDecoder().decode(payload));
      setTimeout(() => conn.ping(utf8('hb-7')), 30);
    });
    const h = await open(p, 'ping');
    expect(pong).toBe('hb-7');
    expect(h.events).toEqual(['open']);
    await p.close();
  }, 30_000);

  it('уход со страницы, перезагрузка и закрытие вкладки — серверу 1001', async () => {
    const p = await page();
    await open(p, 'nav', '', 50);
    await p.goto(`${ORIGIN}/elsewhere`);
    await open(p, 'reload', '', 50);
    await p.reload();
    await open(p, 'tab', '', 50);
    await p.close();
    await sleep(300);
    expect([conns.get('nav')!.saw?.code, conns.get('reload')!.saw?.code, conns.get('tab')!.saw?.code]).toEqual([
      1001, 1001, 1001,
    ]);
    measured.set('уход со страницы, перезагрузка, закрытие вкладки', { column: 'server', value: '**1001**' });
  });

  it('убитый процесс браузера и упавший рендерер — серверу всё равно 1001', async () => {
    const bs = await chromium.launchServer();
    const b2 = await chromium.connect(bs.wsEndpoint());
    const p2 = await b2.newPage();
    await p2.goto(`${ORIGIN}/kill`);
    await open(p2, 'kill', '', 50);
    bs.process().kill('SIGKILL');
    await sleep(700);

    const p3 = await page();
    await open(p3, 'crash', '', 50);
    const cdp = await p3.context().newCDPSession(p3);
    cdp.send('Page.crash').catch(() => {});
    await sleep(700);

    expect(conns.get('kill')!.saw?.code).toBe(1001);
    expect(conns.get('crash')!.saw?.code).toBe(1001);
    measured.set('процесс браузера убит, рендерер упал', { column: 'server', value: '**1001**' });
  }, 30_000);

  it('таблица CLOSE_ROWS совпадает с прогоном — строка за строкой', () => {
    for (const [key, { column, value }] of measured) {
      const row = CLOSE_ROWS.find((r) => r.k === key);
      expect(row, `в CLOSE_ROWS нет строки «${key}»`).toBeDefined();
      expect(row![column], `строка «${key}», колонка ${column}`).toContain(value);
    }
    // Проверено всё, что таблица утверждает: ни одной строки без замера.
    expect(CLOSE_ROWS.map((r) => r.k).filter((k) => !measured.has(k))).toEqual([]);
  });

  it('bufferedAmount растёт до 64 МиБ, после чтения сервером — 0', async () => {
    const p = await page();
    behaviours.set('buf', (c) => c.socket.pause());
    await open(
      p,
      'buf',
      `const chunk = 'x'.repeat(2 ** 20); res.buffered = [];
       for (let i = 0; i < 64; i++) { ws.send(chunk); if (i % 16 === 15) res.buffered.push(ws.bufferedAmount); }
       window.__buffered = res.buffered;`,
      50,
    );
    expect(await p.evaluate(() => (window as unknown as { __buffered: number[] }).__buffered)).toEqual(
      [16, 32, 48, 64].map((m) => m * 2 ** 20),
    );
    conns.get('buf')!.conn.socket.resume();
    let left = -1;
    for (let i = 0; i < 100 && left !== 0; i++) {
      await sleep(50);
      left = await p.evaluate(() => (window as unknown as Record<string, WebSocket>).ws_buf.bufferedAmount);
    }
    expect(left).toBe(0);
    await p.close();
  }, 20_000);

  it('SEND_ALL_CODE и STREAM_CODE в Chromium: обратное давление руками и встроенное', async () => {
    const p = await page();
    behaviours.set('sa', (c) => c.socket.pause());
    behaviours.set('st', (c) => c.socket.pause());
    const strip = (code: string) => code.replace(/^export /gm, '');
    await p.evaluate(
      ({ port, sendAll, stream }) => {
        const w = window as unknown as Record<string, unknown>;
        const fns = new Function(`${sendAll}\n${stream}\nreturn { sendAll, sendAllStream };`)();
        const gen = (key: string) =>
          (function* () {
            for (let i = 0; i < 64; i++) {
              w[key] = i + 1;
              yield 'x'.repeat(2 ** 20);
            }
          })();
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?id=sa`);
        ws.onopen = () => fns.sendAll(ws, gen('pulledSa'));
        fns.sendAllStream(`ws://127.0.0.1:${port}/?id=st`, gen('pulledSt')).then((writer: WritableStreamDefaultWriter) => {
          w.writer = writer;
        });
        w.streamWriterProbe = () => null;
      },
      { port: PORT + 3, sendAll: strip(SEND_ALL_CODE), stream: strip(STREAM_CODE) },
    );
    await sleep(1000);
    const paused = await p.evaluate(() => {
      const w = window as unknown as Record<string, number>;
      return { sa: w.pulledSa, st: w.pulledSt };
    });
    expectFewSent(paused.sa - 1);
    // writer.ready держит генератор: одна запись ушла в сеть, вторая в очереди
    // (порог — одна запись), третья взята из генератора и ждёт ready.
    expect(paused.st).toBeLessThanOrEqual(3);
    expect(STREAM_NOTE).toContain('разрешилась **одна**');

    let got = 0;
    for (const id of ['sa', 'st']) {
      conns.get(id)!.conn.onMessage = () => got++;
      conns.get(id)!.conn.socket.resume();
    }
    for (let i = 0; i < 200 && got < 128; i++) await sleep(50);
    expect(got).toBe(128);
    expect(await p.evaluate(() => (window as unknown as Record<string, number>).pulledSt)).toBe(64);
    await p.close();
  }, 30_000);

  it('WebSocketStream: из 64 записей при немом сервере разрешилась одна, desiredSize −62', async () => {
    const p = await page();
    behaviours.set('wss', (c) => c.socket.pause());
    const r = await p.evaluate(async (port) => {
      // В lib.dom этого конструктора нет: он есть только в Chromium.
      const WSS = (window as unknown as Record<string, new (url: string) => { opened: Promise<{ writable: WritableStream }> }>)
        .WebSocketStream;
      const { writable } = await new WSS(`ws://127.0.0.1:${port}/?id=wss`).opened;
      const writer = writable.getWriter();
      let resolved = 0;
      for (let i = 0; i < 64; i++) writer.write('x'.repeat(2 ** 20)).then(() => resolved++);
      await new Promise((ok) => setTimeout(ok, 1000));
      return { resolved, desiredSize: writer.desiredSize };
    }, PORT + 3);
    expect(r).toEqual({ resolved: 1, desiredSize: -62 });
    expect(STREAM_NOTE).toContain('−62');
    await p.close();
  }, 20_000);
});

/* ─────────────────────────── API в трёх движках ─────────────────────────── */

describe('WebSocketStream и WebTransport в трёх движках', () => {
  let server: Server;
  const ORIGIN = `http://127.0.0.1:${PORT + 4}`;
  let destroyNext = false;

  beforeAll(async () => {
    server = serverModule.attach(
      createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>t</title>')),
      {
        origins: null,
        onOpen(conn) {
          if (destroyNext) setTimeout(() => conn.socket.destroy(), 30);
        },
      },
    );
    await listen(server, PORT + 4);
  });
  afterAll(() => shut(server));

  /**
   * ⚠️ Firefox отклоняет `ready` без сервера не сразу, а после ожидания рукопожатия QUIC
   * (на стенде прогон занял около тридцати секунд). Ради одной строки тест такое ожидание
   * не держит: в Firefox проверяется только наличие имени.
   */
  const engines: [string, BrowserType, { stream: string; wtError: string | null; destroyEvents: string[] }][] = [
    ['chromium', chromium, { stream: 'function', wtError: 'WebTransportError session', destroyEvents: ['open', 'close 1006'] }],
    ['firefox', firefox, { stream: 'undefined', wtError: null, destroyEvents: ['open', 'close 1006'] }],
    ['webkit', webkit, { stream: 'undefined', wtError: 'WebTransportError session', destroyEvents: ['open', 'error', 'close 1006'] }],
  ];

  it.each(engines)('%s', async (_name, type, want) => {
    const b = await type.launch();
    const p = await b.newPage();
    await p.goto(`${ORIGIN}/`);
    const apis = await p.evaluate(async ({ port, probe }) => {
      let wtError: string | null = null;
      if (probe) {
        try {
          await new WebTransport(`https://127.0.0.1:${port}/`).ready;
        } catch (e) {
          wtError = `${(e as Error).name} ${(e as { source?: string }).source}`;
        }
      }
      return { stream: typeof (window as unknown as Record<string, unknown>).WebSocketStream, wt: typeof WebTransport, wtError };
    }, { port: PORT + 9, probe: want.wtError !== null });
    destroyNext = true;
    const events = await p.evaluate(
      (port) =>
        new Promise<string[]>((resolve) => {
          const ev: string[] = [];
          const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
          ws.onopen = () => ev.push('open');
          ws.onerror = () => ev.push('error');
          ws.onclose = (e) => resolve([...ev, `close ${e.code}`]);
        }),
      PORT + 4,
    );
    destroyNext = false;
    await b.close();

    expect(apis).toEqual({ stream: want.stream, wt: 'function', wtError: want.wtError });
    expect(events).toEqual(want.destroyEvents);
    expect(WT_NOTE).toContain('`source: "session"`');
  }, 60_000);

  it('WebTransport только в защищённом контексте (Chromium)', async () => {
    const b = await chromium.launch({ args: ['--host-resolver-rules=MAP a.test 127.0.0.1'] });
    const p = await b.newPage();
    await p.goto(`http://a.test:${PORT + 4}/`);
    const r = await p.evaluate(() => ({
      secure: isSecureContext,
      wt: typeof WebTransport,
      stream: typeof (window as unknown as Record<string, unknown>).WebSocketStream,
    }));
    await b.close();
    expect(r).toEqual({ secure: false, wt: 'undefined', stream: 'function' });
  }, 30_000);
});

/* ─────────────────────────── HTTP/2 и CSWSH (TLS, два сайта) ─────────────────────────── */

describe('TLS: RFC 8441 и CSWSH на двух настоящих сайтах', () => {
  let browser: Browser;
  const RULES = '--host-resolver-rules=MAP a.test 127.0.0.1, MAP b.test 127.0.0.1, MAP sub.a.test 127.0.0.1';

  beforeAll(async () => {
    browser = await chromium.launch({ args: [RULES] });
  }, 60_000);
  afterAll(() => browser?.close());

  it.each([true, false])('HTTP/2, enableConnectProtocol = %s', async (enable) => {
    const log: Record<string, unknown>[] = [];
    const server = http2.createSecureServer({ ...TLS, allowHTTP1: true, settings: { enableConnectProtocol: enable } });
    server.on('upgrade', (req: import('node:http').IncomingMessage, socket: import('node:net').Socket) => {
      log.push({ upgrade: req.httpVersion });
      socket.destroy();
    });
    server.on('stream', (stream, headers) => {
      if (headers[':method'] === 'CONNECT') {
        log.push({ method: 'CONNECT', protocol: headers[':protocol'], key: headers['sec-websocket-key'] ?? null });
        stream.respond({ ':status': 200 });
        stream.on('data', (chunk: Buffer) => {
          const f = frame.decodeFrame(new Uint8Array(chunk));
          if (f?.opcode === frame.OP.text) {
            log.push({ masked: f.masked });
            stream.write(frame.encodeFrame({ opcode: frame.OP.text, payload: utf8('h2') }));
          }
        });
        return;
      }
      stream.respond({ ':status': 200, 'content-type': 'text/html' });
      stream.end('<!doctype html><title>h2</title>');
    });
    await listen(server, PORT + 5);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.goto(`https://a.test:${PORT + 5}/`);
    const proto = await p.evaluate(
      () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).nextHopProtocol,
    );
    const msg = await p.evaluate(
      (port) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`wss://a.test:${port}/chat`);
          ws.onopen = () => ws.send('hi');
          ws.onmessage = (e) => resolve(String(e.data));
          ws.onclose = (e) => resolve(`close ${e.code}`);
        }),
      PORT + 5,
    );
    await ctx.close();
    await shut(server);

    expect(proto).toBe('h2');
    if (enable) {
      expect(msg).toBe('h2');
      expect(log).toEqual([{ method: 'CONNECT', protocol: 'websocket', key: null }, { masked: true }]);
    } else {
      expect(log).toEqual([{ upgrade: '1.1' }]);
    }
  }, 30_000);

  it('CSWSH: таблица темы совпадает с прогоном', async () => {
    const seen: Record<string, string> = {};
    const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      if (req.url === '/login') {
        res.writeHead(200, {
          'content-type': 'text/html',
          'set-cookie': [
            'sidNone=N; Secure; HttpOnly; SameSite=None; Path=/',
            'sidLax=L; Secure; HttpOnly; SameSite=Lax; Path=/',
            'sidDefault=D; Secure; HttpOnly; Path=/',
            'sidStrict=S; Secure; HttpOnly; SameSite=Strict; Path=/',
          ],
        });
        res.end('<!doctype html><title>login</title>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>page</title>');
    };
    const onOpen = (conn: Conn, req: import('node:http').IncomingMessage) => {
      const cookie = req.headers.cookie ?? '';
      seen[`${req.headers.origin}`] = cookie;
      conn.send(cookie ? `данные для ${cookie}` : 'аноним');
    };
    const open = serverModule.attach(createHttpsServer(TLS, handler), { origins: null, onOpen });
    const guarded = serverModule.attach(createHttpsServer(TLS, handler), {
      origins: [`https://a.test:${PORT + 6}`],
      onOpen,
    });
    await listen(open, PORT + 6);
    await listen(guarded, PORT + 7);

    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const p = await ctx.newPage();
    await p.goto(`https://a.test:${PORT + 6}/login`);

    const attempt = async (from: string, port: number) => {
      await p.goto(`${from}/page`);
      return p.evaluate(
        (port) =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket(`wss://a.test:${port}/ws`);
            const ev: string[] = [];
            ws.onerror = () => ev.push('error');
            ws.onmessage = (e) => {
              resolve(String(e.data));
              ws.close();
            };
            ws.onclose = (e) => resolve([...ev, e.code].join(' '));
          }),
        port,
      );
    };

    const results: Record<string, { open: string; guarded: string; cookies: string }> = {};
    for (const [label, from] of [
      ['a.test', `https://a.test:${PORT + 6}`],
      ['sub.a.test', `https://sub.a.test:${PORT + 6}`],
      ['b.test', `https://b.test:${PORT + 6}`],
    ] as const) {
      const o = await attempt(from, PORT + 6);
      const cookies = seen[from];
      const g = await attempt(from, PORT + 7);
      results[label] = { open: o, guarded: g, cookies };
    }

    // Смешанный контент: со страницы по https незашифрованный ws:// не открывается вовсе.
    const mixed = await p.evaluate((port) => {
      try {
        new WebSocket(`ws://a.test:${port}/`);
        return 'открыт';
      } catch (e) {
        return (e as Error).name;
      }
    }, PORT + 6);

    await ctx.close();
    await shut(open);
    await shut(guarded);

    const all = 'sidNone=N; sidLax=L; sidDefault=D; sidStrict=S';
    expect(results['a.test']).toEqual({ open: `данные для ${all}`, guarded: `данные для ${all}`, cookies: all });
    expect(results['sub.a.test']).toEqual({ open: `данные для ${all}`, guarded: 'error 1006', cookies: all });
    expect(results['b.test']).toEqual({ open: 'данные для sidNone=N', guarded: 'error 1006', cookies: 'sidNone=N' });
    expect(mixed).toBe('SecurityError');

    // Литерал темы говорит то же самое.
    const row = (host: string) => CSWSH_ROWS.find((r) => r.k.includes(`https://${host}\``))!;
    expect(row('sub.a.test').cookies).toContain('`Strict`');
    expect(row('sub.a.test').open).toContain('прочитала');
    expect(row('b.test').cookies).toBe('только `SameSite=None`');
    expect(row('b.test').guarded).toContain('1006');
  }, 60_000);
});
