// Тело b по-прежнему выполняется первым — но getA уже инициализирован на фазе связывания.

import { note } from './trace.js';
import { getA } from './a-fn.js';

note('b: тело пошло');
note('b: зову getA() = ' + getA());
export function getB() {
  return 'B';
}
