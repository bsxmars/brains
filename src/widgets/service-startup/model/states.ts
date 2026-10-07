import type { EventKind, Scenario, ServiceState, StartupEvent } from './types';

/**
 * Логика готовности: что Compose знает о сервисе в каждый момент времени.
 *
 * Отдельный файл без Vue — по той же причине, по которой отдельно живут `neighbours`:
 * это чистые функции, и их можно закрыть юнит-тестом (`tests/unit/compose.test.ts`).
 * Проверять тут есть что: вся тема держится на разнице между «процесс запущен» и «процесс
 * готов принимать работу», а разницу эту видно только на временной шкале.
 */

/** Условие в `depends_on` — ровно три, как в спецификации Compose. */
export type Condition = 'service_started' | 'service_healthy' | 'service_completed_successfully';

/**
 * Разбор строки `docker events`.
 *
 * Формат снимался командой
 * `docker events --format '{{.TimeNano}};{{index .Actor.Attributes "com.docker.compose.service"}};{{.Action}}'`,
 * и фикстуры в `tests/fixtures/compose/` — её вывод байт в байт. Разбор живёт здесь, а не
 * в тесте, потому что именно он превращает запись прогона в то, что рисует демо: если числа
 * на шкале разойдутся с записью, красным станет тест, а не читатель.
 */
const IGNORED = new Set(['attach', 'kill', 'stop', 'exec_create', 'exec_die', 'destroy']);

export function parseDockerEvents(raw: string, t0Seconds: number): StartupEvent[] {
  const events: StartupEvent[] = [];

  for (const line of raw.split('\n')) {
    const [nano, service, action] = line.split(';');
    if (!nano || !service || !action) continue;
    // Демон отдаёт наносекунды целым числом; до миллисекунд от начала `up` — одно деление.
    const at = Math.round(Number(nano) / 1e6 - t0Seconds * 1000);
    const kind = kindOf(action);
    if (!kind) continue;
    events.push({ at, service, kind, label: action });
  }

  return events.sort((a, b) => a.at - b.at);
}

function kindOf(action: string): EventKind | null {
  if (action.startsWith('exec_start')) return 'probe';
  if (action.startsWith('health_status: healthy')) return 'healthy';
  if (IGNORED.has(action) || action.startsWith('exec_')) return null;
  if (action === 'create' || action === 'start' || action === 'die') return action;
  return null;
}

/**
 * Состояние сервиса в момент `t`.
 *
 * Правило простое: берём последнее случившееся с ним событие. Важно тут другое — `ready`
 * в этот список входит наравне с остальными, хотя демон о нём не знает. Так на дорожке видно
 * то, ради чего тема написана: процесс уже готов, а Compose об этом не в курсе и ждать
 * не собирается.
 */
const STATE: Record<EventKind, ServiceState | null> = {
  create: 'создан',
  start: 'стартует',
  probe: null, // проба состояния не меняет: она его только выясняет
  ready: 'принимает соединения',
  healthy: 'healthy',
  connect: null, // обращение приложения — событие приложения, а не сервиса
  die: 'вышел',
};

export function stateAt(events: StartupEvent[], service: string, t: number): ServiceState {
  let state: ServiceState = 'нет';

  for (const event of events) {
    if (event.at > t || event.service !== service) continue;
    if (event.kind === 'die') {
      state = event.exit === 0 ? 'вышел' : 'упал';
      continue;
    }
    const next = STATE[event.kind];
    if (next) state = next;
  }

  return state;
}

/**
 * Выполнено ли условие `depends_on` к моменту `t`.
 *
 * `service_started` — единственное, что даёт короткая форма `depends_on: [db]`, и она же
 * источник главного заблуждения темы: запущен ≠ готов.
 */
export function conditionMet(
  events: StartupEvent[],
  service: string,
  condition: Condition,
  t: number,
): boolean {
  const own = events.filter((e) => e.service === service && e.at <= t);

  if (condition === 'service_started') return own.some((e) => e.kind === 'start');
  if (condition === 'service_healthy') return own.some((e) => e.kind === 'healthy');
  return own.some((e) => e.kind === 'die' && e.exit === 0);
}

/** Момент первого события такого рода у сервиса; `null` — такого не случилось. */
export function firstAt(
  events: StartupEvent[],
  service: string,
  kind: EventKind,
): number | null {
  const found = events.find((e) => e.service === service && e.kind === kind);
  return found ? found.at : null;
}

/**
 * Главное число темы: сколько приложение ждало базу.
 *
 * Положительное — приложение стартовало **после** того, как база начала принимать соединения;
 * отрицательное — до, и тогда его первое же подключение обречено. Считается по записи прогона,
 * а не по обещанию конфигурации.
 */
export function headStart(scenario: Scenario, app = 'app', db = 'db'): number | null {
  const appStart = firstAt(scenario.events, app, 'start');
  const dbReady = firstAt(scenario.events, db, 'ready');
  if (appStart === null || dbReady === null) return null;
  return appStart - dbReady;
}

/** Длительность сценария — последнее событие на шкале. */
export function span(events: StartupEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.at), 0);
}
