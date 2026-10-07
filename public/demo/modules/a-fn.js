// Тот же самый цикл, но через объявление функции: `function`, а не `const`.

import { note } from './trace.js';
import { getB } from './b-fn.js';

note('a: тело пошло');
export function getA() {
  return 'A';
}
note('a: зову getB() = ' + getB());
