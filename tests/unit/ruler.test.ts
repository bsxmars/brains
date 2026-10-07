import { describe, expect, it } from 'vitest';
import { RULER } from '@/content/lessons/promise-internals/data';
import { runWithRuler } from '@/features/run-snippet';

/**
 * Примеры с заявленной ценой — это тесты.
 *
 * В оригинале линейка показывала числа, вписанные руками: два из девяти оказались неверными
 * («await thenable» и «await Promise.all([p])» стоили не 3 тика, а 2). Ошибка такого рода
 * не ловится ни типами, ни сборкой — её ловит только запуск. Здесь исполняется тот же код,
 * что и на странице, тем же способом (`run-snippet`), и цена сверяется с данными урока.
 *
 * Расхождение означает одно из двух: либо в уроке написана неправда, либо движок изменил
 * поведение — и то и другое стоит увидеть до читателя.
 */
describe('линейка тиков — «Промис изнутри»', () => {
  for (const preset of RULER) {
    it(`${preset.label} — ${preset.n} тик(а)`, async () => {
      const { lines, ok } = await runWithRuler(preset.code, 8);
      expect(ok).toBe(true);

      const hit = lines.findIndex((line) => line.startsWith('<-- здесь'));
      expect(hit, 'пример не напечатал «<-- здесь»').toBeGreaterThan(-1);

      const measured = lines.slice(0, hit).filter((line) => line.startsWith('tick')).length;
      expect(measured).toBe(preset.n);
    });
  }
});
