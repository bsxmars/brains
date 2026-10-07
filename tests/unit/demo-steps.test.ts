import { describe, expect, it } from 'vitest';
import { STACK_MODES, ZALGO_CODE, ZALGO_MODES } from '@/content/lessons/callbacks/data';

/**
 * Подсветка шага в демо задаётся номером строки **отдельно** от самого листинга.
 *
 * ⚠️ Этот сторож пережил две ошибки подряд. Сначала листинг вырос (тело `each`, тело
 * `getUser`), а поля `line` остались прежними. Потом номера пересчитали — **с единицы**,
 * хотя `CodeListing` подсвечивает `lines[active]`, то есть считает с нуля. И сторож
 * повторил ту же ошибку: он читал `code[line - 1]`, проверял, что строка не пуста и не
 * комментарий, — и был зелёным, пока в демо бросок подсвечивался на `console.log(x)`.
 *
 * Отсюда две правки. Индекс здесь тот же, что у компонента: `code[line]`. И проверяется
 * не «строка не пуста» — сдвиг на одну почти всегда попадает в непустую строку, — а якорь:
 * у каждого шага `anchor` называет код, который обязан стоять в подсвеченной строке.
 */

/** `-1` у шага — намеренное «стек пуст, подсвечивать нечего». */
const ВНЕ_КОДА = -1;

interface Шаг {
  message: string;
  line: number;
  anchor?: string;
}

function проверитьШаги(code: string[], steps: Шаг[]) {
  it.each(steps.map((step, i) => [i + 1, step] as const))('шаг %i', (_номер, step) => {
    if (step.line === ВНЕ_КОДА) {
      expect(step.anchor, `шаг «${step.message}» вне кода, якорь ему не нужен`).toBeUndefined();
      return;
    }
    expect(step.anchor, `у шага «${step.message}» нет якоря — подсветку нечем проверить`).toBeTruthy();

    // Тот же индекс, что у `CodeListing`: `i === active`, счёт с нуля.
    const строка = code[step.line];
    expect(строка, `шаг «${step.message}» указывает за пределы листинга`).toBeDefined();
    expect(
      строка,
      `шаг «${step.message}» подсвечивает строку ${step.line}, а ждёт «${step.anchor}»`,
    ).toContain(step.anchor as string);
  });
}

describe('демо: подсвеченная строка — та, о которой говорит шаг', () => {
  describe.each(STACK_MODES)('стек · режим «$label»', (mode) => проверитьШаги(mode.code, mode.steps));
  describe.each(ZALGO_MODES)('Zalgo · режим «$label»', (mode) => проверитьШаги(ZALGO_CODE, mode.steps));

  /** Листинг у демо Zalgo один на оба режима: правка кода бьёт сразу по двум наборам шагов. */
  it('листинг Zalgo не пуст и общий для обоих режимов', () => {
    expect(ZALGO_CODE.length).toBeGreaterThan(10);
    expect(ZALGO_MODES).toHaveLength(2);
  });
});

/**
 * Вывод последнего шага Zalgo — это то, что делает **сама строка `ZALGO_CODE`**, а не её
 * копия. Листинг исполняется как есть; подставлены только четыре имени, которые он зовёт,
 * но не объявляет. Горячий режим — `id` есть в кеше, холодный — нет.
 */
describe('Zalgo: вывод шагов совпадает с прогоном листинга', () => {
  const прогнать = (id: number) =>
    new Promise<string[]>((resolve) => {
      const out: string[] = [];
      const cache = new Map([[1, 'Ann']]);
      const fetchUser = (_id: number, cb: (err: null, user: string) => void) =>
        void setTimeout(() => cb(null, 'from db'), 0);
      const showSpinner = () => {
        out.push('spinner shown');
        return { hide: () => void out.push('hide') };
      };
      const render = (user: string) => void out.push(`render ${user}`);

      const load = new Function(
        'cache',
        'fetchUser',
        'showSpinner',
        'render',
        `"use strict";\n${ZALGO_CODE.join('\n')}\nreturn load;`,
      )(cache, fetchUser, showSpinner, render) as (id: number) => void;

      load(id);
      setTimeout(() => resolve(out), 10);
    });

  it.each([
    ['hot', 1],
    ['cold', 2],
  ] as const)('режим %s', async (key, id) => {
    const mode = ZALGO_MODES.find((m) => m.key === key);
    if (!mode) throw new Error(`режима ${key} в ZALGO_MODES нет`);
    const последний = mode.steps.at(-1)!;
    expect(await прогнать(id)).toEqual(последний.out.map((o) => o.text));
  });
});
