/** Native Resource Timing intervals. Gaps are queueing and other work, not extra DNS time. */
export interface TimingPhase {
  key: 'dns' | 'connect' | 'wait' | 'transfer';
  from: number;
  to: number;
}

type PhaseTiming = Pick<PerformanceResourceTiming,
  'domainLookupStart' | 'domainLookupEnd' | 'connectStart' | 'connectEnd' |
  'requestStart' | 'responseStart' | 'responseEnd'>;

export interface TimingApi {
  waterfallPhases(entry: PhaseTiming): TimingPhase[];
  resourceTimings(performance: Pick<Performance, 'getEntriesByType'>): PerformanceResourceTiming[];
}

/** Executes the displayed source; the algorithm itself lives only in the topic's data.ts. */
export function loadTiming(source: string): TimingApi {
  return new Function(`${source}\nreturn { waterfallPhases, resourceTimings };`)() as TimingApi;
}
