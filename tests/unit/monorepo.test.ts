import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/monorepo/data';
import { loadCache, loadGraph, loadPublish, playRuns } from '@/widgets/monorepo-lab/model/run';

/**
 * Тема «Монорепозиторий: воркспейсы и граф задач».
 *
 * `GRAPH_CODE`, `PUBLISH_CODE` и `CACHE_CODE` — строки из темы: напечатаны на странице
 * и исполняются демо. Здесь они сверяются с тем, что сняли настоящие npm 11.6.1 и pnpm 11.0.9
 * на фикстуре темы (литералы стенда в `data.ts`, как сняты — в его шапке): порядок `pnpm -r`,
 * выборки `pnpm --filter "...[origin/main]"`, замена `workspace:` в тарболе `pnpm pack`.
 * Сами менеджеры здесь не запускаются: им нужен реестр стенда, а pnpm 11 перед `-r exec`
 * ещё и доустанавливает зависимости. Кеш задач — учебная модель (Turborepo и Nx на стенде
 * не было); проверяется, что ключ меняется ровно от тех входов, о которых говорит тема,
 * и что SHA-256 через `crypto.subtle` — тот же, что у `node:crypto`.
 */

const graph = loadGraph(t.GRAPH_CODE);
const publish = loadPublish(t.PUBLISH_CODE);
const cache = loadCache(t.CACHE_CODE);
const levels = graph.topoLevels(t.PACKAGES);

describe('граф фикстуры', () => {
  it('PACKAGES выведен из манифестов: соседи — только пакеты репозитория', () => {
    expect(t.PACKAGES.map((p) => [p.name, p.deps])).toEqual([
      ['@shop/utils', []],
      ['@shop/ui', ['@shop/utils']],
      ['@shop/api', ['@shop/utils']],
      ['@shop/web', ['@shop/ui', '@shop/api']],
      ['@shop/admin', ['@shop/ui']],
    ]);
    // Схема папок в теме говорит о том же.
    for (const m of t.MANIFESTS) expect(t.LAYOUT_CODE).toContain(m.name);
    expect(JSON.parse(t.WEB_MANIFEST_CODE).dependencies).toEqual(t.MANIFESTS.find((m) => m.name === '@shop/web')!.dependencies);
  });

  it('уровни: [utils], [api, ui], [admin, web] — как в тексте', () => {
    expect(levels).toEqual([['@shop/utils'], ['@shop/api', '@shop/ui'], ['@shop/admin', '@shop/web']]);
    expect(t.LEVELS_NOTE).toContain('`[utils]`, `[api, ui]`, `[admin, web]`');
  });

  it('уровни подряд = порядок pnpm -r --workspace-concurrency=1', () => {
    expect(levels.flat()).toEqual(t.PNPM_ORDER);
  });

  it('параллельный вывод pnpm -r: пакет стартует после Done всех своих зависимостей, уровни — волны', () => {
    const lines = t.PNPM_PARALLEL_CODE.split('\n');
    const dirOf = (name: string) => t.PACKAGES.find((p) => p.name === name)!.dir;
    const at = (s: string) => lines.indexOf(s);
    for (const p of t.PACKAGES) {
      const start = at(`${p.dir} build$ node build.js`);
      expect(start, p.name).toBeGreaterThan(0);
      for (const d of p.deps) expect(at(`${dirOf(d)} build: Done`), `${d} до ${p.name}`).toBeLessThan(start);
    }
    // Внутри уровня оба стартуют до того, как кто-то из них закончил: это параллель.
    for (const level of levels.filter((l) => l.length > 1)) {
      const starts = level.map((n) => at(`${dirOf(n)} build$ node build.js`));
      const dones = level.map((n) => at(`${dirOf(n)} build: Done`));
      expect(Math.max(...starts)).toBeLessThan(Math.min(...dones));
    }
  });

  it('npm --workspaces идёт по списку воркспейсов, а не по графу', () => {
    // Шаблоны поля workspaces по очереди, внутри — по алфавиту папок.
    const byGlob = ['packages/', 'apps/'].flatMap((g) =>
      t.MANIFESTS.filter((m) => m.dir.startsWith(g))
        .sort((a, b) => a.dir.localeCompare(b.dir))
        .map((m) => m.name),
    );
    expect(byGlob).toEqual(t.NPM_ORDER);
    // Упали ровно те, кто стартовал раньше хотя бы одной своей зависимости или после упавшей.
    const built = new Set<string>();
    const failed: string[] = [];
    for (const name of t.NPM_ORDER) {
      const p = t.PACKAGES.find((x) => x.name === name)!;
      if (p.deps.every((d) => built.has(d))) built.add(name);
      else failed.push(name);
    }
    expect(failed).toEqual(t.NPM_FAILED);
    // В напечатанном выводе: у каждого упавшего за строкой запуска — Error, у utils — built.
    const blocks = t.NPM_ORDER_CODE.split('\n> ').slice(1);
    expect(blocks.map((b) => b.split('@1.0.0')[0])).toEqual(t.NPM_ORDER);
    for (const b of blocks) {
      const name = b.split('@1.0.0')[0];
      expect(b.includes('Error: Cannot find module'), name).toBe(t.NPM_FAILED.includes(name));
    }
  });

  it('барьер уровня: c ждал a, хотя зависит только от b', () => {
    expect(graph.topoLevels(t.BARRIER_PACKAGES)).toEqual([['a', 'b'], ['c']]);
    expect(t.BARRIER_LOG.indexOf('start c')).toBeGreaterThan(t.BARRIER_LOG.indexOf('end a'));
    expect(t.BARRIER_NOTE).toContain('start a, start b, end b, end a, start c');
  });

  it('цикл — ошибка с именами пакетов цикла, а не потерянные пакеты', () => {
    const cyc = [
      { name: 'a', dir: 'p/a', deps: [] },
      { name: 'b', dir: 'p/b', deps: ['c'] },
      { name: 'c', dir: 'p/c', deps: ['b'] },
    ];
    expect(() => graph.topoLevels(cyc)).toThrow('цикл в графе: b, c');
  });
});

describe('affected против pnpm --filter "...[origin/main]"', () => {
  it.each(t.FILTER_RUNS)('правка $label', (run) => {
    expect(graph.affected(t.PACKAGES, run.files, 'shop').withDependents).toEqual(run.pnpm);
  });

  it('строки таблицы фильтров про api совпадают с функцией', () => {
    const api = graph.affected(t.PACKAGES, ['packages/api/src/index.js'], 'shop');
    expect(api.changed).toEqual(['@shop/api']);
    expect(api.withDependents).toEqual(['@shop/api', '@shop/web']);
  });

  it('файл в корне принадлежит корню, а не пакету с похожим префиксом', () => {
    expect(graph.affected(t.PACKAGES, ['packages/ui-kit.md'], 'shop').changed).toEqual(['shop']);
    expect(graph.affected(t.PACKAGES, ['packages/ui/package.json'], 'shop').changed).toEqual(['@shop/ui']);
  });
});

describe('PUBLISH_CODE против pnpm pack', () => {
  it.each(t.PACK_ROWS)('$pkg: $dep $spec → $packed', (row) => {
    expect(publish.publishSpec(row.spec, '1.0.0')).toBe(row.packed);
  });

  it('обычный диапазон и явный диапазон после workspace: — как есть', () => {
    expect(publish.publishSpec('^1.0.0', '1.0.0')).toBe('^1.0.0');
    expect(publish.publishSpec('workspace:^1.2.0', '1.3.0')).toBe('^1.2.0');
  });
});

describe('CACHE_CODE: ключ задачи', () => {
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const base = { command: 'build', files: { 'src/index.js': 'a' }, depKeys: ['k1'], env: {} };

  it('sha256 через crypto.subtle = node:crypto', async () => {
    for (const s of ['', 'abc', 'кириллица ₽', JSON.stringify(t.FIXTURE_FILES)]) {
      expect(await cache.sha256(s)).toBe(sha(s));
    }
  });

  it('ключ меняется от файла, ключа зависимости, команды и объявленной переменной', async () => {
    const k = await cache.taskKey(base);
    expect(await cache.taskKey(base)).toBe(k);
    expect(await cache.taskKey({ ...base, files: { 'src/index.js': 'b' } })).not.toBe(k);
    expect(await cache.taskKey({ ...base, depKeys: ['k2'] })).not.toBe(k);
    expect(await cache.taskKey({ ...base, command: 'test' })).not.toBe(k);
    expect(await cache.taskKey({ ...base, env: { API_URL: 'x' } })).not.toBe(k);
    // Порядок перечисления файлов и зависимостей не важен.
    const two = { ...base, files: { a: '1', b: '2' }, depKeys: ['x', 'y'] };
    expect(await cache.taskKey({ ...two, files: { b: '2', a: '1' }, depKeys: ['y', 'x'] })).toBe(await cache.taskKey(two));
  });

  it('правка файла меняет ключи ровно у affected — пакета и его зависимых', async () => {
    const run = (files: typeof t.FIXTURE_FILES) =>
      cache.runWithCache({ packages: t.PACKAGES, levels, files, cache: new Map(), env: {}, declared: [], strict: true });
    const before = await run(t.FIXTURE_FILES);
    for (const preset of t.FILTER_RUNS.filter((p) => p.id !== 'lock')) {
      const files = structuredClone(t.FIXTURE_FILES);
      for (const f of preset.files) {
        const p = t.PACKAGES.find((x) => f.startsWith(x.dir + '/'))!;
        files[p.name][f.slice(p.dir.length + 1)] += '// t\n';
      }
      const after = await run(files);
      const changed = after.filter((e, i) => e.key !== before[i].key).map((e) => e.name).sort();
      expect(changed, preset.label).toEqual(preset.pnpm);
    }
  });
});

describe('CACHE_CODE: два прогона, три режима', () => {
  const play = (id: string) => playRuns(cache, t.PACKAGES, levels, t.FIXTURE_FILES, t.CACHE_RUNS, t.CACHE_MODES.find((m) => m.id === id)!);
  const web = (log: { name: string; hit: boolean; output: string }[]) => log.find((e) => e.name === '@shop/web')!;

  it('первый прогон всегда — промахи', async () => {
    for (const m of t.CACHE_MODES) {
      const [first] = await play(m.id);
      expect(first.every((e) => !e.hit)).toBe(true);
    }
  });

  it('переменная не в ключе: второй прогон попал у всех пяти и отдал стейджинговый бандл', async () => {
    const [, second] = await play('loose');
    expect(second.every((e) => e.hit)).toBe(true);
    expect(web(second).output).toBe('fetch("https://staging.shop/price")');
    expect(t.CACHE_MODES[0].note).toContain('у всех пяти');
  });

  it('строгий режим: задача не видит переменную — undefined в обоих прогонах', async () => {
    const [first, second] = await play('strict');
    expect(web(first).output).toBe('fetch("undefined/price")');
    expect(web(second).hit).toBe(true);
    expect(web(second).output).toBe('fetch("undefined/price")');
  });

  it('API_URL в ключе: второй прогон — промах у всех и продакшен-адрес', async () => {
    const [, second] = await play('declared');
    expect(second.every((e) => !e.hit)).toBe(true);
    expect(web(second).output).toBe('fetch("https://shop.example/price")');
    expect(t.CACHE_MODES[2].note).toContain('Остальные четыре пакета');
  });
});
