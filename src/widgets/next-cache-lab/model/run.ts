import type { ModelCodes, NextModel, Routes, StandStep, Step, StepResult } from './types';

/**
 * Демо и тест спрашивают одну и ту же модель — строки `ROUTES_CODE`, `SERVER_MODEL_CODE`
 * и `ROUTER_MODEL_CODE` из темы «Слои кеша в Next.js».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/next-cache.test.ts` по сценариям темы: на каждом шаге модель обязана дать то же,
 * что записал журнал стенда (`next build` + `next start` 16.3.8, Chromium) — какие ключи дошли
 * до бэкенда, что вернул `x-nextjs-cache` и `Cache-Control`, что показала страница. Сам журнал
 * пересобирается настоящим Next в `tests/unit/next-cache-stand.test.ts`.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadRoutes(code: string): Routes {
  return new Function(`${code}\nreturn routes;`)() as Routes;
}

export function createModel(codes: ModelCodes): NextModel {
  const make = new Function('routes', `${codes.server}\n${codes.router}\nreturn createNext(routes);`) as (r: Routes) => NextModel;
  return make(loadRoutes(codes.routes));
}

/** Приводит запросы вкладки к виду для сравнения: каждый адрес один раз, по алфавиту. */
export function normRequests(list: string[]): string[] {
  return [...new Set(list)].sort();
}

/** Поля шага модели в том виде, в каком они записаны в журнале стенда. */
export function asStand(r: StepResult, mode: 'http' | 'browser', step: Step | null): StandStep {
  const backend = [...r.backend].sort();
  // Сборка (step === null), паузы и вызовы сброса: в журнале только бэкенд.
  if (!step) return { backend };
  if (mode === 'browser') return { backend, shown: r.shown, requests: normRequests(r.requests) };
  if (step.do !== 'get') return { backend };
  return { backend, xcache: r.xcache, cc: r.cc, shown: r.shown };
}

/** Совпал ли шаг модели с журналом стенда — по тем полям, что сняты. */
export function sameAsStand(model: StandStep, stand: StandStep): boolean {
  const keys = new Set([...Object.keys(model), ...Object.keys(stand)]) as Set<keyof StandStep>;
  return [...keys].every((k) => JSON.stringify(model[k]) === JSON.stringify(stand[k]));
}

/** Подпись шага сценария — так он назван в таблицах и в демо. */
export function stepLabel(step: Step): string {
  switch (step.do) {
    case 'get':
      return `GET ${step.path}`;
    case 'open':
      return `открыть ${step.path}`;
    case 'click':
      return `ссылка ${step.path}`;
    case 'back':
      return '«назад»';
    case 'reload':
      return 'перезагрузка';
    case 'action':
      return `кнопка: updateTag('${step.tag}')`;
    case 'revalidateTag':
      return `revalidateTag('${step.tag}', ${step.expire0 ? '{ expire: 0 }' : "'max'"})`;
    case 'revalidatePath':
      return `revalidatePath('${step.path}')`;
    case 'wait':
      return `пауза ${step.s} с`;
  }
}

/** Прогнать сценарий целиком: сборка, потом шаги. */
export function playScenario(codes: ModelCodes, steps: Step[]): { model: NextModel; results: StepResult[] } {
  const model = createModel(codes);
  const results = [model.build()];
  for (const s of steps) results.push(model.run(s));
  return { model, results };
}
