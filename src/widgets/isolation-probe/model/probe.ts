/**
 * Что эта вкладка на самом деле умеет из общей памяти — проверкой, а не обещанием.
 *
 * Демо с `SharedArrayBuffer` на статическом сайте заработать не может: общая память требует
 * заголовков `Cross-Origin-Opener-Policy` и `Cross-Origin-Embedder-Policy` на документе,
 * а заголовки отдаёт сервер — их нет в HTML и их нечем подставить из JS. Притворяться тут
 * нечестно и незачем: отсутствие изоляции — такой же факт платформы, как и всё остальное
 * в этом уроке, и показать его интереснее, чем спрятать.
 *
 * Поэтому демо не «падает молча», а перечисляет, что именно проверено и с каким результатом.
 */
export type ProbeTone = 'ok' | 'warn' | 'err' | 'dim';

export interface ProbeRow {
  key: string;
  label: string;
  /** Что вернула проверка — строкой, как есть. */
  value: string;
  tone: ProbeTone;
  /** Что это значит. */
  note: string;
}

export interface ProbeReport {
  isolated: boolean;
  rows: ProbeRow[];
}

/**
 * Наименьший различимый шаг `performance.now()`, мс.
 *
 * Это и есть цена деления всех замеров на странице. Без изоляции браузер грубит часы
 * до сотен микросекунд — ровно из-за Spectre, из-за которого выключена и общая память.
 * Цикл ограничен и сверху, и по числу найденных шагов: это измерение, а не busy-wait.
 */
function timerStep(): number {
  let previous = performance.now();
  let smallest = Infinity;
  let found = 0;

  for (let i = 0; i < 300_000 && found < 3; i++) {
    const now = performance.now();
    if (now !== previous) {
      const delta = now - previous;
      if (delta > 0 && delta < smallest) smallest = delta;
      previous = now;
      found += 1;
    }
  }
  return smallest === Infinity ? 0 : smallest;
}

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const shared = event.data.shared;
  self.postMessage({
    got: Object.prototype.toString.call(shared),
    bytes: shared && shared.byteLength,
  });
};
`;

/** Дошёл ли `SharedArrayBuffer` до настоящего выделенного воркера — и чем именно кончилось. */
async function sendSharedToWorker(shared: ArrayBufferLike): Promise<{ value: string; tone: ProbeTone }> {
  if (typeof Worker === 'undefined') {
    return { value: 'воркеры недоступны', tone: 'dim' };
  }

  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: 'isolation-probe' });

  try {
    return await new Promise<{ value: string; tone: ProbeTone }>((resolve) => {
      const timer = setTimeout(() => resolve({ value: 'воркер не ответил за 1500 мс', tone: 'warn' }), 1500);

      worker.onmessage = (event: MessageEvent<{ got: string; bytes: number }>) => {
        clearTimeout(timer);
        resolve({ value: `доехал: ${event.data.got}, ${event.data.bytes} байт`, tone: 'ok' });
      };
      // Отдельное событие, и вешают его почти никогда: сообщение доехало, но
      // не десериализовалось в целевом агенте. Без него это выглядит как «сообщения пропадают».
      worker.onmessageerror = () => {
        clearTimeout(timer);
        resolve({ value: 'messageerror у получателя', tone: 'err' });
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        resolve({ value: event.message || 'ошибка воркера', tone: 'err' });
      };

      try {
        worker.postMessage({ shared });
      } catch (failure) {
        clearTimeout(timer);
        const error = failure as { name?: string };
        resolve({ value: `${error?.name ?? 'Error'} при отправке`, tone: 'err' });
      }
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}

/**
 * Достать общий буфер. Без изоляции имя `SharedArrayBuffer` в Chromium спрятано, но
 * `new WebAssembly.Memory({ shared: true })` его всё равно отдаёт (снято 2026-10-29: `wait` —
 * `TypeError`, `notify` — 0, `postMessage` — `DataCloneError` у отправителя). До этой даты
 * демо без имени печатало «создать общий буфер не из чего», что спорило с подписью урока.
 */
function sharedBuffer(): { buffer: ArrayBufferLike; via: string } | null {
  if (typeof SharedArrayBuffer === 'function') {
    return { buffer: new SharedArrayBuffer(8), via: 'new SharedArrayBuffer' };
  }
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    return { buffer: memory.buffer, via: 'WebAssembly.Memory' };
  } catch {
    return null;
  }
}

export async function probeIsolation(): Promise<ProbeReport> {
  const rows: ProbeRow[] = [];
  const isolated = self.crossOriginIsolated === true;

  rows.push({
    key: 'isolated',
    label: 'self.crossOriginIsolated',
    value: String(self.crossOriginIsolated),
    tone: isolated ? 'ok' : 'err',
    note: isolated
      ? 'документ изолирован: общая память и точные часы доступны'
      : 'единственная верная проверка — и она отрицательна: поделиться памятью с воркером на этой странице нельзя',
  });

  const step = timerStep();
  rows.push({
    key: 'timer',
    label: 'шаг performance.now()',
    value: `${step.toFixed(3)} мс`,
    tone: step >= 0.05 ? 'warn' : 'ok',
    note:
      step >= 0.05
        ? 'часы загрублены — это тот самый ответ браузеров на Spectre, и им же меряет соседнее демо'
        : 'часы точные: изоляция снимает загрубление, потому что красть в этом процессе нечего',
  });

  const constructor = typeof SharedArrayBuffer;
  rows.push({
    key: 'ctor',
    label: 'typeof SharedArrayBuffer',
    value: `'${constructor}'`,
    tone: constructor === 'function' ? 'ok' : 'warn',
    note:
      constructor === 'function'
        ? 'имя конструктора есть — но изоляцию доказывает только crossOriginIsolated'
        : 'имя спрятано, но это ещё не значит, что общего буфера нет: его отдаёт общая память WebAssembly',
  });

  const shared = sharedBuffer();
  rows.push({
    key: 'buffer',
    label: 'общий буфер',
    value: shared ? `${shared.via}: ${Object.prototype.toString.call(shared.buffer)}` : 'создать не удалось',
    tone: shared ? 'ok' : 'dim',
    note: shared
      ? 'буфер создан — дальше видно, что с ним можно делать в этой вкладке'
      : 'в этом браузере нет ни имени SharedArrayBuffer, ни общей памяти WebAssembly — проверять дальше нечего',
  });
  if (!shared) return { isolated, rows };

  const view = new Int32Array(shared.buffer, 0, 2);

  // Ожидаемое значение намеренно не совпадает с содержимым: даже там, где `wait` разрешён,
  // он вернётся немедленно с 'not-equal'. Демо не имеет права заблокировать вкладку.
  let waitOutcome: ProbeRow;
  try {
    const result = Atomics.wait(view, 0, 1, 0);
    waitOutcome = {
      key: 'wait',
      label: 'Atomics.wait на главном потоке',
      value: `вернул '${result}'`,
      tone: 'warn',
      note: 'в браузере этого быть не должно: главному потоку засыпать нельзя',
    };
  } catch (failure) {
    const error = failure as { name?: string; message?: string };
    waitOutcome = {
      key: 'wait',
      label: 'Atomics.wait на главном потоке',
      value: `${error?.name ?? 'Error'}: ${error?.message ?? ''}`,
      tone: 'ok',
      note: 'так и задумано: заблокированный главный поток не прочитал бы сообщение, которое его разбудит',
    };
  }
  rows.push(waitOutcome);

  rows.push({
    key: 'notify',
    label: 'Atomics.notify с главного потока',
    value: `вернул ${Atomics.notify(view, 0, 1)}`,
    tone: 'ok',
    note: 'блокируется только wait: будить воркеры главному потоку никто не запрещает',
  });

  const sent = await sendSharedToWorker(shared.buffer);
  rows.push({
    key: 'share',
    label: 'общий буфер в выделенный воркер',
    value: sent.value,
    tone: isolated ? sent.tone : sent.tone === 'err' ? 'ok' : 'warn',
    note: isolated
      ? 'копии не будет: обе стороны получают вид на один и тот же физический блок'
      : 'без изоляции отправка обязана упасть у отправителя: буфер есть, а поделиться им нельзя',
  });

  return { isolated, rows };
}
