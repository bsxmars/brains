import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/dom-events/data';
import { label, runInDom, type Fixture } from '@/widgets/event-path-lab/model/dom';
import { buildModelTree, formatLog, loadDispatch, runInModel } from '@/widgets/event-path-lab/model/run';
import type { DispatchResult, ModelEvent, Scenario } from '@/widgets/event-path-lab/model/types';

/**
 * Тема «События DOM: захват, всплытие и делегирование».
 *
 * `DISPATCH_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * прогоняется по всем сценариям и сверяется с журналами Chromium 153 со стенда (литералы
 * `STAND_LOGS`, см. шапку `data.ts`). Браузер в тесте не поднимается.
 *
 * Те же сценарии исполняет happy-dom — тем же модулем `dom.ts`, что и стенд, и демо. Где он
 * совпал с Chromium, проверяется совпадение; где нет — проверяется **именно то расхождение**,
 * что записано в `HAPPY_ROWS`. Починят в happy-dom — покраснеет здесь, и таблицу в теме надо
 * будет поправить.
 */

const api = loadDispatch(t.DISPATCH_CODE);
const fixture: Fixture = { html: t.FIXTURE_HTML, shadowHtml: t.SHADOW_HTML };
const byId = (id: string): Scenario => {
  const s = t.SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s;
};

function asStand(r: DispatchResult): t.StandLog {
  return { log: formatLog(r), returned: r.returned, defaultPrevented: r.defaultPrevented, targetAfter: r.targetAfter };
}

function happy(s: Scenario): t.StandLog {
  const win = new Window();
  try {
    return asStand(runInDom(win as unknown as globalThis.Window, fixture, s));
  } finally {
    void win.happyDOM.close();
  }
}

/** Сценарии, в которых happy-dom 20.14.5 расходится с Chromium. */
const HAPPY_DIFFERS = ['phases', 'passive', 'mutate', 'shadow-open', 'shadow-closed', 'uncomposed'];

describe('DISPATCH_CODE против Chromium на стенде', () => {
  it('стенд покрывает все сценарии темы', () => {
    expect(Object.keys(t.STAND_LOGS).sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
    expect(t.SCENARIOS).toHaveLength(13);
    expect(t.DEMO_CAPTION).toContain('тринадцати');
  });

  it.each(t.SCENARIOS.map((s) => [s.id, s] as const))('%s', (id, s) => {
    expect(asStand(runInModel(api, s))).toEqual(t.STAND_LOGS[id]);
  });

  it('настоящий клик дал тот же журнал во всех сценариях с click', () => {
    const clicks = t.SCENARIOS.filter((s) => s.event.type === 'click').map((s) => s.id);
    expect(t.REAL_CLICK_SAME).toEqual(clicks);
    expect(clicks).toHaveLength(9);
  });

  it('дерево модели — то же, что строит из FIXTURE_HTML настоящий DOM', () => {
    const win = new Window();
    const doc = win.document;
    doc.body.innerHTML = t.FIXTURE_HTML;
    const root = doc.querySelector('like-button')!.attachShadow({ mode: 'open' });
    root.innerHTML = t.SHADOW_HTML;
    const real = new Map<string, string | null>();
    for (const el of [doc.body, ...doc.body.querySelectorAll('*'), ...root.querySelectorAll('*')]) {
      real.set(label(el)!, label(el.parentNode));
    }
    real.set('#shadow-root', null);
    real.set('html', 'document');
    const model = buildModelTree(api, 'open');
    for (const [name, parent] of real) {
      expect(model.get(name)?.parent?.name ?? null, name).toBe(parent);
    }
    expect(model.get('#shadow-root')?.host?.name).toBe('like-button');
    expect(t.SHADOW_CODE).toContain(t.SHADOW_HTML);
    void win.happyDOM.close();
  });
});

describe('утверждения текста закрыты журналами', () => {
  it('три фазы: путь из 8 узлов, захват сверху, на цели L10 раньше L9', () => {
    const rows = t.PHASE_ROWS;
    expect(rows.map((r) => r.id)).toEqual(['L1', 'L3', 'L5', 'L7', 'L10', 'L9', 'L8', 'L6', 'L4', 'L2']);
    expect(rows[4]).toMatchObject({ id: 'L10', node: 'b', phase: '2 — цель', capture: '`capture: true`' });
    expect(t.STAND_LOGS.phases.log[0]).toContain('| b button.del li ul.todos body html document window');
    expect(t.PATH_STEPS[0].d).toContain('`b → button.del → li → ul.todos → body → html → document → window`');
  });

  it('bubbles: false — захват на предках есть, всплытия нет; focus ведёт себя так же', () => {
    const ids = t.STAND_LOGS['no-bubble'].log.map((l) => l.split(' ')[0]);
    expect(ids).toEqual(['0:L1', '0:L2', '0:L3']);
    expect(t.FOCUS_STAND).toEqual(['focus захват', 'focusin захват', 'focusin всплытие']);
  });

  it('остановки, отмена, once, правка во время отправки', () => {
    const ids = (id: string) => t.STAND_LOGS[id].log.map((l) => l.split(' ')[0].split(':')[1]);
    expect(ids('stop')).toEqual(['L1', 'L2']);
    expect(ids('stop-immediate')).toEqual(['L1']);
    expect(ids('stop-capture')).toEqual(['L1', 'L2']);
    expect(t.STAND_LOGS.prevent.returned).toEqual([false]);
    expect(t.STAND_LOGS.prevent.log[1]).toContain('document 3 b prevented');
    expect(t.STAND_LOGS['not-cancelable'].defaultPrevented).toEqual([false]);
    expect(t.STAND_LOGS.passive.defaultPrevented).toEqual([false]);
    expect(t.STAND_LOGS.once.log.map((l) => l.split(' ')[0])).toEqual(['0:L1', '0:L2', '1:L2']);
    expect(ids('mutate')).toEqual(['L1', 'L2', 'L4']);
    expect(t.STAND_LOGS.mutate.log[2]).toContain('li ul.todos');
  });

  it('Shadow DOM: подмена цели, фаза хозяина, закрытый путь, target после отправки', () => {
    const open = t.STAND_LOGS['shadow-open'];
    expect(open.log[2]).toMatch(/^0:L3 like-button 2 like-button \|/);
    expect(open.log[3]).toMatch(/^0:L4 document 3 like-button \|/);
    expect(open.log[3].split(' | ')[1].split(' ')).toHaveLength(7);
    expect(t.STAND_LOGS['shadow-closed'].log[3].split(' | ')[1]).toBe('like-button body html document window');
    expect(open.targetAfter).toEqual(['like-button']);
    expect(t.STAND_LOGS.uncomposed.targetAfter).toEqual([null]);
    expect(t.STAND_LOGS.uncomposed.log).toHaveLength(2);
  });

  it('пассивность по умолчанию в модели — на window, document, html, body и больше нигде', () => {
    const prevented = (name: string, type: string) => {
      const nodes = buildModelTree(api, 'open');
      let dp = false;
      api.addEventListener(nodes.get(name)!, type, (e: ModelEvent) => {
        e.preventDefault();
        dp = e.defaultPrevented;
      });
      api.dispatch(nodes.get('b')!, api.createEvent(type, { bubbles: true, cancelable: true }));
      return dp;
    };
    for (const name of ['window', 'document', 'html', 'body']) {
      expect(prevented(name, 'wheel'), name).toBe(false);
    }
    expect(prevented('ul.todos', 'wheel')).toBe(true);
    expect(prevented('document', 'touchmove')).toBe(false);
    expect(prevented('document', 'click')).toBe(true);
    expect(t.PASSIVE_ROWS[3].k).toContain('`html`');
  });

  it('модель: signal, уже отменённый, слушателя не добавляет; дубль пропускается', () => {
    const n = api.node('x', null);
    const log: string[] = [];
    const ac = new AbortController();
    api.addEventListener(n, 'ping', () => log.push('a'), { signal: ac.signal });
    api.dispatch(n, api.createEvent('ping'));
    ac.abort();
    api.dispatch(n, api.createEvent('ping'));
    api.addEventListener(n, 'ping', () => log.push('поздно'), { signal: ac.signal });
    const same = () => log.push('same');
    api.addEventListener(n, 'ping', same);
    api.addEventListener(n, 'ping', same);
    api.dispatch(n, api.createEvent('ping'));
    expect(log).toEqual(['a', 'same']);
  });

  it('учебная функция — сто сорок строк, как сказано в тексте', () => {
    expect(t.DISPATCH_CODE.split('\n')).toHaveLength(140);
    expect(t.DISPATCH_NOTE).toContain('Сто сорок строк');
  });
});

describe('happy-dom 20.14.5 против Chromium', () => {
  it.each(t.SCENARIOS.filter((s) => !HAPPY_DIFFERS.includes(s.id)).map((s) => [s.id, s] as const))(
    'совпадает: %s',
    (id, s) => {
      expect(happy(s)).toEqual(t.STAND_LOGS[id]);
    },
  );

  it('расходится ровно там, где записано в HAPPY_ROWS', () => {
    for (const id of HAPPY_DIFFERS) expect(happy(byId(id)), id).not.toEqual(t.STAND_LOGS[id]);

    // захват на самой цели: eventPhase 1 вместо 2
    expect(happy(byId('phases')).log[4]).toMatch(/^0:L10 b 1 b /);
    // wheel на body без опций отменяет
    expect(happy(byId('passive')).defaultPrevented).toEqual([true]);
    // composedPath() после удаления li пересчитан
    expect(happy(byId('mutate')).log[2].split(' | ')[1]).toBe('b button.del li');
    // нет подмены цели
    const open = happy(byId('shadow-open'));
    expect(open.log[3]).toMatch(/^0:L4 document 3 button\.heart /);
    // закрытый путь не обрезан
    expect(happy(byId('shadow-closed')).log[3].split(' | ')[1].split(' ')).toHaveLength(7);
    // target после отправки не обнулён
    expect(happy(byId('uncomposed')).targetAfter).toEqual(['button.heart']);
    expect(t.HAPPY_ROWS).toHaveLength(10);
    // «тот же журнал в семи случаях из тринадцати» — в index.mdx темы
    expect(t.SCENARIOS.length - HAPPY_DIFFERS.length).toBe(7);
  });

  it('isTrusted, отменённый signal, повторная отправка, путь после отправки', () => {
    const win = new Window();
    const doc = win.document;
    const btn = doc.createElement('button');
    doc.body.append(btn);
    let trusted: unknown = 'не вызван';
    btn.addEventListener('click', (e) => (trusted = (e as unknown as { isTrusted: unknown }).isTrusted));
    btn.click();
    expect(trusted).toBeUndefined();

    const ac = new win.AbortController();
    ac.abort();
    const log: string[] = [];
    btn.addEventListener('ping', () => log.push('добавлен'), { signal: ac.signal });
    btn.dispatchEvent(new win.Event('ping'));
    expect(log).toEqual(['добавлен']);

    let saved: Event | undefined;
    let depth = 0;
    let error = '';
    btn.addEventListener('pong', (e) => {
      saved = e as unknown as Event;
      depth++;
      try {
        btn.dispatchEvent(e);
      } catch (err) {
        error ||= (err as Error).name;
      }
    });
    btn.dispatchEvent(new win.Event('pong'));
    expect(error).toBe('RangeError');
    expect(depth).toBeGreaterThan(100);
    expect(saved?.currentTarget).toBeNull();
    expect(saved?.composedPath().length).toBeGreaterThan(0);
    void win.happyDOM.close();
  });
});

describe('код примеров исполняется', () => {
  function page() {
    const win = new Window({ url: 'http://localhost/p' });
    win.document.body.innerHTML = t.FIXTURE_HTML;
    return win;
  }

  it('LIST_CODE: копия списка слушателей — как в Chromium', () => {
    const win = page();
    const btn = win.document.querySelector('button.del')!;
    const log: string[] = [];
    const out: string[][] = [];
    const code = t.LIST_CODE.replace(/\/\/ \[.*\]$/gm, '');
    const run = new Function('btn', 'document', 'MouseEvent', 'log', 'snap', code.replace(/(btn\.dispatchEvent\(.*\);)/g, '$1 snap();'));
    run(btn, win.document, win.MouseEvent, log, () => out.push(log.splice(0)));
    expect(out).toEqual([t.LIST_STAND.first, t.LIST_STAND.second]);
    for (const line of [...t.LIST_STAND.first, ...t.LIST_STAND.second]) expect(t.LIST_CODE).toContain(line);
    void win.happyDOM.close();
  });

  it('SYNC_CODE: el.click() — микрозадачи после всех слушателей, как в строке таблицы', async () => {
    const win = page();
    const btn = win.document.querySelector('button.del')!;
    const log: string[] = [];
    new Function('btn', 'log', t.SYNC_CODE)(btn, log);
    await new Promise((r) => setTimeout(r, 0));
    expect(`\`${log.join(', ')}\``).toBe(t.MICRO_ROWS[1].v);
    expect(t.MICRO_ROWS[2].v).toBe(t.MICRO_ROWS[1].v);
    void win.happyDOM.close();
  });

  it('DELEGATE_CODE: пункт, добавленный позже, удаляется; клик мимо кнопки — нет', () => {
    const win = page();
    const doc = win.document;
    new Function('document', t.DELEGATE_CODE)(doc);
    const click = (el: unknown) =>
      (el as { dispatchEvent(e: unknown): boolean }).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(doc.querySelectorAll('li')).toHaveLength(t.DELEGATE_STAND.before);
    click(doc.querySelectorAll('li')[0]);
    expect(doc.querySelectorAll('li')).toHaveLength(t.DELEGATE_STAND.afterMiss);
    click(doc.querySelectorAll('li b')[1]);
    expect(doc.querySelectorAll('li')).toHaveLength(t.DELEGATE_STAND.afterSecond);
    click(doc.querySelector('button.del')!);
    expect(doc.querySelectorAll('li')).toHaveLength(t.DELEGATE_STAND.afterFirst);
    void win.happyDOM.close();
  });

  it('CANCEL_CODE: предок отменил — пункт остался; никто — удалён', () => {
    for (const cancel of [true, false]) {
      const win = page();
      const doc = win.document;
      if (cancel) doc.querySelector('ul')!.addEventListener('todo:remove', (e) => e.preventDefault());
      const button = doc.querySelector('button.del')!;
      new Function('button', 'CustomEvent', t.CANCEL_CODE)(button, win.CustomEvent);
      expect(doc.querySelectorAll('li'), String(cancel)).toHaveLength(cancel ? 1 : 0);
      void win.happyDOM.close();
    }
  });

  it('флажок и ссылка: то же, что DEFAULT_TIMELINE из Chromium', async () => {
    for (const prevent of [false, true]) {
      const win = new Window({ url: 'http://localhost/p' });
      const doc = win.document;
      doc.body.innerHTML = '<input id="cb" type="checkbox"><a id="link" href="#done">ссылка</a>';
      const log: string[] = [];
      const cb = doc.getElementById('cb') as unknown as HTMLInputElement;
      const link = doc.getElementById('link')!;
      cb.addEventListener('click', (e) => {
        log.push('в слушателе checked=' + cb.checked);
        if (prevent) e.preventDefault();
      });
      link.addEventListener('click', (e) => {
        log.push('в слушателе hash=' + win.location.hash);
        if (prevent) e.preventDefault();
      });
      doc.addEventListener('click', (e) => {
        if (e.target === link) log.push('document, всплытие: hash=' + JSON.stringify(win.location.hash));
      });
      cb.click();
      log.push('после: checked=' + cb.checked);
      (link as unknown as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 20));
      log.push('после: hash=' + JSON.stringify(win.location.hash));
      expect(log).toEqual(prevent ? t.DEFAULT_TIMELINE.prevent : t.DEFAULT_TIMELINE.plain);
      void win.happyDOM.close();
    }
  });
});
