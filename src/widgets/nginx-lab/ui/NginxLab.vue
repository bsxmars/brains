<script setup lang="ts">
/**
 * «Куда уйдёт запрос»: адрес → шаги выбора location → путь, который увидит бэкенд,
 * и рядом — что на этот адрес ответил настоящий nginx 1.30 на стенде.
 *
 * Выбор считает не компонент, а строки `LOCATION_CODE` и `PROXY_CODE` из темы, собранные
 * `new Function` (`model/run.ts`). Те же строки напечатаны на странице и прогоняются
 * `tests/unit/nginx-proxy.test.ts` по журналам стенда. Компонент только раскладывает
 * ответ модели по шагам и подсвечивает строки конфига.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { loadLocationApi } from '../model/run';
import type { FoundLocation, Location, LocationProbe, ProbeGroup } from '../model/types';

const props = defineProps<{
  locationCode: string;
  proxyCode: string;
  /** Конфиг, из которого модель берёт location. */
  conf: string;
  /** Журналы стенда: ответы настоящего nginx. */
  journal: LocationProbe[];
  groups: ProbeGroup[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadLocationApi(props.locationCode, props.proxyCode);
const locs = api.parseLocations(props.conf);

const groupId = ref(props.groups[0].id);
const groupOptions = props.groups.map((g) => ({ value: g.id, label: g.label }));
const group = computed(() => props.groups.find((g) => g.id === groupId.value) ?? props.groups[0]);

const uri = ref(props.groups[0].uris[2] ?? props.groups[0].uris[0]);
const draft = ref(uri.value);
const draftError = ref('');

function pick(u: string) {
  uri.value = u;
  draft.value = u;
  draftError.value = '';
}
function onGroup(id: string | number) {
  groupId.value = String(id);
  const g = props.groups.find((x) => x.id === groupId.value);
  if (g) pick(g.uris[0]);
}
function applyDraft() {
  const v = draft.value.trim();
  if (!v.startsWith('/')) {
    draftError.value = 'Адрес начинается с `/`: например, `/api/users`.';
    return;
  }
  draftError.value = '';
  uri.value = v;
}

const found = computed<FoundLocation>(() => api.findLocation(locs, uri.value));
const backendPath = computed(() => api.proxyPath(found.value, uri.value));
const probe = computed(() => props.journal.find((p) => p.uri === uri.value) ?? null);

const c = (s: string) => '`' + s + '`';

interface Step {
  k: string;
  d: string;
  state: 'hit' | 'miss' | 'skip';
}

const steps = computed<Step[]>(() => {
  const f = found.value;
  const out: Step[] = [];
  const rawPath = uri.value.split('?')[0];
  out.push({
    k: 'нормализация',
    d:
      `Путь для сравнения: ${c(f.path)}` +
      (f.args !== null ? `, аргументы ${c(f.args)} в выборе не участвуют` : '') +
      (f.path !== rawPath ? `. Клиент прислал ${c(rawPath)} — nginx раскрыл и разобрал его.` : '.'),
    state: 'skip',
  });
  if (f.by === 'exact' && f.exact) {
    out.push({ k: '1. точное «=»', d: `${c(f.exact.text)} совпало целиком — ответ найден, дальше nginx не смотрит.`, state: 'hit' });
    return out;
  }
  out.push({ k: '1. точное «=»', d: 'Точного совпадения нет.', state: 'miss' });
  out.push({
    k: '2. префиксы',
    d: f.prefixes.length
      ? `Подошли ${f.prefixes.map((l) => c(l.text)).join(', ')}. Самый длинный — ${c(f.longest?.text ?? '')}, он запомнен.`
      : 'Ни один префикс не подошёл.',
    state: f.prefixes.length ? 'hit' : 'miss',
  });
  if (f.by === 'redirect' && f.location) {
    out.push({
      k: '301',
      d: `Путь — это ${c(f.location.path)} без последнего слеша, а внутри ${c('proxy_pass')}. nginx не идёт дальше и отвечает 301 на ${c(f.redirect ?? '')}.`,
      state: 'hit',
    });
    return out;
  }
  if (f.by === '^~' && f.longest) {
    out.push({ k: '3. «^~»', d: `У ${c(f.longest.text)} стоит ${c('^~')} — регулярки не проверяются, ответ найден.`, state: 'hit' });
    return out;
  }
  out.push({
    k: '3. «^~»',
    d: f.longest ? `У ${c(f.longest.text)} нет ${c('^~')} — проверяем регулярки.` : 'Запомненного префикса нет — проверяем регулярки.',
    state: 'miss',
  });
  out.push({
    k: '4. регулярки',
    d: f.regexes.length
      ? f.regexes.map((r) => `${c(r.location.text)} — ${r.hit ? '**да**, стоп' : 'нет'}`).join('; ') + '.'
      : 'Регулярок в конфиге нет.',
    state: f.by === 'regex' ? 'hit' : 'miss',
  });
  if (f.by === 'prefix' && f.longest) {
    out.push({ k: '5. префикс', d: `Ни одна регулярка не совпала — отвечает ${c(f.longest.text)}.`, state: 'hit' });
  } else if (f.by === 'none') {
    out.push({ k: '5. итог', d: 'Ни одной location — nginx ответит 404.', state: 'miss' });
  }
  return out;
});

const passLine = computed(() => {
  const f = found.value;
  const loc = f.location;
  if (!loc) return 'До бэкенда запрос не дойдёт.';
  if (f.redirect) return `До бэкенда запрос не дойдёт: клиент получит ${c('301')} и придёт снова на ${c(f.redirect)}.`;
  if (!loc.pass) return `В ${c(loc.text)} нет ${c('proxy_pass')}.`;
  const part = loc.pass.replace(/^[a-z]+:\/\/[^/]+/, '');
  const how = part
    ? `с путём ${c(part)}: совпавшее с location ${c(loc.path)} заменено им`
    : 'без пути: адрес уходит как прислал клиент';
  return `${c('proxy_pass ' + loc.pass)} — ${how}. Бэкенд увидит **${c(backendPath.value ?? '')}**.`;
});

const standLine = computed(() => {
  const p = probe.value;
  if (!p) return { tone: 'none', text: 'Этого адреса в журнале стенда нет — ответ дала только модель.' };
  const same =
    p.location === (found.value.location?.text ?? null) &&
    p.backend === backendPath.value &&
    (p.redirect === null) === (found.value.redirect === null);
  const what = p.status === 301
    ? `${c('301')}, ${c('Location: ' + (p.redirect ?? ''))}`
    : `location ${c(p.location ?? '—')}, бэкенд увидел ${c(p.backend ?? '—')}`;
  return { tone: same ? 'ok' : 'err', text: `nginx 1.30 на стенде: ${what}.` };
});

/** Строки конфига с пометкой, какая роль у location этой строки в текущем выборе. */
const confLines = computed(() =>
  props.conf.split('\n').map((text) => {
    const m = /^\s*location\s+(?:(=|\^~|~\*|~)\s+)?(\S+)/.exec(text);
    if (!m) return { text, role: 'plain' };
    const name = (m[1] ? m[1] + ' ' : '') + m[2];
    const f = found.value;
    if (f.location?.text === name) return { text, role: 'chosen' };
    const rx = f.regexes.find((r) => r.location.text === name);
    if (rx) return { text, role: 'checked' };
    if (f.prefixes.some((l: Location) => l.text === name)) return { text, role: 'candidate' };
    return { text, role: 'plain' };
  }),
);
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl
        :model-value="groupId"
        class="l-pills"
        label="Адреса"
        :options="groupOptions"
        @update:model-value="onGroup"
      />
    </template>

    <div class="ng-body">
      <div class="ng-picks" role="group" aria-label="Адреса из журнала стенда">
        <button
          v-for="u in group.uris"
          :key="u"
          type="button"
          class="ng-pick"
          :aria-pressed="u === uri"
          :data-on="u === uri ? 'yes' : 'no'"
          @click="pick(u)"
        >
          {{ u }}
        </button>
      </div>

      <form class="ng-own" @submit.prevent="applyDraft">
        <label class="ng-label" for="ng-uri">свой адрес</label>
        <div class="ng-own__row">
          <input id="ng-uri" v-model="draft" class="ng-input" spellcheck="false" autocomplete="off" />
          <button type="submit" class="ng-go">Отправить</button>
        </div>
        <Md v-if="draftError" class="ng-error" :text="draftError" />
      </form>

      <div class="ng-split">
        <div class="ng-pane">
          <span class="ng-label">конфиг стенда</span>
          <pre class="ng-code"><template v-for="(l, i) in confLines" :key="i"><span
            class="ng-line"
            :data-role="l.role"
          >{{ l.text }}</span>{{ i < confLines.length - 1 ? '\n' : '' }}</template></pre>
        </div>

        <div class="ng-pane ng-pane--steps">
          <span class="ng-label">выбор location для <code>{{ uri }}</code></span>
          <ol class="ng-steps">
            <li v-for="s in steps" :key="s.k" class="ng-step" :data-state="s.state">
              <span class="ng-step__k">{{ s.k }}</span>
              <Md class="ng-step__d" :text="s.d" />
            </li>
          </ol>
          <Md class="ng-pass" :text="passLine" />
          <Md class="ng-stand" :data-tone="standLine.tone" :text="standLine.text" />
        </div>
      </div>

      <Md class="ng-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.ng-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.ng-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.ng-caption :deep(code),
.ng-step__d :deep(code),
.ng-pass :deep(code),
.ng-stand :deep(code),
.ng-error :deep(code),
.ng-label code {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
  overflow-wrap: anywhere;
}

.ng-picks {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ng-pick {
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  cursor: pointer;
  overflow-wrap: anywhere;
}
.ng-pick:hover,
.ng-pick:focus-visible {
  background: var(--surface-2);
}
.ng-pick[data-on='yes'] {
  background: var(--tone-warn-bg);
  border-color: var(--tone-warn-line);
  color: var(--tone-warn-text);
}

.ng-own {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ng-own__row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.ng-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  flex: 1 1 220px;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.ng-go {
  font: inherit;
  font-size: var(--fs-3);
  color: var(--ink);
  padding: 6px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--r2);
  background: var(--surface-2);
  cursor: pointer;
}
.ng-error {
  font-size: var(--fs-3);
  color: var(--tone-err-text);
}

.ng-split {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 860px) {
  .ng-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.ng-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.ng-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.ng-label code {
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink);
}

.ng-code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.7;
  /* Подложка — общая для кода курса (`pre` в base.css, чернильная): цвета ниже — «на чернилах». */
  color: var(--code-fg);
  white-space: pre;
  overflow-x: auto;
}
.ng-line {
  border-radius: 3px;
}
.ng-line[data-role='plain'] {
  color: var(--ink-faint);
}
.ng-line[data-role='candidate'] {
  background: var(--ink-chip);
}
.ng-line[data-role='checked'] {
  box-shadow: inset 2px 0 0 var(--ink-line);
}
.ng-line[data-role='chosen'] {
  background: var(--warn-wash-on-ink);
  color: var(--tone-warn-on-ink);
  box-shadow: inset 0 0 0 1px var(--tone-warn-accent);
}

.ng-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ng-step {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  padding: 7px 10px;
  border-radius: var(--r2);
  background: var(--surface);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--prose);
}
@media (max-width: 480px) {
  .ng-step {
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
  }
}
.ng-step[data-state='hit'] {
  background: var(--tone-warn-bg);
  box-shadow: inset 3px 0 0 var(--tone-warn-line);
}
.ng-step__k {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.ng-step__d {
  min-width: 0;
}

.ng-pass,
.ng-stand {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
  padding: 8px 10px;
  border-radius: var(--r2);
  background: var(--surface);
}
.ng-stand[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.ng-stand[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.ng-stand[data-tone='none'] {
  color: var(--text-muted);
}
</style>
