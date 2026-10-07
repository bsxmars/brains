import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FormatSnippet } from '@/widgets/format-lab/model/types';

/**
 * Данные темы «Форматтер изнутри: как Prettier укладывает код в ширину».
 *
 * Тема написана здесь, 2026-10-02, по списку кандидатов для направления «Сборка и инструменты».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Prettier **3.9.6** из `node_modules` проекта (парсер `babel`, настройки по умолчанию:
 * `printWidth` 80, `tabWidth` 2, пробелы), Node 24.11.0, октябрь 2026.
 *
 * Как снято:
 *   — Doc примеров — `prettier.__debug.printToDoc(code, { parser: 'babel' })`. Внутренний
 *     отладочный вход: в документации его нет, имя может смениться без предупреждения. Doc от
 *     ширины не зависит (проверено на 10…100: `printDocToString(printToDoc(code), w)` совпадает
 *     с `prettier.format(code, { printWidth: w })` для всех примеров).
 *     ⚠️ Нормализовано одно: id групп в Prettier — уникальные `Symbol('array')`, `Symbol('assignment')`.
 *     В литералах ниже они заменены строками `array#1`, `assignment#2` (`toPlain` в тесте),
 *     иначе Doc не записать в JSON. Печать от этого не меняется — id сравниваются только на равенство.
 *   — Печать Doc целиком — `DOC_NEST_PRINT` — `prettier.__debug.formatDoc`.
 *   — Ширина строк — `prettier.util.getStringWidth`; пороги — `prettier.format` на ширинах 10…40.
 *   — Нестабильные случаи — три прогона `format` подряд. Оба взяты из открытых задач Prettier
 *     (#20162, #20175, заведены на 3.9.9) и воспроизводятся на 3.9.6. Сорок других «подозрительных»
 *     кусков с комментариями, проверенных до этого, оказались стабильными.
 *
 * Учебный принтер `PRINTER_CODE` сверяется в `tests/unit/formatter.test.ts` с настоящим
 * `printDocToString` из `prettier/doc`: на случайных Doc (генератор с seed: группы с id и
 * `shouldBreak`, `indent`, `align`, `line`/`softline`/`hardline`, `ifBreak` с `groupId`, `fill`,
 * `conditionalGroup`, `breakParent`) на всех ширинах 10…100 и на Doc настоящего кода из `SNIPPETS`.
 * Где он проще настоящего: ширина — `length`, а не East Asian Width; нет `lineSuffix`
 * (хвостовые комментарии), `literalline`, `trim`, `cursor`, `dedent`, `markAsRoot`, табов.
 *
 * Только по документации (в проекте не установлено и не запускалось): `eslint-config-prettier`
 * и `eslint-plugin-prettier` — их описание взято из README пакета и страницы Prettier
 * «Integrating with Linters»; алгоритм Вадлера — по статье.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'форматтер',
    d: 'Программа, которая меняет только вид кода: переносы, отступы, пробелы, кавычки. Смысл программы после неё тот же. Prettier — самый распространённый форматтер для JavaScript, CSS, HTML и Markdown.',
  },
  {
    k: 'Doc',
    d: 'Промежуточное описание будущего текста в Prettier. Не строка, а дерево из кусков текста и указаний: «здесь можно перенести», «это постарайся уместить в одну строку», «это сдвинь вправо».',
  },
  {
    k: 'группа (`group`)',
    d: 'Кусок Doc, который печатается целиком одним из двух способов: весь в одну строку или со всеми своими переносами сразу. Решение принимается для группы один раз.',
  },
  {
    k: 'плоский и ломаный режим',
    d: 'Плоский (`flat`) — переносы группы превращаются в пробел или в ничто. Ломаный (`break`) — каждый перенос группы становится новой строкой с отступом.',
  },
  {
    k: '`printWidth`',
    d: 'Желаемая ширина строки в колонках, по умолчанию 80. Prettier старается в неё уложиться, но это ориентир, а не запрет: длинную строку или имя он не разрежет.',
  },
  {
    k: 'идемпотентность',
    d: 'Свойство «повтор ничего не меняет»: отформатировать уже отформатированный код — получить тот же текст до символа.',
  },
];

export const PLAIN_FORMATTER =
  'Как наборщик в типографии. Автор принёс рукопись — текст, где строки обрываются где попало. Наборщик не читает её построчно: он берёт сами слова и абзацы и заново раскладывает их по ширине полосы. Где в рукописи был перенос, ему почти всё равно; важно только, что во что вложено и сколько места на полосе.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи, разобранные в других темах. Хватит общего представления — детали, нужные здесь, повторены на карточках.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Код разбирают в дерево',
    d: 'Инструменты читают код не как строки, а как дерево синтаксиса: вызов, его аргументы, их части. У каждого узла есть смещения в исходном тексте. Prettier начинает с того же дерева.',
    href: '/tooling/ast-linters/#s1',
    hrefLabel: '«AST и линтеры», раздел «От текста к дереву»',
    tone: 'info',
  },
  {
    t: 'Prettier — принтер, а не линтер',
    d: 'Линтер ищет ошибки и правит текст точечно. Prettier печатает весь файл заново и не смотрит, как он был свёрстан. Сравнение codemod, Babel и Prettier на одном файле — в соседней теме.',
    href: '/tooling/ast-linters/#s7',
    hrefLabel: '«AST и линтеры», раздел «Codemod и Prettier»',
    tone: 'info',
  },
  {
    t: '«Символ» бывает разной длины',
    d: 'Длина строки в JavaScript — число кодовых единиц UTF-16. Эмодзи занимает две или больше, буква с отдельным значком ударения — две. Нужно для разговора о том, как форматтер считает ширину.',
    href: '/js/unicode-intl/#s1',
    hrefLabel: '«Unicode и Intl», раздел «Единицы и точки»',
    tone: 'info',
  },
];

// ─── Раздел 1. От кода к Doc ───────────────────────────────────────────────────────────────

export const PIPELINE_CHIPS = [
  { label: 'исходный текст', tone: 'ok' as const },
  { label: 'парсер → AST' },
  { label: 'печать узлов → Doc' },
  { label: 'printDocToString(Doc, printWidth)' },
  { label: 'новый текст', tone: 'ok' as const },
];

export const PIPELINE_NOTE =
  'Первые два шага у всех инструментов одинаковы: парсер строит дерево синтаксиса. Дальше Prettier делает то, чего не делают ни линтер, ни сборщик: каждый узел дерева «печатает» не в строку, а в Doc. Ширина строки на этом шаге ещё не известна — Doc описывает все возможные раскладки сразу. Выбирает одну из них последний шаг, и он ничего не знает про JavaScript: тот же печатник раскладывает CSS, Markdown и YAML.';

export const PLAIN_DOC =
  'Doc похож на инструкцию к складному столу. В ней не написано «стол длиной 2 метра». Там написано: «эти три секции либо раскладываются все вместе, либо остаются сложенными; каждая следующая полка — с отступом». Какой выйдет стол, решается на месте, когда видно, сколько места в комнате. Комната — это `printWidth`.';

/** Сквозной пример темы. Его Doc — в `DOC_NEST_PRINT`, его печать на разных ширинах — в `OUTER_ROWS`. */
export const NEST_CODE = `send(format(order.id, order.total), [order.items.length, order.discount], true);`;

/** `prettier.__debug.formatDoc(printToDoc(NEST_CODE))` — как есть. Сверяется тестом. */
export const DOC_NEST_PRINT = `[
  "send",
  lineSuffixBoundary,
  group([
    "(",
    indent([
      softline,
      "format",
      lineSuffixBoundary,
      group([
        "(",
        indent([
          softline,
          "order",
          lineSuffixBoundary,
          ".",
          "id",
          ",",
          line,
          "order",
          lineSuffixBoundary,
          ".",
          "total",
        ]),
        ifBreak(","),
        softline,
        ")",
      ]),
      ",",
      line,
      group(
        [
          "[",
          indent([
            softline,
            group([
              "order",
              lineSuffixBoundary,
              group(indent([softline, ".", "items"])),
              lineSuffixBoundary,
              group(indent([softline, ".", "length"])),
            ]),
            ",",
            line,
            group(["order", lineSuffixBoundary, ".", "discount"]),
            ifBreak(","),
          ]),
          softline,
          "]",
        ],
        { id: Symbol.for("array") },
      ),
      ",",
      line,
      "true",
    ]),
    ifBreak(","),
    softline,
    ")",
  ]),
  ";",
  hardline,
]`;

export const DOC_NEST_NOTE =
  'Каждый вызов и массив — своя группа, и группы вложены так же, как узлы дерева. Внутри: `softline` после открывающей скобки, `line` после каждой запятой, `ifBreak(",")` — висячая запятая, которая появится только в ломаном виде. `lineSuffixBoundary` — место, где Prettier при нужде выталкивает хвостовой комментарий `// …`; в коде без комментариев он ничего не делает. `Symbol.for("array")` — имя группы, на которое может сослаться `ifBreak` в другом месте Doc.';

export const DOC_COMMANDS = [
  { k: 'текст', flat: 'печатается как есть', brk: 'печатается как есть', d: 'Строка Doc — кусок, который нельзя разорвать. Длинная строка или имя остаются целыми, даже если не влезают.' },
  { k: '`group(doc)`', flat: '—', brk: '—', d: 'Выбирает режим для всего, что внутри: если влезает в остаток строки — плоский, иначе ломаный. Решение одно на всю группу.' },
  { k: '`line`', flat: 'пробел', brk: 'перенос строки', d: 'Обычное место для переноса: между аргументами, после `=`.' },
  { k: '`softline`', flat: 'ничего', brk: 'перенос строки', d: 'Перенос без пробела: после `(` и перед `)`.' },
  { k: '`hardline`', flat: 'перенос', brk: 'перенос', d: 'Перенос всегда. Внутри — `breakParent`, поэтому все группы вокруг сразу ломаются.' },
  { k: '`indent(doc)`', flat: '—', brk: '+2 пробела', d: 'Отступ для строк, которые начнутся внутри. Сам по себе перенос не делает.' },
  { k: '`ifBreak(a, b)`', flat: '`b`', brk: '`a`', d: 'Разное содержимое для двух режимов. Так появляется висячая запятая. С `groupId` смотрит на режим другой, именованной группы.' },
  { k: '`fill(parts)`', flat: '—', brk: '—', d: 'Набор «как абзац»: элементы идут подряд, перенос ставится только там, где следующий элемент уже не влезает. Так печатаются массивы чисел.' },
  { k: '`conditionalGroup([a, b, c])`', flat: '—', brk: '—', d: 'Несколько готовых раскладок: первая, которая влезает, побеждает, последняя — запасная. Так последний аргумент-функция «обнимает» вызов.' },
  { k: '`breakParent`', flat: '—', brk: '—', d: 'Ломает все группы вокруг себя. Сам ничего не печатает.' },
];

/**
 * Doc руками — те же builders, которыми пользуются плагины Prettier.
 * Тест исполняет эту строку и сверяет оба результата с `BUILD_OUT_80` и `BUILD_OUT_20`.
 */
export const BUILD_CODE = `import { builders, printer } from 'prettier/doc';
const { group, indent, softline, line, ifBreak, join } = builders;

const args = ['order.id', 'order.total'];
const call = group([
  'format(',
  indent([softline, join([',', line], args)]),
  ifBreak(','),
  softline,
  ')',
]);

const at80 = printer.printDocToString(call, { printWidth: 80, tabWidth: 2 }).formatted;
const at20 = printer.printDocToString(call, { printWidth: 20, tabWidth: 2 }).formatted;`;

export const BUILD_OUT_80 = 'format(order.id, order.total)';

export const BUILD_OUT_20 = `format(
  order.id,
  order.total,
)`;

export const BUILD_NOTE =
  'Один Doc — два текста. На ширине 80 группа влезла: `softline` пропали, `line` стал пробелом, `ifBreak` ничего не дал. На 20 не влезла: каждый перенос стал новой строкой, `indent` сдвинул аргументы на `tabWidth` пробелов, `ifBreak` поставил висячую запятую.';

// ─── Раздел 2. Печать по ширине ────────────────────────────────────────────────────────────

export const WADLER_NOTE =
  'Идея — из статьи Филипа Вадлера «A prettier printer». Документ строится из текста, переносов, отступов и групп, а у группы два варианта: «всё в строку» и «с переносами». Печатник идёт слева направо и для каждой группы выбирает первый вариант, если остаток **текущей** строки его вмещает. Дальше ближайшего переноса он не заглядывает и к принятым решениям не возвращается. Такой жадный выбор быстр — каждую группу мерят не дальше конца строки — и почти всегда даёт то, что выбрал бы человек. Prettier начинался как принтер recast, внутренности которого его автор Джеймс Лонг переписал на алгоритм Вадлера. Потом к двум вариантам группы добавились `fill`, `ifBreak`, `conditionalGroup` и именованные группы.';

export const PLAIN_FITS =
  'Как укладывать вещи в рюкзак, не вынимая уже уложенного. Берёте следующую вещь целиком и проверяете: влезает в оставшееся место? Да — кладёте целиком. Нет — разбираете на части и укладываете по одной. Вещь, которую уже разобрали, обратно не собирают, даже если потом место освободилось бы.';

export const PRINTER_CODE = `// Doc — строка, массив или объект с полем type, ровно как в prettier/doc.
// Режим печати: 'break' — переносы line настоящие, 'flat' — line печатается пробелом.

// Ширина текста. Prettier считает по таблице East Asian Width: иероглиф и эмодзи — 2,
// комбинирующий знак — 0. Учебному принтеру хватает length: в примерах только ASCII и кириллица.
const textWidth = (text) => text.length;

// Шаг 0. Какие группы сломаны ещё до печати. hardline — это [line(hard), breakParent],
// и breakParent ломает группу вокруг себя, а сломанная группа — свою внешнюю.
// Цепочка останавливается на conditionalGroup: та выбирает вариант сама.
function findBrokenGroups(doc) {
  const broken = new Set();
  const seen = new Map();
  const any = (docs) => docs.map(walk).some(Boolean); // map, а не some: обойти все
  function walk(d) {
    if (typeof d === 'string') return false;
    if (Array.isArray(d)) return any(d);
    switch (d.type) {
      case 'break-parent': return true;
      case 'fill': return any(d.parts);
      case 'if-break': return any([d.breakContents, d.flatContents]);
      case 'indent': case 'align': case 'indent-if-break': case 'label':
        return walk(d.contents);
      case 'group': {
        if (seen.has(d)) return seen.get(d);
        const inner = d.expandedStates ? any(d.expandedStates) : walk(d.contents);
        const isBroken = Boolean(d.break) || (inner && !d.expandedStates);
        if (isBroken) broken.add(d);
        seen.set(d, isBroken);
        return isBroken;
      }
      default: return false; // line, line-suffix-boundary
    }
  }
  walk(doc);
  return broken;
}

// Влезет ли next в остаток строки width? Смотрим next в своём режиме, а потом —
// то, что стоит после него (rest), пока не встретим перенос: хвост \`);\` тоже занимает место.
function fits(next, rest, width, ctx, mustBeFlat) {
  const cmds = [next];
  let restIndex = rest.length;
  let pendingSpace = false; // пробел от line считаем, только если за ним будет текст
  while (width >= 0) {
    if (cmds.length === 0) {
      if (restIndex === 0) return true;
      cmds.push(rest[--restIndex]);
      continue;
    }
    const { mode, doc } = cmds.pop();
    if (typeof doc === 'string') {
      if (doc) {
        if (pendingSpace) { width -= 1; pendingSpace = false; }
        width -= textWidth(doc);
      }
    } else if (Array.isArray(doc) || doc.type === 'fill') {
      const parts = Array.isArray(doc) ? doc : doc.parts;
      for (let i = parts.length - 1; i >= 0; i--) cmds.push({ mode, doc: parts[i] });
    } else switch (doc.type) {
      case 'indent': case 'align': case 'indent-if-break': case 'label':
        cmds.push({ mode, doc: doc.contents });
        break;
      case 'group': {
        const isBroken = ctx.broken.has(doc);
        if (mustBeFlat && isBroken) return false;
        const m = isBroken ? 'break' : mode;
        const contents = doc.expandedStates && m === 'break' ? doc.expandedStates.at(-1) : doc.contents;
        cmds.push({ mode: m, doc: contents });
        break;
      }
      case 'if-break': {
        const m = doc.groupId ? ctx.groupModes.get(doc.groupId) || 'flat' : mode;
        const contents = m === 'break' ? doc.breakContents : doc.flatContents;
        if (contents) cmds.push({ mode, doc: contents });
        break;
      }
      case 'line':
        if (mode === 'break' || doc.hard) return true; // дальше новая строка — всё влезло
        if (!doc.soft) pendingSpace = true;
        break;
    }
  }
  return false;
}

function printDoc(doc, printWidth) {
  const ctx = { broken: findBrokenGroups(doc), groupModes: new Map() };
  const decisions = new Map(); // группа → { mode, state } — для показа, печать их не читает
  const cmds = [{ ind: '', mode: 'break', doc }];
  let out = '';
  let pos = 0;              // колонка, на которой стоит печать
  let remeasure = false;    // hardline внутри плоской группы — дальше меряем заново

  // Группа: плоско, если влезает; иначе ломается. У conditionalGroup —
  // варианты по очереди, последний печатается сломанным.
  function chooseGroup(g, ind, mode) {
    const isBroken = ctx.broken.has(g);
    if (mode === 'flat' && !remeasure) {
      return { ind, mode: isBroken ? 'break' : 'flat', doc: g.contents, state: 0 };
    }
    remeasure = false;
    const flat = { ind, mode: 'flat', doc: g.contents, state: 0 };
    if (!isBroken && fits(flat, cmds, printWidth - pos, ctx, false)) return flat;
    if (!g.expandedStates) return { ind, mode: 'break', doc: g.contents, state: 0 };
    const last = g.expandedStates.length - 1;
    if (!isBroken) {
      for (let i = 1; i < last; i++) {
        const option = { ind, mode: 'flat', doc: g.expandedStates[i], state: i };
        if (fits(option, cmds, printWidth - pos, ctx, false)) return option;
      }
    }
    return { ind, mode: 'break', doc: g.expandedStates[last], state: last };
  }

  while (cmds.length > 0) {
    const { ind, mode, doc: d } = cmds.pop();
    if (typeof d === 'string') { out += d; pos += textWidth(d); continue; }
    if (Array.isArray(d)) {
      for (let i = d.length - 1; i >= 0; i--) cmds.push({ ind, mode, doc: d[i] });
      continue;
    }
    switch (d.type) {
      case 'indent': cmds.push({ ind: ind + '  ', mode, doc: d.contents }); break;
      case 'align':
        if (typeof d.n !== 'number' || d.n < 0) throw new Error('учебный принтер знает только align(n > 0)');
        cmds.push({ ind: ind + ' '.repeat(d.n), mode, doc: d.contents });
        break;
      case 'label': cmds.push({ ind, mode, doc: d.contents }); break;
      case 'group': {
        const next = chooseGroup(d, ind, mode);
        decisions.set(d, { mode: next.mode, state: next.state });
        if (d.id) ctx.groupModes.set(d.id, next.mode);
        cmds.push({ ind, mode: next.mode, doc: next.doc });
        break;
      }
      case 'fill': {
        // Как набор абзаца: ставим очередной кусок; разделитель после него
        // ломается, только если следующий кусок на эту строку уже не встанет.
        const [content, sep, second] = d.parts;
        if (d.parts.length === 0) break;
        const rest = printWidth - pos;
        const flatC = { ind, mode: 'flat', doc: content };
        const contentFits = fits(flatC, [], rest, ctx, true);
        const contentCmd = contentFits ? flatC : { ind, mode: 'break', doc: content };
        if (d.parts.length === 1) { cmds.push(contentCmd); break; }
        if (d.parts.length === 2) {
          cmds.push({ ind, mode: contentCmd.mode, doc: sep }, contentCmd);
          break;
        }
        cmds.push({ ind, mode, doc: { type: 'fill', parts: d.parts.slice(2) } });
        const pairFits = fits({ ind, mode: 'flat', doc: [content, sep, second] }, [], rest, ctx, true);
        cmds.push({ ind, mode: pairFits ? 'flat' : 'break', doc: sep }, contentCmd);
        break;
      }
      case 'if-break':
      case 'indent-if-break': {
        const m = d.groupId ? ctx.groupModes.get(d.groupId) : mode;
        let contents;
        if (d.type === 'if-break') contents = m === 'break' ? d.breakContents : m === 'flat' ? d.flatContents : '';
        else if (m === 'break') contents = d.negate ? d.contents : { type: 'indent', contents: d.contents };
        else if (m === 'flat') contents = d.negate ? { type: 'indent', contents: d.contents } : d.contents;
        if (contents) cmds.push({ ind, mode, doc: contents });
        break;
      }
      case 'line':
        if (mode === 'flat' && !d.hard) {
          if (!d.soft) { out += ' '; pos += 1; }
          break;
        }
        if (mode === 'flat') remeasure = true; // hardline ломает строку и в плоской группе
        out = out.replace(/[ \\t]+$/, '') + '\\n' + ind; // хвостовые пробелы срезаются
        pos = ind.length;
        break;
      case 'break-parent':
      case 'line-suffix-boundary':
        break; // первый уже учтён в findBrokenGroups, второй нужен только комментариям
      default:
        throw new Error(\`учебный принтер не знает \${d.type}\`);
    }
  }
  return { text: out, decisions };
}`;

export const FITS_NOTE =
  '`fits` проверяет не только саму группу. После неё на стеке лежит то, что будет напечатано следом, — закрывающая скобка, `;`, следующий аргумент, — и всё это до ближайшего возможного переноса тоже должно влезть. Поэтому вызов из сквозного примера длиной 79 символов плюс `;` при ширине 79 не помещается: строка вышла бы на колонку 80. Пробел от `line` засчитывается, только если за ним идёт текст: хвостовой пробел перед переносом всё равно будет срезан.';

export const OUTER_NOTE =
  'Группы проверяются в том порядке, в каком их встречает печатник, — снаружи внутрь. Первой мерится внешняя группа `send(…)`, и мерится вместе со всем содержимым, вытянутым в одну строку. Не влезла — ломается, и её аргументы получают каждый свою строку с отступом. Только теперь печатник доходит до `format(…)` и массива и спрашивает их уже с новым, большим остатком. Поэтому сначала ломается внешний вызов, а вложенные часто остаются в строку.';

/** Сквозной пример на разных ширинах. Числа — учебный принтер и `prettier.format`; сверяются тестом. */
export const OUTER_ROWS = [
  { w: 80, broken: 'ничего', groups: 0, lines: 1, tone: 'ok' as const },
  { w: 79, broken: '`send(…)`', groups: 1, lines: 5, tone: undefined },
  { w: 38, broken: '`send(…)` и массив', groups: 2, lines: 8, tone: undefined },
  { w: 31, broken: '`send(…)`, массив и `format(…)`', groups: 3, lines: 11, tone: 'warn' as const },
];

export const OUTER_79 = `send(
  format(order.id, order.total),
  [order.items.length, order.discount],
  true,
);`;

export const PLAIN_BREAK_PARENT =
  'Как подпорка под полкой: если одной вещи на полке нужна полная высота, раздвигается весь шкаф, в котором эта полка стоит. `hardline` внутри группы — такая вещь: она ломает свою группу, а та — внешнюю, до самого верха.';

export const BREAK_PARENT_NOTE =
  'У ширины и `breakParent` направления противоположные. Ширина ломает группы снаружи внутрь: внешняя — первая кандидатка. `breakParent` — изнутри наружу: перед печатью Prettier проходит Doc и помечает сломанной каждую группу, внутри которой есть `hardline` или уже сломанная группа. Цепочка останавливается только на `conditionalGroup` — та выбирает вариант сама. Поэтому метод с телом раскрывает объект, в котором лежит: `{ f() { return 1; } }` не останется в строке ни на какой ширине. А функцию-аргумент от того же спасает `conditionalGroup` вызова: `foo(x, () => {` остаётся на одной строке, раскрывается только тело.';

export const DEMO_CAPTION =
  'Doc каждого примера снят с настоящего Prettier, а раскладку считает функция `printDoc` выше — та самая, что сверяется тестом с `printDocToString`. Группы в дереве окрашены по решению: ломаная или в строку. Двигайте ширину и смотрите, какая группа сдаётся первой: почти всегда внешняя. У «последнего аргумента» видно, какой из трёх вариантов `conditionalGroup` выбран, а у объекта с переносом группа сломана на любой ширине.';

/** Примеры для демо: код, его Doc (`printToDoc`, см. шапку) и ширина при открытии. Сверяются тестом. */
export const SNIPPETS: FormatSnippet[] = [
  {
    id: 'nest',
    label: 'Вложенные вызовы',
    code: NEST_CODE,
    start: 38,
    note: 'Сквозной пример. Ровно 80 символов вместе с `;`: на 79 ломается внешний вызов, на 38 — ещё и массив, на 31 — `format(…)`.',
    doc: [[[[[["",["send","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},[[["",["format","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},[[["order","","",""],{"type":"line-suffix-boundary"},["",".",["id","","",""]]],",",{"type":"line"}],[["order","","",""],{"type":"line-suffix-boundary"},["",".",["total","","",""]]]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],",",{"type":"line"}],[[{"type":"group","id":"array#1","contents":["[",{"type":"indent","contents":[{"type":"line","soft":true},[[{"type":"group","contents":[[["order","","",""],{"type":"line-suffix-boundary"},{"type":"group","contents":{"type":"indent","contents":[{"type":"line","soft":true},["",".",["items","","",""]]]},"break":false}],{"type":"line-suffix-boundary"},{"type":"group","contents":{"type":"indent","contents":[{"type":"line","soft":true},["",".",["length","","",""]]]},"break":false}],"break":false},[",",{"type":"line"},""],{"type":"group","contents":[["order","","",""],{"type":"line-suffix-boundary"},["",".",["discount","","",""]]],"break":false}],{"type":"if-break","breakContents":",","flatContents":""}],""]},{"type":"line","soft":true},"]"],"break":false},"",""],",",{"type":"line"}],"true"]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],";"]]],[{"type":"line","hard":true},{"type":"break-parent"}]],
  },
  {
    id: 'call',
    label: 'Последний аргумент',
    code: `fetchUser(userId, { retries: 3, timeout: 5000 }).then((user) => render(user));`,
    start: 63,
    note: 'Аргументы обоих вызовов печатает `conditionalGroup` из трёх вариантов: всё в строку, последний аргумент «обнимает» скобки, всё по строкам. На 63 у `.then` побеждает второй: стрелка остаётся на строке вызова, ломается только её тело. Сузьте до 40 — второй вариант выберет и `fetchUser`: объект раскроется, а `fetchUser(userId, {` останется одной строкой.',
    doc: [[[[{"type":"group","contents":[[[["",["fetchUser","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",[["userId","","",""],",",{"type":"line"}],{"type":"group","contents":["{",{"type":"indent","contents":[{"type":"line"},[{"type":"group","contents":[{"type":"group","contents":["retries","","",""],"break":false},":"," ","3"],"break":false}],[",",{"type":"line"},{"type":"group","contents":[{"type":"group","contents":["timeout","","",""],"break":false},":"," ","5000"],"break":false}]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},"}","",""],"break":false},")"],"break":false,"expandedStates":[["(",[["userId","","",""],",",{"type":"line"}],{"type":"group","contents":["{",{"type":"indent","contents":[{"type":"line"},[{"type":"group","contents":[{"type":"group","contents":["retries","","",""],"break":false},":"," ","3"],"break":false}],[",",{"type":"line"},{"type":"group","contents":[{"type":"group","contents":["timeout","","",""],"break":false},":"," ","5000"],"break":false}]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},"}","",""],"break":false},")"],["(",[["userId","","",""],",",{"type":"line"}],{"type":"group","contents":{"type":"group","contents":["{",{"type":"indent","contents":[{"type":"line"},[{"type":"group","contents":[{"type":"group","contents":["retries","","",""],"break":false},":"," ","3"],"break":false}],[",",{"type":"line"},{"type":"group","contents":[{"type":"group","contents":["timeout","","",""],"break":false},":"," ","5000"],"break":false}]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},"}","",""],"break":false},"break":true},")"],{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line"},[["userId","","",""],",",{"type":"line"}],{"type":"group","contents":["{",{"type":"indent","contents":[{"type":"line"},[{"type":"group","contents":[{"type":"group","contents":["retries","","",""],"break":false},":"," ","3"],"break":false}],[",",{"type":"line"},{"type":"group","contents":[{"type":"group","contents":["timeout","","",""],"break":false},":"," ","5000"],"break":false}]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},"}","",""],"break":false}]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},")"],"break":true}]}]],[["",".",["then","","",""]],["","",{"type":"group","contents":["(",{"type":"group","contents":[{"type":"group","id":"arrow-chain#1","contents":[{"type":"group","contents":[{"type":"group","contents":["","(",[["user","","",""]],")"],"break":false},{"type":"group","contents":[""],"break":false}],"break":false}],"break":false}," =>",{"type":"group","contents":[{"type":"indent","contents":[{"type":"line"},[["",["render","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},["user","","",""]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],[]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true}],"break":false},""],"break":false},")"],"break":false,"expandedStates":[["(",{"type":"group","contents":[{"type":"group","id":"arrow-chain#1","contents":[{"type":"group","contents":[{"type":"group","contents":["","(",[["user","","",""]],")"],"break":false},{"type":"group","contents":[""],"break":false}],"break":false}],"break":false}," =>",{"type":"group","contents":[{"type":"indent","contents":[{"type":"line"},[["",["render","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},["user","","",""]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],[]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true}],"break":false},""],"break":false},")"],["(",{"type":"group","contents":{"type":"group","contents":[{"type":"group","id":"arrow-chain#1","contents":[{"type":"group","contents":[{"type":"group","contents":["","(",[["user","","",""]],")"],"break":false},{"type":"group","contents":[""],"break":false}],"break":false}],"break":false}," =>",{"type":"group","contents":[{"type":"indent","contents":[{"type":"line"},[["",["render","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},["user","","",""]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],[]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true}],"break":false},""],"break":false},"break":true},")"],{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line"},{"type":"group","contents":[{"type":"group","id":"arrow-chain#2","contents":[{"type":"group","contents":[["","(",{"type":"indent","contents":[{"type":"line","soft":true},["user","","",""]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],[""]],"break":false}],"break":false}," =>",{"type":"group","contents":[{"type":"indent","contents":[{"type":"line"},[["",["render","","",""],{"type":"line-suffix-boundary"}],"","",{"type":"group","contents":["(",{"type":"indent","contents":[{"type":"line","soft":true},["user","","",""]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line","soft":true},")"],"break":false}],[]]},"",""],"break":false},""],"break":false}]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},")"],"break":true}]}]]],"break":false},";"]]],[{"type":"line","hard":true},{"type":"break-parent"}]],
  },
  {
    id: 'arr',
    label: 'Массив чисел',
    code: `const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61];`,
    start: 40,
    note: 'Короткие числа Prettier печатает через `fill`: перенос ставится только там, где следующее число не влезает. Группа массива при этом сломана — скобки на своих строках.',
    doc: [[[{"type":"group","contents":["","const",[" ",{"type":"group","contents":[{"type":"group","contents":["primes","","",""],"break":false}," =",{"type":"group","id":"assignment#1","contents":{"type":"indent","contents":{"type":"line"}},"break":false},{"type":"line-suffix-boundary"},{"type":"indent-if-break","contents":[{"type":"group","id":"array#2","contents":["[",{"type":"indent","contents":[{"type":"line","soft":true},{"type":"fill","parts":[["2",","],{"type":"line"},["3",","],{"type":"line"},["5",","],{"type":"line"},["7",","],{"type":"line"},["11",","],{"type":"line"},["13",","],{"type":"line"},["17",","],{"type":"line"},["19",","],{"type":"line"},["23",","],{"type":"line"},["29",","],{"type":"line"},["31",","],{"type":"line"},["37",","],{"type":"line"},["41",","],{"type":"line"},["43",","],{"type":"line"},["47",","],{"type":"line"},["53",","],{"type":"line"},["59",","],{"type":"line"},["61",{"type":"if-break","breakContents":",","flatContents":"","groupId":"array#2"}]]},""]},{"type":"line","soft":true},"]"],"break":false},"",""],"groupId":"assignment#1"}],"break":false}],{"type":"indent","contents":[]},";"],"break":false}]],[{"type":"line","hard":true},{"type":"break-parent"}]],
  },
  {
    id: 'obj',
    label: 'Объект с переносом',
    code: `const config = {\n  port: 8080, host: "localhost" };`,
    start: 80,
    note: 'В исходнике после `{` стоит перенос — и группа объекта получила в Doc `break: true`. Она сломана на любой ширине, хотя объект влез бы в строку.',
    doc: [[[{"type":"group","contents":["","const",[" ",{"type":"group","contents":[{"type":"group","contents":["config","","",""],"break":false}," =",{"type":"group","id":"assignment#1","contents":{"type":"indent","contents":{"type":"line"}},"break":false},{"type":"line-suffix-boundary"},{"type":"indent-if-break","contents":{"type":"group","contents":["{",{"type":"indent","contents":[{"type":"line"},[{"type":"group","contents":[{"type":"group","contents":["port","","",""],"break":false},":"," ","8080"],"break":false}],[",",{"type":"line"},{"type":"group","contents":[{"type":"group","contents":["host","","",""],"break":false},":"," ",["\"localhost\""]],"break":false}]]},{"type":"if-break","breakContents":",","flatContents":""},{"type":"line"},"}","",""],"break":true},"groupId":"assignment#1"}],"break":false}],{"type":"indent","contents":[]},";"],"break":false}]],[{"type":"line","hard":true},{"type":"break-parent"}]],
  },
  {
    id: 'long',
    label: 'Длинная строка',
    code: `const message = "Это очень длинная строка, которую Prettier не станет резать на части";`,
    start: 60,
    note: 'Строковый литерал — один кусок текста. Prettier может перенести его на следующую строку после `=`, но не разрезать: на ширине меньше 87 строка всё равно длиннее `printWidth`.',
    doc: [[[{"type":"group","contents":["","const",[" ",{"type":"group","contents":[{"type":"group","contents":["message","","",""],"break":false}," =",{"type":"group","contents":{"type":"indent","contents":[{"type":"line"},["\"Это очень длинная строка, которую Prettier не станет резать на части\""]]},"break":false}],"break":false}],{"type":"indent","contents":[]},";"],"break":false}]],[{"type":"line","hard":true},{"type":"break-parent"}]],
  },
];

// ─── Раздел 3. printWidth — не стена ───────────────────────────────────────────────────────

export const LONG_CODE = `// printWidth: 40
const message =
  "Это очень длинная строка, которую Prettier не станет резать на части";`;

export const LONG_NOTE =
  'Prettier не меняет смысл, а разрезать строку на `"…" + "…"` — уже другое выражение. То же с длинным именем, цепочкой из одного длинного обращения, импортом единственного имени. Лучшее, что он может, — перенести неделимый кусок на новую строку, где места больше всего, и оставить длиннее `printWidth`. Отсюда правило: `printWidth` — то, к чему Prettier стремится, а не то, что он гарантирует.';

/** `getStringWidth` Prettier 3.9.6 против длины строки. Сверяется тестом. */
export const WIDTH_ROWS = [
  { s: '`order`', what: 'латиница', len: 5, points: 5, width: 5, tone: undefined },
  { s: '`привет`', what: 'кириллица', len: 6, points: 6, width: 6, tone: undefined },
  { s: '`日本語`', what: 'иероглифы — «широкие»', len: 3, points: 3, width: 6, tone: 'warn' as const },
  { s: '`👍`', what: 'эмодзи', len: 2, points: 1, width: 2, tone: undefined },
  { s: '`👨‍👩‍👧`', what: 'семья: три эмодзи через ZWJ', len: 8, points: 5, width: 2, tone: 'warn' as const },
  { s: '`🇷🇺`', what: 'флаг: два знака-региона', len: 4, points: 2, width: 2, tone: undefined },
  { s: '`é` (e + U+0301)', what: 'буква и комбинирующий знак', len: 2, points: 2, width: 1, tone: 'warn' as const },
];

export const PLAIN_WIDTH =
  'Как места в зрительном зале с узкими и широкими креслами. Букву латиницы или кириллицы сажают в одно кресло. Иероглиф в моноширинном шрифте занимает два — так его рисует терминал и редактор. А значок ударения вообще не занимает места: он садится на колени букве перед ним.';

export const WIDTH_NOTE =
  'Колонка в редакторе — не `length` и не число кодовых точек. Prettier считает ширину так, как её рисует моноширинный шрифт: знаки, которые таблица Юникода East Asian Width помечает «широкими» (иероглифы, корейское письмо, полноширинные формы), — по 2 колонки; эмодзи — 2, даже если это последовательность из нескольких знаков через ZWJ (кроме нескольких «узких» вроде ©, у них 1); основные комбинирующие знаки (U+0300–U+036F), селекторы вариантов и управляющие символы — 0; всё остальное — 1. Для чистого ASCII всё это пропускается: ширина равна `length`.';

/** Порог, с которого `log(first, "…")` печатается в одну строку. `prettier.format`, сверяется тестом. */
export const THRESHOLD_ROWS = [
  { s: '`"abcdef"`', at: 21 },
  { s: '`"привет"`', at: 21 },
  { s: '`"日本語漢字中"`', at: 27 },
  { s: '`"👍👍👍👍👍👍"`', at: 27 },
];

export const GRAPHEME_LINK =
  'Это та же история, что с графемами: «символ» на экране, в строке JavaScript и в кодовых точках — три разных числа. Подробно — в теме [«Unicode и Intl», раздел «Графемы»](/js/unicode-intl/#s2).';

export const THRESHOLD_NOTE =
  'Шесть знаков в кавычках — а порог разный. Шесть иероглифов или эмодзи занимают 12 колонок вместо 6, и вызов уходит на несколько строк на 6 колонок раньше. По `length` эмодзи-строка была бы ещё длиннее (12), а иероглифы — короче (6): ни то, ни другое не совпало бы с тем, что видно на экране.';

// ─── Раздел 4. Что остаётся от исходника ───────────────────────────────────────────────────

export const KEEP_ROWS = [
  { k: 'пустые строки между инструкциями', fate: 'сохраняются, но подряд не больше одной; в начале и в конце блока убираются', tone: 'ok' as const },
  { k: 'перенос после `{` у объекта', fate: 'сохраняется: объект остаётся многострочным, даже если влез бы в строку', tone: 'ok' as const },
  { k: 'комментарии', fate: 'сохраняются; Prettier прикрепляет их к соседним узлам дерева', tone: 'ok' as const },
  { k: 'отступы, пробелы, переносы внутри выражений', fate: 'выбрасываются: всё печатается из дерева заново', tone: 'warn' as const },
  { k: 'кавычки', fate: 'выбрасываются: двойные по умолчанию, одинарные — если так меньше экранирования', tone: 'warn' as const },
  { k: 'лишние скобки', fate: 'выбрасываются; там, где смешаны `&&` и `||` или `%` и `*`, наоборот, добавляются', tone: 'warn' as const },
  { k: 'перенос после `{` у деструктуризации, массива, импорта', fate: 'выбрасывается: правило про перенос действует только для объектов', tone: 'warn' as const },
];

export const KEEP_CODE_IN = `const s = 'It\\'s'; const t = "say \\"hi\\"";
x = a && b || c;
z = (a * b) + c;`;

export const KEEP_CODE_OUT = `const s = "It's";
const t = 'say "hi"';
x = (a && b) || c;
z = a * b + c;`;

export const PLAIN_FIRST_KEY =
  'Как закладка в книге. Prettier не помнит, как вы раньше верстали объект, кроме одной вещи: стоял ли перенос сразу после `{`. Это закладка «держать раскрытым». Пока она на месте, объект раскрыт при любой ширине; уберёте перенос — Prettier снова решит сам.';

export const FIRST_KEY_LINK =
  'Сравнение входа с переносом после скобки и без него уже есть в теме [«AST и линтеры», раздел «Codemod и Prettier»](/tooling/ast-linters/#s7). Здесь — следствие, которое видно только во времени: правило запоминает и решение, которое принял сам Prettier.';

export const STICKY_IN = `const user = { name: "Анна", role: "admin", lastSeen: lastSeenDate, active: true };`;

export const STICKY_OUT = `const user = {
  name: "Анна",
  role: "admin",
  lastSeen: lastSeenDate,
  active: true,
};`;

/** STICKY_OUT без строки `lastSeen` — и снова через Prettier. */
export const STICKY_EDITED_OUT = `const user = {
  name: "Анна",
  role: "admin",
  active: true,
};`;

export const STICKY_FRESH_OUT = `const user = { name: "Анна", role: "admin", active: true };`;

export const STICKY_NOTE =
  'Строка из 83 символов не влезла — Prettier раскрыл объект. С этой минуты перенос после `{` есть в самом файле. Удалили поле, объект стал коротким — а Prettier оставил его раскрытым: он видит перенос и считает, что так решили вы. Тот же объект, набранный заново в строку, печатается в строку. Вывод зависит не только от кода, но и от его истории. С версии 3.5 это можно выключить: `objectWrap: "collapse"` сворачивает объект, если он влезает.';

export const NESTED_IN = `const theme = { colors: {
  primary: "#000" }, spacing: 8 };`;

export const NESTED_OUT = `const theme = {
  colors: {
    primary: "#000",
  },
  spacing: 8,
};`;

export const NESTED_NOTE =
  'Перенос был только после второй `{`. Группа внутреннего объекта получила `break: true`, и `breakParent` поднял решение наверх: внешний объект раскрыт тоже, хотя его собственного переноса не было.';

// ─── Раздел 5. Форматтер и линтер ──────────────────────────────────────────────────────────

export const LINT_NOTE =
  'Если ESLint тоже следит за видом кода, они с Prettier спорят: один ставит, другой ругается. Решение — разделить обязанности. Правила вида выключаются, ESLint оставляет себе ошибки, Prettier — форму. Выключает их готовый конфиг `eslint-config-prettier`: он ничего не добавляет, только гасит правила ESLint и популярных плагинов, которые конфликтуют с Prettier или ему не нужны. Ставится последним, чтобы перекрыть всё, что включили конфиги выше.';

/** Из README `eslint-config-prettier`. В проекте пакет не установлен — пример не исполняется. */
export const LINT_CONFIG_CODE = `// eslint.config.js
import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  js.configs.recommended,
  eslintConfigPrettier, // последним: гасит правила вида из конфигов выше
];`;

export const LINT_ROWS = [
  { rule: '`max-len`', why: 'Prettier оставляет длинные строки и имена длиннее `printWidth` — правило будет жаловаться на то, что форматтер исправить не может.' },
  { rule: '`no-mixed-operators`', why: 'Prettier убирает «лишние» скобки: `(a * b) + c` станет `a * b + c`, и правило, требующее скобок, снова зажжётся.' },
  { rule: '`indent`, `quotes`, `semi`', why: 'Ровно то, что Prettier печатает сам. В ESLint 10 эти правила уже устаревшие.' },
];

export const LINT_PLUGIN_NOTE =
  'Есть и второй путь — `eslint-plugin-prettier`: Prettier запускается как правило ESLint, и каждое расхождение с его выводом подчёркивается как ошибка. Сам Prettier его не советует: в редакторе море красных волнистых линий за пробелы, это медленнее прямого запуска и лишний слой, где что-то может сломаться. Проще звать Prettier отдельно — при сохранении в редакторе и `prettier --check .` в CI.';

// ─── Раздел 6. Идемпотентность ─────────────────────────────────────────────────────────────

export const PLAIN_IDEMPOTENT =
  'Как выключатель «выключить», а не «переключить». Сколько раз ни нажми «выключить», свет выключен. Форматтер должен быть таким: второй прогон по своему же выводу не меняет ни символа. Иначе в репозитории не бывает «готового» файла — каждый прогон даёт новый диф.';

export const IDEM_NOTE =
  'Сам печатник Doc детерминирован: тот же Doc и та же ширина — тот же текст. Значит, повтор может что-то поменять, только если отформатированный текст дал **другой** Doc. Такое случается в первом шаге, где исходник ещё влияет на результат: где стоял перенос, к какому узлу прикрепить комментарий. Комментариев нет в дереве синтаксиса, Prettier сам решает, к какому узлу каждый относится. Если после первого прогона комментарий оказался в другом месте, при втором прогоне он прикрепится к другому узлу.';

export const UNSTABLE_IN = `switch (a) { case 1: // c
{ b; } }`;

export const UNSTABLE_PASS1 = `switch (a) {
  case 1: { // c
    b;
  }
}`;

export const UNSTABLE_PASS2 = `switch (a) {
  case 1: {
    // c
    b;
  }
}`;

export const UNSTABLE_NOTE =
  'Первый прогон оставил комментарий в хвосте строки `case 1: {`. Во втором он уже стоит после `{` — и прикрепляется к первой инструкции блока, печатаясь отдельной строкой над ней. Третий прогон совпадает со вторым. Ещё хуже случай с комментарием между `export` и декоратором: каждый прогон добавляет пустую строку, пока их не станет две. Оба случая — открытые задачи в репозитории Prettier.';

export const DECORATOR_ROWS = [
  { pass: 'вход', blank: '—', text: '`export /* c */ @dec class A {}`' },
  { pass: '1-й прогон', blank: '0', text: 'комментарий и декоратор на разных строках' },
  { pass: '2-й прогон', blank: '1', text: 'между ними появилась пустая строка' },
  { pass: '3-й и дальше', blank: '2', text: 'ещё одна — и дальше вывод стоит' },
];

export const CHECK_CODE = `# В CI: упасть, если хоть один файл отформатирован не так
npx prettier --check .

# Версию — точно, без ^: у новой версии может быть другой вывод
npm install --save-dev --save-exact prettier`;

export const CHECK_NOTE =
  'Стабильность между версиями — отдельный вопрос. Даже патч-версия Prettier может поменять раскладку какого-то случая, и тогда `--check` упадёт на файлах, которых никто не трогал. Поэтому документация Prettier советует ставить его с `--save-exact`, а обновлять её отдельным коммитом вместе с переформатированием всего проекта.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`printWidth` — не предел длины строки',
    d: 'Строковый литерал, длинное имя, импорт одного имени Prettier не режет. На ширине 40 строка в 73 символа так и останется 73 символами. Проверка «нет строк длиннее 80» после Prettier может не пройти — и это не ошибка Prettier.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Раскрытый объект сам не свернётся',
    d: 'Перенос после `{` Prettier считает вашим решением. Объект, который он однажды раскрыл из-за длины, останется раскрытым после того, как стал коротким. Свернуть — убрать перенос после `{` руками или включить `objectWrap: "collapse"`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Сначала ломается внешнее',
    d: 'Решения принимаются сверху вниз и жадно. Если хочется, чтобы сломался внутренний вызов, а внешний остался в строку, — Prettier так не умеет: внешняя группа меряется первой и вместе со всем содержимым. Вынести внутреннее в переменную — единственный способ.',
  },
  {
    n: '04',
    t: 'Один `hardline` раскрывает всё вокруг',
    d: 'Функция с телом в фигурных скобках, шаблонная строка с переносом, комментарий `//` — любой обязательный перенос ломает все внешние группы до ближайшего `conditionalGroup`. Отсюда «почему этот короткий объект разложен на пять строк»: внутри метод с телом, и перенос в нём не убрать.',
  },
  {
    n: '05',
    t: 'Ширина считается не по `length`',
    d: 'Иероглиф — две колонки, эмодзи-семья из восьми кодовых единиц — две, буква со значком ударения — одна. Свой инструмент, который проверяет длину строк по `length`, разойдётся с Prettier на любом не-ASCII тексте.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Второй прогон иногда меняет файл',
    d: 'Почти всегда из-за комментариев в необычных местах: после `case 1:` перед блоком, между `export` и декоратором. Если `prettier --check` падает на только что отформатированном файле — прогоните `prettier --write` ещё раз и посмотрите, что сдвинулось.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Два правила вида — две правды',
    d: 'Правила оформления ESLint и Prettier будут спорить до бесконечности: автоисправление одного отменяет другой. `eslint-config-prettier` последним в конфиге гасит конфликтующие правила; проверить, что ничего не осталось, можно его утилитой `npx eslint-config-prettier <файл>`.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Обновление Prettier — это переформатирование',
    d: 'Новая версия может разложить код иначе. С `^3.9.0` в `package.json` разработчики и CI получат разные версии и разный вывод. Версию закрепляют точно, а обновление делают отдельным коммитом с переформатированием всего проекта.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Philip Wadler — A prettier printer',
    href: 'https://homepages.inf.ed.ac.uk/wadler/papers/prettier/prettier.pdf',
    what: 'исходный алгоритм: документ из текста, переносов, отступов и групп, жадный выбор по остатку строки',
  },
  {
    title: 'Prettier — commands.md (Doc builders)',
    href: 'https://github.com/prettier/prettier/blob/main/commands.md',
    what: 'описание `group`, `fill`, `ifBreak`, `conditionalGroup`, `breakParent` и остальных команд Doc',
  },
  {
    title: 'Prettier — printer.js',
    href: 'https://github.com/prettier/prettier/blob/main/src/document/printer/printer.js',
    what: '`printDocToString` и `fits` — с ними сверяется учебный принтер темы (версия 3.9.6 на стенде)',
  },
  {
    title: 'James Long — A Prettier Formatter',
    href: 'https://archive.jlongster.com/A-Prettier-Formatter',
    what: 'автор Prettier о том, как принтер recast переписали на алгоритм Вадлера',
  },
  {
    title: 'Prettier — Rationale',
    href: 'https://prettier.io/docs/rationale',
    what: 'что сохраняется из исходника: пустые строки, перенос после `{` у объектов; `printWidth` как ориентир',
  },
  {
    title: 'Prettier — Options',
    href: 'https://prettier.io/docs/options',
    what: '`printWidth`, `objectWrap` (с версии 3.5)',
  },
  {
    title: 'Prettier — Integrating with Linters',
    href: 'https://prettier.io/docs/integrating-with-linters',
    what: 'почему не советуют запускать Prettier как правило ESLint',
  },
  {
    title: 'eslint-config-prettier',
    href: 'https://github.com/prettier/eslint-config-prettier',
    what: 'какие правила гасит конфиг, плоский конфиг, утилита проверки конфликтов',
  },
  {
    title: 'Prettier #20162 — Line comment after `case …:` before a block is unstable',
    href: 'https://github.com/prettier/prettier/issues/20162',
    what: 'нестабильный случай из раздела про идемпотентность; воспроизводится на 3.9.6',
  },
  {
    title: 'Prettier #20175 — Comment between `export` and a decorator adds a blank line',
    href: 'https://github.com/prettier/prettier/issues/20175',
    what: 'пустая строка, которая растёт с каждым прогоном',
  },
  {
    title: 'Prettier — Install',
    href: 'https://prettier.io/docs/install',
    what: '`--save-exact`: даже патч-версия может форматировать иначе',
  },
  {
    title: 'Unicode Standard Annex #11 — East Asian Width',
    href: 'https://www.unicode.org/reports/tr11/',
    what: 'какие знаки «широкие»; по этой таблице Prettier считает ширину',
  },
];

export const RELATED =
  'Смежное на сайте: [AST и линтеры, раздел «Codemod и Prettier»](/tooling/ast-linters/#s7) — чем принтер отличается от правок по `range` и от Babel. [AST и линтеры, раздел «От текста к дереву»](/tooling/ast-linters/#s1) — что строит парсер до Prettier. [Unicode и Intl, раздел «Графемы»](/js/unicode-intl/#s2) — почему «символ» на экране и в строке — разные вещи. [Diff: как git и фреймворки находят разницу](/algorithms/diff/) — что видит ревьюер после переформатирования. [Source maps изнутри](/tooling/source-maps/) — как сборка, которая тоже печатает код заново, сохраняет дорогу к исходнику.';
