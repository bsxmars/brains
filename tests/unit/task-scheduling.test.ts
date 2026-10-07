import { readFile } from 'node:fs';
import { setTimeout as delay, scheduler as nodeScheduler } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import {
  ABORT_FACTS,
  BUDGET_MS,
  CHANNEL_CODE,
  CHUNKER_ABORT_CODE,
  CHUNKER_CODE,
  INP_PARTS,
  PER_ITEM,
  PITFALLS,
  POST_TASK_CODE,
  POST_TASK_FACTS,
  TIMELINE_CLICKS,
  TIMELINE_MODES,
  TIMELINE_WORK,
  TOOL_ROWS,
  UNSLICEABLE,
  YIELD_HELPER_CODE,
  YIELD_SIZES,
  YIELD_TOOLS,
} from '@/content/lessons/task-scheduling/data';
// Кламп — константа соседней темы, и число 4 в этих данных обязано быть тем же самым.
// Сам кламп (и его отсутствие в Node) закреплён в `tests/unit/event-loop.test.ts`;
// здесь берутся только константы, чтобы две темы не разъехались в числе молча.
import { CLAMP_AFTER_LEVEL, CLAMP_MS } from '@/widgets/timer-clamp/model/run';
// Прибор, которым демо темы меряет цену уступки. Тест зовёт ровно его: держи он свою копию
// цикла замера, «проверено тестом» означало бы «проверено чем-то похожим» (AGENTS.md,
// «демо и таблица спрашивают движок одинаково»).
import { TOOLS, measureTool, measureYields, supports } from '@/widgets/yield-meter/model/run';

/**
 * Утверждения урока «Планирование задач» — запуском, а не по памяти.
 *
 * Тема целиком состоит из заявлений о поведении планировщика: что синхронный фрагмент
 * выполняется одной задачей, что микрозадачей уступить нельзя, что голый `scheduler.yield?.()`
 * бросает ReferenceError, что `abort()` не прерывает начатый кусок. До этого файла ни одно
 * из них не проверялось ничем, кроме разовой ручной сверки автора.
 *
 * ⚠️ **Здесь закрепляются отношения и порядок, а не миллисекунды.** Абсолютные числа темы
 * (~250 итераций, 0.2 мс на элемент) объявлены в ней модельными или взятыми из спеки; тест
 * сверяет их согласованность между собой и с константами соседней темы, а из замеров берёт
 * только то, что не зависит от железа: «на порядки меньше».
 *
 * ⚠️ **Цены уступки из `YIELD_TOOLS` намеренно не закреплены ни одной проверкой** — ни дословно,
 * ни с допуском. Живой замер (`widgets/yield-meter`) показал, что модельные 0.12 и 0.06 мс
 * завышены примерно в сорок раз, и судьбу этих чисел решает автор темы. Закреплено то, что
 * замер воспроизводит уверенно, — **порядок** инструментов и кратность между ними.
 *
 * ⚠️ **Node — не браузер, и половина API темы здесь физически отсутствует.** `scheduler.postTask`,
 * `TaskController`, `navigator.scheduling`, rAF, rIC, freeze/bfcache не проверяются ничем:
 * подделывать их заглушкой нельзя — заглушка проверяла бы саму себя. Что именно отсутствует,
 * закреплено явно в блоке «в Node планировщика нет» — чтобы «не проверено» не превратилось
 * со временем в «забыто».
 *
 * ⚠️ **Клампинг вложенных таймеров закрыт не здесь.** Его меряет `timer-clamp` и проверяет
 * `tests/unit/event-loop.test.ts`; в этом файле закреплено следствие клампа — пропускная
 * способность цепочки, — и закреплено отношением.
 */

// ---------------------------------------------------------------------------
// Инструменты
// ---------------------------------------------------------------------------

/**
 * Собрать функцию из листинга темы. Тело берётся из `data.ts` как есть: тест исполняет
 * ровно тот код, который читатель видит на странице. Приём из `tests/unit/callbacks.test.ts`.
 */
function fromListing<T>(source: string, exported: string): T {
  const factory = new Function(`'use strict';\n${source}\nreturn ${exported};`) as () => T;
  return factory();
}

/** Занять поток на заданное время. Именно занять: в этой теме это предмет разговора. */
function burn(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* поток занят намеренно — это и есть моделируемая работа */
  }
}

/** Тонкое место по номеру. Разъехаться с данными проверки не должны. */
function pitfall(n: string): (typeof PITFALLS)[number] {
  const found = PITFALLS.find((item) => item.n === n);
  expect(found, `тонкого места ${n} в данных больше нет — проверка потеряла предмет`).toBeDefined();
  return found!;
}

/** Инструмент шпаргалки по ключу. */
function tool(key: string): (typeof YIELD_TOOLS)[number] {
  const found = YIELD_TOOLS.find((item) => item.key === key);
  expect(found, `инструмента «${key}» в данных нет`).toBeDefined();
  return found!;
}

// ---------------------------------------------------------------------------
// Раздел 1 · фрагмент выполняется одной задачей
// ---------------------------------------------------------------------------

describe('run-to-completion · весь синхронный фрагмент — одна задача', () => {
  /**
   * Первое утверждение темы: «уступить» механически значит «завершить текущую задачу
   * и запланировать продолжение отдельной задачей». Пока задача не кончилась, ничего
   * запланированного не выполняется — ни микрозадача, ни таймер.
   */
  it('синхронные строки печатаются целиком раньше всего запланированного', async () => {
    const out: string[] = [];

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        out.push('задача');
        resolve();
      }, 0);
      queueMicrotask(() => out.push('микрозадача'));
      Promise.resolve().then(() => out.push('промис'));

      out.push('синхронно 1');
      out.push('синхронно 2');
    });

    expect(out, 'запланированное не может вклиниться между двумя синхронными строками').toEqual([
      'синхронно 1',
      'синхронно 2',
      'микрозадача',
      'промис',
      'задача',
    ]);
  });

  it('дозревший таймер ждёт конца текущей задачи, а не прерывает её', async () => {
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);

    // Таймер просрочен многократно — и всё равно не выполнен: задача не прерывается.
    burn(30);
    expect(fired, 'нулевой таймер не имеет права вклиниться в выполняющуюся задачу').toBe(false);

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    expect(fired, 'а после конца задачи он, конечно, срабатывает').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · FIFO внутри источника и границы гарантий
// ---------------------------------------------------------------------------

describe('порядок · что гарантировано и что тема намеренно не обещает', () => {
  it('очередь одного источника строго FIFO: четыре setTimeout(0) приходят как поставлены', async () => {
    const order: number[] = [];

    await new Promise<void>((resolve) => {
      setTimeout(() => order.push(1), 0);
      setTimeout(() => order.push(2), 0);
      setTimeout(() => order.push(3), 0);
      setTimeout(() => {
        order.push(4);
        resolve();
      }, 0);
    });

    expect(order, 'одинаковая задержка — решает только порядок постановки').toEqual([1, 2, 3, 4]);
  });

  it('микрозадачи — та же FIFO, и весь чекпоинт раньше любой задачи', async () => {
    const order: string[] = [];

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        order.push('задача');
        resolve();
      }, 0);
      Promise.resolve().then(() => order.push('промис 1'));
      queueMicrotask(() => order.push('микрозадача'));
      Promise.resolve().then(() => order.push('промис 2'));
    });

    expect(order, 'граница «микрозадачи → задача» гарантирована, порядок внутри — FIFO').toEqual([
      'промис 1',
      'микрозадача',
      'промис 2',
      'задача',
    ]);
  });

  /**
   * ⚠️ А вот межисточникового порядка тема не обещает — и тест его не закрепляет НАМЕРЕННО.
   *
   * Соблазн написать «`setTimeout` против `postTask`» велик, и такой тест даже прошёл бы
   * на одной машине. Но спека такого порядка не даёт (тонкое место 06), и закреплённое
   * совпадение стало бы ловушкой для следующего автора: он бы решил, что курс это гарантирует.
   * Здесь проверяется ровно то, что у темы написано словами.
   */
  it('отсутствие межисточниковой гарантии записано в теме прямым текстом', () => {
    const cross = pitfall('06');
    expect(cross.d).toContain('межисточникового');
    expect(cross.d, 'и названо то, что из этого следует для background').toContain('setTimeout');
    expect(cross.tone).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · микрозадачи выгребаются до пуста
// ---------------------------------------------------------------------------

describe('микрозадачи · очередь осушается целиком в одном чекпоинте', () => {
  it('микрозадачи, добавленные изнутри микрозадач, попадают в тот же чекпоинт', async () => {
    const DEPTH = 500;
    let drained = 0;
    let timerSawDrained = -1;

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        timerSawDrained = drained;
        resolve();
      }, 0);

      const step = (): void => {
        drained += 1;
        if (drained < DEPTH) queueMicrotask(step);
      };
      queueMicrotask(step);
    });

    expect(drained, 'цепочка обязана пройти до конца').toBe(DEPTH);
    expect(
      timerSawDrained,
      'задача получила управление только после полного слива очереди микрозадач',
    ).toBe(DEPTH);
  });

  /**
   * Ключевое утверждение раздела 2 и тонкого места 01: **микрозадачей уступить нельзя.**
   *
   * Цепочка крутится заведомо дольше срока таймера — и таймер не срабатывает ни разу.
   * Проверка не может пройти «за счёт того, что таймер ещё не дозрел»: сначала требуется,
   * чтобы цепочка пережила его срок, и только потом проверяется, что он молчал.
   *
   * ⚠️ Это не то же, что `probeStarvation` в `tests/unit/event-loop.test.ts`: там закреплено
   * отношение задержек («таймер ждал не меньше, чем поток был занят»), здесь — абсолютный
   * факт, на котором стоит вывод темы: уступки не произошло вовсе.
   */
  it('цепочка микрозадач не даёт таймеру сработать — уступки не происходит', async () => {
    const HELD_MS = 30;
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);

    const start = performance.now();
    let steps = 0;

    await new Promise<void>((resolve) => {
      const step = (): void => {
        steps += 1;
        if (performance.now() - start >= HELD_MS) {
          resolve();
          return;
        }
        queueMicrotask(step);
      };
      queueMicrotask(step);
    });

    expect(steps, 'цепочка обязана быть настоящей, а не одним шагом').toBeGreaterThan(1);
    expect(
      performance.now() - start,
      'цепочка обязана пережить срок таймера — иначе проверка была бы пустой',
    ).toBeGreaterThanOrEqual(HELD_MS);
    expect(fired, 'тонкое место 01: микрозадача откладывает код, но не отпускает поток').toBe(
      false,
    );
  });

  it('а тот же цикл на задачах поток отпускает — и чужой таймер успевает', async () => {
    const HELD_MS = 30;
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 0);

    const start = performance.now();

    await new Promise<void>((resolve) => {
      const step = (): void => {
        if (performance.now() - start >= HELD_MS) {
          resolve();
          return;
        }
        setTimeout(step, 0);
      };
      setTimeout(step, 0);
    });

    expect(fired, 'задача отпускает поток: между кусками цикл забрал чужую задачу').toBe(true);
  });

  it('таблица инструментов и тонкое место 01 говорят о микрозадаче одно и то же', () => {
    const micro = TOOL_ROWS.find((row) => row.k.includes('queueMicrotask'));
    expect(micro, 'строки про микрозадачу в шпаргалке нет').toBeDefined();
    expect(micro!.tone, 'вердикт первой колонки — это тон строки').toBe('err');
    expect(micro!.when).toContain('НИКОГДА');
    expect(pitfall('01').tone).toBe('err');
    expect(pitfall('01').d).toContain('до пуста');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · globalThis.scheduler против голого scheduler
// ---------------------------------------------------------------------------

/**
 * Главная правка темы против оригинала — и до сих пор она держалась на разовой ручной сверке
 * («проверено запуском в Node 24.11» в шапке `data.ts` и в карточке раздела 1).
 *
 * ⚠️ `new Function` здесь не украшение: в модуле ESM необъявленное имя ведёт себя так же,
 * но написанное прямо в тесте выражение `nosuchscheduler.yield?.()` уронило бы сам файл
 * на разборе окружающего кода — ровно как в `tests/unit/object-model.test.ts` с приватным
 * полем. Разбор надо отделить от вызова.
 */
describe('фолбэк · `globalThis.scheduler?.yield?.()` против голого `scheduler.yield?.()`', () => {
  it('голая форма там, где глобального имени нет, — это ReferenceError', () => {
    const bare = new Function("return nosuchscheduler.yield?.() ?? 'фолбэк';") as () => unknown;

    // Имя ошибки нормативно, текст V8 — нет: сверяется только имя и класс.
    expect(() => bare()).toThrow(ReferenceError);

    let name = '';
    try {
      bare();
    } catch (error) {
      name = (error as Error).name;
    }
    expect(name, 'опциональная цепочка от необъявленного имени не спасает').toBe('ReferenceError');
  });

  it('форма через `globalThis` даёт undefined, и `??` уходит в фолбэк', () => {
    const guarded = new Function(
      "return globalThis.nosuchscheduler?.yield?.() ?? 'фолбэк';",
    ) as () => unknown;

    expect(guarded(), 'запасной путь обязан выполниться — ради него всё и написано').toBe(
      'фолбэк',
    );
  });

  it('получатель при этом не теряется: внутри `obj.method?.()` this — это obj', () => {
    // Утверждение карточки раздела 1: bind нужен только там, где функцию сперва положили
    // в переменную. Здесь её не кладут — и `this` остаётся объектом.
    const holder = {
      value: 42,
      read(): number {
        return this.value;
      },
    };
    Reflect.set(globalThis, 'lessonSchedulerProbe', holder);

    try {
      const call = new Function('return globalThis.lessonSchedulerProbe?.read?.();') as () => unknown;
      expect(call()).toBe(42);
    } finally {
      Reflect.deleteProperty(globalThis, 'lessonSchedulerProbe');
    }
  });

  it('на странице записана именно форма через globalThis — в обоих листингах', () => {
    const listings = [
      ['CHUNKER_CODE', CHUNKER_CODE],
      ['YIELD_HELPER_CODE', YIELD_HELPER_CODE],
    ] as const;

    for (const [name, code] of listings) {
      expect(code, `${name}: фолбэк обязан читать планировщик через globalThis`).toContain(
        'globalThis.scheduler?.yield?.()',
      );
      // Голая форма в фолбэке — это и есть та ошибка, о которой тонкое место 08.
      expect(
        /(^|[^.\w])scheduler\.yield/.test(code),
        `${name}: голая форма вернулась в листинг — фолбэк снова не выполнится никогда`,
      ).toBe(false);
    }

    expect(pitfall('08').t).toContain('ReferenceError');
    expect(pitfall('08').d).toContain('globalThis.scheduler?.yield?.()');
    expect(pitfall('08').tone).toBe('err');
  });
});

// ---------------------------------------------------------------------------
// Раздел 5 · в Node планировщика нет
// ---------------------------------------------------------------------------

describe('Node · чего в этой среде нет и почему часть темы не проверяется', () => {
  /**
   * Заявление раздела 2: «`scheduler.*` из браузерной спеки нет вовсе:
   * `typeof scheduler === 'undefined'` — проверено в Node 24.11».
   *
   * Теперь это проверяется на каждом прогоне и на той версии Node, что стоит у читателя:
   * появится в Node глобальный `scheduler` — тест покраснеет раньше, чем страница соврёт.
   */
  it('`typeof scheduler === "undefined"` — ровно то, что обещает раздел 2', () => {
    expect(new Function('return typeof scheduler;')()).toBe('undefined');
    expect(Reflect.has(globalThis, 'scheduler'), 'глобального имени нет и в дескрипторах').toBe(
      false,
    );
  });

  /**
   * ⚠️ Нюанс, которого в теме нет, и он важен именно потому, что выглядит как опровержение:
   * у Node есть СВОЙ `scheduler` — но как экспорт `node:timers/promises`, а не как глобальное
   * имя. Браузерного планировщика это не даёт: `globalThis.scheduler` по-прежнему undefined,
   * а значит фолбэк чанкера в Node честно уходит в таймер. Закреплено обе половины сразу,
   * чтобы появление одной не было принято за появление другой.
   */
  it('модульный `scheduler` из node:timers/promises существует, но глобальным не становится', () => {
    expect(typeof nodeScheduler.yield).toBe('function');
    expect(typeof nodeScheduler.wait).toBe('function');
    expect(Reflect.has(globalThis, 'scheduler'), 'экспорт модуля — не глобальное имя').toBe(false);
  });

  it('браузерного планировщика задач нет целиком — листинг postTask поэтому только показан', () => {
    // ⚠️ Заглушку вместо TaskController писать нельзя: она проверяла бы саму себя.
    // Здесь закреплено, что API отсутствует, — чтобы «не проверено» осталось видимым.
    expect(new Function('return typeof TaskController;')()).toBe('undefined');
    expect(new Function('return typeof queueMicrotask;')()).toBe('function');
    expect(POST_TASK_CODE, 'листинг раздела 2 показывает именно postTask').toContain(
      'scheduler.postTask',
    );
    expect(POST_TASK_CODE).toContain('TaskController');
  });

  /**
   * Заявление того же раздела: в Node аналог «уступить циклу» — `setImmediate`,
   * «фаза check, гарантированно в текущем обороте».
   *
   * ⚠️ Проверяется это только внутри цикла ввода-вывода: там порядок «immediate раньше
   * нулевого таймера» действительно гарантирован. На верхнем уровне модуля он не гарантирован
   * ничем — это известная гонка, зависящая от того, успел ли стартовать цикл. Поэтому тест
   * стоит в колбэке `readFile`, а не рядом с ним.
   */
  it('`setImmediate` в цикле ввода-вывода забирает управление раньше нулевого таймера', async () => {
    const order = await new Promise<string[]>((resolve) => {
      readFile(new URL(import.meta.url), () => {
        const seen: string[] = [];
        const done = (label: string): void => {
          seen.push(label);
          if (seen.length === 2) resolve(seen);
        };
        setTimeout(() => done('timeout'), 0);
        setImmediate(() => done('immediate'));
      });
    });

    expect(order, 'фаза check идёт в том же обороте, таймеры — в следующем').toEqual([
      'immediate',
      'timeout',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Раздел 6 · листинги темы исполняются прямо из данных
// ---------------------------------------------------------------------------

describe('листинги · канонический чанкер выполняется, а не пересказывается', () => {
  type Chunked = (items: number[], fn: (item: number) => void) => Promise<void>;

  it('чанкер обрабатывает все элементы и действительно уступает поток', async () => {
    const chunked = fromListing<Chunked>(CHUNKER_CODE, 'chunked');

    let alienRan = false;
    setTimeout(() => {
      alienRan = true;
    }, 0);

    const processed: number[] = [];
    // Каждый элемент дороже бюджета в 50 мс — значит уступка обязана случиться после каждого.
    await chunked([1, 2, 3], (item) => {
      burn(BUDGET_MS + 10);
      processed.push(item);
    });

    expect(processed, 'работа обязана быть доделана целиком').toEqual([1, 2, 3]);
    expect(
      alienRan,
      'уступка настоящая: чужая задача получила управление между кусками',
    ).toBe(true);
  });

  it('тот же объём работы без уступок чужую задачу не пускает вовсе', () => {
    let alienRan = false;
    setTimeout(() => {
      alienRan = true;
    }, 0);

    for (let i = 0; i < 3; i += 1) burn(BUDGET_MS + 10);

    expect(alienRan, 'контраст к предыдущей проверке: без уступки это одна длинная задача').toBe(
      false,
    );
  });

  it('`yieldToMain` в среде без планировщика возвращает промис и уступает ЗАДАЧЕЙ', async () => {
    const yieldToMain = fromListing<() => unknown>(YIELD_HELPER_CODE, 'yieldToMain');

    const order: string[] = [];
    const pending = yieldToMain();
    expect(pending, 'фолбэк обязан быть промисом, а не undefined').toBeInstanceOf(Promise);

    queueMicrotask(() => order.push('микрозадача'));
    await pending;
    order.push('после уступки');

    // Утверждение карточки раздела 1: здесь обязана быть задача, а не микрозадача.
    expect(order).toEqual(['микрозадача', 'после уступки']);
  });

  it('листинг про MessageChannel исполняется, и сообщение порта — задача, а не микрозадача', async () => {
    type Channel = { nextTask: () => void; port1: MessagePort; port2: MessagePort };
    const build = new Function('doWork', `'use strict';\n${CHANNEL_CODE}\nreturn { nextTask, port1, port2 };`) as (
      doWork: () => void,
    ) => Channel;

    const order: string[] = [];
    let onDone: (() => void) | null = null;
    const channel = build(() => {
      order.push('порт');
      onDone?.();
    });

    try {
      await new Promise<void>((resolve) => {
        onDone = resolve;
        channel.nextTask();
        queueMicrotask(() => order.push('микрозадача'));
      });

      expect(order, 'posted message — это задача: чекпоинт микрозадач раньше').toEqual([
        'микрозадача',
        'порт',
      ]);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Раздел 7 · отмена — это соглашение
// ---------------------------------------------------------------------------

describe('отмена · abort снимает не начатое, а начатое доработает до границы куска', () => {
  const CHUNK = 10;

  /** Чанкер с отменой: сигнал проверяется ТОЛЬКО на границе — как и сказано в тонком месте 10. */
  async function chunkedCancellable(
    items: number[],
    fn: (item: number) => void,
    signal: AbortSignal,
  ): Promise<'done' | 'stopped'> {
    for (let i = 0; i < items.length; i += CHUNK) {
      if (signal.aborted) return 'stopped';
      for (let j = i; j < Math.min(i + CHUNK, items.length); j += 1) fn(items[j]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return 'done';
  }

  const items = (): number[] => Array.from({ length: 50 }, (_, i) => i);

  it('abort посреди куска не прерывает кусок — работа встаёт на его границе', async () => {
    const controller = new AbortController();
    const seen: number[] = [];

    const verdict = await chunkedCancellable(
      items(),
      (item) => {
        seen.push(item);
        if (item === 13) controller.abort();
      },
      controller.signal,
    );

    expect(verdict).toBe('stopped');
    expect(seen.at(-1), 'кусок 10–19 доработал целиком, хотя abort пришёл на 13').toBe(19);
    expect(seen, 'элементы после отмены внутри того же куска всё равно обработаны').toContain(14);
    expect(seen, 'но следующий кусок не начат').not.toContain(20);
    expect(seen).toHaveLength(20);
  });

  it('ещё не начатую работу abort действительно снимает целиком', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    controller.abort();

    const verdict = await chunkedCancellable(items(), (item) => void seen.push(item), controller.signal);

    expect(verdict).toBe('stopped');
    expect(seen, 'тонкое место 10: снимается именно ЕЩЁ НЕ НАЧАТАЯ задача').toHaveLength(0);
  });

  it('без проверок `signal.aborted` внутри отмена не делает ничего', async () => {
    const controller = new AbortController();
    const seen: number[] = [];
    controller.abort();

    // Тот же цикл, но сигнал не читается — именно это и имеет в виду слово «соглашение».
    for (const item of items()) seen.push(item);

    expect(controller.signal.aborted).toBe(true);
    expect(seen, 'отмена — соглашение: кто не смотрит на сигнал, тот доработает до конца').toHaveLength(
      50,
    );
  });

  it('`signal.reason` при `abort()` без аргумента — AbortError; нормативно имя', () => {
    const controller = new AbortController();
    controller.abort();

    const reason = controller.signal.reason as { name?: string };
    expect(reason.name, 'имя ошибки нормативно, её текст — нет').toBe('AbortError');
    expect(controller.signal.reason).toBeInstanceOf(DOMException);
  });

  /**
   * Утверждение карточки «TaskController — это AbortController с приоритетом»: его `signal`
   * понимает любое API, принимающее `AbortSignal`. Самого `TaskController` в Node нет,
   * а вот проверяемая половина — совместимость обычного сигнала с посторонним API — есть.
   *
   * ⚠️ Имя ошибки здесь то же, а класс другой (не `DOMException`): ещё одна причина
   * проверять `name`, а не `instanceof`.
   */
  it('тот же сигнал понимает постороннее API, не знающее ничего о планировщике', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    let name = '';
    try {
      await delay(5_000, undefined, { signal: controller.signal });
    } catch (error) {
      name = (error as Error).name;
    }

    expect(name, 'сигнал — общая валюта отмены').toBe('AbortError');
    expect(controller.signal.aborted).toBe(true);
    expect(POST_TASK_FACTS.some((fact) => fact.d.includes('AbortSignal'))).toBe(true);
  });
});

/**
 * Листинг «Тот же чанкер, но отменяемый» — исполняется сам, а не пересказывается.
 *
 * Тело берётся из `CHUNKER_ABORT_CODE` вместе с `yieldToMain` из `YIELD_HELPER_CODE`. Глобальные
 * имена, которых в Node нет или которые трогать нельзя (`addEventListener`, `rows`, `render`),
 * подставлены параметрами: верхний вызов листинга отрабатывает на пустом массиве.
 */
describe('отмена · листинг отменяемого чанкера и причины отмены', () => {
  type Chunked = (
    items: number[],
    fn: (item: number) => void,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;

  function chunkedFromListing(): Chunked {
    const factory = new Function(
      'addEventListener',
      'rows',
      'render',
      `'use strict';\n${YIELD_HELPER_CODE}\n${CHUNKER_ABORT_CODE}\nreturn chunked;`,
    ) as (add: () => void, rows: number[], render: () => void) => Chunked;
    return factory(() => {}, [], () => {});
  }

  it('abort, пришедший во время куска, срабатывает на первой уступке после него', async () => {
    const chunked = chunkedFromListing();
    const ac = new AbortController();
    const seen: number[] = [];
    // Таймер отмены дозревает, пока идёт первый кусок, но выполнится только на уступке.
    setTimeout(() => ac.abort(), 0);

    let name = '';
    try {
      await chunked([0, 1, 2, 3, 4, 5], (item) => {
        burn(30);
        seen.push(item);
      }, { signal: ac.signal });
    } catch (error) {
      name = (error as Error).name;
    }

    expect(name, 'отмена приходит исключением из throwIfAborted').toBe('AbortError');
    expect(seen, 'первый кусок (60 мс > 50) доработал целиком, второй не начат').toEqual([0, 1]);
  });

  it('`AbortSignal.timeout` отменяет с `TimeoutError` — фильтр по `AbortError` её пропускает', async () => {
    const chunked = chunkedFromListing();
    // Сигнал держим в переменной: в Node таймаут-сигнал без ссылок может уйти в сборку.
    const signal = AbortSignal.timeout(10);

    let name = '';
    try {
      await chunked([0, 1, 2, 3], () => burn(30), { signal });
    } catch (error) {
      name = (error as Error).name;
    }

    expect(name).toBe('TimeoutError');
    expect(name !== 'AbortError', 'фильтр из листинга сочтёт таймаут ошибкой').toBe(true);
    expect(ABORT_FACTS.some((fact) => fact.d.includes('TimeoutError'))).toBe(true);
  });

  /**
   * Карточка «Синхронная рекурсия»: обход, сделанный `async` целиком, уступает между узлами
   * и не теряет места в дереве — каждый уровень приостанавливается и продолжается сам.
   */
  it('async-рекурсия уступает между узлами и обходит дерево целиком и по порядку', async () => {
    type Node = { v: number; c: Node[] };
    const tree: Node = { v: 1, c: [{ v: 2, c: [{ v: 3, c: [] }] }, { v: 4, c: [] }] };
    const log: (number | string)[] = [];

    async function walk(node: Node): Promise<void> {
      log.push(node.v);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      for (const child of node.c) await walk(child);
    }

    setTimeout(() => log.push('чужой'), 0);
    await walk(tree);

    expect(log).toEqual([1, 'чужой', 2, 3, 4]);
    expect(UNSLICEABLE.some((item) => item.d.includes('`async`'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Раздел 8 · следствие клампа — пропускная способность
// ---------------------------------------------------------------------------

describe('цена уступки · отношения, снятые тем же прибором, что и в демо', () => {
  // Окно и прогрев меньше демонстрационных: тесту нужна форма результата и кратности,
  // а не красивые числа. Отношения от размера окна не зависят — абсолюты и так не проверяются.
  const WINDOW_MS = 60;
  const WARMUP_MS = 15;

  it('в Node прибор находит три способа из четырёх, и планировщика среди них нет', () => {
    expect(TOOLS.map((item) => item.key)).toEqual(['timeout', 'channel', 'micro', 'scheduler']);
    expect(supports('timeout')).toBe(true);
    expect(supports('channel')).toBe(true);
    expect(supports('micro')).toBe(true);
    // Тот же вывод, что и `typeof scheduler === 'undefined'`, но снятый кодом самого демо.
    expect(supports('scheduler'), 'браузерного планировщика в Node нет').toBe(false);
  });

  /**
   * ⚠️ Закрепляется **отношение, а не 250 итераций**: 250 — модельное следствие клампа в 4 мс,
   * и на машине читателя (тем более в Node, где клампа вложенности нет вовсе, а пол — 1 мс)
   * число будет другим. Неизменно другое: у таймера есть минимальная задержка, а у задачи
   * из порта её нет. Исчезни этот разрыв — исчезнет повод у всего раздела 2.
   */
  it('цепочка на setTimeout укладывает в окно на порядки меньше уступок, чем задача из порта', async () => {
    const timeout = await measureTool('timeout', WINDOW_MS, WARMUP_MS);
    const channel = await measureTool('channel', WINDOW_MS, WARMUP_MS);

    expect(timeout.available, 'таймером мерить не вышло').toBe(true);
    expect(channel.available, 'каналом мерить не вышло').toBe(true);
    expect(timeout.iterations, 'цепочка на таймерах обязана хоть сколько-то пройти').toBeGreaterThan(
      0,
    );

    expect(
      channel.iterations / timeout.iterations,
      'у таймера есть минимальная задержка, у сообщения порта — нет: разрыв на порядки',
    ).toBeGreaterThan(20);
    expect(timeout.perYieldMs).toBeGreaterThan(channel.perYieldMs);
  });

  it('микрозадача дешевле любой настоящей уступки — ровно потому, что не уступает', async () => {
    const channel = await measureTool('channel', WINDOW_MS, WARMUP_MS);
    const micro = await measureTool('micro', WINDOW_MS, WARMUP_MS);

    expect(micro.available).toBe(true);
    expect(micro.yields, 'контрольная линия помечена как «не уступка»').toBe(false);
    expect(
      micro.iterations / channel.iterations,
      'пол измерения обязан быть ниже самой дешёвой настоящей уступки',
    ).toBeGreaterThan(1.5);
  });

  it('отчёт считает кратности от настоящей уступки, а полом измерения выходит микрозадача', async () => {
    const report = await measureYields({ windowMs: WINDOW_MS, warmupMs: WARMUP_MS });

    expect(report.measured).toBe(true);
    const base = report.rows.find((row) => row.key === report.base);
    expect(base?.yields, 'база кратностей — самый дешёвый НАСТОЯЩИЙ способ уступить').toBe(true);
    expect(report.floor, 'дешевле всех всегда тот, кто поток не отпускает').toBe('micro');

    const micro = report.rows.find((row) => row.key === 'micro')!;
    expect(micro.ratio, 'кратность меньше единицы здесь законна и означает «не уступает»').toBeLessThan(
      1,
    );

    const scheduler = report.rows.find((row) => row.key === 'scheduler')!;
    expect(scheduler.available, 'заглушки вместо замера быть не должно').toBe(false);
    expect(scheduler.unavailable, 'отказ обязан быть объяснён словами').not.toBe('');
    expect(scheduler.iterations, 'у несостоявшегося замера нет итераций').toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Раздел 9 · числа данных согласованы между собой
// ---------------------------------------------------------------------------

describe('данные · числа темы сходятся друг с другом и с соседней темой', () => {
  /**
   * ⚠️ Сами величины `cost` не закрепляются НИЧЕМ — ни дословно, ни с допуском.
   *
   * Живой замер в Chromium показал, что модельные 0.12 мс у канала и 0.06 мс у планировщика
   * завышены примерно в сорок раз; решение по этим числам за автором темы. Что замер
   * воспроизводит уверенно — **порядок**: таймер дороже канала, канал дороже планировщика,
   * а «без уступок» бесплатно. Порядок и закреплён: на нём стоит вся шпаргалка раздела 2,
   * и он переживёт любую переоценку абсолютов.
   */
  it('порядок цен в калькуляторе строгий — и он единственное, что в них закреплено', () => {
    const costs = ['st', 'mc', 'sy', 'no'].map((key) => tool(key).cost);

    expect(costs, 'цены обязаны идти строго по убыванию').toEqual([...costs].sort((a, b) => b - a));
    expect(new Set(costs).size, 'двух одинаковых цен быть не должно').toBe(costs.length);
    expect(tool('no').cost, 'без уступок накладных нет вовсе').toBe(0);
    expect(tool('st').note, 'дороговизна таймера объяснена клампом, а не замером').toContain(
      '4 мс',
    );

    const row = TOOL_ROWS.find((item) => item.k === 'MessageChannel');
    expect(row?.when, 'шпаргалка зовёт канал фолбэком без клампа').toContain('фолбэк');
  });

  it('правило клампа записано формулировкой спеки — той же, что у соседней темы', () => {
    expect(CLAMP_MS, 'nesting level > 5 и timeout < 4 → timeout = 4').toBe(4);
    expect(CLAMP_AFTER_LEVEL, 'правило спеки: уровень больше пятого').toBe(5);
    expect(pitfall('02').d, 'формулировка приведена к спеке').toContain('больше 5');
    expect(pitfall('02').d).toContain('4 мс');
  });

  it('«~250 итераций в секунду» и «сорок секунд» — счёт от клампа спеки, а не отдельные числа', () => {
    // Считается от нормативных 4 мс, а НЕ от `cost` в данных: модельные цены под вопросом,
    // правило спеки — нет.
    expect(Math.round(1000 / CLAMP_MS)).toBe(250);
    expect(pitfall('02').d).toContain('250');
    expect((10_000 * CLAMP_MS) / 1000, 'десять тысяч чанков по 4 мс').toBe(40);
    expect(pitfall('02').d).toContain('сорок секунд');
  });

  it('«две секунды работы» из подводки раздела 1 — это стартовое состояние калькулятора', () => {
    const tenThousand = YIELD_SIZES.find((size) => size.items === 10_000);
    expect(tenThousand, 'размера в десять тысяч элементов в данных нет').toBeDefined();

    expect(tenThousand!.items * PER_ITEM, 'полезной работы — ровно две секунды').toBe(2_000);
    // И те же десять тысяч чанков по нормативным 4 мс дают сорок секунд из тонкого места 02.
    expect(tenThousand!.items * CLAMP_MS).toBe(40_000);
  });

  it('бюджет 50 мс — он же порог long task, он же средний режим шкалы', () => {
    expect(BUDGET_MS).toBe(50);
    const byBudget = TIMELINE_MODES.find((mode) => mode.key === 'b50');
    expect(byBudget?.chunk, 'режим шкалы и бюджет калькулятора — одно число').toBe(BUDGET_MS);
    expect(byBudget?.note).toContain('50 мс здесь потолок');
  });

  it('«уступок стало в шесть раз больше» — это 50, делённое на 8', () => {
    const byBudget = TIMELINE_MODES.find((mode) => mode.key === 'b50')!;
    const byFrame = TIMELINE_MODES.find((mode) => mode.key === 'b8')!;
    expect(byBudget.chunk).not.toBeNull();
    expect(byFrame.chunk).not.toBeNull();

    const chunksOf = (size: number): number => Math.ceil(TIMELINE_WORK / size);
    expect(chunksOf(byFrame.chunk!) / chunksOf(byBudget.chunk!)).toBeCloseTo(6.25, 5);
    expect(byFrame.note, 'подпись режима называет то же отношение словами').toContain('в шесть раз');
  });

  /**
   * «Ввод ждёт максимум один кусок» из подписи режима — это не лозунг, а счёт по тем же
   * данным, что рисует шкала: `ceil(момент клика / кусок) × кусок`.
   *
   * ⚠️ Формула здесь повторена, а не импортирована: у `long-task-timeline` нет `model/*.ts`,
   * логика живёт прямо в `.vue`. Поэтому проверка закрепляет утверждение ДАННЫХ (клики и куски
   * подобраны так, что обещание выполняется), а не реализацию виджета. Появится у слайса
   * модель — звать надо будет её.
   */
  it('«ввод ждёт максимум один кусок» выполняется на тех кликах, что лежат в данных', () => {
    const handledAt = (at: number, chunk: number | null): number =>
      chunk === null ? TIMELINE_WORK : Math.min(TIMELINE_WORK, Math.ceil(at / chunk) * chunk);

    expect(TIMELINE_CLICKS.length, 'кликов должно быть несколько').toBeGreaterThan(1);
    expect(
      TIMELINE_CLICKS.every((click) => click.at > 0 && click.at < TIMELINE_WORK),
      'клики обязаны попадать внутрь работы, иначе картинка врёт',
    ).toBe(true);

    for (const mode of TIMELINE_MODES) {
      const worst = Math.max(
        ...TIMELINE_CLICKS.map((click) => handledAt(click.at, mode.chunk) - click.at),
      );

      if (mode.chunk === null) {
        expect(worst, `${mode.label}: ждать приходится до конца всей работы`).toBeGreaterThan(300);
        expect(mode.tone).toBe('err');
      } else {
        expect(worst, `${mode.label}: ожидание обязано укладываться в один кусок`).toBeLessThanOrEqual(
          mode.chunk,
        );
        expect(mode.tone).toBe('ok');
      }
    }
  });

  it('разрезание не ускоряет: во всех режимах работы ровно столько же', () => {
    for (const mode of TIMELINE_MODES) {
      const size = mode.chunk;
      const total =
        size === null
          ? TIMELINE_WORK
          : Array.from({ length: Math.ceil(TIMELINE_WORK / size) }, (_, i) =>
              Math.min(size, TIMELINE_WORK - i * size),
            ).reduce((acc, ms) => acc + ms, 0);

      expect(total, `${mode.label}: суммарное время главного потока не меняется`).toBe(TIMELINE_WORK);
    }
    expect(pitfall('03').d).toContain('Суммарное время главного потока не меняется');
  });

  it('первая фаза INP — самая крупная, и лечится она ровно предметом урока', () => {
    const biggest = [...INP_PARTS].sort((a, b) => b.share - a.share)[0];
    expect(biggest.k, 'урок лечит напрямую именно input delay').toBe('input delay');
    // Лечение названо механикой темы — нарезкой, а не отсылкой «тем, чему посвящён урок».
    expect(biggest.fix).toContain('нарезк');
    expect(INP_PARTS).toHaveLength(3);
  });

  it('номера тонких мест уникальны и идут подряд', () => {
    const numbers = PITFALLS.map((item) => item.n);
    expect(new Set(numbers).size, 'номера повторяются').toBe(numbers.length);
    expect(numbers).toEqual(
      Array.from({ length: PITFALLS.length }, (_, i) => String(i + 1).padStart(2, '0')),
    );
  });
});
