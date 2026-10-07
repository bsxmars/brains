<script setup lang="ts">
/**
 * Песочница жизненного цикла порта: две «реальности» и труба между ними.
 *
 * В оригинале панель была одна, и из неё не читалось главное — что у канала два конца
 * в разных агентах. Здесь слева воркер со своим `port2`, справа главный поток со своим
 * `port1`, между ними труба. Видно сразу три вещи, которых на одной панели не видно:
 *
 *   буферизация до `start()` — сообщения копятся в очереди порта, а не теряются;
 *   доставка отдельной задачей — между «отправлено» и «пришло в onmessage» есть ступень
 *                                «задача в цикле», и она не проскакивается;
 *   мёртвый порт после transfer — объект остался у вас, но он пустой, и `postMessage`
 *                                 на нём молчит.
 *
 * Ступень «задача в цикле» не нарисована, а настоящая: виджет держит собственный
 * `MessageChannel` и гоняет доставку через него. То есть задержка между отправкой и
 * появлением строки в консоли — это ровно тот самый оборот цикла, про который урок.
 *
 * Свой канал виджет закрывает в `onBeforeUnmount` — ровно то, чего не делает утечка
 * из раздела «Тонкие места»: слушающий порт это GC-root.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ConsoleView from '@/shared/ui/ConsoleView.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import QueueView from '@/shared/ui/QueueView.vue';
import type { PortEvent, PortLines, PortTone } from '../model/types';

const props = defineProps<{ lines: PortLines }>();

const enabled = ref(false);
const closed = ref(false);
const detached = ref(false);
const seq = ref(0);

const buffer = ref<string[]>([]);
const inFlight = ref<string[]>([]);
const delivered = ref<string[]>([]);

const last = ref(props.lines.initial.text);
const lastTone = ref<PortTone | undefined>(props.lines.initial.tone);
const log = ref<{ text: string; tone?: PortTone }[]>([]);

/** Настоящий канал для настоящего оборота цикла. Создаётся только в браузере. */
let channel: MessageChannel | null = null;

onMounted(() => {
  if (typeof MessageChannel === 'undefined') return;
  channel = new MessageChannel();
  // Присваивание `onmessage` заводит порт неявно — тот самый побочный эффект из раздела 1.
  channel.port1.onmessage = flush;
});

onBeforeUnmount(() => {
  channel?.port1.close();
  channel?.port2.close();
  channel = null;
});

/** Отдать управление циклу: доставка обязана прийти следующей задачей, а не сразу. */
function hop() {
  if (channel) channel.port2.postMessage(0);
  else setTimeout(flush, 0);
}

function flush() {
  if (!inFlight.value.length) return;
  delivered.value = delivered.value.concat(inFlight.value);
  inFlight.value = [];
}

function say(event: PortEvent, msg?: string) {
  const line = props.lines[event];
  const text = msg ? line.text.replace('{msg}', msg) : line.text;
  last.value = text;
  lastTone.value = line.tone;
  log.value = [{ text, tone: line.tone }, ...log.value].slice(0, 8);
}

function post() {
  if (closed.value) return say('postClosed');
  seq.value += 1;
  const msg = `'msg-${seq.value}'`;
  if (enabled.value) {
    inFlight.value = [...inFlight.value, msg];
    hop();
    say('postEnabled', msg);
  } else {
    buffer.value = [...buffer.value, msg];
    say('postBuffered', msg);
  }
}

function listen() {
  if (closed.value) return say('listenClosed');
  say('listen');
}

function start() {
  if (closed.value) return say('startClosed');
  if (enabled.value) return say('startAgain');
  enabled.value = true;
  inFlight.value = [...inFlight.value, ...buffer.value];
  buffer.value = [];
  hop();
  say('startOk');
}

function transfer() {
  if (closed.value) return say('transferClosed');
  if (detached.value) return say('transferAgain');
  detached.value = true;
  say('transferOk');
}

function fromDetached() {
  if (!detached.value) return say('detachedIdle');
  say('detachedOk');
}

function close() {
  if (closed.value) return say('closeAgain');
  closed.value = true;
  enabled.value = false;
  buffer.value = [];
  inFlight.value = [];
  say('closeOk');
}

function reset() {
  enabled.value = false;
  closed.value = false;
  detached.value = false;
  seq.value = 0;
  buffer.value = [];
  inFlight.value = [];
  delivered.value = [];
  log.value = [];
  last.value = props.lines.initial.text;
  lastTone.value = props.lines.initial.tone;
}

const actions = [
  { label: 'port2.postMessage()', kind: 'ink', run: post },
  { label: 'addEventListener', kind: 'warn', run: listen },
  { label: 'port1.start()', kind: 'ink', run: start },
  { label: 'transfer port1', kind: 'warn', run: transfer },
  { label: 'postMessage из detached', kind: 'err', run: fromDetached },
  { label: 'port1.close()', kind: 'err', run: close },
  { label: 'сброс', kind: 'ghost', run: reset },
] as const;

const flags = computed(() => [
  {
    t: closed.value ? 'closed' : enabled.value ? 'enabled' : 'disabled',
    state: closed.value ? 'bad' : 'on',
  },
  { t: 'detached', state: detached.value ? 'bad' : 'off' },
  { t: enabled.value ? 'очередь работает' : 'очередь буферизует', state: 'on' },
]);

const deliveredLines = computed(() => delivered.value.map((msg) => `got ${msg}`));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="acts">
        <button
          v-for="action in actions"
          :key="action.label"
          type="button"
          class="act"
          :data-kind="action.kind"
          @click="action.run"
        >
          {{ action.label }}
        </button>
      </div>
    </template>

    <div class="realms">
      <div class="realm">
        <div class="t-label">воркер · держит port2</div>
        <div class="port" data-state="live">port2</div>
        <p class="hint">
          Отсюда шлют. Сцепка симметрична: «сервера» и «клиента» у канала нет, просто у этой
          стороны очередь никому не нужна.
        </p>
        <div v-if="detached" class="port port--moved">port1 — теперь здесь</div>
      </div>

      <div class="pipe" :data-state="closed ? 'cut' : 'live'">
        <span class="pipe__label">{{ closed ? 'расцеплено' : 'entangled pair' }}</span>
        <span class="pipe__line"></span>
        <span class="pipe__arrow">→</span>
      </div>

      <div class="realm realm--main">
        <div class="t-label">главный поток · держит port1</div>

        <div class="flags">
          <span v-for="flag in flags" :key="flag.t" class="flag" :data-state="flag.state">
            {{ flag.t }}
          </span>
        </div>

        <QueueView
          :items="buffer"
          label="port message queue"
          tone="warn"
          :min-height="62"
          empty-label="пусто"
        />
        <QueueView
          :items="inFlight"
          label="задача в цикле главного потока"
          tone="neutral"
          layout="row"
          :min-height="34"
          empty-label="задач нет"
        />
        <ConsoleView
          :lines="deliveredLines"
          label="доставлено в onmessage"
          :min-height="70"
          empty-label="ничего не пришло"
        />
      </div>
    </div>

    <template #footer>
      <div class="port-lifecycle-foot">
        <div class="last" :data-tone="lastTone ?? 'info'">{{ last }}</div>
        <div class="log">
          <div class="t-label">журнал</div>
          <div class="log__lines">
            <div
              v-for="(line, i) in log"
              :key="i"
              class="log__line"
              :data-tone="line.tone ?? 'none'"
            >
              {{ line.text }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.acts {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
/* Кнопки действий — настоящие `button`, как в оригинале: это команды, а не выбор из списка. */
.act {
  padding: 7px 12px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  cursor: pointer;
  transition: all 0.15s;
}
.act[data-kind='ink'] {
  border: 1px solid var(--ink);
  background: var(--ink);
  color: var(--on-ink);
}
.act[data-kind='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}
.act[data-kind='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-strong);
}
.act[data-kind='ghost'] {
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-faint);
}

.realms {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.25fr);
  align-items: stretch;
}
.realm {
  display: flex;
  flex-direction: column;
  gap: 13px;
  padding: 20px;
}
.realm--main {
  background: var(--surface-2);
}

.port {
  align-self: flex-start;
  padding: 9px 13px;
  border-radius: var(--r2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  transition: all 0.2s;
}
.port[data-state='live'] {
  border: 1px solid var(--ink);
  background: var(--surface);
  color: var(--ink);
}
/* Порт уехал: объект у вас остался, а конец канала — уже нет. */
.port--moved {
  border: 1px dashed var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-strong);
}

.hint {
  margin: 0;
  font-size: var(--fs-6);
  line-height: 1.55;
  color: var(--prose);
}

/* Труба: линия между двумя агентами. Расцеплённая — пунктир. */
.pipe {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px 14px;
  border-inline: 1px solid var(--divider);
}
.pipe__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
}
.pipe__line {
  width: 100%;
  min-width: 34px;
  height: 0;
  border-top: 2px solid currentcolor;
}
.pipe__arrow {
  font-family: var(--mono);
  font-size: var(--fs-4);
}
.pipe[data-state='live'] {
  color: var(--accent);
}
.pipe[data-state='cut'] {
  color: var(--tone-err-strong);
}
.pipe[data-state='cut'] .pipe__line {
  border-top-style: dashed;
}

.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.flag {
  padding: 5px 10px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
  transition: all 0.2s;
}
.flag[data-state='on'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
  font-weight: 600;
}
.flag[data-state='bad'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
  font-weight: 600;
}
.flag[data-state='off'] {
  background: var(--surface-3);
  color: var(--dim);
}

.port-lifecycle-foot {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.last {
  padding: 13px 15px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.55;
  transition: all 0.2s;
}
.last[data-tone='info'] {
  border: 1px solid var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.last[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.last[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.last[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.log {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.log__lines {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 150px;
  overflow-y: auto;
}
.log__line {
  padding: 6px 9px;
  border-radius: var(--r1);
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.45;
}
.log__line[data-tone='none'] {
  border: 1px solid var(--divider);
  background: var(--surface);
  color: var(--text-muted);
}
.log__line[data-tone='ok'] {
  border: 1px solid var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.log__line[data-tone='warn'] {
  border: 1px solid var(--tone-warn-line);
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.log__line[data-tone='err'] {
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

@media (max-width: 760px) {
  .realms {
    grid-template-columns: 1fr;
  }
  .pipe {
    flex-direction: row;
    padding: 12px 20px;
    border-inline: 0;
    border-block: 1px solid var(--divider);
  }
  .pipe__line {
    min-width: 0;
  }
}
</style>
