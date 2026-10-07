import type { Candidate, CheckRow, IceApi, StandRun, StatsEntry } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `SDP_CODE` и `STATS_CODE` из темы
 * «WebRTC: как два браузера находят друг друга».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и сверяются
 * `tests/unit/webrtc.test.ts` с тем, что снял стенд в Chromium: разбор кандидатов —
 * с `new RTCIceCandidate`, приоритеты пар — с `getStats`. Ни DOM, ни Vue: чистые функции.
 */
export function loadIce(sdpCode: string, statsCode: string): IceApi {
  return new Function(
    `${sdpCode}\n${statsCode}\nreturn { parseCandidate, parseSdp, candidatePriority, splitPriority, pairPriority, checklist, summarize };`,
  )() as IceApi;
}

/** Свои кандидаты звонящего — в том порядке, в каком их отдал `icecandidate`. */
export function localCandidates(api: IceApi, run: StandRun): Candidate[] {
  return run.caller.log.filter((e) => e.k === 'icecandidate' && e.v).map((e) => api.parseCandidate(e.v as string));
}

/** Чужие кандидаты — такими, какими их доставил сервер сигнализации (в том числе испорченными). */
export function remoteCandidates(api: IceApi, run: StandRun): Candidate[] {
  return run.signal.filter((m) => m.from === 'callee' && m.candidate).map((m) => api.parseCandidate(m.candidate as string));
}

const sameCandidate = (c: Candidate, s: StatsEntry | undefined) => !!s && s.candidateType === c.type && s.port === c.port;

/**
 * Список проверок звонящего (он controlling), сопоставленный с парами из `getStats`.
 * Пара из отчёта, которой нет в списке, — с кандидатом, узнанным из пришедшей проверки (prflx).
 */
export function checkRows(api: IceApi, run: StandRun): CheckRow[] {
  const side = run.caller;
  const byId = new Map(side.candidates.map((c) => [c.id, c]));
  const used = new Set<string>();
  const rows: CheckRow[] = api.checklist(localCandidates(api, run), remoteCandidates(api, run), true).map((p) => {
    const st = side.pairs.find(
      (s) => sameCandidate(p.local, byId.get(s.localCandidateId)) && sameCandidate(p.remote, byId.get(s.remoteCandidateId)),
    );
    if (st?.id) used.add(st.id);
    return {
      local: p.local,
      remote: p.remote,
      localLabel: label(p.local.type, p.local.address, p.local.port),
      remoteLabel: label(p.remote.type, p.remote.address, p.remote.port),
      priority: p.priority,
      state: st?.state ?? null,
      nominated: !!st?.nominated,
      selected: !!st && st.id === side.transport.selectedCandidatePairId,
      learned: false,
    };
  });
  for (const st of side.pairs) {
    if (!st.id || used.has(st.id)) continue;
    const l = byId.get(st.localCandidateId);
    const r = byId.get(st.remoteCandidateId);
    rows.push({
      local: null,
      remote: null,
      localLabel: label(l?.candidateType ?? '?', l?.address ?? '', l?.port ?? 0),
      remoteLabel: label(r?.candidateType ?? '?', r?.address ?? '', r?.port ?? 0),
      priority: api.pairPriority(l?.priority ?? 0, r?.priority ?? 0),
      state: st.state ?? null,
      nominated: !!st.nominated,
      selected: st.id === side.transport.selectedCandidatePairId,
      learned: true,
    });
  }
  return rows.sort((a, b) => (a.priority < b.priority ? 1 : a.priority > b.priority ? -1 : 0));
}

/** Короткая запись адреса: имя mDNS — первые 8 знаков. */
export function shortAddress(address: string): string {
  if (address.endsWith('.local')) return `${address.slice(0, 8)}….local`;
  return address || 'адрес скрыт';
}

function label(type: string, address: string, port: number) {
  return `${type} ${shortAddress(address)}:${port}`;
}

/** Отчёт `getStats` звонящего одним массивом — как его получает `summarize`. */
export function callerStats(run: StandRun): StatsEntry[] {
  return [...run.caller.candidates, ...run.caller.pairs, run.caller.transport];
}
