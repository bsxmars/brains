import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Погасить фоновый сервер предпросмотра. Если его уже нет — и хорошо. */
export default async function globalTeardown() {
  try {
    await run('npx', ['astro', 'preview', 'stop']);
  } catch {
    /* сервер уже остановлен */
  }
}
