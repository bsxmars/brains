import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { TzScenario, ZoneTable } from '@/widgets/tz-lab/model/types';

/**
 * Данные темы «Время и даты: UTC, часовые пояса и Temporal».
 *
 * Тема написана здесь, 2026-10-01, по заданию автора курса.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node **24.11.0** (V8 13.6, ICU 77.1, tzdata **2025b**) — основной; Node **26.8.2** (V8 14.6,
 * ICU 78.3, tzdata **2026a**) — для сравнения баз поясов; `temporal-polyfill` **1.0.5** из
 * `node_modules` проекта; Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 (Playwright 1.63),
 * macOS, октябрь 2026.
 *
 * Как снято:
 *   — `Date` в разных поясах — **отдельными процессами** Node с переменной окружения `TZ=…`
 *     (поясом процесса JS управлять не может: он читается при старте). В браузерах — контекст
 *     Playwright с `timezoneId`. Одни и те же выражения, один и тот же зонд;
 *   — Temporal — полифил в Node 24 и встроенный `Temporal` в Chromium 153: все четыре значения
 *     `disambiguation` на одиннадцати случаях (Берлин, Нью-Йорк, Лорд-Хау, Москва 2011 и 2014,
 *     Кишинёв, Калькутта), `add`, `until`, `hoursInDay`, опция `offset`. Ответы полифила
 *     и Chromium совпали строка в строку;
 *   — таблицы переходов зон (`ZONE_TABLES`) — `getTimeZoneTransition('next')` полифила;
 *     полифил берёт правила зон из `Intl` той среды, где запущен, то есть из её ICU;
 *   — базы поясов Node 24 и 26 сравнены целиком: смещение всех 418 зон каждые 6 часов
 *     с 2010 по 2027 год. Расхождение в правилах одно — `Europe/Chisinau` (время перехода
 *     с 2022 года); остальные различия — только текст: ICU 77 печатает нулевое смещение
 *     как `GMT`, ICU 78 и Chromium 153 — как `GMT+00:00`;
 *   — разбор строк `'2026-02-30'`, `'2026-3-29'`, `'2026-03-29 00:00'` и поведение `Date`
 *     в разрыве и повторе — в трёх движках с `timezoneId: 'Europe/Berlin'`: переходы
 *     у всех трёх одинаковы, `'2026-02-30'` Chromium и Firefox превращают во 2 марта,
 *     WebKit даёт `NaN`;
 *   — вес полифила: esbuild 0.28.2, `import { Temporal } from 'temporal-polyfill'` с `minify`:
 *     57 176 байт, gzip −9 — 19 746 байт.
 *
 * Из документации, без проверки запуском: что `performance.now()` монотонен, а системные
 * часы, от которых считает `Date.now()`, могут прыгнуть назад (спецификация High Resolution
 * Time); поддержка Temporal в браузерах старше стенда — по таблицам совместимости.
 *
 * Пересобирается `tests/unit/time-dates.test.ts`: таблицы выражений исполняются в процессах
 * с нужным `TZ`, примеры кода — те же строки, что напечатаны; Temporal-таблицы — полифилом;
 * `LOCAL_TO_UTC_CODE` сверяется с полифилом и с `Date` на моментах вокруг каждого перехода
 * из `ZONE_TABLES`. Колонки Chromium/Firefox/WebKit и Node 26 — снимок стенда, тест их
 * не повторяет (кроме строк, совпадающих с Node 24).
 */

/** Строка выражения для таблиц: что набрать, что выйдет, почему. `tz` — пояс процесса. */
export interface ExprRow {
  code: string;
  out: string;
  why: string;
  tz: string;
  tone?: 'ok' | 'warn' | 'err';
}

export const code = (s: string) => `\`${s}\``;
export const exprRows = (rows: ExprRow[]) => rows.map((r) => [code(r.code), code(r.out), r.why]);
export const exprRowsTz = (rows: ExprRow[]) => rows.map((r) => [code(r.code), r.tz, code(r.out), r.why]);
export const exprTones = (rows: ExprRow[]) => rows.map((r) => r.tone);

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'UTC',
    d: 'Всемирное координированное время — общая для всей планеты шкала, от которой отсчитывают остальные. Летнего времени у неё нет. В записи ISO обозначается буквой `Z`: `2026-03-29T00:00Z`.',
  },
  {
    k: 'эпоха',
    d: 'Нулевая точка отсчёта: полночь 1 января 1970 года по UTC. `Date` хранит, сколько миллисекунд прошло от неё; моменты раньше эпохи — отрицательные числа.',
  },
  {
    k: 'смещение',
    d: 'На сколько местные часы опережают UTC в данный момент: `+03:00` в Москве, `-04:00` летом в Нью-Йорке. Смещение — число на сегодня; через полгода у того же места оно может быть другим.',
  },
  {
    k: 'часовой пояс (зона IANA)',
    d: 'Место с общей историей часов: `Europe/Moscow`, `America/New_York`. Зона знает все смещения, какие у неё были и будут, и моменты, когда они менялись. Пояс — не смещение.',
  },
  {
    k: 'переход',
    d: 'Момент, когда в зоне меняется смещение: весной на летнее время, осенью обратно или когда страна меняет правила. Весной часть времени на часах пропадает, осенью — повторяется.',
  },
  {
    k: 'время на часах',
    d: 'То, что показывают часы на стене: дата и время без пояса, «29 марта, 02:30». Чтобы получить из него момент, нужна зона — и в день перехода её может не хватить.',
  },
  {
    k: 'ISO 8601',
    d: 'Запись даты от крупного к мелкому: `2026-03-29T02:30:00+02:00`. Единственный формат строк, который стандарт JS обязан разбирать одинаково во всех движках.',
  },
  {
    k: 'tzdata',
    d: 'База часовых поясов IANA: история переходов и правила для каждой зоны. Обновляется несколько раз в год, у каждой программы своя копия — в JS её приносит библиотека ICU.',
  },
];

export const PLAIN_DATE =
  'Представьте секундомер, который запустили в Гринвиче в новогоднюю полночь 1970 года и ни разу не останавливали. `Date` — это одно показание такого секундомера, и больше ничего. «29 марта, 03:00» — это показание, прочитанное через очки конкретного города. Очки меняют то, что вы видите, но не само показание.';

export const PREREQ_NOTE =
  'Тема опирается на две вещи из других тем и на одну бытовую — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Число в JS — double',
    d: 'Каждое `number` — 64-битное число с плавающей точкой. Целые до `2⁵³` (около 9·10¹⁵) оно хранит точно, дальше начинает их терять. Миллисекунды `Date` — такое же число.',
    href: '/js/numbers/#s3',
    hrefLabel: '«Числа в JS», раздел «Предел целых»',
    tone: 'info',
  },
  {
    t: 'Строки-даты не в формате ISO',
    d: 'Строку вроде `01.10.2026` каждый движок разбирает по-своему: Chromium и Firefox читают её как 10 января, WebKit не понимает вовсе. Здесь разбирается только то, что стандарт обязал понимать одинаково, — ISO.',
    href: '/render/browser-engines/#s2',
    hrefLabel: '«Три движка», раздел «Язык»',
    tone: 'info',
  },
  {
    t: 'Летнее время',
    d: 'Во многих странах часы дважды в год переводят: весной на час вперёд, осенью на час назад. В России так делали до 2011 года; в Европе и США делают до сих пор, причём в разные воскресенья.',
    tone: 'info',
  },
];

// ─── Раздел 1. Date — это число ────────────────────────────────────────────────────────────

/** Исполняются в процессе с `TZ=Europe/Moscow`; ни одна строка от пояса не зависит, кроме оговорённых. */
export const NUMBER_ROWS: ExprRow[] = [
  { code: 'new Date(0).toISOString()', out: "'1970-01-01T00:00:00.000Z'", why: 'эпоха: ноль миллисекунд', tz: 'Europe/Moscow' },
  { code: 'Date.UTC(2026, 2, 29)', out: '1774742400000', why: 'полночь 29 марта 2026 по UTC — это просто число', tz: 'Europe/Moscow' },
  { code: 'typeof Date.now()', out: "'number'", why: 'текущий момент — тоже число, без объекта', tz: 'Europe/Moscow' },
  { code: 'new Date(2026, 2, 29).getMonth()', out: '2', why: 'март — третий месяц, но номер у него 2: **месяцы с нуля**', tz: 'Europe/Moscow', tone: 'warn' },
  { code: 'new Date(2026, 2, 29).getDay()', out: '0', why: '`getDay` — день недели, с воскресенья. Число месяца — `getDate`', tz: 'Europe/Moscow', tone: 'warn' },
  { code: 'new Date(2026, 1, 31).getDate()', out: '3', why: '31 февраля — не ошибка: лишние дни перетекают в март, выходит 3 марта', tz: 'Europe/Moscow', tone: 'warn' },
  { code: 'new Date(2026, 2, 0).getDate()', out: '28', why: 'нулевой день месяца — последний день предыдущего', tz: 'Europe/Moscow' },
  { code: 'new Date(99, 0).getFullYear()', out: '1999', why: 'годы 0–99 конструктор считает двадцатым веком', tz: 'Europe/Moscow', tone: 'warn' },
  { code: 'new Date(8.64e15).toISOString()', out: "'+275760-09-13T00:00:00.000Z'", why: 'предел: ровно 10⁸ суток после эпохи (и столько же до)', tz: 'Europe/Moscow' },
  { code: 'new Date(8.64e15 + 1).getTime()', out: 'NaN', why: 'за пределом — «Invalid Date», внутри `NaN`', tz: 'Europe/Moscow' },
  { code: 'Number.isSafeInteger(8.64e15)', out: 'true', why: 'весь диапазон меньше `2⁵³`: любой момент `Date` хранится точно', tz: 'Europe/Moscow', tone: 'ok' },
  { code: 'new Date(1.9).getTime()', out: '1', why: 'дробная часть миллисекунды отбрасывается', tz: 'Europe/Moscow' },
  { code: "String(new Date('завтра'))", out: "'Invalid Date'", why: 'объект создан, а числа в нём нет', tz: 'Europe/Moscow' },
  { code: 'new Date(NaN).toISOString()', out: 'RangeError', why: 'у пустой даты нет ISO-записи — исключение', tz: 'Europe/Moscow', tone: 'err' },
];

export const NUMBER_NOTE =
  'Год, месяц, час и день недели внутри `Date` не хранятся. Каждый геттер вычисляет их из числа миллисекунд заново, и у каждого два варианта: `getHours` считает по поясу машины, `getUTCHours` — по UTC. Сеттеры работают так же в обратную сторону: `setDate(32)` не ошибка, а «на день позже последнего числа».';

// ─── Раздел 2. Строка без зоны ─────────────────────────────────────────────────────────────

/** Пояса для таблицы разбора: в каждом — отдельный процесс Node. */
export const PARSE_TZ = ['Europe/Moscow', 'America/New_York', 'Asia/Kolkata'] as const;

/** Что вернул `new Date(s)`: `toISOString()` и `getDate()` — в процессе с этим `TZ`. */
export const PARSE_ROWS: { s: string; how: string; cells: { iso: string; date: number }[]; tone?: 'warn' | 'err' }[] = [
  {
    s: "'2026-03-29'",
    how: 'только дата → **полночь UTC**',
    cells: [
      { iso: '2026-03-29T00:00:00.000Z', date: 29 },
      { iso: '2026-03-29T00:00:00.000Z', date: 28 },
      { iso: '2026-03-29T00:00:00.000Z', date: 29 },
    ],
    tone: 'err',
  },
  {
    s: "'2026-03-29T00:00'",
    how: 'дата и время без пояса → **местное время**',
    cells: [
      { iso: '2026-03-28T21:00:00.000Z', date: 29 },
      { iso: '2026-03-29T04:00:00.000Z', date: 29 },
      { iso: '2026-03-28T18:30:00.000Z', date: 29 },
    ],
    tone: 'warn',
  },
  {
    s: "'2026-03-29T00:00Z'",
    how: 'с `Z` → UTC',
    cells: [
      { iso: '2026-03-29T00:00:00.000Z', date: 29 },
      { iso: '2026-03-29T00:00:00.000Z', date: 28 },
      { iso: '2026-03-29T00:00:00.000Z', date: 29 },
    ],
  },
  {
    s: "'2026-03-29T00:00+03:00'",
    how: 'со смещением → ровно этот момент',
    cells: [
      { iso: '2026-03-28T21:00:00.000Z', date: 29 },
      { iso: '2026-03-28T21:00:00.000Z', date: 28 },
      { iso: '2026-03-28T21:00:00.000Z', date: 29 },
    ],
  },
  {
    s: "'2026-3-29'",
    how: 'не ISO (месяц без нуля) → на усмотрение движка; все три — местное',
    cells: [
      { iso: '2026-03-28T21:00:00.000Z', date: 29 },
      { iso: '2026-03-29T04:00:00.000Z', date: 29 },
      { iso: '2026-03-28T18:30:00.000Z', date: 29 },
    ],
    tone: 'warn',
  },
  {
    s: "'2026-03-29 00:00'",
    how: 'пробел вместо `T` → не ISO; все три движка — местное',
    cells: [
      { iso: '2026-03-28T21:00:00.000Z', date: 29 },
      { iso: '2026-03-29T04:00:00.000Z', date: 29 },
      { iso: '2026-03-28T18:30:00.000Z', date: 29 },
    ],
    tone: 'warn',
  },
];

/** Ячейка таблицы разбора: момент по UTC и какое число месяца увидит `getDate()`. */
export const parseCell = (c: { iso: string; date: number }) =>
  `\`${c.iso.slice(5, 10)} ${c.iso.slice(11, 16)}Z\` · ${c.date === 29 ? '29-е' : `**${c.date}-е**`}`;

export const PARSE_NOTE =
  'Правило записано в стандарте прямо: строка только с датой читается как UTC, строка с датой и временем без пояса — как местное время. Так сложилось исторически, и поменять это уже нельзя — сломается код, который на это опирается. Последствие: `new Date(\'2026-03-29\')` в Москве и Калькутте даёт 29-е, а в Нью-Йорке — **28-е**, вечер субботы. Код, проверенный в Москве, где полночь UTC — это три часа ночи того же дня, ошибки не покажет.';

/**
 * `<input type="date">` и ошибка «минус день». Исполняется тестом через `eval` в процессах
 * с `TZ` из `DATE_INPUT_OUT`: результат — значение последнего выражения.
 */
export const DATE_INPUT_CODE = `// <input type="date"> отдаёт строку
const value = '2026-03-29';

const wrong = new Date(value);              // полночь по UTC
const [y, m, d] = value.split('-').map(Number);
const right = new Date(y, m - 1, d);        // полночь по местному времени

[wrong.getDate(), right.getDate()];`;

export const DATE_INPUT_OUT: { tz: string; out: string }[] = [
  { tz: 'Europe/Moscow', out: '[29,29]' },
  { tz: 'America/New_York', out: '[28,29]' },
];

export const DATE_INPUT_NOTE =
  'В Москве оба способа дают 29-е, в Нью-Йорке первый — 28-е. Пользователь выбрал в календаре 29 марта, а на экране подтверждения видит 28-е. `right` надёжнее, но это всё равно момент: «полночь по местному времени», а не просто дата. Для даты без времени в Temporal есть отдельный тип — `PlainDate`, у которого пояса нет вовсе.';

// ─── Раздел 3. Летнее время ────────────────────────────────────────────────────────────────

export const PLAIN_GAP =
  'Как нумерация мест в зале, где весной вынули ряд, а осенью вставили лишний. Билет «ряд 2, место 30» весной не ведёт никуда — такого ряда нет, и капельдинер сажает вас в следующий. Осенью таких рядов два, и он сажает в первый. Он не спрашивает и не предупреждает — ровно так поступает `Date`.';

export const DST_ROWS: ExprRow[] = [
  { code: 'new Date(2026, 2, 29, 2, 30).getHours()', tz: 'Europe/Berlin', out: '3', why: '02:30 в Берлине 29 марта не было: после 01:59 сразу 03:00. `Date` сдвинул время вперёд на длину разрыва', tone: 'warn' },
  { code: 'new Date(2026, 2, 29, 2, 30).toISOString()', tz: 'Europe/Berlin', out: "'2026-03-29T01:30:00.000Z'", why: 'то есть 03:30 по летнему времени, `+02:00`' },
  { code: "new Date('2026-03-29T02:30').getHours()", tz: 'Europe/Berlin', out: '3', why: 'строка без пояса — местное время, правило то же' },
  { code: 'new Date(2026, 9, 25, 2, 30).toISOString()', tz: 'Europe/Berlin', out: "'2026-10-25T00:30:00.000Z'", why: '25 октября 02:30 было дважды. `Date` взял первое — ещё летнее, `+02:00`', tone: 'warn' },
  { code: 'new Date(2026, 2, 8, 2, 30).getHours()', tz: 'America/New_York', out: '3', why: 'в США переход в другое воскресенье и по местному времени — 2:00', tone: 'warn' },
  { code: 'new Date(2026, 10, 1, 1, 30).toISOString()', tz: 'America/New_York', out: "'2026-11-01T05:30:00.000Z'", why: 'из двух 01:30 — первое, `-04:00`' },
  { code: 'new Date(2026, 9, 4, 2, 15).getMinutes()', tz: 'Australia/Lord_Howe', out: '45', why: 'на острове Лорд-Хау часы переводят на полчаса: 02:15 не было, вышло 02:45' },
  { code: 'new Date(1986, 0, 1).getMinutes()', tz: 'Asia/Kathmandu', out: '15', why: '1 января 1986 года Непал сдвинул часы на 15 минут вперёд. Полуночи в тот день не было, «начало дня» — 00:15', tone: 'err' },
  { code: '(new Date(2026, 2, 30) - new Date(2026, 2, 29)) / 3600000', tz: 'Europe/Berlin', out: '23', why: 'в весенних сутках 23 часа' },
  { code: '(new Date(2026, 9, 26) - new Date(2026, 9, 25)) / 3600000', tz: 'Europe/Berlin', out: '25', why: 'в осенних — 25' },
];

export const DST_NOTE =
  'Правило выбора записано в стандарте ECMAScript и одинаково во всех трёх движках: время из разрыва читается по смещению **до** перехода (на часах выходит на длину разрыва позже), из двух повторов берётся **первый**. На стенде Chromium 153, Firefox 155 и WebKit 26.6 с поясом Берлина ответили одинаково. Ошибки при этом нет ни в одном случае — `Date` не умеет сказать «такого времени не было».';

/** «Завтра в то же время». Тест исполняет строку в процессах с `TZ` из `TOMORROW_OUT`. */
export const TOMORROW_CODE = `// Суббота, 28 марта 2026, полдень
const noon = new Date(2026, 2, 28, 12, 0);

const plus24h = new Date(noon.getTime() + 24 * 60 * 60 * 1000);
const tomorrow = new Date(noon);
tomorrow.setDate(noon.getDate() + 1);       // тот же час, следующее число

[plus24h.getHours(), tomorrow.getHours()];`;

export const TOMORROW_OUT: { tz: string; out: string }[] = [
  { tz: 'Europe/Moscow', out: '[12,12]' },
  { tz: 'Europe/Berlin', out: '[13,12]' },
];

export const TOMORROW_NOTE =
  'В Москве оба способа дают полдень воскресенья, в Берлине прибавка 24 часов — **13:00**: воскресные сутки короче на час. «Через день» и «через 24 часа» — разные вопросы, и `Date` отвечает на тот, что вы задали. Напоминание «завтра в 12:00», посчитанное прибавкой миллисекунд, дважды в год приходит на час раньше или позже. В России перевода часов нет с 2014 года, поэтому у разработчика здесь ошибка не воспроизводится — она живёт у пользователей в Европе и Америке.';

// ─── Раздел 4. Сравнение и вывод ───────────────────────────────────────────────────────────

export const COMPARE_ROWS: ExprRow[] = [
  { code: 'new Date(2026, 2, 29) === new Date(2026, 2, 29)', tz: 'Europe/Moscow', out: 'false', why: 'два разных объекта: `===` сравнивает ссылки', tone: 'err' },
  { code: '+new Date(2026, 2, 29) === +new Date(2026, 2, 29)', tz: 'Europe/Moscow', out: 'true', why: 'плюс превращает дату в число — сравниваются миллисекунды', tone: 'ok' },
  { code: 'new Date(2026, 2, 29) < new Date(2026, 2, 30)', tz: 'Europe/Moscow', out: 'true', why: '`<` и `>` тоже берут число через `valueOf`' },
  { code: 'new Date(2026, 2, 29).getTimezoneOffset()', tz: 'Europe/Moscow', out: '-180', why: 'в минутах и **с обратным знаком**: восточнее Гринвича — минус', tone: 'warn' },
  { code: 'new Date(2026, 2, 29).toISOString()', tz: 'Europe/Moscow', out: "'2026-03-28T21:00:00.000Z'", why: '`toISOString` всегда в UTC: московская полночь — это вечер 28-го' },
  { code: 'new Date(2026, 2, 29).toISOString().slice(0, 10)', tz: 'Europe/Moscow', out: "'2026-03-28'", why: 'частый способ «взять дату» — и она съехала на день', tone: 'err' },
  { code: 'JSON.stringify({ at: new Date(2026, 2, 29) })', tz: 'Europe/Moscow', out: `'{"at":"2026-03-28T21:00:00.000Z"}'`, why: '`JSON.stringify` зовёт `toJSON`, а тот — `toISOString`' },
  { code: 'typeof JSON.parse(\'{"at":"2026-03-28T21:00:00.000Z"}\').at', tz: 'Europe/Moscow', out: "'string'", why: 'обратно приезжает строка: `Date` из JSON сам не восстановится' },
  { code: 'new Date(2026, 2, 29).toString()', tz: 'Europe/Moscow', out: "'Sun Mar 29 2026 00:00:00 GMT+0300 (Moscow Standard Time)'", why: 'местное время машины; название пояса — на языке системы' },
  { code: 'new Date(Date.UTC(2026, 2, 29)).toUTCString()', tz: 'Europe/Moscow', out: "'Sun, 29 Mar 2026 00:00:00 GMT'", why: 'формат HTTP-заголовков `Date`, `Expires`, `Last-Modified`' },
];

export const PLAIN_INTL =
  'Как табло в аэропорту: один и тот же рейс показан по местному времени каждого города. Сам вылет от этого не сдвигается — меняется только подпись. `Intl.DateTimeFormat` с опцией `timeZone` — такое табло для одного момента `Date`.';

/** Один момент — три подписи. Тест исполняет строку и сверяет с `INTL_OUT`. */
export const INTL_CODE = `const at = new Date(Date.UTC(2026, 2, 29, 0, 0));   // один момент

const show = (timeZone) =>
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone }).format(at);

[show('Europe/Moscow'), show('America/New_York'), show('Asia/Kolkata')];`;

export const INTL_OUT = ['29 марта 2026 г. в 03:00', '28 марта 2026 г. в 20:00', '29 марта 2026 г. в 05:30'];

export const INTL_NOTE =
  'Без `timeZone` берётся пояс машины. На сервере в контейнере это обычно UTC, у читателя — его город, и одна и та же страница при серверной отрисовке выходит с двумя разными временами (подробно — в [«SSR и гидратации», раздел «Несовпадения»](/frameworks/ssr-hydration/#s3)). Сам текст принадлежит библиотеке ICU и меняется между её версиями: нулевое смещение Node 24 (ICU 77.1) печатает как `GMT`, а Node 26 (ICU 78.3) и Chromium 153 — как `GMT+00:00`. Разбирать отформатированную строку обратно нельзя; нужны части — `formatToParts`, нужны числа — геттеры или Temporal.';

// ─── Раздел 5. База поясов ─────────────────────────────────────────────────────────────────

export const PLAIN_TZDB =
  'Как расписание электричек. «Отправление в 8:15» — это смещение: верно сегодня. А расписание станции — зона: в нём записано и то, что с понедельника поезд уходит в 8:20, и как он ходил прошлой зимой. Расписание печатают заново, когда меняется движение, и у каждого кассира — экземпляр своего года.';

export const ZONE_ROWS: { zone: string; offsets: string; what: string; tone?: 'warn' | 'err' }[] = [
  { zone: 'Europe/Moscow', offsets: '`+03:00`', what: 'С 27 марта 2011 года — «вечное летнее» `+04:00`, с 26 октября 2014 года — снова `+03:00`. Время 01:00–01:59 в тот день было дважды.', tone: 'warn' },
  { zone: 'Europe/Berlin', offsets: '`+01:00` / `+02:00`', what: 'Правила ЕС: последнее воскресенье марта и октября, в 01:00 по UTC — во всех зонах ЕС одновременно.' },
  { zone: 'America/New_York', offsets: '`-05:00` / `-04:00`', what: 'Второе воскресенье марта и первое ноября, в 02:00 по местному времени — в каждой зоне США в свой момент.' },
  { zone: 'Asia/Kolkata', offsets: '`+05:30`', what: 'Получасовое смещение, летнего времени нет с 1945 года. `resolvedOptions().timeZone` в Node 24 и Chromium 153 называет её старым именем — `Asia/Calcutta`.' },
  { zone: 'Asia/Kathmandu', offsets: '`+05:45`', what: 'До 1986 года было `+05:30`. В новогоднюю ночь 1986 года часы сдвинули на 15 минут — полуночи 1 января не было.', tone: 'warn' },
  { zone: 'Australia/Lord_Howe', offsets: '`+10:30` / `+11:00`', what: 'Летнее время на полчаса: переводят на 30 минут.' },
  { zone: 'Europe/Chisinau', offsets: '`+02:00` / `+03:00`', what: 'Время перехода в базе исправили: в tzdata 2025b Молдова переводит часы в 00:00 по UTC, в 2026a — с 2022 года в 01:00 по UTC, как ЕС.', tone: 'err' },
];

/** Что знает среда о своей базе. Снимок стенда; тест сверяет строку той версии Node, где запущен. */
export const RUNTIME_ROWS: { env: string; icu: string; tz: string; temporal: string }[] = [
  { env: 'Node 24.11.0', icu: '77.1', tz: '2025b', temporal: 'нет; под флагом `--harmony-temporal` — старый черновик с классами `TimeZone` и `Calendar`, которых в стандарте уже нет' },
  { env: 'Node 26.8.2', icu: '78.3', tz: '2026a', temporal: 'нет, и с флагом тоже' },
  { env: 'Chromium 153', icu: 'из JS не видно', tz: 'из JS не видно; Кишинёв — по правилам 2025b', temporal: 'есть, встроенный' },
  { env: 'Firefox 155, WebKit 26.6', icu: '—', tz: '—', temporal: 'есть, встроенный' },
];

/** Как спросить среду о её базе. Тест исполняет строку и сверяет с `RUNTIME_ROWS` для своей версии. */
export const VERSIONS_CODE = `// Node: версии ICU и базы поясов, с которыми собран процесс
[process.versions.icu, process.versions.tz];

// Браузер такого не сообщает; зато в любой среде видно, какие зоны она знает
Intl.supportedValuesOf('timeZone').length;   // 418 — в Node 24, 26 и Chromium 153`;

/** Один вызов — два ответа. Строки снимка: Node 24.11 и Node 26.8 с `TZ=Europe/Chisinau`. */
export const CHISINAU_CODE = `// TZ=Europe/Chisinau
new Date(2026, 2, 29, 3, 30).toISOString();   // 29 марта 2026, 03:30 на часах`;

export const CHISINAU_OUT: { env: string; tz: string; out: string; why: string }[] = [
  { env: 'Node 24.11.0', tz: '2025b', out: "'2026-03-29T00:30:00.000Z'", why: 'переход в 02:00 местного, 03:30 уже летнее, `+03:00`' },
  { env: 'Node 26.8.2', tz: '2026a', out: "'2026-03-29T01:30:00.000Z'", why: 'переход в 03:00 местного: 03:30 попало в разрыв, на часах 04:30' },
];

export const CHISINAU_NOTE =
  'Один и тот же код, одна и та же зона — ответы расходятся на час. Ни одна из версий не сломана: базу исправили между релизами 2025b и 2026a, и исправление задело не только будущее, но и прошедшие с 2022 года переходы. Отсюда два следствия. Сервер и браузер могут жить с разными базами и разойтись во времени, которое оба «правильно» посчитали. А момент, сохранённый как время на часах, при смене базы может сменить смысл; момент в UTC — нет.';

export const TZ_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Храните зону, а не смещение',
    d: '`+03:00` ничего не скажет о том, какое смещение будет у места через полгода. `Europe/Berlin` скажет — по той базе, что стоит в среде. Для встречи «в 10:00 по Берлину» в следующем году нужно имя зоны.',
  },
  {
    t: 'Только имена IANA',
    d: 'Аббревиатуры не годятся: `timeZone: \'MSK\'` даёт `RangeError`. Смещение `+03:00` принимается, но это фиксированное число без переходов. А в `Etc/GMT-3` знак обратный — это `+03:00`, наследство старого стандарта POSIX.',
    tone: 'warn',
  },
  {
    t: 'Имена тоже меняются',
    d: 'В tzdata главное имя Киева — `Europe/Kyiv`, но в списке `Intl.supportedValuesOf(\'timeZone\')` у Node 24 и Chromium 153 стоит старое `Europe/Kiev`. Новое имя принимается и означает ту же зону; сравнивать зоны как строки ненадёжно.',
  },
  {
    t: 'Пояс процесса — это переменная `TZ`',
    d: 'Node берёт пояс из переменной окружения `TZ`, а без неё — из системы. Присвоить `process.env.TZ` можно и на ходу: Node 24 сбрасывает кеш, и следующий `new Date(…)` считает уже по новой зоне — но для всего процесса сразу. Поэтому проверки «а как в Нью-Йорке» надёжнее делать отдельным процессом с `TZ=America/New_York`, а в браузерных тестах — поясом контекста (`timezoneId` в Playwright).',
  },
];

// ─── Раздел 6. Temporal ────────────────────────────────────────────────────────────────────

export const PLAIN_TEMPORAL =
  'Как разные бланки вместо одной анкеты на всё. У `Date` одна графа «момент», и в неё пишут и день рождения, и время встречи, и срок токена — а потом гадают, в каком поясе это читать. В Temporal под каждый вопрос свой бланк, и на бланке «день рождения» графы «час» и «пояс» просто нет.';

export const TYPE_ROWS: { type: string; what: string; example: string; when: string }[] = [
  { type: 'Temporal.Instant', what: 'момент: наносекунды от эпохи, без пояса и календаря', example: '2026-03-29T00:00:00Z', when: 'журналы, сроки токенов, порядок событий — то же, что число в `Date`' },
  { type: 'Temporal.ZonedDateTime', what: 'момент + зона IANA: знает и время на часах, и все переходы', example: '2026-03-29T03:00:00+03:00[Europe/Moscow]', when: 'встреча «в 10:00 по Берлину», «завтра в то же время», повторяющиеся события' },
  { type: 'Temporal.PlainDate', what: 'дата в календаре — без времени и пояса', example: '2026-03-29', when: 'день рождения, дата из `<input type="date">`, дни отпуска' },
  { type: 'Temporal.PlainDateTime', what: 'дата и время на часах — без пояса', example: '2026-03-29T02:30', when: 'промежуточный шаг: время, которое ещё предстоит привязать к зоне' },
  { type: 'Temporal.PlainTime', what: 'время суток без даты', example: '07:00', when: 'часы работы, будильник' },
  { type: 'Temporal.Duration', what: 'длительность по полям: дни отдельно от часов', example: 'P1D, PT23H', when: '«через день» и «через 24 часа» — два разных значения' },
];

/**
 * Тест убирает строку `import`, исполняет остальное через `eval` с `Temporal` из полифила
 * и сверяет значение последнего выражения с `TEMPORAL_OUT`.
 */
export const TEMPORAL_CODE = `import { Temporal } from 'temporal-polyfill';   // в Chromium 153 уже встроен

const noon = Temporal.ZonedDateTime.from('2026-03-28T12:00[Europe/Berlin]');

const tomorrow = noon.add({ days: 1 });    // календарный день
const plus24h = noon.add({ hours: 24 });   // ровно 24 часа

[tomorrow.toString(), plus24h.toString(), tomorrow.hoursInDay];`;

export const TEMPORAL_OUT = ['2026-03-29T12:00:00+02:00[Europe/Berlin]', '2026-03-29T13:00:00+02:00[Europe/Berlin]', 23];

export const TEMPORAL_NOTE =
  'Та же задача, что «завтра в полдень» на `Date`, но вопрос теперь задан словами: `days` — по календарю зоны, `hours` — по часам на стене не смотрит. `hoursInDay` честно говорит, что в воскресенье 23 часа. В строке результата — и смещение, и имя зоны: `+02:00[Europe/Berlin]`. Скобки с зоной — расширение ISO из RFC 9557; `Date` такую строку не разберёт.';

export const PLAIN_DISAMBIGUATION =
  'Это тот же капельдинер из зала с вынутым рядом, только теперь вы сами говорите ему, что делать: «сажайте в ряд раньше», «в ряд позже», «как обычно» — или «если ряда нет, скажите мне». Последний ответ — единственный, при котором ошибка не пройдёт молча.';

/** Время на часах в Берлине → `toZonedDateTime('Europe/Berlin', { disambiguation })`. Пересчитывает тест. */
export const DISAMBIGUATION_ROWS: { mode: string; gap: string; overlap: string; what: string }[] = [
  { mode: "'compatible'", gap: '03:30+02:00', overlap: '02:30+02:00', what: 'по умолчанию — ровно как `Date`: из разрыва вперёд, из повтора первое' },
  { mode: "'earlier'", gap: '01:30+01:00', overlap: '02:30+02:00', what: 'более ранний момент: из разрыва — назад на его длину' },
  { mode: "'later'", gap: '03:30+02:00', overlap: '02:30+01:00', what: 'более поздний момент' },
  { mode: "'reject'", gap: 'RangeError', overlap: 'RangeError', what: 'отказ: пусть решает вызывающий — например, спросит пользователя' },
];

export const DISAMBIGUATION_CODE = `const wall = Temporal.PlainDateTime.from('2026-03-29T02:30');   // время на часах

wall.toZonedDateTime('Europe/Berlin');                                // как Date
wall.toZonedDateTime('Europe/Berlin', { disambiguation: 'reject' });  // RangeError`;

/** Строка с устаревшим смещением: `+01:00` летом в Берлине не бывает. Пересчитывает тест. */
export const OFFSET_ROWS: { mode: string; out: string; what: string }[] = [
  { mode: "'reject'", out: 'RangeError', what: 'по умолчанию в `ZonedDateTime.from`: смещение и зона спорят — отказ' },
  { mode: "'use'", out: '2026-07-01T13:00:00+02:00[Europe/Berlin]', what: 'верить смещению: сохраняется момент, время на часах становится 13:00' },
  { mode: "'ignore'", out: '2026-07-01T12:00:00+02:00[Europe/Berlin]', what: 'верить зоне: сохраняется время на часах, момент сдвигается' },
  { mode: "'prefer'", out: '2026-07-01T12:00:00+02:00[Europe/Berlin]', what: 'смещение, если оно возможно в зоне, иначе — как `ignore`' },
];

export const OFFSET_NOTE =
  'Смещение в строке `ZonedDateTime` — не украшение, а проверка. Строку `2026-03-29T02:30:00+02:00[Europe/Chisinau]` записал Node 26 по базе 2026a. Node 24 с полифилом и Chromium 153 по своей базе считают 02:30 того дня несуществующим — и `from` бросает `RangeError`, вместо того чтобы молча переехать на час. С `{ offset: \'use\' }` сохраняется записанный момент.';

export const TEMPORAL_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Месяцы с единицы, объекты не меняются',
    d: '`Temporal.PlainDate.from(\'2026-03-29\').month` — `3`. Методы `add`, `with`, `round` возвращают новый объект; сеттеров, как у `Date`, нет, и общий объект нельзя испортить из соседнего кода.',
  },
  {
    t: '31 января + месяц',
    d: '`PlainDate.from(\'2026-01-31\').add({ months: 1 })` — `2026-02-28`: день прижимается к концу месяца. С `{ overflow: \'reject\' }` — `RangeError`. У `Date` то же действие через `setMonth` даёт 3 марта.',
  },
  {
    t: '`<` на Temporal бросает исключение',
    d: '`valueOf` у Temporal-объектов нарочно бросает `TypeError`, поэтому `a < b` и `new Date(instant)` — ошибка, а не тихое сравнение строк. Сравнивают `Temporal.Instant.compare(a, b)` и `a.equals(b)`.',
    tone: 'warn',
  },
  {
    t: '`equals` у `ZonedDateTime` сравнивает и зону',
    d: '`01:00[UTC]` и `03:00+02:00[Europe/Berlin]` 29 марта — один момент, но `equals` вернёт `false`: зоны разные. Один ли это момент — спрашивают через `epochMilliseconds` или `toInstant().equals(…)`.',
    tone: 'warn',
  },
  {
    t: 'Мост к `Date`',
    d: '`Temporal.Instant.fromEpochMilliseconds(date.getTime())` в одну сторону, `new Date(instant.epochMilliseconds)` — в другую. В Chromium 153 у `Date` уже есть метод `toTemporalInstant()`; полифил добавляет его только при импорте `temporal-polyfill/global`.',
  },
  {
    t: 'JSON',
    d: '`JSON.stringify({ at: Temporal.Instant.from(\'2026-03-29T00:00Z\') })` даёт `{"at":"2026-03-29T00:00:00Z"}` — `toJSON` есть у всех типов. Обратно — тоже строка, восстанавливают явно: `Temporal.Instant.from(s)`.',
  },
];

export const SUPPORT_NOTE =
  'Где Temporal есть: на стенде встроенный объект нашёлся в Chromium 153, Firefox 155 и WebKit 26.6, а в Node его нет ни в 24.11, ни в 26.8. В средах старше этих — по таблицам совместимости MDN и caniuse. Там, где его нет, работает `temporal-polyfill`: 57 КБ после минификации, 20 КБ в gzip. Правила зон полифил не везёт с собой — берёт из `Intl` той среды, где запущен, поэтому и базу поясов, и её версию он наследует от неё.';

// ─── Раздел 7. Местное время → UTC своими руками ───────────────────────────────────────────

export const PLAIN_CANDIDATES =
  'Как вычислить, во сколько по Гринвичу вы проснулись, если знаете только «7:00 по местному». Перебираете все смещения, какие бывали в вашем городе: «если было `+02:00` — значит, 5:00 по Гринвичу». А потом проверяете по календарю переходов: действовало ли `+02:00` в 5:00 по Гринвичу. Подошёл один ответ — всё ясно. Два — час повторялся. Ни одного — вы проснулись в час, которого не было.';

/**
 * Учебная функция темы. Печатается `CodeBlock`, исполняется демо (`widgets/tz-lab/model/run.ts`)
 * и тестом — против `temporal-polyfill` и `Date` в процессах с `TZ`.
 */
export const LOCAL_TO_UTC_CODE = `const MINUTE = 60_000;

// table — переходы зоны: [{ at, before, after }], at — момент по UTC (мс),
// before/after — смещение до и после в минутах к востоку: Берлин зимой 60.
function offsetAt(table, utc) {
  let offset = table[0].before;
  for (const t of table) {
    if (utc >= t.at) offset = t.after;
  }
  return offset;
}

// local — время на часах, записанное как Date.UTC(год, месяц, день, час, минута).
// Пробуем каждое смещение, какое бывало в зоне: момент = local − смещение.
// Кандидат годится, если в этот момент зона и правда жила с этим смещением.
function candidates(table, local) {
  const offsets = [...new Set(table.flatMap((t) => [t.before, t.after]))];
  return offsets
    .map((offset) => {
      const utc = local - offset * MINUTE;
      return { offset, utc, fits: offsetAt(table, utc) === offset };
    })
    .sort((a, b) => a.utc - b.utc);
}

function localToUtc(table, local, disambiguation = 'compatible') {
  const fits = candidates(table, local).filter((c) => c.fits).map((c) => c.utc);
  if (fits.length === 1) return fits[0];
  if (disambiguation === 'reject') {
    throw new RangeError(fits.length ? 'это время повторяется' : 'такого времени не было');
  }
  if (fits.length > 1) {
    // Повтор: compatible и earlier берут первый момент, later — последний.
    return disambiguation === 'later' ? fits[fits.length - 1] : fits[0];
  }
  // Разрыв: ищем переход, который перепрыгнул local.
  const t = table.find(
    (t) => local >= t.at + t.before * MINUTE && local < t.at + t.after * MINUTE,
  );
  // earlier — по новому смещению: момент до перехода, на часах local − разрыв.
  // later и compatible — по старому: момент после перехода, на часах local + разрыв.
  return disambiguation === 'earlier' ? local - t.after * MINUTE : local - t.before * MINUTE;
}`;

export const LOCAL_TO_UTC_NOTE =
  'Функция не знает про лето и зиму — только таблицу переходов. Поэтому она одинаково работает для Берлина, получасового Лорд-Хау, Катманду с его 15 минутами и Москвы 2014 года, где час повторился без всякого летнего времени. Стандарт ECMAScript описывает то же самое: операция `GetNamedTimeZoneEpochNanoseconds` возвращает список возможных моментов — пустой, из одного или из двух, — и правило выбора применяется к этому списку. Значения `disambiguation` — те же четыре, что у Temporal, и тест сверяет функцию с полифилом на всех четырёх.';

/** Пример вызова: таблица Берлина за 2026 год. Тест исполняет его вместе с `LOCAL_TO_UTC_CODE`. */
export const CALL_CODE = `// Europe/Berlin, 2026 год
const berlin = [
  { at: Date.parse('2026-03-29T01:00Z'), before: 60, after: 120 },
  { at: Date.parse('2026-10-25T01:00Z'), before: 120, after: 60 },
];

const wall = Date.UTC(2026, 2, 29, 2, 30);   // 29 марта, 02:30 на часах

[
  new Date(localToUtc(berlin, wall)).toISOString(),
  new Date(localToUtc(berlin, wall, 'earlier')).toISOString(),
];`;

export const CALL_OUT = ['2026-03-29T01:30:00.000Z', '2026-03-29T00:30:00.000Z'];

const at = (iso: string) => Date.parse(iso);

/**
 * Таблицы переходов, сняты полифилом (`getTimeZoneTransition`). Тест пересобирает каждую
 * на её отрезке и сверяет; таблицу с другой версией tzdata, чем у процесса, пропускает.
 */
export const ZONE_TABLES: Record<string, ZoneTable> = {
  berlin: {
    zone: 'Europe/Berlin',
    tzdata: '2025b',
    transitions: [
      { at: at('2026-03-29T01:00Z'), before: 60, after: 120 },
      { at: at('2026-10-25T01:00Z'), before: 120, after: 60 },
    ],
  },
  newYork: {
    zone: 'America/New_York',
    tzdata: '2025b',
    transitions: [
      { at: at('2026-03-08T07:00Z'), before: -300, after: -240 },
      { at: at('2026-11-01T06:00Z'), before: -240, after: -300 },
    ],
  },
  lordHowe: {
    zone: 'Australia/Lord_Howe',
    tzdata: '2025b',
    transitions: [
      { at: at('2026-04-04T15:00Z'), before: 660, after: 630 },
      { at: at('2026-10-03T15:30Z'), before: 630, after: 660 },
    ],
  },
  kathmandu: {
    zone: 'Asia/Kathmandu',
    tzdata: '2025b',
    transitions: [{ at: at('1985-12-31T18:30Z'), before: 330, after: 345 }],
  },
  moscow: {
    zone: 'Europe/Moscow',
    tzdata: '2025b',
    transitions: [
      { at: at('2010-10-30T23:00Z'), before: 240, after: 180 },
      { at: at('2011-03-26T23:00Z'), before: 180, after: 240 },
      { at: at('2014-10-25T22:00Z'), before: 240, after: 180 },
    ],
  },
  chisinauOld: {
    zone: 'Europe/Chisinau',
    tzdata: '2025b',
    transitions: [
      { at: at('2026-03-29T00:00Z'), before: 120, after: 180 },
      { at: at('2026-10-25T00:00Z'), before: 180, after: 120 },
    ],
  },
  chisinauNew: {
    zone: 'Europe/Chisinau',
    tzdata: '2026a',
    transitions: [
      { at: at('2026-03-29T01:00Z'), before: 120, after: 180 },
      { at: at('2026-10-25T01:00Z'), before: 180, after: 120 },
    ],
  },
};

export const DEMO_SCENARIOS: TzScenario[] = [
  {
    id: 'berlin-spring',
    label: 'Берлин, весна',
    table: ZONE_TABLES.berlin,
    focus: 0,
    step: 15,
    around: 60,
    note: '29 марта 2026: после 01:59 на часах сразу 03:00. Время с 02:00 до 02:59 не подходит ни под одно смещение.',
  },
  {
    id: 'berlin-fall',
    label: 'Берлин, осень',
    table: ZONE_TABLES.berlin,
    focus: 1,
    step: 15,
    around: 60,
    note: '25 октября 2026: в 03:00 летнего времени часы отводят на 02:00. С 02:00 до 02:59 под оба смещения подходит по моменту.',
  },
  {
    id: 'new-york',
    label: 'Нью-Йорк, осень',
    table: ZONE_TABLES.newYork,
    focus: 1,
    step: 15,
    around: 60,
    note: '1 ноября 2026: в США часы отводят в 02:00 по местному времени, поэтому повторяется час с 01:00, а не с 02:00, как в Европе.',
  },
  {
    id: 'lord-howe',
    label: 'Лорд-Хау',
    table: ZONE_TABLES.lordHowe,
    focus: 1,
    step: 5,
    around: 30,
    note: '4 октября 2026: смещения `+10:30` и `+11:00`, переход на полчаса. Разрыв — с 02:00 до 02:29.',
  },
  {
    id: 'kathmandu',
    label: 'Катманду, 1986',
    table: ZONE_TABLES.kathmandu,
    focus: 0,
    step: 5,
    around: 20,
    note: '1 января 1986: `+05:30` → `+05:45`. Разрыв 15 минут приходится на полночь — начало суток выпало.',
  },
  {
    id: 'moscow',
    label: 'Москва, 2014',
    table: ZONE_TABLES.moscow,
    focus: 2,
    step: 15,
    around: 60,
    note: '26 октября 2014: Россия вернулась с `+04:00` на `+03:00`. Не летнее время, а смена правил — но для функции разницы нет: обычный повтор часа.',
  },
  {
    id: 'chisinau-2025b',
    label: 'Кишинёв, tzdata 2025b',
    table: ZONE_TABLES.chisinauOld,
    focus: 0,
    step: 15,
    around: 60,
    note: '29 марта 2026 по базе 2025b (Node 24.11, Chromium 153): разрыв с 02:00 до 02:59, 03:30 — обычное время.',
  },
  {
    id: 'chisinau-2026a',
    label: 'Кишинёв, tzdata 2026a',
    table: ZONE_TABLES.chisinauNew,
    focus: 0,
    step: 15,
    around: 60,
    note: 'Тот же день по базе 2026a (Node 26.8): разрыв с 03:00 до 03:59. Теперь 02:30 существует, а 03:30 — нет.',
  },
];

export const DEMO_CAPTION =
  'Каждая клетка ленты — время на часах. Цвет — сколько смещений к нему подошло: одно, два (час повторился) или ни одного (часы его перепрыгнули). Кандидатов и ответ считают `candidates` и `localToUtc` из кода выше — та же строка, что проверена тестом против Temporal и `Date`.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`new Date(\'2026-03-29\')` — это UTC',
    d: 'Строка только с датой читается как полночь UTC, строка с датой и временем без пояса — как местное время. В Нью-Йорке `getDate()` первой вернёт 28. Отсюда «дата из календаря съехала на день» у пользователей западнее Гринвича.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Месяцы с нуля, неделя с воскресенья',
    d: '`new Date(2026, 2, 29)` — 29 **марта**. `getDay()` — день недели, где 0 — воскресенье; число месяца — `getDate()`. Лишние дни не вызывают ошибку: 31 февраля — это 3 марта.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`toISOString().slice(0, 10)` — дата по UTC',
    d: 'Московская полночь 29 марта даёт `2026-03-28`. Для местной даты — геттеры `getFullYear`, `getMonth`, `getDate` или `Temporal.PlainDate`.',
    tone: 'err',
  },
  {
    n: '04',
    t: '«+24 часа» — не «завтра»',
    d: 'В день перевода часов сутки длятся 23 или 25 часов. Прибавка миллисекунд в Берлине превращает «завтра в 12:00» в 13:00. Календарный шаг — `setDate(d + 1)` или `add({ days: 1 })` у `ZonedDateTime`.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`Date` молча решает за вас в разрыве и повторе',
    d: 'Несуществующее 02:30 становится 03:30, из двух 02:30 выбирается первое. Исключения нет. Если время вводит человек, нужен `disambiguation: \'reject\'` и вопрос к нему.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Смещение — не пояс',
    d: '`+02:00` верно для Берлина только летом. Храните момент в UTC и отдельно имя зоны IANA, а не смещение и не аббревиатуру: `MSK` в `Intl` — `RangeError`.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Знаки наоборот',
    d: '`getTimezoneOffset()` в Москве — `-180`: минуты от местного времени до UTC, а не наоборот. Зона `Etc/GMT-3` — это `+03:00`. Перепутанный знак даёт ошибку ровно на удвоенное смещение.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'У каждой среды своя база поясов',
    d: 'Node 24.11 (tzdata 2025b) и Node 26.8 (2026a) переводят 03:30 29 марта 2026 в Кишинёве в моменты, отличающиеся на час. Версию базы в Node показывает `process.versions.tz`; браузер её не сообщает.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Текст `Intl` — не формат обмена',
    d: 'Вид строки задаёт ICU, и он меняется между версиями: `GMT` в Node 24 и `GMT+00:00` в Node 26 для одного и того же смещения. Для обмена — ISO через `toISOString` или `toString` Temporal; для частей — `formatToParts`.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Temporal нельзя сравнивать `<`',
    d: '`valueOf` бросает `TypeError`. Сравнение — `compare` и `equals`; при этом `ZonedDateTime.equals` учитывает зону, и один момент в двух зонах не равен сам себе.',
    tone: 'warn',
  },
  {
    n: '11',
    t: '`Date.now()` — не секундомер',
    d: 'Системные часы синхронизируются по сети и могут прыгнуть назад; разница двух `Date.now()` тогда отрицательна. Длительность меряют `performance.now()` — он монотонен (по спецификации High Resolution Time). Его точность в разных движках — в [«Трёх движках», раздел «Поведение»](/render/browser-engines/#s4).',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'ECMA-262 — Date Objects',
    href: 'https://tc39.es/ecma262/#sec-date-objects',
    what: 'время как число миллисекунд, предел ±8.64e15, `LocalTime` и `UTC(t)` — правило для разрыва и повтора',
  },
  {
    title: 'ECMA-262 — Date Time String Format',
    href: 'https://tc39.es/ecma262/#sec-date-time-string-format',
    what: 'формат ISO, который обязаны понимать все движки; дата без времени — UTC, дата со временем — местное',
  },
  {
    title: 'Temporal — документация предложения',
    href: 'https://tc39.es/proposal-temporal/docs/',
    what: 'типы `Instant`, `ZonedDateTime`, `Plain*`, `Duration`',
  },
  {
    title: 'Temporal — Time zones and resolving ambiguity',
    href: 'https://tc39.es/proposal-temporal/docs/ambiguity.html',
    what: '`disambiguation` и опция `offset` по шагам',
  },
  {
    title: 'MDN — Temporal',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal',
    what: 'справочник и таблица поддержки в браузерах',
  },
  {
    title: 'temporal-polyfill',
    href: 'https://github.com/fullcalendar/temporal-polyfill',
    what: 'полифил, на котором проверена тема; версия 1.0.5 на стенде',
  },
  {
    title: 'IANA — Time Zone Database',
    href: 'https://www.iana.org/time-zones',
    what: 'база поясов и её выпуски; что изменилось в каждом — в файле NEWS',
  },
  {
    title: 'RFC 9557 — Date and Time on the Internet: Timestamps with Additional Information',
    href: 'https://www.rfc-editor.org/rfc/rfc9557',
    what: 'запись зоны в скобках: `2026-03-29T03:00+03:00[Europe/Moscow]`',
  },
  {
    title: 'Node.js — Internationalization support',
    href: 'https://nodejs.org/api/intl.html',
    what: 'встроенная ICU, `process.versions.icu` и `process.versions.tz`',
  },
  {
    title: 'W3C — High Resolution Time',
    href: 'https://www.w3.org/TR/hr-time-3/',
    what: '`performance.now()` и монотонные часы против системных',
  },
];

export const RELATED =
  'Смежное на сайте: [Числа в JS, раздел «Предел целых»](/js/numbers/#s3) — почему миллисекунды `Date` хранятся точно. [Три движка, раздел «Язык»](/render/browser-engines/#s2) — как движки разбирают строки-даты не в ISO. [SSR и гидратация, раздел «Несовпадения»](/frameworks/ssr-hydration/#s3) — время и пояс как причина расхождения сервера и браузера. [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — даты в заголовках `Date`, `Last-Modified` и эвристика свежести. [Цикл событий Node, раздел «setTimeout и setImmediate»](/js/node-event-loop/#s4) — когда цикл смотрит на часы и почему таймер срабатывает не в ту миллисекунду. [Интернационализация во фронтенде](/frameworks/i18n/) — ICU MessageFormat, ленивые словари vue-i18n и выбор локали.';
