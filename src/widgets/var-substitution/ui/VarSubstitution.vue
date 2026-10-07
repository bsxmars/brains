<script setup lang="ts">
/**
 * Подстановка `var()` на живом элементе: что на самом деле вычислил браузер.
 *
 * Раздел про переменные объяснял главную ловушку таблицей и списком шагов, и это тот случай,
 * когда объяснение проигрывает опыту: правило контринтуитивно. Читателю кажется, что
 * невалидное `padding: var(--gap)` отбрасывается и остаётся предыдущее `padding: 8px` —
 * как было бы с обычной опечаткой. Но подстановка происходит **после** каскада, где
 * проигравшее объявление уже выброшено, и свойство получает `unset`, то есть ноль.
 *
 * Поэтому здесь нет ни одного нарисованного числа: виджет вставляет в документ настоящие
 * правила и спрашивает `getComputedStyle` — тем же приёмом, что соседние демо этой темы
 * (`DefaultingLab`, `ResolvedValue`).
 *
 * ⚠️ На измеряемом свойстве не должно быть перехода. Во время идущего `transition`
 * `getComputedStyle` возвращает интерполированное значение, и демо показало бы кадр анимации
 * вместо результата подстановки — на этом уже один раз сгорело демо каскада в этой же теме.
 *
 * ⚠️ `@property` регистрируется **под уникальным именем на каждый прогон**: повторная
 * регистрация того же имени бросает `InvalidModificationError`, а снять регистрацию нельзя —
 * она живёт до перезагрузки страницы.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import type { VarCase } from '../model/types';

const props = defineProps<{ cases: VarCase[] }>();

const ROOT = 'var-substitution-root';
/** Уникальное имя на экземпляр: регистрация пользовательского свойства необратима. */
const NAME = `--vs-gap-${Math.random().toString(36).slice(2, 8)}`;

const pickedId = ref(props.cases[0].id);
const options = computed(() => props.cases.map((c) => ({ value: c.id, label: c.label })));
const picked = computed(() => props.cases.find((c) => c.id === pickedId.value) ?? props.cases[0]);

const registered = ref('off');
const registerOptions = [
  { value: 'off', label: 'как есть' },
  { value: 'on', label: 'через @property' },
];

const box = ref<HTMLElement | null>(null);
const measured = ref('');
/** Доступна ли регистрация в этом браузере — показываем честно, а не молчим. */
const canRegister = ref(true);

const declaration = computed(() => {
  const v = picked.value.value;
  return v === null ? '/* объявления нет */' : `${NAME}: ${v === '' ? '' : v};`;
});

const cssText = computed(() => {
  const scope = `:where(#${ROOT})`;
  const v = picked.value.value;
  const decl = v === null ? '' : `${NAME}:${v};`;
  /**
   * ⚠️ Значение у предка объявляется **только** в опыте про наследование — и на самом корне,
   * а не на `.stage` внутри него: корневой id висит прямо на сцене.
   *
   * Обе оговорки стоили по дефекту, и оба поймал живой замер, а не проверки. Сначала правило
   * было написано как `:where(#root) .stage` — такого узла нет, переменная не задавалась,
   * и «от родителя» наследовало пустоту, давая ноль вместо 24px. Потом объявление переехало
   * на корень — и сломался соседний случай: переменные наследуются, поэтому «не объявлена»
   * получала её от предка и тоже показывала 24px, переставая быть случаем «переменной нет».
   */
  const parent = picked.value.id === 'inherited' ? `${scope} { ${NAME}: 24px; }` : '';
  return [parent, `${scope} .box { ${decl} padding: 8px; padding: var(${NAME}); }`]
    .filter(Boolean)
    .join('\n');
});

async function measure() {
  await nextTick();
  const el = box.value;
  if (!el) return;
  measured.value = getComputedStyle(el).paddingTop;
}

let sheet: HTMLStyleElement | null = null;

onMounted(() => {
  sheet = document.createElement('style');
  sheet.setAttribute('data-demo', 'var-substitution');
  document.head.append(sheet);
  sheet.textContent = cssText.value;
  measure();
});

watch([cssText, registered], () => {
  if (sheet) sheet.textContent = cssText.value;
  measure();
});

/**
 * Регистрация включается один раз и обратно не выключается — так устроен CSSOM.
 * Поэтому переключатель честно говорит, что опыт с регистрацией необратим до перезагрузки.
 */
watch(registered, (mode) => {
  if (mode !== 'on') return;
  try {
    CSS.registerProperty({
      name: NAME,
      syntax: '<length>',
      inherits: true,
      initialValue: '8px',
    });
  } catch {
    canRegister.value = false;
  }
  measure();
});

onBeforeUnmount(() => {
  sheet?.remove();
  sheet = null;
});

const FOOTER_NOTE =
  'Число слева прочитано `getComputedStyle` с настоящего элемента рядом — это ваш браузер, ' +
  'а не память автора. Обратите внимание на главное: при `--gap: 10` свойство не откатывается ' +
  'к `8px`, а обнуляется. Обычную опечатку отбрасывает парсер — **до** каскада, и предыдущее ' +
  'объявление побеждает. Объявление с `var()` отбрасывается **после** каскада, где предыдущее ' +
  'уже выброшено, и остаётся `unset` → `initial` → `0px`.';
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <div class="controls">
        <span class="t-label">значение</span>
        <SegmentedControl
          v-model="pickedId"
          class="l-pills"
          label="Значение переменной"
          :options="options"
        />
        <SegmentedControl
          v-model="registered"
          class="l-pills"
          label="Регистрация свойства"
          :options="registerOptions"
        />
      </div>
    </template>

    <div class="body">
      <div :id="ROOT" class="stage">
        <div ref="box" class="box">
          <span class="box__label">padding-top</span>
          <span class="box__value">{{ measured || '…' }}</span>
        </div>
      </div>

      <pre class="code" data-code>.box {
  {{ declaration }}
  padding: 8px;          /* объявление 1 */
  padding: var({{ NAME }});  /* объявление 2 */
}</pre>

      <div class="verdict" :data-tone="picked.tone ?? 'neutral'">
        <div class="verdict__row">
          <span class="t-label">обычно ждут</span>
          <Md class="verdict__text" :text="picked.expected" />
        </div>
        <div class="verdict__row">
          <span class="t-label">почему вышло так</span>
          <Md class="verdict__text" :text="picked.why" />
        </div>
      </div>

      <p v-if="!canRegister" class="note">
        Этот браузер не дал зарегистрировать свойство — половина опыта с `@property` здесь
        недоступна, и выдумывать её результат демо не станет.
      </p>
      <p v-else-if="registered === 'on'" class="note">
        Свойство зарегистрировано. Снять регистрацию нельзя — она живёт до перезагрузки
        страницы: это часть контракта CSSOM, а не ограничение демо.
      </p>
    </div>

    <template #footer>
      <Md class="disclaimer" :text="FOOTER_NOTE" />
    </template>
  </DemoFrame>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 22px 20px;
  min-width: 0;
}

.stage {
  padding: 18px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
/* Подопытный элемент: своего padding у него нет — весь padding приходит из опыта.
   И никаких переходов: во время transition замер показал бы кадр анимации. */
.box {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  border-radius: var(--r2);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border);
}
.box__label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}
.box__value {
  font-family: var(--mono);
  font-size: var(--fs-8);
  line-height: 1.2;
  color: var(--ink);
}

.code {
  margin: 0;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--ink);
  color: var(--on-ink);
  font-family: var(--mono);
  font-size: var(--fs-3);
  line-height: 1.6;
  overflow-x: auto;
}

.verdict {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--r2);
  background: var(--surface-2);
}
.verdict[data-tone='err'] {
  background: var(--tone-err-bg);
}
.verdict[data-tone='warn'] {
  background: var(--tone-warn-bg);
}
.verdict[data-tone='ok'] {
  background: var(--tone-ok-bg);
}
.verdict__row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.verdict__text {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--prose);
}

.note {
  margin: 0;
  font-size: var(--fs-4);
  line-height: 1.5;
  color: var(--text-muted);
}

.disclaimer {
  font-size: var(--fs-5);
  line-height: 1.55;
  color: var(--text-muted);
}
</style>
