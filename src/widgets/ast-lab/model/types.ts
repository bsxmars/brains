/** Позиция в `loc`: строка с единицы, колонка с нуля — как у espree. */
export interface Position {
  line: number;
  column: number;
}

/** Узел ESTree в том виде, в каком его отдаёт espree: тип, место в тексте и прочие поля. */
export interface EsNode {
  type: string;
  range: [number, number];
  loc: { start: Position; end: Position };
  parent?: EsNode | null;
  [key: string]: unknown;
}

/** Правка: заменить символы `range` текстом `text`. */
export interface Fix {
  range: [number, number];
  text: string;
}

/** Сообщение учебного `verify` — те же поля, что у ESLint. Колонки с единицы. */
export interface LintMessage {
  ruleId: string;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fix?: Fix;
}

export interface Pass {
  text: string;
  messages: LintMessage[];
  output: string;
  applied: LintMessage[];
  skipped: LintMessage[];
}

export interface FixResult {
  output: string;
  messages: LintMessage[];
  passes: Pass[];
  /** Упёрлись в потолок проходов и проверили итог ещё раз. */
  recheck: boolean;
}

/** Правило в форме ESLint: `create` получает контекст и возвращает обработчики. */
export interface Rule {
  meta?: Record<string, unknown>;
  create(context: unknown): Record<string, (node: EsNode) => void>;
}

/** Обработчики для учебного `traverse`: селектор → список функций. */
export type Listeners = Record<string, ((node: EsNode) => void)[]>;

/** Что отдают строки `WALK_CODE`, `RULES_CODE` и `LINT_CODE`, собранные вместе. */
export interface LintApi {
  traverse(ast: EsNode, listeners: Listeners): void;
  rules: Record<string, Rule>;
  verify(text: string, ast: EsNode, rules: Record<string, Rule>): LintMessage[];
  applyFixes(text: string, messages: { fix?: Fix }[]): { output: string; applied: LintMessage[]; skipped: LintMessage[] };
  verifyAndFix(text: string, rules: Record<string, Rule>): FixResult;
}

/** Пример для демо: исходник и подпись. */
export interface AstExample {
  id: string;
  label: string;
  code: string;
  /** Подпись над примером. Строчная разметка. */
  note: string;
}

/** Шаг обхода: вход в узел или выход из него, и что сообщили правила на этом шаге. */
export interface WalkEvent {
  kind: 'enter' | 'exit';
  node: EsNode;
  depth: number;
  reports: { ruleId: string; message: string; fixable: boolean }[];
}
