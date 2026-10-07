import type { TimerKey, TimerLevel, TimerMark, TimerParams, TimerRun, TimerScenario, TimerValue } from './types';

/**
 * Три обещания `setTimeout`, проверенные секундомером, а не пересказом спецификации.
 *
 * Раньше на этом месте стояла нарисованная лесенка: девять плашек, у которых миллисекунды
 * выводились формулой `level > 5 ? '4 мс' : '0 мс'`. Формула верна — и ровно поэтому её нельзя
 * было там держать: она повторяла текст HTML Standard своими словами, а читателю показывала
 * картинку, неотличимую от настоящего замера. Правило курса на этот счёт прямое
 * (`AGENTS.md`, «Таблицу о поведении языка не набирают — её вычисляют», приписка «остров
 * с переключателем — ещё не вычисление»): если в слайсе нет модели, которая зовёт движок,
 * демо пересказывает данные.
 *
 * Здесь чистые функции без DOM и без Vue: каждая ставит настоящие таймеры, замечает
 * `performance.now()` до и после и возвращает то, что получилось. Компонент только показывает,
 * а юнит-тест импортирует **этот же** модуль — и потому проверяет ровно то, что видит читатель.
 *
 * ⚠️ **Что здесь нормативно, а что нет.** Нормативен факт: вложенность глубже пятого уровня
 * перестаёт быть бесплатной, потому что спецификация разрешает движку поднять запрошенный
 * ноль. Ненормативна величина: «4 мс» — верхняя граница правила из HTML Standard, а сколько
 * выйдет на этой машине под этой нагрузкой, не обещает никто. Поэтому функции ничего не
 * утверждают про конкретные миллисекунды: они их измеряют и складывают рядом с заказанными.
 *
 * ⚠️ **Цена деления.** Без cross-origin isolation браузер грубит `performance.now()` до сотен
 * микросекунд — тот же ответ на Spectre, что выключает `SharedArrayBuffer`. На нулевых
 * задержках это видно: числа ступенчатые. На фоне четырёх миллисекунд клампа роли не играет.
 *
 * ⚠️ **Среды может не быть.** Остров сперва рендерится в Node, а модуль читает и юнит-тест,
 * поэтому `performance` и таймеры спрашиваются **внутри** функций, и на их отсутствие
 * предусмотрен честный пустой результат вместо падения.
 *
 * ⚠️ **В Node лесенка выглядит иначе, и это не поломка.** Правила четырёх миллисекунд там нет
 * вовсе, а `0` приводится к `1`. Тест, запущенный в Node, вправе закреплять только отношение
 * («глубокие уровни не дешевле мелких») — но не число.
 */

/** Длина цепочки вложенных таймеров по умолчанию: пять «бесплатных» уровней и пять за ними. */
export const DEPTH = 10;

/**
 * Уровень, после которого начинается клампинг.
 *
 * Из алгоритма HTML Standard: `если nesting level > 5 и timeout < 4 → timeout = 4`. Число
 * взято из спецификации, а не из замера, и служит только разметкой таблицы — какие строки
 * сравнивать с какими. Сами миллисекунды в обеих половинах меряются.
 */
export const CLAMP_AFTER_LEVEL = 5;

/** Верхняя граница правила из спецификации, мс. Показывается как ориентир, не как результат. */
export const CLAMP_MS = 4;

/**
 * Первый уровень цепочки, чья задержка уже поднята, — **седьмой, а не шестой**.
 *
 * ⚠️ Прежняя нарисованная лесенка красила шестой (`level > 5`), и замер это опроверг: у шестого
 * уровня задержка стабильно нулевая. Ошибки в спецификации нет — есть разница между «вложенностью
 * колбэка» и «номером уровня». Решение о клампе принимается **в момент вызова** `setTimeout`,
 * по вложенности того колбэка, изнутри которого зовут: шестой колбэк ставит таймер, находясь
 * на пятой вложенности, а `5 > 5` — ложь. Поэтому поднимается задержка только у седьмого.
 *
 * Это ровно тот случай, ради которого демо и переписано: картинка повторяла правило словами
 * и ошибалась на единицу, а таблица, снятая секундомером, ошибиться не может.
 */
export const FIRST_CLAMPED_LEVEL = CLAMP_AFTER_LEVEL + 2;

const DEFAULTS = {
  depth: DEPTH,
  requested: 50,
  busyMs: 120,
  period: 10,
  spanMs: 300,
} as const;

/** Сколько миллисекунд поток занят одним куском работы в сценарии с интервалом. */
const CHUNK_MS = 40;

/** Больше фишек в консоли не помещается, да и не нужно: разрыв виден на первых же. */
const MARK_LIMIT = 24;

/** Есть ли чем мерить. Спрашивается внутри функций: на уровне модуля это уронило бы сборку. */
const measurable = (): boolean =>
  typeof performance !== 'undefined' &&
  typeof performance.now === 'function' &&
  typeof setTimeout === 'function';

/** Миллисекунды к показу. Ниже цены деления часов пишем «< 0.1», а не выдуманный ноль. */
const ms = (value: number): string => (value < 0.05 ? '< 0.1 мс' : `${value.toFixed(1)} мс`);

const average = (list: number[]): number =>
  list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;

/**
 * Занять поток настоящей работой на `ms` миллисекунд.
 *
 * Счётчик оборотов возвращается наружу намеренно: цикл, ничего не возвращающий, движок вправе
 * счесть мёртвым кодом — и тогда «занятый поток» окажется не занят ничем.
 */
function burn(duration: number): number {
  const until = performance.now() + duration;
  let spins = 0;
  while (performance.now() < until) spins += 1;
  return spins;
}

/** Отдать управление циклу событий: накопившиеся колбэки выполнятся именно здесь. */
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Дождаться задачи, **не порождённой таймером**, — и только потом начинать цепочку.
 *
 * ⚠️ Калибровка прибора, а не украшение, и нужда в ней найдена запуском. Два вызова
 * `runNesting()` подряд дают вторую лесенку, у которой клампятся **все десять** уровней,
 * включая первый. Движок тут ни при чём: `await` возвращает управление микрозадачей внутри
 * той же задачи таймера, а у неё вложенность уже шестая — и новая цепочка продолжает
 * предыдущую вместо того, чтобы начаться с нуля. Ровно так же соврал бы замер, запущенный
 * из колбэка чужого таймера.
 *
 * Сообщение через `MessageChannel` — задача другого источника: на ней вложенность нулевая,
 * и лесенка меряется от начала независимо от того, откуда её позвали.
 */
function fromFreshTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** Мерить нечем — говорим это прямо, вместо того чтобы показать нарисованные числа. */
function unmeasured(key: TimerKey): TimerRun {
  return {
    key,
    measured: false,
    levels: [],
    values: [],
    marks: [],
    tone: 'warn',
    verdict:
      'В этой среде нет ни `performance.now()`, ни таймеров — мерить нечем. Числа в этом демо снимаются на вашей машине, поэтому показать вместо них заготовку было бы подделкой.',
  };
}

/**
 * Лесенка вложенности: цепочка `setTimeout(…, 0)`, где каждый следующий ставится из колбэка
 * предыдущего.
 *
 * Замеряется промежуток от вызова `setTimeout` до входа в колбэк — то есть ровно то, что
 * обещает второй аргумент. Кламится именно **вложенность**: тысяча независимых таймеров,
 * поставленных из одного обработчика, останется на первом уровне и подорожать не может.
 */
export async function runNesting(depth: number = DEFAULTS.depth): Promise<TimerRun> {
  if (!measurable()) return unmeasured('nesting');
  await fromFreshTask();

  const levels = await new Promise<TimerLevel[]>((resolve) => {
    const collected: TimerLevel[] = [];

    const schedule = () => {
      const asked = performance.now();
      setTimeout(() => {
        const actual = performance.now() - asked;
        const level = collected.length + 1;
        collected.push({ level, requested: 0, actual, clamped: level >= FIRST_CLAMPED_LEVEL });
        if (collected.length >= depth) resolve(collected);
        else schedule();
      }, 0);
    };

    schedule();
  });

  const flat = levels.filter((item) => !item.clamped).map((item) => item.actual);
  const deep = levels.filter((item) => item.clamped).map((item) => item.actual);
  const flatAvg = average(flat);
  const deepAvg = average(deep);
  const total = levels.reduce((sum, item) => sum + item.actual, 0);
  const grew = deep.length > 0 && deepAvg > flatAvg + 0.5;

  const values: TimerValue[] = [
    { label: `в среднем на уровнях 1–${FIRST_CLAMPED_LEVEL - 1}`, value: ms(flatAvg), tone: 'ok' },
    {
      label: `в среднем на уровнях ${FIRST_CLAMPED_LEVEL}–${levels.length}`,
      value: ms(deepAvg),
      tone: grew ? 'warn' : 'ok',
    },
    { label: 'вся цепочка целиком', value: ms(total) },
    {
      label: 'просили у каждого таймера',
      value: '0 мс',
    },
  ];

  return {
    key: 'nesting',
    measured: true,
    levels,
    values,
    marks: [],
    tone: grew ? 'warn' : 'ok',
    verdict: grew
      ? `Первые ${FIRST_CLAMPED_LEVEL - 1} уровней прошли в среднем за ${ms(flatAvg)}, следующие — за ${ms(
          deepAvg,
        )}. Запрошенный ноль перестал быть нулём ровно там, где спецификация это разрешает: таймер, поставленный из колбэка с вложенностью больше ${CLAMP_AFTER_LEVEL}, получает уже не ноль. Величина — про эту машину и эту минуту, факт — про HTML Standard.`
      : `Разницы между мелкими и глубокими уровнями этот прогон не показал (${ms(flatAvg)} против ${ms(
          deepAvg,
        )}). Так бывает в средах без правила четырёх миллисекунд — например в Node, где клампа нет, а \`0\` просто приводится к \`1\`. Правило спецификации от этого не исчезает: оно про браузер.`,
  };
}

/**
 * Таймер — нижняя граница, а не обещание: заказ в 50 мс на занятом потоке.
 *
 * Таймер ставится первым, сразу за ним поток уходит в синхронный цикл. Колбэк не может
 * выполниться, пока цикл не отпустит поток, — и опоздание оказывается ровно тем, сколько
 * поток был занят сверх заказанного.
 */
export async function runBusy(
  requested: number = DEFAULTS.requested,
  busyMs: number = DEFAULTS.busyMs,
): Promise<TimerRun> {
  if (!measurable()) return unmeasured('busy');

  const started = performance.now();
  const fired = new Promise<number>((resolve) => {
    setTimeout(() => resolve(performance.now() - started), requested);
  });

  burn(busyMs);
  const blocked = performance.now() - started;
  const actual = await fired;
  const late = actual - requested;

  return {
    key: 'busy',
    measured: true,
    levels: [],
    values: [
      { label: 'запрошено', value: `${requested} мс` },
      { label: 'поток был занят', value: ms(blocked), tone: 'warn' },
      { label: 'колбэк получил управление через', value: ms(actual), tone: 'warn' },
      { label: 'опоздание', value: ms(Math.max(late, 0)), tone: late > 1 ? 'err' : 'ok' },
    ],
    marks: [],
    tone: late > 1 ? 'warn' : 'ok',
    verdict:
      late > 1
        ? `Заказ был на ${requested} мс, управление пришло через ${ms(
            actual,
          )}: опоздание ${ms(late)}. Срок таймера истёк вовремя — но колбэк это **задача**, а задачу некуда поставить, пока поток занят. Второй аргумент \`setTimeout\` означает «не раньше чем», и другого обещания там нет.`
        : `Поток освободился раньше срока, и таймер сработал почти вовремя (${ms(
            actual,
          )} против заказанных ${requested} мс). Обещания «ровно через» это всё равно не даёт: опоздание появляется ровно тогда, когда занят поток.`,
  };
}

/**
 * `setInterval` не догоняет пропущенное.
 *
 * Интервал в 10 мс на фоне занятости. Спецификация не копит пропущенные срабатывания: пока
 * поток занят, очередной колбэк просто не случается, а следующий отсчёт начинается после того,
 * как предыдущий отработал. За окно наблюдения срабатываний выходит заметно меньше, чем
 * «длина окна делить на период», — и разрывы между ними видно поимённо.
 *
 * Поток занимается кусками по `CHUNK_MS` с отдачей управления между ними: если занять его
 * целиком, интервал не сработает ни разу и мерить будет нечего.
 */
export async function runInterval(
  period: number = DEFAULTS.period,
  spanMs: number = DEFAULTS.spanMs,
): Promise<TimerRun> {
  if (!measurable()) return unmeasured('interval');

  const started = performance.now();
  const gaps: number[] = [];
  let previous = started;
  let fired = 0;

  const id = setInterval(() => {
    const now = performance.now();
    gaps.push(now - previous);
    previous = now;
    fired += 1;
  }, period);

  while (performance.now() - started < spanMs) {
    burn(CHUNK_MS);
    await yieldToLoop();
  }
  clearInterval(id);

  const elapsed = performance.now() - started;
  const expected = Math.floor(elapsed / period);
  const missed = Math.max(expected - fired, 0);
  const longest = gaps.length ? Math.max(...gaps) : 0;

  const marks: TimerMark[] = gaps
    .slice(0, MARK_LIMIT)
    .map((gap) => ({ text: ms(gap), late: gap > period * 2 }));
  if (gaps.length > MARK_LIMIT) marks.push({ text: `…ещё ${gaps.length - MARK_LIMIT}`, late: false });

  return {
    key: 'interval',
    measured: true,
    levels: [],
    values: [
      { label: 'период', value: `${period} мс` },
      { label: 'окно наблюдения', value: ms(elapsed) },
      { label: 'ожидалось срабатываний', value: String(expected) },
      { label: 'случилось на самом деле', value: String(fired), tone: missed ? 'err' : 'ok' },
      { label: 'не случилось вовсе', value: String(missed), tone: missed ? 'warn' : 'ok' },
      { label: 'самый длинный промежуток', value: ms(longest), tone: 'warn' },
    ],
    marks,
    tone: missed ? 'warn' : 'ok',
    verdict: missed
      ? `За ${ms(elapsed)} при периоде ${period} мс помещалось бы ${expected} срабатываний, а случилось ${fired}: ${missed} не произошло **никогда**. Пропущенное не копится и не догоняется — пока поток занят, очередного колбэка просто не бывает. Поэтому счётчик, сделанный на \`setInterval\`, отстаёт от часов, а не «дёргается».`
      : `Поток успевал освобождаться, и все ${fired} срабатываний уместились в окно. Гарантии здесь всё равно нет: пропущенные интервалы не копятся, и на занятом потоке та же строка потеряет часть срабатываний.`,
  };
}

/**
 * Точный алгоритм из HTML Standard — он же листинг сценария с лесенкой.
 *
 * Оставлен дословно из прежней иллюстрации: это цитата спецификации, а не результат, и
 * вычислять её незачем. Всё, что ниже в демо, — проверка этой цитаты замером.
 */
const ALGORITHM = [
  'nesting level нового таймера = (мы внутри коллбэка таймера)',
  '                               ? nesting level текущего + 1',
  '                               : 0            ← вызов с верхнего уровня',
  '',
  'если nesting level > 5  и  timeout < 4   →   timeout = 4',
];

/** Сценарии в порядке переключателя. Код — тот же, который исполняют функции выше. */
export const SCENARIOS: TimerScenario[] = [
  {
    key: 'nesting',
    label: 'лесенка вложенности',
    title: 'Цепочка `setTimeout(…, 0)`: где ноль перестаёт быть нулём',
    lead: 'Каждый следующий таймер ставится из колбэка предыдущего. Все просят ноль — а получают разное, и граница проходит там, где её ставит спецификация.',
    code: [
      ...ALGORITHM,
      '',
      'const asked = performance.now();',
      'setTimeout(() => {',
      '  const actual = performance.now() - asked;   // ← это и печатается в таблице',
      '  schedule();                                 // следующий уровень вложенности',
      '}, 0);',
    ],
    caveat:
      'Нормативен здесь **факт**, а не число: спецификация разрешает движку поднять задержку, когда вложенность больше пяти, и называет границу в 4 мс. Сколько выйдет в вашем браузере под вашей нагрузкой — не обещает никто, поэтому в таблице настоящий замер, а не эта четвёрка.',
    notes: [
      '**Тысяча независимых `setTimeout(f, 0)` из одного обработчика клика не кламится** — у каждого уровень 1. Кламится именно рекурсия.',
      'Отсюда практический потолок «цикла на таймерах»: **около 250 итераций в секунду**. Без правила такая рекурсия жгла бы CPU в полку и не давала циклу дойти до простоя.',
      '**В Node правила четырёх миллисекунд нет**, но `0` приводится к 1 мс. Поэтому рекурсивный `setTimeout(f, 0)` там крутится вчетверо быстрее и легко превращается в незаметный сжигатель CPU.',
    ],
  },
  {
    key: 'busy',
    label: 'занятый поток',
    title: 'Таймер — нижняя граница, а не обещание',
    lead: 'Таймер на 50 мс поставлен первым, сразу за ним поток уходит в синхронный цикл на 120 мс. Срок истечёт вовремя — а выполниться колбэку негде.',
    code: [
      'const started = performance.now();',
      '',
      'setTimeout(() => {',
      '  actual = performance.now() - started;   // когда нас позвали на самом деле',
      '}, 50);',
      '',
      '// поток занят настоящей работой — колбэку некуда встать',
      'while (performance.now() < started + 120) spins += 1;',
    ],
    caveat:
      'Здесь измеряется не движок, а расписание: величина опоздания равна тому, сколько поток был занят. На вашей машине цикл отработает за своё время, и числа будут свои — неизменно только правило «не раньше чем».',
    notes: [
      'Срок таймера и вызов колбэка — **разные события**. Первое наступает вовремя; второе ждёт, пока освободится единственный поток.',
      'Отсюда обычная ошибка измерений: время, снятое внутри колбэка `setTimeout`, включает чужую работу, которая шла всё это время.',
    ],
  },
  {
    key: 'interval',
    label: 'setInterval',
    title: '`setInterval` не досчитывает',
    lead: 'Интервал в 10 мс на фоне занятости. Вопрос ровно один: сколько раз он успеет сработать за окно — и куда денутся остальные срабатывания.',
    code: [
      'const id = setInterval(() => {',
      '  fired += 1;                       // и запоминаем промежуток от прошлого раза',
      '}, 10);',
      '',
      '// поток занимается кусками по 40 мс с отдачей управления между ними',
      'while (performance.now() - started < 300) {',
      '  burn(40);',
      '  await new Promise((r) => setTimeout(r, 0));',
      '}',
      'clearInterval(id);',
    ],
    caveat:
      'Пропущенные срабатывания не копятся — это поведение платформы, а не случайность этого прогона. Сколько именно потеряется, зависит от нагрузки: числа ниже сняты только что, в этой вкладке.',
    notes: [
      '`setInterval` отсчитывает следующий срок **после** того, как предыдущий колбэк отработал, — поэтому длинный колбэк растягивает интервал, а не догоняет расписание.',
      'Счётчик времени, построенный на числе срабатываний, отстаёт от часов тем сильнее, чем занятее поток. Считать надо по `Date.now()`, а не по количеству тиков.',
    ],
  },
];

/** Выполнить сценарий по ключу. Параметры задаёт автор темы; без них берутся значения курса. */
export function runScenario(key: TimerKey, params: TimerParams = {}): Promise<TimerRun> {
  if (key === 'busy') return runBusy(params.requested ?? DEFAULTS.requested, params.busyMs ?? DEFAULTS.busyMs);
  if (key === 'interval') return runInterval(params.period ?? DEFAULTS.period, params.spanMs ?? DEFAULTS.spanMs);
  return runNesting(params.depth ?? DEFAULTS.depth);
}
