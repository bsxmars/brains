import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/closures/data';
import { parse } from '@/widgets/scope-lab/model/parser';
import { runReal, traceProgram } from '@/widgets/scope-lab/model/run';
import type { Trace } from '@/widgets/scope-lab/model/types';

/**
 * Тема «Замыкания и области видимости».
 *
 * Учебный интерпретатор — пять строк темы (`ENV_CODE` … `EVAL_CODE`), их печатает страница
 * и исполняет демо. Здесь он сверяется с настоящим V8: на программах темы и на наборе своих
 * программ вывод и тексты ошибок совпадают с `vm` в Node (строгий режим, настоящие таймеры)
 * и с Chromium. Утверждения о V8 — состав Context, удержание, отладчик — исполняются в
 * отдельных процессах Node: снимок кучи, `queryObjects` и `node:inspector` в процессе vitest
 * дали бы чужие объекты и чужие паузы.
 */

const dir = mkdtempSync(join(tmpdir(), 'closures-'));

/** Программа в строгом режиме настоящим V8: `vm`, настоящие таймеры, ошибки — строкой. */
async function inVm(code: string): Promise<string[]> {
  const out: string[] = [];
  let pending = 0;
  const fmt = (v: unknown) => (typeof v === 'function' ? `[Function: ${v.name || '(anonymous)'}]` : String(v));
  const ctx = vm.createContext({
    console: { log: (...a: unknown[]) => out.push(a.map(fmt).join(' ')) },
    setTimeout: (fn: () => void, ms = 0) => {
      pending++;
      setTimeout(() => {
        pending--;
        try {
          fn();
        } catch (e) {
          out.push(`${(e as Error).name}: ${(e as Error).message}`);
        }
      }, ms);
    },
  });
  try {
    vm.runInContext(`"use strict";\n${code}`, ctx);
  } catch (e) {
    out.push(`${(e as Error).name}: ${(e as Error).message}`);
  }
  while (pending > 0) await new Promise((r) => setTimeout(r, 5));
  return out;
}

const trace = (code: string): Trace => traceProgram(t.INTERPRETER_CODES, parse(code));
const texts = (tr: Trace) => tr.out.map((l) => l.text);

/** Свои программы теста: каждая задевает одно правило окружений. */
const EXTRA: Record<string, string> = {
  shadow: "let x = 'внешний';\n{\n  let x = 'внутренний';\n  console.log(x);\n}\nconsole.log(x);",
  constAssign: 'const c = 1;\nc = 2;',
  undeclared: 'console.log(nope);',
  undeclaredAssign: 'nope = 1;',
  typeofTdz: 'console.log(typeof x);\nlet x = 1;',
  letSelf: 'let x = x;',
  shadowTdz: 'let x = 1;\n{\n  console.log(x);\n  let x = 2;\n}',
  laterOk: 'function f() { return z; }\nlet z = 5;\nconsole.log(f());',
  timerTdz: "setTimeout(() => console.log(late), 0);\nconsole.log('синхронно');\nlet late = 'уже есть';",
  timerAfterError: "setTimeout(() => console.log('таймер сработал'), 0);\nconsole.log(boom);",
  nested: 'function outer() {\n  const a = 1;\n  return function () {\n    const b = 2;\n    return () => a + b;\n  };\n}\nconsole.log(outer()()());',
  recursion: 'function fact(n) {\n  return n <= 1 ? 1 : n * fact(n - 1);\n}\nconsole.log(fact(5));',
  varAfterLoop: "var log = '';\nfor (var i = 0; i < 3; i++) {\n  log += i;\n}\nconsole.log(log, i);",
  letAfterLoop: 'for (let i = 0; i < 2; i++) {}\nconsole.log(typeof i);',
  constLoop: "for (const k = 0; false; ) {}\nconsole.log('ok');",
  blockFn: "{\n  function inner() { return 'в блоке'; }\n  console.log(inner());\n}\nconsole.log(typeof inner);",
  notFn: 'const n = 1;\nn();',
  template: "const name = 'мир';\nconsole.log(`привет, ${name}`);",
  timersOrder: "setTimeout(() => console.log('b'), 10);\nsetTimeout(() => console.log('a'), 0);\nsetTimeout(() => { console.log('c'); setTimeout(() => console.log('d'), 0); }, 0);",
  returnInLoop: 'function first() {\n  for (let i = 0; i < 10; i++) {\n    if (i === 2) return () => i;\n  }\n}\nconsole.log(first()());',
  paramShadow: 'function f(x) {\n  var x;\n  return x;\n}\nconsole.log(f(7));',
  closureWrites: 'let total = 0;\nconst add = (n) => { total += n; };\nadd(2);\nadd(3);\nconsole.log(total);',
  loopContinue: 'let seen = 0;\nfor (let i = 0; i < 3; i++) {\n  if (i === 1) continue;\n}',
  fnName: 'const named = () => 1;\nconsole.log(named);',
  varInBlockFn: 'function f() {\n  {\n    var deep = 1;\n  }\n  return deep;\n}\nconsole.log(f());',
};
// `continue` интерпретатор не знает — программа выше проверяет, что он честно сдаётся.
const UNSUPPORTED = new Set(['loopContinue']);

const ALL: [string, string][] = [
  ...t.PROGRAMS.map((p): [string, string] => [p.id, p.code]),
  ['wallet', t.WALLET_PROGRAM],
  ['body-inc', t.BODY_INC_PROGRAM],
  ['iife', t.IIFE_PROGRAM],
  ...Object.entries(EXTRA).filter(([k]) => !UNSUPPORTED.has(k)),
];

describe('интерпретатор темы против V8', () => {
  it.each(ALL)('%s: вывод и ошибки совпадают с vm', async (_, code) => {
    const tr = trace(code);
    expect(tr.problem).toBeNull();
    expect(texts(tr)).toEqual(await inVm(code));
  });

  it('программы демо печатают то, что записано в PROGRAM_OUT', async () => {
    for (const p of t.PROGRAMS) {
      expect(texts(trace(p.code)), p.id).toEqual(t.PROGRAM_OUT[p.id]);
      expect((await runReal(p.code)).map((l) => l.text), p.id).toEqual(t.PROGRAM_OUT[p.id]);
    }
    expect(texts(trace(t.WALLET_PROGRAM))).toEqual([t.WALLET_OUT]);
    expect(texts(trace(t.BODY_INC_PROGRAM))).toEqual([t.BODY_INC_OUT]);
    expect(texts(trace(t.IIFE_PROGRAM))).toEqual(t.IIFE_OUT);
  });

  it('за подмножеством интерпретатор сдаётся, а не врёт; бесконечный цикл обрывается', () => {
    expect(trace(EXTRA.loopContinue).problem).toContain('ContinueStatement');
    expect(trace('const o = { a: 1 };').problem).toContain('ObjectExpression');
    expect(trace('for (let i = 0; ; i++) {}').problem).toContain('бесконечный цикл');
  });
});

describe('окружения в демо', () => {
  const last = (tr: Trace) => tr.steps[tr.steps.length - 1];

  it('счётчик: после программы удержаны два окружения makeCounter', () => {
    const end = last(trace(t.COUNTER_PROGRAM.code));
    const held = end.envs.filter((e) => e.role === 'held');
    expect(held.map((e) => e.title)).toEqual(['вызов makeCounter', 'вызов makeCounter']);
    expect(held.map((e) => e.vars.find((v) => v.name === 'count')?.value).sort()).toEqual(['1', '2']);
  });

  it('let в цикле: перед первым таймером удержаны три итерации с 0, 1, 2; var — ни одной', () => {
    const firstTimer = (code: string) => trace(code).steps.find((s) => s.event === 'timer')!;
    const letStep = firstTimer(t.LOOP_LET_PROGRAM.code);
    const iters = letStep.envs.filter((e) => e.title === 'итерация');
    expect(iters.map((e) => e.vars[0].value).sort()).toEqual(['0', '1', '2']);
    const varStep = firstTimer(t.LOOP_VAR_PROGRAM.code);
    expect(varStep.envs.some((e) => e.title === 'итерация')).toBe(false);
    expect(varStep.envs.find((e) => e.title === 'глобальное')?.vars.find((v) => v.name === 'i')?.value).toBe('3');
  });

  it('копия итерации: peek держит окружение init, где i так и осталась 0', () => {
    const end = last(trace(t.PEEK_PROGRAM.code));
    expect(end.envs).toEqual([expect.objectContaining({ title: 'глобальное', role: 'current' })]);
    const mid = trace(t.PEEK_PROGRAM.code).steps.filter((s) => s.event === 'copy').at(-1)!;
    const init = mid.envs.find((e) => e.title === 'for: init')!;
    expect(init.vars.find((v) => v.name === 'i')?.value).toBe('0');
    expect(mid.note).toContain('скопировано');
  });

  it('мёртвая зона: на старте label заведён, но без значения', () => {
    const start = trace(t.TDZ_PROGRAM.code).steps[0];
    expect(start.event).toBe('start');
    const label = start.envs[0].vars.find((v) => v.name === 'label')!;
    expect(label.tdz).toBe(true);
    const hoisted = trace(t.HOIST_PROGRAM.code).steps[0].envs[0].vars;
    expect(hoisted.find((v) => v.name === 'v')?.value).toBe('undefined');
    expect(hoisted.find((v) => v.name === 'hoisted')?.value).toBe('ƒ hoisted');
  });

  it('лексическая область: в цепочке speak нет окружения caller', () => {
    const call = trace(t.LEXICAL_PROGRAM.code).steps.find((s) => s.event === 'call' && s.note.includes('speak'))!;
    const chain = call.envs.filter((e) => e.role !== 'held').map((e) => e.title);
    expect(chain).toEqual(['вызов speak', 'глобальное']);
  });
});

describe('мёртвая зона, typeof и тексты ошибок V8', () => {
  const runStrict = (code: string) => {
    try {
      const v = vm.runInNewContext(`"use strict";\n${code}`, { console });
      return typeof v === 'string' ? `'${v}'` : String(v);
    } catch (e) {
      return `${(e as Error).name}: ${(e as Error).message}`;
    }
  };

  it.each(t.TDZ_CASES.map((c) => [c.code, c.out]))('%s → %s', (code, out) => {
    expect(runStrict(code)).toBe(out);
  });

  it('колонка V8 в таблице ошибок совпадает с Node', () => {
    t.ERROR_SOURCES.forEach((code, i) => expect(runStrict(code)).toBe(t.ERROR_ROWS[i].v8));
  });

  it('with в строгом режиме — SyntaxError', () => {
    expect(runStrict('with ({}) {}')).toBe('SyntaxError: Strict mode code may not include a with statement');
    expect(t.EVAL_FACTS[1].d).toContain('`SyntaxError`');
  });
});

describe('глобальное окружение: два скрипта одного контекста', () => {
  it('var — свойство globalThis, let — нет, но виден другим скриптам; повтор let — SyntaxError', () => {
    const ctx = vm.createContext({});
    vm.runInContext(t.GLOBAL_SCRIPT, ctx);
    for (const p of t.GLOBAL_PROBES) {
      const v = vm.runInContext(p.expr, ctx);
      expect(typeof v === 'string' ? `'${v}'` : String(v), p.expr).toBe(p.out);
    }
    expect(() => vm.runInContext(t.GLOBAL_REDECLARE, ctx)).toThrow("Identifier 'gl' has already been declared");
    expect(t.GLOBAL_CODE).toContain("SyntaxError: Identifier 'gl' has already been declared");
  });
});

describe('Chromium: те же программы, тексты и глобальное окружение', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('программы темы, тексты ошибок V8 и скрипты страницы', async () => {
    const page = await browser.newPage();
    const programs = [...t.PROGRAMS.map((p) => p.code)];
    const result = await page.evaluate(
      async ({ programs, errors, script, redeclare, probes }) => {
        const run = async (code: string) => {
          const out: string[] = [];
          let pending = 0;
          const log = (...a: unknown[]) => out.push(a.map(String).join(' '));
          const st = (fn: () => void, ms = 0) => {
            pending++;
            setTimeout(() => {
              pending--;
              try {
                fn();
              } catch (e) {
                out.push(`${(e as Error).name}: ${(e as Error).message}`);
              }
            }, ms);
          };
          try {
            new Function('console', 'setTimeout', `"use strict";\n${code}`)({ log }, st);
          } catch (e) {
            out.push(`${(e as Error).name}: ${(e as Error).message}`);
          }
          while (pending > 0) await new Promise((r) => setTimeout(r, 5));
          return out;
        };
        const outs = [];
        for (const p of programs) outs.push(await run(p));
        const errs = errors.map((code) => {
          try {
            new Function(`"use strict";\n${code}`)();
            return 'ok';
          } catch (e) {
            return `${(e as Error).name}: ${(e as Error).message}`;
          }
        });
        const add = (text: string) => {
          const s = document.createElement('script');
          s.textContent = text;
          document.head.append(s);
        };
        let redeclared = '';
        window.addEventListener('error', (e) => (redeclared = e.message));
        add(script);
        add(`window.__probes = [${probes.join(', ')}];`);
        add(redeclare);
        return { outs, errs, probes: (window as unknown as { __probes: unknown[] }).__probes, redeclared };
      },
      {
        programs,
        errors: t.ERROR_SOURCES,
        script: t.GLOBAL_SCRIPT,
        redeclare: t.GLOBAL_REDECLARE,
        probes: t.GLOBAL_PROBES.map((p) => p.expr),
      },
    );
    t.PROGRAMS.forEach((p, i) => expect(result.outs[i], p.id).toEqual(t.PROGRAM_OUT[p.id]));
    expect(result.errs).toEqual(t.ERROR_ROWS.map((r) => r.v8));
    expect(result.probes.map((v) => (typeof v === 'string' ? `'${v}'` : String(v)))).toEqual(t.GLOBAL_PROBES.map((p) => p.out));
    expect(result.redeclared).toContain("Identifier 'gl' has already been declared");
    await page.close();
  }, 60_000);
});

/** Отдельный процесс Node: снимок кучи, `queryObjects` и отладчик видят только свой код. */
function node(name: string, code: string, flags: string[] = []): string {
  const file = join(dir, name);
  writeFileSync(file, code);
  return execFileSync(process.execPath, [...flags, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

describe('что V8 кладёт в Context и что из-за этого живёт', () => {
  it('состав Context по снимку кучи — как в CONTEXT_ROWS', () => {
    const reader = `
const v8 = require('node:v8');
const chunks = [];
const s = v8.getHeapSnapshot();
s.on('data', (c) => chunks.push(c));
s.on('end', () => {
  const snap = JSON.parse(Buffer.concat(chunks).toString());
  const m = snap.snapshot.meta, nf = m.node_fields.length, ef = m.edge_fields.length;
  const N = snap.nodes, E = snap.edges, S = snap.strings, ec = m.node_fields.indexOf('edge_count');
  const first = []; let e = 0;
  for (let i = 0; i < N.length; i += nf) { first.push(e); e += N[i + ec] * ef; }
  const edges = (i) => { const o = []; for (let k = 0; k < N[i * nf + ec]; k++) { const b = first[i] + k * ef; const ty = m.edge_types[0][E[b]]; o.push({ ty, nm: ty === 'element' || ty === 'hidden' ? E[b + 1] : S[E[b + 1]], to: E[b + 2] / nf }); } return o; };
  const out = {};
  for (let i = 0; i < N.length / nf; i++) {
    const name = S[N[i * nf + 1]];
    if (m.node_types[0][N[i * nf]] !== 'closure' || !/^from[A-Z]/.test(name)) continue;
    const ctx = edges(i).find((x) => x.nm === 'context').to;
    out[name] = edges(ctx).filter((x) => x.ty === 'context').map((x) => x.nm);
  }
  console.log(JSON.stringify(out));
});`;
    const slots = JSON.parse(node('context.cjs', `${t.CONTEXT_CODE}\nglobalThis.kept = kept;\n${reader}`)) as Record<string, string[]>;
    expect(slots.fromPlain).toEqual(['x']);
    expect(slots.fromSibling).toEqual(['big', 'x']);
    expect(slots.fromEval).toEqual(['this', '.new.target', 'big', 'x', 'unused', 'arguments']);
    // Своего Context нет: у функции контекст модуля, в нём нет ни big, ни x.
    expect(slots.fromIndirect).not.toContain('big');
    expect(slots.fromIndirect).not.toContain('x');
    expect(t.CONTEXT_ROWS.map((r) => r.slots)).toEqual([
      '`x`',
      '`big`, `x`',
      '`this`, `.new.target`, `big`, `x`, `unused`, `arguments`',
      'своего Context нет',
    ]);
  });

  it('%DebugPrint: итерации for (let) — разные BlockContext, for (var) — один FunctionContext', () => {
    const out = node(
      'loop.js',
      `function loopLet() { const fs = []; for (let i = 0; i < 2; i++) fs.push(() => i); return fs; }
function loopVar() { const fs = []; for (var i = 0; i < 2; i++) fs.push(() => i); return fs; }
for (const f of [...loopLet(), ...loopVar()]) %DebugPrint(f);`,
      ['--allow-natives-syntax'],
    );
    const ctx = [...out.matchAll(/ - context: (0x[0-9a-f]+) <(\w+)\[/g)].map((m) => [m[1], m[2]]);
    expect(ctx.map((c) => c[1])).toEqual(['BlockContext', 'BlockContext', 'FunctionContext', 'FunctionContext']);
    expect(ctx[0][0]).not.toBe(ctx[1][0]);
    expect(ctx[2][0]).toBe(ctx[3][0]);
    expect(t.LOOP_V8_NOTE).toContain('`BlockContext`');
  });

  it('байткод: без замыкания в теле for (let) контекста нет, с замыканием — CreateBlockContext', () => {
    const file = join(dir, 'bytecode.js');
    writeFileSync(
      file,
      `function noClosure() { let s = 0; for (let i = 0; i < 3; i++) { s += i; } return s; }
function withClosure() { const fs = []; for (let i = 0; i < 3; i++) { fs.push(() => i); } return fs; }
noClosure(); withClosure();`,
    );
    const bytecode = (name: string) =>
      execFileSync(process.execPath, ['--print-bytecode', `--print-bytecode-filter=${name}`, file], { encoding: 'utf8' });
    expect(bytecode('noClosure')).not.toMatch(/CreateBlockContext|PushContext/);
    expect(bytecode('withClosure')).toContain('CreateBlockContext');
    expect(t.LOOP_V8_NOTE).toContain('живёт в регистре');
  });

  it('queryObjects: сосед и eval держат все десять Big, одиночка и обнулённый — ни одного', () => {
    const out = node('retain.cjs', t.RETAIN_CODE).trim().split('\n');
    expect(out).toEqual(t.RETAIN_OUT);
  });

  it('отладчик в паузе внутри замыкания: x есть, big — not defined', () => {
    const harness = `
const inspector = require('node:inspector');
const s = new inspector.Session();
s.connect();
const seen = {};
s.on('Debugger.paused', (msg) => {
  const id = msg.params.callFrames[0].callFrameId;
  for (const expression of ${JSON.stringify(t.DEBUG_ROWS.map((r) => r.expr))}) {
    s.post('Debugger.evaluateOnCallFrame', { callFrameId: id, expression }, (err, r) => {
      seen[expression] = r.exceptionDetails ? r.result.description.split('\\n')[0] : String(r.result.value);
    });
  }
  s.post('Debugger.resume');
});
s.post('Debugger.enable');
${t.DEBUG_CODE}
console.log(JSON.stringify(seen));`;
    const seen = JSON.parse(node('debug.cjs', harness)) as Record<string, string>;
    for (const r of t.DEBUG_ROWS) expect(seen[r.expr], r.expr).toBe(r.out);
  });
});

describe('приватность', () => {
  it('модульный паттерн: count не достать, ключи — только методы', () => {
    const [value, hidden, keys] = new Function(`${t.MODULE_CODE}\nreturn [counter.value, counter.count, Object.keys(counter)];`)();
    expect(value).toBe(2);
    expect(hidden).toBeUndefined();
    expect(keys).toEqual(['inc', 'value']);
    expect(t.MODULE_CODE).toContain("// ['inc', 'value']");
  });

  it('фабрика даёт свои методы каждому объекту, класс — общие', () => {
    const [factory, klass] = new Function(
      `${t.FACTORY_CODE}\nreturn [makeCounter().inc === makeCounter().inc, new Counter().inc === new Counter().inc];`,
    )();
    expect(factory).toBe(false);
    expect(klass).toBe(true);
  });
});

describe('числа в тексте', () => {
  it('подписи держат то, что сверено выше', () => {
    expect(t.CLOSURE_FACTS[0].d).toContain('`1 2 1`');
    expect(t.CLOSURE_FACTS[1].d).toContain('`15`');
    // «1 и 3» — результат BODY_INC_PROGRAM: копируется значение на конец тела.
    expect(t.COPY_NOTE).toContain('`1` и `3`');
    expect(t.INTERPRETER_CODES.join('\n')).toContain('Cannot access');
  });
});
