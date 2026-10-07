import type { IterRun } from './types';

/**
 * Обход `Map` на ходу — настоящим `for…of`, а не пересказом.
 *
 * Сценарий — строка из `data.ts`: та же, что напечатана читателю. Она объявляет `m`
 * и на каждом шаге цикла зовёт `visit(k)`. Здесь `visit` пишет ключ в журнал и после
 * `LIMIT` посещений бросает — иначе сценарий «удалить и вставить текущий» повесил бы
 * вкладку. Брошенное отличается от настоящей ошибки сценария по классу `Stop`.
 *
 * Чистая функция без DOM и Vue: демо и `tests/unit/collections.test.ts` зовут её одинаково.
 */

/** Сколько посещений считать бесконечным циклом. В любом конечном сценарии их меньше пяти. */
export const LIMIT = 12;

class Stop extends Error {}

const show = (v: unknown): string => (typeof v === 'string' ? v : String(v));

export function runIteration(code: string): IterRun {
  const visited: string[] = [];
  const visit = (k: unknown) => {
    visited.push(show(k));
    if (visited.length >= LIMIT) throw new Stop();
  };

  let looped = false;
  let m: Map<unknown, unknown> | undefined;
  try {
    m = new Function('visit', `${code}\nreturn m;`)(visit) as Map<unknown, unknown>;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    looped = true;
  }

  // При обрыве таблицы нет: цикл не закончился, и «что осталось после» не наступило.
  return {
    visited,
    looped,
    after: m ? [...m].map(([k, v]) => `${show(k)} → ${show(v)}`) : [],
  };
}
