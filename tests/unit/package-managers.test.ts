import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { compileSemver } from '@/widgets/pm-lab/model/semver';
import { formatEntry, layoutNpm, layoutPnpm } from '@/widgets/pm-lab/model/layout';
import {
  INTEGRITY_CODE,
  INTEGRITY_NOTE,
  LOCK_CODE,
  RANGE_ROWS,
  REGISTRY,
  REQUIRE_RUNS,
  SCENARIOS,
  SEMVER_CODE,
  TREE_RUNS,
} from '@/content/tooling/package-managers/data';

/**
 * Тема «Пакетные менеджеры»: три вещи, которые тема утверждает и которые можно проверить
 * без сети и без самих менеджеров.
 *
 * 1. **Диапазоны.** `SEMVER_CODE` — та строка, что напечатана в теме и работает в калькуляторе, —
 *    сверяется с настоящим пакетом `semver`. ⚠️ Берётся он **не по голому имени**: в корне
 *    `node_modules` этого сайта лежит `semver@6.3.1`, поднятый ради `@babel/core`, а седьмой
 *    вложен под каждым, кто его просит. `import 'semver'` отсюда был бы фантомной зависимостью —
 *    ровно тем, о чём тема. Поэтому `createRequire` от лица Astro, который `semver@^7` объявил.
 *
 * 2. **Раскладки.** Правило из `widgets/pm-lab/model/layout.ts` обязано повторить строка
 *    в строку деревья, снятые npm 11.19.1 и pnpm 11.0.9 на учебном реестре (`TREE_RUNS`),
 *    и ответы `require` из приложения (`REQUIRE_RUNS`). Сами менеджеры здесь не запускаются:
 *    им нужен реестр, а тест — без сети.
 *
 * 3. **integrity.** Тарбол `c@2.1.0` собирается здесь заново `npm pack` (он детерминирован),
 *    его хеш считает `INTEGRITY_CODE` из темы и сверяет с lock-файлом, который тема печатает.
 */

const semver = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))('semver') as {
  SEMVER_SPEC_VERSION: string;
  validRange(r: string): string | null;
  satisfies(v: string, r: string): boolean;
  compare(a: string, b: string): number;
};
const S = compileSemver(SEMVER_CODE);

const RANGES = [
  '^1.2.3', '^0.2.3', '^0.0.3', '^1.2', '^1.2.x', '^1', '^1.x', '^0.x', '^0.0', '^0.0.x', '^0.0.0', '^0.1',
  '^1.2.3-beta.2', '^0.0.3-beta', '~1.2.3', '~1.2', '~1', '~0.2.3', '~0', '~1.2.3-beta.2', '1.x', '1.2.x', '1',
  '1.2', '*', 'x', '', '1.2.3', '=1.2.3', '>=1.2.3', '>1.2.3', '<2.0.0', '<=1.2.3', '>=1.0.0 <1.5.0',
  '^1.0.0 || ^2.0.0', '1.2.3 || 2.x', '>=1.2.3-alpha <1.2.4', '~1.2.3 >=1.2.5', '^2.0.0-rc.1', '1.2.3-beta.1',
  'x.x.x', '1.x.x', '^1.x.x', '0.x', '0', '~0.0', '0.0.x', '>=0.0.0', '~0.0.1', '^0.1.2-rc.1', '^1.4.0-beta.0',
  '1.x || >=2.1.0',
];
const VERSIONS = [
  '0.0.1', '0.0.3', '0.0.4', '0.0.3-beta', '0.0.3-beta.2', '0.1.0', '0.1.5', '0.2.3', '0.2.9', '0.3.0', '0.9.9',
  '1.0.0', '1.0.0-rc.1', '1.2.0', '1.2.2', '1.2.3', '1.2.3-beta.1', '1.2.3-beta.2', '1.2.3-beta.10', '1.2.3-alpha',
  '1.2.3-beta', '1.2.4', '1.2.4-beta.1', '1.2.5', '1.2.9', '1.3.0', '1.3.0-beta.1', '1.4.0-beta.1', '1.5.0', '1.9.9',
  '2.0.0', '2.0.0-0', '2.0.0-rc.1', '2.0.0-rc.2', '2.0.0-alpha', '2.1.0', '3.0.0',
];

/** Развёртка так, как её печатает `semver.validRange`: «любая версия» у него — `*`. */
const desugared = (range: string) => {
  const text = S.desugar(range).map((set) => set.join(' ')).join('||');
  return text === '' ? '*' : text;
};

describe('semver: учебная строка против пакета semver', () => {
  it('сверка идёт с седьмой версией, взятой от лица Astro', () => {
    // Шестая в корне node_modules сайта — фантом. Если сверка вдруг пошла с ней, тест
    // проверял бы не то, что написано в теме.
    const version = JSON.parse(
      readFileSync(
        createRequire(createRequire(import.meta.url).resolve('astro/package.json')).resolve('semver/package.json'),
        'utf8',
      ),
    ).version as string;
    expect(version.startsWith('7.'), `сверка идёт с semver ${version}, а нужна 7.x`).toBe(true);
  });

  it.each(RANGES)('развёртка «%s» совпадает с semver.validRange', (range) => {
    expect(desugared(range)).toBe(semver.validRange(range));
  });

  it('satisfies совпадает на всей сетке версий и диапазонов', () => {
    const wrong: string[] = [];
    for (const range of RANGES) {
      for (const v of VERSIONS) {
        if (S.satisfies(v, range) !== semver.satisfies(v, range)) wrong.push(`${v} ∈ «${range}»`);
      }
    }
    expect(wrong, `учебная проверка разошлась с semver: ${wrong.join(', ')}`).toEqual([]);
  });

  it('compare совпадает на всех парах версий', () => {
    const wrong: string[] = [];
    for (const a of VERSIONS) for (const b of VERSIONS) if (S.compare(a, b) !== semver.compare(a, b)) wrong.push(`${a} vs ${b}`);
    expect(wrong).toEqual([]);
  });

  it('чего учебная версия не разбирает, она отвергает, а не угадывает', () => {
    expect(() => S.desugar('1.2.3 - 2.3.4')).toThrow();
    expect(() => S.desugar('>1.2')).toThrow();
  });

  it('таблица диапазонов в теме посчитана той же строкой', () => {
    for (const row of RANGE_ROWS) {
      const theirs = semver.validRange(row.range);
      expect(row.desugared.replaceAll(' || ', '||').replace(/^любая$/, '*')).toBe(theirs);
    }
    // Утверждения раздела о `0.x` и пререлизах — через таблицу, которую видит читатель.
    const byRange = Object.fromEntries(RANGE_ROWS.map((r) => [r.range, r.verdicts]));
    expect(byRange['^0.2.3']).toContain('`0.3.0` нет');
    expect(byRange['^0.0.3']).toContain('`0.0.4` нет');
    expect(byRange['^1.2.3-beta.2']).toContain('`1.3.0-beta.1` нет');
    expect(byRange['*']).toContain('`2.2.0-rc.1` нет');
  });
});

describe('раскладка node_modules: правило против снятых npm и pnpm', () => {
  it('сценарии и съёмки — один и тот же список', () => {
    expect(SCENARIOS.map((s) => s.id).sort()).toEqual(Object.keys(TREE_RUNS).sort());
  });

  describe.each(SCENARIOS)('$id', (scenario) => {
    const runs = TREE_RUNS[scenario.id];

    it('npm: дерево строка в строку', () => {
      const layout = layoutNpm(REGISTRY, scenario.deps, S);
      if (runs.npm.exit !== 0) {
        expect(layout.error?.code).toBe('ERESOLVE');
        expect(runs.npm.log.join('\n')).toContain(layout.error!.code);
        return;
      }
      expect(layout.error).toBeUndefined();
      expect(layout.entries.map(formatEntry).sort()).toEqual([...runs.npm.tree].sort());
    });

    it('pnpm: дерево строка в строку', () => {
      const layout = layoutPnpm(REGISTRY, scenario.deps, S);
      expect(layout.error).toBeUndefined();
      expect(layout.entries.map(formatEntry).sort()).toEqual([...runs.pnpm.tree].sort());
      // Предупреждение о peer у pnpm есть ровно там, где оно было в выводе.
      expect(layout.warnings.length > 0).toBe(runs.pnpm.log.some((l) => l.includes('WARN')));
    });

    it('что видит require из приложения — как на стенде', () => {
      const npm = layoutNpm(REGISTRY, scenario.deps, S);
      const pnpm = layoutPnpm(REGISTRY, scenario.deps, S);
      for (const [name, version] of Object.entries(REQUIRE_RUNS[scenario.id].npm)) {
        expect(npm.visible[name] ?? null, `npm, require('${name}')`).toBe(version);
      }
      for (const [name, version] of Object.entries(REQUIRE_RUNS[scenario.id].pnpm)) {
        expect(pnpm.visible[name] ?? null, `pnpm, require('${name}')`).toBe(version);
      }
    });
  });

  it('--legacy-peer-deps: peer не ставится и не проверяется (снято отдельно)', () => {
    const clash = SCENARIOS.find((s) => s.id === 'peerclash')!;
    const peer = SCENARIOS.find((s) => s.id === 'peer')!;
    expect(layoutNpm(REGISTRY, clash.deps, S, { legacyPeerDeps: true }).entries.map(formatEntry)).toEqual([
      'node_modules/host 2.0.0',
      'node_modules/plug 1.0.0',
    ]);
    expect(layoutNpm(REGISTRY, peer.deps, S, { legacyPeerDeps: true }).entries.map(formatEntry)).toEqual([
      'node_modules/plug 1.0.0',
    ]);
  });

  it('метки: две одинаковые копии у npm, ни одной у pnpm; фантом — то, что наверху без объявления', () => {
    const dup = SCENARIOS.find((s) => s.id === 'dup')!;
    const npm = layoutNpm(REGISTRY, dup.deps, S);
    expect(npm.entries.filter((e) => e.tags.includes('duplicate')).map((e) => e.path)).toEqual([
      'node_modules/d/node_modules/c',
      'node_modules/e/node_modules/c',
    ]);
    expect(npm.entries.find((e) => e.path === 'node_modules/c')?.tags).toContain('phantom');
    expect(layoutPnpm(REGISTRY, dup.deps, S).entries.some((e) => e.tags.includes('duplicate'))).toBe(false);
  });
});

describe('lock-файл и integrity', () => {
  const lock = JSON.parse(LOCK_CODE) as {
    lockfileVersion: number;
    packages: Record<string, { version: string; integrity?: string }>;
  };

  it('ключи lock-файла — это раскладка сценария «две копии»', () => {
    const dup = SCENARIOS.find((s) => s.id === 'dup')!;
    const fromLock = Object.entries(lock.packages)
      .filter(([path]) => path !== '')
      .map(([path, p]) => `${path} ${p.version}`)
      .sort();
    expect(fromLock).toEqual(layoutNpm(REGISTRY, dup.deps, S).entries.map(formatEntry).sort());
    expect(lock.lockfileVersion).toBe(3);
  });

  const dir = mkdtempSync(join(tmpdir(), 'pm-integrity-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('integrity тарбола, посчитанный кодом темы, совпадает с lock-файлом и с npm pack', () => {
    // Тот же исходник, из которого собран c@2.1.0 учебного реестра.
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'c', version: '2.1.0', main: 'index.js' }, null, 2));
    writeFileSync(join(dir, 'index.js'), 'module.exports = "c@2.1.0";\n');
    const out = execFileSync('npm', ['pack', '--json', '--pack-destination', dir], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false' },
    });
    const packed = JSON.parse(out)[0] as { filename: string; integrity: string };

    const integrity = new Function('require', `${INTEGRITY_CODE}\nreturn integrity;`)(
      createRequire(import.meta.url),
    ) as (b: Buffer) => string;
    const mine = integrity(readFileSync(join(dir, packed.filename)));

    expect(mine, 'код темы и npm pack посчитали разный хеш').toBe(packed.integrity);
    expect(
      mine,
      'npm pack собрал другой архив, чем стоит в lock-файле темы. Если сменилась версия npm, ' +
        'перепроверьте детерминизм упаковки — тема утверждает, что повторная упаковка даёт те же байты.',
    ).toBe(lock.packages['node_modules/d/node_modules/c'].integrity);
  });

  it('путь в кеше npm из текста — это sha512 тарбола c@1.5.0 в шестнадцатеричной записи', () => {
    const b64 = lock.packages['node_modules/c'].integrity!.replace(/^sha512-/, '');
    const hex = Buffer.from(b64, 'base64').toString('hex');
    expect(INTEGRITY_NOTE).toContain(`sha512/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 8)}`);
  });
});
