<script setup lang="ts">
/**
 * Prototype pollution вживую: атака выполняется, а не рисуется.
 *
 * Главный кадр демо — не цель слияния, а **посторонний** объект: свежий `{}`, которого никто
 * не касался. Он и отвечает `true`. Рядом видно, что сама цель не получила ничего: запись
 * целиком уехала в прототип. Эти два факта вместе и есть вся атака.
 *
 * Три переключателя — три защиты из урока. При включённой защите атака не проходит, и видно
 * это тем же способом: тем же посторонним объектом.
 *
 * ⚠️ **Демо убирает за собой.** Успешный прогон вешает свойство на настоящий `Object.prototype`,
 * то есть портит страницу читателя ровно так, как рассказывает раздел. Уборка стоит в `finally`
 * каждого прогона (`model/run.ts`) и здесь же на `onUnmounted` — иначе страница осталась бы
 * отравленной до перезагрузки.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import CodeListing from '@/shared/ui/CodeListing.vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { cleanPrototype, PAYLOAD, runPollution } from '../model/run';
import type { PollutionFix, PollutionRun } from '../model/types';

// Подпись под демо — по желанию темы. Умолчание «ключевой шаг — чтение аксессора» снято
// 2026-09-30: в «Объектной модели» этот шаг теперь разобран прямо над демо, и подпись
// повторяла его в третий раз.
defineProps<{ note?: string }>();

type Toggle = 'off' | 'on';

const OPTIONS: { value: Toggle; label: string }[] = [
  { value: 'off', label: 'выкл' },
  { value: 'on', label: 'вкл' },
];

const filter = ref<Toggle>('off');
const nullProto = ref<Toggle>('off');
const freeze = ref<Toggle>('off');

const fixes = computed<PollutionFix[]>(() => {
  const list: PollutionFix[] = [];
  if (filter.value === 'on') list.push('filter');
  if (nullProto.value === 'on') list.push('nullProto');
  if (freeze.value === 'on') list.push('freeze');
  return list;
});

const run = ref<PollutionRun | null>(null);
const refresh = () => {
  run.value = runPollution(fixes.value);
};

onMounted(refresh);
watch(fixes, refresh);

// Вторая половина уборки: прогон чистит за собой сам, но размонтирование посреди прогона
// не должно оставить страницу с чужим свойством на `Object.prototype`.
onUnmounted(cleanPrototype);

const targetKeys = computed(() => {
  if (!run.value) return '…';
  return run.value.targetKeys.length ? JSON.stringify(run.value.targetKeys) : '[] — цели не досталось ничего';
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bars">
        <div class="bar">
          <span class="bar__label">проверка ключа:</span>
          <SegmentedControl v-model="filter" class="l-pills" label="Проверка ключа на __proto__" :options="OPTIONS" />
        </div>
        <div class="bar">
          <span class="bar__label">Object.create(null):</span>
          <SegmentedControl v-model="nullProto" class="l-pills" label="Цель без прототипа" :options="OPTIONS" />
        </div>
        <div class="bar">
          <span class="bar__label">заморозка:</span>
          <SegmentedControl v-model="freeze" class="l-pills" label="Заморозка прототипа" :options="OPTIONS" />
        </div>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <div class="payload">
          <span class="t-label">пришло от пользователя</span>
          <pre class="payload__box" data-code>{{ PAYLOAD }}</pre>
        </div>

        <CodeListing v-if="run" :lines="run.code" label="что исполнилось" />
        <p v-else class="wait">слияние выполняется в вашем браузере…</p>

        <ConsoleView v-if="run" :lines="run.log" label="трасса слияния" :min-height="120" />
      </div>

      <div class="pane pane--right">
        <!-- Главный кадр: объект, которого никто не трогал, и его ответ. -->
        <div class="headline" :data-tone="run ? run.tone : 'idle'">
          <span class="headline__label">посторонний объект</span>
          <span class="headline__expr">{{ run ? run.probe : '…' }}</span>
          <span class="headline__value">{{ run ? run.bystander : '…' }}</span>
          <span v-if="run" class="headline__note">
            {{ run.polluted ? 'свойство пришло тому, кого не трогали' : 'чисто: свойство не пришло' }}
          </span>
        </div>

        <div class="block">
          <span class="t-label">собственные ключи цели слияния</span>
          <div class="value" :data-empty="run && !run.targetKeys.length ? 'yes' : 'no'">{{ targetKeys }}</div>
        </div>

        <div v-if="run && run.errorName" class="err">
          <span class="err__name">{{ run.errorName }}</span>
          <span class="err__text">{{ run.error }}</span>
        </div>

        <div v-if="run" class="result" :data-tone="run.tone">
          <Md :text="run.verdict" />
        </div>

        <div v-if="run" class="block">
          <span class="t-label">на чём ставился опыт</span>
          <div class="value value--small">{{ run.victim }}</div>
          <Md class="victim-note" :text="run.victimNote" />
        </div>
      </div>
    </div>

    <template #footer>
      <div class="pollution-lab-foot">
        <Md v-if="note" :text="note" />
        <Md
          class="pollution-lab-foot__rule"
          text="После каждого прогона демо снимает подброшенное свойство с `Object.prototype` — и делает это же при уходе со страницы. Иначе разбор про отравление оставлял бы страницу отравленной."
        />
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.bar__label {
  min-width: 156px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
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
  gap: 16px;
}

.payload {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.payload__box {
  margin: 0;
  padding: 11px 13px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--tone-warn-text);
  overflow-x: auto;
}

.wait {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

/* Ради этой плашки демо и сделано: она обязана читаться раньше всего остального. */
.headline {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 16px 18px;
  border-radius: var(--r3);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: all 0.2s;
}
.headline__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.headline__expr {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.headline__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  font-weight: 700;
  line-height: 1.1;
}
.headline__note {
  font-size: var(--fs-4);
  line-height: 1.5;
}
.headline[data-tone='idle'] {
  border-color: var(--divider);
  background: var(--sunk-dim);
}
.headline[data-tone='idle'] .headline__value {
  color: var(--dim);
}
.headline[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.headline[data-tone='err'] .headline__value {
  color: var(--tone-err-strong);
}
.headline[data-tone='err'] .headline__note {
  color: var(--tone-err-text);
}
.headline[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.headline[data-tone='ok'] .headline__value {
  color: var(--tone-ok-strong);
}
.headline[data-tone='ok'] .headline__note {
  color: var(--tone-ok-text);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.value {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.value--small {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
/* Пустая цель при успешной атаке — второй половины ответа: всё уехало мимо неё. */
.value[data-empty='yes'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.err {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px 14px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.err__name {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--tone-ok-strong);
}
.err__text {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--tone-ok-text);
  overflow-wrap: anywhere;
}

.result {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-5);
  line-height: 1.55;
}
.result[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.result[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}

.victim-note {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-faint);
}

.pollution-lab-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.pollution-lab-foot__rule {
  color: var(--text-faint);
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
