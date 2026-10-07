import { createEmitter } from './emitter';
import type { DispatchKey, DispatchRound, DispatchRun, DispatchScenario, DispatchValue } from './types';

/**
 * Реентерантность, выполненная по-настоящему: колбэк вмешивается в чужой обход прямо здесь.
 *
 * В теме это место было набрано руками: две карточки с готовыми строками `'a → b → c'`
 * и `'a → c'` и три карточки с кодом, к которому дописан ответ комментарием («1, 2, 4 —
 * тройка пропущена»). Такое нельзя держать литералом (`AGENTS.md`, «Таблицу о поведении
 * языка не набирают — её вычисляют»): разовая сверка запуском не повторяется, и текст
 * расходится с движком молча.
 *
 * Поэтому здесь чистые функции без DOM и без Vue: каждая создаёт свой объект, выполняет
 * сценарий и возвращает то, что получилось. Компонент только показывает, а юнит-тест
 * импортирует **этот же** модуль и сверяет `summary` с литералами `data.ts`.
 *
 * ⚠️ **Две вещи демо доказать не может, и обе названы вслух.**
 *
 * - `runEmitterRemoval` работает на модели эмиттера (`./emitter`), а не на `node:events`:
 *   в браузере его нет. Модель показывает механизм — копию списка перед обходом, — но
 *   утверждение «так делает Node» остаётся за юнит-тестом, который запускает настоящий
 *   `EventEmitter` в Node;
 * - `runMutatingSort` выполняет настоящий `sort` с мутирующим компаратором, а спецификация
 *   объявляет такой результат implementation-defined. Показывать его можно только как
 *   «что вышло в этом движке», и проверять в тесте — тоже только это.
 *
 * Свежий объект на каждый прогон: подписки, массивы и счётчики переживают вызов, и второй
 * клик по одолженному экземпляру дал бы другой ответ.
 */

/**
 * Ограничитель глубины для сценария с рекурсией.
 *
 * Страховка, а не механизм: стек у V8 кончается на тысячах кадров, до ста тысяч вложенных
 * `emit` дело не доходит никогда. Ограничитель стоит на случай среды с невероятно большим
 * стеком — чтобы демо в ней оборвалось само, а не подвесило вкладку читателя.
 */
const DEPTH_LIMIT = 100_000;

/** Имя ошибки без её текста: текст у каждого движка свой, имя нормативно. */
const nameOf = (failure: unknown): string => (failure as { name?: string })?.name ?? 'Error';

const textOf = (failure: unknown): string =>
  failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);

/** Порядок вызовов по кругам — той же строкой, какой он был набран в теме руками. */
const summarize = (rounds: DispatchRound[]): string => rounds.map((round) => round.order.join(' → ')).join('\n');

/**
 * Снятие слушателя во время обхода — на настоящем `EventTarget`.
 *
 * Тот самый объект, от которого наследуются DOM-узлы: `addEventListener` здесь не модель,
 * а сам механизм браузера. По стандарту DOM обход идёт по копии списка, но у каждого
 * слушателя есть флаг «removed», и копия его проверяет, — поэтому снятый не вызывается.
 *
 * Слушатель `a` при первом событии снимает `b`. Вызвали `b` или нет — не утверждается,
 * а замеряется: `b` при вызове сам спрашивает, снимали ли его.
 */
export function runTargetRemoval(): DispatchRun {
  const bus = new EventTarget();

  const removed = new Set<string>();
  let order: string[] = [];
  let stale: string[] = [];

  const mark = (who: string) => {
    order.push(who);
    if (removed.has(who)) stale.push(who);
  };

  const onB = () => mark('b');
  const onA = () => {
    mark('a');
    bus.removeEventListener('tick', onB);
    removed.add('b');
  };
  const onC = () => mark('c');

  bus.addEventListener('tick', onA);
  bus.addEventListener('tick', onB);
  bus.addEventListener('tick', onC);

  const rounds: DispatchRound[] = [];
  for (const label of ['первое событие', 'второе событие']) {
    order = [];
    stale = [];
    bus.dispatchEvent(new Event('tick'));
    rounds.push({
      label,
      order,
      stale,
      note: stale.length
        ? `снятые всё равно вызваны: ${stale.join(', ')}`
        : removed.size
          ? `снятые пропущены: ${[...removed].join(', ')}`
          : 'снимать ещё некого — все трое на месте',
    });
  }

  const calledStale = rounds.some((round) => round.stale.length > 0);

  return {
    key: 'target',
    log: [],
    rounds,
    summary: summarize(rounds),
    values: [
      { label: 'кого сняли во время обхода', value: 'b' },
      { label: 'вызвали ли снятого', value: calledStale ? 'да' : 'нет' },
    ],
    errorName: '',
    error: '',
    tone: calledStale ? 'err' : 'ok',
    verdict: calledStale
      ? '`EventTarget` позвал слушателя, снятого во время обхода, — это расходится со стандартом DOM.'
      : 'Стандарт DOM держит у слушателя флаг «removed» и проверяет его на копии: `b` снят во время первого же обхода и не вызван ни разу.',
  };
}

/**
 * То же снятие — на модели эмиттера в стиле Node.
 *
 * ⚠️ Это **модель**, а не Node: `node:events` в браузере не существует. Она повторяет одно
 * решение настоящего `emit` — обход по копии списка — и потому показывает тот же исход:
 * снятый во время обхода слушатель в текущем круге всё равно вызывается. Что так делает
 * именно Node, доказывает юнит-тест, а не это демо.
 */
export function runEmitterRemoval(): DispatchRun {
  const bus = createEmitter();

  const removed = new Set<string>();
  let order: string[] = [];
  let stale: string[] = [];

  const mark = (who: string) => {
    order.push(who);
    if (removed.has(who)) stale.push(who);
  };

  const onB = () => mark('b');
  const onA = () => {
    mark('a');
    bus.off('tick', onB);
    removed.add('b');
  };
  const onC = () => mark('c');

  bus.on('tick', onA);
  bus.on('tick', onB);
  bus.on('tick', onC);

  const before = bus.count('tick');
  const rounds: DispatchRound[] = [];
  const counts: number[] = [];

  for (const label of ['первое событие', 'второе событие']) {
    order = [];
    stale = [];
    bus.emit('tick');
    counts.push(bus.count('tick'));
    rounds.push({
      label,
      order,
      stale,
      note: stale.length
        ? `${stale.join(', ')} к этому моменту уже снят — и всё равно вызван: обход идёт по копии`
        : removed.size
          ? `снятые больше не приходят: ${[...removed].join(', ')}`
          : 'снимать ещё некого — все трое на месте',
    });
  }

  const calledStale = rounds.some((round) => round.stale.length > 0);

  return {
    key: 'emitter',
    log: [],
    rounds,
    summary: summarize(rounds),
    values: [
      { label: 'слушателей до первого события', value: String(before) },
      { label: 'слушателей после первого события', value: String(counts[0]) },
      { label: 'вызвали ли снятого', value: calledStale ? 'да' : 'нет' },
    ],
    errorName: '',
    error: '',
    tone: calledStale ? 'warn' : 'ok',
    verdict: calledStale
      ? 'Снятие сработало — счётчик слушателей упал сразу, — но текущий круг шёл по копии, снятой до первого вызова. Поэтому `b` вызван уже после того, как перестал быть подписан.'
      : 'Снятый слушатель не вызвался: обход этой модели видит снятие сразу, и копии списка в `emit` не получилось.',
  };
}

/**
 * `splice` внутри `forEach` — тот самый пример, к которому в теме был дописан ответ
 * комментарием «1, 2, 4 — тройка пропущена». Здесь ответа заранее нет: он собирается обходом.
 *
 * Механизм задан спецификацией и на усмотрение движка не оставлен: `forEach` держит
 * собственный индекс и на каждом шаге читает `a[i]` заново — после `splice` элементы
 * сдвинулись, а счётчик нет.
 */
export function runForEachSplice(): DispatchRun {
  const a = [1, 2, 3, 4];
  const before = [...a];
  const printed: number[] = [];

  a.forEach((x, i) => {
    if (x === 2) a.splice(i, 1);
    printed.push(x);
  });

  const skipped = before.filter((value) => !printed.includes(value));

  return {
    key: 'splice',
    log: printed.map(String),
    rounds: [],
    summary: '',
    values: [
      { label: 'массив до обхода', value: JSON.stringify(before) },
      { label: 'массив после обхода', value: JSON.stringify(a) },
      { label: 'шагов сделано', value: `${printed.length} из ${before.length}` },
      { label: 'не прочитано вовсе', value: skipped.length ? JSON.stringify(skipped) : 'ничего' },
    ],
    errorName: '',
    error: '',
    tone: skipped.length ? 'warn' : 'ok',
    verdict: skipped.length
      ? `Обход сделал ${printed.length} шага вместо ${before.length}: после \`splice\` элементы сдвинулись влево, а собственный счётчик \`forEach\` — нет, и ${skipped.join(', ')} не прочитан ни разу.`
      : 'Все элементы прочитаны: удаление не сдвинуло то, что ещё предстояло обойти.',
  };
}

/**
 * Мутирующий компаратор внутри `sort`.
 *
 * ⚠️ Спецификация объявляет результат **implementation-defined**, если компаратор меняет
 * массив: корректного ответа здесь нет — есть только то, что случайно сделал этот движок
 * этой версии. Поэтому функция ничего не утверждает про порядок, а возвращает то, что вышло,
 * и число вызовов компаратора.
 *
 * ⚠️ **Чего в тесте утверждать нельзя — так это что массив стал короче.** Проверено запуском
 * в Node 24 (V8): компаратор ужимает массив до нуля, а после сортировки в нём снова пять
 * элементов — V8 сортирует свою копию и дописывает её обратно. Здравый смысл («попов было
 * семь, значит массив пуст») здесь ошибается, и именно поэтому длина не утверждается, а
 * замеряется в трёх точках: до, в самый тесный момент и после.
 */
export function runMutatingSort(): DispatchRun {
  const arr = [5, 1, 4, 2, 3];
  const before = [...arr];
  const calls: string[] = [];

  let shortest = arr.length;
  let errorName = '';
  let error = '';

  try {
    arr.sort((x, y) => {
      calls.push(`компаратор(${x}, ${y}) · длина ${arr.length}`);
      arr.pop();
      shortest = Math.min(shortest, arr.length);
      return x - y;
    });
  } catch (caught) {
    errorName = nameOf(caught);
    error = textOf(caught);
  }

  const log = calls.length > 10 ? [...calls.slice(0, 10), `… всего вызовов: ${calls.length}`] : calls;

  return {
    key: 'sort',
    log,
    rounds: [],
    summary: '',
    values: [
      { label: 'массив до сортировки', value: JSON.stringify(before) },
      { label: 'массив после сортировки', value: JSON.stringify(arr) },
      { label: 'длина: до → в самый тесный момент → после', value: `${before.length} → ${shortest} → ${arr.length}` },
      { label: 'вызовов компаратора', value: String(calls.length) },
    ],
    errorName,
    error,
    tone: 'warn',
    verdict: errorName
      ? `Движок отказался сортировать массив, который меняется под ним: ${errorName}. Спецификация и этого не обещает — результат объявлен implementation-defined.`
      : `${
          arr.length > shortest
            ? `Компаратор ужал массив до ${shortest}, а после сортировки в нём снова ${arr.length} элементов: движок сортировал свою копию и дописал её обратно. `
            : ''
        }Сортировка прошла без исключения и вернула то, что вернула. Это **не** правильный ответ и не ответ языка: при мутирующем компараторе спецификация объявляет результат implementation-defined, и на другом движке — и на другой версии этого — строка выше может оказаться другой.`,
  };
}

/**
 * Рекурсивный `emit` внутри собственного слушателя.
 *
 * Слушатель эмитит то же событие, на которое подписан, — выхода из рекурсии нет, и кончается
 * она не результатом, а стеком. Проверяется **имя** ошибки: `RangeError` нормативно, текст
 * («Maximum call stack size exceeded») — выдумка конкретного движка.
 *
 * ⚠️ Вкладку это не подвешивает: переполнение стека — мгновенное исключение, а не зависание.
 * Ограничитель глубины стоит второй линией, на случай среды, где стек не кончается.
 *
 * ⚠️ Достигнутая глубина — не число языка: она зависит от размера стека и от того, что уже
 * на нём лежало к моменту запуска. От прогона к прогону она может отличаться, и закреплять
 * её тестом нельзя.
 */
export function runRecursiveEmit(): DispatchRun {
  const bus = createEmitter();

  let depth = 0;
  let guard = false;

  bus.on('tick', () => {
    depth += 1;
    if (depth >= DEPTH_LIMIT) {
      guard = true;
      const stop = new Error(`ограничитель демо: ${DEPTH_LIMIT} вложенных emit, а стек всё не кончился`);
      stop.name = 'DepthLimit';
      throw stop;
    }
    bus.emit('tick');
  });

  let errorName = '';
  let error = '';

  try {
    bus.emit('tick');
  } catch (caught) {
    errorName = nameOf(caught);
    error = textOf(caught);
  }

  const values: DispatchValue[] = [
    { label: 'вложенных emit до обрыва', value: depth.toLocaleString('ru-RU') },
    { label: 'чем кончилось', value: errorName || 'ничем: рекурсия завершилась сама' },
    { label: 'слушателей на событии', value: String(bus.count('tick')) },
  ];

  return {
    key: 'recursion',
    log: [
      'emit → слушатель → emit → слушатель → …',
      errorName ? `оборвалось на глубине ${depth}` : `рекурсия завершилась сама на глубине ${depth}`,
    ],
    rounds: [],
    summary: '',
    values,
    errorName,
    error,
    tone: errorName === 'RangeError' ? 'err' : 'warn',
    verdict:
      errorName === 'RangeError'
        ? 'Стек кончился, и движок бросил `RangeError` — синхронно, прямо в том вызове `emit`, с которого всё началось. Слушатель при этом остался подписан: рекурсию оборвало исключение, а не отписка.'
        : guard
          ? 'Сработал ограничитель демо: стек в этой среде выдержал сто тысяч вложенных вызовов. Настоящее переполнение выглядело бы как `RangeError`.'
          : `Рекурсия оборвалась не переполнением стека, а ошибкой \`${errorName || 'без ошибки'}\` — для этого сценария неожиданно.`,
  };
}

/** Сценарии в порядке переключателя. Код в `code` — тот же, что исполняют функции выше. */
export const SCENARIOS: DispatchScenario[] = [
  {
    key: 'target',
    label: 'EventTarget',
    title: 'Слушателя снимают во время обхода — `EventTarget`',
    lead: 'Трое подписаны на одно событие. Первый при вызове снимает второго — и вопрос ровно один: успеет ли второй отработать в этом же событии.',
    code: [
      "const bus = new EventTarget();",
      '',
      "const onB = () => log('b');",
      'const onA = () => {',
      "  log('a');",
      "  bus.removeEventListener('tick', onB);   // снимаем прямо в обходе",
      '};',
      "const onC = () => log('c');",
      '',
      "bus.addEventListener('tick', onA);",
      "bus.addEventListener('tick', onB);",
      "bus.addEventListener('tick', onC);",
      '',
      "bus.dispatchEvent(new Event('tick'));   // первое",
      "bus.dispatchEvent(new Event('tick'));   // второе",
    ],
    source: 'spec',
    caveat:
      'Это настоящий `EventTarget` вашего браузера — тот самый объект, от которого наследуются DOM-узлы. Обход по стандарту DOM идёт по копии списка, но у каждого слушателя есть флаг «removed», и копия его проверяет.',
  },
  {
    key: 'emitter',
    label: 'эмиттер в стиле Node',
    title: 'То же снятие — на эмиттере, который обходит копию',
    lead: 'Тот же расклад и тот же вопрос, но диспетчеризация устроена как в Node: `emit` снимает копию списка слушателей и идёт по ней.',
    code: [
      'emit(name, ...args) {',
      '  const list = handlers.get(name);',
      '  if (!list || list.length === 0) return false;',
      '  for (const fn of [...list]) fn(...args);   // ← обход по копии',
      '  return true;',
      '}',
      '',
      "bus.on('tick', onA);   // onA снимает onB",
      "bus.on('tick', onB);",
      "bus.on('tick', onC);",
      '',
      "bus.emit('tick');   // первое",
      "bus.emit('tick');   // второе",
    ],
    source: 'model',
    caveat:
      'Это **модель**, а не Node: модуля `node:events` в браузере нет. Она повторяет одно решение настоящего `emit` — копию списка перед обходом — и показывает механизм. Что так ведёт себя сам Node, доказывает юнит-тест на настоящем `EventEmitter`, а не это демо.',
  },
  {
    key: 'splice',
    label: 'forEach + splice',
    title: '`splice` внутри `forEach`',
    lead: 'Колбэк удаляет элемент из массива, по которому его же и вызывают. Что при этом прочитается — считает обход, а не комментарий к примеру.',
    code: [
      'const a = [1, 2, 3, 4];',
      '',
      'a.forEach((x, i) => {',
      '  if (x === 2) a.splice(i, 1);',
      '  log(x);',
      '});',
    ],
    source: 'spec',
    caveat:
      'Спецификация здесь ничего не оставляет на усмотрение движка: `forEach` держит собственный индекс и на каждом шаге читает `a[i]` заново. То же будет у `map`, `filter` и `some`.',
  },
  {
    key: 'sort',
    label: 'мутирующий sort',
    title: 'Компаратор, который меняет сортируемый массив',
    lead: 'Компаратор вызывается изнутри алгоритма сортировки — и портит его состояние прямо во время работы.',
    code: [
      'const arr = [5, 1, 4, 2, 3];',
      '',
      'arr.sort((x, y) => {',
      '  arr.pop();       // мутируем то, что сортируем',
      '  return x - y;',
      '});',
    ],
    source: 'engine',
    caveat:
      'Спецификация объявляет результат **implementation-defined**, если компаратор мутирует массив. Ниже — то, что вышло **в этом браузере**: не ответ языка и не «правильный порядок». На другом движке — и на другой версии этого — строка будет другой.',
  },
  {
    key: 'recursion',
    label: 'рекурсивный emit',
    title: 'Слушатель эмитит событие, на которое подписан',
    lead: 'Выхода из такой рекурсии нет: каждый вызов порождает следующий. Кончается она не результатом, а стеком — и это видно прямо здесь.',
    code: [
      "bus.on('tick', () => {",
      "  bus.emit('tick');   // то же событие, тот же слушатель",
      '});',
      '',
      "bus.emit('tick');",
    ],
    source: 'engine',
    caveat:
      'Нормативно здесь только имя ошибки — `RangeError`. Глубина зависит от размера стека и от того, что на нём уже лежало, поэтому число ниже — про эту вкладку в эту минуту, а не про язык. Вкладку это не вешает: переполнение стека — мгновенное исключение.',
  },
];

const RUNNERS: Record<DispatchKey, () => DispatchRun> = {
  target: runTargetRemoval,
  emitter: runEmitterRemoval,
  splice: runForEachSplice,
  sort: runMutatingSort,
  recursion: runRecursiveEmit,
};

/** Выполнить сценарий по ключу — свежий объект внутри каждой функции. */
export function runScenario(key: DispatchKey): DispatchRun {
  return RUNNERS[key]();
}
