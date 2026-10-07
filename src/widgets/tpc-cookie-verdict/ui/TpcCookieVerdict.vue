<script setup lang="ts">
/**
 * Калькулятор «уйдёт ли кука»: атрибуты куки и контекст запроса → решение в четырёх режимах
 * движков и ключ раздела.
 *
 * Решает функция `decide` из `../model/verdict` — та же, что прогоняет
 * `tests/unit/third-party-cookies.test.ts` по таблице стенда. Таблица приходит пропом
 * `measured`: если выбранная комбинация в ней есть, демо рядом с вычисленным показывает
 * снятое и считает совпадения само, а не печатает «совпало» заготовкой.
 *
 * Почему не настоящий фрейм: страница курса и любой учебный фрейм на ней — один сайт, и браузер
 * читателя отдаст фрейму все куки. Сторонний контекст на одном сайте не воспроизводится.
 *
 * Вычисление — после `onMounted`: до гидратации остров честно говорит, что считать пока нечем.
 * В сеть демо не ходит.
 */
import { computed, onMounted, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { ENGINES, decide, sameCase, setCookieLine } from '../model/verdict';
import type { CookieSpec, Kind, MeasuredRow, Outcome, RequestSpec, SameSite, SetIn, Target, TopSite } from '../model/verdict';

const props = defineProps<{
  measured: MeasuredRow[];
  outcomeLabel: Record<Outcome, string>;
}>();

const SAME_SITE = [
  { value: 'None', label: 'None' },
  { value: 'Lax', label: 'Lax' },
  { value: 'Strict', label: 'Strict' },
  { value: 'unset', label: 'не указан' },
];
const YES_NO = [
  { value: 'yes', label: 'да' },
  { value: 'no', label: 'нет' },
];
const DOMAIN = [
  { value: 'host', label: 'без Domain' },
  { value: 'site', label: 'Domain=embed.test' },
];
const SET_IN = [
  { value: 'first-party', label: 'на самом embed.test' },
  { value: 'top.test', label: 'во фрейме под top.test' },
  { value: 'top2.test', label: 'во фрейме под top2.test' },
];
const TOP = [
  { value: 'top.test', label: 'top.test' },
  { value: 'top2.test', label: 'top2.test' },
  { value: 'www.embed.test', label: 'www.embed.test' },
];
const TARGET = [
  { value: 'embed.test', label: 'embed.test' },
  { value: 'api.embed.test', label: 'api.embed.test' },
];
const KIND = [
  { value: 'iframe', label: 'фрейм' },
  { value: 'subresource', label: '<img> / fetch страницы' },
  { value: 'navigation', label: 'переход по ссылке' },
];
const GROUPS = [
  { value: 'state', label: 'сторонние куки' },
  { value: 'chips', label: 'Partitioned' },
  { value: 'attrs', label: 'атрибуты' },
  { value: 'saa', label: 'Storage Access' },
];

const sameSite = ref('None');
const secure = ref('yes');
const partitioned = ref('no');
const domain = ref('host');
const setIn = ref('first-party');
const top = ref('top.test');
const target = ref('embed.test');
const kind = ref('iframe');
const storageAccess = ref('no');
const group = ref('state');
const active = ref<string | null>(null);
const ready = ref(false);

onMounted(() => {
  ready.value = true;
});

const cookie = computed<CookieSpec>(() => ({
  sameSite: sameSite.value as SameSite,
  secure: secure.value === 'yes',
  partitioned: partitioned.value === 'yes',
  domain: domain.value as CookieSpec['domain'],
  setIn: setIn.value as SetIn,
}));
const request = computed<RequestSpec>(() => ({
  top: top.value as TopSite,
  target: target.value as Target,
  kind: kind.value as Kind,
  storageAccess: storageAccess.value === 'yes',
}));

const verdicts = computed(() =>
  ready.value ? ENGINES.map((engine) => ({ engine, verdict: decide(engine.id, cookie.value, request.value) })) : [],
);

const match = computed(() => props.measured.find((row) => sameCase(row, { cookie: cookie.value, request: request.value })) ?? null);
const agree = computed(() =>
  match.value ? verdicts.value.filter(({ engine, verdict }) => match.value!.got[engine.id] === verdict.outcome).length : 0,
);

const presets = computed(() => props.measured.filter((row) => row.group === group.value));

const wire = computed(() => {
  const where = setIn.value === 'first-party' ? 'ответ embed.test на его же странице' : `ответ embed.test во фрейме под ${setIn.value}`;
  const how =
    kind.value === 'navigation'
      ? `переход по ссылке со страницы ${top.value} на ${target.value}`
      : kind.value === 'iframe'
        ? `фрейм ${target.value} на странице ${top.value}`
        : `<img> или fetch со страницы ${top.value} на ${target.value}`;
  const lines = [`// ${where}`, setCookieLine(cookie.value), '', `// запрос: ${how}`];
  if (storageAccess.value === 'yes') lines.push('// до запроса фрейм получил доступ: requestStorageAccess()');
  return lines.join('\n');
});

function applyPreset(row: MeasuredRow) {
  sameSite.value = row.cookie.sameSite;
  secure.value = row.cookie.secure ? 'yes' : 'no';
  partitioned.value = row.cookie.partitioned ? 'yes' : 'no';
  domain.value = row.cookie.domain;
  setIn.value = row.cookie.setIn;
  top.value = row.request.top;
  target.value = row.request.target;
  kind.value = row.request.kind;
  storageAccess.value = row.request.storageAccess ? 'yes' : 'no';
  active.value = row.id;
}

function touch() {
  active.value = null;
}

const tone = (o: Outcome) => (o === 'sent' ? 'ok' : o === 'blocked' ? 'warn' : 'err');
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="tpc-controls">
        <span class="t-eyebrow">кука embed.test</span>
        <div class="tpc-row">
          <div class="tpc-control">
            <span class="t-label">SameSite</span>
            <SegmentedControl v-model="sameSite" class="l-pills" label="SameSite" :options="SAME_SITE" @update:model-value="touch" />
          </div>
          <div class="tpc-control">
            <span class="t-label">Secure</span>
            <SegmentedControl v-model="secure" class="l-pills" label="Secure" :options="YES_NO" @update:model-value="touch" />
          </div>
          <div class="tpc-control">
            <span class="t-label">Partitioned</span>
            <SegmentedControl v-model="partitioned" class="l-pills" label="Partitioned" :options="YES_NO" @update:model-value="touch" />
          </div>
          <div class="tpc-control">
            <span class="t-label">Domain</span>
            <SegmentedControl v-model="domain" class="l-pills" label="Domain" :options="DOMAIN" @update:model-value="touch" />
          </div>
        </div>
        <div class="tpc-control">
          <span class="t-label">где поставлена</span>
          <SegmentedControl v-model="setIn" class="l-pills" label="Где поставлена кука" :options="SET_IN" @update:model-value="touch" />
        </div>

        <span class="t-eyebrow">запрос</span>
        <div class="tpc-row">
          <div class="tpc-control">
            <span class="t-label">сайт наверху</span>
            <SegmentedControl v-model="top" class="l-pills" label="Сайт верхнего уровня" :options="TOP" @update:model-value="touch" />
          </div>
          <div class="tpc-control">
            <span class="t-label">адрес запроса</span>
            <SegmentedControl v-model="target" class="l-pills" label="Адрес запроса" :options="TARGET" @update:model-value="touch" />
          </div>
        </div>
        <div class="tpc-row">
          <div class="tpc-control">
            <span class="t-label">какой запрос</span>
            <SegmentedControl v-model="kind" class="l-pills" label="Тип запроса" :options="KIND" @update:model-value="touch" />
          </div>
          <div class="tpc-control">
            <span class="t-label">Storage Access</span>
            <SegmentedControl v-model="storageAccess" class="l-pills" label="Фрейм получил доступ" :options="YES_NO" @update:model-value="touch" />
          </div>
        </div>
      </div>
    </template>

    <div class="tpc-body">
      <div class="tpc-block">
        <span class="t-label">снято на стенде — нажмите, чтобы подставить</span>
        <SegmentedControl v-model="group" class="l-pills" label="Группа случаев" :options="GROUPS" />
        <div class="tpc-presets">
          <button
            v-for="row in presets"
            :key="row.id"
            type="button"
            class="tpc-preset"
            :aria-pressed="active === row.id"
            @click="applyPreset(row)"
          >
            <Md as="span" :text="`${row.cookieLabel} → ${row.requestLabel}`" />
          </button>
        </div>
      </div>

      <pre class="tpc-wire" data-code>{{ wire }}</pre>

      <div v-if="!ready" class="tpc-verdict" data-tone="idle">
        <span class="tpc-verdict__head">Считать пока нечем</span>
        <span class="tpc-verdict__sub">Решения появятся, когда демо оживёт: их вычисляет функция, а не заготовка.</span>
      </div>
      <div v-else class="tpc-grid">
        <div v-for="{ engine, verdict } in verdicts" :key="engine.id" class="tpc-verdict" :data-tone="tone(verdict.outcome)">
          <span class="tpc-verdict__engine">{{ engine.label }}</span>
          <span class="tpc-verdict__head">{{ outcomeLabel[verdict.outcome] }}</span>
          <span class="tpc-verdict__key" data-code>
            раздел: {{ verdict.outcome === 'rejected' ? '—' : (verdict.partitionKey ?? 'нет, кука общая') }}
          </span>
          <ol class="tpc-steps">
            <li v-for="(step, i) in verdict.steps" :key="i"><Md as="span" :text="step" /></li>
          </ol>
          <span v-if="match" class="tpc-verdict__stand">
            стенд: {{ outcomeLabel[match.got[engine.id]] }}
          </span>
        </div>
      </div>

      <div v-if="ready && match" class="tpc-match" :data-tone="agree === verdicts.length ? 'ok' : 'err'">
        Эта комбинация снята на стенде: модель совпала с браузером в {{ agree }} из {{ verdicts.length }}.
      </div>
      <div v-else-if="ready" class="tpc-match" data-tone="idle">
        Такой комбинации на стенде не было — ответ модели, собранной из соседних снятых случаев.
      </div>
    </div>
  </DemoFrame>
</template>

<style scoped>
.tpc-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tpc-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
}
.tpc-control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tpc-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 22px 20px;
}
.tpc-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tpc-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tpc-preset {
  font: inherit;
  font-size: var(--fs-3);
  line-height: 1.4;
  color: var(--prose);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--r1);
  padding: 6px 10px;
  cursor: pointer;
  text-align: start;
}
.tpc-preset:hover {
  border-color: var(--tone-info-line);
}
.tpc-preset[aria-pressed='true'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--ink);
}

.tpc-wire {
  margin: 0;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--code-fg);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}

.tpc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: 12px;
}

.tpc-verdict {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r2);
  border: 1px solid var(--border);
  background: var(--surface-2);
  min-width: 0;
}
.tpc-verdict[data-tone='ok'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.tpc-verdict[data-tone='warn'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.tpc-verdict[data-tone='err'] {
  border-color: var(--tone-err-line);
  background: var(--tone-err-bg);
}
.tpc-verdict__engine {
  font-size: var(--fs-3);
  font-weight: 600;
  color: var(--text-muted);
}
.tpc-verdict__head {
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.tpc-verdict[data-tone='ok'] .tpc-verdict__head {
  color: var(--tone-ok-strong);
}
.tpc-verdict[data-tone='warn'] .tpc-verdict__head {
  color: var(--tone-warn-strong);
}
.tpc-verdict[data-tone='err'] .tpc-verdict__head {
  color: var(--tone-err-strong);
}
.tpc-verdict__sub {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}
.tpc-verdict__key,
.tpc-verdict__stand {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.tpc-steps {
  margin: 0;
  padding-inline-start: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--prose);
}

.tpc-match {
  font-size: var(--fs-4);
  line-height: 1.55;
  color: var(--text-muted);
  padding: 10px 14px;
  border-radius: var(--r1);
  background: var(--surface-2);
}
.tpc-match[data-tone='ok'] {
  color: var(--tone-ok-text);
  background: var(--tone-ok-bg);
}
.tpc-match[data-tone='err'] {
  color: var(--tone-err-text);
  background: var(--tone-err-bg);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.tpc-preset :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
