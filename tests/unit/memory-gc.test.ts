import { execFileSync } from 'node:child_process';
import v8 from 'node:v8';
import { describe, expect, it } from 'vitest';
import {
  CONTEXT_CODE,
  CONTEXT_PROBE,
  CONTEXT_PROBE_OUT,
  EPHEMERON_PROBE,
  EPHEMERON_PROBE_OUT,
  EXPOSE_GC_CODE,
  GC_KEPT_PROBE,
  GC_KEPT_PROBE_OUT,
  GC_YIELD_PROBE,
  GC_YIELD_PROBE_OUT,
  OBSERVABLE_NODE,
  PITFALLS,
  ROOTS,
  SPACES_ROWS,
  USING_BROWSER_CODE,
  USING_CODE,
  USING_COMPONENT_CODE,
  USING_DESUGAR_CODE,
  USING_NODE_CODE,
  USING_NODE_ROWS,
  USING_STACK_CODE,
  WEAK_VS_MAP,
  YOUNG_PROBE,
  YOUNG_PROBE_OUT,
} from '@/content/lessons/memory-gc/data';
import { FLAGS, SEMI_SPACE_NOTE } from '@/content/lessons/node-memory/data';
import { REACH_CASES } from '@/widgets/reachability-lab/model/cases';
import type { Expectation, ReachCaseKey } from '@/widgets/reachability-lab/model/types';

/**
 * Утверждения темы «Память и GC» — запуском, а не по памяти.
 *
 * ⚠️ **Главное ограничение прогона: в процессе `vitest` сборки нет.** `vitest.config.ts`
 * объявляет `environment: 'node'` без `execArgv`, поэтому `globalThis.gc` здесь `undefined`
 * (AGENTS.md, «Память, сборщик и строки»). Всё, что касается сборки, уходит в отдельный
 * процесс — тем же приёмом, что в `tests/unit/elements-kinds.test.ts` и `v8-engine.test.ts`.
 *
 * ⚠️ **И рычаг сам по себе не собирает.** Ни один вызов `gc()`, ни два подряд, ни
 * `gc({ type: 'major', execution: 'sync' })`. Работает единственный порядок — сперва уступить
 * потоку, потом звать сборку, — и ссылку создавать **внутри функции**: переменная в кадре
 * вызывающего держит объект сама. Обе половины рецепта здесь не пересказаны, а исполнены:
 * см. блок «рецепт сборки», где запускается тот же листинг, что напечатан на странице.
 *
 * ⚠️ **Чего здесь нет и почему:**
 *
 *   браузерная ветка стенда  — без рычага сборка вызывается давлением на аллокатор, и автор
 *                              модели измерил её долю: около трети прогонов не собирает ничего,
 *                              причём самый неустойчивый случай — контрольный (`run.ts`,
 *                              комментарий к `DEFAULTS`). Проверка на этом мигала бы, а мигающая
 *                              проверка хуже отсутствующей. Здесь закреплена ветка с `--expose-gc`,
 *                              где модель детерминирована;
 *   момент сборки, поколение — из JS не наблюдаемы вовсе. Заглушкой не подделываются;
 *   объекта, продвижение,
 *   содержимое полусфер
 *   абсолютные мегабайты     — машино- и версиезависимы. Закрепляются отношения и законы,
 *                              из которых числа темы следуют (AGENTS.md, «Как меряют»).
 */

const MB = 1024 ** 2;

/** Сжатие указателей — от него вдвое зависят все размеры молодого поколения. */
const POINTER_COMPRESSION = Boolean(
  (process.config.variables as unknown as Record<string, unknown>).v8_enable_pointer_compression,
);

/** Подпись прогона: без неё сообщение упавшей проверки не даёт понять, где это снято. */
const WHERE = `Node ${process.versions.node} · V8 ${process.versions.v8} · pointer compression ${
  POINTER_COMPRESSION ? 'ВКЛЮЧЕНА' : 'выключена'
}`;

/**
 * Спросить отдельный Node и забрать JSON из последней строки.
 *
 * `--input-type=module` — не украшение: рецепт сборки написан с `await` на верхнем уровне,
 * и без модульного режима он бы просто не разобрался.
 */
function probe<T>(flags: string[], body: string): T {
  const out = execFileSync(process.execPath, [...flags, '--input-type=module', '-e', body], {
    encoding: 'utf8',
    maxBuffer: 64 * MB,
  });
  const last = out.trim().split('\n').at(-1);
  if (!last) throw new Error(`процесс ${flags.join(' ')} не напечатал ничего`);
  return JSON.parse(last) as T;
}

// ---------------------------------------------------------------------------
// Раздел 0 · граница наблюдаемого
// ---------------------------------------------------------------------------

/** Строка таблицы наблюдаемого по инструменту. Пропажа строки обязана падать внятно. */
function observable(tool: string): string[] {
  const found = OBSERVABLE_NODE.filter((row) => row[1] === tool);
  if (found.length !== 1) {
    throw new Error(`строк OBSERVABLE_NODE с «${tool}»: ${found.length}, нужна одна`);
  }
  return found[0];
}

/** Числительные словами: тема называет число пространств словом, а движок — числом. */
const NUMERALS: Record<number, string> = {
  11: 'одиннадцать',
  12: 'двенадцать',
  13: 'тринадцать',
  14: 'четырнадцать',
  15: 'пятнадцать',
  16: 'шестнадцать',
};

describe('0 · что о куче можно спросить у Node', () => {
  const spaces = v8.getHeapSpaceStatistics().map((s) => s.space_name);

  /**
   * ⚠️ Оба утверждения строки — и число, и пропажа `map_space` — держатся на одном замере,
   * и оба ломаются молча: движок сольёт ещё одно пространство, а на странице останется
   * прежнее слово. Само `getHeapSpaceStatistics()` работает прямо здесь: `environment: 'node'`.
   */
  it('пространств столько, сколько названо на странице, и `map_space` среди них нет', () => {
    const row = observable('v8.getHeapSpaceStatistics()');

    const word = NUMERALS[spaces.length];
    if (!word) {
      throw new Error(`пространств ${spaces.length} — числительного для него в тесте нет`);
    }

    expect(row[2], `${WHERE}: пространств ${spaces.length}, а на странице другое слово`).toContain(
      word,
    );
    expect(spaces, 'map_space вернулся — фразу темы надо возвращать обратно').not.toContain(
      'map_space',
    );
    expect(row[2], 'страница обязана называть именно `map_space`').toContain('map_space');
  });

  /**
   * Листинг `EXPOSE_GC_CODE` — две команды с ожидаемым ответом в комментарии. Здесь они
   * разбираются и **исполняются**: флаги и ожидание берутся из той же строки, что видит
   * читатель, поэтому расхождение листинга с движком станет красным тестом.
   */
  it('`--expose-gc` кладёт `globalThis.gc` — обе строки листинга исполнены', () => {
    const lines = [...EXPOSE_GC_CODE.matchAll(/^node\s*(.*?)\s*-e\s*"([^"]+)"\s*#\s*'(\w+)'/gm)];
    expect(lines.length, `разобрать листинг не удалось: ${EXPOSE_GC_CODE}`).toBe(2);

    for (const [, rawFlags, expr, expected] of lines) {
      const flags = rawFlags.split(/\s+/).filter(Boolean);
      const got = execFileSync(process.execPath, [...flags, '-p', expr], {
        encoding: 'utf8',
      }).trim();
      expect(got, `node ${flags.join(' ')} -p "${expr}" · ${WHERE}`).toBe(expected);
    }

    // И сама пара ожиданий: без флага функции нет, с флагом есть. Листинг, где обе строки
    // обещают одно и то же, разобрался бы, но ничего не утверждал.
    expect(lines.map(([, , , expected]) => expected)).toEqual(['undefined', 'function']);
  });
});

// ---------------------------------------------------------------------------
// Раздел 0 · рецепт сборки: gc() сам по себе не собирает
// ---------------------------------------------------------------------------

describe('0 · рецепт сборки · gc() без уступки потоку не собирает', () => {
  /**
   * ⚠️ Исполняется **тот самый листинг**, что напечатан на странице, а не его пересказ.
   * Приём такой: строка режется по той единственной строчке, ради которой она написана, —
   * `await new Promise((r) => setTimeout(r, 0))`. Всё, что выше неё, это программа «три
   * вызова `gc()` подряд»; вся строка целиком — программа «уступили и позвали». Обе
   * дописывают одну строчку печати и больше ничего: править листинг ради теста нельзя,
   * иначе проверялся бы не он.
   */
  const lines = GC_YIELD_PROBE.split('\n');
  const yieldAt = lines.findIndex((line) => line.includes('await new Promise'));

  const ASK = '\nconsole.log(JSON.stringify(ref.deref() === undefined));';
  const withoutYield = lines.slice(0, yieldAt).join('\n') + ASK;
  const withYield = GC_YIELD_PROBE + ASK;

  it('листинг темы содержит обе половины рецепта — иначе резать нечего', () => {
    expect(yieldAt, `строки с уступкой потоку в листинге нет:\n${GC_YIELD_PROBE}`).toBeGreaterThan(0);

    const calls = GC_YIELD_PROBE.match(/gc\(/g) ?? [];
    expect(calls.length, 'до уступки листинг обязан звать сборку несколько раз').toBeGreaterThanOrEqual(3);
    expect(GC_YIELD_PROBE, 'вторая половина рецепта: ссылка рождается внутри функции').toContain(
      'function makeRef()',
    );
    expect(GC_YIELD_PROBE, 'и самый упрямый вызов тоже назван').toContain("type: 'major'");
  });

  it('три вызова `gc()` подряд без уступки потоку не собирают ничего', () => {
    expect(
      probe<boolean>(['--expose-gc'], withoutYield),
      `${WHERE}: объект собрался без уступки потоку — рецепт темы устарел`,
    ).toBe(false);
  });

  it('после уступки потоку тот же объект собирается', () => {
    expect(
      probe<boolean>(['--expose-gc'], withYield),
      `${WHERE}: не собрался даже по рецепту — проверять сборку стало нечем`,
    ).toBe(true);
  });

  it('вывод на странице говорит ровно это', () => {
    // Короткая смысловая подстрока: правка формулировки покраснеет, правка вёрстки — нет.
    expect(GC_YIELD_PROBE_OUT, 'без уступки объект обязан остаться').toMatch(
      /без уступки потоку:\s*ref\.deref\(\) → \{/,
    );
    expect(GC_YIELD_PROBE_OUT, 'после уступки — undefined').toMatch(
      /после setTimeout\(0\):\s*ref\.deref\(\) → undefined/,
    );
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · стенд достижимости: семь случаев под рычагом gc()
// ---------------------------------------------------------------------------

/** Что стенд наблюдал. Полей ровно столько, сколько нужно проверке. */
interface ReachObserved {
  ok: boolean;
  collected: boolean;
  extraCollected: boolean | null;
  attempts: number;
  lever: boolean;
  finalized: boolean;
  finalizerSupported: boolean;
  verdict: string;
}

/**
 * ⚠️ **Семь ожиданий записаны здесь литералом, а не взяты из модели.** Вести их из
 * `REACH_CASES[].expects` было бы удобно и бессмысленно: перевёрнутое в `cases.ts` ожидание
 * тест бы послушно повторил, и проверка перестала бы что-либо гарантировать. Литерал —
 * это утверждение темы; ниже оно сверяется и с моделью, и с движком.
 */
const EXPECTED: Record<ReachCaseKey, Expectation> = {
  none: 'collected',
  variable: 'held',
  map: 'held',
  'weakmap-key': 'collected',
  'weakmap-value': 'held',
  'ephemeron-cycle': 'collected',
  listener: 'held',
};

const REACH_KEYS = Object.keys(EXPECTED) as ReachCaseKey[];

/**
 * Прогнать все семь случаев в одном отдельном процессе с `--expose-gc`.
 *
 * ⚠️ **Модель написана на TypeScript, а её надо исполнить в чужом процессе.** Снятие типов
 * в Node есть, а разрешения расширений у ESM нет: `import './cases'` из `run.ts` падает
 * с `ERR_MODULE_NOT_FOUND`. Поэтому в дочернем процессе ставится крошечный хук резолвера —
 * он дописывает `.ts` относительным путям без расширения. Ничего, кроме расширения, хук
 * не делает: модель исполняется ровно та, которую импортирует остров.
 *
 * ⚠️ Попыток восемь, а не 60 из `DEFAULTS`: 60 подобраны для браузера, где рычага нет
 * и остаётся давить и ждать. Под рычагом собираемые случаи собираются с первой попытки —
 * восемь нужны только затем, чтобы «не собрался» у держащих случаев что-то значило.
 */
function runReachAll(): Record<ReachCaseKey, ReachObserved> {
  const model = new URL('../../src/widgets/reachability-lab/model/run.ts', import.meta.url).href;

  return probe<Record<ReachCaseKey, ReachObserved>>(
    ['--expose-gc'],
    `
    import { registerHooks } from 'node:module';

    registerHooks({
      resolve(spec, ctx, next) {
        const bare = /^[.]{1,2}[/]/.test(spec) && !/[.][cm]?[jt]s$/.test(spec);
        return next(bare ? spec + '.ts' : spec, ctx);
      },
    });

    const run = await import(${JSON.stringify(model)});
    const out = {};

    for (const key of ${JSON.stringify(REACH_KEYS)}) {
      const r = await run.runReachCase(key, { attempts: 8, budgetMs: 20000 });
      out[key] = {
        ok: r.ok,
        collected: r.collected,
        extraCollected: r.extraCollected,
        attempts: r.attempts,
        lever: r.lever,
        finalized: r.finalized,
        finalizerSupported: r.finalizerSupported,
        verdict: r.verdict,
      };
    }

    console.log(JSON.stringify(out));
    `,
  );
}

describe('4 · достижимость · семь случаев под рычагом gc()', () => {
  const observed = runReachAll();

  /**
   * ⚠️ Сторож всего блока, и он идёт первым. Если рычага в дочернем процессе не оказалось,
   * стенд молча переходит на браузерную ветку — давление и ожидание, — где треть прогонов
   * не собирает ничего. Тогда «собран» ниже стал бы броском монеты, а не наблюдением.
   */
  it('рычаг сборки доехал до модели, и `WeakRef` в среде есть', () => {
    for (const key of REACH_KEYS) {
      expect(observed[key].lever, `${key}: gc() до модели не доехал, прогон недетерминирован`).toBe(
        true,
      );
      expect(observed[key].ok, `${key}: без WeakRef наблюдать сборку нечем`).toBe(true);
    }
  });

  /**
   * Второй сторож: контрольный случай. Не собрался он — не работает само давление, и всем
   * остальным шести ответам верить нельзя (`REACH_CASES[0].why` говорит ровно это).
   */
  it('контрольный случай собирается — значит стенду есть чем мерить', () => {
    expect(
      observed.none.collected,
      `${WHERE}: «никто не держит» не собрался (${observed.none.verdict})`,
    ).toBe(true);
  });

  it('модель описывает ровно те семь случаев, что утверждает тема', () => {
    expect(REACH_CASES.map((c) => c.key).sort()).toEqual([...REACH_KEYS].sort());

    for (const spec of REACH_CASES) {
      expect(spec.expects, `«${spec.label}»: ожидание в модели разошлось с темой`).toBe(
        EXPECTED[spec.key],
      );
    }
  });

  for (const key of REACH_KEYS) {
    const spec = REACH_CASES.find((c) => c.key === key)!;
    const mustCollect = EXPECTED[key] === 'collected';

    it(`${spec.label} → ${mustCollect ? 'собран' : 'держат'}`, () => {
      expect(
        observed[key].collected,
        `${spec.title} · держатель: ${spec.holder} · ${observed[key].verdict} · ${WHERE}`,
      ).toBe(mustCollect);
    });
  }

  /**
   * ⚠️ ГЛАВНАЯ ПРАВКА ТЕМЫ ПРОТИВ ОРИГИНАЛА, и потому она закреплена отдельно и строже.
   *
   * Оригинал объявлял этот случай утечкой: «цикл, слабая ссылка его не разрывает». Цикла
   * здесь нет — есть эфемерон: по ECMA-262 запись WeakMap сохраняется тогда и только тогда,
   * когда ключ достижим **иначе**, чем через саму эту запись. Поэтому под наблюдением два
   * узла, и собраться обязаны **оба**: собранный ключ при живом значении списался бы на
   * случайность, а вместе они и есть утверждение темы.
   */
  it('эфемерон · значение ссылается на свой ключ — собирается пара целиком', () => {
    const cycle = observed['ephemeron-cycle'];

    expect(cycle.collected, `ключ не собран: ${cycle.verdict} · ${WHERE}`).toBe(true);
    expect(
      cycle.extraCollected,
      'значение записи осталось живо — тогда через него достижим и ключ, и правка темы неверна',
    ).toBe(true);

    // Второй узел обязан существовать: без него проверка выше сверяла бы `null` с `null`.
    const spec = REACH_CASES.find((c) => c.key === 'ephemeron-cycle')!;
    expect(spec.code, 'исходник случая обязан показывать вторую слабую ссылку').toContain(
      'valueRef',
    );
  });

  /**
   * Инвариант, не зависящий от расторопности реестра: финализатор может не прийти никогда
   * (это записано в `FR_CAVEATS` и проверять обратное нельзя), но прийти по **живому**
   * объекту он не может. Сработал — значит объект собран.
   */
  it('финализатор не срабатывает по объекту, который не собран', () => {
    for (const key of REACH_KEYS) {
      const r = observed[key];
      if (r.finalized) {
        expect(r.collected, `${key}: финализатор пришёл, а объект числится живым`).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Раздел 1 · молодое поколение
// ---------------------------------------------------------------------------

/**
 * Пик `new_space` под давлением, МБ, плюс размер при старте процесса.
 *
 * ⚠️ **Читать `new_space` сразу после старта, как это делает `YOUNG_PROBE`, на нынешнем
 * движке недостаточно.** Пространство растёт от маленького стартового размера по мере того,
 * как растёт доля выживших (так и написано в самой теме), и при старте видно доли мегабайта,
 * а не потолок. Поэтому стенд сперва давит на аллокатор и берёт максимум наблюдённого.
 */
function newSpace(flags: string[]): { start: number; peak: number } {
  return probe<{ start: number; peak: number }>(
    flags,
    `
    import v8 from 'node:v8';

    const mb = () =>
      v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space').space_size / 1048576;

    const start = mb();
    let peak = start;
    let sink = 0;

    for (let i = 0; i < 300; i++) {
      const block = new Array(20000);
      for (let j = 0; j < 20000; j++) block[j] = { j, pad: j * 2 };
      sink += block.length;
      peak = Math.max(peak, mb());
    }

    console.log(JSON.stringify({ start, peak, sink: sink > 0 }));
    `,
  );
}

describe('1 · молодое поколение · new_space против --max-semi-space-size', () => {
  /**
   * ⚠️ **Закрепляется отношение, а не мегабайты.** «128 МБ» темы сняты на Node 24.11 без
   * сжатия указателей; умолчание движка с тех пор изменилось, и дословная сверка краснела бы
   * от смены версии, а не от ошибки. Отношение «полупространств два» от версии не зависит,
   * и именно оно делает число темы понятным.
   */
  const stated = [...YOUNG_PROBE_OUT.matchAll(/--max-semi-space-size=(\d+)\s+→ new_space (\d+) МБ/g)].map(
    ([, flag, size]) => ({ flag: Number(flag), size: Number(size) }),
  );

  it('в выводе темы есть примеры с явным размером полупространства', () => {
    expect(stated.length, `примеров с --max-semi-space-size в YOUNG_PROBE_OUT нет:\n${YOUNG_PROBE_OUT}`)
      .toBeGreaterThanOrEqual(2);
  });

  for (const { flag, size } of stated) {
    it(`--max-semi-space-size=${flag} → new_space ${size} МБ, вдвое больше флага`, () => {
      // Сперва арифметика самой строки: «2 × N» в ней написано, и оно обязано сходиться.
      expect(size, `строка темы обещает ${size} МБ при полупространстве ${flag} МБ`).toBe(2 * flag);

      // А теперь то же число у движка — это и есть замер, а не пересказ.
      const { start, peak } = newSpace([`--max-semi-space-size=${flag}`]);
      expect(peak, `${WHERE}: пик new_space разошёлся с выводом темы`).toBe(2 * flag);
      expect(
        start,
        'при старте видно потолок — тогда YOUNG_PROBE можно читать буквально, и оговорку ниже надо снять',
      ).toBeLessThan(peak);
    });
  }

  it('замер темы снят командой, которая читает именно new_space', () => {
    // Сторож против подмены инструмента: числа выше относятся к тому, чем тема их получала.
    expect(YOUNG_PROBE).toContain('getHeapSpaceStatistics');
    expect(YOUNG_PROBE).toMatch(/new/);
  });

  /**
   * Три литерала одного и того же размера полупространства: строка `new_space` в таблице
   * пространств, подпись под выводом и разложение слагаемого к `heap_size_limit`. Правит их
   * разный человек в разное время — разъехаться они могут молча.
   */
  it('таблица пространств и вывод замера называют одно и то же полупространство', () => {
    const row = SPACES_ROWS.find((r) => r[0] === 'new_space');
    if (!row) throw new Error('строки new_space в SPACES_ROWS нет — проверка без предмета');

    const inTable = row[2].match(/пик (\d+) МБ = 2 × (\d+) МБ/);
    if (!inTable) throw new Error(`замер в строке new_space не разобрался: ${row[2]}`);
    expect(Number(inTable[1]), 'в самой строке таблицы «пик» не равен двум полупространствам').toBe(
      2 * Number(inTable[2]),
    );

    const inProbe = YOUNG_PROBE_OUT.match(/new_space (\d+) МБ[\s\S]*?по (\d+) МБ/);
    if (!inProbe) throw new Error(`вывод замера не разобрался:\n${YOUNG_PROBE_OUT}`);
    expect(Number(inProbe[1]), 'в выводе замера «пик» не равен двум полупространствам').toBe(
      2 * Number(inProbe[2]),
    );

    expect(Number(inTable[2]), 'таблица и вывод замера разошлись в размере полупространства').toBe(
      Number(inProbe[2]),
    );
  });
});

// ---------------------------------------------------------------------------
// Раздел 1 · потолок кучи
// ---------------------------------------------------------------------------

/** `heap_size_limit` процесса с данными флагами, МБ. */
function heapLimitMb(flags: string[]): number {
  return probe<number>(
    flags,
    "import v8 from 'node:v8';\nconsole.log(JSON.stringify(v8.getHeapStatistics().heap_size_limit / 1048576));",
  );
}

describe('1 · потолок кучи · heap_size_limit минус --max-old-space-size', () => {
  const OLD_SPACE = [32, 256, 2048];
  const limits = OLD_SPACE.map((mb) => heapLimitMb([`--max-old-space-size=${mb}`]));
  const diffs = limits.map((limit, i) => limit - OLD_SPACE[i]);

  /**
   * ⚠️ **Величина слагаемого в тест не идёт, и это не осторожность, а находка.** Тема
   * называет 192 МБ (Node 24.11); на этом прогоне слагаемое другое — умолчание предельного
   * размера полупространства между версиями уменьшилось вдвое. Закрепляется то, что от
   * версии не зависит: постоянство разницы, её монотонность и закон, из которого она следует.
   */
  it('слагаемое одно и то же на всём диапазоне флага', () => {
    expect(new Set(diffs).size, `${WHERE}: разницы разошлись — ${diffs.join(', ')}`).toBe(1);
  });

  it('потолок всегда выше самого флага и растёт вместе с ним', () => {
    for (const [i, diff] of diffs.entries()) {
      expect(diff, `--max-old-space-size=${OLD_SPACE[i]}`).toBeGreaterThan(0);
    }
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i], `${OLD_SPACE[i]} против ${OLD_SPACE[i - 1]}`).toBeGreaterThan(limits[i - 1]);
    }
  });

  /**
   * Тот самый закон, из которого следует и 192 МБ темы, и другое число на другой сборке:
   * разница равна **трём** полупространствам (третье нужно под эвакуацию). Проверяется
   * прямым заданием размера — тогда закон виден без всяких умолчаний.
   */
  it('слагаемое — ровно три размера полупространства', () => {
    for (const semi of [16, 32, 64]) {
      const limit = heapLimitMb([`--max-semi-space-size=${semi}`, '--max-old-space-size=256']);
      expect(limit - 256, `--max-semi-space-size=${semi} · ${WHERE}`).toBe(3 * semi);
    }
  });

  it('и умолчание этой машины тоже делится на три', () => {
    expect(diffs[0] % 3, `${WHERE}: слагаемое ${diffs[0]} не делится на три полупространства`).toBe(
      0,
    );
  });

  /**
   * ⚠️ **Одно число независимо записано в двух темах**, и разъехаться они могут молча:
   * «Память и GC» печатает его в выводе замера, «Память в Node» — в шпаргалке флагов
   * и в подписи под ней. Проверка сверяет литералы друг с другом, а не с движком: величина
   * версиезависима (см. выше), а вот согласованность тем — нет.
   *
   * Близнец этой проверки стоит в `tests/unit/node-memory.test.ts` и смотрит с той стороны.
   * Здесь она нужна затем, чтобы правка **этой** темы краснела в тесте **этой** темы.
   */
  it('обе темы называют одно и то же слагаемое', () => {
    const own = [...YOUNG_PROBE_OUT.matchAll(/--max-old-space-size=(\d+)\s+→ heap_size_limit (\d+) МБ/g)]
      .map(([, from, to]) => Number(to) - Number(from));
    expect(own.length, `примеров с heap_size_limit в YOUNG_PROBE_OUT нет:\n${YOUNG_PROBE_OUT}`)
      .toBeGreaterThanOrEqual(2);
    expect(new Set(own).size, `внутри самой темы слагаемые разошлись: ${own.join(', ')}`).toBe(1);
    const addend = own[0];

    // Разложение «3 × полупространство», которым это слагаемое в теме и объяснено.
    const factored = YOUNG_PROBE_OUT.match(/3 × (\d+)/);
    if (!factored) throw new Error('разложения «3 × полупространство» в YOUNG_PROBE_OUT нет');
    expect(3 * Number(factored[1]), 'слагаемое темы не равно трём её же полупространствам').toBe(
      addend,
    );

    // Теперь та же величина из соседней темы: шпаргалка флагов.
    const flagRow = FLAGS.find((f) => f.flag.includes('--max-old-space-size'));
    if (!flagRow) throw new Error('строки --max-old-space-size в FLAGS нет');
    const stated = flagRow.what.match(/ровно на (\d+) МБ больше флага/);
    if (!stated) throw new Error(`слагаемое в шпаргалке флагов не найдено: ${flagRow.what}`);
    expect(Number(stated[1]), '«Память и GC» и «Память в Node» разошлись в слагаемом').toBe(addend);

    // И подпись под шпаргалкой — третий независимый литерал того же числа.
    const inNote = SEMI_SPACE_NOTE.match(/\+(\d+) МБ/);
    if (!inNote) throw new Error(`слагаемое в SEMI_SPACE_NOTE не найдено: ${SEMI_SPACE_NOTE}`);
    expect(Number(inNote[1]), 'подпись под шпаргалкой разошлась с обеими темами').toBe(addend);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · WeakMap и ключи-примитивы
// ---------------------------------------------------------------------------

describe('4 · ключ WeakMap · что движок принимает, а что отвергает', () => {
  /**
   * ⚠️ **Имя ошибки нормативно, текст — нет** (AGENTS.md). Поэтому наружу идёт `e.name`,
   * а дословное сообщение V8 не проверяется ни здесь, ни в данных.
   */
  const accept = (key: unknown): string => {
    try {
      new WeakMap().set(key as object, 1);
      return 'ok';
    } catch (e) {
      return (e as Error).name;
    }
  };

  /**
   * Строка «Ключ-примитив» — правка против расхожего «только объекты»: с ES2023 ключом
   * WeakMap может быть **незарегистрированный** символ. Зарегистрированный (`Symbol.for`)
   * живёт в глобальном реестре, то есть достижим всегда, и слабой ссылки на него быть
   * не может — отсюда и отказ.
   */
  it('незарегистрированный `Symbol()` — допустимый ключ, остальные примитивы нет', () => {
    expect(accept(Symbol('ключ')), `${WHERE}: Symbol() перестал быть ключом`).toBe('ok');
    expect(accept(Symbol.for('ключ')), 'Symbol.for живёт в глобальном реестре').toBe('TypeError');
    expect(accept('ключ'), 'строка').toBe('TypeError');
    expect(accept(42), 'число').toBe('TypeError');
  });

  it('а обычной Map примитив ключом годится — вторая колонка строки', () => {
    // Без этого «можно» в соседней колонке было бы украшением, а не утверждением.
    expect(new Map().set('ключ', 1).get('ключ')).toBe(1);
    expect(new Map().set(42, 1).get(42)).toBe(1);
  });

  /**
   * ⚠️ Сверка прозы с движком связывает текст и тест — приём законный, но подстроки берутся
   * короткие и смысловые: именно ради них правка делалась. Правка вёрстки строки тест
   * не покрасит, возврат формулировки «только объекты» — покрасит.
   */
  it('строка таблицы называет ровно тот расклад, что показал движок', () => {
    const row = WEAK_VS_MAP.find((r) => r[0] === 'Ключ-примитив');
    if (!row) throw new Error('строки «Ключ-примитив» в WEAK_VS_MAP нет — проверка без предмета');

    expect(row[1], 'допущение символа — это и есть правка строки').toContain(
      'только незарегистрированный',
    );
    expect(row[1], 'запрет обязан быть назван поимённо').toContain('Symbol.for');
    expect(row[1], 'и строка с числом тоже').toMatch(/строка, число/);
    expect(row[2], 'у обычной Map ограничения нет').toBe('можно');
  });
});

// ---------------------------------------------------------------------------
// Раздел 5 · тонкое место 04
// ---------------------------------------------------------------------------

describe('5 · тонкое место 04 · delete и словарный режим', () => {
  const pitfall = PITFALLS.find((p) => p.n === '04');

  /**
   * ⚠️ **Сторож против возвращения неверной формулировки.** В теме стояло: «если удаляют
   * ПОСЛЕДНЕЕ добавленное свойство, V8 умеет откатить форму на шаг назад по дереву —
   * словаря не будет». Запуском это не подтвердилось, и утверждение снято.
   *
   * ⚠️ **Механику здесь не дублируем.** `%HasFastProperties` и `%HaveSameMap` уже опрошены
   * в `tests/unit/v8-engine.test.ts` (блок «словарный режим · `delete` и его цена»): и с конца,
   * и из середины объект уходит в словарь, форма назад по дереву не откатывается,
   * а `obj.prop = undefined` форму сохраняет. Перепроверено при написании этого теста на
   * Node 26.8 — ответы те же. Здесь проверяется другое: что **текст этой темы** не обещает
   * исключения снова и что он отсылает туда, где это закреплено запуском.
   */
  it('текст не обещает отката формы для последнего добавленного свойства', () => {
    if (!pitfall) throw new Error('тонкого места 04 в PITFALLS нет — проверка осталась без предмета');

    expect(pitfall.t, 'заголовок обязан говорить про словарный режим').toContain('dictionary mode');

    for (const wrong of ['умеет откатить', 'словаря не будет', 'на шаг назад']) {
      expect(pitfall.d, `формулировка «${wrong}» вернулась — а движок так не делает`).not.toContain(
        wrong,
      );
    }

    // Смысл, а не оборот: «исключений нет» (2026-10-01 снято «тоже» — не к чему было его относить).
    expect(pitfall.d, 'отказ от исключения назван прямо').toMatch(/[Ии]сключений нет/);
    expect(pitfall.d, 'и сказано, что происходит вместо отката').toContain('не происходит');
    expect(pitfall.d, 'последнее свойство названо поимённо — иначе сторож мимо предмета').toMatch(
      /последне(е|го) добавленно(е|го) свойств/,
    );
    expect(pitfall.d, 'и есть ссылка туда, где это закреплено запуском').toContain('/js/v8-engine/');
  });
});

// ---------------------------------------------------------------------------
// Проход 2026-10-01: листинги темы исполняются, а не пересказываются
// ---------------------------------------------------------------------------

/** Код из листинга вида `node <флаги> -e "…"` — то, что стоит между кавычками. */
function inlineScript(listing: string): string {
  const m = listing.match(/-e "([\s\S]*)"\s*$/);
  if (!m) throw new Error(`не разобрать листинг вида node -e "…":\n${listing}`);
  return m[1];
}

/** Запуск обычного (не модульного) скрипта с флагами — сырой вывод. */
function runScript(flags: string[], code: string): string {
  return execFileSync(process.execPath, [...flags, '-e', code], { encoding: 'utf8', maxBuffer: 64 * MB });
}

describe('0 · KeptObjects · листинг `GC_KEPT_PROBE` и соседние прогоны', () => {
  it('тот же `gc()` собирает объект без `WeakRef` и не собирает цель `WeakRef`', () => {
    const fired = probe<string[]>(['--expose-gc'], `${GC_KEPT_PROBE}\nconsole.log(JSON.stringify(fired));`);
    expect(fired, WHERE).toEqual(['без WeakRef']);
    expect(GC_KEPT_PROBE_OUT).toMatch(/«без WeakRef»: да/);
    expect(GC_KEPT_PROBE_OUT).toMatch(/«с WeakRef»:\s+нет/);
  }, 30_000);

  /**
   * Четыре строки вывода — соседние прогоны, их исходника на странице нет. Каждый собран здесь
   * из одного шаблона, и ответ сверяется со строкой вывода по её началу.
   */
  const VARIANTS: { line: string; pause: string; derefFirst: boolean }[] = [
    { line: 'WeakRef из прошлой задачи', pause: 'await new Promise((r) => setTimeout(r, 0));', derefFirst: false },
    { line: 'то же, но перед gc() вызван deref()', pause: 'await new Promise((r) => setTimeout(r, 0));', derefFirst: true },
    { line: 'две микрозадачи вместо setTimeout', pause: 'await Promise.resolve(); await Promise.resolve();', derefFirst: false },
    { line: 'setImmediate вместо setTimeout', pause: 'await new Promise((r) => setImmediate(r));', derefFirst: false },
  ];

  for (const v of VARIANTS) {
    it(`«${v.line}» — ответ движка совпадает со строкой вывода`, () => {
      const row = GC_KEPT_PROBE_OUT.split('\n').find((l) => l.startsWith(v.line));
      if (!row) throw new Error(`строки «${v.line}» в GC_KEPT_PROBE_OUT нет`);
      const stated = /→ собран\s*$/.test(row);

      const collected = probe<boolean>(
        ['--expose-gc'],
        `function makeRef() { return new WeakRef({ big: new Array(1e5).fill(0) }); }
        const ref = makeRef();
        ${v.pause}
        ${v.derefFirst ? 'ref.deref();' : ''}
        globalThis.gc();
        console.log(JSON.stringify(ref.deref() === undefined));`,
      );
      expect(collected, `${v.line} · ${WHERE}`).toBe(stated);
    }, 30_000);
  }
});

describe('0 · корни · async-функция на `await` держится промисом, а не стеком', () => {
  /**
   * Карточка «стек и регистры» прежде говорила «зависший await держит их все». Запуск
   * (Node 24.11 и 26.8) показал иное: замершую функцию держит промис, которого она ждёт,
   * и если до промиса не дотянуться, функция собирается вместе со своими переменными.
   */
  it('недостижимый промис собирается вместе с переменными функции, удерживаемый — нет', () => {
    const fired = probe<string[]>(
      ['--expose-gc'],
      `const fired = [];
      const reg = new FinalizationRegistry((t) => fired.push(t));
      const held = [];
      async function lost() {
        const big = { arr: new Array(1e5).fill(0) };
        reg.register(big, 'lost');
        await new Promise(() => {});
        return big.arr.length;
      }
      async function kept() {
        const big = { arr: new Array(1e5).fill(0) };
        reg.register(big, 'kept');
        await new Promise((r) => held.push(r));
        return big.arr.length;
      }
      lost(); kept();
      await new Promise((r) => setTimeout(r, 0));
      gc();
      await new Promise((r) => setTimeout(r, 0));
      console.log(JSON.stringify(fired));`,
    );
    expect(fired, WHERE).toEqual(['lost']);

    const stack = ROOTS.find((r) => r.k === 'стек и регистры');
    if (!stack) throw new Error('карточки «стек и регистры» в ROOTS нет');
    expect(stack.d, 'прежняя формулировка вернулась').not.toMatch(/зависший await держит их все/);
    expect(stack.d, 'держатель назван').toMatch(/держит промис/);
  }, 30_000);
});

describe('0 · `gc()` по таймеру утечку не прячет', () => {
  it('после принудительной сборки минимум растёт на каждом цикле утечки', () => {
    const mins = probe<number[]>(
      ['--expose-gc'],
      `const leak = [], mins = [];
      for (let k = 0; k < 5; k++) {
        for (let i = 0; i < 1e5; i++) leak.push({ i });
        for (let i = 0; i < 1e5; i++) ({ g: i });
        await new Promise((r) => setTimeout(r, 0));
        gc();
        mins.push(process.memoryUsage().heapUsed);
      }
      console.log(JSON.stringify(mins));`,
    );
    for (let i = 1; i < mins.length; i++) {
      expect(mins[i], `цикл ${i}: минимум не вырос · ${WHERE}`).toBeGreaterThan(mins[i - 1]);
    }
  }, 30_000);

  it('и `heapUsed` после освобождения падает в разы — строка таблицы наблюдаемого', () => {
    const row = observable('process.memoryUsage().heapUsed');
    const stated = row[2].match(/([\d.]+) МБ[^\d]+([\d.]+) МБ/);
    if (!stated) throw new Error(`чисел в строке heapUsed нет: ${row[2]}`);
    expect(Number(stated[1]) / Number(stated[2]), 'на странице падение меньше двух раз').toBeGreaterThan(2);

    const [before, after] = probe<[number, number]>(
      ['--expose-gc'],
      `let rows = Array.from({ length: 2e5 }, (_, i) => ({ i }));
      const before = process.memoryUsage().heapUsed;
      rows = null;
      await new Promise((r) => setTimeout(r, 0));
      gc();
      console.log(JSON.stringify([before, process.memoryUsage().heapUsed]));`,
    );
    expect(before / after, `${WHERE}: ${before} → ${after}`).toBeGreaterThan(2);
  }, 30_000);
});

describe('1 · `YOUNG_PROBE` · пик new_space равен двум полупространствам умолчания', () => {
  /**
   * ⚠️ Прежний листинг читал `new_space` сразу после старта и на деле печатал 0.5–1 МБ,
   * а вывод на странице обещал 128. Теперь листинг набирает выживших и берёт пик; здесь он
   * исполняется дословно, а пик сверяется с законом: полупространство умолчания — треть
   * разницы `heap_size_limit` и `--max-old-space-size`.
   */
  /**
   * ⚠️ Рост молодого поколения — эвристика V8: на Node 26.8 два прогона из двенадцати
   * останавливались ниже потолка (это сказано и в выводе на странице). Поэтому листингу дано
   * до трёх попыток, и проверяется, что потолок **достигается** и не превышается.
   */
  it('исполненный листинг доходит ровно до 2 × полупространство этой сборки', () => {
    const semi = (heapLimitMb(['--max-old-space-size=256']) - 256) / 3;
    const peaks: number[] = [];
    for (let attempt = 0; attempt < 3 && !peaks.includes(2 * semi); attempt++) {
      const out = runScript([], inlineScript(YOUNG_PROBE));
      const got = out.match(/new_space ([\d.]+) МБ/);
      if (!got) throw new Error(`листинг не напечатал new_space:\n${out}`);
      peaks.push(Number(got[1]));
    }
    expect(peaks, `${WHERE}: пики ${peaks.join(', ')} против 2 × ${semi}`).toContain(2 * semi);
    expect(Math.max(...peaks), 'пик выше двух полупространств — закон темы неверен').toBe(2 * semi);
  }, 120_000);
});

describe('3 · Context · листинги `CONTEXT_PROBE` и `CONTEXT_CODE`', () => {
  const slots = (code: string): number => {
    const out = runScript(['--allow-natives-syntax'], code);
    const m = out.match(/- context: 0x[0-9a-f]+ <FunctionContext\[(\d+)\]>/);
    if (!m) throw new Error(`%DebugPrint не показал context:\n${out.slice(0, 400)}`);
    return Number(m[1]);
  };

  it('слотов четыре, а без второй стрелки — три, как написано в выводе', () => {
    const code = inlineScript(CONTEXT_PROBE);
    expect(slots(code), WHERE).toBe(4);
    expect(CONTEXT_PROBE_OUT).toContain('FunctionContext[4]');

    const second = ', () => huge.length';
    expect(code, 'второй стрелки в листинге нет — вариант «без неё» не собрать').toContain(second);
    expect(slots(code.replace(second, '')), WHERE).toBe(3);
    expect(CONTEXT_PROBE_OUT).toContain('FunctionContext[3]');
  }, 30_000);

  /**
   * `CONTEXT_CODE` исполняется с одной добавленной строкой — регистрацией `huge` в реестре:
   * иначе сборку массива увидеть нечем. Остальное — дословно листинг.
   */
  it('`huge` жив, пока жив `keepSmall`, и собирается, когда его потеряли', () => {
    const anchor = /(const huge = [^\n]+;)/;
    expect(CONTEXT_CODE, 'строки с huge в листинге нет').toMatch(anchor);
    const listing = CONTEXT_CODE.replace(anchor, "$1 reg.register(huge, 'huge');");

    const [whileAlive, afterDrop] = probe<[boolean, boolean]>(
      ['--expose-gc'],
      `const fired = [];
      const reg = new FinalizationRegistry((t) => fired.push(t));
      ${listing}
      let k = make();
      const tick = () => new Promise((r) => setTimeout(r, 0));
      await tick(); gc(); await tick();
      const whileAlive = fired.includes('huge');
      k = null;
      await tick(); gc(); await tick();
      console.log(JSON.stringify([whileAlive, fired.includes('huge')]));`,
    );
    expect(whileAlive, `${WHERE}: huge собрался при живом keepSmall`).toBe(false);
    expect(afterDrop, `${WHERE}: huge не собрался и без keepSmall`).toBe(true);
  }, 30_000);
});

describe('4 · эфемерон · листинг `EPHEMERON_PROBE`', () => {
  it('исполненный листинг даёт ровно те ответы, что напечатаны под ним', () => {
    const out = execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', EPHEMERON_PROBE], {
      encoding: 'utf8',
    });
    const got = Object.fromEntries([...out.matchAll(/^(\S+) (true|false)$/gm)].map(([, k, v]) => [k, v]));
    const stated = Object.fromEntries(
      [...EPHEMERON_PROBE_OUT.matchAll(/^(\S+) (true|false)\b/gm)].map(([, k, v]) => [k, v]),
    );
    expect(Object.keys(stated).sort(), 'вывод на странице разобрался не весь').toEqual([
      'cycle-only',
      'plain',
      'value-held',
    ]);
    expect(got, WHERE).toEqual(stated);
    // Смысл правки темы: цикл значение → ключ собирается, удерживаемое значение — нет.
    expect(stated['cycle-only']).toBe('true');
    expect(stated['value-held']).toBe('false');
  }, 30_000);

  /** Непрямой путь `value.parent.children[0] === key` — на него ссылается проза раздела. */
  it('непрямой путь к ключу ведёт себя так же, как прямой', () => {
    const r = probe<{ alone: boolean; parentHeld: boolean }>(
      ['--expose-gc'],
      `const wm = new WeakMap(), fired = new Set();
      const reg = new FinalizationRegistry((t) => fired.add(t));
      const held = [];
      function entry(hold) {
        const key = {}; const parent = { children: [key] };
        wm.set(key, { parent });
        if (hold) held.push(parent);
        reg.register(key, hold ? 'held' : 'alone');
      }
      entry(false); entry(true);
      await new Promise((r) => setTimeout(r, 0)); gc(); await new Promise((r) => setTimeout(r, 0));
      console.log(JSON.stringify({ alone: fired.has('alone'), parentHeld: fired.has('held') }));`,
    );
    expect(r, WHERE).toEqual({ alone: true, parentHeld: false });
  }, 30_000);
});

describe('5 · тонкое место 04 · словарный объект тяжелее', () => {
  /**
   * Числа «около 65 байт против 480» — Node 24.11 и 26.8 без сжатия указателей. Абсолют
   * машинозависим, поэтому закрепляется отношение: замер и страница называют одно и то же
   * «во сколько раз», с допуском в треть.
   */
  it('отношение «после delete / до» на странице совпадает с движком', () => {
    const pitfall = PITFALLS.find((p) => p.n === '04');
    if (!pitfall) throw new Error('тонкого места 04 нет');
    const m = pitfall.d.match(/около (\d+) байт[^]*?около (\d+)/);
    if (!m) throw new Error(`чисел в тонком месте 04 нет: ${pitfall.d}`);
    const statedRatio = Number(m[2]) / Number(m[1]);

    const [fast, dict] = probe<[number, number]>(
      ['--expose-gc'],
      `const tick = () => new Promise((r) => setTimeout(r, 0));
      async function perObject(make) {
        await tick(); gc();
        const a = process.memoryUsage().heapUsed;
        const arr = [];
        for (let i = 0; i < 1e5; i++) arr.push(make(i));
        await tick(); gc();
        const b = process.memoryUsage().heapUsed;
        return (b - a) / arr.length;
      }
      const fast = await perObject((i) => ({ a: i, b: i, c: i, d: i }));
      const dict = await perObject((i) => { const x = { a: i, b: i, c: i, d: i }; delete x.d; return x; });
      console.log(JSON.stringify([fast, dict]));`,
    );
    const ratio = dict / fast;
    expect(ratio, `${WHERE}: ${fast.toFixed(0)} → ${dict.toFixed(0)} байт`).toBeGreaterThan(statedRatio * 0.67);
    expect(ratio, `${WHERE}: ${fast.toFixed(0)} → ${dict.toFixed(0)} байт`).toBeLessThan(statedRatio * 1.5);
  }, 30_000);
});

/** Исполнить листинг и вернуть его объявления. Перевод строки обязателен: листинг может кончаться комментарием. */
function исполнить<T>(code: string, names: string[], params: Record<string, unknown> = {}): T {
  const keys = Object.keys(params);
  return new Function(...keys, '"use strict";' + code + `\n; return { ${names.join(', ')} };`)(
    ...keys.map((k) => params[k]),
  ) as T;
}

describe('5 · using · листинги раздела и утверждения карточек', () => {
  it('пример: обратный порядок, и генератор закрыт на выходе из блока', () => {
    const r = исполнить<{ log: string[]; work(): string; firstLine(): string }>(USING_CODE, ['log', 'work', 'firstLine']);
    // сам пример уже позвал work() и firstLine() по разу
    expect(r.log).toEqual(['открыт a', 'открыт b', 'работа', 'закрыт b', 'закрыт a', 'файл закрыт']);
    expect(r.work()).toBe('готово');
    expect(r.firstLine()).toBe('строка 1');
  });

  it('ручная версия на try/finally пишет в log то же, что work() с using', () => {
    const r = исполнить<{ log: string[]; work(): string; workByHand(): string }>(
      USING_CODE + '\n' + USING_DESUGAR_CODE,
      ['log', 'work', 'workByHand'],
    );
    r.log.length = 0;
    expect(r.work()).toBe('готово');
    const сUsing = r.log.splice(0);
    expect(r.workByHand()).toBe('готово');
    expect(r.log).toEqual(сUsing);
  });

  it('firstLine(): на выходе из блока finally генератора выполнен', () => {
    const r = исполнить<{ log: string[]; firstLine(): string }>(USING_CODE, ['log', 'firstLine']);
    r.log.length = 0;
    const g = r.firstLine();
    expect([g, ...r.log]).toEqual(['строка 1', 'файл закрыт']);
    expect(typeof (function* () {})()[Symbol.dispose], 'у генератора есть dispose').toBe('function');
  });

  /* Код с `using` уходит в `new Function`: так он исполняется самим V8, мимо трансформации теста. */
  const run = (body: string) => new Function('"use strict";' + body)();

  it('метод читается при объявлении; без него — TypeError сразу; null пропускается; переприсвоить нельзя', () => {
    expect(run(`const log = []; const r = { [Symbol.dispose]() { log.push('старый') } };
      { using q = r; r[Symbol.dispose] = () => log.push('новый'); } return log;`)).toEqual(['старый']);
    expect(run(`const log = []; try { using bad = {}; log.push('после объявления'); } catch (e) { log.push(e.name) } return log;`)).toEqual(['TypeError']);
    expect(run('{ using n = null; using u = undefined; } return "ok";')).toBe('ok');
    expect(() => run('{ using a = null; a = 1; }')).toThrow(TypeError);
  });

  it('две ошибки: try/finally теряет ошибку тела, using отдаёт SuppressedError', () => {
    expect(() => run('try { throw new Error("тело") } finally { throw new Error("finally") }')).toThrow('finally');
    const e = run(`try { { using x = { [Symbol.dispose]() { throw new Error('при закрытии') } }; throw new Error('тело'); } }
      catch (e) { return e }`) as { name: string; error: Error; suppressed: Error };
    expect(e.name).toBe('SuppressedError');
    expect(e.error.message).toBe('при закрытии');
    expect(e.suppressed.message).toBe('тело');
  });

  it('Iterator.prototype[Symbol.dispose] зовёт return()', () => {
    let позвали = 0;
    const it = { __proto__: Iterator.prototype, next: () => ({ value: 1, done: false }), return: () => (позвали++, { value: undefined, done: true }) };
    (it as unknown as Disposable)[Symbol.dispose]();
    expect(позвали).toBe(1);
  });

  it('await using ждёт asyncDispose и принимает синхронный dispose; DisposableStack — в обратном порядке', async () => {
    const log = await new Function(`return (async () => { const log = [];
      { await using a = { async [Symbol.asyncDispose]() { await null; log.push('async закрыт') } }; log.push('тело'); }
      log.push('после');
      { await using s = { [Symbol.dispose]() { log.push('sync через await using') } }; }
      { using stack = new DisposableStack(); stack.defer(() => log.push('defer 1')); stack.use({ [Symbol.dispose]() { log.push('use') } }); stack.defer(() => log.push('defer 2')); }
      return log; })()`)();
    expect(log).toEqual(['тело', 'async закрыт', 'после', 'sync через await using', 'defer 2', 'use', 'defer 1']);
  });

  it('где можно писать: блок, for…of, модуль — да; верхний уровень скрипта — SyntaxError', () => {
    const node = (args: string[]) => {
      try {
        return execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe' }).trim();
      } catch (e) {
        return String((e as { stderr?: string }).stderr);
      }
    };
    expect(node(['-e', 'using x = null'])).toContain('SyntaxError');
    expect(node(['-e', '{ using x = null } console.log("блок")'])).toBe('блок');
    expect(node(['-e', 'for (using x of [null]) {} console.log("for")'])).toBe('for');
    expect(node(['--input-type=module', '-e', 'using x = null; console.log("модуль")'])).toBe('модуль');
  });
});


describe('5 · using · DisposableStack, браузерные обёртки и встроенное в Node', () => {
  type Log = { log: string[] };

  it('`USING_STACK_CODE`: move() отдаёт ресурсы наружу, а при падении открытое закрывается', () => {
    const ok = исполнить<Log & { openBoth(): Disposable }>(USING_CODE + '\n' + USING_STACK_CODE, ['log', 'openBoth']);
    ok.log.length = 0;
    const both = ok.openBoth();
    expect(ok.log, 'блок вышел, но ничего не закрыл').toEqual(['открыт a', 'открыт b']);
    both[Symbol.dispose]();
    expect(ok.log.slice(2), 'закрывает владелец, в обратном порядке').toEqual(['закрыт b', 'закрыт a']);

    const bad = исполнить<Log & { openBoth(): Disposable }>(
      USING_CODE + '\n' + USING_STACK_CODE +
        `\nconst real = open; open = (name) => { if (name === 'b') throw new Error('нет b'); return real(name); };`,
      ['log', 'openBoth'],
    );
    bad.log.length = 0;
    expect(() => bad.openBoth()).toThrow('нет b');
    expect(bad.log, 'a закрыт стопкой').toEqual(['открыт a', 'закрыт a']);
  });

  it('`USING_BROWSER_CODE`: слушатель и таймер сняты и после ответа, и после отказа', async () => {
    const document = new EventTarget();
    const r = исполнить<{ withProgress(task: Promise<unknown>, onKey: () => void, onTick: () => void): Promise<unknown> }>(
      USING_BROWSER_CODE,
      ['withProgress'],
      { document },
    );
    let keys = 0;
    let ticks = 0;
    const answer = r.withProgress(new Promise((ok) => setTimeout(() => ok('ответ'), 450)), () => keys++, () => ticks++);
    document.dispatchEvent(new Event('keydown'));
    expect(await answer).toBe('ответ');
    const ticksAtEnd = ticks;
    expect(ticksAtEnd, 'таймер тикал, пока ждали').toBeGreaterThan(0);
    document.dispatchEvent(new Event('keydown'));
    await new Promise((ok) => setTimeout(ok, 450));
    expect(keys, 'после ответа слушателя нет').toBe(1);
    expect(ticks, 'после ответа таймера нет').toBe(ticksAtEnd);

    await expect(r.withProgress(Promise.reject(new Error('сеть')), () => keys++, () => {})).rejects.toThrow('сеть');
    document.dispatchEvent(new Event('keydown'));
    expect(keys, 'после отказа слушателя тоже нет').toBe(1);
  });

  it('`USING_COMPONENT_CODE`: одна уборка снимает слушатель, таймер и наблюдатель', () => {
    const window = new EventTarget();
    const observed: unknown[] = [];
    let disconnected = 0;
    class ResizeObserver {
      observe(el: unknown) { observed.push(el); }
      disconnect() { disconnected++; }
    }
    const r = исполнить<{ mount(el: unknown, h: Record<string, () => void>): () => void }>(
      USING_BROWSER_CODE + '\n' + USING_COMPONENT_CODE,
      ['mount'],
      { window, ResizeObserver, document: new EventTarget() },
    );
    let resized = 0;
    const unmount = r.mount('el', { onResize: () => resized++, onBox: () => {}, poll: () => {} });
    expect(observed).toEqual(['el']);
    window.dispatchEvent(new Event('resize'));
    unmount();
    window.dispatchEvent(new Event('resize'));
    expect(resized, 'слушатель снят').toBe(1);
    expect(disconnected, 'наблюдатель отключён').toBe(1);
  });

  it('DOM-API без dispose: у AbortController и EventTarget в Node метода тоже нет', () => {
    expect(Symbol.dispose in new AbortController()).toBe(false);
    expect(Symbol.dispose in new EventTarget()).toBe(false);
  });

  it('`USING_NODE_ROWS`: каждая строка таблицы — исполнением', () => {
    expect(USING_NODE_ROWS).toHaveLength(7);
    const out = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import fsp from 'node:fs/promises'; import fs from 'node:fs'; import http from 'node:http';
        import { spawn } from 'node:child_process'; import { Readable } from 'node:stream';
        import { tmpdir } from 'node:os'; import { join } from 'node:path';
        const r = {};
        let fired = false; { using t = setTimeout(() => { fired = true }, 5); }
        { using i = setInterval(() => { fired = true }, 5); } { using m = setImmediate(() => { fired = true }); }
        await new Promise((ok) => setTimeout(ok, 40)); r.timers = !fired;
        let fh; { await using f = await fsp.open('package.json'); fh = f; } r.file = fh.fd === -1;
        let dir; { await using d = await fsp.mkdtempDisposable(join(tmpdir(), 'using-')); dir = d.path; fs.writeFileSync(join(dir, 'x'), '1'); }
        r.tmp = !fs.existsSync(dir) && typeof fs.mkdtempDisposableSync === 'function';
        const s = http.createServer(); await new Promise((ok) => s.listen(0, ok)); { await using srv = s; } r.server = !s.listening;
        const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
        const sig = new Promise((ok) => c.on('exit', (code, signal) => ok(signal))); { using child = c; } r.child = await sig;
        const rs = Readable.from(['a']); { await using x = rs; } r.readable = rs.destroyed;
        let fin = false; function* g() { try { yield 1 } finally { fin = true } }
        { using it = g(); it.next(); } r.gen = fin;
        console.log(JSON.stringify(r));`,
      ],
      { encoding: 'utf8', cwd: process.cwd() },
    );
    expect(JSON.parse(out)).toEqual({ timers: true, file: true, tmp: true, server: true, child: 'SIGTERM', readable: true, gen: true });
  });

  it('`USING_NODE_CODE`: результат верный, каталог удалён и при ошибке', () => {
    const body = USING_NODE_CODE.replace(/^import .*$/gm, '') +
      `
      import('node:fs').then(async (fs) => {
        const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
        const before = () => fs.readdirSync(tmpdir()).filter((n) => n.startsWith('convert-')).length;
        const n0 = before();
        const src = join(tmpdir(), 'using-src-' + process.pid + '.txt'); fs.writeFileSync(src, 'abc');
        const got = await convert(src);
        let err = ''; try { await convert(join(tmpdir(), 'нет-такого-файла')); } catch (e) { err = e.code; }
        fs.rmSync(src);
        console.log(JSON.stringify({ got, err, leaked: before() - n0 }));
      });`;
    const imports = USING_NODE_CODE.match(/^import .*$/gm)!.join('\n');
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', imports + '\n' + body], { encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual({ got: 'ABC', err: 'ENOENT', leaked: 0 });
  });
});
