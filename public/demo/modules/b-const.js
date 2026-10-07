// Вторая половина цикла. По обходу в глубину именно это тело выполняется первым.

import { note } from './trace.js';
import { aValue } from './a-const.js';

note('b: тело пошло');
note('b: читаю aValue = ' + aValue);
export const bValue = 'B';
