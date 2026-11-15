import { describe, expect, it } from 'vitest';
import { FIELD_LAB_ROWS, LCP_OBSERVER_CODE, PITFALLS, SELF_CHECK } from '@/content/render/rendering-crp/data';

/** Регрессии двух устаревших обобщений: режим Lighthouse и cross-origin renderTime. */
describe('наблюдатель LCP исполняет тот же код, который напечатан в теме', () => {
  it('берёт startTime последнего кандидата и включает buffered', () => {
    const records = [{ startTime: 20, element: 'old' }, { startTime: 80, element: 'hero' }];
    let logged: { time: number; element: string } | undefined;
    let options: unknown;
    class Observer {
      constructor(private callback: (list: { getEntries: () => typeof records }) => void) {}
      observe(value: unknown) {
        options = value;
        this.callback({ getEntries: () => records });
      }
    }
    new Function('PerformanceObserver', 'console', LCP_OBSERVER_CODE)(Observer, { log: (value: typeof logged) => { logged = value; } });
    expect(options).toEqual({ type: 'largest-contentful-paint', buffered: true });
    expect(logged?.element).toBe('hero');
    expect(logged?.time).toBe(80);
  });
});

describe('уточнения по официальной документации Chrome', () => {
  it('Lighthouse navigation и timespan не смешаны', () => {
    // Chrome INP tool support: INP записывается в timespan; обычный прогон загрузки — без ввода.
    expect(FIELD_LAB_ROWS.find((row) => row.k === 'что с INP')!.lab).toContain('timespan');
    expect(PITFALLS.find((p) => p.n === '06')!.d).toContain('timespan');
    expect(SELF_CHECK.find((q) => q.question.startsWith('**F.'))!.answer).toContain('timespan');
  });

  it('отсутствие TAO не запрещает renderTime в современном Chromium', () => {
    // Chromium metrics changelog Chrome 133: expose coarsened cross-origin renderTime regardless of TAO.
    const pitfall = PITFALLS.find((p) => p.d.includes('Chrome 133'))!;
    expect(pitfall.d).toContain('без этого заголовка');
    const answer = SELF_CHECK.find((q) => q.question.startsWith('**D.'))!.answer;
    expect(answer).toContain('с Chrome 133');
    expect(answer).not.toContain('у записи не будет `renderTime`');
  });
});
