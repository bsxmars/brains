/**
 * Один ключ — три хранилища: обычный объект, `Object.create(null)` и `Map`.
 *
 * Каждое хранилище проходит одни и те же три шага: прочитать ключ в пустом хранилище,
 * записать под ним значение, прочитать «похожим» ключом — тем, что выглядит так же, но
 * может оказаться другим (`'1'` вместо `1`, второй литерал `{ id: 7 }`). Шаги — настоящий код,
 * собранный строкой: он же печатается читателю, и он же исполняется `new Function`.
 *
 * Чистые функции без DOM и Vue: демо и `tests/unit/collections.test.ts` зовут их одинаково.
 */

export interface KeyChoice {
  value: string;
  label: string;
  /** Выражение ключа, как оно стоит в коде. */
  expr: string;
  /** Выражение «похожего» ключа для третьего шага. */
  alike: string;
}

export const KEYS: KeyChoice[] = [
  { value: 'num', label: '1', expr: '1', alike: "'1'" },
  { value: 'obj', label: '{ id: 7 }', expr: '{ id: 7 }', alike: '{ id: 7 }' },
  { value: 'toString', label: "'toString'", expr: "'toString'", alike: "'toString'" },
  { value: 'proto', label: "'__proto__'", expr: "'__proto__'", alike: "'__proto__'" },
  { value: 'nan', label: 'NaN', expr: 'NaN', alike: 'NaN' },
  { value: 'zero', label: '-0', expr: '-0', alike: '0' },
];

export type StoreKind = 'object' | 'nullProto' | 'map';

export interface StoreRun {
  kind: StoreKind;
  title: string;
  code: string[];
  /** Что хранилище отдало до записи. */
  before: string;
  /** Ключи после записи, как их перечисляет само хранилище. */
  keys: string;
  /** Что вернуло чтение «похожим» ключом. */
  alike: string;
  /** Нашлась ли записанная строка `'v'` по похожему ключу. */
  found: boolean;
  /** Отдало ли хранилище что-то до записи — то есть ключ «уже был». */
  leaked: boolean;
}

/** Значение так, как его прочтёт человек: `'v'`, `[Function: toString]`, `Object.prototype`. */
export function show(v: unknown): string {
  if (v === Object.prototype) return 'Object.prototype';
  if (typeof v === 'string') return `'${v}'`;
  if (typeof v === 'function') return `[Function: ${v.name}]`;
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (Array.isArray(v)) return v.length ? `[ ${v.map(show).join(', ')} ]` : '[]';
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    return keys.length ? `{ ${keys.map((k) => `${k}: ${show((v as Record<string, unknown>)[k])}`).join(', ')} }` : '{}';
  }
  return String(v);
}

const STORES: { kind: StoreKind; title: string; make: string; read: (k: string) => string; write: (k: string) => string; keys: string }[] = [
  {
    kind: 'object',
    title: 'обычный объект',
    make: 'const s = {};',
    read: (k) => `s[${k}]`,
    write: (k) => `s[${k}] = 'v';`,
    keys: 'Object.keys(s)',
  },
  {
    kind: 'nullProto',
    title: 'Object.create(null)',
    make: 'const s = Object.create(null);',
    read: (k) => `s[${k}]`,
    write: (k) => `s[${k}] = 'v';`,
    keys: 'Object.keys(s)',
  },
  {
    kind: 'map',
    title: 'Map',
    make: 'const s = new Map();',
    read: (k) => `s.get(${k})`,
    write: (k) => `s.set(${k}, 'v');`,
    keys: '[...s.keys()]',
  },
];

export function runKey(choice: KeyChoice): StoreRun[] {
  return STORES.map((st) => {
    const code = [
      st.make,
      `${st.read(choice.expr)};   // до записи`,
      st.write(choice.expr),
      `${st.keys};`,
      `${st.read(choice.alike)};   // похожим ключом`,
    ];
    const [before, keys, alike] = new Function(
      `${st.make}
const before = ${st.read(choice.expr)};
${st.write(choice.expr)}
return [before, ${st.keys}, ${st.read(choice.alike)}];`,
    )() as [unknown, unknown[], unknown];

    return {
      kind: st.kind,
      title: st.title,
      code,
      before: show(before),
      keys: show(keys),
      alike: show(alike),
      found: alike === 'v',
      leaked: before !== undefined,
    };
  });
}
