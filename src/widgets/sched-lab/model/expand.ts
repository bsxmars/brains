import type { Job, JobSpec, SchedScenario, SchedScenarioSpec } from './types';

/** Работы сценария с развёрнутыми повторами — ровно то, что лежит в `SCHED_SCENARIOS`. */
export function expandJobs(specs: readonly JobSpec[]): Job[] {
  return specs.flatMap(({ repeat, ...job }) =>
    repeat
      ? Array.from({ length: repeat.count }, (_, k): Job => ({ ...job, at: (job.at ?? 0) + k * repeat.every }))
      : [job],
  );
}

export function expandScenario(spec: SchedScenarioSpec): SchedScenario {
  return { ...spec, jobs: expandJobs(spec.jobs) };
}
