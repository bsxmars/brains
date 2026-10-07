<script setup lang="ts">
/**
 * Живая проверка вкладки читателя: есть ли в документе узлы, которых сайт не присылал.
 *
 * Изолированный мир на странице не воспроизвести — его создаёт браузер для установленного
 * расширения. Зато его **след** в DOM виден любой странице, и это демо ищет его по-настоящему:
 * повторный запрос адреса, разбор HTML без исполнения скриптов, сверка с живым документом
 * (`model/dom.ts` → `model/tree.ts`). Результат зависит от расширений читателя, поэтому
 * заготовленных ответов здесь нет.
 *
 * Сверка запускается кнопкой, а не в `setup`: это запрос и обход всего документа, и платить
 * за него при прокрутке мимо незачем.
 */
import { ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { Button } from '@/shared/ui';
import { auditThisPage, type AuditReport } from '../model/dom';

const props = withDefaults(
  defineProps<{
    /** Что сказать, если находок нет. Разрешена строчная разметка. */
    empty?: string;
    /** Что сказать, если находки есть. */
    found?: string;
    foot?: string;
  }>(),
  { empty: '', found: '', foot: '' },
);

const report = ref<AuditReport | null>(null);
const busy = ref(false);
const failed = ref('');

const total = (r: AuditReport) => r.findings.length + r.attributes.length + r.extensionUrls.length;

async function run() {
  busy.value = true;
  failed.value = '';
  try {
    report.value = await auditThisPage();
  } catch (failure) {
    failed.value = failure instanceof Error ? failure.message : String(failure);
  } finally {
    busy.value = false;
  }
}

const KIND_LABEL = { inserted: 'вставлен', removed: 'удалён' } as const;
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="xa-bar">
        <Button variant="primary" :disabled="busy" @click="run">
          {{ report ? 'Проверить ещё раз' : 'Проверить эту вкладку' }}
        </Button>
        <span v-if="busy" class="xa-wait">сверяется…</span>
        <span v-else-if="report" class="xa-verdict" :data-clean="total(report) === 0 ? 'yes' : 'no'">
          {{ total(report) === 0 ? 'чужих узлов нет' : `находок: ${total(report)}` }}
        </span>
      </div>
    </template>

    <div class="xa-body">
      <p v-if="failed" class="xa-failed">{{ failed }}</p>

      <p v-if="!report && !failed" class="xa-idle">
        Сверка ещё не запускалась — сравнивать пока нечего.
      </p>

      <template v-if="report">
        <div class="xa-stats">
          <span>элементов в документе: <b>{{ report.elements }}</b></span>
          <span>островов обойдено: <b>{{ report.islands }}</b></span>
        </div>

        <ul v-if="total(report) > 0" class="xa-list">
          <li v-for="(f, i) in report.findings" :key="`f${i}`" class="xa-item" :data-kind="f.kind">
            <span class="xa-kind">{{ KIND_LABEL[f.kind] }}</span>
            <code class="xa-what">{{ f.what }}</code>
            <span class="xa-where">в {{ f.where }}</span>
          </li>
          <li v-for="a in report.attributes" :key="a" class="xa-item" data-kind="attr">
            <span class="xa-kind">атрибут</span>
            <code class="xa-what">{{ a }}</code>
            <span class="xa-where">его нет в исходнике</span>
          </li>
          <li v-for="u in report.extensionUrls" :key="u" class="xa-item" data-kind="url">
            <span class="xa-kind">адрес расширения</span>
            <code class="xa-what">{{ u }}</code>
          </li>
        </ul>

        <Md class="xa-verdict-text" :data-clean="total(report) === 0 ? 'yes' : 'no'" :text="total(report) === 0 ? props.empty : props.found" />
      </template>
    </div>

    <template v-if="props.foot" #footer>
      <Md class="xa-foot" :text="props.foot" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.xa-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.xa-wait {
  font-family: var(--mono);
  font-size: var(--fs-2);
  font-style: italic;
  color: var(--dim);
}
.xa-verdict {
  padding: 3px 9px;
  border-radius: var(--r-full);
  font-family: var(--mono);
  font-size: var(--fs-2);
}
.xa-verdict[data-clean='yes'] {
  background: var(--tone-ok-chip);
  color: var(--tone-ok-strong);
}
.xa-verdict[data-clean='no'] {
  background: var(--tone-err-chip);
  color: var(--tone-err-strong);
}

.xa-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: 20px;
}
.xa-idle,
.xa-failed {
  margin: 0;
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
.xa-failed {
  font-family: var(--mono);
  color: var(--tone-err-strong);
}
.xa-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.xa-stats b {
  color: var(--ink);
  font-weight: 600;
}

.xa-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.xa-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  padding: 10px 12px;
  border-radius: var(--r2);
  border: 1px solid var(--tone-err-line);
  background: var(--tone-err-bg);
  min-width: 0;
}
.xa-item[data-kind='removed'],
.xa-item[data-kind='attr'] {
  border-color: var(--tone-warn-line);
  background: var(--tone-warn-bg);
}
.xa-kind {
  font-family: var(--mono);
  font-size: var(--fs-2);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}
.xa-what {
  font-family: var(--mono);
  font-size: var(--fs-3);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.xa-where {
  font-size: var(--fs-4);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.xa-verdict-text {
  padding: 14px 16px;
  border-radius: var(--r2);
  font-size: var(--fs-6);
  line-height: 1.6;
}
.xa-verdict-text[data-clean='yes'] {
  background: var(--tone-ok-bg);
  color: var(--tone-ok-text);
}
.xa-verdict-text[data-clean='no'] {
  background: var(--tone-err-bg);
  color: var(--tone-err-text);
}
.xa-foot {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
