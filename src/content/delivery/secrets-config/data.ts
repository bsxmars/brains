import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { EnvFiles, ScanSample } from '@/widgets/env-lab/model/types';

/**
 * Данные темы «Секреты и конфигурация: что попадает в бандл».
 *
 * Тема написана здесь, 2026-10-01, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Vite **8.3.0** (сборка — rolldown 1.2.x, `loadEnv` читает файлы `util.parseEnv` из Node
 * и подставляет `${…}` пакетом dotenv-expand), esbuild **0.28.2** — оба из `node_modules`
 * проекта, программно, на фикстуре во временном каталоге; конфиг проекта не тронут.
 * Node 24.11.0, Docker 27.4 с образом `node:24-alpine` (Node 24.21.0), kubectl 1.30.5 (без
 * кластера, `--dry-run=client`), git 2.44.0. Октябрь 2026.
 *
 * Как снято:
 *   — **бандлы** (`BUNDLE_ROWS`): `vite build` в режиме `production` над `BUNDLE_ENV` и
 *     однострочным `src/main.js`, `build.modulePreload.polyfill: false` — иначе перед каждым
 *     бандлом стоит одинаковый полифил на 700 байт, к теме не относящийся. Сборка идёт
 *     в отдельном процессе Node с окружением ровно `PATH`, `HOME=/home/runner`, `CI=true`,
 *     `DEPLOY_TOKEN=…` — так в строке `defineAll` видно окружение «машины CI», а не автора.
 *     macOS добавляет каждому процессу `__CF_USER_TEXT_ENCODING`; скрипт сборки его удаляет
 *     перед `loadEnv` — больше ничего не нормализовано. Строка `defineAll` собрана с настоящим
 *     `vite.config.js` из `VITE_CONFIG_LEAK_CODE`; `NODE_ENV=production` в её конце выставил
 *     сам Vite до загрузки конфига — в оболочке его не было;
 *   — та же сборка с `VITE_CONFIG_LEAK_CODE` в обычном окружении машины автора вписала в бандл
 *     **48** переменных: 4 из `.env` и 44 из оболочки, среди них токен сессии редактора.
 *     Число машинозависимо, поэтому в тест не идёт; в тексте — без цифры;
 *   — **`.env`-файлы**: `loadEnv` на `ENV_FILES` — 3 режима × 64 набора файлов × переменная
 *     оболочки есть/нет × два набора префиксов = 768 сочетаний; `LOAD_ENV_CODE` совпал на всех;
 *   — **esbuild** (`ESBUILD_ROWS`): `build` из `stdin` с `bundle`, `minify`, `format: 'esm'`;
 *   — **Node**: `ENV_STRINGS_CODE`, `CHILD_ENV_CODE`, `REPORT_CODE` исполнены как есть;
 *   — **сканер**: `SCAN_CODE` на бандлах Vue 3.5.42, React 19.3.0 + react-dom 19.3.0,
 *     d3-scale 4.0.2 + d3-shape 3.2.0 (esbuild, `minify`, `NODE_ENV=production`) — `SCAN_STATS`;
 *   — **git** (`GIT_TRANSCRIPT`): с фиксированными автором и датами, поэтому хеши повторяются;
 *   — **Kubernetes Secret** (`SECRET_YAML`): `kubectl create secret generic … --dry-run=client -o yaml`.
 *
 * Всё перечисленное пересобирает `tests/unit/secrets-config.test.ts`. Кроме Docker: тест его
 * не запускает (тяжело и нужен демон). `PROC_TRANSCRIPT` снят так: `docker run -d -e
 * DB_PASSWORD=… node:24-alpine node -e "<код>"` и `docker exec … cat /proc/1/environ`;
 * вариант с `--user node` и чтение из-под другого пользователя — там же; `docker inspect
 * --format '{{json .Config.Env}}'` напечатал пароль открытым текстом.
 *
 * ── Что взято из документации, а не снято ─────────────────────────────────────────────────
 *   — порядок `.env`-файлов в Next.js и то, что Next не подставляет `process.env[имя]`
 *     (nextjs.org, «Environment Variables»; Next в проекте не установлен);
 *   — какие ключи публичны по замыслу (`PUBLIC_ROWS`): Stripe, Sentry, Firebase — документация
 *     сервисов;
 *   — Kubernetes: Secret по умолчанию хранится в etcd без шифрования; том с Secret обновляется
 *     сам, а переменная и `subPath` — нет (kubernetes.io, «Secrets»). Задержку обновления
 *     тома для ConfigMap замерила тема «Kubernetes: развёртывание» — на неё ссылка;
 *   — порядок ротации (`ROTATION_STEPS`) — OWASP Secrets Management Cheat Sheet;
 *   — `::add-mask::`, push protection и партнёрская программа secret scanning — docs.github.com;
 *   — `ENTRYPOINT_CODE` и `RUNTIME_HTML` напечатаны, но не исполнялись: исполняется только
 *     функция `renderConfig` из `RENDER_CONFIG_CODE`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'конфигурация',
    d: 'Всё, что отличается между окружениями при одном и том же коде: адрес API, уровень логов, включённые функции. Код один, конфигурация у разработки, стенда и продакшена своя.',
  },
  {
    k: 'секрет',
    d: 'Конфигурация, которую нельзя показывать: пароль базы, ключ платёжного API, токен выката. Признак простой: тот, кто его узнал, может действовать от вашего имени.',
  },
  {
    k: 'переменная окружения',
    d: 'Пара «имя=строка», которую процесс получает при запуске от того, кто его запустил. В Node они лежат в `process.env`, в оболочке их видно командой `env`.',
  },
  {
    k: 'бандл',
    d: 'JS-файлы, которые сборщик пишет для браузера. Каждый посетитель скачивает их целиком и может прочитать любую строку внутри.',
  },
  {
    k: '`.env`-файл',
    d: 'Текстовый файл со строками `ИМЯ=значение`. Сборщики и библиотеки читают его при старте и добавляют значения к переменным окружения.',
  },
  {
    k: 'режим (mode)',
    d: 'Имя набора настроек в Vite: `development` у `vite dev`, `production` у `vite build`, своё — флагом `--mode staging`. От режима зависит, какие `.env`-файлы прочитаются.',
  },
  {
    k: '`define`',
    d: 'Настройка сборщика «замени это выражение в коде вот этим текстом». На ней держатся `import.meta.env` в Vite и `process.env.NEXT_PUBLIC_*` в Next.',
  },
  {
    k: 'ротация',
    d: 'Замена секрета новым и отзыв старого. Плановая — по расписанию, срочная — после утечки.',
  },
];

export const PLAIN_SECRET =
  'Конфигурация — как адрес магазина на вывеске: его должны знать все, и у каждого филиала он свой. Секрет — как код от сейфа. А бандл — листовка, которую раздают каждому прохожему. Напечатать в ней адрес — правильно. Напечатать в ней код от сейфа — значит раздать его всем, и забрать листовки обратно уже не получится.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи. Три разобраны на сайте, четвёртая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Переменные окружения',
    d: 'Каждый процесс получает при запуске набор строк `ИМЯ=значение`. Оболочка передаёт свои переменные каждой команде: `API_URL=… node server.js` запускает сервер с ещё одной переменной. Из Node они читаются как `process.env.API_URL`.',
    tone: 'info',
  },
  {
    t: 'Сборщик переписывает код',
    d: 'Сборка — не копирование: сборщик вычисляет то, что известно заранее, и выбрасывает ветки, которые никогда не выполнятся. Подстановка переменных — частный случай: выражение в коде меняется на строку.',
    href: '/tooling/bundler-internals/#s2',
    hrefLabel: '«Сборщик изнутри», раздел «Что выживает»',
    tone: 'info',
  },
  {
    t: 'Под, ConfigMap и выкат в Kubernetes',
    d: 'Приложение работает в контейнерах пода, а настройки приходят из объектов кластера — переменными окружения или файлами в томе. Нужно для раздела про секреты на сервере.',
    href: '/delivery/kubernetes/#s1',
    hrefLabel: '«Kubernetes: развёртывание», раздел «Под и контроллеры»',
    tone: 'info',
  },
  {
    t: 'Секреты в CI',
    d: 'Конвейер получает секреты из настроек репозитория и прячет их в логе звёздочками. Как устроено маскирование и почему его обходит любое преобразование строки.',
    href: '/delivery/github-actions/#s7',
    hrefLabel: '«GitHub Actions», раздел «Права и секреты»',
    tone: 'info',
  },
];

// ─── Раздел 1. Конфигурация и секрет ───────────────────────────────────────────────────────

export const TWELVE_TEXT =
  'Методика «двенадцать факторов» требует держать конфигурацию **в окружении**, а не в коде. Проверка у неё такая: можно ли прямо сейчас открыть исходники всем, не выдав ни одного доступа? Если в коде лежит адрес базы с паролем — нельзя. Переменные окружения удобны тем, что их нет в репозитории, они свои у каждого выката и понятны любому языку. Но методика не делит конфигурацию на публичную и секретную. Это деление делаем мы — и от него зависит, куда значению можно попасть.';

export const PUBLIC_ROWS: { k: string; v: string; why: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'адрес API',
    v: 'публичен',
    why: 'Браузер всё равно увидит его во вкладке «Сеть» при первом же запросе. Прятать нечего.',
    tone: 'ok',
  },
  {
    k: 'DSN Sentry',
    v: 'публичен по замыслу',
    why: 'Ключ внутри позволяет только отправлять события об ошибках. Злоупотребить им можно мусором в отчётах; ограничивают его списком разрешённых доменов в настройках проекта.',
    tone: 'ok',
  },
  {
    k: 'Stripe `pk_live_…`',
    v: 'публичен',
    why: 'Открытый ключ: с ним браузер создаёт платёжную форму. Списать деньги или прочитать платежи он не даёт.',
    tone: 'ok',
  },
  {
    k: 'Firebase `apiKey`',
    v: 'публичен, но с правилами',
    why: 'Это имя проекта, а не пароль. Данные защищают правила доступа в самом Firebase: без них «публичный» ключ открывает базу всем.',
    tone: 'warn',
  },
  {
    k: 'Stripe `sk_live_…`',
    v: 'секрет',
    why: 'Полный доступ к аккаунту: возвраты, выплаты, данные клиентов. Живёт только на сервере.',
    tone: 'err',
  },
  {
    k: 'пароль базы, токен выката',
    v: 'секрет',
    why: 'Браузеру не нужен никогда. Если код фронта его читает — ошибка в устройстве приложения, а не в настройке сборки.',
    tone: 'err',
  },
];

export const PUBLIC_NOTE =
  '«Публичный» ключ не значит «ничей». Его ограничивают на стороне сервиса — по домену, по набору прав, правилами доступа. Секрет так ограничить нельзя: он и есть право действовать. Поэтому вопрос «можно ли это в бандл» решается до сборки, по смыслу значения, а не по тому, как называется переменная.';

// ─── Раздел 2. Что сборщик вписывает в бандл ───────────────────────────────────────────────

export const PLAIN_INLINE =
  'Как типография, которая печатает листовку по шаблону. В шаблоне написано «звоните по номеру {ТЕЛЕФОН}», а в листовке — уже сам номер. Тот, кто держит листовку, не знает, что там был шаблон, — но номер видит. Сборщик делает то же: в исходнике `import.meta.env.VITE_API_URL`, в бандле — сама строка адреса.';

/** `.env` фикстуры для таблицы бандлов. Пароль — выдуманный, как и все ключи темы. */
export const BUNDLE_ENV = `VITE_API_URL=https://api.shop.example
VITE_SENTRY_DSN=https://k3y@o1.ingest.sentry.io/42
DB_PASSWORD=pg-Zx81-secret
VITE_DEBUG_DB=\${DB_PASSWORD}
`;

/** Окружение процесса сборки — «машина CI». Токен выдуман. */
export const BUILD_SHELL: Record<string, string> = {
  HOME: '/home/runner',
  CI: 'true',
  DEPLOY_TOKEN: 'ghp_R8x2kVq9TzL4mWn7Yb3Hc6Jd1Fp0Sa5Ge8Ku',
};

export interface BundleRow {
  id: string;
  /** `src/main.js` целиком. */
  src: string;
  /** Чем сборка отличается от обычной `vite build`; пусто — ничем. */
  config?: { envPrefix?: string[]; leakConfig?: true };
  /** Что сборка записала в JS-файл — дословно. */
  out: string;
  verdict: string;
  tone: 'ok' | 'warn' | 'err';
}

export const BUNDLE_ROWS: BundleRow[] = [
  {
    id: 'named',
    src: 'console.log(import.meta.env.VITE_API_URL);',
    out: 'console.log(`https://api.shop.example`);',
    verdict: 'Значение вписано строкой. Имени переменной в бандле нет — искать утечку надо по значению.',
    tone: 'ok',
  },
  {
    id: 'nonprefix',
    src: 'console.log(import.meta.env.DB_PASSWORD);',
    out: 'console.log(void 0);',
    verdict: 'Без префикса `VITE_` — `undefined`. Это и есть защита: Vite отказался вписывать.',
    tone: 'ok',
  },
  {
    id: 'devbranch',
    src: 'if (import.meta.env.DEV) console.log(import.meta.env.VITE_SENTRY_DSN);\nconsole.log(import.meta.env.MODE);',
    out: 'console.log(`production`);',
    verdict: 'Ветка `DEV` в рабочей сборке выброшена вместе со строкой DSN. Работает, только пока условие известно при сборке.',
    tone: 'ok',
  },
  {
    id: 'whole',
    src: 'console.log(import.meta.env);',
    out: 'console.log({BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_API_URL:`https://api.shop.example`,VITE_DEBUG_DB:`pg-Zx81-secret`,VITE_SENTRY_DSN:`https://k3y@o1.ingest.sentry.io/42`});',
    verdict: 'Объект целиком — **все** переменные с префиксом, даже те, что код не читает.',
    tone: 'warn',
  },
  {
    id: 'dynamic',
    src: 'console.log(import.meta.env[location.hash.slice(1)]);',
    out: 'console.log({BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1,VITE_API_URL:`https://api.shop.example`,VITE_DEBUG_DB:`pg-Zx81-secret`,VITE_SENTRY_DSN:`https://k3y@o1.ingest.sentry.io/42`}[location.hash.slice(1)]);',
    verdict: 'Ключ вычисляется в браузере, поэтому вписан весь объект. Next такой доступ не подставляет вовсе — там будет `undefined`.',
    tone: 'warn',
  },
  {
    id: 'expand',
    src: 'console.log(import.meta.env.VITE_DEBUG_DB);',
    out: 'console.log(`pg-Zx81-secret`);',
    verdict: '`VITE_DEBUG_DB=${DB_PASSWORD}`: префикс у имени, а значение взято из секрета. Пароль в бандле.',
    tone: 'err',
  },
  {
    id: 'processEnv',
    src: 'console.log(process.env.VITE_API_URL);',
    out: 'console.log({}.VITE_API_URL);',
    verdict: '`process.env` в коде для браузера Vite меняет на пустой объект: `undefined` без ошибки.',
    tone: 'ok',
  },
  {
    id: 'prefix2',
    src: 'console.log(import.meta.env.DB_PASSWORD);',
    config: { envPrefix: ['VITE_', 'DB_'] },
    out: 'console.log(`pg-Zx81-secret`);',
    verdict: '`envPrefix: [\'VITE_\', \'DB_\']` — защита снята для всех `DB_*` сразу.',
    tone: 'err',
  },
  {
    id: 'defineAll',
    src: 'console.log(process.env.VITE_API_URL);',
    config: { leakConfig: true },
    out: 'console.log({DB_PASSWORD:`pg-Zx81-secret`,VITE_API_URL:`https://api.shop.example`,VITE_DEBUG_DB:`pg-Zx81-secret`,VITE_SENTRY_DSN:`https://k3y@o1.ingest.sentry.io/42`,PATH:`/usr/bin:/bin`,HOME:`/home/runner`,CI:`true`,DEPLOY_TOKEN:`ghp_R8x2kVq9TzL4mWn7Yb3Hc6Jd1Fp0Sa5Ge8Ku`,NODE_ENV:`production`}.VITE_API_URL);',
    verdict: 'Конфиг ниже: в бандле весь `.env` **и всё окружение машины сборки**, включая токен выката. Код читал одно поле.',
    tone: 'err',
  },
];

export const BUNDLE_NOTE =
  'Каждая строка — отдельная `vite build` в режиме `production` над тем же `.env`. Две вещи из таблицы стоит запомнить. Первая: вписывается **значение**, а не имя, поэтому `grep VITE_` по бандлу ничего не найдёт. Вторая: префикс проверяется у **имени** переменной. Что лежит внутри значения, Vite не знает и не проверяет — отсюда утечка через `${DB_PASSWORD}`.';

export const VITE_CONFIG_LEAK_CODE = `// vite.config.js — так делать нельзя
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // '' — все переменные, без фильтра
  return { define: { 'process.env': JSON.stringify(env) } };
});`;

export const LEAK_NOTE =
  'Так делают, когда библиотека из старого мира ждёт `process.env.ЧТО_ТО` и падает в браузере. Третий аргумент `\'\'` у `loadEnv` значит «без фильтра по префиксу» — и вместе с файлами в результат попадает **всё окружение процесса сборки**. `define` заменяет `process.env` объектом целиком, а не одним полем, которое читает код. На машине разработчика это пути, имя пользователя и токены инструментов. В CI — всё, что конвейер положил в окружение шага сборки.';

export const ENVPREFIX_ERROR =
  "envPrefix option contains value '', which could lead unexpected exposure of sensitive information.";

export const ENVPREFIX_NOTE =
  'Прямой путь Vite закрыл: `envPrefix: \'\'` роняет сборку с ошибкой выше. Обходные — список префиксов и `define` — он не видит: это обычные настройки, и сборщик не знает, что в них секрет.';

/** Исходник для esbuild: так пишут код, рассчитанный на Node или на Webpack 4. */
export const ESBUILD_SRC = `const key = process.env.STRIPE_SECRET;
if (process.env.NODE_ENV !== 'production') console.log('debug', key);
console.log(process.env.API_URL);`;

/** Окружение, которое подставляется в строке «весь `process.env`». Ключ выдуман. */
export const ESBUILD_ENV: Record<string, string> = {
  API_URL: 'https://api.shop.example',
  STRIPE_SECRET: 'sk_live_51HqLyjWDarjtT1zdp7dc',
  NODE_ENV: 'production',
};

export const ESBUILD_ROWS: { k: string; define?: Record<string, string>; out: string; why: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'без `define`',
    out: 'var o=process.env.STRIPE_SECRET;console.log(process.env.API_URL);',
    why: 'Для браузера esbuild сам подставил только `NODE_ENV` — ветка с отладкой исчезла. Остальное осталось как есть, и в браузере код упадёт: `process` там нет.',
    tone: 'warn',
  },
  {
    k: 'одно имя',
    define: { 'process.env.API_URL': '"https://api.shop.example"' },
    out: 'var o=process.env.STRIPE_SECRET;console.log("https://api.shop.example");',
    why: 'Правильная форма: каждое имя названо явно, значение — JSON-строка в кавычках.',
    tone: 'ok',
  },
  {
    k: 'весь `process.env`',
    define: { 'process.env': '<JSON.stringify(ESBUILD_ENV)>' },
    out: 'var o={API_URL:"https://api.shop.example",STRIPE_SECRET:"sk_live_51HqLyjWDarjtT1zdp7dc",NODE_ENV:"production"};var p=o.STRIPE_SECRET;console.log(o.API_URL);',
    why: 'Объект вписан целиком и вынесен в переменную. Ветку с отладкой esbuild выбросил, а чтение `o.STRIPE_SECRET` и сам объект с ключом оставил: сборщик не знает, нужен ли он.',
    tone: 'err',
  },
];

export const ESBUILD_NOTE =
  'Значение в `define` — **текст кода**, а не строка: `{ \'process.env.API_URL\': \'https://…\' }` esbuild отвергнет («must be an entity name or JS literal»). Отсюда привычка оборачивать всё в `JSON.stringify` — и привычка отдавать ему целый `process.env`.';

// ─── Раздел 3. `.env`-файлы ────────────────────────────────────────────────────────────────

export const PLAIN_ENV_ORDER =
  'Как стопка прозрачных плёнок на проекторе. Внизу — общая плёнка, сверху — плёнки режима и личные. Где на верхней что-то написано, нижнюю в этом месте не видно. Важно лишь, в каком порядке их кладут, — а порядок у разных инструментов разный.';

/** Файлы фикстуры для демо и для сверки с `loadEnv`. */
export const ENV_FILES: EnvFiles = {
  '.env': `# общее для всех режимов, лежит в git
VITE_API_URL=https://api.example.com
VITE_APP_TITLE="Магазин"
DB_PASSWORD=pg-Zx81-secret
VITE_DEBUG_DB=\${DB_PASSWORD}
`,
  '.env.local': `VITE_API_URL=http://localhost:8080  # мой ноутбук
`,
  '.env.development': `VITE_LOG_LEVEL=debug
`,
  '.env.production': `VITE_API_URL=https://api.shop.example
VITE_SENTRY_DSN=https://k3y@o1.ingest.sentry.io/42
`,
  '.env.production.local': `VITE_API_URL='https://canary.shop.example'
`,
  '.env.staging': `VITE_API_URL=https://stage.shop.example
`,
};

export const ENV_MODES = ['development', 'production', 'staging'];

/** Переменная оболочки, которую демо может «задать» перед сборкой. */
export const SHELL_VAR: Record<string, string> = { VITE_API_URL: 'https://ci.shop.example' };

export const ENV_PREFIX_SETS: { id: string; label: string; prefixes: string[] }[] = [
  { id: 'vite', label: "'VITE_'", prefixes: ['VITE_'] },
  { id: 'db', label: "['VITE_', 'DB_']", prefixes: ['VITE_', 'DB_'] },
];

export const ORDER_ROWS: { n: string; file: string; when: string; git: string }[] = [
  { n: '1', file: '`.env`', when: 'всегда', git: 'да: общие значения по умолчанию' },
  { n: '2', file: '`.env.local`', when: 'всегда', git: 'нет: личные настройки разработчика' },
  { n: '3', file: '`.env.[режим]`', when: 'только в своём режиме', git: 'да' },
  { n: '4', file: '`.env.[режим].local`', when: 'только в своём режиме', git: 'нет' },
  { n: '5', file: 'переменная оболочки', when: 'всегда', git: '—: задаётся при запуске сборки' },
];

export const ORDER_NOTE =
  'Читаются сверху вниз, и каждая следующая строка перебивает предыдущие. Значит, у Vite `.env.production` **сильнее** `.env.local`: адрес с ноутбука разработчика в рабочую сборку не попадёт. У Next порядок другой — там `.env.local` стоит выше `.env.production`, а в режиме `test` не читается вовсе (по документации Next). Переменная оболочки сильнее всех файлов: `VITE_API_URL=… vite build` перебивает любую строку в `.env`.';

export const LOAD_ENV_CODE = `// Разбор одного .env-файла: строки КЛЮЧ=значение.
function parseDotenv(text) {
  const out = {};
  for (const raw of text.split('\\n')) {
    const line = raw.trim().replace(/^export\\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'" || q === '\`') && value.indexOf(q, 1) > 0) {
      value = value.slice(1, value.indexOf(q, 1));
      if (q === '"') value = value.replaceAll('\\\\n', '\\n');
    } else {
      value = value.replace(/\\s+#.*$/, '');       // комментарий после значения
    }
    out[key] = value;
  }
  return out;
}

// Порядок файлов: каждый следующий перебивает предыдущие.
function envFilesFor(mode) {
  if (mode === 'local') throw new Error('режим "local" занят суффиксом .local');
  return ['.env', '.env.local', \`.env.\${mode}\`, \`.env.\${mode}.local\`];
}

// files: имя файла → текст (нет ключа — нет файла); shell — переменные процесса сборки.
function loadEnvFiles(mode, files, shell, prefixes = ['VITE_']) {
  const merged = {};
  const from = {};
  const lost = {};                                 // кого перебили: ключ → [[файл, значение]]
  for (const name of envFilesFor(mode)) {
    if (!(name in files)) continue;
    for (const [key, value] of Object.entries(parseDotenv(files[name]))) {
      if (key in merged) (lost[key] ??= []).push([from[key], merged[key]]);
      merged[key] = value;
      from[key] = name;
    }
  }
  // Подстановка \${ИМЯ}: сначала из оболочки, потом из уже прочитанного.
  for (const key of Object.keys(merged)) {
    if (shell[key] !== undefined && shell[key] !== merged[key]) {
      (lost[key] ??= []).push([from[key], merged[key]]);
      merged[key] = shell[key];
      from[key] = 'оболочка';
      continue;
    }
    merged[key] = merged[key].replace(/\\$\\{?([A-Za-z_][A-Za-z0-9_]*)\\}?/g,
      (_, name) => shell[name] ?? merged[name] ?? '');
  }
  for (const [key, value] of Object.entries(shell)) {
    if (!(key in merged)) { merged[key] = value; from[key] = 'оболочка'; }
  }
  // В бандл — только то, что начинается с префикса.
  const env = {};
  for (const key of Object.keys(merged).sort()) {
    if (prefixes.some((p) => key.startsWith(p))) env[key] = merged[key];
  }
  return { env, all: merged, from, lost };
}`;

export const LOAD_ENV_NOTE =
  '`loadEnvFiles` повторяет то, что делает `loadEnv` в Vite: те же четыре файла в том же порядке, переменная оболочки поверх них, подстановка `${ИМЯ}` и фильтр по префиксу в самом конце. Именно из-за порядка шагов подстановка и течёт: `${DB_PASSWORD}` раскрывается **до** фильтра, когда пароль ещё среди прочитанного. Один упрощённый случай: Vite понимает ещё многострочные значения в кавычках и `${ИМЯ:-по умолчанию}`, здесь их нет.';

export const ENV_DEMO_CAPTION =
  'Считает `loadEnvFiles` — функция выше — над шестью файлами фикстуры. Зачёркнутое — значения, которые перебил следующий файл. Пометка «в бандл» стоит у тех переменных, что попадут в `import.meta.env`: их увидит каждый, кто откроет сайт.';

export const ENV_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: '`.env` не меняет `process.env` сборки',
    d: 'Vite читает файлы только для `import.meta.env`. В `vite.config.js` переменная `DB_PASSWORD` из `.env` не видна: `process.env.DB_PASSWORD` там `undefined`. Нужна в конфиге — вызывают `loadEnv` явно.',
  },
  {
    t: '`NODE_ENV` из файла переименовывается',
    d: 'Строка `NODE_ENV=development` в `.env` не меняет `NODE_ENV` процесса сборки. Vite кладёт её в `VITE_USER_NODE_ENV` — и она уезжает в бандл вместе с остальными `VITE_*`.',
    tone: 'warn',
  },
  {
    t: 'Режим `local` запрещён',
    d: '`--mode local` роняет сборку: имя столкнулось бы с суффиксом `.local`, и файл `.env.local` читался бы дважды.',
  },
];

// ─── Раздел 4. Сборка или запуск ───────────────────────────────────────────────────────────

export const PLAIN_RUNTIME =
  'Как табличка «сегодня работаем до…» на двери. Её можно отлить в бронзе вместе с дверью — тогда для каждого филиала нужна своя дверь. А можно повесить рамку и вставлять листок утром. Сборка — это бронза, конфиг при запуске — рамка.';

export const RUNTIME_TEXT =
  'Значение, вписанное при сборке, заморожено в образе. Тогда образ для stage и образ для prod — **разные образы**, и в prod едет не тот, который проверили. Выход — собирать один раз, а публичную конфигурацию отдавать браузеру при запуске контейнера: файлом `config.js` или `config.json`, который пишется из переменных окружения до старта веб-сервера. Сама идея «один образ на все окружения» разобрана в [«Одном манифесте на много окружений»](/delivery/helm-gitops/#s1); здесь — как устроен файл и чем он опасен.';

export const RENDER_CONFIG_CODE = `// render-config.mjs — запускается при старте контейнера, до веб-сервера.
// В конфиг попадают только имена из списка: секрет туда случайно не уедет.
const PUBLIC_KEYS = ['API_URL', 'SENTRY_DSN', 'FEATURE_NEW_CART'];

function renderConfig(env, keys = PUBLIC_KEYS) {
  const config = {};
  for (const key of keys) if (env[key] !== undefined) config[key] = env[key];
  // \`<\` экранируется: значение не закроет тег <script>, если файл встроят в HTML.
  const json = JSON.stringify(config).replaceAll('<', '\\\\u003c');
  return 'window.__CONFIG__ = ' + json + ';\\n';
}`;

/** Окружение контейнера в примере. `DB_PASSWORD` тоже там — серверу он нужен. */
export const RUNTIME_ENV: Record<string, string> = {
  API_URL: 'https://api.shop.example',
  SENTRY_DSN: 'https://k3y@o1.ingest.sentry.io/42',
  FEATURE_NEW_CART: 'true',
  DB_PASSWORD: 'pg-Zx81-secret',
  HOME: '/root',
};

/** Что вернула `renderConfig(RUNTIME_ENV)`. */
export const RUNTIME_OUT =
  'window.__CONFIG__ = {"API_URL":"https://api.shop.example","SENTRY_DSN":"https://k3y@o1.ingest.sentry.io/42","FEATURE_NEW_CART":"true"};\n';

export const RUNTIME_HTML = `<!-- index.html: конфиг грузится раньше бандла -->
<script src="/config.js"></script>
<script type="module" src="/assets/index-Bx81kQ.js"></script>

// в коде приложения
const { API_URL } = window.__CONFIG__;`;

export const ENTRYPOINT_CODE = `#!/bin/sh
# docker-entrypoint.sh: конфиг пишется при каждом старте, образ один на все окружения
node /app/render-config.mjs > /app/dist/config.js
exec node /app/server.mjs`;

export const RUNTIME_ROWS: { k: string; build: string; run: string }[] = [
  { k: 'когда значение известно', build: 'при `vite build`', run: 'при старте контейнера' },
  { k: 'образов на три окружения', build: 'три', run: 'один' },
  { k: 'сменить адрес API', build: 'пересобрать и выкатить', run: 'перезапустить под' },
  { k: 'мёртвый код по флагу', build: 'выбрасывается: `if (false)` известен заранее', run: 'остаётся в бандле: флаг узнают только в браузере' },
  { k: 'кеш браузера и CDN', build: 'имя файла с хешем, кешируется надолго', run: '`config.js` без хеша — ему нужен `Cache-Control: no-cache`' },
  { k: 'видно посетителю', build: '**да**', run: '**да**' },
];

export const RUNTIME_NOTE =
  'Последняя строка таблицы — главная. Конфиг при запуске меняет **время** подстановки, а не круг тех, кто её видит: `config.js` скачивает каждый посетитель. Поэтому `renderConfig` берёт имена из явного списка, а не всё окружение с префиксом: в окружении контейнера лежит и пароль базы, и ошибка в одном фильтре отдаст его браузеру. Про `no-cache`: старый `config.js` из кеша после смены адреса API — это половина пользователей на старом бэкенде; как работают такие заголовки — в [«Кеше на CDN»](/platform/cdn-cache/#s1).';

// ─── Раздел 5. Секрет на сервере ───────────────────────────────────────────────────────────

export const PLAIN_ENVIRON =
  'Переменная окружения — записка, приколотая к спецовке рабочего. Удобно: всегда при нём. Но копию получает каждый помощник, которого он позовёт (дочерний процесс). Записку переписывают в акт, если случилась авария (отчёт о падении). А снять её нельзя: в журнале смены остаётся первая версия (`/proc`). Файл — записка в шкафчике: чтобы прочитать, его надо открыть, и сам он ни к кому не переходит.';

export const ENV_STRINGS_CODE = `process.env.PORT = 8080;
process.env.DEBUG = false;
process.env.CACHE_DIR = undefined;

console.log(typeof process.env.PORT, process.env.PORT);
console.log(process.env.DEBUG ? 'отладка включена' : 'выключена');
console.log(process.env.CACHE_DIR === undefined, JSON.stringify(process.env.CACHE_DIR));
console.log(process.env.NOT_SET);`;

export const ENV_STRINGS_OUT = `string 8080
отладка включена
false "undefined"
undefined`;

export const ENV_STRINGS_NOTE =
  '`process.env` хранит **только строки**: число становится `"8080"`, `false` — строкой `"false"`, которая в условии истинна, а `undefined` — строкой из девяти букв. Не заданная переменная — настоящий `undefined`. Поэтому конфигурацию разбирают один раз при старте и явно: `=== \'true\'`, `Number(…)` с проверкой на `NaN`, — и падают сразу, если обязательной переменной нет. Иначе пустая строка превратится в порт `0`: `Number(\'\')` равно нулю.';

export const CHILD_ENV_CODE = `const { execFileSync } = require('node:child_process');

process.env.DB_PASSWORD = 'pg-Zx81-secret';
const probe = ['-e', "console.log(process.env.DB_PASSWORD ?? '(нет)')"];
const child = (options) => execFileSync(process.execPath, probe, options).toString().trim();

console.log(child());                                                    // наследует всё
console.log(child({ env: { PATH: process.env.PATH } }));                 // только PATH
console.log(child({ env: { ...process.env, DB_PASSWORD: undefined } })); // всё, кроме пароля`;

export const CHILD_ENV_OUT = `pg-Zx81-secret
(нет)
(нет)`;

export const CHILD_ENV_NOTE =
  'Дочерний процесс по умолчанию получает **копию всего окружения** родителя. Сервер, который зовёт `convert`, `git` или скрипт пользователя, отдаёт им и пароль базы. Опция `env` заменяет окружение целиком; значение `undefined` в ней Node пропускает — так переменную и убирают.';

export const PROC_TRANSCRIPT = `$ docker run -d --name app -e DB_PASSWORD=pg-Zx81-secret node:24-alpine \\
    node -e "delete process.env.DB_PASSWORD; setInterval(() => {}, 1000)"

$ docker exec app sh -c 'tr "\\0" "\\n" < /proc/1/environ | grep DB_'
DB_PASSWORD=pg-Zx81-secret          # delete в процессе ничего не стёр

$ docker exec app ls -l /proc/1/environ
-r--------    1 root     root     0 /proc/1/environ

$ docker exec app su node -s /bin/sh -c 'cat /proc/1/environ'
cat: can't open '/proc/1/environ': Permission denied

$ docker inspect app --format '{{json .Config.Env}}'
["DB_PASSWORD=pg-Zx81-secret","PATH=/usr/local/sbin:…","NODE_VERSION=24.21.0","YARN_VERSION=1.22.22"]`;

export const PROC_NOTE =
  'В Linux окружение процесса лежит в файле `/proc/<pid>/environ` — в том виде, в каком процесс его **получил при запуске**. `delete process.env.DB_PASSWORD` меняет копию внутри Node, а файл остаётся прежним. Читать его может владелец процесса и root: от чужого пользователя файл закрыт. Значит, всё решает, кто ещё работает под тем же пользователем: скрипт, отладчик, уязвимый обработчик загрузки, который читает «любой файл по пути». А `docker inspect` показывает окружение каждому, у кого есть доступ к Docker.';

export const REPORT_CODE = `// Диагностический отчёт Node: его пишут при падении (--report-on-fatalerror)
// и по сигналу (--report-on-signal), чтобы разобрать сбой потом.
process.env.DB_PASSWORD = 'pg-Zx81-secret';
const report = process.report.getReport();
console.log(report.environmentVariables?.DB_PASSWORD);`;

export const REPORT_NOTE =
  'Отчёт Node печатает `pg-Zx81-secret`: окружение входит в отчёт целиком, и файл отчёта уезжает в тикет или в чат. С флагом `--report-exclude-env` тот же код печатает `undefined` — поля `environmentVariables` в отчёте нет. Та же логика у сервисов ошибок и у отладочных страниц: всё, что «собирает контекст для разбора», рискует собрать и окружение.';

export const SECRET_YAML = `apiVersion: v1
data:
  DB_PASSWORD: cGctWng4MS1zZWNyZXQ=
kind: Secret
metadata:
  creationTimestamp: null
  name: db`;

export const SECRET_YAML_NOTE =
  'Так выглядит Secret, который пишет `kubectl create secret generic db --from-literal=DB_PASSWORD=pg-Zx81-secret`. Значение — base64: `echo cGctWng4MS1zZWNyZXQ= | base64 -d` возвращает пароль. Это кодировка, чтобы в YAML помещались любые байты, а не шифр. По документации Kubernetes Secret и в хранилище кластера (etcd) по умолчанию лежит без шифрования; его включают отдельно. Кто может читать Secret в пространстве имён или запустить там под — видит значение.';

export const POD_YAML = `containers:
  - name: api
    env:
      - name: DB_PASSWORD          # переменная: фиксируется при старте контейнера
        valueFrom:
          secretKeyRef: { name: db, key: DB_PASSWORD }
    volumeMounts:
      - name: db                   # файл: /run/secrets/db/DB_PASSWORD
        mountPath: /run/secrets/db
        readOnly: true
volumes:
  - name: db
    secret: { secretName: db }`;

export const ENV_VS_FILE: { k: string; env: string; file: string }[] = [
  { k: 'видно в `/proc/<pid>/environ`', env: '**да**, до конца жизни процесса', file: 'нет' },
  { k: 'получают дочерние процессы', env: '**да**, по умолчанию', file: 'нет, если не передать путь' },
  { k: 'попадает в отчёт о падении и в `docker inspect`', env: '**да**', file: 'нет' },
  { k: 'обновится после смены Secret', env: 'нет: только пересоздание пода', file: 'да, с задержкой; кроме монтирования через `subPath`' },
  { k: 'как читает приложение', env: '`process.env.DB_PASSWORD`', file: '`readFileSync(\'/run/secrets/db/DB_PASSWORD\')`' },
];

export const ENV_VS_FILE_NOTE =
  'Файл в томе безопаснее переменной по всем строкам, кроме удобства. Ещё один плюс файла — ротация без перезапуска: kubelet подменяет файл сам. Только приложение должно перечитать его, а не держать пароль в памяти с момента старта. Насколько долго идёт подмена и почему переменная не меняется никогда, замерено на ConfigMap в [«Kubernetes: развёртывание», раздел «Тонкие места»](/delivery/kubernetes/#s6) — для Secret механизм тот же. Как хранить Secret в Git, не выдавая значения, — в [«Одном манифесте на много окружений», раздел «Секреты в Git»](/delivery/helm-gitops/#s9).';

// ─── Раздел 6. Утечка: найти и сменить ─────────────────────────────────────────────────────

export const GIT_TRANSCRIPT = `$ printf 'STRIPE_SECRET=sk_live_51HqLyjWDarjtT1zdp7dc\\n' > .env
$ git add .env && git commit -qm 'add config'
$ git rm -q --cached .env && echo .env > .gitignore
$ git add .gitignore && git commit -qm 'remove .env, ignore it'

$ git grep sk_live HEAD                 # в текущем дереве — ничего
$ git log --oneline -S sk_live_ --all   # коммиты, где строка появилась или исчезла
f68d630 remove .env, ignore it
47d7cef add config
$ git show 47d7cef:.env
STRIPE_SECRET=sk_live_51HqLyjWDarjtT1zdp7dc`;

export const GIT_NOTE =
  'Коммит «удалить `.env`» удаляет файл из **следующей** версии. Предыдущая лежит в истории, и `git log -S` находит её за секунду — так же быстро, как это сделает бот, который читает новые публичные репозитории. Переписать историю (`git filter-repo` и принудительный push) можно, но копии у тех, кто успел склонировать, в форках и в кешах CI это не тронет. Поэтому порядок один: **сначала сменить секрет**, потом чистить историю — если вообще чистить.';

export const CI_NOTE =
  'В CI секрет живёт в окружении шага, и конвейер прячет его в логе звёздочками. Маскирование ищет точную строку, поэтому base64 или половина секрета печатаются открыто — это снято прогоном в [«GitHub Actions», раздел «Права и секреты»](/delivery/github-actions/#s7). Для этой темы важнее другое: шаг сборки, которому передали секрет, может вписать его в бандл через `define` — и тогда маскирование ни при чём, секрет уезжает в артефакт. Секреты отдают только тому шагу, который их использует, а шагу `vite build` — никаких.';

export const PLAIN_ENTROPY =
  'Энтропия — мера того, насколько строка «перемешана». В слове `Магазин` буквы складываются в знакомый узор, и угадать следующую легко. В случайном ключе каждый символ — сюрприз. Сканер считает, сколько в среднем «сюрприза» несёт символ, в битах: у осмысленного текста мало, у случайного ключа много.';

export const SCAN_CODE = `// Ключи, которые узнаются по виду: у каждого сервиса свой префикс.
const RULES = [
  { rule: 'GitHub token', re: /\\bgh[pousr]_[A-Za-z0-9]{36,}\\b/g },
  { rule: 'AWS access key', re: /\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b/g },
  { rule: 'Stripe secret key', re: /\\b[rs]k_live_[0-9A-Za-z]{16,}\\b/g },
  { rule: 'закрытый ключ PEM', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { rule: 'JWT', re: /\\beyJ[\\w-]{8,}\\.eyJ[\\w-]{8,}\\.[\\w-]{8,}/g },
  { rule: 'пароль в адресе', re: /\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s:@\\/'"\`]+:[^\\s@\\/'"\`]+@/gi },
];

// Энтропия Шеннона: сколько бит в среднем несёт один символ строки.
function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function scanSecrets(text, { minLen = 20, minBits = 4, needDigit = true } = {}) {
  const found = [];
  for (const { rule, re } of RULES) {
    for (const m of text.matchAll(re)) found.push({ rule, value: m[0], at: m.index });
  }
  // Строковые литералы без пробелов: кандидаты в случайные ключи.
  const literal = new RegExp('(["\\'\`])([\\\\w+/=.-]{' + minLen + ',})\\\\1', 'g');
  for (const m of text.matchAll(literal)) {
    const value = m[2];
    const at = m.index + 1;
    if (found.some((f) => at < f.at + f.value.length && f.at < at + value.length)) continue;
    const bits = entropy(value);
    if (bits < minBits) continue;
    if (needDigit && !(/\\d/.test(value) && /[A-Za-z]/.test(value))) continue;
    found.push({ rule: 'энтропия ' + bits.toFixed(2), value, at });
  }
  return found.sort((a, b) => a.at - b.at);
}`;

export const SCAN_NOTE =
  'У сканера два приёма. **Правила** узнают ключи по виду: сервисы нарочно дают своим ключам префиксы — `ghp_`, `AKIA`, `sk_live_`, — чтобы такие строки находились поиском. **Энтропия** ловит то, у чего префикса нет, но расплачивается ошибками в обе стороны. Строка из 20 символов не может набрать больше `log2(20) ≈ 4,32` бит на символ, даже если все символы разные. Поэтому порог 4,5 пропускает любой короткий ключ, а порог 4,0 срабатывает на длинные имена из React.';

/** Строки React, которые сканер видит как кандидатов: литералы ≥ 20 символов с энтропией ≥ 3,5. */
export const REACT_LITERALS = [
  'react.view_transition',
  'react.optimistic_key',
  'react.memo_cache_sentinel',
  'colorInterpolationFilters',
  'color-interpolation-filters',
  'glyphOrientationHorizontal',
  'glyph-orientation-horizontal',
  'glyphOrientationVertical',
  'glyph-orientation-vertical',
  'strikethrough-position',
  'strikethroughThickness',
  'strikethrough-thickness',
  'onDoubleClickCapture',
  'unstable_legacy-backwards',
  'dangerouslySetInnerHTML',
  'suppressContentEditableWarning',
  'suppressHydrationWarning',
  'externalResourcesRequired',
  'disablePictureInPicture',
  'disableRemotePlayback',
  'view-transition-class',
];

export const KEYS_SAMPLE = `export const config = {
  apiUrl: "https://api.shop.example",
  sentryDsn: "https://k3y@o1.ingest.sentry.io/42",
  stripePublic: "pk_live_51HqLyjWDarjtT1zdAbCdEf",
  stripeSecret: "sk_live_51HqLyjWDarjtT1zdp7dc",
  awsKeyId: "AKIAQX7Z3LM2PRT5WN4E",
  signingKey: "Kq8vT3nB0xLwYz5RpA7m",
  databaseUrl: "postgres://app:pg-Zx81-secret@db:5432/shop",
  session: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.c2lnbmF0dXJlLXZhbHVl",
};`;

export const SCAN_SAMPLES: ScanSample[] = [
  {
    id: 'config',
    label: 'Модуль с ключами',
    note: 'Модуль настроек, попавший в бандл целиком. Секреты в нём — `sk_live_`, ключ AWS, ключ подписи, пароль в адресе базы и чужой токен сессии. `pk_live_` и DSN Sentry публичны.',
    text: KEYS_SAMPLE,
    secrets: [
      'sk_live_51HqLyjWDarjtT1zdp7dc',
      'AKIAQX7Z3LM2PRT5WN4E',
      'Kq8vT3nB0xLwYz5RpA7m',
      'pg-Zx81-secret',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.c2lnbmF0dXJlLXZhbHVl',
    ],
  },
  {
    id: 'define',
    label: 'Бандл с `define`',
    note: 'Бандл из строки «весь `process.env`» таблицы бандлов — то, что Vite записал на самом деле. Секреты — токен выката и пароль базы.',
    text: '', // заполняется ниже из BUNDLE_ROWS
    secrets: ['ghp_R8x2kVq9TzL4mWn7Yb3Hc6Jd1Fp0Sa5Ge8Ku', 'pg-Zx81-secret'],
  },
  {
    id: 'react',
    label: 'Строки React',
    note: 'Длинные строковые литералы из бандла React 19.3 (react + react-dom/client, esbuild с `minify`). Секретов здесь нет: всё, что найдено, — ложная тревога.',
    text: '[' + REACT_LITERALS.map((s) => JSON.stringify(s)).join(', ') + ']',
    secrets: [],
  },
];
SCAN_SAMPLES[1].text = BUNDLE_ROWS.find((r) => r.id === 'defineAll')!.out;

export const SCAN_THRESHOLDS = [3.5, 4, 4.5];

export const SCAN_DEMO_CAPTION =
  'Считает `scanSecrets` — функция выше — над выбранным текстом. У каждого образца известно, что в нём настоящий секрет, поэтому видно три исхода: пойман, пропущен, ложная тревога. Пароль `pg-Zx81-secret` энтропия не найдёт ни при каком пороге: он короткий и осмысленный, как почти любой пароль, придуманный человеком.';

/** Ложные тревоги на настоящих бандлах: число находок `scanSecrets` при пороге и требовании цифры. */
export const SCAN_STATS: { lib: string; bytes: number; hits: Record<string, number> }[] = [
  { lib: 'Vue 3.5.42', bytes: 125888, hits: { '3.5': 5, '3.5d': 0, '4': 0, '4d': 0, '4.5': 0, '4.5d': 0 } },
  { lib: 'React 19.3.0 + react-dom', bytes: 222712, hits: { '3.5': 33, '3.5d': 0, '4': 9, '4d': 0, '4.5': 0, '4.5d': 0 } },
  { lib: 'd3-scale + d3-shape', bytes: 81355, hits: { '3.5': 0, '3.5d': 0, '4': 0, '4d': 0, '4.5': 0, '4.5d': 0 } },
];

export const SCAN_STATS_NOTE =
  'Требование «в строке есть и буквы, и цифры» убрало все ложные тревоги на трёх библиотеках при любом пороге: имена свойств и событий цифр почти не содержат. Но это ровно та эвристика, которую обойдёт ключ из одних букв. Энтропийный сканер — сито для истории git и чужого кода, где значений не знаешь. Свои секреты надёжнее искать **по значению**: взять каждое значение из хранилища секретов и проверить, нет ли его в собранных файлах. Так устроена проверка после сборки в [«Безопасности бэкенда», раздел «Ошибки и секреты»](/platform/backend-security/#s5). И не забыть карты исходников: в `sourcesContent` лежит исходник целиком, с комментариями, — [«Source maps изнутри», раздел «Карты в продакшене»](/tooling/source-maps/#s5).';

export const ROTATION_STEPS: { t: string; d: string; tone: 'info' | 'warn' | 'err' }[] = [
  {
    t: '1. Выпустить новый, не отзывая старый',
    d: 'У большинства сервисов может быть два действующих ключа сразу. Пока работают оба, перезапуск по одному поду ничего не ломает.',
    tone: 'info',
  },
  {
    t: '2. Раздать новый всем потребителям',
    d: 'Обновить значение в хранилище секретов и перезапустить всё, что держит секрет в переменной окружения. Файл в томе обновится сам — если приложение его перечитывает.',
    tone: 'info',
  },
  {
    t: '3. Убедиться, что старым больше не пользуются',
    d: 'По журналу сервиса: когда ключ использовался последний раз и откуда. Забытый крон или второй регион всплывают именно здесь.',
    tone: 'warn',
  },
  {
    t: '4. Отозвать старый',
    d: 'После этого утечка старого значения ничего не стоит. Если секрет **уже утёк**, шаги идут в обратном порядке: сначала отзыв, пусть и с простоем, — им пользуется кто-то, кроме вас.',
    tone: 'err',
  },
];

export const ROTATION_NOTE =
  'Ротация по расписанию нужна не потому, что ключи «стареют». Она проверяет, что смену вообще можно сделать: где лежит секрет, кто его читает, переживёт ли сервис перезапуск. Если плановую ротацию ни разу не делали, срочная после утечки займёт часы, а не минуты. GitHub проверяет пуши на известные форматы ключей (push protection) и сообщает о найденных в публичных репозиториях самим сервисам — часть из них отзывает ключ сразу. Это страховка, а не процедура: о частном ключе вашего API GitHub не знает.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Префикс `VITE_` — не шифрование',
    d: 'Префикс решает только, согласится ли Vite вписать значение в бандл. Всё, что вписано, читает каждый посетитель. Секрету префикс не нужен — ему не нужно быть во фронтенде вовсе.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`.env.local` не перебивает `.env.production`',
    d: 'В Vite режимный файл читается позже и побеждает. В Next — наоборот. Переходя между ними, легко «починить» адрес в `.env.local` и не понять, почему рабочая сборка его не видит.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`${DB_PASSWORD}` внутри `VITE_`-переменной',
    d: 'Подстановка выполняется до фильтра по префиксу. `VITE_DEBUG_DB=${DB_PASSWORD}` вписывает пароль в бандл, и Vite не предупреждает.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`define: { \'process.env\': … }` — всё окружение машины',
    d: 'С `loadEnv(mode, cwd, \'\')` в бандл уезжают все переменные оболочки сборки: на CI это токены, переданные шагу. Называйте в `define` каждое имя отдельно.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`import.meta.env` целиком или по ключу',
    d: '`console.log(import.meta.env)` для отладки или `import.meta.env[name]` вписывает весь объект: все `VITE_*`, включая те, что код не читает.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`process.env.DEBUG = false` — это `"false"`',
    d: 'Окружение хранит только строки, и непустая строка в условии истинна. Разбирайте переменные явно при старте и падайте, если обязательной нет.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`delete process.env.X` не стирает `/proc`',
    d: 'Файл `/proc/<pid>/environ` хранит окружение на момент запуска. Удалённая в Node переменная там остаётся и доступна всем процессам того же пользователя.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Secret в Kubernetes — base64, а не шифр',
    d: 'Любой, кто может прочитать объект, получает значение одной командой `base64 -d`. Переменная из Secret к тому же не обновится, пока под не пересоздадут.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Удалили файл коммитом — секрет в истории',
    d: '`git log -S` находит его сразу. История у клонов и форков не перепишется. Утёкший секрет меняют, а не прячут.',
    tone: 'err',
  },
  {
    n: '10',
    t: 'Сканер не видит человеческих паролей',
    d: 'Энтропия ловит длинные случайные строки. Короткий ключ без префикса и пароль вида `pg-Zx81-secret` проходят мимо. Свои секреты ищут по значению.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'The Twelve-Factor App — III. Config',
    href: 'https://12factor.net/config',
    what: 'конфигурация в окружении и проверка «можно ли открыть исходники прямо сейчас»',
  },
  {
    title: 'Vite — Env Variables and Modes',
    href: 'https://vite.dev/guide/env-and-mode',
    what: '`import.meta.env`, префикс `VITE_`, порядок `.env`-файлов, режимы',
  },
  {
    title: 'Vite — Shared Options: define, envPrefix',
    href: 'https://vite.dev/config/shared-options',
    what: 'как `define` заменяет выражения и почему `envPrefix` не может быть пустым',
  },
  {
    title: 'esbuild — define',
    href: 'https://esbuild.github.io/api/#define',
    what: 'значение `define` — текст кода; подстановка `process.env.NODE_ENV` для браузера',
  },
  {
    title: 'Next.js — Environment Variables',
    href: 'https://nextjs.org/docs/app/guides/environment-variables',
    what: '`NEXT_PUBLIC_`, порядок файлов (`.env.local` выше режимного), почему `process.env[имя]` не подставляется',
  },
  {
    title: 'Node.js — process.env',
    href: 'https://nodejs.org/api/process.html#processenv',
    what: 'присваивание приводит значение к строке',
  },
  {
    title: 'Node.js — child_process, options.env',
    href: 'https://nodejs.org/api/child_process.html#child_processspawncommand-args-options',
    what: 'дочерний процесс по умолчанию получает `process.env` родителя',
  },
  {
    title: 'Node.js — Diagnostic report',
    href: 'https://nodejs.org/api/report.html',
    what: '`environmentVariables` в отчёте и флаг `--report-exclude-env`',
  },
  {
    title: 'proc(5) — /proc/pid/environ',
    href: 'https://man7.org/linux/man-pages/man5/proc.5.html',
    what: 'окружение процесса на момент `execve`; права на чтение',
  },
  {
    title: 'Kubernetes — Secrets',
    href: 'https://kubernetes.io/docs/concepts/configuration/secret/',
    what: 'base64 в `data`, хранение в etcd без шифрования по умолчанию, обновление тома и `subPath`',
  },
  {
    title: 'Kubernetes — Good practices for Kubernetes Secrets',
    href: 'https://kubernetes.io/docs/concepts/security/secrets-good-practices/',
    what: 'шифрование в etcd, права на чтение Secret, монтирование файлом',
  },
  {
    title: 'OWASP — Secrets Management Cheat Sheet',
    href: 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html',
    what: 'ротация, отзыв, что делать после утечки, секреты в CI',
  },
  {
    title: 'GitHub Docs — Secret scanning',
    href: 'https://docs.github.com/en/code-security/secret-scanning',
    what: 'push protection и сообщения о найденных ключах их владельцам',
  },
  {
    title: 'git log — опция -S',
    href: 'https://git-scm.com/docs/git-log',
    what: 'поиск коммитов, где строка появилась или исчезла',
  },
  {
    title: 'git-filter-repo',
    href: 'https://github.com/newren/git-filter-repo',
    what: 'переписывание истории; чего оно не может — достать копии у других',
  },
  {
    title: 'Stripe — API keys',
    href: 'https://docs.stripe.com/keys',
    what: 'чем `pk_live_` отличается от `sk_live_`',
  },
  {
    title: 'Firebase — API keys',
    href: 'https://firebase.google.com/docs/projects/api-keys',
    what: 'почему `apiKey` Firebase не секрет и что его заменяет',
  },
];

export const RELATED =
  'Смежное на сайте: [GitHub Actions, раздел «Права и секреты»](/delivery/github-actions/#s7) — маскирование в логе и почему его обходит base64. [Один манифест на много окружений, разделы «Три окружения» и «Секреты в Git»](/delivery/helm-gitops/#s1) — один образ на все окружения, Sealed Secrets и SOPS. [Docker, раздел «Тонкие места»](/delivery/docker/#s7) — секрет, попавший в слой образа, остаётся там навсегда. [Docker Compose, раздел «Переменные окружения»](/delivery/compose/#s5) — откуда контейнер берёт переменные и кто кого перебивает. [Kubernetes: развёртывание, раздел «Тонкие места»](/delivery/kubernetes/#s6) — ConfigMap: том обновляется, переменная нет. [Безопасность бэкенда, раздел «Ошибки и секреты»](/platform/backend-security/#s5) — поиск утечки по значению после сборки. [Source maps изнутри, раздел «Карты в продакшене»](/tooling/source-maps/#s5) — карта отдаёт исходник целиком. [Фича-флаги](/delivery/feature-flags/) — как флаг раскладывает пользователей по корзинам, OpenFeature и порядок удаления флага. [Git изнутри](/tooling/git-internals/) — объекты, ветки как файлы, слияние и rebase. [Инфраструктура как код](/delivery/infrastructure-as-code/) — состояние, план и граф Terraform/OpenTofu, `count` против `for_each`.';

// ─── Таблицы для печати ────────────────────────────────────────────────────────────────────

export const PUBLIC_TABLE = {
  head: ['что', 'вердикт', 'почему'],
  rows: PUBLIC_ROWS.map((r) => [r.k, r.v, r.why]),
  tones: PUBLIC_ROWS.map((r) => r.tone),
  cols: 'minmax(170px,.8fr) minmax(130px,.6fr) minmax(280px,2fr)',
  kinds: ['prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 640,
};

export const ESBUILD_TABLE = {
  head: ['`define`', 'бандл', 'что произошло'],
  rows: ESBUILD_ROWS.map((r) => [
    r.define ? Object.entries(r.define).map(([k, v]) => `\`'${k}': ${v.startsWith('<') ? v.slice(1, -1) : `'${v}'`}\``).join('') : r.k,
    '`' + r.out + '`',
    r.why,
  ]),
  tones: ESBUILD_ROWS.map((r) => r.tone),
  cols: 'minmax(200px,1fr) minmax(300px,1.6fr) minmax(240px,1.2fr)',
  kinds: ['prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 860,
};

export const ORDER_TABLE = {
  head: ['№', 'источник', 'когда читается', 'в git'],
  rows: ORDER_ROWS.map((r) => [r.n, r.file, r.when, r.git]),
  tones: [] as 'info'[],
  cols: 'minmax(40px,.2fr) minmax(180px,1fr) minmax(170px,1fr) minmax(220px,1.3fr)',
  kinds: ['mono', 'prose', 'prose', 'prose'] as ('mono' | 'prose')[],
  minWidth: 620,
};

export const RUNTIME_TABLE = {
  head: ['', 'при сборке', 'при запуске'],
  rows: RUNTIME_ROWS.map((r) => [r.k, r.build, r.run]),
  tones: [] as 'info'[],
  cols: 'minmax(170px,.9fr) minmax(220px,1.2fr) minmax(220px,1.2fr)',
  kinds: ['prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 640,
};

export const ENV_VS_FILE_TABLE = {
  head: ['', 'переменная окружения', 'файл в томе'],
  rows: ENV_VS_FILE.map((r) => [r.k, r.env, r.file]),
  tones: [] as 'info'[],
  cols: 'minmax(200px,1fr) minmax(200px,1fr) minmax(220px,1.1fr)',
  kinds: ['prose', 'prose', 'prose'] as 'prose'[],
  minWidth: 660,
};

const STAT_KEYS = ['3.5', '4', '4.5'];

export const SCAN_STATS_TABLE = {
  head: ['бандл', 'байт', ...STAT_KEYS.map((k) => `порог ${k.replace('.', ',')}`)],
  rows: SCAN_STATS.map((s) => [
    s.lib,
    s.bytes.toLocaleString('ru-RU').replace(/\s/g, ' '),
    ...STAT_KEYS.map((k) => `${s.hits[k]} → ${s.hits[k + 'd']} с цифрой`),
  ]),
  tones: SCAN_STATS.map((s) => (s.hits['4'] > 0 ? 'warn' : 'ok') as 'warn' | 'ok'),
  cols: 'minmax(190px,1.2fr) minmax(90px,.5fr) repeat(3, minmax(120px,.7fr))',
  kinds: ['prose', 'mono', 'prose', 'prose', 'prose'] as ('prose' | 'mono')[],
  minWidth: 720,
};
