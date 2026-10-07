import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RateCode, TapePreset } from '@/widgets/rate-lab/model/types';

/**
 * Данные темы «Debounce, throttle и token bucket: бюджет событий во времени».
 *
 * Тема написана 2026-10-02 для направления «Алгоритмы во фронтенде».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `lodash-es` **4.18.1** (из `node_modules` проекта), vitest 5.0.0 (`vi.useFakeTimers`),
 * `@sinonjs/fake-timers` (стоит транзитивно, им же пользуется vitest), Node 24.11.0, октябрь 2026.
 * Скрипты стенда — в scratchpad агента (`agent-rate/`). Настоящих таймерных замеров нет вовсе:
 * всё время в теме — виртуальное, и каждое число воспроизводится одинаково на любой машине.
 *
 * Как снято и чем пересобирается в `tests/unit/rate-limiting.test.ts`:
 *   — **debounce и throttle темы против lodash.** `DEBOUNCE_CODE` и `THROTTLE_CODE` идут на часах
 *     `CLOCK_CODE`, настоящие `debounce`/`throttle` из `lodash-es` — под `vi.useFakeTimers({ now: 0 })`
 *     (подменены `setTimeout`, `clearTimeout` и `Date`), лента событий одна. Сравниваются пары
 *     «момент вызова, номер события, чей аргумент дошёл». Стенд: 300 случайных лент (mulberry32,
 *     зёрна 1…300, по 40 событий) × wait 0/1/30/100/250 × 10 наборов опций debounce и 4 набора
 *     throttle — 21 000 прогонов, расхождений 0. Тест повторяет это на своих 120 зёрнах;
 *   — **ветка «maxWait истёк, а таймер ещё ждёт» в `DEBOUNCE_CODE` не лишняя:** без неё стенд дал
 *     расхождение с lodash уже на первом зерне (wait 250, maxWait 150: вызов в 537 вместо 503).
 *     Тест держит это отдельной проверкой;
 *   — `throttle` в lodash = `debounce(fn, wait, { leading, maxWait: wait, trailing })` — строка из
 *     `lodash-es/throttle.js` (`LODASH_THROTTLE_SRC`) сверяется с файлом, а поведение двух вызовов
 *     lodash — на тех же лентах;
 *   — `DEBOUNCE_ROWS`, `STEADY_ROWS`, `THROTTLE_QUIRK`: вызовы lodash на лентах темы; 21 вызов
 *     `setTimeout` у lodash на ровном потоке из 40 событий — счётчиком подменённого `setTimeout`;
 *   — `throttle` из темы «Колбэки» (`THROTTLE_CODE` той темы) на ленте 0/50/150 — 0, 100, 200:
 *     тест берёт строку прямо из `lessons/callbacks/data.ts`;
 *   — `throttle(fn, wait, { trailing: false })` lodash и ведро жетонов `{ rate: 1000 / wait,
 *     burst: 1 }` пропускают одни и те же события: стенд 500 зёрен × 4 wait, 2000 из 2000;
 *   — ограничители: свойства ведра жетонов (не больше `burst + rate·T` на любом отрезке, 53 из
 *     10 001 под напором), граничный всплеск фиксированного окна (`EDGE_ROWS`) и худшие окна на
 *     2000 случайных лентах (`WINDOW_STATS`: 20 / 17 / 10 при лимите 10);
 *   — `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` без `Date`: lodash не зовёт
 *     функцию ни разу и держит таймер вечно (`FAKE_DATE_NOTE`).
 *
 * Из документации, без проверки запуском: модуль `limit_req` в nginx (описан как «leaky bucket»;
 * `burst` и `nodelay`), выравнивание `requestAnimationFrame` по частоте экрана, описание
 * скользящего счётчика у Cloudflare — ссылки в `SOURCES`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'лента событий',
    d: 'Моменты, когда что-то произошло: нажата клавиша, сдвинулась прокрутка, ушёл запрос к API. Все алгоритмы темы читают такую ленту и решают, какие события пропустить дальше.',
  },
  {
    k: 'обёртка',
    d: 'Функция-посредник. Её зовут на каждое событие, а настоящую функцию она зовёт реже и с аргументами последнего события. Так устроены debounce, throttle и rAF-throttle.',
  },
  {
    k: 'leading и trailing',
    d: 'Два места, где обёртка может позвать функцию: в начале серии событий, сразу на первое (leading), и в конце, когда серия кончилась (trailing).',
  },
  {
    k: '`maxWait`',
    d: 'Потолок ожидания у debounce: сколько бы событий ни шло подряд, функция будет вызвана не позже чем через `maxWait` после прошлого вызова.',
  },
  {
    k: 'rate и burst',
    d: '**rate** — сколько событий можно в среднем за секунду. **burst** — сколько можно сразу подряд, если перед этим было тихо.',
  },
  {
    k: 'окно',
    d: 'Отрезок времени, в котором считают события. **Фиксированное** окно привязано к часам: 0–1000 мс, 1000–2000 мс. **Скользящее** — всегда последние 1000 мс от текущего момента.',
  },
  {
    k: 'виртуальное время',
    d: 'Часы, которые идут только тогда, когда их двигает код. Таймер на 300 мс срабатывает, когда часы довели до 300, а не через 300 настоящих миллисекунд.',
  },
];

export const PLAIN_BUDGET =
  'Как лифт в офисе. Debounce — лифт, который уезжает, когда в двери три секунды никто не входил: пока люди идут, он стоит. Throttle — лифт, который уходит раз в минуту и забирает всех, кто успел. Ведро жетонов — турникет с запасом проходов: накопил — проходи подряд, кончились — жди. Правило у всех одно: не больше столько-то поездок за столько-то времени.';

export const PREREQ_NOTE =
  'Тема начинается там, где кончается базовый разбор debounce и throttle, и опирается на три вещи из других тем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Что такое debounce и throttle',
    d: 'Debounce зовёт функцию, когда поток событий утих; throttle — не чаще раза в `wait`. Опции `leading` и `trailing`, аргументы последнего события, один вызов на одиночное событие — всё это разобрано отдельно. Здесь — что дальше: `maxWait`, устройство lodash и ограничители частоты.',
    href: '/js/callbacks/#s7',
    hrefLabel: '«Колбэки», раздел «Обёртки: debounce и throttle»',
    tone: 'info',
  },
  {
    t: 'Таймер — «не раньше чем»',
    d: '`setTimeout(fn, 300)` кладёт запись в список таймеров и сразу возвращает управление. Функция выполнится не раньше чем через 300 мс, а точнее — когда до неё дойдёт цикл событий.',
    href: '/js/event-loop/#s4',
    hrefLabel: '«Event Loop», раздел «Таймеры»',
    tone: 'info',
  },
  {
    t: 'Кадр и `requestAnimationFrame`',
    d: 'Браузер рисует кадрами, обычно 60 раз в секунду. `requestAnimationFrame(fn)` зовёт `fn` перед следующим кадром — один раз, сколько бы раз ни попросили до него.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Событий много',
    d: 'Одно нажатие клавиши — пять событий, прокрутка колесом — десятки `scroll` в секунду. Обработчик, который на каждое ходит в сеть или пересчитывает раскладку, тормозит страницу.',
    href: '/render/text-input/#s1',
    hrefLabel: '«Ввод текста», раздел «Одно нажатие — пять событий»',
    tone: 'info',
  },
];

// ─── Раздел 1. Виртуальные часы ────────────────────────────────────────────────────────────

export const CLOCK_CODE = `// Виртуальные часы: время идёт только тогда, когда его двигают.
// Таймеры и кадры срабатывают по порядку времени; при равенстве
// сначала таймер, потом кадр, потом событие ленты.
function createClock(frame = 16) {
  let now = 0, nextId = 1;
  const timers = new Map();               // id → { at, fn }
  let frameQueue = [];                    // колбэки requestAnimationFrame
  let frameAt = Infinity;                 // когда ближайший нужный кадр

  function nextTimer(limit) {
    let best = null;
    for (const [id, t] of timers) {
      if (t.at <= limit && (!best || t.at < best.at)) best = { id, ...t };
    }
    return best;
  }

  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;                // при равном at первым идёт старший
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) {
      if (!frameQueue.length) frameAt = (Math.floor(now / frame) + 1) * frame;
      frameQueue.push(fn);
    },
    // Довести часы до t, по дороге исполнив всё, что созрело.
    advanceTo(t) {
      for (;;) {
        const timer = nextTimer(Math.min(t, frameAt));
        if (timer) {
          now = timer.at;
          timers.delete(timer.id);
          timer.fn();
        } else if (frameAt <= t) {
          now = frameAt;
          const batch = frameQueue;
          frameQueue = []; frameAt = Infinity;
          for (const fn of batch) fn(now);
        } else break;
      }
      now = t;
    },
  };
}`;

export const PLAIN_CLOCK =
  'Как съёмка мультфильма по кадру. Аниматор двигает фигурку, щёлкает затвором и только потом двигает дальше: между щелчками в мире ничего не происходит. Здесь так же: пока код не сказал «довести часы до 300», ни один таймер не сработает, и сколько бы ни длился прогон на самом деле, результат будет одним и тем же.';

export const USAGE_CODE = `const clock = createClock();
const calls = [];
const onInput = debounce((v) => calls.push([clock.now(), v]), 300, {}, clock);

for (const [t, v] of [[0, 'к'], [120, 'ко'], [230, 'коф'], [310, 'кофе']]) {
  clock.advanceTo(t);                     // время до события: таймеры по дороге
  onInput(v);                             // само событие
}
clock.advanceTo(2000);
calls;                                    // [[610, 'кофе']]`;

export const USAGE_RESULT: [number, string][] = [[610, 'кофе']];

export const CLOCK_NOTE =
  'Обёртки темы получают часы четвёртым аргументом и берут у них `now`, `setTimeout` и `requestAnimationFrame`. Код обёртки от этого не меняется — меняется только то, откуда приходит время. Тем же приёмом тестируют любой код с таймерами: `vi.useFakeTimers()` в vitest подменяет `setTimeout` и `Date`, и время двигает тест вызовом `vi.advanceTimersByTime`. На таких часах настоящий `debounce` из lodash и функции темы дают одинаковые вызовы на одних и тех же лентах.';

// ─── Раздел 2. Debounce ────────────────────────────────────────────────────────────────────

export const DEBOUNCE_CODE = `// Как debounce в lodash, но часы приходят снаружи (clock).
function debounce(fn, wait, options = {}, clock) {
  const leading = !!options.leading;
  const trailing = options.trailing ?? true;
  const maxing = options.maxWait !== undefined;
  const maxWait = maxing ? Math.max(options.maxWait, wait) : 0;
  let timer = null, lastArgs = null;
  let lastCall, lastInvoke = 0;           // когда звали обёртку и когда — fn

  function invoke(time) {
    const args = lastArgs;
    lastArgs = null;                      // не держать аргумент дольше нужного
    lastInvoke = time;
    fn(...args);
  }

  // Пора вызывать: первый вызов, тишина длиной wait или maxWait без вызова.
  function due(time) {
    return lastCall === undefined || time - lastCall >= wait ||
      (maxing && time - lastInvoke >= maxWait);
  }

  function onTimer() {
    const time = clock.now();
    if (!due(time)) {                     // события шли — спим остаток
      const rest = wait - (time - lastCall);
      timer = clock.setTimeout(onTimer,
        maxing ? Math.min(rest, maxWait - (time - lastInvoke)) : rest);
      return;
    }
    timer = null;                         // конец серии (trailing)
    if (trailing && lastArgs) invoke(time);
    lastArgs = null;
  }

  return function debounced(...args) {
    const time = clock.now();
    const isDue = due(time);
    lastArgs = args;
    lastCall = time;
    if (isDue && timer === null) {        // начало серии (leading)
      lastInvoke = time;
      timer = clock.setTimeout(onTimer, wait);
      if (leading) invoke(time);
      return;
    }
    if (isDue && maxing) {                // maxWait истёк, а таймер заведён на потом
      clock.clearTimeout(timer);
      timer = clock.setTimeout(onTimer, wait);
      invoke(time);
      return;
    }
    if (timer === null) timer = clock.setTimeout(onTimer, wait);
  };
}`;

export const DEBOUNCE_NOTE =
  'Обёртка помнит два момента: `lastCall` — когда её звали последний раз, и `lastInvoke` — когда последний раз звали саму `fn`. Решение «пора» принимает одна функция `due`: либо прошла тишина длиной `wait`, либо с прошлого вызова прошло `maxWait`. Таймер при этом **не переставляют на каждом событии**: он просыпается, смотрит на `lastCall` и, если события шли, засыпает на остаток. На ровном потоке из 40 событий раз в 100 мс lodash ставит 21 таймер, а не 40.';

export const STEADY_TIMERS = 21;

/** Лента «набор текста»: восемь нажатий двумя сериями. Номер события — его аргумент. */
export const TYPING_TAPE = [0, 120, 230, 310, 420, 900, 1010, 1100];

export const TYPING_NOTE = `Восемь нажатий двумя сериями: ${TYPING_TAPE.map((t, i) => `№${i} в ${t}`).join(', ')} мс. Запись «720 мс ← №4» значит: функцию позвали в 720 мс с аргументом события №4.`;

export type CallPair = [number, number];

/** «720 мс ← №4»: вызов в 720 мс с аргументом события №4. */
export const fmtCalls = (calls: CallPair[]) => calls.map(([t, a]) => `${t} мс ← №${a}`).join(', ');

export const DEBOUNCE_ROWS: { k: string; wait: number; opts: { leading?: boolean; trailing?: boolean; maxWait?: number }; calls: CallPair[]; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`debounce(fn, 300)`',
    wait: 300,
    opts: {},
    calls: [[720, 4], [1400, 7]],
    d: 'Два вызова — по одному на серию, через 300 мс после последнего нажатия. Аргумент — последнее событие серии.',
    tone: 'ok',
  },
  {
    k: '`{ leading: true }`',
    wait: 300,
    opts: { leading: true },
    calls: [[0, 0], [720, 4], [900, 5], [1400, 7]],
    d: 'Плюс вызов на первое событие каждой серии: в 0 и в 900. Между 420 и 900 прошло 480 мс — больше `wait`, поэтому 900 начинает новую серию.',
  },
  {
    k: '`{ leading: true, trailing: false }`',
    wait: 300,
    opts: { leading: true, trailing: false },
    calls: [[0, 0], [900, 5]],
    d: 'Только начало серий. Последнее значение поля до функции не доходит — для подсказок поиска это неверный ответ.',
    tone: 'warn',
  },
  {
    k: '`{ maxWait: 600 }`',
    wait: 300,
    opts: { maxWait: 600 },
    calls: [[600, 4], [1400, 7]],
    d: 'Первая серия длилась бы до 720, но через 600 мс без вызова сработал потолок. Вторая серия короче 600 мс — потолок не нужен.',
  },
];

export const PLAIN_MAXWAIT =
  'Как маршрутка, которая ждёт, пока соберутся пассажиры. Если люди подходят каждую минуту, обычный debounce не уедет никогда: после каждого нового пассажира он снова ждёт. `maxWait` — расписание поверх ожидания: «но не дольше десяти минут с прошлого рейса».';

/** Ровный поток: 40 событий раз в 100 мс — прокрутка, перетаскивание, долгий ввод. */
export const STEADY_TAPE = Array.from({ length: 40 }, (_, i) => i * 100);

export const STEADY_ROWS: { k: string; wait: number; opts: { maxWait?: number }; calls: CallPair[]; tone?: 'ok' | 'warn' | 'err'; d: string }[] = [
  {
    k: '`debounce(fn, 300)`',
    wait: 300,
    opts: {},
    calls: [[4200, 39]],
    tone: 'err',
    d: 'Пауз длиннее 300 мс нет — четыре секунды функция молчит, потом один вызов.',
  },
  {
    k: '`{ maxWait: 1000 }`',
    wait: 300,
    opts: { maxWait: 1000 },
    calls: [[1000, 9], [2000, 19], [3000, 29], [4000, 39]],
    tone: 'ok',
    d: 'Раз в секунду, с последним событием на тот момент. После 4000 событий не было — 4200 уже ничего не добавляет.',
  },
];

export const MAXWAIT_NOTE =
  '`maxWait` меньше `wait` не бывает: lodash молча поднимает его до `wait` — строка `Math.max(options.maxWait, wait)` в коде выше. `debounce(fn, 300, { maxWait: 100 })` ведёт себя как `maxWait: 300`, а это уже throttle.';

// ─── Раздел 3. Throttle ────────────────────────────────────────────────────────────────────

/** Дословно из `node_modules/lodash-es/throttle.js` — тест сверяет с файлом. */
export const LODASH_THROTTLE_SRC = `  return debounce(func, wait, {
    'leading': leading,
    'maxWait': wait,
    'trailing': trailing
  });`;

export const THROTTLE_CODE = `// Ровно так throttle устроен в lodash: debounce, у которого maxWait = wait.
function throttle(fn, wait, options = {}, clock) {
  return debounce(fn, wait, {
    leading: options.leading ?? true,
    trailing: options.trailing ?? true,
    maxWait: wait,
  }, clock);
}`;

export const THROTTLE_NOTE =
  'В lodash нет отдельного throttle. Есть debounce с потолком, равным самому ожиданию: ждать тишины `wait`, но не дольше `wait` с прошлого вызова. Отсюда и поведение: на ровном потоке потолок срабатывает каждые `wait`, а `leading` по умолчанию включён, чтобы первое событие не ждало.';

export const THROTTLE_QUIRK = {
  tape: [0, 50, 150],
  wait: 100,
  lodash: [[0, 0], [100, 1], [150, 2]] as CallPair[],
  callbacks: [[0, 0], [100, 1], [200, 2]] as CallPair[],
};

export const QUIRK_TABLE = {
  head: ['throttle', `вызовы на ленте ${THROTTLE_QUIRK.tape.join(', ')} мс, wait ${THROTTLE_QUIRK.wait}`],
  rows: [
    ['lodash', fmtCalls(THROTTLE_QUIRK.lodash)],
    ['самописный из «Колбэков»', fmtCalls(THROTTLE_QUIRK.callbacks)],
  ],
  tones: ['warn', undefined] as ('warn' | undefined)[],
};

export const QUIRK_NOTE =
  'Три события: 0, 50 и 150 мс, `throttle(fn, 100)`. Lodash зовёт функцию в 0, 100 и **150** — между двумя последними вызовами 50 мс, вдвое меньше `wait`. Причина в debounce внутри. Вызов в 100 закрыл серию, а событие в 150 пришло через 100 мс после предыдущего события (50) — это тишина длиной `wait`, значит, новая серия, и `leading` зовёт сразу. Самописный throttle из [«Колбэков»](/js/callbacks/#s7) после вызова в конце окна открывает новое окно и на той же ленте зовёт в 0, 100 и 200. Обе версии честно обещают «не чаще раза в `wait`» на ровном потоке, но расходятся на стыке серий.';

// ─── Раздел 4. Раз в кадр ──────────────────────────────────────────────────────────────────

export const RAF_CODE = `// Не чаще раза за кадр: вызов уходит в ближайший кадр с последними аргументами.
function rafThrottle(fn, clock) {
  let queued = false, lastArgs = null;
  return function (...args) {
    lastArgs = args;
    if (queued) return;                   // кадр уже заказан — только обновить аргументы
    queued = true;
    clock.requestAnimationFrame(() => {
      queued = false;
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    });
  };
}`;

export const RAF_FACTS = [
  {
    t: 'Шаг задаёт экран, а не вы',
    d: 'У `rafThrottle` нет параметра `wait`. Кадр идёт с частотой экрана: на 60 Гц это 16,7 мс, на 120 Гц — 8,3. Для всего, что двигает картинку, это и есть нужный шаг: чаще обновлять бессмысленно, реже — видно рывки.',
  },
  {
    t: 'Вызов — перед кадром',
    d: 'Функция выполняется в начале отрисовки кадра, где размеры прошлого кадра ещё актуальны: читать раскладку и писать стили там дёшево. Почему — в [«Кадре браузера»](/render/render-pipeline/#s3).',
  },
  {
    t: 'В скрытой вкладке — ни одного вызова',
    d: 'Вкладку свернули — кадры не рисуются, и `rAF` не вызывается вовсе. Последнее событие дождётся возвращения пользователя. Для анимации это правильно, для отправки данных — нет. Подробно — в [«Планировании задач»](/js/task-scheduling/#s4).',
    tone: 'warn' as const,
  },
];

export const RAF_NOTE =
  'Демо идёт на часах темы: кадр каждые 16 мс (округлённые 60 Гц), а не по настоящему экрану.';

/** Ленты демо. Все моменты — в мс, по возрастанию. */
export const TAPES: TapePreset[] = [
  {
    id: 'typing',
    label: 'Набор текста',
    times: TYPING_TAPE,
    note: 'Две серии нажатий с паузой. Debounce даёт вызов на серию, throttle — несколько, rAF — на каждое нажатие: паузы между ними длиннее кадра.',
  },
  {
    id: 'scroll',
    label: 'Прокрутка',
    times: Array.from({ length: 51 }, (_, i) => i * 12),
    note: 'Событие каждые 12 мс в течение 600 мс. Debounce молчит до конца, throttle зовёт раз в `wait`, rAF — раз в кадр: событий больше, чем кадров.',
  },
  {
    id: 'edge',
    label: 'У границы окна',
    times: [200, 500, 900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080, 1600, 1900],
    note: 'Десять событий подряд с 900 до 1080 мс — половина до границы секунды, половина после. Фиксированное окно делит всплеск между двумя секундами и каждую считает отдельно, поэтому при `rate` до пяти его худшая секунда ровно вдвое больше лимита.',
  },
];

export const WRAP_CAPTION =
  'Метка на дорожке — вызов функции, число над ней — номер события, чей аргумент дошёл. С ростом `wait` debounce сливает серии в одну, а на ровном потоке молчит до конца; throttle продолжает звать раз в `wait`; rAF от `wait` не зависит вовсе. С `maxWait` появляется дорожка debounce с потолком.';

// ─── Раздел 5. Ведро жетонов ───────────────────────────────────────────────────────────────

export const PLAIN_TOKEN =
  'Как проездной с подзарядкой. В кошельке помещается не больше трёх поездок, и каждые двести миллисекунд туда капает ещё одна. Пришли трое сразу — прошли все, кошелёк пуст. Четвёртый ждёт, пока капнет. Долго никого не было — кошелёк полон, но не больше трёх.';

export const TOKEN_CODE = `// rate — жетонов в секунду, burst — ёмкость ведра.
// Считаем в тысячных долях жетона: тогда за 1 мс приходит ровно rate,
// и вся арифметика целая.
function createTokenBucket({ rate, burst }) {
  const cap = burst * 1000;
  let level = cap, last = 0;              // ведро с самого начала полное

  function refill(now) {
    level = Math.min(cap, level + (now - last) * rate);
    last = now;
  }
  return {
    take(now) {
      refill(now);
      if (level < 1000) return false;     // целого жетона нет — отказ
      level -= 1000;
      return true;
    },
    tokens(now) { refill(now); return level / 1000; },
  };
}`;

export const TOKEN_NOTE =
  'Таймеров у ведра нет. Оно не «капает» в фоне, а досчитывает жетоны при каждом обращении: сколько миллисекунд прошло, умножить на скорость, обрезать по ёмкости. Поэтому ведро на тысячу пользователей — это тысяча пар чисел `level` и `last`, а не тысяча таймеров.';

export const TOKEN_FACTS = [
  {
    t: 'На любом отрезке — не больше burst + rate · T',
    d: 'За любые T секунд ведро пропустит не больше `burst` из запаса плюс `rate · T` новых. Ни при какой ленте событий — это свойство самого счёта.',
  },
  {
    t: 'Под напором — ровно rate',
    d: 'Событие каждую миллисекунду с 0 по 10 000, `rate` 5, `burst` 3: прошло 53 — три из запаса и по пять за каждую из десяти секунд.',
  },
  {
    t: 'Throttle без trailing — то же ведро',
    d: 'Ведро с `burst: 1` и `rate: 1000 / wait` пропускает ровно те события, на которые зовёт `throttle(fn, wait, { trailing: false })` из lodash. Разница в том, что делать с остальными: throttle с `trailing` запомнит последнее и позовёт позже, ведро просто откажет.',
    tone: 'info' as const,
  },
];

export const TOKEN_SATURATION = { rate: 5, burst: 3, until: 10_000, passed: 53 };

// ─── Раздел 6. Дырявое ведро ───────────────────────────────────────────────────────────────

export const PLAIN_LEAKY =
  'Как кофейня с одним бариста. Он делает чашку за минуту, сколько бы людей ни пришло. Очередь у стойки — на четверых; пятый, увидев полную очередь, уходит. Ведро жетонов пропустило бы всю компанию сразу, а здесь каждый получает кофе ровно через минуту после предыдущего.';

export const LEAKY_CODE = `// Ведро-очередь: выпускает по одному раз в 1000 / rate мс.
// capacity — сколько запросов может ждать своей очереди.
function createLeakyBucket({ rate, capacity }) {
  const gap = 1000 / rate;
  let free = 0;                           // когда выход освободится
  return {
    // Время выхода из ведра или null, если ведро полно.
    offer(now) {
      const start = Math.max(now, free);
      if (start - now > capacity * gap) return null;
      free = start + gap;
      return start;
    },
  };
}`;

export const LEAKY_NOTE =
  'Средняя скорость та же, что у ведра жетонов, но выход другой: запросы выходят **ровно раз в `1000 / rate` мс**, а лишние ждут в очереди. Всплеска на выходе не бывает никогда — зато появляется задержка, и чем длиннее очередь, тем она больше. Ведро жетонов ограничивает среднюю скорость, дырявое — ещё и промежуток между любыми двумя запросами.';

export const LEAKY_METER_NOTE =
  'Есть и второй вид дырявого ведра — без очереди: вода (запросы) вытекает с постоянной скоростью, а то, что не помещается, отбрасывается сразу. Такое ведро принимает ровно те же решения, что ведро жетонов той же ёмкости: свободное место в одном — это жетоны в другом.';

export const NGINX_NOTE =
  'Модуль `limit_req` в nginx документация описывает как leaky bucket. `burst` там — длина очереди: лишние запросы ждут и выходят с заданной скоростью. С флагом `nodelay` запросы из очереди обслуживаются сразу, а места в ней освобождаются с той же скоростью — то есть по сути получается ведро жетонов.';

// ─── Раздел 7. Окна ────────────────────────────────────────────────────────────────────────

export const PLAIN_WINDOW =
  'Как лимит «пять звонков в час» на старом тарифе. Счётчик обнуляется ровно в начале часа. Пять звонков в 9:59 и пять в 10:00 — десять за две минуты, и тариф доволен: в каждом часу по пять. Скользящее окно спрашивает иначе: сколько звонков было за последние шестьдесят минут от этой секунды.';

export const FIXED_CODE = `// Не больше limit за окно; окна идут по часам: [0, W), [W, 2W), ...
function createFixedWindow({ limit, window }) {
  let start = -1, count = 0;
  return {
    take(now) {
      const w = Math.floor(now / window) * window;
      if (w !== start) { start = w; count = 0; }   // новое окно — счёт с нуля
      if (count >= limit) return false;
      count++;
      return true;
    },
  };
}`;

export const SLIDING_LOG_CODE = `// Помним время каждого пропущенного; окно — последние window мс.
function createSlidingLog({ limit, window }) {
  const log = [];
  return {
    take(now) {
      while (log.length && log[0] <= now - window) log.shift();
      if (log.length >= limit) return false;
      log.push(now);
      return true;
    },
  };
}`;

export const SLIDING_COUNTER_CODE = `// Два счётчика: прошлое окно и текущее. Прошлое берём с весом —
// той долей, на которую скользящее окно ещё заходит в него.
function createSlidingCounter({ limit, window }) {
  let start = 0, prev = 0, curr = 0;
  return {
    take(now) {
      const w = Math.floor(now / window) * window;
      if (w !== start) {
        prev = w - start === window ? curr : 0;   // окно пропущено целиком — 0
        curr = 0;
        start = w;
      }
      const weight = (window - (now - w)) / window;
      if (prev * weight + curr >= limit) return false;
      curr++;
      return true;
    },
  };
}`;

/** Десять событий с 900 по 1080 мс, лимит 5 в секунду. */
export const EDGE_TAPE = [900, 920, 940, 960, 980, 1000, 1020, 1040, 1060, 1080];

export const EDGE_ROWS: { k: string; id: 'fixed' | 'log' | 'counter' | 'token' | 'leaky'; passed: number; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'фиксированное окно',
    id: 'fixed',
    passed: 10,
    d: 'Пять в окне 0–1000 и пять в окне 1000–2000. Каждое окно в лимите, а за 180 мс прошло вдвое больше.',
    tone: 'err',
  },
  {
    k: 'скользящий журнал',
    id: 'log',
    passed: 5,
    d: 'В 1000 мс в журнале уже пять записей моложе секунды — дальше отказ.',
    tone: 'ok',
  },
  {
    k: 'скользящий счётчик',
    id: 'counter',
    passed: 6,
    d: 'В 1000 мс прошлое окно (5 событий) берётся с весом 1, отказ. В 1020 вес 0,98: 4,9 меньше 5 — шестое прошло.',
    tone: 'warn',
  },
  {
    k: 'ведро жетонов, rate 5, burst 5',
    id: 'token',
    passed: 5,
    d: 'Пять из запаса сразу. Новый жетон копится 200 мс, а события кончились раньше.',
    tone: 'ok',
  },
  {
    k: 'дырявое ведро, rate 5, очередь 4',
    id: 'leaky',
    passed: 5,
    d: 'Тоже пять, но выходят они в 900, 1100, 1300, 1500 и 1700: последний ждал 720 мс.',
    tone: 'ok',
  },
];

export const LEAKY_EDGE_OUT = [900, 1100, 1300, 1500, 1700];

export const WINDOW_STATS: { k: string; id: 'fixed' | 'counter' | 'log'; worst: number; memory: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'фиксированное окно', id: 'fixed', worst: 20, memory: 'два числа', tone: 'err' },
  { k: 'скользящий счётчик', id: 'counter', worst: 17, memory: 'три числа', tone: 'warn' },
  { k: 'скользящий журнал', id: 'log', worst: 10, memory: 'до `limit` моментов', tone: 'ok' },
];

export const WINDOW_STATS_SETUP = { tapes: 2000, events: 200, limit: 10, window: 1000 };

export const WINDOW_NOTE =
  'Лимит 10 в секунду, 2000 случайных лент по 200 событий. В таблице — сколько событий каждый алгоритм пропустил за худшие 1000 мс подряд. Фиксированное окно упирается ровно в удвоенный лимит. Скользящий счётчик предполагает, что события в прошлом окне шли равномерно; когда они сбились в его конец, они ещё целиком внутри скользящей секунды, а вес уже считает их наполовину ушедшими — и проходит больше лимита. Точен только журнал — ценой памяти.';

export const LIMIT_CAPTION =
  'Зелёная метка — событие пропущено, красная — отказ; у дырявого ведра зелёная черта тянется от прихода запроса до его выхода. Линия на дорожке ведра жетонов — запас жетонов: падает на каждом пропущенном событии и растёт со скоростью `rate`. Вертикальные черты — границы секунд, по ним считает фиксированное окно. «Худшая секунда» — сколько пропущено за худшие 1000 мс подряд. `rate` — и скорость вёдер, и лимит окон за секунду; `burst` — запас ведра жетонов и длина очереди дырявого.';

// ─── Раздел 8. Один бюджет ─────────────────────────────────────────────────────────────────

export const BUDGET_ROWS: { k: string; budget: string; extra: string; where: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  { k: 'debounce', budget: 'один вызов на серию', extra: 'сливается в вызов в конце серии', where: 'подсказки поиска, автосохранение, проверка поля' },
  { k: 'debounce + maxWait', budget: 'один вызов на серию, но не реже раза в `maxWait`', extra: 'сливается в ближайший вызов', where: 'автосохранение при долгом вводе' },
  { k: 'throttle', budget: 'один вызов на `wait`', extra: 'сливается в вызов в конце окна', where: 'прокрутка, `resize`, аналитика' },
  { k: 'rAF-throttle', budget: 'один вызов на кадр', extra: 'сливается в вызов перед кадром', where: 'перетаскивание, всё, что двигает картинку' },
  { k: 'ведро жетонов', budget: '`burst` сразу, дальше `rate` в секунду', extra: 'отказ', where: 'клиент API с лимитом, кнопка «повторить»' },
  { k: 'дырявое ведро', budget: 'ровно `rate` в секунду', extra: 'ждёт в очереди; очередь полна — отказ', where: 'очередь запросов к API с жёстким темпом' },
  { k: 'окна', budget: '`limit` за окно', extra: 'отказ', where: 'счётчики на сервере, квоты' },
];

export const BUDGET_NOTE =
  'Все строки таблицы отвечают на два вопроса: **сколько событий пропустить за отрезок времени** и **что делать с лишними**. Обёртки лишнее не теряют — они сливают его в один вызов с последними данными, потому что для интерфейса важно последнее состояние. Ограничители лишнее отклоняют или ставят в очередь, потому что за каждым запросом стоит работа, которую нельзя слить: два платежа — не один.';

export const SERVER_NOTE =
  'На клиенте ведро помогает не стучаться в API, который всё равно откажет. Но защитой оно не является: у каждой вкладки своё ведро, а скрипт мимо браузера его не заметит вовсе. Настоящий лимит стоит на сервере, а клиентское ведро — вежливость к нему.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const FAKE_DATE_NOTE =
  'Тест подменил только таймеры: `vi.useFakeTimers({ toFake: [\'setTimeout\', \'clearTimeout\'] })`. Lodash узнаёт время через `Date.now()`, а он настоящий и за прогон почти не сдвинулся. Таймер просыпается, видит «тишины ещё не было» и засыпает снова. Итог на ленте из восьми нажатий — ни одного вызова и вечно взведённый таймер.';

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'На ровном потоке debounce молчит',
    d: 'Событие раз в 100 мс, `debounce(fn, 300)`: четыре секунды без единого вызова. Если поток может не прерываться — прокрутка, перетаскивание, долгий ввод, — нужен `maxWait` или throttle.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Throttle из lodash зовёт чаще, чем раз в wait',
    d: 'На ленте 0, 50, 150 мс `throttle(fn, 100)` зовёт в 0, 100 и 150. Это throttle как debounce с потолком: после паузы длиной `wait` начинается новая серия. Если важен жёсткий интервал между вызовами — ведро жетонов или свой throttle с окнами.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'maxWait меньше wait молча поднимается',
    d: '`debounce(fn, 300, { maxWait: 100 })` ведёт себя как `maxWait: 300`. Ошибки нет, предупреждения нет — вызовы просто реже, чем вы рассчитывали.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Фальшивые таймеры без фальшивого Date',
    d: FAKE_DATE_NOTE + ' В vitest `vi.useFakeTimers()` по умолчанию подменяет и `Date` — не сужайте список `toFake`, не проверив, откуда библиотека берёт время.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Фиксированное окно пропускает вдвое больше',
    d: 'Лимит 5 в секунду, десять событий с 900 по 1080 мс — прошли все десять. На случайных лентах худшая секунда упирается ровно в удвоенный лимит. Окно по часам считает «в этой секунде», а не «за последнюю секунду».',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Скользящий счётчик — приближение',
    d: 'Он считает события прошлого окна равномерно размазанными. При лимите 10 на случайных лентах худшая секунда дала 17. Для честного «не больше N за любую секунду» нужен журнал — или ведро жетонов, у которого предел `burst + rate · T` строгий.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'rAF в скрытой вкладке не вызывается',
    d: 'Обёртка на `requestAnimationFrame` в фоне не позовёт функцию ни разу — последнее событие ждёт возвращения пользователя. Отправку данных на rAF не вешают.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Ведро на клиенте — не защита',
    d: 'У каждой вкладки своё ведро, у скрипта без браузера — никакого. Клиентский лимит бережёт сервер от лишних запросов, но решать, кого пускать, обязан сам сервер.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'lodash — `_.debounce`',
    href: 'https://lodash.com/docs/4.17.15#debounce',
    what: '`leading`, `trailing`, `maxWait`, `cancel`, `flush`; на стенде `lodash-es` 4.18.1',
  },
  {
    title: 'lodash — `_.throttle`',
    href: 'https://lodash.com/docs/4.17.15#throttle',
    what: 'опции throttle; в исходнике это вызов `debounce` с `maxWait: wait`',
  },
  {
    title: 'Debouncing and Throttling Explained Through Examples',
    href: 'https://css-tricks.com/debouncing-throttling-explained-examples/',
    what: 'классический разбор с картинками, в том числе `maxWait` и `requestAnimationFrame`',
  },
  {
    title: 'MDN — `Window.requestAnimationFrame()`',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame',
    what: 'частота вызова совпадает с частотой экрана; в фоновых вкладках вызовы приостанавливаются',
  },
  {
    title: 'Vitest — `vi.useFakeTimers`',
    href: 'https://vitest.dev/api/vi.html#vi-usefaketimers',
    what: 'фальшивые таймеры и `Date`, опция `toFake`',
  },
  {
    title: 'Token bucket',
    href: 'https://en.wikipedia.org/wiki/Token_bucket',
    what: 'алгоритм ведра жетонов и его связь с дырявым ведром',
  },
  {
    title: 'Leaky bucket',
    href: 'https://en.wikipedia.org/wiki/Leaky_bucket',
    what: 'два вида: ведро-счётчик и ведро-очередь',
  },
  {
    title: 'nginx — модуль `ngx_http_limit_req_module`',
    href: 'https://nginx.org/en/docs/http/ngx_http_limit_req_module.html',
    what: '`limit_req`, `burst`, `nodelay`; алгоритм назван leaky bucket',
  },
  {
    title: 'Cloudflare — How we built rate limiting capable of scaling to millions of domains',
    href: 'https://blog.cloudflare.com/counting-things-a-lot-of-different-things/',
    what: 'скользящий счётчик из двух окон и вес прошлого окна',
  },
  {
    title: 'Stripe — Scaling your API with rate limiters',
    href: 'https://stripe.com/blog/rate-limiters',
    what: 'ведро жетонов на сервере, разные лимитеры для разных задач',
  },
];

export const RELATED =
  'Смежное на сайте: [Колбэки, раздел «Обёртки: debounce и throttle»](/js/callbacks/#s7) — основы, `leading`/`trailing` и утечка через `lastArgs`. [Кадр браузера](/render/render-pipeline/#s1) — где в кадре стоит `requestAnimationFrame`. [Планирование задач, раздел «Фоновая вкладка, заморозка и bfcache»](/js/task-scheduling/#s4) — почему rAF и таймеры замирают в фоне. [Ввод текста](/render/text-input/#s1) и [События DOM, раздел «Пассивные слушатели»](/render/dom-events/#s6) — откуда берутся частые события. [Event Loop, раздел «Таймеры»](/js/event-loop/#s4) — что значит задержка `setTimeout`. [Планировщики](/algorithms/schedulers/) — ещё один алгоритм, который делит время потока. [Очереди и идемпотентность, раздел «Зачем очередь»](/data/queues/#s1) — очередь как буфер между быстрым и медленным, родственник дырявого ведра. [Ограничение частоты в API](/platform/rate-limits/) — 429 и `Retry-After`, джиттер, бюджет повторов и `RetryAgent` из undici.';

/** Код темы, который исполняет демо (`widgets/rate-lab`). */
export const RATE_CODE: RateCode = {
  clock: CLOCK_CODE,
  debounce: DEBOUNCE_CODE,
  throttle: THROTTLE_CODE,
  raf: RAF_CODE,
  token: TOKEN_CODE,
  leaky: LEAKY_CODE,
  fixed: FIXED_CODE,
  log: SLIDING_LOG_CODE,
  counter: SLIDING_COUNTER_CODE,
};
