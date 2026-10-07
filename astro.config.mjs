import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import vue from '@astrojs/vue';
import { defineConfig } from 'astro/config';

/**
 * Выключатель React Fast Refresh.
 *
 * ⚠️ Без него дев-сервер отдаёт 500 на каждой странице с Vue-островом:
 * `ReferenceError: $RefreshSig$ is not defined`.
 *
 * Причина не в наших файлах. Здесь rolldown-vite, и плагин React включает рефреш не своим
 * трансформом, а глобальным ключом `oxc.jsx.refresh` — вместе с фильтрами `jsxRefreshInclude`
 * и `jsxRefreshExclude`. Фильтры до Vue-модулей не доходят: скомпилированный блок SFC получает
 * инструментацию рефреша (`$RefreshSig$`), а преамбулу, которая эту функцию объявляет, — нет,
 * потому что преамбулу вставляют только в страницы с React. Проверено опытом: список исключений
 * с масками Vue-файлов у плагина ничего не меняет, а без react() те же страницы отдают 200.
 *
 * Плагин стоит после интеграций намеренно: конфиги плагинов сливаются по порядку, и побеждает
 * последний. Цена — в разработке React-острова перезагружаются целиком, без сохранения
 * состояния. На сборку это не влияет вовсе: рефреш живёт только в `serve`.
 */
const disableReactRefresh = {
  name: 'lesson:no-react-refresh',
  config: () => ({ oxc: { jsx: { refresh: false } } }),
};

/**
 * Базовый путь сайта. Локально и в дев-сервере сайт в корне; на GitHub Pages проекта — в
 * подкаталоге `/<repo>/`, его передаёт сборка в CI (`BASE_PATH`). Ссылки из кода собираются
 * через `withBase` (`src/shared/lib/url.ts`), остальные дописывает `baseLinks` ниже.
 */
const BASE = process.env.BASE_PATH || '/';

/**
 * Ссылки от корня в готовых страницах получают базу: `href="/js/…"` → `href="/brains/js/…"`.
 *
 * Без этого на `user.github.io/repo/` они ведут мимо сайта: сборщик переписывает только пути
 * к собственным файлам (`/_astro/…`), а адрес, написанный человеком, — `[текст](/js/…)` в MDX,
 * `<a href="/js/…">`, адрес редиректа — для него просто строка. Ровно эта поломка разобрана
 * в уроке «GitHub Pages».
 *
 * Правка после сборки, а не плагином MDX: Markdown внутри JSX-компонентов идёт мимо
 * rehype-плагинов, и часть ссылок оставалась бы без базы. Трогаем только настоящие атрибуты —
 * примеры кода в уроках экранированы (`&quot;`) и под шаблон не попадают. Ссылки, которые
 * собирает код (`inlineMd`, `lessonHref`), базу получают сами, через `withBase`.
 */
function baseLinks() {
  const prefix = BASE.replace(/\/+$/, '');
  const attr = /\b(href|src|action)="\/(?!\/)/g;
  const refresh = /(content="\d+;\s*url=)\/(?!\/)/gi;
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [],
    );
  return {
    name: 'lesson:base-links',
    hooks: {
      'astro:build:done': ({ dir }) => {
        if (!prefix) return;
        const skip = prefix.slice(1) + '/';
        for (const file of walk(fileURLToPath(dir))) {
          const html = readFileSync(file, 'utf8');
          const out = html
            .replace(attr, (m, name, offset) => (html.startsWith(skip, offset + m.length) ? m : `${name}="${prefix}/`))
            .replace(refresh, (m, head, offset) => (html.startsWith(skip, offset + m.length) ? m : `${head}${prefix}/`));
          if (out !== html) writeFileSync(file, out);
        }
      },
    },
  };
}

export default defineConfig({
  site: process.env.SITE_URL,
  base: BASE,
  /**
   * Старые адреса тем, переехавших между направлениями 2026-10-01
   * (docs/plans/regroup-directions.md). Ссылки извне живут дольше, чем наша раскладка.
   */
  redirects: {
    '/js/browser-extensions/': '/render/browser-extensions/',
    '/platform/workers/': '/js/workers/',
    '/platform/wasm-threads/': '/js/wasm-threads/',
    '/render/react-vs-vue/': '/frameworks/react-vs-vue/',
    '/render/react-rerender/': '/frameworks/react-rerender/',
    '/render/react-internals/': '/frameworks/react-internals/',
    '/render/react-hooks-internals/': '/frameworks/react-hooks-internals/',
    '/render/react-concurrent-internals/': '/frameworks/react-concurrent-internals/',
    '/render/server-components/': '/frameworks/server-components/',
    '/render/ssr-hydration/': '/frameworks/ssr-hydration/',
    '/render/signals/': '/frameworks/signals/',
    '/render/framework-compilers/': '/frameworks/framework-compilers/',
    '/render/vue-reactivity/': '/frameworks/vue-reactivity/',
    '/render/vue-internals/': '/frameworks/vue-internals/',
    '/render/vue-patch-internals/': '/frameworks/vue-patch-internals/',
    '/render/vue-watch-internals/': '/frameworks/vue-watch-internals/',
    '/render/vue-vapor/': '/frameworks/vue-vapor/',
    '/platform/modules/': '/tooling/modules/',
    '/platform/typescript/': '/tooling/typescript/',
    '/platform/package-managers/': '/tooling/package-managers/',
    '/platform/hmr/': '/tooling/hmr/',
    '/platform/module-federation/': '/tooling/module-federation/',
  },
  /**
   * Две UI-интеграции уживаются без настройки: Vue забирает `.vue`, React — `.jsx`/`.tsx`,
   * пересечения нет. React нужен направлению «Фреймворки изнутри»: урок про ре-рендеринг обязан показывать
   * настоящий React, иначе это рассказ о нём. На страницы «Внутренностей JS» он не попадает —
   * острова грузятся только там, где стоят.
   *
   * `mdx()` идёт последним намеренно: он должен видеть уже подключённые интеграции.
   */
  integrations: [
    vue(),
    // `include` обязателен: по умолчанию плагин React забирает все `.ts`/`.tsx` проекта —
    // включая `data.ts` уроков и модели виджетов, которым React не нужен вовсе. Сужаем до
    // файлов с JSX. Vue при этом идёт первым намеренно: он опознаёт свои компоненты дешёвой
    // проверкой, а React на чужом компоненте сначала пробует его отрендерить.
    react({ include: ['**/*.tsx', '**/*.jsx'] }),
    mdx(),
    baseLinks(),
  ],

  /**
   * Подсветки синтаксиса в оригинальных уроках нет: `<pre>` монохромный, #E9E6DE на #17150F.
   * Добавить её — значит сменить вид, поэтому выключаем, и fenced-блоки получают стиль
   * элемента `pre` из `shared/styles/base.css`.
   */
  markdown: { syntaxHighlight: false },

  vite: {
    plugins: [disableReactRefresh],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  },
});
