import { execFileSync, spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, X509Certificate } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/tls-certificates/data';
import { loadVerify, toCertLike } from '@/widgets/tls-lab/model/run';

/**
 * Тема «TLS и сертификаты».
 *
 * `VERIFY_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с Node трижды: на сертификатах стенда против снятых решений `NODE_VERDICTS`,
 * на заменителях демо (`toCertLike`) — те же ответы, и против живого `tls.connect` на
 * сертификатах, которые тест выпускает сам скриптом `MAKE_CA_CODE` из темы. Рукопожатие,
 * 0-RTT, SNI, ALPN, keylog, возобновление и mTLS — запуском `openssl` и `node:tls`.
 *
 * Нужен OpenSSL 3.4+ (флаги `-not_before`/`-not_after`): берётся Homebrew, если он есть,
 * иначе `openssl` из PATH. Длины `ClientHello`/`ServerHello` зависят от версии OpenSSL
 * клиента — сменится версия, покраснеет сверка с `HANDSHAKE_ROWS`, и это нарочно.
 */

const OPENSSL = existsSync('/opt/homebrew/bin/openssl') ? '/opt/homebrew/bin/openssl' : 'openssl';
const ENV = { ...process.env, PATH: `${dirname(OPENSSL)}:${process.env.PATH}` };
const verify = loadVerify(t.VERIFY_CODE);
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'tls-certificates-')));
const rd = (f: string) => readFileSync(join(dir, f), 'utf8');
const ssl = (...args: string[]) => execFileSync(OPENSSL, args, { cwd: dir, env: ENV, stdio: 'pipe' }).toString();

const X = Object.fromEntries(t.CERTS.map((c) => [c.id, new X509Certificate(c.pem)]));
const STAND_NOW = new Date(t.STAND_NOW);

/** Свободный порт: занять нулевой, запомнить, отпустить. */
async function freePort(): Promise<number> {
  const s = netServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

/** Запуск openssl асинхронно: сервер в этом же процессе не должен стоять. */
function sslAsync(args: string[], stdinDelayMs = 800, input = ''): Promise<string> {
  return new Promise((ok) => {
    const p = spawn(OPENSSL, args, { cwd: dir, env: ENV });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    setTimeout(() => p.stdin.end(input), stdinDelayMs);
    p.on('close', () => ok(out));
  });
}

/** Сообщения рукопожатия из `-trace`: «→ ClientHello 1476». */
function parseTrace(txt: string): string[] {
  const out: string[] = [];
  let dir = '';
  for (const line of txt.split('\n')) {
    if (line.startsWith('Sent TLS Record')) dir = '→';
    else if (line.startsWith('Received TLS Record')) dir = '←';
    const m = line.match(/^ {4}(\w+), Length=(\d+)/);
    if (m && dir) out.push(`${dir} ${m[1]} ${m[2]}`);
  }
  return out;
}

interface Probe {
  authorized: boolean;
  error: string | null;
}

/** Сервер с заданной цепочкой и несколько подключений к нему с разными именами и доверием. */
async function probeChain(key: string, cert: string, asks: { host: string; ca?: string }[]): Promise<Probe[]> {
  const srv = tls.createServer({ key, cert }, (s) => s.end());
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  const out: Probe[] = [];
  for (const a of asks) {
    out.push(
      await new Promise<Probe>((ok, fail) => {
        const c = tls.connect({ host: '127.0.0.1', port, servername: a.host, rejectUnauthorized: false, ...(a.ca ? { ca: a.ca } : {}) }, () => {
          const v = { authorized: c.authorized, error: c.authorizationError ? String(c.authorizationError) : null };
          c.end();
          ok(v);
        });
        c.on('error', fail);
      }),
    );
  }
  await new Promise<void>((ok) => srv.close(() => ok()));
  return out;
}

const HOSTS = t.DEMO_HOSTS;
const SENDS = t.DEMO_SENDS.map((s) => s.id);
const isCnFallback = (leaf: string, host: string, code: string | null) =>
  leaf === 'cnonly' && host === 'shop.test' && code === 'ERR_TLS_CERT_ALTNAME_INVALID';

/** Стенд требует OpenSSL 3.4+ (LibreSSL из macOS и OpenSSL 3.0 из Ubuntu не подходят) — без него
 *  блоки с живым `openssl` пропускаются, как git-проверки в `git-internals.test.ts`. */
const OPENSSL_OK = (() => {
  try {
    const [maj, min] = (ssl('version').match(/OpenSSL (\d+)\.(\d+)/) ?? []).slice(1).map(Number);
    return maj > 3 || (maj === 3 && min >= 4);
  } catch {
    return false;
  }
})();

beforeAll(() => {
  if (!OPENSSL_OK) return;
  writeFileSync(join(dir, 'make-ca.sh'), t.MAKE_CA_CODE);
  execFileSync('bash', ['make-ca.sh'], { cwd: dir, env: ENV, stdio: 'pipe' });

  const sign = (csr: string, ca: string, out: string, ext: string, ...dates: string[]) =>
    ssl('x509', '-req', '-in', csr, '-CA', `${ca}.pem`, '-CAkey', `${ca}.key`, '-copy_extensions', 'copy', '-extfile', ext, '-out', out, ...dates);
  sign('shop.csr', 'int', 'expired.pem', 'leaf.ext', '-not_before', '20260101000000Z', '-not_after', '20260401000000Z');
  sign('shop.csr', 'int', 'future.pem', 'leaf.ext', '-not_before', '20990101000000Z', '-not_after', '20990401000000Z');
  ssl('req', '-new', '-key', 'shop.key', '-out', 'cnonly.csr', '-subj', '/CN=shop.test');
  sign('cnonly.csr', 'int', 'cnonly.pem', 'leaf.ext', '-days', '90');
  ssl('req', '-new', '-key', 'shop.key', '-out', 'wild.csr', '-subj', '/CN=*.shop.test', '-addext', 'subjectAltName=DNS:*.shop.test');
  sign('wild.csr', 'int', 'wild.pem', 'leaf.ext', '-days', '90');
  // Просроченный промежуточный (тем же ключом) и обычный лист под ним
  ssl('x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-extfile', 'ca.ext', '-out', 'intold.pem', '-not_before', '20250101000000Z', '-not_after', '20260101000000Z');
  // Самоподписанный лист
  ssl('req', '-x509', '-key', 'shop.key', '-out', 'self.pem', '-days', '90', '-subj', '/CN=shop.test', '-addext', 'subjectAltName=DNS:shop.test');
}, 60_000);

describe.skipIf(!OPENSSL_OK)('сертификаты стенда в теме — настоящие, и заменители демо им не врут', () => {
  it('факты CERTS совпадают с X509Certificate', () => {
    for (const c of t.CERTS) {
      const x = X[c.id];
      expect(c.subject, c.id).toBe(x.subject.replaceAll('\n', ', '));
      expect(c.issuer, c.id).toBe(x.issuer.replaceAll('\n', ', '));
      expect(c.ca, c.id).toBe(x.ca);
      expect(c.san, c.id).toBe(x.subjectAltName ?? null);
      expect(c.from, c.id).toBe(x.validFromDate.toISOString());
      expect(c.to, c.id).toBe(x.validToDate.toISOString());
      expect(c.fp, c.id).toBe(x.fingerprint256);
      expect(c.der, c.id).toBe(x.raw.length);
      expect(c.pem).not.toMatch(/PRIVATE KEY/);
      const ext = execFileSync(OPENSSL, ['x509', '-noout', '-ext', 'subjectKeyIdentifier,authorityKeyIdentifier'], { input: c.pem, env: ENV }).toString();
      expect(ext).toContain(c.ski);
      expect(ext).toContain(c.aki);
    }
  });

  it('checkIssued и verify заменителя совпадают с настоящими на всех парах', () => {
    for (const a of t.CERTS) {
      for (const b of t.CERTS) {
        const la = toCertLike(a);
        const lb = toCertLike(b);
        expect(la.checkIssued(lb), `${a.id} ← ${b.id}`).toBe(X[a.id].checkIssued(X[b.id]));
        expect(la.verify(lb.publicKey), `${a.id} подписан ${b.id}`).toBe(X[a.id].verify(X[b.id].publicKey));
      }
    }
  });

  it('CERT_TEXT — вывод openssl x509 -text по листу из CERTS', () => {
    const shop = t.CERTS.find((c) => c.id === 'shop')!;
    const text = execFileSync(OPENSSL, ['x509', '-noout', '-text', '-certopt', 'no_pubkey,no_sigdump,no_version'], { input: shop.pem, env: ENV }).toString();
    // openssl ставит пробел в конце строк-заголовков расширений; в теме он срезан
    expect(text.trimEnd().split('\n').map((l) => l.trimEnd()).join('\n')).toBe(t.CERT_TEXT);
  });

  it('в данных темы нет закрытых ключей', () => {
    const src = readFileSync(new URL('../../src/content/delivery/tls-certificates/data.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
  });
});

describe('VERIFY_CODE против решений Node, снятых на стенде', () => {
  const run = (useLike: boolean) => {
    const pick = (id: string) => (useLike ? likes[id] : X[id]);
    const likes = Object.fromEntries(t.CERTS.map((c) => [c.id, toCertLike(c)]));
    const out: Record<string, string | null> = {};
    for (const key of Object.keys(t.NODE_VERDICTS)) {
      const [leaf, send, trust, host] = key.split('|');
      const presented = [pick(leaf), ...(send.includes('int') ? [pick('int')] : []), ...(send.includes('root') ? [pick('root')] : [])];
      out[key] = verify({ presented: presented as never[], roots: (trust === 'trust' ? [pick('root')] : []) as never[], host, now: STAND_NOW }).code;
    }
    return out;
  };

  it('150 решений: 148 совпали, два расхождения — лист без SAN, где Node берёт имя из CN', () => {
    const got = run(false);
    const keys = Object.keys(t.NODE_VERDICTS);
    expect(keys).toHaveLength(150);
    const diff = keys.filter((k) => got[k] !== t.NODE_VERDICTS[k]);
    expect(diff).toEqual(['cnonly|leaf+int|trust|shop.test', 'cnonly|leaf+int+root|trust|shop.test']);
    for (const k of diff) {
      expect(t.NODE_VERDICTS[k]).toBeNull();
      expect(got[k]).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    }
    expect(t.DEMO_CAPTION).toContain('только в CN');
  });

  it('демо на заменителях отвечает так же, как на настоящих X509Certificate', () => {
    expect(run(true)).toEqual(run(false));
  });

  it('утверждения текста: порядок ошибок и звёздочка', () => {
    const v = t.NODE_VERDICTS;
    expect(v['expired|leaf|trust|shop.test']).toBe('CERT_HAS_EXPIRED');
    expect(v['shop|leaf|trust|shop.test']).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(v['shop|leaf+int|notrust|shop.test']).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
    expect(v['shop|leaf+int+root|notrust|shop.test']).toBe('SELF_SIGNED_CERT_IN_CHAIN');
    expect(v['cnonly|leaf+int|trust|shop.test']).toBeNull();
    expect(v['wild|leaf+int|trust|api.shop.test']).toBeNull();
    expect(v['wild|leaf+int|trust|shop.test']).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(v['wild|leaf+int|trust|a.b.shop.test']).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
    expect(v['expired|leaf+int|trust|other.test']).toBe('CERT_HAS_EXPIRED');
    const r = verify({ presented: [X.expired], roots: [X.root], host: 'shop.test', now: STAND_NOW });
    expect(r.errors.map((e) => e.code)).toEqual(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED']);
  });
});

describe.skipIf(!OPENSSL_OK)('VERIFY_CODE против живого tls.connect на свежевыпущенных сертификатах', () => {
  it('все листья × наборы × доверие × имена', async () => {
    const leaves: Record<string, string[]> = {
      shop: ['shop.pem', 'int.pem'],
      expired: ['expired.pem', 'int.pem'],
      future: ['future.pem', 'int.pem'],
      cnonly: ['cnonly.pem', 'int.pem'],
      wild: ['wild.pem', 'int.pem'],
      intold: ['shop.pem', 'intold.pem'],
      self: ['self.pem', 'int.pem'],
    };
    const root = rd('root.pem');
    const xr = new X509Certificate(root);
    let compared = 0;
    const seen: Record<string, string | null> = {};
    for (const [leaf, [leafFile, intFile]] of Object.entries(leaves)) {
      for (const send of SENDS) {
        const pems = [rd(leafFile), ...(send.includes('int') ? [rd(intFile)] : []), ...(send.includes('root') ? [root] : [])];
        const asks = HOSTS.flatMap((host) => [{ host, ca: root }, { host }]);
        const node = await probeChain(rd('shop.key'), pems.join(''), asks);
        const now = new Date();
        const presented = pems.map((p) => new X509Certificate(p));
        asks.forEach((a, i) => {
          const got = verify({ presented, roots: a.ca ? [xr] : [], host: a.host, now }).code;
          const want = node[i].error;
          const label = `${leaf} ${send} ${a.ca ? 'trust' : 'notrust'} ${a.host}`;
          seen[label] = want;
          if (isCnFallback(leaf, a.host, got)) expect(want, label).toBeNull();
          else expect(got, label).toBe(want);
          compared++;
        });
      }
    }
    expect(compared).toBe(7 * 3 * 2 * 5);
    // VERIFY_NOTE: просроченный промежуточный без корня у клиента — «нет издателя», не «просрочен»
    expect(seen['intold leaf+int notrust shop.test']).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
    expect(seen['intold leaf+int trust shop.test']).toBe('CERT_HAS_EXPIRED');
    expect(seen['self leaf trust shop.test']).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    expect(t.VERIFY_NOTE).toContain('`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, а не «просрочен»');
  }, 60_000);

  it('промежуточный без CA:TRUE — INVALID_CA, как у openssl verify (Node называет это INVALID_PURPOSE)', async () => {
    // Свой маленький УЦ без pathlen: иначе к INVALID_CA добавится ошибка длины пути
    writeFileSync(join(dir, 'fake.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyCertSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
    ssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-noenc', '-keyout', 'r2.key', '-out', 'r2.pem', '-days', '30', '-subj', '/CN=Root Two', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign');
    ssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-noenc', '-keyout', 'fake.key', '-out', 'fake.csr', '-subj', '/CN=Not A CA');
    ssl('x509', '-req', '-in', 'fake.csr', '-CA', 'r2.pem', '-CAkey', 'r2.key', '-extfile', 'fake.ext', '-days', '30', '-out', 'fake.pem');
    ssl('x509', '-req', '-in', 'shop.csr', '-CA', 'fake.pem', '-CAkey', 'fake.key', '-copy_extensions', 'copy', '-extfile', 'leaf.ext', '-days', '30', '-out', 'under.pem');
    const [leaf, fake, r2] = ['under.pem', 'fake.pem', 'r2.pem'].map((f) => new X509Certificate(rd(f)));
    const r = verify({ presented: [leaf, fake], roots: [r2], host: 'shop.test', now: new Date() });
    expect(r.code).toBe('INVALID_CA');
    let openssl = '';
    try {
      ssl('verify', '-CAfile', 'r2.pem', '-untrusted', 'fake.pem', 'under.pem');
    } catch (e) {
      openssl = String((e as { stdout: Buffer }).stdout) + String((e as { stderr: Buffer }).stderr);
    }
    expect(openssl).toContain('invalid CA certificate');
    const [node] = await probeChain(rd('shop.key'), rd('under.pem') + rd('fake.pem'), [{ host: 'shop.test', ca: rd('r2.pem') }]);
    expect(node.error).toBe('INVALID_PURPOSE');
  });
});

describe.skipIf(!OPENSSL_OK)('рукопожатие TLS 1.3: openssl s_client -trace против node:tls', () => {
  async function handshake(extra: string[], withInt = true) {
    const srv = tls.createServer({ key: rd('shop.key'), cert: rd('shop.pem') + (withInt ? rd('int.pem') : ''), ALPNProtocols: ['h2', 'http/1.1'] }, (s) => {
      s.on('error', () => {});
      s.end('ok');
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const out = await sslAsync(['s_client', '-connect', `127.0.0.1:${port}`, '-servername', 'shop.test', '-alpn', 'h2,http/1.1', '-tls1_3', '-CAfile', 'root.pem', '-trace', ...extra]);
    await new Promise<void>((ok) => srv.close(() => ok()));
    return out;
  }

  it('сообщения и длины — как в HANDSHAKE_ROWS', async () => {
    const out = await handshake([]);
    const msgs = parseTrace(out);
    const names = msgs.map((m) => m.split(' ').slice(0, 2).join(' '));
    expect(names).toEqual([
      '→ ClientHello', '← ServerHello', '← EncryptedExtensions', '← Certificate', '← CertificateVerify',
      '← Finished', '→ Finished', '← NewSessionTicket', '← NewSessionTicket',
    ]);
    const len = (name: string) => Number(msgs.find((m) => m.startsWith(name))!.split(' ')[2]);
    const row = (msg: string) => t.HANDSHAKE_ROWS.find((r) => r.msg.startsWith(msg))!;
    expect(len('→ ClientHello')).toBe(row('ClientHello').bytes);
    expect(len('← ServerHello')).toBe(row('ServerHello').bytes);
    expect(len('← EncryptedExtensions')).toBe(row('EncryptedExtensions').bytes);
    expect(len('← Finished')).toBe(48);
    expect(len('← NewSessionTicket')).toBe(row('NewSessionTicket').bytes);
    // Certificate: 4 байта заголовка списка + на каждый сертификат 3 байта длины + DER + 2 байта расширений
    const ders = [rd('shop.pem'), rd('int.pem')].map((p) => new X509Certificate(p).raw.length);
    expect(len('← Certificate')).toBe(4 + ders.reduce((s, d) => s + d + 5, 0));
    const [leafDer, intDer] = ['shop', 'int'].map((id) => t.CERTS.find((c) => c.id === id)!.der);
    expect(row('Certificate').bytes).toBe(4 + leafDer + 5 + intDer + 5);
    expect(row('Certificate').what).toContain(`${leafDer} байт`);
    // Подпись ECDSA в DER — 70–72 байта, плюс 4 байта алгоритма и длины
    expect(len('← CertificateVerify')).toBeGreaterThanOrEqual(74);
    expect(len('← CertificateVerify')).toBeLessThanOrEqual(row('CertificateVerify').bytes);
    expect(out).toContain('NamedGroup: X25519MLKEM768');
    expect(out).toMatch(/key_exchange: {2}\(len=1216\)/);
    expect(out).toMatch(/key_exchange: {2}\(len=1120\)/);
    expect(out).toContain('TLS_AES_256_GCM_SHA384');
    expect(out).toContain('ALPN protocol: h2');
    expect(out).toContain('ticket_lifetime_hint=7200');
    expect(out).toContain('Verify return code: 0 (ok)');
  }, 30_000);

  it('только x25519 — 242 и 118 байт; без промежуточного — код 21', async () => {
    const msgs = parseTrace(await handshake(['-groups', 'X25519']));
    expect(msgs[0]).toBe('→ ClientHello 242');
    expect(msgs[1]).toBe('← ServerHello 118');
    expect(t.PQ_NOTE).toContain('242 байта');
    expect(t.PQ_NOTE).toContain('118');
    const leafOnly = await handshake([], false);
    expect(leafOnly).toContain('Verify return code: 21 (unable to verify the first certificate)');
  }, 30_000);
});

describe.skipIf(!OPENSSL_OK)('ключи, возобновление, SNI, ALPN и mTLS — node:tls', () => {
  const opts = () => ({ key: rd('shop.key'), cert: rd('shop.pem') + rd('int.pem') });

  it('keylog — пять секретов; второй заход с билетом — isSessionReused', async () => {
    const srv = tls.createServer({ ...opts(), ALPNProtocols: ['h2', 'http/1.1'] }, (s) => {
      s.on('error', () => {});
      s.end('ok');
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const labels = new Set<string>();
    let session: Buffer | undefined;
    const go = (s?: Buffer) =>
      new Promise<boolean>((ok) => {
        const c = tls.connect({ port, host: '127.0.0.1', servername: 'shop.test', ca: rd('root.pem'), session: s });
        c.on('keylog', (line) => labels.add(String(line).split(' ')[0]));
        c.on('session', (sess) => (session = sess));
        c.on('data', () => {});
        c.on('end', () => ok(c.isSessionReused()));
      });
    expect(await go()).toBe(false);
    expect(session).toBeDefined();
    expect(await go(session)).toBe(true);
    await new Promise<void>((ok) => srv.close(() => ok()));
    for (const l of labels) expect(t.KEYS_NOTE).toContain(`\`${l}\``);
    expect([...labels].sort()).toEqual([
      'CLIENT_HANDSHAKE_TRAFFIC_SECRET', 'CLIENT_TRAFFIC_SECRET_0', 'EXPORTER_SECRET',
      'SERVER_HANDSHAKE_TRAFFIC_SECRET', 'SERVER_TRAFFIC_SECRET_0',
    ]);
    expect(t.RESUME_LEAD).toContain('isSessionReused() === true');
  });

  it('SNI выбирает сертификат, без имени — сертификат по умолчанию; ALPN без общего — сигнал 120', async () => {
    const shopCtx = tls.createSecureContext(opts());
    const wildCtx = tls.createSecureContext({ key: rd('shop.key'), cert: rd('wild.pem') + rd('int.pem') });
    const seen: string[] = [];
    const srv = tls.createServer(
      {
        key: rd('shop.key'),
        cert: rd('cnonly.pem') + rd('int.pem'),
        ALPNProtocols: ['h2', 'http/1.1'],
        SNICallback: (name, cb) => {
          seen.push(name);
          cb(null, name.endsWith('.shop.test') ? wildCtx : shopCtx);
        },
      },
      (s) => s.end(),
    );
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const go = (o: tls.ConnectionOptions) =>
      new Promise<{ cn?: string; alpn?: string | false | null; error: string | null; code?: string }>((ok) => {
        const c = tls.connect({ port, host: '127.0.0.1', ca: rd('root.pem'), rejectUnauthorized: false, ...o }, () => {
          const v = { cn: c.getPeerCertificate().subject?.CN as string, alpn: c.alpnProtocol, error: c.authorizationError ? String(c.authorizationError) : null };
          c.end();
          ok(v);
        });
        c.on('error', (e: NodeJS.ErrnoException) => ok({ error: null, code: e.code }));
      });
    expect(await go({ servername: 'api.shop.test', ALPNProtocols: ['http/1.1'] })).toMatchObject({ cn: '*.shop.test', alpn: 'http/1.1', error: null });
    expect(await go({ ALPNProtocols: ['h2'] })).toMatchObject({ cn: 'shop.test', alpn: 'h2', error: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    expect(await go({ servername: 'shop.test', ALPNProtocols: ['spdy/3'] })).toMatchObject({ code: 'ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL' });
    expect(await go({ servername: 'shop.test' })).toMatchObject({ alpn: false, error: null });
    // При ALPN без общего протокола до SNICallback дело не доходит: отказ раньше
    expect(seen).toEqual(['api.shop.test', 'shop.test']);
    await new Promise<void>((ok) => srv.close(() => ok()));
    const text = t.SNI_FACTS.map((f) => f.d).join(' ');
    for (const s of ['ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL', '`alpnProtocol: false`', '120']) expect(text).toContain(s);
  });

  it('mTLS: без сертификата клиента secureConnect срабатывает, отказ приходит следом', async () => {
    writeFileSync(join(dir, 'client.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\n');
    ssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-noenc', '-keyout', 'client.key', '-out', 'client.csr', '-subj', '/CN=billing-service');
    ssl('x509', '-req', '-in', 'client.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-extfile', 'client.ext', '-days', '30', '-out', 'client.pem');
    const serverErrors: string[] = [];
    const peers: unknown[] = [];
    const srv = tls.createServer({ ...opts(), requestCert: true, rejectUnauthorized: true, ca: rd('root.pem') }, (s) => {
      peers.push(s.getPeerCertificate().subject?.CN);
      s.end('hi');
    });
    srv.on('tlsClientError', (e: NodeJS.ErrnoException) => serverErrors.push(e.code ?? ''));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    const port = (srv.address() as { port: number }).port;
    const go = (extra: tls.ConnectionOptions) =>
      new Promise<{ secure: boolean; error?: string }>((ok) => {
        let secure = false;
        const c = tls.connect({ port, host: '127.0.0.1', servername: 'shop.test', ca: rd('root.pem'), ...extra }, () => (secure = true));
        c.on('data', () => {});
        c.on('error', (e: NodeJS.ErrnoException) => ok({ secure, error: e.code }));
        c.on('close', () => ok({ secure }));
      });
    expect(await go({ key: rd('client.key'), cert: rd('client.pem') + rd('int.pem') })).toEqual({ secure: true });
    expect(await go({})).toEqual({ secure: true, error: 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED' });
    await new Promise<void>((ok) => srv.close(() => ok()));
    expect(peers).toEqual(['billing-service']);
    expect(serverErrors).toEqual(['ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE']);
    const text = t.MTLS_FACTS.map((f) => f.d).join(' ');
    for (const s of ['CN=billing-service', 'ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED', 'ERR_SSL_PEER_DID_NOT_RETURN_A_CERTIFICATE']) expect(text).toContain(s);
  });
});

describe.skipIf(!OPENSSL_OK)('0-RTT: повтор ранних данных — openssl s_server с защитой и без', () => {
  async function scenario(mode: 'anti_replay' | 'no_anti_replay') {
    writeFileSync(join(dir, 'early.txt'), 'POST /pay HTTP/1.1\r\nHost: shop.test\r\n\r\n');
    const port = await freePort();
    const server = sslAsync(['s_server', '-accept', String(port), '-cert', 'shop.pem', '-key', 'shop.key', '-cert_chain', 'int.pem', '-early_data', `-${mode}`, '-max_early_data', '16384', '-naccept', '3', '-quiet'], 60_000);
    await new Promise((ok) => setTimeout(ok, 500));
    const base = ['s_client', '-connect', `127.0.0.1:${port}`, '-servername', 'shop.test', '-CAfile', 'root.pem'];
    const sess = `sess-${mode}.pem`;
    const pick = (s: string) => s.split('\n').filter((l) => /^(New|Reused),|Early data/.test(l)).join(' | ');
    const c1 = pick(await sslAsync([...base, '-sess_out', sess], 600));
    const c2 = pick(await sslAsync([...base, '-sess_in', sess, '-early_data', 'early.txt'], 600));
    const c3 = pick(await sslAsync([...base, '-sess_in', sess, '-early_data', 'early.txt'], 600));
    const served = await server;
    return { c1, c2, c3, posts: served.split('POST /pay').length - 1 };
  }

  it('с защитой второй повтор отклонён, POST один; без неё — два', async () => {
    const on = await scenario('anti_replay');
    expect(on.c1).toMatch(/^New,.*Early data was not sent/);
    expect(on.c2).toMatch(/^Reused,.*Early data was accepted/);
    expect(on.c3).toMatch(/^New,.*Early data was rejected/);
    expect(on.posts).toBe(1);
    const off = await scenario('no_anti_replay');
    expect(off.c2).toMatch(/^Reused,.*Early data was accepted/);
    expect(off.c3).toMatch(/^Reused,.*Early data was accepted/);
    expect(off.posts).toBe(2);
    expect(t.ZERO_RTT_ROWS.at(-1)).toMatchObject({ on: '**1** раз', off: '**2** раза' });
  }, 60_000);
});

describe('ACME_CODE против векторов RFC', () => {
  const acme = new Function('createHash', `${t.ACME_CODE}\nreturn { thumbprint, keyAuthorization, dns01Value, ariCertId };`)(createHash) as {
    thumbprint(jwk: Record<string, string>): string;
    keyAuthorization(token: string, jwk: Record<string, string>): string;
    dns01Value(token: string, jwk: Record<string, string>): string;
    ariCertId(aki: string, serial: string): string;
  };

  it('отпечаток ключа — пример RFC 7638, раздел 3.1', () => {
    const jwk = {
      kty: 'RSA',
      n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw',
      e: 'AQAB',
      alg: 'RS256',
      kid: '2011-04-29',
    };
    expect(acme.thumbprint(jwk)).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
  });

  it('ключ авторизации и TXT для dns-01 на ключе EC из node:crypto', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, string>;
    const token = 'evaGxfADs6pSRb2LAv9IZf17Dt3juxGJ-PCt92wr-oA';
    const tp = createHash('sha256').update(`{"crv":"${jwk.crv}","kty":"EC","x":"${jwk.x}","y":"${jwk.y}"}`).digest('base64url');
    expect(acme.keyAuthorization(token, jwk)).toBe(`${token}.${tp}`);
    expect(acme.dns01Value(token, jwk)).toBe(createHash('sha256').update(`${token}.${tp}`).digest('base64url'));
    expect(acme.dns01Value(token, jwk)).toHaveLength(43);
  });

  it('идентификатор ARI — пример RFC 9773, раздел 4.1', () => {
    expect(acme.ariCertId('69:88:5B:6B:87:46:40:41:E1:B3:7B:84:7B:A0:AE:2C:DE:01:C8:D4', '00:87:65:43:21')).toBe('aYhba4dGQEHhs3uEe6CuLN4ByNQ.AIdlQyE');
  });
});

describe('сроки в таблице совпадают с Baseline Requirements (выписка из раздела 6.3.2)', () => {
  it('398 → 200 → 100 → 47 и даты 15 марта', () => {
    const rows = t.LIFETIME_ROWS.slice(0, 4).map((r) => `${r.k} ${r.v}`);
    expect(rows).toEqual(['до 15.03.2026 398 дней', 'с 15.03.2026 200 дней', 'с 15.03.2027 100 дней', 'с 15.03.2029 **47 дней**']);
  });
});
