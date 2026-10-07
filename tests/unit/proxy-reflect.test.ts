import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import * as vue from '@vue/reactivity';
import { current, produce } from 'immer';
import { describe, expect, it } from 'vitest';
import {
  CLONE_CODE,
  CLONE_PROBES,
  CLONE_SETUP,
  IDENTITY_CODE,
  IDENTITY_PROBES,
  IDENTITY_SETUP,
  IMMER_CODE,
  INVARIANT_ROWS,
  LAB_SNIPPETS,
  MEMBRANE_CODE,
  MEMBRANE_FACTS,
  PITFALLS,
  PREREQ,
  PRIVATE_CODE,
  PRIVATE_PROBES,
  PRIVATE_SETUP,
  PROXY_OPS,
  PROXY_TARGET,
  REACTIVE_CODE,
  REACTIVE_SCENARIOS,
  RECEIVER_CODE,
  RECEIVER_LINE,
  RECEIVER_LOST,
  RELATED,
  SET_BOOL_CODE,
  TRACE_CODE,
  TRAP_ROWS,
  type Probe,
} from '@/content/lessons/proxy-reflect/data';
// Те же модули, что исполняют демо у читателя.
import { formatValue, loadTrace, runOp } from '@/widgets/proxy-traps/model/run';
import { journal, loadMini, outputOf, replaceOnce } from '@/widgets/proxy-reactivity/model/run';
import type { ReactiveApi } from '@/widgets/proxy-reactivity/model/types';

/**
 * Утверждения темы «Proxy и Reflect» — запуском, а не по памяти. Node 24.11.0 (V8 13.6),
 * `@vue/reactivity` 3.5.42, `immer` 11.1.18.
 *
 * Половина блоков переехала сюда из `tests/unit/object-model.test.ts` вместе с материалом
 * раздела «Proxy и Reflect» (2026-10-02): «сколько ловушек и почему они не врут», «инварианты
 * по каждой ловушке», «мембрана» и листинг песочницы «потерянный receiver». Они перенесены
 * без ослабления; новые блоки — ниже, у каждого сказано, что он сторожит.
 *
 * Везде исполняется **строка со страницы** (`*_CODE`, `ops`, `code` из `data.ts`), а не копия.
 */

/** Выполнить пример со страницы в строгом режиме и вернуть названные привязки. */
function исполнить<T>(code: string, names: string[]): T {
  // перевод строки обязателен: пример кончается комментарием, и `return` иначе уйдёт в него
  return new Function('"use strict";' + code + `\n; return { ${names.join(', ')} };`)() as T;
}

/** Строки «выражение → ответ» после подготовки: ответ — `formatValue` или имя ошибки. */
function ответы(setup: string, probes: Probe[]): string[] {
  const run = new Function(
    '__exprs',
    `"use strict";\n${setup}\nreturn __exprs.map((e) => { try { return { v: eval(e) }; } catch (err) { return { e: err.name }; } });`,
  ) as (exprs: string[]) => { v?: unknown; e?: string }[];
  return run(probes.map((p) => p.expr)).map((r) => (r.e ? r.e : formatValue(r.v, {})));
}

describe('handler темы: тринадцать ловушек — тринадцать функций Reflect', () => {
  const ЛОВУШКИ = [
    'apply', 'construct', 'defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor',
    'getPrototypeOf', 'has', 'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf',
  ];

  it('у Reflect ровно тринадцать функций, и их имена — имена ловушек', () => {
    expect(Object.getOwnPropertyNames(Reflect).sort()).toEqual(ЛОВУШКИ);
    expect(TRAP_ROWS.map((r) => r.trap).sort()).toEqual(ЛОВУШКИ);
  });

  it('пример из листинга: p.name — Аня, в журнале одна ловушка get', () => {
    const { p, log } = исполнить<{ p: { name: string }; log: string[] }>(TRACE_CODE, ['p', 'log']);
    expect(TRACE_CODE).toContain("p.name;    // 'Аня'");
    expect(log, 'листинг прочитал p.name один раз').toEqual(['get']);
    expect(p.name).toBe('Аня');
  });
});

describe('тринадцать ловушек: каждая операция таблицы приходит в свою ловушку', () => {
  const trace = loadTrace(TRACE_CODE);
  for (const row of TRAP_ROWS) {
    for (const op of row.ops) {
      it(`${row.trap} ← ${op}`, () => {
        const target = row.fn ? function () {} : { x: 1 };
        const { p, log } = trace(target);
        try {
          new Function('p', `"use strict";\n${op};`)(p);
        } catch {
          // некоторые операции (setPrototypeOf(null) у функции) законно бросают — важен журнал
        }
        expect(log, `журнал: ${log.join(', ')}`).toContain(row.trap);
      });
    }
  }

  it('у Object.hasOwn нет has, а p.x++ — это get и set', () => {
    const t1 = trace({ x: 1 });
    Object.hasOwn(t1.p, 'x');
    expect(t1.log).toEqual(['getOwnPropertyDescriptor']);
    const t2 = trace({ x: 1 });
    (t2.p as { x: number }).x++;
    expect(t2.log.slice(0, 2)).toEqual(['get', 'set']);
  });

  it('construct: после ловушки — get за prototype у самого прокси', () => {
    const { p, log } = trace(function () {});
    new (p as unknown as new () => object)();
    expect(log).toEqual(['construct', 'get']);
  });

  it('запись в наследника прокси — одна ловушка set, без возврата в прокси', () => {
    const { p, log } = trace({ x: 1 });
    (Object.create(p) as { y: number }).y = 1;
    expect(log).toEqual(['set']);
  });
});

describe('пульт ловушек: демо считает то же, что написано в литерале', () => {
  const trace = loadTrace(TRACE_CODE);
  it.each(PROXY_OPS.map((op) => [op.op, op] as const))('%s', (_имя, op) => {
    const run = runOp(trace, op, PROXY_TARGET);
    expect(run.calls.map((c) => [c.name, c.times ?? 1])).toEqual(op.traps.map((t) => [t.name, t.times ?? 1]));
    expect(run.res).toBe(op.res);
  });

  it('операций пятнадцать, и у пяти последних — ноль ловушек или бросок', () => {
    expect(PROXY_OPS).toHaveLength(15);
    const tail = PROXY_OPS.slice(-5).map((op) => runOp(trace, op, PROXY_TARGET));
    expect(tail.map((r) => r.total)).toEqual([0, 0, 0, 1, 1]);
    expect(tail.slice(2).every((r) => r.threw)).toBe(true);
  });
});

/** Перенесено из `object-model.test.ts` («раздел 9: прокси — сколько ловушек и почему они не врут»). */
describe('раздел 9: прокси — сколько ловушек и почему они не врут', () => {
  /** Считает обращения к handler'у: каждое имя ловушки попадает в журнал. */
  function трасса(операция: (p: Record<string, unknown>) => void) {
    const журнал: string[] = [];
    const target: Record<string, unknown> = { name: 'Аня', age: 29 };
    const handler = new Proxy(
      {},
      {
        get:
          (_, trap: string) =>
          (...args: unknown[]) => {
            журнал.push(trap);
            return (Reflect as unknown as Record<string, (...a: unknown[]) => unknown>)[trap](...args);
          },
      },
    );
    операция(new Proxy(target, handler) as Record<string, unknown>);
    return журнал;
  }

  /**
   * ⚠️ На странице числа названы в ВИДАХ ловушек, а не в обращениях: `Object.keys` — «две
   * ловушки», потому что `getOwnPropertyDescriptor` вызывается на каждый ключ (`times: 2`).
   * Тест сверяет и то и другое, чтобы расхождение было видно с любой стороны.
   */
  it.each([
    ['Object.keys', (p: Record<string, unknown>) => Object.keys(p), ['ownKeys', 'getOwnPropertyDescriptor'], 3],
    // На странице этот случай назван тремя ловушками: set, потом проверка и запись на target.
    ['присваивание', (p: Record<string, unknown>) => void (p.age = 30), ['set', 'getOwnPropertyDescriptor', 'defineProperty'], 3],
    ['JSON.stringify', (p: Record<string, unknown>) => JSON.stringify(p), ['get', 'ownKeys', 'getOwnPropertyDescriptor'], 6],
    ['for…in', (p: Record<string, unknown>) => { for (const k in p) void k; }, ['ownKeys', 'getPrototypeOf', 'getOwnPropertyDescriptor'], 4],
    ['Object.freeze', (p: Record<string, unknown>) => void Object.freeze(p), ['preventExtensions', 'ownKeys', 'getOwnPropertyDescriptor', 'defineProperty'], 6],
  ])('%s: виды ловушек и число обращений', (_имя, операция, виды, обращений) => {
    const журнал = трасса(операция as (p: Record<string, unknown>) => void);
    expect([...new Set(журнал)].sort()).toEqual([...(виды as string[])].sort());
    expect(журнал.length).toBe(обращений);
  });

  it.each([
    ['get врёт про неизменяемое свойство', () => (new Proxy(Object.freeze({ x: 1 }), { get: () => 2 }) as { x: number }).x],
    ['ownKeys прячет неудаляемый ключ', () => Object.keys(new Proxy(Object.freeze({ x: 1 }), { ownKeys: () => [] }))],
    ['has прячет свойство нерасширяемого', () => 'x' in new Proxy(Object.preventExtensions({ x: 1 }), { has: () => false })],
    // ⚠️ Здесь была опечатка: `void (…).x` — это ЧТЕНИЕ. Читать через врущую ловушку `set`
    // можно сколько угодно, инвариант проверяется на записи, и тест молча проходил мимо.
    ['set вернул falsish в строгом режиме', () => void ((new Proxy({}, { set: () => false }) as Record<string, unknown>).x = 1)],
  ])('инвариант: %s → TypeError', (_имя, врущая) => {
    expect(врущая).toThrow(TypeError);
  });
});

describe('receiver и ответ set — листинги со страницы', () => {
  it('RECEIVER_CODE: без receiver наследник читает чужое имя, с ним — своё', () => {
    const { a, b } = исполнить<{ a: { label: string }; b: { label: string } }>(RECEIVER_CODE, ['a', 'b']);
    expect(a.label).toBe('я Аня');
    expect(b.label).toBe('я Оля');
    expect(RECEIVER_CODE).toContain("a.label;   // 'я Аня'");
    expect(RECEIVER_CODE).toContain("b.label;   // 'я Оля'");
  });

  it('SET_BOOL_CODE: в строгом режиме TypeError с тем текстом, что в комментарии', () => {
    const code = SET_BOOL_CODE.split('\n').filter((l) => !l.startsWith('//')).join('\n');
    expect(() => new Function(code)()).toThrow(TypeError);
    expect(() => new Function(code)()).toThrow("'set' on proxy: trap returned falsish for property 'x'");
    // а в нестрогом — молча, и Reflect.set отдаёт false
    expect(() => new Function(code.replace("'use strict';", ''))()).not.toThrow();
    expect(Reflect.set(new Proxy({}, { set: () => undefined as unknown as boolean }), 'x', 1)).toBe(false);
  });
});

/** Перенесено из `object-model.test.ts` без изменений. */
describe('инварианты по каждой ловушке', () => {
  const собрать = (target: string, row: { handler: string; op: string }) => () =>
    new Function(`"use strict"; const p = new Proxy(${target}, ${row.handler}); return (${row.op});`)();

  it('двенадцать ловушек из тринадцати в таблице — все, кроме apply', () => {
    const traps = new Set(INVARIANT_ROWS.map((r) => r.trap));
    expect([...traps].sort()).toEqual(
      ['construct', 'defineProperty', 'deleteProperty', 'get', 'getOwnPropertyDescriptor', 'getPrototypeOf', 'has',
        'isExtensible', 'ownKeys', 'preventExtensions', 'set', 'setPrototypeOf'],
    );
    expect(new Proxy(function () {}, { apply: () => 'что угодно' })(), 'у apply инвариантов нет').toBe('что угодно');
  });

  it.each(INVARIANT_ROWS.map((r) => [`${r.trap}: ${r.rule}`, r] as const))('%s', (_имя, row) => {
    expect(собрать(row.target, row), 'нарушение обязано дать TypeError').toThrow(TypeError);
    if (row.control) expect(собрать(row.control, row), 'тот же handler над открытым target проходит').not.toThrow();
  });

  it('инвариантов двадцать', () => {
    expect(INVARIANT_ROWS).toHaveLength(20);
  });
});

describe('личность и слоты: каждая строка консоли — ответ движка', () => {
  it.each([
    ['личность', IDENTITY_SETUP, IDENTITY_PROBES, IDENTITY_CODE],
    ['#-поля', PRIVATE_SETUP, PRIVATE_PROBES, PRIVATE_CODE],
    ['клонирование', CLONE_SETUP, CLONE_PROBES, CLONE_CODE],
  ] as const)('%s', (_имя, setup, probes, listing) => {
    expect(ответы(setup, probes as unknown as Probe[])).toEqual(probes.map((p) => p.out));
    for (const p of probes) expect(listing).toContain(`${p.expr}`);
  });

  it('#-поле: текст ошибки — тот, что процитирован', () => {
    class Counter {
      #n = 0;
      inc() {
        return ++this.#n;
      }
    }
    const p = new Proxy(new Counter(), {});
    expect(() => p.inc()).toThrow('Cannot read private member #n from an object whose class did not declare it');
  });

  it('#-поле может жить на самом прокси: базовый конструктор вернул прокси', () => {
    class Base {
      constructor() {
        return new Proxy(this, {});
      }
    }
    class Child extends Base {
      #x = 1;
      getX() {
        return this.#x;
      }
      static owns(o: object) {
        return #x in o;
      }
    }
    const c = new Child();
    expect(c.getX()).toBe(1);
    expect(Child.owns(c)).toBe(true);
  });

  it('клонирование отвергает прокси без единой ловушки; postMessage — тем же алгоритмом', () => {
    const { p, log } = loadTrace(TRACE_CODE)({ n: 1 });
    expect(() => structuredClone(p)).toThrow(expect.objectContaining({ name: 'DataCloneError', code: 25 }));
    expect(log).toEqual([]);
    const { port1, port2 } = new MessageChannel();
    try {
      expect(() => port1.postMessage(p)).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    } finally {
      port1.close();
      port2.close();
    }
  });

  it('отозванный прокси: Array.isArray бросает — IsArray смотрит сквозь прокси', () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    expect(Array.isArray(proxy)).toBe(true);
    revoke();
    expect(() => Array.isArray(proxy)).toThrow(TypeError);
  });
});

/**
 * Песочница: четыре листинга. «Потерянный receiver» перенесён из песочницы «Объектной
 * модели» вместе с проверкой.
 */
describe('песочница: листинги делают то, что обещано', () => {
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

  it('«потерянный receiver»: наследник получает чужое значение', () => {
    const вывод = прогнать(листинг('потерянный receiver')).join('\n');
    expect(вывод).toContain('Аня');
    expect(вывод).not.toContain('Оля');
    // и обещанная починка: допишите receiver — придёт «я Оля»
    const починено = прогнать(листинг('потерянный receiver').replace('Reflect.get(t, key)', 'Reflect.get(t, key, receiver)'));
    expect(починено.join('\n')).toContain('я Оля');
  });

  it('«#-поле сквозь прокси»: TypeError, а с bind в ловушке — проходит', () => {
    expect(прогнать(листинг('#-поле сквозь прокси')).join('\n')).toContain('TypeError');
    const починено = листинг('#-поле сквозь прокси').replace(
      'new Proxy(new Counter(), {})',
      "new Proxy(new Counter(), { get(t, k) { const v = Reflect.get(t, k); return typeof v === 'function' ? v.bind(t) : v; } })",
    );
    expect(прогнать(починено).join('\n')).toContain('p.inc() → 1');
  });

  it('«клон прокси»: отказ у прокси, копия у спреда, отказ у вложенного', () => {
    const строки = прогнать(листинг('клон прокси'));
    expect(строки[0]).toBe('прокси → DataCloneError');
    expect(строки[1]).toBe('копия → {"n":1,"list":[1,2]}');
    expect(() => прогнать(листинг('клон прокси').replace('{ ...state }', '{ inner: state }'))).toThrow();
  });

  it('«что видит прокси»: isArray сквозь, === и Set различают; над функцией typeof — function', () => {
    const вывод = прогнать(листинг('что видит прокси')).map((s) => s.replace(/\s+/g, ' '));
    expect(вывод).toEqual([
      'p === target → false',
      'Array.isArray(p) → true',
      'new Set([target]).has(p) → false',
      'typeof p → object',
    ]);
    const сфункцией = прогнать(листинг('что видит прокси').replace('[1, 2]', 'function () {}'));
    expect(сфункцией[3].replace(/\s+/g, ' ')).toBe('typeof p → function');
  });
});

describe('реактивность: мини-версия против @vue/reactivity 3.5.42', () => {
  const mini = () => loadMini(REACTIVE_CODE);
  const lost = () => loadMini(replaceOnce(REACTIVE_CODE, RECEIVER_LINE, RECEIVER_LOST));
  const vueApi = vue as unknown as ReactiveApi;

  it.each(REACTIVE_SCENARIOS.map((s) => [s.label, s] as const))('%s', (_имя, s) => {
    expect(outputOf(mini(), s.code), 'мини-версия — как в литерале').toEqual(s.out);
    expect(outputOf(vueApi, s.code), 'Vue — как мини-версия').toEqual(s.out);
    expect(outputOf(lost(), s.code), 'без receiver — как в литерале').toEqual(s.lost);
  });

  it('потеря receiver ломает ровно два сценария: геттер и #-поле', () => {
    const broken = REACTIVE_SCENARIOS.filter((s) => s.out.join() !== s.lost.join()).map((s) => s.id);
    expect(broken).toEqual(['getter', 'private']);
  });

  it('подмена ищет строку и падает, если её нет', () => {
    expect(() => replaceOnce(REACTIVE_CODE, 'нет такой строки', 'x')).toThrow('подменять нечего');
  });

  it('журнал: Object.keys пишет зависимость на ITERATE, новый ключ — trigger add', () => {
    const keys = REACTIVE_SCENARIOS.find((s) => s.id === 'keys')!;
    const lines = journal(REACTIVE_CODE, keys.code).map((l) => l.text);
    expect(lines).toContain('track Symbol(перебор)');
    expect(lines).toContain('trigger b · add');
    expect(lines).toContain('trigger a · set');
  });

  it('одна обёртка на объект — и у Vue тоже', () => {
    const raw = { user: {} };
    const a = mini().reactive(raw);
    expect(a.user).toBe(a.user);
    const v = vue.reactive(raw);
    expect(v.user).toBe(v.user);
    expect(vue.reactive(raw)).toBe(v);
  });

  it('Vue тоже не находит сырой объект в Set по прокси и наоборот', () => {
    const raw = {};
    expect(new Set([raw]).has(vue.reactive(raw))).toBe(false);
    expect(vue.toRaw(vue.reactive(raw))).toBe(raw);
    expect(() => structuredClone(vue.reactive({ n: 1 }))).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(structuredClone(vue.toRaw(vue.reactive({ n: 1 })))).toEqual({ n: 1 });
  });
});

describe('Immer: черновик-прокси', () => {
  it('пример со страницы: исходник цел, нетронутое общее, утёкший черновик отозван', () => {
    const run = new Function('produce', `"use strict";${IMMER_CODE}\n; return { base, next, leaked };`) as (
      p: typeof produce,
    ) => { base: { user: { name: string }; tags: string[] }; next: { user: { name: string }; tags: string[] }; leaked: { name: string } };
    const { base, next, leaked } = run(produce);
    expect(base.user.name).toBe('Аня');
    expect(next.user.name).toBe('Оля');
    expect(next.tags).toBe(base.tags);
    expect(() => leaked.name).toThrow("Cannot perform 'get' on a proxy that has been revoked");
  });

  it('черновик не клонируется, current(draft) — клонируется', () => {
    let fail = '';
    let copy: unknown;
    produce({ n: 1 }, (d) => {
      try {
        structuredClone(d);
      } catch (e) {
        fail = (e as Error).name;
      }
      copy = structuredClone(current(d));
    });
    expect(fail).toBe('DataCloneError');
    expect(copy).toEqual({ n: 1 });
  });
});

/** Перенесено из `object-model.test.ts` без изменений. */
describe('мембрана: один рубильник на весь граф', () => {
  type M = { proxy: { user: { name: string; greet(): string } }; revoke(): void };
  function собрать() {
    return исполнить<{ membrane(o: object): M; api: { user: { name: string } }; m: M; user: { name: string; greet(): string } }>(
      MEMBRANE_CODE,
      ['membrane', 'api', 'm', 'user'],
    );
  }

  it('пример: после revoke вложенная обёртка тоже отозвана, оригинал цел', () => {
    const { user, api } = собрать();
    expect(() => user.name).toThrow("Cannot perform 'get' on a proxy that has been revoked");
    expect(api.user.name).toBe('Аня');
  });

  it('до отзыва: вызов работает, одна обёртка на объект, наружу не уходит оригинал', () => {
    const { membrane, api } = собрать();
    const m = membrane(api);
    const u = m.proxy.user;
    expect(u.greet()).toBe('я Аня');
    expect(m.proxy.user).toBe(u);
    expect(u).not.toBe(api.user);
    const greet = u.greet;
    m.revoke();
    expect(() => greet.call(u), 'функция, прочитанная до отзыва, тоже отозвана').toThrow(TypeError);
  });

  it('отозванный прокси отказывает во всём, кроме === и typeof; повторный revoke безвреден', () => {
    const { proxy, revoke } = Proxy.revocable([] as unknown[], {});
    revoke();
    revoke();
    for (const op of [
      () => (proxy as unknown as { x: unknown }).x,
      () => 'x' in proxy,
      () => Object.keys(proxy),
      () => Array.isArray(proxy),
      () => Object.prototype.toString.call(proxy),
      () => (Object.create(proxy) as { y: unknown }).y,
    ]) expect(op).toThrow(TypeError);
    expect(typeof proxy).toBe('object');
    expect(proxy === proxy).toBe(true);
    expect(MEMBRANE_FACTS[0].d).toContain('`Array.isArray`');
  });

  it('наивная мембрана над замороженным объектом падает на инварианте get', () => {
    const { membrane } = собрать();
    expect(() => membrane(Object.freeze({ inner: {} })).proxy.user).not.toThrow();
    expect(() => (membrane(Object.freeze({ inner: {} })).proxy as unknown as { inner: unknown }).inner).toThrow(TypeError);
  });
});

describe('тонкие места: листинги делают то, что написано в комментариях', () => {
  const pitfall = (n: string) => PITFALLS.find((p) => p.n === n)!.code!;
  /** Выполнить листинг, вернув значение выражения последней строки без комментария. */
  const последнее = (code: string) => {
    const lines = code.split('\n');
    const last = lines.pop()!.replace(/\/\/.*$/, '').trim().replace(/;$/, '');
    return new Function(`${lines.join('\n')}\nreturn (${last});`)();
  };

  it('01: Set с сырым объектом не находит прокси', () => {
    expect(последнее(pitfall('01'))).toBe(false);
  });

  it('02: запись прошла, а ловушка без return — TypeError', () => {
    expect(() => new Function(pitfall('02'))()).toThrow(TypeError);
  });

  it('03: ownKeys без дескрипторов — Reflect.ownKeys видит, Object.keys нет', () => {
    const p = new Function(`${pitfall('03').split('\n').slice(0, 3).join('\n')}\nreturn p;`)() as object;
    expect(Reflect.ownKeys(p)).toEqual(['a', 'b']);
    expect(Object.keys(p)).toEqual([]);
  });

  it('04: метод Map через прокси — TypeError про incompatible receiver', () => {
    const code = pitfall('04').split('\n').filter((l) => !l.startsWith('//')).join('\n');
    expect(() => new Function(code)()).toThrow('Method Map.prototype.get called on incompatible receiver');
  });

  it('05: консоль Node показывает цель, JSON — ответ ловушки', () => {
    const p = new Function(`${pitfall('05').split('\n')[0]}\nreturn p;`)() as object;
    expect(inspect(p)).toBe('{ a: 1 }');
    expect(JSON.stringify(p)).toBe('{"a":42}');
  });
});

/** Ссылки вида `/js/<тема>/#sN` из данных темы ведут в раздел, который есть в nav цели. */
describe('ссылки на другие темы ведут в существующие разделы', () => {
  const COLLECTION: Record<string, string> = {
    js: 'lessons', render: 'render', frameworks: 'frameworks', platform: 'platform', tooling: 'tooling',
    delivery: 'delivery', algorithms: 'algorithms', data: 'data', patterns: 'patterns',
  };
  const text = [RELATED, ...PREREQ.map((p) => `${p.d} (${p.href})`)].join('\n') + readFileSync(new URL('../../src/content/lessons/proxy-reflect/data.ts', import.meta.url), 'utf8');
  const links = [...new Set([...text.matchAll(/\/(js|render|frameworks|platform|tooling|delivery|algorithms|data|patterns)\/([a-z0-9-]+)\/(#s\d+)?/g)].map((m) => m[0]))];

  it.each(links)('%s', (link) => {
    const [, dir, slug, anchor] = /\/([a-z]+)\/([a-z0-9-]+)\/(#s\d+)?/.exec(link)!;
    const mdx = readFileSync(new URL(`../../src/content/${COLLECTION[dir]}/${slug}/index.mdx`, import.meta.url), 'utf8');
    if (anchor) expect(mdx, `${link}: нет пункта ${anchor} в nav`).toMatch(new RegExp(`id: ${anchor.slice(1)},`));
  });
});
