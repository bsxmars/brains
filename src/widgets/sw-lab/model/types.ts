/** Что лежит на сервере под именем `sw.js`: версия и строки, которыми вариант отличается от `SW_CODE`. */
export interface SwScript {
  v: string;
  /** `self.skipWaiting()` первой строкой `install`. */
  skipWaiting?: boolean;
  /** `await self.clients.claim()` в конце `activate`. */
  claim?: boolean;
  /** В `PRECACHE` есть адрес, на который сервер отвечает 404. */
  missing?: boolean;
}

/** Шаг сценария — то, что делает разработчик или пользователь. */
export type SwStep =
  | { do: 'deploy'; script: SwScript }
  | { do: 'open' | 'reload' | 'close'; tab: string }
  | { do: 'update' | 'skip' };

/**
 * Что видно после шага. Так же устроен журнал стенда: `workers` — смены состояния воркеров
 * по порядку (CDP `ServiceWorker.workerVersionUpdated`), `controllerchange` — вкладки, где
 * сработало это событие, `waiting`/`active` — места регистрации, `tabs` — контроллер вкладки.
 */
export interface SwSnapshot {
  workers: string[];
  controllerchange: string[];
  waiting: string | null;
  active: string | null;
  tabs: Record<string, string | null>;
}

export type RunLifecycle = (steps: SwStep[]) => SwSnapshot[];

export interface SwScenario {
  id: string;
  label: string;
  /** Подпись над сценарием. Строчная разметка. */
  note: string;
  steps: SwStep[];
  /** Журнал Chromium по шагам — литерал стенда. */
  chromium: SwSnapshot[];
}

export type StrategyStep = 'get' | 'bump' | 'offline' | 'online';

/** Один запрос страницы: что она получила и сколько запросов дошло до сервера за шаг. */
export interface StrategyLogEntry {
  got: string;
  hits: number;
}

export interface CacheLike {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export type Strategy = (
  request: Request,
  cache: CacheLike,
  network: (request: Request) => Promise<Response>,
  later: (p: Promise<unknown>) => void,
) => Promise<Response>;

export interface StrategyApi {
  cacheFirst: Strategy;
  networkFirst: Strategy;
  staleWhileRevalidate: Strategy;
}

export type Replay = (strategy: Strategy, steps: StrategyStep[]) => Promise<StrategyLogEntry[]>;

export interface StrategyCase {
  id: keyof StrategyApi;
  label: string;
  /** Адрес на стенде. */
  path: string;
  note: string;
  /** Ответы Chromium по запросам — литерал стенда. */
  chromium: StrategyLogEntry[];
}
