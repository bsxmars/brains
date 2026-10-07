import type { LbScenario, LbStep, Peer, PickApi, RingApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `PICK_CODE` и `RING_CODE` из темы
 * «Балансировка нагрузки и проверки здоровья». Строки напечатаны на странице, собраны здесь
 * `new Function` и в `tests/unit/load-balancing.test.ts` сверяются с последовательностями,
 * которые выдал настоящий nginx 1.30.0 на стенде (литералы в `data.ts` темы).
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadPick(code: string): PickApi {
  return new Function(`${code}\nreturn { smoothWeighted, leastConn };`)() as PickApi;
}

export function loadRing(code: string): RingApi {
  return new Function(`${code}\nreturn { crc32, utf8, modN, buildRing, ringLookup };`)() as RingApi;
}

const NAMES = 'ABCDEFGH';

/** Бэкенды сценария: имена A, B, C… по порядку строк `server` в `upstream`. */
export function makePeers(weights: number[]): Peer[] {
  return weights.map((weight, i) => ({ name: NAMES[i], weight, current: 0, conns: 0 }));
}

const snapshot = (peers: Peer[]) => peers.map((p) => ({ ...p }));

/**
 * Прогон сценария: на каждое событие выбирается бэкенд. Долгий запрос держит соединение
 * до конца сценария, короткий заканчивается до следующего события — так было на стенде,
 * где клиент слал короткие запросы по одному и ждал ответа.
 */
export function simulate(api: PickApi, scenario: Pick<LbScenario, 'algo' | 'weights' | 'events'>): LbStep[] {
  const peers = makePeers(scenario.weights);
  const pick = scenario.algo === 'lc' ? api.leastConn : api.smoothWeighted;
  return scenario.events.map((event) => {
    const before = snapshot(peers);
    const chosen = pick(peers);
    chosen.conns += 1;
    const after = snapshot(peers);
    if (event === 'short') chosen.conns -= 1;
    return { event, chosen: chosen.name, before, after };
  });
}

/** Ключи стенда: `user-1` … `user-n`. */
export const standKeys = (n: number) => Array.from({ length: n }, (_, i) => `user-${i + 1}`);

/** Адреса бэкендов в конфиге стенда: `app:52801` … — по ним nginx строит точки кольца. */
export const standServers = (n: number) => Array.from({ length: n }, (_, i) => `app:${52801 + i}`);

/** `app:52803` → `C`. */
export const letterOf = (server: string) => NAMES[Number(server.slice(-1)) - 1];

/** Куда уходит каждый ключ при `n` бэкендах: `% N` или кольцо с `vnodes` точками на бэкенд. */
export function assign(api: RingApi, keys: string[], n: number, mode: 'mod' | 'ring', vnodes = 160): string[] {
  const servers = standServers(n);
  if (mode === 'mod') return keys.map((k) => letterOf(api.modN(k, servers)));
  const ring = api.buildRing(servers, vnodes);
  return keys.map((k) => letterOf(api.ringLookup(ring, k)));
}
