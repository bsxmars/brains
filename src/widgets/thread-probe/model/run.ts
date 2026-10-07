import type { ThreadMode, ThreadRun } from './types';
import { WORKER_SOURCE, WORKER_TIMEOUT_MS, burn } from './work';

/**
 * Отзывчивость страницы под нагрузкой — счётчиком кадров в браузере читателя.
 *
 * Зачем считать кадры, а не миллисекунды. Микротайминг здесь померить нечем: без изоляции
 * по источнику `performance.now()` загрублён до сотен микросекунд (записано в
 * `widgets/transfer-cost`, и соседний опрос вкладки это показывает числом). Но вопрос темы
 * другой и крупнее цены деления: **отдаёт ли страница кадры, пока идёт работа.** Пауза между
 * кадрами меряется десятками и сотнями миллисекунд — на такой шкале загрублённые часы точны.
 *
 * Прибор один на два прогона, и работа в них буквально одна и та же функция (`model/work.ts`).
 * Разница ровно в том, **где** она исполняется, — а значит разницу в кадрах больше приписать
 * нечему.
 *
 * ⚠️ Среды может не быть. Остров сперва рендерится в Node, поэтому `requestAnimationFrame`,
 * `Worker` и `performance` спрашиваются **внутри** функций: обращение к ним на уровне модуля
 * уронило бы сборку всей страницы, а не демо. На отсутствие любого предусмотрен честный отказ.
 *
 * ⚠️ Скрытая вкладка кадров не выдаёт вовсе. Замер, снятый в фоне, показал бы «ноль кадров»
 * в обоих режимах и выглядел бы как открытие. Поэтому видимость проверяется до и после
 * прогона, и испорченный замер об этом говорит.
 */

/** Сколько миллисекунд считать по умолчанию. Хватает, чтобы заедание было видно глазом. */
export const DEFAULT_WORK_MS = 700;

interface FrameLog {
  frames: number;
  spanMs: number;
  longestGapMs: number;
}

const hasRaf = (): boolean => typeof requestAnimationFrame === 'function';

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Счётчик кадров.
 *
 * Считается не только их число, но и самая длинная пауза: сто кадров, из которых половина
 * пришла до работы, а половина после, дают приличный средний fps и при намертво вставшей
 * странице. Заедание — это пауза, и его видно только паузой.
 */
function collectFrames(onFrame?: (frames: number) => void) {
  let handle = 0;
  let frames = 0;
  let first = 0;
  let last = 0;
  let previous = 0;
  let longestGap = 0;

  const tick = (stamp: number) => {
    frames += 1;
    if (!first) first = stamp;
    if (previous) longestGap = Math.max(longestGap, stamp - previous);
    previous = stamp;
    last = stamp;
    onFrame?.(frames);
    handle = requestAnimationFrame(tick);
  };

  handle = requestAnimationFrame(tick);

  return {
    stop(): FrameLog {
      cancelAnimationFrame(handle);
      return { frames, spanMs: last - first, longestGapMs: longestGap };
    },
  };
}

/** Дождаться кадра: замер начинается на границе отрисовки, а не посреди неё. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const failed = (mode: ThreadMode, workMs: number, note: string): ThreadRun => ({
  mode,
  ok: false,
  note,
  workMs,
  tookMs: 0,
  spanMs: 0,
  frames: 0,
  fps: 0,
  longestGapMs: 0,
  checksum: 0,
});

function finish(mode: ThreadMode, workMs: number, tookMs: number, checksum: number, log: FrameLog): ThreadRun {
  const hidden = isHidden();
  return {
    mode,
    ok: !hidden,
    note: hidden
      ? 'вкладка была скрыта: фоновой вкладке кадров не выдают вовсе, и этот замер ничего не значит'
      : '',
    workMs,
    tookMs,
    spanMs: log.spanMs,
    frames: log.frames,
    fps: log.spanMs > 0 ? (log.frames - 1) / (log.spanMs / 1000) : 0,
    longestGapMs: log.longestGapMs,
    checksum,
  };
}

/**
 * Работа на главном потоке.
 *
 * `burn` синхронна, и в этом весь смысл: пока она крутится, цикл событий занят, кадры не
 * выдаются, обработчики не зовутся. Никакой уступки внутри нет намеренно — демо показывает
 * именно то, что случается, когда её нет.
 */
export async function measureMain(workMs: number, onFrame?: (frames: number) => void): Promise<ThreadRun> {
  if (!hasRaf()) return failed('main', workMs, 'в этой среде нет `requestAnimationFrame` — считать кадры нечем');
  if (isHidden()) return failed('main', workMs, 'вкладка скрыта: фоновой вкладке браузер кадров не выдаёт');

  await nextFrame();
  const meter = collectFrames(onFrame);
  await nextFrame();

  const started = performance.now();
  const checksum = burn(workMs);
  const tookMs = performance.now() - started;

  // Два кадра после работы: первый браузер выдаёт сразу после освобождения потока, и без
  // второго последняя пауза не попала бы в замер целиком.
  await nextFrame();
  await nextFrame();

  return finish('main', workMs, tookMs, checksum, meter.stop());
}

/** Настоящий выделенный воркер, уже прогретый: рукопожатие прошло, код разобран. */
export interface BurnWorker {
  run(workMs: number): Promise<{ checksum: number; tookMs: number }>;
  dispose(): void;
}

/**
 * Поднять воркер и дождаться первого ответа.
 *
 * `null` — это не сбой демо, а ответ среды: воркеров здесь нет. Такой ответ доезжает
 * до экрана строкой, а не пустым местом.
 */
export async function startBurnWorker(): Promise<BurnWorker | null> {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return null;

  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  // Имя видно в DevTools → Sources → Threads: безымянные потоки в списке не различить.
  const worker = new Worker(url, { name: 'thread-probe' });

  const dispose = () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };

  const run = (workMs: number): Promise<{ checksum: number; tookMs: number }> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('воркер не ответил за отведённое время')), WORKER_TIMEOUT_MS);

      worker.onmessage = (event: MessageEvent<{ checksum: number; tookMs: number }>) => {
        clearTimeout(timer);
        resolve({ checksum: event.data.checksum, tookMs: event.data.tookMs });
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        reject(new Error(event.message || 'ошибка внутри воркера'));
      };

      worker.postMessage({ workMs });
    });

  try {
    await run(0);
  } catch {
    dispose();
    return null;
  }

  return { run, dispose };
}

/**
 * Та же работа, но в воркере.
 *
 * Главный поток в это время не делает ничего — он ждёт сообщения. Кадры идут своим чередом,
 * и это не «оптимизация»: работа никуда не делась и стоит столько же, просто платит за неё
 * другой поток.
 */
export async function measureWorker(
  worker: BurnWorker | null,
  workMs: number,
  onFrame?: (frames: number) => void,
): Promise<ThreadRun> {
  if (!hasRaf()) return failed('worker', workMs, 'в этой среде нет `requestAnimationFrame` — считать кадры нечем');
  if (!worker) return failed('worker', workMs, 'в этой среде нет `Worker` — второго потока взять неоткуда');
  if (isHidden()) return failed('worker', workMs, 'вкладка скрыта: фоновой вкладке браузер кадров не выдаёт');

  await nextFrame();
  const meter = collectFrames(onFrame);
  await nextFrame();

  try {
    const answer = await worker.run(workMs);
    await nextFrame();
    await nextFrame();
    return finish('worker', workMs, answer.tookMs, answer.checksum, meter.stop());
  } catch (failure) {
    meter.stop();
    const message = failure instanceof Error ? failure.message : String(failure);
    return failed('worker', workMs, message);
  }
}
