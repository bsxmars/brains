/** Внутренний слот: поле без ключа, которого нет ни в одном перечислении. */
export interface AnatomySlot {
  name: string;
  value: string;
}

/**
 * Собственное свойство объекта — пара «ключ → дескриптор».
 *
 * Именно дескриптор, а не значение: у аксессора значения нет вовсе, есть функция `get`.
 * Поэтому у строки два поля вместо одного и список флагов рядом.
 */
export interface AnatomyProperty {
  key: string;
  value: string;
  kind: 'data' | 'accessor';
  flags: string[];
}

/** Звено цепочки прототипов под объектом. */
export interface AnatomyProto {
  name: string;
  body: string;
  note?: string;
}

/** Шаг работы `new`: что делает и в каком состоянии после этого объект. */
export interface NewStep {
  title: string;
  text: string;
  /** Состояние объекта после шага; пустой массив — объекта ещё нет. */
  state: string[];
}
