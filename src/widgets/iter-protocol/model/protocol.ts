import type {
  IterScenarioKey,
  IterScenarioMeta,
  PassResult,
  ProtocolRun,
  ProtocolStep,
  StepTone,
} from './types';

/**
 * Протокол итерации, выполненный по-настоящему.
 *
 * Раздел про итераторы соблазняет нарисовать схему: «`for…of` берёт `[Symbol.iterator]()`,
 * потом зовёт `next()`». Схема была бы утверждением о семантике языка — а такие утверждения
 * в этом курсе не набирают руками, их вычисляют (`AGENTS.md`, «Таблицу о поведении языка
 * не набирают — её вычисляют»). Поэтому здесь нет заранее написанных `{ value, done }`:
 * каждая строка журнала собрана из настоящего ответа настоящего итератора.
 *
 * Цикл `for…of` здесь **расписан по шагам**, а не выполнен целиком, и это не подделка,
 * а единственный способ показать протокол: сам `for…of` выполняется атомарно и наружу
 * не отдаёт ничего, кроме результата. Расписан он ровно так, как требует спецификация —
 * `GetIterator`, `IteratorStep`, `IteratorClose`, — и каждый его вызов по-настоящему доходит
 * до движка. Что разбор совпадает с настоящим циклом, проверяется юнит-тестом: он прогоняет
 * те же источники обычными `[...x]`, `for…of` с `break` и деструктуризацией и сверяет
 * счётчики с теми, что насчитал этот модуль.
 *
 * ⚠️ Источник создаётся заново на каждый прогон — по той же причине, что свежий объект
 * в `widgets/lock-lab`: генератор одноразовый, и второй прогон по тому же экземпляру
 * дал бы другой ответ. Демо начало бы врать после первого же переключения.
 */

type Value = string | number;

/**
 * Итератор так, как его видит потребитель: `next()` обязателен, `return()` — нет.
 *
 * Методы описаны синтаксисом методов, а не полей, намеренно: так объект-генератор
 * со своей сигнатурой `return(value: TReturn)` проходит проверку типов.
 */
interface Probe {
  next(): IteratorResult<Value, unknown>;
  return?(value?: unknown): IteratorResult<Value, unknown>;
}

/** Источник значений: то, у чего потребитель спрашивает `[Symbol.iterator]()`. */
interface Source {
  [Symbol.iterator](): Probe;
}

interface Tally {
  next: number;
  ret: number;
}

/** Значение так, как его напечатала бы консоль. */
const fmt = (v: unknown): string =>
  typeof v === 'string' ? `'${v}'` : v === undefined ? 'undefined' : String(v);

/** `{ value, done }` — из настоящего результата вызова, а не из заготовленной строки. */
const shape = (r: IteratorResult<Value, unknown>): string =>
  `{ value: ${fmt(r.value)}, done: ${r.done === true} }`;

/**
 * Счётный итератор — тонкая обёртка вокруг настоящего.
 *
 * Считать вызовы в драйвере было бы проще и было бы враньём: счётчик показывал бы,
 * сколько раз демо **собралось** позвать, а не сколько раз итератор ответил. Здесь `+= 1`
 * стоит внутри метода, до передачи вызова дальше, — и в счётчике оказывается ровно то,
 * что движок действительно выполнил.
 *
 * ⚠️ `return()` у итератора **необязателен**, и его отсутствие — не ошибка: выход по `break`
 * над таким итератором проходит молча, закрывать просто нечего. Отсюда и ветка с `?.`.
 */
function counted(inner: Probe, tally: Tally): Probe {
  return {
    next() {
      tally.next += 1;
      return inner.next();
    },
    return(value?: unknown) {
      tally.ret += 1;
      return inner.return?.(value) ?? { value, done: true };
    },
  };
}

/** Чем заканчивается заход потребителя. */
type Stop =
  | { kind: 'end' }
  /** `for…of` с `break` на значении; `line` — строка самого `break`. */
  | { kind: 'break'; at: Value; line: number }
  /** Деструктуризация: образцу нужно ровно `n` значений. */
  | { kind: 'take'; n: number };

/** Один заход потребителя к источнику. */
interface Pass {
  /** Как источник зовётся в коде: `it`, `g`, `lines(file)`. */
  subject: string;
  label: string;
  /** Строка листинга, на которой стоит потребитель. */
  line: number;
  /**
   * Имя, под которым источник лежит в переменной. Если оно есть, самоитератор показывают
   * равенством (`=== g`) — а если источник в коде записан выражением, равнять не с чем.
   */
  selfAs?: string;
  stop: Stop;
  openNote: string;
  firstNote: string;
  moreNote: string;
  doneNote: string;
  stopNote?: string;
  returnNote?: string;
}

interface Scenario extends IterScenarioMeta {
  /** Создать подопытный источник заново. `out` — куда печатает демонстрируемый код. */
  make: (out: string[]) => Source;
  passes: Pass[];
  /** Строка `finally` — на ней стоит протокол во время `return()`. `-1`, если её нет. */
  closeLine: number;
  tone: StepTone;
  verdict: (r: { passes: PassResult[]; next: number; ret: number }) => string;
}

// ---------------------------------------------------------------------------
// Подопытные источники
// ---------------------------------------------------------------------------

/** Фабрика: `[Symbol.iterator]()` каждый раз делает новый генератор. */
const makeFactory = (): Source => ({
  *[Symbol.iterator]() {
    yield 0;
    yield 1;
    yield 2;
  },
});

/** Объект-генератор: он сам себе итератор, и другого у него нет. */
const makeOnce = (): Source => {
  function* gen(): Generator<Value> {
    yield 0;
    yield 1;
    yield 2;
  }
  return gen();
};

/** Генератор, который держит ресурс: освободить его можно только через `finally`. */
const makeLines = (out: string[]): Source => {
  function* lines(): Generator<Value> {
    try {
      yield 'a';
      yield 'b';
      yield 'c';
    } finally {
      out.push('close(file)');
    }
  }
  return lines();
};

const LINES_CODE = [
  'function* lines(file) {',
  '  try {',
  "    yield 'a'; yield 'b'; yield 'c'",
  '  } finally {',
  '    close(file)          // освобождение ресурса',
  '  }',
  '}',
  '',
];

const OPEN_LINES =
  'Вызов `lines(file)` не выполнил ни строки тела — генераторная функция только создаёт объект. `[Symbol.iterator]()` вернул его же.';

const FIRST_LINES =
  'Тело дошло до первого `yield`, и по дороге успело **войти в `try`**. Это условие всего дальнейшего: `finally` сработает только у генератора, который в `try` вошёл.';

// ---------------------------------------------------------------------------
// Сценарии
// ---------------------------------------------------------------------------

const SCENARIO_LIST: Scenario[] = [
  {
    key: 'factory',
    label: 'фабрика',
    prints: false,
    closeLine: -1,
    tone: 'ok',
    code: [
      'const it = {',
      '  *[Symbol.iterator]() {',
      '    yield 0; yield 1; yield 2',
      '  },',
      '};',
      '',
      '[...it];   // проход 1',
      '[...it];   // проход 2',
    ],
    make: makeFactory,
    passes: [
      {
        subject: 'it',
        label: 'проход 1 · [...it]',
        line: 6,
        stop: { kind: 'end' },
        openNote:
          '`[...x]` начинается так же, как `for…of`: у объекта берут метод `[Symbol.iterator]` и зовут его. Метод здесь генераторный, поэтому вызов **не выполняет ни строки тела** — он только создаёт новый объект-генератор со своим состоянием: своей точкой паузы и своими локальными переменными. Сам `it` от вызова не меняется и не знает, что его обходят. Поэтому проходов два: второй проверит, можно ли обойти `it` ещё раз.',
        firstNote:
          'Первый `next()` запускает тело генератора: оно выполняется до первого `yield` и замирает на нём, а отданное значение спред кладёт в массив. Где остановилось тело, помнит итератор — не `it` и не `[...it]`: у спреда есть только собранный массив.',
        moreNote:
          'Следующий `next()` возобновляет тело с того `yield`, на котором оно замерло, и доходит до следующего. Спред о позиции ничего не знает — он только спрашивает «дальше?», пока не услышит `done: true`.',
        doneNote:
          'Тело дошло до конца функции: генератор отвечает `done: true` и закрывается насовсем. Значение из этого ответа в массив не попадает — спред берёт только ответы с `done: false`. `return()` **не вызывается**: итератор дошёл до конца сам, закрывать нечего. Исчерпан этот генератор, а не `it`.',
      },
      {
        subject: 'it',
        label: 'проход 2 · [...it]',
        line: 7,
        stop: { kind: 'end' },
        openNote:
          'Второй спред снова зовёт `it[Symbol.iterator]()` — у **того же объекта** — и получает ещё один генератор, независимый от первого. Первый так и остался исчерпанным, но он никому не нужен: `it` его не хранит и второй раз не отдаёт. `it` здесь — фабрика итераторов, а не итератор.',
        firstNote:
          'Новый генератор начинает тело с самого начала. Путь, пройденный первым, на него не влияет: точка паузы и локальные переменные у каждого свои.',
        moreNote: 'Те же значения в том же порядке: тело выполняется заново, а не продолжает старое.',
        doneNote:
          'Второй генератор исчерпан так же, как первый, а `it` по-прежнему готов к следующему обходу. Так же устроены массивы, `Map`, `Set` и строки: каждый `for…of` по ним получает свежий итератор. У объекта-генератора иначе — его `[Symbol.iterator]()` возвращает `this`, и второй проход достаётся уже исчерпанному итератору (сценарий «сам себе итератор»).',
      },
    ],
    verdict: ({ passes, next, ret }) =>
      `Оба прохода дали ${passes[0].got} и ${passes[1].got}: \`it[Symbol.iterator]()\` вызвали дважды, и оба раза он вернул новый генератор. Вызовов \`next()\` — ${next}, в том числе два последних с \`done: true\`; \`return()\` — ${ret}: оба прохода дошли до конца сами.`,
  },

  {
    key: 'once',
    label: 'сам себе итератор',
    prints: false,
    closeLine: -1,
    tone: 'err',
    code: [
      'function* gen() { yield 0; yield 1; yield 2 }',
      '',
      'const g = gen();   // объект-генератор',
      '',
      '[...g];   // проход 1',
      '[...g];   // проход 2',
    ],
    make: makeOnce,
    passes: [
      {
        subject: 'g',
        label: 'проход 1 · [...g]',
        line: 4,
        selfAs: 'g',
        stop: { kind: 'end' },
        openNote:
          'Метод есть у самого объекта-генератора, и возвращает он `this`: `g[Symbol.iterator]() === g` → `true`. Это разом и iterable, и iterator — отсюда всё остальное.',
        firstNote: 'Генератор отдал значение и замер. Состояние — его собственное, другого экземпляра нет.',
        moreNote: 'Ещё одно значение, ещё одна пауза.',
        doneNote: 'Дошли до конца. Генератор закрыт — навсегда, а не до следующего прохода.',
      },
      {
        subject: 'g',
        label: 'проход 2 · [...g]',
        line: 5,
        selfAs: 'g',
        stop: { kind: 'end' },
        openNote: 'Тот же `g` снова отдаёт себя же. Другого итератора у него нет и быть не может.',
        firstNote: '',
        moreNote: '',
        doneNote:
          'Первый же `next()` отвечает `done: true`. Проход пуст — не потому что значения кончились в источнике, а потому что состояние прохода было одно на всех.',
      },
    ],
    verdict: ({ passes }) =>
      `Первый проход — ${passes[0].got}, второй — ${passes[1].got}. Iterable и iterator совпали в одном объекте, значит, и состояние у них общее: пройти дважды нечем. Наружу поэтому отдают фабрику, а не генератор.`,
  },

  {
    key: 'break',
    label: 'выход по break',
    prints: true,
    closeLine: 4,
    tone: 'ok',
    code: [...LINES_CODE, 'for (const line of lines(file)) {', "  if (line === 'b') break", '}'],
    make: makeLines,
    passes: [
      {
        subject: 'lines(file)',
        label: 'for…of с break',
        line: 8,
        stop: { kind: 'break', at: 'b', line: 9 },
        openNote: OPEN_LINES,
        firstNote: FIRST_LINES,
        moreNote: 'Ещё одно значение, ещё одна пауза. Ресурс всё это время держит генератор, а не цикл.',
        doneNote: 'Проход дошёл до конца сам.',
        stopNote:
          'Цикл уходит. Но просто бросить итератор нельзя: он остался на паузе внутри `try`, и спецификация требует его закрыть — шаг `IteratorClose`.',
        returnNote:
          '`for…of` зовёт `return()` сам. Внутри этого вызова генератор выполняет `finally` — **синхронно, до того как вызов вернёт значение**: `close(file)` уже напечатан. Это единственная точка, где итератор освобождает ресурс.',
      },
    ],
    verdict: ({ passes, next, ret }) =>
      `Взяли ${passes[0].got} и вышли: \`next()\` — ${next}, \`return()\` — ${ret}. Блок \`finally\` отработал, \`close(file)\` в консоли. Без \`return()\` генератор остался бы стоять на \`yield\` внутри \`try\` — с открытым файлом и без единого шанса его закрыть.`,
  },

  {
    key: 'destructure',
    label: 'деструктуризация',
    prints: true,
    closeLine: 4,
    tone: 'ok',
    code: [...LINES_CODE, 'const [first] = lines(file);   // нужен один элемент'],
    make: makeLines,
    passes: [
      {
        subject: 'lines(file)',
        label: 'const [first] = …',
        line: 8,
        stop: { kind: 'take', n: 1 },
        openNote: `${OPEN_LINES} Здесь нет ни цикла, ни \`break\` — но протокол тот же: образец массива тоже потребитель.`,
        firstNote: FIRST_LINES,
        moreNote: 'Очередное значение для очередной позиции образца.',
        doneNote: 'Значения кончились раньше, чем позиции образца: остальным достанется `undefined`.',
        stopNote:
          'Образец заполнен. Итератор при этом **не исчерпан**: он стоит на паузе внутри `try` и держит файл.',
        returnNote:
          'Деструктуризация закрывает итератор тем же `return()`, что и `break`. `finally` выполняется, `close(file)` печатается — хотя ни цикла, ни `break` в коде нет.',
      },
    ],
    verdict: ({ passes, next, ret }) =>
      `Образцу хватило ${passes[0].got}: \`next()\` — ${next}, \`return()\` — ${ret}. Закрытие итератора — не свойство \`for…of\`, а свойство протокола: любой потребитель, бросивший итератор недопройденным, обязан позвать \`return()\`.`,
  },
];

/** Описания сценариев для переключателя и листинга: без исполнения, годятся и на сервере. */
export const SCENARIOS: IterScenarioMeta[] = SCENARIO_LIST.map(({ key, label, code, prints }) => ({
  key,
  label,
  code,
  prints,
}));

/** Страховка от источника, который не кончается: демо не имеет права зациклиться. */
const MAX_STEPS = 32;

function runPass(
  source: Source,
  pass: Pass,
  scenario: Scenario,
  tally: Tally,
  out: string[],
  steps: ProtocolStep[],
  passIndex: number,
): PassResult {
  const got: Value[] = [];
  const list = () => `[${got.map(fmt).join(', ')}]`;

  const push = (call: string, result: string, note: string, line: number, tone?: StepTone) => {
    steps.push({
      call,
      result,
      note,
      tone,
      line,
      next: tally.next,
      ret: tally.ret,
      pass: passIndex,
      got: list(),
      out: [...out],
    });
  };

  const raw = source[Symbol.iterator]();
  const iterator = counted(raw, tally);
  const itself = (raw as unknown) === (source as unknown);

  push(
    `${pass.subject}[Symbol.iterator]()`,
    itself ? (pass.selfAs ? `→ он сам (=== ${pass.selfAs})` : '→ сам генератор') : '→ новый итератор',
    pass.openNote,
    pass.line,
    'info',
  );

  let stopped = false;
  for (let i = 0; i < MAX_STEPS; i += 1) {
    const result = iterator.next();
    const first = i === 0;
    const done = result.done === true;

    // Значение попадает в собранное ДО записи шага: иначе строка журнала показывала бы
    // список без того самого значения, которое в ней же и отдано.
    if (!done) got.push(result.value);

    push(
      'next()',
      shape(result),
      done ? pass.doneNote : first ? pass.firstNote : pass.moreNote,
      pass.line,
      done ? (scenario.key === 'once' && passIndex === 1 ? 'err' : 'warn') : undefined,
    );

    if (done) return { label: pass.label, got: list() };

    if (pass.stop.kind === 'break' && result.value === pass.stop.at) {
      push('break', '— цикл прерван', pass.stopNote ?? '', pass.stop.line, 'warn');
      stopped = true;
      break;
    }
    if (pass.stop.kind === 'take' && got.length >= pass.stop.n) {
      push('образец заполнен', '— значений больше не просят', pass.stopNote ?? '', pass.line, 'warn');
      stopped = true;
      break;
    }
  }

  if (stopped) {
    const closed = iterator.return?.();
    push(
      'return()',
      closed ? shape(closed) : '— метода return() у итератора нет',
      pass.returnNote ?? '',
      scenario.closeLine >= 0 ? scenario.closeLine : pass.line,
      'ok',
    );
  }

  return { label: pass.label, got: list() };
}

/**
 * Прогнать сценарий и получить журнал протокола.
 *
 * Тот же модуль импортирует юнит-тест: демо и тест обязаны спрашивать движок одним кодом.
 */
export function runScenario(key: IterScenarioKey): ProtocolRun {
  const scenario = SCENARIO_LIST.find((s) => s.key === key) ?? SCENARIO_LIST[0];

  const out: string[] = [];
  const tally: Tally = { next: 0, ret: 0 };
  const steps: ProtocolStep[] = [];
  const passes: PassResult[] = [];

  // Источник один на все проходы сценария: в том, что второй проход спрашивает тот же
  // объект, и состоит вся разница между фабрикой и одноразовым генератором.
  const source = scenario.make(out);
  scenario.passes.forEach((pass, i) => {
    passes.push(runPass(source, pass, scenario, tally, out, steps, i));
  });

  return {
    key: scenario.key,
    steps,
    passes,
    next: tally.next,
    ret: tally.ret,
    out: [...out],
    verdict: scenario.verdict({ passes, next: tally.next, ret: tally.ret }),
    tone: scenario.tone,
  };
}
