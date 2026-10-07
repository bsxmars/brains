<script setup lang="ts">
/**
 * Один и тот же поток через два разбора: с состоянием между чанками и без него.
 *
 * Смысл демо — не «посмотрите, какой хороший парсер», а показать цену одного архитектурного
 * решения. Правила формата у обоих разборов здесь одинаковые и разобраны верно: поля, ровно
 * один съеденный пробел, комментарии. Отличается ровно одно — наивный режет каждый чанк
 * по отдельности и ничего не помнит между ними. Этого хватает, чтобы сломаться на трёх
 * границах из пяти, причём молча: событий столько же или больше, исключений нет.
 *
 * Результаты не записаны в данные, а считаются прогоном через настоящий `TransformStream`
 * при каждом показе. Записанный результат — это обещание, которое однажды разойдётся с кодом.
 */
import { computed, onMounted, ref, watch } from 'vue';
import Md from '@/shared/ui/Md.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import { decodeChunks, naiveDecode, type SseEvent } from '../model/sse';
import type { SseCase } from '../model/types';

const props = defineProps<{ cases: SseCase[] }>();

const caseKey = ref(props.cases[0].key);
const options = computed(() => props.cases.map((c) => ({ value: c.key, label: c.label })));
const current = computed(() => props.cases.find((c) => c.key === caseKey.value) ?? props.cases[0]);

const correct = ref<SseEvent[]>([]);
const naive = ref<SseEvent[]>([]);
/** Прогон асинхронный: пока он идёт, показывать чужой результат нельзя. */
const ready = ref(false);

async function run(): Promise<void> {
  ready.value = false;
  const chunks = current.value.chunks;
  naive.value = naiveDecode(chunks);
  correct.value = await decodeChunks(chunks);
  ready.value = true;
}

onMounted(run);
watch(caseKey, () => void run());

/** Невидимые символы обязаны быть видимыми: весь разговор именно о них. */
const visible = (text: string) =>
  text.replace(/\r/g, '␍').replace(/\n/g, '␊').replace(/ /g, '·');

const shape = (events: SseEvent[]) => JSON.stringify(events.map((e) => [e.type, e.data]));

/** Совпали ли разборы — считается прогоном, а не берётся из данных. */
const same = computed(() => ready.value && shape(correct.value) === shape(naive.value));

/** Утверждение страницы против того, что вышло на самом деле. */
const claimHolds = computed(() => !ready.value || current.value.breaks === !same.value);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">границы чанков выбраны так, чтобы попасть в больное место</span>
        <SegmentedControl v-model="caseKey" class="l-pills" label="Где прошла граница" :options="options" />
      </div>
    </template>

    <div class="body">
      <div class="head">
        <div class="title">{{ current.title }}</div>
        <Md class="note" :text="current.note" />
      </div>

      <!-- `data-code` помечает поддерево как код: символы внутри принадлежат примеру. -->
      <div class="stream" data-code>
        <div class="t-label">поток на входе · ␊ перевод строки · ␍ возврат каретки · · пробел</div>
        <div class="chunks">
          <template v-for="(chunk, i) in current.chunks" :key="i">
            <span v-if="i > 0" class="cut" aria-hidden="true">│</span>
            <span class="chunk">{{ visible(chunk) }}</span>
          </template>
        </div>
      </div>

      <div class="split">
        <div class="pane" data-kind="naive">
          <div class="pane__head">
            <span class="t-label">наивный разбор · без состояния между чанками</span>
            <span class="count">{{ ready ? naive.length : '…' }}</span>
          </div>
          <ul v-if="ready && naive.length" class="events">
            <li v-for="(event, i) in naive" :key="i" class="event" data-code>
              <span class="event__type">{{ event.type }}</span>
              <span class="event__data">{{ visible(event.data) }}</span>
            </li>
          </ul>
          <div v-else-if="ready" class="empty">ни одного события</div>
          <div v-else class="empty">считаем…</div>
        </div>

        <div class="pane" data-kind="correct">
          <div class="pane__head">
            <span class="t-label">TransformStream · состояние живёт между чанками</span>
            <span class="count">{{ ready ? correct.length : '…' }}</span>
          </div>
          <ul v-if="ready && correct.length" class="events">
            <li v-for="(event, i) in correct" :key="i" class="event" data-code>
              <span class="event__type">{{ event.type }}</span>
              <span class="event__data">{{ visible(event.data) }}</span>
              <span v-if="event.id" class="event__id">id {{ event.id }}</span>
            </li>
          </ul>
          <div v-else-if="ready" class="empty">ни одного события</div>
          <div v-else class="empty">считаем…</div>
        </div>
      </div>

      <div class="verdict" :data-tone="same ? 'ok' : 'err'">
        <template v-if="!ready">прогоняем поток через настоящий трансформ…</template>
        <template v-else-if="same">
          Здесь разборы совпали: граница прошла мимо больного места. Это часть честного ответа —
          наивный код ломается не всегда, потому и доживает до прода.
        </template>
        <template v-else>
          Разборы разошлись — и ни один из них не бросил исключения. Наивный отдал
          {{ naive.length }} событ{{ naive.length === 1 ? 'ие' : 'ий' }} вместо
          {{ correct.length }}; в проде это выглядит как «иногда обрезается последнее слово».
        </template>
      </div>

      <div v-if="!claimHolds" class="alarm">
        Страница обещала обратное: проверьте данные случая — прогон говорит другое.
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Оба разбора выполняются прямо здесь, в вашем браузере: панель «TransformStream» —
        настоящим <code>TransformStream</code> из <code>widgets/sse-split/model/sse.ts</code>,
        панель «наивный разбор» — тем же кодом без буфера между чанками. Ничего не записано заранее; те же случаи
        закреплены <code>tests/unit/streams.test.ts</code>.
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
  gap: 18px;
  padding: 22px 20px;
  min-width: 0;
}

.head {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.title {
  font-size: var(--fs-7);
  line-height: 1.35;
  color: var(--ink);
}
.note {
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}

.stream {
  display: flex;
  flex-direction: column;
  gap: 9px;
  min-width: 0;
}
.chunks {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  gap: 0;
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--ink);
}
.chunk {
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--code-fg);
  overflow-wrap: anywhere;
}
/* Граница чанка — единственное, что в этом поле надо разглядеть. */
.cut {
  padding: 0 6px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  color: var(--tone-warn-on-ink);
}

.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
  gap: 14px;
}
.pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 15px 16px;
  border-radius: var(--r2);
  min-width: 0;
}
.pane[data-kind='naive'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.pane[data-kind='correct'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.pane__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.count {
  font-family: var(--mono);
  font-size: var(--fs-5);
  color: var(--text-muted);
}

.events {
  display: flex;
  flex-direction: column;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.event {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 7px 10px;
  border-radius: var(--r1);
  background: var(--surface);
  font-family: var(--mono);
  font-size: var(--fs-2);
  min-width: 0;
}
.event__type {
  color: var(--accent);
}
.event__data {
  color: var(--chip-text);
  overflow-wrap: anywhere;
}
.event__id {
  color: var(--text-faint);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--ghost);
}

.verdict {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.verdict[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.alarm {
  padding: 12px 14px;
  border: 1px solid var(--tone-warn-line);
  border-radius: var(--r2);
  background: var(--tone-warn-bg);
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--tone-warn-text);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
