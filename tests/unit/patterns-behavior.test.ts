import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { legacy_createStore } from 'redux';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/patterns/behavior/data';

/**
 * Утверждения темы «Поведение как значение» — компилятором и исполнением.
 *
 * Каждый пример — строка из `data.ts`, та самая, что напечатана на странице:
 *   — компиляция `tsc` со `strict`; ошибки сверяются с пометками `// ts(NNNN)` по строкам,
 *     строки без пометки обязаны остаться чистыми;
 *   — исполнение: TypeScript стирается `transpileModule`, код выполняется в асинхронной функции,
 *     `console.log` подменён — сверяется вывод;
 *   — пример с необработанным отказом промиса запускается отдельным процессом `node`: в процессе
 *     vitest такой отказ уронил бы прогон, а в Node важен именно код выхода.
 */

const FILE = 'fixture.ts';
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleDetection: ts.ModuleDetectionKind.Force,
  lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
  types: [],
  skipLibCheck: true,
};

const libCache = new Map<string, ts.SourceFile>();

function diagnose(source: string, extra: ts.CompilerOptions = {}): { line: number; code: number; text: string }[] {
  const options = { ...OPTIONS, ...extra };
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

function checkPage(source: string, extra: ts.CompilerOptions = {}): void {
  const actual = diagnose(source, extra);
  const report = actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n') || '  (тишина)';
  expect(
    actual.map(({ line, code }) => ({ line, code })),
    `компилятор разошёлся с пометками на странице:\n${report}`,
  ).toEqual(markers(source));
}

function toJs(source: string): string {
  return ts
    .transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    .outputText.replace(/^export \{\};?\s*$/m, '');
}

/** Стереть типы и выполнить; вернуть то, что напечатано. Строки из `drop` выкидываются. */
async function execute(source: string, drop: RegExp[] = []): Promise<unknown[]> {
  const cleaned = source
    .split('\n')
    .filter((l) => !drop.some((re) => re.test(l)))
    .join('\n');
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', toJs(cleaned))(fakeConsole);
  return printed;
}

describe('раздел 1 · зачем', () => {
  it('лестница if в Auth компилируется', () => {
    checkPage(t.PROBLEM_CODE);
  });
});

describe('раздел 2 · стратегия', () => {
  it('классическая стратегия из видеокурса: подмена на лету', async () => {
    checkPage(t.STRATEGY_CLASSIC_CODE);
    expect(await execute(t.STRATEGY_CLASSIC_CODE)).toEqual(t.STRATEGY_CLASSIC_OUT);
  });

  it('стратегия-функция: satisfies выводит тип параметра и держит ключи — ts(2339)', async () => {
    checkPage(t.STRATEGY_FN_CODE);
    expect(await execute(t.STRATEGY_FN_CODE)).toEqual(t.STRATEGY_FN_OUT);
  });

  it('компаратор: устойчивость, составное правило; булев — ts(2345) и в V8 ничего не переставляет', async () => {
    checkPage(t.SORT_CODE);
    expect(await execute(t.SORT_CODE)).toEqual(t.SORT_OUT);
  });

  it('булев компаратор в V8 не меняет ни одного массива (300 случайных)', () => {
    for (let i = 0; i < 300; i++) {
      const a = Array.from({ length: 2 + (i % 50) }, () => Math.floor(Math.random() * 1000));
      // @ts-expect-error — именно булев компаратор и проверяем
      expect([...a].sort((x: number, y: number) => x > y)).toEqual(a);
    }
  });

  it('без компаратора sort сравнивает строками: [10, 9, 1] → [1, 10, 9]', () => {
    expect([10, 9, 1].sort()).toEqual([1, 10, 9]);
  });

  it('this-параметр не мешает передать метод в тип без this; ts(2345) — только при this: void', async () => {
    checkPage(t.THIS_STRATEGY_CODE);
    expect(await execute(t.THIS_STRATEGY_CODE, [/ts\(2345\)/])).toEqual(t.THIS_STRATEGY_OUT);
  });
});

describe('раздел 3 · команда', () => {
  it('команда из видеокурса: execute и undo через получателя и историю', async () => {
    checkPage(t.COMMAND_CLASSIC_CODE);
    expect(await execute(t.COMMAND_CLASSIC_CODE)).toEqual(t.COMMAND_CLASSIC_OUT);
  });

  it('«как было», запомненное при создании, откатывает через шаг', async () => {
    checkPage(t.COMMAND_CAPTURE_CODE);
    expect(await execute(t.COMMAND_CAPTURE_CODE)).toEqual(t.COMMAND_CAPTURE_OUT);
  });

  it('замыкание не сериализуется, экземпляр теряет методы, объект-данные проходит', async () => {
    checkPage(t.COMMAND_DATA_CODE);
    expect(await execute(t.COMMAND_DATA_CODE)).toEqual(t.COMMAND_DATA_OUT);
  });

  it('Redux отвергает действие-экземпляр класса и принимает простой объект', () => {
    const store = legacy_createStore((s: string[] = [], a: { type: string; name?: string }) =>
      a.type === 'addUser' ? [...s, a.name!] : s,
    );
    class AddUser {
      type = 'addUser';
      constructor(public name: string) {}
    }
    expect(() => store.dispatch(new AddUser('Аня'))).toThrow(/plain objects/);
    store.dispatch({ type: 'addUser', name: 'Борис' });
    expect(store.getState()).toEqual(['Борис']);
    // в тексте темы цитируется именно это сообщение
    expect(t.COMMAND_DATA_NOTE).toContain('Actions must be plain objects');
  });
});

describe('раздел 4 · шаблонный метод', () => {
  it('SaveForm из видеокурса: порядок шагов в базе, шаги в наследниках', async () => {
    checkPage(t.TM_CLASSIC_CODE);
    expect(await execute(t.TM_CLASSIC_CODE)).toEqual(t.TM_CLASSIC_OUT);
  });

  it('async-шаг под void: компилятор молчит, Node падает с кодом 1 мимо try', () => {
    checkPage(t.TM_ASYNC_CODE);
    const dir = mkdtempSync(path.join(tmpdir(), 'patterns-behavior-'));
    try {
      const file = path.join(dir, 'main.mjs');
      writeFileSync(file, toJs(t.TM_ASYNC_CODE));
      const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
      expect(run.stdout.trim().split('\n')).toEqual(t.TM_ASYNC_OUT);
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('сервер ответил 500 на Аня');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('override ловит переименованный шаг — ts(4113); без него метод мёртв', async () => {
    checkPage(t.TM_OVERRIDE_CODE);
    checkPage(t.TM_OVERRIDE_CODE, { noImplicitOverride: true });
    expect(await execute(t.TM_OVERRIDE_CODE)).toEqual(t.TM_OVERRIDE_OUT);
  });

  it('шаги объектом: T выводится из fill, пропущенный шаг — ts(2345)', async () => {
    checkPage(t.TM_HOOKS_CODE);
    expect(await execute(t.TM_HOOKS_CODE)).toEqual(t.TM_HOOKS_OUT);
  });

  it('тонкое место 03: шаг из конструктора базы не видит полей наследника', async () => {
    const code = `abstract class Exporter {
  constructor() { this.setup(); }
  protected abstract setup(): void;
}
class CsvExporter extends Exporter {
  separator = ';';
  protected setup() { console.log(this.separator); }
}
console.log(new CsvExporter().separator);`;
    checkPage(code);
    expect(await execute(code)).toEqual([undefined, ';']);
    expect(t.PITFALLS.find((p) => p.n === '03')!.d).toContain('`undefined`');
  });
});

describe('раздел 5 · состояние', () => {
  it('документ из видеокурса: черновик → опубликован → черновик', async () => {
    checkPage(t.STATE_CLASS_CODE);
    expect(await execute(t.STATE_CLASS_CODE)).toEqual(t.STATE_CLASS_OUT);
  });

  it('без setContext компилятор молчит, а publish бросает TypeError', async () => {
    const forgotten = t.STATE_CLASS_CODE.split('\n')
      .filter((l) => !l.includes('this.state.setContext(this)'))
      .join('\n');
    expect(forgotten).not.toBe(t.STATE_CLASS_CODE);
    checkPage(forgotten);
    await expect(execute(forgotten)).rejects.toThrow(TypeError);
  });

  it('общие объекты-состояния: Аня публикует пост Бориса', async () => {
    checkPage(t.SHARED_STATE_CODE);
    expect(await execute(t.SHARED_STATE_CODE)).toEqual(t.SHARED_STATE_OUT);
  });

  it('размеченное объединение: свои поля у состояния — ts(2322), switch с assertNever', async () => {
    checkPage(t.STATE_UNION_CODE);
    expect(await execute(t.STATE_UNION_CODE)).toEqual(t.STATE_UNION_OUT);
  });

  it('новое состояние без case — ошибка в default', () => {
    const extended = t.STATE_UNION_CODE.replace(
      "| { status: 'published'; text: string; url: string };",
      "| { status: 'published'; text: string; url: string }\n  | { status: 'archived'; text: string };",
    );
    expect(extended).not.toBe(t.STATE_UNION_CODE);
    const line = extended.split('\n').findIndex((l) => l.includes('return assertNever(doc)')) + 1;
    expect(diagnose(extended).some((d) => d.line === line && d.code === 2345)).toBe(true);
  });

  it('таблица переходов: опечатка — ts(2820), пропущенное состояние — ts(2741)', async () => {
    checkPage(t.STATE_TABLE_CODE);
    expect(await execute(t.STATE_TABLE_CODE)).toEqual(t.STATE_TABLE_OUT);
  });
});

describe('зачин и тонкие места', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });

  it('у каждой карточки «Перед началом» настоящий адрес темы с якорем', () => {
    for (const p of t.PREREQ) expect(p.href).toMatch(/^\/[a-z]+\/[a-z-]+\/#s\d+$/);
  });

  it('источники без разметки: SourceList печатает их как есть', () => {
    for (const s of t.SOURCES) expect(`${s.title} ${s.what}`).not.toMatch(/[`*[\]]/);
  });

  it('abstract, protected и override стираются: в .js ни слова', () => {
    const js = toJs([t.TM_CLASSIC_CODE, t.STATE_CLASS_CODE].join('\n'));
    expect(js).not.toMatch(/\babstract\b|\bprotected\b|\boverride\b/);
  });
});
