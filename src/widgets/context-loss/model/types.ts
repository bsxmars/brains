/**
 * Две стратегии обработки `webglcontextlost` — и разница между ними не косметическая.
 *
 * `naive` — как пишут в большинстве проектов: слушателя нет вовсе или он только пишет в лог.
 * Контекст при этом **не восстановится никогда**: браузер возвращает его только тому, кто явно
 * попросил, отменив событие по умолчанию. Проверено запуском, см. шапку `data.ts` темы.
 *
 * `correct` — `preventDefault()` на потере и полная пересборка ресурсов на восстановлении.
 */
export type LossStrategy = 'naive' | 'correct';

export interface StrategyOption {
  key: LossStrategy;
  label: string;
  /** Что этот вариант делает в обработчике. */
  code: string;
  /** Чем это кончится. */
  note: string;
  tone: 'err' | 'ok';
}

/** Строка журнала событий демо. */
export interface LossEvent {
  at: string;
  text: string;
  tone: 'info' | 'err' | 'ok';
}
