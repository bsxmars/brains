import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEMO_SCENARIOS,
  DEVTOOLS_CODE,
  DEVTOOLS_LOG,
  EFFECTS_MOUNT_LOG,
  EFFECTS_UPDATE_LOG,
  MINI_REACT_CODE,
  NO_BAILOUT_CODE,
  NO_BAILOUT_LOG,
  SCENARIO_BATCH,
  SCENARIO_KEYS,
  SCENARIO_MOUNT,
  SCENARIO_UPDATE,
  STEP_ELEMENT,
  UNMOUNT_CODE,
  UNMOUNT_LOG,
} from '@/content/frameworks/react-internals/data';
import { buildMiniReact, loadScenario, type HostConfig } from '@/widgets/mini-fiber/model/build';
import { createJournalHost, type JournalOptions } from '@/widgets/mini-fiber/model/host';
import { createSession } from '@/widgets/mini-fiber/model/session';
import type { HostNode, ScenarioApi } from '@/widgets/mini-fiber/model/types';

/**
 * «React изнутри»: мини-рендерер темы против настоящего React 19.3.
 *
 * Исполняется **та же строка** `MINI_REACT_CODE`, что напечатана в теме, и те же исходники
 * сценариев (`SCENARIO_*`) — у мини-версии со своими хуками, у React — с его хуками.
 * Программа одна, рендереров два, сверяется наблюдаемое: разметка, лог компонентов,
 * сохранность состояния и то, какие узлы двигались.
 *
 * **Как React работает без DOM.** jsdom в зависимостях курса нет, поэтому ниже — поддельный
 * документ из обычных объектов, ровно на то, что клиентскому рендереру нужно для этих
 * сценариев: создать элемент и текст, вставить, переставить, удалить, прочитать текст.
 * Каждая вставка в поддельный документ пишется в журнал — так видно, сколько раз React
 * тронул контейнер и какие узлы переставил. Обновления прогоняются через `act`, поэтому
 * эффекты и микрозадачи React к моменту проверки гарантированно отработали.
 *
 * `vitest` выставляет `NODE_ENV=test`, и `react`/`react-dom` отдают **отладочную** сборку.
 * Поведение, которое здесь сверяется (порядок, число вызовов, разметка), от сборки не зависит,
 * а вот предупреждения — зависят; единственная проверка про предупреждения помечена ниже.
 *
 * Где мини-версия отличается от React **намеренно**, тест фиксирует отличие явно и говорит
 * почему: иначе «починка» мини-версии или обновление React молча стёрли бы то, что тема
 * утверждает в разделе «Против настоящего React».
 */

/* ───────────────────────── Поддельный документ для React ───────────────────────── */

interface FakeOp {
  op: 'append' | 'insert' | 'remove';
  parent: FakeNode;
  child: FakeNode;
}

const fakeOps: FakeOp[] = [];

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  nodeValue: string | null = null;
  constructor(public nodeType: number) {}
  get ownerDocument(): FakeNode {
    return fakeDocument;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode) {
    child.parentNode?.detach(child);
    this.childNodes.push(child);
    child.parentNode = this;
    fakeOps.push({ op: 'append', parent: this, child });
    return child;
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    if (!before) return this.appendChild(child);
    child.parentNode?.detach(child);
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    child.parentNode = this;
    fakeOps.push({ op: 'insert', parent: this, child });
    return child;
  }
  removeChild(child: FakeNode) {
    this.detach(child);
    fakeOps.push({ op: 'remove', parent: this, child });
    return child;
  }
  detach(child: FakeNode) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
  }
  addEventListener() {}
  removeEventListener() {}
  get textContent(): string {
    return this.nodeType === 3 ? (this.nodeValue ?? '') : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value: string) {
    if (this.nodeType === 3) {
      this.nodeValue = value;
      return;
    }
    this.childNodes.forEach((c) => (c.parentNode = null));
    this.childNodes = [];
    if (value !== '' && value != null) {
      const text = new FakeNode(3);
      text.nodeValue = String(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }
  get data() {
    return this.nodeValue ?? '';
  }
  set data(value: string) {
    this.nodeValue = value;
  }
}

class FakeElement extends FakeNode {
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  tagName: string;
  nodeName: string;
  constructor(public localName: string) {
    super(1);
    this.tagName = localName.toUpperCase();
    this.nodeName = this.tagName;
  }
  /** Гидратация сверяет атрибуты готовой разметки с пропсами — ей нужен их список. */
  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }
  setAttribute(key: string, value: unknown) {
    this.attrs[key] = String(value);
  }
  removeAttribute(key: string) {
    delete this.attrs[key];
  }
  getAttribute(key: string) {
    return this.attrs[key] ?? null;
  }
  hasAttribute(key: string) {
    return key in this.attrs;
  }
}

const fakeDocument = Object.assign(new FakeNode(9), {
  nodeName: '#document',
  createElement: (tag: string) => new FakeElement(tag),
  createTextNode: (value: string) => {
    const text = new FakeNode(3);
    text.nodeValue = String(value);
    return text;
  },
  documentElement: new FakeElement('html'),
  body: new FakeElement('body'),
  activeElement: null as FakeNode | null,
  defaultView: null as unknown,
});
fakeDocument.activeElement = fakeDocument.body;

const fakeWindow = {
  document: fakeDocument,
  HTMLIFrameElement: class {},
  event: undefined,
  addEventListener() {},
  removeEventListener() {},
};
fakeDocument.defaultView = fakeWindow;

/** Разметка в том же формате, что `serialize` у хоста мини-версии. */
function fakeHtml(node: FakeNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  const el = node as FakeElement;
  const attrs = Object.entries(el.attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<${el.localName}${attrs}>${el.childNodes.map(fakeHtml).join('')}</${el.localName}>`;
}

/* ─────────────────────────────── Два рендерера ─────────────────────────────── */

type ReactModule = typeof import('react');
type ClientModule = typeof import('react-dom/client');

type ServerModule = typeof import('react-dom/server');

let React: ReactModule;
let client: ClientModule;
let server: ServerModule;

/**
 * Хук инструментов разработчика — ретранслятор. `react-dom` находит хук один раз, при загрузке,
 * и дальше держит тот самый объект. Поэтому до импорта ставится постоянный ретранслятор,
 * а хук из `DEVTOOLS_CODE` (свежий на каждую проверку) подключается к нему как получатель.
 */
interface DevtoolsHook {
  inject: (renderer: unknown) => number;
  onCommitFiberRoot: (id: number, root: unknown) => void;
}
const relay = {
  injected: 0,
  target: null as DevtoolsHook | null,
  hook: {
    supportsFiber: true,
    inject(renderer: unknown) {
      relay.injected++;
      return relay.target ? relay.target.inject(renderer) : 1;
    },
    onCommitFiberRoot(id: number, root: unknown) {
      relay.target?.onCommitFiberRoot(id, root);
    },
    onCommitFiberUnmount() {},
  },
};

beforeAll(async () => {
  // До импорта `react-dom`: он проверяет наличие документа один раз, при загрузке модуля.
  Object.assign(globalThis, {
    window: fakeWindow,
    document: fakeDocument,
    IS_REACT_ACT_ENVIRONMENT: true,
    __REACT_DEVTOOLS_GLOBAL_HOOK__: relay.hook,
  });
  React = await import('react');
  client = await import('react-dom/client');
  server = await import('react-dom/server');
});

afterAll(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

interface Run {
  logs: string[];
  html: () => string;
  act: (name: string) => Promise<void> | void;
}

async function runReact(code: string): Promise<Run & { container: FakeElement; root: ReturnType<ClientModule['createRoot']> }> {
  const logs: string[] = [];
  const exposed = new Map<string, () => void>();
  const api = {
    h: React.createElement,
    useState: React.useState,
    useEffect: React.useEffect,
    useLayoutEffect: React.useLayoutEffect,
  } as unknown as ScenarioApi;
  const App = loadScenario(code, api, (line) => void logs.push(line), (name, fn) => exposed.set(name, fn));
  const container = new FakeElement('div');
  const root = client.createRoot(container as unknown as HTMLElement);
  await React.act(async () => root.render(React.createElement(App as () => null)));
  return {
    logs,
    container,
    root,
    html: () => container.childNodes.map(fakeHtml).join(''),
    act: async (name) => {
      await React.act(async () => exposed.get(name)!());
    },
  };
}

function runMini(code: string, options: JournalOptions = {}, wrap?: (host: HostConfig) => HostConfig) {
  const logs: string[] = [];
  const exposed = new Map<string, () => void>();
  const journal = createJournalHost(options);
  const mini = buildMiniReact(MINI_REACT_CODE, wrap ? wrap(journal.host) : journal.host);
  const App = loadScenario(
    code,
    { h: mini.createElement, useState: mini.useState, useEffect: mini.useEffect, useLayoutEffect: mini.useLayoutEffect },
    (line) => void logs.push(line),
    (name, fn) => exposed.set(name, fn),
  );
  mini.render(mini.createElement(App), journal.container);
  journal.drain();
  return {
    logs,
    journal,
    mini,
    exposed,
    html: journal.html,
    act: (name: string) => {
      exposed.get(name)!();
      journal.drain();
    },
  };
}

/* ─────────────────────────── Поведение: одинаково у обоих ─────────────────────────── */

describe('мини-рендерер и React 19.3 на одних и тех же сценариях', () => {
  it('первое монтирование: одна разметка и один порядок рендеров и эффектов', async () => {
    const react = await runReact(SCENARIO_MOUNT);
    const mini = runMini(SCENARIO_MOUNT);

    expect(react.logs).toEqual(EFFECTS_MOUNT_LOG);
    expect(mini.logs).toEqual(EFFECTS_MOUNT_LOG);
    expect(mini.html()).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(react.html()).toBe(mini.html());
  });

  it('первое монтирование: в контейнер уходит одна вставка — поддерево собрано вне документа', async () => {
    fakeOps.length = 0;
    const react = await runReact(SCENARIO_UPDATE);
    const intoContainer = fakeOps.filter((op) => op.parent === react.container && op.op !== 'remove');
    expect(intoContainer).toHaveLength(1);

    const mini = runMini(SCENARIO_UPDATE);
    const committed = mini.journal.ops.filter((line) => /^(appendChild|insertBefore)/.test(line));
    expect(committed).toEqual(['appendChild контейнер ← div «n = 0сосед»']);
    // Всё остальное — сборка вне документа, в render-фазе.
    expect(mini.journal.ops.filter((line) => line.startsWith('appendInitialChild')).length).toBeGreaterThan(3);
  });

  it('обновление: очистки и эффекты в одном порядке, разметка одна', async () => {
    const react = await runReact(SCENARIO_UPDATE);
    const mini = runMini(SCENARIO_UPDATE);
    react.logs.length = 0;
    mini.logs.length = 0;

    await react.act('setState');
    mini.act('setState');

    expect(react.logs).toEqual(EFFECTS_UPDATE_LOG);
    expect(mini.logs).toEqual(EFFECTS_UPDATE_LOG);
    expect(mini.html()).toBe('<div><p>n = 1</p><span>сосед</span></div>');
    expect(react.html()).toBe(mini.html());
  });

  it('обновление: из всех операций хоста — одна правка текста', () => {
    const mini = runMini(SCENARIO_UPDATE);
    mini.journal.ops.length = 0;
    mini.act('setState');
    expect(mini.journal.ops).toEqual(['commitTextUpdate «0» → «1»']);
  });

  it('три setState с функцией: один рендер и 3 — у обоих', async () => {
    const react = await runReact(SCENARIO_BATCH);
    const mini = runMini(SCENARIO_BATCH);
    react.logs.length = 0;
    mini.logs.length = 0;

    await react.act('setState');
    mini.act('setState');

    expect(react.logs).toEqual(['render App n=3']);
    expect(mini.logs).toEqual(['render App n=3']);
    expect(react.html()).toBe(mini.html());
  });

  it('три setState(n + 1): один рендер и 1 — у обоих', async () => {
    const react = await runReact(SCENARIO_BATCH);
    const mini = runMini(SCENARIO_BATCH);
    react.logs.length = 0;
    mini.logs.length = 0;

    await react.act('stale');
    mini.act('stale');

    expect(react.logs).toEqual(['render App n=1']);
    expect(mini.logs).toEqual(['render App n=1']);
  });

  it('батч в мини-версии: три setState — одна запланированная микрозадача и ноль рендеров до неё', () => {
    const scheduled: string[] = [];
    const mini = runMini(SCENARIO_BATCH, { onSchedule: (kind) => scheduled.push(kind) });
    scheduled.length = 0;
    mini.logs.length = 0;

    mini.exposed.get('setState')!();
    expect(scheduled).toEqual(['micro']);
    expect(mini.journal.pending()).toBe(1);
    expect(mini.logs).toEqual([]);

    mini.journal.drain();
    expect(mini.logs).toEqual(['render App n=3']);
  });

  it('перестановка по ключам: состояние едет с ключом, узлы те же, двигаются a и b', async () => {
    const react = await runReact(SCENARIO_KEYS);
    const reactItems = [...(react.container.childNodes[0] as FakeElement).childNodes];

    const moved: string[] = [];
    const mini = runMini(SCENARIO_KEYS, {}, (host) => ({
      ...host,
      appendChild(parent, child) {
        moved.push(`append ${(child as HostNode).children[0]?.text?.[0]}`);
        host.appendChild(parent, child);
      },
      insertBefore(parent, child, before) {
        moved.push(`insert ${(child as HostNode).children[0]?.text?.[0]}`);
        host.insertBefore(parent, child, before);
      },
    }));
    const miniItems = [...mini.journal.container.children[0].children];

    fakeOps.length = 0;
    moved.length = 0;
    await react.act('setState');
    mini.act('setState');

    const expected = '<ul><li>c · смонтирован 3-м</li><li>a · смонтирован 1-м</li><li>b · смонтирован 2-м</li></ul>';
    expect(mini.html()).toBe(expected);
    expect(react.html()).toBe(expected);

    // Те же объекты-узлы в новом порядке: ничего не пересоздано.
    const reactAfter = (react.container.childNodes[0] as FakeElement).childNodes;
    expect(reactAfter.map((n) => reactItems.indexOf(n))).toEqual([2, 0, 1]);
    const miniAfter = mini.journal.container.children[0].children;
    expect(miniAfter.map((n) => miniItems.indexOf(n))).toEqual([2, 0, 1]);

    // `lastPlacedIndex`: c остаётся, a и b едут в конец — у обоих рендереров.
    const reactMoved = fakeOps.map((op) => `${op.op} ${op.child.textContent[0]}`);
    expect(reactMoved).toEqual(['append a', 'append b']);
    expect(moved).toEqual(reactMoved);
  });

  it('удаление поддерева: очистки сверху вниз, layout раньше useEffect — у обоих', async () => {
    const react = await runReact(UNMOUNT_CODE);
    const mini = runMini(UNMOUNT_CODE);

    await react.act('hide');
    mini.act('hide');

    expect(react.logs).toEqual(UNMOUNT_LOG);
    expect(mini.logs).toEqual(UNMOUNT_LOG);
    expect(mini.html()).toBe('<div></div>');
    expect(react.html()).toBe(mini.html());
  });

  it('setState один и тот же объект между рендерами — у обоих', async () => {
    const STABLE = `const seen = [];
    function App() {
      const [n, setN] = useState(0);
      seen.push(setN);
      expose('bump', () => setN((c) => c + 1));
      expose('check', () => log(String(seen.length) + ':' + String(seen[0] === seen[seen.length - 1])));
      return h('p', null, n);
    }`;
    const react = await runReact(STABLE);
    const mini = runMini(STABLE);
    await react.act('bump');
    mini.act('bump');
    await react.act('check');
    mini.act('check');
    expect(react.logs).toEqual(['2:true']);
    expect(mini.logs).toEqual(['2:true']);
  });

  it('два useState поменялись местами: значения меняются местами у обоих, и оба молчат', async () => {
    const SWAP = `function App() {
      const [swapped, setSwapped] = useState(false);
      expose('swap', () => setSwapped(true));
      let a, b;
      if (!swapped) { a = useState('A')[0]; b = useState('B')[0]; }
      else { b = useState('B')[0]; a = useState('A')[0]; }
      return h('p', null, a + b);
    }`;
    // ⚠️ Проверка про предупреждения зависит от сборки: здесь отладочная, и молчит даже она.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const react = await runReact(SWAP);
    const mini = runMini(SWAP);
    await react.act('swap');
    mini.act('swap');

    expect(react.html()).toBe('<p>BA</p>');
    expect(mini.html()).toBe('<p>BA</p>');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

/* ────────────────────────── Намеренные отличия — зафиксированы ────────────────────────── */

describe('где мини-версия отличается от React намеренно', () => {
  /**
   * Главное упрощение мини-версии: bailout нет, рендер идёт от корня. React начинает
   * с фибера, где звали `setState`, и соседнее поддерево не трогает. Разметка при этом
   * одинакова — лишние вызовы у мини-версии ничего не правят в хосте.
   */
  it('нет bailout: мини-версия вызывает App и соседа, React — только Counter', async () => {
    const react = await runReact(NO_BAILOUT_CODE);
    const mini = runMini(NO_BAILOUT_CODE);
    react.logs.length = 0;
    mini.logs.length = 0;
    mini.journal.ops.length = 0;

    await react.act('bump');
    mini.act('bump');

    expect(mini.logs).toEqual(NO_BAILOUT_LOG.mini);
    expect(react.logs).toEqual(NO_BAILOUT_LOG.react);
    expect(react.html()).toBe(mini.html());
    expect(mini.journal.ops).toEqual(['commitTextUpdate «0» → «1»']);
  });

  /** Хуков стало больше: React бросает, мини-версия молча выдаёт новую ячейку. */
  it('лишний хук под условием: React бросает, мини-версия нет', async () => {
    const GROW = `function App() {
      const [on, setOn] = useState(false);
      expose('grow', () => setOn(true));
      if (on) useState('лишний');
      return h('p', null, String(on));
    }`;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const react = await runReact(GROW);
    await expect(react.act('grow')).rejects.toThrow('Rendered more hooks than during the previous render');
    errors.mockRestore();

    const mini = runMini(GROW);
    expect(() => mini.act('grow')).not.toThrow();
    expect(mini.html()).toBe('<p>true</p>');
  });

  /** Элемент: у React есть метка `$$typeof`, а одиночный текст остаётся строкой. */
  it('элемент: React не заворачивает текст и ставит $$typeof', () => {
    expect(STEP_ELEMENT).toContain('function createElement');
    const mini = runMini(SCENARIO_MOUNT).mini;

    const real = React.createElement('p', null, 'текст') as unknown as { $$typeof: symbol; props: { children: unknown } };
    expect(real.$$typeof).toBe(Symbol.for('react.transitional.element'));
    expect(real.props.children).toBe('текст');

    const ours = mini.createElement('p', null, 'текст') as { props: { children: Array<{ type: string; props: { nodeValue: string } }> } };
    expect(ours.props.children).toHaveLength(1);
    expect(ours.props.children[0].type).toBe('TEXT');
    expect(ours.props.children[0].props.nodeValue).toBe('текст');
  });
});

/* ────────────────────────────── Прерывание ────────────────────────────── */

describe('прерываемость мини-версии', () => {
  it('квант в один файбер даёт ту же разметку и тот же лог, что рендер одним куском', () => {
    for (const scenario of DEMO_SCENARIOS) {
      let used = false;
      const whole = runMini(scenario.code);
      const sliced = runMini(scenario.code, {
        shouldYield: () => {
          if (used) {
            used = false;
            return true;
          }
          used = true;
          return false;
        },
      });
      expect(sliced.html(), scenario.key).toBe(whole.html());
      expect(sliced.logs, scenario.key).toEqual(whole.logs);
      if (scenario.action) {
        whole.act(scenario.action.name);
        sliced.act(scenario.action.name);
        expect(sliced.html(), scenario.key).toBe(whole.html());
        expect(sliced.logs, scenario.key).toEqual(whole.logs);
      }
    }
  });

  it('setState посреди нарезанного рендера: функция вызвана дважды, закоммичен один результат', () => {
    let used = false;
    const mini = runMini(SCENARIO_UPDATE, {
      shouldYield: () => {
        if (used) {
          used = false;
          return true;
        }
        used = true;
        return false;
      },
    });
    mini.logs.length = 0;

    const bump = mini.exposed.get('setState')!;
    bump();
    // Крутим цикл, пока Counter не отрендерится с n=1, — и обновляем ещё раз посреди рендера.
    let guard = 0;
    while (!mini.logs.includes('render Counter n=1') && guard++ < 100) mini.journal.runOne();
    expect(mini.logs).toEqual(['render Counter n=1']);
    bump();
    mini.journal.drain();

    expect(mini.logs).toEqual([
      'render Counter n=1', // выброшен: коммита с n=1 не было
      'render Counter n=2',
      'cleanup layout n=0',
      'layout n=2',
      'cleanup effect n=0',
      'effect n=2',
    ]);
    expect(mini.html()).toBe('<div><p>n = 2</p><span>сосед</span></div>');
  });
});

/* ─────────────────────────────── Модель демо ─────────────────────────────── */

describe('модель демо mini-fiber', () => {
  it('у каждого сценария с кнопкой есть такая ручка', () => {
    for (const scenario of DEMO_SCENARIOS.filter((s) => s.action)) {
      const mini = runMini(scenario.code);
      expect(mini.exposed.has(scenario.action!.name), scenario.key).toBe(true);
    }
  });

  it('протокол детерминирован: два прогона дают одинаковые кадры', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const a = createSession(MINI_REACT_CODE, scenario);
      const b = createSession(MINI_REACT_CODE, scenario);
      if (scenario.action) {
        a.act(scenario.action.name);
        b.act(scenario.action.name);
      }
      expect(a.frames.length, scenario.key).toBeGreaterThan(5);
      expect(JSON.stringify(a.frames), scenario.key).toBe(JSON.stringify(b.frames));
    }
  });

  it('последний кадр показывает то же, что рендер без демо', () => {
    for (const scenario of DEMO_SCENARIOS) {
      const session = createSession(MINI_REACT_CODE, scenario);
      const plain = runMini(scenario.code);
      if (scenario.action) {
        session.act(scenario.action.name);
        plain.act(scenario.action.name);
      }
      expect(session.frames.at(-1)!.html, scenario.key).toBe(plain.html());
      expect(session.logs, scenario.key).toEqual(plain.logs);
    }
  });

  it('фазы идут по порядку: render → commit → passive, и коммит один на обновление', () => {
    const session = createSession(MINI_REACT_CODE, DEMO_SCENARIOS.find((s) => s.key === 'mount')!);
    const phases = session.frames.map((f) => f.phase).filter((p) => p !== 'event');
    const firstCommit = phases.indexOf('commit');
    const firstPassive = phases.indexOf('passive');
    expect(firstCommit).toBeGreaterThan(0);
    expect(phases.slice(0, firstCommit).every((p) => p === 'render')).toBe(true);
    expect(firstPassive).toBeGreaterThan(firstCommit);
    expect(session.frames.at(-1)!.commits).toBe(1);
    // Во время рендера на экране пусто: DOM-операции коммита ещё не начались.
    const lastRender = session.frames.filter((f) => f.phase === 'render').at(-1)!;
    expect(lastRender.html).toBe('');
  });

  it('батч в демо: одна микрозадача, один вызов функции, очередь 3 до рендера и 0 после', () => {
    const session = createSession(MINI_REACT_CODE, DEMO_SCENARIOS.find((s) => s.key === 'batch')!);
    const before = session.frames.at(-1)!;
    const start = session.act('setState');
    const after = session.frames.slice(start);

    expect(after.filter((f) => f.kind === 'schedule' && f.text.includes('микрозадача'))).toHaveLength(1);
    expect(session.frames.at(-1)!.calls - before.calls).toBe(1);

    const handlerDone = after.find((f) => f.text.startsWith('обработчик закончился'))!;
    const appRow = handlerDone.current.find((row) => row.label === 'App')!;
    expect(appRow.hooks[0]).toBe('useState = 0 · в очереди 3');
    const finalApp = session.frames.at(-1)!.current.find((row) => row.label === 'App')!;
    expect(finalApp.hooks[0]).toBe('useState = 3');
  });

  it('двойная буферизация видна в демо: третий рендер пишет в объекты первого', () => {
    const session = createSession(MINI_REACT_CODE, DEMO_SCENARIOS.find((s) => s.key === 'update')!);
    const idsAt = () => session.frames.at(-1)!.current.map((row) => row.id);
    const first = idsAt();
    session.act('setState');
    const second = idsAt();
    session.act('setState');
    const third = idsAt();

    expect(second).not.toEqual(first);
    expect(third).toEqual(first);
    expect(session.frames.at(-1)!.current.every((row) => row.alt !== null)).toBe(true);
  });
});

/* ─────────────────── Гидратация и инструменты разработчика ─────────────────── */

/** Разметка из `renderToString` — в поддельный документ. Хватает тегов без атрибутов и текста. */
function parseInto(container: FakeElement, html: string) {
  const stack: FakeNode[] = [container];
  for (const [, close, tag, text] of html.matchAll(/<(\/)?([a-z]+)>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (text) top.appendChild(fakeDocument.createTextNode(text));
    else if (close) stack.pop();
    else stack.push(top.appendChild(new FakeElement(tag)));
  }
}

describe('за пределами мини-версии: гидратация и DevTools на настоящем React', () => {
  /**
   * Строка `DIFF` «Гидратация»: файберы поверх готовой разметки, функции и эффекты — все,
   * новых узлов — ноль. Лог дословно `EFFECTS_MOUNT_LOG`: гидратация — то же первое
   * монтирование, только узлы не создаются, а забираются.
   */
  it('hydrateRoot: лог как у монтирования, узлов не создано, прежние узлы на месте', async () => {
    const logs: string[] = [];
    const api = {
      h: React.createElement,
      useState: React.useState,
      useEffect: React.useEffect,
      useLayoutEffect: React.useLayoutEffect,
    } as unknown as ScenarioApi;
    const App = loadScenario(SCENARIO_MOUNT, api, (line) => void logs.push(line), () => {}) as () => null;

    const html = server.renderToString(React.createElement(App));
    expect(html).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(logs).toEqual(['render App', 'render Item a', 'render Item b']);   // на сервере — без эффектов
    logs.length = 0;

    const container = new FakeElement('div');
    parseInto(container, html);
    const ul = container.childNodes[0];
    const items = [...ul.childNodes];

    const created: string[] = [];
    const { createElement, createTextNode } = fakeDocument;
    fakeDocument.createElement = (tag: string) => (created.push(tag), createElement(tag));
    fakeDocument.createTextNode = (text: string) => (created.push('#text'), createTextNode(text));
    const errors: unknown[] = [];
    try {
      await React.act(async () => {
        client.hydrateRoot(container as unknown as HTMLElement, React.createElement(App), {
          onRecoverableError: (error) => void errors.push(error),
        });
      });
    } finally {
      fakeDocument.createElement = createElement;
      fakeDocument.createTextNode = createTextNode;
    }

    expect(errors).toEqual([]);   // иначе React молча перерисовал бы всё с нуля
    expect(logs).toEqual(EFFECTS_MOUNT_LOG);
    expect(created).toEqual([]);
    expect(container.childNodes[0]).toBe(ul);
    expect([...ul.childNodes]).toEqual(items);
  });

  it('DEVTOOLS_CODE: react-dom представился один раз, вывод на двух обновлениях — DEVTOOLS_LOG', async () => {
    expect(relay.injected).toBe(1);   // при загрузке react-dom, а не на каждый корень

    const logs: string[] = [];
    const fakeWin: Record<string, unknown> = {};
    new Function('window', 'log', DEVTOOLS_CODE)(fakeWin, (line: string) => void logs.push(line));
    const hook = fakeWin.__REACT_DEVTOOLS_GLOBAL_HOOK__ as DevtoolsHook & { supportsFiber: boolean };
    expect(hook.supportsFiber).toBe(true);
    expect(hook.inject({})).toBe(1);

    relay.target = hook;
    try {
      const react = await runReact(SCENARIO_UPDATE);
      await react.act('setState');
      await react.act('setState');
    } finally {
      relay.target = null;
    }
    expect(logs).toEqual(DEVTOOLS_LOG);
  });
});
