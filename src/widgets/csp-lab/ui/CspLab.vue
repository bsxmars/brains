<script setup lang="ts">
/**
 * «Что выполнится»: заголовок CSP (из готовых политик стенда или свой) и пятнадцать проб
 * сквозной страницы темы — для каждой решение, директива, которая его приняла, и отметка
 * Chromium из журнала стенда.
 *
 * Решение считает не компонент, а строка `CSP_CHECK_CODE` из темы, собранная `new Function`
 * (`model/run.ts`). Та же строка напечатана на странице и сверяется `tests/unit/csp.test.ts`
 * с Chromium 153 на всех 31 × 15 парах журнала. Для своей политики журнала нет — колонка
 * Chromium тогда честно пустая.
 */
import { computed, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadCheck } from '../model/run';
import type { MatrixRow, Preset, Probe } from '../model/types';

const props = defineProps<{
  checkCode: string;
  probes: Probe[];
  matrix: MatrixRow[];
  presets: Preset[];
  /** Адрес страницы, на которой стоят пробы: от него считается `'self'`. */
  pageUrl: string;
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const check = loadCheck(props.checkCode);

const presetId = ref(props.presets[0].id);
const options = props.presets.map((p) => ({ value: p.id, label: p.label }));
const rowOf = (id: string) => props.matrix.find((r) => r.id === id);

const header = ref(rowOf(presetId.value)?.csp ?? '');
watch(presetId, (id) => {
  header.value = rowOf(id)?.csp ?? '';
});

/** Строка журнала, если заголовок совпадает с одной из снятых политик (с точностью до пробелов). */
const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
const logged = computed(() => props.matrix.find((r) => norm(r.csp ?? '') === norm(header.value)) ?? null);

const rows = computed(() =>
  props.probes.map((p) => {
    const r = check(header.value.trim() || null, p.req, props.pageUrl);
    const chrome = logged.value ? logged.value.ran.includes(p.id) : null;
    return { ...p, ...r, chrome };
  }),
);

const allowedCount = computed(() => rows.value.filter((r) => r.allowed).length);

function why(r: { allowed: boolean; directive: string | null; effective: string }) {
  if (r.directive === null) return 'в заголовке нет ни своей, ни запасной директивы';
  const who = r.directive === r.effective ? r.directive : `${r.directive} (за ${r.effective})`;
  return r.allowed ? `пропустила ${who}` : `отказ: ${who}`;
}

const otherIds = props.matrix.filter((m) => !props.presets.some((p) => p.id === m.id));
function pickOther(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  const row = rowOf(id);
  if (row) header.value = row.csp ?? '';
  (e.target as HTMLSelectElement).value = '';
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="presetId" class="l-pills" label="Политика" :options="options" />
    </template>

    <div class="cl-body">
      <div class="cl-head">
        <label class="cl-label" for="cl-header">Content-Security-Policy</label>
        <textarea id="cl-header" v-model="header" class="cl-input" rows="2" spellcheck="false" />
        <div class="cl-meta">
          <span class="cl-count">выполнится {{ allowedCount }} из {{ rows.length }}</span>
          <span class="cl-logged" :data-on="logged ? 'yes' : 'no'">
            {{ logged ? `журнал Chromium: «${logged.id}»` : 'своя политика — журнала Chromium нет' }}
          </span>
          <select class="cl-select" aria-label="Другие политики стенда" @change="pickOther">
            <option value="">ещё {{ otherIds.length }} политик стенда…</option>
            <option v-for="m in otherIds" :key="m.id" :value="m.id">{{ m.csp ?? 'без CSP' }}</option>
          </select>
        </div>
      </div>

      <div class="cl-table" role="table" aria-label="Пробы страницы">
        <div class="cl-row cl-row--head" role="row">
          <span role="columnheader">проба</span>
          <span role="columnheader">checkScript</span>
          <span role="columnheader">Chromium</span>
        </div>
        <div v-for="r in rows" :key="r.id" class="cl-row" role="row" :data-allowed="r.allowed ? 'yes' : 'no'">
          <code role="cell" class="cl-code">{{ r.code }}</code>
          <span role="cell" class="cl-verdict">
            <span class="cl-tag" :data-tone="r.allowed ? 'ok' : 'err'">{{ r.allowed ? 'выполнится' : 'заблокирован' }}</span>
            <span class="cl-why">{{ why(r) }}</span>
          </span>
          <span role="cell" class="cl-chrome" :data-match="r.chrome === null ? 'none' : r.chrome === r.allowed ? 'yes' : 'no'">
            {{ r.chrome === null ? '—' : r.chrome ? 'выполнил' : 'не выполнил' }}
          </span>
        </div>
      </div>

      <Md class="cl-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.cl-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.cl-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cl-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.cl-input {
  font: inherit;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.5;
  color: var(--ink);
  resize: vertical;
  overflow-wrap: anywhere;
}
.cl-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 14px;
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-count {
  font-weight: 600;
  color: var(--ink);
}
.cl-logged {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-logged[data-on='yes'] {
  color: var(--tone-ok-text);
}
.cl-select {
  font: inherit;
  color: inherit;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-2);
}

.cl-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.cl-row {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1.3fr) minmax(0, 0.6fr);
  gap: 6px 12px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-size: var(--fs-3);
  color: var(--prose);
}
.cl-row[data-allowed='no'] {
  background: var(--surface-3);
}
.cl-row--head {
  background: none;
  padding-top: 0;
  padding-bottom: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
@media (max-width: 640px) {
  .cl-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .cl-code {
    grid-column: 1 / -1;
  }
  .cl-row--head span:first-child {
    grid-column: 1 / -1;
  }
}
.cl-code {
  padding: 0;
  background: none;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.cl-verdict {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  min-width: 0;
}
.cl-why {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.cl-tag {
  padding: 1px 8px;
  border-radius: var(--r-full);
  font-size: var(--fs-2);
  white-space: nowrap;
}
.cl-tag[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.cl-tag[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.cl-chrome {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.cl-chrome[data-match='no'] {
  color: var(--tone-warn-text);
  font-weight: 600;
}
.cl-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.cl-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}
</style>
