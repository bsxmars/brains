import type { AbortImpl, AbortScenario } from './types';

/**
 * Демо и тест исполняют одни и те же строки темы: `MINI_CODE` (учебные классы),
 * `TRACK_CODE` (счётчик слушателей) и код сценариев. Копий нет — строки собираются
 * `new Function`. Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Учебные классы из строки `MINI_CODE`. */
export function loadMini(miniCode: string): AbortImpl {
  return new Function(
    `${miniCode}\nreturn { AbortController: MiniAbortController, AbortSignal: MiniAbortSignal };`,
  )() as AbortImpl;
}

/** Настоящие классы среды: браузера в демо, Node в тесте. */
export function nativeImpl(): AbortImpl {
  return { AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal };
}

type Track = (signal: unknown) => { live: number };

export function loadTrack(trackCode: string): Track {
  return new Function(`${trackCode}\nreturn track;`)() as Track;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<void>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Исполнить сценарий на паре классов и вернуть вывод `log`. Брошенное наружу тоже попадает
 * в вывод строкой — чтобы расхождение было видно, а не роняло демо.
 */
export async function runScenario(sc: AbortScenario, impl: AbortImpl, trackCode: string): Promise<string[]> {
  const out: string[] = [];
  const log = (s: string) => out.push(String(s));
  const fn = new AsyncFunction('AbortController', 'AbortSignal', 'log', 'sleep', 'track', sc.code);
  try {
    await fn(impl.AbortController, impl.AbortSignal, log, sleep, loadTrack(trackCode));
  } catch (e) {
    out.push(`брошено: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
  // Дать досказать слушателям, которые сработали на последней строке.
  await sleep(0);
  return out;
}

export interface ScenarioRun {
  mini: string[];
  native: string[];
  same: boolean;
}

/** Сценарий дважды — на учебных и на настоящих классах — и вердикт, совпало ли. */
export async function compareScenario(sc: AbortScenario, miniCode: string, trackCode: string): Promise<ScenarioRun> {
  const mini = await runScenario(sc, loadMini(miniCode), trackCode);
  const native = await runScenario(sc, nativeImpl(), trackCode);
  return { mini, native, same: mini.join('\n') === native.join('\n') };
}
