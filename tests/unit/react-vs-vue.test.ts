import { describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/react-vs-vue/data';

/**
 * Тема «React против Vue», раздел «Цена»: числа прозы выводятся из `MEMORY_ROWS`.
 *
 * Ошибка 2026-10-29: граф оценивался как 911 − 80 = 830 Б, хотя прокси (148 − 80 = 68 Б)
 * назван отдельно в той же фразе — его посчитали дважды. Граф сверх `reactive` — 763 Б
 * на объект, ≈254 Б на ключ.
 */

const perObject = (row: number) => Number(t.MEMORY_ROWS.rows[row][2].replace(/\D/g, ''));
const totalKb = (row: number) => Number(t.MEMORY_ROWS.rows[row][1].replace(/\D/g, ''));
const N = 20_000;
const KEYS = 3;

describe('«Цена»: память графа сходится с MEMORY_ROWS', () => {
  it('байты на объект в таблице выведены из итогов в КБ (КБ округлены — допуск 1 Б)', () => {
    for (const row of [0, 1, 2]) expect(Math.abs((totalKb(row) * 1024) / N - perObject(row))).toBeLessThanOrEqual(1);
    // Граф по итогам в КБ — тот же ответ, что по колонке «на объект».
    expect(Math.round(((totalKb(2) - totalKb(1)) * 1024) / N)).toBe(763);
  });

  it('прокси и граф посчитаны по разу: 68 Б, затем 763 Б и ≈254 Б на ключ', () => {
    const [plain, proxy, graph] = [perObject(0), perObject(1), perObject(2)];
    const proxyCost = proxy - plain;
    const graphCost = graph - proxy;
    expect(proxyCost).toBe(68);
    expect(graphCost).toBe(763);
    expect(Math.round(graphCost / KEYS)).toBe(254);

    expect(t.MEMORY_NOTE).toContain(`${proxyCost} байт на объект`);
    expect(t.MEMORY_NOTE).toContain(`${graphCost} байта на объект`);
    expect(t.MEMORY_NOTE).toContain(`${Math.round(graphCost / KEYS)} байта на ключ`);
    expect(t.MEMORY_WARN).toContain(`${graphCost} байта`);
    const quiz = t.SELF_CHECK.map((q) => JSON.stringify(q)).join('\n');
    expect(quiz).toContain(`около ${Math.round(graphCost / KEYS)} байт на ключ`);
    for (const text of [t.MEMORY_NOTE, t.MEMORY_WARN, quiz]) expect(text).not.toMatch(/\b(830|277) (байт|Б)/);
  });
});

describe('«Различие»: таблица CONTRAST против установленного React', () => {
  it('`<Activity>` — публичный экспорт React (19.2+), а не внутреннее API', async () => {
    const React = await import('react');
    expect(typeof (React as unknown as Record<string, unknown>).Activity).toBe('symbol');
    const row = t.CONTRAST.rows.find((r) => r[0] === 'Кэш скрытого поддерева')!;
    expect(row[1]).toContain('публичный');
    expect(row[1]).not.toMatch(/внутренн/);
  });
});
