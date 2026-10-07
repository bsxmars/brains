import type {
  YieldMeasure,
  YieldParams,
  YieldReport,
  YieldToolKey,
  YieldToolSpec,
} from './types';

/**
 * Сколько стоит сама уступка — секундомером в браузере читателя, а не константой в данных.
 *
 * Рядом в теме стоит калькулятор `widgets/yield-cost`: он перемножает число уступок на их цену
 * и показывает, как накладные съедают работу. Цена там задана константами (4 / 0.12 / 0.06 мс)
 * и подписана «числа модельные, меряйте на своём железе» — а померить было нечем. Этот виджет
 * и есть то, чем. Правило курса на этот счёт прямое (`AGENTS.md`, «Таблицу о поведении языка
 * не набирают — её вычисляют»): если величина измерима в браузере, она измеряется.
 *
 * ⚠️ **Это не повтор `widgets/timer-clamp`.** Тот меряет задержку **одного** вложенного таймера
 * по уровням и отвечает на вопрос «где ноль перестаёт быть нулём». Здесь вопрос другой —
 * пропускная способность: сколько уступок укладывается в фиксированное окно и во сколько раз
 * один способ дороже другого. Кламп виден и тут, но как следствие, а не как предмет: приём
 * с «свежей задачей» перед замером взят именно оттуда (см. `fromFreshTask` ниже).
 *
 * ⚠️ **Среды может не быть.** Остров сперва рендерится в Node, а модуль читает и юнит-тест,
 * поэтому `performance`, `MessageChannel`, `queueMicrotask` и `scheduler` спрашиваются
 * **внутри** функций. Обращение к ним на уровне модуля уронило бы сборку всей страницы,
 * а не только остров. На отсутствие любого из них предусмотрен честный отказ вместо падения.
 *
 * ⚠️ **Что здесь нормативно, а что нет.** Нормативен факт: вложенный `setTimeout(…, 0)` дороже
 * остальных способов, потому что HTML Standard разрешает поднять его задержку до 4 мс, когда
 * вложенность больше пяти. Ненормативны миллисекунды: они про эту машину, этот браузер и эту
 * минуту. Поэтому наружу отдаётся ещё и `ratio` — отношение, а не абсолют.
 */

/** Окно замера на один инструмент, мс. Читатель ждёт весь прогон — четыре окна подряд. */
export const WINDOW_MS = 350;

/**
 * Холостой прогон перед замером, мс.
 *
 * Две работы разом, и вторая важнее первой.
 *
 * Первая — обычный прогрев: первые обороты цикла дороже, пока движок не собрал код.
 *
 * Вторая — **насыщение вложенности**, и без неё замер `setTimeout` соврал бы в меньшую сторону.
 * Кламп включается не сразу: первые пять уровней бесплатны, и если начать мерить с нуля,
 * в окно попадут и они. Поэтому прогрев и замер идут **подряд, без сброса между ними**:
 * `await` возвращает управление микрозадачей внутри той же задачи таймера, вложенность
 * не обнуляется, и мерится уже установившаяся цена. Ровно та, которую платит чанкер
 * на седьмой тысяче элементов, а не на первых пяти.
 */
export const WARMUP_MS = 40;

/** Предохранитель: цикл микрозадач за 350 мс проворачивается миллионы раз. */
const MAX_ITERATIONS = 20_000_000;

export const TOOLS: YieldToolSpec[] = [
  {
    key: 'timeout',
    label: 'setTimeout(0)',
    yields: true,
    code: 'await new Promise((r) => setTimeout(r, 0));',
    note: 'Продолжение уезжает в **хвост** очереди задач, а вложенность цепочки растёт с каждой уступкой: с шестого уровня заказанный ноль по правилу HTML Standard превращается в 4 мс.',
    absent: 'в этой среде нет `setTimeout`',
  },
  {
    key: 'channel',
    label: 'MessageChannel',
    yields: true,
    code: 'port2.postMessage(0);   // порт сам себе, port1.onmessage разбудит',
    note: 'Тоже задача, но клампа у сообщений нет вовсе. Приоритета — тоже: между вашими кусками встанет всё, что успело накопиться.',
    absent: 'в этой среде нет `MessageChannel`',
  },
  {
    key: 'micro',
    label: 'queueMicrotask',
    yields: false,
    code: 'await new Promise((r) => queueMicrotask(r));',
    note: '**Это не уступка.** Очередь микрозадач сливается досуха внутри того же чекпоинта: браузер не получает ни кадра, ни обработки ввода. Строка стоит здесь для контраста — и заодно показывает пол измерения: дешевле обвязки замера не бывает ничего.',
    absent: 'в этой среде нет `queueMicrotask`',
  },
  {
    key: 'scheduler',
    label: 'scheduler.yield()',
    yields: true,
    code: 'await globalThis.scheduler.yield();',
    note: 'Продолжение наследует приоритет и встаёт **в начало** очереди, а не в хвост: чужая аналитика между вашими кусками не пролезет.',
    absent: 'в этом браузере нет `scheduler.yield()`',
  },
];

/** Есть ли чем мерить. Спрашивается внутри функций: на уровне модуля это уронило бы сборку. */
const measurable = (): boolean =>
  typeof performance !== 'undefined' && typeof performance.now === 'function';

interface SchedulerLike {
  yield?: () => Promise<unknown>;
}

/**
 * Глобальный планировщик — **только через `globalThis`**, и это не стиль.
 *
 * Голое `scheduler?.yield?.()` там, где глобального `scheduler` нет вовсе, бросает
 * ReferenceError: опциональная цепочка спасает от отсутствующего свойства, а не
 * от необъявленного имени. Ровно это тонкое место 08 той же темы — и демо обязано
 * писать так же, как учит текст.
 */
const schedulerOf = (): SchedulerLike | undefined =>
  (globalThis as typeof globalThis & { scheduler?: SchedulerLike }).scheduler;

/** Один оборот уступки. Промис, который разрешится, когда поток вернулся к нам. */
type Step = () => Promise<unknown>;

/** Собранный стенд: чем крутить и что за собой закрыть. */
interface Rig {
  step: Step;
  stop: () => void;
}

/**
 * Собрать стенд под инструмент — или честно сказать, что такого API здесь нет.
 *
 * ⚠️ Канал у `MessageChannel` **один на весь замер**, а не новый на каждую уступку. Так пишут
 * настоящие чанкеры, и так это сравнимо с остальными: создание канала — цена настройки,
 * а мерим мы цену оборота.
 */
function rig(key: YieldToolKey): Rig | null {
  if (key === 'timeout') {
    if (typeof setTimeout !== 'function') return null;
    return {
      step: () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
      stop: () => {},
    };
  }

  if (key === 'channel') {
    if (typeof MessageChannel === 'undefined') return null;
    const channel = new MessageChannel();
    let resume: (() => void) | null = null;

    channel.port1.onmessage = () => {
      const pending = resume;
      resume = null;
      pending?.();
    };
    channel.port1.start();

    return {
      step: () =>
        new Promise<void>((resolve) => {
          resume = resolve;
          channel.port2.postMessage(0);
        }),
      stop: () => {
        channel.port1.close();
        channel.port2.close();
      },
    };
  }

  if (key === 'micro') {
    if (typeof queueMicrotask !== 'function') return null;
    return {
      step: () =>
        new Promise<void>((resolve) => {
          queueMicrotask(resolve);
        }),
      stop: () => {},
    };
  }

  const scheduler = schedulerOf();
  if (typeof scheduler?.yield !== 'function') return null;
  const call = scheduler.yield.bind(scheduler);
  return { step: () => call(), stop: () => {} };
}

/** Есть ли такой способ уступки в этой среде. Нужен и демо, и тесту. */
export function supports(key: YieldToolKey): boolean {
  const built = rig(key);
  if (!built) return false;
  built.stop();
  return true;
}

/**
 * Крутить уступки, пока не выйдет окно, и посчитать обороты.
 *
 * Окно ограничено **временем, а не числом итераций**, и это принципиально: пять оборотов
 * `setTimeout` уложились бы в бесплатные уровни вложенности и клампа не показали бы вовсе.
 * Сколько оборотов уложится — это и есть ответ.
 */
async function spin(step: Step, durationMs: number): Promise<{ iterations: number; spanMs: number }> {
  const started = performance.now();
  let iterations = 0;
  let now = started;

  while (now - started < durationMs && iterations < MAX_ITERATIONS) {
    await step();
    iterations += 1;
    now = performance.now();
  }

  return { iterations, spanMs: now - started };
}

/**
 * Начать с задачи, **не порождённой таймером**.
 *
 * Приём целиком из `widgets/timer-clamp` и нужен по той же причине: `await` возвращает
 * управление микрозадачей внутри той же задачи, поэтому второй замер подряд унаследовал бы
 * вложенность первого — и лесенка `setTimeout` начиналась бы сразу с клампа. Сообщение через
 * `MessageChannel` — задача другого источника, на ней вложенность нулевая.
 *
 * Здесь это калибровка прибора: без неё числа зависели бы от того, каким инструментом мерили
 * перед этим.
 */
function fromFreshTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

const spec = (key: YieldToolKey): YieldToolSpec =>
  TOOLS.find((tool) => tool.key === key) ?? TOOLS[0];

function blank(key: YieldToolKey, why: string): YieldMeasure {
  const tool = spec(key);
  return {
    key,
    label: tool.label,
    yields: tool.yields,
    code: tool.code,
    note: tool.note,
    available: false,
    unavailable: why,
    iterations: 0,
    spanMs: 0,
    perYieldMs: 0,
    perSecond: 0,
    ratio: 0,
    tone: 'info',
  };
}

/**
 * Померить один инструмент.
 *
 * Порядок ровно такой: свежая задача → холостой прогон → **сразу** замер. Между прогревом
 * и замером сброса нет намеренно (см. `WARMUP_MS`).
 */
export async function measureTool(
  key: YieldToolKey,
  windowMs: number = WINDOW_MS,
  warmupMs: number = WARMUP_MS,
): Promise<YieldMeasure> {
  const tool = spec(key);
  if (!measurable()) return blank(key, 'в этой среде нет `performance.now()` — мерить нечем');

  const built = rig(key);
  if (!built) return blank(key, tool.absent);

  try {
    await fromFreshTask();
    if (warmupMs > 0) await spin(built.step, warmupMs);
    const { iterations, spanMs } = await spin(built.step, windowMs);

    if (!iterations) return blank(key, 'за окно замера не уложилось ни одной уступки');

    const perYieldMs = spanMs / iterations;
    return {
      key,
      label: tool.label,
      yields: tool.yields,
      code: tool.code,
      note: tool.note,
      available: true,
      unavailable: '',
      iterations,
      spanMs,
      perYieldMs,
      perSecond: iterations / (spanMs / 1000),
      ratio: 1,
      tone: 'ok',
    };
  } finally {
    built.stop();
  }
}

/** Кратность к самому дешёвому: 10 и больше — другой порядок величины, а не «чуть дороже». */
const toneOf = (row: YieldMeasure): YieldMeasure['tone'] => {
  if (!row.yields) return 'info';
  if (row.ratio >= 10) return 'err';
  if (row.ratio >= 3) return 'warn';
  return 'ok';
};

/**
 * Прогнать все четыре способа и сложить их рядом.
 *
 * ⚠️ Замеры идут **строго по очереди**, `for…of` с `await` внутри. Это не недосмотр и не место
 * для `Promise.all`: поток один, и два прибора на нём мерили бы друг друга.
 */
export async function measureYields(params: YieldParams = {}): Promise<YieldReport> {
  const windowMs = params.windowMs ?? WINDOW_MS;
  const warmupMs = params.warmupMs ?? WARMUP_MS;

  /**
   * Фоновая вкладка душит таймеры: `setTimeout` там срабатывает раз в секунду, а после
   * нескольких минут — раз в минуту. Замер в таком состоянии не «чуть хуже», он про другое,
   * поэтому состояние вкладки снимается и показывается вместе с числами.
   */
  const hidden = typeof document !== 'undefined' && document.hidden === true;

  if (!measurable()) {
    return {
      measured: false,
      conditions: { windowMs, warmupMs, totalMs: 0, hidden },
      rows: TOOLS.map((tool) => blank(tool.key, 'в этой среде нет `performance.now()` — мерить нечем')),
      base: null,
      floor: null,
      tone: 'warn',
      verdict:
        'В этой среде нет часов — мерить нечем. Показать вместо замера заготовленные числа было бы ровно той подделкой, против которой этот виджет и сделан.',
    };
  }

  const startedAll = performance.now();
  const rows: YieldMeasure[] = [];
  for (const tool of TOOLS) rows.push(await measureTool(tool.key, windowMs, warmupMs));
  const totalMs = performance.now() - startedAll;

  const done = rows.filter((row) => row.available);
  const cheapest = (list: YieldMeasure[]): YieldMeasure | null =>
    list.reduce<YieldMeasure | null>(
      (best, row) => (!best || row.perYieldMs < best.perYieldMs ? row : best),
      null,
    );

  const floor = cheapest(done);
  const realYield = cheapest(done.filter((row) => row.yields));

  /**
   * ⚠️ База кратностей — самый дешёвый **настоящий** способ уступить, а не самый дешёвый вообще.
   *
   * Разница не косметическая. Дешевле всех всегда окажется `queueMicrotask`, но он поток
   * не отпускает, и кратности, посчитанные от него, отвечали бы на вопрос «во сколько раз это
   * дороже, чем не уступать» — то есть ни на какой. От базы-уступки у микрозадачи выходит
   * кратность меньше единицы, и это ровно то, что нужно показать.
   */
  const base = realYield ?? floor;

  for (const row of rows) {
    if (!row.available || !base || base.perYieldMs <= 0) continue;
    row.ratio = row.perYieldMs / base.perYieldMs;
    row.tone = toneOf(row);
  }

  const timeout = rows.find((row) => row.key === 'timeout');
  const tone: YieldReport['tone'] = hidden ? 'warn' : timeout?.tone ?? 'ok';

  return {
    measured: done.length > 0,
    conditions: { windowMs, warmupMs, totalMs, hidden },
    rows,
    base: base?.key ?? null,
    floor: floor?.key ?? null,
    tone,
    verdict: verdictOf({ rows, timeout, realYield, hidden }),
  };
}

function verdictOf(input: {
  rows: YieldMeasure[];
  timeout?: YieldMeasure;
  realYield: YieldMeasure | null;
  hidden: boolean;
}): string {
  const { timeout, realYield, hidden } = input;

  if (hidden) {
    return 'Вкладка была скрыта, и браузер душил таймеры: `setTimeout` в фоне срабатывает примерно раз в секунду. Числа выше про этот режим, а не про обычную работу страницы — вернитесь на вкладку и замерьте заново.';
  }
  if (!timeout?.available || !realYield) {
    return 'Померить удалось не всё: часть способов в этой среде отсутствует. Сравнивать можно только те строки, у которых есть числа.';
  }
  if (realYield.key === 'timeout') {
    return `\`setTimeout(0)\` оказался не дороже остальных: ${fmtRate(timeout.perSecond)} уступок в секунду. Так бывает там, где правила четырёх миллисекунд нет вовсе — например в Node. Правило от этого не исчезает: оно про браузер, и в браузере эта строка выглядит иначе.`;
  }

  const times = timeout.perYieldMs / realYield.perYieldMs;
  return `\`setTimeout(0)\` — ${fmtRate(timeout.perSecond)} уступок в секунду против ${fmtRate(
    realYield.perSecond,
  )} у \`${realYield.label}\`: **в ${fmtRatio(times)} раз дороже**. Провал не случайный и не про быстродействие машины: чанкер ставит таймер из коллбэка предыдущего таймера, вложенность растёт, и с шестого уровня заказанный ноль по правилу HTML Standard становится четвёркой. Именно она и стоит здесь потолком.`;
}

// ---------------------------------------------------------------------------
// Показ чисел
// ---------------------------------------------------------------------------

/**
 * Цена одной уступки к показу.
 *
 * ⚠️ **Микросекунды здесь законны, наносекунды — нет, и разница не в числе знаков.**
 * `performance.now()` в браузере огрублён из-за Spectre до сотен микросекунд, поэтому померить
 * так **одну** уступку нельзя вовсе. Но здесь показывается не одна, а среднее по сотням тысяч
 * оборотов за окно в треть секунды: делится длинный, хорошо измеренный отрезок на большое
 * целое число, и микросекунда в частном обеспечена. Наносекунда — уже нет: на таком масштабе
 * её съедает разброс между прогонами, и третий знак был бы украшением.
 *
 * ⚠️ Первая версия этой функции писала «< 0.01 мс» всему, что дешевле сотой доли миллисекунды,
 * — и колонка умерла: три способа из четырёх получали одну и ту же строку, хотя отличаются
 * впятеро. Огрубление тоже умеет врать, просто в другую сторону.
 *
 * Функцией, а не выражением в шаблоне: `<` внутри `{{ }}` разбирается парсером разметки
 * и ломается молча.
 */
export function fmtCost(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  if (ms >= 1) return `${ms.toFixed(ms < 10 ? 2 : 1)} мс`;
  if (ms >= 0.01) return `${ms.toFixed(2)} мс`;

  const us = ms * 1000;
  return us < 0.1 ? '< 0.1 мкс' : `${us.toFixed(1)} мкс`;
}

/** Уступок в секунду — разряды пробелом. Свой формат, а не `toLocaleString`: без ICU. */
export function fmtRate(perSecond: number): string {
  if (!Number.isFinite(perSecond) || perSecond <= 0) return '—';
  const rounded = perSecond >= 1000 ? Math.round(perSecond / 10) * 10 : Math.round(perSecond);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * Кратность: «0.02», «1», «17», «1 600». Дробь только там, где она что-то значит.
 *
 * Меньше единицы здесь законно и встречается ровно у одной строки — у микрозадачи, которая
 * ничего не уступает. Округлять такое до «0» нельзя: ноль читался бы как «бесплатно».
 */
export function fmtRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return '—';
  if (ratio < 0.01) return '< 0.01';
  if (ratio < 10) return ratio.toFixed(ratio < 1 ? 2 : 1).replace(/\.0+$/, '');
  return fmtRate(ratio);
}

/** Миллисекунды окна — одним знаком. */
export function fmtSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  return `${ms.toFixed(1)} мс`;
}
