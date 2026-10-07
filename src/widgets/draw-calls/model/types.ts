/** Три способа нарисовать одну и ту же тысячу квадратов. */
export type DrawModeKey = 'calls' | 'instanced' | 'batch';

export interface DrawMode {
  key: DrawModeKey;
  label: string;
  /** Как выглядит горячая часть кода — то, что исполняется каждый кадр. */
  code: string;
  /** Что именно изменилось по сравнению с соседним вариантом. */
  note: string;
  tone: 'err' | 'warn' | 'ok';
}
