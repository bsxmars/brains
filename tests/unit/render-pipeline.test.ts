/**
 * «Кадр браузера»: где выполняется колбэк IntersectionObserver.
 * В кадре — только расчёт пересечений; колбэк ставится задачей (Intersection Observer,
 * «queue an intersection observer task»), стенд «Наблюдателей» видел его позже `setTimeout`
 * из колбэка ResizeObserver. Тест держит все места темы на одной стороне.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FRAME_HOOKS, FRAME_STEPS, OBSERVER_ROWS, PITFALLS, SELF_CHECK } from '@/content/render/render-pipeline/data';

describe('колбэк IntersectionObserver — задачей после кадра', () => {
  it('таблица наблюдателей', () => {
    const io = OBSERVER_ROWS.find((r) => r.k === 'IntersectionObserver')!;
    expect(io.when).toContain('колбэк — отдельной задачей после кадра');
  });

  it('«Пять точек»: карточка не кладёт колбэк IO внутрь кадра', () => {
    const hook = FRAME_HOOKS.find((h) => h.k.includes('IntersectionObserver'))!;
    expect(hook.when).not.toBe('после layout, внутри кадра');
    expect(hook.when).toContain('колбэк IntersectionObserver — задачей');
  });

  it('чип «Пять точек» называет расчёт, а не колбэк', () => {
    const mdx = readFileSync('src/content/render/render-pipeline/index.mdx', 'utf8');
    expect(mdx).not.toContain("label: 'ResizeObserver → IntersectionObserver'");
    expect(mdx).toContain("label: 'ResizeObserver → расчёт IntersectionObserver'");
  });

  it('шаг кадра и самопроверка говорят то же', () => {
    const step = FRAME_STEPS.find((s) => s.phases.includes('observers'))!;
    expect(step.message).toContain('колбэк браузер ставит задачей');
    const q = SELF_CHECK.find((c) => c.question.includes('Три наблюдателя'))!;
    expect(q.answer).toContain('**после** кадра');
  });
});

describe('transition на transform и box-shadow — две анимации', () => {
  /**
   * Замер «Анимаций и композитора» (`animations/data.ts`, `transition transform, box-shadow`):
   * `transform` идёт при занятом потоке. Так пишет тонкое место 06; самопроверка говорила,
   * что на главный поток уезжает «весь трек, включая transform» (вычитка 2026-10-30).
   */
  it('самопроверка не противоречит тонкому месту 06', () => {
    const q = SELF_CHECK.find((c) => c.code?.includes('transition: transform .3s ease, box-shadow'))!;
    expect(q.answer).not.toContain('включая `transform`, тикает на главном потоке');
    expect(q.answer).toContain('это две анимации');
    expect(PITFALLS.find((p) => p.n === '06')!.d).toContain('это **две** анимации');
  });
});

describe('пассивные слушатели по умолчанию', () => {
  /** Chrome 56 — touchstart/touchmove на корневых целях, Chrome 73 — wheel/mousewheel (chromestatus 6662647093133312). */
  it('тонкое место 08 не приписывает wheel к Chrome 56', () => {
    const d = PITFALLS.find((p) => p.n === '08')!.d;
    expect(d).toContain('Chrome 56 для touchmove');
    expect(d).toContain('Chrome 73 для wheel');
  });
});
