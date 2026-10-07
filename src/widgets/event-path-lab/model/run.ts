import type { DispatchApi, DispatchResult, ListenerSpec, LogEntry, ModelEvent, ModelNode, Scenario } from './types';

/**
 * Демо и тест спрашивают одну и ту же функцию — строку `DISPATCH_CODE` из темы.
 *
 * Строка напечатана на странице, собрана здесь `new Function` и прогоняется
 * `tests/unit/dom-events.test.ts` против журналов Chromium со стенда (литералы в `data.ts`)
 * и против happy-dom. Копии нет — если показанный код разойдётся с браузером, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadDispatch(code: string): DispatchApi {
  return new Function(
    `${code}\nreturn { node, attachShadow, createEvent, addEventListener, removeEventListener, dispatch };`,
  )() as DispatchApi;
}

/**
 * Дерево модели — то же, что строит `FIXTURE_HTML` темы: окно, документ, `html`, `body`,
 * список дел с кнопкой и `like-button` с теневым корнем. Тест сверяет его с деревом,
 * которое из той же разметки строит happy-dom.
 */
export function buildModelTree(api: DispatchApi, mode: 'open' | 'closed'): Map<string, ModelNode> {
  const win = api.node('window', null, 'window');
  const doc = api.node('document', null, 'document');
  doc.window = win;
  const html = api.node('html', doc);
  const body = api.node('body', html);
  const ul = api.node('ul.todos', body);
  const li = api.node('li', ul);
  const button = api.node('button.del', li);
  const b = api.node('b', button);
  const host = api.node('like-button', body);
  const root = api.attachShadow(host, mode);
  const heart = api.node('button.heart', root);
  const all = [win, doc, html, body, ul, li, button, b, host, root, heart];
  return new Map(all.map((n) => [n.name, n]));
}

/** Тот же сценарий, что `runInDom`, — на учебной модели. Формат результата один. */
export function runInModel(api: DispatchApi, s: Scenario): DispatchResult {
  const nodes = buildModelTree(api, s.shadow);
  const result: DispatchResult = { log: [], returned: [], defaultPrevented: [], targetAfter: [] };
  let run = 0;
  const callbacks = new Map<string, { at: ModelNode; cb: (e: ModelEvent) => void; capture: boolean }>();

  for (const spec of s.listeners) {
    const at = nodes.get(spec.at);
    if (!at) throw new Error(`Нет узла ${spec.at}`);
    const cb = (e: ModelEvent) => {
      if (spec.act === 'stop') e.stopPropagation();
      if (spec.act === 'stopImmediate') e.stopImmediatePropagation();
      if (spec.act === 'prevent') e.preventDefault();
      if (spec.act === 'detachLi') nodes.get('li')!.parent = null;
      if (spec.act === 'removeL3') {
        const l3 = callbacks.get('L3');
        if (l3) api.removeEventListener(l3.at, s.event.type, l3.cb, { capture: l3.capture });
      }
      result.log.push(entry(run, spec, e));
    };
    callbacks.set(spec.id, { at, cb, capture: !!spec.capture });
    api.addEventListener(at, s.event.type, cb, {
      capture: !!spec.capture,
      once: !!spec.once,
      ...(spec.passive === undefined ? {} : { passive: spec.passive }),
    });
  }

  const target = nodes.get(s.target);
  if (!target) throw new Error(`Нет цели ${s.target}`);
  for (; run < (s.times ?? 1); run++) {
    const e = api.createEvent(s.event.type, s.event);
    result.returned.push(api.dispatch(target, e));
    result.defaultPrevented.push(e.defaultPrevented);
    result.targetAfter.push(e.target ? e.target.name : null);
  }
  return result;
}

function entry(run: number, spec: ListenerSpec, e: ModelEvent): LogEntry {
  return {
    run,
    id: spec.id,
    currentTarget: e.currentTarget?.name ?? '',
    eventPhase: e.eventPhase,
    target: e.target?.name ?? '',
    path: e.composedPath().map((n) => n.name),
    prevented: e.defaultPrevented,
  };
}

/** Журнал строками — так литералы стенда лежат в `data.ts`: `0:L1 window 1 b | путь`. */
export function formatLog(r: DispatchResult): string[] {
  return r.log.map(
    (e) => `${e.run}:${e.id} ${e.currentTarget} ${e.eventPhase} ${e.target}${e.prevented ? ' prevented' : ''} | ${e.path.join(' ')}`,
  );
}
