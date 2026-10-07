import type { LanesScenarioApi, MiniLanes } from './types';

/**
 * Сборка мини-реализации из строки — той самой, что напечатана в теме.
 *
 * Приём тот же, что у `widgets/mini-fiber/model/build.ts`: строку `MINI_LANES_CODE` исполняют
 * и юнит-тест, и демо, обе стороны через эту функцию. Код темы — тело функции с параметром
 * `host`; к нему дописан только **хвост наблюдения**: что вернуть наружу и как подписаться
 * на вход в внутренние функции. Логики в хвосте нет — обёртка зовёт исходную функцию.
 * Переприсвоить объявление функции изнутри той же области можно и в строгом режиме:
 * вызовы внутри идут по имени и подхватывают обёртку, а `host.postTask(flushWork)` передаёт
 * уже обёрнутую функцию.
 */
const HARNESS = `
return {
  createElement, render, useState, useTransition, useDeferredValue, startTransition,
  discreteUpdates, Suspense,
  h: createElement,
  lanes: { SyncLane, InputContinuousLane, DefaultLane, TransitionLane, RetryLane },
  inspect: () => ({ root, wipRoot, wipRootLanes, workInProgress, taskQueue }),
  instrument(enter, leave) {
    const wrap = (name, fn) => {
      const wrapped = function (...args) {
        enter(name, args);
        let result;
        try { result = fn(...args); return result; } finally { leave(name, result); }
      };
      Object.defineProperty(wrapped, 'name', { value: name });
      return wrapped;
    };
    performUnitOfWork = wrap('performUnitOfWork', performUnitOfWork);
    renderRoot = wrap('renderRoot', renderRoot);
    prepareFreshStack = wrap('prepareFreshStack', prepareFreshStack);
    commitRoot = wrap('commitRoot', commitRoot);
    throwException = wrap('throwException', throwException);
    pingRoot = wrap('pingRoot', pingRoot);
    flushWork = wrap('flushWork', flushWork);
    performSyncWork = wrap('performSyncWork', performSyncWork);
    performConcurrentWork = wrap('performConcurrentWork', performConcurrentWork);
    scheduleCallback = wrap('scheduleCallback', scheduleCallback);
  },
};`;

/** Минимум, который мини-реализация требует от хоста: часы, две очереди и «экран». */
export interface LanesHostConfig {
  now(): number;
  postTask(callback: () => void): void;
  scheduleMicrotask(callback: () => void): void;
  commit(markup: string): void;
}

export function buildMiniLanes(code: string, host: LanesHostConfig): MiniLanes {
  return new Function('host', `"use strict";\n${code}\n${HARNESS}`)(host) as MiniLanes;
}

/**
 * Код сценария исполняется как есть: у мини-версии — с её хуками, в тесте — с хуками
 * настоящего React. `log` — вывод компонента, `work(ms)` — «тяжёлая работа» на виртуальных
 * часах, `expose` — ручка наружу для кнопки демо и для теста.
 */
export function loadScenario(
  code: string,
  api: LanesScenarioApi,
  log: (line: string) => void,
  work: (ms: number) => void,
  expose: (name: string, fn: () => void) => void,
): (props: Record<string, unknown>) => unknown {
  const factory = new Function(
    'h',
    'useState',
    'useTransition',
    'useDeferredValue',
    'startTransition',
    'Suspense',
    'log',
    'work',
    'expose',
    `"use strict";\n${code}\nreturn App;`,
  );
  return factory(
    api.h,
    api.useState,
    api.useTransition,
    api.useDeferredValue,
    api.startTransition,
    api.Suspense,
    log,
    work,
    expose,
  );
}
