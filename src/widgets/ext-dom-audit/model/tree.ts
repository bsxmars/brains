/**
 * Сверка двух деревьев: что сайт отдал в HTML и что лежит в документе сейчас.
 *
 * Чистая логика без DOM — её исполняет и остров в браузере читателя, и юнит-тест в Node.
 * Дерево сведено к минимуму, который нужен сверке: имя тега, дети и два признака,
 * которые считает сторона с DOM (`dom.ts`).
 *
 * Сравнение идёт **по тегам, а не по атрибутам**. Собственные скрипты сайта меняют классы,
 * `aria-*` и `style` на ходу, и сверка по атрибутам кричала бы о каждом переключателе.
 * А вставленный чужой узел меняет **состав детей** — его и ищет выравнивание: наибольшая
 * общая подпоследовательность детей одного родителя по имени тега. Всё, что в живом
 * документе не легло в пару, — вставлено; всё, что не легло в исходнике, — удалено.
 */
export interface AuditNode {
  tag: string;
  children: AuditNode[];
  /** Короткая подпись для отчёта: `div#id.class`. */
  label?: string;
  /** Узел — остров, чьё содержимое переписывает гидратация: внутрь сверка не спускается. */
  opaque?: boolean;
  /** Узел ссылается на адрес своего источника (`src`/`href` того же origin). */
  sameOriginUrl?: boolean;
}

export type FindingKind = 'inserted' | 'removed';

export interface Finding {
  kind: FindingKind;
  /** Путь родителя: `body > main > section`. */
  where: string;
  what: string;
}

export interface DiffOptions {
  /**
   * Вставку, которую законно делает сам сайт, сверка пропускает. По умолчанию — узлы `<head>`
   * со ссылкой на свой же origin: сборщик дозагружает чанки, вставляя `modulepreload`
   * и стили в `<head>`, и это не чужой код.
   */
  ignoreInserted?: (node: AuditNode, parentPath: string[]) => boolean;
}

const describe = (node: AuditNode) => node.label ?? node.tag;

export const defaultIgnore: NonNullable<DiffOptions['ignoreInserted']> = (node, parentPath) =>
  parentPath[parentPath.length - 1] === 'head' && node.sameOriginUrl === true;

/**
 * Пары индексов (исходник, живой документ) наибольшей общей подпоследовательности по тегу.
 * Квадрат по числу детей одного родителя — десятки, редко сотни: дёшево.
 */
export function alignByTag(source: AuditNode[], live: AuditNode[]): Array<[number, number]> {
  const n = source.length;
  const m = live.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        source[i].tag === live[j].tag
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (source[i].tag === live[j].tag) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Все расхождения поддеревьев. Внутрь вставленного или удалённого узла сверка не идёт. */
export function diffTrees(source: AuditNode, live: AuditNode, options: DiffOptions = {}): Finding[] {
  const ignore = options.ignoreInserted ?? defaultIgnore;
  const findings: Finding[] = [];

  const walk = (a: AuditNode, b: AuditNode, path: string[]) => {
    if (a.opaque || b.opaque) return;
    const here = [...path, a.tag];
    const pairs = alignByTag(a.children, b.children);
    const pairedSource = new Set(pairs.map(([i]) => i));
    const pairedLive = new Set(pairs.map(([, j]) => j));

    b.children.forEach((child, j) => {
      if (pairedLive.has(j) || ignore(child, here)) return;
      findings.push({ kind: 'inserted', where: here.join(' > '), what: describe(child) });
    });
    a.children.forEach((child, i) => {
      if (pairedSource.has(i)) return;
      findings.push({ kind: 'removed', where: here.join(' > '), what: describe(child) });
    });
    for (const [i, j] of pairs) walk(a.children[i], b.children[j], here);
  };

  walk(source, live, []);
  return findings;
}

/** Атрибуты `<html>` и `<body>`, которых не было в исходнике: так метят страницу расширения. */
export function extraAttributes(source: string[], live: string[]): string[] {
  const known = new Set(source);
  return live.filter((name) => !known.has(name));
}

/** Схемы адресов, которые принадлежат расширениям, а не вебу. */
export const EXTENSION_SCHEMES = ['chrome-extension:', 'moz-extension:', 'safari-web-extension:'];

export const isExtensionUrl = (url: string) =>
  EXTENSION_SCHEMES.some((scheme) => url.trim().toLowerCase().startsWith(scheme));
