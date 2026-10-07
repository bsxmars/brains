/** Шаг, на котором нашлось имя: aria-labelledby, aria-label, label, alt… Пусто — имени нет. */
export type NameFrom =
  | ''
  | 'aria-labelledby'
  | 'aria-label'
  | 'label'
  | 'alt'
  | 'legend'
  | 'caption'
  | 'value'
  | 'content'
  | 'title'
  | 'placeholder';

/** Состояния узла в том виде, в каком их отдаёт `statesOf` (и CDP после нормализации). */
export interface AxStates {
  disabled?: boolean;
  checked?: string;
  pressed?: string;
  expanded?: string;
  level?: number;
  live?: string;
}

/** Узел дерева, которое строит `axTree`. У текстового листа роль `text`. */
export interface AxNode {
  role: string;
  name: string;
  from?: NameFrom;
  states?: AxStates;
  focusable?: boolean;
  el?: Element;
  children: AxNode[];
}

/** Функции из строк темы (`ROLE_CODE`, `NAME_CODE`, `TAB_CODE`), собранные `new Function`. */
export interface AxApi {
  roleOf(el: Element): string;
  accName(el: Element): { name: string; from: NameFrom };
  statesOf(el: Element, role: string): AxStates;
  isHidden(el: Element): boolean;
  focusable(el: Element): boolean;
  tabOrder(root: Element): Element[];
  axTree(root: Element): AxNode[];
}

/** Что Chromium сказал об элементе (CDP `Accessibility.getPartialAXTree`, см. шапку `data.ts`). */
export type ChromeVerdict =
  | { hidden: true }
  | { hidden?: false; role: string; name: string; from: NameFrom; states?: AxStates; focusable: boolean };

/** Одиночная фикстура: цель помечена `data-k`. */
export interface AxCase {
  id: string;
  html: string;
  chrome: ChromeVerdict;
}

/** Сцена демо: разметка и то, что о каждом её элементе сказал Chromium. */
export interface AxScene {
  id: string;
  label: string;
  html: string;
  /** Подпись над сценой. Строчная разметка. */
  note: string;
  /**
   * По элементу на каждый узел `querySelectorAll('*')` сцены, в порядке документа:
   * `-` — скрыт, `~` — растворился (generic или none без имени), иначе `роль|имя`.
   */
  elements: string[];
  /** Порядок Tab в Chromium: номера элементов в том же списке. */
  tabs: number[];
}
