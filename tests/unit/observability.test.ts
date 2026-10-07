import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  defaultTextMapGetter,
  defaultTextMapSetter,
  metrics,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import { parseTraceParent, W3CTraceContextPropagator } from '@opentelemetry/core';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  ParentBasedSampler,
  SamplingDecision,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import { METRIC_HTTP_SERVER_REQUEST_DURATION } from '@opentelemetry/semantic-conventions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/observability/data';
import { loadStats, loadTraceparent, loadTree } from '@/widgets/trace-lab/model/run';
import type { Hop, LogLine, StandSpan } from '@/widgets/trace-lab/model/types';

/**
 * Тема «Наблюдаемость: логи, метрики и трассировка».
 *
 * Здесь заново поднимается стенд из шапки `data.ts`: web (клиент) → api → stock на `node:http`,
 * три `BasicTracerProvider` с одним `InMemorySpanExporter`, сэмплер
 * `ParentBased(TraceIdRatioBased(0.25))`, детерминированные id и время. Заголовки, спаны
 * и логи сверяются с литералами темы как есть — сменится поведение SDK, покраснеет здесь.
 *
 * Учебные строки `TRACEPARENT_CODE`, `TREE_CODE`, `STATS_CODE` исполняются тем же
 * `model/run.ts`, что и демо, и сверяются: разбор заголовка — с `W3CTraceContextPropagator`,
 * дерево — со ссылками на родителя у спанов SDK.
 */

const tp = loadTraceparent(t.TRACEPARENT_CODE);
const tree = loadTree(t.TREE_CODE);
const stats = loadStats(t.STATS_CODE);
const propagator = new W3CTraceContextPropagator();

// ─── Стенд ────────────────────────────────────────────────────────────────────────────────

const T0 = t.STAND_T0;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const ratioSampler = new TraceIdRatioBasedSampler(t.STAND_RATIO);

function traceIdFor(scenario: string, sampled: boolean): string {
  for (let k = 0; ; k++) {
    const id = sha(`trace/${scenario}/${k}`).slice(0, 32);
    const d = ratioSampler.shouldSample(ROOT_CONTEXT, id).decision;
    if ((d === SamplingDecision.RECORD_AND_SAMPLED) === sampled) return id;
  }
}

const ids = { scenario: '', n: 0, traceId: '' };
const exporter = new InMemorySpanExporter();
const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(t.STAND_RATIO) });
const tracerOf = (name: string): Tracer =>
  new BasicTracerProvider({
    resource: resourceFromAttributes({ 'service.name': name }),
    sampler,
    idGenerator: {
      generateTraceId: () => ids.traceId,
      generateSpanId: () => sha(`span/${ids.scenario}/${ids.n++}`).slice(0, 16),
    },
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }).getTracer(name);
const tWeb = tracerOf('web');
const tApi = tracerOf('api');
const tStock = tracerOf('stock');

interface Plan {
  fail: boolean;
  apiStart: number; authStart: number; authEnd: number; callStart: number; stockStart: number;
  dbStart: number; dbEnd: number; stockEnd: number; callEnd: number; renderStart?: number;
  renderEnd?: number; apiEnd: number; webEnd: number;
}
const OK: Plan = { fail: false, apiStart: 6, authStart: 8, authEnd: 13, callStart: 15, stockStart: 19, dbStart: 21, dbEnd: 88, stockEnd: 92, callEnd: 96, renderStart: 98, renderEnd: 114, apiEnd: 118, webEnd: 124 };
const FAIL: Plan = { fail: true, apiStart: 6, authStart: 8, authEnd: 13, callStart: 15, stockStart: 19, dbStart: 21, dbEnd: 1021, stockEnd: 1023, callEnd: 1027, apiEnd: 1030, webEnd: 1036 };

let plan: Plan;
let now = 0;
const logs: LogLine[] = [];
const hops: Hop[] = [];
function log(service: string, level: LogLine['level'], msg: string, span: Span) {
  const sc = span.spanContext();
  logs.push({ ts: new Date(T0 + now).toISOString(), service, level, msg, trace_id: sc.traceId, span_id: sc.spanId });
}

let stockPort = 0;
let apiPort = 0;

const stock = http.createServer((req, res) => {
  hops.push({ from: 'api', to: 'stock', traceparent: String(req.headers.traceparent) });
  const ctx = propagator.extract(ROOT_CONTEXT, req.headers, defaultTextMapGetter);
  const s = tStock.startSpan('GET /stock', { kind: SpanKind.SERVER, startTime: T0 + plan.stockStart, attributes: { 'http.request.method': 'GET', 'http.route': '/stock' } }, ctx);
  const db = tStock.startSpan('SELECT stock', { kind: SpanKind.CLIENT, startTime: T0 + plan.dbStart, attributes: { 'db.system.name': 'postgresql', 'db.operation.name': 'SELECT', 'db.collection.name': 'stock' } }, trace.setSpan(ctx, s));
  if (plan.fail) {
    now = plan.dbEnd;
    const err = new Error('query timeout after 1000 ms');
    db.recordException(err, T0 + plan.dbEnd);
    db.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    log('stock', 'error', 'stock query failed: query timeout after 1000 ms', db);
  }
  db.end(T0 + plan.dbEnd);
  const code = plan.fail ? 503 : 200;
  s.setAttribute('http.response.status_code', code);
  if (plan.fail) s.setStatus({ code: SpanStatusCode.ERROR });
  s.end(T0 + plan.stockEnd);
  res.writeHead(code).end();
});

const api = http.createServer((req, res) => {
  hops.push({ from: 'web', to: 'api', traceparent: String(req.headers.traceparent) });
  const ctx = propagator.extract(ROOT_CONTEXT, req.headers, defaultTextMapGetter);
  const s = tApi.startSpan('GET /api/cart', { kind: SpanKind.SERVER, startTime: T0 + plan.apiStart, attributes: { 'http.request.method': 'GET', 'http.route': '/api/cart' } }, ctx);
  const sctx = trace.setSpan(ctx, s);
  tApi.startSpan('auth.check', { startTime: T0 + plan.authStart }, sctx).end(T0 + plan.authEnd);
  const c = tApi.startSpan('GET /stock', { kind: SpanKind.CLIENT, startTime: T0 + plan.callStart, attributes: { 'http.request.method': 'GET', 'server.address': 'stock' } }, sctx);
  const headers: Record<string, string> = {};
  propagator.inject(trace.setSpan(sctx, c), headers, defaultTextMapSetter);
  http.get({ port: stockPort, path: '/stock', headers }, (r) => {
    r.resume();
    r.on('end', () => {
      const failed = (r.statusCode ?? 0) >= 500;
      c.setAttribute('http.response.status_code', r.statusCode ?? 0);
      if (failed) c.setStatus({ code: SpanStatusCode.ERROR });
      c.end(T0 + plan.callEnd);
      if (failed) {
        now = plan.callEnd;
        log('api', 'error', 'GET /stock answered 503', c);
      } else {
        tApi.startSpan('render cart', { startTime: T0 + plan.renderStart! }, sctx).end(T0 + plan.renderEnd!);
      }
      const code = failed ? 502 : 200;
      s.setAttribute('http.response.status_code', code);
      if (failed) s.setStatus({ code: SpanStatusCode.ERROR });
      s.end(T0 + plan.apiEnd);
      now = plan.apiEnd;
      log('api', failed ? 'error' : 'info', `GET /api/cart ${code} in ${plan.apiEnd - plan.apiStart} ms`, s);
      res.writeHead(code).end();
    });
  });
});

const get = (port: number, headers: Record<string, string>) =>
  new Promise<number>((ok) =>
    http.get({ port, path: '/api/cart', headers }, (r) => {
      r.resume();
      r.on('end', () => ok(r.statusCode ?? 0));
    }),
  );

const ms = (hr: [number, number]) => hr[0] * 1e3 + hr[1] / 1e6 - T0;
const toStand = (s: ReadableSpan): StandSpan => ({
  service: String(s.resource.attributes['service.name']),
  name: s.name,
  kind: SpanKind[s.kind] as StandSpan['kind'],
  traceId: s.spanContext().traceId,
  spanId: s.spanContext().spanId,
  parentSpanId: s.parentSpanContext?.spanId ?? null,
  start: ms(s.startTime),
  end: ms(s.endTime),
  status: SpanStatusCode[s.status.code] as StandSpan['status'],
  attributes: s.attributes as StandSpan['attributes'],
  events: s.events.map((e) => ({
    name: e.name,
    time: ms(e.time),
    attributes: Object.fromEntries(Object.entries(e.attributes ?? {}).filter(([k]) => k !== 'exception.stacktrace')) as StandSpan['attributes'],
  })),
});

interface Run {
  traceId: string;
  status: number;
  hops: Hop[];
  spans: StandSpan[];
  raw: ReadableSpan[];
  logs: LogLine[];
}

async function run(scenario: string, p: Plan, sampled: boolean): Promise<Run> {
  plan = p;
  now = 0;
  ids.scenario = scenario;
  ids.n = 0;
  ids.traceId = traceIdFor(scenario, sampled);
  exporter.reset();
  logs.length = 0;
  hops.length = 0;
  const w = tWeb.startSpan('GET /api/cart', { kind: SpanKind.CLIENT, startTime: T0, attributes: { 'http.request.method': 'GET', 'server.address': 'api', 'url.path': '/api/cart' } }, ROOT_CONTEXT);
  const headers: Record<string, string> = {};
  propagator.inject(trace.setSpan(ROOT_CONTEXT, w), headers, defaultTextMapSetter);
  const status = await get(apiPort, headers);
  w.setAttribute('http.response.status_code', status);
  if (status >= 500) {
    w.setStatus({ code: SpanStatusCode.ERROR });
    now = plan.webEnd;
    log('web', 'error', `cart load failed: HTTP ${status}`, w);
  }
  w.end(T0 + plan.webEnd);
  const raw = exporter.getFinishedSpans();
  return { traceId: ids.traceId, status, hops: [...hops], spans: raw.map(toStand), raw: [...raw], logs: [...logs] };
}

const runs: Record<string, Run> = {};
let invalid: { traceId: string; parentSpanId: string | null };

beforeAll(async () => {
  await new Promise<void>((r) => stock.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  stockPort = (stock.address() as AddressInfo).port;
  apiPort = (api.address() as AddressInfo).port;
  runs.ok = await run('ok', OK, true);
  runs.error = await run('error', FAIL, true);
  runs.unsampled = await run('unsampled', FAIL, false);

  plan = OK;
  ids.scenario = 'invalid';
  ids.n = 0;
  ids.traceId = traceIdFor('invalid', true);
  exporter.reset();
  await get(apiPort, { traceparent: t.INVALID_HEADER });
  const s = exporter.getFinishedSpans().find((x) => x.name === 'GET /api/cart')!;
  invalid = { traceId: s.spanContext().traceId, parentSpanId: s.parentSpanContext?.spanId ?? null };
}, 30_000);

afterAll(() => {
  api.close();
  stock.close();
});

// ─── Литералы стенда ──────────────────────────────────────────────────────────────────────

describe('литералы стенда совпадают с тем, что пишет SDK сейчас', () => {
  it.each(['ok', 'error', 'unsampled'])('сценарий %s: заголовки, спаны, логи', (id) => {
    const lit = t.SCENARIOS.find((s) => s.id === id)!;
    const got = runs[id];
    expect(got.traceId).toBe(lit.traceId);
    expect(got.status).toBe(lit.status);
    expect(got.hops).toEqual(lit.hops);
    expect(got.spans).toEqual(lit.spans);
    expect(got.logs).toEqual(lit.logs);
  });

  it('испорченный заголовок: api начинает новую трассу без родителя', () => {
    expect(invalid).toEqual(t.INVALID_HEADER_TRACE);
    expect(t.INVALID_HEADER.slice(3, 35).toLowerCase()).not.toBe(invalid.traceId);
    expect(t.TRACEPARENT_NOTE).toContain('29b3…1ac4');
  });

  it('вне выборки: ни одного спана, но заголовки с флагом 00 и логи с тем же trace id', () => {
    const u = runs.unsampled;
    expect(u.spans).toHaveLength(0);
    for (const h of u.hops) {
      expect(h.traceparent.endsWith('-00')).toBe(true);
      expect(h.traceparent.slice(3, 35)).toBe(u.traceId);
    }
    expect(u.logs.length).toBe(4);
    for (const l of u.logs) expect(l.trace_id).toBe(u.traceId);
  });

  it('решение сэмплера и доли в тексте — те, что считает SDK', () => {
    for (const s of t.SCENARIOS) {
      const r = ratioSampler.shouldSample(ROOT_CONTEXT, s.traceId).decision;
      expect(r === SamplingDecision.RECORD_AND_SAMPLED, s.id).toBe(s.id !== 'unsampled');
      expect(t.ratioOf(s.traceId) < t.STAND_RATIO, s.id).toBe(s.id !== 'unsampled');
    }
    expect(t.SAMPLING_FACTS[0].d).toContain('0,082');
    expect(t.SAMPLING_FACTS[0].d).toContain('0,788');
  });
});

// ─── traceparent ──────────────────────────────────────────────────────────────────────────

const SAMPLE = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
/** Таблица случаев: верные, испорченные и «будущая версия». Разбирать обязаны одинаково. */
const CASES = [
  SAMPLE,
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-03',
  '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01',
  '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01',
  'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra',
  '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra',
  'cc-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-09',
  '00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1',
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7',
  '0-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  '00-4bf92f3577b34da6a3ce929d0e0e47zz-00f067aa0ba902b7-01',
  '',
];

describe('TRACEPARENT_CODE против W3CTraceContextPropagator', () => {
  it('разбор совпадает с parseTraceParent на таблице случаев', () => {
    for (const h of CASES) {
      const mine = tp.parseTraceparent(h);
      const otel = parseTraceParent(h);
      expect(mine && { traceId: mine.traceId, spanId: mine.parentId, traceFlags: mine.flags }, h).toEqual(otel);
    }
  });

  it('на снятых заголовках разбор совпадает с extract, сборка — с inject', () => {
    const all = Object.values(runs).flatMap((r) => r.hops);
    expect(all).toHaveLength(6);
    for (const { traceparent } of all) {
      const sc = trace.getSpanContext(propagator.extract(ROOT_CONTEXT, { traceparent }, defaultTextMapGetter))!;
      const mine = tp.parseTraceparent(traceparent)!;
      expect({ traceId: mine.traceId, spanId: mine.parentId, traceFlags: mine.flags }).toEqual({
        traceId: sc.traceId,
        spanId: sc.spanId,
        traceFlags: sc.traceFlags,
      });
      expect(mine.sampled).toBe(traceparent.endsWith('-01'));

      const carrier: Record<string, string> = {};
      propagator.inject(trace.setSpanContext(ROOT_CONTEXT, sc), carrier, defaultTextMapSetter);
      expect(tp.formatTraceparent({ traceId: mine.traceId, spanId: mine.parentId, sampled: mine.sampled })).toBe(carrier.traceparent);
    }
  });

  it('parent-id в заголовке — id CLIENT-спана отправителя', () => {
    for (const id of ['ok', 'error']) {
      const r = runs[id];
      for (const h of r.hops) {
        const sender = r.spans.find((s) => s.spanId === tp.parseTraceparent(h.traceparent)!.parentId)!;
        expect(sender.service).toBe(h.from);
        expect(sender.kind).toBe('CLIENT');
        const receiver = r.spans.find((s) => s.parentSpanId === sender.spanId)!;
        expect(receiver.service).toBe(h.to);
        expect(receiver.kind).toBe('SERVER');
      }
    }
  });

  it('таблица полей в теме — из настоящего заголовка', () => {
    expect(t.HEADER_EXAMPLE).toBe(`traceparent: ${runs.error.hops[0].traceparent}`);
    expect(t.TRACEPARENT_PARTS.map((p) => p.k)).toEqual(['version', 'trace-id', 'parent-id', 'trace-flags']);
  });
});

// ─── Дерево ───────────────────────────────────────────────────────────────────────────────

describe('TREE_CODE против спанов SDK', () => {
  it('у каждого узла родитель — тот, что записал SDK; корень — спан браузера', () => {
    for (const id of ['ok', 'error']) {
      const r = runs[id];
      const roots = tree.buildTree(r.spans);
      expect(roots).toHaveLength(1);
      const rootRaw = r.raw.find((s) => !s.parentSpanContext)!;
      expect(roots[0].spanId).toBe(rootRaw.spanContext().spanId);
      expect(roots[0].service).toBe('web');

      const rows = tree.waterfall(roots);
      expect(rows).toHaveLength(r.raw.length);
      const parentOf = new Map<string, string | null>();
      const visit = (n: (typeof roots)[number], parent: string | null) => {
        parentOf.set(n.spanId, parent);
        n.children.forEach((c) => visit(c, n.spanId));
      };
      roots.forEach((n) => visit(n, null));
      for (const s of r.raw) {
        expect(parentOf.get(s.spanContext().spanId)).toBe(s.parentSpanContext?.spanId ?? null);
      }
      // Дети упорядочены по времени начала.
      for (const row of rows) {
        const starts = row.span.children.map((c) => c.start);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      }
    }
  });

  it('водопад успешного запроса — по глубине и порядку начала', () => {
    const rows = tree.waterfall(tree.buildTree(runs.ok.spans));
    expect(rows.map((r) => `${r.depth} ${r.span.service} ${r.span.name}`)).toEqual([
      '0 web GET /api/cart',
      '1 api GET /api/cart',
      '2 api auth.check',
      '2 api GET /stock',
      '3 stock GET /stock',
      '4 stock SELECT stock',
      '2 api render cart',
    ]);
  });

  it('спаны пришли из экспортёра детьми вперёд — порядок в теме тот же', () => {
    const names = runs.ok.spans.map((s) => s.name);
    expect(names[0]).toBe('auth.check');
    expect(runs.ok.spans.at(-1)!.parentSpanId).toBeNull();
    expect(t.EXPORT_ORDER_CODE.split('\n')).toHaveLength(runs.ok.spans.length);
    expect(t.EXPORT_ORDER_CODE.split('\n')[0]).toContain('auth.check');
  });

  it('спан без родителя в списке становится «сиротой»', () => {
    const withoutApiServer = runs.error.spans.filter((s) => !(s.service === 'api' && s.kind === 'SERVER'));
    const rows = tree.waterfall(tree.buildTree(withoutApiServer));
    const roots = rows.filter((r) => r.depth === 0);
    expect(roots.map((r) => [r.span.name, r.orphan])).toEqual([
      ['GET /api/cart', false],
      ['auth.check', true],
      ['GET /stock', true],
    ]);
  });
});

// ─── Утверждения текста о трассах ─────────────────────────────────────────────────────────

describe('числа в тексте — со стенда', () => {
  it('ошибка: шесть спанов, пять с ошибкой, SELECT stock с exception', () => {
    const e = runs.error;
    expect(e.spans).toHaveLength(6);
    expect(e.spans.filter((s) => s.status === 'ERROR')).toHaveLength(5);
    expect(t.INCIDENT_CARDS[2].d).toContain('6 спанов, 5 из них');
    const db = e.spans.find((s) => s.name === 'SELECT stock')!;
    expect(db.end - db.start).toBe(1000);
    expect(db.events.map((x) => x.name)).toEqual(['exception']);
    expect(t.INCIDENT_CARDS[1].d).toContain('1,024 с');
    expect(e.logs).toHaveLength(4);
    expect(new Set(e.logs.map((l) => l.service)).size).toBe(3);
  });

  it('успех: 124 мс, SELECT stock — больше половины', () => {
    const ok = runs.ok;
    const root = ok.spans.find((s) => s.parentSpanId === null)!;
    expect(root.end - root.start).toBe(124);
    const db = ok.spans.find((s) => s.name === 'SELECT stock')!;
    expect((db.end - db.start) * 2).toBeGreaterThan(124);
    expect(t.SCENARIOS[0].note).toContain('124 мс');
  });

  it('ошибочные статусы — у SERVER 5xx; спаны без проблем остаются UNSET', () => {
    for (const s of runs.ok.spans) expect(s.status).toBe('UNSET');
  });
});

// ─── Метрики ──────────────────────────────────────────────────────────────────────────────

describe('STATS_CODE и утверждения про перцентили', () => {
  const sets = { even: t.LATENCY_EVEN, tail: t.LATENCY_TAIL };

  it('оба набора — тысяча значений, среднее ровно 100', () => {
    for (const v of Object.values(sets)) {
      expect(v).toHaveLength(1000);
      expect(stats.mean(v)).toBe(100);
    }
  });

  it('percentile — определение ближайшего ранга', () => {
    for (const v of Object.values(sets)) {
      for (const q of [0.5, 0.9, 0.95, 0.99, 1]) {
        const p = stats.percentile(v, q);
        expect(v.filter((x) => x <= p).length).toBeGreaterThanOrEqual(q * v.length);
        expect(v.filter((x) => x < p).length).toBeLessThan(q * v.length);
      }
    }
    expect(stats.percentile([5, 1, 3], 0)).toBe(1);
    expect(stats.percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it('числа в тексте: p99 120 и 590, «среднее p99» 355, p99 вместе 580, оценка ≈725', () => {
    const p99e = stats.percentile(t.LATENCY_EVEN, 0.99);
    const p99t = stats.percentile(t.LATENCY_TAIL, 0.99);
    expect([p99e, p99t]).toEqual([120, 590]);
    expect((p99e + p99t) / 2).toBe(355);
    expect(stats.percentile([...t.LATENCY_EVEN, ...t.LATENCY_TAIL], 0.99)).toBe(580);
    const counts = stats.bucketCounts(t.LATENCY_TAIL, t.OTEL_DEFAULT_BOUNDS);
    const est = stats.percentileFromBuckets(t.OTEL_DEFAULT_BOUNDS, counts, 0.99);
    expect(Math.round(est)).toBe(725);
    expect(counts[t.OTEL_DEFAULT_BOUNDS.indexOf(750)]).toBe(99);
    expect(t.PERCENTILE_FACTS[0].d).toContain('580');
    expect(t.PERCENTILE_FACTS[1].d).toContain('около 725');
  });

  it('сумма гистограмм двух подов = гистограмма всех запросов', () => {
    const a = stats.bucketCounts(t.LATENCY_EVEN, t.OTEL_DEFAULT_BOUNDS);
    const b = stats.bucketCounts(t.LATENCY_TAIL, t.OTEL_DEFAULT_BOUNDS);
    const all = stats.bucketCounts([...t.LATENCY_EVEN, ...t.LATENCY_TAIL], t.OTEL_DEFAULT_BOUNDS);
    expect(a.map((x, i) => x + b[i])).toEqual(all);
  });

  it('оценка по корзинам лежит внутри корзины точного перцентиля', () => {
    const B = t.OTEL_DEFAULT_BOUNDS;
    for (const v of Object.values(sets)) {
      const counts = stats.bucketCounts(v, B);
      expect(counts).toHaveLength(16);
      for (const q of [0.5, 0.9, 0.95, 0.99]) {
        const exact = stats.percentile(v, q);
        const i = B.findIndex((b) => exact <= b);
        const est = stats.percentileFromBuckets(B, counts, q);
        expect(est).toBeGreaterThan(i === 0 ? -Infinity : B[i - 1]);
        expect(est).toBeLessThanOrEqual(B[i]);
      }
    }
  });

  it('секунды в корзинах по умолчанию: почти всё в (0, 5]', () => {
    const counts = stats.bucketCounts(t.LATENCY_TAIL.map((x) => x / 1000), t.OTEL_DEFAULT_BOUNDS);
    expect(counts[1]).toBe(1000);
    expect(t.BUCKETS_NOTE).toContain('`(0, 5]`');
  });

  it('METRICS_CODE исполняется против API OpenTelemetry; имя — из соглашений', () => {
    expect(() => new Function('metrics', t.METRICS_CODE)(metrics)).not.toThrow();
    expect(t.METRICS_CODE).toContain(`'${METRIC_HTTP_SERVER_REQUEST_DURATION}'`);
  });

  it('кардинальность: метки перемножаются', () => {
    expect(t.SERIES_PER_HISTOGRAM).toBe(18);
    let combos = 1;
    const want = [4, 48, 240, 12_000_000];
    t.CARDINALITY_ROWS.forEach((r, i) => {
      combos *= r.values;
      expect(combos).toBe(want[i]);
      expect(t.CARDINALITY_TABLE[i].n).toBe(want[i]);
      expect(t.CARDINALITY_TABLE[i].series).toBe((want[i] * 18).toLocaleString('ru-RU'));
    });
  });
});
