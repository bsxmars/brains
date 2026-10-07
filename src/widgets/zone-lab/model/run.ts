import type { LoopApi, MiniApi, MiniRun, MiniView, ScenarioId, ViewName, ZoneMode } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `ZONE_CODE`, `SCHEDULER_CODE`
 * и `TREE_CODE` из темы «Angular без zone.js».
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. Вокруг них — стенд: модель
 * цикла событий (очередь задач, очередь микрозадач, слушатели) и то же приложение из четырёх
 * компонентов, что в `ANGULAR_APP_CODE` темы. `tests/unit/angular-zoneless.test.ts` гоняет
 * `runScenario` на всех сценариях в четырёх конфигурациях и сверяет число тиков, запуски
 * шаблонов и текст на экране с настоящим Angular 21.2 в Chromium.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadMini(zoneCode: string, schedulerCode: string, treeCode: string): MiniApi {
  return new Function(
    `${zoneCode}\n${schedulerCode}\n${treeCode}\nreturn { createZone, createScheduler, createView, markDirty, markSignal, check };`,
  )() as MiniApi;
}

/**
 * Цикл событий в миниатюре: задачи по времени и порядку постановки, после каждой — все
 * микрозадачи. Время условное: `setTimeout(fn, 10)` просто встаёт позже `setTimeout(fn, 0)`.
 */
function createLoop() {
  let now = 0;
  let seq = 0;
  const macro: { fn: () => void; at: number; seq: number }[] = [];
  const micro: (() => void)[] = [];
  const listeners: { target: string; type: string; fn: () => void }[] = [];

  const api: LoopApi = {
    setTimeout: (fn, ms = 0) => {
      macro.push({ fn, at: now + ms, seq: seq++ });
    },
    queueMicrotask: (fn) => {
      micro.push(fn);
    },
    addEventListener: (target, type, fn) => {
      listeners.push({ target, type, fn });
    },
  };

  const drainMicro = () => {
    while (micro.length) micro.shift()!();
  };

  return {
    api,
    /** Событие от «браузера»: отдельная задача, которая зовёт всех слушателей цели. */
    fire(target: string, type: string) {
      macro.push({
        fn: () => {
          for (const l of listeners) if (l.target === target && l.type === type) l.fn();
        },
        at: now,
        seq: seq++,
      });
    },
    run() {
      drainMicro();
      while (macro.length) {
        macro.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const task = macro.shift()!;
        now = Math.max(now, task.at);
        task.fn();
        drainMicro();
      }
    },
  };
}

/**
 * Приложение сквозного примера на мини-версии. Компоненты, поля и сигналы — как в
 * `ANGULAR_APP_CODE`: Counter (сигнал `count`, кнопка `+`), Clock (поле `label`, сигнал
 * `status`, две кнопки с `await`, слушатель `mousemove` на документе), List (сигнал `items`)
 * и корень App.
 */
function createApp(mini: MiniApi, mode: ZoneMode, onPush: boolean) {
  const loop = createLoop();
  const api = loop.api;
  const state = { count: 0, items: 3, label: 'старое', status: 'ждём' };
  const screen = { count: '', label: '', status: '' };
  const log: ViewName[][] = [];

  const app: MiniView = mini.createView('App', () => {}, { onPush });
  const counter = mini.createView('Counter', () => (screen.count = String(state.count)), { onPush, parent: app });
  const clock = mini.createView(
    'Clock',
    () => {
      screen.label = state.label;
      screen.status = state.status;
    },
    { onPush, parent: app },
  );
  const list = mini.createView('List', () => {}, { onPush, parent: app });

  // С зоной корень проверяется глобально, без зоны — точечно.
  const tick = () => {
    const names: ViewName[] = [];
    mini.check(app, mode === 'zone', names);
    log.push(names);
  };

  let native: LoopApi = api;
  const zone = mode === 'zone' ? mini.createZone(tick) : null;
  if (zone) native = zone.patch(api);

  // Планировщик есть и при зоне: Angular держит его ради сигналов, записанных вне зоны.
  // Внутри зоны он молчит — тик и так придёт, когда зона станет стабильной.
  const notifyScheduler = mini.createScheduler(tick, (fn) => native.setTimeout(fn, 0));
  const notify = () => {
    if (!zone?.inside()) notifyScheduler();
  };

  /** Сигнал, который читает шаблон `owner`: запись помечает вид и заказывает тик. */
  const signal = <K extends 'count' | 'items' | 'status'>(key: K, owner: MiniView) => ({
    get: () => state[key],
    set: (v: (typeof state)[K]) => {
      if (Object.is(v, state[key])) return;
      state[key] = v;
      mini.markSignal(owner);
      notify();
    },
  });
  const count = signal('count', counter);
  const items = signal('items', list);
  const status = signal('status', clock);

  /** Обработчик из шаблона, `(click)="…"`: помечает свой вид и предков, заказывает тик. */
  const listen = (view: MiniView, target: string, fn: () => void) =>
    api.addEventListener(target, 'click', () => {
      mini.markDirty(view);
      fn();
      notify();
    });

  const markForCheck = (view: MiniView) => {
    mini.markDirty(view);
    notify();
  };

  const boot = () => {
    listen(counter, 'inc', () => count.set(count.get() + 1));
    // await: продолжение после паузы ставит в очередь сам движок — мимо подменённых API.
    listen(clock, 'load', () => api.setTimeout(() => native.queueMicrotask(() => (state.label = 'загружено')), 10));
    // Тот же await, переписанный сборкой в генератор: продолжение идёт через Promise.then.
    listen(clock, 'load-lowered', () => api.setTimeout(() => api.queueMicrotask(() => (state.label = 'загружено')), 10));
    listen(clock, 'load2', () => api.setTimeout(() => native.queueMicrotask(() => status.set('загружено')), 10));
    api.addEventListener('document', 'mousemove', () => {});
    for (const v of [app, counter, clock, list]) v.render(); // создание: рисуются все
  };
  if (zone) zone.run(boot);
  else boot();
  loop.run();

  /**
   * Код приложения, запущенный изнутри Angular (`ngZone.run`). Выход из `run` сам по себе
   * даёт тик — стенд его не считает ни здесь, ни у Angular: счётчики обнуляются сразу после.
   */
  const start = (fn: () => void) => {
    if (!zone) return fn();
    zone.run(fn);
    log.length = 0;
    zone.stats.tasks = 0;
  };

  const scenarios: Record<ScenarioId, () => void> = {
    click: () => loop.fire('inc', 'click'),
    timerNoop: () => start(() => api.setTimeout(() => {}, 0)),
    timerField: () => start(() => api.setTimeout(() => (state.label = 'новое'), 0)),
    threeSignals: () =>
      start(() =>
        api.setTimeout(() => {
          count.set(1);
          count.set(2);
          items.set(1);
        }, 0),
      ),
    microtask: () => start(() => api.queueMicrotask(() => {})),
    mousemove: () => {
      for (let i = 0; i < 10; i++) loop.fire('document', 'mousemove');
    },
    markForCheck: () =>
      start(() =>
        api.setTimeout(() => {
          state.label = 'отмечено';
          markForCheck(clock);
        }, 0),
      ),
    awaitField: () => loop.fire('load', 'click'),
    awaitFieldLowered: () => loop.fire('load-lowered', 'click'),
    awaitSignal: () => loop.fire('load2', 'click'),
  };

  return { loop, log, zone, state, screen, scenarios };
}

/** Свежее приложение, один сценарий, полный прогон очередей. */
export function runScenario(mini: MiniApi, id: ScenarioId, mode: ZoneMode, onPush: boolean): MiniRun {
  const a = createApp(mini, mode, onPush);
  a.log.length = 0;
  if (a.zone) a.zone.stats.tasks = 0;
  a.scenarios[id]();
  a.loop.run();

  const hits: Record<ViewName, number> = { App: 0, Counter: 0, Clock: 0, List: 0 };
  for (const t of a.log) for (const n of t) hits[n]++;
  return {
    ticks: a.log.length,
    hits,
    label: a.screen.label,
    status: a.screen.status,
    count: a.screen.count,
    log: a.log.map((t) => [...t]),
    zoneTasks: a.zone ? a.zone.stats.tasks : null,
    state: { label: a.state.label, status: a.state.status, count: String(a.state.count) },
  };
}
