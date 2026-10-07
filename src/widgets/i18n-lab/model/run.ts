import type { IcuApi, IcuBranchNode, IcuNode, IcuValues, TreeRow } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `ICU_CODE` и `DIRECTION_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/i18n.test.ts` против `intl-messageformat` и `@messageformat/core`. Копии нет:
 * если показанный код разойдётся с библиотеками, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadIcu(code: string): IcuApi {
  return new Function(`${code}\nreturn { parse, pick, format };`)() as IcuApi;
}

/** `DIRECTION_CODE` — функция `direction(locale)` и строки-примеры к ней (они безвредны). */
export function loadDirection(code: string): (locale: string) => 'ltr' | 'rtl' {
  return new Function(`${code}\nreturn direction;`)() as (locale: string) => 'ltr' | 'rtl';
}

const isBranch = (n: IcuNode): n is IcuBranchNode => typeof n !== 'string' && 'options' in n;

/** Имена аргументов дерева по роли: числа для plural, варианты для select, остальное — текст. */
export function argsOf(nodes: IcuNode[]) {
  const numbers = new Set<string>();
  const selects = new Map<string, Set<string>>();
  const texts = new Set<string>();
  const walk = (list: IcuNode[]) => {
    for (const n of list) {
      if (typeof n === 'string' || n.type === 'pound') continue;
      if (n.type === 'arg') { texts.add(n.name); continue; }
      if (n.type === 'select') {
        const keys = selects.get(n.name) ?? new Set<string>();
        for (const k of Object.keys(n.options)) keys.add(k);
        selects.set(n.name, keys);
      } else {
        numbers.add(n.name);
      }
      for (const branch of Object.values(n.options)) walk(branch);
    }
  };
  walk(nodes);
  for (const name of numbers) texts.delete(name);
  for (const name of selects.keys()) texts.delete(name);
  return {
    numbers: [...numbers],
    selects: [...selects].map(([name, keys]) => ({ name, keys: [...keys] })),
    texts: [...texts],
  };
}

/**
 * Дерево — в строки для показа. Какую ветку взять, решает `pick` из темы, а не этот код:
 * здесь только раскладка по глубине и пометка «по этой ветке прошёл `format`». Невыбранные
 * ветки свёрнуты в одну строку.
 */
export function flatten(api: IcuApi, nodes: IcuNode[], values: IcuValues, locale: string): TreeRow[] {
  const rows: TreeRow[] = [];
  const nf = new Intl.NumberFormat(locale);
  const walk = (list: IcuNode[], depth: number, live: boolean, pound: number | undefined, path: string) => {
    list.forEach((n, i) => {
      const key = `${path}.${i}`;
      if (typeof n === 'string') {
        rows.push({ key, depth, kind: 'text', label: JSON.stringify(n), note: '', live });
        return;
      }
      if (n.type === 'pound') {
        rows.push({ key, depth, kind: 'pound', label: '#', note: pound === undefined ? '' : `→ ${nf.format(pound)}`, live });
        return;
      }
      if (n.type === 'arg') {
        rows.push({ key, depth, kind: 'arg', label: `{${n.name}}`, note: `→ ${String(values[n.name])}`, live });
        return;
      }
      const picked = api.pick(n, values, locale);
      const head =
        n.type === 'select'
          ? `${n.name}: select`
          : `${n.name}: ${n.type}${n.offset ? `, offset ${n.offset}` : ''}`;
      const note =
        n.type === 'select'
          ? `значение «${String(values[n.name])}»`
          : `${n.name} = ${String(values[n.name])}${n.offset ? `, # = ${nf.format(picked.pound ?? 0)}` : ''}, категория ${picked.category}`;
      rows.push({ key, depth, kind: 'branch', label: head, note, live });
      for (const [opt, branch] of Object.entries(n.options)) {
        const on = live && opt === picked.key;
        rows.push({ key: `${key}:${opt}`, depth: depth + 1, kind: 'option', label: opt, note: on ? '← выбрана' : 'свёрнута', live: on });
        // Невыбранные ветки свёрнуты: их содержимое видно в самом сообщении.
        if (on) walk(branch, depth + 2, on, n.type === 'select' ? pound : picked.pound, `${key}:${opt}`);
      }
    });
  };
  walk(nodes, 0, true, undefined, 'r');
  return rows;
}

export { isBranch };
