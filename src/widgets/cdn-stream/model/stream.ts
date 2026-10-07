import type { CacheApi, HttpRequest, HttpResponse } from './load';

/**
 * Поток запросов к учебной прослойке на виртуальных часах.
 *
 * Кеш — настоящий `createCache` из строки темы; origin — функция, которая отвечает через
 * `latency` виртуальных миллисекунд. Часы двигает очередь событий: пришёл запрос, ответил
 * origin, сработал purge. После каждого события выбирается вся очередь микрозадач, поэтому
 * промисы кеша успевают дойти туда, куда дошли бы в настоящем процессе, — и порядок событий
 * детерминирован: одинаковые входы дают одинаковую ленту и в демо, и в тесте.
 *
 * Сценарий один: одна страница `/news`, четыре запроса в секунду в течение минуты, origin
 * отвечает за полторы секунды, на двадцатой секунде редакция публикует новую версию.
 */

export type VaryMode = 'none' | 'lang' | 'ua';

export interface StreamInput {
  /** Срок свежести в общем кеше, с. */
  ttl: number;
  /** `stale-while-revalidate`, с; 0 — директивы нет. */
  swr: number;
  /** Куда записан срок: `s-maxage` в `Cache-Control` или `max-age` в `CDN-Cache-Control`. */
  form: 's-maxage' | 'cdn';
  coalesce: boolean;
  vary: VaryMode;
  /** Сбросить тег `news` в момент публикации. */
  purge: boolean;
}

export const STREAM = {
  duration: 60_000,
  gap: 250,
  latency: 1_500,
  publishAt: 20_000,
  /** Сколько разных `User-Agent` в потоке. */
  agents: 12,
} as const;

export type Outcome = 'hit' | 'stale' | 'collapsed' | 'revalidate' | 'miss';

export interface RequestRow {
  i: number;
  /** Когда пришёл, мс. */
  t: number;
  /** Заголовок, по которому различаются варианты, если `Vary` включён. */
  varyValue: string;
  outcome: Outcome;
  age: string;
  cacheStatus: string;
  /** Что лежало в теле: `v1` до публикации, `v2` после. */
  version: string;
  /** Сколько клиент ждал ответа, мс. */
  wait: number;
}

export interface OriginCall {
  start: number;
  end: number;
  status: number;
  /** Дорожка на графике: одновременные обращения стоят друг над другом. */
  lane: number;
}

export interface StreamResult {
  rows: RequestRow[];
  calls: OriginCall[];
  /** Больше всего одновременных обращений к origin. */
  peak: number;
  /** Последний момент после публикации, когда кто-то получил `v1`, мс; `null` — никто. */
  oldUntil: number | null;
  purged: number;
}

export function originHeaders(input: StreamInput): Record<string, string> {
  const swr = input.swr ? `, stale-while-revalidate=${input.swr}` : '';
  const headers: Record<string, string> = {};
  if (input.form === 's-maxage') {
    headers['cache-control'] = `public, max-age=5, s-maxage=${input.ttl}${swr}`;
  } else {
    headers['cache-control'] = 'public, max-age=5';
    headers['cdn-cache-control'] = `max-age=${input.ttl}${swr}`;
  }
  if (input.vary === 'lang') headers.vary = 'Accept-Language';
  if (input.vary === 'ua') headers.vary = 'User-Agent';
  headers['surrogate-key'] = 'news front';
  return headers;
}

function requestAt(i: number): HttpRequest {
  return {
    method: 'GET',
    url: '/news',
    headers: {
      'accept-language': i % 2 ? 'en' : 'ru',
      'user-agent': `Browser/${100 + ((i * 7) % STREAM.agents)}`,
    },
  };
}

export function outcomeOf(cacheStatus: string): Outcome {
  const mine = cacheStatus.split(',').pop()!.trim();
  if (mine.includes('collapsed')) return 'collapsed';
  if (mine.includes('; hit') && mine.includes('stale-while-revalidate')) return 'stale';
  if (mine.includes('; hit')) return 'hit';
  if (mine.includes('fwd=stale')) return 'revalidate';
  return 'miss';
}

/** Выбрать очередь микрозадач: промисы кеша ждут друг друга не глубже нескольких звеньев. */
async function drain(): Promise<void> {
  for (let i = 0; i < 64; i++) await null;
}

export async function runStream(api: CacheApi, input: StreamInput): Promise<StreamResult> {
  let clock = 0;
  let seq = 0;
  const queue: { t: number; seq: number; run: () => void }[] = [];
  const at = (t: number, run: () => void) => queue.push({ t, seq: seq++, run });

  const calls: OriginCall[] = [];
  let open = 0;
  let peak = 0;

  const fetchOrigin = (req: HttpRequest): Promise<HttpResponse> =>
    new Promise((resolve) => {
      const version = clock >= STREAM.publishAt ? 'v2' : 'v1';
      const headers = { ...originHeaders(input), etag: `"${version}"` };
      const res: HttpResponse =
        req.headers['if-none-match'] === headers.etag
          ? { status: 304, headers, body: '' }
          : { status: 200, headers, body: version };
      open++;
      peak = Math.max(peak, open);
      calls.push({ start: clock, end: clock + STREAM.latency, status: res.status, lane: 0 });
      at(clock + STREAM.latency, () => {
        open--;
        resolve(res);
      });
    });

  const cache = api.createCache({
    now: () => clock / 1000,
    fetchOrigin,
    coalesce: input.coalesce,
    name: 'edge',
  });

  let purged = 0;
  // Purge ставится первым: в одну и ту же миллисекунду он случается раньше запроса.
  if (input.purge) at(STREAM.publishAt, () => (purged = cache.purgeTag('news')));

  const count = STREAM.duration / STREAM.gap;
  const rows: (RequestRow | undefined)[] = new Array(count);
  for (let i = 0; i < count; i++) {
    at(i * STREAM.gap, () => {
      const t = clock;
      const req = requestAt(i);
      void cache.handle(req).then((res) => {
        const cacheStatus = res.headers['cache-status'] ?? '';
        rows[i] = {
          i,
          t,
          varyValue:
            input.vary === 'lang'
              ? `Accept-Language: ${req.headers['accept-language']}`
              : input.vary === 'ua'
                ? `User-Agent: ${req.headers['user-agent']}`
                : '',
          outcome: outcomeOf(cacheStatus),
          age: res.headers.age ?? '—',
          cacheStatus,
          version: res.body,
          wait: clock - t,
        };
      });
    });
  }

  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const ev = queue.shift()!;
    clock = ev.t;
    ev.run();
    await drain();
  }

  const done = rows.filter((r): r is RequestRow => Boolean(r));
  if (done.length !== count) {
    throw new Error(`Поток не доиграл: ответов ${done.length} из ${count} — не хватило выборки микрозадач`);
  }

  // Дорожки: обращение встаёт на первую свободную, так толпа видна высотой.
  const laneEnds: number[] = [];
  for (const call of calls) {
    let lane = laneEnds.findIndex((end) => end <= call.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = call.end;
    call.lane = lane;
  }

  const old = done.filter((r) => r.t >= STREAM.publishAt && r.version === 'v1');
  return {
    rows: done,
    calls,
    peak,
    oldUntil: old.length ? old[old.length - 1].t : null,
    purged,
  };
}
