/**
 * Типы стенда DNS. Форма записей — та, что отдаёт `dns-packet` при разборе пакета
 * (имя без завершающей точки, корень — `'.'`), чтобы демо, тест и настоящие пакеты
 * говорили на одном языке.
 */

export interface SoaData {
  mname: string;
  rname: string;
  serial: number;
  refresh: number;
  retry: number;
  expire: number;
  minimum: number;
}

export interface MxData {
  preference: number;
  exchange: string;
}

/**
 * Запись ресурса. `data`: адрес для A/AAAA, имя для NS/CNAME, объект для SOA и MX,
 * массив строк для TXT, шестнадцатеричная строка для типа, которого `dns-packet` не знает (HTTPS).
 */
export interface DnsRecord {
  name: string;
  type: string;
  ttl: number;
  data: string | string[] | SoaData | MxData;
}

/** Зона: вершина (apex) и все записи, за которые отвечает её сервер, вместе с делегированиями и glue. */
export interface Zone {
  origin: string;
  records: DnsRecord[];
}

/** Авторитетный сервер стенда: адрес (из документационных диапазонов), имя и зоны, которые он держит. */
export interface AuthServer {
  ip: string;
  name: string;
  zones: string[];
  /** Порт на 127.0.0.1, где этот сервер слушает на стенде. */
  port: number;
}

/** Ответ сервера после разбора: флаг AA, код ответа и три секции. */
export interface DnsResponse {
  aa: boolean;
  rcode: string;
  answers: DnsRecord[];
  authorities: DnsRecord[];
  additionals: DnsRecord[];
}

/** Строка журнала резолвера: запрос к серверу или ответ из кеша. */
export interface LogEntry {
  depth: number;
  name: string;
  type: string;
  /** Адрес сервера; у попадания в кеш его нет. */
  ip?: string;
  /** Зона, от имени которой резолвер спрашивал этот сервер. */
  zone?: string;
  cache?: boolean;
  result: 'answer' | 'referral' | 'NXDOMAIN' | 'NODATA';
  /** Для делегирования: куда отправили. */
  to?: string;
  /** Для делегирования без glue: имя NS, адрес которого пришлось искать отдельно. */
  noGlue?: string;
}

export interface ResolveResult {
  rcode: string;
  answers: DnsRecord[];
}

export interface CacheEntry {
  key: string;
  records?: DnsRecord[];
  negative?: 'NXDOMAIN' | 'NODATA';
  soa?: DnsRecord;
  expires: number;
}

export interface Resolver {
  resolve(name: string, type: string): Promise<ResolveResult>;
  log: LogEntry[];
  cache: Map<string, CacheEntry>;
}

export type SendFn = (ip: string, name: string, type: string) => Promise<DnsResponse>;

export interface ResolverOptions {
  roots: string[];
  send: SendFn;
  now: () => number;
}

export type CreateResolver = (opts: ResolverOptions) => Resolver;

/** Авторитетный ответ: какой сервер, какие зоны и что спросили. */
export type AnswerFn = (zones: Zone[], name: string, type: string) => DnsResponse;

/** Запрос, который можно выбрать в демо. */
export interface DemoQuery {
  id: string;
  name: string;
  type: string;
  label: string;
}

/** Сценарий смены адреса для демо. Время — секунды от начала шкалы. */
export interface RolloutScenario {
  id: string;
  label: string;
  /** TTL записи до смены. */
  ttlBefore: number;
  /** Когда TTL понизили (до смены адреса); `null` — не понижали. */
  lowerAt: number | null;
  /** TTL после понижения и после смены. */
  ttlAfter: number;
  /** Когда сменили адрес. */
  switchAt: number;
  note: string;
}
