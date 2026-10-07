/**
 * Запись по-настоящему: код сценария исполняется над свежим `dog` из сквозного примера,
 * и всё, что демо печатает о результате, снято с живых объектов.
 *
 * Зачем (2026-10-03, замечание автора курса: «не совсем ясно, что выводится»). Раньше итог
 * сценария был фразой из `data.ts`, а узлы цепочки — подписями, набранными руками. По демо
 * нельзя было понять главного: бросила ли запись ошибку, что вернёт чтение после неё и появилось
 * ли у `dog` своё свойство. Теперь эти три ответа — вывод движка, в двух режимах рядом:
 * разница между «молча» и `TypeError` и есть то, на чём читатель спотыкается.
 *
 * Чистые функции без DOM и Vue, по образцу `widgets/lock-lab/model/run.ts`: демо и тест
 * спрашивают движок одним кодом.
 *
 * ⚠️ Свежий `dog` на каждый прогон обязателен: сценарии запрещают расширение и переопределяют
 * прототип, и общий экземпляр отдал бы следующему прогону уже испорченный объект.
 */

export type SetMode = 'sloppy' | 'strict';

/** Состояние ключа сценария на одном объекте цепочки. */
export interface KeyView {
  /** Собственные ключи объекта: `name · age · Symbol(id)`. */
  keys: string;
  /** Дескриптор ключа сценария на этом объекте или `null`, если своего ключа нет. */
  desc: string | null;
  /**
   * `Object.isExtensible` — третья причина отказа, и единственная, что смотрит не в цепочку,
   * а в сам объект. Без неё сценарий «новые ключи запрещены» показывал бы отказ без причины.
   */
  extensible: boolean;
}

export interface SetRun {
  /** Текст исключения или `null`, если запись не бросила. */
  error: string | null;
  /** `dog[key]` сразу после записи. */
  read: string;
  /** Объект и его прототип после записи. */
  object: KeyView;
  proto: KeyView;
}

export interface SetSnapshot {
  /** Объект и прототип до записи — после всех строк сценария, кроме последней. */
  before: { object: KeyView; proto: KeyView };
  sloppy: SetRun;
  strict: SetRun;
}

/** Значение так, как его напечатала бы консоль: строки в кавычках, функции — `ƒ`. */
export const show = (v: unknown): string => {
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'function') return 'ƒ';
  if (typeof v === 'symbol') return v.toString();
  return String(v);
};

/** Дескриптор в том порядке полей, в каком его печатает `Object.getOwnPropertyDescriptor`. */
export const showDesc = (d: PropertyDescriptor | undefined): string | null => {
  if (!d) return null;
  const head = 'value' in d ? `value: ${show(d.value)}, writable: ${d.writable}` : `get: ${show(d.get)}, set: ${show(d.set)}`;
  return `{ ${head}, enumerable: ${d.enumerable}, configurable: ${d.configurable} }`;
};

const view = (o: object, key: string): KeyView => ({
  keys: Reflect.ownKeys(o).map((k) => (typeof k === 'symbol' ? k.toString() : k)).join(' · '),
  desc: showDesc(Object.getOwnPropertyDescriptor(o, key)),
  extensible: Object.isExtensible(o),
});

type Probe = { dog: Record<string, unknown>; proto: object; error: unknown };

/**
 * Собирает пример и сценарий в одну функцию. Тело `new Function` не наследует strict
 * от модуля, поэтому нестрогий режим получается только так; строгий — директивой в начале.
 * Ошибка ловится внутри: сценарий мог её бросить, а объекты нужны и после неё.
 */
const exec = (sample: string, code: string, mode: SetMode): Probe =>
  new Function(
    `${mode === 'strict' ? '"use strict";\n' : ''}${sample}
let error = null;
try {
${code}
} catch (e) { error = e; }
return { dog, proto: Object.getPrototypeOf(Object.getPrototypeOf(dog)), error };`,
  )() as Probe;

const run = (sample: string, code: string, key: string, mode: SetMode): SetRun => {
  const p = exec(sample, code, mode);
  return {
    error: p.error ? String(p.error) : null,
    read: show(p.dog[key]),
    object: view(p.dog, key),
    proto: view(p.proto, key),
  };
};

/**
 * Прототип — `Animal.prototype`, то есть второе звено цепочки `dog`: первое — `Dog.prototype`,
 * где ключей сценариев нет. Демо рисует два узла, `dog` и `Animal.prototype`, и снимает их же.
 */
export const runSet = (sample: string, code: string, key: string): SetSnapshot => {
  const setup = code.split('\n').slice(0, -1).join('\n');
  const b = exec(sample, setup, 'strict');
  if (b.error) throw b.error;
  return {
    before: { object: view(b.dog, key), proto: view(b.proto, key) },
    sloppy: run(sample, code, key, 'sloppy'),
    strict: run(sample, code, key, 'strict'),
  };
};
