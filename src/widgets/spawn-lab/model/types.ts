/** Сценарий демо: одна и та же функция `load` двумя способами. Код — строки из `data.ts` темы. */
export interface SpawnScenario {
  id: string;
  label: string;
  /** `async function load(id) { … }` — то, что пишет человек. */
  asyncCode: string;
  /** `function load(id) { return spawn(function* () { … }); }` — то же через генератор. */
  genCode: string;
  /** Что смотреть в этом сценарии. Строчная разметка. */
  note: string;
}

/** Общий для всех сценариев код: «запросы» и то, что зовёт `load`. */
export interface SpawnFixture {
  spawnCode: string;
  helpersCode: string;
  driverCode: string;
}

/** Один шаг пошагового исполнения: синхронная часть или одна микрозадача. */
export interface SpawnStep {
  /** Что выполнилось на этом шаге. Строчная разметка. */
  title: string;
  /** Что при этом сделал генератор. Строчная разметка; пусто, если генератор не трогали. */
  detail: string;
  /** Очередь микрозадач после шага — подписи заданий по порядку. */
  queue: string[];
  /** Вывод `log` к концу шага. */
  console: string[];
  /** Сколько `yield` генератор прошёл к концу шага (номер паузы, с единицы); 0 — ещё не стоял. */
  pause: number;
  /** Генератор закончил работу. */
  done: boolean;
  /** Состояние генератора словами — для подписи. */
  state: string;
}

export interface SpawnTrace {
  steps: SpawnStep[];
  /** Итоговый вывод — для сверки с настоящим `async/await`. */
  log: string[];
}
