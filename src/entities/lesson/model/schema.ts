import { z } from 'astro/zod';

/**
 * Схема frontmatter урока. Её же читает `src/content.config.ts`.
 *
 * Заголовок и лид лежат здесь, а не в теле MDX, потому что их рисует страница — шапку урока
 * собирает виджет, а не автор текста. Внутри разрешена строчная разметка `inlineMd`:
 * обратные кавычки и **жирный**.
 */
export const lessonSchema = z.object({
  /** Название темы: H1, навигация, карта курса, заголовок вкладки. */
  title: z.string(),
  /** Порядок в курсе. */
  order: z.number().int().positive(),
  /** Надзаголовок шапки. По умолчанию — имя курса. */
  kicker: z.string().optional(),
  /** H1, если он должен отличаться от названия темы. Обычно не нужен. */
  heading: z.string().optional(),
  /** Ширина H1 в `ch`. */
  headingWidth: z.number().default(20),
  /** Короткое описание под заголовком: о чём урок и что из него следует. */
  lead: z.string(),
  /** Ширина лида в `ch` — в оригиналах 62–66. */
  leadWidth: z.number().default(64),
  /** Одна фраза для карты курса. */
  summary: z.string(),
  /** Разделы для навигации: якорь и подпись без номера — номер ставит виджет. */
  nav: z.array(z.object({ id: z.string(), label: z.string() })),
  /** Где и когда проверялись версиезависимые утверждения. */
  verifiedOn: z.string().optional(),
});

export type LessonFrontmatter = z.infer<typeof lessonSchema>;
