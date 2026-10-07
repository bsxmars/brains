import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as nodeFs from 'node:fs';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import git from 'isomorphic-git';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/git-internals/data';
import { apply, createRepo, reachable, T0, type Op } from '@/widgets/git-lab/model/repo';
import { loadGit } from '@/widgets/git-lab/model/run';
import { sha1 as demoSha1 } from '@/widgets/git-lab/model/sha1';
import type { Repo } from '@/widgets/git-lab/model/types';

/**
 * Тема «Git изнутри».
 *
 * `GIT_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с настоящим git (хеши объектов, деревья, коммиты, общий предок, слияние по
 * файлам) и с isomorphic-git. Транскрипты команд в теме исполняются построчно в репозиториях,
 * собранных тем же сценарием, что и стенд, — с фиксированным автором и временем, поэтому
 * хеши повторяются. Модель демо прогоняется по сценариям шагов, и те же шаги повторяются в git.
 *
 * Без git в `PATH` проверки с git пропускаются; сверка с isomorphic-git и node:crypto остаётся.
 */

const HAS_GIT = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
const api = loadGit(t.GIT_CODE);
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
const ctx = { api, sha1: demoSha1 };

const root = realpathSync(mkdtempSync(join(tmpdir(), 'git-internals-')));

function env(time: number) {
  return {
    PATH: process.env.PATH,
    HOME: root,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Reader',
    GIT_AUTHOR_EMAIL: 'reader@example.com',
    GIT_COMMITTER_NAME: 'Reader',
    GIT_COMMITTER_EMAIL: 'reader@example.com',
    GIT_AUTHOR_DATE: `@${time} +0000`,
    GIT_COMMITTER_DATE: `@${time} +0000`,
  };
}

function sh(cwd: string, cmd: string, time = T0): { code: number | null; out: string } {
  const r = spawnSync('sh', ['-c', `${cmd} 2>&1`], { cwd, env: env(time) });
  return { code: r.status, out: r.stdout.toString() };
}
const ok = (cwd: string, cmd: string, time = T0) => {
  const r = sh(cwd, cmd, time);
  if (r.code !== 0) throw new Error(`${cmd}: ${r.out}`);
  return r.out.trim();
};

const lines = (s: string) => s.split('\n').map((l) => l.trimEnd());

/**
 * Исполнить транскрипт из темы: каждая строка `$ команда` (без комментария `# …`) — команда,
 * строки до следующей — её вывод. Вывод из темы обязан встретиться в настоящем выводе по
 * порядку: служебные строки git вроде «Switched to branch» тема опускает.
 */
function replay(cwd: string, transcript: string, time: number) {
  const blocks: { cmd: string; out: string[] }[] = [];
  for (const line of lines(transcript)) {
    if (line.startsWith('$ ')) blocks.push({ cmd: line.slice(2).replace(/\s+#\s.*$/, ''), out: [] });
    else blocks.at(-1)?.out.push(line);
  }
  for (const b of blocks) {
    const real = lines(sh(cwd, b.cmd, time).out).flatMap((l) => l.split('\r').at(-1) ?? '');
    const want = b.out.filter((l) => l !== '');
    let at = 0;
    for (const w of want) {
      const found = real.indexOf(w.replace(/\s+#\s.*$/, ''), at);
      expect(found, `«${b.cmd}» должен вывести: ${w}\nвывел:\n${real.join('\n')}`).toBeGreaterThanOrEqual(0);
      at = found + 1;
    }
  }
}

/** Сценарий стенда: init → add cart на feature → docs на main. */
function baseRepo(dir: string) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  ok(dir, 'git init -q -b main');
  for (const [p, c] of Object.entries(t.INIT_FILES)) writeFileSync(join(dir, p), c);
  ok(dir, "git add . && git commit -q -m init", T0);
  ok(dir, "git switch -q -c feature && printf 'export const cart = [];\\n' > src/cart.js && git add . && git commit -q -m 'add cart'", T0 + 60);
  ok(dir, "git switch -q main && printf '# Shop\\n\\nInstall: npm i\\n' > README.md && git add . && git commit -q -m docs", T0 + 120);
}

const dirs: Record<string, string> = {};
function copy(from: string, name: string) {
  const to = join(root, name);
  cpSync(dirs[from], to, { recursive: true });
  dirs[name] = to;
  return to;
}
const countLoose = (dir: string) =>
  readdirSync(join(dir, '.git/objects')).filter((d) => /^[0-9a-f]{2}$/.test(d)).reduce((n, d) => n + readdirSync(join(dir, '.git/objects', d)).length, 0);

beforeAll(() => {
  if (!HAS_GIT) return;
  dirs.base = join(root, 'base');
  baseRepo(dirs.base);
}, 60_000);

describe.skipIf(!HAS_GIT)('GIT_CODE против git', () => {
  it('hashObject: hello, привет — как git hash-object; голый SHA-1 от байтов с заголовком тот же', () => {
    const { hash } = api.hashObject('blob', 'hello\n', sha1);
    expect(hash).toBe(ok(root, "printf 'hello\\n' | git hash-object --stdin"));
    expect(sha1(Buffer.from('blob 6\0hello\n'))).toBe(hash);
    expect(t.HELLO_SHELL).toContain(hash);
    const ru = api.hashObject('blob', 'привет\n', sha1);
    expect(ru.hash).toBe(ok(root, "printf 'привет\\n' | git hash-object --stdin"));
    expect(Buffer.from(ru.raw.subarray(0, 8)).toString()).toBe('blob 13\0');
    expect('привет\n'.length).toBe(7);
    expect(t.PITFALLS[0].d).toContain(`\`${ru.hash.slice(0, 7)}\``);
    expect(t.PITFALLS[0].d).toContain('13 байт');
  });

  it('INIT_CODE собирает тот же первый коммит, что git', () => {
    const run = new Function('createHash', `${t.GIT_CODE}\n${t.INIT_CODE}\nreturn { index, tree, commit };`);
    const r = run(createHash) as { index: Record<string, string>; tree: string; commit: string };
    const init = ok(dirs.base, 'git rev-list --max-parents=0 HEAD');
    expect(r.commit).toBe(init);
    expect(r.tree).toBe(ok(dirs.base, `git rev-parse ${init}^{tree}`));
    expect(r.index['README.md']).toBe(ok(dirs.base, `git rev-parse ${init}:README.md`));
    for (const h of [r.index['README.md'], r.index['src/app.js'], r.tree, r.commit]) expect(t.INIT_CODE).toContain(h.slice(0, 8));
  });

  it('writeTree: порядок записей как у git — `src.js`, `src`, `srca`; save получает каждое дерево', () => {
    const dir = join(root, 'order');
    mkdirSync(join(dir, 'src'), { recursive: true });
    ok(dir, 'git init -q');
    const files = { 'src.js': 'a', 'src/a.js': 'b', srca: 'c', 'src/deep/x.txt': 'd' };
    const index: Record<string, string> = {};
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), c);
      index[p] = api.hashObject('blob', c, sha1).hash;
    }
    const saved: string[] = [];
    const mine = api.writeTree(index, sha1, (_type, hash) => saved.push(hash));
    expect(mine).toBe(ok(dir, 'git add . && git write-tree'));
    expect(ok(dir, `git ls-tree ${mine}`).split('\n').map((l) => l.split('\t')[1])).toEqual(['src.js', 'src', 'srca']);
    expect(saved).toHaveLength(3);
    expect(saved.at(-1)).toBe(mine);
  });

  it('commitText даёт побайтно тот же объект для всех коммитов стенда', () => {
    for (const h of ok(dirs.base, 'git rev-list --all').split('\n')) {
      const raw = ok(dirs.base, `git cat-file commit ${h}`) + '\n';
      const tree = /^tree (\w+)/m.exec(raw)![1];
      const parents = [...raw.matchAll(/^parent (\w+)/gm)].map((m) => m[1]);
      const at = Number(/^author .* (\d+) \+0000$/m.exec(raw)![1]);
      const ct = Number(/^committer .* (\d+) \+0000$/m.exec(raw)![1]);
      const message = raw.split('\n\n')[1].replace(/\n$/, '');
      const text = api.commitText({ tree, parents, author: 'Reader <reader@example.com>', authorTime: at, commitTime: ct, message });
      expect(text).toBe(raw);
      expect(api.hashObject('commit', text, sha1).hash).toBe(h);
    }
  });

  it('readLoose читает файл объекта; файл — 22 байта zlib с заголовком 78 01', () => {
    // Строка темы целиком: определение и вызов с '.git' — вызов идёт из каталога репозитория.
    const call = t.READ_LOOSE_CODE.split('\n').find((l) => l.startsWith('readLoose('))!;
    // readFileSync строки читает относительно каталога репозитория стенда.
    const inRepo = (p: string) => readFileSync(join(dirs.base, p));
    const fn = new Function('readFileSync', 'inflateSync', `${t.READ_LOOSE_CODE}\nreturn readLoose;`)(inRepo, inflateSync);
    expect(call).toContain("readLoose('.git', 'a00621bb3a9b990ee018f8d04c2d3140800d6ca6'");
    const hash = 'a00621bb3a9b990ee018f8d04c2d3140800d6ca6';
    expect(fn('.git', hash, { readFileSync: inRepo, inflateSync })).toEqual({ type: 'blob', size: 7, body: '# Shop\n' });
    const file = readFileSync(join(dirs.base, '.git/objects', hash.slice(0, 2), hash.slice(2)));
    expect(file.length).toBe(22);
    expect([file[0], file[1]]).toEqual([0x78, 0x01]);
    expect(inflateSync(file).length).toBe(14);
    expect(t.LOOSE_NOTE).toContain('22 байта');
    expect(t.LOOSE_NOTE).toContain('`78 01`');
  });

  it('SHA-256: та же функция с другим хешем — как репозиторий --object-format=sha256', () => {
    const dir = join(root, 's256');
    mkdirSync(dir);
    ok(dir, 'git init -q --object-format=sha256');
    const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    expect(api.hashObject('blob', 'hello\n', sha256).hash).toBe(ok(dir, "printf 'hello\\n' | git hash-object --stdin"));
  });
});

describe.skipIf(!HAS_GIT)('литералы стенда: транскрипты исполняются и дают тот же вывод', () => {
  it('объекты: дерево, коммит, их размеры; число объектов после каждого коммита — 5, 4, 3', () => {
    replay(dirs.base, t.TREE_CATFILE, T0);
    replay(dirs.base, t.COMMIT_CATFILE, T0);
    expect(ok(dirs.base, 'git cat-file -s 8c3ca5f')).toBe('67');
    expect(t.TREE_NOTE).toContain('67 байт');
    const dir = join(root, 'counts');
    mkdirSync(join(dir, 'src'), { recursive: true });
    ok(dir, 'git init -q -b main');
    for (const [p, c] of Object.entries(t.INIT_FILES)) writeFileSync(join(dir, p), c);
    const counts: number[] = [];
    let prev = 0;
    ok(dir, 'git add . && git commit -q -m init', T0);
    counts.push(countLoose(dir) - prev);
    prev = countLoose(dir);
    ok(dir, "git switch -q -c feature && printf 'export const cart = [];\\n' > src/cart.js && git add . && git commit -q -m 'add cart'", T0 + 60);
    counts.push(countLoose(dir) - prev);
    prev = countLoose(dir);
    ok(dir, "git switch -q main && printf '# Shop\\n\\nInstall: npm i\\n' > README.md && git add . && git commit -q -m docs", T0 + 120);
    counts.push(countLoose(dir) - prev);
    expect(counts).toEqual(t.COMMIT_ROWS.map((r) => Number(r.n)));
    expect(countLoose(dir)).toBe(12);
    expect(t.COMMIT_ROWS_NOTE).toContain('12 файлов');
  });

  it('индекс: блобы пишутся на git add, файл индекса — 184 байта', () => {
    const dir = join(root, 'index');
    mkdirSync(join(dir, 'src'), { recursive: true });
    ok(dir, 'git init -q -b main');
    for (const [p, c] of Object.entries(t.INIT_FILES)) writeFileSync(join(dir, p), c);
    replay(dir, t.INDEX_SHELL, T0);
    expect(countLoose(dir)).toBe(2);
    const idx = readFileSync(join(dir, '.git/index'));
    expect(idx.length).toBe(184);
    expect(idx.subarray(0, 4).toString()).toBe('DIRC');
    expect(idx.readUInt32BE(4)).toBe(2);
    expect(idx.readUInt32BE(8)).toBe(2);
    expect(t.INDEX_NOTE).toContain('184 байта');
  });

  it('ссылки, reflog и тег', () => {
    replay(dirs.base, t.REFS_SHELL, T0 + 120);
    expect(readFileSync(join(dirs.base, '.git/refs/heads/main')).length).toBe(41);
    const dir = copy('base', 'tag');
    replay(dir, t.TAG_SHELL, T0 + 120);
    expect(ok(dir, 'git cat-file -t v1')).toBe('tag');
    expect(t.OBJECT_ROWS[3].example).toContain(ok(dir, 'git rev-parse v1').slice(0, 7));
  });

  it('слияние: общий предок, коммит слияния, три точки, конфликт с тремя стадиями', () => {
    expect(ok(dirs.base, 'git merge-base main feature').slice(0, 7)).toBe('d87690d');
    replay(dirs.base, t.DOTS_SHELL, T0);
    const m = copy('base', 'merge');
    const before = countLoose(m);
    replay(m, t.MERGE_GRAPH, T0 + 180);
    expect(countLoose(m) - before).toBe(2);
    expect(ok(m, 'git rev-parse HEAD^{tree}').slice(0, 7)).toBe('a1838bf');
    const c = copy('base', 'conflict');
    ok(c, "git switch -q feature && printf '# Shop\\n\\nInstall: pnpm i\\n' > README.md && git commit -qam pnpm && git switch -q main", T0 + 180);
    replay(c, t.CONFLICT_SHELL, T0 + 240);
  });

  it('rebase, fast-forward и cherry-pick: новый хеш ed87c19 и у rebase, и у cherry-pick', () => {
    const r = copy('base', 'rebase');
    const before = countLoose(r);
    replay(r, t.REBASE_SHELL, T0 + 180);
    expect(countLoose(r) - before).toBe(2);
    replay(r, t.FF_SHELL, T0 + 180);
    expect(countLoose(r) - before).toBe(2);
    const p = copy('base', 'pick');
    replay(p, t.PICK_SHELL, T0 + 180);
    expect(ok(p, 'git rev-parse main')).toBe(ok(r, 'git rev-parse feature'));
    expect(ok(r, 'git branch --contains 948baef')).toBe('');
  });

  it('потерянный коммит: reflog его держит, gc удаляет только после expire', () => {
    const l = copy('merge', 'lost');
    replay(l, t.LOST_SHELL.split('\n$ git branch rescue')[0], T0 + 240);
    replay(l, t.GC_SHELL, T0 + 240);
    expect(readdirSync(join(l, '.git/refs/heads'))).toEqual([]);
    expect(readFileSync(join(l, '.git/packed-refs'), 'utf8')).toContain('refs/heads/main');
  });

  it('pack: последняя версия целиком, две старые — дельтами; 5138 байт россыпью и 2146 в pack', () => {
    const dir = join(root, 'pack');
    mkdirSync(dir);
    ok(dir, 'git init -q -b main');
    for (const n of [1, 2, 3]) {
      const rows = Array.from({ length: 200 }, (_, i) => `  { id: ${i + 1}, title: 'Item ${i + 1}', price: ${i + 1 === 100 ? n * 111 : (i + 1) * 10} },`);
      writeFileSync(join(dir, 'catalog.js'), ['export const catalog = [', ...rows, '];', ''].join('\n'));
      ok(dir, `git add . && git commit -q -m 'price ${n}'`, T0 + n * 60);
    }
    expect(statSync(join(dir, 'catalog.js')).size).toBe(9103);
    let loose = 0;
    for (const d of readdirSync(join(dir, '.git/objects')).filter((x) => /^[0-9a-f]{2}$/.test(x)))
      for (const f of readdirSync(join(dir, '.git/objects', d))) loose += statSync(join(dir, '.git/objects', d, f)).size;
    expect(loose).toBe(5138);
    replay(dir, t.PACK_SHELL, T0);
    const pack = readdirSync(join(dir, '.git/objects/pack')).find((f) => f.endsWith('.pack'))!;
    expect(statSync(join(dir, '.git/objects/pack', pack)).size).toBe(2146);
    expect(ok(dir, 'git rev-parse HEAD:catalog.js')).toBe('82808a60bea992fda84ca2662c4323f7292dbb4c');
    for (const s of ['9103 байта', '5138 байт', '2146 байт', '16 байт']) expect(t.PACK_NOTE).toContain(s);
  });
});

describe.skipIf(!HAS_GIT)('mergeBase и mergeIndex против git', () => {
  const parentsOf = (dir: string) =>
    Object.fromEntries(ok(dir, 'git rev-list --all --parents').split('\n').map((l) => { const [h, ...p] = l.split(' '); return [h, p]; }));
  const lsTree = (dir: string, rev: string) =>
    Object.fromEntries(ok(dir, `git ls-tree -r ${rev}`).split('\n').map((l) => { const [meta, path] = l.split('\t'); return [path, meta.split(' ')[2]]; }));

  it('общий предок в примере и на графе «крест-накрест» с двумя лучшими предками', async () => {
    const p = parentsOf(dirs.base);
    const [main, feature] = [ok(dirs.base, 'git rev-parse main'), ok(dirs.base, 'git rev-parse feature')];
    expect(api.mergeBase(p, main, feature)).toEqual([ok(dirs.base, 'git merge-base main feature')]);

    const x = copy('base', 'criss');
    const b = ok(x, 'git rev-parse feature');
    const c = ok(x, 'git rev-parse main');
    ok(x, `git switch -q feature && git merge -q --no-edit ${c}`, T0 + 180);
    ok(x, `git switch -q main && git merge -q --no-edit ${b}`, T0 + 240);
    const [m1, m2] = [ok(x, 'git rev-parse feature'), ok(x, 'git rev-parse main')];
    const want = ok(x, `git merge-base --all ${m1} ${m2}`).split('\n').sort();
    expect(want).toHaveLength(2);
    expect(api.mergeBase(parentsOf(x), m1, m2).sort()).toEqual(want);
    const iso = (await git.findMergeBase({ fs: nodeFs, dir: x, oids: [m1, m2] })) as string[];
    expect([...iso].sort()).toEqual(want);
  });

  it('слияние по файлам даёт дерево коммита слияния; конфликт — файл в списке both', () => {
    const m = dirs.merge;
    const base = lsTree(dirs.base, 'd87690d');
    const { result, both } = api.mergeIndex(base, lsTree(m, 'HEAD^1'), lsTree(m, 'HEAD^2'));
    expect(both).toEqual([]);
    expect(api.writeTree(result, sha1)).toBe(ok(m, 'git rev-parse HEAD^{tree}'));
    for (const r of t.MERGE_ROWS) {
      const path = r.path.replaceAll('`', '');
      expect(r.out).toContain(result[path].slice(0, 7));
    }
    const c = dirs.conflict;
    const r = api.mergeIndex(base, lsTree(c, 'main'), lsTree(c, 'feature'));
    expect(r.both).toEqual(ok(c, 'git diff --name-only --diff-filter=U').split('\n'));
  });
});

describe('isomorphic-git', () => {
  it('hashBlob совпадает с hashObject на файлах примера и на кириллице', async () => {
    for (const text of [...Object.values(t.INIT_FILES), 'привет\n', '']) {
      const { oid } = await git.hashBlob({ object: text });
      expect(api.hashObject('blob', text, sha1).hash).toBe(oid);
    }
  });

  it.skipIf(!HAS_GIT)('merge() isomorphic-git пишет тот же коммит слияния 6634a92', async () => {
    const dir = copy('base', 'iso');
    const who = { name: 'Reader', email: 'reader@example.com', timestamp: T0 + 180, timezoneOffset: 0 };
    const r = await git.merge({ fs: nodeFs, dir, ours: 'main', theirs: 'feature', author: who, committer: who, message: "Merge branch 'feature'\n" });
    expect(r.oid).toBe(ok(dirs.merge, 'git rev-parse HEAD'));
    expect(t.MERGE_GRAPH).toContain(r.oid!.slice(0, 7));
  });
});

describe('SHA-1 демо против node:crypto', () => {
  it('на краевых длинах и случайных байтах', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const b = randomBytes(n);
      expect(demoSha1(b), String(n)).toBe(sha1(b));
    }
  });
});

describe('модель демо', () => {
  const short = (h: string) => h.slice(0, 7);

  it('стартовое состояние — сквозной пример; слияние и rebase дают хеши из текста', () => {
    const { repo } = createRepo(ctx);
    expect(short(repo.refs.main)).toBe('18a7a6d');
    expect(short(repo.refs.feature)).toBe('948baef');
    expect(repo.objects.size).toBe(12);
    apply(ctx, repo, 'merge');
    expect(short(repo.refs.main)).toBe('6634a92');
    expect(t.DEMO_CAPTION).toContain('`6634a92`');

    const r2 = createRepo(ctx).repo;
    apply(ctx, r2, 'switch');
    apply(ctx, r2, 'rebase');
    expect(short(r2.refs.feature)).toBe('ed87c19');
    expect(t.DEMO_CAPTION).toContain('`ed87c19`');
    // Старый «add cart» после rebase — только в reflog.
    expect(reachable(ctx, r2).has('948baef829e5cfc4caf2e4bbbd93995c172ebf9f')).toBe(false);
    expect(r2.commits.has('948baef829e5cfc4caf2e4bbbd93995c172ebf9f')).toBe(true);
  });

  /** Повторить шаги модели в git и сверять состояние после каждого. */
  function mirror(name: string, ops: Op[]) {
    const dir = join(root, `mirror-${name}`);
    mkdirSync(join(dir, 'src'), { recursive: true });
    ok(dir, 'git init -q -b main');
    const { repo, steps } = createRepo(ctx);
    // Стартовые шаги модель уже сделала — повторяем их в git.
    for (const [p, c] of Object.entries(t.INIT_FILES)) writeFileSync(join(dir, p), c);
    ok(dir, 'git add . && git commit -q -m init', T0);
    const check = (label: string) => {
      for (const b of ['main', 'feature'] as const) {
        const real = sh(dir, `git rev-parse -q --verify ${b}`).out.trim();
        expect(repo.refs[b] ?? '', `${label}: ${b}`).toBe(real);
      }
      expect(ok(dir, 'git symbolic-ref --short HEAD'), label).toBe(repo.head);
      expect(repo.objects.size, `${label}: объектов`).toBe(countLoose(dir));
      const log = readFileSync(join(dir, '.git/logs/HEAD'), 'utf8').trim().split('\n').map((l) => {
        const [meta, what] = l.split('\t');
        const [from, to] = meta.split(' ');
        return { from, to, what };
      });
      expect(repo.reflog, `${label}: reflog`).toEqual(log);
    };
    const replayStep = (s: ReturnType<typeof apply>, r: Repo) => {
      const time = s.time ?? r.clock;
      if (s.kind === 'commit' && s.edit) {
        mkdirSync(dirname(join(dir, s.edit.path)), { recursive: true });
        writeFileSync(join(dir, s.edit.path), s.edit.content);
        ok(dir, `git add -A && git commit -q -m '${s.edit.message}'`, time);
      } else if (s.kind === 'merge') ok(dir, `${s.command.replace('git merge', 'git merge -q --no-edit')}`, time);
      else if (s.kind === 'rebase') ok(dir, `${s.command.replace('git rebase', 'git rebase -q')}`, time);
      else if (s.kind === 'reset') {
        if (s.note.startsWith('У первого')) return;
        ok(dir, 'git reset -q --hard HEAD~1', time);
      } else ok(dir, s.command.replace('git switch', 'git switch -q'), time);
    };
    for (const s of steps.slice(1)) replayStep(s, repo);
    check('старт');
    ops.forEach((op, i) => {
      const s = apply(ctx, repo, op);
      replayStep(s, repo);
      check(`${name} шаг ${i + 1} ${op}`);
    });
    return repo;
  }

  it.skipIf(!HAS_GIT)('сценарии шагов совпадают с git: ссылки, объекты, reflog', () => {
    mirror('merge', ['merge', 'merge', 'switch', 'merge', 'commit', 'switch', 'merge']);
    mirror('rebase', ['switch', 'rebase', 'rebase', 'switch', 'merge', 'commit', 'switch', 'commit', 'rebase']);
    mirror('mixed', ['commit', 'switch', 'commit', 'commit', 'merge', 'switch', 'commit', 'rebase', 'reset', 'commit', 'switch', 'rebase', 'switch', 'merge', 'reset', 'reset', 'commit']);
    mirror('merge-back', ['switch', 'merge', 'commit', 'switch', 'commit', 'switch', 'rebase']);
  }, 60_000);
});
