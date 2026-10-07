import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { runInNewContext } from 'node:vm';
import { runSet } from '@/widgets/set-algorithm/model/run';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  ANATOMY_CHAIN,
  ANATOMY_PROPS,
  ANATOMY_SLOTS,
  ANATOMY_READING,
  CI_BASE,
  CI_CHILD,
  CI_STEPS,
  DECORATOR_CODE,
  DECORATOR_INIT_CODE,
  DECORATOR_PRIVATE_CODE,
  DECORATOR_FACTS,
  DESC_ACCESSOR,
  DESC_DATA,
  DESC_DEFAULTS,
  DESC_MIX_NOTE,
  ENUM_HEAD,
  ENUM_ROWS,
  FACTORY_CODE,
  GEN_CODE,
  ITER_HELPERS_CODE,
  GEN_LABELS,
  GEN_LINES,
  GET_CHAIN,
  GET_KEYS,
  GET_VALUES,
  KEY_ORDER_CHIPS,
  KEY_ORDER_CODE,
  KEY_ORDER_NOTE,
  KEY_ORDER_RULES,
  LAB_SNIPPETS,
  LOCK_HEAD,
  LOCK_ROWS,
  NEW_NOTE_CODE,
  ONCE_CODE,
  PRIVATE_PROBES,
  PRIVATE_SLOT,
  SAMPLE_CODE,
  SET_SCENARIOS,
  INIT_BUG_CODE,
  INIT_BUG_NOTE,
  INSTANCEOF_STEPS,
  INSTANCEOF_BREAKS,
  SUPER_VIA_THIS_CODE,
  SUPER_REAL_CODE,
  HOME_OBJECT_CODE,
  HOME_OBJECT_NOTE,
  STATIC_BLOCK_CODE,
  STATIC_BLOCK_FACTS,
  INSTANCEOF_NOTE,
  PROTO_CODE,
  HOOK_ROWS,
  DOG_INSPECT,
  CLASS_IS_ROWS,
  PROTO_OPENER,
  PROTO_VS_PROBES,
  PROTO_THREE,
  PROTO_THREE_LEAD,
  PROTO_LITERAL_RULE,
  DESC_OPENER,
  LOCK_OPENER,
  WEAKMAP_PRIVATE_CODE,
  WEAKMAP_VS_SLOT,
} from '@/content/lessons/object-model/data';
// Те же модули, что выполняются у читателя в демо. Импорт именно их — и есть весь смысл
// блока «демо и таблица спрашивают движок одинаково» ниже.
import { OPS as ENUM_OPS, runEnum } from '@/widgets/enum-probe/model/probe';
import { buildOrder } from '@/widgets/key-order/model/build';
import { runInstanceof } from '@/widgets/instanceof-lab/model/run';
import { runScenario } from '@/widgets/iter-protocol/model/protocol';
import { LEVELS, OPS as LOCK_OPS, runLock } from '@/widgets/lock-lab/model/run';
import { buildLookup } from '@/widgets/lookup-chain/model/lookup';

/**
 * Утверждения урока «Объектная модель» — запуском, а не по памяти.
 *
 * Таблицы урока набраны руками и помечены «сверено запуском», но этот запуск был разовым:
 * `npm test` его не повторял, и разойтись с движком таблицы могли молча. Здесь каждая
 * из них сверяется с результатом настоящего выполнения — ожидания не переписаны в тест,
 * а вычислены. Поэтому падение такого теста означает ровно одно: на странице написана
 * неправда, и читатель узнает об этом позже нас.
 *
 * ⚠️ Из урока сюда намеренно не попало то, что из самого JS не наблюдаемо: dictionary mode
 * после `delete` (8.6), обвал inline cache при мутации прототипа (8.3) и межреалмовый
 * `instanceof`. Проверка через `%HasFastProperties` жила бы уже не в языке, а в отладочном
 * режиме V8 — как в `elements-kinds.test.ts`, и это отдельная история.
 */

/** Формат вывода `console.log` в демо: массивы печатаются как `[a, b]`, дырки — словом. */
function show(value: unknown): string {
  return Array.isArray(value) ? `[${value.map(show).join(', ')}]` : String(value);
}

/** Выполнить операцию и сказать, получилась ли она. Бросок наружу не пускаем — он и есть ответ. */
function succeeds(op: () => void): { ok: boolean; error: unknown } {
  try {
    op();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Раздел 1: схема, демо и сквозной пример — одно и то же, проверенное движком.
 *
 * ⚠️ Здесь исполняется **сама строка со страницы**, а не её копия. `SAMPLE_CODE` печатается
 * читателю через `CodeBlock` и тем же текстом уходит в `new Function`. Копия, переписанная
 * в тест руками, проверяла бы саму себя: разойтись с картинкой она может ровно так же, как
 * картинка с движком.
 *
 * До этого блока у демо чтения не было проверок вовсе — при том, что докстринг `buildLookup`
 * обещает, что цепочка на странице сверена с настоящим объектом.
 */
/**
 * Крючок в начале темы: пять ответов движка об объекте `dog`. Ответы на странице не набраны
 * руками — здесь каждое выражение исполняется над тем же `SAMPLE_CODE` и сверяется с `out`.
 */
describe('вступление: пять строк про dog — ответы движка', () => {
  it('console.log(dog) печатает то, что показано на странице', async () => {
    const { inspect } = await import('node:util');
    const { dog } = new Function('"use strict";' + SAMPLE_CODE + '; return { dog };')();
    expect(DOG_INSPECT.split('\n')[1]).toBe('// ' + inspect(dog));
  });

  const show = (v: unknown): string =>
    typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? `[${v.map(show).join(', ')}]` : String(v);

  it.each(HOOK_ROWS)('$expr → $out', (row) => {
    const { dog, Dog } = new Function('"use strict";' + SAMPLE_CODE + '; return { dog, Dog };')();
    const value = new Function('dog', 'Dog', `return ${row.expr};`)(dog, Dog);
    expect(show(value)).toBe(row.out);
  });
});

describe('«Классы»: что создаёт class — ответы движка', () => {
  const show = (v: unknown): string =>
    typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? `[${v.map(show).join(', ')}]` : String(v);

  it.each(CLASS_IS_ROWS)('$expr → $out', (row) => {
    const env = new Function('"use strict";' + SAMPLE_CODE + '; return { dog, Dog, Animal };')();
    const value = new Function('dog', 'Dog', 'Animal', `return ${row.expr};`)(env.dog, env.Dog, env.Animal);
    expect(show(value)).toBe(row.out);
  });
});

describe('консоли в начале разделов — ответы движка, по порядку', () => {
  const show = (v: unknown): string => {
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return `'${v}'`;
    if (typeof v === 'function') return 'ƒ';
    if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
    if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${k}: ${show(x)}`).join(', ')} }`;
    return String(v);
  };

  it.each([
    ['Прототипы', PROTO_OPENER],
    ['Прототипы: [[Prototype]] и prototype', PROTO_VS_PROBES],
    ['Дескрипторы', DESC_OPENER],
    ['Замки', LOCK_OPENER],
  ] as const)('%s', (_name, rows) => {
    const env = new Function('"use strict";' + SAMPLE_CODE + '; return { dog, Dog, Animal };')();
    for (const row of rows) {
      const value = new Function('dog', 'Dog', 'Animal', `"use strict"; return ${row.expr};`)(env.dog, env.Dog, env.Animal);
      if (row.out !== null) expect(show(value), row.expr).toBe(row.out);
    }
  });

  it('«Замки»: обычная запись в замороженный объект в строгом режиме — TypeError, приватное поле freeze не трогает', () => {
    const env = new Function('"use strict";' + SAMPLE_CODE + '; return { dog };')();
    Object.freeze(env.dog);
    expect(() => new Function('dog', '"use strict"; dog.name = "Рекс";')(env.dog)).toThrow(TypeError);
    const C = new Function('return class { #x = 1; set(v) { this.#x = v; } get() { return this.#x; } }')();
    const o = Object.freeze(new C());
    o.set(2);
    expect(o.get()).toBe(2);
  });
});

/**
 * Демо записи печатает вывод движка, а шаги и итог — текст из `data.ts`. Тест держит их
 * в согласии: что обещают слова, то и должен показать запуск той же модели, что у читателя.
 */
describe('«Модель»: демо записи — вывод запуска совпадает с текстом сценария', () => {
  const runs = Object.fromEntries(SET_SCENARIOS.map((s) => [s.key, runSet(SAMPLE_CODE, s.code, s.prop)]));

  it('сценарий пишет в тот ключ, что назван в prop', () => {
    for (const s of SET_SCENARIOS) expect(s.code.split('\n').at(-1), s.key).toMatch(new RegExp(`^dog\\.${s.prop} = `));
  });

  it('объект после записи одинаков в обоих режимах — режимы расходятся только ошибкой', () => {
    for (const r of Object.values(runs)) {
      expect(r.sloppy.object).toEqual(r.strict.object);
      expect(r.sloppy.read).toBe(r.strict.read);
      expect(r.sloppy.error).toBeNull();
    }
  });

  it('своё свойство появляется только в «новом ключе», остальные три бросают в строгом режиме', () => {
    expect(runs.plain.strict.object.desc).toBe("{ value: 'Шарик-младший', writable: true, enumerable: true, configurable: true }");
    expect(runs.plain.strict.error).toBeNull();
    for (const k of ['accessor', 'readonly', 'frozen']) {
      expect(runs[k].strict.object, k).toEqual(runs[k].before.object);
      expect(runs[k].strict.error, k).toMatch(/^TypeError: /);
    }
  });

  it('шаги называют то же, что напечатает запуск', () => {
    const steps = (k: string) => SET_SCENARIOS.find((s) => s.key === k)!.steps.join(' ');
    expect(runs.accessor.strict.read).toBe("'Шарик, 7'");
    expect(steps('accessor')).toContain('«Шарик, 7»');
    expect(runs.accessor.before.proto.desc).toContain('set: undefined');
    expect(runs.readonly.strict.error).toContain('Cannot assign to read only property');
    expect(steps('readonly')).toContain('Cannot assign to read only property');
    expect(runs.frozen.before.proto.desc).toBeNull();
    expect(runs.frozen.before.object.extensible).toBe(false);
    expect(runs.plain.before.object.extensible).toBe(true);
  });
});

/** Каждая карточка исполняется целиком; строки с комментарием сверяются с выводом консоли. */
describe('«Прототипы»: __proto__ — три записи', () => {
  it.each(PROTO_THREE.map((c) => [c.t, c.code] as const))('%s', (_t, code) => {
    const [setup, ...probes] = code.split('\n');
    expect(probes).toHaveLength(2);
    for (const line of probes) {
      const [expr, expected] = line.split('//').map((x) => x.trim());
      const got = new Function(`${setup}\nreturn ${expr.replace(/;$/, '')};`)();
      expect(inspect(got), expr).toBe(expected);
    }
  });

  it('вступление: dog.__proto__ — геттер из Object.prototype, и он отдаёт Dog.prototype', () => {
    expect(PROTO_THREE_LEAD).toContain('`dog.__proto__ === Dog.prototype`');
    const { dog, Dog } = new Function(SAMPLE_CODE + '; return { dog, Dog };')();
    expect(dog.__proto__).toBe(Dog.prototype);
    expect(Object.hasOwn(dog, '__proto__')).toBe(false);
    expect(typeof Object.getOwnPropertyDescriptor(Object.prototype, '__proto__')?.get).toBe('function');
  });

  it('правило: сокращённая запись и метод тоже дают обычное свойство', () => {
    expect(PROTO_LITERAL_RULE).toContain('`{ __proto__ }`');
    const d = new Function('const __proto__ = null; return { __proto__ };')();
    const e = new Function('return { __proto__() {} };')();
    for (const o of [d, e]) {
      expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
      expect(Object.keys(o)).toEqual(['__proto__']);
    }
  });
});

describe('«Модель»: new — кому можно', () => {
  /** Каждая строка-выражение листинга исполняется отдельно и сверяется со своим комментарием. */
  it('вывод совпадает с комментариями листинга', () => {
    const lines = NEW_NOTE_CODE.split('\n');
    const setup = lines.slice(0, 3).join('\n');
    const probes = lines.slice(4).filter((l) => l.includes('//'));
    expect(probes).toHaveLength(6);
    for (const line of probes) {
      const [expr, expected] = line.split('//').map((x) => x.trim());
      let got: string;
      try {
        got = inspect(new Function(`${setup}\nreturn ${expr.replace(/;$/, '')};`)());
      } catch (e) {
        got = String(e);
      }
      expect(got, expr).toBe(expected);
    }
  });
});

describe('«Модель»: new Dog — порядок шагов, как в NEW_STEPS', () => {
  it('до super() this нет, прототип — Dog.prototype, поля до тела, return примитива — TypeError', () => {
    const log: string[] = [];
    const { Dog, D2 } = new Function('log', `"use strict";
      class Animal { constructor() { log.push('proto:' + (Object.getPrototypeOf(this) === Dog.prototype)); } }
      class Dog extends Animal {
        #age = (log.push('field'), 7);
        constructor(name) {
          try { this.x; } catch (e) { log.push('before:' + e.name); }
          super();
          log.push('body');
          this.name = name;
        }
      }
      class D2 extends Animal { constructor() { super(); return 42; } }
      return { Dog, D2 };`)(log);
    new Dog('Шарик');
    expect(log).toEqual(['before:ReferenceError', 'proto:true', 'field', 'body']);
    expect(() => new D2()).toThrow(TypeError);
  });
});

describe('расшифровка схемы: каждое утверждение ANATOMY_READING — ответ движка', () => {
  /*
   * Таблица под схемой говорит о `dog` десять вещей. Здесь они исполняются над той же
   * строкой `SAMPLE_CODE`; `#age in` проверяется статическим методом, дописанным в тело
   * класса перед конструктором, — снаружи класса такой проверки не написать.
   */
  function env() {
    const code = SAMPLE_CODE.replace('constructor(name) {', 'static has(o) { return #age in o; }\n  constructor(name) {');
    return new Function('"use strict";' + code + '; return { dog, Dog, Animal, ID };')() as {
      dog: Record<string | symbol, unknown>;
      Dog: { prototype: object; has(o: object): boolean };
      Animal: { prototype: object };
      ID: symbol;
    };
  }
  const row = (first: string) => {
    const found = ANATOMY_READING.find((r) => r[0].startsWith(first));
    if (!found) throw new Error(`строки ${first} в ANATOMY_READING нет`);
    return found[2];
  };

  it('таблица покрывает все слоты, свойства и звенья схемы', () => {
    const printed = ANATOMY_READING.map((r) => r[0]);
    for (const slot of ANATOMY_SLOTS) expect(printed.some((p) => p.includes(slot.name))).toBe(true);
    for (const prop of ANATOMY_PROPS) expect(printed.some((p) => p.includes(prop.key))).toBe(true);
    for (const node of ANATOMY_CHAIN) expect(printed.some((p) => p.includes(node.name))).toBe(true);
  });

  it('[[PrivateElements]]: поле уже на месте сразу после super()', () => {
    const log: boolean[] = [];
    const code = SAMPLE_CODE.replace('super();', 'super(); log.push(#age in this);');
    new Function('log', '"use strict";' + code)(log);
    expect(log).toEqual([true]);
    const { dog, Dog } = env();
    expect(Dog.has(dog)).toBe(true);
    expect(Dog.has({})).toBe(false);
    expect(row('`[[PrivateElements]]`')).toContain('#age in dog');
  });

  it('"age": set не задан, writable нет, запись — TypeError в строгом и молчание в нестрогом', () => {
    const { dog } = env();
    const desc = Object.getOwnPropertyDescriptor(dog, 'age')!;
    expect(desc.set).toBeUndefined();
    expect('writable' in desc).toBe(false);
    expect(() => { dog.age = 8; }).toThrow(TypeError);
    const sloppy = new Function(SAMPLE_CODE + '; dog.age = 8; return dog.age;')();
    expect(sloppy).toBe(7);
    const bare: object = {};
    Object.defineProperty(bare, 'x', { get() { return 1; } });
    const defaults = Object.getOwnPropertyDescriptor(bare, 'x')!;
    expect([defaults.enumerable, defaults.configurable]).toEqual([false, false]);
    expect(row('`"age"`')).toContain('TypeError');
  });

  it('Symbol(id): dog[ID] — 42, dog.id — undefined', () => {
    const { dog, ID } = env();
    expect(dog[ID]).toBe(42);
    expect(dog.id).toBeUndefined();
  });

  it('Dog.prototype: bark один на всех и не перечисляется', () => {
    const { dog, Dog } = env();
    const other = new (dog.constructor as new (n: string) => { bark: unknown })('Бобик');
    expect(other.bark).toBe(dog.bark);
    const seen: string[] = [];
    for (const key in dog) seen.push(key);
    expect(seen).toEqual(['name', 'age']);
    expect(Object.getOwnPropertyDescriptor(Dog.prototype, 'bark')!.enumerable).toBe(false);
  });

  it('Animal.prototype: label лежит там, а this — dog', () => {
    const { dog, Animal } = env();
    expect(Object.hasOwn(dog, 'label')).toBe(false);
    expect(Object.hasOwn(Animal.prototype, 'label')).toBe(true);
    expect(dog.label).toBe('Шарик, 7');
    expect(row('`Animal.prototype`')).toContain('«Шарик, 7»');
  });

  it('Object.prototype и null: toString пришёл неявно, dog.nope — undefined', () => {
    const { dog, Animal } = env();
    expect(Object.getPrototypeOf(Animal.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
    expect(typeof dog.toString).toBe('function');
    expect(dog.nope).toBeUndefined();
  });

  it('[[Extensible]]: preventExtensions необратим', () => {
    const { dog } = env();
    Object.preventExtensions(dog);
    expect(Object.isExtensible(dog)).toBe(false);
    expect(() => { dog.fresh = 1; }).toThrow(TypeError);
    expect(Object.isExtensible(dog)).toBe(false);
  });
});

describe('раздел 1: схема и демо сверены с движком', () => {
  /** Свежий набор объектов из примера: каждый сценарий записи получает свой, нетронутый. */
  function build() {
    return new Function(
      '"use strict";' + SAMPLE_CODE + '; return { dog, Dog, Animal };',
    )() as { dog: Record<string, unknown>; Dog: { prototype: object }; Animal: { prototype: object } };
  }

  /** Ключ со схемы (`"name"`, `Symbol(id)`) — в настоящий ключ объекта. */
  function keyOf(printed: string, dog: object): string | symbol {
    if (printed.startsWith('"')) return printed.slice(1, -1);
    const symbol = Reflect.ownKeys(dog).find((key) => typeof key === 'symbol');
    if (!symbol) throw new Error(`на схеме есть ${printed}, а в объекте символьных ключей нет`);
    return symbol;
  }

  it('собственные ключи объекта — те же, что нарисованы на схеме', () => {
    const { dog } = build();
    const printed = ANATOMY_PROPS.map((row) => row.key.replace(/"/g, '').replace(/^Symbol\(.*\)$/, 'Symbol'));
    const real = Reflect.ownKeys(dog).map((key) => (typeof key === 'symbol' ? 'Symbol' : key));
    expect(real).toEqual(printed);
  });

  it.each(ANATOMY_PROPS)('свойство $key: вид и разрешения совпадают с дескриптором', (row) => {
    const { dog } = build();
    const desc = Object.getOwnPropertyDescriptor(dog, keyOf(row.key, dog));
    if (!desc) throw new Error(`свойства ${row.key} в объекте нет вовсе`);

    // Вид свойства на схеме — `data` или `accessor`; у аксессора значения нет, есть функция.
    expect(row.kind === 'accessor' ? typeof desc.get === 'function' : 'value' in desc).toBe(true);

    const real = (['writable', 'enumerable', 'configurable'] as const).filter((flag) => desc[flag] === true);
    expect(real).toEqual(row.flags);
  });

  it('слот [[Extensible]] на схеме совпадает с настоящим', () => {
    const { dog } = build();
    const printed = ANATOMY_SLOTS.find((slot) => slot.name === '[[Extensible]]')?.value;
    expect(String(Object.isExtensible(dog))).toBe(printed);
  });

  it('цепочка прототипов идёт ровно так, как нарисована', () => {
    const { dog, Dog, Animal } = build();
    const names = new Map<object, string>([
      [Dog.prototype, 'Dog.prototype'],
      [Animal.prototype, 'Animal.prototype'],
      [Object.prototype, 'Object.prototype'],
    ]);

    const real: string[] = [];
    for (let node = Object.getPrototypeOf(dog); node; node = Object.getPrototypeOf(node)) {
      real.push(names.get(node) ?? '?');
    }
    expect(real).toEqual(ANATOMY_CHAIN.map((node) => node.name));
  });

  it('узлы демо чтения знают те ключи, которые у них есть на самом деле', () => {
    const { dog, Dog, Animal } = build();
    const owners = [dog, Dog.prototype, Animal.prototype, Object.prototype];

    GET_CHAIN.forEach((node, i) => {
      const real = Reflect.ownKeys(owners[i]).map((key) => (typeof key === 'symbol' ? 'Symbol(id)' : key));
      const missing = node.keys.filter((key) => !real.includes(key));
      expect(missing, `${node.name}: на странице есть ключи, которых в объекте нет`).toEqual([]);
    });
  });

  it.each(GET_KEYS)('шаги демо для ключа %s повторяют настоящий обход цепочки', (key) => {
    const { dog, Dog, Animal } = build();
    const owners = [dog, Dog.prototype, Animal.prototype, Object.prototype];

    // Настоящий владелец ключа: первый в цепочке, у кого он собственный.
    const realOwner = owners.findIndex((owner) => Object.getOwnPropertyDescriptor(owner, key));
    const steps = buildLookup(GET_CHAIN, key, GET_VALUES);
    const shownOwner = steps.find((step) => step.found)?.lvl ?? -1;

    expect(shownOwner).toBe(realOwner);
  });

  it('значения в демо — те, что отдаёт объект', () => {
    const { dog } = build();
    expect(dog.label).toBe('Шарик, 7');
    expect(GET_VALUES.label).toContain('Шарик, 7');
    // `missing` в словаре значений отсутствует намеренно: демо доходит до null.
    expect(GET_VALUES.missing).toBeUndefined();
    expect(dog.missing).toBeUndefined();
  });

  it('карточка про скрытые ключи не врёт про JSON', () => {
    const { dog } = build();
    expect(JSON.stringify(dog)).toBe('{"name":"Шарик","age":7}');
  });

  describe('четыре сценария записи', () => {
    /**
     * ⚠️ Проверяется **имя** ошибки, а не текст: формулировки V8 меняются от версии к версии,
     * и тест, прибитый к ним, ломался бы на каждом обновлении Node, ничего не говоря о теме.
     */
    it('новый ключ — собственное свойство создаётся со всеми разрешениями', () => {
      const { dog } = build();
      dog.nickname = 'Шарик-младший';
      const desc = Object.getOwnPropertyDescriptor(dog, 'nickname');
      expect(desc).toMatchObject({ writable: true, enumerable: true, configurable: true });
    });

    it('аксессор без сеттера — записи нет, значение прежнее', () => {
      const { dog } = build();
      expect(() => {
        dog.label = 'Рекс, 8';
      }).toThrow(TypeError);
      expect(Object.getOwnPropertyDescriptor(dog, 'label')).toBeUndefined();
      expect(dog.label).toBe('Шарик, 7');
    });

    it('запрет на запись в прототипе останавливает запись в наследника', () => {
      const { dog, Animal } = build();
      Object.defineProperty(Animal.prototype, 'kind', { value: 'зверь', writable: false, configurable: true });
      expect(() => {
        dog.kind = 'пёс';
      }).toThrow(TypeError);
      expect(Object.getOwnPropertyDescriptor(dog, 'kind')).toBeUndefined();
    });

    /**
     * Утверждение, которого в теме раньше не было: запечатанный объект запрещает **новые**
     * ключи, но не запись в уже существующие. Об этом говорит и третий выход схемы.
     */
    it('запечатанный объект: новый ключ нельзя, существующий — можно', () => {
      const { dog } = build();
      Object.preventExtensions(dog);

      expect(() => {
        dog.nickname = 'Рекс';
      }).toThrow(TypeError);

      dog.name = 'Рекс';
      expect(dog.name).toBe('Рекс');
    });
  });
});

/**
 * Утверждения разделов 2–4 и 9, которые до сих пор держались на разовом прогоне.
 *
 * ⚠️ Обход темы показал: тождества, на которых стоит схема прототипов, три формы записи
 * `__proto__`, поведение класса без `new`, `[[HomeObject]]`, статический блок, числа ловушек
 * прокси и все четыре инварианта были напечатаны на странице и не проверялись ничем.
 * Это ровно тот случай, против которого написана преамбула этого файла: страница может
 * разойтись с движком молча, и узнает об этом читатель, а не мы.
 *
 * Все утверждения ниже сверены с Node 26.8.2 · V8 14.6 перед тем, как попасть сюда.
 */
describe('разделы 2–4: то, на чём стоят схемы', () => {
  class Родитель {
    speak() {
      return 'звук';
    }
    static create() {
      return new this();
    }
  }
  class Потомок extends Родитель {
    bark() {
      return 'гав';
    }
  }

  it('у наследования две связи, а не одна', () => {
    // Нижняя: по ней экземпляр находит методы родителя.
    expect(Object.getPrototypeOf(Потомок.prototype)).toBe(Родитель.prototype);
    // Верхняя: по ней наследник получает статические методы.
    expect(Object.getPrototypeOf(Потомок)).toBe(Родитель);
  });

  it('три способа написать `__proto__` дают три разных объекта', () => {
    const литерал = { __proto__: null };
    expect(Reflect.ownKeys(литерал)).toEqual([]);
    expect(Object.getPrototypeOf(литерал)).toBeNull();

    const вычисляемый = { ['__proto__']: null };
    expect(Reflect.ownKeys(вычисляемый)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(вычисляемый)).toBe(Object.prototype);

    const значение = null;
    const сокращённый = { __proto__: значение };
    expect(Object.getPrototypeOf(сокращённый)).toBeNull();

    const методом = { __proto__() {} };
    expect(Reflect.ownKeys(методом)).toEqual(['__proto__']);
  });

  it('объект без прототипа теряет то, чем пользуются не задумываясь', () => {
    const словарь = Object.create(null);
    словарь.x = 1;
    expect(словарь.hasOwnProperty).toBeUndefined();
    expect(() => `${словарь}`).toThrow(TypeError);
  });

  it('класс нельзя позвать без `new` — и обойти это нечем', () => {
    class Только {}
    expect(() => (Только as unknown as () => void)()).toThrow(TypeError);
    expect(() => Reflect.apply(Только as unknown as () => void, undefined, [])).toThrow(TypeError);
  });

  it('методы класса неперечислимы, а присвоенные — перечислимы', () => {
    class Классом {
      m() {}
    }
    function Присвоением(this: unknown) {}
    Присвоением.prototype.m = function () {};

    expect(Object.keys(Классом.prototype)).toEqual([]);
    expect(Object.keys(Присвоением.prototype)).toEqual(['m']);
  });

  it('тело класса строгое: оторванный метод получает undefined, а не globalThis', () => {
    class Сам {
      m(this: unknown) {
        return this;
      }
    }
    const оторван = new Сам().m;
    expect(оторван()).toBeUndefined();
  });

  /**
   * `super` смотрит на объект, где метод **объявлен**, а не на тот, через который позвали.
   * Поэтому цепочка обрывается на `Родитель`, а не уходит на второй круг.
   */
  it('[[HomeObject]]: super идёт от места объявления', () => {
    class A {
      static greet() {
        return 'A';
      }
    }
    class B extends A {
      static greet() {
        return 'B>' + super.greet();
      }
    }
    class C extends B {}
    expect(C.greet()).toBe('B>A');
    // Вне метода объекта `super` — синтаксическая ошибка, а не ошибка времени выполнения.
    expect(() => new Function('({}).m = function(){ super.x }')).toThrow(SyntaxError);
  });

  it('статический блок видит приватное статическое поле, а снаружи его не видит никто', () => {
    let изБлока: number | null = null;
    // Класс объявлен ради самого статического блока: наружу из него выходит только значение.
    new (class Сейф {
      static #secret = 42;
      static {
        изБлока = Сейф.#secret;
      }
    })();
    expect(изБлока).toBe(42);
    expect(() => new Function('class V { static #s = 1 } class W extends V {} W.#s;')).toThrow(SyntaxError);
  });
});

/*
 * Блок «раздел 9: прокси — сколько ловушек и почему они не врут» переехал 2026-10-02
 * в `tests/unit/proxy-reflect.test.ts` вместе с материалом раздела (тема «Proxy и Reflect»).
 * Там же — «инварианты по каждой ловушке», «мембрана» и листинг «потерянный receiver».
 */

/**
 * Песочница раздела «Тонкие места»: пять листингов, которые читатель запускает сам.
 *
 * ⚠️ До этого блока их не проверял никто — при том, что это самый дешёвый сторож в теме:
 * каждый листинг исполним, печатает конкретные строки и снабжён обещанием, что именно
 * выйдет. Разойтись с движком они могли молча, а узнал бы об этом читатель, нажавший
 * «выполнить».
 *
 * Исполняется **сам** `code` со страницы. `console.log` перехватывается, вывод сверяется
 * с тем, что обещано рядом.
 *
 * ⚠️ Первый листинг намеренно пишет в `Object.prototype` и убирает за собой `delete`
 * в последней строке. Поэтому вывод собирается целиком, а состояние прототипа проверяется
 * после прогона: протечь в соседние проверки он не должен.
 */
describe('песочница: пять листингов делают то, что обещано', () => {
  /** Выполнить листинг и вернуть всё, что он напечатал. */
  function прогнать(code: string): string[] {
    const напечатано: string[] = [];
    const настоящий = console.log;
    console.log = (...args: unknown[]) => void напечатано.push(args.map(String).join(' '));
    try {
      new Function(code)();
    } finally {
      console.log = настоящий;
    }
    return напечатано;
  }

  const листинг = (label: string) => {
    const found = LAB_SNIPPETS.find((s) => s.label === label);
    if (!found) throw new Error(`листинга «${label}» в песочнице больше нет`);
    return found.code;
  };

  it('«freeze поверхностен»: аксессор жив, вложенное меняется', () => {
    const вывод = прогнать(листинг('freeze поверхностен')).join('\n');
    expect(вывод).toContain('2');
  });

  it('«спред против assign»: на выходе обычное свойство со значением', () => {
    const вывод = прогнать(листинг('спред против assign')).join('\n');
    // Дескриптор копии — data, а не accessor: в нём есть value и нет get.
    expect(вывод).toContain('"value"');
    expect(вывод).not.toContain('"get"');
  });

  it('«порядок ключей»: индексом считается только каноническая запись', () => {
    const строки = прогнать(листинг('порядок ключей'));
    const ответ = (ключ: string) => строки.find((s) => s.startsWith(ключ))?.includes('true');

    expect(ответ('4294967294'), '2³²−2 — ещё индекс').toBe(true);
    expect(ответ('4294967295'), '2³²−1 — уже нет').toBe(false);
    for (const неиндекс of ['01', '1.0', '-1', '-0', '+1', '1e2']) {
      expect(ответ(неиндекс), `${неиндекс} — не каноническая запись`).toBe(false);
    }
  });

  it('«brand check»: подделку ловит приватный слот, а не instanceof', () => {
    const строки = прогнать(листинг('brand check против instanceof'));
    const найти = (начало: string) => строки.find((s) => s.startsWith(начало)) ?? '';

    // Цепочку прототипов подделать легко — instanceof верит.
    expect(найти('fake instanceof')).toContain('true');
    // Приватное поле не подделать.
    expect(найти('Temperature.is(fake)')).toContain('false');
    expect(найти('Temperature.is(real)')).toContain('true');
  });
});

/**
 * Раздел «Символы» — до этого блока в теме не проверялось **ни одно** его утверждение.
 *
 * ⚠️ У остальных разделов есть отделяемый модуль виджета, который зовёт тест; у `SymbolMap`
 * его нет — он только рисует данные. Поэтому здесь проверяются сами утверждения страницы:
 * что печатают три пробы, какую подсказку присылает каждая операция, как ведёт себя `Date`
 * и что за символ отдаёт реестр.
 */
describe('раздел «Символы»: то, что напечатано, — то и происходит', () => {
  /** Объект из сквозного примера: строковый ключ, аксессор и символьный ключ. */
  function собрать() {
    const ID = Symbol('id');
    const dog: Record<string, unknown> = { name: 'Шарик' };
    (dog as Record<symbol, unknown>)[ID] = 42;
    Object.defineProperty(dog, 'age', { get: () => 7, enumerable: true, configurable: true });
    return { dog, ID };
  }

  it('три пробы печатают ровно то, что стоит в таблице', () => {
    const { dog, ID } = собрать();
    expect(Object.keys(dog)).toEqual(['name', 'age']);
    expect(JSON.stringify(dog)).toBe('{"name":"Шарик","age":7}');
    expect(Object.getOwnPropertySymbols(dog)).toEqual([ID]);
    // Вторым вызовом посторонний получает и значение — ради этого проба и стоит.
    expect((dog as Record<symbol, unknown>)[Object.getOwnPropertySymbols(dog)[0]]).toBe(42);
  });

  /**
   * Подсказка снимается с настоящего вызова: объект объявляет `Symbol.toPrimitive`
   * и записывает, с чем его позвали.
   */
  it.each([
    ['шаблонная строка', (o: object) => `${o}`, 'string'],
    ['String(obj)', (o: object) => String(o), 'string'],
    ['ключ объекта', (o: object) => void ({} as Record<string, unknown>)[o as unknown as string], 'string'],
    ['унарный +', (o: object) => +(o as unknown as number), 'number'],
    ['арифметика', (o: object) => (o as unknown as number) - 0, 'number'],
    ['бинарный +', (o: object) => (o as unknown as string) + '', 'default'],
    ['==', (o: object) => o == ('строка' as unknown as object), 'default'],
  ])('%s присылает подсказку %s', (_имя, операция, ожидаемая) => {
    let пришла: string | null = null;
    const проба = {
      [Symbol.toPrimitive](hint: string) {
        пришла = hint;
        return hint === 'number' ? 1 : 'строка';
      },
    };
    (операция as (o: object) => unknown)(проба);
    expect(пришла).toBe(ожидаемая);
  });

  it('у `Date` подсказка default ведёт себя как string', () => {
    const d = new Date(0);
    expect(typeof ((d as unknown as string) + 1)).toBe('string');
    expect(typeof ((d as unknown as number) - 1)).toBe('number');
  });

  it('реестр `Symbol.for` отдаёт тот же символ, а слабым ключом он быть не может', () => {
    expect(Symbol.for('id')).toBe(Symbol.for('id'));
    expect(Symbol('id')).not.toBe(Symbol('id'));

    expect(() => new WeakMap().set(Symbol.for('id') as unknown as object, 1)).toThrow(TypeError);
    // А обычный символ слабым ключом быть может — правило 2023 года.
    expect(() => new WeakMap().set(Symbol('id') as unknown as object, 1)).not.toThrow();
  });

  /**
   * ⚠️ Комментарий в данных обещал «тринадцать плюс `dispose` и `asyncDispose`». Число верное,
   * но сказано так, что проверить его нельзя. Здесь оно считается движком.
   */
  it('well-known символов в этом движке пятнадцать', () => {
    const все = Object.getOwnPropertyNames(Symbol).filter(
      (k) => typeof (Symbol as unknown as Record<string, unknown>)[k] === 'symbol',
    );
    expect(все).toHaveLength(15);
    expect(все).toContain('matchAll');
    expect(все).toContain('dispose');
  });
});

/**
 * Раздел «Наследование»: цена объекта без прототипа и признак «свой».
 *
 * ⚠️ В теме стояли два абсолютных числа — «14 мс против 16 мс» — и ни одной проверки.
 * Правило темы требует обратного: закрепляется **отношение**, а не миллисекунды, иначе тест
 * краснеет от смены железа, а не от ошибки. Перемер на Node 26.8.2 дал разрыв почти в шесть
 * раз, то есть прежняя пара чисел занижала его до неразличимого.
 */
describe('раздел «Наследование»: чем платит объект без прототипа', () => {
  /** Медиана: одиночный выброс на занятой машине не должен решать исход. */
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

  it('чтение у Object.create(null) заметно дороже обычного объекта', () => {
    const N = 3_000_000;
    const K = 256;

    const обычные = Array.from({ length: K }, (_, i) => {
      const o: Record<string, number> = {};
      o.x = i;
      return o;
    });
    const голые = Array.from({ length: K }, (_, i) => {
      const o = Object.create(null) as Record<string, number>;
      o.x = i;
      return o;
    });

    // Своя функция на случай: общая сделала бы inline cache мегаморфным, и разница пропала бы.
    const читатьОбычные = (a: Record<string, number>[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };
    const читатьГолые = (a: Record<string, number>[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };

    const bench = (fn: (a: Record<string, number>[]) => number, arr: Record<string, number>[]) => {
      fn(arr);
      fn(arr);
      return median(
        Array.from({ length: 5 }, () => {
          const t = performance.now();
          fn(arr);
          return performance.now() - t;
        }),
      );
    };

    const обычный = bench(читатьОбычные, обычные);
    const голый = bench(читатьГолые, голые);

    // Порог низкий намеренно: он ловит исчезновение самого эффекта, а не «стало на 10% иначе».
    expect(голый / обычный).toBeGreaterThan(1.5);
  });

  it('словарь без прототипа теряет методы, но остаётся рабочим словарём', () => {
    const d = Object.create(null) as Record<string, number>;
    d.ключ = 1;

    expect(d.hasOwnProperty).toBeUndefined();
    expect(() => `${d}`).toThrow(TypeError);
    // А спрашивать о ключах по-прежнему можно — снаружи, а не методом объекта.
    expect(Object.hasOwn(d, 'ключ')).toBe(true);
  });

  /**
   * Приватный слот — единственный признак «свой», который нельзя подделать:
   * цепочку прототипов подменить тривиально, слот — нет.
   */
  it('признак «свой»: приватный слот против instanceof', () => {
    class Temperature {
      #celsius = 20;
      static is(x: object) {
        return #celsius in x;
      }
    }

    const свой = new Temperature();
    const подделка = Object.create(Temperature.prototype) as Temperature;

    expect(подделка instanceof Temperature, 'цепочку подделать легко').toBe(true);
    expect(Temperature.is(подделка), 'а слот — нет').toBe(false);
    expect(Temperature.is(свой)).toBe(true);
    expect(Temperature.is({ ...свой }), 'копия теряет слот').toBe(false);
    expect(Temperature.is(new Proxy(свой, {})), 'прокси слота не имеет').toBe(false);
    expect(Temperature.is(structuredClone(свой)), 'клонирование слот не переносит').toBe(false);
  });
});

/**
 * Ловушка 8.1: мутируемое значение по умолчанию на прототипе.
 *
 * ⚠️ Самая наглядная ловушка раздела и одна из немногих, что не проверялась ничем. Между тем
 * она закрывается двумя строками: массив, положенный на прототип, один на всех, а правка
 * через присваивание заводит собственное свойство и баг прячет.
 */
describe('ловушка 8.1: общий массив на прототипе', () => {
  /**
   * ⚠️ Объявить поле в теле класса (`items!: string[]`) здесь нельзя, и на этом я споткнулся:
   * TypeScript с `useDefineForClassFields` заводит настоящее поле экземпляра, которое затеняет
   * прототипное и при создании объекта затирает его `undefined`. Ловушка тогда не
   * воспроизводится вовсе — а она именно про то, что своего свойства у экземпляра НЕТ.
   */
  class Cart {}
  /** Свойство живёт на прототипе — у экземпляра его нет, в этом вся ловушка. */
  type WithItems = Cart & { items: string[] };
  (Cart.prototype as WithItems).items = [];
  const новая = () => new Cart() as WithItems;

  it('push через прототип виден у всех экземпляров', () => {
    const а = новая();
    const б = новая();

    а.items.push('книга');

    // Собственного свойства ни у кого не появилось — массив один.
    expect(Object.hasOwn(а, 'items')).toBe(false);
    expect(б.items).toEqual(['книга']);
    expect(а.items).toBe(б.items);

    (Cart.prototype as WithItems).items = [];
  });

  it('а присваивание заводит собственное свойство и баг прячет', () => {
    const а = новая();
    const б = новая();

    а.items = ['книга'];

    expect(Object.hasOwn(а, 'items')).toBe(true);
    expect(б.items).toEqual([]);

    (Cart.prototype as WithItems).items = [];
  });
});

/**
 * Дескрипторы: список разрешённых переходов после `configurable: false`.
 *
 * ⚠️ Карточка утверждает «ни одного исключения» и перечисляет пять запретов — и до сих пор
 * не проверялся ни один. Утверждение об исчерпанности особенно опасно: достаточно одного
 * контрпримера, чтобы оно стало неправдой, а заметить это было нечем.
 */
describe('раздел «Дескрипторы»: что законно после configurable: false', () => {
  /** Свежее закрытое свойство со значением на каждый случай. */
  const закрытое = () => {
    const o: Record<string, unknown> = {};
    Object.defineProperty(o, 'x', { value: 1, writable: true, enumerable: true, configurable: false });
    return o;
  };

  it('менять значение можно, пока writable: true — обоими способами', () => {
    const черезОпределение = закрытое();
    expect(() => Object.defineProperty(черезОпределение, 'x', { value: 2 })).not.toThrow();
    expect(черезОпределение.x).toBe(2);

    const присваиванием = закрытое();
    присваиванием.x = 3;
    expect(присваиванием.x).toBe(3);
  });

  it('writable: true → false пройдёт, а обратно — нет', () => {
    const o = закрытое();
    expect(() => Object.defineProperty(o, 'x', { writable: false })).not.toThrow();
    expect(() => Object.defineProperty(o, 'x', { writable: true })).toThrow(TypeError);
  });

  it.each([
    ['превратить в аксессор', (o: Record<string, unknown>) => Object.defineProperty(o, 'x', { get: () => 1 })],
    ['сменить enumerable', (o: Record<string, unknown>) => Object.defineProperty(o, 'x', { enumerable: false })],
    ['вернуть configurable', (o: Record<string, unknown>) => Object.defineProperty(o, 'x', { configurable: true })],
    ['удалить свойство', (o: Record<string, unknown>) => { 'use strict'; delete o.x; }],
  ])('%s — TypeError, и это без исключений', (_имя, попытка) => {
    expect(() => (попытка as (o: Record<string, unknown>) => void)(закрытое())).toThrow(TypeError);
  });

  it('аксессор после configurable: false не меняет ни get, ни set', () => {
    const o: Record<string, unknown> = {};
    Object.defineProperty(o, 'y', { get: () => 1, configurable: false });
    expect(() => Object.defineProperty(o, 'y', { get: () => 2 })).toThrow(TypeError);
    expect(() => Object.defineProperty(o, 'y', { set: () => {} })).toThrow(TypeError);
  });
});

/**
 * Итераторы: сквозной канал `yield*`, ленивый источник под `for await` и цена геттера.
 *
 * ⚠️ Ни одно из трёх утверждений не проверялось: про `yield*` сказано «пробрасываются внутрь»,
 * про `for await` — «дожидается тела, прежде чем запросить следующее», про геттер — что он
 * выглядит полем, а считает каждый раз.
 */
describe('раздел «Итераторы»: каналы и цена', () => {
  it('`yield*` пробрасывает значение внутрь, а return вложенного становится результатом', () => {
    function* внутренний(): Generator<string, string, string> {
      const пришло = yield 'спрашиваю';
      return 'вернул: ' + пришло;
    }
    function* внешний(): Generator<string, void, string> {
      const итог = yield* внутренний();
      yield 'итог — ' + итог;
    }

    /*
     * ⚠️ Шаги считаются точно, и на этом я споткнулся: лишний `next()` съедал тот самый
     * результат, который проверяется. Первый `next()` доводит до `yield 'спрашиваю'` внутри
     * вложенного; второй передаёт туда значение — вложенный возвращается, `yield*` отдаёт
     * его результат наружу, и внешний сразу отдаёт свой `yield`. Третьего шага быть не должно.
     */
    const g = внешний();
    expect(g.next().value, 'первый шаг — yield вложенного').toBe('спрашиваю');
    expect(g.next('значение').value).toBe('итог — вернул: значение');
  });

  it('`yield*` пробрасывает и ошибку — её ловит вложенный генератор', () => {
    function* внутренний(): Generator<string, string, string> {
      try {
        yield 'первый';
        return 'без ошибки';
      } catch (e) {
        return 'поймал: ' + (e as Error).message;
      }
    }
    function* внешний(): Generator<string, void, string> {
      const итог = yield* внутренний();
      yield 'итог — ' + итог;
    }

    const g = внешний();
    g.next();
    expect(g.throw(new Error('ой')).value).toBe('итог — поймал: ой');
  });

  it('`for await` по ленивому источнику берёт значения по одному, в порядке выдачи', async () => {
    const задача = (n: number) => new Promise<number>((r) => setTimeout(() => r(n), 5));
    async function* лениво() {
      for (const n of [1, 2, 3]) yield задача(n);
    }

    const порядок: number[] = [];
    for await (const n of лениво()) порядок.push(n);
    expect(порядок).toEqual([1, 2, 3]);
  });

  it('геттер выглядит полем, но вычисляется на каждое обращение', () => {
    let вызовов = 0;
    const узел = {
      children: [{ size: 1 }, { size: 2 }],
      get size(): number {
        вызовов++;
        return 1 + this.children.reduce((s, c) => s + c.size, 0);
      },
    };

    void узел.size;
    void узел.size;
    void узел.size;

    expect(вызовов, 'три обращения — три вычисления').toBe(3);
    const desc = Object.getOwnPropertyDescriptor(узел, 'size');
    expect(desc && 'value' in desc, 'в дескрипторе нет value — это аксессор').toBe(false);
  });
});

describe('режим исполнения', () => {
  /**
   * Вся матрица замков держится на strict: в sloppy отказы молчат, и «не получилось»
   * стало бы неотличимо от «получилось». Модуль ES строгий по определению, но проверка
   * стоит одной строки и охраняет смысл семнадцати следующих.
   */
  it('тест идёт в strict mode — иначе отказ записи не был бы виден', () => {
    expect(new Function('return this;')()).toBeTruthy();
    expect(
      (function thisInStrict(this: unknown) {
        return this;
      })(),
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · дескрипторы и замки
// ---------------------------------------------------------------------------

describe('дескрипторы: два способа завести свойство дают противоположные умолчания', () => {
  it('состав дата-дескриптора — ровно четыре поля из таблицы', () => {
    const descriptor = Object.getOwnPropertyDescriptor({ x: 1 }, 'x')!;
    expect(Object.keys(descriptor).sort()).toEqual(DESC_DATA.map((f) => f.k).sort());
  });

  it('состав accessor-дескриптора — тоже четыре, и `value` среди них нет', () => {
    const descriptor = Object.getOwnPropertyDescriptor({ get x() { return 1; } }, 'x')!;
    expect(Object.keys(descriptor).sort()).toEqual(DESC_ACCESSOR.map((f) => f.k).sort());
  });

  /** Флаги в данных записаны как «writable ✓» — разбираем их обратно, чтобы сверять смыслом. */
  const flags = (row: (typeof DESC_DEFAULTS)[number]) =>
    Object.fromEntries(
      row.flags.map((f) => {
        const [name, mark] = f.split(' ');
        return [name, mark === '✓'];
      }),
    );

  it('`a.x = 1` создаёт максимально открытое свойство', () => {
    const a: Record<string, unknown> = {};
    a.x = 1;
    const descriptor = Object.getOwnPropertyDescriptor(a, 'x')!;
    const expected = flags(DESC_DEFAULTS[0]);

    expect(DESC_DEFAULTS[0].k).toBe('a.x = 1');
    expect({
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    }).toEqual(expected);
  });

  it('`defineProperty` без флагов — всё закрыто, и `configurable: false` уже не отыграть', () => {
    const b = {};
    Object.defineProperty(b, 'x', { value: 1 });
    const descriptor = Object.getOwnPropertyDescriptor(b, 'x')!;

    expect({
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
    }).toEqual(flags(DESC_DEFAULTS[1]));

    // «Точка невозврата» из подписи: обратно в configurable: true дороги нет.
    expect(() => Object.defineProperty(b, 'x', { configurable: true })).toThrow(TypeError);
  });

  it('смешивать `value` и `get` нельзя — это TypeError', () => {
    expect(DESC_MIX_NOTE).toContain('TypeError');
    expect(() =>
      Object.defineProperty({}, 'x', { value: 1, get: () => 2 } as PropertyDescriptor),
    ).toThrow(TypeError);
  });
});

/**
 * Демо и таблица обязаны спрашивать движок одинаково.
 *
 * Матрицы на странице больше не набраны руками: `widgets/lock-lab` и `widgets/enum-probe`
 * выполняют операции прямо у читателя. Но пока тест держал **свою** копию тех же операций,
 * «проверено тестом» означало бы «проверено чем-то похожим»: демо и тест могли разойтись
 * молча, и правым оказался бы тот, кого никто не смотрел.
 *
 * Здесь вызываются ровно те функции, что работают в браузере, и их результат сверяется
 * с литералами `data.ts`. Приём не выдуман: так устроен `widgets/clone-survival`, где демо
 * и тест давно зовут один `model/run.ts`.
 */
describe('демо и таблица спрашивают движок одинаково', () => {
  const levelOf = (name: string) => LEVELS.find((item) => item.label === name)?.value;

  for (const row of LOCK_ROWS) {
    row.cells.forEach((expected, column) => {
      it(`замки · ${row.name} · ${LOCK_HEAD[column + 1]} — демо согласно с таблицей`, () => {
        const level = levelOf(row.name);
        expect(level, `в модели демо нет уровня «${row.name}»`).toBeDefined();

        const run = runLock(level!, LOCK_OPS[column].value, 'strict');

        expect(
          !run.threw,
          `демо и таблица разошлись на клетке «${row.name} × ${LOCK_HEAD[column + 1]}»`,
        ).toBe(expected);
        // Имя нормативно, текст у каждого движка свой — утверждаем только имя.
        if (!expected) expect(run.errorName).toBe('TypeError');
      });
    });
  }

  /** Строки таблицы объединяют по паре операций, у демо они отдельные. */
  const ENUM_BY_ROW: Record<string, string> = {
    'for…in': 'for-in',
    'Object.keys / values': 'keys',
    '{ ...obj } / assign': 'spread',
    'JSON.stringify': 'json',
    getOwnPropertyNames: 'names',
    getOwnPropertySymbols: 'symbols',
    'Reflect.ownKeys': 'ownKeys',
  };

  for (const row of ENUM_ROWS) {
    it(`перечисление · ${row.name} — демо согласно с таблицей`, () => {
      const op = ENUM_BY_ROW[row.name];
      expect(op, `для строки «${row.name}» не нашлось операции демо`).toBeDefined();
      expect(ENUM_OPS.some((item) => item.value === op)).toBe(true);

      const hits = runEnum(op as (typeof ENUM_OPS)[number]['value']).hits;
      const seen = [
        hits.some((h) => h.kind === 'own-enum'),
        hits.some((h) => h.kind === 'own-hidden'),
        hits.some((h) => h.kind.startsWith('symbol')),
        hits.some((h) => h.kind === 'inherited'),
      ];

      expect(seen, `демо и таблица разошлись на строке «${row.name}»`).toEqual(row.cells);
    });
  }

  /**
   * Протокол итерации: демо считает вызовы внутри самих методов, а не снаружи, — значит
   * закрепляем то, что реально выполнил движок.
   *
   * ⚠️ Два утверждения здесь опровергают ходовую интуицию, и оба сняты запуском: спред
   * не закрывает итератор **никогда** (идёт до `done: true`, закрывать нечего), а вот
   * деструктуризация закрывает — без всякого цикла и `break`.
   */
  it('итерация · спред не зовёт `return()`, а `break` и деструктуризация зовут', () => {
    expect(runScenario('factory').ret, 'спред не закрывает итератор').toBe(0);
    expect(runScenario('once').ret, 'спред не закрывает итератор и здесь').toBe(0);
    expect(runScenario('break').ret, '`break` закрывает ровно один раз').toBe(1);
    expect(runScenario('destructure').ret, 'деструктуризация закрывает тоже').toBe(1);
  });

  it('итерация · объект сам себе итератор одноразовый, фабрика — нет', () => {
    // `got` — строка вида `[0, 1, 2]`: проход печатает то, что собрал.
    expect(runScenario('factory').passes[1].got, 'фабрика отдаёт новый итератор').not.toBe('[]');
    expect(runScenario('once').passes[1].got, 'второй проход по исчерпанному пуст').toBe('[]');
  });

  it('итерация · `finally` печатает при досрочном выходе', () => {
    expect(runScenario('break').out).toContain('close(file)');
    expect(runScenario('destructure').out).toContain('close(file)');
  });

  /**
   * `instanceof` не проверяет тип — он вызывает метод. Тезис темы, и вот его доказательство
   * запуском: у случая с собственным `Symbol.hasInstance` обход цепочки **не запускался вовсе**,
   * а вердикт всё равно есть.
   */
  it('instanceof · со своим `Symbol.hasInstance` цепочка не обходится', () => {
    const own = runInstanceof('hasInstance');
    expect(own.ownHasInstance, 'метод объявлен на самом конструкторе').toBe(true);
    expect(own.walked, 'сравнивать было нечего — просто вызвали метод').toBe(false);

    const chain = runInstanceof('chain');
    expect(chain.walked, 'обычный случай всё-таки идёт по цепочке').toBe(true);
    expect(chain.ownHasInstance, 'своего метода у обычного класса нет').toBe(false);
    expect(chain.seesHasInstance, 'но унаследованный он видит — шаг 2 срабатывает всегда').toBe(
      true,
    );
  });

  /**
   * ⚠️ Уточнение, найденное запуском и дописанное в тему: сломать `instanceof` переприсваиванием
   * можно только у функции-конструктора. У класса `prototype` неперезаписываемое.
   */
  it('instanceof · где отвечает не то: чужой realm и две копии класса', () => {
    // Другой realm — vm-контекст Node: свой Array, свой Array.prototype.
    const foreign = runInNewContext('[1, 2]') as unknown[];
    expect(foreign instanceof Array).toBe(false);
    expect(Array.isArray(foreign)).toBe(true);
    expect(INSTANCEOF_BREAKS[0].d).toContain('`x instanceof Array` для него `false`');

    // Две копии библиотеки — два класса с одним именем; метка `code` переживает обе.
    const copy = () =>
      class MyError extends Error {
        code = 'E_NOT_FOUND';
      };
    const [A, B] = [copy(), copy()];
    const err = new A();
    expect(err instanceof B).toBe(false);
    expect(err.code).toBe('E_NOT_FOUND');
    expect(INSTANCEOF_BREAKS[1].d).toContain("`err.code === 'E_NOT_FOUND'`");
  });

  it('instanceof · примитив без своего метода — сразу false, хотя цепочка у числа есть', () => {
    expect(Object.getPrototypeOf(2)).toBe(Number.prototype);
    expect((2 as unknown as object) instanceof Number).toBe(false);
    class Plain {}
    expect((2 as unknown as object) instanceof Plain).toBe(false);
    const text = runInstanceof('hasInstance').steps.map((s) => s.text).join(' ');
    expect(text).toContain('Без своего метода ответ был бы `false` сразу');
    expect(text).toContain('`Number.prototype`');
  });

  /** Шаги называют имена из показанного кода, а не `a` и `B` из спецификации (2026-10-05). */
  it('instanceof · шаги говорят `dog`, `Animal`, `Legacy`, а не `a` и `B`', () => {
    for (const key of ['chain', 'hasInstance', 'reassigned'] as const) {
      for (const step of runInstanceof(key).steps) {
        expect(step.text, key).not.toMatch(/`B[.[]|getPrototypeOf\(a\)/);
      }
    }
    const chain = runInstanceof('chain').steps.map((s) => s.text).join(' ');
    expect(chain).toContain('`Animal[Symbol.hasInstance]`');
    expect(chain).toContain('`Object.getPrototypeOf(dog)`');
    expect(chain).toContain('не `Animal.prototype`');
    expect(runInstanceof('reassigned').steps.map((s) => s.text).join(' ')).toContain('`Legacy[Symbol.hasInstance]`');
    // Сверяют с новым prototype — шаг называет его так, а не «Legacy.prototype — не Legacy.prototype».
    const re = runInstanceof('reassigned');
    expect(re.steps.map((s) => s.text).join(' ')).toContain('— не новый `Legacy.prototype`');
    // Ошибка класса — от класса с тем же именем, что в коде, а не от невидимого `Strict`.
    expect(re.errorName).toBe('TypeError');
    expect(re.error).toContain('class Legacy');
    expect(re.error).not.toContain('Strict');
  });

  it('instanceof · переприсвоенный `prototype` ломает проверку живого объекта', () => {
    const run = runInstanceof('reassigned');
    expect(run.before, 'до подмены объект был экземпляром').toBe(true);
    expect(run.verdict, 'после подмены — уже нет').toBe(false);
  });

  it('instanceof · шаги алгоритма на dog и Dog — ответы движка', () => {
    const { dog, Dog } = new Function('"use strict";' + SAMPLE_CODE + '; return { dog, Dog };')() as {
      dog: object;
      Dog: { prototype: object };
    };
    const run = (right: unknown) => {
      try {
        return String(new Function('l', 'r', 'return l instanceof r')(dog, right));
      } catch (e) {
        return (e as Error).name;
      }
    };
    // Шаг 1: справа примитив.
    expect(run(42)).toBe('TypeError');
    expect(INSTANCEOF_STEPS[0]).toContain('dog instanceof 42');
    // Шаг 2: метод решает сам, и его ответ приводится к boolean.
    expect(run({ [Symbol.hasInstance]: () => 1 })).toBe('true');
    expect((Dog as unknown as Record<symbol, unknown>)[Symbol.hasInstance]).toBe(Function.prototype[Symbol.hasInstance]);
    // Шаг 3: объект без метода и не функция.
    expect(run({})).toBe('TypeError');
    expect(INSTANCEOF_STEPS[2]).toContain('dog instanceof {}');
    // Шаг 4: цепочка.
    expect(run(Dog)).toBe('true');
    expect(INSTANCEOF_STEPS.length).toBe(4);
    expect(INSTANCEOF_NOTE).toContain('шаг 4');
  });

  it('порядок инициализации: баг из заголовка — строка со страницы', () => {
    const [before, after] = new Function(
      '"use strict";' + INIT_BUG_CODE + '\n; return [new Child().items, new Child2().items];',
    )() as [string[], string[]];
    expect(before).toEqual(['из init']);
    expect(after).toEqual([]);
    expect(INIT_BUG_CODE).toContain("new Child().items;    // ['из init']");
    expect(INIT_BUG_CODE).toContain('new Child2().items;   // []');

    // «Даже объявление без значения» из пояснения.
    const bare = new Function(
      '"use strict";' + INIT_BUG_CODE.replace('items = [];', 'items;') + '\n; return new Child2().items;',
    )();
    expect(bare).toBeUndefined();
    expect(INIT_BUG_NOTE).toContain('`items;`');
  });

  it('порядок ключей: демо строит тот же объект, что напечатан в теме', () => {
    expect(buildOrder('b, 3, a, 1, 2, Symbol(s)').json).toBe('{"1":4,"2":5,"3":2,"b":1,"a":3}');
  });

  /**
   * Половина ответа, которой в булевой таблице не было места: в нестрогом режиме отказ
   * не бросает. Кроме `defineProperty` — он бросает в обоих режимах, и это единственная
   * операция, которая не умеет проваливаться молча.
   */
  it('sloppy: отказ молчит — кроме `defineProperty`', () => {
    expect(runLock('freeze', 'write', 'sloppy').threw, 'присваивание в sloppy не бросает').toBe(
      false,
    );
    expect(runLock('freeze', 'define', 'sloppy').threw, '`defineProperty` бросает всегда').toBe(
      true,
    );
  });
});

describe('матрица замков — четыре уровня × четыре операции, strict mode', () => {
  const levels: Record<string, (o: object) => void> = {
    обычный: () => {},
    preventExtensions: (o) => void Object.preventExtensions(o),
    seal: (o) => void Object.seal(o),
    freeze: (o) => void Object.freeze(o),
  };

  /**
   * Операции берутся в том же порядке, что колонки `LOCK_HEAD`. «Дескриптор» обязан именно
   * менять атрибут: `defineProperty` с теми же значениями — разрешённый no-op, и на замороженном
   * объекте он бы прошёл, нарисовав в таблице лишнюю галочку.
   */
  const ops: ((o: Record<string, unknown>) => void)[] = [
    (o) => void (o.fresh = 1),
    (o) => void delete o.x,
    (o) => void (o.x = 2),
    (o) => void Object.defineProperty(o, 'x', { enumerable: false }),
  ];

  for (const row of LOCK_ROWS) {
    row.cells.forEach((expected, column) => {
      it(`${row.name} · ${LOCK_HEAD[column + 1]} → ${expected ? 'получается' : 'бросает'}`, () => {
        const target: Record<string, unknown> = { x: 1 };
        levels[row.name](target);

        const { ok, error } = succeeds(() => ops[column](target));

        expect(ok).toBe(expected);
        if (!expected) expect(error, 'отказ обязан быть именно TypeError').toBeInstanceOf(TypeError);
      });
    });
  }

  it('freeze не трогает аксессоры: у них нет writable, и сеттер продолжает работать', () => {
    let seen: unknown = null;
    // Тип намеренно шире, чем даёт `Object.freeze`: для TS замороженное — read-only,
    // а урок говорит именно о том, что для аксессора это неправда.
    const o: { value: unknown } = Object.freeze({
      set value(v: unknown) {
        seen = v;
      },
    });
    o.value = 7;
    expect(seen, 'заморожена структура, а не поведение').toBe(7);
  });

  it('все три замка поверхностны — вложенный объект остаётся изменяемым', () => {
    const state = Object.freeze({ user: { name: 'Аня' } });
    state.user.name = 'Оля';
    expect(state.user.name).toBe('Оля');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · перечисление
// ---------------------------------------------------------------------------

describe('матрица перечисления — семь операций × четыре категории ключей', () => {
  const VISIBLE_SYMBOL = Symbol('перечислимый символ');

  /** Четыре категории ключей ровно по колонкам `ENUM_HEAD`. */
  function probeObject(): Record<string, unknown> {
    const proto = { inherited: 1 };
    const attrs = { writable: true, configurable: true };
    return Object.create(proto, {
      visible: { value: 1, enumerable: true, ...attrs },
      hidden: { value: 2, enumerable: false, ...attrs },
      [VISIBLE_SYMBOL]: { value: 3, enumerable: true, ...attrs },
    }) as Record<string, unknown>;
  }

  /** Из списка увиденных ключей — четыре булевых ответа в порядке колонок таблицы. */
  const categories = (keys: (string | symbol)[]) => [
    keys.includes('visible'),
    keys.includes('hidden'),
    keys.includes(VISIBLE_SYMBOL),
    keys.includes('inherited'),
  ];

  const probes: Record<string, (o: Record<string, unknown>) => (string | symbol)[]> = {
    'for…in': (o) => {
      const keys: string[] = [];
      for (const key in o) keys.push(key);
      return keys;
    },
    'Object.keys / values': (o) => Object.keys(o),
    '{ ...obj } / assign': (o) => Reflect.ownKeys({ ...o }),
    'JSON.stringify': (o) => Object.keys(JSON.parse(JSON.stringify(o)) as object),
    getOwnPropertyNames: (o) => Object.getOwnPropertyNames(o),
    getOwnPropertySymbols: (o) => Object.getOwnPropertySymbols(o),
    'Reflect.ownKeys': (o) => Reflect.ownKeys(o),
  };

  for (const row of ENUM_ROWS) {
    it(`${row.name} → ${row.cells.map((c, i) => (c ? ENUM_HEAD[i + 1] : null)).filter(Boolean).join(', ') || 'ничего'}`, () => {
      expect(probes[row.name], `для строки «${row.name}» нет пробы`).toBeTypeOf('function');
      expect(categories(probes[row.name](probeObject()))).toEqual(row.cells);
    });
  }

  it('`Object.assign` даёт то же, что спред, — они стоят в таблице одной строкой', () => {
    const spread = categories(Reflect.ownKeys({ ...probeObject() }));
    const assign = categories(Reflect.ownKeys(Object.assign({}, probeObject())));
    expect(assign).toEqual(spread);
  });

  /**
   * Тонкость из подписи к таблице, и единственное место, где колонка «символы» значит
   * разное у соседних строк: `getOwnPropertySymbols` фильтрует по типу ключа,
   * а спред — по `enumerable`.
   */
  it('неперечислимый символ: `getOwnPropertySymbols` его отдаёт, спред — нет', () => {
    const quiet = Symbol('неперечислимый символ');
    const source = {};
    Object.defineProperty(source, quiet, { value: 1, enumerable: false });

    expect(Object.getOwnPropertySymbols(source)).toContain(quiet);
    expect(Reflect.ownKeys({ ...source })).not.toContain(quiet);
  });

  it('`for…in` — единственный, кто ходит по цепочке', () => {
    const chainWalkers = ENUM_ROWS.filter((r) => r.cells[3]).map((r) => r.name);
    expect(chainWalkers).toEqual(['for…in']);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · порядок ключей
// ---------------------------------------------------------------------------

describe('порядок собственных ключей', () => {
  /** Объект собирается из того самого литерала, что напечатан на странице. */
  const fromLesson = () =>
    (
      new Function('Symbol', `'use strict'; return ${KEY_ORDER_CODE};`) as (
        s: SymbolConstructor,
      ) => Record<string, unknown>
    )(Symbol);

  const label = (key: string | symbol) =>
    typeof key === 'symbol' ? `Symbol(${key.description})` : `'${key}'`;

  it(`${KEY_ORDER_RULES[0]}; ${KEY_ORDER_RULES[1]}; ${KEY_ORDER_RULES[2]}`, () => {
    expect(Reflect.ownKeys(fromLesson()).map(label)).toEqual(KEY_ORDER_CHIPS.map((c) => c.label));
  });

  it('канонической записи нет — значит, не индекс: такие ключи уходят в порядке добавления', () => {
    const notIndexes = ['01', '1.0', '-1', '+1', '1e2'];
    // Список в тесте и список в подписи обязаны быть одним списком.
    for (const key of notIndexes) expect(KEY_ORDER_NOTE).toContain(`\`'${key}'\``);

    const o: Record<string, unknown> = {};
    for (const key of notIndexes) o[key] = 1;
    o[7] = 1;

    expect(Object.keys(o)).toEqual(['7', ...notIndexes]);
  });

  it('граница индекса: 4294967294 — ещё индекс, 4294967295 — уже строка', () => {
    const o: Record<string, unknown> = { '4294967295': 1, b: 2, '4294967294': 3 };
    expect(Object.keys(o)).toEqual(['4294967294', '4294967295', 'b']);
    expect(KEY_ORDER_NOTE).toContain('4294967295');
  });

  it('`JSON.stringify` следует тому же порядку — JSON приходит пересортированным', () => {
    const json = JSON.stringify(fromLesson());
    const orderInJson = [...json.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
    const stringKeys = Reflect.ownKeys(fromLesson()).filter((k): k is string => typeof k === 'string');

    expect(orderInJson).toEqual(stringKeys);
    expect(json).toBe('{"1":4,"2":5,"3":2,"b":1,"a":3}');
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · приватные поля
// ---------------------------------------------------------------------------

class Temperature {
  #celsius = 20;

  static is(x: unknown): boolean {
    return #celsius in (x as Temperature);
  }

  read(): number {
    return this.#celsius;
  }
}

describe('приватное поле — десять проб', () => {
  const t = new Temperature();

  /** Форма записи результата в таблице: строки в кавычках, ошибка — именем, остальное как есть. */
  const format = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
    if (value instanceof Error) return value.name;
    if (typeof value === 'string') return `'${value}'`;
    return String(value);
  };

  const results: Record<string, () => unknown> = {
    'Object.keys(t)': () => Object.keys(t),
    'Reflect.ownKeys(t)': () => Reflect.ownKeys(t),
    'JSON.stringify(t)': () => JSON.stringify(t),
    getOwnPropertyDescriptor: () => Object.getOwnPropertyDescriptor(t, '#celsius'),
    "t['#celsius']": () => (t as unknown as Record<string, unknown>)['#celsius'],
    '#celsius in t': () => Temperature.is(t),
    'Temperature.is({ ...t })': () => Temperature.is({ ...t }),
    'Temperature.is(Object.create(Temperature.prototype))': () =>
      Temperature.is(Object.create(Temperature.prototype)),
    'Temperature.is(new Proxy(t, {}))': () => Temperature.is(new Proxy(t, {})),
    // Обращение вне класса — ошибка **разбора**, а не выполнения: поймать её можно только
    // там, где разбор отделён от вызова. Отсюда `new Function`, а не прямая строка в тесте:
    // написанная прямо, она уронила бы сам файл теста, и это ровно то, о чём говорит урок.
    't.#celsius вне класса': () => {
      try {
        new Function('t', 'return t.#celsius;');
        return 'скомпилировалось';
      } catch (error) {
        return error;
      }
    },
  };

  for (const probe of PRIVATE_PROBES) {
    it(`${probe.k} → ${probe.v}`, () => {
      expect(results[probe.k], `для пробы «${probe.k}» нет запуска`).toBeTypeOf('function');
      const actual = results[probe.k]();

      expect(format(actual)).toBe(probe.v);
      expect(probe.ok, 'колонка «получилось» — это буквально true в результате').toBe(actual === true);
    });
  }

  it('само поле при этом на месте и равно значению из слота', () => {
    expect(t.read()).toBe(Number(PRIVATE_SLOT.match(/(\d+)$/)![1]));
  });

  it('приватность на уровне класса, а не экземпляра: чужой свой виден', () => {
    expect(Temperature.is(new Temperature())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · порядок инициализации класса
// ---------------------------------------------------------------------------

describe('порядок инициализации класса — тот же листинг, что на странице', () => {
  /** Классы собираются из строк `CI_BASE` и `CI_CHILD`: сверяется то, что читатель видит. */
  function runLesson(): string[] {
    const out: string[] = [];
    const source = ["'use strict';", ...CI_BASE, ...CI_CHILD, 'new Child();'].join('\n');
    const run = new Function('console', source) as (c: { log: (...a: unknown[]) => void }) => void;
    run({ log: (...args) => out.push(args.map(show).join(' ')) });
    return out;
  }

  it('вывод совпадает с последним шагом демо', () => {
    expect(runLesson()).toEqual(CI_STEPS.at(-1)!.out);
  });

  it('`init()` из конструктора родителя видит поле потомка как undefined', () => {
    const [first] = runLesson();
    expect(first).toContain('undefined');
    // Главное утверждение раздела: поле присваивается после super(), а не до.
    expect(runLesson()[1]).toContain('[]');
  });

  it('вывод в шагах только прирастает — ни один шаг ничего не отменяет', () => {
    const final = CI_STEPS.at(-1)!.out;
    for (const step of CI_STEPS) expect(final.slice(0, step.out.length)).toEqual(step.out);
  });

  it('до super() привязки this нет — обращение даёт ReferenceError, а не undefined', () => {
    class Base {}
    class Child extends Base {
      value: unknown;
      constructor() {
        // @ts-expect-error — обращение до super() и есть проверяемое поведение
        void this.value;
        super();
      }
    }
    expect(() => new Child()).toThrow(ReferenceError);
  });

  it('поле потомка ставится через [[DefineOwnProperty]] — сеттер родителя молчит', () => {
    let setterCalls = 0;
    class Base {
      set items(_v: unknown) {
        setterCalls += 1;
      }
      get items(): unknown {
        return 'из прототипа';
      }
    }
    class Child extends Base {
      // @ts-expect-error — поле, затеняющее аксессор родителя, и есть проверяемое поведение
      items: unknown[] = [];
    }

    const child = new Child();
    expect(setterCalls, 'инициализатор поля идёт мимо [[Set]]').toBe(0);
    expect(Object.getOwnPropertyDescriptor(child, 'items')?.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Раздел 6 · генераторы
// ---------------------------------------------------------------------------

describe('генератор как корутина — четыре состояния и три способа его двинуть', () => {
  type Dialog = Generator<string, string, unknown>;

  /** Генератор берётся из листинга урока, а не пишется заново рядом. */
  function makeDialog(): { g: Dialog; out: string[] } {
    const out: string[] = [];
    const factory = new Function(
      'console',
      `'use strict';\n${GEN_CODE.join('\n')}\nreturn dialog;`,
    ) as (c: { log: (...a: unknown[]) => void }) => () => Dialog;
    const dialog = factory({ log: (...args) => out.push(args.map(show).join(' ')) });
    return { g: dialog(), out };
  }

  /** Тексты берём из самого листинга: разъехаться с ним они не должны. */
  const quoted = (line: string) => line.match(/'([^']*)'/)![1];
  const FIRST_QUESTION = quoted(GEN_CODE[2]);
  const CLEANUP = quoted(GEN_CODE[6]);

  it('состояний ровно четыре, и строки указывают на настоящие места кода', () => {
    expect(GEN_LINES).toHaveLength(GEN_LABELS.length);
    expect(GEN_LINES[0], 'suspended-start: тело не выполнялось').toBe(-1);
    expect(GEN_CODE[GEN_LINES[1]]).toContain('yield');
    expect(GEN_CODE[GEN_LINES[2]]).toContain('yield');
    expect(GEN_CODE[GEN_LINES[3]]).toContain(CLEANUP);
  });

  it('до первого next() тело не выполняется', () => {
    const { out } = makeDialog();
    expect(out).toEqual([]);
  });

  it('next(значение) — это результат приостановленного yield, а не аргумент вызова', () => {
    const { g, out } = makeDialog();

    expect(g.next()).toEqual({ value: FIRST_QUESTION, done: false });
    expect(g.next('Аня')).toEqual({ value: 'Привет, Аня…', done: false });
    expect(out, 'finally ещё не трогали').toEqual([]);

    expect(g.next(29)).toEqual({ value: 'Аня, 29', done: true });
    expect(out, 'нормальное завершение тоже проходит через finally').toEqual([CLEANUP]);

    expect(g.next(), 'исчерпанный генератор закрыт навсегда').toEqual({
      value: undefined,
      done: true,
    });
  });

  it('throw() бросает изнутри точки паузы: finally срабатывает, ошибка выходит наружу', () => {
    const { g, out } = makeDialog();
    g.next();

    const boom = new Error('обрыв');
    expect(() => g.throw(boom)).toThrow(boom);
    expect(out).toEqual([CLEANUP]);
    expect(g.next()).toEqual({ value: undefined, done: true });
  });

  it('return() закрывает генератор мягко — finally тоже выполняется', () => {
    const { g, out } = makeDialog();
    g.next();

    expect(g.return('стоп')).toEqual({ value: 'стоп', done: true });
    expect(out).toEqual([CLEANUP]);
  });

  it('`for…of` с break закрывает итератор сам — через тот же return()', () => {
    const { g, out } = makeDialog();
    for (const question of g) {
      expect(question).toBe(FIRST_QUESTION);
      break;
    }
    expect(out, 'ради этого return() и существует: освободить ресурс').toEqual([CLEANUP]);
  });

  it('генератор одноразовый, а фабрика — нет', () => {
    function* gen() {
      yield 0;
      yield 1;
      yield 2;
    }
    const g = gen();
    expect([...g]).toEqual([0, 1, 2]);
    expect([...g], ONCE_CODE.includes('← исчерпан') ? 'исчерпан' : '').toEqual([]);

    const iterable = { *[Symbol.iterator]() { yield 0; yield 1; yield 2; } };
    expect([...iterable]).toEqual([0, 1, 2]);
    expect([...iterable], FACTORY_CODE.includes('[0, 1, 2]') ? 'фабрика' : '').toEqual([0, 1, 2]);
  });

  it('`return` генератора наружу не виден — ни спреду, ни for…of', () => {
    function* withReturn() {
      yield 1;
      return 'не увидят';
    }
    expect([...withReturn()]).toEqual([1]);
  });
});

/*
 * ───────────── Бывшее «за кадром»: семь пунктов, раскрытых в самой теме ─────────────
 *
 * Каждый блок ниже исполняет **строку со страницы** (`*_CODE` из `data.ts`), а не её копию,
 * и сверяет с движком то, что напечатано в комментариях примера и в карточках рядом.
 * Node 26.8.2 · V8 14.6. Декораторы — исключение по необходимости: в этом Node их синтаксиса
 * нет даже под флагом, поэтому строка проходит через компилятор TypeScript, а исполняется
 * его вывод.
 */

/** Выполнить пример со страницы в строгом режиме и вернуть названные привязки. */
function исполнить<T>(code: string, names: string[]): T {
  // перевод строки обязателен: пример кончается комментарием, и `return` иначе уйдёт в него
  return new Function('"use strict";' + code + `\n; return { ${names.join(', ')} };`)() as T;
}



describe('приватность через WeakMap: чем она уступает слоту', () => {
  type T = { value: unknown };
  function собрать() {
    return исполнить<{ Temperature: { new (): T; is(x: unknown): boolean }; t: T; celsius: WeakMap<object, number> }>(
      WEAKMAP_PRIVATE_CODE,
      ['Temperature', 't', 'celsius'],
    );
  }

  it('пробы из комментариев примера', () => {
    const { Temperature, t } = собрать();
    expect(Object.keys(t)).toEqual([]);
    expect(Reflect.ownKeys(t)).toEqual([]);
    expect(JSON.stringify(t)).toBe('{}');
    expect(t.value).toBe(20);
    expect(Temperature.is(new Proxy(t, {}))).toBe(false);
    expect(Temperature.is(t)).toBe(true);
  });

  it('сквозь прокси: WeakMap молчит `undefined`, #-поле бросает TypeError', () => {
    expect(WEAKMAP_VS_SLOT[0].t).toContain('молча `undefined`');
    const { t } = собрать();
    expect(new Proxy(t, {}).value).toBeUndefined();

    class WithSlot { #c = 20; get value() { return this.#c; } }
    expect(() => new Proxy(new WithSlot(), {}).value).toThrow(TypeError);
  });

  it('подменённый WeakMap.prototype.set видит «приватное» значение', () => {
    const украдено: unknown[] = [];
    const настоящий = WeakMap.prototype.set;
    WeakMap.prototype.set = function (this: WeakMap<object, unknown>, k: object, v: unknown) {
      украдено.push(v);
      return настоящий.call(this, k, v);
    };
    try {
      собрать();
    } finally {
      WeakMap.prototype.set = настоящий;
    }
    expect(украдено).toEqual([20]);
  });

  it('ключ — любой объект, и замороженный тоже; примитив — TypeError', () => {
    const w = new WeakMap<object, number>();
    const frozen = Object.freeze({});
    w.set(frozen, 1);
    expect(w.get(frozen)).toBe(1);
    expect(() => w.set('s' as unknown as object, 1)).toThrow(TypeError);
  });

  /**
   * «Хеш-таблица против места в объекте» — устройство V8, из языка не видимое. Поэтому
   * проверка в отдельном процессе с `--allow-natives-syntax`, тем же приёмом, что
   * `elements-kinds.test.ts`. Числа времени здесь нет намеренно: сверяется устройство.
   */
  it('%DebugPrint: #-поле лежит в самом объекте, у WeakMap — своя таблица', () => {
    const run = (code: string) =>
      execFileSync(process.execPath, ['--allow-natives-syntax', '-e', code], { encoding: 'utf8' });

    const slot = run('class A { #x = 1 } %DebugPrint(new A());');
    expect(slot).toMatch(/<Symbol: #x>: 1 .*location: in-object/);

    const table = run('const w = new WeakMap(); w.set({}, 1); %DebugPrint(w);');
    expect(table).toContain('EPHEMERON_HASH_TABLE_TYPE');
    expect(WEAKMAP_VS_SLOT[2].d).toContain('EPHEMERON_HASH_TABLE_TYPE');
  });
});

describe('декораторы: строка со страницы через компилятор TypeScript', () => {
  /** Нынешний вариант: `experimentalDecorators` выключен, цель ES2022 — классы и `#` остаются как есть. */
  function собрать(code: string, names: string[], experimental = false) {
    const js = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, experimentalDecorators: experimental },
      fileName: 'decorators.ts',
    }).outputText;
    return new Function('"use strict";' + js + `\n; return { ${names.join(', ')} };`)() as Record<string, unknown>;
  }

  it('в Node 26.8 синтаксиса нет — ни без флага, ни с --js-decorators', () => {
    for (const flags of [[], ['--js-decorators']]) {
      let вывод = '';
      try {
        execFileSync(process.execPath, [...flags, '-e', 'class A { @(x => x) m() {} }'], { encoding: 'utf8', stdio: 'pipe' });
      } catch (e) {
        вывод = String((e as { stderr?: string }).stderr);
      }
      expect(вывод, `флаги: ${flags.join(' ') || 'нет'}`).toContain('SyntaxError');
    }
  });

  /** Строки-пробы `выражение;   // вывод` исполняются на своих местах: `util.inspect` против комментария. */
  function пробы(code: string) {
    const isProbe = (l: string) => /^[^\s/].*;\s+\/\/ /.test(l) && !/^(const|let|class|function)\b/.test(l);
    const out: { expr: string; expected: string; got: string }[] = [];
    const body = code
      .split('\n')
      .map((l) => {
        if (!isProbe(l)) return l;
        const [expr, expected] = l.split(/;\s+\/\/ /);
        const i = out.push({ expr, expected: expected.split('  ←')[0].trim(), got: '' }) - 1;
        return `try { __r(${i}, (${expr})); } catch (e) { __r(${i}, e, true); }`;
      })
      .join('\n');
    const js = ts.transpileModule(body, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
      fileName: 'decorators.ts',
    }).outputText;
    new Function('__r', '"use strict";' + js)((i: number, v: unknown, threw = false) => {
      out[i].got = threw ? String(v) : inspect(v);
    });
    return out;
  }

  it('обёртка метода: декоратор сработал до первого new', () => {
    const list = пробы(DECORATOR_CODE);
    expect(list).toHaveLength(3);
    for (const p of list) expect(p.got, p.expr).toBe(p.expected);
  });

  it('addInitializer: при new, раньше полей', () => {
    const list = пробы(DECORATOR_INIT_CODE);
    expect(list).toHaveLength(1);
    for (const p of list) expect(p.got, p.expr).toBe(p.expected);
  });

  it('#-поле: пара функций, у чужого объекта — TypeError', () => {
    const list = пробы(DECORATOR_PRIVATE_CODE);
    expect(list).toHaveLength(3);
    const [a, b, c] = list;
    expect(a.got).toBe('7');
    expect(b.got).toBe('8');
    expect(c.got.startsWith(c.expected.replace(' …', ''))).toBe(true);
  });

  it('метод заменён, а флаги — как у метода: дескриптора декоратор не касался', () => {
    const { Dog } = собрать(DECORATOR_CODE.split('\nlog;')[0], ['Dog']) as { Dog: { prototype: object } };
    const desc = Object.getOwnPropertyDescriptor(Dog.prototype, 'bark')!;
    expect(desc).toMatchObject({ writable: true, enumerable: false, configurable: true });
  });

  it('context — семь полей, дескриптора среди них нет; вернуть объект вместо функции — TypeError', () => {
    const { ctx } = собрать('let ctx; function k(v, c) { ctx = c } class D { @k m() {} }', ['ctx']) as { ctx: object };
    expect(Object.keys(ctx).sort()).toEqual(['access', 'addInitializer', 'kind', 'metadata', 'name', 'private', 'static']);
    // Текст называет все семь полей — каждое своим именем, в любом порядке.
    for (const key of Object.keys(ctx)) expect(DECORATOR_FACTS[0].d).toContain('`' + key + '`');

    expect(() => собрать('function d() { return { value: 1, enumerable: true } } class B { @d m() {} }', ['B'])).toThrow(TypeError);
  });

  it('прежний вариант (experimentalDecorators) действительно получал дескриптор', () => {
    const { seen } = собрать(
      'const seen = []; function old(t, key, desc) { seen.push(key, Object.keys(desc).join()) } class A { @old m() {} }',
      ['seen'],
      true,
    ) as { seen: string[] };
    expect(seen).toEqual(['m', 'value,writable,enumerable,configurable']);
  });

  it('addInitializer у наследника: после super(), до собственных полей', () => {
    const { log } = собрать(
      `const log = [];
       function init(m, c) { c.addInitializer(function () { log.push('base=' + this.base + ' own=' + this.own) }) }
       class Base { base = 'есть' }
       class Child extends Base { own = 'есть'; @init m() {} }
       new Child();`,
      ['log'],
    ) as { log: string[] };
    expect(log).toEqual(['base=есть own=undefined']);
  });

  it('accessor: слот + пара на прототипе, запись идёт через декоратор', () => {
    const { log, c, C } = собрать(
      `const log = [];
       function watch({ set }, ctx) { return { set(v) { log.push('запись ' + v); set.call(this, v) } } }
       class C { @watch accessor size = 1 }
       const c = new C(); c.size = 5;`,
      ['log', 'c', 'C'],
    ) as { log: string[]; c: { size: number }; C: { prototype: object } };
    expect(log).toEqual(['запись 5']);
    expect(c.size).toBe(5);
    expect(Object.keys(c)).toEqual([]);
    expect(typeof Object.getOwnPropertyDescriptor(C.prototype, 'size')?.get).toBe('function');
  });
});

describe('помощники итераторов: ленивый конвейер', () => {
  it('пример: бесконечный источник, два ответа, источник закрыт', () => {
    const { firstEvens, log } = исполнить<{ firstEvens: number[]; log: string[] }>(ITER_HELPERS_CODE, ['firstEvens', 'log']);
    expect(firstEvens).toEqual([20, 40]);
    expect(log).toEqual(['дал 1', 'дал 2', 'дал 3', 'дал 4', 'источник закрыт']);
  });

  it('живут на Iterator.prototype; ленивые и потребляющие — как в карточке', () => {
    const own = Object.getOwnPropertyNames(Iterator.prototype);
    for (const name of ['map', 'filter', 'take', 'drop', 'flatMap', 'toArray', 'reduce', 'forEach', 'some', 'every', 'find']) {
      expect(own, name).toContain(name);
    }
    expect(Object.getPrototypeOf(Object.getPrototypeOf([].values()))).toBe(Iterator.prototype);
    const bare = { i: 0, next() { return this.i < 3 ? { value: this.i++, done: false } : { value: undefined, done: true }; } };
    expect((bare as { map?: unknown }).map).toBeUndefined();
    expect(Iterator.from(bare).map((x) => (x as number) * 2).toArray()).toEqual([0, 2, 4]);
  });

  it('порядок вызовов: массив — станок за станком, итератор — элемент за элементом', () => {
    const a: string[] = [];
    [1, 2].map((x) => (a.push('f' + x), x)).filter((x) => (a.push('g' + x), true));
    expect(a).toEqual(['f1', 'f2', 'g1', 'g2']);

    const b: string[] = [];
    const конвейер = [1, 2].values().map((x) => (b.push('f' + x), x)).filter((x) => (b.push('g' + x), true));
    expect(b, 'пока никто не позвал next(), не вызвано ничего').toEqual([]);
    конвейер.toArray();
    expect(b).toEqual(['f1', 'g1', 'f2', 'g2']);
  });

  it('some, find и break закрывают источник', () => {
    let закрыт = 0;
    function* g() { try { yield 1; yield 2; yield 3; } finally { закрыт++; } }
    expect(g().some((x) => x === 1)).toBe(true);
    expect(g().find((x) => x === 2)).toBe(2);
    for (const x of g().map((y) => y)) { void x; break; }
    expect(закрыт).toBe(3);
  });

  it('одноразовые; flatMap не разворачивает строку', () => {
    const h = [1, 2, 3].values().map((x) => x);
    expect([...h]).toEqual([1, 2, 3]);
    expect([...h]).toEqual([]);
    expect(() => [1].values().flatMap(() => 'ab' as unknown as Iterable<string>).toArray()).toThrow(TypeError);
  });
});

describe('карта связей class B extends A: подписи виджета — ответы движка', () => {
  /*
   * Подписи `PrototypeMap.astro` набраны в шаблоне (виджет без пропов), поэтому сверяется
   * сам файл: каждая подпись, которую проверяет тест, обязана в нём стоять. ⚠️ Комментарий
   * виджета до 2026-09-30 утверждал, что `.prototype` можно переприсвоить, — у класса нельзя.
   */
  const map = readFileSync('src/widgets/prototype-map/ui/PrototypeMap.astro', 'utf8');
  const env = new Function('"use strict";' + PROTO_CODE + '; return { A, B };')() as {
    A: { prototype: object };
    B: { prototype: object; create(): object };
  };
  const { A, B } = env;

  it('обе горизонтальные связи — [[Prototype]]', () => {
    expect(Object.getPrototypeOf(B)).toBe(A);
    expect(Object.getPrototypeOf(B.prototype)).toBe(A.prototype);
  });

  it('концы цепочек: A → Function.prototype, A.prototype → Object.prototype → null', () => {
    expect(Object.getPrototypeOf(A)).toBe(Function.prototype);
    expect(Object.getPrototypeOf(A.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
    expect(map).toContain('[[Prototype]] → Function.prototype');
    expect(map).toContain('[[Prototype]] → Object.prototype → null');
  });

  it('B.create(): new this создаёт B, и связь экземпляра записана при new', () => {
    const made = B.create();
    expect(Object.getPrototypeOf(made)).toBe(B.prototype);
    expect(map).toContain('new this создаёт B');
  });

  it('.prototype у класса только для чтения, у функции — нет', () => {
    expect(Object.getOwnPropertyDescriptor(B, 'prototype')!.writable).toBe(false);
    expect(() => { (B as { prototype: object }).prototype = {}; }).toThrow(TypeError);
    function F() {}
    expect(Object.getOwnPropertyDescriptor(F, 'prototype')!.writable).toBe(true);
    expect(map).toContain('у класса только для чтения');
    expect(map).not.toMatch(/можно переприсвоить\)/);
  });
});

/** Блок «`super` не имеет отношения к `this`» (2026-10-05): каждый вывод из комментариев — запуском. */
describe('super и [[HomeObject]]', () => {
  /** Строки-пробы `X.greet();   // вывод` вырезаются, выражение вычисляется после остального листинга. */
  const run = (code: string, expr: string): string => {
    try {
      return inspect(new Function(`${code.split('\n').filter((l) => !/^\w+\.greet\(\);/.test(l)).join('\n')}\nreturn ${expr};`)());
    } catch (e) {
      return String(e);
    }
  };

  it('«поиск от this»: на двух уровнях работает, на трёх — переполнение стека', () => {
    expect(run(SUPER_VIA_THIS_CODE, 'B.greet()')).toBe("'B>A'");
    expect(run(SUPER_VIA_THIS_CODE, 'C.greet()')).toBe('RangeError: Maximum call stack size exceeded');
    expect(SUPER_VIA_THIS_CODE).toContain("B.greet();   // 'B>A'");
    expect(SUPER_VIA_THIS_CODE).toContain('C.greet();   // RangeError: Maximum call stack size exceeded');
  });

  it('настоящий super проходит три уровня', () => {
    expect(run(SUPER_REAL_CODE, 'C.greet()')).toBe("'C>B>A'");
    expect(SUPER_REAL_CODE).toContain("// 'C>B>A'");
  });

  it('скопированный метод ищет родителя от старого места', () => {
    expect(run(HOME_OBJECT_CODE, 'C.greet()')).toBe("'B>A'");
    expect(HOME_OBJECT_CODE).toContain("// 'B>A' — не 'B>C'");
  });

  it('super в обычной функции — SyntaxError до запуска', () => {
    expect(HOME_OBJECT_NOTE).toContain('`SyntaxError`');
    expect(() => new Function('const obj = {}; obj.m = function () { return super.x; };')).toThrow(SyntaxError);
  });
});

/** «Статический блок: доступ к приватному полю для своих» (2026-10-05). */
describe('статический блок', () => {
  const lines = STATIC_BLOCK_CODE.split('\n');
  const last = lines.at(-1)!;
  const body = lines.slice(0, -1).filter((l) => !l.startsWith('readSecret(')).join('\n');

  it('функция из блока читает #-поле: 42', () => {
    expect(new Function(`${body}\nreturn readSecret(new Vault());`)()).toBe(42);
    expect(STATIC_BLOCK_CODE).toContain('readSecret(new Vault());   // 42');
  });

  it('последняя строка — SyntaxError на разборе, файл не запускается вовсе', () => {
    expect(last).toBe('new Vault().#secret;');
    let ran = false;
    expect(() => new Function('ran', `ran(); ${STATIC_BLOCK_CODE}`)(() => (ran = true))).toThrow(SyntaxError);
    expect(ran, 'ни одна строка файла не исполнилась').toBe(false);
  });

  it('инициализатор статического поля тоже видит #-поля — «единственного способа» нет', () => {
    const read = new Function('let r; class V { #s = 1; static #init = (r = (v) => v.#s); } return r(new V());')();
    expect(read).toBe(1);
  });

  it('карточки: this — класс; поле ниже блока ещё undefined; static #x через подкласс — TypeError', () => {
    const [self, K] = new Function('let self; class K { static { self = this; } } return [self, K];')();
    expect(self).toBe(K);
    expect(new Function('class O { static { O.seen = O.later; } static later = 5; } return O.seen;')()).toBeUndefined();
    const run = () => new Function('class P { static #x = 1; static read() { return this.#x; } } class Q extends P {} return Q.read();')();
    expect(run).toThrow(TypeError);
    expect(STATIC_BLOCK_FACTS[2].d).toContain('`TypeError`');
  });
});
