import { execFileSync } from 'node:child_process';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/collections/data';
import { KEYS, runKey } from '@/widgets/collection-keys/model/run';
import { LIMIT, runIteration } from '@/widgets/map-iteration/model/run';

/**
 * Тема «Коллекции: Map, Set и словари» — запуском, а не по памяти.
 *
 * Каждый листинг темы — строка из `data.ts`, и здесь исполняется **она**. Строка вида
 * `выражение;   // вывод` на верхнем уровне листинга — это проба: выражение вычисляется
 * на своём месте (после всех строк выше), и его `util.inspect` обязан совпасть с комментарием.
 * Если выражение бросает, с комментарием сверяется `String(ошибки)`. Так комментарий-вывод
 * на странице не может разойтись с движком молча.
 */

const PROBE = /^(?!const |let |for |if |function |\}|\/\/|%)(.+?);\s+\/\/ (.+)$/;

interface Probe {
  expr: string;
  expected: string;
  got: string;
}

function probes(code: string): Probe[] {
  const found: Probe[] = [];
  const body = code
    .split('\n')
    .map((line) => {
      const m = PROBE.exec(line);
      if (!m) return line;
      const i = found.push({ expr: m[1], expected: m[2], got: '' }) - 1;
      return `__probe(${i}, () => (${m[1]}));`;
    })
    .join('\n');
  const record = (i: number, fn: () => unknown) => {
    try {
      found[i].got = inspect(fn());
    } catch (e) {
      found[i].got = String(e);
    }
  };
  new Function('__probe', body)(record);
  return found;
}

const LISTINGS = {
  OBJ_DICT_CODE: t.OBJ_DICT_CODE,
  NULL_PROTO_CODE: t.NULL_PROTO_CODE,
  MAP_CODE: t.MAP_CODE,
  SAMEVALUE_CODE: t.SAMEVALUE_CODE,
  UPSERT_CODE: t.UPSERT_CODE,
  MAP_CONVERT_CODE: t.MAP_CONVERT_CODE,
  SET_CODE: t.SET_CODE,
  SET_OPS_CODE: t.SET_OPS_CODE,
  SET_LIKE_CODE: t.SET_LIKE_CODE,
  ORDER_CODE: t.ORDER_CODE,
  WEAK_CODE: t.WEAK_CODE,
  WEAKSET_CODE: t.WEAKSET_CODE,
};

describe('листинги: каждый комментарий-вывод — ответ движка', () => {
  it.each(Object.entries(LISTINGS))('%s', (_name, code) => {
    const list = probes(code);
    expect(list.length, 'в листинге нет ни одной пробы — проверять нечего').toBeGreaterThan(0);
    for (const p of list) expect(p.got, p.expr).toBe(p.expected);
  });
});

describe('утверждения прозы', () => {
  it('«Объект как словарь»: два разных объекта попадают под один ключ', () => {
    const o: Record<string, string> = {};
    o[String({ a: 1 })] = 'первый';
    o[String({ b: 2 })] = 'второй';
    expect(Object.keys(o)).toEqual(['[object Object]']);
    expect(t.OBJ_DICT_NOTE).toContain('`"[object Object]"`');
  });

  it('цены словаря без прототипа', () => {
    const dict = Object.create(null) as Record<string, unknown>;
    expect(() => String(dict)).toThrow(TypeError);
    expect(() => `${dict as unknown as string}`).toThrow(TypeError);
    expect(dict.hasOwnProperty).toBeUndefined();
    expect(t.NULL_PROTO_COSTS[0].d).toContain('`TypeError`');
  });

  it('getOrInsert создаёт значение по умолчанию при каждом вызове, Computed — только для нового ключа', () => {
    const m = new Map<string, unknown[]>([['k', []]]);
    let made = 0;
    const fresh = () => {
      made += 1;
      return [];
    };
    m.getOrInsert('k', fresh());
    expect(made, 'аргумент вычислен, хотя ключ был').toBe(1);
    m.getOrInsertComputed('k', fresh);
    expect(made, 'функция не вызвана для существующего ключа').toBe(1);
    expect(t.UPSERT_NOTE).toContain('только для нового ключа');
  });

  it('«Изнутри»: V8 называет таблицы OrderedHashMap и OrderedHashSet', () => {
    // %DebugPrint — только под флагом, и только в отдельном процессе.
    const out = execFileSync(
      process.execPath,
      ['--allow-natives-syntax', '-e', '%DebugPrint(new Map([[1, 2]])); %DebugPrint(new Set([1]));'],
      { encoding: 'utf8' },
    );
    expect(out).toMatch(/table: .*<OrderedHashMap\[/);
    expect(out).toMatch(/table: .*<OrderedHashSet\[/);
    expect(t.DEBUG_PRINT_CODE).toContain('<OrderedHashMap[');
    expect(t.DEBUG_PRINT_CODE).toContain('<OrderedHashSet[');
  });

  it('«Слабые»: у WeakMap нет size, обхода и clear', () => {
    const w = new WeakMap() as unknown as Record<string, unknown>;
    expect(w.size).toBeUndefined();
    expect(w.clear).toBeUndefined();
    expect(w[Symbol.iterator as unknown as string]).toBeUndefined();
  });
});

describe('демо: один ключ — три хранилища', () => {
  const by = (value: string) => {
    const choice = KEYS.find((k) => k.value === value)!;
    const [object, nullProto, map] = runKey(choice);
    return { object, nullProto, map };
  };

  it('у каждого ключа есть пояснение, и наоборот', () => {
    expect(Object.keys(t.KEY_NOTES).sort()).toEqual(KEYS.map((k) => k.value).sort());
  });

  it('1: объект находит запись строкой, Map — нет', () => {
    const r = by('num');
    expect([r.object.found, r.nullProto.found, r.map.found]).toEqual([true, true, false]);
    expect(r.object.keys).toBe("[ '1' ]");
    expect(r.map.keys).toBe('[ 1 ]');
  });

  it('{ id: 7 }: объект склеивает разные объекты, Map — нет', () => {
    const r = by('obj');
    expect(r.object.keys).toBe("[ '[object Object]' ]");
    expect(r.object.found).toBe(true);
    expect(r.map.found).toBe(false);
    expect(r.map.alike).toBe('undefined');
    expect(t.KEY_NOTES.obj).toContain('`undefined`');
  });

  it("'toString': только обычный объект отвечает до записи", () => {
    const r = by('toString');
    expect([r.object.leaked, r.nullProto.leaked, r.map.leaked]).toEqual([true, false, false]);
    expect(r.object.before).toBe('[Function: toString]');
  });

  it("'__proto__': у обычного объекта значение теряется молча", () => {
    const r = by('proto');
    expect(r.object.keys).toBe('[]');
    expect(r.object.alike).toBe('Object.prototype');
    expect(r.object.found).toBe(false);
    expect(r.nullProto.found && r.map.found).toBe(true);
    expect(t.KEY_NOTES.proto).toContain('значение потерялось без ошибки');
  });

  it('NaN и -0: Map находит по SameValueZero, -0 хранится как 0', () => {
    expect(by('nan').map.found).toBe(true);
    expect(by('nan').object.keys).toBe("[ 'NaN' ]");
    const z = by('zero');
    expect([z.object.found, z.nullProto.found, z.map.found]).toEqual([true, true, true]);
    expect(z.map.keys).toBe('[ 0 ]');
    expect(z.object.keys).toBe("[ '0' ]");
  });
});

describe('демо: обход на ходу', () => {
  const run = (key: string) => {
    const s = t.ITER_SCENARIOS.find((x) => x.key === key)!;
    return { s, r: runIteration(s.code) };
  };

  it('удалённая впереди запись не приходит', () => {
    const { s, r } = run('delete-ahead');
    expect(r.visited).toEqual(['a', 'c']);
    expect(s.verdict).toContain('`b` не пришёл');
  });

  it('добавленная во время обхода запись приходит; у объекта — нет', () => {
    const { s, r } = run('add');
    expect(r.visited).toEqual(['a', 'b', 'c']);
    const o: Record<string, number> = { a: 1, b: 2 };
    const seen: string[] = [];
    for (const k of Object.keys(o)) {
      seen.push(k);
      if (k === 'a') o.c = 3;
    }
    expect(seen).toEqual(['a', 'b']);
    expect(s.verdict).toContain('`c` пришёл');
  });

  it('перезапись на месте: каждый ключ ровно раз', () => {
    const { r } = run('overwrite');
    expect(r.visited).toEqual(['a', 'b']);
    expect(r.after).toEqual(['a → 10', 'b → 20']);
  });

  it('удалить и вставить текущий — цикл не кончается', () => {
    const { s, r } = run('reinsert');
    expect(r.looped).toBe(true);
    expect(r.visited).toHaveLength(LIMIT);
    expect(s.verdict).toContain('двенадцати');
    expect(LIMIT).toBe(12);
  });

  it('clear и вставка: обход находит новую запись', () => {
    const { r } = run('clear');
    expect(r.visited).toEqual(['a', 'x']);
    expect(r.after).toEqual(['x → 1']);
  });

  it('ORDER_NOTE: удалить и вставить заново — в конец; на этом стоит LRU', () => {
    const m = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const touch = (k: string) => {
      const v = m.get(k)!;
      m.delete(k);
      m.set(k, v);
    };
    touch('a');
    expect(m.keys().next().value, 'самый старый — первым').toBe('b');
  });
});

describe('тонкие места: листинги делают то, что написано', () => {
  const pit = (n: string) => t.PITFALLS.find((p) => p.n === n)!.code!;

  it('01: квадратные скобки пишут свойство, а не запись', () => {
    for (const p of probes(pit('01'))) expect(p.got, p.expr).toBe(p.expected);
  });

  it('02: объект-ключ по ссылке', () => {
    for (const p of probes(pit('02'))) expect(p.got, p.expr).toBe(p.expected);
  });

  it('03: JSON и спред теряют записи', () => {
    const list = probes(pit('03'));
    expect(list).toHaveLength(2);
    for (const p of list) expect(p.got, p.expr).toBe(p.expected);
  });

  it('04: forEach отдаёт (value, key)', () => {
    const out: unknown[][] = [];
    new Map([['ключ', 'значение']]).forEach((a, b) => out.push([a, b]));
    expect(out).toEqual([['значение', 'ключ']]);
    expect(pit('04')).toContain('// значение ключ');
  });

  it('05: два одинаковых массива — два элемента', () => {
    for (const p of probes(pit('05'))) expect(p.got, p.expr).toBe(p.expected);
  });

  it('06: удалить и вставить текущий — бесконечно; обход копии — конечен', () => {
    const code = `const m = new Map([['a', 1], ['b', 2]]);\n${pit('06').replace('m.delete(k);', 'visit(k);\n  m.delete(k);')}`;
    expect(runIteration(code).looped).toBe(true);
    const copy = code.replace('of m)', 'of [...m])');
    expect(runIteration(copy).visited).toEqual(['a', 'b']);
    expect(t.PITFALLS.find((p) => p.n === '06')!.d).toContain('`for (const [k, v] of [...m])`');
  });

  it('07: fromEntries склеивает 1 и "1"', () => {
    expect(Object.fromEntries(new Map<unknown, string>([[1, 'a'], ['1', 'b']]))).toEqual({ 1: 'b' });
    expect(pit('07')).toContain("// { '1': 'b' }");
  });

  it('08: union с массивом — TypeError', () => {
    expect(() => new Set([1]).union([2] as unknown as ReadonlySetLike<number>)).toThrow(TypeError);
  });

  it('09: WeakMap со строкой — TypeError', () => {
    expect(() => new WeakMap().set('user:1' as unknown as object, {})).toThrow(TypeError);
  });
});

/** Переехало из «Объектной модели» 2026-10-03 вместе с `GROUPBY_*`. */
function исполнить<T>(code: string, names: string[]): T {
  return new Function('"use strict";' + code + `\n; return { ${names.join(', ')} };`)() as T;
}

describe('Object.groupBy: словарь без прототипа', () => {
  const { byType, odd, orders, anna } = исполнить<{
    byType: Record<string, { name: string }[]>;
    odd: Record<string, unknown>;
    orders: Map<object, unknown[]>;
    anna: object;
  }>(t.GROUPBY_CODE, ['byType', 'odd', 'orders', 'anna']);

  it('группы собраны, и у результата нет прототипа', () => {
    expect(Object.keys(byType)).toEqual(['фрукт', 'овощ']);
    expect(byType.фрукт.map((g) => g.name)).toEqual(['яблоко', 'груша']);
    expect(Object.getPrototypeOf(byType)).toBeNull();
    expect('toString' in byType).toBe(false);
  });

  it('`__proto__` и `constructor` из данных — обычные ключи, Object.prototype не задет', () => {
    expect(Object.keys(odd)).toEqual(['__proto__', 'constructor']);
    expect(Array.isArray(odd.__proto__)).toBe(true);
    expect(Object.getPrototypeOf(odd)).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'a')).toBe(false);
  });

  it('Map.groupBy держит объект ключом', () => {
    expect(orders.get(anna)).toHaveLength(2);
  });

  it('карточки: ключ становится строкой, порядок — по правилу ключей, Map различает 1 и "1"', () => {
    expect(t.GROUPBY_FACTS[0].d).toContain('одну** группу');
    const o = Object.groupBy([1, '1', 1], (x) => x);
    expect(Object.keys(o)).toEqual(['1']);
    expect(o['1']).toHaveLength(3);
    const m = Map.groupBy([1, '1', 1], (x) => x);
    expect([...m.keys()]).toEqual([1, '1']);
    // строковая группа объявлена первой, а числовые всё равно впереди
    expect(Object.keys(Object.groupBy(['ccc', 'a', 'bb'], (s) => (s.length > 2 ? 'long' : s.length)))).toEqual(['1', '2', 'long']);
  });

  it('карточки: цены словаря без прототипа и «не метод массива»', () => {
    expect(() => `${byType as unknown as string}`).toThrow(TypeError);
    expect((byType as { hasOwnProperty?: unknown }).hasOwnProperty).toBeUndefined();
    expect(Object.hasOwn(byType, 'фрукт')).toBe(true);
    expect(([] as unknown as { groupBy?: unknown }).groupBy).toBeUndefined();
    expect(Object.keys(Object.groupBy(new Set([1, 2, 3]), (n) => (n % 2 ? 'нечёт' : 'чёт')))).toEqual(['нечёт', 'чёт']);
    expect(Object.groupBy('abc', (_c, i) => i)).toEqual(Object.assign(Object.create(null), { 0: ['a'], 1: ['b'], 2: ['c'] }));
    expect(Object.getPrototypeOf(byType.фрукт)).toBe(Array.prototype);
  });
});
