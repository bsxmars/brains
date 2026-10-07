import type { Pitfall } from '@/widgets/pitfalls/model/types';
import { compileSemver } from '@/widgets/pm-lab/model/semver';
import type { Registry } from '@/widgets/pm-lab/model/layout';

/**
 * Данные темы «Пакетные менеджеры: node_modules, lock-файлы и pnpm».
 *
 * Тема написана здесь. До неё предмет висел строкой «Отдельная тема — готовится» в «за кадром»
 * у «Модулей и сборки». Там же разобрано, как загрузчик ищет пакет вверх по `node_modules` и
 * откуда берутся фантомные зависимости, — здесь это не пересказывается: тема смотрит на то же
 * со стороны менеджера — **кто и почему раскладывает файлы именно так**. Подпись образа, SBOM
 * и provenance — в «Docker: образ и слои», ключ кеша от lock-файла — в «GitHub Actions».
 *
 * ── Стенд (сентябрь 2026, без сети) ─────────────────────────────────────────────────────
 * Node 26.8.2, npm 11.19.1, pnpm 11.0.9 и Yarn 4.18.0 (оба — из кеша corepack,
 * `COREPACK_ENABLE_NETWORK=0`). Пакеты собраны `npm pack` из учебных исходников: `c` в семи
 * версиях (1.0.0, 1.2.0, 1.3.0, 1.4.0-beta.1, 1.5.0, 2.0.0, 2.1.0), `a`, `z` → `c@^1.0.0`,
 * `b` → `c@^1.2.0`, `d`, `e` → `c@^2.0.0`, `host` 1.0.0/1.5.0/2.0.0, `plug` с peer
 * `host@^1.0.0`, `scripty` с `postinstall`, `sneaky`, который делает `require('c')`,
 * не объявив его. Реестр — сорок строк на `node:http` на 127.0.0.1: отдаёт документ пакета
 * (packument) и тарболы, пишет журнал запросов. У всех версий дата публикации 2020 год, кроме
 * `c@1.5.0` — «только что»: на нём видны пороги возраста у pnpm и Yarn.
 *
 * Все три менеджера ходили только в этот реестр и в свой кеш в песочнице. Один раз `npm dedupe`
 * был запущен без своего конфига и спросил настоящий реестр о пакете `c` — ответ не
 * использован нигде.
 *
 * ── Что проверено чем ────────────────────────────────────────────────────────────────────
 *   — `SEMVER_CODE` сверен с пакетом `semver` 7.8.5 (его ставит сам Astro): 3219 сравнений,
 *     развёртка диапазона — строка в строку с `semver.validRange`. Закреплено тестом.
 *   — `TREE_RUNS` — раскладки, снятые npm и pnpm на семи сценариях; правило раскладки
 *     из `widgets/pm-lab/model/layout.ts` обязано повторить их строка в строку. Закреплено тестом.
 *   — `LOCK_CODE` — `package-lock.json` сценария «две копии»; integrity тарбола тест
 *     считает сам — `INTEGRITY_CODE` — и сверяет с lock-файлом и с `npm pack --json`.
 *   — Остальные таблицы (`CI_ROWS`, `PEER_ROWS`, `OVERRIDE_ROWS`, `SCRIPT_ROWS`, `AGE_ROWS`,
 *     `WORKSPACE_ROWS`, `STORE_FACTS`) — снятые прогоны, **сторожем не закреплены**: для них
 *     нужен живой реестр и три менеджера, в unit-тест это не помещается.
 *
 * ── Что по документации, без запуска ────────────────────────────────────────────────────
 * Provenance и `npm audit signatures`, база уязвимостей `npm audit` (ответ реестра подставлен
 * руками), `resolutions` в Yarn, Yarn Classic, lockfileVersion 1 и 2 (npm 11 пишет только 3).
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const GLOSSARY = [
  {
    k: 'реестр и тарбол',
    d: 'Реестр (registry) — сервер с пакетами, по умолчанию `registry.npmjs.org`. На каждое имя он отдаёт документ со списком всех версий и их зависимостей, а сами версии лежат архивами `.tgz` — тарболами.',
  },
  {
    k: 'semver',
    d: 'Semantic Versioning: версия — три числа `MAJOR.MINOR.PATCH`. Ломающее изменение повышает первое, новая возможность — второе, исправление — третье. Это договорённость авторов, а не проверка: менеджер верит номеру на слово.',
  },
  {
    k: 'диапазон',
    d: 'То, что пишут в `dependencies`: не версия, а условие на неё — `^1.2.0`, `~1.2.0`, `1.x`. Менеджер выбирает **старшую** опубликованную версию, которая условию удовлетворяет.',
  },
  {
    k: 'подъём (hoisting)',
    d: 'Перенос зависимости из `node_modules` пакета, которому она нужна, в `node_modules` на уровень выше — в идеале в корень проекта. Так её могут взять несколько пакетов сразу, и копия на диске одна.',
  },
  {
    k: 'lock-файл',
    d: '`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock` — запись того, какая **конкретная** версия выбрана для каждого диапазона, откуда скачана и какой у архива хеш. `package.json` говорит «что подойдёт», lock-файл — «что стоит».',
  },
  {
    k: 'integrity',
    d: 'Хеш содержимого архива в формате Subresource Integrity: `sha512-` и хеш в base64. Менеджер сверяет его с тем, что скачал, и при расхождении отказывается ставить.',
  },
  {
    k: 'peer-зависимость',
    d: '`peerDependencies` — «мне нужен этот пакет, но ставьте его **вы**, одной копией на всех». Так объявляют себя плагины: плагину ESLint нужен тот же `eslint`, которым пользуется проект, а не свой.',
  },
  {
    k: 'симлинк и жёсткая ссылка',
    d: 'Симлинк — файл-указатель «смотри вон туда», у него свой путь. Жёсткая ссылка — второе имя **того же** файла на диске: данные одни, путей два, и правка по любому пути видна по обоим.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE =
  'Как менеджер выбирает версии и раскладывает файлы, тема объясняет с нуля. Известными считаются две вещи — у каждой есть разбор на сайте.';

export const PREREQ = [
  {
    t: 'Как Node находит пакет по имени',
    d: '`require(\'c\')` ищет папку `c` в `node_modules` рядом с файлом, потом папкой выше — и так до корня диска; `dependencies` из `package.json` загрузчик не читает вовсе. Поэтому раскладка на диске и решает, какую версию получит код.',
    href: '/tooling/modules/#s3',
    hrefLabel: '«Модули и сборка», раздел «CommonJS против ESM и цена их стыковки», подраздел «Поиск вверх по `node_modules` и фантомные зависимости»',
    tone: 'info' as const,
  },
  {
    t: 'Адресация по содержимому',
    d: 'Объект хранится под хешем своих байтов: одинаковое содержимое — одно имя и одна копия, любая подмена — другое имя. На этом стоят integrity в lock-файле, кеш npm и хранилище pnpm.',
    href: '/delivery/docker/#s1',
    hrefLabel: '«Docker: образ и слои», раздел «Что такое образ на самом деле»',
    tone: 'ok' as const,
  },
];

/* ──────────────────── На пальцах ──────────────────── */

export const PLAIN_MANAGER =
  'Как снабженец на стройке. Бригады пишут заявки: «цемент марки не ниже 400», «доска сороковка». Снабженец идёт на склад, выбирает, что подходит под все заявки сразу, раскладывает по бытовкам — и записывает в журнал, **какую партию** привёз, чтобы завтра привезти ту же. Заявка — `package.json`, склад — реестр, бытовки — `node_modules`, журнал — lock-файл.';

export const PLAIN_RANGE =
  'Диапазон — как заказ «молоко, жирность от 2.5 до 3.2». Магазин принесёт самое свежее из подходящего, и завтра это может быть другая пачка. Каретка `^` значит «того же производителя», тильда `~` — «того же производителя и той же линейки». Пререлиз — пробная партия: её приносят, только если вы назвали её в заказе поимённо.';

export const PLAIN_HOIST =
  'Общая полка в коридоре. Если двум квартирам нужна одна и та же дрель, её вешают в коридор — одна на всех. Если одной нужна дрель на 12 вольт, а другой на 18, в коридоре висит та, что пришла первой, а вторая остаётся в квартире. Кто первый — решает порядок обхода, а не то, какая дрель нужнее.';

export const PLAIN_LOCK =
  'Рецепт говорит «муки 500 г» (`package.json`), а журнал пекарни — «мука из мешка №4817, вот его пломба» (lock-файл). По рецепту каждый день выходит немного разный хлеб. По журналу — тот же самый, а если пломба не совпала, мешок не вскрывают вовсе.';

export const PLAIN_PEER =
  'Насадка для пылесоса. Её не продают вместе с пылесосом — она требует тот, что **уже стоит** у вас дома, и подходит только к определённым моделям. Если у вас пылесос другой модели, магазин (npm) откажется продавать насадку, а мастер (pnpm) продаст и предупредит.';

export const PLAIN_STORE =
  'Библиотека вместо личных книжных шкафов. Книга хранится в одном экземпляре на полке, подписанной её содержимым, а в каждой квартире — карточка «см. полку такую-то». Сто проектов с одним и тем же пакетом — одна копия на диске.';

/* ──────────────────── Раздел 1 · semver и диапазоны ──────────────────── */

/**
 * Учебная проверка диапазона. Её печатает тема, её же компилирует калькулятор
 * (`widgets/pm-lab`), её же — правило раскладки дерева, и её же тест сверяет с пакетом
 * `semver` 7.8.5: развёртка — строка в строку с `semver.validRange`, ответы `satisfies`
 * и `compare` — на сетке версий и диапазонов.
 *
 * ⚠️ `String.raw`: в регулярных выражениях стоят `\d` и `\.`, а обычный шаблонный литерал
 * съел бы обратные косые. Поэтому в коде нет ни обратных кавычек, ни подстановок.
 *
 * Чего учебная версия сознательно не разбирает: диапазоны через дефис (`1.2.3 - 2.3.4`)
 * и неполные сравнения (`>1.2`) — бросает ошибку, а не отвечает неверно.
 */
export const SEMVER_CODE = String.raw`// Версия — три числа и, может быть, пререлиз. Метка сборки после «+» не сравнивается.
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (!m) throw new Error('не версия: ' + v);
  return {
    nums: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
  };
}

// Пререлиз младше релиза: 1.0.0-beta < 1.0.0. Числовая метка младше буквенной.
function compare(a, b) {
  const x = typeof a === 'string' ? parse(a) : a;
  const y = typeof b === 'string' ? parse(b) : b;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    if (typeof p !== typeof q) return typeof p === 'number' ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const X = /^[xX*]$/;
const show = (n, pre) => n.join('.') + (pre ? '-' + pre : '');
// Нижняя граница «>=0.0.0» ничего не отсекает: node-semver её не пишет, не пишем и мы.
const pair = (low, high) => (low === '>=0.0.0' ? [high] : [low, high]);

// Одно слово диапазона → список сравнений. ^, ~ и x-диапазоны — сокращения: каждое
// разворачивается в пару «от» и «до», а верхняя граница пишется с «-0», чтобы
// пререлизы следующей версии в неё не попадали.
function desugarWord(word) {
  if (word === '' || X.test(word)) return [];
  const m = /^(\^|~|>=|<=|>|<|=)?v?([0-9xX*]+)(?:\.([0-9xX*]+))?(?:\.([0-9xX*]+))?(?:-([0-9A-Za-z.-]+))?$/.exec(word);
  if (!m) throw new Error('не разбирается: ' + word);
  const op = m[1] ?? '';
  const pre = m[5];
  const known = [];
  for (const p of [m[2], m[3], m[4]]) {
    if (p === undefined || X.test(p)) break;
    known.push(Number(p));
  }
  const [M, m1, p1] = [known[0] ?? 0, known[1] ?? 0, known[2] ?? 0];
  const full = known.length === 3;
  const low = '>=' + show([M, m1, p1], full ? pre : '');

  if (op === '^') {
    if (known.length === 0) return [];
    if (M > 0 || known.length === 1) return pair(low, '<' + (M + 1) + '.0.0-0');
    if (m1 > 0 || known.length === 2) return pair(low, '<0.' + (m1 + 1) + '.0-0');
    return pair(low, '<0.0.' + (p1 + 1) + '-0');
  }
  if (op === '~') {
    if (known.length === 0) return [];
    return pair(low, known.length === 1 ? '<' + (M + 1) + '.0.0-0' : '<' + M + '.' + (m1 + 1) + '.0-0');
  }
  if (!full) {
    if (op !== '' && op !== '=') throw new Error('учебная версия не разбирает неполное сравнение: ' + word);
    if (known.length === 0) return [];
    return known.length === 1
      ? pair(low, '<' + (M + 1) + '.0.0-0')
      : pair(low, '<' + M + '.' + (m1 + 1) + '.0-0');
  }
  const one = (op === '=' ? '' : op) + show([M, m1, p1], pre);
  return one === '>=0.0.0' ? [] : [one];
}

// Диапазон — наборы через «||», внутри набора сравнения через пробел, и выполниться
// должны все. Пустой набор пускает любую версию.
function desugar(range) {
  return range.split('||').map((set) => set.trim().split(/\s+/).filter(Boolean).flatMap(desugarWord));
}

function check(version, cmp) {
  const [, op, ver] = /^(>=|<=|>|<)?(.+)$/.exec(cmp);
  const c = compare(version, ver);
  return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0;
}

function satisfies(version, range) {
  const v = parse(version);
  return desugar(range).some((set) => {
    if (!set.every((cmp) => check(v, cmp))) return false;
    if (!v.pre.length) return true;
    // Пререлиз проходит, только если в наборе есть сравнение с пререлизом той же
    // тройки чисел: ^1.2.3-beta.1 пускает 1.2.3-beta.4, но не 1.3.0-beta.1.
    return set.some((cmp) => {
      const w = parse(cmp.replace(/^[<>=]+/, ''));
      return w.pre.length > 0 && w.nums.join('.') === v.nums.join('.');
    });
  });
}

function maxSatisfying(versions, range) {
  return versions.filter((v) => satisfies(v, range)).sort(compare).at(-1) ?? null;
}`;

const SEMVER = compileSemver(SEMVER_CODE);

/**
 * Таблица диапазонов **вычисляется** той же строкой, а не набирается: развёртка и вердикты
 * по пробным версиям считаются здесь, при сборке. Тест сверяет развёртку с `semver.validRange`.
 */
const RANGE_SPECS: { range: string; probes: string[]; note: string }[] = [
  { range: '^1.2.3', probes: ['1.2.3', '1.9.0', '2.0.0', '1.2.2'], note: 'Всё до следующего мажора. Так пишет `npm install` по умолчанию.' },
  { range: '~1.2.3', probes: ['1.2.9', '1.3.0'], note: 'Только исправления той же минорной линии.' },
  { range: '1.2.x', probes: ['1.2.0', '1.2.9', '1.3.0'], note: 'То же, что `~1.2.0`: x — «любое число здесь».' },
  { range: '^0.2.3', probes: ['0.2.9', '0.3.0'], note: '**До 1.0.0 каретка сдвигается вправо**: ломающим считается минор.' },
  { range: '^0.0.3', probes: ['0.0.3', '0.0.4'], note: 'А при нулевом миноре — патч: пропускается ровно одна версия.' },
  { range: '^1.2.3-beta.2', probes: ['1.2.3-beta.4', '1.2.3', '1.3.0-beta.1'], note: 'Пререлиз пускается только той же тройки чисел, что названа в диапазоне.' },
  { range: '*', probes: ['2.1.0', '2.2.0-rc.1'], note: 'Любая версия — кроме пререлизов.' },
  { range: '>=1.0.0 <1.5.0 || ^2.0.0', probes: ['1.4.9', '1.5.0', '2.1.0'], note: 'Пробел — «и», `||` — «или».' },
];

export const RANGE_ROWS = RANGE_SPECS.map((spec) => {
  const sets = SEMVER.desugar(spec.range).map((set) => (set.length ? set.join(' ') : 'любая'));
  const verdicts = spec.probes.map((v) => (SEMVER.satisfies(v, spec.range) ? `\`${v}\` да` : `\`${v}\` нет`));
  return {
    range: spec.range,
    desugared: sets.join(' || '),
    verdicts: verdicts.join(' · '),
    note: spec.note,
  };
});

export const ZERO_NOTE =
  '**`0.x` — не «нестабильная, но совместимая» версия, а отдельная договорённость.** Пока мажор равен нулю, semver разрешает ломать что угодно, и каретка это учитывает: `^0.2.3` не пустит `0.3.0`, а `^0.0.3` не пустит даже `0.0.4`. Пакет, который годами живёт в `0.x`, обновляется у вас только руками — ни `npm update`, ни новая установка минорную версию не поднимут.';

export const PRERELEASE_NOTE =
  '**Пререлиз не попадает в диапазон случайно.** Верхняя граница развёртки `<2.0.0-0` кончается на `-0` — самой младшей из возможных меток, — чтобы `2.0.0-rc.1` не проскочил в `^1.2.3`. А версия `1.3.0-beta.1` хоть и лежит между `1.2.3` и `2.0.0` по порядку, отсекается отдельным правилом: пререлиз пускается, только если в том же наборе есть сравнение с пререлизом **той же тройки чисел**. Бету надо назвать поимённо.';

/** Наборы для калькулятора: версии `c` из учебного реестра и диапазоны из сценариев темы. */
export const RANGE_PRESETS: { label: string; range: string }[] = [
  { label: '`^1.0.0` — у пакетов `a` и `z`', range: '^1.0.0' },
  { label: '`^1.2.0` — у `b`', range: '^1.2.0' },
  { label: '`^2.0.0` — у `d` и `e`', range: '^2.0.0' },
  { label: '`~1.2.0`', range: '~1.2.0' },
  { label: '`^1.4.0-beta.0`', range: '^1.4.0-beta.0' },
  { label: '`1.x || >=2.1.0`', range: '1.x || >=2.1.0' },
];

export const RANGE_VERSIONS = ['1.0.0', '1.2.0', '1.3.0', '1.4.0-beta.1', '1.5.0', '2.0.0', '2.1.0'];

/* ──────────────────── Раздел 2 · разрешение и подъём ──────────────────── */

/** Учебный реестр — ровно тот, что стоял на стенде (см. шапку). */
export const REGISTRY: Registry = {
  a: { '1.0.0': { deps: { c: '^1.0.0' } } },
  b: { '1.0.0': { deps: { c: '^1.2.0' } } },
  c: Object.fromEntries(RANGE_VERSIONS.map((v) => [v, {}])),
  d: { '1.0.0': { deps: { c: '^2.0.0' } } },
  e: { '1.0.0': { deps: { c: '^2.0.0' } } },
  host: { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
  plug: { '1.0.0': { peers: { host: '^1.0.0' } } },
  z: { '1.0.0': { deps: { c: '^1.0.0' } } },
};

export interface Scenario {
  id: string;
  label: string;
  deps: Record<string, string>;
  note: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'compat',
    label: 'общая зависимость совместима',
    deps: { a: '^1.0.0', b: '^1.0.0' },
    note: '`a` хочет `c@^1.0.0`, `b` — `c@^1.2.0`. Старшая подходящая `1.5.0` устраивает обоих: одна копия. И в npm она лежит наверху — приложение может сделать `require(\'c\')`, ни разу его не объявив.',
  },
  {
    id: 'clash',
    label: 'несовместима',
    deps: { a: '^1.0.0', d: '^1.0.0' },
    note: '`a` хочет `c@^1`, `d` — `c@^2`. В корне место одно: его занимает версия того, кто пришёл первым по алфавиту, вторая вкладывается под `d`.',
  },
  {
    id: 'dup',
    label: 'две копии одной версии',
    deps: { a: '^1.0.0', d: '^1.0.0', e: '^1.0.0' },
    note: 'Двум пакетам нужен `c@2.1.0`, но корень занят `c@1.5.0` — и npm кладёт **две одинаковые** копии, под `d` и под `e`. `npm dedupe` здесь ответил «up to date»: верхнее место держит `a`. pnpm хранит `c@2.1.0` один раз.',
  },
  {
    id: 'majority',
    label: 'кто первый, тот наверху',
    deps: { d: '^1.0.0', e: '^1.0.0', z: '^1.0.0' },
    note: 'Тот же конфликт, только первым по алфавиту теперь `d`: наверх встал `c@2.1.0`, вложен `c@1.5.0` у `z`. Фантомная зависимость приложения поменяла **мажорную** версию, хотя его `package.json` про `c` не говорит ничего.',
  },
  {
    id: 'direct',
    label: 'приложение объявило само',
    deps: { a: '^1.0.0', c: '^2.0.0' },
    note: 'Версия, объявленная приложением, занимает корень всегда: зависимости корня ставятся раньше зависимостей пакетов. `a` получает свою `c@1.5.0` вложенной.',
  },
  {
    id: 'peer',
    label: 'peer ставится сам',
    deps: { plug: '^1.0.0' },
    note: '`plug` объявил `host@^1.0.0` как peer. npm 7+ ставит его сам — в корень, рядом с `plug`, — и `host` становится фантомом приложения. pnpm тоже ставит сам, но наверх не кладёт.',
  },
  {
    id: 'peerclash',
    label: 'peer-конфликт',
    deps: { host: '^2.0.0', plug: '^1.0.0' },
    note: 'Приложение хочет `host@2`, плагин — `host@^1`. Вложить peer нельзя — весь смысл в одной копии, — и npm отказывает целиком: `ERESOLVE`. pnpm ставит и предупреждает.',
  },
];

export interface TreeRun {
  exit: number;
  tree: string[];
  /** Первые строки вывода — только то, что относится к исходу. */
  log: string[];
}

/**
 * Раскладки, снятые на стенде (npm 11.19.1 и pnpm 11.0.9 с `minimumReleaseAge: 0`, чтобы
 * у обоих был один и тот же выбор версий), — обходом `node_modules` после установки.
 * Правило раскладки из `widgets/pm-lab/model/layout.ts` тест обязывает повторить каждую.
 */
export const TREE_RUNS: Record<string, { npm: TreeRun; pnpm: TreeRun }> = {
  compat: {
    npm: { exit: 0, log: [], tree: ['node_modules/a 1.0.0', 'node_modules/b 1.0.0', 'node_modules/c 1.5.0'] },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/a@1.0.0/node_modules/a 1.0.0',
        'node_modules/.pnpm/a@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/b@1.0.0/node_modules/b 1.0.0',
        'node_modules/.pnpm/b@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/c@1.5.0/node_modules/c 1.5.0',
        'node_modules/.pnpm/node_modules/c -> ../c@1.5.0/node_modules/c',
        'node_modules/a -> .pnpm/a@1.0.0/node_modules/a',
        'node_modules/b -> .pnpm/b@1.0.0/node_modules/b',
      ],
    },
  },
  clash: {
    npm: {
      exit: 0,
      log: [],
      tree: ['node_modules/a 1.0.0', 'node_modules/c 1.5.0', 'node_modules/d 1.0.0', 'node_modules/d/node_modules/c 2.1.0'],
    },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/a@1.0.0/node_modules/a 1.0.0',
        'node_modules/.pnpm/a@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/c@1.5.0/node_modules/c 1.5.0',
        'node_modules/.pnpm/c@2.1.0/node_modules/c 2.1.0',
        'node_modules/.pnpm/d@1.0.0/node_modules/c -> ../../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/d@1.0.0/node_modules/d 1.0.0',
        'node_modules/.pnpm/node_modules/c -> ../c@1.5.0/node_modules/c',
        'node_modules/a -> .pnpm/a@1.0.0/node_modules/a',
        'node_modules/d -> .pnpm/d@1.0.0/node_modules/d',
      ],
    },
  },
  dup: {
    npm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/a 1.0.0',
        'node_modules/c 1.5.0',
        'node_modules/d 1.0.0',
        'node_modules/d/node_modules/c 2.1.0',
        'node_modules/e 1.0.0',
        'node_modules/e/node_modules/c 2.1.0',
      ],
    },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/a@1.0.0/node_modules/a 1.0.0',
        'node_modules/.pnpm/a@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/c@1.5.0/node_modules/c 1.5.0',
        'node_modules/.pnpm/c@2.1.0/node_modules/c 2.1.0',
        'node_modules/.pnpm/d@1.0.0/node_modules/c -> ../../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/d@1.0.0/node_modules/d 1.0.0',
        'node_modules/.pnpm/e@1.0.0/node_modules/c -> ../../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/e@1.0.0/node_modules/e 1.0.0',
        'node_modules/.pnpm/node_modules/c -> ../c@1.5.0/node_modules/c',
        'node_modules/a -> .pnpm/a@1.0.0/node_modules/a',
        'node_modules/d -> .pnpm/d@1.0.0/node_modules/d',
        'node_modules/e -> .pnpm/e@1.0.0/node_modules/e',
      ],
    },
  },
  majority: {
    npm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/c 2.1.0',
        'node_modules/d 1.0.0',
        'node_modules/e 1.0.0',
        'node_modules/z 1.0.0',
        'node_modules/z/node_modules/c 1.5.0',
      ],
    },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/c@1.5.0/node_modules/c 1.5.0',
        'node_modules/.pnpm/c@2.1.0/node_modules/c 2.1.0',
        'node_modules/.pnpm/d@1.0.0/node_modules/c -> ../../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/d@1.0.0/node_modules/d 1.0.0',
        'node_modules/.pnpm/e@1.0.0/node_modules/c -> ../../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/e@1.0.0/node_modules/e 1.0.0',
        'node_modules/.pnpm/node_modules/c -> ../c@2.1.0/node_modules/c',
        'node_modules/.pnpm/z@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/z@1.0.0/node_modules/z 1.0.0',
        'node_modules/d -> .pnpm/d@1.0.0/node_modules/d',
        'node_modules/e -> .pnpm/e@1.0.0/node_modules/e',
        'node_modules/z -> .pnpm/z@1.0.0/node_modules/z',
      ],
    },
  },
  direct: {
    npm: { exit: 0, log: [], tree: ['node_modules/a 1.0.0', 'node_modules/a/node_modules/c 1.5.0', 'node_modules/c 2.1.0'] },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/a@1.0.0/node_modules/a 1.0.0',
        'node_modules/.pnpm/a@1.0.0/node_modules/c -> ../../c@1.5.0/node_modules/c',
        'node_modules/.pnpm/c@1.5.0/node_modules/c 1.5.0',
        'node_modules/.pnpm/c@2.1.0/node_modules/c 2.1.0',
        'node_modules/a -> .pnpm/a@1.0.0/node_modules/a',
        'node_modules/c -> .pnpm/c@2.1.0/node_modules/c',
      ],
    },
  },
  peer: {
    npm: { exit: 0, log: [], tree: ['node_modules/host 1.5.0', 'node_modules/plug 1.0.0'] },
    pnpm: {
      exit: 0,
      log: [],
      tree: [
        'node_modules/.pnpm/host@1.5.0/node_modules/host 1.5.0',
        'node_modules/.pnpm/node_modules/host -> ../host@1.5.0/node_modules/host',
        'node_modules/.pnpm/plug@1.0.0_host@1.5.0/node_modules/host -> ../../host@1.5.0/node_modules/host',
        'node_modules/.pnpm/plug@1.0.0_host@1.5.0/node_modules/plug 1.0.0',
        'node_modules/plug -> .pnpm/plug@1.0.0_host@1.5.0/node_modules/plug',
      ],
    },
  },
  peerclash: {
    npm: {
      exit: 1,
      log: [
        'npm error code ERESOLVE',
        'npm error ERESOLVE unable to resolve dependency tree',
        'npm error While resolving: peerclash@1.0.0',
        'npm error peer host@"^1.0.0" from plug@1.0.0',
      ],
      tree: [],
    },
    pnpm: {
      exit: 0,
      log: ['[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.'],
      tree: [
        'node_modules/.pnpm/host@2.0.0/node_modules/host 2.0.0',
        'node_modules/.pnpm/plug@1.0.0_host@2.0.0/node_modules/host -> ../../host@2.0.0/node_modules/host',
        'node_modules/.pnpm/plug@1.0.0_host@2.0.0/node_modules/plug 1.0.0',
        'node_modules/host -> .pnpm/host@2.0.0/node_modules/host',
        'node_modules/plug -> .pnpm/plug@1.0.0_host@2.0.0/node_modules/plug',
      ],
    },
  },
};

/**
 * Что приложение получает по `require(имя + '/package.json')` — снято в каждой раскладке
 * стенда. Совпало с полем `visible` правила раскладки во всех четырнадцати случаях.
 */
export const REQUIRE_RUNS: Record<string, { npm: Record<string, string | null>; pnpm: Record<string, string | null> }> = {
  compat: { npm: { a: '1.0.0', b: '1.0.0', c: '1.5.0' }, pnpm: { a: '1.0.0', b: '1.0.0', c: null } },
  clash: { npm: { a: '1.0.0', c: '1.5.0', d: '1.0.0' }, pnpm: { a: '1.0.0', c: null, d: '1.0.0' } },
  dup: { npm: { a: '1.0.0', c: '1.5.0', d: '1.0.0', e: '1.0.0' }, pnpm: { a: '1.0.0', c: null, d: '1.0.0', e: '1.0.0' } },
  majority: { npm: { c: '2.1.0', d: '1.0.0', e: '1.0.0', z: '1.0.0' }, pnpm: { c: null, d: '1.0.0', e: '1.0.0', z: '1.0.0' } },
  direct: { npm: { a: '1.0.0', c: '2.1.0' }, pnpm: { a: '1.0.0', c: '2.1.0' } },
  peer: { npm: { host: '1.5.0', plug: '1.0.0' }, pnpm: { host: null, plug: '1.0.0' } },
  peerclash: { npm: { host: null, plug: null }, pnpm: { host: '2.0.0', plug: '1.0.0' } },
};

export const HOIST_STEPS = [
  '**Выбор версии.** Для каждой зависимости берётся старшая опубликованная версия, попавшая в диапазон. Сразу, без оглядки на соседей: npm не ищет версию, которая устроила бы всех, — он берёт старшую и потом смотрит, влезет ли она.',
  '**Сначала — поиск уже поставленного.** Если по правилу поиска Node от этого пакета уже виден тёзка подходящей версии, новая копия не нужна. Это и есть дедупликация — ничего большего за словом нет.',
  '**Иначе — как можно выше.** Копия поднимается из `node_modules` пакета вверх, пока не упрётся в тёзку другой версии, и ложится **ниже** него. Свободен корень — ложится в корень.',
  '**Порядок обхода.** Пакеты обходятся по уровням, внутри уровня — по имени. Поэтому наверх попадает версия того, чьё имя раньше по алфавиту, а не та, что нужна большинству.',
];

export const HOIST_NOTE =
  'Сравните «несовместима» и «кто первый, тот наверху»: конфликт один и тот же, а фантом `c` у приложения сменил мажор — только потому, что первым по алфавиту стал другой пакет. У pnpm строка «require из приложения» в обоих сценариях одинакова: `c` не найден. Раскладка в демо — упрощённое правило, а не код менеджеров; бейдж под колонкой сверяет его с настоящей установкой.';

export const HISTORY_ROWS: { k: string; top: string; sees: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`{"d": "^1.0.0"}`, потом `npm install a`',
    top: '`c@2.1.0` наверху, `a/node_modules/c@1.3.0`',
    sees: '`c@2.1.0`',
    tone: 'warn',
  },
  {
    k: 'тот же `package.json` и тот же lock, `node_modules` удалён',
    top: 'то же самое — дерево восстановлено по lock-файлу',
    sees: '`c@2.1.0`',
    tone: 'ok',
  },
  {
    k: 'тот же `package.json`, lock-файл удалён',
    top: '`c@1.3.0` наверху, `d/node_modules/c@2.1.0`',
    sees: '`c@1.3.0` — **мажор сменился**',
    tone: 'err',
  },
];

export const HISTORY_NOTE =
  'Раскладка npm зависит не только от `package.json`, но и от **порядка, в котором пакеты добавлялись**: установка поверх существующего дерева не переставляет то, что уже стоит. Один и тот же `package.json` даёт два разных дерева — и узнать, какое у коллеги, можно только из lock-файла. Вывод для своего кода: коммитьте lock-файл и не удаляйте его «чтобы починить установку» — вместе с ним уходит и раскладка. (Строки сняты до публикации `c@1.5.0`, поэтому старшая единица здесь — `1.3.0`.)';

export const PROJECT_DUPES =
  'Живой пример — собственный `node_modules` этого сайта. `npm ls semver` показывает: `@babel/core` требует `semver@^6`, и `semver@6.3.1` занял корень. Всем остальным — Astro, sharp, плагинам ESLint, typescript-eslint — нужен седьмой, и **`semver@7.8.5` лежит на диске девять раз**, по 268 КБ, под каждым, кто его просит. А `import semver from \'semver\'` из кода сайта получил бы шестую версию — фантом, которого сайт не объявлял. Тест этой темы поэтому берёт `semver` не по голому имени, а от лица Astro: `createRequire` из папки `astro`.';

/* ──────────────────── Раздел 3 · lock-файл ──────────────────── */

/** `package-lock.json` сценария «две копии одной версии» — как его записал npm 11.19.1. */
export const LOCK_CODE = `{
  "name": "dup",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "dup",
      "version": "1.0.0",
      "dependencies": {
        "a": "^1.0.0",
        "d": "^1.0.0",
        "e": "^1.0.0"
      }
    },
    "node_modules/a": {
      "version": "1.0.0",
      "resolved": "http://127.0.0.1:48731/a/-/a-1.0.0.tgz",
      "integrity": "sha512-kXYxHjCogzRk7YQKPB/VnjO7yi4GJ3VbjchcET6c7ys4HeehHX4ggdoKfSJL376s6/iYxCmhGWdfq4CX32fC4Q==",
      "dependencies": {
        "c": "^1.0.0"
      }
    },
    "node_modules/c": {
      "version": "1.5.0",
      "resolved": "http://127.0.0.1:48731/c/-/c-1.5.0.tgz",
      "integrity": "sha512-0Uh32IzSPPylbeQjxHXQMYhH/o7yJkgqpnfmS/3M7g2iZNABAMVjGlfdppGY+fXCiGZHbUsFQAMuJ6BBRDnDLw=="
    },
    "node_modules/d": {
      "version": "1.0.0",
      "resolved": "http://127.0.0.1:48731/d/-/d-1.0.0.tgz",
      "integrity": "sha512-6fDmntqJbNtWlDwEaxzlit+a9tz3PW2Bi7ZJVkXRLCXlQShOOUzG+jxvoRbrUoEeuM6lfx6o0XMl53omaRrbVA==",
      "dependencies": {
        "c": "^2.0.0"
      }
    },
    "node_modules/d/node_modules/c": {
      "version": "2.1.0",
      "resolved": "http://127.0.0.1:48731/c/-/c-2.1.0.tgz",
      "integrity": "sha512-5a88B1iUpIKRNqymld35JFEw+LKXniqbh69mYmL6JAXckQTJNZWy3iaz0MXGQcawxotsZKS4d45JoBbXNf0PuQ=="
    },
    "node_modules/e": {
      "version": "1.0.0",
      "resolved": "http://127.0.0.1:48731/e/-/e-1.0.0.tgz",
      "integrity": "sha512-XveRFwXcB/5i/BftIuigKXN7hQ2bBXA2xDnEB7Lyt2TVL3K+aFgxY1dP74OtCvnmwgu2c1J/Sj1kVRauPO0C6A==",
      "dependencies": {
        "c": "^2.0.0"
      }
    },
    "node_modules/e/node_modules/c": {
      "version": "2.1.0",
      "resolved": "http://127.0.0.1:48731/c/-/c-2.1.0.tgz",
      "integrity": "sha512-5a88B1iUpIKRNqymld35JFEw+LKXniqbh69mYmL6JAXckQTJNZWy3iaz0MXGQcawxotsZKS4d45JoBbXNf0PuQ=="
    }
  }
}`;

export const LOCK_FIELDS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Ключ — путь на диске, а не имя',
    d: 'В `packages` ключ `node_modules/d/node_modules/c` — это **место** в дереве. Lock-файл npm хранит раскладку целиком, с подъёмом и вложенными копиями, поэтому `npm ci` воспроизводит не только версии, но и то, кто кого видит.',
    tone: 'info',
  },
  {
    t: '`resolved` — откуда качать',
    d: 'Полный адрес тарбола. Отсюда два следствия: lock-файл помнит реестр, в котором его записали (зеркало компании, локальный реестр), и переезд на другой реестр — правка lock-файла, а не только настроек.',
  },
  {
    t: '`integrity` — что должно прийти',
    d: 'Хеш байтов тарбола. Две копии `c@2.1.0` в lock-файле с одинаковым `integrity` — один и тот же архив. Подменённый на реестре тарбол npm скачал трижды — две повторные попытки — и остановился с `EINTEGRITY`.',
    tone: 'ok',
  },
  {
    t: '`dependencies` пакета — диапазоны, а не версии',
    d: 'Под `node_modules/a` записано `"c": "^1.0.0"` — то, что `a` просил. Какую версию он **получил**, видно не здесь, а по раскладке: ближайший тёзка вверх по пути.',
  },
  {
    t: '`lockfileVersion: 3`',
    d: 'npm 11 пишет только третью версию формата — дерево в `packages`. Вторая дублировала его старым полем `dependencies` ради npm 6, первая была только старым полем. `pnpm-lock.yaml` живёт своей нумерацией: у pnpm 11 это `\'9.0\'`.',
  },
  {
    t: 'Второй lock-файл — внутри `node_modules`',
    d: 'npm кладёт копию дерева в `node_modules/.package-lock.json` — «скрытый lock-файл». По нему следующая команда понимает, что уже стоит, не обходя тысячи папок. Его же, а не корневой, читает Vite, решая, пересобрать ли предбандл.',
    tone: 'warn',
  },
];

/**
 * Integrity тарбола — считается здесь, этим кодом, и сверяется тестом с lock-файлом выше
 * и с тем, что печатает `npm pack --json`. Тест собирает тарбол сам: `npm pack`
 * детерминирован — время файлов в архиве всегда 26 октября 1985 года, права нормализованы, —
 * и повторная упаковка дала тот же хеш байт в байт.
 */
export const INTEGRITY_CODE = `const { createHash } = require('node:crypto');

// integrity — хеш байтов архива целиком, а не файлов внутри: sha512, записанный в base64
function integrity(tarball) {
  return 'sha512-' + createHash('sha512').update(tarball).digest('base64');
}`;

export const INTEGRITY_NOTE =
  'Тот же хеш — имя файла в кеше npm: тарбол `c@1.5.0` лежит в `_cacache/content-v2/sha512/d1/48/77d8…` — это его sha512 в шестнадцатеричной записи, разбитый на папки. Кеш npm адресуется по содержимому, поэтому `npm ci` с остановленным реестром прошёл: все архивы нашлись по `integrity` из lock-файла, и в сеть он не пошёл. А `npm install zero --offline` для пакета, которого в кеше не было, упал с `ENOTCACHED`.';

export const CI_ROWS: { k: string; install: string; ci: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'lock-файл совпадает с `package.json`',
    install: 'ничего не трогает: «up to date»',
    ci: '**удаляет `node_modules` целиком** — подложенный файл пропал — и ставит ровно lock-файл',
    tone: 'ok',
  },
  {
    k: 'вышла `c@1.5.0`, lock держит `1.3.0`',
    install: 'остаётся `1.3.0` — lock-файл диапазону удовлетворяет',
    ci: 'остаётся `1.3.0`; поднимает только `npm update`',
    tone: 'ok',
  },
  {
    k: 'в `package.json` диапазон, которому lock не удовлетворяет',
    install: 'переразрешает и переписывает lock-файл',
    ci: '**отказ** `EUSAGE`: «can only install packages when your package.json and package-lock.json … are in sync»',
    tone: 'warn',
  },
  {
    k: 'тарбол на реестре подменён',
    install: '`EINTEGRITY` — lock-файл знает хеш',
    ci: '`EINTEGRITY` после двух повторов: «wanted sha512-0Uh3… but got sha512-qN3g…»',
    tone: 'err',
  },
  {
    k: 'реестр недоступен, кеш прогрет',
    install: 'нового не поставить: `ENOTCACHED` с `--offline`',
    ci: 'ставит из кеша по `integrity`',
    tone: 'ok',
  },
];

export const CI_NOTE =
  '`npm install` — команда разработчика: она **правит** lock-файл, когда `package.json` просит другого. `npm ci` — команда сборки: lock-файл для неё закон, и расхождение — ошибка, а не повод переписать. Поэтому в конвейере и в `Dockerfile` стоит `npm ci`. Как из lock-файла получается ключ кеша — в [«GitHub Actions: конвейер», раздел «Кеш и почему он промахивается»](/delivery/github-actions/#s5), а почему `COPY package-lock.json` идёт до `COPY . .` — в [«Docker: образ и слои», раздел «Почему от порядка инструкций зависит скорость сборки»](/delivery/docker/#s3).';

/* ──────────────────── Раздел 4 · peer и overrides ──────────────────── */

export const PEER_ROWS: { k: string; npm: string; pnpm: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'peer никто не поставил',
    npm: 'ставит сам, старшую подходящую (`host@1.5.0`), в корень — и она видна приложению',
    pnpm: 'ставит сам (`autoInstallPeers: true`), но в корень не кладёт',
    tone: 'ok',
  },
  {
    k: 'приложение хочет `host@^2`, плагин — `host@^1`',
    npm: '**`ERESOLVE`**, не ставится ничего',
    pnpm: 'ставит `host@2.0.0`, пишет `[WARN] Issues with peer dependencies found`, код выхода 0',
    tone: 'err',
  },
  {
    k: 'то же с `--legacy-peer-deps`',
    npm: 'ставит, peer не проверяет вовсе; `npm ls` потом падает `ELSPROBLEMS`: `host@2.0.0 … invalid: "^1.0.0"`',
    pnpm: '—',
    tone: 'warn',
  },
  {
    k: 'то же с `--force`',
    npm: 'ставит с предупреждением `ERESOLVE overriding peer dependency`; `npm ls` — тот же `invalid`',
    pnpm: '—',
    tone: 'warn',
  },
  {
    k: 'только плагин, `--legacy-peer-deps`',
    npm: 'ставит один `plug` — `host` не появляется, пока его не поставите вы (поведение npm 3–6)',
    pnpm: '—',
    tone: 'warn',
  },
];

export const PEER_DIR_NOTE =
  '**У pnpm пакет с peer — это пакет вместе с версией peer.** Папка называется `plug@1.0.0_host@1.5.0`, а в lock-файле — `plug@1.0.0(host@1.5.0)`. Если в монорепозитории два приложения держат разные `host`, на диске будет две папки `plug` — каждая со ссылкой на свой `host`. Так pnpm выполняет обещание peer-зависимости: плагин видит **тот же** экземпляр, что и его хозяин.';

/**
 * Зачем peer-зависимость, на одном плагине. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. Таблица `PEER_ROWS` показывала, как менеджеры реагируют
 * на конфликт, но не что сломалось бы, будь хозяин обычной зависимостью. Механика — правило
 * раскладки `HOIST_STEPS` (тёзка другой версии в корне — копия вкладывается ниже) и поиск
 * Node вверх по `node_modules` из «Модулей и сборки»; реакции менеджеров — строки `PEER_ROWS`
 * (npm 11.19.1, pnpm 11.0.9, прогон на стенде этой темы).
 */
export const PEER_SCENE_CODE = `// package.json приложения
{ "dependencies": { "host": "^2.0.0", "plug": "^1.0.0" } }

// host — хозяин: держит список подключённых плагинов
// plug — плагин к нему, при загрузке делает:
const host = require('host')
host.use(myPlugin)            // «запиши меня в свой список»`;

export const PEER_SCENE_NOTE =
  'Что было бы, если `plug` объявил `host@^1` **обычной** зависимостью. Корень уже занят `host@2` приложения, поэтому `host@1` ляжет ниже — в `node_modules/plug/node_modules/host`. Поиск Node идёт от файла, который делает `require`, и из папки `plug` первым находит вложенную копию. Плагин честно записывает себя в список — но в список **своей** копии `host`. Приложение работает со своим `host@2`, и в его списке плагина нет. Ни ошибки, ни предупреждения: плагин просто не срабатывает. Peer-зависимость запрещает эту ситуацию: у `plug` нет своей копии `host`, он обязан получить ту, что стоит у приложения. Остаётся вопрос, что делать, если версия приложения плагину не подходит, — и здесь менеджеры отвечают по-разному.';

export const PEER_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'npm, по умолчанию',
    when: 'приложение просит `host@^2`, плагин — `host@^1`',
    what: 'Отказывается ставить: `ERESOLVE`, на диске не меняется ничего. Конфликт виден сразу, в момент установки, а не когда плагин молча не сработал.',
    cost: 'Работа стоит, пока конфликт не решён: обновить плагин, откатить хозяина или приказать версию через `overrides`.',
  },
  {
    k: 'pnpm, по умолчанию',
    when: 'тот же конфликт',
    what: 'Ставит `host@2.0.0` — одну копию на двоих, как требует peer, — печатает `[WARN] Issues with peer dependencies found` и завершается с кодом 0. Плагин получает тот же экземпляр, что и приложение, но версию, которую ему не обещали.',
    cost: 'Предупреждение легко потерять в выводе, а конвейер его не заметит: код выхода нулевой. Совместим ли плагин с `host@2` на деле, покажет только запуск.',
  },
  {
    k: 'npm с `--legacy-peer-deps` или `--force`',
    when: 'тот же конфликт, флаг добавлен, чтобы «просто поставилось»',
    what: '`--legacy-peer-deps` не проверяет peer вовсе, `--force` проверяет и ставит поверх с предупреждением. В обоих случаях встаёт `host@2.0.0`, а `npm ls` потом падает `ELSPROBLEMS` — `invalid: "^1.0.0"`.',
    cost: 'Конфликт никуда не делся — его перестали показывать при установке. Узнают о нём по `npm ls` или по плагину, который ведёт себя странно.',
  },
];

export const PLAIN_PEER_COPY =
  'Та же насадка. Представьте, что её продают в коробке вместе с «её» пылесосом. Вы ставите насадку на пылесос из коробки, а убираете квартиру своим, домашним, — и удивляетесь, почему насадки на нём нет. Peer-зависимость — надпись на коробке «пылесос в комплект не входит, берите свой»: тогда насадка стоит ровно на том пылесосе, которым вы работаете.';

export const OVERRIDE_CODE = `// package.json приложения — npm
{
  "dependencies": { "a": "^1.0.0", "b": "^1.0.0" },
  "overrides": { "c": "1.0.0" }
}

# pnpm-workspace.yaml — pnpm 11
overrides:
  c: 1.0.0`;

export const OVERRIDE_ROWS: { k: string; got: string; ls: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`"overrides": { "c": "1.0.0" }` при `b` → `c@^1.2.0`',
    got: 'одна `c@1.0.0` на всех — **ниже** того, что просил `b`',
    ls: '`c@1.0.0 overridden`, код выхода **0** — жалобы на `b` нет',
    tone: 'err',
  },
  {
    k: '`"overrides": { "d": { "c": "^1.0.0" } }` — только для `d`',
    got: '`d` берёт общую `c@1.5.0` из корня, вложенная `c@2` исчезла',
    ls: '`c@1.5.0 deduped` под `d`, код выхода 0',
    tone: 'warn',
  },
  {
    k: '`"overrides": { "host": "$host" }` при peer-конфликте',
    got: '`ERESOLVE` не случился: плагин получил `host@2.0.0`',
    ls: '`host@2.0.0 deduped`, код выхода 0',
    tone: 'warn',
  },
  {
    k: 'pnpm: `overrides: { c: 1.0.0 }` в `pnpm-workspace.yaml`',
    got: 'одна `c@1.0.0`',
    ls: 'правило записано и в `pnpm-lock.yaml` — сменили правило, и lock-файл устарел',
    tone: 'warn',
  },
];

export const OVERRIDE_NOTE =
  '`overrides` не просят, а **приказывают**: диапазон пакета больше не проверяется, и `npm ls` честно говорит «всё в порядке». Это инструмент для двух дел — закрыть уязвимость во вложенной зависимости, пока автор не выпустил версию, и убрать копию, про которую вы **знаете**, что она совместима. Каждое правило — долг: записывайте рядом, почему оно стоит и когда его снять. В Yarn то же поле называется `resolutions`.';

/* ──────────────────── Раздел 5 · pnpm и Yarn PnP ──────────────────── */

export const STORE_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Хранилище адресуется по файлам, а не по архивам',
    d: 'В хранилище pnpm 11 (`store/v11/files/`) лежат **отдельные файлы** под именем своего sha512: `index.js` пакета `c@2.1.0` нашёлся по пути `files/b6/7ac4f3…` — его хеш. Отсюда следствие: одинаковый файл — лицензия, общий модуль — хранится один раз, в скольких бы версиях и пакетах он ни встречался.',
    tone: 'info',
  },
  {
    t: 'На macOS — клоны, а не жёсткие ссылки',
    d: 'Режим по умолчанию `packageImportMethod: auto`. На APFS он сделал **клон** (copy-on-write): у файла в проекте другой inode и одна ссылка. С `packageImportMethod: hardlink` inode стал общим с хранилищем, а число ссылок — три: хранилище и два проекта.',
    tone: 'warn',
  },
  {
    t: 'Жёсткая ссылка — это общий файл',
    d: 'Правка `node_modules/.pnpm/c@1.3.0/node_modules/c/index.js` в одном проекте тут же появилась во втором — и в хранилище. В проекте с клонами правки не было. «Подправить пакет прямо в `node_modules`» под pnpm с жёсткими ссылками значит подправить его всем проектам машины; для этого есть `pnpm patch`.',
    tone: 'err',
  },
  {
    t: 'Наверху — только объявленное',
    d: 'В корне `node_modules` лежат симлинки ровно на то, что объявил `package.json`. Всё остальное — в `.pnpm/<имя>@<версия>/node_modules/`, где рядом с пакетом ссылки на его зависимости. `require(\'c\')` из приложения — `MODULE_NOT_FOUND`.',
    tone: 'ok',
  },
  {
    t: 'Строгость — для приложения, не для пакетов',
    d: 'Пакет `sneaky` делает `require(\'c\')`, не объявив его, — и под pnpm **работает**: в `.pnpm/node_modules/` лежит скрытая ссылка на `c` (настройка `hoistPattern: [\'*\']`), а поиск вверх из папки пакета до неё доходит. С `hoistPattern: []` тот же `sneaky` упал `MODULE_NOT_FOUND`. Чужие фантомы pnpm терпит, ваши — нет.',
    tone: 'warn',
  },
];

/**
 * Схема трёх этажей pnpm для `widgets/package-managers-pnpm-diagram`: сценарий `compat`
 * (приложение объявило `a` и `b`, обоим нужна `c`), раскладка — из `TREE_RUNS.compat.pnpm`,
 * этаж хранилища, клоны и жёсткие ссылки — из `STORE_FACTS`, `MODULE_NOT_FOUND` для `c` —
 * из карточки «Наверху — только объявленное». Новых утверждений нет.
 * `kind`: `link` — симлинк, `real` — папка с файлами пакета, `hidden` — скрытая ссылка,
 * которую видят пакеты, но не приложение, `missing` — того, чего нет.
 */
export interface PnpmDiagramEntry {
  path: string;
  kind: 'link' | 'real' | 'hidden' | 'missing';
  note: string;
}
export const PNPM_DIAGRAM: {
  title: string;
  legend: string;
  floors: { name: string; where: string; entries: PnpmDiagramEntry[]; down?: string }[];
} = {
  title: 'Сценарий «общая зависимость совместима» под pnpm: три этажа',
  legend: '↪ — симлинк, ▣ — папка с файлами пакета, штриховая рамка — скрытая ссылка, ✗ — чего нет.',
  floors: [
    {
      name: 'проект',
      where: 'node_modules/',
      entries: [
        { path: 'a', kind: 'link', note: '→ `.pnpm/a@1.0.0/node_modules/a`' },
        { path: 'b', kind: 'link', note: '→ `.pnpm/b@1.0.0/node_modules/b`' },
        { path: 'c', kind: 'missing', note: 'не объявлен — `require(\'c\')` из приложения: `MODULE_NOT_FOUND`' },
      ],
      down: 'симлинки',
    },
    {
      name: 'виртуальное хранилище проекта',
      where: 'node_modules/.pnpm/',
      entries: [
        { path: 'a@1.0.0/node_modules/a', kind: 'real', note: 'сам пакет' },
        { path: 'a@1.0.0/node_modules/c', kind: 'link', note: '→ `c@1.5.0` — зависимость лежит рядом с пакетом' },
        { path: 'b@1.0.0/node_modules/b', kind: 'real', note: 'сам пакет' },
        { path: 'b@1.0.0/node_modules/c', kind: 'link', note: '→ та же `c@1.5.0`' },
        { path: 'c@1.5.0/node_modules/c', kind: 'real', note: 'одна копия на двоих' },
        { path: 'node_modules/c', kind: 'hidden', note: 'скрытая ссылка (`hoistPattern: [\'*\']`): её видят пакеты, но не приложение' },
      ],
      down: 'клон (по умолчанию на macOS) или жёсткая ссылка',
    },
    {
      name: 'хранилище машины',
      where: 'store/v11/files/',
      entries: [
        { path: '<хеш>/<хеш>…', kind: 'real', note: 'отдельные файлы пакетов под именем своего sha512: одинаковый файл хранится один раз, в скольких бы пакетах он ни встречался' },
      ],
    },
  ],
};

export const PNPM_LOCK_CODE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      plug:
        specifier: ^1.0.0
        version: 1.0.0(host@1.5.0)

packages:

  host@1.5.0:
    resolution: {integrity: sha512-m2JvEHguD7LKTq8VRnm/ZzPr/eIvb7SRLlD9QRqQ6u/duZ1NjpW08Gf89aDGBL3d3wtCzGxhQdjH510Qffm6VQ==}

  plug@1.0.0:
    resolution: {integrity: sha512-rk9ERG07pPjwHJRyB50bjK8a0ERHFdZOlxBUl4odUxQlKVXn5Mtke2ld2edYP61Ljk1jF2NAnd94ZezjJFTTHw==}
    peerDependencies:
      host: ^1.0.0

snapshots:

  host@1.5.0: {}

  plug@1.0.0(host@1.5.0):
    dependencies:
      host: 1.5.0`;

export const PNPM_LOCK_NOTE =
  'Lock-файл pnpm устроен иначе, чем у npm: раскладки в нём нет, потому что она выводится из графа однозначно. `packages` — что скачать и с каким хешем, `snapshots` — кто с кем связан, `importers` — что объявил каждый проект монорепозитория. Адреса тарбола нет: для реестра по умолчанию он вычисляется из имени и версии.';

export const WORKSPACE_ROWS: { k: string; npm: string; pnpm: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'где лежат пакеты монорепозитория',
    npm: 'симлинки `node_modules/app → ../packages/app` и `lib → ../packages/lib` в корне',
    pnpm: 'симлинк `packages/app/node_modules/lib → ../../lib` — только у того, кто объявил',
    tone: 'ok',
  },
  {
    k: '`lib` не объявлял `app`, но делает `require(\'app\')`',
    npm: '**работает** — `app` лежит в корневом `node_modules`',
    pnpm: '`MODULE_NOT_FOUND`',
    tone: 'err',
  },
  {
    k: '`app` → `c@^1`, `lib` → `c@^2`',
    npm: '`c@1.5.0` в корне, `packages/lib/node_modules/c` — вторая копия',
    pnpm: 'у каждого своя ссылка в `.pnpm`',
    tone: 'ok',
  },
  {
    k: 'зависимость на соседа',
    npm: 'обычный диапазон `"lib": "^1.0.0"` — берёт соседа, если версия подходит',
    pnpm: '`"lib": "workspace:^"`; в тарболе `pnpm pack` переписал его в `"lib": "^1.0.0"`',
    tone: 'ok',
  },
];

export const PNP_CODE = `$ yarn install                     # Yarn 4.18.0, из кеша corepack
➤ YN0085: │ + a@npm:1.0.0, d@npm:1.0.0, e@npm:1.0.0, c@npm:1.3.0, c@npm:2.1.0
$ ls -a
.pnp.cjs  .yarn  .yarnrc.yml  package.json  yarn.lock      ← node_modules нет
$ ls .yarn/cache
a-npm-1.0.0-4df3d69157-85e6039a29.zip
c-npm-1.3.0-820e4d6bd0-5920cd6ef8.zip
c-npm-2.1.0-62874113e7-c2494b8725.zip
d-npm-1.0.0-5032d500ac-49111bbe62.zip
e-npm-1.0.0-aa9b8c25e5-6d5146b539.zip
$ yarn node -e "require('c')"
Your application tried to access c, but it isn't declared in your dependencies;
this makes the require call ambiguous and unsound.`;

export const PNP_NOTE =
  '**Yarn Plug\'n\'Play убирает `node_modules` совсем.** Пакеты лежат zip-архивами в `.yarn/cache`, а `.pnp.cjs` — таблица «кто какую версию какого пакета видит» — подменяет загрузчику Node поиск по папкам. Фантомная зависимость здесь не «не найдена», а **запрещена** — с объяснением. Цена та же, что у pnpm, только выше: всё, что читает `node_modules` мимо загрузчика (старые плагины, скрипты, IDE), нуждается в поддержке PnP. Поэтому у Yarn есть и `nodeLinker: node-modules` — привычная раскладка.';

/* ──────────────────── Раздел 6 · скрипты и цепочка поставок ──────────────────── */

export const SCRIPT_ROWS: { k: string; what: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'npm 11.19.1, по умолчанию',
    what: '`postinstall` **выполнился**, после установки — `npm warn install-scripts 1 package has install scripts not yet covered by allowScripts` и совет `npm install-scripts approve <pkg>`',
    tone: 'err',
  },
  {
    k: 'npm, `--strict-allow-scripts`',
    what: 'установка падает `ESTRICTALLOWSCRIPTS` до запуска скрипта; пакет не ставится',
    tone: 'ok',
  },
  {
    k: 'npm, `npm install-scripts approve scripty`',
    what: 'в `package.json` появилось `"allowScripts": { "scripty@1.0.0": true }` — **с версией**: следующая версия пакета снова не одобрена',
    tone: 'ok',
  },
  {
    k: 'pnpm 11.0.9, по умолчанию',
    what: 'скрипт **не выполнился**, установка кончилась ошибкой `ERR_PNPM_IGNORED_BUILDS` с кодом 1 и советом `pnpm approve-builds`',
    tone: 'ok',
  },
  {
    k: 'pnpm, `pnpm approve-builds scripty`',
    what: 'в `pnpm-workspace.yaml` записано `allowBuilds: { scripty: true }`, скрипт выполнился',
    tone: 'ok',
  },
];

export const SCRIPT_NOTE =
  '**npm 11.19.1 скрипты установки не блокирует — он о них предупреждает, уже выполнив.** Строка `install-scripts … approve` в выводе npm звучит как запрет, но файл, который писал `postinstall`, на диске: предупреждение пришло после. Блокирует `--strict-allow-scripts` (или `strict-allow-scripts=true` в `.npmrc`), а pnpm 11 — по умолчанию. `postinstall` запускается с правами того, кто ставит, — на машине разработчика и на раннере CI с его секретами. На практике: `strict-allow-scripts=true` в `.npmrc` проекта, и каждый новый скрипт установки — осознанное одобрение, а не строчка в выводе, которую никто не прочитал.';

export const AGE_ROWS: { k: string; setting: string; got: string; tone: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'npm 11.19.1',
    setting: '`min-release-age` — по умолчанию выключен',
    got: '`c@1.5.0`, опубликованная «только что»',
    tone: 'warn',
  },
  {
    k: 'npm, `--min-release-age=1`',
    setting: 'в днях',
    got: '`c@1.3.0`',
    tone: 'ok',
  },
  {
    k: 'pnpm 11.0.9',
    setting: '`minimumReleaseAge` — **1440 минут по умолчанию**',
    got: '`c@1.3.0`, в выводе `+ c 1.3.0 (2.1.0 is available)`',
    tone: 'ok',
  },
  {
    k: 'Yarn 4.18.0',
    setting: '`npmMinimalAgeGate` — **«1d» по умолчанию**',
    got: '`c@1.3.0`',
    tone: 'ok',
  },
];

export const AGE_NOTE =
  'Порог возраста закрывает самый частый сценарий захвата пакета: украденным токеном публикуют версию с вредным кодом, и её снимают через часы — но за эти часы она успевает попасть во все свежие установки по `^`. Сутки ожидания отдают эти часы тем, кто её ловит. Порог не касается того, что уже записано в lock-файле: он работает при **выборе** версии.';

export const AUDIT_CODE = `$ npm audit
# реестр получил POST /-/npm/v1/security/advisories/bulk, тело — gzip:
{"a":["1.0.0"],"c":["1.3.0","2.1.0"],"d":["1.0.0"],"e":["1.0.0"]}

# ответ реестра подставлен руками: «c <1.4.0 — high»
c  <1.4.0
Severity: high
Учебная уязвимость - https://example.invalid/adv/1
fix available via \`npm audit fix\`
node_modules/c`;

export const AUDIT_NOTE =
  '`npm audit` не анализирует код. Он отправляет реестру **список имён и версий всего дерева** и печатает то, что реестр ответил о них из базы уязвимостей. Отсюда его пределы: он не видит вредный код, о котором ещё никто не сообщил, и видит «уязвимость» в пакете, который есть в дереве, но никогда не вызывается. `npm audit fix` поднимает версии в пределах диапазонов — а за их пределы ведёт только `overrides`.';

export const PROVENANCE_NOTE =
  'Происхождение пакета (provenance) — подписанная запись о том, из какого репозитория и каким конвейером собран тарбол: `npm publish --provenance` из CI с OIDC-токеном, проверка — `npm audit signatures`. Это то же, что provenance у образа, — разобрано в [«Docker: образ и слои», подраздел «Что едет рядом с образом: опись, происхождение, подпись»](/delivery/docker/#s1).';

/* ──────────────────── Раздел 7 · тонкие места ──────────────────── */

/**
 * Три защиты на одном захвате пакета. Автор курса (2026-09-29): трудное не сокращать, а объяснять
 * подробно и просто. Раздел называл три механизма и давал по таблице на каждый, но не показывал,
 * что каждый из них ловит в одной и той же истории, а что пропускает. Механика — строки
 * `SCRIPT_ROWS`, `AGE_ROWS`, `CI_ROWS` (прогоны на стенде темы) и `AGE_NOTE`, `AUDIT_NOTE`;
 * ⚠️ поведение базы уязвимостей `npm audit` — по документации, как и сказано в шапке файла.
 */
export const SUPPLY_SCENE_CODE = `Понедельник, 10:00. У автора пакета c украли токен реестра.
10:05 — опубликована c@1.5.1: тот же код плюс
        "postinstall": "node steal.js"   ← читает переменные окружения
15:00 — версию заметили и сняли с реестра.

У вас в package.json: "c": "^1.0.0"
В 11:00 CI собирает ветку, где добавили новую зависимость.`;

export const SUPPLY_SCENE_NOTE =
  'Что происходит **без защиты**. Новая зависимость заставляет пересчитать дерево, и `^1.0.0` выбирает старшую подходящую версию — `c@1.5.1`, опубликованную час назад. Установка распаковывает её и запускает `postinstall` с правами раннера CI: переменные окружения с токенами деплоя уходят чужому серверу. Через четыре часа версию снимут — но секреты уже утекли, и снятие этого не отменяет. Три механизма из этого раздела и lock-файл перехватывают эту историю на разных шагах.';

export const SUPPLY_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Lock-файл и `npm ci`',
    when: 'срабатывает на **выборе** версии, если версия уже записана',
    what: 'Lock-файл держит `c@1.3.0` с её `integrity`. `npm ci` ставит ровно его и ничего не переразрешает; `npm install` тоже оставит `1.3.0` — lock-файл диапазону удовлетворяет. Свежая `1.5.1` в дерево просто не попадает.',
    cost: 'Защищает только то, что уже записано. Новая зависимость, `npm update` или пересозданный lock-файл выбирают версии заново — и ровно в этот момент открыто окно.',
  },
  {
    k: 'Порог возраста версии',
    when: 'срабатывает на **выборе** версии, когда её выбирают заново',
    what: 'С порогом в сутки версия младше суток для выбора не существует: менеджер берёт предыдущую, `c@1.5.0`. pnpm 11 и Yarn 4 делают так по умолчанию, npm — с `--min-release-age`. Вредная версия прожила на реестре пять часов — меньше порога — и ни одна установка с порогом её не выбрала.',
    cost: 'Свежий исправляющий релиз тоже приедет только через сутки. И если вредную версию не заметят дольше порога, он не поможет.',
  },
  {
    k: 'Одобрение скриптов установки',
    when: 'срабатывает на **запуске** `postinstall`, если версия всё-таки выбрана',
    what: 'pnpm 11 скрипт не запускает и падает `ERR_PNPM_IGNORED_BUILDS`; npm с `strict-allow-scripts=true` падает `ESTRICTALLOWSCRIPTS` до запуска. Одобрение у npm записано **с версией** (`"c@1.5.0": true`), поэтому новая `1.5.1` снова считается неодобренной, даже если прошлую вы одобрили.',
    cost: 'Код без `postinstall` не остановит: если вредная строка лежит в самом модуле, она выполнится, когда приложение его импортирует. npm по умолчанию только предупреждает — уже выполнив скрипт.',
  },
  {
    k: '`npm audit`',
    when: 'срабатывает **после** установки, когда о версии сообщили в базу уязвимостей',
    what: 'Отправляет реестру список имён и версий дерева и печатает, что о них известно. Если о `1.5.1` уже сообщили, `audit` назовёт её и подскажет, куда подняться.',
    cost: 'В 11:00 о захвате ещё никто не знает — `audit` молчит. Он помогает найти, где вредная версия успела встать, но установку не предотвращает.',
  },
];

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Фантомная зависимость меняет мажор без единой правки',
    d: 'В npm-раскладке наверх попадает версия того, кто первый по алфавиту и по истории установки. Добавили пакет, удалили lock-файл — и `require(\'c\')` вместо `c@2.1.0` вернул `c@1.3.0`. Объявляйте всё, что импортируете; `pnpm` покажет забытое сразу.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`npm dedupe` не убирает копию, если место наверху занято',
    d: 'Две одинаковые `c@2.1.0` под `d` и `e` остались после `npm dedupe` — корень держит `c@1.5.0`, нужная пакету `a`. Убрать копии можно только сменой версий или `overrides` — и то и другое решение человека, а не команды.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`npm install` в CI переписывает lock-файл',
    d: 'Если `package.json` и lock-файл разошлись, `install` молча переразрешит дерево — и сборка поедет на версиях, которых не видел ни один разработчик. `npm ci` в той же ситуации падает `EUSAGE`, и это правильное поведение.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`--legacy-peer-deps` не решает конфликт, а прячет',
    d: 'Установка проходит, плагин получает `host@2` при заявленном `^1`, а следующий `npm ls` падает `ELSPROBLEMS`. Флаг, прописанный в `.npmrc` «чтобы ставилось», отключает проверку peer навсегда — и для новых пакетов тоже.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`overrides` отключает проверку диапазона',
    d: 'Принудительная `c@1.0.0` при `b`, просившем `^1.2.0`, — и `npm ls` отвечает кодом 0, без единого `invalid`. Менеджер больше не скажет, что пакет получил не то, на что рассчитывал: это теперь знаете только вы.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Предупреждение npm о скриптах приходит после скрипта',
    d: '`npm warn install-scripts … approve` выглядит как отказ, но `postinstall` уже выполнился. Защита включается `strict-allow-scripts=true`; одобрение пишется в `package.json` с версией, и обновление пакета снимает его.',
    tone: 'err',
  },
  {
    n: '07',
    t: '`^0.x` не обновляется «само»',
    d: '`^0.4.2` не пустит `0.5.0`: до первой мажорной версии каретка считает ломающим минор. Пакет в `0.x` застревает на одной минорной линии, пока его не поднимут руками, — `npm outdated` покажет его в колонке `Latest`, но не в `Wanted`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Правка файла в `node_modules` под pnpm правит все проекты',
    d: 'С `packageImportMethod: hardlink` файл в проекте и файл в хранилище — один файл. Отладочный `console.log`, вписанный в пакет, появится в соседнем проекте. На macOS по умолчанию клоны, на Linux без поддержки reflink — жёсткие ссылки: поведение зависит от файловой системы.',
    tone: 'warn',
  },
];

/* ──────────────────── Раздел 8 · источники ──────────────────── */

export const SOURCES: { t: string; items: string[] }[] = [
  {
    t: 'Спецификации и документация',
    items: [
      '**semver.org** — Semantic Versioning 2.0.0: порядок версий и пререлизов',
      '**node-semver, README** — `^`, `~`, x-диапазоны, правило пререлизов, `includePrerelease`',
      '**docs.npmjs.com** — `package-lock.json`, `npm ci`, `overrides`, `peerDependencies`, `npm audit`, `min-release-age`, `allow-scripts`, `strict-allow-scripts`, provenance',
      '**pnpm.io** — «Symlinked node_modules structure», «Motivation» (хранилище), настройки `hoistPattern`, `packageImportMethod`, `minimumReleaseAge`, `allowBuilds`, `overrides`, workspace-протокол',
      '**yarnpkg.com** — Plug\'n\'Play, `nodeLinker`, `npmMinimalAgeGate`, `resolutions`',
    ],
  },
  {
    t: 'Исходники, прочитанные ради умолчаний',
    items: [
      '**npm 11.19.1** — `@npmcli/config/lib/definitions/definitions.js`: `min-release-age` по умолчанию `null`, `strict-allow-scripts` — `false`',
      '**pnpm 11.0.9** — `dist/pnpm.mjs`: `minimum-release-age` `24 * 60`, `strict-dep-builds` `true`, `package-import-method` `auto`',
      '**Yarn 4.18.0** — `yarn.js`: `npmMinimalAgeGate`, `default: "1d"`',
    ],
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «CommonJS против ESM и цена их стыковки»](/tooling/modules/#s3) — как загрузчик ищет пакет, фантомные зависимости со стороны загрузчика и dual package hazard. [Docker: образ и слои](/delivery/docker/#s3) — `npm ci` в слое, который переживает правки кода. [GitHub Actions: конвейер, раздел «Кеш и почему он промахивается»](/delivery/github-actions/#s5) — кеш зависимостей по хешу lock-файла. [Безопасность фронтенда](/platform/security/) — что делает вредный код, когда он уже в бандле. [Монорепозиторий](/tooling/monorepo/) — воркспейсы, фантом от соседнего пакета, порядок сборки и кеш задач. [Публикация npm-пакета](/tooling/package-publishing/) — поле `exports` по шагам, двойной пакет, типы и что уезжает в тарбол. [Цепочка поставок](/platform/supply-chain/) — скрипты установки, `integrity` в lock-файле, SRI в браузере и путаница зависимостей.';
