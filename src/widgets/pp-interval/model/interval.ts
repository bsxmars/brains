/**
 * Сколько стоит интервал выборки — формулами, а не таблицей.
 *
 * V8 ставит следующую точку выборки через случайное число байт с показательным
 * распределением и средним `R` (интервал выборки). Отсюда три следствия, которыми считает
 * калькулятор:
 *
 *   - сэмплов в секунду ≈ скорость выделения / R — для объектов много меньше `R`;
 *   - объект размера `s` попадает в выборку с вероятностью `1 − e^(−s/R)`;
 *   - оценка байт функции, собравшей `n` сэмплов, гуляет на `1/√n` (коэффициент вариации
 *     пуассоновского счёта), и на 95% — примерно на `1.96/√n`.
 *
 * Последнее — не пересказ документации, а сверено с движком: `tests/unit/continuous-profiling.test.ts`
 * снимает один и тот же код сорок раз и сравнивает разброс оценок с `1/√n`.
 *
 * ⚠️ Цены сэмпла в миллисекундах здесь нет намеренно: она зависит от машины и глубины стека.
 * Калькулятор говорит «во сколько раз больше сэмплов», а накладные расходы растут вместе
 * с числом сэмплов — это отношение снято на стенде темы.
 */

export interface IntervalInput {
  /** Скорость выделения процесса, МБ/с. */
  rateMBs: number;
  /** Интервал выборки, байт. */
  intervalB: number;
  /** Доля выделений, которая приходится на интересующую функцию, 0…1. */
  share: number;
  /** Окно записи профиля, секунд. */
  windowS: number;
  /** Размер одного объекта, байт — для вероятности попасть в выборку. */
  objectB: number;
}

export interface IntervalReport {
  /** Сэмплов в секунду по всему процессу. */
  samplesPerSec: number;
  /** Сэмплов у функции за окно. */
  fnSamples: number;
  /** Относительная погрешность оценки байт функции на 95%, доля (0.1 = ±10%). */
  err95: number;
  /** Вероятность, что один объект размера `objectB` попадёт в выборку. */
  pObject: number;
  /** Во сколько раз больше сэмплов, чем при интервале `reference`. */
  vsReference: number;
  /** Самая маленькая доля выделений, которую окно оценит с точностью ±20% на 95%. */
  minShare: number;
}

/** Умолчание `v8.startHeapProfile()` в Node 26: 512 КБ. */
export const NODE_DEFAULT_INTERVAL = 512 * 1024;
/** Умолчание `HeapProfiler.startSampling` в протоколе отладчика: 32 КБ. */
export const CDP_DEFAULT_INTERVAL = 32 * 1024;

/** Сколько сэмплов нужно, чтобы оценка попала в ±20% на 95%: (1.96 / 0.2)² ≈ 96. */
export const SAMPLES_FOR_20PCT = Math.ceil((1.96 / 0.2) ** 2);

export function intervalReport(input: IntervalInput, reference = NODE_DEFAULT_INTERVAL): IntervalReport {
  const bytesPerSec = input.rateMBs * 1024 * 1024;
  const samplesPerSec = bytesPerSec / input.intervalB;
  const fnSamples = samplesPerSec * input.share * input.windowS;
  const err95 = fnSamples > 0 ? 1.96 / Math.sqrt(fnSamples) : Infinity;
  const pObject = 1 - Math.exp(-input.objectB / input.intervalB);
  const vsReference = reference / input.intervalB;
  const totalSamples = samplesPerSec * input.windowS;
  const minShare = totalSamples > 0 ? Math.min(1, SAMPLES_FOR_20PCT / totalSamples) : 1;
  return { samplesPerSec, fnSamples, err95, pObject, vsReference, minShare };
}

/** Интервалы, между которыми выбирает читатель: от «почти каждый объект» до умолчания Node. */
export const INTERVALS: { value: number; label: string }[] = [
  { value: 512, label: '512 Б' },
  { value: 4 * 1024, label: '4 КБ' },
  { value: 32 * 1024, label: '32 КБ' },
  { value: 128 * 1024, label: '128 КБ' },
  { value: 512 * 1024, label: '512 КБ' },
];

export function fmtPct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const pct = x * 100;
  if (pct >= 100) return `${Math.round(pct)}%`;
  if (pct >= 10) return `${pct.toFixed(0)}%`;
  if (pct >= 0.1) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(3)}%`;
}

export function fmtCount(x: number): string {
  if (x >= 1000) return Math.round(x).toLocaleString('ru-RU');
  if (x >= 10) return x.toFixed(0);
  return x.toFixed(1);
}
