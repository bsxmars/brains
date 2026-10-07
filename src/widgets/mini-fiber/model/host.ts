import type { HostConfig } from './build';
import type { HostNode } from './types';

/**
 * Хост-журнал: «DOM» из обычных объектов, который записывает каждую заказанную операцию.
 *
 * Рендерер темы про документ не знает ничего — он зовёт функции host config. Этот хост
 * исполняет их над деревом объектов и пишет строку в журнал. Поэтому один и тот же рендерер
 * работает и в тесте (Node, DOM нет), и в демо — в браузере, но тоже без DOM: на экран едет
 * журнал и сериализованное дерево, а не узлы документа.
 *
 * Планирование здесь тоже своё. Микрозадачи и задачи кладутся в две очереди и разбираются
 * `drain()` строго по правилу цикла событий: пока есть микрозадачи — они, потом одна задача.
 * Настоящие `queueMicrotask` и `setTimeout` дали бы то же, но асинхронно, — а демо и тесту
 * нужен детерминированный прогон, который можно пройти по шагам и повторить.
 */

export interface JournalOptions {
  /** Каждая операция хоста — строкой, в момент выполнения. */
  onOp?: (line: string) => void;
  /** Что-то поставлено в очередь: `micro` — микрозадача, `task` — задача. */
  onSchedule?: (kind: 'micro' | 'task', name: string) => void;
  /** Пора ли отдать поток. По умолчанию — никогда: рендер идёт одним куском. */
  shouldYield?: () => boolean;
}

export interface JournalHost {
  host: HostConfig;
  container: HostNode;
  ops: string[];
  /** Разобрать очереди до конца. Возвращает, сколько колбэков выполнено. */
  drain: () => number;
  /** Выполнить один колбэк по правилу цикла событий; `false` — очереди пусты. */
  runOne: () => boolean;
  /** Микро- и макрозадачи, ещё не выполненные. */
  pending: () => number;
  /** Содержимое контейнера разметкой — для сравнения с настоящим React. */
  html: () => string;
}

/** Страховка от бесконечного перепланирования: демо не имеет права повесить вкладку. */
const DRAIN_LIMIT = 10_000;

const node = (tag: string): HostNode => ({ tag, attrs: {}, children: [], parent: null });

/** Строковые свойства становятся атрибутами; `className` — `class`, как у React DOM. */
function applyProps(target: HostNode, props: Record<string, unknown>) {
  target.attrs = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value == null || typeof value === 'function' || typeof value === 'object') continue;
    target.attrs[key === 'className' ? 'class' : key] = String(value);
  }
}

function textOf(target: HostNode): string {
  return target.tag === '#text' ? (target.text ?? '') : target.children.map(textOf).join('');
}

/** Как узел назван в журнале: `li «a»` понятнее, чем `li`, когда их в списке три. */
export function labelOf(target: HostNode): string {
  const text = textOf(target);
  const short = text.length > 14 ? `${text.slice(0, 13)}…` : text;
  if (target.tag === '#text') return `«${short}»`;
  return short ? `${target.tag} «${short}»` : target.tag;
}

export function serialize(target: HostNode): string {
  if (target.tag === '#text') return target.text ?? '';
  const attrs = Object.entries(target.attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<${target.tag}${attrs}>${target.children.map(serialize).join('')}</${target.tag}>`;
}

function detach(child: HostNode) {
  const parent = child.parent;
  if (!parent) return;
  parent.children.splice(parent.children.indexOf(child), 1);
  child.parent = null;
}

export function createJournalHost(options: JournalOptions = {}): JournalHost {
  const ops: string[] = [];
  const micro: Array<() => void> = [];
  const tasks: Array<() => void> = [];
  const container = node('div');
  container.attrs = { id: 'root' };

  const record = (line: string) => {
    ops.push(line);
    options.onOp?.(line);
  };

  const host: HostConfig = {
    createInstance(type, props) {
      const created = node(type);
      applyProps(created, props);
      record(`createInstance ${type}`);
      return created;
    },
    createTextInstance(text) {
      const created = node('#text');
      created.text = text;
      record(`createTextInstance «${text}»`);
      return created;
    },
    appendInitialChild(parent, child) {
      const p = parent as HostNode;
      const c = child as HostNode;
      detach(c);
      p.children.push(c);
      c.parent = p;
      record(`appendInitialChild ${labelOf(p)} ← ${labelOf(c)}`);
    },
    appendChild(parent, child) {
      const p = parent as HostNode;
      const c = child as HostNode;
      detach(c);
      p.children.push(c);
      c.parent = p;
      record(`appendChild ${p === container ? 'контейнер' : labelOf(p)} ← ${labelOf(c)}`);
    },
    insertBefore(parent, child, before) {
      const p = parent as HostNode;
      const c = child as HostNode;
      detach(c);
      p.children.splice(p.children.indexOf(before as HostNode), 0, c);
      c.parent = p;
      record(`insertBefore ${labelOf(c)} → перед ${labelOf(before as HostNode)}`);
    },
    removeChild(parent, child) {
      const c = child as HostNode;
      const label = labelOf(c);
      detach(c);
      record(`removeChild ${label}`);
    },
    commitUpdate(target, type, _prev, next) {
      applyProps(target as HostNode, next);
      record(`commitUpdate ${type}`);
    },
    commitTextUpdate(target, prev, next) {
      (target as HostNode).text = next;
      record(`commitTextUpdate «${prev}» → «${next}»`);
    },
    scheduleMicrotask(callback) {
      micro.push(callback);
      options.onSchedule?.('micro', callback.name);
    },
    scheduleTask(callback) {
      tasks.push(callback);
      options.onSchedule?.('task', callback.name);
    },
    shouldYield: options.shouldYield ?? (() => false),
  };

  const runOne = () => {
    const next = micro.length ? micro.shift() : tasks.shift();
    if (!next) return false;
    next();
    return true;
  };

  const drain = () => {
    let done = 0;
    while (runOne()) {
      if (++done >= DRAIN_LIMIT) throw new Error(`очередь хоста не опустела за ${DRAIN_LIMIT} колбэков`);
    }
    return done;
  };

  return {
    host,
    container,
    ops,
    drain,
    runOne,
    pending: () => micro.length + tasks.length,
    html: () => container.children.map(serialize).join(''),
  };
}
