<script setup lang="ts">
/**
 * Одно и то же `package.json` — две раскладки `node_modules`: подъёмом (npm) и изолированно (pnpm).
 *
 * Деревья **вычисляются** правилом из `../model/layout.ts`, версии выбирает строка `SEMVER_CODE`
 * из темы. Снятые на стенде деревья (`runs`) приходят пропом только для сверки: под каждой
 * колонкой остров сам сравнивает посчитанное со снятым и пишет, совпало ли. Тот же расчёт
 * и та же сверка — в `tests/unit/package-managers.test.ts`.
 *
 * Расчёт — после `onMounted`: до гидратации остров показывает, что считать пока нечем.
 */
import { computed, onMounted, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { compileSemver } from '../model/semver';
import type { SemverApi } from '../model/semver';
import { formatEntry, layoutNpm, layoutPnpm } from '../model/layout';
import type { Entry, Layout, Registry, Tag } from '../model/layout';

interface Scenario {
  id: string;
  label: string;
  deps: Record<string, string>;
  note: string;
}

interface Run {
  exit: number;
  tree: string[];
  log: string[];
}

const props = defineProps<{
  code: string;
  registry: Registry;
  scenarios: Scenario[];
  runs: Record<string, { npm: Run; pnpm: Run }>;
}>();

const scenarioId = ref(props.scenarios[0].id);
const peerMode = ref<'default' | 'legacy'>('default');
const api = shallowRef<SemverApi | null>(null);
const failure = ref('');

onMounted(() => {
  try {
    api.value = compileSemver(props.code);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  }
});

const SCENARIO_OPTIONS = props.scenarios.map((s) => ({ value: s.id, label: s.label }));
const PEER_OPTIONS = [
  { value: 'default', label: 'npm по умолчанию' },
  { value: 'legacy', label: 'npm --legacy-peer-deps' },
];

const TAG_LABEL: Record<Tag, string> = {
  declared: 'объявлен',
  phantom: 'фантом',
  nested: 'вложен',
  duplicate: 'копия',
  hidden: 'скрытый подъём',
};

const scenario = computed(() => props.scenarios.find((s) => s.id === scenarioId.value)!);

/** Манифесты, которые участвуют в сценарии: корень и всё, что до него дотянулось. */
const manifestLines = computed(() => {
  const lines = [`приложение → ${fmtDeps(scenario.value.deps)}`];
  const seen = new Set<string>();
  const walk = (deps: Record<string, string>) => {
    for (const name of Object.keys(deps)) {
      if (seen.has(name)) continue;
      seen.add(name);
      for (const [version, m] of Object.entries(props.registry[name] ?? {})) {
        const parts = [
          m.deps ? fmtDeps(m.deps) : '',
          m.peers ? `peer ${fmtDeps(m.peers)}` : '',
        ].filter(Boolean);
        if (parts.length) lines.push(`${name}@${version} → ${parts.join(', ')}`);
        walk({ ...m.deps, ...m.peers });
      }
    }
  };
  walk(scenario.value.deps);
  return lines;
});

function fmtDeps(deps: Record<string, string>) {
  return Object.entries(deps)
    .map(([n, r]) => `${n}@${r}`)
    .join(', ');
}

const npm = computed<Layout | null>(() =>
  api.value
    ? layoutNpm(props.registry, scenario.value.deps, api.value, { legacyPeerDeps: peerMode.value === 'legacy' })
    : null,
);
const pnpm = computed<Layout | null>(() => (api.value ? layoutPnpm(props.registry, scenario.value.deps, api.value) : null));

/** Совпало ли посчитанное со снятым на стенде. С `--legacy-peer-deps` съёмки для сверки нет. */
function verdict(layout: Layout | null, run: Run | undefined): 'match' | 'differs' | 'none' {
  if (!layout || !run) return 'none';
  if (run.exit !== 0) return layout.error ? 'match' : 'differs';
  const mine = layout.entries.map(formatEntry).sort();
  const real = [...run.tree].sort();
  return mine.length === real.length && mine.every((line, i) => line === real[i]) ? 'match' : 'differs';
}

const npmVerdict = computed(() =>
  peerMode.value === 'legacy' ? 'none' : verdict(npm.value, props.runs[scenarioId.value]?.npm),
);
const pnpmVerdict = computed(() => verdict(pnpm.value, props.runs[scenarioId.value]?.pnpm));

const sides = computed(() =>
  npm.value && pnpm.value
    ? [
        { key: 'npm', title: 'npm — подъём', layout: npm.value, verdict: npmVerdict.value },
        { key: 'pnpm', title: 'pnpm — изоляция', layout: pnpm.value, verdict: pnpmVerdict.value },
      ]
    : null,
);

const VERDICT_TEXT = {
  match: 'совпадает со снятым на стенде строка в строку',
  differs: 'расходится со снятым на стенде',
  none: 'для этого режима съёмки нет — сверять не с чем',
};

function seen(layout: Layout | null) {
  if (!layout || layout.error) return [];
  return Object.entries(layout.visible)
    .filter(([name]) => name in scenario.value.deps || layout.visible[name] !== null)
    .map(([name, version]) => ({
      name,
      version,
      declared: name in scenario.value.deps,
    }));
}

function short(e: Entry) {
  return e.link !== undefined ? `${e.path} → ${e.link}` : `${e.path}  ${e.version}`;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pm-tree__controls">
        <div class="pm-tree__control">
          <span class="t-label">сценарий</span>
          <SegmentedControl v-model="scenarioId" class="l-pills" label="Сценарий" :options="SCENARIO_OPTIONS" />
        </div>
        <div class="pm-tree__control">
          <span class="t-label">peer-зависимости</span>
          <SegmentedControl v-model="peerMode" class="l-pills" label="Режим peer у npm" :options="PEER_OPTIONS" />
        </div>
      </div>
    </template>

    <div class="pm-tree__body">
      <div class="pm-tree__head">
        <pre class="pm-tree__manifest" data-code>{{ manifestLines.join('\n') }}</pre>
        <Md class="pm-tree__scenario" :text="scenario.note" />
      </div>

      <div v-if="failure" class="pm-tree__state" data-tone="warn">Код не собрался: {{ failure }}</div>
      <div v-else-if="!sides" class="pm-tree__state">
        Раскладка ещё не посчитана — она появится, когда демо оживёт: считает правило, а не заготовка.
      </div>
      <div v-else class="pm-tree__split">
        <section v-for="side in sides" :key="side.key" class="pm-tree__col">
          <h4 class="pm-tree__title">{{ side.title }}</h4>

          <div v-if="side.layout.error" class="pm-tree__state" data-tone="err">
            <span class="pm-tree__code" data-code>{{ side.layout.error.code }}</span>
            {{ side.layout.error.message }}
          </div>
          <ul v-else class="pm-tree__list">
            <li v-for="e in side.layout.entries" :key="e.path" class="pm-tree__entry" :data-link="e.link !== undefined || undefined">
              <span class="pm-tree__path" data-code>{{ short(e) }}</span>
              <span v-for="t in e.tags" :key="t" class="pm-tree__tag" :data-tag="t">{{ TAG_LABEL[t] }}</span>
            </li>
          </ul>

          <div v-for="w in side.layout.warnings" :key="w" class="pm-tree__state" data-tone="warn">{{ w }}</div>

          <div v-if="!side.layout.error" class="pm-tree__seen">
            <span class="t-label">require из приложения</span>
            <span
              v-for="s in seen(side.layout)"
              :key="s.name"
              class="pm-tree__seen-item"
              :data-tone="s.version === null ? 'none' : s.declared ? 'ok' : 'phantom'"
              data-code
            >{{ s.name }}: {{ s.version ?? 'не найден' }}</span>
          </div>

          <span class="pm-tree__verdict" :data-verdict="side.verdict">{{ VERDICT_TEXT[side.verdict] }}</span>
        </section>
      </div>
    </div>

    <template #footer>
      <div class="pm-tree__note">
        Стрелка — симлинк. «Фантом» — лежит наверху, и приложение может его импортировать, хотя
        не объявляло. «Копия» — та же версия на диске не один раз. «Скрытый подъём» — ссылка
        в <code>.pnpm/node_modules</code>: её видят пакеты, но не приложение. Сверка идёт
        с деревьями, снятыми npm 11.19.1 и pnpm 11.0.9 на учебном реестре темы.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.pm-tree__controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pm-tree__control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.pm-tree__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}
.pm-tree__head {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 14px;
  align-items: start;
}
.pm-tree__manifest {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}
.pm-tree__scenario {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.pm-tree__split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 14px;
  align-items: start;
}
.pm-tree__col {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: var(--r2);
  background: var(--surface-2);
  border: 1px solid var(--border);
  min-width: 0;
}
.pm-tree__title {
  margin: 0;
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--ink);
}
.pm-tree__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.pm-tree__entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
}
.pm-tree__path {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
  min-width: 0;
}
.pm-tree__entry[data-link] .pm-tree__path {
  color: var(--text-muted);
}
.pm-tree__tag {
  font-size: var(--fs-3);
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  color: var(--prose);
  background: var(--surface);
  white-space: nowrap;
}
.pm-tree__tag[data-tag='declared'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.pm-tree__tag[data-tag='phantom'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.pm-tree__tag[data-tag='duplicate'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.pm-tree__tag[data-tag='hidden'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}

.pm-tree__seen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
}
.pm-tree__seen-item {
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 2px 8px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
}
.pm-tree__seen-item[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  color: var(--tone-ok-text);
}
.pm-tree__seen-item[data-tone='phantom'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.pm-tree__state {
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--prose);
}
.pm-tree__state[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.pm-tree__state[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.pm-tree__code {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--tone-err-strong);
}

.pm-tree__verdict {
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.pm-tree__verdict[data-verdict='match'] {
  color: var(--tone-ok-text);
}
.pm-tree__verdict[data-verdict='differs'] {
  color: var(--tone-err-text);
}

.pm-tree__note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.pm-tree__note code {
  font-family: var(--mono);
}
</style>
