import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
// `yaml` приходит в проект транзитивно — тем же путём, что в `ingress.test.ts` и `helm-gitops.test.ts`.
import { parseAllDocuments } from 'yaml';
import * as t from '@/content/delivery/progressive-delivery/data';
import { loadModel, replay, router } from '@/widgets/pd-canary/model/run';
import type { Side } from '@/widgets/pd-canary/model/types';

/**
 * Тема «Прогрессивная доставка: сине-зелёный выкат, канарейка и флаги».
 *
 * Кластера, Argo Rollouts, Flagger и Prometheus здесь нет. Проверяется то, что проверить
 * можно без них, и проверяется той же моделью, что напечатана на странице и исполняется
 * демо (`MODEL_PARTS` → `new Function`):
 *
 *  1. **Назначение по хешу** — на ста тысячах синтетических id: равномерность, стабильность
 *     при росте доли, независимость разных солей, выключатель флага отдельно от доли.
 *  2. **Интервалы** — Уилсон на примерах из статьи Newcombe (1998), оба интервала —
 *     моделированием покрытия с сидом; «правило трёх» — прямым счётом.
 *  3. **Решения анализа и план выката** — на литералах из `data.ts`, на которые опирается текст.
 *  4. **Схема БД** — матрица «версия × состояние» пересчитывается функцией `compatible`.
 *  5. **Листинги** — разбор пакетом `yaml` и согласованность имён; шаги канарейки в листинге
 *     и в плане демо — один список.
 *
 * Таймерных замеров нет. `Math.random` в проверяемом коде нет — это тоже проверяется.
 */

const M = loadModel(t.MODEL_PARTS);
const N = 100_000;
const IDS = Array.from({ length: N }, (_, i) => `u${i}`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- разобранный YAML произвольной формы
type Doc = Record<string, any>;

function docs(code: string): Doc[] {
  return parseAllDocuments(code).map((d) => {
    expect(d.errors, `ошибка YAML:\n${code}`).toEqual([]);
    return d.toJS() as Doc;
  });
}

/** Стандартное отклонение числа попаданий при доле p из n. */
const sigma = (p: number, n: number) => Math.sqrt(n * p * (1 - p));

describe('модель: напечатанное и исполняемое — одни и те же строки', () => {
  it('в MODEL_PARTS лежат строки, которые печатает тема', () => {
    for (const code of [t.BUCKET_CODE, t.STATS_CODE, t.PLAN_CODE, t.SCHEMA_CODE]) {
      expect(t.MODEL_PARTS).toContain(code);
    }
  });

  it('в модели нет Math.random — поток задаёт сид', () => {
    expect(t.MODEL_PARTS.join('\n')).not.toMatch(/Math\.random/);
  });
});

describe('назначение по хешу: сто тысяч синтетических id', () => {
  it('корзины распределены равномерно: хи-квадрат по сотне групп в пределах нормы', () => {
    const groups = new Array(100).fill(0);
    for (const id of IDS) groups[Math.floor(M.bucketOf(t.CANARY_SALT, id) / 100)]++;
    const e = N / 100;
    const chi2 = groups.reduce((s, g) => s + (g - e) ** 2 / e, 0);
    // 99 степеней свободы: критическое значение на уровне 0.001 — около 148.
    expect(chi2).toBeLessThan(148);
  });

  for (const percent of [1, 5, 10, 20, 50]) {
    it(`доля ${percent}% попадает в допуск четырёх сигм`, () => {
      const inside = IDS.filter((id) => M.inRollout(t.CANARY_SALT, id, percent)).length;
      const p = percent / 100;
      expect(Math.abs(inside - N * p)).toBeLessThan(4 * sigma(p, N));
    });
  }

  it('0% — никого, 100% — всех', () => {
    expect(IDS.some((id) => M.inRollout(t.CANARY_SALT, id, 0))).toBe(false);
    expect(IDS.every((id) => M.inRollout(t.CANARY_SALT, id, 100))).toBe(true);
  });

  it('стабильность при росте доли: кто был в 5%, остаётся в 10%, 20%, 50%', () => {
    const ladder = [1, 5, 10, 20, 50, 100];
    for (let i = 1; i < ladder.length; i++) {
      const lost = IDS.filter(
        (id) => M.inRollout(t.CANARY_SALT, id, ladder[i - 1]) && !M.inRollout(t.CANARY_SALT, id, ladder[i]),
      );
      expect(lost, `из ${ladder[i - 1]}% в ${ladder[i]}% выпали`).toEqual([]);
    }
  });

  it('то же решение при повторном вызове — никакой случайности', () => {
    const a = IDS.slice(0, 1000).map((id) => M.bucketOf('x', id));
    const b = IDS.slice(0, 1000).map((id) => M.bucketOf('x', id));
    expect(a).toEqual(b);
  });

  it('разные соли — независимые выборки: у двух 10% пересечение около 1%', () => {
    const both = IDS.filter((id) => M.inRollout(t.CANARY_SALT, id, 10) && M.inRollout(t.FLAG_KEY, id, 10)).length;
    expect(Math.abs(both - N * 0.01)).toBeLessThan(4 * sigma(0.01, N));
  });

  it('⚠️ голый FNV-1a с солью в конце строки проваливает независимость — ровно 15 человек, как в HASH_NOTE', () => {
    // Найдено прогоном при написании темы. Текст называет число — тест держит его.
    const cut = 1000; // 10% корзин
    const raw = IDS.filter((id) => M.fnv1a(`${id}:a`) % 10000 < cut && M.fnv1a(`${id}:b`) % 10000 < cut).length;
    const mixed = IDS.filter((id) => M.hash32(`${id}:a`) % 10000 < cut && M.hash32(`${id}:b`) % 10000 < cut).length;
    expect(raw).toBe(15);
    expect(t.HASH_NOTE).toContain(`${raw} человек`);
    expect(Math.abs(mixed - N * 0.01)).toBeLessThan(4 * sigma(0.01, N));
  });
});

describe('флаг функции: выключатель отдельно от доли', () => {
  const flag = { key: t.FLAG_KEY, percent: 20 };

  it('флаг — та же раскатка с ключом вместо соли', () => {
    for (const id of IDS.slice(0, 5000)) expect(M.flagOn(flag, id)).toBe(M.inRollout(t.FLAG_KEY, id, 20));
  });

  it('выключатель гасит у всех, включение возвращает тем же людям', () => {
    const before = IDS.filter((id) => M.flagOn(flag, id));
    expect(IDS.some((id) => M.flagOn({ ...flag, killed: true }, id))).toBe(false);
    const after = IDS.filter((id) => M.flagOn({ ...flag, killed: false }, id));
    expect(after).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it('флага нет (сервис флагов не ответил) — безопасное «выключено»', () => {
    expect(M.flagOn(undefined, 'u1')).toBe(false);
    expect(M.flagOn(null, 'u1')).toBe(false);
  });
});

describe('интервал Уилсона', () => {
  for (const c of t.WILSON_CASES) {
    it(`${c.x} из ${c.n}: [${c.lo}; ${c.hi}] — пример Newcombe (1998)`, () => {
      const ci = M.wilson(c.x, c.n, 1.96);
      expect(ci.lo).toBeCloseTo(c.lo, 4);
      expect(ci.hi).toBeCloseTo(c.hi, 4);
    });
  }

  it('при нуле событий верхняя граница — z²/(n+z²), при всех событиях нижняя — n/(n+z²)', () => {
    const z2 = 1.96 ** 2;
    for (const n of [10, 100, 1000]) {
      expect(M.wilson(0, n, 1.96).hi).toBeCloseTo(z2 / (n + z2), 12);
      expect(M.wilson(n, n, 1.96).lo).toBeCloseTo(n / (n + z2), 12);
    }
  });

  it('числа из текста: 0 из 100 — до 3.7%; 13 из 500 — от 1.5% до 4.4%; школьная формула при нуле даёт нулевую ширину', () => {
    expect(M.wilson(0, 100, 1.96).hi).toBeCloseTo(0.037, 3);
    expect(t.STATS_NOTE).toContain('3.7%');
    const ci = M.wilson(13, 500, 1.96);
    expect(ci.lo).toBeCloseTo(0.015, 3);
    expect(ci.hi).toBeCloseTo(0.044, 3);
    expect(t.ANALYSIS_WHY).toContain('1.5%, и 4.4%');
    const wald = (x: number, n: number) => 1.96 * Math.sqrt(((x / n) * (1 - x / n)) / n);
    expect(wald(0, 100)).toBe(0);
  });

  it('покрытие ≈ 95%: 2000 выборок по 1000 при истинной доле 2.5% (моделирование с сидом)', () => {
    const rnd = M.mulberry32(20260928);
    const p = 0.025;
    let covered = 0;
    const trials = 2000;
    for (let k = 0; k < trials; k++) {
      let x = 0;
      for (let i = 0; i < 1000; i++) if (rnd() < p) x++;
      const ci = M.wilson(x, 1000, 1.96);
      if (ci.lo <= p && p <= ci.hi) covered++;
    }
    expect(covered / trials).toBeGreaterThan(0.93);
    expect(covered / trials).toBeLessThan(0.975);
  });
});

describe('интервал для p95 по порядковым статистикам', () => {
  it('меньше 73 наблюдений — верхней границы нет; при 73 ею служит самое медленное', () => {
    const at = (n: number) => M.quantile(Float64Array.from({ length: n }, (_, i) => i + 1), 0.95, 1.96);
    expect(Number.isNaN(at(72).hi)).toBe(true);
    expect(at(73).hi).toBe(73);
    expect(t.STATS_NOTE).toContain('меньше 73 запросов');
  });

  it('p95 — наблюдение с рангом ⌈0.95·n⌉', () => {
    const a = Float64Array.from({ length: 200 }, (_, i) => i + 1);
    expect(M.quantile(a, 0.95, 1.96).v).toBe(190);
  });

  it('покрытие ≈ 95% на логнормальных задержках (моделирование с сидом)', () => {
    const rnd = M.mulberry32(42);
    const { median, sigma: s } = M.TRAFFIC;
    const truth = median * Math.exp(s * 1.6448536269514722); // истинная p95 логнормального
    let covered = 0;
    const trials = 1000;
    for (let k = 0; k < trials; k++) {
      const lat = new Float64Array(400);
      for (let i = 0; i < 400; i++) {
        const u1 = rnd() || 1e-12;
        const u2 = rnd();
        lat[i] = median * Math.exp(s * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
      }
      lat.sort();
      const ci = M.quantile(lat, 0.95, 1.96);
      if (ci.lo <= truth && truth <= ci.hi) covered++;
    }
    expect(covered / trials).toBeGreaterThan(0.92);
    expect(covered / trials).toBeLessThan(0.985);
  });
});

describe('правило трёх', () => {
  for (const n of [30, 100, 300, 1000, 10_000]) {
    it(`n = ${n}: при доле 3/n шанс не увидеть ни одной ошибки меньше 5%`, () => {
      expect((1 - 3 / n) ** n).toBeLessThan(0.05);
    });
  }
});

describe('решение анализа', () => {
  const side = (n: number, errors: number): Side => ({ n, errors, lat: [] });

  it('правила на литералах: мало данных — ждать; весь интервал выше предела — откат; ниже — продолжить', () => {
    const base = side(100_000, 500); // 0.5%, предел 1.5%
    expect(M.judgeErrors(base, side(150, 30)).verdict).toBe('wait'); // 20%, но меньше minRequests
    expect(M.judgeErrors(base, side(150, 30)).why).toBe('мало запросов');
    expect(M.judgeErrors(base, side(1000, 60)).verdict).toBe('rollback');
    expect(M.judgeErrors(base, side(1000, 3)).verdict).toBe('continue');
    const unsure = M.judgeErrors(base, side(300, 3));
    expect(unsure.verdict).toBe('wait');
    expect(unsure.why).toBe('интервал накрывает предел');
    expect(M.judgeErrors(side(50, 0), side(1000, 3)).verdict).toBe('wait'); // мало у базы
  });

  it('общее решение: любой откат — откат, продолжить — только если обе метрики за', () => {
    const lat = (k: number, slow: number) => Array.from({ length: k }, (_, i) => (100 + (i % 100)) * slow);
    const base: Side = { n: 20_000, errors: 100, lat: lat(20_000, 1) };
    const fine: Side = { n: 2000, errors: 10, lat: lat(2000, 1) };
    const slow: Side = { n: 2000, errors: 10, lat: lat(2000, 1.5) };
    const broken: Side = { n: 2000, errors: 100, lat: lat(2000, 1) };
    expect(M.decide(base, fine).verdict).toBe('continue');
    expect(M.decide(base, slow).verdict).toBe('rollback');
    expect(M.decide(base, slow).errors.verdict).toBe('continue');
    expect(M.decide(base, broken).verdict).toBe('rollback');
    expect(M.decide(base, broken).latency.verdict).toBe('continue');
  });

  describe('таблица «1% на 5 минут»', () => {
    for (const c of t.LOW_TRAFFIC) {
      it(`${c.perMinute} в минуту, ${c.percent}% × ${c.minutes} мин: при ошибке — ${c.bug}, здоровая — ${c.ok}`, () => {
        const total = c.perMinute * c.minutes;
        const n = Math.round((total * c.percent) / 100);
        const baseN = total - n;
        const base = { n: baseN, errors: Math.round(baseN * 0.005) };
        expect(M.judgeErrors(base, { n, errors: Math.round(n * 0.025) }).verdict).toBe(c.bug);
        expect(M.judgeErrors(base, { n, errors: Math.round(n * 0.005) }).verdict).toBe(c.ok);
      });
    }

    it('таблица на странице собрана из тех же случаев', () => {
      expect(t.LOW_TRAFFIC_TABLE.rows).toHaveLength(t.LOW_TRAFFIC.length);
      expect(t.LOW_TRAFFIC_TABLE.rows.map((r) => r[2])).toEqual(['10', '100', '500', '1000', '1000']);
      expect(t.LOW_TRAFFIC_NOTE).toContain('10 и 100 запросов');
    });

    it('«около пятисот запросов»: с этого объёма анализ различает 2.5% и 0.5%', () => {
      const base = { n: 1_000_000, errors: 5000 };
      const first = (rate: number, verdict: string) => {
        for (let n = 200; n < 5000; n++) {
          if (M.judgeErrors(base, { n, errors: Math.round(n * rate) }).verdict === verdict) return n;
        }
        return Infinity;
      };
      for (const n of [first(0.005, 'continue'), first(0.025, 'rollback')]) {
        expect(n).toBeGreaterThan(400);
        expect(n).toBeLessThan(600);
      }
    });
  });
});

describe('план выката', () => {
  it('длительности: строка с единицей, число — секунды, без срока — null', () => {
    expect(M.minutesOf('10m')).toBe(10);
    expect(M.minutesOf('30s')).toBe(0.5);
    expect(M.minutesOf('1h')).toBe(60);
    expect(M.minutesOf(600)).toBe(10);
    expect(M.minutesOf(undefined)).toBeNull();
    expect(() => M.minutesOf('10 минут')).toThrow();
  });

  it('шаги из PLAN_STEPS — три ступени по 10 минут', () => {
    expect(M.stagesOf(t.PLAN_STEPS)).toEqual([
      { weight: 5, minutes: 10 },
      { weight: 20, minutes: 10 },
      { weight: 50, minutes: 10 },
    ]);
  });

  for (const s of t.SCENARIOS) {
    it(`${s.label}: ${t.PLAN_OUTCOMES[s.id].outcome} на ${t.PLAN_OUTCOMES[s.id].weight}%, минута ${t.PLAN_OUTCOMES[s.id].minute}`, () => {
      const r = M.runPlan(t.PLAN_STEPS, s, { salt: t.CANARY_SALT });
      const last = r.rows.at(-1)!;
      expect(r.outcome).toBe(t.PLAN_OUTCOMES[s.id].outcome);
      expect(last.weight).toBe(t.PLAN_OUTCOMES[s.id].weight);
      expect(last.minute).toBe(t.PLAN_OUTCOMES[s.id].minute);
    });
  }

  it('числа из PLAN_NOTE: ошибку доказывали 15 минут, замедление — на третьей минуте', () => {
    expect(t.PLAN_OUTCOMES.errors.minute).toBe(15);
    expect(t.PLAN_NOTE).toContain('15 минут');
    expect(t.PLAN_OUTCOMES.slow.minute).toBe(3);
    expect(t.PLAN_NOTE).toContain('третьей минуте');
    // Откат по ошибкам случился после плановой паузы — пауза тянулась, потому что данных не хватало.
    const r = M.runPlan(t.PLAN_STEPS, t.SCENARIOS[1], { salt: t.CANARY_SALT });
    expect(r.rows[0].extra).toBe(5);
    expect(r.rows[0].decision!.errors.verdict).toBe('rollback');
    const slow = M.runPlan(t.PLAN_STEPS, t.SCENARIOS[2], { salt: t.CANARY_SALT });
    expect(slow.rows[0].decision!.latency.verdict).toBe('rollback');
  });

  it('«1% на 5 минут» при 2000 в минуту: 82 запроса канарейке, и план встаёт', () => {
    const r = M.runPlan(t.SMALL_PLAN.steps, t.SCENARIOS[1], { salt: t.CANARY_SALT, extraMinutes: t.SMALL_PLAN.extraMinutes });
    expect(r.outcome).toBe('hold');
    expect(r.rows[0].canary!.n).toBe(t.SMALL_PLAN.requests);
    expect(t.PLAN_NOTE).toContain(`${t.SMALL_PLAN.requests} запроса`);
  });

  it('пауза без срока — выкат ждёт человека', () => {
    const r = M.runPlan([{ setWeight: 5 }, { pause: {} }], t.SCENARIOS[0]);
    expect(r.outcome).toBe('hold');
  });

  it('тот же сид — тот же итог; Math.random при этом не зовётся', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random в проверяемом коде');
    });
    try {
      const a = M.runPlan(t.PLAN_STEPS, t.SCENARIOS[1], { salt: t.CANARY_SALT });
      const b = M.runPlan(t.PLAN_STEPS, t.SCENARIOS[1], { salt: t.CANARY_SALT });
      expect(a.rows.map((r) => r.canary)).toEqual(b.rows.map((r) => r.canary));
    } finally {
      spy.mockRestore();
    }
  });

  it('таблица итогов на странице — из тех же литералов', () => {
    expect(t.PLAN_TABLE.rows).toHaveLength(t.SCENARIOS.length);
    t.SCENARIOS.forEach((s, i) => expect(t.PLAN_TABLE.rows[i][2]).toContain(`${t.PLAN_OUTCOMES[s.id].minute}-я минута`));
  });
});

describe('схема БД: расширяй, потом сужай', () => {
  const versions = ['v1', 'v2', 'v3'] as const;

  it('матрица на странице пересчитывается функцией compatible', () => {
    t.SCHEMA_STATES.forEach((state, i) => {
      versions.forEach((v, j) => {
        const got = M.compatible(t.SCHEMA_VERSIONS[v], state.schema);
        const want = t.SCHEMA_MATRIX[i][j];
        expect(got.ok, `${state.label} × ${v}`).toBe(want.ok);
        for (const col of [...got.missing, ...got.unfilled]) expect(want.why).toContain(`\`${col}\``);
      });
    });
  });

  it('в каждом состоянии работают ровно две соседние версии, кроме крайних; v1 и v3 вместе — нигде', () => {
    const working = t.SCHEMA_STATES.map((s) => versions.filter((v) => M.compatible(t.SCHEMA_VERSIONS[v], s.schema).ok));
    expect(working).toEqual([['v1'], ['v1', 'v2'], ['v2', 'v3'], ['v3']]);
  });
});

describe('листинги: разбор и согласованность имён', () => {
  it('все листинги — корректный YAML без повторов ключей', () => {
    for (const code of [t.ROLLOUT_CODE, t.ANALYSIS_CODE, t.BLUEGREEN_CODE, t.FLAGGER_CODE]) {
      expect(docs(code).length).toBeGreaterThan(0);
    }
  });

  it('Argo Rollouts, канарейка: шаги в листинге — те же, что исполняет демо', () => {
    const [rollout] = docs(t.ROLLOUT_CODE);
    expect(rollout.kind).toBe('Rollout');
    expect(rollout.apiVersion).toBe('argoproj.io/v1alpha1');
    expect(rollout.spec.strategy.canary.steps).toEqual(t.PLAN_STEPS);
  });

  it('Argo Rollouts, канарейка: сервисы есть в листинге и смотрят на поды шаблона', () => {
    const [rollout, ...services] = docs(t.ROLLOUT_CODE);
    const canary = rollout.spec.strategy.canary;
    const byName = new Map(services.map((s) => [s.metadata.name, s]));
    const labels = rollout.spec.template.metadata.labels;
    expect(rollout.spec.selector.matchLabels).toEqual(labels);
    for (const name of [canary.stableService, canary.canaryService]) {
      const svc = byName.get(name);
      expect(svc, `Service ${name}`).toBeDefined();
      expect(svc!.kind).toBe('Service');
      expect(svc!.spec.selector).toEqual(labels);
      expect(svc!.spec.ports[0].targetPort).toBe(rollout.spec.template.spec.containers[0].ports[0].containerPort);
      expect(svc!.metadata.namespace).toBe(rollout.metadata.namespace);
    }
    expect(canary.stableService).not.toBe(canary.canaryService);
  });

  it('Argo Rollouts: шаблон анализа найден по имени, аргументы объявлены и использованы', () => {
    const [rollout] = docs(t.ROLLOUT_CODE);
    const [tpl] = docs(t.ANALYSIS_CODE);
    const analysis = rollout.spec.strategy.canary.analysis;
    expect(tpl.kind).toBe('AnalysisTemplate');
    expect(analysis.templates.map((x: Doc) => x.templateName)).toEqual([tpl.metadata.name]);
    expect(tpl.metadata.namespace).toBe(rollout.metadata.namespace);
    const declared = tpl.spec.args.map((a: Doc) => a.name);
    expect(analysis.args.map((a: Doc) => a.name)).toEqual(declared);
    // Аргумент канарейки — сервис канарейки.
    expect(analysis.args[0].value).toBe(rollout.spec.strategy.canary.canaryService);
    const query: string = tpl.spec.metrics[0].provider.prometheus.query;
    for (const name of declared) expect(query).toContain(`{{args.${name}}}`);
    expect(analysis.startingStep).toBeLessThan(t.PLAN_STEPS.length);
  });

  it('порог в шаблоне анализа — тот, что назван в POINT_NOTE', () => {
    const [tpl] = docs(t.ANALYSIS_CODE);
    expect(tpl.spec.metrics[0].successCondition).toBe('result[0] < 0.015');
    expect(t.POINT_NOTE).toContain('1.5%');
  });

  it('Argo Rollouts, сине-зелёный: активный и превью — два разных Service из листинга', () => {
    const [rollout, ...services] = docs(t.BLUEGREEN_CODE);
    const bg = rollout.spec.strategy.blueGreen;
    const names = services.map((s) => s.metadata.name);
    expect(names).toContain(bg.activeService);
    expect(names).toContain(bg.previewService);
    expect(bg.activeService).not.toBe(bg.previewService);
    expect(bg.scaleDownDelaySeconds).toBe(600);
    for (const s of services) expect(s.spec.selector).toEqual(rollout.spec.template.metadata.labels);
  });

  it('Flagger: план из stepWeight и maxWeight — 10, 20, 30, 40, 50, как в тексте', () => {
    const [canary] = docs(t.FLAGGER_CODE);
    expect(canary.kind).toBe('Canary');
    const weights = M.stagesOf(M.flaggerSteps(canary.spec.analysis)).map((s) => s.weight);
    expect(weights).toEqual([10, 20, 30, 40, 50]);
    expect(t.FLAGGER_FACTS[1].d).toContain(weights.join(', '));
  });

  it('Flagger и Argo Rollouts смотрят на один и тот же Ingress', () => {
    const [canary] = docs(t.FLAGGER_CODE);
    const [rollout] = docs(t.ROLLOUT_CODE);
    expect(canary.spec.ingressRef.name).toBe(rollout.spec.strategy.canary.trafficRouting.nginx.stableIngress);
    expect(canary.spec.targetRef.kind).toBe('Deployment');
    expect(canary.spec.analysis.metrics.map((m: Doc) => m.name)).toEqual(['request-success-rate', 'request-duration']);
  });
});

describe('демо: ручной режим тем же кодом', () => {
  const keys = { salt: t.CANARY_SALT, flag: t.FLAG_KEY };
  const grid = Array.from({ length: 400 }, (_, i) => `u${i}`);

  it('точки при росте доли только добавляются — в обоих режимах', () => {
    for (const mode of ['canary', 'flag'] as const) {
      let prev = new Set<string>();
      for (const w of [0, 1, 5, 10, 20, 50, 100]) {
        const route = router(M, mode, keys, w, false);
        const now = new Set(grid.filter((id) => route(id) === 'next'));
        for (const id of prev) expect(now.has(id), `${mode}: ${id} выпал при ${w}%`).toBe(true);
        prev = now;
      }
    }
  });

  it('канарейка и флаг выбирают разных людей при одной доле', () => {
    const a = new Set(IDS.filter((id) => router(M, 'canary', keys, 10, false)(id) === 'next'));
    const b = IDS.filter((id) => router(M, 'flag', keys, 10, false)(id) === 'next');
    const shared = b.filter((id) => a.has(id)).length;
    expect(Math.abs(shared - N * 0.01)).toBeLessThan(4 * sigma(0.01, N));
  });

  it('проигрыш по списку минут детерминирован, а доля канарейки близка к заданной', () => {
    const minutes = Array.from({ length: 5 }, () => ({ weight: 20, killed: false }));
    const a = replay(M, t.SCENARIOS[0], 'canary', keys, minutes);
    const b = replay(M, t.SCENARIOS[0], 'canary', keys, minutes);
    expect(a.stats.next).toEqual(b.stats.next);
    expect(a.log).toHaveLength(5);
    const share = a.stats.next.n / (a.stats.next.n + a.stats.base.n);
    expect(Math.abs(share - 0.2)).toBeLessThan(0.02);
  });

  it('выключатель: после него в функцию не попадает ни один запрос', () => {
    const on = Array.from({ length: 3 }, () => ({ weight: 50, killed: false }));
    const off = Array.from({ length: 3 }, () => ({ weight: 50, killed: true }));
    const before = replay(M, t.SCENARIOS[1], 'flag', keys, on).stats.next.n;
    const after = replay(M, t.SCENARIOS[1], 'flag', keys, [...on, ...off]).stats.next.n;
    expect(before).toBeGreaterThan(0);
    expect(after).toBe(before);
  });
});

describe('текст держит только то, что проверено', () => {
  const text = JSON.stringify(t);

  it('отсылок номером раздела нет', () => {
    expect(text).not.toMatch(/[Рр]аздел[а-я]* \d/);
  });

  it('ссылки внутри сайта ведут в существующие темы', () => {
    const md = [...text.matchAll(/\]\((\/[a-z-]+\/[a-z-]+\/)(#s\d+)?\)/g)].map((m) => m[1]);
    const hrefs = t.PREREQ.map((p) => p.href.replace(/#.*$/, ''));
    const links = [...md, ...hrefs];
    expect(links.length).toBeGreaterThan(5);
    for (const href of new Set(links)) {
      const [, collection, slug] = href.split('/');
      const dir = ({ js: 'lessons', render: 'render', frameworks: 'frameworks', platform: 'platform', tooling: 'tooling', delivery: 'delivery', algorithms: 'algorithms', data: 'data', patterns: 'patterns' } as Record<string, string>)[collection];
      expect(dir, href).toBeDefined();
      expect(existsSync(new URL(`../../src/content/${dir}/${slug}/index.mdx`, import.meta.url)), href).toBe(true);
    }
  });
});
