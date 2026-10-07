import type { Amount, PodView, RolloutFrame, RolloutParams } from './types';

/**
 * Арифметика перекатывания и его развёртка по шагам.
 *
 * ── Что здесь снято, а что выведено ──────────────────────────────────────────────────
 *
 * Снято прогоном (kind 0.33, Kubernetes 1.37.0, Deployment из четырёх и из трёх реплик):
 * инварианты — живых подов не больше `replicas + maxSurge`, доступных не меньше
 * `replicas − maxUnavailable`; тайминги — 8 с до первого ответа процесса, ≈0.4 с на проход
 * контроллера, ≈1 с на исчезновение завершающегося пода при `terminationGracePeriodSeconds: 2`.
 *
 * Выведено отсюда: раскладка по шагам для любых `maxSurge` / `maxUnavailable`. Правила
 * округления процентов — **вверх у `maxSurge` и вниз у `maxUnavailable`** — проверены двумя
 * снятыми конфигурациями: при 4 репликах 25 % дают 1 и 1 (в замере живых ровно 5, доступных
 * ровно 3), при 3 репликах — 1 и 0 (живых ровно 4, доступных ни разу не меньше 3).
 * Сверку модели с записью делает `tests/unit/rollout.test.ts`.
 */

/** Значение в процентах или `null`, если задано числом подов. */
function percentOf(value: Amount): number | null {
  if (typeof value === 'number') return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Непонятное значение стратегии: ${value}`);
  return parsed;
}

/**
 * `maxSurge` в подах. Проценты округляются **вверх**: запас места разрешено дать щедрее,
 * потому что лишний под — это счёт за ресурсы, а не простой сервиса.
 */
export function resolveSurge(value: Amount, replicas: number): number {
  const pct = percentOf(value);
  return pct === null ? (value as number) : Math.ceil((replicas * pct) / 100);
}

/**
 * `maxUnavailable` в подах. Проценты округляются **вниз**: просадку доступности разрешено
 * взять только меньшую. Отсюда неочевидное следствие, которое и ловит замер: при трёх
 * репликах 25 % — это ноль, и перекатывание идёт вообще без потери мощности, зато медленнее.
 */
export function resolveUnavailable(value: Amount, replicas: number): number {
  const pct = percentOf(value);
  return pct === null ? (value as number) : Math.floor((replicas * pct) / 100);
}

export interface RolloutLimits {
  surge: number;
  unavailable: number;
  /** Потолок живых подов: `replicas + maxSurge`. */
  maxLive: number;
  /** Пол доступных: `replicas − maxUnavailable`. */
  minAvailable: number;
  /** Сколько подов меняется за одну волну. */
  batch: number;
  /** Сколько волн нужно на полную замену. */
  waves: number;
}

export function limits(
  params: Pick<RolloutParams, 'replicas' | 'maxSurge' | 'maxUnavailable'>,
): RolloutLimits {
  const { replicas } = params;
  const surge = resolveSurge(params.maxSurge, replicas);
  const unavailable = resolveUnavailable(params.maxUnavailable, replicas);

  // Запрет из самого Kubernetes: оба нуля означали бы «менять поды, не создавая и не убирая», —
  // такая стратегия не может сдвинуться с места, и API её отклоняет.
  if (surge === 0 && unavailable === 0) {
    throw new Error('maxSurge и maxUnavailable не могут быть нулевыми одновременно');
  }

  const batch = Math.max(1, surge + unavailable);
  return {
    surge,
    unavailable,
    maxLive: replicas + surge,
    minAvailable: Math.max(0, replicas - unavailable),
    batch,
    waves: Math.ceil(replicas / batch),
  };
}

/**
 * Оценка полного времени замены.
 *
 * Волна упирается в готовность новых подов, а не в скорость контроллера: пока процесс
 * не ответил, следующая порция не поедет. Поэтому время ≈ число волн × время старта.
 * Без readiness-пробы ждать нечего — контроллер считает под доступным сразу, и все волны
 * укладываются в несколько своих проходов. Ровно это и показал замер: 17.7 с против 1.1 с
 * на одном и том же приложении.
 */
export function estimateSeconds(params: RolloutParams): number {
  const { waves } = limits(params);
  if (!params.readiness) return Number(((waves + 1) * params.syncSeconds).toFixed(2));
  return Number((waves * params.bootSeconds + params.terminateSeconds).toFixed(2));
}

interface SimPod {
  id: string;
  gen: 'old' | 'new';
  /** Когда появился объект пода. У старых — в прошлом. */
  createdAt: number;
  /** Когда процесс внутри начнёт отвечать. */
  readyAt: number;
  /** Когда поду пришло удаление. `Infinity`, пока он не при смерти. */
  terminatingAt: number;
  /** Когда он исчезнет из вывода совсем. */
  goneAt: number;
}

/**
 * Под доступен с точки зрения Kubernetes.
 *
 * ⚠️ Завершающийся под доступным не считается — и это не деталь, а условие, без которого
 * контроллер не смог бы сдвинуться: сняв старый под, он обязан тут же увидеть, что доступных
 * стало меньше, иначе снял бы все четыре разом.
 */
function countsAvailable(pod: SimPod, t: number, readiness: boolean): boolean {
  if (pod.goneAt <= t || pod.terminatingAt <= t) return false;
  if (pod.gen === 'old') return true;
  // Без readiness-пробы «готов» означает «контейнер запущен», и ничего больше.
  return readiness ? pod.readyAt <= t : pod.createdAt + Number.EPSILON <= t;
}

function phaseOf(pod: SimPod, t: number, syncSeconds: number): PodView['phase'] {
  if (pod.terminatingAt <= t) return 'terminating';
  // Первые доли секунды объект пода уже есть, а контейнера ещё нет: в `kubectl get pods`
  // это `ContainerCreating`, и замер поймал эту фазу отдельным кадром.
  if (t < pod.createdAt + syncSeconds) return 'creating';
  return pod.readyAt <= t ? 'ready' : 'starting';
}

/**
 * Развёртка перекатывания по кадрам.
 *
 * Контроллер моделируется двумя правилами, и обе границы взяты из замера:
 *   1) снимать старые поды можно, пока доступных остаётся не меньше `replicas − maxUnavailable`;
 *   2) создавать новые можно, пока живых не больше `replicas + maxSurge`.
 * Порядок именно такой — сначала освободить место, потом занять: в записи прогона первая волна
 * при 4 репликах создаёт сразу два пода, а это возможно только если один старый уже снят.
 */
export function buildFrames(params: RolloutParams): RolloutFrame[] {
  const { replicas, readiness, bootSeconds, syncSeconds, terminateSeconds } = params;
  const { surge, unavailable, minAvailable, maxLive } = limits(params);

  const pods: SimPod[] = Array.from({ length: replicas }, (_, i) => ({
    id: `old-${i + 1}`,
    gen: 'old' as const,
    createdAt: -1,
    readyAt: -1,
    terminatingAt: Infinity,
    goneAt: Infinity,
  }));

  let created = 0;
  let t = 0;
  const frames: RolloutFrame[] = [];

  const alive = () => pods.filter((p) => p.goneAt > t);
  const availableCount = () => pods.filter((p) => countsAvailable(p, t, readiness)).length;

  const snapshot = (note: string, tone?: RolloutFrame['tone']): void => {
    const view: PodView[] = alive().map((pod) => {
      const phase = phaseOf(pod, t, syncSeconds);
      const serving = phase !== 'terminating' && pod.readyAt <= t;
      // Вот здесь и живёт вся разница между двумя половинами темы. С пробой под попадает
      // в сервис по её прохождению, без пробы — как только контейнер запущен.
      const inService =
        phase === 'terminating' ? false : readiness ? pod.readyAt <= t : phase !== 'creating';
      return { id: pod.id, gen: pod.gen, phase, inService, serving };
    });

    frames.push({
      t: Number(t.toFixed(2)),
      pods: view,
      endpoints: view.filter((p) => p.inService).length,
      serving: view.filter((p) => p.inService && p.serving).length,
      available: availableCount(),
      live: view.filter((p) => p.phase !== 'terminating').length,
      note,
      tone,
    });
  };

  snapshot(
    `До выката: ${replicas} пода старой версии, все в сервисе. Запас места — ${surge}, ` +
      `разрешённая просадка — ${unavailable}.`,
  );

  // Шагов заведомо конечное число, но цикл со счётчиком надёжнее рассуждения о том, почему.
  for (let guard = 0; guard < 400; guard += 1) {
    let retired = 0;
    let started = 0;

    // 1. Освободить место: снять столько старых, сколько позволяет пол доступности.
    while (availableCount() > minAvailable) {
      const victim = alive().find((p) => p.gen === 'old' && p.terminatingAt > t);
      if (!victim) break;
      victim.terminatingAt = t;
      victim.goneAt = t + terminateSeconds;
      retired += 1;
    }

    // 2. Занять место: создать столько новых, сколько позволяет потолок живых.
    while (created < replicas && alive().filter((p) => p.terminatingAt > t).length < maxLive) {
      created += 1;
      pods.push({
        id: `new-${created}`,
        gen: 'new',
        createdAt: t,
        readyAt: t + bootSeconds,
        terminatingAt: Infinity,
        goneAt: Infinity,
      });
      started += 1;
    }

    if (retired || started) {
      const parts: string[] = [];
      if (started) parts.push(`создано новых: ${started}`);
      if (retired) parts.push(`снято старых: ${retired}`);
      snapshot(
        `Проход контроллера — ${parts.join(', ')}. Живых ${
          alive().filter((p) => p.terminatingAt > t).length
        } из ${maxLive} разрешённых, доступных ${availableCount()} при пороге ${minAvailable}.`,
        'info',
      );
    }

    const oldGone = pods.every((p) => p.gen === 'new' || p.goneAt <= t);
    const allServing = pods.every((p) => p.goneAt <= t || p.readyAt <= t);
    if (created >= replicas && oldGone && allServing) break;

    // 3. Следующий момент. С пробой ждать нечего, кроме готовности; без пробы контроллер
    //    едет дальше своим шагом, а готовность наступит сама и позже.
    const future = pods
      .flatMap((p) => [p.readyAt, p.goneAt])
      .filter((moment) => moment > t && Number.isFinite(moment));
    const nextEvent = future.length ? Math.min(...future) : t + syncSeconds;
    const canActAtSync = !readiness && created < replicas;
    t = canActAtSync ? Math.min(t + syncSeconds, nextEvent) : nextEvent;

    // Кадр готовности: он же момент, когда провал доступности закрывается.
    const arrived = pods.filter(
      (p) => p.gen === 'new' && p.goneAt > t && Math.abs(p.readyAt - t) < 1e-9,
    ).length;
    if (arrived) {
      snapshot(
        readiness
          ? `Новых подов прошло readiness-пробу: ${arrived}. Только теперь они попали в сервис.`
          : `Процесс в ${arrived} подах наконец начал отвечать — но трафик шёл на них уже ${bootSeconds} с.`,
        readiness ? 'ok' : 'warn',
      );
    }
  }

  snapshot(
    `Замена закончена: ${replicas} подов новой версии, старых не осталось.`,
    frames.some((f) => f.endpoints > f.serving) ? 'warn' : 'ok',
  );

  return frames;
}

/** Был ли за время выката момент, когда трафик шёл на под, который не умел отвечать. */
export function hasTrafficGap(frames: RolloutFrame[]): boolean {
  return frames.some((frame) => frame.endpoints > frame.serving);
}

/** Худшая доля запросов, попавших в никуда, в процентах. */
export function worstLossPercent(frames: RolloutFrame[]): number {
  const worst = frames.reduce((acc, frame) => {
    if (!frame.endpoints) return acc;
    return Math.max(acc, (frame.endpoints - frame.serving) / frame.endpoints);
  }, 0);
  return Math.round(worst * 100);
}

/** Сводка кадров — то же, что считает разбор записи прогона. */
export function summarize(frames: RolloutFrame[]) {
  return {
    maxLive: Math.max(...frames.map((f) => f.live)),
    minAvailable: Math.min(...frames.map((f) => f.available)),
    seconds: frames[frames.length - 1].t,
    trafficGap: hasTrafficGap(frames),
    worstLossPercent: worstLossPercent(frames),
  };
}
