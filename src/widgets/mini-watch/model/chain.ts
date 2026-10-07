import { API_NAMES, apiArgs } from './load';
import type { ChainScenario, ChainSnapshot, LinkView, MiniComputed, MiniDep, MiniRef, MiniRunner, MiniSub, SubView, WatchApi } from './types';

/**
 * Цепочка `computed`: код из темы, счётчики пересчётов и снимок списков `Link`.
 *
 * Счётчики — это вызовы `count(…)` из самого кода цепочки, поэтому они одинаково честны для
 * любой реализации: мини-версии, её варианта «только флаг», настоящего Vue и мини-версии из
 * «Vue 3 изнутри». Снимок связей читает внутренние поля — у мини-версии и у Vue 3.5 они
 * названы одинаково (`deps`, `nextDep`, `subs`, `prevSub`, `version`), и тест снимает их
 * этим же кодом с обеих сторон.
 */
interface Handles {
  n: MiniRef<number>;
  parity: MiniComputed;
  label: MiniComputed;
  E: MiniRunner;
  act: (index: number) => void;
}

/** Бит `DIRTY` у Vue 3.5 (`EffectFlags.DIRTY`). У мини-версии — поле `dirty`. */
const VUE_DIRTY = 16;

export class ChainLab {
  readonly counts: Record<string, number> = {};
  readonly log: string[] = [];
  private readonly handles: Handles;
  private readonly globalVersion: (() => number) | null;

  constructor(api: Partial<WatchApi> & { getGlobalVersion?: () => number }, scenario: ChainScenario) {
    const cases = scenario.actions.map((code, i) => `case ${i}: { ${code} } break;`).join('\n');
    const body = `${scenario.setup}\nreturn { n, parity, label, E, act(i) { switch (i) {\n${cases}\n} } };`;
    const factory = new Function(...API_NAMES, 'count', 'log', body);
    const count = (name: string) => {
      this.counts[name] = (this.counts[name] ?? 0) + 1;
    };
    this.handles = factory(...apiArgs(api), count, (text: string) => this.log.push(text)) as Handles;
    this.globalVersion = api.getGlobalVersion ?? null;
  }

  act(index: number) {
    this.handles.act(index);
  }

  snapshot(): ChainSnapshot {
    const { n, parity, label, E } = this.handles;
    const depName = new Map<MiniDep, string>([
      [n.dep, 'n'],
      [parity.dep, 'parity'],
      [label.dep, 'label'],
    ]);
    const subName = new Map<MiniSub, string>([
      [E.effect, 'E'],
      [label, 'label'],
      [parity, 'parity'],
    ]);

    const links = (sub: MiniSub): LinkView[] => {
      const out: LinkView[] = [];
      for (let l = sub.deps; l; l = l.nextDep) {
        out.push({ dep: depName.get(l.dep) ?? '?', seen: l.version, current: l.dep.version });
      }
      return out;
    };
    const readers = (dep: MiniDep): string[] => {
      const out: string[] = [];
      for (let l = dep.subs; l; l = l.prevSub) out.push(subName.get(l.sub) ?? '?');
      return out.reverse();
    };
    const dirty = (c: MiniComputed) => (c.dirty !== undefined ? c.dirty : Boolean((c.flags ?? 0) & VUE_DIRTY));

    const subs: SubView[] = [
      { name: 'E', kind: 'effect', links: links(E.effect) },
      { name: 'label', kind: 'computed', version: label.dep.version, dirty: dirty(label), links: links(label), readers: readers(label.dep) },
      { name: 'parity', kind: 'computed', version: parity.dep.version, dirty: dirty(parity), links: links(parity), readers: readers(parity.dep) },
    ];

    return {
      counts: { ...this.counts },
      log: [...this.log],
      subs,
      globalVersion: this.globalVersion ? this.globalVersion() : null,
    };
  }
}
