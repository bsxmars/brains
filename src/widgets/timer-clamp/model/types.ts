/** Сценарий прибора. Три разных обещания таймера — три разных замера. */
export type TimerKey = 'nesting' | 'busy' | 'interval';

export type TimerTone = 'ok' | 'warn' | 'err';

/**
 * Одна ступень лесенки вложенности.
 *
 * `requested` — что попросили у `setTimeout` (всегда `0`), `actual` — сколько прошло на самом
 * деле между вызовом и колбэком. Именно расхождение этих двух чисел и есть клампинг; держать
 * их в одной строке обязательно, иначе таблица снова начнёт пересказывать спецификацию.
 */
export interface TimerLevel {
  level: number;
  requested: number;
  actual: number;
  /** Уровень, на котором спецификация разрешает движку поднять задержку: вложенность > 5. */
  clamped: boolean;
}

/** Снятое число с подписью — готовое к показу, с единицами. */
export interface TimerValue {
  label: string;
  value: string;
  tone?: TimerTone;
}

/**
 * Промежуток между двумя срабатываниями `setInterval` — фишкой в консоли.
 *
 * `late` означает «промежуток заметно длиннее заказанного периода»: интервал не догоняет
 * пропущенное, и видно это только по разрыву между соседними срабатываниями.
 */
export interface TimerMark {
  text: string;
  late: boolean;
}

/** Итог одного настоящего замера. Ни одно поле не написано заранее. */
export interface TimerRun {
  key: TimerKey;
  /**
   * Замер состоялся: в среде нашлись и часы, и таймеры.
   *
   * `false` — не ошибка демо, а честный ответ: показать нечего. Ветка нужна, чтобы модуль
   * можно было импортировать откуда угодно, включая серверный рендер острова.
   */
  measured: boolean;
  levels: TimerLevel[];
  values: TimerValue[];
  marks: TimerMark[];
  verdict: string;
  tone: TimerTone;
}

/** Параметры прибора. Их задаёт автор темы пропами — модель работает и без них. */
export interface TimerParams {
  /** Глубина цепочки вложенных `setTimeout(…, 0)`. */
  depth?: number;
  /** Заказанная задержка в сценарии с занятым потоком, мс. */
  requested?: number;
  /** Сколько миллисекунд поток будет занят синхронной работой. */
  busyMs?: number;
  /** Период `setInterval`, мс. */
  period?: number;
  /** Длина окна наблюдения за интервалом, мс. */
  spanMs?: number;
}

/** Описание сценария: что показываем, каким кодом и чего это число не доказывает. */
export interface TimerScenario {
  key: TimerKey;
  label: string;
  title: string;
  lead: string;
  /** Тот же код, который исполняет модель. */
  code: string[];
  /** Что здесь нормативно, а что — про эту машину в эту минуту. */
  caveat: string;
  notes: string[];
}
