import { describeThis } from './describe';
import { THIS_CASES } from './cases';
import type { SloppyRun, ThisCase, ThisCaseKey, ThisRun, ThisVerdict } from './types';

/**
 * Восемь случаев `this` — выполнением, а не таблицей.
 *
 * Раздел целиком состоит из утверждений о семантике: «здесь потеряется», «здесь придёт
 * элемент», «здесь уцелеет». Держать их строками в `data.ts` значит поверить автору на слово
 * и разойтись с движком молча. Поэтому каждый случай здесь исполняется по-настоящему, а в
 * `this` заглядывает сам подопытный метод и записывает то, что ему пришло.
 *
 * Логика вынесена из компонента по правилу курса (`AGENTS.md`, «Таблицу о поведении языка
 * не набирают — её вычисляют»): юнит-тест импортирует **этот же** модуль, и демо с тестом
 * разойтись не могут.
 *
 * ⚠️ **Свежие классы и объекты на каждый прогон.** Случай с `bind` и случай с `handleEvent`
 * меняют состояние (счётчик, подписка); одолженный между прогонами экземпляр заставил бы демо
 * врать со второго клика по переключателю.
 *
 * ⚠️ **`document` трогается только внутри функций.** Остров сперва рендерится в Node, и
 * обращение к DOM на уровне модуля уронило бы сборку всей страницы, а не одно демо. Там, где
 * DOM недоступен, случай возвращает честную пометку — и тот же модуль спокойно читает
 * юнит-тест, прогоняя шесть не-DOM случаев.
 */

/** Что записал подопытный метод в момент вызова. Заполняется изнутри, а не снаружи. */
interface Seen {
  called: boolean;
  self: unknown;
  read: string;
  returned: string;
}

const seenBox = (): Seen => ({ called: false, self: undefined, read: '—', returned: '—' });

const NO_ERROR = { name: '', text: '' };

function errorOf(caught: unknown): { name: string; text: string } {
  if (caught instanceof Error) return { name: caught.name, text: `${caught.name}: ${caught.message}` };
  return { name: 'Error', text: String(caught) };
}

/** Длинные строки обрезаются: в слушателе аргументом приезжает событие, и оно печатается целиком. */
const clip = (text: string): string => (text.length > 48 ? `${text.slice(0, 48)}…` : text);

const fmt = (value: unknown): string => (value === undefined ? 'undefined' : JSON.stringify(value));

/**
 * Подопытный: класс с полем и методом на прототипе.
 *
 * Метод записывает `this` **до** обращения к полю — иначе в случае с оторванным методом
 * запись не случилась бы вовсе: строка `this.base` бросает раньше. А знать, что именно лежало
 * в `this`, надо как раз там.
 *
 * ⚠️ В оригинале метод делал `fetch(this.base + path)`. Здесь его нет намеренно: демо
 * исполняется по-настоящему, и сетевой запрос на каждый клик по переключателю — это сетевой
 * запрос на каждый клик по переключателю. Конкатенация показывает ровно то же самое: какой
 * адрес собрался бы.
 */
function apiProbe() {
  const seen = seenBox();

  class Api {
    base = '/v1';

    get(path: unknown): string {
      seen.called = true;
      seen.self = this;
      // Вот эта строка и ломается, когда `this` потерян: чтение свойства у `undefined`.
      const base = this.base;
      seen.read = `this.base → ${fmt(base)}`;
      const url = base + String(path);
      seen.returned = clip(url);
      return url;
    }
  }

  return { api: new Api(), seen };
}

/** Собрать ответ из того, что реально произошло. Ни одного поля «как должно было выйти». */
function shape(item: ThisCase, seen: Seen, owner: unknown, error: { name: string; text: string }, extra: Partial<ThisRun> = {}): ThisRun {
  const threw = error.name !== '';
  const isOwner = seen.called && seen.self === owner;
  const verdict: ThisVerdict = threw ? 'err' : isOwner ? 'ok' : 'warn';

  return {
    ...item,
    thisValue: seen.called ? describeThis(seen.self) : 'колбэк до `this` не дошёл',
    isOwner,
    lost: verdict !== 'ok',
    // Когда `this` потерян, чтение поля бросает раньше, чем успевает записаться: говорим об этом прямо.
    read: threw && seen.read === '—' ? 'обращение к this.base и бросило' : seen.read,
    returned: threw ? 'вызов до конца не дошёл' : seen.returned,
    errorName: error.name,
    error: error.text,
    verdict,
    sloppy: null,
    ranInDom: item.needsDom === true,
    extra: '',
    ...extra,
  };
}

/**
 * Случай, которому нужен DOM, в среде без DOM.
 *
 * Вердикт здесь — не результат прогона, и полагаться на него нельзя: `ranInDom: false` ровно
 * об этом и говорит. Юнит-тест такие случаи отфильтровывает по `needsDom`, как это сделано
 * в `clone-survival` с `browserOnly`.
 */
function domStub(item: ThisCase): ThisRun {
  return {
    ...item,
    thisValue: 'случай требует DOM — в этой среде его нет',
    isOwner: false,
    lost: false,
    read: '—',
    returned: '—',
    errorName: '',
    error: '',
    verdict: 'warn',
    sloppy: null,
    ranInDom: false,
    extra: 'Слушатель и `handleEvent` выполняются по-настоящему в браузере: там есть кого подписать и что кликнуть.',
  };
}

/**
 * Нестрогая половина первого случая.
 *
 * Тело функции, собранной `new Function`, не наследует strict от модуля — это единственный
 * способ получить нестрогий вызов внутри ESM-сборки, и ровно поэтому приём здесь. Без него
 * утверждение «в нестрогом коде пришёл бы глобальный объект» осталось бы словами: модули
 * и тела классов strict всегда.
 */
function tornSloppy(): SloppyRun {
  const seen = seenBox();

  const make = new Function(
    'seen',
    'return function get(path) {' +
      ' seen.called = true;' +
      ' seen.self = this;' +
      ' var base = this.base;' +
      ' seen.read = "this.base → " + (base === undefined ? "undefined" : JSON.stringify(base));' +
      ' var url = base + String(path);' +
      ' seen.returned = url;' +
      ' return url;' +
      ' }',
  ) as (box: Seen) => (path: unknown) => string;

  const holder = { base: '/v1', get: make(seen) };
  const torn = holder.get;

  let error = NO_ERROR;
  try {
    torn('/a');
  } catch (caught) {
    error = errorOf(caught);
  }

  return {
    thisValue: seen.called ? describeThis(seen.self) : '—',
    read: seen.read,
    returned: error.name ? error.text : seen.returned,
  };
}

/** Случай 1: метод оторван чтением свойства и отдан в `map`. */
function runTorn(item: ThisCase): ThisRun {
  const { api, seen } = apiProbe();

  let error = NO_ERROR;
  try {
    ['/a'].map(api.get);
  } catch (caught) {
    error = errorOf(caught);
  }

  return shape(item, seen, api, error, { sloppy: tornSloppy() });
}

/** Случай 2: то же самое, но оторвано деструктуризацией. */
function runDestructured(item: ThisCase): ThisRun {
  const { api, seen } = apiProbe();
  const { get } = api;

  let error = NO_ERROR;
  try {
    get('/a');
  } catch (caught) {
    error = errorOf(caught);
  }

  return shape(item, seen, api, error);
}

/**
 * Случай 3: слушатель DOM — по-настоящему.
 *
 * Элемент создаётся, слушатель вешается, клик диспатчится, слушатель снимается, элемент
 * выбрасывается. Ничего из этого в Node повторить нельзя — и это сильная сторона демо:
 * читатель видит настоящий `currentTarget`, а не рассказ о нём.
 *
 * ⚠️ Исключение внутри слушателя наружу не выходит — DOM сообщает о нём глобально, а
 * `dispatchEvent` продолжает работу. Поэтому результат берётся из записи, сделанной изнутри,
 * а не из возврата `el.click()`.
 */
function runListener(item: ThisCase): ThisRun {
  if (typeof document === 'undefined') return domStub(item);

  const { api, seen } = apiProbe();
  const el = document.createElement('button');
  const listener = api.get as unknown as EventListener;

  el.addEventListener('click', listener);
  el.click();
  el.removeEventListener('click', listener);

  return shape(item, seen, api, NO_ERROR, {
    extra: `Исключения не было вовсе: чтение \`base\` у элемента дало \`undefined\`, и адрес собрался строкой — \`${seen.returned}\`. Именно так молчаливая потеря \`this\` и превращается в запрос не туда.`,
  });
}

/** Случай 4: `bind`. Заодно проверяется, что привязку не отменить ни вторым `bind`, ни `call`. */
function runBind(item: ThisCase): ThisRun {
  const { api, seen } = apiProbe();
  const bound = api.get.bind(api);

  let error = NO_ERROR;
  try {
    ['/a'].map(bound);
  } catch (caught) {
    error = errorOf(caught);
  }

  // Привязка необратима — утверждение сильное, поэтому оно тоже проверяется, а не заявляется.
  const other = { base: '/OTHER' };
  const rebound = bound.bind(other);
  const afterRebind = describeThis(peek(() => rebound('/a'), seen));
  const afterCall = describeThis(peek(() => bound.call(other, '/a'), seen));
  const twice = api.get.bind(api) !== api.get.bind(api);

  return shape(item, seen, api, error, {
    extra: `Повторный \`bind\` дал \`${afterRebind}\`, \`call\` с чужим объектом — \`${afterCall}\`: привязку не перебить. И каждый \`bind\` возвращает новую функцию — \`api.get.bind(api) !== api.get.bind(api)\` → \`${String(twice)}\`, вот почему отписаться по такой ссылке нельзя.`,
  });
}

/** Выполнить выражение и вернуть то, что метод записал в `this`, не портя основной прогон. */
function peek(call: () => unknown, seen: Seen): unknown {
  const before = seen.self;
  try {
    call();
  } catch {
    // Нас интересует только записанный `this`; исключение здесь — часть ответа, а не помеха.
  }
  const captured = seen.self;
  seen.self = before;
  return captured;
}

/** Случай 5: стрелка в поле класса. */
function runArrowField(item: ThisCase): ThisRun {
  const seen = seenBox();

  class Api2 {
    base = '/v1';
    get = (path: unknown): string => {
      seen.called = true;
      seen.self = this;
      seen.read = `this.base → ${fmt(this.base)}`;
      const url = this.base + String(path);
      seen.returned = clip(url);
      return url;
    };
  }

  const api2 = new Api2();

  let error = NO_ERROR;
  try {
    ['/a'].map(api2.get);
  } catch (caught) {
    error = errorOf(caught);
  }

  const own = Object.hasOwn(api2, 'get');
  const onProto = 'get' in Api2.prototype;

  return shape(item, seen, api2, error, {
    extra: `Цена видна прямо в описании \`this\`: \`get\` — собственное свойство экземпляра (\`Object.hasOwn(api2, 'get')\` → \`${String(own)}\`), а на прототипе его нет (\`'get' in Api2.prototype\` → \`${String(onProto)}\`).`,
  });
}

/** Случай 6: стрелка-обёртка, внутри — обычный вызов с точкой. */
function runArrowWrapper(item: ThisCase): ThisRun {
  const { api, seen } = apiProbe();

  let error = NO_ERROR;
  try {
    ['/a'].map((path) => api.get(path));
  } catch (caught) {
    error = errorOf(caught);
  }

  return shape(item, seen, api, error);
}

/**
 * Какие методы принимают `thisArg` — перебором, а не списком из статьи.
 *
 * Проверка честная: колбэк обычный (не стрелка), помеченный объект передаётся вторым
 * аргументом, и в список «принимают» попадают только те методы, у которых он реально доехал
 * до `this`. Массив из двух элементов взят ради `sort`: на одном элементе компаратор
 * не вызывается вовсе, и вывод «`sort` не принимает» оказался бы получен из ничего.
 */
export function probeThisArgSupport(): { accepts: string[]; ignores: string[] } {
  type Probe = (this: unknown, ...args: unknown[]) => unknown;
  const mark = { mark: true };
  const accepts: string[] = [];
  const ignores: string[] = [];

  const runners: { name: string; run: (cb: Probe, thisArg: object) => void }[] = [
    { name: 'map', run: (cb, t) => void ([2, 1] as unknown[]).map(cb, t) },
    { name: 'forEach', run: (cb, t) => void ([2, 1] as unknown[]).forEach(cb, t) },
    { name: 'filter', run: (cb, t) => void ([2, 1] as unknown[]).filter(cb, t) },
    { name: 'some', run: (cb, t) => void ([2, 1] as unknown[]).some(cb, t) },
    { name: 'every', run: (cb, t) => void ([2, 1] as unknown[]).every(cb, t) },
    { name: 'find', run: (cb, t) => void ([2, 1] as unknown[]).find(cb, t) },
    { name: 'findIndex', run: (cb, t) => void ([2, 1] as unknown[]).findIndex(cb, t) },
    { name: 'findLast', run: (cb, t) => void ([2, 1] as unknown[]).findLast(cb, t) },
    { name: 'findLastIndex', run: (cb, t) => void ([2, 1] as unknown[]).findLastIndex(cb, t) },
    { name: 'flatMap', run: (cb, t) => void ([2, 1] as unknown[]).flatMap(cb as (v: unknown, i: number, a: unknown[]) => unknown, t) },
    // У `reduce` второй аргумент — начальное значение, а не `thisArg`: слота под него нет.
    { name: 'reduce', run: (cb, t) => void ([2, 1] as unknown[]).reduce(cb as (p: unknown, c: unknown) => unknown, t) },
    { name: 'reduceRight', run: (cb, t) => void ([2, 1] as unknown[]).reduceRight(cb as (p: unknown, c: unknown) => unknown, t) },
    // `sort` принимает только компаратор — второй аргумент ему передаётся и молча игнорируется.
    { name: 'sort', run: (cb, t) => void (([2, 1] as unknown[]).sort as (...args: unknown[]) => unknown)(cb, t) },
    { name: 'Array.from', run: (cb, t) => void Array.from([2, 1], cb as (v: unknown, i: number) => unknown, t) },
  ];

  for (const item of runners) {
    let seen: unknown = null;
    const cb: Probe = function (this: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- поймать `this`, который подставил сам метод, и есть вся проверка: без записи наружу узнать, доехал ли `thisArg`, нечем
      seen = this;
      return 0;
    };
    try {
      item.run(cb, mark);
    } catch {
      // Метода может не быть в старом движке — тогда он честно уезжает в «не принимает».
    }
    (seen === mark ? accepts : ignores).push(item.name);
  }

  return { accepts, ignores };
}

/** Случай 7: `thisArg` вторым аргументом. */
function runThisArg(item: ThisCase): ThisRun {
  const { api, seen } = apiProbe();

  let error = NO_ERROR;
  try {
    ['/a'].map(api.get, api);
  } catch (caught) {
    error = errorOf(caught);
  }

  const support = probeThisArgSupport();

  return shape(item, seen, api, error, {
    extra: `Принимают \`thisArg\`: \`${support.accepts.join('`, `')}\`. Не принимают: \`${support.ignores.join('`, `')}\` — список собран перебором прямо сейчас, а не переписан из документации.`,
  });
}

/**
 * Случай 8: объект с `handleEvent` — по-настоящему, вместе с отпиской.
 *
 * Второй клик после `removeEventListener('click', widget)` нужен не для красоты: утверждение
 * «отписка по идентичности тривиальна» проверяется единственным способом — попробовать
 * отписаться и посмотреть, сработал ли слушатель ещё раз.
 */
function runHandleEvent(item: ThisCase): ThisRun {
  if (typeof document === 'undefined') return domStub(item);

  const seen = seenBox();

  class Widget {
    count = 0;

    handleEvent(): void {
      seen.called = true;
      seen.self = this;
      this.count += 1;
      seen.read = `this.count → ${String(this.count)}`;
      seen.returned = `счётчик на самом объекте: ${String(this.count)}`;
    }
  }

  const widget = new Widget();
  const el = document.createElement('button');

  el.addEventListener('click', widget);
  el.click();
  const afterFirst = widget.count;

  el.removeEventListener('click', widget);
  el.click();
  const afterRemove = widget.count;

  return shape(item, seen, widget, NO_ERROR, {
    extra: `После \`removeEventListener('click', widget)\` второй клик счётчик не тронул: было \`${String(afterFirst)}\`, осталось \`${String(afterRemove)}\`. Отписка по идентичности сработала — с \`.bind(this)\` она бы не сработала никогда.`,
  });
}

const RUNNERS: Record<ThisCaseKey, (item: ThisCase) => ThisRun> = {
  torn: runTorn,
  destructured: runDestructured,
  listener: runListener,
  bind: runBind,
  arrowField: runArrowField,
  arrowWrapper: runArrowWrapper,
  thisArg: runThisArg,
  handleEvent: runHandleEvent,
};

/** Выполнить один случай начисто. Свежие классы и объекты — на каждый вызов. */
export function runThisCase(key: ThisCaseKey): ThisRun {
  const item = THIS_CASES.find((candidate) => candidate.key === key) ?? THIS_CASES[0];
  return RUNNERS[item.key](item);
}

/** Все восемь разом — их и сверяет юнит-тест. */
export function runAllThisCases(): ThisRun[] {
  return THIS_CASES.map((item) => RUNNERS[item.key](item));
}
