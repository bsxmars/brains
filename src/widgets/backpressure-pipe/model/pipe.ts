import type { PipeOptions, PumpState, SinkState, Snapshot, SourceState } from './types';

/**
 * Конвейер из настоящих `ReadableStream` и `WritableStream` — с часами, которыми управляем мы.
 *
 * Почему не обычные таймеры. Демо обязано уметь три вещи сразу: идти само, листаться по шагам
 * и отматываться назад. С `setTimeout` первое получается, а остальные два нет — «шаг назад»
 * во времени невозможен, и снять состояние ровно на границе шага тоже нельзя: она приходится
 * на середину чьей-то микрозадачи.
 *
 * Поэтому время здесь модельное: `sleep()` внутри источника и стока встаёт в список ожидающих,
 * а `tick()` двигает часы на один шаг и будит всех, кому пора. Стримы при этом настоящие —
 * очередь, `desiredSize`, флаг обратного давления и порядок вызовов ведёт платформа, а не мы.
 * Снимок делается после того, как очередь микрозадач опустела, то есть в момент, когда
 * платформа довела до конца всё, что выросло из сработавших таймеров.
 *
 * Отсюда и честность записи: история шагов — не сценарий, написанный автором, а протокол того,
 * что спецификация сделала на самом деле. Юнит-тест сверяет с ней арифметику
 * `desiredSize = highWaterMark − queueTotalSize` — на объектах, а не на формуле.
 */

/** Один шаг демо — 50 мс модельного времени. */
export const TICK_MS = 50;

/** Длина сценария: 72 шага по 50 мс — 3.6 секунды модельного времени. */
export const TICKS = 72;

/** Часы, которые не идут сами. */
class Clock {
  now = 0;
  private waiting: { at: number; wake: () => void }[] = [];

  sleep(ms: number): Promise<void> {
    return new Promise((wake) => {
      this.waiting.push({ at: this.now + ms, wake });
    });
  }

  advance(ms: number): void {
    this.now += ms;
    const due = this.waiting.filter((w) => w.at <= this.now);
    this.waiting = this.waiting.filter((w) => w.at > this.now);
    for (const w of due) w.wake();
  }
}

export class BackpressurePipe {
  private readonly clock = new Clock();
  private readonly options: PipeOptions;

  private stopped = false;
  private produced = 0;
  private delivered = 0;
  /** Метки чанков, лежащих в очереди читаемого стрима: их же показывает лента очереди. */
  private labels: string[] = [];
  private controller: ReadableStreamDefaultController<string> | null = null;
  private writer: WritableStreamDefaultWriter<string> | null = null;

  private inPull = false;
  private pump: PumpState = 'ждёт ready';
  private sink: SinkState = 'простаивает';

  constructor(options: PipeOptions) {
    this.options = options;

    const readable = new ReadableStream<string>(
      {
        start: (controller) => {
          this.controller = controller;
          // Push-источник не спрашивает разрешения: он подписан на события, а события
          // приходят независимо от `desiredSize`. Именно здесь обратное давление и рвётся.
          if (options.mode === 'push') void this.pushLoop();
        },

        // Pull-источник, наоборот, работает только по приглашению: платформа зовёт `pull`,
        // пока `desiredSize > 0`, и не зовёт, когда места нет. Возвращённый промис —
        // встроенная защита от самонаполнения: следующего вызова не будет, пока он висит.
        pull: async () => {
          if (options.mode === 'push') return;
          this.inPull = true;
          await this.clock.sleep(options.produceMs);
          this.inPull = false;
          if (this.stopped) return;
          this.enqueue();
        },

        cancel: () => {
          this.stopped = true;
        },
      },
      new CountQueuingStrategy({ highWaterMark: options.highWaterMark }),
    );

    const writable = new WritableStream<string>(
      {
        write: async () => {
          this.sink = 'занят';
          await this.clock.sleep(options.consumeMs);
          this.sink = 'простаивает';
          this.delivered += 1;
        },
      },
      // Один чанк — дефолт спеки, и трогать его тут незачем: разговор про очередь источника.
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );

    void this.runPump(readable, writable);
  }

  /** Положить чанк в очередь. Закрытый или сломанный стрим на это бросает — не роняем демо. */
  private enqueue(): void {
    if (!this.controller) return;
    this.produced += 1;
    const label = `c${this.produced}`;
    try {
      this.controller.enqueue(label);
      this.labels.push(label);
    } catch {
      this.stopped = true;
    }
  }

  private async pushLoop(): Promise<void> {
    for (;;) {
      await this.clock.sleep(this.options.produceMs);
      if (this.stopped) return;
      this.enqueue();
    }
  }

  /**
   * Тот самый цикл записи из раздела про `WritableStream`: ждать `ready`, а не `write`.
   *
   * `writer.write()` намеренно без `await` — иначе конвейер выродился бы в последовательное
   * выполнение. Промис от него всё же ловим: без `catch` упавшая запись стала бы
   * `unhandledrejection`, а ошибку мы и так увидим на `ready`.
   */
  private async runPump(readable: ReadableStream<string>, writable: WritableStream<string>): Promise<void> {
    const reader = readable.getReader();
    this.writer = writable.getWriter();

    for (;;) {
      this.pump = 'ждёт ready';
      try {
        await this.writer.ready;
      } catch {
        return;
      }
      if (this.stopped) return;

      this.pump = 'читает';
      const { value, done } = await reader.read();
      if (done || this.stopped || value === undefined) return;

      this.labels.shift();
      this.writer.write(value).catch(() => {});
    }
  }

  /**
   * Дать платформе доделать всё, что выросло из сработавших таймеров.
   *
   * Граница макрозадачи осушает очередь микрозадач целиком, включая добавленное во время
   * слива, — значит, к следующей строке платформа уже приняла все решения об этом шаге.
   * Второй проход нужен из-за цепочек, которые сами ставят таймер нулевой длины.
   */
  private async settle(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  private get source(): SourceState {
    if (this.options.mode === 'push') return 'кладёт мимо давления';
    return this.inPull ? 'работает' : 'спит: pull не зовут';
  }

  /** Снимок состояния настоящих объектов. Ни одно число здесь не вычисляется нами. */
  snapshot(): Snapshot {
    return {
      t: this.clock.now,
      queue: [...this.labels],
      desired: this.controller ? this.controller.desiredSize : null,
      writerDesired: this.writer ? this.writer.desiredSize : null,
      produced: this.produced,
      delivered: this.delivered,
      source: this.source,
      pump: this.pump,
      sink: this.sink,
    };
  }

  /** Состояние на нулевом шаге: платформа уже успела позвать источник, время ещё не шло. */
  async begin(): Promise<Snapshot> {
    await this.settle();
    return this.snapshot();
  }

  /** Продвинуть модельное время на один шаг и снять, что из этого вышло. */
  async tick(): Promise<Snapshot> {
    this.clock.advance(TICK_MS);
    await this.settle();
    return this.snapshot();
  }

  stop(): void {
    this.stopped = true;
  }
}

/** Прогнать конвейер целиком и вернуть историю по шагам — этим пользуется и демо, и тест. */
export async function runPipe(options: PipeOptions, ticks = TICKS): Promise<Snapshot[]> {
  const pipe = new BackpressurePipe(options);
  const history = [await pipe.begin()];
  for (let i = 0; i < ticks; i += 1) history.push(await pipe.tick());
  pipe.stop();
  return history;
}
