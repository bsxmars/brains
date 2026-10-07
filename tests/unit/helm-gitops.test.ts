import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import * as t from '@/content/delivery/helm-gitops/data';
import { inputsOf, loadModel } from '@/widgets/kz-envs/model/run';
import type { Doc, Env } from '@/widgets/kz-envs/model/types';

/**
 * Тема «Один манифест на много окружений: Helm, Kustomize и GitOps».
 *
 * Ни kubectl, ни kustomize, ни helm здесь нет и не будет — поэтому проверяется то, что
 * проверить можно без них:
 *
 *  1. **Модель слияния.** `MODEL_PARTS` — строки из темы: две напечатаны на странице, все
 *     исполняет демо. Через них прогоняются таблицы случаев **из документации** — strategic
 *     merge (kubernetes.io и описание SMP), приложения A из RFC 7386 и RFC 6902, пример
 *     `images` из справочника kustomize, порядок values и синтаксис `--set` из документации
 *     Helm, поведение шаблонов — и ответ сверяется с литералом из `data.ts`.
 *  2. **Разбор YAML.** Служебный разборщик модели обязан читать листинги так же, как пакет
 *     `yaml`, иначе демо показывает одно, а считает другое. Каждый листинг темы разбирается
 *     без ошибок и дублей ключей.
 *  3. **Сквозной пример.** Таблицы на странице — окружения, имена ConfigMap, приставка —
 *     пересчитываются моделью обоими способами. Имена согласованы: цели патчей есть в базе,
 *     ключи values — в `values.yaml`, пути Argo CD и Flux — среди слоёв, команды — среди файлов.
 */

const M = loadModel(t.MODEL_PARTS);
const ENVS: Env[] = ['dev', 'stage', 'prod'];

/** Разбор пакетом `yaml`: ошибки и повторы ключей — красный тест. */
function yamlDocs(code: string): Doc[] {
  return parseAllDocuments(code).map((d) => {
    expect(d.errors, `ошибка YAML:\n${code}`).toEqual([]);
    return d.toJS();
  });
}

const flow = (s: string): Doc => M.parseYaml(s)[0];

/** Порядок элементов модель не воспроизводит — сравниваем списки с именами без него. */
function unordered(v: Doc): Doc {
  if (Array.isArray(v)) {
    const items = v.map(unordered);
    const named = items.every((x) => x && typeof x === 'object' && !Array.isArray(x) && typeof x.name === 'string');
    return named ? [...items].sort((a, b) => a.name.localeCompare(b.name)) : items;
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unordered(x)]));
  return v;
}

const kz = (env: Env | 'base', mode: 'strategic' | 'replace' = 'strategic') =>
  M.kustomize(t.FILES, env === 'base' ? 'base' : `overlays/${env}`, mode);
const helmDocs = (env: Env) => M.parseYaml(M.helmRelease(t.FILES, t.COMMANDS[env]).text);
const cell = (s: string) => s.replace(/`/g, '');

describe('разбор YAML: модель читает листинги так же, как пакет yaml', () => {
  const plain = Object.entries(t.FILES).filter(([path]) => !path.includes('/templates/'));

  it('файлов сквозного примера достаточно, чтобы проверка что-то значила', () => {
    expect(plain.length).toBeGreaterThanOrEqual(14);
  });

  for (const [path, text] of plain) {
    it(path, () => {
      expect(M.parseYaml(text)).toEqual(yamlDocs(text));
    });
  }

  for (const env of ENVS) {
    it(`helm template для ${env}: итог — корректный YAML, и модель читает его так же`, () => {
      const text = M.helmRelease(t.FILES, t.COMMANDS[env]).text;
      expect(M.parseYaml(text)).toEqual(yamlDocs(text));
    });

    for (const mode of ['strategic', 'replace'] as const) {
      it(`kustomize ${env} (${mode}): напечатанное читается обратно тем же объектом`, () => {
        const objs = kz(env, mode);
        expect(yamlDocs(M.dumpAll(objs))).toEqual(objs);
      });
    }
  }

  it('листинги GitOps, секретов и фрагменты разбираются без ошибок', () => {
    for (const code of [t.ARGO_CODE, t.FLUX_CODE, t.SEALED_CODE, t.SOPS_CODE, t.PREFIX_CODE, t.IMAGES_CODE]) {
      expect(yamlDocs(code).length).toBeGreaterThan(0);
    }
  });

  it('разборщик модели ловит повтор ключа — как и пакет yaml', () => {
    expect(() => M.parseYaml('a: 1\na: 2')).toThrow(/повторяется/);
    expect(parseAllDocuments('a: 1\na: 2')[0].errors.length).toBeGreaterThan(0);
  });
});

describe('strategic merge и JSON merge patch: случаи из документации Kubernetes', () => {
  for (const c of t.SMP_CASES) {
    it(`${c.what} (${c.src})`, () => {
      const base = flow(c.base);
      const patch = flow(c.patch);
      const at = c.at.split('.');
      expect(unordered(M.strategicMerge(base, patch, c.kind, at))).toEqual(unordered(flow(c.strategic)));
      expect(M.jsonMergePatch(base, patch)).toEqual(flow(c.jsonMerge));
    });
  }

  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.SMP_TABLE.rows).toHaveLength(t.SMP_CASES.length);
    expect(t.SMP_CASES.every((c) => c.src in t.CASE_SOURCES)).toBe(true);
  });

  it('база не меняется на месте — патч возвращает новый объект', () => {
    const base = flow('{containers: [{name: app, image: web}]}');
    const before = JSON.stringify(base);
    M.strategicMerge(base, flow('{containers: [{name: app, image: web2}]}'), 'Deployment', ['spec', 'template', 'spec']);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('JSON merge patch: все примеры приложения A из RFC 7386', () => {
  it('их пятнадцать', () => {
    expect(t.JSON_MERGE_CASES).toHaveLength(15);
  });
  for (const [target, patch, want] of t.JSON_MERGE_CASES) {
    it(`${target} + ${patch} = ${want}`, () => {
      expect(M.jsonMergePatch(JSON.parse(target), JSON.parse(patch))).toEqual(JSON.parse(want));
    });
  }
});

describe('JSON patch: примеры приложения A из RFC 6902', () => {
  for (const c of t.JSON_PATCH_CASES) {
    it(`${c.n}: ${c.ops}`, () => {
      const run = () => M.jsonPatch(JSON.parse(c.doc), JSON.parse(c.ops));
      if (c.want === null) expect(run).toThrow();
      else expect(run()).toEqual(JSON.parse(c.want));
    });
  }
});

describe('kustomize: images — пример из справочника', () => {
  it('правила в листинге совпадают с теми, что прогоняет тест', () => {
    expect(yamlDocs(t.IMAGES_CODE)[0].images).toEqual(t.IMAGE_RULES);
  });
  for (const c of t.IMAGE_CASES) {
    it(`${c.from} → ${c.to}`, () => {
      expect(M.setImage(c.from, t.IMAGE_RULES)).toBe(c.to);
    });
  }
  it('таблица на странице — из тех же случаев', () => {
    expect(t.IMAGES_TABLE.rows.map((r) => r.map(cell))).toEqual(t.IMAGE_CASES.map((c) => [c.from, c.to]));
  });
  it('правило совпадает по имени образа целиком, а не по хвосту', () => {
    expect(M.setImage('registry.example.com/shop/web:1.4.0', [{ name: 'web', newTag: '9' }])).toBe('registry.example.com/shop/web:1.4.0');
  });
});

describe('Helm: values — порядок и слияние из документации', () => {
  for (const c of t.VALUES_CASES) {
    it(`${c.what} (${c.src})`, () => {
      const got = M.helmValues(flow(c.chart), c.files.map(flow), c.sets);
      expect(got).toEqual(flow(c.want));
    });
  }

  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.VALUES_TABLE.rows).toHaveLength(t.VALUES_CASES.length);
  });

  for (const c of t.SET_CASES) {
    it(`--set ${c.expr}`, () => {
      expect(M.applySet({}, c.expr)).toEqual(flow(c.want));
    });
  }

  it('индексы списков модель честно не разбирает', () => {
    expect(() => M.parseSet('servers[0].port=80')).toThrow(/не поддержаны/);
  });

  it('--set поверх -f, даже если стоит в команде левее', () => {
    const c = M.parseHelmCommand('helm upgrade --install web ./chart --set image.tag=9 -f values-prod.yaml');
    const v = M.helmValues({ image: { tag: '' } }, [{ image: { tag: '1' } }], c.sets);
    expect(v.image.tag).toBe(9);
  });
});

describe('Helm: шаблоны', () => {
  for (const c of t.TEMPLATE_CASES) {
    it(`${c.tpl} ← ${c.values}`, () => {
      const root = { Values: flow(c.values), Release: { Name: 'web' }, Chart: { Name: 'web', AppVersion: '1.4.0' } };
      if (c.error) expect(() => M.renderTemplate(c.tpl, root)).toThrow(c.out);
      else expect(M.renderTemplate(c.tpl, root)).toBe(c.out);
    });
  }

  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.TEMPLATE_TABLE.rows).toHaveLength(t.TEMPLATE_CASES.length);
  });

  it('`{{-` съедает перевод строки, `-}}` — пробелы справа', () => {
    expect(M.renderTemplate('a:\n  {{- " b" }}', { Values: {} })).toBe('a: b');
    expect(M.renderTemplate('{{ "x" -}}\n  y', { Values: {} })).toBe('xy');
  });

  it('хук миграции рендерится в корректный Job с тем же образом, что у приложения', () => {
    const { values } = M.helmRelease(t.FILES, t.COMMANDS.prod);
    const root = { Values: values, Release: { Name: 'web' }, Chart: { Name: 'web', AppVersion: '1.4.0' } };
    const [job] = yamlDocs(M.renderTemplate(t.HOOK_CODE, root));
    expect(job.kind).toBe('Job');
    expect(job.metadata.annotations['helm.sh/hook']).toContain('pre-upgrade');
    const app = helmDocs('prod').find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers[0];
    expect(job.spec.template.spec.containers[0].image).toBe(app.image);
  });
});

describe('сквозной пример: таблица окружений пересчитывается обоими способами', () => {
  const HEAD = t.ENV_TABLE.head.slice(1) as Env[];
  const row = (label: string) => {
    const r = t.ENV_TABLE.rows.find((x) => cell(x[0]) === label);
    expect(r, `в ENV_TABLE нет строки «${label}»`).toBeDefined();
    return Object.fromEntries(HEAD.map((env, i) => [env, cell(r![i + 1])]));
  };

  it('столбцы — те же три окружения', () => {
    expect(HEAD).toEqual(ENVS);
  });

  for (const tool of ['kustomize', 'helm'] as const) {
    for (const env of ENVS) {
      it(`${tool} · ${env}`, () => {
        const docs = tool === 'kustomize' ? kz(env) : helmDocs(env);
        const f = M.factsOf(docs);
        const app = f.containers.find((c) => c.name === 'app')!;
        const deploy = docs.find((d: Doc) => d.kind === 'Deployment');
        const appSpec = deploy.spec.template.spec.containers.find((c: Doc) => c.name === 'app');

        expect(String(f.replicas)).toBe(row('реплик')[env]);
        expect(app.image!.split(':').pop()).toBe(row('тег образа')[env]);
        expect(f.host).toBe(row('домен')[env]);
        expect(f.config!.data.API_URL).toBe(row('API_URL')[env]);
        expect(f.containers.some((c) => c.name === 'log-agent') ? 'есть' : 'нет').toBe(row('сборщик логов')[env]);
        expect(appSpec.resources?.limits?.memory ?? 'нет').toBe(row('лимит памяти')[env]);
      });
    }
  }

  it('prod: словарь resources слился вглубь в обоих способах одинаково', () => {
    const k = kz('prod').find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers[0].resources;
    const h = helmDocs('prod').find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers[0].resources;
    expect(k).toEqual({ requests: { cpu: '250m', memory: '128Mi' }, limits: { memory: '512Mi' } });
    expect(h).toEqual(k);
  });

  it('dev: способы расходятся ровно на списке — Helm теряет TZ, strategic merge нет', () => {
    const env = (docs: Doc[]) => M.factsOf(docs).containers.find((c) => c.name === 'app')!.env;
    expect(env(kz('dev'))).toEqual(['LOG_LEVEL', 'TZ']);
    expect(env(helmDocs('dev'))).toEqual(['LOG_LEVEL']);
    expect(t.FILES['values-dev.yaml']).toContain('TZ пропадёт');
    expect(t.PITFALLS.find((p) => p.n === '01')?.d).toContain('`TZ` исчезает');
  });
});

describe('сквозной пример: ловушка замены списка', () => {
  it('prod с заменой списка: сборщик логов пропал, у app нет образа, портов и переменных', () => {
    const f = M.factsOf(kz('prod', 'replace'));
    expect(f.containers.map((c) => c.name)).toEqual(['app']);
    expect(f.containers[0].image).toBeNull();
    expect(f.containers[0].env).toEqual([]);
    const app = kz('prod', 'replace').find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers[0];
    expect(app.ports).toBeUndefined();
    expect(app.envFrom).toBeUndefined();
  });

  it('dev с заменой списка: директива $patch осталась обычным полем', () => {
    const containers = kz('dev', 'replace').find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers;
    expect(containers.find((c: Doc) => c.name === 'log-agent').$patch).toBe('delete');
  });

  it('демо показывает потери строками базы', () => {
    const v = M.buildView(t.FILES, t.COMMANDS, 'prod', 'kustomize', 'replace');
    expect(v.gone.some((l) => l.includes('log-agent'))).toBe(true);
    expect(v.gone.some((l) => l.includes('containerPort: 8080'))).toBe(true);
    const ok = M.buildView(t.FILES, t.COMMANDS, 'prod', 'kustomize', 'strategic');
    expect(ok.gone.some((l) => l.includes('log-agent'))).toBe(false);
  });
});

describe('сквозной пример: ConfigMap с хешем в имени', () => {
  const configName = (env: Env | 'base') => kz(env).find((d: Doc) => d.kind === 'ConfigMap').metadata.name;

  it('таблица имён на странице пересчитывается моделью', () => {
    const dirs: Record<string, Env | 'base'> = {
      '`base`': 'base',
      '`overlays/dev`': 'dev',
      '`overlays/stage`': 'stage',
      '`overlays/prod`': 'prod',
    };
    for (const r of t.HASH_TABLE.rows) {
      expect(cell(r[2])).toBe(configName(dirs[r[0]]));
    }
  });

  it('другое содержимое — другое имя; то же содержимое — то же имя', () => {
    expect(configName('dev')).not.toBe(configName('base'));
    expect(configName('prod')).toBe(configName('base'));
    expect(t.HASH_NOTE).toContain('У prod имя совпало с базой');
  });

  it('ссылка в Deployment переписана на имя с хешем — значит, меняется шаблон пода', () => {
    for (const env of ENVS) {
      const docs = kz(env);
      const deploy = docs.find((d: Doc) => d.kind === 'Deployment');
      expect(deploy.spec.template.spec.containers[0].envFrom[0].configMapRef.name).toBe(configName(env));
    }
    const pod = (env: Env) => JSON.stringify(kz(env).find((d: Doc) => d.kind === 'Deployment').spec.template);
    expect(pod('stage')).not.toBe(JSON.stringify(kz('base').find((d: Doc) => d.kind === 'Deployment').spec.template));
  });

  it('Helm имени не меняет: ConfigMap называется одинаково во всех окружениях', () => {
    const names = ENVS.map((env) => helmDocs(env).find((d: Doc) => d.kind === 'ConfigMap').metadata.name);
    expect(new Set(names).size).toBe(1);
  });
});

describe('сквозной пример: приставка к именам переписывает ссылки', () => {
  const files = { ...t.FILES, 'overlays/pr-128/kustomization.yaml': t.PREFIX_CODE };
  const docs = M.kustomize(files, 'overlays/pr-128');

  it('объекты получили приставку и пространство имён', () => {
    for (const d of docs) {
      expect(d.metadata.name.startsWith('pr-128-web')).toBe(true);
      expect(d.metadata.namespace).toBe('shop-preview');
    }
  });

  it('Ingress и Deployment ссылаются на переименованные объекты — как обещает PREFIX_NOTE', () => {
    const ingress = docs.find((d: Doc) => d.kind === 'Ingress');
    const deploy = docs.find((d: Doc) => d.kind === 'Deployment');
    const config = docs.find((d: Doc) => d.kind === 'ConfigMap');
    expect(ingress.spec.rules[0].http.paths[0].backend.service.name).toBe('pr-128-web');
    expect(deploy.spec.template.spec.containers[0].envFrom[0].configMapRef.name).toBe(config.metadata.name);
    expect(config.metadata.name.startsWith('pr-128-web-config-')).toBe(true);
    expect(t.PREFIX_NOTE).toContain('`pr-128-web`');
    expect(t.PREFIX_NOTE).toContain('`pr-128-web-config-`');
  });
});

describe('согласованность имён между листингами', () => {
  const base = kz('base');
  const has = (kind: string, name: string) => base.some((d: Doc) => d.kind === kind && d.metadata.name === name);

  it('цели патчей и генераторов в слоях существуют в базе', () => {
    for (const env of ENVS) {
      const k = yamlDocs(t.FILES[`overlays/${env}/kustomization.yaml`])[0];
      for (const p of k.patches ?? []) {
        const file = `overlays/${env}/${p.path}`;
        expect(t.FILES[file], `нет файла ${file}`).toBeDefined();
        for (const patch of yamlDocs(t.FILES[file])) {
          if (Array.isArray(patch)) expect(has(p.target.kind, p.target.name)).toBe(true);
          else expect(has(patch.kind, patch.metadata.name)).toBe(true);
        }
      }
      for (const img of k.images ?? []) {
        expect(base.some((d: Doc) => d.spec?.template?.spec?.containers?.some((c: Doc) => c.image.startsWith(`${img.name}:`)))).toBe(true);
      }
      for (const gen of k.configMapGenerator ?? []) expect(gen.name).toBe('web-config');
      expect(k.namespace).toBe(`shop-${env}`);
    }
  });

  it('каждый ключ values-*.yaml есть в values.yaml — опечатка не пройдёт молча', () => {
    const chart = yamlDocs(t.FILES['chart/values.yaml'])[0];
    const keys = (v: Doc, prefix = ''): string[] =>
      Object.entries(v).flatMap(([k, x]) =>
        x && typeof x === 'object' && !Array.isArray(x) ? [`${prefix}${k}`, ...keys(x, `${prefix}${k}.`)] : [`${prefix}${k}`],
      );
    const known = new Set(keys(chart));
    // resources.limits в чарте нет намеренно — это словарь, который окружение расширяет.
    const open = ['resources.'];
    for (const env of ENVS) {
      for (const k of keys(yamlDocs(t.FILES[`values-${env}.yaml`])[0])) {
        if (open.some((p) => k.startsWith(p))) continue;
        expect(known.has(k), `values-${env}.yaml: ключа ${k} нет в values.yaml`).toBe(true);
      }
    }
  });

  it('каждое .Values.… в шаблонах определено в values.yaml', () => {
    const chart = yamlDocs(t.FILES['chart/values.yaml'])[0];
    const sources = [...Object.entries(t.FILES).filter(([p]) => p.includes('/templates/')).map(([, s]) => s), t.HOOK_CODE];
    const refs = sources.flatMap((s) => [...s.matchAll(/\.Values((?:\.[A-Za-z]\w*)+)/g)].map((m) => m[1].slice(1)));
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      const v = ref.split('.').reduce((o: Doc, k) => (o == null ? undefined : o[k]), chart);
      expect(v, `.Values.${ref} нет в values.yaml`).not.toBeUndefined();
    }
  });

  it('команды ссылаются на существующие файлы и пространства слоёв', () => {
    for (const env of ENVS) {
      const c = M.parseHelmCommand(t.COMMANDS[env]);
      expect(c.release).toBe('web');
      expect(c.namespace).toBe(`shop-${env}`);
      for (const f of c.files) expect(t.FILES[f], `нет файла ${f}`).toBeDefined();
    }
    expect(t.RELEASE_CODE.split('\n')[0]).toBe(`$ ${t.COMMANDS.prod}`);
  });

  it('Argo CD и Flux смотрят в существующий слой и в то же пространство имён', () => {
    const [app] = yamlDocs(t.ARGO_CODE);
    expect(t.FILES[`${app.spec.source.path}/kustomization.yaml`]).toBeDefined();
    expect(app.spec.destination.namespace).toBe('shop-prod');
    expect(app.spec.syncPolicy.automated).toEqual({ prune: true, selfHeal: true });

    const [repo, flux] = yamlDocs(t.FLUX_CODE);
    expect(flux.spec.sourceRef).toEqual({ kind: repo.kind, name: repo.metadata.name });
    expect(t.FILES[`${flux.spec.path.replace(/^\.\//, '')}/kustomization.yaml`]).toBeDefined();
    expect(flux.spec.targetNamespace).toBe('shop-prod');
    expect(repo.spec.url).toBe(app.spec.source.repoURL);
  });

  it('деревья файлов на странице называют каждый файл примера', () => {
    for (const path of Object.keys(t.FILES)) {
      const name = path.split('/').pop()!;
      const tree = path.startsWith('chart/') || path.startsWith('values-') ? t.CHART_TREE : t.KUSTOMIZE_TREE;
      expect(tree, `${path} не назван в дереве`).toContain(name);
    }
  });

  it('образ хука и сборщика логов не расходятся с базой kustomize', () => {
    const agent = base.find((d: Doc) => d.kind === 'Deployment').spec.template.spec.containers[1].image;
    expect(t.FILES['chart/templates/deployment.yaml']).toContain(`image: ${agent}`);
  });
});

describe('демо', () => {
  it('собирает все сочетания окружения, способа и режима без ошибок', () => {
    for (const env of ENVS) {
      for (const tool of ['kustomize', 'helm'] as const) {
        for (const mode of ['strategic', 'replace'] as const) {
          const v = M.buildView(t.FILES, t.COMMANDS, env, tool, mode);
          expect(v.lines.length).toBeGreaterThan(40);
          expect(v.lines.some((l) => l.changed)).toBe(true);
        }
      }
    }
  });

  it('подсвечено изменённое, а не всё подряд', () => {
    const v = M.buildView(t.FILES, t.COMMANDS, 'prod', 'helm', 'strategic');
    const changed = v.lines.filter((l) => l.changed).map((l) => l.text.trim());
    expect(changed).toContain('replicas: 4');
    expect(changed).toContain('image: "registry.example.com/shop/web:1.4.2"');
    expect(changed).not.toContain('kind: Deployment');
  });

  it('слева — файлы слоя или values с командой', () => {
    expect(inputsOf(t.FILES, t.COMMANDS, 'dev', 'kustomize').map((f) => f.title)).toEqual([
      'overlays/dev/kustomization.yaml',
      'overlays/dev/app.yaml',
      'overlays/dev/host.yaml',
    ]);
    expect(inputsOf(t.FILES, t.COMMANDS, 'prod', 'helm').map((f) => f.text)).toEqual([t.FILES['values-prod.yaml'], t.COMMANDS.prod]);
  });
});

describe('текст темы', () => {
  const texts = Object.entries(t).filter(([, v]) => typeof v === 'string') as [string, string][];

  it('не ссылается на разделы номером', () => {
    for (const [name, text] of texts) {
      if (name.endsWith('_CODE')) continue;
      expect(/[Рр]аздел[а-я]*\s+\d/.test(text), `${name} ссылается на раздел номером`).toBe(false);
    }
  });

  it('ссылки внутри сайта ведут на существующие темы и разделы', () => {
    const all = [...texts.map(([, v]) => v), ...t.PREREQ.map((p) => `(${p.href})`)].join('\n');
    const links = [...all.matchAll(/\((\/delivery\/[a-z-]+\/)(#s\d+)?\)/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, path, hash] of links) {
      const mdx = new URL(`../../src/content${path}index.mdx`, import.meta.url);
      expect(existsSync(mdx), `нет темы ${path}`).toBe(true);
      if (hash) expect(readFileSync(mdx, 'utf8'), `в ${path} нет раздела ${hash}`).toContain(`id="${hash.slice(1)}"`);
    }
  });

  it('тонкие места пронумерованы подряд', () => {
    expect(t.PITFALLS.map((p) => p.n)).toEqual(t.PITFALLS.map((_, i) => String(i + 1).padStart(2, '0')));
  });
});
