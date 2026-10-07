import type { Api, ApiCodes, ByteSpan, ResolverMap, ResolverRun, Tables, WireRequest } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки кода из темы «REST, GraphQL и gRPC-web».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/api-styles.test.ts`: учебный `execute` — против `graphql` 17 (ответ, порядок
 * вызовов резолверов, журнал «базы»), `encode` — против примеров спецификации protobuf,
 * байты — против сервера на сырых сокетах. Копии кода нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadApi(codes: ApiCodes): Api {
  const source = [codes.schema, codes.loader, codes.resolvers, codes.gql, codes.rest, codes.proto].join('\n');
  return new Function(
    `${source}
return { schema, parse, depthOf, execute, createLoader, createDb, resolvers, createContext,
  ROUTES, route, loadScreenRest, PROTO, varint, encode, decodeRaw, grpcWebFrame, grpcWebResponse };`,
  )() as Api;
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

/**
 * Обёртка-журнал над резолверами: `Order.author ← o1001`. Одна и та же для учебного исполнителя
 * и для graphql-js — поэтому журналы двух исполнителей можно сравнивать строка в строку.
 */
export function traced(resolvers: ResolverMap, log: string[]): ResolverMap {
  const out: ResolverMap = {};
  for (const [type, fields] of Object.entries(resolvers)) {
    out[type] = {};
    for (const [name, fn] of Object.entries(fields)) {
      out[type][name] = (parent, args, ctx, info) => {
        const id = (parent as { id?: string } | undefined)?.id;
        log.push(`${type}.${name}${id ? ` ← ${id}` : ''}`);
        return fn(parent, args, ctx, info);
      };
    }
  }
  return out;
}

/** Запрос через учебный исполнитель. `failCode` — тело функции от `db`, ломающее «базу». */
export async function runResolvers(
  api: Api,
  tables: Tables,
  opts: { query: string; batch: boolean; failCode?: string; maxDepth?: number },
): Promise<ResolverRun> {
  const journal: string[] = [];
  const calls: string[] = [];
  const db = api.createDb(tables, journal);
  if (opts.failCode) new Function('db', opts.failCode)(db);
  const result = await api.execute({
    schema: api.schema,
    resolvers: traced(api.resolvers, calls),
    source: opts.query,
    context: api.createContext(db, opts.batch),
    maxDepth: opts.maxDepth ?? Infinity,
  });
  return { result, journal, calls };
}

/** REST: клиент экрана `loadScreenRest` над маршрутами `ROUTES`. Шаг 2 — всё, что ждало ответа. */
export async function wireRest(api: Api, tables: Tables): Promise<{ requests: WireRequest[]; screen: unknown[] }> {
  const requests: WireRequest[] = [];
  let answered = 0;
  const screen = await api.loadScreenRest(async (path) => {
    const step = answered === 0 ? 1 : 2;
    const body = JSON.stringify(api.route(tables, path));
    requests.push({ step, method: 'GET', path, up: 0, down: utf8(body) });
    await Promise.resolve();
    answered++;
    return JSON.parse(body) as unknown;
  });
  return { requests, screen };
}

/** GraphQL: тело `POST` — JSON с текстом запроса; ответ — то, что вернул `execute`. */
export async function wireGraphql(
  api: Api,
  tables: Tables,
  query: string,
): Promise<{ requests: WireRequest[]; body: string; response: string }> {
  const body = JSON.stringify({ query });
  const { result } = await runResolvers(api, tables, { query, batch: true });
  const response = JSON.stringify(result);
  return { requests: [{ step: 1, method: 'POST', path: '/graphql', up: utf8(body), down: utf8(response) }], body, response };
}

/** gRPC-web: кадр с `ListOrdersRequest { first: 5 }` и ответ из кадра сообщения и кадра трейлеров. */
export function wireGrpc(api: Api, orders: unknown[]): { requests: WireRequest[]; message: number[] } {
  const request = api.grpcWebFrame(0, api.encode(api.PROTO, 'ListOrdersRequest', { first: 5 }));
  const message = api.encode(api.PROTO, 'ListOrdersResponse', { orders });
  const response = api.grpcWebResponse(message);
  return {
    requests: [{ step: 1, method: 'POST', path: '/shop.OrderService/ListOrders', up: request.length, down: response.length }],
    message,
  };
}

/** Байты сообщения с ролями — разбор `decodeRaw`, имена полей — из схемы `PROTO`. */
export function annotateProto(api: Api, bytes: number[], type: string, start = 0, end = bytes.length, prefix = ''): ByteSpan[] {
  const hex = (b: number) => b.toString(16).padStart(2, '0');
  const out: ByteSpan[] = [];
  for (const f of api.decodeRaw(bytes, start, end)) {
    const def = api.PROTO[type].find((d) => d[0] === f.field);
    const name = prefix + (def?.[1] ?? `#${f.field}`);
    // Ключ — один байт для номеров полей до 15: этого хватает схеме темы.
    out.push({ hex: hex(bytes[f.at]), role: 'key', field: name });
    if (f.wire === 0) {
      for (let i = f.at + 1; i < f.end; i++) out.push({ hex: hex(bytes[i]), role: 'data', field: name });
      continue;
    }
    const from = f.from ?? f.end;
    for (let i = f.at + 1; i < from; i++) out.push({ hex: hex(bytes[i]), role: 'len', field: name });
    if (def && api.PROTO[def[2]]) {
      out.push(...annotateProto(api, bytes, def[2], from, f.end, `${name}.`));
    } else {
      for (let i = from; i < f.end; i++) out.push({ hex: hex(bytes[i]), role: 'data', field: name });
    }
  }
  return out;
}

/** Поля типа, выбранные запросом: `Product` в запросе экрана — `title`, `price`. */
export function selectedFields(api: Api, query: string, type: string): string[] {
  const picked = new Set<string>();
  const walk = (fields: ReturnType<Api['parse']> | null, typeName: string) => {
    for (const f of fields ?? []) {
      if (typeName === type) picked.add(f.name);
      const child = api.schema[typeName]?.[f.name]?.replace(/[[\]]/g, '');
      if (child && api.schema[child]) walk(f.fields, child);
    }
  };
  walk(api.parse(query), 'Query');
  return [...picked];
}
