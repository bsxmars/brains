/** «База» темы: три таблицы. Сняты стендом, лежат в `data.ts` темы как `TABLES`. */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  city: string;
  avatarUrl: string;
  bio: string;
  createdAt: string;
}

export interface ProductRow {
  id: string;
  title: string;
  price: number;
  stock: number;
  imageUrl: string;
  description: string;
}

export interface OrderRow {
  id: string;
  authorId: string;
  status: string;
  createdAt: string;
  items: { productId: string; qty: number }[];
}

export interface Tables {
  users: UserRow[];
  products: ProductRow[];
  orders: OrderRow[];
}

/** Строки кода темы, из которых собирается `Api`. Порядок склейки задаёт `loadApi`. */
export interface ApiCodes {
  schema: string;
  loader: string;
  resolvers: string;
  gql: string;
  rest: string;
  proto: string;
}

export type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: unknown, info?: unknown) => unknown;
export type ResolverMap = Record<string, Record<string, Resolver>>;
/** Схема учебного исполнителя: тип → поле → тип поля (`'[Order]'`, `'User'`, `'Int'`). */
export type MiniSchema = Record<string, Record<string, string>>;

export interface ParsedField {
  name: string;
  args: Record<string, unknown>;
  fields: ParsedField[] | null;
}

export interface GqlError {
  message: string;
  path?: (string | number)[];
}

export interface GqlResult {
  data?: unknown;
  errors?: GqlError[];
}

export interface Db {
  [method: string]: (...args: never[]) => Promise<unknown>;
}

export interface ProtoField {
  at: number;
  field: number;
  wire: number;
  value?: number;
  from?: number;
  end: number;
}

/** То, что объявляют строки кода темы. */
export interface Api {
  schema: MiniSchema;
  parse(source: string): ParsedField[];
  depthOf(fields: ParsedField[] | null): number;
  execute(args: {
    schema: MiniSchema;
    resolvers: ResolverMap;
    source: string;
    context: unknown;
    maxDepth?: number;
  }): Promise<GqlResult>;
  createLoader<K, V>(batchFn: (keys: K[]) => Promise<V[]>): { load(key: K): Promise<V> };
  createDb(tables: Tables, journal: string[]): Db;
  resolvers: ResolverMap;
  createContext(db: Db, batch: boolean): unknown;
  ROUTES: [RegExp, (db: Tables, arg: string) => unknown][];
  route(db: Tables, url: string): unknown;
  loadScreenRest(get: (path: string) => Promise<unknown>): Promise<unknown[]>;
  PROTO: Record<string, [number, string, string, string?][]>;
  varint(n: number): number[];
  encode(schema: Api['PROTO'], type: string, msg: unknown): number[];
  decodeRaw(bytes: number[], start?: number, end?: number): ProtoField[];
  grpcWebFrame(flag: number, bytes: number[]): number[];
  grpcWebResponse(message: number[]): number[];
}

/** Один запрос экрана: шаг водопада, адрес и длины тел в UTF-8. */
export interface WireRequest {
  step: number;
  method: 'GET' | 'POST';
  path: string;
  up: number;
  down: number;
}

/** Прогон резолверов: ответ, журнал «базы» и вызовы резолверов со своей функцией. */
export interface ResolverRun {
  result: GqlResult;
  journal: string[];
  calls: string[];
}

/** Сценарий демо резолверов — `DEMO_SCENARIOS` в `data.ts` темы. */
export interface ResolverScenario {
  id: string;
  label: string;
  query: string;
  fail: boolean;
  /** Предел глубины; нет — без предела. */
  maxDepth?: number;
  note: string;
}

/** Байт сообщения protobuf с ролью: ключ поля, длина, данные. */
export interface ByteSpan {
  hex: string;
  role: 'key' | 'len' | 'data';
  /** Имя поля по схеме: `author.name`. */
  field: string;
}
