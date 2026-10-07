import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  EXTERNAL_CONFIG,
  EXTERNAL_FIRST_LINE,
  EXTERNAL_MAIN,
  IMPORTMAP_FILES,
  IMPORTMAP_LATE_CODE,
  IMPORTMAP_LATE_OUT,
  IMPORTMAP_LATE_WARNING,
  IMPORTMAP_OUT,
  NOMODULE_HTML,
  NOMODULE_REQUESTS,
  PHANTOM_APP,
  PHANTOM_LAYOUTS,
  PHANTOM_PKGS,
  type PhantomLayout,
  WASM_BYTES,
  WASM_ENV,
  WASM_ESM,
  WASM_NODE_OUT,
  WASM_SOURCE,
  WASM_STREAMING,
} from '@/content/tooling/modules/data';
import { COUNTER, READER } from '@/widgets/live-binding/model/run';

/**
 * Утверждения темы «Модули и сборка», закреплённые запуском.
 *
 * Проверяются **те же самые файлы и те же самые строки**, которые видит читатель: пара цикла —
 * это `public/demo/modules/*.js`, которые демо грузит `import()` в браузере, а исходники живого
 * связывания импортированы из модели виджета.
 *
 * ⚠️ **Почему через дочерний процесс, а не прямым `import()` в тесте.** Vitest исполняет модули
 * своим раннером поверх трансформа Vite, а не нативным загрузчиком Node. Для этой темы разница
 * решающая: трансформированный модуль живёт по правилам, близким к CommonJS, и цикл через
 * `const` в нём **не падает** — первая версия теста именно так и «позеленела» на утверждении,
 * которое проверяет обратное. Поэтому всё, что касается семантики загрузчика, снимается
 * в чистом `node`, и это ровно тот же движок, в котором снималось число для страницы.
 */
const FIXTURES = new URL('../../public/demo/modules/', import.meta.url).href;

const dataUrl = (code: string) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

/** Что дочерний процесс печатает обратно — по одному полю на утверждение страницы. */
interface Report {
  constError: string | null;
  constTrace: string[];
  secondTryError: string | null;
  addedOnSecondTry: number;
  fnError: string | null;
  fnTrace: string[];
  live: { before: number[]; after: number[] };
  cjs: number[];
}

const RUNNER = `
const [, , base, readerUrl, dir] = process.argv;
const url = (name) => new URL(name, base).href;
const out = {};

const { trace } = await import(url('trace.js'));

// --- цикл через const ---
out.constError = null;
try { await import(url('a-const.js')); }
catch (error) { out.constError = error.constructor.name + ': ' + error.message; }
out.constTrace = [...trace];

// --- он же второй раз: карта модулей помнит и результат, и исключение ---
const before = trace.length;
out.secondTryError = null;
try { await import(url('a-const.js')); }
catch (error) { out.secondTryError = error.constructor.name + ': ' + error.message; }
out.addedOnSecondTry = trace.length - before;

// --- тот же цикл через объявление функции ---
trace.length = 0;
out.fnError = null;
try { await import(url('a-fn.js')); }
catch (error) { out.fnError = error.constructor.name + ': ' + error.message; }
out.fnTrace = [...trace];

// --- живые привязки: ровно те исходники, что уезжают в blob на странице ---
const reader = await import(readerUrl);
const pick = (r) => [r.binding, r.destructured, r.viaNs, r.viaDefault];
out.live = { before: pick(reader.before), after: pick(reader.bump()) };

// --- то же самое в CommonJS ---
const { createRequire } = await import('node:module');
const require = createRequire(base);
const counter = require(dir + '/counter.cjs');
const cjs = [counter.count];
counter.increment();
cjs.push(counter.count);
out.cjs = cjs;

console.log(JSON.stringify(out));
`;

let report: Report;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'lesson-modules-'));
  const runner = join(dir, 'runner.mjs');
  writeFileSync(runner, RUNNER);
  writeFileSync(
    join(dir, 'counter.cjs'),
    'let count = 0;\nmodule.exports = { count, increment() { count += 1; } };\n',
  );

  const stdout = execFileSync(
    process.execPath,
    [runner, FIXTURES, dataUrl(READER(dataUrl(COUNTER))), dir],
    { encoding: 'utf8' },
  );
  report = JSON.parse(stdout) as Report;
});

describe('цикл: что решает форма объявления', () => {
  it('через const цикл падает — и падает первый по обходу модуль', () => {
    expect(report.constError).toMatch(/^ReferenceError: Cannot access 'aValue' before initialization/);

    // Тело `b` пошло первым и умерло на первой же строке, читающей чужую ячейку.
    // Тело `a` не начиналось вовсе — отсюда и контринтуитивность ошибки.
    expect(report.constTrace).toEqual(['b: тело пошло']);
  });

  it('ошибка запоминается: повторный import() не перевыполняет тело', () => {
    expect(report.secondTryError).toBe(report.constError);
    expect(report.addedOnSecondTry, 'тело модуля выполнилось второй раз').toBe(0);
  });

  it('через function тот же цикл проходит целиком', () => {
    expect(report.fnError).toBeNull();

    // Порядок тел тот же самый — меняется только то, готова ли привязка к моменту обращения.
    expect(report.fnTrace).toEqual([
      'b: тело пошло',
      'b: зову getA() = A',
      'a: тело пошло',
      'a: зову getB() = B',
    ]);
  });
});

describe('живые привязки', () => {
  it('те же исходники, что в демо, дают 1 0 1 0', () => {
    expect(report.live.before).toEqual([0, 0, 0, 0]);
    // Живое — прямой импорт и чтение свойства namespace. Снимки — деструктуризация
    // namespace-объекта и свойство обычного объекта из `export default`.
    expect(report.live.after).toEqual([1, 0, 1, 0]);
  });

  it('в CommonJS та же пара остаётся нулём: копия появилась в теле модуля', () => {
    // `require` вернул тот же объект по ссылке — но в свойстве лежит снимок примитива,
    // положенный туда строкой `module.exports = { count, … }`.
    expect(report.cjs).toEqual([0, 0]);
  });
});

/* ──────────────────────────────────────────────────────────────────────────────────────────
 * Бывшие пункты «за кадром», раскрытые в теме: import maps, WebAssembly, раскладки
 * `node_modules`, легаси-сборка. Исполняются **строки из `data.ts`** — те же, что на странице.
 *
 * Браузерная часть идёт в настоящем Chromium через библиотеку Playwright: страницы отдаются
 * перехватом запросов на выдуманном адресе, сервер не нужен, порт не занимается. Сборка —
 * `vite build` в дочернем процессе, по той же причине, что и выше: раннер Vitest сам стоит
 * на Vite, и сборка внутри его процесса мерила бы не то.
 * ────────────────────────────────────────────────────────────────────────────────────────── */

const node = (args: string[], cwd?: string) =>
  execFileSync(process.execPath, args, { encoding: 'utf8', cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const VITE = new URL('../../node_modules/vite/dist/node/index.js', import.meta.url).href;

/** Собирает папку `root` и печатает JSON: `{ ok, error?, files: { имя: текст } }`. */
const VITE_BUILD = `
const { build } = await import(${JSON.stringify(VITE)});
const root = process.argv[2];
try {
  const out = await build({ root, logLevel: 'silent', build: { minify: false, target: 'esnext' } });
  const o = Array.isArray(out) ? out[0] : out;
  const files = {};
  for (const f of o.output) files[f.fileName] = f.type === 'chunk' ? f.code : typeof f.source === 'string' ? f.source : '';
  console.log(JSON.stringify({ ok: true, files }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e.message) }));
}
`;

function viteBuild(root: string): { ok: boolean; error?: string; files: Record<string, string> } {
  const runner = join(root, '..', `vite-build-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(runner, VITE_BUILD);
  return JSON.parse(node([runner, root]));
}

describe('node_modules: одна пара пакетов в трёх раскладках', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lesson-phantom-'));

  function lay(layout: PhantomLayout): string {
    const dir = join(tmp, layout.key);
    for (const entry of layout.entries) {
      const at = join(dir, entry.path);
      mkdirSync(dirname(at), { recursive: true });
      if ('link' in entry) {
        symlinkSync(entry.link, at);
        continue;
      }
      mkdirSync(at, { recursive: true });
      const [name, version] = entry.pkg === 'a' ? ['a', '1.0.0'] : ['b', entry.pkg === 'b1' ? '1.0.0' : '2.0.0'];
      writeFileSync(join(at, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: './index.js' }));
      writeFileSync(join(at, 'index.js'), PHANTOM_PKGS[entry.pkg]);
    }
    writeFileSync(join(dir, 'main.mjs'), PHANTOM_APP);
    return dir;
  }

  const dirs = Object.fromEntries(PHANTOM_LAYOUTS.map((l) => [l.key, lay(l)]));

  for (const layout of PHANTOM_LAYOUTS) {
    it(`${layout.key}: Node печатает то, что написано под раскладкой`, () => {
      expect(node(['main.mjs'], dirs[layout.key]).trim().split('\n')).toEqual(layout.out);
    });

    it(`${layout.key}: схема на странице называет каждый путь раскладки`, () => {
      // Дерево набрано руками для читаемости — проверка не даёт ему разойтись со стендом.
      for (const entry of layout.entries) {
        const last = entry.path.split('/').pop() ?? '';
        expect(layout.tree, entry.path).toContain(last);
      }
    });
  }

  it('--preserve-symlinks роняет в изолированной раскладке уже сам пакет a', () => {
    expect(() => node(['--preserve-symlinks', '--preserve-symlinks-main', 'main.mjs'], dirs.isolated)).toThrow(
      /ERR_MODULE_NOT_FOUND/,
    );
  });

  it('vite build: фантом в изолированной раскладке не собирается, две версии ложатся обе', () => {
    const main = `import a from 'a'\nimport b from 'b'\nconsole.log(a, b)\n`;
    for (const key of ['isolated', 'nested']) {
      mkdirSync(join(dirs[key], 'src'), { recursive: true });
      writeFileSync(join(dirs[key], 'src', 'main.js'), main);
      writeFileSync(join(dirs[key], 'index.html'), '<script type="module" src="/src/main.js"></script>');
    }

    const isolated = viteBuild(dirs.isolated);
    expect(isolated.ok).toBe(false);
    expect(isolated.error).toMatch(/failed to resolve import "b"/);

    const nested = viteBuild(dirs.nested);
    expect(nested.ok).toBe(true);
    const js = Object.entries(nested.files).filter(([f]) => f.endsWith('.js')).map(([, c]) => c).join('\n');
    expect(js).toContain('b@1');
    expect(js).toContain('b@2');
  }, 60_000);
});

describe('WebAssembly как модуль: Node и сборка', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'lesson-wasm-'));
  writeFileSync(join(tmp, 'run.wasm'), Uint8Array.from(WASM_BYTES));
  writeFileSync(join(tmp, 'env.mjs'), WASM_ENV);
  writeFileSync(join(tmp, 'esm.mjs'), WASM_ESM);
  writeFileSync(join(tmp, 'source.mjs'), WASM_SOURCE);

  it('байты — валидный модуль с импортом ./env.mjs и экспортом run', () => {
    const mod = new WebAssembly.Module(Uint8Array.from(WASM_BYTES));
    expect(WebAssembly.Module.imports(mod)).toEqual([{ module: './env.mjs', name: 'log', kind: 'function' }]);
    expect(WebAssembly.Module.exports(mod)).toEqual([{ name: 'run', kind: 'function' }]);
  });

  it('ESM-интеграция: импорт .wasm сам загрузил env.mjs и связал его', () => {
    expect(node(['esm.mjs'], tmp).trim().split('\n')).toEqual(WASM_NODE_OUT.esm);
  });

  it('фаза исходника: модуль без экземпляра, импорты собраны руками', () => {
    expect(node(['source.mjs'], tmp).trim().split('\n')).toEqual(WASM_NODE_OUT.source);
  });

  it('vite build превращает импорт .wasm в JS-импорты и не понимает import source', () => {
    const app = join(tmp, 'app');
    mkdirSync(join(app, 'src'), { recursive: true });
    writeFileSync(join(app, 'src', 'run.wasm'), Uint8Array.from(WASM_BYTES));
    writeFileSync(join(app, 'src', 'env.mjs'), WASM_ENV);
    writeFileSync(join(app, 'index.html'), '<script type="module" src="/src/main.js"></script>');

    writeFileSync(join(app, 'src', 'main.js'), WASM_ESM);
    const esm = viteBuild(app);
    expect(esm.ok).toBe(true);
    const js = Object.entries(esm.files).find(([f]) => f.endsWith('.js'))?.[1] ?? '';
    expect(js).toContain('"./env.mjs": { "log": log }');
    expect(js).toContain('instantiateStreaming');

    writeFileSync(join(app, 'src', 'main.js'), WASM_SOURCE);
    const source = viteBuild(app);
    expect(source.ok).toBe(false);
    expect(source.error).toMatch(/MISSING_EXPORT|"default" is not exported/);
  }, 60_000);
});

describe('браузер: import maps, nomodule, WebAssembly (Chromium через Playwright)', () => {
  type Files = Record<string, [string, string | Buffer]>;
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** Страница на выдуманном адресе: всё отдаёт перехват, сеть не трогается. */
  async function open(files: Files, requests: string[] = []) {
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.route('http://lesson.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      const file = files[path === '/' ? '/index.html' : path];
      return file
        ? route.fulfill({ contentType: file[0], body: file[1] })
        : route.fulfill({ status: 404, body: '' });
    });
    return { page, logs };
  }

  const asFiles = (source: Record<string, string>): Files =>
    Object.fromEntries(
      Object.entries(source).map(([p, text]) => [p, [p.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript', text]]),
    );

  it('scopes и префикс со слешем: одно имя vue — два файла', async () => {
    const { page, logs } = await open(asFiles(IMPORTMAP_FILES));
    await page.goto('http://lesson.test/');
    await expect.poll(() => logs).toContain(IMPORTMAP_OUT);
    await page.close();
  });

  it('вторая карта: новое имя добавилось, правило для разрешённого vue выброшено', async () => {
    const { page, logs } = await open(asFiles(IMPORTMAP_FILES));
    await page.goto('http://lesson.test/');
    await expect.poll(() => logs).toContain(IMPORTMAP_OUT);
    const before = logs.length;
    await page.evaluate(`(async () => {\n${IMPORTMAP_LATE_CODE}\n})()`);
    const after = logs.slice(before);
    expect(after).toContain(IMPORTMAP_LATE_WARNING);
    expect(after.filter((l) => l !== IMPORTMAP_LATE_WARNING)).toEqual(IMPORTMAP_LATE_OUT);
    await page.close();
  });

  it('integrity в карте: неверный хеш — модуль не выполнен', async () => {
    const files: Files = {
      '/index.html': ['text/html', '<script type="importmap">{"imports":{"vue":"/v.js"},"integrity":{"/v.js":"sha384-AAAA"}}</script>'],
      '/v.js': ['text/javascript', 'export const who = 1'],
    };
    const { page } = await open(files);
    await page.goto('http://lesson.test/');
    // Строкой, а не функцией: Vitest переписывает `import()` в теле теста в свой помощник,
    // и в браузер уехал бы вызов несуществующего `__vite_ssr_dynamic_import__`.
    const result = await page.evaluate(`import('vue').then(() => 'выполнен', (e) => e.constructor.name)`);
    expect(result).toBe('TypeError');
    await page.close();
  });

  it('nomodule: современный браузер легаси-файл даже не запрашивает', async () => {
    const requests: string[] = [];
    const { page } = await open(
      {
        '/index.html': ['text/html', NOMODULE_HTML],
        '/assets/index-modern.js': ['text/javascript', ''],
        '/assets/index-legacy.js': ['text/javascript', ''],
      },
      requests,
    );
    await page.goto('http://lesson.test/');
    await page.waitForLoadState('load');
    expect(requests.filter((r) => r.startsWith('/assets/'))).toEqual(NOMODULE_REQUESTS);
    await page.close();
  });

  it('WebAssembly: импорт .wasm и import source не работают, instantiateStreaming — работает', async () => {
    const wasm = Buffer.from(Uint8Array.from(WASM_BYTES));
    const { page, logs } = await open({
      '/index.html': ['text/html', ''],
      '/run.wasm': ['application/wasm', wasm],
      '/run-octet.wasm': ['application/octet-stream', wasm],
      '/env.mjs': ['text/javascript', WASM_ENV],
      '/esm.js': ['text/javascript', WASM_ESM.replace('./run.wasm', '/run.wasm')],
      '/source.js': ['text/javascript', WASM_SOURCE.replace('./run.wasm', '/run.wasm')],
    });
    await page.goto('http://lesson.test/');
    const result = await page.evaluate(`(async () => {
      const tryImport = (u) => import(u).then(() => 'ok', (e) => e.constructor.name);
      const out = { esm: await tryImport('/esm.js'), source: await tryImport('/source.js') };
      await (async () => {\n${WASM_STREAMING}\n})();
      out.octet = await WebAssembly.instantiateStreaming(fetch('/run-octet.wasm'), { './env.mjs': { log() {} } })
        .then(() => 'ok', (e) => e.constructor.name);
      return out;
    })()`);
    expect(result).toEqual({ esm: 'TypeError', source: 'SyntaxError', octet: 'TypeError' });
    expect(logs).toContain('вручную получил 42');
    await page.close();
  });

  it('vite build с external: vue остаётся голым именем, карта — на месте и раньше входа', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'lesson-external-')), 'app');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'vite.config.js'), EXTERNAL_CONFIG);
    writeFileSync(join(root, 'src', 'main.js'), EXTERNAL_MAIN);
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><html><head><script type="importmap">{"imports":{"vue":"https://cdn.example/vue.js"}}</script></head><body><script type="module" src="/src/main.js"></script></body></html>',
    );
    const out = viteBuild(root);
    expect(out.ok, out.error).toBe(true);
    const chunk = Object.entries(out.files).find(([f]) => f.endsWith('.js'))?.[1] ?? '';
    expect(chunk.split('\n')[0]).toBe(EXTERNAL_FIRST_LINE);
    const html = out.files['index.html'];
    expect(html.indexOf('type="importmap"')).toBeGreaterThan(-1);
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
  }, 60_000);
});
