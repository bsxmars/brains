/**
 * «Кадр браузера»: где выполняется колбэк IntersectionObserver.
 * В кадре — только расчёт пересечений; колбэк ставится задачей (Intersection Observer,
 * «queue an intersection observer task»), стенд «Наблюдателей» видел его позже `setTimeout`
 * из колбэка ResizeObserver. Тест держит все места темы на одной стороне.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FRAME_HOOKS, FRAME_PHASES, FRAME_STEPS, OBSERVER_ROWS, OBSERVER_STEPS, PITFALLS, SELF_CHECK, UPDATE_STEPS } from '@/content/render/render-pipeline/data';

describe('колбэк IntersectionObserver — отдельной задачей', () => {
  it('таблица наблюдателей', () => {
    const io = OBSERVER_ROWS.find((r) => r.k === 'IntersectionObserver')!;
    expect(io.when).toContain('колбэк — отдельной задачей вне текущего обновления рендеринга');
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
    expect(q.answer).toContain('**отдельной задачей**');
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


describe('плановый layout предшествует ResizeObserver', () => {
  // HTML Standard update the rendering: rAF → style/layout + доставка RO в цикле → расчёт IO.
  it('дорожка и рассказ показывают один порядок', () => {
    const ids = ['raf', 'style', 'layout', 'observers', 'prepaint', 'paint', 'commit'];
    const times = ids.map((id) => FRAME_PHASES.find((phase) => phase.id === id)!.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const steps = ids.map((id) => FRAME_STEPS.findIndex((step) => step.phases.includes(id)));
    expect(steps.every((step) => step >= 0)).toBe(true);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    const layout = UPDATE_STEPS.findIndex((step) => step.includes('пересчёт стилей и раскладки'));
    const ro = UPDATE_STEPS.findIndex((step) => step.startsWith('**`ResizeObserver`**'));
    expect(layout).toBeGreaterThan(-1);
    expect(ro).toBeGreaterThan(layout);
  });

  it('rAF не обещает актуальный layout после произвольной записи', () => {
    const raf = UPDATE_STEPS.find((step) => step.includes('**коллбэки `requestAnimationFrame`**'))!;
    expect(raf).toContain('после записи может вызвать layout');
    expect(raf).not.toContain('и она актуальна');
  });
});


it('IntersectionObserver не обещает доставку за один кадр', () => {
  // Queue a task задаёт асинхронность, а не верхнюю границу задержки занятого главного потока.
  const step = OBSERVER_STEPS.find((item) => item.k === 'IntersectionObserver')!;
  expect(step.cost).toContain('Верхней границы задержки в один кадр нет');
  expect(step.cost).not.toContain('с задержкой до кадра');
});
