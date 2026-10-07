<script setup lang="ts">
/**
 * Что решает заголовок: директивы `Cache-Control` и повторный заход.
 *
 * Демо отвечает на два вопроса, которые путают чаще всего: **пойдёт ли браузер в сеть** и
 * **уйдёт ли условный запрос**. Разделены они намеренно — это две независимые фазы жизни
 * ответа, и почти вся путаница в директивах растёт из их смешения. `no-cache` не запрещает
 * хранение, `must-revalidate` не означает «проверять всегда», а отсутствие заголовка не
 * означает «не кешировать».
 *
 * ⚠️ Это **модель по спецификации**, а не замер: показано то, что кеш обязан сделать по
 * RFC 9111, а не то, что сделал конкретный браузер. Там, где утверждение удалось подтвердить
 * запуском, под карточкой стоит отдельная строка «замер» — и только она замером является.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { CacheMode } from '../model/types';

const props = defineProps<{ modes: CacheMode[] }>();

const modeKey = ref(props.modes[0].key);
const options = computed(() => props.modes.map((m) => ({ value: m.key, label: m.label })));
const current = computed(() => props.modes.find((m) => m.key === modeKey.value) ?? props.modes[0]);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">модель по RFC 9111 · не замер</span>
        <SegmentedControl
          v-model="modeKey"
          class="l-pills"
          label="Директивы Cache-Control"
          :options="options"
        />
      </div>
    </template>

    <div class="body">
      <!-- `data-code` помечает поддеревом код: внутри законны любые кавычки. -->
      <div class="ch-header" data-code>{{ current.header }}</div>

      <div class="grid">
        <div class="cell">
          <span class="t-label">ляжет на диск</span>
          <span class="cell__value" :data-tone="current.stored ? 'ink' : 'err'">
            {{ current.stored ? 'да' : 'нет' }}
          </span>
        </div>

        <div class="cell">
          <span class="t-label">повторный заход, пока свежий</span>
          <span class="cell__value" :data-tone="current.fresh.tone">{{ current.fresh.network }}</span>
          <span class="cell__note">{{ current.fresh.body }}</span>
        </div>

        <div class="cell">
          <span class="t-label">после протухания</span>
          <span class="cell__value" :data-tone="current.stale.tone">{{ current.stale.network }}</span>
          <span class="cell__note">{{ current.stale.body }}</span>
        </div>

        <div class="cell">
          <span class="t-label">условный запрос</span>
          <span class="cell__value" data-tone="ink">{{ current.conditional }}</span>
        </div>
      </div>

      <Md class="verdict" :data-tone="current.tone" :text="current.verdict" />

      <div v-if="current.measured" class="measured">
        <span class="t-label">замер</span>
        <Md :text="current.measured" />
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Это модель: так обязан вести себя кеш по RFC 9111. Строки, отмеченные «замер», проверены
        запуском в Chromium 153 на локальном сервере — там считалось, сколько запросов реально
        дошло до сервера и какие из них были условными. Всё остальное — спецификация, и на
        конкретном CDN поведение может отличаться.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}

/*
 * ⚠️ Префикс слайса здесь обязателен, и вот чем обошлось его отсутствие.
 *
 * Класс назывался просто `.header` — как и шапка раздела в `shared/ui/Section.astro`.
 * Стиль объявлен со `scoped`, но скоуп у `.astro`-компонента и у `.vue`-острова разный,
 * и правило виджета накрыло шапки **всех восьми разделов** темы про сеть: заголовки стали
 * моноширинными на чернильной плашке, а лид обрезался, потому что здесь стоит
 * `white-space: pre`. На других страницах дефекта не было — виджет живёт только на этой.
 *
 * Это третье столкновение того же рода после `.row` и `.note`: общее имя класса в виджете
 * рано или поздно встречает такое же имя в общем слое.
 */
.ch-header {
  padding: 12px 15px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
  gap: 14px;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.cell__value {
  font-family: var(--mono);
  font-size: var(--fs-6);
  transition: color 0.2s;
}
.cell__value[data-tone='ink'] {
  color: var(--ink);
}
.cell__value[data-tone='info'] {
  color: var(--tone-info-strong);
}
.cell__value[data-tone='ok'] {
  color: var(--tone-ok-strong);
}
.cell__value[data-tone='warn'] {
  color: var(--tone-warn-strong);
}
.cell__value[data-tone='err'] {
  color: var(--tone-err-strong);
}
.cell__note {
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.verdict[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.measured {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--divider);
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
