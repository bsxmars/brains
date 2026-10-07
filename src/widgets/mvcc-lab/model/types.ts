/** Уровень изоляции так, как его называет `transaction_isolation`. */
export type Level = 'read committed' | 'repeatable read' | 'serializable';

export type SessionName = 'A' | 'B';

/** Строка таблицы: столбец → значение. */
export type Row = Record<string, string | number | boolean>;

/** Условие `WHERE`: равенство столбцу или `>=` числу. */
export type Where = Record<string, string | number | boolean | { gte: number }>;

export type RowLockMode = 'key share' | 'share' | 'no key update' | 'update';

/** Что делает шаг сценария в учебной модели. SQL рядом — то, что выполнял настоящий Postgres. */
export type Op =
  | { t: 'begin' }
  | { t: 'commit' }
  | { t: 'rollback' }
  | { t: 'select'; where: Where; cols?: string[]; count?: boolean; lock?: RowLockMode }
  | { t: 'update'; where: Where; set: Record<string, string | number | boolean | { add: number }> }
  | { t: 'insert'; row: Row }
  | { t: 'delete'; where: Where };

export interface Step {
  s: SessionName;
  sql: string;
  op: Op;
}

export interface Scenario {
  id: string;
  /** Группа для переключателя. */
  group: 'read' | 'write' | 'hard';
  label: string;
  table: 'accounts' | 'doctors';
  /** Столбец, по которому строки различают в таблице версий. */
  key: string;
  /** Столбцы, которые показывает таблица версий. */
  show: string[];
  rows: Row[];
  steps: Step[];
  /** Запрос после сценария, отдельной транзакцией: что осталось в базе. */
  check: { sql: string; op: Op };
  /** Подпись над шагами. Строчная разметка. */
  note: string;
  /** Итог по уровню. Строчная разметка; тест проверяет, что в нём стоит итоговое значение. */
  verdict: Record<Level, string>;
}

export interface Snapshot {
  xmin: number;
  xmax: number;
  xip: number[];
}

export interface Version {
  row: Row;
  xmin: number;
  xmax: number | null;
  xmaxMode: RowLockMode | null;
  locks: { xid: number; mode: RowLockMode }[];
  next: Version | null;
}

export interface Tx {
  name: SessionName;
  level: Level;
  state: 'active' | 'committed' | 'aborted';
  xid: number | null;
  snap: Snapshot | null;
  snapAt: number | null;
  doneAt: number | null;
  reads: Where[];
  writes: Row[];
}

export interface Db {
  status: Record<number, 'committed' | 'aborted'>;
  running: Set<number>;
  lastCompleted: number;
  nextXid: number;
  versions: Version[];
  txs: Tx[];
  clock: number;
}

export interface Session {
  name: SessionName;
  tx: Tx | null;
}

/** Результат шага: строки вывода `psql`, ошибка, ждал ли шаг блокировку и до какого шага (с нуля). */
export interface StepRecord {
  s: SessionName;
  sql: string;
  lines: string[] | null;
  error: { code: string; message: string } | null;
  waited: boolean;
  until: number | null;
}

export interface ScheduleRun {
  out: StepRecord[];
  db: Db;
  sessions: Record<SessionName, Session>;
}

export interface MvccModel {
  runSchedule(rows: Row[], steps: Step[], level: Level, upTo?: number): ScheduleRun;
  createDb(rows: Row[]): Db;
  execute(db: Db, session: Session, op: Op, level: Level): Generator<{ wait: number }, string[], undefined>;
  takeSnapshot(db: Db): Snapshot;
  visible(db: Db, tx: Tx, snap: Snapshot, v: Version): boolean;
  CONFLICTS: Record<RowLockMode, RowLockMode[]>;
}
