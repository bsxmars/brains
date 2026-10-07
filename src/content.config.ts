import { glob } from 'astro/loaders';
import { defineCollection } from 'astro:content';
import { lessonSchema } from './entities/lesson/model/schema';

/**
 * Урок — это папка: `index.mdx` с текстом и `data.ts` с данными демо рядом. Поэтому id берём
 * по имени папки, а не по пути к файлу: иначе адрес урока был бы `promise-internals/index`.
 *
 * Импорт относительный, а не через `@/`: конфиг коллекций читается до того, как алиасы Vite
 * вступают в силу.
 */
/**
 * Курс — это коллекция. Схема у всех одна: урок устроен одинаково, чем бы он ни занимался,
 * а `order` считается внутри своего курса и потому не мешает соседям.
 */
const lessonCollection = (dir: string) =>
  defineCollection({
    loader: glob({
      pattern: '*/index.mdx',
      base: `./src/content/${dir}`,
      generateId: ({ entry }) => entry.split('/')[0],
    }),
    schema: lessonSchema,
  });

export const collections = {
  /** «Внутренности JS» — движок, асинхронность, потоки и память. */
  lessons: lessonCollection('lessons'),
  /** «Браузер и рендеринг» — устройство браузера, кадр, CSS, GPU. */
  render: lessonCollection('render'),
  /** «Фреймворки изнутри» — React, Vue, сигналы, SSR и компиляторы. */
  frameworks: lessonCollection('frameworks'),
  /** «Сеть и безопасность» — сеть и кеши, соединения, стримы, безопасность. */
  platform: lessonCollection('platform'),
  /** «Сборка и инструменты» — модули, типы, пакетные менеджеры, HMR, Module Federation. */
  tooling: lessonCollection('tooling'),
  /** «Доставка» — контейнеры, конвейеры и публикация: как код уезжает в прод. */
  delivery: lessonCollection('delivery'),
  /** «Алгоритмы во фронтенде» — diff, CRDT, структуры редакторов, поиск, планировщики. */
  algorithms: lessonCollection('algorithms'),
  /** «Данные и бэкенд» — индексы, транзакции, кеш, очереди. */
  data: lessonCollection('data'),
  /** «Паттерны в JS и TS» — порождающие, структурные и поведенческие паттерны на языке и платформе. */
  patterns: lessonCollection('patterns'),
};
