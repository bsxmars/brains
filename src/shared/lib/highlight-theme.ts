/**
 * Общее для подсветки при сборке (`highlight.ts`) и в островах (`useHighlight.ts`): тема и
 * перевод токенов Shiki в HTML. Самого Shiki здесь нет — модуль лёгкий и едет в браузер.
 *
 * Тема — css-variables: токен красится `var(--code-…)`, цвета — в `shared/ui/theme.ts`, как
 * любой цвет курса (`palette.spec` сверяет именно с ним). Тёмный и светлый листинг различаются
 * только значениями переменных, разметка одна.
 */
import { escapeHtml } from './format';

/** Параметры `createCssVariablesTheme`. Курсива и жирного нет: у IBM Plex Mono в курсе одно начертание. */
export const THEME_OPTIONS = { name: 'lesson', variablePrefix: '--code-', fontStyle: false } as const;

/**
 * Токен темы → роль курса: у Shiki `var(--code-token-keyword)`, у нас `var(--code-keyword)`.
 * Пунктуация, ссылки и прочее остаются цветом текста — без своего `<span>`.
 */
const ROLE: Record<string, string> = {
  keyword: 'keyword',
  string: 'string',
  'string-expression': 'string',
  comment: 'comment',
  function: 'function',
  constant: 'constant',
  parameter: 'parameter',
};

/** Роль курса для цвета токена Shiki или `undefined` — тогда цвет текста. */
export function roleColor(color: string | undefined): string | undefined {
  const role = ROLE[color?.match(/^var\(--code-token-([a-z-]+)/)?.[1] ?? ''];
  return role && `var(--code-${role})`;
}

interface Token {
  content: string;
  color?: string;
}

/** Строки кода как HTML: по элементу на строку исходника, переводов строк внутри нет. */
export function tokensToLines(tokens: readonly (readonly Token[])[]): string[] {
  return tokens.map((line) =>
    line
      .map((t) => {
        const color = roleColor(t.color);
        const text = escapeHtml(t.content);
        return color ? `<span style="color:${color}">${text}</span>` : text;
      })
      .join(''),
  );
}

interface HastNode {
  properties: Record<string, unknown>;
}

/**
 * Для fenced-блоков MDX (`markdown.shikiConfig` в `astro.config.mjs`): тот же вид, что у `CodeBlock`.
 * Фон и цвет `<pre>` Astro ставит атрибутом — снимаем, их даёт `pre` из `base.css`.
 */
export const fencedTransformer = {
  pre(node: HastNode) {
    delete node.properties.style;
  },
  span(node: HastNode) {
    const style = node.properties.style;
    const color = typeof style === 'string' ? roleColor(style.match(/color:\s*(var\([^)]*\))/)?.[1]) : undefined;
    if (color) node.properties.style = `color:${color}`;
    else delete node.properties.style;
  },
};
