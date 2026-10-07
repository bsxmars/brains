import type { RunTx, SimulateTransaction } from './types';

/**
 * Демо и тест спрашивают одни и те же строки темы «Хранилища браузера»: `TX_MODEL_CODE`
 * (модель жизни транзакции) и `TX_HARNESS_CODE` (обвязка, которая снимает журнал с настоящей
 * IndexedDB).
 *
 * Строки напечатаны на странице и собраны здесь `new Function`. `tests/unit/browser-storage.test.ts`
 * сверяет журнал модели с журналом `fake-indexeddb` (обвязка та же) и с журналами Chromium
 * со стенда. Копии нет: если показанная модель разойдётся с базой, покраснеет тест.
 *
 * Ни DOM, ни Vue: модуль импортирует юнит-тест.
 */
export function loadModel(modelCode: string): SimulateTransaction {
  return new Function(`${modelCode}\nreturn simulateTransaction;`)() as SimulateTransaction;
}

export function loadHarness(harnessCode: string): RunTx {
  return new Function(`${harnessCode}\nreturn runTx;`)() as RunTx;
}

/** Совпадают ли два журнала построчно. */
export function sameLog(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
