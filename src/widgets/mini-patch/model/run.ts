import type {
  DemoStep,
  HostEntry,
  KeyedRun,
  MiniPatch,
  NewCell,
  OldCell,
  ReactivityDeps,
  RendererApi,
  TraceEvent,
} from './types';

/**
 * Демо и тест спрашивают рендерер одним и тем же кодом — этим модулем.
 *
 * `loadMiniPatch` собирает мини-рендерер из строки `MINI_PATCH_CODE`: той, что напечатана
 * в теме по шагам. Копии нет — если текст на странице разойдётся с поведением, покраснеет
 * `tests/unit/vue-patch-internals.test.ts`, который берёт ту же строку.
 *
 * `runKeyed` прогоняет пару списков через **любой** рендерер с именами Vue: демо подставляет
 * мини-версию, тест — ещё и `@vue/runtime-core`. Хост у обоих один и тот же — журналирующий
 * `createLogHost` из той же строки, — поэтому сравниваются не пересказы, а операции.
 *
 * Ни DOM, ни Vue-компонентов: чистые функции, чтобы их мог импортировать юнит-тест.
 */

/** Свежий экземпляр мини-рендерера. Реактивность для компонентов — настоящая, из Vue. */
export function loadMiniPatch(code: string, deps: ReactivityDeps): MiniPatch {
  return new Function('effect', 'shallowReactive', code)(deps.effect, deps.shallowReactive) as MiniPatch;
}

/** Список `ul > li` с ключами — один и тот же для мини-версии и для Vue. */
export function keyedList(api: RendererApi, keys: string[]) {
  return api.h(
    'ul',
    null,
    keys.map((k) => api.h('li', { key: k }, k)),
  );
}

/**
 * Правило `lastPlacedIndex` из React: идём по новому списку, и узел, стоявший в старом
 * левее последнего оставленного на месте, переставляется. Не рендерер React, а его правило
 * на тех же ключах — само правило разобрано и проверено в теме «React изнутри».
 */
export function reactRuleMoves(from: string[], to: string[]): number {
  const oldIndex = new Map(from.map((k, i) => [k, i]));
  let lastPlaced = 0;
  let moves = 0;
  for (const key of to) {
    const i = oldIndex.get(key);
    if (i === undefined) continue; // новый узел — вставка, не перемещение
    if (i < lastPlaced) moves++;
    else lastPlaced = i;
  }
  return moves;
}

/** Детерминированная перетасовка: номер → порядок. Случайность без `Math.random`, воспроизводимая. */
export function shuffleKeys(keys: string[], seed: number): string[] {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
  const out = [...keys];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/**
 * Прогнать обновление `from → to` и разложить его на кадры.
 *
 * Кадр — одно событие окна `trace` внутри `patchKeyedChildren` плюс операции хоста, которые
 * случились до него. Ни одно поле кадра не вычислено здесь заново: указатели, массив
 * `newIndexToOldIndex` и LIS приходят из самого алгоритма, порядок узлов — из хоста.
 */
export function runKeyed(api: RendererApi & Pick<MiniPatch, 'createLogHost'>, from: string[], to: string[]): KeyedRun {
  const host = api.createLogHost();
  const events: { ev: TraceEvent; logAt: number; order: string[] }[] = [];
  const ul = () => host.root.children[0];
  const order = () => (ul() ? ul().children.map((c) => c.text) : []);

  const trace = (phase: TraceEvent['phase'], data: TraceEvent['data']) => {
    events.push({ ev: { phase, data } as TraceEvent, logAt: host.log.length, order: order() });
  };
  const { render } = api.createRenderer({ ...host.nodeOps, trace: trace as never });

  render(keyedList(api, from), host.root);
  const mountLen = host.log.length;
  events.length = 0;
  render(keyedList(api, to), host.root);

  const log: HostEntry[] = host.log.slice(mountLen);
  const moves = log.filter((e) => e.op === 'move').length;

  let i = 0;
  let e1 = from.length - 1;
  let e2 = to.length - 1;
  const old: OldCell[] = from.map(() => 'idle');
  const next: NewCell[] = to.map(() => 'idle');
  let map: number[] | null = null;
  let seq: number[] | null = null;
  let s = 0;
  let moved = false;
  let matched = 0;
  let movesSoFar = 0;
  let prevLog = mountLen;

  const steps: DemoStep[] = [
    {
      phase: 'start',
      message: `Было ${from.length}, станет ${to.length}. Указатели: i = 0, e1 = ${e1}, e2 = ${e2}.`,
      ops: [],
      order: from.slice(),
      i,
      e1,
      e2,
      old: old.slice(),
      next: next.slice(),
      map: null,
      s,
      seq: null,
      focus: null,
      moves: 0,
    },
  ];

  for (const { ev, logAt, order: after } of events) {
    const ops = host.log.slice(prevLog, logAt);
    prevLog = logAt;
    movesSoFar += ops.filter((o) => o.op === 'move').length;
    let message = '';
    let focus: DemoStep['focus'] = null;

    switch (ev.phase) {
      case 'head': {
        old[ev.data.i] = 'head';
        next[ev.data.i] = 'head';
        i = ev.data.i + 1;
        focus = { side: 'new', index: ev.data.i };
        message = `С начала: ${to[ev.data.i]} на том же месте — патч без перемещения. i = ${i}.`;
        break;
      }
      case 'tail': {
        old[ev.data.e1] = 'tail';
        next[ev.data.e2] = 'tail';
        e1 = ev.data.e1 - 1;
        e2 = ev.data.e2 - 1;
        focus = { side: 'new', index: ev.data.e2 };
        message = `С конца: ${to[ev.data.e2]} совпал — патч на месте. e1 = ${e1}, e2 = ${e2}.`;
        break;
      }
      case 'match': {
        old[ev.data.index] = 'kept';
        next[ev.data.newIndex] = 'pending';
        matched++;
        focus = { side: 'old', index: ev.data.index };
        message = `${from[ev.data.index]}: был на ${ev.data.index}, в новом на ${ev.data.newIndex} — найден по ключу, пропсы и дети сверены. Место решится позже.`;
        break;
      }
      case 'unmount': {
        old[ev.data.index] = 'removed';
        focus = { side: 'old', index: ev.data.index };
        message = `${from[ev.data.index]} в новом списке нет — удалён из хоста.`;
        break;
      }
      case 'lis': {
        map = ev.data.map;
        // нуль на позиции 0 getSequence оставляет в цепочке (причуда Vue, безвредная):
        // на экран идут только настоящие узлы цепочки
        seq = ev.data.seq.filter((p) => ev.data.map[p] !== 0);
        s = ev.data.s;
        moved = ev.data.moved;
        message = moved
          ? `newIndexToOldIndex = [${map.join(', ')}]. Порядок нарушен. В LIS: ${seq.map((p) => to[s + p]).join(', ')} — их не трогаем, остальных двигаем.`
          : `newIndexToOldIndex = [${map.join(', ')}]. Старые индексы только растут — двигать не придётся никого.`;
        break;
      }
      case 'mount': {
        next[ev.data.index] = 'mounted';
        focus = { side: 'new', index: ev.data.index };
        const right = to[ev.data.index + 1];
        message = `${to[ev.data.index]} новый — создан и вставлен ${right ? 'перед ' + right : 'в конец'}.`;
        break;
      }
      case 'move': {
        next[ev.data.index] = 'moved';
        focus = { side: 'new', index: ev.data.index };
        const right = to[ev.data.index + 1];
        message = `${to[ev.data.index]} не в LIS — перемещён ${right ? 'перед ' + right : 'в конец'}.`;
        break;
      }
      case 'stay': {
        next[ev.data.index] = 'stay';
        focus = { side: 'new', index: ev.data.index };
        message = `${to[ev.data.index]} в LIS — остаётся на месте, ни одной операции.`;
        break;
      }
    }

    steps.push({
      phase: ev.phase,
      message,
      ops,
      order: after,
      i,
      e1,
      e2,
      old: old.slice(),
      next: next.slice(),
      map,
      s,
      seq,
      focus,
      moves: movesSoFar,
    });
  }

  const movesWithoutLis = moved ? matched : 0;
  steps.push({
    phase: 'done',
    message: `Готово: ${moves} ${plural(moves, 'перемещение', 'перемещения', 'перемещений')} в хосте.`,
    ops: host.log.slice(prevLog),
    order: order(),
    i,
    e1,
    e2,
    old: old.slice(),
    next: next.map((c) => (c === 'idle' || c === 'pending' ? 'stay' : c)),
    map,
    s,
    seq,
    focus: null,
    moves,
  });

  return {
    steps,
    log: log.map((e) => e.text),
    html: host.html(),
    moves,
    movesWithoutLis,
    movesReactRule: reactRuleMoves(from, to),
  };
}
