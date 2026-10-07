/**
 * Кадр стека, как его возвращает `parseStack` из темы: всё, что можно достать из строки
 * `    at …` V8. Строка и колонка — с единицы, как в самом стеке.
 */
export interface Frame {
  /** Имя так, как его напечатал V8: `saveOrder`, `new Order`, `Promise.all`; `null` — без имени. */
  fn: string | null;
  /** Файл или адрес; `null` — кадр без файла: встроенная функция, `index 1`, код из `eval`. */
  file: string | null;
  line: number | null;
  col: number | null;
  /** Кадр восстановлен по цепочке `await` (`at async …`), а не снят с настоящего стека. */
  async: boolean;
}

export type ParseFn = (stack: string) => Frame[];

export interface SerializeOptions {
  maxFrames?: number;
  maxDepth?: number;
}

export type SerializeFn = (value: unknown, options?: SerializeOptions) => unknown;

/** Сценарий асинхронного стека: файл, его код и два снятых стека — Node и Chromium. */
export interface AsyncCase {
  id: string;
  label: string;
  /** Имя файла на стенде — то, что стоит в адресах кадров. */
  file: string;
  code: string;
  /** `error.stack`, напечатанный Node 24.11 (путь до стенда заменён на `/app`). */
  node: string;
  /** `error.stack` из Chromium 153: тот же файл модулем со своего `node:http`. */
  chromium: string;
  /** Подпись к сценарию: что пропало и почему. Строчная разметка. */
  note: string;
}

/** Случай для сборщика отчёта: код, который бросает (или отклоняет) что-то, и подпись. */
export interface ReportCase {
  id: string;
  label: string;
  code: string;
  note: string;
}

/** Итог прогона случая: что вылетело наружу. */
export interface CaseResult {
  thrown: boolean;
  value: unknown;
}
