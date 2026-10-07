<script setup lang="ts">
/**
 * Порядок ключей: читатель набирает их сам, объект показывает, как он их разложил.
 *
 * Правило из трёх строк («индексы по возрастанию, остальные строки по добавлению, символы
 * в конце») выглядит очевидным ровно до того момента, когда набираешь `'01'` и видишь его
 * во второй группе. Убедить в этом словами нельзя — ловушка в том и состоит, что выглядит
 * она как не-ловушка. Поэтому здесь поле ввода, а не пример: своё возражение можно набрать
 * и проверить, а заготовки рядом — уже собранные ловушки.
 *
 * Сборку и разбор делает `model/build.ts`, компонент только рисует: тот же модуль доступен
 * тесту, и порядок на странице с порядком в тесте разойтись не может.
 *
 * ⚠️ Ввод разбирается без `eval`: список имён через запятую, объект собирается присваиванием.
 * Единственный синтаксис сверх имени — `Symbol(имя)`.
 */
import { computed, onMounted, ref, watch } from 'vue';
import CodeInput from '@/shared/ui/CodeInput.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { GROUP_LABEL, PRESETS, buildOrder } from '../model/build';
import type { KeyGroup, OrderRun, OrderedKey } from '../model/types';

withDefaults(defineProps<{ note?: string }>(), {
  note: 'Порядок не «как получится» и не «как написано»: он специфицирован, и на него опираются `Object.keys`, `for…in`, спред и `JSON.stringify`.',
});

const input = ref(PRESETS[0].keys);

const run = ref<OrderRun | null>(null);
const refresh = () => {
  run.value = buildOrder(input.value);
};

onMounted(refresh);
watch(input, refresh);

/** Пояснение показывается, только пока набор дословно совпадает с заготовкой. */
const preset = computed(() => PRESETS.find((item) => item.keys === input.value));

/**
 * Группы нарезаются из того порядка, который вернул движок, — по смене группы у соседей,
 * а не сортировкой по трём корзинам. Разница принципиальная: корзины показали бы нашу
 * классификацию, нарезка показывает, что группы в выдаче действительно идут подряд.
 */
const groups = computed(() => {
  const out: { group: KeyGroup; items: OrderedKey[] }[] = [];
  for (const key of run.value?.keys ?? []) {
    const last = out[out.length - 1];
    if (last && last.group === key.group) last.items.push(key);
    else out.push({ group: key.group, items: [key] });
  }
  return out;
});

const apply = (keys: string) => {
  input.value = keys;
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="bar__label">заготовки:</span>
        <Button v-for="item in PRESETS" :key="item.label" variant="secondary" @click="apply(item.keys)">
          {{ item.label }}
        </Button>
      </div>
    </template>

    <div class="split">
      <div class="pane">
        <CodeInput v-model="input" label="ключи через запятую" :rows="4" />
        <div class="hint">
          Имя без кавычек или в кавычках — строковый ключ. <code>Symbol(s)</code> — символьный.
          Объект собирается присваиванием: <code>obj[ключ] = номер</code>.
        </div>

        <div class="block">
          <span class="t-label">как набрано</span>
          <div v-if="run && run.typed.length" class="typed">
            <span v-for="(key, i) in run.typed" :key="i" class="typed__item">
              <i class="typed__n">{{ i + 1 }}</i>{{ key }}
            </span>
          </div>
          <div v-else class="empty">{{ run ? 'ни одного ключа' : 'объект собирается…' }}</div>
        </div>

        <div v-if="run && run.missing.length" class="missing">
          <span class="missing__head">не попали в объект</span>
          <span class="missing__body">{{ run.missing.join(', ') }}</span>
          <Md
            class="missing__why"
            text="`__proto__` при присваивании — не ключ, а сеттер прототипа: свойства с таким именем не появляется вовсе. Повтор ключа, наоборот, свойство оставляет: перезаписывается значение, а позиция остаётся от первого раза."
          />
        </div>
      </div>

      <div class="pane pane--right">
        <div class="block">
          <span class="t-label">Reflect.ownKeys — настоящий порядок</span>

          <div v-if="!run || !run.keys.length" class="empty">
            {{ run ? 'объект пуст' : 'порядок считает ваш браузер…' }}
          </div>

          <div v-for="(group, i) in groups" :key="i" class="group" :data-group="group.group">
            <span class="group__rule">{{ GROUP_LABEL[group.group] }}</span>
            <div class="group__keys">
              <span v-for="key in group.items" :key="key.label" class="key">
                <b class="key__label">{{ key.label }}</b>
                <i class="key__from">набран {{ key.typedAt }}-м</i>
              </span>
            </div>
          </div>
        </div>

        <div class="block">
          <span class="t-label">JSON.stringify следует тому же порядку</span>
          <div class="json" data-code>{{ run ? run.json : '…' }}</div>
        </div>

        <Md v-if="preset" class="explain" :text="preset.note" />
      </div>
    </div>

    <template #footer>
      <Md class="key-order-foot" :text="note" />
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
  min-width: 0;
}
.pane--right {
  border-right: 0;
  background: var(--surface-2);
  gap: 16px;
}

.hint {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
}
.hint code {
  font-family: var(--mono);
  font-size: var(--fs-3);
}

.block {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}

.typed {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.typed__item {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--chip-text);
  overflow-wrap: anywhere;
}
.typed__n {
  font-size: var(--fs-3);
  font-style: normal;
  color: var(--ghost);
}

.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.missing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 13px;
  border: 1px solid var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
}
.missing__head {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--tone-warn-strong);
}
.missing__body {
  font-family: var(--mono);
  font-size: var(--fs-4);
  color: var(--tone-warn-text);
  overflow-wrap: anywhere;
}
.missing__why {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-warn-text);
}

/* Группа: подпись-правило и ключи под ней. Заливка — та самая граница между группами. */
.group {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 13px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.group__rule {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
  color: var(--text-faint);
}
.group__keys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.group[data-group='index'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.group[data-group='symbol'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
}

.key {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r1);
  background: var(--surface);
}
.key__label {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.key__from {
  font-family: var(--mono);
  font-size: var(--fs-3);
  font-style: normal;
  color: var(--text-faint);
}

.json {
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--tone-ok-on-ink);
  overflow-wrap: anywhere;
}

.explain {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.key-order-foot {
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
