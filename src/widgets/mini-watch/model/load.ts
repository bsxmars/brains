import type { CodePatch, MiniWatch, WatchApi } from './types';

/**
 * Сборка мини-реализации из строки и её вариантов.
 *
 * Демо и тест собирают реализацию одним и тем же кодом — этим модулем. Строка `MINI_WATCH_CODE`
 * напечатана в теме по шагам; если текст на странице разойдётся с поведением, покраснеет
 * `tests/unit/vue-watch-internals.test.ts`, который берёт ту же строку.
 *
 * Ни DOM, ни Vue-компонентов: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Имена, под которыми код примеров видит реализацию. Порядок = порядок параметров. */
export const API_NAMES = [
  'ref',
  'reactive',
  'computed',
  'effect',
  'stop',
  'watch',
  'watchEffect',
  'onWatcherCleanup',
  'effectScope',
  'onScopeDispose',
  'nextTick',
] as const satisfies readonly (keyof WatchApi)[];

/** Значения публичных имён реализации — в порядке `API_NAMES`. */
export const apiArgs = (api: Partial<WatchApi>): unknown[] => API_NAMES.map((name) => api[name]);

/** Свежий экземпляр: у каждого своя очередь, свои версии и свой `activeScope`. */
export function loadMiniWatch(code: string): MiniWatch {
  return new Function(code)() as MiniWatch;
}

/**
 * Применить подмены по одной строке. Каждый подменяемый текст обязан существовать: иначе
 * «вариант» молча совпал бы с оригиналом, и демо показывало бы разницу, которой нет.
 */
export function patchCode(code: string, patches: readonly Pick<CodePatch, 'find' | 'replace'>[]): string {
  let out = code;
  for (const { find, replace } of patches) {
    if (!out.includes(find)) throw new Error(`В коде нет строки «${find.trim()}» — шаг переписан, подмена устарела`);
    out = out.replace(find, replace);
  }
  return out;
}

/** Дождаться, пока улягутся микрозадачи и очередь: без таймеров, только промисы. */
export async function settle(api: Pick<WatchApi, 'nextTick'>, rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
    await api.nextTick();
  }
}
