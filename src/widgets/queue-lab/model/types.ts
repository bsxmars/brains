/** Кто выполняет шаг: издатель `P`, ретранслятор `R`, обработчики `w1`, `w2`. */
export type Who = 'P' | 'R' | 'w1' | 'w2';

export type Action = 'place' | 'relay' | 'publish' | 'readNew' | 'readOwn' | 'claimStale';

/** Шаг расписания: `[кто, действие, аргумент]` или пауза `['wait', мс]`. */
export type Step = [Who, Action, unknown?] | ['wait', number];

export type Producer = 'publishAfter' | 'publishInside' | 'outbox';
export type Handler = 'ackFirst' | 'ackAfter' | 'checkFirst' | 'idempotent';

export interface Variant {
  producer: Producer;
  handler: Handler;
}

/** Где «убить» процесс: номер метки по порядку, «кто: метка» или список таких. */
export type Crash = number | string | (number | string)[];

/** Итог прогона: заказов в базе, бонусов на счёте, записей без XACK, писем в очереди мёртвых. */
export interface Final {
  orders: number;
  points: number;
  pending: number;
  dead: number;
}

export interface RunResult {
  log: string[];
  /** Метки `point(…)`, мимо которых прошёл код, по порядку: «кто: метка». */
  hits: string[];
  final: Final;
}

/** Ответ Redis в том виде, в каком его отдаёт ioredis: строка, число, null или массив. */
export type Reply = string | number | null | Reply[];

export interface RedisLike {
  call(cmd: string, ...args: string[]): Promise<Reply>;
}

export interface DbLike {
  exec(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
}

export interface Env {
  redis: RedisLike;
  db: DbLike;
  sleep(ms: number): Promise<void>;
  onLine?: () => void;
}

export interface BrokerDump {
  entries: Record<string, [string, string[]][]>;
  pending: { id: string; consumer: string; deliveries: number }[];
}

export interface DbDump {
  orders: { id: string; user_id: number; total: number }[];
  outbox: { id: number; event_id: string; user_id: number; points: number; sent_at: string | null }[];
  wallets: Record<string, number>;
  processed: string[];
}

export interface MiniBroker extends RedisLike {
  dump(): BrokerDump;
}

export interface MiniDb extends DbLike {
  dump(): DbDump;
}

export interface QueueModel {
  SQL: Record<string, string>;
  createBroker(clock: { now: number }): MiniBroker;
  createDb(): MiniDb;
  runSchedule(env: Env, schedule: Step[], variant: Variant, crash?: Crash): Promise<RunResult>;
  showReply(cmd: string, reply: Reply): string;
}

/** Сценарий демо: расписание, вариант кода и место падения. */
export interface QueueScenario {
  id: string;
  label: string;
  variant: Variant;
  crash: Crash;
  schedule: Step[];
  /** Что происходит — над журналом. Строчная разметка. */
  note: string;
  /** Чем кончилось — под журналом. Строчная разметка. */
  verdict: string;
  /** Тон итога: `ok` — эффект ровно один, `err` — потерян или лишний, `warn` — прочее. */
  tone: 'ok' | 'warn' | 'err';
}

/** Команда для прямого прогона: `[кто, команда, ...аргументы]` или `['wait', мс]`. */
export type RawStep = [string, ...string[]] | ['wait', number];
