import type { CloneCase, CloneOutcome } from './types';

/**
 * Прогнать один случай через настоящий `structuredClone`.
 *
 * Отдельной функцией, а не внутри компонента, по одной причине: ровно этот же код исполняет
 * `tests/unit/clone-survival.test.ts`. Демо и тест обязаны спрашивать движок одинаково —
 * иначе «проверено тестом» означало бы «проверено что-то похожее».
 *
 * Наружу отдаётся имя ошибки, а не её текст: текст у каждого движка свой («could not be
 * cloned» в V8, другой в JSC), и строить на нём вид страницы значило бы показывать читателю
 * разное в разных браузерах. Имя `DataCloneError` — нормативное.
 */
export function runCloneCase(item: CloneCase): CloneOutcome {
  let source: unknown;
  try {
    source = item.make();
  } catch (failure) {
    return { verdict: 'throw', note: `значение не удалось создать: ${name(failure)}` };
  }

  try {
    const clone = structuredClone(source);
    return item.inspect ? item.inspect(clone) : { verdict: 'ok', note: 'клон совпадает с оригиналом' };
  } catch (failure) {
    return { verdict: 'throw', note: name(failure) };
  }
}

function name(failure: unknown): string {
  const error = failure as { name?: string };
  return error?.name ?? 'Error';
}
