import type { MiniRunes, NodeKind, NodeSnap, NodeStatus, RawSignal, ScenarioRun, StepKind, TraceStep } from './types';

/**
 * Демо и тест исполняют одни и те же строки: мини-руны `MINI_RUNES_CODE` и сценарии
 * `SCENARIOS[i].code` из `data.ts` темы «Svelte 5 изнутри».
 *
 * `runScenario` не знает, чей у него `$`: тест подаёт ему и мини-руны, и настоящий
 * `svelte/internal/client` 5.57.1 — и сверяет журналы. Демо зовёт `traceScenario`: тот же
 * прогон на мини-рунах, плюс снимок графа после каждого шага.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

type ScenarioFn = ($: unknown, log: (line: string) => void) => Promise<void>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => ScenarioFn;

/** Свежий экземпляр мини-рун: у каждого свой граф, свой счётчик записей и свой пакет. */
export function loadRunes(code: string): MiniRunes {
  return new Function(code)() as MiniRunes;
}

/**
 * Исполнить сценарий на любом `$`. После конца — две микрозадачи: пакет, который сценарий
 * оставил несброшенным, успевает сброситься, как сбросился бы в браузере.
 */
export async function runScenario($: unknown, code: string, log: (line: string) => void): Promise<void> {
  await new AsyncFunction('$', 'log', code)($, log);
  await Promise.resolve();
  await Promise.resolve();
}

/** Значение для показа. Прокси не читается: чтение через ловушку подписало бы демо на граф. */
export function showValue(v: unknown): string {
  if (typeof v === 'symbol') return 'не считано';
  if (Array.isArray(v)) return '[…]';
  if (v !== null && typeof v === 'object') return '{…}';
  if (typeof v === 'string') return `'${v}'`;
  return String(v);
}

/** Прогон на мини-рунах с журналом шагов: пометки, записи, пересчёты, сбросы, строки `log`. */
export async function traceScenario(miniCode: string, code: string): Promise<ScenarioRun> {
  const mini = loadRunes(miniCode);
  const { flags } = mini;

  const order: RawSignal[] = [];
  const ids = new Map<RawSignal, number>();
  const effectNames = new Map<RawSignal, string>();
  const counters = { effect: 0, template: 0 };

  const kindOf = (s: RawSignal): NodeKind =>
    (s.f & flags.DERIVED) !== 0
      ? 'derived'
      : (s.f & flags.EFFECT) !== 0
        ? 'effect'
        : (s.f & flags.RENDER_EFFECT) !== 0
          ? 'template'
          : 'state';

  const statusOf = (s: RawSignal): NodeStatus =>
    (s.f & flags.DIRTY) !== 0 ? 'DIRTY' : (s.f & flags.MAYBE_DIRTY) !== 0 ? 'MAYBE_DIRTY' : (s.f & flags.CLEAN) !== 0 ? 'CLEAN' : '—';

  const nameOf = (s: RawSignal) => s.label ?? effectNames.get(s) ?? kindOf(s);

  function register(s: RawSignal) {
    if (ids.has(s)) return;
    ids.set(s, order.length);
    order.push(s);
    const kind = kindOf(s);
    if (kind === 'effect' || kind === 'template') {
      const n = ++counters[kind];
      effectNames.set(s, `${kind === 'effect' ? '$effect' : 'шаблон'}${n > 1 ? ` ${n}` : ''}`);
    }
  }

  const snap = (): NodeSnap[] =>
    order.map((s, id) => {
      const kind = kindOf(s);
      const isEffect = kind === 'effect' || kind === 'template';
      return { id, name: nameOf(s), kind, status: statusOf(s), wv: s.wv, value: isEffect ? '' : showValue(s.v) };
    });

  const steps: TraceStep[] = [];
  const logs: string[] = [];
  const push = (kind: StepKind, text: string, node: number) => steps.push({ kind, text, node, nodes: snap() });

  mini.trace.on = (type, s) => {
    if (s) register(s);
    if (type === 'create' || !s) {
      if (type === 'flush') push('flush', 'сброс пакета', -1);
      return;
    }
    const id = ids.get(s) ?? -1;
    if (type === 'write') push('write', `запись ${nameOf(s)} = ${showValue(s.v)}, wv ${s.wv}`, id);
    else if (type === 'status') push('status', `${nameOf(s)} → ${statusOf(s)}`, id);
    else if (type === 'run') push('run', `↻ ${nameOf(s)}`, id);
  };

  await runScenario(mini.$, code, (line) => {
    logs.push(line);
    push('log', line, -1);
  });
  mini.trace.on = null;
  return { steps, logs };
}
