import type { Federation, MfApp, MfAppName, MfRemoteName, MfRun, MfState, MfWorld } from './types';

/**
 * Учебная федерация: компиляция **той же строки**, которую тема печатает по разделам
 * (`FEDERATION_CODE` в `content/tooling/module-federation/data.ts`).
 *
 * Строка приходит в остров пропом, а не импортом — виджет не знает, в какой теме живёт.
 * Демо, текст и тест исполняют один код: `tests/unit/module-federation.test.ts` компилирует
 * её здесь же и сверяет semver с пакетом `semver`, а таблицу выбора версии — с прогоном.
 *
 * Модуль чистый: ни DOM, ни Vue. `new Function` законен — код авторский и лежит рядом с темой.
 */
export function compileFederation(code: string): Federation {
  const make = new Function(
    `${code}\n;return { satisfies, compare, register, consume, bundleLibrary, runHost, fakeNetwork };`,
  );
  return make() as Federation;
}

export const REMOTES: MfRemoteName[] = ['catalog', 'cart'];

/** Сборки демо из состояния переключателей. `requiredVersion` — `^` от своей версии. */
export function buildApps(state: MfState, pkg = 'react'): { host: MfApp; remotes: MfApp[] } {
  const strictVersion = state.strict === 'auto' ? undefined : state.strict === 'on';
  const app = (name: MfAppName, eager: boolean): MfApp => ({
    name,
    pkg,
    url: `https://${name}.example.com/remoteEntry.js`,
    status: name === 'host' ? 'up' : state.status[name],
    lib: {
      version: state.versions[name],
      requiredVersion: `^${state.versions[name]}`,
      singleton: state.singleton,
      ...(strictVersion === undefined ? {} : { strictVersion }),
      eager,
    },
  });
  return { host: app('host', state.eager), remotes: REMOTES.map((name) => app(name, false)) };
}

/** Один прогон демо: сборки из состояния, сеть стенда, host. */
export async function simulate(
  fed: Federation,
  state: MfState,
  timeoutMs: number,
): Promise<{ world: MfWorld; run: MfRun }> {
  const world: MfWorld = { copies: [], log: [] };
  const { host, remotes } = buildApps(state);
  const run = await fed.runHost(world, host, remotes, fed.fakeNetwork(world), timeoutMs);
  return { world, run };
}
