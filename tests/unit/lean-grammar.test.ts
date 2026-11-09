import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { describe, expect, it } from 'vitest';
import { DEMO_SCENARIOS } from '@/content/platform/api-styles/data';
import { THEME_OPTIONS, tokensToLines } from '@/shared/lib/highlight-theme';
import { leanGrammar } from '../../scripts/vite/lean-grammar.mjs';

/**
 * Острова грузят грамматику GraphQL без встроенных JS/TS/JSX/TSX (`scripts/vite/lean-grammar.mjs`).
 * Это экономия в 700 КБ только при условии, что раскраска листингов курса та же. Сверяем с полной
 * грамматикой Shiki на каждом GraphQL-листинге, который печатает остров (`ResolverLab`).
 */
describe('облегчённая грамматика GraphQL', () => {
  const highlighter = (langs: Parameters<typeof createHighlighterCore>[0]['langs']) =>
    createHighlighterCore({ themes: [createCssVariablesTheme(THEME_OPTIONS)], langs, engine: createJavaScriptRegexEngine() });

  it('во встроенных языках не нуждается и даёт ту же раскраску', async () => {
    const lean = leanGrammar('graphql');
    expect(lean.embeddedLangs).toBeUndefined();
    const [full, light] = await Promise.all([
      highlighter([import('shiki/langs/graphql.mjs')]),
      highlighter([[lean]]),
    ]);
    const paint = (h: Awaited<typeof full>, code: string) =>
      tokensToLines(h.codeToTokens(code, { lang: 'graphql', theme: THEME_OPTIONS.name }).tokens);
    expect(DEMO_SCENARIOS.length).toBeGreaterThan(0);
    for (const { query } of DEMO_SCENARIOS) expect(paint(light, query)).toEqual(paint(full, query));
  });
});
