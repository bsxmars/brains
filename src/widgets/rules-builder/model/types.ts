/**
 * Конструктор правил: из чего состоит решение «запустится джоб или нет».
 *
 * Здесь нет ни одного ключа GitLab «вообще»: типы описывают ровно ту часть `rules`, которую
 * разбирает тема, — условие, список изменённых файлов, `when`, `allow_failure` и переменные
 * правила. Всё остальное (`needs`, `environment`, `trigger`) на решение о запуске не влияет
 * и в модель не входит намеренно: демо обязано отвечать на один вопрос, а не изображать
 * весь формат.
 */

/** `$CI_PIPELINE_SOURCE` — из-за чего конвейер вообще завёлся. */
export type PipelineSource = 'push' | 'merge_request_event' | 'schedule' | 'web';

/**
 * Контекст конвейера — всё, что правило может о нём спросить.
 *
 * ⚠️ `branch` и `tag` взаимоисключающи, и это не условность модели: на конвейере тега
 * `$CI_COMMIT_BRANCH` не определена вовсе, а не равна имени ветки. Половина правил вида
 * `$CI_COMMIT_BRANCH == "main"` перестаёт совпадать именно поэтому.
 */
export interface PipelineCtx {
  branch: string | null;
  tag: string | null;
  source: PipelineSource;
  /** Файлы, изменённые относительно базы сравнения, — для `changes:`. */
  changed: string[];
  /** Обычные переменные: то, что видно условию как `$ИМЯ`. */
  vars: Record<string, string>;
}

/**
 * Условие `if` — маленькое дерево вместо строки.
 *
 * Разбирать выражение GitLab по-настоящему демо не нужно: тема объясняет **семантику**,
 * а не синтаксис. Дерево честнее строки ещё и тем, что в нём негде спрятать «а тут я угадал»:
 * каждый оператор вычисляется одной веткой `evalExpr`, и её видно в тесте.
 */
export type Expr =
  /** `$A == "b"` — сравнение строк. */
  | { op: 'eq'; left: string; right: string }
  | { op: 'ne'; left: string; right: string }
  /** `$A =~ /regex/`. */
  | { op: 'match'; left: string; right: string }
  /** `if: '$VAR'` — «переменная определена и непуста». */
  | { op: 'defined'; left: string }
  | { op: 'and'; parts: Expr[] }
  | { op: 'or'; parts: Expr[] };

/** `when` в правиле. `delayed` в демо не участвует, но в перечислении он есть — он существует. */
export type When = 'on_success' | 'never' | 'manual' | 'always' | 'delayed';

export interface Rule {
  id: string;
  /** Как правило выглядит в файле — ту же строку читает и человек на странице. */
  text: string;
  /** Условие. Его отсутствие — не «ложь», а «совпадает всегда». */
  if?: Expr;
  /** Шаблоны `changes:`. Вместе с `if` в одном правиле — логическое И. */
  changes?: string[];
  when?: When;
  allowFailure?: boolean;
  /** `rules:variables` — правило умеет не только решать, но и задавать переменные. */
  variables?: Record<string, string>;
}

/** Как правило отработало — для подсветки в демо. */
export type RuleOutcome = 'matched' | 'missed' | 'unreached';

export interface Decision {
  /** Попал ли джоб в конвейер. */
  included: boolean;
  when: When;
  allowFailure: boolean;
  /** Индекс сработавшего правила; `null` — не совпало ни одно. */
  matched: number | null;
  /** Одна фраза о том, почему решение такое. */
  reason: string;
  /** Что случилось с каждым правилом — по порядку. */
  outcomes: RuleOutcome[];
  /** Переменные, доданные сработавшим правилом. */
  variables: Record<string, string>;
}
