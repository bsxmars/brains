import type { FrontPoint, LisFn, MovesFn, MyersFn, MyersResult } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `MYERS_CODE`, `LIS_CODE`,
 * `VUE_MOVES_CODE` и `REACT_MOVES_CODE` из темы «Diff».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/diff.test.ts` против jsdiff, `getSequence` из исходника Vue и настоящих Vue
 * и React в happy-dom. Копии нет: разойдётся показанный код с эталоном — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadMyers(code: string): MyersFn {
  return new Function(`${code}\nreturn myers;`)() as MyersFn;
}

export function loadLis(code: string): LisFn {
  return new Function(`${code}\nreturn lis;`)() as LisFn;
}

/** `vueMoves` зовёт `lis`, поэтому собирается вместе с ним. */
export function loadVueMoves(lisCode: string, code: string): MovesFn {
  return new Function(`${lisCode}\n${code}\nreturn vueMoves;`)() as MovesFn;
}

export function loadReactMoves(code: string): MovesFn {
  return new Function(`${code}\nreturn reactMoves;`)() as MovesFn;
}

/**
 * Фронт после шага d: точка на каждой диагонали −d, −d + 2, …, d — прямо из снимка `trace[d]`.
 * На последнем шаге `myers` останавливается на диагонали k = n − m, и диагонали правее неё
 * в снимке — старые значения; их здесь нет.
 */
export function frontier(res: MyersResult, d: number, n: number, m: number): FrontPoint[] {
  const v = res.trace[d];
  if (!v) return [];
  const last = d === res.d ? n - m : d;
  const out: FrontPoint[] = [];
  for (let k = -d; k <= last; k += 2) {
    const x = v[k];
    if (x === undefined) continue;
    const y = x - k;
    out.push({ k, x, y, inside: x >= 0 && x <= n && y >= 0 && y <= m });
  }
  return out;
}

/** Путь скрипта по сетке: точки (x, y) от (0, 0) до (n, m). */
export function scriptPath(res: MyersResult): [number, number][] {
  let x = 0;
  let y = 0;
  const pts: [number, number][] = [[0, 0]];
  for (const [op] of res.script) {
    if (op !== '+') x++;
    if (op !== '-') y++;
    pts.push([x, y]);
  }
  return pts;
}
