import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/regex/data';
import { growth, loadEngine } from '@/widgets/regex-lab/model/run';

/**
 * Тема «Регулярные выражения изнутри: откаты и ReDoS».
 *
 * `PARSE_CODE` + `MATCH_CODE` — учебный движок, напечатанный на странице и исполняемый демо.
 * Здесь он сверяется с `RegExp` V8 (совпало или нет, индекс, все группы) на ручном наборе
 * и на тысячах случайных шаблонов. Числа шагов из текста пересчитываются тем же движком.
 *
 * Настоящий V8 проверяется **порогом**, а не секундомером: шаблон исполняется в отдельном
 * процессе `node` с ограничением времени. Плохой шаблон на длине 40 — это около 3·10¹² шагов,
 * часы работы; исправленный на длине 100 000 — сотни тысяч шагов. Между ними двенадцать
 * порядков, и лимит в 8 секунд не мигает под нагрузкой.
 */

const engine = loadEngine(t.PARSE_CODE, t.MATCH_CODE);
const LIMIT_MS = 8000;

/** Ответ V8 в том же виде, что у учебного движка. */
function v8(pattern: string, input: string) {
  const m = new RegExp(pattern).exec(input);
  return m ? { index: m.index, groups: [...m] } : null;
}

/** Исполнить код примера и собрать `console.log`; вернуть пары «напечатано — обещано в комментарии». */
async function runLogged(code: string, args: Record<string, unknown> = {}) {
  const out: string[] = [];
  const fakeConsole = { log: (v: unknown) => out.push(JSON.stringify(v)) };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('console', ...Object.keys(args), code)(fakeConsole, ...Object.values(args));
  const promised = [...code.matchAll(/console\.log\(.*\/\/ → (.*)$/gm)].map((m) => m[1].trim());
  return { out, promised };
}

/** Запуск выражения в отдельном процессе с лимитом времени: `done` — уложился ли. */
function runLimited(flags: string[], expr: string, ms = LIMIT_MS): Promise<{ done: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...flags, '-e', `console.log(JSON.stringify(${expr}))`]);
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), ms);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ done: signal === null && code === 0, out: out.trim(), err });
    });
  });
}

describe('учебный движок против RegExp V8', () => {
  const HAND: [string, string][] = [
    ['a+b', 'xaab'],
    ['(a|ab)c', 'abc'],
    ['(a|ab)(c|bcd)(d*)', 'abcd'],
    ['a|ab', 'ab'],
    ['^(a+)+$', 'aaaa!'],
    ['^(a+)+$', 'aaaa'],
    ['(a*)*b', 'aab'],
    ['(a*?)x', 'aax'],
    ['(?=(a+))\\1b', 'aaab'],
    ['^(?:(?=(a+))\\1)+$', 'aaaa'],
    ['(\\w+)\\s(\\w+)', 'hi you'],
    ['[^a-c]+', 'abxyz'],
    ['(z)((a+)?(b+)?(c))*', 'zaacbbbcac'],
    ['(a)|b', 'b'],
    ['(?!a)\\w', 'ab'],
    ['\\bfoo\\b', 'a foo.'],
    ['\\d{2,3}', '1 12345'],
    ['<.+>', '<b>жирный</b> и <i>курсив</i>'],
    ['<.+?>', '<b>жирный</b>'],
    ['<[^>]+>', '<b>жирный</b>'],
    ['^(\\w+\\s?)*$', 'two words'],
    ['^(?:\\w+\\s)*\\w*$', 'two words'],
    ['.', '\n'],
    ['\\s+$', '  x   '],
    ['((a)|b)+', 'ab'],
    ['(a?)+?b', 'aab'],
    ['(?:a|())*b', 'aab'],
  ];

  it.each(HAND)('%s на %j', (pattern, input) => {
    expect(engine.match(pattern, input).match).toEqual(v8(pattern, input));
  });

  it('тысячи случайных шаблонов и строк — ни одного расхождения', () => {
    let seed = 20261001;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const ATOMS = ['a', 'b', 'c', ' ', '.', '[ab]', '[^a]', '[a-c]', '\\w', '\\d', '\\s', '\\W', 'x', '1', '\\.'];
    const QUANT = ['', '', '*', '+', '?', '*?', '+?', '??', '{2}', '{1,3}', '{0,}'];
    const g = { n: 0 };
    const gen = (d: number): string => {
      const r = rnd(10);
      if (d > 2 || r < 5) return ATOMS[rnd(ATOMS.length)];
      if (r < 6) return (g.n++, `(${alt(d + 1)})`);
      if (r < 7) return `(?:${alt(d + 1)})`;
      if (r < 8) return `(?${rnd(2) ? '=' : '!'}${alt(d + 1)})`;
      if (r < 9 && g.n > 0) return `(?:\\${1 + rnd(Math.min(9, g.n))})`;
      return ['^', '$', '\\b'][rnd(3)];
    };
    const term = (d: number) => {
      const a = gen(d);
      return /^(\^|\$|\\b|\(\?[=!])/.test(a) ? a : a + QUANT[rnd(QUANT.length)];
    };
    const seq = (d: number) => Array.from({ length: 1 + rnd(3) }, () => term(d)).join('');
    const alt = (d: number): string => seq(d) + (rnd(4) === 0 ? `|${seq(d)}` : '');

    const STR = 'ab c1x.';
    let compared = 0;
    for (let p = 0; p < 2000; p++) {
      g.n = 0;
      const pattern = alt(0);
      new RegExp(pattern); // шаблон обязан быть верным и для V8
      for (let k = 0; k < 15; k++) {
        const input = Array.from({ length: rnd(9) }, () => STR[rnd(STR.length)]).join('');
        const r = engine.match(pattern, input, { limit: 1e6 });
        if (r.stopped) continue;
        expect(r.match, `${pattern} на ${JSON.stringify(input)}`).toEqual(v8(pattern, input));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(29_000);
  });

  it('то, чего движок не знает, — SyntaxError, а не тихий другой ответ', () => {
    expect(() => engine.parse('\\B')).toThrow(SyntaxError);
    expect(() => engine.parse('(a')).toThrow(SyntaxError);
    expect(() => engine.parse('a)')).toThrow(SyntaxError);
  });

  it('лимит шагов останавливает перебор', () => {
    const r = engine.match('^(a+)+$', 'a'.repeat(30) + '!', { limit: 10_000 });
    expect(r.stopped).toBe(true);
    expect(r.match).toBeNull();
  });
});

describe('числа шагов в тексте', () => {
  const steps = (p: string, s: string) => engine.match(p, s).steps;
  const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
  const word = (n: number) => 'a'.repeat(n) + '!';

  it('(a+)+ — ровно 3·2ⁿ + n, a+ — 3n + 3, атомарный — 2n + 6', () => {
    for (let n = 1; n <= 18; n++) {
      expect(steps('^(a+)+$', word(n))).toBe(3 * 2 ** n + n);
      expect(steps('^a+$', word(n))).toBe(3 * n + 3);
      expect(steps('^(?:(?=(a+))\\1)+$', word(n))).toBe(2 * n + 6);
    }
    expect(t.STEPS_NOTE).toContain('3·2ⁿ + n');
    expect(t.STEPS_NOTE).toContain('3n + 3');
  });

  it('таблица шагов совпадает с движком', () => {
    for (const row of t.STEPS_ROWS) {
      const n = Number(row.n);
      expect(row.bad).toBe(fmt(steps('^(a+)+$', word(n))));
      expect(row.fixed).toBe(fmt(steps('^a+$', word(n))));
    }
  });

  it('ленивый повтор делает столько же шагов, сколько жадный', () => {
    const lazy = steps('^(a+?)+$', word(20));
    expect(lazy).toBe(steps('^(a+)+$', word(20)));
    expect(t.GREEDY_NOTE).toContain(`${fmt(lazy)} шагов`);
  });

  it('жадный, ленивый и класс на строке с тегами', () => {
    const html = '<b>жирный</b> и <i>курсив</i>';
    const pats = ['<.+>', '<.+?>', '<[^>]+>'];
    t.GREEDY_ROWS.forEach((row, i) => {
      const r = engine.match(pats[i], html);
      expect(row.p).toBe(`\`${pats[i]}\``);
      expect(row.steps).toBe(String(r.steps));
      expect(row.back).toBe(String(r.backtracks));
    });
  });

  it('квадратичный \\s+$: n² + 2n + 2', () => {
    for (const n of [10, 100, 200]) expect(steps('\\s+$', ' '.repeat(n) + 'x')).toBe(n * n + 2 * n + 2);
    expect(t.POLY_NOTE).toContain(`${fmt(10_202)} на сотне`);
    expect(t.POLY_NOTE).toContain(`${fmt(40_402)} на двухстах`);
  });

  it('семейства из таблицы: экспонента удваивается, полином — нет', () => {
    const ratio = (p: string, unit: string, n: number) => steps(p, unit.repeat(2 * n) + '!') / steps(p, unit.repeat(n) + '!');
    for (const p of ['^(a|a)*$', '^(\\w+\\s?)*$']) expect(steps(p, word(16)) / steps(p, word(15))).toBeGreaterThan(1.9);
    expect(steps('^(\\d|\\w)+$', '1'.repeat(16) + '!') / steps('^(\\d|\\w)+$', '1'.repeat(15) + '!')).toBeGreaterThan(1.9);
    const poly = ratio('\\d+\\d+$', '1', 40);
    expect(poly).toBeGreaterThan(3);
    expect(poly).toBeLessThan(9);
  });

  it('разрезаний строки из n букв — 2ⁿ⁻¹; для aaaa перечислены все восемь', () => {
    const cuts = [...t.SPLITS_NOTE.matchAll(/`(a[a|]*)`/g)].map((m) => m[1]).filter((s) => s.replaceAll('|', '') === 'aaaa');
    expect(new Set(cuts).size).toBe(2 ** 3);
  });

  it('графики: плохие шаблоны удваиваются, исправленные растут линейно', () => {
    for (const set of t.GROWTH_SETS) {
      const lines = growth(engine, set, [10, 11, 12, 13]);
      set.series.forEach((s, i) => {
        const [a, b, , d] = lines[i].map((p) => p.steps);
        if (s.bad) expect(b / a).toBeGreaterThan(1.9);
        else expect(d - a).toBeLessThan(30);
      });
    }
  });

  it('исправленные шаблоны находят те же строки, что и плохие', () => {
    const all = (alphabet: string, max: number) => {
      const out = [''];
      for (let len = 1; len <= max; len++) {
        for (const prev of out.filter((s) => s.length === len - 1)) for (const c of alphabet) out.push(prev + c);
      }
      return out;
    };
    for (const set of t.GROWTH_SETS) {
      const [bad, ...fixed] = set.series.map((s) => new RegExp(s.pattern));
      for (const s of all('a !', 8)) for (const f of fixed) expect(f.test(s), `${f} на ${JSON.stringify(s)}`).toBe(bad.test(s));
    }
    // строки таблицы исправлений
    const pairs: [string, string][] = [['^(a+)+$', '^a+$'], ['^(\\w+\\s?)*$', '^(?:\\w+\\s)*\\w*$'], ['^(a|a)*$', '^a*$']];
    for (const [bad, fixed] of pairs) {
      expect(t.FIX_ROWS.some((r) => r.bad === `\`${bad}\`` && r.fixed === `\`${fixed}\``)).toBe(true);
      for (const s of all('a !', 8)) expect(new RegExp(fixed).test(s)).toBe(new RegExp(bad).test(s));
    }
    expect(t.FIX_NOTE).toContain('до восьми знаков');
  });

  it('примеры журнала: учебный ответ совпадает с V8', () => {
    for (const ex of t.TRACE_EXAMPLES) {
      expect(engine.match(ex.pattern, ex.input).match, ex.id).toEqual(v8(ex.pattern, ex.input));
    }
    expect(engine.match('(a|ab)c', 'abc').match?.groups).toEqual(['abc', 'ab']);
    expect(engine.match('<.+?>', '<b>жирный</b>').steps).toBe(3);
  });

  it('правила из текста: группы обнуляются перед повтором, пустой повтор не считается', () => {
    expect(engine.match('((a)|b)+', 'ab').match?.groups).toEqual(['ab', 'b', undefined]);
    expect(v8('((a)|b)+', 'ab')?.groups).toEqual(['ab', 'b', undefined]);
    expect(engine.match('(a*)*', 'b').match?.groups).toEqual(['', undefined]);
    expect(v8('(a*)*', 'b')?.groups).toEqual(['', undefined]);
  });
});

describe('примеры кода печатают то, что обещают комментарии', () => {
  it.each([
    ['GREEDY_CODE', t.GREEDY_CODE],
    ['ESCAPE_CODE', t.ESCAPE_CODE],
    ['ATOMIC_CODE', t.ATOMIC_CODE],
    ['LASTINDEX_CODE', t.LASTINDEX_CODE],
    ['STICKY_CODE', t.STICKY_CODE],
    ['UNICODE_CODE', t.UNICODE_CODE],
    ['NAMED_CODE', t.NAMED_CODE],
  ])('%s', async (_name, code) => {
    const { out, promised } = await runLogged(code);
    expect(promised.length).toBeGreaterThan(0);
    expect(out).toEqual(promised);
  });

  it('a|ab на «ab» — первый вариант, а не длинный', () => {
    expect(/a|ab/.exec('ab')?.[0]).toBe('a');
  });

  it('таблица флагов: u и v вместе нельзя, d даёт индексы, s и m', () => {
    const both = 'uv'; // флаги строкой: литерал с обоими не пропустит и линтер
    expect(() => new RegExp('a', both)).toThrow(SyntaxError);
    expect(/(b)/d.exec('ab')?.indices?.[1]).toEqual([1, 2]);
    expect(/./.test('\n')).toBe(false);
    expect(/./s.test('\n')).toBe(true);
    expect(/a$/.test('a\nb')).toBe(false);
    expect(/a$/m.test('a\nb')).toBe(true);
  });
});

describe('настоящий V8: порог в отдельном процессе', () => {
  it(
    'строки таблицы линейного движка',
    async () => {
      const results = await Promise.all(t.LINEAR_ROWS.map((row) => runLimited(row.flags, row.code)));
      t.LINEAR_ROWS.forEach((row, i) => {
        expect(results[i].done, `${row.code} ${row.flags.join(' ')}: ${results[i].err}`).toBe(row.ok);
        if (row.ok) {
          const shown = row.verdict.match(/`(.*)`/)?.[1];
          expect(results[i].out).toBe(JSON.stringify(JSON.parse(shown ?? 'null')));
        }
      });
      expect(t.STEPS_NOTE).toContain('за восемь секунд');
      expect(LIMIT_MS).toBe(8000);
    },
    60_000,
  );

  it('что принимает флаг l', () => {
    const code = `console.log(JSON.stringify(${JSON.stringify(t.LINEAR_SYNTAX_ROWS)}.map((r) => {
      try { new RegExp(r.src, r.flags); return true; } catch (e) { return e.message.includes('linear time') ? false : e.message; }
    })))`;
    const r = spawnSync(process.execPath, ['--enable-experimental-regexp-engine', '-e', code], { encoding: 'utf8' });
    expect(JSON.parse(r.stdout)).toEqual(t.LINEAR_SYNTAX_ROWS.map((row) => row.accepted));
    // без флага движка буква l — просто неизвестный флаг
    const plain = spawnSync(process.execPath, ['-e', "try { new RegExp('a', 'l') } catch (e) { console.log(e.message) }"], { encoding: 'utf8' });
    expect(plain.stdout).toContain('Invalid flags');
    // просмотр назад линейный движок находит так же, как обычный
    const lb = spawnSync(process.execPath, ['--enable-experimental-regexp-engine', '-e', "console.log(/(?<=\\$)\\d+/l.exec('цена $42')[0])"], { encoding: 'utf8' });
    expect(lb.stdout.trim()).toBe('42');
  });

  it('флаги линейного движка и порог подмены есть в этой сборке', () => {
    const opts = spawnSync(process.execPath, ['--v8-options'], { encoding: 'utf8' }).stdout;
    expect(opts).toContain('--enable-experimental-regexp-engine-on-excessive-backtracks');
    expect(opts).toContain('default: --regexp-backtracks-before-fallback=50000');
    expect(opts).toContain('default: --no-enable-experimental-regexp-engine');
    expect(opts).toMatch(/--regexp-possessive-quantifier \(enable possessive quantifier syntax for testing\)/);
    expect(t.LINEAR_FACTS[0].d).toContain('50 000');
  });

  it('ярусы Irregexp: байткод после первого вызова, машинный код со второго', () => {
    const trace = (k: number) =>
      spawnSync(process.execPath, ['--trace-regexp-tier-up', '-e', `const r = /^(a+)+$/; for (let i = 0; i < ${k}; i++) r.test('aaa!')`], {
        encoding: 'utf8',
      }).stdout;
    const one = trace(1);
    const two = trace(2);
    expect(one).toContain('bytecode size: 312');
    expect(one).not.toContain('needs tier-up compilation');
    expect(two).toContain('needs tier-up compilation');
    expect(two).toContain('native code size');
    expect(t.IRREGEXP_FACTS[1].d).toContain('312 байт');
  });

  it(
    'одна строка вешает сервер; исправленный шаблон — нет',
    async () => {
      const serve = async (code: string) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code]);
        const port = await new Promise<number>((resolve) => child.stdout.once('data', (d) => resolve(Number(String(d).trim()))));
        return { child, port };
      };

      const bad = await serve(t.SERVER_CODE);
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const err = await new AsyncFunction('port', t.ATTACK_CODE)(bad.port).catch((e: Error) => e);
      bad.child.kill('SIGKILL');
      expect((err as Error).name).toBe('TimeoutError');
      expect(t.ATTACK_CODE).toContain('AbortSignal.timeout(8000)');

      const good = await serve(t.SERVER_CODE.replace('/^(\\w+\\s?)*$/', '/^(?:\\w+\\s)*\\w*$/'));
      expect(t.SERVER_CODE).toContain('/^(\\w+\\s?)*$/');
      const evil = await fetch(`http://localhost:${good.port}/?name=${'a'.repeat(40)}!`, { signal: AbortSignal.timeout(LIMIT_MS) });
      const bob = await fetch(`http://localhost:${good.port}/?name=bob`, { signal: AbortSignal.timeout(LIMIT_MS) });
      expect(await evil.text()).toBe('bad name');
      expect(await bob.text()).toBe('ok');
      good.child.kill('SIGKILL');
    },
    60_000,
  );

  it(
    'Worker с плохим шаблоном убивается terminate(), главный поток свободен',
    async () => {
      const { Worker } = await import('node:worker_threads');
      const w = new Worker("require('node:worker_threads').parentPort.postMessage('start'); /^(a+)+$/.test('a'.repeat(40) + '!')", { eval: true });
      await new Promise((r) => w.once('message', r));
      const code = await w.terminate();
      expect(code).toBe(1);
    },
    30_000,
  );
});
