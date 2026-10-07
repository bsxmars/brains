/**
 * Публичный API слайса `mini-watch` для TS: модель демо. Компоненты `.vue` импортируются
 * по пути (`@/widgets/mini-watch/ui/…`), как и у остальных виджетов.
 */
export { API_NAMES, apiArgs, loadMiniWatch, patchCode, settle } from './model/load';
export { runRace } from './model/race';
export { ScopeLab } from './model/scopes';
export { ChainLab } from './model/chain';
export type * from './model/types';
