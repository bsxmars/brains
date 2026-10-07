import type { JobSpec, Placed, Schedule } from './types';

/**
 * Когда какой джоб может начаться — при стадиях и при `needs`.
 *
 * ⚠️ **Это расчёт, а не запись прогона, и подпись под демо говорит об этом прямо.** Снято
 * прогоном здесь другое: длительности джобов и порядок при стадиях (`gitlab-ci-local` 4.75.1,
 * образ `alpine:3`). Расстановку по `needs` тем же инструментом снять не удалось — он
 * запускает джоб с непустым `needs` только после конца предыдущей стадии: в замере джоб
 * `after-fast` с `needs: [fast]` дождался соседа `slow` (21 с) вместо того, чтобы стартовать
 * через 1,3 с. Поэтому правая половина демо считается по правилам из документации GitLab,
 * и тем же расчётом считается левая — чтобы сравнивались две модели, а не модель с записью.
 *
 * Обе функции игнорируют очередь раннеров: считается, что свободная машина есть всегда.
 * На настоящем GitLab это не так, и это единственное место, где расчёт заведомо оптимистичен.
 */

function bySpec(jobs: JobSpec[], name: string): JobSpec {
  const job = jobs.find((j) => j.name === name);
  if (!job) throw new Error(`needs ссылается на джоб, которого нет в конвейере: ${name}`);
  return job;
}

/** Стадии по порядку: джоб стадии K ждёт **все** джобы стадии K−1, даже ненужные ему. */
export function byStages(jobs: JobSpec[], stages: string[]): Schedule {
  const placed: Placed[] = [];
  let stageStart = 0;

  for (const stage of stages) {
    const inStage = jobs.filter((job) => job.stage === stage);
    if (inStage.length === 0) continue;

    const previous = placed.filter((job) => job.stage !== stage).map((job) => job.name);

    for (const job of inStage) {
      placed.push({
        ...job,
        start: stageStart,
        end: stageStart + job.ms,
        waitedFor: stageStart === 0 ? [] : previous,
        stageGated: stageStart !== 0,
      });
    }

    // Следующая стадия начинается по самому долгому джобу этой — а не по своему источнику.
    stageStart = Math.max(...inStage.map((job) => stageStart + job.ms));
  }

  return { jobs: placed, total: Math.max(0, ...placed.map((job) => job.end)) };
}

/**
 * С `needs` джоб ждёт только перечисленное.
 *
 * Джоб **без ключа `needs`** при этом остаётся на лестнице: он по-прежнему ждёт всю
 * предыдущую стадию. Отсюда обычное разочарование «добавили `needs` одному джобу, а быстрее
 * не стало»: ускоряется ровно тот, кому его написали.
 */
export function byNeeds(jobs: JobSpec[], stages: string[]): Schedule {
  const placed = new Map<string, Placed>();
  const stageIndex = (stage: string) => stages.indexOf(stage);

  const place = (job: JobSpec, guard: string[]): Placed => {
    const done = placed.get(job.name);
    if (done) return done;
    if (guard.includes(job.name)) {
      throw new Error(`needs образует цикл: ${[...guard, job.name].join(' → ')}`);
    }

    let start = 0;
    // Без начального значения намеренно: обе ветки ниже присваивают его сами.
    let waitedFor: string[];
    let stageGated = false;

    if (job.needs) {
      for (const name of job.needs) {
        const dependency = place(bySpec(jobs, name), [...guard, job.name]);
        start = Math.max(start, dependency.end);
      }
      waitedFor = [...job.needs];
    } else {
      // Ключа нет — прежнее правило стадий: ждём всё, что стоит на стадиях левее.
      const earlier = jobs.filter((other) => stageIndex(other.stage) < stageIndex(job.stage));
      for (const other of earlier) {
        const dependency = place(other, [...guard, job.name]);
        start = Math.max(start, dependency.end);
      }
      waitedFor = earlier.map((other) => other.name);
      stageGated = earlier.length > 0;
    }

    const result: Placed = { ...job, start, end: start + job.ms, waitedFor, stageGated };
    placed.set(job.name, result);
    return result;
  };

  for (const job of jobs) place(job, []);

  const list = jobs.map((job) => placed.get(job.name)!);
  return { jobs: list, total: Math.max(0, ...list.map((job) => job.end)) };
}

/** Насколько раньше кончается конкретный джоб во втором расписании. */
export function gain(a: Schedule, b: Schedule, name: string): number {
  const one = a.jobs.find((job) => job.name === name);
  const two = b.jobs.find((job) => job.name === name);
  if (!one || !two) throw new Error(`Джоба нет в расписании: ${name}`);
  return one.end - two.end;
}
