import type { Minute, Mode, Model, Replay, ScenarioParams } from './types';

/**
 * Демо и тест спрашивают модель одним и тем же кодом — строками `MODEL_PARTS` из темы
 * «Прогрессивная доставка».
 *
 * `loadModel` склеивает их и собирает `new Function`: те же строки лежат в `data.ts`,
 * четыре из них напечатаны на странице, и те же исполняет `tests/unit/progressive-delivery.test.ts`.
 * Копии нет.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModel(parts: string[]): Model {
  return new Function(parts.join('\n'))() as Model;
}

/** Куда пойдёт пользователь: в канарейку по соли выката или в функцию по ключу флага. */
export function router(
  model: Model,
  mode: Mode,
  keys: { salt: string; flag: string },
  weight: number,
  killed: boolean,
): (id: string) => 'base' | 'next' {
  if (mode === 'flag') {
    const flag = { key: keys.flag, percent: weight, killed };
    return (id) => (model.flagOn(flag, id) ? 'next' : 'base');
  }
  return (id) => (model.inRollout(keys.salt, id, weight) ? 'next' : 'base');
}

/**
 * Ручной режим демо: поток проигрывается с начала по списку накопленных минут.
 *
 * Состояние потока — не реактивное и не хранится в компоненте: достаточно списка минут
 * и сида, чтобы получить те же числа на сервере, в браузере и в тесте. Цена — повторный
 * проигрыш на каждое нажатие; при потолке в 30 минут это десятки миллисекунд.
 */
export function replay(
  model: Model,
  scenario: ScenarioParams,
  mode: Mode,
  keys: { salt: string; flag: string },
  minutes: Minute[],
): Replay {
  const traffic = model.createTraffic(scenario);
  const log: Replay['log'] = [];
  for (const m of minutes) {
    traffic.tick(router(model, mode, keys, m.weight, m.killed));
    log.push({
      minute: traffic.minute(),
      weight: m.weight,
      killed: m.killed,
      decision: model.decide(traffic.stats.base, traffic.stats.next),
    });
  }
  return { stats: traffic.stats, log };
}
