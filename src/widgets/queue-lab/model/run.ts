import type { Crash, Env, Final, QueueModel, RawStep, RedisLike, Reply, RunResult, Step, Variant } from './types';

/**
 * Демо и тест исполняют одну и ту же модель — строки из темы «Очереди и идемпотентность»
 * (`SQL_CODE`, `BROKER_CODE`, `DB_CODE`, `CONSUMER_CODE`, `ACK_CODE`, `CLAIM_CODE`,
 * `IDEMPOTENT_CODE`, `PRODUCER_CODE`, `RUNNER_CODE`), склеенные и собранные `new Function`.
 * Те же строки напечатаны на странице, а `tests/unit/queues.test.ts` гоняет их против
 * настоящего Redis 7.4 и PGlite и сверяет журналы с литералами стенда `STAND_*`.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModel(parts: string[]): QueueModel {
  return new Function(`${parts.join('\n\n')}\nreturn { SQL, createBroker, createDb, runSchedule, showReply };`)() as QueueModel;
}

/** Учебный Redis и учебная база с виртуальными часами: пауза двигает часы, а не ждёт. */
export function modelEnv(model: QueueModel) {
  const clock = { now: 0 };
  const redis = model.createBroker(clock);
  const db = model.createDb();
  const env: Env = {
    redis,
    db,
    sleep: async (ms) => {
      clock.now += ms;
    },
  };
  return { env, redis, db, clock };
}

/**
 * Номера записей настоящего Redis (`1790885348379-0`) — по порядку появления: `1-0`, `2-0`…
 * У учебного Redis номера такие с самого начала, и замена ничего не меняет.
 */
export function normalizeIds(lines: string[]): string[] {
  const ids = new Map<string, string>();
  return lines.map((l) =>
    l.replace(/\b\d{10,}-\d+\b/g, (id) => {
      if (!ids.has(id)) ids.set(id, `${ids.size + 1}-0`);
      return ids.get(id)!;
    }),
  );
}

/**
 * Прямой прогон команд: `[кто, команда, …аргументы]`. Номер вида `1-0` в аргументах — это
 * номер из журнала; для настоящего Redis он подменяется настоящим, выданным `XADD`.
 */
export async function replayRaw(
  redis: RedisLike,
  steps: RawStep[],
  sleep: (ms: number) => Promise<void>,
  show: (cmd: string, reply: Reply) => string,
): Promise<string[]> {
  const real = new Map<string, string>();
  const log: string[] = [];
  for (const step of steps) {
    if (step[0] === 'wait') {
      await sleep(step[1] as number);
      log.push(`прошло ${step[1]} мс`);
      continue;
    }
    const [who, ...args] = step as string[];
    const sent = args.map((a) => real.get(a) ?? a);
    let reply: Reply;
    try {
      reply = await redis.call(sent[0], ...sent.slice(1));
    } catch (e) {
      log.push(`${who}: ${args.join(' ')} → (error) ${(e as Error).message}`);
      continue;
    }
    if (args[0] === 'XADD' && typeof reply === 'string') real.set(`${real.size + 1}-0`, reply);
    log.push(`${who}: ${args.join(' ')} → ${show(args[0], reply)}`);
  }
  return normalizeIds(log);
}

/** Сколько раз случился эффект на каждый зафиксированный заказ: бонусов 10 за заказ o-1. */
export type Outcome = 'once' | 'lost' | 'extra';

export function outcomeOf(final: Pick<Final, 'orders' | 'points'>, perOrder = 10): Outcome {
  const effects = final.points / perOrder;
  if (effects === final.orders) return 'once';
  return effects < final.orders ? 'lost' : 'extra';
}

export interface CrashRow {
  /** «кто: метка», на которой упал процесс. */
  at: string;
  final: Final;
  outcome: Outcome;
}

/**
 * Перебор точек падения: прогон без падений даёт список меток, затем расписание гоняется
 * заново по разу на каждую метку — процесс падает на ней, остальные шаги идут как шли.
 */
export async function crashTable(
  model: QueueModel,
  schedule: Step[],
  variant: Variant,
  makeEnv: () => Env | Promise<Env> = () => modelEnv(model).env,
): Promise<{ clean: RunResult; rows: CrashRow[] }> {
  const clean = await model.runSchedule(await makeEnv(), schedule, variant);
  const rows: CrashRow[] = [];
  for (let k = 0; k < clean.hits.length; k++) {
    const r = await model.runSchedule(await makeEnv(), schedule, variant, k as Crash);
    rows.push({ at: clean.hits[k], final: r.final, outcome: outcomeOf(r.final) });
  }
  return { clean, rows };
}
