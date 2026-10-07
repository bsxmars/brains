import { EventEmitter, addAbortListener } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  ABORT_CODE,
  BIND_TRAP,
  DISPATCH_DOM,
  DISPATCH_EMITTER,
  LOST_ROWS,
  NODE_ERROR_FIRST,
  PITFALLS,
  REENTRANT,
  THIS_OPTIONS,
  ZALGO_FIX,
  ZALGO_MODES,
  ZALGO_PROMISE,
} from '@/content/lessons/callbacks/data';
// Те же модули, что выполняются у читателя в демо. Импорт именно их — и есть весь смысл
// блока «демо и таблица спрашивают движок одинаково» ниже.
import { simulateDebounce, simulateThrottle } from '@/widgets/debounce-throttle/model/simulate';
import { SCENARIOS, runScenario } from '@/widgets/dispatch-lab/model/run';
import { THIS_CASES } from '@/widgets/this-in-callback/model/cases';
import { runThisCase } from '@/widgets/this-in-callback/model/run';

/**
 * Утверждения урока «Колбэки» — запуском, а не по памяти.
 *
 * Тема набрана с пометками «проверено на Node 24.11»: `setTimeout` с не-функцией, счётчик
 * слушателей после `abort()`, порядок обхода при снятии слушателя, `1, 2, 4` у `forEach`
 * со `splice`. Каждая такая пометка — разовая ручная сверка, которую `npm test` не повторял:
 * разойтись с движком она могла молча. Здесь ожидания не переписаны в тест руками, а вычислены
 * из литералов `data.ts` и сверены с настоящим выполнением. Падение означает ровно одно:
 * на странице написана неправда.
 *
 * ⚠️ Браузерная половина темы сюда намеренно не попала: `setTimeout(fn(), 100)` «молча ничего
 * не делает», `window.onerror`, слушатель на detached-узле, `img.onerror`. В Node этого нет —
 * и тема про них честно пишет «требует проверки», а не «проверено».
 *
 * ⚠️ Часть демо темы по-прежнему пересказывает записанные шаги, и для них приём «демо и тест
 * зовут одну модель» недоступен. У `widgets/zalgo-demo` сценарий собран в тесте и сверяется
 * с выводом последнего шага в `data.ts` — то есть с тем, что видит читатель.
 *
 * ⚠️ А `widgets/callback-stack` не проверяется ничем, и этот докстринг раньше числил его
 * среди проверенных. Ложное ощущение покрытия хуже отсутствия теста: на него полагаешься.
 * Десять шагов, пять строк вердикта и оба листинга `STACK_MODES` пока держатся только
 * на вычитке.
 *
 * А вот у трёх демо исполняемая модель есть, и последний блок файла зовёт **ровно её**:
 * `this-in-callback` (вычисляет настоящий `this`), `dispatch-lab` (настоящая диспетчеризация
 * и реентерантность), `debounce-throttle` (расчёт окон). Пока тест держал бы свою копию
 * той же логики, «проверено тестом» означало бы «проверено чем-то похожим».
 */

/** Выполнить листинг со страницы, подставив ему свою консоль: глобальную трогать незачем. */
function runListing(source: string): string[] {
  const out: string[] = [];
  const console = { log: (...args: unknown[]) => void out.push(args.map(String).join(' ')) };
  (new Function('console', `'use strict';\n${source}`) as (c: typeof console) => void)(console);
  return out;
}

/** Последняя строка листинга вида `// 1, 2, 4 — тройка пропущена` → обещанный вывод. */
function promisedOutput(source: string): string {
  const last = source.trimEnd().split('\n').at(-1)!;
  expect(last.trimStart().startsWith('//'), `у листинга нет строки с обещанным выводом: ${last}`).toBe(true);
  return last.replace(/^\s*\/\/\s*/, '').split(' — ')[0].trim();
}

/** Дать очереди микрозадач провернуться — без гонки с таймерами. */
const flush = () => Promise.resolve().then(() => undefined);

/**
 * Демо и таблица обязаны спрашивать движок одинаково.
 *
 * Три демо темы больше не пересказывают записанный ответ, а выполняют код у читателя.
 * Здесь вызываются **ровно те функции**, что работают в браузере, и их результат сверяется
 * с литералами `data.ts`. Разойдись демо со страницей — покраснеет тест, а не читатель
 * это заметит. Приём и его ловушки описаны в `AGENTS.md`, раздел «Таблицу о поведении языка
 * не набирают — её вычисляют».
 */
/**
 * Предел задержки таймера — утверждение раздела «За кадром».
 *
 * ⚠️ Оно стояло без единой проверки, при том что закрывается двумя строками: задержка
 * хранится 32-битным знаковым числом, и всё, что больше `2 147 483 647` мс (≈24.8 суток),
 * переполняется и стреляет немедленно. Это тот самый баг «таймер на месяц выстрелил сразу»,
 * и цена ошибки в тексте здесь высокая: читатель поверит и поставит таймер на месяц.
 *
 * Сверено запуском на Node 26.8.2: переполнение срабатывает мгновенно, движок печатает
 * `TimeoutOverflowWarning`, ровно предел проходит штатно.
 */
describe('предел задержки setTimeout', () => {
  /** Ровно `2^31 − 1`: последнее значение, которое влезает в 32-битное знаковое число. */
  const ПРЕДЕЛ = 2_147_483_647;

  it('задержка сверх предела срабатывает немедленно, а не через 24.8 суток', async () => {
    const начало = Date.now();
    const прошло = await new Promise<number>((resolve) => {
      const id = setTimeout(() => resolve(Date.now() - начало), ПРЕДЕЛ + 1);
      // Если бы переполнения не было, таймер ждал бы 24.8 суток и тест завис.
      if (typeof id === 'object' && id !== null) (id as { unref?: () => void }).unref?.();
    });

    expect(прошло).toBeLessThan(100);
  });

  it('ровно предел не переполняется — таймер остаётся ждать', () => {
    const id = setTimeout(() => {}, ПРЕДЕЛ);
    // Таймер жив и не выстрелил: снимаем его сами, иначе он держал бы процесс.
    expect(id).toBeDefined();
    clearTimeout(id);
  });
});

describe('демо и таблица спрашивают движок одинаково', () => {
  it('диспетчеризация · порядок вызовов совпадает с тем, что напечатано в теме', () => {
    expect(runScenario('emitter').summary, 'эмиттер в стиле Node').toBe(DISPATCH_EMITTER);
    expect(runScenario('target').summary, 'браузерный EventTarget').toBe(DISPATCH_DOM);
  });

  it('диспетчеризация · снятый во время обхода слушатель: у одного вызван, у другого нет', () => {
    // Вся суть различия в одной строке: у эмиттера в первом круге три вызова, у цели — два.
    const emitter = runScenario('emitter').summary.split('\n')[0];
    const target = runScenario('target').summary.split('\n')[0];
    expect(emitter, 'обход идёт по копии — снятый всё равно зовётся').toBe('a → b → c');
    expect(target, 'запись помечена удалённой — снятый пропущен').toBe('a → c');
  });

  it('реентерантность · `forEach` со `splice` печатает то же, что обещает листинг темы', () => {
    const promised = promisedOutput(REENTRANT[2].code);
    expect(runScenario('splice').log.join(', ')).toBe(promised);
  });

  it('реентерантность · рекурсивный `emit` кончается `RangeError`', () => {
    // Имя ошибки нормативно, глубина стека — нет: она своя в каждой среде и в каждом прогоне.
    expect(runScenario('recursion').errorName).toBe('RangeError');
  });

  it('каждый сценарий демо честно помечен источником ответа', () => {
    // `node:events` в браузере нет, и демо не имеет права выдавать свою модель за Node.
    const emitter = SCENARIOS.find((s) => s.key === 'emitter');
    expect(emitter, 'сценария с эмиттером нет').toBeDefined();
    expect(emitter!.source, 'эмиттер в браузере — модель, а не Node').toBe('model');
  });

  it('`this` · каждый случай демо приходит к своему обещанному исходу', () => {
    // DOM-случаи требуют документа: в Node их пропускаем, в браузере они честно исполняются.
    const runnable = THIS_CASES.filter((c) => !c.needsDom);
    expect(runnable.length, 'не-DOM случаев не осталось').toBeGreaterThan(3);

    for (const item of runnable) {
      const run = runThisCase(item.key);
      expect(run.verdict, `случай «${item.label}» разошёлся с обещанным исходом`).toBe(
        item.expected,
      );
    }
  });

  /**
   * Ядро раздела: `this` вычисляется по точке вызова, а не по месту объявления.
   *
   * ⚠️ Проверяем именно **значение** привязки, а не наличие ошибки. Ошибка здесь — уже
   * следствие: `this` стал `undefined`, и упало чтение поля у него. В данных темы эти две
   * вещи когда-то стояли одной строкой «undefined → TypeError», и их пришлось развести.
   */
  it('`this` · оторванный метод и деструктуризация теряют привязку, `bind` её возвращает', () => {
    for (const key of ['torn', 'destructured'] as const) {
      const run = runThisCase(key);
      expect(run.thisValue, `у случая «${key}» привязка должна пропасть`).toBe('undefined');
      expect(run.errorName, `у случая «${key}» падает чтение поля у undefined`).toBe('TypeError');
    }

    const bound = runThisCase('bind');
    expect(bound.errorName, '`bind` возвращает привязку — падать нечему').toBe('');
    expect(bound.verdict).toBe('ok');
  });

  /**
   * Обёртки: закрепляем окна, а не факт «не упало».
   *
   * Числа взяты из докстринга самой модели, где они сверены с разбором по шагам из конспекта,
   * а вырожденный случай — с настоящим lodash. Теперь эта сверка повторяется командой.
   *
   * ⚠️ Прошлая версия проверки звала модель **тремя** аргументами вместо четырёх и требовала
   * лишь отсутствия броска. Она проходила: недостающий флаг приезжал `undefined`, ничего
   * не ронял — то есть проверка была снисходительной и пропустила бы настоящую поломку.
   * Поймали это не тесты, а `astro check`.
   */
  it('обёртки · debounce и throttle дают ровно те окна, что заявлены в модели', () => {
    const fired = (fires: { t: number; arg: number }[]) => fires.map((f) => `${f.t}:${f.arg}`);

    expect(fired(simulateThrottle([0, 40, 80, 300], 100, true, true))).toEqual([
      '0:0',
      '100:80',
      '300:300',
    ]);
    expect(fired(simulateDebounce([0, 40, 80, 300], 100, false, true))).toEqual([
      '180:80',
      '400:300',
    ]);
    expect(fired(simulateDebounce([0, 50, 250], 100, true, true))).toEqual([
      '0:0',
      '150:50',
      '250:250',
    ]);
  });

  it('обёртки · выключенные leading и trailing не дают ни одного вызова', () => {
    // Вырожденная пара флагов: модель сверена с настоящим lodash — ни одного срабатывания.
    expect(simulateThrottle([0, 120, 260], 100, false, false)).toEqual([]);
  });
});

/**
 * Дождаться, когда очередь микрозадач опустеет **целиком**.
 *
 * Это не гонка с таймером: макрозадача по спецификации выполняется после того, как
 * микрозадачи кончились. Считать обороты `await` тут было бы хуже — их число зависит
 * от того, сколько промисов в цепочке, и менялось от версии к версии движка.
 */
const drain = () => new Promise<void>((resolve) => void setTimeout(resolve, 0));

/**
 * Тонкие места нумерованы, и нумерация живая: за время работы над темой 9.5 успело
 * смениться целиком. Пропажа номера обязана падать внятно, а не приезжать `undefined`
 * в заголовок теста.
 */
function pitfall(n: string) {
  const found = PITFALLS.find((p) => p.n === n);
  if (!found) throw new Error(`тонкого места ${n} в data.ts нет — проверка осталась без предмета`);
  return found;
}

// ---------------------------------------------------------------------------
// Раздел 9 · тонкие места
// ---------------------------------------------------------------------------

describe(`${pitfall('02').n} · ${pitfall('02').t}`, () => {
  /**
   * Тема утверждает две вещи сразу, и вторая интереснее первой: `fn()` **успевает
   * выполниться**, а падает уже `setTimeout`, которому отдали её результат. Скобки
   * не «отключают» вызов — они его совершают.
   *
   * ⚠️ Имя и код ошибки нормативны, текст сообщения V8 — нет: утверждаем только `code`.
   */
  it('не-функция в `setTimeout` — это ERR_INVALID_ARG_TYPE, а не тишина', () => {
    let calls = 0;
    const fn = () => {
      calls += 1;
      return 'не функция';
    };

    let caught: unknown = null;
    try {
      setTimeout(fn() as unknown as () => void, 100);
    } catch (error) {
      caught = error;
    }

    expect(calls, 'fn() выполнилась — её результат и ушёл в setTimeout').toBe(1);
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as NodeJS.ErrnoException).code).toBe('ERR_INVALID_ARG_TYPE');
    // Код ошибки на странице и код ошибки из движка обязаны быть одним кодом.
    expect(pitfall('02').code).toContain('ERR_INVALID_ARG_TYPE');
  });
});

describe(`${pitfall('01').n} · ${pitfall('01').t}`, () => {
  /**
   * Главная правка темы против оригинала: `emitter.on(…, { signal })` не работает.
   * Проверяется это единственным честным способом — счётчиком слушателей до и после
   * `abort()`. Если Node однажды научит `on` понимать `signal`, тест покраснеет,
   * и правку на странице надо будет отыграть назад.
   */
  it('третий аргумент `on` молча отбрасывается — после abort() слушатель на месте', () => {
    const emitter = new EventEmitter();
    const ac = new AbortController();
    let calls = 0;
    const onTick = () => {
      calls += 1;
    };

    // @ts-expect-error — третьего параметра у `EventEmitter#on` нет, и TypeScript прав.
    // Аргумент передаётся намеренно: тонкое место утверждает, что движок отбросит его
    // молча, а проверить это можно только вызовом. Если ошибка однажды исчезнет — значит,
    // Node научил `on` понимать `signal`, и правку на странице пора отыгрывать назад.
    emitter.on('tick', onTick, { signal: ac.signal });
    expect(emitter.listenerCount('tick'), 'подписались').toBe(1);

    ac.abort();

    expect(emitter.listenerCount('tick'), 'счётчик после abort() по-прежнему 1').toBe(1);
    emitter.emit('tick');
    expect(calls, 'и emit его всё ещё зовёт — отписки не произошло').toBe(1);
  });

  it('`events.addAbortListener` снимает по-настоящему: 1 → 0', () => {
    const emitter = new EventEmitter();
    const ac = new AbortController();
    const onTick = () => {};

    emitter.on('tick', onTick);
    addAbortListener(ac.signal, () => emitter.off('tick', onTick));
    expect(emitter.listenerCount('tick')).toBe(1);

    ac.abort();
    expect(emitter.listenerCount('tick'), 'вот так третий аргумент и заменяется').toBe(0);

    // Лечение на странице — именно это, а не `{ signal }` у `on`.
    expect(ABORT_CODE).toContain('addAbortListener');
    expect(pitfall('01').code).toContain('addAbortListener');
  });

  /** А `addEventListener` опцию понимает — ради этого контраста тонкое место и написано. */
  it('у `EventTarget` та же опция работает штатно', () => {
    const target = new EventTarget();
    const ac = new AbortController();
    let calls = 0;

    target.addEventListener('tick', () => void (calls += 1), { signal: ac.signal });
    target.dispatchEvent(new Event('tick'));
    ac.abort();
    target.dispatchEvent(new Event('tick'));

    expect(calls, 'после abort() слушателя нет').toBe(1);
  });
});

describe('реентерантность · колбэк мутирует структуру, по которой его зовут', () => {
  /**
   * Снипет не переписан в тест — он **исполняется прямо из данных**, и сверяется
   * с обещанием, записанным в его же последней строке. Разъехаться код на странице
   * и комментарий под ним теперь не могут.
   */
  it('`forEach` со `splice` внутри печатает ровно то, что обещает комментарий', () => {
    const source = REENTRANT[2].code;
    expect(runListing(source).join(', ')).toBe(promisedOutput(source));
  });

  /** Объяснение из подписи: пропущен именно тот элемент, который переехал под счётчик. */
  it('пропадает элемент, переехавший на уже пройденный индекс', () => {
    const a = [1, 2, 3, 4];
    const seen: number[] = [];
    a.forEach((x, i) => {
      if (x === 2) a.splice(i, 1);
      seen.push(x);
    });

    expect(seen, 'тройка съехала на индекс 1, а счётчик уже на 2').toEqual([1, 2, 4]);
    expect(a, 'в самом массиве тройка никуда не делась — её просто не обошли').toEqual([1, 3, 4]);
    expect(REENTRANT[2].why, 'подпись объясняет ровно этот механизм').toContain('a[2] === 4');
  });
});

describe(`${pitfall('07').n} · ${pitfall('07').t}`, () => {
  /**
   * `forEach` не смотрит на возвращаемое значение колбэка, поэтому промис, который вернул
   * `async`-колбэк, просто отбрасывается. Проверяется это порядком: строка после обхода
   * печатается раньше, чем завершится хоть один вызов.
   */
  it('строка после `forEach` печатается ПЕРВОЙ — обход ничего не ждал', async () => {
    const out: string[] = [];
    const load = (id: number) => Promise.resolve(id);

    [1, 2].forEach(async (id) => {
      await load(id);
      out.push(`готов ${id}`);
    });
    out.push('всё?');

    expect(out, 'на этой строке не готов ещё никто').toEqual(['всё?']);
    await drain();
    expect(out, 'колбэки досчитали сильно позже').toEqual(['всё?', 'готов 1', 'готов 2']);
  });

  it('возвращённый промис действительно теряется: `forEach` отдаёт undefined', () => {
    expect([1].forEach(async () => {})).toBeUndefined();
  });

  /** Оба лечения из подписи — и последовательное, и параллельное — ждут по-настоящему. */
  it('`for…of` с `await` и `Promise.all(map)` дожидаются', async () => {
    const load = (id: number) => Promise.resolve(id);

    const sequential: number[] = [];
    for (const id of [1, 2]) sequential.push(await load(id));
    expect(sequential).toEqual([1, 2]);

    expect(await Promise.all([1, 2].map(load))).toEqual([1, 2]);
    expect(pitfall('07').d).toContain('Promise.all(ids.map(load))');
  });

  /**
   * Вторая половина тонкого места: ошибка внутри `async`-колбэка уходит мимо `try/catch`
   * вокруг обхода — ловить её там нечего, потому что наружу вернулся уже отклонённый промис.
   * ⚠️ Промис перехватываем сами, иначе тест утащит за собой `unhandledRejection`.
   */
  it('бросок внутри async-колбэка мимо `try/catch` вокруг обхода', async () => {
    const escaped: Promise<void>[] = [];
    let caught: unknown = null;

    try {
      [1].forEach((id) => {
        const promise = (async () => {
          if (id === 1) throw new Error('внутри колбэка');
        })();
        escaped.push(promise);
      });
    } catch (error) {
      caught = error;
    }

    expect(caught, '`try` вокруг forEach не поймал ничего').toBeNull();
    await expect(escaped[0], 'ошибка уехала отказом промиса, который никто не ждал').rejects.toThrow(
      'внутри колбэка',
    );
  });
});

describe(`${pitfall('06').n} · ${pitfall('06').t}`, () => {
  /**
   * Списки методов разбираются **из текста страницы** и проверяются поведением, а не
   * сверкой имён со вторым таким же списком: перепишет автор перечисление — тест тут же
   * пойдёт спрашивать движок про новые имена. Разбор идёт до тестов, поэтому его промах —
   * сразу исключение, а не красное `expect` посреди сбора.
   */
  const names = (pattern: RegExp): string[] => {
    const found = pitfall('06').d.match(pattern)?.[1];
    if (!found) throw new Error(`в тонком месте 06 не нашлось списка по образцу ${pattern}`);
    return found
      // Перечисление вправе открываться счётом — «одиннадцать методов: map, …».
      // Счёт не имя, и в список методов он попадать не должен.
      .replace(/^[^:]*:\s*/, '')
      .split(/,\s*|\s+и\s+/)
      .map((s) => s.replace(/`/g, '').trim())
      .filter(Boolean);
  };

  /**
   * Групп три, а не две, и различать их важно: «принимают thisArg», «молча отбрасывает»
   * и «второй параметр занят начальным значением». Вторая и третья выглядят одинаково —
   * лишний аргумент не приводит к ошибке, — но кончаются по-разному.
   */
  const WITH = names(/принимают (.+?)\.\s/);
  const IGNORED = names(/У ([^:]+?) его нет/);
  const SEED = names(/А вот у (.+?) второй аргумент/);

  /**
   * Обычная функция: `this` внутри неё и есть ответ движка. Стрелка здесь не годится.
   * `this` складывается в массив, а не в переменную: так видно и то, что колбэк вообще
   * вызывали, — `undefined` в переменной был бы неотличим от «не вызвали ни разу».
   * Параметров у пробы нет намеренно: функция без аргументов подходит любому обходу.
   */
  function makeProbe() {
    const seen: unknown[] = [];
    const cb = function (this: unknown) {
      seen.push(this);
      return 0;
    };
    return { cb, seen };
  }

  type Probe = (this: unknown) => number;

  const MARKER = { маркер: true };

  const calls: Record<string, (cb: Probe, thisArg: object) => void> = {
    map: (cb, t) => void [1, 2].map(cb, t),
    forEach: (cb, t) => void [1, 2].forEach(cb, t),
    filter: (cb, t) => void [1, 2].filter(cb, t),
    some: (cb, t) => void [1, 2].some(cb, t),
    every: (cb, t) => void [1, 2].every(cb, t),
    find: (cb, t) => void [1, 2].find(cb, t),
    findIndex: (cb, t) => void [1, 2].findIndex(cb, t),
    findLast: (cb, t) => void [1, 2].findLast(cb, t),
    findLastIndex: (cb, t) => void [1, 2].findLastIndex(cb, t),
    flatMap: (cb, t) => void [1, 2].flatMap(cb, t),
    'Array.from': (cb, t) => void Array.from([1, 2], cb, t),
  };

  it('на странице три группы, и они не пересекаются', () => {
    expect(WITH.length, 'список «принимают» разобрался').toBeGreaterThanOrEqual(9);
    expect(IGNORED, 'молча отбрасывает лишний аргумент только sort').toEqual(['sort']);
    expect(SEED, 'а у этих двух второй параметр занят начальным значением').toEqual([
      'reduce',
      'reduceRight',
    ]);

    const all = [...WITH, ...IGNORED, ...SEED];
    expect(new Set(all).size, 'метод не может попасть в две группы сразу').toBe(all.length);
  });

  for (const name of WITH) {
    it(`${name} — второй аргумент становится this колбэка`, () => {
      expect(calls[name], `для «${name}» нет запуска`).toBeTypeOf('function');
      const probe = makeProbe();
      calls[name](probe.cb, MARKER);
      expect(probe.seen[0]).toBe(MARKER);
    });
  }

  /**
   * Вторая группа — ровно одна операция, и проверить её можно только вызовом: у `sort`
   * объявлен один параметр, а спека предписывает лишний аргумент проигнорировать.
   */
  it(`${IGNORED.join(', ')} — лишний аргумент отбрасывается молча, без ошибки`, () => {
    expect(IGNORED, 'проверка написана под одну операцию').toEqual(['sort']);
    const probe = makeProbe();

    expect(() => {
      // @ts-expect-error — TypeScript прав: у `sort` один параметр. Лишний аргумент
      // передаётся намеренно — именно это утверждает страница, и увидеть «отбросил молча»
      // можно только вызовом. Исчезнет ошибка — значит, сигнатуру изменили, и утверждение
      // на странице пора перечитать.
      [2, 1].sort(probe.cb, MARKER);
    }, 'ошибки нет — аргумент просто пропал').not.toThrow();

    expect(probe.seen.length, 'компаратор всё-таки звали').toBeGreaterThan(0);
    expect(probe.seen[0], 'strict mode: подставлять нечего').toBeUndefined();
    expect(Array.prototype.sort.length, 'у sort объявлен ровно один параметр').toBe(1);
    expect(pitfall('06').code).toContain('Array.prototype.sort.length === 1');
  });

  /**
   * Третья группа — та самая, из-за которой «нет thisArg» нельзя писать одной строкой:
   * у `reduce` и `reduceRight` второй параметр не лишний, он **занят**. Перепутавший
   * получит не «ничего не произошло», а чужой аккумулятор — и никакой ошибки.
   * Типы это знают, поэтому здесь ничего подавлять не нужно: код честно компилируется.
   */
  for (const name of SEED) {
    it(`${name} — второй аргумент приезжает начальным значением, а не this`, () => {
      const seed = { начальное: true };
      const accumulators: unknown[] = [];
      const thisValues: unknown[] = [];

      const step = function (this: unknown, acc: typeof seed) {
        thisValues.push(this);
        accumulators.push(acc);
        return acc;
      };

      if (name === 'reduce') [1, 2].reduce(step, seed);
      else [1, 2].reduceRight(step, seed);

      expect(accumulators[0], 'он стал аккумулятором первого шага').toBe(seed);
      expect(thisValues[0], 'а this так и остался пустым').toBeUndefined();
      expect(pitfall('06').d, 'страница называет это своим именем').toContain(
        'занят начальным значением',
      );
    });
  }

  it('со стрелкой `thisArg` бесполезен — привязывать нечего', () => {
    const thisOption = THIS_OPTIONS.find((o) => o.label.includes('thisArg'))!;
    expect(thisOption.cost).toContain('Бесполезен со стрелочной функцией');

    const outer = { внешний: true };
    const arrow = function (this: unknown) {
      return (() => this)();
    }.call(outer);
    expect([1].map(() => arrow, MARKER)[0], 'стрелка держит свой внешний this').toBe(outer);
  });
});

describe(`${pitfall('04').n} · ${pitfall('04').t}`, () => {
  /**
   * `bind` возвращает **новую** функцию на каждый вызов — отсюда вся ловушка: снимают
   * не тот объект, который подписывали, и промах молчит.
   */
  it('`fn.bind(o) !== fn.bind(o)` — отсюда и молчаливый промах отписки', () => {
    function handler() {}
    const owner = {};
    expect(handler.bind(owner)).not.toBe(handler.bind(owner));
    expect(BIND_TRAP).toContain('НЕ СНИМЕТ');
  });

  it('`emitter.off` по новой ссылке не снимает слушателя', () => {
    const emitter = new EventEmitter();
    const owner = { calls: 0, handler(this: { calls: number }) { this.calls += 1; } };

    emitter.on('tick', owner.handler.bind(owner));
    emitter.off('tick', owner.handler.bind(owner));

    expect(emitter.listenerCount('tick'), 'совпадения не нашлось, метод промолчал').toBe(1);
    emitter.emit('tick');
    expect(owner.calls, 'слушатель жив').toBe(1);
  });

  it('`removeEventListener` ведёт себя так же', () => {
    const target = new EventTarget();
    let calls = 0;
    const handler = function () {
      calls += 1;
    };

    target.addEventListener('tick', handler.bind(null));
    target.removeEventListener('tick', handler.bind(null));
    target.dispatchEvent(new Event('tick'));

    expect(calls, 'снять по новой ссылке нельзя — сравнение идёт по идентичности').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Раздел 8 · диспетчеризация при снятии слушателя во время обхода
// ---------------------------------------------------------------------------

describe('снятие слушателя во время обхода — две разные модели', () => {
  /** Сценарий один на оба случая: первый слушатель снимает второго, потом два вызова подряд. */
  const scenario = (
    subscribe: (name: string, fn: () => void) => void,
    unsubscribe: (name: string, fn: () => void) => void,
    fire: () => void,
  ): string => {
    const out: string[] = [];
    const a = () => {
      out.push('a');
      unsubscribe('b', b);
    };
    const b = () => void out.push('b');
    const c = () => void out.push('c');

    subscribe('a', a);
    subscribe('b', b);
    subscribe('c', c);

    fire();
    const first = out.join(' → ');
    out.length = 0;
    fire();
    return `${first}\n${out.join(' → ')}`;
  };

  /**
   * `EventEmitter` копирует список перед обходом, поэтому снятый слушатель **всё равно
   * отработает** в этом же `emit` — и только следующий его не увидит. Именно поэтому
   * на странице два разных литерала, а не один.
   */
  it(`EventEmitter → ${JSON.stringify(DISPATCH_EMITTER)}`, () => {
    const emitter = new EventEmitter();
    expect(
      scenario(
        (_, fn) => void emitter.on('e', fn),
        (_, fn) => void emitter.off('e', fn),
        () => void emitter.emit('e'),
      ),
    ).toBe(DISPATCH_EMITTER);
  });

  /** А `EventTarget` снятие во время обхода уважает — b не вызывается уже в первый раз. */
  it(`EventTarget → ${JSON.stringify(DISPATCH_DOM)}`, () => {
    const target = new EventTarget();
    expect(
      scenario(
        (_, fn) => void target.addEventListener('e', fn),
        (_, fn) => void target.removeEventListener('e', fn),
        () => void target.dispatchEvent(new Event('e')),
      ),
    ).toBe(DISPATCH_DOM);
  });

  it('две модели обязаны расходиться — иначе весь абзац теряет смысл', () => {
    expect(DISPATCH_EMITTER).not.toBe(DISPATCH_DOM);
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · Zalgo
// ---------------------------------------------------------------------------

describe('Zalgo — один и тот же код даёт разный порядок', () => {
  type Callback = (err: Error | null, user?: string) => void;

  /**
   * `getUser` из листинга темы: попадание в кеш отвечает синхронно, промах — через
   * очередь. В починенном варианте синхронная ветка уходит в `queueMicrotask`
   * (ровно то, что напечатано в `ZALGO_FIX`).
   */
  const makeGetUser =
    (fixed: boolean) =>
    (id: number, cb: Callback): void => {
      const cache = new Map([[1, 'Ann']]);
      if (cache.has(id)) {
        const user = cache.get(id)!;
        if (fixed) {
          queueMicrotask(() => cb(null, user));
          return;
        }
        cb(null, user);
        return;
      }
      setTimeout(() => cb(null, 'from db'), 0);
    };

  /** Тело `load` из `ZALGO_CODE`: подписка стоит ДО присваивания `spinner`. */
  const load = (
    getUser: (id: number, cb: Callback) => void,
    id: number,
    out: string[],
    done: () => void,
  ): void => {
    let spinner: { hide(): void } | null = null;

    getUser(id, (_err, user) => {
      if (spinner) out.push('hide');
      out.push(`render ${user}`);
      done();
    });

    spinner = { hide: () => void out.push('hide') };
    out.push('spinner shown');
  };

  /** Ждём не таймер, а сам колбэк: гонки здесь быть не должно. */
  const run = (fixed: boolean, id: number): Promise<string[]> => {
    const out: string[] = [];
    return new Promise<string[]>((resolve) => {
      load(makeGetUser(fixed), id, out, () => resolve(out));
    });
  };

  const recorded = (key: string) =>
    ZALGO_MODES.find((m) => m.key === key)!.steps.at(-1)!.out.map((o) => o.text);

  it('горячая ветка печатает то же, что записано в последнем шаге демо', async () => {
    expect(await run(false, 1)).toEqual(recorded('hot'));
  });

  it('холодная ветка — тоже', async () => {
    expect(await run(false, 2)).toEqual(recorded('cold'));
  });

  /** Ядро темы: пока починки нет, порядок зависит от кеша — то есть от прошлого. */
  it('до починки порядок в двух ветках разный', async () => {
    const [hot, cold] = [await run(false, 1), await run(false, 2)];

    expect(hot[0], 'в горячей рендер обгоняет спиннер').toBe('render Ann');
    expect(hot, 'скрывать спиннер было некому — hide не вызван').not.toContain('hide');
    expect(cold[0], 'в холодной всё так, как задумывал автор').toBe('spinner shown');
    expect(cold).toContain('hide');
  });

  it('после `queueMicrotask` обе ветки идут одинаково', async () => {
    const shape = (out: string[]) => out.map((line) => line.replace(/^render .+$/, 'render'));
    const [hot, cold] = [await run(true, 1), await run(true, 2)];

    expect(shape(hot)).toEqual(['spinner shown', 'hide', 'render']);
    expect(shape(hot), 'разницы между попаданием и промахом больше нет').toEqual(shape(cold));
    expect(ZALGO_FIX, 'на странице напечатано именно это лечение').toContain('queueMicrotask');
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · асимметрия промиса
// ---------------------------------------------------------------------------

describe('промис асимметричен: исполнитель синхронный, реакции — нет', () => {
  /** Литерал со страницы исполняется целиком и сверяется с обещанием в своей же последней строке. */
  it(`листинг печатает «${promisedOutput(ZALGO_PROMISE)}»`, async () => {
    const out = runListing(ZALGO_PROMISE);
    await flush();
    expect(out.join(', ')).toBe(promisedOutput(ZALGO_PROMISE));
  });

  it('исполнитель выполняется до возврата из `new Promise`', () => {
    const out: string[] = [];
    out.push('до');
    const p = new Promise<void>((resolve) => {
      out.push('исполнитель');
      resolve();
    });
    out.push('после');

    expect(out, 'исполнитель успел встать между «до» и «после»').toEqual(['до', 'исполнитель', 'после']);
    expect(p).toBeInstanceOf(Promise);
  });

  /**
   * Обратная половина: реакция не вызывается синхронно **никогда** — даже у промиса,
   * который уже выполнен. Ради этой гарантии Zalgo и чинят промисом.
   */
  it('`.then` на уже выполненном промисе всё равно ждёт микрозадачу', async () => {
    const out: string[] = [];
    Promise.resolve(42).then((v) => void out.push(`then ${v}`));
    out.push('синхронный хвост');

    expect(out, 'в этот момент реакция ещё только в очереди').toEqual(['синхронный хвост']);
    await flush();
    expect(out).toEqual(['синхронный хвост', 'then 42']);
  });
});

// ---------------------------------------------------------------------------
// Раздел про арность колбэка
// ---------------------------------------------------------------------------

/**
 * Литерал этого примера живёт в `index.mdx` (внутри JSX), а не в `data.ts`, — импортировать
 * его неоткуда, поэтому ожидание записано здесь явно. Разбор по шагам на странице тот же:
 * radix приезжает из второго аргумента `map`, то есть из индекса.
 */
describe('арность: `map` зовёт колбэк тремя аргументами', () => {
  it("['1','2','3'].map(parseInt) → [1, NaN, NaN]", () => {
    expect(['1', '2', '3'].map(parseInt)).toEqual([1, NaN, NaN]);
  });

  it('каждое из трёх значений объясняется своим radix', () => {
    expect(parseInt('1', 0), 'radix 0 — «определи сам»').toBe(1);
    expect(parseInt('2', 1), 'основания 1 не бывает').toBeNaN();
    expect(parseInt('3', 2), 'в двоичной нет цифры 3').toBeNaN();
  });

  it('обёртка, фиксирующая арность, чинит пример целиком', () => {
    expect(['1', '2', '3'].map((s) => parseInt(s, 10))).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Раздел 5 · error-first
// ---------------------------------------------------------------------------

describe(`${pitfall('05').n} · ${pitfall('05').t}`, () => {
  /** Та самая функция без `return` — из листинга тонкого места. */
  const readBroken = (cb: (err: Error | null, data?: string) => void): void => {
    const err = new Error('диск отвалился');
    if (err) cb(err);
    cb(null, undefined);
  };

  it('колбэк вызывается два раза: с ошибкой и «успехом» подряд', () => {
    const seen: string[] = [];
    readBroken((err) => void seen.push(err ? 'err' : 'ok'));

    expect(seen, 'потребитель уже обработал ошибку — и тут же получил успех').toEqual(['err', 'ok']);
    // Ровно этот листинг напечатан в тонком месте, и лечение — первой строкой конвенции.
    expect(pitfall('05').code).toContain('забыли return');
    expect(NODE_ERROR_FIRST).toContain('if (err) return handle(err);');
  });

  /** Однократность у колбэка не встроена — её приходится приносить с собой. */
  const once = <A extends unknown[]>(fn: (...args: A) => void) => {
    let done = false;
    return (...args: A): void => {
      if (done) return;
      done = true;
      fn(...args);
    };
  };

  it('обёртка `once` гасит второй вызов', () => {
    const seen: string[] = [];
    readBroken(once((err: Error | null) => void seen.push(err ? 'err' : 'ok')));
    expect(seen).toEqual(['err']);
  });

  /**
   * ⚠️ Но `once` — не защита, а заглушка. Аргументы вычисляются **до** вызова, и если
   * второй вызов трогает `data`, которого нет, бросок случится раньше, чем обёртка
   * успеет сказать «уже было». Единственное настоящее лечение — `return`.
   */
  it('`once` не спасает, когда аргумент второго вызова вычисляется до него', () => {
    const readWorse = (cb: (err: Error | null, data?: string) => void): void => {
      const err = new Error('диск отвалился');
      const data: string | undefined = undefined;
      if (err) cb(err);
      cb(null, (data as unknown as string).toString());
    };

    let calls = 0;
    expect(() => readWorse(once(() => void (calls += 1)))).toThrow(TypeError);
    expect(calls, 'первый вызов пройти успел — упало на подготовке второго').toBe(1);
  });

  /** Причина, по которой пропущенный `if (err)` роняет процесс: `data` при ошибке пуста. */
  it('без проверки `err` разбор пустого ответа бросает', () => {
    expect(LOST_ROWS[0].code).toContain('JSON.parse(data)');
    expect(() => JSON.parse(undefined as unknown as string)).toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// Раздел 4 · this
// ---------------------------------------------------------------------------

describe('у стрелки нет своего `this` — и это не оборот речи', () => {
  /** Стрелка, созданная внутри функции с известным `this`. */
  const makeArrow = (owner: object) =>
    function (this: unknown) {
      return () => this;
    }.call(owner);

  const owner = { хозяин: true };
  const stranger = { чужой: true };

  it('`call` и `apply` на стрелку не действуют', () => {
    const arrow = makeArrow(owner);
    expect(arrow.call(stranger)).toBe(owner);
    expect(arrow.apply(stranger)).toBe(owner);
  });

  it('`bind` тоже: привязывать нечего', () => {
    const arrow = makeArrow(owner);
    expect(arrow.bind(stranger)()).toBe(owner);
  });

  it('`new` над стрелкой — TypeError', () => {
    const arrow = () => {};
    expect(() => new (arrow as unknown as new () => unknown)()).toThrow(TypeError);
    expect(arrow, 'у стрелки нет и prototype').not.toHaveProperty('prototype');
  });

  /** Обратная сторона: обычный метод, оторванный от объекта, теряет `this` совсем. */
  it('оторванный метод класса получает `this === undefined`, а не объект', () => {
    class Api {
      base = '/v1';
      get(this: Api | undefined): string {
        return `${this!.base}/x`;
      }
    }
    const api = new Api();
    const detached = api.get;

    expect(api.get(), 'с точкой всё на месте').toBe('/v1/x');
    expect(
      // @ts-expect-error — TypeScript не даёт позвать метод без объекта, и он прав.
      // Но написать так в JS никто не мешает, и весь раздел ровно об этом: вызов
      // компилируется у читателя и падает в рантайме. Поймать TypeError можно, только
      // выполнив вызов, — поэтому ошибка здесь подавляется точечно.
      () => detached(),
      'тело метода класса всегда strict — подставлять нечего',
    ).toThrow(TypeError);
    expect(detached.bind(api)(), 'bind возвращает связанную функцию').toBe('/v1/x');
  });
});

/**
 * Раздел «Функция как значение» кончается фразой: колбэк в сообщении воркеру бросает
 * `DataCloneError` ещё у отправителя. Проверяется и сам факт, и то, что фраза на месте.
 */
describe('функция через границу потока не проходит', () => {
  it('колбэк в `postMessage` бросает `DataCloneError` у отправителя', async () => {
    const { MessageChannel } = await import('node:worker_threads');
    const { port1, port2 } = new MessageChannel();
    try {
      let name = '';
      try {
        port1.postMessage({ onDone: () => {} });
      } catch (e) {
        name = (e as Error).name;
      }
      expect(name).toBe('DataCloneError');
      expect(() => structuredClone(() => {})).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    } finally {
      port1.close();
      port2.close();
    }
    const { readFileSync } = await import('node:fs');
    const mdx = readFileSync('src/content/lessons/callbacks/index.mdx', 'utf8');
    expect(mdx).toContain('бросает `DataCloneError` ещё у отправителя');
  });
});
