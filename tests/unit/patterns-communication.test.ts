import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/patterns/communication/data';

/**
 * Утверждения темы «Связь объектов» — компилятором и исполнением.
 *
 * Каждый пример — строка из `data.ts`, та самая, что напечатана на странице:
 *   — компиляция `tsc` со `strict`; ошибки сверяются с пометками `// ts(NNNN)` по строкам,
 *     строки без пометки обязаны остаться чистыми;
 *   — исполнение: TypeScript стирается `transpileModule`, код выполняется в асинхронной функции
 *     (у примеров есть `await` верхнего уровня), `console.log` подменён — сверяется вывод;
 *   — примеры-продолжения (`SELF_DETACH_CODE`, `CHAIN_HEAD_CODE`, `NEXT_BUGS_CODE`) на странице
 *     стоят под своим началом и пользуются его классами — проверяются склеенными с ним;
 *   — таблица `DISPATCH_ROWS` вычисляется заново в отдельном процессе `node`: исключение
 *     в слушателе `EventTarget` Node бросает в `nextTick`, и в процессе vitest оно уронило бы прогон.
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

/** Стереть типы и выполнить; вернуть то, что напечатано. */
async function execute(source: string): Promise<unknown[]> {
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export \{\};?\s*$/m, '');
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', js)(fakeConsole);
  return printed;
}

/** Склеить начало примера и продолжение, как они стоят на странице друг под другом. */
const joined = (head: string, tail: string) => `${head}\n${tail}`;

describe('раздел 1 · зачем', () => {
  it('обработчик формы, который знает всех, компилируется', () => {
    checkPage(t.PROBLEM_CODE);
  });
});

describe('раздел 2 · наблюдатель', () => {
  it('книжный наблюдатель из видеокурса: после detach СМС больше не уходит', async () => {
    checkPage(t.OBSERVER_CLASSIC_CODE);
    expect(await execute(t.OBSERVER_CLASSIC_CODE)).toEqual(t.OBSERVER_CLASSIC_OUT);
  });

  it('подписчик, снявший себя во время notify, оставляет соседа без события', async () => {
    const code = joined(t.OBSERVER_CLASSIC_CODE, t.SELF_DETACH_CODE);
    checkPage(code);
    const printed = await execute(code);
    expect(printed.slice(t.OBSERVER_CLASSIC_OUT.length)).toEqual(t.SELF_DETACH_OUT);
  });

  it('рассылка по копии лечит пропуск: CRM получает лид с первого раза', async () => {
    const fixed = t.OBSERVER_CLASSIC_CODE.replace('of this.observers)', 'of [...this.observers])');
    expect(fixed).not.toBe(t.OBSERVER_CLASSIC_CODE);
    const printed = await execute(joined(fixed, t.SELF_DETACH_CODE));
    expect(printed.slice(t.OBSERVER_CLASSIC_OUT.length)).toEqual(['приветствие', 'лид в CRM: Вера', 'лид в CRM: Вера']);
  });

  it('таблица рассылки совпадает с четырьмя реализациями (отдельный процесс node)', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', DISPATCH_PROBE], {
      encoding: 'utf8',
    });
    const got = JSON.parse(out) as { k: string; got: Record<t.DispatchImpl, string> }[];
    expect(got).toEqual(t.DISPATCH_ROWS.map((r) => ({ k: r.k, got: r.got })));
  });

  it('EventTarget в Node вызывает добавленного, только если добавивший не последний', () => {
    const code = `
      const run = (n) => {
        const log = []; const et = new EventTarget();
        et.addEventListener('x', () => { log.push('a'); et.addEventListener('x', () => log.push('d')); });
        for (let i = 1; i < n; i++) et.addEventListener('x', () => log.push('b'));
        et.dispatchEvent(new Event('x'));
        return log.join(' ');
      };
      console.log(JSON.stringify([run(1), run(2)]));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(['a', 'a b d']);
  });

  it('карта событий: detail — ts(2339), опечатка — ts(2345), не те данные — ts(2322)', async () => {
    checkPage(t.TYPED_CODE);
    expect(await execute(t.TYPED_CODE)).toEqual(t.TYPED_OUT);
  });

  it('lib.dom типизирует addEventListener тем же приёмом: карта событий', () => {
    const dom = readFileSync(
      path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.dom.d.ts'),
      'utf8',
    );
    expect(dom).toMatch(/addEventListener<K extends keyof HTMLElementEventMap>\(type: K, listener: \(this: HTMLElement, ev: HTMLElementEventMap\[K\]\)/);
  });

  it('dispatchEvent не ждёт async-слушателя', async () => {
    checkPage(t.ASYNC_CODE);
    expect(await execute(t.ASYNC_CODE)).toEqual(t.ASYNC_OUT);
  });

  it('Node предупреждает о 11-м слушателе у EventEmitter и у EventTarget', () => {
    const code = `
      import { EventEmitter } from 'node:events';
      const seen = [];
      process.on('warning', (w) => seen.push(w.name + ':' + (w.message.includes('EventTarget') ? 'target' : 'emitter')));
      const em = new EventEmitter();
      for (let i = 0; i < 10; i++) em.on('lead', () => {});
      const et = new EventTarget();
      for (let i = 0; i < 10; i++) et.addEventListener('lead', () => {});
      setTimeout(() => {
        seen.push('после 10');
        em.on('lead', () => {});
        et.addEventListener('lead', () => {});
        setTimeout(() => console.log(JSON.stringify(seen)), 10);
      }, 10);`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    expect(JSON.parse(out)).toEqual([
      'после 10',
      'MaxListenersExceededWarning:emitter',
      'MaxListenersExceededWarning:target',
    ]);
  });

  it('emit("error") без слушателя бросает саму ошибку', () => {
    const code = `
      import { EventEmitter } from 'node:events';
      try { new EventEmitter().emit('error', new RangeError('x')); } catch (e) { console.log(e.name); }`;
    expect(execFileSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' }).trim()).toBe(
      'RangeError',
    );
  });

  it('в Node исключение слушателя EventTarget роняет процесс, хотя dispatchEvent в try', () => {
    const code = `
      const et = new EventTarget();
      et.addEventListener('x', () => { throw new RangeError('boom'); });
      try { et.dispatchEvent(new Event('x')); console.log('вернулся'); } catch { console.log('пойман'); }`;
    let status = 0;
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      const err = e as { status: number; stdout: string };
      status = err.status;
      stdout = err.stdout;
    }
    expect(stdout.trim()).toBe('вернулся');
    expect(status).not.toBe(0);
  });
});

describe('раздел 3 · посредник', () => {
  it('посредник ведёт сценарий; опечатка в case — ts(2678); без посредника — тишина', async () => {
    checkPage(t.MEDIATOR_CODE);
    expect(await execute(t.MEDIATOR_CODE)).toEqual(t.MEDIATOR_OUT);
  });

  it('с event: string опечатка в case проходит молча', () => {
    const loose = t.MEDIATOR_CODE.replace('notify(sender: string, event: AppEvent) {', 'notify(sender: string, event: string) {')
      .replace(/\s*\/\/ ts\(2678\).*$/m, '');
    expect(loose).not.toBe(t.MEDIATOR_CODE);
    checkPage(loose);
  });

  it('шина теряет событие до подписки, стор отдаёт текущее', async () => {
    checkPage(t.BUS_CODE);
    expect(await execute(t.BUS_CODE)).toEqual(t.BUS_OUT);
  });
});

describe('раздел 4 · цепочка обязанностей', () => {
  it('цепочка из видеокурса: три запроса — три места остановки', async () => {
    checkPage(t.CHAIN_CODE);
    expect(await execute(t.CHAIN_CODE)).toEqual(t.CHAIN_OUT);
  });

  it('a.next(b).next(c) — это c: чужой запрос прошёл мимо auth, типы молчат', async () => {
    const code = joined(t.CHAIN_CODE, t.CHAIN_HEAD_CODE);
    checkPage(code);
    const printed = await execute(code);
    expect(printed.slice(t.CHAIN_OUT.length)).toEqual(t.CHAIN_HEAD_OUT);
  });

  it('compose: луковица и остановка без next', async () => {
    checkPage(t.COMPOSE_CODE);
    expect(await execute(t.COMPOSE_CODE)).toEqual(t.COMPOSE_OUT);
  });

  it('next() дважды — ошибка; next() без await — ответ раньше контроллера', async () => {
    const code = joined(t.COMPOSE_CODE, t.NEXT_BUGS_CODE);
    checkPage(code);
    const printed = await execute(code);
    expect(printed.slice(t.COMPOSE_OUT.length)).toEqual(t.NEXT_BUGS_OUT);
  });

  it('без проверки в run деньги списываются дважды', async () => {
    const unguarded = t.COMPOSE_CODE.split('\n')
      .filter((l) => !l.includes('вызван дважды'))
      .join('\n');
    expect(unguarded).not.toBe(t.COMPOSE_CODE);
    const printed = await execute(joined(unguarded, t.NEXT_BUGS_CODE));
    expect(printed.slice(t.COMPOSE_OUT.length, t.COMPOSE_OUT.length + 1)).toEqual([2]);
  });
});

describe('тонкие места и ссылки', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });

  it('ссылки на другие темы ведут в существующие разделы', () => {
    const ROOTS: Record<string, string> = {
      js: 'lessons',
      render: 'render',
      frameworks: 'frameworks',
      tooling: 'tooling',
      platform: 'platform',
    };
    const text = JSON.stringify(t);
    const links = [...text.matchAll(/\]\(\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?\)/g)];
    expect(links.length).toBeGreaterThan(10);
    for (const [, dir, slug, anchor] of links) {
      const file = new URL(`../../src/content/${ROOTS[dir]}/${slug}/index.mdx`, import.meta.url);
      const mdx = readFileSync(file, 'utf8');
      if (anchor) expect(mdx, `/${dir}/${slug}/#${anchor}`).toMatch(new RegExp(`id="${anchor}"`));
    }
  });
});

/**
 * Пять сценариев × четыре реализации рассылки. Печатает JSON того же вида, что `DISPATCH_ROWS`.
 * Исключение у `EventTarget` Node бросает в `nextTick` — его ловит `uncaughtException`, и тогда
 * запись «ошибка отдельно»; ошибка, долетевшая до вызывающего, — «ошибка у вызывающего».
 */
const DISPATCH_PROBE = String.raw`
import { EventEmitter } from 'node:events';

function make(kind) {
  if (kind === 'array') {
    const list = [];
    return { on: (f) => list.push(f), off: (f) => { const i = list.indexOf(f); if (i !== -1) list.splice(i, 1); }, emit: () => { for (const f of list) f(); } };
  }
  if (kind === 'set') {
    const list = new Set();
    return { on: (f) => list.add(f), off: (f) => list.delete(f), emit: () => { for (const f of list) f(); } };
  }
  if (kind === 'target') {
    const et = new EventTarget();
    return { on: (f) => et.addEventListener('x', f), off: (f) => et.removeEventListener('x', f), emit: () => et.dispatchEvent(new Event('x')) };
  }
  const em = new EventEmitter();
  return { on: (f) => em.on('x', f), off: (f) => em.off('x', f), emit: () => em.emit('x') };
}

let late = [];
process.on('uncaughtException', (e) => late.push(e.message));

async function scenario(kind, name) {
  const s = make(kind);
  const log = [];
  let caught = false;
  const b = () => { log.push('b'); if (name === 'throw') throw new Error('boom'); };
  const c = () => log.push('c');
  const d = () => log.push('d');
  const a = () => {
    log.push('a');
    if (name === 'self') s.off(a);
    if (name === 'nb') s.off(b);
    if (name === 'add') s.on(d);
  };
  if (name === 'twice') {
    const f = () => log.push('f');
    s.on(f); s.on(f);
  } else {
    s.on(a); s.on(b); s.on(c);
  }
  late = [];
  try { s.emit(); } catch { caught = true; }
  await new Promise((r) => setTimeout(r, 5));
  const calls = log.filter((x) => !(name === 'throw' && x === 'b')).join(' ');
  if (name !== 'throw') return calls;
  if (caught) return calls + ', ошибка у вызывающего';
  return calls + (late.length ? ', ошибка отдельно' : ', ошибка пропала');
}

const rows = [
  ['\`a\` отписывает себя', 'self'],
  ['\`a\` отписывает \`b\`', 'nb'],
  ['\`a\` подписывает \`d\`', 'add'],
  ['\`b\` бросает исключение', 'throw'],
  ['одну функцию подписали дважды', 'twice'],
];
const result = [];
for (const [k, name] of rows) {
  const got = {};
  for (const kind of ['array', 'set', 'target', 'emitter']) got[kind] = await scenario(kind, name);
  result.push({ k, got });
}
console.log(JSON.stringify(result));
`;
