<script setup lang="ts">
/**
 * «Поиск по курсу»: поле поиска по заголовкам тем и разделов сайта, четыре способа искать,
 * подсветка совпавшего и счётчики работы.
 *
 * Ищет не компонент, а строки темы: `TRIE_CODE`, `TRIE_FUZZY_CODE`, `SEARCH_CODE`, `RANK_CODE`
 * и `SUBSEQ_CODE`, собранные `new Function` (`model/run.ts`). Те же строки напечатаны на
 * странице и сверяются `tests/unit/fuzzy-search.test.ts` с перебором и с Fuse.js. Режим
 * «Fuse.js» — сама библиотека с настройками по умолчанию.
 */
import Fuse from 'fuse.js';
import { computed, ref } from 'vue';
import DemoFrame from '@/shared/ui/DemoFrame.vue';
import Md from '@/shared/ui/Md.vue';
import { SegmentedControl } from '@/shared/ui';
import { highlight, loadSearch, loadSubsequence, naiveWork, positionsToMarks, terms, toEntries } from '../model/run';
import type { SearchTopic } from '../model/types';

const props = defineProps<{
  topics: SearchTopic[];
  trieCode: string;
  fuzzyCode: string;
  searchCode: string;
  rankCode: string;
  subseqCode: string;
  /** Запросы-подсказки под полем. */
  examples: string[];
  /** Подпись под демо. Строчная разметка. */
  caption: string;
}>();

const api = loadSearch({ trie: props.trieCode, fuzzy: props.fuzzyCode, search: props.searchCode, rank: props.rankCode });
const subseq = loadSubsequence(props.subseqCode);
const entries = toEntries(props.topics);
const index = api.buildIndex(entries);
const words = [...index.where.keys()];

let fuse: Fuse<(typeof entries)[number]> | null = null;
const getFuse = () => (fuse ??= new Fuse(entries, { keys: ['text'], includeScore: true, includeMatches: true }));

type Mode = 'prefix' | 'typos' | 'subseq' | 'fuse';
const mode = ref<Mode>('typos');
const options = [
  { value: 'prefix', label: 'Префикс' },
  { value: 'typos', label: 'С опечатками' },
  { value: 'subseq', label: 'По буквам' },
  { value: 'fuse', label: 'Fuse.js' },
];
const query = ref(props.examples[1] ?? '');

interface Row {
  id: number;
  score: string;
  marks: [number, number][];
}

const LIMIT = 8;

const result = computed<{ rows: Row[]; total: number; work: string }>(() => {
  const q = query.value.trim();
  if (!q) return { rows: [], total: 0, work: 'Наберите запрос.' };
  const n = entries.length;

  if (mode.value === 'prefix' || mode.value === 'typos') {
    const typos = mode.value === 'typos';
    const r = api.search(index, q, typos);
    const ranked = r.hits.map((h) => ({ h, s: api.rank(h, entries[h.id]) })).sort((a, b) => b.s - a.s);
    const naive = naiveWork(words, q, typos);
    const fmt = (x: number) => x.toLocaleString('ru-RU');
    const work = typos
      ? `Trie: **${fmt(r.visited)}** узлов — спуск по префиксу и строки таблицы Левенштейна (${terms(q).map((t) => t.length).join(' + ')} клеток в строке). Перебор: ${fmt(naive.checks)} проверок \`startsWith\` и **${fmt(naive.cells)}** клеток полных таблиц.`
      : `Trie: **${fmt(r.visited)}** узлов. Перебор: **${fmt(naive.checks)}** проверок \`startsWith\` — каждое из ${fmt(words.length)} слов на каждое слово запроса.`;
    return {
      rows: ranked.slice(0, LIMIT).map(({ h, s }) => ({
        id: h.id,
        score: `${s.toFixed(1)}${h.cost ? ` · опечаток ${h.cost}` : ''}`,
        marks: h.marks,
      })),
      total: ranked.length,
      work,
    };
  }

  if (mode.value === 'subseq') {
    const scored = entries
      .map((e, id) => ({ id, r: subseq.subsequenceScore(q, e.text) }))
      .filter((x): x is { id: number; r: NonNullable<typeof x.r> } => x.r !== null)
      .sort((a, b) => b.r.score - a.r.score);
    return {
      rows: scored.slice(0, LIMIT).map((x) => ({ id: x.id, score: String(x.r.score), marks: positionsToMarks(x.r.positions) })),
      total: scored.length,
      work: `Проверена **каждая** из ${n} строк: у подпоследовательности нет индекса, и таблица \`best\` считается для всех.`,
    };
  }

  const found = getFuse().search(q.slice(0, 32));
  return {
    rows: found.slice(0, LIMIT).map((f) => ({
      id: f.refIndex,
      score: (f.score ?? 0).toFixed(3),
      marks: (f.matches ?? []).flatMap((m) => m.indices.map(([s, e]) => [s, e + 1] as [number, number])),
    })),
    total: found.length,
    work: `Fuse проверил **каждую** из ${n} строк своим Bitap. Счёт: меньше — лучше.`,
  };
});

function pick(example: string) {
  query.value = example;
}
</script>

<template>
  <DemoFrame>
    <template #toolbar>
      <SegmentedControl v-model="mode" class="l-pills" label="Способ поиска" :options="options" />
    </template>

    <div class="fz-body">
      <div class="fz-ask">
        <label class="fz-label" for="fz-query">запрос</label>
        <input
          id="fz-query"
          v-model="query"
          class="fz-input"
          type="search"
          spellcheck="false"
          autocomplete="off"
          placeholder="например, кэш"
        />
        <div class="fz-examples">
          <button v-for="ex in examples" :key="ex" type="button" class="fz-chip" :data-on="ex === query ? 'yes' : 'no'" @click="pick(ex)">
            {{ ex }}
          </button>
        </div>
      </div>

      <div class="fz-stats">
        <div class="fz-stat">
          <span class="fz-label">найдено</span>
          <span class="fz-num">{{ result.total }}</span>
          <span class="fz-sub">из {{ entries.length }} строк</span>
        </div>
        <Md class="fz-work" :text="result.work" />
      </div>

      <ol v-if="result.rows.length" class="fz-list">
        <li v-for="row in result.rows" :key="row.id" class="fz-item">
          <a class="fz-link" :href="entries[row.id].href"><template v-for="(part, i) in highlight(entries[row.id].text, row.marks)" :key="i"><mark
            v-if="part.on"
            class="fz-hit"
          >{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></a>
          <span class="fz-meta">
            <span v-if="entries[row.id].kind === 'section'">раздел темы «{{ entries[row.id].topic }}»</span>
            <span v-else>тема · ссылок из других тем: {{ entries[row.id].links }}</span>
            <code class="fz-score">{{ row.score }}</code>
          </span>
        </li>
      </ol>
      <p v-else-if="query.trim()" class="fz-empty">Ничего не найдено.</p>

      <Md class="fz-caption" :text="caption" />
    </div>
  </DemoFrame>
</template>

<style scoped>
.fz-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
  min-width: 0;
}
.fz-ask {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.fz-label {
  font-family: var(--mono);
  font-size: var(--fs-2);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.fz-input {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-4);
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface);
}
.fz-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.fz-chip {
  font: inherit;
  color: inherit;
  font-family: var(--mono);
  font-size: var(--fs-2);
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r2);
  background: var(--surface-2);
  cursor: pointer;
}
.fz-chip[data-on='yes'] {
  background: var(--tone-info-bg);
  border-color: var(--tone-info-line);
  color: var(--tone-info-text);
}

.fz-stats {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
@media (max-width: 560px) {
  .fz-stats {
    grid-template-columns: minmax(0, 1fr);
  }
}
.fz-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
}
.fz-num {
  font-family: var(--mono);
  font-size: var(--fs-6);
  font-weight: 600;
  color: var(--ink);
}
.fz-sub {
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fz-work {
  padding: 10px 14px;
  border-radius: var(--r3);
  background: var(--surface-2);
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
.fz-work :deep(code),
.fz-caption :deep(code) {
  font-family: var(--mono);
  font-size: max(0.92em, var(--fs-2));
}

.fz-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.fz-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: var(--r2);
  background: var(--surface-2);
  min-width: 0;
}
.fz-link {
  font-size: var(--fs-4);
  color: var(--ink);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.fz-link:hover,
.fz-link:focus-visible {
  text-decoration: underline;
}
.fz-hit {
  border-radius: 2px;
  background: var(--tone-warn-bg);
  color: var(--tone-warn-text);
  box-shadow: inset 0 -1px 0 var(--tone-warn-line);
}
.fz-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fz-score {
  font-family: var(--mono);
  font-size: var(--fs-2);
  color: var(--text-muted);
}
.fz-empty {
  margin: 0;
  font-size: var(--fs-3);
  color: var(--text-muted);
}
.fz-caption {
  font-size: var(--fs-3);
  line-height: 1.6;
  color: var(--prose);
}
</style>
