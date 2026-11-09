import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/generators/data';
import { loadSpawn, runNative } from '@/widgets/spawn-lab/model/run';

/**
 * Тема «Генераторы и асинхронные итераторы».
 *
 * Код примеров — строки из `data.ts`: те же, что печатает страница. Здесь они исполняются,
 * а литералы выводов сверяются с тем, что движок печатает сейчас.
 *
 * Учебная `spawn` проверяется против настоящего `async/await`: на каждом сценарии вывод
 * `async`-версии, версии через `spawn` и `__awaiter` из TypeScript обязан совпасть построчно.
 */

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

/** Исполнить строку примера как тело async-функции и вернуть перечисленные имена. */
function runSnippet(code: string, names: string[], params: Record<string, unknown> = {}) {
  const fn = new AsyncFunction(...Object.keys(params), `${code}\nreturn { ${names.join(', ')} };`);
  return fn(...Object.values(params)) as Promise<Record<string, unknown>>;
}

describe('раздел «Пауза генератора»', () => {
  it('генератор берёт результат yield из next(x), а не из промиса', async () => {
    const out: string[] = [];
    const r = await runSnippet(`${t.HELPERS_CODE}\n${t.STEPS_CODE}`, ['r1', 'r2', 'r3'], { log: (s: string) => out.push(s) });
    expect(out).toEqual(['старт 1', 'пользователь Боб']);
    expect((r.r1 as IteratorResult<unknown>).value).toBeInstanceOf(Promise);
    expect((r.r1 as IteratorResult<unknown>).done).toBe(false);
    expect((r.r2 as IteratorResult<unknown>).done).toBe(false);
    expect(r.r3).toEqual({ value: 3, done: true });
  });

  it('TS_ES5_CODE — дословный вывод TypeScript для ES5, и он ведёт себя как генератор', async () => {
    const genSource = t.STEPS_CODE.slice(0, t.STEPS_CODE.indexOf('\n\n'));
    const full = ts.transpileModule(genSource, { compilerOptions: { target: ts.ScriptTarget.ES5 } }).outputText;
    expect(full.slice(full.indexOf('function loadSteps')).trimEnd()).toBe(t.TS_ES5_CODE);
    expect(ts.version).toBe('6.0.3');

    // Тот же сценарий ручного управления на выводе для ES5: результаты совпадают.
    const driver = t.STEPS_CODE.slice(t.STEPS_CODE.indexOf('\n\n'));
    const out: string[] = [];
    const r = await runSnippet(`${t.HELPERS_CODE}\n${full}\n${driver}`, ['r1', 'r3'], { log: (s: string) => out.push(s) });
    expect(out).toEqual(['старт 1', 'пользователь Боб']);
    expect(r.r3).toEqual({ value: 3, done: true });
  });

  it('EDGE_CODE: return() останавливается на yield в finally, throw() до старта не заходит в try', async () => {
    const r = await runSnippet(t.EDGE_CODE, ['r1', 'r2', 'r3', 'caught', 'log']);
    expect(r.r1).toEqual({ value: 1, done: false });
    expect(r.r2).toEqual({ value: 'ещё не всё', done: false });
    expect(r.r3).toEqual({ value: 'стоп', done: true });
    expect(r.caught).toBe('рано');
    expect(r.log).toEqual(['работаю', 'уборка', 'уборка закончена']);
  });

  it('REENTRY_CODE: next() изнутри — TypeError', async () => {
    await expect(runSnippet(t.REENTRY_CODE, [])).rejects.toThrow(TypeError);
    await expect(runSnippet(t.REENTRY_CODE, [])).rejects.toThrow('Generator is already running');
  });
});

describe('раздел «async/await из генератора»: spawn против настоящего async/await', () => {
  it.each(t.SCENARIOS)('$label: async, spawn и литерал совпадают', async (sc) => {
    const native = await runNative(t.FIXTURE, sc.asyncCode);
    const viaSpawn = await runNative(t.FIXTURE, sc.genCode);
    expect(native).toEqual(t.SCENARIO_LOGS[sc.id]);
    expect(viaSpawn).toEqual(native);
  });

  it.each(t.SCENARIOS)('$label: __awaiter из TypeScript (ES2016) печатает то же', async (sc) => {
    const out = ts.transpileModule(sc.asyncCode, { compilerOptions: { target: ts.ScriptTarget.ES2016 } }).outputText;
    expect(out).toContain('__awaiter');
    expect(await runNative(t.FIXTURE, out.replace(/^"use strict";\n/, ''))).toEqual(t.SCENARIO_LOGS[sc.id]);
  });

  it('spawn исполняется в браузерном виде так же, как в Node: функция собирается из строки', () => {
    expect(typeof loadSpawn(t.SPAWN_CODE)).toBe('function');
  });
});

describe('раздел «Асинхронные итераторы»', () => {
  it('PAGER_CODE: ручной итератор и генератор дают три страницы', async () => {
    const r = await runSnippet(t.PAGER_CODE, ['viaObject', 'viaGen']);
    expect(r.viaObject).toEqual(['стр 1', 'стр 2', 'стр 3']);
    expect(r.viaGen).toEqual(['стр 1', 'стр 2', 'стр 3']);
  });

  it('YIELD_AWAIT_CODE: yield ждёт значение, отказ ловит try внутри', async () => {
    const r = await runSnippet(t.YIELD_AWAIT_CODE, ['got']);
    expect(r.got).toEqual([1, 'поймал: плохое значение']);
  });

  it('таблица протокола: метки и форма next()', async () => {
    async function* ag() {
      yield 1;
    }
    function* sg() {
      yield 1;
    }
    expect(Object.prototype.toString.call(sg())).toBe('[object Generator]');
    expect(Object.prototype.toString.call(ag())).toBe('[object AsyncGenerator]');
    const it = ag();
    expect(it.next()).toBeInstanceOf(Promise);
    expect((it as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
    expect(t.PROTOCOL_ROWS.some((r) => r.async.includes('[object AsyncGenerator]'))).toBe(true);
  });
});

describe('раздел «Очередь next()»', () => {
  it('QUEUE_CODE: ручной итератор трижды берёт первую страницу, генератор — по очереди', async () => {
    const r = await runSnippet(`${t.PAGER_CODE}\n${t.QUEUE_CODE}`, ['fromObject', 'fromGen', 'log']);
    expect((r.fromObject as IteratorResult<string>[]).map((x) => x.value)).toEqual(['стр 1', 'стр 1', 'стр 1']);
    expect((r.fromGen as IteratorResult<string>[]).map((x) => x.value)).toEqual(['стр 1', 'стр 2', 'стр 3']);
    expect(r.log).toEqual(t.QUEUE_GEN_LOG);
  });

  it('QUEUE_OBJECT_LOG — вывод ручного итератора', async () => {
    const code = t.QUEUE_CODE.slice(0, t.QUEUE_CODE.indexOf('\n\nlog.length = 0;'));
    const r = await runSnippet(`${t.PAGER_CODE}\n${code}`, ['log']);
    expect(r.log).toEqual(t.QUEUE_OBJECT_LOG);
  });
});

describe('раздел «Ранний выход»', () => {
  it('BREAK_CODE: цикл ждёт асинхронный finally', async () => {
    expect((await runSnippet(t.BREAK_CODE, ['log'])).log).toEqual(t.BREAK_LOG);
  });

  it('RACE_CODE: return() ждёт, пока генератор дойдёт до yield', async () => {
    expect((await runSnippet(t.RACE_CODE, ['log'])).log).toEqual(t.RACE_LOG);
  });

  it('ABORT_CODE: сигнал прерывает await, finally — сразу', async () => {
    expect((await runSnippet(t.ABORT_CODE, ['log'])).log).toEqual(t.ABORT_LOG);
  });

  it('RACE_NOTE и ABORT_NOTE называют те же 30 мс, что код', () => {
    expect(t.RACE_CODE).toContain('sleep(30');
    expect(t.ABORT_CODE).toContain("ok('ответ'), 30)");
    expect(t.ABORT_NOTE).toContain('30 мс');
  });

  it('FINALLY_LOST_CODE: ошибка тела перекрывает ошибку finally; при break finally вылетает', async () => {
    expect((await runSnippet(t.FINALLY_LOST_CODE, ['caught'])).caught).toBe('из тела');
    const withBreak = t.FINALLY_LOST_CODE.replace("throw new Error('из тела')", 'break');
    expect((await runSnippet(withBreak, ['caught'])).caught).toBe('из finally');
  });
});

describe('числа и ссылки текста', () => {
  it('PREREQ «Промис и then»: у выполненного промиса then ставит реакцию сразу', async () => {
    const log: string[] = [];
    Promise.resolve(1).then(() => log.push('реакция выполненного'));
    Promise.resolve().then(() => log.push('следующая'));
    await null;
    await null;
    expect(log).toEqual(['реакция выполненного', 'следующая']);
    const card = t.PREREQ.find((p) => p.t === 'Промис и `then`')!;
    expect(card.d).not.toContain('не ставит ничего в очередь сразу');
    expect(card.d).toContain('у уже выполненного — сразу');
  });

  it('PROTOCOL_ROWS «кто обходит»: асинхронный итератор обходит не только for await — есть Array.fromAsync', async () => {
    async function* ag() {
      yield 1;
      yield 2;
    }
    expect(await Array.fromAsync(ag())).toEqual([1, 2]);
    const row = t.PROTOCOL_ROWS.find((r) => r.k === 'кто обходит')!;
    expect(row.async).not.toContain('только');
    expect(row.async).toContain('Array.fromAsync');
  });

  it('в сценариях столько же строк линейки, сколько в DRIVER_CODE', () => {
    for (const log of Object.values(t.SCENARIO_LOGS)) {
      expect(log.filter((l) => l.startsWith('тик '))).toEqual(['тик 1', 'тик 2', 'тик 3']);
    }
  });

  it('SPAWN_WHY: TypeScript ниже ES2017 пишет __awaiter, с ES2017 — нет; у Babel _asyncToGenerator', async () => {
    const ts = (await import('typescript')).default;
    const out = (target: number) =>
      ts.transpileModule('async function f() { await 1; }', { compilerOptions: { target } }).outputText;
    expect(out(ts.ScriptTarget.ES2015)).toContain('__awaiter');
    expect(out(ts.ScriptTarget.ES2016)).toContain('__awaiter');
    expect(out(ts.ScriptTarget.ES2017)).not.toContain('__awaiter');
    const babel = await import('@babel/core');
    const code = babel.transformSync('async function f() { await 1; }', {
      plugins: ['@babel/plugin-transform-async-to-generator'],
      configFile: false,
      babelrc: false,
    })?.code;
    expect(code).toContain('_asyncToGenerator');
    // Короткие подстроки — имена, которые называет текст.
    expect(t.SPAWN_WHY).toContain('ES2015 или ES2016');
    expect(t.SPAWN_WHY).toContain('`_asyncToGenerator`');
  });

  it('«пара десятков строк» spawn — правда', () => {
    const n = t.SPAWN_CODE.split('\n').filter((l) => l.trim()).length;
    expect(n).toBeGreaterThanOrEqual(20);
    expect(n).toBeLessThan(30);
  });

});
