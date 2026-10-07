import type { IoApi, ResizeFrameFn, RoScene } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `IO_CODE` и `RO_CODE` из темы
 * «Наблюдатели» (`src/content/render/observers/data.ts`).
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/observers.test.ts` против настоящего Chromium: `IO_CODE` — на сетке случайных
 * геометрий, `RO_CODE` — на случайных деревьях и сценах демо. Копии нет: если показанный код
 * разойдётся с браузером, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadIo(code: string): IoApi {
  return new Function(`${code}\nreturn { parseMargin, expand, intersect, computeEntry, compareFrames };`)() as IoApi;
}

export function loadResizeFrame(code: string): ResizeFrameFn {
  return new Function(`${code}\nreturn resizeFrame;`)() as ResizeFrameFn;
}

/** Глубина каждого узла сцены: верхний уровень — 1, ребёнок — на единицу глубже родителя. */
export function depthMap(scene: Pick<RoScene, 'nodes'>): Record<string, number> {
  const depth: Record<string, number> = {};
  for (const n of scene.nodes) depth[n.id] = n.parent ? depth[n.parent] + 1 : 1;
  return depth;
}
