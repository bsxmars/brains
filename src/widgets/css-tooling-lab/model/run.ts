import type { ModuleNamer, Scanner } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `MODULE_NAME_CODE` и `TW_SCAN_CODE`
 * из темы «CSS-инструменты».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/css-tooling.test.ts`: имена — против Vite 8 (postcss-modules внутри него),
 * сканер — против oxide и компилятора Tailwind 4.3.3. Копии нет: разойдётся показанный код
 * с настоящим инструментом — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModuleNamer(code: string): ModuleNamer {
  return new Function(`${code}\nreturn { stringHash, scopedName, moduleExports };`)() as ModuleNamer;
}

export function loadScanner(code: string): Scanner {
  return new Function(`${code}\nreturn scanCandidates;`)() as Scanner;
}
