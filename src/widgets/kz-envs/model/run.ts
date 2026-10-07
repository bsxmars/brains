import type { Env, Model, Tool } from './types';

/**
 * Демо и тест спрашивают модель одним и тем же кодом — строками `MODEL_PARTS` из темы.
 *
 * `loadModel` склеивает их и собирает `new Function`: те же строки лежат в `data.ts`,
 * две из них напечатаны на странице, и те же исполняет `tests/unit/helm-gitops.test.ts`.
 * Копии нет — разойдётся модель с таблицами из документации, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadModel(parts: string[]): Model {
  return new Function(parts.join('\n'))() as Model;
}

/** Что написано для окружения: файлы слоя или файл values и команда. */
export function inputsOf(
  files: Record<string, string>,
  commands: Record<string, string>,
  env: Env,
  tool: Tool,
): { title: string; text: string }[] {
  if (tool === 'kustomize') {
    const dir = `overlays/${env}/`;
    return Object.keys(files)
      .filter((path) => path.startsWith(dir))
      .map((path) => ({ title: path, text: files[path] }));
  }
  return [
    { title: `values-${env}.yaml`, text: files[`values-${env}.yaml`] },
    { title: 'команда', text: commands[env] },
  ];
}
