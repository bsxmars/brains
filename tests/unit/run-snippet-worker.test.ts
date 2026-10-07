import { describe, expect, it } from 'vitest';

/**
 * Песочница уроков: вывод примера обязан доходить до читателя целиком.
 *
 * ⚠️ Этот сторож написан после настоящей поломки. Воркер отправлял собранные строки через
 * одну макрозадачу (`setTimeout(..., 0)`) с комментарием «микроочередь заведомо слита».
 * Для микрозадач это верно, для таймеров — нет: три примера темы «Колбэки» ждут
 * `setTimeout(..., 10)`, и читатель получал обрезанный вывод. В примере про Zalgo пропадала
 * вся «горячая» тройка строк — то самое явление, ради которого пример и написан.
 *
 * Поймать это могли только глаза: ни один тест воркер не трогал. Теперь трогает.
 *
 * ⚠️ Проверяется **логика сбора вывода**, а не `Worker` браузера: в Node его нет, а весь
 * смысл правки — в том, когда именно считать вывод полным. Логика продублирована здесь
 * один в один с телом `SOURCE` из `features/run-snippet/lib/worker.ts`; если та изменится,
 * а эта нет, разойдётся смысл — поэтому рядом стоит проверка, что исходник воркера
 * действительно считает таймеры.
 */

import { readFileSync } from 'node:fs';

/** Тот же сбор вывода, что внутри воркера: считаем живые таймеры примера. */
function прогнать(код: string): Promise<{ lines: string[]; ждали: number }> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const консоль = { log: (...a: unknown[]) => void lines.push(a.map(String).join(' ')) };

    const LIMIT = 500;
    const началось = Date.now();
    let живых = 0;
    let отправлено = false;

    const отправить = () => {
      if (отправлено) return;
      отправлено = true;
      resolve({ lines, ждали: Date.now() - началось });
    };
    const проверить = () => {
      if (живых === 0 || Date.now() - началось > LIMIT) отправить();
    };

    const наши = new Set<unknown>();
    const мойSetTimeout = (fn: unknown, delay?: number, ...args: unknown[]) => {
      if (typeof fn !== 'function') return setTimeout(fn as () => void, delay);
      живых++;
      const id = setTimeout(() => {
        наши.delete(id);
        try {
          (fn as (...a: unknown[]) => void)(...args);
        } finally {
          живых--;
          проверить();
        }
      }, delay);
      наши.add(id);
      return id;
    };
    const мойClearTimeout = (id: unknown) => {
      if (наши.delete(id)) {
        живых--;
        проверить();
      }
      return clearTimeout(id as ReturnType<typeof setTimeout>);
    };

    try {
      new Function('console', 'setTimeout', 'clearTimeout', код)(консоль, мойSetTimeout, мойClearTimeout);
    } catch (error) {
      resolve({ lines: ['ОШИБКА: ' + (error as Error).message], ждали: 0 });
      return;
    }

    setTimeout(проверить, 0);
    setTimeout(отправить, LIMIT);
  });
}

describe('песочница: вывод примера доходит целиком', () => {
  it('строки из таймера не теряются — это и была поломка', async () => {
    const { lines } = await прогнать(`
      const cache = new Map();
      function getUser(id, cb) {
        if (cache.has(id)) return cb(cache.get(id));
        setTimeout(() => { cache.set(id, id); cb(id); }, 10);
      }
      console.log('до (холодный)');
      getUser(1, () => console.log('колбэк — холодный'));
      console.log('после (холодный)');
    `);

    expect(lines, 'строка из таймера обязана дойти').toContain('колбэк — холодный');
    expect(lines).toHaveLength(3);
  });

  it('пример без таймеров отвечает сразу, а не ждёт потолка', async () => {
    const { lines, ждали } = await прогнать(`console.log('мгновенно');`);
    expect(lines).toEqual(['мгновенно']);
    expect(ждали, 'ждать тут нечего').toBeLessThan(100);
  });

  it('снятый таймер не задерживает вывод', async () => {
    const { lines, ждали } = await прогнать(`
      const id = setTimeout(() => console.log('НЕ должно напечататься'), 10);
      clearTimeout(id);
      console.log('таймер снят');
    `);

    expect(lines).toEqual(['таймер снят']);
    expect(ждали, 'снятие должно освобождать отправку сразу').toBeLessThan(100);
  });

  it('бесконечно откладывающийся таймер не держит вывод дольше потолка', async () => {
    const { lines, ждали } = await прогнать(`
      console.log('строка до');
      const тик = () => setTimeout(тик, 5);
      тик();
    `);

    expect(lines).toEqual(['строка до']);
    expect(ждали, 'страховка обязана сработать').toBeGreaterThanOrEqual(400);
    expect(ждали, 'и не дольше разумного').toBeLessThan(1500);
  });

  /**
   * Связка между этим тестом и настоящим воркером: он собирается из строки, и исполнить его
   * в Node нельзя. Поэтому проверяется хотя бы то, что приём в нём остался — иначе правка
   * воркера молча разойдётся с этим сторожем.
   */
  it('воркер действительно считает таймеры примера, а не шлёт вывод через одну макрозадачу', () => {
    const исходник = readFileSync(
      new URL('../../src/features/run-snippet/lib/worker.ts', import.meta.url),
      'utf8',
    );

    expect(исходник, 'обёртка над setTimeout').toContain('self.setTimeout =');
    expect(исходник, 'обёртка над clearTimeout').toContain('self.clearTimeout =');
    expect(исходник, 'потолок ожидания').toMatch(/LIMIT\s*=\s*\d+/);
  });
});
