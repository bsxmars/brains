<script setup lang="ts">
/**
 * Flame graph по выборочному профилю выделений — сворачивается в браузере читателя.
 *
 * Считает не компонент, а учебный код `FOLD_CODE` из `data.ts`: его собирает `loadFold`
 * (`new Function`), и тот же модуль импортирует `tests/unit/continuous-profiling.test.ts`.
 * Поэтому ширины на экране — ровно то, что даёт напечатанный в теме код, а не пересказ.
 *
 * Профили — литералы, снятые на стенде темы (`STAND_ALL`, `STAND_LIVE`). Снимать профиль
 * прямо в браузере здесь нечем: выборочный профилировщик кучи доступен странице только
 * через протокол отладчика.
 *
 * ⚠️ Сворачивание — по кнопке, а не в `setup`: остров гидратируется при прокрутке, и работа,
 * которую читатель не просил, не должна случаться сама. До нажатия демо честно пустое.
 *
 * ⚠️ Классы — с префиксом `pp-`: у `.vue`-острова скоуп свой, и голые `.bar`/`.row`
 * уже заняты общими компонентами и полосой навигации.
 */
import { computed, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import { expandProfile, fmtBytes, fmtShare, loadFold, shortName } from '../model/fold';
import type { FlameMetric, FlameRect, FoldApi, FoldNode, StandProfile } from '../model/types';

const props = defineProps<{
  /** Учебный код сворачивания — строка `FOLD_CODE`. */
  code: string;
  /** Профиль всех выделений за окно. */
  all: StandProfile;
  /** Профиль того, что дожило до конца записи. */
  live: StandProfile;
}>();

const api = shallowRef<FoldApi | null>(null);
/** Значения переключателей — строки: так их отдаёт `SegmentedControl`. */
const metricPick = ref('bytes');
const modePick = ref('all');
const metric = computed<FlameMetric>(() => (metricPick.value === 'samples' ? 'samples' : 'bytes'));
/** Путь от корня до кадра, растянутого на всю ширину. Пустой — корень. */
const zoom = ref<string[]>([]);
const query = ref('');
/** Кадр, по которому щёлкнули последним, — узел, а не имя: имена в разных ветках повторяются. */
const picked = shallowRef<FoldNode | null>(null);

const metricOptions = [
  { value: 'bytes', label: 'байты (оценка)' },
  { value: 'samples', label: 'сэмплы (штуки)' },
];
const modeOptions = [
  { value: 'all', label: 'все выделения' },
  { value: 'live', label: 'только живое' },
];

function build() {
  api.value = loadFold(props.code);
  zoom.value = [];
  picked.value = null;
}

const profile = computed(() => (modePick.value === 'live' ? props.live : props.all));

/** Дерево целиком — от корня «все». Пересчитывается при смене метрики или профиля. */
const root = computed<FoldNode | null>(() =>
  api.value ? api.value.fold(expandProfile(profile.value), metric.value) : null,
);

/** Кадр, растянутый на всю ширину. Если путь больше не существует (сменили профиль), — корень. */
const focus = computed<FoldNode | null>(() => {
  let node = root.value;
  for (const name of zoom.value) {
    const next = node?.children.get(name);
    if (!next) return root.value;
    node = next;
  }
  return node;
});

const rects = computed<FlameRect[]>(() => (api.value && focus.value ? api.value.layout(focus.value) : []));
const depth = computed(() => rects.value.reduce((d, r) => Math.max(d, r.depth), 0) + 1);

const share = computed(() =>
  api.value && root.value && query.value.trim() ? api.value.matchShare(root.value, query.value) : null,
);

const unit = computed(() => (metric.value === 'bytes' ? 'байт' : 'сэмплов'));
const fmtValue = (v: number) => (metric.value === 'bytes' ? fmtBytes(v) : `${v} шт.`);

function kind(name: string): 'root' | 'stand' | 'builtin' | 'node' {
  if (name === 'все') return 'root';
  if (name.includes('stand.mjs')) return 'stand';
  if (!name.includes(' ')) return 'builtin';
  return 'node';
}

function matches(name: string): boolean {
  const q = query.value.trim().toLowerCase();
  return Boolean(q) && name !== 'все' && name.toLowerCase().includes(q);
}

/** Щелчок по кадру: растянуть его. Щелчок по корню раскладки — подняться на уровень выше. */
function onRect(rect: FlameRect) {
  picked.value = rect.node;
  if (rect.depth === 0) {
    zoom.value = zoom.value.slice(0, -1);
    return;
  }
  // Путь до кадра: путь до фокуса плюс имена от фокуса до кадра.
  const trail: string[] = [];
  const find = (node: FoldNode, target: FoldNode): boolean => {
    if (node === target) return true;
    for (const child of node.children.values()) {
      trail.push(child.name);
      if (find(child, target)) return true;
      trail.pop();
    }
    return false;
  };
  if (focus.value && find(focus.value, rect.node)) zoom.value = [...zoom.value, ...trail];
}

const pickedRect = computed(() => rects.value.find((r) => r.node === picked.value) ?? null);

const summary = computed(() => {
  const p = profile.value;
  const r = root.value;
  if (!r) return '';
  return `${p.rawSamples} сэмплов · интервал ${p.interval / 1024} КБ · ${p.requests.toLocaleString('ru-RU')} запросов · в корне ${fmtValue(r.total)}`;
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="pp-bar">
        <Button @click="build()">{{ api ? 'свернуть заново' : 'свернуть профиль' }}</Button>
        <SegmentedControl v-model="modePick" class="l-pills" label="Профиль" :options="modeOptions" />
        <SegmentedControl v-model="metricPick" class="l-pills" label="Значение" :options="metricOptions" />
      </div>
    </template>

    <div class="pp-body">
      <p v-if="!api" class="pp-idle">
        Профиль ещё не свёрнут. Нажмите «свернуть профиль» — код сворачивания из раздела выше
        выполнится в вашем браузере на сэмплах, снятых со стенда.
      </p>

      <template v-else-if="root">
        <div class="pp-meta">{{ summary }}</div>

        <div class="pp-search">
          <label class="pp-search__label" for="pp-query">найти функцию</label>
          <input
            id="pp-query"
            v-model="query"
            class="pp-input"
            type="search"
            spellcheck="false"
            autocomplete="off"
            placeholder="renderCatalog, login, join…"
          />
          <span v-if="share !== null" class="pp-search__share">
            под совпавшими кадрами — {{ fmtShare(share, 1) }} всех {{ unit }}
          </span>
        </div>

        <nav class="pp-crumbs" aria-label="Путь к растянутому кадру">
          <button type="button" class="pp-crumb" :disabled="zoom.length === 0" @click="zoom = []">к корню</button>
          <template v-for="(name, i) in zoom" :key="`${i}-${name}`">
            <span class="pp-crumb__sep">›</span>
            <button type="button" class="pp-crumb" @click="zoom = zoom.slice(0, i + 1)">{{ shortName(name) }}</button>
          </template>
        </nav>

        <div class="pp-scroll">
          <div class="pp-flame" :style="`height:${depth * 24}px`">
            <button
              v-for="(rect, i) in rects"
              :key="`${rect.depth}-${i}-${rect.name}`"
              type="button"
              class="pp-rect"
              :data-kind="kind(rect.name)"
              :data-hit="matches(rect.name) ? '' : undefined"
              :data-picked="picked === rect.node ? '' : undefined"
              :style="`left:${rect.x * 100}%;width:${rect.w * 100}%;top:${rect.depth * 24}px`"
              :title="`${rect.name} — ${fmtValue(rect.total)} (${fmtShare(rect.total, root.total)})`"
              @click="onRect(rect)"
            >
              <span v-if="rect.w > 0.035" class="pp-rect__label">{{ shortName(rect.name) }}</span>
            </button>
          </div>
        </div>

        <div class="pp-legend">
          <span class="pp-key" data-kind="stand">код стенда</span>
          <span class="pp-key" data-kind="builtin">встроенная функция движка</span>
          <span class="pp-key" data-kind="node">внутренности Node</span>
          <span class="pp-key" data-kind="hit">совпало с поиском</span>
        </div>

        <div v-if="pickedRect" class="pp-detail">
          <div class="pp-detail__name">{{ pickedRect.name }}</div>
          <div class="pp-detail__nums">
            всего под кадром: <b>{{ fmtValue(pickedRect.total) }}</b> ({{ fmtShare(pickedRect.total, root.total) }})
            · выделено в самом кадре: <b>{{ fmtValue(pickedRect.self) }}</b> ({{ fmtShare(pickedRect.self, root.total) }})
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <Md
        class="pp-foot"
        text="Профиль снят один раз на стенде темы (Node 26.8.2, интервал 32 КБ) и вшит в страницу: сворачивается он у вас, а записан там. Выборка случайна — ваш собственный прогон стенда даст доли, отличающиеся на проценты. «Сэмплы» — не число объектов: крупный объект попадает в выборку чаще мелкого."
      />
    </template>
  </DemoFrame>
</template>

<style scoped>
.pp-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.pp-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}

.pp-idle {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

.pp-meta {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.pp-search {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.pp-search__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pp-input {
  /* У `input` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  flex: 1 1 200px;
  min-width: 0;
  max-width: 320px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.pp-input::placeholder {
  color: var(--text-faint);
}
.pp-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}
.pp-search__share {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-ok-text);
}

.pp-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
}
.pp-crumb {
  font: inherit;
  color: inherit;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  cursor: pointer;
}
.pp-crumb:disabled {
  color: var(--text-faint);
  cursor: default;
}
.pp-crumb__sep {
  font-size: var(--fs-2);
  color: var(--text-faint);
}

/* Пламя прокручивается само и не имеет права утащить вбок страницу. */
.pp-scroll {
  min-width: 0;
  overflow-x: auto;
}
.pp-flame {
  position: relative;
  min-width: 520px;
}
.pp-rect {
  position: absolute;
  box-sizing: border-box;
  height: 22px;
  margin: 0;
  padding: 0 5px;
  overflow: hidden;
  border: 0;
  border-inline-end: 1px solid var(--surface);
  border-radius: 3px;
  background: var(--surface-3);
  color: var(--ink);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 22px;
  text-align: start;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}
.pp-rect[data-kind='root'] {
  background: var(--bar-neutral);
}
.pp-rect[data-kind='stand'] {
  background: var(--tone-info-chip);
}
.pp-rect[data-kind='builtin'] {
  background: var(--tone-warn-chip);
}
.pp-rect[data-hit] {
  background: var(--tone-ok-chip);
  font-weight: 600;
}
.pp-rect[data-picked] {
  outline: 2px solid var(--ink);
  outline-offset: -2px;
}
.pp-rect:focus-visible {
  outline: 2px solid var(--tone-info-line);
  outline-offset: -2px;
}
.pp-rect__label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pp-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.pp-key {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.pp-key::before {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--surface-3);
}
.pp-key[data-kind='stand']::before {
  background: var(--tone-info-chip);
}
.pp-key[data-kind='builtin']::before {
  background: var(--tone-warn-chip);
}
.pp-key[data-kind='hit']::before {
  background: var(--tone-ok-chip);
}

.pp-detail {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 13px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface-2);
}
.pp-detail__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.pp-detail__nums {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.pp-foot {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-faint);
}
</style>
