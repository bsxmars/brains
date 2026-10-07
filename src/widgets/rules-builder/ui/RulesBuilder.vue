<script setup lang="ts">
/**
 * Конструктор правил: читатель собирает `rules`, а демо говорит, запустится джоб или нет —
 * и какое именно правило это решило.
 *
 * ⚠️ **Это модель, а не запись прогона.** Раннера GitLab в браузере нет и быть не может.
 * Решение считает `model/rules.ts`, и подпись под демо говорит об этом прямо. Проверено оно
 * не на глаз: те же правила в тех же контекстах прогнаны через `gitlab-ci-local` 4.75.1
 * (он исполняет `.gitlab-ci.yml` в Docker), а совпадение модели с его вердиктами закреплено
 * `tests/unit/gitlab-ci.test.ts` — если модель начнёт отвечать иначе, красным станет тест.
 *
 * Почему демо вообще нужно. В файле правила выглядят как список условий, и читаются глазами
 * как «джоб запустится, если хоть одно подходит». На самом деле их читают сверху вниз
 * и останавливаются на первом совпавшем — поэтому одно и то же множество правил в разном
 * порядке даёт разный конвейер. Увидеть это в тексте нельзя, а переставив строки — можно.
 */
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import { SegmentedControl } from '@/shared/ui';
import { decide } from '../model/rules';
import { resolveVar, shadowed } from '../model/vars';
import type { PipelineCtx, PipelineSource, Rule } from '../model/types';
import type { VarLayer, VarSource } from '../model/vars';

/** Слой переменной вместе с подписью для кнопки. */
type RichLayer = VarLayer & { label: string };

const props = defineProps<{
  rules: Rule[];
  /** Слои, которыми можно задать `$DEPLOY`, — от слабого к сильному. */
  layers: RichLayer[];
}>();

// --- Контекст конвейера -----------------------------------------------------

/**
 * Значения переключателей — обычные строки, а не узкие литеральные типы: `v-model`
 * у переключателя библиотеки работает со строкой, и сужение здесь только мешало бы шву.
 */
const event = ref('push');
const branch = ref('main');
const changed = ref('none');

const EVENTS = [
  { value: 'push', label: 'push в ветку' },
  { value: 'mr', label: 'merge request' },
  { value: 'tag', label: 'тег v1.4.0' },
  { value: 'schedule', label: 'по расписанию' },
];
const BRANCHES = [
  { value: 'main', label: 'main' },
  { value: 'feature/x', label: 'feature/x' },
];
const CHANGES = [
  { value: 'none', label: 'ничего' },
  { value: 'src', label: 'src/app.ts' },
  { value: 'docs', label: 'docs/readme.md' },
];

/** На конвейере тега ветки нет вовсе — не «пустая», а не определена. */
const onTag = computed(() => event.value === 'tag');

const SOURCE: Record<string, PipelineSource> = {
  push: 'push',
  mr: 'merge_request_event',
  // Конвейер тега заводится тем же событием, что и push: `merge_request_event` тут ни при чём.
  tag: 'push',
  schedule: 'schedule',
};

const CHANGED_FILES: Record<string, string[]> = {
  none: [],
  src: ['src/app.ts'],
  docs: ['docs/readme.md'],
};

// --- Переменная $DEPLOY и её слои -------------------------------------------

const active = ref<VarSource[]>([]);

const chosen = computed<RichLayer[]>(() =>
  props.layers.filter((layer) => active.value.includes(layer.source)),
);
const winner = computed(() => resolveVar(chosen.value) as RichLayer | null);
const losers = computed(() => shadowed(chosen.value));

function toggleLayer(source: VarSource) {
  active.value = active.value.includes(source)
    ? active.value.filter((s) => s !== source)
    : [...active.value, source];
}

const ctx = computed<PipelineCtx>(() => ({
  branch: onTag.value ? null : branch.value,
  tag: onTag.value ? 'v1.4.0' : null,
  source: SOURCE[event.value],
  changed: CHANGED_FILES[changed.value],
  vars: winner.value ? { DEPLOY: winner.value.value } : ({} as Record<string, string>),
}));

// --- Сборка правил ----------------------------------------------------------

const order = ref(props.rules.map((rule) => rule.id));
const off = ref<string[]>([]);

const assembled = computed<Rule[]>(() =>
  order.value
    .map((id) => props.rules.find((rule) => rule.id === id)!)
    .filter((rule) => !off.value.includes(rule.id)),
);

function toggleRule(id: string) {
  off.value = off.value.includes(id) ? off.value.filter((x) => x !== id) : [...off.value, id];
}

function move(id: string, delta: number) {
  const from = order.value.indexOf(id);
  const to = from + delta;
  if (to < 0 || to >= order.value.length) return;
  const next = [...order.value];
  [next[from], next[to]] = [next[to], next[from]];
  order.value = next;
}

const decision = computed(() => decide(assembled.value, ctx.value));

/** Строка правила в собранном списке — по ней же считается его номер в вердикте. */
const rows = computed(() =>
  order.value.map((id) => {
    const rule = props.rules.find((r) => r.id === id)!;
    const enabled = !off.value.includes(id);
    const index = enabled ? assembled.value.findIndex((r) => r.id === id) : -1;
    return {
      rule,
      enabled,
      number: index + 1,
      outcome: enabled ? decision.value.outcomes[index] : 'off',
    };
  }),
);

const yaml = computed(() => {
  if (assembled.value.length === 0) return 'rules: []   # ни одного правила';
  const body = assembled.value
    .map((rule) =>
      rule.text
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    )
    .join('\n');
  return `rules:\n${body}`;
});

const verdict = computed(() => {
  if (!decision.value.included) return { text: 'Джоба в конвейере нет', tone: 'err' };
  if (decision.value.when === 'manual') {
    return { text: 'Джоб есть, но ждёт нажатия', tone: 'warn' };
  }
  return { text: 'Джоб запустится', tone: 'ok' };
});

const OUTCOME_LABEL: Record<string, string> = {
  matched: 'совпало',
  missed: 'не совпало',
  unreached: 'не читалось',
  off: 'выключено',
};

const ruleVars = computed(() => Object.entries(decision.value.variables));
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="bar">
        <SegmentedControl v-model="event" label="Из-за чего завёлся конвейер" :options="EVENTS" />
        <SegmentedControl
          v-if="!onTag"
          v-model="branch"
          label="Ветка"
          :options="BRANCHES"
        />
        <SegmentedControl v-model="changed" label="Что изменил коммит" :options="CHANGES" />
      </div>
    </template>

    <div class="body">
      <div class="ctx">
        <span class="ctx__t">Условия видят это:</span>
        <code class="v">$CI_COMMIT_BRANCH = {{ ctx.branch === null ? 'не определена' : ctx.branch }}</code>
        <code class="v">$CI_COMMIT_TAG = {{ ctx.tag === null ? 'не определена' : ctx.tag }}</code>
        <code class="v">$CI_PIPELINE_SOURCE = {{ ctx.source }}</code>
        <code class="v">$DEPLOY = {{ winner ? winner.value : 'не определена' }}</code>
      </div>

      <div class="vars">
        <span class="vars__t">Где задана <code>DEPLOY</code>:</span>
        <button
          v-for="layer in props.layers"
          :key="layer.source"
          type="button"
          class="layer"
          :aria-pressed="active.includes(layer.source)"
          :data-on="active.includes(layer.source) ? 'yes' : 'no'"
          :data-win="winner && winner.source === layer.source ? 'yes' : 'no'"
          @click="toggleLayer(layer.source)"
        >
          {{ layer.label }} <code>= {{ layer.value }}</code>
        </button>
      </div>

      <p v-if="losers.length" class="loss">
        Победил слой «{{ winner!.label }}». Проиграли:
        <s v-for="layer in losers" :key="layer.source">{{ layer.value }}</s>
        — приоритет решает место, где переменная задана, а не то, насколько оно ближе к джобу.
      </p>

      <div class="split">
        <div class="list">
          <div class="list__t">Правила джоба — сверху вниз</div>

          <div v-for="row in rows" :key="row.rule.id" class="rule" :data-outcome="row.outcome">
            <div class="rule__head">
              <span class="rule__n">{{ row.enabled ? row.number : '—' }}</span>
              <span class="rule__o">{{ OUTCOME_LABEL[row.outcome] }}</span>
              <span class="rule__btns">
                <button type="button" class="mini" title="выше" @click="move(row.rule.id, -1)">↑</button>
                <button type="button" class="mini" title="ниже" @click="move(row.rule.id, 1)">↓</button>
                <button
                  type="button"
                  class="mini"
                  :aria-pressed="row.enabled"
                  :title="row.enabled ? 'убрать правило' : 'вернуть правило'"
                  @click="toggleRule(row.rule.id)"
                >
                  {{ row.enabled ? '×' : '+' }}
                </button>
              </span>
            </div>
            <pre class="rule__code">{{ row.rule.text }}</pre>
          </div>
        </div>

        <div class="out">
          <div class="verdict" :data-tone="verdict.tone">{{ verdict.text }}</div>

          <dl class="facts">
            <dt>when</dt>
            <dd><code>{{ decision.when }}</code></dd>
            <dt>allow_failure</dt>
            <dd><code>{{ decision.allowFailure }}</code></dd>
            <dt>решило</dt>
            <dd>{{ decision.matched === null ? 'ничего не совпало' : `правило ${decision.matched + 1}` }}</dd>
          </dl>

          <p class="why">{{ decision.reason }}</p>

          <p v-if="ruleVars.length" class="rulevars">
            Правило задало переменные:
            <code v-for="[key, value] in ruleVars" :key="key">{{ key }}={{ value }}</code>
          </p>

          <pre class="yaml">{{ yaml }}</pre>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="disclaimer">
        Демо <b>считает решение по правилам GitLab</b>, а не запускает раннер: в браузере его нет.
        Те же правила в тех же контекстах прогнаны через <code>gitlab-ci-local</code> 4.75.1
        (образ <code>alpine:3</code>), и совпадение модели с его вердиктами закреплено
        <code>tests/unit/gitlab-ci.test.ts</code> — поправить ответ демо, не уронив сборку, нельзя.
      </div>
    </template>
  </DemoFrame>
</template>

<style scoped>
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 22px 20px;
  min-width: 0;
}

.ctx,
.vars {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.ctx__t,
.vars__t {
  color: var(--text-muted);
}
.v {
  padding: 4px 9px;
  border-radius: var(--r-full);
  background: var(--surface-2);
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}

.layer {
  font: inherit;
  font-family: var(--font);
  font-size: var(--fs-3);
  padding: 5px 10px;
  border-radius: var(--r-full);
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.layer code {
  font-family: var(--mono);
  color: inherit;
}
.layer[data-on='yes'] {
  border-color: var(--tone-info-line);
  background: var(--tone-info-bg);
  color: var(--tone-info-text);
}
.layer[data-win='yes'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}

.loss {
  margin: 0;
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.loss s {
  margin-right: 8px;
  font-family: var(--mono);
  color: var(--text-faint);
}

.split {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
@media (max-width: 720px) {
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.list__t {
  font-size: var(--fs-2);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.rule {
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
  padding: 9px 11px;
  min-width: 0;
  transition: all 0.2s;
}
.rule[data-outcome='matched'] {
  border-color: var(--tone-ok-line);
  background: var(--tone-ok-bg);
}
.rule[data-outcome='missed'] {
  opacity: 0.75;
}
.rule[data-outcome='unreached'] {
  border-style: dashed;
  opacity: 0.55;
}
.rule[data-outcome='off'] {
  opacity: 0.4;
}

.rule__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.rule__n {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
}
.rule__o {
  font-size: var(--fs-3);
  color: var(--text-faint);
}
.rule__btns {
  margin-left: auto;
  display: inline-flex;
  gap: 4px;
}
.mini {
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1;
  padding: 3px 7px;
  border-radius: var(--r1);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.mini:hover {
  border-color: var(--border-strong);
  color: var(--ink);
}

.rule__code {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.55;
  color: var(--prose);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.out {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.verdict {
  padding: 10px 12px;
  border-radius: var(--r2);
  font-size: var(--fs-4);
  transition: all 0.2s;
}
.verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.verdict[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.facts {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 4px 12px;
  margin: 0;
  font-size: var(--fs-2);
}
.facts dt {
  font-family: var(--mono);
  color: var(--text-faint);
}
.facts dd {
  margin: 0;
  color: var(--prose);
}
.facts code {
  font-family: var(--mono);
  color: var(--ink);
}

.why {
  margin: 0;
  font-size: var(--fs-2);
  line-height: 1.55;
  color: var(--text-muted);
}
.rulevars {
  margin: 0;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.rulevars code {
  margin-left: 6px;
  font-family: var(--mono);
  color: var(--tone-info-text);
}

.yaml {
  margin: 0;
  padding: 11px 13px;
  border-radius: var(--r2);
  background: var(--surface-2);
  font-family: var(--mono);
  /* `--fs-2`, а не `--fs-3`: подпись живёт внутри отрезка фиксированной ширины (строки YAML — в колонке), и ступень крупнее обрезала бы её сильнее, чем мелкий кегль мешал читать. */
  font-size: var(--fs-2);
  line-height: 1.6;
  color: var(--prose);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.facts :deep(code),
.vars__t :deep(code),
.layer :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
