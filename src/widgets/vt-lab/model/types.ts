/** Сценарии демо: каждый запускает настоящий `startViewTransition`, отличаются они тем, что мешает переходу. */
export type VtScenarioKey = 'plain' | 'slow' | 'duplicate' | 'skip' | 'overlap';

export interface VtScenario {
  key: VtScenarioKey;
  /** Подпись на переключателе. */
  label: string;
  /** Что смотреть в журнале — строчная разметка через `Md`. */
  note: string;
  tone: 'info' | 'warn' | 'err' | 'ok';
}

/** Род записи журнала — от него зависит только цвет строки. */
export type VtTone = 'sync' | 'call' | 'ok' | 'err' | 'info';

export interface VtLogEntry {
  /** Номер кадра от начала прогона: счётчик `requestAnimationFrame`. */
  frame: number;
  tone: VtTone;
  /** Строчная разметка: имена API в обратных кавычках. */
  text: string;
}

/** Одна живая анимация псевдоэлемента из `document.getAnimations()`. */
export interface VtAnimRow {
  /** `group`, `image-pair`, `old`, `new`. */
  part: string;
  /** Имя перехода в скобках: `vt-card-a`. */
  name: string;
  /** `animationName` у `CSSAnimation`: у встроенных анимаций браузера префикс `-ua-`. */
  animation: string;
  /** `getComputedTiming().duration` в миллисекундах. */
  duration: number;
  state: string;
}
