import type { HooksApi, MiniHooks } from './types';

/**
 * Сборка мини-реализации хуков из строки — той самой, что напечатана в теме.
 *
 * Приём тот же, что в `widgets/mini-fiber/model/build.ts`: код темы исполняется как тело
 * функции с параметром `host`, к нему дописан только **хвост наблюдения** — что вернуть наружу
 * и как подписаться на вход в несколько внутренних функций. Логики в хвосте нет: обёртка зовёт
 * исходную функцию и больше ничего. Импортировать тот файл нельзя — виджет не импортирует
 * виджет, — а хвост здесь другой: у этой реализации другие внутренние функции.
 *
 * Хоста в смысле DOM здесь нет вовсе: тема про хуки, и «экран» — это разметка, прочитанная
 * из текущего дерева файберов после коммита (`./screen.ts`). От хоста реализации нужно
 * только планирование: микрозадача, задача и вопрос «пора ли отдать поток».
 */
const HARNESS = `
return {
  h: createElement, createElement, render, memo, createContext, startTransition,
  useState, useReducer, useRef, useMemo, useCallback, useContext, useEffect, useSyncExternalStore,
  inspect: () => ({ root, wipRoot, nextUnitOfWork, renderLanes, pendingPassive }),
  instrument(enter, leave) {
    const wrap = (name, fn) => {
      const wrapped = function (...args) {
        enter(name, args);
        let result;
        try { result = fn(...args); return result; } finally { leave(name, args, result); }
      };
      Object.defineProperty(wrapped, 'name', { value: name });
      return wrapped;
    };
    beginWork = wrap('beginWork', beginWork);
    bailout = wrap('bailout', bailout);
    renderWithHooks = wrap('renderWithHooks', renderWithHooks);
    propagateContextChange = wrap('propagateContextChange', propagateContextChange);
    prepareFreshStack = wrap('prepareFreshStack', prepareFreshStack);
    commitRoot = wrap('commitRoot', commitRoot);
    flushPassiveEffects = wrap('flushPassiveEffects', flushPassiveEffects);
  },
};`;

/** Всё, что реализация требует от окружения: только планирование. */
export interface HooksHost {
  scheduleMicrotask(callback: () => void): void;
  scheduleTask(callback: () => void): void;
  shouldYield(): boolean;
}

export function buildMiniHooks(code: string, host: HooksHost): MiniHooks {
  return new Function('host', `"use strict";\n${code}\n${HARNESS}`)(host) as MiniHooks;
}

/** Имена, которые видит код сценария, — в этом порядке у обеих сторон. */
const SCENARIO_NAMES = [
  'h',
  'useState',
  'useReducer',
  'useRef',
  'useMemo',
  'useCallback',
  'useContext',
  'useEffect',
  'useSyncExternalStore',
  'memo',
  'createContext',
  'startTransition',
] as const;

/**
 * Код сценария — исходник компонентов, исполняемый как есть: у мини-версии с её хуками,
 * в тесте — с хуками настоящего React. Один исходник на обе стороны: иначе сравнивались бы
 * две разные программы.
 *
 * `log` — вывод компонента, `expose` — ручка наружу для кнопки демо и для теста.
 */
export function loadScenario(
  code: string,
  api: HooksApi,
  log: (line: string) => void,
  expose: (name: string, fn: () => void) => void,
): (props: Record<string, unknown>) => unknown {
  const factory = new Function(...SCENARIO_NAMES, 'log', 'expose', `"use strict";\n${code}\nreturn App;`);
  return factory(...SCENARIO_NAMES.map((name) => api[name]), log, expose);
}
