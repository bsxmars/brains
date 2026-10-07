import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/next-cache/data';
import { normRequests } from '@/widgets/next-cache-lab/model/run';
import type { StandStep, Step } from '@/widgets/next-cache-lab/model/types';

/**
 * Тема «Слои кеша в Next.js» — стенд, пересобранный настоящим Next.
 *
 * Файлы приложения (`APP_FILES`, `APP2_FILES`) пишутся в чистый каталог, `next build` и
 * `next start` (Next из `node_modules` проекта) запускаются на своих портах 52530–52539,
 * рядом — «бэкенд данных» на `node:http`, который считает запросы по ключам. Сценарии
 * (`SCENARIO_STEPS`) проигрываются запросами «как curl» и в Chromium через Playwright, и журнал
 * сверяется с литералами `STAND`, `APP2_STAND`, `REBUILD_HITS`, `BUILD_TABLE` из темы.
 *
 * Время — настоящее, но это не замер: интервалы `revalidate` — 3 и 5 с, ожидания с запасом
 * (5 и 6 с), а после каждого шага тест ждёт, пока журнал бэкенда затихнет, — фоновая
 * перегенерация успевает дойти. Сравниваются наборы ключей, а не порядок: фоновый запрос
 * и запрос рендера идут одновременно.
 *
 * Долгий (около двух минут: три сборки) — поэтому отдельным файлом от быстрой сверки модели.
 * `NEXT_CACHE_DUMP=<файл>` пишет снятый журнал в файл — так литералы и были получены.
 */

const ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname), '../..'));
const NEXT_BIN = join(ROOT, 'node_modules/next/dist/bin/next');
const BACKEND_PORT = 52530;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `turbopack.root` — только потому, что `node_modules` стенда — симлинк за пределы каталога. */
const NEXT_CONFIG = (extra: string) => `export default { ${extra}turbopack: { root: '/' }, outputFileTracingRoot: '/' };\n`;

interface Backend {
  log: string[];
  close(): void;
}

function startBackend(): Promise<Backend> {
  const counts: Record<string, number> = {};
  const log: string[] = [];
  const server = http.createServer((req, res) => {
    const key = (req.url ?? '').replace(/^\/data\//, '');
    counts[key] = (counts[key] ?? 0) + 1;
    log.push(`${key}#${counts[key]}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ n: counts[key] }));
  });
  return new Promise((ok) => server.listen(BACKEND_PORT, '127.0.0.1', () => ok({ log, close: () => server.close() })));
}

let backend: Backend;
const dirs: string[] = [];
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', BACKEND: `http://127.0.0.1:${BACKEND_PORT}`, NODE_ENV: 'production' };

function makeApp(files: Record<string, string>, config: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'next-cache-')));
  dirs.push(dir);
  for (const [p, code] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), code);
  }
  writeFileSync(join(dir, 'next.config.mjs'), config);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}

function nextBuild(dir: string): Promise<string> {
  return new Promise((ok, bad) => {
    const p = spawn(process.execPath, [NEXT_BIN, 'build'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (c) => (c === 0 ? ok(out) : bad(new Error(out))));
  });
}

const servers: ChildProcess[] = [];
async function nextStart(dir: string, port: number): Promise<string> {
  const p = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(p);
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 300 && !/Ready/.test(out); i++) await sleep(100);
  if (!/Ready/.test(out)) throw new Error(`next start не поднялся:\n${out}`);
  return `http://127.0.0.1:${port}`;
}

/** Ждать, пока журнал бэкенда не перестанет расти: фоновые запросы дошли. */
async function settle() {
  let len = -1;
  for (let i = 0; i < 40 && len !== backend.log.length; i++) {
    len = backend.log.length;
    await sleep(400);
  }
}

/** Что на странице: `ключ=n` в порядке разметки — без скриптов RSC-потока. */
function shownOf(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!-- -->/g, '')
    .replace(/<[^>]+>/g, ' ');
  return [...text.matchAll(/\b([a-z]+): (\d+)/g)].map((m) => `${m[1]}=${m[2]}`).join(' ');
}

async function httpStep(base: string, step: Step): Promise<StandStep> {
  const before = backend.log.length;
  if (step.do === 'wait') {
    await sleep(step.s * 1000);
    return { backend: [] };
  }
  if (step.do === 'revalidateTag') await fetch(`${base}/api/revalidate?tag=${step.tag}${step.expire0 ? '&expire=0' : ''}`, { method: 'POST' });
  if (step.do === 'revalidatePath') await fetch(`${base}/api/revalidate?path=${step.path}`, { method: 'POST' });
  if (step.do !== 'get') {
    await settle();
    return { backend: backend.log.slice(before).sort() };
  }
  const r = await fetch(base + step.path);
  const html = await r.text();
  await settle();
  return {
    backend: backend.log.slice(before).sort(),
    xcache: r.headers.get('x-nextjs-cache'),
    cc: r.headers.get('cache-control'),
    shown: shownOf(html),
  };
}

const got: Record<string, StandStep[]> = {};
const app2Got: StandStep[] = [];
let buildTable = '';
let app2Table = '';
let rebuildHits: string[] = [];

beforeAll(async () => {
  backend = await startBackend();

  // 1. Сценарии «как curl»: одна сборка, сценарии по очереди — ключи у них не пересекаются.
  const dir1 = makeApp(t.APP_FILES, NEXT_CONFIG(''));
  let before = backend.log.length;
  const out = await nextBuild(dir1);
  buildTable = out.slice(out.indexOf('Route (app)')).split('\n\n')[0].trim();
  const buildHits = backend.log.slice(before).sort();
  const base1 = await nextStart(dir1, 52531);
  for (const sc of t.SCENARIO_STEPS.filter((s) => s.mode === 'http')) {
    const steps: StandStep[] = [{ backend: buildHits }];
    for (const step of sc.steps) steps.push(await httpStep(base1, step));
    got[sc.id] = steps;
  }

  // 2. Вкладка: своя чистая сборка и свой бэкенд-счётчик с нуля.
  backend.close();
  backend = await startBackend();
  const dir2 = makeApp(t.APP_FILES, NEXT_CONFIG(''));
  before = backend.log.length;
  await nextBuild(dir2);
  const build2 = backend.log.slice(before).sort();
  // Пересборка без очистки .next: кеш данных пережил её.
  await sleep(4000);
  before = backend.log.length;
  await nextBuild(dir2);
  rebuildHits = backend.log.slice(before).sort();

  const base2 = await nextStart(dir2, 52532);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let reqs: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.port !== '52532' || u.pathname.startsWith('/_next/')) return;
      const h = r.headers();
      const kind = h['next-action'] ? 'action' : h['next-router-prefetch'] ? 'prefetch' : h.rsc ? 'rsc' : 'document';
      reqs.push(`${kind} ${u.pathname}`);
    });
    const steps: StandStep[] = [{ backend: build2 }];
    const router = t.SCENARIO_STEPS.find((s) => s.id === 'router')!;
    for (const step of router.steps) {
      reqs = [];
      const b = backend.log.length;
      if (step.do === 'open') await page.goto(base2 + step.path);
      else if (step.do === 'click') await page.click(`nav a[href="${step.path}"]`);
      else if (step.do === 'back') await page.goBack();
      else if (step.do === 'reload') await page.reload();
      else if (step.do === 'action') await page.click('form button');
      else if (step.do === 'revalidateTag') await fetch(`${base2}/api/revalidate?tag=${step.tag}${step.expire0 ? '&expire=0' : ''}`, { method: 'POST' });
      await sleep(1000);
      await settle();
      const html = await page.content();
      steps.push({ backend: backend.log.slice(b).sort(), shown: shownOf(html.slice(html.indexOf('</nav>'))), requests: normRequests(reqs) });
    }
    got.router = steps;
  } finally {
    await browser.close();
  }

  // 3. Новая модель: cacheComponents и 'use cache'.
  backend.close();
  backend = await startBackend();
  const dir3 = makeApp(t.APP2_FILES, NEXT_CONFIG('cacheComponents: true, '));
  before = backend.log.length;
  const out3 = await nextBuild(dir3);
  app2Table = out3.slice(out3.indexOf('Route (app)')).split('\n\n')[0].trim();
  app2Got.push({ backend: backend.log.slice(before).sort() });
  const base3 = await nextStart(dir3, 52533);
  for (const step of t.APP2_STEPS) app2Got.push(await httpStep(base3, step));

  if (process.env.NEXT_CACHE_DUMP) {
    writeFileSync(process.env.NEXT_CACHE_DUMP, JSON.stringify({ got, app2Got, buildTable, app2Table, rebuildHits }, null, 1));
  }
}, 600_000);

afterAll(() => {
  for (const s of servers) s.kill();
  backend?.close();
  // Сначала симлинк на node_modules проекта — unlinkSync: rmSync без recursive на него
  // бросает ERR_FS_EISDIR, и каталоги оставались во временной папке.
  for (const d of dirs) {
    try {
      unlinkSync(join(d, 'node_modules'));
    } catch {
      // не успели создать
    }
    rmSync(d, { recursive: true, force: true });
  }
});

/**
 * Включается только по `NEXT_CACHE_STAND=1` (2026-10-01): три сборки Next и реальные паузы
 * в общем `npm test` давали бы лишнюю минуту и мигание под нагрузкой. Быстрая сверка модели
 * с журналом — в `next-cache.test.ts`, она идёт всегда. Переснять стенд:
 * `NEXT_CACHE_STAND=1 ./node_modules/.bin/vitest run tests/unit/next-cache-stand.test.ts`.
 */
const STAND = process.env.NEXT_CACHE_STAND === '1';

describe.skipIf(!STAND)('стенд Next 16.3.8: журнал совпадает с литералами темы (NEXT_CACHE_STAND=1)', () => {
  it('таблица маршрутов после сборки — BUILD_TABLE', () => {
    expect(buildTable).toBe(t.BUILD_TABLE);
  });

  for (const sc of t.SCENARIO_STEPS) {
    it(`сценарий «${sc.id}» шаг за шагом`, () => {
      expect(got[sc.id]).toEqual(t.STAND[sc.id]);
    });
  }

  it('пересборка без очистки .next не спрашивает бэкенд про force-cache и fetch без опций', () => {
    expect(rebuildHits).toEqual(t.REBUILD_HITS);
  });

  it("'use cache' с cacheLife: сборка, частичный пререндер и шаги — APP2_STAND", () => {
    expect(app2Table).toBe(t.APP2_BUILD_TABLE);
    expect(app2Got).toEqual(t.APP2_STAND);
  });
});
