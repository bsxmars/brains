import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  COND_NOTE,
  COND_ROWS,
  EXPORTS_RULES,
  LEXER_NOTE,
  LEXER_ROWS,
  MEASURED,
} from '@/content/tooling/modules/data';

/**
 * «Модули и сборка», раздел про `exports` и интероп: что Node делает на самом деле.
 *
 * Эти утверждения были сняты однажды руками (Node 26.8.2) и стояли в AGENTS.md с пометкой
 * «сторожем не закреплено». Здесь прогон повторяется на каждом запуске.
 *
 * Почему отдельный файл, а не `modules.test.ts`: тот поднимает Chromium и собирает Vite,
 * а резолвер Node проверяется за доли секунды — держать дешёвую проверку за дорогой незачем.
 *
 * Всё — в **отдельном процессе** `node`: vitest исполняет модули своим раннером поверх
 * Vite, и ни условия `exports`, ни разбор CommonJS на имена в нём не те, что у Node
 * (см. докстринг `modules.test.ts`).
 *
 * Условия — по одному на пакет-фикстуру: `{ "<условие>": "./hit.js", "default": "./miss.js" }`.
 * В общей карте выигрывает первое совпадение, и по ней не понять, какое условие Node
 * поддерживает, а какое просто стоит ниже. Список условий берётся **из `COND_ROWS`** — из той
 * самой таблицы, что на странице, — поэтому новая строка таблицы сразу попадает под прогон.
 */

/** Дочерний `node` без `NODE_ENV=test`, который выставляет vitest: окружение задаётся явно. */
function node(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  const base = { ...process.env };
  delete base.NODE_ENV;
  return execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    env: { ...base, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Имена в обратных кавычках: '`deno`, `bun`, `worker`' → ['deno', 'bun', 'worker']. */
const ticked = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

const measured = (key: string) => {
  const row = MEASURED.find((r) => r.k === key);
  expect(row, `строки «${key}» в MEASURED нет — таблица замеров разошлась со сторожем`).toBeDefined();
  return row!.v;
};

type Verdict = Record<string, { imp: 'hit' | 'miss'; req: 'hit' | 'miss' }>;

const PROBE = `
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const pick = (f) => (f.endsWith('hit.js') ? 'hit' : 'miss');
const out = {};
for (const c of JSON.parse(process.argv[2])) {
  out[c] = { imp: pick(import.meta.resolve('c-' + c)), req: pick(req.resolve('c-' + c)) };
}
process.stdout.write(JSON.stringify(out));
`;

describe('условия exports: что включает сам Node', () => {
  const conditions = COND_ROWS.flatMap((r) => ticked(r.k));
  let plain: Verdict;
  let prod: Verdict;
  let flagged: Verdict;

  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'lesson-conditions-'));
    for (const c of conditions) {
      const pkg = join(dir, 'node_modules', `c-${c}`);
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: `c-${c}`, exports: { [c]: './hit.js', default: './miss.js' } }));
      writeFileSync(join(pkg, 'hit.js'), '');
      writeFileSync(join(pkg, 'miss.js'), '');
    }
    writeFileSync(join(dir, 'probe.mjs'), PROBE);
    const run = (flags: string[], env?: NodeJS.ProcessEnv) =>
      JSON.parse(node([...flags, 'probe.mjs', JSON.stringify(conditions)], dir, env)) as Verdict;

    plain = run([]);
    prod = run([], { NODE_ENV: 'production' });
    // Контроль: зонд обязан отличать «сработало» от «не сработало». Условие, включённое
    // флагом, должно дать hit — иначе все «—» в таблице доказывали бы только поломку зонда.
    flagged = run(['--conditions=development']);
  });

  it('контроль: условие, включённое флагом --conditions, зонд видит', () => {
    expect(plain.development.imp).toBe('miss');
    expect(flagged.development).toEqual({ imp: 'hit', req: 'hit' });
  });

  it('каждая строка COND_ROWS совпадает с резолвером Node — и на import, и на require', () => {
    const expected = (cell: string) => (cell === 'срабатывает' ? 'hit' : 'miss');
    for (const row of COND_ROWS) {
      for (const c of ticked(row.k)) {
        expect(plain[c], `${c}`).toEqual({ imp: expected(row.imp), req: expected(row.req) });
      }
    }
  });

  it('module-sync срабатывает и на import, и на require — то, чего в теме раньше не было', () => {
    expect(plain['module-sync']).toEqual({ imp: 'hit', req: 'hit' });
    // «Главная находка — `module-sync`» — ради этой строки правка и делалась
    expect(COND_NOTE).toContain('**Главная находка — `module-sync`:**');
  });

  it('условий по три на каждую сторону — как в MEASURED', () => {
    const hits = (side: 'imp' | 'req') => Object.keys(plain).filter((c) => plain[c][side] === 'hit').sort();
    expect(hits('imp')).toEqual(['import', 'module-sync', 'node']);
    expect(hits('req')).toEqual(['module-sync', 'node', 'require']);
    expect(measured('Условий Node применяет: на `import` / на `require`')).toBe('3 и 3, включая `module-sync`');
  });

  it('NODE_ENV=production не меняет выбор ни одного файла', () => {
    expect(prod).toEqual(plain);
    expect(prod.production).toEqual({ imp: 'miss', req: 'miss' });
    expect(measured('`NODE_ENV=production` меняет выбор файла')).toBe('нет');
    // Было: «Node выставляет … development/production» — правка держится на этих словах
    expect(COND_NOTE).toContain('на выбор файла в Node не влияет никак');
  });

  it('EXPORTS_RULES отсылает к среде, а не перечисляет условия Node по памяти', () => {
    // Прежняя версия правила сама называла набор Node — и ошиблась в нём. Теперь набор
    // живёт только в COND_ROWS, которые проверены выше, а правило говорит, кто решает.
    expect(EXPORTS_RULES.join('\n')).toContain('решает не пакет, а среда');
    expect(EXPORTS_RULES.join('\n')).not.toMatch(/Node выставляет/);
  });
});

/**
 * Разбор CommonJS на именованные экспорты. В Node 26.8.2 это уже не `cjs-module-lexer`
 * из npm, а его порт на C++ — `merve` (`process.versions.merve` 1.2.2); тема по-прежнему
 * зовёт его `cjs-module-lexer`, и поведение на проверенных образцах то же.
 *
 * Фикстура на каждую строку `LEXER_ROWS`: ключ — `k` строки, исходник — то, что `k`
 * описывает словами. Имена снимаются через `import * as ns` — он не падает на промахе,
 * поэтому все формы проверяются в одном процессе, а падение связывания — отдельно.
 */
const LEXER_FIXTURES: Record<string, string> = {
  'exports.foo = 1': 'exports.foo = 1;\n',
  // `…` в строке таблицы — форма с `value`. Геттер Node тоже узнаёт, но только вида
  // `get() { return m.baz }`; `get() { return 3 }` — уже нет (проверено тем же зондом).
  'Object.defineProperty(exports, "baz", …)': 'Object.defineProperty(exports, "baz", { enumerable: true, value: 3 });\n',
  'module.exports[k] = v в цикле': 'for (const k of ["a", "b"]) module.exports[k] = k;\n',
  'module.exports = { q, w }': 'const q = 1, w = 2;\nmodule.exports = { q, w };\n',
  'module.exports = { q: 1, w: 2 }': 'module.exports = { q: 1, w: 2 };\n',
  'exports.ok = 1 и module.exports.also = 2': 'exports.ok = 1;\nmodule.exports.also = 2;\n',
};

const LEXER_PROBE = `
const out = {};
for (const [i, key] of JSON.parse(process.argv[2]).entries()) {
  const ns = await import('./f' + i + '.cjs');
  out[key] = {
    names: Object.keys(ns).filter((k) => k !== 'default' && k !== 'module.exports').sort(),
    whole: ns['module.exports'] === ns.default,
  };
}
process.stdout.write(JSON.stringify(out));
`;

describe('CommonJS: какие имена Node видит без выполнения', () => {
  let dir: string;
  let seen: Record<string, { names: string[]; whole: boolean }>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'lesson-lexer-'));
    const keys = LEXER_ROWS.map((r) => r.k);
    keys.forEach((k, i) => writeFileSync(join(dir, `f${i}.cjs`), LEXER_FIXTURES[k] ?? ''));
    writeFileSync(join(dir, 'probe.mjs'), LEXER_PROBE);
    seen = JSON.parse(node(['probe.mjs', JSON.stringify(keys)], dir));
  });

  /** Что обещает колонка `v`: '`ok`, `also`' → ['also', 'ok']; 'ничего' → []. */
  const promised = (v: string) => (v === 'ничего' ? [] : ticked(v).sort());
  const AGREE = LEXER_ROWS;

  it('у каждой строки LEXER_ROWS есть фикстура', () => {
    expect(LEXER_ROWS.map((r) => r.k).sort()).toEqual(Object.keys(LEXER_FIXTURES).sort());
  });

  for (const row of AGREE) {
    it(`${row.k} → ${row.v}`, () => {
      expect(seen[row.k].names).toEqual(promised(row.v));
    });
  }

  it('объект целиком: сокращённые ключи распознаются, литералы — нет', () => {
    // Раньше таблица говорила «объект целиком — ничего»; сторож показал, что `{ q, w }`
    // Node разбирает на имена. Текст поправлен 2026-09-29, эта проверка держит обе половины.
    expect(seen['module.exports = { q, w }'].names).toEqual(['q', 'w']);
    expect(seen['module.exports = { q: 1, w: 2 }'].names).toEqual([]);
    const hits = LEXER_ROWS.filter((r) => promised(r.v).length > 0).length;
    expect(measured('Именованные экспорты CJS: из 6 форм записи распознано')).toBe(String(hits));
  });

  it('служебный экспорт "module.exports" тождественно равен default', () => {
    for (const k of Object.keys(seen)) expect(seen[k].whole, k).toBe(true);
    expect(LEXER_NOTE).toContain('`import { "module.exports" as whole }`');
  });

  it('промах виден на связывании: SyntaxError до первой строки кода, default при этом работает', () => {
    const loop = LEXER_ROWS.findIndex((r) => r.k === 'module.exports[k] = v в цикле');
    writeFileSync(join(dir, 'named.mjs'), `console.log('выполнился');\nimport { a } from './f${loop}.cjs';\n`);
    const { stdout, stderr } = (() => {
      try {
        return { stdout: node(['named.mjs'], dir), stderr: '' };
      } catch (error) {
        return error as { stdout: string; stderr: string };
      }
    })();
    expect(stderr).toContain("SyntaxError: Named export 'a' not found");
    expect(stdout, 'ошибка связывания — до выполнения модуля').toBe('');
    expect(LEXER_NOTE).toContain("SyntaxError: Named export 'a' not found");

    writeFileSync(join(dir, 'whole.mjs'), `import pkg from './f${loop}.cjs';\nprocess.stdout.write(pkg.a + pkg.b);\n`);
    expect(node(['whole.mjs'], dir)).toBe('ab');
    expect(LEXER_NOTE).toContain('**`import pkg from` и `pkg.a` работают всегда**');
  });
});
