/** Группа зондов: строка в переключателе и подзаголовок таблицы. */
export type ProbeGroup = 'язык' | 'CSS' | 'API' | 'наблюдатели' | 'таймер';

/** Движки, на которых снят снимок. Порядок — порядок колонок. */
export type EngineKey = 'chromium' | 'firefox' | 'webkit';

/**
 * Один вопрос к движку. `run` исполняется в браузере читателя (демо) и в трёх движках
 * Playwright (e2e) — одним и тем же кодом, поэтому ответ обязан быть коротким
 * и детерминированным: «есть / нет», нормализованный формат, разобранная дата.
 */
export interface Probe {
  key: string;
  group: ProbeGroup;
  /** Что спрашиваем — моноширинной строкой, как в коде. */
  label: string;
  run: () => string;
}

/** Снимок: ответ каждого движка на каждый зонд. */
export type EngineSnapshot = Record<string, Record<EngineKey, string>>;
