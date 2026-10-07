import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as babelParse } from '@babel/parser';
import babelGenerate from '@babel/generator';
import babelTraverse from '@babel/traverse';
import * as babelTypes from '@babel/types';
import { ESLint, Linter, type Rule as EslintRule } from 'eslint';
import { builtinRules } from 'eslint/use-at-your-own-risk';
import * as espree from 'espree';
import { minimatch } from 'minimatch';
import * as prettier from 'prettier';
import { parseAst } from 'rolldown/parseAst';
import tseslint from 'typescript-eslint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as t from '@/content/tooling/ast-linters/data';
import { KEYS, parse } from '@/widgets/ast-lab/model/parser';
import { loadLint, traceWalk } from '@/widgets/ast-lab/model/run';
import type { EsNode, LintMessage, Rule } from '@/widgets/ast-lab/model/types';

/**
 * Тема «AST и линтеры».
 *
 * Строки `WALK_CODE`, `RULES_CODE`, `LINT_CODE` напечатаны на странице и исполняются демо;
 * `UNUSED_CODE`, `CONFIG_CODE`, `CODEMOD_CODE`, `REPRINT_CODE` — только напечатаны. Здесь все
 * они исполняются и сверяются с настоящим ESLint: порядок посещения узлов, сообщения, итоговый
 * текст после исправлений, число проходов, итог слияния конфига. Правила `RULES_CODE` уходят
 * в ESLint плагином — тем же объектом, что исполняет учебный линтер. Литералы стенда (токены,
 * узел, трасса, области, выводы Babel и Prettier) пересобираются теми же вызовами, что на стенде.
 */

const require = createRequire(import.meta.url);
const version = (name: string) => (require(`${name}/package.json`) as { version: string }).version;

const api = loadLint(t.WALK_CODE, t.RULES_CODE, t.LINT_CODE, { KEYS, parse });

/** Остальные строки темы — в одной функции с обходом и `applyFixes`, как на странице. */
const tools = new Function(
  'KEYS',
  'parse',
  'babel',
  `${t.WALK_CODE}\n${t.LINT_CODE}\n${t.UNUSED_CODE}\n${t.CONFIG_CODE}\n${t.CODEMOD_CODE}\n${t.REPRINT_CODE}\n` +
    'return { findUnused, rulesFor, codemod, codemodReprint };',
)(KEYS, parse, {
  parse: babelParse,
  traverse: (babelTraverse as unknown as { default?: unknown }).default ?? babelTraverse,
  generate: (babelGenerate as unknown as { default?: unknown }).default ?? babelGenerate,
  types: babelTypes,
}) as {
  findUnused(scopeManager: unknown): string[];
  rulesFor(path: string, configs: unknown[], match: (p: string, pat: string) => boolean): Record<string, unknown[]> | undefined;
  codemod(text: string): string;
  codemodReprint(text: string): string;
};

const linter = new Linter();

/** Счётчик вызовов `verify`: ESLint зовёт `create` каждого правила один раз на проход. */
let runs = 0;
const counter: EslintRule.RuleModule = {
  create() {
    runs++;
    return {};
  },
};

/** Правила темы — плагином `demo`, тем же объектом. */
const demoPlugin = (extra: Record<string, unknown> = {}) => ({
  rules: {
    'no-loose-eq': api.rules['demo/no-loose-eq'],
    yoda: api.rules['demo/yoda'],
    counter,
    ...extra,
  } as unknown as Record<string, EslintRule.RuleModule>,
});

const demoConfig: Linter.Config[] = [
  {
    plugins: { demo: demoPlugin() },
    rules: { 'demo/no-loose-eq': 'error', 'demo/yoda': 'error', 'demo/counter': 'error' },
  },
];

/** Поля, которые сравниваются у ESLint и учебного `verify`. */
const strip = (msg: LintMessage | Linter.LintMessage) => {
  const m = msg as unknown as Record<string, unknown>;
  return { ruleId: m.ruleId, message: m.message, line: m.line, column: m.column, endLine: m.endLine, endColumn: m.endColumn, fix: m.fix };
};

/** Вход и выход каждого узла в настоящем ESLint. */
function eslintWalk(code: string): string[] {
  const log: string[] = [];
  const trace: EslintRule.RuleModule = {
    create: () => ({
      '*': (n: { type: string }) => void log.push(`> ${n.type}`),
      '*:exit': (n: { type: string }) => void log.push(`< ${n.type}`),
    }),
  };
  const msgs = linter.verify(code, [{ plugins: { tr: { rules: { trace } } }, rules: { 'tr/trace': 'error' } }]);
  expect(msgs.filter((m) => m.fatal)).toEqual([]);
  return log;
}

/** Тот же журнал из учебного `traverse`. */
function miniWalk(code: string, sourceType: 'module' | 'script' = 'module'): string[] {
  const log: string[] = [];
  const ast = espree.parse(code, { ...PARSE, sourceType }) as unknown as EsNode;
  api.traverse(ast, {
    '*': [(n) => void log.push(`> ${n.type}`)],
    '*:exit': [(n) => void log.push(`< ${n.type}`)],
  });
  return log;
}
const PARSE = { ecmaVersion: 'latest', sourceType: 'module', range: true, loc: true, tokens: true, comment: true } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('стенд снят на этих версиях', () => {
  it('ESLint и его парсер, Babel, Prettier, rolldown', () => {
    expect(ESLint.version).toBe('10.10.0');
    expect(espree.version).toBe('11.2.0');
    expect(version('eslint-scope')).toBe('9.1.2');
    expect(version('eslint-visitor-keys')).toBe('5.0.1');
    expect(version('esquery')).toBe('1.7.0');
    expect(version('typescript-eslint')).toBe('8.70.0');
    expect(version('@babel/generator')).toBe('7.29.8');
    expect(prettier.version).toBe('3.9.6');
    expect(version('rolldown')).toBe('1.2.8');
  });
});

describe('от текста к дереву', () => {
  const ast = espree.parse(t.DISCOUNT_CODE, PARSE) as unknown as EsNode & { tokens: { type: string; value: string; range: number[]; loc: { start: { line: number } } }[] };

  it('символы, токены и узлы сквозного примера', () => {
    expect(t.DISCOUNT_CODE.length).toBe(t.DISCOUNT_STATS.chars);
    expect(ast.tokens.length).toBe(t.DISCOUNT_STATS.tokens);
    expect(eslintWalk(t.DISCOUNT_CODE).length / 2).toBe(t.DISCOUNT_STATS.nodes);
  });

  it('токены третьей строки — TOKENS_LINE3', () => {
    const line3 = ast.tokens.filter((tok) => tok.loc.start.line === 3).map(({ type, value, range }) => ({ type, value, range }));
    expect(line3).toEqual(t.TOKENS_LINE3);
  });

  it("узел 'SALE' == code — NODE_PRINT", () => {
    const printed = new Function(`return ${t.NODE_PRINT};`)() as Record<string, unknown>;
    const decl = (ast as unknown as { body: { declaration: { body: { body: { test: { right: EsNode } }[] } } }[] }).body[0];
    const node = decl.declaration.body.body[1].test.right;
    const left = node.left as EsNode;
    const right = node.right as EsNode;
    expect(printed).toEqual({
      type: node.type,
      operator: node.operator,
      left: { type: left.type, value: left.value, raw: left.raw, range: left.range },
      right: { type: right.type, name: right.name, range: right.range },
      range: node.range,
      loc: { start: { ...node.loc.start }, end: { ...node.loc.end } },
    });
    expect(t.DISCOUNT_CODE.slice(93, 107)).toBe("'SALE' == code");
    expect([node.start, node.end]).toEqual(node.range);
  });

  it('комментарии лежат рядом с токенами, а не в дереве', () => {
    const withComment = espree.parse('// итог\nconst a = 1; /* b */\n', PARSE) as unknown as { comments: { type: string }[] };
    expect(withComment.comments.map((c) => c.type)).toEqual(['Line', 'Block']);
    expect(miniWalk('// итог\nconst a = 1; /* b */\n').some((s) => /Line|Block|Comment/.test(s))).toBe(false);
  });

  it('range — в символах UTF-16 у трёх парсеров, в байтах было бы 31', () => {
    const code = "const s = '🙂 привет'; const x = 1;\n";
    const at = code.indexOf('const x');
    expect(at).toBe(23);
    expect(Buffer.byteLength(code.slice(0, at))).toBe(31);
    const e = espree.parse(code, PARSE) as unknown as { body: EsNode[] };
    const tsParser = tseslint.parser as unknown as { parseForESLint(code: string, o: object): { ast: { body: EsNode[] } } };
    const ts = tsParser.parseForESLint(code, { range: true }).ast;
    const oxc = parseAst(code) as unknown as { body: { start: number }[] };
    expect(e.body[1].range[0]).toBe(23);
    expect(ts.body[1].range[0]).toBe(23);
    expect(oxc.body[1].start).toBe(23);
    expect(t.AST_FACTS[1].d).toContain('начинается на 23');
    expect(t.AST_FACTS[1].d).toContain('до него 31');
  });

  it('espree не понимает типов, парсер typescript-eslint добавляет узлы TS*', () => {
    const ts = 'const greet = (name: string) => "Привет, " + name;\n';
    const [fatal] = linter.verify(ts, [{}]);
    expect(fatal).toMatchObject({ fatal: true, line: 1, column: 20, message: 'Parsing error: Unexpected token :' });
    const types: string[] = [];
    const coll: EslintRule.RuleModule = { create: () => ({ '*': (n: { type: string }) => void types.push(n.type) }) };
    linter.verify(ts, [{ languageOptions: { parser: tseslint.parser }, plugins: { c: { rules: { coll } } }, rules: { 'c/coll': 'error' } }]);
    expect(types).toContain('TSTypeAnnotation');
    expect(types).toContain('TSStringKeyword');
    expect(t.AST_FACTS[2].d).toContain('`Parsing error: Unexpected token :` в колонке 20');
  });
});

describe('обход: WALK_CODE против ESLint', () => {
  it('сквозной пример и примеры демо — тот же порядок входов и выходов', () => {
    for (const code of [t.DISCOUNT_CODE, ...t.DEMO_EXAMPLES.map((e) => e.code), t.TEMPLATE_CODE]) {
      expect(miniWalk(code)).toEqual(eslintWalk(code));
    }
  });

  it('все .js и .mjs из node_modules/eslint/lib — тот же порядок; «самодельный» по полям расходится в 125 из 375', () => {
    const root = join(dirname(require.resolve('eslint/package.json')), 'lib');
    const files: string[] = [];
    (function scan(dir: string, depth: number) {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (depth < 3) scan(p, depth + 1);
        } else if (/\.m?js$/.test(f)) files.push(p);
      }
    })(root, 0);

    /** Дети в том порядке, в каком их записал espree: так обходят «на глазок». */
    const naive = (ast: EsNode) => {
      const out: string[] = [];
      const skip = new Set(['parent', 'tokens', 'comments', 'loc', 'range']);
      (function walk(n: EsNode) {
        out.push(`> ${n.type}`);
        for (const [k, v] of Object.entries(n)) {
          if (skip.has(k)) continue;
          for (const c of Array.isArray(v) ? v : [v]) if (c && typeof (c as EsNode).type === 'string') walk(c as EsNode);
        }
        out.push(`< ${n.type}`);
      })(ast);
      return out;
    };

    let nodes = 0;
    let naiveBad = 0;
    for (const f of files) {
      const code = readFileSync(f, 'utf8');
      const sourceType = f.endsWith('.mjs') ? 'module' : 'commonjs';
      const real: string[] = [];
      const trace: EslintRule.RuleModule = {
        create: () => ({ '*': (n: { type: string }) => void real.push(`> ${n.type}`), '*:exit': (n: { type: string }) => void real.push(`< ${n.type}`) }),
      };
      linter.verify(code, [{ languageOptions: { sourceType }, plugins: { tr: { rules: { trace } } }, rules: { 'tr/trace': 'error' } }]);
      const ast = espree.parse(code, { ...PARSE, sourceType }) as unknown as EsNode;
      const mine: string[] = [];
      api.traverse(ast, { '*': [(n) => void mine.push(`> ${n.type}`)], '*:exit': [(n) => void mine.push(`< ${n.type}`)] });
      expect(mine, f).toEqual(real);
      if (JSON.stringify(naive(espree.parse(code, { ...PARSE, sourceType }) as unknown as EsNode)) !== JSON.stringify(real)) naiveBad++;
      nodes += real.length / 2;
    }
    expect(files.length).toBe(375);
    expect(nodes).toBe(213_396);
    expect(naiveBad).toBe(125);
    expect(t.TEMPLATE_NOTE).toContain('в 125 файлах из 375');
  }, 60_000);

  it('VISIT_TRACE — вход и выход по условию if, пометки — где сработали правила', () => {
    const lines: string[] = [];
    let depth = 0;
    const label = (n: EsNode) => n.type + (n.operator ? ` ${n.operator}` : n.name ? ` ${n.name}` : n.raw ? ` ${n.raw}` : '');
    const inIf = (n: EsNode) => n.range[0] >= 66 && n.range[1] <= 107;
    const trace: EslintRule.RuleModule = {
      create: () => ({
        '*': (n: EsNode) => {
          if (!inIf(n)) return;
          lines.push(`${'  '.repeat(depth++)}→ ${label(n)}`);
        },
        '*:exit': (n: EsNode) => {
          if (!inIf(n)) return;
          lines.push(`${'  '.repeat(--depth)}← ${n.type}`);
        },
      }) as unknown as EslintRule.RuleListener,
    };
    linter.verify(t.DISCOUNT_CODE, [{ plugins: { tr: { rules: { trace } } }, rules: { 'tr/trace': 'error' } }]);
    expect(t.VISIT_TRACE.split('\n').map((l) => l.replace(/\s+\/\/.*$/, ''))).toEqual(lines);

    // Пометки: на каких входах сработали правила — по демо-обходу.
    const marked = traceWalk(api, t.DISCOUNT_CODE, { KEYS, parse })
      .filter((e) => e.reports.length)
      .map((e) => [label(e.node), e.reports.map((r) => r.ruleId).sort().join(', ')]);
    expect(marked).toEqual([
      ['BinaryExpression ==', 'demo/no-loose-eq, demo/yoda'],
      ['BinaryExpression ==', 'demo/no-loose-eq, demo/yoda'],
    ]);
    expect(t.VISIT_TRACE.match(/\/\/ demo\/yoda, demo\/no-loose-eq/g)).toHaveLength(2);
  });

  it('шаблонная строка: сначала все куски текста, потом выражения', () => {
    const log: string[] = [];
    const tr: EslintRule.RuleModule = {
      create: () => ({
        TemplateElement: (n: { value: { raw: string } }) => void log.push(`TemplateElement «${n.value.raw}»`),
        'TemplateLiteral Identifier': (n: { name: string }) => void log.push(`Identifier ${n.name}`),
      }),
    };
    linter.verify(t.TEMPLATE_CODE, [{ plugins: { tr: { rules: { tr } } }, rules: { 'tr/tr': 'error' } }]);
    expect(log).toEqual(t.TEMPLATE_ORDER);
    expect(KEYS.TemplateLiteral).toEqual(['quasis', 'expressions']);
    const node = (espree.parse(t.TEMPLATE_CODE, PARSE) as unknown as { body: { declarations: { init: object }[] }[] }).body[0].declarations[0].init;
    expect(Object.keys(node).indexOf('expressions')).toBeLessThan(Object.keys(node).indexOf('quasis'));
  });

  it('селекторы на одном узле — по специфичности, :exit — так же', () => {
    const order: string[] = [];
    const push = (s: string) => () => void order.push(s);
    const sp: EslintRule.RuleModule = {
      create: () => ({
        'BinaryExpression[operator="=="]': push('BinaryExpression[operator="=="]'),
        BinaryExpression: push('BinaryExpression'),
        'IfStatement > BinaryExpression': push('IfStatement > BinaryExpression'),
        '*': (n: EsNode) => void (n.type === 'BinaryExpression' && order.push('*')),
        '*:exit': (n: EsNode) => void (n.type === 'BinaryExpression' && order.push('*:exit')),
        'BinaryExpression:exit': push('BinaryExpression:exit'),
      }) as unknown as EslintRule.RuleListener,
    };
    linter.verify('if (a == b) {}', [{ plugins: { c: { rules: { sp } } }, rules: { 'c/sp': 'error' } }]);
    expect(order).toEqual([...t.SELECTOR_ORDER, '*:exit', 'BinaryExpression:exit']);
  });

  it('учебный traverse ставит parent, как ESLint', () => {
    const ast = parse(t.DISCOUNT_CODE);
    const seen: string[] = [];
    api.traverse(ast, { Literal: [(n) => void seen.push(`${n.parent?.type}`)] });
    expect(seen).toEqual(['VariableDeclarator', 'BinaryExpression', 'BinaryExpression', 'BinaryExpression']);
  });
});

describe('области видимости', () => {
  function scopes(code: string) {
    let sm: unknown;
    const probe: EslintRule.RuleModule = { create: (ctx) => ({ 'Program:exit': () => void (sm = ctx.sourceCode.scopeManager) }) };
    linter.verify(code, [{ plugins: { p: { rules: { probe } } }, rules: { 'p/probe': 'error' } }]);
    return sm as {
      scopes: {
        type: string;
        block: { type: string };
        variables: { name: string; references: { isRead(): boolean; isWrite(): boolean }[] }[];
        references: { identifier: { name: string }; isRead(): boolean; isWrite(): boolean; resolved: { scope: { type: string } } | null }[];
        through: { identifier: { name: string } }[];
      }[];
      globalScope: { variables: unknown[] };
    };
  }

  it('SCOPE_ROWS и GLOBAL_VARS — как у eslint-scope', () => {
    const sm = scopes(t.DISCOUNT_CODE);
    const [global, mod, fn, block] = sm.scopes;
    expect(sm.scopes).toHaveLength(4);
    expect(global.type).toBe('global');
    expect(sm.globalScope.variables).toHaveLength(t.GLOBAL_VARS);
    expect([mod.type, fn.type, block.type]).toEqual(['module', 'function', 'block']);
    expect([mod.block.type, fn.block.type, block.block.type]).toEqual(['Program', 'FunctionDeclaration', 'BlockStatement']);
    expect(mod.variables.map((v) => v.name)).toEqual(['discount']);
    expect(fn.variables.map((v) => v.name)).toEqual(['arguments', 'price', 'code', 'unused']);
    expect(block.variables).toEqual([]);
    const refs = (s: (typeof sm.scopes)[number]) =>
      s.references.map((r) => `${r.identifier.name}:${r.isRead() ? 'R' : ''}${r.isWrite() ? 'W' : ''}:${r.resolved?.scope.type}`);
    expect(refs(fn)).toEqual(['unused:W:function', 'code:R:function', 'code:R:function', 'price:R:function']);
    expect(refs(block)).toEqual(['price:R:function']);
    expect(block.through.map((r) => r.identifier.name)).toEqual(['price']);
    expect(t.SCOPE_ROWS.map((r) => r.vars)).toEqual(['`discount`', '`arguments`, `price`, `code`, `unused`', '—']);
    expect(t.SCOPE_NOTE).toContain(`${t.GLOBAL_VARS} встроенных`);
  });

  it('findUnused против no-unused-vars: совпадает там, где сказано, и расходится там, где сказано', () => {
    const cases: [string, boolean][] = [
      [t.DISCOUNT_CODE, true],
      ['const { a, ...rest } = obj; console.log(rest);', true],
      ['export const y = 2; function helper() {} class A {}', true],
      ['let count = 0; count = count + 1;', false],
      ['let n = 0; n++;', false],
    ];
    cases.forEach(([code, same], i) => {
      let mine: string[] = [];
      const probe: EslintRule.RuleModule = { create: (ctx) => ({ 'Program:exit': () => void (mine = tools.findUnused(ctx.sourceCode.scopeManager)) }) };
      const core = linter
        .verify(code, [
          {
            plugins: { p: { rules: { probe } } },
            rules: { 'no-unused-vars': 'error', 'p/probe': 'error' },
            languageOptions: { globals: { obj: 'readonly', console: 'readonly' } },
          },
        ])
        .filter((m) => m.ruleId === 'no-unused-vars')
        .map((m) => /'(.+?)'/.exec(m.message)?.[1]);
      const fmt = (names: (string | undefined)[]) => (names.length ? names.map((n) => `\`${n}\``).join(', ') : '—');
      expect(fmt(core), code).toBe(t.UNUSED_CASES[i].core);
      expect(fmt(mine), code).toBe(t.UNUSED_CASES[i].mine);
      expect(t.UNUSED_CASES[i].same).toBe(same);
      expect(fmt(core) === fmt(mine)).toBe(same);
    });
    expect(t.UNUSED_CASES[0].code).toBe('const unused = 0; // в функции discount');
  });

  it('без пропуска области class имя класса попало бы дважды', () => {
    const sm = scopes('class A {}');
    expect(sm.scopes.map((s) => s.type)).toEqual(['global', 'module', 'class']);
    expect(sm.scopes[1].variables.map((v) => v.name)).toEqual(['A']);
    expect(sm.scopes[2].variables.map((v) => v.name)).toEqual(['A']);
  });

  it('параметры — after-used, как в PARAMS_NOTE', () => {
    const unused = (code: string) => linter.verify(code, [{ rules: { 'no-unused-vars': 'error' } }]).map((m) => m.message);
    expect(unused('function f(a, b) { return b; }\nf();\n')).toEqual([]);
    expect(unused('function f(a, b) { return a; }\nf();\n')).toEqual(["'b' is defined but never used."]);
  });
});

describe('своё правило: учебный verify против ESLint', () => {
  it('сообщения о сквозном примере — те же, и они в DISCOUNT_MESSAGES', () => {
    const real = linter.verify(t.DISCOUNT_CODE, demoConfig).map(strip);
    const mine = api.verify(t.DISCOUNT_CODE, parse(t.DISCOUNT_CODE), api.rules).map(strip);
    expect(mine).toEqual(real);
    expect(
      mine.map((m) => ({
        pos: `${m.line}:${m.column}–${m.endLine}:${m.endColumn}`,
        rule: m.ruleId,
        message: m.message,
        fix: m.fix ? `\`[${(m.fix as { range: number[] }).range.join(', ')}]\` → \`${(m.fix as { text: string }).text}\`` : t.DISCOUNT_MESSAGES[3].fix,
      })),
    ).toEqual(t.DISCOUNT_MESSAGES);
  });

  it('на всех примерах демо сообщения совпадают', () => {
    for (const e of t.DEMO_EXAMPLES) {
      expect(api.verify(e.code, parse(e.code), api.rules).map(strip), e.id).toEqual(linter.verify(e.code, demoConfig).map(strip));
    }
  });

  it('eqeqeq тоже не чинит code == \'SALE\', но чинит typeof', () => {
    const msgs = linter.verify(t.DISCOUNT_CODE, [{ rules: { eqeqeq: 'error' } }]);
    expect(msgs.map((m) => [m.column, Boolean(m.fix)])).toEqual([
      [16, true],
      [41, false],
    ]);
  });

  it('fix без meta.fixable — исключение с текстом из RULE_PARTS', () => {
    const bad: EslintRule.RuleModule = {
      create: (ctx) => ({ Identifier: (n) => ctx.report({ node: n, message: 'x', fix: (f) => f.replaceText(n, 'y') }) }),
    };
    expect(() => linter.verify('a;', [{ plugins: { c: { rules: { bad } } }, rules: { 'c/bad': 'error' } }])).toThrow(
      'Fixable rules must set the `meta.fixable` property',
    );
  });
});

describe('автоисправления: verifyAndFix против ESLint', () => {
  function realFix(code: string, config: Linter.Config[] = demoConfig) {
    runs = 0;
    const r = linter.verifyAndFix(code, config);
    return { ...r, runs };
  }

  it('сквозной пример: три прохода, текст DISCOUNT_FIXED, PASS_ROWS', () => {
    const real = realFix(t.DISCOUNT_CODE);
    const mine = api.verifyAndFix(t.DISCOUNT_CODE, api.rules);
    expect(mine.output).toBe(real.output);
    expect(mine.output).toBe(t.DISCOUNT_FIXED);
    expect(real.runs).toBe(3);
    expect(mine.passes).toHaveLength(3);
    expect(mine.recheck).toBe(false);
    expect(mine.messages.map(strip)).toEqual(real.messages.map(strip));
    expect(mine.passes.map((p) => [p.messages.length, p.applied.length, p.skipped.length])).toEqual([
      [4, 2, 1],
      [2, 1, 0],
      [1, 0, 0],
    ]);
    expect(t.PASS_ROWS.map((r) => r.messages)).toEqual(['4', '2', '1']);
    const [p1, p2] = mine.passes;
    expect(p1.applied.map((m) => m.fix?.range)).toEqual([
      [66, 89],
      [93, 107],
    ]);
    expect(p1.skipped.map((m) => [m.ruleId, m.fix?.range])).toEqual([['demo/no-loose-eq', [75, 77]]]);
    expect(p2.applied.map((m) => [m.ruleId, m.fix?.range])).toEqual([['demo/no-loose-eq', [78, 80]]]);
    expect(p2.text.slice(66, 89)).toBe("typeof code == 'string'");
    expect(p2.text.slice(78, 80)).toBe('==');
  });

  it('примеры демо — тот же текст и то же число проходов', () => {
    for (const e of t.DEMO_EXAMPLES) {
      const real = realFix(e.code);
      const mine = api.verifyAndFix(e.code, api.rules);
      expect(mine.output, e.id).toBe(real.output);
      expect(mine.passes.length + (mine.recheck ? 1 : 0), e.id).toBe(real.runs);
      expect(mine.messages.map(strip), e.id).toEqual(real.messages.map(strip));
    }
    // «Три сравнения»: первое правится на первом проходе, второе — на втором, третье — никогда.
    const chain = api.verifyAndFix(t.DEMO_EXAMPLES[2].code, api.rules);
    expect(chain.passes.map((p) => p.applied.length)).toEqual([2, 1, 0]);
    expect(chain.output).toBe("if (typeof a === 'string' && typeof c === 'b' && d != 0) {\n  run();\n}\n");
    expect(chain.messages.map((m) => m.message)).toEqual(['Нестрогое «!=»: нужно «!==».']);
  });

  it('встроенные yoda + eqeqeq: те же три прохода и тот же текст', () => {
    const r = realFix(t.DISCOUNT_CODE, [{ plugins: { demo: demoPlugin() }, rules: { yoda: 'error', eqeqeq: 'error', 'demo/counter': 'error' } }]);
    expect(r.runs).toBe(3);
    expect(r.output).toBe(t.DISCOUNT_FIXED);
  });

  it('no-var + prefer-const: var → let → const за три прохода', () => {
    const r = realFix('var total = 1;\nconsole.log(total);\n', [
      { plugins: { demo: demoPlugin() }, rules: { 'no-var': 'error', 'prefer-const': 'error', 'demo/counter': 'error' } },
    ]);
    expect(r.output).toBe('const total = 1;\nconsole.log(total);\n');
    expect(r.runs).toBe(3);
  });

  it('бесконечное правило: десять проходов и ещё одна проверка', () => {
    const semi = {
      meta: { fixable: 'code' },
      create: (ctx: { sourceCode: { text: string }; report(d: unknown): void }) => ({
        'Program:exit': (node: EsNode) => {
          const end = ctx.sourceCode.text.length;
          ctx.report({ node, message: 'ещё', fix: (f: { replaceTextRange(r: number[], s: string): unknown }) => f.replaceTextRange([end, end], ';') });
        },
      }),
    };
    const r = realFix('x\n', [{ plugins: { demo: demoPlugin({ semi }) }, rules: { 'demo/semi': 'error', 'demo/counter': 'error' } }]);
    const mine = api.verifyAndFix('x\n', { 'demo/semi': semi as unknown as Rule });
    expect(r.runs).toBe(11);
    expect(r.output).toBe(`x\n${';'.repeat(10)}`);
    expect(mine.output).toBe(r.output);
    expect(mine.passes).toHaveLength(10);
    expect(mine.recheck).toBe(true);
    expect(mine.messages.map(strip)).toEqual(r.messages.map(strip));
  });

  it('круговые правки: ESLint останавливается после трёх проходов с предупреждением', () => {
    const swap = (from: string, to: string) => ({
      meta: { fixable: 'code' },
      create: (ctx: { report(d: unknown): void }) => ({
        Identifier: (n: EsNode) => {
          if (n.name === from) ctx.report({ node: n, message: `${from}→${to}`, fix: (f: { replaceText(n: EsNode, s: string): unknown }) => f.replaceText(n, to) });
        },
      }),
    });
    // Предупреждение ESLint берёт process.emitWarning при создании Linter — поэтому новый, после подмены.
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    runs = 0;
    const output = new Linter().verifyAndFix('a;\n', [
      { plugins: { demo: demoPlugin({ ab: swap('a', 'b'), ba: swap('b', 'a') }) }, rules: { 'demo/ab': 'error', 'demo/ba': 'error', 'demo/counter': 'error' } },
    ]).output;
    expect(runs).toBe(3);
    expect(output).toBe('a;\n');
    expect(warn.mock.calls.some((c) => JSON.stringify(c).includes('ESLintCircularFixesWarning'))).toBe(true);
    const mine = api.verifyAndFix('a;\n', { ab: swap('a', 'b'), ba: swap('b', 'a') } as unknown as Record<string, Rule>);
    expect(mine.passes).toHaveLength(10);
  });

  it('правка вплотную к предыдущей откладывается — и у ESLint, и у applyFixes', () => {
    const pair = {
      meta: { fixable: 'code' },
      create: (ctx: { report(d: unknown): void }) => ({
        Program: (node: EsNode) => {
          ctx.report({ node, message: 'первая', fix: (f: { replaceTextRange(r: number[], s: string): unknown }) => f.replaceTextRange([0, 1], 'X') });
          ctx.report({ node, message: 'вторая', fix: (f: { replaceTextRange(r: number[], s: string): unknown }) => f.replaceTextRange([1, 2], 'Y') });
        },
      }),
    };
    const one = linter.verify('ab;\n', [{ plugins: { demo: demoPlugin({ pair }) }, rules: { 'demo/pair': 'error' } }]);
    const step = api.applyFixes('ab;\n', one as never);
    expect(step.applied).toHaveLength(1);
    expect(step.skipped).toHaveLength(1);
    expect(step.output).toBe('Xb;\n');
  });
});

describe('плоский конфиг: rulesFor против calculateConfigForFile', () => {
  const blocks = new Function(`return ${t.CONFIG_EXAMPLE.replace(/^export default /, '').replace(/;\s*$/, '')};`)() as Linter.Config[];
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ast-linters-')));
  for (const f of t.CONFIG_ROWS.map((r) => r.file)) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), 'var a = 1;\n');
  }
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: blocks });
  const match = (p: string, pat: string) => minimatch(p, pat, { dot: true });

  it('итог совпадает для всех файлов CONFIG_ROWS', async () => {
    for (const row of t.CONFIG_ROWS) {
      const real = (await eslint.calculateConfigForFile(row.file)) as { rules: Record<string, unknown[]> } | undefined;
      const mine = tools.rulesFor(row.file, [{ files: t.DEFAULT_FILES }, ...blocks], match);
      if (!real) {
        expect(mine, row.file).toBeUndefined();
        expect(row.rules).toBe('не проверяется');
        continue;
      }
      expect(mine, row.file).toEqual(real.rules);
    }
  });

  it('значения в таблице — те самые', async () => {
    const at = async (f: string) => ((await eslint.calculateConfigForFile(f)) as { rules: Record<string, unknown[]> }).rules;
    expect(await at('src/app.js')).toEqual({ eqeqeq: [2, 'smart'], 'no-console': [1, { allow: ['warn'] }], 'no-var': [2] });
    expect(await at('src/legacy/old.js')).toEqual({ eqeqeq: [1, 'smart'], 'no-console': [1, { allow: ['warn'] }], 'no-var': [0] });
    expect(await at('tools/run.cjs')).toEqual({ eqeqeq: [2, 'smart'], 'no-console': [2, { allow: ['warn'] }] });
    expect(await eslint.isPathIgnored('src/a.ts')).toBe(true);
    expect(await eslint.isPathIgnored('dist/x.js')).toBe(true);
  });

  it('живой пример: eslint.config.js сайта для SourceMapLab.vue', async () => {
    const project = new ESLint({ cwd: process.cwd() });
    const c = (await project.calculateConfigForFile('src/widgets/source-map-lab/ui/SourceMapLab.vue')) as {
      rules: Record<string, [number, { paths: { name: string }[]; patterns: { group: string[] }[] }]>;
    };
    expect(Object.keys(c.rules)).toHaveLength(214);
    const [, opts] = c.rules['no-restricted-imports'];
    expect(opts.paths.map((p) => p.name)).toEqual(['@ilomee/aura-vue', '@ilomee/aura-core', '@ilomee/aura-core/dom']);
    expect(opts.patterns.flatMap((p) => p.group)).toEqual(['@/pages/*', 'd3-*']);
    expect(t.PROJECT_NOTE).toContain('214 правил');
  }, 30_000);
});

describe('codemod и Prettier', () => {
  it('правки по range меняют только три строки', () => {
    const out = tools.codemod(t.MONEY_CODE);
    expect(out).toBe(t.CODEMOD_OUT);
    const a = t.MONEY_CODE.split('\n');
    const b = out.split('\n');
    expect(b).toHaveLength(a.length);
    expect(a.filter((line, i) => line !== b[i])).toHaveLength(3);
    expect(a.length - 1).toBe(8); // восемь строк и перевод в конце
  });

  it('Babel перепечатывает весь файл — REPRINT_OUT', () => {
    expect(tools.codemodReprint(t.MONEY_CODE)).toBe(t.REPRINT_OUT);
  });

  it('Prettier: вывод, повторный прогон без изменений, перенос после {', async () => {
    const out = await prettier.format(t.CODEMOD_OUT, { parser: 'babel' });
    expect(out).toBe(t.PRETTIER_OUT);
    expect(await prettier.format(out, { parser: 'babel' })).toBe(out);
    expect(await prettier.format(t.PRETTIER_OBJECT_IN, { parser: 'babel' })).toBe(t.PRETTIER_OBJECT_OUT);
  });

  it('встроенные правила: всего, устаревших, с исправлением; indent — до ESLint 11', () => {
    const all = [...builtinRules.values()];
    expect(all).toHaveLength(t.RULE_COUNTS.total);
    expect(all.filter((r) => r.meta?.deprecated)).toHaveLength(t.RULE_COUNTS.deprecated);
    expect(all.filter((r) => r.meta?.fixable)).toHaveLength(t.RULE_COUNTS.fixable);
    for (const name of ['indent', 'semi', 'quotes']) {
      const dep = builtinRules.get(name)?.meta?.deprecated as { deprecatedSince: string; availableUntil: string };
      expect(dep.deprecatedSince).toBe('8.53.0');
      expect(dep.availableUntil).toBe('11.0.0');
    }
    expect(t.FORMAT_RULES_NOTE).toContain(`из ${t.RULE_COUNTS.total} встроенных`);
    expect(t.FORMAT_RULES_NOTE).toContain(`устаревших ${t.RULE_COUNTS.deprecated}`);
  });
});
