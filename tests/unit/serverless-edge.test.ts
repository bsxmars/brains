import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { build, type BuildOptions, type BuildResult } from 'esbuild';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/serverless-edge/data';
import { loadLatency, loadSimulate, standTimeline } from '@/widgets/serverless-lab/model/run';

/**
 * Тема «Serverless и edge».
 *
 * Строки темы — обработчики, счётчик модулей, сборка, способы держать соединение, хост
 * «как в edge», модели масштабирования и задержки, потоковый ответ — исполняются здесь как есть.
 * Литералы стенда сверяются с тем, что эти строки дают сейчас; модель масштабирования —
 * с выводом эмулятора на настоящем Postgres (`STAND_RUNS`, каждая точка) и с законом Литтла;
 * модель задержки — с аналитической границей и пределом оптоволокна. Эмулятор с Docker здесь
 * не запускается: его вывод — литерал, а описание прогона — в шапке `data.ts`.
 */

const ROOT = new URL('../../', import.meta.url).pathname;
const dir = realpathSync(mkdtempSync(join(tmpdir(), 'serverless-edge-')));
const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' });

beforeAll(() => {
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'h-light.mjs'), t.HANDLER_LIGHT);
  writeFileSync(join(dir, 'h-eager.mjs'), t.HANDLER_EAGER);
  writeFileSync(join(dir, 'h-lazy.mjs'), t.HANDLER_LAZY);
  writeFileSync(join(dir, 'count.mjs'), t.COUNT_CODE);
});

const count = (file: string) => JSON.parse(node(['count.mjs', file]).trim()) as t.ColdRun;

describe('холодный старт: модули и байты', () => {
  it('COUNT_CODE на трёх обработчиках даёт COLD_RUNS', () => {
    expect(count('./h-light.mjs')).toEqual(t.COLD_RUNS.light);
    expect(count('./h-eager.mjs')).toEqual(t.COLD_RUNS.eager);
    expect(count('./h-lazy.mjs')).toEqual(t.COLD_RUNS.lazy);
  }, 30_000);

  it('тёплый вызов не грузит ничего, ленивый импорт переносит ровно yaml', () => {
    for (const r of Object.values(t.COLD_RUNS)) expect(r.warm).toEqual({ files: 0, bytes: 0, builtins: 0 });
    // Ленивый вариант + его первый /export = всё сверху, по файлам.
    expect(t.COLD_RUNS.lazy.init.files + t.COLD_RUNS.lazy.exp.files).toBe(t.COLD_RUNS.eager.init.files);
    // Числа из прозы — из литералов, а не набраны руками.
    expect(t.COLD_NOTE).toContain(`${t.COLD_RUNS.lazy.exp.files} файла yaml`);
    expect(t.PITFALLS[0].d).toContain(`${t.COLD_RUNS.lazy.exp.files} файла`);
  });

  describe('сборка BUNDLE_CODE', () => {
    const bundle = new Function(`${t.BUNDLE_CODE}\nreturn bundle;`)() as (b: typeof build, entry: string, outdir: string) => Promise<BuildResult<BuildOptions & { metafile: true }>>;
    const results: Record<string, BuildResult<BuildOptions & { metafile: true }>> = {};

    beforeAll(async () => {
      for (const h of ['light', 'eager', 'lazy']) {
        results[h] = await bundle(build, join(dir, `h-${h}.mjs`), join(dir, 'dist', h));
      }
    }, 60_000);

    it('входы и байты совпадают с BUNDLE_RUNS', () => {
      for (const h of ['light', 'eager', 'lazy'] as const) {
        const meta = results[h].metafile!;
        const outs = Object.values(meta.outputs).filter((_, i) => Object.keys(meta.outputs)[i].endsWith('.js'));
        const entry = outs.find((o) => o.entryPoint?.endsWith(`h-${h}.mjs`));
        const lazy = outs.find((o) => o.entryPoint && !o.entryPoint.endsWith(`h-${h}.mjs`));
        const chunk = outs.find((o) => !o.entryPoint);
        expect({
          inputs: Object.keys(meta.inputs).length,
          entryBytes: entry?.bytes ?? 0,
          chunkBytes: chunk?.bytes ?? 0,
          lazyBytes: lazy?.bytes ?? 0,
        }).toEqual(t.BUNDLE_RUNS[h]);
      }
    });

    it('собранные файлы грузятся одним-двумя файлами — BUNDLED_COLD', () => {
      for (const h of ['light', 'eager', 'lazy'] as const) {
        const r = count(`./dist/${h}/h-${h}.js`);
        expect({ init: { files: r.init.files, bytes: r.init.bytes }, exp: { files: r.exp.files, bytes: r.exp.bytes } }).toEqual(t.BUNDLED_COLD[h]);
      }
    }, 30_000);

    it('без баннера с createRequire собранный файл падает только при запуске', async () => {
      const r = await build({ entryPoints: [join(dir, 'h-eager.mjs')], outfile: join(dir, 'dist/no-banner.mjs'), bundle: true, minify: true, platform: 'node', format: 'esm', logLevel: 'silent' });
      expect(r.errors).toHaveLength(0);
      expect(r.warnings).toHaveLength(0);
      let stderr = '';
      try {
        node(['dist/no-banner.mjs']);
      } catch (e) {
        stderr = String((e as { stderr: string }).stderr);
      }
      expect(stderr).toContain('Dynamic require of "events" is not supported');
      expect(t.BUNDLE_WARN).toContain('Dynamic require of "events" is not supported');
    }, 30_000);

    it('числа в BUNDLE_NOTE взяты из замера', () => {
      expect(t.BUNDLE_NOTE).toContain(`${t.COLD_RUNS.eager.init.files} файлов`);
      expect(t.BUNDLE_NOTE).toContain(`${Math.round(t.BUNDLED_COLD.eager.init.bytes / 1024)} КБ`);
      expect(t.BUNDLE_NOTE).toContain(`${Math.round(t.BUNDLE_RUNS.lazy.lazyBytes / 1024)} КБ`);
      expect(t.BUNDLE_NOTE).toContain(`${(t.COLD_RUNS.eager.init.bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`);
    });
  });
});

describe('что переживает вызов: три способа держать соединение', () => {
  function instance(code: string) {
    let opened = 0;
    const connect = async () => {
      opened += 1;
      await new Promise((r) => setImmediate(r));
      return { query: async () => [[1]], end: async () => {} };
    };
    const handler = new Function('connect', 'DB_URL', `${code.replace(/^export /m, '')}\nreturn handler;`)(connect, 'postgres://') as (e: unknown) => Promise<unknown>;
    return { handler, opened: () => opened };
  }

  const cases = [
    ['perCall', t.POOL_PER_CALL],
    ['race', t.POOL_RACE],
    ['module', t.POOL_MODULE],
  ] as const;

  it.each(cases)('%s: последовательно и одновременно — как в POOL_RUNS', async (key, code) => {
    const seq = instance(code);
    for (let i = 0; i < 3; i++) await seq.handler({});
    const par = instance(code);
    await Promise.all([par.handler({}), par.handler({}), par.handler({})]);
    expect({ sequential: seq.opened(), parallel: par.opened() }).toEqual(t.POOL_RUNS[key]);
  });
});

describe('масштабирование: SCALE_CODE против эмулятора и аналитики', () => {
  const simulate = loadSimulate(t.SCALE_CODE);

  for (const profile of t.SCALE_PROFILES) {
    for (const platform of t.SCALE_PLATFORMS) {
      const key = `${profile.id}/${platform.id}`;
      it(`${key}: каждая точка временной линии совпадает со стендом`, () => {
        const stand = t.STAND_RUNS[key];
        const m = simulate(profile.requests, { concurrency: platform.concurrency, poolMax: platform.poolMax, keepWarm: t.KEEP_WARM, dbLimit: t.DB_LIMIT });
        expect(m.timeline).toEqual(standTimeline(stand));
        expect({ coldStarts: m.coldStarts, peakInstances: m.peakInstances, peakConns: m.peakConns, refused: m.refused, maxWait: m.maxWait }).toEqual({
          coldStarts: stand.coldStarts,
          peakInstances: stand.peakInstances,
          peakConns: stand.peakConns,
          refused: stand.refused,
          maxWait: stand.maxWait,
        });
        // Код верхнего уровня исполнился ровно один раз на каждый холодный старт.
        expect(stand.inits).toBe(stand.coldStarts);
        // Каждый отказ — настоящий 53300 от Postgres.
        expect(stand.errors).toEqual(Array(stand.refused).fill('53300'));
      });
    }
  }

  it('закон Литтла: при одном запросе на экземпляр экземпляров ⌈длительность ÷ интервал⌉', () => {
    for (const interval of [50, 100, 200]) {
      for (let dur = 30; dur <= 700; dur += 35) {
        const reqs = Array.from({ length: 60 }, (_, k) => ({ at: k * interval, dur }));
        const peak = Math.ceil(dur / interval);
        const m = simulate(reqs, { concurrency: 1, keepWarm: 1e9, poolMax: 1, dbLimit: 1e9 });
        expect(m.peakInstances, `${interval}/${dur}`).toBe(peak);
        expect(m.peakConns).toBe(peak);
        for (const c of [2, 3, 80]) {
          const mc = simulate(reqs, { concurrency: c, keepWarm: 1e9, poolMax: c, dbLimit: 1e9 });
          expect(mc.peakInstances, `${interval}/${dur}/${c}`).toBe(Math.ceil(peak / c));
          expect(mc.peakConns).toBe(peak);
        }
      }
    }
  });

  it('утверждения подписи и тонких мест — из стенда', () => {
    expect(t.STAND_RUNS['burst/lambda'].peakConns).toBe(t.DB_LIMIT);
    expect(t.SCALE_CAPTION).toContain(`на ${t.DB_LIMIT + 1}-м`);
    expect(t.SCALE_CAPTION).toContain(`до ${t.STAND_RUNS['burst/run'].maxWait} мс`);
    expect(t.STAND_RUNS['burst/run'].peakInstances).toBe(1);
    expect(t.STAND_RUNS['burst/run'].peakConns).toBe(10);
    const gaps = t.STAND_RUNS['gaps/lambda'];
    const n = t.SCALE_PROFILES.find((p) => p.id === 'gaps')!.requests.length;
    expect(gaps.coldStarts).toBe(n);
    expect(t.PITFALLS.find((p) => p.n === '05')!.d).toContain(`${n} из ${n}`);
    expect(t.STAND_RUNS['steady/lambda'].peakInstances).toBe(3);
  });
});

describe('edge: хост на node:vm', () => {
  const createEdgeHost = new Function(`${t.EDGE_HOST_CODE}\nreturn createEdgeHost;`)() as (
    v: typeof vm,
    apis: Record<string, unknown>,
    src: string,
  ) => { handle(pop: string, req: unknown): Promise<unknown>; stats: { created: number } };
  const g = globalThis as unknown as Record<string, unknown>;
  const webApis = () => Object.fromEntries(t.EDGE_WEB_APIS.map((n) => [n, g[n]]));

  it('журнал EDGE_LOG и два контекста', async () => {
    const host = createEdgeHost(vm, webApis(), t.EDGE_WORKER_CODE);
    const log: string[] = [];
    for (const [pop, path] of t.EDGE_REQUESTS) log.push(JSON.stringify(await host.handle(pop, { url: `https://shop.example${path}`, pop })));
    expect(log).toEqual(t.EDGE_LOG);
    expect(host.stats.created).toBe(t.EDGE_CONTEXTS);
  });

  it('GLOBALS_ROWS: Node, пустой контекст, контекст хоста', () => {
    const probe = `console.log(JSON.stringify(${JSON.stringify(t.GLOBAL_NAMES)}.map((n) => eval('typeof ' + n))))`;
    const nodeCol = JSON.parse(node(['-e', probe])) as string[];
    const bare = vm.runInContext(`${JSON.stringify(t.GLOBAL_NAMES)}.map((n) => typeof globalThis[n])`, vm.createContext({})) as string[];
    const edge = vm.runInContext(`${JSON.stringify(t.GLOBAL_NAMES)}.map((n) => typeof globalThis[n])`, vm.createContext(webApis())) as string[];
    expect(t.GLOBALS_ROWS.map((r) => r.k)).toEqual(t.GLOBAL_NAMES);
    expect(t.GLOBALS_ROWS.map((r) => r.node)).toEqual(nodeCol);
    expect(t.GLOBALS_ROWS.map((r) => r.bare)).toEqual(bare);
    expect(t.GLOBALS_ROWS.map((r) => r.edge)).toEqual(edge);
  });

  it('контекст — другой realm в том же процессе, а WebAssembly из байтов отказан', () => {
    const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    expect(vm.runInContext('[]', ctx) instanceof Array).toBe(false);
    // Пустой модуль wasm: магия и версия.
    ctx.bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    expect(() => vm.runInContext('new WebAssembly.Module(bytes)', ctx)).toThrow();
    expect(vm.runInContext('typeof WebAssembly', ctx)).toBe('object');
  });
});

describe('задержка: LATENCY_CODE', () => {
  const { latency, compare } = loadLatency(t.LATENCY_CODE);
  const ny = t.PLACE_PRESETS.find((p) => p.id === 'ny')!;

  it('PLACE_ROWS пересчитываются для Нью-Йорка', () => {
    for (const row of t.PLACE_ROWS) {
      const r = compare({ near: t.PLACE_NEAR, far: ny.far, local: t.PLACE_LOCAL, queries: row.q, setupTrips: 0, stream: false });
      expect({ q: row.q, edge: r.edge.total, region: r.region.total }).toEqual(row);
    }
    const fresh = compare({ near: t.PLACE_NEAR, far: ny.far, local: t.PLACE_LOCAL, queries: 0, setupTrips: t.SETUP_TRIPS, stream: false });
    expect(t.PLACE_NOTE).toContain(`${fresh.edge.setup} мс у edge против ${fresh.region.setup} мс`);
    expect(ny.far / t.PLACE_NEAR).toBe(9);
    expect(t.PLACE_NOTE).toContain('в девять раз');
  });

  it('граница аналитически: edge быстрее ⇔ (s + q − 1)·far + near < (s + q)·local', () => {
    for (const near of [2, 10, 30]) {
      for (const far of [15, 90, 280]) {
        for (const local of [1, 5]) {
          for (let q = 0; q <= 6; q++) {
            for (const s of [0, t.SETUP_TRIPS]) {
              const r = compare({ near, far, local, queries: q, setupTrips: s, stream: false });
              const k = s + q;
              expect(r.edge.total < r.region.total, `${near}/${far}/${local}/${q}/${s}`).toBe((k - 1) * far + near < k * local);
            }
          }
        }
      }
    }
  });

  it('стриминг меняет первые байты, а не полное время', () => {
    const a = latency({ userRtt: 10, dbRtt: 90, queries: 3, setupTrips: 0, stream: false });
    const b = latency({ userRtt: 10, dbRtt: 90, queries: 3, setupTrips: 0, stream: true });
    expect(b.total).toBe(a.total);
    expect(b.ttfb).toBe(10);
    expect(a.ttfb).toBe(a.total);
  });

  it('условные RTT не ниже предела оптоволокна (1 мс круга на 100 км)', () => {
    const rad = (d: number) => (d * Math.PI) / 180;
    for (const p of t.PLACE_PRESETS) {
      const [la1, lo1, la2, lo2] = [rad(t.PLACE_DB.lat), rad(t.PLACE_DB.lon), rad(p.lat), rad(p.lon)];
      const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
      const km = 2 * 6371 * Math.asin(Math.sqrt(h));
      expect(p.far, p.id).toBeGreaterThanOrEqual(km / 100);
    }
  });
});

describe('стриминг: STREAM_CODE за node:http', () => {
  it('шапка доходит до клиента раньше, чем отвечает база; целиком — после', async () => {
    const api = new Function(`${t.STREAM_CODE}\nreturn { streamed, buffered };`)() as Record<'streamed' | 'buffered', (db: unknown, log: string[]) => Promise<Response>>;
    const log: string[] = [];
    let ack: () => void = () => {};
    const rows = ['кофе', 'круассан'];
    const db = {
      query: (mode: string) =>
        new Promise<string[]>((r) => {
          const done = () => {
            log.push('база ответила');
            r(rows);
          };
          if (mode === 'stream') ack = done;
          else setImmediate(done);
        }),
    };
    const server = http.createServer(async (req, res) => {
      if (req.url === '/ack') {
        ack();
        res.end();
        return;
      }
      const r = await (req.url === '/stream' ? api.streamed(db, log) : api.buffered(db, log));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      Readable.fromWeb(r.body as never).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as { port: number };
    const out: Record<string, string[]> = {};
    for (const path of ['/stream', '/buffer']) {
      log.length = 0;
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const first = await reader.read();
      log.push(`клиент: первые байты «${dec.decode(first.value)}»`);
      if (path === '/stream') void fetch(`http://127.0.0.1:${port}/ack`);
      let rest = '';
      for (;;) {
        const c = await reader.read();
        if (c.done) break;
        rest += dec.decode(c.value);
      }
      log.push(`клиент: конец${rest ? ` «${rest}»` : ''}`);
      out[path.slice(1)] = [...log];
    }
    server.close();
    expect(out).toEqual(t.STREAM_LOG);
  }, 20_000);
});
