import { createHash, X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/platform/webrtc/data';
import { callerStats, checkRows, loadIce, localCandidates, remoteCandidates } from '@/widgets/ice-lab/model/run';
import type { StandRun } from '@/widgets/ice-lab/model/types';

/**
 * Тема «WebRTC: как два браузера находят друг друга».
 *
 * `SDP_CODE` и `STATS_CODE` — строки темы: напечатаны на странице и исполняются демо. Здесь они
 * сверяются с тем, что снял стенд в Chromium 153 (`STAND` в `stand.ts`): разбор строк кандидатов —
 * с `new RTCIceCandidate` самого Chromium (`chromiumParse`), формулы RFC 8445 — с приоритетами
 * кандидатов и пар из `getStats`, отпечаток в SDP — с SHA-256 сертификата (node:crypto). Числа
 * из текста пересчитываются из журнала. Браузерный прогон тестом не повторяется: порты, ufrag
 * и ключи новые при каждом запуске стенда.
 */

const api = loadIce(t.SDP_CODE, t.STATS_CODE);
const S = t.STAND;
const runs = S.scenarios as unknown as Record<string, StandRun & { turn: Record<string, string>[]; relayStats: Record<string, number>[] }>;
const lines = (sdp: string) => sdp.split(/\r?\n/).filter(Boolean);

describe('SDP_CODE против разбора Chromium', () => {
  const all = Object.entries(S.chromiumParse) as [string, Record<string, unknown>][];

  it('стенд дал кандидатов всех трёх собранных типов', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    const types = new Set(all.map(([, c]) => c.type));
    expect([...types].sort()).toEqual(['host', 'relay', 'srflx']);
  });

  it('parseCandidate даёт те же поля, что RTCIceCandidate', () => {
    for (const [line, c] of all) {
      const p = api.parseCandidate(line);
      expect({
        foundation: p.foundation,
        component: p.component === 1 ? 'rtp' : 'rtcp',
        protocol: p.protocol,
        priority: p.priority,
        address: p.address,
        port: p.port,
        type: p.type,
        relatedAddress: p.relatedAddress,
        relatedPort: p.relatedPort,
      }).toEqual({
        foundation: c.foundation,
        component: c.component,
        protocol: c.protocol,
        priority: c.priority,
        address: c.address,
        port: c.port,
        type: c.type,
        relatedAddress: c.relatedAddress,
        relatedPort: c.relatedPort,
      });
      // и в строке SDP (a=candidate:…) — то же самое
      expect(api.parseCandidate('a=candidate:' + line.slice('candidate:'.length))).toEqual(p);
    }
  });

  it('формула приоритета кандидата собирает каждый приоритет стенда обратно', () => {
    const prios = new Set<number>(all.map(([, c]) => c.priority as number));
    for (const run of Object.values(runs)) for (const c of [...run.caller.candidates, ...run.callee.candidates]) prios.add(c.priority!);
    for (const p of prios) {
      const s = api.splitPriority(p);
      expect(s.component).toBe(1);
      expect(api.candidatePriority(s.typePref, s.localPref, s.component)).toBe(p);
    }
  });

  it('таблица предпочтений типа — из стенда', () => {
    const seen = new Map<string, number>();
    for (const run of Object.values(runs)) {
      for (const c of [...run.caller.candidates, ...run.callee.candidates]) seen.set(c.candidateType!, c.priority!);
    }
    for (const row of t.PRIORITY_ROWS) {
      const p = Number(row.sample);
      expect(seen.get(row.k), row.k).toBe(p);
      const s = api.splitPriority(p);
      expect(String(s.typePref)).toBe(row.stand);
      expect(String(s.localPref)).toBe(row.local);
    }
    expect(t.PRIORITY_AFTER).toContain('3 вместо 0');
  });

  it('поля srflx-кандидата в таблице — то, что разобрал parseCandidate', () => {
    const c = api.parseCandidate(t.SAMPLE_CANDIDATE);
    const row = (k: string) => t.CANDIDATE_FIELDS.find((r) => r.k === k)!.v;
    expect(row('foundation')).toBe(c.foundation);
    expect(row('component')).toBe(String(c.component));
    expect(row('protocol')).toBe(c.protocol);
    expect(row('priority')).toBe(String(c.priority));
    expect(row('address, port')).toBe(`${c.address} ${c.port}`);
    expect(row('typ')).toBe(c.type);
    expect(row('raddr, rport')).toBe(`${c.relatedAddress} ${c.relatedPort}`);
    expect(row('generation, ufrag, network-cost')).toBe(`${c.extra.generation}, ${c.extra.ufrag}, ${c.extra['network-cost']}`);
  });
});

describe('приоритет пары и список проверок против getStats', () => {
  it('pairPriority даёт ровно priority каждой пары из getStats (как число JS)', () => {
    let n = 0;
    for (const run of Object.values(runs)) {
      for (const side of [run.caller, run.callee]) {
        const byId = new Map(side.candidates.map((c) => [c.id, c]));
        const controlling = side.transport.iceRole === 'controlling';
        for (const p of side.pairs) {
          const l = byId.get(p.localCandidateId)!.priority!;
          const r = byId.get(p.remoteCandidateId)!.priority!;
          const prio = controlling ? api.pairPriority(l, r) : api.pairPriority(r, l);
          expect(Number(prio)).toBe(p.priority);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(10);
  });

  it('checklist составил те же пары, что Chromium; лишняя у Chromium — только с prflx', () => {
    for (const [id, run] of Object.entries(runs)) {
      const rows = checkRows(api, run);
      const fromStats = rows.filter((r) => r.state !== null);
      expect(fromStats.length, id).toBe(run.caller.pairs.length);
      for (const r of rows.filter((x) => x.learned)) expect(r.remoteLabel.startsWith('prflx'), id).toBe(true);
      // Пары из списка, которых нет в отчёте, бывают только после отказа (Chromium их убрал).
      if (run.caller.states.conn === 'connected') expect(rows.every((r) => r.state !== null), id).toBe(true);
    }
  });

  it('симметричный NAT с TURN: prflx узнан, выбрана host → relay', () => {
    const rows = checkRows(api, runs.symturn);
    expect(rows.filter((r) => r.learned)).toHaveLength(1);
    const sel = rows.find((r) => r.selected)!;
    expect(sel.localLabel.startsWith('host')).toBe(true);
    expect(sel.remoteLabel.startsWith('relay')).toBe(true);
    expect(sel.state).toBe('succeeded');
    // Порт prflx — настоящий порт host отвечающего; в доставленном host-кандидате он +7.
    const realHost = runs.symturn.callee.log.find((e) => e.k === 'icecandidate' && / typ host /.test(e.v ?? ''))!;
    const delivered = remoteCandidates(api, runs.symturn).find((c) => c.type === 'host')!;
    expect(delivered.port - api.parseCandidate(realHost.v!).port).toBe(7);
    expect(rows.find((r) => r.learned)!.remoteLabel.endsWith(':' + api.parseCandidate(realHost.v!).port)).toBe(true);
  });
});

describe('STATS_CODE: сводка по отчёту каждого сценария', () => {
  it('совпадает с таблицей STATS_ROWS', () => {
    expect(t.STATS_ROWS.map((r) => r.id).sort()).toEqual(Object.keys(runs).sort());
    for (const row of t.STATS_ROWS) {
      const s = api.summarize(callerStats(runs[row.id]));
      expect({ ice: s.ice, dtls: s.dtls, path: s.path ?? '—', turn: s.viaTurn ? 'да' : 'нет' }, row.id).toEqual({
        ice: row.ice,
        dtls: row.dtls,
        path: row.path,
        turn: row.turn,
      });
    }
  });

  it('у соединившихся — DTLS 1.3 (FEFC)', () => {
    for (const run of Object.values(runs)) {
      if (run.caller.states.conn !== 'connected') continue;
      expect(api.summarize(callerStats(run)).tlsVersion).toBe('FEFC');
    }
  });

  it('потеря точности приоритета пары в getStats — как в тексте', () => {
    const exact = api.pairPriority(2113937151, 2113937151);
    expect(exact.toString()).toBe('9079290933572287998');
    expect(Number(exact)).toBe(9079290933572287000);
    expect(t.STATS_FACTS.map((f) => f.d).join(' ')).toContain('9079290933572287998 превращается в 9079290933572287000');
  });
});

describe('журнал стенда и числа из текста', () => {
  it('сигнализация сценария host: offer без кандидатов, сообщения 200–550 байт', () => {
    const sig = runs.host.signal;
    expect(sig[0].kind).toBe('offer');
    expect(sig[0].from).toBe('caller');
    expect(sig[0].sdp).not.toContain('a=candidate');
    expect(sig[0].sdp).toContain('a=ice-options:trickle');
    for (const m of Object.values(runs).flatMap((r) => r.signal)) {
      expect(m.bytes).toBeGreaterThanOrEqual(200);
      expect(m.bytes).toBeLessThanOrEqual(550);
    }
    // Первый кандидат звонящего прошёл через сервер раньше, чем answer.
    const kinds = sig.map((m) => `${m.from}:${m.kind}`);
    expect(kinds.indexOf('caller:candidate')).toBeLessThan(kinds.indexOf('callee:answer'));
    expect(t.DATA_OFFER).toBe(sig[0].sdp!.replace(/\r\n/g, '\n').trimEnd());
    const cand = Object.values(runs).flatMap((r) => r.signal).filter((m) => m.kind === 'candidate').map((m) => m.bytes);
    expect(Math.min(...cand)).toBe(215);
    expect(Math.max(...cand)).toBe(225);
    expect(t.TRICKLE_NOTE).toContain('215–225 байт');
  });

  it('строки таблицы SDP есть в offer', () => {
    const offer = parseLines(t.DATA_OFFER);
    for (const row of t.SDP_ROWS) {
      for (const part of row.k.split(', ')) {
        const key = part.replace(' …', '');
        expect(offer.some((l) => l.startsWith(key)), key).toBe(true);
      }
    }
    expect(offer).toContain('o=- ' + offer.find((l) => l.startsWith('o='))!.slice(4));
    for (const run of Object.values(runs)) for (const m of run.signal) if (m.sdp) expect(m.sdp).toMatch(/^o=- \d+ 2 IN IP4 127\.0\.0\.1$/m);
  });

  it('offer с медиа: 171 строка, 8 и 23 формата, шесть H.264; answer — recvonly и active', () => {
    const o = api.parseSdp(S.media.offer);
    expect(lines(S.media.offer)).toHaveLength(171);
    expect(o.bundle).toEqual(['0', '1', '2']);
    expect(o.media.map((m) => [m.kind, m.formats.length])).toEqual([['audio', 8], ['video', 23], ['application', 1]]);
    expect(o.media[1].codecs.filter((c) => c.name === 'H264')).toHaveLength(6);
    expect(o.media[0].codecs[0]).toEqual({ pt: 111, name: 'opus', clockRate: 48000, channels: 2 });
    expect(o.media[1].codecs[0]).toEqual({ pt: 96, name: 'VP8', clockRate: 90000, channels: null });
    expect(o.media.every((m) => m.setup === 'actpass')).toBe(true);
    const a = api.parseSdp(S.media.answer);
    expect(a.media.map((m) => m.formats.length)).toEqual([8, 23, 1]);
    expect(a.media.slice(0, 2).map((m) => m.direction)).toEqual(['recvonly', 'recvonly']);
    expect(a.media.every((m) => m.setup === 'active')).toBe(true);
    expect(t.MEDIA_NOTE).toContain('171 строка');
    // Выбранные кодеки — первые номера секций.
    expect(S.media.codecs.map((c) => [c.mimeType, c.payloadType])).toEqual([['audio/opus', 111], ['video/VP8', 96]]);
    // max-message-size и sctp-port
    expect(o.media[2].attrs.find((x) => x.k === 'max-message-size')!.v).toBe(String(t.PROBES.maxMessageSize));
    expect(S.media.sctp!.maxMessageSize).toBe(262144);
  });

  it('signalingState идёт по таблице', () => {
    const seq = (side: StandRun['caller']) => side.log.filter((e) => e.k === 'signalingState').map((e) => e.v);
    for (const run of Object.values(runs)) {
      expect(seq(run.caller)).toEqual(['have-local-offer', 'stable']);
      expect(seq(run.callee)).toEqual(['have-remote-offer', 'stable']);
    }
    expect(t.OFFER_ANSWER_STEPS.map((s) => s.state)).toEqual(['`have-local-offer`', '`have-remote-offer`', '`stable`', '`stable`']);
  });

  it('mDNS: с ним host — имя .local и srflx с raddr 0.0.0.0; без него — адрес', () => {
    for (const run of Object.values(runs)) {
      for (const c of localCandidates(api, run)) {
        if (c.type === 'host') expect(c.address).toMatch(/^[0-9a-f-]{36}\.local$/);
        if (c.type === 'srflx') expect([c.relatedAddress, c.relatedPort]).toEqual(['0.0.0.0', 0]);
      }
    }
    const [host, srflx] = S.noMdnsCandidates.map((l) => api.parseCandidate(l));
    expect(host.address).toBe('192.168.1.105');
    expect(srflx.relatedAddress).toBe('192.168.1.105');
    expect(srflx.relatedPort).toBe(host.port);
    expect(srflx.port - host.port).toBe(1000);
    expect(t.MDNS_ROWS[1].v).toContain(`192.168.1.105 ${host.port} typ host`);
    expect(Object.keys(S.chromiumParse).some((l) => l.includes(t.MDNS_ROWS[0].v.match(/`(\w{8})-/)![1]) && l.includes(' 52020 typ host'))).toBe(true);
    // getStats отдаёт пустой адрес у mDNS-кандидата.
    expect(runs.host.caller.candidates.some((c) => c.candidateType === 'host' && c.address === '')).toBe(true);
  });

  it('TURN: 401, затем relay; ChannelBind 0x4000; 60 пакетов ChannelData и 14 indication', () => {
    const turn = runs.relay.turn;
    expect(turn.filter((x) => x.method === 'Allocate').map((x) => x.result)).toEqual(['401', '401', 'ok', 'ok']);
    expect(turn.filter((x) => x.method === 'ChannelBind').map((x) => x.channel)).toEqual(['0x4000', '0x4000']);
    const st = runs.relay.relayStats;
    const sum = (k: string) => st.reduce((a, x) => a + x[k], 0);
    expect(sum('channelDataOut') + sum('channelDataIn')).toBe(60);
    expect(sum('sendInd') + sum('dataInd')).toBe(14);
    expect(t.TURN_NOTE).toContain('60 пакетов ChannelData');
    expect(t.TURN_NOTE).toContain('ещё 14');
    expect(t.TURN_ROWS).toHaveLength(turn.length);
    // «только relay» — у звонящего ни одного не-relay кандидата
    expect(localCandidates(api, runs.relay).every((c) => c.type === 'relay')).toBe(true);
  });

  it('NAT без TURN: failed примерно через 15 с, iceConnectionState — disconnected', () => {
    const log = runs.symmetric.caller.log;
    const checking = log.find((e) => e.k === 'connectionState' && e.v === 'connecting')!.ms;
    const failed = log.find((e) => e.k === 'connectionState' && e.v === 'failed')!.ms;
    expect(failed - checking).toBeGreaterThan(14000);
    expect(failed - checking).toBeLessThan(16500);
    expect(runs.symmetric.caller.states).toMatchObject({ ice: 'disconnected', conn: 'failed' });
    expect(runs.symmetric.caller.transport.iceState).toBe('failed');
    expect(runs.symmetric.caller.pairs).toHaveLength(0);
    expect(t.SYMMETRIC_RESULT).toContain('15 секунд');
  });

  it('relay без серверов: ни одного кандидата, состояние new', () => {
    const r = runs.norelay;
    expect(localCandidates(api, r)).toHaveLength(0);
    expect(r.signal.map((m) => m.kind)).toEqual(['offer', 'answer']);
    expect(r.caller.states).toMatchObject({ conn: 'new', ice: 'new', gather: 'complete' });
  });

  it('чужой отпечаток: ICE connected, DTLS failed — у обеих сторон', () => {
    const r = runs.badfp;
    const offer = r.signal.find((m) => m.kind === 'offer')!.sdp!;
    expect(offer).toMatch(/a=fingerprint:sha-256 [0-9A-F]{2}(:[0-9A-F]{2}){31}/);
    for (const side of [r.caller, r.callee]) {
      expect(side.transport).toMatchObject({ iceState: 'connected', dtlsState: 'failed' });
      expect(side.states).toMatchObject({ ice: 'connected', conn: 'failed' });
    }
  });
});

describe('DTLS: сертификат, отпечаток, роли', () => {
  const certs = S.media.certificates;
  const local = certs.find((c) => c.id === S.media.localCertificateId)!;

  it('отпечаток в offer — SHA-256 сертификата из getStats', () => {
    const der = Buffer.from(local.base64Certificate, 'base64');
    const hex = createHash('sha256').update(der).digest('hex').toUpperCase().match(/../g)!.join(':');
    expect(local.fingerprint).toBe(hex);
    const o = api.parseSdp(S.media.offer);
    for (const m of o.media) expect(m.fingerprint).toBe('sha-256 ' + hex);
    // Второй сертификат — отвечающего, и его отпечаток в answer.
    const remote = certs.find((c) => c !== local)!;
    expect(api.parseSdp(S.media.answer).media[0].fingerprint).toBe('sha-256 ' + remote.fingerprint);
  });

  it('сертификат: CN=WebRTC, P-256, 280 байт, 30 сентября — 31 октября', () => {
    const der = Buffer.from(local.base64Certificate, 'base64');
    const x = new X509Certificate(der);
    expect(der.length).toBe(280);
    expect(x.subject).toBe('CN=WebRTC');
    expect(x.issuer).toBe('CN=WebRTC');
    expect(x.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(new Date(x.validFrom).toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(new Date(x.validTo).toISOString().slice(0, 10)).toBe('2026-10-31');
    expect(t.DTLS_ROWS[0].v).toContain('280 байт');
  });

  it('шифры и роли — как в таблице', () => {
    const [caller, callee] = S.media.transport;
    expect(caller).toMatchObject({ dtlsRole: 'server', iceRole: 'controlling', tlsVersion: 'FEFC', dtlsCipher: 'TLS_AES_128_GCM_SHA256', srtpCipher: 'SRTP_AES128_CM_HMAC_SHA1_80' });
    expect(callee).toMatchObject({ dtlsRole: 'client', iceRole: 'controlled' });
    const rows = t.DTLS_ROWS.map((r) => r.v).join(' ');
    for (const v of ['FEFC', 'TLS_AES_128_GCM_SHA256', 'SRTP_AES128_CM_HMAC_SHA1_80']) expect(rows).toContain(v);
  });
});

describe('каналы данных', () => {
  it('параметры и номера потоков — как в таблице', () => {
    const [chat, pos] = S.media.channels;
    expect(chat).toMatchObject({ label: 'chat', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, id: 1 });
    expect(pos).toMatchObject({ label: 'pos', ordered: false, maxRetransmits: 0, maxPacketLifeTime: null, id: 3 });
    const row = (k: string) => t.CHANNEL_ROWS.find((r) => r.k.includes(k))!;
    expect(row('`id`').chat).toBe('`1`');
    expect(row('`id`').pos).toBe('`3`');
    expect(S.media.transport[0].dtlsRole).toBe('server'); // нечётные — у DTLS-сервера
    expect(t.CHANNELS_CODE).toContain("{ ordered: false, maxRetransmits: 0 }");
  });

  it('три host с одной foundation до ответа — по одному на секцию', () => {
    const c = S.media.candidates.map((l) => api.parseCandidate(l));
    expect(c).toHaveLength(3);
    expect(new Set(c.map((x) => x.foundation)).size).toBe(1);
  });

  it('пробы: max-message-size и ошибки дословно в тонких местах', () => {
    const text = t.PITFALLS.map((p) => p.d).join('\n');
    expect(text).toContain('262 144 байта');
    expect(t.PROBES.tooBig).toContain('TypeError');
    expect(t.PROBES.earlyCandidate).toContain('The remote description was null');
    expect(text).toContain('The remote description was null');
    expect(t.ENCRYPTION_NOTE).toContain('SDP without DTLS fingerprint');
    expect(t.PROBES.noFingerprint).toContain('SDP without DTLS fingerprint');
  });
});

describe('демо', () => {
  it('сценарии демо — все прогоны стенда, у каждого есть подпись', () => {
    expect(t.DEMO_SCENARIOS.map((s) => s.id).sort()).toEqual(Object.keys(runs).sort());
    for (const s of t.DEMO_SCENARIOS) {
      expect(s.run).toBe(S.scenarios[s.id as keyof typeof S.scenarios]);
      expect(s.note.length).toBeGreaterThan(40);
    }
  });

  it('сквозной пример — синтаксически целый скрипт', () => {
    expect(() => new Function('config', 'WebSocket', 'RTCPeerConnection', 'location', t.SIGNALING_CODE)).not.toThrow();
  });
});

function parseLines(sdp: string) {
  return sdp.split('\n').filter(Boolean);
}
