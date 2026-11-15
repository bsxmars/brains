import { LIVE_COUNTER as COUNTER, LIVE_READER as READER } from '@/content/tooling/modules/data';
/**
 * Живая привязка против снимка значения — на настоящих модулях, собранных в `blob:`.
 *
 * Здесь Blob-URL работает, потому что цикла нет: сначала создаётся счётчик, потом — модуль,
 * который его импортирует уже по готовому адресу. Каждый прогон делает новую пару блобов,
 * то есть новые URL, то есть новые экземпляры модулей: старый счётчик остался бы на единице,
 * и второй прогон соврал бы.
 *
 * Модули настоящие: их исполняет тот же загрузчик, что и код страницы. Ничего не подставлено —
 * все четыре числа читает сам модуль и отдаёт наружу.
 */
export interface Readings {
  /** `import { count }` — привязка к чужой ячейке. */
  binding: number;
  /** `const { count } = ns` — деструктуризация прочитала значение и отпустила связь. */
  destructured: number;
  /** `ns.count` — namespace-объект честно проксирует привязку. */
  viaNs: number;
  /** `def.count` — обычный объект из `export default { count }`, в нём лежит снимок. */
  viaDefault: number;
}

export interface LiveRun {
  before: Readings;
  after: Readings;
}

/**
 * Исходники экспортированы наружу не для красоты: их же выполняет `tests/unit/modules.test.ts`
 * через `data:`-URL в Node. Один текст на демо и на тест — значит, страница не может начать
 * обещать не то, что исполняется.
 */
export { LIVE_COUNTER as COUNTER, LIVE_READER as READER } from '@/content/tooling/modules/data';
function blobUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}

interface ReaderModule {
  before: Readings;
  bump: () => Readings;
}

export async function runLiveBinding(): Promise<LiveRun> {
  const counterUrl = blobUrl(COUNTER);
  const readerUrl = blobUrl(READER(counterUrl));

  try {
    const mod = (await import(/* @vite-ignore */ readerUrl)) as ReaderModule;
    return {
      before: mod.before,
      after: mod.bump(),
    };
  } finally {
    // Блоб держит память документа, пока его не отозвали. Модули уже загружены — адрес больше
    // не нужен: карта модулей ключуется строкой URL, а не самим объектом.
    URL.revokeObjectURL(readerUrl);
    URL.revokeObjectURL(counterUrl);
  }
}
