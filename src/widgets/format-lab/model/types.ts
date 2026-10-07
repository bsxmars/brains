/**
 * Doc Prettier в том виде, в каком его отдаёт `prettier.__debug.printToDoc`, после `toPlain`:
 * id групп — строки вместо символов (см. шапку `data.ts` темы «Форматтер изнутри»).
 */
export type Doc = string | Doc[] | DocCommand;

export interface DocCommand {
  type: string;
  contents?: Doc;
  parts?: Doc[];
  /** `true` — сломана заранее (`shouldBreak`); Prettier пишет сюда и `'propagated'`. */
  break?: boolean | string;
  id?: string;
  groupId?: string;
  expandedStates?: Doc[];
  breakContents?: Doc;
  flatContents?: Doc;
  hard?: boolean;
  soft?: boolean;
  literal?: boolean;
  n?: number;
  negate?: boolean;
}

export type Mode = 'break' | 'flat';

/** Что учебный принтер решил про группу: режим и, у `conditionalGroup`, номер варианта. */
export interface GroupDecision {
  mode: Mode;
  state: number;
}

export interface PrintResult {
  text: string;
  decisions: Map<DocCommand, GroupDecision>;
}

export type PrintDocFn = (doc: Doc, printWidth: number) => PrintResult;

/** Пример для демо: код, его Doc и ширина при открытии. */
export interface FormatSnippet {
  id: string;
  label: string;
  code: string;
  doc: Doc;
  start: number;
  /** Подпись над примером. Строчная разметка. */
  note: string;
}

/** Строка дерева Doc в демо. */
export interface OutlineRow {
  depth: number;
  /** `group`, `indent`, `fill`, `conditionalGroup` и т. п.; `text` — склеенные листья. */
  kind: string;
  text: string;
  /** Только у групп. `undefined` — группа не печаталась (лежит в невыбранном варианте). */
  mode?: Mode;
}
