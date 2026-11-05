import ts from 'typescript';
import { expect } from 'vitest';

/**
 * Сверка примера темы с настоящим компилятором TypeScript и его исполнение.
 *
 * Пример — строка из `data.ts`, та самая, что напечатана на странице. Ожидаемые ошибки помечены
 * на странице обычным комментарием `// … ts(NNNN)`: проверка требует, чтобы компилятор упал
 * именно на этой строке и именно этим кодом, а строки без пометки остались чистыми.
 *
 * Программа собирается в памяти из одного файла `fixture.ts`; разобранные `lib.*.d.ts`
 * переиспользуются между прогонами одного стенда — без кеша каждая программа платила бы
 * за них заново.
 */

/** Имя единственного файла программы в памяти. */
export const FILE = 'fixture.ts';

export interface Found {
  line: number;
  code: number;
}

export type Diagnostic = Found & { text: string };

/**
 * Пометки `ts(NNNN)` из комментариев примера: все коды после первого `//` строки —
 * декоратор, например, даёт два на одной строке.
 */
export function markers(source: string): Found[] {
  return source.split('\n').flatMap((line, i) => {
    const at = line.indexOf('//');
    if (at < 0) return [];
    return [...line.slice(at).matchAll(/\bts\((\d+)\)/g)].map((m) => ({ line: i + 1, code: Number(m[1]) }));
  });
}

/**
 * Стенд компилятора с базовыми опциями. `extra` у каждого вызова дописывается поверх `base`.
 * Кеш `lib.*.d.ts` — свой у каждого стенда (`libCache`), им же пользуются многофайловые
 * программы теста.
 */
export function tsHarness(base: ts.CompilerOptions) {
  const libCache = new Map<string, ts.SourceFile>();

  function createProgram(source: string, extra: ts.CompilerOptions = {}): ts.Program {
    const options: ts.CompilerOptions = { ...base, ...extra };
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

  /** Синтаксические и семантические ошибки, по строкам и кодам. */
  function diagnose(source: string, extra?: ts.CompilerOptions): Diagnostic[] {
    const program = createProgram(source, extra);
    return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()]
      .map((d) => ({
        line: d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0,
        code: d.code,
        text: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      }))
      .sort((a, b) => a.line - b.line || a.code - b.code);
  }

  /** Компилятор обязан совпасть с пометками на странице. Возвращает найденное — для уточнений текста. */
  function checkPage(source: string, extra?: ts.CompilerOptions): Diagnostic[] {
    const actual = diagnose(source, extra);
    const report = actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n') || '  (тишина)';
    expect(
      actual.map(({ line, code }) => ({ line, code })),
      `компилятор разошёлся с пометками на странице:\n${report}`,
    ).toEqual(markers(source));
    return actual;
  }

  return { libCache, createProgram, diagnose, checkPage };
}

/** Стереть типы: ES2022 + ESM, без хвостового `export {}`. */
export function toJs(source: string): string {
  return ts
    .transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    .outputText.replace(/^export \{\};?\s*$/m, '');
}

/**
 * Стереть типы и выполнить в асинхронной функции (у примеров есть `await` верхнего уровня);
 * вернуть то, что напечатано через `console.log`. Строки из `drop` выкидываются до стирания —
 * так убирают строки, которые компилятор отвергает и которые при выполнении бросили бы.
 * `globals` — имена, которые код получает снаружи (DOM, заглушки).
 */
export async function execute(source: string, drop: RegExp[] = [], globals: Record<string, unknown> = {}): Promise<unknown[]> {
  const cleaned = source
    .split('\n')
    .filter((l) => !drop.some((re) => re.test(l)))
    .join('\n');
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', ...Object.keys(globals), toJs(cleaned))(fakeConsole, ...Object.values(globals));
  return printed;
}
