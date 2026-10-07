import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Собрать сайт и поднять сервер предпросмотра до тестов.
 *
 * Через `webServer` в конфиге это не работает: `astro preview` в Astro 7 уходит в фон сам
 * (`--background`, плюс команды `status` и `stop`), поэтому запустивший его процесс тут же
 * завершается, а Playwright считает, что сервер «упал на старте». Значит, запускаем демон
 * явно и сами же его гасим в teardown.
 *
 * Гоняется собранный сайт, а не дев-сервер: в проде отдаётся именно он.
 */
export const PORT = 4329;
const URL = `http://localhost:${PORT}/`;

async function alive(): Promise<boolean> {
  try {
    const response = await fetch(URL);
    return response.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  await run('npm', ['run', 'build']);

  // Демон отдаёт файлы из dist/ при каждом запросе, поэтому пересборка под уже запущенным
  // сервером безопасна — перезапускать его незачем.
  if (await alive()) return;

  await run('npx', ['astro', 'preview', '--background', '--port', String(PORT)]);

  for (let i = 0; i < 60; i++) {
    if (await alive()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`сервер предпросмотра не поднялся: ${URL}`);
}
