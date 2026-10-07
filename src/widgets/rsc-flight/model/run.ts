import type { CreateFromFlight, PageApi, PageFn, RenderToFlight } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки из `data.ts` темы.
 *
 * `FLIGHT_SERVER_CODE`, `FLIGHT_CLIENT_CODE` и `PAGE_CODE` напечатаны на странице, собраны здесь
 * `new Function` и прогоняются `tests/unit/server-components.test.ts` против настоящего
 * `react-server-dom-webpack` 19.3.0 на всех 48 сочетаниях переключателей. Копии нет: если
 * напечатанный код разойдётся с React, покраснеет тест.
 *
 * Ни DOM, ни Vue — чистые функции, чтобы их мог импортировать юнит-тест.
 */

export const ELEMENT = Symbol.for('react.transitional.element');
export const SUSPENSE = Symbol.for('react.suspense');
export const CLIENT_REF = Symbol.for('react.client.reference');
export const SERVER_REF = Symbol.for('react.server.reference');
/** Та же метка, что ставит `createFromFlight` из `FLIGHT_CLIENT_CODE` на недошедшее. */
export const HOLE = Symbol.for('учебный.flight.дыра');

export function loadServer(code: string): RenderToFlight {
  return new Function(`${code}\nreturn renderToFlight;`)() as RenderToFlight;
}

export function loadClient(code: string): CreateFromFlight {
  return new Function(`${code}\nreturn createFromFlight;`)() as CreateFromFlight;
}

export function loadPage(code: string): PageFn {
  return new Function(`${code}\nreturn page;`)() as PageFn;
}

/**
 * `createElement` в том виде, в каком его видит сериализатор: `$$typeof`, `type`, `key`, `props`.
 * Ключ уходит из пропсов и становится строкой, один ребёнок кладётся как есть, несколько — массивом.
 * Тест сверяет, что поток из этих элементов байт в байт равен потоку из элементов настоящего React.
 */
export function h(type: unknown, config?: Record<string, unknown> | null, ...children: unknown[]) {
  const props: Record<string, unknown> = {};
  let key: string | null = null;
  for (const [k, v] of Object.entries(config ?? {})) {
    if (k === 'key') key = String(v);
    else props[k] = v;
  }
  if (children.length === 1) props.children = children[0];
  else if (children.length > 1) props.children = children;
  return { $$typeof: ELEMENT, type, key, props };
}

/** Ссылка на клиентский компонент — то, во что сборщик превращает экспорт модуля с `'use client'`. */
export function client(moduleId: string, name: string) {
  const ref = () => {
    throw new Error('Клиентский компонент на сервере не вызывают');
  };
  return Object.assign(ref, { $$typeof: CLIENT_REF, $$id: `${moduleId}#${name}` });
}

/** Ссылка на серверную функцию — экспорт модуля с `'use server'`. */
export function action(moduleId: string, name: string) {
  const fn = async () => undefined;
  return Object.assign(fn, { $$typeof: SERVER_REF, $$id: `${moduleId}#${name}`, $$bound: null });
}

/** «База» демо: каждый запрос отвечает своим значением через свою задержку. */
export function makeQuery(data: Record<string, unknown>, delays: Record<string, number>) {
  return (name: string) =>
    new Promise<unknown>((resolve) => setTimeout(() => resolve(data[name]), delays[name] ?? 0));
}

export function pageApi(query: PageApi['query']): PageApi {
  return { h, Suspense: SUSPENSE, client, action, query };
}
