import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/patterns/wrappers/data';

/**
 * Утверждения темы «Обёртки» — компилятором и исполнением.
 *
 * Каждый пример — строка из `data.ts`, та самая, что напечатана на странице:
 *   — компиляция `tsc` со `strict`; ошибки сверяются с пометками `// ts(NNNN)` по строкам,
 *     строки без пометки обязаны остаться чистыми;
 *   — исполнение: TypeScript стирается `transpileModule` (target ES2022 — значит, `@`-декораторы
 *     переписываются в обычный код: в Node 26.8.2 их синтаксиса нет), код выполняется
 *     в асинхронной функции, `console.log` подменён — сверяется вывод;
 *   — `PROMISIFY_CODE` импортирует `node:util`, поэтому его стёртая версия запускается
 *     настоящим `node` во временной папке;
 *   — `FETCH_CODE` ходит в настоящий HTTP-сервер на `localhost`, который отвечает 500.
 */

const FILE = 'fixture.ts';
const OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
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

function checkPage(source: string, extra: ts.CompilerOptions = {}): ReturnType<typeof diagnose> {
  const actual = diagnose(source, extra);
  const report = actual.map((d) => `  строка ${d.line}: ts(${d.code}) ${d.text}`).join('\n') || '  (тишина)';
  expect(
    actual.map(({ line, code }) => ({ line, code })),
    `компилятор разошёлся с пометками на странице:\n${report}`,
  ).toEqual(markers(source));
  return actual;
}

function strip(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/^export \{\};?\s*$/m, '');
}

/** Стереть типы и выполнить; вернуть то, что напечатано. `env` — имена, которые код получает снаружи. */
async function execute(source: string, drop: RegExp[] = [], env: Record<string, unknown> = {}): Promise<unknown[]> {
  const cleaned = source
    .split('\n')
    .filter((l) => !drop.some((re) => re.test(l)))
    .join('\n');
  const printed: unknown[] = [];
  const fakeConsole = { log: (value: unknown) => printed.push(value) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', ...Object.keys(env), strip(cleaned))(fakeConsole, ...Object.values(env));
  return printed;
}

/** Строки, которые компилятор отвергает и которые при выполнении бросили бы. */
const COMPILE_ONLY = [/ts\(2339\)/];

describe('раздел 2 · адаптер', () => {
  it('адаптер из курса: private делает класс номинальным — ts(2345) на объекте без extends', async () => {
    const diags = checkPage(t.ADAPTER_CODE);
    expect(diags[0].text).toMatch(/Property 'db' is missing/);
    expect(await execute(t.ADAPTER_CODE)).toEqual(t.ADAPTER_OUT);
  });

  it('с #-полем то же самое: закрытое поле совпадает только с собой', () => {
    const src = `class KV { #db = new Map<string, string>(); save(k: string, v: string) { this.#db.set(k, v); } }
function run(base: KV) { base.save('k', 'v'); }
run({ save: (k: string, v: string) => {} });`;
    expect(diagnose(src).map((d) => d.code)).toEqual([2345]);
  });

  it('зависимость от интерфейса: адаптер — один объект, компилируется чисто', async () => {
    checkPage(t.ADAPTER_IFACE_CODE);
    expect(await execute(t.ADAPTER_IFACE_CODE)).toEqual(t.ADAPTER_IFACE_OUT);
  });

  it('promisify(store.load) теряет this — TypeError; с bind работает (настоящий node)', () => {
    checkPage(t.PROMISIFY_CODE, { types: ['node'] });
    const dir = mkdtempSync(path.join(tmpdir(), 'wrappers-'));
    try {
      writeFileSync(path.join(dir, 'main.mjs'), strip(t.PROMISIFY_CODE));
      const out = execFileSync(process.execPath, ['main.mjs'], { cwd: dir, encoding: 'utf8' }).trim().split('\n');
      expect(out).toEqual(t.PROMISIFY_OUT);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('раздел 3 · фасад', () => {
  it('фасад из курса: успех и неудача возвращают undefined', async () => {
    checkPage(t.FACADE_CODE);
    expect(await execute(t.FACADE_CODE)).toEqual(t.FACADE_OUT);
  });

  it('fetch на 500 выполняется с ok: false; фасад превращает это в ошибку', async () => {
    checkPage(t.FETCH_CODE);
    const server = http.createServer((_req, res) => {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end('{"error":"boom"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      expect(await execute(t.FETCH_CODE, [], { API: `http://127.0.0.1:${port}` })).toEqual(t.FETCH_OUT);
    } finally {
      server.close();
    }
  });

  it('lib.dom объявляет Response.json() как Promise<any>', () => {
    const dom = readFileSync(
      path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.dom.d.ts'),
      'utf8',
    );
    expect(dom).toMatch(/interface Body \{[^}]*json\(\): Promise<any>;/);
  });
});

describe('раздел 4 · заместитель', () => {
  it('класс-заместитель — ts(2420) на новом методе; встроенный Proxy пропускает его к цели', async () => {
    checkPage(t.PROXY_CODE);
    expect(await execute(t.PROXY_CODE)).toEqual(t.PROXY_OUT);
  });

  it('кеш промисов: один запрос на двоих, и отказ остаётся в кеше', async () => {
    checkPage(t.CACHE_CODE);
    expect(await execute(t.CACHE_CODE)).toEqual(t.CACHE_OUT);
  });

  it('строка-лекарство: при отказе запись удаляется, третий вызов идёт в сеть', async () => {
    const anchor = '      this.cache.set(id, p);';
    const line = t.CACHE_CODE.split('\n').find((l) => l.startsWith(anchor));
    expect(line, 'в CACHE_CODE пропала строка, после которой вставляется лекарство').toBeDefined();
    const fixed = t.CACHE_CODE.replace(line!, line + '\n' + t.CACHE_FIX_LINE);
    checkPage(fixed);
    expect(await execute(fixed)).toEqual(t.CACHE_FIX_OUT);
  });
});

describe('раздел 5 · декоратор', () => {
  it('«декоратор» из курса меняет сам объект: необёрнутый сервис тоже обнулён', async () => {
    checkPage(t.DECORATOR_COURSE_CODE);
    expect(await execute(t.DECORATOR_COURSE_CODE)).toEqual(t.DECORATOR_COURSE_OUT);
  });

  it('обёртки: порядок в стопке меняет поведение; спред теряет методы — ts(2339)', async () => {
    checkPage(t.DECORATOR_WRAP_CODE);
    expect(await execute(t.DECORATOR_WRAP_CODE, COMPILE_ONLY)).toEqual(t.DECORATOR_WRAP_OUT);
  });

  it('спред экземпляра при выполнении действительно без метода', async () => {
    const src = t.DECORATOR_WRAP_CODE.replace(/spread\.getUsersInDatabase\(\);.*$/m, 'console.log(typeof (spread as any).getUsersInDatabase);');
    const out = await execute(src);
    expect(out.at(-1)).toBe('undefined');
  });

  it('@-декораторы: применяются снизу вверх до первого new, вызываются сверху вниз', async () => {
    checkPage(t.DECORATOR_SYNTAX_CODE);
    expect(await execute(t.DECORATOR_SYNTAX_CODE)).toEqual(t.DECORATOR_SYNTAX_OUT);
  });

  it('в Node 26 синтаксиса @ нет — SyntaxError без компилятора', () => {
    expect(() => new Function('class A { @dec m() {} }')).toThrow(SyntaxError);
  });
});

describe('раздел 6 · мост', () => {
  it('NotificationSender с двумя провайдерами компилируется и доставляет', async () => {
    checkPage(t.BRIDGE_CODE);
    expect(await execute(t.BRIDGE_CODE)).toEqual(t.BRIDGE_OUT);
  });

  it('таблица классов: произведение против суммы', () => {
    const counts = [
      [2, 2],
      [2, 3],
      [3, 3],
    ];
    t.BRIDGE_ROWS.forEach((row, i) => {
      const [kinds, providers] = counts[i];
      expect(row.inherit).toContain(String(kinds * providers));
      expect(row.bridge).toBe(`${kinds} + ${providers} = ${kinds + providers}`);
    });
  });

  it('бивариантность методов: реализация с узким параметром проходит, поле-функция — ts(2416)', () => {
    const src = `interface P { connect(config: string): void }
class WhatsApp implements P { connect(config: 'wa-token') {} }
interface P2 { connect: (config: string) => void }
class WhatsApp2 implements P2 { connect(config: 'wa-token') {} }`;
    expect(diagnose(src).map(({ line, code }) => ({ line, code }))).toEqual([{ line: 4, code: 2416 }]);
  });

  it('Vue: runtime-dom собирает рендерер мостом — createRenderer(extend({ patchProp }, nodeOps))', () => {
    const require = createRequire(import.meta.url);
    expect(typeof require('@vue/runtime-core').createRenderer).toBe('function');
    const dom = readFileSync(require.resolve('@vue/runtime-dom/dist/runtime-dom.cjs.js'), 'utf8');
    expect(dom).toMatch(/const rendererOptions = \/\* @__PURE__ \*\/ shared\.extend\(\{ patchProp \}, nodeOps\);/);
    expect(dom).toMatch(/runtimeCore\.createRenderer\(rendererOptions\)/);
    expect(dom).toMatch(/insert: \(child, parent, anchor\) => \{\s*parent\.insertBefore\(child, anchor \|\| null\);/);
  });
});

describe('тонкие места', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });

  it('01: обёртка-литерал — не тот же объект и не instanceof класса', () => {
    class UserService {
      getUsersInDatabase() {
        return 1000;
      }
    }
    const inner = new UserService();
    const wrapped = { getUsersInDatabase: () => inner.getUsersInDatabase() };
    expect((wrapped as unknown) === inner).toBe(false);
    expect(wrapped instanceof UserService).toBe(false);
  });

  it('02: метод с #-полем через Proxy — TypeError; с bind в ловушке — работает', () => {
    class Account {
      #sum = 10;
      sum() {
        return this.#sum;
      }
    }
    const plain = new Proxy(new Account(), {});
    expect(() => plain.sum()).toThrow(TypeError);
    const bound = new Proxy(new Account(), {
      get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect(bound.sum()).toBe(10);
  });

  it('03: обёртка через fn.apply(this, args) сохраняет this метода', () => {
    const wrap = <A extends unknown[], R>(fn: (...a: A) => R) =>
      function (this: unknown, ...args: A): R {
        return fn.apply(this, args);
      };
    const store = { prefix: 'user-', load(id: number) { return this.prefix + id; } };
    store.load = wrap(store.load);
    expect(store.load(1)).toBe('user-1');
  });

  it('04: тело ответа 500 без проверки статуса уходит наверх как данные', async () => {
    const server = http.createServer((_req, res) => {
      res.statusCode = 500;
      res.end('{"error":"boom"}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const body = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.json());
      expect(body).toEqual({ error: 'boom' });
    } finally {
      server.close();
    }
  });
});
