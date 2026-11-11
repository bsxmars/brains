import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CLUSTER_ROWS,
  CLUSTER_RR_CODE,
  CLUSTER_RR_OUT,
  ERRORS_CODE,
  ERRORS_OUT,
  FIRST_MAIN_CODE,
  FIRST_OUT,
  FIRST_WORKER_CODE,
  FORK_CHILD_CODE,
  FORK_CODE,
  FORK_OUT,
  FOUR_WAYS,
  ONCE_TRAP_CODE,
  SHARED_ROWS,
  SHARE_ENV_CODE,
  SHARE_ENV_OUT,
  SPAWN_CODE,
  SPAWN_OUT,
  UNTRANSFERABLE_CODE,
  UNTRANSFERABLE_OUT,
} from '@/content/lessons/node-processes/data';

/**
 * Утверждения темы «Процессы и потоки в Node» — запуском.
 *
 * Код примеров берётся из `data.ts` — ровно та строка, что напечатана на странице, — пишется
 * во временный каталог и исполняется отдельным процессом `node`. Отдельный процесс нужен:
 * `cluster.fork` и `child_process.fork` перезапускают файл с диска, а воркеры, поднятые внутри
 * `vitest`, делили бы с ним окружение. Таймеров и замеров времени здесь нет.
 *
 * Проверки `cluster` и `SHARE_ENV` переехали сюда из `workers.test.ts` вместе с текстом.
 */

const dir = mkdtempSync(join(tmpdir(), 'node-processes-topic-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, code: string): string {
  const file = join(dir, name);
  writeFileSync(file, code);
  return file;
}

function run(name: string, code: string): string[] {
  return execFileSync(process.execPath, [write(name, code)], { cwd: dir, encoding: 'utf8', timeout: 20_000 })
    .trim()
    .split('\n');
}

describe('первая законченная задача и выбор механизма', () => {
  it('main.mjs + sum.mjs печатают ровно FIRST_OUT', () => {
    write('sum.mjs', FIRST_WORKER_CODE);
    expect(run('main.mjs', FIRST_MAIN_CODE)).toEqual(FIRST_OUT.split('\n'));
  });

  it.each([
    ['брошенная ошибка', "throw new Error('задача упала')"],
    ['ненулевой выход без error', 'process.exit(3)'],
    ['выход 0 без ответа', '// ответа нет'],
  ])('исходный главный файл возвращает ошибку задачи: %s', (_, body) => {
    write('sum.mjs', body);
    const result = spawnSync(process.execPath, [write('first-failure.mjs', FIRST_MAIN_CODE)], {
      cwd: dir, encoding: 'utf8', timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('сумма:');
    expect(result.stdout).toContain('воркер вышел с кодом');
  });

  it('таблица: у воркера pid тот же, у процессов — свой', () => {
    const pid = FOUR_WAYS.rows.find((r) => r[0] === '`process.pid`')!;
    expect(pid.slice(1)).toEqual(['тот же', 'тот же', 'свой', 'свой']);
    const out = run(
      'pid.mjs',
      `import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const w = new Worker('require("node:worker_threads").parentPort.postMessage(process.pid)', { eval: true });
console.log((await once(w, 'message'))[0] === process.pid);
const c = fork('./pid-child.cjs');
console.log((await once(c, 'message'))[0] === process.pid);`,
    );
    expect(out).toEqual(['true', 'false']);
  });
});

describe('раздел «worker_threads: поток внутри процесса»', () => {
  it('process.env воркера — копия, а SHARE_ENV делает его общим', () => {
    expect(run('share-env.mjs', SHARE_ENV_CODE)).toEqual(SHARE_ENV_OUT);
  });

  it('ошибка, отклонённый промис и process.exit — как в ERRORS_OUT', () => {
    expect(run('errors.mjs', ERRORS_CODE)).toEqual(ERRORS_OUT);
  });

  it('process.chdir в воркере — ERR_WORKER_UNSUPPORTED_OPERATION; общий буфер — общий', () => {
    const row = SHARED_ROWS.find((r) => r.k.includes('process.chdir'))!;
    expect(row.v).toContain('ERR_WORKER_UNSUPPORTED_OPERATION');
    const out = run(
      'chdir.mjs',
      `import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
let w = new Worker('try { process.chdir("/") } catch (e) { require("node:worker_threads").parentPort.postMessage(e.code) }', { eval: true });
console.log((await once(w, 'message'))[0]);
const sab = new SharedArrayBuffer(4);
w = new Worker('const { parentPort } = require("node:worker_threads"); parentPort.once("message", (s) => { new Int32Array(s)[0] = 7; parentPort.postMessage(0); })', { eval: true });
w.postMessage(sab);
await once(w, 'message');
console.log(new Int32Array(sab)[0]);
await w.terminate();`,
    );
    expect(out).toEqual(['ERR_WORKER_UNSUPPORTED_OPERATION', '7']);
  });

  it('Atomics.wait в главном потоке Node разрешён (в браузере — TypeError)', () => {
    expect(run('wait.mjs', `console.log(Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1));`)).toEqual([
      'timed-out',
    ]);
  });
});

describe('раздел «worker_threads» · markAsUntransferable', () => {
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

describe('раздел «child_process: программа рядом»', () => {
  it('spawn: собирает вывод независимо от границ data, exit раньше close', () => {
    expect(run('spawn.mjs', SPAWN_CODE)).toEqual(SPAWN_OUT);
  });

  it('показанный spawn обрабатывает ENOENT и возвращает ненулевой статус', () => {
    const source = SPAWN_CODE.replace('spawn(process.execPath,', "spawn('no-such-bin-node-processes-topic',");
    const result = spawnSync(process.execPath, [write('spawn-missing.mjs', source)], {
      encoding: 'utf8', timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('не удалось запустить: ENOENT');
    expect(result.stdout).toContain('close:');
    expect(result.stdout).not.toContain('exit:');
  });

  it('показанный spawn проверяет ненулевой код дочерней программы', () => {
    const source = SPAWN_CODE.replace("process.stdout.write('раз');", 'process.exitCode = 4;');
    const result = spawnSync(process.execPath, [write('spawn-failed.mjs', source)], {
      encoding: 'utf8', timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('close: 4 null');
  });

  it('fork наследует stdio, silent:true создаёт pipe для родителя', () => {
    const out = run('fork-stdio.mjs', `import { fork } from 'node:child_process';
import { once } from 'node:events';
for (const silent of [false, true]) {
  const c = fork(new URL('./pid-child.cjs', import.meta.url), { silent });
  console.log(c.stdout === null, c.stderr === null);
  await once(c, 'exit');
}`);
    expect(out).toEqual(['true true', 'false false']);
  });

  it('kill() — exit с кодом null и сигналом SIGTERM', () => {
    const out = run(
      'kill.mjs',
      `import { spawn } from 'node:child_process';
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
c.on('spawn', () => c.kill());
c.on('exit', (code, signal) => console.log(code, signal));`,
    );
    expect(out).toEqual(['null SIGTERM']);
  });

  it('exec: ненулевой код — err.code; вывод больше 1 МБ — MAXBUFFER и обрубок', () => {
    const out = run(
      'exec.mjs',
      `import { exec } from 'node:child_process';
exec('exit 4', (err) => {
  console.log(err.code);
  exec(\`"\${process.execPath}" -e "process.stdout.write('x'.repeat(2 * 1024 * 1024))"\`, (e, stdout) => {
    console.log(e.code, stdout.length);
  });
});`,
    );
    expect(out).toEqual(['4', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER 1048576']);
  });

  it('spawn несуществующей программы без обработчика error роняет родителя', () => {
    const file = write('enoent.mjs', `import { spawn } from 'node:child_process';\nspawn('no-such-bin-xyz');\nsetTimeout(() => console.log('жив'), 200);`);
    const res = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 });
    expect(res.status).toBe(1);
    expect(res.stdout).not.toContain('жив');
    expect(res.stderr).toContain('ENOENT');
  });

  it('fork: JSON теряет Date и Map молча, advanced — нет', () => {
    write('echo.cjs', FORK_CHILD_CODE);
    expect(run('parent.mjs', FORK_CODE)).toEqual(FORK_OUT);
  });

  it('показанный fork находит соседний файл независимо от cwd родителя', () => {
    write('echo.cjs', FORK_CHILD_CODE);
    const file = write('fork-different-cwd.mjs', FORK_CODE);
    const out = execFileSync(process.execPath, [file], { cwd: tmpdir(), encoding: 'utf8', timeout: 20_000 });
    expect(out.trim().split('\n')).toEqual(FORK_OUT);
  });

  it('показанный fork отклоняет задачу, если процесс вышел без ответа', () => {
    write('echo.cjs', 'process.exit(0);');
    const file = write('fork-no-reply.mjs', FORK_CODE);
    const result = spawnSync(process.execPath, [file], { cwd: dir, encoding: 'utf8', timeout: 20_000 });
    expect(result.error, 'ожидание ответа не должно зависнуть до внешнего timeout').toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Дочерний процесс не вернул ответ|ERR_IPC_CHANNEL_CLOSED|EPIPE/);
    write('echo.cjs', FORK_CHILD_CODE);
  });

  it('fork: SharedArrayBuffer — {} в JSON и ошибка клонирования в advanced', () => {
    const out = run(
      'fork-sab.mjs',
      `import { fork } from 'node:child_process';
import { once } from 'node:events';
let c = fork('./echo.cjs');
c.send({ sab: new SharedArrayBuffer(4) });
console.log(JSON.stringify((await once(c, 'message'))[0]));
c.disconnect();
c = fork('./echo.cjs', { serialization: 'advanced' });
try { c.send({ sab: new SharedArrayBuffer(4) }); } catch (e) { console.log(/could not be cloned/.test(e.message)); }
c.disconnect();`,
    );
    expect(out).toEqual(['{"sab":{}}', 'true']);
  });
});

describe('раздел «cluster: копии сервера на одном порту»', () => {
  it('новые соединения — по кругу, одно keep-alive соединение — одной копии', () => {
    expect(run('rr.cjs', CLUSTER_RR_CODE)).toEqual(CLUSTER_RR_OUT);
  });

  it('канал cluster — тот же JSON: Map приезжает `{}`', () => {
    expect(CLUSTER_ROWS.find((r) => r.k === 'канал с главным')!.v).toContain('JSON');
    const out = run(
      'cluster-json.cjs',
      `const cluster = require('node:cluster');
if (cluster.isPrimary) {
  const child = cluster.fork();
  child.on('online', () => child.send({ map: new Map([[1, 2]]) }));
  child.on('message', (m) => { console.log(m.pid !== process.pid, JSON.stringify(m.got)); child.kill(); });
} else {
  process.on('message', (got) => process.send({ pid: process.pid, got }));
}`,
    );
    expect(out).toEqual(['true {"map":{}}']);
  });
});

describe('тонкие места', () => {
  it('01: once(worker, "exit") отклоняется, если раньше пришло error', () => {
    const file = write('once.mjs', ONCE_TRAP_CODE + "\nconsole.log('после await');");
    const res = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 20_000 });
    expect(res.status).not.toBe(0);
    expect(res.stdout).not.toContain('после await');
  });
});

writeFileSync(join(dir, 'pid-child.cjs'), 'process.send(process.pid); process.disconnect();');
