import * as espree from 'espree';
import type { EsNode } from './types';

/**
 * Парсер для демо и теста — espree с настройками ESLint для `.js`-модуля.
 *
 * Отдельным модулем ради веса: виджет грузит его через `import()` (см. шапку `run.ts`),
 * и около 180 КБ парсера не входят в статический граф страницы.
 */
export const PARSE_OPTIONS = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  range: true,
  loc: true,
  tokens: true,
  comment: true,
} as const;

export const KEYS = espree.VisitorKeys as unknown as Record<string, readonly string[]>;

export function parse(text: string): EsNode {
  return espree.parse(text, PARSE_OPTIONS) as unknown as EsNode;
}
