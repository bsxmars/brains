/**
 * Формы данных демо «где остановится правка».
 *
 * Граф описан так, как его видит dev-сервер Vite: адрес модуля, что он импортирует и что
 * принимает. Адреса — те же, что уходят в сообщениях HMR (`/Button.js`), чтобы ответ учебной
 * функции сверялся с журналом стенда без перевода имён.
 */

export interface HmrNode {
  /** Кого модуль импортирует. Импортёров функция выводит сама — обращением этого списка. */
  imports: string[];
  /**
   * Что модуль принимает: `'self'` — себя (`import.meta.hot.accept()`), массив — свои зависимости
   * (`accept('./Button.js', …)`). Нет поля — не принимает ничего.
   */
  accept?: 'self' | string[];
  /** `css` — у `<link>`-стилей; остальные модули, включая импортированный CSS, — `js`. */
  type?: 'js' | 'css';
}

export type HmrGraph = Record<string, HmrNode>;

export type TraceStep =
  | { url: string; step: 'self' }
  | { url: string; step: 'up'; to: string[] }
  | { url: string; step: 'accepts-dep'; dep: string }
  | { url: string; step: 'dead-end' };

export interface HmrUpdate {
  type: 'js-update' | 'css-update';
  timestamp: 'T';
  path: string;
  acceptedPath: string;
}

export type HmrPayload =
  | { type: 'update'; updates: HmrUpdate[] }
  | { type: 'full-reload'; triggeredBy: string; path: '*' };

export interface BoundaryResult {
  reload: boolean;
  /** Ветка, упёршаяся в модуль без импортёров: от изменённого до корня. */
  deadEnd: string[] | null;
  trace: TraceStep[];
  /** Адреса, которые браузер запросит заново с `?t=`. */
  refetch: string[];
  payload: HmrPayload;
}

export type FindBoundary = (graph: HmrGraph, changed: string, opts?: { invalidated?: boolean }) => BoundaryResult;

/** Сообщение сервера так, как его снял стенд: `timestamp` заменён на `T`, путь — на адрес. */
export type ObservedMessage =
  | {
      type: 'update';
      updates: {
        type: 'js-update' | 'css-update';
        timestamp: 'T';
        path: string;
        acceptedPath: string;
        explicitImportRequired: boolean;
        isWithinCircularImport: boolean;
        firstInvalidatedBy?: string;
      }[];
    }
  | { type: 'full-reload'; triggeredBy?: string; path: string }
  | { type: 'custom'; event: string; data: { file: string } };

export type VariantId = 'none' | 'button-self' | 'app-dep' | 'two-paths';

/** Один прогон стенда: граф, правка и то, что сделал настоящий Vite. */
export interface HmrJournal {
  id: string;
  title: string;
  /** Вариант демо, если прогон совпадает с одним из них. */
  variant?: VariantId;
  graph: HmrGraph;
  changed: string;
  /** В колбэке `accept` модуль зовёт `import.meta.hot.invalidate()`. */
  invalidates?: boolean;
  /** Сообщения, пришедшие странице по WebSocket, без `connected` и `ping`. */
  messages: ObservedMessage[];
  reload: boolean;
  /** Адреса, запрошенные с `?t=`, — метка вырезана. При перезагрузке список не сверяется. */
  refetched: string[];
  /** Текст кнопки (или цвет) до правки и после. */
  before: string;
  after: string;
  /** Строка в журнале dev-сервера. */
  log: string[];
}

export interface DemoVariant {
  id: VariantId;
  label: string;
  note: string;
  graph: HmrGraph;
}

export interface NodePos {
  x: number;
  y: number;
}
