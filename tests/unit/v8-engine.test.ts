import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  BENCH_LIES,
  BENCH_SNIPPETS,
  IC_STATES,
  MYTHS,
  STILL_TRUE,
} from '@/content/lessons/v8-engine/data';

/**
 * Утверждения темы «Движок V8» — запуском, а не по памяти.
 *
 * ⚠️ Правило замеров этого курса действует здесь целиком: **закрепляется отношение,
 * а не миллисекунды**. Числа в `IC_STATES` сняты на конкретной машине (Node 24.11, V8 13.6,
 * macOS arm64), и тест, сверяющий их дословно, краснел бы от смены железа, а не от ошибки.
 * Падать он обязан тогда, когда перестаёт быть верным смысл: если мегаморфная площадка вдруг
 * сравнялась с мономорфной, если `delete` перестал уводить объект в словарь, если `try/catch`
 * снова начал стоить кратно.
 *
 * Все четыре ловушки из `AGENTS.md` («Как меряют в этом курсе») обойдены намеренно:
 *   — своя функция на каждый случай, иначе один мегаморфный кеш испортит все замеры сразу;
 *   — кольцо разных объектов одной формы, иначе чтение поля вылетит из цикла как инвариант;
 *   — прогрев отдельно, измерение отдельно, медиана из нескольких прогонов;
 *   — результат каждого замера потребляется, иначе вычисление вправе исчезнуть целиком.
 *
 * ⚠️ Часть фактов о V8 наблюдаема только под `--allow-natives-syntax`, и включить его
 * в самом Vitest нельзя. Поэтому такие проверки уходят отдельным процессом Node — тем же
 * приёмом, что в `tests/unit/elements-kinds.test.ts`.
 *
 * ⚠️ Всё, что здесь проверяется, — детали реализации V8, а не гарантии языка. Тест и нужен
 * затем, чтобы смена поведения в новой версии Node остановила сборку, а не осталась
 * незамеченной в тексте темы.
 */

/** Медиана: одиночный выброс на занятой машине не должен решать исход. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Прогреть, затем измерить. Прогрев отдельным вызовом — это первая ловушка из темы:
 * первые проходы идут через интерпретатор, и один таймер вокруг всего мерил бы смесь ярусов.
 * Результат складывается в сумму и сравнивается с невозможным значением — так он «потреблён»,
 * и компилятор не вправе выбросить вызов.
 */
function bench<A>(fn: (arg: A) => number, arg: A): number {
  fn(arg);
  fn(arg);
  return median(
    Array.from({ length: 5 }, () => {
      const start = performance.now();
      const result = fn(arg);
      const spent = performance.now() - start;
      return result === Number.MIN_SAFE_INTEGER ? spent + 1 : spent;
    }),
  );
}

/** Выполнить код в отдельном Node с нативным синтаксисом и вернуть его вывод. */
function natives(source: string): string {
  return execFileSync(process.execPath, ['--allow-natives-syntax', '-e', source], {
    encoding: 'utf8',
  }).trim();
}

/** Пункт «тонкого места» по номеру: пропажа номера обязана падать внятно. */
function lie(n: string) {
  const found = BENCH_LIES.find((p) => p.n === n);
  if (!found) throw new Error(`пункта ${n} в BENCH_LIES нет — проверка осталась без предмета`);
  return found;
}

// ---------------------------------------------------------------------------
// Раздел 3 · inline caches: цена потери мономорфности
// ---------------------------------------------------------------------------

describe('inline caches · потеря мономорфности стоит денег', () => {
  const N = 2_000_000;
  const K = 256;

  /**
   * Восемь разных форм, и у каждой есть поле `x`. Различаются они набором остальных полей —
   * значит, у каждой свой map, а площадка чтения `.x` видит ровно столько форм, сколько
   * их положили в кольцо.
   */
  const shapes: ((i: number) => { x: number })[] = [
    (i) => ({ x: i }),
    (i) => ({ x: i, a: 1 }),
    (i) => ({ x: i, b: 1, c: 2 }),
    (i) => ({ x: i, d: 1, e: 2, f: 3 }),
    (i) => ({ x: i, g: 1, h: 2, j: 3, k: 4 }),
    (i) => ({ x: i, l: 1, m: 2, n: 3, o: 4, p: 5 }),
    (i) => ({ x: i, q: 1, r: 2, s: 3, t: 4, u: 5, v: 6 }),
    (i) => ({ x: i, w: 1, y: 2, z: 3, a1: 4, b1: 5, c1: 6, d1: 7 }),
  ];

  /**
   * Кольцо из K объектов, циклически перебирающее первые `count` форм.
   *
   * ⚠️ Именно кольцо, а не один объект: чтение поля у одного и того же объекта компилятор
   * вынесет из цикла как инвариант, и базовая линия выйдет вдвое дешевле правды — это вторая
   * ловушка из `AGENTS.md`, и на ней «мономорфизм бесплатен» получается сам собой.
   */
  const ring = (count: number) => Array.from({ length: K }, (_, i) => shapes[i % count](i));

  /**
   * ⚠️ Пять одинаковых по тексту функций — не копипаста, а условие корректности замера.
   * Одна функция на все случаи сделала бы площадку чтения мегаморфной, и «дорого» вышло бы
   * везде: разницы между состояниями не стало бы видно вовсе. Это первая ловушка из темы.
   */
  const readMono = (a: { x: number }[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
    return s;
  };
  const readPoly2 = (a: { x: number }[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
    return s;
  };
  const readPoly4 = (a: { x: number }[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
    return s;
  };
  const readMega5 = (a: { x: number }[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
    return s;
  };
  const readMega8 = (a: { x: number }[]) => {
    let s = 0;
    for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
    return s;
  };

  /**
   * Порядок цен — единственное, что здесь воспроизводится от прогона к прогону и от машины
   * к машине. Пороги выбраны с большим запасом вниз: они ловят не «стало на 10% быстрее»,
   * а исчезновение самого эффекта, ради которого написан весь раздел.
   *
   * ⚠️ Раньше тема называла отношение «моно → две формы» трёхкратным (31.8 против 105.3 мс).
   * Воспроизвести это не удалось ни на Node 24.11, ни на Node 26: выходит 1.2–1.5, и числа
   * в `IC_STATES` пересняты (19.5 / 24.6 / 28.9 / 70.4 / 71.4 мс). Порог поэтому стоит на 1.05 —
   * закрепляется направление («вторая форма дороже первой»), а не множитель.
   */
  it('цена растёт по мере роста числа форм: моно < поли-2 < поли-4 ≪ мегаморфизм', { timeout: 30_000 }, () => {
    const mono = bench(readMono, ring(1));
    const poly2 = bench(readPoly2, ring(2));
    const poly4 = bench(readPoly4, ring(4));
    const mega = bench(readMega5, ring(5));

    expect(poly2 / mono, 'вторая форма уже дороже одной').toBeGreaterThan(1.05);
    expect(poly4 / poly2, 'четыре формы не дешевле двух').toBeGreaterThan(0.95);
    expect(mega / poly4, 'за границей в четыре формы — обрыв, а не ступенька').toBeGreaterThan(1.3);
    // Главное число раздела: разрыв между самым дешёвым и самым дорогим состоянием — разы.
    expect(mega / mono, 'мегаморфизм дороже мономорфизма в разы').toBeGreaterThan(2.5);
  });

  /**
   * Вторая половина утверждения темы: мегаморфизм — **состояние, а не шкала**. Площадка
   * перестала хранить формы, и дальше ей всё равно, пять их или двадцать. Если однажды
   * окажется, что «хуже становится» — данные о 5 и 20 формах придётся переписывать.
   */
  it('мегаморфизм — состояние, а не шкала: пять форм и восемь стоят одинаково', { timeout: 30_000 }, () => {
    const mega5 = bench(readMega5, ring(5));
    const mega8 = bench(readMega8, ring(8));

    const ratio = mega8 / mega5;
    expect(ratio, 'больше форм — не дороже').toBeLessThan(1.25);
    expect(ratio, 'и не дешевле').toBeGreaterThan(0.8);
  });

  /**
   * Числа на странице тест не сверяет — но их **порядок** обязан совпадать с тем, что меряет
   * движок. Иначе переключатель демо рассказывал бы про рост, которого нет.
   */
  it('числа в `IC_STATES` упорядочены так же, как измеряет движок', () => {
    const byLabel = (label: string) => {
      const found = IC_STATES.find((s) => s.label === label);
      if (!found) throw new Error(`в IC_STATES нет случая «${label}»`);
      return found;
    };

    const mono = byLabel('1 форма');
    const poly2 = byLabel('2 формы');
    const poly4 = byLabel('4 формы');
    const mega5 = byLabel('5 форм');
    const mega20 = byLabel('20 форм');

    expect(mono.state, 'одна форма — мономорфная площадка').toBe('monomorphic');
    expect(poly4.state, 'четыре — ещё полиморфная').toBe('polymorphic');
    expect(mega5.state, 'пятая форма переводит площадку в мегаморфное состояние').toBe(
      'megamorphic',
    );

    expect(mono.ms, 'моно дешевле поли').toBeLessThan(poly2.ms);
    expect(poly4.ms, 'поли дешевле мега').toBeLessThan(mega5.ms);
    // «Мегаморфизм — состояние, а не шкала»: 5 и 20 форм на странице обязаны быть рядом.
    expect(Math.abs(mega20.ms - mega5.ms) / mega5.ms, 'между 5 и 20 формами разницы нет').toBeLessThan(
      0.15,
    );
  });
});

describe('миф «мегаморфизм = деоптимизация»', () => {
  /**
   * Тема утверждает: мегаморфное состояние площадки **не вызывает bailout**, функция остаётся
   * оптимизированной — теряется не оптимизация, а информация о типе. Наблюдать это можно
   * только нативным синтаксисом: `%GetOptimizationStatus` возвращает битовую маску состояния.
   *
   * ⚠️ Раскладывать маску по битам тест не пытается: нумерация битов — внутреннее дело V8
   * и от версии к версии сдвигается. Сравниваются две маски между собой, а это ровно то,
   * что утверждает страница: мегаморфная функция оптимизирована **так же**, как мономорфная.
   */
  it('мегаморфная функция оптимизирована ровно так же, как мономорфная', () => {
    const out = natives(`
      const mono = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const mega = [{ x: 1 }, { x: 1, a: 1 }, { x: 1, b: 1, c: 2 },
                    { x: 1, d: 1, e: 2, f: 3 }, { x: 1, g: 1, h: 2, j: 3, k: 4 },
                    { x: 1, l: 1, m: 2, n: 3, o: 4, p: 5 }];
      function readMono(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i].x; return s; }
      function readMega(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i].x; return s; }
      function warm(f, a) {
        %PrepareFunctionForOptimization(f);
        for (let i = 0; i < 10; i++) f(a);
        %OptimizeFunctionOnNextCall(f);
        f(a);
        return %GetOptimizationStatus(f);
      }
      const before = warm(readMega, mega);
      // Ещё тысяча вызовов по кольцу форм: если бы мегаморфизм ронял функцию в bailout,
      // маска после них отличалась бы от маски до.
      for (let i = 0; i < 1000; i++) readMega(mega);
      console.log([warm(readMono, mono), before, %GetOptimizationStatus(readMega)].join(' '));
    `);

    const [mono, megaBefore, megaAfter] = out.split(' ');
    expect(megaBefore, 'мегаморфная функция оптимизирована так же, как мономорфная').toBe(mono);
    expect(megaAfter, 'и тысяча вызовов по шести формам её не деоптимизировала').toBe(megaBefore);

    const myth = MYTHS.find((m) => m.myth.includes('мегаморфизм'));
    expect(myth?.now, 'страница говорит ровно это').toContain('не вызывает bailout');
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · формы объектов: порядок полей и словарный режим
// ---------------------------------------------------------------------------

describe('форма объекта — это дерево переходов, и порядок полей в нём значим', () => {
  /**
   * `%HaveSameMap` отвечает на единственный вопрос, ради которого раздел написан: «это один
   * и тот же map или два разных?». Утверждение «`{w,h}` и `{h,w}` — разные формы» проверяется
   * только так: снаружи оба объекта неотличимы, у них те же ключи и те же значения.
   */
  const sameMap = (a: string, b: string): boolean =>
    natives(`console.log(%HaveSameMap(${a}, ${b}));`) === 'true';

  it('`{w,h}` и `{h,w}` — разные формы, хотя ключи и значения совпадают', () => {
    expect(sameMap('{ w: 1, h: 2 }', '{ w: 3, h: 4 }'), 'тот же порядок — та же форма').toBe(true);
    expect(sameMap('{ w: 1, h: 2 }', '{ h: 2, w: 1 }'), 'обратный порядок — другая форма').toBe(
      false,
    );
  });

  it('у конструкторов то же самое: порядок присваиваний решает', () => {
    const code = `
      function A() { this.w = 1; this.h = 2; }
      function B() { this.h = 2; this.w = 1; }
      console.log(%HaveSameMap(new A(), new A()), %HaveSameMap(new A(), new B()));
    `;
    expect(natives(code), 'два A совпали, A и B — нет').toBe('true false');
  });

  /**
   * Следствие из того же дерева, которое тема выносит отдельной строкой: поле, присвоенное
   * позже, ведёт по другой ветке — форма получается не та же самая, что у литерала.
   */
  it('поле, добавленное после создания, даёт другую форму, чем то же поле в литерале', () => {
    const code = `
      const late = { w: 1 };
      late.h = 2;
      console.log(%HaveSameMap(late, { w: 1, h: 2 }));
    `;
    expect(natives(code)).toBe('false');
  });

  it('тема называет порядок полей среди того, что осталось правдой', () => {
    const claim = STILL_TRUE.find((s) => s.includes('Порядок инициализации полей'));
    expect(claim, 'утверждения про порядок полей на странице нет').toBeDefined();
    expect(claim).toContain('дерево');
  });
});

describe('словарный режим · `delete` и его цена', () => {
  /** `%HasFastProperties` — прямой ответ движка: объект ещё с формой или уже в словаре. */
  const fastProps = (body: string): string => natives(`
    ${body}
    console.log(%HasFastProperties(probe));
  `);

  /**
   * ⚠️ ЭТОТ ТЕСТ ИСПРАВИЛ ОШИБКУ ТЕМЫ. Страница (и `STILL_TRUE`, и карточка «Dictionary
   * mode») обещала: «если удаляют **последнее добавленное** свойство, V8 умеет откатить
   * форму на шаг назад по дереву — словаря не будет». Запуском это не подтвердилось, и текст
   * приведён к тому, что делает движок. Важная деталь: утверждение **внесли при переносе** —
   * оригинал такого не обещал, оно стояло в списке «что уточнено против оригинала».
   *
   * И `delete` из середины, и `delete` последнего свойства одинаково уводят объект
   * в словарный режим — проверено на Node 24.11 (V8 13.6, та самая версия, на которой
   * снята тема) и на Node 26.8 (V8 14.6), на литералах и на конструкторах, на объектах
   * от одного до двенадцати свойств, с полями и в самом объекте, и в backing store.
   *
   * Тест закрепляет то, что делает движок. Покраснеет он, если быстрый путь появится, —
   * и тогда фразу на странице надо будет вернуть.
   */
  it('`delete` уводит в словарь и из середины, и с конца — быстрого пути нет', () => {
    expect(fastProps('const probe = { a: 1, b: 2, c: 3 };'), 'нетронутый объект — с формой').toBe(
      'true',
    );
    expect(
      fastProps('const probe = { a: 1, b: 2, c: 3 }; delete probe.b;'),
      'удаление из середины — словарь, тут тема права',
    ).toBe('false');
    expect(
      fastProps('const probe = { a: 1, b: 2, c: 3 }; delete probe.c;'),
      'удаление ПОСЛЕДНЕГО свойства — тоже словарь, обещанного отката формы нет',
    ).toBe('false');
    expect(
      fastProps('function P() { this.a = 1; this.b = 2; } const probe = new P(); delete probe.b;'),
      'у объекта из конструктора так же',
    ).toBe('false');
  });

  /** Та же находка со второй стороны: форма после `delete` не равна форме без этого поля. */
  it('форма назад по дереву не откатывается', () => {
    const code = `
      const withC = { a: 1, b: 2, c: 3 };
      delete withC.c;
      console.log(%HaveSameMap(withC, { a: 1, b: 2 }));
    `;
    expect(natives(code), 'если бы откат был, формы совпали бы').toBe('false');
  });

  /** А вот вторая строка листинга темы подтверждается полностью: присваивание форму бережёт. */
  it('`obj.prop = undefined` форму сохраняет — объект остаётся быстрым', () => {
    expect(fastProps('const probe = { a: 1, b: 2, c: 3 }; probe.b = undefined;')).toBe('true');
  });

  /**
   * «Разница на горячем пути кратная» — проверяется отношением, а не миллисекундами.
   * Обе ловушки замера обойдены так же, как выше: своя функция на случай и кольцо объектов.
   */
  it('чтение поля у словарного объекта кратно дороже, чем у объекта с формой', { timeout: 30_000 }, () => {
    const N = 2_000_000;
    const K = 256;

    const make = () => ({ x: 0, y: 2, z: 3 });
    const fast = Array.from({ length: K }, (_, i) => {
      const o = make();
      o.x = i;
      return o;
    });
    const dict = Array.from({ length: K }, (_, i) => {
      const o = make();
      // @ts-expect-error — `delete` у необязательного поля TypeScript не разрешает, и он прав.
      // Здесь он делается намеренно: ровно это и переводит объект в словарный режим, а увидеть
      // цену словаря можно только на объекте, который в него попал.
      delete o.y;
      o.x = i;
      return o;
    });

    const readFast = (a: { x: number }[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };
    const readDict = (a: { x: number }[]) => {
      let s = 0;
      for (let i = 0; i < N; i++) s += a[i & (K - 1)].x;
      return s;
    };

    const ratio = bench(readDict, dict) / bench(readFast, fast);
    // На M1 выходит около ×4.7–5.3. Порог вдвое ниже: он ловит исчезновение эффекта,
    // а не колебания загруженной машины.
    expect(ratio, 'словарь дороже формы в разы, а не на проценты').toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Раздел 6 · мифы, объявленные неактуальными
// ---------------------------------------------------------------------------

describe('миф «try/catch мешает оптимизации»', () => {
  /**
   * Историческая правда про Crankshaft, сегодня неверная: обработчик исключений — запись
   * в Handler Table байткода, и функция с ним оптимизируется наравне с функцией без него.
   * Проверяется это дважды — состоянием (маски совпали) и ценой (разница не кратная).
   */
  it('функция с `try/catch` получает ту же маску оптимизации, что и без него', () => {
    const out = natives(`
      function plain(n) { let s = 0; for (let i = 0; i < n; i++) s += i % 7; return s; }
      function guarded(n) { let s = 0; try { for (let i = 0; i < n; i++) s += i % 7; } catch (e) { s = -1; } return s; }
      function warm(f) {
        %PrepareFunctionForOptimization(f);
        for (let i = 0; i < 10; i++) f(50);
        %OptimizeFunctionOnNextCall(f);
        f(50);
        return %GetOptimizationStatus(f);
      }
      console.log(warm(plain), warm(guarded));
    `);
    const [plain, guarded] = out.split(' ');
    expect(guarded, '`try/catch` больше не мешает попасть в оптимизирующий компилятор').toBe(plain);
  });

  it('и цена `try/catch` не кратная — ни снаружи цикла, ни внутри него', { timeout: 30_000 }, () => {
    const N = 5_000_000;

    const plain = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += i % 7;
      return s;
    };
    const outside = (n: number) => {
      let s = 0;
      try {
        for (let i = 0; i < n; i++) s += i % 7;
      } catch {
        s = -1;
      }
      return s;
    };
    const inside = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) {
        try {
          s += i % 7;
        } catch {
          s = -1;
        }
      }
      return s;
    };

    const base = bench(plain, N);
    // Порог широкий намеренно: утверждение темы — «не кратно», а не «ровно столько же».
    expect(bench(outside, N) / base, '`try` вокруг цикла бесплатен').toBeLessThan(1.6);
    expect(bench(inside, N) / base, '`try` внутри цикла — тоже').toBeLessThan(1.6);

    const myth = MYTHS.find((m) => m.myth.includes('try/catch'));
    // Осталось правдой другое, и тема это отдельно оговаривает.
    expect(myth?.left, 'дорого не наличие try, а бросание исключений').toContain('БРОСАНИЕ');
  });
});

describe('миф «`arguments` убивает оптимизацию»', () => {
  it('`arguments` и rest дают одну и ту же маску оптимизации', () => {
    const out = natives(`
      function withArgs() { let s = 0; for (let i = 0; i < arguments.length; i++) s += arguments[i]; return s; }
      function withRest(...a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; }
      function warm(f) {
        %PrepareFunctionForOptimization(f);
        for (let i = 0; i < 10; i++) f(1, 2, 3);
        %OptimizeFunctionOnNextCall(f);
        f(1, 2, 3);
        return %GetOptimizationStatus(f);
      }
      console.log(warm(withArgs), warm(withRest));
    `);
    const [args, rest] = out.split(' ');
    expect(args, 'обе оптимизированы одинаково — bailout из времён Crankshaft исчез').toBe(rest);
  });

  it('и цена у них одна: разница не кратная', { timeout: 30_000 }, () => {
    const N = 3_000_000;

    function withArgs(): number {
      let s = 0;
      // eslint-disable-next-line prefer-rest-params
      for (let i = 0; i < arguments.length; i++) s += arguments[i] as number;
      return s;
    }
    const withRest = (...a: number[]) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += a[i];
      return s;
    };

    const callArgs = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += (withArgs as (...a: number[]) => number)(i, 2, 3);
      return s;
    };
    const callRest = (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += withRest(i, 2, 3);
      return s;
    };

    const ratio = bench(callArgs, N) / bench(callRest, N);
    expect(ratio, '`arguments` не дороже rest в разы').toBeLessThan(1.8);
    expect(ratio, 'и не дешевле в разы').toBeGreaterThan(0.55);

    const myth = MYTHS.find((m) => m.myth.includes('arguments'));
    expect(myth?.left, 'осталось соображение стилистическое, а не про деопт').toContain(
      'стилистическое',
    );
  });
});

// ---------------------------------------------------------------------------
// Раздел 7 · почему микробенчмарки врут
// ---------------------------------------------------------------------------

describe('мёртвый код · «вправе удалить» и «удаляет» — разное', () => {
  /**
   * Пресет песочницы исполняется **прямо из данных темы**, а не переписывается в тест:
   * разъехаться код на странице и вывод под ним теперь не могут. Числа из вывода берутся
   * только для отношения — сами они у каждого свои, и раздел ровно про это.
   */
  const runSnippet = (): Record<string, number> => {
    const snippet = BENCH_SNIPPETS.find((s) => s.label === 'мёртвый код');
    if (!snippet) throw new Error('пресета «мёртвый код» в BENCH_SNIPPETS нет');

    const lines: string[] = [];
    const console = { log: (...args: unknown[]) => void lines.push(args.map(String).join(' ')) };
    (new Function('console', `'use strict';\n${snippet.code}`) as (c: typeof console) => void)(
      console,
    );

    const ms = (prefix: string) => {
      const line = lines.find((l) => l.startsWith(prefix));
      if (!line) throw new Error(`в выводе пресета нет строки «${prefix}»: ${lines.join(' | ')}`);
      return Number.parseFloat(line.slice(prefix.length));
    };
    return {
      empty: ms('пустой цикл:'),
      dead: ms('результат не нужен:'),
      alive: ms('результат нужен:'),
    };
  };

  /**
   * Утверждение, которое тема исправила против конспекта-источника: цикл с выброшенным
   * результатом на самом деле **не выброшен**. Если бы TurboFan его удалял, «результат
   * не нужен» стоял бы рядом с пустым циклом; на деле он стоит рядом с «результат нужен».
   */
  it('цикл с ненужным результатом считается целиком: он дороже пустого', { timeout: 60_000 }, () => {
    const { empty, dead, alive } = runSnippet();

    expect(dead / empty, 'выброси его компилятор — отношение было бы около единицы').toBeGreaterThan(
      1.3,
    );
    expect(dead / alive, 'и стоит он ровно столько же, сколько цикл с нужным результатом')
      .toBeGreaterThan(0.7);
    expect(dead / alive).toBeLessThan(1.4);
    expect(alive / empty, 'работа в теле цикла видна на фоне самого цикла').toBeGreaterThan(1.3);
  });

  it('тонкое место 02 говорит именно это: «вправе» ещё не значит «делает»', () => {
    expect(lie('02').d, 'формулировка на странице должна остаться неутвердительной').toContain(
      'удалён **не был**',
    );
    expect(lie('02').d).toContain('вправе');
  });
});
