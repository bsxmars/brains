import type {
  TransferKey,
  TransferOwnership,
  TransferRun,
  TransferScenario,
  TransferValue,
} from './types';

/**
 * Правила transfer-списка, выполненные по-настоящему.
 *
 * Зачем не таблица. Раньше здесь лежали шесть готовых вердиктов: `result: 'DataCloneError'`,
 * `sender: 'buf.byteLength → 0'` — строки, набранные человеком и один раз сверенные запуском.
 * Такое `AGENTS.md` запрещает прямо («Таблицу о поведении языка не набирают — её вычисляют»),
 * и по делу: разовая сверка не повторяется, а расхождение с движком выглядит как обычный текст.
 * Остров с переключателем этого не лечит — он листает те же заготовки.
 *
 * Поэтому здесь чистые функции без DOM и без Vue. Каждая создаёт свой `MessageChannel` и свой
 * `ArrayBuffer`, выполняет три строки `postMessage` в `try`/`catch` и возвращает то, что вышло:
 * имя ошибки, дословный текст движка, `byteLength` у отправителя и то, что реально доехало
 * до второго порта. Компонент только показывает; юнит-тест импортирует **этот же** модуль.
 *
 * ⚠️ **Браузерное API зовётся внутри функций, а не на уровне модуля.** Остров сперва рендерится
 * в Node, и обращение к `MessageChannel` при загрузке модуля уронило бы сборку всей страницы,
 * а не одно демо.
 *
 * ⚠️ **Свежие объекты на каждый прогон — не аккуратность, а необходимость.** Отсоединённый
 * буфер не присоединяется обратно: одолжи демо один экземпляр между прогонами — и второе
 * нажатие «прогнать заново» дало бы другой ответ. Ровно поэтому кнопка здесь есть: повторный
 * прогон обязан давать тот же результат, и это проверяется нажатием.
 *
 * ⚠️ **Порты закрываются в `finally`.** Незакрытая пара — та самая утечка, о которой
 * рассказывает сама тема; демо про утечку, которое течёт, объясняло бы ровно наоборот.
 *
 * Про среду. В Node 22+ `MessageChannel` — глобальный (и это проверено запуском: модуль
 * выполняется в vitest без единого импорта из `node:worker_threads`). Проверка
 * `typeof MessageChannel === 'undefined'` оставлена не ради Node, а ради честной заглушки:
 * в среде без канала демо говорит «выполнить нечем», а не рисует выдуманный вердикт.
 */

/** Размер подопытного буфера. Число само по себе ничего не доказывает — важно, что оно меняется. */
const SIZE = 1024;

/** Метка в первом байте: по ней видно, что у получателя те же данные, а не пустая копия. */
const MARK = 7;

/**
 * Окно, за которое сообщение обязано доехать до второго порта.
 *
 * Доставка идёт отдельной задачей, а не синхронно, — иначе замерять было бы нечего. Пятьдесят
 * миллисекунд на задачу, которая ставится в очередь немедленно, — запас, а не ожидание.
 */
const DELIVERY_WINDOW = 50;

/** Имя ошибки без её текста: текст у каждого движка свой, имя нормативно. */
const nameOf = (failure: unknown): string => (failure as { name?: string })?.name ?? 'Error';

const textOf = (failure: unknown): string =>
  failure instanceof Error ? `${failure.name}: ${failure.message}` : String(failure);

interface Attempt {
  threw: boolean;
  errorName: string;
  error: string;
}

/** Выполнить одну строку и запомнить, чем она кончилась. Ответа заранее нет ни у одной из них. */
const attempt = (call: () => void): Attempt => {
  try {
    call();
    return { threw: false, errorName: '', error: '' };
  } catch (caught) {
    return { threw: true, errorName: nameOf(caught), error: textOf(caught) };
  }
};

/** Канал под один прогон: отправитель, всё доехавшее до получателя и закрытие пары. */
interface Wire {
  /** `port1` — по нему шлют. Он же попадает в transfer-список в первом случае. */
  sender: MessagePort;
  /** Сообщения, которые действительно доехали до `port2`, в порядке доставки. */
  arrivals: unknown[];
  /** Подождать доставку: она идёт задачей, а не синхронно. */
  settle: () => Promise<void>;
  close: () => void;
}

function open(): Wire {
  const channel = new MessageChannel();
  const arrivals: unknown[] = [];

  channel.port2.onmessage = (event: MessageEvent) => {
    arrivals.push(event.data);
  };
  channel.port2.start();

  return {
    sender: channel.port1,
    arrivals,
    settle: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => resolve(), DELIVERY_WINDOW);
      }),
    close: () => {
      try {
        channel.port1.close();
        channel.port2.close();
      } catch {
        // Порт уже мёртв — закрывать нечего. Молчание здесь безопасно: закрытие идемпотентно.
      }
    },
  };
}

/**
 * `byteLength` — и буфера, и вида на него: отсоединение видно по нулю, отдельного «detached»
 * спрашивать не нужно. Параметр описан по форме, а не типом: спрашиваем ровно одно поле,
 * и `ArrayBuffer`, `SharedArrayBuffer` и `Uint8Array` отвечают на него одинаково.
 */
const bytes = (value: { byteLength: number }): string => `${value.byteLength} байт`;

/** Приехавшее сообщение — так, как его напечатала бы консоль. `undefined` значит «не доехало». */
const arrivalOf = (value: unknown): string => (value === undefined ? 'ничего' : JSON.stringify(value));

/**
 * Исходники случаев. Ровно то, что исполняют функции ниже, — и ровно то, что видит читатель:
 * две копии одного кода разошлись бы молча, поэтому копия одна.
 */
const CODE: Record<TransferKey, string[]> = {
  self: [
    'const { port1, port2 } = new MessageChannel();',
    '',
    'port1.postMessage({ hi: 1 }, [port1]);   // порт в своём же списке',
    "port1.postMessage({ note: '…' });        // а теперь обычное сообщение",
  ],
  'no-list': [
    'const { port1, port2 } = new MessageChannel();',
    'const spare = new MessageChannel();',
    '',
    'port1.postMessage({ reply: spare.port2 });   // порт, и списка нет',
    '',
    'const buf = new ArrayBuffer(1024);',
    'port1.postMessage({ buf });                  // буфер, и списка нет',
  ],
  orphan: [
    'const { port1, port2 } = new MessageChannel();',
    'const buf = new ArrayBuffer(1024);',
    '',
    'port1.postMessage({ n: 1 }, [buf]);   // buf в списке, но не в сообщении',
    'buf.byteLength;',
  ],
  view: [
    'const buf = new ArrayBuffer(1024);',
    'const view = new Uint8Array(buf);',
    '',
    'port1.postMessage({ payload: view }, [view]);   // в списке вид, а не буфер',
  ],
  ok: [
    'const buf = new ArrayBuffer(1024);',
    'const view = new Uint8Array(buf);',
    'view[0] = 7;',
    '',
    'port1.postMessage({ payload: view }, [buf]);   // вид в сообщении, буфер в списке',
    'view.byteLength;',
  ],
  twice: [
    'const buf = new ArrayBuffer(1024);',
    '',
    'port1.postMessage({ chunk: 1, buf }, [buf]);   // прошло: буфер уехал',
    'port1.postMessage({ chunk: 2, buf }, [buf]);   // buf уже отсоединён',
  ],
};

/**
 * 1. Порт в своём же transfer-списке.
 *
 * Второй вызов — не украшение: он отвечает на вопрос, который возникает сразу после отказа.
 * Канал после `DataCloneError` не рвётся, и утверждать это словами не нужно — достаточно
 * отправить по тому же порту обычное сообщение и посмотреть, доедет ли оно.
 */
async function runSelfPort(): Promise<TransferRun> {
  const wire = open();

  try {
    const failed = attempt(() => {
      wire.sender.postMessage({ hi: 1 }, [wire.sender]);
    });
    await wire.settle();
    const deliveredByFailure = wire.arrivals.length;

    const plain = attempt(() => {
      wire.sender.postMessage({ note: 'обычное сообщение после отказа' });
    });
    await wire.settle();
    const alive = wire.arrivals.length > deliveredByFailure;

    return {
      key: 'self',
      supported: true,
      code: CODE.self,
      threw: failed.threw,
      errorName: failed.errorName,
      error: failed.error,
      values: [
        { label: 'что бросил движок', value: failed.errorName || 'ничего' },
        { label: 'доставлено первым вызовом', value: deliveredByFailure ? 'сообщение' : 'ничего' },
        {
          label: 'порт после отказа',
          value: plain.threw
            ? `тоже отказ: ${plain.errorName}`
            : alive
              ? 'жив: следующее сообщение дошло'
              : 'вызов прошёл, но сообщение не доехало',
        },
      ],
      senderBytes: null,
      senderViewBytes: null,
      senderDetached: null,
      receiverBytes: null,
      receiverMark: null,
      arrivals: [...wire.arrivals],
      tone: failed.threw ? 'err' : 'warn',
      verdict: failed.threw
        ? 'Порт не может перенести сам себя: сериализация обрывается **до** отправки, и сообщение не уходит вовсе. Канал при этом цел — следующее обычное сообщение по тому же порту доезжает.'
        : 'Вызов прошёл без ошибки — для этого случая неожиданно: спецификация требует `DataCloneError`.',
    };
  } finally {
    wire.close();
  }
}

/**
 * 2. Забытый transfer-список — сразу в двух видах, и они не одинаковы.
 *
 * Порт клонировать нечем, поэтому забытый список роняет вызов. Буфер клонируется прекрасно —
 * и забытый список превращает перенос за O(1) в тихое копирование: ошибки нет, байты есть
 * у обеих сторон. Это два разных исхода одной и той же забывчивости, и показывать их нужно
 * рядом, иначе «забыли список» запоминается как «упадёт».
 */
async function runMissingList(): Promise<TransferRun> {
  const wire = open();
  const spare = new MessageChannel();

  try {
    const port = attempt(() => {
      wire.sender.postMessage({ reply: spare.port2 });
    });
    await wire.settle();
    const afterPort = wire.arrivals.length;

    const buffer = new ArrayBuffer(SIZE);
    new Uint8Array(buffer)[0] = MARK;

    const copy = attempt(() => {
      wire.sender.postMessage({ buf: buffer });
    });
    await wire.settle();

    const delivered = wire.arrivals[afterPort] as { buf?: ArrayBuffer } | undefined;
    const arrived = delivered?.buf;
    const sameObject = arrived === buffer;
    const owner: TransferOwnership = {
      sender: `buf.byteLength → ${buffer.byteLength}: буфер никуда не уехал`,
      senderTone: 'warn',
      receiver: arrived
        ? `свой ArrayBuffer на ${arrived.byteLength} байт — копия`
        : 'буфер не доехал',
      receiverTone: 'warn',
    };

    return {
      key: 'no-list',
      supported: true,
      code: CODE['no-list'],
      threw: port.threw,
      errorName: port.errorName,
      error: port.error,
      values: [
        { label: 'порт без списка', value: port.threw ? port.errorName : 'прошёл без ошибки' },
        { label: 'буфер без списка', value: copy.threw ? copy.errorName : 'прошёл без ошибки' },
        { label: 'у отправителя после отправки буфера', value: bytes(buffer) },
        { label: 'у получателя', value: arrived ? bytes(arrived) : 'ничего' },
        {
          label: 'тот же объект или копия',
          value: sameObject ? 'тот же объект' : 'копия: другой ArrayBuffer',
        },
        {
          label: 'данные в копии, первый байт',
          value: arrived ? String(new Uint8Array(arrived)[0]) : '—',
        },
      ],
      owner,
      senderBytes: buffer.byteLength,
      senderViewBytes: null,
      senderDetached: buffer.detached,
      receiverBytes: arrived ? arrived.byteLength : null,
      receiverMark: arrived ? new Uint8Array(arrived)[0] : null,
      arrivals: [...wire.arrivals],
      tone: port.threw ? 'err' : 'warn',
      verdict: port.threw
        ? 'Порт без transfer-списка — `DataCloneError`: порты **только переносятся**, клонировать их нечем, и сообщение не уходит. А вот буфер в той же ситуации не падает: он клонируемый. Забытый список тихо превращает перенос за O(1) в копию — байты остались у отправителя и появились у получателя.'
        : 'Порт уехал без transfer-списка — этого спецификация не разрешает.',
    };
  } finally {
    spare.port1.close();
    spare.port2.close();
    wire.close();
  }
}

/**
 * 3. Сирота: объект в списке, но не в сообщении.
 *
 * Самая дорогая строка темы, потому что она не падает. Transfer-список отсоединяет всё, что
 * в нём перечислено, независимо от того, попал ли объект в сообщение, — и буфер теряется
 * с обеих сторон сразу.
 */
async function runOrphan(): Promise<TransferRun> {
  const wire = open();

  try {
    const buffer = new ArrayBuffer(SIZE);
    new Uint8Array(buffer)[0] = MARK;
    const before = buffer.byteLength;

    const call = attempt(() => {
      wire.sender.postMessage({ n: 1 }, [buffer]);
    });
    await wire.settle();

    const delivered = wire.arrivals[0];
    const lost = !call.threw && buffer.byteLength === 0;

    return {
      key: 'orphan',
      supported: true,
      code: CODE.orphan,
      threw: call.threw,
      errorName: call.errorName,
      error: call.error,
      values: [
        { label: 'что бросил движок', value: call.errorName || 'ничего' },
        { label: 'у отправителя до вызова', value: `${before} байт` },
        { label: 'у отправителя после вызова', value: bytes(buffer) },
        { label: 'что приехало получателю', value: arrivalOf(delivered) },
        { label: 'буфер в приехавшем сообщении', value: 'его там нет: в список попал, в сообщение — нет' },
      ],
      owner: {
        sender: `buf.byteLength → ${buffer.byteLength}, доступа больше нет`,
        senderTone: 'err',
        receiver: `приехало только ${arrivalOf(delivered)}`,
        receiverTone: 'dim',
      },
      senderBytes: buffer.byteLength,
      senderViewBytes: null,
      senderDetached: buffer.detached,
      receiverBytes: null,
      receiverMark: null,
      arrivals: [...wire.arrivals],
      tone: lost ? 'warn' : call.threw ? 'err' : 'ok',
      verdict: lost
        ? 'Исключения нет — и это худший из шести исходов. Transfer-список отсоединяет всё, что в нём перечислено, даже если в сообщении этого объекта не было: у отправителя ноль байт, получателю буфер не приехал. Типовой случай — поправили форму сообщения, а список забыли.'
        : call.threw
          ? `Вызов упал с \`${call.errorName}\` — значит, эта среда проверяет список против сообщения. Спецификация такой проверки не требует.`
          : 'Буфер уцелел: эта среда отсоединяет только то, что действительно ушло в сообщении.',
    };
  } finally {
    wire.close();
  }
}

/**
 * 4. `TypedArray` в transfer-списке вместо самого буфера.
 *
 * ⚠️ Приведение типа ниже — часть ответа, а не обход проверок: `Transferable` в lib.dom
 * не включает виды, поэтому строку, которую мы пробуем, TypeScript не пропустил бы вовсе.
 * Движок отвечает то же самое, только в рантайме.
 */
async function runViewInList(): Promise<TransferRun> {
  const wire = open();

  try {
    const buffer = new ArrayBuffer(SIZE);
    const view = new Uint8Array(buffer);

    const call = attempt(() => {
      wire.sender.postMessage({ payload: view }, [view] as unknown as Transferable[]);
    });
    await wire.settle();

    return {
      key: 'view',
      supported: true,
      code: CODE.view,
      threw: call.threw,
      errorName: call.errorName,
      error: call.error,
      values: [
        { label: 'что бросил движок', value: call.errorName || 'ничего' },
        { label: 'буфер у отправителя', value: bytes(buffer) },
        { label: 'вид у отправителя', value: bytes(view) },
        { label: 'доставлено получателю', value: wire.arrivals.length ? arrivalOf(wire.arrivals[0]) : 'ничего' },
      ],
      owner: {
        sender: `buf.byteLength → ${buffer.byteLength}: вызов не состоялся`,
        senderTone: 'dim',
        receiver: 'не получил ничего',
        receiverTone: 'dim',
      },
      senderBytes: buffer.byteLength,
      senderViewBytes: view.byteLength,
      senderDetached: buffer.detached,
      receiverBytes: null,
      receiverMark: null,
      arrivals: [...wire.arrivals],
      tone: call.threw ? 'err' : 'warn',
      verdict: call.threw
        ? 'Transferable — это `ArrayBuffer`, а не вид на него. Вызов обрывается до отправки, поэтому буфер даже не пострадал: байты на месте. Правильно наоборот — `view` в сообщение, `view.buffer` в список.'
        : 'Вид уехал transfer-списком — этого спецификация не разрешает.',
    };
  } finally {
    wire.close();
  }
}

/**
 * 5. Корректный случай: вид в сообщении, его буфер — в списке.
 *
 * Здесь замеряется не «прошло», а сам перенос: у отправителя обе локальные вьюхи отсоединены,
 * у получателя рабочий `Uint8Array` с теми же данными. Копирования при этом не было.
 */
async function runCorrect(): Promise<TransferRun> {
  const wire = open();

  try {
    const buffer = new ArrayBuffer(SIZE);
    const view = new Uint8Array(buffer);
    view[0] = MARK;

    const call = attempt(() => {
      wire.sender.postMessage({ payload: view }, [buffer]);
    });
    await wire.settle();

    const delivered = wire.arrivals[0] as { payload?: Uint8Array } | undefined;
    const arrived = delivered?.payload;
    const moved = !call.threw && buffer.byteLength === 0 && arrived?.byteLength === SIZE;

    const values: TransferValue[] = [
      { label: 'что бросил движок', value: call.errorName || 'ничего' },
      { label: 'вид у отправителя', value: bytes(view) },
      { label: 'буфер у отправителя', value: bytes(buffer) },
      {
        label: 'что приехало получателю',
        value: arrived
          ? `${arrived instanceof Uint8Array ? 'Uint8Array' : 'другой тип'} на ${arrived.byteLength} байт`
          : 'ничего',
      },
      { label: 'данные целы, первый байт', value: arrived ? String(arrived[0]) : '—' },
      { label: 'буфер под видом получателя', value: arrived ? bytes(arrived.buffer) : '—' },
    ];

    return {
      key: 'ok',
      supported: true,
      code: CODE.ok,
      threw: call.threw,
      errorName: call.errorName,
      error: call.error,
      values,
      owner: {
        sender: `view.byteLength → ${view.byteLength}, buf.byteLength → ${buffer.byteLength}`,
        senderTone: 'warn',
        receiver: arrived
          ? `Uint8Array(${arrived.byteLength}), рабочий — копирования не было`
          : 'ничего не приехало',
        receiverTone: arrived ? 'ok' : 'dim',
      },
      senderBytes: buffer.byteLength,
      senderViewBytes: view.byteLength,
      senderDetached: buffer.detached,
      receiverBytes: arrived ? arrived.byteLength : null,
      receiverMark: arrived ? (arrived[0] ?? null) : null,
      arrivals: [...wire.arrivals],
      tone: moved ? 'ok' : 'warn',
      verdict: moved
        ? 'Так выглядит перенос: `view` уехал в сообщении обычной клонируемой структурой, а его буфер — в transfer-списке, поэтому скопирован не был. Обе локальные вьюхи отсоединились в тот же миг — это и есть признак смены владельца, а не копии.'
        : 'Перенос не состоялся целиком: либо буфер у отправителя жив, либо получатель не увидел данных.',
    };
  } finally {
    wire.close();
  }
}

/**
 * 6. Один буфер отправлен дважды.
 *
 * После первого вызова буфер отсоединён, и второй перенос переносить уже нечего. Здесь ошибка
 * хотя бы громкая — в отличие от третьего случая, где то же самое происходит молча.
 */
async function runTwice(): Promise<TransferRun> {
  const wire = open();

  try {
    const buffer = new ArrayBuffer(SIZE);
    new Uint8Array(buffer)[0] = MARK;

    const first = attempt(() => {
      wire.sender.postMessage({ chunk: 1, buf: buffer }, [buffer]);
    });
    const between = buffer.byteLength;

    const second = attempt(() => {
      wire.sender.postMessage({ chunk: 2, buf: buffer }, [buffer]);
    });
    await wire.settle();

    const delivered = wire.arrivals as { chunk?: number; buf?: ArrayBuffer }[];
    const firstArrival = delivered[0];
    const firstBuf = firstArrival?.buf;

    return {
      key: 'twice',
      supported: true,
      code: CODE.twice,
      threw: second.threw,
      errorName: second.errorName,
      error: second.error,
      values: [
        { label: 'первый вызов', value: first.threw ? first.errorName : 'прошёл' },
        { label: 'у отправителя между вызовами', value: `${between} байт` },
        { label: 'второй вызов', value: second.threw ? second.errorName : 'прошёл' },
        { label: 'сообщений доехало', value: `${delivered.length} из 2` },
        {
          label: 'что в первом сообщении',
          value: firstArrival?.buf ? `кусок ${firstArrival.chunk}, ${bytes(firstArrival.buf)}` : 'буфера нет',
        },
      ],
      owner: {
        sender: `buf.byteLength → ${buffer.byteLength} ещё с первой строки`,
        senderTone: 'err',
        receiver:
          delivered.length === 1
            ? 'приехал только первый кусок, второй не ушёл'
            : `сообщений доехало: ${delivered.length}`,
        receiverTone: 'dim',
      },
      senderBytes: buffer.byteLength,
      senderViewBytes: null,
      senderDetached: buffer.detached,
      receiverBytes: firstBuf ? firstBuf.byteLength : null,
      receiverMark: firstBuf ? new Uint8Array(firstBuf)[0] : null,
      arrivals: [...wire.arrivals],
      tone: second.threw ? 'err' : 'warn',
      verdict: second.threw
        ? 'Первый вызов увёз буфер и обнулил его у отправителя; второму переносить уже нечего — `DataCloneError`. Громко, и это удача: тот же самый буфер, потерянный третьим случаем, исчезает без единого слова.'
        : 'Второй перенос прошёл без ошибки — значит, буфер после первого не отсоединился.',
    };
  } finally {
    wire.close();
  }
}

/** Случаи в порядке переключателя. Ответов здесь нет — только вопрос и объяснение механики. */
export const SCENARIOS: TransferScenario[] = [
  {
    key: 'self',
    label: 'порт внутри себя',
    title: 'Порт в своём же transfer-списке',
    lead: 'Отправить порт по нему же самому — первое, что приходит в голову, когда нужно отдать «обратный адрес».',
    why: 'Перенос порта означает, что локальная ссылка умирает. Отправлять по мёртвому порту нечего, и спецификация обрывает вызов заранее: сериализация видит источник в собственном transfer-списке и бросает `DataCloneError`. Обратный адрес отдают вторым портом — тем, который создан отдельным `MessageChannel`.',
    code: CODE.self,
  },
  {
    key: 'no-list',
    label: 'порт без transfer-списка',
    title: 'Забыли transfer-список',
    lead: 'Одна и та же забывчивость даёт два разных исхода: с портом — громкий отказ, с буфером — тихая копия.',
    why: 'Порт клонировать нечем: он **только** переносится, поэтому без списка сообщение не уходит вовсе. Буфер клонируется штатно — и забытый список превращает перенос за O(1) в копирование всех байтов. Ошибки нет, профиль медленнее, память вдвое: самая незаметная из потерь.',
    code: CODE['no-list'],
  },
  {
    key: 'orphan',
    label: 'объект в списке, но не в сообщении',
    title: 'Сирота: буфер в списке, которого нет в сообщении',
    lead: 'Типовой случай — отрефакторили форму сообщения, а transfer-список поправить забыли.',
    why: 'Transfer-список — это не пометка на содержимом сообщения, а самостоятельное распоряжение: «этих отсоединить». Спецификация отсоединяет всё перечисленное независимо от того, встретилось ли оно при сериализации. Поэтому буфер теряется дважды: у отправителя его больше нет, а получателю он не приезжал.',
    code: CODE.orphan,
  },
  {
    key: 'view',
    label: 'TypedArray в transfer-списке',
    title: 'В списке вид, а не буфер',
    lead: '`Uint8Array` выглядит как данные, но переносится не он: переносится память, на которую он смотрит.',
    why: 'Transferable — это `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`, стримы. Вида среди них нет: вид — это оболочка со смещением и длиной, её сериализуют обычным клонированием. Правильная пара — `view` в сообщение, `view.buffer` в transfer-список: тогда вид приедет рабочим, а байты не скопируются.',
    code: CODE.view,
  },
  {
    key: 'ok',
    label: 'правильный вариант',
    title: 'Как это пишется правильно',
    lead: 'Вид едет в сообщении, его буфер — в transfer-списке. Проверять тут нужно не «прошло ли», а что стало с владением.',
    why: 'Перенос — это смена владельца, а не копия и не ссылка. Отсоединение локальных видов и есть доказательство, что копирования не было: были бы копии — исходные байты остались бы на месте. Отсюда правило приёмной стороны: после `postMessage` считать свои вьюхи мёртвыми, а не «наверное, ещё живыми».',
    code: CODE.ok,
  },
  {
    key: 'twice',
    label: 'повторный transfer',
    title: 'Один буфер отправили дважды',
    lead: 'Второй `postMessage` с тем же буфером — обычная ошибка цикла: переносим кусок за куском, а буфер один.',
    why: 'Отсоединённый буфер перенести нельзя: данных у него больше нет. Этот случай хотя бы падает громко — в отличие от сироты, где буфер исчезает тем же способом, но без единого слова. Если куски нужно слать подряд, буфер под каждый создают заново или возвращают обратно ответным сообщением.',
    code: CODE.twice,
  },
];

const RUNNERS: Record<TransferKey, () => Promise<TransferRun>> = {
  self: runSelfPort,
  'no-list': runMissingList,
  orphan: runOrphan,
  view: runViewInList,
  ok: runCorrect,
  twice: runTwice,
};

/** Среды без канала: заглушка вместо выдуманного ответа. */
function absent(key: TransferKey): TransferRun {
  return {
    key,
    supported: false,
    code: CODE[key],
    threw: false,
    errorName: '',
    error: '',
    senderBytes: null,
    senderViewBytes: null,
    senderDetached: null,
    receiverBytes: null,
    receiverMark: null,
    arrivals: [],
    values: [],
    tone: 'warn',
    verdict: 'В этой среде нет `MessageChannel` — выполнить случай нечем. Готового ответа демо не показывает: вердикт здесь всегда снят прогоном, а снять его не на чем.',
  };
}

/**
 * Выполнить случай по ключу. Свежий канал и свежий буфер — внутри каждой функции.
 *
 * Функция асинхронная не для красоты: доставка сообщения — отдельная задача, и `byteLength`
 * у получателя иначе просто не с чего прочитать.
 */
export function runTransfer(key: TransferKey): Promise<TransferRun> {
  if (typeof MessageChannel === 'undefined') return Promise.resolve(absent(key));
  return RUNNERS[key]();
}
