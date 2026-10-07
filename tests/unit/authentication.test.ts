import { createHash, createHmac, createPublicKey, verify as rsaVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/platform/authentication/data';
import { loadAuth } from '@/widgets/auth-lab/model/run';

/**
 * Тема «Аутентификация: сессии, токены, OAuth и OIDC».
 *
 * `JWT_CODE` и `PKCE_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с тестовыми векторами RFC 7515 (A.1) и RFC 7636 (B) и с `node:crypto`.
 * Литералы стенда (`STAND`) проверяются на согласованность между собой: challenge из verifier,
 * `state` и `nonce` туда и обратно, подписи обоих токенов. Браузерный прогон не повторяется —
 * как он снят, написано в шапке `data.ts`.
 */

const auth = loadAuth(t.JWT_CODE, t.PKCE_CODE);
const part = (token: string, i: number) => JSON.parse(Buffer.from(token.split('.')[i], 'base64url').toString('utf8'));
const authorize = new URL(t.STAND.authorizeUrl).searchParams;
const callback = new URL(t.STAND.callbackUrl).searchParams;
const tokenBody = new URLSearchParams(t.STAND.tokenBody);

describe('PKCE_CODE против RFC 7636 и node:crypto', () => {
  it('вектор из приложения B: verifier → challenge', async () => {
    expect(await auth.pkceChallenge(t.RFC7636_VERIFIER)).toBe(t.RFC7636_CHALLENGE);
    expect(t.RFC7636_CHALLENGE).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('случайные verifier: 43 знака, допустимый алфавит, challenge совпадает с createHash', async () => {
    for (let i = 0; i < 50; i++) {
      const v = auth.randomVerifier();
      expect(v).toHaveLength(43);
      expect(auth.isValidVerifier(v)).toBe(true);
      expect(await auth.pkceChallenge(v)).toBe(createHash('sha256').update(v, 'ascii').digest('base64url'));
    }
  });

  it('isValidVerifier: границы 43 и 128, запрещённые знаки', () => {
    expect(auth.isValidVerifier('a'.repeat(42))).toBe(false);
    expect(auth.isValidVerifier('a'.repeat(43))).toBe(true);
    expect(auth.isValidVerifier('a'.repeat(128))).toBe(true);
    expect(auth.isValidVerifier('a'.repeat(129))).toBe(false);
    expect(auth.isValidVerifier('-._~' + 'a'.repeat(39))).toBe(true);
    expect(auth.isValidVerifier('+' + 'a'.repeat(42))).toBe(false);
  });

  it('курьёз из тонких мест: verifier RFC 7636 — подпись из RFC 7515 A.1', () => {
    expect(t.RFC7515_TOKEN.split('.')[2]).toBe(t.RFC7636_VERIFIER);
    expect(t.PITFALLS.some((p) => p.d.includes(t.RFC7636_VERIFIER))).toBe(true);
  });
});

describe('JWT_CODE против RFC 7515 и node:crypto', () => {
  const rfcKey = new Uint8Array(Buffer.from(t.RFC7515_KEY_B64URL, 'base64url'));

  it('пример A.1: подпись сходится, заголовок с \\r\\n разобран как пришёл', async () => {
    const [h, p, s] = t.RFC7515_TOKEN.split('.');
    expect(Buffer.from(h, 'base64url').toString()).toBe('{"typ":"JWT",\r\n "alg":"HS256"}');
    expect(createHmac('sha256', rfcKey).update(`${h}.${p}`).digest('base64url')).toBe(s);
    const before = await auth.verifyJwt(t.RFC7515_TOKEN, rfcKey, 1300819380 - 1);
    expect(before).toEqual({ ok: true, payload: { iss: 'joe', exp: 1300819380, 'http://example.com/is_root': true } });
    // С сегодняшними часами — «срок вышел», как сказано в RFC7515_NOTE.
    expect(await auth.verifyJwt(t.RFC7515_TOKEN, rfcKey)).toEqual({ ok: false, reason: 'срок вышел' });
    expect(t.RFC7515_NOTE).toContain('март 2011');
    expect(new Date(1300819380 * 1000).toISOString().slice(0, 7)).toBe('2011-03');
  });

  it('signJwt совпадает с createHmac и проходит свою же проверку', async () => {
    const payload = { sub: 'alice', name: 'Алиса', exp: 2_000_000_000 };
    const token = await auth.signJwt(payload, 'k');
    const [h, p, s] = token.split('.');
    expect(createHmac('sha256', 'k').update(`${h}.${p}`).digest('base64url')).toBe(s);
    expect(s).toHaveLength(43);
    expect(part(token, 0)).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(await auth.verifyJwt(token, 'k')).toEqual({ ok: true, payload });
    expect(await auth.verifyJwt(token, 'K')).toEqual({ ok: false, reason: 'подпись не сходится' });
  });

  it('«полсотни строк» в лиде раздела про подпись — правда', () => {
    expect(t.JWT_CODE.split('\n').length).toBeLessThanOrEqual(55);
  });

  it('b64url и fromB64url — обратные друг другу на всех байтах', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const s = auth.b64url(bytes);
    expect(s).toBe(Buffer.from(bytes).toString('base64url'));
    expect([...auth.fromB64url(s)]).toEqual([...bytes]);
  });
});

describe('демо «Разбери JWT»: варианты отвечают так, как сказано в подписях', () => {
  const secret = t.STAND.apiSecret;
  const by = (id: string) => t.JWT_VARIANTS.find((v) => v.id === id)!;
  const run = async (id: string, key: string) => {
    const v = by(id);
    const token = v.token ?? (await auth.signJwt(v.resign!, key));
    return auth.verifyJwt(token, key, v.at);
  };

  it('секрет стенда не короче 256 бит', () => {
    expect(Buffer.byteLength(secret)).toBeGreaterThanOrEqual(32);
  });

  it('как выдан — проходит; чужой ключ — нет', async () => {
    expect((await run('issued', secret)).ok).toBe(true);
    expect(await run('issued', secret + 'x')).toEqual({ ok: false, reason: 'подпись не сходится' });
  });

  it('правка нагрузки: подпись прежняя, проверка падает', async () => {
    expect(t.TAMPERED_TOKEN.split('.')[2]).toBe(t.STAND.tokenResponse.access_token.split('.')[2]);
    expect(part(t.TAMPERED_TOKEN, 1).scope).toBe('orders:write');
    expect(await run('tampered', secret)).toEqual({ ok: false, reason: 'подпись не сходится' });
  });

  it('alg: none — отказ до подписи', async () => {
    expect(part(t.NONE_TOKEN, 0)).toEqual({ alg: 'none', typ: 'JWT' });
    expect(t.NONE_TOKEN.endsWith('.')).toBe(true);
    expect(await run('none', secret)).toEqual({ ok: false, reason: 'alg «none» не ждали' });
  });

  it('переподписан: с настоящим секретом — проходит, и scope уже orders:write', async () => {
    const r = await run('resigned', secret);
    expect(r.ok).toBe(true);
    expect(r.ok && r.payload.scope).toBe('orders:write');
    expect((await run('resigned', 'secret')).ok).toBe(true); // кто знает ключ, тот и выпускает
    // Переподписанный токен совпадает с тем, что посчитал бы node:crypto
    const token = await auth.signJwt(by('resigned').resign!, secret);
    expect(token.split('.')[1]).toBe(t.TAMPERED_TOKEN.split('.')[1]);
  });

  it('истёк — подпись верна, срок нет', async () => {
    expect(await run('expired', secret)).toEqual({ ok: false, reason: 'срок вышел' });
  });

  it('мусор вместо токена не бросает', async () => {
    expect(await auth.verifyJwt('a.b', secret)).toEqual({ ok: false, reason: 'не три части' });
    expect(await auth.verifyJwt('!!.??.--', secret)).toEqual({ ok: false, reason: 'не разбирается' });
  });
});

describe('литералы стенда согласованы между собой', () => {
  it('challenge в запросе входа — от verifier, который ушёл на /token', async () => {
    expect(tokenBody.get('code_verifier')).toBe(t.STAND.verifier);
    expect(authorize.get('code_challenge_method')).toBe('S256');
    expect(await auth.pkceChallenge(t.STAND.verifier)).toBe(authorize.get('code_challenge'));
    expect(auth.isValidVerifier(t.STAND.verifier)).toBe(true);
    expect(t.STAND_CHALLENGE).toBe(authorize.get('code_challenge'));
  });

  it('state туда и обратно; код из /callback ушёл на /token', () => {
    expect(callback.get('state')).toBe(authorize.get('state'));
    expect(tokenBody.get('code')).toBe(callback.get('code'));
    expect(Buffer.from(callback.get('code')!, 'base64url')).toHaveLength(16);
    expect(authorize.get('redirect_uri')).toBe(t.STAND.redirectUri);
    expect(tokenBody.get('redirect_uri')).toBe(t.STAND.redirectUri);
    expect(t.STAND.callbackReferer).toBe(new URL(t.STAND.issuer).origin + '/');
  });

  it('access-токен подписан секретом API, aud — orders-api, срок 600 с', async () => {
    const at = t.STAND.tokenResponse.access_token;
    const p = part(at, 1);
    expect(p.aud).toBe('orders-api');
    expect(p.exp - p.iat).toBe(t.STAND.tokenResponse.expires_in);
    expect((await auth.verifyJwt(at, t.STAND.apiSecret, p.iat + 60)).ok).toBe(true);
  });

  it('id_token: RS256 открытым ключом стенда, iss/aud/nonce как в тексте', () => {
    const idt = t.STAND.tokenResponse.id_token;
    const [h, p, s] = idt.split('.');
    expect(part(idt, 0)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
    const key = createPublicKey({ key: t.STAND.jwk as never, format: 'jwk' });
    expect(rsaVerify('sha256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))).toBe(true);
    const claims = part(idt, 1);
    expect(claims.iss).toBe(t.STAND.issuer);
    expect(claims.aud).toBe(t.STAND.clientId);
    expect(claims.nonce).toBe(authorize.get('nonce'));
    // Пример claims в теме — тот же id_token, без правок значений.
    const printed = JSON.parse(t.ID_TOKEN_CLAIMS.replace(/\s+\/\/ .*$/gm, ''));
    expect(printed).toEqual(claims);
  });

  it('размеры в таблице «Сессия или токен»', () => {
    expect(t.STAND.tokenResponse.access_token).toHaveLength(243);
    expect(t.STAND.tokenResponse.id_token).toHaveLength(626);
    expect(Buffer.alloc(32).toString('base64url')).toHaveLength(43);
    const row = t.SESSION_ROWS.find((r) => r.k === 'Размер')!;
    expect(row.session).toContain('43 знака');
    expect(row.token).toContain('243');
    expect(row.token).toContain('626');
  });

  it('шаги демо собраны из STAND, а не набраны руками', () => {
    const step = (id: string) => t.FLOW_STEPS.find((s) => s.id === id)!;
    expect(step('start').params[0].v).toBe(t.STAND.verifier);
    expect(step('authorize').params.find((x) => x.k === 'code_challenge')?.v).toBe(authorize.get('code_challenge'));
    expect(step('token').params.find((x) => x.k === 'code_verifier')?.v).toBe(t.STAND.verifier);
  });
});
