import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { CacheMode, CacheRun, FilterPreset, WsPackage } from '@/widgets/monorepo-lab/model/types';

/**
 * Данные темы «Монорепозиторий: воркспейсы и граф задач».
 *
 * Тема написана здесь, 2026-10-01. Соседняя тема «Пакетные менеджеры» уже разбирает подъём,
 * фантомные зависимости, копии одной версии, хранилище pnpm и lock-файл — на одном проекте.
 * Здесь это не пересказывается: тема смотрит на то же **между пакетами одного репозитория**
 * и идёт дальше — в граф пакетов, порядок сборки, фильтр по изменениям и кеш задач.
 *
 * ── Стенд (октябрь 2026, без сети) ──────────────────────────────────────────────────────
 * Node 24.11.0, npm 11.6.1, pnpm 11.0.9, git 2.44.0, macOS (APFS). Каталог стенда —
 * scratchpad/agent-monorepo. Реестр — сорок строк на `node:http` на 127.0.0.1:51200: отдаёт
 * документ пакета и тарболы трёх учебных пакетов (`tiny-color@1.0.0`, `clock@1.4.0`,
 * `clock@2.1.0`, собраны `npm pack`), дата публикации 2020 год. Пользовательский `.npmrc`
 * подменён файлом фикстуры (`NPM_CONFIG_USERCONFIG`), кеш npm и хранилище pnpm — в каталоге
 * стенда.
 *
 * Фикстура — монорепозиторий `shop` из пяти пакетов (`MANIFESTS` ниже). Генератор пишет два
 * варианта: для pnpm — с `workspace:*`/`^`/`~` и `pnpm-workspace.yaml`, для npm — с полем
 * `workspaces` и диапазоном `^1.0.0` вместо протокола. Сборка пакета — `BUILD_JS`: проверяет,
 * что собраны соседи (`require.resolve` на их `main` → `dist/index.js`), и копирует `src` в
 * `dist`. Каждый запуск пишет `start <имя>` в общий журнал — отсюда порядок запуска.
 *
 * Что снято и как:
 *   — раскладки `NPM_TREE_CODE` и `PNPM_TREE_CODE` — `ls -l` и `readlink` после установки
 *     с чистого листа (без lock-файла и `node_modules`); вывод `ls` сокращён до типа, имени
 *     и цели ссылки;
 *   — `npm install` с `workspace:*` — `EUNSUPPORTEDPROTOCOL`; pnpm с обычным `^1.0.0` на
 *     соседа — запрос `GET /@shop%2Fui` в журнале реестра и `ERR_PNPM_FETCH_404`;
 *   — `PACK_ROWS` — `pnpm pack` трёх пакетов, `package.json` вынут из тарбола `tar -xOzf`;
 *     у npm `npm pack` оставил `^1.0.0` как есть;
 *   — фантом: `node apps/web/src/index.js` после сборки, вывод как есть; путь стенда в стеке
 *     заменён на `…`;
 *   — копии: `npm ls clock`, `pnpm why clock -r`;
 *   — порядок: `npm run build --workspaces` с чистыми `dist` и `pnpm -r run build` —
 *     с `--workspace-concurrency=1` (порядок стабилен) и по умолчанию (внутри уровня порядок
 *     меняется от прогона к прогону: три прогона дали `admin, web` и дважды `web, admin`);
 *   — барьер уровня: отдельная фикстура из трёх пакетов `a` (сборка 1.5 с), `b`, `c → b`;
 *     журнал `BARRIER_LOG` повторился на втором прогоне;
 *   — фильтр: git-репозиторий с голым `origin`, ветка `feature`; правка одного файла,
 *     `pnpm --filter "...[origin/main]" exec node -p name`, отсортировано. Неотслеживаемый
 *     новый файл фильтр не увидел, после `git add` — увидел. Коммит в `main`, которого нет
 *     в `feature`, попал в выборку (`admin`): pnpm сравнивает с концом `origin/main`, как
 *     `git diff origin/main`, а не с точкой ответвления;
 *   — цикл: в фикстуре барьера `b → c`, `c → b`; `pnpm -r run build` без предупреждений,
 *     журнал `start a, end a, start c, start b, end c, end b`.
 *
 * Всё перечисленное — литералы; `tests/unit/monorepo.test.ts` сверяет с ними учебные функции
 * темы (`GRAPH_CODE`, `PUBLISH_CODE`) и проверяет, что граф, порядок и фильтры согласованы
 * с манифестами. Сами менеджеры тест не запускает: им нужен реестр, а pnpm 11 перед `-r exec`
 * ещё и сам доустанавливает зависимости.
 *
 * ── Что по документации, без запуска ────────────────────────────────────────────────────
 * Turborepo и Nx на машине не установлены. Кеш задач в теме — учебная модель (`CACHE_CODE`),
 * её поведение закреплено тестом, но поведение Turborepo (состав хеша, `envMode: strict` по
 * умолчанию, вывод фреймворков `NEXT_PUBLIC_*`/`VITE_*`, восстановление `outputs` и логов)
 * и Nx (переменные окружения не входят в хеш, пока их не объявили в `inputs`) — по их
 * документации, ссылки в `SOURCES`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'монорепозиторий',
    d: 'Один git-репозиторий, в котором лежит несколько пакетов: приложения, общая библиотека компонентов, клиент API. У каждого свой `package.json`, а история, lock-файл и CI — общие.',
  },
  {
    k: 'воркспейс (workspace)',
    d: 'Пакет монорепозитория, о котором знает менеджер пакетов. Список воркспейсов задают шаблоном папок: полем `workspaces` в корневом `package.json` у npm и файлом `pnpm-workspace.yaml` у pnpm.',
  },
  {
    k: 'симлинк',
    d: 'Файл-указатель на другую папку. Через него пакет из соседней папки виден в `node_modules` без копирования: правка в `packages/ui` сразу видна всем, кто его импортирует.',
  },
  {
    k: 'фантомная зависимость',
    d: 'Пакет, который код импортирует, не объявив его в своём `package.json`. Работает, пока его случайно кладёт рядом кто-то другой, и ломается, когда раскладка меняется.',
  },
  {
    k: 'граф пакетов',
    d: 'Кто от кого зависит внутри репозитория: стрелка от `@shop/ui` к `@shop/utils` значит «ui импортирует utils». Внешние пакеты из реестра в этот граф не входят.',
  },
  {
    k: 'топологический порядок',
    d: 'Порядок, в котором каждый пакет идёт после всех своих зависимостей. Сборка в таком порядке находит соседей уже собранными.',
  },
  {
    k: 'зависимые (dependents)',
    d: 'Пакеты, которые зависят от данного — прямо или через других. У `@shop/utils` в примере темы зависимые все четыре остальных пакета.',
  },
  {
    k: 'кеш задач',
    d: 'Запись «задача с такими входами уже выполнялась, вот её результат». Если входы не изменились, результат берут из записи, а задачу не запускают.',
  },
];

export const PLAIN_MONOREPO =
  'Как общая мастерская вместо пяти гаражей. Инструменты лежат на общих полках, детали одного станка сразу доступны соседнему, не надо ничего пересылать почтой. Но тогда нужен порядок: кто чем пользуется, что собирать первым, и как не переделывать заново то, что никто не трогал.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи, разобранные в других темах сайта. Здесь они нужны только как опора — повторять их не будем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' | 'ok' }[] = [
  {
    t: 'Как Node находит пакет по имени',
    d: '`require(\'tiny-color\')` ищет папку `tiny-color` в `node_modules` рядом с файлом, потом папкой выше — и так до корня диска. `package.json` с его `dependencies` загрузчик при этом не читает.',
    href: '/tooling/modules/#s3',
    hrefLabel: '«Модули и сборка», раздел «CommonJS против ESM и цена их стыковки»',
    tone: 'info',
  },
  {
    t: 'Подъём, фантомы и хранилище pnpm',
    d: 'npm поднимает зависимости в общий `node_modules` корня, и от этого становятся видны необъявленные пакеты. pnpm кладёт пакеты в `node_modules/.pnpm` и даёт каждому только объявленное.',
    href: '/tooling/package-managers/#s2',
    hrefLabel: '«Пакетные менеджеры», разделы «Разрешение дерева и подъём» и «pnpm и Yarn PnP»',
    tone: 'info',
  },
  {
    t: 'Хеш как имя содержимого',
    d: 'SHA-256 от одних и тех же байтов всегда один и тот же, а от изменённых — другой. Поэтому хеш годится как ключ: «результат для вот этих входов».',
    href: '/delivery/docker/#s1',
    hrefLabel: '«Docker: образ и слои», раздел «Что такое образ на самом деле»',
    tone: 'ok',
  },
];

// ─── Раздел 1. Воркспейсы ──────────────────────────────────────────────────────────────────

/**
 * Манифесты фикстуры в варианте для pnpm. Граф `PACKAGES` выводится из них ниже, а не
 * набирается отдельно: тест проверяет, что это одно и то же.
 */
export const MANIFESTS: { dir: string; name: string; dependencies: Record<string, string> }[] = [
  { dir: 'packages/utils', name: '@shop/utils', dependencies: {} },
  { dir: 'packages/ui', name: '@shop/ui', dependencies: { '@shop/utils': 'workspace:*', 'tiny-color': '^1.0.0' } },
  { dir: 'packages/api', name: '@shop/api', dependencies: { '@shop/utils': 'workspace:^' } },
  { dir: 'apps/web', name: '@shop/web', dependencies: { '@shop/ui': 'workspace:*', '@shop/api': 'workspace:~', clock: '^1.0.0' } },
  { dir: 'apps/admin', name: '@shop/admin', dependencies: { '@shop/ui': 'workspace:*', clock: '^2.0.0' } },
];

/** Граф пакетов: у каждого — только соседи из того же репозитория. */
export const PACKAGES: WsPackage[] = MANIFESTS.map((m) => ({
  name: m.name,
  dir: m.dir,
  deps: Object.keys(m.dependencies).filter((d) => MANIFESTS.some((o) => o.name === d)),
}));

export const LAYOUT_CODE = `shop/
├─ package.json            "workspaces": ["packages/*", "apps/*"]   ← для npm
├─ pnpm-workspace.yaml     packages: ['packages/*', 'apps/*']       ← для pnpm
├─ packages/
│  ├─ utils/   @shop/utils   formatPrice()
│  ├─ ui/      @shop/ui      → @shop/utils, tiny-color@^1
│  └─ api/     @shop/api     → @shop/utils
└─ apps/
   ├─ web/     @shop/web     → @shop/ui, @shop/api, clock@^1
   └─ admin/   @shop/admin   → @shop/ui, clock@^2`;

export const WEB_MANIFEST_CODE = `{
  "name": "@shop/web",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": { "build": "node build.js" },
  "dependencies": {
    "@shop/ui": "workspace:*",
    "@shop/api": "workspace:~",
    "clock": "^1.0.0"
  }
}`;

export const PLAIN_SYMLINK =
  'Как ярлык на рабочем столе. Папка с программой лежит в одном месте, а ярлык — там, где её ищут. Удалите ярлык — программа цела; поправьте программу — через ярлык откроется уже новая. Менеджер ставит такие ярлыки в `node_modules`, и загрузчик Node находит соседний пакет так же, как пакет из реестра.';

export const NPM_TREE_CODE = `$ npm install                      # npm 11.6.1, "@shop/utils": "^1.0.0" и т. д.
added 8 packages

$ ls -l node_modules node_modules/@shop
node_modules:
drwxr-xr-x  @shop
drwxr-xr-x  clock
drwxr-xr-x  tiny-color

node_modules/@shop:
lrwxr-xr-x  admin -> ../../apps/admin
lrwxr-xr-x  api   -> ../../packages/api
lrwxr-xr-x  ui    -> ../../packages/ui
lrwxr-xr-x  utils -> ../../packages/utils
lrwxr-xr-x  web   -> ../../apps/web

$ ls -l apps/web/node_modules
drwxr-xr-x  clock                  ← вложенная копия, о ней ниже`;

export const PNPM_TREE_CODE = `$ pnpm install                     # pnpm 11.0.9, "@shop/utils": "workspace:*" и т. д.
Scope: all 6 workspace projects
Packages: +3

$ ls -lA node_modules              # в корне — ни одного @shop
.modules.yaml
.pnpm/
.pnpm-workspace-state-v1.json

$ readlink apps/web/node_modules/@shop/ui apps/web/node_modules/clock
../../../../packages/ui
../../../node_modules/.pnpm/clock@1.4.0/node_modules/clock

$ readlink packages/ui/node_modules/@shop/utils packages/ui/node_modules/tiny-color
../../../utils
../../../node_modules/.pnpm/tiny-color@1.0.0/node_modules/tiny-color

$ ls node_modules/.pnpm
clock@1.4.0   clock@2.1.0   lock.yaml   node_modules   tiny-color@1.0.0`;

export const TREE_NOTE =
  'Оба менеджера ставят соседа **симлинком**, а не копией: `packages/ui` существует на диске один раз. Разница в том, **где** лежит ссылка. npm кладёт все пять пакетов в корневой `node_modules/@shop` — их видит любой файл репозитория. pnpm кладёт ссылку в `node_modules` того пакета, который соседа объявил: у `apps/web` есть `@shop/ui` и `@shop/api`, а у `apps/admin` — только `@shop/ui`. Внешние пакеты из реестра у pnpm живут в `node_modules/.pnpm`, тоже по ссылке.';

export const LOCK_IMPORTERS_CODE = `importers:

  .: {}

  apps/web:
    dependencies:
      '@shop/api':
        specifier: workspace:~
        version: link:../../packages/api
      '@shop/ui':
        specifier: workspace:*
        version: link:../../packages/ui
      clock:
        specifier: ^1.0.0
        version: 1.4.0

  packages/ui:
    dependencies:
      '@shop/utils':
        specifier: workspace:*
        version: link:../utils
      tiny-color:
        specifier: ^1.0.0
        version: 1.0.0`;

export const LOCK_NOTE =
  'В `pnpm-lock.yaml` у каждого пакета репозитория своя запись в `importers`. Для соседа вместо версии стоит `link:` и относительный путь — lock-файл фиксирует, что `@shop/ui` берётся из папки, а не из реестра. Для `clock` у `web` и у `admin` записаны разные версии, и обе живут в одном lock-файле.';

// ─── Протокол workspace: ─────────────────────────────────────────────────────────────────

export const PLAIN_WORKSPACE_PROTOCOL =
  '`workspace:*` — как пометка «взять со своего склада» в заявке. Пока заявка внутри фирмы, её выполняет свой склад, и никакой поставщик не нужен. Когда заявку отправляют наружу (публикуют пакет), пометку заменяют обычным номером артикула — иначе чужой поставщик её не поймёт.';

/**
 * Во что `pnpm pack` превратил спецификатор: снято со стенда, `package.json` вынут из тарбола.
 * Локальная версия у всех соседей — `1.0.0`. `PUBLISH_CODE` обязан дать то же самое.
 */
export const PACK_ROWS: { pkg: string; dep: string; spec: string; packed: string }[] = [
  { pkg: '@shop/ui', dep: '@shop/utils', spec: 'workspace:*', packed: '1.0.0' },
  { pkg: '@shop/api', dep: '@shop/utils', spec: 'workspace:^', packed: '^1.0.0' },
  { pkg: '@shop/web', dep: '@shop/api', spec: 'workspace:~', packed: '~1.0.0' },
  { pkg: '@shop/web', dep: '@shop/ui', spec: 'workspace:*', packed: '1.0.0' },
];

/** Учебная замена спецификатора при публикации — то, что делает `pnpm pack`/`pnpm publish`. */
export const PUBLISH_CODE = `// spec — что написано в package.json, version — версия соседа в репозитории.
function publishSpec(spec, version) {
  if (!spec.startsWith('workspace:')) return spec;   // обычный диапазон не трогаем
  const rest = spec.slice('workspace:'.length);
  if (rest === '*') return version;                  // ровно эта версия
  if (rest === '^' || rest === '~') return rest + version;
  return rest;                                       // workspace:^1.2.0 → ^1.2.0
}`;

export const PROTOCOL_ROWS: { k: string; npm: string; pnpm: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`"@shop/utils": "workspace:*"`',
    npm: '`npm error code EUNSUPPORTEDPROTOCOL` — `Unsupported URL Type "workspace:"`',
    pnpm: 'ссылка на папку; если соседа с таким именем нет — ошибка, в реестр не ходит',
    tone: 'ok',
  },
  {
    k: '`"@shop/utils": "^1.0.0"`, локальная версия `1.0.0`',
    npm: 'ссылка на папку: версия подошла',
    pnpm: '**запрос в реестр** `GET /@shop%2Fui` и `ERR_PNPM_FETCH_404` — по умолчанию pnpm соседа по диапазону не связывает',
    tone: 'err',
  },
  {
    k: '`"@shop/ui": "^2.0.0"`, локальная версия `1.0.0`',
    npm: 'запрос в реестр и `E404` — версия соседа не подошла, npm ищет снаружи',
    pnpm: 'как строкой выше: в реестр',
    tone: 'err',
  },
];

export const PROTOCOL_NOTE =
  'Протокол `workspace:` нужен не для красоты. Обычный диапазон говорит «подойдёт любая такая версия», и менеджер вправе найти её **в реестре**. На стенде реестр ответил 404. Если бы там лежал чужой пакет с тем же именем, он бы и установился — это атака подменой зависимости (dependency confusion). `workspace:*` говорит «только сосед», и до реестра дело не доходит. Протокол понимают pnpm, Yarn и Bun, а npm 11 его не принимает.';

// ─── Раздел 2. Фантомы и копии ────────────────────────────────────────────────────────────

export const WEB_SRC_CODE = `// apps/web/src/index.js
const { PriceTag } = require('@shop/ui');
const color = require('tiny-color'); // не объявлен в apps/web/package.json
console.log(PriceTag(990), color.version);`;

export const PHANTOM_NPM_CODE = `$ node apps/web/src/index.js        # npm
<b>990.00 ₽</b> 1.0.0 1.0.0

$ node -p "require.resolve('tiny-color')"
…/fx-npm/node_modules/tiny-color/index.js`;

export const PHANTOM_PNPM_CODE = `$ node apps/web/src/index.js        # pnpm
Error: Cannot find module 'tiny-color'
Require stack:
- …/fx-pnpm/apps/web/src/index.js
  code: 'MODULE_NOT_FOUND'`;

export const PHANTOM_NOTE =
  '`tiny-color` объявил только `@shop/ui`. npm поднял его в корневой `node_modules`, и поиск вверх из `apps/web` до него дошёл — фантом работает. pnpm оставил его в `.pnpm` и дал ссылку только `packages/ui`. В `.pnpm/node_modules` есть скрытая ссылка на `tiny-color`, но `apps/web` лежит не внутри `.pnpm`, и поиск вверх туда не заглядывает. Почему в одном проекте под pnpm фантомы пакетов всё-таки работают, разобрано в [«Пакетных менеджерах»](/tooling/package-managers/#s5).';

export const PHANTOM_DANGER =
  'В монорепозитории фантом опаснее, чем в одном проекте: его версию выбирает **соседний пакет**. Команда `ui` обновит `tiny-color` до `^2` — и сломается `web`, хотя ни один файл `web` не менялся. Здесь фильтр «только изменённое» ещё спасёт: `web` объявил `ui`, и правка в `ui` пересоберёт `web`. Но npm кладёт в корень зависимости **всех** воркспейсов, и фантом может прийти от пакета, от которого `web` не зависит вовсе. Тогда правка в том пакете в выборку `web` не попадёт, и поломку увидят только после выкатки.';

export const DUP_NPM_CODE = `$ npm ls clock
shop@
├─┬ @shop/admin@1.0.0 -> ./apps/admin
│ └── clock@2.1.0                  ← в корневом node_modules
└─┬ @shop/web@1.0.0 -> ./apps/web
  └── clock@1.4.0                  ← в apps/web/node_modules`;

export const DUP_PNPM_CODE = `$ pnpm why clock -r
clock@1.4.0
└── @shop/web@1.0.0 (dependencies)

clock@2.1.0
└── @shop/admin@1.0.0 (dependencies)

Found 2 versions of clock`;

export const DUP_NOTE =
  '`web` хочет `clock@^1`, `admin` — `clock@^2`. Это нормально: пакеты монорепозитория вправе жить на разных версиях. npm кладёт в корень ту, что пришла первой по алфавиту воркспейсов (`admin` раньше `web`), и любой файл репозитория без своей копии получит **вторую** мажорную версию. pnpm держит обе в `.pnpm`, и каждый видит свою. Плохо становится, когда копии — это библиотека с состоянием (React, Vue, стор): две копии значат два контекста, и об этом — [«Модули и сборка»](/tooling/modules/#s3) и [«Микрофронтенды»](/tooling/module-federation/#s3).';

// ─── Раздел 3. Граф и порядок ─────────────────────────────────────────────────────────────

export const BUILD_JS = `// build.js — одинаковый у всех пяти пакетов
const fs = require('node:fs');
const pkg = require('./package.json');
for (const dep of Object.keys(pkg.dependencies ?? {})) {
  if (dep.startsWith('@shop/')) require.resolve(dep); // main → dist/index.js: сосед ещё не собран — ошибка
}
fs.mkdirSync('dist', { recursive: true });
fs.copyFileSync('src/index.js', 'dist/index.js');
console.log('built ' + pkg.name);`;

/** Порядок запуска `npm run build --workspaces` с чистыми `dist` — журнал `start <имя>`. */
export const NPM_ORDER = ['@shop/api', '@shop/ui', '@shop/utils', '@shop/admin', '@shop/web'];

/** Кто упал в том же прогоне: всё, кроме `utils`. Код выхода — 1. */
export const NPM_FAILED = ['@shop/api', '@shop/ui', '@shop/admin', '@shop/web'];

export const NPM_ORDER_CODE = `$ npm run build --workspaces        # dist нигде нет
> @shop/api@1.0.0 build
Error: Cannot find module '…/node_modules/@shop/utils/dist/index.js'
npm error workspace @shop/api@1.0.0
> @shop/ui@1.0.0 build
Error: Cannot find module '…/node_modules/@shop/utils/dist/index.js'
npm error workspace @shop/ui@1.0.0
> @shop/utils@1.0.0 build
built @shop/utils
> @shop/admin@1.0.0 build
Error: Cannot find module '…/node_modules/@shop/ui/dist/index.js'
> @shop/web@1.0.0 build
Error: Cannot find module '…/node_modules/@shop/ui/dist/index.js'
$ echo $?
1`;

/** `pnpm -r --workspace-concurrency=1 run build` — журнал `start <имя>`. */
export const PNPM_ORDER = ['@shop/utils', '@shop/api', '@shop/ui', '@shop/admin', '@shop/web'];

/** `pnpm -r run build` с параллельностью по умолчанию: вывод как есть. */
export const PNPM_PARALLEL_CODE = `$ pnpm -r run build
Scope: 5 of 6 workspace projects
packages/utils build$ node build.js
packages/utils build: built @shop/utils
packages/utils build: Done
packages/ui build$ node build.js
packages/api build$ node build.js
packages/ui build: built @shop/ui
packages/api build: built @shop/api
packages/ui build: Done
packages/api build: Done
apps/web build$ node build.js
apps/admin build$ node build.js
apps/web build: built @shop/web
apps/admin build: built @shop/admin
apps/web build: Done
apps/admin build: Done`;

export const ORDER_NOTE =
  '**npm запускает скрипт в воркспейсах по порядку их списка**: шаблоны из поля `workspaces` по очереди, внутри шаблона — по алфавиту папок. Граф зависимостей он не смотрит. `api` и `ui` стартовали раньше `utils` и упали, а npm пошёл дальше и вернул код 1. Хуже другое: второй прогон того же `npm run build --workspaces` прошёл **зелёным**, потому что `dist` остались от первого. На машине разработчика порядок «работает», в чистом CI — нет. pnpm с `-r` сортирует пакеты по графу: сначала `utils`, потом `api` и `ui` параллельно, потом `admin` и `web`.';

export const PLAIN_TOPO =
  'Как одеваться утром. Носки раньше ботинок, рубашка раньше пиджака, а носки и рубашку можно в любом порядке — между ними связи нет. Топологический порядок — любой список, где каждое «раньше» соблюдено. Уровни — это «что можно делать одновременно»: сначала всё, что ни от чего не зависит, потом всё, что зависит только от уже сделанного.';

/**
 * Учебные функции графа: уровни (алгоритм Кана) и «затронутые пакеты».
 * Печатаются темой, исполняются демо (`widgets/monorepo-lab`) и тестом против порядка
 * `pnpm -r` и выборок `--filter` со стенда.
 */
export const GRAPH_CODE = `// packages: [{ name, dir, deps }] — deps только из этого репозитория.
function topoLevels(packages) {
  const waiting = new Map(packages.map((p) => [p.name, p.deps.length]));
  const users = new Map(packages.map((p) => [p.name, []]));
  for (const p of packages) for (const d of p.deps) users.get(d).push(p.name);

  const levels = [];
  let ready = packages.filter((p) => p.deps.length === 0).map((p) => p.name);
  let done = 0;
  while (ready.length > 0) {
    ready.sort();
    levels.push(ready);
    done += ready.length;
    const next = [];
    for (const name of ready) {
      for (const user of users.get(name)) {
        waiting.set(user, waiting.get(user) - 1);   // одной зависимостью меньше
        if (waiting.get(user) === 0) next.push(user);
      }
    }
    ready = next;
  }
  if (done < packages.length) {
    const stuck = packages.filter((p) => waiting.get(p.name) > 0).map((p) => p.name);
    throw new Error('цикл в графе: ' + stuck.join(', '));
  }
  return levels;
}

// Изменённые файлы → изменённые пакеты → плюс все, кто от них зависит.
// Файл вне всех пакетов принадлежит корню репозитория (rootName).
function affected(packages, changedFiles, rootName) {
  const owner = (file) => {
    let best = null;
    for (const p of packages) {
      const inside = file.startsWith(p.dir + '/');
      if (inside && (!best || p.dir.length > best.dir.length)) best = p;
    }
    return best ? best.name : rootName;
  };
  const changed = new Set(changedFiles.map(owner));
  const result = new Set(changed);
  const queue = [...changed];
  while (queue.length > 0) {
    const name = queue.shift();
    for (const p of packages) {
      if (p.deps.includes(name) && !result.has(p.name)) {
        result.add(p.name);
        queue.push(p.name);
      }
    }
  }
  return { changed: [...changed].sort(), withDependents: [...result].sort() };
}`;

export const LEVELS_NOTE =
  'На фикстуре `topoLevels` даёт три уровня: `[utils]`, `[api, ui]`, `[admin, web]`. Развёрнутые подряд, они совпадают с порядком `pnpm -r --workspace-concurrency=1`, а уровни — с тем, что pnpm запускает параллельно. Цикл — `ui` импортирует `api`, а `api` импортирует `ui` — оставляет оба пакета ждать друг друга вечно; функция об этом говорит, а не молча теряет пакеты.';

/** Барьер уровня: `a` собирается 1.5 с, `b` — сразу, `c` зависит только от `b`. */
export const BARRIER_PACKAGES: WsPackage[] = [
  { name: 'a', dir: 'p/a', deps: [] },
  { name: 'b', dir: 'p/b', deps: [] },
  { name: 'c', dir: 'p/c', deps: ['b'] },
];

export const BARRIER_LOG = ['start a', 'start b', 'end b', 'end a', 'start c', 'end c'];

export const BARRIER_NOTE =
  '**pnpm ждёт весь уровень, а не только зависимости.** `c` зависит только от `b`, `b` закончился сразу — но `c` стартовал после `a`, который ему не нужен вовсе: журнал `start a, start b, end b, end a, start c`. Уровни — простой способ уважать граф, но не самый быстрый. Turborepo и Nx планируют по рёбрам: задача стартует, как только готовы её собственные зависимости (по документации Turborepo; на стенде не запускался).';

// ─── Раздел 4. Только изменённое ─────────────────────────────────────────────────────────

export const FILTER_ROWS: { k: string; what: string; got: string }[] = [
  { k: '`--filter @shop/ui`', what: 'только сам пакет', got: '`@shop/ui`' },
  { k: '`--filter "@shop/ui..."`', what: 'пакет и всё, от чего он зависит', got: '`@shop/ui`, `@shop/utils`' },
  { k: '`--filter "...@shop/ui"`', what: 'пакет и все, кто зависит от него', got: '`@shop/admin`, `@shop/ui`, `@shop/web`' },
  { k: '`--filter "...^@shop/ui"`', what: 'только зависимые, без самого пакета', got: '`@shop/admin`, `@shop/web`' },
  { k: '`--filter "[origin/main]"`', what: 'пакеты с изменёнными файлами относительно ветки', got: 'правка в `api` → `@shop/api`' },
  { k: '`--filter "...[origin/main]"`', what: 'изменённые и их зависимые', got: 'правка в `api` → `@shop/api`, `@shop/web`' },
  { k: '`--filter "[origin/main]..."`', what: 'изменённые и их зависимости', got: 'правка в `api` → `@shop/api`, `@shop/utils`' },
];

export const FILTER_NOTE =
  'Многоточие стоит **с той стороны, куда идёт расширение**: `...` слева — «и кто от меня зависит», справа — «и от кого завишу я». В CI нужен первый вариант: изменённый пакет надо собрать и проверить вместе со всеми, кого правка могла сломать. Зависимости справа нужны, только если их сборка ещё не лежит в кеше.';

/**
 * `pnpm --filter "...[origin/main]" exec node -p name`, отсортировано. Правка — строка,
 * дописанная в конец файла; ветка `feature` от `main`, `origin` — голый репозиторий рядом.
 */
export const FILTER_RUNS: FilterPreset[] = [
  {
    id: 'utils',
    label: 'utils',
    files: ['packages/utils/src/index.js'],
    pnpm: ['@shop/admin', '@shop/api', '@shop/ui', '@shop/utils', '@shop/web'],
    note: 'Правка в основании графа задевает всех: от `utils` зависят все четыре пакета, кто прямо, кто через `ui` и `api`.',
  },
  {
    id: 'api',
    label: 'api',
    files: ['packages/api/src/index.js'],
    pnpm: ['@shop/api', '@shop/web'],
    note: '`api` нужен только `web`. `ui` и `admin` пропускаются — от `api` они не зависят.',
  },
  {
    id: 'ui',
    label: 'ui',
    files: ['packages/ui/src/index.js'],
    pnpm: ['@shop/admin', '@shop/ui', '@shop/web'],
    note: '`ui` нужен обоим приложениям. `utils` не попадает: он ниже по графу, и правка в `ui` его не меняет.',
  },
  {
    id: 'admin',
    label: 'admin',
    files: ['apps/admin/src/index.js'],
    pnpm: ['@shop/admin'],
    note: 'Лист графа: от `admin` никто не зависит, и собирать нужно его одного.',
  },
  {
    id: 'api-admin',
    label: 'api + admin',
    files: ['packages/api/src/index.js', 'apps/admin/src/index.js'],
    pnpm: ['@shop/admin', '@shop/api', '@shop/web'],
    note: 'Две правки — объединение двух выборок.',
  },
  {
    id: 'lock',
    label: 'pnpm-lock.yaml',
    files: ['pnpm-lock.yaml'],
    pnpm: ['shop'],
    note: 'Файл в корне pnpm приписал **корневому проекту** `shop`, а от корня не зависит никто. Поменялась версия `clock` у `web` — а `web` в выборку не попал.',
  },
];

export const FILTER_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Сравнивается с концом ветки-базы, а не с точкой ответвления',
    d: '`[origin/main]` — это разница между `origin/main` и рабочей копией. Незакоммиченная правка тоже считается. Но и чужие коммиты в `main`, которых нет в вашей ветке, считаются: ветка `feature` правила только `api`, в `main` за это время поправили `admin` — и выборка стала `admin`, `api`, `web`. Перед проверкой ветку подтягивают к базе (rebase или merge).',
    tone: 'warn',
  },
  {
    t: 'Новый файл, которого git не видит, — не изменение',
    d: 'Новый `packages/api/src/new.js` без `git add` дал «No projects matched». После `git add` — `@shop/api`, `@shop/web`. Локально это сбивает с толку; в CI всё закоммичено, и проблемы нет.',
    tone: 'warn',
  },
  {
    t: 'Общие файлы корня не приписываются пакетам',
    d: 'Lock-файл, общий `tsconfig`, конфиг линтера в корне — правка любого из них даёт только корневой проект. Если сборка пакетов от них зависит, это надо сказать явно: собрать всё при правке корня или перечислить такие файлы во входах задачи.',
    tone: 'err',
  },
  {
    t: 'В CI нужна история до базы',
    d: 'Неглубокий клон (`fetch-depth: 1` в GitHub Actions) не содержит `origin/main`, и сравнивать не с чем. Фильтру нужна ветка-база в клоне. По документации `actions/checkout` и pnpm; на стенде база была локальной.',
    tone: 'warn',
  },
];

export const AFFECTED_CAPTION =
  'Затронутые пакеты считает `affected` из темы по списку изменённых файлов, порядок и уровни — `topoLevels`. Отметка под графом сравнивает ответ с тем, что выбрал настоящий `pnpm --filter "...[origin/main]"` на той же правке. Последний пример показывает дыру фильтра: lock-файл поменялся, а пакеты — нет.';

// ─── Раздел 5. Кеш задач ─────────────────────────────────────────────────────────────────

export const PLAIN_TASK_CACHE =
  'Как копировальный центр с архивом. Вы приносите документ на печать, мастер считает «отпечаток» заказа: какой файл, сколько копий, какая бумага. Такой заказ уже был — выдаёт готовую пачку из архива, не включая принтер. Но если вы забыли сказать, что сегодня нужна цветная печать, а отпечаток считается без цвета, — вам выдадут вчерашнюю чёрно-белую пачку. Уверенно и быстро.';

export const KEY_PARTS: { k: string; d: string }[] = [
  { k: 'файлы пакета', d: 'содержимое каждого исходника. Turborepo по умолчанию берёт файлы под контролем git, Nx — все файлы проекта' },
  { k: 'ключи зависимостей', d: 'ключ задачи `ui` входит в ключ `web`. Поменялся `utils` — поменялся ключ `ui`, а за ним и `web`, хотя файлы `web` те же' },
  { k: 'внешние версии', d: 'что lock-файл записал для этого пакета. Turborepo смотрит на часть lock-файла, относящуюся к пакету' },
  { k: 'команда и настройки', d: 'сама команда, её аргументы, описание задачи в конфиге' },
  { k: 'переменные окружения', d: '**только перечисленные**. Turborepo — ключи `env` и `globalEnv`, Nx — `{ "env": "API_URL" }` во входах задачи' },
];

/**
 * Учебный кеш задач. `crypto.subtle` есть и в браузере, и в Node — один и тот же код считает
 * в демо и в тесте. Turborepo и Nx устроены сложнее (хешируют иначе, хранят файлы `outputs`
 * и логи), но **что входит в ключ** — то же самое; это и проверяется.
 */
export const CACHE_CODE = `async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Ключ — хеш всего, от чего зависит результат задачи.
async function taskKey({ command, files, depKeys, env }) {
  const fileHashes = [];
  for (const path of Object.keys(files).sort()) {
    fileHashes.push(path + ':' + (await sha256(files[path])));
  }
  const envPart = Object.keys(env).sort().map((k) => k + '=' + env[k]);
  return sha256(JSON.stringify({ command, files: fileHashes, deps: [...depKeys].sort(), env: envPart }));
}

// Сборка-заглушка: web вшивает адрес API в бандл, как это делает Vite с import.meta.env.
function buildPackage(name, env) {
  if (name === '@shop/web') return 'fetch("' + env.API_URL + '/price")';
  return 'dist/index.js';
}

// Прогон по уровням графа. cache — Map «ключ → результат», живёт между прогонами.
// declared — переменные, перечисленные в конфиге; strict — задача видит только их.
async function runWithCache({ packages, levels, files, cache, env, declared, strict }) {
  const keys = {};
  const log = [];
  for (const level of levels) {
    for (const name of level) {
      const pkg = packages.find((p) => p.name === name);
      const keyEnv = {};
      for (const k of declared) if (k in env) keyEnv[k] = env[k];
      const key = await taskKey({
        command: 'build',
        files: files[name],
        depKeys: pkg.deps.map((d) => keys[d]),
        env: keyEnv,
      });
      keys[name] = key;
      if (cache.has(key)) {
        log.push({ name, key, hit: true, output: cache.get(key) });
        continue;
      }
      const output = buildPackage(name, strict ? keyEnv : env);
      cache.set(key, output);
      log.push({ name, key, hit: false, output });
    }
  }
  return log;
}`;

/** Исходники фикстуры, по которым демо и тест считают ключи. Те же, что на стенде. */
export const FIXTURE_FILES: Record<string, Record<string, string>> = {
  '@shop/utils': { 'src/index.js': "exports.formatPrice = (n) => n.toFixed(2) + ' ₽';\n" },
  '@shop/ui': {
    'src/index.js':
      "const { formatPrice } = require('@shop/utils');\nconst color = require('tiny-color');\nexports.PriceTag = (n) => '<b>' + formatPrice(n) + '</b> ' + color.version;\n",
  },
  '@shop/api': {
    'src/index.js': "const { formatPrice } = require('@shop/utils');\nexports.fetchPrice = () => formatPrice(990);\n",
  },
  '@shop/web': {
    'src/index.js':
      "const { PriceTag } = require('@shop/ui');\nconst color = require('tiny-color'); // не объявлен в apps/web/package.json\nconsole.log(PriceTag(990), color.version);\n",
  },
  '@shop/admin': { 'src/index.js': "const { PriceTag } = require('@shop/ui');\nconsole.log(PriceTag(1));\n" },
};

/** Два прогона подряд, с общим кешем: сначала сборка для стейджинга, потом для продакшена. */
export const CACHE_RUNS: CacheRun[] = [
  { id: 'staging', label: 'прогон 1: API_URL=https://staging.shop', env: { API_URL: 'https://staging.shop' } },
  { id: 'prod', label: 'прогон 2: API_URL=https://shop.example', env: { API_URL: 'https://shop.example' } },
];

export const CACHE_MODES: CacheMode[] = [
  {
    id: 'loose',
    label: 'переменная не в ключе',
    declared: [],
    strict: false,
    note: 'Так ведёт себя кеш, если `API_URL` не перечислена: Nx без `{ "env": "API_URL" }` во входах, Turborepo в режиме `envMode: loose`, самодельный кеш в CI по хешу исходников. Второй прогон: ключи те же — **попадание** у всех пяти, и в продакшен уходит бандл со стейджинговым адресом.',
  },
  {
    id: 'strict',
    label: 'строгий режим',
    declared: [],
    strict: true,
    note: 'Строгий режим (`envMode: strict`, умолчание Turborepo 2) отдаёт задаче **только объявленные** переменные. `API_URL` не объявлена — сборка её не видит, и в бандле `undefined`. Неверно, но одинаково и сразу заметно: кеш не врёт, ошибка видна в первом же прогоне.',
  },
  {
    id: 'declared',
    label: 'API_URL в ключе',
    declared: ['API_URL'],
    strict: true,
    note: 'Переменная перечислена: её значение входит в ключ. Во втором прогоне ключ `web` другой — **промах**, честная пересборка с продакшен-адресом. Остальные четыре пакета `API_URL` тоже получили в ключ — у учебного кеша список общий. В настоящих инструментах переменную объявляют у той задачи, которой она нужна, и тогда пересобирается только `web`.',
  },
];

export const CACHE_CAPTION =
  'Ключи считает `runWithCache` из темы — настоящим SHA-256 через `crypto.subtle`, кеш общий для двух прогонов. Показаны первые восемь знаков ключа. Сравните второй прогон в трёх режимах: попадание с чужим адресом, явная ошибка и честный промах.';

export const POISON_NOTE =
  '**Отравленный кеш — не сбой, а верная работа по неверному ключу.** Кеш отвечает на вопрос «были ли такие входы», и отвечает правильно. Ошибка в том, что вход, от которого зависит результат, в ключ не попал. Признаки: «у меня собирается правильно, а в CI — старое», «помогает только очистка кеша», «сборка прошла за 80 мс». Лечение — не чистить кеш, а найти забытый вход и добавить его в ключ.';

export const TOOL_ROWS: { k: string; turbo: string; nx: string }[] = [
  {
    k: 'файлы пакета',
    turbo: 'под контролем git; меняется ключом `inputs`',
    nx: 'все файлы проекта и его зависимостей; меняется `inputs`',
  },
  {
    k: 'переменные окружения',
    turbo: '`env`, `globalEnv`; префиксы фреймворков (`NEXT_PUBLIC_*`, `VITE_*`) добавляются сами',
    nx: 'не входят, пока не объявлены: `{ "env": "API_URL" }`',
  },
  {
    k: 'что видит задача',
    turbo: 'по умолчанию (`envMode: strict`) — только объявленные переменные',
    nx: 'всё окружение процесса',
  },
  {
    k: 'что достаётся из кеша',
    turbo: 'файлы из `outputs` и вывод в терминал',
    nx: 'файлы из `outputs` и вывод в терминал',
  },
];

export const TOOL_NOTE =
  'Таблица — по документации Turborepo и Nx: на стенде они не запускались. Главное в ней — одна строка: **переменная окружения попадает в ключ, только если её назвали.** Что задача забыла объявить, кеш не знает.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`npm run --workspaces` не знает графа',
    d: 'Скрипты идут в порядке списка воркспейсов, а не зависимостей. На стенде `api` и `ui` собирались раньше `utils` и падали. Локально это прячут `dist` от прошлых сборок: второй прогон зелёный. Проверка — сборка с чистого клона.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Обычный диапазон на соседа под pnpm ведёт в реестр',
    d: '`"@shop/ui": "^1.0.0"` при локальной `1.0.0` дал запрос в реестр и 404. Если пакет с таким именем есть в публичном реестре, поставится он. Соседа объявляют `workspace:*`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'npm 11 не принимает `workspace:*`',
    d: 'Репозиторий с протоколом `workspace:` не ставится npm вовсе — `EUNSUPPORTEDPROTOCOL`. Смешивать менеджеры в одном монорепозитории не выйдет: менеджер фиксируют полем `packageManager` в корневом `package.json`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Фантом от соседа меняется без правки вашего кода',
    d: 'В npm-раскладке `web` видит `tiny-color`, объявленный только у `ui`. Его версию решает команда `ui`. pnpm показывает такой импорт сразу — `MODULE_NOT_FOUND`.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`...[origin/main]` не видит общих файлов корня',
    d: 'Правка lock-файла или общего конфига в корне даёт выборку `shop` — корневой проект. Пакеты, чья сборка от этих файлов зависит, не пересоберутся. Для таких файлов нужно правило «собрать всё».',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Уровни pnpm — это барьеры',
    d: '`pnpm -r` ждёт, пока закончится весь уровень, даже если следующему пакету нужна только его часть. Одна медленная сборка в уровне задерживает всех после неё.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Забытая переменная окружения отравляет кеш',
    d: 'Если `API_URL` влияет на бандл, но не входит в ключ, второй прогон с другим адресом получит из кеша первый бандл. Кеш при этом работает «правильно» — ошибка в ключе, и очистка кеша её не исправит.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Цикл в графе ломает порядок',
    d: 'Если `b` зависит от `c`, а `c` — от `b`, топологического порядка нет. pnpm 11 на стенде не сказал ни слова и запустил оба пакета цикла одновременно — кто из них соберётся первым, решает случай. Учебная `topoLevels` в таком графе бросает ошибку. Цикл между пакетами — повод вынести общее в третий пакет.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'npm — workspaces',
    href: 'https://docs.npmjs.com/cli/v11/using-npm/workspaces',
    what: 'поле `workspaces`, симлинки в корневом `node_modules`, `--workspaces` и `-w`',
  },
  {
    title: 'npm — npm query',
    href: 'https://docs.npmjs.com/cli/v11/commands/npm-query',
    what: 'селекторы `.workspace`, `#имя`: где лежит пакет и кто его тянет',
  },
  {
    title: 'pnpm — Workspace',
    href: 'https://pnpm.io/workspaces',
    what: 'протокол `workspace:`, замена при публикации, `link-workspace-packages`',
  },
  {
    title: 'pnpm — Filtering',
    href: 'https://pnpm.io/filtering',
    what: '`...` слева и справа, `^`, `[origin/main]`; версия 11.0.9 на стенде',
  },
  {
    title: 'Turborepo — Caching',
    href: 'https://turborepo.dev/docs/crafting-your-repository/caching',
    what: 'что входит в хеш задачи, восстановление `outputs` и логов',
  },
  {
    title: 'Turborepo — Using environment variables',
    href: 'https://turborepo.dev/docs/crafting-your-repository/using-environment-variables',
    what: 'строгий и свободный режимы, вывод префиксов фреймворков, риск попадания в кеш с чужим окружением',
  },
  {
    title: 'Nx — Inputs and named inputs',
    href: 'https://nx.dev/docs/reference/inputs',
    what: 'что входит в хеш задачи по умолчанию, объявление `{ "env": … }`',
  },
];

export const RELATED =
  'Смежное на сайте: [Пакетные менеджеры, раздел «Разрешение дерева и подъём»](/tooling/package-managers/#s2) — подъём, фантомы и копии на одном проекте; [раздел «pnpm и Yarn PnP»](/tooling/package-managers/#s5) там же — хранилище и скрытые ссылки pnpm. [Модули и сборка, раздел «CommonJS против ESM и цена их стыковки»](/tooling/modules/#s3) — поиск пакета вверх по `node_modules` и две копии одной библиотеки. [GitHub Actions, раздел «Кеш и почему он промахивается»](/delivery/github-actions/#s5) — кеш в CI по хешу файлов. [GitLab CI, раздел «`rules` и `only`»](/delivery/gitlab-ci/#s5) — запуск джоба по изменённым файлам. [Микрофронтенды и Module Federation](/tooling/module-federation/#s1) — когда одного репозитория мало. [Git изнутри](/tooling/git-internals/) — объекты, ветки как файлы, слияние и rebase. [Публикация npm-пакета](/tooling/package-publishing/) — поле `exports` по шагам, двойной пакет, типы и что уезжает в тарбол.';
