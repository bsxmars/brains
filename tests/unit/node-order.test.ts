import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Порядок служебных очередей в Node — тот, что показывает демо урока.
 *
 * В оригинале сценарий был записан только для CommonJS, и это нигде не было сказано. Разница
 * настоящая: тело ES-модуля исполняется как job, поэтому реакции промисов сливаются раньше
 * очереди `process.nextTick`. Читатель, запустивший «тот же пример» в `.mjs`, видел другой
 * вывод и считал, что урок врёт.
 *
 * ⚠️ Что здесь НЕ проверяется: порядок `t` (setTimeout 0 → 1 мс) и `i` (setImmediate) на
 * верхнем уровне. Это настоящая гонка со временем старта процесса, и жёсткая проверка была бы
 * тестом, который иногда падает без причины. Урок говорит о ней ровно то же самое.
 */
const SNIPPET = (isEsm: boolean) => `${isEsm ? "import fs from 'node:fs';" : "const fs = require('node:fs');"}
setTimeout(() => console.log('t'));
setImmediate(() => console.log('i'));
fs.readFile(${isEsm ? 'new URL(import.meta.url)' : '__filename'}, () => {
  setTimeout(() => console.log('io-t'));
  setImmediate(() => console.log('io-i'));
});
process.nextTick(() => console.log('n'));
Promise.resolve().then(() => console.log('p'));
`;

function run(kind: 'cjs' | 'mjs'): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'lesson-node-order-'));
  const file = join(dir, `order.${kind}`);
  writeFileSync(file, SNIPPET(kind === 'mjs'));
  return execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim().split('\n');
}

describe('порядок очередей в Node', () => {
  it('CommonJS: nextTick сливается раньше реакций промисов', () => {
    const out = run('cjs');
    expect(out.slice(0, 2)).toEqual(['n', 'p']);
  });

  it('ESM: тело модуля — это job, поэтому первыми идут промисы', () => {
    const out = run('mjs');
    expect(out.slice(0, 2)).toEqual(['p', 'n']);
  });

  it('внутри I/O-коллбэка setImmediate всегда раньше setTimeout — гонки здесь нет', () => {
    for (const kind of ['cjs', 'mjs'] as const) {
      const out = run(kind);
      expect(out.indexOf('io-i'), kind).toBeLessThan(out.indexOf('io-t'));
    }
  });
});
