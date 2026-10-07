/** Файл в теле multipart: имя, тип и байты как есть. */
export interface MultipartFile {
  filename: string;
  type: string;
  bytes: Uint8Array;
}

/** Пара формы, как её принимает `encodeMultipart`: значение — строка или файл. */
export type MultipartEntry = [string, string | MultipartFile];

/** Часть тела после разбора `parseMultipart`: либо текстовое поле, либо файл. */
export type ParsedPart =
  | { name: string; value: string }
  | { name: string; filename: string; type: string; bytes: Uint8Array };

export interface MultipartApi {
  encodeMultipart(entries: MultipartEntry[], boundary: string): Uint8Array;
  parseMultipart(bytes: Uint8Array, boundary: string): ParsedPart[];
}

/** То, что принимает `handle` учебного tus-сервера. Имена заголовков — строчными. */
export interface TusRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface TusResponse {
  status: number;
  headers: Record<string, string>;
}

export interface TusServer {
  handle(req: TusRequest): TusResponse;
  uploads: Map<string, { length: number; offset: number; data: Uint8Array }>;
}

/** Минимум `fetch`, который нужен учебному клиенту. */
export type MiniFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array },
) => Promise<{ status: number; headers: { get(name: string): string | null } }>;

export type TusUploadFn = (fetch: MiniFetch, endpoint: string, file: Uint8Array, chunkSize: number) => Promise<string>;

/** Строка журнала запросов в демо докачки. */
export interface TusLogRow {
  method: string;
  /** `Upload-Offset` в запросе (у PATCH) или пусто. */
  offset: string;
  /** Сколько байт тела дошло до сервера. */
  sent: number;
  /** Код ответа; `null` — ответа не было: связь оборвалась. */
  status: number | null;
  /** `Upload-Offset` в ответе или пусто. */
  resOffset: string;
}

export interface PresignInput {
  method: string;
  host: string;
  path: string;
  accessKey: string;
  secret: string;
  region: string;
  /** `20130524T000000Z` */
  date: string;
  expires: number;
}

export interface PresignResult {
  url: string;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export interface PresignApi {
  presign(input: PresignInput): Promise<PresignResult>;
  verifyPresigned(
    method: string,
    url: string,
    secretFor: (accessKey: string) => string,
    now: number,
  ): Promise<{ ok: boolean; reason: string }>;
}

export interface SafetyApi {
  sniffType(bytes: Uint8Array): string | null;
  displayName(filename: string): string;
}
