import type {
  BindingView,
  EnvView,
  EsNode,
  Interpreter,
  OutLine,
  RawClosure,
  RawEnv,
  StepEvent,
  StepHook,
  Trace,
  TraceStep,
} from './types';

/**
 * Демо и тест спрашивают один и тот же интерпретатор — строки `ENV_CODE`, `HOIST_CODE`,
 * `CALL_CODE`, `LOOP_CODE` и `EVAL_CODE` из темы «Замыкания и области видимости».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/closures.test.ts` против настоящего V8: на наборе программ вывод и тексты ошибок
 * интерпретатора совпадают с тем, что печатает `vm` в Node и Chromium. Копии нет.
 *
 * Свободное имя в строках темы одно — `step(event, node, env)`: интерпретатор зовёт его на каждой
 * инструкции и при каждом новом окружении. Здесь оно снимает снимок окружений для демо.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест. Парсер сюда передают
 * (см. `parser.ts`): статический импорт утащил бы espree в граф острова.
 */
export function loadInterpreter(codes: string[], step: StepHook): Interpreter {
  return new Function('step', `${codes.join('\n\n')}\nreturn { run, frames, timers };`)(step) as Interpreter;
}

/** Предел шагов: программа читателя может не закончиться никогда. */
export const STEP_LIMIT = 3000;

const isClosure = (v: unknown): v is RawClosure =>
  typeof v === 'object' && v !== null && (v as { closure?: unknown }).closure === true;

function showValue(v: unknown): string {
  if (isClosure(v)) return `ƒ ${v.name || 'анонимная'}`;
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

function envTitle(env: RawEnv): string {
  switch (env.kind) {
    case 'global':
      return 'глобальное';
    case 'function':
      return `вызов ${env.name || 'функции'}`;
    case 'block':
      return 'блок';
    case 'for':
      return 'for: init';
    case 'iteration':
      return 'итерация';
  }
}

/**
 * Все окружения, до которых можно дойти: от текущего, от кадров стека, от таймеров и от
 * функций, лежащих в переменных. Что сюда не попало — мусор: на него не ведёт ни одна ссылка.
 */
function reachable(roots: RawEnv[]): Set<RawEnv> {
  const seen = new Set<RawEnv>();
  const queue = [...roots];
  while (queue.length > 0) {
    const env = queue.pop()!;
    if (seen.has(env)) continue;
    seen.add(env);
    if (env.outer) queue.push(env.outer);
    for (const b of env.vars.values()) if (isClosure(b.value)) queue.push(b.value.env);
  }
  return seen;
}

function snapshot(current: RawEnv, interp: Interpreter, global: RawEnv): EnvView[] {
  const chain: RawEnv[] = [];
  for (let e: RawEnv | null = current; e; e = e.outer) chain.push(e);
  const roots = [current, global, ...interp.frames, ...interp.timers.map((t) => t.fn.env)];
  const alive = reachable(roots);
  const held = [...alive].filter((e) => !chain.includes(e)).sort((a, b) => b.id - a.id);
  const view = (env: RawEnv, role: EnvView['role']): EnvView => ({
    id: env.id,
    title: envTitle(env),
    outer: env.outer ? env.outer.id : null,
    role,
    vars: [...env.vars.entries()]
      .filter(([, b]) => b.kind !== 'host')
      .map(([name, b]): BindingView => ({
        name,
        kind: b.kind,
        value: b.ready ? showValue(b.value) : '',
        tdz: !b.ready,
        fnEnv: b.ready && isClosure(b.value) ? b.value.env.id : null,
      })),
  });
  return [...chain.map((e, i) => view(e, i === 0 ? 'current' : 'chain')), ...held.map((e) => view(e, 'held'))];
}

function noteFor(event: StepEvent, env: RawEnv | null, line: number | null): string {
  if (!env) return '';
  const outer = env.outer ? ` Внешнее — #${env.outer.id}.` : '';
  switch (event) {
    case 'start':
      return 'Подъём: имена программы заведены до первой строки. `var` и `function` уже со значением, `let` и `const` — в мёртвой зоне.';
    case 'stmt':
      return line ? `Исполняется строка ${line}.` : '';
    case 'call':
      return `Вызов \`${env.name || 'функции'}\`: новое окружение #${env.id}.${outer} Оно взято у функции — там, где её создали, а не там, откуда позвали.`;
    case 'block':
      return `Вход в блок: новое окружение #${env.id}.${outer}`;
    case 'for':
      return `\`for\` с \`let\`: окружение #${env.id} для части до первой \`;\`.`;
    case 'copy': {
      const vals = [...env.vars.entries()].map(([n, b]) => `${n} = ${showValue(b.value)}`).join(', ');
      return `Новая итерация: окружение #${env.id}, в него скопировано \`${vals}\`. Замыкания прошлых итераций остались со своими окружениями.`;
    }
    case 'timer':
      return `Сработал таймер: вызывается функция, созданная в окружении #${env.id}.`;
    case 'error':
      return 'Ошибка: синхронная часть программы остановлена. Таймеры, поставленные до неё, всё равно сработают.';
    case 'end':
      return '';
  }
}

/**
 * Пройти программу интерпретатором темы, снимая окружения на каждом шаге.
 * Ошибки JS в программе — часть вывода; выход за подмножество — `problem`.
 */
export function traceProgram(codes: string[], program: EsNode): Trace {
  const steps: TraceStep[] = [];
  const out: OutLine[] = [];
  let global: RawEnv | null = null;
  let last: RawEnv | null = null;
  let maxId = 0;
  let count = 0;
  const hook: StepHook = (event, node, env) => {
    if (++count > STEP_LIMIT) throw { limit: true };
    if (env && !global) global = env;
    if (env) last = env;
    if (env) maxId = Math.max(maxId, env.id);
    const current = env ?? last;
    if (!current || !global) return;
    const line = node?.loc?.start.line ?? null;
    const envs = snapshot(current, interp, global);
    const alive = envs.length;
    let note = noteFor(event, current, line);
    if (event === 'end') {
      note = `Программа и таймеры закончились. Окружений создано: ${maxId}, достижимо: ${alive}. Остальные — мусор: на них не ссылается ни одна живая функция.`;
    }
    steps.push({ event, line, note, envs, out: out.slice(), created: maxId, alive });
  };
  const interp = loadInterpreter(codes, hook);
  try {
    interp.run(program, (text, error = false) => out.push({ text, error }));
  } catch (e) {
    const err = e as { limit?: boolean; unsupported?: boolean; node?: EsNode };
    if (err.limit) return { steps, out, problem: `Больше ${STEP_LIMIT} шагов — похоже на бесконечный цикл.` };
    if (err.unsupported && err.node) {
      const line = err.node.loc?.start.line;
      return { steps, out, problem: `Интерпретатор темы не знает \`${err.node.type}\`${line ? ` (строка ${line})` : ''}. Его подмножество — в коде выше.` };
    }
    throw e;
  }
  return { steps, out, problem: null };
}

/** Текст ошибки разбора — или `null`, если текст разобрался. */
export function parseError(text: string, parse: (t: string) => EsNode): string | null {
  try {
    parse(text);
    return null;
  } catch (e) {
    return `SyntaxError: ${(e as Error).message}`;
  }
}

const fmt = (v: unknown) => (typeof v === 'function' ? `[Function: ${(v as { name: string }).name || '(anonymous)'}]` : String(v));

/**
 * Та же программа — настоящим движком: тело `new Function` в строгом режиме, `console.log`
 * и `setTimeout` подменены, чтобы собрать вывод. Таймеры настоящие; ошибка в колбэке таймера
 * печатается так же, как у интерпретатора. Звать только для программ, которые интерпретатор
 * прошёл до конца: бесконечный цикл здесь повесил бы страницу.
 */
export async function runReal(code: string): Promise<OutLine[]> {
  const out: OutLine[] = [];
  let pending = 0;
  const report = (e: unknown) => {
    const err = e as Error;
    out.push({ text: `${err.name}: ${err.message}`, error: true });
  };
  const console = { log: (...args: unknown[]) => out.push({ text: args.map(fmt).join(' '), error: false }) };
  const setTimeout = (fn: () => void, ms = 0) => {
    pending++;
    globalThis.setTimeout(() => {
      pending--;
      try {
        fn();
      } catch (e) {
        report(e);
      }
    }, ms);
  };
  try {
    new Function('console', 'setTimeout', `"use strict";\n${code}`)(console, setTimeout);
  } catch (e) {
    report(e);
  }
  while (pending > 0) await new Promise((r) => globalThis.setTimeout(r, 5));
  return out;
}
