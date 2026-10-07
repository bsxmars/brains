import type { RunResult } from './run';

/**
 * Выполнить код читателя — в отдельном потоке и с правом его прервать.
 *
 * Авторский пример исполняется прямо на странице (`runWithRuler`): он проверен, и ничего
 * страшного сделать не может. С кодом, который читатель правит сам, так нельзя — и опасность
 * тут вовсе не «злой код»: он свой, в своей вкладке, красть ему нечего. Опасность — обычная
 * опечатка вида `while (true) {}`: из главного потока такой цикл не прерывается ничем, вкладка
 * умирает вместе со всем уроком, и виноватым остаётся сайт.
 *
 * Воркер снимается `terminate()` по таймауту, поэтому бесконечный цикл стоит ровно столько,
 * сколько мы разрешили. Порядок микрозадач внутри воркера тот же, что в главном потоке, — цена
 * примера в тиках остаётся честной.
 *
 * Воркер собирается из строки через `blob:`, а не отдельным файлом: так он не зависит от того,
 * куда бандлер разложит ассеты статической сборки.
 */
/*
 * ⚠️ Вывод отправляется не «через одну макрозадачу», а когда доработали таймеры примера.
 *
 * Раньше здесь стояло `setTimeout(() => postMessage(...), 0)` с комментарием «одна макрозадача —
 * и микроочередь заведомо слита». Для микрозадач это верно, а для таймеров — нет, и на этом
 * ломались сами примеры темы: три сниппета из шести ждут `setTimeout(..., 10)`, и читатель
 * получал обрезанный вывод. В примере про Zalgo пропадала вся «горячая» тройка строк — то есть
 * ровно то явление, ради которого пример и написан. Проверено воспроизведением: собранный
 * вывод на момент отправки — две строки из трёх.
 *
 * Лечение: считаем незавершённые таймеры примера и отправляем вывод, когда счётчик обнулился.
 * Потолок `LIMIT` оставляет прежнюю гарантию — бесконечный цикл или таймер на сутки не держат
 * воркер дольше разрешённого, а `terminate()` снаружи по-прежнему работает.
 */
const SOURCE = `
self.onmessage = (event) => {
  const lines = [];
  const console = {
    log: (...args) => lines.push(args.map(String).join(' ')),
    warn: (...args) => lines.push(args.map(String).join(' ')),
    error: (...args) => lines.push(args.map(String).join(' ')),
  };

  // Дольше этого примеру ждать нечего: он учебный и печатает за десятки миллисекунд.
  const LIMIT = 500;
  const началось = Date.now();
  let живых = 0;
  let отправлено = false;

  const отправить = () => {
    if (отправлено) return;
    отправлено = true;
    self.postMessage({ lines, ok: true });
  };

  // Таймеры примера считаются: пока есть незавершённые, вывод не считается полным.
  const setTimeoutОригинал = self.setTimeout.bind(self);
  const clearTimeoutОригинал = self.clearTimeout.bind(self);
  const наши = new Set();

  self.setTimeout = (fn, delay, ...args) => {
    if (typeof fn !== 'function') return setTimeoutОригинал(fn, delay, ...args);
    живых++;
    const id = setTimeoutОригинал(() => {
      наши.delete(id);
      try { fn(...args); } finally { живых--; проверить(); }
    }, delay, ...args);
    наши.add(id);
    return id;
  };

  /*
   * ⚠️ Снятие таймера тоже уменьшает счётчик. Без этого пример, который завёл таймер
   * и тут же снял его через clearTimeout, честно печатал свой вывод — но держал отправку
   * до страховки: 500 мс вместо мгновенного ответа. Замер до правки: 501 мс на примере
   * из двух строк.
   */
  self.clearTimeout = (id) => {
    if (наши.delete(id)) { живых--; проверить(); }
    return clearTimeoutОригинал(id);
  };

  const проверить = () => {
    if (живых === 0 || Date.now() - началось > LIMIT) отправить();
  };

  try {
    new Function('console', event.data.code)(console);
  } catch (error) {
    self.postMessage({ lines, ok: false, error: String(error) });
    return;
  }

  // Одна макрозадача сливает микроочередь; если таймеров нет — этого и достаточно.
  setTimeoutОригинал(проверить, 0);
  // Страховка: пример с бесконечно откладывающимся таймером не держит вывод вечно.
  setTimeoutОригинал(отправить, LIMIT);
};
`;

export interface RunOptions {
  /** Сколько ждать, прежде чем считать код зациклившимся. */
  timeoutMs?: number;
}

export async function runInWorker(code: string, options: RunOptions = {}): Promise<RunResult> {
  const { timeoutMs = 2000 } = options;

  if (typeof Worker === 'undefined') {
    return { lines: [], ok: false, error: 'Воркеры недоступны в этой среде' };
  }

  const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
  const worker = new Worker(url);

  try {
    return await new Promise<RunResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          lines: [],
          ok: false,
          error: `Код не завершился за ${timeoutMs} мс — похоже на бесконечный цикл. Выполнение прервано.`,
        });
      }, timeoutMs);

      worker.onmessage = (event: MessageEvent<RunResult>) => {
        clearTimeout(timer);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        resolve({ lines: [], ok: false, error: event.message || 'Ошибка выполнения' });
      };

      worker.postMessage({ code });
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
}
