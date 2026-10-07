import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BENCH_LIES,
  FIELD_REP_SCENE_CODE,
  IC_STEPS,
  MYTHS,
  PIPELINE,
  PIPELINE_CODE,
  STILL_TRUE,
} from '@/content/lessons/v8-engine/data';

/**
 * «Движок V8» — то, что видно трассировками движка, а не таймером.
 *
 * Отдельным файлом, а не в `v8-engine.test.ts`: тот замерный и под нагрузкой мигает, а здесь
 * ни одного замера времени — только строки, которые печатает V8, и они от нагрузки не зависят.
 *
 * Примеры исполняются **строками из `data.ts`** — теми самыми, что видит читатель. Копия
 * в тесте проверяла бы саму себя.
 */

/** Запустить код отдельным процессом Node с флагами V8 и вернуть stdout + stderr. */
function run(flags: string[], code: string): string {
  return execFileSync(process.execPath, [...flags, '-e', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

const MDX = readFileSync(
  new URL('../../src/content/lessons/v8-engine/index.mdx', import.meta.url),
  'utf8',
);

describe('конвейер ярусов: пример `get` проходит тот путь, что показывает демо', () => {
  /**
   * `--no-concurrent-recompilation` делает компиляцию синхронной: без него под нагрузкой
   * TurboFan мог бы не успеть до объекта `{ y, x }`, и откат пришёлся бы на код Maglev.
   * Путь функции от этого не меняется — меняется только то, успеет ли фоновый поток.
   */
  const trace = run(['--trace-opt', '--trace-deopt', '--no-concurrent-recompilation'], PIPELINE_CODE);
  const lines = trace.split('\n').filter((l) => l.includes('<JSFunction get '));
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));

  it('Maglev, затем TurboFan, затем один откат `wrong map` из кода TurboFan', () => {
    const maglev = at(/completed compiling .*target MAGLEV/);
    const turbofan = at(/completed compiling .*target TURBOFAN_JS/);
    const bailouts = lines.filter((l) => l.includes('bailout'));

    expect(maglev, 'функция поднимается в Maglev').toBeGreaterThanOrEqual(0);
    expect(turbofan, 'и после него — в TurboFan').toBeGreaterThan(maglev);
    expect(bailouts, 'откат ровно один: второй цикл с двумя формами не откатывает').toHaveLength(1);
    expect(bailouts[0]).toContain('kind: deopt-eager, reason: wrong map');
    expect(bailouts[0]).toContain('TURBOFAN_JS');
    expect(lines.indexOf(bailouts[0]), 'откат — после оптимизации').toBeGreaterThan(turbofan);
  });

  it('после отката функция снова разогревается и оптимизируется', () => {
    const bailout = at(/bailout/);
    const again = lines.slice(bailout + 1).some((l) => /marking .* for optimization to MAGLEV/.test(l));
    expect(again).toBe(true);
  });

  it('пример печатает сумму — код на странице исполняется целиком', () => {
    expect(trace).toMatch(/^1000001000002$/m);
  });

  it('демо цитирует те же строки трассы', () => {
    const log = PIPELINE.flatMap((s) => s.log).join('\n');
    expect(log).toContain('for optimization to MAGLEV, reason: hot and stable');
    expect(log).toContain('target TURBOFAN_JS');
    expect(log).toContain('kind: deopt-eager, reason: wrong map');
  });

  /**
   * Шаг про профиль цитирует байткод. ⚠️ До 2026-10-01 там стояло `GetNamedProperty a0, [0], [0]`
   * и «второй ноль — номер ячейки»: у `o.x + 1` ячейка чтения первая, нулевая — у сложения.
   * Node 26.8 печатает тот же операнд как `FBV[1]`, Node 24.11 — как `[1]`.
   */
  it('`o.x` в байткоде `get` — `GetNamedProperty a0, [0], [1]`, как пишет шаг демо', () => {
    const bytecode = run(['--print-bytecode', '--print-bytecode-filter=get'], PIPELINE_CODE);
    expect(bytecode).toMatch(/GetNamedProperty a0, \[0[^\]]*\], (?:FBV)?\[1\]/);
    expect(PIPELINE.map((s) => s.message).join('\n')).toContain('`GetNamedProperty a0, [0], [1]`');
  });
});

describe('представление поля: Smi → Double → Tagged', () => {
  const out = run(
    ['--allow-natives-syntax', '--trace-generalization'],
    `${FIELD_REP_SCENE_CODE}\na.x;\nconsole.log('SAME', %HaveSameMap(a, b), %HaveSameMap(b, c));`,
  );
  const gen = out.split('\n').filter((l) => l.startsWith('[generalizing]x:'));

  it('`new P(1.5)` расширяет поле до Double, `new P(\'1\')` — до Tagged', () => {
    expect(gen.some((l) => /x:s\{.*\}->d\{/.test(l)), 'Smi → Double').toBe(true);
    expect(gen.some((l) => /x:d\{.*\}->t\{/.test(l)), 'Double → Tagged').toBe(true);
  });

  it('форма остаётся одна: после обращения `a` переезжает на форму `b` и `c`', () => {
    expect(out).toMatch(/^SAME true true$/m);
  });

  it('тема называет флаг и буквы, которые он печатает', () => {
    expect(MDX).toContain('`x:s{…}->d{…}`');
    expect(MDX).toContain('`x:d{…}->t{…}`');
  });
});

describe('флаги, которые тема советует, существуют в этой сборке Node', () => {
  /**
   * ⚠️ Тема советовала `--trace-ic`, а релизный Node на него отвечает «bad option» — флаг есть
   * только в отладочных сборках V8. Заменён на `--log-ic`. Сторож обходит все флаги из текста
   * темы, чтобы совет не устарел молча.
   */
  const v8options = execFileSync(process.execPath, ['--v8-options'], { encoding: 'utf8' });
  const text = MDX + IC_STEPS.map((s) => s.what).join('\n');
  const flags = [...new Set(text.match(/--[a-z][a-z-]+(?:=\S+)?/g) ?? [])];

  it('флагов в тексте много — обход не пустой', () => {
    expect(flags.length).toBeGreaterThan(8);
  });

  for (const flag of flags) {
    const name = flag.replace(/=.*/, '').replace(/^--no-/, '--');
    it(`${flag}`, () => {
      expect(v8options, `V8 не знает флага ${flag}`).toMatch(
        new RegExp(`^\\s+${name.replace(/-/g, '\\-')}( |$)`, 'm'),
      );
    });
  }

  it('`--log-ic` пишет переходы площадки: 0 → 1 → P → N', () => {
    const dir = execFileSync('mktemp', ['-d'], { encoding: 'utf8' }).trim();
    const log = `${dir}/ic.log`;
    run(
      ['--log-ic', `--logfile=${log}`, '--no-logfile-per-isolate'],
      `function getV(o) { return o.v; }
       const objs = [{ v: 1 }, { id: 7, v: 3 }, { a: 1, v: 1 }, { b: 1, v: 1 }, { c: 1, v: 1 }];
       for (let i = 0; i < 20; i++) getV(objs[0]);
       for (const o of objs) getV(o);`,
    );
    const states = readFileSync(log, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('LoadIC,') && l.split(',')[8] === 'v')
      .map((l) => l.split(',').slice(5, 7).join('→'));
    expect(states[0]).toBe('0→1');
    expect(states).toContain('1→P');
    expect(states.at(-1)).toBe('P→N');
    expect(IC_STEPS.map((s) => s.what).join('\n')).toContain('`N` мегаморфная');
  });
});

describe('защитные ячейки: что гасит их, а что нет', () => {
  const invalidated = (code: string) =>
    run(['--trace-protector-invalidation'], code)
      .split('\n')
      .filter((l) => l.startsWith('Invalidating protector cell'));

  it('свойство с именем на `Array.prototype` ни одной ячейки не гасит', () => {
    expect(invalidated('Array.prototype.foo = 1;')).toEqual([]);
  });

  it('элемент на `Array.prototype` гасит `NoElements` — и навсегда', () => {
    const lines = invalidated(
      'Array.prototype[1] = 1; delete Array.prototype[1]; Array.prototype[2] = 1;',
    );
    expect(lines, 'второе изменение уже нечего гасить: ячейка не взводится заново').toEqual([
      'Invalidating protector cell NoElements',
    ]);
  });

  it('подмена `Symbol.iterator` у массивов гасит свою ячейку', () => {
    expect(
      invalidated('Array.prototype[Symbol.iterator] = function* () {};').join('\n'),
    ).toContain('ArrayIterator');
  });

  it('тема говорит это же, а не «`Array.prototype.foo` бьёт по всей программе»', () => {
    const claim = STILL_TRUE.find((s) => s.includes('защитные ячейки'));
    expect(claim).toBeDefined();
    expect(claim).toContain('`Array.prototype.foo = 1`, ни одной ячейки не гасит');
  });
});

describe('мифы: имена байткода и таймер', () => {
  /** ⚠️ Тема называла `ForInContinue` — такой инструкции нет ни на Node 24.11, ни на 26.8. */
  it('инструкции `for...in`, названные в мифе, есть в байткоде', () => {
    const bytecode = run(
      ['--print-bytecode', '--print-bytecode-filter=keys'],
      'function keys(o) { let n = 0; for (const k in o) n++; return n; } keys({ a: 1 });',
    );
    const myth = MYTHS.find((m) => m.myth.includes('for...in'));
    const named = myth?.now.match(/ForIn[A-Za-z]+/g) ?? [];
    expect(named.length).toBeGreaterThan(2);
    for (const op of named) expect(bytecode, `инструкции ${op} нет`).toContain(op);
  });

  it('пункт «Разрешение таймера» подписан движками и версиями, а не «десятки–сотни мкс»', () => {
    const timer = BENCH_LIES.find((p) => p.t === 'Разрешение таймера');
    expect(timer?.d).toContain('Chromium 153');
    expect(timer?.d).toContain('Firefox 155');
  });
});
