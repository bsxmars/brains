import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pkt from 'dns-packet';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/dns/data';
import { loadAnswer, loadResolver, memorySend, replay, rollout, ROLLOUT } from '@/widgets/dns-lab/model/run';
import type { AuthServer, DnsRecord, DnsResponse, Resolver, SendFn } from '@/widgets/dns-lab/model/types';

/**
 * Тема «DNS: от имени до адреса».
 *
 * Стенд поднимается здесь же: четыре авторитетных сервера на `node:dgram` (порты 5070–5072,
 * 5074), каждый — строка `AUTH_CODE` над зонами `ZONES`, и рекурсивный резолвер на 5073 —
 * строка `RESOLVER_CODE` за сокетом, с виртуальным временем. В интернет тест не ходит.
 *
 * Сверяется: вывод `dig` (DiG 9.10.6 из системы) с литералами темы; журнал учебного
 * резолвера — с цепочкой `dig +norec`; ответы `AUTH_CODE` в памяти (их показывает демо) —
 * с разобранными пакетами по UDP; `PARSE_CODE` — с `dns-packet`; ответы `dns.Resolver`
 * в Node; порядок колбэков при занятом пуле; числа сценариев смены адреса.
 */

const run = promisify(execFile);
/** Части `dns-packet`, которых нет в @types/dns-packet. */
const raw = pkt as unknown as {
  name: { decode(b: Buffer, o: number): string; encodingLength(n: string): number };
  aaaa: { encode(s: string): Buffer };
};
const answer = loadAnswer(t.AUTH_CODE);
const createResolver = loadResolver(t.RESOLVER_CODE);

// ─── Кодировщик стенда: пакет со сжатием имён ─────────────────────────────────────────────

const TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, HTTPS: 65 };
const RCODES: Record<string, number> = { NOERROR: 0, NXDOMAIN: 3, REFUSED: 5, SERVFAIL: 2 };

interface Msg {
  id: number;
  flags: number;
  rcode?: string;
  questions: { name: string; type: string; typeCode?: number }[];
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

function encode(msg: Msg): Buffer {
  const out: number[] = [];
  const table = new Map<string, number>();
  const u16 = (n: number) => out.push((n >> 8) & 255, n & 255);
  const u32 = (n: number) => {
    u16(n >>> 16);
    u16(n & 0xffff);
  };
  const name = (n: string) => {
    const labels = n === '.' ? [] : n.split('.');
    for (let i = 0; i < labels.length; i++) {
      const suffix = labels.slice(i).join('.').toLowerCase();
      const ptr = table.get(suffix);
      if (ptr !== undefined) return u16(0xc000 | ptr);
      if (out.length < 0x4000) table.set(suffix, out.length);
      const b = Buffer.from(labels[i]);
      out.push(b.length, ...b);
    }
    out.push(0);
  };
  const rdata = (r: DnsRecord) => {
    const at = out.length;
    u16(0);
    const d = r.data as unknown as Record<string, number> & Record<'mname' | 'rname' | 'exchange', string>;
    if (r.type === 'A') out.push(...String(r.data).split('.').map(Number));
    else if (r.type === 'AAAA') out.push(...raw.aaaa.encode(String(r.data)).subarray(2));
    else if (r.type === 'NS' || r.type === 'CNAME') name(String(r.data));
    else if (r.type === 'MX') {
      u16(d.preference);
      name(d.exchange);
    } else if (r.type === 'SOA') {
      name(d.mname);
      name(d.rname);
      for (const k of ['serial', 'refresh', 'retry', 'expire', 'minimum']) u32(d[k]);
    } else if (r.type === 'TXT') for (const s of r.data as string[]) out.push(Buffer.byteLength(s), ...Buffer.from(s));
    else out.push(...Buffer.from(String(r.data), 'hex'));
    const len = out.length - at - 2;
    out[at] = len >> 8;
    out[at + 1] = len & 255;
  };
  u16(msg.id);
  u16(msg.flags | (RCODES[msg.rcode ?? 'NOERROR'] ?? 0));
  for (const n of [msg.questions.length, msg.answers.length, msg.authorities.length, msg.additionals.length]) u16(n);
  for (const q of msg.questions) {
    name(q.name);
    u16(q.typeCode ?? TYPES[q.type]);
    u16(1);
  }
  for (const r of [...msg.answers, ...msg.authorities, ...msg.additionals]) {
    name(r.name);
    u16(TYPES[r.type]);
    u16(1);
    u32(r.ttl);
    rdata(r);
  }
  return Buffer.from(out);
}

/** Запись из `dns-packet` → форма стенда. */
function norm(r: pkt.Answer): DnsRecord {
  const type = r.type === ('UNKNOWN_65' as never) ? 'HTTPS' : r.type;
  const data = (r as { data: unknown }).data;
  const base = { name: r.name, type, ttl: (r as { ttl: number }).ttl };
  if (type === 'TXT') return { ...base, data: (data as Buffer[]).map((b) => b.toString()) };
  if (type === 'SOA') return { ...base, data: { ...(data as object) } as DnsRecord['data'] };
  if (type === 'MX') {
    const mx = data as { preference: number; exchange: string };
    return { ...base, data: { preference: mx.preference, exchange: mx.exchange } };
  }
  if (Buffer.isBuffer(data)) return { ...base, data: data.toString('hex') };
  return { ...base, data: data as string };
}

function decodeResponse(buf: Buffer): DnsResponse {
  const m = pkt.decode(buf);
  return {
    aa: Boolean(m.flag_aa),
    rcode: String((m as { rcode?: string }).rcode),
    answers: (m.answers ?? []).map(norm),
    authorities: (m.authorities ?? []).map(norm),
    additionals: (m.additionals ?? []).filter((r) => r.type !== 'OPT').map(norm),
  };
}

/** Вопрос из пакета. Код типа — прямо из байтов: `dns-packet` знает не все типы. */
function readQuestion(buf: Buffer) {
  const q = pkt.decode(buf);
  const name = q.questions![0].name;
  const typeCode = buf.readUInt16BE(12 + raw.name.encodingLength(name));
  const type = Object.entries(TYPES).find(([, v]) => v === typeCode)?.[0] ?? `TYPE${typeCode}`;
  return { id: q.id ?? 0, rd: Boolean(q.flag_rd), name, type, typeCode };
}

interface Running {
  sock: dgram.Socket;
  count: number;
}
const packets: Buffer[] = [];

function startAuth(server: AuthServer): Promise<Running> {
  const sock = dgram.createSocket('udp4');
  const me: Running = { sock, count: 0 };
  sock.on('message', (buf, rinfo) => {
    const q = readQuestion(buf);
    me.count++;
    const own = t.ZONES.filter((z) => server.zones.includes(z.origin));
    const res = answer(own, q.name, q.type);
    const flags = 0x8000 | (res.aa ? 0x0400 : 0) | (q.rd ? 0x0100 : 0);
    const out = encode({ id: q.id, flags, questions: [q], ...res });
    packets.push(buf, out);
    sock.send(out, rinfo.port, rinfo.address);
  });
  return new Promise((ok) => sock.bind(server.port, '127.0.0.1', () => ok(me)));
}

/** Запрос без RD к «адресу» сервера: адрес из 192.0.2.0/24 → его порт на 127.0.0.1. */
function udpSend(): SendFn {
  let id = 1;
  return (ip, name, type) =>
    new Promise((ok, fail) => {
      const srv = t.SERVERS.find((s) => s.ip === ip);
      if (!srv) return fail(new Error(`нет сервера ${ip}`));
      const sock = dgram.createSocket('udp4');
      const timer = setTimeout(() => {
        sock.close();
        fail(new Error(`timeout ${ip}`));
      }, 3000);
      sock.on('message', (buf) => {
        clearTimeout(timer);
        sock.close();
        ok(decodeResponse(buf));
      });
      sock.send(encode({ id: id++, flags: 0, questions: [{ name, type }], answers: [], authorities: [], additionals: [] }), srv.port, '127.0.0.1');
    });
}

const clock = { now: 0 };
let recursive: (Running & { resolver: Resolver }) | null = null;

/** Свежий рекурсивный резолвер на 5073: пустой кеш, время с нуля. */
async function freshRecursive() {
  if (recursive) await new Promise<void>((ok) => recursive!.sock.close(() => ok()));
  clock.now = 0;
  const resolver = createResolver({ roots: t.ROOT_HINTS, send: udpSend(), now: () => clock.now });
  const sock = dgram.createSocket('udp4');
  const me = { sock, count: 0, resolver };
  sock.on('message', async (buf, rinfo) => {
    me.count++;
    const q = readQuestion(buf);
    let res;
    try {
      res = await resolver.resolve(q.name, q.type);
    } catch {
      res = { rcode: 'SERVFAIL', answers: [] as DnsRecord[] };
    }
    // отрицательный ответ несёт SOA из кеша с остатком срока
    const target = res.answers.at(-1)?.type === 'CNAME' ? String(res.answers.at(-1)!.data) : q.name;
    const neg = [...resolver.cache.values()].find(
      (e) => e.negative && (e.key === `${target}|NXDOMAIN` || e.key === `${target}|${q.type}`),
    );
    const authorities =
      neg && !res.answers.some((r) => r.type === q.type) ? [{ ...neg.soa!, ttl: Math.max(0, neg.expires - clock.now) }] : [];
    const flags = 0x8000 | 0x0080 | (q.rd ? 0x0100 : 0);
    sock.send(encode({ id: q.id, flags, rcode: res.rcode, questions: [q], answers: res.answers, authorities, additionals: [] }), rinfo.port, rinfo.address);
  });
  await new Promise<void>((ok) => sock.bind(t.RESOLVER_PORT, '127.0.0.1', () => ok()));
  recursive = me;
  return me;
}

/** Вывод `dig` в том виде, как он напечатан в теме: без строки «Got answer», вопроса, времени и адреса. */
function tidy(out: string): string {
  const lines = out.replace(/id: \d+/, 'id: 4242').split('\n');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === ';; Got answer:' || /^;; (Query time|SERVER|WHEN|MSG SIZE)/.test(l)) continue;
    if (l === ';; QUESTION SECTION:') {
      i++;
      continue;
    }
    kept.push(l);
  }
  return kept.join('\n').replace(/\n{2,}/g, '\n\n').trim();
}

const dig = async (cmd: string) => {
  const args = cmd.replace(/\s+#.*$/, '').split(/\s+/).slice(1);
  const { stdout } = await run('dig', ['+nocmd', '+nostats', ...args]);
  return tidy(stdout);
};

let auths: Running[] = [];

beforeAll(async () => {
  auths = await Promise.all(t.SERVERS.map(startAuth));
  await freshRecursive();
}, 30_000);

afterAll(async () => {
  for (const s of [...auths, ...(recursive ? [recursive] : [])]) await new Promise<void>((ok) => s.sock.close(() => ok()));
});

describe('цепочка делегирований: dig +norec по шагам', () => {
  it('каждый шаг DIG_STEPS — тот вывод, что печатает dig сейчас', async () => {
    for (const step of t.DIG_STEPS) expect(await dig(step.cmd), step.cmd).toBe(step.out);
  });

  it('учебный резолвер по UDP идёт ровно по этой цепочке: семь запросов к четырём серверам', async () => {
    const r = createResolver({ roots: t.ROOT_HINTS, send: udpSend(), now: () => 0 });
    const res = await r.resolve('www.shop.test', 'A');
    expect(res.answers.map((a) => `${a.type} ${String(a.data)}`)).toEqual(['CNAME shop.cdn.test', 'A 203.0.113.50', 'A 203.0.113.51']);
    expect(r.log.map((e) => [e.ip, e.name, e.result, e.to ?? '', e.noGlue ?? ''])).toEqual([
      ['192.0.2.1', 'www.shop.test', 'referral', 'test', ''],
      ['192.0.2.10', 'www.shop.test', 'referral', 'shop.test', ''],
      ['192.0.2.20', 'www.shop.test', 'answer', '', ''],
      ['192.0.2.10', 'shop.cdn.test', 'referral', 'cdn.test', 'ns1.cdnhost.test'],
      ['192.0.2.10', 'ns1.cdnhost.test', 'referral', 'cdnhost.test', ''],
      ['192.0.2.30', 'ns1.cdnhost.test', 'answer', '', ''],
      ['192.0.2.30', 'shop.cdn.test', 'answer', '', ''],
    ]);
    // Порты в командах dig — те же серверы, к которым шёл резолвер
    const port = (ip: string) => String(t.SERVERS.find((s) => s.ip === ip)!.port);
    const digPorts = t.DIG_STEPS.map((s) => s.cmd.split(' ')[3]);
    const resolverPorts = r.log.filter((e) => e.name !== 'ns1.cdnhost.test').map((e) => port(e.ip!));
    expect(digPorts).toEqual(resolverPorts);
    expect(t.DIG_RECURSIVE_NOTE).toContain('**семь** запросов к четырём серверам');
    expect(new Set(r.log.map((e) => e.ip)).size).toBe(4);
  });

  it('ответы AUTH_CODE в памяти (их видит демо) совпадают с разобранными пакетами', async () => {
    const send = udpSend();
    const mem = memorySend(answer, t.SERVERS, () => t.ZONES);
    for (const q of [...t.DEMO_QUERIES, { name: 'shop.test', type: 'HTTPS' }, { name: 'shop.test', type: 'MX' }, { name: 'shop.test', type: 'TXT' }]) {
      const r = createResolver({ roots: t.ROOT_HINTS, send, now: () => 0 });
      await r.resolve(q.name, q.type);
      for (const e of r.log.filter((x) => x.ip)) {
        expect(await mem(e.ip!, e.name, e.type), `${e.ip} ${e.name} ${e.type}`).toEqual(await send(e.ip!, e.name, e.type));
      }
    }
  });

  it('строки зон в теме совпадают с тем, как dig печатает эти записи', async () => {
    const lines = (await dig('dig @127.0.0.1 -p 5072 +norec +noall +answer shop.test MX')).split('\n');
    expect(lines[0].split(/\s+/)).toEqual(t.ZONE_SHOP_TEXT.split('\n').find((l) => l.includes(' MX '))!.split(/\s+/));
  });
});

describe('рекурсивный резолвер стенда: флаги, TTL из кеша, негативный кеш', () => {
  it('ответ, остаток TTL через 15 с, NXDOMAIN с SOA и его остаток через 200 с', async () => {
    await freshRecursive();
    expect(await dig(t.DIG_RECURSIVE.cmd)).toBe(t.DIG_RECURSIVE.out);
    expect(await dig(t.DIG_NEGATIVE.cmd)).toBe(t.DIG_NEGATIVE.out);
    clock.now = 15;
    expect(await dig(t.DIG_TTL.cmd)).toBe(t.DIG_TTL.out);
    clock.now = 200;
    expect(await dig('dig @127.0.0.1 -p 5073 +noall +authority nope.shop.test')).toBe(t.DIG_NEGATIVE.later);
    // срок отказа — min(TTL SOA, minimum): 3600 и 300
    const soa = t.ZONES.find((z) => z.origin === 'shop.test')!.records.find((r) => r.type === 'SOA')!;
    expect(Math.min(soa.ttl, (soa.data as { minimum: number }).minimum)).toBe(300);
    expect(t.NEGATIVE_NOTE).toContain('(3600)');
    expect(t.NEGATIVE_NOTE).toContain('(300)');
  });

  it('HTTPS: dig 9.10 печатает тип 65 сырыми байтами, и это байты HTTPS_ROWS', async () => {
    expect(await dig(t.DIG_HTTPS.cmd)).toBe(t.DIG_HTTPS.out);
    expect(t.HTTPS_ROWS.map((r) => r.hex.replaceAll(' ', '')).join('')).toBe(t.HTTPS_RDATA);
    expect(t.HTTPS_RDATA.length / 2).toBe(13);
    expect(pkt.decode(encode({ id: 1, flags: 0x8400, questions: [{ name: 'shop.test', type: 'HTTPS' }], answers: [{ name: 'shop.test', type: 'HTTPS', ttl: 1, data: t.HTTPS_RDATA }], authorities: [], additionals: [] })).answers![0].type).toBe('UNKNOWN_65');
  });
});

describe('пакет по байтам', () => {
  const ask = (port: number, buf: Buffer) =>
    new Promise<Buffer>((ok) => {
      const s = dgram.createSocket('udp4');
      s.on('message', (m) => {
        s.close();
        ok(m);
      });
      s.send(buf, port, '127.0.0.1');
    });

  it('ответ сервера shop.test. на QUERY_HEX — байт в байт PACKET_HEX', async () => {
    const res = await ask(5072, Buffer.from(t.QUERY_HEX, 'hex'));
    expect(res.toString('hex')).toBe(t.PACKET_HEX);
    expect(t.PACKET_HEX.slice(0, 4)).toBe(t.QUERY_HEX.slice(0, 4));
    // вопрос — 31 байт; секция вопроса в ответе — копия байтов 12–30 вопроса
    expect(t.QUERY_HEX.length / 2).toBe(31);
    expect(t.PACKET_HEX.slice(24, 62)).toBe(t.QUERY_HEX.slice(24, 62));
  });

  it('PACKET_ROWS: смещения сходятся, байты вместе дают весь пакет, указатели ведут куда сказано', () => {
    let at = 0;
    for (const row of t.PACKET_ROWS) {
      expect(row.at, row.field).toBe(at);
      at += row.hex.split(' ').length;
    }
    expect(at).toBe(72);
    expect(t.PACKET_ROWS.map((r) => r.hex.replaceAll(' ', '')).join('')).toBe(t.PACKET_HEX);
    const buf = Buffer.from(t.PACKET_HEX, 'hex');
    expect(raw.name.decode(buf, 12)).toBe('img.shop.test');
    expect(raw.name.decode(buf, 16)).toBe('shop.test');
    expect(raw.name.decode(buf, 21)).toBe('test');
    expect(raw.name.decode(buf, 43)).toBe('www.shop.test');
    expect(0x2b).toBe(43);
    expect(0x15).toBe(21);
    const f = buf.readUInt16BE(2);
    expect([f >> 15, (f >> 10) & 1, (f >> 8) & 1, (f >> 7) & 1, f & 15]).toEqual([1, 1, 0, 0, 0]);
  });

  it('без сжатия dns-packet пишет тот же ответ в 111 байт против 72', () => {
    const plain = pkt.encode(pkt.decode(Buffer.from(t.PACKET_HEX, 'hex')));
    expect(plain.length).toBe(t.PACKET_PLAIN_BYTES);
    expect(t.PACKET_PLAIN_BYTES - 72).toBe(39);
    expect(t.PACKET_NOTE).toContain('Из 72 байт');
    expect(t.PACKET_NOTE).toContain('на 39 больше');
    expect(t.PACKET_NOTE).toContain('111 байт');
  });

  it('PARSE_CODE разбирает каждый пакет стенда так же, как dns-packet', () => {
    const { parse, readName } = new Function(`${t.PARSE_CODE}\nreturn { parse, readName };`)() as {
      parse: (b: Uint8Array) => {
        header: Record<string, number>;
        questions: { name: string; type: number }[];
        records: { section: string; name: string; type: number; ttl: number; data: string }[];
      };
      readName: (b: Uint8Array, p: number) => [string, number];
    };
    expect(packets.length).toBeGreaterThan(40);
    for (const buf of packets) {
      const want = pkt.decode(buf);
      const got = parse(new Uint8Array(buf));
      expect(got.header.id).toBe(want.id);
      expect(Boolean(got.header.aa)).toBe(want.flag_aa);
      expect(Boolean(got.header.rd)).toBe(want.flag_rd);
      expect(Boolean(got.header.ra)).toBe(want.flag_ra);
      expect(Boolean(got.header.qr)).toBe(want.type === 'response');
      expect(got.questions.map((q) => q.name)).toEqual(want.questions!.map((q) => q.name));
      // OPT (EDNS от dig) — не запись с TTL, а служебный блок; dns-packet разбирает его отдельно
      const all = [...(want.answers ?? []), ...(want.authorities ?? []), ...(want.additionals ?? [])].filter((r) => r.type !== 'OPT');
      got.records = got.records.filter((r) => r.type !== 41);
      expect(got.records.map((r) => r.name)).toEqual(all.map((r) => r.name));
      expect(got.records.map((r) => r.ttl)).toEqual(all.map((r) => (r as { ttl: number }).ttl));
      got.records.forEach((r, i) => {
        if (r.type === 1 || r.type === 2 || r.type === 5) expect(r.data).toBe((all[i] as { data: string }).data);
      });
    }
    expect(readName(new Uint8Array(Buffer.from(t.PACKET_HEX, 'hex')), 61)).toEqual(['shop.cdn.test', 72]);
  });
});

describe('демо: вопросы по виртуальному времени', () => {
  it('img сразу после www — один запрос к серверу, цель CNAME из кеша', async () => {
    const send = memorySend(answer, t.SERVERS, () => t.ZONES);
    const { runs, cache } = await replay(createResolver, send, t.ROOT_HINTS, [
      { t: 0, name: 'www.shop.test', type: 'A' },
      { t: 0, name: 'img.shop.test', type: 'A' },
      { t: 0, name: 'nope.shop.test', type: 'A' },
    ], 0);
    expect(runs[0].steps).toHaveLength(7);
    expect(runs[1].steps.map((s) => (s.cache ? 'cache' : s.ip))).toEqual(['192.0.2.20', 'cache']);
    expect(runs[2].result.rcode).toBe('NXDOMAIN');
    const row = (k: string) => cache.find((r) => r.key === k)!;
    expect(row('shop.cdn.test|A').ttl).toBe(20);
    expect(row('test|NS').ttl).toBe(172800);
    expect(row('nope.shop.test|NXDOMAIN').ttl).toBe(300);
    expect(t.DEMO_CAPTION).toContain('20 с');
    expect(t.DEMO_CAPTION).toContain('пять минут');
  });
});

describe('Node: dns.Resolver и пул потоков', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dns-'));

  it('NODE_RESOLVE_CODE печатает NODE_RESOLVE_OUT', async () => {
    await freshRecursive();
    writeFileSync(join(dir, 'resolve.mjs'), t.NODE_RESOLVE_CODE);
    const { stdout } = await run(process.execPath, [join(dir, 'resolve.mjs')]);
    expect(stdout.trim()).toBe(t.NODE_RESOLVE_OUT);
  });

  it('Resolver ничего не кеширует: три resolve4 подряд — три запроса на сервер', async () => {
    const rec = await freshRecursive();
    const code = `const dns = require('node:dns'); const r = new dns.promises.Resolver(); r.setServers(['127.0.0.1:5073']);
      (async () => { for (let i = 0; i < 3; i++) await r.resolve4('mail.shop.test'); })();`;
    await run(process.execPath, ['-e', code]);
    expect(rec.count).toBe(3);
    expect(t.NODE_NOTE).toContain('три `resolve4` подряд на стенде — три запроса');
  });

  it('при занятом пуле resolve4 приходит первым, dns.lookup — после хешей', async () => {
    await freshRecursive();
    writeFileSync(join(dir, 'probe.cjs'), t.POOL_PROBE_CODE);
    const want = t.POOL_PROBE_OUT.split('\n');
    for (const size of ['2', '4']) {
      const { stdout } = await run(process.execPath, [join(dir, 'probe.cjs')], { env: { ...process.env, UV_THREADPOOL_SIZE: size } });
      const got = stdout.trim().split('\n');
      expect([...got].sort()).toEqual([...want].sort());
      expect(got[0]).toBe('resolver.resolve4 shop.test');
      const at = got.indexOf('dns.lookup localhost');
      // Пул отдаёт задачи по очереди. Два потока: хеши 3 и 4 стоят в очереди раньше lookup,
      // и он начнётся, только когда освободится поток после них — позже трёх хешей.
      // Четыре потока: все заняты хешами, lookup ждёт первого освободившегося.
      expect(at, `UV_THREADPOOL_SIZE=${size}: ${got.join(' | ')}`).toBeGreaterThanOrEqual(size === '2' ? 4 : 2);
    }
    expect(want[0]).toBe('resolver.resolve4 shop.test');
    expect(want.at(-1)).toBe('dns.lookup localhost');
  }, 30_000);
});

describe('смена адреса: числа сценариев', () => {
  const sc = (id: string) => t.ROLLOUT_SCENARIOS.find((s) => s.id === id)!;
  const go = (id: string) => rollout(createResolver, answer, t.SERVERS, t.ZONES, t.ROOT_HINTS, sc(id));

  it('ROLLOUT_FACTS пересчитываются той же функцией, что рисует демо', async () => {
    const a = await go('ttl3600');
    expect(a.lastOld! - sc('ttl3600').switchAt).toBe(t.ROLLOUT_FACTS.ttl3600.lastOldAfter);
    expect(a.rows.map((r) => r.upstream)).toEqual(t.ROLLOUT_FACTS.ttl3600.upstream);
    const b = await go('ttl60');
    expect(b.lastOld! - sc('ttl60').switchAt).toBe(t.ROLLOUT_FACTS.ttl60.lastOldAfter);
    // цена короткого TTL — запросы к серверу зоны: на порядок больше
    expect(Math.min(...b.rows.map((r) => r.upstream))).toBeGreaterThan(10 * Math.max(...a.rows.map((r) => r.upstream)));
    const c = await go('lowered');
    expect(c.lastOld! - sc('lowered').switchAt).toBe(t.ROLLOUT_FACTS.lowered.lastOldAfter);
    const d = await go('late');
    expect(d.lastOld! - sc('late').switchAt).toBe(t.ROLLOUT_FACTS.late.lastOldAfter);
  });

  it('фразы в тексте согласованы с числами', () => {
    expect(Math.round(t.ROLLOUT_FACTS.late.lastOldAfter / 60)).toBe(39);
    expect(t.PITFALLS[0].d).toContain('ещё 39 минут');
    expect(sc('late').switchAt - sc('late').lowerAt!).toBe(630);
    expect(t.PITFALLS[0].d).toContain('за десять с половиной минут до смены');
    expect(sc('late').note).toContain('за десять с половиной минут до смены');
    expect(sc('ttl3600').switchAt - ROLLOUT.offsets[4]).toBe(40);
    expect(sc('ttl3600').note).toContain('за 40 секунд до смены');
    expect(t.ROLLOUT_FACTS.ttl3600.lastOldAfter).toBeGreaterThan(3400);
    expect(sc('ttl3600').note).toContain('почти час');
    expect(t.ROLLOUT_FACTS.ttl60.lastOldAfter).toBeLessThan(60);
    expect(sc('ttl60').note).toContain('меньше минуты');
    expect(sc('lowered').switchAt - sc('lowered').lowerAt!).toBeGreaterThanOrEqual(sc('lowered').ttlBefore);
    expect(t.ROLLOUT_CAPTION).toContain(`каждые ${ROLLOUT.every} секунд`);
    expect(t.ROLLOUT_CAPTION).toContain(`с ${ROLLOUT.offsets[4]}-й секунды`);
    // резолверы A и B взяли запись до понижения, C — уже после
    expect(ROLLOUT.offsets[1]).toBeLessThan(sc('late').lowerAt!);
    expect(ROLLOUT.offsets[2]).toBeGreaterThanOrEqual(sc('late').lowerAt!);
  });
});
