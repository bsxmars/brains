import type {
  AnswerFn,
  AuthServer,
  CacheEntry,
  CreateResolver,
  DnsRecord,
  LogEntry,
  ResolveResult,
  RolloutScenario,
  SendFn,
  Zone,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `AUTH_CODE` и `RESOLVER_CODE` из темы.
 *
 * На стенде (`tests/unit/dns.test.ts`) `AUTH_CODE` отвечает по настоящему UDP, а резолвер
 * ходит к нему через `dns-packet`; здесь те же функции соединены вызовом в памяти
 * (`memorySend`). Тест сверяет, что ответы в памяти совпадают с разобранными пакетами.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadAnswer(code: string): AnswerFn {
  return new Function(`${code}\nreturn answer;`)() as AnswerFn;
}

export function loadResolver(code: string): CreateResolver {
  return new Function(`${code}\nreturn createResolver;`)() as CreateResolver;
}

/** «Сеть» в памяти: адрес сервера → его зоны → `answer`. Записи копируются, как копирует их разбор пакета. */
export function memorySend(answer: AnswerFn, servers: AuthServer[], zones: () => Zone[]): SendFn {
  return async (ip, name, type) => {
    const srv = servers.find((s) => s.ip === ip);
    if (!srv) throw new Error(`нет сервера ${ip}`);
    const own = zones().filter((z) => srv.zones.includes(z.origin));
    return structuredClone(answer(own, name, type));
  };
}

export interface QueryRun {
  t: number;
  name: string;
  type: string;
  result: ResolveResult;
  steps: LogEntry[];
}

export interface CacheRow {
  key: string;
  name: string;
  type: string;
  /** Что лежит: записи через запятую или вид отказа. */
  value: string;
  ttl: number;
  /** Сколько осталось на момент `at`; ≤ 0 — запись протухла. */
  left: number;
  negative: boolean;
}

export const showData = (r: DnsRecord): string => {
  const d = r.data;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((s) => `"${s}"`).join(' ');
  if ('exchange' in d) return `${d.preference} ${d.exchange}`;
  return `${d.mname} … minimum ${d.minimum}`;
};

/**
 * Проиграть вопросы по виртуальному времени одним резолвером и снять кеш на момент `at`.
 * Вопросы сортируются по времени: кеш живёт только вперёд.
 */
export async function replay(
  createResolver: CreateResolver,
  send: SendFn,
  roots: string[],
  queries: { t: number; name: string; type: string }[],
  at: number,
): Promise<{ runs: QueryRun[]; cache: CacheRow[] }> {
  const clock = { now: 0 };
  const resolver = createResolver({ roots, send, now: () => clock.now });
  const runs: QueryRun[] = [];
  /** Срок записи в момент, когда её положили: нужен, чтобы показать «было 3600, осталось 1200». */
  const ttlAtPut = new Map<string, { expires: number; ttl: number }>();
  const note = () => {
    for (const e of resolver.cache.values()) {
      const seen = ttlAtPut.get(e.key);
      if (!seen || seen.expires !== e.expires) ttlAtPut.set(e.key, { expires: e.expires, ttl: e.expires - clock.now });
    }
  };
  for (const q of [...queries].sort((a, b) => a.t - b.t)) {
    clock.now = q.t;
    const from = resolver.log.length;
    const result = await resolver.resolve(q.name, q.type);
    note();
    runs.push({ ...q, result, steps: resolver.log.slice(from) });
  }
  const cache = [...resolver.cache.values()].map((e: CacheEntry) => {
    const [name, type] = e.key.split('|');
    return {
      key: e.key,
      name,
      type,
      value: e.negative ? e.negative : (e.records ?? []).map(showData).join(', '),
      ttl: ttlAtPut.get(e.key)?.ttl ?? 0,
      left: e.expires - at,
      negative: Boolean(e.negative),
    };
  });
  return { runs, cache };
}

// ─── Смена адреса ─────────────────────────────────────────────────────────────────────────

export interface RolloutRow {
  /** Резолвер провайдера: имя и когда к нему приходят клиенты. */
  label: string;
  /** Каждый вопрос клиента: время и какой адрес он получил. */
  answers: { t: number; address: string }[];
  /** Сколько раз резолвер ходил к авторитетному серверу зоны `shop.test`. */
  upstream: number;
}

export interface RolloutResult {
  rows: RolloutRow[];
  /** Последний ответ со старым адресом — время. `null`, если после смены старых не было. */
  lastOld: number | null;
}

export const ROLLOUT = {
  name: 'shop.test',
  oldAddress: '203.0.113.10',
  newAddress: '203.0.113.99',
  /** Шкала: семь тысяч двести секунд — два часа. */
  horizon: 7200,
  /** Клиент приходит к своему резолверу раз в столько секунд. */
  every: 40,
  /** Пять резолверов: клиенты начинают спрашивать каждый со своим сдвигом. */
  offsets: [0, 600, 1200, 1500, 1790],
};

/** Копия зон, где у `shop.test A` нужный адрес и TTL. Остальное не трогается. */
export function zonesAt(zones: Zone[], address: string, ttl: number): Zone[] {
  return zones.map((z) =>
    z.origin !== ROLLOUT.name
      ? z
      : {
          ...z,
          records: z.records.map((r) =>
            r.name === ROLLOUT.name && r.type === 'A' ? { ...r, data: address, ttl } : r,
          ),
        },
  );
}

/**
 * Пять независимых резолверов (провайдеры, офисы, мобильные сети) и владелец, который меняет
 * запись по сценарию. Каждый резолвер — тот же `createResolver`, сеть — `answer` в памяти.
 */
export async function rollout(
  createResolver: CreateResolver,
  answer: AnswerFn,
  servers: AuthServer[],
  zones: Zone[],
  roots: string[],
  sc: RolloutScenario,
): Promise<RolloutResult> {
  const clock = { now: 0 };
  const zonesNow = () => {
    const t = clock.now;
    const ttl = sc.lowerAt !== null && t >= sc.lowerAt ? sc.ttlAfter : t >= sc.switchAt ? sc.ttlAfter : sc.ttlBefore;
    return zonesAt(zones, t >= sc.switchAt ? ROLLOUT.newAddress : ROLLOUT.oldAddress, ttl);
  };
  const shop = servers.find((s) => s.zones.includes(ROLLOUT.name))?.ip;
  const rows: RolloutRow[] = [];
  let lastOld: number | null = null;
  for (const [i, offset] of ROLLOUT.offsets.entries()) {
    const send = memorySend(answer, servers, zonesNow);
    const resolver = createResolver({ roots, send, now: () => clock.now });
    const answers: RolloutRow['answers'] = [];
    for (let t = offset; t <= ROLLOUT.horizon; t += ROLLOUT.every) {
      clock.now = t;
      const res = await resolver.resolve(ROLLOUT.name, 'A');
      const address = String(res.answers.find((r) => r.type === 'A')?.data ?? '');
      answers.push({ t, address });
      if (t >= sc.switchAt && address === ROLLOUT.oldAddress) lastOld = Math.max(lastOld ?? 0, t);
    }
    const upstream = resolver.log.filter((e) => e.ip === shop && e.name === ROLLOUT.name).length;
    rows.push({ label: `резолвер ${String.fromCharCode(65 + i)}`, answers, upstream });
  }
  return { rows, lastOld };
}
