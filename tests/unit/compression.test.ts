import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createApp, eventHandler, serveStatic, toNodeListener } from 'h3';
import sirv from 'sirv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/compression/data';
import { loadNegotiate } from '@/widgets/compress-lab/model/run';

/**
 * Тема «Сжатие в вебе: gzip, Brotli, zstd».
 *
 * `NEGOTIATE_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с примерами RFC 9110 и с колонкой negotiator из `SERVER_ROWS` (negotiator в проекте
 * не стоит — колонка снята стендом). sirv и h3 стоят в `node_modules` — их ответы на те же
 * заголовки пересобираются здесь заново. Размеры и словарь пересчитываются на копиях файлов `dist/`
 * из `tests/fixtures/compression/` (сверка по sha-256); иначе эти проверки пропускаются с пометкой,
 * а картинка из `node_modules` проверяется всегда. BREACH и Node `fetch` — целиком заново.
 * Журнал Chromium (`AE_ROWS`, `LENGTH_ROWS`, обмен словарём) — литерал стенда, см. шапку `data.ts`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const api = loadNegotiate(t.NEGOTIATE_CODE);
const Z = zlib.constants;
const sha16 = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16);

/** Файл стенда, если он на месте и тот же (по sha-256), иначе `null`. */
function fixture(rel: string, sha: string): Buffer | null {
  // Копии файлов `dist/` со дня стенда лежат в фикстурах: пересборка сайта меняет хеши в именах
  // и содержимое, а размеры в теме сняты именно с этих байтов.
  const saved = join(ROOT, 'tests/fixtures/compression', rel);
  const p = existsSync(saved) ? saved : join(ROOT, rel);
  if (!existsSync(p)) return null;
  const b = readFileSync(p);
  return sha16(b) === sha ? b : null;
}

const gz = (b: Buffer, level: number) => zlib.gzipSync(b, { level }).length;
const br = (b: Buffer, q: number) =>
  zlib.brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: q, [Z.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
const zs = (b: Buffer, level: number, dictionary?: Buffer) =>
  zlib.zstdCompressSync(b, { params: { [Z.ZSTD_c_compressionLevel]: level }, ...(dictionary ? { dictionary } : {}) }).length;

// ─── Функция выбора ────────────────────────────────────────────────────────────────────────

describe('NEGOTIATE_CODE', () => {
  it('примеры RFC 9110, раздел 12.5.3', () => {
    for (const c of t.RFC_CASES) expect(api.negotiate(c.ae, c.offers), c.ae).toBe(c.pick);
  });

  it('совпадает с negotiator 1.0.0 на всех строках SERVER_ROWS (сервер с br и gzip)', () => {
    for (const r of t.SERVER_ROWS) expect(api.negotiate(r.ae, ['br', 'gzip']), String(r.ae)).toBe(r.negotiator);
  });

  it('заголовки стенда: Chromium получает br, по http — gzip, <video> и без заголовка — identity', () => {
    const offers = ['br', 'zstd', 'gzip'];
    const pick = (id: string) => api.negotiate(t.AE_PRESETS.find((p) => p.id === id)!.header, offers);
    expect(pick('chromium')).toBe('br');
    expect(pick('chromium-http')).toBe('gzip');
    expect(pick('video')).toBe('identity');
    expect(pick('node')).toBe('br');
    expect(pick('none')).toBe('identity');
    // Пресеты демо — те же строки, что в таблице «что шлют клиенты».
    for (const p of t.AE_PRESETS.filter((x) => x.header !== null && x.id !== 'node')) {
      expect(t.AE_ROWS.some((r) => r.ae === p.header), p.id).toBe(true);
    }
    expect(t.AE_ROWS.find((r) => r.who.startsWith('Node'))!.ae).toContain(`\`${t.AE_PRESETS.find((p) => p.id === 'node')!.header}\``);
  });

  it('разбор: регистр, пробелы, неверный вес', () => {
    expect(api.parseAcceptEncoding('BR, identity; q=0.5')).toEqual([
      { coding: 'br', q: 1 },
      { coding: 'identity', q: 0.5 },
    ]);
    expect(api.parseAcceptEncoding('br;q=2, gzip;q=abc, zstd;q=0.25')).toEqual([{ coding: 'zstd', q: 0.25 }]);
    // Неявный identity годится, но проигрывает любому весу, даже 0.001.
    expect(api.weight([], 'identity')).toBe(Number.MIN_VALUE);
    expect(api.negotiate('gzip;q=0.001', ['gzip'])).toBe('gzip');
    expect(api.negotiate('gzip;q=0.5, identity;q=1', ['gzip'])).toBe('identity');
    // Единственное расхождение с negotiator, названное в тексте: он верит q=2.
    expect(api.negotiate('br;q=2', ['br', 'gzip'])).toBe('identity');
    expect(t.NEGOTIATE_NOTE).toContain('верит `q=2`');
  });
});

// ─── Настоящие серверы: sirv и h3 ──────────────────────────────────────────────────────────

describe('sirv 3.0.2 и h3 — ответы на те же заголовки', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compression-'));
  const body = Buffer.from(t.NEGOTIATE_CODE.repeat(20));
  const brBody = zlib.brotliCompressSync(body);
  const gzBody = zlib.gzipSync(body, { level: 9 });
  writeFileSync(join(dir, 'app.js'), body);
  writeFileSync(join(dir, 'app.js.br'), brBody);
  writeFileSync(join(dir, 'app.js.gz'), gzBody);

  const ENC: Record<string, string> = { '.br': 'br', '.gz': 'gzip' };
  const app = createApp();
  app.use(
    eventHandler((event) =>
      serveStatic(event, {
        encodings: { br: '.br', gzip: '.gz' },
        getMeta: (id) => {
          const f = join(dir, id);
          if (!existsSync(f)) return undefined;
          return { size: readFileSync(f).length, encoding: ENC[id.slice(-3)], type: 'text/javascript' };
        },
        getContents: (id) => readFileSync(join(dir, id)),
      }),
    ),
  );
  const sSirv = http.createServer(sirv(dir, { gzip: true, brotli: true, etag: true }));
  const sH3 = http.createServer(toNodeListener(app));
  const port = (s: http.Server) => (s.address() as AddressInfo).port;

  beforeAll(async () => {
    await new Promise<void>((r) => sSirv.listen(0, r));
    await new Promise<void>((r) => sH3.listen(0, r));
  });
  afterAll(() => {
    sSirv.close();
    sH3.close();
  });

  const get = (s: http.Server, headers: Record<string, string>) =>
    new Promise<{ status: number; ce: string; cr?: string; etag?: string; vary?: string; bytes: number }>((res, rej) => {
      http
        .get({ port: port(s), path: '/app.js', headers }, (r) => {
          const ch: Buffer[] = [];
          r.on('data', (c: Buffer) => ch.push(c));
          r.on('end', () =>
            res({
              status: r.statusCode ?? 0,
              ce: (r.headers['content-encoding'] as string | undefined) ?? 'identity',
              cr: r.headers['content-range'] as string | undefined,
              etag: r.headers.etag,
              vary: r.headers.vary as string | undefined,
              bytes: Buffer.concat(ch).length,
            }),
          );
        })
        .on('error', rej);
    });

  it('кодировка, выбранная sirv и h3, совпадает с SERVER_ROWS', async () => {
    for (const r of t.SERVER_ROWS) {
      const headers: Record<string, string> = r.ae === null ? {} : { 'accept-encoding': r.ae };
      expect((await get(sSirv, headers)).ce, `sirv ${r.ae}`).toBe(r.sirv);
      expect((await get(sH3, headers)).ce, `h3 ${r.ae}`).toBe(r.h3);
    }
  });

  it('строки sirv из темы дословно стоят в node_modules/sirv/build.js', () => {
    const src = readFileSync(join(ROOT, 'node_modules/sirv/build.js'), 'utf8');
    for (const line of t.SIRV_SNIPPET.split('\n')) expect(src).toContain(line.trim());
  });

  it('Range считает байты выбранного варианта; ETag у вариантов разный', async () => {
    const brR = await get(sSirv, { 'accept-encoding': t.CHROMIUM_AE, range: 'bytes=0-99' });
    expect(brR).toMatchObject({ status: 206, ce: 'br', cr: `bytes 0-99/${brBody.length}`, bytes: 100 });
    const idR = await get(sSirv, { 'accept-encoding': 'identity', range: 'bytes=0-99' });
    expect(idR).toMatchObject({ status: 206, ce: 'identity', cr: `bytes 0-99/${body.length}`, bytes: 100 });
    expect(brR.etag).toMatch(new RegExp(`^W/"${brBody.length}-`));
    expect(idR.etag).toMatch(new RegExp(`^W/"${body.length}-`));
    expect(brR.vary).toBe('Accept-Encoding');
    expect(t.RANGE_CODE).toContain(`Content-Range: bytes 0-99/${t.FILE_SIZES.find((f) => f.id === 'js')!.br[11]}`);
  });

  it('h3 отдаёт Chromium gzip — на столько байт больше, сколько написано', () => {
    const js = t.FILE_SIZES.find((f) => f.id === 'js')!;
    expect(t.SERVER_ROWS[0]).toMatchObject({ ae: t.CHROMIUM_AE, h3: 'gzip', negotiator: 'br' });
    const extra = (((js.gzip[8] - js.br[11]) / js.br[11]) * 100).toFixed(1).replace('.', ',');
    expect(t.SERVER_NOTE).toContain(`на ${extra}% больше`);
  });
});

// ─── Node fetch ────────────────────────────────────────────────────────────────────────────

describe('что шлёт fetch в Node', () => {
  it('по http — gzip, deflate; с Range — identity (как в AE_ROWS)', async () => {
    const seen: string[] = [];
    const s = http.createServer((req, res) => {
      seen.push(String(req.headers['accept-encoding']));
      res.end('x');
    });
    await new Promise<void>((r) => s.listen(0, r));
    const url = `http://localhost:${(s.address() as AddressInfo).port}/`;
    await (await fetch(url)).text();
    await (await fetch(url, { headers: { Range: 'bytes=0-0' } })).text();
    s.close();
    expect(seen).toEqual(['gzip, deflate', 'identity']);
    expect(t.AE_ROWS.find((r) => r.who.startsWith('Node'))!.ae).toBe('`br, gzip, deflate` / `gzip, deflate` / `identity`');
  });
});

// ─── Размеры на файлах сайта ───────────────────────────────────────────────────────────────

describe('размеры: уровни gzip, brotli, zstd', () => {
  for (const f of t.FILE_SIZES) {
    const b = fixture(f.file, f.sha);
    it.skipIf(!b)(b ? `${f.file} — все уровни как в FILE_SIZES` : `${f.file} — ПРОПУЩЕНО: в dist/ другой файл или его нет`, () => {
      const buf = b as Buffer;
      expect(buf.length).toBe(f.raw);
      expect(f.gzip.map((_, i) => gz(buf, i + 1))).toEqual(f.gzip);
      expect(f.br.map((_, q) => br(buf, q))).toEqual(f.br);
      for (const l of t.ZSTD_LEVELS) expect(zs(buf, l), `zstd ${l}`).toBe(f.zstd[l]);
    });
  }

  it('картинка из node_modules есть всегда — её размеры проверяются без пропусков', () => {
    const png = t.FILE_SIZES.find((f) => f.id === 'png')!;
    expect(fixture(png.file, png.sha)).not.toBeNull();
  });

  it('утверждения текста: brotli 11 меньше gzip 9 у текста; woff2 и PNG почти не сжимаются; крошечный файл растёт', () => {
    const F = Object.fromEntries(t.FILE_SIZES.map((f) => [f.id, f]));
    for (const id of ['html', 'css', 'js']) {
      expect(F[id].br[11]).toBeLessThan(F[id].gzip[8]);
      expect(F[id].gzip[5] - F[id].gzip[8]).toBeLessThan(F[id].gzip[8] * 0.01); // gzip 6→9: меньше 1%
    }
    expect(F.woff2.br[11]).toBeGreaterThan(F.woff2.raw);
    expect(F.woff2.zstd[19]).toBeGreaterThan(F.woff2.raw);
    expect(F.woff2.raw - F.woff2.gzip[8]).toBeLessThan(F.woff2.raw * 0.001);
    expect(F.png.br[11]).toBeGreaterThan(F.png.raw * 0.96);
    expect(F.tiny.gzip[8]).toBeGreaterThan(F.tiny.raw);
    expect(t.SKIP_NOTE).toContain(`на ${F.woff2.br[11] - F.woff2.raw} байт **больше**`);
    // Строки таблицы уровней собраны из тех же чисел.
    expect(t.LEVEL_ROWS[2][5]).toBe(F.js.br[11].toLocaleString('ru-RU'));
  });

  it('счёт вызовов сжатия сходится с текстом', () => {
    expect(t.CALLS.dynamic).toBe(t.CALLS.requests);
    expect(t.CALLS_ROWS[1].how).toContain((t.CALLS.dynamic * t.FILE_SIZES.find((f) => f.id === 'js')!.raw).toLocaleString('ru-RU'));
  });
});

// ─── Словарь ───────────────────────────────────────────────────────────────────────────────

const DCZ_MAGIC = Buffer.from([0x5e, 0x2a, 0x4d, 0x18, 0x20, 0, 0, 0]);
const dcz = (target: Buffer, dict: Buffer, level: number) =>
  Buffer.concat([DCZ_MAGIC, createHash('sha256').update(dict).digest(), zlib.zstdCompressSync(target, { dictionary: dict, params: { [Z.ZSTD_c_compressionLevel]: level } })]);

describe('словарь: dcz', () => {
  it('Node 24: zstd со словарём работает, brotli молча игнорирует словарь', () => {
    const v1 = Buffer.from(t.NEGOTIATE_CODE + t.BREACH_CODE);
    const v2 = Buffer.from(t.NEGOTIATE_CODE.replace('при равенстве', 'при ничьей') + t.BREACH_CODE);
    expect(zlib.brotliCompressSync(v2, { dictionary: v1 } as zlib.BrotliOptions).length).toBe(zlib.brotliCompressSync(v2).length);
    const withDict = zlib.zstdCompressSync(v2, { dictionary: v1 });
    expect(withDict.length * 5).toBeLessThan(zlib.zstdCompressSync(v2).length);
    expect(zlib.zstdDecompressSync(withDict, { dictionary: v1 }).equals(v2)).toBe(true);
    // Заголовок dcz — 40 байт: восемь байт метки и sha-256 словаря, дальше обычный поток zstd.
    const framed = dcz(v2, v1, 3);
    expect(framed.subarray(0, 8).toString('hex')).toBe('5e2a4d1820000000');
    expect(framed.subarray(8, 40).equals(createHash('sha256').update(v1).digest())).toBe(true);
    expect(zlib.zstdDecompressSync(framed.subarray(40), { dictionary: v1 }).equals(v2)).toBe(true);
    // Целиком Node его не разбирает: останавливается на служебном кадре и отдаёт пустой буфер.
    expect(zlib.zstdDecompressSync(framed, { dictionary: v1 }).length).toBe(0);
    expect(t.DICT_FACTS.some((f) => f.d.includes('вернул **пустой** буфер'))).toBe(true);
  });

  const v1 = fixture(t.DICT_FILE.file, t.DICT_FILE.sha);
  it.skipIf(!v1)(v1 ? 'FuzzyLab: правки DICT_EDITS, хеш, размеры по сети' : 'FuzzyLab — ПРОПУЩЕНО: в dist/ другой файл', () => {
    const one = v1 as Buffer;
    let s = one.toString('utf8');
    for (const [a, b] of t.DICT_EDITS) {
      expect(s.split(a).length, a).toBe(2);
      s = s.replace(a, b);
    }
    const v2 = Buffer.from(s);
    expect([one.length, v2.length]).toEqual([t.DICT_FILE.v1, t.DICT_FILE.v2]);
    expect(createHash('sha256').update(one).digest('base64')).toBe(t.DICT_V1_HASH);
    expect(t.DICT_CODE).toContain(`Available-Dictionary: :${t.DICT_V1_HASH}:`);

    const [r] = t.DICT_ROWS;
    expect({ raw: v2.length, br11: br(v2, 11), zstd19: zs(v2, 19), dcz: dcz(v2, one, 19).length }).toEqual({ raw: r.raw, br11: r.br11, zstd19: r.zstd19, dcz: r.dcz });
    expect(dcz(v2, one, 3).length).toBe(t.DICT_DCZ3);
    expect(t.DICT_CODE).toContain(`Content-Length: ${r.dcz}`);

    const micro = fixture(t.DICT_MICRO.file, t.DICT_MICRO.sha);
    if (micro) expect(dcz(v2, micro, 19).length).toBe(t.DICT_ROWS[1].dcz);
    const css = t.FILE_SIZES.find((f) => f.id === 'css')!;
    const cssBuf = fixture(css.file, css.sha);
    if (cssBuf) expect(dcz(v2, cssBuf, 19).length).toBe(t.DICT_ROWS[2].dcz);
  });

  const html = t.FILE_SIZES.find((f) => f.id === 'html')!;
  const h1 = fixture(html.file, html.sha);
  const h2 = fixture(t.DICT_HTML.target, t.DICT_HTML.targetSha);
  it.skipIf(!h1 || !h2)(h1 && h2 ? 'страница как словарь для другой страницы' : 'страницы — ПРОПУЩЕНО: в dist/ другие файлы', () => {
    const r = t.DICT_ROWS[3];
    const target = h2 as Buffer;
    expect({ raw: target.length, br11: br(target, 11), zstd19: zs(target, 19), dcz: dcz(target, h1 as Buffer, 19).length }).toEqual({ raw: r.raw, br11: r.br11, zstd19: r.zstd19, dcz: r.dcz });
  });
});

// ─── BREACH ────────────────────────────────────────────────────────────────────────────────

describe('BREACH_CODE', () => {
  const { size, render } = new Function('gzipSync', `${t.BREACH_CODE}\nreturn { size, render };`)(zlib.gzipSync) as {
    size: (q: string) => number;
    render: (q: string) => string;
  };

  it('верный префикс не удлиняет ответ, каждый неверный знак стоит байт — как в BREACH_ROWS', () => {
    for (const r of t.BREACH_ROWS) {
      expect(size('csrf=' + t.BREACH_SECRET.slice(0, r.k)), `верный ${r.k}`).toBe(r.right);
      expect(size('csrf=' + t.BREACH_WRONG.slice(0, r.k)), `неверный ${r.k}`).toBe(r.wrong);
    }
    expect(render('x')).toContain(`csrf=${t.BREACH_SECRET}`);
  });

  it('перебор по одному знаку восстанавливает токен за 8 × 16 = 128 запросов', () => {
    let known = '';
    let requests = 0;
    for (let i = 0; i < t.BREACH_SECRET.length; i++) {
      const sizes = [...'0123456789abcdef'].map((c) => {
        requests++;
        return [c, size('csrf=' + known + c)] as const;
      });
      const min = Math.min(...sizes.map(([, s]) => s));
      const best = sizes.filter(([, s]) => s === min);
      expect(best, `знак ${i}`).toHaveLength(1);
      known += best[0][0];
    }
    expect(known).toBe(t.BREACH_SECRET);
    expect(requests).toBe(128);
    expect(t.BREACH_NOTE).toContain('8 × 16 = 128');
    // Экранирование не мешает: в догадке нет опасных символов.
    expect(render('csrf=7c3')).toContain('csrf=7c3</p>');
  });
});
