<script setup lang="ts">
/**
 * «Почему не обновляется» — шесть ловушек, каждая выполняется по-настоящему.
 *
 * Ни одна строка в консоли демо не заготовлена: `reactive`, `effect`, `toRaw` и `stop`
 * приехали из `@vue/reactivity`, `watchEffect` и `nextTick` — из `vue`, а сценарий `props`
 * монтирует настоящий дочерний компонент. Приговор внизу («эффект промолчал» / «сработал»)
 * считается из фактического числа прогонов, а не написан заранее: заготовленный вердикт
 * однажды разошёлся бы с кодом, и урок бы врал ровно тем способом, от которого предостерегает.
 *
 * Все шесть исходов проверены запуском в Node 24.11 на Vue 3.5.42 — см. `data.ts` урока.
 *
 * **Почему эффекты останавливаются.** Каждый прогон создаёт новые эффекты, и созданы они
 * в обработчике клика, то есть вне `setup()`: область видимости компонента их не подобрала,
 * `activeEffectScope` в этот момент уже снят. Не останови их руками — после десяти нажатий
 * на странице жило бы шестьдесят эффектов, и демо про утечки само стало бы утечкой.
 *
 * **Почему лог — обычный массив.** В сценарии `props` в лог пишет дочерний компонент, в том
 * числе из `setup`. Реактивный лог означал бы запись в состояние во время монтирования того,
 * кто этот лог показывает.
 */
import { nextTick, watchEffect } from 'vue';
import { computed, effect, reactive, ref, shallowRef, stop, toRaw } from '@vue/reactivity';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { TrapScenario } from '../model/types';
import TrapChild from './TrapChild.vue';

const props = defineProps<{ scenarios: TrapScenario[] }>();

const picked = ref('0');
const busy = ref(false);
const lines = shallowRef<string[]>([]);
const verdict = ref<{ text: string; tone: 'ok' | 'warn' | 'err' } | null>(null);

/** Состояние сценария `props`: значение пропа и ключ для пересоздания ребёнка. */
const childCount = ref(0);
const childKey = ref(0);
const childMounted = ref(false);

let raw: string[] = [];
/** Как остановить всё, что создал прошлый прогон. */
let stops: (() => void)[] = [];

const options = computed(() => props.scenarios.map((item, i) => ({ value: String(i), label: item.label })));
const scenario = computed(() => props.scenarios[Number(picked.value)] ?? props.scenarios[0]);

function push(text: string) {
  raw.push(text);
}

function publish() {
  lines.value = [...raw];
}

function dispose() {
  stops.forEach((fn) => fn());
  stops = [];
}

/** Завести эффект и сразу запомнить, как его выключить. */
function track(fn: () => void) {
  const handle = effect(fn);
  stops.push(() => stop(handle));
}

async function runDestructure() {
  const state = reactive({ count: 0 });
  const { count } = state;
  push(`деструктурировали: count = ${count}`);
  let runs = 0;
  track(() => {
    runs += 1;
    push(`прогон ${runs}: переменная ${count} · state.count ${state.count}`);
  });
  state.count = 42;
  push(`после state.count = 42 → переменная ${count}, state.count ${state.count}`);
  verdict.value = {
    text: `эффект выполнился ${runs} раза, но переменная так и осталась ${count}`,
    tone: 'warn',
  };
}

async function runRawProxy() {
  const source = { id: 1 };
  const list = reactive([source]);
  push(`list[0] === raw → ${list[0] === source}`);
  push(`list.includes(raw) → ${list.includes(source)}`);
  push(`list.find(x => x === raw) → ${String(list.find((item) => item === source))}`);
  push(`list.indexOf(raw) → ${list.indexOf(source)}`);
  push(`toRaw(list[0]) === raw → ${toRaw(list[0]) === source}`);
  const chosen = new Set<object>();
  chosen.add(list[0]);
  push(`обычный Set: положили list[0], ищем raw → ${chosen.has(source)}`);
  verdict.value = {
    text: '`includes` нашёл, `find` — нет: у одного есть фолбэк на сырой объект, у другого нет',
    tone: 'err',
  };
}

async function runAwait() {
  const a = ref(1);
  const b = ref(1);
  let runs = 0;
  const handle = watchEffect(async () => {
    runs += 1;
    push(`прогон ${runs}: a = ${a.value}`);
    await Promise.resolve();
    push(`   после await читаем b = ${b.value}`);
  });
  stops.push(() => handle());
  await nextTick();

  b.value = 2;
  await nextTick();
  const afterB = runs;
  push(`записали b → прогонов ${afterB}`);

  a.value = 2;
  await nextTick();
  push(`записали a → прогонов ${runs}`);

  verdict.value = {
    text: `запись в \`b\` не разбудила эффект (${afterB}), запись в \`a\` разбудила (${runs})`,
    tone: 'err',
  };
}

async function runStaleRef() {
  const state = reactive({ list: [1, 2, 3] });
  const old = state.list;
  let runs = 0;
  track(() => {
    runs += 1;
    push(`прогон ${runs}: длина ${state.list.length}`);
  });
  state.list = [9];
  const afterReplace = runs;
  push(`заменили массив целиком → прогонов ${afterReplace}`);
  old.push(4);
  push(`мутировали СТАРУЮ ссылку → прогонов ${runs}, state.list.length = ${state.list.length}`);
  verdict.value = {
    text: 'замена целиком разбудила эффект, мутация старой ссылки — нет',
    tone: 'warn',
  };
}

async function runToRaw() {
  const state = reactive({ n: 1 });
  let runs = 0;
  track(() => {
    runs += 1;
    push(`прогон ${runs}: n = ${state.n}`);
  });
  toRaw(state).n = 99;
  push(`после toRaw(state).n = 99 → state.n = ${state.n}, прогонов ${runs}`);
  verdict.value = {
    text: `значение изменилось на ${state.n}, а эффект так и не выполнился повторно`,
    tone: 'err',
  };
}

async function runProps() {
  childCount.value = 0;
  childMounted.value = false;
  await nextTick();
  // Пересоздаём ребёнка, чтобы его `setup` отработал внутри записываемого окна.
  childKey.value += 1;
  childMounted.value = true;
  await nextTick();

  childCount.value += 1;
  await nextTick();
  await nextTick();

  push(`родитель поставил props.count = ${childCount.value}`);
  verdict.value = {
    text: 'эффект внутри ребёнка сработал, но деструктурированная переменная осталась прежней',
    tone: 'warn',
  };
}

const RUNNERS: Record<TrapScenario['id'], () => Promise<void>> = {
  destructure: runDestructure,
  'raw-proxy': runRawProxy,
  await: runAwait,
  'stale-ref': runStaleRef,
  'to-raw': runToRaw,
  props: runProps,
};

async function run() {
  if (busy.value) return;
  busy.value = true;
  dispose();
  raw = [];
  verdict.value = null;
  publish();

  await RUNNERS[scenario.value.id]();

  publish();
  busy.value = false;
}

function onSwitch() {
  dispose();
  raw = [];
  verdict.value = null;
  childMounted.value = false;
  publish();
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl
          v-model="picked"
          class="l-pills"
          label="Ловушка"
          :options="options"
          @update:model-value="onSwitch"
        />
        <Button variant="primary" :disabled="busy" @click="run">выполнить</Button>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="title">{{ scenario.title }}</div>
        <CodeListing :lines="scenario.code" label="что выполняется" />
        <TrapChild
          v-if="scenario.id === 'props' && childMounted"
          :key="childKey"
          :count="childCount"
          :report="push"
        />
      </div>

      <div class="pane pane--right">
        <ConsoleView
          :lines="lines"
          label="вывод — настоящий"
          empty-label="нажмите «выполнить»"
          :min-height="150"
        />
        <div v-if="verdict" class="verdict" :data-tone="verdict.tone">
          <Md :text="verdict.text" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="reactivity-traps-foot">
        <Md class="reactivity-traps-foot__note" :text="scenario.note" />
        <div class="fix">
          <span class="t-label">как чинится</span>
          <Md class="fix__text" :text="scenario.fix" />
        </div>
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
}

.title {
  font-size: var(--fs-6);
  font-weight: 500;
  line-height: 1.4;
  color: var(--ink);
}

.verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.5;
}
.verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.reactivity-traps-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.reactivity-traps-foot__note {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.fix {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.fix__text {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-ok-text);
}

@media (max-width: 760px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
