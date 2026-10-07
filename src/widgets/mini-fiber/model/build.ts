import type { MiniReact, ScenarioApi } from './types';

/**
 * Сборка мини-рендерера из строки — той самой, что напечатана в теме.
 *
 * `AGENTS.md`: «Код примера живёт строкой в `data.ts` и исполняется тестом — именно он,
 * а не копия». Здесь этот приём доведён до конца: строку `MINI_REACT_CODE` исполняют и юнит-тест,
 * и демо, и обе стороны получают её через эту функцию. Строка приходит параметром, а не
 * импортом: виджет не знает, в какой теме он стоит, а тема передаёт код пропом.
 *
 * Код темы написан как тело функции с параметром `host` — это и есть host config. К нему
 * дописан только **хвост наблюдения**: что вернуть наружу и как подписаться на вход в четыре
 * внутренние функции. Логики в хвосте нет — обёртка вызывает исходную функцию и больше ничего.
 * Переприсвоить объявление функции изнутри той же области можно и в строгом режиме: вызовы
 * внутри рендерера идут по имени и подхватывают обёртку.
 *
 * Строгий режим включён намеренно: React и любой модуль исполняются в нём, и случайная
 * глобальная переменная в коде темы должна стать ошибкой, а не тихой утечкой.
 */
const HARNESS = `
return {
  createElement, render, useState, useEffect, useLayoutEffect,
  inspect: () => ({ currentRoot, wipRoot, nextUnitOfWork, deletions, pendingPassive }),
  instrument(enter, leave) {
    const wrap = (name, fn) => {
      const wrapped = function (arg) {
        enter(name, arg);
        try { return fn(arg); } finally { leave(name); }
      };
      Object.defineProperty(wrapped, 'name', { value: name });
      return wrapped;
    };
    performWork = wrap('performWork', performWork);
    performUnitOfWork = wrap('performUnitOfWork', performUnitOfWork);
    commitRoot = wrap('commitRoot', commitRoot);
    flushPassiveEffects = wrap('flushPassiveEffects', flushPassiveEffects);
  },
};`;

/** Минимум, который рендерер требует от хоста: операции над узлами и планирование. */
export interface HostConfig {
  createInstance(type: string, props: Record<string, unknown>): unknown;
  createTextInstance(text: string): unknown;
  appendInitialChild(parent: unknown, child: unknown): void;
  appendChild(parent: unknown, child: unknown): void;
  insertBefore(parent: unknown, child: unknown, before: unknown): void;
  removeChild(parent: unknown, child: unknown): void;
  commitUpdate(node: unknown, type: string, prev: Record<string, unknown>, next: Record<string, unknown>): void;
  commitTextUpdate(node: unknown, prev: string, next: string): void;
  scheduleMicrotask(callback: () => void): void;
  scheduleTask(callback: () => void): void;
  shouldYield(): boolean;
}

export function buildMiniReact(code: string, host: HostConfig): MiniReact {
  return new Function('host', `"use strict";\n${code}\n${HARNESS}`)(host) as MiniReact;
}

/**
 * Код сценария — исходник компонентов, который исполняется как есть: у мини-версии
 * со своими `h` и хуками, в тесте — с `React.createElement` и хуками настоящего React.
 * Один исходник на обе стороны: иначе сравнивались бы две разные программы.
 *
 * `log` — вывод компонента, `expose` — ручка наружу для кнопки демо и для теста:
 * так «нажать» можно без событий DOM, которых у хоста мини-версии нет.
 */
export function loadScenario(
  code: string,
  api: ScenarioApi,
  log: (line: string) => void,
  expose: (name: string, fn: () => void) => void,
): (props: Record<string, unknown>) => unknown {
  const factory = new Function(
    'h',
    'useState',
    'useEffect',
    'useLayoutEffect',
    'log',
    'expose',
    `"use strict";\n${code}\nreturn App;`,
  );
  return factory(api.h, api.useState, api.useEffect, api.useLayoutEffect, log, expose);
}
