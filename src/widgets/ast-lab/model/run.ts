import type { EsNode, LintApi, Rule, WalkEvent } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `WALK_CODE`, `RULES_CODE` и `LINT_CODE`
 * из темы «AST и линтеры».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/ast-linters.test.ts` против настоящего ESLint: тот же порядок посещения узлов,
 * те же сообщения, тот же итоговый текст и то же число проходов. Разбирает текст espree —
 * парсер самого ESLint, с теми же настройками, что ESLint ставит для `.js`-модуля.
 *
 * Свободные имена в строках темы — `KEYS` (какие поля узла — дети) и `parse` — подставляются
 * параметрами `new Function`: читатель видит их как данность, а тест и демо дают одно и то же.
 *
 * ⚠️ Парсер сюда **передают**, а не импортируют. espree с acorn внутри — около 180 КБ:
 * статический импорт отсюда утаскивал его в граф острова, и страница весила 376 КБ при пороге
 * 190 (`tests/e2e/weight.spec.ts`). Теперь виджет подгружает `./parser` через `import()` при
 * монтировании, а тест берёт его обычным импортом.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export interface Parser {
  KEYS: Record<string, readonly string[]>;
  parse(text: string): EsNode;
}

/** Собрать три строки темы в одну функцию: обход, правила, линтер. */
export function loadLint(walkCode: string, rulesCode: string, lintCode: string, parser: Parser): LintApi {
  return new Function(
    'KEYS',
    'parse',
    `${walkCode}\n${rulesCode}\n${lintCode}\nreturn { traverse, rules, verify, applyFixes, verifyAndFix };`,
  )(parser.KEYS, parser.parse) as LintApi;
}

/**
 * Обход для демо: вход и выход каждого узла и сообщения правил на нём.
 *
 * Идёт через учебный `verify`: первым «правилом» стоит служебное, которое пишет вход и выход
 * через `'*'` и `'*:exit'`, а у настоящих правил перехвачен `report`. Обработчики `'*'`
 * вызываются раньше обработчиков по типу, поэтому сообщение правила всегда относится
 * к последнему записанному шагу.
 */
export function traceWalk(api: LintApi, text: string, parser: Parser): WalkEvent[] {
  const events: WalkEvent[] = [];
  let depth = 0;
  const trace: Rule = {
    create: () => ({
      '*': (node) => {
        events.push({ kind: 'enter', node, depth: depth++, reports: [] });
      },
      '*:exit': (node) => {
        events.push({ kind: 'exit', node, depth: --depth, reports: [] });
      },
    }),
  };
  const wrapped: Record<string, Rule> = { trace };
  for (const [ruleId, rule] of Object.entries(api.rules)) {
    wrapped[ruleId] = {
      meta: rule.meta,
      create: (context) => {
        const ctx = context as { report(d: { message: string; fix?: unknown }): void };
        return rule.create({
          ...ctx,
          report: (d: { message: string; fix?: unknown }) => {
            events.at(-1)?.reports.push({ ruleId, message: d.message, fixable: Boolean(d.fix) });
            ctx.report(d);
          },
        });
      },
    };
  }
  api.verify(text, parser.parse(text), wrapped);
  return events;
}

/** Ошибка разбора — коротко, как её показал бы ESLint: «Parsing error: …» со строкой и колонкой. */
export function parseError(text: string, parser: Parser): string | null {
  try {
    parser.parse(text);
    return null;
  } catch (e) {
    const err = e as { message: string; lineNumber?: number; column?: number };
    const where = err.lineNumber ? ` (${err.lineNumber}:${err.column})` : '';
    return `Parsing error: ${err.message}${where}`;
  }
}
