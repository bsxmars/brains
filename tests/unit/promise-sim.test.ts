import { describe, expect, it } from 'vitest';
import { RULER } from '@/content/lessons/promise-internals/data';
import { runWithRuler } from '@/features/run-snippet';
import { simulate } from '@/shared/lib/promise-sim';

/**
 * Модель спеки обязана сходиться с движком.
 *
 * Лента микрозадач в уроке — это рассказ о том, что происходит внутри, и врать он не имеет
 * права. Проверка простая: цена, которую посчитала модель, и цена, которую показал настоящий
 * движок на том же примере, — одно и то же число. Плюс оба сходятся с тем, что написано
 * в данных урока.
 *
 * Разойдутся — значит либо модель упрощает не там, где думала, либо движок изменил порядок.
 * И то и другое обязано остановить сборку, а не уехать читателю.
 */
describe('модель трёх операций против движка', () => {
  for (const preset of RULER) {
    it(`${preset.label}: модель, движок и данные дают ${preset.n}`, async () => {
      const model = simulate(preset.program);

      const { lines, ok } = await runWithRuler(preset.code, 8);
      expect(ok).toBe(true);
      const hit = lines.findIndex((line) => line.startsWith('<-- здесь'));
      const engine = lines.slice(0, hit).filter((line) => line.startsWith('tick')).length;

      expect(model.price, 'модель разошлась с данными урока').toBe(preset.n);
      expect(engine, 'движок разошёлся с данными урока').toBe(preset.n);
      expect(model.steps.at(-1)?.hit, 'лента обрывается не на искомой реакции').toBe(true);
    });
  }
});
