/**
 * Тема → Markdown: обход уже отрисованной страницы, а не исходника MDX. Так в файл попадает ровно
 * то, что видит читатель: строки из `data.ts`, разобранная строчная разметка, примеры кода.
 *
 * Острова (`astro-island`) пропускаются: их содержимое зависит от кликов, а не от темы. Код,
 * который они показывают, напечатан в теме и так — `CodeBlock` выше демо.
 *
 * Чистая функция над DOM без `window`: её гоняет юнит-тест в happy-dom.
 */

/** Не текст темы: навигация, кнопки, острова, украшения, надзаголовки «Раздел N». */
const SKIP = 'astro-island, nav, button, svg, script, style, template, [aria-hidden="true"], [data-md-skip], .t-eyebrow';

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DETAILS', 'DIV', 'DL', 'DT', 'DD', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL',
  'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'UL',
]);

const isElement = (n: Node): n is Element => n.nodeType === 1;
const skipped = (el: Element) => el.matches(SKIP);
const hasBlock = (el: Element): boolean => [...el.children].some((c) => !skipped(c) && (BLOCK.has(c.tagName) || hasBlock(c)));

/** Строчная разметка: `код`, **жирный**, *курсив*, ссылки полным адресом. */
function inline(node: Node, base: string): string {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/­/g, '').replace(/\s+/g, ' ');
  if (!isElement(node) || skipped(node)) return '';
  const inner = () => [...node.childNodes].map((c) => inline(c, base)).join('');
  switch (node.tagName) {
    case 'CODE': {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ');
      return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
    }
    case 'B':
    case 'STRONG':
      return wrap(inner(), '**');
    case 'EM':
    case 'I':
      return wrap(inner(), '*');
    case 'BR':
      return '\n';
    case 'A': {
      const href = node.getAttribute('href');
      const text = inner().trim();
      return href && text ? `[${text}](${new URL(href, base).href})` : text;
    }
    default:
      return inner();
  }
}

/** `**  x  **` в Markdown не жирный: пробелы выносим за маркеры. */
function wrap(text: string, mark: string): string {
  const m = text.match(/^(\s*)(.*?)(\s*)$/s)!;
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : text;
}

const clean = (text: string) => text.replace(/ +\n/g, '\n').replace(/\n +/g, '\n').replace(/ {2,}/g, ' ').trim();

function table(el: Element, base: string): string {
  const rows = [...el.querySelectorAll('tr')].map((tr) =>
    [...tr.children].map((td) => clean(inline(td, base)).replace(/\|/g, '\\|').replace(/\n/g, ' ')),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${[...r, ...Array(width - r.length).fill('')].join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function list(el: Element, base: string, depth: number): string {
  const ordered = el.tagName === 'OL';
  return [...el.children]
    .filter((li) => li.tagName === 'LI' && !skipped(li))
    .map((li, i) => {
      const pad = '  '.repeat(depth);
      const marker = ordered ? `${i + 1}.` : '-';
      const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
      const own = [...li.childNodes].filter((c) => !nested.includes(c as Element));
      const text = clean(own.map((c) => (isElement(c) && hasBlock(c) ? blocks(c, base).join(' ') : inline(c, base))).join(''));
      return [`${pad}${marker} ${text}`, ...nested.map((n) => list(n, base, depth + 1))].join('\n');
    })
    .join('\n');
}

/** Блоки элемента по порядку; подряд идущие строчные узлы склеиваются в абзац. */
function blocks(el: Element, base: string): string[] {
  const out: string[] = [];
  let para = '';
  const flush = () => {
    const text = clean(para);
    if (text) out.push(text);
    para = '';
  };
  for (const child of el.childNodes) {
    if (!isElement(child)) {
      para += inline(child, base);
      continue;
    }
    if (skipped(child)) continue;
    const tag = child.tagName;
    const block = BLOCK.has(tag) || hasBlock(child);
    if (!block) {
      para += inline(child, base);
      continue;
    }
    flush();
    if (/^H[1-6]$/.test(tag)) {
      const text = clean(inline(child, base));
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
    } else if (tag === 'PRE') {
      const lang = child.getAttribute('data-lang');
      const code = (child.textContent ?? '').replace(/\n$/, '');
      const fence = code.includes('```') ? '~~~' : '```';
      out.push(`${fence}${lang && lang !== 'text' ? lang : ''}\n${code}\n${fence}`);
    } else if (tag === 'UL' || tag === 'OL') {
      const text = list(child, base, 0);
      if (text) out.push(text);
    } else if (tag === 'TABLE') {
      const text = table(child, base);
      if (text) out.push(text);
    } else if (tag === 'BLOCKQUOTE') {
      out.push(blocks(child, base).map((b) => b.replace(/^/gm, '> ')).join('\n>\n'));
    } else if (tag === 'HR') {
      out.push('---');
    } else {
      out.push(...blocks(child, base));
    }
  }
  flush();
  return out;
}

/** Markdown темы: всё содержимое `root`, ссылки — абсолютные от `base` (адрес страницы). */
export function toMarkdown(root: Element, base: string): string {
  return `${blocks(root, base).join('\n\n')}\n\nИсточник: ${base}\n`;
}
