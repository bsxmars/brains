import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT,
  CHECKPOINT_CODE,
  NODE_CJS,
  NODE_CODE,
  NODE_ESM,
  NODE_PHASES,
  TURN,
  TURN_CODE,
} from '@/content/lessons/event-loop/data';

/**
 * Шаги демо темы «Event Loop» против их собственных листингов.
 *
 * Та же беда, что сторожит `tests/unit/demo-steps.test.ts` в «Колбэках»: номер подсвеченной
 * строки и сам листинг живут в `data.ts` отдельно, и сдвиг кода молча уводит подсветку
 * на пустую строку или закрывающую скобку. Здесь проверка строже, потому что у демо
 * «Один оборот цикла» есть однозначное правило: **подсвечена строка, которая напечатала
 * новую строку консоли**. Его машина проверить может — и проверяет.
 *
 * ⚠️ Нумерация у `TURN` — с нуля: `CodeListing` сравнивает `line` с индексом массива.
 * В «Колбэках» она с единицы. Смешать их — значит сдвинуть подсветку на строку.
 *
 * ⚠️ Найдено при написании: строки вывода в листинге шли 1, 2, 4 … 10 — тройки не было,
 * а финальный шаг обещал «все 10 строк» при девяти. Отсюда проверки нумерации и счёта ниже.
 */

/** `-1` у шага — намеренное «подсвечивать нечего». */
const ВНЕ_КОДА = -1;

/** Строки, которые листинг печатает, — ровно в том виде, в каком они приезжают в консоль. */
const printed = (code: string) => [...code.matchAll(/console\.log\('([^']+)'\)/g)].map((m) => m[1]);

describe('«Один оборот цикла»: подсветка и консоль не разошлись с листингом', () => {
  it.each(TURN.map((step, i) => [i + 1, step.line, step.message] as const))(
    'шаг %i указывает на живую строку (%i)',
    (_номер, line, message) => {
      if (line === ВНЕ_КОДА) return;
      const строка = TURN_CODE[line];
      expect(строка, `шаг «${message}» указывает за пределы листинга`).toBeDefined();
      expect(строка?.trim(), `шаг «${message}» подсвечивает пустую строку`).not.toBe('');
      expect(строка?.trim().startsWith('//'), `шаг «${message}» подсвечивает комментарий`).toBe(false);
    },
  );

  it('на шаге, где в консоли появилась строка, подсвечена та, что её печатает', () => {
    TURN.forEach((step, i) => {
      if (step.line === ВНЕ_КОДА) return;
      const fresh = step.out.at(-1);
      const before = i > 0 ? TURN[i - 1].out.at(-1) : undefined;
      if (fresh === before) return;
      expect(
        printed(TURN_CODE[step.line]),
        `шаг ${i + 1} («${step.message}») подсвечивает строку ${step.line}, а напечатано «${fresh}»`,
      ).toEqual([fresh]);
    });
  });

  it('каждую печатающую строку листинга подсвечивает ровно один шаг', () => {
    const printing = TURN_CODE.flatMap((line, i) => (printed(line).length ? [i] : []));
    for (const lineNo of printing) {
      const hits = TURN.filter((step, i) => {
        const fresh = step.out.at(-1);
        return step.line === lineNo && fresh !== (i > 0 ? TURN[i - 1].out.at(-1) : undefined);
      });
      expect(hits, `строку ${lineNo} «${TURN_CODE[lineNo].trim()}» не печатает ни один шаг`).toHaveLength(1);
    }
  });

  it('метки вывода идут подряд с единицы — в том порядке, в каком их печатают шаги', () => {
    const seen: string[] = [];
    for (const step of TURN) {
      for (const line of step.out) if (/^\d+ /.test(line) && !seen.includes(line)) seen.push(line);
    }
    expect(seen.map((line) => Number(line.split(' ')[0]))).toEqual(seen.map((_, i) => i + 1));
    expect(seen.sort(), 'напечатано ровно то, что есть в листинге').toEqual(printed(TURN_CODE.join('\n')).sort());
  });

  it('финальный шаг называет столько строк, сколько печатает листинг', () => {
    const total = printed(TURN_CODE.join('\n')).length;
    expect(TURN.at(-1)!.out.join(' ')).toContain(`все ${total} строк`);
  });
});

describe('«Checkpoint привязан к пустому стеку»: режим «из кода» — запуском', () => {
  /**
   * Рассылка `btn.click()` синхронна, и в Node её честный аналог — `EventTarget#dispatchEvent`.
   * Исполняется **та же строка** `CHECKPOINT_CODE`, что стоит на странице над демо. Режим
   * «настоящий клик мышью» в Node не воспроизвести — рассылку ведёт цикл браузера.
   */
  it('листинг, вызванный синхронно, печатает ровно то, что обещает режим «btn.click() из кода»', async () => {
    const out: string[] = [];
    const btn = new EventTarget();
    new Function('btn', 'console', CHECKPOINT_CODE)(btn, { log: (s: string) => out.push(s) });

    btn.dispatchEvent(new Event('click'));
    await new Promise((r) => setTimeout(r, 0));

    const prog = CHECKPOINT.find((m) => m.key === 'prog')!;
    expect(out).toEqual(prog.steps.at(-1)!.out);
    expect(prog.result.startsWith(out.join(', ')), 'итог режима называет тот же порядок').toBe(true);
  });

  it('режим «настоящий клик» обещает те же четыре строки, но с чекпоинтом между слушателями', () => {
    const real = CHECKPOINT.find((m) => m.key === 'real')!;
    expect(real.steps.at(-1)!.out).toEqual(['L1', 'L1-µ', 'L2', 'L2-µ']);
    expect(printed(CHECKPOINT_CODE).sort()).toEqual([...real.steps.at(-1)!.out].sort());
  });
});

describe('«Node»: демо и запуск того же файла', () => {
  function run(kind: 'cjs' | 'mjs'): string[] {
    const head =
      kind === 'cjs'
        ? "const fs = require('node:fs');"
        : "import fs from 'node:fs'; const __filename = new URL(import.meta.url);";
    const dir = mkdtempSync(join(tmpdir(), 'lesson-event-loop-steps-'));
    const file = join(dir, `loop.${kind}`);
    writeFileSync(file, `${head}\n${NODE_CODE}\n`);
    return execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim().split('\n');
  }

  it.each([
    ['CommonJS', 'cjs', NODE_CJS],
    ['ESM', 'mjs', NODE_ESM],
  ] as const)('%s: служебные очереди и I/O-хвост — как в финале демо', (_имя, kind, steps) => {
    const promised = steps.at(-1)!.out.map((chip) => chip.text);
    const out = run(kind);

    expect(out.slice(0, 2), 'первые две строки — nextTick и промис в порядке демо').toEqual(promised.slice(0, 2));
    // Порядок `t` и `i` — настоящая гонка; сравнивается только состав.
    expect([...out].sort()).toEqual([...promised].sort());
    expect(out.slice(-2), 'внутри I/O-коллбэка гонки нет').toEqual(['io-i', 'io-t']);
  });

  it('номера фаз в шагах существуют', () => {
    for (const step of [...NODE_CJS, ...NODE_ESM]) {
      if (step.phase < 0) continue;
      expect(NODE_PHASES[step.phase], `шаг «${step.message}»`).toBeDefined();
    }
  });
});
