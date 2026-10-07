<script setup lang="ts">
/**
 * «Дорога поиска»: дерево компонентов с провайдерами на узлах. Читатель выбирает, кто просит,
 * какой токен и с какими флагами, и видит путь, найденный экземпляр или ошибку — в семантике
 * Angular, Vue или React.
 *
 * Считает не компонент, а строки `ANGULAR_DI_CODE`, `VUE_PROVIDE_CODE` и `REACT_CONTEXT_CODE`
 * из темы через `model/run.ts`. Те же строки напечатаны на странице и сверены
 * `tests/unit/dependency-injection.test.ts` с Angular 21, Vue 3.5 и React 19 на этом дереве.
 * Экземпляры живут между запросами, как в настоящем приложении; «новое приложение» их сбрасывает.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { createLab, show, type LabAnswer } from '../model/run';
import type { DemoToken, DiSpec, Flags, Mode, Provider } from '../model/types';

const props = defineProps<{
  spec: DiSpec;
  tokens: DemoToken[];
  defaults: Record<string, unknown>;
  angularCode: string;
  vueCode: string;
  reactCode: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const lab = createLab(props.spec, { angular: props.angularCode, vue: props.vueCode, react: props.reactCode }, props.defaults);

const mode = ref<Mode>('angular');
const modeOptions = [
  { value: 'angular', label: 'Angular' },
  { value: 'vue', label: 'Vue' },
  { value: 'react', label: 'React' },
];

const node = ref('CardA');
const token = ref('Store');
const flags = ref<Required<Flags>>({ optional: false, self: false, skipSelf: false, host: false });
const useFallback = ref(false);
const FLAG_KEYS = ['optional', 'self', 'skipSelf', 'host'] as const;

const tokenOptions = computed(() =>
  props.tokens.filter((tk) => mode.value === 'angular' || tk.plain).map((tk) => ({ value: tk.id, label: tk.id })),
);
const tokenInfo = computed(() => props.tokens.find((tk) => tk.id === token.value));
watch(mode, () => {
  if (!tokenOptions.value.some((o) => o.value === token.value)) token.value = tokenOptions.value[0].value;
});

/** Дерево для показа: глубина каждого компонента в порядке обхода. */
const rows = computed(() => {
  const out: { id: string; depth: number }[] = [];
  const visit = (id: string, depth: number) => {
    out.push({ id, depth });
    props.spec.components.filter((c) => c.parent === id).forEach((c) => visit(c.id, depth + 1));
  };
  props.spec.components.filter((c) => !c.parent).forEach((c) => visit(c.id, 0));
  return out;
});

const tokenOf = (p: Provider) => (typeof p === 'string' ? p : p.provide);
function describe(p: Provider): string {
  if (typeof p === 'string') return p;
  if ('useValue' in p) return `${p.provide} = '${String(p.useValue)}'${p.multi ? ' (multi)' : ''}`;
  return p.provide;
}

/** Что объявлено на узле — словами выбранного фреймворка. */
function nodeProviders(id: string): string[] {
  const c = props.spec.components.find((x) => x.id === id)!;
  const prov = (c.providers ?? []).map(describe);
  const view = (c.viewProviders ?? []).map(describe);
  if (mode.value === 'angular') {
    return [...(prov.length ? [`providers: ${prov.join(', ')}`] : []), ...(view.length ? [`viewProviders: ${view.join(', ')}`] : [])];
  }
  const all = [...(c.providers ?? []), ...(c.viewProviders ?? [])];
  const keys = [...new Set(all.map(tokenOf))];
  return keys.map((k) => (mode.value === 'vue' ? `provide(${k})` : `<${k} value>`));
}

const envTitle = computed(() =>
  mode.value === 'angular' ? 'EnvironmentInjector root' : mode.value === 'vue' ? 'app.provide' : 'провайдеры над <App />',
);
const envProviders = computed(() => {
  const env = props.spec.env[0].providers;
  const roots = Object.entries(props.spec.classes).filter(([, c]) => c.providedIn === 'root').map(([k]) => k);
  const plainRoots = roots.filter((r) => props.tokens.some((tk) => tk.id === r && tk.plain));
  const vals = [...new Set(env.map(tokenOf))].map((k) => {
    const items = env.filter((p) => tokenOf(p) === k).map((p) => (typeof p === 'string' ? p : String(p.useValue)));
    return `${k} = ${items.length > 1 ? `[${items.join(', ')}]` : `'${items[0]}'`}`;
  });
  if (mode.value === 'angular') return [...vals, `providedIn: 'root' — ${roots.join(', ')}`];
  return [...vals, ...plainRoots];
});
const ENV_ID: Record<Mode, string[]> = {
  angular: ['root', 'NullInjector'],
  vue: ['app'],
  react: ['над корнем', 'createContext'],
};

const answer = ref<LabAnswer>(ask());

function ask(): LabAnswer {
  if (mode.value === 'angular') return lab.ask('angular', node.value, token.value, { flags: { ...flags.value } });
  if (mode.value === 'vue') return lab.ask('vue', node.value, token.value, useFallback.value ? { fallback: 'запасное' } : {});
  return lab.ask('react', node.value, token.value);
}
function again() {
  answer.value = ask();
}
function fresh() {
  lab.reset();
  answer.value = ask();
}
watch([mode, node, token, flags, useFallback], again, { deep: true });

function toggle(k: (typeof FLAG_KEYS)[number]) {
  flags.value = { ...flags.value, [k]: !flags.value[k] };
}

/** Состояние узла на главной дороге (глубина 0) — для подсветки дерева. */
const status = computed(() => {
  const map = new Map<string, { n: number; step: string }>();
  const main = answer.value.trace.filter((s) => s.depth === 0);
  main.forEach((s, i) => map.set(s.at, { n: i + 1, step: s.step }));
  // Запись нашлась, но создать значение не вышло (цикл в зависимостях) — узел красный.
  const last = main.at(-1);
  if (answer.value.error && last && (last.step === 'create' || last.step === 'cycle')) map.set(last.at, { n: main.length, step: 'cycle' });
  return map;
});

const STEP_TEXT: Record<Mode, Record<string, string>> = {
  angular: {
    skip: 'пропущен: `skipSelf`',
    miss: 'записи нет — дальше',
    'host-miss': 'хост: смотрели только `viewProviders` — стоп',
    create: 'найдено — экземпляр создаётся сейчас',
    hit: 'найдено — значение уже есть',
    cycle: 'запись помечена «создаётся» — цикл',
    null: 'не найдено — `null` из-за `optional`',
  },
  vue: {
    hit: 'своё свойство в объекте `provides` — найдено',
    miss: 'своего нет — в прототип',
  },
  react: {
    hit: 'ближайший провайдер — найдено',
    miss: 'провайдера нет — выше',
    default: 'провайдеров нет — значение из `createContext`',
  },
};

function whereLabel(at: string): string {
  if (mode.value === 'vue') return at === 'app' ? 'app.provide' : `provides ${at}`;
  return at;
}

const steps = computed(() =>
  answer.value.trace.map((s) => ({
    depth: s.depth,
    text: `**${whereLabel(s.at)}**${s.depth > 0 ? ` · \`${s.token}\`` : ''} — ${STEP_TEXT[mode.value][s.step] ?? s.step}`,
  })),
);

function fmt(v: unknown): string {
  const s = show(v);
  if (s === undefined) return 'undefined';
  if (s === null) return 'null';
  if (Array.isArray(s)) return `[${s.map((x) => `'${String(x)}'`).join(', ')}]`;
  if (typeof s === 'string' && !/#\d+$/.test(s)) return `'${s}'`;
  return String(s);
}

const call = computed(() => {
  if (mode.value === 'angular') {
    const on = FLAG_KEYS.filter((k) => flags.value[k]);
    const opts = on.length ? `, { ${on.map((k) => `${k}: true`).join(', ')} }` : '';
    return `\`${node.value}\`: \`inject(${token.value}${opts})\``;
  }
  if (mode.value === 'vue') return `\`${node.value}\`: \`inject(${token.value}${useFallback.value ? ", 'запасное'" : ''})\``;
  return `\`${node.value}\`: \`useContext(${token.value})\``;
});

const verdict = computed(() => {
  const a = answer.value;
  if (a.error) return { tone: 'err', text: '', raw: a.error.message };
  if (a.warn) return { tone: 'warn', text: `\`undefined\` и предупреждение \`${a.warn}\`` };
  if (a.value === null && mode.value === 'angular') return { tone: 'warn', text: '`null`: провайдер не найден, ошибку погасил `optional`' };
  if (a.fallback) return { tone: 'warn', text: "`'запасное'` — ключа нет во всей цепочке, сработал второй аргумент" };
  const deps = (a.value as { deps?: unknown[] } | null)?.deps;
  const depText = deps && deps.length ? `, внутри — ${deps.map(fmt).join(', ')}` : '';
  const found = a.trace.filter((s) => s.depth === 0).at(-1);
  const where = found ? ` — ${mode.value === 'angular' ? 'инжектор' : 'значение'} ${whereLabel(found.at)}` : '';
  return { tone: 'ok', text: `\`${fmt(a.value)}\`${where}${depText}` };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Семантика" :options="modeOptions" />
    </template>

    <div class="dl-body">
      <div class="dl-split">
        <div class="dl-tree" role="group" aria-label="Дерево компонентов: кто просит">
          <div class="dl-row dl-row--env" :data-status="ENV_ID[mode].map((k) => status.get(k)?.step).find(Boolean) ?? 'none'">
            <span class="dl-name">{{ envTitle }}</span>
            <span v-for="p in envProviders" :key="p" class="dl-prov">{{ p }}</span>
            <span
              v-for="k in ENV_ID[mode].filter((x) => status.has(x))"
              :key="k"
              class="dl-badge"
            >{{ status.get(k)!.n }}<template v-if="k !== ENV_ID[mode][0]"> · {{ k }}</template></span>
          </div>
          <button
            v-for="r in rows"
            :key="r.id"
            type="button"
            class="dl-row"
            :style="{ '--dl-depth': r.depth }"
            :aria-pressed="r.id === node"
            :data-status="status.get(r.id)?.step ?? 'none'"
            @click="node = r.id"
          >
            <span class="dl-name">{{ r.id }}</span>
            <span v-for="p in nodeProviders(r.id)" :key="p" class="dl-prov">{{ p }}</span>
            <span v-if="status.has(r.id)" class="dl-badge">{{ status.get(r.id)!.n }}</span>
          </button>
        </div>

        <div class="dl-side">
          <div class="dl-field">
            <span class="dl-label">что просим</span>
            <SegmentedControl v-model="token" class="l-pills" label="Токен" :options="tokenOptions" />
            <Md v-if="tokenInfo" class="dl-note" :text="mode === 'angular' ? tokenInfo.note : tokenInfo.plainNote ?? tokenInfo.note" />
          </div>

          <div v-if="mode === 'angular'" class="dl-field">
            <span class="dl-label">флаги inject</span>
            <div class="dl-flags">
              <Button
                v-for="k in FLAG_KEYS"
                :key="k"
                :variant="flags[k] ? 'primary' : 'secondary'"
                :aria-pressed="flags[k]"
                @click="toggle(k)"
              >
{{ k }}
</Button>
            </div>
          </div>
          <div v-else-if="mode === 'vue'" class="dl-field">
            <span class="dl-label">второй аргумент inject</span>
            <div class="dl-flags">
              <Button :variant="useFallback ? 'primary' : 'secondary'" :aria-pressed="useFallback" @click="useFallback = !useFallback">'запасное'</Button>
            </div>
          </div>

          <div class="dl-result">
            <Md class="dl-call" :text="call" />
            <ol class="dl-steps">
              <li v-for="(s, i) in steps" :key="i" :style="{ '--dl-depth': s.depth }">
                <Md :text="s.text" />
              </li>
            </ol>
            <code v-if="'raw' in verdict" class="dl-verdict dl-verdict--raw" data-tone="err">{{ verdict.raw }}</code>
            <Md v-else class="dl-verdict" :data-tone="verdict.tone" :text="verdict.text" />
          </div>

          <div class="dl-flags">
            <Button variant="secondary" @click="again">спросить ещё раз</Button>
            <Button variant="secondary" @click="fresh">новое приложение</Button>
          </div>
        </div>
      </div>

      <Md class="dl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.dl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.dl-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 820px) {
  .dl-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.dl-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dl-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-left: calc(var(--dl-depth, 0) * 18px);
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r2);
  background: var(--surface);
  font: inherit;
  font-size: var(--fs-3);
  color: var(--prose);
  text-align: left;
  cursor: pointer;
}
.dl-row--env {
  cursor: default;
  background: var(--surface-2);
}
.dl-row[aria-pressed='true'] {
  box-shadow: inset 0 0 0 2px var(--tone-info-line);
}
.dl-row[data-status='miss'],
.dl-row[data-status='skip'],
.dl-row[data-status='host-miss'] {
  background: var(--surface-3);
}
.dl-row[data-status='create'],
.dl-row[data-status='hit'],
.dl-row[data-status='default'] {
  background: var(--tone-ok-bg);
  border-color: var(--tone-ok-line);
}
.dl-row[data-status='cycle'] {
  background: var(--tone-err-bg);
  border-color: var(--tone-err-line);
}
.dl-name {
  font-family: var(--mono);
  font-weight: 600;
  color: var(--ink);
}
.dl-prov {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.dl-badge {
  margin-left: auto;
  padding: 0 7px;
  border-radius: var(--r-full);
  background: var(--tone-info-chip);
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-info-text);
}

.dl-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.dl-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.dl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.dl-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.dl-note,
.dl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}

.dl-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  min-width: 0;
}
.dl-call {
  font-size: var(--fs-3);
  color: var(--ink);
}
.dl-steps {
  margin: 0;
  padding-left: 1.4em;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--prose);
}
.dl-steps li {
  margin-left: calc(var(--dl-depth, 0) * 16px);
  overflow-wrap: anywhere;
}
.dl-verdict {
  padding: 8px 10px;
  border-radius: var(--r2);
  font-size: var(--fs-3);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.dl-verdict--raw {
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.dl-verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.dl-verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.dl-verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.dl-note :deep(code),
.dl-caption :deep(code),
.dl-call :deep(code),
.dl-steps :deep(code),
.dl-verdict :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
