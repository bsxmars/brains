import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * Виды элементов массива — те, что урок называет в разделе про elements kinds.
 *
 * Здесь ровно тот случай, ради которого правило «пример с заявленным результатом — это тест»
 * и придумано. Утверждение «`new Array(5).fill(0)` даёт PACKED, а не HOLEY» противоречит
 * доброй половине статей, и проверить его можно только запуском: `%DebugPrint` печатает
 * настоящий вид, который выбрал движок.
 *
 * ⚠️ Это деталь реализации V8, а не гарантия языка. Тест и нужен затем, чтобы смена поведения
 * в новой версии Node остановила сборку, а не осталась незамеченной в тексте урока.
 */
function elementsKind(body: string): string {
  const code = `const a = (() => { ${body} })(); %DebugPrint(a);`;
  const out = execFileSync(process.execPath, ['--allow-natives-syntax', '-e', code], {
    encoding: 'utf8',
  });
  return out.match(/elements kind: (\w+)/)?.[1] ?? 'не найдено';
}

describe('elements kinds — проверка утверждений урока', () => {
  const cases: [string, string, string][] = [
    ['[1,2,3]', 'return [1, 2, 3];', 'PACKED_SMI_ELEMENTS'],
    ['new Array(5)', 'return new Array(5);', 'HOLEY_SMI_ELEMENTS'],
    ['new Array(5).fill(0)', 'const d = new Array(5); d.fill(0); return d;', 'PACKED_SMI_ELEMENTS'],
    [
      'Array.from({length:5}, () => 0)',
      'return Array.from({ length: 5 }, () => 0);',
      'PACKED_SMI_ELEMENTS',
    ],
    ['[1,2,3] + push(4.5)', 'const a = [1, 2, 3]; a.push(4.5); return a;', 'PACKED_DOUBLE_ELEMENTS'],
    ['дыра за длиной', 'const c = [1, 2, 3]; c[10] = 1; return c;', 'HOLEY_SMI_ELEMENTS'],
  ];

  for (const [label, body, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(elementsKind(body)).toBe(expected);
    });
  }
});
