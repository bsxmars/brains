/**
 * Исполнить вывод компилятора Vue как модуль — без сборщика.
 *
 * Вывод `compileScript` — ES-модуль: `import { … } from 'vue'` сверху и `export default`.
 * Здесь импорт из `'vue'` превращается в деструктуризацию переданного объекта, а
 * `export default` — в `return`. Так демо исполняет **литерал вывода** на Vue 3.5 сайта,
 * а тест — тот же литерал на настоящих 3.5 и 3.6: подменить можно любой импорт (счётчики
 * VNode, перехват `ref`), не трогая сам код.
 *
 * ⚠️ Приём годится только для вывода компилятора: он знает одну форму импорта. Импорт
 * компонента (`import X from './X.vue'`) передаётся тем же объектом под его именем.
 */
export function evalModule<T = unknown>(code: string, deps: Record<string, unknown>): T {
  const body = code
    .replace(/import \{([^}]*)\} from ['"]vue['"];?/g, (_, list: string) => `const {${list.replace(/ as /g, ': ')}} = __deps;`)
    .replace(/import (\w+) from ['"][^'"]+['"];?/g, 'const $1 = __deps.$1;')
    .replace('export default', 'return');
  return new Function('__deps', body)(deps) as T;
}

/** Имена, которыми вывод VDOM-компилятора создаёт VNode. Счётчик вешается на каждое. */
export const VNODE_HELPERS = [
  'createElementVNode',
  'createElementBlock',
  'createVNode',
  'createBlock',
  'createCommentVNode',
  'createTextVNode',
] as const;
