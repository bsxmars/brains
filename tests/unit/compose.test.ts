import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RUNS, SCENARIOS } from '@/content/delivery/compose/data';
import {
  conditionMet,
  firstAt,
  headStart,
  parseDockerEvents,
  span,
  stateAt,
} from '@/widgets/service-startup/model/states';
import type { Scenario, StartupEvent } from '@/widgets/service-startup/model/types';

/**
 * Числа темы «Docker Compose: несколько сервисов» — против записи прогона.
 *
 * Тест **не запускает докер**: он разбирает то, что демон напечатал во время замера. Фикстуры
 * в `tests/fixtures/compose/` — дословный вывод
 * `docker events --format '{{.TimeNano}};{{index .Actor.Attributes "com.docker.compose.service"}};{{.Action}}'`
 * и логов самих контейнеров.
 *
 * Что именно закрепляется. Не миллисекунды: они машинозависимы, и тест, сверяющий их дословно,
 * покраснел бы от смены железа, а не от ошибки (см. «Как меряют в этом курсе» в AGENTS.md).
 * Закрепляется **порядок событий и отношения между ними** — то, на чём стоит объяснение:
 *
 *   — в прогоне без healthcheck приложение стартовало, когда база была только `started`;
 *   — в прогоне с healthcheck оно стартовало после `healthy`, а `healthy` — после того, как
 *     база написала в лог, что принимает соединения;
 *   — числа на шкале демо совпадают с записью до миллисекунды: их нельзя поправить руками,
 *     не уронив этот тест.
 */

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/compose/${name}`, import.meta.url), 'utf8');

const scenario = (id: string): Scenario => {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Нет сценария ${id}`);
  return found;
};

const PLAIN = scenario('plain');
const HEALTHY = scenario('healthy');

/** События, которые демон действительно печатает, — только их и можно сверять с записью. */
const FROM_DAEMON = new Set(['create', 'start', 'probe', 'healthy', 'die']);
const daemonEvents = (s: Scenario): StartupEvent[] => s.events.filter((e) => FROM_DAEMON.has(e.kind));

describe('разбор записи демона', () => {
  it('отметки на шкале демо совпадают с docker events до миллисекунды', () => {
    const cases: [Scenario, string, number][] = [
      [PLAIN, 'plain-events.txt', RUNS.plain.t0],
      [HEALTHY, 'healthy-events.txt', RUNS.healthy.t0],
    ];

    for (const [current, file, t0] of cases) {
      const parsed = parseDockerEvents(fixture(file), t0);

      for (const event of daemonEvents(current)) {
        const match = parsed.find((p) => p.service === event.service && p.kind === event.kind);
        expect(match, `${current.id}: в записи нет ${event.service}/${event.kind}`).toBeDefined();
        expect(match?.at, `${current.id}: ${event.service}/${event.kind}`).toBe(event.at);
      }
    }
  });

  it('служебные события демона в шкалу не попадают', () => {
    const parsed = parseDockerEvents(fixture('plain-events.txt'), RUNS.plain.t0);
    const kinds = new Set(parsed.map((e) => e.kind));

    // В записи есть attach, kill, stop, exec_create и exec_die — на шкале им делать нечего.
    expect(fixture('plain-events.txt')).toContain(';attach');
    expect([...kinds].every((kind) => FROM_DAEMON.has(kind))).toBe(true);
  });

  it('события отсортированы по времени', () => {
    const parsed = parseDockerEvents(fixture('healthy-events.txt'), RUNS.healthy.t0);
    const times = parsed.map((e) => e.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('главный факт: depends_on без условия не ждёт готовности', () => {
  it('без healthcheck приложение стартует, когда база всего лишь «запущена»', () => {
    const appStart = firstAt(PLAIN.events, 'app', 'start');
    expect(appStart).not.toBeNull();

    expect(
      conditionMet(PLAIN.events, 'db', 'service_started', appStart as number),
      'условие короткой формы к этому моменту выполнено',
    ).toBe(true);

    expect(
      conditionMet(PLAIN.events, 'db', 'service_healthy', appStart as number),
      'а готовности никто не проверял и не дождался',
    ).toBe(false);
  });

  it('и немедленно умирает на подключении', () => {
    const die = PLAIN.events.find((e) => e.kind === 'die' && e.service === 'app');
    const connect = PLAIN.events.find((e) => e.kind === 'connect' && e.service === 'app');

    expect(die?.exit, 'код возврата приложения').toBe(1);
    expect(connect?.label).toContain('Connection refused');
    expect(stateAt(PLAIN.events, 'app', die?.at ?? 0)).toBe('упал');
  });

  it('в записи прогона без healthcheck момента готовности базы нет вовсе', () => {
    // Это не пропуск в данных: `up` начал сносить стек сразу после падения приложения,
    // и захват логов кончился раньше, чем база дописала initdb.
    expect(firstAt(PLAIN.events, 'db', 'ready')).toBeNull();
    expect(headStart(PLAIN)).toBeNull();
  });

  it('лог парного прогона: приложение упало раньше, чем база приняла соединения', () => {
    const lines = fixture('plain-first-run.log').split('\n');
    const failed = lines.findIndex((line) => line.includes('Connection refused'));
    const ready = lines.findIndex((line) => line.includes('ready to accept connections'));

    expect(failed, 'строка с ошибкой в логе есть').toBeGreaterThanOrEqual(0);
    expect(ready, 'строка о готовности базы в логе есть').toBeGreaterThanOrEqual(0);
    expect(failed, 'ошибка напечатана раньше готовности').toBeLessThan(ready);
  });
});

describe('с condition: service_healthy тот же стек проходит', () => {
  it('приложение стартует только после healthy', () => {
    const appStart = firstAt(HEALTHY.events, 'app', 'start') as number;
    const dbHealthy = firstAt(HEALTHY.events, 'db', 'healthy') as number;

    expect(dbHealthy).toBeLessThan(appStart);
    expect(conditionMet(HEALTHY.events, 'db', 'service_healthy', appStart)).toBe(true);
    expect(stateAt(HEALTHY.events, 'db', appStart)).toBe('healthy');
  });

  it('и доходит до ответа базы', () => {
    const die = HEALTHY.events.find((e) => e.kind === 'die' && e.service === 'app');
    expect(die?.exit).toBe(0);
    expect(fixture('healthy-app.log')).toContain('db=OK');
    expect(fixture('plain-app.log')).toContain('exit=1');
  });

  it('healthy наступает позже настоящей готовности — на интервал пробы', () => {
    const ready = firstAt(HEALTHY.events, 'db', 'ready') as number;
    const healthy = firstAt(HEALTHY.events, 'db', 'healthy') as number;
    const probe = firstAt(HEALTHY.events, 'db', 'probe') as number;

    expect(ready).toBeLessThan(probe);
    expect(probe).toBeLessThan(healthy);
    // Зазор положительный и меньше одного интервала пробы (1 с): демон не может узнать
    // о готовности раньше, чем следующий раз спросит.
    expect(healthy - ready).toBeGreaterThan(0);
    expect(healthy - ready).toBeLessThan(1000);
  });

  it('отметка готовности взята из лога базы, а не придумана', () => {
    // В логе: «2026-09-15 10:41:46.970 UTC [1] LOG: database system is ready to accept
    // connections». Считаем от той же точки отсчёта, что и события демона.
    const line = fixture('healthy-db.log')
      .split('\n')
      .filter((l) => l.includes('[1] LOG'))
      .at(-1) as string;

    const stamp = line.match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3}) UTC/);
    expect(stamp, 'в логе есть отметка времени').not.toBeNull();

    const [, hh, mm, ss, ms] = stamp as RegExpMatchArray;
    const start = new Date(RUNS.healthy.t0 * 1000);
    const readyMs =
      (Number(hh) - start.getUTCHours()) * 3600_000 +
      (Number(mm) - start.getUTCMinutes()) * 60_000 +
      (Number(ss) - start.getUTCSeconds()) * 1000 +
      (Number(ms) - start.getUTCMilliseconds());

    expect(Math.round(readyMs)).toBe(firstAt(HEALTHY.events, 'db', 'ready'));
  });

  it('ожидание стоит времени — и это честная цена', () => {
    const plainStart = firstAt(PLAIN.events, 'app', 'start') as number;
    const healthyStart = firstAt(HEALTHY.events, 'app', 'start') as number;

    expect(healthyStart).toBeGreaterThan(plainStart);
    // Без ожидания приложение успело упасть раньше, чем с ожиданием вообще стартовало.
    expect(span(PLAIN.events)).toBeLessThan(healthyStart);
    // А приложение, которое дождалось, стартовало уже после готовности базы.
    expect(headStart(HEALTHY)).toBeGreaterThan(0);
  });
});

describe('состояние сервиса на шкале', () => {
  it('идёт по порядку: нет → создан → стартует → healthy', () => {
    const at = (t: number) => stateAt(HEALTHY.events, 'db', t);
    const create = firstAt(HEALTHY.events, 'db', 'create') as number;
    const start = firstAt(HEALTHY.events, 'db', 'start') as number;
    const ready = firstAt(HEALTHY.events, 'db', 'ready') as number;
    const healthy = firstAt(HEALTHY.events, 'db', 'healthy') as number;

    expect(at(0)).toBe('нет');
    expect(at(create)).toBe('создан');
    expect(at(start)).toBe('стартует');
    expect(at(ready)).toBe('принимает соединения');
    expect(at(healthy)).toBe('healthy');
  });

  it('проба состояние не меняет: она его только выясняет', () => {
    const probe = firstAt(HEALTHY.events, 'db', 'probe') as number;
    // Между «принимает соединения» и `healthy` проба уже случилась, а статус ещё прежний.
    expect(stateAt(HEALTHY.events, 'db', probe)).toBe('принимает соединения');
  });

  it('чужие события чужого сервиса не трогают', () => {
    const end = span(HEALTHY.events);
    expect(stateAt(HEALTHY.events, 'cache', end)).toBe('healthy');
    expect(stateAt(HEALTHY.events, 'нет-такого', end)).toBe('нет');
  });
});

describe('условия depends_on', () => {
  it('service_completed_successfully — про код возврата, а не про запуск', () => {
    const end = span(PLAIN.events);
    // Приложение вышло с кодом 1: запуск был, успешного завершения нет.
    expect(conditionMet(PLAIN.events, 'app', 'service_started', end)).toBe(true);
    expect(conditionMet(PLAIN.events, 'app', 'service_completed_successfully', end)).toBe(false);

    const healthyEnd = span(HEALTHY.events);
    expect(conditionMet(HEALTHY.events, 'app', 'service_completed_successfully', healthyEnd)).toBe(
      true,
    );
  });

  it('до события условие не выполнено', () => {
    const start = firstAt(HEALTHY.events, 'db', 'start') as number;
    expect(conditionMet(HEALTHY.events, 'db', 'service_started', start - 1)).toBe(false);
    expect(conditionMet(HEALTHY.events, 'db', 'service_started', start)).toBe(true);
  });
});
