// Половина цикла: a импортирует b, b импортирует a. Значение объявлено через `const`.

import { note } from './trace.js';
import { bValue } from './b-const.js';

note('a: тело пошло');
export const aValue = 'A';
note('a: читаю bValue = ' + bValue);
