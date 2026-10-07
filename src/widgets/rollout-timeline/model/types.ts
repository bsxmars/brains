/**
 * Перекатывание Deployment как последовательность состояний подов во времени.
 *
 * Под здесь — не строка в `kubectl get pods`, а три разных факта, которые в этой строке слиты
 * в один и потому путаются: контейнер **запущен**, под **числится в сервисе** и процесс внутри
 * **умеет отвечать**. Разошлись эти три — и получается ровно та авария, ради которой существует
 * readiness-проба: `kubectl` показывает `Running 1/1`, `rollout status` говорит «успешно»,
 * а запросы уходят в никуда.
 */

/**
 * Фаза пода на шкале. Названы так, как их видно снаружи:
 *   creating    — объект создан, контейнера ещё нет (`ContainerCreating`);
 *   starting    — контейнер запущен, но процесс внутри ещё не обслуживает;
 *   ready       — отвечает на запросы и прошёл readiness-пробу;
 *   terminating — получил SIGTERM и доживает grace-период.
 */
export type PodPhase = 'creating' | 'starting' | 'ready' | 'terminating';

/** Под в одном кадре: чей он версии и что с ним сейчас. */
export interface PodView {
  id: string;
  gen: 'old' | 'new';
  phase: PodPhase;
  /** Под числится в EndpointSlice сервиса — то есть на него пойдёт трафик. */
  inService: boolean;
  /** Процесс внутри действительно отвечает. Расхождение с `inService` и есть провал. */
  serving: boolean;
}

/** Кадр шкалы: момент времени, состав подов и что в этот момент сделал контроллер. */
export interface RolloutFrame {
  /** Секунды от `kubectl apply`. */
  t: number;
  pods: PodView[];
  /** Сколько подов в сервисе — числитель доли запросов, попавших хоть куда-то. */
  endpoints: number;
  /** Сколько из них действительно отвечает. */
  serving: number;
  /** Столько подов Kubernetes считает доступными (`kubectl get deploy`, колонка AVAILABLE). */
  available: number;
  /** Живые поды — все, кроме завершающихся. Именно их ограничивает `maxSurge`. */
  live: number;
  /** Что произошло в этот момент. Разрешена строчная разметка. */
  note: string;
  tone?: 'info' | 'ok' | 'warn' | 'err';
}

/** Значение `maxSurge` / `maxUnavailable`: число подов или проценты строкой. */
export type Amount = number | `${number}%`;

export interface RolloutParams {
  replicas: number;
  maxSurge: Amount;
  maxUnavailable: Amount;
  /** Есть ли readiness-проба. Без неё под попадает в сервис сразу после старта контейнера. */
  readiness: boolean;
  /** Сколько секунд процессу нужно, чтобы начать отвечать. Снято прогоном: 8 с. */
  bootSeconds: number;
  /** Пауза между проходами контроллера. Снято прогоном: ≈0.4 с. */
  syncSeconds: number;
  /** Сколько живёт завершающийся под. Снято прогоном при `terminationGracePeriodSeconds: 2`. */
  terminateSeconds: number;
}

/** Готовый пресет стратегии для переключателя демо. */
export interface StrategyPreset {
  key: string;
  label: string;
  maxSurge: Amount;
  maxUnavailable: Amount;
  /** Именно этот расклад снят прогоном в кластере, остальные досчитаны теми же правилами. */
  measured?: boolean;
  /** Одна фраза о том, чем эта стратегия платит. */
  cost: string;
}
