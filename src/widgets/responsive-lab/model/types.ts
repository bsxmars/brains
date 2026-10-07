/** Контейнер в цепочке предков: имя, ширина content-box и его шрифт (px). */
export interface Box {
  name: string;
  width: number;
  font: number;
}

/** Окно, шрифты и контейнеры снаружи внутрь — вход `resolve` из `RESOLVE_CODE`. */
export interface Env {
  viewport: { width: number; height: number };
  /** Шрифт из настроек браузера: от него `em` и `rem` в `@media`. */
  initialFont: number;
  /** Вычисленный `font-size` у `html`: от него `rem` в остальных местах. */
  rootFont: number;
  containers: Box[];
}

/** Одно сравнение из условия: «что есть ОП порог». */
export interface Check {
  feature: string;
  actual: number | string;
  op: '<' | '<=' | '>' | '>=' | '=';
  limit: number | string;
  ok: boolean;
}

export interface RuleReport {
  index: number;
  /** Заголовок обёртки (`@media …`, `@container …`) или `null` — правило без условия. */
  when: string | null;
  selector: string;
  decls: [string, string][];
  kind: 'always' | 'media' | 'container';
  name?: string;
  box?: Box | null;
  checks: Check[];
  ok: boolean;
}

export interface ClampTrace {
  min: number;
  val: number;
  max: number;
  out: number;
  pinned: 'min' | 'max' | null;
}

export interface Decl {
  text: string;
  /** Номер правила, которое дало последнее слово. */
  from: number;
  /** Пиксели — у длины; у ключевого слова поля нет. */
  px?: number;
  clamps?: ClampTrace[];
}

export interface Resolved {
  rules: RuleReport[];
  elements: Record<string, Record<string, Decl>>;
}

export type ResolveFn = (env: Env, css: string) => Resolved;

/** Сценарий шрифтов в демо. */
export interface FontChoice {
  value: string;
  label: string;
  initial: number;
  root: number;
}
