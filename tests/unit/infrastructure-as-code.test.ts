import { execFile, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/infrastructure-as-code/data';
import * as stand from '@/content/delivery/infrastructure-as-code/stand';
import { toHcl } from '@/widgets/iac-lab/model/hcl';
import { planItems, summaryLine } from '@/widgets/iac-lab/model/render';
import { loadPlanner } from '@/widgets/iac-lab/model/run';
import { allToggles, buildScenario, extraScenarios, type Scenario } from '@/widgets/iac-lab/model/scenario';
import type { PlanResult, StateInstance, TofuPlan } from '@/widgets/iac-lab/model/types';

/**
 * Тема «Инфраструктура как код: Terraform и OpenTofu изнутри».
 *
 * `PLAN_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с планами настоящего OpenTofu на 51 сценарии: 48 сочетаний переключателей демо
 * и три сценария сверх них (`create_before_destroy`, `depends_on`, ресурс убран из конфигурации).
 *
 * Две части:
 *   1. **Без Docker** — планировщик против снятых литералов `stand.ts` (`TOFU_PLANS`): действия
 *      по каждому экземпляру, причина удаления, прежний адрес после `moved`, поля, вызвавшие
 *      замену, дрейф и — порядок шагов: он обязан не нарушать ни одного ребра графа
 *      `tofu graph -plan` (граф apply, а не план). Это закрывает «удаление в обратном порядке»
 *      и протекание `create_before_destroy`.
 *   2. **С Docker и `TOFU_PLUGIN_DIR`** (`describe.skipIf`, если нет `docker`, образа
 *      `ghcr.io/opentofu/opentofu:latest` или зеркала провайдеров: `init` без зеркала
 *      ходил в реестр и висел четверть часа в общем прогоне) — литералы пересобираются: две базы (`count`
 *      и `for_each`) применяются `tofu apply`, затем каждый сценарий получает свой каталог
 *      с `main.tf` из `toHcl`, копией состояния и файлов, правкой `dev.txt` для дрейфа, и в
 *      одном контейнере идут `init`, `fmt -check`, `plan -out`, `show -json`, `show`,
 *      `graph -plan`. Результат обязан совпасть с `TOFU_PLANS` дословно.
 *      Провайдеры качаются из реестра при `init`. Если реестр недоступен (на стенде
 *      registry.opentofu.org отвечал 403 из-за географии), укажите каталог-зеркало в
 *      `TOFU_PLUGIN_DIR` — `init -plugin-dir` возьмёт провайдеры оттуда; без него и без сети
 *      часть с Docker пропускается. `IAC_DUMP=<файл>` пишет снятое в JSON — из него собран
 *      `stand.ts`.
 */

const planner = loadPlanner(t.PLAN_CODE);

const IMAGE = 'ghcr.io/opentofu/opentofu:latest';
const hasDocker = (() => {
  try {
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const input = { base: t.BASE_CONFIG, stateCount: stand.STATE_COUNT, stateForEach: stand.STATE_FOREACH };
const scenarios = (): Scenario[] => [...allToggles().map((tg) => buildScenario(input, tg)), ...extraScenarios(input)];

// ─── Сравнение плана планировщика с планом tofu ────────────────────────────────────────────

const ACTIONS: Record<string, (cbd?: boolean) => string[]> = {
  create: () => ['create'],
  update: () => ['update'],
  'no-op': () => ['no-op'],
  delete: () => ['delete'],
  replace: (cbd) => (cbd ? ['create', 'delete'] : ['delete', 'create']),
};

/** План планировщика в форме `TofuPlan` (без рёбер и строки итога). */
function asTofu(p: PlanResult): Pick<TofuPlan, 'changes' | 'drift'> {
  const changes = p.changes
    .map((c) => ({
      addr: c.addr,
      actions: ACTIONS[c.action](c.cbd),
      ...(c.action === 'replace' ? { reason: 'replace_because_cannot_update' } : {}),
      ...(c.reason ? { reason: c.reason } : {}),
      ...(c.movedFrom ? { previous: c.movedFrom } : {}),
      ...(c.replacePaths?.length ? { replacePaths: [...c.replacePaths].sort() } : {}),
    }))
    .sort((a, b) => a.addr.localeCompare(b.addr));
  const drift = p.drift
    .map((d) => ({ addr: d.addr, actions: d.kind === 'deleted' ? ['delete'] : ['update'] }))
    .sort((a, b) => a.addr.localeCompare(b.addr));
  return { changes, drift };
}

/** Порядок шагов не нарушает ни одного ребра графа apply. */
function orderViolations(p: PlanResult, edges: [string, string][]): string[] {
  const pos = new Map(p.steps.map((s, i) => [s.step === 'destroy' ? `${s.addr} (destroy)` : s.addr, i]));
  const bad: string[] = [];
  for (const [from, to] of edges) {
    const a = pos.get(from);
    const b = pos.get(to);
    if (a === undefined || b === undefined) {
      bad.push(`нет шага: ${a === undefined ? from : to}`);
      continue;
    }
    if (b > a) bad.push(`${from} раньше ${to}`);
  }
  return bad;
}

describe('PLAN_CODE против снятых планов OpenTofu', () => {
  it('литералы покрывают все сценарии', () => {
    expect(scenarios()).toHaveLength(51);
    expect(Object.keys(stand.TOFU_PLANS).sort()).toEqual(scenarios().map((s) => s.id).sort());
  });

  for (const sc of scenarios()) {
    it(`${sc.id}: действия, причины, moved, дрейф и порядок`, () => {
      const want = stand.TOFU_PLANS[sc.id];
      const got = planner.plan(sc.config, sc.state, t.SCHEMA, sc.world);
      expect(asTofu(got)).toEqual({ changes: want.changes, drift: want.drift });
      expect(orderViolations(got, want.edges)).toEqual([]);
    });
  }
});

// ─── Вид плана в демо и тексты темы против снятого ─────────────────────────────────────────

const byId = (id: string) => scenarios().find((s) => s.id === id)!;
const countRes = (sc: Scenario) => new Set(sc.config.resources.filter((r) => r.count).map((r) => `${r.type}.${r.name}`));
/** Строки-заголовки `# …` и `Plan:` из текста темы. */
const headLines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => (l.startsWith('# ') && !/unchanged attributes? hidden/.test(l)) || l.startsWith('Plan:'));

describe('вид плана: заголовки и итог как у tofu show', () => {
  for (const sc of scenarios()) {
    it(sc.id, () => {
      const want = stand.TOFU_PLANS[sc.id];
      const got = planner.plan(sc.config, sc.state, t.SCHEMA, sc.world);
      expect(planItems(got, countRes(sc)).flatMap((i) => i.headers)).toEqual(want.headers);
      expect(summaryLine(got)).toBe(want.summary);
    });
  }
});

describe('тексты темы совпадают со снятым', () => {
  it('MAIN_TF — это toHcl(BASE_CONFIG), а фрагменты HCL — из конфигураций сценариев', () => {
    expect(toHcl(t.BASE_CONFIG, { header: true })).toBe(t.MAIN_TF);
    expect(toHcl(byId('extra.depends').config)).toContain(t.DEPENDS_HCL);
    expect(toHcl(byId('extra.cbd').config)).toContain(t.CBD_HCL);
    expect(toHcl(byId('for_each.none.all.clean').config)).toContain(t.FOREACH_HCL);
    expect(toHcl(byId('moved.none.all.clean').config)).toContain(t.MOVED_HCL);
  });

  it('выдержки из планов: заголовки и итог есть в снятом tofu show', () => {
    const cases: [string, string][] = [
      [t.PLAN_INPUT_TEXT, 'count.input.all.clean'],
      [t.CBD_TEXT, 'extra.cbd'],
      [t.COUNT_DROP_TEXT, 'count.none.drop.clean'],
      [t.FOREACH_DROP_TEXT, 'for_each.none.drop.clean'],
      [t.MIGRATE_TEXT, 'migrate.none.all.clean'],
      [t.MOVED_TEXT, 'moved.none.all.clean'],
    ];
    for (const [text, id] of cases) {
      const want = stand.TOFU_PLANS[id];
      for (const line of headLines(text)) expect([...want.headers, want.summary], `${id}: ${line}`).toContain(line);
    }
    expect(t.SECOND_RUN).toContain(stand.TOFU_PLANS['count.none.all.clean'].summary);
  });

  it('действия, о которых говорит текст', () => {
    const actions = (id: string) => Object.fromEntries(stand.TOFU_PLANS[id].changes.map((c) => [c.addr, c.actions.join(',')]));
    // Правка на месте у релиза превращается в замену файла (UNKNOWN_STEPS).
    expect(actions('count.input.all.clean')).toMatchObject({ 'terraform_data.release': 'update', 'local_file.config': 'delete,create' });
    // create_before_destroy протекает на питомца, которому его никто не объявлял (CBD_NOTE).
    expect(actions('extra.cbd')).toMatchObject({ 'local_file.config': 'create,delete', 'random_pet.app': 'create,delete' });
    expect(byId('extra.cbd').config.resources.find((r) => r.type === 'random_pet')?.createBeforeDestroy).toBeUndefined();
    // Полный план, который сужает -target (TARGET_NOTE).
    expect(stand.TOFU_PLANS['count.input.drop.clean'].summary).toBe('Plan: 2 to add, 1 to change, 3 to destroy.');
    expect(t.TARGET_NOTE).toContain('2 to add, 1 to change, 3 to destroy');
    // Переход без moved при дрейфе: на одно удаление меньше (DEMO_CAPTION).
    expect(stand.TOFU_PLANS['migrate.none.all.clean'].summary).toBe('Plan: 3 to add, 0 to change, 3 to destroy.');
    expect(stand.TOFU_PLANS['migrate.none.all.drift'].summary).toBe('Plan: 3 to add, 0 to change, 2 to destroy.');
    // Ресурс, убранный из конфигурации, удаляется, а его зависимости записаны в состоянии.
    expect(actions('extra.removed')).toMatchObject({ 'local_file.config': 'delete' });
    expect(stand.STATE_COUNT.find((s) => s.addr === 'local_file.config')?.deps).toHaveLength(3);
  });

  it('рёбра графа apply в тексте — ровно рёбра снятого графа', () => {
    expect(t.APPLY_EDGES.map((e) => [e.from, e.to])).toEqual(stand.TOFU_PLANS['count.input.drop.clean'].edges);
    // depends_on: замена env[1] ждёт правки релиза (DEPENDS_NOTE).
    expect(stand.TOFU_PLANS['extra.depends'].edges).toContainEqual(['local_file.env[1]', 'terraform_data.release']);
    expect(stand.TOFU_PLANS['count.input.drop.clean'].edges).not.toContainEqual(['local_file.env[1]', 'terraform_data.release']);
  });

  it('случайные значения в текстах — те же, что в снятом состоянии', () => {
    const at = (addr: string) => stand.STATE_COUNT.find((s) => s.addr === addr)!.attrs;
    const password = String(at('random_password.db').result);
    const pet = String(at('random_pet.app').id);
    const shown = JSON.parse(t.STATE_JSON_CODE) as { lineage: string };
    expect(t.STATE_JSON_CODE).toContain(password);
    expect(t.SENSITIVE_RUN).toContain(password);
    expect(at('local_file.config').content).toBe(`app=${pet}\nrelease=v1\ndb_password=${password}\n`);
    expect(t.CBD_TEXT).toContain(`"${pet}"`);
    expect(t.PLAN_INPUT_TEXT).toContain(String(at('local_file.config').id));
    expect(t.PLAN_INPUT_TEXT).toContain(String(at('terraform_data.release').id));
    expect(t.LINEAGE_CODE).toContain(shown.lineage);
  });

  it('планировщик в тексте назван по размеру', () => {
    const lines = t.PLAN_CODE.split('\n').length;
    expect(lines).toBeGreaterThan(120);
    expect(lines).toBeLessThan(140);
    expect(t.PLANNER_INTRO).toContain('сто тридцать');
  });
});

// ─── Стенд: пересборка литералов настоящим tofu ────────────────────────────────────────────

const PLUGIN_DIR = process.env.TOFU_PLUGIN_DIR;

function docker(dir: string, script: string): string {
  const args = ['run', '--rm', '-v', `${dir}:/w`, '-w', '/w', '-e', 'TF_IN_AUTOMATION=1'];
  if (PLUGIN_DIR) args.push('-v', `${PLUGIN_DIR}:/plugins:ro`);
  else args.push('-e', 'TF_PLUGIN_CACHE_DIR=/w/.plugin-cache');
  args.push('--entrypoint', 'sh', IMAGE, '-c', script);
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}
const INIT = PLUGIN_DIR ? 'tofu init -input=false -plugin-dir=/plugins >/dev/null' : 'mkdir -p /w/.plugin-cache && tofu init -input=false >/dev/null';

/** Адрес экземпляра из записи состояния. */
const addrOf = (r: { type: string; name: string }, key?: string | number) =>
  `${r.type}.${r.name}${key === undefined ? '' : typeof key === 'number' ? `[${key}]` : `["${key}"]`}`;

/** Состояние в форме планировщика: поля конфигурации и вычисляемые, на которые есть ссылки. */
function compactState(tfstate: string): StateInstance[] {
  const KEEP = ['id', 'length', 'special', 'result', 'input', 'output', 'filename', 'content'];
  const json = JSON.parse(tfstate) as {
    resources: { type: string; name: string; instances: { index_key?: string | number; attributes: Record<string, unknown>; dependencies?: string[] }[] }[];
  };
  return json.resources.flatMap((r) =>
    r.instances.map((i) => {
      const attrs: Record<string, unknown> = {};
      for (const k of KEEP) {
        if (!(k in i.attributes)) continue;
        const v = i.attributes[k];
        // terraform_data хранит input/output как { value, type }.
        attrs[k] = v && typeof v === 'object' && 'value' in v ? (v as { value: unknown }).value : v;
      }
      return { addr: addrOf(r, i.index_key), attrs, ...(i.dependencies ? { deps: i.dependencies } : {}) };
    }),
  );
}

/** Рёбра между шагами apply: транзитивно, через узлы `(expand)`, провайдеры и `local.*`. */
function stepEdges(dot: string): [string, string][] {
  const adj = new Map<string, string[]>();
  const unq = (s: string) => s.replaceAll('\\"', '"');
  for (const m of dot.matchAll(/^\s*"((?:[^"\\]|\\.)*)" -> "((?:[^"\\]|\\.)*)"$/gm)) {
    const [a, b] = [unq(m[1]), unq(m[2])];
    adj.set(a, [...(adj.get(a) ?? []), b]);
  }
  const step = (n: string) => {
    const m = /^\[root\] ([a-z_]+\.[a-z_]+(?:\[[^\]]+\])?)( \(destroy(?: deposed \w+)?\))?$/.exec(n);
    return m ? `${m[1]}${m[2] ? ' (destroy)' : ''}` : null;
  };
  const out = new Set<string>();
  for (const start of adj.keys()) {
    const from = step(start);
    if (!from) continue;
    const seen = new Set<string>();
    const stack = [...(adj.get(start) ?? [])];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      const to = step(n);
      if (to) out.add(JSON.stringify([from, to]));
      stack.push(...(adj.get(n) ?? []));
    }
  }
  return [...out].sort().map((e) => JSON.parse(e) as [string, string]);
}

interface PlanJson {
  resource_changes?: { address: string; previous_address?: string; action_reason?: string; change: { actions: string[]; replace_paths?: string[][] } }[];
  resource_drift?: { address: string; change: { actions: string[] } }[];
}

function compactPlan(planJson: string, dot: string, text: string): TofuPlan {
  const p = JSON.parse(planJson) as PlanJson;
  const changes = (p.resource_changes ?? [])
    .map((r) => ({
      addr: r.address,
      actions: r.change.actions,
      ...(r.action_reason ? { reason: r.action_reason } : {}),
      ...(r.previous_address ? { previous: r.previous_address } : {}),
      ...(r.change.replace_paths ? { replacePaths: r.change.replace_paths.map((x) => x.join('.')).sort() } : {}),
    }))
    .sort((a, b) => a.addr.localeCompare(b.addr));
  const drift = (p.resource_drift ?? []).map((r) => ({ addr: r.address, actions: r.change.actions })).sort((a, b) => a.addr.localeCompare(b.addr));
  const summary = /^(Plan: .*|No changes\..*)$/m.exec(text)?.[1] ?? '';
  // Заголовки экземпляров: «# local_file.env[1] must be replaced», «# (because …)».
  const headers = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('# ') && !/unchanged (attribute|element)s? hidden/.test(l));
  return { changes, drift, edges: stepEdges(dot), summary, headers };
}

describe.skipIf(!hasDocker || !PLUGIN_DIR)('стенд: настоящий tofu пересобирает литералы', () => {
  const root = mkdtempSync(join(tmpdir(), 'iac-'));
  const fresh: Record<string, TofuPlan> = {};
  const bases: Record<'count' | 'for_each', string> = { count: '', for_each: '' };
  const fmtFailed: string[] = [];
  let unavailable = '';

  beforeAll(() => {
    // 1. Две базы: сквозной пример с count и с for_each — настоящий apply.
    const forEach = { resources: t.BASE_CONFIG.resources.map((r) => (r.count ? { ...r, count: undefined, forEach: r.count } : r)) };
    for (const [name, cfg] of [['base-count', t.BASE_CONFIG], ['base-foreach', forEach]] as const) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, 'main.tf'), toHcl(cfg, { header: true }));
    }
    try {
      docker(root, `set -e; for d in base-count base-foreach; do cd /w/$d; ${INIT}; tofu apply -auto-approve -input=false >/dev/null; done`);
    } catch (e) {
      // Реестр провайдеров недоступен (сеть, география) — пересобрать нечем. Это не поломка темы.
      const err = String((e as { stderr?: string }).stderr ?? e);
      if (!/provider/i.test(err)) throw e;
      unavailable = err.split('\n').find((l) => /Error|403|connect/.test(l)) ?? 'init не смог скачать провайдеры';
      return;
    }
    bases.count = readFileSync(join(root, 'base-count/terraform.tfstate'), 'utf8');
    bases.for_each = readFileSync(join(root, 'base-foreach/terraform.tfstate'), 'utf8');

    // 2. Каталог на сценарий: main.tf из toHcl, состояние и файлы базы, правка для дрейфа.
    const list = scenarios();
    list.forEach((sc, i) => {
      const dir = join(root, `s${i}`);
      const base = sc.state === stand.STATE_COUNT ? 'base-count' : 'base-foreach';
      mkdirSync(dir);
      writeFileSync(join(dir, 'main.tf'), toHcl(sc.config, { header: true }));
      cpSync(join(root, base, 'terraform.tfstate'), join(dir, 'terraform.tfstate'));
      cpSync(join(root, base, 'out'), join(dir, 'out'), { recursive: true });
      if (Object.keys(sc.world).length) writeFileSync(join(dir, 'out/dev.txt'), 'env=dev, debug=true\n');
    });
    docker(
      root,
      `for i in $(seq 0 ${list.length - 1}); do cd /w/s$i; ${INIT} && (tofu fmt -check >/dev/null || echo s$i >> /w/fmt-failed) && tofu plan -out=tfplan -input=false >/dev/null && tofu show -json tfplan > plan.json && tofu show -no-color tfplan > plan.txt && tofu graph -plan=tfplan > graph.dot; done`,
    );
    try {
      fmtFailed.push(...readFileSync(join(root, 'fmt-failed'), 'utf8').split('\n').filter(Boolean));
    } catch {
      /* файла нет — все main.tf отформатированы как у tofu fmt */
    }
    list.forEach((sc, i) => {
      const dir = join(root, `s${i}`);
      const r = (f: string) => readFileSync(join(dir, f), 'utf8');
      fresh[sc.id] = compactPlan(r('plan.json'), r('graph.dot'), r('plan.txt'));
    });
    runSide();
    if (process.env.IAC_DUMP) {
      writeFileSync(
        process.env.IAC_DUMP,
        JSON.stringify({ plans: fresh, stateCount: compactState(bases.count), stateForEach: compactState(bases.for_each), root }, null, 2),
      );
    }
  }, 600_000);

  // 3. Опыты для текста темы — одним контейнером, вывод каждой команды в свой файл.
  const side: Record<string, string> = {};
  const SIDE_PROBE = `ephemeral "random_password" "tmp" {
  length  = 16
  special = false
}

resource "terraform_data" "probe" {
  provisioner "local-exec" {
    command = "true"
    environment = {
      PW = ephemeral.random_password.tmp.result
    }
  }
}
`;
  const LOCK_TF = `resource "terraform_data" "slow" {
  provisioner "local-exec" {
    command = "sleep 6"
  }
}
`;
  function runSide() {
    const sd = join(root, 'side');
    const put = (dir: string, files: Record<string, string>) => {
      mkdirSync(join(sd, dir), { recursive: true });
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(join(sd, dir, f, '..'), { recursive: true });
        writeFileSync(join(sd, dir, f), text);
      }
    };
    const copyBase = (dir: string, from = join(root, 'base-count')) => {
      cpSync(from, join(sd, dir), { recursive: true, filter: (src) => !src.includes('.terraform') });
    };
    mkdirSync(sd);
    copyBase('sens');
    writeFileSync(join(sd, 'sens/main.tf'), toHcl(t.BASE_CONFIG, { header: true }) + '\n' + t.SENSITIVE_HCL + '\n');
    put('enc', { 'main.tf': t.ENCRYPTION_HCL });
    copyBase('lin');
    const other = readFileSync(join(root, 'base-foreach/terraform.tfstate'), 'utf8');
    const mine = JSON.parse(bases.count) as { lineage: string; serial: number };
    writeFileSync(join(sd, 'lin/other.tfstate'), other);
    writeFileSync(join(sd, 'lin/older.tfstate'), JSON.stringify({ ...JSON.parse(other), lineage: mine.lineage, serial: mine.serial }));
    put('lock', { 'main.tf': LOCK_TF });
    const idx = (id: string) => scenarios().findIndex((x) => x.id === id);
    copyBase('target', join(root, `s${idx('count.input.drop.clean')}`));
    copyBase('refresh', join(root, `s${idx('count.none.all.drift')}`));
    copyBase('replace');
    put('imp', { 'main.tf': t.IMPORT_HCL + '\n' });
    put('imp-file', { 'main.tf': 'import {\n  to = local_file.manual\n  id = "out/manual.txt"\n}\n', 'out/manual.txt': 'created by hand\n' });
    put('eph', { 'main.tf': t.EPHEMERAL_HCL + '\n' });
    put('eph-probe', { 'main.tf': SIDE_PROBE });
    put('mod', {
      'main.tf': t.MODULE_ROOT_HCL + '\n',
      'modules/site/main.tf': t.MODULE_SITE_HCL + '\n',
    });
    const script = [
      'cd /w/side/sens && ' + INIT + ' && tofu apply -auto-approve -input=false >/dev/null && tofu output -no-color > res1 && tofu output -raw db_password > res2 && tofu output -json > res3',
      'cd /w/side/enc && ' + INIT + ' && tofu apply -auto-approve -input=false >/dev/null && tofu show -json > show.json && cp terraform.tfstate enc.tfstate && sed -i s/correct-horse-battery-staple/wrong-passphrase-1234567/ main.tf && (tofu plan -no-color > wrong 2>&1; true)',
      'cd /w/side/lin && ' + INIT + ' && (tofu state push -no-color other.tfstate > err1 2>&1; true) && (tofu state push -no-color older.tfstate > err2 2>&1; true)',
      // Замок файла: на смонтированном каталоге хоста он может не работать — опыт в /tmp контейнера.
      'cp -r /w/side/lock /tmp/lock && cd /tmp/lock && ' + INIT + ' && (tofu apply -auto-approve -no-color > /tmp/apply.log 2>&1 &) && sleep 3 && (tofu plan -no-color > /w/side/lock/err 2>&1; true) && sleep 6',
      'cd /w/side/target && ' + INIT + ' && tofu plan -no-color -target=local_file.config > res 2>&1',
      'cd /w/side/refresh && ' + INIT + ' && tofu plan -no-color -refresh-only > res 2>&1 && tofu plan -no-color > res2 2>&1',
      'cd /w/side/replace && ' + INIT + ' && tofu plan -no-color -replace=local_file.config -out=tfplan > res 2>&1 && tofu show -json tfplan > plan.json',
      'cd /w/side/imp && ' + INIT + ' && tofu plan -no-color -generate-config-out=generated.tf > res 2>&1',
      'cd /w/side/imp-file && ' + INIT + ' && (tofu plan -no-color -generate-config-out=g.tf > res 2>&1; true)',
      'cd /w/side/eph && ' + INIT + ' && (tofu plan -no-color > res 2>&1; true)',
      'cd /w/side/eph-probe && ' + INIT + ' && tofu apply -auto-approve -no-color > res 2>&1',
      'cd /w/side/mod && ' + INIT + ' && tofu apply -auto-approve -no-color > res 2>&1 && tofu state list > list && (tofu fmt -check -recursive > fmt 2>&1; echo $? >> fmt)',
      'cd /w/base-count && tofu graph > /w/side/graph.dot && tofu apply -h > /w/side/apply-h 2>&1; tofu plan -h > /w/side/plan-h 2>&1; tofu -h > /w/side/tofu-h 2>&1; tofu providers schema -json > /w/side/schema.json',
    ].join('\n');
    docker(root, script);
    const files = ['sens/res1', 'sens/res2', 'sens/res3', 'sens/terraform.tfstate', 'enc/show.json', 'enc/enc.tfstate', 'enc/wrong', 'lin/err1', 'lin/err2', 'lock/err', 'target/res', 'refresh/res', 'refresh/res2', 'replace/res', 'replace/plan.json', 'imp/res', 'imp/generated.tf', 'imp-file/res', 'eph/res', 'eph-probe/terraform.tfstate', 'mod/res', 'mod/list', 'mod/fmt', 'graph.dot', 'apply-h', 'plan-h', 'tofu-h', 'schema.json'];
    for (const f of files) side[f] = readFileSync(join(sd, f), 'utf8');
  }

  /** Каждая непустая строка выдержки (кроме команд `$ …` и `...`) есть в выводе — с точностью до пробелов. */
  const sq = (s: string) => s.replace(/\s+/g, ' ').trim();
  function linesIn(excerpt: string, output: string, skip: (l: string) => boolean = () => false) {
    const out = output.split('\n').map(sq);
    for (const raw of excerpt.split('\n')) {
      const line = sq(raw.replace(/\s+#\s[^"]*$/, (m) => (/forces replacement/.test(m) ? m : '')));
      if (!line || line.startsWith('$') || line === '...' || skip(line)) continue;
      expect(out.some((o) => o.includes(line)), line).toBe(true);
    }
  }

  it('sensitive: на экране скрыт, в состоянии — трижды открытым текстом, serial вырос', (ctx) => {
    if (unavailable) ctx.skip();
    const state = JSON.parse(side['sens/terraform.tfstate']) as { serial: number; resources: { type: string; instances: { attributes: { result?: string } }[] }[] };
    const password = state.resources.find((r) => r.type === 'random_password')!.instances[0].attributes.result!;
    expect(side['sens/res1'].trim()).toBe('db_password = <sensitive>');
    expect(side['sens/res2']).toBe(password);
    expect((JSON.parse(side['sens/res3']) as { db_password: { value: string } }).db_password.value).toBe(password);
    expect(side['sens/terraform.tfstate'].split(password).length - 1).toBe(3);
    expect(t.SENSITIVE_FACTS[0].t).toBe('Три копии пароля');
    expect(state.serial).toBe(2);
  });

  it('шифрование состояния: пароля в файле нет, параметры ключа в meta, чужая фраза — отказ', (ctx) => {
    if (unavailable) ctx.skip();
    const show = JSON.parse(side['enc/show.json']) as { values: { root_module: { resources: { values: { result: string } }[] } } };
    const password = show.values.root_module.resources[0].values.result;
    const enc = JSON.parse(side['enc/enc.tfstate']) as Record<string, unknown> & { meta: Record<string, string> };
    expect(Object.keys(enc).sort()).toEqual(['encrypted_data', 'encryption_version', 'lineage', 'meta', 'serial']);
    expect(side['enc/enc.tfstate']).not.toContain(password);
    const meta = JSON.parse(Buffer.from(enc.meta['key_provider.pbkdf2.pass'], 'base64').toString()) as { iterations: number; hash_function: string };
    expect(meta).toMatchObject({ iterations: 600000, hash_function: 'sha512' });
    expect(t.ENCRYPTION_NOTE).toContain('600 000, SHA-512');
    linesIn(t.ENCRYPTED_STATE.split('$ tofu plan')[1], side['enc/wrong']);
  });

  it('state push: чужой lineage и тот же serial — отказ', (ctx) => {
    if (unavailable) ctx.skip();
    const [first, second] = t.LINEAGE_CODE.split('$ tofu state push older.tfstate');
    const anyLineage = (l: string) => l.includes('lineage');
    linesIn(first, side['lin/err1'], anyLineage);
    expect(side['lin/err1']).toMatch(/cannot import state with lineage "[0-9a-f-]+" over/);
    linesIn(second, side['lin/err2']);
  });

  it('замок файла внутри одного контейнера останавливает второй процесс', (ctx) => {
    if (unavailable) ctx.skip();
    expect(side['lock/err']).toContain('Error acquiring the state lock');
    expect(side['lock/err']).toContain('OperationTypeApply');
  });

  it('-target, refresh-only, -replace, import, ephemeral — выдержки совпадают с выводом', (ctx) => {
    if (unavailable) ctx.skip();
    linesIn(t.TARGET_RUN, side['target/res']);
    const [refreshOnly, plain] = t.DRIFT_RUN.split('$ tofu plan\n');
    linesIn(refreshOnly.split('$ tofu plan -refresh-only')[1], side['refresh/res']);
    linesIn(plain, side['refresh/res2']);
    expect(side['replace/res']).toContain('# local_file.config will be replaced, as requested');
    const rc = (JSON.parse(side['replace/plan.json']) as { resource_changes: { address: string; action_reason?: string }[] }).resource_changes;
    expect(rc.find((r) => r.address === 'local_file.config')?.action_reason).toBe('replace_by_request');
    const [impPlan, impGen] = t.IMPORT_RUN.split('$ cat generated.tf');
    linesIn(impPlan, side['imp/res']);
    linesIn(impGen, side['imp/generated.tf']);
    expect(side['imp-file/res']).toContain('Resource Import Not Implemented');
    linesIn(t.EPHEMERAL_ERROR, side['eph/res']);
    const probe = JSON.parse(side['eph-probe/terraform.tfstate']) as { resources: { mode: string; instances: { dependencies?: string[] }[] }[] };
    expect(probe.resources.map((r) => r.mode)).toEqual(['managed']);
    expect(probe.resources[0].instances[0].dependencies).toEqual(['ephemeral.random_password.tmp']);
  });

  it('модуль, граф, справка и схема провайдеров', (ctx) => {
    if (unavailable) ctx.skip();
    linesIn(t.MODULE_RUN, side['mod/list']);
    expect(side['mod/fmt'].trim()).toBe('0');
    const edges = (dot: string) =>
      dot
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.includes(' -> ') && !l.includes('provider'));
    expect(edges(side['graph.dot'])).toEqual(edges(t.GRAPH_DOT));
    expect(sq(side['apply-h'])).toContain('-parallelism=n Limit the number of parallel resource operations. Defaults to 10.');
    for (const flag of ['-exclude=resource', '-detailed-exitcode', '-lock-timeout', '-refresh-only', '-replace=resource', '-generate-config-out']) {
      expect(side['plan-h'], flag).toContain(flag);
    }
    expect(side['tofu-h']).toContain('force-unlock');
    const schema = JSON.parse(side['schema.json']) as {
      provider_schemas: Record<string, { resource_schemas?: Record<string, { block: { attributes: Record<string, { computed?: boolean; optional?: boolean }> } }> }>;
    };
    const all = Object.assign({}, ...Object.values(schema.provider_schemas).map((p) => p.resource_schemas ?? {})) as Record<string, { block: { attributes: Record<string, { computed?: boolean; optional?: boolean }> } }>;
    for (const [type, sch] of Object.entries(t.SCHEMA)) {
      const attrs = all[type].block.attributes;
      const computed = Object.keys(attrs).filter((k) => attrs[k].computed && !attrs[k].optional).sort();
      expect(computed, type).toEqual([...sch.computed].sort());
      for (const k of sch.forceNew) expect(Object.keys(attrs), `${type}.${k}`).toContain(k);
    }
  });

  it('бэкенд http: запросы каждой команды и отказ 423, пока замок занят', async (ctx) => {
    if (unavailable) ctx.skip();
    // Свой сервер состояния: GET/POST, LOCK/UNLOCK, занято — 423 с данными замка.
    const log: string[] = [];
    let state: string | null = null;
    let lock: string | null = null;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c));
      req.on('end', () => {
        const u = new URL(req.url ?? '/', 'http://x');
        let code = 200;
        let out = '';
        if (req.method === 'GET') {
          if (state) out = state;
          else code = 204;
        } else if (req.method === 'POST') state = body;
        else if (req.method === 'LOCK') {
          if (lock) {
            code = 423;
            out = lock;
          } else lock = body;
        } else if (req.method === 'UNLOCK') lock = null;
        log.push(`${req.method} ${u.pathname}${u.search ? '?ID' : ''} → ${code}`);
        res.writeHead(code);
        res.end(out);
      });
    });
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
    const port = (server.address() as AddressInfo).port;
    const dir = join(root, 'http');
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'main.tf'),
      t.BACKEND_HCL.replaceAll(':5001/', `:${port}/`) +
        '\n\nresource "terraform_data" "release" {\n  input = "v1"\n\n  provisioner "local-exec" {\n    command = "sleep 4"\n  }\n}\n',
    );
    const run = promisify(execFile);
    const tofu = (...cmd: string[]) => {
      const args = ['run', '--rm', '--add-host', 'host.docker.internal:host-gateway', '-v', `${dir}:/w`, '-w', '/w'];
      if (PLUGIN_DIR) args.push('-v', `${PLUGIN_DIR}:/plugins:ro`);
      return run('docker', [...args, IMAGE, ...cmd, '-no-color']);
    };
    const take = () => log.splice(0).map((l) => l);
    try {
      await tofu('init', '-input=false', ...(PLUGIN_DIR ? ['-plugin-dir=/plugins'] : []));
      const seen: Record<string, string[]> = { init: take() };
      await tofu('plan', '-input=false');
      seen.plan = take();
      await tofu('apply', '-auto-approve', '-input=false');
      seen.apply = take();
      // Шаблон из текста: строки «tofu X» начинают новую команду.
      const want: Record<string, string[]> = {};
      let cmd = '';
      for (const line of t.HTTP_LOG.split('\n')) {
        const m = /^(?:tofu (\w+))?\s+(\w+)\s+(\S+)\s+→ (\d+)/.exec(line)!;
        if (m[1]) cmd = m[1];
        (want[cmd] ??= []).push(`${m[2]} ${m[3].replace(/\?ID=.*/, '?ID')} → ${m[4]}`);
      }
      expect(seen).toEqual(want);
      // Второй процесс, пока первый держит замок.
      const busy = tofu('apply', '-auto-approve', '-input=false', '-replace=terraform_data.release');
      while (!log.includes('LOCK /state/app → 200')) await new Promise((r) => setTimeout(r, 100));
      const second = await tofu('plan', '-input=false').then(
        () => '',
        (e: { stderr: string }) => e.stderr,
      );
      await busy;
      expect(log).toContain('LOCK /state/app → 423');
      linesIn(t.LOCK_CONFLICT, second, (l) => /^(ID|Who|Created)|^ID=/.test(l));
    } finally {
      server.close();
    }
  }, 120_000);

  it('toHcl печатает так же, как tofu fmt', (ctx) => {
    if (unavailable) ctx.skip(`провайдеры не скачались: ${unavailable}; задайте TOFU_PLUGIN_DIR`);
    expect(fmtFailed).toEqual([]);
  });

  it('планы всех сценариев совпадают с TOFU_PLANS', (ctx) => {
    if (unavailable) ctx.skip();
    for (const [id, plan] of Object.entries(fresh)) expect(plan, id).toEqual(stand.TOFU_PLANS[id]);
  });

  it('состояния баз — те же адреса, зависимости и поля, кроме случайных значений', (ctx) => {
    if (unavailable) ctx.skip();
    const shape = (s: StateInstance[]) =>
      s.map((i) => ({ ...i, attrs: Object.fromEntries(Object.entries(i.attrs).map(([k, v]) => [k, ['id', 'result'].includes(k) || (i.addr === 'local_file.config' && k === 'content') ? typeof v : v])) }));
    expect(shape(compactState(bases.count))).toEqual(shape(stand.STATE_COUNT));
    expect(shape(compactState(bases.for_each))).toEqual(shape(stand.STATE_FOREACH));
  });
});
