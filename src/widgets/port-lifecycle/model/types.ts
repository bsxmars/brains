/** Тон реплики: зелёная — так и задумано, янтарная — тут легко ошибиться, красная — молчит. */
export type PortTone = 'ok' | 'warn' | 'err';

/** Одна реплика песочницы. `{msg}` в тексте заменяется на имя последнего сообщения. */
export interface PortLine {
  text: string;
  tone?: PortTone;
}

/**
 * Все реплики песочницы порта.
 *
 * Ключ — действие, а не произвольная строка: забытую ветку («а что печатать, если порт уже
 * закрыт») ловит компилятор, а не читатель урока, наткнувшийся на пустую панель.
 */
export interface PortLines {
  /** Стартовое состояние: канал создан, очередь выключена. */
  initial: PortLine;
  postBuffered: PortLine;
  postEnabled: PortLine;
  postClosed: PortLine;
  listen: PortLine;
  listenClosed: PortLine;
  startOk: PortLine;
  startAgain: PortLine;
  startClosed: PortLine;
  transferOk: PortLine;
  transferAgain: PortLine;
  transferClosed: PortLine;
  detachedOk: PortLine;
  detachedIdle: PortLine;
  closeOk: PortLine;
  closeAgain: PortLine;
}

export type PortEvent = keyof PortLines;
