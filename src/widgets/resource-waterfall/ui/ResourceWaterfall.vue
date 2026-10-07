<script setup lang="ts">
/**
 * Водопад загрузки — этой самой страницы, в браузере читателя.
 *
 * Все остальные демо курса показывают замер автора: он снял числа, положил их в `data.ts`,
 * читатель смотрит на чужой результат. Здесь наоборот — числа получаются у читателя, и это
 * не приём подачи, а единственный честный способ говорить про сеть. Сеть у каждого своя:
 * RTT до сервера, версия протокола, состояние кеша, наличие прокси. Автор не может снять
 * это за читателя, а браузер сообщает всё сам — через Resource Timing.
 *
 * Что рисуется. Полоска каждого ресурса разрезана на четыре фазы холодного запроса: DNS,
 * соединение вместе с TLS, ожидание ответа (TTFB) и передача тела. Именно в таком порядке
 * они и складываются в RTT-бюджет из первого раздела: три фазы до первого байта — это цена
 * нового origin, и видно её только так.
 *
 * Отдельно помечено то, ради чего написан весь раздел про кеширование: **ресурсы, которые
 * не поехали по сети вовсе**. Признак измеримый — `transferSize === 0` при ненулевом
 * `decodedBodySize`. У ответа `304` он не срабатывает, и правильно: там заголовки по проводу
 * проехали, RTT заплачен.
 *
 * ⚠️ Остров читает `performance` только после монтирования: в Node этого объекта нет вовсе,
 * а до гидратации на странице лежит серверная разметка с пустым состоянием.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { linear, niceTicks } from '@/shared/lib/chart';
import ChartFrame from '@/shared/ui/ChartFrame.vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { Button, SegmentedControl } from '@/shared/ui';
import type { WaterfallRow } from '../model/types';

const props = withDefaults(defineProps<{ limit?: number }>(), { limit: 20 });

const WIDTH = 760;
const ROW_H = 24;
const BAR = 13;
const PAD = { top: 16, right: 30, bottom: 34, left: 176 };
const PLOT_W = WIDTH - PAD.left - PAD.right;

const rows = ref<WaterfallRow[]>([]);
const scope = ref<string>('all');
const mounted = ref(false);

const options = [
  { value: 'all', label: 'все ресурсы' },
  { value: 'critical', label: 'только критичные' },
];

/** Критичные — то, что участвует в первом кадре: документ, стили, шрифты, скрипты. */
const CRITICAL = new Set(['navigation', 'link', 'script', 'css']);

function shortName(url: string): string {
  try {
    const parsed = new URL(url, location.href);
    const file = parsed.pathname.split('/').filter(Boolean).pop() ?? parsed.hostname;
    const label = parsed.origin === location.origin ? file : `${parsed.hostname}/${file}`;
    return label.length > 26 ? `${label.slice(0, 24)}…` : label;
  } catch {
    return url.slice(0, 26);
  }
}

function toRow(entry: PerformanceResourceTiming, i: number): WaterfallRow {
  const cached = entry.transferSize === 0 && entry.decodedBodySize > 0;
  // Кросс-доменный ресурс без `Timing-Allow-Origin` отдаёт нули во всех фазах. Ноль там
  // означает «не покажу», а не «мгновенно», — и рисовать его как мгновенный было бы враньём.
  const opaque = entry.responseStart === 0 && !cached;

  return {
    key: `${entry.name}#${i}`,
    name: shortName(entry.name),
    full: entry.name,
    kind: entry.initiatorType || 'other',
    start: entry.startTime,
    dns: Math.max(0, entry.domainLookupEnd - entry.domainLookupStart),
    connect: Math.max(0, entry.connectEnd - entry.connectStart),
    wait: Math.max(0, entry.responseStart - entry.requestStart),
    transfer: Math.max(0, entry.responseEnd - entry.responseStart),
    end: entry.responseEnd,
    cached,
    protocol: entry.nextHopProtocol ?? '',
    transferSize: entry.transferSize,
    decodedBodySize: entry.decodedBodySize,
    opaque,
  };
}

function collect() {
  if (typeof performance === 'undefined') return;

  const navigation = performance.getEntriesByType('navigation') as PerformanceResourceTiming[];
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];

  rows.value = [...navigation, ...resources]
    .map(toRow)
    .sort((a, b) => a.start - b.start)
    .slice(0, props.limit);
}

let observer: PerformanceObserver | null = null;

onMounted(() => {
  mounted.value = true;
  collect();

  // Ресурсы догружаются и после монтирования: шрифт, картинка, соседний остров. Снимок,
  // сделанный один раз, показал бы неполную картину — поэтому подписываемся на новые записи.
  if (typeof PerformanceObserver !== 'undefined') {
    observer = new PerformanceObserver(() => collect());
    observer.observe({ type: 'resource', buffered: true });
  }
});

onBeforeUnmount(() => observer?.disconnect());

const visible = computed(() =>
  scope.value === 'critical' ? rows.value.filter((r) => CRITICAL.has(r.kind)) : rows.value,
);

const chartHeight = computed(() => PAD.top + PAD.bottom + Math.max(1, visible.value.length) * ROW_H);
const plotHeight = computed(() => chartHeight.value - PAD.top - PAD.bottom);

/** Верх шкалы — конец самого позднего ресурса, с небольшим запасом. */
const maxMs = computed(() => {
  const end = Math.max(1, ...visible.value.map((r) => r.end));
  return end * 1.04;
});

const x = computed(() => linear([0, maxMs.value], [0, PLOT_W]));

/**
 * Куда поставить подпись: справа от полосы или слева от её конца.
 *
 * Ширина считается прикидкой по числу знаков: шрифт моноширинный, и на ступени `--fs-1`
 * знак занимает около 5.2px. Точный `getComputedTextLength()` здесь не нужен и вреден —
 * он заставил бы читать геометрию сразу после записи, то есть делать в демо ровно то,
 * от чего предостерегает соседняя тема про кадр браузера.
 *
 * ⚠️ Первая версия этой правки ставила подпись **внутрь** полосы и красила её в цвет текста
 * на заливке. На скриншоте стало видно, почему так нельзя: полоса у последних ресурсов
 * шириной в пару пикселей — светлый текст ложился на пустой фон и пропадал совсем.
 * Поэтому подпись уходит влево **от** конца полосы, оставаясь обычным цветом: место для неё
 * всегда есть — слева лежит пустая часть шкалы, которую ресурс ещё не занял.
 */
const CHAR_W = 5.2;
const TAG_GAP = 6;

function tagWidth(row: WaterfallRow): number {
  const text = `${Math.round(row.end - row.start)} мс${row.protocol ? ` · ${row.protocol}` : ''}`;
  return text.length * CHAR_W;
}

function tagFits(row: WaterfallRow): boolean {
  return x.value(row.end) + TAG_GAP + tagWidth(row) <= PLOT_W;
}

const xTicks = computed(() =>
  niceTicks([0, maxMs.value], 5)
    .filter((t) => t <= maxMs.value)
    .map((t) => ({ at: x.value(t), label: String(Math.round(t)) })),
);

const yTicks = computed(() =>
  visible.value.map((row, i) => ({ at: i * ROW_H + ROW_H / 2, label: row.name })),
);

/** Четыре фазы подряд: полоска и есть их сумма. */
function segmentsOf(row: WaterfallRow) {
  const parts = [
    { key: 'dns', ms: row.dns },
    { key: 'connect', ms: row.connect },
    { key: 'wait', ms: row.wait },
    { key: 'transfer', ms: row.transfer },
  ];

  let at = row.start;
  return parts
    .filter((part) => part.ms > 0)
    .map((part) => {
      const from = at;
      at += part.ms;
      return {
        ...part,
        x: x.value(from),
        width: Math.max(1, x.value(at) - x.value(from)),
      };
    });
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} КБ`;

const stats = computed(() => {
  const list = visible.value;
  const cached = list.filter((r) => r.cached).length;
  const transferred = list.reduce((sum, r) => sum + r.transferSize, 0);
  const decoded = list.reduce((sum, r) => sum + r.decodedBodySize, 0);
  const protocols = [...new Set(list.map((r) => r.protocol).filter(Boolean))];
  return { total: list.length, cached, transferred, decoded, protocols };
});

const reload = () => {
  if (typeof location !== 'undefined') location.reload();
};
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <span class="t-label">замер вашего браузера · эта страница</span>
        <div class="controls">
          <SegmentedControl
            v-model="scope"
            class="l-pills"
            label="Какие ресурсы показывать"
            :options="options"
          />
          <Button variant="secondary" @click="reload">перезагрузить и снять заново</Button>
        </div>
      </div>
    </template>

    <div class="body">
      <div v-if="!mounted" class="empty">Снимаем тайминги этой страницы…</div>

      <template v-else-if="visible.length">
        <div class="stats">
          <span class="stat"><b>{{ stats.total }}</b> ресурсов</span>
          <span class="stat stat--ok"><b>{{ stats.cached }}</b> из кеша, без сети</span>
          <span class="stat">по проводу <b>{{ kb(stats.transferred) }}</b></span>
          <span class="stat">после распаковки <b>{{ kb(stats.decoded) }}</b></span>
          <span v-if="stats.protocols.length" class="stat">
            протокол <b>{{ stats.protocols.join(', ') }}</b>
          </span>
        </div>

        <ChartFrame
          :key="chartHeight"
          :width="WIDTH"
          :height="chartHeight"
          :pad="PAD"
          :x-ticks="xTicks"
          :y-ticks="yTicks"
          x-label="мс от начала навигации"
        >
          <g v-for="(row, i) in visible" :key="row.key">
            <rect
              v-for="segment in segmentsOf(row)"
              :key="segment.key"
              class="segment"
              :data-part="segment.key"
              :x="segment.x"
              :y="i * ROW_H + (ROW_H - BAR) / 2"
              :width="segment.width"
              :height="BAR"
            />

            <!-- Ресурс, которого не было в сети: рисовать нечего, поэтому засечка и подпись. -->
            <g v-if="row.cached">
              <rect
                class="cached-mark"
                :x="x(row.start)"
                :y="i * ROW_H + (ROW_H - BAR) / 2"
                width="3"
                :height="BAR"
              />
              <text
                class="tag tag--ok"
                :x="x(row.start) + 8"
                :y="i * ROW_H + ROW_H / 2"
                dominant-baseline="middle"
              >
                из кеша · 0 RTT
              </text>
            </g>

            <text
              v-else-if="row.opaque"
              class="tag tag--dim"
              :x="x(row.start) + 6"
              :y="i * ROW_H + ROW_H / 2"
              dominant-baseline="middle"
            >
              тайминги скрыты — нет Timing-Allow-Origin
            </text>

            <!--
              Подпись уходит внутрь полосы, когда снаружи ей места нет.

              Ресурс, пришедший последним, заканчивается у самого края шкалы, а правое поле —
              30px: подпись «8 мс · http/1.1» там не помещается и обрывается на полуслове.
              Тесты этого не видят — страницу вбок не тащит, разметка верна, — зато видно
              глазами на первом же скриншоте. Поэтому ширина прикидывается по числу символов
              (моно-шрифт, ~5.2px на знак), и если не влезает, подпись встаёт слева от конца
              полосы и прижимается к нему.
            -->
            <text
              v-else
              class="tag"
              :class="{ 'tag--inside': !tagFits(row) }"
              :x="tagFits(row) ? x(row.end) + 6 : x(row.end) - 6"
              :text-anchor="tagFits(row) ? 'start' : 'end'"
              :y="i * ROW_H + ROW_H / 2"
              dominant-baseline="middle"
            >
              {{ Math.round(row.end - row.start) }} мс
              <template v-if="row.protocol">· {{ row.protocol }}</template>
            </text>
          </g>

          <line class="edge" x1="0" :y1="plotHeight" :x2="PLOT_W" :y2="plotHeight" />
        </ChartFrame>

        <div class="legend">
          <span class="legend__item"><i data-part="dns"></i>DNS</span>
          <span class="legend__item"><i data-part="connect"></i>соединение + TLS</span>
          <span class="legend__item"><i data-part="wait"></i>ожидание ответа (TTFB)</span>
          <span class="legend__item"><i data-part="transfer"></i>передача</span>
        </div>
      </template>

      <div v-else class="empty">
        В этой выборке ресурсов нет — попробуйте переключить на «все ресурсы».
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Это не замер автора, а ваш собственный: числа сняты
        <code>performance.getEntriesByType('resource')</code> и
        <code>PerformanceNavigationTiming</code> прямо на этой странице. Поэтому они и не совпадут
        с чужими — у вас свой RTT до сервера, своя версия протокола и своё состояние кеша.
        Нажмите «перезагрузить и снять заново»: на втором заходе почти всё уедет в «из кеша»,
        а фазы DNS и соединения исчезнут — соединение уже установлено. У кросс-доменных ресурсов
        фазы обнулены намеренно: без заголовка <code>Timing-Allow-Origin</code> браузер не
        показывает чужие тайминги.
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
.controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.stat b {
  font-weight: 600;
  color: var(--ink);
}
.stat--ok b {
  color: var(--tone-ok-strong);
}

.segment[data-part='dns'] {
  fill: var(--bar-neutral);
}
.segment[data-part='connect'] {
  fill: var(--bar-violet);
}
.segment[data-part='wait'] {
  fill: var(--bar-amber);
}
.segment[data-part='transfer'] {
  fill: var(--bar-green);
}

.cached-mark {
  fill: var(--tone-ok-strong);
}
.edge {
  stroke: var(--border-strong);
  stroke-width: 1;
}

.tag {
  fill: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--fs-1);
}
.tag--ok {
  fill: var(--tone-ok-strong);
}
/* Подпись, отброшенная влево от конца полосы, лежит на пустой шкале — цвет тот же. */
.tag--inside {
  fill: var(--text-faint);
}
.tag--dim {
  fill: var(--ghost);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.legend__item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.legend__item i {
  width: 14px;
  height: 10px;
  border-radius: 2px;
}
.legend__item i[data-part='dns'] {
  background: var(--bar-neutral);
}
.legend__item i[data-part='connect'] {
  background: var(--bar-violet);
}
.legend__item i[data-part='wait'] {
  background: var(--bar-amber);
}
.legend__item i[data-part='transfer'] {
  background: var(--bar-green);
}

.empty {
  padding: 18px 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--dim);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
