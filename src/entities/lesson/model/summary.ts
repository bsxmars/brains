/**
 * Открытая выжимка темы из summary.md: заголовок и короткий список главных мыслей.
 * Строчную разметку выводит inlineMd; сам Markdown не попадает в HTML страницы.
 */
const FILES = import.meta.glob<string>('/src/content/*/*/summary.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface AnswerKeyItem {
  text: string;
  steps: string[];
}

export interface AnswerKey {
  items: AnswerKeyItem[];
}

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
  const body = source.replace(/^# [^\n]*(?:\n|$)/, '');
  return { items: parseItems(body) };
}

/** Выжимка темы или undefined, если файла или главных тезисов нет. */
export function getAnswerKey(collection: string, id: string): AnswerKey | undefined {
  const source = FILES[`/src/content/${collection}/${id}/summary.md`];
  if (!source) return undefined;
  const key = parseAnswerKey(source);
  return key.items.length ? key : undefined;
}
