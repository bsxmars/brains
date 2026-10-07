import type { Doc, DocCommand, GroupDecision, OutlineRow, PrintDocFn } from './types';

/**
 * Демо и тест печатают одной и той же функцией — строкой `PRINTER_CODE` из темы «Форматтер
 * изнутри». Строка напечатана на странице, собрана здесь `new Function` и сверяется
 * `tests/unit/formatter.test.ts` с `printDocToString` из `prettier/doc` на случайных Doc
 * и на Doc настоящего кода. Копии нет: разойдётся показанный код с Prettier — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPrinter(code: string): PrintDocFn {
  return new Function(`${code}\nreturn printDoc;`)() as PrintDocFn;
}

/** Короткая запись содержимого `ifBreak`: строки в кавычках, остальное — многоточием. */
function short(d: Doc | undefined): string {
  if (d === undefined || d === '') return '""';
  if (typeof d === 'string') return JSON.stringify(d);
  if (Array.isArray(d) && d.every((x) => typeof x === 'string')) return JSON.stringify(d.join(''));
  return '…';
}

const WRAPPERS: Record<string, (d: DocCommand) => string> = {
  indent: () => 'indent',
  align: (d) => `align(${d.n})`,
  'indent-if-break': () => 'indentIfBreak',
  fill: () => 'fill',
};

/**
 * Дерево Doc строками для показа: соседние листья (текст, `line`, `softline`, `ifBreak`)
 * склеены в одну строку, у групп — решение принтера. У `conditionalGroup` раскрыт только
 * вариант, который выбран: остальные не печатались. `lineSuffixBoundary` и пустые строки
 * опущены — в примерах без комментариев они ничего не делают.
 *
 * Это подпись к решению, а не расчёт: решения берутся из `decisions` учебного принтера.
 */
export function outline(doc: Doc, decisions: Map<DocCommand, GroupDecision>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  let pending: { depth: number; parts: string[] } | null = null;

  const flush = () => {
    if (pending && pending.parts.length) rows.push({ depth: pending.depth, kind: 'text', text: pending.parts.join(' ') });
    pending = null;
  };
  const leaf = (depth: number, s: string) => {
    if (!pending || pending.depth !== depth) {
      flush();
      pending = { depth, parts: [] };
    }
    pending.parts.push(s);
  };
  /** Заголовок контейнера и его содержимое; пустой контейнер (`indent([])`) не показывается. */
  const container = (row: OutlineRow, body: Doc | Doc[] | undefined) => {
    flush();
    const at = rows.length;
    rows.push(row);
    if (body !== undefined) walk(body, row.depth + 1);
    flush();
    if (rows.length === at + 1 && row.kind !== 'group' && row.kind !== 'conditionalGroup') rows.pop();
  };

  function walk(d: Doc, depth: number): void {
    if (typeof d === 'string') {
      if (d) leaf(depth, JSON.stringify(d));
      return;
    }
    if (Array.isArray(d)) {
      for (const x of d) walk(x, depth);
      return;
    }
    switch (d.type) {
      case 'line':
        leaf(depth, d.hard ? 'hardline' : d.soft ? 'softline' : 'line');
        return;
      case 'if-break':
        leaf(depth, d.flatContents ? `ifBreak(${short(d.breakContents)}, ${short(d.flatContents)})` : `ifBreak(${short(d.breakContents)})`);
        return;
      case 'break-parent':
      case 'line-suffix-boundary':
        return;
      case 'label':
        walk(d.contents ?? '', depth);
        return;
      case 'group': {
        const dec = decisions.get(d);
        const states = d.expandedStates;
        if (states) {
          const body = dec && dec.state > 0 ? states[dec.state] : d.contents;
          container({ depth, kind: 'conditionalGroup', text: dec ? `вариант ${dec.state + 1} из ${states.length}` : '', mode: dec?.mode }, body);
        } else {
          container({ depth, kind: 'group', text: d.break === true ? 'break: true' : '', mode: dec?.mode }, d.contents);
        }
        return;
      }
      default: {
        const name = WRAPPERS[d.type];
        if (name) container({ depth, kind: name(d), text: '' }, d.type === 'fill' ? d.parts : d.contents);
        else leaf(depth, d.type);
      }
    }
  }

  walk(doc, 0);
  flush();
  return rows;
}

/** Линейка над выводом: цифра десятков на каждой десятой колонке, точки между ними. */
export function ruler(width: number): string {
  let s = '';
  for (let i = 1; i <= width; i++) s += i % 10 === 0 ? String((i / 10) % 10) : '·';
  return s;
}
