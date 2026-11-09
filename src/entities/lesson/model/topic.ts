/**
 * Данные обязательных блоков темы — словаря, «Перед началом», источников и тонких мест.
 *
 * Один тип на все темы: раньше каждая `data.ts` писала его заново, и вариантов набралось шесть.
 * Импортировать только как тип (`import type`): вход `@/entities/lesson` тянет `astro:content`,
 * которого нет в процессе vitest.
 */
import type { CodeLang } from '@/shared/lib/highlight';

/** Слово словаря во вводном разделе: термин и его объяснение. */
export interface GlossaryTerm {
  k: string;
  d: string;
}

/** Карточка «Перед началом»: что тема считает известным и где это разобрано. */
export interface Prereq {
  t: string;
  d: string;
  /** Без адреса подпись «Где разобрано» не печатается — карточка говорит о границе самой темы. */
  href?: string;
  hrefLabel?: string;
  tone: 'info' | 'warn' | 'err' | 'ok';
}

/** Внешний источник: название ссылкой и одна строка о том, что оттуда взято. */
export interface Source {
  title: string;
  href: string;
  what: string;
}

/** Группа источников — для тем, где их выводят карточками по группам. */
export interface SourceGroup {
  t: string;
  items: string[];
}

/** Карточка «тонкого места»: номер, заголовок, пояснение и степень опасности. */
export interface Pitfall {
  n: string;
  t: string;
  d: string;
  /** Пример, если тонкое место видно только в коде. */
  code?: string;
  /** Язык примера, если не JS: `yaml`, `shellsession`… `text` — вывод или схема, не код. */
  lang?: CodeLang;
  /** Без тона — просто факт; `warn` — где легко ошибиться; `err` — где ошибка молчит. */
  tone?: 'warn' | 'err';
}
