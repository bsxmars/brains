<script setup lang="ts">
/**
 * Host и два remote с общей зависимостью `react`: версии, флаги `shared`, состояние сети —
 * и что из этого вышло: сколько копий исполнено, кому какая досталась, что сказано в консоль.
 *
 * Считает **не** компонент и не таблица, а строка `FEDERATION_CODE` из темы: она приходит пропом
 * `code`, собирается `compileFederation` и прогоняется `simulate` на каждое изменение. Та же
 * строка напечатана в теме по частям и исполняется `tests/unit/module-federation.test.ts`.
 *
 * Сборка и прогон — в `onMounted` и по изменению: до гидратации остров честно говорит,
 * что считать пока нечем. Прогон асинхронный (у «завис» — настоящий таймаут), поэтому
 * устаревший ответ отбрасывается по номеру прогона.
 */
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { REMOTES, compileFederation, simulate } from '../model/federation';
import type {
  Federation,
  MfAppName,
  MfPreset,
  MfRemoteName,
  MfRun,
  MfState,
  MfStatus,
  MfWorld,
} from '../model/types';

const props = defineProps<{
  code: string;
  versions: string[];
  presets: MfPreset[];
  initial: MfState;
  timeoutMs: number;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const clone = (s: MfState): MfState => ({
  ...s,
  versions: { ...s.versions },
  status: { ...s.status },
});

const state = reactive<MfState>(clone(props.initial));
const fed = shallowRef<Federation | null>(null);
const failure = ref('');
const outcome = shallowRef<{ world: MfWorld; run: MfRun } | null>(null);
const pending = ref(false);
let ticket = 0;

async function rerun() {
  const f = fed.value;
  if (!f) return;
  const mine = ++ticket;
  pending.value = true;
  try {
    const res = await simulate(f, clone(state), props.timeoutMs);
    if (mine === ticket) outcome.value = res;
  } catch (error) {
    if (mine === ticket) failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (mine === ticket) pending.value = false;
  }
}

onMounted(() => {
  try {
    fed.value = compileFederation(props.code);
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
    return;
  }
  void rerun();
});

watch(state, () => void rerun(), { deep: true });

function usePreset(p: MfPreset) {
  Object.assign(state, clone(p.state));
}
const presetActive = (p: MfPreset) => JSON.stringify(p.state) === JSON.stringify(state);

const APPS: MfAppName[] = ['host', ...REMOTES];
const versionOptions = computed(() => props.versions.map((v) => ({ value: v, label: v })));
const statusOptions: { value: MfStatus; label: string }[] = [
  { value: 'up', label: 'жив' },
  { value: 'down', label: 'упал' },
  { value: 'hang', label: 'завис' },
];
const onOff = [
  { value: 'on', label: 'да' },
  { value: 'off', label: 'нет' },
];
const strictOptions = [
  { value: 'auto', label: 'умолчание' },
  { value: 'on', label: 'true' },
  { value: 'off', label: 'false' },
];

const singletonModel = computed({
  get: () => (state.singleton ? 'on' : 'off'),
  set: (v: string) => {
    state.singleton = v === 'on';
  },
});
const eagerModel = computed({
  get: () => (state.eager ? 'on' : 'off'),
  set: (v: string) => {
    state.eager = v === 'on';
  },
});
const strictModel = computed({
  get: () => state.strict,
  set: (v: string) => {
    state.strict = v as MfState['strict'];
  },
});

/** Модели для переключателей версий и сети: одна на сборку. */
const versionModel = (name: MfAppName) =>
  computed({
    get: () => state.versions[name],
    set: (v: string) => {
      state.versions[name] = v;
    },
  });
const statusModel = (name: MfRemoteName) =>
  computed({
    get: () => state.status[name],
    set: (v: string) => {
      state.status[name] = v as MfStatus;
    },
  });
const versionModels = Object.fromEntries(APPS.map((n) => [n, versionModel(n)])) as Record<
  MfAppName,
  ReturnType<typeof versionModel>
>;
const statusModels = Object.fromEntries(REMOTES.map((n) => [n, statusModel(n)])) as Record<
  MfRemoteName,
  ReturnType<typeof statusModel>
>;

const copyLabel = (c: { version: string; owner: string }) => `${c.version} из сборки ${c.owner}`;

interface Card {
  name: MfAppName;
  role: string;
  tone: 'ok' | 'warn' | 'err' | 'idle';
  got: string;
  verdict: string;
}

const cards = computed<Card[]>(() => {
  const o = outcome.value;
  if (!o) return [];
  const { run, world } = o;
  const warned = (who: string) => world.log.some((l) => l.who === who && l.level === 'warn');
  const hostCard: Card = run.host
    ? {
        name: 'host',
        role: 'host',
        tone: warned('host') ? 'warn' : 'ok',
        got: copyLabel(run.host),
        verdict: warned('host') ? 'работает на версии вне своего диапазона' : 'работает',
      }
    : { name: 'host', role: 'host', tone: 'err', got: '—', verdict: 'упал: страница пуста' };
  const remoteCards = REMOTES.map((name): Card => {
    const r = run.results[name];
    if (!run.host) return { name, role: 'remote', tone: 'idle', got: '—', verdict: 'не дошли: host упал раньше' };
    if (!r) return { name, role: 'remote', tone: 'idle', got: '—', verdict: '—' };
    if (r.fallback) {
      return {
        name,
        role: 'remote',
        tone: 'err',
        got: '—',
        verdict: r.error ? 'заглушка: виджет бросил при загрузке или рендере' : 'заглушка: контейнер не загрузился',
      };
    }
    return {
      name,
      role: 'remote',
      tone: warned(name) ? 'warn' : 'ok',
      got: r.lib ? copyLabel(r.lib) : '—',
      verdict: `отрисован host: «${r.html}»`,
    };
  });
  return [hostCard, ...remoteCards];
});

const scopeRows = computed(() => {
  const o = outcome.value;
  if (!o) return [];
  const versions = o.run.scope.react ?? {};
  return Object.keys(versions)
    .sort((a, b) => fed.value!.compare(a, b))
    .map((v) => ({ v, ...versions[v] }));
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="mf-controls">
        <div class="mf-presets">
          <button
            v-for="p in presets"
            :key="p.label"
            type="button"
            class="mf-preset"
            :aria-pressed="presetActive(p)"
            @click="usePreset(p)"
          >
            {{ p.label }}
          </button>
        </div>

        <div class="mf-grid">
          <div v-for="name in APPS" :key="name" class="mf-field">
            <span class="t-label">{{ name }}: версия react</span>
            <SegmentedControl
              v-model="versionModels[name].value"
              class="l-pills"
              :label="`Версия react в сборке ${name}`"
              :options="versionOptions"
            />
          </div>
          <div v-for="name in REMOTES" :key="`s-${name}`" class="mf-field">
            <span class="t-label">{{ name }}: remoteEntry.js</span>
            <SegmentedControl
              v-model="statusModels[name].value"
              class="l-pills"
              :label="`Сеть до ${name}`"
              :options="statusOptions"
            />
          </div>
          <div class="mf-field">
            <span class="t-label">singleton</span>
            <SegmentedControl v-model="singletonModel" class="l-pills" label="singleton" :options="onOff" />
          </div>
          <div class="mf-field">
            <span class="t-label">strictVersion</span>
            <SegmentedControl v-model="strictModel" class="l-pills" label="strictVersion" :options="strictOptions" />
          </div>
          <div class="mf-field">
            <span class="t-label">eager у host</span>
            <SegmentedControl v-model="eagerModel" class="l-pills" label="eager у host" :options="onOff" />
          </div>
        </div>
      </div>
    </template>

    <div class="mf-body">
      <div v-if="failure" class="mf-verdict" data-tone="warn">Код не собрался: {{ failure }}</div>
      <div v-else-if="!outcome" class="mf-verdict" data-tone="idle">
        Федерация ещё не загружена — ответ появится, когда демо оживёт: считает код выше, а не заготовка.
      </div>
      <template v-else>
        <div v-if="pending" class="mf-pending" aria-live="polite">
          ждём remoteEntry.js — не дольше {{ timeoutMs }} мс…
        </div>

        <ul class="mf-apps">
          <li v-for="c in cards" :key="c.name" class="mf-app" :data-tone="c.tone">
            <span class="mf-app__name">{{ c.name }}</span>
            <span class="mf-app__req">
              {{ state.versions[c.name] }}, требует ^{{ state.versions[c.name] }}
            </span>
            <span class="mf-app__got"><span class="t-label">взял</span> {{ c.got }}</span>
            <span class="mf-app__verdict">{{ c.verdict }}</span>
          </li>
        </ul>

        <div class="mf-split">
          <div class="mf-pane">
            <span class="t-label">исполнено копий react</span>
            <span class="mf-count" :data-tone="outcome.world.copies.length > 1 ? 'err' : 'ok'">
              {{ outcome.world.copies.length }}
            </span>
            <ul class="mf-list">
              <li v-for="c in outcome.world.copies" :key="c.owner" class="mf-mono">{{ copyLabel(c) }}</li>
            </ul>
          </div>

          <div class="mf-pane">
            <span class="t-label">shareScope.react после прогона</span>
            <table class="mf-table">
              <thead>
                <tr><th>версия</th><th>from</th><th>eager</th><th>loaded</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in scopeRows" :key="r.v">
                  <td class="mf-mono">{{ r.v }}</td>
                  <td class="mf-mono">{{ r.from }}</td>
                  <td class="mf-mono">{{ r.eager }}</td>
                  <td class="mf-mono" :data-on="r.loaded || undefined">{{ r.loaded }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="mf-console">
          <span class="t-label">консоль</span>
          <p v-if="!outcome.world.log.length" class="mf-console__empty">пусто</p>
          <ul v-else class="mf-list">
            <li v-for="(l, i) in outcome.world.log" :key="i" class="mf-log" :data-level="l.level">
              <span class="mf-log__who">{{ l.level }} · {{ l.who }}</span>
              <span class="mf-mono">{{ l.text }}</span>
            </li>
          </ul>
        </div>
      </template>
    </div>

    <template #footer>
      <Md class="mf-note" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.mf-controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.mf-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mf-preset {
  font: inherit;
  font-size: var(--fs-3);
  line-height: 1.4;
  color: var(--prose);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  padding: 6px 10px;
  cursor: pointer;
  text-align: start;
}
.mf-preset:hover {
  border-color: var(--tone-info-line);
}
.mf-preset[aria-pressed='true'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--ink);
}
.mf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px 18px;
}
.mf-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mf-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}
.mf-pending {
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.mf-apps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.mf-app {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  min-width: 0;
}
.mf-app[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.mf-app[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mf-app[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mf-app__name {
  font-family: var(--mono);
  font-size: var(--fs-5);
  font-weight: 600;
  color: var(--ink);
}
.mf-app__req {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.mf-app__got {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.mf-app__verdict {
  font-size: var(--fs-3);
  line-height: 1.45;
  color: var(--prose);
}

.mf-split {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
}
.mf-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.mf-count {
  font-family: var(--mono);
  font-size: var(--fs-8);
  font-weight: 600;
  line-height: 1;
  color: var(--tone-ok-strong);
}
.mf-count[data-tone='err'] {
  color: var(--tone-err-strong);
}
.mf-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.mf-mono {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.mf-table {
  border-collapse: collapse;
  width: 100%;
}
.mf-table th,
.mf-table td {
  text-align: start;
  padding: 6px 8px;
  border-bottom: 1px solid var(--divider);
}
.mf-table th {
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--text-muted);
}
.mf-table td[data-on] {
  color: var(--tone-ok-strong);
  font-weight: 600;
}

.mf-console {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mf-console__empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.mf-log {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  border-radius: var(--r1);
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mf-log[data-level='error'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.mf-log__who {
  font-size: var(--fs-2);
  font-weight: 600;
  color: var(--tone-warn-text);
}
.mf-log[data-level='error'] .mf-log__who {
  color: var(--tone-err-text);
}

.mf-verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: var(--fs-4);
  color: var(--prose);
}
.mf-verdict[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.mf-note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}

@media (max-width: 640px) {
  .mf-split {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
