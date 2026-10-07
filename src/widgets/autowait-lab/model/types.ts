/**
 * Снимок состояния кнопки `#buy` в момент `t` (мс от начала действия). Между снимками
 * состояние не меняется. Те же поля стенд применял к настоящей кнопке в Chromium.
 */
export interface Snapshot {
  t: number;
  /** Узел в документе. */
  attached: boolean;
  /** Не `display: none` и не `visibility: hidden`, рамка ненулевая. */
  visible: boolean;
  /** Левый край, px. Скачок между кадрами — элемент нестабилен. */
  x: number;
  /** Идёт CSS-анимация `transform`: рамка разная в каждом кадре. */
  moving: boolean;
  /** Что лежит поверх кнопки в точке клика — так, как Playwright печатает узел. `null` — ничего. */
  coveredBy: string | null;
  disabled: boolean;
}

/** Строка журнала: время в мс от начала действия и сообщение Playwright. */
export type LogLine = [number, string];

export interface AutoWaitResult {
  log: LogLine[];
  /** Момент, когда пошли события мыши; `null` — действие упало по таймауту. */
  clickAt: number | null;
  error: string | null;
}

export type AutoWaitFn = (timeline: Snapshot[], timeout: number) => AutoWaitResult;

/** Фикстура демо: «до» с момента 0, «после» — с `changeAt`. Снята стендом (шапка `data.ts` темы). */
export interface AwFixture {
  id: string;
  label: string;
  /** Чем кнопка отличается от готовой до момента `changeAt`. */
  before: Partial<Snapshot>;
  /** Момент, когда кнопка становится готовой, мс, — как на стенде. */
  changeAt: number;
  /** Подпись над демо. Строчная разметка. */
  note: string;
  /** Журнал Playwright со стенда (первый из трёх прогонов), от поиска до клика. */
  stand: LogLine[];
  /** Момент клика в трёх прогонах стенда, мс. */
  standClicks: number[];
}
