import type { DomOp, OpKind } from './types';

/**
 * Щуп DOM: считает вызовы DOM API внутри одного контейнера.
 *
 * Один и тот же щуп меряет всё: VDOM-сторону демо (Vue 3.5 сайта), мини-vapor и — в тесте —
 * настоящий Vapor 3.6 в happy-dom. Поэтому числа сторон сравнимы: их считает один код.
 *
 * Как устроен:
 *   - на время замера подменяет методы и сеттеры на прототипах DOM и возвращает их в `stop`;
 *   - считает только **внешний** вызов: если DOM-реализация внутри себя зовёт другие методы
 *     (happy-dom так делает, браузер — нет), это одна операция, а не несколько. Без этого числа
 *     в тесте и в браузере разошлись бы;
 *   - считает только то, что касается контейнера: цель была внутри него в момент вызова или
 *     оказалась внутри к концу замера (так считается и создание узла, и запись текста в строку
 *     списка, которую вставят в DOM следующим вызовом). Разбор `<template>` через `innerHTML` у Vapor идёт
 *     на отдельном элементе и в счёт не попадает — ни у настоящего, ни у мини;
 *   - служебные записи в сам контейнер (`data-v-app`, `v-cloak`, очистка при монтировании)
 *     не считаются: это работа `app.mount`, а не компонента.
 *
 * ⚠️ Подмена глобальная: всё, что меняет DOM за время замера, проходит через щуп. Отсюда
 * фильтр по контейнеру — чужие острова страницы в счёт не попадут.
 */

type Env = Pick<typeof globalThis, 'Node' | 'Element' | 'CharacterData' | 'Document' | 'Text' | 'Comment'>;

const METHODS: [name: string, kind: OpKind, target: 'self' | 'arg' | 'result'][] = [
  ['insertBefore', 'insert', 'arg'],
  ['appendChild', 'insert', 'arg'],
  ['replaceChild', 'insert', 'arg'],
  ['removeChild', 'remove', 'arg'],
  ['remove', 'remove', 'self'],
  ['setAttribute', 'attr', 'self'],
  ['removeAttribute', 'attr', 'self'],
  ['cloneNode', 'create', 'result'],
  ['createElement', 'create', 'result'],
  ['createTextNode', 'create', 'result'],
  ['createComment', 'create', 'result'],
];

const SETTERS: [name: string, kind: OpKind][] = [
  ['nodeValue', 'text'],
  ['data', 'text'],
  ['textContent', 'text'],
  ['className', 'class'],
  ['innerHTML', 'create'],
];

/** Владелец свойства по цепочке прототипов: там его и подменять. */
function owner(proto: object | null, name: string): object | null {
  while (proto && !Object.prototype.hasOwnProperty.call(proto, name)) proto = Object.getPrototypeOf(proto);
  return proto;
}

export class DomProbe {
  readonly ops: DomOp[] = [];
  private pending: DomOp[] = [];
  private restore: (() => void)[] = [];
  private depth = 0;

  constructor(
    private readonly container: Node,
    private readonly env: Env = globalThis,
  ) {}

  private inside(node: Node | null | undefined): boolean {
    return !!node && this.container.contains(node);
  }

  /**
   * `self` — узел, на котором вызвали метод; `wasInside` — был ли он в контейнере до вызова
   * (после `remove()` узла там уже нет, а операция была).
   */
  private record(kind: OpKind, api: string, node: Node, self: Node, wasInside: boolean) {
    // app.mount пишет атрибуты и очищает сам контейнер — это не работа компонента
    if (self === this.container && kind !== 'insert') return;
    // запись в свежий узел до вставки — тоже работа: решается в stop, по тому, где узел оказался
    if (wasInside) this.ops.push({ kind, api, node });
    else this.pending.push({ kind, api, node });
  }

  start(): this {
    // функции-подмены получают свой `this` — DOM-узел; щуп им виден через эти стрелки
    const enter = () => this.depth++ === 0;
    const leave = () => void this.depth--;
    const inside = (node: Node) => this.inside(node);
    const record = (...args: Parameters<DomProbe['record']>) => this.record(...args);
    const { Node, Element, CharacterData, Document, Text, Comment } = this.env;
    const bases = [Text, Comment, CharacterData, Element, Document, Node].map((c) => c.prototype);
    const patched = new Map<object, Set<string>>();

    /** Один владелец подменяется один раз, сколько бы баз к нему ни вело. */
    const once = (proto: object | null, name: string) => {
      if (!proto) return false;
      const names = patched.get(proto) ?? new Set<string>();
      patched.set(proto, names);
      if (names.has(name)) return false;
      names.add(name);
      return true;
    };

    for (const [name, kind, target] of METHODS) {
      for (const base of bases) {
        const proto = owner(base, name) as Record<string, unknown> | null;
        if (!proto || !once(proto, name) || typeof proto[name] !== 'function') continue;
        const original = proto[name] as (...args: unknown[]) => unknown;
        proto[name] = function (this: Node, ...args: unknown[]) {
          const outer = enter();
          try {
            const wasInside = outer && inside(this);
            const result = original.apply(this, args);
            if (outer) {
              const node = (target === 'arg' ? args[0] : target === 'result' ? result : this) as Node;
              record(kind, name, node, target === 'result' ? (result as Node) : this, wasInside);
            }
            return result;
          } finally {
            leave();
          }
        };
        this.restore.push(() => {
          proto[name] = original;
        });
      }
    }

    for (const [name, kind] of SETTERS) {
      for (const base of bases) {
        const proto = owner(base, name);
        if (!proto || !once(proto, name)) continue;
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc?.set) continue;
        const set = desc.set;
        Object.defineProperty(proto, name, {
          ...desc,
          set(this: Node, value: unknown) {
            const outer = enter();
            try {
              // запись до вызова: removeChild и textContent уводят узел из контейнера
              if (outer) record(kind, name + '=', this, this, inside(this));
              set.call(this, value);
            } finally {
              leave();
            }
          },
        });
        this.restore.push(() => Object.defineProperty(proto, name, desc));
      }
    }
    return this;
  }

  /** Снять подмены и дописать операции над узлами, которые к концу оказались в контейнере. */
  stop(): DomOp[] {
    for (const undo of this.restore.reverse()) undo();
    this.restore = [];
    for (const op of this.pending) if (this.inside(op.node)) this.ops.push(op);
    this.pending = [];
    return this.ops;
  }
}

/** Операции по видам: `{ text: 2, class: 1 }`. Порядок ключей — алфавитный, для сверки. */
export function countKinds(ops: readonly Pick<DomOp, 'kind'>[]): Partial<Record<OpKind, number>> {
  const out: Partial<Record<OpKind, number>> = {};
  for (const op of [...ops].sort((a, b) => a.kind.localeCompare(b.kind))) out[op.kind] = (out[op.kind] ?? 0) + 1;
  return out;
}
