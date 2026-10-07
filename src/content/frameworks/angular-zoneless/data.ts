import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { ConfigKey, Scenario, ScenarioId, StandRun } from '@/widgets/zone-lab/model/types';

/**
 * Данные темы «Angular без zone.js: от монки-патчей к сигналам».
 *
 * Тема написана здесь, 2026-10-01, для направления «Фреймворки изнутри».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@angular/core`, `@angular/compiler`, `@angular/common`, `@angular/platform-browser` **21.2.25**,
 * `zone.js` **0.16.3**, esbuild 0.28.2, Chromium 153.0.8010.12 (Playwright 1.63), Node 24.11.0 —
 * всё из `node_modules` проекта. Октябрь 2026.
 *
 * Приложение — `ANGULAR_APP_CODE` ниже, четыре компонента. Собирается esbuild'ом в один IIFE
 * (TypeScript с `experimentalDecorators`, JIT: `@angular/compiler` в бандле — компилятора
 * шаблонов заранее, `ngc`, в проекте нет) с одним из двух входов `BOOT_ZONE_CODE` /
 * `BOOT_ZONELESS_CODE` и запускается в Chromium. Стенд подменяет модуль
 * `@angular/platform-browser` обёрткой: та вызывает `enableProdMode()` (иначе каждый шаблон
 * выполняется дважды — вторым проходом `checkNoChanges`, см. `DEV_FACTS`), оборачивает
 * `ApplicationRef._tick` счётчиком и выносит наружу корневой компонент и `NgZone.run`.
 * Модуль `./stand` даёт счётчик `hit` (сколько раз выполнился шаблон), массив `effects`
 * и стратегию — `Default` или `OnPush` для всех четырёх компонентов сразу.
 *
 * Сценарии (`SCENARIOS`) запускаются на **свежей** странице. Код приложения запускается
 * через `ngZone.run(…)`, как будто его вызвал компонент; тик, который даёт сам выход из
 * `run`, не считается — счётчики обнуляются сразу после. Клики и `mousemove` — настоящий
 * ввод мыши Playwright (курсор подводится заранее, его `mousemove` тоже не в счёт).
 * Итог снят через 30 мс + кадр + 30 мс после действия: `STAND`. Сценарий
 * `awaitFieldLowered` — тот же клик `awaitField`, но бандл собран с
 * `supported: { 'async-await': false }`, как это делает Angular CLI при zone.js.
 *
 * zone.js отдельно: `bundles/zone.umd.js` на пустой странице Chromium, до него запоминаются
 * исходные функции — `PATCH_ROWS`, `PATCH_FACTS`, `CONTEXT_ROWS`.
 *
 * Без запуска, по исходникам:
 *   — `node_modules/@angular/core` 21.2.25: `NgZoneChangeDetectionScheduler` (тик по
 *     `onMicrotaskEmpty`), `checkStable`, `ChangeDetectionSchedulerImpl.notify` и
 *     `scheduleCallbackWithRafRace`, `ZONELESS_ENABLED` с фабрикой `() => true`,
 *     `markViewDirty`, `detectChangesInView`; `@angular/common` — `AsyncPipe` зовёт
 *     `markForCheck`. Тест проверяет, что эти места в исходнике на месте;
 *   — `@angular/build` **21.2.24** (в проекте не установлен; tarball скачан в каталог стенда
 *     и прочитан): `getFeatureSupport(target, nativeAsyncAwait)` ставит esbuild
 *     `'async-await': nativeAsyncAwait`, а `isZonelessApp(polyfills)` считает приложение
 *     работающим без зоны, если в `polyfills` нет `zone.js`. Это — `CLI_CODE`, цитата, а не запуск.
 *
 * Всё перечисленное, кроме CLI, пересобирается и перезапускается
 * `tests/unit/angular-zoneless.test.ts`. Там же мини-версия (`ZONE_CODE`, `SCHEDULER_CODE`,
 * `TREE_CODE` через `widgets/zone-lab/model/run.ts`) прогоняется на тех же десяти сценариях
 * в четырёх конфигурациях и сверяется со `STAND`: тики, запуски шаблонов, текст на экране.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'проверка изменений (change detection)',
    d: 'Проход по дереву компонентов: Angular выполняет шаблон компонента, сравнивает каждое значение с прошлым и правит в DOM только то, что поменялось. Сам по себе проход ничего не знает о том, *что* изменилось, — он просто сверяет всё, что ему велели проверить.',
  },
  {
    k: '`tick`',
    d: 'Один запуск проверки от корня приложения — метод `ApplicationRef.tick()`. Вопрос темы — кто и когда его вызывает.',
  },
  {
    k: 'зона (zone.js)',
    d: 'Библиотека, которая подменяет асинхронные функции браузера и запоминает, из какой «зоны» был запланирован каждый колбэк. Angular держит свою зону и узнаёт через неё, что внутри приложения что-то выполнилось.',
  },
  {
    k: 'monkey-patch (подмена)',
    d: 'Замена чужой функции своей обёрткой прямо на глобальном объекте: `window.setTimeout = обёртка`. Код приложения зовёт `setTimeout` как обычно и не знает, что звонит в обёртку.',
  },
  {
    k: '`OnPush`',
    d: 'Стратегия компонента: «проверяй меня, только если меня пометили». Пометку ставят событие в его шаблоне, `markForCheck()`, новое значение входного свойства и изменившийся сигнал, который читал шаблон.',
  },
  {
    k: 'zoneless',
    d: 'Режим без zone.js. Проверку заказывает не зона, а тот, кто знает об изменении: сигнал, обработчик из шаблона, `markForCheck`. В Angular 21 он включён по умолчанию.',
  },
];

export const PLAIN_TICK =
  'Как охранник, который не знает, что в здании поменялось, и после каждого звонка в дверь обходит все комнаты подряд. Ничего не пропустит — но обходит и тогда, когда звонил курьер не по адресу. Без зоны охранник сидит на месте, пока ему не скажут «в 12-й комнате переставили стол», — и идёт только туда.';

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Задачи и микрозадачи',
    d: 'Браузер выполняет задачи по одной: таймер, клик, ответ сети. После каждой он выполняет все микрозадачи — колбэки `then` и `queueMicrotask`. Зона ловит ровно этот момент: «задача и её микрозадачи кончились».',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Оборот»',
    tone: 'info',
  },
  {
    t: 'Сигналы',
    d: 'Значение, которое помнит, кто его читал. Запись помечает читателей «грязными», пересчёт тянут те, кому значение понадобилось. Здесь сигнал — только источник пометки для компонента.',
    href: '/frameworks/signals/#s1',
    hrefLabel: '«Сигналы: третья модель реактивности», раздел «Сигнал»',
    tone: 'info',
  },
  {
    t: 'Как `await` продолжает функцию',
    d: '`await x` превращает `x` в промис и подписывает на него продолжение функции. Подписывает сам движок, внутренней операцией, а не вызовом глобального `Promise.prototype.then`, — на этом и спотыкается зона.',
    href: '/js/promise-internals/#s2',
    hrefLabel: '«Промис изнутри», раздел «Операции»',
    tone: 'info',
  },
  {
    t: 'Сборка переписывает `async` в генератор',
    d: 'Транспилятор может записать `async`-функцию генератором и обвязкой на промисах. После этого продолжение идёт через обычный `Promise.then`.',
    href: '/tooling/transpilation/#s3',
    hrefLabel: '«Транспиляция и полифилы», раздел «Во что превращается синтаксис»',
    tone: 'info',
  },
];

// ─── Раздел 1. Шаблон читает обычные поля ──────────────────────────────────────────────────

/**
 * Сквозной пример. Ровно этот текст собирает стенд теста — модуль `./stand` и обёртку
 * `@angular/platform-browser` подставляет плагин esbuild (см. шапку файла).
 */
export const ANGULAR_APP_CODE = `import { ChangeDetectorRef, Component, ViewChild, effect, inject, signal } from '@angular/core';
import { effects, hit, strategy } from './stand'; // счётчики стенда; strategy — Default или OnPush

@Component({
  selector: 'app-counter',
  changeDetection: strategy,
  template: \`<button id="inc" (click)="inc()">+</button>{{ hit('Counter') }}{{ count() }}\`,
})
export class Counter {
  hit = hit;
  count = signal(0);
  constructor() {
    effect(() => effects.push(this.count()));
  }
  inc() {
    this.count.set(this.count() + 1);
  }
}

@Component({
  selector: 'app-clock',
  changeDetection: strategy,
  template: \`<button id="load" (click)="load()">поле</button>
    <button id="load2" (click)="loadSignal()">сигнал</button>
    {{ hit('Clock') }}<span id="label">{{ label }}</span><span id="status">{{ status() }}</span>\`,
})
export class Clock {
  hit = hit;
  label = 'старое';            // обычное поле: о его записи Angular не узнает
  status = signal('ждём');
  cdr = inject(ChangeDetectorRef);
  constructor() {
    document.addEventListener('mousemove', () => {}); // слушатель, который ничего не меняет
  }
  async load() {
    await new Promise((r) => setTimeout(r, 10));
    this.label = 'загружено';
  }
  async loadSignal() {
    await new Promise((r) => setTimeout(r, 10));
    this.status.set('загружено');
  }
}

@Component({
  selector: 'app-list',
  changeDetection: strategy,
  template: \`{{ hit('List') }}{{ items().length }}\`,
})
export class List {
  hit = hit;
  items = signal([1, 2, 3]);
}

@Component({
  selector: 'app-root',
  changeDetection: strategy,
  imports: [Counter, Clock, List],
  template: \`{{ hit('App') }}<app-counter /><app-clock /><app-list />\`,
})
export class App {
  hit = hit;
  @ViewChild(Counter) counter!: Counter;
  @ViewChild(Clock) clock!: Clock;
  @ViewChild(List) list!: List;
}
`;

export const BOOT_ZONE_CODE = `import 'zone.js';
import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app';

bootstrapApplication(App, { providers: [provideZoneChangeDetection()] });
`;

export const BOOT_ZONELESS_CODE = `import { provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app';

bootstrapApplication(App, { providers: [provideZonelessChangeDetection()] });
`;

export const APP_NOTE =
  '`hit(\'Clock\')` в шаблоне возвращает пустую строку и считает вызовы: шаблон выполняется целиком при каждой проверке компонента, так что счётчик показывает, сколько раз Angular этот компонент проверил. Поле `label` — обычное свойство класса. Присваивание `this.label = …` — просто запись в объект: ни сеттера, ни прокси, никаких уведомлений.';

export const FIELD_PROBLEM =
  'Отсюда вопрос всей темы. React узнаёт об изменении из `setState`, Vue — из прокси, через который идёт запись. У Angular с самого начала не было ни того ни другого: шаблон читал обычные поля, и записать в них можно откуда угодно. Остаётся одно — догадаться, **когда** данные могли поменяться, и в этот момент проверить всё.';

export const BOOT_NOTE =
  'Режим выбирается при запуске. В Angular 21 без указания провайдера приложение работает **без зоны** — даже если zone.js загружен на страницу: `ZONELESS_ENABLED` по умолчанию `true`, а `NgZone` подменён пустой `NoopNgZone`. Чтобы остаться на зоне, `provideZoneChangeDetection()` нужно написать явно.';

// ─── Раздел 2. zone.js ─────────────────────────────────────────────────────────────────────

export const PLAIN_ZONE =
  'Представьте секретаря, который перехватывает все поручения в офисе: «позвонить через час», «ответить, когда придёт письмо». Каждое поручение он помечает «это от отдела продаж», а когда поручение выполнено — сообщает отделу: «у вас что-то произошло, проверьте». Сотрудники звонят как обычно и не знают, что трубку взял секретарь.';

/** Что видно после загрузки `zone.umd.js` в Chromium: подменено ли и где лежит оригинал. */
export const PATCH_ROWS: { what: string; patched: boolean; how: string }[] = [
  { what: '`setTimeout`, `setInterval` и их `clear*`', patched: true, how: 'обёртка на `window`, оригинал — `window.__zone_symbol__setTimeout`' },
  { what: '`requestAnimationFrame`, `cancelAnimationFrame`', patched: true, how: 'так же, плюс устаревшие `webkit*`' },
  { what: '`queueMicrotask`', patched: true, how: 'обёртка на `window`' },
  { what: '`Promise`', patched: true, how: 'заменён целиком: глобальный `Promise` теперь `ZoneAwarePromise`' },
  { what: '`fetch`', patched: true, how: 'обёртка на `window`' },
  { what: '`EventTarget.prototype.addEventListener`', patched: true, how: 'обёртка на прототипе — значит, у всех элементов, `document` и `window`' },
  { what: '`XMLHttpRequest.prototype.send`', patched: true, how: 'обёртка на прототипе' },
  { what: '`MutationObserver`, `IntersectionObserver`, `FileReader`', patched: true, how: 'конструкторы заменены' },
  { what: 'свойства `onclick`, `onmousemove`… у `window`', patched: true, how: 'переопределены все такие свойства — отметок о них на `window` 121' },
  { what: '`ResizeObserver`', patched: false, how: '`observe` прежний: колбэк выполнится вне зоны' },
  { what: '`WebSocket.prototype.send`', patched: false, how: 'прежний; сообщения сокета приходят событиями — их ловит `addEventListener`' },
  { what: '`requestIdleCallback`, `scheduler.postTask`', patched: false, how: 'прежние: колбэк выполнится вне зоны' },
];

export const PATCH_NOTE =
  'Отметок `__zone_symbol__…` на `window` после загрузки — 139. Подменено всё, что было в ходу, когда zone.js писали. API, появившиеся позже, остаются вне зоны, пока их не подменят отдельным модулем: колбэк `ResizeObserver` выполнится, но проверки после него не будет.';

/** Как подмену видно и как она прячется. Выражения выполняются на странице после zone.js. */
export const PATCH_FACTS: { expr: string; result: string }[] = [
  { expr: 'setTimeout === исходныйSetTimeout', result: '`false` — на `window` уже обёртка' },
  { expr: 'window.__zone_symbol__setTimeout === исходныйSetTimeout', result: '`true` — оригинал отложен под отдельным именем' },
  { expr: 'setTimeout.toString()', result: '`function setTimeout() { [native code] }` — обёртка выдаёт себя за встроенную' },
  { expr: 'исходныйToString.call(setTimeout)', result: '`function () { return patchDelegate_1(this, arguments); }` — настоящий текст обёртки' },
  { expr: 'Promise.toString()', result: '`function ZoneAwarePromise() { [native code] }`' },
];

export const TOSTRING_NOTE =
  'zone.js подменяет и `Function.prototype.toString`: обёртки отвечают текстом оригинала. Поэтому проверка «эта функция встроенная?» по `toString` после zone.js врёт. Честный ответ даёт только `toString`, сохранённый **до** загрузки зоны.';

/** Учебная зона. Исполняется демо и тестом (`widgets/zone-lab/model/run.ts`). */
export const ZONE_CODE = `// Мини-зона. Подменяет асинхронные API так, что колбэк, запланированный
// изнутри зоны, и выполняется внутри неё. Когда на стеке нет колбэков зоны
// и все её микрозадачи выполнены, зона «стабильна» — Angular в этот момент
// запускает проверку (tick).
function createZone(onStable) {
  let depth = 0;   // сколько колбэков зоны сейчас на стеке
  let micro = 0;   // сколько микрозадач зоны ещё ждут очереди
  const stats = { tasks: 0 };

  function run(fn) {
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      if (depth === 0 && micro === 0) onStable();
    }
  }

  // Зону запоминают в момент планирования: снаружи колбэк остаётся как есть.
  function wrap(fn) {
    if (depth === 0) return fn;
    return (...args) => {
      stats.tasks++;
      return run(() => fn(...args));
    };
  }

  function patch(api) {
    const native = { ...api };
    api.setTimeout = (fn, ms) => native.setTimeout(wrap(fn), ms);
    api.addEventListener = (target, type, fn) => native.addEventListener(target, type, wrap(fn));
    api.queueMicrotask = (fn) => {
      if (depth === 0) return native.queueMicrotask(fn);
      micro++;
      native.queueMicrotask(() => {
        micro--;
        stats.tasks++;
        run(fn);
      });
    };
    return native;
  }

  return { run, patch, stats, inside: () => depth > 0 };
}`;

export const ZONE_STEPS = [
  {
    k: '`wrap`: зона едет вместе с колбэком',
    d: 'Обёртка создаётся в момент `setTimeout`, а не в момент срабатывания. Поэтому таймер, поставленный из кода приложения, через секунду снова выполнится «внутри приложения», хотя стек к тому времени давно пуст. У zone.js это `Zone.current`, запомненный в задаче.',
  },
  {
    k: '`depth` и `micro`: когда «всё кончилось»',
    d: 'Зона стабильна, когда на стеке нет её колбэков **и** очередь её микрозадач пуста. Таймер, внутри которого `then`, даёт одну проверку, а не две: после самого таймера `micro` ещё 1, проверка ждёт. У Angular это `checkStable`: `_nesting == 0 && !hasPendingMicrotasks`.',
  },
  {
    k: '`onStable`: здесь вызывается tick',
    d: 'Angular подписывается на это событие (`onMicrotaskEmpty`) и вызывает `ApplicationRef._tick()` — проверку от корня. Зона не знает, **что** изменилось; она знает только, что выполнился чей-то код.',
  },
];

// ─── Раздел 3. Цена ────────────────────────────────────────────────────────────────────────

export const COST_NOTE =
  'Столбцы «шаблоны» — сколько раз выполнились шаблоны четырёх компонентов в сумме. Значения сняты на настоящем Angular, сценарии одинаковые для всех трёх столбцов.';

const COST_SCENARIOS: { id: ScenarioId; what: string }[] = [
  { id: 'timerNoop', what: 'таймер, который ничего не меняет' },
  { id: 'mousemove', what: '10 событий `mousemove`, слушатель пустой' },
  { id: 'threeSignals', what: 'таймер пишет в три сигнала' },
  { id: 'timerField', what: 'таймер пишет в обычное поле' },
  { id: 'click', what: 'клик по `+` в Counter' },
];

export const ONPUSH_NOTE =
  '`OnPush` сокращает число шаблонов, но не число проверок: десять движений мыши — по-прежнему десять тиков, просто каждый обходит дерево впустую. И у `OnPush` есть цена: таймер записал `label`, тик прошёл, а на экране «старое» — компонент никто не пометил. С зоной и `Default` тот же сценарий показал «новое».';

export const DEV_FACTS = [
  {
    t: 'В режиме разработки каждый шаблон — дважды',
    d: 'Без `enableProdMode()` клик по `+` даёт один тик, но `hit` каждого из четырёх компонентов срабатывает **два** раза. Второй проход — `checkNoChanges`: Angular выполняет шаблоны ещё раз и сверяет, что значения не изменились от самой проверки.',
    tone: 'info' as const,
  },
  {
    t: '`ExpressionChangedAfterItHasBeenCheckedError`',
    d: 'Если второй проход увидел другое значение, падает `NG0100`. Стенд: дочерний компонент в `ngAfterViewInit` пишет в поле родителя `title`, которое родитель уже нарисовал. Ошибка «Previous value: \'до\'. Current value: \'после\'» — и с зоной, и без неё. Смысл: данные поменялись **во время** проверки, и экран, только что нарисованный, уже неверен.',
    tone: 'warn' as const,
  },
];

// ─── Раздел 4. async/await ─────────────────────────────────────────────────────────────────

/** Выполняется на странице после zone.js. Результат — `CONTEXT_ROWS`. */
export const CONTEXT_CODE = `const zone = Zone.current.fork({ name: 'моя' });
const seen = {};
zone.run(() => {
  seen.sync = Zone.current.name;
  setTimeout(() => (seen.setTimeout = Zone.current.name));
  Promise.resolve().then(() => (seen.then = Zone.current.name));
  (async () => {
    seen.beforeAwait = Zone.current.name;
    await null;
    seen.afterAwait = Zone.current.name;
  })();
});`;

export const CONTEXT_ROWS: { k: string; native: string; lowered: string }[] = [
  { k: '`sync`', native: '`моя`', lowered: '`моя`' },
  { k: '`setTimeout`', native: '`моя`', lowered: '`моя`' },
  { k: '`then`', native: '`моя`', lowered: '`моя`' },
  { k: '`beforeAwait`', native: '`моя`', lowered: '`моя`' },
  { k: '`afterAwait`', native: '`<root>` — зона потеряна', lowered: '`моя`' },
];

export const AWAIT_NOTE =
  'После `await` код продолжается в корневой зоне. Продолжение подписывает сам движок, своей внутренней операцией, — подменить её из JavaScript нельзя. `ZoneAwarePromise` здесь не спасает: если ждать его, движок вызовет его `then` позже, из своей микрозадачи, когда текущей зоной уже стала корневая. На стенде так и вышло: `await` промиса, созданного внутри зоны, продолжился в `<root>`. А `async`-функция возвращает родной промис, не `ZoneAwarePromise`.';

export const AWAIT_ANGULAR_NOTE =
  'В приложении это выглядит так. Клик по «поле» в Clock: `load()` ждёт таймер и пишет `this.label = \'загружено\'`. С зоной и родным `await` — **два тика, а на экране «старое»**. Первый тик — от клика. Второй — когда сработал таймер: зона стабильна и проверяет дерево, но продолжение `load()` ещё не выполнилось — оно стоит в очереди мимо зоны. Когда оно выполнилось, проверять уже некому. Тот же бандл, где `async` переписан в генератор, показывает «загружено».';

/** `async`-функция после esbuild с `supported: { 'async-await': false }`. Тест сверяет дословно. */
export const ASYNC_SOURCE_CODE = `async function load() {
  await new Promise((r) => setTimeout(r, 10));
  this.label = "загружено";
}
`;

export const ASYNC_LOWERED_CODE = `var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
function load() {
  return __async(this, null, function* () {
    yield new Promise((r) => setTimeout(r, 10));
    this.label = "загружено";
  });
}
`;

export const LOWERED_NOTE =
  'Продолжение теперь идёт через `Promise.resolve(…).then(fulfilled)` — а `Promise` здесь глобальный, то есть `ZoneAwarePromise`. Зона снова видит каждый шаг функции. Цена — генератор с обвязкой вместо родного `async`: больше кода, а в отладчике стек из `step` и `fulfilled`.';

/** Цитата из `@angular/build` 21.2.24, `src/tools/esbuild/utils.js`. В проекте пакета нет. */
export const CLI_CODE = `function getFeatureSupport(target, nativeAsyncAwait) {
    return {
        // Native async/await is not supported with Zone.js. Disabling support here will cause
        // esbuild to downlevel async/await, async generators, and for await...of to a Zone.js supported form.
        'async-await': nativeAsyncAwait,
        …
    };
}

function isZonelessApp(polyfills) {
    return !polyfills?.some((p) => p === 'zone.js' || /\\.[mc]?[jt]s$/.test(p));
}`;

export const CLI_NOTE =
  'Angular CLI решает по `polyfills` в `angular.json`. Есть там `zone.js` — esbuild получает `\'async-await\': false` и переписывает все `async`, `for await` и асинхронные генераторы, даже если целевые браузеры их давно умеют. Нет — `async` остаётся родным. Отсюда неочевидное следствие: убрать zone.js из `polyfills` — значит поменять и сам вывод сборки.';

// ─── Раздел 5. Без зоны ────────────────────────────────────────────────────────────────────

export const SCHEDULER_CODE = `// Мини-планировщик без зоны. Тик заказывает тот, кто знает об изменении:
// запись в сигнал, обработчик из шаблона, markForCheck. Заказы до тика
// сливаются в один. later откладывает на задачу: Angular берёт ту из пары
// setTimeout и requestAnimationFrame, что сработает раньше.
function createScheduler(tick, later) {
  let pending = false;
  return function notify() {
    if (pending) return;
    pending = true;
    later(() => {
      pending = false;
      tick();
    });
  };
}`;

export const TREE_CODE = `// Дерево компонентов и проверка. Флаги повторяют флаги вида в Angular.
//   dirty  — «проверь меня»: событие в шаблоне, markForCheck. Ставится виду и всем предкам.
//   signal — «шаблон читал изменившийся сигнал». Предкам — только through: «загляни внутрь».
function createView(name, render, { onPush = false, parent = null } = {}) {
  const view = { name, render, onPush, parent, children: [], dirty: false, signal: false, through: false };
  if (parent) parent.children.push(view);
  return view;
}

function markDirty(view) {
  for (let v = view; v; v = v.parent) v.dirty = true;
}

function markSignal(view) {
  view.signal = true;
  for (let v = view.parent; v; v = v.parent) v.through = true;
}

// global: обычный компонент (не OnPush) проверяется всегда. С зоной корень
// проверяется так; без зоны — точечно (global = false).
function check(view, global, log) {
  const refresh = view.dirty || view.signal || (global && !view.onPush);
  const through = view.through;
  view.dirty = view.signal = view.through = false;
  if (refresh) {
    view.render();
    log.push(view.name);
  }
  // Внутри перерисованного вида дети проверяются как при глобальной проверке.
  if (refresh || through) {
    for (const child of view.children) check(child, refresh, log);
  }
}`;

export const PLAIN_SCHEDULER =
  'Как вызов такси через приложение: три человека из одной квартиры нажали «вызвать» за минуту — приедет одна машина. Первый нажавший заказывает, остальные видят «машина уже едет». А если никто не нажал, машина не приезжает вовсе — даже если в квартире что-то переставили.';

export const NOTIFY_ROWS: { who: string; flag: string; note: string }[] = [
  { who: 'запись в сигнал, который читал шаблон', flag: 'вид — «сигнал», предки — «загляни внутрь»', note: 'проверяется только этот компонент; три записи до тика — один тик' },
  { who: 'обработчик из шаблона, `(click)="…"`', flag: '«проверь меня» виду и всем предкам', note: 'зона не нужна: Angular сам вешает этот слушатель и знает, что он сработал' },
  { who: '`ChangeDetectorRef.markForCheck()`', flag: '«проверь меня» виду и всем предкам', note: 'ручной заказ для данных, о которых Angular иначе не узнает' },
  { who: '`AsyncPipe` — `{{ data$ | async }}`', flag: 'через `markForCheck`', note: 'каждое новое значение потока зовёт `markForCheck` — по исходнику `@angular/common`' },
  { who: 'новое значение входного свойства (`input`)', flag: '«проверь меня»', note: 'источник `SetInput` в списке Angular' },
  { who: '`setTimeout`, `fetch`, `addEventListener` в коде', flag: 'никакого', note: 'тика не будет: записи в обычные поля из таких колбэков экран не увидит' },
];

export const RAF_NOTE =
  'Тик откладывается не на микрозадачу, а на задачу: `scheduleCallbackWithRafRace` ставит и `setTimeout`, и `requestAnimationFrame`, срабатывает первый, второй отменяется. Поэтому записи из одной задачи всегда слипаются в один тик: пока задача не кончилась, отложенный тик не начнётся. На микрозадачу Angular переключается ненадолго — сразу после тика без зоны, чтобы заказ, сделанный в этот момент, не ждал кадра.';

export const HYBRID_NOTE =
  'Планировщик живёт и при зоне. Внутри зоны он молчит — тик и так придёт, когда зона станет стабильной. А запись в сигнал **вне** зоны — например, после родного `await` — он замечает: на стенде клик по «сигнал» в Clock с зоной даёт три тика и «загружено» на экране, а клик по «поле» — два тика и «старое». Сигнал спасает там, где зона потеряла след.';

export const DEMO_NOTE =
  'Один и тот же сценарий в двух мирах. Число тиков и запуски шаблонов считает мини-версия — `createZone`, `createScheduler` и `check` выше, — а строка «Angular 21.2» показывает, что на том же сценарии насчитал настоящий Angular в Chromium. Сравните «таймер без изменений» и «10 × mousemove» в двух режимах, потом переключите `OnPush` и посмотрите на «await → поле».';

export const SCENARIOS: Scenario[] = [
  { id: 'click', label: 'клик по +', what: 'Клик по кнопке `+` в Counter: обработчик из шаблона пишет в сигнал `count`.' },
  { id: 'timerNoop', label: 'таймер без изменений', what: '`setTimeout(() => {})` из кода приложения. Данные не меняются.' },
  { id: 'timerField', label: 'таймер → поле', what: 'Таймер пишет в обычное поле: `clock.label = \'новое\'`.' },
  { id: 'threeSignals', label: 'таймер → 3 сигнала', what: 'Таймер пишет `count.set(1)`, `count.set(2)` и `items.set([1])` подряд.' },
  { id: 'microtask', label: 'микрозадача', what: '`Promise.resolve().then(() => {})` из кода приложения. Данные не меняются.' },
  { id: 'mousemove', label: '10 × mousemove', what: 'Десять движений мыши. Слушатель `mousemove` на документе пустой.' },
  { id: 'markForCheck', label: 'поле + markForCheck', what: 'Таймер пишет `clock.label = \'отмечено\'` и зовёт `cdr.markForCheck()`.' },
  { id: 'awaitField', label: 'await → поле', what: 'Клик по «поле»: `await` таймера, потом `this.label = \'загружено\'`. Родной `async`.' },
  { id: 'awaitFieldLowered', label: 'await → поле, понижено', what: 'Тот же клик, но `async` переписан сборкой в генератор — как делает Angular CLI при zone.js.' },
  { id: 'awaitSignal', label: 'await → сигнал', what: 'Клик по «сигнал»: `await` таймера, потом `this.status.set(\'загружено\')`.' },
];

export const DEMO_CAPTION =
  'Мини-версия собрана из трёх строк темы и проверена тестом на всех десяти сценариях в четырёх сочетаниях (зона или без, `Default` или `OnPush`): число тиков, запуски каждого шаблона и текст на экране совпадают с Angular 21.2.25.';

/** Снято стендом: см. шапку файла. Пересобирается тестом и сверяется целиком. */
export const STAND: Record<ConfigKey, Record<ScenarioId, StandRun>> = {
  zone: {
    click: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '1', effects: [1] },
    timerNoop: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    timerField: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'новое', status: 'ждём', count: '0', effects: [] },
    threeSignals: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '2', effects: [2] },
    microtask: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    mousemove: { ticks: 10, hits: { App: 10, Counter: 10, Clock: 10, List: 10 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    markForCheck: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'отмечено', status: 'ждём', count: '0', effects: [] },
    awaitField: { ticks: 2, hits: { App: 2, Counter: 2, Clock: 2, List: 2 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitFieldLowered: { ticks: 2, hits: { App: 2, Counter: 2, Clock: 2, List: 2 }, label: 'загружено', status: 'ждём', count: '0', effects: [] },
    awaitSignal: { ticks: 3, hits: { App: 3, Counter: 3, Clock: 3, List: 3 }, label: 'старое', status: 'загружено', count: '0', effects: [] },
  },
  'zone/onpush': {
    click: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '1', effects: [1] },
    timerNoop: { ticks: 1, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    timerField: { ticks: 1, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    threeSignals: { ticks: 1, hits: { App: 0, Counter: 1, Clock: 0, List: 1 }, label: 'старое', status: 'ждём', count: '2', effects: [2] },
    microtask: { ticks: 1, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    mousemove: { ticks: 10, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    markForCheck: { ticks: 1, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'отмечено', status: 'ждём', count: '0', effects: [] },
    awaitField: { ticks: 2, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitFieldLowered: { ticks: 2, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitSignal: { ticks: 3, hits: { App: 1, Counter: 0, Clock: 2, List: 0 }, label: 'старое', status: 'загружено', count: '0', effects: [] },
  },
  zoneless: {
    click: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '1', effects: [1] },
    timerNoop: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    timerField: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    threeSignals: { ticks: 1, hits: { App: 0, Counter: 1, Clock: 0, List: 1 }, label: 'старое', status: 'ждём', count: '2', effects: [2] },
    microtask: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    mousemove: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    markForCheck: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'отмечено', status: 'ждём', count: '0', effects: [] },
    awaitField: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitFieldLowered: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 1, List: 1 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitSignal: { ticks: 2, hits: { App: 1, Counter: 1, Clock: 2, List: 1 }, label: 'старое', status: 'загружено', count: '0', effects: [] },
  },
  'zoneless/onpush': {
    click: { ticks: 1, hits: { App: 1, Counter: 1, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '1', effects: [1] },
    timerNoop: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    timerField: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    threeSignals: { ticks: 1, hits: { App: 0, Counter: 1, Clock: 0, List: 1 }, label: 'старое', status: 'ждём', count: '2', effects: [2] },
    microtask: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    mousemove: { ticks: 0, hits: { App: 0, Counter: 0, Clock: 0, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    markForCheck: { ticks: 1, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'отмечено', status: 'ждём', count: '0', effects: [] },
    awaitField: { ticks: 1, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitFieldLowered: { ticks: 1, hits: { App: 1, Counter: 0, Clock: 1, List: 0 }, label: 'старое', status: 'ждём', count: '0', effects: [] },
    awaitSignal: { ticks: 2, hits: { App: 1, Counter: 0, Clock: 2, List: 0 }, label: 'старое', status: 'загружено', count: '0', effects: [] },
  },
};

const totalHits = (r: StandRun) => r.hits.App + r.hits.Counter + r.hits.Clock + r.hits.List;
const costCell = (r: StandRun) => `${r.ticks} · ${totalHits(r)}`;

/** Таблица цены — из `STAND`, а не набрана руками. */
export const COST_ROWS: string[][] = COST_SCENARIOS.map(({ id, what }) => [
  what,
  costCell(STAND.zone[id]),
  costCell(STAND['zone/onpush'][id]),
  costCell(STAND.zoneless[id]),
]);

export const TARGETED_NOTE =
  'Посмотрите на «таймер → 3 сигнала» без зоны: один тик, а шаблонов два — Counter и List. App и Clock не выполнялись вовсе, хотя у всех четырёх `Default`. Это точечная проверка: корень без зоны проверяется только по флагам, и запись в сигнал помечает один компонент. Клик и `markForCheck` устроены иначе — они помечают вид **и всех предков**, а внутри перерисованного App обычные дети проверяются все. Поэтому клик по `+` без зоны всё равно выполнил четыре шаблона.';

// ─── Раздел 6. Сигналы Angular среди других ────────────────────────────────────────────────

/** Исполняется тестом на `@angular/core` 21.2.25 в Node: числа в комментариях — его вывод. */
export const SIGNAL_CODE = `import { computed, signal } from '@angular/core';

const items = signal([1, 2, 3]);
let runs = 0;
const total = computed(() => {
  runs++;
  return items().reduce((a, b) => a + b, 0);
});

runs;                              // 0 — computed ленивый: никто не читал
total(); total();                  // 6, 6
runs;                              // 1 — второй раз из кеша

items().push(4);                   // мутация внутри: сигнал не узнал
total();                           // 6 — устарело
items.set(items());                // тот же массив: Object.is — «не изменилось»
total();                           // 6

items.update((xs) => [...xs]);     // новый массив
total();                           // 10
runs;                              // 2`;

export const SIGNAL_COMPARE_HEAD = ['', 'Angular 21', 'Vue 3.5', 'мини-версия из темы о сигналах'];

export const SIGNAL_COMPARE_ROWS: string[][] = [
  ['чтение и запись', '`count()`, `count.set(v)`, `count.update(f)`', '`count.value`', '`count.get()`, `count.set(v)`'],
  ['граф', 'push пометки, pull пересчёта, версии', 'то же', 'то же'],
  ['сравнение', '`Object.is` (можно задать `equal`)', '`hasChanged` — тоже `Object.is`', '`Object.is`'],
  ['глубина', 'нет: мутация массива внутри не замечается', '`ref` глубокий, как сигнал — `shallowRef`', 'нет'],
  ['кто читатель в шаблоне', 'шаблон **компонента целиком**: изменился сигнал — выполняется весь шаблон этого компонента', 'render-эффект компонента', 'отдельный узел DOM — как в Solid'],
  ['когда выполняется `effect`', 'отложенно, в составе проверки: три записи подряд — один запуск с последним значением', 'после каждой записи; перерисовка — через планировщик', 'сразу после пометки; `batch` копит записи'],
];

export const SIGNAL_NOTE =
  'Сам граф у Angular устроен как у всех: тот же push-pull, что разобран в теме [«Сигналы»](/frameworks/signals/#s2), — пометка вниз, пересчёт по требованию, отсечка, если значение не изменилось. Отличие в двух местах. Читатель в шаблоне — компонент, а не узел DOM: на стенде запись в `count` выполнила шаблон Counter целиком (`hit` сработал), но не тронула соседей. Ближе всего это к Vue. И сигнал в Angular — ещё и **заказ проверки**: именно он заменяет зону.';

export const EFFECT_NOTE =
  '`effect` в Counter пишет каждое значение `count` в массив. Три записи из одного таймера — `count.set(1)`, `count.set(2)`, `items.set([1])` — дали массив `[2]`: эффект выполнился один раз, после записей, и увидел только последнее значение. И с зоной, и без. Эффекты Angular выполняет в составе проверки, а не синхронно при записи.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Без зоны запись в обычное поле не видна',
    d: 'Таймер, ответ `fetch`, сообщение сокета — и `this.label = …`. С зоной экран обновится на ближайшем тике, без зоны — никогда, пока кто-то не закажет проверку. Лечение — сигнал вместо поля или `markForCheck()` после записи. Ошибки нет: данные верные, экран старый.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Родной `await` теряет зону',
    d: 'После `await` код выполняется в корневой зоне. В приложении на зоне запись после `await` может не попасть на экран: проверка прошла раньше, чем выполнилось продолжение. Angular CLI поэтому переписывает `async` в генераторы, пока в `polyfills` есть `zone.js`. Собираете не CLI — следите за этим сами.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`OnPush` и обычное поле',
    d: 'Тик прошёл, а компонент `OnPush` не проверен: его никто не пометил. На стенде «await → поле» даже с понижением `async` показал «старое» — с `Default` то же самое было «загружено».',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Мутация внутри сигнала',
    d: '`items().push(4)` меняет массив, но сигнал хранит ту же ссылку: ни пересчёта, ни проверки. Нужен новый объект — `items.update((xs) => [...xs, 4])`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Пустой слушатель с зоной стоит проверки всего дерева',
    d: '`mousemove`, `scroll`, таймер аналитики: каждое срабатывание — тик. Десять движений мыши на стенде — десять проверок. Такие слушатели вешают внутри `ngZone.runOutsideAngular(…)`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'zone.js на странице ещё не значит «зона включена»',
    d: 'В Angular 21 без `provideZoneChangeDetection()` приложение работает без зоны, даже если zone.js загружен: `NgZone` — пустой `NoopNgZone`. Обратная ситуация — `provideZonelessChangeDetection()` при загруженной zone.js — в режиме разработки печатает предупреждение `NG0914`.',
  },
  {
    n: '07',
    t: '`toString` после zone.js врёт',
    d: 'Подменённые функции отвечают «`[native code]`». Проверки «встроенная ли функция» и снимки глобальных API, сделанные после загрузки зоны, видят обёртки.',
  },
  {
    n: '08',
    t: 'Новые API вне зоны',
    d: '`ResizeObserver`, `requestIdleCallback`, `scheduler.postTask` zone.js 0.16 не подменяет. Колбэк выполнится, тика после него не будет — тот же эффект, что без зоны, но в приложении, которое на зону рассчитывает.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Angular — Zoneless',
    href: 'https://angular.dev/guide/zoneless',
    what: '`provideZonelessChangeDetection`, что заказывает проверку, как убрать zone.js из сборки',
  },
  {
    title: 'Angular — Signals',
    href: 'https://angular.dev/guide/signals',
    what: '`signal`, `computed`, `effect`, `equal`, `untracked`',
  },
  {
    title: 'Angular — Skipping component subtrees',
    href: 'https://angular.dev/best-practices/skipping-subtrees',
    what: '`OnPush` и что помечает компонент',
  },
  {
    title: 'Angular — NG0100: Expression has changed after it was checked',
    href: 'https://angular.dev/errors/NG0100',
    what: 'второй проход в режиме разработки',
  },
  {
    title: 'Исходник: zoneless_scheduling_impl.ts',
    href: 'https://github.com/angular/angular/blob/main/packages/core/src/change_detection/scheduling/zoneless_scheduling_impl.ts',
    what: '`notify`, слияние заказов, гонка `setTimeout` и `requestAnimationFrame`',
  },
  {
    title: 'Исходник: ng_zone.ts',
    href: 'https://github.com/angular/angular/blob/main/packages/core/src/zone/ng_zone.ts',
    what: '`NgZone`, `onMicrotaskEmpty`, `checkStable`, `runOutsideAngular`',
  },
  {
    title: 'zone.js',
    href: 'https://github.com/angular/angular/tree/main/packages/zone.js',
    what: 'что подменяется, `Zone.current`, `fork`, `__zone_symbol__`; версия 0.16.3 на стенде',
  },
  {
    title: 'Angular CLI — utils.ts (`getFeatureSupport`, `isZonelessApp`)',
    href: 'https://github.com/angular/angular-cli/blob/main/packages/angular/build/src/tools/esbuild/utils.ts',
    what: 'понижение `async/await` при zone.js',
  },
  {
    title: 'esbuild — supported',
    href: 'https://esbuild.github.io/api/#supported',
    what: 'отключение отдельных возможностей синтаксиса',
  },
];

export const RELATED =
  'Смежное на сайте: [Сигналы](/frameworks/signals/) — сам граф и мини-реализация. [Реактивность Vue, раздел «Планировщик»](/frameworks/vue-reactivity/#s3) — та же задача «слить записи в одну перерисовку», решённая очередью. [Ре-рендеринг в React, раздел «Батчинг и нарезка»](/frameworks/react-rerender/#s4) — как это делает React. [Event Loop](/js/event-loop/) — задачи и микрозадачи, на которых стоит зона. [Колбэки, раздел «Ошибки»](/js/callbacks/#s5) — контекст, который не переживает асинхронную границу. [Транспиляция и полифилы](/tooling/transpilation/#s3) — во что превращается `async`. [Асинхронный контекст](/js/async-context/) — AsyncLocalStorage, момент снимка контекста и почему в браузере его пока нет. [Внедрение зависимостей](/frameworks/dependency-injection/) — `provide`/`inject` во Vue, контекст React и иерархия инжекторов Angular.';
