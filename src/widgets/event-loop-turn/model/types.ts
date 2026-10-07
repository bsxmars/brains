/** Шаг сценария «один оборот цикла»: состояние машины на этом шаге целиком. */
export interface TurnStep {
  /** Подсвеченная строка листинга; −1 — ни одной. */
  line: number;
  /** Где сейчас цикл: задача, checkpoint или рендер-фаза. */
  phase: string;
  message: string;
  tone?: 'ok' | 'warn' | 'err';
  stack: string[];
  micro: string[];
  /** Очереди задач: у каждой одно значение или «—», если пусто. */
  tasks: { timer: string; input: string; raf: string };
  out: string[];
}
