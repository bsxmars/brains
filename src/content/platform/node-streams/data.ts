import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { NsModeInfo, NsParams } from '@/widgets/ns-tick-lab/model/types';

/**
 * Данные темы «`node:stream` изнутри».
 *
 * ── Что чем проверено ────────────────────────────────────────────────────────────────
 *
 * Всё — запуском на Node 26.8.2, детерминированно: ни таймеров, ни замеров времени.
 * «Следующий тик» в примерах — `setImmediate`, то есть «доиграла очередь `nextTick`
 * и микрозадачи», а не миллисекунды.
 *
 * 1. **Демо — модель, и её сверяет тест с настоящим `node:stream`.** `NS_MODEL_CODE` —
 *    Readable и Writable в objectMode, переписанные с `lib/internal/streams/readable.js`
 *    и `writable.js` Node 26 с теми же именами функций. `NS_SCENARIO_CODE` — сценарий демо:
 *    источник, четыре потребителя и цикл тиков. `tests/unit/node-streams.test.ts` прогоняет
 *    сценарий дважды — на модели и на `node:stream` — **на каждом сочетании переключателей
 *    демо** (`DEMO_OPTIONS`) и ещё на пустом и одночанковом источнике, и требует совпадения
 *    каждого кадра: журнал событий по порядку, буфер, `readableLength`, `readableFlowing`,
 *    `reading`, `readableEnded`, очередь записи и `writableNeedDrain`. Режим `for await`
 *    в сценарии — настоящий `for await`: на `node:stream` его обслуживает итератор Node,
 *    на модели — её `[Symbol.asyncIterator]`.
 * 2. **Примеры кода — строки, которые исполняет тест.** `*_CODE` печатаются в теме как есть;
 *    тест срезает `import`, подставляет модули параметрами, собирает `console.log`
 *    и сравнивает с `*_OUT` / `*_ROWS` построчно. Вывод в теме — это их вывод.
 * 3. **Отдельно в тесте**: собственные поля `_readableState` (`OWN_FIELDS`), отсрочка
 *    `_read` до колбэка `_construct`, падение процесса на `'error'` без слушателя
 *    (в дочернем процессе) и числа из подписей демо (`DEMO_CHECKS`).
 *
 * ── Где модель упрощает, и это сказано в теме (`MODEL_LIMITS`) ───────────────────────
 *   только objectMode; один `pipe`; нет ошибок и `destroy(err)`; `autoDestroy` всегда включён;
 *   нет `cork` и `_writev`; итератор без `return()` по `break` и без очереди параллельных
 *   `next()`. Флаги лежат обычными свойствами, а не битовым полем.
 */

// ─── Вводный раздел ─────────────────────────────────────────────────────────────────

export const PLAIN_SHELF =
  'Readable — прилавок с полкой на `highWaterMark` мест. Продавец (`_read`) выкладывает товар (`push`), покупатель забирает. Пока полка не заполнена, продавца зовут снова; заполнилась — не зовут, пока покупатель не заберёт. Всё остальное в `node:stream` — правила о том, **кто кого и когда зовёт**: они и есть внутренности.';

/** Слова, которые тема употребляет раньше, чем объясняет. */
export const GLOSSARY = [
  {
    k: 'чанк',
    d: 'Порция данных за один раз. В байтовом режиме — `Buffer` (строка превращается в него), в objectMode — любое значение, кроме `null`: `null` означает «данных больше не будет».',
  },
  {
    k: 'событие и слушатель',
    d: 'Стримы Node — `EventEmitter`: `on(\'data\', fn)` подписывает `fn` на событие. ⚠️ Для стрима подписка на `\'data\'` или `\'readable\'` — не наблюдение, а **команда**: она переключает режим чтения.',
  },
  {
    k: '`highWaterMark`',
    d: 'Порог буфера — не предел. `push()` за порогом принимается, просто отвечает `false`. Сама идея очереди с порогом разобрана в [«Стримах и обратном давлении», раздел «Три числа»](/platform/streams/#s1).',
  },
  {
    k: '`_read` и `push`',
    d: 'Пара вызовов источника. Платформа зовёт `_read()`, источник отвечает `push(chunk)` — сразу или позже. Пока ответа нет, `_read` второй раз не зовут.',
  },
  {
    k: '`process.nextTick`',
    d: 'Очередь Node, которая доигрывает раньше промисов и раньше следующей задачи. Через неё стрим отдаёт почти все свои события: `\'end\'` и `\'close\'` никогда не приходят синхронно, `\'readable\'` о новых данных — тоже.',
  },
  {
    k: '`destroy()`',
    d: 'Разрушение стрима: освободить ресурсы (`_destroy`), затем `\'error\'`, если передана ошибка, и `\'close\'`. Необратимо: после него `push` и `write` уже ничего не делают.',
  },
];

// ─── Перед началом ──────────────────────────────────────────────────────────────────

export const PREREQ = [
  {
    t: 'Очередь с порогом и обратное давление',
    d: 'Что стрим — это очередь с `highWaterMark`, а обратное давление — отсутствие вызова, а не сообщение «притормози».',
    href: '/platform/streams/#s1',
    hrefLabel: 'Стримы и обратное давление, раздел «Три числа»',
    tone: 'info' as const,
  },
  {
    t: 'Базовый API `node:stream`',
    d: '`write()` отвечает `false` и приходит `\'drain\'`; `.pipe()` не убирает за собой, а `pipeline()` убирает; `toWeb`/`fromWeb`; когда брать какой API.',
    href: '/platform/streams/#s3',
    hrefLabel: 'Стримы и обратное давление, раздел «Записываемый поток и отметка воды», подраздел «Второй API стримов»',
    tone: 'warn' as const,
  },
  {
    t: '`process.nextTick` и микрозадачи',
    d: 'События стрима приходят через очередь `nextTick`, а `for await` живёт на промисах. Кто из них раньше, решает цикл событий Node.',
    href: '/js/event-loop/#s5',
    hrefLabel: 'Event Loop, раздел «Node: тот же принцип, другая машина»',
    tone: 'info' as const,
  },
  {
    t: 'Протокол итератора и `return()`',
    d: '`break` из `for await` зовёт у итератора `return()`, а итератор стрима на это разрушает стрим.',
    href: '/js/object-model/#s8',
    hrefLabel: 'Объектная модель, раздел «Итераторы и генераторы»',
    tone: 'warn' as const,
  },
];

// ─── Раздел 1 · четыре класса ───────────────────────────────────────────────────────

export const CLASSES = {
  head: ['класс', 'что пишете вы', 'что делает платформа'],
  rows: [
    ['`Readable`', '`_read(size)`; по желанию `_destroy`, `_construct`', 'буфер, режимы чтения, решение, когда звать `_read`, события `\'data\'`, `\'readable\'`, `\'end\'`'],
    ['`Writable`', '`_write(chunk, enc, cb)`; по желанию `_writev`, `_final`, `_destroy`, `_construct`', 'очередь записей, ответ `write()`, `\'drain\'`, `\'finish\'`'],
    ['`Duplex`', '`_read` **и** `_write`', 'две независимые половины: у каждой свой буфер и свой порог. `allowHalfOpen` решает, закрывать ли запись, когда кончилось чтение'],
    ['`Transform`', '`_transform(chunk, enc, cb)`; по желанию `_flush(cb)`', 'Duplex, у которого `_read` и `_write` уже написаны: записанное идёт в `_transform`, его результат — в `push`'],
    ['`PassThrough`', 'ничего', 'Transform, отдающий чанк как есть: наблюдатель или стык в цепочке'],
  ],
};

export const METHODS = {
  head: ['метод', 'кто и когда зовёт', 'как ответить'],
  rows: [
    ['`_read(size)`', '`read()` — когда буфер ниже порога **и** прошлый `_read` уже получил ответ', '`this.push(chunk)` — сейчас или позже, хоть несколько раз; `push(null)` — конец'],
    ['`_write(chunk, enc, cb)`', '`write()`, если запись сейчас не идёт; иначе чанк ждёт в очереди', '`cb()` — записано; `cb(err)` — стрим разрушится'],
    ['`_writev(chunks, cb)`', 'когда в очереди больше одного чанка: после `uncork()` или пока шла прошлая запись', 'один `cb` на всю пачку'],
    ['`_final(cb)`', 'после `end()`, когда очередь записей пуста, — до `\'finish\'`', '`cb()` — и придёт `\'finish\'`'],
    ['`_transform(chunk, enc, cb)`', 'на каждую запись в Transform', '`cb(null, out)` или `this.push(…)` сколько угодно раз и `cb()`'],
    ['`_flush(cb)`', 'после `end()` у Transform, до его `\'finish\'`', '`cb(null, last)` — последний шанс что-то выдать'],
    ['`_destroy(err, cb)`', '`destroy()` — синхронно, в том же вызове', '`cb(err)`; `\'error\'` и `\'close\'` придут на следующем тике'],
    ['`_construct(cb)`', 'сразу после конструктора', 'пока `cb` не вызван, ни `_read`, ни `_write` не зовут: удобно открыть файл или сокет'],
  ],
};

export const PLAIN_READ =
  '`_read` — это не «дай данные», а «можно ещё». Как официант, который подходит к столу, только когда тарелка пуста: принёс — отошёл, и снова подойдёт, лишь когда место освободится. Не принёс ничего — сам больше не подойдёт: пока источник не вызвал `push`, `_read` не повторят.';

/** Сквозной пример темы: на него ссылаются разделы про события и про ошибки. */
export const SAMPLE_CODE = `import { Readable, Transform, Writable } from 'node:stream'

class Numbers extends Readable {          // источник: 1, 2, 3 — по запросу
  constructor(max) {
    super({ objectMode: true, highWaterMark: 2 })
    this.n = 0
    this.max = max
  }
  _read() {
    this.push(this.n < this.max ? ++this.n : null)   // null — конец данных
  }
}

class Square extends Transform {          // звено: x → x², в конце — итог
  constructor() {
    super({ objectMode: true })
    this.sum = 0
  }
  _transform(x, _enc, done) {
    this.sum += x * x
    done(null, x * x)
  }
  _flush(done) {
    console.log('_flush')
    done(null, \`сумма \${this.sum}\`)
  }
}

class Collect extends Writable {          // сток: складывает в массив
  constructor() {
    super({ objectMode: true })
    this.items = []
  }
  _write(x, _enc, done) {
    this.items.push(x)
    done()
  }
  _final(done) {
    console.log('_final', this.items)
    done()
  }
}

const src = new Numbers(3)
const sq = new Square()
const out = new Collect()
for (const [name, s, events] of [
  ['src', src, ['end', 'close']],
  ['sq', sq, ['finish', 'end', 'close']],
  ['out', out, ['finish', 'close']],
])
  for (const ev of events) s.on(ev, () => console.log(\`\${name} '\${ev}'\`))

src.pipe(sq).pipe(out)
await new Promise((resolve) => out.on('close', resolve))`;

export const SAMPLE_OUT: string[] = [
  "src 'end'",
  "_flush",
  "sq 'end'",
  "_final [1,4,9,\"сумма 14\"]",
  "sq 'finish'",
  "src 'close'",
  "out 'finish'",
  "sq 'close'",
  "out 'close'",
];

export const SAMPLE_NOTE =
  'Источник, звено и сток — по одному методу на класс, остальное делает `node:stream`: зовёт `_read`, передаёт чанки, закрывает звенья по очереди. Что пример печатает и почему у `sq` `\'end\'` приходит **раньше** его же `\'finish\'`, — в разделе «Порядок событий».';

// ─── Раздел 2 · состояние ───────────────────────────────────────────────────────────

export const STATE_CODE = `import { Readable } from 'node:stream'

const rs = new Readable({ objectMode: true, highWaterMark: 2, read() {} })
const tick = () => new Promise((resolve) => setImmediate(resolve))
const show = (step, result = '') => {
  const s = rs._readableState
  console.log(step, result, {
    buffer: s.buffer.slice(s.bufferIndex),
    length: rs.readableLength,
    flowing: rs.readableFlowing,
    ended: s.ended,
    endEmitted: rs.readableEnded,
    destroyed: rs.destroyed,
  })
}

show('new Readable')
show("push('a')", rs.push('a'))
show("push('b')", rs.push('b'))
show("push('c')", rs.push('c'))
rs.pause()
show('pause()')
rs.on('data', () => {})
await tick()
show("on('data') после pause()")
rs.resume()
await tick()
show('resume()')
show('push(null)', rs.push(null))
await tick()
show('тик спустя')`;

export interface StateRow {
  step: string;
  result: string;
  buffer: unknown[];
  length: number;
  flowing: boolean | null;
  ended: boolean;
  endEmitted: boolean;
  destroyed: boolean;
}

export const STATE_ROWS: StateRow[] = [
  {step: "new Readable", result: "", buffer: [], length: 0, flowing: null, ended: false, endEmitted: false, destroyed: false},
  {step: "push('a')", result: "true", buffer: ["a"], length: 1, flowing: null, ended: false, endEmitted: false, destroyed: false},
  {step: "push('b')", result: "false", buffer: ["a","b"], length: 2, flowing: null, ended: false, endEmitted: false, destroyed: false},
  {step: "push('c')", result: "false", buffer: ["a","b","c"], length: 3, flowing: null, ended: false, endEmitted: false, destroyed: false},
  {step: "pause()", result: "", buffer: ["a","b","c"], length: 3, flowing: false, ended: false, endEmitted: false, destroyed: false},
  {step: "on('data') после pause()", result: "", buffer: ["a","b","c"], length: 3, flowing: false, ended: false, endEmitted: false, destroyed: false},
  {step: "resume()", result: "", buffer: [], length: 0, flowing: true, ended: false, endEmitted: false, destroyed: false},
  {step: "push(null)", result: "false", buffer: [], length: 0, flowing: true, ended: true, endEmitted: false, destroyed: false},
  {step: "тик спустя", result: "", buffer: [], length: 0, flowing: true, ended: true, endEmitted: true, destroyed: true},
];

/** Значение ячейки как код: массив — в скобках через запятую. */
const asCode = (v: unknown) => '`' + (Array.isArray(v) ? `[${v.join(', ')}]` : String(v)) + '`';

export const STATE_TABLE = {
  head: ['шаг', 'ответ', 'buffer', 'length', 'flowing', 'ended', 'readableEnded', 'destroyed'],
  rows: STATE_ROWS.map((r) => [
    asCode(r.step), r.result ? asCode(r.result) : '', asCode(r.buffer), asCode(r.length),
    asCode(r.flowing), asCode(r.ended), asCode(r.endEmitted), asCode(r.destroyed),
  ]),
};

export const STATE_NOTE =
  'Два поля о конце — и они про разное. `ended` становится `true` сразу на `push(null)`: «данных больше не будет». `readableEnded` (внутри — `endEmitted`) — только когда `\'end\'` отдан, то есть последний чанк забран. Между ними может пройти сколько угодно времени, а если никто не читает — вечность. Шаг `on(\'data\')` после `pause()` ничего не пустил: явная пауза сильнее подписки, нужен `resume()`.';

/** `Object.keys(new Readable()._readableState)` на Node 26.8.2 — сверяет тест. */
export const OWN_FIELDS = ['highWaterMark', 'buffer', 'bufferIndex', 'length', 'pipes', 'awaitDrainWriters'];

export const FIELDS_NOTE =
  '`Object.keys(stream._readableState)` на Node 26.8.2 видит шесть полей: `highWaterMark`, `buffer`, `bufferIndex`, `length`, `pipes`, `awaitDrainWriters`. Остальные — `flowing`, `ended`, `reading`, `destroyed` и ещё два десятка — **геттеры на прототипе поверх одного битового поля**: так состояние дешевле держать в памяти. В отладчике их надо раскрывать через прототип, а `JSON.stringify(state)` их не покажет вовсе. `buffer` — массив, из которого выданное не вырезают, а зануляют, сдвигая `bufferIndex`: `shift()` на каждом чтении был бы линейным.';

export const FIELDS = {
  head: ['поле состояния', 'что значит', 'снаружи'],
  rows: [
    ['`buffer`, `bufferIndex`', 'чанки, ждущие потребителя; выданные зануляются, индекс сдвигается', '—'],
    ['`length`', 'сколько лежит: штук в objectMode, байт в байтовом', '`readableLength`'],
    ['`highWaterMark`', 'порог; `read(n)` с `n` больше порога поднимает его', '`readableHighWaterMark`'],
    ['`flowing`', '`null` — режим не выбран, `true` — течёт, `false` — пауза', '`readableFlowing`'],
    ['`reading`', '`_read` вызван, `push` ещё не было: пока `true`, `_read` не повторяют', '—'],
    ['`ended` / `endEmitted`', '`push(null)` был / `\'end\'` отдан', '`readableEnded` — это второе'],
    ['`destroyed`, `errored`, `closed`', 'стрим разрушен / с какой ошибкой / `_destroy` отработал', '`destroyed`, `errored`, `closed`'],
  ],
};

export const WSTATE_CODE = `import { Writable } from 'node:stream'

let finishWrite = null
const ws = new Writable({
  objectMode: true,
  highWaterMark: 2,
  write(chunk, _enc, done) { console.log(\`_write(\${chunk})\`); finishWrite = done },
  writev(chunks, done) { console.log(\`_writev(\${chunks.map((c) => c.chunk)})\`); finishWrite = done },
  final(done) { console.log('_final'); done() },
})
for (const ev of ['drain', 'prefinish', 'finish', 'close']) ws.on(ev, () => console.log(\`'\${ev}'\`))
const tick = () => new Promise((resolve) => setImmediate(resolve))
const show = (step, result = '') => {
  const s = ws._writableState
  console.log(step, result, {
    length: ws.writableLength,
    buffered: s.buffered.map((b) => b.chunk),
    writing: s.writing,
    needDrain: ws.writableNeedDrain,
    ending: ws.writableEnded,
    finished: ws.writableFinished,
  })
}

show("write('a')", ws.write('a'))
show("write('b')", ws.write('b'))
show("write('c')", ws.write('c'))
finishWrite(); await tick()
show('a записан')
finishWrite(); await tick()
show('b и c записаны')
ws.end()
show('end()')
await tick()
show('тик спустя')`;

export interface WStateRow {
  step: string;
  result?: string;
  length?: number;
  buffered?: unknown[];
  writing?: boolean;
  needDrain?: boolean;
  ending?: boolean;
  finished?: boolean;
}

export const WSTATE_ROWS: WStateRow[] = [
  {step: "_write(a)"},
  {step: "write('a')", result: "true", length: 1, buffered: [], writing: true, needDrain: false, ending: false, finished: false},
  {step: "write('b')", result: "false", length: 2, buffered: ["b"], writing: true, needDrain: true, ending: false, finished: false},
  {step: "write('c')", result: "false", length: 3, buffered: ["b","c"], writing: true, needDrain: true, ending: false, finished: false},
  {step: "_writev(b,c)"},
  {step: "a записан", result: "", length: 2, buffered: [], writing: true, needDrain: true, ending: false, finished: false},
  {step: "'drain'"},
  {step: "b и c записаны", result: "", length: 0, buffered: [], writing: false, needDrain: false, ending: false, finished: false},
  {step: "_final"},
  {step: "'prefinish'"},
  {step: "end()", result: "", length: 0, buffered: [], writing: false, needDrain: false, ending: true, finished: false},
  {step: "'finish'"},
  {step: "'close'"},
  {step: "тик спустя", result: "", length: 0, buffered: [], writing: false, needDrain: false, ending: true, finished: true},
];

const optCode = (v: unknown) => (v === undefined ? '' : asCode(v));

export const WSTATE_TABLE = {
  head: ['шаг или событие', 'ответ', 'length', 'buffered', 'writing', 'needDrain', 'writableEnded', 'writableFinished'],
  rows: WSTATE_ROWS.map((r) => [
    asCode(r.step), r.result ? asCode(r.result) : '', optCode(r.length), optCode(r.buffered),
    optCode(r.writing), optCode(r.needDrain), optCode(r.ending), optCode(r.finished),
  ]),
};

export const WSTATE_NOTE =
  'Три вещи, которых не видно по API. **`_writev` пришёл без всякого `cork()`**: пока шла запись `a`, чанки `b` и `c` копились в очереди, и Node отдал их одной пачкой. **`\'drain\'` приходит, когда очередь пуста совсем**, а не когда опустилась ниже порога: `needDrain` держится, пока `length` не станет нулём (в демо ниже, в режиме `pipe`, очередь стока бывает 1 при пороге 2 — и `writableNeedDrain` всё ещё `true`). И **`writableEnded` — это `ending`**: он `true` сразу после `end()`, а что всё действительно записано, говорит `writableFinished` — после `\'finish\'`.';

// ─── Раздел 3 · режимы чтения и демо ────────────────────────────────────────────────

export const PLAIN_FLOWING =
  '`readableFlowing` — кран с тремя положениями. `null` — к крану ещё не прикасались: вода стоит. `true` — открыт: вода льётся в подставленное ведро (`\'data\'`), успеваете вы или нет. `false` — закрыт: воду набирают кружкой (`read()`), по одной и когда сами решат.';

export const MODES = {
  head: ['как читают', '`readableFlowing`', 'кто зовёт `read()`', 'обратное давление'],
  rows: [
    ['`on(\'data\', fn)`', '`true`', 'сам стрим, в цикле, пока есть что отдать', 'нет: всё, что даст источник, уходит в `fn`, пока не вызвана `pause()`'],
    ['`on(\'readable\')` + `read()`', '`false`', 'вы', 'только если брать чанк, когда готовы. Привычный `while (read() !== null)` его снимает'],
    ['`for await (const c of rs)`', '`false`', 'итератор: один `read()` на шаг цикла', 'есть: пока тело цикла работает, `read()` не зовут'],
    ['`rs.pipe(ws)`', '`true` ↔ `false`', 'стрим', 'есть: `write()` → `false` ставит на `pause()`, `\'drain\'` снимает'],
  ],
};

/**
 * Классическая поломка из вводного раздела — изнутри, на одной пересылке файла. Автор курса
 * (2026-09-29): трудное не сокращать, а объяснять подробно и просто. Вводный абзац утверждал
 * «разница в том, кто и когда зовёт `_read`», но не показывал этого по шагам. Механика —
 * строки `MODES`, правило «`_read` зовут, пока буфер ниже порога» (`STATE_CODE`), `pipe`
 * в `NS_MODEL_CODE` («ответ false → pause(); 'drain' приёмника → resume()»), `WSTATE_NOTE`
 * про `'drain'` и `PITFALLS` 02–04. Код сцены иллюстрирует и тестом не исполняется;
 * чисел в нём нет. Чем `pipe()` отличается от `pipeline()` на ошибке — дом разбора
 * в «Стримах и обратном давлении», здесь только ссылка.
 */
export const RELAY_SCENE_CODE = `import { createReadStream } from 'node:fs'

// Сервер отдаёт большой файл медленному клиенту.
// Диск читает быстрее, чем клиент успевает принимать.
const file = createReadStream('big.log')

file.on('data', (chunk) => res.write(chunk))   // ответ write() никто не слушает
file.on('end', () => res.end())`;

export const RELAY_SCENE_NOTE =
  'Что происходит **изнутри**. Подписка на `\'data\'` включает поток: `readableFlowing` становится `true`, и стрим сам зовёт `read()` в цикле. Буфер `file` всё время пуст — чанк тут же уходит в обработчик, — а раз буфер ниже порога, `_read` зовут снова и снова: диск читает с полной скоростью. `res.write()` уже давно отвечает `false`, но этот ответ ничего не выключает — он просто возвращается из функции, которую никто не спросил. Всё, что клиент ещё не забрал, копится в очереди записи `res`, в памяти процесса. `\'end\'` у `file` приходит, когда диск всё отдал, а не когда клиент всё получил. Обратного давления здесь нет не потому, что его «не включили», а потому, что медленность клиента **не доходит до того места, где решают, звать ли `_read`**. Ниже — три способа провести её туда.';

export const RELAY_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: '`pipe()` и `pipeline()`',
    when: '`pipeline(file, res)` — или `file.pipe(res)`',
    what: 'Внутри тот же `\'data\'`, но ответ `write()` услышан: `false` — и `file.pause()`. `readableFlowing` становится `false`, `read()` в цикле больше никто не зовёт, буфер `file` доходит до порога — и `_read` перестают звать: диск встал. Клиент забрал всё из очереди `res` **до нуля** — приходит `\'drain\'`, и `resume()` снова пускает поток.',
    cost: 'Ничего своего писать не надо. Различие между ними — на ошибке: `pipe()` оставляет источник открытым, `pipeline()` разрушает всю цепочку (разобрано в [«Стримах и обратном давлении»](/platform/streams/#s3)).',
  },
  {
    k: '`for await` и ожидание `\'drain\'`',
    when: 'цикл `for await (const chunk of file)`, а в теле — запись, которая ждёт `\'drain\'`, если `write()` ответил `false`',
    what: 'Итератор зовёт `read()` один раз на шаг цикла. Пока тело ждёт `\'drain\'`, следующего шага нет — значит, нет и `read()`; буфер `file` заполняется до порога, и `_read` не зовут. Медленность клиента дошла до диска через тело цикла.',
    cost: 'Ожидание `\'drain\'` — на вас. Забыли его — и цикл снова идёт со скоростью диска: `read()` зовётся на каждом шаге, а очередь `res` растёт, как в сцене выше.',
  },
  {
    k: '`on(\'data\')` и пауза руками',
    when: 'обработчик `\'data\'` сам смотрит на ответ `write()`',
    what: 'Ответ `false` — `file.pause()`; `\'drain\'` у `res` — `file.resume()`. Это ровно то, что `pipe()` делает внутри, только написано вами. Остановить поток может только `pause()`: отписка от `\'data\'` поток не выключает, чанки уйдут в никуда.',
    cost: 'Легко ошибиться в мелочи: забыть `resume()`, повесить `\'drain\'` дважды, не подписаться на `\'error\'` — а `\'error\'` без слушателя роняет процесс. Всё это `pipeline()` уже сделал за вас.',
  },
];

/** Сценарий демо: одна и та же последовательность операций для модели и для node:stream. */
export const NS_SCENARIO_CODE = `async function run({ Readable, Writable, settle }, { mode, hwm, whwm, delay, n, ticks }) {
  const frames = []
  let log = []
  const note = (line) => log.push(line)

  // Журнал событий — через подмену emit: подписка на 'data' или 'readable'
  // сама переключила бы режим стрима, а смотреть надо, не вмешиваясь.
  const spy = (stream, who, events) => {
    const emit = stream.emit
    stream.emit = function (ev, ...args) {
      if (events.includes(ev)) {
        const deaf = this.listenerCount(ev) === 0 ? ' — слушателей нет' : ''
        note(\`\${who} '\${ev}'\${ev === 'data' ? ' ' + args[0] : ''}\${deaf}\`)
      }
      return emit.call(this, ev, ...args)
    }
  }

  // Источник: на каждый _read() отвечает одним чанком, но через тик — как диск или сеть.
  let asked = false
  let sent = 0
  const rs = new Readable({
    objectMode: true,
    highWaterMark: hwm,
    read() { note('rs._read()'); asked = true },
  })
  spy(rs, 'rs', ['data', 'readable', 'pause', 'resume', 'end', 'close'])

  // Потребитель тратит на каждый чанк \`delay\` тиков.
  const backlog = []      // взято из стрима, но ещё не обработано — память вне стрима
  let busy = 0
  let current = null
  let release = null      // продолжить for await или вызвать колбэк _write
  let ws = null

  const snap = (t) => {
    const s = rs._readableState
    frames.push({
      t,
      log,
      buffer: s.buffer.slice(s.bufferIndex),
      length: rs.readableLength,
      flowing: rs.readableFlowing,
      reading: s.reading,
      ended: rs.readableEnded,
      backlog: backlog.slice(),
      current,
      wlength: ws ? ws.writableLength : null,
      needDrain: ws ? ws.writableNeedDrain : null,
    })
    log = []
  }
  snap(0)

  if (mode === 'data') {
    rs.on('data', (c) => backlog.push(c))
  } else if (mode === 'readable') {
    rs.on('readable', () => {
      let c
      while ((c = rs.read()) !== null) backlog.push(c)
    })
  } else if (mode === 'iterator') {
    ;(async () => {
      for await (const c of rs) {
        current = c
        busy = delay
        await new Promise((done) => { release = done })
      }
    })()
  } else if (mode === 'pipe') {
    ws = new Writable({
      objectMode: true,
      highWaterMark: whwm,
      write(c, _enc, done) { note(\`ws._write(\${c})\`); current = c; busy = delay; release = done },
    })
    spy(ws, 'ws', ['drain', 'finish', 'close'])
    const write = ws.write
    ws.write = function (c) {
      const ok = write.call(this, c)
      note(\`ws.write(\${c}) → \${ok}\`)
      return ok
    }
    rs.pipe(ws)
  }

  await settle()
  snap(1)

  for (let t = 2; t <= ticks; t++) {
    // 1. Источник отвечает на запрос, сделанный раньше.
    if (asked) {
      asked = false
      const c = sent < n ? String.fromCharCode(97 + sent++) : null
      note(\`rs.push(\${c})\`)
      rs.push(c)
    }
    // 2. Потребитель заканчивает чанк или берёт следующий из своей очереди.
    if (busy > 0 && --busy === 0) {
      note(\`готов \${current}\`)
      current = null
      const done = release
      release = null
      if (done) done()
    }
    if (!busy && backlog.length) {
      current = backlog.shift()
      busy = delay
    }
    // 3. Всё, что стрим отложил на process.nextTick и в микрозадачи, доигрывает здесь.
    await settle()
    snap(t)
  }
  return frames
}`;

/** Модель node:stream, на которой работает демо. */
export const NS_MODEL_CODE = `// Модель node:stream для демо: только objectMode, один pipe, без ошибок, кодировок,
// cork и _writev. Имена функций — как в lib/internal/streams/readable.js и writable.js
// Node 26: модель можно читать рядом с исходником.

// ── process.nextTick своими руками ──────────────────────────────────────────
// Node доигрывает очередь nextTick между макрозадачами. settle() делает то же:
// сначала дать дойти микрозадачам (for await живёт на промисах), потом прогнать
// очередь — и так, пока она не опустеет.
const ticks = []
const nextTick = (fn, ...args) => ticks.push(() => fn(...args))

async function settle() {
  for (;;) {
    await host.macrotask()
    if (!ticks.length) return
    while (ticks.length) ticks.shift()()
  }
}

// ── EventEmitter: ровно то, чем пользуются стримы ───────────────────────────
class Emitter {
  constructor() { this._ev = {} }
  on(ev, fn) { (this._ev[ev] ??= []).push(fn); return this }
  once(ev, fn) {
    const w = (...a) => { this.removeListener(ev, w); fn.apply(this, a) }
    w.fn = fn
    return this.on(ev, w)
  }
  removeListener(ev, fn) {
    const list = this._ev[ev] ?? []
    const i = list.findIndex((f) => f === fn || f.fn === fn)
    if (i >= 0) list.splice(i, 1)
    return this
  }
  listenerCount(ev) { return (this._ev[ev] ?? []).length }
  emit(ev, ...args) {
    const list = (this._ev[ev] ?? []).slice()
    for (const fn of list) fn.apply(this, args)
    return list.length > 0
  }
}

// ── Readable ────────────────────────────────────────────────────────────────
class Readable extends Emitter {
  constructor({ highWaterMark = 16, read } = {}) {
    super()
    if (read) this._read = read
    // В Node флаги упакованы в битовое поле; здесь — обычные свойства с теми же именами.
    this._readableState = {
      highWaterMark, buffer: [], bufferIndex: 0, length: 0,
      flowing: null,             // null — режим не выбран; true — течёт; false — пауза
      reading: false,            // _read() вызван, push() ещё не было
      sync: true,                // мы внутри _read(): push() пришёл синхронно
      ended: false,              // push(null) был
      endEmitted: false,         // 'end' отдан
      needReadable: false, emittedReadable: false, readableListening: false,
      dataListening: false, resumeScheduled: false, readingMore: false,
      endScheduled: false, destroyed: false, closeEmitted: false, awaitDrain: null,
    }
  }
  get readableLength() { return this._readableState.length }
  get readableFlowing() { return this._readableState.flowing }
  get readableEnded() { return this._readableState.endEmitted }
  get destroyed() { return this._readableState.destroyed }

  // push: источник кладёт чанк. Ответ — «можно ещё» (ниже порога) или «хватит».
  push(chunk) {
    const s = this._readableState
    if (chunk === null) { s.reading = false; onEofChunk(this, s); return false }
    if (s.ended || s.destroyed) return false
    s.reading = false
    addChunk(this, s, chunk)
    return !s.ended && (s.length < s.highWaterMark || s.length === 0)
  }

  // read: отдать чанк из буфера и, если буфер ниже порога, попросить у источника ещё.
  read(n) {
    const s = this._readableState
    if (n !== 0) s.emittedReadable = false
    // read(0) — «проверь, не пора ли»: буфер полон или поток кончился → только сообщить.
    if (n === 0 && s.needReadable &&
        ((s.highWaterMark !== 0 ? s.length >= s.highWaterMark : s.length > 0) || s.ended)) {
      if (s.length === 0 && s.ended) endReadable(this)
      else emitReadable(this)
      return null
    }
    let take = n === 0 || s.length === 0 ? 0 : 1        // objectMode: по одному объекту
    if (take === 0 && s.ended) {
      if (s.length === 0) endReadable(this)
      return null
    }
    // Звать ли _read: буфер пуст или после выдачи окажется ниже порога.
    let doRead = s.needReadable || s.length === 0 || s.length - take < s.highWaterMark
    if (s.reading || s.ended || s.destroyed) doRead = false
    else if (doRead) {
      s.reading = true
      s.sync = true
      if (s.length === 0) s.needReadable = true
      this._read(s.highWaterMark)
      s.sync = false
      if (!s.reading) take = n === 0 || s.length === 0 ? 0 : 1
    }
    let ret = null
    if (take > 0) { ret = s.buffer[s.bufferIndex]; s.buffer[s.bufferIndex++] = null }
    if (ret === null) {
      if (s.length <= s.highWaterMark) s.needReadable = true
    } else {
      s.length -= 1
      s.awaitDrain = null
    }
    if (s.length === 0) {
      s.buffer = []
      s.bufferIndex = 0
      if (!s.ended) s.needReadable = true
      if (n !== take && s.ended) endReadable(this)
    }
    if (ret !== null && !s.closeEmitted) this.emit('data', ret)   // read() всегда шлёт 'data'
    return ret
  }

  // Подписка сама переключает режим: 'data' пускает поток, 'readable' ставит на паузу.
  on(ev, fn) {
    super.on(ev, fn)
    const s = this._readableState
    if (ev === 'data') {
      s.dataListening = true
      if (this.listenerCount('readable') > 0) s.readableListening = true
      if (s.flowing !== false) this.resume()              // после явной pause() — не пускает
    } else if (ev === 'readable' && !s.endEmitted && !s.readableListening) {
      s.readableListening = s.needReadable = true
      s.flowing = false
      s.emittedReadable = false
      if (s.length) emitReadable(this)
      else if (!s.reading) nextTick(() => this.read(0))
    }
    return this
  }

  resume() {
    const s = this._readableState
    if (s.destroyed) return this
    if (!s.flowing) {
      s.flowing = !s.readableListening                     // слушатель 'readable' главнее
      if (!s.resumeScheduled) { s.resumeScheduled = true; nextTick(resume_, this, s) }
    }
    return this
  }

  pause() {
    const s = this._readableState
    if (s.destroyed) return this
    if (s.flowing !== false) { s.flowing = false; this.emit('pause') }
    return this
  }

  // pipe: 'data' → dest.write(); ответ false → pause(); 'drain' приёмника → resume().
  pipe(dest) {
    const src = this
    const s = this._readableState
    src.once('end', () => dest.end())
    let ondrain = null
    const pause = () => {
      s.awaitDrain = dest
      src.pause()
      if (!ondrain) {
        ondrain = () => {
          if (s.awaitDrain === dest) s.awaitDrain = null
          if (!s.awaitDrain && s.dataListening) src.resume()
        }
        dest.on('drain', ondrain)
      }
    }
    const ondata = (chunk) => { if (dest.write(chunk) === false) pause() }
    src.on('data', ondata)
    dest.once('finish', () => {                             // unpipe
      dest.removeListener('drain', ondrain)
      src.removeListener('data', ondata)
      src.pause()
    })
    if (s.flowing !== true) src.resume()
    return dest
  }

  destroy() {
    const s = this._readableState
    if (s.destroyed) return this
    s.destroyed = true
    nextTick(() => { s.closeEmitted = true; this.emit('close') })
    return this
  }

  // for await: read(); пусто — ждать 'readable' или конца потока и повторить.
  // Упрощение: в Node ещё очередь параллельных next(), return() по break и thenable-чанки.
  [Symbol.asyncIterator]() {
    const stream = this
    let wake = () => {}
    let done = false
    const wakeup = () => { const w = wake; wake = () => {}; w() }
    stream.on('readable', wakeup)
    // Конец Node узнаёт через finished(): тот слушает и 'end', но ждёт 'close', если он будет.
    stream.on('end', () => {})
    stream.once('close', () => { done = true; wakeup() })
    const pump = (resolve) => {
      const chunk = stream.destroyed ? null : stream.read()
      if (chunk !== null) resolve({ done: false, value: chunk })
      else if (done) resolve({ done: true, value: undefined })
      else new Promise((r) => { wake = r }).then(() => pump(resolve))
    }
    return {
      next() {
        const chunk = stream.destroyed ? null : stream.read()
        if (chunk !== null) return Promise.resolve({ done: false, value: chunk })
        if (done) return Promise.resolve({ done: true, value: undefined })
        return new Promise((resolve) => {
          new Promise((r) => { wake = r }).then(() => pump(resolve))
        })
      },
    }
  }
}

// Чанк в буфер — или, если поток течёт и буфер пуст, сразу в 'data' мимо буфера.
function addChunk(stream, s, chunk) {
  if (s.flowing && !s.sync && s.dataListening && s.length === 0) {
    s.awaitDrain = null
    stream.emit('data', chunk)
  } else {
    s.length += 1
    s.buffer.push(chunk)
    if (s.needReadable) emitReadable(stream)
  }
  maybeReadMore(stream, s)
}

function onEofChunk(stream, s) {
  if (s.ended) return
  s.ended = true
  if (s.sync) emitReadable(stream)
  else { s.needReadable = false; s.emittedReadable = true; emitReadable_(stream) }
}

// 'readable' о новых данных приходит не синхронно, а через nextTick.
function emitReadable(stream) {
  const s = stream._readableState
  s.needReadable = false
  if (!s.emittedReadable) { s.emittedReadable = true; nextTick(emitReadable_, stream) }
}

function emitReadable_(stream) {
  const s = stream._readableState
  if (!s.destroyed && (s.length || s.ended)) { stream.emit('readable'); s.emittedReadable = false }
  if (!s.flowing && !s.ended && s.length <= s.highWaterMark) s.needReadable = true
  flow(stream)
}

// Дочитать до порога заранее, не дожидаясь потребителя, — тоже на nextTick.
function maybeReadMore(stream, s) {
  if (!s.readingMore && !s.reading) { s.readingMore = true; nextTick(maybeReadMore_, stream, s) }
}

function maybeReadMore_(stream, s) {
  while (!s.reading && !s.ended &&
         (s.length < s.highWaterMark || (s.flowing && s.length === 0))) {
    const len = s.length
    stream.read(0)
    if (len === s.length) break
  }
  s.readingMore = false
}

function resume_(stream, s) {
  if (!s.reading) stream.read(0)
  s.resumeScheduled = false
  stream.emit('resume')
  flow(stream)
  if (s.flowing && !s.reading) stream.read(0)
}

// Поток течёт — значит read() в цикле, пока есть что отдать.
function flow(stream) {
  const s = stream._readableState
  while (s.flowing && stream.read() !== null);
}

// 'end' — только когда буфер пуст: push(null) без читателя до 'end' не доходит.
function endReadable(stream) {
  const s = stream._readableState
  if (s.endEmitted || s.endScheduled) return
  s.ended = s.endScheduled = true
  nextTick(() => {
    s.endScheduled = false
    if (!s.closeEmitted && !s.endEmitted && s.length === 0) {
      s.endEmitted = true
      stream.emit('end')
      stream.destroy()                                      // autoDestroy: true
    }
  })
}

// ── Writable ────────────────────────────────────────────────────────────────
class Writable extends Emitter {
  constructor({ highWaterMark = 16, write } = {}) {
    super()
    if (write) this._write = write
    this._writableState = {
      highWaterMark, length: 0, buffered: [],
      writing: false,            // _write() вызван, колбэк ещё не пришёл
      sync: true, writelen: 0,
      needDrain: false,          // write() уже ответил false — будет 'drain'
      ending: false, finished: false, prefinished: false, destroyed: false,
      pendingcb: 0, afterWritePending: false,
    }
    this._onwrite = () => onwrite(this)
  }
  get writableLength() { return this._writableState.length }
  get writableNeedDrain() { const w = this._writableState; return !w.destroyed && !w.ending && w.needDrain }
  get destroyed() { return this._writableState.destroyed }

  write(chunk) {
    const w = this._writableState
    w.pendingcb++
    w.length += 1
    if (w.writing) w.buffered.push(chunk)                   // занят — в очередь
    else {
      w.writelen = 1; w.writing = true; w.sync = true
      this._write(chunk, 'buffer', this._onwrite)
      w.sync = false
    }
    const ret = w.length < w.highWaterMark || w.length === 0
    if (!ret) w.needDrain = true
    return ret && !w.destroyed
  }

  end() {
    const w = this._writableState
    if (!w.ending) { w.ending = true; finishMaybe(this, w, true) }
    return this
  }

  destroy() {
    const w = this._writableState
    if (w.destroyed) return this
    w.destroyed = true
    nextTick(() => this.emit('close'))
    return this
  }
}

// Колбэк _write: чанк записан — следующий из очереди, а если очередь пуста — 'drain'.
function onwrite(stream) {
  const w = stream._writableState
  const sync = w.sync
  w.writing = false
  w.length -= w.writelen
  w.writelen = 0
  if (w.buffered.length) {
    const chunk = w.buffered.shift()
    w.writelen = 1; w.writing = true; w.sync = true
    stream._write(chunk, 'buffer', stream._onwrite)
    w.sync = false
  }
  if (sync) {
    // Колбэк позвали прямо из _write — 'drain' откладывается на nextTick.
    if (!w.afterWritePending && w.needDrain && w.length === 0) {
      w.afterWritePending = true
      nextTick(afterWrite, stream, w)
    } else {
      w.pendingcb--
      if (w.ending) finishMaybe(stream, w, true)
    }
  } else afterWrite(stream, w)
}

// 'drain' — когда очередь опустела совсем, а не когда опустилась ниже порога.
function afterWrite(stream, w) {
  w.afterWritePending = false
  if (w.needDrain && !w.ending && !w.destroyed && w.length === 0) {
    w.needDrain = false
    stream.emit('drain')
  }
  w.pendingcb--
  if (w.ending) finishMaybe(stream, w, true)
}

function needFinish(w) {
  return w.ending && !w.destroyed && !w.finished && !w.writing && !w.buffered.length && w.length === 0
}

function finishMaybe(stream, w, sync) {
  if (!needFinish(w)) return
  if (!w.prefinished) { w.prefinished = true; stream.emit('prefinish') }
  if (w.pendingcb === 0) {
    w.pendingcb++
    const go = () => { if (needFinish(w)) finish(stream, w); else w.pendingcb-- }
    if (sync) nextTick(go)
    else go()
  }
}

function finish(stream, w) {
  w.pendingcb--
  w.finished = true
  stream.emit('finish')
  stream.destroy()                                          // autoDestroy: true
}

return { Readable, Writable, settle }`;

export const DEMO_DEFAULTS: NsParams = { mode: 'iterator', hwm: 2, whwm: 2, delay: 2, n: 8, ticks: 40 };

/** Все значения переключателей демо — тест прогоняет каждое сочетание. */
export const DEMO_OPTIONS = { hwm: [0, 1, 2, 4], whwm: [1, 2, 3], delay: [1, 2, 3] };

/**
 * Числа из подписей режимов при значениях по умолчанию (`DEMO_DEFAULTS`). Подписи
 * собираются из них, а тест сверяет их с прогоном на настоящем `node:stream`.
 */
export const DEMO_CHECKS = {
  data: {
    maxBacklog: 4,
    maxLength: 0,
    maxWLength: 0,
    endTick: 10,
    lastTick: 18,
    needDrainBelowHwm: false
  },
  readable: {
    maxBacklog: 4,
    maxLength: 0,
    maxWLength: 0,
    endTick: 10,
    lastTick: 19,
    needDrainBelowHwm: false
  },
  iterator: {
    maxBacklog: 0,
    maxLength: 2,
    maxWLength: 0,
    endTick: 16,
    lastTick: 18,
    needDrainBelowHwm: false
  },
  pipe: {
    maxBacklog: 0,
    maxLength: 2,
    maxWLength: 2,
    endTick: 17,
    lastTick: 17,
    needDrainBelowHwm: true
  }
};

export const NS_MODES: NsModeInfo[] = [
  {
    value: 'data',
    label: "on('data')",
    note: `Буфер стрима пуст всё время, \`readableFlowing\` — \`true\`, а \`_read\` зовут на каждом тике. Обратного давления нет: при пороге 2 и двух тиках на чанк у потребителя копится до ${DEMO_CHECKS.data.maxBacklog} необработанных чанков — **вне стрима, в его собственной очереди**. \`'end'\` приходит на тике ${DEMO_CHECKS.data.endTick}, а работа кончается только на ${DEMO_CHECKS.data.lastTick}.`,
  },
  {
    value: 'readable',
    label: "'readable' + read()",
    note: `\`readableFlowing\` — \`false\`, но картина та же, что у \`'data'\`: обработчик \`'readable'\` вычерпывает буфер циклом \`while (read() !== null)\` до дна, и при пороге 2 и двух тиках на чанк до ${DEMO_CHECKS.readable.maxBacklog} чанков снова ждут у потребителя. Пауза сама по себе ничего не тормозит — тормозит то, что вы **не берёте** чанк, пока не готовы.`,
  },
  {
    value: 'iterator',
    label: 'for await',
    note: `Буфер заполняется до порога и встаёт: пока тело цикла занято, \`read()\` не зовут, а значит, и \`_read\`. У потребителя вне стрима — ноль. Источник идёт со скоростью потребителя: при пороге 2 и двух тиках на чанк \`'end'\` приходит на тике ${DEMO_CHECKS.iterator.endTick}, а не ${DEMO_CHECKS.data.endTick}, как у \`'data'\`. \`'data'\` в журнале без слушателей: \`read()\` шлёт его всегда.`,
  },
  {
    value: 'pipe',
    label: 'pipe',
    note: `\`write()\` отвечает \`false\` — и тут же \`'pause'\`; пришёл \`'drain'\` — \`'resume'\`. \`'drain'\` ждёт, пока очередь стока опустеет **до нуля**: при пороге записи 2 в ней бывает один чанк, а \`writableNeedDrain\` всё ещё \`true\`. Бывает и \`'pause'\`, сразу за ним \`'resume'\` — при \`readableFlowing\` \`false\`: это доиграл \`resume()\`, запланированный на \`nextTick\` раньше паузы.`,
  },
];

export const DEMO_NOTE =
  'Источник на каждый `_read()` отвечает одним чанком через тик — как диск или сеть. Потребитель тратит на чанк заданное число тиков. Тик — это «источник ответил, потребитель поработал, отложенное на `process.nextTick` и в промисы доиграло».';

export const DEMO_CAPTION =
  `Сравните \`for await\` и \`on('data')\` при одних и тех же числах. При значениях по умолчанию у \`on('data')\` \`'end'\` приходит на тике ${DEMO_CHECKS.data.endTick}, а работа кончается на ${DEMO_CHECKS.data.lastTick}: всё это время чанки, которые источник выдал без спроса, ждут у потребителя вне стрима. У \`for await\` \`'end'\` приходит на тике ${DEMO_CHECKS.iterator.endTick} — источник шёл со скоростью потребителя. Вывод для своего кода: если потребитель медленнее источника, читайте через \`for await\` или \`pipeline()\`, а не \`on('data')\`. Настоящего \`node:stream\` в браузере нет, поэтому демо работает на модели (она напечатана ниже) — по каждому сочетанию переключателей она совпадает с Node 26.8.2 кадр в кадр.`;

export const SCENARIO_NOTE =
  'Журнал ведётся подменой `emit`, а не подпиской: подписка на `\'data\'` или `\'readable\'` сама переключила бы режим. Поэтому в журнале видны и события, которых никто не слушает, — с пометкой «слушателей нет».';

export const MODEL_LIMITS: string[] = [
  'только objectMode: размер каждого чанка — 1, `read(n)` не поддержан;',
  'один `pipe`, без ошибок и без `destroy(err)`; `autoDestroy` всегда включён;',
  'нет `cork` и `_writev`: очередь записи отдаёт чанки по одному;',
  'итератор без `return()` по `break`, без очереди параллельных `next()` и без чанков-промисов;',
  'флаги состояния — обычные свойства, а не битовое поле.',
];

export const MODEL_NOTE =
  'Имена функций — те же, что в `lib/internal/streams/readable.js` и `writable.js` Node 26: `addChunk`, `emitReadable_`, `maybeReadMore_`, `flow`, `onwrite`, `afterWrite`. Модель можно читать рядом с исходником, строка к строке, — там, где она не упрощает. Снаружи она берёт одно — `host.macrotask()`, «дождаться следующей задачи»: в браузере это сообщение через `MessageChannel`, в тесте — `setImmediate`.';

export const MODES_CODE = `import { Readable } from 'node:stream'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const source = () => {
  let n = 0
  return new Readable({ objectMode: true, read() { this.push(n < 3 ? ++n : null) } })
}

// 1. 'readable' главнее 'data': пока он есть, поток не течёт сам
const a = source()
const seen = []
a.on('data', (x) => seen.push(x))
a.on('readable', () => {})
await tick()
console.log(\`'data' + 'readable': flowing \${a.readableFlowing}, пришло [\${seen}]\`)
a.removeAllListeners('readable')
await tick()
console.log(\`сняли 'readable': flowing \${a.readableFlowing}, пришло [\${seen}]\`)

// 2. Снятый слушатель 'data' поток не останавливает
const b = source()
const onData = () => {}
b.on('data', onData)
b.off('data', onData)
await tick()
console.log(\`сняли 'data': flowing \${b.readableFlowing}, readableEnded \${b.readableEnded}\`)

// 3. _read без push — вызовов больше не будет
let calls = 0
const stuck = new Readable({ read() { calls++ } })
stuck.on('data', () => {})
for (let i = 0; i < 5; i++) await tick()
console.log(\`_read без push: вызовов \${calls}\`)`;

export const MODES_OUT: string[] = [
  "'data' + 'readable': flowing false, пришло []",
  "сняли 'readable': flowing true, пришло [1,2,3]",
  "сняли 'data': flowing true, readableEnded true",
  "_read без push: вызовов 1",
];

export const MODES_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: '`\'readable\'` главнее `\'data\'`',
    d: 'Подписаны оба — поток стоит (`readableFlowing` — `false`), и в `\'data\'` не приходит ничего. Сняли `\'readable\'` — поток пошёл сам, на следующем тике.',
    tone: 'warn',
  },
  {
    t: 'Снятый `\'data\'` не ставит на паузу',
    d: 'Отписались — `readableFlowing` остался `true`, стрим дочитался до конца, и все чанки ушли в никуда. Остановить поток может только `pause()` или `unpipe()`.',
    tone: 'err',
  },
  {
    t: '`_read` без `push` — стрим встал навсегда',
    d: 'Позвали один раз, ответа не было — второго вызова не будет: `reading` так и остался `true`. Ни ошибки, ни таймаута. Источник, который «пропускает ход», обязан позже вызвать `push`.',
    tone: 'err',
  },
];

// ─── Раздел 4 · objectMode и размер ─────────────────────────────────────────────────

export const PLAIN_SIZE =
  'Порог — число мест на полке, а размер места зависит от режима. В байтовом режиме место — байт. В objectMode место — «один предмет», будь то число `0` или объект на мегабайт: полка на 16 мест вмещает 16 мегабайтных объектов так же охотно, как 16 нулей.';

export const SIZE_CODE = `import { Readable } from 'node:stream'

const bytes = new Readable({ read() {} })          // байтовый режим
bytes.push('привет')                                 // строка станет Buffer
console.log(\`байты: length \${bytes.readableLength}\`)
console.log(\`push 70 000 байт вернул \${bytes.push(Buffer.alloc(70000))}\`)

const text = new Readable({ encoding: 'utf8', read() {} })
text.push('привет')
console.log(\`с encoding: length \${text.readableLength}\`)

const objects = new Readable({ objectMode: true, read() {} })
objects.push({ big: 'x'.repeat(1e6) })
objects.push(0)
objects.push('')
console.log(\`объекты: length \${objects.readableLength}\`)

bytes.on('error', (e) => console.log(\`ошибка пришла событием: \${e.code}\`))
console.log(\`push(42) вернул \${bytes.push(42)} — исключения нет\`)
await new Promise((resolve) => bytes.on('close', resolve))
console.log(\`стрим разрушен: \${bytes.destroyed}\`)

const r = new Readable({ highWaterMark: 4, read() {} })
r.push('abcdef')
console.log(\`read(3) → «\${r.read(3)}», осталось \${r.readableLength}\`)
console.log(\`read(10) → \${r.read(10)}, порог стал \${r.readableHighWaterMark}\`)`;

export const SIZE_OUT: string[] = [
  "байты: length 12",
  "push 70 000 байт вернул false",
  "с encoding: length 6",
  "объекты: length 3",
  "push(42) вернул false — исключения нет",
  "ошибка пришла событием: ERR_INVALID_ARG_TYPE",
  "стрим разрушен: true",
  "read(3) → «abc», осталось 3",
  "read(10) → null, порог стал 16",
];

export const SIZE_ROWS = {
  head: ['режим', 'что считает `length`', 'пример из вывода'],
  rows: [
    ['байтовый (по умолчанию)', 'байты `Buffer`; строка перекодируется в UTF-8', '«привет» — 12'],
    ['байтовый + `encoding`', 'длину строки в кодовых единицах UTF-16', '«привет» — 6'],
    ['`objectMode: true`', 'штуки, размер объекта не важен', 'мегабайтный объект, `0` и `\'\'` — 3'],
  ],
};

export const SIZE_NOTE =
  'Пороги по умолчанию — 64 КиБ у байтового и 16 у объектного — разобраны в [«Стримах и обратном давлении»](/platform/streams/#s3). Здесь важно другое. **`push` чанка не того типа не бросает исключение**: он отвечает `false` и разрушает стрим, а ошибка приходит событием `\'error\'` на следующем тике. Без слушателя `\'error\'` это падение процесса. И `read(n)` с `n` больше порога **поднимает порог** до ближайшей степени двойки: после `read(10)` при пороге 4 он стал 16.';

// ─── Раздел 5 · порядок событий ─────────────────────────────────────────────────────

export const PLAIN_EVENTS =
  'Три события о конце — три разных вопроса. `\'end\'`: «товар кончился и последний забрали?» `\'finish\'`: «последнюю посылку приняли и обработали?» `\'close\'`: «магазин закрыт, свет выключен?» Первые два — про данные, третье — про ресурсы.';

export const EVENTS = {
  head: ['событие', 'у кого', 'что значит', 'когда не придёт'],
  rows: [
    ['`\'end\'`', 'Readable', 'последний чанк **забран потребителем**', 'пока никто не читает — даже после `push(null)`'],
    ['`\'finish\'`', 'Writable', '`end()` вызван, все `_write` и `_final` отработали', 'если стрим разрушили раньше'],
    ['`\'close\'`', 'оба', 'ресурсы отпущены: `_destroy` отработал', 'при `emitClose: false`; при `autoDestroy: false` — пока не вызван `destroy()`'],
    ['`\'error\'`', 'оба', '`destroy(err)`; сразу за ним — `\'close\'`', 'после `destroy()` без ошибки: запись в разрушенный стрим отдаёт ошибку только в колбэк'],
  ],
};

export const SAMPLE_EVENTS_NOTE =
  'Вывод сквозного примера по порядку. `src` отдал `\'end\'` первым: он кончился раньше всех. У `sq` **`\'end\'` пришёл раньше его же `\'finish\'`**: `_flush` вызывается внутри завершения записывающей стороны, успевает выдать итог и закрыть читающую — и `\'end\'` читающей стороны обгоняет `\'finish\'` записывающей. Ждать `\'finish\'` у Transform как знака «всё выдано» — значит ждать не того; надёжный конец цепочки — `\'finish\'` последнего стока, а лучше `finished()` или `pipeline()`. `\'close\'` у каждого — последним: его приносит `autoDestroy`.';

export const EVENTS_CODE = `import { Readable, Writable } from 'node:stream'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const watch = (name, s) => {
  for (const ev of ['end', 'finish', 'close'])
    s.on(ev, () => console.log(\`\${name}: '\${ev}'\`))
}

// 1. Никто не читает: push(null) есть, а 'end' нет
const idle = new Readable({ read() {} })
watch('без читателя', idle)
idle.push('x')
idle.push(null)
await tick()
console.log(\`без читателя: ended \${idle._readableState.ended}, readableEnded \${idle.readableEnded}\`)
idle.resume()
await tick()

// 2. autoDestroy: false — 'end' есть, 'close' нет, стрим не разрушен
const kept = new Readable({ autoDestroy: false, read() {} })
watch('autoDestroy: false', kept)
kept.resume()
kept.push(null)
await tick()
console.log(\`autoDestroy: false: destroyed \${kept.destroyed}\`)

// 3. emitClose: false — стрим разрушается, но 'close' молчит
const quiet = new Writable({ emitClose: false, write(_c, _e, done) { done() } })
watch('emitClose: false', quiet)
quiet.end('x')
await tick()
console.log(\`emitClose: false: destroyed \${quiet.destroyed}\`)`;

export const EVENTS_OUT: string[] = [
  "без читателя: ended true, readableEnded false",
  "без читателя: 'end'",
  "без читателя: 'close'",
  "autoDestroy: false: 'end'",
  "autoDestroy: false: destroyed false",
  "emitClose: false: 'finish'",
  "emitClose: false: destroyed true",
];

export const DUPLEX_CODE = `import { Duplex, PassThrough } from 'node:stream'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const make = (allowHalfOpen) => {
  const d = new Duplex({
    allowHalfOpen,
    read() {},
    write(_c, _e, done) { done() },
  })
  d.resume()
  d.push(null)                       // читаемая сторона кончилась
  return d
}
for (const half of [true, false]) {
  const d = make(half)
  await tick(); await tick()
  console.log(\`allowHalfOpen: \${half} → writable \${d.writable}, writableEnded \${d.writableEnded}\`)
}

// Transform без читателя: две очереди, и обе полны до того, как write() скажет «хватит»
const pt = new PassThrough({ objectMode: true })
let n = 0
while (pt.write(++n));
console.log(\`первый false — на write №\${n}: на выходе \${pt.readableLength}, в очереди входа \${pt._writableState.buffered.length}\`)`;

export const DUPLEX_OUT: string[] = [
  "allowHalfOpen: true → writable true, writableEnded false",
  "allowHalfOpen: false → writable false, writableEnded true",
  "первый false — на write №31: на выходе 16, в очереди входа 15",
];

export const DUPLEX_NOTE =
  'У Duplex две половины, и конец одной не означает конца другой. `allowHalfOpen: true` (по умолчанию) оставляет запись открытой, когда чтение кончилось, — так устроен TCP-сокет, которому ещё есть что сказать. `false` закрывает запись сам. Transform — тоже Duplex, и у него две очереди: без читателя **первый `false` приходит только на 31-й записи** — 16 объектов лежат на выходе, ещё 15 в очереди входа.';

// ─── Раздел 6 · ошибки и destroy ────────────────────────────────────────────────────

export const DESTROY_CODE = `import { Readable, Writable, addAbortSignal } from 'node:stream'
import { finished } from 'node:stream/promises'

const watch = (name, s) => {
  for (const ev of ['error', 'end', 'finish', 'close'])
    s.on(ev, (e) => console.log(\`\${name}: '\${ev}'\${e instanceof Error ? ' ' + e.message : ''}\`))
}

// 1. destroy(err): _destroy — сразу, 'error' и 'close' — на следующем тике
const rs = new Readable({
  read() {},
  destroy(err, done) { console.log('_destroy получил:', err.message); done(err) },
})
watch('rs', rs)
rs.destroy(new Error('диск отвалился'))
console.log(\`сразу после destroy(): destroyed \${rs.destroyed}, errored «\${rs.errored.message}»\`)
console.log(\`push после destroy: \${rs.push('x')}\`)
await finished(rs).catch((e) => console.log('finished(rs) отклонён:', e.message))

// 2. destroy() без ошибки до конца потока — finished() это видит
const cut = new Readable({ read() {} })
cut.destroy()
await finished(cut).catch((e) => console.log('finished(cut) отклонён:', e.code))

// 3. write после destroy — ошибка в колбэк, а не исключение
const ws = new Writable({ write(_c, _e, done) { done() } })
ws.on('error', (e) => console.log(\`ws: 'error' \${e.code}\`))   // не сработает
ws.destroy()
ws.write('x', (e) => console.log('колбэк write:', e.code))
await finished(ws).catch(() => {})

// 4. addAbortSignal: abort() разрушает стрим с AbortError
const ctrl = new AbortController()
const slow = addAbortSignal(ctrl.signal, new Readable({ read() {} }))
slow.on('error', (e) => console.log('slow: \\'error\\'', e.name))
ctrl.abort()
await finished(slow).catch((e) => console.log('finished(slow) отклонён:', e.name))`;

export const DESTROY_OUT: string[] = [
  "_destroy получил: диск отвалился",
  "сразу после destroy(): destroyed true, errored «диск отвалился»",
  "push после destroy: false",
  "rs: 'error' диск отвалился",
  "rs: 'close'",
  "finished(rs) отклонён: диск отвалился",
  "finished(cut) отклонён: ERR_STREAM_PREMATURE_CLOSE",
  "колбэк write: ERR_STREAM_DESTROYED",
  "slow: 'error' AbortError",
  "finished(slow) отклонён: AbortError",
];

export const DESTROY_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`destroy(err)`: синхронно — флаги и `_destroy`, потом — события',
    d: 'Сразу после вызова `destroyed` и `errored` уже выставлены, `_destroy` уже отработал, `push` отвечает `false`. А `\'error\'` и `\'close\'` приходят на следующем тике, именно в этом порядке.',
  },
  {
    t: '`finished()` различает конец и обрыв',
    d: '`finished` из `node:stream/promises` выполняется, когда стрим штатно дошёл до конца — после `\'end\'` или `\'finish\'` (и `\'close\'`, если он будет), а отклоняется на ошибке — **и на обрыве**: `destroy()` без ошибки до конца данных даёт `ERR_STREAM_PREMATURE_CLOSE`. Так отличают «дочитали» от «закрыли на середине».',
    tone: 'ok',
  },
  {
    t: '`\'error\'` без слушателя роняет процесс',
    d: 'Это правило `EventEmitter`, а не стримов, но стримы попадают под него чаще всех: ошибка приходит асинхронно, когда `try` вокруг давно закончился. `pipeline()` и `finished()` подписываются на `\'error\'` за вас.',
    tone: 'err',
  },
  {
    t: 'Запись в разрушенный стрим — ошибка в колбэк, не событием',
    d: '`write()` после `destroy()` отдаёт `ERR_STREAM_DESTROYED` в колбэк записи, а `\'error\'` не шлёт: стрим уже разрушен, второй раз не разрушить. Без колбэка ошибка пропадёт молча.',
    tone: 'warn',
  },
  {
    t: '`addAbortSignal`: отмена = `destroy(AbortError)`',
    d: '`addAbortSignal(signal, stream)` или опция `signal` в конструкторе. `abort()` разрушает стрим с `AbortError` — и дальше всё как у любой ошибки: `\'error\'`, `\'close\'`, отклонённый `finished()`.',
  },
];

export const PIPELINE_NOTE =
  'Почему `.pipe()` оставляет источник открытым после ошибки стока, а `pipeline()` разрушает всю цепочку, — разобрано с запуском в [«Стримах и обратном давлении», подраздел «Второй API стримов»](/platform/streams/#s3). Изнутри это то, что видно выше: `pipeline()` вешает на каждое звено `finished()` и на первую же ошибку зовёт `destroy(err)` у всех остальных.';

// ─── Раздел 7 · генераторы ──────────────────────────────────────────────────────────

export const FROM_CODE = `import { Duplex, Readable, Writable, compose } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// 1. Readable.from зовёт next() генератора только по _read — то есть по запросу
let produced = 0
async function* numbers() {
  try {
    for (let i = 1; i <= 100; i++) { produced++; yield i }
  } finally {
    console.log('finally генератора: произведено', produced)
  }
}
const rs = Readable.from(numbers())
console.log(\`objectMode \${rs.readableObjectMode}, порог \${rs.readableHighWaterMark}\`)
for await (const n of rs) if (n === 3) break
console.log(\`после break: destroyed \${rs.destroyed}\`)

// 2. Строка — один чанк, а не посимвольный итератор
const chunks = await Readable.from('привет').toArray()
console.log('Readable.from(строка):', chunks)

// 3. Генератор как звено pipeline и compose — функция вместо класса Transform
const upper = async function* (source) {
  for await (const s of source) yield s.toUpperCase()
}
const got = []
await pipeline(
  Readable.from(['a', 'b']),
  upper,
  new Writable({ objectMode: true, write(s, _e, done) { got.push(s); done() } }),
)
console.log('pipeline с генератором:', got)

const shout = compose(upper, async function* (source) {
  for await (const s of source) yield s + '!'
})
console.log(\`compose вернул Duplex: \${shout instanceof Duplex}\`)
console.log('compose:', await Readable.from(['x', 'y']).pipe(shout).toArray())`;

export const FROM_OUT: string[] = [
  "objectMode true, порог 1",
  "finally генератора: произведено 4",
  "после break: destroyed true",
  "Readable.from(строка): [\"привет\"]",
  "pipeline с генератором: [\"A\",\"B\"]",
  "compose вернул Duplex: true",
  "compose: [\"X!\",\"Y!\"]",
];

export const FROM_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`Readable.from` — генератор по запросу',
    d: '`next()` генератора зовут из `_read`, то есть только когда в буфере есть место. Порог у `Readable.from` — **1**, а не 16: на `break` после третьего числа генератор успел произвести четвёртое — одно про запас.',
    tone: 'ok',
  },
  {
    t: '`break` разрушает стрим, а стрим закрывает генератор',
    d: 'Выход из `for await` зовёт `return()` итератора стрима, тот — `destroy()`, а `destroy()` — `return()` генератора: его `finally` отработал. Цепочка освобождения идёт сама, без строчки кода.',
  },
  {
    t: 'Строка — один чанк',
    d: '`Readable.from(\'привет\')` отдаёт строку целиком, а не по символам, хотя строка итерируема. Так же с `Buffer`. Нужны символы — передайте `[...строка]`.',
    tone: 'warn',
  },
  {
    t: 'Генератор вместо класса Transform',
    d: '`pipeline()` и `compose()` принимают асинхронную функцию-генератор `async function* (source)` как звено. `compose()` склеивает звенья в один Duplex — его можно отдать туда, где ждут стрим.',
  },
];

// ─── Раздел 8 · cork и _writev ──────────────────────────────────────────────────────

export const CORK_CODE = `import { Writable } from 'node:stream'

const make = (withWritev) => new Writable({
  objectMode: true,
  write(chunk, _enc, done) { console.log(\`_write(\${chunk})\`); done() },
  ...(withWritev && {
    writev(chunks, done) { console.log(\`_writev([\${chunks.map((c) => c.chunk)}])\`); done() },
  }),
})

const ws = make(true)
ws.cork()
ws.write('заголовок')
ws.write('тело')
ws.cork()                        // пробки считаются: две cork() — две uncork()
ws.write('подпись')
ws.uncork()
console.log(\`после первой uncork(): в очереди \${ws.writableLength}\`)
ws.uncork()

const plain = make(false)
plain.cork()
plain.write('x')
plain.write('y')
plain.end()                      // end() снимает все пробки разом`;

export const CORK_OUT: string[] = [
  "после первой uncork(): в очереди 3",
  "_writev([заголовок,тело,подпись])",
  "_write(x)",
  "_write(y)",
];

export const CORK_NOTE =
  '`cork()` копит записи в очереди, `uncork()` отдаёт их — одним `_writev`, если он есть, или по одному `_write`, если его нет. Пробки считаются: две `cork()` снимаются двумя `uncork()`, а `end()` снимает все сразу. Документация Node советует снимать пробку в `process.nextTick(() => stream.uncork())`: тогда все `write()` текущего синхронного куска кода уходят одной пачкой. Смысл — один системный вызов или один пакет вместо нескольких. Как видно в разделе «Состояние изнутри», пачку `_writev` получает и без `cork()`, если записи копились, пока шла прошлая.';

// ─── Раздел 9 · сравнение с Web Streams ─────────────────────────────────────────────

export const COMPARE = {
  head: ['', 'Web Streams', '`node:stream`'],
  rows: [
    ['кто зовёт источник', '`pull()`; следующий — когда выполнится его промис', '`_read()`; следующий — когда источник вызовет `push`'],
    ['сигнал «хватит»', '`desiredSize ≤ 0`, промис `writer.ready`', 'ответ `push()` и `write()` — `false`; событие `\'drain\'`'],
    ['чтение', 'один читатель, стрим заперт `getReader()`', 'четыре способа без запирания — и их можно смешать, потеряв данные'],
    ['размер чанка', '`size()` в стратегии очереди', 'байты, длина строки или «1» в objectMode'],
    ['конец', '`close()` → `{ done: true }`', 'три события: `\'end\'`, `\'finish\'`, `\'close\'`'],
    ['ошибка', 'отклонённые промисы `read()` и `write()`', 'событие `\'error\'`; без слушателя — падение процесса'],
    ['отмена', '`cancel(reason)` у чтения, `abort(reason)` у записи', 'один `destroy(err)` на оба направления'],
    ['трансформ', '`TransformStream`: на выходе порог 0 — скрытого буфера нет', '`Transform`: две очереди по 16 — 31 запись до первого `false`'],
    ['`break` из `for await`', '`cancel()` источника', '`destroy()` стрима'],
  ],
};

export const COMPARE_NOTE =
  'Механика общая — очередь с порогом и отказ звать источник, когда очередь полна. Различается сигнализация: промисы против событий и возвращаемых `false`. Сами Web Streams, `desiredSize` и `TransformStream` с порогом 0 разобраны в [«Стримах и обратном давлении»](/platform/streams/#s4), там же — переходники `toWeb` и `fromWeb` между двумя API.';

// ─── Тонкие места ───────────────────────────────────────────────────────────────────

/** Пять `PassThrough` через `pipe`, писатель ждёт `'drain'`, читателя нет: столько войдёт. Сверяет тест. */
export const CHAIN_OF_FIVE = 155;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`push(null)` — ещё не `\'end\'`',
    d: '`\'end\'` приходит, когда последний чанк **забран**. Стрим, который никто не читает, после `push(null)` висит с `ended: true` и `readableEnded: false` сколько угодно. Код, ждущий `\'end\'` у стрима без потребителя, ждёт вечно; то же — `finished()`. Лечение — читать или хотя бы `resume()`: он пустит данные в никуда, зато стрим дойдёт до конца.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`\'end\'` не значит «обработано»',
    d: `В режиме \`'data'\` событие \`'end'\` означает «стрим всё отдал», а не «вы всё обработали». В демо при двух тиках на чанк \`'end'\` приходит на тике ${DEMO_CHECKS.data.endTick}, а потребитель заканчивает на ${DEMO_CHECKS.data.lastTick}: между ними работа доделывается из очереди вне стрима. Кто по \`'end'\` закрывает базу или отвечает клиенту, закрывает на середине.`,
    tone: 'err',
  },
  {
    n: '03',
    t: 'Асинхронный обработчик `\'data\'` не тормозит стрим',
    d: '`on(\'data\', async (c) => await save(c))` выглядит как очередь, но `\'data\'` не ждёт промиса: стрим отдаёт чанки со скоростью источника, а сохранения идут параллельно и копятся в памяти. Для работы по одному — `for await` или `pipeline()` со стоком.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Снятый слушатель `\'data\'` не останавливает поток',
    d: 'Проверено: после `off(\'data\')` `readableFlowing` остался `true`, стрим дочитан, чанки выброшены. Остановить может `pause()` или `unpipe()`, а не отписка.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`pause()`, потом `on(\'data\')` — тишина',
    d: 'Явная пауза сильнее подписки: `on(\'data\')` пускает поток, только если `readableFlowing` не `false`. Нужен явный `resume()`. Обратное тоже есть: подписка на `\'readable\'` ставит на паузу, и `\'data\'` рядом с ней молчит.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`_read`, который ничего не прислал, больше не позовут',
    d: 'Пока нет `push`, `reading` остаётся `true`, и `_read` не повторяют — проверено: один вызов на пять тиков. Источник «данных пока нет, спросите позже» так не пишется: он обязан сам вызвать `push`, когда данные появятся.',
    tone: 'err',
  },
  {
    n: '07',
    t: '`push` не того типа не бросает',
    d: '`push(42)` в байтовом режиме отвечает `false`, а стрим разрушается с `ERR_INVALID_ARG_TYPE` — событием на следующем тике. `try/catch` вокруг `push` не поймает ничего, а без слушателя `\'error\'` упадёт процесс. Нужны числа и объекты — `objectMode: true`.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'У Transform `\'end\'` приходит раньше `\'finish\'`',
    d: 'В сквозном примере `sq \'end\'` стоит перед `sq \'finish\'`: `_flush` выдаёт итог внутри завершения записи. Интуиция «сначала записали всё, потом прочитали» здесь не работает. Конец цепочки ловят на последнем стоке или через `finished()`.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Transform без читателя держит две очереди',
    d: `Порог 16 на входе и 16 на выходе — и \`write()\` отвечает \`false\` только на 31-й записи. Пять \`PassThrough\`, соединённых \`pipe\`, без потребителя в конце принимают ${CHAIN_OF_FIVE} объектов, прежде чем писатель, честно ждущий \`'drain'\`, встанет. У \`TransformStream\` Web Streams на выходе порог 0 — это одно из главных различий двух API.`,
    tone: 'warn',
  },
  {
    n: '10',
    t: '`Readable.from` опережает генератор на чанк',
    d: 'Порог 1: генератор всегда произвёл на одно значение больше, чем забрали. Если значение — это побочный эффект (списание, запрос к API), `break` выбросит одно уже сделанное.',
    tone: 'warn',
  },
];

// ─── Источники ──────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Node.js: Stream — API for stream implementers',
    href: 'https://nodejs.org/api/stream.html#api-for-stream-implementers',
    what: '`_read`, `_write`, `_writev`, `_final`, `_destroy`, `_construct`, `_transform`, `_flush` и их договоры',
  },
  {
    title: 'Node.js: Stream — Three states',
    href: 'https://nodejs.org/api/stream.html#three-states',
    what: '`readableFlowing`: `null`, `true`, `false` и что их переключает',
  },
  {
    title: 'Node.js: Stream — Buffering',
    href: 'https://nodejs.org/api/stream.html#buffering',
    what: '`highWaterMark`, `readableLength`, `writableLength` и objectMode',
  },
  {
    title: 'lib/internal/streams/readable.js',
    href: 'https://github.com/nodejs/node/blob/main/lib/internal/streams/readable.js',
    what: '`addChunk`, `read`, `emitReadable_`, `maybeReadMore_`, `flow`, `pipe`, итератор — по ним написана модель демо',
  },
  {
    title: 'lib/internal/streams/writable.js',
    href: 'https://github.com/nodejs/node/blob/main/lib/internal/streams/writable.js',
    what: '`writeOrBuffer`, `onwrite`, `afterWrite`, `clearBuffer` (`_writev`), `finishMaybe`',
  },
  {
    title: 'Node.js: Stream — stream.finished, stream.compose, stream.addAbortSignal',
    href: 'https://nodejs.org/api/stream.html#streamfinishedstream-options-callback',
    what: 'обрыв как ошибка, склейка звеньев, отмена сигналом',
  },
];

export const RELATED =
  'Смежное на сайте: [Стримы и обратное давление](/platform/streams/) — Web Streams, `desiredSize`, `write()` → `false`, `.pipe()` против `pipeline()` и переходники между API. [Event Loop](/js/event-loop/) — очередь `process.nextTick`, через которую стрим отдаёт свои события. [Объектная модель](/js/object-model/) — протокол итератора и `return()`, на котором `break` разрушает стрим. [Память в Node](/js/node-memory/) — как очередь, которую никто не разбирает, выглядит в памяти процесса. [Воркеры и параллелизм](/js/workers/) — обратное давление на пуле, когда стрима нет.';
