import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  AUGMENT_FILES,
  CLASS_CONTRACT_CODE,
  CLASS_PRIVATE_CODE,
  CLASS_PRIVATE_OUT,
  DECORATOR_CODE,
  DECORATOR_OUT,
  GUARD_CODE,
  LEGACY_DECORATOR_CODE,
  LEGACY_EMIT,
  MIXIN_CODE,
  MIXIN_OUT,
  NARROW_BASICS_CODE,
  NARROW_LIES_CODE,
  NARROW_LIES_OUT,
  NARROW_ROWS,
  STATE_CODE,
  THIS_LOST_CODE,
  THIS_LOST_OUT,
  TYPE_IFACE_CODE,
  UNTYPED_CODE,
  UNTYPED_FILES,
  ERASURE_CODE,
  ERASURE_FLAG_NOTE,
  ERASURE_NOTES,
  ERASURE_ROWS,
  FAST_CODE,
  HKT_FILES,
  INTRINSIC_DEFERRED,
  ISOLATED_CODE,
  ISOLATED_DTS_CODE,
  MECHANISMS_CODE,
  MERGE_CODE,
  NAIVE_DATE_PROPS,
  RECURSION_LIMITS,
  SCHEMA_CODE,
  SCHEMA_OUT,
  SLOW_CODE,
  SLOW_COUNTS,
  THIS_CODE,
  THIS_MORE_CODE,
  THIS_OUT,
  TYPE_TESTS_CODE,
  UNION_LIMITS,
  ZOD_CODE,
  ZOD_OUT,
} from '@/content/tooling/typescript/data';

/**
 * Утверждения темы «TypeScript на уровне типов» — настоящим компилятором.
 *
 * У этой темы нет живого демо, и это решение, а не недоработка: показать вычисление типов
 * в браузере можно только одним способом — притащив туда сам `tsc`, а он весит мегабайты
 * при бюджете страницы в 60 КБ скриптов (`tests/e2e/weight.spec.ts`). Значит, проверка
 * переезжает сюда — и здесь она даже честнее демо: не картинка про компилятор, а компилятор.
 *
 * Каждая фикстура — маленький `.ts`-файл в памяти, который прогоняется как `tsc --noEmit`
 * со `strict`. Ожидаемые ошибки размечены прямо в фикстуре комментарием `// @ts(2589)`:
 * сверяются и строка, и код диагностики, а строки без метки обязаны остаться чистыми.
 * Так «здесь падает» и «здесь не падает» — одинаково проверяемые утверждения.
 *
 * Тождество типов сверяется ассертом `Expect<IsEqual<A, B>>` (§11.2 конспекта): обычное
 * `extends` в обе стороны не отличает `any` от `unknown` и пересечение от плоского объекта,
 * а сравнение двух отложенных условных сигнатур — отличает.
 *
 * ⚠️ Числа живут в `data.ts`, а не здесь. Пределы рекурсии и размер union'а попадают
 * и на страницу, и в фикстуру из одного места — иначе текст и проверка однажды разойдутся,
 * и разойдутся молча.
 *
 * Стоимость: около десятка программ, самая дорогая — хвостовая рекурсия на 1000 итераций
 * (полсекунды). Разобранные `lib.*.d.ts` переиспользуются между прогонами: без кеша каждая
 * программа платила бы за них заново.
 */

const FILE = 'fixture.ts';

const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts'],
  types: [],
  skipLibCheck: true,
  skipDefaultLibCheck: true,
};

/** Общий на все прогоны: разбор `lib.es2022.d.ts` стоит дороже любой фикстуры. */
const libCache = new Map<string, ts.SourceFile>();

function createProgram(source: string, extra: ts.CompilerOptions = {}): ts.Program {
  const options: ts.CompilerOptions = { ...OPTIONS, ...extra };
  const host = ts.createCompilerHost(options, true);
  const readFromDisk = host.getSourceFile.bind(host);

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    if (name === FILE) return ts.createSourceFile(name, source, languageVersion, true);
    const cached = libCache.get(name);
    if (cached) return cached;
    const file = readFromDisk(name, languageVersion, onError, shouldCreate);
    if (file) libCache.set(name, file);
    return file;
  };
  host.fileExists = (name) => name === FILE || ts.sys.fileExists(name);
  host.readFile = (name) => (name === FILE ? source : ts.sys.readFile(name));
  host.writeFile = () => {};

  return ts.createProgram([FILE], options, host);
}

interface Found {
  line: number;
  code: number;
}

function diagnose(source: string, extra?: ts.CompilerOptions): (Found & { text: string })[] {
  const program = createProgram(source, extra);
  const all = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];

  return all
    .map((d) => ({
      line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
      code: d.code,
      text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    }))
    .sort((a, b) => a.line - b.line || a.code - b.code);
}

/** Метка ожидаемой ошибки прямо в фикстуре — рядом со строкой, которая обязана упасть. */
const MARKER = /\/\/\s*@ts\((\d+)\)/;

function markers(source: string): Found[] {
  return source.split('\n').flatMap((line, i) => {
    const hit = MARKER.exec(line);
    return hit ? [{ line: i + 1, code: Number(hit[1]) }] : [];
  });
}

/** Диагностика компилятора обязана совпасть с разметкой фикстуры — и по строке, и по коду. */
function check(source: string, extra?: ts.CompilerOptions): void {
  const actual = diagnose(source, extra);
  const report = actual.length
    ? actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n')
    : '  (компилятор не сказал ничего)';

  expect(
    actual.map(({ line, code }) => ({ line, code })),
    `компилятор разошёлся с разметкой фикстуры:\n${report}`,
  ).toEqual(markers(source));
}

/** Как компилятор печатает тип — для утверждений вида «этот тип не упрощается». */
function aliasType(source: string, alias: string): string {
  const program = createProgram(source);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(FILE);
  if (!file) throw new Error('фикстура не попала в программу');

  let found: ts.TypeAliasDeclaration | undefined;
  ts.forEachChild(file, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === alias) found = node;
  });
  if (!found) throw new Error(`в фикстуре нет типа ${alias}`);

  return checker.typeToString(
    checker.getTypeAtLocation(found.type),
    undefined,
    ts.TypeFormatFlags.NoTruncation,
  );
}

/** Свойства объявленной переменной: чем именно стал `Date` после наивного маппинга. */
function propertiesOf(source: string, variable: string): { name: string; type: string }[] {
  const program = createProgram(source);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(FILE);
  if (!file) throw new Error('фикстура не попала в программу');

  let name: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === variable) {
      name = node.name;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!name) throw new Error(`в фикстуре нет переменной ${variable}`);

  const anchor = name;
  return checker.getPropertiesOfType(checker.getTypeAtLocation(anchor)).map((symbol) => ({
    name: symbol.name,
    type: checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, anchor)),
  }));
}

/** Ассерт тождества типов и его обёртка — те самые, что разобраны в теме. */
const HEAD = `
type IsEqual<A, B> =
  (<G>() => G extends A & G | G ? 1 : 2) extends (<G>() => G extends B & G | G ? 1 : 2)
    ? true : false;
type Expect<T extends true> = T;
`;

describe('раздел 1 · тип как вычисление', () => {
  it('`extends` — это присваиваемость, а не наследование', () => {
    check(`${HEAD}
type _1 = Expect<IsEqual<'a' extends string ? 1 : 0, 1>>;
type _2 = Expect<IsEqual<string extends 'a' ? 1 : 0, 0>>;
type _3 = Expect<IsEqual<{ a: 1; b: 2 } extends { a: 1 } ? 1 : 0, 1>>;
type _4 = Expect<IsEqual<never extends string ? 1 : 0, 1>>;
type _5 = Expect<IsEqual<string extends any ? 1 : 0, 1>>;
type _6 = Expect<IsEqual<any extends string ? 1 : 0, 0 | 1>>;
type _7 = Expect<IsEqual<unknown extends unknown ? 1 : 0, 1>>;
`);
  });

  it('дистрибуция включается голым параметром и выключается кортежем', () => {
    check(`${HEAD}
type IsString<T> = T extends string ? 'да' : 'нет';
type Exact<T> = [T] extends [string] ? 'да' : 'нет';

type _1 = Expect<IsEqual<IsString<string | number>, 'да' | 'нет'>>;
type _2 = Expect<IsEqual<Exact<string | number>, 'нет'>>;
type _3 = Expect<IsEqual<IsString<boolean>, 'нет'>>;
type _4 = Expect<IsEqual<(string | number) extends string ? 1 : 0, 0>>;
type _5 = Expect<IsEqual<Exclude<'a' | 'b' | 'c', 'a'>, 'b' | 'c'>>;
`);
  });
});

describe('раздел 2 · условные типы и infer', () => {
  it('`never`, `any` и `unknown` ведут себя каждый по-своему', () => {
    check(`${HEAD}
type IsString<T> = T extends string ? 'да' : 'нет';
type IsNever<T> = [T] extends [never] ? true : false;
type IsAny<T> = 0 extends 1 & T ? true : false;

type _1 = Expect<IsEqual<IsString<never>, never>>;
type _2 = Expect<IsEqual<IsNever<never>, true>>;
type _3 = Expect<IsEqual<Exclude<never, string>, never>>;
type _4 = Expect<IsEqual<NonNullable<never>, never>>;
type _5 = Expect<IsEqual<IsString<any>, 'да' | 'нет'>>;
type _6 = Expect<IsEqual<IsAny<any>, true>>;
type _7 = Expect<IsEqual<IsAny<unknown>, false>>;
type _8 = Expect<IsEqual<IsAny<never>, false>>;
type _9 = Expect<IsEqual<IsAny<number>, false>>;
type _10 = Expect<IsEqual<IsString<unknown>, 'нет'>>;
`);
  });

  it('позиция `infer` решает: ковариантная даёт union, контравариантная — intersection', () => {
    check(`${HEAD}
type Cov<T> = T extends { a: infer U; b: infer U } ? U : never;
type Contra<T> = T extends { a: (x: infer U) => void; b: (x: infer U) => void } ? U : never;
type U2I<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type LastOf<U> = U2I<U extends any ? () => U : never> extends () => infer R ? R : never;

type _1 = Expect<IsEqual<Cov<{ a: string; b: number }>, string | number>>;
type _2 = Expect<IsEqual<Contra<{ a: (x: string) => void; b: (x: number) => void }>, string & number>>;
type _3 = Expect<IsEqual<U2I<{ a: 1 } | { b: 2 }>, { a: 1 } & { b: 2 }>>;
type _4 = Expect<IsEqual<U2I<string | number>, never>>;
type _5 = Expect<IsEqual<LastOf<1 | 2 | 3>, 3>>;
`);
  });

  it('`infer` в шаблоне жаден слева, а `infer … extends number` приводит строку к числу', () => {
    check(`${HEAD}
type Split1<S> = S extends \`\${infer H}.\${infer R}\` ? [H, R] : never;
type Split2<S> = S extends \`\${infer H}.\${infer M}.\${infer R}\` ? [H, M, R] : never;
type FirstChar<S extends string> = S extends \`\${infer C extends string}\${string}\` ? C : never;
type ToNumber<S extends string> = S extends \`\${infer N extends number}\` ? N : never;
type CamelCase<S extends string> =
  S extends \`\${infer H}_\${infer T}\` ? \`\${H}\${Capitalize<CamelCase<T>>}\` : S;

type _1 = Expect<IsEqual<Split1<'a.b.c'>, ['a', 'b.c']>>;
type _2 = Expect<IsEqual<Split2<'a.b.c.d'>, ['a', 'b', 'c.d']>>;
type _3 = Expect<IsEqual<FirstChar<'hello'>, 'h'>>;
type _4 = Expect<IsEqual<ToNumber<'42'>, 42>>;
type _5 = Expect<IsEqual<CamelCase<'user_first_name'>, 'userFirstName'>>;
`);
  });

  it('`ReturnType` берёт последнюю перегрузку, а вызов — первую подходящую', () => {
    check(`${HEAD}
declare function ov(x: string): string;
declare function ov(x: number): number;
type _1 = Expect<IsEqual<ReturnType<typeof ov>, number>>;
type _2 = Expect<IsEqual<Parameters<typeof ov>, [x: number]>>;

declare function wide(x: string | number): 'wide';
declare function wide(x: string): 'narrow';
const first = wide('a');
type _3 = Expect<IsEqual<typeof first, 'wide'>>;

declare function f(x: string): string;
declare function f(x: number): number;
declare const u: string | number;
f(u);   // @ts(2769)
`);
  });

  it('шаблон строит декартово произведение, а проверка строки стоит постоянного времени', () => {
    check(`${HEAD}
type Size = 'sm' | 'md';
type Side = 'top' | 'left';
type _1 = Expect<IsEqual<\`m\${Side}-\${Size}\`, 'mtop-sm' | 'mtop-md' | 'mleft-sm' | 'mleft-md'>>;

type IsUtility<S extends string> = S extends \`m\${Side}-\${Size}\` ? S : never;
declare function cls<S extends string>(s: IsUtility<S>): void;
cls('mtop-md');
cls('mtop-xl');   // @ts(2345)
`);
  });

  it('intrinsic считают литерал, дистрибутируются — но на широком `string` откладываются', () => {
    check(`${HEAD}
type _1 = Expect<IsEqual<Capitalize<'abc'>, 'Abc'>>;
type _2 = Expect<IsEqual<Uppercase<'a' | 'b'>, 'A' | 'B'>>;

// Шаблон Capitalize разбирает: голова известна, хвост не важен.
type _3 = Expect<IsEqual<Capitalize<\`a\${string}\`>, \`A\${string}\`>>;

// А вот конспект обещает, что на широком string intrinsic «упрощается» до string.
// На 6.0.3 это неверно: тождества нет, и присваивание работает только в одну сторону.
type _4 = Expect<IsEqual<IsEqual<Capitalize<string>, string>, false>>;

declare const capitalized: Capitalize<string>;
declare const wide: string;
const toWide: string = capitalized;
const toCapitalized: Capitalize<string> = wide;   // @ts(2322)
`);
  });

  it(`\`Uppercase\` от шаблона с открытым хвостом печатается как ${INTRINSIC_DEFERRED}`, () => {
    // Компилятор печатает шаблонный тип вместе с обратными кавычками — ровно в том виде,
    // в каком строка лежит в данных темы.
    const printed = aliasType('type C = Uppercase<`a${string}`>;', 'C');
    expect(printed).toBe(INTRINSIC_DEFERRED);
  });

  it(`шаблон на ${UNION_LIMITS.okSize} строк компилируется`, () => {
    check(unionFixture(UNION_LIMITS.okMembers, false));
  });

  it(`шаблон на ${UNION_LIMITS.failSize} строк даёт ts(${UNION_LIMITS.errorCode})`, () => {
    check(unionFixture(UNION_LIMITS.failMembers, true));
  });
});

/** Union из `members` литералов, подставленный в шаблон из четырёх позиций. */
function unionFixture(members: number, fails: boolean): string {
  const union = Array.from({ length: members }, (_, i) => `'a${i}'`).join(' | ');
  const slots = ['${U}', '${U}', '${U}', '${U}'].join('-');
  const mark = fails ? `   // @ts(${UNION_LIMITS.errorCode})` : '';
  return `type U = ${union};\ntype X = \`${slots}\`;${mark}\ndeclare const v: X;\n`;
}

describe('раздел 3 · mapped-типы', () => {
  it('гомоморфный маппинг сохраняет кортеж, массив, `readonly` и дистрибутивность', () => {
    check(`${HEAD}
type A = { a: string };
type B = { b: number };

type _1 = Expect<IsEqual<Partial<[number, string]>, [(number | undefined)?, (string | undefined)?]>>;
type _2 = Expect<IsEqual<Readonly<string[]>, readonly string[]>>;
type _3 = Expect<IsEqual<Partial<{ readonly x: 1 }>, { readonly x?: 1 | undefined }>>;
type _4 = Expect<IsEqual<Partial<A | B>, Partial<A> | Partial<B>>>;
type _5 = Expect<IsEqual<keyof (A | B), never>>;
type _6 = Expect<IsEqual<keyof (A & B), 'a' | 'b'>>;
`);
  });

  it('`as` убивает гомоморфность: массив перестаёт быть массивом', () => {
    // Гомоморфный `Partial<string[]>` — это массив, и он присваивается в массив.
    // Тождественное на вид `as K` даёт объект с числовым индексом: `length` стал
    // опциональным, и присваивание ломается. Одна клауза — и массива больше нет.
    check(`
type Nonhom<T> = { [K in keyof T as K]?: T[K] };

declare const homomorphic: Partial<string[]>;
declare const remapped: Nonhom<string[]>;

const fromHomomorphic: (string | undefined)[] = homomorphic;
const fromRemapped: (string | undefined)[] = remapped;   // @ts(2322)
`);
  });

  it('`-?` снимает только тот `undefined`, который добавила опциональность', () => {
    check(`${HEAD}
type _1 = Expect<IsEqual<Required<{ x?: string }>, { x: string }>>;
type _2 = Expect<IsEqual<Required<{ x: string | undefined }>, { x: string | undefined }>>;
`);
  });

  it('`exactOptionalPropertyTypes` разводит эти два состояния и в присваивании', () => {
    check(
      `
type X = { x?: string };
const a: X = { x: undefined };   // @ts(2375)
`,
      { exactOptionalPropertyTypes: true },
    );
  });

  it('`Simplify` запечатывает интерфейс, и тот становится совместим с `Record`', () => {
    check(`${HEAD}
interface Cfg { a: string }
type Simplify<T> = { [K in keyof T]: T[K] } & {};

declare const i: Cfg;
const asIs: Record<string, unknown> = i;                  // @ts(2322)
const sealed: Record<string, unknown> = i as Simplify<Cfg>;

type _1 = Expect<IsEqual<Simplify<{ a: 1 } & { b: 2 }>, { a: 1; b: 2 }>>;
`);
  });

  it('`noUncheckedIndexedAccess` не трогает индексный доступ в типах', () => {
    check(
      `${HEAD}
const arr: number[] = [];
const x = arr[0];
type _1 = Expect<IsEqual<typeof x, number | undefined>>;
type _2 = Expect<IsEqual<number[][0], number>>;
type _3 = Expect<IsEqual<number[][number], number>>;
type _4 = Expect<IsEqual<[1, 2][0], 1>>;
`,
      { noUncheckedIndexedAccess: true },
    );
  });
});

describe('раздел 4 · рекурсия и её пределы', () => {
  it('кортеж как счётчик: сложение и разворот списка', () => {
    check(`${HEAD}
type Tuple<N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? Acc : Tuple<N, [...Acc, unknown]>;
type Add<A extends number, B extends number> = [...Tuple<A>, ...Tuple<B>]['length'];
type Reverse<T extends unknown[], Acc extends unknown[] = []> =
  T extends [infer H, ...infer R] ? Reverse<R, [H, ...Acc]> : Acc;

type _1 = Expect<IsEqual<Add<2, 3>, 5>>;
type _2 = Expect<IsEqual<Reverse<[1, 2, 3]>, [3, 2, 1]>>;
`);
  });

  it(`нехвостовая форма проходит ${RECURSION_LIMITS.nonTail.ok} уровней и падает на ${RECURSION_LIMITS.nonTail.fail}`, () => {
    check(`
type NonTail<N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? [] : [0, ...NonTail<N, [...Acc, 0]>];
declare const ok: NonTail<${RECURSION_LIMITS.nonTail.ok}>;
declare const deep: NonTail<${RECURSION_LIMITS.nonTail.fail}>;   // @ts(${RECURSION_LIMITS.errorCode})
`);
  });

  it(`хвостовая форма проходит ${RECURSION_LIMITS.tail.ok} итераций и падает на ${RECURSION_LIMITS.tail.fail}`, () => {
    check(`
type Tail<N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? Acc : Tail<N, [...Acc, 0]>;
declare const ok: Tail<${RECURSION_LIMITS.tail.ok}>;
declare const deep: Tail<${RECURSION_LIMITS.tail.fail}>;   // @ts(${RECURSION_LIMITS.errorCode})
`);
  });

  it('тот же тип на 200 повторов: нехвостовой падает, хвостовой работает', () => {
    check(`${HEAD}
type RepeatNonTail<S extends string, N extends number, Acc extends unknown[] = []> =
  Acc['length'] extends N ? '' : \`\${S}\${RepeatNonTail<S, N, [...Acc, 0]>}\`;
type Broken = RepeatNonTail<'ab', 200>;   // @ts(${RECURSION_LIMITS.errorCode})

type RepeatTail<S extends string, N extends number,
                Acc extends unknown[] = [], Out extends string = ''> =
  Acc['length'] extends N ? Out : RepeatTail<S, N, [...Acc, 0], \`\${Out}\${S}\`>;
type Works = RepeatTail<'ab', 200>;
type _1 = Expect<IsEqual<Works extends string ? true : false, true>>;
`);
  });

  it('самоссылающийся объект в mapped type ловится как ts(2615)', () => {
    check(`
type TreeNode = { id: string; parent: TreeNode | null };
type NaivePaths<T> = T extends object
  ? { [K in keyof T & string]: K | \`\${K}.\${NaivePaths<T[K]>}\` }[keyof T & string]
  : never;
declare const p: NaivePaths<TreeNode>;   // @ts(2615)
`);
  });

  it('`Paths` и `Get` со счётчиком глубины считают то, что написано в теме', () => {
    check(`${HEAD}
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type Prev = [never, 0, 1, 2, 3, 4, 5, 6];

type Paths<T, D extends number = 6> =
  [D] extends [never] ? never :
  T extends Primitive ? never :
  T extends readonly unknown[] ? never :
  { [K in keyof T & string]:
      | K
      | (T[K] extends Primitive ? never : \`\${K}.\${Paths<T[K], Prev[D]>}\`)
  }[keyof T & string];

type Get<T, P extends string> =
  P extends \`\${infer Head}.\${infer Rest}\`
    ? Head extends keyof T ? Get<T[Head], Rest> : never
    : P extends keyof T ? T[P] : never;

type Obj = { a: { b: { c: string }; d: number }; e: boolean };
type _1 = Expect<IsEqual<Paths<Obj>, 'a' | 'e' | 'a.b' | 'a.d' | 'a.b.c'>>;
type _2 = Expect<IsEqual<Get<Obj, 'a.b.c'>, string>>;
type _3 = Expect<IsEqual<Get<Obj, 'a.nope'>, never>>;
`);
  });

  it('наивный `DeepPartial` ломает массив, функцию и `Date` — тремя разными способами', () => {
    const source = `
type NaiveDeepPartial<T> = T extends object ? { [K in keyof T]?: NaiveDeepPartial<T[K]> } : T;
declare const date: NaiveDeepPartial<Date>;
`;
    const props = propertiesOf(source, 'date');

    expect(props.length, 'число свойств Date на lib.es2022 изменилось').toBe(NAIVE_DATE_PROPS);
    expect(
      props.filter((p) => p.type !== '{} | undefined'),
      'после наивного маппинга каждый метод Date обязан стать `{} | undefined`',
    ).toEqual([]);

    check(`${HEAD}
type NaiveDeepPartial<T> = T extends object ? { [K in keyof T]?: NaiveDeepPartial<T[K]> } : T;

type _1 = Expect<IsEqual<NaiveDeepPartial<() => void>, {}>>;
type _2 = Expect<IsEqual<keyof (() => void), never>>;

declare const broken: NaiveDeepPartial<{ tags: string[] }>;
const tags: string[] | undefined = broken.tags;   // @ts(2322)
`);
  });

  it('рабочий `DeepPartial` с явными ветками ничего не ломает', () => {
    check(`${HEAD}
type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type DeepPartial<T> =
  T extends Primitive ? T :
  T extends readonly (infer U)[]
    ? (T extends U[] ? DeepPartial<U>[] : readonly DeepPartial<U>[]) :
  T extends Function ? T :
  T extends Date | RegExp ? T :
  T extends Map<infer K, infer V> ? Map<K, DeepPartial<V>> :
  T extends Set<infer V> ? Set<DeepPartial<V>> :
  { [K in keyof T]?: DeepPartial<T[K]> };

type R = DeepPartial<{ tags: string[]; user: { name: string; at: Date }; ro: readonly number[] }>;

type _1 = Expect<IsEqual<R['tags'], string[] | undefined>>;
type _2 = Expect<IsEqual<R['ro'], readonly number[] | undefined>>;
type _3 = Expect<IsEqual<NonNullable<R['user']>['at'], Date | undefined>>;
type _4 = Expect<IsEqual<DeepPartial<() => void>, () => void>>;
`);
  });
});

describe('раздел 5 · вариантность', () => {
  it('параметры функции контравариантны, а методы бивариантны всегда', () => {
    const source = `
interface Animal { name: string }
interface Dog extends Animal { breed: string }

declare const handleDog: (d: Dog) => void;
const handleAnimal: (a: Animal) => void = handleDog;   // @ts(2322)

interface WithMethod { handle(d: Dog): void }
interface WithField { handle: (d: Dog) => void }
declare const wm: WithMethod;
declare const wf: WithField;

const viaMethod: { handle(a: Animal): void } = wm;
const viaField: { handle: (a: Animal) => void } = wf;   // @ts(2322)
`;
    check(source);
    // Тот же файл без strictFunctionTypes: проходит всё, включая поле. Флаг решает судьбу
    // только свойства-функции — метод бивариантен в обоих режимах.
    check(source.replace(/\s*\/\/ @ts\(2322\)/g, ''), { strictFunctionTypes: false });
  });

  it('аннотация `out` ругается на поле, молчит на методе и всё равно ужесточает проверку', () => {
    check(`
interface Animal { name: string }
interface Dog extends Animal { breed: string }

interface BadField<out T> { set: (v: T) => void }   // @ts(2636)
interface BadMethod<out T> { set(v: T): void }

declare let wide: BadMethod<Animal>;
declare let narrow: BadMethod<Dog>;
wide = narrow;
narrow = wide;   // @ts(2322)
`);
  });

  it('структурная типизация: бренд закрывает одно направление и оставляет базовый тип', () => {
    check(`
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

declare function getUser(id: UserId): void;
declare const oid: OrderId;
declare const uid: UserId;

getUser(oid);   // @ts(2345)
const asString: string = uid;
const upper: string = uid.toUpperCase();
`);
  });

  it('`assertNever` показывает непокрытый случай на компиляции', () => {
    check(`
type Shape =
  | { kind: 'circle'; r: number }
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'triangle'; a: number };

function assertNever(x: never): never {
  throw new Error(String(x));
}

function area(s: Shape): number {
  switch (s.kind) {
    case 'circle': return s.r;
    case 'rect': return s.w * s.h;
    default: return assertNever(s);   // @ts(2345)
  }
}
`);
  });
});

describe('раздел 6 · тонкие места', () => {
  it('`satisfies` сохраняет литерал только там, где контекст содержит литералы', () => {
    check(`${HEAD}
type Route = { path: string; auth: boolean };

const r = {
  home: { path: '/', auth: false },
  admin: { path: '/admin', auth: true },
} satisfies Record<string, Route>;

type _1 = Expect<IsEqual<typeof r.home.path, string>>;
type _2 = Expect<IsEqual<typeof r.home.auth, false>>;
type _3 = Expect<IsEqual<keyof typeof r, 'home' | 'admin'>>;

const fixed = { home: { path: '/', auth: false } } as const satisfies Record<string, Route>;
type _4 = Expect<IsEqual<typeof fixed.home.path, '/'>>;
`);
  });

  it('литерал в дженерике выживает по позиции в возврате, а не по `readonly`', () => {
    check(`${HEAD}
declare function id<T>(x: T): T;
declare function arr<T>(x: T): T[];
declare function boxRO<T>(x: T): { readonly v: T };
declare function idC<T extends string>(x: T): T[];
declare function konst<const T>(x: T): T;

const a = id('x');
const b = arr('x');
const c = boxRO('x');
const d = idC('x');
const e = konst(['a', 'b']);

type _1 = Expect<IsEqual<typeof a, 'x'>>;
type _2 = Expect<IsEqual<typeof b, string[]>>;
type _3 = Expect<IsEqual<typeof c, { readonly v: string }>>;
type _4 = Expect<IsEqual<typeof d, 'x'[]>>;
type _5 = Expect<IsEqual<typeof e, readonly ['a', 'b']>>;
`);
  });

  it('`any` проходит constraint молча, `unknown` — нет, `NoInfer` ловит опечатку', () => {
    check(`
declare function need<T extends { a: string }>(x: T): T;
declare const anyValue: any;
declare const unknownValue: unknown;

need(anyValue);
need(unknownValue);   // @ts(2345)

declare function fsm<S extends string>(cfg: { states: S[]; initial: S }): S;
fsm({ states: ['on', 'off'], initial: 'idle' });

declare function fsmSafe<S extends string>(cfg: { states: S[]; initial: NoInfer<S> }): S;
fsmSafe({ states: ['on', 'off'], initial: 'idle' });   // @ts(2322)
`);
  });

  it('`Omit` пропускает опечатку молча, `Pick` — не пропускает', () => {
    check(`${HEAD}
type T1 = { a: string; b: number };

type Silent = Omit<T1, 'typo'>;
type _1 = Expect<IsEqual<Silent, { a: string; b: number }>>;

type Loud = Pick<T1, 'typo'>;   // @ts(2344)
`);
  });

  it('типобезопасный клиент на шаблонах требует params ровно там, где они есть в пути', () => {
    check(`${HEAD}
type Routes = {
  'GET /goals': { res: { id: string }[] };
  'GET /goals/:id': { res: { id: string; title: string } };
  'POST /goals/:id/tasks': { body: { title: string }; res: { ok: true } };
};

type Params<S extends string> =
  S extends \`\${string}:\${infer P}/\${infer R}\` ? { [K in P]: string } & Params<\`/\${R}\`>
  : S extends \`\${string}:\${infer P}\` ? { [K in P]: string }
  : {};

type HasParams<S extends string> = keyof Params<S> extends never ? false : true;

type Req<K extends keyof Routes> =
  (Routes[K] extends { body: infer B } ? { body: B } : {}) &
  (HasParams<K & string> extends true ? { params: Params<K & string> } : {});

declare function api<K extends keyof Routes>(
  route: K,
  ...init: keyof Req<K> extends never ? [] : [Req<K>]
): Promise<Routes[K]['res']>;

declare function use(x: unknown): void;

async function main() {
  const a = await api('GET /goals');
  const b = await api('GET /goals/:id', { params: { id: '1' } });
  const c = await api('POST /goals/:id/tasks', { body: { title: 't' }, params: { id: '1' } });

  type _1 = Expect<IsEqual<typeof a, { id: string }[]>>;
  type _2 = Expect<IsEqual<typeof b, { id: string; title: string }>>;
  type _3 = Expect<IsEqual<typeof c, { ok: true }>>;

  use(await api('GET /goals/:id'));   // @ts(2554)
  use(await api('GET /nope'));   // @ts(2345)
  use([a, b, c]);
}

use(main);
`);
  });
});

/* ───────────────── третий проход: то, что раньше лежало «за кадром» ───────────────── */

/**
 * Здесь проверяется **строка из `data.ts`** — ровно то, что напечатано на странице, — а не копия.
 * Ожидаемые ошибки на странице помечены обычным комментарием `// … ts(NNNN)`: проверка берёт
 * код из той строки, где он написан, и требует, чтобы компилятор упал именно там и именно им,
 * а все строки без пометки остались чистыми.
 */
const PAGE_MARKER = /\/\/.*?\bts\((\d+)\)/;

/** Все коды из комментария строки: декоратор, например, даёт два на одной строке. */
function pageMarkers(source: string): Found[] {
  return source.split('\n').flatMap((line, i) => {
    if (!PAGE_MARKER.test(line)) return [];
    const comment = line.slice(line.indexOf('//'));
    return [...comment.matchAll(/\bts\((\d+)\)/g)].map((m) => ({ line: i + 1, code: Number(m[1]) }));
  });
}

/** Разрешение модулей как у сборщика — чтобы `import 'zod'` нашёл настоящий пакет. */
const MODULES: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};
const WITH_CONSOLE: ts.CompilerOptions = { lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] };

function checkPage(source: string, extra?: ts.CompilerOptions): (Found & { text: string })[] {
  const actual = diagnose(source, extra);
  const report = actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n');
  expect(
    actual.map(({ line, code }) => ({ line, code })),
    `компилятор разошёлся с пометками на странице:\n${report || '  (тишина)'}`,
  ).toEqual(pageMarkers(source));
  return actual;
}

/** Многофайловая программа в памяти: пакет в `node_modules` и файлы проекта рядом. */
const VROOT = path.join(process.cwd(), '__virtual__');

function checkFiles(files: { path: string; code: string }[]): void {
  const map = new Map(files.map((f) => [path.join(VROOT, f.path), f.code]));
  const options: ts.CompilerOptions = { ...OPTIONS, ...MODULES };
  const host = ts.createCompilerHost(options, true);
  const readFromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreate) => {
    const code = map.get(name);
    if (code !== undefined) return ts.createSourceFile(name, code, version, true);
    const cached = libCache.get(name);
    if (cached) return cached;
    const file = readFromDisk(name, version, onError, shouldCreate);
    if (file) libCache.set(name, file);
    return file;
  };
  host.fileExists = (name) => map.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => map.get(name) ?? ts.sys.readFile(name);
  host.directoryExists = (dir) =>
    [...map.keys()].some((f) => f.startsWith(dir + path.sep)) || ts.sys.directoryExists(dir);
  host.getCurrentDirectory = () => VROOT;
  host.writeFile = () => {};

  const roots = [...map.keys()].filter((f) => !f.includes('node_modules'));
  const program = ts.createProgram(roots, options, host);
  const all = [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()];
  const actual = all
    .filter((d) => d.file && roots.includes(d.file.fileName))
    .map((d) => ({
      file: path.relative(VROOT, d.file!.fileName),
      line: d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1,
      code: d.code,
      text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const expected = files
    .filter((f) => !f.path.includes('node_modules'))
    .flatMap((f) => pageMarkers(f.code).map((m) => ({ file: f.path, ...m })))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  expect(
    actual.map(({ file, line, code }) => ({ file, line, code })),
    `компилятор разошёлся с пометками:\n${actual.map((d) => `  ${d.file}:${d.line} ts(${d.code}) ${d.text}`).join('\n')}`,
  ).toEqual(expected);
}

/** Типы стираются — и остаётся JS, который можно выполнить. Возвращает то, что напечатано. */
const requireFromProject = createRequire(path.join(process.cwd(), 'package.json'));

function execute(source: string): unknown[] {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  new Function('require', 'exports', 'console', js)(requireFromProject, {}, fakeConsole);
  return printed;
}

describe('третий проход · раздел 1: .d.ts без проверки и слияние объявлений', () => {
  it('`isolatedDeclarations`: ошибки ровно на тех строках, где тип не читается из текста', () => {
    // коды 9007/9010 — диагностика объявлений, её отдаёт getDeclarationDiagnostics, а не семантика
    const program = createProgram(ISOLATED_CODE, {
      isolatedDeclarations: true,
      declaration: true,
      noEmit: false,
      emitDeclarationOnly: true,
    });
    const all = [
      ...program.getSyntacticDiagnostics(),
      ...program.getSemanticDiagnostics(),
      ...program.getDeclarationDiagnostics(),
    ];
    const actual = all
      .map((d) => ({ line: d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1, code: d.code }))
      .sort((a, b) => a.line - b.line);
    expect(actual).toEqual(pageMarkers(ISOLATED_CODE));
  });

  it('без строк с ошибками `transpileDeclaration` по одному файлу даёт ровно напечатанный `.d.ts`', () => {
    const clean = ISOLATED_CODE.split('\n')
      .filter((line) => !PAGE_MARKER.test(line))
      .join('\n');
    const out = ts.transpileDeclaration(clean, {
      compilerOptions: { isolatedDeclarations: true, strict: true, target: ts.ScriptTarget.ES2022 },
    });
    expect(out.diagnostics ?? []).toEqual([]);
    expect(out.outputText).toBe(ISOLATED_DTS_CODE);
  });

  it('`interface` сливается, `type` — `ts(2300)`, сменить тип поля — `ts(2717)`', () => {
    checkPage(MERGE_CODE);
  });

  it('дополнение чужого модуля: `interface` сливается, `type` в дополнении — `ts(2300)`', () => {
    checkFiles(AUGMENT_FILES);
  });

  it('дополнение видно всей программе: без `auth.ts` та же строка `app.ts` падает с `ts(2339)`', () => {
    const app = AUGMENT_FILES.find((f) => f.path === 'src/app.ts')!;
    const userLine = app.code.split('\n').findIndex((l) => l.includes('req.user')) + 1;
    expect(userLine).toBeGreaterThan(0);
    const withoutAuth = AUGMENT_FILES.filter((f) => f.path !== 'src/auth.ts').map((f) =>
      f === app
        ? { ...f, code: f.code.split('\n').map((l, i) => (i + 1 === userLine ? `${l} // @ts(2339)` : l)).join('\n') }
        : f,
    );
    // пометка поставлена через `@ts(…)`, а `PAGE_MARKER` её тоже узнаёт — ему хватает `ts(NNNN)`
    checkFiles(withoutAuth);
  });

  it('типы высшего порядка через реестр: `ts(2315)` на заготовке, `map` возвращает нужный контейнер', () => {
    checkFiles(HKT_FILES);
    checkFiles([
      ...HKT_FILES,
      {
        path: 'src/assert.ts',
        code: `${HEAD}
import { arrayFunctor } from './kind';
import { boxFunctor, type Box } from './box';
const len = boxFunctor.map({ value: 'abc' }, (s) => s.length);
const up = arrayFunctor.map(['a', 'b'], (s) => s.toUpperCase());
type _1 = Expect<IsEqual<typeof len, Box<number>>>;
type _2 = Expect<IsEqual<typeof up, string[]>>;
`,
      },
    ]);
  });
});

describe('третий проход · раздел 2: тесты типов инструментом', () => {
  it('`expect-type`: провал — `ts(2344)` с разницей в тексте, лишняя `@ts-expect-error` — `ts(2578)`', () => {
    const found = checkPage(TYPE_TESTS_CODE, MODULES);
    expect(found.find((d) => d.code === 2344)?.text).toContain('"Expected: number, Actual: null"');
  });

  it('при выполнении `expectTypeOf` не проверяет ничего', () => {
    const { expectTypeOf } = requireFromProject('expect-type') as {
      expectTypeOf: (v: unknown) => { toEqualTypeOf: (v: unknown) => unknown };
    };
    expect(() => expectTypeOf(1).toEqualTypeOf('x')).not.toThrow();
  });
});

describe('третий проход · раздел 4: как найти медленный тип', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ts-slow-'));
  const tsc = requireFromProject.resolve('typescript/bin/tsc');
  const run = (file: string, code: string, extra: string[] = []): string => {
    writeFileSync(path.join(dir, file), code);
    return execFileSync(
      process.execPath,
      [tsc, '--ignoreConfig', '--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022', '--extendedDiagnostics', ...extra, file],
      { cwd: dir, encoding: 'utf8' },
    );
  };
  const counter = (out: string, name: string): number => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(out)?.[1]);

  it('`--extendedDiagnostics`: счётчики совпадают с таблицей на странице', () => {
    const slow = run('slow.ts', SLOW_CODE);
    const fast = run('fast.ts', FAST_CODE);
    expect(slow).not.toMatch(/error TS/);
    expect(fast).not.toMatch(/error TS/);
    expect({ types: counter(slow, 'Types'), instantiations: counter(slow, 'Instantiations') }).toEqual(SLOW_COUNTS.slow);
    expect({ types: counter(fast, 'Types'), instantiations: counter(fast, 'Instantiations') }).toEqual(SLOW_COUNTS.fast);
    // 8000 строк шаблона — нижняя граница разницы, она от версии компилятора не зависит
    expect(SLOW_COUNTS.slow.types - SLOW_COUNTS.fast.types).toBeGreaterThanOrEqual(8000);
  });

  it('`--generateTrace`: трасса записывает проверку файла, `types.json` — объединение из 8000 строк', () => {
    const out = run('slow.ts', SLOW_CODE, ['--generateTrace', 'trace']);
    expect(counter(out, 'Types')).toBe(SLOW_COUNTS.slowTraced.types);

    const trace = JSON.parse(readFileSync(path.join(dir, 'trace', 'trace.json'), 'utf8')) as {
      cat: string;
      name: string;
      args?: { path?: string; pos?: number; end?: number; sourceId?: number };
    }[];
    const inFile = trace.filter((e) => e.cat === 'check' && e.args?.path?.endsWith('/slow.ts'));
    // проверка файла пишется началом и концом всегда — по ней видно, что трасса о нашем файле
    expect(inFile.filter((e) => e.name === 'checkSourceFile').length).toBeGreaterThanOrEqual(2);
    // Всё, что ниже уровня файла, трасса пишет ВЫБОРОЧНО (правило — в последней проверке блока):
    // шаг попадает в запись, если на него пришлась граница 10-мс интервала, а не потому, что
    // он долгий. Поэтому ни положение `checkExpression`, ни ссылку сравнения на объединение
    // закрепить нельзя: в пяти прогонах вызов `cls('1-2-3')` попал в трассу дважды, а ссылки
    // на тип из 8000 строк не было ни разу. Закрепляется детерминированное: проверка файла
    // и само объединение в `types.json`.
    // (Прежняя проверка «все записанные выражения внутри вызова» мигала под нагрузкой и
    // чаще всего проходила впустую — на пустом списке. Поймано 2026-09-28.)
    // Событий `structuredTypeRelatedTo` может не оказаться вовсе: они тоже выборочные
    // (поймано в общем прогоне 2026-09-28 — второй раз за день). Если попали, у них есть номера типов.
    const rel = trace.filter((e) => e.name === 'structuredTypeRelatedTo');
    for (const e of rel) expect(typeof e.args?.sourceId, 'у события сравнения нет sourceId').toBe('number');

    const types = JSON.parse(readFileSync(path.join(dir, 'trace', 'types.json'), 'utf8')) as { unionTypes?: number[] }[];
    expect(types.filter((t) => t.unionTypes?.length === 8000)).toHaveLength(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it('трасса пишет короткие шаги выборочно: интервал выборки в компиляторе — 10 мс', () => {
    // В TRACE_STEPS сказано «через раз» — это правило из исходника `tsc`, а не догадка по прогонам
    const source = readFileSync(requireFromProject.resolve('typescript/lib/_tsc.js'), 'utf8');
    expect(source).toContain('const sampleInterval = 1e3 * 10;');
    expect(source).toContain('sampleInterval - time % sampleInterval <= endTime - time');
  });
});

describe('третий проход · раздел 5: полиморфный `this` и схемы', () => {
  it('`this` в возврате держит цепочку, имя класса её рвёт — и код при этом работает', () => {
    checkPage(THIS_CODE, WITH_CONSOLE);
    expect(execute(THIS_CODE)).toEqual(THIS_OUT);
  });

  it('`this` обязывает в возврате, сужает на входе, а `this`-параметр требует объекта', () => {
    checkPage(THIS_MORE_CODE);
  });

  it('самодельная схема: тип выводится из описания, проверка работает при выполнении', () => {
    checkPage(SCHEMA_CODE, WITH_CONSOLE);
    checkPage(`${SCHEMA_CODE}\n${HEAD}\ntype _1 = Expect<IsEqual<User, { id: string; age: number }>>;`, WITH_CONSOLE);
    expect(execute(SCHEMA_CODE)).toEqual(SCHEMA_OUT);
  });

  it('zod: `z.infer`, `safeParse` с путём к полю и бренд, который не получить присваиванием', () => {
    checkPage(ZOD_CODE, { ...MODULES, ...WITH_CONSOLE });
    checkPage(
      `${ZOD_CODE}\n${HEAD}\ntype _1 = Expect<IsEqual<User, { id: string; age: number }>>;`,
      { ...MODULES, ...WITH_CONSOLE },
    );
    expect(execute(ZOD_CODE)).toEqual(ZOD_OUT);
  });

  it('поля `_zod.output` при выполнении нет — `z.infer` читает его только компилятор', () => {
    const { z } = requireFromProject('zod') as { z: { object: (s: object) => { _zod: object } } };
    const schema = z.object({});
    expect(typeof schema._zod).toBe('object');
    expect('output' in schema._zod).toBe(false);
  });
});

/**
 * Раздел 1 · «Стирание — и то, что его переживает». Блок `ERASURE_*` был снят однажды руками
 * (`tsc` 6.0.3 с эмитом и с `--erasableSyntaxOnly`, `node <файл>.ts` на Node 26.8.2) и стоял
 * с пометкой «сторожем не закреплено». Здесь тот же прогон повторяется на каждом запуске:
 * компилятор — `typescript` из `node_modules` проекта (6.0.3 на момент записи, версия проверяется
 * первой строкой), Node — тот, что гоняет тесты.
 *
 * Фикстуры — по одной на строку `ERASURE_ROWS`, ключ строки совпадает с ключом фикстуры:
 * так таблица на странице и прогон не могут разойтись составом. Фрагменты вывода, которые
 * проверяются в эмите, берутся **из самой схемы `ERASURE_CODE`**: если схема обещает
 * `Level[Level["Low"] = 0] = "Low";`, компилятор обязан это напечатать.
 *
 * ⚠️ Байты «188 против 43» из `ERASURE_NOTES` дословно не воспроизводятся: исходник той
 * фикстуры в теме не записан, а число байт зависит от каждого пробела в нём. Закреплено
 * отношение — файл с `enum` в разы тяжелее файла с объединением строк, — и оно же
 * сверяется с числами текста. Детерминированное число есть одно: 11 байт `export {};\n`.
 */
describe('раздел 1 · стирание: что переживает компиляцию', () => {
  const ERASURE_FIXTURES: Record<string, string> = {
    '`enum`': 'export enum Level { Low, High }\n',
    '`namespace` со значением': 'export namespace Config {\n  export const limit = 10;\n}\n',
    'параметр-свойство': 'export class User {\n  constructor(private id: string) {}\n}\n',
    '`const enum`': 'const enum Flag { On = 1 }\nexport const v = Flag.On;\n',
    '`namespace` только с типами': 'export namespace Shapes {\n  export type Point = { x: number };\n}\n',
    '`declare enum`': 'declare enum Remote { A, B }\nexport {};\n',
    '`interface`, `type`, `as`, `satisfies`, `unique symbol`':
      "interface Point { x: number }\ntype Mode = 'dark' | 'light';\n" +
      "declare const tag: unique symbol;\nconst p = ({ x: 1 } satisfies Point) as Point;\nexport {};\n",
  };
  const SURVIVORS = ['`enum`', '`namespace` со значением', 'параметр-свойство', '`const enum`'];

  /** `tsc --target es2022 --module esnext --strict` с эмитом — в память, не на диск. */
  function emit(source: string): string {
    const program = createProgram(source, { noEmit: false, module: ts.ModuleKind.ESNext });
    let js = '';
    program.emit(undefined, (name, text) => {
      if (name.endsWith('.js')) js = text;
    });
    return js;
  }

  const codesUnderFlag = (source: string) =>
    diagnose(source, { erasableSyntaxOnly: true }).map((d) => d.code);

  it('компилятор — тот, на котором снята тема', () => {
    expect(ts.version).toBe('6.0.3');
  });

  it('у каждой строки таблицы есть фикстура, и наоборот', () => {
    expect(ERASURE_ROWS.map((r) => r.k).sort()).toEqual(Object.keys(ERASURE_FIXTURES).sort());
    // «кроме четырёх конструкций»: четыре строки не зелёные — ровно те, что переживают стирание
    expect(ERASURE_ROWS.filter((r) => r.tone !== 'ok').map((r) => r.k).sort()).toEqual([...SURVIVORS].sort());
  });

  it('схема MECHANISMS_CODE обещает стирание типов, а не всего синтаксиса', () => {
    // Было «tsc выбрасывает всё и отдаёт движку чистый JS»; правка — в оговорке про четвёрку.
    expect(MECHANISMS_CODE).toContain('кроме четырёх конструкций');
    expect(MECHANISMS_CODE).not.toContain('выбрасывает всё');
    const mdx = readFileSync(path.join(process.cwd(), 'src/content/tooling/typescript/index.mdx'), 'utf8');
    expect(mdx).toContain('стираются типы, а не весь синтаксис');
  });

  it('enum, namespace со значением и параметр-свойство оставляют в .js код, напечатанный на схеме', () => {
    const squash = (s: string) => s.replace(/\s+/g, '');
    const expected: [string, string[]][] = [
      ['`enum`', ['export var Level;', 'Level[Level["Low"] = 0] = "Low";', '})(Level || (Level = {}));']],
      ['`namespace` со значением', ['export var Config;', 'Config.limit = 10;', '})(Config || (Config = {}));']],
      ['параметр-свойство', ['id;', 'this.id = id;']],
    ];
    for (const [key, fragments] of expected) {
      const js = emit(ERASURE_FIXTURES[key]);
      for (const fragment of fragments) {
        expect(ERASURE_CODE, `схема не печатает ${fragment}`).toContain(fragment);
        expect(squash(js), `${key}: в .js нет ${fragment}`).toContain(squash(fragment));
      }
    }
    // IIFE — «немедленно вызываемая функция»: и у enum, и у namespace она в выводе
    expect(emit(ERASURE_FIXTURES['`enum`'])).toContain('(function (Level) {');
    expect(emit(ERASURE_FIXTURES['`namespace` со значением'])).toContain('(function (Config) {');
  });

  it('const enum: объявления нет, значение подставлено по месту', () => {
    const js = emit(ERASURE_FIXTURES['`const enum`']);
    expect(js).not.toMatch(/\bvar Flag\b|\(function \(Flag\)/);
    expect(js).toContain('const v = 1 /* Flag.On */;');
    expect(ERASURE_CODE).toContain('const v = 1 /* Flag.On */;');
    expect(ERASURE_NOTES[1]).toContain('`1 /* Flag.On */`');
  });

  it('конструкции из одних типов оставляют только `export {};` — 11 байт', () => {
    for (const key of ['`namespace` только с типами', '`declare enum`']) {
      const js = emit(ERASURE_FIXTURES[key]);
      expect(js, key).toBe('export {};\n');
      expect(Buffer.byteLength(js), key).toBe(11);
    }
    expect(ERASURE_ROWS.find((r) => r.k === '`namespace` только с типами')?.js).toContain('11 байт');
  });

  it('interface, type, as, satisfies, unique symbol не добавляют ни строки — остаётся только значение', () => {
    const js = emit(ERASURE_FIXTURES['`interface`, `type`, `as`, `satisfies`, `unique symbol`']);
    expect(js).toBe('const p = { x: 1 };\nexport {};\n');
    expect(ERASURE_CODE).toContain('const p = { x: 1 };');
  });

  it('enum в рантайме — объект с обратной связью: четыре ключа на два члена', () => {
    const js = ts.transpileModule(ERASURE_FIXTURES['`enum`'], {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: { Level?: Record<string, unknown> } = {};
    new Function('exports', js)(exports);
    expect(Object.keys(exports.Level!)).toEqual(['0', '1', 'Low', 'High']);
    expect(exports.Level![0]).toBe('Low');
    expect(ERASURE_NOTES[0]).toContain('`["0","1","Low","High"]`');
  });

  it('файл с enum в разы тяжелее того же файла на объединении строк — и текст говорит то же', () => {
    const enumJs = emit('export enum Level { Low, High }\nexport const isHigh = (l: Level) => l === Level.High;\n');
    const unionJs = emit("export type Level = 'low' | 'high';\nexport const isHigh = (l: Level) => l === 'high';\n");
    expect(unionJs).toBe("export const isHigh = (l) => l === 'high';\n");
    const ratio = Buffer.byteLength(enumJs) / Buffer.byteLength(unionJs);
    expect(ratio).toBeGreaterThan(3);

    // Числа текста дословно не проверить (см. докстринг) — проверяется, что они о том же.
    const [enumBytes, unionBytes] = [...ERASURE_NOTES[0].matchAll(/\*\*(\d+)(?: байт)?\*\*/g)].map((m) => Number(m[1]));
    expect(enumBytes / unionBytes).toBeGreaterThan(3);
  });

  it('--erasableSyntaxOnly: ts(1294) ровно на четырёх, остальные молчат', () => {
    for (const row of ERASURE_ROWS) {
      const codes = codesUnderFlag(ERASURE_FIXTURES[row.k]);
      if (SURVIVORS.includes(row.k)) {
        expect(codes, row.k).toContain(1294);
        expect(row.flag, row.k).toBe('`ts(1294)`');
      } else {
        expect(codes, row.k).toEqual([]);
        expect(row.flag, row.k).toBe('молчит');
      }
    }
    expect(ERASURE_FLAG_NOTE).toContain('`ts(1294)`');
  });

  it('node <файл>.ts: четыре отвергнуты с ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, три выполнены', () => {
    // Отдельный процесс: стирание встроено в загрузчик Node, в процессе vitest его не видно.
    const dir = mkdtempSync(path.join(tmpdir(), 'lesson-erasure-'));
    try {
      for (const row of ERASURE_ROWS) {
        const file = path.join(dir, `f${ERASURE_ROWS.indexOf(row)}.ts`);
        writeFileSync(file, ERASURE_FIXTURES[row.k]);
        let failure = '';
        try {
          execFileSync(process.execPath, [file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
          failure = String((error as { stderr?: string }).stderr);
        }
        if (SURVIVORS.includes(row.k)) {
          expect(failure, row.k).toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
          expect(row.node, row.k).toBe('отказ');
        } else {
          expect(failure, row.k).toBe('');
          expect(row.node, row.k).toBe('запускает');
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(ERASURE_FLAG_NOTE).toContain('четыре отвергнуты с `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, три выполнены');
  });
});

/**
 * Четвёртый проход (октябрь 2026): разделы «Сужение» и «Классы», `type` против `interface`
 * и пакет без типов. Материал — из отложенного видеокурса автора («Union», «Type Guard»,
 * «Types или Interfaces», классы, миксины, декораторы, «Типизация сторонних библиотек»);
 * всё, что видео утверждают, перепроверено здесь компилятором и исполнением.
 */
describe('четвёртый проход · раздел 1: `type` против `interface` и пакет без типов', () => {
  it('extends ругается на конфликт полей, & молча даёт never, интерфейс не идёт в Record', () => {
    checkPage(TYPE_IFACE_CODE);
  });

  /** Пометки в `app.ts` описывают два разных прогона — оставляем только нужную. */
  const appWith = (keep: number | null) => ({
    ...UNTYPED_FILES.app,
    code: UNTYPED_FILES.app.code
      .split('\n')
      .map((l) => {
        const hit = PAGE_MARKER.exec(l);
        if (!hit) return l;
        const bare = l.slice(0, l.indexOf('//')).trimEnd();
        return keep !== null && l.includes(`ts(${keep})`) ? `${bare} // ts(${keep})` : bare;
      })
      .join('\n'),
  });

  it('без объявлений — ts(7016) на импорте', () => {
    checkFiles([UNTYPED_FILES.pkg, appWith(7016)]);
  });

  it('короткое `declare module` глушит ошибку вместе с проверкой: slugify(42) молчит', () => {
    checkFiles([UNTYPED_FILES.pkg, appWith(null), UNTYPED_FILES.short]);
  });

  it('полное объявление возвращает проверку: slugify(42) — ts(2345)', () => {
    checkFiles([UNTYPED_FILES.pkg, appWith(2345), UNTYPED_FILES.full]);
  });

  it('на странице все четыре файла', () => {
    for (const f of Object.values(UNTYPED_FILES)) expect(UNTYPED_CODE).toContain(f.code);
  });
});

describe('четвёртый проход · раздел «Сужение»', () => {
  it('встроенные проверки и четыре ловушки — коды на тех строках, где обещано', () => {
    checkPage(NARROW_BASICS_CODE);
  });

  it('у каждой ловушки из таблицы есть строка в примере', () => {
    expect(NARROW_BASICS_CODE).toContain("typeof x === 'object'");
    expect(NARROW_BASICS_CODE).toContain('Array.isArray(x)');
    expect(NARROW_BASICS_CODE).toContain('instanceof Fish');
    expect(NARROW_ROWS.length).toBe(7);
  });

  it('размеченное объединение: поле вне ветки — ts(2339), забытый случай — ts(2345)', () => {
    checkPage(STATE_CODE);
  });

  it('предикаты и asserts сужают, стрелка выводит предикат сама', () => {
    checkPage(GUARD_CODE);
    checkPage(`${GUARD_CODE}\n${HEAD}\nconst got = ['a', 1, 'b'].filter(isStr);\ntype _1 = Expect<IsEqual<typeof got, string[]>>;`);
  });

  it('сужение поля переживает вызов, замыкание его теряет, filter(Boolean) не сужает', () => {
    checkPage(NARROW_LIES_CODE, WITH_CONSOLE);
    expect(execute(NARROW_LIES_CODE)).toEqual(NARROW_LIES_OUT);
  });

  it('без строки `theme = 1` сужение в замыкании сохраняется (5.4)', () => {
    const lines = NARROW_LIES_CODE.split('\n');
    const kept = lines
      .filter((l) => !l.startsWith('theme = 1') && !l.startsWith('try { later'))
      .map((l) => (l.includes('theme.toUpperCase') ? l.slice(0, l.indexOf('//')).trimEnd() : l))
      .join('\n');
    // в модуле: в глобальном скрипте `let` может переписать любой другой скрипт
    checkPage(`export {};\n${kept}`, WITH_CONSOLE);
    checkPage(kept.replace("later.push(() => theme.toUpperCase());", "later.push(() => theme.toUpperCase());   // ts(2339)"), WITH_CONSOLE);
  });
});

describe('четвёртый проход · раздел «Классы»', () => {
  it('private — проверка компилятора, # — движка, readonly стирается', () => {
    checkPage(CLASS_PRIVATE_CODE, WITH_CONSOLE);
    const runnable = CLASS_PRIVATE_CODE.replace(/^acc\.#secret.*$/m, '');
    expect(execute(runnable)).toEqual(CLASS_PRIVATE_OUT);
  });

  it('файл с чужим `acc.#secret` движок не разбирает вовсе', () => {
    const js = ts.transpileModule(CLASS_PRIVATE_CODE, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    expect(() => new Function(js)).toThrow(SyntaxError);
  });

  it('при target ниже ES2022 `#secret` превращается в WeakMap, а `private` — в обычное поле', () => {
    const js = ts.transpileModule(CLASS_PRIVATE_CODE.replace(/^acc\.#secret.*$/m, ''), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2015 },
    }).outputText;
    expect(js).toContain('new WeakMap()');
    expect(js).toContain("this.pin = '1234'");
  });

  it('implements не передаёт типов, метод проверяется в обе стороны, abstract запрещает new', () => {
    checkPage(CLASS_CONTRACT_CODE);
  });

  it('потерянный this: молча и TypeError, this-параметр — ts(2684), стрелка — поле экземпляра', () => {
    checkPage(THIS_LOST_CODE, WITH_CONSOLE);
    expect(execute(THIS_LOST_CODE)).toEqual(THIS_LOST_OUT);
  });

  it('миксины: конструктор и цепочка сохраняются, требования к классу проверяются', () => {
    checkPage(MIXIN_CODE, WITH_CONSOLE);
    expect(execute(MIXIN_CODE)).toEqual(MIXIN_OUT);
  });

  it('конструктор миксина обязан быть `...args: any[]` — иначе ts(2545)', () => {
    checkPage(`type Ctor2<T = {}> = new (...args: string[]) => T;
function Broken<B extends Ctor2>(Base: B) { return class extends Base {}; }   // ts(2545)`);
  });

  it('типизированный декоратор: несовпадение запасного значения — ts(1241), вывод сходится', () => {
    checkPage(DECORATOR_CODE, WITH_CONSOLE);
    expect(execute(DECORATOR_CODE)).toEqual(DECORATOR_OUT);
  });

  describe('что компилятор пишет вместо декоратора', () => {
    const clean = DECORATOR_CODE.split('\n')
      .filter((l, i, all) => !l.includes('title()') && !(all[i + 1] ?? '').includes('title()'))
      .join('\n');
    const emitWith = (extra: ts.CompilerOptions) =>
      ts.transpileModule(clean, {
        compilerOptions: { module: ts.ModuleKind.ESNext, ...extra },
      }).outputText;

    it('ES2022: помощники и файл в несколько раз больше исходника', () => {
      const js = emitWith({ target: ts.ScriptTarget.ES2022 });
      expect(js).toContain('__esDecorate');
      expect(js).toContain('__runInitializers');
      expect(js.length / clean.length).toBeGreaterThanOrEqual(3);
    });

    it('ESNext: декоратор остаётся как есть, и Node его не разбирает', () => {
      const js = emitWith({ target: ts.ScriptTarget.ESNext });
      expect(js).toContain('@catchErrors([])');
      expect(js).not.toContain('__esDecorate');
      expect(() => new Function(js)).toThrow(SyntaxError);
    });

    it('experimentalDecorators: __decorate вместо __esDecorate', () => {
      const js = emitWith({ target: ts.ScriptTarget.ES2022, experimentalDecorators: true });
      expect(js).toContain('__decorate');
      expect(js).not.toContain('__esDecorate');
    });

    it('emitDecoratorMetadata: класс доезжает именем, интерфейс, type и объединение — Object', () => {
      const js = ts.transpileModule(LEGACY_DECORATOR_CODE, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      }).outputText;
      expect(js).toContain(LEGACY_EMIT);
      checkPage(LEGACY_DECORATOR_CODE, { experimentalDecorators: true, emitDecoratorMetadata: true, ...MODULES });
    });
  });
});
