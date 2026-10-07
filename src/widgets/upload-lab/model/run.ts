import type {
  MiniFetch,
  MultipartApi,
  PresignApi,
  SafetyApi,
  TusLogRow,
  TusServer,
  TusUploadFn,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `MULTIPART_CODE`, `TUS_CLIENT_CODE`,
 * `TUS_SERVER_CODE`, `PRESIGN_CODE` и `SAFETY_CODE` из темы «Загрузка файлов».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/uploads.test.ts`: сборщик multipart — против байт `fetch(FormData)` из Node
 * и Chromium, разборщик — против `Response.formData()`, tus-клиент — против `@tus/server`,
 * tus-сервер — против `tus-js-client`, подпись — против примера из документации AWS.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadMultipart(code: string): MultipartApi {
  return new Function(`${code}\nreturn { encodeMultipart, parseMultipart };`)() as MultipartApi;
}

export function loadTusClient(code: string): TusUploadFn {
  return new Function(`${code}\nreturn tusUpload;`)() as TusUploadFn;
}

export function loadTusServer(code: string): () => TusServer {
  return new Function(`${code}\nreturn createTusServer;`)() as () => TusServer;
}

export function loadPresign(code: string): PresignApi {
  return new Function(`${code}\nreturn { presign, verifyPresigned };`)() as PresignApi;
}

export function loadSafety(code: string): SafetyApi {
  return new Function(`${code}\nreturn { sniffType, displayName };`)() as SafetyApi;
}

/**
 * Байты тела так, как их удобно читать: UTF-8 там, где он валиден, прочие байты — `\xNN`,
 * перевод строки виден знаком: `␍␊` — CRLF, `␊` — одиночный LF.
 */
export function printBytes(bytes: Uint8Array): string {
  const dec = new TextDecoder('utf-8', { fatal: true });
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      i += 2;
      out += i < bytes.length ? '␍␊\n' : '␍␊';
      continue;
    }
    if (b === 0x0a) {
      i += 1;
      out += i < bytes.length ? '␊\n' : '␊';
      continue;
    }
    const len = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc2 ? 2 : 0;
    let ch: string | null = null;
    if (len) {
      try {
        ch = dec.decode(bytes.subarray(i, i + len));
      } catch {
        ch = null;
      }
    }
    if (ch === null || (len === 1 && (b < 0x20 || b === 0x7f))) {
      out += '\\x' + b.toString(16).padStart(2, '0');
      i += 1;
      continue;
    }
    out += ch;
    i += len;
  }
  return out;
}

/**
 * Сеть для демо докачки: учебный клиент ходит не в настоящий сервер, а в учебный
 * `createTusServer` в той же вкладке. «Сеть» умеет одно — оборваться посреди PATCH,
 * когда через неё прошло `cutAt` байт тела (один раз). Сервер в этом случае получает
 * дошедшую часть, а клиент — `TypeError`, как от настоящего `fetch`.
 */
export function makeLossyFetch(server: TusServer, cutAt: number, log: TusLogRow[]): MiniFetch {
  let passed = 0;
  let cut = false;
  return async (url, init) => {
    const path = new URL(url).pathname;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = v;
    let body = init.body ?? new Uint8Array(0);
    const row: TusLogRow = {
      method: init.method,
      offset: headers['upload-offset'] ?? '',
      sent: body.length,
      status: null,
      resOffset: '',
    };
    log.push(row);
    const breaks = init.method === 'PATCH' && !cut && passed + body.length > cutAt;
    if (breaks) {
      cut = true;
      body = body.subarray(0, cutAt - passed);
      row.sent = body.length;
    }
    passed += init.method === 'PATCH' ? body.length : 0;
    const res = server.handle({ method: init.method, path, headers, body });
    if (breaks) throw new TypeError('Failed to fetch');
    row.status = res.status;
    row.resOffset = res.headers['Upload-Offset'] ?? '';
    const lower = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k.toLowerCase(), v]));
    return { status: res.status, headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } };
  };
}
