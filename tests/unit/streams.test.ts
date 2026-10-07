import { once } from 'node:events';
import { Readable, Writable, getDefaultHighWaterMark } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  BYOB_CODE,
  BYOB_FACTS,
  ITER_CODE,
  ITER_FACTS,
  MEASURED,
  NODE_PIPE_CODE,
  NODE_WRITE_CODE,
  PIPE_DEFAULTS,
  RESUME_CODE,
  SSE_CASES,
} from '@/content/platform/streams/data';
import { runPipe } from '@/widgets/backpressure-pipe/model/pipe';
import {
  SSEDecoderStream,
  cutBytes,
  decodeBytes,
  decodeChunks,
  naiveDecode,
} from '@/widgets/sse-split/model/sse';

/**
 * Всё, что тема утверждает числами, проверяется запуском.
 *
 * Стримы — редкий случай, когда это дёшево: `ReadableStream`, `WritableStream`,
 * `TransformStream` и `TextDecoderStream` есть в Node глобально и ведут себя ровно так же,
 * как в браузере (сверено с Chromium 153 отдельным прогоном). Значит, и три числа механики,
 * и разбор SSE можно закрыть обычным юнит-тестом, а не обещанием.
 */

describe('три числа: desiredSize = highWaterMark − queueTotalSize', () => {
  it('дефолты спеки — те, что напечатаны в теме', () => {
    let readable: number | null = null;
    new ReadableStream({ start: (c) => void (readable = c.desiredSize) });
    expect(readable, 'new ReadableStream(src) — HWM 1').toBe(1);

    let bytes: number | null = null;
    new ReadableStream({ type: 'bytes', start: (c) => void (bytes = c.desiredSize) });
    expect(bytes, "type:'bytes' — HWM 0").toBe(0);

    const writer = new WritableStream({ write() {} }).getWriter();
    expect(writer.desiredSize, 'new WritableStream(sink) — HWM 1').toBe(1);

    const transformWriter = new TransformStream().writable.getWriter();
    expect(transformWriter.desiredSize, 'writable-сторона трансформа — HWM 1').toBe(1);
  });

  it('desiredSize бывает отрицательным — это перелив, а не ошибка', () => {
    let desired: number | null = null;
    new ReadableStream(
      {
        start(c) {
          c.enqueue(1);
          c.enqueue(2);
          c.enqueue(3);
          desired = c.desiredSize;
        },
      },
      new CountQueuingStrategy({ highWaterMark: 1 }),
    );
    expect(desired).toBe(-2);
  });

  it('у закрытого стрима это 0, у сломанного — null', () => {
    let closed: number | null = null;
    new ReadableStream({ start: (c) => { c.close(); closed = c.desiredSize; } });
    expect(closed).toBe(0);

    let errored: number | null = 0;
    const broken = new ReadableStream({
      start(c) {
        c.error(new Error('сломался'));
        errored = c.desiredSize;
      },
    });
    void broken.cancel().catch(() => {});
    expect(errored).toBeNull();
  });

  it('pull зовут ровно до нуля, и ни разу больше', async () => {
    const trace: (number | null)[] = [];
    let pulls = 0;
    new ReadableStream(
      {
        pull(c) {
          pulls += 1;
          c.enqueue(pulls);
          trace.push(c.desiredSize);
        },
      },
      new CountQueuingStrategy({ highWaterMark: 4 }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(pulls, 'HWM 4 — четыре вызова').toBe(4);
    expect(trace, 'после каждого enqueue место убывает на единицу').toEqual([3, 2, 1, 0]);
  });

  it('без читателя конвейер встаёт на двух чанках — HWM 0 у readable-стороны трансформа', async () => {
    let produced = 0;
    const source = new ReadableStream({
      pull(c) {
        produced += 1;
        c.enqueue(produced);
      },
    });
    source.pipeThrough(new TransformStream({ transform: (chunk, c) => c.enqueue(chunk) }));
    await new Promise((r) => setTimeout(r, 40));
    expect(produced).toBe(2);
  });

  it('ByteLengthQueuingStrategy на обычных объектах не подвешивает стрим, а бросает', async () => {
    // Это исправление к конспекту: «desiredSize станет NaN, стрим молча висит навсегда» —
    // неверно. Спека требует конечного неотрицательного размера и ловит NaN на месте.
    let thrown: unknown = null;
    let pulls = 0;
    new ReadableStream(
      {
        pull(c) {
          pulls += 1;
          try {
            c.enqueue({ hello: 'world' } as unknown as ArrayBufferView);
          } catch (error) {
            thrown = error;
          }
        },
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 65536 }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(pulls, 'один вызов всё-таки был — и он же последний').toBe(1);
    expect(thrown).toBeInstanceOf(RangeError);
  });
});

describe('конвейер демо: обратное давление на настоящих объектах', () => {
  it('источник по запросу держит очередь в пределах highWaterMark', async () => {
    const history = await runPipe({ ...PIPE_DEFAULTS, mode: 'pull' }, 40);

    for (const step of history) {
      expect(
        step.queue.length,
        `очередь ${step.queue.length} при HWM ${PIPE_DEFAULTS.highWaterMark} на ${step.t} мс`,
      ).toBeLessThanOrEqual(PIPE_DEFAULTS.highWaterMark);
      // Ровно то тождество, ради которого демо и построено, — сверенное с живым объектом.
      expect(step.desired).toBe(PIPE_DEFAULTS.highWaterMark - step.queue.length);
    }
  });

  it('очередь действительно набухает, когда потребитель медленнее', async () => {
    const history = await runPipe({ ...PIPE_DEFAULTS, mode: 'pull' }, 40);
    const last = history[history.length - 1];
    expect(last.produced, 'источник что-то произвёл').toBeGreaterThan(0);
    expect(last.delivered, 'сток что-то доставил').toBeGreaterThan(0);
    expect(
      Math.max(...history.map((s) => s.queue.length)),
      'при медленном стоке очередь обязана дойти до отметки',
    ).toBe(PIPE_DEFAULTS.highWaterMark);
    expect(
      history.some((s) => s.desired === 0 && s.source === 'спит: pull не зовут'),
      'дойдя до отметки, платформа перестаёт звать источник',
    ).toBe(true);
    expect(
      history.some((s) => s.pump === 'ждёт ready'),
      'насос обязан постоять на await writer.ready',
    ).toBe(true);
  });

  it('источник-события ломает обратное давление: desiredSize уходит в минус', async () => {
    const history = await runPipe({ ...PIPE_DEFAULTS, mode: 'push' }, 40);
    const last = history[history.length - 1];

    expect(last.desired, 'push-источник кладёт мимо давления').toBeLessThan(0);
    expect(
      last.queue.length,
      'очередь перерастает highWaterMark — её больше ничто не держит',
    ).toBeGreaterThan(PIPE_DEFAULTS.highWaterMark);
    // Тождество не ломается и здесь: отрицательное значение — нормальное «перелили».
    expect(last.desired).toBe(PIPE_DEFAULTS.highWaterMark - last.queue.length);
  });
});

describe('разбор SSE: состояние между чанками', () => {
  const byKey = (key: string) => {
    const found = SSE_CASES.find((c) => c.key === key);
    if (!found) throw new Error(`случай «${key}» пропал из данных темы`);
    return found;
  };

  /** Событие сравниваем по типу и данным: `id` проверяем там, где он и есть предмет разговора. */
  const shape = (events: { type: string; data: string }[]) =>
    events.map((e) => [e.type, e.data]);

  it('обещание страницы совпадает с прогоном для каждого случая', async () => {
    for (const testCase of SSE_CASES) {
      const correct = await decodeChunks(testCase.chunks);
      const naive = naiveDecode(testCase.chunks);
      const broke = JSON.stringify(shape(correct)) !== JSON.stringify(shape(naive));
      expect(
        broke,
        `случай «${testCase.key}»: страница обещает breaks=${testCase.breaks}, а прогон говорит ${broke}`,
      ).toBe(testCase.breaks);
    }
  });

  it('событие, разорванное посередине, склеивается', async () => {
    const c = byKey('split-mid-event');
    expect(shape(await decodeChunks(c.chunks))).toEqual([['token', '{"t":"привет"}']]);
    // Наивный теряет не данные, а ТИП: «to» вместо «token». Молча.
    expect(shape(naiveDecode(c.chunks))).toEqual([['to', '{"t":"привет"}']]);
  });

  it('разрыв ровно между \\r и \\n не даёт лишней пустой строки', async () => {
    const c = byKey('split-crlf');
    expect(shape(await decodeChunks(c.chunks))).toEqual([['message', '{"t":"hi"}\nещё']]);
    // Наивный увидел \r как конец строки, а \n — как ещё один: между ними пустая строка,
    // то есть преждевременная отправка. Одно событие превратилось в два.
    expect(shape(naiveDecode(c.chunks))).toEqual([
      ['message', '{"t":"hi"}'],
      ['message', 'ещё'],
    ]);
  });

  it('комментарий не разрывает многострочный data', async () => {
    const c = byKey('comment');
    expect(shape(await decodeChunks(c.chunks))).toEqual([['message', 'первая\nвторая']]);
    expect(shape(naiveDecode(c.chunks))).toEqual([
      ['message', 'первая'],
      ['message', 'вторая'],
    ]);
  });

  it('поле без значения и ровно один съеденный пробел', async () => {
    const c = byKey('bare-field');
    // `data` без двоеточия — это пустое значение; `data:  x` отдаёт один пробел обратно.
    expect(shape(await decodeChunks(c.chunks))).toEqual([['message', '\n два пробела\nноль']]);
    // Здесь наивный разбор выживает: правила формата у него те же, ломается он на границах.
    expect(shape(naiveDecode(c.chunks))).toEqual(shape(await decodeChunks(c.chunks)));
  });

  it('хвост без финальной пустой строки достаёт flush', async () => {
    const c = byKey('tail');
    expect(shape(await decodeChunks(c.chunks))).toEqual([['done', '{"finish":"stop"}']]);
    expect(naiveDecode(c.chunks), 'без flush последнее событие исчезает молча').toEqual([]);
    // А по спеке EventSource неполный хвост и должен выбрасываться — это выбор, а не баг.
    expect(await decodeChunks(c.chunks, { dispatchTail: false })).toEqual([]);
  });

  it('id переживает событие, event — нет', async () => {
    const events = await decodeChunks(['id: 7\n\nevent: token\ndata: раз\n\ndata: два\n\n']);
    expect(events.map((e) => [e.type, e.data, e.id])).toEqual([
      ['token', 'раз', '7'],
      ['message', 'два', '7'],
    ]);
  });

  it('неизвестное поле игнорируется, retry — только из цифр', async () => {
    const events = await decodeChunks(['x-trace: abc\nretry: скоро\nretry: 3000\ndata: ok\n\n']);
    expect(events).toEqual([{ type: 'message', data: 'ok', id: '', retry: 3000 }]);
  });

  it('граница внутри многобайтового символа — забота TextDecoderStream', async () => {
    const text = 'event: token\ndata: {"t":"привет"}\n\n';
    // 26 — середина буквы «и»: кириллица в UTF-8 занимает два байта.
    const parts = cutBytes(text, [13, 26]);
    expect(await decodeBytes(parts)).toEqual([
      { type: 'token', data: '{"t":"привет"}', id: '', retry: undefined },
    ]);

    // А без склейки хвоста получается ровно тот мусор, из-за которого падает JSON.parse.
    const broken = parts.map((part) => new TextDecoder().decode(part)).join('');
    expect(broken).toContain('�');
  });
});

/**
 * Примеры кода темы исполняются как есть — те самые строки из `data.ts`, а не копия.
 * Строки `import` срезаются, модули подставляются параметрами, `console` подменяется
 * сборщиком вывода: утверждение «печатает вот это» становится сравнением.
 */
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

async function runSnippet(code: string, scope: Record<string, unknown>): Promise<unknown[][]> {
  const logs: unknown[][] = [];
  const body = code
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n');
  const names = Object.keys(scope);
  const fn = new AsyncFunction(...names, 'console', body);
  await fn(...names.map((n) => scope[n]), { log: (...args: unknown[]) => logs.push(args) });
  return logs;
}

describe('второй API стримов: node:stream', () => {
  const scope = { Readable, Writable, once, pipeline };

  it('порог по умолчанию — 64 КиБ для байтов и 16 объектов, как написано в теме', () => {
    expect(getDefaultHighWaterMark(false)).toBe(65536);
    expect(getDefaultHighWaterMark(true)).toBe(16);
  });

  it('write() отвечает false с порога, но принимает все чанки; drain — после опустошения', async () => {
    const logs = await runSnippet(NODE_WRITE_CODE, scope);
    expect(logs).toEqual([[[true, true, false, false, false]], [5], [0]]);
  });

  it('.pipe() оставляет источник открытым, pipeline() — разрушает', async () => {
    const logs = await runSnippet(NODE_PIPE_CODE, scope);
    expect(logs).toEqual([[false], ['диск полон'], [true]]);
  });

  it('Readable.toWeb переносит обратное давление: без читателя read() зовут четыре раза', async () => {
    let calls = 0;
    const node = new Readable({
      objectMode: true,
      highWaterMark: 2,
      read() {
        this.push(++calls);
      },
    });
    Readable.toWeb(node);
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(calls).toBe(4);
  });

  it('pipeline() принимает веб-стримы с обоих концов без переходников', async () => {
    // Типы @types/node веб-стримов в pipeline() не описывают, а рантайм их принимает —
    // это и проверяется.
    const pipe = pipeline as unknown as (...streams: unknown[]) => Promise<void>;
    const got: string[] = [];
    await pipe(
      new ReadableStream({
        start(c) {
          c.enqueue('a');
          c.close();
        },
      }),
      new Writable({
        objectMode: true,
        write(chunk, _e, done) {
          got.push(chunk);
          done();
        },
      }),
    );
    await pipe(
      Readable.from(['b']),
      new WritableStream({
        write(chunk) {
          got.push(chunk);
        },
      }),
    );
    expect(got).toEqual(['a', 'b']);
  });
});

describe('возобновление после обрыва: RESUME_CODE против подменённого fetch', () => {
  /**
   * Тело, которое отдаёт текст и затем либо закрывается, либо рвётся — как сеть.
   * Обрыв — на следующем `pull`, а не сразу: `error()` выбрасывает всё, что лежит
   * в очереди, и отданный чанк пропал бы, не дойдя до читателя.
   */
  const body = (text: string, broken: boolean) => {
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        if (!sent) {
          sent = true;
          c.enqueue(new TextEncoder().encode(text));
        } else if (broken) c.error(new TypeError('network error'));
        else c.close();
      },
    });
  };

  async function follow(responses: (() => Response)[]) {
    const sent: (string | null)[] = [];
    const events: { data: string; id: string }[] = [];
    let i = 0;
    const fetch = async (_url: string, init: { headers: Record<string, string> }) => {
      sent.push(init.headers['Last-Event-ID'] ?? null);
      const next = responses[i++];
      if (!next) throw new Error('лишний запрос');
      return next();
    };
    const run = new AsyncFunction(
      'fetch',
      'SSEDecoderStream',
      `${RESUME_CODE}\nreturn follow('/sse', (ev) => onEvent(ev))`.replace(
        'return follow',
        'const onEvent = arguments[2];\nreturn follow',
      ),
    );
    let error: unknown;
    try {
      await run(fetch, SSEDecoderStream, (ev: { data: string; id: string }) =>
        events.push({ data: ev.data, id: ev.id }),
      );
    } catch (err) {
      error = err;
    }
    return { sent, events, error, calls: i };
  }

  it('после обрыва шлёт последний id, пустой id стирает его, 204 останавливает', async () => {
    const { sent, events, error } = await follow([
      () => new Response(body('retry: 0\nid: 7\ndata: a\n\ndata: b\n\n', true)),
      () => new Response(body('id\ndata: c\n\n', false)),
      () => new Response(null, { status: 204 }),
    ]);
    expect(error).toBeUndefined();
    expect(sent).toEqual([null, '7', null]);
    expect(events).toEqual([
      { data: 'a', id: '7' },
      { data: 'b', id: '7' },
      { data: 'c', id: '' },
    ]);
  });

  it('ответ 500 — не повод для повтора: ошибка наверх, запрос один', async () => {
    const { error, calls } = await follow([() => new Response('', { status: 500 })]);
    expect(String(error)).toContain('HTTP 500');
    expect(calls).toBe(1);
  });
});

/**
 * Раздел 6 · итерация и BYOB. Раньше эти утверждения стояли в `MEASURED` с пометкой «обе среды»
 * и были сняты однажды руками (Node 26.8.2 и Chromium 153.0.8010.12) — сторожа не было.
 * Здесь закреплена Node-сторона: движок снимается прямо в процессе теста, `ReadableStream`
 * в Node глобальный и тот же, что в браузере.
 *
 * Связь с текстом — короткими смысловыми подстроками из `ITER_FACTS`, `BYOB_FACTS`, `BYOB_CODE`
 * и строк `MEASURED`: ровно те слова, ради которых правка делалась («буфер **другой**»,
 * «не заперт»). Поменяется формулировка — проверка скажет, какую подстроку она искала.
 */
describe('раздел 6 · for await и BYOB: то, что стояло без сторожа', () => {
  /** Бесконечный источник по запросу, который считает `pull` и записывает причины `cancel`. */
  function counted() {
    const log = { pulls: 0, cancels: [] as unknown[] };
    let i = 0;
    const stream = new ReadableStream<number>({
      pull(c) {
        log.pulls += 1;
        c.enqueue(i++);
      },
      cancel(reason) {
        log.cancels.push(reason);
      },
    });
    return { stream, log };
  }

  const measured = (key: string) => {
    const row = MEASURED.find((r) => r.k === key);
    expect(row, `строки «${key}» в MEASURED нет — таблица замеров разошлась со сторожем`).toBeDefined();
    return row!.v;
  };

  it('break из for await зовёт cancel источника, reason — undefined', async () => {
    const { stream, log } = counted();
    // источник отдаёт 0, 1, 2…: выход на значении 1 — это выход на втором чанке
    for await (const chunk of stream) if (chunk === 1) break;

    expect(log.cancels).toEqual([undefined]);
    expect(stream.locked, 'цикл отпускает читателя и при отмене').toBe(false);

    expect(measured('`break` из `for await` → `cancel` источника')).toContain('вызывается, `reason` — `undefined`');
    expect(ITER_CODE).toContain('выход ОТМЕНЯЕТ стрим');
  });

  it('выход на втором чанке стоит трёх вызовов pull — одного лишнего', async () => {
    const { stream, log } = counted();
    // источник отдаёт 0, 1, 2…: выход на значении 1 — это выход на втором чанке
    for await (const chunk of stream) if (chunk === 1) break;

    expect(log.pulls).toBe(3);
    expect(measured('Вызовов `pull` к моменту выхода на втором чанке')).toBe(String(log.pulls));
    const fact = ITER_FACTS.find((f) => f.t.includes('лишнего чанка'));
    expect(fact?.d).toContain('**три раза**');
  });

  it('values({ preventCancel: true }): cancel не приходит, стрим не заперт, чтение продолжается', async () => {
    const { stream, log } = counted();
    for await (const chunk of stream.values({ preventCancel: true })) if (chunk === 1) break;

    expect(log.cancels).toEqual([]);
    expect(stream.locked).toBe(false);
    // «не заперт» проверяется делом: нового читателя можно взять, и источник жив
    const reader = stream.getReader();
    expect(await reader.read()).toEqual({ done: false, value: 2 });
    reader.releaseLock();

    expect(measured('`values({ preventCancel: true })` → `cancel`')).toBe('не вызывается; стрим после выхода не заперт');
    const fact = ITER_FACTS.find((f) => f.t.includes('preventCancel'));
    expect(fact?.d).toContain('**не заперт**');
  });

  /** Байтовый источник, который пишет в буфер читателя сам, через `byobRequest`. */
  async function byobRead() {
    const stream = new ReadableStream({
      type: 'bytes',
      pull(c) {
        const req = c.byobRequest!;
        const view = req.view as Uint8Array;
        view[0] = 1;
        view[1] = 2;
        req.respond(2);
      },
    });
    const reader = stream.getReader({ mode: 'byob' });
    const view = new Uint8Array(8);
    const { value } = await reader.read(view);
    return { view, value: value! };
  }

  it('BYOB: переданный view отсоединён — длина 0, buffer.detached true', async () => {
    const { view, value } = await byobRead();
    expect(view.byteLength).toBe(0);
    expect(view.buffer.detached).toBe(true);
    expect(view[0], 'чтение из пустоты молчит, а не бросает').toBeUndefined();
    expect([...value]).toEqual([1, 2]);

    expect(measured('BYOB: переданный `view` после `read()`')).toBe('`byteLength` 0, `buffer.detached` `true`');
    expect(BYOB_CODE).toContain('буфер отсоединён');
  });

  it('BYOB: value.buffer !== view.buffer — память переехала в другой буфер', async () => {
    const { view, value } = await byobRead();
    expect(value.buffer === view.buffer).toBe(false);
    // тот же объём памяти: отдали восемь байт — получили буфер на восемь, из них занято два
    expect(value.buffer.byteLength).toBe(8);
    expect(value.byteLength).toBe(2);

    expect(measured('BYOB: `value.buffer === view.buffer`')).toBe('`false` — буфер другой');
    expect(BYOB_CODE).toContain('ДРУГОЙ буфер');
    const fact = BYOB_FACTS.find((f) => f.t.includes('не «те же'));
    expect(fact?.d).toContain('`value.buffer !== view.buffer`');
  });
});
