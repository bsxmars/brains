import type { LogEntry, SetSpec, SetState, StsSim } from './types';

/**
 * Демо и тест спрашивают модель контроллера одним и тем же кодом — строкой `SIM_CODE` из темы.
 *
 * `loadSim` собирает её `new Function`: та же строка напечатана в теме, та же исполняется
 * здесь и в `tests/unit/statefulset.test.ts`. Копии нет — если описание порядка в тексте
 * разойдётся с таблицей случаев из документации, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSim(code: string): StsSim {
  return new Function(code)() as StsSim;
}

/** Предел проходов для `run`: модель обязана успокоиться намного раньше. */
const MAX_PASSES = 60;

/** Короткая запись действия для таблицы случаев. Записи о PVC сюда не попадают — у них своя таблица. */
function token(set: Pick<SetState, 'name'>, e: LogEntry): string | null {
  const pod = `${set.name}-${e.ord}`;
  switch (e.kind) {
    case 'create':
      return `создать ${pod} (v${e.rev})`;
    case 'wait':
      return `ждать ${pod}`;
    case 'delete':
      return `удалить ${pod}`;
    case 'update':
      return `заменить ${pod}`;
    case 'gone':
      return `${pod} завершился`;
    case 'kill':
      return `${pod} упал`;
    case 'ready':
      return `${pod} готов`;
    case 'done':
      return 'выкат закончен';
    default:
      return null;
  }
}

export interface Played {
  set: SetState;
  /** Проходы: внутри прохода — действия через запятую. Пустые проходы выброшены. */
  passes: string[][];
  /** То же одной строкой: проходы через « → ». Так она и стоит в таблице на странице. */
  trace: string;
}

/**
 * Прогон сценария. Команды:
 *
 *   `scale N`, `image`, `partition N`, `remove` — правка объекта (как `kubectl apply`);
 *   `step` — один проход контроллера (сначала kubelet доводит завершение подов);
 *   `ready N` — под N прошёл readiness-пробу; `kill N` — под N удалили или потеряли вместе с узлом;
 *   `run` — проходы, пока есть что делать, причём после каждого новые поды сразу становятся
 *   Ready: так выглядит кластер, где никто не падает.
 */
export function play(sim: StsSim, spec: SetSpec | SetState, script: string[]): Played {
  let set: SetState = 'pods' in spec ? spec : sim.create(spec);
  const passes: string[][] = [];
  const push = (log: LogEntry[]) => {
    const tokens = log.map((e) => token(set, e)).filter((x): x is string => x !== null);
    if (tokens.length) passes.push(tokens);
  };

  for (const line of script) {
    const [cmd, arg] = line.split(' ');
    const n = Number(arg);
    if (cmd === 'scale') set = sim.scale(set, n);
    else if (cmd === 'image') set = sim.updateImage(set);
    else if (cmd === 'partition') set = sim.setPartition(set, n);
    else if (cmd === 'remove') set = sim.remove(set);
    else if (cmd === 'step' || cmd === 'ready' || cmd === 'kill') {
      const r = cmd === 'step' ? sim.step(set) : cmd === 'ready' ? sim.ready(set, n) : sim.kill(set, n);
      set = r.set;
      push(r.log);
    } else if (cmd === 'run') {
      for (let i = 0; ; i++) {
        if (i === MAX_PASSES) throw new Error('модель не успокоилась за ' + MAX_PASSES + ' проходов');
        const r = sim.step(set);
        set = r.set;
        if (r.log.every((e) => e.kind === 'idle')) break;
        push(r.log);
        for (const p of set.pods) if (!p.ready && !p.terminating) set = sim.ready(set, p.ord).set;
      }
    } else {
      throw new Error(`неизвестная команда сценария: ${line}`);
    }
  }

  return { set, passes, trace: passes.map((p) => p.join(', ')).join(' → ') };
}

/** Набор в установившемся состоянии: все реплики созданы и готовы. С него начинает демо. */
export function settled(sim: StsSim, spec: SetSpec): SetState {
  return play(sim, spec, ['run']).set;
}
