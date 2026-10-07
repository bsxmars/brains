import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CHAINS,
  HEAP_NODES,
  HEAP_VARIANTS,
  LADDER_FORK,
  LADDER_TEXT,
  NODE_FLAGS,
  NODE_SNAPSHOT_CODE,
  NODE_SNAPSHOT_READ,
  PITFALLS,
  QUERY_OBJECTS_CODE,
  RETAINED_SUM_TEXT,
} from '@/content/lessons/memory-profiling/data';
import { buildGraph, edgeBetween, nodeOf } from '@/widgets/retain-graph/model/graph';
import { allPaths, repairProbe, shortestPath } from '@/widgets/retain-graph/model/path';
import {
  distances,
  dominatorsOf,
  immediateDominator,
  ladder,
  reachable,
  retainedBy,
  retainers,
  weigh,
} from '@/widgets/retain-graph/model/retain';
import { DEFAULT_ROWS, WEIGHTS, applyVariant, makeScene, weakProbe } from '@/widgets/retain-graph/model/scene';
import type { ObjectGraph } from '@/widgets/retain-graph/model/types';

/**
 * «Профилирование памяти»: таблица удержания — это счёт, а не заявление.
 *
 * Тема утверждает восемь чисел retained size, «критерий починки — ноль» и цепочку retainers.
 * До этого файла всё это держалось на одном разовом запуске автора. Здесь те же числа
 * пересчитываются **тем же кодом, который считает их на странице** (`widgets/retain-graph/model`),
 * — правило курса «демо и тест спрашивают движок одинаково».
 *
 * ⚠️ Что здесь НЕ проверяется, и почему не может:
 *
 *   байты сами по себе   `sizeof` в JS нет. Все веса в `WEIGHTS` объявлены замером урока
 *                        (Node 24.11, без сжатия указателей). Посчитано и закреплено здесь —
 *                        КОМУ принадлежат байты, а не сколько их;
 *   `CMP_ROWS`           это учебный пример формы сеанса, а не замер, и в `CMP_CAVEAT` так
 *                        и сказано. Сверять выдуманные числа не с чем;
 *   колонка `Distance`   в теме она «как показал бы DevTools» и отсчитана от корня выше окна.
 *                        Закрепляется не её величина, а постоянство сдвига — см. ниже;
 *   интерфейс DevTools   колонки, цвета строк, набор профилей запуском не проверяются вовсе.
 *
 * Сцена на 500 000 настоящих объектов строится ОДИН раз на файл: ~20 МБ и ~35 мс на обход.
 * Всё, что от размера не зависит, проверяется на маленьких сценах.
 */

/** Полный пример темы. Сцена одна, графа два: `applyVariant` правит настоящее поле. */
const scene = makeScene();
const oneWay = buildGraph(applyVariant(scene, false));
const twoWay = buildGraph(applyVariant(scene, true));

/** Числа в теме набраны с разделителями разрядов. */
const num = (value: string) => Number(value.replace(/\s/gu, ''));

/** Подпись строки таблицы темы → узел графа, который её считает. */
const ID: Record<string, string> = {
  '(closure) held': 'held',
  'system / Context': 'held-context',
  '(array) rows': 'rows',
  '(object elements)': 'rows-elements',
};

const rowsOf = (graph: ObjectGraph) => ladder(graph);
const rowOf = (graph: ObjectGraph, id: string) => rowsOf(graph).find((row) => row.id === id)!;

describe('восемь чисел удержания — литералы темы против обхода', () => {
  it('размер примера в теме и в сцене — один и тот же', () => {
    expect(DEFAULT_ROWS, 'тема разбирает массив на полмиллиона элементов').toBe(500_000);
    expect(HEAP_VARIANTS.map((v) => v.secondPath), 'вариантов ровно два: один путь и два').toEqual([false, true]);
  });

  for (const variant of HEAP_VARIANTS) {
    const graph = variant.secondPath ? twoWay : oneWay;

    for (const row of variant.rows.filter((r) => ID[r.c])) {
      it(`${variant.label}: ${row.c} → retained ${row.retained}`, () => {
        expect(retainedBy(graph, ID[row.c]).bytes).toBe(num(row.retained));
      });
    }

    it(`${variant.label}: shallow в таблице — тот же, что у узла`, () => {
      for (const row of variant.rows.filter((r) => ID[r.c])) {
        expect(nodeOf(graph, ID[row.c])?.shallow, row.c).toBe(num(row.shallow));
      }
    });

    it(`${variant.label}: строка Object — это вес ОДНОГО объекта из группы`, () => {
      // В таблице темы последняя строка — один экземпляр (retained 32), а в графе полмиллиона
      // одинаковых по форме объектов свёрнуты в узел `Object × 500 000`, как это делает Summary.
      // Сопоставимая величина здесь — вес одного, то есть `per`.
      const object = variant.rows.find((r) => r.c === 'Object')!;
      const group = rowOf(graph, 'rows-group');
      expect(group.per).toBe(num(object.retained));
      expect(group.count, 'объекты настоящие, и число настоящее').toBe(DEFAULT_ROWS);
    });

    it(`${variant.label}: ownedByClosure — это ровно то, что освободит удаление замыкания`, () => {
      const owned: Record<string, string> = {
        closure: 'held',
        context: 'held-context',
        array: 'rows',
        elements: 'rows-elements',
        objects: 'rows-group',
      };
      expect(retainedBy(graph, 'held').ids).toEqual(variant.ownedByClosure.map((key) => owned[key]));
    });
  }

  /**
   * ⚠️ Главное в этом блоке. Совпадение восьми чисел с литералами — ещё не гарантия: сойтись
   * они могли бы и случайно. Гарантия — в форме зависимости от размера, и вот она закрепляется
   * отдельно, на маленьких сценах, где число заведомо другое.
   */
  it('при одном пути ретейн замыкания линеен по числу элементов: 152 + 40 × N', () => {
    for (const rows of [3, 8, 1000]) {
      const graph = buildGraph(applyVariant(makeScene({ rows }), false));
      expect(retainedBy(graph, 'held').bytes, `rows = ${rows}`).toBe(152 + 40 * rows);
    }
    // 152 + 40 × 500 000 = 20 000 152 — то самое число темы, но уже как значение формулы.
    expect(retainedBy(oneWay, 'held').bytes).toBe(152 + 40 * DEFAULT_ROWS);
    expect(152 + 40 * DEFAULT_ROWS, 'слагаемые: 64 + 40 + 32 + (16 + 8N) + 32N').toBe(
      WEIGHTS.fn + WEIGHTS.scope + WEIGHTS.array + WEIGHTS.elementsHeader + (WEIGHTS.slot + WEIGHTS.object) * DEFAULT_ROWS,
    );
  });

  it('при двух путях ретейн замыкания равен 104 при ЛЮБОМ размере массива', () => {
    // Вот это и есть содержание раздела: под замыканием висят те же мегабайты, но байты
    // принадлежат уже не ему. 104 = 64 (функция) + 40 (её контекст) — и больше ничего.
    for (const rows of [3, 8, 1000, 50_000]) {
      const graph = buildGraph(applyVariant(makeScene({ rows }), true));
      expect(retainedBy(graph, 'held').bytes, `rows = ${rows}`).toBe(WEIGHTS.fn + WEIGHTS.scope);
    }
    expect(retainedBy(twoWay, 'held').bytes).toBe(104);
    expect(retainedBy(twoWay, 'held-context').bytes, 'контекст держит только сам себя').toBe(40);
  });

  it('массив держит одно и то же в обоих вариантах: сменился владелец, а не содержимое', () => {
    expect(retainedBy(oneWay, 'rows').bytes).toBe(retainedBy(twoWay, 'rows').bytes);
    expect(retainedBy(oneWay, 'rows').objects, 'массив плюс полмиллиона элементов').toBe(500_001);
  });

  it('HEAP_NODES: подписи shallow совпадают с весами узлов', () => {
    const pairs: [string, string][] = [
      ['closure', 'held'],
      ['context', 'held-context'],
      ['array', 'rows'],
      ['elements', 'rows-elements'],
    ];
    for (const [nodeId, graphId] of pairs) {
      const label = HEAP_NODES.find((n) => n.id === nodeId)!.shallow;
      expect(num(label.replace(/shallow|B/gu, '')), nodeId).toBe(nodeOf(oneWay, graphId)?.shallow);
    }
    expect(HEAP_NODES.find((n) => n.id === 'objects')!.shallow, 'вес одного объекта в группе').toBe(
      `shallow ${rowOf(oneWay, 'rows-group').per} B каждый`,
    );
    expect(HEAP_NODES.find((n) => n.id === 'window')!.shallow, 'у корня веса нет: он не объект').toBe('GC root');
    expect(nodeOf(oneWay, 'root')?.shallow).toBe(0);
  });
});

describe('критерий починки — ноль, а не «стало лучше» (PITFALLS 04)', () => {
  it('тонкое место про критерий починки на месте — иначе этот блок сторожит воздух', () => {
    // Ищем по смыслу, а не по номеру: номера тонких мест уже менялись («5.4» → «04»).
    expect(PITFALLS.find((p) => p.t.includes('Критерий починки'))?.t).toContain('ноль');
  });

  /** Два разрыва в порядке демо: сперва путь через замыкание, потом вторая ссылка от корня. */
  const cuts = (graph: ObjectGraph, pairs: [string, string][]) =>
    pairs.map(([from, to]) => ({ edge: edgeBetween(graph, from, to)!.id, what: `${from} → ${to}` }));

  it('при двух путях первый разрыв освобождает РОВНО ноль, и объект остаётся достижим', () => {
    const steps = repairProbe(
      twoWay,
      'rows',
      cuts(twoWay, [
        ['held-context', 'rows'],
        ['root', 'rows'],
      ]),
    );

    expect(steps).toHaveLength(2);

    // Не «мало», не «меньше, чем было» — ноль. Ровно об этом тонкое место: после такой правки
    // #Delta уменьшается, а утечка остаётся.
    expect(steps[0].freed, 'разорван показанный путь — не освободилось ничего').toEqual({
      bytes: 0,
      nodes: 0,
      objects: 0,
    });
    expect(steps[0].reachable, 'массив по-прежнему достижим от корня').toBe(true);
    expect(steps[0].cutLabel, 'имя ссылки собрано обходом').toBe('rows in system / Context');

    expect(steps[1].reachable, 'после второго разрыва путей не осталось').toBe(false);
    expect(steps[1].freed).toEqual({ bytes: 20_000_048, nodes: 3, objects: 500_001 });
    expect(steps[1].freedTotal, 'всё освободил второй разрыв, первый — ничего').toEqual(steps[1].freed);
  });

  it('при одном пути тот же первый разрыв освобождает всё сразу', () => {
    const steps = repairProbe(oneWay, 'rows', cuts(oneWay, [['held-context', 'rows']]));

    expect(steps[0].reachable).toBe(false);
    expect(steps[0].freed).toEqual({ bytes: 20_000_048, nodes: 3, objects: 500_001 });
    // Освобождается ровно то, что за узлом и числилось.
    expect(steps[0].freed.bytes).toBe(retainedBy(oneWay, 'rows').bytes);
  });

  it('второй ссылки в графе одного пути нет вовсе — рвать нечего', () => {
    expect(edgeBetween(oneWay, 'root', 'rows')).toBeNull();
    expect(edgeBetween(twoWay, 'root', 'rows')?.label).toBe('rowsAlso in Window');
    expect(retainers(oneWay, 'rows')).toHaveLength(1);
    expect(retainers(twoWay, 'rows'), 'две входящие ссылки — это и есть развилка').toHaveLength(2);
  });

  it('то же самое на оторванном узле: у Chart два держателя, и первый разрыв бесплатен', () => {
    // Сцена держит Chart дважды — списком слушателей и записью в Map. Это не выдумка ради теста:
    // так же устроен пример темы, где «снял подписку» не помогает, пока жива вторая ссылка.
    const steps = repairProbe(
      oneWay,
      'canvas',
      cuts(oneWay, [
        ['registry', 'chart'],
        ['listeners-elements', 'on-resize'],
      ]),
    );

    expect(steps[0].freed.bytes, 'убрали запись из Map — узел жив через слушателя').toBe(0);
    expect(steps[0].reachable).toBe(true);
    expect(steps[1].reachable, 'сняли подписку — путей больше нет').toBe(false);
    expect(steps[1].freed.bytes, 'onResize + его контекст + Chart + canvas').toBe(
      WEIGHTS.fn + WEIGHTS.scope + WEIGHTS.chart + WEIGHTS.canvas,
    );
  });
});

describe('доминатор и путь удержания', () => {
  it('при двух путях байты массива уезжают к Window — как и сказано в теме', () => {
    expect(nodeOf(twoWay, immediateDominator(twoWay, 'rows')!)?.label).toBe('Window');
    expect(rowOf(twoWay, 'rows').dominator).toBe('Window');
    expect(HEAP_VARIANTS[1].dominator, 'литерал темы называет того же').toMatch(/^Window/u);
  });

  it('при одном пути вся цепочка доминируется замыканием', () => {
    // В теме это сказано словами «(closure) held — под ним вся цепочка». Ближайший доминатор
    // массива при этом `system / Context`: «под ним» и «прямо под ним» — разные утверждения,
    // и верно здесь первое.
    expect(HEAP_VARIANTS[0].dominator).toContain('(closure) held');
    for (const id of ['held-context', 'rows', 'rows-elements', 'rows-group']) {
      expect(dominatorsOf(oneWay, id), id).toContain('held');
    }
    expect(nodeOf(oneWay, immediateDominator(oneWay, 'rows')!)?.label).toBe('system / Context');
  });

  it('кратчайший путь к массиву при двух путях — прямая ссылка от корня', () => {
    expect(shortestPath(twoWay, 'rows').map((s) => s.edge)).toEqual(['', 'rowsAlso in Window']);
    expect(shortestPath(oneWay, 'rows').map((s) => s.edge)).toEqual([
      '',
      'held in Window',
      'context in held',
      'rows in system / Context',
    ]);
    expect(allPaths(twoWay, 'rows'), 'путей два, а панель показывает один').toHaveLength(2);
  });

  it('имена звеньев цепочки CHAINS собраны обходом, а не взяты из данных', () => {
    const labels = new Set(oneWay.edges.map((edge) => edge.label));
    // Эти три строки лежали в теме литералами. Теперь каждая — следствие настоящей ссылки:
    // ключ объекта, индекс в массиве, ключ коллекции.
    expect(labels).toContain('el in Chart');
    expect(labels).toContain('3 in (array)');
    expect(labels).toContain('chart in Map');
    expect(labels).toContain('Chart in system / Context');

    const chain = CHAINS[0].nodes.map((node) => node.t.trim().replace(/^└─\s*/u, ''));
    for (const link of ['el in Chart', 'Chart in system / Context', '3 in (array)']) {
      expect(chain, `«${link}» есть и в теме, и в обходе`).toContain(link);
    }
  });

  it('полный путь темы существует в графе — но кратчайшим DevTools покажет не его', () => {
    const routes = allPaths(oneWay, 'canvas');
    expect(routes, 'до оторванного узла ведут два независимых пути').toHaveLength(2);

    const long = routes.find((route) => route.length > 4)!;
    expect(long.map((step) => step.edge)).toEqual([
      '',
      'listeners in Window',
      'elements',
      '3 in (array)',
      'context in onResize',
      'Chart in system / Context',
      'el in Chart',
    ]);

    // А `shortestPath` — то, что показывает панель, — идёт через Map, мимо всей цепочки темы.
    // Это не дефект: ровно поэтому «разорвал показанный путь» и «починил» — разные вещи.
    expect(shortestPath(oneWay, 'canvas').map((step) => step.edge)).toEqual([
      '',
      'registry in Window',
      'chart in Map',
      'el in Chart',
    ]);
  });

  it('⚠️ `listeners in EventListener` смоделировать нечем, и подделки в графе нет', () => {
    // В теме предпоследнее звено названо `listeners in EventListener`: `EventListener` —
    // внутренний владелец DevTools, у которого в JS нет ни имени, ни представителя. Обход
    // честно даёт `listeners in Window`. Проверка сторожит именно отсутствие подделки.
    const chain = CHAINS[0].nodes.map((node) => node.t.trim().replace(/^└─\s*/u, ''));
    expect(chain, 'в тексте темы звено осталось как в панели').toContain('listeners in EventListener');
    expect(oneWay.edges.map((edge) => edge.label)).not.toContain('listeners in EventListener');
    expect(oneWay.edges.map((edge) => edge.label)).toContain('listeners in Window');
  });
});

describe('слабая коллекция непроходима в принципе', () => {
  it('спросить её нельзя ничем, кроме `has` с ключом в руках', () => {
    const probe = weakProbe(scene);

    expect(probe.keys, '`Object.keys` не отдаёт ничего').toBe(0);
    expect(probe.ownNames, 'и собственных имён нет').toBe(0);
    expect(probe.hasSize, '`size` у слабой коллекции нет').toBe(false);
    expect(probe.iterable, 'итератора тоже нет').toBe(false);
    expect(probe.hasEntry, 'при этом `chart` в ней лежит — и это видно только по `has`').toBe(true);
  });

  it('поэтому путь удержания через WeakMap не строится — ни этим обходом, ни любым другим', () => {
    expect(Reflect.ownKeys(scene.weak), 'перечислять нечего по определению').toHaveLength(0);
    expect(oneWay.edges.filter((edge) => edge.from === 'weak-meta'), 'из узла не выходит ни одного ребра').toHaveLength(
      0,
    );
    expect(oneWay.opaque.map((item) => item.from), 'обход отметил, что дальше не пошёл').toEqual(['weak-meta']);

    // Chart достижим — но не через слабую таблицу.
    expect(shortestPath(oneWay, 'chart').map((step) => step.id)).not.toContain('weak-meta');
  });
});

describe('два расхождения с таблицей темы — посчитанное против записанного', () => {
  /**
   * ⚠️ Расхождение первое: `Dist` в теме на единицу больше.
   *
   * Обход от `Window` даёт 1–5, в таблице стоит 2–6. Это не ошибка темы: DevTools отсчитывает
   * Distance от GC-корня, который лежит ВЫШЕ окна, а корень этой сцены — само окно. Сдвиг
   * постоянный, и закрепляется здесь именно он: величина колонки — реконструкция (о чём сказано
   * в `DISTANCE_CAVEAT`), а вот её постоянство относительно обхода — проверяемое свойство.
   */
  it('Dist темы ровно на один больше обхода — в обоих вариантах и во всех строках', () => {
    for (const variant of HEAP_VARIANTS) {
      const graph = variant.secondPath ? twoWay : oneWay;
      const dist = distances(graph);

      for (const row of variant.rows.filter((r) => ID[r.c])) {
        expect(num(row.dist) - dist.get(ID[row.c])!, `${variant.label}: ${row.c}`).toBe(1);
      }
      // Строка Object — это группа, и расстояние у неё своё.
      const object = variant.rows.find((r) => r.c === 'Object')!;
      expect(num(object.dist) - dist.get('rows-group')!, `${variant.label}: Object`).toBe(1);
    }
  });

  it('глубина отступа в таблице совпадает с деревом доминирования', () => {
    for (const variant of HEAP_VARIANTS) {
      const graph = variant.secondPath ? twoWay : oneWay;
      const base = variant.rows[0].depth;
      for (const row of variant.rows.filter((r) => ID[r.c])) {
        expect(rowOf(graph, ID[row.c]).depth - row.depth, `${variant.label}: ${row.c}`).toBe(
          rowOf(graph, ID[variant.rows[0].c]).depth - base,
        );
      }
    }
  });

  /**
   * Бывшее расхождение второе: «разрыв 19 999 984» складывал две разные строки.
   *
   * Тема писала, что на последней ступени правило «разница равна shallow вышестоящего» ломается:
   * 20 000 016 − 32 = 19 999 984. Но 20 000 016 — это ретейн узла `(object elements)`,
   * а 32 — вес ОДНОГО экземпляра из пятисот тысяч. Настоящая ступень под ним — узел
   * `Object × 500 000` с ретейном 16 000 000, и разница с родителем равна 4 000 016 —
   * то есть ровно shallow вышестоящего. Правило держится и здесь.
   *
   * Текст исправлен 2026-10-01 (`LADDER_TEXT`, `LADDER_FORK`): проверка ниже держит его числа
   * против обхода и не даёт вернуться «разрыву».
   */
  it('карточка «лестница»: ступени, их разницы и сумма под развилкой — из обхода', () => {
    const rows = rowsOf(oneWay);
    const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/gu, ' ');
    const chain = ['held', 'held-context', 'rows', 'rows-elements'];
    const stepsLine = chain.map((id) => fmt(retainedBy(oneWay, id).bytes)).join(' → ');
    expect(LADDER_TEXT, 'ступени в тексте — те же, что считает обход').toContain(stepsLine);

    const gaps = chain.slice(1).map((id) => rows.find((row) => row.id === id)!.gap);
    expect(LADDER_TEXT).toContain(gaps.join(', '));

    const elements = retainedBy(oneWay, 'rows-elements').bytes;
    const own = nodeOf(oneWay, 'rows-elements')!.shallow!;
    const group = rowOf(oneWay, 'rows-group');
    expect(own + group.per * group.count, 'сумма из карточки сходится').toBe(elements);
    expect(LADDER_FORK).toContain(`${fmt(elements)} = ${fmt(own)}`);
    expect(LADDER_FORK).toContain(`${fmt(group.count)} × ${group.per} (${fmt(group.per * group.count)})`);

    // Ради этой строки правка и делалась: «разрыв» складывал величины из разных строк.
    expect(LADDER_TEXT + LADDER_FORK).not.toContain('19 999 984');
  });

  it('карточка «сумма retained»: четыре ступени дают больше 76 МБ при структуре в 19 МБ', () => {
    const MB = 2 ** 20;
    const chain = ['held', 'held-context', 'rows', 'rows-elements'];
    const sum = chain.reduce((acc, id) => acc + retainedBy(oneWay, id).bytes, 0);
    expect(Math.floor(sum / MB)).toBe(76);
    expect(Math.floor(retainedBy(oneWay, 'held').bytes / MB)).toBe(19);
    expect(RETAINED_SUM_TEXT).toContain('больше 76 МБ');
    expect(RETAINED_SUM_TEXT).toContain('19 МБ');
  });

  it('правило лестницы держится на КАЖДОЙ ступени, включая последнюю', () => {
    const rows = rowsOf(oneWay);
    const chain = ['held-context', 'rows', 'rows-elements', 'rows-group'];

    for (const id of chain) {
      expect(rows.find((row) => row.id === id)!.ladderHolds, id).toBe(true);
    }

    const steps = chain.map((id) => rows.find((row) => row.id === id)!.gap);
    expect(steps, 'разницы равны shallow вышестоящих: 64, 40, 32, 4 000 016').toEqual([64, 40, 32, 4_000_016]);
    expect(steps[3]).toBe(nodeOf(oneWay, 'rows-elements')?.shallow);

    // Откуда в тексте взялось 19 999 984: ретейн `(object elements)` минус вес одного объекта.
    // Величины из разных строк, поэтому и разрыв получился «на ровном месте».
    expect(retainedBy(oneWay, 'rows-elements').bytes - rowOf(oneWay, 'rows-group').per).toBe(19_999_984);
  });
});

describe('вся куча сцены сходится сама с собой', () => {
  it('сумма ретейнов по дереву доминирования не превышает размера кучи', () => {
    const total = weigh(oneWay, reachable(oneWay));
    expect(retainedBy(oneWay, 'held').bytes).toBeLessThan(total.bytes);
    expect(total.objects, 'полмиллиона элементов плюс полтора десятка объектов сцены').toBeGreaterThan(DEFAULT_ROWS);
    // Второе следствие из темы: сумма retained size по строкам списка больше кучи — потому что
    // одни и те же байты числятся за каждым из доминаторов цепочки.
    const chain = ['held', 'held-context', 'rows', 'rows-elements'];
    const sum = chain.reduce((acc, id) => acc + retainedBy(oneWay, id).bytes, 0);
    expect(sum, 'складывать этот столбец нельзя').toBeGreaterThan(total.bytes);
  });
});

/**
 * Раздел «Где снимок молчит», подраздел «Тот же вопрос из кода: протокол отладчика».
 *
 * Исполняется **та же строка**, что напечатана в теме, в отдельном процессе (`--input-type=module`,
 * иначе нет верхнеуровневого `await`). Ожидания берутся из самой строки — комментариев `// →`
 * по порядку, — так что правка примера правит и проверку. Таймеров здесь нет: ответ
 * детерминирован, потому что `Runtime.queryObjects` сам запускает сборку перед выборкой.
 */
describe('queryObjects из кода — пример исполняется, как напечатан', () => {
  const expected = [...QUERY_OBJECTS_CODE.matchAll(/\/\/ → (.+)$/gm)].map((m) => m[1].trim());
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', QUERY_OBJECTS_CODE], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  it('в примере есть что проверять', () => {
    expect(expected).toEqual(['20', 'undefined']);
  });

  it('вывод совпадает с комментариями примера', () => {
    expect(out).toEqual(expected);
  });
});

/**
 * Тот же пример, но цикл перенесён в тело модуля — для карточки «считать надо после того, как
 * завершилась функция». До 2026-10-01 там стояло «цикл в теле модуля — ответ на единицу больше»
 * без оговорок; запуск показал, что лишний объект держит только ПЕРЕМЕННАЯ в кадре модуля
 * (`const temp = new Chart()`), а голое `new Chart();` даёт честные 20.
 */
describe('queryObjects: лишний объект держит переменная в кадре модуля', () => {
  const run = (body: string) => {
    const code = QUERY_OBJECTS_CODE.replace(
      /function scenario\(\) \{\n[\s\S]*?\n\}\nfor \(let i = 0; i < 20; i\+\+\) scenario\(\);/u,
      `for (let i = 0; i < 20; i++) {\n  leaked.push(new Chart());\n  ${body}\n}`,
    );
    expect(code, 'подмена применилась — иначе проверяется исходный пример').not.toContain('scenario');
    return execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim().split('\n')[0];
  };

  it('`const temp = new Chart()` в теле модуля — 21', () => {
    expect(run('const temp = new Chart();')).toBe('21');
  });

  it('`new Chart();` без переменной в теле модуля — 20', () => {
    expect(run('new Chart();')).toBe('20');
  });
});

/**
 * Раздел «Снимок из Node»: «снять» и «прочитать» — склейка двух строк темы, исполненная как есть
 * во временной папке. Прежний комментарий к `node_fields` перечислял `trace_node_id`, которого
 * в обычном снимке нет; теперь список после `// →` сверяется с выводом.
 */
describe('снимок из Node — примеры исполняются, как напечатаны', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mp-snap-'));
  let out: string[] = [];
  try {
    out = execFileSync(process.execPath, ['--input-type=module', '-e', `${NODE_SNAPSHOT_CODE}\n${NODE_SNAPSHOT_READ}`], {
      encoding: 'utf8',
      cwd: dir,
      maxBuffer: 1 << 24,
    })
      .trim()
      .split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  it('путь к файлу — имя вида Heap.<дата>.<время>.<pid>.0.<n>.heapsnapshot', () => {
    expect(out[0]).toMatch(/^Heap\.\d{8}\.\d{6}\.\d+\.0\.\d{3}\.heapsnapshot$/u);
  });

  it('поля узла — те, что написаны в примере', () => {
    const fields = NODE_SNAPSHOT_READ.match(/\/\/ → (\[.+\])$/mu)![1];
    expect(out[1]).toBe(fields);
    expect(JSON.parse(fields), 'в обычном снимке поля trace_node_id нет').not.toContain('trace_node_id');
  });

  it('обход складывает вес объектов Object — число, а не ошибка', () => {
    expect(Number(out[2])).toBeGreaterThan(0);
  });
});

/**
 * Два утверждения раздела «Где снимок молчит» и таблицы флагов, снятые запуском 2026-10-01
 * (Node 24.11 и 26.8.2). Оба про то, ЧТО попадает в профиль, а не про время, — поэтому
 * детерминированы: брошенные объекты либо есть в профиле, либо их нет.
 */
describe('профили выделений в Node', () => {
  it('`--heap-prof` по умолчанию видит только дожившее до выхода, а не мусор', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-heapprof-'));
    try {
      const code = [
        'function garbage() { let x; for (let i = 0; i < 300000; i++) x = { a: i, b: [i] }; return x.a; }',
        'globalThis.kept = [];',
        'function keep() { for (let i = 0; i < 300000; i++) globalThis.kept.push({ a: i, b: [i] }); }',
        'garbage(); keep();',
      ].join('\n');
      execFileSync(process.execPath, ['--heap-prof', '--heap-prof-interval=256', '-e', code], { cwd: dir });
      const file = readdirSync(dir).find((name) => name.endsWith('.heapprofile'))!;
      const profile = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const bytes: Record<string, number> = {};
      const walk = (node: { callFrame: { functionName: string }; selfSize: number; children: unknown[] }) => {
        bytes[node.callFrame.functionName] = (bytes[node.callFrame.functionName] ?? 0) + node.selfSize;
        node.children.forEach((child) => walk(child as typeof node));
      };
      walk(profile.head);
      // Не ровно ноль: последний объект цикла может дожить до выборки (бывало 0, 568 и 928 Б).
      // Но из ~25 МБ, выделенных и брошенных функцией, в профиле остаются сотни байт.
      expect(bytes.garbage ?? 0, 'брошенные объекты в профиль почти не попали').toBeLessThan(64 * 1024);
      expect(bytes.keep ?? 0, 'живые — попали, мегабайтами').toBeGreaterThan(10 * 2 ** 20);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Таблица флагов говорит то же самое.
    // Прежде таблица флагов говорила обратное: «отвечает на „кто мусорит“».
    expect(NODE_FLAGS.find((row) => row[0] === '--heap-prof')![2]).toContain('«кто выделил живое», а не «кто мусорит»');
  });

  it('запись выделений есть и в Node: снимок в конце несёт и рёбра, и стеки выделений', () => {
    const code = `
      import { Session } from 'node:inspector/promises';
      const s = new Session(); s.connect();
      await s.post('HeapProfiler.enable');
      await s.post('HeapProfiler.startTrackingHeapObjects', { trackAllocations: true });
      class Leak {} const kept = [];
      function work() { for (let i = 0; i < 1000; i++) kept.push(new Leak()); }
      work();
      const chunks = [];
      s.on('HeapProfiler.addHeapSnapshotChunk', (m) => chunks.push(m.params.chunk));
      await s.post('HeapProfiler.stopTrackingHeapObjects', { reportProgress: false });
      s.disconnect();
      const snap = JSON.parse(chunks.join(''));
      const fi = snap.snapshot.meta.trace_function_info_fields;
      const names = [];
      for (let i = 0; i < snap.trace_function_infos.length; i += fi.length)
        names.push(snap.strings[snap.trace_function_infos[i + fi.indexOf('name')]]);
      console.log(JSON.stringify({
        edges: snap.snapshot.edge_count,
        traced: snap.snapshot.meta.node_fields.includes('trace_node_id'),
        work: names.includes('work'),
      }));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', maxBuffer: 1 << 26 }));
    expect(out.edges, 'граф с рёбрами — значит, retainers есть').toBeGreaterThan(0);
    expect(out.traced, 'у узлов есть ссылка на стек выделения').toBe(true);
    expect(out.work, 'и функция, выделившая объекты, в стеках записана').toBe(true);
  });
});
