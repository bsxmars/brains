/** Поток внутри рендерера: что делает, чем важен и что из этого следует. */
export interface ThreadInfo {
  label: string;
  does: string[];
  /** Одна фраза, ради которой поток стоит запомнить. */
  key: string;
  note: string;
  tone?: 'ok' | 'err';
}
