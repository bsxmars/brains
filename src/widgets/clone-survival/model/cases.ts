import type { CloneCase } from './types';

/**
 * Что переживает structured clone — списком значений, а не таблицей утверждений.
 *
 * Таблица «это можно, это нельзя» есть в любой статье, и ей нечего противопоставить
 * недоверию: она написана человеком и могла устареть. Здесь каждая строка — вызов
 * настоящего `structuredClone` в браузере читателя, а вердикт складывается из проверок
 * клона, а не из заранее написанного ответа: каждый `inspect` вычисляет `verdict` из тех же
 * проверок, что печатает в `note` (до 2026-10-29 вердикт «lossy» стоял константой).
 *
 * Напечатанный `code` — тот же код, что исполняет `make`: `tests/unit/clone-survival.test.ts`
 * прогоняет строку `code` через `new Function` и сверяет исход с `make`. Класс `Money` — тот же,
 * что в листинге темы (`MONEY_CODE` в `content/lessons/workers/data.ts`); совпадение поведения
 * сверяет `tests/unit/workers.test.ts`.
 *
 * Фабрики (`make`) живут здесь, а не в `data.ts` урока, по прозаической причине: пропы
 * острова сериализуются, а функцию через границу не передать. Тот же запрет, о котором
 * и рассказывает урок, — только на границе Astro, а не воркера.
 */

/** Сквозной класс темы (`MONEY_CODE`): приватное поле, геттер и методы на прототипе. */
export class Money {
  #cents: number;
  currency: string;

  constructor(cents: number, currency = 'EUR') {
    this.#cents = cents;
    this.currency = currency;
  }

  get amount(): number {
    return this.#cents / 100;
  }

  format(): string {
    return `${this.amount} ${this.currency}`;
  }

  toDTO(): { cents: number; currency: string } {
    return { cents: this.#cents, currency: this.currency };
  }

  static from(dto: { cents: number; currency: string }): Money {
    return new Money(dto.cents, dto.currency);
  }
}

/** Пример класса, где метод присвоен стрелкой в конструкторе, — ровно тот, что напечатан. */
class P {
  norm: () => number;
  constructor() {
    this.norm = () => 0;
  }
}

/** Есть ли у объекта приватное поле `#cents`: геттер класса читает его и бросает, если поля нет. */
function hasCents(value: object): boolean {
  try {
    Object.getOwnPropertyDescriptor(Money.prototype, 'amount')!.get!.call(value);
    return true;
  } catch {
    return false;
  }
}

const record = (value: unknown) => value as Record<string, unknown>;

export const CLONE_CASES: CloneCase[] = [
  {
    key: 'fn',
    label: 'функция в поле',
    code: "structuredClone({ run: () => 1 })",
    make: () => ({ run: () => 1 }),
    why: 'Функция — замыкание над окружением, где она создана. Перенести её значит перенести и это окружение, вместе со ссылками на DOM и всё остальное непереносимое. Спека даже не пытается.',
    expected: 'throw',
  },
  {
    key: 'arrow-field',
    label: 'стрелка в собственном поле',
    code: 'class P { constructor() { this.norm = () => 0 } }\nstructuredClone(new P())',
    make: () => new P(),
    why: 'Разница с методом принципиальная: метод на прототипе теряется молча, а функция в собственном свойстве ломает сериализацию целиком. Класс с обычными методами «проедет», деградировав до объекта; класс, где методы присвоены стрелками в конструкторе ради привязки this, не проедет вовсе.',
    expected: 'throw',
  },
  {
    key: 'dom',
    label: 'DOM-узел',
    code: "structuredClone(document.createElement('div'))",
    make: () => document.createElement('div'),
    why: 'Шагов сериализации для узлов спецификация не описала — как и для большинства встроенных объектов браузера. Узел принадлежит дереву документа, а дерево принадлежит главному потоку.',
    expected: 'throw',
    browserOnly: true,
  },
  {
    key: 'proxy',
    label: 'реактивный объект (Proxy)',
    code: 'structuredClone(new Proxy({ count: 1 }, {}))',
    make: () => new Proxy({ count: 1 }, {}),
    why: 'Алгоритм первым делом проверяет, не прокси ли перед ним, и бросает: поведение прокси задают ловушки, то есть функции. Практическая боль — reactive() из Vue, observable из MobX и черновики Immer: перед отправкой нужен toRaw() во Vue, toJS() в MobX или current() в Immer.',
    expected: 'throw',
  },
  {
    key: 'signal',
    label: 'AbortSignal',
    code: 'structuredClone(AbortSignal.abort())',
    make: () => AbortSignal.abort(),
    why: 'У сигнала есть слушатели, то есть функции, привязанные к своему агенту. Поэтому отмену через границу воркера не передать — на главном потоке сигнал может только запустить что-то другое: сообщение «отмена», общий флажок или terminate(). В Node тот же вызов не бросает, но и сигнала не передаёт: копия — пустой объект, без aborted и без событий. Ещё один повод не переносить выводы из Node в браузер.',
    expected: 'throw',
    // Исход движкозависимый: в браузере DataCloneError, в Node 26.8.2 — пустой `{}` без ошибки
    // (молчаливая потеря, а не «клонируется»). Урок говорит про браузер, поэтому в Node этот
    // случай не проверяется.
    browserOnly: true,
  },
  {
    key: 'weak',
    label: 'WeakMap',
    code: 'structuredClone(new WeakMap())',
    make: () => new WeakMap(),
    why: 'Содержимое слабой коллекции принципиально ненаблюдаемо: перечислить нельзя — значит, и скопировать нельзя.',
    expected: 'throw',
  },
  {
    key: 'detached',
    label: 'уже отсоединённый ArrayBuffer',
    code: 'const b = new ArrayBuffer(8)\nb.transfer()\nstructuredClone(b)',
    make: () => {
      const buffer = new ArrayBuffer(8);
      buffer.transfer();
      return buffer;
    },
    why: 'Данных у такого буфера больше нет — копировать нечего. Именно этот случай и получается, когда буфер второй раз отправляют в воркер, забыв, что первый раз его перенесли.',
    expected: 'throw',
  },
  {
    key: 'class',
    label: 'экземпляр класса Money',
    code: 'structuredClone(new Money(1250))',
    make: () => new Money(1250),
    inspect: (clone) => {
      const value = record(clone);
      const keys = Object.keys(value).join(', ');
      const kept = {
        instance: clone instanceof Money,
        format: typeof value.format === 'function',
        amount: 'amount' in value,
        cents: hasCents(value),
      };
      return {
        verdict: Object.values(kept).every(Boolean) ? 'ok' : 'lossy',
        note: `приехало { ${keys} } · instanceof Money: ${kept.instance} · метод format: ${typeof value.format} · геттер amount: ${kept.amount ? 'есть' : 'его нет'} · прототип: ${Object.getPrototypeOf(clone) === Object.prototype ? 'Object.prototype' : 'свой'} · приватное #cents: ${kept.cents ? 'есть' : 'его нет'}`,
      };
    },
    why: 'И методы, и геттеры класса живут на прототипе, прототип — объект с функциями, функции не переносятся; клону выставляется Object.prototype. Отсюда неочевидное: геттер класса в клон не попадает **вовсе** — в отличие от геттера в литерале объекта, который сериализатор вызовет и положит значением.',
    expected: 'lossy',
  },
  {
    key: 'getter',
    label: 'геттер',
    code: 'structuredClone({ get lazy() { return 42 } })',
    make: () => ({
      get lazy() {
        return 42;
      },
    }),
    inspect: (clone) => {
      const descriptor = Object.getOwnPropertyDescriptor(record(clone), 'lazy');
      return {
        verdict: descriptor?.get ? 'ok' : 'lossy',
        note: `у клона lazy — ${descriptor?.get ? 'геттер' : 'обычное поле'} со значением ${String(record(clone).lazy)}`,
      };
    },
    why: 'Сериализатор берёт собственные перечисляемые ключи и читает каждый обычным образом, как obj.lazy, — то есть вызывает геттер прямо во время клонирования, на потоке отправителя, и кладёт в копию значение. Ленивое вычисление на 200 мс в геттере превращается в 200 мс внутри postMessage — и в профайлере это выглядит необъяснимо дорогой отправкой.',
    expected: 'lossy',
  },
  {
    key: 'frozen',
    label: 'Object.freeze',
    code: 'structuredClone(Object.freeze({ a: 1 }))',
    make: () => Object.freeze({ a: 1 }),
    inspect: (clone) => {
      const value = record(clone);
      const frozen = Object.isFrozen(clone);
      try {
        value.a = 2;
      } catch {
        // запись в замороженный объект в строгом режиме бросает — это и есть «заморозка цела»
      }
      return {
        verdict: frozen ? 'ok' : 'lossy',
        note: `Object.isFrozen(клон): ${frozen} · после записи a = ${String(value.a)}`,
      };
    },
    why: 'Настройки свойств (дескрипторы) не переносятся: всё становится обычными свойствами, которые можно менять, перечислять и удалять. Полагались на заморозку как на гарантию — на той стороне гарантии нет.',
    expected: 'lossy',
  },
  {
    key: 'symbol-key',
    label: 'свойство с ключом-символом',
    code: "structuredClone({ [Symbol('id')]: 1, plain: 2 })",
    make: () => ({ [Symbol('id')]: 1, plain: 2 }),
    inspect: (clone) => {
      const keys = Reflect.ownKeys(record(clone));
      const lost = !keys.some((key) => typeof key === 'symbol');
      return {
        verdict: lost ? 'lossy' : 'ok',
        note: `ключей у клона: ${keys.length} (${keys.map(String).join(', ')})${lost ? ' — символьный ключ исчез без ошибки и без предупреждения' : ''}`,
      };
    },
    why: 'Символ уникален по определению, скопировать его нельзя. Значение-символ роняет клонирование с ошибкой, а вот ключ-символ пропадает молча — и это разные по опасности вещи.',
    expected: 'lossy',
  },
  {
    key: 'regexp',
    label: 'RegExp с lastIndex',
    code: 'const r = /ab/g\nr.lastIndex = 1\nstructuredClone(r)',
    make: () => {
      const re = /ab/g;
      re.lastIndex = 1;
      return re;
    },
    inspect: (clone) => {
      const re = clone as RegExp;
      return {
        verdict: re instanceof RegExp && re.lastIndex === 1 ? 'ok' : 'lossy',
        note: `RegExp: ${re instanceof RegExp} · source=${re.source} · flags=${re.flags} · lastIndex=${re.lastIndex} (отправляли 1)`,
      };
    },
    why: 'Переносятся только исходный текст выражения и флаги — так записано в спецификации. Позиция поиска в этот список не входит, поэтому клон глобального регэкспа начинает читать строку с начала.',
    expected: 'lossy',
  },
  {
    key: 'map',
    label: 'Map, Set, Date, BigInt, undefined',
    code: "structuredClone({ m: new Map([['a', 1]]), s: new Set([1]), d: new Date(0), b: 10n, u: undefined })",
    make: () => ({ m: new Map([['a', 1]]), s: new Set([1]), d: new Date(0), b: 10n, u: undefined }),
    inspect: (clone) => {
      const value = record(clone);
      const kept = [value.m instanceof Map, value.s instanceof Set, value.d instanceof Date, typeof value.b === 'bigint', 'u' in value];
      return {
        verdict: kept.every(Boolean) ? 'ok' : 'lossy',
        note: `Map: ${value.m instanceof Map} · Set: ${value.s instanceof Set} · Date: ${value.d instanceof Date} · BigInt: ${typeof value.b} · ключ u на месте: ${'u' in value}`,
      };
    },
    why: 'Ровно то, ради чего алгоритм и существует: JSON превратил бы Map и Set в {}, Date — в строку, а BigInt и undefined потерял бы совсем.',
    expected: 'ok',
  },
  {
    key: 'cycle',
    label: 'цикл и общий объект',
    code: 'const inner = { n: 1 }\nconst src = { a: inner, b: inner }\nsrc.self = src\nstructuredClone(src)',
    make: () => {
      const inner = { n: 1 };
      const source = { a: inner, b: inner } as Record<string, unknown>;
      source.self = source;
      return source;
    },
    inspect: (clone) => {
      const value = record(clone);
      return {
        verdict: value.a === value.b && value.self === clone ? 'ok' : 'lossy',
        note: `a === b: ${value.a === value.b} (один объект остался одним) · self === клон: ${value.self === clone} (цикл указывает на сам клон)`,
      };
    },
    why: 'Сериализатор ведёт таблицу «этот объект уже записан вот здесь» и на повторной встрече пишет ссылку, а не обходит заново. JSON.stringify такой таблицы не ведёт: он бы размножил inner в два независимых объекта — тихо поменяв смысл данных, — а на цикле просто упал.',
    expected: 'ok',
  },
];
