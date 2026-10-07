import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PITFALLS } from '@/content/lessons/promise-internals/data';

/**
 * Тонкие места урока «Промис изнутри» — запуском, а не по памяти.
 *
 * Раздел 4 темы — восемь утверждений о семантике: что выполняется синхронно, в каком порядке
 * приходят реакции, сколько раз читается `then`, куда девается исключение. Такие утверждения
 * расходятся с движком молча: страница собирается, типы зелены, а неправду находит читатель,
 * решивший проверить пример у себя. Здесь ничего не переписано в тест руками — предмет каждой
 * проверки берётся из `PITFALLS`, а ответ спрашивается у движка.
 *
 * Приём и его ловушки описаны в `AGENTS.md`, раздел «Таблицу о поведении языка не набирают —
 * её вычисляют».
 *
 * ⚠️ Что уже закрыто в других файлах и здесь намеренно не повторяется:
 *
 *   цена девяти конструкций в тиках  — `tests/unit/ruler.test.ts` (движок против данных)
 *                                      и `tests/unit/promise-sim.test.ts` (модель спеки,
 *                                      движок и данные втроём). Отсюда тонкие места 02 и 08:
 *                                      «.then на висящем не стоит ничего» и «3 тика на await»
 *                                      — это ровно те пресеты линейки;
 *   четыре скрытых поля               — `tests/unit/promise-runtime.test.ts`: подписка
 *                                      на pending не тратит тиков, резолв выкладывает список
 *                                      разом, подписка на settled стоит один тик.
 *
 * ⚠️ Листингов в `data.ts` этой темы нет: у `Pitfall` поле `code` не заполнено ни у одного
 * пункта, а примеры из текста живут внутри JSX в `index.mdx` и импортироваться не умеют.
 * Поэтому приём «исполнить листинг прямо из данных» (`tests/unit/callbacks.test.ts`) здесь
 * применить не к чему — сверяются формулировки и поведение.
 */

// ---------------------------------------------------------------------------
// Инструменты
// ---------------------------------------------------------------------------

/**
 * Дождаться, когда очередь микрозадач опустеет **целиком**.
 *
 * Это не гонка с таймером: макрозадача по спецификации выполняется после того, как
 * микрозадачи кончились. Считать обороты `await` тут было бы хуже — их число зависит
 * от длины цепочки промисов и меняется от версии к версии движка.
 */
const drain = () => new Promise<void>((resolve) => void setTimeout(resolve, 0));

/**
 * Выполнить исходник отдельным процессом Node и вернуть всё, что тот оставил после себя.
 *
 * Нужен там, где утверждение темы касается **процесса целиком**: «нигде не всплывёт»
 * и «отказ считается необработанным» — это про `unhandledRejection` и `uncaughtException`,
 * а в рабочем процессе оба слушателя заняты Vitest, и перехват у него из-под рук сделал бы
 * проверку зависящей от чужих слушателей. Заодно только так видно судьбу процесса: отказ
 * без обработчика в Node не событие, а смерть.
 *
 * ⚠️ Расширение `.cjs` намеренно: тело ES-модуля исполняется как job, и начало вывода
 * в нём другое. Все утверждения темы записаны для обычного скрипта — в нём и проверяются.
 */
function runInNode(source: string): { stdout: string[]; stderr: string; status: number | null } {
  const dir = mkdtempSync(join(tmpdir(), 'lesson-promise-internals-'));
  const file = join(dir, 'listing.cjs');
  writeFileSync(file, source);
  const run = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  const stdout = run.stdout.trim();
  return { stdout: stdout ? stdout.split('\n') : [], stderr: run.stderr, status: run.status };
}

/**
 * Тонкие места нумерованы, и нумерация живая. Пропажа номера обязана падать внятно,
 * а не приезжать `undefined` в заголовок теста.
 */
function pitfall(n: string) {
  const found = PITFALLS.find((p) => p.n === n);
  if (!found) throw new Error(`тонкого места ${n} в data.ts нет — проверка осталась без предмета`);
  return found;
}

/**
 * Линейка тиков в миниатюре: цепочка `.then` известной длины, каждое звено — ровно одна
 * микрозадача. Между её ступенями и выпадает измеряемое событие.
 *
 * ⚠️ Это единственный способ померить разницу в тиках, не называя миллисекунд. Абсолютных
 * чисел здесь нет и быть не может — утверждается только расстояние между двумя строками.
 */
function ruler(out: string[], length: number): void {
  let done = 0;
  const step = () => {
    done += 1;
    out.push(`tick ${done}`);
    if (done < length) void Promise.resolve().then(step);
  };
  void Promise.resolve().then(step);
}

// ---------------------------------------------------------------------------
// Раздел 4 · тонкие места
// ---------------------------------------------------------------------------

describe(`${pitfall('01').n} · ${pitfall('01').t}`, () => {
  /**
   * Половина неверных ответов на собеседовании — здесь: конструктор ничего не откладывает
   * и ничего не «запускает в фоне». Показываем разрезом по времени: тело исполнителя встаёт
   * **между** двумя синхронными строками, а реакция — уже за концом синхронного прохода.
   */
  it('тело исполнителя выполняется до возврата из `new Promise`', async () => {
    const out: string[] = [];

    out.push('до');
    const p = new Promise<void>((resolve) => {
      out.push('тело исполнителя');
      resolve();
    });
    p.then(() => void out.push('реакция'));
    out.push('после');

    expect(out, 'исполнитель успел встать между «до» и «после»').toEqual([
      'до',
      'тело исполнителя',
      'после',
    ]);

    await drain();
    expect(out.at(-1), 'асинхронна только реакция — ровно это и написано в теме').toBe('реакция');
    expect(pitfall('01').d).toContain('Асинхронна только реакция');
  });

  /**
   * Вторая половина подписи: промис не «запускает в фоне» — он оборачивает уже существующую
   * асинхронность. Проверяется тем, что без чужого источника асинхронности внутри исполнителя
   * не происходит ничего отложенного вовсе: вся работа уже сделана к моменту возврата.
   */
  it('промис ничего не «запускает в фоне» — он оборачивает чужую асинхронность', async () => {
    expect(pitfall('01').d).toContain('в фоне');

    let работа = 0;
    const p = new Promise<number>((resolve) => {
      работа += 1;
      resolve(работа);
    });

    expect(работа, 'работа сделана синхронно, до всякой очереди').toBe(1);
    expect(await p, 'промис только донёс уже готовый результат').toBe(1);
  });
});

describe(`${pitfall('03').n} · ${pitfall('03').t}`, () => {
  /**
   * Ядро тонкого места: `.then` только заполняет списки, а очередь наполняют резолвы.
   * Подписались ПЕРВЫМИ на медленный промис, ВТОРЫМИ — на уже разрешённый, и порядок
   * вывода оказывается обратным порядку подписки.
   */
  it('подписались первыми на медленный — отработали вторыми', async () => {
    const out: string[] = [];
    let release!: () => void;
    const slow = new Promise<void>((resolve) => void (release = resolve));

    slow.then(() => void out.push('медленный'));
    Promise.resolve().then(() => void out.push('уже разрешённый'));

    await drain();
    expect(out, 'реакцию на висящий промис ставить было нечему').toEqual(['уже разрешённый']);

    release();
    await drain();
    expect(out, 'её поставил резолв — то есть время резолва, а не время подписки').toEqual([
      'уже разрешённый',
      'медленный',
    ]);
  });

  /**
   * Тот же механизм в чистом виде, без разницы в состояниях: два висящих промиса,
   * подписка в порядке a → b, резолв в порядке b → a. Порядок вывода повторяет резолвы.
   */
  it('порядок реакций повторяет порядок резолвов, а не порядок `.then`', async () => {
    const out: string[] = [];
    let resolveA!: () => void;
    let resolveB!: () => void;
    const a = new Promise<void>((r) => void (resolveA = r));
    const b = new Promise<void>((r) => void (resolveB = r));

    a.then(() => void out.push('a'));
    b.then(() => void out.push('b'));

    resolveB();
    resolveA();
    await drain();

    expect(out, 'подписка была a → b, резолв b → a — вывод идёт за резолвом').toEqual(['b', 'a']);
    expect(pitfall('03').d).toContain('Очередь микрозадач наполняют резолвы');
  });
});

describe(`${pitfall('04').n} · ${pitfall('04').t}`, () => {
  /**
   * «Читается геттером» — это утверждение о наблюдаемом побочном эффекте, и проверить его
   * можно только счётчиком обращений. Заодно закрепляем число: `then` читается **один раз**,
   * а не «при каждом взгляде на объект».
   */
  it('возврат постороннего объекта из `.then` читает его `then` ровно один раз', async () => {
    let reads = 0;
    const trap = {
      get then() {
        reads += 1;
        return undefined;
      },
    };

    const passed = await Promise.resolve().then(() => trap);

    expect(reads, 'геттер сработал — и ровно однажды').toBe(1);
    expect(passed, '`then` оказался не функцией, и объект проехал обычным значением').toBe(trap);
  });

  /** `await` читает его так же: узнать «промисоподобность» иначе, чем прочитав поле, нельзя. */
  it('`await` над посторонним объектом читает `then` тем же способом', async () => {
    let reads = 0;
    const trap = {
      get then() {
        reads += 1;
        return undefined;
      },
    };

    // Приведение — часть предмета: TypeScript знает, что это не промис, а движок обязан
    // это выяснить единственным доступным ему способом — прочитав поле.
    await (trap as unknown as PromiseLike<unknown>);
    expect(reads, 'один взгляд на объект — одно обращение к геттеру').toBe(1);
  });

  /**
   * И самое дорогое: если `then` оказался функцией, объект признан thenable и его зовут —
   * то есть посторонний объект начинает управлять чужой цепочкой. Ровно поэтому подпись
   * просит не отдавать наружу объекты с полем `then`.
   */
  it('если `then` оказался функцией — объект признан промисоподобным и вызван', async () => {
    let reads = 0;
    let calls = 0;
    const stranger = {
      get then() {
        reads += 1;
        return (resolve: (v: string) => void) => {
          calls += 1;
          resolve('чужой объект решил, чем всё кончится');
        };
      },
    };

    // ⚠️ Приведение здесь и есть тонкое место. TypeScript справедливо требует от thenable
    // полного протокола — а спеке довольно того, что `then` оказался функцией, и проверять
    // она больше ничего не станет. Именно поэтому посторонний объект и становится опасным.
    const value = await Promise.resolve().then(() => stranger as unknown as PromiseLike<string>);

    expect(reads, 'поле прочитано один раз').toBe(1);
    expect(calls, 'и один раз вызвано').toBe(1);
    expect(value, 'значение цепочки задал посторонний объект, а не тот, кто её строил').toBe(
      'чужой объект решил, чем всё кончится',
    );
    expect(pitfall('04').d, 'подпись формулирует лечение именно так').toContain(
      'Не отдавайте наружу объекты с полем then',
    );
  });
});

describe(`${pitfall('05').n} · ${pitfall('05').t}`, () => {
  /**
   * Исправленная ошибка оригинала: там было написано «стоит ровно столько же». Неправда —
   * нативный промис на **выходе** из `.then` на тик дороже синхронного thenable.
   *
   * ⚠️ Проверяется это порядком, а не миллисекундами: две одинаково начатые цепочки
   * и линейка тиков рядом. Расстояние между ними и есть цена — ровно один тик.
   */
  it('вернуть нативный промис на тик дороже, чем вернуть синхронный thenable', async () => {
    const out: string[] = [];

    void Promise.resolve()
      .then(() => Promise.resolve('x'))
      .then(() => void out.push('нативный'));

    // Синхронный thenable: `then` зовёт `resolve` сразу, не откладывая. Приведение — та же
    // история, что и в 04: движку довольно функции на месте `then`, типам — нет.
    const thenable = { then: (resolve: (v: string) => void) => resolve('x') };
    void Promise.resolve()
      .then(() => thenable as unknown as PromiseLike<string>)
      .then(() => void out.push('thenable'));

    ruler(out, 8);
    await drain();

    const ticksBefore = (label: string): number => {
      const index = out.indexOf(label);
      expect(index, `строки «${label}» в выводе нет`).toBeGreaterThanOrEqual(0);
      return out.slice(0, index).filter((line) => line.startsWith('tick')).length;
    };

    expect(out.indexOf('thenable'), 'thenable приходит раньше').toBeLessThan(
      out.indexOf('нативный'),
    );
    expect(
      ticksBefore('нативный') - ticksBefore('thenable'),
      'разрыв ровно в одну микрозадачу: then нативного промиса откладывает вызов resolveFn',
    ).toBe(1);
  });

  /**
   * Вторая половина подписи — «нативность помогает только на входе». Тот же нативный промис
   * на **входе** (`await`, `Promise.resolve`) не стоит ничего: возвращается тот же объект.
   */
  it('на входе тот же нативный промис не стоит ничего — возвращается тот же объект', () => {
    const p = Promise.resolve('x');
    expect(Promise.resolve(p), 'PromiseResolve узнал свой промис и пропустил его без обёртки').toBe(
      p,
    );

    const thenable = { then: (resolve: (v: string) => void) => resolve('x') };
    expect(Promise.resolve(thenable), 'а чужой объект обязан быть завёрнут').not.toBe(thenable);
  });

  /**
   * Сторож правки: формулировка оригинала «стоит ровно столько же» была неверна, и вернуться
   * она не должна. Тест закрепляет не стиль, а направление утверждения.
   */
  it('тема говорит «на тик дороже», а не «столько же»', () => {
    expect(pitfall('05').d).toContain('на тик дороже');
    expect(pitfall('05').d, 'прежняя неверная формулировка').not.toContain('столько же');
    expect(pitfall('05').d, 'и называет обе операции спеки').toContain('PromiseResolve');
    expect(pitfall('05').d).toContain('ResolvePromise');
  });
});

describe(`${pitfall('06').n} · ${pitfall('06').t}`, () => {
  /** Первая половина: состояние фиксируется первым резолвом, второй — молча no-op. */
  it('наружу уходит только первое значение, второй резолв не делает ничего', async () => {
    let escaped: unknown = null;
    let p: Promise<string> | undefined;

    try {
      p = new Promise<string>((resolve) => {
        resolve('первый');
        resolve('второй');
        throw new Error('бум');
      });
    } catch (error) {
      escaped = error;
    }

    expect(escaped, 'из `new Promise` не вылетело ничего — бросок съеден конструктором').toBeNull();
    expect(await p, 'состояние было зафиксировано первым резолвом').toBe('первый');
  });

  /**
   * Вторая половина — та, ради которой тонкое место помечено `err`: исключение не всплывает
   * **нигде**. Проверяем отдельным процессом, потому что «нигде» — это и `catch` цепочки,
   * и `unhandledRejection`, и `uncaughtException`, и судьба процесса разом.
   */
  it('бросок после резолва не всплывает ни отказом, ни событием процесса', () => {
    const run = runInNode(
      [
        "process.on('unhandledRejection', () => console.log('unhandledRejection'));",
        "process.on('uncaughtException', () => console.log('uncaughtException'));",
        "const p = new Promise((res) => { res('первый'); res('второй'); throw new Error('бум'); });",
        "p.then((v) => console.log('then:' + v), (e) => console.log('catch:' + e.message));",
        "setTimeout(() => console.log('процесс дожил до конца'), 0);",
      ].join('\n'),
    );

    expect(run.stdout, 'ни одной строки про ошибку — исключение пропало совсем').toEqual([
      'then:первый',
      'процесс дожил до конца',
    ]);
    expect(run.status, 'падать было нечему').toBe(0);
    // Имя ошибки нормативно, текст сообщения V8 — нет. Здесь довольно самого факта: следа нет.
    expect(run.stderr, 'и в stderr тоже пусто').not.toMatch(/\bError\b/);
    expect(pitfall('06').d, 'подпись называет лечение').toContain('не бросать в executor после resolve');
  });
});

describe(`${pitfall('07').n} · ${pitfall('07').t}`, () => {
  /**
   * `[[PromiseIsHandled]]` проверяется в конце слива микрозадач — значит, граница проходит
   * не по времени, а по виду очереди. Один и тот же `.catch` успевает или опаздывает
   * в зависимости от того, микрозадачей его поставили или задачей.
   */
  const withHandlerFrom = (schedule: string) =>
    runInNode(
      [
        "process.on('unhandledRejection', () => console.log('unhandledRejection'));",
        "const p = Promise.reject(new Error('бум'));",
        schedule,
        "setTimeout(() => console.log('конец'), 0);",
      ].join('\n'),
    );

  it('обработчик, поставленный микрозадачей, успевает — события нет', () => {
    const run = withHandlerFrom("queueMicrotask(() => p.catch(() => console.log('поймали')));");

    expect(run.stdout, 'чекпоинт досчитал до конца и нашёл обработчик на месте').toEqual([
      'поймали',
      'конец',
    ]);
    expect(run.status).toBe(0);
  });

  it('обработчик, поставленный задачей, опоздал — отказ уже объявлен необработанным', () => {
    const run = withHandlerFrom("setTimeout(() => p.catch(() => console.log('поймали')), 0);");

    expect(run.stdout, 'событие выстрелило ДО того, как обработчик появился').toEqual([
      'unhandledRejection',
      'поймали',
      'конец',
    ]);
    expect(pitfall('07').d, 'подпись объясняет ровно этот порядок').toContain('уже выстрелило');
  });

  /**
   * Цена опоздания в Node — не предупреждение, а процесс: без слушателя тот же код умирает.
   * Ради этого тонкое место и помечено `err`.
   */
  it('в Node опоздание без слушателя стоит процесса', () => {
    const run = runInNode(
      [
        "const p = Promise.reject(new Error('бум'));",
        "setTimeout(() => p.catch(() => console.log('поймали')), 0);",
      ].join('\n'),
    );

    expect(run.status, 'необработанный отказ убивает процесс').not.toBe(0);
    // Имя ошибки нормативно, текст сообщения V8 — нет.
    expect(run.stderr).toMatch(/\bError\b/);
  });
});

// ---------------------------------------------------------------------------
// Пробелы темы
//
// ⚠️ Ни одного литерала под этот блок в `data.ts` пока нет: тема не называет ни тождество
// `Promise.resolve(p) === p`, ни эквивалентность `catch` и `then(undefined, f)`, ни поведение
// `finally` и комбинаторов. Утверждения здесь ни к чему не привязаны — они держат сами факты,
// чтобы текст, когда он появится, писался по проверенному, а не по памяти. Появятся константы —
// эти проверки надо привязать к ним, как привязаны все остальные в этом файле.
// ---------------------------------------------------------------------------

describe('пробелы темы · вход, `catch`, `finally` и комбинаторы', () => {
  /**
   * Тождество на входе — то самое «PromiseResolve умеет узнать нативный промис», ради
   * которого раздел 2 разводит две операции. Для thenable тождества нет и быть не может:
   * чужой объект обязан быть завёрнут.
   */
  it('`Promise.resolve(p) === p` для промиса и новый объект для thenable', () => {
    const p = Promise.resolve(1);
    expect(Promise.resolve(p)).toBe(p);

    const thenable = { then: (resolve: (v: number) => void) => resolve(1) };
    const wrapped = Promise.resolve(thenable);
    expect(wrapped, 'thenable завёрнут в настоящий промис').not.toBe(thenable);
    expect(wrapped).toBeInstanceOf(Promise);
  });

  /**
   * `catch(f)` — не отдельный механизм, а вызов `then` с дырой на месте первого аргумента.
   * Видно это буквально: метод обобщённый, и его можно позвать на любом объекте с `then`.
   */
  it('`catch(f)` — это `then(undefined, f)`, и не фигурально', async () => {
    const args: unknown[] = [];
    const fake = {
      then: (...passed: unknown[]) => {
        args.push(...passed);
        return 'результат then';
      },
    };
    const handler = () => {};

    const returned = (
      Promise.prototype.catch as unknown as (this: unknown, f: unknown) => unknown
    ).call(fake, handler);

    expect(args, 'первым уехал undefined, вторым — сам обработчик').toEqual([undefined, handler]);
    expect(returned, '`catch` возвращает ровно то, что вернул `then`').toBe('результат then');

    // И то же самое поведением: обе записи ловят один и тот же объект ошибки.
    const error = new Error('бум');
    const viaCatch = await Promise.reject(error).catch((e: unknown) => e);
    const viaThen = await Promise.reject(error).then(undefined, (e: unknown) => e);
    expect(viaCatch).toBe(error);
    expect(viaThen).toBe(error);
  });

  /**
   * `finally` устроен хитрее, чем кажется: значение он не трогает, но промис, который вы
   * из него вернули, **ждёт**. Проверяется флагом, а не часами.
   */
  it('`finally` не меняет значение, но дожидается возвращённого из него промиса', async () => {
    let cleanupDone = false;
    const value = await Promise.resolve('значение').finally(
      () =>
        new Promise<string>((resolve) =>
          void setTimeout(() => {
            cleanupDone = true;
            resolve('это значение будет выброшено');
          }, 0),
        ),
    );

    expect(value, 'то, что вернули из finally, значения не меняет').toBe('значение');
    expect(cleanupDone, 'но цепочка дождалась его окончания').toBe(true);
  });

  it('...а вот бросок из `finally` значение перебивает', async () => {
    const error = new Error('из finally');
    await expect(Promise.resolve('значение').finally(() => void (() => { throw error; })())).rejects.toBe(
      error,
    );
  });

  /**
   * `all` падает на первой ошибке **по времени**, а не по позиции в массиве — иначе
   * утверждение звучало бы одинаково и было бы вдвое слабее.
   */
  it('`all` отказывает первой ошибкой по времени, а не по позиции в списке', async () => {
    const second = new Error('второй в списке, но первый по времени');
    const never = new Promise<number>(() => {});

    await expect(Promise.all([never, Promise.reject(second)])).rejects.toBe(second);
  });

  it('`allSettled` дожидается всех и не отказывает никогда', async () => {
    const results = await Promise.allSettled([
      Promise.resolve(1),
      Promise.reject(new Error('бум')),
    ]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  });

  it('`any` при полном провале бросает `AggregateError` со всеми ошибками', async () => {
    const errors = [new Error('a'), new Error('b')];
    let caught: unknown = null;

    try {
      await Promise.any(errors.map((e) => Promise.reject(e)));
    } catch (error) {
      caught = error;
    }

    // Имя ошибки нормативно, текст — нет: утверждаем тип и состав, а не сообщение движка.
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as Error).name).toBe('AggregateError');
    expect((caught as AggregateError).errors, 'внутри лежат все отказы разом').toEqual(errors);
  });

  /**
   * `race` не отменяет проигравших — у промиса вообще нет отмены. Проверяем флагом:
   * работа проигравшего доводится до конца уже после того, как гонка объявлена.
   */
  it('`race` не отменяет проигравшего — тот доработает своё', async () => {
    let loserFinished = false;
    const loser = new Promise<string>(
      (resolve) =>
        void setTimeout(() => {
          loserFinished = true;
          resolve('медленный');
        }, 0),
    );

    expect(await Promise.race([Promise.resolve('быстрый'), loser])).toBe('быстрый');
    expect(loserFinished, 'на момент выигрыша проигравший ещё в работе').toBe(false);

    await loser;
    expect(loserFinished, 'и всё равно её закончил: отмены у промиса нет').toBe(true);
  });
});

/**
 * Две фразы темы, которые раньше жили в «За кадром», а теперь стоят в разделах:
 * `return await` сохраняет функцию в асинхронном стеке, `return p` — нет (карточка
 * «`return p` против `return await p`»); `for await` просит следующее значение только
 * после тела, а `break` зовёт `return()` источника (подраздел про `await` в цикле).
 */
describe('стек через `await` и протокол `for await`', () => {
  /**
   * В отдельном процессе: `vitest` переписывает стек через source map и стирает пометку
   * `async` у кадра — внутри прогона проверка видела бы не движок, а отчёт раннера.
   */
  it('`return await` оставляет функцию в стеке ошибки, `return p` — нет', () => {
    const code = `
      async function inner() { await null; throw new Error('упало'); }
      async function viaAwait() { return await inner(); }
      async function viaReturn() { return inner(); }
      const stackOf = (p) => p.then(() => '', (e) => e.stack);
      Promise.all([stackOf(viaAwait()), stackOf(viaReturn())])
        .then((s) => process.stdout.write(JSON.stringify(s)));`;
    const run = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    const [withAwait, withReturn] = JSON.parse(run.stdout) as [string, string];
    expect(withAwait).toContain('at async viaAwait');
    expect(withReturn).not.toContain('viaReturn');
  });

  it('`for await` ждёт тело до следующего `next()`, а `break` зовёт `return()`', async () => {
    const log: string[] = [];
    let i = 0;
    const source = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        log.push('next');
        return Promise.resolve({ value: i++, done: false });
      },
      return() {
        log.push('return');
        return Promise.resolve({ value: undefined, done: true });
      },
    };
    for await (const v of source) {
      log.push(`body ${v}`);
      if (v === 1) break;
    }
    expect(log).toEqual(['next', 'body 0', 'next', 'body 1', 'return']);
  });
});
