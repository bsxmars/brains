/**
 * Типы мини-реализации конкурентного React и её демо.
 *
 * Сама реализация — строка `MINI_LANES_CODE` из `data.ts` темы «React изнутри: конкурентность
 * и lanes», собранная через `new Function` (`./build.ts`). Типы описывают только то, что строка
 * отдаёт наружу, и те поля файбера и корня, которые демо читает.
 */

export interface LanesFiber {
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
  alternate: LanesFiber | null;
  return: LanesFiber | null;
  child: LanesFiber | null;
  sibling: LanesFiber | null;
  index: number;
  hooks: unknown[] | null;
  didSuspend?: boolean;
}

export interface LanesRoot {
  current: LanesFiber | null;
  pendingLanes: number;
  suspendedLanes: number;
  expiredLanes: number;
  expirationTimes: Record<string, number>;
  callbackLane: number;
}

export interface SchedulerTask {
  id: number;
  callback: ((didTimeout: boolean) => unknown) | null;
  priority: number;
  expirationTime: number;
}

export interface LanesInspect {
  root: LanesRoot;
  wipRoot: LanesFiber | null;
  wipRootLanes: number;
  workInProgress: LanesFiber | null;
  taskQueue: SchedulerTask[];
}

export type Dispatch<T> = (action: T | ((prev: T) => T)) => void;

/** То, что нужно коду сценария: одно и то же у мини-версии и у настоящего React. */
export interface LanesScenarioApi {
  h: (type: unknown, config?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  useState: <T>(initial: T | (() => T)) => [T, Dispatch<T>];
  useTransition: () => [boolean, (callback: () => void) => void];
  useDeferredValue: <T>(value: T) => T;
  startTransition: (callback: () => void) => void;
  Suspense: unknown;
}

export interface LaneNames {
  SyncLane: number;
  InputContinuousLane: number;
  DefaultLane: number;
  TransitionLane: number;
  RetryLane: number;
}

export interface MiniLanes extends LanesScenarioApi {
  render: (element: unknown) => void;
  /** Так React DOM оборачивает обработчик дискретного события: всё внутри — `SyncLane`. */
  discreteUpdates: (callback: () => void) => void;
  lanes: LaneNames;
  inspect: () => LanesInspect;
  /** Подписаться на вход и выход из внутренних функций — только наблюдение, логику не трогает. */
  instrument: (
    enter: (name: string, args: unknown[]) => void,
    leave: (name: string, result: unknown) => void,
  ) => void;
}

/** Действие сценария: имя ручки, подпись кнопки и то, каким событием оно пришло. */
export interface LanesAction {
  name: string;
  label: string;
  /** `discrete` — клик или клавиша (`SyncLane`), `default` — таймер или ответ сети (`DefaultLane`). */
  event: 'discrete' | 'default';
}

export interface LanesScenario {
  key: string;
  label: string;
  code: string;
  actions: LanesAction[];
  note: string;
}

export type LaneFrameKind =
  | 'event'
  | 'schedule'
  | 'task'
  | 'unit'
  | 'yield'
  | 'restart'
  | 'commit'
  | 'suspend'
  | 'ping'
  | 'idle';

/** Кусок работы на шкале времени: один заход `renderRoot` без перерыва. */
export interface TimelineSegment {
  from: number;
  to: number;
  lane: number;
  /** Номер попытки рендера: у выброшенной попытки все куски помечаются вместе. */
  attempt: number;
  outcome: 'running' | 'yield' | 'commit' | 'thrown' | 'suspended';
}

export interface WipRow {
  label: string;
  depth: number;
  state: 'done' | 'next' | 'todo';
}

export interface TaskRow {
  id: number;
  priority: string;
  expires: number;
  what: string;
}

export interface LaneFrame {
  kind: LaneFrameKind;
  text: string;
  time: number;
  pending: number;
  suspended: number;
  expired: number;
  expirationTimes: Record<string, number>;
  /** Полоса идущего рендера; `0` — рендера нет. */
  renderLane: number;
  wip: WipRow[];
  tasks: TaskRow[];
  micro: number;
  html: string;
  logs: number;
  segments: TimelineSegment[];
  calls: number;
  commits: number;
  restarts: number;
}
