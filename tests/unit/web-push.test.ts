import { createECDH, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/platform/web-push/data';
import { bodyParts, loadPush, makeSubscription, runDemo } from '@/widgets/push-lab/model/run';

/**
 * Тема «Web Push».
 *
 * `PUSH_CODE` и `VAPID_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются со стандартом (пример RFC 8291 с ключами и промежуточными значениями —
 * байт в байт), с пакетом `web-push` 3.6.7 (его тело расшифровывается функцией темы, тело темы —
 * его зависимостью `http_ece`, его JWT принимает `checkVapid`) и с литералами стенда.
 * `SERVER_CODE`, `SW_CODE` и `CLIENT_CODE` исполняются как напечатаны — с подставными
 * `webpush`, `self`, `navigator`: настоящий прогон в Chromium и FCM был на стенде (см. шапку
 * `data.ts`) и тестом не повторяется — ему нужна сеть и Google.
 */

const require = createRequire(import.meta.url);
/** Те методы `web-push`, что нужны тесту: у пакета нет своих типов, а `@types/web-push` не ставим. */
interface RequestDetails {
  headers: Record<string, string | number>;
  body: Buffer | null;
}
interface WebPush {
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  getVapidHeaders(aud: string, sub: string, pub: string, priv: string, enc: string, exp?: number): { Authorization: string };
  generateRequestDetails(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload?: string, opts?: Record<string, unknown>): RequestDetails;
}
const webpush = require('web-push') as WebPush;
const ece = require('http_ece') as {
  decrypt(buf: Buffer, params: { version: string; privateKey: unknown; authSecret: string }): Buffer;
};

const api = loadPush(t.PUSH_CODE, t.VAPID_CODE);
const subtle = webcrypto.subtle;
const b = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const V = t.RFC_VECTOR;

/** Пара ключей P-256 из сырых байтов RFC: Web Crypto принимает закрытый ключ только в JWK. */
async function pairFromRaw(publicB64: string, privateB64: string, alg: 'ECDH' | 'ECDSA') {
  const p = Buffer.from(publicB64, 'base64url');
  const jwk = { kty: 'EC', crv: 'P-256', x: p.subarray(1, 33).toString('base64url'), y: p.subarray(33).toString('base64url') };
  const use = alg === 'ECDH' ? { pub: [] as KeyUsage[], priv: ['deriveBits'] as KeyUsage[] } : { pub: ['verify'] as KeyUsage[], priv: ['sign'] as KeyUsage[] };
  return {
    publicKey: await subtle.importKey('jwk', jwk, { name: alg, namedCurve: 'P-256' }, true, use.pub),
    privateKey: await subtle.importKey('jwk', { ...jwk, d: privateB64 }, { name: alg, namedCurve: 'P-256' }, true, use.priv),
  } as CryptoKeyPair;
}

describe('PUSH_CODE против RFC 8291 (раздел 5 и Appendix A)', () => {
  it('encryptPush с ключами и salt из RFC даёт те же 144 байта буква в букву', async () => {
    const sender = await pairFromRaw(V.senderPublic, V.senderPrivate, 'ECDH');
    const body = await api.encryptPush({ p256dh: V.receiverPublic, auth: V.authSecret }, V.plaintext, { salt: b(V.salt), serverKeys: sender });
    expect(api.b64url(body)).toBe(V.body);
    expect(body.length).toBe(144);
    expect(86 + V.plaintext.length + 1 + 16).toBe(144);
  });

  it('decryptPush читает тело из RFC закрытым ключом получателя', async () => {
    const receiver = await pairFromRaw(V.receiverPublic, V.receiverPrivate, 'ECDH');
    expect(await api.decryptPush(b(V.body), receiver, b(V.authSecret))).toBe(V.plaintext);
  });

  it('промежуточные CEK и NONCE совпадают с Appendix A (hkdf темы поверх ECDH из node:crypto)', async () => {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(V.receiverPrivate, 'base64url'));
    const secret = new Uint8Array(ecdh.computeSecret(Buffer.from(V.senderPublic, 'base64url')));
    expect(api.b64url(secret)).toBe('kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs');
    const enc = new TextEncoder();
    const keyInfo = new Uint8Array([...enc.encode('WebPush: info\0'), ...b(V.receiverPublic), ...b(V.senderPublic)]);
    const ikm = await api.hkdf(b(V.authSecret), secret, keyInfo, 32);
    expect(api.b64url(ikm)).toBe('S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg');
    expect(api.b64url(await api.hkdf(b(V.salt), ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16))).toBe(V.cek);
    expect(api.b64url(await api.hkdf(b(V.salt), ikm, enc.encode('Content-Encoding: nonce\0'), 12))).toBe(V.nonce);
  });
});

describe('PUSH_CODE против web-push 3.6.7', () => {
  it('decryptPush читает тело, которое зашифровал web-push, — и наоборот, http_ece читает тело темы', async () => {
    const sub = await makeSubscription(api);
    const payload = JSON.stringify(t.STAND.message);
    const req = webpush.generateRequestDetails({ endpoint: t.STAND.subscription.endpoint, keys: sub.keys }, payload, {
      vapidDetails: { subject: 'mailto:push@shop.example', ...webpush.generateVAPIDKeys() },
    });
    const body = new Uint8Array(req.body as Buffer);
    expect(await api.decryptPush(body, sub.ua, sub.auth)).toBe(payload);
    expect(req.headers['Content-Encoding']).toBe('aes128gcm');

    // Обратно: тело темы расшифровывает зависимость web-push своим кодом.
    const priv = await subtle.exportKey('jwk', sub.ua.privateKey);
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(priv.d as string, 'base64url'));
    const mine = await api.encryptPush(sub.keys, payload);
    const plain = ece.decrypt(Buffer.from(mine), { version: 'aes128gcm', privateKey: ecdh, authSecret: sub.keys.auth });
    expect(plain.toString()).toBe(payload);
  });

  it('размеры: сообщение стенда — 124 байта, тело — 227; к тексту всегда +103', async () => {
    const payload = JSON.stringify(t.STAND.message);
    expect(Buffer.byteLength(payload)).toBe(t.STAND.payloadBytes);
    const theirs = webpush.generateRequestDetails({ endpoint: t.STAND.subscription.endpoint, keys: t.STAND.subscription.keys }, payload);
    expect((theirs.body as Buffer).length).toBe(t.STAND.bodyBytes);
    const mine = await api.encryptPush(t.STAND.subscription.keys, payload);
    expect(mine.length).toBe(t.STAND.bodyBytes);
    expect(t.STAND.bodyBytes - t.STAND.payloadBytes).toBe(103);
    expect(t.SIZE_NOTE).toContain('124 байта JSON');
    expect(t.SIZE_NOTE).toContain('отправил 227');
    expect(t.REQUEST_PRINT_CODE).toContain(`Content-Length: ${t.STAND.bodyBytes}`);
  });

  it('предел 4096 байт тела — это 3993 байта текста', async () => {
    const sub = await makeSubscription(api);
    expect((await api.encryptPush(sub.keys, 'a'.repeat(3993))).length).toBe(4096);
    expect((await api.encryptPush(sub.keys, 'a'.repeat(3994))).length).toBe(4097);
    expect(t.SIZE_NOTE).toContain('3993');
    expect(t.SIZE_NOTE).toContain('103 байта');
  });

  it('заголовок тела: rs 4096, idlen 65, keyid начинается с 0x04 — поля таблицы в том же порядке', async () => {
    const sub = await makeSubscription(api);
    const body = await api.encryptPush(sub.keys, 'x');
    expect(new DataView(body.buffer).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);
    expect(body[21]).toBe(4);
    const parts = bodyParts(body);
    expect(parts.map((p) => p.to - p.from)).toEqual([16, 4, 1, 65, 2, 16]);
    expect(t.HEADER_ROWS.map((r) => r.k)).toEqual(parts.map((p) => p.k));
    expect(t.HEADER_ROWS.map((r) => r.bytes)).toEqual(['16', '4', '1', '65', 'n + 1', '16']);
  });

  it('значения web-push по умолчанию — как в таблице заголовков', () => {
    const req = webpush.generateRequestDetails({ endpoint: t.STAND.subscription.endpoint, keys: t.STAND.subscription.keys }, 'x');
    expect(req.headers.TTL).toBe(2419200);
    expect(req.headers.Urgency).toBe('normal');
    expect(t.HEADERS_ROWS[0].d).toContain('2 419 200');
  });
});

describe('VAPID_CODE против web-push и стенда', () => {
  const now = t.STAND.sentAt;
  const endpoint = t.STAND.subscription.endpoint;

  it('настоящий заголовок со стенда проходит checkVapid: подпись, aud, exp = отправка + 12 ч', async () => {
    expect(await api.checkVapid(t.STAND.authorization, endpoint, t.STAND.vapidPublicKey, now)).toEqual({ status: 201, why: 'принято' });
    const [, jwt] = /^vapid t=(\S+), k=/.exec(t.STAND.authorization) ?? [];
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(claims).toEqual({ aud: 'https://jmt17.google.com', exp: now + 12 * 3600, sub: 'mailto:push@shop.example' });
    expect(b(s)).toHaveLength(64);
    // Печать в теме — тот же заголовок, перенесённый по точкам.
    for (const part of [h, p, s, t.STAND.vapidPublicKey]) expect(t.VAPID_HEADER_CODE).toContain(part);
    expect(t.VAPID_HEADER_CODE).toContain(JSON.stringify(claims));
  });

  it('checkVapid отказывает: чужой k, чужой push-сервис, истёкший exp, испорченная подпись, нет заголовка', async () => {
    const other = webpush.generateVAPIDKeys().publicKey;
    expect((await api.checkVapid(t.STAND.authorization, endpoint, other, now)).status).toBe(403);
    expect(await api.checkVapid(t.STAND.authorization, 'https://updates.push.services.mozilla.com/wpush/v2/x', t.STAND.vapidPublicKey, now)).toEqual({ status: 403, why: 'aud — чужой origin' });
    expect((await api.checkVapid(t.STAND.authorization, endpoint, t.STAND.vapidPublicKey, now + 13 * 3600)).why).toBe('exp в прошлом или дальше суток');
    const broken = t.STAND.authorization.replace(/\.(\w)/, (_m, c: string) => `.${c === 'e' ? 'f' : 'e'}`);
    expect((await api.checkVapid(broken, endpoint, t.STAND.vapidPublicKey, now)).status).toBe(403);
    expect(await api.checkVapid(undefined, endpoint, t.STAND.vapidPublicKey, now)).toEqual({ status: 401, why: 'нет заголовка vapid' });
  });

  it('vapidAuth даёт тот же заголовок и нагрузку JWT, что webpush.getVapidHeaders; подписи принимаются обе', async () => {
    const vk = webpush.generateVAPIDKeys();
    const keys = await pairFromRaw(vk.publicKey, vk.privateKey, 'ECDSA');
    const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
    const mine = await api.vapidAuth(endpoint, 'mailto:push@shop.example', keys, exp);
    const theirs = webpush.getVapidHeaders('https://jmt17.google.com', 'mailto:push@shop.example', vk.publicKey, vk.privateKey, 'aes128gcm', exp).Authorization;
    // ECDSA случайна: подписи разные, всё остальное — буква в букву.
    const strip = (s: string) => s.replace(/\.[\w-]+, k=/, ', k=');
    expect(strip(mine)).toBe(strip(theirs));
    const at = exp - 12 * 3600;
    expect((await api.checkVapid(mine, endpoint, vk.publicKey, at)).status).toBe(201);
    expect((await api.checkVapid(theirs, endpoint, vk.publicKey, at)).status).toBe(201);
  });
});

describe('демо: runDemo во всех режимах', () => {
  it('«как есть» расшифровывается, три порчи — OperationError', async () => {
    const sub = await makeSubscription(api);
    const other = await makeSubscription(api);
    const ids = t.DEMO_MODES.map((m) => m.id);
    expect(ids).toEqual(['ok', 'flip', 'auth', 'key']);
    for (const mode of ids) {
      const r = await runDemo(api, sub, other, t.DEMO_DEFAULT_TEXT, mode);
      expect(r.body.length, mode).toBe(t.STAND.bodyBytes);
      if (mode === 'ok') expect(r.result).toEqual({ ok: true, text: t.DEMO_DEFAULT_TEXT });
      else expect(r.result.ok, mode).toBe(false);
      if (!r.result.ok) expect(r.result.error, mode).toMatch(/^OperationError/);
    }
    expect((await runDemo(api, sub, other, 'x', 'flip')).flipped).toBe(86);
  });
});

describe('SERVER_CODE как напечатан (подставной webpush, настоящий setVapidDetails)', () => {
  function load(send: (sub: unknown, payload: string, opts: Record<string, unknown>) => Promise<unknown>) {
    const deleted: string[] = [];
    const calls: { payload: string; opts: Record<string, unknown> }[] = [];
    const fake = {
      setVapidDetails: webpush.setVapidDetails.bind(webpush),
      sendNotification: (sub: unknown, payload: string, opts: Record<string, unknown>) => {
        calls.push({ payload, opts });
        return send(sub, payload, opts);
      },
    };
    const db = { subscriptions: { delete: async (e: string) => void deleted.push(e) } };
    const vk = webpush.generateVAPIDKeys();
    const body = t.SERVER_CODE.replace(/^import .*\n/, '');
    expect(body).not.toContain('import ');
    const notify = new Function('webpush', 'db', 'VAPID_PUBLIC', 'VAPID_PRIVATE', `${body}\nreturn notify;`)(fake, db, vk.publicKey, vk.privateKey) as (
      sub: unknown,
      m: unknown,
    ) => Promise<unknown>;
    return { notify, deleted, calls };
  }

  it('опции отправки дают те заголовки, что напечатаны в запросе стенда', async () => {
    const { notify, calls } = load(async () => ({ statusCode: 201 }));
    expect(await notify(t.STAND.subscription, t.STAND.message)).toEqual({ statusCode: 201 });
    const req = webpush.generateRequestDetails(t.STAND.subscription, calls[0].payload, calls[0].opts);
    for (const [k, v] of Object.entries({ TTL: req.headers.TTL, Urgency: req.headers.Urgency, Topic: req.headers.Topic })) {
      expect(t.REQUEST_PRINT_CODE).toContain(`${k}: ${v}`);
    }
    expect(calls[0].payload).toBe(JSON.stringify(t.STAND.message));
  });

  it('404 и 410 удаляют подписку и возвращают null, остальное пробрасывается', async () => {
    for (const code of [404, 410]) {
      const { notify, deleted } = load(async () => Promise.reject(Object.assign(new Error('gone'), { statusCode: code })));
      expect(await notify(t.STAND.subscription, t.STAND.message)).toBeNull();
      expect(deleted).toEqual([t.STAND.subscription.endpoint]);
    }
    const { notify, deleted } = load(async () => Promise.reject(Object.assign(new Error('x'), { statusCode: 429 })));
    await expect(notify(t.STAND.subscription, t.STAND.message)).rejects.toThrow('x');
    expect(deleted).toEqual([]);
  });
});

describe('SW_CODE как напечатан (подставной self)', () => {
  function load(tabs: { url: string; focus: () => string }[] = []) {
    const handlers: Record<string, (e: unknown) => void> = {};
    const shown: { title: string; opts: Record<string, unknown> }[] = [];
    const opened: string[] = [];
    const self = {
      addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
      registration: { showNotification: async (title: string, opts: Record<string, unknown>) => void shown.push({ title, opts }) },
      location: { origin: 'https://shop.example' },
    };
    const clients = { matchAll: async () => tabs, openWindow: async (url: string) => (opened.push(url), 'opened') };
    new Function('self', 'clients', t.SW_CODE)(self, clients);
    return { handlers, shown, opened };
  }
  const pushEvent = (data: { json(): unknown } | null) => {
    const waits: Promise<unknown>[] = [];
    return { e: { data, waitUntil: (p: Promise<unknown>) => waits.push(p) }, waits };
  };

  it('push показывает уведомление с tag и url через waitUntil; без данных — заголовок по умолчанию', async () => {
    const { handlers, shown } = load();
    const ev = pushEvent({ json: () => t.STAND.message });
    handlers.push(ev.e);
    expect(ev.waits).toHaveLength(1);
    await Promise.all(ev.waits);
    expect(shown[0]).toEqual({ title: t.STAND.message.title, opts: { body: t.STAND.message.body, tag: 'order-1042', data: { url: '/orders/1042' } } });
    const empty = pushEvent(null);
    handlers.push(empty.e);
    await Promise.all(empty.waits);
    expect(shown[1].title).toBe('Есть новости');
  });

  it('не JSON — обработчик падает SyntaxError, уведомления нет (как на стенде)', () => {
    const { handlers, shown } = load();
    const ev = pushEvent({ json: () => JSON.parse('не JSON') });
    expect(() => handlers.push(ev.e)).toThrow(SyntaxError);
    expect(shown).toHaveLength(0);
    expect(t.SW_FACTS.some((f) => f.d.includes('`SyntaxError`'))).toBe(true);
  });

  it('notificationclick: открытая вкладка с тем адресом получает фокус, иначе открывается новая', async () => {
    const run = async (tabs: { url: string; focus: () => string }[]) => {
      const { handlers, opened } = load(tabs);
      const waits: Promise<unknown>[] = [];
      let closed = false;
      handlers.notificationclick({ notification: { data: { url: '/orders/1042' }, close: () => (closed = true) }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      expect(closed).toBe(true);
      return { result: await waits[0], opened };
    };
    expect((await run([{ url: 'https://shop.example/orders/1042', focus: () => 'focused' }])).result).toBe('focused');
    const fresh = await run([{ url: 'https://shop.example/', focus: () => 'wrong' }]);
    expect(fresh.result).toBe('opened');
    expect(fresh.opened).toEqual(['https://shop.example/orders/1042']);
  });
});

describe('CLIENT_CODE как напечатан (подставные navigator, Notification, fetch)', () => {
  function load(permission: string, existing: unknown = null) {
    const log: string[] = [];
    let subscribeArgs: unknown = null;
    const sub = { toJSON: () => t.STAND.subscription };
    const reg = {
      pushManager: {
        getSubscription: async () => existing,
        subscribe: async (o: unknown) => ((subscribeArgs = o), sub),
      },
    };
    const navigator = { serviceWorker: { register: async (u: string) => (log.push(`register ${u}`), reg), ready: Promise.resolve(reg) } };
    const Notification = { requestPermission: async () => permission };
    const fetch = async (url: string, init: { body: string }) => void log.push(`POST ${url} ${init.body}`);
    const subscribe = new Function('navigator', 'Notification', 'fetch', `${t.CLIENT_CODE}\nreturn subscribe;`)(navigator, Notification, fetch) as (k: string) => Promise<unknown>;
    return { subscribe, log, args: () => subscribeArgs, sub };
  }

  it('подписывается с userVisibleOnly и ключом VAPID и отправляет JSON подписки на сервер', async () => {
    const c = load('granted');
    expect(await c.subscribe(t.STAND.vapidPublicKey)).toBe(c.sub);
    expect(c.args()).toEqual({ userVisibleOnly: true, applicationServerKey: t.STAND.vapidPublicKey });
    expect(c.log).toEqual(['register /sw.js', `POST /api/push/subscriptions ${JSON.stringify(t.STAND.subscription)}`]);
  });

  it('без разрешения — null и никаких запросов; с готовой подпиской — без нового subscribe, но с отправкой', async () => {
    const denied = load('denied');
    expect(await denied.subscribe(t.STAND.vapidPublicKey)).toBeNull();
    expect(denied.log).toEqual(['register /sw.js']);
    const existing = { toJSON: () => t.STAND.subscription };
    const again = load('granted', existing);
    expect(await again.subscribe(t.STAND.vapidPublicKey)).toBe(existing);
    expect(again.args()).toBeNull();
    expect(again.log).toHaveLength(2);
  });
});

describe('литералы стенда согласованы между собой и с текстом', () => {
  it('подписка: p256dh 65 байт с 0x04, auth 16 байт, длина endpoint как в таблице', () => {
    const { endpoint, keys, expirationTime } = t.STAND.subscription;
    expect(b(keys.p256dh)).toHaveLength(65);
    expect(b(keys.p256dh)[0]).toBe(4);
    expect(b(keys.auth)).toHaveLength(16);
    expect(b(t.STAND.vapidPublicKey)).toHaveLength(65);
    expect(expirationTime).toBeNull();
    expect(endpoint.startsWith('https://jmt17.google.com/fcm/send/')).toBe(true);
    expect(t.SUB_FIELDS[0].v).toBe(`${endpoint.length} знаков`);
    expect(t.SUBSCRIPTION_PRINT_CODE).toContain(keys.p256dh);
    expect(t.SUBSCRIPTION_PRINT_CODE).toContain(keys.auth);
    expect(t.SUBSCRIPTION_PRINT_CODE).toContain(endpoint.slice(0, 60));
    expect(t.REQUEST_PRINT_CODE).toContain(t.STAND.location);
  });

  it('тонкие места пронумерованы по порядку; ссылки «Где разобрано» ведут на разделы из nav целевых тем', () => {
    expect(t.PITFALLS.map((p) => p.n)).toEqual(t.PITFALLS.map((_p, i) => String(i + 1).padStart(2, '0')));
    const links = [...t.PREREQ.map((p) => p.href ?? ''), ...[...t.RELATED.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]), '/platform/realtime/#s1'].filter(Boolean);
    for (const href of links) {
      const [, slug, anchor] = /^\/platform\/([\w-]+)\/(?:#(s\d+))?$/.exec(href) ?? [];
      expect(slug, href).toBeTruthy();
      const mdx = readFileSync(new URL(`../../src/content/platform/${slug}/index.mdx`, import.meta.url), 'utf8');
      if (anchor) expect(mdx, href).toContain(`{ id: ${anchor},`);
    }
  });
});
