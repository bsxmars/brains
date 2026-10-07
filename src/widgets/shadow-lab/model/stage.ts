import type { SdBase, SdFonts, SdReading, SdRule, SdSource, SdTarget } from './types';

/**
 * Сцена демо: настоящий custom element с теневым корнем и правила, которые читатель включает
 * по обе стороны границы.
 *
 * Итоговое значение — `getComputedStyle(…).color` целевого элемента, и ничего больше. Подпись
 * «откуда» выводится из него же: у каждого правила свой токен цвета, модуль вычисляет эти токены
 * тем же браузером и узнаёт победителя по совпадению. Если не совпало ни с одним включённым
 * правилом, значение сравнивается с родителем в плоском дереве — это наследование. Не совпало
 * и с ним — подпись честно говорит «не опознано».
 *
 * ⚠️ `document` трогается только внутри функций: остров рендерится и в Node. Класс элемента
 * создаётся внутри `defineCard`, потому что `HTMLElement` в Node не существует.
 */

export const SD_TAG = 'sd-demo-card';

/** Метка на классе элемента: имя уже занято, но нашим ли классом — видно по ней. */
const MARK = Symbol.for('lesson.sd-demo-card');

interface CardClass extends CustomElementConstructor {
  [MARK]?: true;
}

/**
 * Определить `<sd-demo-card>`, если его ещё нет. Разметка теневого корня приходит из данных темы
 * и печатается на странице той же строкой.
 *
 * Возвращает `false`, если имя занято чужим классом: тогда демо не притворяется, что работает.
 */
export function defineCard(win: Window & typeof globalThis, shadowHtml: string): boolean {
  const existing = win.customElements.get(SD_TAG) as CardClass | undefined;
  if (existing) return existing[MARK] === true;

  class SdDemoCard extends win.HTMLElement {
    static [MARK] = true as const;
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = shadowHtml;
    }
  }
  win.customElements.define(SD_TAG, SdDemoCard);
  return true;
}

export interface Stage {
  doc: Document;
  hostA: HTMLElement;
  hostB: HTMLElement;
  /** Лист страницы: правила со стороны документа. */
  pageStyle: HTMLStyleElement;
  /** Сконструированный лист, общий для обоих теневых корней. */
  shared: CSSStyleSheet;
}

const root = (host: HTMLElement) => host.shadowRoot as ShadowRoot;

/**
 * Собрать сцену: два хоста в `container`, у каждого светлое содержимое для слота, общий лист
 * в обоих корнях и `<style>` страницы в `<head>`.
 *
 * Хосты создаются здесь, а не шаблоном Vue: неизвестный тег шаблон попытался бы разрешить
 * как компонент, и на сервере острова такого элемента всё равно не существует.
 *
 * Лист страницы намеренно вне `@layer` курса: он и есть предмет демо — «обычное правило
 * страницы». Все его селекторы начинаются с `sd-demo-card`, чужих элементов он не задевает.
 */
export function mountStage(doc: Document, container: HTMLElement, lightHtml: string): Stage {
  const win = doc.defaultView as Window & typeof globalThis;
  const pageStyle = doc.createElement('style');
  pageStyle.dataset.sd = 'page';
  doc.head.append(pageStyle);

  const make = (name: string) => {
    const host = doc.createElement(SD_TAG);
    host.dataset.sdCard = name;
    host.innerHTML = lightHtml;
    container.append(host);
    return host;
  };
  const hostA = make('a');
  const hostB = make('b');

  const shared = new win.CSSStyleSheet();
  for (const host of [hostA, hostB]) {
    // Один и тот же объект листа в двух корнях: правка через `replaceSync` видна обоим сразу.
    root(host).adoptedStyleSheets = [...root(host).adoptedStyleSheets, shared];
    // Внутренние правила, которые включает читатель, — отдельный `<style>` после собственного листа.
    const toggles = doc.createElement('style');
    toggles.dataset.sd = 'toggles';
    root(host).append(toggles);
  }
  return { doc, hostA, hostB, pageStyle, shared };
}

export function unmountStage(stage: Stage): void {
  stage.pageStyle.remove();
  stage.hostA.remove();
  stage.hostB.remove();
}

/** Разложить включённые правила по трём местам. Порядок внутри места — порядок в `rules`. */
export function applyRules(stage: Stage, rules: SdRule[], on: ReadonlySet<string>): void {
  const active = rules.filter((r) => on.has(r.key));
  const pick = (side: SdRule['side']) =>
    active
      .filter((r) => r.side === side)
      .map((r) => r.css)
      .join('\n');

  stage.pageStyle.textContent = pick('page');
  stage.shared.replaceSync(pick('adopted'));
  for (const host of [stage.hostA, stage.hostB]) {
    const toggles = root(host).querySelector('style[data-sd="toggles"]');
    if (toggles) toggles.textContent = pick('shadow');
  }
}

/** Элемент, на котором снимается значение. */
export function targetElement(stage: Stage, target: SdTarget): HTMLElement | null {
  switch (target) {
    case 'host':
      return stage.hostA;
    case 'title':
      return root(stage.hostA).querySelector('[part~="title"]');
    case 'body':
      return root(stage.hostA).querySelector('.body');
    case 'slotted':
      return stage.hostA.querySelector('.sd-note');
    case 'title-b':
      return root(stage.hostB).querySelector('[part~="title"]');
  }
}

/** Родитель в плоском дереве: у отслотированного — его `<slot>`, у хоста — элемент страницы. */
function flatParent(stage: Stage, target: SdTarget): { el: Element | null; from: 'page' | 'slot' } {
  if (target === 'slotted') {
    const el = targetElement(stage, target);
    return { el: el?.assignedSlot ?? null, from: 'slot' };
  }
  return { el: stage.hostA.parentElement, from: 'page' };
}

export function readTargets(
  stage: Stage,
  rules: SdRule[],
  base: SdBase[],
  on: ReadonlySet<string>,
  targets: SdTarget[],
): SdReading[] {
  const win = stage.doc.defaultView as Window;
  const color = (el: Element) => win.getComputedStyle(el).color;

  // Токен → вычисленный цвет, тем же браузером и в том же месте, где его прочтёт компонент.
  const probe = stage.doc.createElement('span');
  stage.hostA.parentElement?.append(probe);
  const resolved = new Map<string, string>();
  const resolve = (token: string) => {
    if (!resolved.has(token)) {
      probe.style.color = `var(${token})`;
      resolved.set(token, color(probe));
    }
    return resolved.get(token) as string;
  };

  try {
    return targets.map((target) => {
      const el = targetElement(stage, target);
      if (!el) return { target, value: '', source: { kind: 'unknown' } };
      const value = color(el);

      const ruleTarget = target === 'title-b' ? 'title' : target;
      let source: SdSource = { kind: 'unknown' };
      const match = rules.find((r) => r.target === ruleTarget && on.has(r.key) && resolve(r.token) === value);
      const own = base.find((b) => b.target === ruleTarget && resolve(b.token) === value);
      if (match) source = { kind: 'rule', key: match.key };
      else if (own) source = { kind: 'base' };
      else {
        const parent = flatParent(stage, target);
        if (parent.el && color(parent.el) === value) source = { kind: 'inherited', from: parent.from };
      }
      return { target, value, source };
    });
  } finally {
    probe.remove();
  }
}

/** Шрифт страницы, абзаца внутри компонента и кнопки внутри компонента. */
export function readFonts(stage: Stage): SdFonts {
  const win = stage.doc.defaultView as Window;
  const font = (el: Element | null) => (el ? win.getComputedStyle(el).fontFamily : '');
  const r = root(stage.hostA);
  return {
    page: font(stage.hostA.parentElement),
    inner: font(r.querySelector('.body')),
    button: font(r.querySelector('button')),
  };
}
