import type { DnsChoice, Egress, EgressCase, Naive, NaiveVerdict, Verdict } from './types';

/**
 * Демо и тест спрашивают проверки одним и тем же кодом — строками `EGRESS_CODE`
 * и `NAIVE_EGRESS_CODE` из темы.
 *
 * Строка собирается `new Function`: к ней дописан только `return` с именами, которые она
 * объявляет. Импортов в этих строках нет, поэтому тот же текст работает и в Node, и в браузере.
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadEgress(code: string): Egress {
  return new Function(
    `"use strict";\n${code}\nreturn { checkUrl, literalIp, addressProblem, checkOutgoing, guardLookup, fetchChecked };`,
  )() as Egress;
}

/** `fetchCode` — необязательная `NAIVE_FETCH_CODE`: ей нужен `naiveCheck` из той же области. */
export function loadNaive(code: string, fetchCode = ''): Naive {
  const names = fetchCode ? 'naiveCheck, naiveFetch' : 'naiveCheck';
  return new Function(`"use strict";\n${code}\n${fetchCode}\nreturn { ${names} };`)() as Naive;
}

/** Наивная проверка бросает на неразборчивом адресе — для таблицы это тоже ответ. */
export function runNaive(naive: Naive, url: string): NaiveVerdict {
  try {
    const r = naive.naiveCheck(url);
    return { ok: r.ok, reason: r.ok ? 'в чёрном списке нет' : (r.reason ?? '') };
  } catch (e) {
    return { ok: false, reason: `бросила ${(e as Error).name}` };
  }
}

/** Хост глазами парсера — ровно то, что увидят обе проверки. */
export function parsedHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export interface Decision {
  safe: Verdict;
  naive: NaiveVerdict;
  host: string | null;
  /** Хост — IP-литерал: DNS не спрашивают, выбранный ответ не участвует. */
  literal: boolean;
}

/** Одна строка таблицы или одно состояние демо: обе проверки на одних входных данных. */
export function decide(
  egress: Egress,
  naive: Naive,
  url: string,
  dns: string[],
  allowHosts?: string[],
): Decision {
  const host = parsedHost(url);
  const literal = host !== null && egress.literalIp(host.replace(/\.$/, '')) !== null;
  return { safe: egress.checkOutgoing(url, dns, allowHosts), naive: runNaive(naive, url), host, literal };
}

export function answerOf(choices: DnsChoice[], id: string): string[] {
  const found = choices.find((c) => c.id === id);
  if (!found) throw new Error(`Нет ответа DNS с id ${id}`);
  return found.addresses;
}

export function decideCase(egress: Egress, naive: Naive, c: EgressCase, choices: DnsChoice[], allowHosts?: string[]): Decision {
  return decide(egress, naive, c.url, answerOf(choices, c.dns), allowHosts);
}
