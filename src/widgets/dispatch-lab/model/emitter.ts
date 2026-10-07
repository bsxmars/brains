/**
 * Эмиттер в стиле Node — и ровно настолько, насколько это модель.
 *
 * ⚠️ **Это не `node:events`.** Демо исполняется в браузере читателя, где модуля `events`
 * нет вовсе, а тащить его полифилл значило бы показывать чужую реализацию вместо настоящей.
 * Поэтому здесь тридцать строк, повторяющих **одно** решение Node — то самое, о котором
 * рассказывает тема:
 *
 *     for (const fn of [...list]) fn(...args);
 *                     ^^^^^^^^^ обход идёт по копии
 *
 * `EventEmitter#emit` в Node делает то же самое (`arrayClone` перед циклом), и отсюда следует
 * поведение, которое ловит людей: слушатель, снятый **во время** обхода, в этом обходе всё
 * равно вызовется — копия про снятие не знает. Настоящий Node копирует список только когда
 * слушателей больше одного: с единственным слушателем копировать нечего, и разницы не видно.
 *
 * Что отсюда следует для честности демо: самодельный эмиттер доказывает, что **так бывает**,
 * и объясняет механизм, но не доказывает, что так делает Node. Это доказывает юнит-тест,
 * который запускает настоящий `node:events` в Node. Подпись сценария говорит об этом прямо.
 *
 * DOM-половина модели не нужна: `EventTarget` в браузере настоящий, и демо зовёт именно его.
 */

type Handler = (...args: unknown[]) => void;

export interface MiniEmitter {
  on(name: string, fn: Handler): MiniEmitter;
  off(name: string, fn: Handler): MiniEmitter;
  /** `true`, если слушатели были. Как у Node. */
  emit(name: string, ...args: unknown[]): boolean;
  /** Сколько слушателей на событии сейчас — `emitter.listenerCount(name)` у Node. */
  count(name: string): number;
}

/**
 * Свежий эмиттер на каждый прогон.
 *
 * Фабрика, а не общий экземпляр, по той же причине, что свежий объект в `widgets/lock-lab`:
 * состояние подписок переживает прогон, и второй клик по тому же сценарию на одолженном
 * экземпляре дал бы другой ответ. Демо начало бы врать со второго раза.
 */
export function createEmitter(): MiniEmitter {
  const handlers = new Map<string, Handler[]>();

  const api: MiniEmitter = {
    on(name, fn) {
      const list = handlers.get(name);
      if (list) list.push(fn);
      else handlers.set(name, [fn]);
      return api;
    },

    /** Node ищет с конца и снимает последнее вхождение — повторяем и это. */
    off(name, fn) {
      const list = handlers.get(name);
      if (!list) return api;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i] === fn) {
          list.splice(i, 1);
          break;
        }
      }
      return api;
    },

    emit(name, ...args) {
      const list = handlers.get(name);
      if (!list || list.length === 0) return false;
      // Вся суть модели в одной квадратной скобке: обход идёт по копии, снятое во время
      // обхода до текущего круга не доедет.
      for (const fn of [...list]) fn(...args);
      return true;
    },

    count(name) {
      return handlers.get(name)?.length ?? 0;
    },
  };

  return api;
}
