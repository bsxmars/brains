import type { Change, PlanResult } from './types';

/**
 * Вид плана в духе `tofu plan`: символ действия, строки-заголовки `# …` теми же словами,
 * что печатает OpenTofu, и итоговая строка `Plan: …`. Это подпись к результату `PLAN_CODE`,
 * а не расчёт: тест сверяет заголовки и итог с текстом `tofu show` на всех сценариях.
 */

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'dim';

export interface PlanItem {
  addr: string;
  symbol: string;
  tone: Tone;
  headers: string[];
  /** Поля, из-за которых объект заменяется. */
  forces: string[];
}

/** Порядок адресов как у OpenTofu: по ресурсу, затем номера `[0]` раньше ключей `["dev"]`. */
export function compareAddr(a: string, b: string): number {
  const split = (s: string) => {
    const m = /^(.*?)(?:\[(.+)\])?$/.exec(s)!;
    const key = m[2];
    return { base: m[1], num: key && /^\d+$/.test(key) ? Number(key) : null, key: key ?? '' };
  };
  const x = split(a);
  const y = split(b);
  if (x.base !== y.base) return x.base < y.base ? -1 : 1;
  if (x.num !== null && y.num !== null) return x.num - y.num;
  if (x.num !== null) return -1;
  if (y.num !== null) return 1;
  return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
}

const resOf = (addr: string) => addr.replace(/\[.*\]$/, '');

function reasonLine(c: Change, usesCount: boolean): string | null {
  const key = /\[(.+)\]$/.exec(c.addr)?.[1] ?? '';
  switch (c.reason) {
    case 'delete_because_count_index':
      return `# (because index [${key}] is out of range for count)`;
    case 'delete_because_each_key':
      return `# (because key [${key}] is not in for_each map)`;
    case 'delete_because_wrong_repetition':
      return usesCount ? '# (because resource does not use for_each)' : '# (because resource does not use count)';
    case 'delete_because_no_resource_config':
      return `# (because ${resOf(c.addr)} is not in configuration)`;
    default:
      return null;
  }
}

export function planItems(result: PlanResult, countResources: Set<string> = new Set()): PlanItem[] {
  const items: PlanItem[] = [];
  for (const c of [...result.changes].sort((a, b) => compareAddr(a.addr, b.addr))) {
    const moved = c.movedFrom ? `# (moved from ${c.movedFrom})` : null;
    const item = (symbol: string, tone: Tone, headers: (string | null)[]): PlanItem => ({
      addr: c.addr,
      symbol,
      tone,
      headers: headers.filter((h): h is string => h !== null),
      forces: c.replacePaths ?? [],
    });
    if (c.action === 'no-op') {
      if (c.movedFrom) items.push(item('', 'info', [`# ${c.movedFrom} has moved to ${c.addr}`]));
      continue;
    }
    if (c.action === 'create') items.push(item('+', 'ok', [`# ${c.addr} will be created`, moved]));
    if (c.action === 'update') items.push(item('~', 'warn', [`# ${c.addr} will be updated in-place`, moved]));
    if (c.action === 'replace') items.push(item(c.cbd ? '+/-' : '-/+', 'err', [`# ${c.addr} must be replaced`, moved]));
    if (c.action === 'delete') {
      items.push(item('-', 'err', [`# ${c.addr} will be destroyed`, reasonLine(c, countResources.has(resOf(c.addr))), moved]));
    }
  }
  return items;
}

/** Итог плана — та же арифметика, что у OpenTofu: замена считается и в add, и в destroy. */
export function summaryLine(result: PlanResult): string {
  const n = (a: Change['action']) => result.changes.filter((c) => c.action === a).length;
  const moved = result.changes.some((c) => c.movedFrom);
  const add = n('create') + n('replace');
  const change = n('update');
  const destroy = n('delete') + n('replace');
  if (!add && !change && !destroy && !moved) return 'No changes. Your infrastructure matches the configuration.';
  return `Plan: ${add} to add, ${change} to change, ${destroy} to destroy.`;
}
