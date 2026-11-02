/**
 * Выжимка темы — «ключ ответа» из `summary.md` рядом с `index.mdx`.
 *
 * Файл лежит в папке темы, но коллекция его не видит: загрузчик берёт только `*\/index.mdx`.
 * Поэтому выжимку читаем здесь, сырым текстом через `import.meta.glob`, и разбираем по одному
 * шаблону — все `summary.md` написаны по нему: заголовок, строка-пояснение, четыре блока
 * `<details>` со списками и строка «Где у нас в проекте». Пометки `> ⚠` — заметки автору,
 * на страницу они не выводятся.
 *
 * Разбор свой, а не markdown-процессор: внутри блоков только списки и строчная разметка,
 * а её курс разбирает `inlineMd` — так текст выжимки выглядит как остальной текст страницы.
 */

const FILES = import.meta.glob<string>('/src/content/*/*/summary.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface AnswerKeyItem {
  text: string;
  /** Вложенный нумерованный список — шаги «Как работает». */
  steps: string[];
}

export interface AnswerKeyBlock {
  title: string;
  hint: string;
  items: AnswerKeyItem[];
}

export interface AnswerKey {
  blocks: AnswerKeyBlock[];
  /** Своя строка читателя; `undefined`, пока там заглушка «заполнить самому». */
  project?: string;
}

const BLOCK = /<details>\s*<summary><b>([^<]+)<\/b>\s*—\s*([^<]+)<\/summary>([\s\S]*?)<\/details>/g;
const PROJECT = /^\*\*Где у нас в проекте:\*\*\s*(.*)$/m;
const PLACEHOLDER = /заполнить самому/;

function parseItems(body: string): AnswerKeyItem[] {
  const items: AnswerKeyItem[] = [];
  for (const raw of body.split('\n')) {
    if (!raw.trim()) continue;
    const top = raw.match(/^- (.*)$/);
    if (top) {
      items.push({ text: top[1].trim(), steps: [] });
      continue;
    }
    const last = items.at(-1);
    if (!last) continue;
    const step = raw.match(/^\s+(?:\d+\.|-)\s+(.*)$/);
    if (step) last.steps.push(step[1].trim());
    else last.text += ` ${raw.trim()}`;
  }
  return items;
}

export function parseAnswerKey(source: string): AnswerKey {
  const blocks = [...source.matchAll(BLOCK)].map(([, title, hint, body]) => ({
    title: title.trim(),
    hint: hint.trim(),
    items: parseItems(body),
  }));
  const project = source.match(PROJECT)?.[1].trim();
  return {
    blocks,
    project: project && !PLACEHOLDER.test(project) ? project : undefined,
  };
}

/** Ключ ответа темы или `undefined`, если `summary.md` рядом с ней нет. */
export function getAnswerKey(collection: string, id: string): AnswerKey | undefined {
  const source = FILES[`/src/content/${collection}/${id}/summary.md`];
  if (!source) return undefined;
  const key = parseAnswerKey(source);
  return key.blocks.length ? key : undefined;
}
