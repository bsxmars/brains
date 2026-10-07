import type { Replay, RunLifecycle, StrategyApi, SwSnapshot } from './types';

/**
 * Демо и тест спрашивают одни и те же строки темы «Service Worker изнутри»:
 * `LIFECYCLE_CODE` (модель регистрации), `STRATEGY_CODE` (три стратегии) и `REPLAY_CODE`
 * (сервер и кеш стенда в миниатюре).
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. `tests/unit/service-worker.test.ts`
 * сверяет журнал модели с журналами Chromium со стенда на каждом сценарии, а ответы стратегий —
 * с ответами, которые получила страница стенда. Копии нет: разойдётся показанный код
 * с браузером — покраснеет тест.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadLifecycle(code: string): RunLifecycle {
  return new Function(`${code}\nreturn run;`)() as RunLifecycle;
}

export function loadStrategies(code: string): StrategyApi {
  return new Function(`${code}\nreturn { cacheFirst, networkFirst, staleWhileRevalidate };`)() as StrategyApi;
}

export function loadReplay(code: string): Replay {
  return new Function(`${code}\nreturn replay;`)() as Replay;
}

/** Совпадают ли два снимка шага целиком. */
export function sameSnapshot(a: SwSnapshot | undefined, b: SwSnapshot | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
