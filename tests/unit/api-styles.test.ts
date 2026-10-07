import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { buildSchema, graphql, parse as gqlParse, type GraphQLSchema, type SelectionSetNode } from 'graphql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/api-styles/data';
import {
  annotateProto,
  loadApi,
  runResolvers,
  selectedFields,
  traced,
  wireGraphql,
  wireGrpc,
  wireRest,
} from '@/widgets/api-wire-lab/model/run';
import type { Api, ResolverMap } from '@/widgets/api-wire-lab/model/types';

/**
 * Тема «REST, GraphQL и gRPC-web: что ходит по проводу».
 *
 * Строки кода темы (`SCHEMA_CODE`, `LOADER_CODE`, `RESOLVERS_CODE`, `GQL_CODE`, `REST_CODE`,
 * `PROTO_CODE`) напечатаны на странице и исполняются демо. Здесь:
 *   — учебный `execute` сверяется с `graphql` 17: тот же ответ байт в байт, те же вызовы резолверов
 *     в том же порядке, тот же журнал «базы» — на запросе экрана, на глубоких запросах и при сбое;
 *   — литералы стенда (журналы, таблица глубины, байты экрана, APQ) пересобираются: байты —
 *     сервером на `node:http` и сырыми сокетами, как на стенде;
 *   — `encode` сверяется с примерами спецификации protobuf и разбирается обратно.
 * Снятое в Chromium (второй заход, трейлеры) здесь не пересобирается — см. шапку `data.ts`.
 */

const api: Api = loadApi({
  schema: t.SCHEMA_CODE,
  loader: t.LOADER_CODE,
  resolvers: t.RESOLVERS_CODE,
  gql: t.GQL_CODE,
  rest: t.REST_CODE,
  proto: t.PROTO_CODE,
});

const utf8 = (s: string) => Buffer.byteLength(s);
const hex = (a: number[]) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');

/** Схема graphql-js из `SDL` с резолверами темы — те же функции, что у учебного исполнителя. */
function gqlSchema(resolvers: ResolverMap, sdl = t.SDL): GraphQLSchema {
  const schema = buildSchema(sdl);
  for (const [type, fields] of Object.entries(resolvers)) {
    const target = schema.getType(type) as unknown as { getFields(): Record<string, { resolve?: unknown }> };
    for (const [name, fn] of Object.entries(fields)) target.getFields()[name].resolve = fn;
  }
  return schema;
}

interface Opts {
  batch: boolean;
  query?: string;
  fail?: boolean;
  sdl?: string;
}

async function viaGraphqlJs({ batch, query = t.SCREEN_QUERY, fail = false, sdl }: Opts) {
  const journal: string[] = [];
  const calls: string[] = [];
  const db = api.createDb(t.TABLES, journal);
  if (fail) new Function('db', t.FAIL_CODE)(db);
  const result = await graphql({
    schema: gqlSchema(traced(api.resolvers, calls), sdl),
    source: query,
    contextValue: api.createContext(db, batch),
  });
  return { result: JSON.parse(JSON.stringify(result)) as { data?: unknown; errors?: { message: string; path: (string | number)[] }[] }, journal, calls };
}

async function viaMini({ batch, query = t.SCREEN_QUERY, fail = false }: Opts) {
  const run = await runResolvers(api, t.TABLES, { query, batch, failCode: fail ? t.FAIL_CODE : undefined });
  return { ...run, result: JSON.parse(JSON.stringify(run.result)) as typeof run.result };
}

const deepQuery = (levels: number) => {
  let q = 'name';
  for (let i = 0; i < levels; i++) q = `orders { author { ${q} } }`;
  return `{ ${q.replace(/^orders/, 'orders(first: 5)')} }`;
};

describe('схема: SDL и объект учебного исполнителя — одно и то же', () => {
  it('у каждого типа те же поля тех же типов', () => {
    const schema = buildSchema(t.SDL);
    for (const [type, fields] of Object.entries(api.schema)) {
      const real = (schema.getType(type) as unknown as { getFields(): Record<string, { type: unknown }> }).getFields();
      expect(Object.fromEntries(Object.entries(real).map(([k, f]) => [k, String(f.type)])), type).toEqual(fields);
    }
    expect(Object.keys(api.schema).sort()).toEqual(['Item', 'Order', 'Product', 'Query', 'User']);
  });
});

describe('GQL_CODE против graphql 17', () => {
  const cases: [string, Opts][] = [
    ['экран без загрузчика', { batch: false }],
    ['экран с загрузчиком', { batch: true }],
    ['сбой без загрузчика', { batch: false, fail: true }],
    ['сбой с загрузчиком', { batch: true, fail: true }],
    ...[1, 2, 3, 4, 5, 6].flatMap((k): [string, Opts][] => [
      [`глубина, уровней ${k}`, { batch: false, query: deepQuery(k) }],
      [`глубина, уровней ${k}, загрузчик`, { batch: true, query: deepQuery(k) }],
    ]),
  ];

  for (const [name, opts] of cases) {
    it(`${name}: тот же ответ, те же резолверы в том же порядке, тот же журнал базы`, async () => {
      const real = await viaGraphqlJs(opts);
      const mini = await viaMini(opts);
      // У graphql-js в ошибке ещё `locations`; учебный исполнитель их не считает.
      const { errors, data } = real.result;
      const expected = errors ? { errors: errors.map(({ message, path }) => ({ message, path })), data } : { data };
      expect(JSON.stringify(mini.result)).toBe(JSON.stringify(expected));
      expect(mini.calls).toEqual(real.calls);
      expect(mini.journal).toEqual(real.journal);
    });
  }

  it('глубина по учебному parse совпадает с глубиной дерева graphql-js', () => {
    const depth = (set: SelectionSetNode | undefined): number =>
      set ? 1 + Math.max(...set.selections.map((s) => depth('selectionSet' in s ? s.selectionSet : undefined))) : 0;
    for (const q of [t.SCREEN_QUERY, ...[1, 2, 3, 4, 5, 6].map(deepQuery)]) {
      const doc = gqlParse(q);
      const op = doc.definitions[0] as { selectionSet: SelectionSetNode };
      expect(api.depthOf(api.parse(q))).toBe(depth(op.selectionSet));
    }
  });

  it('аргументы: first доходит до резолвера числом', async () => {
    const journal: string[] = [];
    await api.execute({ schema: api.schema, resolvers: api.resolvers, source: '{ orders(first: 2) { id } }', context: api.createContext(api.createDb(t.TABLES, journal), false) });
    expect(journal).toEqual(['orders(2)']);
  });
});

describe('N+1 и загрузчик — литералы темы', () => {
  it('журналы «базы» без загрузчика и с ним — как напечатаны', async () => {
    const naive = await viaGraphqlJs({ batch: false });
    const batched = await viaGraphqlJs({ batch: true });
    expect(naive.journal.join('\n')).toBe(t.N1_JOURNAL);
    expect(batched.journal.join('\n')).toBe(t.BATCH_JOURNAL);
    expect(naive.journal).toHaveLength(16);
    expect(batched.journal).toHaveLength(3);
    expect(naive.calls).toHaveLength(16);
    expect(batched.calls).toHaveLength(16);
    expect(t.GQL_NOTE).toContain('те же 16 резолверов');
    expect(t.BATCH_NOTE).toContain('Резолверов по-прежнему 16');
  });

  it('загрузчик: один вызов на тик, повтор ключа берётся из кеша', async () => {
    const seen: string[][] = [];
    const loader = api.createLoader((keys: string[]) => {
      seen.push(keys);
      return Promise.resolve(keys.map((k) => k.toUpperCase()));
    });
    const values = await Promise.all(['a', 'b', 'a', 'c'].map((k) => loader.load(k)));
    expect(values).toEqual(['A', 'B', 'A', 'C']);
    expect(seen).toEqual([['a', 'b', 'c']]);
  });

  it('сбой: ответ с data и пятью ошибками, порядок путей — как напечатан', async () => {
    const { result } = await viaGraphqlJs({ batch: true, fail: true });
    const paths = result.errors!.map((e) => e.path[1]);
    expect(paths).toEqual([0, 2, 1, 4, 3]);
    expect(t.FAIL_RESPONSE).toContain('"path": ["orders", 0, "author"]');
    expect(t.FAIL_RESPONSE).toContain('"path": ["orders", 2, "author"]');
    expect(t.FAIL_RESPONSE).toContain('ещё 3: заказы 1, 4, 3');
    expect((result.data as { orders: { author: unknown }[] }).orders.every((o) => o.author === null)).toBe(true);
    // Без загрузчика каждая ошибка — своя, и все пять — тоже у author.
    const naive = await viaGraphqlJs({ batch: false, fail: true });
    expect(naive.result.errors).toHaveLength(5);
  });

  it('с author: User! null уходит выше — пропадают целые заказы', async () => {
    const { result } = await viaGraphqlJs({ batch: true, fail: true, sdl: t.SDL.replace('author: User', 'author: User!') });
    expect(JSON.stringify(result.data)).toBe(t.NONNULL_DATA);
    expect(t.NONNULL_DATA).toBe('{"orders":[null,null,null,null,null]}');
  });

  it('предел глубины отказывает до первого резолвера', async () => {
    const limit = t.DEMO_SCENARIOS.find((s) => s.id === 'limit')!;
    const run = await runResolvers(api, t.TABLES, { query: limit.query, batch: false, maxDepth: limit.maxDepth });
    expect(run.calls).toEqual([]);
    expect(run.journal).toEqual([]);
    expect(run.result.errors).toHaveLength(1);
    expect(run.result.data).toBeUndefined();
  });

  it('таблица глубины пересчитывается graphql 17', async () => {
    const rows = [];
    for (let k = 1; k <= 6; k++) {
      const q = deepQuery(k);
      const r = await viaGraphqlJs({ batch: false, query: q });
      rows.push({ levels: k, depth: api.depthOf(api.parse(q)), query: utf8(JSON.stringify({ query: q })), resolvers: r.calls.length, response: utf8(JSON.stringify(r.result)) });
    }
    expect(rows).toEqual(t.DEPTH_ROWS);
    expect(t.DEMO_SCENARIOS.find((s) => s.id === 'deep')!.query).toBe(deepQuery(4));
    expect(t.DEPTH_ROWS[3].query).toBe(118);
    expect(t.DEPTH_ROWS[1].query - t.DEPTH_ROWS[0].query).toBe(22);
  });
});

// ─── Байты: сервер стенда на node:http и сырые сокеты ───────────────────────────────────────

const etagOf = (buf: Buffer) => `"${createHash('sha1').update(buf).digest('base64url').slice(0, 16)}"`;
const apq = new Map<string, string>();

/** Тот же сервер, что на стенде: заголовки и их порядок влияют на число байт. */
function makeServer(): Server {
  return createServer((req, res) => {
    res.sendDate = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const send = (status: number, headers: Record<string, string>, payload: Buffer | string) => {
        const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        res.writeHead(status, { ...headers, 'Content-Length': buf.length });
        res.end(buf);
      };
      const url = req.url ?? '';
      if (req.method === 'GET' && url.startsWith('/api/')) {
        const buf = Buffer.from(JSON.stringify(api.route(t.TABLES, url)));
        const cc = url.startsWith('/api/orders') ? 'private, no-cache' : 'public, max-age=60';
        return send(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cc, ETag: etagOf(buf) }, buf);
      }
      if (url.startsWith('/graphql')) {
        let query: string | undefined;
        if (req.method === 'POST') {
          const json = JSON.parse(body.toString()) as { query?: string; extensions?: { persistedQuery?: { sha256Hash: string } } };
          const hash = json.extensions?.persistedQuery?.sha256Hash;
          query = json.query;
          if (hash && query) apq.set(hash, query);
        } else {
          const ext = JSON.parse(new URL(url, 'http://x').searchParams.get('extensions') ?? '{}') as { persistedQuery?: { sha256Hash: string } };
          query = apq.get(ext.persistedQuery?.sha256Hash ?? '');
          if (!query) {
            return send(200, { 'Content-Type': 'application/graphql-response+json; charset=utf-8', 'Cache-Control': 'no-store' }, JSON.stringify({ errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] }));
          }
        }
        const { result } = await viaGraphqlJs({ batch: true, query });
        const buf = Buffer.from(JSON.stringify(result));
        const h: Record<string, string> = { 'Content-Type': 'application/graphql-response+json; charset=utf-8' };
        if (req.method === 'GET') Object.assign(h, { 'Cache-Control': 'public, max-age=60', ETag: etagOf(buf) });
        return send(200, h, buf);
      }
      if (url === '/shop.OrderService/ListOrders') {
        const first = api.decodeRaw([...body], 5).find((f) => f.field === 1)?.value ?? 0;
        const { result } = await viaGraphqlJs({ batch: true, query: `{ orders(first: ${first}) { id status author { name } items { qty product { title price } } } }` });
        return send(200, { 'Content-Type': 'application/grpc-web+proto' }, Buffer.from(api.grpcWebResponse(api.encode(api.PROTO, 'ListOrdersResponse', result.data))));
      }
      send(404, {}, '');
    });
  });
}

let server: Server;
let port = 0;

function raw(method: string, path: string, headers: Record<string, string> = {}, body = Buffer.alloc(0)) {
  const head = [
    `${method} ${path} HTTP/1.1`,
    'Host: shop.example',
    ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
    ...(body.length ? [`Content-Length: ${body.length}`] : []),
    'Connection: close',
    '',
    '',
  ].join('\r\n');
  const req = Buffer.concat([Buffer.from(head), body]);
  return new Promise<{ up: number; down: number; head: string; body: Buffer }>((resolve) => {
    const s = connect(port, '127.0.0.1', () => s.write(req));
    const chunks: Buffer[] = [];
    s.on('data', (d: Buffer) => chunks.push(d));
    s.on('end', () => {
      const all = Buffer.concat(chunks);
      const i = all.indexOf('\r\n\r\n');
      resolve({ up: req.length, down: all.length, head: all.subarray(0, i).toString(), body: all.subarray(i + 4) });
    });
  });
}

beforeAll(async () => {
  server = makeServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('один экран тремя способами — байты', () => {
  it('REST и GraphQL собирают один и тот же экран', async () => {
    const rest = await wireRest(api, t.TABLES);
    const gql = await viaGraphqlJs({ batch: true });
    expect(rest.screen).toEqual((gql.result.data as { orders: unknown[] }).orders);
    expect(JSON.stringify(rest.screen[0], null, 2)).toBe(t.SCREEN_FIRST);
    expect(t.WIRE_NOTE).toContain(`Данных для экрана — ${utf8(JSON.stringify(rest.screen))} байт`);
  });

  it('тела запросов и ответов в демо — как в таблице', async () => {
    const rest = await wireRest(api, t.TABLES);
    const gql = await wireGraphql(api, t.TABLES, t.SCREEN_QUERY);
    const grpc = wireGrpc(api, rest.screen);
    const sum = (rs: { up: number; down: number }[], k: 'up' | 'down') => rs.reduce((s, r) => s + r[k], 0);
    const [r, g, w] = t.WIRE_ROWS;
    expect([rest.requests.length, Math.max(...rest.requests.map((q) => q.step)), sum(rest.requests, 'up'), sum(rest.requests, 'down')]).toEqual([r.requests, r.steps, r.upBody, r.downBody]);
    expect(rest.requests.filter((q) => q.step === 1).map((q) => q.path)).toEqual(['/api/orders?limit=5']);
    expect([gql.requests[0].up, gql.requests[0].down]).toEqual([g.upBody, g.downBody]);
    expect([grpc.requests[0].up, grpc.requests[0].down]).toEqual([w.upBody, w.downBody]);
  });

  it('по сырому сокету: запросы, ответы и заголовки — как в таблице', async () => {
    const rest: { up: number; down: number; body: number }[] = [];
    await api.loadScreenRest(async (path) => {
      const res = await raw('GET', path, { Accept: 'application/json' });
      rest.push({ up: res.up, down: res.down, body: res.body.length });
      return JSON.parse(res.body.toString()) as unknown;
    });
    const gqlBody = Buffer.from(JSON.stringify({ query: t.SCREEN_QUERY }));
    const g = await raw('POST', '/graphql', { 'Content-Type': 'application/json', Accept: 'application/graphql-response+json' }, gqlBody);
    const reqMsg = Buffer.from(api.grpcWebFrame(0, api.encode(api.PROTO, 'ListOrdersRequest', { first: 5 })));
    const w = await raw('POST', '/shop.OrderService/ListOrders', { 'Content-Type': 'application/grpc-web+proto', 'X-Grpc-Web': '1' }, reqMsg);
    const sum = (k: 'up' | 'down' | 'body') => rest.reduce((s, x) => s + x[k], 0);
    expect(t.WIRE_ROWS).toEqual([
      { k: 'REST', requests: rest.length, steps: 2, upBody: 0, downBody: sum('body'), up: sum('up'), down: sum('down') },
      { k: 'GraphQL', requests: 1, steps: 1, upBody: gqlBody.length, downBody: g.body.length, up: g.up, down: g.down },
      { k: 'gRPC-web', requests: 1, steps: 1, upBody: reqMsg.length, downBody: w.body.length, up: w.up, down: w.down },
    ]);
  });

  it('over-fetching: доля лишнего в текстах совпадает с расчётом', async () => {
    const { screen } = await wireRest(api, t.TABLES);
    const share = Math.round((1 - utf8(JSON.stringify(screen)) / t.WIRE_ROWS[0].downBody) * 100);
    expect(t.REST_FACTS[2].t).toContain(`${share}%`);
    expect(selectedFields(api, t.SCREEN_QUERY, 'User')).toEqual(['name']);
    expect(selectedFields(api, t.SCREEN_QUERY, 'Product')).toEqual(['title', 'price']);
    expect(Object.keys(t.TABLES.users[0])).toHaveLength(7);
    expect(Object.keys(t.TABLES.products[0])).toHaveLength(6);
  });

  it('persisted query: промах, регистрация, GET с ETag; хеш и размеры — как в теме', async () => {
    const hash = createHash('sha256').update(t.SCREEN_QUERY).digest('hex');
    expect(t.APQ_HASH).toBe(hash);
    const ext = encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: hash } }));
    const miss = await raw('GET', `/graphql?extensions=${ext}`, { Accept: 'application/graphql-response+json' });
    expect(t.APQ_CODE).toContain(miss.body.toString());
    await raw('POST', '/graphql', { 'Content-Type': 'application/json' }, Buffer.from(JSON.stringify({ query: t.SCREEN_QUERY, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } })));
    const hit = await raw('GET', `/graphql?extensions=${ext}`, { Accept: 'application/graphql-response+json' });
    expect(t.APQ_CODE).toContain(`ETag: ${/ETag: (.*)/.exec(hit.head)![1]}`);
    expect(t.APQ_CODE).toContain(hash.slice(0, 12));
    expect(t.APQ_FACTS[0].d).toContain(`${hit.up} байта`);
    expect(t.APQ_FACTS[0].d).toContain(`— ${t.WIRE_ROWS[1].up}.`);
  });
});

describe('PROTO_CODE: protobuf по спецификации', () => {
  it('примеры из спецификации «Encoding» кодируются байт в байт', () => {
    const schema = { Test1: [[1, 'a', 'int32']], Test2: [[2, 'b', 'string']], Test3: [[3, 'c', 'Test1']] } as Api['PROTO'];
    expect(hex(api.encode(schema, 'Test1', { a: 150 }))).toBe(t.PROTO_VECTORS[0].bytes);
    expect(hex(api.encode(schema, 'Test2', { b: 'testing' }))).toBe(t.PROTO_VECTORS[1].bytes);
    expect(hex(api.encode(schema, 'Test3', { c: { a: 150 } }))).toBe(t.PROTO_VECTORS[2].bytes);
    expect(api.varint(150)).toEqual([0x96, 0x01]);
    expect(api.varint(127)).toHaveLength(1);
    expect(api.varint(16383)).toHaveLength(2);
    expect(api.varint(16384)).toHaveLength(3);
  });

  it('PROTO совпадает с файлом .proto в теме', () => {
    const parsed: Record<string, [number, string, string, string?][]> = {};
    for (const [, name, body] of t.PROTO_FILE.matchAll(/message (\w+) \{([^}]*)\}/g)) {
      parsed[name] = [...body.matchAll(/(repeated )?(\w+) (\w+) = (\d+);/g)].map(([, rep, type, field, num]) =>
        rep ? [Number(num), field, type, 'repeated'] : [Number(num), field, type],
      );
    }
    expect(parsed).toEqual(api.PROTO);
  });

  it('ответ экрана разбирается обратно по схеме в тот же объект', async () => {
    const { screen } = await wireRest(api, t.TABLES);
    const bytes = api.encode(api.PROTO, 'ListOrdersResponse', { orders: screen });
    const decode = (type: string, from: number, end: number): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const f of api.decodeRaw(bytes, from, end)) {
        const [, name, kind, rule] = api.PROTO[type].find((d) => d[0] === f.field)!;
        const value =
          f.wire === 0 ? f.value : kind === 'string' ? Buffer.from(bytes.slice(f.from, f.end)).toString() : decode(kind, f.from!, f.end);
        if (rule === 'repeated') ((out[name] ??= []) as unknown[]).push(value);
        else out[name] = value;
      }
      return out;
    };
    expect(decode('ListOrdersResponse', 0, bytes.length)).toEqual({ orders: screen });
  });

  it('байты первого заказа, их состав и размеры со сжатием — как в теме', async () => {
    const { screen } = await wireRest(api, t.TABLES);
    const msg = api.encode(api.PROTO, 'ListOrdersResponse', { orders: screen });
    const spans = annotateProto(api, msg, 'ListOrdersResponse');
    const first = api.decodeRaw(msg)[0];
    expect(t.ORDER_BYTES[0].head).toBe(hex(msg.slice(first.at, first.from)));
    expect(t.ORDER_BYTES[0].d).toContain(`на ${first.end - first.from!} байт`);
    // Заголовки строк таблицы — ключ и длина каждого поля, по порядку, как их размечает демо.
    const heads = t.ORDER_BYTES.slice(1).map((r) => r.head);
    const fromSpans: string[] = [];
    for (let i = 2; i < first.end; ) {
      const field = spans[i].field;
      const run: string[] = [];
      while (i < first.end && spans[i].field === field && spans[i].role !== 'data') run.push(spans[i++].hex);
      if (run.length) fromSpans.push(run.join(' '));
      while (i < first.end && spans[i].role === 'data') i++;
      if (fromSpans.length === heads.length) break;
    }
    expect(fromSpans).toEqual(heads);

    const order = screen[0] as Record<string, unknown>;
    const strs: string[] = [];
    const nums: number[] = [];
    const collect = (v: unknown) => {
      if (typeof v === 'string') strs.push(v);
      else if (typeof v === 'number') nums.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(order);
    const text = strs.reduce((s, x) => s + utf8(x), 0);
    const numJ = nums.reduce((s, n) => s + String(n).length, 0);
    const numP = nums.reduce((s, n) => s + api.varint(n).length, 0);
    const json = utf8(JSON.stringify(order));
    const proto = api.encode(api.PROTO, 'Order', order).length;
    expect(t.ORDER_PARTS.map((r) => [r.json, r.proto])).toEqual([
      [text, text],
      [numJ, numP],
      [json - text - numJ, proto - text - numP],
      [json, proto],
    ]);

    const jsonData = Buffer.from(JSON.stringify({ orders: screen }));
    const protoBuf = Buffer.from(msg);
    expect(t.SIZE_ROWS).toEqual([
      { k: 'без сжатия', json: jsonData.length, proto: protoBuf.length },
      { k: 'gzip', json: gzipSync(jsonData).length, proto: gzipSync(protoBuf).length },
      { k: 'brotli', json: brotliCompressSync(jsonData).length, proto: brotliCompressSync(protoBuf).length },
    ]);
    const gap = (r: { json: number; proto: number }) => `${Math.round((1 - r.proto / r.json) * 100)}%`;
    expect(t.SIZE_NOTE).toContain(`После gzip разница ${gap(t.SIZE_ROWS[1])}, после brotli — ${gap(t.SIZE_ROWS[2])}`);
    expect(t.PITFALLS.find((p) => p.n === '08')!.d).toContain(`после gzip разница — ${gap(t.SIZE_ROWS[1])}`);
  });

  it('кадры gRPC-web: запрос 7 байт, заголовки кадров ответа — как напечатаны', async () => {
    const { screen } = await wireRest(api, t.TABLES);
    const msg = api.encode(api.PROTO, 'ListOrdersResponse', { orders: screen });
    const res = api.grpcWebResponse(msg);
    const req = api.grpcWebFrame(0, api.encode(api.PROTO, 'ListOrdersRequest', { first: 5 }));
    expect(hex(req)).toBe('00 00 00 00 02 08 05');
    expect(t.WEB_FRAME_CODE).toContain(hex(req));
    expect(t.WEB_FRAME_CODE).toContain(hex(res.slice(0, 5)));
    expect(t.WEB_FRAME_CODE).toContain(hex(res.slice(5 + msg.length, 10 + msg.length)));
    expect(Buffer.from(res.slice(10 + msg.length)).toString()).toBe('grpc-status:0\r\ngrpc-message:\r\n');
    // Тело HTTP/2-ответа на стенде трейлеров — один кадр: 5 + сообщение.
    expect(t.TRAILER_FACTS[0].d).toContain(`тело на ${5 + msg.length} байт`);
  });
});
