/** Разобранный кандидат — как его возвращает `parseCandidate` из темы. */
export interface Candidate {
  foundation: string;
  component: number;
  protocol: string;
  priority: number;
  address: string;
  port: number;
  type: string;
  relatedAddress: string | null;
  relatedPort: number | null;
  extra: Record<string, string>;
}

export interface SdpMedia {
  kind: string;
  port: number;
  proto: string;
  formats: string[];
  lines: string[];
  attrs: { k: string; v: string }[];
  mid?: string;
  ice: { ufrag?: string; pwd?: string };
  fingerprint?: string;
  setup?: string;
  direction: string | null;
  codecs: { pt: number; name: string; clockRate: number; channels: number | null }[];
  candidates: Candidate[];
}

export interface ParsedSdp {
  session: { lines: string[]; attrs: { k: string; v: string }[] };
  media: SdpMedia[];
  bundle: string[];
}

export interface Pair {
  local: Candidate;
  remote: Candidate;
  priority: bigint;
}

/** Объект отчёта `getStats` — нужные теме поля. */
export interface StatsEntry {
  id?: string;
  type?: string;
  candidateType?: string;
  address?: string;
  port?: number;
  protocol?: string;
  priority?: number;
  state?: string;
  nominated?: boolean;
  localCandidateId?: string;
  remoteCandidateId?: string;
  iceState?: string;
  iceRole?: string;
  dtlsState?: string;
  tlsVersion?: string;
  selectedCandidatePairId?: string;
}

export interface Summary {
  ice: string;
  dtls: string;
  path: string | null;
  viaTurn: boolean;
  tlsVersion?: string | null;
}

/** Функции темы, собранные из строк `SDP_CODE` и `STATS_CODE`. */
export interface IceApi {
  parseCandidate(line: string): Candidate;
  parseSdp(sdp: string): ParsedSdp;
  candidatePriority(typePref: number, localPref: number, component: number): number;
  splitPriority(priority: number): { typePref: number; localPref: number; component: number };
  pairPriority(G: number, D: number): bigint;
  checklist(local: Candidate[], remote: Candidate[], controlling: boolean): Pair[];
  summarize(stats: StatsEntry[]): Summary;
}

/** Одна сторона в журнале стенда. */
export interface StandSide {
  log: { ms: number; k: string; v: string | null }[];
  states: { sig: string; ice: string; conn: string; gather: string };
  candidates: StatsEntry[];
  pairs: StatsEntry[];
  transport: StatsEntry;
}

/** Прогон стенда: две стороны и сообщения сервера сигнализации. */
export interface StandRun {
  caller: StandSide;
  callee: StandSide;
  signal: { from: string; kind: string; bytes: number; candidate?: string; sdp?: string }[];
}

export interface IceScenario {
  id: string;
  label: string;
  /** Что здесь произошло. Строчная разметка. */
  note: string;
  run: StandRun;
}

/** Строка списка проверок в демо. */
export interface CheckRow {
  local: Candidate | null;
  remote: Candidate | null;
  /** Подпись для пары, которой нет в списке (prflx). */
  localLabel: string;
  remoteLabel: string;
  priority: bigint;
  /** Состояние из `getStats`; `null` — Chromium такой пары не составлял (или уже убрал). */
  state: string | null;
  nominated: boolean;
  selected: boolean;
  /** Пара есть только в `getStats`: удалённый кандидат узнан из проверки. */
  learned: boolean;
}
