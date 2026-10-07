import type { EnumHit, EnumOp, EnumRun, KeyKind } from './types';

/**
 * Кто что видит при перечислении — вызовом, а не таблицей.
 *
 * Объект один и тот же, категорий ключей пять, операций девять. Матрица из «✓» и «—» умела
 * сказать, что колонка «символы» у спреда закрашена, но не умела сказать **какие** символы:
 * у неё одна клетка на оба. Здесь клетки нет — есть список того, что вернулось, и рядом с
 * каждым ключом его категория. Разница между «перечислимый символ» и «символ вообще» перестаёт
 * быть сноской: `{ ...obj }` приносит `Symbol(id)` и не приносит `Symbol(hidden)`, это видно.
 *
 * Логика отделена от компонента по образцу `widgets/clone-survival`: чистые функции, ни DOM,
 * ни Vue, — тот же вызов доступен тесту. Булева клетка из урока выводится отсюда без пересчёта:
 * колонка закрашена тогда и только тогда, когда её категория встретилась среди `hits`.
 * Категорий здесь пять, а колонок в уроке четыре, потому что символ разделён на перечислимого
 * и неперечислимого — та самая тонкость, ради которой демо и сделано.
 */

const ID = Symbol('id');
const HIDDEN = Symbol('hidden');

const PROTO = { inherited: 'из прототипа' };

/**
 * Свежий подопытный на каждый вызов: операции его не портят, но одалживать объект между
 * прогонами — привычка, которая однажды ломает демо (см. `widgets/lock-lab`).
 *
 * Дескрипторы заданы ровно те, что показаны читателю в листинге: `writable` и `configurable`
 * остаются по умолчанию `false`, и на перечисление это не влияет никак — оно смотрит
 * только на `enumerable` и на тип ключа.
 */
const fresh = () =>
  Object.create(PROTO, {
    name: { value: 'Аня', enumerable: true },
    secret: { value: 'тайна', enumerable: false },
    [ID]: { value: 1, enumerable: true },
    [HIDDEN]: { value: 2, enumerable: false },
  }) as Record<string, unknown>;

export const SOURCE = [
  "const proto = { inherited: 'из прототипа' };",
  "const ID = Symbol('id');",
  "const HIDDEN = Symbol('hidden');",
  '',
  'const obj = Object.create(proto, {',
  "  name:     { value: 'Аня',   enumerable: true  },",
  "  secret:   { value: 'тайна', enumerable: false },",
  '  [ID]:     { value: 1,       enumerable: true  },',
  '  [HIDDEN]: { value: 2,       enumerable: false },',
  '});',
];

/** Категория определяется по имени ключа: других ключей у подопытного нет. */
const KIND: Record<string, KeyKind> = {
  name: 'own-enum',
  secret: 'own-hidden',
  'Symbol(id)': 'symbol-enum',
  'Symbol(hidden)': 'symbol-hidden',
  inherited: 'inherited',
};

export const KIND_LABEL: Record<KeyKind, string> = {
  'own-enum': 'строковый, перечислимый',
  'own-hidden': 'строковый, неперечислимый',
  'symbol-enum': 'символ, перечислимый',
  'symbol-hidden': 'символ, неперечислимый',
  inherited: 'унаследованный от прототипа',
};

/** Все пять категорий разом — легенда демо и заодно опись подопытного. */
export const KINDS: { kind: KeyKind; key: string }[] = [
  { kind: 'own-enum', key: 'name' },
  { kind: 'own-hidden', key: 'secret' },
  { kind: 'symbol-enum', key: 'Symbol(id)' },
  { kind: 'symbol-hidden', key: 'Symbol(hidden)' },
  { kind: 'inherited', key: 'inherited' },
];

export const OPS: { value: EnumOp; label: string }[] = [
  { value: 'for-in', label: 'for…in' },
  { value: 'keys', label: 'Object.keys' },
  { value: 'values', label: 'Object.values' },
  { value: 'spread', label: '{ ...obj }' },
  { value: 'assign', label: 'Object.assign' },
  { value: 'json', label: 'JSON.stringify' },
  { value: 'names', label: 'getOwnPropertyNames' },
  { value: 'symbols', label: 'getOwnPropertySymbols' },
  { value: 'ownKeys', label: 'Reflect.ownKeys' },
];

const CODE: Record<EnumOp, string> = {
  'for-in': 'for (const key in obj) …',
  keys: 'Object.keys(obj)',
  values: 'Object.values(obj)',
  spread: 'Reflect.ownKeys({ ...obj })',
  assign: 'Reflect.ownKeys(Object.assign({}, obj))',
  json: 'JSON.stringify(obj)',
  names: 'Object.getOwnPropertyNames(obj)',
  symbols: 'Object.getOwnPropertySymbols(obj)',
  ownKeys: 'Reflect.ownKeys(obj)',
};

const NOTE: Record<EnumOp, string> = {
  'for-in': 'Единственный, кто уходит в цепочку прототипов: `inherited` — не собственное свойство объекта. Неперечислимые и символы не видит.',
  keys: 'Собственные, строковые, перечислимые — и только они. `secret` отфильтрован по `enumerable`, символы — по типу ключа.',
  values: 'Тот же отбор, что у `Object.keys`, но возвращаются значения. Порядок гарантированно тот же, поэтому категорию каждого значения видно по его ключу.',
  spread: 'Спред копирует собственные **перечислимые** — и строки, и символы. `Symbol(id)` переехал, `Symbol(hidden)` нет: `enumerable` у символа работает ровно так же, как у строки.',
  assign: '`Object.assign` и спред отбирают ключи одинаково. Разница между ними в другом: `assign` пишет через `[[Set]]` и будит сеттеры приёмника, спред — через `[[DefineOwnProperty]]`.',
  json: 'Отбор как у `Object.keys`, плюс своё: символьный ключ не сериализуется в принципе — в JSON просто нет такого типа ключа.',
  names: 'Фильтрует по **типу ключа**, а не по `enumerable`: `secret` здесь есть. Символов не отдаёт вовсе.',
  symbols: 'Зеркало предыдущего: только символы, зато **все** — включая неперечислимый. Вот та самая тонкость колонки «символы»: у спреда это перечислимые символы, здесь — любые.',
  ownKeys: 'Полный ответ на вопрос «какие ключи есть у объекта»: строки, потом символы, невзирая на `enumerable`. Это и есть внутренний метод `[[OwnPropertyKeys]]`.',
};

const hit = (label: string): EnumHit => ({ label, kind: KIND[label] ?? 'own-enum' });

const asList = (items: string[]): string => `[ ${items.join(', ')} ]`;

export function runEnum(op: EnumOp): EnumRun {
  const obj = fresh();
  // Без начальных значений намеренно: ветки ниже покрывают все девять операций. Пустой массив
  // «на всякий случай» спрятал бы пропущенную ветку за правдоподобным ответом «ничего не вернулось».
  let hits: EnumHit[];
  let raw: string;

  if (op === 'for-in') {
    const seen: string[] = [];
    for (const key in obj) seen.push(key);
    hits = seen.map(hit);
    raw = asList(seen.map((key) => `'${key}'`));
  } else if (op === 'keys') {
    const keys = Object.keys(obj);
    hits = keys.map(hit);
    raw = asList(keys.map((key) => `'${key}'`));
  } else if (op === 'values') {
    // Значения парой к ключам: порядок `Object.values` спецификацией привязан к `Object.keys`,
    // поэтому категорию значения можно назвать честно, не подглядывая в сам объект.
    const keys = Object.keys(obj);
    const values = Object.values(obj);
    hits = values.map((value, i) => ({ label: JSON.stringify(value), kind: KIND[keys[i]] ?? 'own-enum' }));
    raw = asList(values.map((value) => JSON.stringify(value)));
  } else if (op === 'spread' || op === 'assign') {
    const copy = op === 'spread' ? { ...obj } : Object.assign({}, obj);
    const keys = Reflect.ownKeys(copy).map(String);
    hits = keys.map(hit);
    raw = asList(keys.map((key) => (key.startsWith('Symbol(') ? key : `'${key}'`)));
  } else if (op === 'json') {
    const json = JSON.stringify(obj) ?? 'undefined';
    // Разбираем обратно, чтобы показать ключи, которые до JSON доехали, — а не пересказать их.
    hits = Object.keys(JSON.parse(json) as Record<string, unknown>).map(hit);
    raw = json;
  } else if (op === 'names') {
    const names = Object.getOwnPropertyNames(obj);
    hits = names.map(hit);
    raw = asList(names.map((key) => `'${key}'`));
  } else if (op === 'symbols') {
    const symbols = Object.getOwnPropertySymbols(obj).map(String);
    hits = symbols.map(hit);
    raw = asList(symbols);
  } else {
    const keys = Reflect.ownKeys(obj).map(String);
    hits = keys.map(hit);
    raw = asList(keys.map((key) => (key.startsWith('Symbol(') ? key : `'${key}'`)));
  }

  return { code: CODE[op], hits, raw, note: NOTE[op] };
}
