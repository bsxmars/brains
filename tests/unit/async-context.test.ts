import { execFileSync, spawn } from 'node:child_process';
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { context, createContextKey, ROOT_CONTEXT } from '@opentelemetry/api';
import { compileScript, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/async-context/data';
import { loadGlobal, loadMini, runMini, runScenario } from '@/widgets/context-lab/model/run';
import type { Ctx, LogEntry } from '@/widgets/context-lab/model/types';

/**
 * Тема «Асинхронный контекст: AsyncLocalStorage и AsyncContext».
 *
 * Код на странице — строки `data.ts`; здесь исполняются именно они. Сценарии демо гоняются
 * с тремя `ctx`: глобальной переменной (`GLOBAL_CODE`), настоящим `AsyncLocalStorage`
 * (`ALS_CTX_CODE`, в обоих режимах Node 24) и учебной обёрткой (`MINI_CODE`), и журналы
 * сверяются с `LOGS`. Сервер, `enterWith`, момент снимка и цена старой реализации —
 * в отдельных процессах Node с флагом и без: в процессе vitest режим один.
 */

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

/** Узел в отдельном процессе; `flags` — флаги Node, `code` — ES-модуль. */
function nodeModule(code: string, flags: string[] = []): string {
  return execFileSync(process.execPath, [...flags, '--input-type=module', '-e', code], { encoding: 'utf8' });
}

const MODES = [
  { id: 'frame', flags: [] as string[] },
  { id: 'legacy', flags: ['--no-async-context-frame'] },
];

/** Ключ строки журнала: порядок событий машиной нагрузкой не управляется, а «кто что видел» — да. */
const byKey = (logs: LogEntry[]) => Object.fromEntries(logs.map((e) => [`${e.who}:${e.what}`, e.seen]));

function alsCtx(): Ctx {
  return new Function('AsyncLocalStorage', `${t.ALS_CTX_CODE}\nreturn ctx;`)(AsyncLocalStorage) as Ctx;
}

describe('сценарии демо: три реализации против LOGS', () => {
  const mini = loadMini(t.MINI_CODE);

  it('у каждого сценария есть журнал в трёх режимах', () => {
    expect(Object.keys(t.LOGS).sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
  });

  for (const s of t.SCENARIOS) {
    it(`${s.id}: глобальная переменная, ALS и учебная обёртка`, async () => {
      const global = await runScenario(s.code, t.SLEEP_CODE, loadGlobal(t.GLOBAL_CODE));
      const als = await runScenario(s.code, t.SLEEP_CODE, alsCtx());
      const own = await runMini(s.code, t.SLEEP_CODE, mini);

      expect(byKey(global)).toEqual(byKey(t.LOGS[s.id].global));
      expect(byKey(als)).toEqual(byKey(t.LOGS[s.id].als));
      expect(byKey(own)).toEqual(byKey(t.LOGS[s.id].mini));
      // Порядок событий — как в литерале: задержки в сценариях разнесены на 10 мс и больше.
      expect(als.map((e) => `${e.who}:${e.what}`)).toEqual(t.LOGS[s.id].als.map((e) => `${e.who}:${e.what}`));
    });
  }

  it('ALS всегда видит свой запрос; обёртка расходится с ALS только в сценарии с await', () => {
    for (const [id, logs] of Object.entries(t.LOGS)) {
      expect(logs.als.every((e) => e.seen === e.who), id).toBe(true);
      const same = JSON.stringify(byKey(logs.mini)) === JSON.stringify(byKey(logs.als));
      expect(same, id).toBe(id !== 'await');
    }
    expect(t.LOGS.await.mini.filter((e) => e.what === 'после await').map((e) => e.seen)).toEqual([null, null]);
  });

  it('старая реализация ALS даёт те же журналы', () => {
    const script = `
      import { AsyncLocalStorage } from 'node:async_hooks';
      const scenarios = ${JSON.stringify(t.SCENARIOS.map((s) => [s.id, s.code]))};
      const out = {};
      for (const [id, code] of scenarios) {
        const ctx = new Function('AsyncLocalStorage', ${JSON.stringify(t.ALS_CTX_CODE)} + '\\nreturn ctx;')(AsyncLocalStorage);
        const logs = [];
        const log = (who, what) => logs.push({ who, what, seen: ctx.get() ?? null });
        await new Function('ctx', 'log', ${JSON.stringify(t.SLEEP_CODE)} + '\\n' + code)(ctx, log);
        out[id] = logs;
      }
      console.log(JSON.stringify(out));`;
    const out = JSON.parse(nodeModule(script, ['--no-async-context-frame'])) as Record<string, LogEntry[]>;
    for (const s of t.SCENARIOS) expect(byKey(out[s.id]), s.id).toEqual(byKey(t.LOGS[s.id].als));
  });

  it('обёртка возвращает глобальные функции на место', async () => {
    const then = Promise.prototype.then;
    const st = globalThis.setTimeout;
    await runMini(t.SCENARIOS[0].code, t.SLEEP_CODE, mini);
    expect(Promise.prototype.then).toBe(then);
    expect(globalThis.setTimeout).toBe(st);
  });
});

describe('почему обёртка не видит await — THEN_CALLS', () => {
  it('подменённый then: await — 0 вызовов, Promise.all из двух — 2, catch и finally — по 1', async () => {
    const original = Promise.prototype.then;
    // Считаем только вызовы на своих промисах: в процессе vitest then зовёт и чужой код.
    const mine = new Set<unknown>();
    let n = 0;
    Promise.prototype.then = function (this: Promise<unknown>, ...a: Parameters<typeof original>) {
      if (mine.has(this)) n++;
      return original.apply(this, a);
    } as typeof original;
    const fresh = () => {
      const p = Promise.resolve(1);
      mine.add(p);
      return p;
    };
    const counts: Record<string, number> = {};
    try {
      n = 0;
      await fresh();
      counts.await = n;
      n = 0;
      void Promise.all([fresh(), fresh()]);
      counts.all2 = n;
      n = 0;
      void fresh().catch(() => {});
      counts.catch = n;
      n = 0;
      void fresh().finally(() => {});
      counts.finally = n;
    } finally {
      Promise.prototype.then = original;
    }
    expect(counts).toEqual(t.THEN_CALLS);
  });
});

describe('сервер на node:http — SERVER_*_LOG', () => {
  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const srv = createServer().listen(0, () => {
        const port = (srv.address() as { port: number }).port;
        srv.close(() => resolve(port));
      });
    });
  }

  async function serve(code: string): Promise<string> {
    const port = await freePort();
    const child = spawn(process.execPath, ['--input-type=module', '-e', code.replace('.listen(5020)', `.listen(${port})`)]);
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += String(d)));
    try {
      for (let i = 0; i < 100; i++) {
        try {
          await fetch(`http://localhost:${port}/ping`, { headers: { 'x-request-id': 'probe' } });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      out = '';
      nodeModule(t.CLIENT_CODE.replace('localhost:5020', `localhost:${port}`));
      await new Promise((r) => setTimeout(r, 100));
      return out.trim();
    } finally {
      child.kill();
    }
  }

  it('глобальная переменная подписывает лог корзины чужим id', async () => {
    expect(await serve(t.SERVER_GLOBAL_CODE)).toBe(t.SERVER_GLOBAL_LOG);
  }, 20_000);

  it('с AsyncLocalStorage каждый лог — со своим id', async () => {
    expect(await serve(t.SERVER_ALS_CODE)).toBe(t.SERVER_ALS_LOG);
  }, 20_000);
});

describe('момент снимка и enterWith — в обоих режимах Node 24', () => {
  for (const mode of MODES) {
    it(`CAPTURE_SEEN (${mode.id})`, () => {
      const script = `
        import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
        import { EventEmitter } from 'node:events';
        const r = await (async () => {\n${t.CAPTURE_CODE}\n})();
        console.log(JSON.stringify(r));`;
      expect(JSON.parse(nodeModule(script, mode.flags))).toEqual(t.CAPTURE_SEEN);
    });

    it(`ENTER_WITH_SEEN (${mode.id})`, () => {
      const script = `
        import { AsyncLocalStorage } from 'node:async_hooks';
        import { EventEmitter } from 'node:events';
        const r = (() => {\n${t.ENTER_WITH_CODE}\n})();
        console.log(JSON.stringify(r));`;
      expect(JSON.parse(nodeModule(script, mode.flags))).toEqual(t.ENTER_WITH_SEEN);
    });
  }

  it('в процессе vitest (Node 24, новая реализация) — то же', async () => {
    const run = new AsyncFunction('AsyncLocalStorage', 'AsyncResource', 'EventEmitter', t.CAPTURE_CODE);
    expect(await run(AsyncLocalStorage, AsyncResource, EventEmitter)).toEqual(t.CAPTURE_SEEN);
  });

  it('у каждой строки таблицы есть ответ', () => {
    expect(t.CAPTURE_ROWS.map((r) => r.key)).toEqual(Object.keys(t.CAPTURE_SEEN));
    expect(t.ENTER_WITH_ROWS.map((r) => r.v.replaceAll('`', ''))).toEqual(Object.values(t.ENTER_WITH_SEEN));
  });
});

describe('устройство в Node — COST_RESULT, флаги, кадр', () => {
  it('вызовы _propagate: 0 в новой реализации, 8/8/16/16 в старой', () => {
    const run = (flags: string[]) => JSON.parse(execFileSync(process.execPath, [...flags, '-e', t.COST_CODE], { encoding: 'utf8' }));
    expect(run([])).toEqual(t.COST_RESULT.frame);
    expect(run(['--no-async-context-frame'])).toEqual(t.COST_RESULT.legacy);
    expect(t.COST_ROWS.map((r) => [r.frame, r.legacy])).toEqual([
      [String(t.COST_RESULT.frame.inRun), String(t.COST_RESULT.legacy.inRun)],
      [String(t.COST_RESULT.frame.outside), String(t.COST_RESULT.legacy.outside)],
      [String(t.COST_RESULT.frame.secondCreated), String(t.COST_RESULT.legacy.secondCreated)],
      [String(t.COST_RESULT.frame.twoStores), String(t.COST_RESULT.legacy.twoStores)],
    ]);
  });

  it('8 = ресурсы одного обработчика: 6 промисов и 2 таймера', () => {
    const code = `
      const { createHook, AsyncLocalStorage } = require('node:async_hooks');
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      async function handler() { await sleep(1); await sleep(1); }
      const als = new AsyncLocalStorage();
      const types = {};
      const hook = createHook({ init(id, type) { types[type] = (types[type] ?? 0) + 1; } });
      hook.enable();
      als.run('r-1', handler).then(() => { hook.disable(); console.log(JSON.stringify(types)); });`;
    const types = JSON.parse(execFileSync(process.execPath, ['--no-async-context-frame', '-e', code], { encoding: 'utf8' }));
    expect(types).toEqual(t.COST_RESOURCES);
    expect(t.COST_RESOURCES.PROMISE + t.COST_RESOURCES.Timeout).toBe(t.COST_RESULT.legacy.inRun);
  });

  it('хуков async_hooks: 0 в новой реализации, 1 в старой — уже после конструктора', () => {
    const code = `
      const { getHookArrays } = require('internal/async_hooks');
      const { AsyncLocalStorage } = require('node:async_hooks');
      const als = new AsyncLocalStorage();
      const afterNew = getHookArrays()[0].length;
      als.run(1, () => {});
      console.log(JSON.stringify([afterNew, getHookArrays()[0].length]));`;
    const run = (flags: string[]) => JSON.parse(execFileSync(process.execPath, [...flags, '--expose-internals', '-e', code], { encoding: 'utf8' }));
    expect(run([])).toEqual([0, 0]);
    expect(run(['--no-async-context-frame'])).toEqual([1, 1]);
  });

  it('кадр — словарь со всеми хранилищами; run создаёт новый', () => {
    const code = `
      const F = require('internal/async_context_frame');
      const { AsyncLocalStorage } = require('node:async_hooks');
      const a = new AsyncLocalStorage(), b = new AsyncLocalStorage();
      const out = {};
      a.run(1, () => {
        const outer = F.current();
        b.run(2, () => {
          const inner = F.current();
          out.tag = Object.prototype.toString.call(inner);
          out.size = inner.size;
          out.values = [...inner.values()];
          out.newFrame = inner !== outer;
          out.outerKept = outer.size;
        });
      });
      const chain = [];
      for (let p = Object.getPrototypeOf(F.current() ?? new F(a, 0)); p; p = Object.getPrototypeOf(p)) chain.push(p.constructor.name);
      out.chain = chain;
      out.timer = Object.getOwnPropertySymbols(setTimeout(() => {}, 1)).map(String).includes('Symbol(kAsyncContextFrame)');
      console.log(JSON.stringify(out));`;
    const out = JSON.parse(execFileSync(process.execPath, ['--expose-internals', '-e', code], { encoding: 'utf8' }));
    expect(out).toMatchObject({ tag: '[object Map]', size: 2, values: [1, 2], newFrame: true, outerKept: 1, timer: true });
    expect(out.chain).toContain('SafeMap');
  });

  it('флаги Node 24: --no-async-context-frame есть, экспериментального уже нет', () => {
    expect(process.versions.node.split('.')[0]).toBe('24');
    expect(execFileSync(process.execPath, ['--no-async-context-frame', '-e', 'console.log(1)'], { encoding: 'utf8' }).trim()).toBe('1');
    let err = '';
    try {
      execFileSync(process.execPath, ['--experimental-async-context-frame', '-e', '1'], { stdio: 'pipe' });
    } catch (e) {
      err = String((e as { stderr: Buffer }).stderr);
    }
    expect(err).toContain('bad option');
  });

  it('defaultValue и name — опции конструктора Node 24', () => {
    // @types/node проекта ещё не знает опций Node 24 — конструктор берём без типов.
    const Als = AsyncLocalStorage as unknown as new (o: { defaultValue: string; name: string }) => AsyncLocalStorage<string>;
    const als = new Als({ defaultValue: '—', name: 'requestId' });
    expect(als.getStore()).toBe('—');
    expect((als as unknown as { name: string }).name).toBe('requestId');
    expect(typeof (AsyncLocalStorage.prototype as unknown as { withScope?: unknown }).withScope).toBe('undefined');
  });
});

describe('OpenTelemetry и Vue', () => {
  it('OTEL_RESULT: без менеджера контекст пуст, с менеджером на ALS — доживает до конца await', async () => {
    const run = new AsyncFunction('context', 'createContextKey', 'ROOT_CONTEXT', 'AsyncLocalStorage', t.OTEL_CODE);
    try {
      expect(await run(context, createContextKey, ROOT_CONTEXT, AsyncLocalStorage)).toEqual(t.OTEL_RESULT);
    } finally {
      context.disable();
    }
  });

  it('VUE_OUT_CODE — вывод compileScript', () => {
    const { descriptor } = parse(t.VUE_SRC_CODE, { filename: 'Profile.vue' });
    const out = compileScript(descriptor, { id: 'profile' }).content;
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(out)).toContain(norm(t.VUE_OUT_CODE));
    expect(out).toContain("import { withAsyncContext as _withAsyncContext } from 'vue'");
  });
});

describe('утверждения текста', () => {
  it('в Node нет глобального AsyncContext', () => {
    expect(typeof (globalThis as { AsyncContext?: unknown }).AsyncContext).toBe('undefined');
  });

  it('шаги гонки и демо ссылаются на настоящие строки журнала', () => {
    expect(t.SERVER_GLOBAL_LOG.split('\n').at(-1)).toBe('[r-2] /cart база ответила');
    expect(t.SERVER_ALS_LOG.split('\n').at(-1)).toBe('[r-1] /cart база ответила');
    expect(t.AWAIT_NOTE).toContain(`**${t.THEN_CALLS.await}**`);
    expect(t.AWAIT_NOTE).toContain(`**${t.THEN_CALLS.all2}**`);
  });
});
