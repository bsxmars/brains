import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ConditionEnv, ExportsPreset, ExportsValue } from '@/widgets/exports-lab/model/types';

/**
 * Данные темы «Публикация npm-пакета: exports, ESM и CJS, типы».
 *
 * Тема написана здесь, 2026-10-02. Ничего не публиковалось: тарболы собраны `npm pack`
 * в каталог стенда, список файлов снят `npm pack --dry-run --json`.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0**, npm 11.6.1, TypeScript **6.0.3**, publint **0.3.25**,
 * `@arethetypeswrong/core` **0.18.5** — всё из `node_modules` проекта, октябрь 2026.
 *
 * Фикстуры — четырнадцать маленьких пакетов (`FIXTURES` ниже), разложенных в
 * `app/node_modules/<имя>/`. Рядом лежит пустой `app/package.json`. Что снято:
 *   — Node: каждый спецификатор из `SPECS` в четырёх режимах — `import.meta.resolve` из `.mjs`,
 *     `require.resolve` из `.cjs`, оба ещё раз с `--conditions=browser`. Абсолютный путь до
 *     `node_modules/` срезан. Это `NODE_TABLE`;
 *   — `import.meta.resolve` файл на диске **не проверяет** (`price-kit/plugins/card.js` дал
 *     адрес `card.js.js`), `require.resolve` проверяет (`MODULE_NOT_FOUND`), настоящий
 *     `import()` того же адреса — `ERR_MODULE_NOT_FOUND`;
 *   — TypeScript: `ts.resolveModuleName` с `moduleResolution` `node16` (режимы ESM и CJS)
 *     и `bundler`; строки трассировки — с `traceResolution`. Это `TS_TABLE`, `TS_CONDITIONS`;
 *     `tsc --noEmit` на `.cts`, импортирующем ESM-пакет, — `TS1479` при `module` `node16` и
 *     `node18`, тишина при `node20` и `nodenext`;
 *   — publint: `publint({ pkgDir, pack: 'npm' })`, коды сообщений и тип (`error`/`warning`/
 *     `suggestion`). attw: `checkPackage(createPackageFromTarballData(<тарбол npm pack>))`,
 *     виды проблем. Это `LINT_TABLE`;
 *   — рантайм: `HAZARD_CODE` и `REQUIRE_ESM_CODE` запущены как есть, вывод — `HAZARD_OUT`,
 *     `REQUIRE_ESM_OUT`;
 *   — тарбол: четыре раскладки одного проекта (`PACK_CASES`), `npm pack --dry-run --json`,
 *     только пути файлов (размеры в байтах зависят от gzip и не закреплены).
 *
 * `RESOLVE_CODE` — учебный резолвер `exports`, переписанный с алгоритма из документации Node
 * и сверенный с исходником самого Node 24.11 (`lib/internal/modules/esm/resolve.js`,
 * `packageExportsResolve`, `resolvePackageTarget`, `patternKeyCompare`). Упрощения: не
 * разбирается `%2e` и прочие экранированные сегменты, нет поля `imports` и устаревших
 * ключей-папок `"./dir/"`. На всех фикстурах и во всех четырёх режимах ответ совпал с Node.
 *
 * Всё перечисленное пересобирает `tests/unit/package-publishing.test.ts`: фикстуры пишутся
 * на диск из `FIXTURES`, Node, TypeScript, publint, attw и `npm pack` спрашиваются заново.
 *
 * Только из документации (запуском не проверялось): версии Node, в которых `require(esm)`
 * включён без флага (20.19 и 22.12), и как npm обходится с `peerDependencies` — это разобрано
 * в «Пакетных менеджерах».
 */

// ─── Фикстуры стенда ───────────────────────────────────────────────────────────────────────

const esm = (f: string) => `export const file = '${f}';\n`;
const cjs = (f: string) => `exports.file = '${f}';\n`;
const DTS = 'export declare const file: string;\n';

export interface Fixture {
  pkg: { name: string; version: string; type?: string; main?: string; exports?: ExportsValue };
  files: Record<string, string>;
}

/** Состояние, которое раздваивается: счётчик вызовов и класс ошибки. */
const DUAL_MJS = `let calls = 0;
export class PriceError extends Error {}
export function formatPrice(n) {
  calls++;
  return n.toFixed(2) + ' ₽';
}
export const stats = () => calls;
`;

const DUAL_CJS = `let calls = 0;
class PriceError extends Error {}
function formatPrice(n) {
  calls++;
  return n.toFixed(2) + ' ₽';
}
module.exports = { PriceError, formatPrice, stats: () => calls };
`;

const DUAL_DTS = `export declare class PriceError extends Error {}
export declare function formatPrice(n: number): string;
export declare const stats: () => number;
`;

export const FIXTURES: Record<string, Fixture> = {
  'price-kit': {
    pkg: {
      name: 'price-kit',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          browser: './dist/browser.js',
          node: { import: './dist/node.js', require: './dist/node.cjs' },
          default: './dist/index.js',
        },
        './utils': './dist/utils.js',
        './plugins/*': './dist/plugins/*.js',
        './plugins/internal/*': null,
        './package.json': './package.json',
      },
    },
    files: {
      'dist/index.js': esm('dist/index.js'),
      'dist/index.d.ts': DTS,
      'dist/browser.js': esm('dist/browser.js'),
      'dist/node.js': esm('dist/node.js'),
      'dist/node.cjs': cjs('dist/node.cjs'),
      'dist/utils.js': esm('dist/utils.js'),
      'dist/utils.d.ts': DTS,
      'dist/plugins/card.js': esm('dist/plugins/card.js'),
      'dist/plugins/card.d.ts': DTS,
      'dist/plugins/internal/secret.js': esm('dist/plugins/internal/secret.js'),
      'dist/secret.js': esm('dist/secret.js'),
    },
  },
  'esm-only': {
    pkg: { name: 'esm-only', version: '1.0.0', type: 'module', exports: { '.': './dist/index.js', './package.json': './package.json' } },
    files: { 'dist/index.js': esm('dist/index.js'), 'dist/index.d.ts': DTS, 'dist/internal.js': esm('dist/internal.js') },
  },
  'dual-kit': {
    pkg: {
      name: 'dual-kit',
      version: '1.0.0',
      exports: {
        '.': {
          import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
          require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
        },
      },
    },
    files: { 'dist/index.mjs': DUAL_MJS, 'dist/index.cjs': DUAL_CJS, 'dist/index.d.mts': DUAL_DTS, 'dist/index.d.cts': DUAL_DTS },
  },
  'order-kit': {
    pkg: {
      name: 'order-kit',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { default: './dist/index.js', node: './dist/node.js', types: './dist/index.d.ts' } },
    },
    files: { 'dist/index.js': esm('dist/index.js'), 'dist/node.js': esm('dist/node.js'), 'dist/index.d.ts': DTS },
  },
  'types-last': {
    pkg: {
      name: 'types-last',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { import: './dist/index.js', require: './dist/index.cjs', types: './types/index.d.ts' } },
    },
    files: { 'dist/index.js': esm('dist/index.js'), 'dist/index.cjs': cjs('dist/index.cjs'), 'types/index.d.ts': DTS },
  },
  'gap-kit': {
    pkg: { name: 'gap-kit', version: '1.0.0', exports: { '.': { node: './missing.js', default: './index.js' } } },
    files: { 'index.js': cjs('index.js'), 'index.d.ts': DTS },
  },
  'mask-cjs': {
    pkg: {
      name: 'mask-cjs',
      version: '1.0.0',
      exports: { '.': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' } },
    },
    files: { 'index.mjs': esm('index.mjs'), 'index.cjs': cjs('index.cjs'), 'index.d.ts': DTS },
  },
  'mask-esm': {
    pkg: {
      name: 'mask-esm',
      version: '1.0.0',
      type: 'module',
      exports: { '.': { types: './index.d.ts', import: './index.js', require: './index.cjs' } },
    },
    files: { 'index.js': esm('index.js'), 'index.cjs': cjs('index.cjs'), 'index.d.ts': DTS },
  },
  'tla-kit': {
    pkg: { name: 'tla-kit', version: '1.0.0', type: 'module', exports: { '.': './index.js', './sync': './sync.js' } },
    files: {
      'index.js': "const config = await Promise.resolve({ currency: '₽' });\nexport const file = 'index.js';\nexport { config };\n",
      'sync.js': esm('sync.js'),
    },
  },
  'open-kit': {
    pkg: {
      name: 'open-kit',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': './dist/index.js',
        './*': './dist/*.js',
        './feature': ['dist/feature.js', './dist/feature.js'],
        './assets/*': './assets/*',
        './bad': 'dist/a.js',
        './up': '../esm-only/dist/index.js',
      },
    },
    files: {
      'dist/index.js': esm('dist/index.js'),
      'dist/a.js': esm('dist/a.js'),
      'dist/feature.js': esm('dist/feature.js'),
      'dist/deep/b.js': esm('dist/deep/b.js'),
      'assets/logo.svg': '<svg/>\n',
    },
  },
  'mixed-kit': {
    pkg: { name: 'mixed-kit', version: '1.0.0', type: 'module', exports: { '.': './index.js', import: './index.js' } },
    files: { 'index.js': esm('index.js') },
  },
  'sync-kit': {
    pkg: { name: 'sync-kit', version: '1.0.0', exports: { '.': { 'module-sync': './index.mjs', default: './index.cjs' } } },
    files: { 'index.mjs': esm('index.mjs'), 'index.cjs': cjs('index.cjs') },
  },
  'notype-kit': {
    pkg: { name: 'notype-kit', version: '1.0.0', main: './index.js' },
    files: { 'index.js': esm('index.js') },
  },
  'legacy-kit': {
    pkg: { name: 'legacy-kit', version: '1.0.0', main: './lib/index.js' },
    files: { 'lib/index.js': cjs('lib/index.js'), 'lib/internal.js': cjs('lib/internal.js') },
  },
};

/** Что спрашивали у Node для каждой фикстуры. */
export const SPECS: Record<string, string[]> = {
  'price-kit': [
    'price-kit',
    'price-kit/utils',
    'price-kit/utils.js',
    'price-kit/plugins/card',
    'price-kit/plugins/card.js',
    'price-kit/plugins/missing',
    'price-kit/plugins/internal/secret',
    'price-kit/plugins/../secret',
    'price-kit/dist/secret.js',
    'price-kit/package.json',
  ],
  'esm-only': ['esm-only', 'esm-only/package.json', 'esm-only/dist/internal.js', 'esm-only/dist/index.js'],
  'dual-kit': ['dual-kit', 'dual-kit/dist/index.cjs'],
  'order-kit': ['order-kit'],
  'types-last': ['types-last'],
  'gap-kit': ['gap-kit'],
  'mask-cjs': ['mask-cjs'],
  'mask-esm': ['mask-esm'],
  'tla-kit': ['tla-kit', 'tla-kit/sync'],
  'open-kit': [
    'open-kit',
    'open-kit/a',
    'open-kit/deep/b',
    'open-kit/index',
    'open-kit/feature',
    'open-kit/assets/logo.svg',
    'open-kit/package.json',
    'open-kit/bad',
    'open-kit/up',
  ],
  'mixed-kit': ['mixed-kit'],
  'sync-kit': ['sync-kit'],
  'notype-kit': ['notype-kit'],
  'legacy-kit': ['legacy-kit', 'legacy-kit/lib/internal.js'],
};

/** Четыре режима, в которых спрашивали Node, и условия, которые Node в них включает. */
export const NODE_MODES = [
  { id: 'import', label: '`import`', flags: [] as string[], conditions: ['node', 'import', 'module-sync'] },
  { id: 'require', label: '`require`', flags: [] as string[], conditions: ['node', 'require', 'module-sync'] },
  { id: 'import-browser', label: '`import` + `browser`', flags: ['--conditions=browser'], conditions: ['node', 'import', 'module-sync', 'browser'] },
  { id: 'require-browser', label: '`require` + `browser`', flags: ['--conditions=browser'], conditions: ['node', 'require', 'module-sync', 'browser'] },
] as const;

// ─── Учебный резолвер ──────────────────────────────────────────────────────────────────────

/**
 * Резолвер `exports` по алгоритму Node. Печатается на странице, исполняется демо и тестом:
 * тест сверяет его с `import.meta.resolve`/`require.resolve` на всех `SPECS` × `NODE_MODES`.
 */
export const RESOLVE_CODE = String.raw`// Поле "exports" по алгоритму Node (PACKAGE_EXPORTS_RESOLVE).
// subpath — "." или "./что-то"; conditions — включённые условия,
// например ['node', 'import']. Условие "default" подходит всегда.
function resolveExports(exports, subpath, conditions) {
  const log = [];
  const fail = (code) => { const e = new Error(code); e.code = code; throw e; };

  // 1. Строка, массив или объект из одних условий — сокращение для { ".": … }.
  let map = exports;
  if (typeof exports === 'string' || Array.isArray(exports)) {
    map = { '.': exports };
  } else {
    const dotted = Object.keys(exports).map((k) => k.startsWith('.'));
    if (dotted.includes(true) && dotted.includes(false)) {
      log.push('в карте смешаны подпути и условия');
      return { file: null, error: 'ERR_INVALID_PACKAGE_CONFIG', log };
    }
    if (!dotted.includes(true)) map = { '.': exports };
  }

  // 2. Ключ, равный подпути целиком. Если такого нет — шаблон с одной «*»:
  //    побеждает самый длинный префикс до «*», а не первый по порядку.
  let key = null, match = null;
  if (Object.hasOwn(map, subpath) && !subpath.includes('*') && !subpath.endsWith('/')) {
    key = subpath;
  } else {
    for (const k of Object.keys(map)) {
      const star = k.indexOf('*');
      if (star === -1 || star !== k.lastIndexOf('*')) continue;
      const prefix = k.slice(0, star), trailer = k.slice(star + 1);
      if (!subpath.startsWith(prefix) || !subpath.endsWith(trailer)) continue;
      if (subpath.length < k.length) continue;
      if (key === null || morePrecise(k, key)) {
        key = k;
        match = subpath.slice(star, subpath.length - trailer.length);
      }
    }
  }
  if (key === null) {
    log.push('ключа для «' + subpath + '» нет');
    return { file: null, error: 'ERR_PACKAGE_PATH_NOT_EXPORTED', log };
  }
  log.push(match === null ? 'ключ «' + key + '»' : 'ключ «' + key + '», * = «' + match + '»');

  // 3. Значение ключа: строка, null, массив или объект условий.
  function target(t) {
    if (typeof t === 'string') {
      // Цель — только внутри пакета: с «./», без «.», «..» и node_modules.
      if (!t.startsWith('./') || badSegment(t.slice(2))) fail('ERR_INVALID_PACKAGE_TARGET');
      if (match === null) return t;
      if (badSegment(match)) fail('ERR_INVALID_MODULE_SPECIFIER');
      return t.replaceAll('*', match);
    }
    if (t === null) {
      log.push('null — путь закрыт');
      return null;
    }
    if (Array.isArray(t)) {
      // Запасные варианты: неверная цель пропускается, ошибки файла нет.
      let last;
      for (const item of t) {
        let r;
        try { r = target(item); } catch (e) {
          if (e.code !== 'ERR_INVALID_PACKAGE_TARGET') throw e;
          log.push(JSON.stringify(item) + ' — неверная цель, следующий');
          last = e;
          continue;
        }
        if (r === undefined) continue;
        if (r === null) { last = null; continue; }
        return r;
      }
      if (t.length === 0 || last === null) return null;
      if (last) throw last;
      return undefined;
    }
    if (typeof t === 'object') {
      const keys = Object.keys(t);
      if (keys.some((k) => String(Number(k)) === k)) fail('ERR_INVALID_PACKAGE_CONFIG');
      // Условия — строго сверху вниз, до первого совпадения.
      for (const k of keys) {
        if (k !== 'default' && !conditions.includes(k)) {
          log.push('«' + k + '» не включено — мимо');
          continue;
        }
        log.push('«' + k + '» подходит — внутрь');
        const r = target(t[k]);
        if (r !== undefined) return r;
        log.push('внутри «' + k + '» ничего не подошло — дальше');
      }
      return undefined;            // ни одно условие не подошло
    }
    fail('ERR_INVALID_PACKAGE_TARGET');
  }

  try {
    const file = target(map[key]);
    if (file == null) return { file: null, error: 'ERR_PACKAGE_PATH_NOT_EXPORTED', log };
    log.push('файл ' + file);
    return { file, error: null, log };
  } catch (e) {
    return { file: null, error: e.code, log };
  }
}

function badSegment(path) {
  return path.split(/[\\/]/).some((s) =>
    s === '.' || s === '..' || s.toLowerCase() === 'node_modules');
}

// Какой шаблон точнее: длиннее часть до «*», при равенстве — длиннее ключ.
function morePrecise(a, b) {
  const baseA = a.indexOf('*') + 1, baseB = b.indexOf('*') + 1;
  if (baseA !== baseB) return baseA > baseB;
  return a.length > b.length;
}

// "pkg/a/b" → ["pkg", "./a/b"]; "@scope/pkg" → ["@scope/pkg", "."].
function splitSpecifier(spec) {
  const parts = spec.split('/');
  const n = spec.startsWith('@') ? 2 : 1;
  const rest = parts.slice(n).join('/');
  return [parts.slice(0, n).join('/'), rest ? './' + rest : '.'];
}`;

/**
 * Ответ Node на каждый спецификатор `SPECS` в четырёх режимах `NODE_MODES` (по порядку).
 * Путь — от `node_modules/`; иначе — код ошибки. Пересобирает тест.
 */
export const NODE_TABLE: Record<string, string[]> = {
  'price-kit': ['price-kit/dist/node.js', 'price-kit/dist/node.cjs', 'price-kit/dist/browser.js', 'price-kit/dist/browser.js'],
  'price-kit/utils': ['price-kit/dist/utils.js', 'price-kit/dist/utils.js', 'price-kit/dist/utils.js', 'price-kit/dist/utils.js'],
  'price-kit/utils.js': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'price-kit/plugins/card': ['price-kit/dist/plugins/card.js', 'price-kit/dist/plugins/card.js', 'price-kit/dist/plugins/card.js', 'price-kit/dist/plugins/card.js'],
  'price-kit/plugins/card.js': ['price-kit/dist/plugins/card.js.js', 'MODULE_NOT_FOUND', 'price-kit/dist/plugins/card.js.js', 'MODULE_NOT_FOUND'],
  'price-kit/plugins/missing': ['price-kit/dist/plugins/missing.js', 'MODULE_NOT_FOUND', 'price-kit/dist/plugins/missing.js', 'MODULE_NOT_FOUND'],
  'price-kit/plugins/internal/secret': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'price-kit/plugins/../secret': ['ERR_INVALID_MODULE_SPECIFIER', 'ERR_INVALID_MODULE_SPECIFIER', 'ERR_INVALID_MODULE_SPECIFIER', 'ERR_INVALID_MODULE_SPECIFIER'],
  'price-kit/dist/secret.js': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'price-kit/package.json': ['price-kit/package.json', 'price-kit/package.json', 'price-kit/package.json', 'price-kit/package.json'],
  'esm-only': ['esm-only/dist/index.js', 'esm-only/dist/index.js', 'esm-only/dist/index.js', 'esm-only/dist/index.js'],
  'esm-only/package.json': ['esm-only/package.json', 'esm-only/package.json', 'esm-only/package.json', 'esm-only/package.json'],
  'esm-only/dist/internal.js': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'esm-only/dist/index.js': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'dual-kit': ['dual-kit/dist/index.mjs', 'dual-kit/dist/index.cjs', 'dual-kit/dist/index.mjs', 'dual-kit/dist/index.cjs'],
  'dual-kit/dist/index.cjs': ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_PACKAGE_PATH_NOT_EXPORTED'],
  'order-kit': ['order-kit/dist/index.js', 'order-kit/dist/index.js', 'order-kit/dist/index.js', 'order-kit/dist/index.js'],
  'types-last': ['types-last/dist/index.js', 'types-last/dist/index.cjs', 'types-last/dist/index.js', 'types-last/dist/index.cjs'],
  'gap-kit': ['gap-kit/missing.js', 'MODULE_NOT_FOUND', 'gap-kit/missing.js', 'MODULE_NOT_FOUND'],
  'mask-cjs': ['mask-cjs/index.mjs', 'mask-cjs/index.cjs', 'mask-cjs/index.mjs', 'mask-cjs/index.cjs'],
  'mask-esm': ['mask-esm/index.js', 'mask-esm/index.cjs', 'mask-esm/index.js', 'mask-esm/index.cjs'],
  'tla-kit': ['tla-kit/index.js', 'tla-kit/index.js', 'tla-kit/index.js', 'tla-kit/index.js'],
  'tla-kit/sync': ['tla-kit/sync.js', 'tla-kit/sync.js', 'tla-kit/sync.js', 'tla-kit/sync.js'],
  'open-kit': ['open-kit/dist/index.js', 'open-kit/dist/index.js', 'open-kit/dist/index.js', 'open-kit/dist/index.js'],
  'open-kit/a': ['open-kit/dist/a.js', 'open-kit/dist/a.js', 'open-kit/dist/a.js', 'open-kit/dist/a.js'],
  'open-kit/deep/b': ['open-kit/dist/deep/b.js', 'open-kit/dist/deep/b.js', 'open-kit/dist/deep/b.js', 'open-kit/dist/deep/b.js'],
  'open-kit/index': ['open-kit/dist/index.js', 'open-kit/dist/index.js', 'open-kit/dist/index.js', 'open-kit/dist/index.js'],
  'open-kit/feature': ['open-kit/dist/feature.js', 'open-kit/dist/feature.js', 'open-kit/dist/feature.js', 'open-kit/dist/feature.js'],
  'open-kit/assets/logo.svg': ['open-kit/assets/logo.svg', 'open-kit/assets/logo.svg', 'open-kit/assets/logo.svg', 'open-kit/assets/logo.svg'],
  'open-kit/package.json': ['open-kit/dist/package.json.js', 'MODULE_NOT_FOUND', 'open-kit/dist/package.json.js', 'MODULE_NOT_FOUND'],
  'open-kit/bad': ['ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET'],
  'open-kit/up': ['ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET', 'ERR_INVALID_PACKAGE_TARGET'],
  'mixed-kit': ['ERR_INVALID_PACKAGE_CONFIG', 'ERR_INVALID_PACKAGE_CONFIG', 'ERR_INVALID_PACKAGE_CONFIG', 'ERR_INVALID_PACKAGE_CONFIG'],
  'sync-kit': ['sync-kit/index.mjs', 'sync-kit/index.mjs', 'sync-kit/index.mjs', 'sync-kit/index.mjs'],
  'notype-kit': ['notype-kit/index.js', 'notype-kit/index.js', 'notype-kit/index.js', 'notype-kit/index.js'],
  'legacy-kit': ['legacy-kit/lib/index.js', 'legacy-kit/lib/index.js', 'legacy-kit/lib/index.js', 'legacy-kit/lib/index.js'],
  'legacy-kit/lib/internal.js': ['legacy-kit/lib/internal.js', 'legacy-kit/lib/internal.js', 'legacy-kit/lib/internal.js', 'legacy-kit/lib/internal.js'],
};

/** Что TypeScript 6.0.3 нашёл для корня каждой фикстуры: `node16` ESM, `node16` CJS, `bundler`. */
export const TS_TABLE: Record<string, (string | null)[]> = {
  'price-kit': ['price-kit/dist/index.d.ts', 'price-kit/dist/index.d.ts', 'price-kit/dist/index.d.ts'],
  'esm-only': ['esm-only/dist/index.d.ts', 'esm-only/dist/index.d.ts', 'esm-only/dist/index.d.ts'],
  'dual-kit': ['dual-kit/dist/index.d.mts', 'dual-kit/dist/index.d.cts', 'dual-kit/dist/index.d.mts'],
  'order-kit': ['order-kit/dist/index.d.ts', 'order-kit/dist/index.d.ts', 'order-kit/dist/index.d.ts'],
  'types-last': ['types-last/types/index.d.ts', 'types-last/types/index.d.ts', 'types-last/types/index.d.ts'],
  'gap-kit': ['gap-kit/index.d.ts', 'gap-kit/index.d.ts', 'gap-kit/index.d.ts'],
  'mask-cjs': ['mask-cjs/index.d.ts', 'mask-cjs/index.d.ts', 'mask-cjs/index.d.ts'],
  'mask-esm': ['mask-esm/index.d.ts', 'mask-esm/index.d.ts', 'mask-esm/index.d.ts'],
  'tla-kit': ['tla-kit/index.js', 'tla-kit/index.js', 'tla-kit/index.js'],
  'open-kit': ['open-kit/dist/index.js', 'open-kit/dist/index.js', 'open-kit/dist/index.js'],
  'mixed-kit': ['mixed-kit/index.js', 'mixed-kit/index.js', 'mixed-kit/index.js'],
  'sync-kit': ['sync-kit/index.cjs', 'sync-kit/index.cjs', 'sync-kit/index.cjs'],
  'notype-kit': ['notype-kit/index.js', 'notype-kit/index.js', 'notype-kit/index.js'],
  'legacy-kit': ['legacy-kit/lib/index.js', 'legacy-kit/lib/index.js', 'legacy-kit/lib/index.js'],
};

/** Строки трассировки TypeScript: какие условия он включает в каждом режиме. */
export const TS_CONDITIONS = [
  { k: '`node16`, файл-ESM', v: "Resolving in ESM mode with conditions 'import', 'types', 'node'." },
  { k: '`node16`, файл-CJS', v: "Resolving in CJS mode with conditions 'require', 'types', 'node'." },
  { k: '`bundler`', v: "Resolving in CJS mode with conditions 'import', 'types'." },
];

/** Что сказали publint 0.3.25 и attw 0.18.5 о каждой фикстуре. `null` у attw — типов нет. */
export const LINT_TABLE: Record<string, { publint: string[]; attw: string[] | null }> = {
  'price-kit': { publint: ['suggestion:USE_ENGINES_NODE', 'suggestion:USE_SIDE_EFFECTS'], attw: ['NoResolution:node10', 'FalseESM', 'CJSResolvesToESM:node16-cjs'] },
  'esm-only': { publint: [], attw: ['NoResolution:node10', 'CJSResolvesToESM:node16-cjs'] },
  'dual-kit': { publint: ['suggestion:USE_TYPE', 'suggestion:USE_ENGINES_NODE'], attw: ['NoResolution:node10'] },
  'order-kit': { publint: ['suggestion:USE_ENGINES_NODE', 'error:EXPORTS_TYPES_SHOULD_BE_FIRST', 'error:EXPORTS_DEFAULT_SHOULD_BE_LAST'], attw: ['NoResolution:node10', 'CJSResolvesToESM:node16-cjs'] },
  'types-last': { publint: ['suggestion:USE_ENGINES_NODE', 'error:EXPORTS_TYPES_SHOULD_BE_FIRST'], attw: ['NoResolution:node10', 'FallbackCondition:node16-cjs', 'FalseESM', 'FallbackCondition:node16-esm', 'FallbackCondition:bundler'] },
  'gap-kit': { publint: ['suggestion:USE_TYPE', 'suggestion:USE_ENGINES_NODE', 'error:FILE_DOES_NOT_EXIST'], attw: ['FallbackCondition:node16-cjs', 'FallbackCondition:node16-esm'] },
  'mask-cjs': { publint: ['suggestion:USE_TYPE', 'suggestion:USE_ENGINES_NODE', 'warning:EXPORTS_TYPES_INVALID_FORMAT'], attw: ['FalseCJS'] },
  'mask-esm': { publint: ['suggestion:USE_ENGINES_NODE', 'warning:EXPORTS_TYPES_INVALID_FORMAT'], attw: ['FalseESM'] },
  'tla-kit': { publint: [], attw: null },
  'open-kit': { publint: ['warning:EXPORTS_FALLBACK_ARRAY_USE', 'error:EXPORTS_VALUE_INVALID', 'error:EXPORTS_VALUE_INVALID', 'error:EXPORTS_VALUE_INVALID', 'error:FILE_NOT_PUBLISHED'], attw: null },
  'mixed-kit': { publint: [], attw: null },
  'sync-kit': { publint: ['suggestion:USE_TYPE'], attw: null },
  'notype-kit': { publint: ['suggestion:USE_TYPE', 'warning:FILE_INVALID_FORMAT', 'suggestion:HAS_ESM_MAIN_BUT_NO_EXPORTS', 'warning:FILE_INVALID_FORMAT'], attw: null },
  'legacy-kit': { publint: ['suggestion:USE_TYPE', 'suggestion:USE_ENGINES_NODE'], attw: null },
};

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '`exports`',
    d: 'Поле `package.json`: карта «подпуть → файл». Всё, чего в карте нет, снаружи пакета недоступно, даже если файл лежит в архиве.',
  },
  {
    k: 'подпуть (subpath)',
    d: 'Часть спецификатора после имени пакета, с точкой впереди: `price-kit/utils` → `./utils`. Сам `price-kit` — подпуть `.`.',
  },
  {
    k: 'условие (condition)',
    d: 'Ключ внутри карты: `import`, `require`, `types`, `browser`, `node`, `default`. Каждая среда включает свой набор условий, и резолвер берёт первое включённое сверху.',
  },
  {
    k: 'тарбол',
    d: 'Архив `.tgz`, который `npm publish` отправляет в реестр, а `npm install` распаковывает у пользователя. Чего в архиве нет, того у пользователя нет.',
  },
  {
    k: 'двойной пакет (dual package)',
    d: 'Пакет, в котором один и тот же код лежит в двух форматах: ESM для `import` и CommonJS для `require`.',
  },
  {
    k: '`.d.ts`, `.d.mts`, `.d.cts`',
    d: 'Файлы объявлений: только типы, без кода. Буква в расширении говорит TypeScript, какой формат у JS-файла рядом: `m` — ESM, `c` — CommonJS.',
  },
  {
    k: 'publint и attw',
    d: 'Два линтера пакета. publint проверяет `package.json` и файлы архива. attw (Are the Types Wrong) смотрит глазами TypeScript и сверяет найденные типы с найденным кодом.',
  },
];

export const PLAIN_EXPORTS =
  'Как стойка администратора в бизнес-центре. Посетитель называет компанию — это подпуть. Администратор читает список сверху вниз и отправляет в первую подходящую дверь, глядя, кто пришёл: курьер, гость, сотрудник — это условия. Компании нет в списке — посетителя не пустят, даже если дверь в конце коридора существует.';

export const PREREQ_NOTE =
  'Тема опирается на три темы сайта и на одно понятие, которое объяснено прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'ESM и CommonJS',
    d: '`import` и `require` — два разных механизма загрузки. ESM связывает модули до запуска, CommonJS исполняет файл в момент вызова `require`. Там же — как они стыкуются и откуда берётся двойной `default`.',
    href: '/tooling/modules/#s3',
    hrefLabel: '«Модули и сборка», раздел «CommonJS против ESM»',
    tone: 'info',
  },
  {
    t: 'Диапазоны версий',
    d: '`^1.2.0` в зависимостях — не версия, а условие на неё: менеджер ставит старшую подходящую. Как работают `^` и `~` и почему версии `0.x` — особый случай.',
    href: '/tooling/package-managers/#s1',
    hrefLabel: '«Пакетные менеджеры», раздел «Semver и диапазоны»',
    tone: 'info',
  },
  {
    t: 'Побочные эффекты модуля',
    d: 'Сборщик включает в бандл только то, до чего дотянулся от точки входа, и может выбросить модуль без эффектов целиком. Поле `sideEffects` в `package.json` — обещание автора пакета, что так можно.',
    href: '/tooling/bundler-internals/#s2',
    hrefLabel: '«Бандлер изнутри», раздел «Что выживает»',
    tone: 'info',
  },
  {
    t: 'Файл объявлений',
    d: 'Библиотеку публикуют уже скомпилированной в JavaScript. Типы кладут рядом, в файлы `.d.ts`: в них только сигнатуры, кода нет. Их читает редактор и `tsc` у того, кто подключил пакет.',
    tone: 'info',
  },
];

// ─── Раздел 1. Поле exports ────────────────────────────────────────────────────────────────

/** `package.json` сквозного примера — ровно тот, что лежит в фикстуре. */
export const PRICE_PKG_JSON = JSON.stringify(FIXTURES['price-kit'].pkg, null, 2);

export const RESOLVE_STEPS = [
  {
    k: '1. Сокращения',
    d: 'Строка `"exports": "./index.js"` и объект из одних условий — это карта для единственного подпути `.`. Смешать в одном объекте подпути (`"./utils"`) и условия (`"import"`) нельзя: Node отвечает `ERR_INVALID_PACKAGE_CONFIG` на любой импорт пакета.',
  },
  {
    k: '2. Ключ, потом шаблон',
    d: 'Сначала ищется ключ, равный подпути. Нет такого — шаблоны с `*`. Из подходящих побеждает шаблон с более длинной частью до звёздочки: `./plugins/internal/*` сильнее `./plugins/*`, где бы они ни стояли в карте. Звёздочка ловит любой хвост, со слешами тоже.',
  },
  {
    k: '3. Условия по порядку',
    d: 'Значение-объект — это условия. Резолвер идёт по ключам **в том порядке, в каком они записаны**, и входит в первый, который включён в среде. `default` включён всегда. Если внутри вложенного объекта ничего не подошло, резолвер выходит и пробует следующий ключ.',
  },
  {
    k: '4. Забор',
    d: '`null` закрывает путь явно. Подпуть без ключа и путь, закрытый `null`, дают одну ошибку — `ERR_PACKAGE_PATH_NOT_EXPORTED`. Цель обязана начинаться с `./` и не выходить из пакета: `dist/a.js` и `../other/x.js` — это `ERR_INVALID_PACKAGE_TARGET`.',
  },
];

const short = (cell: string) => (cell.startsWith('ERR') || cell === 'MODULE_NOT_FOUND' ? `\`${cell}\`` : `\`${cell.replace(/^[^/]+\//, '')}\``);

/** Таблица для `price-kit`: из `NODE_TABLE`, столбцы `import`, `require`, `import` с `browser`. */
export const NODE_ROWS = SPECS['price-kit'].map((spec) => {
  const [imp, req, br] = NODE_TABLE[spec];
  return { spec: `\`${spec}\``, imp: short(imp), req: short(req), br: short(br) };
});

export const NODE_NOTE =
  'Три строки таблицы удивляют. `plugins/card.js` с расширением дал `card.js.js`: шаблон подставляет хвост как есть, а `.js` в цели уже написано. `import.meta.resolve` вернул адрес файла, которого нет: он только считает путь по карте, а файл проверяет загрузка — настоящий `import()` того же адреса падает `ERR_MODULE_NOT_FOUND`. `require.resolve` проверяет сразу и отвечает `MODULE_NOT_FOUND`. И `plugins/../secret` не вывел из папки: сегменты `..` и `.` в подставленном куске запрещены — `ERR_INVALID_MODULE_SPECIFIER`.';

/** Среды для демо. Наборы Node и TypeScript сняты стендом, Vite — `defaultClientConditions` 8.3.0. */
export const ENVS: ConditionEnv[] = [
  { id: 'node-import', label: 'Node, import', conditions: ['node', 'import', 'module-sync'], note: 'Node 24 на `import` и `import.meta.resolve`.' },
  { id: 'node-require', label: 'Node, require', conditions: ['node', 'require', 'module-sync'], note: 'Node 24 на `require` и `require.resolve`.' },
  {
    id: 'ts',
    label: 'TypeScript',
    conditions: ['import', 'types', 'node'],
    note: 'TypeScript с `moduleResolution: node16`, файл-ESM. Резолвер отвечает по правилам Node; TypeScript сверх того ищет `.d.ts` рядом с найденным JS и, если объявлений нет, идёт к следующему условию.',
  },
  {
    id: 'vite',
    label: 'Vite, браузер',
    conditions: ['module', 'browser', 'development', 'import'],
    note: 'Клиентская сборка Vite 8 в режиме разработки: `module`, `browser`, `development` и `import` по виду импорта.',
  },
];

/** Условия, которые можно включать и выключать поштучно. `default` включён всегда. */
export const CONDITION_KEYS = ['types', 'import', 'require', 'node', 'browser', 'module-sync', 'module', 'development'];

const preset = (id: string, label: string, note: string): ExportsPreset => ({
  id,
  label,
  name: FIXTURES[id].pkg.name,
  exports: FIXTURES[id].pkg.exports ?? null,
  files: ['package.json', ...Object.keys(FIXTURES[id].files)],
  specifiers: SPECS[id],
  note,
});

export const PRESETS: ExportsPreset[] = [
  preset('price-kit', 'price-kit', 'Сквозной пример: условия для корня, точный подпуть, шаблон с `*` и закрытая `null` папка.'),
  preset('dual-kit', 'двойной', 'Двойной пакет: `import` и `require` ведут в разные файлы, у каждого свои `types`.'),
  preset('order-kit', 'default первым', '`default` стоит первым — проверьте, получит ли хоть одна среда `dist/node.js`.'),
  preset('open-kit', 'открытый ./*', 'Шаблон `./*` открывает всё содержимое `dist/` — и заодно перехватывает `./package.json`.'),
  preset('mixed-kit', 'смешанные ключи', 'Подпуть `.` и условие `import` в одном объекте — Node отвергает такую карту целиком.'),
];

/** Пояснения к ответам демо. Строчная разметка; `{file}` и `{name}` подставляет демо. */
export const DEMO_TEXT: Record<string, string> = {
  ok: 'Резолвер выбрал `{file}`, и файл в пакете есть.',
  MISSING_FILE: 'Резолвер ответил `{file}`, но такого файла в пакете нет: `import.meta.resolve` вернёт этот адрес, а загрузка упадёт `ERR_MODULE_NOT_FOUND`.',
  ERR_PACKAGE_PATH_NOT_EXPORTED: 'Подпуть не экспортирован: ключа для него нет, или он закрыт `null`, или ни одно условие не подошло. Файл в пакете может лежать — снаружи его не достать.',
  ERR_INVALID_PACKAGE_TARGET: 'Цель в карте неверная: она не начинается с `./` или выходит из пакета. Это ошибка автора пакета, а не того, кто импортирует.',
  ERR_INVALID_MODULE_SPECIFIER: 'В кусок, который подставляется вместо `*`, попал сегмент `.` или `..`. Выйти из папки шаблона нельзя.',
  ERR_INVALID_PACKAGE_CONFIG: 'Карта сломана целиком: в одном объекте смешаны подпути и условия (или ключ-число). Node откажет на любой импорт пакета.',
  BAD_JSON: 'Карта не разбирается как JSON — проверьте кавычки и запятые.',
  OTHER_PACKAGE: 'Спецификатор начинается не с `{name}` — до карты этого пакета дело не дойдёт.',
  TS_HINT: 'TypeScript сверх этого поищет объявления рядом: `{file}`. Нет их — пойдёт к следующему условию, чего Node не делает.',
};

export const DEMO_CAPTION =
  'Файл выбирает `resolveExports` из листинга выше — та же строка, что на странице; тест сверяет её с Node 24 на всех пакетах стенда в четырёх режимах. Есть ли выбранный файл в пакете, демо смотрит по списку файлов фикстуры: так поступает загрузка, когда резолвер уже ответил. Попробуйте в `price-kit` поднять `default` на первое место — и все среды получат один и тот же файл.';

// ─── Раздел 2. Условия: кто какие включает ─────────────────────────────────────────────────

export const ENV_ROWS = [
  { k: 'Node, `import`', v: '`node`, `import`, `module-sync`, `default`' },
  { k: 'Node, `require`', v: '`node`, `require`, `module-sync`, `default`' },
  { k: 'Node, `--conditions=browser`', v: 'то же плюс `browser`' },
  { k: 'TypeScript `node16`, файл-ESM', v: '`import`, `types`, `node`, `default`' },
  { k: 'TypeScript `node16`, файл-CJS', v: '`require`, `types`, `node`, `default`' },
  { k: 'TypeScript `bundler`', v: '`import`, `types`, `default`' },
  { k: 'Vite 8, клиент', v: '`module`, `browser`, `development` или `production`, `import` или `require` по виду импорта, `default`' },
];

export const ENV_NOTE =
  'Наборы пересекаются меньше, чем кажется. `types` включает только TypeScript. `browser` — только сборщик для браузера или Node с флагом. `node` TypeScript включает в `node16`, а в `bundler` — нет. Полная таблица того, что Node **не** включает (`module`, `development`, `production`), и как `NODE_ENV` на это не влияет, — в [«Модулях и сборке»](/tooling/modules/#s3).';

export const ORDER_PKG_JSON = JSON.stringify({ exports: FIXTURES['order-kit'].pkg.exports }, null, 2);

export const ORDER_NOTE =
  '`default` стоит первым, а он включён всегда, — до `node` резолвер не доходит ни в одной среде. Node и на `import`, и на `require` вернул `dist/index.js`. Ошибки нет, файл просто не тот, и заметит это только тот, кто ждал от `node.js` чего-то особого. publint отмечает обе беды этой карты как ошибки: `EXPORTS_DEFAULT_SHOULD_BE_LAST` и `EXPORTS_TYPES_SHOULD_BE_FIRST`.';

export const GAP_PKG_JSON = JSON.stringify({ exports: FIXTURES['gap-kit'].pkg.exports }, null, 2);

export const GAP_FACTS = [
  {
    t: 'Node в условие входит и не возвращается',
    d: 'У `gap-kit` под `node` указан файл, которого в пакете нет. Ниже стоит рабочий `default`, но Node до него не доходит: условие `node` совпало, путь посчитан, а загрузка падает `ERR_MODULE_NOT_FOUND` (`require` — `MODULE_NOT_FOUND`). Наличие файла резолвер не проверяет.',
    tone: 'err' as const,
  },
  {
    t: 'TypeScript возвращается',
    d: 'TypeScript на том же пакете нашёл `index.d.ts`: не нашёл объявлений под `node` — записал «Failed to resolve under condition» и пошёл к `default`. Карта, которую понимает TypeScript, в Node может падать. attw называет это `FallbackCondition`, publint — `FILE_DOES_NOT_EXIST`.',
    tone: 'warn' as const,
  },
  {
    t: 'Смешанные ключи молчат везде, кроме Node',
    d: '`mixed-kit` положил в один объект подпуть `"."` и условие `"import"`. Node отказал на любом импорте — `ERR_INVALID_PACKAGE_CONFIG`. TypeScript нашёл `index.js`, publint промолчал. Узнать о такой карте можно, только подключив пакет в Node.',
    tone: 'err' as const,
  },
];

// ─── Раздел 3. ESM и CommonJS в одном пакете ───────────────────────────────────────────────

export const FORMAT_ROWS = [
  { k: '`.mjs`', v: 'ESM всегда', tone: undefined },
  { k: '`.cjs`', v: 'CommonJS всегда', tone: undefined },
  { k: '`.js`, `"type": "module"`', v: 'ESM', tone: undefined },
  { k: '`.js`, `"type": "commonjs"`', v: 'CommonJS', tone: undefined },
  {
    k: '`.js` без `type`',
    v: 'CommonJS. Если в файле синтаксис ESM, Node 24 распознаёт его и грузит как ESM: `notype-kit` загрузился и через `import`, и через `require`. publint просит записать `type` явно (`USE_TYPE`), а на `notype-kit` выдал `FILE_INVALID_FORMAT`',
    tone: 'warn' as const,
  },
];

export const FORMAT_NOTE =
  '`type` берётся из ближайшего `package.json` вверх по каталогам — того, что в корне пакета. То же правило TypeScript применяет к `.d.ts`: в пакете с `"type": "module"` файл `index.d.ts` описывает ESM, без `type` — CommonJS. Это пригодится в разделе про типы.';

export const REQUIRE_ESM_CODE = `// app/check.cjs — обычный CommonJS-файл
console.log(process.features.require_module);

const m = require('esm-only');           // пакет только с ESM
console.log(Object.keys(m), m[Symbol.toStringTag]);

try {
  require('tla-kit');                    // в нём await на верхнем уровне
} catch (e) {
  console.log(e.code);
}

console.log(require('tla-kit/sync').file);`;

export const REQUIRE_ESM_OUT = `true
[ 'file' ] Module
ERR_REQUIRE_ASYNC_MODULE
sync.js`;

/** Два модуля для карточки про `default`: тест грузит их через `require` и сверяет ответ. */
export const REQUIRE_DEFAULT_CODE = `// def.mjs
export default function fmt(n) { return n + ' ₽'; }
// require('./def.mjs') → { __esModule: true, default: [Function: fmt] }

// whole.mjs
function fmt(n) { return n + ' ₽'; }
export default fmt;
export { fmt as 'module.exports' };
// require('./whole.mjs') → [Function: fmt]`;

export const REQUIRE_ESM_FACTS = [
  {
    t: '`require` грузит ESM',
    d: 'В Node 24 `require()` загружает ESM-граф синхронно и возвращает namespace — тот же объект, что дал бы `import * as m`. Включено ли это, говорит `process.features.require_module`. По документации Node без флага так работает с 20.19 и 22.12, а более старый Node на `require` ESM-пакета падает.',
    tone: 'ok' as const,
  },
  {
    t: '`await` на верхнем уровне — отказ',
    d: 'Синхронно дождаться промиса нельзя, поэтому граф с `await` на верхнем уровне даёт `ERR_REQUIRE_ASYNC_MODULE`. Считается весь граф, а не один файл, — подробно в [«Модулях и сборке»](/tooling/modules/#s3). Для автора пакета вывод простой: `await` в точке входа отнимает у пакета `require`. Подпуть без него (`tla-kit/sync`) при этом работает.',
    tone: 'err' as const,
  },
  {
    t: '`default` приходит обёрткой',
    d: 'Модуль с `export default` отдаёт через `require` объект `{ __esModule: true, default }`, и функцию приходится доставать через `.default`. Если модуль экспортирует имя-строку `"module.exports"`, `require` вернёт ровно это значение — функцию, а не обёртку.',
    tone: 'warn' as const,
  },
  {
    t: 'Условие `module-sync`',
    d: 'Node включает его и на `import`, и на `require`: «здесь ESM без `await` наверху, его можно грузить синхронно». `sync-kit` (`module-sync` → `index.mjs`, `default` → `index.cjs`) в Node 24 отдал `index.mjs` обоим. TypeScript этого условия не включает и видит `index.cjs`.',
  },
];

export const DUAL_PKG_JSON = JSON.stringify({ exports: FIXTURES['dual-kit'].pkg.exports }, null, 2);

export const DUAL_MJS_CODE = DUAL_MJS.trimEnd();

/** Запускается тестом из каталога фикстур как `hazard.mjs`. */
export const HAZARD_CODE = `// app/hazard.mjs
import { createRequire } from 'node:module';
import { formatPrice, stats, PriceError } from 'dual-kit';

const require = createRequire(import.meta.url);
const cjs = require('dual-kit');   // так пакет подключит любая CJS-зависимость

formatPrice(100);
formatPrice(250);
cjs.formatPrice(990);

console.log(stats(), cjs.stats());
console.log(formatPrice === cjs.formatPrice);
console.log(new cjs.PriceError('x') instanceof PriceError);`;

export const HAZARD_OUT = `2 1
false
false`;

export const PLAIN_HAZARD =
  'Как два одинаковых блокнота для записи гостей у двух входов в зал. Каждый вахтёр честно отмечает своих, но ни один не знает, сколько гостей на самом деле, а гость из одного списка для второго вахтёра — посторонний.';

export const HAZARD_NOTE =
  'Версия одна, `package.json` один, а модулей два: `index.mjs` и `index.cjs` исполнились по отдельности, и у каждого свой счётчик. Ошибку из CJS-копии проверка `e instanceof PriceError` в ESM-коде не узнает. В приложении это случается само: ваш код импортирует пакет, а одна из зависимостей его `require`-ит. Чем это грозит синглтонам и контекстам и какие есть лекарства — в [«Модулях и сборке»](/tooling/modules/#s3).';

export const DUAL_CHOICE =
  '**Что выбрать сейчас.** Если пакету не нужен Node старше 20.19 и 22.12, проще всего публиковать **только ESM** и без `await` в точке входа. Тогда `import` и `require` получают один и тот же файл и двойной загрузки нет: `esm-only` в Node 24 отдал `dist/index.js` в обоих режимах. Нужен старый Node — остаётся двойной пакет, но состояние держат в одном CommonJS-файле, который подключают обе сборки. Требование к Node записывают в `engines`, и его повышение — ломающее изменение.';

// ─── Раздел 4. Типы: что видит TypeScript ──────────────────────────────────────────────────

export const TYPES_RULES = [
  {
    t: '`types` — первым',
    d: 'Условие `types` включает только TypeScript. Если оно стоит ниже `import`, TypeScript сначала войдёт в `import` и будет искать объявления рядом с JS-файлом. Повезёт, если там пусто и он пойдёт дальше. Не повезёт, если там лежит старый `.d.ts` от прошлой сборки: возьмётся он.',
  },
  {
    t: 'Объявления рядом с JS',
    d: 'Цель без `types` TypeScript превращает в путь к объявлениям: `index.js` → `index.d.ts`, `index.mjs` → `index.d.mts`, `index.cjs` → `index.d.cts`. Трассировка `types-last` показывает это построчно.',
  },
  {
    t: 'Формат по расширению',
    d: '`.d.ts` наследует формат от `type`, как `.js`. `.d.mts` всегда описывает ESM, `.d.cts` — CommonJS. Значит, один `.d.ts` на два JS-формата врёт как минимум для одного из них.',
  },
  {
    t: 'Два набора для двух форматов',
    d: 'Правильная форма для двойного пакета — `types` внутри `import` и внутри `require`, у каждого своё расширение. Так устроен `dual-kit`: TypeScript в режиме ESM нашёл `index.d.mts`, в режиме CJS — `index.d.cts`.',
  },
];

export const TYPES_LAST_PKG_JSON = JSON.stringify({ exports: FIXTURES['types-last'].pkg.exports }, null, 2);

/** Строки из `traceResolution` TypeScript 6.0.3 для `types-last` в режиме ESM. Тест ищет каждую. */
export const TYPES_LAST_TRACE = `Resolving in ESM mode with conditions 'import', 'types', 'node'.
Matched 'exports' condition 'import'.
Using 'exports' subpath '.' with target './dist/index.js'.
File name 'types-last/dist/index.js' has a '.js' extension - stripping it.
File 'types-last/dist/index.ts' does not exist.
File 'types-last/dist/index.tsx' does not exist.
File 'types-last/dist/index.d.ts' does not exist.
Failed to resolve under condition 'import'.
Saw non-matching condition 'require'.
Matched 'exports' condition 'types'.
File 'types-last/types/index.d.ts' exists - use it as a name resolution result.`;

const TS_FIXTURES = ['price-kit', 'dual-kit', 'types-last', 'gap-kit', 'mask-cjs', 'mask-esm', 'sync-kit', 'mixed-kit'];

export const TS_ROWS = TS_FIXTURES.map((id) => {
  const cell = (v: string | null) => (v ? `\`${v.replace(/^[^/]+\//, '')}\`` : 'не найден');
  const [esmCell, cjsCell, bundler] = TS_TABLE[id];
  return { k: `\`${id}\``, esm: cell(esmCell), cjs: cell(cjsCell), bundler: cell(bundler) };
});

export const PLAIN_MASQUERADE =
  'Как этикетка на банке. В банке варенье — ESM, а на этикетке написано «огурцы» — CommonJS. Пока банку не открыли, всё хорошо: TypeScript верит этикетке и пропускает код, который при запуске поведёт себя иначе.';

export const MASK_ROWS = [
  {
    k: '`mask-cjs`',
    how: 'без `type`; один `index.d.ts` на `index.mjs` и `index.cjs`',
    attw: '`FalseCJS` — «Masquerading as CJS»: типы описывают CommonJS, а `import` получает ESM',
    tone: 'err' as const,
  },
  {
    k: '`mask-esm`',
    how: '`"type": "module"`; один `index.d.ts` на `index.js` и `index.cjs`',
    attw: '`FalseESM` — «Masquerading as ESM»: типы описывают ESM, а `require` получает CommonJS',
    tone: 'err' as const,
  },
  {
    k: '`price-kit`',
    how: '`types` наверху, а под `node` → `require` лежит `node.cjs`',
    attw: '`FalseESM`: тот же маскарад. publint его **не** заметил',
    tone: 'err' as const,
  },
  {
    k: '`types-last`',
    how: '`types` последним',
    attw: '`FallbackCondition` в трёх режимах и `FalseESM`',
    tone: 'warn' as const,
  },
  {
    k: '`dual-kit`',
    how: '`types` внутри `import` и `require`, `.d.mts` и `.d.cts`',
    attw: 'только `NoResolution` для `node10` — старого режима без `exports`',
    tone: 'ok' as const,
  },
];

export const LINT_NOTE =
  'publint и attw смотрят на пакет с разных сторон, и на стенде каждый поймал то, что пропустил другой. publint читает `package.json` и список файлов архива: порядок условий, неверные пути, файлы, которых нет (`gap-kit` — `FILE_DOES_NOT_EXIST`). attw строит программу TypeScript в четырёх режимах и сверяет найденные типы с найденным кодом — только он увидел маскарад у `price-kit`. А про `mixed-kit`, который Node отвергает целиком, промолчали оба.';

export const TS_REQUIRE_NOTE =
  'И отдельно про `require(esm)`. TypeScript 6.0.3 на `.cts`-файле, который импортирует `esm-only`, с `module: node16` и `node18` выдаёт `TS1479` — «CommonJS не может `require` ESM». С `node20` и `nodenext` ошибки нет: эти режимы знают, что Node так умеет. attw судит по правилам `node16` — отсюда его `CJSResolvesToESM` («ESM, только динамический импорт») на пакете, который в Node 24 через `require` работает.';

// ─── Раздел 5. Что уедет в тарбол ──────────────────────────────────────────────────────────

/** Один проект в четырёх раскладках. Тест пишет его на диск и спрашивает `npm pack --dry-run --json`. */
export const PACK_PROJECT: Record<string, string> = {
  'src/index.ts': 'export const a = 1;\n',
  'dist/index.js': 'export const a = 1;\n',
  'dist/index.d.ts': 'export declare const a: number;\n',
  'test/index.test.ts': "import { a } from '../src/index';\n",
  'README.md': '# kit\n',
  LICENSE: 'MIT\n',
  'tsconfig.json': '{}\n',
  '.env': 'TOKEN=secret\n',
  '.npmrc': '//registry.npmjs.org/:_authToken=secret\n',
};

export const PACK_TREE = `kit/
├── package.json        "exports": "./dist/index.js"
├── src/index.ts
├── dist/index.js
├── dist/index.d.ts
├── test/index.test.ts
├── README.md
├── LICENSE
├── tsconfig.json
├── .env                TOKEN=secret
└── .npmrc              токен реестра`;

export const PACK_CASES: {
  id: string;
  label: string;
  files?: string[];
  gitignore?: string;
  npmignore?: string;
  got: string[];
  verdict: string;
  tone: 'ok' | 'warn' | 'err';
}[] = [
  {
    id: 'a',
    label: 'ничего не настроено',
    got: ['.env', 'LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json', 'src/index.ts', 'test/index.test.ts', 'tsconfig.json'],
    verdict: 'Уехало всё, включая `.env` с секретом. `.npmrc` npm выбросил сам',
    tone: 'err',
  },
  {
    id: 'b',
    label: '`"files": ["dist"]`',
    files: ['dist'],
    got: ['LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json'],
    verdict: 'Только `dist` и три файла, которые npm кладёт всегда',
    tone: 'ok',
  },
  {
    id: 'c',
    label: '`.gitignore`: `dist/`, `.env`',
    gitignore: 'dist/\n.env\n',
    got: ['LICENSE', 'README.md', 'package.json', 'src/index.ts', 'test/index.test.ts', 'tsconfig.json'],
    verdict: 'Без `.npmignore` npm читает `.gitignore` — и собранного кода в пакете нет',
    tone: 'err',
  },
  {
    id: 'd',
    label: 'тот же `.gitignore` и `.npmignore`: `src/`, `test/`',
    gitignore: 'dist/\n.env\n',
    npmignore: 'src/\ntest/\n',
    got: ['.env', 'LICENSE', 'README.md', 'dist/index.d.ts', 'dist/index.js', 'package.json', 'tsconfig.json'],
    verdict: '`.npmignore` заменил `.gitignore` целиком: `dist` вернулся, а с ним и `.env`',
    tone: 'err',
  },
];

export const PACK_ROWS = PACK_CASES.map((c) => ({
  label: c.label,
  got: c.got.map((f) => `\`${f}\``).join(', '),
  verdict: c.verdict,
  tone: c.tone,
}));

export const PACK_CMD_CODE = `$ npm pack --dry-run --json
[
  {
    "name": "kit",
    "files": [
      { "path": "LICENSE", … },
      { "path": "README.md", … },
      { "path": "dist/index.d.ts", … },
      …
    ],
    "entryCount": 5,
    …
  }
]`;

export const PACK_FACTS = [
  {
    t: 'Всегда в архиве',
    d: '`package.json`, `README` и `LICENSE` попадают в архив, даже если `files` их не называет: раскладка с `"files": ["dist"]` их сохранила.',
  },
  {
    t: 'Никогда',
    d: '`.npmrc`, `.git` и `node_modules` npm выбрасывает сам. `.npmrc` с токеном не попал ни в одну из четырёх раскладок. А `.env` в этот список **не входит**.',
    tone: 'warn' as const,
  },
  {
    t: '`files` — белый список',
    d: 'Чёрный список (`.npmignore`) пропускает всё новое, о чём вы не подумали. Белый список (`files`) пропускает только названное. Для пакета, который собирается в `dist`, это почти всегда `"files": ["dist"]`.',
    tone: 'ok' as const,
  },
  {
    t: 'Что заметил publint',
    d: 'На раскладке без `dist` — ошибку `FILE_NOT_PUBLISHED`: `exports` ведёт в файл, которого нет в архиве. На раскладке со всем подряд — подсказку `USE_FILES` про папку `test/`. Про `.env` он не сказал ничего: секреты — не его забота.',
  },
];

export const SIDE_EFFECTS_NOTE =
  'Ещё одно поле для сборщиков — `sideEffects`. Значение `false` обещает: модуль, из которого ничего не взяли, можно выбросить целиком. Если пакет импортирует CSS, пишут массив `["*.css"]`, иначе стили пропадут из бандла. publint на `price-kit` предложил это поле дописать (`USE_SIDE_EFFECTS`). Как сборщик пользуется обещанием и чем оборачивается ложное — в [«Бандлере изнутри»](/tooling/bundler-internals/#s2).';

// ─── Раздел 6. Что ломает версию ───────────────────────────────────────────────────────────

/**
 * Правки карты между версиями. Тест собирает пакет «до» и «после» и спрашивает Node
 * (`mode` — режим из `NODE_MODES`); ответ сверяется с `before`/`after`.
 */
export const BREAK_CASES: {
  change: string;
  spec: string;
  mode: 'import' | 'require' | 'import-browser';
  v1: Fixture['pkg'];
  v2: Fixture['pkg'];
  files: Record<string, string>;
  before: string;
  after: string;
  bump: string;
  tone: 'ok' | 'warn' | 'err';
}[] = [
  {
    change: 'убрали подпуть `./utils`',
    spec: 'semver-kit/utils',
    mode: 'import',
    v1: { name: 'semver-kit', version: '1.0.0', type: 'module', exports: { '.': './index.js', './utils': './utils.js' } },
    v2: { name: 'semver-kit', version: '2.0.0', type: 'module', exports: { '.': './index.js' } },
    files: { 'index.js': esm('index.js'), 'utils.js': esm('utils.js') },
    before: 'semver-kit/utils.js',
    after: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    bump: 'мажор',
    tone: 'err',
  },
  {
    change: 'добавили `exports` пакету, где был только `main`',
    spec: 'semver-kit/lib/internal.js',
    mode: 'require',
    v1: { name: 'semver-kit', version: '1.0.0', main: './lib/index.js' },
    v2: { name: 'semver-kit', version: '2.0.0', main: './lib/index.js', exports: { '.': './lib/index.js' } },
    files: { 'lib/index.js': cjs('lib/index.js'), 'lib/internal.js': cjs('lib/internal.js') },
    before: 'semver-kit/lib/internal.js',
    after: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    bump: 'мажор',
    tone: 'err',
  },
  {
    change: 'убрали условие `require`',
    spec: 'semver-kit',
    mode: 'require',
    v1: { name: 'semver-kit', version: '1.0.0', exports: { '.': { import: './index.mjs', require: './index.cjs' } } },
    v2: { name: 'semver-kit', version: '2.0.0', exports: { '.': { import: './index.mjs' } } },
    files: { 'index.mjs': esm('index.mjs'), 'index.cjs': cjs('index.cjs') },
    before: 'semver-kit/index.cjs',
    after: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    bump: 'мажор',
    tone: 'err',
  },
  {
    change: 'перешли на чистый ESM',
    spec: 'semver-kit',
    mode: 'require',
    v1: { name: 'semver-kit', version: '1.0.0', exports: { '.': { import: './index.mjs', require: './index.cjs' } } },
    v2: { name: 'semver-kit', version: '2.0.0', exports: { '.': './index.mjs' } },
    files: { 'index.mjs': esm('index.mjs'), 'index.cjs': cjs('index.cjs') },
    before: 'semver-kit/index.cjs',
    after: 'semver-kit/index.mjs',
    bump: 'мажор: в Node 24 `require` работает, на старом Node и с `await` наверху — нет',
    tone: 'warn',
  },
  {
    change: 'добавили условие `browser`',
    spec: 'semver-kit',
    mode: 'import-browser',
    v1: { name: 'semver-kit', version: '1.0.0', type: 'module', exports: { '.': { import: './index.js', default: './index.js' } } },
    v2: { name: 'semver-kit', version: '1.1.0', type: 'module', exports: { '.': { browser: './browser.js', import: './index.js', default: './index.js' } } },
    files: { 'index.js': esm('index.js'), 'browser.js': esm('browser.js') },
    before: 'semver-kit/index.js',
    after: 'semver-kit/browser.js',
    bump: 'минор, если файл ведёт себя так же; сборка для браузера получает другой код',
    tone: 'warn',
  },
  {
    change: 'добавили новый подпуть',
    spec: 'semver-kit',
    mode: 'import',
    v1: { name: 'semver-kit', version: '1.0.0', type: 'module', exports: { '.': './index.js' } },
    v2: { name: 'semver-kit', version: '1.1.0', type: 'module', exports: { '.': './index.js', './utils': './utils.js' } },
    files: { 'index.js': esm('index.js'), 'utils.js': esm('utils.js') },
    before: 'semver-kit/index.js',
    after: 'semver-kit/index.js',
    bump: 'минор',
    tone: 'ok',
  },
];

export const BREAK_ROWS = BREAK_CASES.map((c) => {
  const cell = (v: string) => (v.startsWith('ERR') ? `\`${v}\`` : `\`${v.replace(/^semver-kit\//, '')}\``);
  const how = { import: '`import`', require: '`require`', 'import-browser': '`import`, `browser`' }[c.mode];
  return { change: c.change, spec: `\`${c.spec}\` (${how})`, before: cell(c.before), after: cell(c.after), bump: c.bump, tone: c.tone };
});

export const BREAK_NOTE =
  'Ломающим считается всё, после чего у кого-то перестал работать правильный код, — даже если ни одна функция не менялась. Глубокий импорт `lib/internal.js` никто не обещал, но он работал, и `exports` его закрыл: такой переход — мажор, даже когда файлы те же. До 1.0.0 сдвигается всё на разряд: ломающим считается минор, и `^0.2.3` не пустит `0.3.0` (подробно — в [«Пакетных менеджерах»](/tooling/package-managers/#s1)). А `engines` publint предлагает добавлять с пометкой «This may be a breaking change»: поднять минимальную версию Node — тоже мажор.';

export const PEER_NOTE =
  '**`peerDependencies` — тоже API.** Плагин или UI-библиотека не должны тащить свою копию фреймворка: две копии `vue` дают то же раздвоенное состояние, что `dual-kit`. Поэтому фреймворк пишут в `peerDependencies` — его ставит пользователь, одной копией на всех, — и дублируют в `devDependencies` для своих тестов. Сузили диапазон с `^3.3.0` до `^3.5.0` или добавили новую peer-зависимость — у части пользователей установка начнёт ругаться: это мажор. Как менеджеры ставят peer и что делают при конфликте, разобрано в [«Пакетных менеджерах»](/tooling/package-managers/#s4). Соседи по монорепозиторию с `workspace:*` получают настоящие версии при упаковке — это в [«Монорепозитории»](/tooling/monorepo/#s1).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`import.meta.resolve` не проверяет, есть ли файл',
    d: 'Он только считает путь по карте: `price-kit/plugins/missing` дал адрес `missing.js`, которого нет. Падает уже загрузка (`ERR_MODULE_NOT_FOUND`). Проверять пакет «резолвом» мало — нужен настоящий `import` и `require`.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Шаблон с `.js` и спецификатор с `.js` дают `.js.js`',
    d: 'Карта `"./plugins/*": "./dist/plugins/*.js"` подставляет хвост как есть. Пользователь, привыкший писать расширения, получает `card.js.js` и `ERR_MODULE_NOT_FOUND`. Решают одно из двух: либо шаблон без расширения в цели, либо договорённость «подпуть без `.js`» в документации.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`"./*"` перехватывает `./package.json`',
    d: 'В `open-kit` шаблон `"./*": "./dist/*.js"` превратил `open-kit/package.json` в `dist/package.json.js`. Инструменты, которые читают версию пакета через `require("pkg/package.json")`, ломаются. Явный ключ `"./package.json"` сильнее шаблона и чинит это.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`default` не последним глотает всё ниже',
    d: '`default` включён в любой среде. Всё, что стоит под ним, недостижимо: `order-kit` отдаёт один файл и Node, и браузеру. Ошибки нет — просто файл не тот.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Node из условия не возвращается, TypeScript — возвращается',
    d: 'Нет файла под совпавшим условием — Node падает, TypeScript идёт к следующему условию. `gap-kit` типизируется без ошибок и не загружается в Node. Проверка — запуск в Node, а не `tsc`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Смешанная карта: Node падает, остальные молчат',
    d: 'Подпути и условия в одном объекте — `ERR_INVALID_PACKAGE_CONFIG` на любой импорт. TypeScript такую карту понял, publint не заметил.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Двойной пакет — два экземпляра без второй версии',
    d: '`npm ls` покажет одну версию, а `stats()` вернёт `2` и `1`, `instanceof` — `false`. Достаточно, чтобы один модуль импортировал пакет, а другой — `require`-ил.',
    tone: 'err',
  },
  {
    n: '08',
    t: '`.npmignore` отменяет `.gitignore` целиком',
    d: 'Завели `.npmignore`, чтобы убрать `src/`, — и всё, что прятал `.gitignore`, вернулось в архив, вместе с `.env`. Белый список `files` такой ловушки не имеет.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Появление `exports` — ломающее изменение',
    d: 'Пакет без `exports` открыт целиком, и кто-то обязательно импортирует `lib/internal.js`. Первая версия с картой закрывает всё неназванное. Выпускать её минором — значит сломать чужую сборку при обычном `npm update`.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'attw ругает ESM-only, который в Node 24 работает',
    d: '`CJSResolvesToESM` у attw означает «по правилам `node16` из CommonJS этот пакет не подключить». Для Node 24 и TypeScript с `module: node20` это уже не так. Решение за автором: какие Node и какие настройки TypeScript он поддерживает.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Node.js — Modules: Packages',
    href: 'https://nodejs.org/api/packages.html',
    what: '`exports`, условия, шаблоны подпутей, `type`, двойные пакеты; проверено на 24.11.0',
  },
  {
    title: 'Node.js — Resolution algorithm specification',
    href: 'https://nodejs.org/api/esm.html#resolution-algorithm-specification',
    what: 'PACKAGE_EXPORTS_RESOLVE и PACKAGE_TARGET_RESOLVE — алгоритм, по которому написан `resolveExports`',
  },
  {
    title: 'Node.js — исходник резолвера',
    href: 'https://github.com/nodejs/node/blob/v24.11.0/lib/internal/modules/esm/resolve.js',
    what: '`packageExportsResolve`, `resolvePackageTarget`, `patternKeyCompare`',
  },
  {
    title: 'Node.js — Loading ECMAScript modules using require()',
    href: 'https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require',
    what: '`require(esm)`, `ERR_REQUIRE_ASYNC_MODULE`, экспорт `"module.exports"`',
  },
  {
    title: 'TypeScript — Modules reference: package.json "exports"',
    href: 'https://www.typescriptlang.org/docs/handbook/modules/reference.html#packagejson-exports',
    what: 'условия, которые включает TypeScript, и поиск объявлений рядом с JS; версия 6.0.3 на стенде',
  },
  {
    title: 'publint — Rules',
    href: 'https://publint.dev/rules',
    what: 'коды сообщений; версия 0.3.25 на стенде',
  },
  {
    title: 'Are the types wrong? — Problems',
    href: 'https://github.com/arethetypeswrong/arethetypeswrong.github.io/tree/main/docs/problems',
    what: '`FalseCJS`, `FalseESM`, `FallbackCondition`, `CJSResolvesToESM`; `@arethetypeswrong/core` 0.18.5 на стенде',
  },
  {
    title: 'npm — package.json: files',
    href: 'https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files',
    what: 'что попадает в архив всегда, что никогда, `.npmignore` и `.gitignore`',
  },
  {
    title: 'npm — npm pack',
    href: 'https://docs.npmjs.com/cli/v11/commands/npm-pack',
    what: '`--dry-run`, `--json`; npm 11.6.1 на стенде',
  },
  {
    title: 'Semantic Versioning 2.0.0',
    href: 'https://semver.org/',
    what: 'что такое мажор, минор и патч и особый статус `0.x`',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка, раздел «CommonJS против ESM»](/tooling/modules/#s3) — интероп, двойной `default`, таблица условий Node и лекарства от двойного пакета. [Пакетные менеджеры](/tooling/package-managers/#s1) — диапазоны версий, lock-файл и `peerDependencies` со стороны установки. [Монорепозиторий, раздел «Воркспейсы»](/tooling/monorepo/#s1) — соседние пакеты и `workspace:` при публикации. [Бандлер изнутри, раздел «Что выживает»](/tooling/bundler-internals/#s2) — что сборщик делает с `sideEffects`. [Транспиляция и полифилы, раздел «esbuild и tsc»](/tooling/transpilation/#s6) — во что понижать синтаксис библиотеки. [TypeScript на уровне типов](/tooling/typescript/) — язык, на котором написаны `.d.ts`. [Цепочка поставок](/platform/supply-chain/) — скрипты установки, `integrity` в lock-файле, SRI в браузере и путаница зависимостей.';
