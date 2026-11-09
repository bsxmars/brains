/**
 * Подсветка при сборке — для `CodeBlock`. В браузер не едет: на страницу приходит готовый HTML.
 * Острова красят свой код сами (`useHighlight.ts`) — та же тема, тот же вид.
 */
import { createCssVariablesTheme, createHighlighter, type BundledLanguage } from 'shiki';
import { THEME_OPTIONS, tokensToLines } from './highlight-theme';

/** Языки, которые встречаются в темах. Не из списка — ошибка типов, а не молча серый код. */
export const CODE_LANGS = [
  'js', 'ts', 'jsx', 'tsx', 'json', 'html', 'css', 'vue', 'svelte', 'graphql',
  'bash', 'shellsession', 'yaml', 'sql', 'docker', 'nginx', 'hcl', 'http',
] as const;
/** `text` — не код: вывод программы, журнал, схема из стрелок. Печатается одним цветом. */
export type CodeLang = (typeof CODE_LANGS)[number] | 'text';

let highlighter: ReturnType<typeof createHighlighter> | undefined;

/** Внутренность `<pre>`: строки из `<span class="c-…">`, переводы строк — как в исходнике. */
export async function highlight(code: string, lang: Exclude<CodeLang, 'text'>): Promise<string> {
  highlighter ??= createHighlighter({
    themes: [createCssVariablesTheme(THEME_OPTIONS)],
    langs: [...CODE_LANGS] as BundledLanguage[],
  });
  const { tokens } = (await highlighter).codeToTokens(code, { lang, theme: THEME_OPTIONS.name });
  return tokensToLines(tokens).join('\n');
}
