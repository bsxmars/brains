import type { LockLevel, LockMode, LockOp, LockRun } from './types';

/**
 * Три уровня запирания вживую: операция выполняется по-настоящему, над свежим объектом.
 *
 * Зачем не таблица. Булева матрица отвечает «да/нет» — и этого ответа не хватает ровно там,
 * где тема интереснее всего: в sloppy-режиме «нет» выглядит как «да». Исключения не было,
 * строка выполнилась, программа поехала дальше — а свойство не появилось. Показать это можно
 * только рядом: слева отказ, справа объект, который не изменился.
 *
 * Логика вынесена из компонента по той же причине, что у `widgets/clone-survival`: демо
 * и тест обязаны спрашивать движок одинаково, иначе «проверено тестом» означало бы «проверено
 * что-то похожее». Здесь чистые функции без DOM и без Vue; `runLock(level, op, 'strict')`
 * воспроизводит ровно ту матрицу, что напечатана в уроке, — те же четыре уровня и те же
 * четыре операции в порядке колонок.
 *
 * ⚠️ **Свежий объект на каждый прогон — не аккуратность, а необходимость.** Замороженный
 * объект нельзя разморозить: если держать один экземпляр между прогонами, второй клик
 * по тому же сочетанию дал бы другой ответ, и демо начало бы врать.
 */

/** Подопытный: одно собственное свойство, чтобы было что удалять и переопределять. */
type Probe = Record<string, unknown>;

type Impl = (obj: Probe) => unknown;

const fresh = (level: LockLevel): Probe => {
  const obj: Probe = { a: 1 };
  if (level === 'preventExtensions') Object.preventExtensions(obj);
  if (level === 'seal') Object.seal(obj);
  if (level === 'freeze') Object.freeze(obj);
  return obj;
};

/**
 * Strict-половина. Этот файл — модуль, а модули всегда strict: отдельной директивы не нужно,
 * и приписать `'use strict'` было бы декорацией.
 */
const STRICT: Record<LockOp, Impl> = {
  add: (obj) => {
    obj.b = 2;
  },
  delete: (obj) => delete obj.a,
  write: (obj) => {
    obj.a = 99;
  },
  define: (obj) => Object.defineProperty(obj, 'a', { enumerable: false }),
};

/**
 * Sloppy-половина. Тело функции, собранной `new Function`, не наследует strict от модуля —
 * это единственный способ получить нестрогий код внутри ESM-сборки, и ровно поэтому он здесь.
 *
 * ⚠️ Функции собираются один раз, на загрузке модуля, — в том числе при серверном рендере
 * острова. В Node это работает так же, как в браузере, а CSP на сайте нет (страницы статические
 * и собственных заголовков не ставят), так что `new Function` доедет и до читателя.
 */
const SLOPPY: Record<LockOp, Impl> = {
  add: new Function('obj', 'obj.b = 2') as unknown as Impl,
  delete: new Function('obj', 'return delete obj.a') as unknown as Impl,
  write: new Function('obj', 'obj.a = 99') as unknown as Impl,
  define: new Function('obj', "return Object.defineProperty(obj, 'a', { enumerable: false })") as unknown as Impl,
};

export const LEVELS: { value: LockLevel; label: string }[] = [
  { value: 'plain', label: 'обычный' },
  { value: 'preventExtensions', label: 'preventExtensions' },
  { value: 'seal', label: 'seal' },
  { value: 'freeze', label: 'freeze' },
];

export const OPS: { value: LockOp; label: string }[] = [
  { value: 'add', label: 'добавить свойство' },
  { value: 'delete', label: 'удалить' },
  { value: 'write', label: 'изменить значение' },
  { value: 'define', label: 'переопределить дескриптор' },
];

export const MODES: { value: LockMode; label: string }[] = [
  { value: 'strict', label: 'strict' },
  { value: 'sloppy', label: 'sloppy' },
];

const LOCK_CALL: Record<LockLevel, string> = {
  plain: '// ничего не применяли',
  preventExtensions: 'Object.preventExtensions(obj);',
  seal: 'Object.seal(obj);',
  freeze: 'Object.freeze(obj);',
};

/**
 * Исходный текст операции — тот же, что исполняется.
 *
 * ⚠️ У «переопределить дескриптор» намеренно взят `{ enumerable: false }`, а не `{ value: 42 }`,
 * и это не мелочь. На запечатанном объекте `defineProperty(obj, 'a', { value: 42 })`
 * **проходит**: `seal` снимает только `configurable`, а `writable` остаётся, и смена значения
 * через дескриптор запрещённой не становится. Запрещено переопределение самого дескриптора —
 * вот его и пробуем, иначе строка «seal · дескриптор» показывала бы зелёное там, где вся
 * остальная тема говорит «нет».
 */
const OP_CODE: Record<LockOp, string> = {
  add: 'obj.b = 2;',
  delete: 'delete obj.a;',
  write: 'obj.a = 99;',
  define: "Object.defineProperty(obj, 'a', { enumerable: false });",
};

const MODE_CODE: Record<LockMode, string> = {
  strict: '// strict: код лежит в модуле',
  sloppy: "// sloppy: тело new Function('obj', …) strict не наследует",
};

/** Собственные свойства — списком «ключ: значение», как их напечатала бы консоль. */
const snapshot = (obj: Probe): string => {
  const keys = Reflect.ownKeys(obj).map(String);
  if (!keys.length) return '{}';
  return `{ ${keys.map((key) => `${key}: ${JSON.stringify(obj[key])}`).join(', ')} }`;
};

const descriptorOf = (obj: Probe): string => {
  const d = Object.getOwnPropertyDescriptor(obj, 'a');
  if (!d) return 'свойства a больше нет';
  return `value: ${JSON.stringify(d.value)} · writable: ${d.writable} · enumerable: ${d.enumerable} · configurable: ${d.configurable}`;
};

/**
 * Что вернула операция.
 *
 * Присваивание возвращает присвоенное значение, а не признак успеха, — поэтому по нему
 * нельзя понять, сработало ли. У `delete` признак есть, и в sloppy это единственное место,
 * где виден отказ: `false` вместо `true`.
 */
const returnedOf = (op: LockOp, value: unknown): string => {
  if (op === 'delete') return String(value);
  if (op === 'define') return 'сам объект';
  return 'присваивание не возвращает признак успеха';
};

export function runLock(level: LockLevel, op: LockOp, mode: LockMode): LockRun {
  const obj = fresh(level);
  const before = `${snapshot(obj)}|${descriptorOf(obj)}`;

  let threw = false;
  let errorName = '';
  let error = '';
  let returned = '';

  try {
    const value = (mode === 'strict' ? STRICT : SLOPPY)[op](obj);
    returned = returnedOf(op, value);
  } catch (caught) {
    threw = true;
    errorName = caught instanceof Error ? caught.name : 'Error';
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
  }

  const after = snapshot(obj);
  const descriptor = descriptorOf(obj);
  const changed = `${after}|${descriptor}` !== before;

  return {
    code: [`const obj = { a: 1 };`, LOCK_CALL[level], '', MODE_CODE[mode], OP_CODE[op]],
    threw,
    errorName,
    error,
    returned,
    after,
    descriptor,
    changed,
    tone: threw ? 'err' : changed ? 'ok' : 'warn',
    verdict: threw
      ? 'Отказ с исключением: строка не выполнилась, дальше код не поехал.'
      : changed
        ? 'Операция прошла: объект изменился.'
        : 'Отказ без исключения. Строка выполнилась, программа поехала дальше — а объект прежний.',
  };
}
