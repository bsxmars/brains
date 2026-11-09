/** Виртуальные модули Vite из `scripts/vite/*` — объявления для TypeScript. */
declare module 'virtual:lean-grammar/*' {
  import type { LanguageRegistration } from 'shiki/core';
  const grammar: LanguageRegistration[];
  export default grammar;
}
