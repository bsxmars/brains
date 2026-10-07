/**
 * Три взгляда на значение — без DOM и Vue, чтобы их импортировал и тест:
 *
 * - `shape` — каноническая запись структуры: типы, прототипы, ключи с флагами дескрипторов,
 *   содержимое `Map`/`Set`/буферов и **граф ссылок** (общий объект и цикл пишутся номером).
 *   Две копии одного значения с равной `shape` неотличимы для кода, который их читает.
 *   Ею тест сверяет учебный `clone` с настоящим `structuredClone`;
 * - `show` — печать для человека, похожая на консоль Node;
 * - `losses` — чем копия отличается от оригинала: пропавшие ключи, смена типа, потерянный
 *   прототип, геттер, ставший значением, общая с оригиналом ссылка, распавшийся граф.
 *
 * Геттеры здесь не вызываются: свойство-аксессор пишется как аксессор. Исключение — `stack`
 * у ошибок, в V8 это собственный аксессор, и `shape` пишет только его тип.
 */

type Obj = Record<PropertyKey, unknown>;

const isObject = (v: unknown): v is object => (typeof v === 'object' && v !== null) || typeof v === 'function';

function brand(method: (...a: never[]) => unknown, v: unknown): boolean {
  try {
    (method as (this: unknown) => unknown).call(v);
    return true;
  } catch {
    return false;
  }
}

const typedName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!
  .get as (this: unknown) => string | undefined;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
const regExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source')!.get!;

function unboxed(v: object): unknown {
  for (const C of [Number, String, Boolean, BigInt, Symbol] as unknown as { prototype: { valueOf(): unknown } }[]) {
    try {
      return C.prototype.valueOf.call(v);
    } catch {
      /* не этот тип */
    }
  }
  return undefined;
}

/** Вид объекта по внутренним слотам — тем же проверкам, что и учебный `clone`. */
export function kindOf(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'function') return 'function';
  if (typeof v !== 'object') return typeof v;
  const prim = unboxed(v);
  if (prim !== undefined) return `${typeof prim} object`;
  if (brand(Date.prototype.getTime, v)) return 'Date';
  if (brand(regExpSource, v) && v !== RegExp.prototype) return 'RegExp';
  if (brand(bufferLength, v)) return 'ArrayBuffer';
  if (ArrayBuffer.isView(v)) return typedName.call(v) ?? 'DataView';
  if (brand(Map.prototype.has, v)) return 'Map';
  if (brand(Set.prototype.has, v)) return 'Set';
  if (brand(WeakMap.prototype.has, v)) return 'WeakMap';
  if (brand(WeakSet.prototype.has, v)) return 'WeakSet';
  if (Error.isError(v)) return 'Error';
  if (Array.isArray(v)) return 'Array';
  return 'Object';
}

/** Имя прототипа: `Object`, `null` или имя конструктора на прототипе. */
function protoName(v: object): string {
  const proto = Object.getPrototypeOf(v);
  if (proto === null) return 'null';
  if (proto === Object.prototype) return 'Object';
  const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value;
  return typeof ctor === 'function' && ctor.name ? ctor.name : '?';
}

function primitive(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return v.toString();
  return String(v);
}

const keyText = (k: PropertyKey) => (typeof k === 'symbol' ? `[${k.toString()}]` : JSON.stringify(k));

// ─── shape ───────────────────────────────────────────────────────────────────────────────

export function shape(value: unknown): string {
  const ids = new Map<object, number>();

  function walk(v: unknown): string {
    if (!isObject(v)) return `${typeof v}:${primitive(v)}`;
    if (ids.has(v)) return `#${ids.get(v)}`;
    ids.set(v, ids.size);
    const kind = kindOf(v);
    const parts: string[] = [`${kind}<${protoName(v)}>`];
    const o = v as Obj;

    if (kind.endsWith(' object')) parts.push(primitive(unboxed(v)));
    if (kind === 'Date') parts.push(String(Date.prototype.getTime.call(v)));
    if (kind === 'RegExp') parts.push(`/${regExpSource.call(v)}/${(v as RegExp).flags}`);
    if (kind === 'ArrayBuffer') {
      const b = v as ArrayBuffer;
      parts.push(`len=${b.byteLength}`, `resizable=${b.resizable}`, `max=${b.maxByteLength}`, `[${new Uint8Array(b).join(',')}]`);
    }
    if (ArrayBuffer.isView(v)) parts.push(`off=${v.byteOffset}`, `len=${v.byteLength}`, `buf=${walk(v.buffer)}`);
    if (kind === 'Map') parts.push(`{${[...(v as Map<unknown, unknown>)].map(([k, x]) => `${walk(k)}=>${walk(x)}`).join(',')}}`);
    if (kind === 'Set') parts.push(`{${[...(v as Set<unknown>)].map(walk).join(',')}}`);
    if (kind === 'Error') parts.push(`name=${String(o.name)}`);
    if (kind === 'Array') parts.push(`length=${(v as unknown[]).length}`);

    for (const key of Reflect.ownKeys(v)) {
      if (ArrayBuffer.isView(v) && typeof key === 'string' && /^\d+$/.test(key)) continue;
      if (key === 'length' && kind === 'Array') continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      const flags = `${d.enumerable ? 'e' : '-'}${d.configurable ? 'c' : '-'}${'value' in d ? (d.writable ? 'w' : '-') : 'a'}`;
      const body = 'value' in d ? walk(d.value) : `get:${typeof d.get},set:${typeof d.set}`;
      // Стек у ошибок: аксессор с текстом, зависящим от места вызова, — пишется только тип.
      parts.push(`${keyText(key)}/${flags}=${kind === 'Error' && key === 'stack' ? `stack:${typeof o.stack}` : body}`);
    }
    return `(${parts.join(' ')})`;
  }

  return walk(value);
}

// ─── show ────────────────────────────────────────────────────────────────────────────────

export function show(value: unknown): string {
  // Первый проход: какие объекты встречаются дважды — им достаются метки *1, *2.
  const seen = new Set<object>();
  const repeated = new Set<object>();
  (function scan(v: unknown) {
    if (!isObject(v)) return;
    if (seen.has(v)) {
      repeated.add(v);
      return;
    }
    seen.add(v);
    for (const [, x] of children(v)) scan(x);
  })(value);

  const labels = new Map<object, number>();
  const printed = new Set<object>();

  function head(v: object, kind: string): string {
    const o = v as Obj;
    const proto = protoName(v);
    switch (kind) {
      case 'Date': {
        const t = Date.prototype.getTime.call(v);
        return `Date ${Number.isNaN(t) ? 'Invalid Date' : new Date(t).toISOString()}`;
      }
      case 'RegExp': {
        const re = v as RegExp;
        return `/${re.source}/${re.flags}${re.lastIndex ? ` lastIndex ${re.lastIndex}` : ''}`;
      }
      case 'ArrayBuffer':
        return `ArrayBuffer(${(v as ArrayBuffer).byteLength}) [${new Uint8Array(v as ArrayBuffer).join(', ')}]`;
      case 'Map':
        return `Map(${(v as Map<unknown, unknown>).size})`;
      case 'Set':
        return `Set(${(v as Set<unknown>).size})`;
      case 'Error':
        return `${proto === 'Object' ? 'Error' : proto}: ${typeof o.message === 'string' ? o.message : ''}`.replace(/: $/, '');
      case 'Array':
        return proto === 'Array' ? '' : `${proto} `;
      case 'Object':
        return proto === 'Object' ? '' : proto === 'null' ? '[null-прототип] ' : `${proto} `;
      default:
        if (kind.endsWith(' object')) return `[${kind.split(' ')[0]}: ${primitive(unboxed(v))}]`;
        if (ArrayBuffer.isView(v)) return `${kind}(${(v as Uint8Array).length ?? (v as DataView).byteLength})`;
        return kind;
    }
  }

  function walk(v: unknown, indent: string, path: Set<object>): string {
    if (typeof v === 'function') return `[Function${v.name ? `: ${v.name}` : ''}]`;
    if (!isObject(v)) return primitive(v);
    if (printed.has(v)) {
      if (!labels.has(v)) labels.set(v, labels.size + 1);
      return path.has(v) ? `[Circular *${labels.get(v)}]` : `[Ref *${labels.get(v)}]`;
    }
    printed.add(v);
    if (repeated.has(v) && !labels.has(v)) labels.set(v, labels.size + 1);
    const tag = repeated.has(v) ? `<ref *${labels.get(v)}> ` : '';
    const kind = kindOf(v);
    const inner = indent + '  ';
    const next = new Set(path).add(v);
    const items = children(v).map(([k, x, how]) => {
      const body = how === 'getter' ? '[Getter]' : how === 'hole' ? '<пусто>' : walk(x, inner, next);
      return k === null ? body : `${k}: ${body}`;
    });
    const h = head(v, kind);
    if (!items.length) {
      if (kind === 'Array') return `${tag}${h}[]`;
      if (kind === 'Object') return `${tag}${h}{}`;
      return `${tag}${h}`;
    }
    const [open, close] = kind === 'Array' ? ['[', ']'] : ['{', '}'];
    const one = `${tag}${h}${h && !h.endsWith(' ') ? ' ' : ''}${open} ${items.join(', ')} ${close}`;
    if (one.length + indent.length <= 40 && !one.includes('\n')) return one;
    return `${tag}${h}${h && !h.endsWith(' ') ? ' ' : ''}${open}\n${items.map((i) => inner + i).join(',\n')}\n${indent}${close}`;
  }

  return walk(value, '', new Set());
}

/**
 * Дети объекта для печати: `[подпись, значение, как]`. Подпись `null` — элемент без ключа
 * (элемент `Set`, ячейка массива). `как`: `value`, `getter` (не вызывается), `hole` (дыра).
 */
function children(v: object): [string | null, unknown, 'value' | 'getter' | 'hole'][] {
  const kind = kindOf(v);
  const out: [string | null, unknown, 'value' | 'getter' | 'hole'][] = [];
  if (kind === 'Map') for (const [k, x] of v as Map<unknown, unknown>) out.push([`${show(k)} =>`, x, 'value']);
  if (kind === 'Set') for (const x of v as Set<unknown>) out.push([null, x, 'value']);
  if (ArrayBuffer.isView(v) && kind !== 'DataView') {
    for (const x of v as Uint8Array) out.push([null, x, 'value']);
    return out;
  }
  if (kind === 'Array') {
    const arr = v as unknown[];
    for (let i = 0; i < arr.length; i++) out.push([null, arr[i], Object.hasOwn(arr, i) ? 'value' : 'hole']);
  }
  for (const key of Reflect.ownKeys(v)) {
    if (kind === 'Array' && (key === 'length' || (typeof key === 'string' && /^\d+$/.test(key)))) continue;
    if (kind === 'Error' && (key === 'stack' || key === 'message')) continue;
    const d = Object.getOwnPropertyDescriptor(v, key)!;
    const name = typeof key === 'symbol' ? `[${key.toString()}]` : /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(key) ? key : JSON.stringify(key);
    const label = d.enumerable ? name : `[${name}]`;
    out.push(['value' in d ? label : label, 'value' in d ? d.value : undefined, 'value' in d ? 'value' : 'getter']);
  }
  return out;
}

// ─── losses ──────────────────────────────────────────────────────────────────────────────

const KIND_RU: Record<string, string> = {
  undefined: '`undefined`',
  null: '`null`',
  number: 'число',
  string: 'строка',
  boolean: 'логическое',
  bigint: '`BigInt`',
  symbol: 'символ',
  function: 'функция',
  Object: 'объект',
  Array: 'массив',
};

const kindRu = (v: unknown) => {
  const k = kindOf(v);
  if (k === 'Object' && isObject(v) && protoName(v) !== 'Object') return `экземпляр \`${protoName(v)}\``;
  return KIND_RU[k] ?? `\`${k}\``;
};

/**
 * Чем копия отличается от оригинала. Строки со строчной разметкой, по одной на находку,
 * в порядке обхода оригинала. Пустой список — копия неотличима по `shape`-признакам.
 */
export function losses(source: unknown, copy: unknown): string[] {
  const found: string[] = [];
  const pairs = new Map<object, unknown>(); // объект оригинала → его копия
  const at = (path: string) => `\`${path || 'значение'}\``;

  function walk(s: unknown, c: unknown, path: string, depth: number) {
    if (!isObject(s)) {
      if (Object.is(s, c)) return;
      if (typeof s === typeof c && typeof s !== 'number') return;
      if (typeof s === 'number' && typeof c === 'number') {
        found.push(`${at(path)}: было \`${primitive(s)}\`, стало \`${primitive(c)}\``);
        return;
      }
      found.push(`${at(path)}: было ${KIND_RU[typeof s] ?? typeof s} \`${primitive(s)}\`, стало ${kindRu(c)}${isObject(c) ? '' : ` \`${primitive(c)}\``}`);
      return;
    }
    if (pairs.has(s)) {
      if (pairs.get(s) !== c) found.push(`${at(path)}: это был тот же объект, что и раньше в обходе, — в копии он стал отдельным`);
      return;
    }
    pairs.set(s, c);
    if (c === s) {
      if (depth > 0 && typeof s !== 'function') found.push(`${at(path)}: общая ссылка — копия и оригинал делят один объект`);
      return;
    }
    const sk = kindOf(s);
    if (!isObject(c) || kindOf(c) !== sk) {
      found.push(`${at(path)}: было ${kindRu(s)}, стало ${isObject(c) ? kindRu(c) : `${kindRu(c)}${c === undefined ? '' : ` \`${primitive(c)}\``}`}`);
      if (!isObject(c)) return;
    } else if (protoName(s) !== protoName(c)) {
      found.push(`${at(path)}: прототип \`${protoName(s)}\` потерян — теперь \`${protoName(c)}\`, методов класса и \`#\`-полей нет`);
    }
    const so = s as Obj;
    const co = c as Obj;

    if (sk === 'RegExp' && kindOf(c) === 'RegExp' && (s as RegExp).lastIndex !== (c as RegExp).lastIndex) {
      found.push(`${at(path)}: \`lastIndex\` был ${(s as RegExp).lastIndex}, стал ${(c as RegExp).lastIndex}`);
    }
    if (sk === 'Error' && kindOf(c) === 'Error' && so.name !== co.name) {
      found.push(`${at(path)}: имя ошибки было \`${String(so.name)}\`, стало \`${String(co.name)}\``);
    }
    if (Object.isFrozen(s) && !Object.isFrozen(c) && Reflect.ownKeys(s).length) found.push(`${at(path)}: заморозка (\`Object.freeze\`) не скопирована`);
    if (sk === 'Map' && kindOf(c) === 'Map') {
      const se = [...(s as Map<unknown, unknown>)];
      const ce = [...(c as Map<unknown, unknown>)];
      se.forEach(([k, x], i) => {
        if (i >= ce.length) return;
        if (isObject(k) && ce[i][0] === k) found.push(`${at(path)}: ключ записи ${i} — тот же объект, что в оригинале`);
        walk(x, ce[i][1], `${path}.get(${show(k)})`, depth + 1);
      });
    }
    if (sk === 'Set' && kindOf(c) === 'Set') {
      const ce = [...(c as Set<unknown>)];
      [...(s as Set<unknown>)].forEach((x, i) => walk(x, ce[i], `${path}[элемент ${i}]`, depth + 1));
    }

    for (const key of Reflect.ownKeys(s)) {
      if (ArrayBuffer.isView(s) && typeof key === 'string') continue;
      if (sk === 'Error' && key === 'stack') continue;
      if (key === 'length' && Array.isArray(s)) continue;
      const sub = typeof key === 'symbol' ? `${path}[${key.toString()}]` : Array.isArray(s) && /^\d+$/.test(key) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      const sd = Object.getOwnPropertyDescriptor(s, key)!;
      const cd = Object.getOwnPropertyDescriptor(c, key);
      if (!cd) {
        const why = typeof key === 'symbol' ? 'ключ-символ пропал' : !sd.enumerable ? 'неперечисляемое свойство пропало' : sd.get ? 'геттер пропал' : 'ключ пропал';
        found.push(`${at(sub)}: ${why}`);
        continue;
      }
      if (sd.get && 'value' in cd) found.push(`${at(sub)}: геттер стал обычным значением \`${isObject(cd.value) ? '{…}' : primitive(cd.value)}\``);
      else if ('value' in sd && 'value' in cd && sd.writable === false && cd.writable && !Object.isFrozen(s)) found.push(`${at(sub)}: было только для чтения, стало записываемым`);
      if (sd.enumerable && !cd.enumerable && !(sk === 'Error')) found.push(`${at(sub)}: стало неперечисляемым`);
      if ('value' in sd && 'value' in cd) walk(sd.value, cd.value, sub, depth + 1);
    }
    if (Array.isArray(s) && Array.isArray(c)) {
      for (let i = 0; i < s.length; i++) {
        if (!Object.hasOwn(s, i) && Object.hasOwn(c, i)) found.push(`${at(`${path}[${i}]`)}: дыра в массиве стала значением \`${primitive(c[i])}\``);
      }
    }
  }

  walk(source, copy, '', 0);
  return found;
}
