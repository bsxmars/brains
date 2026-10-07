import http2 from 'node:http2';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/http2-http3/data';
import { buildTimeline, hexToBytes, loadH2, loadQuic } from '@/widgets/h2-frame-lab/model/run';
import type { HeaderField, StandChunk, TimelineFrame } from '@/widgets/h2-frame-lab/model/types';

/**
 * Тема «HTTP/2 и HTTP/3».
 *
 * Учебный код темы (`FRAME_CODE`, `HPACK_*_CODE`, `QUIC_CODE`) — строки, напечатанные на странице
 * и исполняемые демо. Здесь они сверяются:
 *   — с тестовыми векторами RFC 7541 (приложение C) и RFC 9000 (приложение A.1);
 *   — с nghttp2 внутри `node:http2`: статическая таблица запись за записью; живой прогон стенда
 *     Node (сервер h2c, сырой прокси, клиент) — типы, потоки, флаги и длины кадров совпадают
 *     с `NODE_CHUNKS`, а разбор
 *     каждого блока заголовков — с тем, что декодировал nghttp2; байты Chromium из `CHROMIUM_CHUNKS`
 *     проигрываются в свежий сервер `node:http2`, и он видит те же заголовки, что и учебный разбор;
 *   — числа текста — с байтами стенда.
 * Порты 51690–51699 — из диапазона темы. Порт прокси попадает в `:authority`, а длина его кода
 * Хаффмана зависит от цифр: 51692 вместо 51602 даёт ту же длину блока (цифры 0 и 2 — по 5 бит).
 */

const api = loadH2(t.FRAME_CODE, t.HPACK_INT_CODE, t.HPACK_TABLE_CODE, t.HPACK_DECODE_CODE);
const quic = loadQuic(t.QUIC_CODE);
const pairs = (fields: HeaderField[]) => fields.filter((f) => f.kind !== 'size').map((f) => [f.name, f.value]);
const sideBytes = (chunks: StandChunk[], dir: 'c2s' | 's2c') => chunks.filter((c) => c.dir === dir).flatMap((c) => hexToBytes(c.hex));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RFC7541_C = [
  { id: 'C.2.1', hex: '400a637573746f6d2d6b65790d637573746f6d2d686561646572', size: 55, headers: [['custom-key','custom-header']] },
  { id: 'C.2.2', hex: '040c2f73616d706c652f70617468', size: 0, headers: [[':path','/sample/path']] },
  { id: 'C.2.3', hex: '100870617373776f726406736563726574', size: 0, headers: [['password','secret']] },
  { id: 'C.2.4', hex: '82', size: 0, headers: [[':method','GET']] },
  { id: 'C.3.1', hex: '828684410f7777772e6578616d706c652e636f6d', size: 57, headers: [[':method','GET'],[':scheme','http'],[':path','/'],[':authority','www.example.com']] },
  { id: 'C.3.2', hex: '828684be58086e6f2d6361636865', size: 110, headers: [[':method','GET'],[':scheme','http'],[':path','/'],[':authority','www.example.com'],['cache-control','no-cache']] },
  { id: 'C.3.3', hex: '828785bf400a637573746f6d2d6b65790c637573746f6d2d76616c7565', size: 164, headers: [[':method','GET'],[':scheme','https'],[':path','/index.html'],[':authority','www.example.com'],['custom-key','custom-value']] },
  { id: 'C.4.1', hex: '828684418cf1e3c2e5f23a6ba0ab90f4ff', size: 57, headers: [[':method','GET'],[':scheme','http'],[':path','/'],[':authority','www.example.com']] },
  { id: 'C.4.2', hex: '828684be5886a8eb10649cbf', size: 110, headers: [[':method','GET'],[':scheme','http'],[':path','/'],[':authority','www.example.com'],['cache-control','no-cache']] },
  { id: 'C.4.3', hex: '828785bf408825a849e95ba97d7f8925a849e95bb8e8b4bf', size: 164, headers: [[':method','GET'],[':scheme','https'],[':path','/index.html'],[':authority','www.example.com'],['custom-key','custom-value']] },
  { id: 'C.5.1', hex: '4803333032580770726976617465611d4d6f6e2c203231204f637420323031332032303a31333a323120474d546e1768747470733a2f2f7777772e6578616d706c652e636f6d', size: 222, headers: [[':status','302'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:21 GMT'],['location','https://www.example.com']] },
  { id: 'C.5.2', hex: '4803333037c1c0bf', size: 222, headers: [[':status','307'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:21 GMT'],['location','https://www.example.com']] },
  { id: 'C.5.3', hex: '88c1611d4d6f6e2c203231204f637420323031332032303a31333a323220474d54c05a04677a69707738666f6f3d4153444a4b48514b425a584f5157454f50495541585157454f49553b206d61782d6167653d333630303b2076657273696f6e3d31', size: 215, headers: [[':status','200'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:22 GMT'],['location','https://www.example.com'],['content-encoding','gzip'],['set-cookie','foo=ASDJKHQKBZXOQWEOPIUAXQWEOIU; max-age=3600; version=1']] },
  { id: 'C.6.1', hex: '488264025885aec3771a4b6196d07abe941054d444a8200595040b8166e082a62d1bff6e919d29ad171863c78f0b97c8e9ae82ae43d3', size: 222, headers: [[':status','302'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:21 GMT'],['location','https://www.example.com']] },
  { id: 'C.6.2', hex: '4883640effc1c0bf', size: 222, headers: [[':status','307'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:21 GMT'],['location','https://www.example.com']] },
  { id: 'C.6.3', hex: '88c16196d07abe941054d444a8200595040b8166e084a62d1bffc05a839bd9ab77ad94e7821dd7f2e6c7b335dfdfcd5b3960d5af27087f3672c1ab270fb5291f9587316065c003ed4ee5b1063d5007', size: 215, headers: [[':status','200'],['cache-control','private'],['date','Mon, 21 Oct 2013 20:13:22 GMT'],['location','https://www.example.com'],['content-encoding','gzip'],['set-cookie','foo=ASDJKHQKBZXOQWEOPIUAXQWEOIU; max-age=3600; version=1']] },
];

describe('целые HPACK — RFC 7541, C.1, и примеры темы', () => {
  it('encodeInt и decodeInt: 10, 1337 (префикс 5), 42 (префикс 8)', () => {
    expect(api.encodeInt(10, 5)).toEqual([0x0a]);
    expect(api.encodeInt(1337, 5)).toEqual([0x1f, 0x9a, 0x0a]);
    expect(api.encodeInt(42, 8)).toEqual([0x2a]);
    expect(api.decodeInt([0x1f, 0x9a, 0x0a], 0, 5)).toEqual([1337, 3]);
    // Префикс не мешает старшим битам первого байта: 0xff = «1» + 127 → номер ≥ 127.
    for (const n of [4, 5, 6, 7, 8]) {
      for (const v of [0, 1, 2 ** n - 2, 2 ** n - 1, 2 ** n, 300, 4096, 65535, 2 ** 31 - 1]) {
        expect(api.decodeInt(api.encodeInt(v, n), 0, n), `${v}/${n}`).toEqual([v, api.encodeInt(v, n).length]);
      }
    }
  });

  it('таблица INT_ROWS посчитана функцией', () => {
    for (const r of t.INT_ROWS) {
      const high = r.value === '4096' ? 0x20 : 0;
      const hex = api.encodeInt(Number(r.value), Number(r.prefix), high).map((b) => b.toString(16).padStart(2, '0')).join(' ');
      expect(r.bytes).toBe(`\`${hex}\``);
    }
  });

  it('4096 с префиксом 5 — первые байты ответа Node браузеру', () => {
    const s2c = sideBytes(t.CHROMIUM_CHUNKS, 's2c');
    const headers = api.splitFrames(s2c).find((f) => f.type === 'HEADERS')!;
    expect(headers.payload.slice(0, 3)).toEqual(api.encodeInt(4096, 5, 0x20));
  });
});

describe('блоки заголовков — RFC 7541, приложение C', () => {
  it('C.2–C.6: поля и размер динамической таблицы после каждого блока', () => {
    let table = api.createTable();
    for (const v of RFC7541_C) {
      if (v.id.startsWith('C.2') || v.id.endsWith('.1')) table = api.createTable(v.id >= 'C.5' ? 256 : 4096);
      const fields = api.decodeHeaderBlock(hexToBytes(v.hex), table);
      expect(pairs(fields), v.id).toEqual(v.headers);
      expect(table.size, v.id).toBe(v.size);
    }
  });

  it('C.2.3 — литерал «никогда не запоминать», C.4 — строки Хаффмана', () => {
    const t1 = api.createTable();
    expect(api.decodeHeaderBlock(hexToBytes(RFC7541_C[2].hex), t1)[0].kind).toBe('never');
    const huff = api.decodeHeaderBlock(hexToBytes(RFC7541_C.find((v) => v.id === 'C.4.1')!.hex), api.createTable());
    expect(huff[3]).toMatchObject({ kind: 'incremental', index: 1, value: 'www.example.com', valueHuffman: true });
  });

  it('findStatic: точное совпадение одним номером, иначе — только имя', () => {
    expect(api.findStatic(':method', 'GET')).toEqual({ index: 2, exact: true });
    expect(api.findStatic(':status', '418')).toEqual({ index: 8, exact: false });
    expect(api.findStatic('accept-encoding', 'gzip, deflate')).toEqual({ index: 16, exact: true });
    expect(api.findStatic('x-trace', 'abc')).toBeNull();
    expect(api.STATIC_TABLE).toHaveLength(62);
  });
});

/** Кадр HTTP/2 из байтов: для запросов, которые тест собирает руками. */
function frame(type: number, flags: number, stream: number, payload: number[]): Buffer {
  const n = payload.length;
  return Buffer.from([n >> 16, (n >> 8) & 255, n & 255, type, flags, (stream >>> 24) & 127, (stream >> 16) & 255, (stream >> 8) & 255, stream & 255, ...payload]);
}
const PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n');

describe('STATIC_TABLE против nghttp2', () => {
  it('записи 1–7 и 15–61: сервер node:http2 видит то же имя и значение', async () => {
    const got = new Map<number, http2.IncomingHttpHeaders>();
    const server = http2.createServer();
    server.on('stream', (s, h) => {
      got.set(s.id ?? 0, h);
      s.respond({ ':status': 204 });
      s.end();
    });
    await new Promise<void>((r) => server.listen(51690, '127.0.0.1', r));
    const sock = net.connect(51690, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.on('data', () => {});
    const auth = [0x41, 1, 0x61]; // :authority «a», литерал с номером имени 1
    const out = [PREFACE, frame(4, 0, 0, [])];
    const plan = new Map<number, { i: number; literal: string | null }>();
    let id = 1;
    for (let i = 1; i <= 61; i++) {
      if (i >= 8 && i <= 14) continue; // :status — ниже, со стороны клиента
      const [name] = api.STATIC_TABLE[i]!;
      let block: number[];
      let literal: string | null = null;
      if (i <= 7) {
        const m = name === ':method' ? [0x80 | i] : [0x82];
        const sc = name === ':scheme' ? [0x80 | i] : [0x86];
        const p = name === ':path' ? [0x80 | i] : [0x84];
        // У записи 1 значение пустое, а пустой :authority сервер отвергает: проверяем только имя.
        const a = name === ':authority' ? ((literal = 'b'), [0x41, 1, 0x62]) : auth;
        block = [...m, ...sc, ...p, ...a];
      } else if (i === 28 || i === 38) {
        // content-length и host с пустым значением недопустимы — только имя, со значением.
        literal = i === 28 ? '0' : 'a';
        block = [0x82, 0x86, 0x84, ...auth, ...api.encodeInt(i, 4, 0), 1, literal.charCodeAt(0)];
      } else block = [0x82, 0x86, 0x84, ...auth, ...api.encodeInt(i, 7, 0x80)];
      plan.set(id, { i, literal });
      out.push(frame(1, 0x05, id, block));
      id += 2;
    }
    sock.write(Buffer.concat(out));
    await wait(400);
    const rejected: number[] = [];
    for (const [sid, { i, literal }] of plan) {
      const h = got.get(sid);
      if (!h) {
        rejected.push(i);
        continue;
      }
      const [name, value] = api.STATIC_TABLE[i]!;
      // set-cookie Node всегда отдаёт массивом.
      expect([h[name]].flat()[0], `запись ${i}`).toBe(literal ?? value);
    }
    // transfer-encoding в HTTP/2 запрещён с любым значением: его nghttp2 отвергает — и это тоже факт темы.
    expect(rejected).toEqual([57]);
    sock.destroy();
    server.close();
  });

  it('записи 8–14 (:status): клиент node:http2 читает тот же статус', async () => {
    const statuses: string[] = [];
    const raw = net.createServer((sock) => {
      sock.once('data', () => {
        const frames = [frame(4, 0, 0, [])];
        for (let i = 8, id = 1; i <= 14; i++, id += 2) frames.push(frame(1, 0x05, id, [0x80 | i]));
        sock.write(Buffer.concat(frames));
      });
      sock.on('error', () => {});
    });
    await new Promise<void>((r) => raw.listen(51691, '127.0.0.1', r));
    const s = http2.connect('http://127.0.0.1:51691');
    s.on('error', () => {});
    await Promise.all(
      Array.from({ length: 7 }, () =>
        new Promise<void>((resolve) => {
          const req = s.request({ ':path': '/' });
          req.on('response', (h) => {
            statuses.push(String(h[':status']));
            resolve();
          });
          req.on('error', () => resolve());
        }),
      ),
    );
    expect(statuses).toEqual(api.STATIC_TABLE.slice(8, 15).map((e) => e![1]));
    s.destroy();
    raw.close();
  });
});

describe('стенд Node: живой прогон против NODE_CHUNKS', () => {
  const chunks: StandChunk[] = [];
  const serverSaw: http2.IncomingHttpHeaders[] = [];
  const clientSaw: http2.IncomingHttpHeaders[] = [];
  const pushSaw: http2.IncomingHttpHeaders[] = [];
  let server: http2.Http2Server;
  let proxy: net.Server;

  beforeAll(async () => {
    // Тот же сценарий, что stand-node.mjs (см. шапку data.ts).
    //
    // `date` — дата из записи стенда, а не текущая. Иначе тест мигал: если между ответами
    // сменялась секунда, новый `date` уже не брался из динамической таблицы одним байтом-индексом
    // (блок 2 байта), а шёл литералом (25 байт) — и форма кадров расходилась со стендом.
    // Та же дата, а не любая постоянная: длина строки после Хаффмана зависит от цифр в ней.
    const standDate = pairs(
      buildTimeline(api, t.NODE_CHUNKS).find((f) => f.dir === 's2c' && f.stream === 1 && f.type === 'HEADERS')!.fields!,
    ).find(([name]) => name === 'date')![1];
    const sessions: http2.ServerHttp2Session[] = [];
    server = http2.createServer();
    server.on('session', (s) => sessions.push(s));
    server.on('stream', (stream, headers) => {
      serverSaw.push(headers);
      const path = headers[':path'];
      if (path === '/slow') {
        stream.respond({ ':status': 200, date: standDate });
        stream.write('first');
        return;
      }
      if (path === '/push') {
        stream.pushStream({ ':path': '/style.css' }, (err, push) => {
          if (err) return;
          push.respond({ ':status': 200, 'content-type': 'text/css', date: standDate });
          push.end('body{}');
        });
        stream.respond({ ':status': 200, 'content-type': 'text/html', date: standDate });
        stream.end('<link rel=stylesheet href=/style.css>');
        return;
      }
      stream.respond({ ':status': 200, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'max-age=60', date: standDate });
      stream.end('hello');
    });
    await new Promise<void>((r) => server.listen(51693, '127.0.0.1', r));
    proxy = net.createServer((client) => {
      const up = net.connect(51693, '127.0.0.1');
      client.on('data', (d) => {
        chunks.push({ dir: 'c2s', hex: d.toString('hex') });
        up.write(d);
      });
      up.on('data', (d) => {
        chunks.push({ dir: 's2c', hex: d.toString('hex') });
        client.write(d);
      });
      client.on('close', () => up.destroy());
      up.on('close', () => client.destroy());
      client.on('error', () => {});
      up.on('error', () => {});
    });
    // Порт прокси попадает в :authority. 51692 и 51602 — пять цифр с теми же длинами кодов
    // Хаффмана (0 и 2 — по 5 бит), поэтому длина блока та же; сами байты :authority отличаются.
    await new Promise<void>((r) => proxy.listen(51692, '127.0.0.1', r));

    const session = http2.connect('http://127.0.0.1:51692');
    session.on('stream', (push, headers) => {
      pushSaw.push(headers);
      push.resume();
    });
    const hdr = { ':path': '/hello', 'user-agent': 'stand/1', accept: 'text/plain', 'x-trace': 'abc123' };
    const get = (h: http2.OutgoingHttpHeaders) =>
      new Promise<void>((resolve) => {
        const req = session.request(h);
        req.on('response', (r) => clientSaw.push(r));
        req.resume();
        req.on('end', () => resolve());
      });
    await get(hdr);
    await wait(50);
    await get(hdr);
    await wait(50);
    await get({ ...hdr, 'x-trace': 'zzz999' });
    await wait(50);
    await new Promise<void>((resolve) => {
      const req = session.request({ ':path': '/slow' });
      req.on('response', (r) => clientSaw.push(r));
      req.on('data', () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('close', () => resolve());
    });
    await wait(100);
    await get({ ':path': '/push' });
    await wait(100);
    await new Promise((r) => session.ping(Buffer.from('12345678'), r));
    await wait(50);
    for (const s of sessions) s.close();
    await wait(100);
    session.close();
  }, 20_000);

  afterAll(() => {
    proxy?.close();
    server?.close();
  });

  it('кадры клиента: те же типы, потоки, флаги и длины, что на стенде', () => {
    const shape = (b: number[]) => api.splitFrames(b).map((f) => [f.type, f.stream, f.flags, f.length]);
    expect(shape(sideBytes(chunks, 'c2s'))).toEqual(shape(sideBytes(t.NODE_CHUNKS, 'c2s')));
    expect(shape(sideBytes(chunks, 's2c'))).toEqual(shape(sideBytes(t.NODE_CHUNKS, 's2c')));
  });

  it('учебный разбор блоков совпадает с тем, что декодировал nghttp2', () => {
    const tl = buildTimeline(api, chunks);
    const reqs = tl.filter((f) => f.dir === 'c2s' && f.type === 'HEADERS');
    const resps = tl.filter((f) => f.dir === 's2c' && f.type === 'HEADERS');
    const promise = tl.find((f) => f.type === 'PUSH_PROMISE')!;
    expect(reqs).toHaveLength(serverSaw.length);
    reqs.forEach((f, i) => {
      for (const [name, value] of pairs(f.fields!)) expect(serverSaw[i][name!], name).toBe(value);
    });
    // Ответы: порядок HEADERS в ленте — потоки 1, 3, 5, 7, 9 и обещанный 2.
    const byStream = new Map(resps.map((f) => [f.stream, f]));
    [1, 3, 5, 7, 9].forEach((sid, i) => {
      for (const [name, value] of pairs(byStream.get(sid)!.fields!)) {
        expect(String(clientSaw[i][name!]), `${sid} ${name}`).toBe(value);
      }
    });
    for (const [name, value] of pairs(promise.fields!)) expect(pushSaw[0][name!], name).toBe(value);
  });

  it('то же для записи стенда: NODE_CHUNKS разбираются без сдвига таблицы', () => {
    const tl = buildTimeline(api, t.NODE_CHUNKS);
    const h = (dir: string, stream: number, type = 'HEADERS') => tl.find((f) => f.dir === dir && f.stream === stream && f.type === type)!;
    expect(pairs(h('c2s', 3).fields!)).toEqual([
      [':path', '/hello'],
      [':method', 'GET'],
      [':authority', '127.0.0.1:51602'],
      [':scheme', 'http'],
      ['user-agent', 'stand/1'],
      ['accept', 'text/plain'],
      ['x-trace', 'abc123'],
    ]);
    // Блок 50 → 13 байт; ответ 55 → 4 (HPACK_SIZE_ROWS).
    expect([h('c2s', 1).blockLength, h('c2s', 3).blockLength, h('s2c', 1).blockLength, h('s2c', 3).blockLength]).toEqual([50, 13, 55, 4]);
    expect(h('c2s', 3).fields!.map((f) => f.bytes[1] - f.bytes[0])).toEqual([7, 1, 1, 1, 1, 1, 1]);
    // accept: text/plain — 9 байт: номер имени, длина, 7 байт Хаффмана (HUFFMAN_NOTE).
    const accept = h('c2s', 1).fields!.find((f) => f.name === 'accept')!;
    expect([accept.valueHuffman, accept.bytes[1] - accept.bytes[0], 'text/plain'.length]).toEqual([true, 9, 10]);
    // Ответ на /push — date, а не cache-control (DESYNC_NOTE): блок PUSH_PROMISE учтён.
    expect(pairs(h('s2c', 9).fields!).map((p) => p[0])).toEqual([':status', 'content-type', 'date']);
    expect(pairs(h('s2c', 9, 'PUSH_PROMISE').fields!)).toContainEqual([':authority', '127.0.0.1:51602']);
  });

  it('номера потоков, RST_STREAM, PUSH_PROMISE, PING и GOAWAY — как в тексте', () => {
    const tl = buildTimeline(api, t.NODE_CHUNKS);
    expect(tl.filter((f) => f.dir === 'c2s' && f.type === 'HEADERS').map((f) => f.stream)).toEqual([1, 3, 5, 7, 9]);
    const rst = tl.find((f) => f.type === 'RST_STREAM')!;
    expect([rst.dir, rst.stream, api.readPayload(rst).error]).toEqual(['c2s', 7, 8]);
    const pp = tl.find((f) => f.type === 'PUSH_PROMISE')!;
    expect([pp.stream, pp.payload.slice(0, 4)]).toEqual([9, [0, 0, 0, 2]]);
    const pings = tl.filter((f) => f.type === 'PING');
    expect(pings.map((f) => [f.dir, f.flags, Buffer.from(f.payload).toString()])).toEqual([
      ['c2s', 0, '12345678'],
      ['s2c', 1, '12345678'],
    ]);
    const goaway = tl.find((f) => f.type === 'GOAWAY')!;
    expect(api.readPayload(goaway)).toEqual({ lastStream: 9, error: 0 });
    // Пустые SETTINGS с обеих сторон: Node шлёт только значения по умолчанию.
    expect(tl.filter((f) => f.type === 'SETTINGS').map((f) => [f.dir, f.length, f.flags])).toEqual([
      ['c2s', 0, 0],
      ['s2c', 0, 0],
      ['s2c', 0, 1],
      ['c2s', 0, 1],
    ]);
    expect(t.STREAM_IDS_NOTE).toContain('**1, 3, 5, 7, 9**');
  });
});

describe('запись Chromium', () => {
  const c2s = sideBytes(t.CHROMIUM_CHUNKS, 'c2s');
  const tl = buildTimeline(api, t.CHROMIUM_CHUNKS);
  const reqs = tl.filter((f) => f.dir === 'c2s' && f.type === 'HEADERS');

  it('приветствие, SETTINGS и окно соединения — ENGINE_ROWS', () => {
    expect(Buffer.from(c2s.slice(0, 24)).toString()).toBe(api.PREFACE);
    const [settings, wu] = api.splitFrames(c2s);
    expect(api.readPayload(settings).settings).toEqual([
      ['HEADER_TABLE_SIZE', 65536],
      ['ENABLE_PUSH', 0],
      ['INITIAL_WINDOW_SIZE', 6291456],
      ['MAX_HEADER_LIST_SIZE', 262144],
    ]);
    expect([wu.type, wu.stream, api.readPayload(wu).increment]).toEqual(['WINDOW_UPDATE', 0, 15663105]);
    expect(65535 + 15663105).toBe(15 * 2 ** 20);
    expect(65535 + 12517377).toBe(12 * 2 ** 20);
    expect(65535 + 10420225).toBe(10 * 2 ** 20);
    expect(6291456).toBe(6 * 2 ** 20);
  });

  it('первый HEADERS — 9 байт из FRAME_BYTES_ROWS', () => {
    const at = 24 + 9 + 24 + 9 + 4;
    const head = c2s.slice(at, at + 9).map((b) => b.toString(16).padStart(2, '0'));
    expect(t.FRAME_BYTES_ROWS.map((r) => r.bytes).join(' ')).toBe(head.join(' '));
    expect(api.readFrameHeader(c2s, at)).toEqual({ length: 453, type: 'HEADERS', flags: 0x25, stream: 1 });
  });

  it('размеры блоков и «как текст» — HPACK_SIZE_ROWS', () => {
    const text = (f: TimelineFrame) => {
      const m = Object.fromEntries(pairs(f.fields!));
      let s = `${m[':method']} ${m[':path']} HTTP/1.1\r\nHost: ${m[':authority']}\r\n`;
      for (const [n, v] of pairs(f.fields!)) if (!n!.startsWith(':')) s += `${n}: ${v}\r\n`;
      return (s + '\r\n').length;
    };
    const row = (stream: number) => {
      const f = reqs.find((r) => r.stream === stream)!;
      return [f.fields!.length, f.blockLength, text(f), f.fields!.filter((x) => x.kind === 'indexed').length];
    };
    expect(row(1)).toEqual([16, 448, 642, 3]);
    expect(row(3)).toEqual([15, 74, 505, 8]);
    expect(row(5)).toEqual([15, 24, 505, 14]);
    expect(row(7)).toEqual([15, 23, 503, 14]);
    for (const [stream, r] of [[1, 0], [3, 1], [5, 2], [7, 3]] as const) {
      const [fields, block, txt] = row(stream);
      const lit = t.HPACK_SIZE_ROWS[r];
      expect([lit.fields, lit.block.replace(/\*/g, ''), lit.text]).toEqual([String(fields), String(block), String(txt)]);
    }
    // Литералы потока 3 пишут имя номером; Хаффман — у 13 полей из 16 первого запроса.
    expect(reqs[1].fields!.filter((f) => f.kind !== 'indexed').every((f) => f.index! > 0)).toBe(true);
    expect(reqs[0].fields!.filter((f) => f.nameHuffman || f.valueHuffman)).toHaveLength(13);
  });

  it('user-agent: 99 байт, затем 0xc5; :authority — номер 74, потом 80; :path — без записи в таблицу', () => {
    const ua = (i: number) => reqs[i].fields!.find((f) => f.name === 'user-agent')!;
    expect(ua(0).bytes[1] - ua(0).bytes[0]).toBe(99);
    expect([ua(1).kind, ua(1).index, api.encodeInt(ua(1).index!, 7, 0x80)]).toEqual(['indexed', 69, [0xc5]]);
    const auth = (i: number) => reqs[i].fields!.find((f) => f.name === ':authority')!.index;
    expect([auth(1), auth(2)]).toEqual([74, 80]);
    // Кроме `/`: он есть в статической таблице целиком (запись 4).
    for (const f of reqs.slice(1)) {
      const path = f.fields!.find((x) => x.name === ':path')!;
      expect(path.kind, path.value).toBe(path.value === '/' ? 'indexed' : 'literal');
    }
  });

  it('двадцать ответов на /slow — в одном куске, блоки запросов по 23–24 байта', () => {
    const slow = reqs.filter((f) => String(pairs(f.fields!).find((p) => p[0] === ':path')![1]).startsWith('/slow'));
    expect(slow.map((f) => f.stream)).toEqual(Array.from({ length: 20 }, (_, i) => 7 + 2 * i));
    expect(new Set(slow.map((f) => f.blockLength))).toEqual(new Set([23, 24]));
    const answers = tl.filter((f) => f.dir === 's2c' && f.type === 'HEADERS' && f.stream >= 7 && f.stream <= 45);
    expect(answers).toHaveLength(20);
    expect(new Set(answers.map((f) => f.chunk)).size).toBe(1);
  });

  it('priority: страница u=0, i, fetch — u=1, i; флаг PRIORITY на всех', () => {
    const prio = (f: TimelineFrame) => pairs(f.fields!).find((p) => p[0] === 'priority')![1];
    expect(prio(reqs[0])).toBe('u=0, i');
    expect(prio(reqs[1])).toBe('u=1, i');
    expect(reqs.every((f) => (f.flags & 0x20) !== 0)).toBe(true);
  });

  it('байты Chromium, проигранные в свежий node:http2, дают те же заголовки', async () => {
    const got = new Map<number, http2.IncomingHttpHeaders>();
    const server = http2.createServer();
    server.on('stream', (s, h) => {
      got.set(s.id ?? 0, h);
      s.respond({ ':status': 204 });
      s.end();
    });
    await new Promise<void>((r) => server.listen(51694, '127.0.0.1', r));
    const sock = net.connect(51694, '127.0.0.1');
    await new Promise((r) => sock.on('connect', r));
    sock.on('data', () => {});
    sock.write(Buffer.from(c2s));
    await wait(400);
    expect(got.size).toBe(reqs.length);
    for (const f of reqs) {
      const h = got.get(f.stream)!;
      for (const [name, value] of pairs(f.fields!)) expect(h[name!], `${f.stream} ${name}`).toBe(value);
    }
    sock.destroy();
    server.close();
  });
});

describe('управление потоком — FLOW_ROWS', () => {
  async function trial(port: number, settings: http2.Settings, read: boolean) {
    const server = http2.createServer();
    server.on('stream', (stream) => {
      stream.respond({ ':status': 200 });
      stream.end(Buffer.alloc(1_000_000, 97));
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    const got: number[] = [];
    const sent: number[] = [];
    const proxy = net.createServer((c) => {
      const up = net.connect(port, '127.0.0.1');
      c.on('data', (d) => {
        sent.push(...d);
        up.write(d);
      });
      up.on('data', (d) => {
        got.push(...d);
        c.write(d);
      });
      c.on('error', () => {});
      up.on('error', () => {});
      c.on('close', () => up.destroy());
      up.on('close', () => c.destroy());
    });
    await new Promise<void>((r) => proxy.listen(port + 1, '127.0.0.1', r));
    const s = http2.connect(`http://127.0.0.1:${port + 1}`, { settings });
    const req = s.request({ ':path': '/' });
    if (read) req.resume();
    else req.pause();
    await wait(700);
    const data = api.splitFrames(got).filter((f) => f.type === 'DATA').reduce((a, f) => a + f.length, 0);
    const wuStreams = new Set(api.splitFrames(sent).filter((f) => f.type === 'WINDOW_UPDATE').map((f) => f.stream));
    s.destroy();
    proxy.close();
    server.close();
    return { data, wuStreams: [...wuStreams].sort() };
  }

  it('не читает: ровно 65 535; с INITIAL_WINDOW_SIZE 200 000 — ровно 200 000; читает — всё', async () => {
    expect(await trial(51695, {}, false)).toEqual({ data: 65535, wuStreams: [0] });
    expect(await trial(51697, { initialWindowSize: 200_000 }, false)).toEqual({ data: 200_000, wuStreams: [0] });
    expect(await trial(51695, {}, true)).toEqual({ data: 1_000_000, wuStreams: [0, 1] });
    expect(t.FLOW_ROWS.map((r) => r.data.replace(/\*/g, '').replace(/\s/g, ''))).toEqual(['65535', '200000', '1000000']);
  }, 20_000);
});

describe('QUIC_CODE', () => {
  it('readVarint — примеры RFC 9000, приложение A.1 (кроме 8-байтового: он больше 2^53)', () => {
    expect(quic.readVarint([0x9d, 0x7f, 0x3e, 0x7d], 0)).toEqual([494878333, 4]);
    expect(quic.readVarint([0x7b, 0xbd], 0)).toEqual([15293, 2]);
    expect(quic.readVarint([0x25], 0)).toEqual([37, 1]);
    expect(quic.readVarint([0x40, 0x25], 0)).toEqual([37, 2]);
  });

  it('первый пакет Chromium — QUIC_ROWS', () => {
    const b = hexToBytes(t.QUIC_INITIAL_HEX);
    const h = quic.readLongHeader(b);
    expect(h).toMatchObject({ long: true, type: 'Initial', version: 1, scid: '', tokenLength: 0, length: 1212, headerBytes: 18 });
    expect(h.dcid).toHaveLength(16);
    expect(b[0]).toBe(0xcd);
    expect(h.headerBytes + h.length).toBe(t.QUIC_INITIAL_SIZE);
    expect(t.QUIC_INITIAL_SIZE).toBeGreaterThanOrEqual(1200);
    expect(t.QUIC_ROWS.find((r) => r.k === 'длина остатка')!.v).toBe(String(h.length));
  });
});
