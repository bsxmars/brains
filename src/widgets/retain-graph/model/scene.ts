import type { NodeKind } from './types';

/**
 * Настоящая структура объектов в памяти — та самая, о которой говорит урок.
 *
 * Здесь не рисунок графа и не данные о графе: здесь сам граф. `rows` — настоящий массив
 * настоящих объектов, `registry` — настоящая `Map`, `held` и `onResize` — настоящие функции
 * с настоящими замыканиями. Обход (`graph.ts`) спрашивает об этой структуре движок отражением,
 * а не читает заранее записанный список рёбер: добавление второго пути к массиву — это правка
 * настоящего объекта, после которой столбец Retained пересчитывается сам.
 *
 * ⚠️ **Две вещи пришлось объявить, и обе названы этим словом в графе.**
 *
 * 1. **Слоты замыкания из JS не интроспектируются.** Узнать, какие переменные захватила функция,
 *    со страницы нельзя ничем: ни `Object.keys` у функции, ни рефлексией, ни новым `Function`.
 *    Поэтому у каждой функции сцены есть ДВА представления захвата — настоящее (переменная,
 *    которую функция и правда держит) и объявленное (объект-скоуп в поле `scope` метки). В графе
 *    ребро «функция → `system / Context`» помечено `declared`. Это модель, а не ответ движка.
 * 2. **Вес объекта из JS не узнать никогда.** `sizeof` в JS нет. Все числа в `WEIGHTS` —
 *    объявленные, взятые из замера урока (Node 24.11.0, arm64, сборка БЕЗ сжатия указателей;
 *    в Chrome те же структуры примерно вдвое легче). Посчитанное здесь — это КОМУ байты
 *    принадлежат, а не сколько их.
 *
 * ⚠️ Сцена по умолчанию создаёт полмиллиона настоящих объектов — примерно 20 МБ в вашей вкладке.
 * Это тот самый пример урока, и снять с него снимок кучи можно прямо сейчас. Меньше нужно —
 * проп `rows` у виджета; структура графа от числа не зависит, зависят только байты.
 */

/** Метка настоящего объекта: как он выглядит в снимке и сколько объявлено его весить. */
export interface Tag {
  id: string;
  label: string;
  ref: string;
  kind: NodeKind;
  /** Объявленный собственный вес, байты. */
  shallow: number;
  /** Объявленная модель слота замыкания: настоящий захват из JS не виден. */
  scope?: object;
  note?: string;
}

export interface SceneOptions {
  /** Сколько настоящих объектов кладётся в массив. */
  rows: number;
}

/** Столько элементов в примере урока — и столько объектов создаётся по-настоящему. */
export const DEFAULT_ROWS = 500_000;

/**
 * Объявленные собственные веса, байты. Ни одно из этих чисел не измерено кодом виджета —
 * измерить их из JS нечем. Первые пять сняты в уроке настоящим heap snapshot, остальные
 * (`chart`, `canvas`, `map`) правдоподобны и нужны только для арифметики соседних узлов.
 */
export const WEIGHTS = {
  /** GC root в снимке веса не имеет: он не объект, а точка входа. */
  root: 0,
  /** `(closure)` — функция как объект. */
  fn: 64,
  /** `system / Context` — одна лексическая область со всеми захваченными переменными. */
  scope: 40,
  /** Сам `JSArray`, без содержимого. */
  array: 32,
  /** Заголовок служебного узла `(object elements)`. */
  elementsHeader: 16,
  /** Один указатель в `(object elements)`. Восемь байт — сборка без сжатия указателей. */
  slot: 8,
  /** `Object` с одним-двумя полями. */
  object: 32,
  chart: 40,
  canvas: 240,
  map: 96,
  weakmap: 96,
} as const;

/** Сцена: корень, настоящие объекты под ним и таблица меток. */
export interface Scene {
  root: Record<string, unknown>;
  rows: { id: number }[];
  chart: Record<string, unknown>;
  /** Слабая таблица сцены: в ней лежит метаданные `chart`, и увидеть это снаружи нельзя. */
  weak: WeakMap<object, unknown>;
  /** Метки живут в `WeakMap` — побочная таблица, которая сама ничего не удерживает. */
  tags: WeakMap<object, Tag>;
  options: SceneOptions;
}

/**
 * Построить сцену.
 *
 * Структура повторяет два случая урока разом: цепочка «замыкание → контекст → массив» и цепочка
 * «список слушателей → обработчик → контекст → Chart → оторванный узел». Второй объект сцены —
 * `Map` — держит тот же `Chart`, поэтому у оторванного узла с самого начала ДВА независимых
 * держателя: это и есть тонкое место «критерий починки — ноль», и оно теперь проверяется, а не
 * пересказывается.
 */
export function makeScene(options: Partial<SceneOptions> = {}): Scene {
  const count = Math.max(0, Math.floor(options.rows ?? DEFAULT_ROWS));
  const tags = new WeakMap<object, Tag>();
  const tag = <T extends object>(value: T, spec: Tag): T => {
    tags.set(value, spec);
    return value;
  };

  // Настоящий массив настоящих разных объектов. Именно `Array.from`, а не `.fill({ id: 0 })`:
  // `fill` вычислил бы аргумент однажды и положил в массив один объект пятьсот тысяч раз.
  const rows = tag(
    Array.from({ length: count }, (_, i) => ({ id: i })),
    { id: 'rows', label: '(array) rows', ref: '(array)', kind: 'array', shallow: WEIGHTS.array },
  );

  const heldScope = tag(
    { rows },
    { id: 'held-context', label: 'system / Context', ref: 'system / Context', kind: 'scope', shallow: WEIGHTS.scope },
  );

  // Функция настоящая и захват настоящий: `rows` она и правда держит. Видно это, увы, только
  // по объявленному `scope` — сам захват из JS не наблюдаем.
  const held = tag(
    function held() {
      return rows.length;
    },
    { id: 'held', label: '(closure) held', ref: 'held', kind: 'function', shallow: WEIGHTS.fn, scope: heldScope },
  );

  const canvas = tag(
    { tagName: 'CANVAS', width: 300, height: 150 },
    {
      id: 'canvas',
      label: 'Detached HTMLCanvasElement',
      ref: 'HTMLCanvasElement',
      kind: 'object',
      shallow: WEIGHTS.canvas,
      note: 'Модель оторванного узла: остров сперва рендерится в Node, а DOM там нет вовсе.',
    },
  );

  const chart = tag(
    { el: canvas, title: 'выручка' },
    { id: 'chart', label: 'Chart', ref: 'Chart', kind: 'object', shallow: WEIGHTS.chart },
  );

  const resizeScope = tag(
    { Chart: chart },
    {
      id: 'on-resize-context',
      label: 'system / Context',
      ref: 'system / Context',
      kind: 'scope',
      shallow: WEIGHTS.scope,
    },
  );

  const onResize = tag(() => chart.el, {
    id: 'on-resize',
    label: '(closure) onResize',
    ref: 'onResize',
    kind: 'function',
    shallow: WEIGHTS.fn,
    scope: resizeScope,
  });

  // Три безымянных слушателя до нашего — чтобы индекс в списке был настоящим, а не написанным.
  const noop = (n: number) =>
    tag(() => n, { id: `noop-${n}`, label: '(closure) ()', ref: '()', kind: 'function', shallow: WEIGHTS.fn });

  const listeners = tag([noop(0), noop(1), noop(2), onResize], {
    id: 'listeners',
    label: '(array) listeners',
    ref: '(array)',
    kind: 'array',
    shallow: WEIGHTS.array,
  });

  const registry = tag(new Map<string, object>([['chart', chart]]), {
    id: 'registry',
    label: 'Map',
    ref: 'Map',
    kind: 'map',
    shallow: WEIGHTS.map,
  });

  const weak = tag(new WeakMap<object, unknown>([[chart, { hits: 0 }]]), {
    id: 'weak-meta',
    label: 'WeakMap',
    ref: 'WeakMap',
    kind: 'weakmap',
    shallow: WEIGHTS.weakmap,
  });

  const root = tag(
    { held, listeners, registry, weakMeta: weak } as Record<string, unknown>,
    { id: 'root', label: 'Window', ref: 'Window', kind: 'root', shallow: WEIGHTS.root },
  );

  return { root, rows, chart, weak, tags, options: { rows: count } };
}

/**
 * Включить или выключить второй путь к массиву — настоящей правкой настоящего объекта.
 *
 * Ради этой одной строки виджет и написан: столбец Retained после неё не выбирается из второй
 * таблицы, а пересчитывается обходом, потому что у массива действительно стало два держателя.
 */
export function applyVariant(scene: Scene, secondPath: boolean): Scene {
  if (secondPath) scene.root.rowsAlso = scene.rows;
  else delete scene.root.rowsAlso;
  return scene;
}

/** Чем доказывается, что содержимое слабой коллекции невидимо. Всё посчитано, не заявлено. */
export interface WeakProbe {
  /** Сколько ключей отдаёт `Object.keys`. */
  keys: number;
  /** Сколько собственных свойств видит `getOwnPropertyNames`. */
  ownNames: number;
  /** Есть ли у слабой коллекции `size`. */
  hasSize: boolean;
  /** Итерируется ли она. */
  iterable: boolean;
  /** Спросить можно только одно — «а этот ключ там есть?», и только имея ключ в руках. */
  hasEntry: boolean;
}

/**
 * Проверить слабую коллекцию всеми способами, какими её вообще можно спросить.
 *
 * Отсюда следствие для темы, которое сильнее любой картинки: путь удержания через `WeakMap`
 * не строится в принципе — не потому, что демо не умеет, а потому, что перечислить содержимое
 * слабой коллекции нельзя по определению. Сборщик его видит, страница — нет.
 */
export function weakProbe(scene: Scene): WeakProbe {
  const weak = scene.weak as unknown as Record<PropertyKey, unknown>;
  return {
    keys: Object.keys(weak).length,
    ownNames: Object.getOwnPropertyNames(weak).length,
    hasSize: 'size' in weak,
    iterable: typeof weak[Symbol.iterator] === 'function',
    hasEntry: scene.weak.has(scene.chart),
  };
}
