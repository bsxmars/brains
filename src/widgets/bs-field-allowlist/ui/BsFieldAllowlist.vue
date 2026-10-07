<script setup lang="ts">
/**
 * «Что попадёт в запись»: тело запроса строкой JSON → запись Алисы после `Object.assign`
 * и после списка разрешённых имён.
 *
 * Считают строки темы `NAIVE_MASS_CODE` и `PICK_CODE`, собранные `new Function`
 * (`model/run.ts`); тот же путь проходит тест по `FIELD_CASES`. Тело разбирает `JSON.parse`
 * браузера — как на сервере, поэтому `__proto__` из тела ведёт себя так же, как в Node.
 * Схему zod демо в браузер не везёт: её ответы — в таблице рядом, сверенной тестом.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { applyBody, loadFieldCode } from '../model/run';
import type { FieldCase, Profile } from '../model/types';

const props = defineProps<{
  naiveCode: string;
  pickCode: string;
  record: Profile;
  cases: FieldCase[];
  caption: string;
}>();

const code = loadFieldCode(props.naiveCode, props.pickCode);

const text = ref(props.cases[1].body);
const picked = ref(1);

function useCase(i: number) {
  picked.value = i;
  text.value = props.cases[i].body;
}

const applied = computed(() => applyBody(code, props.record, text.value));

function show(value: unknown): string {
  return value === undefined ? '—' : JSON.stringify(value);
}
</script>

<template>
  <DemoFrame>
    <div class="bs-fa-body">
      <div class="bs-fa-cases" role="group" aria-label="Готовые тела запроса">
        <button
          v-for="(c, i) in cases"
          :key="c.label"
          type="button"
          class="bs-fa-chip"
          :aria-pressed="picked === i"
          @click="useCase(i)"
        >
          {{ c.label }}
        </button>
      </div>

      <label class="bs-fa-field">
        <span class="bs-fa-label">тело PATCH /api/profile</span>
        <textarea v-model="text" class="bs-fa-input" rows="3" spellcheck="false" @input="picked = -1" />
      </label>

      <div v-if="'error' in applied" class="bs-fa-error">
        <Md :text="applied.error" />
      </div>
      <div v-else class="bs-fa-scroll">
        <table class="bs-fa-table">
          <thead>
            <tr>
              <th scope="col">поле</th>
              <th scope="col">было</th>
              <th scope="col"><code>Object.assign</code></th>
              <th scope="col"><code>pickEditable</code></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in applied.rows" :key="row.key">
              <th scope="row"><code>{{ row.key }}</code></th>
              <td><code>{{ show(row.before) }}</code></td>
              <td :data-changed="row.naive !== row.before ? 'yes' : 'no'">
                <code>{{ show(row.naive) }}</code>
                <span v-if="row.inherited" class="bs-fa-note"> унаследовано</span>
              </td>
              <td :data-changed="row.pick !== row.before ? 'safe' : 'no'"><code>{{ show(row.pick) }}</code></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <template #footer>
      <Md class="bs-fa-caption" :text="caption" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.bs-fa-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  min-width: 0;
}
.bs-fa-body :deep(code),
.bs-fa-body code,
.bs-fa-caption :deep(code) {
  font-family: var(--mono);
  /* Не ниже ступени `--fs-2`: в подписи на `--fs-2` доля .92em давала 10.9px. */
  font-size: max(0.92em, var(--fs-2));
}

.bs-fa-cases {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bs-fa-chip {
  font: inherit;
  color: inherit;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-full);
  background: var(--surface);
  color: var(--chip-text);
  font-size: var(--fs-3);
  cursor: pointer;
}
.bs-fa-chip:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.bs-fa-chip[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--surface);
}

.bs-fa-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bs-fa-label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.bs-fa-input {
  /* У `textarea` шрифт и цвет свои, браузерные, — в курсе таких нет. */
  font: inherit;
  color: inherit;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  color: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  resize: vertical;
}
.bs-fa-input:focus {
  outline: 2px solid var(--tone-info-line);
  outline-offset: 1px;
}

.bs-fa-error {
  padding: 10px 14px;
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  font-size: var(--fs-3);
}

.bs-fa-scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r3);
  background: var(--surface);
}
.bs-fa-table {
  width: 100%;
  min-width: 440px;
  border-collapse: collapse;
  font-size: var(--fs-2);
  color: var(--prose);
}
.bs-fa-table th,
.bs-fa-table td {
  padding: 7px 12px;
  text-align: start;
  vertical-align: baseline;
  overflow-wrap: anywhere;
}
.bs-fa-table thead th {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 400;
  color: var(--text-faint);
  border-bottom: 1px solid var(--rule);
}
.bs-fa-table tbody tr + tr > * {
  border-top: 1px solid var(--rule);
}
.bs-fa-table tbody th {
  font-weight: 400;
  color: var(--ink);
}
.bs-fa-table td[data-changed='yes'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.bs-fa-table td[data-changed='safe'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.bs-fa-note {
  font-size: var(--fs-3);
}

.bs-fa-caption {
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.bs-fa-table :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
