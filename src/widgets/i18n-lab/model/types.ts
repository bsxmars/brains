/**
 * Дерево сообщения — в том виде, в каком его строит `parse` из `ICU_CODE` темы.
 * Текст — строка; остальное — узлы.
 */
export type IcuNode =
  | string
  | { type: 'arg'; name: string }
  | { type: 'pound' }
  | { type: 'select' | 'plural' | 'selectordinal'; name: string; offset: number; options: Record<string, IcuNode[]> };

export type IcuBranchNode = Extract<IcuNode, { options: Record<string, IcuNode[]> }>;

/** Что вернул `pick`: ключ выбранной ветки, категория CLDR и число для `#` (у plural). */
export interface IcuPick {
  key: string;
  category?: string;
  pound?: number;
}

export type IcuValues = Record<string, string | number>;

export interface IcuApi {
  parse(src: string): IcuNode[];
  pick(node: IcuBranchNode, values: IcuValues, locale: string): IcuPick;
  format(nodes: IcuNode[], values: IcuValues, locale: string, pound?: number): string;
}

/** Готовое сообщение для демо. */
export interface IcuPreset {
  id: string;
  label: string;
  message: string;
  locale: string;
  /** Значения аргументов при открытии. Число берётся для plural, строка — для select и `{name}`. */
  values: IcuValues;
  /** Подпись над демо. Строчная разметка. */
  note: string;
}

/** Строка разобранного дерева для показа: глубина, что за узел и выбран ли он. */
export interface TreeRow {
  key: string;
  depth: number;
  kind: 'text' | 'arg' | 'pound' | 'branch' | 'option';
  label: string;
  /** Подпись справа: категория, число для `#`, значение аргумента. */
  note: string;
  /** Узел лежит на пути, по которому прошёл `format`. */
  live: boolean;
}
