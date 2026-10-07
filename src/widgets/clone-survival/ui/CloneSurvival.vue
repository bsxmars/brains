<script setup lang="ts">
/**
 * Что переживёт клонирование — проверкой, а не таблицей.
 *
 * Каждая строка вызывает настоящий `structuredClone` в браузере читателя и складывает
 * вердикт из проверок клона: `instanceof`, список ключей, дескриптор свойства, `lastIndex`.
 * Заранее написанного ответа в данных нет — есть только объяснение, почему движок поступает
 * именно так.
 *
 * Исходов три, и средний — самый важный. «Упало» видно сразу, а «прошло, но это уже не то
 * значение» всплывает через неделю и в другом месте.
 *
 * Прогон идёт в `onMounted`: часть случаев (DOM-узел) в Node не существует вовсе, а остров
 * сперва рендерится на сервере.
 */
import { onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { CLONE_CASES } from '../model/cases';
import { runCloneCase } from '../model/run';
import type { CloneOutcome } from '../model/types';

const props = withDefaults(defineProps<{ foot?: string }>(), { foot: '' });

const results = ref<Record<string, CloneOutcome>>({});
const supported = ref(true);

onMounted(() => {
  if (typeof structuredClone !== 'function') {
    supported.value = false;
    return;
  }
  const next: Record<string, CloneOutcome> = {};
  for (const item of CLONE_CASES) next[item.key] = runCloneCase(item);
  results.value = next;
});

const LABEL: Record<string, string> = {
  ok: 'прошло',
  lossy: 'прошло, но не целиком',
  throw: 'DataCloneError',
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="legend">
        <span class="chip" data-verdict="ok">прошло</span>
        <span class="chip" data-verdict="lossy">прошло, но не целиком</span>
        <span class="chip" data-verdict="throw">упало</span>
        <span class="legend__note">проверяет ваш браузер прямо сейчас</span>
      </div>
    </template>

    <div class="body">
      <p v-if="!supported" class="empty">
        В этой среде нет structuredClone — проверить нечем.
      </p>

      <div v-for="item in CLONE_CASES" :key="item.key" class="case" :data-verdict="results[item.key]?.verdict ?? 'wait'">
        <div class="case__head">
          <span class="case__label">{{ item.label }}</span>
          <span class="chip" :data-verdict="results[item.key]?.verdict ?? 'wait'">
            {{ results[item.key] ? LABEL[results[item.key].verdict] : 'проверяется…' }}
          </span>
        </div>

        <pre class="case__code" data-code>{{ item.code }}</pre>

        <p v-if="results[item.key]" class="case__note">{{ results[item.key].note }}</p>
        <Md class="case__why" :text="item.why" />
      </div>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="clone-survival-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.legend {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.legend__note {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 20px;
}

.case {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface);
  transition: all 0.2s;
}
.case[data-verdict='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.case[data-verdict='lossy'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.case[data-verdict='throw'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}

.case__head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
}
.case__label {
  font-family: var(--mono);
  font-size: var(--fs-4);
  font-weight: 600;
  color: var(--ink);
}

.case__code {
  font-size: var(--fs-2);
  line-height: 1.6;
  padding: 11px 13px;
}

.case__note {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  overflow-wrap: anywhere;
  color: var(--ink);
}
.case__why {
  font-size: var(--fs-5);
  line-height: 1.6;
  color: var(--prose);
}

.chip {
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  white-space: nowrap;
}
.chip[data-verdict='ok'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.chip[data-verdict='lossy'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}
.chip[data-verdict='throw'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}
.chip[data-verdict='wait'] {
  background: var(--surface-3);
  color: var(--text-muted);
}

.empty {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.clone-survival-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
