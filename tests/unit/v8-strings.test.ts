import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  BYTES_ROWS,
  CHAIN_ROWS,
  COPY_WAYS,
  EQ_BARS,
  INTERN_NO,
  INTERN_YES,
  PITFALLS,
  REPS,
  TWO_BYTE_FALSE_ALARMS,
  TWO_BYTE_TRAPS,
  UNICODE_SAMPLES,
  UTF8_GAP_ROWS,
  UTF8_GAP_TONES,
} from '@/content/lessons/v8-strings/data';
import {
  LATIN1_MAX,
  codePoints,
  codeUnits,
  encoderReady,
  graphemeCount,
  graphemes,
  hex,
  isHighSurrogate,
  isLowSurrogate,
  isTwoByte,
  maxCharCode,
  segmenterReady,
  sliceUnits,
  storageBytes,
  utf8Bytes,
} from '@/widgets/unicode-inspector/model/unicode';
import {
  WEIGHT_SAMPLES,
  firstAboveLatin1,
  unavailable,
  weighAll,
  weighSample,
} from '@/widgets/string-weight/model/weigh';

/**
 * Утверждения темы «Строки в V8» — запуском, а не по памяти.
 *
 * Тема почти целиком состоит из фактов, которые движок может подтвердить сам: тип представления,
 * порог в 13 символов, удержание родителя, предел длины, счёт кодовых единиц и байт. До этого
 * файла ни одно из них не было закреплено ничем — а половина чисел в `data.ts` снята на **другой**
 * сборке (Node 24.11 / V8 13.6), и расхождение с нынешним движком обязано быть красным тестом,
 * а не находкой читателя.
 *
 * Как это устроено:
 *
 *   1. **Представления** наблюдаются только под `--allow-natives-syntax`, и включить флаг
 *      в самом Vitest нельзя. Поэтому такие проверки уходят отдельным процессом Node — тем же
 *      приёмом, что в `tests/unit/elements-kinds.test.ts` и `tests/unit/v8-engine.test.ts`.
 *      Ожидание при этом берётся **из самих данных урока** (`REPS[i].type`): если кто-то поправит
 *      тип в тексте, тест спросит движок и покажет, что текст разошёлся с ним.
 *   2. **Удержание памяти** меряется так же, как его мерил автор темы: держим результат, роняем
 *      пятидесятимегабайтного родителя, шесть раз зовём сборку, смотрим `heapUsed`. В процессе
 *      Vitest сборки нет (`AGENTS.md`, «Память, сборщик и строки»), поэтому снова отдельный процесс
 *      с `--expose-gc`.
 *   3. **Юникод и вес** считает не тест, а модель урока — `widgets/unicode-inspector/model/unicode.ts`
 *      и `widgets/string-weight/model/weigh.ts`. Демо и тест обязаны спрашивать движок одним
 *      и тем же кодом, иначе «проверено запуском» относится к разовому запуску.
 *
 * ⚠️ **Закрепляется отношение, а не миллисекунды и не мегабайты.** Абсолютные числа `EQ_BARS`,
 * `REDOS_BARS`, `FLAT_ROWS` и `COPY_WAYS` сняты на конкретной машине; здесь сверяется то, что
 * от машины не зависит: во сколько раз одно дороже другого и по какую сторону контрольного
 * замера лежит результат.
 *
 * ⚠️ **Имя ошибки нормативно, текст — нет.** У предела длины строки проверяется `RangeError`,
 * а не формулировка V8.
 *
 * ⚠️ Всё, что здесь про типы представлений, — **детали реализации V8**, а не гарантии языка.
 * Тест и нужен затем, чтобы смена поведения в новой версии Node остановила сборку.
 *
 * Внешние строки (`EXTERNAL_ONE_BYTE_STRING_TYPE`) раньше не проверялись — «в Node получить
 * не удалось». Получить удалось (2026-10-01): `%FunctionGetScriptSource` у функции встроенного
 * модуля возвращает исходник модуля, и он внешний. Браузерная половина (Chromium 153: исходник
 * и файла, и встроенного `<script>` — внешняя строка) снята вручную и записана в `verified`.
 */

// ---------------------------------------------------------------------------
// Инструменты
// ---------------------------------------------------------------------------

/** Медиана: одиночный выброс на занятой машине не должен решать исход. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * ⚠️ **`%DebugPrint` печатает содержимое строки целиком — печатать большие строки нельзя.**
 * Обе половины этой ловушки найдены здесь запуском:
 *
 *   - при стандартном `maxBuffer` в один мегабайт печать `'x'.repeat(50 * 1024 * 1024)` роняет
 *     процесс с `ENOBUFS`, и в отчёте это выглядит не как переполнение буфера, а как
 *     провалившаяся проверка типа;
 *   - подняв потолок, получаешь второе дно: 52 МБ вывода стоят **36 секунд** буферизации
 *     в `execFileSync`, и проверка отваливается уже по таймауту.
 *
 * Отсюда правило для этого файла: под `%DebugPrint` уходят только короткие строки, а утверждения
 * про пятидесятимегабайтные проверяются замером памяти, где не печатается ничего. Потолок ниже
 * оставлен с запасом на промежуточные случаи — самая большая печать здесь около 200 КБ.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

/** Прогнать код в отдельном Node с нативным синтаксисом. */
function natives(source: string): string {
  return execFileSync(process.execPath, ['--allow-natives-syntax', '-e', source], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
}

/**
 * Все типы, которые напечатал `%DebugPrint`, по порядку. Одна печать даёт ровно одну строку
 * `- type:` в начале строки, поэтому несколько проверок безопасно складываются в один процесс:
 * запуск Node дороже самой проверки.
 */
function debugTypes(source: string): string[] {
  return [...natives(source).matchAll(/^ - type: (\w+)$/gm)].map((m) => m[1]);
}

/** Адреса объектов из того же вывода: `flatten` обязан оставить объект на месте. */
function debugAddresses(source: string): string[] {
  return [...natives(source).matchAll(/^DebugPrint: (0x[0-9a-f]+)/gm)].map((m) => m[1]);
}

/**
 * Сколько мегабайт остаётся живыми, если удержать `keptExpr` и отпустить родителя.
 *
 * Схема повторяет замер из `data.ts` дословно: родитель на 50 МБ, принудительное расплющивание
 * (иначе `repeat` вернёт дерево и мерить будет нечего), шесть сборок, `heapUsed`. Переменная
 * называется и `big`, и `s` — ровно так операции записаны в `COPY_WAYS` и `CHAIN_ROWS`, и это
 * позволяет подставлять код прямо из данных урока.
 */
function heldMb(keptExpr: string): number {
  const source = `
    let kept = null;
    (() => {
      const big = 'x'.repeat(50 * 1024 * 1024);
      big.charCodeAt(0);
      const s = big;
      kept = (${keptExpr});
    })();
    for (let i = 0; i < 6; i++) global.gc();
    process.stdout.write(String(process.memoryUsage().heapUsed / 1048576));
    // Результат обязан дожить до замера, иначе мерить нечего.
    if (kept !== null && typeof kept === 'string' && kept.length === -1) process.stdout.write('!');
  `;
  const out = execFileSync(process.execPath, ['--expose-gc', '-e', source], { encoding: 'utf8' });
  const mb = Number.parseFloat(out);
  if (!Number.isFinite(mb)) throw new Error(`замер не дал числа: ${JSON.stringify(out)}`);
  return mb;
}

/** Контроль: прогон, в котором не держат ничего. Всё остальное сравнивается с ним. */
let control: number | null = null;
function controlMb(): number {
  if (control === null) control = heldMb('null');
  return control;
}

/** Состояние «рентгена» по подписи: пропажа подписи обязана падать внятно, а не тихо пропускать. */
function rep(label: string) {
  const found = REPS.find((r) => r.label === label);
  if (!found) throw new Error(`состояния «${label}» в REPS нет — проверка осталась без предмета`);
  return found;
}

/**
 * Пункт «тонкого места» по началу заголовка, а не по номеру: номера пересобираются, когда
 * пункт снимают (2026-10-01 сняты два дубля тела темы), а заголовок — то, что читатель видит.
 */
function pitfall(title: string) {
  const found = PITFALLS.find((p) => p.t.startsWith(title));
  if (!found) throw new Error(`тонкого места «${title}» в PITFALLS нет — проверка осталась без предмета`);
  return found;
}

/** Первое число из ячейки таблицы: «+19.1 МБ» → 19.1, «53.2 МБ» → 53.2. */
function numberIn(cell: string): number {
  const found = cell.match(/-?\d+(?:\.\d+)?/);
  if (!found) throw new Error(`в ячейке «${cell}» нет числа`);
  return Number.parseFloat(found[0]);
}

/** Байты из ячейки `UTF8_GAP_ROWS`: «2 байта» → 2, «2 × 2 байта» → 4. */
function bytesIn(cell: string): number {
  const nums = cell.match(/\d+/g);
  if (!nums) throw new Error(`в ячейке «${cell}» нет числа`);
  return nums.map(Number).reduce((a, b) => a * b, 1);
}

// ---------------------------------------------------------------------------
// Раздел 1 · представления: что печатает %DebugPrint
// ---------------------------------------------------------------------------

describe('представления строк — тип из %DebugPrint, а не из памяти автора', () => {
  /**
   * Восемь состояний «рентгена», у которых тип наблюдаем тем же сценарием, что в данных.
   * Девятое (исходник скрипта) — отдельной проверкой ниже: в Node внешний только исходник
   * встроенного модуля.
   *
   * Ожидание берётся из `REPS[i].type`: сверяются данные урока с движком, а не тест с тестом.
   */
  const cases: [string, string][] = [
    ['литерал', "%DebugPrint('hello world');"],
    ['один нелатинский символ', "%DebugPrint('aaaaaaaaaaaaaaaaaaaaф');"],
    ['a + b короткое', "%DebugPrint('ab' + String.fromCharCode(99));"],
    ['a + b длинное', "const a = 'x'.repeat(100000); %DebugPrint(a + 'tail');"],
    // ⚠️ Здесь печатается строка покороче, чем в `REPS[i].code`: пятьдесят мегабайт вывода
    // стоят 36 секунд буферизации (см. `MAX_BUFFER`). Тип от длины не зависит — дерево
    // получается с тринадцатого символа, — а само утверждение про 50 МБ закрыто замером
    // памяти в разделе 3, где не печатается ничего.
    ['repeat — тоже дерево', "%DebugPrint('x'.repeat(100000));"],
    ['slice(0, 12)', "const b = 'x'.repeat(100000); %DebugPrint(b.slice(0, 12));"],
    ['slice(0, 13)', "const b = 'x'.repeat(100000); %DebugPrint(b.slice(0, 13));"],
    ['obj[s] = 1', "const k = ['user','name','field'].join('_'); const o = {}; o[k] = 1; %DebugPrint(k);"],
  ];

  it('все восемь наблюдаемых состояний совпадают с тем, что записано в REPS', () => {
    // Каждый случай — в своём блоке: имена переменных у соседей повторяются, и без блока
    // весь пакет не скомпилировался бы («Identifier has already been declared»).
    const actual = debugTypes(cases.map(([, code]) => `{ ${code} }`).join('\n'));

    expect(actual, 'печатей столько же, сколько состояний').toHaveLength(cases.length);
    for (const [i, [label]] of cases.entries()) {
      expect(actual[i], `состояние «${label}»`).toBe(rep(label).type);
    }
  }, 30_000);

  it('исходник скрипта — внешняя строка: в Node так хранится исходник встроенного модуля', () => {
    // `%FunctionGetScriptSource` отдаёт исходник целиком (у `fs` это ~100 КБ печати — в пределах
    // `MAX_BUFFER`). Свой файл Node читает в кучу, поэтому для контроля рядом — функция из `-e`:
    // её исходник обязан оказаться обычной строкой, иначе проверка не отличает «внешняя» от «любая».
    const [builtin, own] = debugTypes(`
      %DebugPrint(%FunctionGetScriptSource(require('fs').readFileSync));
      function own() {}
      %DebugPrint(%FunctionGetScriptSource(own));
    `);

    const external = rep('исходник скрипта');
    expect(builtin, 'исходник встроенного модуля fs').toBe(external.type);
    expect(own, 'исходник своего кода — в куче, не внешний').toMatch(/^SEQ_/);
    // Текст называет обе среды: браузерную половину тест повторить не может, и пропажа
    // её подписи — это возврат к «пересказу документации».
    expect(external.verified).toContain('Chromium 153');
    expect(external.verified).toContain('fs');
  }, 30_000);
});

describe('порог 13 — и у среза, и у конкатенации', () => {
  /**
   * Главное число раздела 1. `slice(0, 12)` копирует, `slice(0, 13)` делает окно в родителя —
   * отсюда весь класс утечек, которому посвящена тема.
   *
   * ⚠️ Правка темы, которую этот блок и закрепляет: **`substring` и `substr` ведут себя точно
   * так же.** Расхожий совет «перейдите на `substring`, чтобы не держать родителя» не работает:
   * внутри V8 все три имени идут одним путём.
   */
  const probe = `
    const big = 'x'.repeat(100000);
    %DebugPrint(big.slice(0, 12));
    %DebugPrint(big.slice(0, 13));
    %DebugPrint(big.substring(0, 12));
    %DebugPrint(big.substring(0, 13));
    %DebugPrint(big.substr(0, 12));
    %DebugPrint(big.substr(0, 13));
  `;

  it('12 копируется, 13 даёт окно — и так у всех трёх имён вырезания', () => {
    const [slice12, slice13, substring12, substring13, substr12, substr13] = debugTypes(probe);

    expect(slice12, 'slice(0, 12)').toBe(rep('slice(0, 12)').type);
    expect(slice13, 'slice(0, 13)').toBe(rep('slice(0, 13)').type);

    expect(substring12, 'substring(0, 12) — тот же порог').toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(substring13, 'substring(0, 13) — то же окно').toBe('SLICED_ONE_BYTE_STRING_TYPE');
    expect(substr12, 'substr(0, 12) — тот же порог').toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(substr13, 'substr(0, 13) — то же окно').toBe('SLICED_ONE_BYTE_STRING_TYPE');
  }, 30_000);

  it('у конкатенации порог тот же: 12 копируется, 13 даёт узел', () => {
    // Строки собираются в рантайме: иначе парсер сложит литералы ещё до исполнения,
    // и мерить будет нечего — ровно поэтому в данных стоит `String.fromCharCode`.
    const [twelve, thirteen] = debugTypes(`
      %DebugPrint('abcdefghijk' + String.fromCharCode(108));
      %DebugPrint('abcdefghijkl' + String.fromCharCode(109));
    `);

    expect(twelve, 'длина 12 — ниже порога').toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(thirteen, 'длина 13 — уже узел').toBe('CONS_ONE_BYTE_STRING_TYPE');
    // Данные обещают ровно это в поле `verified` у короткой конкатенации.
    expect(rep('a + b короткое').verified).toContain('CONS_ONE_BYTE_STRING_TYPE');
  }, 30_000);

  it('и у repeat порог тот же — дерево начинается с тринадцатого символа', () => {
    const [twelve, thirteen] = debugTypes(`
      %DebugPrint('x'.repeat(12));
      %DebugPrint('x'.repeat(13));
    `);

    // Тот же порог, что у среза и у конкатенации: `repeat` строит результат удвоениями,
    // и на коротком результате дерево не окупается.
    expect(twelve, 'repeat(12) — плоская строка').toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(thirteen, 'repeat(13) — уже дерево').toBe('CONS_ONE_BYTE_STRING_TYPE');
  }, 30_000);
});

describe('тонкое место «Расплющенная строка остаётся ConsString»', () => {
  it('flatten не меняет ни тип, ни адрес объекта', () => {
    const probe = `
      const big = 'x'.repeat(100000);
      const s = big + 'tail';
      %DebugPrint(s);
      s.charCodeAt(0);
      %DebugPrint(s);
    `;

    const types = debugTypes(probe);
    expect(types, 'две печати: до и после расплющивания').toHaveLength(2);
    expect(types[0], 'до').toBe('CONS_ONE_BYTE_STRING_TYPE');
    expect(types[1], 'после — тип тот же, а не «стал SeqString»').toBe('CONS_ONE_BYTE_STRING_TYPE');

    const addresses = debugAddresses(probe);
    expect(addresses, 'два адреса').toHaveLength(2);
    // Адрес менять нельзя: на него уже кто-то ссылается. Именно поэтому проверять
    // «расплющена ли строка» через тип бессмысленно — это и есть суть тонкого места.
    expect(addresses[1], 'объект остался на месте').toBe(addresses[0]);

    expect(pitfall('Расплющенная строка').d).toContain('не создаёт новый объект и не меняет тип');
  }, 30_000);
});

describe('тонкое место «Совпадения регулярки — это SlicedString»', () => {
  it('match длиннее порога даёт окно в строку, по которой искали', () => {
    const [matched] = debugTypes(`
      const big = 'x'.repeat(100000);
      %DebugPrint(big.match(/x{20}/)[0]);
    `);

    expect(matched).toBe('SLICED_ONE_BYTE_STRING_TYPE');
    expect(pitfall('Совпадения регулярки').t).toContain('SlicedString');
  }, 30_000);
});

describe('по типу нельзя судить, копия перед вами или нет', () => {
  it('приём с копированием даёт ровно тот же SLICED, что и настоящее окно', () => {
    const [window, copy, normalized] = debugTypes(`
      const big = 'x'.repeat(100000);
      %DebugPrint(big.slice(0, 100));
      %DebugPrint((' ' + big.slice(0, 100)).slice(1));
      %DebugPrint(big.slice(0, 100).normalize());
    `);

    // Три разных по цене вещи и один тип на всех: окно в стомегабайтного родителя,
    // честная копия и `normalize`, который копией не является вопреки совету.
    expect(window).toBe('SLICED_ONE_BYTE_STRING_TYPE');
    expect(copy, 'копия неотличима по типу').toBe('SLICED_ONE_BYTE_STRING_TYPE');
    expect(normalized).toBe('SLICED_ONE_BYTE_STRING_TYPE');
    // Тонкого места об этом больше нет (дублировало карточку раздела про копию) — держится
    // сама таблица замера: приём с тем же SLICED-типом числится копией.
    const classic = COPY_WAYS.find((w) => w.code === "(' ' + s.slice(0, 100)).slice(1)");
    expect(classic, 'классического приёма в COPY_WAYS нет').toBeDefined();
    expect(classic!.copies).toBe(true);
  }, 30_000);
});

describe('тонкое место «Короткий срез может стать однобайтным, длинный — нет»', () => {
  it('однобайтной копию делает посимвольная пересборка, а не склейка со срезом', () => {
    const [short, window, glued, spread, json, split] = debugTypes(`
      const big = 'ф' + 'x'.repeat(100000);
      %DebugPrint(big.slice(1, 13));
      %DebugPrint(big.slice(1, 101));
      %DebugPrint((' ' + big.slice(1, 101)).slice(1));
      %DebugPrint([...big.slice(1, 101)].join(''));
      %DebugPrint(JSON.parse(JSON.stringify(big.slice(1, 101))));
      %DebugPrint(big.slice(1, 101).split('').join(''));
    `);

    expect(short, 'короче порога — копия, и уже однобайтная').toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(window, 'окно читает в кодировке родителя').toBe('SLICED_TWO_BYTE_STRING_TYPE');
    expect(glued, "(' ' + s).slice(1) родителя отпускает, но остаётся двухбайтной")
      .toBe('SLICED_TWO_BYTE_STRING_TYPE');
    expect(spread).toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(json).toBe('SEQ_ONE_BYTE_STRING_TYPE');
    expect(split).toBe('SEQ_ONE_BYTE_STRING_TYPE');

    // Текст пункта называет обе стороны — и способ, который экономит, и тот, что нет.
    const item = pitfall('Короткий срез');
    expect(item.d).toContain("[...s].join('')");
    expect(item.d).toContain('остаётся двухбайтной');
  }, 30_000);
});

describe('интернирование — что превращает строку в ThinString', () => {
  /**
   * Каждый случай получает свою строку: суффикс делает её уникальной, и интернирование одной
   * не задевает соседнюю. Первая печать до операции нужна затем, чтобы видеть, что строка
   * действительно начинала жизнь плоской, — иначе проверка утратила бы предмет.
   */
  const probe = `
    const mk = (n) => ['user', 'name', 'field', n].join('_');
    const a = mk(1); %DebugPrint(a); const o = {}; o[a] = 1;       %DebugPrint(a);
    const b = mk(2); %DebugPrint(b); const arr = []; arr.push(b);  %DebugPrint(b);
    const c = mk(3); %DebugPrint(c); if (c === mk(4)) {}           %DebugPrint(c);
    const d = mk(5); %DebugPrint(d); new Map().set(d, 1);          %DebugPrint(d);
    const e = mk(6); %DebugPrint(e); new Set().add(e);             %DebugPrint(e);
  `;

  const SEQ = 'SEQ_ONE_BYTE_STRING_TYPE';
  const THIN = 'THIN_ONE_BYTE_STRING_TYPE';

  it('имя свойства интернирует, массив и === — нет', () => {
    const t = debugTypes(probe);
    expect(t, 'пять случаев по две печати').toHaveLength(10);

    expect(t[0], 'до').toBe(SEQ);
    expect(t[1], 'obj[s] = 1 переписывает объект на месте').toBe(THIN);

    expect(t[2], 'до').toBe(SEQ);
    expect(t[3], 'помещение в массив ничего не меняет').toBe(SEQ);

    expect(t[4], 'до').toBe(SEQ);
    expect(t[5], '=== сравнил и ушёл').toBe(SEQ);

    // Данные обещают ровно это.
    expect(INTERN_YES.some((line) => line.includes('obj[s] = 1'))).toBe(true);
    expect(INTERN_NO.some((line) => line.includes('массив'))).toBe(true);
  }, 30_000);

  it('ключ коллекции интернирует: Map.set и Set.add дают THIN', () => {
    const t = debugTypes(probe);

    expect(t[6], 'до').toBe(SEQ);
    expect(t[7], 'после Map.set').toBe(THIN);
    expect(t[8], 'до').toBe(SEQ);
    expect(t[9], 'после Set.add').toBe(THIN);
  }, 30_000);

  /**
   * Расхождение, которое этот блок раньше только фиксировал, теперь **исправлено в теме**.
   *
   * Было: `INTERN_NO` перечислял `Map.set`, `Map.get` и `Set.add` среди операций, которые строку
   * не интернируют, а `verified` у состояния `obj[s] = 1` обещал «после Map.set тип остаётся
   * SEQ_ONE_BYTE_STRING_TYPE». Это было верно на Node 24.11 / V8 13.6 и перестало быть верным
   * на V8 14.6 — отдельный род устаревания: не «записали неправильно», а «было правдой».
   *
   * Теперь тест держит текст с другой стороны: операции переехали в `INTERN_YES`, и проверка
   * не даёт им вернуться обратно, а `verified` обязан называть **обе** версии — иначе читатель
   * не поймёт, почему у него на старом Node выходит иначе.
   */
  it('текст темы говорит то же, что движок, и помнит обе версии', () => {
    expect(
      INTERN_NO.some((line) => /Map\.set|Map\.get|Set\.add/.test(line)),
      'операции с коллекциями вернулись в список «не интернирует»',
    ).toBe(false);
    expect(
      INTERN_YES.some((line) => line.includes('Map.set')),
      'в списке «интернирует» нет ключа коллекции',
    ).toBe(true);

    const verified = rep('obj[s] = 1').verified;
    expect(verified, 'пропала старая версия — читатель не поймёт расхождение').toContain('13.6');
    expect(verified, 'пропала новая версия — непонятно, на чём снято').toContain('14.6');
    expect(verified).toContain('THIN_ONE_BYTE_STRING_TYPE');
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Раздел 3 · удержание памяти: что копирует, а что держит родителя
// ---------------------------------------------------------------------------

describe('копия или окно — по удержанной памяти, а не по типу', () => {
  /**
   * ⚠️ Мегабайты здесь не сверяются дословно: `data.ts` знает 3.2 и 53.2, а на другой машине
   * и другой сборке контроль будет свой. Сверяется отношение к **измеренному в этом же прогоне**
   * контролю: копия остаётся рядом с ним, окно уносит с собой пятидесятимегабайтного родителя.
   * Между «рядом» и «унесло» лежит сорок пять мегабайт — перепутать их шумом невозможно.
   */
  const near = 5;
  const far = 40;

  for (const way of COPY_WAYS) {
    it(`${way.code} → ${way.copies ? 'копия' : 'держит родителя'}`, () => {
      const mb = heldMb(way.code);
      const base = controlMb();

      if (way.copies) {
        expect(mb, `${way.code}: обещана копия (${way.mb} МБ при контроле ~${base.toFixed(1)})`)
          .toBeLessThan(base + near);
      } else {
        expect(mb, `${way.code}: обещано удержание (${way.mb} МБ при контроле ~${base.toFixed(1)})`)
          .toBeGreaterThan(base + far);
      }
    }, 60_000);
  }

  it('цепочки из CHAIN_ROWS удерживают ровно то, что обещано', () => {
    const base = controlMb();

    for (const row of CHAIN_ROWS) {
      const promised = numberIn(row[1]);
      const mb = heldMb(row[0]);
      // Обещанное число сравнивается с контролем той же таблицы: 3.2 — это «рядом с контролем»,
      // 53.2 — «унесло родителя». Само число машинозависимо, сторона — нет.
      if (promised < 10) expect(mb, `${row[0]}: обещана копия`).toBeLessThan(base + near);
      else expect(mb, `${row[0]}: обещано удержание`).toBeGreaterThan(base + far);
    }
  }, 60_000);

  it('repeat возвращает дерево, и буфера ещё нет', () => {
    const base = controlMb();

    const untouched = heldMb("'x'.repeat(50 * 1024 * 1024)");
    const touched = heldMb("(() => { const r = 'x'.repeat(50 * 1024 * 1024); r.charCodeAt(0); return r; })()");

    // Держим строку на 52 миллиона символов, а память показывает контроль: содержимое
    // не материализовано. Именно из-за этого замер памяти, написанный на `repeat`
    // без принудительного расплющивания, меряет пустоту.
    expect(untouched, 'дерево ничего не весит').toBeLessThan(base + near);
    expect(touched, 'первое обращение к символам оплачивает всё разом').toBeGreaterThan(base + far);
    // Тонкое место об этом снято как дубль карточки; держится подпись состояния в демо.
    expect(rep('repeat — тоже дерево').holds.text).toContain('не материализован');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Тонкое место · предел длины строки
// ---------------------------------------------------------------------------

describe('тонкое место «Максимальная длина строки — жёсткий предел»', () => {
  const LIMIT = 536_870_888;

  it('предел ровно 2²⁹ − 24 кодовых единиц', () => {
    expect(LIMIT).toBe(2 ** 29 - 24);
    // Число названо в тексте тонкого места — если предел сменится, поправить придётся оба места.
    expect(pitfall('Максимальная длина').d).toContain('536 870 888');
  });

  it('ровно на пределе строка получается, на единицу выше — RangeError', () => {
    // `repeat` возвращает дерево, содержимое не материализуется — проверка стоит миллисекунды,
    // а не полгигабайта.
    expect('x'.repeat(LIMIT).length).toBe(LIMIT);

    // ⚠️ Имя ошибки нормативно, текст — нет: V8 вправе переписать сообщение.
    expect(() => 'x'.repeat(LIMIT + 1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · юникод: четыре уровня одной строки
// ---------------------------------------------------------------------------

describe('юникод — четыре уровня считает модель урока', () => {
  /** Ожидания по каждому образцу: единицы, точки, графемы, байты UTF-8, двухбайтность, байты в памяти. */
  const expected: Record<string, [number, number, number, number, boolean, number]> = {
    'a': [1, 1, 1, 1, false, 1],
    'ф': [1, 1, 1, 2, true, 2],
    '😀': [2, 1, 1, 4, true, 4],
    '☀': [1, 1, 1, 3, true, 2],
    '👍🏽': [4, 2, 1, 8, true, 8],
    '👨‍👩‍👧‍👦': [11, 7, 1, 25, true, 22],
    '🇷🇺': [4, 2, 1, 8, true, 8],
    'é в NFC': [1, 1, 1, 2, false, 1],
    'é в NFD': [2, 2, 1, 3, true, 4],
    'строка превью': [26, 25, 25, 43, true, 52],
  };

  it('среда умеет считать графемы и байты — иначе проверять нечего', () => {
    expect(segmenterReady(), 'Intl.Segmenter').toBe(true);
    expect(encoderReady(), 'TextEncoder').toBe(true);
  });

  it('набор образцов не разъехался с набором ожиданий', () => {
    // Новый образец без ожидания — это тихая дыра в проверке, поэтому она красная.
    expect(UNICODE_SAMPLES.map((s) => s.label).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const sample of UNICODE_SAMPLES) {
    it(`«${sample.label}» — единицы, точки, графемы, байты`, () => {
      const [units, points, graph, utf8, twoByte, storage] = expected[sample.label];

      expect(codeUnits(sample.value), 'кодовые единицы UTF-16').toHaveLength(units);
      expect(sample.value.length, '.length — это они же').toBe(units);
      expect(codePoints(sample.value), 'кодовые точки').toHaveLength(points);
      expect(graphemes(sample.value), 'графемы').toHaveLength(graph);
      expect(graphemeCount(sample.value)).toBe(graph);
      expect(utf8Bytes(sample.value), 'байты UTF-8').toBe(utf8);
      expect(isTwoByte(sample.value), 'двухбайтное представление').toBe(twoByte);
      expect(storageBytes(sample.value), 'байты в памяти V8').toBe(storage);
    });
  }

  it('суррогатная пара видна в кодовых единицах, а не в кодовых точках', () => {
    const [high, low] = codeUnits('😀');

    expect(high.kind).toBe('high');
    expect(low.kind).toBe('low');
    expect(isHighSurrogate(high.code)).toBe(true);
    expect(isLowSurrogate(low.code)).toBe(true);
    // У половинки пары своего знака нет — рисовать в таблице нечего.
    expect(high.char).toBe('');
    expect(hex(high.code)).toBe('D83D');
    expect(hex('ф'.charCodeAt(0))).toBe('0444');
    expect(maxCharCode('')).toBe(0);
  });

  it('граница однобайтности проходит по U+00FF, а не по U+007F', () => {
    expect(LATIN1_MAX).toBe(0xff);
    // é, ©, ± — это первые 256 кодовых точек, и строка с ними остаётся однобайтной.
    expect(isTwoByte('é©±')).toBe(false);
    expect(isTwoByte('ÿ')).toBe(false);
    expect(isTwoByte('Ā')).toBe(true);
    expect(TWO_BYTE_FALSE_ALARMS.some((line) => line.includes('U+00A0'))).toBe(true);
  });

  it('⚠️ двухбайтность приносит выход за латиницу-1, а не суррогатная пара', () => {
    /**
     * Место темы, где расхожее объяснение врёт чаще всего, — и правка, которую этот блок
     * закрепляет. ☀ U+2600, ❤ U+2764 и ⭐ U+2B50 живут в основной плоскости: **одна** кодовая
     * единица, пары нет. 😀 U+1F600 — две. Двухбайтными строку делают и те, и другие.
     */
    for (const [char, units] of [['☀', 1], ['❤', 1], ['⭐', 1], ['😀', 2]] as [string, number][]) {
      expect(char.length, `${char}: кодовых единиц`).toBe(units);
      expect(codeUnits(char).some((u) => u.kind !== 'plain'), `${char}: есть ли половинки пары`)
        .toBe(units === 2);
      expect(isTwoByte(char), `${char}: строка всё равно двухбайтная`).toBe(true);
    }

    // Обе половины утверждения названы в тексте — короткой смысловой подстрокой, ради которой
    // правка и делалась. Уберут одну — тест покраснеет.
    const trap = TWO_BYTE_TRAPS.find((line) => line.includes('U+2600'));
    expect(trap, 'пункта про эмодзи в TWO_BYTE_TRAPS нет').toBeDefined();
    expect(trap).toContain('ОДНУ кодовую единицу');
    expect(trap).toContain('выход за латиницу-1');
  });

  it('разрез по кодовым единицам ломает суррогатную пару ровно там, где обычно режут превью', () => {
    const preview = UNICODE_SAMPLES.find((s) => s.label === 'строка превью');
    expect(preview, 'образца «строка превью» нет').toBeDefined();
    const value = preview!.value;

    const broken = sliceUnits(value, 19);
    expect(broken.broken, 'обрезка попала внутрь пары').toBe(true);
    expect(broken.units).toBe(19);
    expect(broken.text.charCodeAt(18), 'осталась одинокая верхняя половина')
      .toBe(value.charCodeAt(18));
    expect(isHighSurrogate(broken.text.charCodeAt(18))).toBe(true);

    const whole = sliceUnits(value, 20);
    expect(whole.broken, 'на единицу дальше пара цела').toBe(false);
    expect(whole.points).toBe(19);

    // Края: срез за пределами строки не ломает ничего и не выходит за длину.
    expect(sliceUnits(value, 0).broken).toBe(false);
    expect(sliceUnits(value, 999).units).toBe(value.length);
    expect(sliceUnits(value, -5).units).toBe(0);
  });

  it('внутреннее представление и UTF-8 — две разные кодировки (UTF8_GAP_ROWS)', () => {
    expect(UTF8_GAP_ROWS).toHaveLength(UTF8_GAP_TONES.length);

    for (const [i, row] of UTF8_GAP_ROWS.entries()) {
      const point = row[0].match(/U\+([0-9A-F]+)/);
      expect(point, `в подписи «${row[0]}» нет кодовой точки`).not.toBeNull();
      const char = String.fromCodePoint(Number.parseInt(point![1], 16));

      expect(storageBytes(char), `${row[0]}: байт в памяти V8`).toBe(bytesIn(row[1]));
      expect(utf8Bytes(char), `${row[0]}: байт в UTF-8`).toBe(bytesIn(row[2]));

      // Красным помечены ровно те строки, где два счёта разошлись, — не больше и не меньше.
      const diverged = bytesIn(row[1]) !== bytesIn(row[2]);
      expect(UTF8_GAP_TONES[i], `${row[0]}: тон строки`).toBe(diverged ? 'err' : 'ok');
    }
  });

  it('разделитель разрядов: у ru он однобайтный, у fr-FR — нет', () => {
    // Оба утверждения из списков «ловушки» и «ложные тревоги» спрашиваются у движка:
    // это факт сборки ICU, а не мнение автора.
    const ru = new Intl.NumberFormat('ru').format(1234567);
    const fr = new Intl.NumberFormat('fr-FR').format(1234567);

    expect(isTwoByte(ru), 'ru: U+00A0 ≤ U+00FF').toBe(false);
    expect(maxCharCode(ru)).toBe(0x00a0);
    expect(isTwoByte(fr), 'fr-FR: U+202F выше латиницы-1').toBe(true);
    expect(maxCharCode(fr)).toBe(0x202f);

    expect(TWO_BYTE_TRAPS.some((line) => line.includes('U+202F'))).toBe(true);
    expect(TWO_BYTE_FALSE_ALARMS.some((line) => line.includes("Intl.NumberFormat('ru')"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · вес строки: стенд считает то же, что таблица
// ---------------------------------------------------------------------------

describe('вес строки — стенд и таблица считают одинаково', () => {
  it('одна «я» удваивает всю строку, а на UTF-8 добавляет один байт', () => {
    const result = weighAll();
    expect(result.ok).toBe(true);
    expect(result.segmented, 'графемы посчитаны сегментатором').toBe(true);
    expect(result.rows).toHaveLength(WEIGHT_SAMPLES.length);

    const latin = result.rows.find((r) => r.key === 'latin')!;
    const one = result.rows.find((r) => r.key === 'one-cyrillic')!;

    expect(one.units, 'длина та же').toBe(latin.units);
    expect(one.utf8 - latin.utf8, 'в UTF-8 разница ровно в один байт').toBe(1);
    expect(one.storage / latin.storage, 'а в памяти — вдвое').toBe(2);
    expect(latin.twoByte).toBe(false);
    expect(one.twoByte).toBe(true);
    expect(one.culprit, 'виновник назван').toBe('я');
    expect(one.culpritHex).toBe('044F');
  });

  it('байт на кодовую единицу бывает только 1 или 2 — третьего не бывает', () => {
    for (const row of weighAll().rows) {
      expect([1, 2], `${row.key}: ${row.bytesPerUnit}`).toContain(row.bytesPerUnit);
      expect(row.storage).toBe(row.units * row.bytesPerUnit);
      expect(row.maxCode > LATIN1_MAX).toBe(row.twoByte);
    }
  });

  it('сплошная кириллица не дороже латиницы с одной «я»', () => {
    const rows = weighAll().rows;
    const one = rows.find((r) => r.key === 'one-cyrillic')!;
    const all = rows.find((r) => r.key === 'cyrillic')!;

    expect(all.bytesPerUnit).toBe(one.bytesPerUnit);
  });

  it('суррогатная пара видна в units против points, но на двухбайтность не влияет', () => {
    const rows = weighAll().rows;
    const bmp = rows.find((r) => r.key === 'bmp-emoji')!;
    const surrogate = rows.find((r) => r.key === 'surrogate-emoji')!;

    expect(bmp.units - bmp.points, '☀ — одна единица на одну точку').toBe(0);
    expect(surrogate.units - surrogate.points, '😀 — две единицы на одну точку').toBe(1);
    expect(bmp.twoByte).toBe(true);
    expect(surrogate.twoByte).toBe(true);
    // Читателю называют кодовую точку целиком, а не верхний суррогат.
    expect(surrogate.culprit).toBe('😀');
    expect(surrogate.culpritHex).toBe('1F600');
    expect(firstAboveLatin1('the quick brown fox')).toBe('');
  });

  it('когда считать нечем, чисел нет, а не выдуманы', () => {
    const none = unavailable();
    expect(none.ok).toBe(false);
    expect(none.rows).toEqual([]);
    expect(none.note).toContain('TextEncoder');
  });

  it('взвешивание одного образца совпадает с полным прогоном', () => {
    expect(weighSample(WEIGHT_SAMPLES[0])).toEqual(weighAll().rows[0]);
  });
});

describe('BYTES_ROWS — память V8 и UTF-8 расходятся вдвое', () => {
  /**
   * ⚠️ Находка, которую этот блок закрепляет особо: колонка `BYTES_ROWS` считает **байты
   * в памяти V8**, а не UTF-8, и на третьей строке эти два счёта расходятся ровно вдвое.
   * Двадцать миллионов латинских символов и один «я» — это **+38.1 МБ** в куче и **+19.1 МБ**
   * в UTF-8. Оба числа верны, и каждое отвечает на свой вопрос; следующий автор, сверивший
   * одно с другим, «исправит» верное на неверное — поэтому здесь закреплены оба.
   */
  const MB = 1024 * 1024;
  const N = 20_000_000;

  it('строки таблицы совпадают с тем, что считает модель', () => {
    const cases: [string, string][] = [
      ['20 млн латиницы', 'a'.repeat(N)],
      ['20 млн кириллицы', 'я'.repeat(N)],
      ['20 млн латиницы и один «я» в конце', 'a'.repeat(N - 1) + 'я'],
    ];

    expect(BYTES_ROWS.map((r) => r[0])).toEqual(cases.map(([label]) => label));

    for (const [i, [label, value]] of cases.entries()) {
      expect(storageBytes(value) / MB, `${label}: мегабайты в памяти`)
        .toBeCloseTo(numberIn(BYTES_ROWS[i][1]), 1);
      expect(storageBytes(value) / value.length, `${label}: байт на символ`)
        .toBeCloseTo(numberIn(BYTES_ROWS[i][2]), 2);
    }
  });

  it('у третьей строки UTF-8 вдвое меньше памяти — и это не ошибка таблицы', () => {
    const mixed = 'a'.repeat(N - 1) + 'я';

    const inMemory = storageBytes(mixed) / MB;
    const inUtf8 = (utf8Bytes(mixed) ?? 0) / MB;

    expect(inMemory, 'в памяти V8').toBeCloseTo(38.1, 1);
    expect(inUtf8, 'в UTF-8, то есть в файле и в сети').toBeCloseTo(19.1, 1);
    expect(inMemory / inUtf8, 'расхождение ровно вдвое').toBeCloseTo(2, 1);

    // У сплошной кириллицы расхождения нет: там оба счёта дают по два байта на символ.
    const cyrillic = 'я'.repeat(N);
    expect(storageBytes(cyrillic) / MB).toBeCloseTo((utf8Bytes(cyrillic) ?? 0) / MB, 1);
  });
});

// ---------------------------------------------------------------------------
// Раздел 5 · цена сравнения
// ---------------------------------------------------------------------------

describe('цена `===` — отношением, а не наносекундами', () => {
  /**
   * Инвариант «различие в хвосте стоит столько же, сколько полное равенство» уже закреплён
   * в `tests/unit/cost-invariants.test.ts` и здесь не дублируется. Взята другая сторона того же
   * замера: сравнение, которое **не доходит до содержимого**, от длины не зависит вовсе.
   *
   * Ловушки этого замера (обе описаны в `AGENTS.md` и в докстринге `EQ_BARS`):
   *   1) пара, сравнённая дважды, дальше сравнивается по указателю — V8 склеивает равные строки
   *      в `ThinString`. Поэтому **каждая пара живёт ровно одно сравнение**;
   *   2) `repeat` возвращает дерево, и первое же сравнение оплатило бы ещё и расплющивание.
   *      Поэтому обе строки расплющиваются до таймера — иначе мерился бы flatten, а не `===`.
   */
  const LONG = 100_000;
  const RUNS = 21;

  /** Расплющить строку до замера: `charCodeAt` материализует буфер. */
  function flat(value: string): string {
    value.charCodeAt(0);
    return value;
  }

  function timeOnce(make: () => [string, string]): number {
    return median(
      Array.from({ length: RUNS }, () => {
        const [x, y] = make();
        const start = performance.now();
        const equal = x === y;
        const spent = performance.now() - start;
        // Результат обязан быть использован, иначе сравнение вправе исчезнуть целиком.
        return equal ? spent : spent;
      }),
    );
  }

  const equalPair = (): [string, string] => [flat('x'.repeat(LONG)), flat('x'.repeat(LONG))];
  const lengthPair = (): [string, string] => [flat('x'.repeat(LONG)), flat('x'.repeat(LONG - 1))];
  const firstPair = (): [string, string] => [flat('x'.repeat(LONG)), flat('y' + 'x'.repeat(LONG - 1))];

  it('разная длина и различие в первом символе не зависят от длины строки', () => {
    timeOnce(equalPair); // прогрев самой измеряющей функции

    const equal = timeOnce(equalPair);
    const byLength = timeOnce(lengthPair);
    const byFirst = timeOnce(firstPair);

    // На M1 выходит около ×33–49. Порог сильно ниже: он ловит не «стало на 10% быстрее»,
    // а исчезновение самого эффекта — если сравнение разной длины вдруг начнёт читать
    // содержимое, а `memcmp` перестанет выходить на первом различии.
    expect(equal / byLength, 'разная длина против полного равенства').toBeGreaterThan(8);
    expect(equal / byFirst, 'различие в первом символе против полного равенства').toBeGreaterThan(8);

    // Та же тройка стоит на полосах урока — и в том же порядке.
    const bar = (label: string) => {
      const found = EQ_BARS.find((b) => b.label.startsWith(label));
      if (!found) throw new Error(`полосы «${label}» в EQ_BARS нет`);
      return found.value;
    };
    expect(bar('разная длина')).toBeLessThan(bar('две равные копии'));
    expect(bar('различие в первом символе')).toBeLessThan(bar('две равные копии'));
  }, 30_000);

  it('полное равенство линейно по длине: вчетверо длиннее — вчетверо дороже', () => {
    const timeEqual = (len: number) =>
      timeOnce(() => [flat('x'.repeat(len)), flat('x'.repeat(len))]);

    timeEqual(LONG); // прогрев

    const short = timeEqual(LONG);
    const long = timeEqual(LONG * 4);

    // Замер даёт 3.8–4.0; границы широкие, потому что ловится не коэффициент, а характер:
    // `memcmp` проходит строку целиком, значит цена обязана расти вместе с длиной,
    // а не оставаться постоянной и не взрываться.
    expect(long / short, 'вчетверо длиннее').toBeGreaterThan(2);
    expect(long / short).toBeLessThan(8);
  }, 30_000);
});
