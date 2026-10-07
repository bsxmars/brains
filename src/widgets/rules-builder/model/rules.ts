import type { Decision, Expr, PipelineCtx, Rule, RuleOutcome, When } from './types';

/**
 * Решение о запуске джоба: правила читаются сверху вниз, **первое совпавшее решает всё**.
 *
 * Отдельный модуль без Vue — по той же причине, что и `states.ts` у соседней темы: это
 * чистые функции, и их закрывает `tests/unit/gitlab-ci.test.ts`. Проверять тут есть что:
 * вся тема держится на том, что порядок правил важнее их содержания, а увидеть это
 * в описании конвейера нельзя — только вычислив.
 *
 * ЧТО ЗДЕСЬ СНЯТО ПРОГОНОМ. Поведение сверено с `gitlab-ci-local` 4.75.1 (он исполняет
 * `.gitlab-ci.yml` в Docker): первое совпавшее правило, `when: never` как исключение джоба,
 * отсутствие совпадений как отсутствие джоба в конвейере, непустая строка как истина
 * и `rules:variables` поверх `variables:` джоба. Что снять не удалось и взято из документации,
 * отмечено в комментариях по месту.
 */

/** Подстановка `$ИМЯ`: неизвестная переменная — пустая строка, а не ошибка. */
export function valueOf(token: string, ctx: PipelineCtx): string {
  if (!token.startsWith('$')) return token;
  const name = token.slice(1);

  if (name === 'CI_COMMIT_BRANCH') return ctx.branch ?? '';
  if (name === 'CI_COMMIT_TAG') return ctx.tag ?? '';
  if (name === 'CI_COMMIT_REF_NAME') return ctx.tag ?? ctx.branch ?? '';
  if (name === 'CI_PIPELINE_SOURCE') return ctx.source;

  return ctx.vars[name] ?? '';
}

const NEEDS_ESCAPE = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);

/**
 * Шаблон `changes:` в регулярное выражение — посимвольно, а не цепочкой замен.
 *
 * Цепочка `replace` здесь не работает: разбирать двойную звёздочку после того, как одиночная
 * уже превратилась в `[^/]*`, поздно, а прятать её под метку — значит завести в коде символ,
 * которого никто не ждёт. Один проход по строке избавляет от обоих трюков.
 *
 * Три вида звёздочки различаются так же, как у GitLab:
 */
// - двойная звёздочка со слешем (**/) пропускает любое число каталогов, включая ноль:
//   поэтому шаблон src/**/* берёт и файл, лежащий прямо в src/;
// - двойная без слеша пропускает что угодно, вместе со слешами;
// - одиночная через слеш не переходит.
export function matchesGlob(pattern: string, path: string): boolean {
  let source = '';

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '*') {
      if (pattern[i + 1] === '*' && pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += NEEDS_ESCAPE.has(char) ? `\\${char}` : char;
  }

  return new RegExp(`^${source}$`).test(path);
}

export function evalExpr(expr: Expr, ctx: PipelineCtx): boolean {
  switch (expr.op) {
    case 'eq':
      return valueOf(expr.left, ctx) === valueOf(expr.right, ctx);
    case 'ne':
      return valueOf(expr.left, ctx) !== valueOf(expr.right, ctx);
    case 'match':
      return new RegExp(expr.right).test(valueOf(expr.left, ctx));
    /**
     * `if: '$VAR'` — проверка «определена и непуста», а не «истинна».
     *
     * ⚠️ Строка `"false"` непуста, поэтому такое правило её пропускает. Снято прогоном:
     * джоб с `if: '$FALSE_FLAG'` при `FALSE_FLAG=false` оказался в конвейере как `on_success`.
     */
    case 'defined':
      return valueOf(expr.left, ctx) !== '';
    case 'and':
      return expr.parts.every((part) => evalExpr(part, ctx));
    case 'or':
      return expr.parts.some((part) => evalExpr(part, ctx));
  }
}

/** Совпало ли правило целиком: `if` и `changes` в одном правиле складываются по И. */
export function ruleMatches(rule: Rule, ctx: PipelineCtx): boolean {
  if (rule.if && !evalExpr(rule.if, ctx)) return false;
  if (rule.changes && !rule.changes.some((p) => ctx.changed.some((f) => matchesGlob(p, f)))) {
    return false;
  }
  // Правило без `if` и без `changes` совпадает всегда — и делает недостижимым всё, что ниже.
  return true;
}

/** Как правило выглядит в вердикте: когда `when` не написан, он `on_success`. */
const DEFAULT_WHEN: When = 'on_success';

export function decide(rules: Rule[], ctx: PipelineCtx): Decision {
  const outcomes: RuleOutcome[] = rules.map(() => 'unreached');

  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!ruleMatches(rule, ctx)) {
      outcomes[i] = 'missed';
      continue;
    }

    outcomes[i] = 'matched';
    const when = rule.when ?? DEFAULT_WHEN;

    return {
      included: when !== 'never',
      when,
      allowFailure: rule.allowFailure ?? false,
      matched: i,
      reason:
        when === 'never'
          ? `Правило ${i + 1} совпало и содержит when: never — джоба в конвейере не будет. Остальные правила не читались.`
          : `Правило ${i + 1} совпало первым: when = ${when}. Остальные правила не читались.`,
      outcomes,
      variables: rule.variables ?? {},
    };
  }

  /**
   * Ни одно правило не совпало — джоба в конвейере **нет**, и это не «пропущен».
   *
   * Разница видна там, где на джоб кто-то ссылается: пропущенный джоб существует, и на него
   * можно сослаться в `needs`, а отсутствующий — нет.
   */
  return {
    included: false,
    when: 'never',
    allowFailure: false,
    matched: null,
    reason: 'Ни одно правило не совпало — джоба в конвейере нет вовсе.',
    outcomes,
    variables: {},
  };
}
