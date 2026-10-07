import * as espree from 'espree';
import type { EsNode } from './types';

/**
 * Парсер для демо и теста — espree (acorn внутри), скрипт последней редакции языка.
 *
 * Отдельным модулем ради веса: виджет грузит его через `import()` при монтировании, и около
 * 180 КБ парсера не входят в статический граф страницы (`tests/e2e/weight.spec.ts`) — тот же
 * приём, что у `widgets/ast-lab`.
 */
export function parse(text: string): EsNode {
  return espree.parse(text, { ecmaVersion: 'latest', sourceType: 'script', loc: true }) as unknown as EsNode;
}
