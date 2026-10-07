import { describe, expect, it } from 'vitest';
// `yaml` приходит в проект транзитивно (через Astro и языковой сервер YAML), прямой зависимостью
// он не объявлен. Если он пропадёт из `node_modules`, этот файл упадёт на импорте — громко,
// а не молча зелёным.
import { parse, parseAllDocuments } from 'yaml';
import * as compose from '@/content/delivery/compose/data';
import * as k8s from '@/content/delivery/kubernetes/data';
import * as actions from '@/content/delivery/github-actions/data';
import * as gitlab from '@/content/delivery/gitlab-ci/data';

/**
 * Конфиги, дописанные в темы направления «Доставка» **по документации, а не прогоном**.
 *
 * Ни Docker, ни кластер, ни раннер здесь не запускаются — и этот файл не делает вид, что
 * проверяет поведение. Он закрывает то, что закрыть можно без них:
 *
 *  1. листинг, который читатель скопирует, — синтаксически валидный YAML (без дублей ключей);
 *  2. в нём стоят именно те ключи, о которых говорит текст рядом (поле, названное в карточке,
 *     не потерялось при правке листинга);
 *  3. арифметика в комментариях сходится (матрица «2 × 2 = четыре джоба»).
 *
 * Листинги с несколькими файлами (вызываемый и вызывающий конвейер, шаблон и потребитель)
 * делятся на куски по пустой строке, за которой идёт комментарий с первой колонки: так они
 * и написаны. Строки, начинающиеся с `$ ` (команды оболочки), из разбора выброшены.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- разобранный YAML произвольной формы: поля читаются цепочкой, форма заранее неизвестна
type Doc = Record<string, any>;

/** Разобрать листинг: выбросить команды оболочки, разделить на файлы, вернуть все документы. */
function docs(code: string): Doc[] {
  const withoutShell = code
    .split('\n')
    .filter((line) => !line.startsWith('$ '))
    .join('\n');
  const parts = withoutShell.split(/\n\s*\n(?=# )/);
  const out: Doc[] = [];
  for (const part of parts) {
    for (const d of parseAllDocuments(part)) {
      expect(d.errors, `ошибка YAML в листинге:\n${part}`).toEqual([]);
      const value = d.toJS();
      if (value !== null && value !== undefined) out.push(value as Doc);
    }
  }
  return out;
}

/** Один документ — листинг из одного файла. */
function one(code: string): Doc {
  const all = docs(code);
  expect(all).toHaveLength(1);
  return all[0];
}

describe('Kubernetes: манифесты темы разбираются и называют верный API', () => {
  const cases: [string, string, string, string][] = [
    ['MANIFEST_CODE', k8s.MANIFEST_CODE, 'apps/v1', 'Deployment'],
    ['SERVICE_CODE', k8s.SERVICE_CODE, 'v1', 'Service'],
    ['CRONJOB_CODE', k8s.CRONJOB_CODE, 'batch/v1', 'CronJob'],
    ['NETPOL_CODE', k8s.NETPOL_CODE, 'networking.k8s.io/v1', 'NetworkPolicy'],
    ['PDB_CODE', k8s.PDB_CODE, 'policy/v1', 'PodDisruptionBudget'],
    ['HPA_CODE', k8s.HPA_CODE, 'autoscaling/v2', 'HorizontalPodAutoscaler'],
  ];
  for (const [name, code, apiVersion, kind] of cases) {
    it(`${name}: ${apiVersion} ${kind}`, () => {
      const m = one(code);
      expect(m.apiVersion).toBe(apiVersion);
      expect(m.kind).toBe(kind);
    });
  }

  it('Deployment: метки шаблона попадают под селектор', () => {
    const m = one(k8s.MANIFEST_CODE);
    const sel = m.spec.selector.matchLabels;
    const labels = m.spec.template.metadata.labels;
    for (const [k, v] of Object.entries(sel)) expect(labels[k]).toBe(v);
  });

  it('CronJob: у пода Job restartPolicy — только OnFailure или Never', () => {
    const m = one(k8s.CRONJOB_CODE);
    const policy = m.spec.jobTemplate.spec.template.spec.restartPolicy;
    expect(['OnFailure', 'Never']).toContain(policy);
    expect(m.spec.concurrencyPolicy).toBe('Forbid');
    // Cron из пяти полей, а не из шести (секунд у CronJob нет).
    expect(String(m.spec.schedule).split(' ')).toHaveLength(5);
  });

  it('PDB: указано одно из двух — minAvailable или maxUnavailable', () => {
    const s = one(k8s.PDB_CODE).spec;
    expect(('minAvailable' in s) !== ('maxUnavailable' in s)).toBe(true);
  });

  it('HPA: цель — тот же Deployment, что в манифесте темы', () => {
    const h = one(k8s.HPA_CODE).spec;
    const d = one(k8s.MANIFEST_CODE);
    expect(h.scaleTargetRef).toMatchObject({ kind: 'Deployment', name: d.metadata.name });
    expect(h.minReplicas).toBeLessThanOrEqual(h.maxReplicas);
  });

  it('NetworkPolicy ограничивает входящие соединения', () => {
    const p = one(k8s.NETPOL_CODE).spec;
    expect(p.policyTypes).toEqual(['Ingress']);
    expect(p.ingress[0].from[0].podSelector.matchLabels).toBeTruthy();
  });

  it('пробы: у всех трёх есть обработчик и порог', () => {
    const p = parse(k8s.PROBE_CODE) as Doc;
    for (const key of ['readinessProbe', 'livenessProbe', 'startupProbe']) {
      expect(p[key].httpGet).toBeTruthy();
      expect(typeof p[key].failureThreshold).toBe('number');
    }
    // «до 150 с на старт» в комментарии — это periodSeconds × failureThreshold.
    expect(p.startupProbe.periodSeconds * p.startupProbe.failureThreshold).toBe(150);
  });
});

describe('Compose: листинги, дописанные по документации', () => {
  it('BUILD_CODE: build с target и args рядом с image', () => {
    const api = one(compose.BUILD_CODE).services.api;
    expect(api.build).toMatchObject({ context: '.', target: 'runtime' });
    expect(api.build.args.NODE_VERSION).toBe('22');
    expect(typeof api.image).toBe('string');
  });

  it('WATCH_CODE: действия sync и rebuild', () => {
    const watch = one(compose.WATCH_CODE).services.web.develop.watch;
    expect(watch.map((w: Doc) => w.action)).toEqual(['sync', 'rebuild']);
  });

  it('NET_CODE, STOP_CODE, PROFILE_CODE разбираются', () => {
    expect(one(compose.NET_CODE).networks.back.internal).toBe(true);
    expect(one(compose.STOP_CODE).services.stubborn.stop_grace_period).toBe('3s');
    expect(one(compose.PROFILE_CODE).services.debugger.profiles).toEqual(['debug']);
  });
});

describe('GitHub Actions: свои раннеры, переиспользование, окружения', () => {
  it('SELF_HOSTED_CODE: runs-on — список меток, первая self-hosted', () => {
    const runsOn = one(actions.SELF_HOSTED_CODE).jobs.e2e['runs-on'];
    expect(Array.isArray(runsOn)).toBe(true);
    expect(runsOn[0]).toBe('self-hosted');
  });

  it('COMPOSITE_CODE: у каждого run в составном действии есть shell', () => {
    const [action, usage] = docs(actions.COMPOSITE_CODE);
    expect(action.runs.using).toBe('composite');
    const runSteps = action.runs.steps.filter((s: Doc) => 'run' in s);
    expect(runSteps.length).toBeGreaterThan(0);
    for (const s of runSteps) expect(s.shell).toBeTruthy();
    // вход, который передаёт конвейер, объявлен в действии
    const used = usage.steps.find((s: Doc) => String(s.uses).startsWith('./'));
    for (const k of Object.keys(used.with)) expect(action.inputs).toHaveProperty(k);
  });

  it('CALL_CODE: uses на уровне джоба, секреты и входы совпадают с объявленными', () => {
    const [callee, caller] = docs(actions.CALL_CODE);
    const call = callee.on.workflow_call;
    const job = caller.jobs.staging;
    expect(job.uses).toMatch(/^\.\/\.github\/workflows\/.+\.ya?ml$/);
    expect(job.steps).toBeUndefined();
    expect(job['runs-on']).toBeUndefined();
    for (const k of Object.keys(job.with)) expect(call.inputs).toHaveProperty(k);
    for (const k of Object.keys(job.secrets)) expect(call.secrets).toHaveProperty(k);
    for (const [k, spec] of Object.entries(call.inputs) as [string, Doc][]) {
      if (spec.required) expect(job.with).toHaveProperty(k);
    }
  });

  it('ENVIRONMENT_CODE: окружение, его url и concurrency с тем же именем', () => {
    const job = one(actions.ENVIRONMENT_CODE).jobs.deploy;
    expect(job.environment.name).toBe('production');
    expect(job.environment.url).toMatch(/^https:\/\//);
    expect(job.concurrency).toBe(job.environment.name);
  });

  it('SUMMARY_CODE: пишет в $GITHUB_STEP_SUMMARY и печатает команды раннеру', () => {
    const step = (one(actions.SUMMARY_CODE) as unknown as Doc[])[0];
    expect(step.run).toContain('>> $GITHUB_STEP_SUMMARY');
    expect(step.run).toMatch(/::warning file=[^:]+::/);
    expect(step.run).toContain('::add-mask::');
  });
});

describe('GitLab CI: раннеры, конвейеры MR, выкат, матрица, дочерние конвейеры, компоненты', () => {
  it('RUNNER_TAGS_CODE: tags — массив из двух тегов', () => {
    expect(one(gitlab.RUNNER_TAGS_CODE).e2e.tags).toEqual(['docker', 'gpu']);
  });

  it('MR_CODE: рецепт workflow:rules из документации', () => {
    const rules = one(gitlab.MR_CODE).workflow.rules;
    expect(rules).toHaveLength(3);
    expect(rules[0].if).toBe('$CI_PIPELINE_SOURCE == "merge_request_event"');
    expect(rules[1]).toMatchObject({ if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS', when: 'never' });
    expect(rules[2].if).toBe('$CI_COMMIT_BRANCH');
  });

  it('DEPLOY_CODE: ручной выкат через rules, очередь по имени окружения', () => {
    const job = one(gitlab.DEPLOY_CODE)['deploy:prod'];
    expect(job.environment.name).toBe('production');
    expect(job.resource_group).toBe(job.environment.name);
    expect(job.rules[0].when).toBe('manual');
    // «when: manual в rules» — карточка говорит именно про эту запись, а не про when на джобе
    expect(job.when).toBeUndefined();
  });

  it('MATRIX_CODE: 2 × 2 = четыре джоба, как в комментарии', () => {
    const matrix = one(gitlab.MATRIX_CODE).test.parallel.matrix as Record<string, string[]>[];
    const jobs = matrix.reduce(
      (sum, row) => sum + Object.values(row).reduce((p, v) => p * (Array.isArray(v) ? v.length : 1), 1),
      0,
    );
    expect(jobs).toBe(4);
    expect(gitlab.MATRIX_CODE).toContain('2 × 2 = четыре джоба');
  });

  it('CHILD_CODE: strategy depend и дочерний конвейер из артефакта того джоба, от которого он зависит', () => {
    const all = docs(gitlab.CHILD_CODE);
    const merged = Object.assign({}, ...all);
    expect(merged.frontend.trigger.strategy).toBe('depend');
    const gen = merged['run-generated'];
    const src = gen.trigger.include[0];
    expect(gen.needs).toContain(src.job);
    expect(merged[src.job].artifacts.paths).toContain(src.artifact);
  });

  it('COMPONENT_CODE: вход, переданный потребителем, объявлен в spec, версия после @', () => {
    const [spec, template, consumer] = docs(gitlab.COMPONENT_CODE);
    expect(spec.spec.inputs).toHaveProperty('node-version');
    expect(template.test.image).toBe('node:$[[ inputs.node-version ]]');
    const inc = consumer.include[0];
    expect(inc.component).toMatch(/@\d+\.\d+\.\d+$/);
    for (const k of Object.keys(inc.inputs)) expect(spec.spec.inputs).toHaveProperty(k);
  });
});
