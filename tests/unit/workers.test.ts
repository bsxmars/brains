import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLUSTER_CODE,
  CLUSTER_OUT,
  ERRORS_CODE,
  ISOLATION,
  ISOLATION_FOOT,
  MONEY_CODE,
  PITFALLS,
  NODE_PAR,
  POOL_CODE,
  POOL_WORKER_CODE,
  PUBLISH_CODE,
  PUBLISH_OUT,
  SHARE_ENV_CODE,
  SHARE_ENV_OUT,
  TIME_ORIGIN_NOTE,
  UNTRANSFERABLE_CODE,
  UNTRANSFERABLE_OUT,
} from '@/content/lessons/workers/data';
import { Money as DemoMoney } from '@/widgets/clone-survival/model/cases';

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

describe('раздел 1 · Node: worker_threads против cluster', () => {
  it('канал cluster по умолчанию — JSON: Map и SharedArrayBuffer приезжают `{}` молча', () => {
    expect(run('cluster.cjs', CLUSTER_CODE)).toEqual([CLUSTER_OUT]);
  });

  it('с `serialization: advanced` Map доезжает, а SharedArrayBuffer — ошибка клонирования', () => {
    const code = CLUSTER_CODE.replace(
      "if (cluster.isPrimary) {\n",
      "if (cluster.isPrimary) {\n  cluster.setupPrimary({ serialization: 'advanced' });\n",
    ).replace(
      'child.send({ map: new Map([[1, 2]]), sab: new SharedArrayBuffer(4) });',
      "try { child.send({ sab: new SharedArrayBuffer(4) }); } catch (e) { console.log(/could not be cloned/.test(e.message)); }\n    child.send({ map: new Map([[1, 2]]) });",
    ).replace(
      'process.send({ pid: process.pid, got })',
      'process.send({ pid: process.pid, got: { isMap: got.map instanceof Map } })',
    );
    expect(code).toContain('setupPrimary');
    expect(run('cluster-advanced.cjs', code)).toEqual(['true', 'true {"isMap":true}']);
  });

  it('worker_threads: тот же pid, process.exit завершает только воркер, ошибка — событием', () => {
    const out = run(
      'threads.mjs',
      `import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
let w = new Worker('require("node:worker_threads").parentPort.postMessage(process.pid)', { eval: true });
const [pid] = await once(w, 'message');
console.log(pid === process.pid);
w = new Worker('process.exit(3)', { eval: true });
console.log((await once(w, 'exit'))[0]);
w = new Worker('throw new Error("boom")', { eval: true });
console.log((await once(w, 'error'))[0].message);
const sab = new SharedArrayBuffer(4);
w = new Worker('const { parentPort } = require("node:worker_threads"); parentPort.once("message", (s) => { new Int32Array(s)[0] = 7; parentPort.postMessage(0); })', { eval: true });
w.postMessage(sab);
await once(w, 'message');
console.log(new Int32Array(sab)[0]);
await w.terminate();`,
    );
    expect(out).toEqual(['true', '3', 'boom', '7']);
    // таблица на странице говорит то же самое
    const rows = Object.fromEntries(NODE_PAR.rows.map((r) => [r[0], r.slice(1)]));
    expect(rows['`process.pid`']?.[0]).toMatch(/тот же/);
    expect(rows['`process.exit()` внутри']?.[0]).toMatch(/только воркер/);
  });

  it('process.env воркера — копия, а SHARE_ENV делает его общим', () => {
    expect(run('share-env.mjs', SHARE_ENV_CODE)).toEqual(SHARE_ENV_OUT);
  });
});

describe('раздел 3 · markAsUntransferable', () => {
  it('пул Buffer помечен, перенос помеченного буфера — DataCloneError, копия проходит', () => {
    expect(run('untransferable.mjs', UNTRANSFERABLE_CODE)).toEqual(UNTRANSFERABLE_OUT);
  });

  it('Buffer.alloc пул не использует — его буфер не помечен', () => {
    const out = run(
      'alloc.mjs',
      `import { isMarkedAsUntransferable } from 'node:worker_threads';
console.log(isMarkedAsUntransferable(Buffer.alloc(3).buffer), isMarkedAsUntransferable(Buffer.allocUnsafe(3).buffer));`,
    );
    expect(out).toEqual(['false true']);
  });
});

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

describe('изоляция · текст не спорит с таблицей замера', () => {
  it('без изоляции `typeof SharedArrayBuffer` — undefined, и проза не говорит «конструктор оставлен»', () => {
    const row = ISOLATION.rows.find((r) => r[0] === '`typeof SharedArrayBuffer`')!;
    expect(row[1]).toBe("'undefined'");
    const pitfall = PITFALLS.find((p) => p.t.startsWith('SharedArrayBuffer недоступен'))!;
    for (const text of [ISOLATION_FOOT, pitfall.d]) {
      expect(text).not.toMatch(/оставля\w* конструктор/);
      expect(text).toContain('crossOriginIsolated');
      expect(text).toMatch(/WebAssembly/);
    }
  });
});

describe('раздел 2 · сквозной класс Money', () => {
  it('листинг: копия — { currency }, не экземпляр; через DTO и Money.from класс собирается', () => {
    const out = new Function(
      `"use strict";\n${MONEY_CODE}\nreturn { copy, isInstance: copy instanceof Money, formatted: back.format() };`,
    )() as { copy: object; isInstance: boolean; formatted: string };
    expect(out.copy).toEqual({ currency: 'EUR' });
    expect(Object.keys(out.copy)).toEqual(['currency']);
    expect(out.isInstance).toBe(false);
    expect(out.formatted).toBe('12.5 EUR');
  });

  it('демо клонирует тот же класс: те же ключи копии и тот же format()', () => {
    expect(structuredClone(new DemoMoney(1250))).toEqual({ currency: 'EUR' });
    expect(DemoMoney.from(structuredClone(new DemoMoney(1250).toDTO())).format()).toBe('12.5 EUR');
  });
});

describe('раздел 5 · публикация через атомарный флажок', () => {
  it('листинг самодостаточен: все виды объявлены, B читает результат', () => {
    const lines: string[] = [];
    new Function('console', `"use strict";\n${PUBLISH_CODE}`)({ log: (v: unknown) => lines.push(String(v)) });
    expect(lines).toEqual([PUBLISH_OUT]);
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
