import type { InjectionKey } from 'vue';

/**
 * Как узел Vue-половины сообщает, что его render-функция отработала.
 *
 * Через `provide`/`inject`, а не пропом, по одной причине: проп изменил бы саму измеряемую
 * величину. Пропы участвуют в решении «обновлять ли ребёнка», и лишний проп на каждом узле
 * означал бы, что прибор встроился в предмет измерения.
 */
export type Report = (node: string) => void;

export const REPORT: InjectionKey<Report> = Symbol('two-models:report');
