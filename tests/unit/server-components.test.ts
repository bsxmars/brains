import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/server-components/data';
import { loadClient, loadPage, loadServer, pageApi } from '@/widgets/rsc-flight/model/run';
import type { PageOptions } from '@/widgets/rsc-flight/model/types';
import { viewTree } from '@/widgets/rsc-flight/model/view';

/**
 * «Server Components изнутри»: всё, что тема утверждает о потоке Flight, — запуском настоящего
 * `react-server-dom-webpack` 19.3.0.
 *
 * Три среды, и у каждой свой процесс.
 *
 * **Сервер — `node --conditions=react-server`.** Без условия `react-server-dom-webpack/server`
 * не загружается вовсе, а `react` отдаёт обычную сборку вместо серверной. Внутри vitest условие
 * не поставить, поэтому сервер — дочерний процесс (приём из `elements-kinds.test.ts`), дважды:
 * `NODE_ENV=production` и `development`. Какая сборка загружена, процесс сообщает сам.
 *
 * **Клиент — обычный `node`, продакшен.** Настоящий клиент (`client.browser`, `client.node`)
 * и `react-dom/server` — в третьем процессе: им условие `react-server` как раз мешает.
 *
 * **Учебная реализация — строки из `data.ts`.** `FLIGHT_SERVER_CODE` исполняется и в серверном
 * процессе (на элементах настоящего `React.createElement`), и здесь, в vitest, через тот же
 * `loadServer`, что и демо (на элементах учебного `h`). `FLIGHT_CLIENT_CODE` — здесь, через
 * `loadClient` демо. Копий нет: разошлась напечатанная строка с React — красный тест.
 *
 * Порядок ответов «базы» задаётся не таймерами, а макрозадачами (`setImmediate` через шесть
 * оборотов): так порядок кусков не зависит от нагрузки на машину, а таймерных замеров нет вовсе.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Build = 'production' | 'development';

const OPTS: PageOptions[] = [];
for (const like of ['client', 'server'] as const)
  for (const comments of ['sync', 'async'] as const)
    for (const suspense of [true, false])
      for (const prop of ['number', 'date', 'promise', 'action', 'class', 'function'] as const)
        OPTS.push({ like, comments, suspense, prop });

// ---------------------------------------------------------------------------
// Общее: макрозадачи вместо таймеров и «база» с заданным порядком ответов
// ---------------------------------------------------------------------------

const HELPERS = String.raw`
const turns = (n) => new Promise((r) => { const step = (k) => (k ? setImmediate(() => step(k - 1)) : r()); step(n); });
function makeQuery(data, order) {
  const d = {};
  const get = (n) => d[n] || (d[n] = (() => { let res; const p = new Promise((r) => (res = r)); return { p, res }; })());
  const release = async () => { for (const n of order) { await turns(6); get(n).res(data[n]); } };
  return { query: (n) => get(n).p, release };
}
`;

// ---------------------------------------------------------------------------
// Сервер: node --conditions=react-server
// ---------------------------------------------------------------------------

const SERVER_SCRIPT = String.raw`
const { Writable } = require('node:stream');
const path = require('node:path');
const fs = require('node:fs');
const React = require('react');
const S = require('react-server-dom-webpack/server');
const job = JSON.parse(process.env.RSC_JOB);
const h = React.createElement;
${HELPERS}
const renderToFlight = new Function(job.serverCode + '\nreturn renderToFlight;')();
const page = new Function(job.pageCode + '\nreturn page;')();
const manifest = job.manifest;

const client = (mod, name) => S.registerClientReference(function () { throw new Error('client'); }, mod, name);
const action = (mod, name) => S.registerServerReference(async function () {}, mod, name);
const api = (query) => ({ h, Suspense: React.Suspense, client, action, query });

function real(tree, release, onError) {
  const chunks = []; const errs = [];
  return new Promise((done) => {
    S.renderToPipeableStream(tree, manifest, {
      onError(e) { errs.push(String(e && e.message)); return onError ? onError(e) : undefined; },
    }).pipe(new Writable({
      write(c, _e, cb) { chunks.push(c.toString()); cb(); },
      final(cb) { cb(); done({ chunks, errs }); },
    }));
    if (release) release();
  });
}
async function mini(tree, release) {
  const chunks = []; const errs = [];
  const fin = renderToFlight(tree, manifest, { onChunk: (c) => chunks.push(c), onError: (e) => errs.push(e.message) });
  if (release) release();
  await fin;
  return { chunks, errs };
}
const both = async (make) => ({ real: await real(make()), mini: await mini(make()) });

(async () => {
  const out = {};

  // 48 сочетаний демо: настоящий сервер и учебный — на одних и тех же элементах React
  out.combos = [];
  for (const opts of job.opts) {
    const q1 = makeQuery(job.data, job.order);
    const r = await real(page(opts, api(q1.query)), q1.release);
    const q2 = makeQuery(job.data, job.order);
    const m = await mini(page(opts, api(q2.query)), q2.release);
    out.combos.push({ opts, real: r, mini: m });
  }

  // Деревья для утверждений о формате
  const Like = client('like', 'Like');
  const save = action('actions', 'save');
  const shared = { a: 1 };
  const wait = (n) => turns(n);
  const trees = {
    promise: () => h(Like, { data: Promise.resolve(5) }),
    action: () => h(Like, { onSave: save, again: save }),
    bound: () => h(Like, { save: save.bind(null, 'post-7') }),
    scalars: () => h(Like, { d: new Date(0), n: 10n, u: undefined, s: '$5', nan: NaN, inf: Infinity, neg: -0 }),
    mapset: () => h(Like, { m: new Map([['a', 1]]), s: new Set([1]) }),
    error: () => h(Like, { e: new Error('секрет') }),
    shared: () => h(Like, { x: shared, y: shared }),
    long1024: () => h('p', null, 'я'.repeat(1024)),
    long1023: () => h('p', null, 'я'.repeat(1023)),
    big: () => h('div', null, Array.from({ length: 40 }, (_, i) => h('p', { key: String(i) }, 'y'.repeat(100)))),
    twoClients: () => h('div', null, h(Like, { n: 1 }), h(Like, { n: 2 })),
    hostClick: () => h('button', { onClick: () => {} }, 'x'),
    clientChildren: () => h(Like, null, h('span', null, 'из сервера')),
    asyncRoot: () => h(async function Root() { await wait(3); return h('b', null, 'готово'); }),
    sameTick: () => h('div', null, h(async function A() { await null; return 'A'; }), h(async function B() { await null; return 'B'; })),
    twoAsync: () => h('div', null, h(async function A() { await wait(12); return 'A'; }), h(async function B() { await wait(3); return 'B'; })),
    sourceless: () => h(function Post() { const secret = 'пароль-от-базы'; return h('article', null, secret.length); }),
  };
  out.format = {};
  for (const [name, make] of Object.entries(trees)) out.format[name] = await both(make);

  // Таблица пропсов: вычисляется, а не набирается
  out.props = [];
  for (const c of job.propCases) {
    const value = new Function('save', 'return ' + c.code)(save);
    out.props.push(await real(h(Like, { [c.key || 'v']: value })));
  }

  // Ошибка с осмысленным digest — для клиента
  out.digest = await real(h('div', null, h(function Boom() { throw new Error('упал'); })), null, () => 'abc');

  // Серверная сборка React
  out.react = {
    keys: Object.keys(React),
    version: React.version,
  };
  try { const { useState } = React; useState(0); } catch (e) { out.react.useStateError = e.name + ': ' + e.message; }

  // cache(): листинг темы как напечатан, «база» считает свои вызовы
  {
    const db = { calls: 0, user: async (id) => { db.calls++; return { id, name: 'Аня' }; } };
    const l = new Function('cache', 'db', 'h', job.cacheCode + '\nreturn { getUser, page, Name };')(React.cache, db, h);
    const counts = [];
    db.calls = 0; await real(l.page); counts.push(db.calls);
    db.calls = 0; await real(h(l.Name)); await real(h(l.Name)); counts.push(db.calls);
    db.calls = 0; await l.getUser(1); await l.getUser(1); counts.push(db.calls);
    let c2 = 0; const byObj = React.cache(() => { c2++; return 1; });
    function A() { byObj({ id: 1 }); byObj({ id: 1 }); const k = { id: 1 }; byObj(k); byObj(k); return null; }
    await real(h(A)); counts.push(c2);
    out.cache = counts;
    out.cachePage = (await real(l.page)).chunks.join('');
  }

  // 'use client' / 'use server' через node-register — тот же приём, что у сборщика
  {
    require('react-server-dom-webpack/node-register')();
    const dir = job.fixtureDir;
    fs.writeFileSync(path.join(dir, 'Like.js'), "'use client';\nglobalThis.__likeBodyRan = (globalThis.__likeBodyRan || 0) + 1;\nexports.Like = function Like() { return null; };\n");
    fs.writeFileSync(path.join(dir, 'actions.js'), "'use server';\nexports.save = async function save(id) { return id + 1; };\n");
    const likeMod = require(path.join(dir, 'Like.js'));
    const actMod = require(path.join(dir, 'actions.js'));
    out.register = {
      bodyRan: globalThis.__likeBodyRan || 0,
      likeTag: String(likeMod.Like.$$typeof),
      likeId: likeMod.Like.$$id,
      saveTag: String(actMod.save.$$typeof),
      saveId: actMod.save.$$id,
      saveWorks: await actMod.save(1),
    };
  }

  // Аргументы серверной функции: decodeReply
  {
    const args = await S.decodeReply(job.reply, {});
    out.decoded = { json: JSON.stringify(args), isDate: args[2] instanceof Date };
  }

  out.loaded = Object.keys(require.cache)
    .filter((f) => /react-server-dom-webpack-server\.node\.|react\.react-server\./.test(f))
    .map((f) => f.split('/').pop());
  process.stdout.write(JSON.stringify(out));
})();
`;

interface Run {
  chunks: string[];
  errs: string[];
}

interface ServerOut {
  combos: { opts: PageOptions; real: Run; mini: Run }[];
  format: Record<string, { real: Run; mini: Run }>;
  props: Run[];
  digest: Run;
  react: { keys: string[]; version: string; useStateError?: string };
  cache: number[];
  cachePage: string;
  register: { bodyRan: number; likeTag: string; likeId: string; saveTag: string; saveId: string; saveWorks: number };
  decoded: { json: string; isDate: boolean };
  loaded: string[];
}

const REPLY = '[7,{"note":"x"},"$D1970-01-01T00:00:00.000Z"]';

function serverRun(build: Build): ServerOut {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'lesson-rsc-'));
  const stdout = execFileSync(process.execPath, ['--conditions=react-server', '-e', SERVER_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      NODE_ENV: build,
      RSC_JOB: JSON.stringify({
        serverCode: t.FLIGHT_SERVER_CODE,
        pageCode: t.PAGE_CODE,
        manifest: t.DEMO_MANIFEST,
        data: t.DEMO_DATA,
        order: t.DEMO_ORDER,
        opts: OPTS,
        propCases: t.PROP_CASES,
        fixtureDir,
        reply: REPLY,
        cacheCode: t.CACHE_CODE,
      }),
    },
  });
  return JSON.parse(stdout) as ServerOut;
}

// ---------------------------------------------------------------------------
// Нормализация дерева: одна и та же функция для настоящего клиента и учебного
// ---------------------------------------------------------------------------

/**
 * Дерево → JSON, который можно сравнить. Ленивые обёртки настоящего клиента раскрываются
 * через `_init`: «бросил промис» — ещё не пришло, «бросил ошибку» — элемент упал. Дыры учебного
 * клиента — то же самое. Строка, а не функция: её же исполняет клиентский процесс.
 */
const NORMALIZE = String.raw`
function norm(x) {
  const EL = Symbol.for('react.transitional.element');
  const LAZY = Symbol.for('react.lazy');
  const HOLE = Symbol.for('учебный.flight.дыра');
  const typeName = (tp) => {
    if (typeof tp === 'string') return tp;
    if (typeof tp === 'symbol') return String(tp);
    if (typeof tp === 'function') return 'client:' + tp.name;
    if (tp && tp.$$typeof === LAZY) { try { return typeName(tp._init(tp._payload)); } catch (e) { return 'client:pending'; } }
    return '?' + String(tp);
  };
  if (x === undefined) return { undefined: true };
  if (typeof x === 'number' && !Number.isFinite(x)) return { num: String(x) };
  if (Object.is(x, -0)) return { num: '-0' };
  if (typeof x === 'bigint') return { bigint: String(x) };
  if (typeof x === 'symbol') return { symbol: String(x) };
  if (typeof x === 'function') return 'function';
  if (x === null || typeof x !== 'object') return x;
  if (x instanceof Date) return { date: x.toISOString() };
  if (x.$$typeof === EL) return { el: typeName(x.type), key: x.key, props: norm(x.props) };
  if (x.$$typeof === LAZY) {
    try { return norm(x._init(x._payload)); } catch (e) { return e && typeof e.then === 'function' ? 'pending' : { error: (e && e.digest) || '' }; }
  }
  if (x.$$typeof === HOLE) return x.error ? { error: x.error.digest || '' } : 'pending';
  if (typeof x.then === 'function') {
    x.then(() => {}, () => {});
    if (x.status === 'fulfilled') return { promise: norm(x.value) };
    if (x.status === 'rejected') return { promise: { error: (x.reason && x.reason.digest) || '' } };
    return { promise: 'pending' };
  }
  if (Array.isArray(x)) return x.map(norm);
  const o = {};
  for (const k of Object.keys(x)) o[k] = norm(x[k]);
  return o;
}
`;

const norm = new Function(`${NORMALIZE}\nreturn norm;`)() as (x: unknown) => unknown;

// ---------------------------------------------------------------------------
// Клиент: обычный node, продакшен
// ---------------------------------------------------------------------------

const CLIENT_SCRIPT = String.raw`
const { PassThrough, Readable } = require('node:stream');
const job = JSON.parse(process.env.RSC_JOB);
let modules = { like: { Like: function Like() {} } };
globalThis.__webpack_require__ = (id) => modules[id];
globalThis.__webpack_chunk_load__ = () => Promise.resolve();
const React = require('react');
const CN = require('react-server-dom-webpack/client.node');
const CB = require('react-server-dom-webpack/client.browser');
const { renderToString, renderToPipeableStream } = require('react-dom/server');
${HELPERS}
${NORMALIZE}
const manifest = { moduleMap: { like: { Like: { id: 'like', chunks: ['like', 'like.js'], name: 'Like' } } }, serverModuleMap: null, moduleLoading: null };
const readable = (text) => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); c.close(); } });

function rootView(root) {
  root.then(() => {}, () => {});
  return root.status === 'fulfilled' ? norm(root.value) : root.status === 'rejected' ? { error: root.reason.digest || '' } : 'pending';
}

function describe(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'number') return 'число ' + v;
  if (typeof v === 'string') return 'строка ' + JSON.stringify(v);
  if (typeof v === 'bigint') return 'BigInt ' + v;
  if (typeof v === 'symbol') return String(v);
  if (typeof v === 'function') return 'функция';
  if (v instanceof Date) return 'Date';
  if (v instanceof Map) return 'Map';
  if (v instanceof Set) return 'Set';
  if (v instanceof Error) return v.message.includes('секрет') ? 'Error: ' + v.message : 'Error без исходного текста';
  if (v && typeof v.then === 'function') { v.then(() => {}, () => {}); return v.status === 'fulfilled' ? 'промис → ' + v.value : 'промис (' + v.status + ')'; }
  return 'объект';
}

(async () => {
  const out = {};

  // Настоящий клиент после каждого куска
  out.combos = [];
  for (const chunks of job.combos) {
    const pt = new PassThrough();
    const root = CN.createFromNodeStream(pt, manifest);
    root.then(() => {}, () => {});
    const views = [];
    for (let k = 0; k < chunks.length; k++) {
      pt.write(chunks[k]);
      if (k === chunks.length - 1) pt.end();
      await turns(4);
      views.push(rootView(root));
    }
    out.combos.push(views);
  }

  // Что получает клиент в пропе
  out.props = [];
  for (const flight of job.props) {
    const root = await CB.createFromReadableStream(readable(flight), { callServer: async () => null });
    const key = job.propKeys[out.props.length];
    const lazy = root;
    let el = lazy;
    let fell = false;
    if (el && el.$$typeof === Symbol.for('react.lazy')) { try { el = el._init(el._payload); } catch (e) { fell = true; } }
    await turns(3);
    out.props.push(fell ? 'элемент упал' : describe(el.props[key]));
  }

  // Ошибка: продакшен-клиент получает общий текст и digest — в Node и в браузерной сборке
  {
    const root = await CN.createFromNodeStream(Readable.from([job.digestFlight]), manifest);
    const lazy = root.props.children;
    try { lazy._init(lazy._payload); out.digest = null; } catch (e) { out.digest = { message: e.message, digest: e.digest }; }
    const broot = await CB.createFromReadableStream(readable(job.digestFlight), { callServer: async () => null });
    const blazy = broot.props.children;
    try { blazy._init(blazy._payload); out.digestBrowser = null; } catch (e) { out.digestBrowser = { message: e.message, digest: e.digest }; }
  }

  // Серверная функция: что получает callServer, как кодируются аргументы
  {
    const calls = [];
    const root = await CB.createFromReadableStream(readable(job.actionFlight), {
      callServer: async (id, args) => { calls.push({ id, args }); return 'ok'; },
    });
    const fn = root.props.onSave;
    const same = fn === root.props.again;
    await fn(7, { note: 'x' });
    out.action = { calls: JSON.stringify(calls), sameFunction: same, reply: await CB.encodeReply([7, { note: 'x' }, new Date(0)]) };
  }

  // SSR поверх Flight: листинг темы как напечатан
  {
    const AsyncFunction = (async () => {}).constructor;
    const run = new AsyncFunction('h', 'useState', 'createFromNodeStream', 'renderToString', 'flight', 'manifest',
      'globalThis.__webpack_require__ = () => ({ Like });\n' + job.ssrCode + '\nreturn html;');
    out.ssr = await run(React.createElement, React.useState, CN.createFromNodeStream, renderToString, Readable.from(job.sample), manifest);
  }

  // Каркас SSR на первом куске: с Suspense и без
  out.shell = {};
  for (const [name, first] of Object.entries(job.firstChunks)) {
    modules = { like: { Like: function Like() { return React.createElement('button', null, '♥'); } } };
    globalThis.__webpack_require__ = (id) => modules[id];
    const pt = new PassThrough();
    const tree = CN.createFromNodeStream(pt, manifest);
    pt.write(first);
    await turns(4);
    let ready = false;
    let html = '';
    const s = renderToPipeableStream(React.createElement(() => React.use(tree)), {
      onShellReady() {
        ready = true;
        const sink = new PassThrough();
        sink.on('data', (d) => (html += d));
        s.pipe(sink);
      },
      onError() {},
    });
    await turns(20);
    out.shell[name] = { ready, html };
    s.abort();
  }

  process.stdout.write(JSON.stringify(out));
})();
`;

interface ClientOut {
  combos: unknown[][];
  props: string[];
  digest: { message: string; digest: string } | null;
  digestBrowser: { message: string; digest: string } | null;
  action: { calls: string; sameFunction: boolean; reply: string };
  ssr: string;
  shell: Record<string, { ready: boolean; html: string }>;
}

function clientRun(job: object): ClientOut {
  const stdout = execFileSync(process.execPath, ['-e', CLIENT_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: 'production', RSC_JOB: JSON.stringify(job) },
  });
  return JSON.parse(stdout) as ClientOut;
}

// ---------------------------------------------------------------------------
// Прогон
// ---------------------------------------------------------------------------

const prod = serverRun('production');
const dev = serverRun('development');
const sameOpts = (a: PageOptions, b: object) => JSON.stringify(a) === JSON.stringify(b);
const comboOf = (o: object) => prod.combos.find((c) => sameOpts(c.opts, o))!;
const firstLine = (s: string) => s.split('\n')[0];

const client = clientRun({
  combos: prod.combos.map((c) => c.real.chunks),
  props: prod.props.map((r) => r.chunks.join('')),
  propKeys: t.PROP_CASES.map((c) => c.key ?? 'v'),
  digestFlight: prod.digest.chunks.join(''),
  actionFlight: prod.format.action.real.chunks.join(''),
  ssrCode: t.SSR_FROM_FLIGHT_CODE,
  sample: t.FLIGHT_SAMPLE,
  firstChunks: {
    suspense: t.FLIGHT_SAMPLE[0],
    none: comboOf({ ...t.SAMPLE_OPTS, suspense: false }).real.chunks[0],
  },
});

describe.each(['production', 'development'] as const)('сервер, сборка %s', (build) => {
  const out = build === 'production' ? prod : dev;

  it('загружена заказанная сборка сервера и серверная сборка React', () => {
    const server = out.loaded.find((f) => f.startsWith('react-server-dom-webpack-server.node.'));
    expect(server, out.loaded.join(', ')).toContain(build);
    expect(out.loaded.some((f) => f.startsWith('react.react-server.'))).toBe(true);
    expect(out.react.version).toBe('19.3.0');
  });

  it('в серверной сборке React нет хуков состояния и эффектов, но есть cache и use', () => {
    for (const k of t.SERVER_REACT_MISSING) expect(out.react.keys, k).not.toContain(k);
    for (const k of t.SERVER_REACT_HAS) expect(out.react.keys, k).toContain(k);
    expect(out.react.useStateError).toBe('TypeError: useState is not a function');
    expect(t.SERVER_REACT_NOTE).toContain('TypeError: useState is not a function');
  });
});

describe('учебный сериализатор против настоящего: 48 сочетаний демо', () => {
  it('сочетаний 48, и в каждом больше одного куска там, где есть async', () => {
    expect(prod.combos).toHaveLength(48);
    for (const c of prod.combos) {
      if (c.opts.comments === 'async') expect(c.real.chunks.length, JSON.stringify(c.opts)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(OPTS.map((o) => [JSON.stringify(o), o] as const))('%s — поток байт в байт и кусок в кусок', (_n, o) => {
    const c = comboOf(o);
    expect(c.mini.chunks).toEqual(c.real.chunks);
  });

  it('ошибки onError: учебные сообщения — первые строки настоящих, дословно', () => {
    let seen = 0;
    for (const c of prod.combos) {
      expect(c.mini.errs, JSON.stringify(c.opts)).toEqual(c.real.errs.map(firstLine));
      seen += c.real.errs.length;
    }
    // 2 недопустимых пропа (класс, функция) × 2 × 2 сочетания с клиентским лайком
    expect(seen).toBe(8);
  });

  it('тот же код в vitest на учебном h (путь демо) даёт тот же поток, что настоящий React', async () => {
    const renderToFlight = loadServer(t.FLIGHT_SERVER_CODE);
    const page = loadPage(t.PAGE_CODE);
    const turns = (n: number) =>
      new Promise<void>((r) => {
        const step = (k: number) => (k ? setImmediate(() => step(k - 1)) : r());
        step(n);
      });
    for (const o of OPTS) {
      const pending: Record<string, { p: Promise<unknown>; res: (v: unknown) => void }> = {};
      const get = (n: string) => {
        if (!pending[n]) {
          let res!: (v: unknown) => void;
          const p = new Promise((r) => (res = r));
          pending[n] = { p, res };
        }
        return pending[n];
      };
      const chunks: string[] = [];
      const fin = renderToFlight(page(o, pageApi((n) => get(n).p)), t.DEMO_MANIFEST, { onChunk: (c) => chunks.push(c) });
      for (const n of t.DEMO_ORDER) {
        await turns(6);
        get(n).res(t.DEMO_DATA[n]);
      }
      await fin;
      expect(chunks, JSON.stringify(o)).toEqual(comboOf(o).real.chunks);
    }
  });
});

describe('учебный клиент против настоящего: дерево после каждого куска', () => {
  const createFromFlight = loadClient(t.FLIGHT_CLIENT_CODE);
  const modules = { like: { Like: function Like() {} } };

  it.each(OPTS.map((o, i) => [JSON.stringify(o), i] as const))('%s', (_n, i) => {
    const chunks = prod.combos[i].real.chunks;
    const views = client.combos[i];
    expect(views).toHaveLength(chunks.length);
    for (let k = 1; k <= chunks.length; k++) {
      const mini = norm(createFromFlight(chunks.slice(0, k).join(''), modules));
      expect(mini, `после куска ${k}`).toEqual(views[k - 1]);
    }
  });

  it('до последнего куска в async-сочетаниях дыры есть, после — нет (проверка не пустая)', () => {
    const i = OPTS.findIndex((o) => sameOpts(o, t.SAMPLE_OPTS));
    expect(JSON.stringify(client.combos[i][0])).toContain('"pending"');
    expect(JSON.stringify(client.combos[i].at(-1))).not.toContain('"pending"');
  });

  it('недопустимый проп валит у настоящего клиента весь элемент, а не только проп', () => {
    const i = OPTS.findIndex((o) => sameOpts(o, { ...t.SAMPLE_OPTS, prop: 'function' }));
    const tree = client.combos[i][0] as { props: { children: unknown[] } };
    expect(tree.props.children[1]).toEqual({ error: '' });
  });
});

describe('демо: что показывает дерево', () => {
  const createFromFlight = loadClient(t.FLIGHT_CLIENT_CODE);
  const modules = { like: { Like: function Like() {} } };

  it('с Suspense после первого куска — заглушки, без Suspense — пустой экран', () => {
    const withS = viewTree(createFromFlight(t.FLIGHT_SAMPLE[0], modules));
    expect(withS.blank).toBe(false);
    expect(withS.lines.filter((l) => l.kind === 'fallback')).toHaveLength(2);
    const none = comboOf({ ...t.SAMPLE_OPTS, suspense: false }).real.chunks;
    expect(viewTree(createFromFlight(none[0], modules)).blank).toBe(true);
    expect(viewTree(createFromFlight(none.join(''), modules)).blank).toBe(false);
  });

  it('клиентский компонент помечен клиентским, упавший элемент — ошибкой', () => {
    const full = viewTree(createFromFlight(t.FLIGHT_SAMPLE.join(''), modules));
    expect(full.lines.some((l) => l.kind === 'client' && l.text.startsWith('<Like'))).toBe(true);
    const bad = comboOf({ ...t.SAMPLE_OPTS, prop: 'class' }).real.chunks.join('');
    expect(viewTree(createFromFlight(bad, modules)).lines.some((l) => l.kind === 'error')).toBe(true);
  });
});

describe('формат потока — утверждения раздела', () => {
  it('FLIGHT_SAMPLE — дословно настоящий поток для SAMPLE_OPTS, по кускам', () => {
    expect(comboOf(t.SAMPLE_OPTS).real.chunks).toEqual(t.FLIGHT_SAMPLE);
  });

  it('кусок «похожих» (4:) приходит раньше комментариев (3:) — по готовности, а не по месту', () => {
    expect(t.FLIGHT_SAMPLE[1].startsWith('4:')).toBe(true);
    expect(t.FLIGHT_SAMPLE[2].startsWith('3:')).toBe(true);
  });

  it('каждый префикс из таблицы встречается в настоящем потоке своего дерева', () => {
    for (const p of t.PREFIXES) {
      const text = p.where === 'sample' ? t.FLIGHT_SAMPLE.join('') : prod.format[p.where].real.chunks.join('');
      expect(text, `${p.p} в дереве ${p.where}`).toContain(p.example);
    }
  });

  it('T-строка: с 1024 символов, длина — в байтах UTF-8 шестнадцатерично', () => {
    const long = prod.format.long1024.real.chunks.join('');
    expect(long.startsWith('1:T800,')).toBe(true);
    expect(Buffer.byteLength('я'.repeat(1024))).toBe(0x800);
    expect(prod.format.long1023.real.chunks.join('')).not.toContain(':T');
    expect(t.ROW_KINDS.rows.some((r) => r[0].includes('1:T800,'))).toBe(true);
  });

  it('одна I-строка на модуль, сколько бы раз он ни встретился', () => {
    const text = prod.format.twoClients.real.chunks.join('');
    expect(text.match(/:I\[/g)).toHaveLength(1);
    expect(text.match(/"\$L1"/g)).toHaveLength(2);
  });

  it('в куске сначала I-строки и символы, потом модели, последними ошибки', () => {
    const rows = comboOf({ ...t.SAMPLE_OPTS, prop: 'function' }).real.chunks[0].split('\n').filter(Boolean);
    const kinds = rows.map((r) => (/^\w+:I/.test(r) ? 0 : /^\w+:"\$S/.test(r) ? 0 : /^\w+:E/.test(r) ? 2 : 1));
    expect(kinds).toEqual([...kinds].sort());
    expect(kinds).toContain(2);
  });

  it('отладочная сборка: строки :N и D, номера с буквами, поток в несколько раз больше', () => {
    const d = dev.combos.find((c) => sameOpts(c.opts, t.SAMPLE_OPTS))!.real.chunks.join('');
    const p = t.FLIGHT_SAMPLE.join('');
    expect(d).toMatch(/^:N\d/);
    expect(d).toMatch(/\n\w+:D\{/);
    expect(d).toMatch(/\n[a-f][0-9a-f]*:/);
    expect(p).not.toMatch(/\n[a-f][0-9a-f]*:/);
    expect(d.length / p.length).toBeGreaterThan(2);
  });

  it('в потоке нет кода серверного компонента — только его результат', () => {
    const text = prod.format.sourceless.real.chunks.join('');
    expect(text).toBe('0:["$","article",null,{"children":14}]\n');
    expect(text).not.toContain('пароль');
    expect(text).not.toContain('Post');
  });
});

describe('различия учебного и настоящего — обе стороны', () => {
  const both = (name: string) => ({
    real: prod.format[name].real.chunks.join(''),
    mini: prod.format[name].mini.chunks.join(''),
  });

  it('T-строка есть только у настоящего', () => {
    const { real, mini } = both('long1024');
    expect(real).toContain(':T');
    expect(mini).not.toContain(':T');
  });

  it('повторный объект: у настоящего ссылка по пути, у учебного копия', () => {
    const { real, mini } = both('shared');
    expect(real).toContain('"y":"$0:props:x"');
    expect(mini).toContain('"y":{"a":1}');
  });

  it('большая синхронная модель: настоящий режет на $L, учебный — одной строкой', () => {
    const { real, mini } = both('big');
    expect(real).toContain('"$L1"');
    expect(mini).not.toContain('$L');
    expect(mini.split('\n').filter(Boolean)).toHaveLength(1);
  });

  it('Map, Set и Error: у настоящего префиксы, у учебного ошибка', () => {
    expect(both('mapset').real).toContain('"$Q2"');
    expect(both('mapset').real).toContain('"$W3"');
    expect(both('error').real).toContain('"$Z"');
    expect(prod.format.mapset.mini.errs[0]).toMatch(/^Only plain objects/);
    expect(prod.format.error.mini.errs[0]).toMatch(/^Only plain objects/);
  });

  it('bind: у настоящего аргументы уходят строкой, у учебного bound всегда null', () => {
    const { real, mini } = both('bound');
    expect(real).toContain('"bound":"$@3"');
    expect(real).toContain('3:["post-7"]');
    expect(mini).toContain('"bound":null');
  });

  it('текст ошибки: у настоящего больше одной строки (указатель), учебный — первая', () => {
    const c = comboOf({ ...t.SAMPLE_OPTS, prop: 'function' });
    expect(c.real.errs[0].split('\n').length).toBeGreaterThan(1);
    expect(c.mini.errs[0].split('\n')).toHaveLength(1);
  });

  it('таблица MINI_VS_REAL называет все проверенные различия', () => {
    const text = JSON.stringify(t.MINI_VS_REAL.rows);
    for (const s of ['1024', '$0:props:x', '3200', '$Q', '$Z', 'bound', ':N']) expect(text, s).toContain(s);
  });
});

describe("граница 'use client'", () => {
  it('PROP_CASES: значение в строке 0 и прочие строки — как у настоящего сервера', () => {
    t.PROP_CASES.forEach((c, i) => {
      const rows = prod.props[i].chunks.join('').split('\n').filter(Boolean);
      const root = rows.find((r) => r.startsWith('0:'))!;
      const props = JSON.parse(root.slice(2))[3] as Record<string, unknown>;
      expect(JSON.stringify(props[c.key ?? 'v']), c.code).toBe(c.wire);
      const other = rows.filter((r) => !r.startsWith('0:') && !/^\w+:I\[/.test(r)).join('\n');
      expect(other, c.code).toBe(c.rows);
    });
  });

  it('PROP_CASES: что получил настоящий клиент (client.browser)', () => {
    expect(client.props).toEqual(t.PROP_CASES.map((c) => c.arrives));
  });

  it('BOUNDARY_ERRORS — дословно первые строки onError', () => {
    const firsts = new Set(prod.props.flatMap((r) => r.errs.map(firstLine)));
    for (const row of t.BOUNDARY_ERRORS.rows) expect([...firsts], row[0]).toContain(row[1]);
    expect(firsts.size).toBe(t.BOUNDARY_ERRORS.rows.length);
  });

  it('onClick у обычного <button> в серверном компоненте — та же ошибка', () => {
    const r = prod.format.hostClick.real;
    expect(firstLine(r.errs[0])).toBe('Event handlers cannot be passed to Client Component props.');
    expect(r.chunks.join('')).toBe('0:["$","button",null,{"onClick":"$1","children":"x"}]\n1:E{"digest":""}\n');
  });

  it('серверный лайк с функцией в пропе — ошибок нет', () => {
    const c = comboOf({ ...t.SAMPLE_OPTS, like: 'server', prop: 'function' });
    expect(c.real.errs).toEqual([]);
    expect(c.real.chunks[0]).toContain('"♥ function"');
  });

  it('серверные элементы в children клиентского — обычный кортеж', () => {
    expect(prod.format.clientChildren.real.chunks.join('')).toContain(
      '0:["$","$L1",null,{"children":["$","span",null,{"children":"из сервера"}]}]',
    );
  });

  it("node-register: тело модуля с 'use client' не исполняется, экспорты — ссылки", () => {
    const r = prod.register;
    expect(r.bodyRan).toBe(0);
    expect(r.likeTag).toBe('Symbol(react.client.reference)');
    expect(r.likeId).toMatch(/^file:\/\/\/.*\/Like\.js#Like$/);
    expect(r.saveTag).toBe('Symbol(react.server.reference)');
    expect(r.saveId).toMatch(/actions\.js#save$/);
    expect(r.saveWorks).toBe(2);
  });

  it('продакшен-клиент получает общий текст и digest из onError', () => {
    expect(prod.digest.chunks.join('')).toContain('1:E{"digest":"abc"}');
    expect(client.digest?.digest).toBe('abc');
    expect(client.digest?.message).toMatch(/^An error occurred in the Server Components render\. The specific message is omitted in production builds/);
    // браузерная сборка сжимает тот же текст до номера
    expect(client.digestBrowser?.digest).toBe('abc');
    expect(client.digestBrowser?.message).toMatch(/^Minified React error #441;/);
    const pit = t.PITFALLS.find((p) => p.n === '02')!;
    expect(pit.d).toContain('The specific message is omitted in production builds');
    expect(pit.d).toContain('Minified React error #441');
  });

  it('отладочная сборка кладёт в E-строку текст ошибки, продакшен — нет', () => {
    const d = dev.combos.find((c) => sameOpts(c.opts, { ...t.SAMPLE_OPTS, prop: 'function' }))!.real.chunks.join('');
    expect(d).toMatch(/:E\{"digest":"","name":"Error","message":"Functions cannot be passed/);
    const p = comboOf({ ...t.SAMPLE_OPTS, prop: 'function' }).real.chunks.join('');
    expect(p).toContain(':E{"digest":""}\n');
    expect(p).not.toContain('"message"');
  });
});

describe('серверные функции', () => {
  it('одна строка на функцию, в ней только id и bound', () => {
    const text = prod.format.action.real.chunks.join('');
    expect(text).toContain('2:{"id":"actions#save","bound":null}');
    expect(text).toContain('{"onSave":"$h2","again":"$h2"}');
  });

  it('клиент зовёт callServer(id, args); две ссылки на одну строку — две разные функции', () => {
    expect(client.action.calls).toBe('[{"id":"actions#save","args":[7,{"note":"x"}]}]');
    expect(client.action.sameFunction).toBe(false);
    expect(JSON.stringify(t.ACTION_FACTS)).toContain('две разные функции');
  });

  it('encodeReply и decodeReply: тот же $-синтаксис, Date возвращается Date', () => {
    expect(client.action.reply).toBe(REPLY);
    expect(t.ACTION_CODE).toContain(`'${REPLY}'`);
    expect(prod.decoded.isDate).toBe(true);
    expect(prod.decoded.json).toBe('[7,{"note":"x"},"1970-01-01T00:00:00.000Z"]');
  });
});

describe('async, Suspense и cache', () => {
  it('async-корень: строка 0 приходит позже целиком, без "$L"', () => {
    const r = prod.format.asyncRoot;
    expect(r.real.chunks).toEqual(['0:["$","b",null,{"children":"готово"}]\n']);
    expect(r.mini.chunks).toEqual(r.real.chunks);
  });

  it('два async, готовые к одной макрозадаче, — один кусок; у учебного так же', () => {
    const r = prod.format.sameTick;
    expect(r.real.chunks).toEqual(['0:["$","div",null,{"children":["$L1","$L2"]}]\n', '1:"A"\n2:"B"\n']);
    expect(r.mini.chunks).toEqual(r.real.chunks);
  });

  it('разные макрозадачи — разные куски, по готовности', () => {
    const r = prod.format.twoAsync;
    expect(r.real.chunks.slice(1)).toEqual(['2:"B"\n', '1:"A"\n']);
    expect(r.mini.chunks).toEqual(r.real.chunks);
  });

  it('Suspense не меняет ни дыр, ни порядка кусков — только обёртки и строку символа', () => {
    for (const o of OPTS.filter((x) => x.suspense && x.comments === 'async')) {
      const withS = comboOf(o).real.chunks;
      const none = comboOf({ ...o, suspense: false }).real.chunks;
      expect(withS.length, JSON.stringify(o)).toBe(none.length);
      expect(withS.slice(1).map((c) => c.slice(c.indexOf(':'))), JSON.stringify(o)).toEqual(
        none.slice(1).map((c) => c.slice(c.indexOf(':'))),
      );
      expect(withS[0]).toContain('"$Sreact.suspense"');
      expect(none[0]).not.toContain('$S');
    }
  });

  it('SSR на первом куске: с Suspense каркас готов с заглушкой, без — не готов', () => {
    expect(client.shell.suspense.ready).toBe(true);
    expect(client.shell.suspense.html).toContain('Загружаем…');
    expect(client.shell.none.ready).toBe(false);
  });

  it('SSR поверх Flight: листинг темы даёт SSR_FROM_FLIGHT_HTML', () => {
    expect(client.ssr).toBe(t.SSR_FROM_FLIGHT_HTML);
  });

  it('cache(): вызовов ровно столько, сколько в CACHE_RUNS', () => {
    expect(prod.cache).toEqual(t.CACHE_COUNTS);
    // листинг действительно отрисовался, а не упал до запросов
    expect(prod.cachePage).toContain('"children":"Аня"');
    expect(t.CACHE_RUNS.rows.map((r) => Number(r[1]))).toEqual(t.CACHE_COUNTS);
  });
});

describe('текст темы не расходится с прогоном', () => {
  it('в FORMAT_FACTS и ORDER_FACTS нет чисел, которых тест не проверяет', () => {
    const facts = JSON.stringify([...t.FORMAT_FACTS, ...t.ORDER_FACTS]);
    expect(facts).not.toContain('вдвое');
    expect(facts).toContain('`4:` приходит раньше `3:`');
  });

  it('BOUNDARY_FACTS называет то, что показал node-register', () => {
    const f = JSON.stringify(t.BOUNDARY_FACTS);
    expect(f).toContain('Symbol(react.client.reference)');
    expect(f).toContain('#Like');
  });
});
