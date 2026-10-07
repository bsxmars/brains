/**
 * Публичный API слайса `vapor-lab` для TS: модель демо. Компонент `.vue` импортируется
 * по пути (`@/widgets/vapor-lab/ui/VaporLab.vue`), как и у остальных виджетов.
 */
export { applyScenario, BINDINGS, loadMiniVapor, MiniSide, VdomSide } from './model/lab';
export type { VueLike } from './model/lab';
export { evalModule, VNODE_HELPERS } from './model/module';
export { countKinds, DomProbe } from './model/probe';
export type * from './model/types';
