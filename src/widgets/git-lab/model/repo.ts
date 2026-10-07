import type { CommitNode, GitApi, Index, ObjType, Repo, Sha1, StepResult, StoredObject } from './types';

/**
 * Учебный репозиторий для демо «Граф коммитов руками».
 *
 * Расчёт — функции `GIT_CODE` из темы (`hashObject`, `writeTree`, `commitText`, `mergeBase`,
 * `mergeIndex`): модуль только раскладывает их по командам — `commit`, `switch`, `merge`,
 * `rebase`, `reset` — и ведёт ссылки и reflog. Сценарий правок, автор и время подобраны так,
 * чтобы хеши совпадали с настоящим git побайтно: `tests/unit/git-internals.test.ts` повторяет
 * те же шаги в git 2.44 и сверяет ссылки, число объектов и строки reflog после каждого.
 *
 * Упрощения, которые важно знать: ветки всего две (`main` и `feature`); правки на них не
 * пересекаются по файлам (main правит `README.md`, feature — `src/cart.js`), поэтому слияние
 * по файлам никогда не упирается в построчное; при нескольких общих предках виртуальная база
 * собирается тем же `mergeIndex` по файлам — как ort, только без построчного слияния.
 */

export const AUTHOR = 'Reader <reader@example.com>';
/** 2026-10-01 10:00:00 UTC — время первого коммита стенда. */
export const T0 = 1790848800;
export const ZERO = '0'.repeat(40);
export const BRANCHES = ['main', 'feature'] as const;

const LANES: Record<string, number> = { main: 0, feature: 1 };
const td = new TextDecoder();

export interface Ctx {
  api: GitApi;
  sha1: Sha1;
}

/** Подпись дерева: имена его записей, папки — со слешем. Читается из самих байтов объекта. */
function treeLabel(raw: Uint8Array): string {
  const names: string[] = [];
  let at = raw.indexOf(0) + 1;
  while (at < raw.length) {
    const nul = raw.indexOf(0, at);
    const [mode, name] = td.decode(raw.subarray(at, nul)).split(' ');
    names.push(mode === '40000' ? `${name}/` : name);
    at = nul + 21;
  }
  return names.join(', ');
}

function store(repo: Repo, created: StoredObject[], type: ObjType, hash: string, raw: Uint8Array, label: string) {
  if (repo.objects.has(hash)) return;
  const obj = { hash, type, size: raw.length - raw.indexOf(0) - 1, label };
  repo.objects.set(hash, obj);
  created.push(obj);
}

export const parentsOf = (repo: Repo): Record<string, string[]> =>
  Object.fromEntries([...repo.commits.values()].map((c) => [c.hash, c.parents]));

const tipOf = (repo: Repo, branch = repo.head) => repo.commits.get(repo.refs[branch]);
const indexOf = (repo: Repo, hash?: string): Index => (hash ? repo.commits.get(hash)?.index ?? {} : {});
const short = (h: string) => h.slice(0, 7);
const other = (repo: Repo) => (repo.head === 'main' ? 'feature' : 'main');

function writeTreeOf(ctx: Ctx, repo: Repo, index: Index, created: StoredObject[]): string {
  return ctx.api.writeTree(index, ctx.sha1, (type, hash, raw) => store(repo, created, type, hash, raw, treeLabel(raw)));
}

function makeCommit(
  ctx: Ctx,
  repo: Repo,
  created: StoredObject[],
  c: { index: Index; parents: string[]; message: string; authorTime: number; commitTime: number },
): CommitNode {
  const tree = writeTreeOf(ctx, repo, c.index, created);
  const text = ctx.api.commitText({ tree, parents: c.parents, author: AUTHOR, authorTime: c.authorTime, commitTime: c.commitTime, message: c.message });
  const { hash, raw } = ctx.api.hashObject('commit', text, ctx.sha1);
  store(repo, created, 'commit', hash, raw, c.message);
  const known = repo.commits.get(hash);
  if (known) return known;
  const node: CommitNode = { hash, tree, text, lane: LANES[repo.head], seq: repo.seq++, ...c };
  repo.commits.set(hash, node);
  return node;
}

function moveHead(repo: Repo, to: string, what: string) {
  repo.reflog.push({ from: repo.refs[repo.head] ?? ZERO, to, what });
  repo.refs[repo.head] = to;
}

/** Какой файл правит следующий коммит на текущей ветке. */
function nextEdit(repo: Repo): { path: string; content: string; message: string } {
  const n = (repo.made[repo.head] ?? 0) + 1;
  const index = indexOf(repo, repo.refs[repo.head]);
  const read = (path: string) => (index[path] ? repo.contents.get(index[path]) ?? '' : '');
  if (repo.head === 'main') {
    if (n <= 2) return { path: 'README.md', content: '# Shop\n\nInstall: npm i\n', message: 'docs' };
    return { path: 'README.md', content: `${read('README.md')}- note ${n - 2}\n`, message: `note ${n - 2}` };
  }
  if (n === 1) return { path: 'src/cart.js', content: 'export const cart = [];\n', message: 'add cart' };
  return { path: 'src/cart.js', content: `${read('src/cart.js')}export const step${n} = ${n};\n`, message: `cart ${n}` };
}

/** «3 объекта», «5 объектов». */
export const objects = (n: number) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'объект' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'объекта' : 'объектов'}`;

const listCreated = (created: StoredObject[]) =>
  created.map((o) => `${o.type} \`${short(o.hash)}\``).join(', ');

export function commit(ctx: Ctx, repo: Repo): StepResult {
  const edit = nextEdit(repo);
  const created: StoredObject[] = [];
  const blob = ctx.api.hashObject('blob', edit.content, ctx.sha1);
  store(repo, created, 'blob', blob.hash, blob.raw, edit.path);
  repo.contents.set(blob.hash, edit.content);
  const tip = tipOf(repo);
  const time = repo.clock;
  repo.clock += 60;
  const node = makeCommit(ctx, repo, created, {
    index: { ...(tip?.index ?? {}), [edit.path]: blob.hash },
    parents: tip ? [tip.hash] : [],
    message: edit.message,
    authorTime: time,
    commitTime: time,
  });
  moveHead(repo, node.hash, `commit: ${edit.message}`);
  repo.made[repo.head] = (repo.made[repo.head] ?? 0) + 1;
  return {
    kind: 'commit',
    command: `git commit -am '${edit.message}'`,
    created,
    edit,
    time,
    note: `Правка одного файла — \`${edit.path}\` — записала ${objects(created.length)}: ${listCreated(created)}. Новые деревья — только те, что лежат на пути к изменённому файлу. Файлы и папки, которых правка не коснулась, вошли в коммит старыми хешами.`,
  };
}

export function switchBranch(repo: Repo): StepResult {
  const to = other(repo);
  const from = repo.head;
  const created = !repo.refs[to];
  if (created) repo.refs[to] = repo.refs[from];
  repo.reflog.push({ from: repo.refs[from], to: repo.refs[to], what: `checkout: moving from ${from} to ${to}` });
  repo.head = to;
  return {
    kind: 'switch',
    command: created ? `git switch -c ${to}` : `git switch ${to}`,
    created: [],
    note: `Объектов не прибавилось. \`HEAD\` теперь содержит \`ref: refs/heads/${to}\`, а рабочая папка переписана по дереву коммита \`${short(repo.refs[to])}\`.`,
  };
}

/** Индекс общего предка. Предков несколько — сливаем их между собой, как это делает ort. */
function baseIndex(ctx: Ctx, repo: Repo, bases: string[]): Index {
  if (!bases.length) return {};
  let acc = indexOf(repo, bases[0]);
  const parents = parentsOf(repo);
  for (const b of bases.slice(1)) {
    const deeper = ctx.api.mergeBase(parents, bases[0], b);
    acc = ctx.api.mergeIndex(deeper.length ? indexOf(repo, deeper[0]) : {}, acc, indexOf(repo, b)).result;
  }
  return acc;
}

export function merge(ctx: Ctx, repo: Repo): StepResult {
  const theirsName = other(repo);
  const ours = repo.refs[repo.head];
  const theirs = repo.refs[theirsName];
  const command = `git merge ${theirsName}`;
  const parents = parentsOf(repo);
  if (ctx.api.ancestors(parents, ours).has(theirs)) {
    return { kind: 'merge', command, created: [], note: `Already up to date: \`${theirsName}\` уже входит в историю \`${repo.head}\`. Ничего не меняется.` };
  }
  if (ctx.api.ancestors(parents, theirs).has(ours)) {
    moveHead(repo, theirs, `merge ${theirsName}: Fast-forward`);
    return {
      kind: 'merge',
      command,
      created: [],
      note: `Fast-forward: \`${repo.head}\` — предок \`${theirsName}\`, сливать нечего. Ссылка \`${repo.head}\` просто передвинута на \`${short(theirs)}\`, новых объектов ноль.`,
    };
  }
  const bases = ctx.api.mergeBase(parents, ours, theirs);
  const { result, both } = ctx.api.mergeIndex(baseIndex(ctx, repo, bases), indexOf(repo, ours), indexOf(repo, theirs));
  if (both.length) {
    return { kind: 'merge', command, created: [], note: `Файл ${both.map((p) => `\`${p}\``).join(', ')} изменили обе ветки — нужен построчный merge, демо его не делает.` };
  }
  const time = repo.clock;
  repo.clock += 60;
  const created: StoredObject[] = [];
  const message = repo.head === 'main' ? `Merge branch '${theirsName}'` : `Merge branch '${theirsName}' into ${repo.head}`;
  const node = makeCommit(ctx, repo, created, { index: result, parents: [ours, theirs], message, authorTime: time, commitTime: time });
  moveHead(repo, node.hash, `merge ${theirsName}: Merge made by the 'ort' strategy.`);
  return {
    kind: 'merge',
    command,
    created,
    time,
    note: `Общий предок — \`${bases.map(short).join('`, `')}\`. По каждому файлу взята та сторона, которая его меняла. Записано ${objects(created.length)}: ${listCreated(created)} — у коммита два родителя. Блобов нет: все файлы уже лежали в хранилище.`,
  };
}

export function rebase(ctx: Ctx, repo: Repo): StepResult {
  const ontoName = other(repo);
  const cur = repo.refs[repo.head];
  const onto = repo.refs[ontoName];
  const command = `git rebase ${ontoName}`;
  const parents = parentsOf(repo);
  const upstream = ctx.api.ancestors(parents, onto);
  const mine = [...ctx.api.ancestors(parents, cur)]
    .filter((h) => !upstream.has(h))
    .map((h) => repo.commits.get(h) as CommitNode)
    .sort((a, b) => a.seq - b.seq);
  const linear = mine.every((c) => c.parents.length === 1);
  if (cur === onto || (ctx.api.ancestors(parents, cur).has(onto) && linear)) {
    return { kind: 'rebase', command, created: [], note: `Current branch ${repo.head} is up to date: \`${ontoName}\` уже в основании ветки.` };
  }
  const time = repo.clock;
  repo.clock += 60;
  const created: StoredObject[] = [];
  repo.reflog.push({ from: cur, to: onto, what: `rebase (start): checkout ${ontoName}` });
  let tip = repo.commits.get(onto) as CommitNode;
  const moved: string[] = [];
  for (const c of mine) {
    if (c.parents.length > 1) continue; // коммиты слияния rebase выбрасывает
    const { result } = ctx.api.mergeIndex(indexOf(repo, c.parents[0]), tip.index, c.index);
    if (writeTreeOf(ctx, repo, result, created) === tip.tree) continue; // правка уже есть выше — пустой коммит не пишется
    const node = makeCommit(ctx, repo, created, { index: result, parents: [tip.hash], message: c.message, authorTime: c.authorTime, commitTime: time });
    repo.reflog.push({ from: tip.hash, to: node.hash, what: `rebase (pick): ${c.message}` });
    moved.push(`\`${short(c.hash)}\` → \`${short(node.hash)}\``);
    tip = node;
  }
  repo.reflog.push({ from: tip.hash, to: tip.hash, what: `rebase (finish): returning to refs/heads/${repo.head}` });
  repo.refs[repo.head] = tip.hash;
  return {
    kind: 'rebase',
    command,
    created,
    time,
    note: moved.length
      ? `Коммиты переписаны заново поверх \`${ontoName}\`: ${moved.join(', ')}. Изменения те же, но родитель и дерево другие — значит, другой текст объекта и другой хеш. Старые коммиты никуда не делись: на них больше не указывает ветка, но указывает reflog.`
      : `Ветка \`${repo.head}\` передвинута на \`${short(tip.hash)}\`: всё её содержимое уже есть в \`${ontoName}\`.`,
  };
}

export function reset(repo: Repo): StepResult {
  const tip = tipOf(repo) as CommitNode;
  const command = 'git reset --hard HEAD~1';
  if (!tip.parents.length) return { kind: 'reset', command, created: [], note: 'У первого коммита нет родителя — откатываться некуда.' };
  moveHead(repo, tip.parents[0], 'reset: moving to HEAD~1');
  return {
    kind: 'reset',
    command,
    created: [],
    note: `Ветка \`${repo.head}\` отступила на \`${short(tip.parents[0])}\`. Коммит \`${short(tip.hash)}\` не удалён: объект на месте, его хеш записан в reflog — \`git branch rescue ${short(tip.hash)}\` вернёт его.`,
  };
}

export type Op = 'commit' | 'switch' | 'merge' | 'rebase' | 'reset';

export function apply(ctx: Ctx, repo: Repo, op: Op): StepResult {
  switch (op) {
    case 'commit':
      return commit(ctx, repo);
    case 'switch':
      return switchBranch(repo);
    case 'merge':
      return merge(ctx, repo);
    case 'rebase':
      return rebase(ctx, repo);
    case 'reset':
      return reset(repo);
  }
}

/**
 * Стартовое состояние — сквозной пример темы: `init` на main, `add cart` на feature,
 * `docs` на main. Первый коммит пишет два файла сразу, поэтому собран отдельно.
 */
export function createRepo(ctx: Ctx): { repo: Repo; steps: StepResult[] } {
  const repo: Repo = { objects: new Map(), contents: new Map(), commits: new Map(), refs: {}, head: 'main', reflog: [], clock: T0, made: {}, seq: 0 };
  const created: StoredObject[] = [];
  const index: Index = {};
  for (const [path, content] of [['README.md', '# Shop\n'], ['src/app.js', "console.log('shop');\n"]]) {
    const blob = ctx.api.hashObject('blob', content, ctx.sha1);
    store(repo, created, 'blob', blob.hash, blob.raw, path);
    repo.contents.set(blob.hash, content);
    index[path] = blob.hash;
  }
  const time = repo.clock;
  repo.clock += 60;
  const root = makeCommit(ctx, repo, created, { index, parents: [], message: 'init', authorTime: time, commitTime: time });
  repo.reflog.push({ from: ZERO, to: root.hash, what: 'commit (initial): init' });
  repo.refs.main = root.hash;
  repo.made.main = 1;
  const first: StepResult = { kind: 'commit', command: "git commit -m 'init'", created, time, note: '' };
  const steps = [first, ...(['switch', 'commit', 'switch', 'commit'] as const).map((op) => apply(ctx, repo, op))];
  return { repo, steps };
}

/** Коммиты, до которых можно дойти от веток. Остальные видны только через reflog. */
export function reachable(ctx: Ctx, repo: Repo): Set<string> {
  const parents = parentsOf(repo);
  const out = new Set<string>();
  for (const b of BRANCHES) if (repo.refs[b]) for (const h of ctx.api.ancestors(parents, repo.refs[b])) out.add(h);
  return out;
}
