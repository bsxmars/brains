import { API_NAMES } from './load';
import type { DomAdapter, DomScenario, DomStep, MiniSignals } from './types';

/**
 * Записывающий «DOM» для мини-рендерера: узлы — простые объекты, каждая операция — строка
 * журнала. Демо показывает журнал читателю, тест сверяет его с литералом.
 *
 * Настоящий DOM здесь не нужен и даже вреден: вопрос раздела не «что нарисовалось», а
 * «какие операции понадобились», и ответ на него одинаков в браузере и в Node.
 */
interface FakeNode {
  id: number;
  tag: string | null;
  text: string;
  attrs: Record<string, string>;
  children: FakeNode[];
}

const label = (n: FakeNode) => (n.tag ? `<${n.tag}>#${n.id}` : `текст#${n.id}`);

export function createRecordingDom() {
  const ops: string[] = [];
  let next = 0;
  const make = (tag: string | null, text = ''): FakeNode => ({ id: next++, tag, text, attrs: {}, children: [] });

  const dom: DomAdapter<FakeNode> = {
    createElement(tag) {
      const n = make(tag);
      ops.push(`createElement ${label(n)}`);
      return n;
    },
    createText(text) {
      const n = make(null, text);
      ops.push(`createText ${label(n)} ${JSON.stringify(text)}`);
      return n;
    },
    setText(node, text) {
      node.text = text;
      ops.push(`${label(node)}.data = ${JSON.stringify(text)}`);
    },
    setAttribute(node, name, value) {
      node.attrs[name] = value;
      ops.push(`${label(node)}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
    },
    append(parent, child) {
      parent.children.push(child);
      ops.push(`${label(parent)}.append(${label(child)})`);
    },
  };

  const root = make('div');
  const html = (n: FakeNode): string => {
    if (!n.tag) return n.text;
    const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${n.tag}${attrs}>${n.children.map(html).join('')}</${n.tag}>`;
  };

  return {
    dom,
    root,
    /** Забрать накопленные операции. */
    take: () => ops.splice(0),
    /** Разметка содержимого корня, без самого корня. */
    html: () => root.children.map(html).join(''),
  };
}

/** Живой сценарий мини-«Solid»: реализация, записывающий DOM, счётчики вызовов. */
export class DomLab {
  private readonly rec = createRecordingDom();
  private readonly counts: Record<string, number> = {};
  private readonly act: (index: number) => void;

  constructor(mini: MiniSignals, scenario: Pick<DomScenario, 'setup' | 'actions'>) {
    const { h, render } = mini.createRenderer(this.rec.dom as DomAdapter);
    const cases = scenario.actions.map((code, i) => `case ${i}: { ${code} } break;`).join('\n');
    const body = `${scenario.setup}\nreturn function act(i) { switch (i) {\n${cases}\n} };`;
    const factory = new Function(...API_NAMES, 'h', 'render', 'root', 'count', body);
    const count = (name: string) => {
      this.counts[name] = (this.counts[name] ?? 0) + 1;
    };
    this.act = factory(...API_NAMES.map((name) => mini[name]), h, render, this.rec.root, count) as (i: number) => void;
  }

  start(): DomStep {
    return this.take();
  }

  step(index: number): DomStep {
    this.act(index);
    return this.take();
  }

  private take(): DomStep {
    return { ops: this.rec.take(), html: this.rec.html(), counts: { ...this.counts } };
  }
}
