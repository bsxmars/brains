/**
 * Публичный API слайса `mini-signals` для TS: модель демо. Компоненты `.vue` импортируются
 * по пути (`@/widgets/mini-signals/ui/…`), как и у остальных виджетов.
 */
export { API_NAMES, GraphLab, loadSignals, patchCode } from './model/load';
export { createRecordingDom, DomLab } from './model/dom';
export type * from './model/types';
