/** Сценарий для мини-рун и для настоящего Svelte: одна и та же строка кода. */
export interface RunesScenario {
  id: string;
  label: string;
  /**
   * Тело асинхронной функции с параметрами `$` и `log`. `$` — это `svelte/internal/client`
   * или мини-руны темы; вызовы те же, что в выводе компилятора (`$.state`, `$.get`, `$.set`…).
   */
  code: string;
  /** Что увидеть. Строчная разметка. */
  note: string;
  /** Журнал настоящего Svelte 5.57.1 на этом сценарии — снят стендом, сверяется тестом. */
  svelte: string[];
}

/** Узел графа в демо: источник, derived или эффект. */
export type NodeKind = 'state' | 'derived' | 'effect' | 'template';

export type NodeStatus = 'CLEAN' | 'DIRTY' | 'MAYBE_DIRTY' | '—';

export interface NodeSnap {
  id: number;
  name: string;
  kind: NodeKind;
  status: NodeStatus;
  /** Номер записи (`wv`) — у источника и derived; у эффекта — сколько записей он уже видел. */
  wv: number;
  /** Значение для показа; у эффекта — пустая строка. */
  value: string;
}

export type StepKind = 'write' | 'status' | 'run' | 'flush' | 'log';

export interface TraceStep {
  kind: StepKind;
  text: string;
  /** Узел, которого касается шаг; `-1` — шаг без узла (сброс, строка журнала). */
  node: number;
  /** Состояние всех известных узлов после шага. */
  nodes: NodeSnap[];
}

export interface ScenarioRun {
  steps: TraceStep[];
  logs: string[];
}

/** Узел мини-рун так, как его видит демо: только поля, которые читаются без побочных эффектов. */
export interface RawSignal {
  f: number;
  v?: unknown;
  wv: number;
  label?: string;
}

export interface MiniRunes {
  $: Record<string, (...args: never[]) => unknown>;
  flags: { DERIVED: number; EFFECT: number; RENDER_EFFECT: number; CLEAN: number; DIRTY: number; MAYBE_DIRTY: number };
  trace: { on: ((type: string, signal: RawSignal | null) => void) | null };
}
