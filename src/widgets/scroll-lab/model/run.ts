import type { AnchorFn, ScrollSnapshot, StickyFn } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `STICKY_CODE` и `ANCHOR_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/scrolling.test.ts` против Chromium: сдвиг липкого элемента сверяется
 * с `getBoundingClientRect` при разных `scrollTop`, выбор якоря — с тем, на сколько браузер
 * сдвинул прокрутку после вставки над каждым узлом. Копии нет.
 */
export function loadSticky(code: string): StickyFn {
  return new Function(`${code}\nreturn stickyOffset;`)() as StickyFn;
}

export function loadAnchor(code: string): AnchorFn {
  return new Function(`${code}\nreturn selectAnchor;`)() as AnchorFn;
}

/**
 * Снимок контейнера прокрутки для `selectAnchor`: дерево элементов и текстов с их
 * прямоугольниками и причинами исключения. Это измерительный прибор, а не учебный код:
 * алгоритм выбора живёт в теме, здесь только чтение геометрии из DOM.
 *
 * Строкой — потому что тот же код исполняет и виджет в браузере, и тест внутри Chromium
 * (`page.evaluate`), а функцию из TypeScript в браузер так не передать: сборщик вправе
 * дописать в её текст свои помощники.
 *
 * Подпись узла — `data-sid`, иначе `id`, иначе имя тега; у текста — подпись родителя.
 * Кроме дерева, снимок кладёт в `refs` ссылки на узлы DOM по тем же подписям —
 * виджету нужно подсветить выбранный якорь.
 */
export const SNAPSHOT_JS = `function snapshot(sc, refs) {
  const cs = getComputedStyle(sc);
  const base = sc.getBoundingClientRect().top + sc.clientTop - sc.scrollTop;
  const inside = (el) => !!el && (el === sc || sc.contains(el));
  const label = (el) => el.getAttribute('data-sid') || el.id || el.tagName.toLowerCase();
  const reason = (el, s) => {
    if (s.overflowAnchor === 'none') return 'overflow-anchor: none';
    if (s.position === 'fixed' || s.position === 'sticky') return 'position: ' + s.position;
    if (s.position === 'absolute' && !inside(el.offsetParent)) return 'absolute, блок-контейнер снаружи';
    return null;
  };
  const node = (n, parent) => {
    if (n.nodeType === 3) {
      if (!n.data.trim()) return null;
      const range = document.createRange();
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      const id = parent + ' · текст';
      if (refs) refs[id] = n.parentNode;
      return { id, text: true, top: r.top - base, bottom: r.bottom - base, skip: null, kids: [] };
    }
    if (n.nodeType !== 1) return null;
    const s = getComputedStyle(n);
    if (s.display === 'none') return null;
    const r = n.getBoundingClientRect();
    const id = label(n);
    if (refs) refs[id] = n;
    return {
      id, top: r.top - base, bottom: r.bottom - base, skip: reason(n, s),
      kids: [...n.childNodes].map((k) => node(k, id)).filter(Boolean),
    };
  };
  return {
    scrollTop: sc.scrollTop,
    height: sc.clientHeight,
    paddingTop: parseFloat(cs.scrollPaddingTop) || 0,
    paddingBottom: parseFloat(cs.scrollPaddingBottom) || 0,
    overflowAnchor: cs.overflowAnchor,
    kids: [...sc.childNodes].map((k) => node(k, label(sc))).filter(Boolean),
  };
}`;

type SnapshotFn = (sc: Element, refs?: Record<string, Element>) => ScrollSnapshot;

let snap: SnapshotFn | null = null;

/** Снимок в браузере — только из обработчиков и `onMounted`: в SSR DOM нет. */
export function snapshot(sc: Element, refs?: Record<string, Element>): ScrollSnapshot {
  snap ??= new Function(`${SNAPSHOT_JS}\nreturn snapshot;`)() as SnapshotFn;
  return snap(sc, refs);
}
