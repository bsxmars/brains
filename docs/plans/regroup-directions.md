# План: перегруппировка тем по направлениям

Статус: **выполнен** 2026-10-01. Отступление от плана: `browser-architecture` осталась в `/js/` — она из двенадцати исходных тем, чьи адреса менять нельзя (`docs/agents/architecture.md`). Переехало 22 темы.

## Зачем

«Рендеринг» (23 темы) склеивает браузер и устройство фреймворков. «Платформа» (17 тем) собрана по принципу «всё остальное». Браузерные темы разбросаны по трём направлениям. Читатель приходит из поиска с одним вопросом, и у каждого направления должен быть один ясный вопрос.

## Целевая раскладка

Главный принцип — **сдвинуть как можно меньше адресов**. Идентификаторы `js`, `render`, `platform` сохраняются, меняются только их названия. Поэтому из 64 тем адрес меняется у 23.

| id / адрес | Коллекция | Название | Вопрос на карточке | Тем |
|---|---|---|---|---|
| `js` `/js/` | `lessons` | Внутренности JS | Почему код ведёт себя не так, как написано? | 14 |
| `render` `/render/` | `render` | **Браузер и рендеринг** | Как браузер превращает страницу в пиксели и почему тормозит? | 11 |
| `frameworks` `/frameworks/` | `frameworks` *(новая)* | **Фреймворки изнутри** | Что фреймворк делает за вас и во что это обходится? | 14 |
| `platform` `/platform/` | `platform` | **Сеть и безопасность** | Что происходит между браузером и сервером и кто может этим воспользоваться? | 10 |
| `tooling` `/tooling/` | `tooling` *(новая)* | **Сборка и инструменты** | Что происходит с кодом между редактором и браузером? | 5 |
| `delivery` `/delivery/` | `delivery` | Доставка | без изменений | 10 |

Тексты лидов и вопросов здесь черновые, финальные утверждает автор.

## Что переезжает (23 темы)

| Тема (slug) | Было | Стало |
|---|---|---|
| browser-architecture, browser-extensions | `/js/` | `/render/` |
| workers, wasm-threads | `/platform/` | `/js/` |
| react-vs-vue, react-rerender, react-internals, react-hooks-internals, react-concurrent-internals, server-components, ssr-hydration, signals, framework-compilers, vue-reactivity, vue-internals, vue-patch-internals, vue-watch-internals, vue-vapor | `/render/` | `/frameworks/` |
| modules, typescript, package-managers, hmr, module-federation | `/platform/` | `/tooling/` |

Все slug-и уникальны во всём курсе, поэтому замена адресов однозначна.

### Порядок (`order`) после переноса

- **js**: object-model, callbacks, event-loop, promise-internals, message-channel, task-scheduling, workers, wasm-threads, v8-engine, v8-strings, memory-gc, memory-profiling, node-memory, continuous-profiling.
- **render**: browser-architecture, render-pipeline, css-cascade, rendering-crp, view-transitions, virtual-lists, web-components-styles, webgl, webgpu, browser-engines, browser-extensions.
- **frameworks**: react-vs-vue, react-rerender, react-internals, react-hooks-internals, react-concurrent-internals, server-components, ssr-hydration, signals, framework-compilers, vue-reactivity, vue-internals, vue-patch-internals, vue-watch-internals, vue-vapor.
- **platform**: network, cdn-cache, instant-navigation, realtime, streams, node-streams, security, xs-leaks, third-party-cookies, backend-security.
- **tooling**: modules, typescript, package-managers, hmr, module-federation.

## Шаги

0. **Подготовка.** Дождаться, пока другие сессии в курсе закончат. Сделать первый коммит: в репозитории сейчас нет ни одного, а перенос задевает около 120 файлов, и без коммита его не откатить. Переносить в отдельной ветке `regroup-directions`.
1. **Сущности.** `src/entities/direction/model/directions.ts`: две новые записи, новые названия, лиды и вопросы. В `DirectionId` и `LessonCollection` (`src/entities/lesson/model/lessons.ts`) добавить `frameworks` и `tooling`, в union `Lesson` — их `CollectionEntry`. Обновить комментарии коллекций в `src/content.config.ts` и добавить туда две новые коллекции.
2. **Папки.** `git mv src/content/<старая>/<slug> src/content/<новая>/<slug>` по таблице выше.
3. **Frontmatter перенесённых тем.** `kicker` поставить по новому направлению или удалить: по умолчанию он берётся из направления. Перенумеровать `order` во всех пяти затронутых направлениях по списку выше.
4. **Ссылки и импорты — одним скриптом** (`scripts/dev/regroup.mjs`, таблица `slug → новое направление`):
   - адреса `/<старое>/<slug>/` → `/<новое>/<slug>/` в `src/`, `tests/`, `scripts/` (сейчас ~1100 вхождений, из них к переезжающим темам относится часть);
   - пути импорта `content/<старая>/<slug>/` → `content/<новая>/<slug>/` (84 файла импортируют данные тем);
   - скрипт печатает отчёт: сколько замен в каком файле. Остатки ищутся `rg "/(js|render|platform)/(<slug-и>)/"`, ожидается пусто.
5. **Редиректы со старых адресов.** В `astro.config.mjs` добавить `redirects`: 23 записи, генерируемые из той же таблицы, что и в шаге 4.
6. **Тесты, которые знают структуру:**
   - `tests/e2e/pages.ts`: список `DIRECTIONS` (+ frameworks, tooling);
   - `tests/unit/topic-anatomy.test.ts`: `COLLECTIONS`. Нижний порог «меньше двадцати тем» проверить по смыслу;
   - `tests/e2e/weight.spec.ts`: `HEAVY_PAGES` уедут на `/frameworks/` (это сделает скрипт). Перечитать комментарий о том, почему список поимённый;
   - `tests/unit/neighbours.test.ts`, `routes.spec`, `anchors.spec` должны пройти без правок. Если нет — разобраться, а не подгонять.
7. **Тексты внутри тем.** Найти упоминания направлений словами («в направлении „Рендеринг“», «Платформа») через `rg -n "Рендеринг|Платформ|направлени" src/content` и поправить вручную. Пересмотреть блоки «Смежное на сайте» у перенесённых тем: соседи по направлению сменились.
8. **Главная и `/kit`.** Проверить, что `src/pages/index.astro` сам перечисляет `DIRECTIONS`; шесть карточек должны встать в сетку на 320–1440px.
9. **Документация.** `docs/agents/architecture.md`, раздел «Направления»; шапка `AGENTS.md` (там всё ещё «два направления»); память проекта `js-lessons-migration.md`.

## Проверка

- `npm run build && npm run check && npm test && npm run lint && npm run e2e`. Сравнивать с прогоном **до** переноса, потому что сейчас ~110 юнит-тестов падают независимо от него (бенчмарки, версия Node).
- Число собранных страниц тем до и после одинаковое (64), плюс 23 страницы-редиректа.
- Старый адрес из таблицы (например `/render/react-rerender/`) ведёт на новый.
- Глазами: главная с шестью карточками, по одному списку каждого нового направления, пейджер на краях нового направления.

## Открытые вопросы автору

- Названия и вопросы направлений: «Браузер и рендеринг», «Фреймворки изнутри», «Сеть и безопасность», «Сборка и инструменты».
- `node-streams` — в «Сеть и безопасность» рядом со `streams` или в «Внутренности JS» рядом с памятью Node?
- `browser-extensions` — в «Браузер» или в «Сеть и безопасность» (тема про изолированные миры и безопасность)?
