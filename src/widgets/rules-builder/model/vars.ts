/**
 * Приоритет переменных: демо использует семь источников из более полного порядка GitLab.
 * Одну переменную можно задать на разных уровнях, и выигрывает
 * не то, которое ближе к джобу в файле.
 *
 * ПОРЯДОК СНЯТ ПРОГОНОМ (`gitlab-ci-local` 4.75.1, образ `alpine:3`). Одна переменная,
 * заданная слоями по очереди, печаталась изнутри контейнера:
 *
 *   • `variables:` в корне файла              → `globals`
 *   • `variables:` джоба поверх корневых      → `job`      (джоб сильнее корня)
 *   • `rules:variables` поверх джобовых       → `rules`    (правило сильнее джоба)
 *   • переменная проекта поверх всего этого   → `project`  (файл проиграл настройкам проекта)
 *   • запуск с переменной вручную             → `cli`      (сильнее всех)
 *
 * ⚠️ Место `dotenv` между `rules` и `project` снято частично: измерено, что отчёт `dotenv`
 * из джоба-предшественника перебивает `variables:` джоба (в замере `VERSION=from-dotenv`
 * победила `VERSION: job`). Что он слабее переменной проекта — это документация GitLab,
 * а не замер.
 */

export type VarSource =
  | 'predefined' | 'deployment' | 'global' | 'workflowRules' | 'job' | 'rules'
  | 'dotenv' | 'instance' | 'group' | 'project' | 'manual' | 'manualJob' | 'policy';

/** Порядок из документации GitLab; часть источников в локальном стенде не запускалась.
 * Применяется к обычным переопределяемым ключам (например DEPLOY), не к защищённым CI_*;
 * policy означает политику, которая добавила рассматриваемый джоб. */
export const VAR_ORDER: VarSource[] = [
  'predefined',
  'deployment',
  'global',
  'workflowRules',
  'job',
  'rules',
  'dotenv',
  'instance',
  'group',
  'project',
  'manual',
  'manualJob',
  'policy',
];

export interface VarLayer {
  source: VarSource;
  value: string;
}

export function strength(source: VarSource): number {
  const index = VAR_ORDER.indexOf(source);
  if (index < 0) throw new Error(`Неизвестный слой переменных: ${source}`);
  return index;
}

/**
 * Кто победил. `null` — переменная не задана нигде, и в условии она будет пустой строкой,
 * а не ошибкой: именно поэтому опечатка в имени переменной не роняет конвейер, а молча
 * делает условие ложным.
 */
export function resolveVar(layers: VarLayer[]): VarLayer | null {
  if (layers.length === 0) return null;
  return layers.reduce((best, layer) => (strength(layer.source) > strength(best.source) ? layer : best));
}

/** Проигравшие слои, от сильного к слабому — их демо показывает зачёркнутыми. */
export function shadowed(layers: VarLayer[]): VarLayer[] {
  const winner = resolveVar(layers);
  if (!winner) return [];
  return layers
    .filter((layer) => layer !== winner)
    .sort((a, b) => strength(b.source) - strength(a.source));
}
