import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_ROWS,
  ENGINES_ROWS,
  PITFALLS,
  SD_BASE,
  SD_LIGHT_HTML,
  SD_RULES,
  SD_SHADOW_HTML,
  SD_SIDES,
  SD_TARGETS,
} from '../../src/content/render/web-components-styles/data';
import { BOUNDARY_KEYS } from '../../src/widgets/shadow-lab/model/boundary';
import { readTargets, type Stage } from '../../src/widgets/shadow-lab/model/stage';
import type { SdTarget } from '../../src/widgets/shadow-lab/model/types';
import { LESSON_VARS } from '../../src/shared/ui/theme';

/**
 * Тема «Стили веб-компонентов: Shadow DOM и каскад».
 *
 * Поведение границы теневого дерева в Node не проверить: здесь нет ни DOM, ни каскада. Его
 * снимает стенд из шапки `data.ts` в трёх движках, и тот же стенд гоняет сборку модулей демо
 * (`widgets/shadow-lab/model/*.ts`), сверяя их ответы с литералами темы.
 *
 * Здесь закреплено то, что ломается молча и без браузера:
 *   - таблица «что проходит через границу» и модуль, который её вычисляет, говорят об одних
 *     и тех же строках в одном порядке;
 *   - подпись «откуда» в демо опознаёт правило по цвету — значит у правил одной цели цвета
 *     обязаны различаться, и каждый токен обязан существовать в теме;
 *   - данные демо согласованы с разметкой компонента: правило «запасного значения» и
 *     `::slotted` смотрят на то, что в разметке действительно есть;
 *   - алгоритм опознания (правило → собственный лист → наследование → «не опознано») — на стабах;
 *   - текст темы не разошёлся с литералом по движкам там, где различие — суть утверждения.
 */

const hex = (token: string) => (LESSON_VARS as Record<string, string>)[token];

describe('таблица «что проходит через границу»', () => {
  it('строки данных — ровно ключи модуля и в том же порядке', () => {
    expect(BOUNDARY_ROWS.map((r) => r.key)).toEqual([...BOUNDARY_KEYS]);
  });

  it('различия движков, о которых говорит текст, совпадают с литералом', () => {
    const row = (key: string) => BOUNDARY_ROWS.find((r) => r.key === key)!;
    // «:host-context — только Chromium»: раздел про :host, тонкое место 05, таблица поддержки.
    expect(row('host-context')).toMatchObject({ chromium: true, firefox: false, webkit: false });
    expect(PITFALLS.find((p) => p.n === '05')!.t).toContain('только в Chromium');
    // «@font-face в корне — только WebKit».
    expect(row('shadow-font-face')).toMatchObject({ chromium: false, firefox: false, webkit: true });
    expect(PITFALLS.find((p) => p.n === '06')!.t).toContain('только в WebKit');
    // «all: initial не отрезает шрифт в WebKit».
    expect(row('all-initial-font')).toMatchObject({ chromium: true, firefox: true, webkit: false });
    expect(PITFALLS.find((p) => p.n === '08')!.t).toContain('не отрезает шрифт в WebKit');
    const engines = (what: string) => ENGINES_ROWS.find((r) => r[0].includes(what))!;
    expect(engines(':host-context').slice(1)).toEqual(['работает', 'правило выброшено', 'правило выброшено']);
    expect(engines('@font-face').slice(1).map((c) => c.startsWith('работает'))).toEqual([false, false, true]);
  });
});

describe('правила демо', () => {
  it('ключи уникальны, стороны и цели объявлены', () => {
    const keys = SD_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    const sides = new Set(SD_SIDES.map((s) => s.key));
    const targets = new Set(SD_TARGETS.map((t) => t.key));
    for (const r of SD_RULES) {
      expect(sides.has(r.side), `${r.key}: сторона ${r.side} не объявлена`).toBe(true);
      expect(targets.has(r.target), `${r.key}: цель ${r.target} не объявлена`).toBe(true);
    }
  });

  it('каждый токен есть в теме и стоит в самом правиле', () => {
    for (const r of [...SD_RULES, ...SD_BASE]) {
      expect(hex(r.token), `токена ${r.token} нет в theme.ts`).toBeTruthy();
    }
    for (const r of SD_RULES) expect(r.css, r.key).toContain(`var(${r.token})`);
  });

  /**
   * Опознание «откуда» идёт по вычисленному цвету. Два правила одной цели с одинаковым цветом —
   * и демо припишет победу не тому. Отслотированный элемент при этом наследует от хоста, поэтому
   * его цвета обязаны отличаться и от цветов хоста.
   */
  it('у правил одной цели разные цвета — и у слота они не совпадают с цветами хоста', () => {
    const colors = (target: SdTarget) => [
      ...SD_RULES.filter((r) => r.target === target).map((r) => hex(r.token)),
      ...SD_BASE.filter((b) => b.target === target).map((b) => hex(b.token)),
    ];
    for (const t of SD_TARGETS.map((x) => x.key)) {
      const list = colors(t);
      expect(new Set(list).size, `у цели ${t} повторяются цвета: ${list.join(', ')}`).toBe(list.length);
    }
    const host = new Set(colors('host'));
    for (const c of colors('slotted')) expect(host.has(c), `цвет ${c} есть и у хоста, и у слота`).toBe(false);
  });

  it('данные демо смотрят на то, что есть в разметке компонента', () => {
    const title = SD_BASE.find((b) => b.target === 'title')!;
    const body = SD_BASE.find((b) => b.target === 'body')!;
    expect(SD_SHADOW_HTML).toMatch(new RegExp(`\\.title \\{[^}]*color: var\\(${title.token}\\)`));
    expect(SD_SHADOW_HTML).toContain(`color: var(--sd-accent, var(${body.token}))`);
    expect(SD_SHADOW_HTML).toContain('part="title"');
    expect(SD_SHADOW_HTML).toContain('<slot></slot>');
    expect(SD_SHADOW_HTML).toContain('<button');
    expect(SD_SHADOW_HTML).toContain(':host { display: block; }');
    // Пользовательское свойство со страницы — ровно то, что читает `.body`.
    expect(SD_RULES.find((r) => r.key === 'custom-prop')!.css).toContain('--sd-accent:');
    // `::slotted` и модуль ищут в светлом DOM один и тот же элемент.
    expect(SD_LIGHT_HTML).toMatch(/^<span class="sd-note">/);
    expect(SD_RULES.find((r) => r.key === 'slotted')!.css).toContain('::slotted(span.sd-note)');
  });
});

/* ─────────────── опознание «откуда» на стабах ─────────────── */

/**
 * ⚠️ Стаб — не модель каскада. Он отдаёт заданные цвета элементов и вычисляет `var(--токен)`
 * по таблице темы, чтобы проверить порядок опознания в `readTargets`, а не поведение браузера.
 */
function fakeStage(colors: Partial<Record<SdTarget | 'parent' | 'slot', string>>): Stage {
  const toRgb = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return `rgb(${r}, ${g}, ${b})`;
  };
  type El = { color: string; style: { color: string }; assignedSlot?: El; remove(): void };
  const el = (color = ''): El => ({ color, style: { color: '' }, remove() {} });
  const slot = el(colors.slot);
  const parent = { ...el(colors.parent), append() {} };
  const note = { ...el(colors.slotted), assignedSlot: slot };
  const inner: Record<string, El> = { '[part~="title"]': el(colors.title), '.body': el(colors.body) };
  const innerB: Record<string, El> = { '[part~="title"]': el(colors['title-b']) };
  const hostA = { ...el(colors.host), parentElement: parent, shadowRoot: { querySelector: (s: string) => inner[s] ?? null }, querySelector: () => note };
  const hostB = { ...el(), shadowRoot: { querySelector: (s: string) => innerB[s] ?? null } };
  const view = {
    getComputedStyle: (e: El) => {
      if (e.style.color.startsWith('var(')) return { color: toRgb(hex(e.style.color.slice(4, -1))) };
      return { color: e.color };
    },
  };
  const doc = { defaultView: view, createElement: () => el() };
  return { doc, hostA, hostB } as unknown as Stage;
}

const rgbOf = (token: string) => {
  const h = hex(token);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

describe('readTargets: порядок опознания', () => {
  const tokenOf = (key: string) => SD_RULES.find((r) => r.key === key)!.token;

  it('включённое правило, чей цвет совпал, — победитель', () => {
    const stage = fakeStage({ title: rgbOf(tokenOf('part')) });
    const [r] = readTargets(stage, SD_RULES, SD_BASE, new Set(['part', 'adopted']), ['title']);
    expect(r.source).toEqual({ kind: 'rule', key: 'part' });
  });

  it('выключенное правило не опознаётся, даже если цвет совпал', () => {
    const stage = fakeStage({ title: rgbOf(tokenOf('part')), parent: 'rgb(1, 2, 3)' });
    const [r] = readTargets(stage, SD_RULES, SD_BASE, new Set(), ['title']);
    expect(r.source).toEqual({ kind: 'unknown' });
  });

  it('собственный лист, если ни одно правило не совпало', () => {
    const stage = fakeStage({ body: rgbOf('--prose') });
    const [r] = readTargets(stage, SD_RULES, SD_BASE, new Set(['outer-selector']), ['body']);
    expect(r.source).toEqual({ kind: 'base' });
  });

  it('наследование: хост — от страницы, светлый DOM — от слота', () => {
    const stage = fakeStage({ host: 'rgb(1, 2, 3)', parent: 'rgb(1, 2, 3)', slotted: 'rgb(4, 5, 6)', slot: 'rgb(4, 5, 6)' });
    const [host, slotted] = readTargets(stage, SD_RULES, SD_BASE, new Set(), ['host', 'slotted']);
    expect(host.source).toEqual({ kind: 'inherited', from: 'page' });
    expect(slotted.source).toEqual({ kind: 'inherited', from: 'slot' });
  });

  it('вторая карточка опознаётся по правилам заголовка', () => {
    const stage = fakeStage({ 'title-b': rgbOf(tokenOf('adopted')) });
    const [r] = readTargets(stage, SD_RULES, SD_BASE, new Set(['adopted']), ['title-b']);
    expect(r.source).toEqual({ kind: 'rule', key: 'adopted' });
  });
});
