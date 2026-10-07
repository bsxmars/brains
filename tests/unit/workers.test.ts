import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLUSTER_CODE,
  CLUSTER_OUT,
  NODE_PAR,
  SHARE_ENV_CODE,
  SHARE_ENV_OUT,
  TIME_ORIGIN_NOTE,
  UNTRANSFERABLE_CODE,
  UNTRANSFERABLE_OUT,
} from '@/content/lessons/workers/data';

/**
 * Утверждения темы «Воркеры и параллелизм» о Node — запуском.
 *
 * Код примеров берётся из `data.ts` — ровно та строка, что напечатана на странице, — пишется
 * во временный файл и исполняется отдельным процессом `node`. Отдельный процесс нужен
 * по двум причинам: `cluster.fork` перезапускает файл из `process.argv[1]` (из `-e` он
 * не работает), а воркеры, поднятые внутри процесса `vitest`, делили бы с ним окружение.
 *
 * Браузерные утверждения темы (шрифты и размер офскрин-холста, часы воркера) здесь
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
