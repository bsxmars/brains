import { API_NAMES, apiArgs, settle } from './load';
import type { MiniRef, RaceFrame, RaceRequest, RaceStep, WatchApi } from './types';

/**
 * Гонка ответов в `watch`: код из темы плюс «виртуальный сервер», который отвечает тогда,
 * когда ему скажут, а не по таймеру.
 *
 * Ответ приходит по шагу демо, поэтому порядок ответов задан сценарием, а не случаем, — и
 * тест воспроизводит его в точности. Таймеров нет вовсе: сервер — это список промисов, которые
 * модель разрешает сама.
 *
 * Исполняется против любой реализации с публичными именами Vue: демо подставляет мини-версию,
 * тест — ещё и `@vue/runtime-core` в обеих сборках.
 */
export async function runRace(api: WatchApi, code: string, steps: readonly RaceStep[]): Promise<RaceFrame[]> {
  const log: string[] = [];
  const requests: (RaceRequest & { answer: () => void })[] = [];

  const search = (query: string) =>
    new Promise<string>((resolve) => {
      const request = {
        id: requests.length + 1,
        query,
        state: 'waiting' as RaceRequest['state'],
        answer: () => {
          request.state = 'answered';
          resolve(`результаты по «${query}»`);
        },
      };
      requests.push(request);
    });

  const factory = new Function(...API_NAMES, 'search', 'log', `${code}\nreturn { query, shown }`);
  const { query, shown } = factory(...apiArgs(api), search, (text: string) => log.push(text)) as {
    query: MiniRef<string>;
    shown: MiniRef<string>;
  };

  const frames: RaceFrame[] = [];
  for (const step of steps) {
    const act = step.act;
    if (act.kind === 'write') query.value = act.value;
    else if (act.kind === 'answer') requests[act.index]?.answer();
    await settle(api);
    frames.push({
      label: step.label,
      query: query.value,
      shown: shown.value,
      requests: requests.map(({ id, query: q, state }) => ({ id, query: q, state })),
      log: [...log],
    });
  }
  return frames;
}
