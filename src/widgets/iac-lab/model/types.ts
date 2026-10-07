/**
 * Типы мини-планировщика из темы «Инфраструктура как код» (`PLAN_CODE` в `data.ts`).
 *
 * Конфигурация здесь — не HCL, а тот же смысл в виде объекта: HCL из неё печатает `toHcl`
 * (`model/hcl.ts`), и именно этот текст тест скармливает настоящему `tofu plan`.
 */

/** Значение атрибута: число, логическое или строка с подстановками `${key}` и `${тип.имя.поле}`. */
export type AttrValue = string | number | boolean;

export interface ResourceConfig {
  type: string;
  name: string;
  attrs: Record<string, AttrValue>;
  /** `count`: экземпляры с номерами `[0]`, `[1]`…; `${key}` — элемент списка. */
  count?: string[];
  /** `for_each`: экземпляры с ключами `["dev"]`…; `${key}` — ключ. */
  forEach?: string[];
  dependsOn?: string[];
  createBeforeDestroy?: boolean;
}

export interface MovedBlock {
  from: string;
  to: string;
}

export interface Config {
  resources: ResourceConfig[];
  moved?: MovedBlock[];
}

/** Экземпляр в состоянии: адрес, атрибуты и зависимости, как их записал `apply`. */
export interface StateInstance {
  addr: string;
  attrs: Record<string, unknown>;
  deps?: string[];
}

export interface TypeSchema {
  /** Поля, смена которых требует замены объекта (в провайдере — `RequiresReplace`). */
  forceNew: string[];
  /** Поля, которые считает провайдер: у нового объекта они «известны после apply». */
  computed: string[];
  /** Вычисляемые поля, которые становятся неизвестными и при правке на месте. */
  recomputed?: string[];
}

export type Schema = Record<string, TypeSchema>;

/** Настоящий мир для refresh: `null` — объекта нет, объект — его нынешние поля. */
export type World = Record<string, Record<string, unknown> | null>;

export type Action = 'create' | 'update' | 'replace' | 'delete' | 'no-op';

export interface Change {
  addr: string;
  action: Action;
  replacePaths?: string[];
  movedFrom: string | null;
  reason?: string;
  cbd?: boolean;
  deps: string[];
}

export interface Drift {
  addr: string;
  kind: 'deleted' | 'changed';
}

export interface Step {
  addr: string;
  step: 'create' | 'update' | 'destroy';
}

export interface PlanResult {
  changes: Change[];
  drift: Drift[];
  /** Ресурсы в порядке графа: сначала те, от кого зависят. */
  order: string[];
  steps: Step[];
}

export interface PlannerApi {
  UNKNOWN: string;
  plan(config: Config, state: StateInstance[], schema: Schema, world?: World): PlanResult;
}

/** Переключатели демо. */
export interface Toggles {
  /** `count`, `for_each`, переход со `count` на `for_each` без `moved` и с ним. */
  mode: 'count' | 'for_each' | 'migrate' | 'moved';
  /** Правка: нет, `input` у `terraform_data` (на месте), `length` у `random_pet` (замена). */
  edit: 'none' | 'input' | 'force';
  /** Убрать `stage` из середины списка окружений. */
  drop: boolean;
  /** `dev.txt` поправили руками после apply. */
  drift: boolean;
}

/**
 * План, снятый настоящим `tofu`: по экземпляру — действия (`["delete","create"]` и т. п.),
 * причина, прежний адрес и поля, вызвавшие замену; дрейф; рёбра графа apply.
 */
export interface TofuChange {
  addr: string;
  actions: string[];
  reason?: string;
  previous?: string;
  replacePaths?: string[];
}

export interface TofuPlan {
  changes: TofuChange[];
  drift: { addr: string; actions: string[] }[];
  /** Рёбра графа `tofu graph -plan` между шагами: `[зависимый, от кого]`, шаг — `адрес` или `адрес (destroy)`. */
  edges: [string, string][];
  /** Строка `Plan: …` или `No changes. …` из `tofu show`. */
  summary: string;
  /** Строки-заголовки экземпляров из `tofu show`: `# адрес will be created`, `# (because …)`. */
  headers: string[];
}
