import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENCH_LIES,
  BENCH_SNIPPETS,
  IC_STATES,
  INTERP_ONLY,
  INTERP_ONLY_NOTE,
  JITLESS_CODE,
  MYTHS,
  SHAPE_TREE_CODE,
  TIPS,
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
   * ⚠️ До 2026-10-29 тема говорила «мегаморфное состояние не вызывает bailout — никогда».
   * Вычитка нашла: функция, уже оптимизированная под четыре формы, на пятой откатывается
   * (`wrong map`) — страж формы есть страж формы. Откат один: после переоптимизации под
   * мегаморфный профиль новые формы откатов не вызывают. Этот тест держит обе половины.
   */
  it('переход к пятой форме у оптимизированной функции стоит ровно одного отката', () => {
    const trace = execFileSync(
      process.execPath,
      [
        '--allow-natives-syntax',
        '--trace-deopt',
        '-e',
        `
        const four = [{ x: 1 }, { x: 1, a: 1 }, { x: 1, b: 1, c: 2 }, { x: 1, d: 1, e: 2, f: 3 }];
        const six = [...four, { x: 1, g: 1, h: 2, j: 3, k: 4 }, { x: 1, l: 1, m: 2, n: 3, o: 4, p: 5 }];
        function read(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i].x; return s; }
        %PrepareFunctionForOptimization(read);
        for (let i = 0; i < 10; i++) read(four);
        %OptimizeFunctionOnNextCall(read);
        read(four);
        read([six[4]]);                       // пятая форма
        console.log('MARK');
        %PrepareFunctionForOptimization(read);
        for (let i = 0; i < 10; i++) read(six);
        %OptimizeFunctionOnNextCall(read);
        read(six);
        for (let i = 0; i < 1000; i++) read(six);
      `,
      ],
      { encoding: 'utf8' },
    );
    const [before, after] = trace.split('MARK');
    const bailouts = (text: string) =>
      text.split('\n').filter((l) => l.includes('bailout') && l.includes('<JSFunction read'));
    expect(bailouts(before), 'пятая форма у функции под четыре формы — один откат').toHaveLength(1);
    expect(bailouts(before)[0]).toContain('reason: wrong map');
    expect(bailouts(after), 'после переоптимизации под мегаморфный профиль — ни одного').toHaveLength(0);

    const myth = MYTHS.find((m) => m.myth.includes('мегаморфизм'));
    expect(myth?.was, 'страница признаёт откат на переходе').toContain('пятая форма вызывает откат');
    expect(myth?.now, 'и говорит, что он один').toContain('откат один');
  });

  /**
   * Вторая половина: функция, оптимизированная уже под мегаморфную площадку, остаётся
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
    expect(myth?.now, 'страница говорит ровно это').toContain('дальше новые формы откатов не вызывают');
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · формы объектов: порядок полей и словарный режим
// ---------------------------------------------------------------------------

describe('«Перед началом»: форму в Node видно без флагов запуска', () => {
  /**
   * ⚠️ До 2026-10-29 тема говорила «из JS этого не видно — ни в браузере, ни в Node» и «библиотека,
   * которая обещает показать скрытый класс, обещает невозможное». В Node это видно из обычного
   * кода, без флагов запуска, двумя способами — оба здесь, отдельным процессом без флагов.
   */
  const plain = (code: string) =>
    execFileSync(process.execPath, ['-e', code], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

  it('`v8.setFlagsFromString` включает `%`-синтаксис для кода, разобранного позже', () => {
    const out = plain(`
      require('v8').setFlagsFromString('--allow-natives-syntax');
      const same = new Function('a', 'b', 'return %HaveSameMap(a, b)');
      console.log(same({ x: 1 }, { x: 2 }), same({ x: 1 }, { y: 1 }));
    `);
    expect(out).toBe('true false');
  });

  it('в снимке кучи ребро `map` у двух объектов одной формы ведёт в один узел', { timeout: 30_000 }, () => {
    const out = plain(`
      class Probe { constructor(x) { this.x = x; } }
      globalThis.keep = [new Probe(1), new Probe(2)];
      let raw = '';
      const s = require('v8').getHeapSnapshot();
      s.on('data', (c) => (raw += c));
      s.on('end', () => {
        const j = JSON.parse(raw), m = j.snapshot.meta;
        const nf = m.node_fields.length, ef = m.edge_fields.length, ecIdx = m.node_fields.indexOf('edge_count');
        const types = m.edge_types[0];
        const maps = [];
        for (let i = 0, e = 0; i < j.nodes.length; i += nf) {
          const ec = j.nodes[i + ecIdx];
          if (j.strings[j.nodes[i + 1]] === 'Probe' && m.node_types[0][j.nodes[i]] === 'object') {
            for (let k = 0; k < ec; k++) {
              const b = (e + k) * ef, t = types[j.edges[b]];
              if (t !== 'element' && t !== 'hidden' && j.strings[j.edges[b + 1]] === 'map') maps.push(j.edges[b + 2]);
            }
          }
          e += ec;
        }
        console.log(maps.length, new Set(maps).size);
      });
    `);
    expect(out, 'два объекта Probe, у обоих ребро map — и в один узел').toBe('2 1');
    const mdx = readFileSync('src/content/lessons/v8-engine/index.mdx', 'utf8');
    expect(mdx).toContain("v8.setFlagsFromString('--allow-natives-syntax')");
    expect(mdx).toContain('`v8.getHeapSnapshot()`');
    expect(mdx).not.toContain('ни в браузере, ни в Node');
  });
});

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

  /**
   * Код под схемой дерева форм — строка из данных темы. ⚠️ Там стояли литералы, а литерал
   * путь от пустого `{}` не проходит: схема и код говорили о разном. Теперь объекты растут
   * из `{}` по полю, и тест сверяет ровно то, что обещают комментарии листинга.
   */
  it('проверка под схемой дерева: `a`/`b` — разные формы, `a`/`c` — одна', () => {
    expect(SHAPE_TREE_CODE).toContain('// false');
    expect(SHAPE_TREE_CODE).toContain('// true');
    const code = `${SHAPE_TREE_CODE}\nconsole.log(%HaveSameMap(a, b), %HaveSameMap(a, c));`;
    expect(natives(code)).toBe('false true');
    // И то, ради чего листинг переписан: литерал этого пути не проходит.
    expect(natives(`${SHAPE_TREE_CODE}\nconsole.log(%HaveSameMap(a, { x: 1, y: 2 }));`)).toBe('false');
  });

  it('тема называет порядок полей среди того, что осталось правдой', () => {
    const claim = TIPS.map((s) => `${s.t} ${s.d}`).find((s) => s.includes('в одном порядке'));
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
   * ⚠️ ЭТОТ ТЕСТ ИСПРАВИЛ ОШИБКУ ТЕМЫ. Страница (и список «что осталось правдой», и карточка «Dictionary
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
   * ⚠️ Тема говорила «объект без формы» и «формы больше нет». Форма у словарного объекта есть —
   * общая, не описывающая полей: два словарных объекта с разными ключами делят её.
   */
  it('у словарного объекта форма есть — общая для словарных объектов с разными ключами', () => {
    const code = `
      const d1 = { a: 1, b: 2 }; delete d1.a;
      const d2 = { q: 1, r: 2, s: 3 }; delete d2.s;
      console.log(%HasFastProperties(d1), %HaveSameMap(d1, d2));
    `;
    expect(natives(code)).toBe('false true');
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
   * Пресет стенда примеров исполняется **прямо из данных темы**, а не переписывается в тест:
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
    // Тема с 2026-10-29 говорит и это: пустой цикл тоже не выброшен (≈10 мс на 2·10⁷ витков).
    expect(empty, 'пустой цикл на двадцать миллионов витков — не ноль').toBeGreaterThan(2);
  });

  it('тонкое место 02 говорит именно это: «вправе» ещё не значит «делает»', () => {
    expect(lie('02').d, 'формулировка на странице должна остаться неутвердительной').toContain(
      'удалён **не был**',
    );
    expect(lie('02').d).toContain('вправе');
    expect(lie('02').d, 'подсказка «выброс вероятнее в пустом цикле» опровергнута замером').not.toContain(
      'Выброс вероятнее',
    );
  });
});

describe('встроенные функции: «своё быстрее» проверяют замером', () => {
  /**
   * ⚠️ Тема до 2026-10-29 записывала «своя глубокая копия быстрее» и «свой `groupBy` быстрее»
   * в устаревшие советы: «ручной реализации ещё предстоит пройти ярусы». Замер опроверг это
   * для копии (ручная ≈ в 10 раз быстрее `structuredClone` на небольшом объекте) и не
   * подтвердил для группировки (ручная не медленнее). Пороги — с большим запасом: ловится
   * исчезновение эффекта, а не колебание машины.
   */
  it('ручная копия простого объекта быстрее `structuredClone`, ручная группировка не медленнее', { timeout: 30_000 }, () => {
    const src = { id: 1, name: 'a', tags: ['x', 'y'], pos: { x: 1, y: 2 } };
    const copy = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v;
      if (Array.isArray(v)) return v.map(copy);
      const o: Record<string, unknown> = {};
      for (const k in v) o[k] = copy((v as Record<string, unknown>)[k]);
      return o;
    };
    const clones = (f: (v: typeof src) => unknown) => (n: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += (f(src) as typeof src).id;
      return s;
    };
    const cloneRatio = bench(clones(structuredClone), 50_000) / bench(clones(copy as (v: typeof src) => unknown), 50_000);
    expect(cloneRatio, '`structuredClone` дороже ручной копии в разы').toBeGreaterThan(2);

    const items = Array.from({ length: 50_000 }, (_, i) => ({ k: `k${i % 10}`, i }));
    const manual = (n: number) => {
      let s = 0;
      for (let r = 0; r < n; r++) {
        const out: Record<string, typeof items> = {};
        for (const it of items) (out[it.k] ??= []).push(it);
        s += Object.keys(out).length;
      }
      return s;
    };
    const builtin = (n: number) => {
      let s = 0;
      for (let r = 0; r < n; r++) s += Object.keys(Object.groupBy(items, (it) => it.k)).length;
      return s;
    };
    expect(bench(manual, 20) / bench(builtin, 20), 'ручная группировка не медленнее встроенной в разы').toBeLessThan(1.5);
  });

  it('`structuredClone` на функции бросает `DataCloneError`, как пишет тема', () => {
    expect(() => structuredClone({ f() {} })).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    const mdx = readFileSync('src/content/lessons/v8-engine/index.mdx', 'utf8');
    expect(mdx).toContain('`DataCloneError`');
    expect(mdx).not.toContain('писать своё больше не нужно');
  });
});

describe('ярусы · оптимизирующие компиляторы работают в фоновом потоке', () => {
  it('Maglev и TurboFan ставятся в очередь фоновой компиляции, а текст не говорит «тот же поток»', () => {
    const trace = execFileSync(
      process.execPath,
      ['--trace-concurrent-recompilation', '-e', 'function f(o){return o.x+1}; let s=0; for(let i=0;i<3e6;i++) s+=f({x:i});'],
      { encoding: 'utf8' },
    );
    expect(trace).toMatch(/JSFunction f .*for concurrent MAGLEV recompilation/);
    expect(trace).toMatch(/JSFunction f .*for concurrent TURBOFAN(_JS)? recompilation/);
    const mdx = readFileSync('src/content/lessons/v8-engine/index.mdx', 'utf8');
    expect(mdx).not.toContain('платит за неё тот же поток');
    expect(mdx).toContain('Maglev и TurboFan делают её в фоновом потоке');
  });
});

describe('«только интерпретатор»: --jitless против обычного Node (отдельные процессы)', () => {
  /** Медиана трёх прогонов каждого замера в одном процессе. */
  const run = (flags: string[]) => {
    const code =
      `${JITLESS_CODE}\n` +
      'const t = (f) => { const r = []; f(); for (let i = 0; i < 3; i++) { const s = performance.now(); f(); r.push(performance.now() - s); } return r.sort((x, y) => x - y)[1]; };\n' +
      'console.log(JSON.stringify({ loop: t(loop), map: t(map), parse: t(parse) }));';
    return JSON.parse(execFileSync(process.execPath, [...flags, '-e', code], { encoding: 'utf8' })) as Record<'loop' | 'map' | 'parse', number>;
  };

  it('цикл — в разы медленнее, .map — заметно, JSON.parse — так же', () => {
    const jit = run([]);
    const interp = run(['--jitless']);
    // Текст говорит «примерно в 16 раз» и «в 3–4 раза»; держим порядок, а не цифру.
    expect(interp.loop / jit.loop).toBeGreaterThan(8);
    expect(interp.map / jit.map).toBeGreaterThan(2);
    expect(interp.parse / jit.parse).toBeLessThan(1.6);
    expect(INTERP_ONLY).toContain('в 16 раз');
    expect(INTERP_ONLY_NOTE).toContain('в 3–4 раза');
  });
});

/**
 * «Что делать в горячем коде»: комментарии в примерах — утверждения о движке. Каждый пример
 * исполняется как есть, следом движок отвечает на вопрос, о котором говорит комментарий.
 */
describe('советы TIPS: примеры говорят правду о движке', () => {
  const tip = (start: string) => {
    const found = TIPS.find((t) => t.t.startsWith(start));
    if (!found?.code) throw new Error(`нет совета с кодом «${start}»`);
    return found.code;
  };
  const ask = (code: string, question: string) => natives(`${code}\nconsole.log(${question});`);

  it('поля сразу и в одном порядке: p1 и p2 — разные формы, a и b — одна', () => {
    expect(ask(tip('Заводите все поля'), '%HaveSameMap(p1, p2), %HaveSameMap(a, b)')).toBe('false true');
  });

  it('delete уводит в словарь, присваивание undefined — нет', () => {
    expect(ask(tip('Не удаляйте'), '%HasFastProperties(user), %HasFastProperties(user2)')).toBe('false true');
  });

  it('new Array(3) — с дырами; смешанный — не «только целые»; push — плотный малых целых', () => {
    expect(
      ask(tip('Держите массивы'), '%HasHoleyElements(holes), %HasSmiElements(mixed), %HasHoleyElements(list), %HasSmiElements(list)'),
    ).toBe('true false false true');
  });

  it('нормализация на входе: у raw разные формы, у items — одна', () => {
    expect(
      ask(tip('Приводите данные'), '%HaveSameMap(raw[0], raw[1]), items.every((o) => %HaveSameMap(o, items[0]))'),
    ).toBe('false true');
  });

  it('setPrototypeOf после создания даёт другую форму, чем Object.create', () => {
    const code = `${tip('Задавайте прототип')}\nconst early2 = Object.create(proto); early2.name = 'y';`;
    expect(ask(code, '%HaveSameMap(late, early), %HaveSameMap(early, early2), late.hi()')).toBe('false true привет');
  });
});
