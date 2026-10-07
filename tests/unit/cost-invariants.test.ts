import { describe, expect, it } from 'vitest';

/**
 * Инварианты замеров, на которых стоят два урока.
 *
 * ⚠️ Проверяются **отношения, а не миллисекунды**. Абсолютные числа на странице сняты
 * на конкретной машине (Node 24.11, Apple M1) и на другой будут другими — тест, сверяющий
 * их дословно, краснел бы от смены железа, а не от ошибки. Ломаться он обязан тогда, когда
 * перестаёт быть верным *смысл*: если прокси вдруг стал бесплатным или если сравнение
 * строк начало сходить с дистанции на первом различии.
 *
 * Обе проверки написаны с обходом ловушек, на которых замер портится молча, — те же самые
 * ловушки разобраны в уроках, и здесь они закреплены кодом.
 */

/** Медиана: одиночный выброс на занятой машине не должен решать исход. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('цена чтения через прокси', () => {
  /**
   * Две ловушки этого замера:
   *   1) одна функция на все случаи делает inline cache мегаморфным — тогда «дорого»
   *      становится везде, и разницы между случаями не видно;
   *   2) чтение поля у одного и того же объекта вылетает из цикла как инвариант, и базовая
   *      линия выходит вдвое дешевле правды.
   * Отсюда: своя функция на случай и кольцо разных объектов одной формы.
   */
  it('прокси дороже прямого чтения в разы, а не на проценты', () => {
    const N = 2_000_000;
    const K = 256;

    const plains = Array.from({ length: K }, (_, i) => ({ x: i }));
    const proxies = plains.map((o) => new Proxy(o, { get: (t, k, r) => Reflect.get(t, k, r) }));

    const readPlain = (a: { x: number }[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };
    const readProxy = (a: { x: number }[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };

    const bench = (fn: (a: { x: number }[]) => number, arr: { x: number }[]) => {
      fn(arr);
      fn(arr);
      return median(
        Array.from({ length: 3 }, () => {
          const start = performance.now();
          fn(arr);
          return performance.now() - start;
        }),
      );
    };

    const direct = bench(readPlain, plains);
    const proxy = bench(readProxy, proxies);

    // На M1 отношение выходит около ×21–25. Порог сильно ниже: он ловит не «стало на 10%
    // быстрее», а исчезновение самого эффекта, о котором говорит урок.
    expect(proxy / direct).toBeGreaterThan(5);
  });
});

describe('цена `===` на длинных строках', () => {
  /**
   * Две ловушки этого замера:
   *   1) пара, сравнённая дважды, дальше сравнивается по указателю — V8 склеивает равные
   *      строки (ThinString). Поэтому каждая пара живёт ровно одно сравнение;
   *   2) строки должны быть построены одинаково: плоская против cons добавила бы в один
   *      из случаев ещё и выпрямление.
   */
  it('различие в хвосте стоит столько же, сколько полное равенство', () => {
    const LONG = 50_000;
    const RUNS = 21;

    const timeOnce = (make: () => [string, string]) =>
      median(
        Array.from({ length: RUNS }, () => {
          const [x, y] = make();
          const start = performance.now();
          const equal = x === y;
          const spent = performance.now() - start;
          // Результат обязан быть использован, иначе сравнение вправе исчезнуть целиком.
          return equal ? spent : spent;
        }),
      );

    const equalPair = (): [string, string] => ['x'.repeat(LONG), 'x'.repeat(LONG)];
    const tailPair = (): [string, string] => [
      'x'.repeat(LONG - 1) + 'x',
      'x'.repeat(LONG - 1) + 'y',
    ];

    const equal = timeOnce(equalPair);
    const tail = timeOnce(tailPair);

    // Главное утверждение урока: `memcmp` проходит строку целиком, и «различие в хвосте»
    // не дороже и не дешевле полного равенства. Конспект утверждал обратное — вдвое дешевле.
    const ratio = tail / equal;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});
