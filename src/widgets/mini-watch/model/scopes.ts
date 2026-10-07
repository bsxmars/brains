import type { MiniRef, MiniScope, ScopeNodeView, WatchApi } from './types';

/**
 * Дерево областей для демо: узлы создаются строкой `SCOPE_NODE_CODE` из темы, остановка —
 * настоящим `scope.stop()`, отклик — настоящей записью в `n`.
 *
 * Жив ли эффект узла, модель не угадывает по дереву: она считает, сколько раз он выполнился.
 * Остановленный эффект на `n.value++` не отвечает — это видно по счётчику, а не по флажку.
 */
interface Node {
  id: number;
  name: string;
  parent: number | null;
  detached: boolean;
  scope: MiniScope;
}

type Build = (
  effectScope: WatchApi['effectScope'],
  effect: WatchApi['effect'],
  onScopeDispose: WatchApi['onScopeDispose'],
  n: MiniRef<number>,
  parent: MiniScope | null,
  detached: boolean,
  name: string,
  log: (text: string) => void,
) => MiniScope | undefined;

export class ScopeLab {
  readonly log: string[] = [];
  private readonly nodes: Node[] = [];
  private readonly api: WatchApi;
  private readonly build: Build;
  private readonly n: MiniRef<number>;

  constructor(api: WatchApi, code: string) {
    this.api = api;
    this.n = api.ref(0);
    this.build = new Function(
      'effectScope',
      'effect',
      'onScopeDispose',
      'n',
      'parent',
      'detached',
      'name',
      'log',
      code,
    ) as Build;
  }

  /** Создать узел. У остановленного родителя `run` не выполняется — узла не будет. */
  add(parentId: number | null, detached = false): number | null {
    const parent = parentId === null ? null : this.find(parentId);
    if (parentId !== null && !parent?.scope.active) return null;
    const id = this.nodes.length;
    const name = `S${id}`;
    const scope = this.build(
      this.api.effectScope,
      this.api.effect,
      this.api.onScopeDispose,
      this.n,
      parent?.scope ?? null,
      detached,
      name,
      (text) => this.log.push(text),
    );
    if (!scope) return null;
    this.nodes.push({ id, name, parent: parentId, detached, scope });
    return id;
  }

  stop(id: number) {
    this.find(id)?.scope.stop();
  }

  bump() {
    this.n.value++;
  }

  /** Узлы в порядке обхода в глубину — так, как их рисует дерево. */
  snapshot(): ScopeNodeView[] {
    const out: ScopeNodeView[] = [];
    const visit = (parent: number | null, depth: number) => {
      for (const node of this.nodes.filter((item) => item.parent === parent)) {
        out.push({
          id: node.id,
          name: node.name,
          parent: node.parent,
          depth,
          detached: node.detached,
          active: node.scope.active,
          runs: this.log.filter((line) => line.startsWith(`${node.name} видит`)).length,
        });
        visit(node.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }

  private find(id: number): Node | undefined {
    return this.nodes.find((node) => node.id === id);
  }
}
