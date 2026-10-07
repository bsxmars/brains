import { describe, expect, it } from 'vitest';
import {
  DEMO_LAYERS,
  DEMO_RULES,
  GRAPH_JOBS,
  GRAPH_STAGES,
  RULE_CHECK,
  RULE_CONTEXTS,
} from '@/content/delivery/gitlab-ci/data';
import { decide, evalExpr, matchesGlob, ruleMatches, valueOf } from '@/widgets/rules-builder/model/rules';
import { resolveVar, shadowed, strength, VAR_ORDER } from '@/widgets/rules-builder/model/vars';
import type { PipelineCtx } from '@/widgets/rules-builder/model/types';
import { byNeeds, byStages, gain } from '@/widgets/pipeline-graph/model/schedule';

/**
 * Две вещи, которые в теме «GitLab CI» обязаны совпадать с настоящим GitLab, — и обе ломались бы
 * молча: решение о запуске джоба и приоритет переменных.
 *
 * ЧТО ЗАКРЕПЛЕНО. Вердикты сняты прогоном: `gitlab-ci-local` 4.75.1 исполнял тот же
 * `.gitlab-ci.yml` в Docker (образ `alpine:3`) в четырёх контекстах — ветка `main`, ветка
 * `feature/x`, тег `v1.2.3` и `main` с заданными переменными. Таблица `RULE_CHECK` в `data.ts`
 * хранит его ответы, а тест требует, чтобы модель демо отвечала так же. Если завтра логику
 * правил «поправят на глаз», расхождение всплывёт здесь, а не на странице.
 *
 * ⚠️ Расписание по `needs` этим инструментом снять не удалось — он откладывает джоб
 * с непустым `needs` до конца стадии. Поэтому `byNeeds` проверяется как **расчёт**: тест
 * сторожит правила расстановки (кто кого ждёт и кто стартует сразу), а не совпадение
 * с записью, которой нет.
 */

describe('подстановка переменных в условие', () => {
  const ctx: PipelineCtx = {
    branch: 'main',
    tag: null,
    source: 'push',
    changed: [],
    vars: { DEPLOY: 'yes' },
  };

  it('неизвестная переменная — пустая строка, а не ошибка', () => {
    expect(valueOf('$NOPE', ctx)).toBe('');
  });

  it('на конвейере ветки тега нет, и наоборот', () => {
    expect(valueOf('$CI_COMMIT_TAG', ctx)).toBe('');
    const onTag: PipelineCtx = { ...ctx, branch: null, tag: 'v1.4.0' };
    expect(valueOf('$CI_COMMIT_BRANCH', onTag)).toBe('');
    expect(valueOf('$CI_COMMIT_REF_NAME', onTag)).toBe('v1.4.0');
  });

  it('литерал остаётся литералом', () => {
    expect(valueOf('main', ctx)).toBe('main');
    expect(valueOf('$DEPLOY', ctx)).toBe('yes');
  });
});

describe('шаблоны changes', () => {
  it('`src/**/*` берёт и файл в корне каталога, и файл в глубине', () => {
    expect(matchesGlob('src/**/*', 'src/app.ts')).toBe(true);
    expect(matchesGlob('src/**/*', 'src/deep/nested/app.ts')).toBe(true);
    expect(matchesGlob('src/**/*', 'docs/app.ts')).toBe(false);
  });

  it('одиночная звёздочка через слеш не переходит', () => {
    expect(matchesGlob('*.md', 'readme.md')).toBe(true);
    expect(matchesGlob('*.md', 'docs/readme.md')).toBe(false);
    expect(matchesGlob('docs/*.md', 'docs/readme.md')).toBe(true);
  });

  it('точка в шаблоне — это точка, а не «любой символ»', () => {
    expect(matchesGlob('package.json', 'packageXjson')).toBe(false);
  });
});

describe('вычисление условия', () => {
  const ctx: PipelineCtx = {
    branch: 'main',
    tag: null,
    source: 'push',
    changed: [],
    vars: { FLAG: '1', FALSE_FLAG: 'false', EMPTY: '' },
  };

  it('сравнение строк', () => {
    expect(evalExpr({ op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' }, ctx)).toBe(true);
    expect(evalExpr({ op: 'ne', left: '$CI_COMMIT_BRANCH', right: 'main' }, ctx)).toBe(false);
  });

  it('регулярное выражение', () => {
    const onTag: PipelineCtx = { ...ctx, branch: null, tag: 'v1.4.0' };
    expect(evalExpr({ op: 'match', left: '$CI_COMMIT_TAG', right: '^v[0-9]+' }, onTag)).toBe(true);
    expect(evalExpr({ op: 'match', left: '$CI_COMMIT_TAG', right: '^v[0-9]+' }, ctx)).toBe(false);
  });

  /**
   * Главная ловушка условий: `if: '$FLAG'` — это «строка непуста», а не «истина».
   * Снято прогоном: джоб с таким правилом при `FALSE_FLAG=false` попал в конвейер.
   */
  it('`$VAR` — это проверка на непустоту, и строка "false" её проходит', () => {
    expect(evalExpr({ op: 'defined', left: '$FLAG' }, ctx)).toBe(true);
    expect(evalExpr({ op: 'defined', left: '$FALSE_FLAG' }, ctx)).toBe(true);
    expect(evalExpr({ op: 'defined', left: '$EMPTY' }, ctx)).toBe(false);
    expect(evalExpr({ op: 'defined', left: '$NOPE' }, ctx)).toBe(false);
  });

  it('&& и ||', () => {
    const and = {
      op: 'and' as const,
      parts: [
        { op: 'eq' as const, left: '$CI_COMMIT_BRANCH', right: 'main' },
        { op: 'eq' as const, left: '$FLAG', right: '1' },
      ],
    };
    expect(evalExpr(and, ctx)).toBe(true);
    expect(evalExpr({ ...and, parts: [...and.parts, { op: 'eq', left: '$NOPE', right: 'x' }] }, ctx)).toBe(false);
    expect(evalExpr({ op: 'or', parts: [{ op: 'eq', left: '$NOPE', right: 'x' }, and] }, ctx)).toBe(true);
  });

  it('правило без if и без changes совпадает всегда', () => {
    expect(ruleMatches({ id: 'x', text: '- when: always', when: 'always' }, ctx)).toBe(true);
  });

  it('if и changes в одном правиле складываются по И', () => {
    const rule = {
      id: 'x',
      text: '',
      if: { op: 'eq' as const, left: '$CI_COMMIT_BRANCH', right: 'main' },
      changes: ['src/**/*'],
    };
    expect(ruleMatches(rule, ctx)).toBe(false);
    expect(ruleMatches(rule, { ...ctx, changed: ['src/app.ts'] })).toBe(true);
  });
});

describe('решение о запуске: первое совпавшее правило', () => {
  const ctx: PipelineCtx = { branch: 'main', tag: null, source: 'push', changed: [], vars: {} };

  const never = {
    id: 'never',
    text: '',
    if: { op: 'eq' as const, left: '$CI_COMMIT_BRANCH', right: 'main' },
    when: 'never' as const,
  };
  const always = { id: 'always', text: '', if: { op: 'defined' as const, left: '$CI_COMMIT_BRANCH' }, when: 'always' as const };

  it('when: never первым исключает джоб', () => {
    const decision = decide([never, always], ctx);
    expect(decision.included).toBe(false);
    expect(decision.matched).toBe(0);
    expect(decision.outcomes).toEqual(['matched', 'unreached']);
  });

  it('те же правила в обратном порядке дают другой конвейер', () => {
    const decision = decide([always, never], ctx);
    expect(decision.included).toBe(true);
    expect(decision.when).toBe('always');
    expect(decision.outcomes).toEqual(['matched', 'unreached']);
  });

  it('ни одно правило не совпало — джоба нет вовсе', () => {
    const decision = decide(
      [{ id: 'x', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'nope' } }],
      ctx,
    );
    expect(decision.included).toBe(false);
    expect(decision.matched).toBe(null);
    expect(decision.outcomes).toEqual(['missed']);
  });

  it('без when совпавшее правило означает on_success', () => {
    expect(decide([{ id: 'x', text: '' }], ctx).when).toBe('on_success');
  });

  it('rules:variables приходят от сработавшего правила, а не от всех подряд', () => {
    const decision = decide(
      [
        { id: 'a', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' }, variables: { TARGET: 'prod' } },
        { id: 'b', text: '', variables: { TARGET: 'staging' } },
      ],
      ctx,
    );
    expect(decision.variables).toEqual({ TARGET: 'prod' });
  });

  it('пустой список правил — это отсутствие джоба', () => {
    expect(decide([], ctx).included).toBe(false);
  });
});

/**
 * Сверка модели с записью прогона.
 *
 * `RULE_CHECK` хранит ответы `gitlab-ci-local` для каждого джоба в каждом контексте — ровно ту
 * таблицу, которую читатель видит на странице. Тест требует, чтобы модель демо повторила их
 * все: страница и движок демо не имеют права разойтись.
 */
describe('модель совпадает с прогоном gitlab-ci-local 4.75.1', () => {
  for (const job of RULE_CHECK) {
    for (const context of RULE_CONTEXTS) {
      it(`${job.name} в контексте «${context.label}» → ${job.verdict[context.id]}`, () => {
        const decision = decide(job.rules, context.ctx);
        expect(decision.when).toBe(job.verdict[context.id]);
      });
    }
  }
});

describe('правила демо остаются вычислимыми', () => {
  it('у каждого правила демо есть текст и уникальный id', () => {
    const ids = DEMO_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of DEMO_RULES) expect(rule.text.length).toBeGreaterThan(0);
  });

  it('порядок слоёв переменной в демо совпадает с порядком приоритета', () => {
    const order = DEMO_LAYERS.map((layer) => strength(layer.source));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe('приоритет переменных', () => {
  it('порядок слоёв — от слабого к сильному', () => {
    expect(VAR_ORDER).toEqual(['predefined', 'global', 'job', 'rules', 'dotenv', 'project', 'manual']);
  });

  /** Снято прогоном: `variables:` джоба перебивает корневые, а правило — джоба. */
  it('джоб сильнее корня файла, правило сильнее джоба', () => {
    expect(resolveVar([{ source: 'global', value: 'globals' }, { source: 'job', value: 'job' }])?.value).toBe('job');
    expect(resolveVar([{ source: 'job', value: 'job' }, { source: 'rules', value: 'rules' }])?.value).toBe('rules');
  });

  /** Снято прогоном: переменная проекта победила и `variables:` джоба, и `rules:variables`. */
  it('переменная проекта сильнее всего, что написано в файле', () => {
    const winner = resolveVar([
      { source: 'global', value: 'globals' },
      { source: 'job', value: 'job' },
      { source: 'rules', value: 'rules' },
      { source: 'project', value: 'project' },
    ]);
    expect(winner?.source).toBe('project');
  });

  /** Снято прогоном: запуск с переменной перебил и файл проекта. */
  it('переменная запуска сильнее переменной проекта', () => {
    expect(
      resolveVar([
        { source: 'project', value: 'project' },
        { source: 'manual', value: 'cli' },
      ])?.source,
    ).toBe('manual');
  });

  it('порядок в списке ничего не значит — значит только слой', () => {
    const layers = [
      { source: 'manual' as const, value: 'cli' },
      { source: 'global' as const, value: 'globals' },
    ];
    expect(resolveVar(layers)?.value).toBe('cli');
    expect(resolveVar([...layers].reverse())?.value).toBe('cli');
  });

  it('нигде не задана — значит пустая строка в условии, а не ошибка', () => {
    expect(resolveVar([])).toBe(null);
  });

  it('проигравшие возвращаются от сильного к слабому', () => {
    const losers = shadowed([
      { source: 'global', value: 'globals' },
      { source: 'manual', value: 'cli' },
      { source: 'job', value: 'job' },
    ]);
    expect(losers.map((layer) => layer.source)).toEqual(['job', 'global']);
  });

  it('неизвестный слой — это ошибка, а не молчаливый ноль', () => {
    // @ts-expect-error — слой, которого нет в перечислении
    expect(() => strength('whatever')).toThrow();
  });
});

describe('расстановка джобов во времени', () => {
  const stages = byStages(GRAPH_JOBS, GRAPH_STAGES);
  const needs = byNeeds(GRAPH_JOBS, GRAPH_STAGES);

  const at = (schedule: typeof stages, name: string) => schedule.jobs.find((job) => job.name === name)!;

  it('при стадиях следующая начинается по самому долгому джобу предыдущей', () => {
    const slowest = Math.max(
      ...GRAPH_JOBS.filter((job) => job.stage === GRAPH_STAGES[0]).map((job) => job.ms),
    );
    for (const job of GRAPH_JOBS.filter((j) => j.stage === GRAPH_STAGES[1])) {
      expect(at(stages, job.name).start).toBe(slowest);
    }
  });

  it('при стадиях джоб ждёт и тех, чей результат ему не нужен', () => {
    expect(at(stages, 'test:unit').waitedFor).toContain('build:a');
    expect(at(stages, 'test:unit').stageGated).toBe(true);
  });

  it('пустой needs означает старт сразу', () => {
    expect(at(needs, 'test:lint').start).toBe(0);
    expect(at(needs, 'test:lint').waitedFor).toEqual([]);
  });

  it('с needs джоб ждёт только названных', () => {
    const unit = at(needs, 'test:unit');
    expect(unit.start).toBe(at(needs, 'build:b').end);
    expect(unit.waitedFor).toEqual(['build:b']);
  });

  it('needs ускоряет конкретный джоб, а не конвейер целиком', () => {
    expect(gain(stages, needs, 'deploy')).toBeGreaterThan(0);
    // Долгий джоб никуда не делся: общая длина конвейера держится им.
    expect(needs.total).toBe(at(needs, 'build:a').end);
  });

  it('джоб без ключа needs остаётся на лестнице стадий', () => {
    const jobs = [
      { name: 'a', stage: 'build', ms: 1000 },
      { name: 'b', stage: 'test', ms: 500 },
    ];
    expect(byNeeds(jobs, ['build', 'test']).jobs[1].start).toBe(1000);
  });

  it('needs на несуществующий джоб — ошибка, а не тихий ноль', () => {
    expect(() =>
      byNeeds([{ name: 'a', stage: 'test', ms: 1, needs: ['нет-такого'] }], ['build', 'test']),
    ).toThrow(/нет в конвейере/);
  });

  it('цикл в needs обнаруживается, а не вешает расчёт', () => {
    expect(() =>
      byNeeds(
        [
          { name: 'a', stage: 'test', ms: 1, needs: ['b'] },
          { name: 'b', stage: 'test', ms: 1, needs: ['a'] },
        ],
        ['test'],
      ),
    ).toThrow(/цикл/);
  });
});
