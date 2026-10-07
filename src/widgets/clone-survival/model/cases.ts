import type { CloneCase } from './types';

/**
 * Что переживает structured clone — списком значений, а не таблицей утверждений.
 *
 * Таблица «это можно, это нельзя» есть в любой статье, и ей нечего противопоставить
 * недоверию: она написана человеком и могла устареть. Здесь каждая строка — вызов
 * настоящего `structuredClone` в браузере читателя, а вердикт складывается из проверок
 * клона, а не из заранее написанного ответа.
 *
 * Фабрики (`make`) живут здесь, а не в `data.ts` урока, по прозаической причине: пропы
 * острова сериализуются, а функцию через границу не передать. Тот же запрет, о котором
 * и рассказывает урок, — только на границе Astro, а не воркера.
 */

/** Доменный объект из §3.3 конспекта: приватное поле, геттер и метод на прототипе. */
class Money {
  #cents: number;
  currency = 'EUR';

  constructor(cents: number) {
    this.#cents = cents;
  }

  get amount(): number {
    return this.#cents / 100;
  }

  format(): string {
    return `${this.amount} ${this.currency}`;
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
    make: () => {
      const point = { x: 3 } as Record<string, unknown>;
      point.norm = () => 0;
      return point;
    },
    why: 'Разница с методом принципиальная: метод на прототипе теряется молча, а функция в собственном свойстве ломает сериализацию целиком. Класс с обычными методами «проедет», деградировав до объекта; класс, где методы присвоены стрелками в конструкторе ради привязки this, не проедет вовсе.',
    expected: 'throw',
  },
  {
    key: 'dom',
    label: 'DOM-узел',
    code: "structuredClone(document.createElement('div'))",
    make: () => document.createElement('div'),
    why: 'Шагов сериализации для узлов спека не описала — как и для большинства platform-объектов. Узел принадлежит дереву документа, а дерево принадлежит главному потоку.',
    expected: 'throw',
    browserOnly: true,
  },
  {
    key: 'proxy',
    label: 'реактивный объект (Proxy)',
    code: 'structuredClone(new Proxy({ count: 1 }, {}))',
    make: () => new Proxy({ count: 1 }, {}),
    why: 'Спека проверяет внутренний слот [[ProxyHandler]] и бросает: поведение прокси задают ловушки, то есть функции. Практическая боль — reactive() из Vue, observable из MobX, драфты immer: перед отправкой нужен toRaw() / toJS() / current().',
    expected: 'throw',
  },
  {
    key: 'signal',
    label: 'AbortSignal',
    code: 'structuredClone(AbortSignal.abort())',
    make: () => AbortSignal.abort(),
    why: 'У сигнала есть слушатели, то есть функции, привязанные к своему агенту. Поэтому отмену через границу воркера не передать — на главном потоке сигнал остаётся только триггером, запускающим сообщение, общий флаг или terminate(). В Node 24.11, к слову, тот же вызов проходит: сигнал там клонируется. Ещё один повод не переносить выводы из Node в браузер.',
    expected: 'throw',
    // Исход движкозависимый: в браузере DataCloneError, в Node клон получается. Урок говорит
    // про браузер, поэтому в Node этот случай не проверяется — иначе тест закреплял бы неправду.
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
    label: 'уже detached ArrayBuffer',
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
    label: 'класс с приватным полем',
    code: 'class Money { #cents; get amount() {…} format() {…} }\nstructuredClone(new Money(1250))',
    make: () => new Money(1250),
    inspect: (clone) => {
      const value = record(clone);
      const keys = Object.keys(value).join(', ');
      return {
        verdict: 'lossy',
        note: `приехало { ${keys} } · instanceof Money: ${clone instanceof Money} · метод format: ${typeof value.format} · геттер amount: ${'amount' in value ? 'есть' : 'его нет'} · прототип: ${Object.getPrototypeOf(clone) === Object.prototype ? 'Object.prototype' : 'свой'} · приватного #cents нет`,
      };
    },
    why: 'И методы, и геттеры класса живут на прототипе, прототип — объект с функциями, функции не переносятся; клону выставляется Object.prototype. Отсюда неочевидное: геттер класса в клон не попадает **вовсе** — в отличие от геттера в литерале объекта, который сериализатор вызовет и положит значением. Отсюда же правило проектирования: через границу воркера ходят DTO, а доменные объекты собираются на приёмной стороне явно.',
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
        verdict: 'lossy',
        note: `у клона lazy — ${descriptor?.get ? 'геттер' : 'обычное поле'} со значением ${String(record(clone).lazy)}; сам геттер вызвался во время клонирования, на этом потоке`,
      };
    },
    why: 'Сериализатор берёт собственные перечисляемые ключи и делает по ним обычный [[Get]]. Ленивое вычисление на 200 мс в геттере превращается в 200 мс внутри postMessage — и в профайлере это выглядит необъяснимо дорогой отправкой.',
    expected: 'lossy',
  },
  {
    key: 'frozen',
    label: 'Object.freeze',
    code: 'structuredClone(Object.freeze({ a: 1 }))',
    make: () => Object.freeze({ a: 1 }),
    inspect: (clone) => {
      const value = record(clone);
      value.a = 2;
      return {
        verdict: 'lossy',
        note: `Object.isFrozen(клон): ${Object.isFrozen(clone)} · запись прошла, a = ${String(value.a)}`,
      };
    },
    why: 'Дескрипторы не переносятся: всё становится обычными data-свойствами с writable, enumerable и configurable. Полагались на заморозку как на гарантию — на той стороне гарантии нет.',
    expected: 'lossy',
  },
  {
    key: 'symbol-key',
    label: 'свойство с ключом-символом',
    code: "structuredClone({ [Symbol('id')]: 1, plain: 2 })",
    make: () => ({ [Symbol('id')]: 1, plain: 2 }),
    inspect: (clone) => ({
      verdict: 'lossy',
      note: `ключей у клона: ${Reflect.ownKeys(record(clone)).length} (${Reflect.ownKeys(record(clone)).map(String).join(', ')}) — символьный ключ исчез без ошибки и без предупреждения`,
    }),
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
        verdict: 'lossy',
        note: `RegExp: ${re instanceof RegExp} · source=${re.source} · flags=${re.flags} · lastIndex=${re.lastIndex} (отправляли 1)`,
      };
    },
    why: 'Переносятся исходный текст и флаги — их спека называет прямо ([[OriginalSource]] и [[OriginalFlags]]). Позиция поиска в них не входит, поэтому клон глобального регэкспа начинает читать строку с начала.',
    expected: 'lossy',
  },
  {
    key: 'map',
    label: 'Map, Set, Date, BigInt, undefined',
    code: "structuredClone({ m: new Map([['a', 1]]), s: new Set([1]), d: new Date(0), b: 10n, u: undefined })",
    make: () => ({ m: new Map([['a', 1]]), s: new Set([1]), d: new Date(0), b: 10n, u: undefined }),
    inspect: (clone) => {
      const value = record(clone);
      return {
        verdict: 'ok',
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
        verdict: 'ok',
        note: `a === b: ${value.a === value.b} (один объект остался одним) · self === клон: ${value.self === clone} (цикл указывает на сам клон)`,
      };
    },
    why: 'Сериализатор ведёт memory map «объект → его готовое представление» и на повторной встрече пишет ссылку, а не обходит заново. JSON.stringify карты не ведёт: он бы размножил inner в два независимых объекта — тихо поменяв семантику данных, — а на цикле просто упал.',
    expected: 'ok',
  },
];
