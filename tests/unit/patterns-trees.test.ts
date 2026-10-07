import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/patterns/trees/data';

/**
 * Утверждения темы «Деревья и обход: компоновщик и итератор» — компилятором и исполнением.
 *
 * Каждый пример — строка из `data.ts`, та самая, что напечатана на странице:
 *   — компиляция `tsc` со `strict` и `lib` ES2025 + DOM; ошибки сверяются с пометками
 *     `// ts(NNNN)` по строкам, строки без пометки обязаны остаться чистыми;
 *   — исполнение: TypeScript стирается `transpileModule`, код выполняется в асинхронной функции,
 *     `console.log` подменён — сверяется вывод;
 *   — примеры раздела «Обход» продолжают дерево заказа из `UNION_CODE` и проверяются склейкой;
 *   — пределы стека — отдельным процессом `node`: в нём стек по умолчанию, а не тот, что у vitest.
 */

const FILE = 'fixture.ts';
const BASE_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  lib: ['lib.es2025.d.ts', 'lib.dom.d.ts'],
  types: [],
  skipLibCheck: true,
};

const libCache = new Map<string, ts.SourceFile>();

function diagnose(source: string, options: ts.CompilerOptions = BASE_OPTIONS): { line: number; code: number; text: string }[] {
  const host = ts.createCompilerHost(options, true);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version, onError, shouldCreate) => {
    if (name === FILE) return ts.createSourceFile(name, source, version, true);
    const cached = libCache.get(name);
    if (cached) return cached;
    const file = read(name, version, onError, shouldCreate);
    if (file) libCache.set(name, file);
    return file;
  };
  host.fileExists = (name) => name === FILE || ts.sys.fileExists(name);
  host.readFile = (name) => (name === FILE ? source : ts.sys.readFile(name));
  const program = ts.createProgram([FILE], options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
    .map((d) => ({
      line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
      code: d.code,
      text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    }))
    .sort((a, b) => a.line - b.line || a.code - b.code);
}

function markers(source: string): { line: number; code: number }[] {
  return source.split('\n').flatMap((line, i) => {
    const at = line.indexOf('//');
    if (at < 0) return [];
    return [...line.slice(at).matchAll(/\bts\((\d+)\)/g)].map((m) => ({ line: i + 1, code: Number(m[1]) }));
  });
}

function checkPage(source: string): void {
  const actual = diagnose(source);
  const report = actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n') || '  (тишина)';
  expect(
    actual.map(({ line, code }) => ({ line, code })),
    `компилятор разошёлся с пометками на странице:\n${report}`,
  ).toEqual(markers(source));
}

/** Стереть типы и выполнить; вернуть то, что напечатано. `globals` — имена, видимые коду (DOM). */
async function execute(source: string, drop: RegExp[] = [], globals: Record<string, unknown> = {}): Promise<unknown[]> {
  const cleaned = source
    .split('\n')
    .filter((l) => !drop.some((re) => re.test(l)))
    .join('\n');
  const js = ts.transpileModule(cleaned, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export \{\};?\s*$/m, '');
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', ...Object.keys(globals), js)(fakeConsole, ...Object.values(globals));
  return printed;
}

/** Строки, которые компилятор отвергает, при выполнении бросили бы — их выкидываем. */
const COMPILE_ONLY = [/ts\((2488)\)/];

/** Выполнить JS отдельным процессом `node` (стек по умолчанию); вернуть строки вывода. */
function runNode(code: string): string[] {
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim().split('\n');
}

describe('раздел 1 · зачем', () => {
  it('два вложенных цикла теряют упаковку в упаковке: 1600 вместо 1630', async () => {
    checkPage(t.PROBLEM_CODE);
    expect(await execute(t.PROBLEM_CODE)).toEqual(t.PROBLEM_OUT);
  });
});

describe('раздел 2 · компоновщик', () => {
  it('компоновщик из курса: 1630 за заказ, а вложенное в товар молча потеряно', async () => {
    checkPage(t.COMPOSITE_CODE);
    expect(await execute(t.COMPOSITE_CODE)).toEqual(t.COMPOSITE_OUT);
  });

  it('объединение: та же цена, дерево переживает JSON, лист с items — ts(2353)', async () => {
    checkPage(t.UNION_CODE);
    expect(await execute(t.UNION_CODE)).toEqual(t.UNION_OUT);
  });

  it('switch без ветки для нового вида узла не компилируется — ts(2366)', () => {
    const lines = t.UNION_CODE.split('\n');
    const shopCase = lines.findIndex((l) => l.includes("case 'shop':"));
    expect(shopCase).toBeGreaterThan(0);
    const codes = diagnose(lines.filter((_, i) => i !== shopCase).join('\n')).map((d) => d.code);
    expect(codes).toContain(2366);
  });

  it('DOM: Text.appendChild компилируется — метод объявлен у Node', () => {
    checkPage(t.DOM_CODE);
    const dom = readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.dom.d.ts'), 'utf8');
    const nodeIface = dom.slice(dom.indexOf('interface Node extends EventTarget {'));
    expect(nodeIface.slice(0, nodeIface.indexOf('\n}\n'))).toMatch(/appendChild<T extends Node>\(node: T\): T;/);
  });

  it('DOM: textContent и TreeWalker обходят поддерево (happy-dom)', async () => {
    const win = new Window();
    try {
      const out = await execute(t.DOM_CODE, [/appendChild/], { document: win.document, NodeFilter: win.NodeFilter });
      expect(out).toEqual(t.DOM_OUT);
    } finally {
      await win.happyDOM.close();
    }
  });

  it('happy-dom 20.14.5 пропускает вставку в текстовый узел — Chromium и спецификация бросают HierarchyRequestError', async () => {
    // Расхождение закреплено, чтобы happy-dom не приняли за стенд для этой строки темы.
    // Починят в happy-dom — тест покраснеет, и шапку data.ts надо поправить.
    const win = new Window();
    try {
      const text = win.document.createTextNode('лист');
      expect(() => text.appendChild(win.document.createElement('b'))).not.toThrow();
    } finally {
      await win.happyDOM.close();
    }
  });
});

describe('раздел 3 · итератор', () => {
  it('итератор из курса переставляет список и теряет первый элемент; for…of — ts(2488)', async () => {
    checkPage(t.COURSE_ITER_CODE);
    expect(await execute(t.COURSE_ITER_CODE, COMPILE_ONLY)).toEqual(t.COURSE_ITER_OUT);
  });

  it('на протоколе JS: обход по копии, список цел, обходы независимы', async () => {
    checkPage(t.NATIVE_ITER_CODE);
    expect(await execute(t.NATIVE_ITER_CODE)).toEqual(t.NATIVE_ITER_OUT);
  });

  it('помощники итераторов есть в Node без флагов', () => {
    expect(typeof Iterator.prototype.filter).toBe('function');
    expect(typeof Iterator.prototype.find).toBe('function');
    expect(typeof Iterator.prototype.toArray).toBe('function');
    expect(typeof Iterator.from).toBe('function');
  });
});

describe('раздел 4 · обход дерева', () => {
  const walk = t.UNION_CODE + '\n' + t.WALK_CODE;
  const flat = walk + '\n' + t.FLAT_CODE;

  it('рекурсивный генератор: порядок, сумма через помощники, find останавливается на четвёртом узле', async () => {
    checkPage(walk);
    expect(await execute(walk)).toEqual([...t.UNION_OUT, ...t.WALK_OUT]);
  });

  it('явный стек совпадает с рекурсией, push(...children) переворачивает, очередь — по уровням', async () => {
    checkPage(flat);
    expect(await execute(flat)).toEqual([...t.UNION_OUT, ...t.WALK_OUT, ...t.FLAT_OUT]);
  });

  it('JSON.parse строит 100 000 уровней, рекурсивный генератор падает, явный стек проходит', async () => {
    checkPage(t.DEEP_CODE);
    expect(await execute(t.DEEP_CODE)).toEqual(t.DEEP_OUT);
  });

  it('стек по умолчанию: рекурсивный генератор не доходит до 100 000 уровней, явный стек проходит миллион', () => {
    const js = ts.transpileModule(t.DEEP_CODE.slice(0, t.DEEP_CODE.indexOf('// ветка')), {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const probe = `${js}
const chain = (n) => { const root = { replies: [] }; let last = root; for (let i = 1; i < n; i++) last.replies.push((last = { replies: [] })); return root; };
const fails = (n) => { try { walk(chain(n)).toArray(); return false; } catch (e) { if (!(e instanceof RangeError)) throw e; return true; } };
console.log(fails(1000), fails(100000), walkFlat(chain(1000000)).toArray().length);`;
    expect(runNode(probe)).toEqual(['false true 1000000']);
  });

  it('yield* платит глубиной: цепочка из n узлов — n(n+3)/2 вызовов next', async () => {
    checkPage(t.COST_CODE);
    const proto = Object.getPrototypeOf(function* () {}.prototype);
    const next = proto.next;
    try {
      expect(await execute(t.COST_CODE)).toEqual(t.COST_OUT);
    } finally {
      proto.next = next;
    }
    for (const line of t.COST_OUT) {
      const [n, calls] = line.match(/\d+/g)!.map(Number);
      expect(calls).toBe((n * (n + 3)) / 2);
    }
  });
});

describe('раздел 5 · типы дерева', () => {
  it('id меню выведены из дерева: опечатка — ts(2345)', () => {
    checkPage(t.MENU_CODE);
  });

  it(`предел вывода: ${t.MENU_DEPTH.ok} уровней сходятся, ${t.MENU_DEPTH.fail} — ts(2321) и ts(2589)`, () => {
    const head = t.MENU_CODE.slice(0, t.MENU_CODE.indexOf('const MENU'));
    const ids = t.MENU_CODE.slice(t.MENU_CODE.indexOf('type Ids<T>'), t.MENU_CODE.indexOf('type MenuId'));
    const deep = (depth: number) => {
      let node = "{ id: 'n0', label: 'x' }";
      for (let i = 1; i < depth; i++) node = `{ id: 'n${i}', label: 'x', children: [${node}] }`;
      return `${head}const MENU = [${node}] as const satisfies readonly MenuItem[];\n${ids}type MenuId = Ids<typeof MENU>;\nconst first: MenuId = 'n0';\n`;
    };
    expect(diagnose(deep(t.MENU_DEPTH.ok))).toEqual([]);
    const codes = new Set(diagnose(deep(t.MENU_DEPTH.fail)).map((d) => d.code));
    expect(codes).toEqual(new Set([2321, 2589]));
  });

  it('рекурсивный генератор без аннотации — ts(7023)', () => {
    checkPage(t.GEN_TYPE_CODE);
  });

  it('с lib ES2022 помощники на генераторе — ts(2339)', () => {
    const source = t.UNION_CODE + '\n' + t.WALK_CODE;
    const codes = diagnose(source, { ...BASE_OPTIONS, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'] }).map((d) => d.code);
    expect(codes).toContain(2339);
  });

  it('lib.es2025.iterator описывает filter и toArray у IteratorObject', () => {
    const lib = readFileSync(
      path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.es2025.iterator.d.ts'),
      'utf8',
    );
    expect(lib).toMatch(/interface IteratorObject<T, TReturn, TNext> \{[\s\S]*filter[\s\S]*toArray\(\): T\[\];/);
  });
});

describe('тонкие места', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });

  it('Array.prototype.sort меняет массив на месте и возвращает его же, toSorted — копию', () => {
    const a = [8, 1, 3];
    expect(a.sort((x, y) => x - y)).toBe(a);
    const b = [8, 1, 3];
    expect(b.toSorted((x, y) => x - y)).not.toBe(b);
    expect(b).toEqual([8, 1, 3]);
  });
});
