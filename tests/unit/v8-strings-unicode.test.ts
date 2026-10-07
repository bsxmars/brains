import { describe, expect, it } from 'vitest';
import { COLLATE_CODE, NORMALIZE_CODE } from '@/content/lessons/v8-strings/data';

/**
 * «Строки в V8», раздел «„Символ“ — это четыре разных числа»: формы нормализации
 * и сравнение для человека.
 *
 * Оба примера печатаются в теме и исполняются здесь **той же строкой**, а не копией.
 * Приём построчный: у каждой строки вида `выражение; // → литерал` значение выражения
 * сверяется с литералом, остальные строки (объявления) исполняются как есть. Поправили
 * комментарий в примере — проверка сверяет новый; поправили код — сверяет новый код.
 *
 * Отдельным файлом от `v8-strings.test.ts`: тот пинит представления V8 через
 * `%DebugPrint` в дочерних процессах, а здесь ни движковых флагов, ни процессов не нужно.
 */
function runAnnotated(code: string) {
  const checks: { line: string; expected: string }[] = [];
  const body = code
    .split('\n')
    .map((line) => {
      const m = line.match(/^(.*?);\s*\/\/ → (.+)$/);
      if (!m) return line;
      checks.push({ line: m[1].trim(), expected: m[2].trim() });
      const i = checks.length - 1;
      return `__got[${i}] = (${m[1]}); __want[${i}] = (${m[2]});`;
    })
    .join('\n');

  const got: unknown[] = [];
  const want: unknown[] = [];
  new Function('__got', '__want', '"use strict";\n' + body)(got, want);
  return checks.map((c, i) => ({ ...c, got: got[i], want: want[i] }));
}

describe('пример про формы нормализации исполняется, как напечатан', () => {
  const results = runAnnotated(NORMALIZE_CODE);

  it('в примере есть что проверять', () => {
    expect(results.length).toBeGreaterThanOrEqual(8);
  });

  it.each(results)('$line → $expected', ({ got, want }) => {
    expect(got).toStrictEqual(want);
  });
});

describe('пример про Intl.Collator исполняется, как напечатан', () => {
  const results = runAnnotated(COLLATE_CODE);

  it('в примере есть что проверять', () => {
    expect(results.length).toBeGreaterThanOrEqual(6);
  });

  it.each(results)('$line → $expected', ({ got, want }) => {
    expect(got).toStrictEqual(want);
  });
});
