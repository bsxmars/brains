/** Ответ DNS, который читатель выбирает в демо: резолва нет, адреса заданы литералом. */
export interface DnsChoice {
  id: string;
  label: string;
  addresses: string[];
}

export type Stage = 'url' | 'ip' | 'dns';

/** Строка таблицы «куда можно идти серверу». */
export interface EgressCase {
  label: string;
  url: string;
  /** id ответа из `DNS_CHOICES`; для адреса-литерала не используется. */
  dns: string;
  safe: 'ok' | 'block';
  /** На каком шаге отказала защитная проверка. */
  stage?: Stage;
  naive: 'ok' | 'block';
}

export type Verdict =
  | { ok: true; host: string; addresses: string[] }
  | { ok: false; stage: Stage; reason: string };

export type UrlCheck = { ok: true; url: URL; host: string } | { ok: false; stage: 'url'; reason: string };

type Lookup = (
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address?: unknown, family?: number) => void,
) => void;

/** Что отдаёт строка `EGRESS_CODE` темы. */
export interface Egress {
  checkUrl(input: string, allowHosts?: string[]): UrlCheck;
  literalIp(host: string): string | null;
  addressProblem(ip: string): string | null;
  checkOutgoing(input: string, dnsAnswer: string[], allowHosts?: string[]): Verdict;
  guardLookup(lookup: Lookup): Lookup;
  fetchChecked(
    input: string,
    options: { fetch: (url: string, init?: { redirect?: string }) => Promise<Response>; allowHosts?: string[]; maxHops?: number },
  ): Promise<Response>;
}

/** Что отдают строки `NAIVE_EGRESS_CODE` и `NAIVE_FETCH_CODE`. */
export interface Naive {
  naiveCheck(input: string): { ok: boolean; reason?: string };
  naiveFetch?(input: string, options: { fetch: (url: string) => Promise<Response> }): Promise<Response>;
}

export interface NaiveVerdict {
  ok: boolean;
  reason: string;
}
