import { cloneDeep } from 'lodash-es';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/serialization/data';
import { loadImpl, loadSample, nativeCheck, runMethods } from '@/widgets/clone-lab/model/run';
import { losses, shape, show } from '@/widgets/clone-lab/model/shape';

/**
 * Тема «Копирование и сериализация: JSON и structuredClone».
 *
 * `STRINGIFY_CODE` и `CLONE_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с настоящими `JSON.stringify` (байт в байт) и `structuredClone`
 * (по `shape`: типы, прототипы, ключи с флагами, граф ссылок) — на наборе значений и на
 * случайных деревьях с фиксированным зерном. Примеры темы исполняются, их вывод сверяется
 * со стрелками `// →` в самом коде. Таблицы проверяются построчно.
 */

const impl = loadImpl(t.STRINGIFY_CODE, t.CLONE_CODE);

// ─── Исполнение примеров ─────────────────────────────────────────────────────────────────

/** Как печатает `console.log` в примерах: строки как есть, остальное — `show`. */
const fmt = (x: unknown) => (typeof x === 'string' ? x : show(x));

function run(code: string): string[] {
  const out: string[] = [];
  const fakeConsole = { log: (...a: unknown[]) => out.push(a.map(fmt).join(' ')) };
  new Function('console', 'cloneDeep', `${t.ORDER_CODE}\n${code}`)(fakeConsole, cloneDeep);
  return out;
}

/** Ожидания из кода: всё, что стоит после `// → `, по порядку. */
const arrows = (code: string) => [...code.matchAll(/\/\/ → (.*)$/gm)].map((m) => m[1].trimEnd());

describe('примеры темы: вывод совпадает со стрелками в коде', () => {
  const examples: [string, string][] = [
    ['SHALLOW_CODE', t.SHALLOW_CODE],
    ['GETTER_CODE', t.GETTER_CODE],
    ['STRINGIFY_ORDER_CODE', t.STRINGIFY_ORDER_CODE],
    ['REPLACER_CODE', t.REPLACER_CODE],
    ['ARRAY_REPLACER_CODE', t.ARRAY_REPLACER_CODE],
    ['REVIVER_CODE', t.REVIVER_CODE],
    ['DROP_CODE', t.DROP_CODE],
    ['CLONE_ORDER_CODE', t.CLONE_ORDER_CODE],
    ['SLOTS_CODE', t.SLOTS_CODE],
    ['ERROR_CODE', t.ERROR_CODE],
    ['THROW_CODE', t.THROW_CODE],
    ['TRANSFER_CODE', t.TRANSFER_CODE],
    ['LODASH_CLASS_CODE', t.LODASH_CLASS_CODE],
  ];
  for (const [name, code] of examples) {
    it(name, () => {
      const want = arrows(code);
      expect(want.length, `${name}: стрелок нет`).toBeGreaterThan(0);
      expect(run(code)).toEqual(want);
    });
  }

  it('SPACE_CODE печатает SPACE_OUT', () => {
    expect(run(t.SPACE_CODE)).toEqual([t.SPACE_OUT]);
  });

  it('CYCLE_CODE: общая ссылка пишется дважды, цикл — TypeError с текстом V8 из темы', () => {
    const [first] = t.CYCLE_CODE.split('\npost.self');
    expect(run(first)).toEqual(arrows(first));
    let caught: unknown;
    try {
      run(t.CYCLE_CODE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect(`TypeError: ${(caught as Error).message}`).toBe(t.CYCLE_ERROR);
  });
});

// ─── Таблицы ─────────────────────────────────────────────────────────────────────────────

const evalExpr = (expr: string) => (0, eval)(`(${expr})`);

/** Ответ сериализатора так, как он стоит в таблице: строка, `undefined` или имя исключения. */
function answer(fn: (v: unknown) => string | undefined, expr: string): string {
  try {
    const r = fn(evalExpr(expr));
    return r === undefined ? 'undefined' : r;
  } catch (e) {
    return (e as Error).name;
  }
}

describe('таблица STRINGIFY_ROWS', () => {
  for (const row of t.STRINGIFY_ROWS) {
    it(`${row.expr} → ${row.out}`, () => {
      expect(answer((v) => JSON.stringify(v), row.expr)).toBe(row.out);
      expect(answer((v) => impl.stringify(v), row.expr)).toBe(row.out);
    });
  }
});

describe('факты о JSON из текста', () => {
  it('отступ: число не больше 10, строка — первые 10 символов', () => {
    expect(JSON.stringify({ a: 1 }, null, 20).split('\n')[1]).toBe(`${' '.repeat(10)}"a": 1`);
    expect(JSON.stringify({ a: 1 }, null, 'abcdefghijkl').split('\n')[1]).toBe('abcdefghij"a": 1');
    expect(JSON.stringify({ a: {}, b: [] }, null, 2)).toBe('{\n  "a": {},\n  "b": []\n}');
    expect(t.SPACE_NOTE).toContain('не больше 10');
  });

  it('массив-replacer: числа → строки, повторы и прочее отбрасываются, индексы не трогает', () => {
    expect(JSON.stringify({ 1: 'x', b: 2, a: 3 }, ['a', 1, 'a', true, null, {}] as never)).toBe('{"a":3,"1":"x"}');
    expect(JSON.stringify([{ a: 1, z: 2 }], ['a'])).toBe('[{"a":1}]');
  });

  it('JSON.parse: __proto__ — свой ключ, большие числа, повтор ключа, 1e400', () => {
    const o = JSON.parse('{"__proto__": {"x": 1}}');
    expect(Object.hasOwn(o, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
    expect(JSON.parse('{"id": 9007199254740993}').id).toBe(9007199254740992);
    expect(JSON.parse('{"a":1,"a":2}').a).toBe(2);
    expect(JSON.parse('1e400')).toBe(Infinity);
  });

  it('context.source есть только у примитивов', () => {
    const seen: [string, unknown][] = [];
    JSON.parse('{"a":[1],"s":"x"}', function (key: string, value: unknown, context: { source?: string }) {
      seen.push([key, context.source]);
      return value;
    } as never);
    expect(seen).toEqual([['0', '1'], ['a', undefined], ['s', '"x"'], ['', undefined]]);
  });

  it('BigInt: текст ошибки V8 — тот, что в стенде', () => {
    expect(() => JSON.stringify({ a: 1n })).toThrow('Do not know how to serialize a BigInt');
  });
});

describe('таблица SHALLOW_ROWS: спред и Object.assign', () => {
  const both = (src: object) => [{ ...src }, Object.assign({}, src)];
  const row = (k: string) => {
    const r = t.SHALLOW_ROWS.find((x) => x.k.startsWith(k));
    if (!r) throw new Error(`нет строки ${k}`);
    return r;
  };

  it('вложенный объект общий', () => {
    const src = { n: { x: 1 } };
    for (const c of both(src)) expect((c as typeof src).n).toBe(src.n);
    expect(row('вложенный').spread).toBe('общий с оригиналом');
  });
  it('геттер вызван, в копии значение', () => {
    let n = 0;
    const src = { get g() { n += 1; return 1; } };
    for (const c of both(src)) expect(Object.getOwnPropertyDescriptor(c, 'g')).toEqual({ value: 1, writable: true, enumerable: true, configurable: true });
    expect(n).toBe(2);
  });
  it('неперечисляемое пропало, символ скопирован', () => {
    const k = Symbol('k');
    const src = Object.defineProperty({ [k]: 1 }, 'h', { value: 1, enumerable: false });
    for (const c of both(src)) {
      expect('h' in c).toBe(false);
      expect((c as Record<symbol, number>)[k]).toBe(1);
    }
    expect(row('ключ-символ').assign).toBe('скопирован');
  });
  it('только для чтения стало записываемым', () => {
    for (const c of both(Object.freeze({ a: 1 }))) expect(Object.getOwnPropertyDescriptor(c, 'a')?.writable).toBe(true);
  });
  it('прототип и #-поля потеряны', () => {
    class A {
      #p = 1;
      static has(o: object) {
        return #p in o;
      }
    }
    for (const c of both(new A())) {
      expect(c instanceof A).toBe(false);
      expect(A.has(c)).toBe(false);
    }
  });
  it('сеттер цели: assign вызывает, спред — нет', () => {
    let calls = 0;
    const target = { set g(_v: number) { calls += 1; } };
    Object.assign(target, { g: 1 });
    expect(calls).toBe(1);
    const spread = { set g(_v: number) { calls += 1; }, ...{ g: 1 } };
    expect(calls).toBe(1);
    expect(Object.getOwnPropertyDescriptor(spread, 'g')?.value).toBe(1);
  });
});

describe('таблица COMPARE_ROWS: JSON, structuredClone, cloneDeep', () => {
  const json = (v: unknown) => JSON.parse(JSON.stringify(v));
  const cell = (k: string) => {
    const r = t.COMPARE_ROWS.find((x) => x.k === k);
    if (!r) throw new Error(`нет строки ${k}`);
    return r;
  };
  const throwsName = (fn: () => unknown) => {
    try {
      fn();
      return null;
    } catch (e) {
      return (e as Error).name;
    }
  };

  it('Date', () => {
    const d = new Date(0);
    expect(typeof json({ d }).d).toBe('string');
    expect(structuredClone(d)).toBeInstanceOf(Date);
    expect(cloneDeep(d)).toBeInstanceOf(Date);
    expect(cell('`Date`').json).toBe('строка ИSO'.replace('И', 'I'));
  });
  it('Map, Set', () => {
    const k = { key: 1 };
    const m = new Map([[k, { v: 1 }]]);
    expect(json({ m }).m).toEqual({});
    const sc = structuredClone(m);
    expect([...sc.keys()][0]).not.toBe(k);
    const lc = cloneDeep(m);
    expect([...lc.keys()][0]).toBe(k);
    expect([...lc.values()][0]).not.toBe(m.get(k));
    expect(cloneDeep(new Set([k])).has(k)).toBe(false);
  });
  it('undefined, NaN, Infinity, BigInt', () => {
    expect('u' in json({ u: undefined })).toBe(false);
    expect('u' in structuredClone({ u: undefined })).toBe(true);
    expect('u' in cloneDeep({ u: undefined })).toBe(true);
    expect(json([NaN, Infinity])).toEqual([null, null]);
    expect(structuredClone([NaN, Infinity])).toEqual([NaN, Infinity]);
    expect(cloneDeep([NaN, Infinity])).toEqual([NaN, Infinity]);
    expect(throwsName(() => json({ a: 1n }))).toBe('TypeError');
    expect(structuredClone(1n)).toBe(1n);
    expect(cloneDeep(1n)).toBe(1n);
  });
  it('общая ссылка и цикл', () => {
    const a = { x: 1 };
    const g = { a, b: a } as Record<string, unknown>;
    const j = json(g);
    expect(j.a).not.toBe(j.b);
    for (const c of [structuredClone(g), cloneDeep(g)]) expect(c.a).toBe(c.b);
    g.self = g;
    expect(throwsName(() => json(g))).toBe('TypeError');
    for (const c of [structuredClone(g), cloneDeep(g)]) expect(c.self).toBe(c);
  });
  it('экземпляр класса: lodash сохраняет прототип, но не #-поля', () => {
    class Money {
      #c: number;
      constructor(c: number) {
        this.#c = c;
      }
      get amount() {
        return this.#c / 100;
      }
    }
    const m = new Money(1250);
    expect(Object.getPrototypeOf(json(m))).toBe(Object.prototype);
    expect(Object.getPrototypeOf(structuredClone(m))).toBe(Object.prototype);
    const l = cloneDeep(m);
    expect(l).toBeInstanceOf(Money);
    expect(() => l.amount).toThrow(TypeError);
  });
  it('геттер, неперечисляемое, символ', () => {
    const k = Symbol('k');
    let n = 0;
    const src = Object.defineProperty({ get g() { n += 1; return 1; }, [k]: 1 }, 'h', { value: 1, enumerable: false });
    for (const c of [json(src), structuredClone(src), cloneDeep(src)]) {
      expect(Object.getOwnPropertyDescriptor(c, 'g')?.value).toBe(1);
      expect('h' in c).toBe(false);
    }
    expect(n).toBe(3);
    expect(k in json(src)).toBe(false);
    expect(k in structuredClone(src)).toBe(false);
    expect(k in cloneDeep(src)).toBe(true);
  });
  it('функция, Error, WeakMap', () => {
    const f = () => 1;
    expect('f' in json({ f })).toBe(false);
    expect(throwsName(() => structuredClone({ f }))).toBe('DataCloneError');
    expect(cloneDeep({ f }).f).toBe(f);
    const e = new Error('x', { cause: 1 });
    expect(json({ e }).e).toEqual({});
    const se = structuredClone(e);
    expect([se.message, se.cause, typeof se.stack]).toEqual(['x', 1, 'string']);
    expect(cloneDeep({ e }).e).toBe(e);
    const w = new WeakMap();
    expect(json({ w }).w).toEqual({});
    expect(throwsName(() => structuredClone({ w }))).toBe('DataCloneError');
    expect(cloneDeep({ w }).w).toBe(w);
  });
  it('RegExp, буферы, дыры', () => {
    const re = /a/g;
    re.lastIndex = 3;
    expect(json({ re }).re).toEqual({});
    expect(structuredClone(re).lastIndex).toBe(0);
    expect(cloneDeep(re).lastIndex).toBe(3);
    const b = new ArrayBuffer(8);
    const pair = { x: new Uint8Array(b), y: new Uint8Array(b, 4) };
    expect(json(pair).y).toEqual({ 0: 0, 1: 0, 2: 0, 3: 0 });
    const s = structuredClone(pair);
    expect(s.x.buffer).toBe(s.y.buffer);
    const l = cloneDeep(pair);
    expect(l.x.buffer).not.toBe(l.y.buffer);
    // eslint-disable-next-line no-sparse-arrays
    const holes = [1, , 3];
    expect(json(holes)).toEqual([1, null, 3]);
    expect(1 in structuredClone(holes)).toBe(false);
    const lh = cloneDeep(holes);
    expect(1 in lh).toBe(true);
    expect(lh[1]).toBeUndefined();
  });
});

// ─── Учебные функции против настоящих ────────────────────────────────────────────────────

/** Набор значений, на которых учебные функции сверяются с движком. Фабрики — свежий экземпляр. */
const CORPUS: [string, () => unknown][] = [
  ['order', () => loadSample(t.DEMO_SAMPLES[0].code)()],
  ...t.STRINGIFY_ROWS.map((r) => [r.expr, () => evalExpr(r.expr)] as [string, () => unknown]),
  ['boxed', () => [Object(1), Object('s'), Object(false), Object(2n), new Number(NaN)]],
  ['toJSON key', () => ({ a: { toJSON: (k: string) => `key=${k}` }, b: [{ toJSON: (k: string) => k }] })],
  ['nested empties', () => ({ a: {}, b: [], c: [[]], d: [{}] })],
  ['strings', () => ['\b\t\n\f\r"\\', '\u0000\u001f', '😀\ud83d', '\udc00x', 'кириллица', '  ']],
  ['numbers', () => [0, -0, 1e21, 1e-7, 0.1 + 0.2, -Number.MIN_VALUE, Number.MAX_VALUE, 2 ** 53 + 2]],
  ['getter', () => ({ get a() { return { b: 1 }; }, c: 2 })],
  ['__proto__ key', () => JSON.parse('{"__proto__": {"x": 1}, "y": 2}')],
  ['array extras', () => Object.assign([1, , 3], { extra: 'x' })], // eslint-disable-line no-sparse-arrays
  ['shared', () => { const a = { x: 1 }; return { a, b: [a, a] }; }],
  ['cycle', () => { const a: Record<string, unknown> = {}; a.self = a; return a; }],
  ['error', () => new RangeError('r', { cause: new Error('c') })],
  ['error custom', () => Object.assign(new TypeError('t'), { name: 'Custom', code: 1 })],
  ['error assigned cause', () => { const e = new Error('e') as Error & { cause: unknown }; e.cause = { n: 1 }; return e; }],
  ['error no message', () => new SyntaxError()],
  ['class', () => { class P { x = 1; get y() { return 2; } } return new P(); }],
  ['null proto', () => Object.assign(Object.create(null), { a: 1 })],
  ['frozen', () => Object.freeze({ a: [1] })],
  ['map set', () => { const k = { k: 1 }; return new Map<unknown, unknown>([[k, new Set([k, 1])], ['s', k]]); }],
  ['regexp', () => { const r = /a\/b\n/gimsuy; r.lastIndex = 2; return r; }],
  ['buffers', () => { const b = new ArrayBuffer(16); new Uint8Array(b).set([1, 2, 3]); return [b, new Int16Array(b, 2, 3), new DataView(b, 4, 8), new Float64Array(b, 8)]; }],
  ['resizable', () => new ArrayBuffer(4, { maxByteLength: 32 })],
  ['dates', () => [new Date(0), new Date(NaN), new Date(8.64e15)]],
  ['symbol value', () => ({ s: Symbol('s') })],
  ['symbol object', () => Object(Symbol('s'))],
  ['function', () => ({ f() {} })],
  ['weak', () => [new WeakMap(), new WeakSet()]],
  ['promise', () => Promise.resolve(1)],
  ['bigint top', () => 10n],
  ['detached', () => { const b = new ArrayBuffer(4); b.transfer(); return b; }],
];

function outcome<T>(fn: () => T): T | string {
  try {
    return fn();
  } catch (e) {
    return `throw ${(e as Error).name}`;
  }
}

describe('учебный stringify против JSON.stringify', () => {
  for (const [name, make] of CORPUS) {
    it(name, () => {
      expect(outcome(() => impl.stringify(make()))).toEqual(outcome(() => JSON.stringify(make())));
      for (const space of [2, '\t', 20, -1, 'abcdefghijklm', new Number(3), new String('--'), 2.9]) {
        expect(outcome(() => impl.stringify(make(), null, space))).toEqual(outcome(() => JSON.stringify(make(), null, space as never)));
      }
    });
  }
});

describe('учебный clone против structuredClone', () => {
  for (const [name, make] of CORPUS) {
    it(name, () => {
      expect(outcome(() => shape(impl.clone(make())))).toEqual(outcome(() => shape(structuredClone(make()))));
    });
  }

  it('стек ошибки копируется строкой, порядок своих ключей тот же', () => {
    const e = new TypeError('x', { cause: 1 });
    const mine = impl.clone(e);
    const real = structuredClone(e);
    expect(mine.stack).toBe(e.stack);
    expect(real.stack).toBe(e.stack);
    expect(Reflect.ownKeys(mine)).toEqual(Reflect.ownKeys(real));
  });

  it('геттеры: тот же порядок вызовов и тот же счёт до отказа', () => {
    const make = (log: string[]) => ({
      get b() { log.push('b'); return 1; },
      get a() { log.push('a'); return 1; },
      get 1() { log.push('1'); return 1; },
      f() {},
      get z() { log.push('z'); return 1; },
    });
    const mine: string[] = [];
    const real: string[] = [];
    expect(outcome(() => impl.clone(make(mine)))).toBe('throw DataCloneError');
    expect(outcome(() => structuredClone(make(real)))).toBe('throw DataCloneError');
    expect(mine).toEqual(real);
    expect(real).toEqual(['1', 'b', 'a']);
  });

  it('пропущенное: прокси учебная функция не видит, настоящая — отказывает', () => {
    expect(outcome(() => structuredClone(new Proxy({}, {})))).toBe('throw DataCloneError');
    expect(typeof outcome(() => impl.clone(new Proxy({}, {})))).toBe('object');
    expect(t.CLONE_CODE_NOTE).toContain('Прокси снаружи неотличим');
  });
});

// ─── Случайные деревья ───────────────────────────────────────────────────────────────────

/** mulberry32: маленький ГПСЧ с зерном — прогон повторяется один в один. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const STRINGS = ['', 'a', 'кофе', '"', '\\', '\n', '\u0001', '\ud800', '\udfff', '😀', ' ', '0', '01', '1.5', '-1', '__proto__', 'toJSON', 'length'];
const NUMBERS = [0, -0, 1, -1, 1.5, NaN, Infinity, -Infinity, 1e21, 2 ** 53 + 1, 5e-324];
const KEYS = ['a', 'b', 'c', '0', '1', '10', '01', '-1', 'x y', '__proto__', 'ключ', '😀'];

interface GenOptions {
  /** Разрешить общие ссылки и циклы. */
  graph: boolean;
  /** Разрешить то, на чём structuredClone отказывает (функции, символы, WeakMap). */
  refusable: boolean;
}

function makeTree(seed: number, opts: GenOptions): unknown {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const made: object[] = [];

  function prim(): unknown {
    const n = r();
    if (n < 0.25) return pick(NUMBERS);
    if (n < 0.5) return pick(STRINGS);
    if (n < 0.6) return r() < 0.5;
    if (n < 0.7) return null;
    if (n < 0.78) return undefined;
    if (n < 0.84) return BigInt(Math.floor(r() * 1000) - 500);
    if (opts.refusable && n < 0.9) return Symbol(pick(STRINGS));
    if (opts.refusable && n < 0.95) return function named() {};
    return Math.floor(r() * 100);
  }

  function node(depth: number, path: object[]): unknown {
    if (opts.graph && made.length && r() < 0.12) {
      return r() < 0.5 && path.length ? pick(path) : pick(made);
    }
    if (depth <= 0 || r() < 0.35) return prim();
    const n = r();
    let v: object;
    const kids = () => Math.floor(r() * 4);
    const next = (o: object) => node(depth - 1, [...path, o]);
    if (n < 0.3) {
      const o: Record<string, unknown> = {};
      v = o;
      made.push(o);
      for (let i = kids(); i > 0; i--) {
        const key = pick(KEYS);
        const roll = r();
        if (roll < 0.1) Object.defineProperty(o, key, { get: () => 7, enumerable: true, configurable: true });
        else if (roll < 0.17) Object.defineProperty(o, key, { value: next(o), enumerable: false, configurable: true, writable: true });
        else Object.defineProperty(o, key, { value: next(o), enumerable: true, configurable: true, writable: true });
      }
      if (r() < 0.1) (o as Record<symbol, unknown>)[Symbol('s')] = 1;
      if (r() < 0.07) o.toJSON = function (this: unknown, k: string) { return `toJSON:${k}`; } as never;
      if (r() < 0.05) Object.freeze(o);
    } else if (n < 0.55) {
      const a: unknown[] = [];
      v = a;
      made.push(a);
      const len = kids() + (r() < 0.2 ? 2 : 0);
      a.length = len;
      for (let i = 0; i < len; i++) if (r() < 0.85) a[i] = next(a);
      if (r() < 0.1) (a as unknown as Record<string, unknown>).extra = next(a);
    } else if (n < 0.62) {
      v = new Date(r() < 0.15 ? NaN : Math.floor(r() * 2e12));
    } else if (n < 0.68) {
      const m = new Map();
      v = m;
      made.push(m);
      for (let i = kids(); i > 0; i--) m.set(r() < 0.3 ? next(m) : pick(KEYS), next(m));
    } else if (n < 0.73) {
      const s = new Set();
      v = s;
      made.push(s);
      for (let i = kids(); i > 0; i--) s.add(next(s));
    } else if (n < 0.77) {
      v = Object(pick([pick(NUMBERS), pick(STRINGS), r() < 0.5, 3n]));
    } else if (n < 0.81) {
      const re = new RegExp(pick(['a+', 'к/о', '\\d', '']), pick(['', 'g', 'gi', 'y', 'su']));
      re.lastIndex = Math.floor(r() * 3);
      v = re;
    } else if (n < 0.86) {
      const C = pick([Error, TypeError, RangeError, SyntaxError, AggregateError, EvalError]);
      const e = C === AggregateError ? new AggregateError([], pick(STRINGS)) : new (C as ErrorConstructor)(pick(STRINGS), r() < 0.5 ? { cause: undefined } : undefined);
      v = e;
      made.push(e);
      if (r() < 0.5) Object.defineProperty(e, 'cause', { value: next(e), writable: true, configurable: true, enumerable: r() < 0.5 });
      if (r() < 0.2) e.name = pick(['Custom', 'TypeError', 'URIError']);
      if (r() < 0.2) (e as unknown as Record<string, unknown>).code = 'E1';
    } else if (n < 0.9) {
      const b = new ArrayBuffer(16, r() < 0.3 ? { maxByteLength: 32 } : undefined);
      new Uint8Array(b).forEach((_, i, arr) => (arr[i] = Math.floor(r() * 256)));
      made.push(b);
      v = pick([() => b, () => new Uint8Array(b, 2, 4), () => new Float32Array(b, 4, 2), () => new DataView(b, 1, 5), () => [new Uint8Array(b), new Int16Array(b, 8)]])();
    } else if (n < 0.94) {
      class Point {
        x = 1;
        get len() {
          return 1;
        }
      }
      const p = new Point() as Point & Record<string, unknown>;
      p.tag = next(p);
      v = p;
      made.push(p);
    } else if (opts.refusable && n < 0.97) {
      v = pick([() => new WeakMap(), () => new WeakSet(), () => Promise.resolve(), () => Object(Symbol('b'))])();
    } else {
      return prim();
    }
    return v;
  }

  return node(5, []);
}

/** Replacer и отступ для прогона: зависят от зерна, детерминированы. */
function stringifyArgs(seed: number): [unknown, unknown] {
  const r = rng(seed ^ 0x5bd1e995);
  const replacers: unknown[] = [
    undefined,
    null,
    function (this: Record<string, unknown>, key: string, value: unknown) {
      if (key === 'a') return undefined;
      if (typeof value === 'number') return value * 2;
      if (key === '1') return [value, this[key] === value];
      return value;
    },
    (key: string, value: unknown) => (typeof value === 'bigint' ? `${value}n` : value),
    ['a', 'c', 1, 'a', new String('0'), new Number(10), true, null, {}],
    [],
  ];
  const spaces: unknown[] = [undefined, 0, 2, 11, -3, 1.9, '\t', 'abcdefghijklmn', new Number(4), new String('·'), true, null];
  return [replacers[Math.floor(r() * replacers.length)], spaces[Math.floor(r() * spaces.length)]];
}

describe('случайные деревья: 400 зёрен', () => {
  it('stringify — байт в байт, с replacer и отступом', () => {
    let compared = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const opts = { graph: seed % 3 === 0, refusable: seed % 2 === 0 };
      const [replacer, space] = stringifyArgs(seed);
      const mine = outcome(() => impl.stringify(makeTree(seed, opts), replacer, space));
      const real = outcome(() => JSON.stringify(makeTree(seed, opts), replacer as never, space as never));
      expect(mine, `зерно ${seed}`).toEqual(real);
      if (typeof real === 'string' && !real.startsWith('throw')) compared += 1;
    }
    // Прогон не должен свестись к сравнению исключений.
    expect(compared).toBeGreaterThan(200);
  });

  it('clone — та же структура по shape', () => {
    let compared = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const opts = { graph: seed % 2 === 0, refusable: seed % 5 === 0 };
      const mine = outcome(() => shape(impl.clone(makeTree(seed, opts))));
      const real = outcome(() => shape(structuredClone(makeTree(seed, opts))));
      expect(mine, `зерно ${seed}`).toEqual(real);
      if (!real.startsWith('throw')) compared += 1;
    }
    expect(compared).toBeGreaterThan(300);
  });
});

// ─── Демо ────────────────────────────────────────────────────────────────────────────────

describe('демо: примеры и учебные функции', () => {
  const results = (id: string) => {
    const s = t.DEMO_SAMPLES.find((x) => x.id === id)!;
    return Object.fromEntries(runMethods(loadSample(s.code), impl).map((m) => [m.id, m]));
  };

  it('на каждом примере учебные функции совпадают с настоящими', () => {
    for (const s of t.DEMO_SAMPLES) {
      expect(nativeCheck('json', loadSample(s.code), impl), s.id).toBe('same');
      expect(nativeCheck('clone', loadSample(s.code), impl), s.id).toBe('same');
    }
  });

  it('заказ: JSON теряет дату, множество и promo; спред делит массив; clone — без потерь', () => {
    const r = results('order');
    expect(r.json.losses.join('\n')).toMatch(/createdAt.*было `Date`, стало строка/);
    expect(r.json.losses.join('\n')).toMatch(/tags.*было `Set`, стало объект/);
    expect(r.json.losses.join('\n')).toMatch(/promo.*ключ пропал/);
    expect(r.spread.losses.join('\n')).toMatch(/items.*общая ссылка/);
    expect(r.clone.losses).toEqual([]);
  });

  it('класс: все три теряют прототип', () => {
    const r = results('class');
    for (const m of ['spread', 'json', 'clone']) {
      expect(r[m].losses.join('\n')).toMatch(m === 'spread' ? /общая ссылка/ : /прототип `Money` потерян/);
    }
  });

  it('ссылки и цикл', () => {
    expect(results('graph').json.losses.join('\n')).toMatch(/стал отдельным/);
    expect(results('graph').clone.losses).toEqual([]);
    expect(results('cycle').json.error).toMatch(/^TypeError: Converting circular structure/);
    expect(results('cycle').clone.losses).toEqual([]);
    expect(results('cycle').clone.shown).toContain('[Circular *1]');
  });

  it('ошибка: clone даёт Error без status, JSON — только status', () => {
    const r = results('error');
    expect(r.clone.losses.join('\n')).toMatch(/прототип `HttpError` потерян/);
    expect(r.clone.losses.join('\n')).toMatch(/status.*пропал/);
    expect(r.json.shown).toBe('{ name: "HttpError", status: 502 }');
  });

  it('свойства: геттер, неперечисляемое, символ, заморозка', () => {
    const r = results('props');
    const all = r.clone.losses.join('\n');
    expect(all).toMatch(/label.*геттер стал обычным значением/);
    expect(all).toMatch(/secret.*неперечисляемое свойство пропало/);
    expect(all).toMatch(/Symbol\(version\).*ключ-символ пропал/);
    expect(all).toMatch(/заморозка/);
    expect(r.spread.losses.join('\n')).not.toMatch(/ключ-символ/);
  });

  it('отказ: JSON — TypeError, clone — DataCloneError', () => {
    const r = results('refuse');
    expect(r.json.error).toMatch(/^TypeError/);
    expect(r.clone.error).toMatch(/^DataCloneError/);
  });

  it('show печатает граф с метками', () => {
    const a = { x: 1 };
    expect(show({ a, b: a })).toBe('{ a: <ref *1> { x: 1 }, b: [Ref *1] }');
    expect(losses({ n: 1 }, { n: 1 })).toEqual([]);
  });
});
