/** Шаг сценария: что на стеке, что в микроочереди и есть ли сейчас чекпоинт. */
export interface CheckpointStep {
  message: string;
  tone?: 'ok' | 'warn' | 'err';
  stack: string[];
  micro: string[];
  out: string[];
  /** Строка-вердикт: сработал ли checkpoint в этот момент. */
  checkpoint: string;
}

/** Способ вызвать слушателя: настоящий клик или программный. */
export interface CheckpointMode {
  key: string;
  label: string;
  steps: CheckpointStep[];
  /** Итог сценария — показывается, когда шаги пройдены. */
  result: string;
  tone: 'ok' | 'warn';
}
