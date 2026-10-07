/**
 * Типы мини-рендерера и его демо.
 *
 * Сам рендерер — строка `MINI_REACT_CODE` из `data.ts` темы «React изнутри», собранная
 * через `new Function` (`./build.ts`). Типы здесь описывают то, что эта строка отдаёт наружу,
 * и ровно те поля файбера, которые демо читает, — не больше: остальное — дело кода темы.
 */

/** Элемент — то, что возвращает `createElement`. */
export interface MiniElement {
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
}

export interface StateHook {
  kind: 'state';
  state: unknown;
  queue: unknown[];
  consumed: number;
}

export interface EffectHook {
  kind: 'layout' | 'passive';
  deps?: unknown[];
  changed: boolean;
  destroy: (() => void) | null;
}

export type MiniHook = StateHook | EffectHook;

export interface MiniFiber {
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
  stateNode: unknown;
  return: MiniFiber | null;
  child: MiniFiber | null;
  sibling: MiniFiber | null;
  alternate: MiniFiber | null;
  index: number;
  flags: number;
  hooks: MiniHook[] | null;
}

/** Внутреннее состояние рендерера — его читает только демо, чтобы нарисовать деревья. */
export interface MiniInspect {
  currentRoot: MiniFiber | null;
  wipRoot: MiniFiber | null;
  nextUnitOfWork: MiniFiber | null;
  deletions: MiniFiber[];
  pendingPassive: unknown;
}

export type Dispatch<T> = (action: T | ((prev: T) => T)) => void;

/** То, что нужно коду сценария: одно и то же у мини-версии и у настоящего React. */
export interface ScenarioApi {
  h: (type: unknown, config?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  useState: <T>(initial: T | (() => T)) => [T, Dispatch<T>];
  useEffect: (create: () => void | (() => void), deps?: unknown[]) => void;
  useLayoutEffect: (create: () => void | (() => void), deps?: unknown[]) => void;
}

export interface MiniReact {
  createElement: ScenarioApi['h'];
  render: (element: unknown, container: unknown) => void;
  useState: ScenarioApi['useState'];
  useEffect: ScenarioApi['useEffect'];
  useLayoutEffect: ScenarioApi['useLayoutEffect'];
  inspect: () => MiniInspect;
  /** Подписаться на вход и выход из внутренних функций — только наблюдение, логику не трогает. */
  instrument: (enter: (name: string, arg?: MiniFiber) => void, leave: (name: string) => void) => void;
}

/** Хост — узлы, операции над которыми рендерер заказывает через host config. */
export interface HostNode {
  tag: string;
  text?: string;
  attrs: Record<string, string>;
  children: HostNode[];
  parent: HostNode | null;
}

/** Сценарий демо: исходник компонентов (он же исполняется) и действие для кнопки. */
export interface MiniScenario {
  key: string;
  label: string;
  code: string;
  /** Имя функции, которую сценарий отдал через `expose`, и подпись кнопки. */
  action?: { name: string; label: string };
  note: string;
}

export type FramePhase = 'event' | 'render' | 'commit' | 'passive';

export interface FiberRow {
  id: number;
  label: string;
  depth: number;
  flags: string[];
  hooks: string[];
  /** Этот файбер цикл возьмёт следующим (или обрабатывает сейчас). */
  next: boolean;
  /** Номер пары из другого дерева — двойная буферизация. */
  alt: number | null;
}

export interface MiniFrame {
  phase: FramePhase;
  kind: 'event' | 'schedule' | 'unit' | 'op' | 'log' | 'commit' | 'passive';
  text: string;
  current: FiberRow[];
  wip: FiberRow[];
  /** Сколько строк журнала хоста и лога компонентов к этому кадру. */
  ops: number;
  logs: number;
  html: string;
  calls: number;
  commits: number;
}
