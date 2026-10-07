/** Что слушатель делает, кроме записи в журнал. */
export type ListenerAct = 'stop' | 'stopImmediate' | 'prevent' | 'detachLi' | 'removeL3';

/** Слушатель сценария: где висит, в какой фазе и что делает. */
export interface ListenerSpec {
  /** Имя в журнале: `L1`, `L2`… */
  id: string;
  /** Подпись узла, как её печатает `label`: `li`, `button.del`, `#shadow-root`, `window`. */
  at: string;
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  act?: ListenerAct;
}

export interface EventSpec {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  composed: boolean;
}

/** Сценарий: одно и то же описание исполняют модель, happy-dom и Chromium. */
export interface Scenario {
  id: string;
  label: string;
  /** Подпись узла, на который отправляется событие. */
  target: string;
  event: EventSpec;
  listeners: ListenerSpec[];
  /** Режим теневого корня у `like-button`. */
  shadow: 'open' | 'closed';
  /** Сколько раз отправить событие (для `once`). По умолчанию 1. */
  times?: number;
  /** Подпись над демо. Строчная разметка. */
  note: string;
}

/** Одна запись журнала: какой слушатель, на каком узле, в какой фазе и что он видел. */
export interface LogEntry {
  /** Номер отправки, с нуля. */
  run: number;
  id: string;
  currentTarget: string;
  eventPhase: number;
  target: string;
  /** `composedPath()` изнутри слушателя — подписи узлов. */
  path: string[];
  /** `defaultPrevented` сразу после того, как слушатель отработал. */
  prevented: boolean;
}

export interface DispatchResult {
  log: LogEntry[];
  /** Что вернул `dispatchEvent` на каждой отправке. */
  returned: boolean[];
  defaultPrevented: boolean[];
  /** `event.target` после окончания отправки: `null`, если цель была в теневом дереве. */
  targetAfter: (string | null)[];
}

/** Узел учебной модели — то, что создаёт `node()` из строки темы. */
export interface ModelNode {
  name: string;
  kind: 'window' | 'document' | 'element' | 'shadow-root';
  parent: ModelNode | null;
  host?: ModelNode;
  mode?: 'open' | 'closed';
  window?: ModelNode;
  listeners: unknown[];
}

export interface ModelEvent {
  type: string;
  target: ModelNode | null;
  currentTarget: ModelNode | null;
  eventPhase: number;
  defaultPrevented: boolean;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
  composedPath(): ModelNode[];
}

export interface ModelOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

/** То, что возвращает строка `DISPATCH_CODE` темы. */
export interface DispatchApi {
  node(name: string, parent: ModelNode | null, kind?: ModelNode['kind']): ModelNode;
  attachShadow(host: ModelNode, mode: 'open' | 'closed'): ModelNode;
  createEvent(type: string, init?: Partial<EventSpec>): ModelEvent;
  addEventListener(node: ModelNode, type: string, callback: (e: ModelEvent) => void, options?: ModelOptions): void;
  removeEventListener(node: ModelNode, type: string, callback: (e: ModelEvent) => void, options?: { capture?: boolean }): void;
  dispatch(target: ModelNode, event: ModelEvent): boolean;
}
