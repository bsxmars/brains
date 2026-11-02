import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * «Движок V8», раздел «Четыре яруса и петля обратно»: подразделы про WebAssembly и песочницу.
 *
 * Отдельным файлом, а не в `v8-engine.test.ts`: тот замерный и под нагрузкой мигает, а здесь
 * нет ни одного таймера — только ярус функции (`%IsLiftoffFunction`, `%IsTurboFanFunction`),
 * строка `--trace-deopt` и флаги сборки. Всё детерминировано.
 *
 * Зачем тест. Тема раньше утверждала «у Wasm деоптимизации нет вообще» — верно для Node 24
 * (V8 13.6: `--no-wasm-deopt` по умолчанию), неверно для Node 26 (V8 14.6): спекулятивное
 * встраивание косвенных вызовов принесло с собой откат. Текст говорит обе половины по версиям,
 * и проверка держит обе — движок и текст.
 *
 * Модуль собран руками, байт в байт: три функции, таблица на две, `run(sel, x)` зовёт
 * `call_indirect` по индексу `sel`. Цель 0 — `x + 1`, цель 1 — `x * 2`.
 */
const MODULE_BYTES = [
  0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
  // типы: (i32) -> i32 и (i32, i32) -> i32
  1, 0x0c, 2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7f,
  // функции: две цели и run
  3, 4, 3, 0, 0, 1,
  // таблица funcref на две ячейки
  4, 4, 1, 0x70, 0, 2,
  // экспорт run
  7, 7, 1, 3, 0x72, 0x75, 0x6e, 0, 2,
  // таблица = [f0, f1]
  9, 8, 1, 0, 0x41, 0, 0x0b, 2, 0, 1,
  // тела: x + 1; x * 2; call_indirect(type 0, table 0)(x, sel)
  10, 0x1b, 3,
  7, 0, 0x20, 0, 0x41, 1, 0x6a, 0x0b,
  7, 0, 0x20, 0, 0x41, 2, 0x6c, 0x0b,
  9, 0, 0x20, 1, 0x20, 0, 0x11, 0, 0, 0x0b,
];

const SCRIPT = `
const bytes = new Uint8Array(${JSON.stringify(MODULE_BYTES)});
const { run } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
const tier = () => %IsTurboFanFunction(run) ? 'turbofan' : %IsLiftoffFunction(run) ? 'liftoff' : 'none';
const out = { before: tier() };
run(0, 1);
out.afterFirstCall = tier();
for (let i = 0; i < 1000; i++) run(0, i);
%WasmTierUpFunction(run);
out.afterTierUp = tier();
out.result = run(1, 5);
out.afterOtherTarget = tier();
console.log('RESULT ' + JSON.stringify(out));
`;

function probe(extra: string[] = []) {
  const out = execFileSync(
    process.execPath,
    ['--allow-natives-syntax', ...extra, '-e', SCRIPT],
    { encoding: 'utf8' },
  );
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  if (!line) throw new Error('зонд не напечатал результат:\n' + out);
  return { json: JSON.parse(line.slice(7)), raw: out };
}

const MDX = readFileSync(
  new URL('../../src/content/lessons/v8-engine/index.mdx', import.meta.url),
  'utf8',
);

describe('WebAssembly: ярусы и откат — движок', () => {
  it('функция компилируется лениво, первым вызовом — в Liftoff, повышение — в TurboFan', () => {
    const { json } = probe();
    expect(json.before).toBe('none');
    expect(json.afterFirstCall).toBe('liftoff');
    expect(json.afterTierUp).toBe('turbofan');
  });

  /**
   * В Node 26 откат включён по умолчанию. В Node 24 оба флага по умолчанию выключены (это
   * отдельный тест ниже и текст темы), поэтому механизм V8 13.6 здесь включают явно — а что
   * без флагов отката нет, проверяется на настоящих умолчаниях.
   */
  const NODE26 = Number(process.versions.node.split('.')[0]) >= 26;
  const ENABLE_DEOPT = NODE26 ? [] : ['--wasm-deopt', '--wasm-inlining-call-indirect'];

  it('настоящие умолчания этого Node: откат есть в Node 26, нет в Node 24', () => {
    const { json, raw } = probe(['--trace-deopt']);
    expect(json.result).toBe(10);
    expect(json.afterOtherTarget).toBe(NODE26 ? 'liftoff' : 'turbofan');
    expect(raw.includes('reason: wrong call target, type: Wasm')).toBe(NODE26);
    expect(MDX).toContain('В Node 24 этого нет: там по умолчанию стоят `--no-wasm-deopt`');
  });

  it('смена цели косвенного вызова откатывает функцию на Liftoff', () => {
    const { json, raw } = probe(['--trace-deopt', ...ENABLE_DEOPT]);
    expect(json.result, 'цель 1 — это x * 2').toBe(10);
    expect(json.afterOtherTarget).toBe('liftoff');
    expect(raw).toContain('reason: wrong call target, type: Wasm');
  });

  it('с --no-wasm-deopt отката нет: функция остаётся в TurboFan', () => {
    const { json } = probe([...ENABLE_DEOPT, '--no-wasm-deopt']);
    expect(json.afterOtherTarget).toBe('turbofan');
  });

  /**
   * Умолчания Node 24 (V8 13.6): `--no-wasm-deopt` и `--no-wasm-inlining-call-indirect`
   * (сверено `node --v8-options` на 24.11). Тест идёт на том Node, что запустил Vitest,
   * поэтому умолчания Node 24 задаются флагами: цель не встраивается, откатываться нечему.
   */
  it('с умолчаниями Node 24 цель не встраивается и отката нет', () => {
    const { json, raw } = probe(['--trace-deopt', '--no-wasm-deopt', '--no-wasm-inlining-call-indirect']);
    expect(json.result).toBe(10);
    expect(json.afterOtherTarget).toBe('turbofan');
    expect(raw).not.toContain('wrong call target');
  });
});

describe('WebAssembly и песочница — текст темы', () => {
  it('тема не утверждает, что у Wasm нет деоптимизации, и цитирует настоящую строку трассы', () => {
    expect(MDX).toContain('reason: wrong call target, type: Wasm');
    expect(MDX).toContain('--no-wasm-deopt');
    expect(MDX).not.toMatch(/деоптимизации нет вообще/);
  });

  it('тема разводит Node 24 и Node 26, а не подаёт откат как общее правило', () => {
    expect(MDX).toContain('В Node 26 TurboFan встраивает ту цель');
    expect(MDX).toContain('В Node 24 этого нет');
    expect(MDX).toContain('--no-wasm-inlining-call-indirect');
  });

  it('песочница V8 в этой сборке Node выключена — как и пишет тема', () => {
    const vars = (process.config as { variables: Record<string, unknown> }).variables;
    expect(vars.v8_enable_sandbox).toBe(0);
    expect(MDX).toContain('`process.config.variables.v8_enable_sandbox`');
  });
});
