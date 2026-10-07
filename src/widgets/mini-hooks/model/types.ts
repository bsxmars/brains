/**
 * Типы мини-реализации хуков и её демо.
 *
 * Сама реализация — строка `MINI_HOOKS_CODE` из `data.ts` темы «React изнутри: хуки и контекст»,
 * собранная через `new Function` (`./build.ts`). Типы описывают то, что строка отдаёт наружу,
 * и ровно те поля файбера и ячейки, которые читает демо.
 */

/** Ячейка списка хуков: `memoizedState` и `queue` — как у React, `type` — подпись для демо. */
export interface HookCell {
  type: string;
  memoizedState: unknown;
  queue: unknown;
  next: HookCell | null;
  /** Сколько обновлений очереди этот рендер свернул — их уберёт коммит. */
  processed?: number;
}

export interface HooksFiber {
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
  memoizedProps: Record<string, unknown> | null;
  memoizedState: HookCell | null;
  updateQueue: Array<{ hasEffect: boolean }> | null;
  dependencies: { lanes: number; contexts: Array<{ displayName?: string }> } | null;
  lanes: number;
  childLanes: number;
  return: HooksFiber | null;
  child: HooksFiber | null;
  sibling: HooksFiber | null;
  alternate: HooksFiber | null;
  rendered: boolean;
}

export interface HooksRoot {
  current: HooksFiber;
  pendingLanes: number;
}

export interface HooksInspect {
  root: HooksRoot | null;
  wipRoot: HooksFiber | null;
  nextUnitOfWork: HooksFiber | null;
  renderLanes: number;
  pendingPassive: unknown;
}

/** То, что нужно коду сценария: одно и то же у мини-версии и у настоящего React. */
export interface HooksApi {
  h: (type: unknown, config?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  useState: (...args: never[]) => unknown;
  useReducer: (...args: never[]) => unknown;
  useRef: (...args: never[]) => unknown;
  useMemo: (...args: never[]) => unknown;
  useCallback: (...args: never[]) => unknown;
  useContext: (...args: never[]) => unknown;
  useEffect: (...args: never[]) => unknown;
  useSyncExternalStore: (...args: never[]) => unknown;
  memo: (type: unknown) => unknown;
  createContext: (value: unknown) => unknown;
  startTransition: (callback: () => void) => void;
}

export interface MiniHooks extends HooksApi {
  render: (element: unknown) => void;
  inspect: () => HooksInspect;
  /** Подписаться на вход и выход из внутренних функций — только наблюдение, логику не трогает. */
  instrument: (enter: (name: string, args: unknown[]) => void, leave: (name: string, args: unknown[], result: unknown) => void) => void;
}

/** Действие сценария: ручка, которую сценарий отдал через `expose`, и подпись кнопки. */
export interface HooksAction {
  name: string;
  label: string;
  /**
   * Вклиниться в нарезанный рендер: дождаться, пока компоненты выведут `afterLogs` строк,
   * и вызвать ручку `then` — событие между двумя кусками рендера.
   */
  interleave?: { afterLogs: number; then: string; label: string };
}

export interface HooksScenario {
  key: string;
  label: string;
  code: string;
  actions: HooksAction[];
  note: string;
  /** Подсветить экран, собранный из разных значений стора. */
  tearCheck?: boolean;
}

export type HooksPhase = 'event' | 'render' | 'commit' | 'passive';

/** Что случилось с файбером в текущем рендере. */
export type FiberStatus = 'mount' | 'render' | 'same' | 'skip' | 'descend' | 'host' | 'idle';

export interface CellRow {
  index: number;
  type: string;
  value: string;
  /** «из кеша», «пересчитан», «к запуску» и т. п. — только для ячеек, прошедших этот рендер. */
  note: string;
}

export interface HooksRow {
  id: number;
  label: string;
  depth: number;
  status: FiberStatus;
  renders: number;
  cells: CellRow[];
  /** Прочитанные контексты: ячеек у них нет, это запись в `dependencies`. */
  contexts: string[];
  /** Для провайдера — его `value`. */
  detail: string;
  /** У файбера есть работа (`lanes`) или она есть ниже (`childLanes`). */
  lanes: boolean;
  childLanes: boolean;
  next: boolean;
}

export interface HooksFrame {
  phase: HooksPhase;
  kind: 'event' | 'unit' | 'log' | 'commit' | 'passive' | 'interleave';
  text: string;
  rows: HooksRow[];
  logs: number;
  screens: number;
  screen: string;
  calls: number;
  commits: number;
}
