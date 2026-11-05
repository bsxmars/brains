import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type VueBuild = 'production' | 'development';

/**
 * Загрузить настоящий Vue заказанной сборки: продакшен (`*.cjs.prod.js`) или отладочную
 * (`*.cjs.js`). `entry` — пакет, с которого начинается загрузка: `reactivity` для одной
 * реактивности, `runtime-core` для рантайма целиком.
 *
 * Кеш `require` по `@vue/*` вычищается перед загрузкой, а резолвер Node на время загрузки
 * переводит `@vue/runtime-core`, `@vue/reactivity` и `@vue/shared` на файлы `dist/` нужной
 * сборки — иначе `runtime-core` из продакшен-сборки подтянул бы отладочную `reactivity`.
 * `files` — какие файлы `@vue/*` на самом деле оказались в кеше: по нему тест проверяет,
 * что сборки не смешались.
 */
export function loadVue<T>(build: VueBuild, entry: 'reactivity' | 'runtime-core'): { api: T; files: string[] } {
  const resolver = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = resolver._resolveFilename;
  const suffix = build === 'production' ? '.prod' : '';
  for (const key of Object.keys(require.cache)) if (key.includes('/node_modules/@vue/')) delete require.cache[key];
  resolver._resolveFilename = function (request, ...rest) {
    const pkg = /^@vue\/(runtime-core|reactivity|shared)$/.exec(request)?.[1];
    if (pkg) return original.call(this, `@vue/${pkg}/dist/${pkg}.cjs${suffix}.js`, ...rest);
    return original.call(this, request, ...rest);
  };
  try {
    const api = require(`@vue/${entry}`) as T;
    const files = Object.keys(require.cache).filter((key) => key.includes('/node_modules/@vue/'));
    return { api, files };
  } finally {
    resolver._resolveFilename = original;
  }
}
