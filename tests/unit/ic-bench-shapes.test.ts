import { describe, expect, it } from 'vitest';
import { IC_CASES, makeRing, shapeExample } from '@/widgets/ic-bench/model/bench';

/** Подпись «что лежало в кольце» перечисляет те же формы, из которых строится кольцо. */
describe('ic-bench: пример форм у каждого случая', () => {
  it.each(IC_CASES)('$label: подпись сходится с кольцом', (item) => {
    const ring = makeRing(item.shapes, 256);
    const kinds = new Set(ring.map((o) => `{ ${Object.keys(o).join(', ')} }`));
    expect(kinds.size).toBe(item.shapes);
    const list = shapeExample(item.shapes);
    if (item.shapes <= 5) expect(list).toEqual([...kinds]);
    else expect(list).toEqual([...[...kinds].slice(0, 2), '…', [...kinds].at(-1)]);
  });

  it('20 форм: первые две и последняя', () => {
    expect(shapeExample(20)).toEqual(['{ x, a00 }', '{ x, a01 }', '…', '{ x, a19 }']);
  });
});
