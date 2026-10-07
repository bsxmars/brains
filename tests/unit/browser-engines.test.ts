import { describe, expect, it } from 'vitest';
import { DETECT_CODE, ENGINE_SNAPSHOT, PITFALLS } from '@/content/render/browser-engines/data';
import { PROBES } from '@/widgets/engine-probe/model/probes';

/**
 * «Три движка»: то, что проверяется без браузера. Ответы самих движков сверяет
 * `tests/e2e/browser-engines.spec.ts` — здесь только код и согласованность данных.
 */
describe('проверка возможности — строка со страницы', () => {
  /**
   * `DETECT_CODE` исполняется как напечатан. В Node нет ни `scheduler`, ни `CSS` — значит,
   * обязан сработать запасной путь, а не упасть: ради этого проверка возможности и пишется.
   */
  it('без планировщика уступает через setTimeout, без CSS — не падает', async () => {
    const run = new Function(`${DETECT_CODE}\nreturn { yieldToMain, scrollAnimations };`) as () => {
      yieldToMain: () => Promise<unknown>;
      scrollAnimations: boolean;
    };
    const { yieldToMain, scrollAnimations } = run();
    expect(typeof (globalThis as { scheduler?: unknown }).scheduler).toBe('undefined');
    await expect(yieldToMain()).resolves.toBeUndefined();
    expect(scrollAnimations).toBe(false);
  });

  it('с планировщиком уступает через scheduler.yield', async () => {
    let called = 0;
    const scheduler = { yield: () => { called++; return Promise.resolve('из планировщика'); } };
    (globalThis as { scheduler?: unknown }).scheduler = scheduler;
    try {
      const { yieldToMain } = (new Function(`${DETECT_CODE}\nreturn { yieldToMain };`) as () => {
        yieldToMain: () => Promise<unknown>;
      })();
      await expect(yieldToMain()).resolves.toBe('из планировщика');
      expect(called).toBe(1);
    } finally {
      delete (globalThis as { scheduler?: unknown }).scheduler;
    }
  });
});

describe('снимок и демо задают одни и те же вопросы', () => {
  it('у каждого вопроса демо есть строка снимка — и наоборот', () => {
    expect(Object.keys(ENGINE_SNAPSHOT).sort()).toEqual(PROBES.map((p) => p.key).sort());
  });

  it('тонкое место про дату совпадает со снимком', () => {
    const date = PITFALLS.find((p) => p.t.includes('01.10.2026'))!;
    expect(ENGINE_SNAPSHOT['date-dots']).toEqual({ chromium: '2026-01-10', firefox: '2026-01-10', webkit: 'NaN' });
    expect(date.code).toContain('10 января');
    expect(date.code).toContain('NaN');
  });
});
