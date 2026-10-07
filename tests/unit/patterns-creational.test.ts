import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/patterns/creational/data';

/**
 * Утверждения темы «Создание объектов» — компилятором и исполнением.
 *
 * Каждый пример — строка из `data.ts`, та самая, что напечатана на странице:
 *   — компиляция `tsc` со `strict`; ошибки сверяются с пометками `// ts(NNNN)` по строкам,
 *     строки без пометки обязаны остаться чистыми;
 *   — исполнение: TypeScript стирается `transpileModule`, код выполняется в асинхронной функции
 *     (у примеров есть `await` верхнего уровня), `console.log` подменён — сверяется вывод;
 *   — примеры про кеш модулей и копии пакетов раскладываются во временную папку и запускаются
 *     настоящим `node`: в процессе vitest модули грузит не Node, а Vite.
 */

const FILE = 'fixture.ts';
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  types: [],
  skipLibCheck: true,
};

const libCache = new Map<string, ts.SourceFile>();

function diagnose(source: string): { line: number; code: number; text: string }[] {
  const host = ts.createCompilerHost(OPTIONS, true);
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
  const program = ts.createProgram([FILE], OPTIONS, host);
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

/** Стереть типы и выполнить; вернуть то, что напечатано. Строки с ошибкой компиляции выполняются как есть. */
async function execute(source: string, drop: RegExp[] = []): Promise<unknown[]> {
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
  await new AsyncFunction('console', js)(fakeConsole);
  return printed;
}

/** Строки, которые компилятор отвергает, при выполнении бросили бы — их выкидываем. */
const COMPILE_ONLY = [/ts\((2511|2345|2673|2684)\)/];

/** Разложить файлы во временной папке и запустить `node <entry>`; вернуть строки вывода. */
function runNode(files: Record<string, string>, entry: string): string[] {
  const dir = mkdtempSync(path.join(tmpdir(), 'patterns-'));
  try {
    for (const [rel, code] of Object.entries(files)) {
      const full = path.join(dir, rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, code);
    }
    return execFileSync(process.execPath, [entry], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('раздел 1 · зачем', () => {
  it('исходный код с размазанным `new` компилируется', () => {
    checkPage(t.PROBLEM_CODE);
  });
});

describe('раздел 2 · фабрика', () => {
  it('фабричный метод: наследник сужает тип возврата, абстрактную фабрику не создать', async () => {
    checkPage(t.FACTORY_CLASSIC_CODE);
    expect(await execute(t.FACTORY_CLASSIC_CODE, COMPILE_ONLY)).toEqual(t.FACTORY_CLASSIC_OUT);
  });

  it('реестр: наивный дженерик — ts(2339), InstanceType — ts(2322), карта типов сходится', async () => {
    checkPage(t.FACTORY_REGISTRY_CODE);
    expect(await execute(t.FACTORY_REGISTRY_CODE, COMPILE_ONLY)).toEqual(t.FACTORY_REGISTRY_OUT);
  });

  it('lib.dom типизирует createElement тем же приёмом: карта тегов', () => {
    const dom = readFileSync(path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.dom.d.ts'), 'utf8');
    expect(dom).toMatch(/createElement<K extends keyof HTMLElementTagNameMap>\(tagName: K[^)]*\): HTMLElementTagNameMap\[K\]/);
  });

  it('фабричная функция: методы у каждого свои, this терять нечего', async () => {
    checkPage(t.FACTORY_FN_CODE);
    expect(await execute(t.FACTORY_FN_CODE)).toEqual(t.FACTORY_FN_OUT);
  });

  it('ключ `constructor` молча создаёт {}, `Object.hasOwn` его отвергает', async () => {
    checkPage(t.REGISTRY_KEY_CODE);
    expect(await execute(t.REGISTRY_KEY_CODE)).toEqual(t.REGISTRY_KEY_OUT);
  });
});

describe('раздел 3 · строитель', () => {
  it('заготовка копит чужие шаги: 2 и 4', async () => {
    checkPage(t.BUILDER_CODE);
    expect(await execute(t.BUILDER_CODE)).toEqual(t.BUILDER_OUT);
  });

  it('неизменяемый строитель: 2 и 2', async () => {
    checkPage(t.FROZEN_BUILDER_CODE);
    expect(await execute(t.FROZEN_BUILDER_CODE)).toEqual(t.FROZEN_BUILDER_OUT);
  });

  it('build() без размера — ts(2684), порядок шагов любой', () => {
    checkPage(t.STRICT_BUILDER_CODE);
  });

  it('без поля `state` проверка молча пропускает всё, а само поле в .js не попадает', () => {
    const withoutState = t.STRICT_BUILDER_CODE.split('\n')
      .filter((l) => !l.includes('declare private readonly state'))
      .map((l) => (l.includes('ts(2684)') ? l.slice(0, l.indexOf('//')).trimEnd() : l))
      .join('\n');
    checkPage(withoutState);
    const js = ts.transpileModule(t.STRICT_BUILDER_CODE, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    expect(js).not.toMatch(/\bstate\b/);
  });
});

describe('раздел 4 · прототип', () => {
  it('четыре способа скопировать экземпляр с #-полем', async () => {
    checkPage(t.CLONE_CODE);
    expect(await execute(t.CLONE_CODE)).toEqual(t.CLONE_OUT);
  });

  it('строка про JSON в таблице: Date стал строкой, Map — {}, undefined пропал', () => {
    const copy = JSON.parse(JSON.stringify({ d: new Date('2026-01-01'), m: new Map([[1, 2]]), u: undefined }));
    expect(typeof copy.d).toBe('string');
    expect(copy.m).toEqual({});
    expect('u' in copy).toBe(false);
    expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
  });

  it('structuredClone: функцию не копирует — DataCloneError', () => {
    let name = '';
    try {
      structuredClone({ f: () => 1 });
    } catch (e) {
      name = (e as Error).name;
    }
    expect(name).toBe('DataCloneError');
  });

  it('копия из видеокурса делит Date с оригиналом', async () => {
    checkPage(t.SHARED_DATE_CODE);
    expect(await execute(t.SHARED_DATE_CODE)).toEqual(t.SHARED_DATE_OUT);
  });
});

describe('раздел 5 · одиночка', () => {
  it('private constructor — ts(2673), а в .js второй экземпляр создаётся', async () => {
    checkPage(t.SINGLETON_CLASS_CODE);
    expect(await execute(t.SINGLETON_CLASS_CODE, COMPILE_ONLY)).toEqual(t.SINGLETON_CLASS_OUT);
  });

  it('модуль выполняется один раз на адрес: `?v=2` — второй экземпляр', () => {
    const files = Object.fromEntries(t.MODULE_FILES.map((f) => [f.path, f.code]));
    expect(runNode(files, 'main.mjs')).toEqual(t.MODULE_OUT);
  });

  it('две копии пакета — две карты и два класса, Symbol.for сводит в одну', () => {
    const lib = t.DUPLICATE_FILES.find((f) => f.path.endsWith('cache-lib/index.mjs'))!.code;
    const app = t.DUPLICATE_FILES.find((f) => f.path === 'app.mjs')!.code;
    const files: Record<string, string> = { 'app.mjs': app };
    for (const owner of ['widgets', 'charts']) {
      files[`node_modules/${owner}/package.json`] = JSON.stringify({ name: owner, type: 'module', main: 'index.mjs' });
      files[`node_modules/${owner}/index.mjs`] = "export * from 'cache-lib';\n";
      files[`node_modules/${owner}/node_modules/cache-lib/package.json`] = JSON.stringify({
        name: 'cache-lib',
        type: 'module',
        main: 'index.mjs',
      });
      files[`node_modules/${owner}/node_modules/cache-lib/index.mjs`] = lib;
    }
    expect(runNode(files, 'app.mjs')).toEqual(t.DUPLICATE_OUT);
  });

  it('состояние модуля на сервере: Аня видит профиль Бориса', async () => {
    checkPage(t.SSR_LEAK_CODE);
    expect(await execute(t.SSR_LEAK_CODE)).toEqual(t.SSR_LEAK_OUT);
  });
});

describe('тонкие места', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });

  it('abstract и private constructor стираются: в .js нет ни слова', () => {
    const js = ts.transpileModule(t.SINGLETON_CLASS_CODE + '\n' + t.FACTORY_CLASSIC_CODE, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    expect(js).not.toMatch(/\babstract\b|\bprivate\b/);
  });
});
