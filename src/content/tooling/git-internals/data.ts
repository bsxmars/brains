import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Git изнутри: объекты, ссылки, слияние».
 *
 * Тема написана 2026-10-02 для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * git **2.44.0** (системный, macOS), isomorphic-git **1.42.6** из `node_modules` проекта,
 * Node 24.11.0, октябрь 2026. Репозитории — во временных каталогах стенда (scratchpad агента,
 * `agent-git/`), не в проекте курса.
 *
 * Детерминированность: автор и коммиттер — `Reader <reader@example.com>`, время задано через
 * `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` = `@<секунды> +0000`; первый коммит — 1790848800
 * (2026-10-01 10:00:00 UTC), каждый следующий шаг — +60 с. `LC_ALL=C`, `GIT_CONFIG_NOSYSTEM=1`,
 * пустой `HOME` — без чужих настроек. При этих условиях хеши повторяются на любой машине.
 *
 * Сквозной пример: `init` (README.md + src/app.js) на main → `add cart` (src/cart.js) на
 * feature → `docs` (README.md) на main. От него — четыре ветви стенда: `git merge feature`,
 * `git rebase main` на feature, `git cherry-pick feature` на main, конфликт (обе ветки правят
 * README.md, `merge.conflictStyle=diff3`). Отдельно — `git reset --hard HEAD~1` после слияния,
 * `git fsck`, `git gc --prune=now` до и после `git reflog expire --expire=now --all`;
 * репозиторий `catalog.js` (200 строк, три коммита с правкой одной строки) — для `git gc`
 * и `git verify-pack -v`.
 *
 * Что снято и чем пересобирается в `tests/unit/git-internals.test.ts` (настоящий git в
 * `PATH`; без него проверки с git пропускаются, проверки против isomorphic-git остаются):
 *   — все хеши, тексты `git cat-file -p`, вывод `git reflog`, `git ls-files --stage`,
 *     маркеры конфликта, `git merge-base`, `git verify-pack -v` (строки объектов),
 *     число объектов после каждого шага, размер индекса (184 байта), размер и первые два
 *     байта файла объекта (22 байта, `78 01`);
 *   — функции `GIT_CODE` против git: `hash-object`, `write-tree` (в том числе порядок
 *     `src.js` / `src` / `srca`), хеш коммита, `merge-base --all` на графе с двумя лучшими
 *     предками, слияние по файлам против дерева коммита слияния; против isomorphic-git:
 *     `hashBlob`, `findMergeBase`, хеш коммита `merge()`;
 *   — модель демо (`widgets/git-lab/model/repo.ts`) — сценарии шагов повторяются в git,
 *     ссылки, число объектов и строки reflog совпадают после каждого шага.
 *   — SHA-256: в репозитории `--object-format=sha256` `hashObject` с SHA-256 даёт тот же
 *     хеш, что `git hash-object`.
 *
 * Только по документации, без проверки запуском: сроки `gc.reflogExpire` (90 дней),
 * `gc.reflogExpireUnreachable` (30 дней), `gc.pruneExpire` (2 недели); назначение полей
 * индекса (время и размер файла — чтобы `git status` не перечитывал файлы); то, что git
 * считает SHA-1 с обнаружением коллизий (sha1dc); стратегия ort и виртуальная база при
 * нескольких общих предках; выбор базы для дельт в pack (по документации pack-heuristics);
 * «git ищет общего предка, идя от двух вершин по времени коммитов» — по исходнику
 * (`commit-reach.c`, `paint_down_to_common`), не проверено.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'объект',
    d: 'Единица хранения git. Видов четыре: blob — содержимое файла, tree — папка, commit — снимок с автором и родителями, tag — подписанная метка. Объект не меняется никогда: другое содержимое — это другой объект.',
  },
  {
    k: 'хеш (SHA-1)',
    d: '40 шестнадцатеричных знаков, которые git вычисляет из байтов объекта. Это и есть имя объекта. Поменяйте один байт — получится совсем другой хеш. Обычно пишут первые 7 знаков: `d87690d`.',
  },
  {
    k: 'ссылка (ref)',
    d: 'Файл, в котором записан хеш коммита. Ветка `main` — это `.git/refs/heads/main`, тег — `.git/refs/tags/…`. Ссылки меняются, объекты — нет.',
  },
  {
    k: '`HEAD`',
    d: 'Ссылка на «где я сейчас». Обычно в ней записано не хеш, а имя ветки: `ref: refs/heads/main`. Новый коммит двигает ту ветку, на которую указывает `HEAD`.',
  },
  {
    k: 'индекс (staging area)',
    d: 'Файл `.git/index`: список «путь → хеш содержимого», из которого будет собран следующий коммит. `git add` пишет в него, `git commit` — читает.',
  },
  {
    k: 'reflog',
    d: 'Журнал перемещений ссылки: «была на A, стала B, из-за такой-то команды». Хранится только у вас локально, на сервер не отправляется.',
  },
  {
    k: 'общий предок (merge-base)',
    d: 'Последний коммит, который есть в истории обеих веток. От него git отсчитывает, что изменила каждая ветка, когда их сливает.',
  },
  {
    k: 'packfile',
    d: 'Один файл, в котором сжато много объектов сразу. Похожие объекты внутри хранятся дельтой — «возьми тот объект и поменяй вот это».',
  },
];

export const PLAIN_GIT =
  'Как склад, где на ярлыке каждой коробки написан отпечаток её содержимого. Две одинаковые коробки получат один ярлык — и склад хранит одну. Коммит — тоже коробка, но внутри у неё не файлы, а опись: ярлыки других коробок. Ветка — листок на доске объявлений, где записан ярлык одной коробки. Переписать листок легко; подменить содержимое коробки, не сменив ярлык, нельзя.';

export const PREREQ_NOTE =
  'Тема разбирает, что git делает внутри, когда вы набираете привычные команды. Нужны сами команды и несколько понятий; два из них объяснены прямо на карточках.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Git снаружи',
    d: 'Вы делали `git add`, `git commit`, `git switch`, `git merge` и видели `git log`. Тема не учит командам — она показывает, какие файлы они пишут в `.git` и почему ведут себя именно так.',
    tone: 'info',
  },
  {
    t: 'Хеш-функция',
    d: 'Функция, которая из любых байтов делает строку фиксированной длины. Одни и те же байты — всегда один и тот же хеш; любая правка — другой. Обратно из хеша байты не получить. Внутреннее устройство SHA-1 для темы не нужно.',
    tone: 'info',
  },
  {
    t: 'Граф без циклов',
    d: 'Коммиты ссылаются на родителей, и стрелки никогда не замыкаются в круг. Такой граф можно обойти от любой вершины ко всем её предкам — на этом построен поиск общего предка.',
    href: '/tooling/monorepo/#s3',
    hrefLabel: '«Монорепозиторий», раздел «Граф и порядок»',
    tone: 'info',
  },
  {
    t: 'Построчный diff',
    d: 'Как из двух версий файла получить список «удалить строку, вставить строку». Git сливает содержимое файла именно так — построчно, относительно общего предка.',
    href: '/algorithms/diff/#s1',
    hrefLabel: '«Diff», раздел «Скрипт правок»',
    tone: 'info',
  },
];

// ─── Раздел 1. Объекты и хеш ──────────────────────────────────────────────────────────────

export const OBJECT_ROWS = [
  { k: 'blob', what: 'Байты файла. Ни имени, ни прав доступа — только содержимое.', example: '`a00621b` — `# Shop\\n`' },
  { k: 'tree', what: 'Папка: список записей «режим, имя, хеш». Запись ведёт на blob (файл) или на другой tree (вложенную папку).', example: '`8c3ca5f` — `README.md`, `src/`' },
  { k: 'commit', what: 'Хеш корневого дерева, хеши родителей, автор, коммиттер со временем и сообщение.', example: '`d87690d` — `init`' },
  { k: 'tag', what: 'Аннотированный тег: хеш объекта, имя тега, кто и когда поставил, сообщение.', example: '`dad9609` — `v1`' },
];

export const HELLO_SHELL = `$ printf 'hello\\n' | git hash-object --stdin
ce013625030ba8dba906f756967f9e9ca394464a

$ printf 'blob 6\\0hello\\n' | shasum
ce013625030ba8dba906f756967f9e9ca394464a  -`;

export const HELLO_NOTE =
  'Git хеширует не сам файл, а файл с заголовком: тип объекта, пробел, длина в байтах и нулевой байт. Поэтому `shasum` от голого `hello\\n` даёт другой результат, а от строки с заголовком — ровно хеш git. Заголовок нужен, чтобы файл с текстом `tree …` никогда не совпал по имени с настоящим деревом.';

/** Хеш объекта. Первая часть `GIT_CODE`. */
export const HASH_CODE = `const enc = new TextEncoder();

// Объект git — заголовок «тип длина\\0» и содержимое.
// Имя объекта — SHA-1 от всего вместе. Длина — в байтах, не в символах.
function hashObject(type, body, sha1) {
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  const head = enc.encode(\`\${type} \${bytes.length}\\0\`);
  const raw = new Uint8Array(head.length + bytes.length);
  raw.set(head);
  raw.set(bytes, head.length);
  return { hash: sha1(raw), raw };
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));`;

export const PLAIN_HASH =
  'Как отпечаток пальца у документа. По отпечатку нельзя восстановить документ, но по документу отпечаток снимается всегда одинаково. Поэтому git может проверить любой объект: пересчитать хеш и сравнить с именем файла. Не совпало — объект испорчен.';

/** Объект на диске: zlib поверх тех же байтов, что хешировались. Исполняется тестом. */
export const READ_LOOSE_CODE = `// Node: прочитать объект из .git/objects без git.
function readLoose(gitDir, hash, { readFileSync, inflateSync }) {
  // Первые два знака хеша — имя папки, остальные 38 — имя файла.
  const file = \`\${gitDir}/objects/\${hash.slice(0, 2)}/\${hash.slice(2)}\`;
  const raw = inflateSync(readFileSync(file)); // zlib → «тип длина\\0содержимое»
  const nul = raw.indexOf(0);
  const [type, size] = raw.subarray(0, nul).toString().split(' ');
  return { type, size: Number(size), body: raw.subarray(nul + 1).toString() };
}

readLoose('.git', 'a00621bb3a9b990ee018f8d04c2d3140800d6ca6', { readFileSync, inflateSync });
// → { type: 'blob', size: 7, body: '# Shop\\n' }`;

export const LOOSE_NOTE =
  'Файл `.git/objects/a0/0621bb…` весит 22 байта, а после распаковки zlib — 14: `blob 7`, нулевой байт и семь байт `# Shop\\n`. Первые два байта файла — `78 01`: заголовок zlib с самым быстрым уровнем сжатия, его git по умолчанию берёт для отдельных объектов. Такие объекты — по файлу на каждый — называются **loose** (россыпью); позже `git gc` складывает их в один packfile.';

// ─── Раздел 2. Дерево и коммит ────────────────────────────────────────────────────────────

export const INIT_FILES = {
  'README.md': '# Shop\n',
  'src/app.js': "console.log('shop');\n",
};

export const TREE_CATFILE = `$ git cat-file -p 8c3ca5f        # корневое дерево
100644 blob a00621bb3a9b990ee018f8d04c2d3140800d6ca6	README.md
040000 tree 977301d2bc3505bfccbceda14ccba02b7b7fe080	src

$ git cat-file -p 977301d        # дерево src
100644 blob d170eef35a61303f6f4de802078945e2d351a4ff	app.js`;

export const TREE_NOTE =
  'Так дерево печатает `git cat-file -p`. В самом объекте записи короче: `100644 README.md`, нулевой байт и 20 байт хеша **в двоичном виде**, не 40 знаков. Корневое дерево — 67 байт: две записи по 17 + 20 и 10 + 20. Режим `100644` — обычный файл, `100755` — исполняемый, `40000` — папка; печать дописывает ведущий ноль.';

/** Дерево из индекса и текст коммита. Вторая часть `GIT_CODE`. */
export const TREE_CODE = `// Дерево из индекса: { 'src/app.js': хеш блоба, … } → хеш корневого дерева.
// save(type, hash, raw) получает каждое построенное дерево.
function writeTree(index, sha1, save = () => {}) {
  const files = new Map(); // имя → хеш блоба
  const dirs = new Map();  // имя папки → её собственный индекс
  for (const [path, blob] of Object.entries(index)) {
    const slash = path.indexOf('/');
    if (slash < 0) { files.set(path, blob); continue; }
    const dir = path.slice(0, slash);
    if (!dirs.has(dir)) dirs.set(dir, {});
    dirs.get(dir)[path.slice(slash + 1)] = blob;
  }
  const entries = [
    ...[...files].map(([name, hash]) => ({ mode: '100644', name, hash, key: name })),
    ...[...dirs].map(([name, sub]) => ({
      mode: '40000', name, hash: writeTree(sub, sha1, save), key: name + '/',
    })),
  ];
  // Папка сравнивается так, будто у её имени на конце «/».
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const parts = entries.flatMap((e) => [enc.encode(\`\${e.mode} \${e.name}\\0\`), hexToBytes(e.hash)]);
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { body.set(p, at); at += p.length; }
  const { hash, raw } = hashObject('tree', body, sha1);
  save('tree', hash, raw);
  return hash;
}

// Текст коммита: дерево, родители, кто и когда, сообщение.
function commitText({ tree, parents, author, authorTime, commitTime = authorTime, message }) {
  return \`tree \${tree}\\n\` +
    parents.map((p) => \`parent \${p}\\n\`).join('') +
    \`author \${author} \${authorTime} +0000\\n\` +
    \`committer \${author} \${commitTime} +0000\\n\\n\${message}\\n\`;
}`;

export const COMMIT_CATFILE = `$ git cat-file -p d87690d
tree 8c3ca5f901139a4c5521ce2d813c369503cc84a0
author Reader <reader@example.com> 1790848800 +0000
committer Reader <reader@example.com> 1790848800 +0000

init`;

/** Первый коммит сквозного примера, собранный функциями темы. Исполняется тестом. */
export const INIT_CODE = `const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex'); // node:crypto
const blob = (text) => hashObject('blob', text, sha1).hash;

const index = {
  'README.md': blob('# Shop\\n'),                // a00621bb…
  'src/app.js': blob("console.log('shop');\\n"), // d170eef3…
};
const tree = writeTree(index, sha1);            // 8c3ca5f9…
const commit = hashObject('commit', commitText({
  tree,
  parents: [],
  author: 'Reader <reader@example.com>',
  authorTime: 1790848800,
  message: 'init',
}), sha1).hash;                                 // d87690d4… — как у git`;

export const PLAIN_MERKLE =
  'Как опись вложенных коробок. На коробке «src» — список того, что внутри, с отпечатками. На большой коробке — список коробок поменьше, тоже с отпечатками. Поменяли одну вещь в «src» — изменилась опись «src», а значит, её отпечаток, а значит, опись большой коробки. Цепочка доходит до коммита, и его хеш ручается за весь проект целиком.';

export const COMMIT_ROWS = [
  { k: '`init` на main', changed: '`README.md`, `src/app.js` — оба новые', n: '5', which: '2 blob, 2 tree (корень и `src`), commit' },
  { k: '`add cart` на feature', changed: 'новый `src/cart.js`', n: '4', which: 'blob, tree `src`, корневой tree, commit' },
  { k: '`docs` на main', changed: '`README.md`', n: '3', which: 'blob, корневой tree, commit. Дерево `src` то же, что в `init`, — `977301d`' },
];

export const COMMIT_ROWS_NOTE =
  'После трёх коммитов в `.git/objects` 12 файлов. Коммит — не копия проекта: он пишет только то, что изменилось, и путь от изменённого файла до корня. Всё остальное он берёт старыми хешами.';

export const TAG_SHELL = `$ git tag -a v1 -m 'first release'    # аннотированный тег
$ git tag v1-light                     # лёгкий тег
$ cat .git/refs/tags/v1-light
18a7a6db0620c5070614e1132bc9fd7db5483f9a
$ cat .git/refs/tags/v1
dad960962f9ad263a8f54acf74609f8567ba9553
$ git cat-file -p v1
object 18a7a6db0620c5070614e1132bc9fd7db5483f9a
type commit
tag v1
tagger Reader <reader@example.com> 1790848920 +0000

first release`;

export const TAG_NOTE =
  'Лёгкий тег — просто ссылка: файл с хешем коммита, как у ветки, только не двигается. Аннотированный — отдельный объект `tag` со своим автором, временем и сообщением; ссылка `refs/tags/v1` ведёт на него, а уже он — на коммит. Подпись GPG, если она есть, дописывается в этот же объект.';

// ─── Раздел 3. Ветки и индекс ─────────────────────────────────────────────────────────────

export const REFS_SHELL = `$ cat .git/HEAD
ref: refs/heads/main
$ cat .git/refs/heads/main
18a7a6db0620c5070614e1132bc9fd7db5483f9a
$ git reflog
18a7a6d HEAD@{0}: commit: docs
d87690d HEAD@{1}: checkout: moving from feature to main
948baef HEAD@{2}: commit: add cart
d87690d HEAD@{3}: checkout: moving from main to feature
d87690d HEAD@{4}: commit (initial): init`;

export const REFS_FACTS = [
  {
    t: 'Ветка — 41 байт',
    d: 'Файл `.git/refs/heads/main` содержит 40 знаков хеша и перевод строки. Создать ветку — записать такой файл; удалить — стереть его. Сами коммиты от этого не меняются.',
  },
  {
    t: 'Коммит двигает ветку, а не `HEAD`',
    d: '`HEAD` содержит `ref: refs/heads/main` — имя ветки. `git commit` пишет объекты, потом переписывает файл `main` новым хешем и дописывает строку в reflog. Сам `HEAD` остаётся прежним.',
  },
  {
    t: 'Отсоединённый `HEAD`',
    d: '`git switch --detach d87690d` записывает в `HEAD` хеш вместо имени ветки. Коммиты в этом состоянии не двигают ни одну ветку: стоит переключиться — и на них ничего не указывает, кроме reflog.',
    tone: 'warn' as const,
  },
  {
    t: 'Reflog — тоже текстовый файл',
    d: '`.git/logs/HEAD` — по строке на каждое движение: старый хеш, новый, кто, когда и что за команда. `git reflog` печатает его в обратном порядке. `HEAD@{2}` — «где был `HEAD` два движения назад».',
  },
];

export const INDEX_SHELL = `$ git add README.md src/app.js
$ find .git/objects -type f | sort
.git/objects/a0/0621bb3a9b990ee018f8d04c2d3140800d6ca6
.git/objects/d1/70eef35a61303f6f4de802078945e2d351a4ff
$ git ls-files --stage
100644 a00621bb3a9b990ee018f8d04c2d3140800d6ca6 0	README.md
100644 d170eef35a61303f6f4de802078945e2d351a4ff 0	src/app.js`;

export const PLAIN_INDEX =
  'Как корзина в магазине до кассы. Вы кладёте товары по одному (`git add`), можете вынуть или заменить. На кассе (`git commit`) пробивается ровно то, что лежит в корзине, — не то, что осталось на полках. Поменяли файл после `git add` — в коммит уйдёт версия из корзины.';

export const INDEX_NOTE =
  'Блобы появились уже на `git add` — до коммита. Индекс хранит хеши этих блобов, а `git commit` строит из него деревья (это `writeTree` выше) и коммит. Сам `.git/index` здесь весит 184 байта: заголовок `DIRC` с версией и числом записей (12 байт), две записи по 72 и 80 байт, контрольная сумма (20 байт). Кроме пути и хеша в записи лежат время изменения и размер файла: по ним `git status` понимает, что файл не трогали, и не перечитывает его.';

// ─── Раздел 4. Слияние ────────────────────────────────────────────────────────────────────

/** Поиск общего предка. Третья часть `GIT_CODE`. */
export const BASE_CODE = `// Все коммиты, достижимые из start по ссылкам на родителей, включая сам start.
function ancestors(parents, start) {
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    stack.push(...(parents[c] ?? []));
  }
  return seen;
}

// Лучшие общие предки: общие, но не предки другого общего.
function mergeBase(parents, a, b) {
  const fromA = ancestors(parents, a);
  const common = [...ancestors(parents, b)].filter((c) => fromA.has(c));
  return common.filter((c) =>
    !common.some((other) => other !== c && ancestors(parents, other).has(c)));
}`;

export const BASE_NOTE =
  'У `main` (`18a7a6d docs`) и `feature` (`948baef add cart`) общие предки — один `d87690d init`, и `git merge-base main feature` отвечает так же. Лучших общих предков бывает несколько: если две ветки перед этим слили друг друга крест-накрест, функция вернёт оба, как `git merge-base --all`. Настоящий git не обходит граф целиком — он идёт от двух вершин навстречу по времени коммитов, — но ответ тот же.';

export const MERGE_GRAPH = `$ git merge feature
Merge made by the 'ort' strategy.
 src/cart.js | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 src/cart.js

$ git log --graph --format='%h %s'
*   6634a92 Merge branch 'feature'
|\\
| * 948baef add cart
* | 18a7a6d docs
|/
* d87690d init`;

export const FF_SHELL = `$ git switch main
$ git merge feature          # feature уже содержит main целиком
Updating 18a7a6d..ed87c19
Fast-forward
 src/cart.js | 1 +
 1 file changed, 1 insertion(+)
 create mode 100644 src/cart.js`;

export const MERGE_KINDS = [
  {
    t: 'Fast-forward',
    d: 'Текущая ветка — предок той, что вливается. Сливать нечего: git переписывает файл ветки хешем чужой вершины. Новых объектов ноль, и в истории не остаётся следа, что слияние было. Флаг `--no-ff` заставляет записать коммит слияния и в этом случае.',
    tone: 'ok' as const,
  },
  {
    t: 'Трёхстороннее слияние',
    d: 'Ветки разошлись. Git находит общего предка и сравнивает с ним обе вершины. Результат — новое дерево и коммит с **двумя** родителями. В примере это 2 объекта: корневое дерево `a1838bf` и коммит `6634a92`; блобов нет — все файлы уже были в хранилище.',
    tone: 'info' as const,
  },
];

/** Слияние по файлам. Четвёртая часть `GIT_CODE`. */
export const MERGE_CODE = `// Трёхстороннее слияние по файлам: base — общий предок, ours и theirs — две ветки.
// Значения — хеши блобов; нет ключа — нет файла.
function mergeIndex(base, ours, theirs) {
  const result = {};
  const both = []; // файл поменяли обе стороны — нужен построчный merge
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const path of [...paths].sort()) {
    const [b, o, t] = [base[path], ours[path], theirs[path]];
    let pick;
    if (o === t) pick = o;       // одинаково с обеих сторон
    else if (b === o) pick = t;  // менялось только у них
    else if (b === t) pick = o;  // менялось только у нас
    else { both.push(path); pick = o; } // до построчного слияния — наша версия
    if (pick !== undefined) result[path] = pick;
  }
  return { result, both };
}`;

export const MERGE_ROWS = [
  { path: '`README.md`', base: '`a00621b`', ours: '`da17297`', theirs: '`a00621b`', out: '`da17297` — менялось только на main' },
  { path: '`src/app.js`', base: '`d170eef`', ours: '`d170eef`', theirs: '`d170eef`', out: '`d170eef` — никто не трогал' },
  { path: '`src/cart.js`', base: '—', ours: '—', theirs: '`506075e`', out: '`506075e` — добавлен на feature' },
];

export const MERGE_ROWS_NOTE =
  'Из этих трёх хешей `writeTree` собирает дерево `a1838bf` — то самое, что git записал в коммит слияния. Сравнение идёт по хешам, а не по тексту: одинаковые хеши — одинаковые файлы, и читать их не нужно. Только когда файл поменяли обе ветки, git открывает три версии и сливает их построчно.';

export const CONFLICT_SHELL = `$ git -c merge.conflictStyle=diff3 merge feature
Auto-merging README.md
CONFLICT (content): Merge conflict in README.md
Automatic merge failed; fix conflicts and then commit the result.

$ cat README.md
# Shop
<<<<<<< HEAD

Install: npm i
||||||| d87690d
=======

Install: pnpm i
>>>>>>> feature

$ git ls-files --stage README.md
100644 a00621bb3a9b990ee018f8d04c2d3140800d6ca6 1	README.md
100644 da172974c9b52e447457ccbc1996517662725798 2	README.md
100644 6922973c4514d3d262acb8ef70c9f7c483b67e8a 3	README.md`;

export const CONFLICT_NOTE =
  'Обе ветки дописали строку в одно место `README.md` — на feature `Install: pnpm i` вместо `npm i`. Построчное слияние спотыкается, и git кладёт в индекс **три** версии файла с номерами: 1 — общий предок, 2 — ваша (`HEAD`), 3 — вливаемая. Блок `|||||||` в стиле `diff3` показывает версию предка: здесь она пустая, строк в этом месте не было. `git add README.md` после правки заменяет три записи одной, с номером 0. Как git сравнивает версии построчно — в [«Diff», раздел «git diff»](/algorithms/diff/#s4).';

export const DOTS_SHELL = `$ git diff --stat main feature        # две точки: вершина с вершиной
 README.md   | 2 --
 src/cart.js | 1 +
$ git diff --stat main...feature     # три точки: от общего предка
 src/cart.js | 1 +`;

export const DOTS_NOTE =
  'Feature не трогала `README.md`, но `git diff main feature` показывает его удаление: он сравнивает две вершины, а строка `Install` появилась на main после ответвления. Три точки сравнивают вершину feature с общим предком — ровно то, что принесёт слияние. Ревью пул-реквеста показывает именно такой diff. Где та же разница ломает выборку изменённых пакетов — в [«Монорепозитории», раздел «Только изменённое»](/tooling/monorepo/#s4).';

// ─── Раздел 5. Rebase и cherry-pick ───────────────────────────────────────────────────────

export const REBASE_SHELL = `$ git switch feature
$ git rebase main
Successfully rebased and updated refs/heads/feature.

$ git log --graph --format='%h %s' --all
* ed87c19 add cart
* 18a7a6d docs
* d87690d init

$ git log -1 --format='%ad | %cd' --date=iso-strict 948baef   # было
2026-10-01T10:01:00+00:00 | 2026-10-01T10:01:00+00:00
$ git log -1 --format='%ad | %cd' --date=iso-strict ed87c19   # стало
2026-10-01T10:01:00+00:00 | 2026-10-01T10:03:00+00:00`;

export const REBASE_STEPS = [
  {
    k: '1. Что переносить',
    d: 'Коммиты, которые есть в feature и нет в main: `ancestors(feature)` минус `ancestors(main)`. Здесь один — `948baef add cart`.',
  },
  {
    k: '2. Перенести по одному',
    d: 'Для каждого — трёхстороннее слияние, где «предок» — родитель переносимого коммита, «наши» — текущая вершина, «их» — сам коммит. Это и есть `cherry-pick`. Получается дерево `a1838bf`.',
  },
  {
    k: '3. Новый коммит',
    d: 'Тот же автор, время автора и сообщение. Но родитель другой (`18a7a6d` вместо `d87690d`), дерево другое, время коммиттера — сейчас. Другой текст объекта — другой хеш: `ed87c19`.',
  },
  {
    k: '4. Передвинуть ветку',
    d: 'Файл `refs/heads/feature` получает новый хеш. Старый `948baef` никуда не делся: объект лежит в хранилище, его хеш — в reflog ветки.',
  },
];

export const PLAIN_REBASE =
  'Как переписать черновик на чистовик с новой первой страницы. Текст ваших правок тот же, но страницы перенумерованы, и ссылки «см. стр. 3» больше не ведут на старый лист. Старый черновик лежит в корзине — до первого выноса мусора.';

export const PICK_SHELL = `$ git switch main
$ git cherry-pick feature     # то же время коммиттера, что у rebase
[main ed87c19] add cart
 Date: Thu Oct 1 10:01:00 2026 +0000
 1 file changed, 1 insertion(+)
 create mode 100644 src/cart.js`;

export const PICK_NOTE =
  '`cherry-pick` на main дал **тот же хеш** `ed87c19`, что и `rebase` на feature: родитель, дерево, автор, оба времени и сообщение совпали — совпал и объект. Хеш зависит только от содержимого, а не от команды, которая его создала. В жизни время коммиттера почти всегда разное, поэтому один и тот же перенос, сделанный дважды, даёт два разных коммита.';

export const REBASE_ROWS = [
  { k: 'merge', hist: 'Ветвление остаётся видно; коммит слияния с двумя родителями.', hashes: 'Старые хеши не меняются. Новый — только у коммита слияния.', push: 'Обычный `git push`.', tone: 'ok' as const },
  { k: 'rebase', hist: 'Прямая линия, как будто ветку начали от свежего main.', hashes: 'Все перенесённые коммиты получают новые хеши.', push: 'Только `git push --force-with-lease`: на сервере старые коммиты.', tone: 'warn' as const },
  { k: 'cherry-pick', hist: 'Копия одного коммита на другой ветке.', hashes: 'Новый хеш у копии; оригинал остаётся где был.', push: 'Обычный, но в истории два коммита с одной правкой.', tone: 'warn' as const },
];

export const DEMO_CAPTION =
  'Стартовое состояние — сквозной пример: `init`, `add cart` на feature, `docs` на main, у каждого коммита те же хеши, что дал git. Слияние сразу даёт `6634a92` — как в выводе выше, а rebase feature на main — `ed87c19`. Обратите внимание, что fast-forward и переключение веток не создают ни одного объекта, а rebase оставляет старые коммиты бледными: ветка на них больше не указывает, указывает только reflog.';

// ─── Раздел 6. Reflog и pack ──────────────────────────────────────────────────────────────

export const LOST_SHELL = `$ git reset --hard HEAD~1          # отменить слияние 6634a92
HEAD is now at 18a7a6d docs
$ git log --oneline main
18a7a6d docs
d87690d init
$ git reflog -3
18a7a6d HEAD@{0}: reset: moving to HEAD~1
6634a92 HEAD@{1}: merge feature: Merge made by the 'ort' strategy.
18a7a6d HEAD@{2}: commit: docs
$ git fsck --unreachable --no-reflogs
unreachable tree a1838bfcf8dacda306fcd744998d2feebb43e73d
unreachable commit 6634a92e45b5d3d3438bcb531c4682b6faa1098a
$ git branch rescue 6634a92        # вернуть: просто новая ссылка`;

export const LOST_NOTE =
  '`reset` ничего не удаляет — он переписывает файл ветки. Коммит `6634a92` и его дерево остаются в хранилище, только ни одна ветка до них не доходит. `git fsck --unreachable` без флага `--no-reflogs` молчит: для него запись в reflog — такая же ссылка, как ветка. Поэтому «потерянный» коммит почти всегда находится: открыть `git reflog`, найти строку до неудачной команды и поставить на хеш ветку.';

export const GC_SHELL = `$ git gc --prune=now
$ git cat-file -t 6634a92          # жив: на него ссылается reflog
commit
$ git reflog expire --expire=now --all
$ git gc --prune=now
$ git cat-file -t 6634a92
fatal: Not a valid object name 6634a92`;

export const GC_NOTE =
  'Удаляет объекты только `git gc`, и только недостижимые — ни из веток и тегов, ни из reflog. По документации записи reflog о недостижимых коммитах живут 30 дней, остальные — 90, а свежие недостижимые объекты `gc` не трогает ещё две недели. Reflog — локальный: в свежем клоне его нет, и коммит, потерянный у коллеги, вы у себя не найдёте.';

export const PACK_SHELL = `$ git gc
$ git verify-pack -v .git/objects/pack/pack-*.idx
ecc10c9088cb4681bff9a8d03628afee7e10163e commit 210 146 12
d7e47e615a23b1e679a251762f2ff3b089a4ca3a commit 210 145 158
7abe8e114b1f7c9f53ded8b89596cfdc670af270 commit 162 117 303
82808a60bea992fda84ca2662c4323f7292dbb4c blob   9103 1503 420
790c270af9a573c5b0cf30144b57022e4bc2e4b9 tree   38 49 1923
add878f997d597ff89a4270fbb479ceaf70c0925 tree   38 49 1972
800fcb29833e67d7a75b3888d0ca26a110c8c5e1 blob   16 28 2021 1 82808a60bea992fda84ca2662c4323f7292dbb4c
7a2ff32c43d2e8b97cf4da318f2405409a531d34 tree   38 49 2049
a5b9d4a78c176a19d60ebdda1a07fb8009a75e12 blob   16 28 2098 1 82808a60bea992fda84ca2662c4323f7292dbb4c
non delta: 7 objects
chain length = 1: 2 objects`;

export const PACK_COLS = [
  { k: 'хеш, тип', d: 'Какой объект лежит в этом месте pack.' },
  { k: '`9103`', d: 'Размер объекта в распакованном виде. Для дельты — размер самой дельты: `16` байт.' },
  { k: '`1503`', d: 'Сколько объект занимает в pack после zlib.' },
  { k: '`420`', d: 'Смещение от начала файла pack. Индекс `.idx` хранит его для каждого хеша — по нему объект находится без чтения всего pack.' },
  { k: '`1 82808a6…`', d: 'Только у дельт: длина цепочки и объект-база, от которого дельта считается.' },
];

export const PACK_NOTE =
  'Файл `catalog.js` — 200 строк, 9103 байта; три коммита меняют в нём по одной строке. Россыпью три версии лежат тремя файлами по ~1,5 КБ, все 9 объектов — 5138 байт. После `git gc` весь pack — 2146 байт: **последняя** версия файла хранится целиком, а две старые — дельтами по 16 байт от неё. Git выбирает так нарочно: свежие версии нужны чаще, и их выгоднее читать без сборки из дельт. Хеши объектов при этом не меняются — pack меняет только способ хранения.';

export const SECRET_NOTE =
  'Отсюда же — почему секрет нельзя «удалить коммитом». Новый коммит пишет новое дерево без файла, а старый блоб с ключом остаётся: на него ссылается прошлое дерево, на дерево — прошлый коммит. Как это выглядит и что делать с утёкшим ключом — в [«Секретах и конфигурации», раздел «Утечка и ротация»](/delivery/secrets-config/#s6).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Длина в заголовке — в байтах',
    d: '`привет\\n` — 7 символов, но 13 байт: кириллица в UTF-8 занимает по два. Заголовок — `blob 13`, хеш `d0f56e1`. Посчитав `string.length`, получите чужой хеш, и git не найдёт объект.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Rebase опубликованной ветки',
    d: 'После rebase у коммитов новые хеши, а у коллег — старые. Их следующий `git pull` сольёт старые и новые копии, и каждая правка окажется в истории дважды. Переписывать стоит только свою ветку, которую ещё никто не забрал.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`git diff a b` — не то, что принесёт слияние',
    d: 'Две точки сравнивают вершины и показывают чужие правки в основной ветке как «удаления» в вашей. Чтобы увидеть только свою работу, нужны три точки: `main...feature` — от общего предка.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Индекс — это снимок на момент `git add`',
    d: 'Блоб пишется при `git add`. Правка файла после этого в коммит не попадёт, пока не сделать `add` ещё раз. `git commit -a` сам добавляет изменённые отслеживаемые файлы, но не новые.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Права файла — часть дерева',
    d: '`chmod +x` не меняет блоб, но меняет запись в дереве: режим `100755` вместо `100644`. Хеш дерева и коммита другой, а diff показывает «old mode / new mode» без единой строки текста.',
  },
  {
    n: '06',
    t: 'Пустую папку git не хранит',
    d: 'В дереве записи только для файлов и непустых папок. Папка без файлов не даёт ни объекта, ни записи: `git add` её не видит. Поэтому в пустые папки кладут `.gitkeep`.',
  },
  {
    n: '07',
    t: 'Ветка — не всегда файл',
    d: 'После `git gc` каталог `.git/refs/heads` бывает пустым: ветки сложены в один файл `.git/packed-refs`. Читать хеш ветки надо через `git rev-parse main`, а не `cat .git/refs/heads/main`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Fast-forward не оставляет следа',
    d: 'При перемотке коммита слияния нет — по истории не понять, что ветка вообще была. Если след важен (например, чтобы откатить фичу одним `git revert -m 1`), сливают с `--no-ff`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Pro Git — Git Internals: Git Objects',
    href: 'https://git-scm.com/book/en/v2/Git-Internals-Git-Objects',
    what: 'blob, tree, commit, заголовок «тип длина\\0», zlib',
  },
  {
    title: 'Pro Git — Git References',
    href: 'https://git-scm.com/book/en/v2/Git-Internals-Git-References',
    what: 'ветки, `HEAD`, теги как файлы в `.git/refs`',
  },
  {
    title: 'Pro Git — Packfiles',
    href: 'https://git-scm.com/book/en/v2/Git-Internals-Packfiles',
    what: '`git gc`, `git verify-pack`, дельты',
  },
  {
    title: 'gitformat-index — Git index format',
    href: 'https://git-scm.com/docs/index-format',
    what: 'заголовок `DIRC`, поля записи, номера стадий при конфликте',
  },
  {
    title: 'gitformat-pack — Git pack format',
    href: 'https://git-scm.com/docs/pack-format',
    what: 'устройство `.pack` и `.idx`, виды дельт',
  },
  {
    title: 'git-merge-base',
    href: 'https://git-scm.com/docs/git-merge-base',
    what: 'лучший общий предок, `--all` и несколько предков',
  },
  {
    title: 'git-merge',
    href: 'https://git-scm.com/docs/git-merge',
    what: 'fast-forward, `--no-ff`, стратегия ort, `merge.conflictStyle=diff3`',
  },
  {
    title: 'git-rebase',
    href: 'https://git-scm.com/docs/git-rebase',
    what: 'перенос коммитов, выброс коммитов слияния и пустых коммитов',
  },
  {
    title: 'git-gc и git-reflog',
    href: 'https://git-scm.com/docs/git-gc',
    what: '`gc.reflogExpire`, `gc.reflogExpireUnreachable`, `gc.pruneExpire`',
  },
  {
    title: 'hash-function-transition',
    href: 'https://git-scm.com/docs/hash-function-transition',
    what: 'SHA-1 с обнаружением коллизий и переход на SHA-256',
  },
  {
    title: 'isomorphic-git',
    href: 'https://isomorphic-git.org/',
    what: 'git на JavaScript; с ним сверены функции темы',
  },
];

export const RELATED =
  'Смежное на сайте: [Diff, раздел «git diff»](/algorithms/diff/#s4) — как git сравнивает версии файла построчно и почему алгоритм выбирается флагом. [Монорепозиторий, раздел «Только изменённое»](/tooling/monorepo/#s4) — выборка пакетов по `git diff` и база сравнения. [Секреты и конфигурация, раздел «Утечка и ротация»](/delivery/secrets-config/#s6) — ключ, «удалённый» коммитом, в истории. [GitHub Actions](/delivery/github-actions/) — конвейер, который получает репозиторий через `actions/checkout`. [CRDT](/algorithms/crdt/) — слияние правок, которое не нуждается в общем предке.';

/** Всё, что исполняет демо и проверяет тест, — одной строкой. */
export const GIT_CODE = [HASH_CODE, TREE_CODE, BASE_CODE, MERGE_CODE].join('\n\n');
