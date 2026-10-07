import type { DispatchResult, ListenerSpec, LogEntry, Scenario } from './types';

/**
 * Сценарий темы — в настоящем DOM.
 *
 * Один и тот же модуль исполняют три стороны: демо (в скрытом `iframe` браузера читателя),
 * `tests/unit/dom-events.test.ts` (в окне happy-dom) и стенд темы (в Chromium из Playwright —
 * модуль собирается esbuild и вставляется в страницу). Поэтому здесь нет ни Vue, ни
 * глобальных `window`/`document`: окно приходит параметром.
 */

/** Подпись узла: `window`, `document`, `#shadow-root`, `li`, `button.del`. */
export function label(n: unknown): string | null {
  if (n == null) return null;
  const o = n as { nodeType?: number; document?: unknown; tagName?: string; className?: unknown };
  if (o.document && !o.nodeType) return 'window';
  if (o.nodeType === 9) return 'document';
  if (o.nodeType === 11) return '#shadow-root';
  const cls = typeof o.className === 'string' && o.className ? `.${o.className.split(' ')[0]}` : '';
  return `${String(o.tagName).toLowerCase()}${cls}`;
}

export interface Fixture {
  html: string;
  shadowHtml: string;
}

interface Mounted {
  /** Подпись → узел. Теневой корень и его содержимое — тоже, даже у закрытого корня. */
  nodes: Map<string, EventTarget>;
}

export function mountFixture(win: Window, fixture: Fixture, mode: 'open' | 'closed'): Mounted {
  const doc = win.document;
  doc.body.innerHTML = fixture.html;
  const host = doc.querySelector('like-button') as HTMLElement;
  const root = host.attachShadow({ mode });
  root.innerHTML = fixture.shadowHtml;

  const nodes = new Map<string, EventTarget>();
  nodes.set('window', win);
  nodes.set('document', doc);
  nodes.set('#shadow-root', root);
  for (const el of [doc.documentElement, doc.body, ...doc.body.querySelectorAll('*'), ...root.querySelectorAll('*')]) {
    const name = label(el);
    if (name && !nodes.has(name)) nodes.set(name, el);
  }
  return { nodes };
}

function makeEvent(win: Window, spec: Scenario['event']): Event {
  const init = { bubbles: spec.bubbles, cancelable: spec.cancelable, composed: spec.composed };
  const w = win as unknown as Record<string, typeof Event>;
  const Ctor = spec.type === 'click' ? w.MouseEvent : spec.type === 'wheel' ? w.WheelEvent : w.Event;
  return new Ctor(spec.type, init);
}

/** Повесить слушателей сценария; `onEntry` получает запись журнала после каждого вызова. */
export function attachListeners(
  mounted: Mounted,
  s: Scenario,
  onEntry: (spec: ListenerSpec, e: Event) => void,
): void {
  const callbacks = new Map<string, { at: EventTarget; cb: (e: Event) => void; capture: boolean }>();
  for (const spec of s.listeners) {
    const at = mounted.nodes.get(spec.at);
    if (!at) throw new Error(`Нет узла ${spec.at}`);
    const cb = (e: Event) => {
      if (spec.act === 'stop') e.stopPropagation();
      if (spec.act === 'stopImmediate') e.stopImmediatePropagation();
      if (spec.act === 'prevent') e.preventDefault();
      if (spec.act === 'detachLi') (mounted.nodes.get('li') as Element).remove();
      if (spec.act === 'removeL3') {
        const l3 = callbacks.get('L3');
        if (l3) l3.at.removeEventListener(s.event.type, l3.cb, { capture: l3.capture });
      }
      onEntry(spec, e);
    };
    callbacks.set(spec.id, { at, cb, capture: !!spec.capture });
    const opts: AddEventListenerOptions = { capture: !!spec.capture, once: !!spec.once };
    if (spec.passive !== undefined) opts.passive = spec.passive;
    at.addEventListener(s.event.type, cb, opts);
  }
}

/** Исполнить сценарий синтетической отправкой: `dispatchEvent`, как в модели. */
export function runInDom(win: Window, fixture: Fixture, s: Scenario): DispatchResult {
  const mounted = mountFixture(win, fixture, s.shadow);
  const result: DispatchResult = { log: [], returned: [], defaultPrevented: [], targetAfter: [] };
  let run = 0;
  attachListeners(mounted, s, (spec, e) => {
    result.log.push(entry(run, spec, e));
  });
  const target = mounted.nodes.get(s.target);
  if (!target) throw new Error(`Нет цели ${s.target}`);
  for (; run < (s.times ?? 1); run++) {
    const e = makeEvent(win, s.event);
    result.returned.push(target.dispatchEvent(e));
    result.defaultPrevented.push(e.defaultPrevented);
    result.targetAfter.push(label(e.target));
  }
  return result;
}

export function entry(run: number, spec: ListenerSpec, e: Event): LogEntry {
  return {
    run,
    id: spec.id,
    currentTarget: label(e.currentTarget) ?? '',
    eventPhase: e.eventPhase,
    target: label(e.target) ?? '',
    path: e.composedPath().map((n) => label(n) ?? ''),
    prevented: e.defaultPrevented,
  };
}
