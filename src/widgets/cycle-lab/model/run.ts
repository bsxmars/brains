import type { CycleRun, CycleVariant } from './types';

/**
 * Прогон кругового импорта настоящим `import()` — в браузере читателя, без песочниц и эмуляций.
 *
 * ⚠️ **Почему модули лежат отдельными файлами, а не собираются в `blob:`.** Blob-URL для цикла
 * не годится принципиально: адрес блоба появляется только после того, как блоб создан, а в цикле
 * адрес каждого модуля обязан стоять внутри другого — получается «курица и яйцо». Обойти это
 * можно было бы import map'ом, но он поддерживается не везде и должен стоять до первого модуля
 * документа. Поэтому пара цикла — четыре обычных файла в `public/demo/modules/`, и это честнее:
 * читатель может открыть их по адресу и увидеть ровно то, что исполнилось. Заодно это
 * показывает главное: **модуль — это URL**, а не текст.
 *
 * ⚠️ `@vite-ignore` обязателен. Без него сборка попытается разобрать спецификатор и упрётся
 * в файл, которого нет в графе: `public/` копируется как есть и модульным графом не считается.
 * Это ровно тот случай из §2.10, ради которого комментарий и придуман.
 */
const BASE = `${import.meta.env.BASE_URL.replace(/\/+$/, '')}/demo/modules/`;

const ENTRY: Record<CycleVariant, string> = { fn: 'a-fn.js', const: 'a-const.js' };
const FILES: Record<CycleVariant, string[]> = {
  fn: ['a-fn.js', 'b-fn.js'],
  const: ['a-const.js', 'b-const.js'],
};

interface TraceModule {
  trace: string[];
}

/** Журнал — тот же самый экземпляр, что видят модули цикла: URL один, значит и модуль один. */
async function traceModule(): Promise<TraceModule> {
  return (await import(/* @vite-ignore */ `${BASE}trace.js`)) as TraceModule;
}

const message = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Текст модуля с сервера: показываем не пересказ примера, а тот файл, который исполнился. */
async function sourceOf(name: string): Promise<{ name: string; code: string }> {
  try {
    const response = await fetch(`${BASE}${name}`);
    return { name, code: (await response.text()).trimEnd() };
  } catch {
    return { name, code: '// не удалось прочитать файл' };
  }
}

export async function runCycle(variant: CycleVariant): Promise<CycleRun> {
  const { trace } = await traceModule();
  trace.length = 0;

  let error: string | null = null;
  try {
    await import(/* @vite-ignore */ `${BASE}${ENTRY[variant]}`);
  } catch (caught) {
    error = message(caught);
  }
  const first = [...trace];

  // Вторая попытка того же URL. Ни одно тело не выполнится заново — ни у успешного графа,
  // ни у сломанного: карта модулей помнит и результат, и исключение.
  const again = await (async (): Promise<string> => {
    try {
      await import(/* @vite-ignore */ `${BASE}${ENTRY[variant]}`);
      return 'резолвился тем же namespace-объектом';
    } catch (caught) {
      return message(caught);
    }
  })();
  const addedOnSecondTry = trace.length - first.length;

  return {
    variant,
    trace: first,
    error,
    again,
    addedOnSecondTry,
    sources: await Promise.all(FILES[variant].map(sourceOf)),
  };
}
