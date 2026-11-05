/**
 * Ожидание сервера предпросмотра. Файл без синтаксиса, которого нет в «стирании типов» Node:
 * его импортирует и Playwright (`tests/e2e/global-setup.ts`), и голый `node`
 * (`scripts/dev/shots.mjs`) — без загрузчика TypeScript.
 */

/** Сервер отвечает по адресу `2xx`. Отказ соединения — «ещё нет», а не ошибка. */
export async function isAlive(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Опрашивать `url`, пока сервер не ответит: `attempts` попыток через 500 мс — по умолчанию
 * 30 секунд. Не дождались — ошибка с текстом `message` и адресом.
 */
export async function waitForServer(url: string, { attempts = 60, message = 'сервер не поднялся' } = {}): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    if (await isAlive(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${message}: ${url}`);
}
