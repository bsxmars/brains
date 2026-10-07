import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/load-balancing/data';
import { assign, letterOf, loadPick, loadRing, simulate, standKeys, standServers } from '@/widgets/lb-lab/model/run';

/**
 * Тема «Балансировка нагрузки и проверки здоровья».
 *
 * `PICK_CODE` и `RING_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с тем, что выдал настоящий nginx 1.30.0 на стенде (литералы `data.ts`):
 * последовательности бэкендов и выбор для всех 1000 ключей, побуквенно. Доля переехавших
 * ключей сверяется с аналитикой 1/(N+1) и N/(N+1). `DRAIN_CODE` исполняется на `node:http`.
 */

const pick = loadPick(t.PICK_CODE);
const ring = loadRing(t.RING_CODE);
const keys = standKeys(1000);
const seqOf = (algo: 'swrr' | 'lc', weights: number[], events: ('long' | 'short')[]) =>
  simulate(pick, { algo, weights, events })
    .map((s) => s.chosen)
    .join('');
const shorts = (n: number) => Array.from({ length: n }, () => 'short' as const);
const count = (s: string) => [...s].reduce<Record<string, number>>((o, c) => ((o[c] = (o[c] ?? 0) + 1), o), {});
const moved = (a: string[] | string, b: string[] | string) => [...a].filter((x, i) => x !== b[i]).length;

describe('PICK_CODE против последовательностей nginx', () => {
  it.each(t.LB_SCENARIOS.map((s) => [s.id, s] as const))('сценарий демо %s', (_, s) => {
    expect(seqOf(s.algo, s.weights, s.events)).toBe(s.nginx);
  });

  it('сценарии демо — это литералы стенда', () => {
    const byId = Object.fromEntries(t.LB_SCENARIOS.map((s) => [s.id, s.nginx]));
    expect(byId.rr).toBe(t.STAND_SEQ.rr);
    expect(byId.wrr).toBe(t.STAND_SEQ.wrr);
    expect(byId['rr-busy']).toBe(t.STAND_SEQ.busyRr.slow + t.STAND_SEQ.busyRr.quick);
    expect(byId['lc-busy']).toBe(t.STAND_SEQ.busyLc.slow + t.STAND_SEQ.busyLc.quick);
  });

  it('least_conn без долгих запросов — тот же круг', () => {
    expect(seqOf('lc', [1, 1, 1], shorts(9))).toBe(t.STAND_SEQ.lcIdle);
  });

  it('с zone четыре процесса дают узор одного; без zone — перекос из таблицы', () => {
    expect(t.STAND_SEQ.workersZone).toBe(t.STAND_SEQ.wrr);
    for (const row of t.WORKERS_ROWS) {
      const c = count(row.seq);
      expect(row.count).toBe(`A ${c.A}, B ${c.B}, C ${c.C}`);
    }
    expect(t.WORKERS_ROWS[0].seq).toBe(t.STAND_SEQ.workersNoZone);
  });

  it('наивный «пять раз A подряд» в тексте — не то, что делает nginx', () => {
    expect(t.STAND_SEQ.wrr.slice(0, 7)).toBe('AABACAA');
    expect(t.RR_NOTE).toContain('`AABACAA`');
  });

  it('таблица least_conn против круга — литералы стенда', () => {
    expect(t.BUSY_ROWS[0].quick).toBe(t.STAND_SEQ.busyRr.quick);
    expect(t.BUSY_ROWS[1].quick).toBe(t.STAND_SEQ.busyLc.quick);
  });
});

describe('RING_CODE против nginx и аналитики', () => {
  it('crc32 совпадает с zlib', () => {
    for (const s of ['', 'a', 'user-17', 'app\u000052801', 'Привет']) {
      expect(ring.crc32(ring.utf8(s))).toBe(zlibCrc32(Buffer.from(s)) >>> 0);
    }
  });

  it('hash $arg_key: все 1000 ключей там же, где у nginx', () => {
    expect(assign(ring, keys, 3, 'mod').join('')).toBe(t.STAND_H3);
    expect(assign(ring, keys, 4, 'mod').join('')).toBe(t.STAND_H4);
  });

  it('hash $arg_key consistent: все 1000 ключей там же, где у nginx', () => {
    expect(assign(ring, keys, 3, 'ring').join('')).toBe(t.STAND_CH3);
    expect(assign(ring, keys, 4, 'ring').join('')).toBe(t.STAND_CH4);
  });

  it('липкость по cookie: тот же ключ — тот же бэкенд, что у nginx', () => {
    const r = ring.buildRing(standServers(3), 160);
    for (const [sid, seq] of Object.entries(t.STAND_SEQ.stickyWithCookie)) {
      expect(letterOf(ring.ringLookup(r, sid)).repeat(3)).toBe(seq);
    }
  });

  it('таблица переезда: числа из литералов стенда', () => {
    const [mod, cons] = t.HASH_ROWS;
    expect(moved(t.STAND_H3, t.STAND_H4)).toBe(mod.moved);
    expect(moved(t.STAND_CH3, t.STAND_CH4)).toBe(cons.moved);
    const toD = (a: string, b: string) => [...a].filter((x, i) => x !== b[i] && b[i] === 'D').length;
    expect(toD(t.STAND_H3, t.STAND_H4)).toBe(247);
    expect(mod.toNew).toContain(`${mod.moved - 247} между`);
    expect(toD(t.STAND_CH3, t.STAND_CH4)).toBe(cons.moved);
    expect(t.MOD_NOTE).toContain(`**${mod.moved}**`);
  });

  it('доля переехавших ≈ 1/(N+1) у кольца и ≈ N/(N+1) у остатка', () => {
    const many = standKeys(20000);
    for (let n = 2; n <= 8; n++) {
      const r1 = assign(ring, many, n, 'ring');
      const r2 = assign(ring, many, n + 1, 'ring');
      const share = moved(r1, r2) / many.length;
      expect(Math.abs(share - 1 / (n + 1))).toBeLessThan(0.05);
      // переезжают только на новый бэкенд
      const newName = letterOf(standServers(n + 1)[n]);
      expect(r2.filter((x, i) => x !== r1[i]).every((x) => x === newName)).toBe(true);
      const m1 = assign(ring, many, n, 'mod');
      const m2 = assign(ring, many, n + 1, 'mod');
      expect(Math.abs(moved(m1, m2) / many.length - n / (n + 1))).toBeLessThan(0.05);
    }
  });

  it('таблица виртуальных узлов считается RING_CODE', () => {
    const load = (n: number, v: number) => {
      const c = count(assign(ring, keys, n, 'ring', v).join(''));
      return Object.keys(c)
        .sort()
        .map((k) => `${k} ${c[k]}`)
        .join(', ');
    };
    for (const row of t.VNODE_ROWS) {
      expect(load(2, row.vnodes)).toBe(row.two);
      expect(load(4, row.vnodes)).toBe(row.four);
    }
  });

  it('ip_hash: формула nginx (три первых числа адреса) даёт таблицу стенда', () => {
    const ipHash = (ip: string) => {
      const a = ip.split('.').map(Number);
      let h = 89;
      for (let i = 0; i < 3; i++) h = (h * 113 + a[i]) % 6271;
      return 'ABC'[h % 3];
    };
    for (const row of t.IP_HASH_ROWS) expect(ipHash(row.ip)).toBe(row.backend);
  });
});

describe('DRAIN_CODE на настоящем node:http', () => {
  function request(port: number, agent: http.Agent, path = '/') {
    return new Promise<{ status: number; conn: string | undefined; port: number }>((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, conn: res.headers.connection, port: r.socket?.localPort ?? 0 }));
      });
      r.on('error', reject);
    });
  }
  const handle = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const ms = req.url === '/slow' ? 150 : 0;
    setTimeout(() => res.end('ok'), ms);
  };
  const listen = (server: http.Server) =>
    new Promise<number>((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('только server.close(): занятое в момент вызова keep-alive соединение продолжает обслуживать', async () => {
    const server = http.createServer(handle);
    server.keepAliveTimeout = 5000;
    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    let closed = false;
    const slow = request(port, agent, '/slow');
    await sleep(30);
    server.close(() => (closed = true));
    const first = await slow;
    const next = await request(port, agent);
    expect(next.status).toBe(200);
    expect(next.port).toBe(first.port); // то же соединение
    await sleep(50);
    expect(closed).toBe(false);
    agent.destroy();
    server.closeAllConnections();
  });

  it('DRAIN_CODE: долгий ответ доделан, соединение закрыто, close сработал, новых не принимает', async () => {
    const fakeProcess = { on: () => undefined, exit: () => undefined };
    const { server, drain } = new Function('http', 'handle', 'process', `${t.DRAIN_CODE}\nreturn { server, drain };`)(
      http,
      handle,
      fakeProcess,
    ) as { server: http.Server; drain: (done: () => void) => void };
    server.keepAliveTimeout = 5000;
    const port = await listen(server);
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    await request(port, agent); // соединение уже есть и простаивает — как у nginx
    let closed = false;
    const slow = request(port, agent, '/slow');
    await sleep(30);
    drain(() => (closed = true));
    const res = await slow;
    expect(res.status).toBe(200);
    expect(res.conn).toBe('close');
    await sleep(50);
    expect(closed).toBe(true);
    await expect(request(port, agent)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    agent.destroy();
  });
});
