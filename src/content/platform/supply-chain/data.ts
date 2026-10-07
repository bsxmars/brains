import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AttrVariant, SupplyDemo } from '@/widgets/supply-lab/model/types';

/**
 * Данные темы «Безопасность цепочки поставок: lock-файл, integrity, provenance».
 *
 * Тема написана здесь, 2026-10-02. Тема защитная: ни одного рабочего вредного пакета —
 * фикстура `greeter` со скриптами установки, которые дописывают строку в файл проекта.
 *
 * ── Стенд (октябрь 2026, без сети) ───────────────────────────────────────────────────────
 * Node 24.11.0, npm 11.6.1, pnpm 11.0.9, `ssri` 13.0.1 (из `node_modules` проекта),
 * Chromium 153.0.8010.12 (Playwright 1.63). Все команды npm — с пустым `--userconfig`,
 * отдельным `--cache` на каждый прогон и `--no-audit`.
 *
 *   — Пакет `greeter` (`GREETER_*`) собран `npm pack --ignore-scripts`: 602 байта, упаковка
 *     детерминирована (время файлов 1985 год, права нормализованы), повтор даёт тот же хеш.
 *     ⚠️ Без `files` в `package.json` второй `npm pack` упаковал первый тарбол внутрь
 *     второго — хеш «плавал» от запуска к запуску. Отсюда поле `files` в фикстуре.
 *   — `npm install ./greeter-1.0.0.tgz` с переменной `DEMO_TOKEN` в окружении → `LIFECYCLE_LOG`;
 *     с `--ignore-scripts` журнала нет; `npm ci` и `npm rebuild` запускают те же три скрипта
 *     снова. `prepare` при установке из архива не запускается, а `npm pack` без
 *     `--ignore-scripts` его запустил.
 *   — Подмена тарбола под тем же именем, `npm ci` по старому lock-файлу (`TAMPER_ROWS`):
 *     байты 0–1 (подпись gzip), 3–9 (заголовок) → `EINTEGRITY`; байт 2 (метод сжатия),
 *     байты сжатых данных и хвоста (CRC32, длина) → `Z_DATA_ERROR` с разными текстами zlib
 *     (распаковка ломается раньше, чем досчитан хеш); пересобранный архив с правкой
 *     `index.js` → `EINTEGRITY`. Правило «подпись цела и gzip не распаковывается → zlib»
 *     (`npmOutcome` в `widgets/supply-lab/model/run.ts`) сверено с npm на 11 байтах — тестом. npm каждый раз пишет «seems to be corrupted. Trying again.»
 *     дважды — три попытки — и падает.
 *   — Учебный реестр на `node:http` (127.0.0.1:4981–4982, сливающий прокси на 4985):
 *     подмена тарбола на реестре, путаница зависимостей (`CONFUSION_ROWS`), `--before`,
 *     `npm sbom`. Журнал запросов реестров — источник колонки «кого спросил npm».
 *   — `--ignore-scripts` отключает и `postinstall` самого проекта: в `package.json` приложения
 *     скрипт не выполнился с флагом и выполнился без него.
 *   — Нормализовано в выводах: «added 1 package in 261ms» → «added 1 package», строки
 *     «Progress» у pnpm убраны, путь к тарболу у pnpm приведён к `greeter-1.0.0.tgz`
 *     (на стенде `../pkg/greeter-1.0.0.tgz`), в EINTEGRITY путь заменён на `…`.
 *   — pnpm 11.0.9 на том же тарболе: `ERR_PNPM_IGNORED_BUILDS`, в `pnpm-workspace.yaml`
 *     дописано `allowBuilds: { greeter: set this to true or false }`; после
 *     `pnpm approve-builds greeter` три скрипта выполнились.
 *   — Chromium: сайт `site.test` и CDN `cdn.test` на 127.0.0.1 через `--host-resolver-rules`,
 *     29 вариантов атрибута `integrity` (`BROWSER_ROWS` — их часть), `fetch` с `integrity`.
 *
 * Всё перечисленное, кроме pnpm, пересобирается `tests/unit/supply-chain.test.ts`: тест
 * пакует фикстуру, ставит её npm, портит байты, поднимает реестры и Chromium на тех же
 * портах 4981–4985. `SRI_CODE` сверяется там с `ssri` и `node:crypto` и с решением Chromium.
 *
 * ── Что по документации, без запуска ────────────────────────────────────────────────────
 * Provenance и Sigstore (`npm publish --provenance`, trusted publishing), проверка подписей
 * реестра — `npm audit signatures` на стенде упёрся в учебный реестр без ключей
 * (`AUDIT_SIGNATURES_RUN`), до npmjs он не ходил. База уязвимостей `npm audit` и её шум.
 * pnpm 10 (`onlyBuiltDependencies`) и `minimumReleaseAge` у pnpm 11 — по документации
 * и по стенду «Пакетных менеджеров». Истории event-stream, ua-parser-js, crossenv,
 * dependency confusion 2021 и захвата пакетов в сентябре 2025 — по публичным разборам.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'цепочка поставок',
    d: 'Всё, через что чужой код попадает в ваш продукт: реестр пакетов, аккаунты их авторов, конвейер, который пакет собрал, CDN, с которого грузится скрипт. Атака на цепочку бьёт не в ваш код, а в одно из этих звеньев.',
  },
  {
    k: 'скрипт установки',
    d: 'Команда из поля `scripts` пакета, которую менеджер запускает сам во время установки: `preinstall`, `install`, `postinstall`. Это обычная программа с правами того, кто ставит пакет.',
  },
  {
    k: 'тарбол',
    d: 'Архив `.tgz` с файлами одной версии пакета. Реестр хранит по тарболу на версию; `npm install` скачивает его и распаковывает в `node_modules`.',
  },
  {
    k: '`integrity` (SRI-строка)',
    d: 'Запись вида `sha512-<base64>`: имя хеш-функции и хеш байтов файла. Её понимают и npm (поле в lock-файле), и браузер (атрибут у `<script>`). Байты разошлись с записью — файл не принимают.',
  },
  {
    k: 'scope',
    d: 'Префикс имени пакета через `@`: `@acme/utils`. Scope принадлежит одному владельцу в реестре, и для него в `.npmrc` можно указать отдельный реестр.',
  },
  {
    k: 'provenance',
    d: 'Подписанная запись о происхождении версии: из какого репозитория, какого коммита и каким конвейером собран тарбол. Публикуется вместе с пакетом, проверяется по публичному журналу.',
  },
  {
    k: 'SBOM',
    d: 'Software Bill of Materials — опись всех пакетов продукта с версиями и хешами в стандартном формате (CycloneDX или SPDX). Нужна, чтобы в день новой уязвимости найти, где стоит пострадавшая версия.',
  },
];

export const PLAIN_SUPPLY =
  'Как кухня ресторана. Повар отвечает за свои блюда, но продукты привозят поставщики, а ключи от склада есть у грузчиков. Испорченная партия муки или чужой человек с ключами испортят ужин, хотя рецепт правильный. Lock-файл — накладная с пломбами, integrity — сами пломбы, provenance — сертификат с адресом фабрики.';

export const PREREQ_NOTE =
  'Тема продолжает разговор о менеджерах пакетов и о заголовках безопасности. Две вещи здесь нужны из других тем, одна объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Lock-файл и `npm ci`',
    d: '`package-lock.json` записывает точную версию, адрес и хеш каждого пакета дерева. `npm ci` ставит ровно его и падает, если `package.json` просит другого; `npm install` в той же ситуации переписывает lock-файл.',
    href: '/tooling/package-managers/#s3',
    hrefLabel: '«Пакетные менеджеры», раздел «Lock-файл»',
    tone: 'info',
  },
  {
    t: 'CORS',
    d: 'Скрипт с чужого адреса браузер может просто исполнить, но прочитать его байты странице разрешает только ответ с заголовком `Access-Control-Allow-Origin`. Это понадобится для проверки хеша у CDN-скрипта.',
    href: '/platform/security/#s2',
    hrefLabel: '«Безопасность фронтенда», раздел «CORS и preflight»',
    tone: 'info',
  },
  {
    t: 'Хеш-функция и base64',
    d: 'SHA-512 превращает файл любого размера в 64 байта. Тот же файл — те же байты; один изменённый бит — совсем другие. Base64 записывает 64 байта 88 символами из букв, цифр, `+`, `/` и `=`. Подобрать другой файл с тем же хешем на практике невозможно.',
    tone: 'info',
  },
];

// ─── Раздел 1. Что исполняет установка ────────────────────────────────────────────────────

/** Фикстура: `package.json` пакета `greeter`. Тест пишет её на диск и пакует `npm pack`. */
export const GREETER_PACKAGE_JSON = `{
  "name": "greeter",
  "version": "1.0.0",
  "main": "index.js",
  "files": ["index.js", "log.js"],
  "scripts": {
    "preinstall": "node log.js",
    "install": "node log.js",
    "postinstall": "node log.js",
    "prepare": "node log.js"
  }
}
`;

export const GREETER_INDEX_JS = "module.exports = (name) => 'Привет, ' + name;\n";

/**
 * Скрипт установки фикстуры. Безобиден: дописывает строку в файл проекта.
 * `String.raw` — ради `'\n'` внутри: обычный шаблон превратил бы его в перевод строки.
 */
export const GREETER_LOG_JS = String.raw`// Скрипт установки: дописывает строку в журнал проекта.
const fs = require('node:fs');
const path = require('node:path');
const env = process.env;
const where = process.cwd().replace(env.INIT_CWD, '<app>');
const line = env.npm_lifecycle_event + ' cwd=' + where +
  ' DEMO_TOKEN=' + (env.DEMO_TOKEN ? 'виден' : 'нет');
fs.appendFileSync(path.join(env.INIT_CWD, 'lifecycle.log'), line + '\n');
`;

export const INSTALL_RUN_CODE = `$ DEMO_TOKEN=demo npm install ./greeter-1.0.0.tgz
added 1 package

$ cat lifecycle.log`;

/** Журнал после `npm install` тарбола. Пересобирается тестом. */
export const LIFECYCLE_LOG = `preinstall cwd=<app>/node_modules/greeter DEMO_TOKEN=виден
install cwd=<app>/node_modules/greeter DEMO_TOKEN=виден
postinstall cwd=<app>/node_modules/greeter DEMO_TOKEN=виден
`;

export const LIFECYCLE_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Три скрипта, по порядку',
    d: '`preinstall`, `install`, `postinstall` — в папке пакета внутри `node_modules`. `INIT_CWD` — папка, где вы набрали команду: скрипт знает, где лежит ваш проект, и может писать туда.',
  },
  {
    t: 'Окружение — ваше',
    d: 'Переменная `DEMO_TOKEN` из окружения команды видна скрипту. На раннере CI в окружении лежат токены деплоя и реестра — и скрипт любой зависимости любой глубины может их прочитать.',
    tone: 'err',
  },
  {
    t: '`prepare` — не для установки из архива',
    d: 'В журнале его нет. `prepare` запускается у автора: на `npm pack` и `npm publish` (`npm pack` без `--ignore-scripts` его выполняет) и при установке из git, где пакет надо сначала собрать.',
  },
  {
    t: '`npm ci` и `npm rebuild` — снова',
    d: 'Lock-файл скрипты не отключает: `npm ci` по тому же lock-файлу и `npm rebuild` прогнали все три ещё раз. Поле `hasInstallScript: true` в записи lock-файла только помечает, что они есть.',
    tone: 'warn',
  },
];

export const IGNORE_SCRIPTS_CODE = `# Разово
$ npm install ./greeter-1.0.0.tgz --ignore-scripts
added 1 package
$ cat lifecycle.log
cat: lifecycle.log: No such file or directory

# Для проекта — строкой в .npmrc
ignore-scripts=true`;

export const IGNORE_SCRIPTS_NOTE =
  '`--ignore-scripts` отключает скрипты **всех** пакетов, без разбора. Пакетам, которым сборка при установке действительно нужна (нативные модули, скачивание бинарника под вашу платформу), придётся запускать её явно: `npm rebuild <имя>`. И флаг заодно отключает скрипты самого проекта вокруг `install` — `preinstall` и `postinstall` в вашем `package.json` тоже не выполнятся.';

export const PNPM_RUN_CODE = `$ pnpm add ./greeter-1.0.0.tgz          # pnpm 11.0.9
+ greeter 1.0.0
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: greeter@file:greeter-1.0.0.tgz
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.

$ cat pnpm-workspace.yaml               # pnpm дописал сам
allowBuilds:
  greeter: set this to true or false

$ pnpm approve-builds greeter           # после одобрения три скрипта выполнились
allowBuilds:
  greeter: true`;

export const PNPM_NOTE =
  'pnpm перевернул умолчание. С версии 10 скрипты зависимостей не запускаются, пока пакет не внесён в список разрешённых (`onlyBuiltDependencies`); pnpm 11 называет список `allowBuilds` и вдобавок **падает** с кодом 1, а не молча пропускает. npm 11.6.1 скрипты запускает по умолчанию. Как это выглядит у npm с `strict-allow-scripts` и почему одобрение пишется с версией — в [«Пакетных менеджерах», раздел «Скрипты установки и цепочка поставок»](/tooling/package-managers/#s6).';

// ─── Раздел 2. integrity в lock-файле ────────────────────────────────────────────────────

/** Запись lock-файла после `npm install ./greeter-1.0.0.tgz`. Пересобирается тестом. */
export const LOCK_ENTRY_CODE = `"node_modules/greeter": {
  "version": "1.0.0",
  "resolved": "file:greeter-1.0.0.tgz",
  "integrity": "sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A==",
  "hasInstallScript": true
}`;

export const LOCK_INTEGRITY =
  'sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A==';

export const PLAIN_INTEGRITY =
  'Как пломба на мешке с номером. Накладная (lock-файл) говорит: «мешок с пломбой 4817». Приехал мешок с другим номером — неважно, что внутри, хоть та же мука: его не вскрывают. Пломбе всё равно, что поменяли — один байт в заголовке архива или половину кода.';

export const WHERE_INTEGRITY_ROWS: { k: string; from: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'первая установка, lock-файла нет',
    from: 'npm берёт `dist.integrity` из документа пакета, который отдал **реестр**, сверяет с ним скачанный тарбол и записывает в lock-файл',
    tone: 'warn',
  },
  {
    k: 'lock-файл есть',
    from: 'сверка идёт с записью lock-файла — с тем, что было у вас, когда пакет поставили впервые',
    tone: 'ok',
  },
  {
    k: 'тарбол в кеше npm',
    from: 'кеш адресован тем же хешем: архив в нём лежит под своим `integrity`, и npm находит его по записи lock-файла',
    tone: 'ok',
  },
];

export const TAMPER_ROWS: { k: string; what: string; npm: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'байт 9: поле «ОС» в заголовке gzip',
    what: 'файлы внутри те же, распаковка проходит',
    npm: '`EINTEGRITY`: хеш архива другой',
    tone: 'ok',
  },
  {
    k: 'байт 0 или 1: подпись gzip `1f 8b`',
    what: 'файл больше не похож на gzip',
    npm: '`EINTEGRITY`: npm не распаковывает его как gzip, и ошибки zlib нет',
    tone: 'ok',
  },
  {
    k: 'байт в сжатых данных или в хвосте',
    what: 'поток не сходится со своей контрольной суммой или длиной',
    npm: '`Z_DATA_ERROR`: «zlib: incorrect data check», «incorrect length check», «invalid distances set» — распаковка сломалась раньше, чем досчитался хеш',
    tone: 'ok',
  },
  {
    k: 'архив пересобран: в `index.js` добавлен один `!`',
    what: 'валидный пакет, то же имя и версия',
    npm: '`EINTEGRITY`, хотя архив целый и распаковался бы',
    tone: 'ok',
  },
];

/** Сообщение npm ci на пересобранном архиве. Пересобирается тестом (пути и хеши — как сняты). */
export const EINTEGRITY_CODE = `$ npm ci
npm warn tarball tarball data for greeter@file:… (sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A==) seems to be corrupted. Trying again.
npm warn tarball tarball data for greeter@file:… (sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A==) seems to be corrupted. Trying again.
npm error code EINTEGRITY
npm error sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A== integrity checksum failed when using sha512: wanted sha512-nc43lFwcohTt6EDQCpSU3EuV5t4b5qm7zIBTaiyOxkH1OIKjck8FzdQ4HSuY2bVNDC+0s2PKgzOa1dL9WguI0A== but got sha512-eMFBvyp50/8ZcjiLBMUfB7CBhRaVEBklQpLq8ZnwROk79PBgy0tlq80IhlacKDa2/F2Gn32mGc+DIIMt28PFaQ==. (604 bytes)`;

/** Шаблоны сообщений для демо. Тест заполняет их и сверяет с выводом npm и Chromium. */
export const NPM_INTEGRITY_ERROR =
  'npm error code EINTEGRITY\nnpm error {wanted} integrity checksum failed when using {alg}: wanted {wanted} but got {got}. ({size} bytes)';
export const NPM_ZLIB_ERROR = 'npm error code Z_DATA_ERROR';
export const CHROMIUM_BLOCKED =
  "Failed to find a valid digest in the 'integrity' attribute for resource '{url}' with computed {ALG} integrity '{got}'. The resource has been blocked.";

export const REGISTRY_ROWS: { k: string; fresh: string; ci: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'на реестре подменили только тарбол',
    fresh: '`EINTEGRITY`: архив не сходится с `dist.integrity` из документа пакета',
    ci: '`EINTEGRITY`',
    tone: 'ok',
  },
  {
    k: 'подменили тарбол **и** `dist.integrity` в документе',
    fresh: '**ставит**: реестр сам назвал хеш, и архив ему соответствует',
    ci: '`EINTEGRITY`: lock-файл помнит прежний хеш',
    tone: 'warn',
  },
];

export const REGISTRY_NOTE =
  'Отсюда граница lock-файла. Он защищает от подмены **уже записанного**: того же имени той же версии. Против того, кто управляет ответами реестра в момент первой установки, он бессилен — и против новой версии, опубликованной с украденного аккаунта, тоже: у неё свой, честно посчитанный хеш. Чем ещё `npm ci` отличается от `npm install`, разобрано в [«Пакетных менеджерах», раздел «Lock-файл»](/tooling/package-managers/#s3).';

// ─── Раздел 3. SRI в браузере ─────────────────────────────────────────────────────────────

export const SCRIPT_TAG_CODE = `<script
  src="https://cdn.test/greet.js"
  integrity="sha384-4WKtb76r41jxGI0yC4nTfhOLuVUJC8Na9K4gS00RcRTKa7n4nJdFLfJ9IuEm3+VM"
  crossorigin="anonymous"></script>`;

export const PLAIN_SRI =
  'Как заказ на складе по фотографии содержимого. Курьер может привезти коробку от кого угодно, но вы вскрываете её при нём и сверяете с фото. Не совпало — коробка уезжает обратно, и в дом ничего не попадает. CDN — курьер; атрибут `integrity` — фото.';

export const BROWSER_ROWS: { k: string; attr: string; result: string; tone: 'ok' | 'warn' | 'err' }[] = [
  { k: 'верный хеш, `crossorigin`', attr: '`sha384-4WKt…`', result: 'выполнен', tone: 'ok' },
  { k: 'хеш другого файла', attr: '`sha384-IY95…`', result: '**заблокирован**, сработал `onerror`', tone: 'ok' },
  { k: 'без `crossorigin`', attr: 'верный хеш', result: '**заблокирован**: ответ без CORS, байты прочитать нельзя', tone: 'warn' },
  { k: '`crossorigin`, а CDN не прислал `Access-Control-Allow-Origin`', attr: 'верный хеш', result: '**заблокирован** ошибкой CORS, до хеша дело не дошло', tone: 'warn' },
  { k: 'слабый неверный, сильный верный', attr: '`sha256-<чужой> sha512-<верный>`', result: 'выполнен: sha256 не смотрели', tone: 'ok' },
  { k: 'слабый верный, сильный неверный', attr: '`sha256-<верный> sha512-<чужой>`', result: '**заблокирован**: смотрят только sha512', tone: 'ok' },
  { k: 'два хеша одного алгоритма', attr: '`sha384-<старый> sha384-<верный>`', result: 'выполнен: достаточно одного совпадения', tone: 'ok' },
  { k: 'только `sha1`', attr: '`sha1-<любой>`', result: '**выполнен без проверки**: алгоритм неизвестен, атрибут как будто пуст', tone: 'err' },
  { k: 'имя алгоритма заглавными', attr: '`SHA384-<чужой>`', result: '**выполнен без проверки**', tone: 'err' },
  { k: 'мусор или пустая строка', attr: '`hello`, `""`', result: '**выполнен без проверки**', tone: 'err' },
  { k: 'base64url, без `=` в конце', attr: '`sha384-…-_…`', result: 'принят: Chromium сверяет и такую запись', tone: 'ok' },
];

export const BROWSER_CONSOLE_CODE = `// хеш не сошёлся
Failed to find a valid digest in the 'integrity' attribute for resource
'http://cdn.test/lib.js' with computed SHA-384 integrity '…'. The resource has been blocked.

// нет crossorigin
Subresource Integrity: The resource 'http://cdn.test/lib.js' has an integrity attribute,
but the resource requires the request to be CORS enabled to check the integrity, and it is not.

// sha1 — скрипт выполнен, в консоли только это
Error parsing 'integrity' attribute ('sha1-…'). The specified hash algorithm must be
one of 'sha256', 'sha384', 'sha512', or 'ed21159'.`;

export const BROWSER_NOTE =
  'Самая опасная строка таблицы — «выполнен без проверки». Атрибут с неизвестным алгоритмом, опечаткой в имени или мусором браузер **отбрасывает целиком**, как будто его нет, и грузит скрипт; в консоли остаётся только ошибка разбора. Спецификация так и требует: нет ни одного годного хеша — проверять не с чем, ресурс разрешён. Проверить, что защита стоит, можно только испортив хеш нарочно: скрипт обязан перестать грузиться.';

export const FETCH_SRI_CODE = `await fetch('http://cdn.test/lib.js', { integrity: 'sha384-<верный>' });
// ответ 200, текст скрипта

await fetch('http://cdn.test/lib.js', { integrity: 'sha384-<чужой>' });
// TypeError: Failed to fetch`;

export const SRI_LINKS_NOTE =
  'SRI работает на `<script>` и `<link rel="stylesheet">` и в `fetch`. Хеш в CSP — родственник: `script-src \'sha256-…\'` разрешает внешний скрипт, только если у тега есть `integrity` с этим хешем, — разобрано в [«CSP и Trusted Types», раздел «Nonce, хеш и \'strict-dynamic\'»](/platform/csp/#s2). В таблице заголовков-минимума SRI стоит одной строкой в [«Безопасности фронтенда», раздел «CSRF и кликджекинг»](/platform/security/#s5).';

// ─── Раздел 4. Сверка хеша: одна функция ──────────────────────────────────────────────────

/**
 * Учебная проверка SRI-строки. Печатается темой, исполняется демо (`widgets/supply-lab`)
 * и тестом: тест сверяет `integrityOf` с `ssri.fromData` и `node:crypto`, `checkIntegrity`
 * в режиме `npm` — с `ssri.checkData`, в режиме `browser` — с тем, что сделал Chromium.
 *
 * Чего учебная версия не знает: `md5`, `sha224` и `sha3-*`, которые `ssri` тоже принимает
 * (Web Crypto их не считает); подписи `ed25519` из черновика спецификации. На тестовом
 * наборе таких строк нет.
 */
export const SRI_CODE = String.raw`// Имена в SRI и в Web Crypto. В KNOWN порядок — от слабого к сильному.
const WEB_CRYPTO = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
const KNOWN = {
  browser: ['sha256', 'sha384', 'sha512'],          // спецификация SRI
  npm: ['sha1', 'sha256', 'sha384', 'sha512'],      // ssri: в старых lock-файлах есть sha1
};
// Как выглядит один хеш. Браузер пропускает запись, где хеш — не base64.
const TOKEN = {
  browser: /^([a-z0-9]+)-([A-Za-z0-9+/_-]+={0,2})(\?.*)?$/,
  npm: /^([a-z0-9]+)-([^?]+)(\?.*)?$/,
};

async function digest(alg, bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest(WEB_CRYPTO[alg], bytes));
  let bin = '';
  for (const b of hash) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Строка integrity: «алгоритм-хеш», несколько — через пробел.
async function integrityOf(bytes, algs = ['sha512']) {
  const parts = [];
  for (const alg of algs) parts.push(alg + '-' + (await digest(alg, bytes)));
  return parts.join(' ');
}

// Незнакомый алгоритм и мусор молча выпадают; «?опции» после хеша не читаются.
function parseIntegrity(text, mode) {
  const list = [];
  for (const token of text.split(/\s+/)) {
    const m = TOKEN[mode].exec(token);
    if (m && KNOWN[mode].includes(m[1])) list.push({ alg: m[1], digest: m[2] });
  }
  return list;
}

// Браузер принимает и base64url (- и _ вместо + и /), и запись без «=».
// ssri сравнивает строки как есть.
function same(a, b, mode) {
  if (mode === 'npm') return a === b;
  const norm = (d) => d.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  return norm(a) === norm(b);
}

async function checkIntegrity(bytes, text, mode) {
  const list = parseIntegrity(text, mode);
  if (list.length === 0) return { result: 'none', alg: null, wanted: [], got: null };
  // Сверяют только по сильнейшему алгоритму из строки. Остальные не смотрят вовсе.
  const rank = (alg) => KNOWN[mode].indexOf(alg);
  const alg = list.reduce((best, h) => (rank(h.alg) > rank(best) ? h.alg : best), list[0].alg);
  const wanted = list.filter((h) => h.alg === alg).map((h) => h.digest);
  const got = await digest(alg, bytes);
  const ok = wanted.some((w) => same(w, got, mode));   // хватит одного совпадения
  return { result: ok ? 'match' : 'mismatch', alg, wanted, got };
}

// Нет годных хешей: браузер грузит, как без атрибута; ssri считает проверку проваленной.
function verdict(check, mode) {
  if (check.result === 'match') return 'pass';
  if (check.result === 'none' && mode === 'browser') return 'pass';
  return 'fail';
}`;

export const SRI_RULES = [
  {
    k: 'Сильнейший алгоритм — единственный',
    d: 'Из `sha256-… sha512-…` браузер и `ssri` берут sha512 и сверяют только его. Слабый хеш в строке не страхует и не мешает: он просто не участвует.',
  },
  {
    k: 'Несколько хешей одного алгоритма — «или»',
    d: 'Так меняют файл без простоя: в атрибут кладут хеш старой и новой версии, выкатывают файл, потом старый хеш убирают.',
  },
  {
    k: 'Ни одного годного — разное поведение',
    d: 'Браузер грузит ресурс без проверки. `ssri.checkData` возвращает `false`. Одна и та же строка `sha1-…` для npm — работающая проверка, для браузера — пустое место.',
  },
];

export const LIB_JS = "window.greet = (name) => 'Hello, ' + name;\n";
export const LIB_JS_OLD = "window.greet = (name) => 'Hi, ' + name;\n";

/** Хеши `LIB_JS` и `LIB_JS_OLD`. Пересчитываются тестом. */
export const LIB_HASHES = {
  sha1: 'sha1-aINpxYPLA8Bdst565r8KcBbH2dM=',
  sha256: 'sha256-Wy1Zws/j9R/n/zc6By2bjhv7AjQbClvHH7fZS6j7w1E=',
  sha384: 'sha384-4WKtb76r41jxGI0yC4nTfhOLuVUJC8Na9K4gS00RcRTKa7n4nJdFLfJ9IuEm3+VM',
  sha512: 'sha512-qMvsgnY4L7ee/BwbC4wKOByiIAJWhdvsGV5tV+lWukJju0lCdTAE4LzTgn4WCkO0qqnqMW7jxnEnYjaj6TVF8w==',
  oldSha384: 'sha384-y6aGQ7dKvlflFKNXdmdlkOy/PNaV9cyGlovj+gC7j2oi80g22+wRm3nxcSsb5cpn',
};

export const ATTR_VARIANTS: AttrVariant[] = [
  {
    id: 'one',
    label: 'sha384',
    integrity: LIB_HASHES.sha384,
    note: 'Обычный случай: один хеш, сильный алгоритм.',
  },
  {
    id: 'two',
    label: 'sha256 + sha512',
    integrity: `${LIB_HASHES.sha256} ${LIB_HASHES.sha512}`,
    note: 'Два алгоритма. Сверяют только sha512 — посмотрите, какой хеш демо пересчитывает.',
  },
  {
    id: 'rotation',
    label: 'старый + новый',
    integrity: `${LIB_HASHES.oldSha384} ${LIB_HASHES.sha384}`,
    note: 'Ротация: хеш прошлой версии файла и текущей. Подходит любой.',
  },
  {
    id: 'sha1',
    label: 'sha1',
    integrity: LIB_HASHES.sha1,
    note: 'Браузер sha1 не знает и грузит что угодно; `ssri` сверяет. Испортите байт — ответы разойдутся.',
  },
  {
    id: 'upper',
    label: 'SHA384',
    integrity: LIB_HASHES.sha384.replace('sha384', 'SHA384'),
    note: 'Опечатка в регистре: для обоих это не хеш. Браузер грузит без проверки, `ssri` проверку проваливает.',
  },
];

export const DEMO: SupplyDemo = {
  tarball:
    'H4sIAAAAAAAC/+1Wy2rbQBTV2l9x0UY2NvKocWxw6nTRpBBKk0UDXbTFCOnakSuPpjOKk1ACTrLsR5T+gTFJMS6Of+Hqj8pIzoOkNJvE0FZnM3DOmXtnBs7MCNf75HaxGnAfD+2eMp4AjLF6rQa/41PUa2CsrNaZ49TrrAYGc1jj2SoYzFgC9lXsSoOxR9gkYwyux78E/cjfD9HGQxHJWEELitztYwla62DRt2RIExrTRXJaAQvKoLW1gpHjn4FY5D+Muk+U/gfzX2807uW/5jh5/peBahXoO03ToM+TU0jOkpPklEY0o0sa05QmTaBzuqQ5TZKT5CuNaaTvA9C2ZEiXNE3OgMZAP5KzZEgzGtFPoHkqXdBU17ILXsRVDB19v0j8vB9ILFo88rHZUVZpbSELN967Z9DkjQX5AFogZOShUjbywZVwsIcSb0negV8s2RJF6HpYRD6wt7a3dtsv321UwHruCrF+UzQMuJ6qTVz022HQQe/IC7GNA+QxlMEC78Bv6fsva1MuAFiwsflmp72783pzO5XSJjccvACLxjShc7qgmQVNsGimD0737SjbFQK5/yoI8e0R94p6m3YvCvjdtV6vxg6jrlWqZKstg/WB60qPlv/FaPdUxJec/5WGczf/zmqtked/GfhSADD1s242wexKxBilWdHkAKUKIq55x2Y2y9i+G6TU1X8xYztBiMpswvtbPJjZm2J+TC3Kk4GItUm3BDCFxICr2A1DXU+HHRYTKpnhz6qIVPyAQ6JwJd5VCwDHheP8E5MjR47/Hb8AcGB5fwAQAAA=',
  lockIntegrity: LOCK_INTEGRITY,
  libJs: LIB_JS,
  libUrl: 'http://cdn.test/lib.js',
  variants: ATTR_VARIANTS,
  npmIntegrityError: NPM_INTEGRITY_ERROR,
  npmZlibError: NPM_ZLIB_ERROR,
  chromiumBlocked: CHROMIUM_BLOCKED,
};

export const DEMO_CAPTION =
  'Нажмите на байт — у него поменяется младший бит. Хеши считает `checkIntegrity` выше, через Web Crypto вашего браузера; распаковку архива проверяет `DecompressionStream`. Тексты ошибок npm и Chromium — настоящие, в них подставлены посчитанные хеши.';

// ─── Раздел 5. Подменённое имя ────────────────────────────────────────────────────────────

export const NAME_ATTACKS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Тайпсквоттинг: имя с опечаткой',
    d: 'Злоумышленник публикует пакет, имя которого легко набрать по ошибке: `crossenv` вместо `cross-env` (2017, пакет копировал переменные окружения). Lock-файл и integrity тут ни при чём — вы честно поставили то, что попросили. Защита — смотреть, что добавляете: имя, автора, число загрузок, дату первой версии.',
    tone: 'warn',
  },
  {
    t: 'Захват аккаунта мейнтейнера',
    d: 'Украденный токен или фишинг — и новая версия настоящего пакета выходит с вредным кодом: ua-parser-js в 2021-м (скрипт установки), chalk и debug в сентябре 2025-го (код в самом модуле, без скриптов). Хеш у такой версии честный. Ловят её lock-файл (новая версия не попадает в дерево сама), порог возраста версии и отсутствие provenance там, где он был раньше.',
    tone: 'err',
  },
  {
    t: 'Передача пакета новому владельцу',
    d: 'event-stream, 2018: автор отдал заброшенный пакет добровольцу, тот добавил зависимость `flatmap-stream` с кодом, нацеленным на один кошелёк. Формально ничего не украдено — поэтому не помогает ни 2FA, ни подпись.',
    tone: 'err',
  },
  {
    t: 'Путаница зависимостей',
    d: 'Внутренний пакет без scope, и реестр, который смотрит и во внутренний, и в публичный. В публичном кто-то публикует то же имя с большей версией — и менеджер честно выбирает её. Как это происходит — в подразделе «Путаница зависимостей».',
    tone: 'err',
  },
];

export const PLAIN_CONFUSION =
  'Как курьер, которому сказали «принеси папку „Отчёт“ — самую свежую». Одна такая папка лежит в вашем шкафу, другую кто-то положил на общий стол и подписал датой поновее. Курьер приносит ту, что свежее, и не спрашивает, откуда она. Scope с привязкой к реестру — это «папку „Отчёт“ бери только из шкафа».';

export const CONFUSION_ROWS: { k: string; rc: string; got: string; asked: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`acme-utils@^1.2.0`',
    rc: '`registry=` внутренний',
    got: '1.2.0 — внутренняя',
    asked: 'только внутренний',
    tone: 'ok',
  },
  {
    k: '`acme-utils@^1.2.0`',
    rc: '`registry=` публичный (забыли `.npmrc`)',
    got: '**1.99.0 — чужая**',
    asked: 'только публичный',
    tone: 'err',
  },
  {
    k: '`acme-utils@^1.2.0`',
    rc: '`registry=` прокси, сливающий оба',
    got: '**1.99.0 — чужая**',
    asked: 'прокси спросил оба, отдал старшую',
    tone: 'err',
  },
  {
    k: '`acme-utils@1.2.0` (точно)',
    rc: 'прокси, сливающий оба',
    got: '1.2.0 — внутренняя',
    asked: 'прокси спросил оба',
    tone: 'warn',
  },
  {
    k: '`@acme/utils@^1.2.0`',
    rc: 'прокси + `@acme:registry=` внутренний',
    got: '1.2.0 — внутренняя',
    asked: 'только внутренний: прокси не спрошен вовсе',
    tone: 'ok',
  },
  {
    k: '`@acme/utils@^1.2.0`',
    rc: 'прокси, строки для scope нет',
    got: '**1.99.0 — чужая**',
    asked: 'прокси спросил оба',
    tone: 'err',
  },
  {
    k: 'lock-файл с внутренней 1.2.0, `npm ci`',
    rc: '`registry=` переключили на прокси',
    got: '1.2.0 — внутренняя',
    asked: 'документы не запрашивались: тарбол по адресу из `resolved`',
    tone: 'ok',
  },
];

export const NPMRC_CODE = `# .npmrc проекта
registry=https://registry.npmjs.org/
@acme:registry=https://npm.acme.internal/
//npm.acme.internal/:_authToken=\${NPM_ACME_TOKEN}`;

export const CONFUSION_NOTE =
  'Рабочая защита — три вещи вместе. Все внутренние пакеты — под своим scope, и scope **зарегистрирован** на вас в публичном реестре, даже если вы там ничего не публикуете: тогда чужой `@acme/…` там просто не появится. Строка `@acme:registry=` в `.npmrc` проекта, а не только на машине одного разработчика. Lock-файл в репозитории: `npm ci` берёт тарбол по записанному адресу и сверяет хеш. Токен — подстановкой из переменной окружения, как в примере, а не строкой в файле: `.npmrc` проекта лежит в репозитории. В тарбол npm его сам не кладёт — а вот `.env` рядом кладёт ([«Публикация npm-пакета», раздел «Что уедет в тарбол»](/tooling/package-publishing/#s5)).';

// ─── Раздел 6. Provenance ─────────────────────────────────────────────────────────────────

export const PLAIN_PROVENANCE =
  'Как сертификат происхождения у товара: «изготовлено на фабрике такой-то, партия такая-то, смена такая-то», заверенный печатью, которую нельзя подделать, и записанный в общий реестр сертификатов. Сертификат не говорит, что товар хороший. Он говорит, где и как его сделали, — и что сделали не в гараже по соседству.';

export const PROVENANCE_CODE = `# .github/workflows/publish.yml — фрагмент
permissions:
  contents: read
  id-token: write          # конвейер может получить OIDC-токен

steps:
  - run: npm ci
  - run: npm publish --provenance --access public`;

export const PROVENANCE_STEPS: { k: string; d: string }[] = [
  {
    k: '1. Кто публикует',
    d: 'Конвейер получает от GitHub короткоживущий OIDC-токен: «это репозиторий `acme/greeter`, workflow `publish.yml`, коммит `9f3c…`». Ключа, который можно украсть и унести, нет.',
  },
  {
    k: '2. Сертификат',
    d: 'Sigstore (удостоверяющий центр Fulcio) выдаёт по этому токену сертификат на несколько минут. Им подписывается запись о сборке: хеш тарбола, репозиторий, коммит, workflow.',
  },
  {
    k: '3. Публичный журнал',
    d: 'Факт подписи записывается в журнал прозрачности Rekor — только дописывать, ничего не стирать. Подделать запись задним числом нельзя, и видно каждую выданную подпись.',
  },
  {
    k: '4. Проверка',
    d: '`npm audit signatures` проверяет подписи реестра на всех пакетах дерева и аттестации provenance там, где они есть, и печатает, сколько пакетов прошло проверку.',
  },
];

/** Прогон `npm audit signatures` на стенде — против учебного реестра. */
export const AUDIT_SIGNATURES_RUN = `$ npm audit signatures          # реестр — учебный, 127.0.0.1:4981
npm warn Fetching verification keys using TUF failed.  Fetching directly from http://127.0.0.1:4981/.
npm error found no dependencies to audit that were installed from a supported registry

# журнал реестра:
GET /-/npm/v1/keys
GET /greeter`;

export const PROVENANCE_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Что доказывает',
    d: 'Тарбол собран из **этого** репозитория **этим** конвейером из **этого** коммита. Версию, опубликованную с ноутбука украденным токеном, выдаст отсутствие provenance там, где у прошлых версий он был.',
    tone: 'ok',
  },
  {
    t: 'Чего не доказывает',
    d: 'Что код безопасен. Вредный коммит в репозиторий, захваченный конвейер или чужое действие в нём дают **честный** provenance на вредный пакет. Действия в workflow поэтому закрепляют по хешу коммита — [«GitHub Actions», раздел «Права и секреты»](/delivery/github-actions/#s7).',
    tone: 'warn',
  },
  {
    t: 'Trusted publishing',
    d: 'Следующий шаг: реестр вообще не выдаёт долгоживущий токен публикации. Пакет на npmjs привязывается к репозиторию и workflow, и публиковать может только он, по OIDC; provenance при этом пишется сам. Украсть нечего.',
    tone: 'ok',
  },
  {
    t: 'Без сети — не проверить',
    d: 'Ключи реестра и корень доверия Sigstore npm получает по сети (TUF — протокол безопасной раздачи ключей). С учебным реестром вместо npmjs `npm audit signatures` не нашёл ни одного пакета «из поддерживаемого реестра» — проверка работает только против реестра, который подписывает.',
  },
];

export const PROVENANCE_NOTE =
  'Тот же механизм — Sigstore, OIDC вместо ключа, публичный журнал — подписывает образы контейнеров; там же разобрано, что подпись ничего не запрещает, пока неподписанное не отказываются запускать: [«Docker: образ и слои», раздел «Что такое образ на самом деле»](/delivery/docker/#s1).';

// ─── Раздел 7. Аудит, возраст версии, SBOM ────────────────────────────────────────────────

export const AUDIT_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`npm audit` знает только известное',
    d: 'Он отправляет реестру список имён и версий дерева и печатает ответ базы уязвимостей. Код он не читает: свежий захват, о котором ещё не сообщили, для него чист. Как выглядит этот запрос — в [«Пакетных менеджерах»](/tooling/package-managers/#s6).',
    tone: 'warn',
  },
  {
    t: 'Шум',
    d: 'Уязвимость в пакете, который стоит только для сборки и никогда не получает чужих данных (регулярное выражение в парсере конфигов, «опасное» на вводе, которого у вас нет), отчёт покажет как `high`. Сотня таких строк приучает не читать отчёт — и настоящая тонет. Разумный минимум: `npm audit --omit=dev` для того, что уезжает в продакшен, и `--audit-level=high` в CI.',
    tone: 'warn',
  },
  {
    t: '`npm audit fix --force` — не лекарство',
    d: 'Ради закрытия уязвимости он поднимает мажорную версию, и сборка ломается в другом месте. Правка за пределами диапазонов — решение человека: `overrides` с конкретной версией и проверкой.',
  },
];

export const BEFORE_CODE = `# реестр: greeter 1.0.0 (10 января), greeter 1.1.0 (1 октября)
$ npm install greeter@^1.0.0
→ greeter 1.1.0

$ npm install greeter@^1.0.0 --before=2026-09-25
→ greeter 1.0.0      # версий моложе даты для npm нет`;

export const AGE_NOTE =
  '`--before` — разовый срез «как было на дату». Постоянный порог — `minimumReleaseAge` у pnpm (в pnpm 11 сутки по умолчанию) и `npmMinimalAgeGate` у Yarn 4: свежая версия для выбора не существует, пока ей не исполнится порог. Захваченные версии обычно снимают за часы, и порог отдаёт эти часы тем, кто их ловит. Сравнение трёх менеджеров на одном реестре — в [«Пакетных менеджерах», раздел «Скрипты установки и цепочка поставок»](/tooling/package-managers/#s6).';

/** Фрагмент `npm sbom --sbom-format cyclonedx` на стенде. Пересобирается тестом. */
export const SBOM_CODE = `$ npm sbom --sbom-format cyclonedx
{
  "bomFormat": "CycloneDX",
  "specVersion": "1.5",
  "components": [{
    "name": "greeter",
    "version": "1.1.0",
    "purl": "pkg:npm/greeter@1.1.0",
    "externalReferences": [{ "type": "distribution",
                             "url": "http://127.0.0.1:4981/greeter/-/greeter-1.1.0.tgz" }],
    "hashes": [{ "alg": "SHA-512", "content": "3e3ea0914dd23a88ab9158766b9abeafe40358e2b2664ba8e254f7571b508e6e406d2570f70bc6c89ce571e71367817f9f290c5a6e47fcade830457c9eb390da" }]
  }],
  …
}`;

export const SBOM_NOTE =
  '`hashes.content` — тот же `integrity` из lock-файла, записанный в шестнадцатеричной форме вместо base64. `npm sbom` не скачивает и не анализирует ничего: он перекладывает lock-файл и `node_modules` в стандартный формат (CycloneDX 1.5 или SPDX 2.3), чтобы опись можно было отдать сканеру или заказчику. Опись образа контейнера целиком — с системными пакетами — собирает BuildKit, это в [«Docker: образ и слои»](/delivery/docker/#s1).';

export const DEFENCE_ROWS: { k: string; how: string; stops: string }[] = [
  { k: 'lock-файл в репозитории, `npm ci`', how: 'одна строка в CI', stops: 'подмену уже записанной версии, самовольное обновление по `^`' },
  { k: 'скрипты установки под одобрение', how: '`ignore-scripts=true` или pnpm по умолчанию', stops: 'кражу секретов в момент установки' },
  { k: 'порог возраста версии', how: '`minimumReleaseAge`, `npmMinimalAgeGate`', stops: 'свежую версию с захваченного аккаунта, пока её не сняли' },
  { k: 'scope + `@scope:registry=`', how: '`.npmrc` проекта', stops: 'путаницу зависимостей' },
  { k: 'provenance и trusted publishing', how: 'на своих пакетах — флаг и OIDC; на чужих — смотреть', stops: 'публикацию в обход конвейера' },
  { k: 'SRI на сторонних скриптах', how: '`integrity` + `crossorigin`', stops: 'подмену файла на CDN' },
  { k: '`npm audit`, SBOM', how: 'в CI и при релизе', stops: 'ничего не предотвращает — показывает, где стоит то, о чём уже известно' },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Опечатка в `integrity` выключает защиту молча',
    d: '`SHA384-…`, `sha1-…`, лишний символ — и Chromium выполняет скрипт без проверки, оставив в консоли только ошибку разбора. Защиту проверяют порчей: поменяйте символ хеша — скрипт обязан перестать грузиться.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`integrity` без `crossorigin` блокирует собственный скрипт',
    d: 'Ответ без CORS непрозрачен: браузер не может прочитать байты и не грузит ресурс, хотя хеш верный. Нужны оба: `crossorigin="anonymous"` у тега и `Access-Control-Allow-Origin` у CDN.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Слабый хеш в строке не страхует',
    d: 'В `sha256-… sha512-…` сверяют только sha512. Неверный sha256 рядом с верным sha512 ничего не ломает, верный sha256 рядом с неверным sha512 ничего не спасает.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Lock-файл не отключает скрипты установки',
    d: '`npm ci` по lock-файлу запустил `preinstall`, `install` и `postinstall` так же, как первая установка. Lock-файл решает, **что** ставить, а не **что исполнять**.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Integrity при первой установке — со слов реестра',
    d: 'Без lock-файла npm сверяет архив с хешем, который назвал сам реестр. Подменили оба — установка проходит. Первая запись lock-файла — момент доверия; дальше она уже защищает.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Битый архив не всегда даёт `EINTEGRITY`',
    d: 'Байт в сжатых данных ломает gzip раньше, чем досчитан хеш, — npm падает `Z_DATA_ERROR` «zlib: incorrect data check». Это та же защита, просто сработала другая проверка; искать «сетевую проблему» не нужно.',
  },
  {
    n: '07',
    t: 'Точная версия не спасает от путаницы зависимостей',
    d: 'С `"acme-utils": "1.2.0"` сливающий прокси вернул внутреннюю версию — но лишь потому, что у чужой другой номер. Опубликуют чужую `1.2.0` в реестр, который прокси спрашивает первым, — и точная версия приведёт её. Защита — scope и строка `@scope:registry=`, а не номер.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Provenance — не знак качества',
    d: 'Он доказывает происхождение, а не безопасность. Вредный коммит, прошедший ревью, или захваченное действие в конвейере дают пакет с честным provenance.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Subresource Integrity',
    href: 'https://www.w3.org/TR/SRI/',
    what: 'формат `integrity`, выбор сильнейшего алгоритма, «нет годных хешей — ресурс разрешён», требование CORS',
  },
  {
    title: 'MDN — Subresource Integrity',
    href: 'https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity',
    what: '`integrity` и `crossorigin` на `<script>` и `<link>`, как посчитать хеш',
  },
  {
    title: '`ssri` — исходники и README',
    href: 'https://github.com/npm/ssri',
    what: 'разбор и проверка integrity в npm: порядок алгоритмов, `checkData`, `EINTEGRITY`; версия 13.0.1',
  },
  {
    title: 'npm Docs — scripts',
    href: 'https://docs.npmjs.com/cli/v11/using-npm/scripts',
    what: 'скрипты жизненного цикла, `INIT_CWD`, когда запускается `prepare`',
  },
  {
    title: 'npm Docs — package-lock.json и npm ci',
    href: 'https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json',
    what: '`resolved`, `integrity`, `hasInstallScript`',
  },
  {
    title: 'npm Docs — scope',
    href: 'https://docs.npmjs.com/cli/v11/using-npm/scope',
    what: 'привязка scope к реестру в `.npmrc`',
  },
  {
    title: 'npm Docs — Generating provenance statements',
    href: 'https://docs.npmjs.com/generating-provenance-statements',
    what: '`npm publish --provenance`, `id-token: write`, что попадает в аттестацию',
  },
  {
    title: 'npm Docs — Trusted publishing',
    href: 'https://docs.npmjs.com/trusted-publishers',
    what: 'публикация по OIDC без долгоживущего токена',
  },
  {
    title: 'npm Docs — Verifying registry signatures',
    href: 'https://docs.npmjs.com/verifying-registry-signatures',
    what: '`npm audit signatures`: подписи реестра и аттестации',
  },
  {
    title: 'npm Docs — npm sbom',
    href: 'https://docs.npmjs.com/cli/v11/commands/npm-sbom',
    what: 'форматы CycloneDX и SPDX',
  },
  {
    title: 'pnpm — Settings',
    href: 'https://pnpm.io/settings',
    what: '`allowBuilds`, `onlyBuiltDependencies`, `strictDepBuilds`, `minimumReleaseAge`',
  },
  {
    title: 'Sigstore — документация',
    href: 'https://docs.sigstore.dev/',
    what: 'Fulcio, Rekor, подпись без ключей по OIDC',
  },
  {
    title: 'SLSA — Provenance',
    href: 'https://slsa.dev/spec/v1.0/provenance',
    what: 'формат записи о сборке, на котором стоит provenance npm',
  },
  {
    title: 'Alex Birsan — Dependency Confusion',
    href: 'https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610',
    what: 'исходный разбор атаки 2021 года',
  },
  {
    title: 'Dan Abramov — npm audit: Broken by Design',
    href: 'https://overreacted.io/npm-audit-broken-by-design/',
    what: 'почему отчёт `npm audit` шумит на зависимостях сборки',
  },
];

export const RELATED =
  'Смежное на сайте: [Пакетные менеджеры, раздел «Скрипты установки и цепочка поставок»](/tooling/package-managers/#s6) — одна история захвата и четыре рубежа на трёх менеджерах. [Публикация npm-пакета](/tooling/package-publishing/) — что уезжает в тарбол. [GitHub Actions, раздел «Права и секреты»](/delivery/github-actions/#s7) — `id-token: write` и закрепление действий по хешу. [Docker: образ и слои](/delivery/docker/#s1) — SBOM, provenance и подпись образа. [CSP и Trusted Types](/platform/csp/#s2) — хеш в политике и `integrity`. [Секреты и конфигурация](/delivery/secrets-config/) — где держать токены, которые может прочитать скрипт установки.';
