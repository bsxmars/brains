import type { InstanceofCaseKey, InstanceofRun, InstanceofStep } from './types';

/**
 * `instanceof` по шагам — выполнением, а не пересказом.
 *
 * Раздел утверждает: оператор не проверяет тип, а читает `B[Symbol.hasInstance]` и вызывает его.
 * Утверждение сильное, и списком из трёх пунктов оно не доказывается — поэтому здесь три случая,
 * и каждый спрашивает движок по-настоящему:
 *
 * 1. **обычный класс** — собственного `Symbol.hasInstance` нет, берётся унаследованный
 *    `Function.prototype[Symbol.hasInstance]`, и он делает обычный обход цепочки. Шаги обхода
 *    не написаны заранее: их складывает `walk()`, сравнивая настоящие объекты;
 * 2. **`Symbol.hasInstance`** — метод свой, и `2 instanceof Even` истинно **для числа**.
 *    Цепочки нет вообще: примитив до обхода бы даже не дошёл;
 * 3. **переприсвоенный `prototype`** — связь ставилась при `new`, читается сейчас.
 *
 * Логика вынесена из компонента по правилу курса: тест импортирует этот же модуль, и демо
 * с тестом разойтись не могут.
 *
 * ⚠️ **Случай 3 обязан быть на функции, а не на классе — и это не стилистика.** У класса
 * свойство `prototype` неперезаписываемо (`writable: false`), поэтому `C.prototype = {}`
 * в строгом режиме бросает `TypeError: Cannot assign to read only property 'prototype'`.
 * У функции-конструктора `prototype` перезаписываем, и классический разрыв связи
 * воспроизводится. Отказ класса показан рядом настоящим исключением, а не словами.
 */

export const CASES: { value: InstanceofCaseKey; label: string }[] = [
  { value: 'chain', label: 'обычный класс' },
  { value: 'hasInstance', label: 'Symbol.hasInstance' },
  { value: 'reassigned', label: 'переприсвоенный prototype' },
];

/** Имена звеньев по их настоящей identity: подписи не угадываются, а задаются автором случая. */
type Labels = Map<unknown, string>;

/**
 * Как назвать звено цепочки.
 *
 * Сначала — по identity: свежий `{}` в роли нового `prototype` формально имеет
 * `constructor === Object`, и эвристика по имени конструктора назвала бы его
 * «Object.prototype», то есть соврала бы ровно в том случае, ради которого демо и сделано.
 */
function nameOf(proto: object | null, labels: Labels): string {
  if (proto === null) return 'null';
  const known = labels.get(proto);
  if (known) return known;
  const ctor = (proto as { constructor?: { name?: string } }).constructor;
  return ctor?.name ? `${ctor.name}.prototype` : 'объект без конструктора';
}

interface Walk {
  steps: InstanceofStep[];
  verdict: boolean;
  walked: boolean;
}

/**
 * OrdinaryHasInstance — тот самый обход, который делает унаследованный
 * `Function.prototype[Symbol.hasInstance]`.
 *
 * Повторён здесь по шагам не ради другого результата, а ради видимости: настоящий оператор
 * отвечает одним словом, а урок объясняет, из чего это слово сложилось. Вердикт всё равно
 * сверяется с настоящим `instanceof` в `runInstanceof`.
 */
/*
 * ⚠️ Имена `left` и `targetName` — из кода случая (`dog`, `` `Animal.prototype` ``), а не из спецификации.
 * До 2026-10-05 шаги говорили «`Object.getPrototypeOf(a)`», «не `B.prototype`» — обозначения
 * из ECMA-262 (`a instanceof B`), которых в показанном коде нет. Автор курса: «а что за
 * B.prototype?». Читатель видит `dog instanceof Animal`, и шаги обязаны называть то же.
 * `targetName` — готовая подпись того, с чем сверяют, с разметкой: в случае с подменой это
 * «новый `Legacy.prototype`», иначе шаг читался бы «прежний Legacy.prototype — не Legacy.prototype».
 */
function walk(value: unknown, target: object, labels: Labels, line: number, left: string, targetName: string): Walk {
  const steps: InstanceofStep[] = [];

  // Примитив до обхода не доходит: OrdinaryHasInstance требует объект и иначе сразу отвечает false.
  if (Object(value) !== value) {
    steps.push({
      text: `Левый операнд — примитив (\`${String(value)}\`). Обычная проверка на этом и кончается: обходить нечего, ответ — \`false\`.`,
      line,
      probe: `${typeof value} ${String(value)}`,
      match: false,
      tone: 'warn',
    });
    return { steps, verdict: false, walked: false };
  }

  let proto = Object.getPrototypeOf(value as object) as object | null;
  steps.push({
    text: `Взять \`Object.getPrototypeOf(${left})\` — первое звено цепочки.`,
    line,
    probe: nameOf(proto, labels),
    match: null,
    tone: 'info',
  });

  // Ограничитель на случай рукотворной кольцевой цепочки: демо обязано остановиться само.
  for (let guard = 0; guard < 50; guard += 1) {
    if (proto === null) {
      steps.push({
        text: 'Звено — `null`: цепочка кончилась, совпадения не было. Ответ — `false`.',
        line,
        probe: 'null',
        match: false,
        tone: 'err',
      });
      return { steps, verdict: false, walked: true };
    }

    if (proto === target) {
      steps.push({
        text: `Звено совпало с ${targetName}. Ответ — \`true\`.`,
        line,
        probe: nameOf(proto, labels),
        match: true,
        tone: 'ok',
      });
      return { steps, verdict: true, walked: true };
    }

    // «прежний Legacy.prototype» — слово снаружи кода, имя внутри: иначе «прежний» читается как часть кода.
    const current = nameOf(proto, labels).replace(/^(прежний|новый) (.+)$/, '$1 `$2`').replace(/^([^`]+)$/, '`$1`');
    proto = Object.getPrototypeOf(proto) as object | null;
    steps.push({
      text: `${current[0].toUpperCase()}${current.slice(1)} — не ${targetName}. Поднимаемся выше.`,
      line,
      probe: nameOf(proto, labels),
      match: false,
      tone: 'info',
    });
  }

  return { steps, verdict: false, walked: true };
}

/** Прочитать `Symbol.hasInstance` так, как это делает сам оператор, и рассказать, что нашлось. */
function hasInstanceStep(ctor: object, line: number, right: string): { step: InstanceofStep; own: boolean; sees: boolean } {
  const own = Object.hasOwn(ctor, Symbol.hasInstance);
  const sees = Symbol.hasInstance in ctor;

  const read = `Прочитать \`${right}[Symbol.hasInstance]\``;
  const text = own
    ? `${read} — **собственный** метод есть. Вызвать его и вернуть результат. Всё: цепочка не понадобится.`
    : sees
      ? `${read} — собственного нет, найден унаследованный \`Function.prototype[Symbol.hasInstance]\`. Он и делает обычный обход цепочки.`
      : `${read} — не нашлось ничего.`;

  return {
    step: { text, line, probe: own ? 'собственный метод' : 'Function.prototype[Symbol.hasInstance]', match: null, tone: own ? 'warn' : 'info' },
    own,
    sees,
  };
}

/** Случай 1: обычный класс, подъём по цепочке. */
function runChain(): InstanceofRun {
  class Animal {}
  class Dog extends Animal {}
  const dog = new Dog();

  const code = ['class Animal {}', 'class Dog extends Animal {}', 'const dog = new Dog();', '', 'dog instanceof Animal;'];
  const line = 4;

  const labels: Labels = new Map<unknown, string>([
    [Dog.prototype, 'Dog.prototype'],
    [Animal.prototype, 'Animal.prototype'],
    [Object.prototype, 'Object.prototype'],
  ]);

  const head = hasInstanceStep(Animal, line, 'Animal');
  const walked = walk(dog, Animal.prototype, labels, line, 'dog', '`Animal.prototype`');
  const verdict = dog instanceof Animal;

  return {
    key: 'chain',
    label: 'обычный класс',
    code,
    expression: 'dog instanceof Animal',
    verdict,
    before: null,
    steps: [head.step, ...walked.steps],
    walked: walked.walked,
    ownHasInstance: head.own,
    seesHasInstance: head.sees,
    errorName: '',
    error: '',
    result:
      'Даже «обычный» `instanceof` — это вызов метода: своего у класса нет, поэтому сработал унаследованный `Function.prototype[Symbol.hasInstance]`, и уже он прошёл по цепочке.',
    tone: verdict ? 'ok' : 'err',
  };
}

/**
 * Случай 2: собственный `Symbol.hasInstance` — и `true` для числа.
 *
 * ⚠️ Приведение `probe as object` — чисто типовое и на значение не влияет: в `probe` лежит
 * число `2`, и оператор получает именно его. Без приведения TypeScript не пропускает примитив
 * слева от `instanceof`, а подменять число объектом значило бы убить весь смысл случая.
 */
function runHasInstance(): InstanceofRun {
  class Even {
    static [Symbol.hasInstance](value: unknown): boolean {
      return typeof value === 'number' && value % 2 === 0;
    }
  }

  const code = [
    'class Even {',
    '  static [Symbol.hasInstance](n) {',
    '    return n % 2 === 0;',
    '  }',
    '}',
    '',
    '2 instanceof Even;',
  ];
  const line = 6;

  const probe: unknown = 2;
  const head = hasInstanceStep(Even, line, 'Even');
  const verdict = (probe as object) instanceof Even;

  const steps: InstanceofStep[] = [
    head.step,
    {
      text: `Метод вызван с левым операндом: \`2 % 2 === 0\` → \`${String(verdict)}\`. Это и есть ответ оператора.`,
      line,
      probe: String(verdict),
      match: verdict,
      tone: verdict ? 'ok' : 'err',
    },
    {
      /* ⚠️ Было «…обычная проверка отбросила бы примитив ещё до обхода» (2026-10-05, автор
         курса: «а тут всё норм?»). Невнятно и без главного: без своего метода ответ для числа
         был бы `false` сразу. Это сверяет тест «instanceof · примитив без своего метода». */
      text: `Цепочку никто не смотрел. Без своего метода ответ был бы \`false\` сразу: для примитива обычная проверка цепочку не ищет, хотя у числа она есть — \`Object.getPrototypeOf(2)\` это \`Number.prototype\`. Метод обошёл и это правило.`,
      line,
      probe: 'цепочка не понадобилась',
      match: null,
      tone: 'warn',
    },
  ];

  return {
    key: 'hasInstance',
    label: 'Symbol.hasInstance',
    code,
    expression: '2 instanceof Even',
    verdict,
    before: null,
    steps,
    walked: false,
    ownHasInstance: head.own,
    seesHasInstance: head.sees,
    errorName: '',
    error: '',
    result:
      '`2 instanceof Even` истинно — **для числа**, у которого никакого `Even` в цепочке нет и быть не может. Прототипы здесь ни при чём: оператор просто вызвал метод. Поэтому `x instanceof SomeClass` не гарантирует, что `x` создан этим классом: класс сам решает, что ответить.',
    tone: 'warn',
  };
}

/**
 * Случай 3: связь ставилась при `new`, читается сейчас.
 *
 * Конструктор — функция, а не класс, потому что у класса `prototype` защищён от записи
 * (`writable: false`). Отказ класса ловится тут же настоящим `try/catch`: его имя — часть ответа.
 */
function runReassigned(): InstanceofRun {
  function Legacy(this: object) {}
  const Ctor = Legacy as unknown as { new (): object; prototype: object };

  const live = new Ctor();
  const oldProto = Ctor.prototype;
  const before = live instanceof Ctor;

  const code = [
    'function Legacy() {}',
    'const live = new Legacy();',
    '',
    'live instanceof Legacy;   // до',
    'Legacy.prototype = {};    // у class здесь TypeError',
    'live instanceof Legacy;   // после',
  ];

  /*
   * Настоящая попытка сделать то же самое с классом — ради имени ошибки, а не ради текста.
   * ⚠️ Класс называется `Legacy`, как функция в показанном коде (2026-10-05). Был `Strict`,
   * и читатель видел «…of function 'class Strict {}'» — объект, которого в коде нет.
   * Имя попадает в сообщение V8 из исходника класса, поэтому оно и должно совпадать.
   */
  let errorName = '';
  let error = '';
  try {
    class Legacy {}
    (Legacy as unknown as { prototype: object }).prototype = {};
  } catch (caught) {
    errorName = caught instanceof Error ? caught.name : 'Error';
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
  }

  const newProto = {};
  Ctor.prototype = newProto;
  const verdict = live instanceof Ctor;

  const labels: Labels = new Map<unknown, string>([
    [oldProto, 'прежний Legacy.prototype'],
    [newProto, 'новый Legacy.prototype'],
    [Object.prototype, 'Object.prototype'],
  ]);

  const head = hasInstanceStep(Ctor as unknown as object, 5, 'Legacy');
  const walked = walk(live, Ctor.prototype, labels, 5, 'live', 'новый `Legacy.prototype`');

  const steps: InstanceofStep[] = [
    {
      text: `\`new Legacy()\` записал в объект ссылку на **тот** \`prototype\`, что был в этот момент. До подмены ответ — \`${String(before)}\`.`,
      line: 3,
      probe: 'прежний Legacy.prototype',
      match: before,
      tone: before ? 'ok' : 'err',
    },
    {
      text: '`Legacy.prototype = {}` — у функции это свойство перезаписываемо: теперь в нём новый пустой объект. Сам `live` при этом не трогали, он по-прежнему ссылается на прежний прототип.',
      line: 4,
      probe: 'новый Legacy.prototype',
      match: null,
      tone: 'warn',
    },
    head.step,
    ...walked.steps,
  ];

  return {
    key: 'reassigned',
    label: 'переприсвоенный prototype',
    code,
    expression: 'live instanceof Legacy',
    verdict,
    before,
    steps,
    walked: walked.walked,
    ownHasInstance: head.own,
    seesHasInstance: head.sees,
    errorName,
    error,
    result:
      'Тот же самый объект: был `true`, стал `false`. Оператор сравнивает с тем `prototype`, который лежит в конструкторе **сейчас**, а связь в объекте записана в момент `new`.',
    tone: 'err',
  };
}

const RUNNERS: Record<InstanceofCaseKey, () => InstanceofRun> = {
  chain: runChain,
  hasInstance: runHasInstance,
  reassigned: runReassigned,
};

/** Выполнить один случай начисто. Свежие классы и объекты на каждый прогон — иначе случай 3 соврёт со второго клика. */
export function runInstanceof(key: InstanceofCaseKey): InstanceofRun {
  return RUNNERS[key]();
}

/** Все три случая разом — их и показывает демо. */
export function runAllInstanceof(): InstanceofRun[] {
  return CASES.map((item) => runInstanceof(item.value));
}
