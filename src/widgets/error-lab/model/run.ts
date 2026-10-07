import type { CaseResult, ParseFn, SerializeFn } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `PARSE_CODE` и `SERIALIZE_CODE` из темы.
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/errors.test.ts`: разбор стека — против CallSite API V8 (`Error.prepareStackTrace`)
 * на живых стеках Node в отдельном процессе и против снятых литералов Node и Chromium;
 * сборка отчёта — против `structuredClone` и на циклах, `AggregateError`, не-ошибках.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadParse(code: string): ParseFn {
  return new Function(`${code}\nreturn parseStack;`)() as ParseFn;
}

export function loadSerialize(code: string): SerializeFn {
  return new Function(`${code}\nreturn serializeError;`)() as SerializeFn;
}

/**
 * Комментарий `sourceURL` даёт коду из `eval` имя файла: без него V8 печатает кадр как
 * `eval at runCase (…/run.ts:…), <anonymous>:5:11`, с ним — `case.js:5:11`. Разбит на две
 * части по той же причине, что `FIND_MAP_CODE` в «Source maps»: Vite ищет такие комментарии
 * по тексту модуля.
 */
const SOURCE_URL = '//' + '# sourceURL=';

/**
 * Исполняет код случая из темы и возвращает то, что вылетело. Обёртка стоит на одной строке
 * с началом кода, поэтому строка N кода — это строка N в стеке. Непрямой `eval` исполняет
 * код в глобальной области, а не в этом модуле: кадры из него — только кадры случая.
 */
export async function runCase(code: string, name = 'case.js'): Promise<CaseResult> {
  const src = `(async () => {${code}\n})()\n${SOURCE_URL}${name}`;
  try {
    const value: unknown = await (0, eval)(src);
    return { thrown: false, value };
  } catch (value) {
    return { thrown: true, value };
  }
}
