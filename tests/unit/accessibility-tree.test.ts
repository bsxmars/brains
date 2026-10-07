import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import * as t from '@/content/render/accessibility-tree/data';
import { elementRow, loadAx, sceneElements } from '@/widgets/ax-tree-lab/model/run';
import type { AxNode } from '@/widgets/ax-tree-lab/model/types';

/**
 * Тема «Дерево доступности».
 *
 * `HIDDEN_CODE`, `ROLE_CODE`, `NAME_CODE`, `FOCUS_CODE`, `TREE_CODE` — строки из темы:
 * напечатаны на странице и исполняются демо. Здесь они исполняются в happy-dom на всех 88
 * фикстурах и пяти сценах и сверяются с тем, что Chromium 153 отдал через CDP на стенде
 * (литералы `CASES`, `SCENES`, `SHADOW_ROWS`, см. шапку `data.ts`). Браузер в тесте не
 * поднимается. axe-core повторяет `AXE_SCENES` в том же happy-dom правилами, которым не нужна
 * раскладка. `DIY_BUTTON_CODE` и `LIVE_CODE` исполняются.
 */

const api = loadAx([t.HIDDEN_CODE, t.ROLE_CODE, t.NAME_CODE, t.FOCUS_CODE, t.TREE_CODE]);

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((w) => w.happyDOM.close()));
});

function mount(html: string): Document {
  const win = new Window({ url: 'http://localhost/' });
  windows.push(win);
  const doc = win.document as unknown as Document;
  doc.write(`<!doctype html><html lang="ru"><head><title>t</title></head><body>${html}</body></html>`);
  return doc;
}

describe('фикстуры: учебные функции против Chromium 153', () => {
  it('фикстур 88, как сказано в тексте, и id не повторяются', () => {
    expect(t.CASES).toHaveLength(88);
    expect(new Set(t.CASES.map((c) => c.id)).size).toBe(88);
    expect(t.NAME_NOTE).toContain('88 фикстурах');
  });

  for (const c of t.CASES) {
    it(c.id, () => {
      const doc = mount(c.html);
      const el = doc.querySelector('[data-k]') as Element;
      const hidden = api.isHidden(el);
      if (c.chrome.hidden) {
        expect(hidden).toBe(true);
        return;
      }
      expect(hidden).toBe(false);
      const role = api.roleOf(el);
      const { name, from } = api.accName(el);
      expect(role).toBe(c.chrome.role);
      if (c.id === 'btn-before') {
        // Единственное намеренное расхождение: текст из CSS `::before` функция не читает.
        expect(c.chrome.name).toBe('★ В избранное');
        expect(name).toBe('В избранное');
        return;
      }
      expect({ name, from }).toEqual({ name: c.chrome.name, from: c.chrome.from });
      expect(api.statesOf(el, role)).toEqual(c.chrome.states ?? {});
      expect(api.focusable(el)).toBe(c.chrome.focusable);
    });
  }
});

describe('сцены: каждый элемент и порядок Tab', () => {
  for (const s of t.SCENES) {
    it(s.id, () => {
      const doc = mount(s.html);
      const els = sceneElements(doc.body);
      expect(els.map((el) => elementRow(api, el))).toEqual(s.elements);
      expect(api.tabOrder(doc.body).map((el) => els.indexOf(el))).toEqual(s.tabs);
    });
  }

  it('таблица «что попадает в дерево» совпадает со сценой «Спрятано»', () => {
    const s = t.SCENES.find((x) => x.id === 'hidden')!;
    // Кнопки сцены по порядку: видна, display, visibility, hidden, aria-hidden, (div inert), inert-кнопка, opacity, clip.
    const doc = mount(s.html);
    const els = sceneElements(doc.body);
    const at = (sel: string) => els.indexOf(doc.querySelector(sel) as Element);
    const row = (k: string) => t.HIDE_ROWS.find((r) => r.k.includes(k))!;
    const check = (k: string, sel: string) => {
      const i = at(sel);
      expect(row(k).tree.startsWith('да'), k).toBe(s.elements[i] !== '-');
      expect(row(k).tab.replaceAll('*', '').startsWith('да'), k).toBe(s.tabs.includes(i));
    };
    check('display: none', 'button[style*="display"]');
    check('visibility', 'button[style*="visibility"]');
    check('атрибут `hidden`', 'button[hidden]');
    check('inert', '[inert] button');
    check('aria-hidden', 'button[aria-hidden]');
    check('opacity', 'button[style*="opacity"]');
    check('clip-path', 'button[style*="clip-path"]');
  });

  it('карточка: дерево из шести узлов с ролями, div с onclick стал текстом', () => {
    const s = t.SCENES.find((x) => x.id === 'card')!;
    const doc = mount(s.html);
    const roles: string[] = [];
    const walk = (nodes: AxNode[]) => nodes.forEach((n) => (n.role !== 'text' && roles.push(n.role), walk(n.children)));
    const tree = api.axTree(doc.body);
    walk(tree);
    expect(sceneElements(doc.body)).toHaveLength(9);
    expect(roles).toEqual(['article', 'heading', 'img', 'paragraph', 'button', 'link']);
    expect(tree[0].children.map((n) => (n.role === 'text' ? n.name : n.role))).toContain('Купить');
    expect(t.TREE_FACTS[0].t).toBe('Девять элементов — шесть узлов');
  });

  it('порядок Tab: положительные tabindex первыми', () => {
    const s = t.SCENES.find((x) => x.id === 'tab')!;
    const doc = mount(s.html);
    const els = sceneElements(doc.body);
    const names = s.tabs.map((i) => api.accName(els[i]).name || els[i].textContent);
    expect(names).toEqual(['Помощь', 'Поиск', 'Первая в разметке', 'Карточка, tabindex="0"', 'Последняя ссылка']);
  });
});

describe('таблицы темы собраны из литералов Chromium', () => {
  it('роли и имена в таблицах — из CASES', () => {
    expect(t.ROLE_ROWS).toHaveLength(t.ROLE_PICKS.length);
    expect(t.NAME_ROWS).toHaveLength(t.NAME_PICKS.length);
    const typo = t.ROLE_ROWS.find((r) => r.html.includes('buton'))!;
    expect(typo.role).toContain('generic');
    const missing = t.NAME_ROWS.find((r) => r.html.includes('nope'))!;
    expect(missing.name).toBe('«Запасное»');
    for (const r of [...t.ROLE_ROWS, ...t.NAME_ROWS]) expect(r.html).not.toContain('data-k');
  });

  it('Shadow DOM: имена через границу не проходят', () => {
    const doc = mount(
      '<label for="inner">Имя снаружи</label><x-field id="f1"></x-field><span id="outer-hint">Подсказка снаружи</span><x-field id="f2"></x-field><x-field id="f3"></x-field>',
    );
    const inner: Record<string, string> = {
      f1: '<input id="inner">',
      f2: '<input aria-labelledby="outer-hint">',
      f3: '<label for="i3">Имя внутри</label><input id="i3">',
    };
    const names = ['f1', 'f2', 'f3'].map((id) => {
      const root = (doc.getElementById(id) as HTMLElement).attachShadow({ mode: 'open' });
      root.innerHTML = inner[id];
      return api.accName(root.querySelector('input') as Element).name;
    });
    // Литерал стенда (CDP getFullAXTree): '', '', 'Имя внутри'.
    expect(names).toEqual(['', '', 'Имя внутри']);
    expect(t.SHADOW_ROWS.map((r) => r.name)).toEqual(['`""`', '`""`', '«Имя внутри»']);
  });
});

describe('axe-core в happy-dom повторяет находки на сценах', () => {
  const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');

  for (const s of t.SCENES) {
    it(s.id, async () => {
      const doc = mount(s.html);
      const win = doc.defaultView as unknown as { eval(code: string): void; axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: { id: string }[] }> } };
      win.eval(AXE);
      const r = await win.axe.run(doc, { resultTypes: ['violations'], runOnly: t.AXE_RULES });
      expect(r.violations.map((v) => v.id).sort()).toEqual([...t.AXE_SCENES[s.id]].sort());
    });
  }
});

describe('примеры кода исполняются', () => {
  it('DIY_BUTTON_CODE: Enter — сразу, пробел — на отпускании', () => {
    const doc = mount('<div class="buy">Купить</div>');
    const win = doc.defaultView as unknown as typeof globalThis;
    const el = doc.querySelector('.buy') as HTMLElement;
    let clicks = 0;
    el.addEventListener('click', () => clicks++);
    new win.Function('document', t.DIY_BUTTON_CODE)(doc);
    expect(api.roleOf(el)).toBe('button');
    expect(api.focusable(el)).toBe(true);
    const key = (type: string, k: string) => {
      const e = new win.KeyboardEvent(type, { key: k, cancelable: true, bubbles: true });
      el.dispatchEvent(e);
      return e;
    };
    key('keydown', 'Enter');
    expect(clicks).toBe(1);
    const down = key('keydown', ' ');
    expect(down.defaultPrevented).toBe(true);
    expect(clicks).toBe(1);
    key('keyup', ' ');
    expect(clicks).toBe(2);
  });

  it('LIVE_CODE: announce меняет содержимое существующего региона, announceTooLate вставляет регион с текстом', async () => {
    const doc = mount('<div id="cart-status" role="status"></div>');
    const win = doc.defaultView as unknown as typeof globalThis;
    const fns = new win.Function('document', `${t.LIVE_CODE}\nreturn { announce, announceTooLate };`)(doc) as {
      announce(text: string): void;
      announceTooLate(text: string): void;
    };
    const region = doc.getElementById('cart-status') as HTMLElement;
    const records: MutationRecord[] = [];
    const mo = new win.MutationObserver((r) => records.push(...(r as unknown as MutationRecord[])));
    mo.observe(doc.body, { childList: true, subtree: true, characterData: true });

    fns.announce('Товар в корзине');
    await new Promise((r) => setTimeout(r, 0));
    expect(records.every((r) => r.target === region)).toBe(true);
    expect(api.statesOf(region, api.roleOf(region))).toEqual({ live: 'polite' });
    records.length = 0;

    fns.announceTooLate('Товар в корзине');
    await new Promise((r) => setTimeout(r, 0));
    mo.disconnect();
    const added = records.flatMap((r) => [...r.addedNodes]) as Element[];
    expect(records[0].target).toBe(doc.body);
    expect(added[0].getAttribute('role')).toBe('status');
    expect(added[0].textContent).toBe('Товар в корзине');
  });
});
