/** Сценарий демо «обход на ходу»: код с `visit(k)` и вывод, который читатель делает из журнала. */
export interface IterScenario {
  key: string;
  label: string;
  /** Исполняемый код. Объявляет `m` и вызывает `visit(k)` на каждом шаге `for…of`. */
  code: string;
  verdict: string;
  tone: 'ok' | 'warn' | 'err';
}

export interface IterRun {
  /** Ключи в том порядке, в каком их выдал `for…of`. */
  visited: string[];
  /** `true`, если журнал оборвал цикл: тот не закончился бы сам. */
  looped: boolean;
  /** Записи таблицы после цикла: `a → 1`. */
  after: string[];
}
