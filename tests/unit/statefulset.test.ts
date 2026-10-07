import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// `yaml` приходит в проект транзитивно — тем же путём, что в `ingress.test.ts`.
// Пропадёт из `node_modules` — файл упадёт на импорте громко, а не пройдёт молча.
import { parseAllDocuments } from 'yaml';
import * as t from '@/content/delivery/statefulset/data';
import { loadSim, play, settled } from '@/widgets/sts-controller/model/run';
import type { PodPolicy, Retention, SetSpec, SetState } from '@/widgets/sts-controller/model/types';

/**
 * Тема «StatefulSet, тома и данные».
 *
 * Кластера здесь нет и не будет — поэтому проверяется то, что проверить можно без него:
 *
 *  1. **Модель контроллера.** `SIM_CODE` — строка из темы, та же, что напечатана на странице
 *     и исполняется демо. Через неё прогоняются случаи из документации (`ORDER_CASES`),
 *     и столбец «действия» сверяется с литералом. Литерал сам по себе ничего не доказывает —
 *     его мог бы написать и прогон, — поэтому отдельно проверяются **правила** из документации:
 *     порядок создания, удаления и обновления, ожидание Ready, `partition`, `Parallel`,
 *     и инвариант «при OrderedReady не больше одного неготового пода» на сотнях случайных
 *     сценариев.
 *  2. **Судьба PVC.** `CLAIM_CASES` — таблица политик из документации: каждая строка
 *     проверяется функцией `claimFate` и прогоном модели целиком.
 *  3. **DNS-имена.** Таблица из документации пересчитывается `podFqdn`.
 *  4. **Листинги.** Каждый YAML разбирается без ошибок и дублей ключей, а имена между ними
 *     согласованы: headless-сервис и `serviceName`, метки, тома, класс хранения, драйвер
 *     снапшотов, заявка первой реплики.
 */

const sim = loadSim(t.SIM_CODE);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- разобранный YAML произвольной формы
type Doc = Record<string, any>;

function docs(code: string): Doc[] {
  return parseAllDocuments(code, { uniqueKeys: true }).map((d) => {
    expect(d.errors, `ошибка YAML:\n${code}`).toEqual([]);
    return d.toJS() as Doc;
  });
}

const BASE: SetSpec = { ...t.DEMO_SET };

function startOf(c: (typeof t.ORDER_CASES)[number]): SetState {
  const spec: SetSpec = {
    ...BASE,
    podManagementPolicy: c.policy as PodPolicy,
    partition: 'partition' in c ? c.partition : 0,
  };
  return c.from === 'empty' ? sim.create({ ...spec, replicas: 0 }) : settled(sim, spec);
}

const run = (id: string) => {
  const c = t.ORDER_CASES.find((x) => x.id === id)!;
  return play(sim, startOf(c), [...c.script]);
};

/** Номера подов из токенов вида «<глагол> db-N» по порядку. */
const ords = (tokens: string[], verb: string) =>
  tokens.filter((x) => x.startsWith(verb + ' ')).map((x) => Number(x.match(/-(\d+)/)![1]));

describe('SIM_CODE: случаи из документации', () => {
  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.ORDER_TABLE.rows).toHaveLength(t.ORDER_CASES.length);
    t.ORDER_CASES.forEach((c, i) => expect(t.ORDER_TABLE.rows[i][2]).toBe(c.trace));
  });

  for (const c of t.ORDER_CASES) {
    it(`${c.policy} · ${c.what}`, () => {
      expect(play(sim, startOf(c), [...c.script]).trace).toBe(c.trace);
    });
  }
});

describe('SIM_CODE: правила из «Deployment and Scaling Guarantees»', () => {
  it('создание по возрастанию, по одному поду за проход', () => {
    const r = run('up');
    expect(ords(r.passes.flat(), 'создать')).toEqual([0, 1, 2]);
    for (const pass of r.passes) expect(ords(pass, 'создать').length).toBeLessThanOrEqual(1);
  });

  it('удаление по убыванию, следующий — только после завершения предыдущего', () => {
    const r = run('down');
    expect(ords(r.passes.flat(), 'удалить')).toEqual([2, 1]);
    const flat = r.passes.flat();
    expect(flat.indexOf('удалить db-1')).toBeGreaterThan(flat.indexOf('db-2 завершился'));
  });

  it('упавший предшественник останавливает создание: db-2 — только после нового Ready db-0', () => {
    const flat = run('up-fail').passes.flat();
    expect(flat.indexOf('создать db-2 (v1)')).toBeGreaterThan(flat.lastIndexOf('db-0 готов'));
    expect(flat.indexOf('db-0 упал')).toBeLessThan(flat.lastIndexOf('db-0 готов'));
  });

  it('упавший предшественник останавливает и удаление: db-1 — только после нового Ready db-0', () => {
    const flat = run('down-fail').passes.flat();
    expect(flat.indexOf('удалить db-1')).toBeGreaterThan(flat.lastIndexOf('db-0 готов'));
  });

  it('лишний под не удаляется, пока хоть один предшественник не Ready', () => {
    // Формулировка документации: «Before a scaling operation is applied to a Pod,
    // all of its predecessors must be Running and Ready».
    let s = settled(sim, { ...BASE, replicas: 5 });
    s = sim.kill(s, 1).set;
    s = sim.step(s).set; // db-1 пересоздан и ещё не готов
    const r = sim.step(sim.scale(s, 1));
    expect(r.log.map((e) => [e.kind, e.ord])).toEqual([['wait', 1]]);
    const after = sim.step(sim.ready(r.set, 1).set);
    expect(after.log.find((e) => e.kind === 'delete')?.ord).toBe(4);
  });

  it('упавший под возвращается с тем же именем и к той же заявке', () => {
    let s = settled(sim, BASE);
    s = sim.kill(s, 1).set;
    const r = sim.step(s);
    expect(r.log.map((e) => e.kind)).toEqual(['gone', 'reuse', 'create', 'wait']);
    expect(r.set.claims.map((c) => c.name).sort()).toEqual(['data-db-0', 'data-db-1', 'data-db-2']);
  });
});

describe('SIM_CODE: Parallel касается масштабирования, а не обновления', () => {
  it('создание — все за один проход, без ожидания', () => {
    const r = run('parallel-up');
    expect(r.passes).toHaveLength(1);
    expect(ords(r.passes[0], 'создать')).toEqual([0, 1, 2]);
    expect(r.passes[0].some((x) => x.startsWith('ждать'))).toBe(false);
  });

  it('удаление — все лишние за один проход', () => {
    expect(ords(run('parallel-down').passes[0], 'удалить')).toEqual([2, 1]);
  });

  it('обновление — так же по одному и с конца, как при OrderedReady', () => {
    const ordered = run('rolling');
    const parallel = run('parallel-rolling');
    expect(ords(parallel.passes.flat(), 'заменить')).toEqual([2, 1, 0]);
    expect(ords(ordered.passes.flat(), 'заменить')).toEqual([2, 1, 0]);
    for (const pass of parallel.passes) expect(ords(pass, 'заменить').length).toBeLessThanOrEqual(1);
  });
});

describe('SIM_CODE: RollingUpdate и partition', () => {
  it('следующий под заменяется только после Ready обновлённого', () => {
    const r = run('rolling');
    const at = (x: string) => r.passes.findIndex((p) => p.includes(x));
    expect(at('заменить db-1')).toBeGreaterThan(at('ждать db-2'));
    expect(at('заменить db-0')).toBeGreaterThan(at('ждать db-1'));
    expect(r.set.pods.every((p) => p.rev === 2)).toBe(true);
    expect(r.set.currentRevision).toBe(2);
  });

  it('partition ≥ replicas: смена образа не трогает никого, удалённый под возвращается старой версией', () => {
    const r = run('staged');
    expect(r.set.updateRevision).toBe(2);
    expect(r.set.pods.map((p) => p.rev)).toEqual([1, 1, 1]);
    expect(r.trace).not.toContain('заменить');
  });

  it('partition: 2 из 3 — обновлён ровно db-2, текущая ревизия набора не сдвинулась', () => {
    const r = run('canary');
    const rev = Object.fromEntries(r.set.pods.map((p) => [p.ord, p.rev]));
    expect(rev).toEqual({ 0: 1, 1: 1, 2: 2 });
    expect(r.set.currentRevision).toBe(1);
  });

  it('partition больше replicas — обновлений нет (формулировка документации)', () => {
    const r = play(sim, settled(sim, { ...BASE, partition: 5 }), ['image', 'run']);
    expect(r.passes).toEqual([]);
  });

  it('новые поды при увеличении: ниже partition — старой версии, не ниже — новой', () => {
    const r = play(sim, settled(sim, { ...BASE, partition: 4 }), ['image', 'scale 5', 'run']);
    const rev = Object.fromEntries(r.set.pods.map((p) => [p.ord, p.rev]));
    expect(rev).toEqual({ 0: 1, 1: 1, 2: 1, 3: 1, 4: 2 });
  });
});

describe('SIM_CODE: инварианты на случайных сценариях', () => {
  /** Детерминированный генератор: красный прогон воспроизводится. */
  function rng(seed: number) {
    let x = seed;
    return () => {
      x = (x * 1103515245 + 12345) % 2147483648;
      return x / 2147483648;
    };
  }

  it('OrderedReady: не больше одного неготового или завершающегося пода; новый под ниже partition — текущей ревизии', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      let s = settled(sim, BASE);
      for (let i = 0; i < 40; i++) {
        const k = r();
        if (k < 0.12) s = sim.scale(s, Math.floor(r() * 6));
        else if (k < 0.2) s = sim.updateImage(s);
        else if (k < 0.28) s = sim.setPartition(s, Math.floor(r() * 6));
        else if (k < 0.55) {
          const pending = s.pods.find((p) => !p.ready && !p.terminating);
          if (pending) s = sim.ready(s, pending.ord).set;
        } else {
          // Завершающиеся поды `step` сперва доводит до конца — их место законно занять.
          const before = new Set(s.pods.filter((p) => !p.terminating).map((p) => p.ord));
          const res = sim.step(s);
          s = res.set;
          for (const e of res.log.filter((x) => x.kind === 'create')) {
            expect(before.has(e.ord), `seed ${seed}: создан под поверх живого`).toBe(false);
            if (e.ord < s.partition) expect(e.rev, `seed ${seed}`).toBe(s.currentRevision);
            else expect(e.rev, `seed ${seed}`).toBe(s.updateRevision);
          }
        }
        const unhealthy = s.pods.filter((p) => !p.ready || p.terminating);
        expect(unhealthy.length, `seed ${seed}, шаг ${i}`).toBeLessThanOrEqual(1);
        expect(new Set(s.pods.map((p) => p.ord)).size).toBe(s.pods.length);
      }
    }
  });

  it('модель успокаивается: из любого состояния `run` доводит набор до replicas готовых подов', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const r = rng(seed);
      const policy: PodPolicy = r() < 0.5 ? 'OrderedReady' : 'Parallel';
      const n = Math.floor(r() * 6);
      const res = play(sim, settled(sim, { ...BASE, podManagementPolicy: policy }), ['image', `scale ${n}`, 'run']);
      expect(res.set.pods.map((p) => p.ord).sort()).toEqual([...Array(n).keys()]);
      expect(res.set.pods.every((p) => p.ready && p.rev === 2)).toBe(true);
    }
  });

  it('в коде нет Math.random', () => {
    expect(t.SIM_CODE).not.toContain('Math.random');
  });
});

describe('SIM_CODE: судьба PVC — таблица из «PersistentVolumeClaim retention»', () => {
  it('таблица на странице собрана из тех же случаев', () => {
    expect(t.CLAIM_TABLE.rows).toHaveLength(t.CLAIM_CASES.length);
    // Четыре сочетания двух политик — все, и без повторов.
    const keys = new Set(t.CLAIM_CASES.map((c) => `${c.whenScaled}/${c.whenDeleted}`));
    expect(keys.size).toBe(4);
  });

  for (const c of t.CLAIM_CASES) {
    const policy: Retention = { whenScaled: c.whenScaled, whenDeleted: c.whenDeleted };
    const label = `whenScaled: ${c.whenScaled}, whenDeleted: ${c.whenDeleted}`;

    it(`${label} — claimFate`, () => {
      expect(sim.claimFate(policy, 'scale-down')).toBe(c.scaled);
      expect(sim.claimFate(policy, 'set-deleted')).toBe(c.deleted);
      expect(sim.claimFate(policy, 'pod-replaced')).toBe(c.replaced);
    });

    it(`${label} — прогоном: 3 → 1, затем удалить набор`, () => {
      const start = settled(sim, { ...BASE, retention: policy });
      const scaled = play(sim, start, ['scale 1', 'run']).set;
      const after = scaled.claims.map((x) => x.name).sort();
      expect(after).toEqual(c.scaled === 'kept' ? ['data-db-0', 'data-db-1', 'data-db-2'] : ['data-db-0']);

      const gone = play(sim, scaled, ['remove', 'run']).set;
      expect(gone.pods).toEqual([]);
      if (c.deleted === 'deleted') expect(gone.claims).toEqual([]);
      else expect(gone.claims.map((x) => x.name).sort()).toEqual(after);
    });

    it(`${label} — прогоном: под заменён, заявка та же`, () => {
      const start = settled(sim, { ...BASE, retention: policy });
      const back = play(sim, start, ['kill 1', 'run']).set;
      expect(back.claims.map((x) => x.name).sort()).toEqual(['data-db-0', 'data-db-1', 'data-db-2']);
    });
  }

  it('увеличение после уменьшения с Retain подключает прежнюю заявку, а не заводит новую', () => {
    const s = play(sim, settled(sim, BASE), ['scale 1', 'run']).set;
    const r = sim.step(sim.scale(s, 2));
    expect(r.log.map((e) => e.kind)).toContain('reuse');
    expect(r.log.map((e) => e.kind)).not.toContain('claim');
  });

  it('при whenScaled: Delete заявка удаляется после пода, а не раньше', () => {
    const s = settled(sim, { ...BASE, retention: { whenScaled: 'Delete', whenDeleted: 'Retain' } });
    const first = sim.step(sim.scale(s, 2));
    expect(first.set.claims.map((c) => c.name)).toContain('data-db-2');
    const second = sim.step(first.set);
    const kinds = second.log.map((e) => e.kind);
    expect(kinds.indexOf('claim-gone')).toBeGreaterThan(kinds.indexOf('gone'));
  });
});

describe('SIM_CODE: DNS-имена — таблица из «Stable Network ID»', () => {
  it('таблица на странице собрана из тех же строк', () => {
    expect(t.DNS_TABLE.rows).toHaveLength(t.DNS_EXAMPLES.length);
  });

  for (const e of t.DNS_EXAMPLES) {
    it(`${e.set} за ${e.service} в ${e.domain}`, () => {
      const [ns, service] = e.service.split('/');
      const [setNs, name] = e.set.split('/');
      expect(setNs).toBe(ns);
      const set = { name, serviceName: service, namespace: ns };
      expect(e.setDomain).toBe(`${service}.${ns}.svc.${e.domain}`);
      for (const ord of [0, 1, 4]) {
        expect(sim.podFqdn(set, ord, e.domain)).toBe(e.pod.replace('{0..N-1}', String(ord)));
        expect(sim.podName(set, ord)).toBe(e.host.replace('{0..N-1}', String(ord)));
      }
    });
  }

  it('домен по умолчанию — cluster.local; имя PVC — «шаблон-под» (www-web-0 из документации)', () => {
    expect(sim.podFqdn({ name: 'web', serviceName: 'nginx', namespace: 'default' }, 0)).toBe(
      'web-0.nginx.default.svc.cluster.local',
    );
    expect(sim.claimName({ name: 'web', claim: 'www' }, 0)).toBe('www-web-0');
  });
});

describe('листинги', () => {
  const [svc, sts] = docs(t.STS_CODE);
  const [sc] = docs(t.STORAGECLASS_CODE);
  const snap = docs(t.SNAPSHOT_CODE);
  const vct = sts.spec.volumeClaimTemplates as Doc[];
  const container = sts.spec.template.spec.containers[0];

  it('STS_CODE: headless-сервис и StatefulSet', () => {
    expect([svc.apiVersion, svc.kind]).toEqual(['v1', 'Service']);
    expect([sts.apiVersion, sts.kind]).toEqual(['apps/v1', 'StatefulSet']);
    expect(svc.spec.clusterIP).toBe('None');
    expect(sts.spec.serviceName).toBe(svc.metadata.name);
    expect(sts.metadata.namespace).toBe(svc.metadata.namespace);
  });

  it('STS_CODE: метки селекторов совпадают с метками шаблона пода', () => {
    const labels = sts.spec.template.metadata.labels;
    expect(labels).toMatchObject(sts.spec.selector.matchLabels);
    expect(labels).toMatchObject(svc.spec.selector);
    expect(svc.spec.ports.map((p: Doc) => p.name)).toEqual(container.ports.map((p: Doc) => p.name));
  });

  it('STS_CODE: тома в volumeMounts ровно те, что в volumeClaimTemplates', () => {
    const mounts = container.volumeMounts.map((m: Doc) => m.name).sort();
    const templates = vct.map((v) => v.metadata.name).sort();
    expect(mounts).toEqual(templates);
    expect(sts.spec.template.spec.volumes).toBeUndefined();
  });

  it('STS_CODE: значения политик из тех, что знает документация', () => {
    expect(['OrderedReady', 'Parallel']).toContain(sts.spec.podManagementPolicy);
    expect(sts.spec.updateStrategy.type).toBe('RollingUpdate');
    expect(sts.spec.updateStrategy.rollingUpdate.partition).toBe(0);
    const r = sts.spec.persistentVolumeClaimRetentionPolicy;
    expect(['Retain', 'Delete']).toContain(r.whenScaled);
    expect(['Retain', 'Delete']).toContain(r.whenDeleted);
    // Контроллер ждёт Ready — значит, у пода должна быть readiness-проба.
    expect(container.readinessProbe).toBeDefined();
    // PGDATA — подкаталог точки монтирования (lost+found в корне свежего диска).
    const pgdata = container.env.find((e: Doc) => e.name === 'PGDATA').value as string;
    const mount = container.volumeMounts[0].mountPath as string;
    expect(pgdata.startsWith(mount + '/')).toBe(true);
  });

  it('демо начинает с того же набора, что в листинге', () => {
    expect(t.DEMO_SET).toEqual({
      name: sts.metadata.name,
      serviceName: sts.spec.serviceName,
      namespace: sts.metadata.namespace,
      claim: vct[0].metadata.name,
      replicas: sts.spec.replicas,
    });
    expect(sts.spec.podManagementPolicy).toBe('OrderedReady');
    expect(sts.spec.persistentVolumeClaimRetentionPolicy).toEqual({ whenScaled: 'Retain', whenDeleted: 'Retain' });
  });

  it('имена в тексте вычислены из листинга, а не набраны отдельно', () => {
    const set = t.DEMO_SET;
    expect(t.DNS_WHY).toContain(`\`${sim.podFqdn(set, 0)}\``);
    expect(t.VCT_WHY).toContain(`\`${sim.claimName(set, 0)}\``);
    expect(t.DEPLOY_VS_STS.rows.flat().join(' ')).toContain(`\`${sim.claimName(set, 0)}\``);
  });

  it('STORAGECLASS_CODE: класс из листинга, Retain и WaitForFirstConsumer', () => {
    expect([sc.apiVersion, sc.kind]).toEqual(['storage.k8s.io/v1', 'StorageClass']);
    expect(sc.metadata.name).toBe(vct[0].spec.storageClassName);
    expect(sc.reclaimPolicy).toBe('Retain');
    expect(sc.volumeBindingMode).toBe('WaitForFirstConsumer');
    expect(sc.allowVolumeExpansion).toBe(true);
  });

  it('SNAPSHOT_CODE: драйвер, заявка первой реплики и восстановление', () => {
    expect(snap.map((d) => d.kind)).toEqual(['VolumeSnapshotClass', 'VolumeSnapshot', 'PersistentVolumeClaim']);
    const [cls, vs, pvc] = snap;
    expect(cls.apiVersion).toBe('snapshot.storage.k8s.io/v1');
    expect(vs.apiVersion).toBe('snapshot.storage.k8s.io/v1');
    expect(cls.driver).toBe(sc.provisioner);
    expect(vs.spec.volumeSnapshotClassName).toBe(cls.metadata.name);
    expect(vs.spec.source.persistentVolumeClaimName).toBe(sim.claimName(t.DEMO_SET, 0));
    expect(vs.metadata.namespace).toBe(sts.metadata.namespace);
    expect(pvc.metadata.namespace).toBe(sts.metadata.namespace);
    expect(pvc.spec.dataSource).toEqual({ name: vs.metadata.name, kind: 'VolumeSnapshot', apiGroup: 'snapshot.storage.k8s.io' });
    expect(pvc.spec.storageClassName).toBe(sc.metadata.name);
    expect(pvc.spec.accessModes).toEqual(vct[0].spec.accessModes);
    expect(pvc.spec.resources.requests.storage).toBe(vct[0].spec.resources.requests.storage);
  });

  it('OPERATOR_CODE и EXTERNAL_CODE разбираются и согласованы с примером', () => {
    const [cluster] = docs(t.OPERATOR_CODE);
    expect(cluster.kind).toBe('Cluster');
    expect(cluster.spec.storage.storageClass).toBe(sc.metadata.name);
    expect(cluster.spec.storage.size).toBe(vct[0].spec.resources.requests.storage);

    const [ext] = docs(t.EXTERNAL_CODE);
    expect(ext.spec.type).toBe('ExternalName');
    expect(ext.spec.selector).toBeUndefined();
    expect(ext.metadata).toEqual({ name: svc.metadata.name, namespace: svc.metadata.namespace });
  });
});

describe('ссылки и тонкие места', () => {
  /** `/delivery/kubernetes/#s2` → каталог темы и пункт её nav. */
  function resolves(href: string): boolean {
    const m = href.match(/^\/(\w[\w-]*)\/([\w-]+)\/(?:#(s\d+))?$/);
    if (!m) return false;
    const dir = m[1] === 'js' ? 'lessons' : m[1] === 'render' ? 'render' : m[1];
    const mdx = new URL(`../../src/content/${dir}/${m[2]}/index.mdx`, import.meta.url);
    if (!existsSync(mdx)) return false;
    return !m[3] || readFileSync(mdx, 'utf8').includes(`id: ${m[3]},`);
  }

  it('«Перед началом» ведёт на существующие разделы', () => {
    for (const p of t.PREREQ) expect(resolves(p.href), p.href).toBe(true);
  });

  it('внутренние ссылки в тексте ведут на существующие разделы', () => {
    const all = (Object.values(t) as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .concat(t.PITFALLS.map((p) => p.d));
    const links = all.flatMap((s) => [...s.matchAll(/\]\((\/[^)]+)\)/g)].map((m) => m[1]));
    expect(links.length).toBeGreaterThan(3);
    for (const href of links) expect(resolves(href), href).toBe(true);
  });

  it('тонкие места пронумерованы подряд', () => {
    expect(t.PITFALLS.map((p) => p.n)).toEqual(t.PITFALLS.map((_, i) => String(i + 1).padStart(2, '0')));
  });
});
