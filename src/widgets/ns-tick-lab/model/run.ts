import type { NsFrame, NsHost, NsParams, NsRun, NsStreams } from './types';

/**
 * Демо и тест прогоняют один и тот же код — две строки из темы.
 *
 * `NS_MODEL_CODE` — модель `node:stream` (objectMode, один `pipe`, без ошибок), тело функции
 * с параметром `host`. `NS_SCENARIO_CODE` — сценарий: источник, потребитель и цикл тиков,
 * объявление `async function run(streams, params)`. Сценарий не знает, чьи у него классы:
 * демо даёт ему модель, тест — модель и настоящий `node:stream`, и сверяет кадры.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModel(code: string, host: NsHost): NsStreams {
  return new Function('host', `"use strict";\n${code}`)(host) as NsStreams;
}

export function loadScenario(code: string): NsRun {
  return new Function(`"use strict";\n${code}\nreturn run;`)() as NsRun;
}

/**
 * Хвост без событий отрезается: сценарий гоняет тики с запасом, а смотреть на пустые
 * кадры после `'close'` незачем. Последним остаётся кадр, где что-то случилось.
 */
export function trimFrames(frames: NsFrame[]): NsFrame[] {
  let last = 0;
  frames.forEach((f, i) => {
    if (f.log.length) last = i;
  });
  return frames.slice(0, last + 1);
}

/**
 * Прогон модели. Модель собирается заново на каждый прогон: очередь `nextTick` у неё
 * своя, модульная, и после прошлого прогона в ней не должно остаться ничего.
 */
export async function simulate(
  modelCode: string,
  scenarioCode: string,
  params: NsParams,
  host: NsHost,
): Promise<NsFrame[]> {
  const streams = loadModel(modelCode, host);
  const run = loadScenario(scenarioCode);
  return run(streams, params);
}
