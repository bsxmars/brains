<script setup lang="ts">
/**
 * Один и тот же буфер уходит в настоящий воркер двумя способами, и время меряется здесь,
 * на машине читателя.
 *
 * Почему демо вообще меряет, а не показывает таблицу: «копия дорогая, перенос дешёвый» —
 * это тезис, который каждый слышал и никто не проверял. Числа в таблице урока — с чужой
 * машины, и им нечего противопоставить недоверию. Числа, снятые в этой вкладке минуту назад,
 * спорить не с чем.
 *
 * Два времени на каждый замер, и это главное в приборе:
 *   `blocked` — сколько главный поток простоял **внутри** `postMessage`. Это цена сериализации;
 *   `trip`    — сколько прошло до ответа воркера: та же сериализация плюс десериализация
 *               на той стороне плюс два прохода через очереди задач.
 * У переноса оба числа почти нулевые, и это не «быстрее скопировали» — это **не копировали**.
 *
 * ⚠️ Разрешение часов. Без cross-origin isolation браузер грубит `performance.now()` до сотен
 * микросекунд — ровно из-за того же Spectre, из-за которого недоступен `SharedArrayBuffer`.
 * Поэтому мелкие значения здесь ступенчатые (0, 0.1, 0.2 мс), и это не шум прибора, а его
 * цена деления. На буферах в десятки мегабайт она роли не играет.
 *
 * Воркер поднимается из `blob:` и снимается `terminate()` по таймауту — как в песочнице курса
 * (`features/run-snippet/lib/worker.ts`). Демо обязано пережить неудавшийся замер.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import type { SendMode, TransferRun } from '../model/types';
import { TIMEOUT_MS, WORKER_SOURCE } from '../model/worker';

const props = withDefaults(
  defineProps<{
    /** Границы ползунка в мегабайтах. */
    min?: number;
    max?: number;
    initial?: number;
    /** Подпись под демо. Разрешена строчная разметка. */
    foot?: string;
  }>(),
  { min: 1, max: 64, initial: 16, foot: '' },
);

const mb = ref(props.initial);
const runs = ref<TransferRun[]>([]);
const busy = ref(false);
const error = ref('');
let seq = 0;

/**
 * Воркер один на всё демо и переживает замеры: создание агента стоит единиц-десятков
 * миллисекунд, и поднимать его на каждую отправку значило бы мерить не канал, а старт.
 */
let worker: Worker | null = null;
let workerUrl = '';

function ensureWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    // Имя видно в DevTools → Sources → Threads. Безымянных потоков в списке не различить.
    worker = new Worker(workerUrl, { name: 'transfer-cost' });
  }
  return worker;
}

function dropWorker() {
  worker?.terminate();
  worker = null;
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = '';
  }
}

onBeforeUnmount(dropWorker);

interface Answer {
  bytes: number;
  first: number;
}

async function send(mode: SendMode) {
  const target = ensureWorker();
  if (!target) {
    error.value = 'Воркеры в этой среде недоступны — замерить нечем.';
    return;
  }

  busy.value = true;
  error.value = '';
  // Дать браузеру перерисовать кнопку до того, как поток встанет на memcpy: иначе при 64 МБ
  // читатель не увидит, что нажатие вообще дошло.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const buffer = new ArrayBuffer(mb.value * 1024 * 1024);
  const view = new Uint8Array(buffer);
  // Заполняем до замера. У нетронутого буфера физические страницы ещё не выданы, и копия
  // такого буфера обошлась бы подозрительно дёшево — мерили бы ленивую аллокацию, а не канал.
  view.fill(42);

  const answer = new Promise<Answer>((resolve, reject) => {
    const timer = setTimeout(() => {
      dropWorker();
      reject(new Error(`Воркер не ответил за ${TIMEOUT_MS} мс — замер прерван, воркер снят.`));
    }, TIMEOUT_MS);

    target.onmessage = (event: MessageEvent<Answer>) => {
      clearTimeout(timer);
      resolve(event.data);
    };
    target.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(event.message || 'Ошибка воркера'));
    };
  });

  const started = performance.now();
  // Правильная форма: в сообщении — вид, в transfer-списке — его буфер. Сам `TypedArray`
  // в список переносимых не входит.
  target.postMessage({ view, mode }, mode === 'transfer' ? [buffer] : []);
  const blocked = performance.now() - started;

  try {
    const data = await answer;
    const trip = performance.now() - started;
    runs.value = [
      {
        id: (seq += 1),
        mb: mb.value,
        mode,
        blocked,
        trip,
        left: buffer.byteLength,
        // После переноса индексное чтение возвращает `undefined`, а не бросает.
        probe: String(view[0]),
        got: data.bytes,
      },
      ...runs.value,
    ].slice(0, 10);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}

async function both() {
  await send('copy');
  await send('transfer');
}

const ms = (value: number) => (value < 0.05 ? '< 0.1' : value.toFixed(1));
const bytes = (value: number) => (value === 0 ? '0' : value.toLocaleString('ru-RU'));

/** Последний перенос — на нём и видно, что значит «передача владения». */
const lastTransfer = computed(() => runs.value.find((run) => run.mode === 'transfer'));

/** Последняя пара замеров одного размера: во сколько раз разошлись времена. */
const ratio = computed(() => {
  const copy = runs.value.find((run) => run.mode === 'copy');
  const move = runs.value.find((run) => run.mode === 'transfer' && run.mb === copy?.mb);
  if (!copy || !move || move.trip < 0.05) return null;
  return { mb: copy.mb, times: Math.round(copy.trip / move.trip) };
});
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <label class="bar__label" for="transfer-size">размер буфера</label>
        <input
          id="transfer-size"
          v-model.number="mb"
          class="bar__range"
          type="range"
          :min="props.min"
          :max="props.max"
          step="1"
        />
        <output class="bar__value" for="transfer-size">{{ mb }} МБ</output>
      </div>
    </template>

    <div class="body">
      <div class="row">
        <Button variant="primary" :disabled="busy" @click="both()">замерить оба способа</Button>
        <Button variant="secondary" :disabled="busy" @click="send('copy')">только копией</Button>
        <Button variant="secondary" :disabled="busy" @click="send('transfer')">
          только переносом
        </Button>
        <Button v-if="runs.length" variant="secondary" :disabled="busy" @click="runs = []">
          очистить
        </Button>
        <span v-if="busy" class="row__state">замер идёт…</span>
      </div>

      <div v-if="error" class="error">{{ error }}</div>

      <div class="scroll">
        <table class="grid">
          <thead>
            <tr>
              <th>размер</th>
              <th>способ</th>
              <th>внутри postMessage</th>
              <th>до ответа воркера</th>
              <th>byteLength у отправителя</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!runs.length">
              <td class="empty" colspan="5">
                нажмите «замерить» — числа снимутся в этой вкладке, а не приедут из таблицы
              </td>
            </tr>
            <tr v-for="run in runs" :key="run.id" :data-mode="run.mode">
              <td class="num">{{ run.mb }} МБ</td>
              <td>
                <span class="tag" :data-mode="run.mode">
                  {{ run.mode === 'copy' ? 'копия' : 'перенос' }}
                </span>
              </td>
              <td class="num">{{ ms(run.blocked) }} мс</td>
              <td class="num">{{ ms(run.trip) }} мс</td>
              <td class="num" :data-zero="run.left === 0 ? 'yes' : 'no'">{{ bytes(run.left) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="ratio" class="verdict">
        На {{ ratio.mb }} МБ копия обошлась примерно в {{ ratio.times }} раз дороже переноса — до
        ответа воркера. Байт при этом доехало поровну.
      </div>

      <div v-if="lastTransfer" class="own">
        <div class="t-label">что осталось у отправителя после переноса</div>
        <div class="own__grid">
          <div class="own__cell" data-tone="err">
            <span class="own__key">buffer.byteLength</span>
            <span class="own__val">{{ lastTransfer.left }}</span>
          </div>
          <div class="own__cell" data-tone="err">
            <span class="own__key">view[0]</span>
            <span class="own__val">{{ lastTransfer.probe }}</span>
          </div>
          <div class="own__cell" data-tone="ok">
            <span class="own__key">байт у воркера</span>
            <span class="own__val">{{ bytes(lastTransfer.got) }}</span>
          </div>
        </div>
        <p class="own__note">
          Буфер не опустел и не очистился — он <b>сменил владельца</b>. Данные целы, просто они
          теперь в чужой куче, а здесь осталась пустая оболочка. Чтение по индексу вернуло
          <code>undefined</code> и не бросило ничего: именно поэтому такая ошибка всплывает далеко
          от места, где её сделали.
        </p>
      </div>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="transfer-cost-foot" :text="props.foot" />
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
/* Ползунок целиком свой: у системного контрола свои цвета и свой шрифт, а в курсе
   ни того, ни другого нет. */
.bar__range {
  flex: 1 1 180px;
  min-width: 0;
  height: 4px;
  margin: 0;
  appearance: none;
  border-radius: var(--r-full);
  background: var(--surface-3);
  font: inherit;
  color: inherit;
}
.bar__range::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.bar__range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--accent);
  cursor: pointer;
}
.bar__value {
  min-width: 6ch;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  padding: 20px;
}
.row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.row__state {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--tone-warn-strong-2);
}

.error {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-err-bg);
  font-family: var(--mono);
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--tone-err-text);
}

/* Таблица прокручивается сама и не имеет права утащить вбок страницу. */
.scroll {
  min-width: 0;
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.grid {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
}
.grid th {
  padding: 9px 12px;
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-weight: 400;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  text-align: start;
}
.grid td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--rule);
  font-size: var(--fs-5);
  color: var(--ink);
}
.grid tbody tr:last-child td {
  border-bottom: 0;
}
.grid tbody tr[data-mode='transfer'] {
  background: var(--tone-ok-bg);
}
.num {
  font-family: var(--mono);
  font-size: var(--fs-3);
}
.num[data-zero='yes'] {
  color: var(--tone-err-strong);
}
.empty {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--dim);
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.tag[data-mode='copy'] {
  background: var(--tone-warn-chip);
  color: var(--tone-warn-strong);
}
.tag[data-mode='transfer'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}

.verdict {
  padding: 12px 14px;
  border-radius: var(--r2);
  background: var(--tone-info-bg);
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--tone-info-text);
}

.own {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.own__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr));
  gap: 8px;
}
.own__cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r2);
}
.own__cell[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
}
.own__cell[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.own__key {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.own__val {
  font-family: var(--mono);
  font-size: var(--fs-7);
}
.own__cell[data-tone='err'] .own__val {
  color: var(--tone-err-strong);
}
.own__cell[data-tone='ok'] .own__val {
  color: var(--tone-ok-strong);
}
.own__note {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.6;
  color: var(--prose);
}
.own__note b {
  color: var(--ink);
}

.transfer-cost-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
