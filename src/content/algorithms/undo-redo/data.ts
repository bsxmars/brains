import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DemoStep, NativeRun, StackRow } from '@/widgets/undo-lab/model/types';

/**
 * Данные темы «Отмена и повтор: undo/redo изнутри».
 *
 * Тема написана 2026-10-02, девятой в направлении «Алгоритмы во фронтенде».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `immer` **11.1.18**, `yjs` **13.6.33** — из `node_modules` проекта; Node 24.11.0; Chromium
 * **153.0.8010.12** (headless shell из Playwright 1.63), macOS, октябрь 2026. Скрипты стенда —
 * в scratchpad агента (`agent-undo/`): `immer1.mjs`, `cmp-immer.mjs`, `y1.mjs`, `cmp-y3.mjs`,
 * `c1.mjs`–`c5.mjs`, `compute.mjs`. Страницы для Chromium отдавал свой `node:http` на
 * 127.0.0.1 (порты 5080–5082). Таймерных замеров нет: снимаются тексты, выделение, число
 * записей и объектов.
 *
 * Время в учебной истории — виртуальное: правка получает `now` аргументом. У `Y.UndoManager`
 * время берётся из `lib0/time`, где `getUnixTime = Date.now` **запоминается при загрузке
 * модуля**. Подменить `Date.now` после `import 'yjs'` бесполезно — группировка идёт по
 * настоящим часам. Поэтому стенд и тест сначала подменяют часы, а потом грузят `yjs`
 * динамическим `import()`.
 *
 * Что снято и чем пересобирается в `tests/unit/undo-redo.test.ts`:
 *   — `SHARING_CODE` исполняется с настоящим `produce`: из 2004 объектов нового состояния
 *     2001 — те же, что в старом (`SHARING_OUT`);
 *   — `PATCH_CODE` против `produceWithPatches`: 300 зёрен по 40 случайных правок (ЛКГ
 *     `s = (s·1103515245 + 12345) mod 2³¹`) — прямые патчи, обратные, новое состояние и число
 *     переиспользованных объектов совпали на всех 12 000 правках; обратные патчи, применённые
 *     `applyPatches` с конца, возвращают исходное состояние. `IMMER_SPLICE` — патчи Immer
 *     на `splice(0, 1)`;
 *   — `HISTORY_CODE` против `Y.UndoManager` (`captureTimeout: 500`, `trackedOrigins`) на
 *     3000 случайных сценариев двух клиентов по 40 действий (`YJS_MATCH`): тексты после
 *     каждого шага совпали в 2996. Расхождения — две вставки в одно место, где Yjs решает
 *     по соседям-надгробиям, а позиционная модель — правилом «левее остаётся отменяемая»;
 *     с обратным правилом совпадало 2566 из 3000;
 *   — `YJS_CODE` исполняется с настоящим `Y` на подменённых часах, вывод — `YJS_OUT`;
 *     факты `YJS_FACTS` (слияние транзакций, `stopCapturing`, пометка `null` по умолчанию,
 *     чужая правка не чистит redo) проверяются отдельно;
 *   — `NATIVE_RUNS` — тест играет каждый сценарий в Chromium клавиатурой Playwright
 *     (`page.keyboard`, это CDP `Input.dispatchKeyEvent`) и учебной моделью
 *     (`timeout: Infinity`), сверяет оба столбца с литералами. `NATIVE_FACTS` (общая история
 *     документа, предел 1000 записей, тишина `beforeinput` при пустой истории,
 *     пустая запись после `value` в соседнем поле, `setRangeText` обрывает историю,
 *     `contenteditable` группирует так же) — тоже заново;
 *   — `INTERCEPT_CODE` вместе с `HISTORY_CODE` запускается в Chromium на `<textarea>`;
 *   — `STACK_ROWS`, `SNAP_COST`, `COLLAB_ROWS` считает `HISTORY_CODE`.
 *
 * Пауза в сценарии `pause` — настоящие 1,5 с между нажатиями: Chromium время не учитывает,
 * это и проверяется.
 *
 * Только по документации, без запуска: дерево отмены Vim (`:undolist`, `g-`, `:earlier`),
 * отмена в Emacs как обычная правка и `undo-redo` (Emacs 28), «прошлое — настоящее —
 * будущее» в документации Redux, путешествие во времени Redux DevTools, предел глубины
 * Chromium в исходнике `undo_stack.cc` (запуском снято только число 1000), отмена в OT по
 * статье об OT в Википедии. Firefox и Safari стенд не снимал: их правила группировки могут
 * отличаться.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'стопка (стек)',
    d: 'Список, в который кладут сверху и снимают сверху. Последнее положенное снимается первым — поэтому Ctrl+Z отменяет сначала самое свежее.',
  },
  {
    k: 'запись истории',
    d: 'Одна ступень Ctrl+Z. В неё может входить много правок: набранное слово — это несколько символов, но обычно одна запись.',
  },
  {
    k: 'снимок',
    d: 'Копия состояния целиком на момент перед правкой. Отменить — вернуть копию.',
  },
  {
    k: 'обратная правка',
    d: 'Правка, которая гасит прямую. Вставка «к» на место 3 гасится удалением символа на месте 3. Для отмены хранят её, а не копию документа.',
  },
  {
    k: 'патч',
    d: 'Правка, записанная данными: `{ op: \'replace\', path: [\'todos\', 1, \'done\'], value: true }`. Immer к каждому изменению умеет выдать пару — прямые патчи и обратные.',
  },
  {
    k: 'выделение и каретка',
    d: 'Выделение — пара позиций «начало–конец». Каретка — выделение нулевой длины: начало и конец совпадают.',
  },
  {
    k: 'origin',
    d: 'Пометка, с которой правка входит в документ Yjs: «моя», «с сервера», «от Бориса». По ней `Y.UndoManager` решает, какие правки ему отменять.',
  },
];

export const PLAIN_HISTORY =
  'Как черновик с журналом на полях. Каждая строка журнала говорит, как вернуть прошлый вид: «здесь было слово „рыжий“ — вписать обратно». Отмена — исполнить последнюю строку и переписать её на соседний лист, а не выбросить: вдруг передумаешь. Начнёшь новую правку — соседний лист придётся выбросить: те строки относились к тексту, которого больше нет.';

export const PREREQ_NOTE = 'Тема опирается на три вещи, разобранные в других темах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Неизменяемое обновление',
    d: 'Новое состояние — новый объект, старое не трогается. Immer разрешает писать «мутацией» черновика и сам копирует только путь от корня до изменённого поля.',
    href: '/frameworks/state-managers/#s2',
    hrefLabel: '«Стейт-менеджеры изнутри», раздел «Redux»',
    tone: 'info',
  },
  {
    t: '`beforeinput` и `inputType`',
    d: 'Перед каждой правкой поля браузер шлёт `beforeinput`, и его можно отменить. Поле `inputType` называет правку: `insertText`, `deleteContentBackward`, `historyUndo`.',
    href: '/render/text-input/#s1',
    hrefLabel: '«Ввод текста в браузере», раздел «Одно нажатие»',
    tone: 'info',
  },
  {
    t: 'Совместное редактирование',
    d: 'У каждого участника своя копия текста, правки доходят друг до друга с опозданием. Правка «по индексу» при этом съезжает: её либо пересчитывают (OT), либо пишут через постоянные id символов (CRDT).',
    href: '/algorithms/crdt/#s1',
    hrefLabel: '«CRDT», раздел «Сходимость»',
    tone: 'info',
  },
];

// ─── Раздел 1. Две стопки ──────────────────────────────────────────────────────────────────

export const PLAIN_STACKS =
  'Как две стопки тарелок у мойки. Грязные — то, что можно отменить; Ctrl+Z берёт верхнюю, моет и ставит на чистую стопку. Ctrl+Shift+Z берёт верхнюю чистую и возвращает в грязные. Брать можно только сверху — поэтому отмена идёт строго от свежего к старому.';

/** Учебная история, `timeout: 500`; набор — по символу через 120 мс. Считает `HISTORY_CODE`. */
export const STACK_ROWS: StackRow[] = [
  { act: 'набрать «кот»', steps: [{ do: 'type', s: 'кот' }], text: 'кот', undo: 1, redo: 0 },
  { act: 'пауза 1 с, набрать « рыжий»', steps: [{ do: 'wait', ms: 1000 }, { do: 'type', s: ' рыжий' }], text: 'кот рыжий', undo: 2, redo: 0 },
  { act: 'Ctrl+Z', steps: [{ do: 'undo' }], text: 'кот', undo: 1, redo: 1 },
  { act: 'Ctrl+Z', steps: [{ do: 'undo' }], text: '', undo: 0, redo: 2 },
  { act: 'Ctrl+Shift+Z', steps: [{ do: 'redo' }], text: 'кот', undo: 1, redo: 1 },
  { act: 'набрать «ик»', steps: [{ do: 'type', s: 'ик' }], text: 'котик', undo: 2, redo: 0 },
];

export const STACKS_FACTS = [
  {
    t: 'Отмена не стирает запись',
    d: 'Ctrl+Z переносит запись в redo, перевернув её: обратное к «удалить „ рыжий“» — «вставить „ рыжий“». Поэтому повтор работает столько раз, сколько было отмен, и в обратном порядке.',
  },
  {
    t: 'Новая правка чистит redo',
    d: 'После «котик» вернуть « рыжий» нельзя. Запись в redo говорила «вставить „ рыжий“ на место 3», а на месте 3 теперь «ик». Применить её к новому тексту — значит получить текст, которого никто не писал. Простая история поэтому — линия: новая ветка отрезает старую.',
    tone: 'warn' as const,
  },
  {
    t: 'Отмена — не правка',
    d: 'Ctrl+Z и Ctrl+Shift+Z стопку redo не чистят — они только перекладывают записи. Считайся отмена правкой, первое же Ctrl+Z очистило бы redo, и повторять было бы нечего. Emacs решает это иначе — см. раздел «Дерево отмены».',
  },
];

// ─── Раздел 2. Снимки ──────────────────────────────────────────────────────────────────────

export const PLAIN_SNAPSHOT =
  'Как фотографировать доску перед каждой правкой. Вернуть прошлое просто — повесить старую фотографию. Но фотографий столько, сколько правок, и на каждой вся доска, даже если стёрта одна буква.';

/** Структурное разделение в Immer. Тест исполняет с настоящим `produce`. */
export const SHARING_CODE = `const state = {
  user: { name: 'Аня', prefs: { theme: 'dark' } },
  todos: Array.from({ length: 1000 }, (_, i) => ({ id: i, text: 'дело ' + i, tags: ['дом'] })),
};
const next = produce(state, (draft) => {
  draft.todos[500].text = 'купить сыр';
});

// Все объекты дерева: сам объект и всё, что в нём лежит.
function objects(o, seen = new Set()) {
  if (o && typeof o === 'object' && !seen.has(o)) {
    seen.add(o);
    Object.values(o).forEach((v) => objects(v, seen));
  }
  return seen;
}
const old = objects(state);
const all = [...objects(next)];
console.log(all.length, all.filter((o) => old.has(o)).length);`;

export const SHARING_OUT = '2004 2001';

export const SHARING_NOTE =
  'Новых объектов три: корень, массив `todos` и сама задача 500. Остальные 2001 — те же самые, что в старом состоянии. Снимок в такой истории стоит не «всё состояние», а путь от корня до правки. Поэтому в Redux историю обычно так и делают — списком прошлых состояний: `past.push(state)` хранит ссылку, а не копию. Как Immer копирует путь — в [«Стейт-менеджерах», раздел «Redux»](/frameworks/state-managers/#s2).';

/** Учебная история, `HISTORY_CODE`: текст из 10 000 символов, 50 правок по 5 символов с паузами. */
export const SNAP_COST = { base: 10000, entries: 50, snapChars: 506125, ops: 250 };

export const SNAP_ROWS = [
  {
    k: 'снимки',
    v: `${SNAP_COST.snapChars.toLocaleString('ru-RU')} символов`,
    d: `${SNAP_COST.entries} записей, в каждой весь текст на момент перед правкой — от ${SNAP_COST.base.toLocaleString('ru-RU')} символов и длиннее`,
    tone: 'warn' as const,
  },
  {
    k: 'обратные правки',
    v: `${SNAP_COST.ops} правок по символу`,
    d: 'по пять на запись: столько, сколько символов набрано',
    tone: 'ok' as const,
  },
];

export const SNAP_TEXT_NOTE =
  'С текстом сложнее, чем с объектами: строка — одно значение, общих веток у неё нет. Цифры выше — сколько символов описывают снимки; сколько это байт, решает движок. V8 умеет хранить склейку строк как дерево из ссылок на старые куски, и тогда соседние снимки частично делят память — но рассчитывать на это история не может ([«Строки в V8», раздел «Представления»](/js/v8-strings/#s2)). Редакторы, которые хранят текст кусками, делают снимок копией списка кусков, а не текста ([«Как редактор хранит текст», раздел «Piece table»](/algorithms/text-buffers/#s4)).';

// ─── Раздел 3. Обратные правки ─────────────────────────────────────────────────────────────

/** Правка и обратная к ней. Исполняется тестом и демо вместе с `XFORM_CODE` и `HISTORY_CODE`. */
export const OPS_CODE = `// Правка — один символ: { type: 'ins' | 'del', pos, ch }.
// Обратная правка меняет тип, а позицию и символ оставляет.
const invert = (op) => ({ type: op.type === 'ins' ? 'del' : 'ins', pos: op.pos, ch: op.ch });

const apply = (text, op) =>
  op.type === 'ins'
    ? text.slice(0, op.pos) + op.ch + text.slice(op.pos)
    : text.slice(0, op.pos) + text.slice(op.pos + 1);`;

export const PLAIN_INVERSE =
  'Как ехать по навигатору обратно: не нужна карта всего города, хватит списка поворотов — «налево» становится «направо», и проходить его надо с конца. У удаления в обратной правке обязательно лежит удалённый символ: без него вставлять обратно нечего.';

/** Неизменяемая правка объекта с патчами в формате Immer. Тест сверяет с `produceWithPatches`. */
export const PATCH_CODE = `// Неизменяемая правка по пути. Копируется только путь от корня до листа,
// всё остальное — те же объекты. Патчи — в формате Immer.
function update(state, { kind, path, value }) {
  const parent = path.slice(0, -1).reduce((node, key) => node[key], state);
  const last = path[path.length - 1];
  // То же значение — правки нет: тот же объект и ни одного патча, как у Immer.
  if (kind === 'set' && last in parent && parent[last] === value) return [state, [], []];
  const patches = [];
  const inverse = [];

  function walk(node, i) {
    const copy = Array.isArray(node) ? node.slice() : { ...node };
    if (i < path.length - 1) {
      copy[path[i]] = walk(node[path[i]], i + 1);
      return copy;
    }
    const key = path[i];
    if (kind === 'push') {                     // node[key] — массив
      const at = [...path, node[key].length];
      copy[key] = [...node[key], value];
      patches.push({ op: 'add', path: at, value });
      inverse.push({ op: 'remove', path: at });
    } else if (kind === 'remove') {
      if (Array.isArray(copy)) copy.splice(key, 1);
      else delete copy[key];
      patches.push({ op: 'remove', path });
      inverse.push({ op: 'add', path, value: node[key] });
    } else {                                   // set
      const had = key in node;
      copy[key] = value;
      patches.push({ op: had ? 'replace' : 'add', path, value });
      inverse.push(had ? { op: 'replace', path, value: node[key] } : { op: 'remove', path });
    }
    return copy;
  }

  return [walk(state, 0), patches, inverse];
}`;

/** Сверка `PATCH_CODE` с `produceWithPatches` (см. шапку). */
export const PATCH_MATCH = { seeds: 300, ops: 12000, same: 12000 };

export const PATCH_NOTE = `На ${PATCH_MATCH.seeds} случайных объектах по 40 правок — ${PATCH_MATCH.ops.toLocaleString('ru-RU')} правок: замена поля, новое поле, удаление поля, \`push\` и удаление последнего элемента массива — \`update\` выдал те же прямые и обратные патчи, что \`produceWithPatches\`, и переиспользовал те же объекты. Обратные патчи, применённые \`applyPatches\` с конца, вернули исходный объект.`;

/** `produceWithPatches(base, (d) => { d.todos.splice(0, 1) })` на списке из двух задач. Снято Immer 11.1.18. */
export const IMMER_SPLICE = {
  patches: [
    { op: 'replace', path: ['todos', 0], value: { id: 2, text: 'хлеб' } },
    { op: 'remove', path: ['todos', 1] },
  ],
  inverse: [
    { op: 'replace', path: ['todos', 0], value: { id: 1, text: 'молоко' } },
    { op: 'add', path: ['todos', 1], value: { id: 2, text: 'хлеб' } },
  ],
};

export const IMMER_SPLICE_PRINT = `// todos: [{ id: 1, text: 'молоко' }, { id: 2, text: 'хлеб' }]
produceWithPatches(base, (d) => { d.todos.splice(0, 1); });

// прямые: сдвинуть «хлеб» на место 0, убрать хвост
${IMMER_SPLICE.patches.map((p) => JSON.stringify(p)).join('\n')}
// обратные
${IMMER_SPLICE.inverse.map((p) => JSON.stringify(p)).join('\n')}`;

export const IMMER_SPLICE_NOTE =
  'Immer описывает массив по номерам мест, а не по смыслу: «удалить первую задачу» превращается в «на место 0 положить хлеб, место 1 убрать». Для отмены у себя это неважно — обратные патчи вернут ровно прежний массив. Но пересылать такие патчи другому участнику, у которого массив успел поменяться, нельзя: «место 0» у него — другая задача.';

/** История над строкой: обратные правки или снимки, группировка, выделение. */
export const HISTORY_CODE = `// mode: 'ops' — обратные правки; 'snapshots' — снимки текста;
// 'naive' — обратные правки, которые не замечают чужих правок.
function createEditor({ text = '', mode = 'ops', timeout = 500 } = {}) {
  const snap = mode === 'snapshots';
  const ed = {
    text,
    sel: [text.length, text.length],  // выделение: начало и конец
    undoStack: [],
    redoStack: [],
    open: false,                       // можно ли дописать правку в верхнюю запись
    kind: null,                        // 'ins' или 'del' — какой была последняя правка
    last: -Infinity,                   // когда она была, мс
  };
  // Запись: ops — что сделать, чтобы шагнуть (из undo — назад, из redo — вперёд);
  // text — снимок, если история на снимках; sel — выделение после шага.
  const entry = () => ({ ops: [], text: snap ? ed.text : null, sel: ed.sel.slice() });

  function edit(ops, kind, now) {
    ed.redoStack.length = 0;           // новая правка — старое «вперёд» уже не наступит
    const merge = ed.open && ed.kind === kind && now - ed.last < timeout;
    if (!merge) ed.undoStack.push(entry());
    const top = ed.undoStack[ed.undoStack.length - 1];
    for (const op of ops) {
      ed.text = apply(ed.text, op);
      if (!snap) top.ops.unshift(invert(op));  // отменять — с конца
    }
    Object.assign(ed, { open: true, kind, last: now });
  }

  // Удалить выделенное: каждый раз символ на месте from.
  function cut(from, to) {
    const ops = [];
    for (let i = from; i < to; i++) ops.push({ type: 'del', pos: from, ch: ed.text[i] });
    return ops;
  }

  function insert(str, now) {
    const [from, to] = ed.sel;
    const ops = cut(from, to);
    [...str].forEach((ch, i) => ops.push({ type: 'ins', pos: from + i, ch }));
    edit(ops, 'ins', now);
    ed.sel = [from + str.length, from + str.length];
  }

  function backspace(now) {
    let [from, to] = ed.sel;
    if (from === to) from = Math.max(0, from - 1);
    if (from < to) edit(cut(from, to), 'del', now);
    ed.sel = [from, from];
  }

  // Шаг: снять запись с одной стопки, сделать её, обратную положить на другую.
  function step(from, to) {
    let e = from.pop();
    while (e && !snap && !e.ops.some(Boolean)) e = from.pop();  // запись целиком съедена
    if (!e) return false;
    const back = entry();
    if (snap) ed.text = e.text;
    else {
      for (const op of e.ops) {
        if (!op) continue;
        ed.text = apply(ed.text, op);
        back.ops.unshift(invert(op));
      }
    }
    ed.sel = e.sel.slice();
    to.push(back);
    ed.open = false;
    return true;
  }

  // Чужая правка: применить к тексту и пересчитать то, что лежит в стопках.
  function remote(b) {
    ed.text = apply(ed.text, b);
    ed.sel = ed.sel.map((p) => shiftPos(p, b));
    if (mode !== 'ops') return;        // снимки и наивный режим её не учитывают
    for (const stack of [ed.undoStack, ed.redoStack]) {
      let cur = b;                     // b, пересчитанная на уровень текущей записи
      for (let i = stack.length - 1; i >= 0 && cur; i--) {
        stack[i].ops = stack[i].ops.map((op) => {
          const [op2, cur2] = xform(op, cur);
          cur = cur2;
          return op2;
        });
        stack[i].sel = stack[i].sel.map((p) => shiftPos(p, cur));
      }
    }
  }

  return Object.assign(ed, {
    insert,
    backspace,
    remote,
    select(from, to = from) {          // каретку двинули — запись закрыта
      ed.sel = [from, to];
      ed.open = false;
    },
    stop() { ed.open = false; },
    undo: () => step(ed.undoStack, ed.redoStack),
    redo: () => step(ed.redoStack, ed.undoStack),
  });
}`;

export const HISTORY_FACTS = [
  {
    t: 'Обратные — в обратном порядке',
    d: '`unshift` кладёт обратную правку в начало списка. «Кот» набран как `к`, `о`, `т`, а отменяется как «удалить на 2», «удалить на 1», «удалить на 0». Если идти с начала, второе удаление попадёт мимо: после первого символы уже сдвинулись.',
  },
  {
    t: 'Запись делает шаг в обе стороны',
    d: 'У записи одна форма: «что сделать». Отмена исполняет её и кладёт в redo обратную. Повтор — то же самое в другую сторону. Поэтому `undo` и `redo` — один и тот же `step` с переставленными стопками.',
  },
  {
    t: 'Снимок или правки — внутри записи',
    d: 'Режим снимков отличается двумя строками: при записи запоминается `text`, при шаге он возвращается целиком. Всё остальное — стопки, группировка, выделение — общее.',
  },
];

// ─── Раздел 4. Группировка ─────────────────────────────────────────────────────────────────

export const PLAIN_GROUP =
  'Как абзацы в диктовке. Стенографистка не ставит точку после каждой буквы: она ждёт паузы или смены темы. Пауза дольше полсекунды, переход от письма к стиранию, перенос ручки в другое место — новая запись.';

export const GROUP_RULES = [
  {
    t: 'По времени',
    d: 'Правки ближе `timeout` друг к другу сливаются. Окно скользящее: каждая правка продлевает его от себя, поэтому слово, набранное без пауз, — одна запись, сколько бы оно ни длилось. У `Y.UndoManager` это `captureTimeout`, по умолчанию 500 мс.',
  },
  {
    t: 'По виду правки',
    d: 'Набор и стирание — разные записи. Ctrl+Z после «набрал слово, стёр две буквы» вернёт буквы, а не уберёт слово целиком. У `Y.UndoManager` этого правила нет: он делит только по времени.',
  },
  {
    t: 'По месту',
    d: 'Каретку переставили — запись закрыта, даже если прошло мало времени. Иначе одна запись склеит правки в разных концах документа, и отмена прыгнет туда, где человек уже не смотрит.',
  },
  {
    t: 'Явная граница',
    d: '`stop()` закрывает запись руками. Так удобно отделить от набора вставку из буфера, автоформатирование, сохранение: отменять их хочется отдельно.',
  },
];

export const SELECTION_NOTE =
  'Выделение — часть записи. В `sel` лежит выделение на момент перед правкой, и отмена ставит его обратно: стёрли выделенное «world», нажали Ctrl+Z — слово вернулось **выделенным**, как было. Без этого после отмены каретка оказывается там, где была после правки, а человек теряет место, к которому вернулся.';

export const PLAIN_TRANSACTION =
  'Как заказ в ресторане: суп, второе и чай записаны на один чек, хоть и принесены по очереди. Транзакция — такой чек для правок: всё, что сделано внутри, становится одной записью истории.';

/**
 * `Y.UndoManager` с пометкой своих правок, временем и курсором в записи.
 * Тест исполняет с настоящим `Y`; `wait(ms)` двигает подменённые часы.
 */
export const YJS_CODE = `const doc = new Y.Doc();
const text = doc.getText('t');
const undo = new Y.UndoManager(text, {
  trackedOrigins: new Set(['me']),  // отменять только правки с этой пометкой
  captureTimeout: 500,              // правки ближе 500 мс — одна запись
});

// Курсор — часть записи. Индекс устареет от чужих правок,
// поэтому храним относительную позицию: «перед таким-то символом».
let cursor = 0;
undo.on('stack-item-added', (e) => {
  e.stackItem.meta.set('cursor', Y.createRelativePositionFromTypeIndex(text, cursor));
});
undo.on('stack-item-popped', (e) => {
  const rel = e.stackItem.meta.get('cursor');
  cursor = Y.createAbsolutePositionFromRelativePosition(rel, doc).index;
});

function type(s) {
  doc.transact(() => text.insert(cursor, s), 'me');
  cursor += s.length;
}

// Борис правит свою копию; его правка приходит с другой пометкой.
const bob = new Y.Doc();
function bobInserts(index, s) {
  Y.applyUpdate(bob, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(bob)));
  bob.getText('t').insert(index, s);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(bob, Y.encodeStateVector(doc)), 'bob');
  if (index <= cursor) cursor += s.length;  // свою каретку редактор сдвигает сам
}

type('При'); wait(100); type('вет');   // 100 мс между правками — одна запись
wait(600); type(', мир');              // пауза 600 мс — новая запись
bobInserts(0, 'Борис: ');
console.log(text.toString(), '| записей:', undo.undoStack.length);
undo.undo();
console.log(text.toString(), '| курсор:', cursor);
undo.undo();
console.log(text.toString(), '| курсор:', cursor);
undo.redo();
console.log(text.toString(), '| в redo:', undo.redoStack.length);`;

export const YJS_OUT = `Борис: Привет, мир | записей: 2
Борис: Привет | курсор: 13
Борис:  | курсор: 7
Борис: Привет | в redo: 1`;

export const YJS_FACTS = [
  {
    t: 'Транзакция — не граница записи',
    d: 'Всё внутри одного `transact` — одна запись. Но две транзакции ближе `captureTimeout` всё равно сольются: `type(\'При\')` и `type(\'вет\')` выше — две транзакции и одна запись. Отдельная запись — только после `undo.stopCapturing()`.',
  },
  {
    t: 'По умолчанию «своё» — без пометки',
    d: 'Без `trackedOrigins` менеджер отменяет правки с пометкой `null`. А `Y.applyUpdate(doc, update)` без третьего аргумента — это тоже `null`: правка с сервера попадёт в историю как своя, и Ctrl+Z сотрёт чужой текст.',
    tone: 'err' as const,
  },
  {
    t: 'Чужая правка redo не чистит',
    d: 'Стопку redo очищает только своя новая правка. Борис может печатать сколько угодно — Ctrl+Shift+Z у Ани по-прежнему вернёт отменённое.',
  },
];

export const GROUP_NOTE =
  'Курсор Yjs в записи не хранит — но даёт место для своего: событие `stack-item-added` срабатывает, когда запись создана, `stack-item-popped` — когда её сняли. Индекс 13 после первой отмены — это место перед «, мир» уже с учётом «Борис: » в начале: относительная позиция привязана к символу, а не к номеру.';

// ─── Раздел 5. В браузере ──────────────────────────────────────────────────────────────────

/**
 * Сценарии для `<textarea>`: Chromium 153 и учебная модель (`timeout: Infinity`).
 * Каждый элемент `chrome`/`model` — `[значение, selectionStart, selectionEnd]` после очередного
 * Ctrl+Z или Ctrl+Shift+Z. Пересобирается тестом в обоих столбцах.
 */
export const NATIVE_RUNS: NativeRun[] = [
  {
    id: 'run',
    label: 'набрать «hello world», Ctrl+Z ×2',
    acts: [['type', 'hello world'], ['undo'], ['undo']],
    chrome: [['', 0, 0], ['', 0, 0]],
    model: [['', 0, 0], ['', 0, 0]],
    note: 'всё набранное — одна запись: пробел слово не отделяет',
  },
  {
    id: 'pause',
    label: '«hello», пауза 1,5 с, « world», Ctrl+Z ×2',
    acts: [['type', 'hello'], ['wait', 1500], ['type', ' world'], ['undo'], ['undo']],
    chrome: [['', 0, 0], ['', 0, 0]],
    model: [['', 0, 0], ['', 0, 0]],
    note: 'пауза не делит запись: времени Chromium не учитывает',
  },
  {
    id: 'arrow',
    label: '«abc», ←, «X», Ctrl+Z ×2',
    acts: [['type', 'abc'], ['key', 'ArrowLeft'], ['type', 'X'], ['undo'], ['undo']],
    chrome: [['abc', 2, 2], ['', 0, 0]],
    model: [['abc', 2, 2], ['', 0, 0]],
    note: 'каретку сдвинули — новая запись',
  },
  {
    id: 'select-same',
    label: '«ab», `setSelectionRange(2, 2)`, «cd», Ctrl+Z ×2',
    acts: [['type', 'ab'], ['select', 2, 2], ['type', 'cd'], ['undo'], ['undo']],
    chrome: [['ab', 2, 2], ['', 0, 0]],
    model: [['ab', 2, 2], ['', 0, 0]],
    note: 'каретку поставили туда же, где она была, — запись всё равно закрыта',
  },
  {
    id: 'selection',
    label: '«hello world», выделить «world», Backspace, Ctrl+Z, Ctrl+Shift+Z',
    acts: [['type', 'hello world'], ['select', 6, 11], ['key', 'Backspace'], ['undo'], ['redo']],
    chrome: [['hello world', 6, 11], ['hello ', 6, 6]],
    model: [['hello world', 6, 11], ['hello ', 6, 6]],
    note: 'отмена вернула слово выделенным, повтор — каретку',
  },
  {
    id: 'overwrite',
    label: '«hello world», выделить «hello», «bye», Ctrl+Z ×2',
    acts: [['type', 'hello world'], ['select', 0, 5], ['type', 'bye'], ['undo'], ['undo']],
    chrome: [['hello world', 0, 5], ['', 0, 0]],
    model: [['hello world', 0, 5], ['', 0, 0]],
    note: 'набор поверх выделения — одна запись: удаление и вставка вместе',
  },
  {
    id: 'redo-cleared',
    label: '«ab», ←, →, «cd», Ctrl+Z, «X», Ctrl+Shift+Z, Ctrl+Z',
    acts: [['type', 'ab'], ['key', 'ArrowLeft'], ['key', 'ArrowRight'], ['type', 'cd'], ['undo'], ['type', 'X'], ['redo'], ['undo']],
    chrome: [['ab', 2, 2], ['abX', 3, 3], ['ab', 2, 2]],
    model: [['ab', 2, 2], ['abX', 3, 3], ['ab', 2, 2]],
    note: 'после «X» повторять нечего: новая правка очистила redo',
  },
  {
    id: 'backspaces',
    label: '«abc», Backspace ×2, Ctrl+Z ×2',
    acts: [['type', 'abc'], ['key', 'Backspace'], ['key', 'Backspace'], ['undo'], ['undo']],
    chrome: [['abc', 1, 3], ['', 0, 0]],
    model: [['abc', 3, 3], ['', 0, 0]],
    note: 'тексты совпали, выделение — нет: Chromium выделяет вернувшиеся символы, модель ставит каретку туда, где она была',
    tone: 'warn',
  },
  {
    id: 'del-then-type',
    label: '«ab», Backspace, «cd», Ctrl+Z ×2',
    acts: [['type', 'ab'], ['key', 'Backspace'], ['type', 'cd'], ['undo'], ['undo']],
    chrome: [['ab', 1, 2], ['', 0, 0]],
    model: [['a', 1, 1], ['ab', 2, 2]],
    note: 'Chromium дописывает набор в запись стирания, модель начинает новую: правило «по виду» у них разное',
    tone: 'warn',
  },
  {
    id: 'enter',
    label: '«ab», Enter, «cd», Ctrl+Z ×2',
    acts: [['type', 'ab'], ['key', 'Enter'], ['type', 'cd'], ['undo'], ['undo']],
    chrome: [['ab\nc', 4, 4], ['', 0, 0]],
    model: [['', 0, 0], ['', 0, 0]],
    note: 'Chromium режет запись после первого символа новой строки: первая отмена убрала только «d»',
    tone: 'warn',
  },
];

const showText = (v: string) => `«${v.replaceAll('\n', '⏎')}»`;
const showState = ([v, s, e]: [string, number, number]) => `${showText(v)} ${s === e ? s : `${s}–${e}`}`;

export const NATIVE_ROWS = NATIVE_RUNS.map((r) => ({
  k: r.label,
  chrome: r.chrome.map(showState).join(' → '),
  model: r.model.map(showState).join(' → '),
  d: r.note,
  tone: r.tone ?? ('ok' as const),
}));

export const NATIVE_NOTE =
  'После значения — `selectionStart`, а если выделение не пустое, то `selectionStart–selectionEnd`. Модель здесь — `createEditor({ timeout: Infinity })`: без времени, но с правилами «по виду» и «по месту». На семи сценариях из десяти она ведёт себя как Chromium; три расхождения — разные решения о том, где кончается запись, а не ошибки.';

/** Chromium 153, снято стендом и пересобирается тестом. */
export const NATIVE_FACTS = {
  /** Набрали «aa» в первом поле, «bb» во втором, вернули фокус в первое, Ctrl+Z, ещё Ctrl+Z. */
  shared: { first: 'aa', second: '', focus: 'u' },
  sharedAgain: { first: '', second: '', focus: 't' },
  /** `execCommand('insertText')` 1200 раз с переставленной кареткой, потом `execCommand('undo')` до упора. */
  depth: { undone: 1000, left: 200 },
  /** Поле с `value = 'preset'` и пустой историей, Ctrl+Z: какие события пришли. */
  emptyHistory: { value: 'preset', events: ['keydown'] },
  /**
   * «aa» во втором поле, «bb» в первом, код записал в первое `value = 'XYZ'`, фокус во второе,
   * Ctrl+Z ×2: `[первое, второе, где фокус]` после каждого.
   */
  deadStep: [['XYZ', 'aa', 't'], ['XYZ', '', 'u']] as [string, string, string][],
  /** «ab», `setRangeText('Q', 2, 2, 'end')`, «cd», Ctrl+Z ×3. */
  setRange: ['abQ', 'abQ', 'abQ'],
  /** Те же сценарии в `contenteditable`: run, arrow, backspaces, enter — тексты после Ctrl+Z. */
  ce: { run: ['', ''], arrow: ['abc', ''], backspaces: ['abc', ''], enter: ['ab\nc', ''] },
};

export const NATIVE_CARDS = [
  {
    t: 'Одна история на документ',
    d: `Набрали «aa» в одном поле, «bb» в другом, вернулись в первое и нажали Ctrl+Z. Отменилось «bb» — во **втором** поле, и фокус сам ушёл туда. Ещё одно Ctrl+Z — отменилось «aa», фокус вернулся. В Chromium история общая на страницу, а не своя у каждого поля.`,
    tone: 'warn' as const,
  },
  {
    t: `Не больше ${NATIVE_FACTS.depth.undone} записей`,
    d: `Из 1200 отдельных вставок \`execCommand('undo')\` снял ${NATIVE_FACTS.depth.undone}, ${NATIVE_FACTS.depth.left} символов остались. Старые записи вытесняются молча.`,
  },
  {
    t: 'Пустая история — нет `beforeinput`',
    d: 'Если отменять нечего, Ctrl+Z даёт только `keydown`: ни `beforeinput` с `historyUndo`, ни `input`. Своя история, которая ждёт `historyUndo`, в таком поле не услышит Ctrl+Z никогда.',
    tone: 'err' as const,
  },
  {
    t: '`setRangeText` обрывает историю',
    d: `Набрали «ab», код вставил «Q» через \`setRangeText\`, дальше набрали «cd». Ctrl+Z убрал «cd» и дальше срабатывал вхолостую: «abQ», «abQ». Всё, что было до \`setRangeText\`, отменить уже нельзя — как после записи \`value\`.`,
    tone: 'err' as const,
  },
  {
    t: '`contenteditable` — по тем же правилам',
    d: 'Набор, стрелка, Backspace и Enter в редактируемом `div` дали те же тексты после Ctrl+Z, что в `<textarea>`, включая странность с новой строкой. Правила группировки у них одни.',
  },
];

export const NATIVE_LINK_NOTE =
  'Что запись `value` из кода стирает историю поля, а `execCommand(\'insertText\')` кладёт правку в неё наравне с набором, разобрано в [«Вводе текста в браузере», раздел «Запись из кода»](/render/text-input/#s6). Здесь важно следствие: история браузера живёт, только пока поле правит **сам браузер**. Код, который записывает в поле изменённую строку — маска ввода, автозамена, перевод в верхний регистр, — ломает Ctrl+Z: записи в истории остаются, но отмена по ним ничего не возвращает. React и Vue сами по себе историю не ломают — они не трогают `value`, если в поле уже то же самое.';

/** Своя история поверх `<textarea>`. Тест запускает её в Chromium вместе с `HISTORY_CODE`. */
export const INTERCEPT_CODE = `// Своя история поверх <textarea>: браузерная остаётся пустой.
function attachHistory(field, ed) {
  const render = () => {
    field.value = ed.text;
    field.setSelectionRange(ed.sel[0], ed.sel[1]);
  };
  field.addEventListener('beforeinput', (e) => {
    if (e.isComposing) return;               // набор через IME не отменить — пропускаем
    e.preventDefault();                      // правку делает история, а не браузер
    const { selectionStart: s, selectionEnd: f } = field;
    if (s !== ed.sel[0] || f !== ed.sel[1]) ed.select(s, f);
    if (e.inputType === 'historyUndo') ed.undo();
    else if (e.inputType === 'historyRedo') ed.redo();
    else if (e.inputType === 'deleteContentBackward') ed.backspace(e.timeStamp);
    else if (e.inputType === 'insertLineBreak') ed.insert('\\n', e.timeStamp);
    else if (e.data != null) ed.insert(e.data, e.timeStamp);
    render();
  });
  // Браузерная история пуста — Ctrl+Z не дойдёт до beforeinput. Ловим клавишу.
  field.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) ed.redo();
    else ed.undo();
    render();
  });
}`;

/** Chromium 153: «При», пауза 0,7 с, «вет», Ctrl+Z, Ctrl+Z, Ctrl+Shift+Z — значения поля. */
export const INTERCEPT_RUN = ['При', '', 'При'];

export const INTERCEPT_NOTE = `Та же пауза, которую Chromium не замечает, своей истории хватает: «При» и «вет» с паузой 0,7 с стали двумя записями — Ctrl+Z дал ${INTERCEPT_RUN.map(showText).join(', ')}. Ветка \`historyUndo\` не даёт браузеру отменить что-то своё в обход истории, а клавиатуру ловит \`keydown\`: поле, в котором браузер ничего не правил сам, \`historyUndo\` не получает. Набор через IME сюда не входит: его шаг \`beforeinput\` отменить нельзя, слово забирают по \`compositionend\` ([«Ввод текста», раздел «IME»](/render/text-input/#s4)).`;

// ─── Раздел 6. Совместно ───────────────────────────────────────────────────────────────────

export const PLAIN_LOCAL_UNDO =
  'Как общий список покупок на холодильнике. Аня дописала «сыр», Борис сверху — «хлеб». Если Аня передумала, она вычёркивает свой «сыр», а не «последнюю строку списка»: последняя строка теперь Бориса.';

/** Аня: «Привет», пауза 0,6 с, «, мир»; Борис вставил «Борис: » в начало; Аня: Ctrl+Z, Ctrl+Z, Ctrl+Shift+Z. */
export const COLLAB_ROWS = [
  { k: 'снимки (`snapshots`)', u1: 'Привет', u2: '', r: 'Привет', d: 'снимок не знает о Борисе: первая же отмена стирает его текст', tone: 'err' as const },
  { k: 'правки без пересчёта (`naive`)', u1: 'Борис:ет, мир', u2: 'ет, мир', r: 'Приветет, мир', d: 'удаления бьют по старым номерам — по «Борис», а не по «, мир»', tone: 'err' as const },
  { k: 'правки с пересчётом (`ops`)', u1: 'Борис: Привет', u2: 'Борис: ', r: 'Борис: Привет', d: 'стопки сдвинуты на 7 символов вставки Бориса', tone: 'ok' as const },
  { k: '`Y.UndoManager`', u1: 'Борис: Привет', u2: 'Борис: ', r: 'Борис: Привет', d: 'итог `YJS_CODE` выше: позиций в записи нет вовсе', tone: 'ok' as const },
];

export const COLLAB_NOTE =
  'Обратная правка «удалить символ на месте 6» верна для текста, каким он был в момент правки. Борис вставил семь символов в начало — и место 6 теперь у него. Снимок ошибается грубее: он помнит весь текст и возвращает его целиком, вместе с тем, что Бориса в нём ещё нет.';

/** Пересчёт правки через чужую. Исполняется вместе с `HISTORY_CODE`. */
export const XFORM_CODE = `// a и b сделаны над одним и тем же текстом. Вернуть [a', b']:
// a' ложится на текст, где уже сделана b, а b' — где сделана a.
// null — правка потеряла смысл: её символ уже удалён.
function xform(a, b) {
  if (!a || !b) return [a, b];
  const at = (op, pos) => ({ ...op, pos });
  if (a.type === 'del' && b.type === 'del' && a.pos === b.pos) return [null, null];
  // b стоит левее a? Две вставки в одно место: левее остаётся a.
  const bFirst = b.pos < a.pos || (b.pos === a.pos && b.type === 'ins' && a.type === 'del');
  if (bFirst) return [at(a, a.pos + (b.type === 'ins' ? 1 : -1)), b];
  return [a, at(b, b.pos + (a.type === 'ins' ? 1 : -1))];
}

// Каретка или край выделения после чужой правки b.
// Чужая вставка ровно у каретки встаёт перед ней.
function shiftPos(p, b) {
  if (!b) return p;
  if (b.type === 'ins') return b.pos <= p ? p + 1 : p;
  return b.pos < p ? p - 1 : p;
}`;

export const XFORM_FACTS = [
  {
    t: 'Пересчёт идёт сверху вниз',
    d: 'Чужая правка `b` сделана над текущим текстом. Верхняя запись тоже применяется к текущему тексту — её сдвигаем через `b` напрямую. А для записи ниже `b` сначала пересчитывается через верхнюю: та запись относится к тексту, каким он станет после верхней отмены.',
  },
  {
    t: 'Съеденная правка выпадает',
    d: 'Борис стёр символ, который Аня когда-то вставила. Отменять её вставку больше нечего: `xform` возвращает `null`, и шаг пропускает её. Если съедена вся запись, `step` пропускает запись целиком — `Y.UndoManager` делает так же.',
  },
  {
    t: 'Это и есть OT',
    d: 'Функция `xform` — операционное преобразование в самом маленьком виде: два вида правок, по символу. В настоящих OT-редакторах правки длинные, видов больше, и правила для каждой пары — главный источник ошибок ([«CRDT», раздел «Сходимость»](/algorithms/crdt/#s1)).',
  },
];

/** Сверка `HISTORY_CODE` с `Y.UndoManager` (см. шапку). */
export const YJS_MATCH = { runs: 3000, actions: 40, same: 2996 };

export const YJS_MATCH_NOTE = `Случайные сценарии по ${YJS_MATCH.actions} действий: Аня набирает и стирает в разных местах, Борис вставляет и стирает свои символы, Аня жмёт Ctrl+Z и Ctrl+Shift+Z. Тексты учебной истории и \`Y.UndoManager\` совпали после каждого действия в ${YJS_MATCH.same.toLocaleString('ru-RU')} сценариях из ${YJS_MATCH.runs.toLocaleString('ru-RU')}. Остальные ${YJS_MATCH.runs - YJS_MATCH.same} — две вставки в одно место: Аня возвращает стёртое туда, где Борис только что вставил своё. Позиция у них одна, и порядок решает правило. У \`xform\` правило простое — отменяемое левее. Yjs смотрит, между какими символами стоял стёртый текст, включая уже удалённые ([«CRDT», раздел «Последовательность»](/algorithms/crdt/#s3)).`;

export const CRDT_UNDO_NOTE =
  '**`Y.UndoManager` ничего не пересчитывает.** Его запись — не «удалить на месте 6», а «удалить символы с такими-то id» и «вернуть символы с такими-то id». Id у символа постоянный, сколько бы Борис ни вставил левее, поэтому сдвигать нечего. Цена — удалённые символы нельзя выбросить: пока запись в стопке, Yjs держит их в документе, чтобы было что вернуть.';

// ─── Раздел 7. Дерево отмены ───────────────────────────────────────────────────────────────

export const PLAIN_TREE =
  'Как сохранения в игре с развилками. Вернулся к старому сохранению и пошёл по-другому — старая дорога не стёрта, на неё можно перейти. Линейная история — игра с одним слотом: новое сохранение затирает всё, что было после.';

export const TREE_ROWS = [
  {
    k: 'линия (браузер, большинство редакторов)',
    how: 'новая правка после отмены очищает redo',
    lost: 'всё отменённое — навсегда',
  },
  {
    k: 'дерево (Vim)',
    how: 'новая правка после отмены начинает ветку; старая ветка остаётся. `u` и `Ctrl-R` ходят по текущей ветке, `g-` и `g+` — по всем состояниям подряд, по времени; `:undolist` показывает концы веток, `:earlier 10m` возвращает текст десятиминутной давности',
    lost: 'ничего',
  },
  {
    k: 'отмена как правка (Emacs)',
    how: 'отмена сама записывается в историю как обычная правка. История только растёт, и отменённое достаётся отменой отмены. С Emacs 28 есть `undo-redo` — привычный повтор поверх той же истории',
    lost: 'ничего, но путь назад длинный',
  },
];

export const TREE_NOTE =
  'Дерево — та же стопка записей, у которой новая правка не отрезает старое будущее, а начинает рядом новое. Хранится оно так же: записи с обратными правками, только у каждой есть родитель и, возможно, несколько детей. Во фронтенде дерево встречается редко; ближе всего к нему путешествие во времени Redux DevTools: там хранится список действий и состояние после каждого, и можно встать на любое — но это по-прежнему линия, а не дерево.';

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

/** Что набрано в демо при открытии: то же, что у Ани в разделе «Совместно». */
export const DEMO_START: DemoStep[] = [
  { do: 'type', s: 'Привет' },
  { do: 'wait', ms: 600 },
  { do: 'type', s: ', мир' },
];

export const DEMO_CAPTION =
  'Считает `createEditor` из темы, время — настоящее, `timeout` 500 мс. Печатайте и стирайте: пауза, смена набора на стирание или клик в другое место открывают новую запись. Вставка Бориса в режиме снимков переживает только до первой отмены; в наивном — отмена бьёт по его символам; с пересчётом записи сдвигаются, а стёртые Борисом символы выпадают из них.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Маска ввода теряет Ctrl+Z',
    d: 'Код, который записывает в `value` изменённую строку (маска ввода, автозамена, нормализация), обрывает историю браузера: Ctrl+Z ничего не возвращает. Записи при этом остаются, только пустые, а история у Chromium общая на страницу. Ctrl+Z в **соседнем** поле сначала потратится на такую запись и перекинет фокус в поле с маской — и лишь второе нажатие отменит то, что хотели.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Своя история не слышит `historyUndo`',
    d: 'Если поле правит только ваш код, история браузера пуста, и Ctrl+Z не порождает `beforeinput`. Клавишу нужно ловить в `keydown`, а `historyUndo` оставить для меню «Правка».',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Обратная правка без удалённого текста',
    d: 'Для удаления мало запомнить «удалено 5 символов с места 3» — обратно вставлять будет нечего. В записи обязано лежать удалённое. То же у Immer: обратный патч к `remove` несёт удалённое значение.',
  },
  {
    n: '04',
    t: 'Обратные правки — с конца',
    d: 'Запись из нескольких правок отменяется в обратном порядке. Пройти с начала — значит сдвинуть позиции и удалить не те символы, причём без единой ошибки.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Снимок в совместном документе стирает чужое',
    d: 'Вернуть прошлую копию — значит вернуть и прошлое состояние чужих правок. В совместном редакторе отмена обязана быть правкой, а не сменой копии.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Пометка `null` в Yjs — тоже «своя»',
    d: '`Y.UndoManager` без `trackedOrigins` отменяет правки с пометкой `null`. Обновление с сервера, применённое `applyUpdate` без третьего аргумента, попадает в историю как своё.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Группировка у браузеров своя',
    d: 'Chromium склеивает набор до перестановки каретки и не смотрит на время; набор после стирания дописывает в ту же запись. Firefox и Safari здесь не сняты — их правила могут быть другими. Если важно, где кончается запись, история нужна своя.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Выделение — тоже часть записи',
    d: 'Отмена, которая вернула текст, но оставила каретку где-то в конце, ощущается сломанной. Выделение до правки хранят в записи; в совместном редакторе — относительной позицией, иначе его сдвинет чужая правка.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Yjs — Y.UndoManager',
    href: 'https://docs.yjs.dev/api/undo-manager',
    what: '`captureTimeout`, `trackedOrigins`, `stopCapturing`, `meta` в записи; версия 13.6.33 на стенде',
  },
  {
    title: 'Immer — Patches',
    href: 'https://immerjs.github.io/immer/patches',
    what: '`produceWithPatches`, `applyPatches`, обратные патчи; версия 11.1.18 на стенде',
  },
  {
    title: 'W3C — Input Events Level 2',
    href: 'https://w3c.github.io/input-events/',
    what: '`beforeinput`, `inputType` `historyUndo` и `historyRedo`',
  },
  {
    title: 'MDN — Document.execCommand()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand',
    what: '`insertText`, `undo`, `redo`; помечен устаревшим, но работает',
  },
  {
    title: 'Chromium — undo_stack.cc',
    href: 'https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/editing/commands/undo_stack.cc',
    what: 'история правок Blink и её предел глубины',
  },
  {
    title: 'Redux — Implementing Undo History',
    href: 'https://redux.js.org/usage/implementing-undo-history',
    what: 'история на снимках: `past`, `present`, `future`',
  },
  {
    title: 'Vim — undo.txt',
    href: 'https://vimhelp.org/undo.txt.html',
    what: 'дерево отмены, `g-`, `g+`, `:undolist`, `:earlier`',
  },
  {
    title: 'GNU Emacs Manual — Undo',
    href: 'https://www.gnu.org/software/emacs/manual/html_node/emacs/Undo.html',
    what: 'отмена как правка, `undo-redo`',
  },
];

export const RELATED =
  'Смежное на сайте: [CRDT](/algorithms/crdt/) — id символов, надгробия и почему копии сходятся. [Ввод текста в браузере, раздел «Запись из кода»](/render/text-input/#s6) — что `value`, `setRangeText` и `execCommand` делают с полем. [Как редактор хранит текст, раздел «Piece table»](/algorithms/text-buffers/#s4) — снимок как копия списка кусков. [Стейт-менеджеры изнутри, раздел «Redux»](/frameworks/state-managers/#s2) — Immer и общие ветки. [Формы во фреймворках, раздел «Каретка»](/frameworks/forms/#s4) — почему контролируемое поле теряет каретку. [Diff](/algorithms/diff/) — как получить правки из двух готовых версий, если их не записывали.';
