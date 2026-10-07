<script setup lang="ts">
/**
 * Кто что видит при перечислении: одна операция — один настоящий вызов.
 *
 * Матрица «✓ / —» на этом месте давала правильные ответы на неправильно заданный вопрос.
 * Клетка «спред · символы» закрашена — а какие символы? У объекта их два, и спред приносит
 * ровно один. Клетка этого сказать не может, список вернувшихся ключей — может.
 *
 * Поэтому справа не колонки, а то, что операция реально вернула, и у каждого ключа подписана
 * его категория. Отсутствие ключа тоже видно: пяти категорий слева всегда пять, и погашенные
 * из них — это и есть ответ «не видит».
 *
 * Считает `model/probe.ts`, не компонент: тот же модуль доступен тесту, и таблица на странице
 * с таблицей в тесте разойтись не может. Вызов идёт в `onMounted` и на смену операции.
 */
import { computed, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { KINDS, KIND_LABEL, OPS, SOURCE, runEnum } from '../model/probe';
import type { EnumOp, EnumRun } from '../model/types';

withDefaults(defineProps<{ note?: string }>(), {
  note: '`Reflect.ownKeys` — единственный полный ответ на вопрос «какие ключи есть у объекта»: это и есть внутренний метод `[[OwnPropertyKeys]]`.',
});

const op = ref<EnumOp>('for-in');

const run = ref<EnumRun | null>(null);
const refresh = () => {
  run.value = runEnum(op.value);
};

onMounted(refresh);
watch(op, refresh);

/** Категория попала в выдачу — значит, операция её видит. По этому и гаснет легенда слева. */
const seen = computed(() => new Set((run.value?.hits ?? []).map((hit) => hit.kind)));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">операция:</span>
        <SegmentedControl v-model="op" class="l-pills" label="Операция перечисления" :options="OPS" />
      </div>
    </template>

    <!-- `data-code` — листинг подопытного: кавычки и скобки внутри принадлежат коду. -->
    <pre class="source" data-code>{{ SOURCE.join('\n') }}</pre>

    <div class="split">
      <div class="pane">
        <div class="t-label">пять категорий ключей</div>

        <div
          v-for="item in KINDS"
          :key="item.key"
          class="kind"
          :data-kind="item.kind"
          :data-seen="seen.has(item.kind) ? 'yes' : 'no'"
        >
          <span class="kind__key">{{ item.key }}</span>
          <span class="kind__what">{{ KIND_LABEL[item.kind] }}</span>
          <span class="kind__mark">{{ run ? (seen.has(item.kind) ? 'видит' : 'не видит') : '…' }}</span>
        </div>
      </div>

      <div class="pane pane--right">
        <div class="block">
          <span class="t-label">вызов</span>
          <div class="call" data-code>{{ run ? run.code : '…' }}</div>
        </div>

        <div class="block">
          <span class="t-label">вернулось на самом деле</span>

          <p v-if="!run" class="wait">вызов идёт в вашем браузере…</p>

          <template v-else>
            <div class="raw" data-code>{{ run.raw }}</div>

            <div v-if="!run.hits.length" class="empty">пусто — ни одного ключа</div>
            <div v-else class="hits">
              <span v-for="(hit, i) in run.hits" :key="i" class="hit" :data-kind="hit.kind">
                <b class="hit__label">{{ hit.label }}</b>
                <i class="hit__kind">{{ KIND_LABEL[hit.kind] }}</i>
              </span>
            </div>
          </template>
        </div>

        <Md v-if="run" class="explain" :text="run.note" />
      </div>
    </div>

    <template #footer>
      <Md class="enum-probe-foot" :text="note" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}

.source {
  margin: 0;
  padding: 16px 18px;
  border-bottom: 1px solid var(--divider);
  border-radius: 0;
  font-size: var(--fs-3);
  line-height: 1.7;
  overflow-x: auto;
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 20px;
  border-right: 1px solid var(--divider);
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

/* Категория: слева ключ, под ним — что это за категория, справа приговор операции. */
.kind {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  align-items: baseline;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  transition: all 0.2s;
}
.kind__key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.kind__what {
  grid-column: 1;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-faint);
}
.kind__mark {
  grid-row: 1 / span 2;
  grid-column: 2;
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
  color: var(--dim);
}
.kind[data-seen='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.kind[data-seen='yes'] .kind__key,
.kind[data-seen='yes'] .kind__mark {
  color: var(--tone-ok-strong);
}
/* «Не видит» — не пустота, а ответ: гасим, но оставляем строку на месте. */
.kind[data-seen='no'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.kind[data-seen='no'] .kind__key {
  color: var(--dim);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.call {
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: anywhere;
}
/* Возвращённое значение целиком — на чернилах, как в консоли. */
.raw {
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--tone-ok-on-ink);
  overflow-wrap: anywhere;
}
.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.hits {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.hit {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 7px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
}
.hit__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  overflow-wrap: anywhere;
}
.hit__kind {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: normal;
  color: var(--text-faint);
}
.hit[data-kind='own-enum'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.hit[data-kind='own-enum'] .hit__label {
  color: var(--tone-ok-strong);
}
.hit[data-kind='own-hidden'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.hit[data-kind='own-hidden'] .hit__label {
  color: var(--tone-warn-strong);
}
.hit[data-kind='symbol-enum'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}
.hit[data-kind='symbol-enum'] .hit__label {
  color: var(--tone-info-strong);
}
/* Неперечислимый символ — та же семья, но пунктиром: он приходит не всюду, куда приходит брат. */
.hit[data-kind='symbol-hidden'] {
  border-style: dashed;
  border-color: var(--tone-info-line);
  background: var(--surface);
}
.hit[data-kind='symbol-hidden'] .hit__label {
  color: var(--tone-info-strong);
}
.hit[data-kind='inherited'] {
  border-color: var(--border-strong);
  background: var(--surface-3);
}
.hit[data-kind='inherited'] .hit__label {
  color: var(--chip-text);
}

.explain {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.enum-probe-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
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
