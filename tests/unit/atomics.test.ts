import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CAS_CODE,
  LITMUS_MAIN_CODE,
  LITMUS_WORKER_CODE,
  MUTEX_CODE,
  MUTEX_MAIN_CODE,
  MUTEX_WORKER_CODE,
  OPS_ROWS,
  PUBLISH_CODE,
  PUBLISH_OUT,
  RACE_MAIN_CODE,
  RACE_WORKER_CODE,
  WAIT_CODE,
  WAIT_LOOP_CODE,
  WAIT_NOTE,
  WAIT_OUT,
} from '@/content/lessons/atomics/data';

/**
 * Утверждения темы «Atomics: общая память без гонок» — запуском.
 *
 * В Node `SharedArrayBuffer` и `Atomics` доступны без изоляции, поэтому многопоточные примеры
 * исполняются честно: строки из `data.ts` пишутся во временный каталог и запускаются отдельным
 * процессом `node`. Гонки недетерминированы, и тест держит только то, что обещано всегда:
 * `Atomics` даёт точный ответ, обычный код — не больше точного. Ноль перестановок у обычных
 * записей ничего не доказывает независимо от архитектуры, поэтому его тест не проверяет.
 */

const dir = mkdtempSync(join(tmpdir(), 'atomics-topic-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, code: string) {
  writeFileSync(join(dir, name), code);
}

function run(name: string, code: string): string[] {
  write(name, code);
  return execFileSync(process.execPath, [join(dir, name)], { cwd: dir, encoding: 'utf8', timeout: 60_000 })
    .trim()
    .split('\n');
}

describe('раздел «Первый общий счётчик»', () => {
  it('++ из четырёх воркеров не больше 4 000 000, Atomics.add — ровно 4 000 000', () => {
    write('count.mjs', RACE_WORKER_CODE);
    const [plain, atomic] = run('main.mjs', RACE_MAIN_CODE).map((line) => line.split(' '));
    expect(plain[0]).toBe('++');
    expect(Number(plain[1])).toBeLessThanOrEqual(4_000_000);
    expect(atomic).toEqual(['Atomics.add', '4000000']);
  });
});

describe('раздел «Атомарные операции»', () => {
  it('таблица возвратов совпадает с движком', () => {
    const out = run(
      'ops.mjs',
      `const a = new Int32Array(new SharedArrayBuffer(8));
console.log(Atomics.store(a, 0, 5), Atomics.add(a, 0, 2), Atomics.load(a, 0));
console.log(Atomics.exchange(a, 0, 1), Atomics.compareExchange(a, 0, 9, 3), a[0], Atomics.compareExchange(a, 0, 1, 3), a[0]);
try { Atomics.add(new Float64Array(new SharedArrayBuffer(8)), 0, 1); } catch (e) { console.log(e.name); }
try { Atomics.wait(new Int32Array(4), 0, 0, 1); } catch (e) { console.log(e.name); }
try { Atomics.add(new BigInt64Array(new SharedArrayBuffer(8)), 0, 1); } catch (e) { console.log(e.name); }
console.log(typeof Atomics.pause);`,
    );
    expect(out).toEqual(['5 5 7', '7 1 1 1 3', 'TypeError', 'TypeError', 'TypeError', 'function']);
    expect(OPS_ROWS.find((r) => r.k.startsWith('`Atomics.add`'))!.v).toContain('старое');
  });

  it('atomicMax из четырёх воркеров даёт общий максимум', () => {
    write('max.mjs', `${CAS_CODE}
import { workerData } from 'node:worker_threads';
const cells = new Int32Array(workerData.buffer);
for (let v = 0; v <= workerData.top; v++) atomicMax(cells, 0, v);`);
    const out = run(
      'max-main.mjs',
      `import { Worker } from 'node:worker_threads';
const cells = new Int32Array(new SharedArrayBuffer(4));
const ws = [100_000, 250_000, 175_000, 50_000].map((top) => new Worker(new URL('./max.mjs', import.meta.url), { workerData: { buffer: cells.buffer, top } }));
await Promise.all(ws.map((w) => new Promise((r) => w.on('exit', r))));
console.log(cells[0]);`,
    );
    expect(out).toEqual(['250000']);
  });
});

describe('раздел «Порядок»', () => {
  it('PUBLISH_CODE самодостаточен: B печатает 499.5', () => {
    const lines: string[] = [];
    new Function('console', `"use strict";\n${PUBLISH_CODE}`)({ log: (v: unknown) => lines.push(String(v)) });
    expect(lines).toEqual([PUBLISH_OUT]);
  });

  it('litmus: с Atomics флажок не обгоняет данные ни разу', () => {
    write('role.mjs', LITMUS_WORKER_CODE);
    const out = run('litmus.mjs', LITMUS_MAIN_CODE).map((line) => line.split(' '));
    expect(out[0][0]).toBe('обычные');
    expect(Number(out[0][1])).toBeGreaterThanOrEqual(0);
    expect(out[1]).toEqual(['Atomics', '0']);
  });
});

describe('раздел «Ждать и будить»', () => {
  it('wait, waitAsync и notify отвечают как в WAIT_OUT', () => {
    expect(run('wait.mjs', WAIT_CODE)).toEqual(WAIT_OUT);
  });

  it('store не будит ожидающего; notify не меняет условие, поэтому нужен цикл', async () => {
    const cell = new Int32Array(new SharedArrayBuffer(4));
    const waiter = Atomics.waitAsync(cell, 0, 0);
    Atomics.store(cell, 0, 1);
    expect(Atomics.notify(cell, 0)).toBe(1); // После store ожидание всё ещё зарегистрировано.
    expect(await waiter.value).toBe('ok');
    expect(Atomics.waitAsync(cell, 0, 0)).toEqual({ async: false, value: 'not-equal' });

    Atomics.store(cell, 0, 0);
    let waitCalls = 0;
    let secondWait!: () => void;
    const waitingAgain = new Promise<void>((resolve) => { secondWait = resolve; });
    const observedAtomics = {
      load: Atomics.load,
      waitAsync(flag: Int32Array, index: number, expected: number) {
        const result = Atomics.waitAsync(flag, index, expected);
        if (++waitCalls === 2) secondWait();
        return result;
      },
    };
    const waitUntilReady = new Function('Atomics', `${WAIT_LOOP_CODE}\nreturn waitUntilReady;`)(observedAtomics) as (flag: Int32Array) => Promise<void>;
    let ready = false;
    const done = waitUntilReady(cell).then(() => { ready = true; });
    expect(Atomics.notify(cell, 0)).toBe(1);
    await waitingAgain; // Уведомление доставлено, и показанный код действительно снова ждёт.
    expect(Atomics.load(cell, 0)).toBe(0);
    expect(ready).toBe(false);
    Atomics.store(cell, 0, 1);
    expect(Atomics.notify(cell, 0)).toBe(1);
    await done;
    expect(ready).toBe(true);
    expect(WAIT_NOTE).toContain('снова проверяет условие');
  });
});

describe('раздел «Замок»', () => {
  it('с замком пара полей — 400000 400000', () => {
    write('mutex.mjs', MUTEX_CODE);
    write('pair.mjs', MUTEX_WORKER_CODE);
    const [plain, locked] = run('mutex-main.mjs', MUTEX_MAIN_CODE);
    expect(plain.startsWith('без замка:')).toBe(true);
    expect(locked).toBe('с замком: 400000 400000');
  });
});


it('store возвращает приведённый аргумент до усечения к типу ячейки', () => {
  const bytes = new Int8Array(new SharedArrayBuffer(1));
  expect(Atomics.store(bytes, 0, 257)).toBe(257);
  expect(Atomics.load(bytes, 0)).toBe(1);
  expect(Atomics.store(bytes, 0, 3.9)).toBe(3);
  expect(Atomics.load(bytes, 0)).toBe(3);
  const big = new BigInt64Array(new SharedArrayBuffer(8));
  const value = 2n ** 64n + 1n;
  expect(Atomics.store(big, 0, value)).toBe(value);
  expect(Atomics.load(big, 0)).toBe(1n);
});
