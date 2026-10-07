import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LensPreset, PngVariant } from '@/widgets/bytes-lab/model/types';

/**
 * Данные темы «Бинарные данные: ArrayBuffer, TypedArray, DataView, Blob».
 *
 * Тема написана здесь, 2026-10-02.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6), Node **26.8.2** (V8 14.6), Chromium **153.0.8010.12**
 * (Playwright 1.63, headless shell), macOS на arm64, октябрь 2026. Один и тот же файл проб
 * исполнен во всех трёх средах; Chromium — на странице с `localhost:4880`.
 *
 * Что совпало во всех трёх: исключения при невыровненном смещении (`RangeError`), переполнение
 * `Uint8Array`, `Int8Array`, `Uint8ClampedArray` (округление к чётному), порядок байт платформы
 * (little-endian), `TextDecoder` с `stream: true` и без, BOM, `btoa` на кириллице
 * (`InvalidCharacterError`), `Blob`/`File` (размер, `slice`, копия исходных байт), растущий
 * буфер и `transfer()`. Тексты ошибок у Node и Chromium разные — в теме только имена.
 *
 * Что разошлось:
 *   — `Uint8Array.fromBase64`, `toBase64`, `fromHex`, `toHex`, `setFromBase64`: **есть** в
 *     Chromium 153 и Node 26.8.2, **нет** в Node 24.11.0 (`typeof` — `'undefined'`);
 *   — первый чанк `new Blob(['Привет', new Uint8Array([33])]).stream()`: в Node 24/26 — 12 байт
 *     (по частям конструктора), в Chromium — 13 (всё сразу).
 *
 * PNG — настоящий файл кодировщика Chromium: холст 3×2, шесть пикселей разных цветов,
 * `canvas.toBlob(…, 'image/png')`. 105 байт, четыре блока: IHDR, **два** IDAT (30 и 6 байт),
 * IEND. `createImageBitmap` того же Chromium декодирует его как 3×2. Порча байтов, тоже снятая
 * в Chromium 153 через `createImageBitmap`:
 *   — ширина 3 → 4 (CRC IHDR не сходится) — `InvalidStateError`, картинки нет;
 *   — испорчен только CRC IHDR — `InvalidStateError`; испорчен CRC первого IDAT — тоже;
 *   — испорчен CRC IEND — **декодируется**, 3×2;
 *   — обрезан на 60 байтах или испорчен первый байт сигнатуры — `InvalidStateError`.
 *
 * Кроме него, `parsePng` прогнан по трём PNG из `node_modules` проекта (файлы istanbul-reports,
 * @jest/reporters, playwright-core): размеры совпали с тем, что вернул `createImageBitmap`
 * в Chromium (16×16, 70×70, 400×400), CRC всех блоков — с `zlib.crc32` Node.
 *
 * `String.fromCharCode(...bytes)`: 65 536 байт проходят, 125 000 и больше — `RangeError`
 * (Node 24.11; порог зависит от размера стека, в тексте только «на мегабайте падает»).
 *
 * Только из документации, запуском не проверено: что `Blob.slice` не копирует байты (README
 * хранилища блобов Chromium; из JS это не наблюдаемо); что порядок байт TypedArray по
 * спецификации — порядок платформы (на стенде везде little-endian, big-endian машины под рукой
 * нет).
 *
 * Все примеры кода исполняются `tests/unit/binary-data.test.ts`: строки с `// → значение`
 * и `// ✗ ИмяОшибки` сверяются построчно. `parsePng` и `crc32` сверены с `zlib.crc32` и
 * `zlib.inflateSync` на всех файлах выше. Тем же построчным способом все десять примеров
 * (включая `NATIVE_B64_CODE`, который в Node 24 тест пропускает) прогнаны в Chromium 153 —
 * совпали все строки; там же проверены `readAs`, `parsePng`, `RangeError` от
 * `String.fromCharCode(...)` на мегабайте и методы вида на отсоединённом буфере.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '`ArrayBuffer`',
    d: 'Кусок памяти фиксированного размера в байтах. Сам по себе ничего не умеет: ни прочитать байт, ни записать. Это просто место.',
  },
  {
    k: 'вид (view)',
    d: 'Объект, через который буфер читают и пишут: `Uint8Array`, `Float32Array` и ещё десяток типизированных массивов, а также `DataView`. Вид не хранит данных — он говорит, как понимать чужие байты.',
  },
  {
    k: 'порядок байт (endianness)',
    d: 'В каком порядке лежат байты многобайтового числа. **Big-endian** — старший байт первым, как мы пишем цифры. **Little-endian** — младший первым.',
  },
  {
    k: '`Blob` и `File`',
    d: 'Неизменяемый набор байт с типом вроде `image/png`. Байты могут лежать в памяти, на диске или ещё не быть прочитаны. `File` — тот же `Blob` с именем и датой изменения.',
  },
  {
    k: 'base64',
    d: 'Запись байтов печатными символами: каждые 3 байта превращаются в 4 знака из алфавита `A–Z a–z 0–9 + /`. Нужна там, где байты приходится нести в тексте: в JSON, в `data:`-адресе, в заголовке.',
  },
  {
    k: 'чанк и CRC',
    d: 'Чанк (блок) — кусок файла со своей длиной и типом. CRC — контрольная сумма: 4 байта, посчитанные из содержимого. Изменился хоть один бит — сумма не сойдётся.',
  },
];

export const PLAIN_BUFFER =
  'Буфер — лист в клетку, где в каждой клетке число от 0 до 255. Сам лист не знает, что на нём записано. Вид — трафарет, который вы на него кладёте: один трафарет читает клетки по одной, другой — по четыре сразу как одно большое число, третий — как дробь. Лист один, трафаретов сколько угодно.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи. Каждую хватит знать на уровне карточки; подробности — по ссылке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Байт, бит и шестнадцатеричная запись',
    d: 'Байт — 8 бит, число от 0 до 255. В шестнадцатеричной записи байт — ровно две цифры: `0x00`…`0xff`. Поэтому байты почти всегда печатают так: `89 50 4e 47`.',
    href: '/js/numbers/#s7',
    hrefLabel: '«Числа в JS», раздел «Побитовые операции: 32 бита, а не 64»',
    tone: 'info',
  },
  {
    t: 'Число в JS — double',
    d: 'Обычное число занимает 64 бита по стандарту IEEE 754. `Float32Array` хранит числа в 32 битах, и при записи туда они округляются.',
    href: '/js/numbers/#s1',
    hrefLabel: '«Числа в JS», раздел «Устройство double»',
    tone: 'info',
  },
  {
    t: 'Строка внутри — UTF-16, снаружи — UTF-8',
    d: 'В памяти JS строка — 16-битные кодовые единицы. В файл и в сеть она уходит в UTF-8, где буква кириллицы занимает 2 байта, а эмодзи — 4.',
    href: '/js/unicode-intl/#s8',
    hrefLabel: '«Unicode и Intl», раздел «Байты»',
    tone: 'info',
  },
  {
    t: 'Передача буфера воркеру',
    d: 'Буфер можно не копировать в воркер, а **отдать**: у отправителя он становится пустым (detached), а получатель видит те же байты.',
    href: '/js/workers/#s3',
    hrefLabel: '«Воркеры и параллелизм», раздел «Передача владения»',
    tone: 'info',
  },
];

// ─── Раздел 1. Буфер и вид ─────────────────────────────────────────────────────────────────

/**
 * Настоящий PNG от кодировщика Chromium 153 (см. шапку): холст 3×2, `canvas.toBlob`.
 * Сквозной пример темы: из него взяты байты всех примеров и демо.
 */
export const PNG_BYTES = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x9d, 0x74, 0x66, 0x1a, 0x00, 0x00, 0x00,
  0x1e, 0x49, 0x44, 0x41, 0x54, 0x78, 0x01, 0x62, 0xfa, 0xcf, 0xc0, 0xf0,
  0x1f, 0x0c, 0x19, 0xfe, 0xff, 0x67, 0x02, 0x62, 0x06, 0x06, 0x46, 0x06,
  0x86, 0xfa, 0xfa, 0x06, 0x06, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x4f,
  0x64, 0xa8, 0x3e, 0x00, 0x00, 0x00, 0x06, 0x49, 0x44, 0x41, 0x54, 0x03,
  0x00, 0x8b, 0x61, 0x09, 0x7c, 0x4d, 0x5e, 0x7d, 0x1d, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/** Цвета, которыми стенд закрасил шесть пикселей холста, по строкам. Тест их распаковывает. */
export const PNG_PIXELS = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#7f7f7f'];

export const VIEWS_CODE = `// Первые 16 байт того PNG: сигнатура и начало первого блока.
const bytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const buf = bytes.buffer;          // память под видом
buf.byteLength;                    // → 16
buf[0];                            // → undefined — у буфера нет индексов

const words = new Uint32Array(buf);  // второй вид на те же байты
words.length;                      // → 4
words[2];                          // → 0x0d000000 — байты 00 00 00 0d задом наперёд
bytes[11] = 0x0e;                  // пишем через один вид…
words[2];                          // → 0x0e000000 — …видно через другой

const name = bytes.subarray(12, 16);  // окно на те же байты
const copy = bytes.slice(12, 16);     // новые байты
name.buffer === buf;               // → true
name.byteOffset;                   // → 12
copy.buffer === buf;               // → false
String.fromCharCode(...name);      // → 'IHDR'`;

export const VIEWS_NOTE =
  'Главное здесь — что запись через `bytes` видна через `words`: это не два массива, а два взгляда на один буфер. Отсюда же разница `subarray` и `slice`. Первый даёт окно на те же байты, со своим `byteOffset`. Второй копирует. Окно дёшево, но правка через него меняет исходник — и наоборот. Почему `words[2]` равно не 13, а огромному числу, объясняет раздел «Порядок байт».';

export const TYPES_NOTE =
  'Типизированных массивов двенадцать. Отличаются они двумя вещами: сколько байт занимает элемент и как эти байты понимать — как целое со знаком, без знака или как дробь.';

export const TYPE_ROWS = [
  { k: '`Int8Array` / `Uint8Array`', size: '1', range: '−128…127 / 0…255', d: 'байты как есть; `Uint8Array` — основной вид для «просто байтов»' },
  { k: '`Uint8ClampedArray`', size: '1', range: '0…255', d: 'то же, но лишнее прижимается к краю, а не заворачивается; пиксели `ImageData`' },
  { k: '`Int16Array` / `Uint16Array`', size: '2', range: '−32 768…32 767 / 0…65 535', d: 'звук в 16 бит, индексы вершин' },
  { k: '`Int32Array` / `Uint32Array`', size: '4', range: '±2,1 млрд / 0…4,29 млрд', d: 'счётчики, поля форматов, хеши' },
  { k: '`Float16Array`', size: '2', range: '±65 504, 3 знака', d: 'новый тип: есть в Node 24 и Chromium 153; веса нейросетей, текстуры' },
  { k: '`Float32Array`', size: '4', range: '±3,4·10³⁸, 7 знаков', d: 'координаты для WebGL и WebGPU, звук' },
  { k: '`Float64Array`', size: '8', range: 'как обычное число', d: 'точность `number` без потерь' },
  { k: '`BigInt64Array` / `BigUint64Array`', size: '8', range: '±9,2·10¹⁸ / 0…1,8·10¹⁹', d: 'элементы — `BigInt`, а не `number`' },
];

// ─── Раздел 2. Выравнивание и переполнение ─────────────────────────────────────────────────

export const ALIGN_CODE = `const buf = new ArrayBuffer(8);
new Int16Array(buf, 1);            // ✗ RangeError — смещение не кратно 2
new Float32Array(buf, 2);          // ✗ RangeError — не кратно 4
new Int32Array(new ArrayBuffer(6));  // ✗ RangeError — 6 байт не делятся на 4

const view = new DataView(buf);    // DataView пускает по любому адресу
view.setUint16(1, 0x1234);
view.getUint16(1);                 // → 0x1234`;

export const PLAIN_ALIGN =
  'Как парковка, размеченная под фуры на четыре места. Фура встаёт только с начала разметки: с первого, пятого, девятого места. Поставить её «с третьего» нельзя — разметка не позволит. `DataView` — водитель, который паркует по одной машине и потому встаёт куда угодно.';

export const ALIGN_NOTE =
  'Типизированный массив требует, чтобы смещение `byteOffset` делилось на размер элемента: 2 для `Int16Array`, 4 для `Float32Array`, 8 для `Float64Array`. Иначе — `RangeError` уже в конструкторе. Так массив может читать элементы по кратным адресам — процессору это проще. В бинарных форматах поля часто лежат где придётся: 4-байтное число со смещением 33 — обычное дело. Такие поля читают через `DataView`, ему выравнивание не нужно.';

export const OVERFLOW_CODE = `Uint8Array.of(256, 257, 300, -1);     // → [0, 1, 44, 255] — по модулю 256
Uint8Array.of(1.7, -1.7, NaN);        // → [1, 255, 0] — дробь отбрасывается
Int8Array.of(127, 128, 255, -129);    // → [127, -128, -1, 127]

Uint8ClampedArray.of(300, -5, NaN);   // → [255, 0, 0] — прижимается к краю
Uint8ClampedArray.of(1.5, 2.5, 254.5);  // → [2, 2, 254] — половинки к чётному

new Float32Array([1.1])[0];           // → 1.100000023841858`;

export const OVERFLOW_ROWS = [
  { k: 'целые', how: 'Дробь отбрасывается, затем число берётся по модулю 2⁸, 2¹⁶ или 2³². `300` в `Uint8Array` становится `44`, `-1` — `255`, `128` в `Int8Array` — `-128`. Ни ошибки, ни предупреждения.', tone: 'err' as const },
  { k: '`Uint8ClampedArray`', how: 'Всё больше 255 становится 255, меньше 0 — нулём, `NaN` — нулём. Дробь округляется к ближайшему, а ровная половина — к чётному: `1.5` и `2.5` обе дают `2`. Для пикселей это правильно: пересвет остаётся белым, а не уходит в чёрный.', tone: 'ok' as const },
  { k: 'дробные', how: '`Float32Array` округляет до ближайшего числа с 24 битами мантиссы: `1.1` превращается в `1.100000023841858`. Механизм тот же, что у обычного `number`, только точности меньше вдвое.', tone: undefined },
];

export const OVERFLOW_NOTE =
  'Про округление дробных подробно — в [«Числа в JS», раздел «Устройство double»](/js/numbers/#s1). Здесь важнее целые: молчаливое заворачивание — частая причина «битых» данных. Яркость `250 + 10` в `Uint8Array` даёт `4`: самый яркий пиксель стал почти чёрным. Поэтому `ImageData` у холста отдаёт пиксели в `Uint8ClampedArray`.';

// ─── Раздел 3. Порядок байт ────────────────────────────────────────────────────────────────

export const PLAIN_ENDIAN =
  'Как записать дату. «2026-10-02» — от крупного к мелкому: год, месяц, день. «02.10.2026» — от мелкого к крупному. Цифры те же, смысл тот же, но если прочитать одну запись по правилам другой, выйдет чепуха. Big-endian — как первая запись: старший байт первым. Little-endian — как вторая.';

export const ENDIAN_CODE = `// Ширина картинки в заголовке PNG: 4 байта, старший первым.
const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x03]);
const view = new DataView(bytes.buffer);
view.getUint32(0);                 // → 3 — DataView по умолчанию big-endian
view.getUint32(0, true);           // → 50331648 — флаг true: little-endian
new Uint32Array(bytes.buffer)[0];  // → 50331648 — массив читает порядком машины

view.setUint32(0, 400);            // записать тоже можно в любом порядке
Array.from(bytes);                 // → [0, 0, 1, 144]

// Какой порядок у этой машины:
new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;  // → true — little-endian`;

export const ENDIAN_FACTS = [
  {
    t: 'Типизированный массив — порядок машины',
    d: 'Спецификация не задаёт порядок для `Uint32Array` и остальных: он такой, как у процессора. Сейчас это почти всегда little-endian — x86 и ARM в телефонах и ноутбуках. На стенде — little-endian в Node и в Chromium.',
  },
  {
    t: '`DataView` — порядок, который вы назвали',
    d: 'Без второго аргумента `getUint32` и `setUint32` читают big-endian. С `true` — little-endian. Так файл читается одинаково на любой машине.',
    tone: 'ok' as const,
  },
  {
    t: 'Форматы выбирают сами',
    d: 'PNG, сетевые протоколы, счётчик подписей WebAuthn — big-endian, его поэтому зовут ещё «сетевым». WAV, ZIP, заголовок модуля WebAssembly — little-endian. Порядок — свойство формата, его берут из описания формата.',
  },
];

export const ENDIAN_RULE =
  'Правило отсюда простое. Данные **своей** программы — буфер для WebGL, память WebAssembly — читают типизированным массивом: порядок у них заведомо общий с машиной. Данные **извне** — файл, ответ сервера, пакет — читают `DataView` с явным порядком из описания формата.';

/** Чтение для демо «Как смотреть на байты». Исполняется демо и тестом. */
export const READ_CODE = `const TYPES = {
  Uint8:   { size: 1, get: 'getUint8' },
  Int16:   { size: 2, get: 'getInt16' },
  Uint16:  { size: 2, get: 'getUint16' },
  Uint32:  { size: 4, get: 'getUint32' },
  Float32: { size: 4, get: 'getFloat32' },
};

// Прочитать байты как числа заданного типа и порядка.
// Хвост, которому не хватило байт на целое число, не читается.
function readAs(bytes, type, littleEndian) {
  const { size, get } = TYPES[type];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  for (let at = 0; at + size <= bytes.length; at += size) {
    out.push(view[get](at, littleEndian));
  }
  return out;
}`;

export const LENS_PRESETS: LensPreset[] = [
  {
    id: 'ihdr',
    label: 'Ширина и высота PNG',
    bytes: PNG_BYTES.slice(16, 24),
    note: 'Байты 16–23 файла: ширина и высота картинки, по 4 байта, big-endian. Верные числа `3` и `2` получаются только при `Uint32` и порядке BE.',
  },
  {
    id: 'float',
    label: 'Float32: 1.1 и −2',
    bytes: [0xcd, 0xcc, 0x8c, 0x3f, 0x00, 0x00, 0x00, 0xc0],
    note: 'Так `new Float32Array([1.1, -2])` лежит в памяти этой машины. Как целые эти байты не значат ничего, а при чужом порядке дробные превращаются в мусор.',
  },
  {
    id: 'text',
    label: 'Текст в UTF-8',
    bytes: [],
    note: 'Байты строки после `TextEncoder`. Кириллица — по два байта на букву. Попробуйте прочитать их как `Int16`: числа есть, но к буквам они отношения не имеют.',
  },
];

export const LENS_CAPTION =
  'Байты одни и те же — меняется только вид. Числа считает функция `readAs` выше через `DataView`. Строка про типизированный массив сравнивает её ответ с настоящим `Int16Array` или `Float32Array` на этом устройстве: с ним всегда совпадает порядок LE.';

// ─── Раздел 4. Текст и base64 ──────────────────────────────────────────────────────────────

export const TEXT_CODE = `const enc = new TextEncoder();      // всегда UTF-8
enc.encode('Привет').length;        // → 12
Array.from(enc.encode('€'));        // → [0xe2, 0x82, 0xac]

// Знак «€» разрезан между двумя кусками из сети:
const parts = [new Uint8Array([0xe2, 0x82]), new Uint8Array([0xac])];
parts.map((p) => new TextDecoder().decode(p)).join('');  // → '\\ufffd\\ufffd'

const dec = new TextDecoder();      // один декодер на весь поток
dec.decode(parts[0], { stream: true });  // → '' — ждёт продолжения
dec.decode(parts[1]);               // → '€'

// BOM в начале файла декодер молча съедает:
new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]));  // → 'A'`;

export const TEXT_NOTE =
  '`TextEncoder` умеет только UTF-8, `TextDecoder` — ещё десятки кодировок: `new TextDecoder(\'windows-1251\')` прочитает старый русский файл. На битых байтах декодер ставит знак замены `\\ufffd`, а с `{ fatal: true }` бросает `TypeError` ([«Unicode и Intl», раздел «Байты»](/js/unicode-intl/#s8)). Флаг `stream: true` говорит «будет продолжение»: недописанный хвост декодер придерживает до следующего вызова. Это нужно всякий раз, когда байты приходят кусками, — из `fetch`, из `Blob.stream()`, из сокета ([«Стримы и обратное давление», раздел «Итерация и байты»](/platform/streams/#s6)).';

export const PLAIN_BTOA =
  'Название `btoa` — «binary to ASCII», но «binary» здесь значит не байты, а строку, где каждый символ притворяется байтом: код от 0 до 255. Это наследие времён, когда в JS не было `Uint8Array`. Строку с кириллицей `btoa` не примет: у «П» код 1055, байтом он притвориться не может.';

export const BTOA_CODE = `btoa('Hi!');                        // → 'SGkh'
btoa('Привет');                     // ✗ InvalidCharacterError — символы дальше 255

// Обходной путь: сначала байты UTF-8, потом каждый байт — символом.
const bytes = new TextEncoder().encode('Привет');
btoa(String.fromCharCode(...bytes));  // → '0J/RgNC40LLQtdGC'`;

export const B64_CODE = `// Байты → base64 и обратно, с новым API и без него.
function toBase64(bytes) {
  if (bytes.toBase64) return bytes.toBase64();
  let bin = '';
  // Кусками: String.fromCharCode(...bytes) на мегабайте переполняет стек.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(text) {
  if (Uint8Array.fromBase64) return Uint8Array.fromBase64(text);
  return Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
}`;

export const NATIVE_B64_CODE = `new TextEncoder().encode('Привет').toBase64();  // → '0J/RgNC40LLQtdGC'
Array.from(Uint8Array.fromBase64('+/8='));      // → [0xfb, 0xff]
new Uint8Array([0xfb, 0xff]).toBase64({ alphabet: 'base64url', omitPadding: true });  // → '-_8'
new Uint8Array([0x89, 0x50, 0x4e, 0x47]).toHex();  // → '89504e47'
Uint8Array.fromBase64('*');                     // ✗ SyntaxError — мусор не пропускает`;

export const B64_SUPPORT = [
  { k: '`Uint8Array.fromBase64`, `toBase64`, `fromHex`, `toHex`', chr: 'есть', n26: 'есть', n24: '**нет**' },
  { k: '`btoa`, `atob`', chr: 'есть', n26: 'есть', n24: 'есть' },
  { k: '`TextEncoder`, `TextDecoder`', chr: 'есть', n26: 'есть', n24: 'есть' },
];

export const B64_NOTE =
  'Новые методы работают прямо с байтами, понимают алфавит `base64url` (`-` и `_` вместо `+` и `/` — для адресов и JWT) и бросают `SyntaxError` на посторонних символах. Но в Node 24 — нынешней LTS-версии на стенде — их ещё нет. Код, который исполняется и в браузере, и в Node, проверяет наличие метода, как `toBase64` выше.';

// ─── Раздел 5. Blob и File ─────────────────────────────────────────────────────────────────

export const PLAIN_BLOB =
  'Blob — квитанция из камеры хранения, а не сам чемодан. В ней записано, сколько весит багаж и что это за багаж; открыть чемодан можно, только сходив за ним — асинхронно. Отрезать «первые 24 байта» — значит выписать новую квитанцию на часть того же багажа, не открывая его.';

export const BLOB_CODE = `const blob = new Blob(['Привет', new Uint8Array([0x21])], { type: 'text/plain' });
blob.size;                         // → 13 — строка ушла в UTF-8
blob.type;                         // → 'text/plain'

const head = blob.slice(0, 2);     // новый Blob; байты ещё не читались
head.size;                         // → 2
head.type;                         // → '' — тип не наследуется
await head.text();                 // → 'П'
await blob.slice(0, 3).text();     // → 'П\\ufffd' — разрезали букву
(await blob.arrayBuffer()).byteLength;  // → 13

// Blob неизменяем: байты взяты в момент создания.
const src = new Uint8Array([1, 2, 3]);
const frozen = new Blob([src]);
src[0] = 99;
Array.from(await frozen.bytes());  // → [1, 2, 3]`;

export const BLOB_ROWS = [
  { k: '`await blob.arrayBuffer()`', d: 'все байты новым `ArrayBuffer`; каждый вызов — новый буфер' },
  { k: '`await blob.bytes()`', d: 'то же сразу `Uint8Array`' },
  { k: '`await blob.text()`', d: 'байты как UTF-8; битые последовательности — `\\ufffd`, без ошибки' },
  { k: '`blob.stream()`', d: '`ReadableStream` из `Uint8Array`-кусков — для больших файлов, которые не нужны в памяти целиком' },
  { k: '`blob.slice(start, end, type)`', d: 'новый `Blob` на часть байтов, синхронно' },
  { k: '`URL.createObjectURL(blob)`', d: 'адрес `blob:` для `<img>`, `<a download>`; держит байты, пока не позовут `URL.revokeObjectURL`' },
];

export const BLOB_FACTS = [
  {
    t: '`slice` не читает и не копирует',
    d: 'Отрезок — тот же источник с другими границами. У `File` с диска это значит: `file.slice(0, 24)` на файле в гигабайт ничего не загрузит, пока вы не попросите байты. Копию при `slice` браузер не делает — это устройство хранилища блобов Chromium; из JS разница не видна.',
  },
  {
    t: 'Конструктор копирует',
    d: '`new Blob([src])` забирает байты в момент вызова: правка `src` после этого блоб не меняет. Поэтому блоб можно смело отдавать дальше — в `fetch`, в IndexedDB, в воркер.',
  },
  {
    t: '`File` — это `Blob` с именем',
    d: 'Поля `name` и `lastModified` сверху, всё остальное от `Blob`. Но `file.slice()` возвращает уже простой `Blob`: имя отрезок теряет.',
    tone: 'warn' as const,
  },
];

export const FILE_SIZE_CODE = `// Размер картинки, не читая файл целиком: нужны только первые 24 байта.
async function pngSize(file) {
  const head = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  const view = new DataView(head.buffer);
  if (view.getUint32(0) !== 0x89504e47) throw new Error('не PNG');
  return { width: view.getUint32(16), height: view.getUint32(20) };
}`;

export const FILE_SIZE_NOTE =
  'Так проверяют загрузку до отправки: `<input type="file">` даёт `File`, а 24 байта хватает, чтобы узнать размер и отказать картинке 20 000 × 20 000. На сервере проверку всё равно повторяют — клиенту верить нельзя ([«Загрузка файлов», раздел «Проверки на сервере»](/platform/uploads/#s5)).';

// ─── Раздел 6. Растущий буфер и transfer ───────────────────────────────────────────────────

export const RESIZE_CODE = `const buf = new ArrayBuffer(4, { maxByteLength: 16 });
const all = new Uint8Array(buf);        // без длины — следит за буфером
const first4 = new Uint8Array(buf, 0, 4);  // с длиной — ровно 4 байта

buf.resize(12);
all.length;                        // → 12
first4.length;                     // → 4

buf.resize(2);
all.length;                        // → 2
first4.length;                     // → 0 — вид вылез за край и опустел

buf.resize(17);                    // ✗ RangeError — больше maxByteLength
new ArrayBuffer(4).resize(8);      // ✗ TypeError — обычный буфер не растёт`;

export const PLAIN_RESIZE =
  'Обычный буфер — коробка, размер которой написан на ней навсегда. Растущий — коробка-гармошка: её можно растянуть, но только до длины, указанной при покупке (`maxByteLength`). Вид без длины растягивается вместе с коробкой. Вид с длиной — как наклейка на определённую часть: если коробку сжали и эта часть исчезла, наклейка показывает пустоту.';

export const COLLECT_CODE = `// Собрать поток байтов в один буфер, не зная заранее размера.
async function collect(stream, max = 64 * 1024 * 1024) {
  const buf = new ArrayBuffer(0, { maxByteLength: max });
  const bytes = new Uint8Array(buf);    // вид растёт вместе с буфером
  for await (const chunk of stream) {
    const at = buf.byteLength;
    buf.resize(at + chunk.length);
    bytes.set(chunk, at);
  }
  return bytes;
}`;

export const COLLECT_NOTE =
  'Без растущего буфера здесь пришлось бы копить массив кусков и в конце склеивать их в новый буфер — то есть держать в памяти всё дважды. С ним кусок кладётся сразу на место, а вид `bytes` создаётся один раз. `maxByteLength` — потолок: при попытке вырасти дальше `resize` бросит `RangeError`, и файл больше лимита не уронит вкладку.';

export const TRANSFER_CODE = `const small = new ArrayBuffer(8);
const view = new Uint8Array(small);
view[0] = 7;

const big = small.transfer(16);    // байты переехали в буфер на 16
small.detached;                    // → true
small.byteLength;                  // → 0
view.length;                       // → 0
new Uint8Array(big)[0];            // → 7

view[0];                           // → undefined — чтение молчит
view.set([1]);                     // ✗ TypeError — а метод бросает`;

export const TRANSFER_NOTE =
  '`transfer()` — та же передача владения, что при `postMessage` со списком переноса ([«Воркеры и параллелизм», раздел «Передача владения»](/js/workers/#s3)), только внутри одного потока. Старый буфер становится пустым, новый получает байты, а с аргументом — ещё и другую длину. Зачем это без воркера: функция, которая берёт буфер «себе», отсоединяет его у вызывающего, и тот уже не испортит данные. Растущий буфер `transfer()` оставляет растущим, `transferToFixedLength()` — делает обычным. Свой растущий буфер есть и у памяти WebAssembly — [«WebAssembly», раздел «Линейная память»](/js/wasm-threads/#s2).';

// ─── Раздел 7. Разбор PNG ──────────────────────────────────────────────────────────────────

export const PNG_LAYOUT = [
  { at: '0', len: '8', k: 'сигнатура', d: '`89 50 4e 47 0d 0a 1a 0a`: `\\x89`, «PNG», перевод строки Windows, `^Z`, перевод строки Unix. Испортит файл любая программа, которая «чинит» переводы строк, — и это сразу видно.' },
  { at: '+0', len: '4', k: 'длина данных', d: 'Только данных блока, без типа и CRC. Big-endian.' },
  { at: '+4', len: '4', k: 'тип', d: 'Четыре буквы ASCII: `IHDR`, `IDAT`, `IEND`, `tEXt`… Заглавная первая буква — блок обязателен для показа картинки.' },
  { at: '+8', len: 'длина', k: 'данные', d: 'У каждого типа своя раскладка. У `IHDR` — 13 байт, у `IEND` — ноль.' },
  { at: '+8+длина', len: '4', k: 'CRC', d: 'Контрольная сумма CRC-32 по типу и данным. Длина в неё не входит.' },
];

export const IHDR_ROWS = [
  { at: '0', len: '4', k: 'ширина', v: '`3`' },
  { at: '4', len: '4', k: 'высота', v: '`2`' },
  { at: '8', len: '1', k: 'бит на канал', v: '`8`' },
  { at: '9', len: '1', k: 'тип цвета', v: '`6` — RGBA' },
  { at: '10', len: '1', k: 'сжатие', v: '`0` — deflate, другого нет' },
  { at: '11', len: '1', k: 'фильтр', v: '`0`' },
  { at: '12', len: '1', k: 'чересстрочность', v: '`0` — нет' },
];

export const PLAIN_CRC =
  'Как контрольная цифра в номере карты. Последнюю цифру вычисляют из остальных. Опечатка в любой цифре — и проверка не сходится, хотя номер выглядит нормально. CRC делает то же для блока PNG, только «цифра» — 32 бита, и одиночную ошибку она ловит всегда.';

export const PNG_CODE = `const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// CRC-32 из PNG (тот же, что в zip и gzip). Таблица на 256 байт — один раз.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}

// crc — сумма предыдущих кусков, если считать по частям.
function crc32(bytes, crc = 0) {
  crc = ~crc;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;                 // >>> 0 — обратно в беззнаковое
}

function parsePng(bytes) {
  // bytes может быть окном в середине большого буфера — отсюда byteOffset.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  SIGNATURE.forEach((b, i) => {
    if (bytes[i] !== b) throw new Error('не PNG: байт ' + i);
  });

  const chunks = [];
  let pos = 8;
  while (pos < bytes.length) {
    const length = view.getUint32(pos);      // big-endian: флаг не нужен
    if (pos + 12 + length > bytes.length) throw new Error('файл обрезан');
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + length);  // окно, не копия
    const crc = view.getUint32(pos + 8 + length);
    const actual = crc32(bytes.subarray(pos + 4, pos + 8 + length));  // тип + данные
    chunks.push({ offset: pos, length, type, data, crc, crcOk: crc === actual });
    pos += 12 + length;
    if (type === 'IEND') break;
  }

  if (chunks[0]?.type !== 'IHDR') throw new Error('первым должен идти IHDR');
  const head = chunks[0].data;
  const h = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return {
    width: h.getUint32(0),
    height: h.getUint32(4),
    bitDepth: h.getUint8(8),
    colorType: h.getUint8(9),        // 2 — RGB, 6 — RGBA, 3 — палитра
    interlace: h.getUint8(12),
    chunks,
  };
}`;

export const PNG_NOTE =
  'В функции нет ни одного копирования байтов: блоки — окна `subarray` на исходный массив, числа читаются `DataView` прямо с места. `byteOffset` в обоих `DataView` — не формальность: `chunks[0].data` начинается с 16-го байта буфера, и `new DataView(head.buffer)` без смещения прочитал бы сигнатуру файла вместо ширины.';

/** Блоки файла `PNG_BYTES`: смещение, длина данных, тип, CRC. Сверяются тестом с `zlib.crc32`. */
export const PNG_CHUNKS = [
  { offset: 8, length: 13, type: 'IHDR', crc: 0x9d74661a },
  { offset: 33, length: 30, type: 'IDAT', crc: 0x4f64a83e },
  { offset: 75, length: 6, type: 'IDAT', crc: 0x4d5e7d1d },
  { offset: 93, length: 0, type: 'IEND', crc: 0xae426082 },
];

export const CHUNK_FACTS = [
  {
    t: 'Два IDAT подряд — это нормально',
    d: 'Кодировщик Chromium разбил 36 байт сжатых пикселей на два блока: 30 и 6. Данные всех `IDAT` склеивают в один поток deflate и только потом распаковывают. Читать «первый IDAT» как картинку — ошибка, которая на маленьких файлах может не проявиться.',
  },
  {
    t: 'Битый CRC — нет картинки',
    d: 'На стенде Chromium 153 отказался декодировать файл, где не сошёлся CRC у `IHDR` или у `IDAT`: `createImageBitmap` бросил `InvalidStateError`. Испорченный CRC у `IEND` он пропустил: картинка к тому моменту уже прочитана.',
    tone: 'warn' as const,
  },
  {
    t: 'Неизвестный блок можно пропустить',
    d: 'Длина в начале блока позволяет перешагнуть его, не понимая содержимого: `pos += 12 + length`. Поэтому в PNG можно добавлять свои блоки — метаданные, цветовой профиль, — и старые программы их не заметят.',
    tone: 'ok' as const,
  },
];

export const PNG_VARIANTS: PngVariant[] = [
  {
    id: 'ok',
    label: 'Целый файл',
    patch: [],
    note: 'Тот самый PNG от кодировщика Chromium: 105 байт, холст 3×2. Нажмите на байт — увидите, к какому полю он относится и что там записано.',
  },
  {
    id: 'width',
    label: 'Ширина 3 → 4',
    patch: [[19, 0x04]],
    note: 'Один байт ширины поменян, CRC остался прежним. Разбор проходит, но проверка `IHDR` не сходится — Chromium такой файл не покажет.',
  },
  {
    id: 'cut',
    label: 'Обрезан на 60 байтах',
    cut: 60,
    patch: [],
    note: 'Файл оборван посреди первого `IDAT`: длина блока обещает 30 байт данных, а их меньше. Так выглядит недокачанная картинка.',
  },
];

export const PNG_CAPTION =
  'Поля и значения считает `parsePng` выше; CRC — её же `crc32`. Цвет — вид поля: длина, тип, данные, контрольная сумма.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`new DataView(view.buffer)` забывает смещение',
    d: 'Если массив — окно в середине буфера (`subarray`, кусок из сети, `Buffer` в Node), то `view.buffer` — весь буфер, с нуля. Читать надо с `view.byteOffset` и длиной `view.byteLength`. Ошибка не бросает исключение, а молча читает чужие байты.',
    code: 'new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Типизированный массив на данных извне',
    d: '`new Uint32Array(fileBytes.buffer)` читает порядком машины, а формат может быть big-endian. На любом x86 и ARM ответ будет одинаково неверным — поэтому тесты такой ошибки не замечают. Для чужих форматов — `DataView` с явным порядком.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Переполнение не бросает',
    d: '`300` в `Uint8Array` — `44`, `-1` — `255`, `1.7` — `1`. Значение «влезает» всегда, просто другое. Для пикселей — `Uint8ClampedArray`, для остального — проверка диапазона до записи.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`btoa` не для текста',
    d: '`btoa(\'Привет\')` бросает `InvalidCharacterError`. Сначала `TextEncoder`, потом base64 от байтов. А `String.fromCharCode(...bytes)` на большом массиве падает с `RangeError` — переполнен стек аргументов. Кусками или `toBase64()`, где он есть.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`TextDecoder` на кусках без `stream: true`',
    d: 'Буква на границе двух кусков превращается в два `\\ufffd`. На английском тексте ошибка не видна — там каждый символ один байт. Ломается на кириллице и эмодзи, и не всегда: только когда граница попала в середину буквы.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Размер чанков `blob.stream()` не задан',
    d: 'Один и тот же блоб на стенде пришёл в Node первым куском в 12 байт, а в Chromium — в 13. Код, который ждёт, что заголовок файла придёт целиком в первом куске, работает в одной среде и ломается в другой. Нужен заголовок — `blob.slice(0, n)`.',
  },
  {
    n: '07',
    t: 'Вид на отсоединённый буфер молчит',
    d: 'После `transfer()` или `postMessage` с переносом `view[0]` — `undefined`, запись по индексу теряется без ошибки, `length` — 0. Методы при этом бросают `TypeError`: `set`, `fill`, `at`, `slice`, `subarray` и даже `Array.from(view)`. Поэтому ошибка всплывает не там, где буфер отдали, а там, где его впервые тронули методом. Проверка — `buf.detached`.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Вид с длиной на растущем буфере',
    d: 'Сжали буфер так, что вид с явной длиной вылез за край, — его `length` стал 0, хотя часть байтов на месте. Вид без длины ужимается вместе с буфером. Если буфер будет меняться — создавайте виды без длины.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-262 — ArrayBuffer Objects',
    href: 'https://tc39.es/ecma262/#sec-arraybuffer-objects',
    what: '`maxByteLength`, `resize`, `transfer`, `detached`',
  },
  {
    title: 'ECMA-262 — TypedArray Objects',
    href: 'https://tc39.es/ecma262/#sec-typedarray-objects',
    what: '`RangeError` на невыровненном смещении, вид, следящий за длиной буфера',
  },
  {
    title: 'ECMA-262 — DataView Objects',
    href: 'https://tc39.es/ecma262/#sec-dataview-objects',
    what: 'порядок байт по флагу, big-endian по умолчанию',
  },
  {
    title: 'TC39 — Uint8Array to/from base64 and hex',
    href: 'https://github.com/tc39/proposal-arraybuffer-base64',
    what: '`toBase64`, `fromBase64`, `toHex`, алфавит `base64url`, `setFromBase64`',
  },
  {
    title: 'WHATWG Encoding Standard',
    href: 'https://encoding.spec.whatwg.org/',
    what: '`TextEncoder`, `TextDecoder`, `stream`, `fatal`, BOM',
  },
  {
    title: 'HTML Standard — btoa',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#dom-btoa',
    what: '`InvalidCharacterError` на символах дальше U+00FF',
  },
  {
    title: 'W3C File API',
    href: 'https://w3c.github.io/FileAPI/',
    what: '`Blob`, `File`, `slice`, `arrayBuffer`, `bytes`, `stream`, адреса `blob:`',
  },
  {
    title: 'Chromium — Blob storage system design',
    href: 'https://chromium.googlesource.com/chromium/src/+/main/storage/browser/blob/README.md',
    what: 'как браузер хранит блобы и почему `slice` не копирует байты',
  },
  {
    title: 'W3C — Portable Network Graphics (PNG) Specification, Third Edition',
    href: 'https://www.w3.org/TR/png-3/',
    what: 'сигнатура, раскладка блока, `IHDR`, CRC-32 и его таблица',
  },
  {
    title: 'Node.js — `zlib.crc32`',
    href: 'https://nodejs.org/api/zlib.html#zlibcrc32data-value',
    what: 'с ним сверен `crc32` темы, включая счёт по частям',
  },
];

export const RELATED =
  'Смежное на сайте: [Воркеры и параллелизм, раздел «Передача владения»](/js/workers/#s3) — буфер, отданный другому потоку, и [раздел «Разделяемая память и Atomics»](/js/workers/#s5) — `SharedArrayBuffer`. [MessageChannel, раздел «Правила transfer-списка»](/js/message-channel/#s3) — что бывает с забытым списком переноса. [WebAssembly, раздел «Линейная память»](/js/wasm-threads/#s2) — память модуля как `ArrayBuffer`, который отсоединяется при росте. [Числа в JS, раздел «Устройство double»](/js/numbers/#s1) — что лежит в восьми байтах `Float64Array`. [Unicode и Intl, раздел «Байты»](/js/unicode-intl/#s8) — UTF-8 против UTF-16. [Стримы и обратное давление, раздел «Итерация и байты»](/platform/streams/#s6) — байтовые потоки и BYOB. [Хранилища браузера, раздел «IndexedDB: версии, индексы, курсоры»](/platform/browser-storage/#s3) — где хранить `Blob`. [Загрузка файлов, раздел «Проверки на сервере»](/platform/uploads/#s5) — сигнатуры форматов. [Passkeys, раздел «Регистрация»](/platform/passkeys/#s2) — ещё один формат, который читают `DataView`. [Копирование и сериализация](/js/serialization/) — `JSON.stringify` по шагам, алгоритм `structuredClone` и что теряет каждая копия. [Что внутри gzip](/algorithms/deflate/) — LZ77, коды Хаффмана и блоки DEFLATE по битам.';
