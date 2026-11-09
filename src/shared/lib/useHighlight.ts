/**
 * Подсветка кода в острове: листинг там часто собирается на лету (сменили сценарий — сменился код),
 * поэтому раскрасить его при сборке нельзя.
 *
 * Shiki грузится **динамическим импортом** после монтирования: ядро, движок регулярных выражений
 * на JS (без wasm) и грамматика нужного языка. В статический граф страницы он не входит,
 * и `weight.spec` его не видит; один раз на страницу — около 340 КБ JS, сжатым около 70 КБ. До загрузки и при серверном
 * рендере код печатается одним цветом — так же, как без подсветки.
 */
import { onMounted, ref, watch, type Ref } from 'vue';
import type { HighlighterCore } from 'shiki/core';
import { THEME_OPTIONS, tokensToLines } from './highlight-theme';

/** Языки листингов в демо. `text` — не код (журнал, вывод): печатается одним цветом. */
export type IslandLang = 'js' | 'ts' | 'html' | 'css' | 'json' | 'graphql' | 'sql' | 'yaml' | 'hcl' | 'wgsl' | 'text';
type Grammar = Exclude<IslandLang, 'text'>;

let core: Promise<HighlighterCore> | undefined;
const grammars: Partial<Record<Grammar, Promise<void>>> = {};

/** Грамматика — по запросу: страница с одним JS-листингом не тянет TypeScript. */
const GRAMMAR = {
  js: () => import('shiki/langs/javascript.mjs'),
  ts: () => import('shiki/langs/typescript.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  // Без встроенных JS/TS/JSX/TSX: −700 КБ (`scripts/vite/lean-grammar.mjs`).
  graphql: () => import('virtual:lean-grammar/graphql'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  wgsl: () => import('shiki/langs/wgsl.mjs'),
} satisfies Record<Grammar, () => Promise<unknown>>;

async function load(lang: Grammar): Promise<HighlighterCore> {
  core ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([shiki, engine]) =>
    shiki.createHighlighterCore({
      themes: [shiki.createCssVariablesTheme(THEME_OPTIONS)],
      langs: [],
      engine: engine.createJavaScriptRegexEngine(),
    }),
  );
  const highlighter = await core;
  grammars[lang] ??= GRAMMAR[lang]().then((m) => highlighter.loadLanguage(m.default));
  await grammars[lang];
  return highlighter;
}

/**
 * Строки кода как HTML или `null`, пока Shiki не загружен (тогда печатать текст как есть).
 * Каждая строка исходника — элемент массива, чтобы листинг мог подсветить активную.
 */
export function useHighlight(code: () => string, lang: IslandLang | (() => IslandLang) = 'js'): Ref<string[] | null> {
  const lines = ref<string[] | null>(null);
  const langOf = typeof lang === 'function' ? lang : () => lang;
  onMounted(() => {
    // Язык может смениться вместе с примером (CSS-анимация → rAF): тогда грузится вторая грамматика.
    watch(
      [code, langOf],
      async ([source, current]) => {
        if (current === 'text') return void (lines.value = null);
        const highlighter = await load(current);
        if (source !== code() || current !== langOf()) return; // пока грузили, пример сменился
        lines.value = tokensToLines(highlighter.codeToTokens(source, { lang: current, theme: THEME_OPTIONS.name }).tokens);
      },
      { immediate: true },
    );
  });
  return lines;
}
