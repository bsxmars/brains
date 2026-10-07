/**
 * Состояние конвейера, снятое с настоящих объектов платформы.
 *
 * Здесь нет ни одного «нарисованного» числа: `desired` и `writerDesired` читаются прямо
 * у `ReadableStreamDefaultController` и `WritableStreamDefaultWriter`, а очередь — это то,
 * что в них действительно лежит. Демо показывает работу спецификации, а не её пересказ.
 */

/** Как устроен источник — от этого зависит, работает ли обратное давление вообще. */
export type SourceMode = 'pull' | 'push';

export interface PipeOptions {
  /** Сколько модельных миллисекунд уходит у источника на один чанк. */
  produceMs: number;
  /** Сколько модельных миллисекунд сток жуёт один чанк. */
  consumeMs: number;
  /** Лимит очереди читаемого стрима, в чанках. */
  highWaterMark: number;
  mode: SourceMode;
}

/** Что делает источник в этот момент. */
export type SourceState = 'работает' | 'спит: pull не зовут' | 'кладёт мимо давления';
/** Насос — тот самый цикл `await writer.ready` → `read()` → `write()`. */
export type PumpState = 'ждёт ready' | 'читает';
export type SinkState = 'занят' | 'простаивает';

export interface Snapshot {
  /** Модельное время, мс. */
  t: number;
  /** Метки чанков, лежащих в очереди читаемого стрима. */
  queue: string[];
  /** `controller.desiredSize` читаемого стрима. `null` — стрим в ошибке. */
  desired: number | null;
  /** `writer.desiredSize` записываемого стрима. */
  writerDesired: number | null;
  produced: number;
  delivered: number;
  source: SourceState;
  pump: PumpState;
  sink: SinkState;
}
