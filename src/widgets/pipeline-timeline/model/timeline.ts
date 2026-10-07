import type { Boundary, DemoStep, Scenario } from './types';

/**
 * Разбор записи прогона и арифметика границ.
 *
 * Отдельный файл без Vue — по той же причине, по которой отдельно живут `neighbours` и
 * `states`: это чистые функции, и их можно закрыть юнит-тестом (`tests/unit/actions.test.ts`).
 * Проверять тут есть что: вся тема держится на разнице между границей шага и границей джоба,
 * а разницу эту видно только во времени.
 *
 * Тест **не запускает докер**. Он разбирает то, что `act` напечатал во время замера, и сверяет
 * с числами, которые стоят в `data.ts`: если шкала демо разойдётся с записью, красным станет
 * тест, а не читатель.
 */

/** Отметка времени, поставленная самим шагом: `::mark::<джоб>|<шаг>|begin|<epoch ms>`. */
export interface Mark {
  job: string;
  step: string;
  phase: 'begin' | 'end';
  /** Epoch-миллисекунды — ровно то, что напечатал `date +%s%3N` внутри контейнера. */
  at: number;
}

/**
 * Шаг с началом и концом, отсчитанными от первой отметки прогона.
 *
 * `job` здесь — то, что печатал сам шаг, а не заголовок строки лога: у матрицы `act` называет
 * джобы `test-1`, `test-2`, `test-3`, и это единственный способ отличить шарды друг от друга.
 */
export interface Span {
  job: string;
  step: string;
  start: number;
  end: number;
}

const MARK = /::mark::([^|]+)\|([^|]+)\|(begin|end)\|(\d+)/;

/**
 * Вытащить отметки из лога `act`.
 *
 * Лог содержит и шум: поднятие контейнеров, клонирование действий, предупреждения Node
 * о `punycode`, вывод самих команд. Ничего из этого сюда не попадает — берутся только строки
 * `::mark::`, и то, что разбор их не путает с остальным, проверяет тест.
 */
export function parseMarks(raw: string): Mark[] {
  const marks: Mark[] = [];

  for (const line of raw.split('\n')) {
    const found = MARK.exec(line);
    if (!found) continue;
    marks.push({
      job: found[1],
      step: found[2],
      phase: found[3] as 'begin' | 'end',
      at: Number(found[4]),
    });
  }

  return marks;
}

/**
 * Свести отметки в шаги и отсчитать время от начала прогона.
 *
 * Сортировка по `start`, а не по порядку в файле: джобы идут параллельно, и в логе их строки
 * перемешаны. Порядок на шкале — хронологический, то есть тот, в котором это происходило.
 */
export function toSpans(marks: Mark[]): Span[] {
  const zero = marks.reduce((min, mark) => Math.min(min, mark.at), Infinity);
  const byKey = new Map<string, Span>();

  for (const mark of marks) {
    const key = `${mark.job}/${mark.step}`;
    const span = byKey.get(key) ?? { job: mark.job, step: mark.step, start: 0, end: 0 };
    span[mark.phase === 'begin' ? 'start' : 'end'] = mark.at - zero;
    byKey.set(key, span);
  }

  return [...byKey.values()].sort((a, b) => a.start - b.start);
}

/**
 * Что пересекли между двумя соседними по времени шагами.
 *
 * Главное различение темы. Один и тот же джоб — значит та же машина: между шагами меняется
 * только процесс оболочки. Разные джобы — значит разные машины, и общего у них нет ничего,
 * кроме того, что было объявлено в `outputs` и сложено в артефакт.
 */
export function boundaryBetween(previous: Span | null, current: Span): Boundary {
  if (!previous) return 'start';
  return previous.job === current.job ? 'step' : 'job';
}

/**
 * Во что обошлась граница: от конца предыдущего шага до начала текущего.
 *
 * Это не «накладные расходы раннера» в чистом виде — в промежуток попадает всё, что случилось
 * между двумя отметками: поднятие контейнера, клонирование действия, скачивание артефакта.
 * Поэтому у каждого промежутка в данных написано, что именно в нём было.
 */
export function boundaryCost(previous: Span | null, current: Span): number {
  return previous ? current.start - previous.end : 0;
}

/** Дорожки шкалы в порядке первого появления: джоб, начавшийся раньше, лежит выше. */
export function lanes(steps: { job: string }[]): string[] {
  const seen: string[] = [];
  for (const step of steps) if (!seen.includes(step.job)) seen.push(step.job);
  return seen;
}

/** Длительность сценария — конец последнего шага. */
export function span(steps: { end: number }[]): number {
  return steps.reduce((max, step) => Math.max(max, step.end), 0);
}

/**
 * Средняя цена границы одного рода по сценарию.
 *
 * Считается по записи, а не по ощущениям, и нужна ровно для одного утверждения темы: граница
 * шага стоит миллисекунды, граница джоба — секунды. Отношение между ними и закрепляет тест;
 * абсолютные числа машинозависимы и в тесте не сверяются.
 */
export function averageCost(steps: DemoStep[], kind: Boundary): number {
  const costs = steps.filter((step) => step.boundary === kind).map((step) => step.cost);
  if (!costs.length) return 0;
  return Math.round(costs.reduce((sum, cost) => sum + cost, 0) / costs.length);
}

/** Сценарий по идентификатору — с внятной ошибкой вместо `undefined` где-нибудь в разметке. */
export function scenarioById(scenarios: Scenario[], id: string): Scenario {
  const found = scenarios.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`Нет сценария ${id}`);
  return found;
}
