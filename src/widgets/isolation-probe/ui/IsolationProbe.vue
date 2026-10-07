<script setup lang="ts">
/**
 * Демо, которое честно показывает, почему оно не работает.
 *
 * Общая память требует заголовков COOP/COEP на документе, а этот сайт статический —
 * заголовков у него нет и взяться им неоткуда. Обычный выход в такой ситуации — нарисовать
 * «демо» на обычном `ArrayBuffer` и назвать его общей памятью. Здесь выбран другой: демо
 * проверяет вкладку читателя и печатает, что в ней есть на самом деле, а чего нет и почему.
 *
 * Обе ветки написаны заранее: страница одинаково осмысленна и на статическом сайте,
 * и на изолированном домене, куда этот код можно скопировать.
 */
import { onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { probeIsolation, type ProbeReport } from '../model/probe';

const props = withDefaults(
  defineProps<{
    /** Что сказать, если изоляции нет. Разрешена строчная разметка. */
    denied?: string;
    /** Что сказать, если она есть. */
    granted?: string;
    foot?: string;
  }>(),
  { denied: '', granted: '', foot: '' },
);

const report = ref<ProbeReport | null>(null);
const failed = ref('');

onMounted(async () => {
  try {
    report.value = await probeIsolation();
  } catch (failure) {
    failed.value = failure instanceof Error ? failure.message : String(failure);
  }
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">проверка этой вкладки</span>
        <span v-if="report" class="bar__verdict" :data-ok="report.isolated ? 'yes' : 'no'">
          {{ report.isolated ? 'изолирована' : 'не изолирована' }}
        </span>
        <span v-else class="bar__wait">проверяется…</span>
      </div>
    </template>

    <div class="body">
      <p v-if="failed" class="failed">{{ failed }}</p>

      <div v-for="row in report?.rows ?? []" :key="row.key" class="row" :data-tone="row.tone">
        <span class="row__label">{{ row.label }}</span>
        <span class="row__value">{{ row.value }}</span>
        <span class="row__note">{{ row.note }}</span>
      </div>

      <Md
        v-if="report"
        class="verdict"
        :data-ok="report.isolated ? 'yes' : 'no'"
        :text="report.isolated ? props.granted : props.denied"
      />
    </div>

    <template v-if="props.foot" #footer>
      <Md class="isolation-probe-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.bar__verdict {
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.bar__verdict[data-ok='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.bar__verdict[data-ok='no'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.bar__wait {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--dim);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 20px;
}

.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 4px 12px;
  padding: 11px 13px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
}
.row__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  overflow-wrap: anywhere;
  color: var(--ink);
}
.row__value {
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
  text-align: end;
}
.row__note {
  grid-column: 1 / -1;
  font-size: var(--fs-5);
  line-height: 1.5;
  color: var(--text-muted);
}
.row[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.row[data-tone='ok'] .row__value {
  color: var(--tone-ok-strong);
}
.row[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.row[data-tone='warn'] .row__value {
  color: var(--tone-warn-strong);
}
.row[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.row[data-tone='err'] .row__value {
  color: var(--tone-err-strong);
}
.row[data-tone='dim'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.row[data-tone='dim'] .row__value {
  color: var(--dim);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.verdict[data-ok='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.verdict[data-ok='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}

.failed {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-err-strong);
}

.isolation-probe-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
