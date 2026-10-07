import type { HooksFiber } from './types';

/**
 * «Экран» мини-реализации — разметка, прочитанная из дерева файберов.
 *
 * Хоста у реализации нет, поэтому то, что увидел бы пользователь, — это текущее дерево
 * (`root.current`) после коммита: хост-элементы тегами, текст текстом, компоненты и провайдеры
 * прозрачны. Формат тот же, что у поддельного документа в тесте, — разметку можно сравнивать
 * с настоящим React строкой.
 */
export function serializeFiber(fiber: HooksFiber | null): string {
  let out = '';
  for (let node = fiber; node !== null; node = node.sibling) {
    const type = node.type;
    if (type === 'TEXT') out += String(node.props.nodeValue ?? '');
    else if (typeof type === 'string' && type !== 'ROOT') out += `<${type}>${serializeFiber(node.child)}</${type}>`;
    else out += serializeFiber(node.child);
  }
  return out;
}

/** Всё, что под корнем. */
export function screenOf(root: { current: HooksFiber } | null): string {
  return root ? serializeFiber(root.current.child) : '';
}

/**
 * Разрыв: на одном экране разные значения одного стора. Сценарии со стором печатают
 * ячейки как `A=1`, и разрыв — это больше одного разного числа после `=`.
 */
export function isTorn(screen: string): boolean {
  const values = new Set([...screen.matchAll(/[A-Z]=(\d+)/g)].map((m) => m[1]));
  return values.size > 1;
}
