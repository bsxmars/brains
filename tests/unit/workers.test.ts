import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ERRORS_CODE,
  PITFALLS,
  POOL_CODE,
  POOL_WORKER_CODE,
  TIME_ORIGIN_NOTE,
} from '@/content/lessons/workers/data';

/**
 * Утверждения темы «Воркеры и параллелизм» о Node — запуском.
 *
 * Код примеров берётся из `data.ts` — ровно та строка, что напечатана на странице, — пишется
 * во временный файл и исполняется отдельным процессом `node`. Отдельный процесс нужен
 * по двум причинам: `cluster.fork` перезапускает файл из `process.argv[1]` (из `-e` он
 * не работает), а воркеры, поднятые внутри процесса `vitest`, делили бы с ним окружение.
 *
 * Браузерные утверждения темы (шрифты и размер холста в воркере, часы воркера) здесь
 * не проверяются: они сняты Playwright-прогоном и подписаны в шапке `data.ts`.
 * Таймеров и замеров времени здесь нет — только детерминированный вывод.
 */

const dir = mkdtempSync(join(tmpdir(), 'workers-topic-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name: string, code: string): string[] {
  const file = join(dir, name);
  writeFileSync(file, code);
  return execFileSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 })
    .trim()
    .split('\n');
}

describe('раздел 4 · часы по обе стороны границы', () => {
  /**
   * В браузере `timeOrigin` выделенного воркера — момент его создания (снято Playwright-ом),
   * а в Node тема утверждает обратное: у `worker_threads` он общий с процессом. Это
   * утверждение и проверяется: если Node однажды заведёт воркеру свои часы, ⚠️-оговорку
   * в `TIME_ORIGIN_NOTE` придётся снять.
   */
  it('у worker_threads timeOrigin общий с процессом', () => {
    expect(TIME_ORIGIN_NOTE).toContain('общий с процессом');
    const out = run(
      'origin.mjs',
      `import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
const w = new Worker('require("node:worker_threads").parentPort.postMessage(performance.timeOrigin)', { eval: true });
const [origin] = await once(w, 'message');
console.log(origin === performance.timeOrigin);`,
    );
    expect(out).toEqual(['true']);
  });
});

describe('изоляция · тонкое место не спорит с замером', () => {
  it('проза не говорит «конструктор оставлен», проверка — crossOriginIsolated', () => {
    const pitfall = PITFALLS.find((p) => p.t.startsWith('SharedArrayBuffer недоступен'))!;
    expect(pitfall.d).not.toMatch(/оставля\w* конструктор/);
    expect(pitfall.d).toContain('crossOriginIsolated');
    expect(pitfall.d).toMatch(/WebAssembly/);
  });
});

/**
 * Пул из раздела 6 — запуском. `Worker` браузера подменён прослойкой поверх `worker_threads`:
 * снаружи `onmessage` / `onerror` / `postMessage` / `terminate`, внутри — `self` с
 * `postMessage`, `onmessage` и `addEventListener('error' | 'unhandledrejection')`.
 * Код воркера — строка `POOL_WORKER_CODE` темы, в которой подменена только `work`.
 */
describe('раздел 6 · пул воркеров', () => {
  const SELF_SHIM = `const { parentPort, threadId } = require('node:worker_threads');
const listeners = { error: [], unhandledrejection: [] };
const self = {
  postMessage: (m) => parentPort.postMessage(m),
  addEventListener: (type, fn) => listeners[type].push(fn),
  set onmessage(fn) { parentPort.on('message', (data) => fn({ data })); },
};
process.on('uncaughtException', (e) => { for (const fn of listeners.error) fn({ message: 'Uncaught ' + e.message }); });
process.on('unhandledRejection', (r) => { for (const fn of listeners.unhandledrejection) fn({ reason: r }); });
`;

  const TEST_WORK = `let active = 0;
const work = async (data) => {
  if (data.kind === 'fail') throw new Error('плохие данные');
  if (data.kind === 'hang') for (;;);
  if (data.kind === 'fatal') { setTimeout(() => { throw new Error('поздний сбой'); }); return new Promise(() => {}); }
  if (data.kind === 'twice') { setTimeout(() => self.postMessage({ id: current, result: 'запоздало' }), 30); return 'первый'; }
  if (data.kind === 'who') { active++; const peak = active; await new Promise((r) => setTimeout(r, 40)); active--; return peak; }
  return data.n * 2;
};`;

  it('в листинге воркера есть заменяемая строка work, а ERRORS_CODE шлёт тот же { fatal }', () => {
    expect(POOL_WORKER_CODE).toMatch(/^const work = .*$/m);
    expect(ERRORS_CODE).toContain('fatal:');
    expect(POOL_CODE).toContain('data.fatal');
  });

  it('очередь, ошибка задачи, падение воркера, таймаут и запоздалое сообщение', () => {
    const workerSource = SELF_SHIM + POOL_WORKER_CODE.replace(/^const work = .*$/m, TEST_WORK);
    const code = `import { Worker as NodeWorker } from 'node:worker_threads';
const SOURCE = ${JSON.stringify(workerSource)};
let spawned = 0;
class Worker {
  constructor(url) {
    spawned++;
    this.onmessage = null;
    this.onerror = null;
    const src = url === 'broken.js' ? 'синтаксическая ошибка (' : SOURCE;
    this.w = new NodeWorker(src, { eval: true });
    this.w.on('message', (data) => this.onmessage?.({ data }));
    this.w.on('error', (e) => this.onerror?.({ message: e.message }));
  }
  postMessage(data, transfer) { this.w.postMessage(data, transfer); }
  terminate() { this.w.terminate(); }
}

${POOL_CODE}

const show = (p) => p.then((v) => 'ok ' + v, (e) => 'err ' + e.message);

// 1. два воркера и очередь на три: шесть задач — пять ответов и один быстрый отказ
let pool = new WorkerPool('w.js', 2, 3);
const six = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => show(pool.run({ n }))));
console.log(six.join(' | '));

// 2. ошибка задачи — reject, воркер жив; 3. { fatal } — reject и замена; 4. таймаут — reject и замена
pool = new WorkerPool('w.js', 1);
spawned = 0;
console.log(await show(pool.run({ kind: 'fail' })), spawned);
console.log(await show(pool.run({ kind: 'fatal' })), spawned);
console.log(await show(pool.run({ kind: 'hang' }, { timeout: 200 })), spawned);
console.log(await show(pool.run({ n: 21 })));

// 5. запоздалое сообщение не кладёт воркер в свободные второй раз
pool = new WorkerPool('w.js', 1);
console.log(await show(pool.run({ kind: 'twice' })));
await new Promise((r) => setTimeout(r, 80));
const peaks = await Promise.all([pool.run({ kind: 'who' }), pool.run({ kind: 'who' })]);
console.log('одновременно в одном воркере:', Math.max(...peaks));

// 6. воркер не загрузился — событие error отклоняет задачу
pool = new WorkerPool('broken.js', 1);
console.log((await show(pool.run({ n: 1 }))).startsWith('err '));
process.exit(0);
`;
    const out = run('pool.mjs', code);
    expect(out).toEqual([
      'ok 2 | ok 4 | ok 6 | ok 8 | ok 10 | err pool: очередь полна',
      'err плохие данные 0',
      'err Uncaught поздний сбой 1',
      'err pool: таймаут 2',
      'ok 42',
      'ok первый',
      'одновременно в одном воркере: 1',
      'true',
    ]);
  });
});
