/**
 * Грамматика Shiki без встроенных языков — для подсветки в островах (`shared/lib/useHighlight.ts`).
 *
 * Модуль `shiki/langs/graphql.mjs` статически импортирует JavaScript, TypeScript, JSX и TSX: они
 * нужны, только если внутри GraphQL встречается код на этих языках. В браузер вместе с грамматикой
 * GraphQL (17 КБ) уезжало около 700 КБ чужих грамматик. Плагин отдаёт одну грамматику: тот же
 * JSON из пакета Shiki, без `embeddedLangs`. Что раскраска листингов курса от этого не меняется,
 * сверяет `tests/unit/lean-grammar.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Грамматика языка из `@shikijs/langs` — объект, как его отдаёт `JSON.parse` в самом пакете. */
export function leanGrammar(lang) {
  const file = require.resolve(`@shikijs/langs/${lang}`);
  const source = readFileSync(file, 'utf8');
  const literal = source.match(/JSON\.parse\(("(?:[^"\\]|\\.)*")\)/)?.[1];
  if (!literal) throw new Error(`lean-grammar: в ${file} нет JSON грамматики`);
  const grammar = JSON.parse(JSON.parse(literal));
  delete grammar.embeddedLangs;
  return grammar;
}

const PREFIX = 'virtual:lean-grammar/';

/** `import graphql from 'virtual:lean-grammar/graphql'` → `[грамматика]`, как у `shiki/langs/*`. */
export const leanGrammarPlugin = {
  name: 'lesson:lean-grammar',
  resolveId: (id) => (id.startsWith(PREFIX) ? `\0${id}` : undefined),
  load(id) {
    if (!id.startsWith(`\0${PREFIX}`)) return undefined;
    const grammar = leanGrammar(id.slice(PREFIX.length + 1));
    return `export default [${JSON.stringify(grammar)}];`;
  },
};
