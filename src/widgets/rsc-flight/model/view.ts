import { ELEMENT, HOLE, SUSPENSE } from './run';
import type { RowView, TreeLine } from './types';

/**
 * Как показать поток и собранное дерево. Здесь нет ничего про Flight: строки уже разобраны
 * `createFromFlight` из темы, а эта часть только решает, что нарисовать.
 */

/** Кусок потока → строки с видом (для подсветки). */
export function splitRows(chunk: string): RowView[] {
  return chunk
    .split('\n')
    .filter(Boolean)
    .map((text) => {
      const colon = text.indexOf(':');
      const body = text.slice(colon + 1);
      const kind: RowView['kind'] =
        body[0] === 'I' ? 'module' : body[0] === 'E' ? 'error' : body.startsWith('"$S') ? 'symbol' : 'model';
      return { id: text.slice(0, colon), kind, text };
    });
}

interface El {
  $$typeof: symbol;
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
}

interface Hole {
  $$typeof: symbol;
  id?: number;
  error?: unknown;
}

const isEl = (v: unknown): v is El => !!v && typeof v === 'object' && (v as El).$$typeof === ELEMENT;
const isHole = (v: unknown): v is Hole => !!v && typeof v === 'object' && (v as Hole).$$typeof === HOLE;

function propText(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return 'ƒ → вызов уйдёт на сервер';
  if (v instanceof Date) return `Date(${v.toISOString().slice(0, 10)})`;
  if (v instanceof Promise) {
    const p = v as Promise<unknown> & { status?: string; value?: unknown };
    return p.status === 'fulfilled' ? `Promise → ${propText(p.value)}` : `Promise (${p.status ?? 'pending'})`;
  }
  if (isHole(v)) return v.error ? 'ошибка' : 'ещё не пришло';
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

function typeName(type: unknown): string {
  if (typeof type === 'string') return type;
  if (type === SUSPENSE) return 'Suspense';
  if (typeof type === 'function') return type.name || 'Client';
  return String(type);
}

/**
 * Ждёт ли что-то внутри — без учёта вложенных Suspense: у них своя заглушка.
 * Это и есть правило React: недошедшее «подвешивает» ближайшую границу Suspense сверху.
 */
function suspends(node: unknown): boolean {
  if (isHole(node)) return !node.error;
  if (Array.isArray(node)) return node.some(suspends);
  if (!isEl(node)) return false;
  if (node.type === SUSPENSE) return false;
  if (typeof node.type === 'function') return false; // клиентский компонент: его детей уже пропсами передали
  return suspends(node.props.children);
}

function walk(node: unknown, depth: number, out: TreeLine[]) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, depth, out);
    return;
  }
  if (isHole(node)) {
    out.push(
      node.error
        ? { depth, text: '✕ элемент упал: ошибка в строке потока', kind: 'error' }
        : { depth, text: '… строка ещё не пришла', kind: 'hole' },
    );
    return;
  }
  if (!isEl(node)) {
    out.push({ depth, text: JSON.stringify(String(node)), kind: 'text' });
    return;
  }
  const { type, props } = node;
  if (type === SUSPENSE) {
    if (suspends(props.children)) {
      out.push({ depth, text: '<Suspense> — показывает fallback', kind: 'fallback' });
      walk(props.fallback, depth + 1, out);
    } else {
      out.push({ depth, text: '<Suspense>', kind: 'host' });
      walk(props.children, depth + 1, out);
    }
    return;
  }
  const attrs = Object.entries(props)
    .filter(([k]) => k !== 'children')
    .map(([k, v]) => ` ${k}={${propText(v)}}`)
    .join('');
  const client = typeof type === 'function';
  out.push({ depth, text: `<${typeName(type)}${attrs}>`, kind: client ? 'client' : 'host' });
  if (typeof props.children === 'string' || typeof props.children === 'number') {
    out[out.length - 1].text += ` ${props.children}`;
  } else {
    walk(props.children, depth + 1, out);
  }
}

/** Дерево, собранное клиентом, → строки для показа. Корень, который ждёт, — пустой экран. */
export function viewTree(root: unknown): { blank: boolean; lines: TreeLine[] } {
  if (suspends(root)) return { blank: true, lines: [] };
  const lines: TreeLine[] = [];
  walk(root, 0, lines);
  return { blank: false, lines };
}
