/** Бэкенд в учебной модели выбора: то, что nginx держит про каждый `server` блока `upstream`. */
export interface Peer {
  name: string;
  weight: number;
  /** Накопленный вес плавного круга (`current_weight` в nginx). */
  current: number;
  /** Сколько запросов сейчас в работе у этого бэкенда. */
  conns: number;
}

export interface PickApi {
  smoothWeighted(peers: Peer[]): Peer;
  leastConn(peers: Peer[]): Peer;
}

export interface RingPoint {
  hash: number;
  server: string;
}

export interface RingApi {
  crc32(bytes: number[]): number;
  utf8(s: string): number[];
  modN(key: string, servers: string[]): string;
  buildRing(servers: string[], vnodes: number): RingPoint[];
  ringLookup(ring: RingPoint[], key: string): string;
}

/** Событие сценария: долгий запрос занимает бэкенд до конца сценария, короткий — отпускает сразу. */
export type LbEvent = 'long' | 'short';

/** Сценарий демо «очередь запросов»; `nginx` — что выдал настоящий nginx на стенде. */
export interface LbScenario {
  id: string;
  label: string;
  algo: 'swrr' | 'lc';
  weights: number[];
  events: LbEvent[];
  /** Последовательность бэкендов с nginx 1.30.0 — литерал стенда, по букве на событие. */
  nginx: string;
  /** Подпись к сценарию. Строчная разметка. */
  note: string;
}

/** Один ход симуляции: состояние до выбора, выбранный бэкенд и состояние после. */
export interface LbStep {
  event: LbEvent;
  chosen: string;
  before: Peer[];
  after: Peer[];
}
