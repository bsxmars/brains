/**
 * Разметка внутри строковых пропов — только строчная: `код` и **жирный**.
 *
 * Зачем вообще: заголовки и лиды уроков наполовину состоят из `.then`, `await` и
 * `Promise.resolve`, а живут они во frontmatter и в пропах компонентов, где markdown не
 * работает. Полноценный парсер тут не нужен — нужны ровно два росчерка, которые есть
 * в оригиналах.
 *
 * Порядок операций важен: сначала экранируем HTML, потом расставляем свои теги, иначе
 * текст из данных мог бы принести собственную разметку.
 */
import { withBase } from './url';

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ESCAPE[ch] ?? ch);
}

/**
 * Ссылка на соседнюю тему: `[текст](/js/event-loop/)`.
 *
 * Третья метка появилась, когда темы начали ссылаться друг на друга по-настоящему. До этого
 * связь держалась на словах («в уроке про MessageChannel»), и у автора оставалось давление
 * пересказывать соседнюю тему вместо ссылки на неё.
 *
 * ⚠️ Адрес обязан начинаться со `/` — то есть вести внутрь сайта. Это не про аккуратность,
 * а про безопасность: текст приходит из `data.ts` и frontmatter и вставляется как HTML,
 * поэтому `javascript:`, `data:` и чужие домены сюда не пускаются вовсе. Внешние ссылки
 * в строчной разметке не поддерживаются: им место в списке источников, где видно, куда ведут.
 */
// Адрес — путь сайта (`/js/…`) или якорь на той же странице (`#s8`). До 2026-09-30 якорь
// не разбирался вовсе: `[«Отмена»](#s8)` доезжал до читателя сырой разметкой в трёх темах.
const LINK = /\[([^\]]+)\]\(((?:\/|#)[^)\s]*)\)/g;

/**
 * Текст ссылки — по словам, каждое в своём `<span>`; подчёркивает CSS только их (`a.words`).
 *
 * Проза курса выровнена по ширине, и браузер растягивает пробелы. Подчёркивание самой `<a>`
 * шло и по растянутому пробелу: в узкой карточке под «изнутри», раздел» тянулась черта
 * в полстроки (замечание автора курса 2026-10-27). Режем только по пробелам вне тегов,
 * чтобы не разорвать `<code>` и `<b>`.
 */
export function splitWords(label: string): string {
  const out: string[] = [];
  let word = '';
  let depth = 0;
  for (const token of label.match(/<[^>]+>|\s+|[^<\s]+/g) ?? []) {
    if (token.startsWith('</')) depth--;
    else if (token.startsWith('<')) depth++;
    if (depth === 0 && /^\s+$/.test(token)) {
      if (word) out.push(`<span>${word}</span>`);
      out.push(' ');
      word = '';
    } else word += token;
  }
  if (word) out.push(`<span>${word}</span>`);
  return out.join('');
}

/**
 * То же для готовой страницы: ссылки из MDX (`[текст](/js/…)` в теле темы) до `inlineMd`
 * не доходят. Режем только ссылки без `class` — это ссылки прозы; у навигации и кнопок класс
 * есть, и подчёркивания у них нет. Острова Vue и React не трогаем: их разметку сверяет
 * гидратация, и чужой `<span>` в ней — расхождение.
 */
const ISLAND = /<astro-island\b[\s\S]*?<\/astro-island>/g;
const PLAIN_LINK = /<a href="([^"]*)">([^<]*(?:<(?!\/a>)[^<]*)*)<\/a>/g;

export function splitLinkWordsInHtml(html: string): string {
  const fix = (part: string) =>
    part.replace(PLAIN_LINK, (whole, href: string, label: string) =>
      /\s/.test(label) ? `<a class="words" href="${href}">${splitWords(label)}</a>` : whole,
    );
  let out = '';
  let last = 0;
  for (const m of html.matchAll(ISLAND)) {
    out += fix(html.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + fix(html.slice(last));
}

export function inlineMd(text: string): string {
  return (
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      // Ссылка разбирается последней: внутри её текста работают обе предыдущие метки.
      .replace(LINK, (_, label: string, href: string) =>
        /\s/.test(label)
          ? `<a class="words" href="${withBase(href)}">${splitWords(label)}</a>`
          : `<a href="${withBase(href)}">${label}</a>`,
      )
  );
}

/**
 * Тот же текст, но без разметки вовсе — для мест, где HTML не к месту.
 *
 * Нужен описанию страницы: `<meta name="description">` — это атрибут, теги в нём не работают,
 * и разметка доезжает до поисковой выдачи и превью ссылки вместе со звёздочками и кавычками.
 * Значки убираем, слова оставляем.
 */
export function plainMd(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(LINK, '$1');
}

/** «1 тик» / «2 тика» / «5 тиков» — счётная форма, как в оригинале. */
export function ticks(n: number): string {
  return `${n} ${n === 1 ? 'тик' : n < 5 ? 'тика' : 'тиков'}`;
}

/**
 * «1 тема» / «2 темы» / «5 тем» — счёт разборов внутри направления.
 *
 * Живёт здесь, а не в карточке направления: то же число печатает и заголовок страницы списка,
 * а два места, склоняющие одно слово каждый по-своему, однажды разойдутся. Правило русское,
 * а не «n === 1»: у 11–14 форма своя, и без этой ветки получилось бы «11 тема».
 */
export function topics(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} тем`;
  if (mod10 === 1) return `${n} тема`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} темы`;
  return `${n} тем`;
}
