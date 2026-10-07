import { losses, shape, show } from './shape';
import type { CloneImpl, MethodId, MethodResult } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `STRINGIFY_CODE` и `CLONE_CODE` темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/serialization.test.ts` против настоящих `JSON.stringify` и `structuredClone`
 * на наборе значений и на случайных деревьях. Копии нет: разойдётся показанный код
 * с движком — покраснеет тест, а в демо загорится «расходится с браузером».
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadImpl(stringifyCode: string, cloneCode: string): CloneImpl {
  return new Function(`${stringifyCode}\n${cloneCode}\nreturn { stringify, clone };`)() as CloneImpl;
}

/** Фабрика значения из тела функции примера: каждый вызов — свежий экземпляр. */
export function loadSample(code: string): () => unknown {
  const make = new Function(code) as () => unknown;
  return make;
}

const errorText = (e: unknown) =>
  e instanceof Error || (typeof DOMException !== 'undefined' && e instanceof DOMException)
    ? `${(e as Error).name}: ${(e as Error).message.split('\n')[0]}`
    : String(e);

const errorName = (e: unknown) => (e && typeof e === 'object' && 'name' in e ? String((e as Error).name) : typeof e);

/** Исход вызова: значение или имя исключения — для сверки учебной функции с настоящей. */
function attempt<T>(fn: () => T): { ok: true; value: T } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

export const METHOD_LABELS: Record<MethodId, string> = {
  spread: '{ ...value }',
  json: 'JSON.parse(stringify(value))',
  clone: 'clone(value)',
};

/**
 * Три способа копирования над одним примером. Каждый способ получает свежий экземпляр:
 * геттеры с побочными эффектами и счётчики в примере не мешают соседям.
 */
export function runMethods(make: () => unknown, impl: CloneImpl): MethodResult[] {
  const methods: [MethodId, (v: unknown) => unknown][] = [
    ['spread', (v) => ({ ...(v as object) })],
    ['json', (v) => {
      const text = impl.stringify(v);
      return text === undefined ? undefined : JSON.parse(text);
    }],
    ['clone', (v) => impl.clone(v)],
  ];

  return methods.map(([id, copy]) => {
    const source = make();
    const run = attempt(() => copy(source));
    return {
      id,
      label: METHOD_LABELS[id],
      shown: run.ok ? show(run.value) : null,
      error: run.ok ? null : errorText(run.error),
      losses: run.ok ? losses(source, run.value) : [],
      native: id === 'spread' ? null : nativeCheck(id, make, impl),
    };
  });
}

/** Учебная функция против настоящей на свежих экземплярах: тот же текст / та же структура. */
export function nativeCheck(id: 'json' | 'clone', make: () => unknown, impl: CloneImpl): 'same' | 'differs' {
  const mine = attempt(() => (id === 'json' ? impl.stringify(make()) : shape(impl.clone(make()))));
  const real = attempt(() => (id === 'json' ? JSON.stringify(make()) : shape(structuredClone(make()))));
  if (mine.ok !== real.ok) return 'differs';
  if (!mine.ok && !real.ok) return errorName(mine.error) === errorName(real.error) ? 'same' : 'differs';
  return (mine as { value: unknown }).value === (real as { value: unknown }).value ? 'same' : 'differs';
}
