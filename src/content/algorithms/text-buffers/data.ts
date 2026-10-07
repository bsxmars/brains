import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DemoCase, Kind, ScaleResult, Scenario } from '@/widgets/textbuf-lab/model/types';

/**
 * Данные темы «Как редактор хранит текст: строка, gap buffer, rope и piece table».
 *
 * Тема написана 2026-10-01, третьей в направлении «Алгоритмы во фронтенде».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0 (V8 13.6.233.10), macOS arm64, октябрь 2026. Скрипты стенда — в scratchpad
 * агента (`agent-textbuf/`). Таймеров нет: меряется не время, а работа — два счётчика внутри
 * самих учебных реализаций: `copied` (сколько символов переписано) и `visited` (сколько
 * символов, узлов дерева или кусков просмотрено при поиске места). Случайные правки — ГПСЧ
 * Лемера (`s = s·48271 mod 2³¹−1`), зерно записано рядом с числом.
 *
 * Настоящей реализации piece tree VS Code в проекте нет (пакет `vscode-textbuffer` не ставился),
 * поэтому эталоны такие:
 *   — **строковая модель как оракул**: на 3000 случайных последовательностях по 40 правок
 *     (вставки до 60 символов, удаления до 12, алфавит с `\n` и кириллицей, случайный размер
 *     дырки и листа) тексты всех четырёх моделей совпадают со строкой, начала строк — с
 *     `split('\n')`, у rope после каждой правки высоты детей отличаются не больше чем на 1,
 *     снимки piece table возвращают каждый промежуточный текст;
 *   — **настоящий `TextDocument`** из `vscode-languageserver-textdocument` 1.0.14 (стоит
 *     в `node_modules` как зависимость языкового сервера Astro): та же «одна строка» плюс массив
 *     начал строк. Тест гоняет через него те же случайные правки и сверяет текст и `offsetAt`;
 *   — **настоящий Yjs 13.6.33**: `Y.Text` держит текст списком кусков (`Item`). На 500 случайных
 *     последовательностях по 60 правок число живых кусков Yjs совпало с числом кусков
 *     `PIECE_CODE` в 495 случаях, в остальных пяти разница ±1;
 *   — **V8**: `V8_CODE` исполняется в отдельном `node --allow-natives-syntax`, вывод — `V8_OUT`.
 *
 * Числа «в масштабе» (`SCALE`, `GAP_GROW`, `ROPE_LEAF`) пересчитывает тест той же функцией
 * `measure` из `widgets/textbuf-lab/model/run.ts`, что и демо.
 *
 * Из документации и исходников, без проверки запуском: история VS Code (версия 1.21, март 2018,
 * прежний массив строк, файл 35 МБ на 13,7 млн строк и ~600 МБ памяти, куски по 64 КБ,
 * красно-чёрное дерево, поля `size_left` и `lf_left`, «печать подряд» через
 * `_lastChangeBufferPos`, константа `AverageBufferSize = 65535`) — по статье Пэна Лю в блоге
 * VS Code и `pieceTreeBase.ts`/`rbTreeBase.ts`; `GAP_BYTES_DFL = 2000` — `src/buffer.h` Emacs;
 * поведение дырки в Emacs — руководство Emacs Lisp, «The Buffer Gap»; ropes — статья Boehm,
 * Atkinson, Plass (1995); 80 «маркеров поиска» Yjs — `maxSearchMarker` в `AbstractType.js`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'буфер текста',
    d: 'Структура данных, в которой редактор держит открытый документ. Снаружи у неё четыре вопроса: вставить, удалить, отдать кусок текста и найти, где начинается строка номер N.',
  },
  {
    k: 'позиция (offset)',
    d: 'Номер символа от начала документа, с нуля. Правки приходят в позициях: «вставить `ж` в позицию 120». В JS это номер 16-битной единицы UTF-16, а не буквы.',
  },
  {
    k: 'номер строки',
    d: 'Редактор думает строками: подсветка, ошибки компилятора, «перейти к строке 1200». Чтобы показать строку, нужно найти её начало — позицию после N-го перевода строки `\\n`.',
  },
  {
    k: 'стоимость операции',
    d: 'Здесь — не миллисекунды, а работа: сколько символов пришлось переписать и сколько символов, узлов или кусков просмотреть. Её можно посчитать точно и повторить на любой машине.',
  },
  {
    k: 'амортизированно',
    d: 'В среднем на длинной серии операций. Редкая дорогая операция «размазывается» по множеству дешёвых: если раз в тысячу вставок переписать тысячу символов, это один символ на вставку.',
  },
  {
    k: 'сбалансированное дерево',
    d: 'Дерево, у которого все ветки примерно одной длины. Тогда путь от корня до любого листа — порядка log₂ от числа листьев: для 100 000 символов — около дюжины шагов.',
  },
];

export const PLAIN_BUFFERS =
  'Как правка рукописи. Можно переписывать набело всю тетрадь ради каждого слова — это одна строка. Можно оставлять пустое место там, где сейчас пишешь, — это gap buffer. Можно разрезать рукопись на листы и держать их в папке с оглавлением — это rope. А можно вообще не трогать оригинал и вести отдельный листок «читать страницы 1–3 оригинала, потом вклейку №1, потом страницу 4…» — это piece table.';

export const PREREQ_NOTE =
  'Тема опирается на одну вещь, разобранную в другой теме, и на две, которых на сайте нет, — они объяснены прямо на карточках.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Строку в JS нельзя изменить',
    d: 'Любая «правка» строки создаёт новую строку. V8 умеет откладывать копирование: склейка `a + b` даёт узел-ссылку на обе части (cons-строку), а срез — окно в чужой буфер. Но первое же чтение по индексу или новый срез заставляют собрать плоскую копию.',
    href: '/js/v8-strings/#s2',
    hrefLabel: '«Строки в V8», раздел «Пять представлений»',
    tone: 'info',
  },
  {
    t: 'Оценка «O-большое»',
    d: '`O(n)` значит: работа растёт пропорционально длине текста — документ в 10 раз длиннее, правка в 10 раз дороже. `O(1)` — не зависит от длины. `O(log n)` — растёт на шаг, когда документ удваивается: 1000 символов — 10 шагов, миллион — 20.',
    tone: 'info',
  },
  {
    t: 'Двоичное дерево',
    d: 'Узлы, у каждого не больше двух детей — левого и правого. Узел может хранить сводку о своём поддереве, например сколько в нём символов. Тогда, спускаясь от корня, можно решать «налево или направо», не заглядывая в сами листья.',
    tone: 'info',
  },
];

// ─── Раздел 1. Одна строка ─────────────────────────────────────────────────────────────────

export const STRING_NOTE =
  'Модель считает честно для плоской строки: новая строка собирается целиком, поэтому вставка одной буквы в документ из 100 000 символов переписывает 100 001 символ. Поиск строки номер N идёт с начала и просматривает все символы до неё.';

export const STRING_CODE = `// «Одна строка». Счётчики работы: copied — сколько символов
// переписано, visited — сколько просмотрено при поиске.
function create(text) {
  return { s: text, copied: 0, visited: 0 };
}

// Новая строка собирается из трёх частей. В плоском виде
// это копия всего текста — даже если вставили одну букву.
function insert(b, pos, str) {
  b.s = b.s.slice(0, pos) + str + b.s.slice(pos);
  b.copied += b.s.length;
}

function remove(b, pos, len) {
  b.s = b.s.slice(0, pos) + b.s.slice(pos + len);
  b.copied += b.s.length;
}

const text = (b) => b.s;

// Где начинается строка номер line (с нуля): идти с начала
// и считать переводы строк.
function lineStart(b, line) {
  let pos = 0;
  for (let k = 0; k < line; k++) {
    const nl = b.s.indexOf('\\n', pos);
    b.visited += nl - pos + 1;
    pos = nl + 1;
  }
  return pos;
}`;

/**
 * Вставка в середину в настоящем V8. Печатается на странице и исполняется тестом в отдельном
 * `node --allow-natives-syntax`; вывод обязан совпасть с `V8_OUT` и с комментариями в коде.
 */
export const V8_CODE = `// node --allow-natives-syntax insert.js
const insertAt = (s, pos, str) => s.slice(0, pos) + str + s.slice(pos);
let s = 'ab\\n'.repeat(20000);                 // 60 000 символов

s = insertAt(s, 30000, 'X');
const first = s;
console.log(%StringIsFlat(first));           // false: склеено, но не скопировано
s = insertAt(s, 1000, 'Y');
console.log(%StringIsFlat(first));           // true: slice расплющил её — копия
console.log(%StringIsFlat(s));               // false: новая снова ждёт

let flats = 0;
let t = 'ab\\n'.repeat(20000);
for (let i = 1; i <= 100; i++) {
  const prev = t;
  t = insertAt(t, (i * 7919) % t.length, 'Z');
  if (%StringIsFlat(prev)) flats++;
}
console.log(flats);                          // 100`;

export const V8_OUT = ['false', 'true', 'false', '100'];

export const V8_NOTE =
  'V8 не копирует строку в момент склейки: результат — cons-строка, узел с двумя ссылками. Но следующей правке нужен `slice`, а срез требует плоского родителя, и V8 расплющивает предыдущую версию — переписывает все её символы в один буфер. Из 100 правок подряд расплющена каждая предыдущая версия, все 100. Копирование не исчезло, оно только сдвинулось на шаг. Что именно заставляет V8 расплющить строку, разобрано в теме [«Строки в V8», раздел «Расплющивание»](/js/v8-strings/#s3).';

export const STRING_FACTS = [
  {
    t: 'Так живут языковые серверы',
    d: '`TextDocument` из пакета `vscode-languageserver-textdocument` держит открытый файл одной строкой и массивом начал строк. Правка собирает новую строку через `substring`, а потом сдвигает начала **всех** строк ниже правки. Для сервера, который получает правки пачками и потом читает файл целиком, этого достаточно.',
  },
  {
    t: 'Так жил VS Code до 2018 года',
    d: 'Не одна строка, а массив строк: правка внутри строки меняет одну короткую строку. Зато каждая строка — отдельный объект. По рассказу команды, файл в 35 МБ из 13,7 млн строк занимал около 600 МБ: 40–60 байт служебных данных на каждую строку. Открыть такой файл было нельзя — не хватало памяти.',
  },
];

// ─── Раздел 2. Gap buffer ──────────────────────────────────────────────────────────────────

export const GAP_CODE = `// Gap buffer: массив символов с «дыркой» там, где курсор.
//   [к о т _ _ _ _ п ё с]   start = 3, end = 7
// Слева от дырки — текст до курсора, справа — после.
// Запас 2000 — столько Emacs добавляет к дырке, когда её расширяет.
function create(text, gap = 2000) {
  const a = new Array(text.length + gap);
  for (let i = 0; i < text.length; i++) a[i] = text[i];
  return { a, start: text.length, end: a.length, copied: 0, visited: 0 };
}

// Перевести дырку к pos: переносить символы через неё по одному.
function moveGap(b, pos) {
  while (pos < b.start) { b.a[--b.end] = b.a[--b.start]; b.copied++; }
  while (pos > b.start) { b.a[b.start++] = b.a[b.end++]; b.copied++; }
}

// Дырка кончилась: новый массив вдвое больше, переписать всё.
function grow(b, need) {
  const size = Math.max(b.a.length * 2, b.a.length + need);
  const a = new Array(size);
  const tail = b.a.length - b.end;
  for (let i = 0; i < b.start; i++) a[i] = b.a[i];
  for (let i = 0; i < tail; i++) a[size - tail + i] = b.a[b.end + i];
  b.copied += b.start + tail;
  b.a = a;
  b.end = size - tail;
}

function insert(b, pos, str) {
  moveGap(b, pos);
  if (b.end - b.start < str.length) grow(b, str.length);
  for (let i = 0; i < str.length; i++) b.a[b.start++] = str[i];
  b.copied += str.length;
}

// Удалённые символы просто оказываются внутри дырки.
function remove(b, pos, len) {
  moveGap(b, pos);
  b.end += len;
}

const charAt = (b, i) => (i < b.start ? b.a[i] : b.a[i + b.end - b.start]);
const text = (b) => b.a.slice(0, b.start).join('') + b.a.slice(b.end).join('');

function lineStart(b, line) {
  let pos = 0;
  for (let k = 0; k < line; pos++) {
    b.visited++;
    if (charAt(b, pos) === '\\n') k++;
  }
  return pos;
}`;

/** 100 000 символов подряд у курсора в документе из 10 000. Пересчитывается тестом. */
export const GAP_GROW = { doc: 10000, typed: 100000, grows: 4, cells: [12000, 192000], copied: 280000 };

export const PLAIN_GAP =
  'Как черновик, в котором после текущего абзаца всегда оставлено полстраницы пустых строк. Пишете там, где пустое место, — ничего переписывать не надо. Захотели вставить слово на другой странице — придётся переносить пустое место туда: переписать всё, что между старым и новым местом.';

export const GAP_FACTS = [
  {
    t: 'У курсора — один символ',
    d: 'Пока дырка стоит у курсора и в ней есть место, вставка пишет символ в дырку, и всё. Удаление ещё дешевле: дырка просто расширяется на удалённые символы, ничего не переписывается.',
  },
  {
    t: 'Прыжок стоит расстояния',
    d: 'Правка в другом месте сначала переносит дырку: каждый символ между старым и новым местом переписывается. Первая вставка в середину документа из 100 000 символов переписывает 50 001 символ: 50 000 — переезд дырки из конца, один — сама буква. Руководство Emacs так и пишет: первая правка в далёкой части большого буфера иногда даёт заметную задержку.',
  },
  {
    t: 'Рост — редкий и дорогой',
    d: 'Когда дырка кончилась, массив выделяется заново, вдвое больше, и весь текст переписывается. Это `O(n)`, но после удвоения места хватит надолго, поэтому в среднем на символ выходит константа.',
  },
];

export const GAP_GROW_NOTE =
  'Документ из 10 000 символов, курсор в середине, напечатано 100 000 символов подряд. Дырка росла 4 раза, массив вырос с 12 000 до 192 000 ячеек. Всего переписано 280 000 символов: 100 000 — сами вставки, 180 000 — четыре переезда в новый массив. Это **2,8 символа на напечатанный символ** — константа, хотя документ вырос в одиннадцать раз.';

// ─── Раздел 3. Rope ────────────────────────────────────────────────────────────────────────

export const ROPE_CODE = `// Rope: двоичное дерево, в листьях — куски текста не длиннее r.leaf.
// Узел помнит длину своего поддерева (len), число переводов строк
// в нём (lines) и высоту (h). Высоты детей отличаются не больше
// чем на 1 — так дерево остаётся низким.
const leaf = (s) => ({ s, len: s.length, lines: s.split('\\n').length - 1, h: 0 });
const node = (left, right) => ({
  left, right,
  len: left.len + right.len,
  lines: left.lines + right.lines,
  h: Math.max(left.h, right.h) + 1,
});

function create(text, leafSize = 64) {
  const r = { leaf: leafSize, root: null, copied: 0, visited: 0 };
  r.root = build(r, text);
  r.copied = 0;
  return r;
}

// Разрезать строку на листья поровну и собрать из них дерево.
function build(r, s) {
  const n = Math.max(1, Math.ceil(s.length / r.leaf));
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(leaf(s.slice(Math.floor((i * s.length) / n), Math.floor(((i + 1) * s.length) / n))));
  }
  r.copied += s.length;
  const up = (lo, hi) => (hi - lo === 1 ? parts[lo] : node(up(lo, (lo + hi) >> 1), up((lo + hi) >> 1, hi)));
  return up(0, n);
}

// Повороты: поднять одного из детей наверх, сохранив порядок листьев.
const rotateRight = (n) => node(n.left.left, node(n.left.right, n.right));
const rotateLeft = (n) => node(node(n.left, n.right.left), n.right.right);
function balance(n) {
  const d = n.left.h - n.right.h;
  if (d > 1) {
    if (n.left.left.h < n.left.right.h) n = node(rotateLeft(n.left), n.right);
    return rotateRight(n);
  }
  if (d < -1) {
    if (n.right.right.h < n.right.left.h) n = node(n.left, rotateRight(n.right));
    return rotateLeft(n);
  }
  return n;
}

// Склеить два дерева: a целиком левее b. Если одно выше другого,
// спуститься по краю высокого до поддерева нужной высоты.
function join(r, a, b) {
  if (!a || !a.len) return b;
  if (!b || !b.len) return a;
  r.visited++;
  if (a.h === 0 && b.h === 0 && a.len + b.len <= r.leaf) {
    r.copied += a.len + b.len;            // два коротких листа — в один
    return leaf(a.s + b.s);
  }
  if (a.h > b.h + 1) return balance(node(a.left, join(r, a.right, b)));
  if (b.h > a.h + 1) return balance(node(join(r, a, b.left), b.right));
  return node(a, b);
}

function insert(r, pos, str) {
  r.root = ins(r, r.root, pos, str);
}
function ins(r, n, pos, str) {
  r.visited++;
  if (n.h === 0) {
    const s = n.s.slice(0, pos) + str + n.s.slice(pos);
    if (s.length > r.leaf) return build(r, s);   // лист переполнился
    r.copied += s.length;
    return leaf(s);
  }
  if (pos <= n.left.len) return join(r, ins(r, n.left, pos, str), n.right);
  return join(r, n.left, ins(r, n.right, pos - n.left.len, str));
}

function remove(r, pos, len) {
  r.root = del(r, r.root, pos, len) || leaf('');
}
function del(r, n, pos, len) {
  r.visited++;
  if (pos === 0 && len === n.len) return null;   // поддерево целиком
  if (n.h === 0) {
    const s = n.s.slice(0, pos) + n.s.slice(pos + len);
    r.copied += s.length;
    return leaf(s);
  }
  const L = n.left.len;
  if (pos + len <= L) return join(r, del(r, n.left, pos, len), n.right);
  if (pos >= L) return join(r, n.left, del(r, n.right, pos - L, len));
  return join(r, del(r, n.left, pos, L - pos), del(r, n.right, 0, pos + len - L));
}

const text = (r) => collect(r.root);
const collect = (n) => (n.h === 0 ? n.s : collect(n.left) + collect(n.right));

// Начало строки номер line: спуск по счётчикам lines, как по len.
function lineStart(r, line) {
  let n = r.root;
  let pos = 0;
  while (n.h > 0) {
    r.visited++;
    if (line <= n.left.lines) n = n.left;
    else {
      line -= n.left.lines;
      pos += n.left.len;
      n = n.right;
    }
  }
  r.visited++;
  let i = 0;
  for (let k = 0; k < line; k++) i = n.s.indexOf('\\n', i) + 1;
  return pos + i;
}`;

export const PLAIN_ROPE =
  'Как книга, разрезанная на тетрадки, и оглавление над ними: «в первой половине 5000 знаков и 120 строк, во второй — 4800 знаков и 110 строк». Чтобы найти 7000-й знак, не надо листать: он во второй половине, на 2000-м месте. Чтобы вставить абзац, переписывается одна тетрадка и поправляются числа в оглавлении над ней.';

export const ROPE_FACTS = [
  {
    t: 'Индекс — по длинам',
    d: 'Каждый узел знает `len` — сколько символов в его поддереве. Чтобы найти позицию 7000: если слева 5000 символов, идти направо и искать позицию 2000. На каждом уровне — одно сравнение, весь путь — высота дерева.',
  },
  {
    t: 'Номер строки — по переводам строк',
    d: 'Ровно так же узел хранит `lines` — сколько `\\n` в его поддереве. Поиск строки номер N — тот же спуск, только сравниваются не длины, а `lines`. В листе остаётся пройти несколько десятков символов.',
  },
  {
    t: 'Баланс держит дерево низким',
    d: 'Без баланса вставки в одно место вытягивают дерево в цепочку, и спуск становится `O(n)`. Здесь у каждого узла высоты детей отличаются не больше чем на 1 — правило AVL-дерева. `join` склеивает два дерева разной высоты и поворотами возвращает баланс.',
  },
];

export const ROPE_NOTE =
  'Вся правка — это спуск к листу и склейка на обратном пути. `ins` переписывает один лист — не больше `r.leaf` символов, — а `join` на каждом уровне создаёт один новый узел. Удаление устроено так же, только диапазон может задеть несколько листов: целиком покрытые поддеревья выбрасываются без обхода. Cons-строка V8 — тоже rope, но без баланса и без счётчика строк: поэтому V8 расплющивает её при первом чтении по индексу, а не ищет в дереве.';

/** Размер листа rope: 1000 правок вразброс и 1000 поисков строки, документ 100 000. Пересчитывается тестом. */
export const ROPE_LEAF = [
  { leaf: 8, copied: 8, visited: 28.7, line: 14.7, h: 15 },
  { leaf: 64, copied: 61.9, visited: 22.8, line: 11.9, h: 12 },
  { leaf: 512, copied: 497.3, visited: 16.6, line: 8.9, h: 9 },
  { leaf: 4096, copied: 4000.1, visited: 10.4, line: 5.7, h: 5 },
];

export const ROPE_LEAF_NOTE =
  'Размер листа — компромисс. Мелкие листья — меньше копий на правку, но дерево выше и узлов больше: на каждый узел — объект с пятью полями. Крупные — дерево ниже, но правка переписывает лист целиком. Числа — для документа из 100 000 символов и 1000 правок вразброс.';

// ─── Раздел 4. Piece table ─────────────────────────────────────────────────────────────────

export const PIECE_CODE = `// Piece table: два буфера — исходный текст (не меняется никогда)
// и буфер добавлений (только растёт). Документ — список кусков
// { buf, start, len }: «взять len символов из буфера buf с start».
function create(text) {
  const b = {
    orig: text,
    add: '',
    nl: { orig: newlines(text, 0), add: [] },  // где в буферах стоят '\\n'
    pieces: [],
    copied: 0,
    visited: 0,
  };
  if (text) b.pieces.push(piece(b, 'orig', 0, text.length));
  return b;
}

function newlines(s, from) {
  const out = [];
  for (let i = s.indexOf('\\n'); i >= 0; i = s.indexOf('\\n', i + 1)) out.push(from + i);
  return out;
}

// Сколько чисел в отсортированном массиве меньше x — двоичный поиск.
function below(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Кусок сразу знает, сколько в нём переводов строк: это разница
// двух двоичных поисков по позициям '\\n', текст не просматривается.
function piece(b, buf, start, len) {
  const nl = b.nl[buf];
  return { buf, start, len, lines: below(nl, start + len) - below(nl, start) };
}

// Разрезать кусок так, чтобы на pos начинался кусок; вернуть его номер.
function cut(b, pos) {
  let i = 0;
  for (; i < b.pieces.length; i++) {
    b.visited++;
    const p = b.pieces[i];
    if (pos < p.len) {
      if (pos > 0) {
        b.pieces.splice(i, 1, piece(b, p.buf, p.start, pos), piece(b, p.buf, p.start + pos, p.len - pos));
        i++;
      }
      return i;
    }
    pos -= p.len;
  }
  return i;
}

function insert(b, pos, str) {
  const start = b.add.length;
  for (const at of newlines(str, start)) b.nl.add.push(at);
  b.add += str;                       // новый текст — в конец буфера
  b.copied += str.length;
  const i = cut(b, pos);
  const prev = b.pieces[i - 1];
  if (prev && prev.buf === 'add' && prev.start + prev.len === start) {
    b.pieces[i - 1] = piece(b, 'add', prev.start, prev.len + str.length);  // печать подряд
  } else {
    b.pieces.splice(i, 0, piece(b, 'add', start, str.length));
  }
}

// Удалить — разрезать по краям и выбросить куски между. Буферы не трогаются.
function remove(b, pos, len) {
  const i = cut(b, pos);
  const j = cut(b, pos + len);
  b.pieces.splice(i, j - i);
}

const text = (b) => b.pieces.map((p) => b[p.buf].slice(p.start, p.start + p.len)).join('');

// Начало строки номер line: пройти куски, вычитая их lines.
function lineStart(b, line) {
  let pos = 0;
  for (const p of b.pieces) {
    b.visited++;
    if (line <= p.lines) {
      if (line === 0) return pos;
      const nl = b.nl[p.buf];
      return pos + nl[below(nl, p.start) + line - 1] - p.start + 1;
    }
    line -= p.lines;
    pos += p.len;
  }
  return pos;
}

// Снимок для отмены — копия списка кусков, не текста: буферы
// не меняются, и старый список по-прежнему описывает старый текст.
const snapshot = (b) => b.pieces.slice();
const restore = (b, snap) => { b.pieces = snap.slice(); };`;

export const PLAIN_PIECE =
  'Как монтажный лист у видеоредактора. Исходные записи никто не режет: монтаж — это список «с 0:00 до 0:12 из первой кассеты, потом 0:05–0:09 из второй». Вырезать сцену — убрать строку из списка; вставить — дописать новую запись в конец второй кассеты и добавить строку. Старый монтажный лист по-прежнему описывает старую версию фильма.';

export const PIECE_FACTS = [
  {
    t: 'Текст не копируется никогда',
    d: 'Вставка дописывает новые символы в конец буфера добавлений — переписываются только они сами. Удаление вообще не трогает буферы: из списка уходят куски. Вставка 10 000 символов в документ любого размера переписывает ровно 10 000.',
  },
  {
    t: 'Печать подряд — один кусок',
    d: 'Если новый текст встаёт сразу за куском, который кончается в конце буфера добавлений, кусок просто удлиняется. Так набранное слово остаётся одним куском, а не десятком однобуквенных. VS Code делает то же самое: помнит, где кончилась последняя правка.',
  },
  {
    t: 'Строки — по позициям `\\n` в буферах',
    d: 'Для каждого буфера один раз запоминаются позиции всех `\\n`. Буферы не меняются, поэтому массив позиций тоже. Сколько переводов строк в куске — разница двух двоичных поисков, а не просмотр текста.',
  },
  {
    t: 'Отмена — почти даром',
    d: 'Старый список кусков ссылается на те же неизменные буферы и по-прежнему описывает старый текст. Снимок для отмены — копия списка ссылок, а не текста. У строки и gap buffer для отмены надо сохранить сами удалённые символы.',
  },
];

export const PIECE_NOTE =
  'Слабое место учебной версии — список кусков: `cut` идёт по нему с начала, поэтому каждая правка и каждый поиск строки стоят `O(число кусков)`. Пока кусков три, это незаметно. После 1000 правок вразброс в документе из 100 000 символов кусков 1491, и поиск строки просматривает в среднем 727 из них.';

export const VSCODE_FACTS = [
  {
    t: 'Куски — в красно-чёрном дереве',
    d: 'Узел дерева — кусок плюс сводка левого поддерева: `size_left` — сколько в нём символов, `lf_left` — сколько переводов строк. Это те же `len` и `lines`, что в rope, только в узлах не текст, а ссылки на буферы. Поиск по позиции и по номеру строки — спуск за `O(log k)`, где k — число кусков.',
  },
  {
    t: 'Буферов много',
    d: 'Файл читается с диска кусками по 64 КБ, и каждый становится своим буфером: склеивать их в одну строку нельзя — у V8 есть предел длины строки. Новый текст пишется в общий буфер добавлений, а вставка длиннее 65 535 символов режется на отдельные буферы.',
  },
  {
    t: 'Цена — чтение строк',
    d: 'Старый массив строк отдавал строку за `O(1)`, а piece tree — за `O(log k)` и ещё собирает её из кусков. По словам автора, после тысяч правок в большом файле это самое медленное место — и самое горячее: строки читают отрисовка, подсветка и поиск ссылок.',
  },
];

export const PIECE_HISTORY =
  'В VS Code эта структура называется **piece tree** и работает с версии 1.21 (март 2018). Заменила она массив строк, на котором большие файлы не открывались. Устройство описано в статье Пэна Лю в блоге VS Code, код — `pieceTreeBase.ts` в репозитории редактора.';

export const CRDT_LINK =
  'Совместный редактор хранит то же самое. `Y.Text` в Yjs — список кусков (`Item`): набранное подряд склеивается в один кусок, вставка в середину режет кусок на два. На 500 случайных последовательностях по 60 правок число живых кусков Yjs совпало с числом кусков piece table темы в 495 случаях. Разница в другом: удалённые куски CRDT не выбрасывает, а оставляет надгробиями, — почему, разобрано в теме [«CRDT», раздел «Последовательность»](/algorithms/crdt/#s3). Чтобы не идти по списку с начала, Yjs помнит до 80 «маркеров» — недавних мест с известной позицией.';

// ─── Раздел 5. Сравнение ───────────────────────────────────────────────────────────────────

export const DEMO: DemoCase = {
  base: 'кот\nпёс\nёж',
  gap: 3,
  leaf: 4,
  steps: [
    { op: 'ins', pos: 3, str: 'ик' },
    { op: 'ins', pos: 5, str: '!' },
    { op: 'del', pos: 0, len: 1 },
    { op: 'ins', pos: 12, str: '\nуж' },
    { op: 'line', line: 3 },
  ],
};

export const DEMO_CAPTION =
  'На крошечном тексте видно устройство: у gap buffer дырка из трёх ячеек, у rope листья до четырёх символов. Вторая вставка продолжает первую — gap buffer пишет один символ, piece table удлиняет тот же кусок. Удаление первой буквы заставляет дырку уехать в начало, а вставка в конец — вернуться и вырасти. Поиск строки 3 у строки и gap buffer просматривает символы, у rope и piece table — узлы и куски. На маленьком тексте разница мала, в масштабе она и есть всё дело.';

export const SCALE_CAPTION =
  'Один и тот же сценарий на документах в 1 000, 10 000 и 100 000 символов. Смотрите не на сами числа, а на то, как они растут вместе с документом: у строки — в десять раз на каждый шаг, у rope — на несколько единиц, у piece table — вместе с числом кусков. Полоса — вся работа операции, переписанное плюс просмотренное, в логарифмической шкале: в обычной rope рядом со строкой был бы не виден.';

export const SCENARIOS: { id: Scenario; label: string; d: string }[] = [
  { id: 'type', label: 'печать подряд', d: 'Курсор в середине документа, 1000 символов по одному. Первая вставка — отдельно: в ней курсор приходит в новое место.' },
  { id: 'scatter', label: 'правки вразброс', d: '1000 правок по одному символу в случайных местах: вставка и удаление через раз.' },
  { id: 'lines', label: 'поиск строки', d: 'После тех же 1000 правок вразброс — 1000 поисков начала случайной строки.' },
  { id: 'paste', label: 'вставка 10 000', d: 'Одна вставка 10 000 символов в середину документа.' },
];

export const SIZES = [1000, 10000, 100000];

export const KIND_LABELS: Record<Kind, string> = {
  string: 'одна строка',
  gap: 'gap buffer',
  rope: 'rope',
  piece: 'piece table',
};

/**
 * Снято `measure` из `widgets/textbuf-lab/model/run.ts` (зерно 2026, rope с листом 64,
 * gap buffer с запасом 2000). Ключ — `сценарий/длина`. Тест пересчитывает всё.
 */
export const SCALE: Record<string, ScaleResult> = {
  'type/1000': {
    string: { first: 1001, copied: 1501, visited: 0 },
    gap: { first: 501, copied: 1, visited: 0 },
    rope: { first: 64, copied: 50.1, visited: 11.9, h: 6 },
    piece: { first: 1, copied: 1, visited: 3, pieces: 3 },
  },
  'type/10000': {
    string: { first: 10001, copied: 10501, visited: 0 },
    gap: { first: 5001, copied: 1, visited: 0 },
    rope: { first: 64, copied: 50.1, visited: 18.8, h: 9 },
    piece: { first: 1, copied: 1, visited: 3, pieces: 3 },
  },
  'type/100000': {
    string: { first: 100001, copied: 100501, visited: 0 },
    gap: { first: 50001, copied: 1, visited: 0 },
    rope: { first: 64, copied: 50.1, visited: 25, h: 12 },
    piece: { first: 1, copied: 1, visited: 3, pieces: 3 },
  },
  'scatter/1000': {
    string: { copied: 1000.5, visited: 0 },
    gap: { copied: 337, visited: 0 },
    rope: { copied: 52.2, visited: 9.8, h: 5 },
    piece: { copied: 0.5, visited: 367.7, pieces: 777 },
  },
  'scatter/10000': {
    string: { copied: 10000.5, visited: 0 },
    gap: { copied: 3362.8, visited: 0 },
    rope: { copied: 57.8, visited: 16.4, h: 9 },
    piece: { copied: 0.5, visited: 560.9, pieces: 1379 },
  },
  'scatter/100000': {
    string: { copied: 100000.5, visited: 0 },
    gap: { copied: 33621.1, visited: 0 },
    rope: { copied: 61.9, visited: 22.8, h: 12 },
    piece: { copied: 0.5, visited: 586.3, pieces: 1491 },
  },
  'lines/1000': {
    string: { copied: 0, visited: 405.9 },
    gap: { copied: 0, visited: 405.9 },
    rope: { copied: 0, visited: 5.6, h: 5 },
    piece: { copied: 0, visited: 313.9, pieces: 777 },
  },
  'lines/10000': {
    string: { copied: 0, visited: 4882.3 },
    gap: { copied: 0, visited: 4882.3 },
    rope: { copied: 0, visited: 8.7, h: 9 },
    piece: { copied: 0, visited: 677.7, pieces: 1379 },
  },
  'lines/100000': {
    string: { copied: 0, visited: 48691.7 },
    gap: { copied: 0, visited: 48691.7 },
    rope: { copied: 0, visited: 11.9, h: 12 },
    piece: { copied: 0, visited: 727.3, pieces: 1491 },
  },
  'paste/1000': {
    string: { copied: 11000, visited: 0 },
    gap: { copied: 11500, visited: 0 },
    rope: { copied: 10063, visited: 30, h: 9 },
    piece: { copied: 10000, visited: 1, pieces: 3 },
  },
  'paste/10000': {
    string: { copied: 20000, visited: 0 },
    gap: { copied: 25000, visited: 0 },
    rope: { copied: 10063, visited: 42, h: 9 },
    piece: { copied: 10000, visited: 1, pieces: 3 },
  },
  'paste/100000': {
    string: { copied: 110000, visited: 0 },
    gap: { copied: 160000, visited: 0 },
    rope: { copied: 10063, visited: 47, h: 12 },
    piece: { copied: 10000, visited: 1, pieces: 3 },
  },
};

const fmt = (x: number) => x.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
const KINDS: Kind[] = ['string', 'gap', 'rope', 'piece'];

/** Документ 100 000 символов: переписано символов на операцию (поиск строки — просмотрено). */
export const COST_ROWS = KINDS.map((k) => [
  KIND_LABELS[k],
  fmt(SCALE['type/100000'][k].first ?? 0),
  fmt(SCALE['type/100000'][k].copied),
  fmt(SCALE['scatter/100000'][k].copied),
  fmt(SCALE['paste/100000'][k].copied),
  fmt(SCALE['lines/100000'][k].visited),
]);

/** Как растёт цена правки вразброс и поиска строки с длиной документа. */
export const GROWTH_ROWS = KINDS.map((k) => [
  KIND_LABELS[k],
  SIZES.map((n) => fmt(SCALE[`scatter/${n}`][k].copied)).join(' → '),
  SIZES.map((n) => fmt(SCALE[`scatter/${n}`][k].visited)).join(' → '),
  SIZES.map((n) => fmt(SCALE[`lines/${n}`][k].visited)).join(' → '),
]);

export const ROPE_LEAF_ROWS = ROPE_LEAF.map((r) => [String(r.leaf), fmt(r.copied), fmt(r.visited), fmt(r.line), String(r.h)]);

export const GROWTH_NOTE =
  'Строка платит за каждую правку длиной документа — `O(n)`. Gap buffer — расстоянием прыжка: у курсора один символ, вразброс — в среднем треть документа. Rope платит листом и высотой дерева — `O(log n)`: документ вырос в сто раз, а путь — с 10 до 23 узлов. Piece table не копирует ничего, кроме нового текста, зато её список кусков растёт с каждой правкой.';

export const SUMMARY =
  '**Выбор зависит от того, как правят.** Полю ввода хватает одной строки. Редактору, где правят у курсора, — gap buffer: дёшево, пока не прыгать. Большим файлам, многим курсорам и «заменить всё» нужна правка и поиск строки за `O(log n)` — rope или piece tree. Piece table вдобавок даёт дешёвую отмену и ту же форму данных, что у совместного редактора.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Позиция — это единица UTF-16, а не буква',
    d: 'Во всех четырёх моделях и в редакторах на JS позиция считает 16-битные единицы. `\'😀\'.length` равно 2, и правка «удалить 1 символ» на позиции эмодзи оставит половинку суррогатной пары. Курсор и выделение обязаны шагать по границам символов, а не по единицам. Почему длина считает не то — в теме [«Строки в V8», раздел «Юникод»](/js/v8-strings/#s5).',
    tone: 'err',
  },
  {
    n: '02',
    t: '`\\r\\n` — два символа, одна строка',
    d: 'Счётчик `lines` в теме считает только `\\n`. В файле с переводами `\\r\\n` правка может разрезать пару посередине или склеить `\\r` и `\\n` из соседних кусков в новый перевод строки. Автор piece tree VS Code называл это кошмаром: на каждую правку надо проверять края кусков.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Piece table не освобождает удалённое',
    d: 'Буферы только растут: удалённый текст остаётся в исходном буфере, а всё напечатанное и стёртое — в буфере добавлений. Это и делает отмену дешёвой, и это же значит, что память не возвращается, пока документ открыт. Длинная сессия правок — длинный буфер и много кусков; VS Code рассматривал «нормализацию» — пересборку буферов, когда кусков слишком много.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Много курсоров ломают gap buffer',
    d: 'Дырка одна. Правка десятью курсорами в разных концах файла — это десять прыжков на каждое нажатие клавиши, и каждый стоит расстояния. То же с «заменить всё»: замены идут по файлу, и дырка проезжает весь текст. Обходят это, применяя правки по порядку позиций, чтобы дырка ехала в одну сторону.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Склейка `+=` в V8 — не мерило',
    d: 'Цикл `s += \'x\'` в V8 работает быстро: каждая склейка — новый узел cons-строки, копирования нет. Бенчмарк «вставка в конец строки» поэтому покажет, что одна строка — прекрасный буфер. Счёт придёт при первом чтении по индексу или срезе, а вставка в середину требует среза каждый раз.',
  },
  {
    n: '06',
    t: 'Номер строки в позиции устаревает',
    d: 'Сохранить «ошибка в строке 120» или «закладка на позиции 4000» — значит получить неверное место после первой правки выше. Редакторы сдвигают такие пометки при каждой правке, а совместные редакторы привязывают их к id символа, а не к числу.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Peng Lyu — Text Buffer Reimplementation (VS Code blog, 2018)',
    href: 'https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation',
    what: 'массив строк и его память, piece table, кэш переводов строк, красно-чёрное дерево, замеры и слабые места piece tree',
  },
  {
    title: 'VS Code — `pieceTreeBase.ts`',
    href: 'https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase.ts',
    what: '`Piece`, `AverageBufferSize`, удлинение последнего куска при печати, обработка `\\r\\n`',
  },
  {
    title: 'VS Code — `rbTreeBase.ts`',
    href: 'https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/model/pieceTreeTextBuffer/rbTreeBase.ts',
    what: 'узел дерева с `size_left` и `lf_left`',
  },
  {
    title: 'GNU Emacs Lisp Reference Manual — The Buffer Gap',
    href: 'https://www.gnu.org/software/emacs/manual/html_node/elisp/Buffer-Gap.html',
    what: 'дырка в буфере Emacs, задержка при первой правке в далёком месте',
  },
  {
    title: 'GNU Emacs — `src/buffer.h`',
    href: 'https://github.com/emacs-mirror/emacs/blob/master/src/buffer.h',
    what: '`GAP_BYTES_DFL = 2000` — запас при расширении дырки',
  },
  {
    title: 'H.-J. Boehm, R. Atkinson, M. Plass — Ropes: an Alternative to Strings (Software: Practice and Experience, 1995)',
    href: 'https://doi.org/10.1002/spe.4380251203',
    what: 'rope как дерево кусков строки, склейка и балансировка',
  },
  {
    title: 'vscode-languageserver-textdocument — `main.ts`',
    href: 'https://github.com/microsoft/vscode-languageserver-node/blob/main/textDocument/src/main.ts',
    what: '`TextDocument`: одна строка и массив начал строк, сдвиг начал при правке',
  },
  {
    title: 'Yjs 13.6.33 — `src/types/AbstractType.js`',
    href: 'https://github.com/yjs/yjs/blob/v13.6.33/src/types/AbstractType.js',
    what: 'маркеры поиска позиции в списке кусков (`maxSearchMarker`)',
  },
  {
    title: 'V8 — `src/objects/string.h`',
    href: 'https://github.com/v8/v8/blob/main/src/objects/string.h',
    what: '`ConsString`, `SlicedString`, расплющивание',
  },
];

export const RELATED =
  'Смежное на сайте: [Строки в V8, раздел «Расплющивание»](/js/v8-strings/#s3) — когда cons-строка превращается в плоский буфер и сколько это стоит. [CRDT, раздел «Последовательность»](/algorithms/crdt/#s3) — тот же список кусков, когда правят двое. [Diff, раздел «Скрипт правок»](/algorithms/diff/#s1) — как найти правки между двумя версиями, когда редактор их не записал. [Ввод текста в браузере, раздел «Запись из кода и каретка»](/render/text-input/#s6) — откуда берутся позиции правок в обычном поле. [Память и GC, раздел «Путь объекта»](/js/memory-gc/#s1) — куда V8 кладёт большой массив вроде массива gap buffer и почему его не копируют при сборке. [Нечёткий поиск и автодополнение](/algorithms/fuzzy-search/) — trie, Левенштейн, обход дерева с опечатками и ранжирование. [Отмена и повтор](/algorithms/undo-redo/) — две стопки, снимки и обратные правки, группировка и история `<textarea>`.';
