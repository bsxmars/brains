import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/supply-chain/data';
import { fill, fromBase64, gunzipOk, loadSri, npmOutcome, upperAlg } from '@/widgets/supply-lab/model/run';
import type { Mode } from '@/widgets/supply-lab/model/types';

/**
 * Тема «Безопасность цепочки поставок».
 *
 * Тест и есть стенд темы (см. шапку `data.ts`): он пакует фикстуру `greeter` настоящим
 * `npm pack`, ставит её npm, портит байты тарбола, поднимает учебные реестры на `node:http`
 * (127.0.0.1:4981 — «внутренний», 4982 — «публичный», 4985 — прокси, сливающий оба) и Chromium
 * с сайтом и CDN (4983, 4984). Литералы темы сверяются с тем, что ответили npm и Chromium сейчас.
 *
 * `SRI_CODE` — строка из темы, её же исполняет демо. Здесь `integrityOf` сверяется с `ssri`
 * и `node:crypto`, `checkIntegrity` в режиме `npm` — с `ssri.checkData`, в режиме `browser` —
 * с тем, выполнил ли Chromium скрипт с таким атрибутом.
 *
 * npm вызывается асинхронно: реестры живут в этом же процессе, и `execFileSync` заблокировал
 * бы им цикл событий — установка повисла бы, ожидая ответа от самой себя (поймано на стенде).
 * `npm audit signatures` и pnpm здесь не прогоняются — см. шапку `data.ts`.
 */

/** `ssri` без пакета типов: описаны только те вызовы, что нужны тесту. */
interface SsriIntegrity {
  toString(): string;
  pickAlgorithm(): string;
}
const ssri = createRequire(import.meta.url)('ssri') as {
  fromData(data: Buffer, opts: { algorithms: string[] }): SsriIntegrity;
  checkData(data: Buffer, sri: string): unknown;
  parse(sri: string): SsriIntegrity | null;
};

const sri = loadSri(t.SRI_CODE);
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'supply-chain-')));
const EMPTY_RC = join(dir, 'empty.npmrc');
let cacheN = 0;

interface Run {
  code: number;
  out: string;
}

function npm(cwd: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const full = [...args, '--userconfig', EMPTY_RC, '--cache', join(dir, `cache${cacheN++}`), '--no-audit', '--no-fund', '--no-update-notifier', '--fetch-retries=0'];
  return new Promise((resolve) => {
    execFile('npm', full, { cwd, env: { ...process.env, ...env, npm_config_loglevel: 'warn' }, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      const code = err ? Number((err as { code?: number }).code ?? 1) : 0;
      resolve({ code, out: (stdout + stderr).replaceAll(dir, '<dir>') });
    });
  });
}

function writePkg(at: string, files: Record<string, string>) {
  mkdirSync(at, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(at, name), text);
}

async function pack(at: string, ignoreScripts = true): Promise<{ file: string; integrity: string; size: number }> {
  const r = await npm(at, ['pack', '--json', ...(ignoreScripts ? ['--ignore-scripts'] : [])]);
  const j = JSON.parse(r.out.slice(r.out.indexOf('[\n'), r.out.lastIndexOf('\n]') + 2)) as { filename: string; integrity: string; size: number }[];
  return { file: join(at, j[0].filename), integrity: j[0].integrity, size: j[0].size };
}

function app(name: string, deps: Record<string, string> = {}, npmrc = ''): string {
  const d = join(dir, name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', private: true, dependencies: deps }, null, 2));
  if (npmrc) writeFileSync(join(d, '.npmrc'), npmrc);
  return d;
}

const readLog = (d: string) => (existsSync(join(d, 'lifecycle.log')) ? readFileSync(join(d, 'lifecycle.log'), 'utf8') : null);
const events = (log: string | null) => (log ?? '').trim().split('\n').map((l) => l.split(' ')[0]);
const sha512 = (b: Uint8Array) => 'sha512-' + createHash('sha512').update(b).digest('base64');

const GREETER = { 'package.json': t.GREETER_PACKAGE_JSON, 'index.js': t.GREETER_INDEX_JS, 'log.js': t.GREETER_LOG_JS };
let tarball: Buffer;

beforeAll(async () => {
  writeFileSync(EMPTY_RC, '');
  writePkg(join(dir, 'pkg'), GREETER);
  const p = await pack(join(dir, 'pkg'));
  tarball = readFileSync(p.file);
}, 60_000);

// ─── Раздел 1. Скрипты установки ──────────────────────────────────────────────────────────

describe('скрипты установки — как в теме', () => {
  it('фикстура пакуется в тот же тарбол байт в байт, integrity — sha512 архива', async () => {
    expect(tarball.toString('base64')).toBe(t.DEMO.tarball);
    expect(sha512(tarball)).toBe(t.LOCK_INTEGRITY);
    expect(tarball.length).toBe(602);
    // повторная упаковка — тот же хеш
    rmSync(join(dir, 'pkg', 'greeter-1.0.0.tgz'));
    const again = await pack(join(dir, 'pkg'));
    expect(again.integrity).toBe(t.LOCK_INTEGRITY);
  }, 60_000);

  it('npm install тарбола: три скрипта по порядку, окружение видно; lock-запись — как напечатана', async () => {
    const d = app('a-install');
    copyFileSync(join(dir, 'pkg/greeter-1.0.0.tgz'), join(d, 'greeter-1.0.0.tgz'));
    const r = await npm(d, ['install', './greeter-1.0.0.tgz'], { DEMO_TOKEN: 'demo' });
    expect(r.code).toBe(0);
    expect(readLog(d)).toBe(t.LIFECYCLE_LOG);
    expect(t.INSTALL_RUN_CODE).toContain('DEMO_TOKEN=demo npm install ./greeter-1.0.0.tgz');
    const lock = JSON.parse(readFileSync(join(d, 'package-lock.json'), 'utf8'));
    expect({ 'node_modules/greeter': lock.packages['node_modules/greeter'] }).toEqual(JSON.parse(`{${t.LOCK_ENTRY_CODE}}`));
    expect(lock.lockfileVersion).toBe(3);

    // npm ci по тому же lock-файлу — снова три скрипта
    rmSync(join(d, 'node_modules'), { recursive: true });
    rmSync(join(d, 'lifecycle.log'));
    expect((await npm(d, ['ci'])).code).toBe(0);
    expect(events(readLog(d))).toEqual(['preinstall', 'install', 'postinstall']);
    // и npm rebuild — ещё раз
    rmSync(join(d, 'lifecycle.log'));
    expect((await npm(d, ['rebuild'])).code).toBe(0);
    expect(events(readLog(d))).toEqual(['preinstall', 'install', 'postinstall']);
  }, 60_000);

  it('--ignore-scripts: пакет на месте, журнала нет', async () => {
    const d = app('a-ignore');
    copyFileSync(join(dir, 'pkg/greeter-1.0.0.tgz'), join(d, 'greeter-1.0.0.tgz'));
    const r = await npm(d, ['install', './greeter-1.0.0.tgz', '--ignore-scripts'], { DEMO_TOKEN: 'demo' });
    expect(r.code).toBe(0);
    expect(existsSync(join(d, 'node_modules/greeter/index.js'))).toBe(true);
    expect(readLog(d)).toBeNull();
    expect(t.IGNORE_SCRIPTS_CODE).toContain('No such file or directory');

    // и postinstall самого проекта — тоже (IGNORE_SCRIPTS_NOTE)
    const root = app('a-root');
    const pj = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    pj.scripts = { postinstall: "node -e \"require('fs').writeFileSync('root.txt', 'x')\"" };
    writeFileSync(join(root, 'package.json'), JSON.stringify(pj));
    expect((await npm(root, ['install', '--ignore-scripts'])).code).toBe(0);
    expect(existsSync(join(root, 'root.txt'))).toBe(false);
    expect((await npm(root, ['install'])).code).toBe(0);
    expect(existsSync(join(root, 'root.txt'))).toBe(true);
    expect(t.IGNORE_SCRIPTS_NOTE).toContain('`postinstall` в вашем `package.json` тоже не выполнятся');
  }, 60_000);

  it('npm pack без --ignore-scripts запускает prepare у автора', async () => {
    const at = join(dir, 'pkg-prepare');
    writePkg(at, GREETER);
    // INIT_CWD у pack — папка пакета: журнал появится в ней
    await pack(at, false);
    expect(events(readLog(at))).toEqual(['prepare']);
  }, 60_000);
});

// ─── Раздел 2. Подмена тарбола ────────────────────────────────────────────────────────────

describe('подмена тарбола: npm ci по lock-файлу', () => {
  /** Подменить тарбол в проекте с lock-файлом и запустить npm ci. */
  async function ciWith(bytes: Uint8Array, name: string): Promise<Run> {
    const d = app(name);
    writeFileSync(join(d, 'greeter-1.0.0.tgz'), tarball);
    expect((await npm(d, ['install', './greeter-1.0.0.tgz', '--ignore-scripts'])).code).toBe(0);
    writeFileSync(join(d, 'greeter-1.0.0.tgz'), bytes);
    rmSync(join(d, 'node_modules'), { recursive: true });
    return npm(d, ['ci', '--ignore-scripts']);
  }
  const flip = (i: number) => {
    const b = Buffer.from(tarball);
    b[i] ^= 1;
    return b;
  };
  const errorLines = (out: string) => out.split('\n').filter((l) => l.startsWith('npm error') && !l.includes('complete log')).join('\n');

  it('байт 9 заголовка gzip: EINTEGRITY с wanted/got, как в шаблоне демо', async () => {
    const bad = flip(9);
    const r = await ciWith(bad, 'b-header');
    expect(r.code).not.toBe(0);
    expect(errorLines(r.out)).toBe(fill(t.NPM_INTEGRITY_ERROR, { wanted: t.LOCK_INTEGRITY, alg: 'sha512', got: sha512(bad), size: bad.length }));
    expect(r.out.match(/seems to be corrupted\. Trying again\./g)).toHaveLength(2);
    expect(await gunzipOk(bad)).toBe(true);
  }, 60_000);

  it('байт в сжатых данных: Z_DATA_ERROR раньше хеша', async () => {
    const bad = flip(tarball.length - 20);
    const r = await ciWith(bad, 'b-data');
    expect(r.code).not.toBe(0);
    expect(errorLines(r.out)).toBe(`${t.NPM_ZLIB_ERROR}\nnpm error errno -3\nnpm error zlib: incorrect data check\nnpm error cause incorrect data check`);
    expect(await gunzipOk(bad)).toBe(false);
  }, 60_000);

  it('npmOutcome из демо совпадает с npm на байтах подписи, заголовка, данных и хвоста', async () => {
    const n = tarball.length;
    for (const i of [0, 1, 2, 3, 4, 9, 10, 12, n - 20, n - 8, n - 1]) {
      const bad = flip(i);
      const r = await ciWith(bad, `b-flip-${i}`);
      const code = /npm error code (\w+)/.exec(r.out)?.[1];
      const want = await npmOutcome(bad);
      expect(code, `байт ${i}`).toBe(want === 'zlib' ? 'Z_DATA_ERROR' : 'EINTEGRITY');
    }
  }, 180_000);

  it('пересобранный архив с правкой index.js: EINTEGRITY, вывод — как напечатан', async () => {
    const at = join(dir, 'pkg-evil');
    writePkg(at, { ...GREETER, 'index.js': t.GREETER_INDEX_JS.replace("+ name;", "+ name + '!';") });
    const evil = readFileSync((await pack(at)).file);
    const r = await ciWith(evil, 'b-repack');
    expect(errorLines(r.out)).toBe(fill(t.NPM_INTEGRITY_ERROR, { wanted: t.LOCK_INTEGRITY, alg: 'sha512', got: sha512(evil), size: evil.length }));
    // EINTEGRITY_CODE напечатан с теми же хешами и размером
    for (const line of t.EINTEGRITY_CODE.split('\n').filter((l) => l.startsWith('npm error'))) expect(r.out).toContain(line);
    expect(t.EINTEGRITY_CODE).toContain(sha512(evil));
    expect(t.EINTEGRITY_CODE).toContain(`(${evil.length} bytes)`);
  }, 60_000);

  it('демо честно предсказывает, где упадёт распаковка: DecompressionStream = zlib на каждом байте', async () => {
    for (let i = 0; i < tarball.length; i++) {
      const bad = flip(i);
      let zlibOk = true;
      try {
        gunzipSync(bad);
      } catch {
        zlibOk = false;
      }
      expect(await gunzipOk(bad), `байт ${i}`).toBe(zlibOk);
    }
  }, 60_000);
});

// ─── Учебные реестры ──────────────────────────────────────────────────────────────────────

interface Version {
  tarball: Buffer;
  integrity?: string;
  time?: string;
}
type Pkgs = Record<string, { versions: Record<string, Version> }>;

function registry(port: number, pkgs: Pkgs, log: string[]): Promise<Server> {
  const base = `http://127.0.0.1:${port}`;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    log.push(`${port} ${url}`);
    const tm = /^\/(.+)\/-\/.+-(\d+\.\d+\.\d+)\.tgz$/.exec(url);
    if (tm && pkgs[tm[1]]?.versions[tm[2]]) {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(pkgs[tm[1]].versions[tm[2]].tarball);
      return;
    }
    const name = url.slice(1);
    const p = pkgs[name];
    if (!p) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    const versions: Record<string, unknown> = {};
    const time: Record<string, string> = {};
    for (const [ver, v] of Object.entries(p.versions)) {
      versions[ver] = { name, version: ver, dist: { tarball: `${base}/${name}/-/${name.split('/').pop()}-${ver}.tgz`, integrity: v.integrity ?? sha512(v.tarball) } };
      time[ver] = v.time ?? '2026-01-10T10:00:00.000Z';
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ name, 'dist-tags': { latest: Object.keys(p.versions).at(-1) }, versions, time }));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r(server)));
}

async function packSimple(name: string, version: string, index: string): Promise<Buffer> {
  const at = join(dir, 'reg-src', `${name.replace('/', '+')}-${version}-${createHash('md5').update(index).digest('hex').slice(0, 6)}`);
  writePkg(at, { 'package.json': JSON.stringify({ name, version, main: 'index.js' }, null, 2) + '\n', 'index.js': index });
  return readFileSync((await pack(at)).file);
}

describe('реестры: подмена, путаница зависимостей, --before, sbom', () => {
  const log: string[] = [];
  const internal: Pkgs = {};
  const pub: Pkgs = {};
  const servers: Server[] = [];
  const I = 'http://127.0.0.1:4981/';
  const P = 'http://127.0.0.1:4982/';
  const M = 'http://127.0.0.1:4985/';

  beforeAll(async () => {
    const good = await packSimple('greeter', '1.0.0', "module.exports = (n) => 'Привет, ' + n;\n");
    const v11 = await packSimple('greeter', '1.1.0', "module.exports = (n) => 'Здравствуйте, ' + n;\n");
    internal.greeter = { versions: { '1.0.0': { tarball: good, time: '2026-01-10T10:00:00.000Z' }, '1.1.0': { tarball: v11, time: '2026-10-01T09:00:00.000Z' } } };
    internal['acme-utils'] = { versions: { '1.2.0': { tarball: await packSimple('acme-utils', '1.2.0', "module.exports = 'внутренний';\n") } } };
    internal['@acme/utils'] = { versions: { '1.2.0': { tarball: await packSimple('@acme/utils', '1.2.0', "module.exports = 'внутренний';\n") } } };
    pub['acme-utils'] = { versions: { '1.99.0': { tarball: await packSimple('acme-utils', '1.99.0', "module.exports = 'чужой';\n") } } };
    pub['@acme/utils'] = { versions: { '1.99.0': { tarball: await packSimple('@acme/utils', '1.99.0', "module.exports = 'чужой';\n") } } };
    servers.push(await registry(4981, internal, log), await registry(4982, pub, log));
    // Сливающий прокси: один адрес, документ пакета — объединение версий двух реестров.
    const get = (port: number, path: string) => fetch(`http://127.0.0.1:${port}${path}`).then((r) => (r.ok ? r.json() : null));
    const proxy = createServer(async (req, res) => {
      const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
      log.push(`4985 ${url}`);
      const [a, b] = await Promise.all([get(4981, url), get(4982, url)]);
      if (!a && !b) {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      const versions = { ...(a?.versions ?? {}), ...(b?.versions ?? {}) };
      const latest = Object.keys(versions).sort((x, y) => x.localeCompare(y, 'en', { numeric: true })).at(-1);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ...(b ?? a), versions, time: { ...(a?.time ?? {}), ...(b?.time ?? {}) }, 'dist-tags': { latest } }));
    });
    await new Promise<void>((r) => proxy.listen(4985, '127.0.0.1', r));
    servers.push(proxy);
  }, 60_000);

  afterAll(() => {
    for (const s of servers) s.close();
  });

  const installed = (d: string) => {
    const l = JSON.parse(readFileSync(join(d, 'package-lock.json'), 'utf8')).packages;
    const e = l['node_modules/acme-utils'] ?? l['node_modules/@acme/utils'] ?? l['node_modules/greeter'];
    return { version: e.version as string, resolved: e.resolved as string, integrity: e.integrity as string };
  };
  const asked = () => [...new Set(log.filter((l) => !l.includes('/-/')).map((l) => l.split(' ')[0]))].sort();

  it('подменён тарбол на реестре: свежая установка ловит по dist.integrity; подменены оба — верит, а npm ci по lock — нет', async () => {
    const d = app('r-first', { greeter: '1.0.0' }, `registry=${I}\n`);
    expect((await npm(d, ['install'])).code).toBe(0);
    const good = internal.greeter.versions['1.0.0'];
    const evil = await packSimple('greeter', '1.0.0', "module.exports = (n) => 'Привет, ' + n + '!';\n");
    try {
      internal.greeter.versions['1.0.0'] = { ...good, tarball: evil, integrity: sha512(good.tarball) };
      let r = await npm(app('r-only-tarball', { greeter: '1.0.0' }, `registry=${I}\n`), ['install']);
      expect(r.out).toContain('npm error code EINTEGRITY');
      expect(t.REGISTRY_ROWS[0].fresh).toContain('`EINTEGRITY`');

      internal.greeter.versions['1.0.0'] = { ...good, tarball: evil };
      r = await npm(app('r-both', { greeter: '1.0.0' }, `registry=${I}\n`), ['install']);
      expect(r.code).toBe(0);
      expect(t.REGISTRY_ROWS[1].fresh).toContain('**ставит**');

      rmSync(join(d, 'node_modules'), { recursive: true });
      r = await npm(d, ['ci']);
      expect(r.out).toContain('npm error code EINTEGRITY');
      expect(r.out).toContain(`wanted ${sha512(good.tarball)} but got ${sha512(evil)}`);
    } finally {
      internal.greeter.versions['1.0.0'] = good;
    }
  }, 120_000);

  it('путаница зависимостей: какая версия встала и кого спросил npm — строки CONFUSION_ROWS', async () => {
    const cases: [Record<string, string>, string, string, string[]][] = [
      [{ 'acme-utils': '^1.2.0' }, `registry=${I}\n`, '1.2.0', ['4981']],
      [{ 'acme-utils': '^1.2.0' }, `registry=${P}\n`, '1.99.0', ['4982']],
      [{ 'acme-utils': '^1.2.0' }, `registry=${M}\n`, '1.99.0', ['4981', '4982', '4985']],
      [{ 'acme-utils': '1.2.0' }, `registry=${M}\n`, '1.2.0', ['4981', '4982', '4985']],
      [{ '@acme/utils': '^1.2.0' }, `registry=${M}\n@acme:registry=${I}\n`, '1.2.0', ['4981']],
      [{ '@acme/utils': '^1.2.0' }, `registry=${M}\n`, '1.99.0', ['4981', '4982', '4985']],
    ];
    expect(t.CONFUSION_ROWS).toHaveLength(cases.length + 1);
    let i = 0;
    for (const [deps, rc, version, who] of cases) {
      log.length = 0;
      const d = app(`conf-${i}`, deps, rc);
      expect((await npm(d, ['install'])).code).toBe(0);
      expect(installed(d).version, `строка ${i}`).toBe(version);
      expect(asked(), `строка ${i}`).toEqual(who);
      expect(t.CONFUSION_ROWS[i].got).toContain(version);
      i++;
    }
    // lock-файл с внутренней версией, реестр переключён на прокси: npm ci качает по resolved
    const d = join(dir, 'conf-0');
    writeFileSync(join(d, '.npmrc'), `registry=${M}\n`);
    rmSync(join(d, 'node_modules'), { recursive: true });
    log.length = 0;
    expect((await npm(d, ['ci'])).code).toBe(0);
    expect(log).toEqual(['4981 /acme-utils/-/acme-utils-1.2.0.tgz']);
    expect(t.CONFUSION_ROWS[6].got).toContain('1.2.0');
  }, 120_000);

  it('--before выбирает версию, существовавшую на дату', async () => {
    const a = app('before-a', { greeter: '^1.0.0' }, `registry=${I}\n`);
    expect((await npm(a, ['install'])).code).toBe(0);
    expect(installed(a).version).toBe('1.1.0');
    const b = app('before-b', { greeter: '^1.0.0' }, `registry=${I}\n`);
    expect((await npm(b, ['install', '--before=2026-09-25'])).code).toBe(0);
    expect(installed(b).version).toBe('1.0.0');
    expect(t.BEFORE_CODE).toContain('--before=2026-09-25');
  }, 60_000);

  it('npm sbom: хеш компонента — integrity из lock-файла в hex', async () => {
    const d = join(dir, 'before-a');
    const r = await npm(d, ['sbom', '--sbom-format', 'cyclonedx']);
    const bom = JSON.parse(r.out);
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.specVersion).toBe('1.5');
    const c = bom.components.find((x: { name: string }) => x.name === 'greeter');
    const hex = Buffer.from(installed(d).integrity.slice('sha512-'.length), 'base64').toString('hex');
    expect(c.hashes).toEqual([{ alg: 'SHA-512', content: hex }]);
    expect(t.SBOM_CODE).toContain(hex);
    expect(t.SBOM_CODE).toContain(c.externalReferences[0].url);
    const spdx = JSON.parse((await npm(d, ['sbom', '--sbom-format', 'spdx'])).out);
    expect(spdx.spdxVersion).toBe('SPDX-2.3');
  }, 60_000);
});

// ─── SRI_CODE против ssri и crypto ────────────────────────────────────────────────────────

/** Детерминированные «случайные» байты: тест не должен мигать. */
function noise(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const FILES: [string, () => Uint8Array][] = [
  ['тарбол стенда', () => fromBase64(t.DEMO.tarball)],
  ['LIB_JS', () => new TextEncoder().encode(t.LIB_JS)],
  ['пустой', () => new Uint8Array(0)],
  ['кириллица', () => new TextEncoder().encode('Привет, мир! '.repeat(50))],
  ['1 МиБ шума', () => noise(1 << 20, 7)],
];
const ALGS = ['sha1', 'sha256', 'sha384', 'sha512'];
const b64 = (alg: string, b: Uint8Array) => createHash(alg).update(b).digest('base64');

/** Набор строк integrity для файла: верные, чужие, смеси, мусор, опечатки. */
function variants(b: Uint8Array): [string, string][] {
  const other = noise(64, 99);
  const R = (a: string) => `${a}-${b64(a, b)}`;
  const W = (a: string) => `${a}-${b64(a, other)}`;
  const url = (s: string) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return [
    ...ALGS.map((a) => [`верный ${a}`, R(a)] as [string, string]),
    ...ALGS.map((a) => [`чужой ${a}`, W(a)] as [string, string]),
    ['слабый чужой, сильный верный', `${W('sha256')} ${R('sha512')}`],
    ['слабый верный, сильный чужой', `${R('sha256')} ${W('sha512')}`],
    ['sha1 верный + sha384 чужой', `${R('sha1')} ${W('sha384')}`],
    ['sha1 чужой + sha256 верный', `${W('sha1')} ${R('sha256')}`],
    ['ротация', `${W('sha384')} ${R('sha384')}`],
    ['ротация, оба чужие', `${W('sha384')} ${W('sha384').replace(/.$/, 'A')}`],
    ['мусор', 'hello'],
    ['пусто', ''],
    ['пробелы', '   '],
    ['заглавные', R('sha384').replace('sha384', 'SHA384')],
    ['заглавные чужой', W('sha384').replace('sha384', 'SHA384')],
    ['base64url верный', `sha384-${url(b64('sha384', b))}`],
    ['без = в конце', `sha512-${b64('sha512', b).replace(/=+$/, '')}`],
    ['с опцией', `${R('sha384')}?ct=application/javascript`],
    ['табуляция', `${W('sha256')}\t${R('sha512')}`],
    ['пробелы по краям', `  ${R('sha256')}  `],
    ['не base64', 'sha384-!!!'],
    ['короткий', 'sha384-abc'],
    ['md5-подобный неизвестный', 'whirlpool-abc'],
  ];
}

describe('SRI_CODE против ssri и node:crypto', () => {
  it('integrityOf = ssri.fromData = node:crypto на всех файлах и наборах алгоритмов', async () => {
    const sets = [['sha512'], ['sha256'], ['sha384'], ['sha1'], ['sha256', 'sha512'], ['sha1', 'sha256', 'sha384', 'sha512']];
    for (const [name, make] of FILES) {
      const b = make();
      for (const algs of sets) {
        const got = await sri.integrityOf(b, algs);
        expect(got, `${name} ${algs}`).toBe(ssri.fromData(Buffer.from(b), { algorithms: algs }).toString());
        expect(got).toBe(algs.map((a) => `${a}-${b64(a, b)}`).join(' '));
      }
    }
    expect(await sri.integrityOf(fromBase64(t.DEMO.tarball))).toBe(t.LOCK_INTEGRITY);
  });

  it('checkIntegrity в режиме npm = ssri.checkData; выбранный алгоритм = ssri pickAlgorithm', async () => {
    let n = 0;
    for (const [name, make] of FILES) {
      const b = make();
      for (const [vn, text] of variants(b)) {
        const check = await sri.checkIntegrity(b, text, 'npm');
        const want = Boolean(ssri.checkData(Buffer.from(b), text));
        expect(sri.verdict(check, 'npm') === 'pass', `${name}: ${vn}`).toBe(want);
        const parsed = ssri.parse(text);
        expect(check.alg, `${name}: ${vn}`).toBe(parsed ? parsed.pickAlgorithm() : null);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('LIB_HASHES — хеши LIB_JS и LIB_JS_OLD; тег в теме несёт sha384', () => {
    const lib = new TextEncoder().encode(t.LIB_JS);
    for (const a of ALGS) expect(t.LIB_HASHES[a as 'sha1']).toBe(`${a}-${b64(a, lib)}`);
    expect(t.LIB_HASHES.oldSha384).toBe(`sha384-${b64('sha384', new TextEncoder().encode(t.LIB_JS_OLD))}`);
    expect(t.SCRIPT_TAG_CODE).toContain(t.LIB_HASHES.sha384);
  });

  it('варианты демо на нетронутом файле: браузер грузит все пять, ssri отвергает только SHA384', async () => {
    const lib = new TextEncoder().encode(t.LIB_JS);
    const out: Record<string, [string, string]> = {};
    for (const v of t.ATTR_VARIANTS) {
      const verdicts = await Promise.all((['browser', 'npm'] as Mode[]).map(async (m) => sri.verdict(await sri.checkIntegrity(lib, v.integrity, m), m)));
      out[v.id] = verdicts as [string, string];
    }
    expect(out).toEqual({ one: ['pass', 'pass'], two: ['pass', 'pass'], rotation: ['pass', 'pass'], sha1: ['pass', 'pass'], upper: ['pass', 'fail'] });
    // испорченный байт: sha1 — браузер всё равно грузит, ssri отвергает
    const bad = lib.slice();
    bad[0] ^= 1;
    const v = t.ATTR_VARIANTS.find((x) => x.id === 'sha1')!;
    expect(sri.verdict(await sri.checkIntegrity(bad, v.integrity, 'browser'), 'browser')).toBe('pass');
    expect(sri.verdict(await sri.checkIntegrity(bad, v.integrity, 'npm'), 'npm')).toBe('fail');
  });
});

// ─── Chromium ─────────────────────────────────────────────────────────────────────────────

describe('SRI_CODE в режиме browser против Chromium', () => {
  let browser: Browser;
  let site: Server;
  let cdn: Server;
  const pages = new Map<string, string>();

  beforeAll(async () => {
    const handler = (kind: 'site' | 'cdn') => (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/lib.js') {
        const h: Record<string, string> = { 'content-type': 'text/javascript', 'cache-control': 'no-store' };
        if (kind === 'cdn' && !url.searchParams.has('noacao')) h['access-control-allow-origin'] = '*';
        res.writeHead(200, h);
        res.end(t.LIB_JS);
        return;
      }
      const body = kind === 'site' ? pages.get(url.pathname) : undefined;
      if (body !== undefined) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
        return;
      }
      res.writeHead(404);
      res.end();
    };
    site = createServer(handler('site'));
    cdn = createServer(handler('cdn'));
    await new Promise<void>((r) => site.listen(4983, '127.0.0.1', r));
    await new Promise<void>((r) => cdn.listen(4984, '127.0.0.1', r));
    browser = await chromium.launch({ args: ['--host-resolver-rules=MAP site.test 127.0.0.1:4983, MAP cdn.test 127.0.0.1:4984'] });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    site?.close();
    cdn?.close();
  });

  let pageN = 0;
  async function load(integrity: string | null, src = 'http://cdn.test/lib.js', crossorigin = true) {
    const path = `/p${pageN++}`;
    const attrs = (integrity === null ? '' : ` integrity="${integrity.replace(/"/g, '&quot;')}"`) + (crossorigin ? ' crossorigin="anonymous"' : '');
    pages.set(path, `<!doctype html><script src="${src}"${attrs}></script>`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const messages: string[] = [];
    page.on('console', (m) => messages.push(m.text()));
    await page.goto(`http://site.test${path}`);
    await page.waitForTimeout(50);
    const ran = await page.evaluate(() => typeof (window as unknown as { greet?: unknown }).greet === 'function');
    await ctx.close();
    return { ran, messages };
  }

  it('на всех вариантах атрибута Chromium выполнил скрипт ровно тогда, когда verdict(browser) = pass', async () => {
    const lib = new TextEncoder().encode(t.LIB_JS);
    for (const [vn, text] of variants(lib)) {
      if (text.includes('\t')) continue; // табуляцию в атрибуте проверяем ниже отдельно
      const want = sri.verdict(await sri.checkIntegrity(lib, text, 'browser'), 'browser') === 'pass';
      expect((await load(text)).ran, vn).toBe(want);
    }
    const tab = `sha256-${b64('sha256', noise(64, 99))}\tsha512-${b64('sha512', lib)}`;
    expect((await load(tab)).ran).toBe(true);
    expect(sri.verdict(await sri.checkIntegrity(lib, tab, 'browser'), 'browser')).toBe('pass');
  }, 120_000);

  it('сообщения консоли и строки таблицы', async () => {
    const lib = new TextEncoder().encode(t.LIB_JS);
    const wrong = `sha384-${b64('sha384', noise(64, 99))}`;
    const bad = await load(wrong);
    expect(bad.ran).toBe(false);
    expect(bad.messages).toContain(fill(t.CHROMIUM_BLOCKED, { url: 'http://cdn.test/lib.js', ALG: upperAlg('sha384'), got: b64('sha384', lib) }));

    const noCors = await load(t.LIB_HASHES.sha384, 'http://cdn.test/lib.js', false);
    expect(noCors.ran).toBe(false);
    expect(noCors.messages.join('\n')).toContain('requires the request to be CORS enabled to check the integrity');

    const noAcao = await load(t.LIB_HASHES.sha384, 'http://cdn.test/lib.js?noacao');
    expect(noAcao.ran).toBe(false);
    expect(noAcao.messages.join('\n')).toContain("No 'Access-Control-Allow-Origin' header");

    const sha1 = await load(t.LIB_HASHES.sha1.replace(/.{4}=$/, 'AAAA='));
    expect(sha1.ran).toBe(true);
    expect(sha1.messages.join('\n')).toContain("The specified hash algorithm must be one of 'sha256', 'sha384', 'sha512', or 'ed21159'.");
    for (const s of ["Failed to find a valid digest in the 'integrity' attribute", 'requires the request to be CORS enabled', "or 'ed21159'."]) {
      expect(t.BROWSER_CONSOLE_CODE.replace(/\n/g, ' ')).toContain(s);
    }

    // без integrity и того же источника — работает как обычно
    expect((await load(null, 'http://cdn.test/lib.js', false)).ran).toBe(true);
    expect((await load(t.LIB_HASHES.sha384, '/lib.js', false)).ran).toBe(true);
  }, 60_000);

  it('fetch с integrity: верный — 200, чужой — TypeError', async () => {
    pages.set('/fetch', '<!doctype html><p>fetch</p>');
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('http://site.test/fetch');
    const r = await page.evaluate(async ([good, bad]) => {
      const out: string[] = [];
      for (const integrity of [good, bad]) {
        try {
          const res = await fetch('http://cdn.test/lib.js', { integrity });
          out.push(String(res.status));
        } catch (e) {
          out.push(`${(e as Error).name}: ${(e as Error).message}`);
        }
      }
      return out;
    }, [t.LIB_HASHES.sha384, `sha384-${b64('sha384', noise(64, 99))}`]);
    await ctx.close();
    expect(r).toEqual(['200', 'TypeError: Failed to fetch']);
    expect(t.FETCH_SRI_CODE).toContain('TypeError: Failed to fetch');
  }, 60_000);
});
