/**
 * «Стадо» переподключений на виртуальных часах.
 *
 * Сервер перезапустился — и все клиенты разом потеряли соединение. Дальше каждый действует
 * по своей формуле задержки, а сервер после подъёма принимает ограниченное число рукопожатий
 * в единицу времени. Сколько попыток придёт в каждые полсекунды — зависит только от формулы.
 *
 * Формула — та самая `nextDelay` из `CLIENT_CODE` темы «Долгие соединения»: демо собирает её
 * из напечатанной строки, как и тест (`tests/unit/realtime.test.ts`). Три стратегии отличаются
 * **параметрами**, а не кодом:
 *   — «раз в секунду»: задержка постоянная (`base = cap = 1000`, джиттер выключен);
 *   — «экспонента»: та же формула, но `random` всегда 1 — джиттера нет;
 *   — «экспонента + джиттер»: формула как есть, `random` — детерминированный генератор.
 *
 * Часы виртуальные, случайность воспроизводимая (`mulberry32`): одинаковые входы дают
 * одинаковый график и в демо, и в тесте. Ни DOM, ни Vue.
 */

export type NextDelay = (
  attempt: number,
  options?: { base?: number; cap?: number; random?: () => number },
) => number;

export function loadBackoff(code: string): NextDelay {
  const body = code.replace(/^export /gm, '');
  return new Function(`${body}\nreturn nextDelay;`)() as NextDelay;
}

export type Strategy = 'fixed' | 'exp' | 'jitter';

export interface HerdInput {
  clients: number;
  /** Сколько миллисекунд сервер лежит после обрыва. */
  outage: number;
  /** Сколько рукопожатий сервер принимает за одно окно `bucket`. */
  capacity: number;
  bucket: number;
  horizon: number;
  strategy: Strategy;
  /** Потолок задержки, мс: параметр `cap` той же `nextDelay`. */
  cap: number;
  seed: number;
}

export interface HerdResult {
  /** Попытки подключения по окнам времени. */
  attempts: number[];
  /** Из них принятые. */
  accepted: number[];
  /** Больше всего попыток в одном окне после подъёма сервера. */
  peakAfterUp: number;
  /** Попыток после подъёма, которым сервер отказал: не хватило ёмкости. */
  rejectedAfterUp: number;
  total: number;
  connected: number;
  /** Когда подключился последний клиент, мс; `null` — не успели до горизонта. */
  doneAt: number | null;
}

/** Детерминированный генератор: одинаковое зерно — одинаковая последовательность. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function delayFor(
  nextDelay: NextDelay,
  strategy: Strategy,
  attempt: number,
  cap: number,
  random: () => number,
): number {
  if (strategy === 'fixed') return nextDelay(0, { base: 1000, cap: 1000, random: () => 1 });
  if (strategy === 'exp') return nextDelay(attempt, { cap, random: () => 1 });
  return nextDelay(attempt, { cap, random });
}

export function simulateHerd(nextDelay: NextDelay, input: HerdInput): HerdResult {
  const { clients, outage, capacity, bucket, horizon, strategy, cap } = input;
  const random = mulberry32(input.seed);
  const windows = Math.ceil(horizon / bucket);
  const attempts = new Array<number>(windows).fill(0);
  const accepted = new Array<number>(windows).fill(0);

  // Очередь событий «клиент i пробует в момент t» — у каждого клиента одно ожидающее событие.
  let queue: { t: number; client: number; attempt: number }[] = [];
  for (let c = 0; c < clients; c++) queue.push({ t: delayFor(nextDelay, strategy, 0, cap, random), client: c, attempt: 1 });

  let connected = 0;
  let doneAt: number | null = null;
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t);
    const next: typeof queue = [];
    // Разбираем всё, что попало в одно окно, и лишь потом планируем повторы.
    const w = Math.floor(queue[0].t / bucket);
    if (w >= windows) break;
    for (const ev of queue) {
      if (Math.floor(ev.t / bucket) !== w) {
        next.push(ev);
        continue;
      }
      attempts[w]++;
      const up = ev.t >= outage;
      if (up && accepted[w] < capacity) {
        accepted[w]++;
        connected++;
        if (connected === clients) doneAt = ev.t;
        continue;
      }
      next.push({
        t: ev.t + delayFor(nextDelay, strategy, ev.attempt, cap, random),
        client: ev.client,
        attempt: ev.attempt + 1,
      });
    }
    queue = next;
  }

  const afterUp = attempts.slice(Math.floor(outage / bucket));
  return {
    attempts,
    accepted,
    peakAfterUp: Math.max(0, ...afterUp),
    rejectedAfterUp: afterUp.reduce((s, x) => s + x, 0) - connected,
    total: attempts.reduce((s, x) => s + x, 0),
    connected,
    doneAt,
  };
}
