import type { KeyPreset, KeyGroup, OrderRun, OrderedKey } from './types';

/**
 * Порядок ключей — сборкой настоящего объекта, а не пересказом правила.
 *
 * Правило в три строки («индексы по возрастанию, остальные строки по добавлению, символы
 * в конце») читается как очевидное — ровно до первой ловушки. `'01'` выглядит индексом
 * и им не является, `'4294967294'` индекс, а `'4294967295'` уже нет. Проверить это можно
 * одним способом: набрать ключи и посмотреть, что вернёт движок.
 *
 * Логика живёт отдельно от компонента — как в `widgets/clone-survival`: здесь чистые функции
 * без DOM и без Vue, и тест может спросить движок ровно тем же вызовом, каким его спрашивает
 * страница. Заготовка «как в уроке» не случайно совпадает с литералом из текста: значения
 * раздаются по позиции (`1…6`), поэтому `buildOrder('b, 3, a, 1, 2, Symbol(s)').json` — это
 * дословно тот JSON, что напечатан в уроке.
 *
 * ⚠️ Ввод читателя разбирается **без `eval`**. Никакого исполнения кода: список имён через
 * запятую, объект собирается присваиванием. Единственное расширение синтаксиса — `Symbol(имя)`,
 * и оно тоже разбирается регулярным выражением, а не движком.
 */

/** `Symbol(id)` в списке — это просьба завести символ, а не строковый ключ с таким текстом. */
const SYMBOL_TOKEN = /^Symbol\(([^)]*)\)$/;

/** Кавычки вокруг ключа необязательны, но привычны: `'01'` и `01` — одно и то же. */
const stripQuotes = (token: string): string =>
  (token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))
    ? token.slice(1, -1)
    : token;

/**
 * Целочисленный индекс по спецификации: каноническая запись неотрицательного целого,
 * строго меньше 2³²−1.
 *
 * `String(n) === key` — и есть та самая каноничность, из-за которой `'01'`, `'1.0'`, `'+1'`
 * и `'1e2'` индексами не считаются: движок сравнивает с записью числа, а не разбирает строку
 * в число и обратно.
 */
export const isArrayIndex = (key: string): boolean => {
  const n = Number(key);
  return Number.isInteger(n) && n >= 0 && n < 2 ** 32 - 1 && String(n) === key;
};

const groupOf = (key: string | symbol): KeyGroup =>
  typeof key === 'symbol' ? 'symbol' : isArrayIndex(key) ? 'index' : 'string';

export const GROUP_LABEL: Record<KeyGroup, string> = {
  index: 'целочисленные индексы — по возрастанию',
  string: 'остальные строки — в порядке добавления',
  symbol: 'символы — в порядке добавления',
};

export const PRESETS: KeyPreset[] = [
  {
    label: 'как в уроке',
    keys: 'b, 3, a, 1, 2, Symbol(s)',
    note: 'Литерал набран вперемешку — объект пересобрал его в три группы.',
  },
  {
    label: 'похожи на индексы',
    keys: '01, 1.0, -1, +1, 1e2, 1, 2',
    note: 'Индексами оказались только `1` и `2`. Остальные пять — обычные строки: индекс должен быть записан так, как число напечатал бы сам JavaScript.',
  },
  {
    label: 'граница 2³²−1',
    keys: '4294967295, 4294967294, 0',
    note: '`4294967295` — это 2³²−1, и оно уже **не** индекс: границу спецификация проводит строго до него. Соседнее `4294967294` — ещё индекс.',
  },
  {
    label: 'символы в начале',
    keys: 'Symbol(s), b, 3, Symbol(t), 1',
    note: 'Символы набраны первыми, а встали последними: место группы не зависит от порядка добавления.',
  },
  {
    label: 'знакомая ловушка',
    keys: 'id, __proto__, 10, 9',
    note: '`__proto__` у литерала и присваивания — не ключ, а сеттер прототипа: свойства с таким именем не появилось вовсе.',
  },
];

export function buildOrder(input: string): OrderRun {
  const typed = input
    .split(/[,\n]/)
    .map((token) => stripQuotes(token.trim()))
    .filter(Boolean);

  const obj: Record<string, unknown> = {};

  typed.forEach((token, i) => {
    const asSymbol = SYMBOL_TOKEN.exec(token);
    if (asSymbol) {
      // Символ с тем же описанием, набранный дважды, — это два разных ключа: описание
      // не идентичность. Поэтому свой экземпляр на каждую позицию в списке.
      (obj as Record<symbol, unknown>)[Symbol(asSymbol[1])] = i + 1;
      return;
    }
    obj[token] = i + 1;
  });

  const keys: OrderedKey[] = Reflect.ownKeys(obj).map((key) => {
    const raw = String(key);
    return {
      key: raw,
      label: typeof key === 'symbol' ? raw : `'${raw}'`,
      group: groupOf(key),
      // Первое вхождение: повторное присваивание нового свойства не создаёт и места не меняет.
      typedAt: typed.indexOf(raw) + 1,
    };
  });

  const present = new Set(keys.map((key) => key.key));
  const missing = [...new Set(typed.filter((token) => !present.has(token)))];

  return { typed, keys, json: JSON.stringify(obj), missing };
}
