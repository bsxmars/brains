import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { verifyAuthenticationResponse, verifyRegistrationResponse, type WebAuthnCredential } from '@simplewebauthn/server';
import { decodeAttestationObject, isoCBOR, parseAuthenticatorData } from '@simplewebauthn/server/helpers';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/platform/passkeys/data';
import { loadWebAuthn, runScenario, withFlags } from '@/widgets/passkey-lab/model/run';
import type { CredentialJSON, Expected, PasskeyScenario } from '@/widgets/passkey-lab/model/types';

/**
 * Тема «Passkeys и WebAuthn».
 *
 * `AUTHDATA_CODE` и `VERIFY_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с `@simplewebauthn/server` 14.0.3 на ответах, снятых стендом в Chromium 153
 * с виртуальным аутентификатором (`STAND`), и на испорченных копиях этих ответов. Литералы стенда
 * проверяются на согласованность: библиотека принимает и отвергает их так же, как сервер стенда.
 * Браузерный прогон не повторяется — ключи стенда новые при каждом запуске.
 */

const api = loadWebAuthn(t.AUTHDATA_CODE, t.VERIFY_CODE);
const S = t.STAND;
const b = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));
const sha256 = (data: Uint8Array | string) => new Uint8Array(createHash('sha256').update(data).digest());
const scenario = (id: string) => t.DEMO_SCENARIOS.find((s) => s.id === id) as PasskeyScenario;
const REG = scenario('reg');

/** Запись о ключе для `@simplewebauthn/server` — из его же проверки регистрации. */
async function libCredential(counter: number): Promise<WebAuthnCredential> {
  const v = await verifyRegistrationResponse({
    response: S.reg as never,
    expectedChallenge: S.regOptions.challenge,
    expectedOrigin: t.ORIGIN,
    expectedRPID: t.RP_ID,
  });
  if (!v.verified) throw new Error('регистрация стенда не прошла');
  return { ...v.registrationInfo.credential, counter };
}

/** Вердикт библиотеки одним булевым: `verified`, либо `false`, если она бросила. */
async function libVerdict(cred: CredentialJSON, expected: Expected, kind: 'create' | 'get', stored = 0) {
  try {
    if (kind === 'create') {
      const v = await verifyRegistrationResponse({
        response: cred as never,
        expectedChallenge: expected.challenge,
        expectedOrigin: expected.origin,
        expectedRPID: expected.rpId,
        requireUserVerification: expected.requireUV,
      });
      return { ok: v.verified, error: '' };
    }
    const v = await verifyAuthenticationResponse({
      response: cred as never,
      expectedChallenge: expected.challenge,
      expectedOrigin: expected.origin,
      expectedRPID: expected.rpId,
      requireUserVerification: expected.requireUV,
      credential: await libCredential(stored),
    });
    return { ok: v.verified, error: '' };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

describe('литералы стенда: библиотека отвечает так же, как сервер стенда', () => {
  it('регистрация: verified, счётчик 1, multiDevice, backedUp', async () => {
    const v = await verifyRegistrationResponse({
      response: S.reg as never,
      expectedChallenge: S.regOptions.challenge,
      expectedOrigin: t.ORIGIN,
      expectedRPID: t.RP_ID,
    });
    expect(v.verified).toBe(true);
    expect(v.registrationInfo?.credential.counter).toBe(1);
    expect(v.registrationInfo?.credentialDeviceType).toBe('multiDevice');
    expect(v.registrationInfo?.credentialBackedUp).toBe(true);
    expect(S.verdicts[0].res).toEqual({ verified: true, counter: 1, deviceType: 'multiDevice', backedUp: true });
  });

  it('два входа: счётчик 1 → 2 → 3', async () => {
    let counter = 1;
    for (const [cred, opts] of [
      [S.login1, S.login1Options],
      [S.login2, S.login2Options],
    ] as const) {
      const v = await verifyAuthenticationResponse({
        response: cred as never,
        expectedChallenge: opts.challenge,
        expectedOrigin: t.ORIGIN,
        expectedRPID: t.RP_ID,
        credential: await libCredential(counter),
      });
      expect(v.verified).toBe(true);
      expect(v.authenticationInfo.newCounter).toBe(counter + 1);
      counter = v.authenticationInfo.newCounter;
    }
    expect(S.verdicts.slice(1, 3).map((v) => v.res)).toEqual([
      { verified: true, newCounter: 2, origin: t.ORIGIN },
      { verified: true, newCounter: 3, origin: t.ORIGIN },
    ]);
    expect(t.COUNTER_NOTE).toContain('1 → 2 → 3');
  });

  it('другой порт и повтор — отказ с теми же словами, что в журнале стенда', async () => {
    const port = await libVerdict(S.otherPort, scenario('port').expected, 'get', 3);
    const replay = await libVerdict(S.login1, scenario('replay').expected, 'get', 3);
    expect(port.ok).toBe(false);
    expect(replay.ok).toBe(false);
    const logged = S.verdicts.map((v) => ('error' in v.res ? String(v.res.error) : ''));
    expect(logged).toContain(port.error);
    expect(logged).toContain(replay.error);
    expect(port.error).toContain('Unexpected authentication response origin "http://bank.localhost:50401"');
    expect(replay.error).toContain('Unexpected authentication response challenge');
    // Подписи в таблице отказов взяты из журнала.
    const refusals = t.REFUSALS.map((r) => r.got).join('\n');
    expect(refusals).toContain('Unexpected authentication response origin "http://bank.localhost:50401"');
    expect(refusals).toContain('Unexpected authentication response challenge');
  });

  it('USB-ключ без UV: с requireUserVerification — отказ, без — singleDevice', async () => {
    const strict = await libVerdict(S.deviceBound, scenario('usb').expected, 'create');
    expect(strict.ok).toBe(false);
    expect(strict.error).toMatch(/user verification/i);
    const v = await verifyRegistrationResponse({
      response: S.deviceBound as never,
      expectedChallenge: S.deviceBoundChallenge,
      expectedOrigin: t.ORIGIN,
      expectedRPID: t.RP_ID,
      requireUserVerification: false,
    });
    expect(v.verified).toBe(true);
    expect(v.registrationInfo?.credentialDeviceType).toBe('singleDevice');
    expect(v.registrationInfo?.credentialBackedUp).toBe(false);
  });

  it('параметры регистрации на странице — те, что выдал сервер', () => {
    expect(JSON.parse(t.REG_OPTIONS_CODE)).toEqual(S.regOptions);
    expect(S.regOptions.pubKeyCredParams.map((p) => p.alg)).toEqual([-7, -257]);
    expect(Buffer.from(S.regOptions.user.id, 'base64url').toString()).toBe('user-42');
    expect(b(S.regOptions.challenge)).toHaveLength(32);
  });
});

describe('AUTHDATA_CODE против @simplewebauthn/server/helpers', () => {
  const all = [S.reg, S.login1, S.login2, S.otherPort, S.deviceBound];

  it('parseAuthData даёт те же поля, что parseAuthenticatorData', () => {
    for (const cred of all) {
      const bytes = b(cred.response.authenticatorData);
      const ours = api.parseAuthData(bytes);
      const lib = parseAuthenticatorData(bytes);
      expect(ours.rpIdHash).toEqual(new Uint8Array(lib.rpIdHash));
      expect(ours.signCount).toBe(lib.counter);
      expect(ours.flags).toEqual({ UP: lib.flags.up, UV: lib.flags.uv, BE: lib.flags.be, BS: lib.flags.bs, AT: lib.flags.at, ED: lib.flags.ed });
      if (lib.credentialID) {
        expect(ours.credentialId).toEqual(new Uint8Array(lib.credentialID));
        expect(ours.aaguid).toEqual(new Uint8Array(lib.aaguid!));
        expect(ours.publicKey).toEqual(isoCBOR.decodeFirst(lib.credentialPublicKey!));
      }
    }
  });

  it('readCbor раскрывает attestationObject так же, как decodeAttestationObject', () => {
    for (const cred of [S.reg, S.deviceBound]) {
      const bytes = b(cred.response.attestationObject!);
      const ours = api.readCbor(bytes)[0] as Map<string, unknown>;
      const lib = decodeAttestationObject(bytes);
      expect(ours.get('fmt')).toBe(lib.get('fmt'));
      expect(ours.get('authData')).toEqual(new Uint8Array(lib.get('authData')));
      expect(api.readCbor(bytes)[1]).toBe(bytes.length);
      // authenticatorData из toJSON() — тот же кусок, что внутри attestationObject.
      expect(ours.get('authData')).toEqual(b(cred.response.authenticatorData));
    }
  });

  it('coseToJwk даёт тот же ключ, что браузер отдал в SPKI (response.publicKey)', () => {
    const auth = api.parseAuthData(b(S.reg.response.authenticatorData));
    const jwk = api.coseToJwk(auth.publicKey!);
    const spki = createPublicKey({ key: Buffer.from(S.reg.response.publicKey!, 'base64url'), format: 'der', type: 'spki' });
    const fromSpki = spki.export({ format: 'jwk' });
    expect(jwk).toEqual({ kty: 'EC', crv: 'P-256', x: fromSpki.x, y: fromSpki.y });
  });

  it('числа из текста: 164 байта, 77 байт ключа, флаги 0x5d / 0x1d / 0x41, rpIdHash', () => {
    const reg = b(S.reg.response.authenticatorData);
    expect(reg.length).toBe(164);
    const idLen = (reg[53] << 8) | reg[54];
    expect(idLen).toBe(32);
    expect(reg.length - 55 - idLen).toBe(77);
    expect(reg[32]).toBe(0x5d);
    expect(b(S.login1.response.authenticatorData)).toHaveLength(37);
    expect(b(S.login1.response.authenticatorData)[32]).toBe(0x1d);
    expect(b(S.deviceBound.response.authenticatorData)[32]).toBe(0x41);
    expect(t.AUTHDATA_NOTE).toContain('164 байта');
    expect(t.AUTHDATA_NOTE).toContain('77 байт');
    expect(t.AUTHDATA_NOTE).toContain('`0x5d`');
    expect(t.AUTHDATA_NOTE).toContain('`0x1d`');
    expect(t.BACKUP_ROWS.map((r) => r.flags)).toEqual(['`0x5d`', '`0x41`', '—']);
    expect(api.parseAuthData(reg).rpIdHash).toEqual(sha256(t.RP_ID));
    expect(scenario('usb').note).toContain('`0x41`');
  });
});

describe('VERIFY_CODE против @simplewebauthn/server', () => {
  it('каждый сценарий демо: вердикт совпадает с библиотекой, и он такой, как в подписи', async () => {
    const expectOk: Record<string, boolean> = { reg: true, login: true, port: false, replay: false, usb: false };
    for (const s of t.DEMO_SCENARIOS) {
      const ours = await runScenario(api, s, REG);
      const lib = await libVerdict(s.cred, s.expected, s.kind, s.stored);
      expect(ours.ok, s.id).toBe(lib.ok);
      expect(ours.ok, s.id).toBe(expectOk[s.id]);
    }
  });

  it('отказы — по тем причинам, что названы в подписях', async () => {
    const failed = async (id: string) =>
      (await runScenario(api, scenario(id), REG)).checks.filter((c) => c.got !== c.want).map((c) => c.k);
    expect(await failed('port')).toEqual(['origin']);
    expect(await failed('replay')).toEqual(['challenge', 'signCount']);
    expect(await failed('usb')).toEqual(['флаг UV']);
    const port = await runScenario(api, scenario('port'), REG);
    expect(port.checks.find((c) => c.k === 'подпись')?.got).toBe(true);
  });

  it('любой изменённый бит флагов ломает подпись — у нас и у библиотеки', async () => {
    const login = scenario('login');
    const flags = b(login.cred.response.authenticatorData)[32];
    for (let bit = 0; bit < 8; bit++) {
      const s = withFlags(api, login, flags ^ (1 << bit));
      const ours = await runScenario(api, s, REG);
      expect(ours.ok, `бит ${bit}`).toBe(false);
      expect(ours.checks.find((c) => c.k === 'подпись')?.got, `бит ${bit}`).toBe(false);
      expect((await libVerdict(s.cred, s.expected, 'get', 1)).ok, `бит ${bit}`).toBe(false);
    }
  });

  it('чужой challenge, origin, rp.id или байт подписи — отказ у обоих', async () => {
    const login = scenario('login');
    const variants: [string, PasskeyScenario][] = [
      ['challenge', { ...login, expected: { ...login.expected, challenge: S.login2Options.challenge } }],
      ['origin', { ...login, expected: { ...login.expected, origin: 'http://bank-login.localhost:50401' } }],
      ['rp.id', { ...login, expected: { ...login.expected, rpId: 'bank-login.localhost' } }],
      ['счётчик', { ...login, stored: 2 }],
    ];
    const sig = b(login.cred.response.signature!);
    sig[sig.length - 1] ^= 1;
    variants.push(['подпись', { ...login, cred: { ...login.cred, response: { ...login.cred.response, signature: Buffer.from(sig).toString('base64url') } } }]);
    for (const [name, s] of variants) {
      expect((await runScenario(api, s, REG)).ok, name).toBe(false);
      expect((await libVerdict(s.cred, s.expected, 'get', s.stored)).ok, name).toBe(false);
    }
  });

  it('подписаны authenticatorData ‖ SHA-256(clientDataJSON) — независимая проверка node:crypto', () => {
    const key = createPublicKey({ key: Buffer.from(S.reg.response.publicKey!, 'base64url'), format: 'der', type: 'spki' });
    for (const cred of [S.login1, S.login2, S.otherPort]) {
      const signed = Buffer.concat([b(cred.response.authenticatorData), sha256(b(cred.response.clientDataJSON))]);
      expect(verify('sha256', signed, key, b(cred.response.signature!))).toBe(true);
    }
  });
});

describe('derToRaw и DER-подпись', () => {
  it('derToRaw переводит DER в r‖s так же, как node:crypto', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    for (let i = 0; i < 600; i++) {
      const data = Buffer.from(`msg-${i}`);
      const der = new Uint8Array(sign('sha256', data, privateKey));
      const raw = api.derToRaw(der);
      expect(raw).toHaveLength(64);
      expect(verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, raw)).toBe(true);
    }
  });

  it('ветка «короткое число»: r из 31 байта дополняется нулём слева', () => {
    const r = new Uint8Array(31).fill(7);
    const s = new Uint8Array([0, 0x80, ...new Uint8Array(31).fill(9)]);
    const der = new Uint8Array([0x30, 4 + r.length + s.length, 2, r.length, ...r, 2, s.length, ...s]);
    const raw = api.derToRaw(der);
    expect(raw.slice(0, 32)).toEqual(new Uint8Array([0, ...r]));
    expect(raw.slice(32)).toEqual(s.slice(1));
  });

  it('crypto.subtle с DER как есть — false, а не ошибка (тонкое место 01)', async () => {
    const cred = S.login1;
    const auth = api.parseAuthData(b(S.reg.response.authenticatorData));
    const key = await crypto.subtle.importKey('jwk', api.coseToJwk(auth.publicKey!), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const signed = new Uint8Array([...b(cred.response.authenticatorData), ...sha256(b(cred.response.clientDataJSON))]);
    const der = b(cred.response.signature!);
    await expect(crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, der, signed)).resolves.toBe(false);
    await expect(crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, new Uint8Array(api.derToRaw(der)), signed)).resolves.toBe(true);
  });

  it('длины подписей стенда — 70–72 байта, форма 30 … 02 20 … 02 21 00 встречается', () => {
    const sigs = [S.login1, S.login2, S.otherPort].map((c) => b(c.response.signature!));
    for (const s of sigs) {
      expect(s.length).toBeGreaterThanOrEqual(70);
      expect(s.length).toBeLessThanOrEqual(72);
      expect(s[0]).toBe(0x30);
    }
    expect(t.DER_NOTE).toContain('70–72 байта');
    const shaped = sigs.some((s) => s[2] === 2 && s[3] === 0x20 && s[4 + 32] === 2 && s[5 + 32] === 0x21 && s[6 + 32] === 0);
    expect(shaped).toBe(true);
  });
});

describe('утверждения текста о стенде', () => {
  it('clientDataJSON: поля и лишний ключ Chromium', () => {
    const reg = JSON.parse(Buffer.from(S.reg.response.clientDataJSON, 'base64url').toString());
    expect(reg).toEqual({ type: 'webauthn.create', challenge: S.regOptions.challenge, origin: t.ORIGIN, crossOrigin: false });
    const login = JSON.parse(Buffer.from(S.login1.response.clientDataJSON, 'base64url').toString());
    expect(login.other_keys_can_be_added_here).toMatch(/do not compare clientDataJSON against a template/);
    expect(scenario('login').note).toContain('лишнее поле');
    const port = JSON.parse(Buffer.from(S.otherPort.response.clientDataJSON, 'base64url').toString());
    expect(port.origin).toBe('http://bank.localhost:50401');
  });

  it('userHandle — user.id из параметров', () => {
    for (const cred of [S.login1, S.login2]) expect(cred.response.userHandle).toBe(S.regOptions.user.id);
  });

  it('getClientCapabilities: 24 возможности, conditionalGet и passkeyPlatformAuthenticator — true', () => {
    expect(Object.keys(S.capabilities)).toHaveLength(24);
    expect(S.capabilities.conditionalGet).toBe(true);
    expect(S.capabilities.passkeyPlatformAuthenticator).toBe(true);
    expect(t.CONDITIONAL_FACTS.map((f) => f.d).join(' ')).toContain('24 возможности');
  });

  it('CLIENT_CODE и CONDITIONAL_CODE — целые скрипты, и кнопка снимает висящий запрос', () => {
    expect(() => new Function(`${t.CLIENT_CODE}\n${t.CONDITIONAL_CODE}`)).not.toThrow();
    expect(t.CONDITIONAL_CODE).toContain("mediation: 'conditional'");
    expect(t.CONDITIONAL_CODE).toContain('autocomplete="username webauthn"');
    expect(t.CONDITIONAL_CODE).toMatch(/pending\.abort\(\);\s+return login\(\);/);
  });
});
