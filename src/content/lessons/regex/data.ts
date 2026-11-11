import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { GrowthSet, TraceExample } from '@/widgets/regex-lab/model/types';
import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';

/**
 * Данные темы «Регулярные выражения изнутри: откаты и ReDoS».
 *
 * Тема написана 2026-10-01. ReDoS и замеры перебора раскрываются здесь.
 * Блокировка цикла событий тяжёлой синхронной работой — «Цикл событий Node»,
 * раздел «Между колбэками» (`/js/node-event-loop/#s3`); просмотр назад в старых движках и что с ним делают
 * Babel и esbuild — «Транспиляция и полифилы», раздел «Чего не сделать»
 * (`/tooling/transpilation/#s5`). Тема идёт глубже: как движок с откатами перебирает варианты
 * (учебная реализация с журналом), откуда берётся 2ⁿ, как это становится уязвимостью сервера,
 * что лечит и что нет, линейный движок V8 и ловушки флагов.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0**, V8 **13.6.233.10-node.28**, macOS arm64, октябрь 2026. Каталог стенда —
 * `scratchpad/agent-regex/`. Таймерных замеров нет: время в теме не меряется, а считается.
 *
 *   — «шаги» — это проверки учебного движка (`MATCH_CODE`): один атом шаблона против одной
 *     позиции строки. У настоящего Irregexp счётчика нет: `--trace-regexp-bytecodes` в
 *     релизной сборке Node молчит (ноль строк вывода), поэтому кривая роста снята учебным
 *     движком, а настоящий V8 проверяется порогом;
 *   — порог: шаблон запускается в отдельном процессе `node` с ограничением времени. «Не
 *     уложился» — процесс убит по таймеру (на стенде 5 с, в тесте 8 с) на длине 40, где
 *     учебный движок насчитывает 3·2⁴⁰ + 40 ≈ 3,3·10¹² шагов; «уложился» — исправленный
 *     шаблон на длине 100 000 завершился и вернул ответ. Между ними — двенадцать порядков,
 *     поэтому под нагрузкой проверка не мигает;
 *   — учебный движок сверен с `RegExp` V8 (совпало или нет, индекс, все группы) почти на 30 000
 *     парах «случайный шаблон × случайная строка» (2000 шаблонов × 15 строк, минус пары, упёршиеся
 *     в лимит шагов; тест требует больше 29 000) и на ручном наборе — 0 расхождений;
 *   — линейный движок: `node --v8-options` перечисляет флаги
 *     `--enable-experimental-regexp-engine`, `--enable-experimental-regexp-engine-on-excessive-backtracks`
 *     и `--regexp-backtracks-before-fallback` (по умолчанию 50000). Что принимает флаг `l`,
 *     снято запуском (`LINEAR_SYNTAX_ROWS`). ⚠️ Расхождение с блогом V8 2021 года: там просмотр
 *     назад не поддержан, а в V8 13.6 `/(?<=\$)\d+/l` компилируется и находит то же, что
 *     обычный движок; отказ остаётся у просмотра вперёд, обратных ссылок, захвата внутри
 *     просмотра назад, флагов `i` и `u` и повтора `{2,30}`;
 *   — ярусы Irregexp: в Node 24.11 `--trace-regexp-tier-up` после первого `test` печатает только
 *     размер байткода, после второго — `needs tier-up compilation` и `native code size`. В Node 26.8.2
 *     (V8 14.6) флаг требует сборки с `v8_enable_regexp_diagnostics` и молчит; ярусы на обеих версиях
 *     показывают `%RegexpHasBytecode`/`%RegexpHasNativeCode` под `--allow-natives-syntax`: до вызова
 *     нет ничего, после первого — байткод, после второго — только машинный код;
 *   — сервер (`SERVER_CODE`): `node:http` на свободном порту, плохой запрос, затем `/?name=bob`
 *     с таймаутом — ответа нет; тот же сервер с исправленным шаблоном отвечает на оба.
 *
 * Только по документации, без запуска: RE2 (пакет `re2` в проекте не установлен), разборы
 * аварий Stack Overflow (2016) и Cloudflare (2019), `(?>…)` и притяжательные квантификаторы
 * в других движках.
 *
 * Всё перечисленное повторяет `tests/unit/regex.test.ts`: код примеров — эти же строки.
 * Демо (`widgets/regex-lab`) исполняет `PARSE_CODE` + `MATCH_CODE` и рядом спрашивает
 * `RegExp` браузера на той же строке.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'шаблон и строка',
    d: 'Шаблон — само регулярное выражение, `/^\\d+$/`. Строка — текст, в котором его ищут. «Совпадение» — кусок строки, который шаблон описал целиком.',
  },
  {
    k: 'квантификатор',
    d: 'Знак повтора после куска шаблона: `*` — сколько угодно, `+` — хотя бы раз, `?` — ноль или один, `{2,5}` — от двух до пяти. С `?` на конце (`+?`) он ленивый.',
  },
  {
    k: 'группа',
    d: '`(…)` объединяет кусок шаблона и запоминает, что он нашёл: это захват номер 1, 2… `(?:…)` объединяет без запоминания. `(?<имя>…)` — захват с именем.',
  },
  {
    k: 'обратная ссылка',
    d: '`\\1` внутри шаблона — «ровно тот текст, который нашла группа 1». `/(\\w)\\1/` находит две одинаковые буквы подряд.',
  },
  {
    k: 'просмотр вперёд и назад',
    d: '`(?=…)` проверяет, что дальше в строке стоит такой текст, но не забирает его. `(?!…)` — что не стоит. `(?<=…)` и `(?<!…)` — то же про текст перед позицией.',
  },
  {
    k: 'Irregexp',
    d: 'Движок регулярных выражений внутри V8 — то, что исполняет `RegExp` в Chrome и Node. Компилирует шаблон в байткод, а часто вызываемый — в машинный код.',
  },
];

export const PLAIN_BACKTRACK =
  'Как поиск выхода из лабиринта с мелом. На каждой развилке вы ставите метку и идёте в первый коридор. Упёрлись в тупик — возвращаетесь к последней метке и пробуете следующий коридор. Выход найдётся, если он есть. Но если развилок много и все коридоры кончаются тупиком, обойти придётся их все.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на привычный синтаксис регулярок. Если что-то незнакомо, начните со ссылки на карточке.';

export const PREREQ: Prereq[] = [
  {
    t: 'Синтаксис регулярок на уровне «читаю»',
    d: 'Что значат `\\d+`, `[a-z]`, `^…$`, `(…)` и `|`. Тема не учит писать регулярки — она объясняет, что движок делает с уже написанной.',
    tone: 'info',
  },
  {
    t: 'Один поток JavaScript',
    d: 'Пока синхронная функция работает, ни таймер, ни следующий запрос, ни клик не обрабатываются. Вызов `test` — синхронный: на всё время перебора поток занят.',
    href: '/js/node-event-loop/#s3',
    hrefLabel: '«Цикл событий Node», раздел «Между колбэками»',
    tone: 'info',
  },
  {
    t: 'Строка — это единицы UTF-16',
    d: '`length` считает 16-битные единицы: `😀` занимает две, а составные эмодзи могут занимать больше. От этого зависит, что для регулярки «один знак» — с флагом `u` и без него.',
    href: '/js/unicode-intl/#s1',
    hrefLabel: '«Unicode и Intl», раздел «Кодовые единицы и кодовые точки»',
    tone: 'info',
  },
  {
    t: 'Функция «что делать дальше»',
    d: 'Учебный движок написан на продолжениях: каждая его функция получает колбэк `k` — остаток работы. Это обычный колбэк, просто вызывается синхронно.',
    href: '/js/callbacks/#s2',
    hrefLabel: '«Колбэки», раздел «Передача»',
    tone: 'info',
  },
];

// ─── Раздел 1. Как движок ищет совпадение ──────────────────────────────────────────────────

export const FIRST_MATCH_CODE = `const pattern = /(a|ab)c/;
const result = pattern.exec('abc');
console.log(result[0]); // → "abc"
console.log(result[1]); // → "ab"`;

export const BACKTRACK_DIAGRAM: ConceptDiagramData = {
  id: 'regex-alternative-backtrack',
  title: 'Почему первая подходящая ветка ещё не даёт совпадение',
  description: 'Шаблон /(a|ab)c/ на строке abc. Ветка a подходит сама по себе, но оставшаяся часть c не подходит. После отката ветка ab позволяет закончить совпадение.',
  width: 880, height: 560,
  nodes: [
    { id: 'choice', x: 20, y: 200, width: 220, height: 160, label: '`(a|ab)c` на `abc`', detail: 'Сначала проверяется ветка `a`.', tone: 'neutral' },
    { id: 'first', x: 330, y: 32, width: 210, height: 160, label: '`a` совпала', detail: 'Позиция в строке: 1. Дальше нужен `c`.', tone: 'info' },
    { id: 'fail', x: 630, y: 32, width: 230, height: 160, label: '`c` встретил `b`', detail: 'Эту попытку закончить нельзя.', tone: 'err' },
    { id: 'second', x: 330, y: 368, width: 210, height: 160, label: 'Пробуем `ab`', detail: 'Возврат к началу группы. Теперь позиция: 2.', tone: 'warn' },
    { id: 'match', x: 630, y: 368, width: 230, height: 160, label: '`c` совпал', detail: 'Весь результат: `abc`. Группа 1: `ab`.', tone: 'ok' },
  ],
  edges: [
    { from: 'choice', to: 'first', via: [[280, 280], [280, 112]] },
    { from: 'first', to: 'fail' },
    { from: 'fail', to: 'second', fromSide: 'bottom', toSide: 'top', via: [[745, 280], [435, 280]], label: 'откат: не сошёлся остаток шаблона', labelX: 590, labelY: 252 },
    { from: 'second', to: 'match' },
  ],
  note: 'Откат отменяет текущий путь поиска и пробует следующий вариант. Успех отдельной группы ещё не означает успех всего шаблона.',
};

export const PARSE_CODE = String.raw`// ── Разбор шаблона в дерево ─────────────────────────────────
function parse(src) {
  let i = 0;
  let groups = 0;
  const peek = () => src[i];
  const eat = (ch) => (src[i] === ch ? (i++, true) : false);
  const fail = (why) => { throw new SyntaxError(why + ' в позиции ' + i); };

  function alt() {
    const start = i;
    const options = [seq()];
    while (eat('|')) options.push(seq());
    return options.length === 1 ? options[0] : { type: 'alt', options, start, end: i };
  }
  function seq() {
    const start = i;
    const items = [];
    while (i < src.length && peek() !== '|' && peek() !== ')') items.push(term());
    return { type: 'seq', items, start, end: i };
  }
  function term() {
    const start = i;
    const node = atom();
    let min, max;
    if (eat('*')) [min, max] = [0, Infinity];
    else if (eat('+')) [min, max] = [1, Infinity];
    else if (eat('?')) [min, max] = [0, 1];
    else if (peek() === '{' && /^\{\d+(,\d*)?\}/.test(src.slice(i))) {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      i += m[0].length;
      min = Number(m[1]);
      max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
    } else return node;
    if (node.type === 'look' || node.type === 'bol' || node.type === 'eol') fail('повтор у проверки');
    const greedy = !eat('?');
    return { type: 'repeat', body: node, min, max, greedy, caps: capsInside(node), start, end: i };
  }
  function atom() {
    const start = i;
    const ch = src[i++];
    if (ch === '(') {
      let kind = 'group';
      if (eat('?')) {
        if (eat(':')) kind = 'plain';
        else if (eat('=')) kind = 'ahead';
        else if (eat('!')) kind = 'not-ahead';
        else fail('неизвестная группа');
      }
      const index = kind === 'group' ? ++groups : 0;
      const body = alt();
      if (!eat(')')) fail('нет закрывающей скобки');
      if (kind === 'group') return { type: 'group', index, body, start, end: i };
      if (kind === 'plain') return { type: 'plain', body, start, end: i };
      return { type: 'look', negate: kind === 'not-ahead', body, start, end: i };
    }
    if (ch === '[') return cls(start);
    if (ch === '.') return { type: 'char', test: (c) => !'\n\r\u2028\u2029'.includes(c), start, end: i };
    if (ch === '^') return { type: 'bol', start, end: i };
    if (ch === '$') return { type: 'eol', start, end: i };
    if (ch === '\\') {
      if (/[1-9]/.test(peek())) return { type: 'backref', index: Number(src[i++]), start, end: i };
      if (eat('b')) return { type: 'boundary', start, end: i };
      const one = escape(src[i++]);
      return { type: 'char', test: typeof one === 'string' ? (c) => c === one : one, start, end: i };
    }
    if (ch === undefined || '*+?)'.includes(ch)) fail('неожиданный знак');
    return { type: 'char', test: (c) => c === ch, start, end: i };
  }
  function cls(start) {
    const negate = eat('^');
    const parts = [];
    while (peek() !== ']') {
      if (i >= src.length) fail('нет закрывающей ]');
      const one = src[i] === '\\' ? (i++, escape(src[i++])) : src[i++];
      if (typeof one === 'string' && peek() === '-' && src[i + 1] !== ']' && src[i + 1] !== undefined) {
        i++;
        const to = src[i] === '\\' ? (i++, escape(src[i++])) : src[i++];
        if (typeof to !== 'string') fail('диапазон до класса');
        parts.push((c) => c >= one && c <= to);
      } else parts.push(typeof one === 'string' ? (c) => c === one : one);
    }
    i++;
    const hit = (c) => parts.some((p) => p(c));
    return { type: 'char', test: negate ? (c) => !hit(c) : hit, start, end: i };
  }
  const run = alt();
  if (i < src.length) fail('лишняя )');
  return { root: run, groups };
}

const SPACE = ' \t\n\v\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const isWord = (c) => /[A-Za-z0-9_]/.test(c ?? '');
const NAMED = {
  d: (c) => c >= '0' && c <= '9', w: isWord, s: (c) => SPACE.includes(c),
  n: '\n', t: '\t', r: '\r',
};
// \d \w \s и их отрицания — проверки; \n \t \r и экранированный знак — сам знак.
function escape(ch) {
  if (ch === undefined || (/[A-Za-z0-9]/.test(ch) && !'dwsDWSntr'.includes(ch))) {
    throw new SyntaxError('экранирование \\' + ch + ' учебный движок не знает');
  }
  const lower = ch.toLowerCase();
  if ('dws'.includes(lower) && ch !== lower) return (c) => !NAMED[lower](c);
  return NAMED[ch] ?? ch;
}
function capsInside(node) {
  const out = [];
  (function walk(n) {
    if (n.type === 'group') out.push(n.index);
    for (const k of ['body']) if (n[k]) walk(n[k]);
    for (const k of ['items', 'options']) if (n[k]) n[k].forEach(walk);
  })(node);
  return out;
}`;

export const MATCH_CODE = String.raw`// ── Сопоставление с откатами ────────────────────────────────
// Состояние — позиция в строке и захваты групп. Каждая функция получает
// продолжение k: «что сопоставлять дальше». Вернуть null — значит
// «здесь не вышло», и управление уходит к последней точке выбора.
function match(source, input, { limit = Infinity, log = 0 } = {}) {
  const { root, groups } = parse(source);
  let steps = 0;
  let backtracks = 0;
  const journal = [];
  const note = (kind, node, pos, ok, text) => {
    if (journal.length < log) journal.push({ step: steps, kind, at: [node.start, node.end], pos, ok, text });
  };
  const STOP = {};

  // Одна проверка атома в позиции — один шаг.
  function check(node, pos, ok, text) {
    steps++;
    if (steps > limit) throw STOP;
    note('check', node, pos, ok, text);
    return ok;
  }

  function m(node, s, k) {
    switch (node.type) {
      case 'char': {
        const c = input[s.pos];
        if (!check(node, s.pos, c !== undefined && node.test(c), 'знак')) return null;
        return k({ pos: s.pos + 1, caps: s.caps });
      }
      case 'bol': return check(node, s.pos, s.pos === 0, 'начало') ? k(s) : null;
      case 'eol': return check(node, s.pos, s.pos === input.length, 'конец') ? k(s) : null;
      case 'boundary': {
        const ok = isWord(input[s.pos - 1]) !== isWord(input[s.pos]);
        return check(node, s.pos, ok, 'граница слова') ? k(s) : null;
      }
      case 'backref': {
        const cap = s.caps[node.index];
        const text = cap ? input.slice(cap[0], cap[1]) : '';
        const ok = input.startsWith(text, s.pos);
        if (!check(node, s.pos, ok, 'обратная ссылка')) return null;
        return k({ pos: s.pos + text.length, caps: s.caps });
      }
      case 'seq': return seq(node.items, 0, s, k);
      case 'plain': return m(node.body, s, k);
      case 'group':
        return m(node.body, s, (after) => {
          const caps = after.caps.slice();
          caps[node.index] = [s.pos, after.pos];
          return k({ pos: after.pos, caps });
        });
      case 'alt':
        for (let n = 0; n < node.options.length; n++) {
          if (n > 0) back(node, s.pos, 'ветка ' + n + ' не подошла — пробуем ' + (n + 1));
          const r = m(node.options[n], s, k);
          if (r) return r;
        }
        return null;
      case 'look': {
        // Просмотр вперёд атомарен: найденное внутри не перебирается снова.
        const inner = m(node.body, s, (x) => x);
        if (node.negate) return inner ? null : k(s);
        return inner ? k({ pos: s.pos, caps: inner.caps }) : null;
      }
      case 'repeat': return repeat(node, node.min, node.max, s, k);
    }
  }

  function seq(items, n, s, k) {
    if (n === items.length) return k(s);
    return m(items[n], s, (next) => seq(items, n + 1, next, k));
  }

  function repeat(node, min, max, s, k) {
    if (max === 0) return k(s);
    const once = () => {
      const caps = s.caps.slice();
      for (const g of node.caps) caps[g] = undefined; // каждый повтор — с чистыми группами
      return m(node.body, { pos: s.pos, caps }, (after) => {
        if (min === 0 && after.pos === s.pos) return null; // пустой повтор не считается
        return repeat(node, Math.max(0, min - 1), max - 1, after, k);
      });
    };
    if (min > 0) return once();
    if (node.greedy) {
      const r = once();
      if (r) return r;
      back(node, s.pos, 'ещё один повтор не вышел — идём дальше без него');
      return k(s);
    }
    const r = k(s);
    if (r) return r;
    back(node, s.pos, 'дальше без повтора не вышло — берём ещё один');
    return once();
  }

  function back(node, pos, text) {
    backtracks++;
    note('back', node, pos, false, text);
  }

  try {
    // Стартовые позиции — по очереди, даже если шаблон начинается с ^:
    // учебный движок не знает ни одного приёма ускорения.
    for (let start = 0; start <= input.length; start++) {
      const end = m(root, { pos: start, caps: [] }, (x) => x);
      if (end) {
        const found = [input.slice(start, end.pos)];
        for (let g = 1; g <= groups; g++) {
          const c = end.caps[g];
          found.push(c ? input.slice(c[0], c[1]) : undefined);
        }
        return { match: { index: start, groups: found }, steps, backtracks, journal, stopped: false };
      }
      if (start < input.length) note('start', root, start + 1, false, 'со старта ' + start + ' совпадения нет — пробуем с ' + (start + 1));
    }
    return { match: null, steps, backtracks, journal, stopped: false };
  } catch (e) {
    if (e !== STOP) throw e;
    return { match: null, steps, backtracks, journal, stopped: true };
  }
}`;

export const MATCH_NOTE =
  'Продолжение `k` — колбэк, который проверяет оставшуюся часть шаблона. Жадный повтор сперва пробует ещё одну итерацию и передаёт ей остаток работы. Если остаток не сошёлся, вызов возвращает `null`, и повтор пробует второй вариант — идти дальше без этой итерации. Отдельного стека развилок в коде нет: куда возвращаться, помнит обычный стек вызовов JS.';

export const TRACE_EXAMPLES: TraceExample[] = [
  {
    id: 'alt',
    label: 'ветки',
    pattern: '(a|ab)c',
    input: 'abc',
    note: 'Первая ветка `a` подходит, но `c` после неё натыкается на `b`. Движок возвращается к развилке в группе и пробует вторую ветку `ab` — теперь `c` встаёт на место. В группе 1 оказывается `ab`.',
  },
  {
    id: 'greedy',
    label: 'жадный',
    pattern: '<.+>',
    input: '<b>жирный</b>',
    note: '`.+` съедает строку до конца, потом `>` не находит ничего — и повтор отдаёт по одному знаку, пока `>` не встанет на место. Совпадение — вся строка целиком.',
  },
  {
    id: 'lazy',
    label: 'ленивый',
    pattern: '<.+?>',
    input: '<b>жирный</b>',
    note: '`.+?` берёт один знак и сразу проверяет `>`. Подошло — готово: три шага, совпадение `<b>`.',
  },
  {
    id: 'bad',
    label: '(a+)+ на «aaaa!»',
    pattern: '^(a+)+$',
    input: 'aaaa!',
    note: 'Ответ «нет совпадения» очевиден человеку сразу: в конце `!`. Движок доказывает его перебором всех способов разрезать `aaaa` на группы. Попробуйте добавить в строку одну `a` — шагов станет почти вдвое больше.',
  },
  {
    id: 'fixed',
    label: 'a+ на «aaaa!»',
    pattern: '^a+$',
    input: 'aaaa!',
    note: 'Тот же ответ без вложенного повтора: `a+` отдаёт знаки по одному, и для каждого `$` проверяется один раз. Каждая лишняя `a` — плюс три шага, а не удвоение.',
  },
];

export const TRACE_CAPTION =
  'Журнал считает работу учебного движка; это не счётчик внутренних инструкций V8. Каждая проверка одного атома шаблона в одной позиции строки — это шаг. Каждый возврат к развилке — откат. Для сверки показан ответ `RegExp` вашего браузера на той же строке: индекс и группы у них должны совпасть. Приёмов ускорения учебный движок не знает и пробует каждую стартовую позицию, даже если шаблон начинается с `^`.';

export const TRACE_LIMIT = 2_000_000;

export const IRREGEXP_FACTS = [
  {
    t: 'Результат тот же, внутренняя работа отличается',
    d: 'Irregexp — тоже движок с откатами. Он переводит шаблон в байткод, а не в дерево, и держит точки выбора в своём стеке, а не в стеке вызовов JS. Спецификация задаёт, какое совпадение и какие группы получаются. Оптимизации могут пропускать заведомо бесполезные проверки; точное число шагов учебной модели переносить на V8 нельзя.',
  },
  {
    t: 'Первый вызов — байткод, второй — машинный код',
    d: 'В Node 24 это видно с флагом `--trace-regexp-tier-up`: после первого `test` шаблон `/^(a+)+$/` живёт байткодом на 312 байт, на втором вызове V8 пишет `needs tier-up compilation` и компилирует его в машинный код. В Node 26 флаг в обычной сборке молчит, но ярусы те же: после второго вызова байткода у шаблона уже нет, остался машинный код. Ярусы исполнения сами по себе не устраняют экспоненциальный рост у этого шаблона. Число проверок модели не равно числу инструкций машинного кода.',
  },
  {
    t: 'Порядок вариантов — часть ответа',
    d: '`/a|ab/.exec("ab")` даёт `a`, а не `ab`. Движок с откатами возвращает **первый** подошедший вариант в своём порядке обхода, а не самый длинный. Поэтому оптимизатор не может свободно переставлять ветки — от этого изменится ответ.',
  },
];

// ─── Раздел 2. Жадные и ленивые ────────────────────────────────────────────────────────────

export const GREEDY_CODE = `const html = '<b>жирный</b> и <i>курсив</i>';
console.log(html.match(/<.+>/)[0]);    // → "<b>жирный</b> и <i>курсив</i>"
console.log(html.match(/<.+?>/)[0]);   // → "<b>"
console.log(html.match(/<[^>]+>/)[0]); // → "<b>"`;

export const PLAIN_GREEDY =
  'Жадный повтор похож на человека, который захватил всю стопку листов, а затем возвращает лишние по одному. Ленивый берёт по листу и после каждого проверяет, достаточно ли. Так же `.+` сначала занимает весь доступный текст, а `.+?` сначала пробует продолжить шаблон после одного знака.';

export const GREEDY_ROWS = [
  { p: '`<.+>`', steps: '32', back: '2', found: 'вся строка', tone: 'warn' as const },
  { p: '`<.+?>`', steps: '3', back: '0', found: '`<b>`', tone: 'ok' as const },
  { p: '`<[^>]+>`', steps: '4', back: '1', found: '`<b>`', tone: 'ok' as const },
];

export const GREEDY_NOTE =
  '**Ленивый повтор не спасает от долгого перебора.** Смена порядка не устраняет неоднозначность вложенных повторов. `/^(a+?)+$/` на строке из двадцати `a` и `!` делает те же 3 145 748 шагов, что и жадный `/^(a+)+$/`. Помогает другое — класс `[^>]`: он не может съесть `>`, поэтому гадать, где кончится повтор, движку не приходится.';

// ─── Раздел 3. Катастрофический откат ─────────────────────────────────────────────────────

export const SPLITS_NOTE =
  'Строку `aaaa` можно разрезать на непустые куски восемью способами: `aaaa`, `aaa|a`, `aa|aa`, `aa|a|a`, `a|aaa`, `a|aa|a`, `a|a|aa`, `a|a|a|a`. Для строки из n букв способов 2ⁿ⁻¹: между соседними буквами разрез либо есть, либо нет. Шаблон `(a+)+` описывает **каждый** из этих способов — и на строке `aaaa!` движок обязан проверить все, прежде чем сказать «нет».';

export const STEPS_ROWS = [
  { n: '5', bad: '101', fixed: '18' },
  { n: '10', bad: '3 082', fixed: '33' },
  { n: '15', bad: '98 319', fixed: '48' },
  { n: '20', bad: '3 145 748', fixed: '63' },
];

export const STEPS_NOTE =
  'Число шагов учебного движка на строке из n букв `a` и `!` в конце — ровно 3·2ⁿ + n у `/^(a+)+$/` и 3n + 3 у `/^a+$/`. Каждая новая буква удваивает работу. На длине 40 это около 3,3·10¹² шагов в учебной модели. Настоящий V8 проверялся отдельно: плохой шаблон не закончил за восемь секунд, а `/^a+$/` на строке в 100 000 букв уложился в тот же лимит.';

export const GROWTH_SETS: GrowthSet[] = [
  {
    id: 'nested',
    label: '(a+)+',
    unit: 'a',
    tail: '!',
    series: [
      { pattern: '^(a+)+$', label: '/^(a+)+$/', bad: true },
      { pattern: '^a+$', label: '/^a+$/', bad: false },
      { pattern: '^(?:(?=(a+))\\1)+$', label: '/^(?:(?=(a+))\\1)+$/', bad: false },
    ],
    note: 'Вложенный повтор: группа `a+` повторяется `+`. Исправления — убрать внешний повтор или сделать внутренний атомарным через просмотр вперёд и обратную ссылку.',
  },
  {
    id: 'words',
    label: '(\\w+\\s?)*',
    unit: 'a',
    tail: '!',
    series: [
      { pattern: '^(\\w+\\s?)*$', label: '/^(\\w+\\s?)*$/', bad: true },
      { pattern: '^(?:\\w+\\s)*\\w*$', label: '/^(?:\\w+\\s)*\\w*$/', bad: false },
    ],
    note: '«Слова через необязательный пробел» — тот же вложенный повтор, только его труднее заметить. Пробел необязателен, значит `aaaa` можно считать одним словом или четырьмя. В исправленном шаблоне пробел обязателен внутри повтора, и способ разрезать строку остаётся один.',
  },
  {
    id: 'alt',
    label: '(a|a)*',
    unit: 'a',
    tail: '!',
    series: [
      { pattern: '^(a|a)*$', label: '/^(a|a)*$/', bad: true },
      { pattern: '^a*$', label: '/^a*$/', bad: false },
    ],
    note: 'Ветки, которые совпадают с одним и тем же текстом. В жизни это `(\\d|\\w)+`: цифра подходит под обе ветки, значит, у каждой цифры два пути. На неудачной строке движок пройдёт все 2ⁿ сочетаний.',
  },
];

export const GROWTH_CAPTION =
  'Шкала шагов логарифмическая: прямая линия на ней — это рост в одинаковое число раз на каждую букву. У плохого шаблона линия идёт вверх под углом — удвоение на букву. У исправленного она почти горизонтальна: плюс несколько шагов на букву.';

export const POLY_NOTE =
  'Бывает и рост помедленнее. `/\\s+$/` на строке из n пробелов и буквы в конце даёт n² + 2n + 2 шага: 10 202 на сотне пробелов, 40 402 на двухстах. Вложенного повтора нет, но движок пробует каждую стартовую позицию, и с каждой `\\s+` бежит до буквы. Квадратичный рост слабее экспоненциального: сорока знаков ему мало, но длинная строка занимает сервер надолго. Так в 2016 году лёг Stack Overflow: шаблон обрезки пробелов `^[\\s\\u200c]+|[\\s\\u200c]+$` встретил комментарий примерно с двадцатью тысячами пробелов подряд.';

export const FAMILY_ROWS = [
  { k: 'повтор внутри повтора', ex: '`(a+)+`, `(a*)*`, `(\\w+\\s?)*`', why: 'одну строку можно разрезать на итерации многими способами', tone: 'err' as const },
  { k: 'ветки с общим текстом', ex: '`(a|a)*`, `(\\d|\\w)+`', why: 'на каждой букве две дороги', tone: 'err' as const },
  { k: 'соседние повторы одного класса', ex: '`\\d+\\d+$`', why: 'граница между ними может стоять где угодно: рост полиномиальный', tone: 'warn' as const },
  { k: 'повтор без якоря в начале', ex: '`\\s+$`', why: 'каждая стартовая позиция начинает перебор заново: n²', tone: 'warn' as const },
];

// ─── Раздел 4. ReDoS ──────────────────────────────────────────────────────────────────────

export const SERVER_CODE = `import { createServer } from 'node:http';

// «Имя: слова через пробел» — тот самый вложенный повтор.
const NAME = /^(\\w+\\s?)*$/;

createServer((req, res) => {
  const name = new URL(req.url, 'http://x').searchParams.get('name') ?? '';
  res.end(NAME.test(name) ? 'ok' : 'bad name');
}).listen(0, function () {
  console.log(this.address().port);
});`;

export const ATTACK_CODE = `// Запрос злоумышленника: сорок букв и знак, на котором шаблон проваливается.
fetch(\`http://localhost:\${port}/?name=\${'a'.repeat(40)}!\`).catch(() => {});
await new Promise((r) => setTimeout(r, 1000)); // пусть он дойдёт первым

// Любой другой запрос после него — ответа не будет.
await fetch(\`http://localhost:\${port}/?name=bob\`, { signal: AbortSignal.timeout(8000) });
// → TimeoutError`;

export const PLAIN_REDOS =
  'Как кассир, которому дали пересчитать мешок мелочи. Пока он считает, очередь стоит — даже те, кому нужно просто пробить хлеб. Злоумышленнику не нужно много запросов: одного мешка хватает, чтобы касса встала.';

export const REDOS_FACTS = [
  {
    t: 'Один запрос — весь сервер',
    d: 'Обработчики этого сервера выполняются в одном потоке JavaScript. Пока `test` перебирает варианты, другие обработчики, JS-проверки живости и вызовы логирования ждут. ОС и фоновые потоки могут продолжать свою работу. Снаружи это выглядит как зависший процесс, а не как медленный запрос.',
    tone: 'err' as const,
  },
  {
    t: 'Защиты по времени нет',
    d: 'У `RegExp` нет ни таймаута, ни отмены: ни `AbortSignal`, ни лимита шагов. Остановить начавшийся перебор изнутри процесса нельзя — только убить поток или процесс целиком.',
    tone: 'err' as const,
  },
  {
    t: 'В браузере — зависшая вкладка',
    d: 'Тот же шаблон в валидации формы повесит главный поток страницы: она перестанет отвечать на клики и перерисовываться. Непосредственно занят поток этой страницы; на сервере такой вызов задерживает запросы всех клиентов, обслуживаемых тем же потоком. Но вставить длинную строку в поле формы может кто угодно.',
    tone: 'warn' as const,
  },
];

export const SOURCES_OF_REDOS = [
  {
    t: 'Свои валидаторы',
    d: 'Имя, e-mail, адрес, «слова через пробел». Шаблон проходит все тесты на правильных строках и ломается только на почти правильной — на той, где совпадение срывается в самом конце.',
  },
  {
    t: 'Шаблон из ввода пользователя',
    d: '`new RegExp(query)` в поиске отдаёт пользователю целый язык программирования: он пришлёт `(a+)+$` сам. Строку из ввода сначала экранируют — `RegExp.escape`, в Node 24 он есть.',
  },
  {
    t: 'Чужие зависимости',
    d: 'Парсеры дат, user-agent, markdown и цветов живут на регулярках. Отчёты о ReDoS в пакетах npm — обычное дело; `npm audit` их показывает. Как защищаться от уязвимых зависимостей — [«Безопасность бэкенда», раздел «Цепочка поставок»](/platform/backend-security/#s6).',
  },
];

export const ESCAPE_CODE = `const query = '(a+)+$';                 // пришло из поля поиска
const safe = new RegExp(RegExp.escape(query));
console.log(safe.source);                 // → "\\\\(a\\\\+\\\\)\\\\+\\\\$"
console.log(safe.test('ищу (a+)+$ в тексте')); // → true`;

// ─── Раздел 5. Как лечить ─────────────────────────────────────────────────────────────────

export const FIX_ROWS = [
  { bad: '`^(a+)+$`', fixed: '`^a+$`', how: 'внешний повтор ничего не добавляет — убрать' },
  { bad: '`^(\\w+\\s?)*$`', fixed: '`^(?:\\w+\\s)*\\w*$`', how: 'разделитель внутри повтора обязателен: у строки один способ разрезания' },
  { bad: '`^(a|a)*$`', fixed: '`^a*$`', how: 'две одинаковые ветки заменены одним вариантом' },
  { bad: '`<.+>` для тегов', fixed: '`<[^>]+>`', how: 'класс не может съесть закрывающий знак' },
];

export const FIX_NOTE =
  'Правило одно: **сократите число способов описать один и тот же текст, особенно внутри повторов.** Если один и тот же кусок могут съесть два повтора, две ветки или две итерации одного повтора, на неудачной строке движок переберёт все их сочетания. Первые три исправления сохраняют условие проверки строки — тест сверяет это на всех строках из `a`, пробела и `!` до восьми знаков. Последняя строка таблицы намеренно меняет результат поиска: вместо всего текста между крайними скобками находит один фрагмент до ближайшего `>`. Для разбора HTML нужен HTML-парсер.';

export const ATOMIC_CODE = `// Плохо: внутренний a+ можно перебирать заново.
const bad = /^(a+)+$/;

// Атомарная группа: просмотр вперёд нашёл самый длинный a+,
// обратная ссылка \\1 забрала ровно его. Внутрь просмотра движок
// не возвращается — другой длины у этого куска не бывает.
const atomic = /^(?:(?=(a+))\\1)+$/;

console.log(atomic.test('aaaa'));                 // → true
console.log(atomic.test('a'.repeat(100000) + '!')); // → false`;

export const PLAIN_ATOMIC =
  'Как подпись под договором. Пока вы читаете черновик, можно передумать и переписать пункт. Подписанный лист уже не переписывают: если дальше что-то не сходится, договор отклоняют целиком, а не правят подпись. Просмотр вперёд — это подпись: нашёл кусок один раз, и пересматривать его движок не станет.';

export const ATOMIC_NOTE =
  'В PCRE, Java и .NET для этого есть атомарная группа `(?>a+)` и притяжательный повтор `a++`. В JavaScript их нет; у V8 есть флаг `--regexp-possessive-quantifier`, но в списке опций он помечен «для тестов». Приём с `(?=(…))\\1` использует стандартный синтаксис JavaScript; его цена — одна лишняя группа в нумерации захватов.';

export const LIMIT_NOTE =
  '**Ограничить длину входа — полезно, но мало.** У учебного квадратичного примера тысяча знаков даёт около миллиона проверок. Приемлема ли такая работа, зависит от потока запросов и конкретного движка. При экспоненциальном лимит пришлось бы ставить совсем маленьким: 3·2ⁿ шагов при n = 30 — это уже три миллиарда. Проверка `if (s.length > 64) return false` до вызова `test` — правильная привычка, но вместо исправления шаблона она не годится.';

export const LINEAR_ROWS: { label: string; flags: string[]; code: string; verdict: string; ok: boolean }[] = [
  {
    label: '`/^(a+)+$/` — обычный движок',
    flags: [],
    code: "/^(a+)+$/.test('a'.repeat(40) + '!')",
    verdict: 'не уложился в лимит',
    ok: false,
  },
  {
    label: '`/^a+$/` и `/^(?:(?=(a+))\\1)+$/` — исправленные',
    flags: [],
    code: "[/^a+$/, /^(?:(?=(a+))\\1)+$/].map((r) => r.test('a'.repeat(100000) + '!'))",
    verdict: 'уложились: `[false, false]`',
    ok: true,
  },
  {
    label: '`/^(a+)+$/l` — линейный движок',
    flags: ['--enable-experimental-regexp-engine'],
    code: "/^(a+)+$/l.test('a'.repeat(40) + '!')",
    verdict: 'уложился: `false`',
    ok: true,
  },
  {
    label: '`/^(a+)+$/` — подмена при лишних откатах',
    flags: ['--enable-experimental-regexp-engine-on-excessive-backtracks'],
    code: "/^(a+)+$/.test('a'.repeat(40) + '!')",
    verdict: 'уложился: `false`',
    ok: true,
  },
  {
    label: '`/^(["\'])(\\w+\\s?)*\\1$/` — та же подмена, но в шаблоне `\\1`',
    flags: ['--enable-experimental-regexp-engine-on-excessive-backtracks'],
    code: "/^([\"'])(\\w+\\s?)*\\1$/.test('\"' + 'a'.repeat(40) + '!')",
    verdict: 'не уложился: подменять нечем',
    ok: false,
  },
];

export const LINEAR_SYNTAX_ROWS: { src: string; flags: string; accepted: boolean }[] = [
  { src: '(a+)+$', flags: 'l', accepted: true },
  { src: '(?<y>\\d{4})', flags: 'l', accepted: true },
  { src: 'a{2,5}', flags: 'l', accepted: true },
  { src: '(?<=\\$)\\d+', flags: 'l', accepted: true },
  { src: '(a)\\1', flags: 'l', accepted: false },
  { src: '(?=a)', flags: 'l', accepted: false },
  { src: '(?<=(a))b', flags: 'l', accepted: false },
  { src: 'a{2,30}', flags: 'l', accepted: false },
  { src: 'a', flags: 'il', accepted: false },
  { src: 'a', flags: 'lu', accepted: false },
];

export const PLAIN_LINEAR =
  'Движок с откатами — один человек с мелом в лабиринте. Линейный движок — толпа: на каждой развилке она делится и идёт по всем коридорам сразу, а встретившиеся в одной комнате сливаются в одну группу. Комнат конечное число, поэтому толпа никогда не больше лабиринта, и каждый шаг по строке стоит одинаково.';

export const LINEAR_NOTE =
  'Линейный движок держит не одну позицию в шаблоне, а множество всех позиций, где можно оказаться после очередного знака строки. Его работа ограничена произведением длины шаблона на длину строки. Цена — возможности. Обратной ссылке нужно помнить, **какой текст** нашла группа, а вариантов такого текста бесконечно много — в конечный набор состояний они не укладываются. Поэтому `\\1` и просмотр вперёд он не принимает вовсе — `SyntaxError` «Cannot be executed in linear time» прямо при создании шаблона.';

export const LINEAR_FACTS = [
  {
    t: 'В V8 — только за флагом',
    d: 'Флаг шаблона `l` распознаётся только с `--enable-experimental-regexp-engine`; без него `/…/l` — `SyntaxError` «Invalid regular expression flags». Опция «подменять при лишних откатах» переключает шаблон на линейный движок после 50 000 откатов (`--regexp-backtracks-before-fallback`). Оба флага экспериментальные и в Node 24 по умолчанию выключены.',
    tone: 'warn' as const,
  },
  {
    t: 'RE2 — линейный движок отдельно',
    d: 'Библиотека Google RE2 и пакет `re2` для Node (нативный модуль) гарантируют линейное время и не поддерживают обратные ссылки и просмотры. Тот же выбор сделал Rust `regex`; переход на них Cloudflare объявила после аварии 2019 года. Сведения — по документации: в проекте пакет не установлен.',
    tone: 'info' as const,
  },
  {
    t: 'Крайняя мера — отдельный поток',
    d: 'Шаблон, который нельзя исправить (пришёл от пользователя, из конфига), можно исполнять в `Worker` и убивать его по таймеру через `terminate()`. Это дорого — поток на проверку, — зато главный поток не зависает.',
    tone: 'info' as const,
  },
];

// ─── Раздел 6. Флаги и ловушки ─────────────────────────────────────────────────────────────

export const FLAG_ROWS = [
  { f: '`g`', what: 'искать все совпадения; `exec` и `test` продолжают с `lastIndex`', trap: '`test` с `g` запоминает позицию между вызовами' },
  { f: '`y`', what: 'совпадение только ровно с `lastIndex`, без поиска дальше', trap: 'то же состояние в `lastIndex`' },
  { f: '`i`', what: 'без учёта регистра', trap: '—' },
  { f: '`m`', what: '`^` и `$` — начало и конец каждой строки текста', trap: 'без `m` `$` — только конец всего текста' },
  { f: '`s`', what: '`.` совпадает и с переводом строки', trap: 'без `s` `.` не перешагивает `\\n`' },
  { f: '`u`', what: 'знак — кодовая точка, а не единица UTF-16; доступны `\\p{…}`', trap: 'без `u` эмодзи — два знака' },
  { f: '`v`', what: 'всё, что `u`, плюс вычитание и пересечение классов, свойства строк', trap: '`u` и `v` вместе нельзя' },
  { f: '`d`', what: 'индексы начала и конца каждой группы в `match.indices`', trap: '—' },
];

export const LASTINDEX_CODE = `const digit = /\\d/g;
console.log(digit.test('7'));  // → true
console.log(digit.lastIndex);  // → 1
console.log(digit.test('7'));  // → false
console.log(digit.lastIndex);  // → 0`;

export const LASTINDEX_NOTE =
  'С флагом `g` объект шаблона хранит состояние: `lastIndex` — откуда искать в следующий раз. Второй `test` ищет в `"7"` с позиции 1, ничего не находит и сбрасывает `lastIndex` в 0 — поэтому третий снова ответит `true`. Если шаблон с `g` лежит в константе модуля, а валидатор вызывает у него `test`, ответ будет меняться от вызова к вызову на одной и той же строке. Для независимой проверки всей строки флаг `g` обычно не нужен.';

export const STICKY_CODE = `const num = /\\d+/y;
num.lastIndex = 3;
console.log(num.exec('ab 42')?.[0]); // → "42"
num.lastIndex = 0;
console.log(num.exec('ab 42'));      // → null`;

export const STICKY_NOTE =
  '`y` («липкий») не ищет — он проверяет одно место. Так пишут разборщики: «с текущей позиции стоит число?» — и не убегают вперёд. Проверка одной стартовой позиции убирает повторный поиск с других позиций. Но перебор внутри самого шаблона остаётся: вложенный повтор способен зависнуть и с `y`.';

export const UNICODE_CODE = `console.log('😀'.length);                    // → 2
console.log(/^.$/.test('😀'));               // → false
console.log(/^.$/u.test('😀'));              // → true
console.log(/[\\p{L}--[a-z]]/v.test('ж'));    // → true
console.log(/[\\p{L}--[a-z]]/v.test('b'));    // → false
console.log(/^\\p{RGI_Emoji}$/v.test('👨‍👩‍👧')); // → true`;

export const UNICODE_NOTE =
  'Без `u` точка — одна единица UTF-16, и эмодзи из двух единиц ей не подходит. С `u` точка — кодовая точка. `v` добавляет вычитание классов (`--`: «буквы, кроме латинских строчных») и свойства строк: семья 👨‍👩‍👧 — это пять кодовых точек, но свойство строк `\\p{RGI_Emoji}` с `v` сопоставляет всю эту последовательность. Сам флаг `v` не превращает точку в поиск графем.';

export const NAMED_CODE = `const date = /(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})/;
console.log('2026-10-01'.match(date).groups.y);              // → "2026"
console.log('2026-10-01'.replace(date, '$<d>.$<m>.$<y>'));   // → "01.10.2026"
console.log(/(?<=\\$)\\d+/.exec('цена $42')[0]);               // → "42"`;

export const NAMED_NOTE =
  'Именованные группы — те же номерные, только с именем: `groups.y` и `$<y>` в замене не ломаются, когда в шаблон добавили ещё одну скобку. Просмотр назад `(?<=\\$)` проверяет текст **перед** позицией и не забирает его. Автоматически преобразовать любой просмотр назад для старого движка нельзя. В простом случае можно захватить нужный префикс явно. Движок без поддержки просмотра назад отклонит такой литерал при разборе всего файла.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Тесты на правильных строках ReDoS не ловят',
    d: 'На строке, которая совпадает, `/^(\\w+\\s?)*$/` отвечает мгновенно: первый же вариант подходит. Взрыв случается только на почти подходящей строке, где совпадение срывается в самом конце. Проверять шаблон нужно длинной строкой с одним неверным знаком в хвосте.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Ленивый повтор не спасает',
    d: '`+?` меняет порядок перебора, а не его объём. В учебной модели на `a…a!` шаблон `/^(a+?)+$/` делает столько же шагов, сколько `/^(a+)+$/`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`test` с флагом `g` помнит прошлый вызов',
    d: '`lastIndex` живёт в объекте шаблона. Например, `/\\d/g` на строке `7` ответит `true`, потом `false`: второй вызов начнёт с конца строки. Другой шаблон или строка могут дать иную последовательность. У `y` поиск тоже зависит от `lastIndex`. Для проверки флаг `g` не нужен.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Лимит длины не заменяет исправления',
    d: 'При экспоненциальном росте даже 30 знаков — миллиарды шагов. Приемлемый лимит для квадратичного случая тоже нужно выбирать по замеру и нагрузке. Вложенный повтор лучше переписать.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Первый найденный — не самый длинный',
    d: '`/a|ab/.exec("ab")` даёт `a`. Движок с откатами возвращает первый вариант в порядке веток, а не лучший. Длинную ветку ставят первой.',
  },
  {
    n: '06',
    t: '`new RegExp(ввод)` — это код от пользователя',
    d: 'Строка из поиска становится шаблоном со всеми его возможностями, включая `(a+)+$`. Сначала `RegExp.escape(query)`, потом `new RegExp`.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Линейный движок не принимает всё',
    d: 'С флагом `l` V8 13.6 отказывает при создании шаблона, если в нём обратная ссылка, просмотр вперёд, захват внутри просмотра назад, флаг `i` или `u`. Подмена при лишних откатах такой шаблон не трогает — он продолжает перебирать.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'ECMAScript — RegExp (Regular Expression) Objects',
    href: 'https://tc39.es/ecma262/#sec-regexp-regular-expression-objects',
    what: 'семантика сопоставления на продолжениях: `RepeatMatcher`, сброс захватов на каждой итерации, запрет пустой итерации, `lastIndex`',
  },
  {
    title: 'V8 — An additional non-backtracking RegExp engine',
    href: 'https://v8.dev/blog/non-backtracking-regexp',
    what: 'флаг `l`, подмена после лишних откатов и порог 50 000, что линейный движок не поддерживает',
  },
  {
    title: 'V8 — Irregexp, the Google Chrome regular expression engine',
    href: 'https://blog.chromium.org/2009/02/irregexp-google-chromes-new-regexp.html',
    what: 'как устроен Irregexp: компиляция шаблона, откаты',
  },
  {
    title: 'MDN — RegExp.escape()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/escape',
    what: 'экранирование строки для вставки в шаблон',
  },
  {
    title: 'MDN — RegExp: lastIndex',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/lastIndex',
    what: 'как `test` и `exec` с флагами `g` и `y` меняют `lastIndex`',
  },
  {
    title: 'MDN — RegExp: unicodeSets (флаг v)',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp/unicodeSets',
    what: 'вычитание и пересечение классов, свойства строк',
  },
  {
    title: 'OWASP — Regular expression Denial of Service (ReDoS)',
    href: 'https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS',
    what: 'ReDoS как класс атак, «злые» шаблоны',
  },
  {
    title: 'Stack Exchange — Outage Postmortem, July 20, 2016',
    href: 'https://stackstatus.tumblr.com/post/147710624694/outage-postmortem-july-20-2016',
    what: 'шаблон обрезки пробелов и около 20 000 пробелов подряд: квадратичный перебор',
  },
  {
    title: 'Cloudflare — Details of the Cloudflare outage on July 2, 2019',
    href: 'https://blog.cloudflare.com/details-of-the-cloudflare-outage-on-july-2-2019/',
    what: 'правило WAF с `.*(?:.*=.*)`, разбор отката и переход на RE2 и Rust regex',
  },
  {
    title: 'google/re2 — Syntax',
    href: 'https://github.com/google/re2/wiki/Syntax',
    what: 'что RE2 поддерживает и что нет: обратные ссылки и просмотры — нет',
  },
];

export const RELATED =
  'Смежное на сайте: [Цикл событий Node, раздел «Между колбэками»](/js/node-event-loop/#s3) — задержка цикла событий и почему тормозят все запросы сразу. [Транспиляция и полифилы, раздел «Чего не сделать»](/tooling/transpilation/#s5) — просмотр назад в старых браузерах. [Безопасность бэкенда, раздел «Инъекции»](/platform/backend-security/#s3) — строка от пользователя, ставшая кодом. [Движок V8, раздел «Ярусы»](/js/v8-engine/#s1) — интерпретатор и компилятор, тот же приём, что у Irregexp.';
