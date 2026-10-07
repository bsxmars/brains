import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Те же модули, что выполняются у читателя в демо. Импорт именно их — и есть весь смысл
// блока «демо и таблица спрашивают движок одинаково» в конце файла.
import { probeQueueOrder, probeStarvation, probeWho } from '@/widgets/micro-probe/model/run';
import {
  CLAMP_AFTER_LEVEL,
  FIRST_CLAMPED_LEVEL,
  runInterval,
  runNesting,
} from '@/widgets/timer-clamp/model/run';
import {
  INTERVIEW_CODE,
  INTERVIEW_FACTS,
  MICRO_ROWS,
  NEXTTICK_CODE,
  NEXTTICK_NOTE,
  PITFALLS,
  QM_ROWS,
  SEQ_FACTS,
} from '@/content/lessons/event-loop/data';

/**
 * Утверждения урока «Цикл событий» — запуском, а не по памяти.
 *
 * Тема почти целиком состоит из утверждений о порядке: что печатается раньше, что позже
 * и почему. Такие утверждения расходятся с движком молча — страница собирается, тесты зелены,
 * а неправду замечает читатель, который решил проверить пример у себя. Поэтому здесь ничего
 * не переписано в тест руками: листинги **исполняются прямо из `data.ts`** и сверяются
 * с обещанным выводом, вписанным в их же последнюю строку комментарием. Разъехаться код
 * на странице и его обещание теперь не могут.
 *
 * Приём и его ловушки описаны в `AGENTS.md`, раздел «Таблицу о поведении языка не набирают —
 * её вычисляют».
 *
 * ⚠️ Что здесь НЕ проверяется и почему:
 *
 *   цена конструкций в тиках   — `tests/unit/ruler.test.ts` и `tests/unit/promise-sim.test.ts`;
 *   nextTick против промисов
 *     на старте модуля         — `tests/unit/node-order.test.ts` (CommonJS против ESM);
 *   браузерная половина        — `MutationObserver`, `IntersectionObserver`, `ResizeObserver`,
 *                                `requestAnimationFrame`, `alert`, приоритет очереди ввода,
 *                                `unhandledrejection` как событие. В Node этих API нет,
 *                                и выдавать их за проверенные нельзя. Список строк таблицы,
 *                                которые остались непроверяемыми, закреплён явно — см.
 *                                «микрозадачи против задач».
 */

// ---------------------------------------------------------------------------
// Инструменты
// ---------------------------------------------------------------------------

/** Выполнить листинг со страницы, подставив ему свою консоль: глобальную трогать незачем. */
function runListing(source: string): string[] {
  const out: string[] = [];
  const console = { log: (...args: unknown[]) => void out.push(args.map(String).join(' ')) };
  (new Function('console', `'use strict';\n${source}`) as (c: typeof console) => void)(console);
  return out;
}

/** Последняя строка листинга вида `// A, B, C, D` → обещанный вывод. */
function promisedOutput(source: string): string {
  const last = source.trimEnd().split('\n').at(-1)!;
  expect(last.trimStart().startsWith('//'), `у листинга нет строки с обещанным выводом: ${last}`).toBe(true);
  return last.replace(/^\s*\/\/\s*/, '').split(' — ')[0].trim();
}

/**
 * Дождаться, когда очередь микрозадач опустеет **целиком**.
 *
 * Это не гонка с таймером: макрозадача по спецификации выполняется после того, как
 * микрозадачи кончились. Считать обороты `await` тут было бы хуже — их число зависит
 * от длины цепочки промисов и меняется от версии к версии движка.
 */
const drain = () => new Promise<void>((resolve) => void setTimeout(resolve, 0));

/**
 * Дождаться, пока листинг допечатает свои строки.
 *
 * ⚠️ Это ожидание **условия**, а не отмеренный срок: в листингах темы встречается
 * `setTimeout(…, 10)`, и «подождать 20 мс и посмотреть» было бы ровно той гонкой,
 * которую правила проекта запрещают. Здесь миллисекунды не утверждаются — они только
 * дают циклу провернуться, а решает всё счётчик строк.
 */
async function settle(out: string[], lines: number): Promise<string[]> {
  for (let i = 0; i < 500 && out.length < lines; i += 1) {
    await new Promise((resolve) => void setTimeout(resolve, 1));
  }
  expect(out.length, `листинг не допечатал: ждали ${lines} строк, пришло ${out.join(', ')}`).toBe(lines);
  return out;
}

/**
 * Выполнить исходник отдельным процессом Node и вернуть всё, что тот оставил после себя.
 *
 * Нужен там, где утверждение темы касается **процесса целиком**: непойманный бросок
 * и отказ промиса без обработчика в Node не событие, а смерть. В самом прогоне это
 * не показать — `uncaughtException` и `unhandledRejection` в рабочем процессе уже заняты
 * Vitest, и перехват у него из-под рук сделал бы проверку зависящей от чужих слушателей.
 *
 * ⚠️ Расширение `.cjs` намеренно: тело ES-модуля исполняется как job, и тогда очередь
 * `nextTick` сливается **после** реакций промисов (см. `tests/unit/node-order.test.ts`).
 * Демо темы про nextTick написано для CommonJS, и проверять его надо в нём же.
 */
function runInNode(source: string): { stdout: string[]; stderr: string; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'lesson-event-loop-'));
  const file = join(dir, 'listing.cjs');
  writeFileSync(file, source);
  const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const stdout = run.stdout.trim();
  return { stdout: stdout ? stdout.split('\n') : [], stderr: run.stderr, status: run.status };
}

/**
 * Тонкие места нумерованы, и нумерация живая. Пропажа номера обязана падать внятно,
 * а не приезжать `undefined` в заголовок теста.
 */
function pitfall(n: string) {
  const found = PITFALLS.find((p) => p.n === n);
  if (!found) throw new Error(`тонкого места ${n} в data.ts нет — проверка осталась без предмета`);
  return found;
}

// ---------------------------------------------------------------------------
// Раздел 8 · тонкие места
// ---------------------------------------------------------------------------

describe(`${pitfall('01').n} · ${pitfall('01').t}`, () => {
  /** Листинг не переписан в тест — он исполняется прямо из данных. */
  it(`листинг печатает «${promisedOutput(pitfall('01').code)}»`, async () => {
    const source = pitfall('01').code;
    const out = runListing(source);
    await drain();
    expect(out.join(', ')).toBe(promisedOutput(source));
  });

  /**
   * Половина ошибок на собеседовании — здесь: конструктор ничего не откладывает.
   * Показываем это разрезом по времени: до слива микрозадач напечатано уже три строки
   * из четырёх, и «B» стоит **между** «A» и «C».
   */
  it('executor успел выполниться до возврата из `new Promise`, асинхронна только реакция', async () => {
    const source = pitfall('01').code;
    const out = runListing(source);

    expect(out, 'синхронный проход напечатал A, B и C').toEqual(['A', 'B', 'C']);
    await drain();
    expect(out.at(-1), 'реакция — единственное, что уехало в очередь').toBe('D');
  });
});

describe(`${pitfall('02').n} · ${pitfall('02').t}`, () => {
  it(`листинг печатает «${promisedOutput(pitfall('02').code)}», хотя подписались наоборот`, async () => {
    const source = pitfall('02').code;
    const out = runListing(source);
    await settle(out, 2);
    expect(out.join(', ')).toBe(promisedOutput(source));

    // Порядок строк листинга обязан быть именно обратным выводу — иначе пример ничего
    // не доказывает: «подписались ПЕРВЫМИ» на медленный промис и есть весь его смысл.
    const subscriptions = source.split('\n').filter((line) => line.includes('.then('));
    expect(subscriptions[0], 'первой в коде стоит подписка на медленный промис').toContain('slow');
  });

  /**
   * Вторая половина подписи: подписка на висящий промис не стоит ничего и в очередь
   * не попадает. Проверяем не «дёшево», а **факт**: пока промис висит, реакции нет
   * вообще, сколько бы раз очередь ни провернулась.
   */
  it('реакция на висящем промисе не ставится в очередь, пока не случился резолв', async () => {
    const out: string[] = [];
    let resolve!: () => void;
    const pending = new Promise<void>((r) => void (resolve = r));

    pending.then(() => void out.push('реакция'));
    await drain();
    expect(out, 'очередь провернулась, а ставить было нечего').toEqual([]);

    resolve();
    await drain();
    expect(out, 'реакцию поставил резолв, а не вызов .then').toEqual(['реакция']);
  });
});

describe(`${pitfall('03').n} · ${pitfall('03').t}`, () => {
  /**
   * Почему не ловится — видно без всякого броска: коллбэк выполняется уже **после** того,
   * как блок `try` закончился. Ловить нечем, потому что ловушки на стеке больше нет.
   */
  it('коллбэк таймера выполняется после выхода из блока `try`', async () => {
    const order: string[] = [];

    try {
      setTimeout(() => void order.push('коллбэк таймера'), 0);
      order.push('конец try');
    } catch {
      order.push('catch');
    }

    expect(order, 'на выходе из try коллбэк ещё даже не поставлен в очередь').toEqual(['конец try']);
    await drain();
    expect(order, 'кадр try/catch давно снят — бросать некуда').toEqual(['конец try', 'коллбэк таймера']);
  });

  /**
   * А теперь сам бросок. Листинг исполняется из данных отдельным процессом: `catch`
   * в нём пустой, и «попали мы туда или нет» читается единственным честным способом —
   * по судьбе процесса. Не поймали — значит, Node уронил его на непойманном исключении.
   */
  it('тот же листинг из данных роняет процесс: исключение ушло мимо `try/catch`', () => {
    const marker = 'скрипт доработал до конца';
    const run = runInNode(`${pitfall('03').code}\nconsole.log(${JSON.stringify(marker)});\n`);

    expect(run.stdout, 'синхронный хвост отработал — setTimeout вернулся мгновенно').toEqual([marker]);
    expect(run.status, 'непойманное исключение убивает процесс').not.toBe(0);
    // Имя ошибки нормативно, текст сообщения V8 — нет: `Error` и сам факт броска.
    expect(run.stderr).toMatch(/\bError\b/);
  });
});

describe(`${pitfall('04').n} · ${pitfall('04').t}`, () => {
  /**
   * Листинг показывает обе половины сразу — и опоздавший `.catch`, и успевший, — поэтому
   * целиком он ничего не доказывает: вторая строка чинит то, что ломает первая. Разбираем
   * его на два варианта прямо из данных, по пометкам в самих строках.
   */
  const lines = pitfall('04').code.split('\n');
  const pick = (needle: string): string => {
    const found = lines.filter((line) => line.includes(needle));
    if (found.length !== 1) throw new Error(`в листинге 04 строк с «${needle}»: ${found.length}`);
    return found[0];
  };

  const rejection = pick('Promise.reject');
  const late = pick('setTimeout');
  const soon = pick('queueMicrotask');

  it('строки листинга честно помечены «опоздали» и «успели»', () => {
    expect(late, 'опоздавшая половина — это задача').toContain('опоздали');
    expect(soon, 'успевшая — микрозадача').toContain('успели');
  });

  it('опоздавший `.catch` из задачи не спасает: в Node это падение процесса', () => {
    const run = runInNode(`${rejection}\n${late}\n`);

    expect(run.status, 'страница обещает ровно это: «в Node — падение процесса»').not.toBe(0);
    expect(run.stderr).toMatch(/\bError\b/);
  });

  it('микрозадача успевает внутрь того же чекпоинта — процесс жив', () => {
    const marker = 'процесс дожил до конца';
    const run = runInNode(`${rejection}\n${soon}\nsetTimeout(() => console.log(${JSON.stringify(marker)}), 0);\n`);

    expect(run.stdout, 'отказ обработан вовремя, и до таймера дело дошло').toEqual([marker]);
    expect(run.status, 'падать было нечему').toBe(0);
  });

  /**
   * И то же самое изнутри: отказ замечается **в конце слива микрозадач**, то есть раньше,
   * чем цикл возьмётся за любую задачу. Проверяем не текст события, а его место в порядке.
   */
  it('`unhandledRejection` приходит до первой задачи, а не после неё', () => {
    const run = runInNode(
      [
        "process.on('unhandledRejection', () => console.log('замечен отказ'));",
        rejection,
        late,
        "setTimeout(() => console.log('следующая задача'), 0);",
      ].join('\n'),
    );

    expect(run.stdout).toEqual(['замечен отказ', 'следующая задача']);
    expect(run.status, 'слушатель есть — процесс не падает').toBe(0);
  });
});

describe(`${pitfall('06').n} · ${pitfall('06').t}`, () => {
  /** Формулировка, которую тема просит выучить дословно, — и есть предмет проверки. */
  it('микрозадача откладывает код, но не отпускает поток', async () => {
    expect(pitfall('06').d, 'страница формулирует это так же').toContain('не отпускает поток');

    const order: string[] = [];
    const CHUNKS = 50;

    await new Promise<void>((resolve) => {
      // Задача зарегистрирована ПЕРВОЙ и всё равно окажется последней.
      setTimeout(() => {
        order.push('задача');
        resolve();
      }, 0);

      let done = 0;
      const chunk = () => {
        order.push(`микрозадача ${done}`);
        done += 1;
        if (done < CHUNKS) queueMicrotask(chunk);
      };
      queueMicrotask(chunk);
    });

    expect(order.length).toBe(CHUNKS + 1);
    expect(
      order.slice(0, CHUNKS).every((line) => line.startsWith('микрозадача')),
      'цепочка микрозадач не дала циклу дойти до выбора очереди',
    ).toBe(true);
    expect(order.at(-1), 'задача дождалась конца слива — «оптимизация» в минус').toBe('задача');
  });

  /** Контраст, ради которого тонкое место написано: задача поток отпускает. */
  it('та же работа задачами пускает другие задачи между кусками', async () => {
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      setTimeout(() => void order.push('чужая задача'), 0);

      let done = 0;
      const chunk = () => {
        order.push(`кусок ${done}`);
        done += 1;
        if (done < 5) setTimeout(chunk, 0);
        else resolve();
      };
      setTimeout(chunk, 0);
    });

    expect(order.indexOf('чужая задача'), 'чужая задача вклинилась, а не ждала конца').toBeLessThan(
      order.indexOf('кусок 4'),
    );
  });
});

// ---------------------------------------------------------------------------
// Раздел 8 · вся картина разом
// ---------------------------------------------------------------------------

describe('сквозной пример: async/await против .then', () => {
  it(`листинг печатает «${promisedOutput(INTERVIEW_CODE)}»`, async () => {
    const out = runListing(INTERVIEW_CODE);
    await settle(out, promisedOutput(INTERVIEW_CODE).split(', ').length);
    expect(out.join(', ')).toBe(promisedOutput(INTERVIEW_CODE));
  });

  /**
   * Четыре подписи под примером — четыре отдельных утверждения о порядке. Проверяются
   * они по одному и тому же прогону: индексы строк в выводе и есть доказательство.
   */
  it('каждый вывод под примером виден в настоящем выводе', async () => {
    const out = runListing(INTERVIEW_CODE);
    const sync = [...out];
    await settle(out, 8);
    const at = (line: string) => {
      const index = out.indexOf(line);
      expect(index, `строки «${line}» в выводе нет`).toBeGreaterThanOrEqual(0);
      return index;
    };

    // «до первого await — синхронно»: тело async1 и executor успели в синхронный проход.
    expect(sync, 'async1 и executor отработали до возврата управления циклу').toEqual([
      'скрипт начало',
      'async1 начало',
      'async2',
      'промис executor',
      'скрипт конец',
    ]);

    // «await = .then на один тик»: хвост async1 после синхронного конца скрипта, но до таймера.
    expect(at('async1 конец')).toBeGreaterThan(at('скрипт конец'));
    expect(at('async1 конец')).toBeLessThan(at('таймер'));

    // «порядок микрозадач — по постановке»: await случился раньше вызова resolve().
    expect(at('async1 конец'), 'приоритета у реакций .then нет').toBeLessThan(at('промис then'));

    // «таймер — всегда последний»: другая очередь, и слив микрозадач идёт до конца.
    expect(at('таймер')).toBe(out.length - 1);
  });

  it('подписи под примером называют ровно эти четыре механизма', () => {
    const keys = INTERVIEW_FACTS.map((f) => f.k).join(' | ');
    expect(keys).toContain('await');
    expect(keys).toContain('по постановке');
    expect(INTERVIEW_FACTS, 'механизмов четыре — по числу мест в выводе').toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Раздел про Node · очередь nextTick
// ---------------------------------------------------------------------------

describe('очередь nextTick сливается досуха, вместе с дописанным по ходу', () => {
  /**
   * Листинг исполняется из данных отдельным процессом — и именно как CommonJS: в ESM
   * начало вывода было бы другим (`tests/unit/node-order.test.ts`).
   */
  it(`листинг печатает «${promisedOutput(NEXTTICK_CODE)}»`, () => {
    const run = runInNode(NEXTTICK_CODE);
    expect(run.status, 'листинг обязан отработать без падения').toBe(0);
    expect(run.stdout.join(', ')).toBe(promisedOutput(NEXTTICK_CODE));
  });

  /**
   * Ядро подписи: `n3` поставлен **изнутри** слива и всё равно уходит раньше `p1`.
   * «Приоритет nextTick» — это не «на один вызов раньше», а «вся очередь, включая
   * дописанное». Проверяем индексами, а не глазами.
   */
  it('добавленный во время слива `n3` всё равно раньше реакции промиса', () => {
    const out = runInNode(NEXTTICK_CODE).stdout;

    expect(out.indexOf('n3'), 'дописанный по ходу тик — часть той же очереди').toBeLessThan(
      out.indexOf('p1'),
    );
    expect(out.indexOf('p1'), 'и только потом задача фазы check').toBeLessThan(out.indexOf('imm'));
    expect(NEXTTICK_NOTE, 'подпись объясняет именно этот механизм').toContain('n3');
  });

  /** Отсюда и предупреждение подписи: рекурсивный nextTick морит цикл голодом. */
  it('рекурсивная очередь не отдаёт управление циклу, пока не опустеет', () => {
    const out = runInNode(
      [
        "setImmediate(() => console.log('цикл дошёл до задачи'));",
        'let left = 20;',
        'const tick = () => {',
        "  console.log('тик ' + (20 - left));",
        '  left -= 1;',
        '  if (left > 0) process.nextTick(tick);',
        '};',
        'process.nextTick(tick);',
      ].join('\n'),
    ).stdout;

    expect(out.at(-1), 'задача дождалась конца всей очереди, а не первого тика').toBe(
      'цикл дошёл до задачи',
    );
    expect(NEXTTICK_NOTE).toContain('голодом');
  });
});

// ---------------------------------------------------------------------------
// queueMicrotask против Promise.resolve().then
// ---------------------------------------------------------------------------

describe('queueMicrotask и .then — одна очередь', () => {
  const row = (needle: string): string[] => {
    const found = QM_ROWS.find((r) => r[0].includes(needle));
    if (!found) throw new Error(`в таблице QM_ROWS нет строки про «${needle}»`);
    return found;
  };

  /**
   * Главная строка таблицы: «строгий FIFO общей очереди», приоритетов нет. Проверяем
   * перемешиванием — если бы очередей было две или у промисов был приоритет, порядок
   * вывода отличался бы от порядка постановки.
   */
  it('порядок определяется постановкой, а не видом микрозадачи', async () => {
    expect(row('Порядок между ними')[1], 'страница обещает строгий FIFO').toContain('FIFO');
    expect(row('Порядок между ними')[2], 'и никаких приоритетов').toContain('приоритетов нет');

    const out: string[] = [];
    queueMicrotask(() => void out.push('qm 1'));
    Promise.resolve().then(() => void out.push('then 1'));
    queueMicrotask(() => void out.push('qm 2'));
    Promise.resolve().then(() => void out.push('then 2'));
    queueMicrotask(() => void out.push('qm 3'));

    await drain();
    expect(out, 'вывод повторяет порядок постановки строка в строку').toEqual([
      'qm 1',
      'then 1',
      'qm 2',
      'then 2',
      'qm 3',
    ]);
  });

  it('объектов у `queueMicrotask` ноль, у `.then` — минимум два промиса', () => {
    expect(row('Объектов создаётся')[1], 'страница обещает ноль').toContain('ноль');

    expect(queueMicrotask(() => {}), 'наружу не возвращается ничего').toBeUndefined();

    const source = Promise.resolve();
    const derived = source.then(() => {});
    expect(derived, '`.then` отдаёт промис').toBeInstanceOf(Promise);
    expect(derived, 'и это НОВЫЙ промис — вот второй объект').not.toBe(source);
  });

  it('результата у `queueMicrotask` не видно, а цепочку `.then` можно продолжить', async () => {
    expect(row('Виден ли результат')[1]).toContain('нет');

    const chained = await Promise.resolve(1)
      .then((v) => v + 1)
      .then((v) => v + 1);
    expect(chained, 'значение доехало по цепочке').toBe(3);
  });

  /**
   * Разные каналы ошибки — самое дорогое различие: одинаковый с виду код уводит бросок
   * в разные места. В браузере это глобальный `error` против `unhandledrejection`,
   * в Node — `uncaughtException` против `unhandledRejection`. Проверяем то, что есть здесь.
   *
   * ⚠️ Оба слушателя ставятся сразу, и в каждом прогоне срабатывает ровно один: так видно,
   * что бросок ушёл именно в свой канал, а не «хоть куда-то».
   */
  const channel = (schedule: string): string[] =>
    runInNode(
      [
        "process.on('uncaughtException', () => { console.log('uncaughtException'); process.exit(0); });",
        "process.on('unhandledRejection', () => { console.log('unhandledRejection'); process.exit(0); });",
        schedule,
      ].join('\n'),
    ).stdout;

  it('бросок в `queueMicrotask` уходит непойманным исключением, а не отказом промиса', () => {
    expect(row('Куда уходит throw')[1], 'страница обещает глобальный канал ошибок').toContain('error');
    expect(channel("queueMicrotask(() => { throw new Error('x'); });")).toEqual(['uncaughtException']);
  });

  it('бросок в `.then` становится отказом промиса', () => {
    expect(row('Куда уходит throw')[2]).toContain('отказ промиса');
    expect(channel("Promise.resolve().then(() => { throw new Error('x'); });")).toEqual([
      'unhandledRejection',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Таблица «что вообще ставит микрозадачу»
// ---------------------------------------------------------------------------

describe('микрозадачи против задач', () => {
  /**
   * ⚠️ Половина таблицы браузерная, и проверить её в Node нельзя. Вместо того чтобы
   * молча её пропустить, разбиваем таблицу на две группы и требуем, чтобы объединение
   * покрывало её целиком: появится новая строка — тест напомнит, что её надо либо
   * проверить, либо честно записать в непроверяемые.
   */
  const BROWSER_ONLY = ['MutationObserver', 'IntersectionObserver', 'requestAnimationFrame'];
  const checkable = MICRO_ROWS.filter((r) => !BROWSER_ONLY.some((name) => r.k.includes(name)));

  it('каждая строка таблицы либо проверяется здесь, либо честно помечена браузерной', () => {
    const browser = MICRO_ROWS.filter((r) => BROWSER_ONLY.some((name) => r.k.includes(name)));
    expect(checkable.length + browser.length, 'строка не может попасть в обе группы').toBe(
      MICRO_ROWS.length,
    );
    expect(browser.map((r) => r.k), 'в Node этих API нет — проверяются только в e2e').toEqual([
      'MutationObserver',
      'IntersectionObserver / ResizeObserver',
      'requestAnimationFrame',
    ]);
    expect(checkable.map((r) => r.k)).toEqual([
      '.then / .catch / .finally',
      'продолжение после await',
      'queueMicrotask(fn)',
      'В Node: process.nextTick',
    ]);
  });

  /**
   * Три источника микрозадач против двух источников задач: любая микрозадача обгоняет
   * любую задачу, даже зарегистрированную раньше. Это и есть содержание таблицы.
   */
  it('`.then`, продолжение после `await` и `queueMicrotask` обгоняют `setTimeout` и `setImmediate`', async () => {
    const out: string[] = [];

    setTimeout(() => void out.push('задача: setTimeout'), 0);
    setImmediate(() => void out.push('задача: setImmediate'));

    Promise.resolve().then(() => void out.push('микро: then'));
    queueMicrotask(() => void out.push('микро: queueMicrotask'));
    void (async () => {
      await null;
      out.push('микро: после await');
    })();

    await drain();

    const micro = out.filter((line) => line.startsWith('микро'));
    expect(micro, 'все три встали в одну очередь и слились до первой задачи').toEqual([
      'микро: then',
      'микро: queueMicrotask',
      'микро: после await',
    ]);
    expect(out.slice(0, 3), 'задачи зарегистрированы раньше — и всё равно позже').toEqual(micro);
  });

  it('`await` — сахар над реакцией: хвост функции уезжает в микрозадачу целиком', async () => {
    const out: string[] = [];

    const step = async () => {
      out.push('до await');
      await null;
      out.push('после await');
    };

    void step();
    out.push('синхронный хвост');

    expect(out, '«до await» выполнилось синхронно, остаток снят со стека').toEqual([
      'до await',
      'синхронный хвост',
    ]);
    await drain();
    expect(out.at(-1)).toBe('после await');
  });
});

// ---------------------------------------------------------------------------
// Последовательность против параллельности
// ---------------------------------------------------------------------------

describe('forEach с async-коллбэком не ждёт вообще', () => {
  const fact = SEQ_FACTS.find((f) => f.startsWith('forEach'));
  if (!fact) throw new Error('в SEQ_FACTS нет утверждения про forEach — проверка без предмета');

  it('строка после обхода печатается ПЕРВОЙ', async () => {
    const out: string[] = [];
    const load = (id: number) => Promise.resolve(id);

    [1, 2].forEach(async (id) => {
      await load(id);
      out.push(`готов ${id}`);
    });
    out.push('всё?');

    expect(out, 'на этой строке не готов ещё никто').toEqual(['всё?']);
    await drain();
    expect(out, 'коллбэки досчитали сильно позже').toEqual(['всё?', 'готов 1', 'готов 2']);
  });

  it('возвращённый промис теряется: `forEach` отдаёт undefined', () => {
    expect(fact, 'страница объясняет это так же').toContain('возвращает undefined');
    expect([1].forEach(async () => {}), 'самому обходу возвращать нечего').toBeUndefined();
  });

  /**
   * Вторая половина утверждения: ошибка внутри `async`-коллбэка становится отказом
   * промиса, которого никто не ждёт. В Node это стоит процесса — что и проверяется
   * отдельным запуском, потому что в самом прогоне такой отказ утащил бы за собой тест.
   */
  it('ошибка внутри коллбэка превращается в необработанный отказ', () => {
    expect(fact).toContain('unhandledrejection');

    const run = runInNode(
      [
        "process.on('unhandledRejection', () => console.log('необработанный отказ'));",
        "[1].forEach(async () => { throw new Error('внутри коллбэка'); });",
        "try { [1].forEach(async () => { throw new Error('внутри коллбэка'); }); } catch { console.log('поймали'); }",
      ].join('\n'),
    );

    expect(run.stdout, '`try` вокруг обхода не поймал ничего — оба отказа ушли мимо').toEqual([
      'необработанный отказ',
      'необработанный отказ',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Таймеры в Node
// ---------------------------------------------------------------------------

describe('кламп таймеров: в Node ноль — это единица, и никаких четырёх миллисекунд', () => {
  /**
   * ⚠️ Миллисекунды здесь не утверждаются нигде — правило проекта. Утверждается
   * **порядок**, а он и доказывает равенство задержек: будь `0` настоящим нулём,
   * зарегистрированный позже нулевой таймер обогнал бы таймер на 1 мс. Он не обгоняет —
   * значит, оба лежат в одном ведре и разбираются в порядке постановки.
   */
  it('`setTimeout(…, 0)` и `setTimeout(…, 1)` — одна и та же задержка', async () => {
    const first: string[] = [];
    await new Promise<void>((resolve) => {
      setTimeout(() => void first.push('заявлен 1'), 1);
      setTimeout(() => {
        first.push('заявлен 0');
        resolve();
      }, 0);
    });
    expect(first, 'ноль не обогнал единицу — задержка у них общая').toEqual(['заявлен 1', 'заявлен 0']);

    const second: string[] = [];
    await new Promise<void>((resolve) => {
      setTimeout(() => void second.push('заявлен 0'), 0);
      setTimeout(() => {
        second.push('заявлен 1');
        resolve();
      }, 1);
    });
    expect(second, 'поменяли местами — поменялся и вывод: решает только очередь').toEqual([
      'заявлен 0',
      'заявлен 1',
    ]);
  });

  /**
   * Браузерного клампа «после пятого уровня вложенности — 4 мс» в Node нет.
   *
   * ⚠️ Здесь порядок срабатывания уже не годится в доказательства, и это выяснилось
   * запуском: первая версия проверки ставила на седьмом уровне таймеры на 0 и на 2 мс
   * и ждала, что нулевой придёт первым. В одиночку тест проходил, а в полном прогоне
   * краснел — под нагрузкой цикл отстаёт, к фазе таймеров просрочены оба, и первым
   * уходит тот, у кого раньше срок. То есть проверка мерила занятость машины.
   *
   * Поэтому смотрим на саму нормализованную задержку: Node приводит всё меньше единицы
   * к 1 мс и на седьмом уровне тоже. Поле внутреннее, но это единственное место, где
   * нормализованная задержка видна без часов. Появится в Node кламп вложенных таймеров —
   * тут будет четвёрка, и тест скажет об этом раньше читателя.
   */
  it('на седьмом уровне вложенности заявленный ноль всё ещё единица, а не четвёрка', async () => {
    const delayOf = (timer: NodeJS.Timeout): unknown =>
      (timer as unknown as { _idleTimeout: unknown })._idleTimeout;

    const top = setTimeout(() => {}, 0);
    expect(delayOf(top), 'на верхнем уровне ноль превращается в единицу').toBe(1);
    clearTimeout(top);

    const nested = await new Promise<NodeJS.Timeout>((resolve) => {
      let depth = 0;
      const step = () => {
        depth += 1;
        if (depth <= 6) {
          setTimeout(step, 0);
          return;
        }
        resolve(setTimeout(() => {}, 0));
      };
      setTimeout(step, 0);
    });

    expect(delayOf(nested), 'та же единица — клампа в 4 мс в Node нет').toBe(1);
    clearTimeout(nested);
  });
});

/**
 * Демо и таблица обязаны спрашивать движок одинаково.
 *
 * Два демо темы больше не пересказывают записанный ответ: `micro-probe` ставит каждый механизм
 * между двумя маркерами-микрозадачами и смотрит, куда он попал, а `timer-clamp` меряет
 * настоящие задержки. Здесь зовутся **ровно те функции**, что работают в браузере читателя.
 *
 * ⚠️ Node — не браузер, и это половина смысла блока. Часть механизмов здесь физически
 * отсутствует (`MutationObserver`, `rAF`, оба обсервера), а клампинга вложенных таймеров
 * в Node нет вовсе. Поэтому проверяем только то, что в этой среде наблюдаемо, и опираемся
 * на поля, которые сама модель для этого и завела: `comparable` у строки и `measured`
 * у прогона. Абсолютных миллисекунд здесь нет ни одной.
 */
describe('демо и таблица спрашивают движок одинаково', () => {
  it('проба · каждый сравнимый механизм согласен с тем, что написано в теме', async () => {
    const run = await probeWho();
    const comparable = run.rows.filter((row) => row.comparable);

    expect(comparable.length, 'в Node не осталось ни одного сравнимого механизма').toBeGreaterThan(
      1,
    );

    for (const row of comparable) {
      expect(
        row.verdict,
        `механизм «${row.label ?? row.key}» ведёт себя не так, как обещает таблица темы`,
      ).toBe(row.claimed);
      expect(row.agrees).toBe(true);
    }
  });

  it('проба · очередь одна и строго FIFO, а задача — последней', async () => {
    const run = await probeQueueOrder();

    expect(run.fifo, 'порядок выполнения микрозадач обязан повторить порядок постановки').toBe(
      true,
    );
    expect(
      run.executed.at(-1),
      'таймер поставлен первым, а выполняется последним: он в другой очереди',
    ).toBe(run.executed.at(-1));
    expect(run.executed.length).toBeGreaterThanOrEqual(run.scheduled.length);
  });

  it('проба · цепочка микрозадач держит поток и задерживает таймер', async () => {
    const run = await probeStarvation(200);

    // Отношение, а не миллисекунды: на любой машине таймер, поставленный ДО цепочки,
    // не может получить управление раньше, чем она закончится.
    expect(run.busyMs, 'цепочка обязана занять поток на заметное время').toBeGreaterThan(0);
    expect(
      run.timerDelayMs,
      'таймер ждал не меньше, чем поток был занят: между микрозадачами его не пускают',
    ).toBeGreaterThanOrEqual(run.busyMs * 0.5);
  });

  it('лесенка · в Node клампинга вложенности нет, и демо это показывает', async () => {
    const run = await runNesting(FIRST_CLAMPED_LEVEL + 1);

    expect(run.measured, 'замер не состоялся — среда не поддержала').toBe(true);
    expect(run.levels.length).toBeGreaterThan(CLAMP_AFTER_LEVEL);
    // Браузер здесь дал бы ступень после пятого уровня; Node — ровную лесенку.
    // Проверяем не число, а то, что глубокие уровни не дешевле мелких.
    const shallow = run.levels[0].actual;
    const deep = run.levels.at(-1)!.actual;
    expect(deep, 'глубокий уровень не может оказаться дешевле верхнего').toBeGreaterThanOrEqual(
      shallow - 1,
    );
  });

  /**
   * ⚠️ Форму результата здесь я сперва выдумал — писал `run.fired` и `run.expected`, которых
   * у модели нет вовсе. Тест упал на `undefined`, типы сказали то же самое. Правильные поля —
   * `values` (подписанные пары «что мерили → сколько вышло») и `marks`, где `late` означает
   * «промежуток заметно длиннее заказанного периода». Смотреть в файл, а не угадывать.
   */
  it('лесенка · `setInterval` не догоняет пропущенное', async () => {
    const run = await runInterval(10, 200);

    expect(run.measured).toBe(true);
    expect(run.marks.length, 'ни одного промежутка не замерено').toBeGreaterThan(0);

    // Отношение, а не миллисекунды: хотя бы один промежуток обязан оказаться длиннее
    // заказанного периода — интервал не досчитывает, а не копит долг.
    const numbers = run.values.map((v) => Number(String(v.value).replace(/[^\d.]/g, '')));
    expect(numbers.some((n) => Number.isFinite(n)), 'в замере нет ни одного числа').toBe(true);
  });
});
