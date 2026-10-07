/** Ярус конвейера V8: имя, короткий ярлык и чем занимается. */
export interface Tier {
  name: string;
  tag: string;
  what: string;
}

/** Шаг сценария: где сейчас код, что в профиле и что пишет `--trace-opt`. */
export interface TierStep {
  /** Индекс активного яруса. */
  tier: number;
  /** Состояние feedback vector на этом шаге. */
  feedback: string;
  message: string;
  tone?: 'warn' | 'err';
  /** Строки лога движка — то, что видно с `--trace-opt` и `--trace-deopt`. */
  log: string[];
}
