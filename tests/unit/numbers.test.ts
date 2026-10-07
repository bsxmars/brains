import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/numbers/data';
import { bitString, fieldsFromBits, fieldsFromHex, loadDouble } from '@/widgets/double-lab/model/run';

/**
 * Тема «Числа в JS: IEEE 754, Smi и BigInt».
 *
 * `DOUBLE_CODE` — строка из темы: напечатана на странице и исполняется демо `double-lab`.
 * Здесь она сверяется с движком: разбор и сборка — с `Float64Array` на 300 000 случайных
 * битовых наборов (все виды: обычные, субнормальные, нули, бесконечности, NaN), точное
 * десятичное значение — с `toFixed`, `BigInt` и обратным разбором `Number(…)`.
 *
 * Все таблицы «выражение → результат» исполняются здесь же: выражение из `data.ts`, результат
 * печатается одним правилом (`show`) и сравнивается с колонкой `out`. Сменится поведение
 * движка — покраснеет здесь, а не останется неправдой на странице.
 *
 * Smi и байты на элемент — в отдельном процессе Node: `%IsSmi` требует
 * `--allow-natives-syntax`, а `gc()` — `--expose-gc`, и ни того ни другого в процессе vitest нет.
 * Колонка «Chromium» этих таблиц не пересобирается: нужен браузер с флагами движка (см. шапку
 * `data.ts`).
 */

const api = loadDouble(t.DOUBLE_CODE);

/** Печать результата так, как он стоит в колонке `out`. */
function show(v: unknown): string {
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (Object.is(v, -0)) return '-0';
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
  return String(v);
}

/** Учебные функции темы — в области видимости каждого выражения таблиц. */
const SCOPE = [t.CLOSE_CODE, t.TOINT32_CODE, t.HASH_CODE, t.MONEY_CODE].join('\n');

function run(code: string): string {
  try {
    return show(new Function(`${SCOPE}\nreturn (${code});`)());
  } catch (e) {
    return (e as Error).name;
  }
}

/** Биты числа движком, мимо учебного кода. */
function hexOf(x: number): string {
  const f = new Float64Array([x]);
  return new BigUint64Array(f.buffer)[0].toString(16).padStart(16, '0');
}

const evaluate = (expr: string) => new Function(`return (${expr});`)() as number;

/** Детерминированный генератор 64-битных наборов: прогон воспроизводим. */
function* randomBits(n: number, seed = 12345n): Generator<bigint> {
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    yield s;
  }
}

describe('DOUBLE_CODE против движка', () => {
  it('decodeDouble и encodeDouble совпадают с Float64Array на 300 000 наборов', () => {
    const buf = new BigUint64Array(1);
    const f64 = new Float64Array(buf.buffer);
    let checked = 0;
    for (const bits of randomBits(300_000)) {
      buf[0] = bits;
      const x = f64[0];
      const f = api.decodeDouble(x);
      if (!Number.isNaN(x)) {
        // У NaN движок вправе сменить биты мантиссы при чтении: сверяем поля только у чисел.
        expect(BigInt(f.sign)).toBe(bits >> 63n);
        expect(BigInt(f.exponent)).toBe((bits >> 52n) & 0x7ffn);
        expect(f.mantissa).toBe(bits & 0xfffffffffffffn);
      }
      expect(Object.is(api.encodeDouble(f), x)).toBe(true);
      checked++;
    }
    expect(checked).toBe(300_000);
    // Один прогон — около секунды, но в полном `npm test` рядом идут тяжёлые наборы,
    // и замер был 7,4 с: стандартные 5 с здесь — лимит не на логику, а на соседей.
  }, 60_000);

  it('exactDecimal — точное значение: обратный разбор даёт тот же double', () => {
    const buf = new BigUint64Array(1);
    const f64 = new Float64Array(buf.buffer);
    for (const bits of randomBits(20_000, 777n)) {
      buf[0] = bits;
      const x = f64[0];
      if (Number.isNaN(x)) continue;
      expect(Object.is(Number(api.exactDecimal(x)), x)).toBe(true);
    }
  });

  it('exactDecimal совпадает с toFixed (точное по стандарту) и с BigInt для целых', () => {
    let fixed = 0;
    let ints = 0;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 100_000; i++) {
      const x = (rnd() - 0.5) * 10 ** (Math.floor(rnd() * 30) - 8);
      const s = api.exactDecimal(x);
      const frac = (s.split('.')[1] ?? '').length;
      if (Math.abs(x) < 1e21 && frac <= 100) {
        expect(x.toFixed(frac), String(x)).toBe(s);
        fixed++;
      }
      if (Number.isInteger(x)) {
        expect(BigInt(x).toString()).toBe(s);
        ints++;
      }
    }
    expect(fixed).toBeGreaterThan(90_000);
    expect(ints).toBeGreaterThan(1_000);
    // Особые значения.
    expect(api.exactDecimal(-0)).toBe('-0');
    expect(api.exactDecimal(NaN)).toBe('NaN');
    expect(api.exactDecimal(-Infinity)).toBe('-Infinity');
    expect(api.exactDecimal(Number.MAX_VALUE)).toBe(BigInt(Number.MAX_VALUE).toString());
  });

  it('nextAway — следующий набор битов, и сосед действительно ближайший', () => {
    const buf = new BigUint64Array(1);
    const f64 = new Float64Array(buf.buffer);
    for (const bits of randomBits(20_000, 99n)) {
      buf[0] = bits;
      const x = f64[0];
      if (!Number.isFinite(x)) continue;
      const next = api.nextAway(x);
      const want = new Float64Array(new BigUint64Array([bits + 1n]).buffer)[0];
      expect(Object.is(next, want)).toBe(true);
    }
    expect(api.nextAway(1) - 1).toBe(Number.EPSILON);
    expect(api.nextAway(Number.MAX_VALUE)).toBe(Infinity);
    expect(api.nextAway(0)).toBe(Number.MIN_VALUE);
  });

  it('помощники демо: hex → поля → 64 бита → поля', () => {
    for (const p of t.DOUBLE_PRESETS) {
      const f = fieldsFromHex(p.hex);
      expect(fieldsFromBits(bitString(f))).toEqual(f);
      expect(hexOf(api.encodeDouble(f))).toBe(p.hex);
    }
  });
});

describe('литералы раздела «Устройство double»', () => {
  it('готовые числа демо — биты своих выражений', () => {
    for (const p of t.DOUBLE_PRESETS) expect(hexOf(evaluate(p.label)), p.label).toBe(p.hex);
    // Подпись демо обещает: мантиссы 0.3 и 0.1 + 0.2 — …333 и …334, соседи.
    const a = api.decodeDouble(0.3);
    const b = api.decodeDouble(0.1 + 0.2);
    expect(b.mantissa - a.mantissa).toBe(1n);
    expect(a.mantissa.toString(16).endsWith('333') && b.mantissa.toString(16).endsWith('334')).toBe(true);
    expect(api.nextAway(0.3)).toBe(0.1 + 0.2);
  });

  it('FIELD_ROWS — поля, как их разбирает decodeDouble', () => {
    for (const r of t.FIELD_ROWS) {
      const x = evaluate(r.expr);
      const f = api.decodeDouble(x);
      expect(hexOf(x), r.expr).toBe(r.hex);
      expect(f.sign, r.expr).toBe(r.sign);
      expect(f.mantissa.toString(16), r.expr).toBe(r.mantissa);
      const [raw, shifted] = r.exponent.split(' → ');
      expect(f.exponent, r.expr).toBe(Number(raw));
      if (shifted) expect(f.exponent - 1023, r.expr).toBe(Number(shifted.replace('−', '-')));
    }
  });
});

describe('раздел «0.1 + 0.2»', () => {
  it('точные значения и печать', () => {
    for (const r of t.EXACT_ROWS) {
      const x = evaluate(r.expr);
      expect(api.exactDecimal(x), r.expr).toBe(r.exact);
      expect(x.toFixed(r.exact.split('.')[1].length)).toBe(r.exact);
      expect(String(x)).toBe(r.prints);
    }
  });

  it('числа в тексте: соседние биты, ошибки округления, EPSILON и шаги', () => {
    expect(hexOf(0.1 + 0.2)).toBe('3fd3333333333334');
    expect(hexOf(0.3)).toBe('3fd3333333333333');
    expect(t.SUM_STEPS[2].d).toContain('0x3fd3333333333334');
    // «0.1 округлилась вверх на 5,55 · 10⁻¹⁸, 0.2 — на 1,11 · 10⁻¹⁷»
    expect(api.exactDecimal(0.1).slice(0, 22)).toBe('0.10000000000000000555');
    expect(api.exactDecimal(0.2).slice(0, 21)).toBe('0.2000000000000000111');
    expect(Number.EPSILON).toBe(2 ** -52);
    // «У тысячи шаг сетки в 512 раз больше», «у двух тысяч — в 1024», «у тройки — 2 · EPSILON».
    expect((api.nextAway(1000) - 1000) / Number.EPSILON).toBe(512);
    expect((api.nextAway(2000.3) - 2000.3) / Number.EPSILON).toBe(1024);
    expect((api.nextAway(3.3) - 3.3) / Number.EPSILON).toBe(2);
    expect(Math.abs(1.1 + 2.2 - 3.3)).toBe(2 * Number.EPSILON);
  });
});

describe('таблицы «выражение → результат» исполняются', () => {
  const tables: [string, t.ExprRow[]][] = [
    ['EPSILON_ROWS', t.EPSILON_ROWS],
    ['CLOSE_ROWS', t.CLOSE_ROWS],
    ['SAFE_ROWS', t.SAFE_ROWS],
    ['ZERO_ROWS', t.ZERO_ROWS],
    ['NAN_ROWS', t.NAN_ROWS],
    ['PRINT_ROWS', t.PRINT_ROWS],
    ['BIGINT_ROWS', t.BIGINT_ROWS],
    ['ASINT_ROWS', t.ASINT_ROWS],
    ['BIT_ROWS', t.BIT_ROWS],
    ['MONEY_BAD_ROWS', t.MONEY_BAD_ROWS],
    ['MONEY_ROWS', t.MONEY_ROWS],
  ];

  for (const [name, rows] of tables) {
    it(name, () => {
      for (const r of rows) expect(run(r.code), `${name}: ${r.code}`).toBe(r.out);
    });
  }

  it('ни в одной ячейке нет двух `**`: inlineMd сделал бы из них жирный внутри кода', () => {
    for (const [name, rows] of tables) {
      for (const cell of t.exprRows(rows).flat()) {
        expect((cell.match(/\*\*/g) ?? []).length, `${name}: ${cell}`).toBeLessThan(2);
      }
    }
    for (const r of t.SMI_ROWS) expect((r.code.match(/\*\*/g) ?? []).length).toBeLessThan(2);
  });
});

describe('раздел «Где теряются целые»', () => {
  it('шаг сетки у чисел STEP_ROWS — nextAway(x) − x', () => {
    for (const r of t.STEP_ROWS) {
      const x = evaluate(r.x);
      expect(String(api.nextAway(x) - x), r.x).toBe(r.step);
    }
  });

  it('JSON_BIG_CODE исполняется и даёт то, что написано в комментариях', () => {
    const out = new Function(
      `${t.JSON_BIG_CODE}\nreturn [data.id, JSON.stringify({ id: JSON.rawJSON(String(data.id)) })];`,
    )() as [bigint, string];
    expect(out[0]).toBe(9007199254740993n);
    expect(t.JSON_BIG_CODE).toContain('// 9007199254740993n');
    expect(t.JSON_BIG_CODE).toContain(`// '${out[1]}'`);
  });
});

describe('BigInt и побитовые', () => {
  it('fnv1a64 — эталонные значения FNV-1a 64 и комментарий в коде', () => {
    const fnv = new Function(`${t.HASH_CODE}\nreturn fnv1a64;`)() as (s: string) => string;
    expect(fnv('')).toBe('cbf29ce484222325');
    expect(fnv('a')).toBe('af63dc4c8601ec8c');
    expect(fnv('foobar')).toBe('85944171f73967e8');
    expect(t.HASH_CODE).toContain(`// '${fnv('a')}'`);
  });

  it('toInt32 совпадает с x | 0 на всех порядках и особых значениях', () => {
    const toInt32 = new Function(`${t.TOINT32_CODE}\nreturn toInt32;`)() as (x: number) => number;
    const special = [0, -0, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 32, 2 ** 53, 2 ** 64, 1e300, Number.MIN_VALUE, -1.5, 3e9];
    for (const x of special) expect(Object.is(toInt32(x), x | 0), String(x)).toBe(true);
    const buf = new BigUint64Array(1);
    const f64 = new Float64Array(buf.buffer);
    for (const bits of randomBits(50_000, 4242n)) {
      buf[0] = bits;
      const x = f64[0];
      expect(Object.is(toInt32(x), x | 0)).toBe(true);
    }
    // «`~~x` и `x >> 0` — тот же ToInt32»
    expect(~~3e9).toBe(3e9 | 0);
    expect(3e9 >> 0).toBe(3e9 | 0);
  });
});

describe('раздел «Деньги»: числа в тексте', () => {
  it('2^53 копеек — 90 триллионов рублей, отказ на копейку выше', () => {
    expect(Math.floor(Number.MAX_SAFE_INTEGER / 100 / 1e12)).toBe(90);
    expect(t.MONEY_CODE).toContain('90 триллионов');
    const toUnits = new Function(`${t.MONEY_CODE}\nreturn toUnits;`)() as (s: string, d: number) => bigint;
    expect(toUnits('90071992547409.92', 2)).toBe(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  });

  it('факт «parseFloat(19.99) * 100»', () => {
    expect(parseFloat('19.99') * 100).toBe(1998.9999999999998);
    expect(t.MONEY_FACTS[1].d).toContain('1998.9999999999998');
    expect(0.29 * 100).toBe(28.999999999999996);
  });
});

/** Код в отдельном процессе Node с флагами движка; вывод — stdout. */
function node(flags: string[], code: string): string {
  return execFileSync(process.execPath, [...flags, '-e', code], { encoding: 'utf8' });
}

describe('Smi и HeapNumber — в отдельном процессе с --allow-natives-syntax', () => {
  it('SMI_ROWS: колонка Node совпадает с движком', () => {
    const body = `const half = Number('0.5'); const two = Number('2'); return [${t.SMI_ROWS.map((r) => r.code).join(', ')}];`;
    const got = JSON.parse(node(['--allow-natives-syntax'], `console.log(JSON.stringify((() => { ${body} })()))`)) as boolean[];
    t.SMI_ROWS.forEach((r, i) => expect(got[i], r.code).toBe(r.node));
  });

  it('DEBUG_OUT — вывод DEBUG_CODE без адресов', () => {
    const out = node(['--allow-natives-syntax'], t.DEBUG_CODE)
      .split('\n')
      .filter((l) => /^DebugPrint|^ - value|^ - map: .*HEAP_NUMBER_TYPE/.test(l))
      .map((l) =>
        l
          .replace(/0x[0-9a-f]{9,}/g, '0x…')
          // Node 26 добавляет пространство кучи у литералов и биты у NaN — Node 24 их не печатает.
          .replace(' in OldSpace', '')
          .replace(/ \(0x…\)$/, ''),
      )
      .join('\n');
    expect(out).toBe(t.DEBUG_OUT);
  });

  it('BYTES_ROWS: байты на элемент в Node — 8, 8, 24, 32', () => {
    const script = (kind: string) => `
      const N = 1_000_000;
      const make = {
        smi: () => { const a = []; for (let i = 0; i < N; i++) a.push(i); return a; },
        double: () => { const a = []; for (let i = 0; i < N; i++) a.push(i + 0.5); return a; },
        boxed: () => { const a = ['x']; for (let i = 0; i < N; i++) a.push(i + 0.5); a.shift(); return a; },
        big: () => { const a = []; for (let i = 0; i < N; i++) a.push(BigInt(i)); return a; },
      };
      gc(); gc();
      const before = process.memoryUsage().heapUsed;
      const build = () => { const tmp = make['${kind}'](); return tmp.slice(); };
      const keep = build();
      gc(); gc();
      console.log((process.memoryUsage().heapUsed - before) / N, keep.length);`;
    const kinds = ['smi', 'double', 'boxed', 'big'];
    kinds.forEach((kind, i) => {
      const [perElement] = node(['--expose-gc'], script(kind)).trim().split(' ').map(Number);
      expect(Math.round(perElement), kind).toBe(t.BYTES_ROWS[i].node);
    });
    expect(t.BIGINT_COST).toContain(`${t.BYTES_ROWS[3].node} байта на элемент в Node и ${t.BYTES_ROWS[3].chrome} в Chromium`);
  }, 60_000);

  it('Node собран без сжатия указателей — отсюда 32-битные Smi', () => {
    const v = (process.config.variables as Record<string, unknown>).v8_enable_pointer_compression;
    expect(v === 0 || v === false || v === undefined).toBe(true);
  });
});
