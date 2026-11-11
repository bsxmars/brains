<script setup lang="ts">
/** URL reference: actual origins, prepared PSL sites, no process prediction. */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import type { SiteCase } from '../model/types';
import { compareBoundaries } from '../model/compare';

const props = defineProps<{ cases: SiteCase[]; hostSite?: string; hostLabel?: string }>();

const picked = ref('0');
const current = computed(() => props.cases[Number(picked.value)]);
const options = computed(() => props.cases.map((c, i) => ({ value: String(i), label: c.label })));

const boundaries = computed(() => compareBoundaries(current.value, props.hostSite, props.hostLabel));
const comparisons = computed(() => [
  { name: 'site', value: current.value.site, same: boundaries.value.sameSite },
  { name: 'origin', value: boundaries.value.origin, same: boundaries.value.sameOrigin },
]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="picked" class="l-pills" label="Документ во вкладке" :options="options" />
    </template>

    <div class="t-label reference-label">Справочник URL · не список процессов браузера</div>
    <div class="split">
      <div class="pane">
        <div class="field">
          <div class="t-label">URL документа</div>
          <div class="url">{{ current.full }}</div>
        </div>

        <div class="field">
          <div class="t-label">site = схема + eTLD+1</div>
          <div class="site" :data-same="current.same ? 'yes' : 'no'">{{ current.site }}</div>
        </div>

        <div class="why">{{ current.why }}</div>
      </div>

      <div class="pane pane--right">
        <div class="t-label">вкладка «главный фрейм {{ hostLabel ?? 'https://app.shop.com' }}»</div>

        <div class="processes">
          <div v-for="boundary in comparisons" :key="boundary.name" class="process" :class="{ hot: boundary.same }">
            <div class="process__head">
              <span class="process__name">{{ boundary.name }}</span>
              <span class="process__site">{{ boundary.same ? 'совпадает' : 'отличается' }}</span>
            </div>
            <div class="process__docs">{{ boundary.value }}</div>
          </div>
        </div>

        <div class="verdict" :data-same="current.same ? 'yes' : 'no'">{{ current.verdict }}</div>
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.reference-label { padding: 16px 20px 0; }
.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-right: 1px solid var(--divider);
}
.pane--right {
  gap: 16px;
  border-right: 0;
  background: var(--surface-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.url {
  padding: 12px 14px;
  border: 1px solid var(--divider);
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  word-break: break-all;
}
/* Same-site and cross-site are URL relationships, not measured process placement. */
.site {
  padding: 12px 14px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-4);
  transition: all 0.2s;
}
.site[data-same='yes'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-strong);
}
.site[data-same='no'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}

.why {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.processes {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.process {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 13px 15px;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
  opacity: 1;
  transition: all 0.2s;
}
.process.hot {
  border: 1.5px solid var(--accent);
  background: var(--tone-info-bg);
  opacity: 1;
}
.process__head {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.process__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
}
.process__site {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.process__docs {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.verdict {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
  transition: all 0.2s;
}
.verdict[data-same='yes'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-same='no'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}

@media (max-width: 720px) {
  .split {
    grid-template-columns: 1fr;
  }
  .pane {
    border-right: 0;
    border-bottom: 1px solid var(--divider);
  }
}
</style>
