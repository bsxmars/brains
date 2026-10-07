import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/node-event-loop/data';
import { allowedOrders, joinOut, loadLoop, loadPool } from '@/widgets/libuv-lab/model/run';

/**
 * Тема «Цикл событий Node: фазы libuv».
 *
 * `LOOP_CODE` — учебная модель из темы: напечатана на странице и исполняется демо `libuv-lab`.
 * Здесь она сверяется с настоящим Node. Каждый сценарий `LOOP_SCENARIOS` склеивается
 * с `LOOP_PRELUDE` в файл `.cjs` и запускается в **отдельном процессе** — так же, как его
 * запустит читатель. Модель прогоняется дважды: на «быстрой» (`slack` 0) и «медленной»
 * (`slack` 1) машине.
 *
 *   — детерминированный сценарий: оба прогона модели дают один вывод, и Node выдаёт ровно его
 *     в каждом запуске;
 *   — недетерминированный: модель даёт два разных вывода, и каждый вывод Node — один из них.
 *     Частоты не проверяются: они зависят от загрузки машины (см. шапку `data.ts`).
 *
 * Пул, выход процесса, нормализация задержки и простой цикла — тоже запуском, в отдельных
 * процессах. В тест идут порядок строк и отношения, а не миллисекунды.
 *
 * Процесс берётся тот же, что исполняет vitest (`process.execPath`), — на стенде Node 24.11.
 */

const runLoop = loadLoop(t.LOOP_CODE);
const poolOrder = loadPool(t.POOL_CODE);

const dir = mkdtempSync(join(tmpdir(), 'lesson-node-loop-'));

function node(name: string, code: string, opts: { env?: Record<string, string>; args?: string[] } = {}) {
  const file = join(dir, `${name}.cjs`);
  writeFileSync(file, code);
  return execFileSync(process.execPath, [file, ...(opts.args ?? [])], {
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .trim()
    .split('\n');
}

const scene = (code: string) => `${t.LOOP_PRELUDE}\n${code}\n`;

describe('LOOP_CODE: модель против самой себя и данных стенда', () => {
  for (const s of t.LOOP_SCENARIOS) {
    it(`${s.id}: детерминированность и выборка стенда согласны с моделью`, () => {
      const allowed = allowedOrders(runLoop, s.code);
      expect(allowed.length === 1, 'флаг deterministic').toBe(s.deterministic);
      for (const order of Object.keys(s.real)) expect(allowed, order).toContain(order);
      expect(Object.values(s.real).reduce((a, b) => a + b, 0)).toBe(s.runs);
    });
  }

  it('у недетерминированных сценариев стенд видел оба порядка', () => {
    for (const s of t.LOOP_SCENARIOS.filter((x) => !x.deterministic)) {
      expect(Object.keys(s.real), s.id).toHaveLength(2);
    }
  });

  it('трасса модели проходит фазы в порядке uv_run', () => {
    // Как в uv_run: таймеры в конце круга (круг 0 — таймеры до входа в него).
    const order = ['poll', 'check', 'close', 'timers'];
    const { trace } = runLoop(t.LOOP_SCENARIOS.find((s) => s.id === 'close')!.code, 0);
    let last = { turn: -1, i: -1 };
    for (const step of trace.filter((x) => x.phase !== 'main')) {
      const i = order.indexOf(step.phase);
      if (step.turn === last.turn) expect(i, `${step.phase} в круге ${step.turn}`).toBeGreaterThanOrEqual(last.i);
      last = { turn: step.turn, i };
    }
    // На медленной машине таймер из колбэка ввода-вывода созревает к концу того же круга —
    // и всё равно выполняется после check и close.
    const slow = runLoop(t.LOOP_SCENARIOS.find((s) => s.id === 'close')!.code, 1).trace;
    const io = slow.find((x) => x.kind === 'io')!;
    const timeout = slow.find((x) => x.kind === 'timeout')!;
    expect(timeout.turn).toBe(io.turn);
  });
});

describe('LOOP_CODE против настоящего Node', () => {
  for (const s of t.LOOP_SCENARIOS) {
    it(`${s.id}: каждый запуск Node — один из порядков модели`, () => {
      const allowed = allowedOrders(runLoop, s.code);
      const runs = s.deterministic ? 3 : 10;
      for (let i = 0; i < runs; i++) {
        const out = joinOut(node(`scene-${s.id}`, scene(s.code)));
        expect(allowed, `запуск ${i + 1}`).toContain(out);
      }
    });
  }
});

describe('задержка таймера', () => {
  it('TIMER_ROWS: какую задержку Node запомнил', () => {
    const stored = node('timer', t.TIMER_PROBE_CODE).map((l) => l.split(' ')[1]);
    expect(stored).toEqual(t.TIMER_ROWS.map((r) => r.stored));
  });

  it('TIMER_ROWS: имена предупреждений в stderr', () => {
    const file = join(dir, 'timer2.cjs');
    writeFileSync(file, t.TIMER_PROBE_CODE);
    const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
    for (const row of t.TIMER_ROWS.filter((x) => x.warning !== '—')) expect(r.stderr).toContain(row.warning);
    expect(r.stderr.match(/Timeout\w+Warning:/g)).toHaveLength(3);
  });
});

describe('пул потоков', () => {
  it('POOL_CODE: позиция fs.stat в модели совпадает с самой частой на стенде', () => {
    for (const st of t.POOL_STAND) {
      const order = poolOrder(st.size, t.POOL_TASKS).map((d) => d.name);
      const pos = order.indexOf('fs.stat') + 1;
      expect(Object.keys(st.statPositions).map(Number), `размер ${st.size}`).toContain(pos);
      expect(Object.values(st.statPositions).reduce((a, b) => a + b, 0)).toBe(st.runs);
      const hashes = order.filter((n) => n.startsWith('hash'));
      if (st.size <= 4) {
        expect(hashes.at(-1)).toBe('hash 5');
        expect(st.hash5Last).toBe(st.runs);
      } else {
        expect(st.hash5Last).toBeLessThan(st.runs);
      }
    }
  });

  it('POOL_ORDER_SCENE в Node: fs.stat не раньше, чем в модели, хеш 5 последний при пуле ≤ 4', () => {
    for (const size of [1, 2, 4, 5]) {
      const model = poolOrder(size, t.POOL_TASKS).map((d) => d.name);
      const out = node(`pool-${size}`, scene(t.POOL_ORDER_SCENE), { env: { UV_THREADPOOL_SIZE: String(size) } });
      expect(out.indexOf('fs.stat'), `размер ${size}: ${out.join(', ')}`).toBeGreaterThanOrEqual(model.indexOf('fs.stat'));
      if (size <= 4) expect(out.filter((n) => n.startsWith('hash')).at(-1), `размер ${size}`).toBe('hash 5');
      if (size <= 2) expect(out.indexOf('fs.stat')).toBe(model.indexOf('fs.stat'));
    }
  });

  it('POOL_PROBE_OUT: при пуле из одного потока ждут все операции пула, сокет по IP и таймер — нет', () => {
    const out = node('probe', scene(t.POOL_PROBE_CODE), { env: { UV_THREADPOOL_SIZE: '1' } });
    expect(out).toEqual(t.POOL_PROBE_OUT);
  });

  it('UV_THREADPOOL_SIZE, выставленный после первой задачи пула, не действует', () => {
    const late = `fs.stat(__filename, () => {
  process.env.UV_THREADPOOL_SIZE = '5';
  ${t.POOL_ORDER_SCENE}
});`;
    const out = node('pool-late', scene(late), { env: { UV_THREADPOOL_SIZE: '4' } });
    expect(out.filter((n) => n.startsWith('hash')).at(-1)).toBe('hash 5');
    expect(out.indexOf('fs.stat')).toBeGreaterThanOrEqual(2);
  });

  it('…а в первой строке скрипта — действует', () => {
    const out = node('pool-early', scene(`process.env.UV_THREADPOOL_SIZE = '5';\n${t.POOL_ORDER_SCENE}`), {
      env: { UV_THREADPOOL_SIZE: '4' },
    });
    expect(out.indexOf('fs.stat')).toBe(1);
  });
});

describe('выход процесса и сон в poll', () => {
  it('ALIVE_OUT', () => {
    expect(node('alive', scene(t.ALIVE_CODE))).toEqual(t.ALIVE_OUT);
  });

  it('IDLE_OUT: ожидая таймер, цикл спит; с насосом из setImmediate — не спит вовсе', () => {
    const parse = (line: string) => {
      const [, idle, active] = /idle (\d+) ms, active (\d+) ms/.exec(line)!.map(Number);
      return idle / (idle + active);
    };
    expect(parse(node('idle', t.IDLE_CODE)[0])).toBeGreaterThan(0.9);
    expect(parse(node('idle', t.IDLE_CODE, { args: ['pump'] })[0])).toBeLessThan(0.1);
    expect(parse(t.IDLE_OUT[0].out)).toBeGreaterThan(0.9);
    expect(parse(t.IDLE_OUT[1].out)).toBeLessThan(0.1);
  });

  it('незавершённый промис не держит процесс: CommonJS выходит с кодом 0', () => {
    const out = node('tla', `(async () => { await new Promise(() => {}); console.log('after'); })();
process.on('exit', (code) => console.log('exit ' + code));`);
    expect(out).toEqual(['exit 0']);
  });

  it('beforeExit, поставивший таймер, запускает цикл снова', () => {
    const out = node('before-exit', `let n = 0;
process.on('beforeExit', () => { console.log('beforeExit ' + n); if (n++ < 2) setTimeout(() => console.log('timer'), 1); });`);
    expect(out).toEqual(['beforeExit 0', 'timer', 'beforeExit 1', 'timer', 'beforeExit 2']);
  });
});

describe('числа в тексте', () => {
  it('тонкое место про гонку называет выборку стенда', () => {
    const race = t.LOOP_SCENARIOS.find((s) => s.id === 'race')!;
    const counts = Object.values(race.real).sort((a, b) => b - a);
    const text = t.PITFALLS.find((p) => p.n === '01')!.d;
    expect(text).toContain(`${counts[0]} запуска из ${race.runs}`);
    expect(text).toContain(`${counts[1]} другим`);
  });
});
