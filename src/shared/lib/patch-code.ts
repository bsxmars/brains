/** Подмена: парой `[найти, заменить]` или объектом из данных темы. */
export type CodePatch = readonly [find: string, replace: string] | { readonly find: string; readonly replace: string };

const isPair = (patch: CodePatch): patch is readonly [string, string] => Array.isArray(patch);

/**
 * Применить подмены по одной строке — так собираются «сломанные варианты» реализаций из темы.
 *
 * Каждый подменяемый текст обязан существовать: иначе вариант молча совпал бы с оригиналом,
 * и демо или тест доказывали бы разницу, которой нет.
 */
export function patchCode(code: string, patches: readonly CodePatch[]): string {
  let out = code;
  for (const patch of patches) {
    // Не `'find' in patch`: у массива тоже есть `find` — метод.
    const [find, replace] = isPair(patch) ? patch : [patch.find, patch.replace];
    if (!out.includes(find)) throw new Error(`В коде нет строки «${find.trim()}» — шаг переписан, подмена устарела`);
    out = out.replace(find, replace);
  }
  return out;
}
