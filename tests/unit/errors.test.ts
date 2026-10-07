import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/errors/data';
import { loadParse, loadSerialize, runCase } from '@/widgets/error-lab/model/run';

/**
 * Тема «Ошибки и стеки: от throw до отчёта».
 *
 * Каждый пример `*_RUN` и асинхронные сценарии исполняются **в отдельном процессе Node**:
 * vitest подменяет форматирование стеков, и в его процессе `error.stack` не тот, что видит
 * читатель. Файл пишется во временный каталог, вывод сверяется с литералом после двух замен:
 * путь каталога → `/app` (так в теме) и номера строк во внутренних кадрах Node
 * (`node:internal/…:L:C`) → без чисел — они меняются от версии к версии Node, а тема про них
 * ничего не утверждает (стенд — 24.11.0; на 26.8.2 пользовательские кадры те же).
 *
 * `PARSE_CODE` сверяется с CallSite API V8 (`Error.prepareStackTrace`) на живых стеках —
 * тоже в отдельном процессе: кадр за кадром, функция, файл, строка, колонка, `async`.
 * `SERIALIZE_CODE` — со `structuredClone` и на случаях демо (`runCase` — тот же, что у виджета).
 *
 * Браузерная часть — свой Chromium через Playwright на портах 53010–53012: асинхронные стеки,
 * «Script error.», `unhandledrejection` из чужого скрипта, ленивый заголовок стека.
 */

const parse = loadParse(t.PARSE_CODE);
const serialize = loadSerialize(t.SERIALIZE_CODE);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'errors-')));

/** Вывод так, как его печатает тема: `/app` вместо каталога, внутренние кадры без чисел. */
function normalize(s: string): string {
  return s
    .replaceAll(`file://${dir}`, 'file:///app')
    .replaceAll(dir, '/app')
    .replace(/(node:internal\/[\w/]+):\d+(?::\d+)?/g, '$1')
    .replace(/Node\.js v\d+\.\d+\.\d+/g, 'Node.js vX');
}

function runFile(file: string, code: string, flags: string[] = []) {
  writeFileSync(join(dir, file), code);
  const r = spawnSync(process.execPath, [...flags, join(dir, file)], { cwd: dir, encoding: 'utf8', timeout: 30_000 });
  return { out: normalize(`$ node ${file}\n${r.stdout}${r.stderr}`.trimEnd()), status: r.status };
}

const RUNS: [string, t.NodeRun][] = [
  ['ANATOMY_RUN', t.ANATOMY_RUN],
  ['CLASS_RUN', t.CLASS_RUN],
  ['THROWN_RUN', t.THROWN_RUN],
  ['THROW_STRING_RUN', t.THROW_STRING_RUN],
  ['WHERE_RUN', t.WHERE_RUN],
  ['LAZY_RUN', t.LAZY_RUN],
  ['CAPTURE_RUN', t.CAPTURE_RUN],
  ['LIMIT_RUN', t.LIMIT_RUN],
  ['PREPARE_RUN', t.PREPARE_RUN],
  ['CRASH_RUN', t.CRASH_RUN],
  ['HANDLERS_RUN', t.HANDLERS_RUN],
  ['LATE_RUN', t.LATE_RUN],
  ['FINALLY_ORDER_RUN', t.FINALLY_ORDER_RUN],
  ['FINALLY_LOSS_RUN', t.FINALLY_LOSS_RUN],
  ['USING_RUN', t.USING_RUN],
  ['PROMISE_FINALLY_RUN', t.PROMISE_FINALLY_RUN],
];

describe('примеры: Node печатает то, что напечатано в теме', () => {
  it.each(RUNS)('%s', (_name, run) => {
    const r = runFile(run.file, run.code);
    expect(r.out).toBe(normalize(run.out));
    expect(r.status).toBe(run.exit ?? 0);
  });

  it.each(t.ASYNC_CASES.map((c) => [c.id, c] as const))('асинхронный сценарий %s — стек Node', (_id, c) => {
    const r = runFile(c.file, c.code);
    expect(r.out).toBe(normalize(`$ node ${c.file}\n${c.node}`));
  });
});

describe('утверждения таблицы NODE_ROWS — отдельными процессами', () => {
  it('отказ с ошибкой и со строкой роняют процесс с кодом 1; строка завёрнута в ERR_UNHANDLED_REJECTION', () => {
    const a = runFile('rows-reject.mjs', `Promise.reject(new Error('x'));\nsetTimeout(() => console.log('жив'), 10);`);
    expect(a.status).toBe(1);
    expect(a.out).not.toContain('жив');
    const b = runFile('rows-reject-string.mjs', `Promise.reject('нет денег');`);
    expect(b.status).toBe(1);
    expect(b.out).toContain("code: 'ERR_UNHANDLED_REJECTION'");
    expect(b.out).toContain('The promise rejected with the reason "нет денег"');
  });

  it('бросивший обработчик uncaughtException — код 7; только monitor — код 1', () => {
    const a = runFile('rows-handler.mjs', `process.on('uncaughtException', () => { throw new Error('сам'); });\nthrow new Error('первая');`);
    expect(a.status).toBe(7);
    const b = runFile('rows-monitor.mjs', `process.on('uncaughtExceptionMonitor', (e, o) => console.log('monitor', o));\nsetTimeout(() => { throw new Error('x'); }, 0);`);
    expect(b.out).toContain('monitor uncaughtException');
    expect(b.status).toBe(1);
  });

  it('с обработчиком unhandledRejection отказ до uncaughtException не доходит', () => {
    const r = runFile(
      'rows-both.mjs',
      `process.on('unhandledRejection', (r) => console.log('UR', r.message));\nprocess.on('uncaughtException', (e) => console.log('UE', e.message));\nPromise.reject(new Error('x'));`,
    );
    expect(r.out.split('\n').slice(1)).toEqual(['UR x']);
    expect(r.status).toBe(0);
  });

  it('--trace-uncaught показывает, где брошена строка', () => {
    const r = runFile('rows-trace.mjs', `throw 'нет денег';`, ['--trace-uncaught']);
    expect(r.out).toContain('Thrown at:');
  });

  it('флаг --stack-trace-limit меняет предел', () => {
    const r = runFile('rows-limit.mjs', `function d(n) { return n ? d(n - 1) : new Error('x'); }\nconsole.log(Error.stackTraceLimit, d(10).stack.split('\\n').length - 1);`, ['--stack-trace-limit=50']);
    expect(r.out.split('\n')[1]).toBe('50 15'); // 11 вызовов d, верхний уровень и 3 кадра загрузчика
  });

  it('у Node свой Error.prepareStackTrace, и зовётся он один раз — при первом чтении stack', () => {
    const r = runFile(
      'rows-prepare.mjs',
      `console.log(typeof Error.prepareStackTrace);\nlet n = 0;\nError.prepareStackTrace = () => { n++; return 's'; };\nconst e = new Error('x');\nconsole.log(n);\ne.stack; e.stack;\nconsole.log(n);`,
    );
    expect(r.out.split('\n').slice(1)).toEqual(['function', '0', '1']);
  });
});

describe('утверждения текста, которые держатся на числах примеров', () => {
  it('LIMIT_NOTE: 10 по умолчанию, 25 настоящих кадров', () => {
    expect(t.LIMIT_NOTE).toContain('**10**');
    expect(t.LIMIT_NOTE).toContain('Из 25 настоящих кадров');
    expect(t.LIMIT_RUN.out).toContain('10 25');
  });

  it('CRASH_NOTE: ^ под throw (колонка 3), стек — new (колонка 9)', () => {
    expect(t.CRASH_RUN.out).toContain(':2:9)');
    expect(t.CRASH_RUN.code.split('\n')[1].indexOf('throw')).toBe(2);
    expect(t.CRASH_RUN.code.split('\n')[1].indexOf('new')).toBe(8);
    expect(t.CRASH_NOTE).toContain('колонка 3');
    expect(t.CRASH_NOTE).toContain('колонка 9');
  });

  it('WHERE_NOTE: колонка 2:10 — это new', () => {
    expect(t.WHERE_RUN.code.split('\n')[1].slice(9, 12)).toBe('new');
  });

  it('JSON.stringify ошибки — {}, а цикл через присвоенный cause бросает TypeError', () => {
    expect(JSON.stringify(new Error('x', { cause: 1 }))).toBe('{}');
    const a = new Error('A') as Error & { cause?: unknown };
    const b = new Error('B') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(() => JSON.stringify(a)).toThrow(TypeError);
    expect(t.CLONE_NOTE).toContain('Converting circular structure to JSON');
  });

  it('ANATOMY_ROWS: cause создаётся только при ключе в опциях', () => {
    expect(Object.hasOwn(new Error('x', {}), 'cause')).toBe(false);
    expect(Object.hasOwn(new Error('x', { cause: undefined }), 'cause')).toBe(true);
    expect(Object.hasOwn(new Error(), 'message')).toBe(false);
    const d = Object.getOwnPropertyDescriptor(new AggregateError([]), 'errors');
    expect(d?.enumerable).toBe(false);
  });

  it('structuredClone: message, stack и cause остаются; errors, code и подкласс теряются', () => {
    const top = structuredClone(new Error('top', { cause: new Error('root') }));
    expect(top.message).toBe('top');
    expect((top.cause as Error).message).toBe('root');
    expect(typeof top.stack).toBe('string');
    const agg = structuredClone(new AggregateError([new Error('q')], 'agg')) as Error & { errors?: unknown };
    expect(agg.constructor).toBe(Error);
    expect(agg.errors).toBeUndefined();
    const c = Object.assign(new Error('c'), { code: 'E' });
    expect((structuredClone(c) as Error & { code?: string }).code).toBeUndefined();
    class MyError extends Error {}
    expect(structuredClone(new MyError('m')).constructor).toBe(Error);
    expect(structuredClone(new TypeError('t')).constructor).toBe(TypeError);
  });
});

// ─── parseStack против CallSite API ────────────────────────────────────────────────────────

/**
 * Дочерний процесс: на каждом стеке снимает и строку (форматом Node по умолчанию), и кадры
 * CallSite, и отдаёт их JSON. `PARSE_CODE` разбирает строку здесь — в процессе теста.
 */
const PROBE = `
const orig = Error.prepareStackTrace;
Error.prepareStackTrace = (e, cs) => {
  e.callSites = cs.map((c) => ({
    fn: c.getFunctionName(), file: c.getScriptNameOrSourceURL() ?? null,
    line: c.getLineNumber(), col: c.getColumnNumber(), async: c.isAsync(),
  }));
  return orig(e, cs);
};
Error.stackTraceLimit = 50;
const out = [];
const grab = (label, e) => { const stack = e.stack; out.push({ label, stack, callSites: e.callSites }); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const sync = {
  native: () => [1].map(() => { throw new Error('n'); }),
  json: () => JSON.parse('{', (k, v) => v),
  evalc: () => eval('(function inEval() { throw new Error("ev"); })()'),
  fnc: () => new Function('return function made() { throw new Error("f"); }')()(),
  sourceUrl: () => new Function('function named() { throw new Error("s"); }\\nnamed();\\n//' + '# sourceURL=case.js')(),
  ctor: () => { class Order { constructor() { throw new Error('c'); } } new Order(); },
  method: () => { const o = { save() { throw new Error('m'); } }; o.save(); },
  getter: () => { const o = { get total() { throw new Error('g'); } }; return o.total; },
  anon: () => (() => { throw new Error('a'); })(),
};
for (const [k, f] of Object.entries(sync)) { try { f(); } catch (e) { grab(k, e); } }
async function q() { await tick(); throw new Error('q'); }
async function s() { await q(); }
async function all() { await Promise.all([tick(), q()]); }
async function any() { await Promise.any([q()]); }
function viaThen() { return tick().then(() => { throw new Error('t'); }); }
async function awaitThen() { await viaThen(); }
await s().catch((e) => grab('await', e));
await all().catch((e) => grab('all', e));
await any().catch((e) => { grab('any', e); grab('any-inner', e.errors[0]); });
await awaitThen().catch((e) => grab('then', e));
await new Promise((res) => setTimeout(() => { grab('timer', new Error('timer')); res(); }, 0));
console.log(JSON.stringify(out));
`;

interface Probe {
  label: string;
  stack: string;
  callSites: { fn: string | null; file: string | null; line: number | null; col: number | null; async: boolean }[];
}

describe('PARSE_CODE против CallSite API V8', () => {
  let probes: Probe[] = [];

  beforeAll(() => {
    writeFileSync(join(dir, 'probe.mjs'), PROBE);
    const r = spawnSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', timeout: 30_000 });
    probes = JSON.parse(r.stdout) as Probe[];
  });

  it('проб хватает и среди них все виды кадров', () => {
    expect(probes.length).toBe(15);
    const all = probes.flatMap((p) => parse(p.stack));
    expect(all.some((f) => f.async)).toBe(true);
    expect(all.some((f) => f.file === null && f.line === null)).toBe(true); // встроенные, index N
    expect(all.some((f) => f.fn?.startsWith('new '))).toBe(true);
    expect(all.some((f) => f.fn === 'Promise.all')).toBe(true);
    expect(all.some((f) => f.file === 'case.js')).toBe(true);
  });

  it('кадр за кадром: файл, строка, колонка и async совпадают; имя содержит getFunctionName', () => {
    for (const p of probes) {
      const frames = parse(p.stack);
      expect(frames.length, p.label).toBe(p.callSites.length);
      frames.forEach((f, i) => {
        const cs = p.callSites[i];
        expect({ file: f.file, line: f.line, col: f.col, async: f.async }, `${p.label} #${i}`).toEqual({
          file: cs.file,
          line: cs.line,
          col: cs.col,
          async: cs.async,
        });
        if (cs.fn) expect(f.fn ?? '', `${p.label} #${i}`).toContain(cs.fn);
        else expect(f.fn === null || f.fn.includes('<anonymous>') || f.fn.includes('.'), `${p.label} #${i}: ${f.fn}`).toBe(true);
      });
    }
  });

  it('заголовок не принимается за кадр, а у AggregateError из Promise.any кадров нет', () => {
    const any = probes.find((p) => p.label === 'any')!;
    expect(any.stack).toBe('AggregateError: All promises were rejected');
    expect(parse(any.stack)).toEqual([]);
  });
});

describe('PARSE_CODE на снятых стеках темы', () => {
  it.each(t.ASYNC_CASES.map((c) => [c.id, c] as const))('%s: кадры Node и Chromium указывают в одни строки кода', (_id, c) => {
    const n = parse(c.node).filter((f) => f.file?.endsWith(c.file) || f.fn === 'Promise.all');
    const ch = parse(c.chromium).filter((f) => f.file?.endsWith(c.file) || f.fn === 'Promise.all');
    // Имена сверяются ниже: у колбэка таймера Node пишет `Timeout._onTimeout`, Chromium — ничего.
    expect(n.map((f) => [f.line, f.col, f.async])).toEqual(ch.map((f) => [f.line, f.col, f.async]));
    const lines = c.code.split('\n');
    for (const f of n) if (f.line) expect(lines[f.line - 1], `${c.id}:${f.line}`).toBeTruthy();
  });

  it('что пропало и что осталось — как в подписях', () => {
    const fns = (id: string) => parse(t.ASYNC_CASES.find((c) => c.id === id)!.node).map((f) => (f.async ? `async ${f.fn}` : f.fn));
    expect(fns('await')).toEqual(['query', 'async saveOrder', 'async checkout']);
    expect(fns('sync').slice(0, 4)).toEqual(['query', 'saveOrder', 'checkout', null]);
    expect(fns('then')).toEqual([null, 'async checkout']);
    expect(fns('timer')[0]).toBe('Timeout._onTimeout');
    expect(fns('timer')).not.toContain('async saveOrder');
    expect(fns('all')).toEqual(['charge', 'async Promise.all', 'async checkout']);
  });
});

// ─── serializeError и случаи демо ──────────────────────────────────────────────────────────

type Report = Record<string, unknown> & { cause?: Report; errors?: Report[]; stack?: string | null };

async function report(id: string, maxFrames?: number) {
  const c = t.REPORT_CASES.find((x) => x.id === id)!;
  const r = await runCase(c.code);
  expect(r.thrown, id).toBe(true);
  return { value: r.value, rep: serialize(r.value, maxFrames === undefined ? undefined : { maxFrames }) as Report };
}

describe('SERIALIZE_CODE на случаях демо', () => {
  it('cause: цепочка целиком, code причины на месте; JSON.stringify — {}', async () => {
    const { value, rep } = await report('cause');
    expect(JSON.stringify(value)).toBe('{}');
    expect(rep.message).toBe('Заказ 42 не сохранён');
    expect(rep.cause?.message).toBe('connect ETIMEDOUT 10.0.0.5:5432');
    expect(rep.cause?.code).toBe('ETIMEDOUT');
    // structuredClone согласен по тому, что умеет сам.
    const sc = structuredClone(value) as Error & { cause: Error };
    const full = serialize(value, { maxFrames: Infinity }) as Report;
    expect(full.stack).toBe(sc.stack);
    expect(full.cause?.stack).toBe(sc.cause.stack);
    expect(full.cause?.message).toBe(sc.cause.message);
  });

  it('any: AggregateError без кадров, обе причины с кодами', async () => {
    const { rep } = await report('any');
    expect(rep.name).toBe('AggregateError');
    expect(rep.stack).toBe('AggregateError: All promises were rejected');
    expect(rep.errors?.map((e) => [e.message, e.code])).toEqual([
      ['Банк А: отказ', 'DECLINED'],
      ['Банк Б: отказ', 'TIMEOUT'],
    ]);
  });

  it('cycle: JSON.stringify бросает, serializeError ставит circular на втором заходе', async () => {
    const { value, rep } = await report('cycle');
    expect(() => JSON.stringify(value)).toThrow(TypeError);
    expect(rep.message).toBe('A');
    expect(rep.cause?.message).toBe('B');
    expect(rep.cause?.cause).toEqual({ name: 'Error', message: 'A', circular: true });
  });

  it('string: NonError с текстом и типом', async () => {
    const { rep } = await report('string');
    expect(rep).toEqual({ name: 'NonError', message: 'нет денег', type: 'string' });
    expect(serialize(null)).toEqual({ name: 'NonError', message: 'null', type: 'null' });
    expect(serialize({ status: 503 })).toEqual({ name: 'NonError', message: '{"status":503}', type: 'object' });
  });

  it('deep: обрезка оставляет maxFrames кадров и пишет, сколько отброшено', async () => {
    const { value, rep } = await report('deep', 3);
    const total = (value as Error).stack!.split('\n').filter((l) => /^\s+at /.test(l)).length;
    const lines = String(rep.stack).split('\n');
    expect(lines.filter((l) => /^\s+at /.test(l))).toHaveLength(3);
    expect(lines.at(-1)).toBe(`    … отброшено кадров: ${total - 3}`);
  });

  it('глубина и SuppressedError', () => {
    let e: Error = new Error('0');
    for (let i = 1; i <= 8; i++) e = new Error(String(i), { cause: e });
    let r = serialize(e, { maxDepth: 2 }) as Report;
    const chain: unknown[] = [];
    while (r) {
      chain.push(r.truncated ?? r.message);
      r = r.cause as Report;
    }
    expect(chain).toEqual(['8', '7', '6', true]);
    const Suppressed = (globalThis as unknown as { SuppressedError: new (e: unknown, s: unknown, m: string) => Error }).SuppressedError;
    const s = new Suppressed(new Error('закрытие'), new Error('тело'), 'msg');
    const sr = serialize(s) as Report;
    expect((sr.error as Report).message).toBe('закрытие');
    expect((sr.suppressed as Report).message).toBe('тело');
  });

  it('случай cause исполняется под именем case.js, строки совпадают с кодом', () => {
    // Стек в процессе vitest переписан — разбор живого стека случая идёт в отдельном процессе.
    const runTs = fileURLToPath(new URL('../../src/widgets/error-lab/model/run.ts', import.meta.url));
    const code = `
import { runCase } from ${JSON.stringify(runTs)};
const parseStack = new Function(${JSON.stringify(t.PARSE_CODE + '\nreturn parseStack;')})();
const r = await runCase(${JSON.stringify(t.REPORT_CASES[0].code)});
console.log(JSON.stringify(parseStack(r.value.cause.stack).slice(0, 3)));`;
    const r = runFile('run-case.mjs', code);
    const frames = JSON.parse(r.out.split('\n')[1]) as { fn: string; file: string; line: number; col: number }[];
    const lines = t.REPORT_CASES[0].code.split('\n');
    expect(frames.map((f) => [f.fn, f.file])).toEqual([
      ['query', 'case.js'],
      ['saveOrder', 'case.js'],
      ['eval', 'case.js'], // обёртка runCase: код из eval V8 зовёт `eval`
    ]);
    expect(lines[frames[0].line - 1].slice(frames[0].col - 1)).toMatch(/^new Error\('connect/);
    expect(lines[frames[1].line - 1].trim()).toBe('query();');
  });

  it('REPORT_WHERE_CODE: обработчики отдают serializeError и выставляют код выхода', () => {
    const handlers: Record<string, (e: unknown, o?: unknown) => void> = {};
    const sent: Report[] = [];
    const proc = { on: (n: string, f: (e: unknown, o?: unknown) => void) => (handlers[n] = f), exitCode: 0 };
    const win = { addEventListener: (n: string, f: (e: unknown) => void) => (handlers[n] = f) };
    new Function('window', 'process', 'send', 'serializeError', t.REPORT_WHERE_CODE)(win, proc, (x: Report) => sent.push(x), serialize);
    handlers.error({ error: null, message: 'Script error.' });
    handlers.unhandledrejection({ reason: new Error('отказ') });
    handlers.uncaughtException(new Error('упал'), 'uncaughtException');
    expect(sent.map((s) => s.message)).toEqual(['Script error.', 'отказ', 'упал']);
    expect(sent[2].origin).toBe('uncaughtException');
    expect(proc.exitCode).toBe(1);
  });
});

// ─── Chromium ──────────────────────────────────────────────────────────────────────────────

const PAGE_ORIGIN = 'http://localhost:53011';
const FOREIGN = 'http://127.0.0.1:53012';
const FOREIGN_SCRIPTS: Record<string, string> = {
  '/boom.js': `function boom() { throw new Error('секрет из чужого скрипта'); }\nboom();\n`,
  '/later.js': `setTimeout(function later() { throw new Error('позже'); }, 0);\n`,
  '/reject.js': `Promise.reject(new Error('отказ в чужом скрипте'));\n`,
  // Свой скрипт отдельным файлом: строки в нём считаются от начала файла, а не страницы.
  '/created.js': `\nconst made = new Error('made');\nfunction later() {\n  throw made;\n}\nlater();\n`,
};

/** Страница с обработчиками из темы (`GLOBAL_CODE`), `send` складывает пришедшее в `R`. */
const pageWith = (body: string) => `<!doctype html><meta charset="utf-8"><script>
window.R = [];
const send = (x) => R.push(JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v === undefined ? '<undefined>' : v))));
${t.GLOBAL_CODE}
window.addEventListener('rejectionhandled', (e) => R.push({ handled: String(e.reason) }));
</script>${body}`;

const CASES: Record<string, string> = {
  nocors: `<script src="${FOREIGN}/boom.js"></script>`,
  cors: `<script crossorigin="anonymous" src="${FOREIGN}/boom.js?cors=1"></script>`,
  'cors-noheader': `<script crossorigin="anonymous" src="${FOREIGN}/boom.js"></script>`,
  'later-nocors': `<script src="${FOREIGN}/later.js"></script>`,
  'reject-nocors': `<script src="${FOREIGN}/reject.js"></script>`,
  'reject-cors': `<script crossorigin="anonymous" src="${FOREIGN}/reject.js?cors=1"></script>`,
  same: `<script src="/boom.js"></script>`,
  string: `<script>throw 'строка';</script>`,
  img: `<img src="/nope.png">`,
  late: `<script>const p = Promise.reject(new Error('поздно')); setTimeout(() => p.catch(() => {}), 50);</script>`,
  created: `<script src="/created.js"></script>`,
  report: `<script>reportError(new Error('через reportError')); R.push({ after: true }); console.error(new Error('только консоль'));</script>`,
};

function handler(origin: string, asyncDir?: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    if (asyncDir) {
      const c = t.ASYNC_CASES.find((x) => `/${x.file}` === url.pathname);
      if (c) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        res.end(c.code);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><meta charset="utf-8">');
      return;
    }
    const script = FOREIGN_SCRIPTS[url.pathname];
    if (script) {
      const h: Record<string, string> = { 'content-type': 'text/javascript; charset=utf-8' };
      if (url.searchParams.get('cors') === '1') h['access-control-allow-origin'] = PAGE_ORIGIN;
      res.writeHead(200, h);
      res.end(script);
      return;
    }
    if (url.pathname.startsWith('/case/') && origin === PAGE_ORIGIN) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageWith(CASES[url.pathname.slice(6)] ?? ''));
      return;
    }
    res.writeHead(404);
    res.end();
  };
}

describe('Chromium', () => {
  let browser: Browser;
  let page: Page;
  const servers: Server[] = [];
  const results: Record<string, { R: Record<string, unknown>[]; console: string[] }> = {};

  beforeAll(async () => {
    const listen = (s: Server, port: number, host: string) => new Promise<void>((r) => s.listen(port, host, () => r()));
    const a = createServer(handler('http://localhost:53010', 'async'));
    const b = createServer(handler(PAGE_ORIGIN));
    const c = createServer(handler(FOREIGN));
    servers.push(a, b, c);
    await Promise.all([listen(a, 53010, 'localhost'), listen(b, 53011, 'localhost'), listen(c, 53012, '127.0.0.1')]);
    browser = await chromium.launch();
    page = await browser.newPage();
    const consoleLines: string[] = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
    for (const id of Object.keys(CASES)) {
      consoleLines.length = 0;
      await page.goto(`${PAGE_ORIGIN}/case/${id}`);
      await page.waitForTimeout(200);
      results[id] = { R: await page.evaluate(() => (window as unknown as { R: Record<string, unknown>[] }).R), console: [...consoleLines] };
    }
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    for (const s of servers) s.close();
  });

  it('версия стенда', () => {
    expect(browser.version()).toMatch(/^\d+\./);
  });

  it('асинхронные сценарии: error.stack Chromium совпадает с литералом', async () => {
    await page.goto('http://localhost:53010/');
    for (const c of t.ASYNC_CASES) {
      const lines: string[] = [];
      const on = (m: { text(): string }) => lines.push(m.text());
      page.on('console', on);
      await page.evaluate((f) => {
        const s = document.createElement('script');
        s.type = 'module';
        s.src = `/${f}`;
        document.head.append(s);
      }, c.file);
      await page.waitForTimeout(150);
      page.off('console', on);
      expect(lines.join('\n'), c.id).toBe(c.chromium);
    }
  });

  it('LAZY_CHROMIUM: message из момента создания, name — текущее; лимит 10, prepareStackTrace нет', async () => {
    const r = await page.evaluate(
      (code) => {
        const out: string[] = [];
        const log = (s: string) => out.push(s);
        new Function('console', code)({ log });
        const n = new Error('n');
        n.name = 'Renamed';
        return {
          lazy: out,
          name: n.stack!.split('\n')[0],
          limit: Error.stackTraceLimit,
          prepare: typeof (Error as unknown as { prepareStackTrace?: unknown }).prepareStackTrace,
          isError: typeof (Error as unknown as { isError?: unknown }).isError,
        };
      },
      t.LAZY_RUN.code,
    );
    expect(r.lazy).toEqual(t.LAZY_CHROMIUM);
    expect(r.name).toBe('Renamed: n');
    expect(r).toMatchObject({ limit: 10, prepare: 'undefined', isError: 'function' });
  });

  it('using и SuppressedError работают так же, как в Node', async () => {
    const code = t.USING_RUN.code;
    // Строкой, а не функцией: vitest переписывает `import()` в теле функции под себя.
    const src = `const console = { log: (...a) => window.__u.push(a.join(' ')) };\n${code}`;
    const out = (await page.evaluate(`(async () => {
      window.__u = [];
      const blob = new Blob([${JSON.stringify(src)}], { type: 'text/javascript' });
      await import(URL.createObjectURL(blob));
      return window.__u;
    })()`)) as string[];
    expect(out).toEqual(t.USING_RUN.out.split('\n').slice(1));
  });

  it('structuredClone в Chromium — как в CLONE_ROWS', async () => {
    const r = await page.evaluate(() => {
      const top = structuredClone(new Error('top', { cause: new Error('root') }));
      const agg = structuredClone(new AggregateError([new Error('q')], 'agg')) as Error & { errors?: unknown };
      const c = structuredClone(Object.assign(new Error('c'), { code: 'E' })) as Error & { code?: unknown };
      return [top.message, (top.cause as Error).message, typeof top.stack, agg.constructor.name, agg.errors, c.code, structuredClone(new TypeError('t')).constructor.name];
    });
    expect(r).toEqual(['top', 'root', 'string', 'Error', undefined, undefined, 'TypeError']);
  });

  const onerror = (id: string) => results[id].R.find((x) => 'message' in x && 'lineno' in x);

  it('чужой скрипт без crossorigin — «Script error.», пусто и null; из таймера — так же', () => {
    for (const id of ['nocors', 'later-nocors']) {
      expect(onerror(id), id).toEqual({ message: 'Script error.', source: '', lineno: 0, colno: 0, error: null });
    }
  });

  it('с crossorigin и заголовком — текст, адрес, 1:25 и ошибка; без заголовка скрипт не исполнен', () => {
    expect(onerror('cors')).toMatchObject({
      message: 'Uncaught Error: секрет из чужого скрипта',
      source: `${FOREIGN}/boom.js?cors=1`,
      lineno: 1,
      colno: 25,
    });
    expect((onerror('cors')!.error as { stack: string }).stack).toContain('at boom');
    expect(FOREIGN_SCRIPTS['/boom.js'].slice(24, 27)).toBe('new');
    expect(onerror('cors-noheader')).toBeUndefined();
    expect(results['cors-noheader'].R).toEqual([{ failed: `${FOREIGN}/boom.js` }]);
  });

  it('отказ в чужом скрипте без crossorigin — unhandledrejection нет; с crossorigin — есть', () => {
    expect(results['reject-nocors'].R).toEqual([]);
    expect(results['reject-nocors'].console.join('\n')).toContain('отказ в чужом скрипте');
    const r = results['reject-cors'].R[0] as { reason: { stack: string } };
    expect(r.reason.stack).toContain(`${FOREIGN}/reject.js?cors=1:1:16`);
  });

  it('свой скрипт и throw строки; 404 картинки — только на перехвате', () => {
    expect(onerror('same')).toMatchObject({ message: 'Uncaught Error: секрет из чужого скрипта', lineno: 1, colno: 25 });
    expect(onerror('string')).toMatchObject({ message: 'Uncaught строка', error: 'строка' });
    expect(results.img.R).toEqual([{ failed: `${PAGE_ORIGIN}/nope.png` }]);
  });

  it('onerror получает место создания, а не throw', () => {
    expect(onerror('created')).toMatchObject({ lineno: 2, colno: 14 });
    expect(t.GLOBAL_FACTS[1].d).toContain('`lineno` 2 и `colno` 14');
  });

  it('опоздавший catch: unhandledrejection, затем rejectionhandled', () => {
    expect(results.late.R.map((x) => ('handled' in x ? 'handled' : 'reason' in x ? 'unhandled' : '?'))).toEqual(['unhandled', 'handled']);
  });

  it('reportError — синхронное событие error, выполнение идёт дальше; console.error — не событие', () => {
    const R = results.report.R;
    expect(onerror('report')).toMatchObject({ message: 'Uncaught Error: через reportError' });
    expect(R.at(-1)).toEqual({ after: true });
    expect(R).toHaveLength(2);
  });
});
