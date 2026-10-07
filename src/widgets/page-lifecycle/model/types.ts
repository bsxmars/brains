/** Состояние страницы в Page Lifecycle. */
export interface LifecycleNode {
  id: string;
  label: string;
  tone: 'ok' | 'neutral' | 'warn' | 'err';
  /** Что в этом состоянии с циклом — короткой строкой под фишкой. */
  what: string;
}

/**
 * Переход между состояниями.
 *
 * `back` помечает возврат — ту самую стрелку, которой нет на прямой линии
 * «active → passive → hidden → frozen → discarded» и из-за отсутствия которой ломается код.
 */
export interface LifecycleEdge {
  from: string;
  to: string;
  /** Событие или причина перехода. */
  event: string;
  back?: boolean;
  /** Возврат, после которого ничего не сохранилось. */
  cold?: boolean;
}
