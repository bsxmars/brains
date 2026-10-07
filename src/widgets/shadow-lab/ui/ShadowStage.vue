<script setup lang="ts">
/**
 * Кто побеждает на границе теневого дерева: настоящий `<sd-demo-card>` и правила по обе стороны.
 *
 * Элемент регистрируется в браузере читателя (`customElements.get` перед `define`), его теневой
 * корень собран из той же строки, что напечатана в теме. Каждый флажок кладёт правило туда,
 * где оно написано: в лист страницы, в `<style>` обоих корней или в общий сконструированный лист.
 * Таблица — `getComputedStyle(…).color` целевых элементов; подпись «откуда» выводит
 * `model/stage.ts` по совпадению с токенами включённых правил.
 *
 * Всё, что трогает DOM, — в `onMounted`: остров рендерится и в Node. До гидратации сцена пуста
 * и честно об этом говорит.
 *
 * ⚠️ Сцена живёт в обычном элементе, который Vue не перерисовывает: хосты создаёт модуль,
 * и шаблон их не знает. Иначе Vue попытался бы разрешить неизвестный тег как компонент.
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { applyRules, defineCard, mountStage, readFonts, readTargets, unmountStage, type Stage } from '../model/stage';
import type { SdBase, SdFonts, SdReading, SdRule, SdSide, SdTarget } from '../model/types';

const props = defineProps<{
  rules: SdRule[];
  base: SdBase[];
  targets: { key: SdTarget; label: string }[];
  sides: { key: SdSide; label: string }[];
  labels: { inheritedPage: string; inheritedSlot: string; unknown: string; taken: string; pending: string };
  fontLabels: { title: string; page: string; inner: string; button: string };
  shadowHtml: string;
  lightHtml: string;
  footer: string;
}>();

const box = ref<HTMLElement | null>(null);
/** Сцена — DOM-узлы и лист: наружу светит результат замера, а не они сами. */
const stage = shallowRef<Stage | null>(null);
const on = ref<Set<string>>(new Set());
const readings = ref<SdReading[]>([]);
const fonts = ref<SdFonts | null>(null);
const state = ref<'pending' | 'ready' | 'taken'>('pending');

const groups = computed(() =>
  props.sides.map((side) => ({ ...side, rules: props.rules.filter((r) => r.side === side.key) })),
);

function refresh() {
  const s = stage.value;
  if (!s) return;
  applyRules(s, props.rules, on.value);
  readings.value = readTargets(
    s,
    props.rules,
    props.base,
    on.value,
    props.targets.map((t) => t.key),
  );
  fonts.value = readFonts(s);
}

function toggle(key: string) {
  const next = new Set(on.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  on.value = next;
  refresh();
}

function reset() {
  on.value = new Set();
  refresh();
}

onMounted(() => {
  if (!box.value) return;
  if (!defineCard(window, props.shadowHtml)) {
    state.value = 'taken';
    return;
  }
  stage.value = mountStage(document, box.value, props.lightHtml);
  state.value = 'ready';
  refresh();
});

onBeforeUnmount(() => {
  if (stage.value) unmountStage(stage.value);
});

const targetLabel = (key: SdTarget) => props.targets.find((t) => t.key === key)?.label ?? key;

function sourceLabel(r: SdReading): string {
  const s = r.source;
  if (s.kind === 'rule') return props.rules.find((rule) => rule.key === s.key)?.label ?? s.key;
  if (s.kind === 'base') {
    const target = r.target === 'title-b' ? 'title' : r.target;
    return props.base.find((b) => b.target === target)?.label ?? '';
  }
  if (s.kind === 'inherited') return s.from === 'slot' ? props.labels.inheritedSlot : props.labels.inheritedPage;
  return props.labels.unknown;
}

const sourceTone = (r: SdReading) =>
  r.source.kind === 'rule' ? 'rule' : r.source.kind === 'unknown' ? 'unknown' : 'quiet';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="sd-bar">
        <span class="t-label">правила — флажок кладёт правило на его место</span>
        <Button :disabled="!on.size" @click="reset">снять все</Button>
      </div>
    </template>

    <div class="sd-body">
      <div class="sd-split">
        <div class="sd-rules">
          <fieldset v-for="group in groups" :key="group.key" class="sd-group">
            <legend class="sd-group__title"><Md as="span" :text="group.label" /></legend>
            <label v-for="rule in group.rules" :key="rule.key" class="sd-check">
              <input
                type="checkbox"
                :checked="on.has(rule.key)"
                :disabled="state !== 'ready'"
                @change="toggle(rule.key)"
              />
              <span class="sd-check__text">
                <Md as="span" class="sd-check__label" :text="rule.label" />
                <code class="sd-check__css">{{ rule.css }}</code>
              </span>
            </label>
          </fieldset>
        </div>

        <div class="sd-stage">
          <div class="t-label">сцена: две карточки, один общий лист</div>
          <div ref="box" class="sd-scene"></div>
          <Md v-if="state === 'pending'" class="sd-caption" :text="labels.pending" />
          <Md v-if="state === 'taken'" class="sd-caption" data-tone="err" :text="labels.taken" />
        </div>
      </div>

      <div class="sd-results">
        <div class="t-label">getComputedStyle(…).color — и откуда значение</div>
        <div class="sd-results__scroll">
          <table class="sd-table">
            <thead>
              <tr>
                <th>элемент</th>
                <th>color</th>
                <th>откуда</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in readings" :key="r.target">
                <td class="sd-table__prose"><Md as="span" :text="targetLabel(r.target)" /></td>
                <td>
                  <span class="sd-swatch" :style="{ background: r.value }"></span>
                  {{ r.value || '""' }}
                </td>
                <td class="sd-table__prose" :data-tone="sourceTone(r)"><Md as="span" :text="sourceLabel(r)" /></td>
              </tr>
              <tr v-if="!readings.length">
                <td colspan="3" class="sd-empty">появится после загрузки демо</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div v-if="fonts" class="sd-fonts">
        <div class="t-label"><Md as="span" :text="fontLabels.title" /></div>
        <dl class="sd-fonts__list">
          <div class="sd-fonts__row">
            <dt><Md as="span" :text="fontLabels.page" /></dt>
            <dd>{{ fonts.page }}</dd>
          </div>
          <div class="sd-fonts__row">
            <dt><Md as="span" :text="fontLabels.inner" /></dt>
            <dd>{{ fonts.inner }}</dd>
          </div>
          <div class="sd-fonts__row" data-tone="odd">
            <dt><Md as="span" :text="fontLabels.button" /></dt>
            <dd>{{ fonts.button }}</dd>
          </div>
        </dl>
      </div>
    </div>

    <template #footer>
      <Md class="sd-disclaimer" :text="footer" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.sd-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sd-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 20px;
}

.sd-split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 760px) {
  .sd-split {
    grid-template-columns: minmax(0, 1fr);
  }
}

.sd-rules {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.sd-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  margin: 0;
  padding: 10px 12px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
}
.sd-group__title {
  padding: 0 4px;
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-faint);
}
.sd-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  min-width: 0;
}
/* У флажка свои системные цвета и шрифт — в палитре курса их нет; задаём явно. */
.sd-check input {
  margin: 3px 0 0;
  accent-color: var(--accent);
  font: inherit;
  color: inherit;
}
.sd-check__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.sd-check__label {
  font-size: var(--fs-5);
  line-height: 1.45;
  color: var(--prose);
}
.sd-check__css {
  font-family: var(--mono);
  font-size: var(--fs-2);
  line-height: 1.5;
  color: var(--chip-text);
  overflow-wrap: anywhere;
}

.sd-stage {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.sd-scene {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.sd-caption {
  padding: 10px 12px;
  border-radius: var(--r1);
  font-size: var(--fs-4);
  line-height: 1.5;
  background: var(--surface-2);
  color: var(--text-muted);
}
.sd-caption[data-tone='err'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}

.sd-results,
.sd-fonts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.sd-results__scroll {
  min-width: 0;
  overflow-x: auto;
}
.sd-table {
  width: 100%;
  min-width: 600px;
  border-collapse: collapse;
  font-size: var(--fs-3);
  color: var(--chip-text);
}
.sd-table th {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  font-family: var(--mono);
  font-weight: normal;
  font-size: var(--fs-2);
  text-align: start;
  color: var(--text-faint);
}
.sd-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--rule);
  text-align: start;
  vertical-align: top;
  font-family: var(--mono);
  white-space: nowrap;
}
.sd-table td.sd-table__prose {
  font-family: inherit;
  white-space: normal;
  font-size: var(--fs-4);
  line-height: 1.45;
}
.sd-table td[data-tone='rule'] {
  color: var(--tone-info-text);
}
.sd-table td[data-tone='quiet'] {
  color: var(--text-muted);
}
.sd-table td[data-tone='unknown'] {
  color: var(--tone-err-text);
}
.sd-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 6px;
  border-radius: 3px;
  vertical-align: -1px;
}
.sd-empty {
  font-style: italic;
  color: var(--dim);
}

.sd-fonts__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
}
.sd-fonts__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--r1);
  background: var(--surface-2);
  font-size: var(--fs-4);
}
.sd-fonts__row[data-tone='odd'] {
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
}
.sd-fonts__row dt {
  color: inherit;
}
.sd-fonts__row dd {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--fs-3);
  overflow-wrap: anywhere;
}

.sd-disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}

/* Код внутри мелкой подписи: базовое `code { font-size: .86em }` уводило его ниже 11px.
   Пол — ступень `--fs-2`. */
.sd-group__title :deep(code) {
  font-size: max(0.86em, var(--fs-2));
}
</style>
