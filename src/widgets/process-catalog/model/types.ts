/** Процесс браузера: права, задачи и последствия падения. */
export interface ProcessInfo {
  label: string;
  /** Сколько таких процессов бывает. */
  count: string;
  /** Строка про песочницу; по ней же выбирается цвет: «БЕЗ» — красный, «ослаб» — янтарный. */
  sandbox: string;
  what: string;
  crash: string;
  note: string;
  tone?: 'ok' | 'warn' | 'err';
}
