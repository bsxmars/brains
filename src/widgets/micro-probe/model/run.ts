import type {
  ErrorChannel,
  ErrorRow,
  ErrorRun,
  MechanismRow,
  OrderRun,
  QueueVerdict,
  StarvationRun,
  Tone,
  WhoRun,
} from './types';

/**
 * Микрозадачи, проверенные движком, а не набранные руками.
 *
 * В теме «Цикл событий» это место было двумя таблицами: `MICRO_ROWS` («`.then` — да,
 * `requestAnimationFrame` — нет») и `QM_ROWS` («бросок из `queueMicrotask` уходит в `error`,
 * бросок из `.then` — в `unhandledrejection`»). Всё это, кроме числа создаваемых объектов,
 * наблюдаемо прямо в браузере читателя, а значит держать это литералом нельзя (`AGENTS.md`,
 * «Таблицу о поведении языка не набирают — её вычисляют»).
 *
 * Здесь чистые функции без DOM-разметки и без Vue: каждая ставит механизм по-настоящему,
 * собирает порядок вывода и возвращает то, что получилось. Компонент только показывает,
 * а юнит-тест импортирует **этот же** модуль — тогда страница с тестом разойтись не могут.
 *
 * ⚠️ **`window` и `document` — только внутри функций.** Остров сперва рендерится в Node,
 * и обращение к среде на верхнем уровне уронило бы сборку всей страницы, а не демо.
 * Поэтому наличие каждого механизма проверяется в момент прогона, по одному, и отсутствие
 * честно доезжает до экрана вердиктом `absent`, а не подменяется знанием.
 *
 * ⚠️ **Свежее состояние на каждый прогон.** Ни один объект между прогонами не живёт:
 * наблюдатели отключаются, таймеры снимаются, слушатели окна снимаются в `finally`.
 * Повторный клик обязан давать тот же результат — иначе демо начнёт врать со второго раза.
 */

/** Часы демо. `performance.now()` есть и в браузере, и в Node; `Date.now()` — запасной. */
const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Дождаться следующей задачи: всё, что страница успела накопить, сливается до нашей постановки. */
const nextTask = (): Promise<void> => delay(0);

const NOOP = (): void => undefined;

/**
 * `process.nextTick`, если он есть.
 *
 * Читается через `globalThis`, а не как голый `process`: в клиентской сборке голого имени нет,
 * и обращение к нему было бы `ReferenceError`. В браузере здесь `null`, в юнит-тесте — настоящий
 * `nextTick`, и строка про него становится настоящим замером, а не пересказом.
 */
const NODE_TICK = ((): ((fn: () => void) => void) | null => {
  const proc = (globalThis as { process?: { nextTick?: (fn: () => void) => void } }).process;
  return typeof proc?.nextTick === 'function' ? proc.nextTick.bind(proc) : null;
})();

const MARK_1 = 'маркер 1';
const MARK_2 = 'маркер 2';

export const VERDICT_LABEL: Record<QueueVerdict, string> = {
  micro: 'микрозадача',
  ahead: 'своя очередь, раньше микрозадач',
  after: 'не микрозадача',
  absent: 'нет в этой среде',
  unknown: 'не сработал за отведённое время',
};

export const CHANNEL_LABEL: Record<ErrorChannel, string> = {
  error: "событие 'error' у окна",
  unhandledrejection: "событие 'unhandledrejection'",
  both: 'оба события сразу',
  none: 'ни одного события',
};

/* ------------------------------------------------------------------ *
 * 1. Кто микрозадача, а кто нет
 * ------------------------------------------------------------------ */

interface Mechanism {
  key: string;
  label: string;
  title: string;
  code: string;
  claimed: QueueVerdict;
  why: string;
  /** Сколько ждать колбэка. Кадру и наблюдателям нужен шаг рендера — им дают больше. */
  waitMs: number;
  available: (host: HTMLElement | null) => boolean;
  /** Поставить механизм так, чтобы он позвал `hit`. Возвращает уборщик. */
  arm: (hit: () => void, host: HTMLElement | null) => () => void;
}

/**
 * Механизмы в порядке строк урока: сперва те, что таблица зовёт микрозадачами, потом остальные.
 *
 * `claimed` у каждого — то, что написано в `MICRO_ROWS`. Перенос осознанный и ровно один:
 * без него расхождение с движком было бы не видно, а сверять его глазами — то же самое, что
 * держать таблицу литералом.
 *
 * ⚠️ Строка `process.nextTick` — единственная, где перенос потребовал решения. В `MICRO_ROWS`
 * у неё стоит `ok: false`, но объяснение рядом говорит другое: «отдельная очередь с приоритетом
 * ВЫШЕ промисов». Булева колонка не различает «не микрозадача» и «микрозадача, но в очереди
 * поперёд всех», и здесь перенесён смысл объяснения — `ahead`, — а не флажок.
 */
const MECHANISMS: Mechanism[] = [
  {
    key: 'then',
    label: '.then',
    title: '`.then` у уже выполненного промиса',
    code: 'Promise.resolve().then(hit);',
    claimed: 'micro',
    why: 'Реакция ставится в очередь в момент резолва. Промис уже выполнен — значит прямо сейчас.',
    waitMs: 60,
    available: () => true,
    arm: (hit) => {
      void Promise.resolve().then(hit);
      return NOOP;
    },
  },
  {
    key: 'await',
    label: 'после await',
    title: 'продолжение после `await`',
    code: 'void (async () => { await null; hit(); })();',
    claimed: 'micro',
    why: '`await` — сахар над реакцией промиса: продолжение функции и есть та самая микрозадача.',
    waitMs: 60,
    available: () => true,
    arm: (hit) => {
      void (async () => {
        await null;
        hit();
      })();
      return NOOP;
    },
  },
  {
    key: 'queueMicrotask',
    label: 'queueMicrotask',
    title: '`queueMicrotask(fn)`',
    code: 'queueMicrotask(hit);',
    claimed: 'micro',
    why: 'Прямой доступ к той же очереди, без промиса-посредника.',
    waitMs: 60,
    available: () => typeof queueMicrotask === 'function',
    arm: (hit) => {
      queueMicrotask(hit);
      return NOOP;
    },
  },
  {
    key: 'mutationObserver',
    label: 'MutationObserver',
    title: '`MutationObserver`',
    code: "observer.observe(node, { childList: true });\nnode.append(document.createTextNode('…'));",
    claimed: 'micro',
    why: 'Записи копятся, а доставка ставится в микроочередь в момент первой же мутации.',
    waitMs: 120,
    // Отсоединённого узла достаточно: наблюдателю мутаций отрисованный бокс не нужен.
    available: () => typeof document !== 'undefined' && typeof MutationObserver === 'function',
    arm: (hit) => {
      const node = document.createElement('div');
      const observer = new MutationObserver(() => hit());
      observer.observe(node, { childList: true });
      node.append(document.createTextNode('мутация'));
      return () => observer.disconnect();
    },
  },
  {
    key: 'resizeObserver',
    label: 'ResizeObserver',
    title: '`ResizeObserver`',
    code: 'new ResizeObserver(hit).observe(node);',
    claimed: 'after',
    why: 'Доставка живёт в шагах рендера: наблюдения собираются после раскладки, а не в микроочереди.',
    waitMs: 600,
    // ⚠️ Отрисованный узел обязателен: элемент без CSS-бокса наблюдатель пропускает молча.
    available: (host) => host !== null && typeof ResizeObserver === 'function',
    arm: (hit, host) => {
      const observer = new ResizeObserver(() => hit());
      if (host) observer.observe(host);
      return () => observer.disconnect();
    },
  },
  {
    key: 'intersectionObserver',
    label: 'IntersectionObserver',
    title: '`IntersectionObserver`',
    code: 'new IntersectionObserver(hit).observe(node);',
    claimed: 'after',
    why: 'Пересечения считаются там же, в шагах рендера, и первая доставка ждёт ближайшего из них.',
    waitMs: 600,
    available: (host) => host !== null && typeof IntersectionObserver === 'function',
    arm: (hit, host) => {
      const observer = new IntersectionObserver(() => hit());
      if (host) observer.observe(host);
      return () => observer.disconnect();
    },
  },
  {
    key: 'raf',
    label: 'requestAnimationFrame',
    title: '`requestAnimationFrame`',
    code: 'requestAnimationFrame(hit);',
    claimed: 'after',
    why: 'Это элемент списка коллбэков кадра, а не очереди: «непосредственно перед отрисовкой».',
    waitMs: 600,
    available: () => typeof requestAnimationFrame === 'function',
    arm: (hit) => {
      const id = requestAnimationFrame(() => hit());
      return () => cancelAnimationFrame(id);
    },
  },
  {
    key: 'timeout',
    label: 'setTimeout 0',
    title: '`setTimeout(…, 0)`',
    code: 'setTimeout(hit, 0);',
    claimed: 'after',
    why: 'Задача, а не микрозадача: её берут следующим оборотом цикла, когда очередь уже пуста.',
    waitMs: 250,
    available: () => true,
    arm: (hit) => {
      const id = setTimeout(hit, 0);
      return () => clearTimeout(id);
    },
  },
  {
    key: 'nextTick',
    label: 'process.nextTick',
    title: 'в Node: `process.nextTick`',
    code: 'process.nextTick(hit);',
    claimed: 'ahead',
    why: 'Отдельная очередь с приоритетом выше микрозадач: она сливается целиком до промисов.',
    waitMs: 60,
    available: () => NODE_TICK !== null,
    arm: (hit) => {
      NODE_TICK?.(hit);
      return NOOP;
    },
  },
];

/**
 * Узел для наблюдателей размера и пересечения.
 *
 * ⚠️ Он обязан **участвовать в раскладке**, иначе `ResizeObserver` пропустит его как элемент
 * без CSS-бокса, и демо получило бы «не сработал» там, где механизм просто не позвали.
 * Поэтому не `display:none` и не отсоединённый узел, а настоящие 8×8 с нулевой прозрачностью,
 * вне потока и без реакции на указатель. Убирается сразу после прогона.
 */
function makeHost(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-micro-probe', 'host');
  host.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;opacity:0;pointer-events:none;';
  document.body.append(host);
  return host;
}

/** Порядок трёх событий → вердикт. Расшифровка трёх исходов — в докстринге `QueueVerdict`. */
function classify(order: string[], label: string): QueueVerdict {
  const self = order.indexOf(label);
  if (self < 0) return 'unknown';

  const first = order.indexOf(MARK_1);
  const second = order.indexOf(MARK_2);
  if (first < 0 || second < 0) return 'unknown';

  if (self < first) return 'ahead';
  return self < second ? 'micro' : 'after';
}

function noteFor(verdict: QueueVerdict, waitedMs: number): string {
  switch (verdict) {
    case 'micro':
      return 'Выполнился **между** маркерами — в той же очереди и строго в порядке постановки.';
    case 'ahead':
      return 'Выполнился **раньше** первого маркера, хотя поставлен позже него. Одной очереди с микрозадачами тут нет: это отдельная очередь, и обслуживают её первой.';
    case 'after':
      return 'Выполнился **после обоих** маркеров: очередь микрозадач успела опустеть раньше. Значит это не микрозадача.';
    case 'unknown':
      return `За ${waitedMs.toFixed(0)} мс колбэка не было. В микроочередь он точно не попал; чаще всего так выглядит вкладка без шагов рендера — кадра нет, и коллбэка не будет, сколько ни ждать.`;
    case 'absent':
      return 'Механизма в этой среде нет — проверять нечего, и выдумывать ответ за него тоже.';
  }
}

function toneFor(verdict: QueueVerdict, agrees: boolean): Tone {
  if (verdict === 'absent') return 'dim';
  if (verdict === 'unknown') return 'warn';
  return agrees ? 'ok' : 'err';
}

/**
 * Один механизм: два маркера и он сам.
 *
 * Маркер ставится дважды не для красоты. Один `queueMicrotask` **до** постановки и один
 * **после** дают три различимых исхода вместо двух: «между маркерами» — та же очередь,
 * «раньше первого» — чужая очередь поперёд микрозадач, «после второго» — вовсе не микрозадача.
 * Булевой колонкой «да/нет» второй и третий случай неразличимы, и именно на этом месте
 * таблица урока и теряет `process.nextTick`.
 */
async function probeMechanism(mechanism: Mechanism, host: HTMLElement | null): Promise<MechanismRow> {
  const base = {
    key: mechanism.key,
    label: mechanism.label,
    title: mechanism.title,
    code: mechanism.code,
    claimed: mechanism.claimed,
    why: mechanism.why,
  };

  if (!mechanism.available(host)) {
    return {
      ...base,
      verdict: 'absent',
      comparable: false,
      agrees: false,
      order: [],
      waitedMs: 0,
      note: noteFor('absent', 0),
      tone: 'dim',
    };
  }

  const order: string[] = [];
  let live = true;
  let settle: () => void = NOOP;
  const fired = new Promise<void>((resolve) => {
    settle = resolve;
  });

  let cleanup: () => void = NOOP;
  let started = 0;

  /**
   * ⚠️ Постановка идёт из тела **задачи**, а не из продолжения `await`, — и это не гигиена,
   * а условие правильного ответа. Найдено запуском: продолжение `await` выполняется тогда,
   * когда микроочередь уже сливается, и в такой позиции `process.nextTick` в Node срабатывает
   * ПОСЛЕ обоих маркеров — движок берётся за очередь тиков, только когда микроочередь
   * опустела. Тот же код, поставленный из тела задачи, даёт обратный порядок: тик раньше
   * обоих маркеров, ровно как и говорит урок. Заодно это и чистый оборот — чужие микрозадачи
   * страницы сливаются до нашей постановки и в наш порядок не попадают.
   */
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      started = now();
      queueMicrotask(() => {
        if (live) order.push(MARK_1);
      });
      cleanup = mechanism.arm(() => {
        if (!live) return;
        order.push(mechanism.label);
        settle();
      }, host);
      queueMicrotask(() => {
        if (live) order.push(MARK_2);
      });
      resolve();
    }, 0);
  });

  await Promise.race([fired, delay(mechanism.waitMs)]);
  const waitedMs = now() - started;

  // Опоздавший колбэк в уже прочитанный порядок не пишет: иначе строка менялась бы после показа.
  live = false;
  cleanup();

  const verdict = classify(order, mechanism.label);
  const comparable = verdict !== 'absent' && verdict !== 'unknown';
  const agrees = comparable && verdict === mechanism.claimed;

  return {
    ...base,
    verdict,
    comparable,
    agrees,
    order: [...order],
    waitedMs,
    note: noteFor(verdict, waitedMs),
    tone: toneFor(verdict, agrees),
  };
}

/**
 * Вся таблица «кто микрозадача» — по одному механизму за раз.
 *
 * Последовательно, а не пачкой: маркеры у всех общие по смыслу, и параллельный прогон
 * перемешал бы чужие колбэки в чужой порядок.
 */
export async function probeWho(): Promise<WhoRun> {
  const host = makeHost();
  try {
    const rows: MechanismRow[] = [];
    for (const mechanism of MECHANISMS) {
      rows.push(await probeMechanism(mechanism, host));
    }
    return { rows, rendered: host !== null };
  } finally {
    host?.remove();
  }
}

/* ------------------------------------------------------------------ *
 * 2. Порядок: queueMicrotask против .then
 * ------------------------------------------------------------------ */

/**
 * Очередь одна, и она FIFO.
 *
 * `QM_ROWS` утверждает это строкой «строгий FIFO общей очереди» — проверяется постановкой
 * вперемешку. Заодно видно и второе: задача, поставленная **первой**, уходит последней,
 * а микрозадача, поставленная **изнутри** микрозадачи, успевает в тот же слив.
 */
export async function probeQueueOrder(): Promise<OrderRun> {
  await nextTask();

  const executed: string[] = [];
  const scheduled = ['qm 1', 'then 1', 'qm 2', 'then 2'];

  const finished = new Promise<void>((resolve) => {
    // Задача ставится ПЕРВОЙ — и всё равно окажется последней.
    setTimeout(() => {
      executed.push('задача');
      resolve();
    }, 0);
  });

  queueMicrotask(() => executed.push('qm 1'));
  void Promise.resolve().then(() => executed.push('then 1'));
  queueMicrotask(() => executed.push('qm 2'));
  void Promise.resolve().then(() => {
    executed.push('then 2');
    // Микрозадача изнутри микрозадачи: попадёт в хвост того же слива, а не следующего оборота.
    queueMicrotask(() => executed.push('qm 3 · вложенная'));
  });

  await finished;

  const micro = executed.filter((item) => scheduled.includes(item));
  const fifo = micro.join(' → ') === scheduled.join(' → ');
  const taskLast = executed[executed.length - 1] === 'задача';
  const nested = executed.indexOf('qm 3 · вложенная');
  const nestedInSameDrain = nested >= 0 && nested < executed.indexOf('задача');

  const tone: Tone = fifo && taskLast && nestedInSameDrain ? 'ok' : 'err';

  return {
    scheduled,
    executed: [...executed],
    fifo,
    taskLast,
    nestedInSameDrain,
    tone,
    note: fifo
      ? `Порядок выполнения совпал с порядком постановки до строчки: очередь **одна**, и приоритета у промисов над \`queueMicrotask\` нет. Задача, поставленная раньше всех четырёх, ушла последней${
          nestedInSameDrain
            ? ', а микрозадача, поставленная изнутри микрозадачи, успела в тот же слив — до неё.'
            : ', но вложенная микрозадача в тот же слив не попала — для этого сценария неожиданно.'
        }`
      : `Порядок выполнения разошёлся с порядком постановки: поставили \`${scheduled.join(' → ')}\`, выполнилось \`${micro.join(' → ')}\`. Это расходится с тем, что про эти два способа сказано в уроке.`,
  };
}

/* ------------------------------------------------------------------ *
 * 3. Канал ошибки
 * ------------------------------------------------------------------ */

/** Сколько ждать события. `unhandledrejection` проверяется в конце чекпоинта, но не мгновенно. */
const ERROR_WAIT = 400;

/**
 * Куда уходит бросок — пойманный настоящими слушателями окна.
 *
 * ⚠️ **Оба слушателя снимаются в `finally`, и оба гасят событие.** Демо не имеет права оставить
 * за собой ни висящего слушателя, ни красной строки в консоли читателя: `preventDefault()`
 * убирает отчёт браузера по умолчанию, `stopImmediatePropagation()` — чужие обработчики
 * страницы, которым эта ошибка не принадлежит.
 *
 * ⚠️ **Своя ошибка опознаётся по ссылке, а не по тексту.** На странице может быть чужое
 * исключение в ту же миллисекунду; сравнение `event.error === sentinel` не даёт зачесть
 * чужое за своё, и наоборот — чужое проходит мимо, не сняв нашего слушателя раньше времени.
 */
async function probeThrow(kind: 'queueMicrotask' | 'then'): Promise<{
  channel: ErrorChannel;
  errorName: string;
  errorText: string;
  waitedMs: number;
}> {
  const sentinel = new Error(
    kind === 'queueMicrotask' ? 'бросок внутри queueMicrotask' : 'бросок внутри .then',
  );
  sentinel.name = 'MicroProbeError';

  let channel: ErrorChannel = 'none';
  let errorName = '';
  let errorText = '';
  let settle: () => void = NOOP;
  const caught = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const remember = (next: ErrorChannel, failure: unknown) => {
    channel = channel === 'none' || channel === next ? next : 'both';
    const error = failure as { name?: string; message?: string };
    errorName = error?.name ?? 'Error';
    errorText = error?.message ?? String(failure);
    settle();
  };

  const onError = (event: ErrorEvent) => {
    if (event.error !== sentinel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    remember('error', event.error);
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    if (event.reason !== sentinel) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    remember('unhandledrejection', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  const started = now();
  try {
    if (kind === 'queueMicrotask') {
      queueMicrotask(() => {
        throw sentinel;
      });
    } else {
      // Ни одного `.catch`: ровно это и делает отказ необработанным.
      void Promise.resolve().then(() => {
        throw sentinel;
      });
    }
    await Promise.race([caught, delay(ERROR_WAIT)]);
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  }

  return { channel, errorName, errorText, waitedMs: now() - started };
}

const ERROR_CASES: { key: ErrorRow['key']; label: string; code: string[]; claimed: ErrorChannel; note: string }[] = [
  {
    key: 'queueMicrotask',
    label: 'бросок внутри `queueMicrotask`',
    code: ['queueMicrotask(() => {', "  throw new Error('…');", '});'],
    claimed: 'error',
    note: 'Промиса здесь нет вовсе, поэтому и отказывать нечему: исключение всплывает как обычное необработанное — событием `error` у окна, с обычным стеком.',
  },
  {
    key: 'then',
    label: 'бросок внутри `.then`',
    code: ['Promise.resolve().then(() => {', "  throw new Error('…');", '});', '// .catch не вешаем — в этом и опыт'],
    claimed: 'unhandledrejection',
    note: 'Бросок внутри реакции превращается в отказ **возвращённого** промиса. Его никто не слушает — и в конце чекпоинта движок сообщает об этом событием `unhandledrejection`.',
  },
];

/** Обе половины опыта. Порядок важен только для чтения: прогоны независимы. */
export async function probeErrorChannels(): Promise<ErrorRun> {
  if (typeof window === 'undefined') {
    return {
      supported: false,
      rows: [],
      note: 'Оба канала — события **окна**, и в этой среде окна нет. Проверять нечего: в Node бросок из микрозадачи не приходит событием, а роняет процесс.',
    };
  }

  const rows: ErrorRow[] = [];
  for (const item of ERROR_CASES) {
    const result = await probeThrow(item.key);
    const agrees = result.channel === item.claimed;
    rows.push({
      key: item.key,
      label: item.label,
      code: item.code,
      claimed: item.claimed,
      channel: result.channel,
      agrees,
      errorName: result.errorName,
      errorText: result.errorText,
      waitedMs: result.waitedMs,
      note:
        result.channel === 'none'
          ? `За ${result.waitedMs.toFixed(0)} мс не сработал ни один из двух слушателей. Так бывает, когда об ошибке сообщили раньше, чем демо успело подписаться.`
          : item.note,
      tone: result.channel === 'none' ? 'warn' : agrees ? 'ok' : 'err',
    });
  }

  return {
    supported: true,
    rows,
    note: 'Оба слушателя сняты, оба события погашены `preventDefault()` — в консоли читателя после этого прогона пусто.',
  };
}

/* ------------------------------------------------------------------ *
 * 4. Голодание микрозадачами
 * ------------------------------------------------------------------ */

/** Длина цепочки. Ограничена намеренно: демо обязано кончиться само, а не подвесить вкладку. */
export const STARVATION_STEPS = 1000;

/**
 * Работа одного шага. Настоящая арифметика, а не пауза: её результат читается и показывается.
 *
 * Число подобрано запуском: тысяча шагов по пять тысяч операций — это несколько десятков
 * миллисекунд занятости. Достаточно, чтобы задержка таймера была видна на фоне его
 * собственного округления до миллисекунды, и мало, чтобы вкладка не подвисла заметно.
 */
const STEP_WORK = 5_000;

/**
 * Цепочка микрозадач, каждая из которых ставит следующую.
 *
 * Таймер на 0 мс и кадр заказываются **до** старта цепочки — и оба ждут её конца. Это и есть
 * весь тезис урока: микрозадача откладывает код, но не отпускает поток.
 *
 * ⚠️ Цепочка **ограничена** и стек не растит: каждый шаг возвращается, следующий берётся
 * из очереди. Тысяча шагов по десять тысяч операций — десятки миллисекунд занятости, заметно
 * на шкале и безопасно для вкладки. Число шагов — параметр: тест вправе взять меньше.
 */
export async function probeStarvation(steps: number = STARVATION_STEPS): Promise<StarvationRun> {
  await nextTask();

  const hasFrames = typeof requestAnimationFrame === 'function';

  let checksum = 0;
  let done = 0;
  let chainEnd = 0;
  let timerAt = 0;
  let frameAt = 0;

  let settle: () => void = NOOP;
  const finished = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const started = now();
  const timer = setTimeout(() => {
    timerAt = now();
  }, 0);
  const frame = hasFrames
    ? requestAnimationFrame(() => {
        frameAt = now();
      })
    : null;

  const step = () => {
    for (let i = 0; i < STEP_WORK; i += 1) checksum = (checksum * 31 + i) >>> 0;
    done += 1;
    if (done < steps) {
      queueMicrotask(step);
      return;
    }
    chainEnd = now();
    settle();
  };

  queueMicrotask(step);
  await finished;

  // Продолжение `await` — тоже микрозадача, и к этой строке очередь только что опустела.
  // Отпускаем поток по-настоящему, чтобы таймер и кадр наконец получили управление.
  await delay(hasFrames ? 150 : 40);
  clearTimeout(timer);
  if (frame !== null) cancelAnimationFrame(frame);

  const busyMs = chainEnd - started;
  const timerDelayMs = timerAt > 0 ? timerAt - started : -1;
  const timerAfterChain = timerAt > 0 && timerAt >= chainEnd;
  const frameDelayMs = frameAt > 0 ? frameAt - started : null;
  const frameAfterChain = frameAt > 0 ? frameAt >= chainEnd : null;

  const log = [
    `цепочка: ${steps} микрозадач, каждая ставит следующую`,
    `поток был занят ${busyMs.toFixed(1)} мс подряд`,
    timerDelayMs < 0
      ? 'таймер на 0 мс так и не сработал за отведённое время'
      : `таймер на 0 мс, поставленный ДО цепочки, сработал через ${timerDelayMs.toFixed(1)} мс`,
    frameDelayMs === null
      ? hasFrames
        ? 'кадра не было: шагов рендера в этой вкладке не случилось'
        : 'кадров в этой среде нет вовсе — requestAnimationFrame недоступен'
      : `первый кадр — через ${frameDelayMs.toFixed(1)} мс после старта цепочки`,
    `контрольная сумма работы: ${checksum} (чтобы цикл нельзя было выбросить как ненужный)`,
  ];

  return {
    steps,
    busyMs,
    timerDelayMs,
    timerAfterChain,
    frameDelayMs,
    frameAfterChain,
    checksum,
    log,
    tone: timerAfterChain ? 'warn' : 'err',
    note: timerAfterChain
      ? `Таймер был поставлен **раньше** цепочки и на ноль миллисекунд — а получил управление только через ${timerDelayMs.toFixed(
          1,
        )} мс, когда очередь опустела. ${
          frameAfterChain === true
            ? `Кадр — тем же порядком: ${frameDelayMs?.toFixed(1)} мс. `
            : frameDelayMs === null
              ? 'Кадра за это время не случилось вовсе. '
              : ''
        }Цикл не выбирал между задачами: он до выбора просто не дошёл.`
      : `Таймер получил управление, не дожидаясь конца цепочки, — для этого сценария неожиданно. Скорее всего цепочка оборвалась раньше срока: шагов сделано ${done} из ${steps}.`,
  };
}
