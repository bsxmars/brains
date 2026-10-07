/** Один `fetch` маршрута учебной модели — то, что страница стенда передаёт в `fetch`. */
export interface RouteFetch {
  key: string;
  cache?: 'force-cache' | 'no-store';
  revalidate?: number;
  tags?: string[];
  /** Свой `AbortSignal`: мемоизация в рендере выключена. */
  signal?: boolean;
}

export interface RouteSpec {
  /** Обращается к `cookies()` — маршрут динамический. */
  dynamic?: boolean;
  fetches: RouteFetch[];
}

export type Routes = Record<string, RouteSpec>;

/** Шаг сценария. Тот же список шагов исполняют модель (демо, тест) и настоящий стенд. */
export type Step =
  | { do: 'get'; path: string }
  | { do: 'open'; path: string }
  | { do: 'click'; path: string }
  | { do: 'back' }
  | { do: 'reload' }
  | { do: 'action'; tag: string }
  | { do: 'revalidateTag'; tag: string; expire0?: boolean }
  | { do: 'revalidatePath'; path: string }
  | { do: 'wait'; s: number };

export type Layer = 'роутер' | 'маршрут' | 'данные' | 'рендер';

export interface TraceLine {
  layer: Layer;
  text: string;
  /** Случилось после ответа: фоновая перегенерация или фоновый запрос данных. */
  later?: boolean;
}

/** Что модель вернула на шаг. Поля, которые сравниваются со стендом, — `backend`, `xcache`, `cc`, `shown`, `requests`. */
export interface StepResult {
  requests: string[];
  backend: string[];
  xcache: string | null;
  cc: string | null;
  url: string | null;
  /** Что на экране: `ключ=n` через пробел, в порядке страницы. */
  shown: string | null;
  trace: TraceLine[];
  now: number;
}

export interface NextModel {
  build(): StepResult;
  run(step: Step): StepResult;
}

/** Как шаг выглядел на стенде. Пустое поле — для этого шага не снималось. */
export interface StandStep {
  backend: string[];
  xcache?: string | null;
  cc?: string | null;
  shown?: string | null;
  requests?: string[];
}

export interface Scenario {
  id: string;
  label: string;
  /** Подпись над сценарием. Строчная разметка. */
  note: string;
  /** Заход из вкладки (`open`, `click`…) или запросами «как curl» (`get`). */
  mode: 'http' | 'browser';
  steps: Step[];
  /** Журнал стенда: `stand[0]` — сборка, дальше по шагу на каждый шаг сценария. */
  stand: StandStep[];
}

export interface ModelCodes {
  routes: string;
  server: string;
  router: string;
}
