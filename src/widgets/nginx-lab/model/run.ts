import type { LocationApi, ServerApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `LOCATION_CODE`, `PROXY_CODE`
 * и `SERVER_CODE` из темы «Nginx как обратный прокси».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/nginx-proxy.test.ts` по журналам стенда: на каждый адрес модель обязана назвать
 * ту же location, тот же путь у бэкенда и тот же редирект, что дал настоящий nginx 1.30.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadLocationApi(locationCode: string, proxyCode: string): LocationApi {
  return new Function(
    `${locationCode}\n${proxyCode}\nreturn { parseLocations, normalize, findLocation, proxyPath };`,
  )() as LocationApi;
}

export function loadServerApi(code: string): ServerApi {
  return new Function(`${code}\nreturn { parseServers, findServer };`)() as ServerApi;
}
