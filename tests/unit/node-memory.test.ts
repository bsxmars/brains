import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import v8 from 'node:v8';
import { Worker } from 'node:worker_threads';
import { beforeAll, describe, expect, it } from 'vitest';
import { YOUNG_PROBE_OUT } from '@/content/lessons/memory-gc/data';
import {
  BUDGETS,
  CASES,
  CRASH_CARDS,
  FATAL_LOG,
  FIELDS,
  FLAGS,
  FORCE_GC_NOTE,
  FORCE_GC_OUT,
  GC_TOKENS,
  IDLE_PROBE_OUT,
  MODEL_CARDS,
  OUTSIDE,
  PITFALLS,
  SEMI_SPACE_NOTE,
  SPACE_NAMES,
  SPACE_NOTE,
  THREAD_PROBE_OUT,
  TRIAGE_STAMPS,
  ALLOCATOR_PROBE,
  ARENA_ROWS,
  WORKER_LIMITS_CODE,
  WORKER_LIMITS_OUT,
} from '@/content/lessons/node-memory/data';
import { HEAP_PRESETS } from '@/widgets/heap-chart/model/presets';

/**
 * Утверждения темы «Память в Node» — запуском, а не по памяти.
 *
 * Тема почти целиком состоит из вопросов, которые можно задать движку прямо отсюда:
 * `vitest` идёт в Node (`environment: 'node'`), поэтому `process.memoryUsage()`,
 * `v8.getHeapStatistics()`, `v8.getHeapSpaceStatistics()` и `worker_threads` доступны
 * без всяких ухищрений. Что нельзя спросить в самом прогоне — спрашивается у отдельного
 * процесса тем же приёмом, что в `tests/unit/elements-kinds.test.ts` и `v8-engine.test.ts`.
 *
 * ⚠️ **Здесь закрепляются отношения, а не мегабайты.** Абсолютные числа темы сняты на другой
 * машине и другой сборке Node (24.11 против 26.8 в этом прогоне), и тест, сверяющий их
 * дословно, краснел бы от смены железа, а не от ошибки. Поэтому везде, где в `data.ts` стоит
 * число, тест проверяет либо порядок величин, либо закон, из которого число следует, либо
 * внутреннюю согласованность самих данных.
 *
 * ⚠️ Что здесь НЕ проверяется и почему:
 *
 *   всё, что зависит от cgroup   — `LIMIT_ROWS`, доли `BUDGETS`, `SNAPSHOT_KILL`, коды выхода
 *                                  137/139/133, `OOMKilled`. Снято в Docker; на macOS cgroup-лимита
 *                                  не существует, и подделывать его заглушкой нельзя —
 *                                  проверка без предмета хуже отсутствующей;
 *   `--inspect` как вектор RCE   — свойство протокола и сетевой конфигурации, а не движка.
 *                                  Проверено разовым запуском 2026-10-01: `--inspect=127.0.0.1:0`,
 *                                  WebSocket без всякой проверки выполнил `Runtime.evaluate`
 *                                  с `require`. В прогон не взято: дочерний процесс с открытым
 *                                  портом отладки — не то, что стоит поднимать на каждом `npm test`;
 *   числа `CASES`                — помечены в данных как иллюстрация чужих прод-систем. Ниже
 *                                  проверена только их внутренняя непротиворечивость: столбики
 *                                  обязаны отвечать подписанным значениям;
 *   цена снимка (`SNAPSHOT_COST`) — пик памяти процесса меряется снаружи (`/usr/bin/time -l`,
 *                                  `memory.peak`), а не изнутри Node.
 */

const MB = 1024 ** 2;

/**
 * Спросить отдельный Node и забрать JSON из последней строки его вывода.
 *
 * Отдельный процесс нужен по двум причинам: в прогоне `vitest` нет ни `--expose-gc`, ни чистой
 * стартовой картины памяти — рядом работают воркеры самого раннера, и «пустой процесс» тут
 * померить нельзя. Последняя строка, а не весь вывод, потому что часть флагов (`--trace-gc`,
 * `--inspect`) печатает своё поверх.
 */
function probe<T>(flags: string[], body: string): T {
  const out = execFileSync(process.execPath, [...flags, '-e', body], {
    encoding: 'utf8',
    maxBuffer: 64 * MB,
  });
  const last = out.trim().split('\n').at(-1);
  if (!last) throw new Error(`процесс ${flags.join(' ')} не напечатал ничего`);
  return JSON.parse(last) as T;
}

/** Поле схемы по имени: пропажа поля обязана падать внятно, а не приезжать `undefined`. */
function field(key: (typeof FIELDS)[number]['key']) {
  const found = FIELDS.find((f) => f.key === key);
  if (!found) throw new Error(`поля ${key} в FIELDS нет — проверка осталась без предмета`);
  return found;
}

/** Строка шпаргалки по куску имени флага. */
function flagRow(needle: string) {
  const found = FLAGS.filter((f) => f.flag.includes(needle));
  if (found.length !== 1) throw new Error(`строк FLAGS с «${needle}»: ${found.length}, нужна одна`);
  return found[0];
}

/** Тонкое место по номеру. */
function pitfall(n: string) {
  const found = PITFALLS.find((p) => p.n === n);
  if (!found) throw new Error(`тонкого места ${n} в data.ts нет — проверка осталась без предмета`);
  return found;
}

/** Конфигурация бюджета по куску подписи. */
function budget(needle: string) {
  const found = BUDGETS.filter((b) => b.label.includes(needle));
  if (found.length !== 1) throw new Error(`бюджетов с «${needle}»: ${found.length}, нужен один`);
  return found[0];
}

/** Пресет графика по ключу. */
function preset(key: string) {
  const found = HEAP_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`пресета ${key} в HEAP_PRESETS нет`);
  return found;
}

// ---------------------------------------------------------------------------
// Схема · пять полей memoryUsage и их вложенность
// ---------------------------------------------------------------------------

describe('memoryUsage · пять полей и их вложенность', () => {
  const m = process.memoryUsage();

  it('FIELDS перечисляет ровно то, что возвращает движок — ни больше, ни меньше', () => {
    // Схема урока нарисована по этому списку. Появится шестое поле — схема соврёт молча.
    expect([...FIELDS.map((f) => f.key)].sort()).toEqual(Object.keys(m).sort());
  });

  it('все пять — конечные неотрицательные числа', () => {
    for (const f of FIELDS) {
      const value = m[f.key];
      expect(typeof value, f.key).toBe('number');
      expect(Number.isFinite(value), f.key).toBe(true);
      expect(value, f.key).toBeGreaterThanOrEqual(0);
    }
    // Четыре из пяти на живом процессе обязаны быть строго положительны; arrayBuffers
    // может оказаться нулём, если процесс не трогал буферов, — поэтому он не здесь.
    for (const key of ['rss', 'heapTotal', 'heapUsed', 'external'] as const) {
      expect(m[key], key).toBeGreaterThan(0);
    }
  });

  it('rss — внешний контур: он больше, чем зарезервированная куча', () => {
    expect(m.rss).toBeGreaterThan(m.heapTotal);
  });

  it('heapTotal ⊃ heapUsed', () => {
    expect(m.heapTotal).toBeGreaterThanOrEqual(m.heapUsed);
  });

  it('external ⊃ arrayBuffers — вложено, а не стоит рядом', () => {
    // Ради этой строчки поля в теме упорядочены по вложенности, а не по важности.
    expect(m.external).toBeGreaterThanOrEqual(m.arrayBuffers);
  });

  it('зоны в данных совпадают с вложенностью, которую рисует схема', () => {
    expect(field('rss').zone).toBe('outer');
    expect([field('heapTotal').zone, field('heapUsed').zone]).toEqual(['heap', 'heap']);
    expect([field('external').zone, field('arrayBuffers').zone]).toEqual(['off-heap', 'off-heap']);
  });

  it('подпись под схемой называет то, из чего состоит разрыв', () => {
    expect(OUTSIDE).toContain('стеки потоков');
    expect(OUTSIDE).toContain('фрагментация');
  });
});

// ---------------------------------------------------------------------------
// Схема · разрыв между rss и суммой полей
// ---------------------------------------------------------------------------

describe('разрыв между rss и суммой полей — это норма', () => {
  /** Только что запустившийся процесс: тот самый замер, что показан в IDLE_PROBE. */
  const idle = probe<{ rss: number; heapTotal: number; external: number }>(
    [],
    'const m = process.memoryUsage();' +
      'console.log(JSON.stringify({ rss: m.rss, heapTotal: m.heapTotal, external: m.external }))',
  );

  const gapMb = (idle.rss - (idle.heapTotal + idle.external)) / MB;

  it('rss больше суммы показанных полей', () => {
    expect(idle.rss).toBeGreaterThan(idle.heapTotal + idle.external);
  });

  it('разрыв — десятки мегабайт, а не единицы', () => {
    /**
     * ⚠️ Порог, а не значение. Сам `rss` от запуска к запуску плавает (в замерах темы
     * 40.0–43.1 МБ, в этом прогоне около 36), и данные прямо предупреждают, что
     * воспроизводится здесь не число, а разрыв. Замеры на этой машине дают 29.8–29.9 МБ
     * с разбросом в десятую долю — порог в 10 МБ оставляет тройной запас и всё ещё краснеет,
     * если разрыв вдруг схлопнется.
     */
    expect(gapMb).toBeGreaterThan(10);
  });

  it('показанный в теме вывод сам себе не противоречит', () => {
    const parsed = IDLE_PROBE_OUT.match(
      /rss ([\d.]+) · heapTotal ([\d.]+) · external ([\d.]+)/,
    );
    if (!parsed) throw new Error(`IDLE_PROBE_OUT разобрать не удалось: ${IDLE_PROBE_OUT}`);
    const [rss, heapTotal, external] = parsed.slice(1).map(Number);
    expect(rss).toBeGreaterThan(heapTotal + external);
    expect(rss - (heapTotal + external)).toBeGreaterThan(10);
  });

  it('карточка про разрыв на месте и называет его нормой, а не утечкой', () => {
    const card = MODEL_CARDS.find((c) => c.t.includes('разрыв'));
    if (!card) throw new Error('карточки про разрыв в MODEL_CARDS нет');
    expect(card.d).toContain('норма');
  });
});

// ---------------------------------------------------------------------------
// Схема · пространства кучи
// ---------------------------------------------------------------------------

describe('раскладка кучи по пространствам', () => {
  const spaces = v8.getHeapSpaceStatistics();
  const names = spaces.map((s) => s.space_name);

  it('пространств ровно тринадцать', () => {
    expect(spaces).toHaveLength(13);
  });

  it('список в теме — это то, что перечисляет движок, а не переписанное руками', () => {
    /**
     * Ровно тот случай, ради которого правило «таблицу о поведении не набирают — её вычисляют»
     * и написано. `SPACE_NAMES` показывается читателю как вывод команды `SPACE_PROBE`, и
     * разойтись с движком он может молча. Сверяется вместе с порядком: перечисление
     * пространств у V8 детерминировано, и порядок — такая же часть вывода, как имена.
     *
     * Список версиезависим намеренно: пространства у V8 появляются, сливаются и исчезают.
     * Покраснеет — значит, тему надо пересматривать, а не подгонять литерал.
     */
    expect(names).toEqual([...SPACE_NAMES]);
  });

  it('map_space среди них нет — карты переехали в old_space', () => {
    // Главная правка темы против оригинала. Держалась на одном ручном прогоне.
    expect(names).not.toContain('map_space');
    expect([...SPACE_NAMES]).not.toContain('map_space');
  });

  it('и подпись под списком объясняет, куда он делся', () => {
    expect(SPACE_NOTE).toContain('old_space');
  });

  it('code_space существует — машинный код лежит внутри кучи', () => {
    // Вторая правка против оригинала: в оригинале код стоял в списке «вне heap».
    expect(names).toContain('code_space');
    expect(names).toContain('code_large_object_space');
  });

  it('сумма пространств сходится с heapTotal', () => {
    /**
     * Замер темы: сумма `space_size` 5.34 МБ против `heapTotal` 5.59 МБ — то есть сумма
     * чуть меньше. Закрепляется отношение (сумма того же порядка, что heapTotal), а не
     * конкретные мегабайты: на этой машине выходило и 0.91, и ровно 1.00.
     */
    const sum = spaces.reduce((acc, s) => acc + s.space_size, 0);
    const ratio = sum / process.memoryUsage().heapTotal;
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.1);
  });
});

// ---------------------------------------------------------------------------
// Схема · буферы уходят в external, а не в heap
// ---------------------------------------------------------------------------

describe('Buffer.alloc двигает external и arrayBuffers, но не heapUsed', () => {
  const deltas = probe<{ external: number; arrayBuffers: number; heapUsed: number }>(
    [],
    `const before = process.memoryUsage();
     const bufs = [];
     for (let i = 0; i < 10; i++) bufs.push(Buffer.alloc(10 * 1024 * 1024, 7));
     const after = process.memoryUsage();
     console.log(JSON.stringify({
       external: after.external - before.external,
       arrayBuffers: after.arrayBuffers - before.arrayBuffers,
       heapUsed: after.heapUsed - before.heapUsed,
       keep: bufs.length,
     }));`,
  );

  it('сто мегабайт буферов приходят в external', () => {
    expect(deltas.external / MB).toBeGreaterThan(90);
  });

  it('и ровно они же — в arrayBuffers', () => {
    expect(deltas.arrayBuffers / MB).toBeGreaterThan(90);
  });

  it('а heapUsed не сдвигается — снимок такую утечку не покажет', () => {
    /**
     * Это и есть причина, по которой половина продовых утечек в Node не видна в heap snapshot.
     * Закрепляется отношение: рост вне кучи на порядок больше любого шевеления внутри неё.
     * Дельта `heapUsed` в замерах бывает и отрицательной — между двумя вызовами успевает
     * пройти сборка, поэтому сравнивается модуль.
     */
    expect(Math.abs(deltas.heapUsed) / MB).toBeLessThan(5);
    expect(deltas.external).toBeGreaterThan(10 * Math.abs(deltas.heapUsed));
  });

  it('описание полей в теме обещает именно это', () => {
    expect(field('external').what).toContain('Buffer');
    expect(field('arrayBuffers').what).toContain('external');
  });
});

// ---------------------------------------------------------------------------
// Схема · машинный код учтён в heapTotal
// ---------------------------------------------------------------------------

describe('машинный код живёт в code_space и посчитан в heapTotal', () => {
  const jit = probe<{ code: number[]; exec: number[]; heapTotal: number[] }>(
    [],
    `const v8 = require('node:v8');
     const code = () => v8.getHeapSpaceStatistics()
       .find((s) => s.space_name === 'code_space').space_used_size;
     const snap = () => [code(), v8.getHeapStatistics().total_heap_size_executable,
       process.memoryUsage().heapTotal];
     const before = snap();
     const fns = [];
     for (let i = 0; i < 1000; i++) {
       fns.push(new Function('a', 'b', 'let s = 0; for (let j = 0; j < a; j++) s += j * b + ' + i + '; return s;'));
     }
     for (const f of fns) for (let k = 0; k < 2000; k++) f(20, 3);
     const after = snap();
     console.log(JSON.stringify({
       code: [before[0], after[0]],
       exec: [before[1], after[1]],
       heapTotal: [before[2], after[2]],
       keep: fns.length,
     }));`,
  );

  const grew = ([before, after]: number[]) => after - before;

  it('тысяча прогретых функций заметно поднимает code_space', () => {
    /**
     * Замер темы: 30 → 2199 КБ, то есть рост в семьдесят раз. Закрепляется кратность,
     * а не килобайты: сколько именно кода V8 сгенерирует, зависит от версии и от того,
     * докрутился ли оптимизирующий компилятор.
     */
    expect(jit.code[1]).toBeGreaterThan(jit.code[0] * 3);
    expect(grew(jit.code)).toBeGreaterThan(0);
  });

  it('total_heap_size_executable растёт вместе с ним', () => {
    expect(grew(jit.exec)).toBeGreaterThan(0);
  });

  it('и весь этот рост виден в heapTotal — значит, код внутри кучи', () => {
    // Ровно то, что исправлено против оригинала: код не «вне heap», он учтён в heapTotal.
    expect(grew(jit.heapTotal)).toBeGreaterThanOrEqual(grew(jit.code));
  });

  it('поле heapUsed в теме обещает, что код попадает в code_space', () => {
    expect(field('heapUsed').what).toContain('code_space');
  });
});

// ---------------------------------------------------------------------------
// Раздел 1 · memoryUsage считает по потоку — кроме rss
// ---------------------------------------------------------------------------

/**
 * Замер, ради которого этот файл в первую очередь и написан.
 *
 * Утверждение «`process.memoryUsage()` считает по потоку всё, кроме `rss`» — правка против
 * оригинала урока И против конспекта, где было сказано ровно наоборот. Цена ошибки здесь
 * максимальная: от ответа зависит, откуда в проде вообще собирать метрики. До этого теста
 * утверждение держалось на одном ручном прогоне.
 */
const WORKER_PROBE = `
const { parentPort } = require('node:worker_threads');
const objects = [];
for (let i = 0; i < 300; i++) objects.push(new Array(20000).fill(i));
const bufs = [];
for (let i = 0; i < 10; i++) bufs.push(Buffer.alloc(10 * 1024 * 1024, 1));
const m = process.memoryUsage();
parentPort.postMessage({
  rss: m.rss, heapUsed: m.heapUsed, arrayBuffers: m.arrayBuffers, external: m.external,
});
// Ссылки обязаны дожить до того момента, когда главный поток снимет свой замер.
setTimeout(() => void [objects.length, bufs.length], 10000);
`;

describe('тонкое место «по потоку» · memoryUsage считает по потоку, кроме rss', () => {
  type Usage = { rss: number; heapUsed: number; arrayBuffers: number; external: number };
  let inWorker: Usage;
  let mainBefore: Usage;
  let mainAfter: Usage;

  /**
   * Замер идёт по ПРИРОСТУ главного потока, а не по его абсолютным значениям.
   *
   * Так пришлось сделать по факту прогона: главный поток здесь — это процесс самого vitest,
   * и своей кучи у него под 80 МБ. Сравнение «у воркера больше, чем у главного» на таком
   * фоне не проверяет ничего — оно проверяет вес раннера. А вот прирост отвечает ровно
   * на вопрос темы: двести мегабайт, которые занял воркер, видны в `rss` главного потока
   * и не видны ни в одном из остальных четырёх полей.
   */
  beforeAll(async () => {
    mainBefore = process.memoryUsage();
    const worker = new Worker(WORKER_PROBE, { eval: true });
    try {
      inWorker = await new Promise<Usage>((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
      });
      // Снимается в тот же момент, пока воркер ещё держит свои объекты и буферы.
      mainAfter = process.memoryUsage();
    } finally {
      await worker.terminate();
    }
  }, 30_000);

  /** Насколько поле главного потока сдвинулось за жизнь воркера, МБ. */
  const mainGrewBy = (key: keyof Usage) => (mainAfter[key] - mainBefore[key]) / MB;

  it('воркер действительно занял сотни мегабайт', () => {
    // Без этого всё остальное в блоке проверяло бы бездействующий воркер.
    expect(inWorker.heapUsed / MB, 'куча воркера').toBeGreaterThan(40);
    expect(inWorker.arrayBuffers / MB, 'буферы воркера').toBeGreaterThan(50);
  });

  it('rss у обоих потоков один и тот же — он считается по процессу', () => {
    // В замерах расхождение было 0.02 %; порог в 5 % ловит подмену смысла, а не шум.
    const spread = Math.abs(mainAfter.rss - inWorker.rss) / inWorker.rss;
    expect(spread).toBeLessThan(0.05);
  });

  it('и в главном потоке rss вырос на память воркера', () => {
    // Это половина утверждения: по процессу считается именно rss — и он всё видит.
    expect(mainGrewBy('rss'), `прирост rss: ${mainGrewBy('rss').toFixed(1)} МБ`).toBeGreaterThan(50);
  });

  it('а heapUsed главного потока эти сотни мегабайт не заметил', () => {
    /**
     * Вторая половина: у каждого worker thread свой изолят со своей кучей. Порог щедрый —
     * раннер живёт своей жизнью и между двумя замерами может и подрасти, и собрать мусор,
     * поэтому сравнивается модуль сдвига, а не его знак.
     */
    const drift = Math.abs(mainGrewBy('heapUsed'));
    expect(drift, `сдвиг heapUsed: ${mainGrewBy('heapUsed').toFixed(1)} МБ`).toBeLessThan(25);
    expect(inWorker.heapUsed / MB).toBeGreaterThan(drift * 2);
  });

  it('arrayBuffers воркера главному потоку не видны вовсе', () => {
    const drift = Math.abs(mainGrewBy('arrayBuffers'));
    expect(drift, `сдвиг arrayBuffers: ${drift.toFixed(1)} МБ`).toBeLessThan(20);
    expect(inWorker.arrayBuffers / MB).toBeGreaterThan(drift * 2);
  });

  it('external — тоже по потоку', () => {
    const drift = Math.abs(mainGrewBy('external'));
    expect(drift, `сдвиг external: ${drift.toFixed(1)} МБ`).toBeLessThan(25);
    expect(inWorker.external / MB).toBeGreaterThan(drift * 2);
  });

  it('вывод, показанный в теме, утверждает ровно эти три отношения', () => {
    /**
     * Литерал `THREAD_PROBE_OUT` — картинка замера, и разойтись с движком она может молча.
     * Поэтому из неё вынимаются те же три отношения и проверяются как утверждения:
     * rss совпадает, heapUsed и arrayBuffers — нет.
     */
    const rows = THREAD_PROBE_OUT.trim()
      .split('\n')
      .map((line) => {
        const m = line.match(/rss\s+([\d.]+)\s+heapUsed\s+([\d.]+)\s+arrayBuffers\s+([\d.]+)/);
        if (!m) throw new Error(`строку THREAD_PROBE_OUT разобрать не удалось: ${line}`);
        const [rss, heapUsed, arrayBuffers] = m.slice(1).map(Number);
        return { rss, heapUsed, arrayBuffers };
      });

    expect(rows).toHaveLength(2);
    const [shownWorker, shownMain] = rows;
    expect(Math.abs(shownWorker.rss - shownMain.rss) / shownWorker.rss).toBeLessThan(0.05);
    expect(shownWorker.heapUsed).toBeGreaterThan(shownMain.heapUsed * 5);
    expect(shownWorker.arrayBuffers).toBeGreaterThan(shownMain.arrayBuffers + 50);
  });

  it('поле scope в схеме расставлено согласно замеру', () => {
    expect(field('rss').scope).toContain('процесс');
    for (const key of ['heapTotal', 'heapUsed', 'external', 'arrayBuffers'] as const) {
      expect(field(key).scope, key).toContain('поток');
    }
  });

  it('тонкое место 03 всё ещё говорит «по потоку, кроме rss»', () => {
    // Короткая смысловая подстрока: ради этой правки тонкое место и существует.
    expect(pitfall('03').t).toContain('по потоку');
    expect(pitfall('03').t).toContain('кроме rss');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · потолок кучи отдельного воркера
// ---------------------------------------------------------------------------

describe('resourceLimits · воркер падает свой, процесс остаётся жив', () => {
  type Outcome = { failure?: Error & { code?: string }; code: number };
  let outcome: Outcome;

  beforeAll(async () => {
    const worker = new Worker(
      'const hold = []; for (;;) hold.push(new Array(10000).fill(Math.random()));',
      { eval: true, resourceLimits: { maxOldGenerationSizeMb: 32 } },
    );
    outcome = await new Promise<Outcome>((resolve) => {
      let failure: (Error & { code?: string }) | undefined;
      worker.on('error', (e: Error & { code?: string }) => {
        failure = e;
      });
      worker.on('exit', (code) => resolve({ failure, code }));
    });
  }, 30_000);

  it('воркер, переросший свой лимит, бросает ошибку', () => {
    expect(outcome.failure).toBeDefined();
  });

  it('код ошибки — ERR_WORKER_OUT_OF_MEMORY', () => {
    /**
     * ⚠️ Код нормативен, текст сообщения — нет: V8 и Node формулируют его по-своему
     * и меняют от версии к версии. Поэтому здесь сверяется `code`, а не `message`.
     */
    expect(outcome.failure?.code).toBe('ERR_WORKER_OUT_OF_MEMORY');
  });

  it('и выходит с кодом 1', () => {
    expect(outcome.code).toBe(1);
  });

  it('главный процесс при этом жив и считает свою память', () => {
    // Сам факт, что мы сюда доехали, — половина утверждения; вторая половина — что он работает.
    expect(process.memoryUsage().rss).toBeGreaterThan(0);
  });

  it('шпаргалка обещает ровно этот код и это поведение', () => {
    const row = flagRow('maxOldGenerationSizeMb');
    expect(row.owner).toBe('node');
    expect(row.misses).toContain('ERR_WORKER_OUT_OF_MEMORY');
    expect(row.misses).toContain('процесс остаётся жив');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · --max-old-space-size и heap_size_limit
// ---------------------------------------------------------------------------

/** `heap_size_limit` процесса, запущенного с данными флагами, в мегабайтах. */
function heapLimitMb(flags: string[]): number {
  return probe<number>(
    flags,
    "console.log(JSON.stringify(require('node:v8').getHeapStatistics().heap_size_limit / 1024 ** 2))",
  );
}

describe('--max-old-space-size → heap_size_limit', () => {
  const OLD_SPACE = [64, 128, 256, 512];
  const limits = OLD_SPACE.map((mb) => heapLimitMb([`--max-old-space-size=${mb}`]));
  const diffs = limits.map((limit, i) => limit - OLD_SPACE[i]);

  it('потолок всегда выше самого флага', () => {
    for (const [i, diff] of diffs.entries()) {
      expect(diff, `--max-old-space-size=${OLD_SPACE[i]}`).toBeGreaterThan(0);
    }
  });

  it('добавка к флагу одна и та же на всех значениях', () => {
    /**
     * ⚠️ Вот это и есть проверяемое утверждение. Само слагаемое машинозависимо: тема сняла
     * 192 МБ на Node 24.11 без сжатия указателей, а этот прогон даёт другое число — потолок
     * молодого поколения между версиями поменялся. Закрепляется постоянство разницы,
     * а не её величина.
     */
    expect(new Set(diffs).size, `разницы разошлись: ${diffs.join(', ')}`).toBe(1);
  });

  it('потолок растёт вместе с флагом', () => {
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i], `${OLD_SPACE[i]} против ${OLD_SPACE[i - 1]}`).toBeGreaterThan(limits[i - 1]);
    }
  });

  it('добавка — ровно три полупространства молодого поколения', () => {
    /**
     * Закон, из которого следует и 192 темы, и другое число на другой сборке: разница между
     * `heap_size_limit` и `--max-old-space-size` равна утроенному `--max-semi-space-size`
     * (третье полупространство нужно под эвакуацию). Проверяется прямым заданием размера
     * полупространства — тогда закон виден без всяких умолчаний.
     */
    for (const semi of [16, 32, 64]) {
      const limit = heapLimitMb([`--max-semi-space-size=${semi}`, '--max-old-space-size=256']);
      expect(limit - 256, `--max-semi-space-size=${semi}`).toBe(3 * semi);
    }
  });

  it('умолчание этой машины тоже делится на три', () => {
    // Следствие того же закона: добавка по умолчанию — три полупространства умолчания.
    expect(diffs[0] % 3).toBe(0);
  });

  it('обе темы называют одно и то же слагаемое', () => {
    /**
     * ⚠️ Это число независимо стоит в двух местах: в шпаргалке флагов «Память в Node»
     * и в замере молодого поколения «Память и сборщик». Разъехаться они могут молча —
     * правит их разный человек в разное время. Тест сверяет литералы друг с другом.
     */
    const shown = flagRow('--max-old-space-size').what;

    const stated = shown.match(/ровно на (\d+) МБ больше флага/);
    if (!stated) throw new Error(`слагаемое в шпаргалке флагов не найдено: ${shown}`);
    const fromNodeMemory = Number(stated[1]);

    // Примеры в той же строке обязаны давать то же слагаемое.
    const examples = [...shown.matchAll(/(\d+) → (\d+)/g)].map(([, from, to]) => Number(to) - Number(from));
    expect(examples.length, 'примеров в шпаргалке не осталось').toBeGreaterThan(0);
    for (const diff of examples) expect(diff).toBe(fromNodeMemory);

    // Теперь то же самое из «Памяти и сборщика».
    const other = [...YOUNG_PROBE_OUT.matchAll(/--max-old-space-size=(\d+)\s+→ heap_size_limit (\d+) МБ/g)]
      .map(([, from, to]) => Number(to) - Number(from));
    expect(other.length, 'примеров в memory-gc не осталось').toBeGreaterThan(0);
    for (const diff of other) expect(diff).toBe(fromNodeMemory);

    // И разложение «3 × 64», которым это слагаемое там объяснено.
    const factored = YOUNG_PROBE_OUT.match(/3 × (\d+)/);
    if (!factored) throw new Error('разложения «3 × полупространство» в memory-gc нет');
    expect(3 * Number(factored[1])).toBe(fromNodeMemory);

    // Третий литерал того же числа — подпись под шпаргалкой флагов этой же темы.
    const inNote = SEMI_SPACE_NOTE.match(/\+(\d+) МБ/);
    if (!inNote) throw new Error(`слагаемое в SEMI_SPACE_NOTE не найдено: ${SEMI_SPACE_NOTE}`);
    expect(Number(inNote[1])).toBe(fromNodeMemory);

    const noteSemi = SEMI_SPACE_NOTE.match(/по (\d+) МБ/);
    if (!noteSemi) throw new Error('размера полупространства в SEMI_SPACE_NOTE нет');
    expect(3 * Number(noteSemi[1])).toBe(fromNodeMemory);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · флаг не ограничивает память процесса
// ---------------------------------------------------------------------------

describe('тонкое место «флаг не ограничивает процесс» · --max-old-space-size не ограничивает память процесса', () => {
  /**
   * Процесс с потолком кучи 64 МБ держит 300 МБ буферов и живёт. Сам факт, что
   * `execFileSync` вернулся, а не бросил, — половина утверждения: ненулевой код выхода
   * здесь означал бы, что флаг всё-таки убил процесс.
   */
  const held = probe<{ rss: number; arrayBuffers: number; heapUsed: number; limit: number }>(
    ['--max-old-space-size=64'],
    `const bufs = [];
     for (let i = 0; i < 30; i++) bufs.push(Buffer.alloc(10 * 1024 * 1024, 1));
     const m = process.memoryUsage();
     console.log(JSON.stringify({
       rss: m.rss, arrayBuffers: m.arrayBuffers, heapUsed: m.heapUsed,
       limit: require('node:v8').getHeapStatistics().heap_size_limit, keep: bufs.length,
     }));`,
  );

  it('триста мегабайт буферов держатся при потолке кучи в 64 МБ', () => {
    expect(held.arrayBuffers / MB).toBeGreaterThan(250);
  });

  it('и это больше, чем весь разрешённый V8 потолок кучи', () => {
    // Главное следствие: флаг ограничивает не ту память, которая выросла.
    expect(held.arrayBuffers).toBeGreaterThan(held.limit);
  });

  it('сама куча при этом почти пуста', () => {
    expect(held.heapUsed / MB).toBeLessThan(50);
  });

  it('rss видит всё это целиком — по нему и придёт OOM-killer', () => {
    expect(held.rss).toBeGreaterThan(held.arrayBuffers);
  });

  it('тонкое место 02 и карточка схемы обещают именно это', () => {
    /**
     * Число замера живёт в карточке схемы, тонкое место его больше не повторяет
     * (2026-10-01, «информацию не дублируем»): оно держит следствие — поднятый потолок
     * приближает падение.
     */
    expect(pitfall('02').t).toContain('не ограничивает память процесса');
    expect(pitfall('02').d).toContain('ПРИБЛИЖАЕТ');
    expect(MODEL_CARDS[0].t).toContain('--max-old-space-size');
    expect(MODEL_CARDS[0].d).toContain('64 МБ');
    expect(MODEL_CARDS[0].d).toContain('300 МБ буферов');
  });

  it('шпаргалка честно перечисляет, чего флаг не трогает', () => {
    const row = flagRow('--max-old-space-size');
    expect(row.misses).toContain('external');
    expect(row.misses).toContain('arrayBuffers');
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · грамматика строки --trace-gc
// ---------------------------------------------------------------------------

/**
 * Куски, из которых состоит строка `--trace-gc`.
 *
 * Виджет `gc-line` сам предупреждает, что формат меняется от версии к версии — этот набор
 * и есть сторож такой смены: одна и та же батарея прикладывается к настоящему логу и к строке,
 * собранной из `GC_TOKENS`. Разойдутся — покраснеет.
 */
const GC_GRAMMAR: [string, RegExp][] = [
  ['pid и адрес изолята', /^\[\d+:0x[0-9a-f]+\]/],
  ['время от старта', /\b\d+ ms:/],
  ['тип сборки', /Mark-Compact/],
  ['занято (зарезервировано) до → после', /\d+(?:\.\d+)? \(\d+(?:\.\d+)?\) -> \d+(?:\.\d+)? \(\d+(?:\.\d+)?\) MB/],
  ['придержанные страницы', /pooled: \d+(?:\.\d+)? MB/],
  ['пауза / внешние колбэки', /\d+(?:\.\d+)? \/ \d+(?:\.\d+)? ms/],
  ['средняя mutator utilization', /average mu = \d(?:\.\d+)?/],
  ['текущая mutator utilization', /current mu = \d(?:\.\d+)?/],
  [
    'причина запуска',
    /(allocation failure|last resort|task|external memory pressure|finalize incremental marking|testing)/,
  ],
];

describe('--trace-gc · строка разобрана по тем кускам, которые в ней есть', () => {
  /** Настоящая строка Mark-Compact из настоящего лога. */
  const real = (() => {
    const run = spawnSync(
      process.execPath,
      [
        '--trace-gc',
        '--max-old-space-size=40',
        '-e',
        'let a = []; for (let i = 0; i < 3000; i++) { a.push(new Array(4000).fill(i)); if (i % 400 === 0) a = []; }',
      ],
      { encoding: 'utf8', maxBuffer: 64 * MB },
    );
    const line = `${run.stdout}\n${run.stderr}`
      .split('\n')
      .find((l) => l.includes('Mark-Compact'));
    if (!line) throw new Error('в выводе --trace-gc не нашлось ни одной строки Mark-Compact');
    return line;
  })();

  /** Та же строка, собранная из кусков, которые показывает виджет. */
  const shown = GC_TOKENS.map((t) => t.t).join(' ');

  for (const [name, pattern] of GC_GRAMMAR) {
    it(`настоящий лог содержит «${name}»`, () => {
      expect(real, real).toMatch(pattern);
    });

    it(`строка виджета содержит «${name}»`, () => {
      expect(shown, shown).toMatch(pattern);
    });
  }

  it('поле pooled помечено как новое — в оригинале разбора его не было', () => {
    const pooled = GC_TOKENS.find((t) => t.t.includes('pooled'));
    if (!pooled) throw new Error('куска pooled в GC_TOKENS нет');
    expect(pooled.fresh).toBe(true);
  });

  it('главное поле строки помечено ровно одно — число после стрелки', () => {
    const starred = GC_TOKENS.filter((t) => t.star);
    expect(starred).toHaveLength(1);
    expect(starred[0].t).toContain('MB');
  });

  it('у каждого кликабельного куска есть и объяснение, и польза', () => {
    // Кусок без `name` — пунктуация вроде стрелки; всё остальное обязано уметь рассказать о себе.
    for (const token of GC_TOKENS.filter((t) => t.name)) {
      expect(token.what, token.t).toBeTruthy();
      expect(token.use, token.t).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · --expose-gc и ручная сборка
// ---------------------------------------------------------------------------

describe('--expose-gc · ручная сборка и её единственный честный рецепт', () => {
  /** `typeof globalThis.gc` в процессе, запущенном с данными флагами. */
  const gcType = (flags: string[]) =>
    probe<string>(flags, 'console.log(JSON.stringify(typeof globalThis.gc))');

  it('без флага функции gc() нет вовсе', () => {
    // Заодно объяснение, почему сборка в этом файле живёт в отдельных процессах:
    // в самом прогоне vitest флага нет, и `globalThis.gc` здесь undefined.
    expect(gcType([])).toBe('undefined');
    expect(typeof (globalThis as { gc?: unknown }).gc).toBe('undefined');
  });

  it('с флагом она появляется', () => {
    expect(gcType(['--expose-gc'])).toBe('function');
  });

  it('два gc() подряд не собирают, а после уступки потоку — собирают', () => {
    /**
     * ⚠️ Главная ловушка всей темы про сборку, и она контринтуитивна: сам по себе вызов
     * `gc()` только что брошенный объект не забирает — кадр вызывающего ещё держит ссылку.
     * Работает единственный рецепт: сперва уступить потоку, потом собирать (AGENTS.md,
     * «Память, сборщик и строки»). Воспроизводится устойчиво — в замерах 5/5 и 3/3 здесь.
     *
     * Код повторяет FORCE_GC_PROBE: ссылка создаётся внутри функции, иначе её держит кадр.
     */
    const states = probe<[string, string]>(
      ['--expose-gc'],
      `const ref = (() => new WeakRef({ big: new Array(1e6).fill(0) }))();
       const state = () => (ref.deref() === undefined ? 'собран' : 'жив');
       globalThis.gc(); globalThis.gc();
       const first = state();
       setTimeout(() => {
         globalThis.gc(); globalThis.gc();
         console.log(JSON.stringify([first, state()]));
       }, 0);`,
    );
    expect(states).toEqual(['жив', 'собран']);
  });

  it('вывод, показанный в теме, обещает ровно эту пару состояний', () => {
    const [afterTwoCalls, afterYield] = FORCE_GC_OUT.trim()
      .split('\n')
      .map((line) => line.split(':').slice(1).join(':').trim());
    expect(afterTwoCalls).toBe('жив');
    expect(afterYield).toBe('собран');
  });

  it('в логе --trace-gc такая сборка помечена причиной testing', () => {
    // Утверждение из FORCE_GC_NOTE: по причине в логе ручную сборку и отличают от настоящей.
    expect(FORCE_GC_NOTE).toContain('testing');

    const run = spawnSync(
      process.execPath,
      ['--expose-gc', '--trace-gc', '-e', 'globalThis.gc()'],
      { encoding: 'utf8', maxBuffer: 64 * MB },
    );
    const line = `${run.stdout}\n${run.stderr}`.split('\n').find((l) => l.includes('Mark-Compact'));
    if (!line) throw new Error('принудительная сборка не оставила строки Mark-Compact');
    expect(line).toContain('testing');
  });

  it('разбор под замером не обещает, что флаг лечит утечку', () => {
    // Смысловая подстрока: ради неё разбор и написан.
    expect(FORCE_GC_NOTE).toContain('Утечку он не лечит');
  });

  it('шпаргалка знает, чей это флаг', () => {
    expect(flagRow('--expose-gc').owner).toBe('node');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · как выглядит падение по пределу кучи
// ---------------------------------------------------------------------------

describe('JavaScript heap out of memory · что печатает процесс перед смертью', () => {
  const crash = spawnSync(
    process.execPath,
    [
      '--max-old-space-size=24',
      '-e',
      'const a = []; for (;;) a.push(new Array(20000).fill(Math.random()));',
    ],
    { encoding: 'utf8', maxBuffer: 64 * MB },
  );

  it('процесс умирает', () => {
    /**
     * ⚠️ Код выхода здесь НЕ закрепляется. Тема приводит 139 — он снят в контейнере,
     * на этой машине V8 обрывается по SIGABRT. Проверяемо только то, что процесс не дожил
     * до нормального конца.
     */
    expect(crash.status === 0 && crash.signal === null).toBe(false);
  });

  it('код выхода зависит от сборки — тема так и говорит', () => {
    /**
     * Замер 2026-10-01: 139 в node:24-alpine и node:22-alpine, 133 в node:22 и node:22-slim,
     * на macOS — SIGABRT (134 в оболочке). Docker в прогоне недоступен, поэтому закреплены
     * местная половина и то, что текст не выдаёт один код за признак падения.
     */
    if (process.platform === 'darwin') expect(crash.signal).toBe('SIGABRT');
    const card = CRASH_CARDS.find((c) => c.t === 'JavaScript heap out of memory');
    expect(card?.d).toContain('зависит от сборки');
    expect(card?.d).toContain('134 на macOS');
  });

  it('печатает блок «Last few GCs»', () => {
    expect(crash.stderr).toContain('<--- Last few GCs --->');
  });

  it('и фатальную ошибку про кучу', () => {
    expect(crash.stderr).toContain('FATAL ERROR');
    expect(crash.stderr).toContain('JavaScript heap out of memory');
  });

  it('в блоке видны строки последних сборок', () => {
    const gcLines = crash.stderr
      .split('\n')
      .filter((l) => l.includes('Mark-Compact') && /^\[\d+:0x[0-9a-f]+\]/.test(l));
    expect(gcLines.length).toBeGreaterThan(0);
  });

  it('заголовок карточки «два падения» — это дословно то, что печатает V8', () => {
    const card = CRASH_CARDS.find((c) => c.t === 'JavaScript heap out of memory');
    if (!card) throw new Error('карточки про предел кучи в CRASH_CARDS нет');
    expect(crash.stderr).toContain(card.t);
  });

  it('показанный в теме лог содержит те же два опознавательных знака', () => {
    /**
     * ⚠️ Первая половина строки FATAL ERROR у V8 бывает разной («Ineffective mark-compacts
     * near heap limit» в замере темы, «Reached heap limit» в этом прогоне) — сверяются
     * только устойчивые куски.
     */
    expect(FATAL_LOG).toContain('<--- Last few GCs --->');
    expect(FATAL_LOG).toContain('JavaScript heap out of memory');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · чей это флаг
// ---------------------------------------------------------------------------

describe('шпаргалка флагов · владелец флага — часть факта', () => {
  /** Флаги Node, которые можно просто подать процессу. */
  const nodeFlags = FLAGS.filter(
    (f) => f.owner === 'node' && f.flag.startsWith('--') && !f.flag.startsWith('--inspect'),
  );

  it('флаги Node в шпаргалке нашлись — фильтр не опустел', () => {
    /**
     * Сторож цикла ниже: без него опечатка в `owner` тихо оставила бы проверку без предмета.
     * Не равенство, а нижняя граница — тема живая, флаги в шпаргалку добавляют, и каждый
     * новый всё равно попадёт в цикл и будет запущен.
     */
    expect(nodeFlags.length).toBeGreaterThanOrEqual(3);
  });

  for (const row of nodeFlags) {
    it(`node принимает ${row.flag}`, () => {
      // `=N` в шпаргалке — плейсхолдер; процессу нужно настоящее число.
      const cli = row.flag.replace('=N', '=64');
      const run = spawnSync(process.execPath, [cli, '-e', 'process.exit(0)'], { encoding: 'utf8' });
      expect(run.status, run.stderr).toBe(0);
    });
  }

  it('--max-memory-restart — не флаг Node, и Node это говорит прямо', () => {
    /**
     * Правка против оригинала, где он стоял в одном ряду с настоящими флагами Node.
     * Проверяется запуском: процесс отказывается стартовать.
     */
    const row = flagRow('--max-memory-restart');
    expect(row.owner).toBe('pm2');

    const run = spawnSync(process.execPath, ['--max-memory-restart=300M', '-e', ''], {
      encoding: 'utf8',
    });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('bad option');
    expect(run.stderr).toContain('--max-memory-restart');
  });

  it('--inspect оставлен без запуска сознательно', () => {
    // Он занял бы фиксированный порт 9229 и сделал бы прогон зависимым от свободного порта.
    const row = flagRow('--inspect');
    expect(row.owner).toBe('node');
    expect(row.tone).toBe('err');
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · что даёт getHeapStatistics
// ---------------------------------------------------------------------------

describe('тонкое место 05 · утечку контекстов видно по number_of_native_contexts', () => {
  const stats = v8.getHeapStatistics();

  it('heap_size_limit — число и оно положительно', () => {
    expect(typeof stats.heap_size_limit).toBe('number');
    expect(stats.heap_size_limit).toBeGreaterThan(0);
  });

  it('оба поля про контексты — числа', () => {
    expect(typeof stats.number_of_detached_contexts).toBe('number');
    expect(typeof stats.number_of_native_contexts).toBe('number');
  });

  /**
   * Двадцать контекстов `vm`, удержанных кешем функций, — и тот же кеш после очистки.
   *
   * ⚠️ История находки. Раньше тема советовала `number_of_detached_contexts` и оговаривалась,
   * что его рост «воспроизвести не удалось»; тест пинил тот ноль. Прогон 2026-10-01 показал
   * причину: в Node это поле молчит, а утечку контекстов видно по `number_of_native_contexts`
   * (Node 24.11 и 26.8: 1 → 21 → 2). Сборка — в отдельном процессе и по рецепту из
   * AGENTS.md: сперва уступить потоку, потом собирать.
   */
  const contexts = probe<{ before: number[]; held: number[]; released: number[] }>(
    ['--expose-gc'],
    `const vm = require('node:vm');
     const v8 = require('node:v8');
     const count = () => {
       const s = v8.getHeapStatistics();
       return [s.number_of_native_contexts, s.number_of_detached_contexts];
     };
     const settle = async () => { await new Promise((r) => setTimeout(r, 0)); globalThis.gc(); globalThis.gc(); };
     (async () => {
       await settle();
       const before = count();
       const cache = [];
       for (let i = 0; i < 20; i++) cache.push(vm.runInContext('(() => 1)', vm.createContext({})));
       await settle();
       const held = count();
       cache.length = 0;
       await settle();
       console.log(JSON.stringify({ before, held, released: count() }));
     })();`,
  );

  it('удержанные контексты поднимают number_of_native_contexts на их число', () => {
    expect(contexts.held[0] - contexts.before[0]).toBeGreaterThanOrEqual(20);
  });

  it('после очистки кеша оно падает почти к исходному', () => {
    expect(contexts.released[0]).toBeLessThan(contexts.before[0] + 5);
  });

  it('а number_of_detached_contexts всё это время стоит на нуле', () => {
    expect([contexts.before[1], contexts.held[1], contexts.released[1]]).toEqual([0, 0, 0]);
  });

  it('тонкое место 05 советует то поле, которое растёт', () => {
    expect(pitfall('05').t).toContain('number_of_native_contexts');
    expect(pitfall('05').d).toContain('в Node оно молчит');
    expect(CASES[1].note).toContain('number_of_native_contexts');
  });
});

describe('тонкое место 04 · process.constrainedMemory существует', () => {
  it('это функция, и она возвращает число', () => {
    /**
     * ⚠️ Значение не закрепляется. На macOS без ограничений функция возвращает 0,
     * в контейнере без `--memory` — 18446744073709552000, и тема прямо запрещает читать
     * ноль как «лимита нет». Проверяемо здесь только существование и тип.
     */
    expect(typeof process.constrainedMemory).toBe('function');
    expect(typeof process.constrainedMemory()).toBe('number');
  });

  it('тонкое место 04 запрещает трактовать ноль как отсутствие лимита', () => {
    expect(pitfall('04').d).toContain('ноль значит без лимита');
  });
});

// ---------------------------------------------------------------------------
// Данные островов · арифметика, которую рисуют демо
// ---------------------------------------------------------------------------

describe('бюджет памяти контейнера · арифметика сходится', () => {
  const sumParts = (b: (typeof BUDGETS)[number]) => b.parts.reduce((acc, p) => acc + p.mb, 0);

  it('куча ни в одной конфигурации не выходит за свой же потолок', () => {
    for (const b of BUDGETS) {
      const heap = b.parts.filter((p) => p.kind === 'heap').reduce((acc, p) => acc + p.mb, 0);
      expect(heap, b.label).toBeLessThanOrEqual(b.heapLimitMb);
    }
  });

  it('потолок кучи выше лимита пода — ровно там, где случай помечен красным', () => {
    /**
     * Смысл всего раздела: два независимых числа согласует человек. Если потолок кучи выше
     * лимита контейнера, V8 разрешено занять больше, чем весь под, — и это всегда `err`.
     * Проверяется в обе стороны, поэтому и «забыли покрасить», и «покрасили лишнее» краснеют.
     */
    for (const b of BUDGETS) {
      expect(b.heapLimitMb > b.limitMb, b.label).toBe(b.tone === 'err');
    }
  });

  it('у случая «256 Mi» потолок и правда больше всего лимита', () => {
    const b = budget('256 Mi');
    expect(b.heapLimitMb).toBeGreaterThan(b.limitMb);
    expect(b.tone).toBe('err');
  });

  it('благополучные конфигурации умещаются в лимит пода', () => {
    for (const b of BUDGETS.filter((x) => x.tone === 'ok')) {
      expect(sumParts(b), b.label).toBeLessThanOrEqual(b.limitMb);
    }
  });

  it('а та, что в лимит не влезает, доведена до падения и об этом сказано', () => {
    for (const b of BUDGETS.filter((x) => sumParts(x) > x.limitMb)) {
      expect(b.tone, b.label).toBe('err');
      expect(b.outcome, b.label).toContain('OOMKilled');
    }
  });

  it('у каждой конфигурации есть все три доли разложения', () => {
    for (const b of BUDGETS) {
      expect(new Set(b.parts.map((p) => p.kind)), b.label).toEqual(
        new Set(['heap', 'off-heap', 'other']),
      );
    }
  });
});

describe('график heap во времени · дрейф огибающей', () => {
  /** Нижняя огибающая: значения в точках Major GC. Другого источника у неё нет. */
  const floors = (p: (typeof HEAP_PRESETS)[number]) =>
    p.gc.filter((g) => g.kind === 'major').map((g) => p.points[g.at]);

  it('у «нормы» дрейф ровно нулевой', () => {
    const f = floors(preset('ok'));
    expect(f.length).toBeGreaterThan(1);
    expect(new Set(f).size, `огибающая нормы: ${f.join(', ')}`).toBe(1);
  });

  it('у «утечки» дрейф строго положительный и одинаковый на каждом шаге', () => {
    const f = floors(preset('leak'));
    expect(f.length).toBeGreaterThan(1);
    const steps = f.slice(1).map((v, i) => v - f[i]);
    for (const step of steps) expect(step).toBeGreaterThan(0);
    expect(new Set(steps).size, `шаги: ${steps.join(', ')}`).toBe(1);
  });

  it('пики у обоих почти одинаковы — по ним утечку и не видно', () => {
    // Ради этого пресеты и сделаны: на глаз графики различаются только огибающей.
    const peak = (key: string) => Math.max(...preset(key).points);
    expect(peak('leak') / peak('ok')).toBeLessThan(1.1);
  });

  it('вердикт «нормы» называет то самое число, к которому всё возвращается', () => {
    expect(preset('ok').verdict).toContain(String(floors(preset('ok'))[0]));
  });
});

describe('развилка · столбики не врут о подписанных значениях', () => {
  it('каждый случай меряет ровно те пять полей, что есть в схеме', () => {
    const known = new Set(FIELDS.map((f) => f.key));
    for (const c of CASES) {
      expect(new Set(c.rows.map((r) => r.k)), c.label).toEqual(known);
    }
  });

  it('столбиков столько же, сколько подписей под ними', () => {
    for (const c of CASES) {
      for (const row of c.rows) {
        expect(row.bars, `${c.label} · ${row.k}`).toHaveLength(TRIAGE_STAMPS.length);
      }
    }
  });

  it('высоты лежат в своих границах', () => {
    for (const c of CASES) {
      for (const row of c.rows) {
        for (const bar of row.bars) {
          expect(bar, `${c.label} · ${row.k}`).toBeGreaterThanOrEqual(0);
          expect(bar, `${c.label} · ${row.k}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('отношение крайних столбиков совпадает с отношением подписанных чисел', () => {
    /**
     * То же, что проверяет `tests/unit/chart.test.ts` для осей: столбики, не отвечающие
     * своим числам, врут о соотношении — а именно по соотношению здесь ставится диагноз.
     *
     * Строки, чей первый столбик меньше пяти, сравниваются иначе: там целочисленное
     * округление до 1–2 пунктов даёт разницу в разы на ровном месте. От них требуется
     * только монотонный рост.
     */
    for (const c of CASES) {
      for (const row of c.rows) {
        const ends = row.v.match(/([\d.]+)\s*→\s*([\d.]+)/);
        if (!ends) throw new Error(`значения строки «${row.k}» разобрать не удалось: ${row.v}`);
        const byValue = Number(ends[2]) / Number(ends[1]);
        const first = row.bars[0];
        const last = row.bars[row.bars.length - 1];

        if (first < 5) {
          for (let i = 1; i < row.bars.length; i++) {
            expect(row.bars[i], `${c.label} · ${row.k}`).toBeGreaterThan(row.bars[i - 1]);
          }
          expect(byValue, `${c.label} · ${row.k}`).toBeGreaterThan(1);
          continue;
        }

        const byBars = last / first;
        expect(Math.abs(byBars - byValue) / byValue, `${c.label} · ${row.k}`).toBeLessThan(0.1);
      }
    }
  });

  it('в каждом случае есть растущая строка, и она правда растёт', () => {
    for (const c of CASES) {
      const hot = c.rows.filter((r) => r.hot);
      expect(hot.length, c.label).toBeGreaterThan(0);
      for (const row of hot) {
        const last = row.bars[row.bars.length - 1];
        expect(last / row.bars[0], `${c.label} · ${row.k}`).toBeGreaterThan(1.1);
      }
    }
  });

  it('снимок обещан только там, где растёт куча', () => {
    // Вывод всего раздела: инструмент выбирают по тому, какой контур растёт.
    for (const c of CASES) {
      const heapGrows = c.rows.some((r) => r.hot && r.k === 'heapUsed');
      expect(c.tool.works, c.label).toBe(heapGrows);
    }
  });
});

describe('тонкие места пронумерованы подряд', () => {
  it('номера уникальны и все на месте', () => {
    const numbers = PITFALLS.map((p) => p.n);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers).toEqual(['01', '02', '03', '04', '05']);
  });

  it('у каждого есть и заголовок, и разбор', () => {
    for (const p of PITFALLS) {
      expect(p.t, p.n).toBeTruthy();
      expect(p.d.length, p.n).toBeGreaterThan(80);
    }
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · четыре поля resourceLimits — пример исполняется, как напечатан
// ---------------------------------------------------------------------------

/**
 * Исполняется **та же строка**, что стоит в теме, отдельным процессом из файла `.mjs`
 * (ради верхнеуровневого `await`). Вывод сверяется с WORKER_LIMITS_OUT целиком, кроме одного
 * числа: первый «потолок кучи» — умолчание версии (224 МБ на 24.11, 128 на 26.8). Его
 * тест не берёт литералом, а спрашивает у того же Node: главный поток с
 * `--max-old-space-size=32` обязан получить ровно тот же потолок — это и утверждает текст
 * («прибавляет те же три полупространства»).
 */
describe('resourceLimits · пример с четырьмя полями исполняется, как напечатан', () => {
  // Файлом, а не `-e`: флаг `--input-type=module` воркер наследует через execArgv, и его
  // `eval`-код тоже стал бы модулем — без `require`. Читатель запускает пример файлом так же.
  const dir = mkdtempSync(join(tmpdir(), 'worker-limits-'));
  const file = join(dir, 'limits.mjs');
  writeFileSync(file, WORKER_LIMITS_CODE);
  const out = execFileSync(process.execPath, [file], { encoding: 'utf8' }).trim();
  rmSync(dir, { recursive: true, force: true });
  const mainLimit = heapLimitMb(['--max-old-space-size=32']);

  it('первый потолок — тот же, что у главного потока с тем же старым поколением', () => {
    const first = out.match(/потолок кучи: (\d+) МБ/);
    expect(first).not.toBeNull();
    expect(Number(first?.[1])).toBe(mainLimit);
    expect(mainLimit).toBeGreaterThan(32);
  });

  it('остальной вывод совпадает с напечатанным в теме', () => {
    const norm = (t: string) => t.replace(/потолок кучи: \d+ МБ/, 'потолок кучи: <версия> МБ');
    expect(norm(out)).toBe(norm(WORKER_LIMITS_OUT));
  });

  it('напечатанное число — это Node 26.8, как и подписано', () => {
    expect(WORKER_LIMITS_OUT).toContain('потолок кучи: 128 МБ');
    if (process.versions.node.startsWith('26.')) expect(mainLimit).toBe(128);
  });
});

// ---------------------------------------------------------------------------
// Раздел 2 · системный аллокатор
// ---------------------------------------------------------------------------

describe('аллокатор · проба исполняется, как напечатана', () => {
  const out = execFileSync(process.execPath, ['-e', ALLOCATOR_PROBE], { encoding: 'utf8' }).trim();

  it('печатает версию glibc или честное «не glibc»', () => {
    expect(out).toMatch(/^(\d+\.\d+|не glibc: MALLOC_ARENA_MAX ни на что не влияет)$/);
  });

  it('вне Linux glibc нет — проба обязана это сказать', () => {
    if (process.platform !== 'linux') expect(out).toMatch(/^не glibc/);
  });

  it('таблица арен: лимит N оставляет N − 1 дополнительных арен', () => {
    // Закреплено отношение из замера, а не rss: rss машинозависим и в тексте подписан обстановкой.
    for (const [limit, arenas] of ARENA_ROWS) {
      const n = limit.match(/^`(\d+)`$/);
      if (n) expect(Number(arenas)).toBe(Number(n[1]) - 1);
    }
  });
});
