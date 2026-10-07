import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { MfPreset, MfState } from '@/widgets/mf-share-scope/model/types';

/**
 * Данные темы «Микрофронтенды и Module Federation: чужой код в вашем бандле во время работы».
 *
 * Тема написана здесь. До неё предмет висел строкой «Module Federation и микрофронтенды —
 * Отдельная тема — готовится» в «за кадром» у «Модулей и сборки». Что там разобрано, здесь
 * не пересказывается: три фазы модуля и module map, import maps, чанки и dual package hazard
 * живут в «Модулях и сборке», semver и двойники в `node_modules` — в «Пакетных менеджерах».
 * Эта тема — о сборке приложения из частей, которые выкатываются **независимо**, и о том,
 * как они договариваются об общих зависимостях уже в браузере.
 *
 * ── Чем проверено ──────────────────────────────────────────────────────────────────────────
 * Пакетов `@module-federation/*` и `webpack` в проекте нет (ставить их запрещено правилами
 * сессии), поэтому механика показана **учебной федерацией** — `FEDERATION_CODE`, склеенной из пяти строк ниже,
 * которые тема печатает по разделам. Её исполняют и демо, и `tests/unit/module-federation.test.ts`:
 *   — `SEMVER_MIN_CODE` сверен с пакетом `semver` 7.8.5 (его ставит Astro) на всей сетке
 *     версий и диапазонов, которые код берётся разбирать; остальное он отвергает;
 *   — `CONSUME_ROWS` — таблица выбора версии — посчитана той же строкой, тест сверяет каждую
 *     строку с прогоном;
 *   — сценарии «совместимые версии → одна копия», «singleton при несовместимых → предупреждение»,
 *     «strictVersion → ошибка», «remote упал / завис → fallback» — тестом.
 *
 * **Правила выбора версии сверены с исходником webpack v5.111.1** (сентябрь 2026, raw-файлы тега
 * `lib/sharing/ShareRuntimeModule.js`, `ConsumeSharedRuntimeModule.js`, `ConsumeSharedModule.js`,
 * `ConsumeSharedPlugin.js`, `lib/config/defaults.js`):
 *   — регистрация (`register`): та же строка условия — eager побеждает, при равенстве больше
 *     по строке `from`, а `from` — это `output.uniqueName` (по умолчанию имя из `package.json`);
 *   — singleton (`findSingletonVersionKey`): старшая, но загруженная не уступает; при
 *     несовпадении — `Unsatisfied version … of shared singleton module …`, строгий бросает,
 *     своей копии singleton не берёт — подтверждено;
 *   — умолчание `strictVersion`: `item.import !== false && !item.singleton` — подтверждено;
 *   — ⚠️ **исправлено**: нестрогий не-singleton без подходящей версии берёт просто старшую
 *     (`findLatestVersion`, на `loaded` не смотрит), а не «старшую, но загруженная не уступает»,
 *     и текст предупреждения другой: `No satisfying version (…) of shared module … found in shared
 *     scope default.` + список `Available versions`. Было выдумано окончание `, using X`;
 *   — `Shared module is not available for eager consumption` — дословно из `ConsumeSharedRuntimeModule`.
 * Настоящий рантайм не запускался: код темы — пересказ этих строк, а не их исполнение.
 *
 * ── Что снято запуском ─────────────────────────────────────────────────────────────────────
 *   — `STAND_RUNS`: Chromium 153.0.8010.12 (Playwright 1.63), стенд на `node:http`, два источника
 *     `127.0.0.1:49231` и `127.0.0.1:49232`, по новой странице на сценарий. Код стенда — строки
 *     `STAND_*_CODE`, отданные сервером как есть. Тест гоняет те же строки в Node 26.8.2 из файлов.
 *   — `REACT_TWIN_RUNS`: две копии React 19.3.0 (вторая — копия каталога `node_modules/react`),
 *     `react-dom/server`, Node 26.8.2, отладочная и продакшен-сборка. Закреплено тестом.
 * Таймерных замеров в теме нет: таймаут в демо — порог, а не измерение.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'микрофронтенд',
    d: 'Часть интерфейса, которую делает, собирает и выкатывает отдельная команда: каталог, корзина, профиль. На странице части встречаются, а в репозитории и в конвейере — нет.',
  },
  {
    k: 'host и remote',
    d: 'Host — приложение, которое открыл пользователь: оно решает, что и где показать. Remote — сборка, которая выставляет свои модули наружу. Одна сборка бывает и тем и другим.',
  },
  {
    k: 'контейнер, `remoteEntry.js`',
    d: 'Маленький файл, который remote кладёт рядом со своими чанками. В нём объект с двумя методами: `init` — принять общие зависимости, `get` — отдать модуль по имени. Host загружает только его; остальное контейнер подгрузит сам.',
  },
  {
    k: 'общая зависимость (shared)',
    d: 'Пакет, который объявили общим обе стороны, например `react`. Каждая сборка всё равно несёт свою копию — на случай, если общей не окажется, — но на странице по возможности работает одна.',
  },
  {
    k: 'shareScope',
    d: 'Объект «пакет → версия → откуда взять», общий для host и всех remote. Каждая сборка кладёт туда свои версии, и каждая при потреблении выбирает одну по своим правилам.',
  },
  {
    k: 'мажорная версия',
    d: 'Первое число в версии пакета по semver: у `19.1.0` это 19. Смена мажора (18 → 19) по договорённости означает «могут быть несовместимые изменения», поэтому диапазон `^18.2.0` девятнадцатую версию не пускает.',
  },
  {
    k: 'fallback',
    d: 'Два смысла, и оба в теме. Для общей зависимости — своя копия, которую сборка берёт, если в shareScope подходящей нет. Для remote — то, что host покажет вместо виджета, если remote не загрузился.',
  },
];

export const PLAIN_FEDERATION =
  'Представьте фудкорт. Каждое кафе готовит своё и открывается, когда хочет, а зал, столы и электричество общие. Module Federation — договор о зале: где стоит чей прилавок и **чья** плита работает, если плита есть у всех. Самое трудное здесь не расставить прилавки, а не включить пять плит в одну розетку.';

export const PREREQ = [
  {
    t: 'Модуль исполняется один раз на адрес',
    d: 'Браузер кладёт модуль в module map по его URL: второй `import` того же адреса вернёт уже исполненный экземпляр. Разные адреса — разные экземпляры, даже если текст один и тот же. На этом держится вся история про «две копии».',
    href: '/tooling/modules/#s1',
    hrefLabel: '«Модули и сборка», раздел «Три фазы»',
    tone: 'info' as const,
  },
  {
    t: 'Чанки и динамический `import()`',
    d: 'Сборщик режет приложение на файлы с хешем в имени и грузит их по требованию. Контейнер remote — это ещё один такой вход, только собранный другой командой.',
    href: '/tooling/modules/#s5',
    hrefLabel: '«Модули и сборка», раздел «Чанки и кеш»',
    tone: 'info' as const,
  },
  {
    t: 'Semver и диапазоны',
    d: '`^18.2.0` пускает любую `18.x.y` не ниже `18.2.0`, но не `19.0.0`. Федерация выбирает общую версию теми же диапазонами, только не при установке, а в браузере.',
    href: '/tooling/package-managers/#s1',
    hrefLabel: '«Пакетные менеджеры», раздел «Semver и диапазоны»',
    tone: 'info' as const,
  },
  {
    t: 'Двойники пакета',
    d: 'Две копии одного пакета в одном приложении — это два разных модуля со своим состоянием. В `node_modules` их кладёт менеджер, в федерации — две сборки, которые не договорились.',
    href: '/tooling/package-managers/#s2',
    hrefLabel: '«Пакетные менеджеры», раздел «Разрешение и подъём»',
    tone: 'info' as const,
  },
];

// ─── Раздел 1. Зачем и чем платят ──────────────────────────────────────────────────────────

export const WHY_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Что покупают: независимый выкат',
    d: 'Команда корзины чинит баг и выкатывает корзину — без сборки, тестов и релиза всего сайта. Это единственное, что микрофронтенды дают и чего нельзя получить аккуратной папкой в монорепозитории. Если выкатываете всё равно вместе, платить незачем.',
    tone: 'ok',
  },
  {
    t: 'Чем платят: интеграция переезжает к пользователю',
    d: 'Host и remote собраны разными конвейерами в разное время. Сочетание «host вчерашний, remote сегодняшний» впервые встречается **у пользователя**: ни один CI его не собирал. Всё, что в монолите ловит компилятор — несовпадение типов, пропавший экспорт, — здесь становится ошибкой времени выполнения.',
    tone: 'warn',
  },
  {
    t: 'Чем платят: байты и копии',
    d: 'Каждая сборка несёт свои зависимости. Договориться об общих можно, но только о тех, что объявлены общими, и только если версии совместимы. Всё остальное скачивается столько раз, сколько remote на странице.',
    tone: 'warn',
  },
  {
    t: 'Чем платят: одна страница, один `window`',
    d: 'Код всех команд работает в одном документе: общий DOM, общие глобальные стили, общий `history`, общий главный поток. Долгая задача в каталоге тормозит корзину, глобальный CSS корзины перекрашивает каталог.',
    tone: 'warn',
  },
];

export const WAYS_ROWS: { k: string; when: string; iso: string; shared: string; cost: string }[] = [
  {
    k: 'npm-пакеты',
    when: 'при сборке host',
    iso: 'никакой',
    shared: 'решает менеджер пакетов, одна копия при совместимых диапазонах',
    cost: 'Независимого выката нет: новая версия части попадает к пользователю только с новой сборкой host. Это не микрофронтенд, а модульность.',
  },
  {
    k: '`<iframe>`',
    when: 'во время работы',
    iso: 'полная: свой документ, свой `window`, свои стили',
    shared: 'нет вовсе — каждая часть грузит свой React',
    cost: 'Размер задаётся снаружи, фокус, прокрутка и модальные окна не выходят за рамку, общение — через `postMessage`. Надёжно и тяжело.',
  },
  {
    k: 'веб-компоненты',
    when: 'во время работы, скриптом',
    iso: 'стили — теневым корнем, JavaScript — никакой',
    shared: 'как решит загрузчик скрипта',
    cost: 'Граница — пользовательский элемент с атрибутами и событиями: договор узкий и понятный. Что внутри, host не знает.',
  },
  {
    k: '`import()` по URL',
    when: 'во время работы',
    iso: 'никакой',
    shared: 'только совпадение адреса: один URL — один экземпляр',
    cost: 'Самый короткий путь: remote — это ES-модуль на своём сервере. Другой источник — значит нужен CORS. Общие зависимости придётся передавать руками.',
  },
  {
    k: 'import maps',
    when: 'во время работы',
    iso: 'никакой',
    shared: 'одна копия на имя: карта сопоставляет `react` одному адресу для всех',
    cost: 'Работает без сборщика, но карта одна на документ, и выбор версии делает человек, который её пишет: диапазонов у неё нет.',
  },
  {
    k: 'Module Federation',
    when: 'во время работы',
    iso: 'никакой',
    shared: 'shareScope: каждая сторона кладёт свои версии, выбор — по semver во время работы',
    cost: 'Нужен сборщик, который её умеет (webpack 5, Rspack, плагины для Vite). Взамен — договорённость о версиях без центральной карты.',
  },
];

export const WAYS_NOTE =
  'Как карта `<script type="importmap">` сопоставляет голое имя с адресом и почему её нельзя дописать после первого импорта — в [«Модулях и сборке», раздел «Три фазы»](/tooling/modules/#s1). Как стили переходят и не переходят границу теневого корня — в [«Стилях веб-компонентов»](/render/web-components-styles/#s1).';

// ─── Раздел 2. Контейнер: init и get ───────────────────────────────────────────────────────

/** Как это выглядит в конфиге сборщика — для узнавания. По документации, без прогона. */
export const MF_CONFIG_CODE = `// remote: webpack.config.js корзины
new ModuleFederationPlugin({
  name: 'cart',
  filename: 'remoteEntry.js',               // контейнер
  exposes: { './Widget': './src/Widget.jsx' },
  shared: { react: { singleton: true, requiredVersion: '^18.2.0' } },
});

// host: webpack.config.js оболочки
new ModuleFederationPlugin({
  name: 'host',
  remotes: { cart: 'cart@https://cart.example.com/remoteEntry.js' },
  shared: { react: { singleton: true, requiredVersion: '^18.3.0' } },
});

// где-то в host
const Widget = React.lazy(() => import('cart/Widget'));`;

export const CONTAINER_CODE = String.raw`// ── remoteEntry.js: контейнер, который выставляет remote ──────────────────
// app: { name, pkg, lib: { version, singleton, requiredVersion, strictVersion, eager } };
// world: { copies, log } — журнал стенда: какие копии исполнены, что сказано в консоль.
function createContainer(app, world) {
  const own = bundleLibrary(world.copies, app.pkg, app.lib.version, app.name);
  const exposes = app.exposes || {
    './Widget': (lib) => ({ lib, render: () => app.name + ': useState → ' + lib.useState(0)[0] }),
  };
  let scope = null;
  return {
    // init: принять общий shareScope и положить в него свою версию пакета.
    init(shareScope) {
      if (scope) return;
      scope = shareScope;
      register(scope, app.pkg, app.lib.version, app.name, app.lib.eager, own);
    },
    // get: выбрать общую зависимость по своим правилам и отдать фабрику модуля.
    async get(request) {
      const expose = exposes[request];
      if (!expose) throw new Error('Module "' + request + '" does not exist in container ' + app.name);
      const lib = consume(scope, app.pkg, app.lib, own, app.name, world.log);
      return () => expose(lib);
    },
  };
}`;

export const HOST_CODE = String.raw`// ── host ─────────────────────────────────────────────────────────────────────
// Загрузка контейнера с потолком ожидания: зависший CDN хуже упавшего.
function withTimeout(promise, ms, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timeout ' + ms + ' ms: ' + what)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

// loadEntry(remote) — Promise контейнера; чем он добыт (<script>, import()), здесь неважно.
async function runHost(world, host, remotes, loadEntry, timeoutMs) {
  const { copies, log } = world, scope = {};
  const own = bundleLibrary(copies, host.pkg, host.lib.version, host.name);
  register(scope, host.pkg, host.lib.version, host.name, host.lib.eager, own);

  let lib = null;
  const takeOwn = () => (lib = lib || consume(scope, host.pkg, host.lib, own, host.name, log));
  if (host.lib.eager) takeOwn(); // eager: берётся сразу, до контейнеров remote

  const containers = {}, results = {};
  for (const r of remotes) {
    try {
      containers[r.name] = await withTimeout(loadEntry(r), timeoutMs, r.url);
      containers[r.name].init(scope);
    } catch (e) {
      log.push({ level: 'error', who: r.name, text: e.message });
    }
  }
  try { takeOwn(); } catch (e) {          // асинхронная граница пройдена: версии всех на месте
    log.push({ level: 'error', who: host.name, text: e.message });
    return { scope, host: null, results };
  }

  for (const r of remotes) {
    if (!containers[r.name]) { results[r.name] = { fallback: true }; continue; }
    try {
      const widget = (await containers[r.name].get('./Widget'))();
      results[r.name] = { lib: widget.lib, html: lib.render(widget.render) }; // рендерит host
    } catch (e) {                          // «граница ошибок» вокруг виджета
      log.push({ level: 'error', who: r.name, text: e.message });
      results[r.name] = { fallback: true, error: e.message };
    }
  }
  return { scope, host: lib, results };
}`;

export const CONTAINER_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Контейнер маленький, модули — отдельно',
    d: 'В `remoteEntry.js` нет кода виджета: только таблица «имя модуля → какие чанки загрузить» и две функции. `get` грузит чанки по требованию и отдаёт **фабрику**, а не модуль: исполнится модуль, когда host её вызовет. Поэтому контейнер можно загрузить при старте и не платить за виджет, который ещё не показан.',
  },
  {
    t: 'Сначала `init`, потом `get`',
    d: 'Контейнер, которому не дали shareScope, не знает, чью копию React брать. В webpack повторный `init` с другим объектом не принимается — контейнер инициализируется один раз за жизнь страницы (по документации, без прогона). Отсюда же правило: один remote нельзя подключить в host с двумя разными наборами общих зависимостей.',
    tone: 'info',
  },
  {
    t: 'Host тоже кладёт свои версии',
    d: 'shareScope наполняют все стороны: host — при старте, remote — в `init`. Поэтому выбор общей версии зависит от того, **какие remote успели загрузиться** к моменту выбора. Отсюда асинхронная граница: webpack требует, чтобы код приложения начинался с `import(\'./bootstrap\')`, — пока грузится этот чанк, рантайм собирает контейнеры и их версии.',
    tone: 'warn',
  },
  {
    t: 'Имя модуля — договор, а не путь',
    d: '`./Widget` в `exposes` — публичное имя. Файл за ним remote может переименовать, но имя обязан держать: host вызывает `get(\'./Widget\')` строкой, и компилятор host о её существовании ничего не знает.',
  },
];

// ─── Раздел 3. Общие зависимости ───────────────────────────────────────────────────────────

export const PLAIN_SHARE_SCOPE =
  'Общий холодильник в офисе. Каждый приносит свой пакет молока с датой и кладёт на полку — это `init`. Когда нужно молоко, каждый решает сам: «возьму самое свежее из тех, что мне годятся» — обычная общая зависимость; «молоко на всех одно, и точка» — singleton; «если годного нет, достану своё из сумки» — fallback. Плохо, когда двое налили в один кофе из двух разных пакетов.';

export const SEMVER_MIN_CODE = String.raw`// ── semver в том объёме, который нужен выбору версии ───────────────────────
// Версия — три числа. Диапазон — ^1.2.3, ~1.2.3, >=1.2.3, точная 1.2.3 или *.
// Пререлизов и || учебная версия не разбирает — и бросает, а не угадывает.
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error('не версия: ' + v);
  return [+m[1], +m[2], +m[3]];
}
function compare(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function satisfies(version, range) {
  if (range === '*') return true;
  const m = /^(\^|~|>=)?(\d+\.\d+\.\d+)$/.exec(range);
  if (!m) throw new Error('учебная проверка не разбирает диапазон: ' + range);
  const op = m[1] || '', [a, b, c] = parse(m[2]);
  const low = compare(version, m[2]);
  if (op === '') return low === 0;
  if (low < 0) return false;
  if (op === '>=') return true;
  // Верхняя граница: ~ — следующий minor; ^ — следующий на первом ненулевом числе.
  const top = op === '~' ? [a, b + 1, 0] : a > 0 ? [a + 1, 0, 0] : b > 0 ? [0, b + 1, 0] : [0, 0, c + 1];
  return compare(version, top.join('.')) < 0;
}`;

export const SCOPE_CODE = String.raw`// ── shareScope: { [пакет]: { [версия]: { get, from, eager, loaded } } } ────
// Кладут версии все: host при старте, каждый remote в init(). Одну и ту же версию
// перезаписывает eager, при равенстве — сборка, чьё имя больше по строке.
function register(scope, pkg, version, from, eager, get) {
  const versions = (scope[pkg] = scope[pkg] || {});
  const active = versions[version];
  if (!active || (!active.loaded && (!eager !== !active.eager ? eager : from > active.from))) {
    versions[version] = { get, from, eager: !!eager, loaded: false };
  }
}
function take(entry) {
  entry.loaded = true;
  return entry.get();
}
// Singleton: старшая версия, но уже загруженная не уступает никому.
function singletonVersion(versions) {
  return Object.keys(versions).reduce((a, b) => (!a || (!versions[a].loaded && compare(a, b) < 0) ? b : a), '');
}
// Не singleton: старшая из тех, что попадают в диапазон.
function validVersion(versions, range) {
  return Object.keys(versions).reduce((a, b) => (satisfies(b, range) && (!a || compare(a, b) < 0) ? b : a), '');
}
// Просто старшая: на загруженность здесь не смотрят.
function latestVersion(versions) {
  return Object.keys(versions).reduce((a, b) => (!a || compare(a, b) < 0 ? b : a), '');
}

// Потребление. cfg: { singleton, requiredVersion, strictVersion }; fallback — своя копия.
function consume(scope, pkg, cfg, fallback, who, log) {
  const versions = scope[pkg];
  const strict = cfg.strictVersion ?? !cfg.singleton; // умолчание: строго, если не singleton
  if (!versions || !Object.keys(versions).length) return fallback();
  if (cfg.singleton) {
    const v = singletonVersion(versions);
    if (cfg.requiredVersion && !satisfies(v, cfg.requiredVersion)) {
      const msg = 'Unsatisfied version ' + v + ' from ' + versions[v].from +
        ' of shared singleton module ' + pkg + ' (required ' + cfg.requiredVersion + ')';
      if (strict) throw new Error(msg);
      log.push({ level: 'warn', who, text: msg });
    }
    return take(versions[v]);
  }
  const v = validVersion(versions, cfg.requiredVersion || '*');
  if (v) return take(versions[v]);
  if (strict) return fallback(); // подходящей нет — своя копия: вторая библиотека на странице
  log.push({ level: 'warn', who, text: 'No satisfying version (' + cfg.requiredVersion + ') of shared module ' + pkg +
    ' found in shared scope default.\nAvailable versions: ' +
    Object.keys(versions).map((k) => k + ' from ' + versions[k].from).join(', ') });
  return take(versions[latestVersion(versions)]);
}`;

/**
 * Стенд демо: копия библиотеки и сеть. Это не федерация, а то, на чём она проверяется, —
 * поэтому печатается отдельным блоком.
 *
 * У копии свой «диспетчер хуков», как у React: рендерер ставит его, хук его читает. Хук чужой
 * копии находит `null` и падает ровно тем `TypeError`, который даёт настоящий React 19.3.0
 * в продакшен-сборке (`REACT_TWIN_RUNS`, закреплено тестом).
 */
export const STAND_CODE = String.raw`// ── Стенд: копия библиотеки и сеть ───────────────────────────────────────────
// Модуль исполняется один раз на сборку, которая его несёт.
function bundleLibrary(copies, pkg, version, owner) {
  let lib = null;
  return function load() {
    if (lib) return lib;
    const dispatcher = { current: null };
    lib = {
      pkg, version, owner,
      useState: (initial) => dispatcher.current.useState(initial), // чужая копия: current === null
      render(component) {
        dispatcher.current = { useState: (initial) => [initial, () => {}] };
        try { return component(); } finally { dispatcher.current = null; }
      },
    };
    copies.push(lib);
    return lib;
  };
}
// Сеть, в которой remote жив, упал или завис.
function fakeNetwork(world) {
  return (r) =>
    r.status === 'down' ? Promise.reject(new Error('Loading script failed: ' + r.url))
    : r.status === 'hang' ? new Promise(() => {})
    : Promise.resolve(createContainer(r, world));
}`;

/** То, что исполняют демо и тест: ровно пять блоков, напечатанных в теме. */
export const FEDERATION_CODE = [SEMVER_MIN_CODE, SCOPE_CODE, CONTAINER_CODE, HOST_CODE, STAND_CODE].join('\n\n');

export const SHARE_OPTIONS: { k: string; def: string; what: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`requiredVersion`',
    def: 'из `package.json` сборки',
    what: 'Диапазон, который сборка готова принять. По умолчанию сборщик берёт его из `dependencies`, то есть `^18.2.0`, если так написано у вас.',
  },
  {
    k: '`singleton`',
    def: '`false`',
    what: 'На странице одна копия, **даже если версии несовместимы**. Выбирается старшая из положенных, а уже загруженная не уступает. Несовпадение с `requiredVersion` — предупреждение в консоли, не ошибка.',
    tone: 'warn',
  },
  {
    k: '`strictVersion`',
    def: '`true`, если есть своя копия и не singleton; иначе `false`',
    what: 'Что делать, если подходящей версии нет. Строго у обычной зависимости — взять свою копию (вторая на странице). Строго у singleton — бросить ошибку: своей копии singleton не берёт.',
    tone: 'err',
  },
  {
    k: '`eager`',
    def: '`false`',
    what: 'Положить пакет в стартовый чанк и взять его сразу, не дожидаясь контейнеров remote. Раз взятая копия помечается загруженной — и дальше singleton выбирает её, а не старшую.',
    tone: 'info',
  },
];

/**
 * Таблица выбора версии. **Не набрана руками**: каждую строку тест прогоняет через `consume`
 * из `SCOPE_CODE` и сверяет версию, чью копию выдали, и что сказано в консоль.
 *
 * Во всех строках в shareScope лежат `18.3.1` от host и `19.1.0` от cart; `loaded` — какая
 * из них уже взята кем-то раньше.
 */
export const CONSUME_ROWS: {
  cfg: { singleton: boolean; strictVersion?: boolean };
  required: string;
  loaded?: string;
  got: string;
  from: string;
  level: 'ok' | 'warn' | 'error';
  why: string;
}[] = [
  {
    cfg: { singleton: false },
    required: '^18.2.0',
    got: '18.3.1',
    from: 'host',
    level: 'ok',
    why: 'старшая из попавших в диапазон; `19.1.0` в него не входит',
  },
  {
    cfg: { singleton: false },
    required: '^20.0.0',
    got: '20.0.0',
    from: 'своя копия',
    level: 'ok',
    why: 'подходящей нет, `strictVersion` по умолчанию включён — своя копия, **вторая** на странице',
  },
  {
    cfg: { singleton: false, strictVersion: false },
    required: '^20.0.0',
    got: '19.1.0',
    from: 'cart',
    level: 'warn',
    why: 'не строго: старшая из имеющихся и предупреждение',
  },
  {
    cfg: { singleton: true },
    required: '^18.2.0',
    got: '19.1.0',
    from: 'cart',
    level: 'warn',
    why: 'singleton берёт старшую, не глядя на диапазон, и только предупреждает',
  },
  {
    cfg: { singleton: true },
    required: '^18.2.0',
    loaded: '18.3.1',
    got: '18.3.1',
    from: 'host',
    level: 'ok',
    why: '`18.3.1` уже взята — загруженная не уступает старшей',
  },
  {
    cfg: { singleton: true, strictVersion: true },
    required: '^18.2.0',
    got: '—',
    from: '—',
    level: 'error',
    why: 'строгий singleton бросает: `Unsatisfied version 19.1.0 from cart…`',
  },
];

/**
 * Флаги общих зависимостей — на одной истории. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. Таблица `CONSUME_ROWS` давала по строке на сочетание флагов,
 * но не показывала, что из каждого исхода видит страница. Здесь одна ситуация — пресет демо
 * «cart перешёл на 19» — разобрана под каждым флагом. Исходы выбора — строки `CONSUME_ROWS`
 * (их считает тест той же `consume`) и правила из шапки файла (webpack v5.111.1,
 * `lib/sharing`); падение рендера на двух копиях — `REACT_TWIN_RUNS` (React 19.3.0, Node 26.8.2);
 * что строгий singleton роняет без `eager`, а что с ним, — `FAILURE_FACTS` и пресеты демо.
 */
export const SHARE_SCENE_CODE = `host:  react 18.3.1, requiredVersion ^18.2.0   — шапка и страница
cart:  react 19.1.0, requiredVersion ^19.0.0   — виджет корзины

Команда корзины перешла на React 19 и выкатилась.
Host никто не пересобирал.
Пользователь открывает страницу: host рисует шапку и грузит корзину.`;

export const SHARE_SCENE_NOTE =
  'Что было бы, если бы `react` **не объявили общим** вовсе. Каждая сборка берёт свою копию: шапку рисует React 18 из сборки host, виджет корзины — React 19 из сборки cart. Но рендерер на странице один — `react-dom` host, — и он ставит «диспетчер хуков» в свою копию `react`. Компонент корзины зовёт `useState` из другой копии, находит там `null` и падает: `Cannot read properties of null (reading \'useState\')`. На стенде это случается даже с двумя копиями **одной** версии, 19.3.0. Флаги в `shared` решают, сколько копий окажется на странице и кто за это заплатит.';

export const SHARE_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Общая, но не singleton',
    when: '`shared: { react: {} }` — флаги по умолчанию',
    what: 'Обе версии легли в shareScope. Host просит `^18.2.0` и получает `18.3.1`: `19.1.0` в диапазон не входит. Корзина просит `^19.0.0` и по тому же правилу получает `19.1.0`. Каждый получил подходящую версию — и на странице снова две копии React.',
    cost: 'Для утилит без состояния это просто лишние байты. Для React — тот же `null` вместо диспетчера, что и без федерации вовсе: общая зависимость без singleton от двух копий не спасает.',
  },
  {
    k: '`singleton: true`',
    when: 'копия на странице одна, и ни одна ещё не взята',
    what: 'Singleton берёт **старшую** из положенных — `19.1.0` от cart — не глядя на диапазон host. Шапка, собранная под React 18, работает на React 19; в консоли предупреждение `Unsatisfied version`. Если host уже взял свою `18.3.1` раньше (например, с `eager: true`), загруженная не уступает: тогда уже корзина, собранная под 19, работает на 18 — с тем же предупреждением.',
    cost: 'Рендер не падает, но одна из сборок живёт на мажоре, под который её не собирали и не тестировали. Сломается ли что-то, зависит от того, чем мажоры различаются, — и узнаёте вы это у пользователя.',
  },
  {
    k: '`singleton` + `strictVersion: true`',
    when: 'копия одна, и несовпадение с диапазоном запрещено',
    what: 'Вместо предупреждения — ошибка: `Unsatisfied version 19.1.0 from cart…`. Своей копии singleton не берёт, так что выхода нет. Что именно упадёт, решает `eager`: без него host просит `react` через общий механизм — и падает страница целиком; с `eager: true` host уже держит свою копию, и ошибка достаётся только виджету корзины.',
    cost: 'Несовместимость видна сразу и громко — но в браузере пользователя, а не в CI. Поэтому ошибку `get` ловят так же, как сбой сети: виджет показывает заглушку, страница живёт.',
  },
];

/** Ячейки таблицы — из тех же строк, что прогоняет тест. */
export const CONSUME_TABLE: string[][] = CONSUME_ROWS.map((r) => [
  String(r.cfg.singleton),
  r.cfg.strictVersion === undefined ? 'умолчание' : String(r.cfg.strictVersion),
  r.required,
  r.loaded ?? '—',
  r.got,
  r.from,
  r.why,
]);
export const CONSUME_TONES = CONSUME_ROWS.map((r) => (r.level === 'error' ? ('err' as const) : r.level));

export const PLAIN_TWO_COPIES =
  'Две копии React — два одинаковых пульта от одного телевизора, но телевизор слушает только тот, с которым его спарили. Рендерер из `react-dom` спарился с первым пультом. Компонент из другой сборки жмёт кнопки второго — такого же на вид, но ни с чем не связанного, — и вместо переключения канала получает ошибку.';

export const SINGLETON_NOTE =
  '**Почему React и Vue объявляют singleton.** У них есть состояние уровня модуля: React хранит текущий «диспетчер хуков» в объекте внутри пакета `react`, и рендерер из `react-dom` ставит его в **ту** копию, которую импортировал сам. Компонент из другой сборки зовёт `useState` из своей копии — и находит там `null`. Ниже это видно на деле: одинаковая версия 19.3.0, две копии — и рендер падает. Для пакета без состояния — утилит, форматтеров — две копии стоят только байтов, и singleton ему не нужен.';

export const DEMO_CAPTION =
  'Host и два remote, у каждого своя версия `react`. Пройдите пресеты по порядку — «cart перешёл на 19», «то же без singleton», «строгий singleton» — и следите за двумя вещами: сколько копий `react` оказалось на странице и что стало с рендером. Считает код из блоков выше — `register`, `consume`, `createContainer`, `runHost`. Флаги общие для всех трёх сборок, `requiredVersion` у каждой — `^` от её версии, как его вывел бы сборщик из `package.json`.';

export const DEMO_VERSIONS = ['18.2.0', '18.3.1', '19.1.0'];

/** Порог ожидания `remoteEntry.js` в демо — не замер, а настройка. */
export const DEMO_TIMEOUT_MS = 1200;

export const DEMO_DEFAULT: MfState = {
  versions: { host: '18.3.1', catalog: '18.2.0', cart: '18.3.1' },
  status: { catalog: 'up', cart: 'up' },
  singleton: true,
  strict: 'auto',
  eager: false,
};

export const DEMO_PRESETS: MfPreset[] = [
  { label: 'совместимые версии', state: DEMO_DEFAULT },
  {
    label: 'cart перешёл на 19',
    state: { ...DEMO_DEFAULT, versions: { host: '18.3.1', catalog: '18.2.0', cart: '19.1.0' } },
  },
  {
    label: 'то же без singleton',
    state: { ...DEMO_DEFAULT, singleton: false, versions: { host: '18.3.1', catalog: '18.2.0', cart: '19.1.0' } },
  },
  {
    label: 'строгий singleton',
    state: { ...DEMO_DEFAULT, strict: 'on', versions: { host: '18.3.1', catalog: '18.2.0', cart: '19.1.0' } },
  },
  {
    label: 'строгий singleton + eager',
    state: { ...DEMO_DEFAULT, strict: 'on', eager: true, versions: { host: '18.3.1', catalog: '18.2.0', cart: '19.1.0' } },
  },
  {
    label: 'catalog упал, cart завис',
    state: { ...DEMO_DEFAULT, status: { catalog: 'down', cart: 'hang' } },
  },
];

// ─── Раздел 3. Две копии на самом деле: стенд ──────────────────────────────────────────────

export const STAND_LIB_CODE = `// lib.js — одна и та же библиотека в сборке host и в сборке remote.
globalThis.libEvaluations = (globalThis.libEvaluations ?? 0) + 1;
export const copy = globalThis.libEvaluations; // номер исполнения этой копии
export class Store {}`;

export const STAND_REMOTE_CODE = `// remoteEntry.js — контейнер remote на чистом ESM.
let shared = {};
export function init(shareScope) {
  shared = shareScope;
}
export async function get(request) {
  if (request !== './Widget') throw new Error('Module ' + request + ' does not exist in container');
  // Своя копия грузится, только если общей нет, — тот же fallback, что в федерации.
  const lib = shared.lib ?? (await import('./lib.js'));
  return () => ({ copy: lib.copy, accepts: (store) => store instanceof lib.Store });
}`;

export const STAND_HOST_CODE = `// app.js — host: грузит контейнер по адресу, делится своей копией или нет.
import * as lib from './lib.js';

export async function start({ remoteUrl, share }) {
  let remote;
  try {
    remote = await import(remoteUrl);
  } catch (error) {
    return { fallback: true, error: error.name + ': ' + error.message };
  }
  await remote.init(share ? { lib } : {});
  const widget = (await remote.get('./Widget'))();
  return {
    evaluations: globalThis.libEvaluations,
    hostCopy: lib.copy,
    remoteCopy: widget.copy,
    instanceofWorks: widget.accepts(new lib.Store()),
  };
}`;

export interface StandRun {
  k: string;
  remote: string;
  share: boolean;
  evaluations?: number;
  /** Сколько раз браузер запросил `lib.js` — у host и у remote вместе. */
  libFetched?: number;
  instanceofWorks?: boolean;
  error?: string;
  tone: 'ok' | 'warn' | 'err';
}

/**
 * Снято в Chromium 153.0.8010.12: страница с `127.0.0.1:49231`, host — `/host/app.js` оттуда же.
 * `evaluations` — сколько раз исполнился `lib.js`, `instanceofWorks` — узнал ли виджет remote
 * объект, созданный классом host. Первые две строки тест повторяет в Node из тех же строк.
 */
export const STAND_RUNS: StandRun[] = [
  {
    k: 'тот же источник, без общего объекта',
    remote: '127.0.0.1:49231/remote/remoteEntry.js',
    share: false,
    evaluations: 2,
    libFetched: 2,
    instanceofWorks: false,
    tone: 'err',
  },
  {
    k: 'тот же источник, `init({ lib })`',
    remote: '127.0.0.1:49231/remote/remoteEntry.js',
    share: true,
    evaluations: 1,
    libFetched: 1,
    instanceofWorks: true,
    tone: 'ok',
  },
  {
    k: 'другой источник, с CORS',
    remote: '127.0.0.1:49232/cors/remoteEntry.js',
    share: false,
    evaluations: 2,
    libFetched: 2,
    instanceofWorks: false,
    tone: 'err',
  },
  {
    k: 'другой источник, с CORS, `init({ lib })`',
    remote: '127.0.0.1:49232/cors/remoteEntry.js',
    share: true,
    evaluations: 1,
    libFetched: 1,
    instanceofWorks: true,
    tone: 'ok',
  },
  {
    k: 'другой источник, **без** CORS',
    remote: '127.0.0.1:49232/nocors/remoteEntry.js',
    share: true,
    error: 'TypeError: Failed to fetch dynamically imported module: http://127.0.0.1:49232/nocors/remoteEntry.js',
    tone: 'warn',
  },
];

export const STAND_TABLE: string[][] = STAND_RUNS.map((r) => [
  r.k,
  r.remote,
  r.error ?? String(r.evaluations),
  r.libFetched === undefined ? '—' : String(r.libFetched),
  r.instanceofWorks === undefined ? '—' : String(r.instanceofWorks),
]);

export const STAND_NOTE =
  'Текст `lib.js` у host и remote совпадает до байта, но лежит по двум адресам — и исполнился дважды: `instanceof` вернул `false` для объекта, который по всем признакам «тот же класс». Передача модуля через `init` — это и есть shareScope в минимальном виде: remote берёт чужой экземпляр, и его собственный `lib.js` браузер **даже не запросил** — по журналу сервера два запроса `lib.js` против одного. Последняя строка — отдельный урок: модуль с другого источника грузится в режиме CORS, и без `Access-Control-Allow-Origin` на `remoteEntry.js` host получает не виджет, а исключение, которое обязан поймать.';

/**
 * Повтор после сбоя, Chromium 153: сервер отвечает 503 на первый запрос `/flaky/remoteEntry.js`
 * и 200 на все следующие. По журналу сервера запросов было два: первый `import()` и адрес
 * с `?retry=1`. Второй `import()` того же адреса в сеть не ходил.
 */
export const RETRY_RUNS: { k: string; request: string; result: string; tone: 'ok' | 'err' }[] = [
  { k: '`import(url)`', request: 'да, ответ 503', result: '`TypeError: Failed to fetch dynamically imported module`', tone: 'err' },
  { k: '`import(url)` ещё раз', request: '**нет**', result: 'та же ошибка — запомнена в module map', tone: 'err' },
  { k: '`import(url + \'?retry=1\')`', request: 'да, ответ 200', result: 'контейнер загружен', tone: 'ok' },
];

export const REACT_TWIN_CODE = `// Две копии React 19.3.0: вторая — копия каталога node_modules/react.
const React = require('react');                        // её импортирует react-dom
const { renderToString } = require('react-dom/server');
const Twin = require('./twin/node_modules/react');     // «React из сборки remote»

function Widget() {
  const [n] = Twin.useState(2);                        // хук из другой копии
  return React.createElement('b', null, n);
}
renderToString(React.createElement(Widget));`;

export const REACT_TWIN_RUNS: { build: string; thrown: string; console: string }[] = [
  {
    build: 'отладочная',
    thrown: "TypeError: Cannot read properties of null (reading 'useState')",
    console: 'Invalid hook call. Hooks can only be called inside of the body of a function component. …',
  },
  {
    build: 'продакшен (`NODE_ENV=production`)',
    thrown: "TypeError: Cannot read properties of null (reading 'useState')",
    console: '— ничего',
  },
];

export const REACT_TWIN_NOTE =
  'Версии одинаковые, `React === Twin` — `false`. Подсказка «You might have more than one copy of React» живёт **только в отладочной сборке**: в продакшен-сборке остаётся голый `TypeError` о чтении из `null`, и по нему двойника не узнать. Как такие двойники появляются в `node_modules` и как их искать — в [«Пакетных менеджерах», раздел «Разрешение и подъём»](/tooling/package-managers/#s2).';

// ─── Раздел 4. Устойчивость ────────────────────────────────────────────────────────────────

export const FAILURE_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Remote упал: ошибка приходит в `import()`',
    d: 'Контейнер грузится тегом `<script>` или `import()`, и сбой сети становится отклонённым промисом там, где host просит модуль. Без обработки — необработанное отклонение и пустое место на странице; с обработкой — заглушка. В React это граница ошибок вокруг `lazy`-компонента, во Vue — `defineAsyncComponent` с `errorComponent`.',
    tone: 'warn',
  },
  {
    t: 'Remote завис: без таймаута ждут вечно',
    d: 'Ни `<script>`, ни `import()` своего таймаута не имеют: пока соединение открыто и байты не пришли, промис не отклоняется. Упавший сервер вернёт ошибку быстро, а медленный — держит место на странице пустым. Поэтому потолок ожидания — `withTimeout` в коде выше — пишет host, а не рантайм.',
    tone: 'err',
  },
  {
    t: 'Упасть должен виджет, а не страница',
    d: 'Ошибка в `get` — несовместимая версия у строгого singleton, пропавший `./Widget` — тоже отклонённый промис. Если ловить только ошибки сети, remote с неверной версией положит host. В демо выше это видно: строгий singleton при `eager: false` роняет host целиком, а при `eager: true` — только виджет корзины.',
    tone: 'warn',
  },
  {
    t: 'Повтор — только с другой меткой',
    d: 'Неудачную загрузку браузер запоминает в module map: второй `import()` того же адреса вернул ту же ошибку, **не сходив в сеть**, хотя сервер уже отвечал 200 (стенд ниже, Chromium 153). Повтор после сбоя идёт по адресу с меткой, например `?retry=1`.',
  },
];

export const SKEW_ROWS: { k: string; what: string; tone: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    k: 'remote добавил экспорт',
    what: 'Старый host его не зовёт — безопасно. Новый host на старом remote получит `Module "./New" does not exist in container`: выкатывать remote раньше host.',
    tone: 'ok',
  },
  {
    k: 'remote удалил или переименовал экспорт',
    what: 'Ломает всех, кто его зовёт, **в момент выката remote**, а не их сборки. Удалять можно, только когда ни один выкатанный host его не использует.',
    tone: 'err',
  },
  {
    k: 'remote сменил пропсы виджета',
    what: 'Контейнер этого не видит: `get` отдаст модуль, host передаст старые пропсы. Ошибка — при рендере или хуже, молчаливое неверное поведение. Отсюда версионирование контракта: `./Widget` и `./WidgetV2` рядом, пока хосты не переехали.',
    tone: 'err',
  },
  {
    k: 'remote поднял мажор общей зависимости',
    what: 'Singleton выберет новую версию **для всех**, включая host, собранный под старую, — с предупреждением в консоли. Строгий singleton бросит. Не singleton — вторая копия. Все три исхода — в демо выше.',
    tone: 'warn',
  },
];

export const CACHE_ROWS: { k: string; header: string; why: string; tone: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    k: '`remoteEntry.js`',
    header: '`Cache-Control: no-cache`',
    why: 'Имя постоянное, содержимое меняется с каждым выкатом. Закешировали на час — час host открывает вчерашний контейнер, а тот просит вчерашние чанки. Вариант: версия в адресе контейнера, которую host узнаёт из манифеста.',
    tone: 'warn',
  },
  {
    k: 'чанки remote с хешем в имени',
    header: '`Cache-Control: public, max-age=31536000, immutable`',
    why: 'Новый код — новое имя, старое имя навсегда значит одно и то же. Как в любой сборке.',
    tone: 'ok',
  },
  {
    k: 'старые чанки после выката',
    header: 'не удалять сразу',
    why: 'Вкладка, открытая до выката, держит в памяти старый контейнер и попросит старые чанки, когда пользователь дойдёт до виджета. Удалили — `ChunkLoadError` у всех, кто не перезагрузил страницу.',
    tone: 'err',
  },
];

export const CACHE_NOTE =
  'Почему `no-cache` не значит «не хранить», а означает «хранить, но спрашивать», и как работает `ETag` — в [«Сети и кешировании», раздел «Кеш и валидация»](/platform/network/#s2). Как CDN держит постоянное имя свежим и зачем версия в адресе — в [«CDN и серверном кеше», раздел «Purge и версии»](/platform/cdn-cache/#s4).';

// ─── Раздел 5. Контракты, типы, стили ──────────────────────────────────────────────────────

export const CONTRACT_FACTS: { t: string; d: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Типы: у host нет исходников remote',
    d: '`import(\'cart/Widget\')` для TypeScript — модуль, которого не существует. Обычные ответы: пакет с типами контракта, который публикует команда remote, или генерация `.d.ts` из `exposes` при сборке remote с загрузкой в host (так делает Module Federation 2.0 — по документации, без прогона). Оба проверяют сборку host против **какой-то** версии remote, а не той, что выкатана сейчас.',
    tone: 'info',
  },
  {
    t: 'Контракт — это пропсы и события, а не импорт',
    d: 'Чем уже граница, тем реже она ломается. Виджет, принимающий `{ userId }` и сообщающий событием «товар добавлен», переживает годы. Виджет, которому host передаёт своё хранилище состояния, экземпляр роутера и тему, ломается при каждом их обновлении — и требует singleton на всё, что передано.',
  },
  {
    t: 'Стили: один документ — один каскад',
    d: 'Remote, загруженный федерацией, живёт в том же документе, что и host: его глобальный `button { … }` красит кнопки host. Защита — префиксы и CSS-модули на стороне remote либо теневой корень, если remote — веб-компонент. Как стили переходят его границу и какие не переходят — в [«Стилях веб-компонентов»](/render/web-components-styles/#s1).',
    tone: 'warn',
  },
  {
    t: 'Роутинг и глобальное состояние',
    d: 'URL на странице один. Кто им владеет — договорённость, а не механизм: обычно host владеет верхним уровнем пути, а remote — всем, что ниже своего префикса. То же с `localStorage`, куками и `window.*`: общее пространство имён без хозяина.',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Singleton молча переводит host на чужой мажор',
    d: 'Remote выкатил `react@19`, host собран под `^18.3.0`. Singleton без `strictVersion` выберет старшую — `19.1.0` — **для всех**, и host работает на версии, под которую его не собирали. Единственный след — предупреждение `Unsatisfied version` в консоли пользователя. В демо: пресет «cart перешёл на 19».',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Строгий singleton роняет host, а не remote',
    d: 'Включили `strictVersion`, чтобы не работать на чужом мажоре, — и выкат одного remote с новым мажором ломает host: host выбирает версию последним, когда все контейнеры уже положили свои, и бросает сам. Пока host не взял свою копию раньше всех (`eager`), ошибку получает он.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Две копии одной версии — тоже две копии',
    d: 'Если пакет не объявлен общим в **обеих** сборках, каждая исполнит свою — версия тут ни при чём. Стенд: одинаковые React 19.3.0 из двух каталогов, рендер падает `TypeError: Cannot read properties of null (reading \'useState\')`, и подсказки про двойника в продакшен-сборке нет.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`eager` меняет не только размер стартового чанка',
    d: 'Взятая раньше всех копия помечается загруженной, и singleton выбирает её, даже если в shareScope потом появится старшая. `eager` в host фиксирует версию host для всех remote. Обратная сторона: без `eager` и без асинхронной границы webpack бросает `Shared module is not available for eager consumption`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Одну версию от двух сборок выбирают по имени сборки',
    d: 'Если `18.3.1` положили host и remote, в shareScope останется одна запись: `eager` побеждает не-`eager`, а при равенстве — сборка, чьё имя **больше по строке**. Две сборки одной версии не обязаны совпадать байтами: разные `define`, разные полифилы. Какая из них работает, решает алфавит: сравнивается `output.uniqueName` сборки, по умолчанию — имя из её `package.json` (`ShareRuntimeModule` в webpack 5.111).',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Закешированный `remoteEntry.js` — это вчерашний remote',
    d: 'Контейнер — единственный файл remote с постоянным именем. С `max-age` он переживает выкат, а старые чанки, на которые он ссылается, к этому моменту могут быть удалены. Итог — `ChunkLoadError` у части пользователей, воспроизвести который у себя не выходит.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Ошибка загрузки запоминается',
    d: 'Модуль, чья загрузка упала, остаётся в module map с ошибкой: на стенде второй `import()` того же адреса отклонился сразу, без запроса, хотя сервер уже поднялся. Кнопка «попробовать ещё раз» без изменения адреса не делает ничего.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Контейнер с другого источника требует CORS',
    d: 'Модульный скрипт грузится в режиме CORS. Без `Access-Control-Allow-Origin` на `remoteEntry.js` и чанках Chromium 153 отдал `TypeError: Failed to fetch dynamically imported module` — ту же ошибку, что и при упавшем сервере. По тексту ошибки их не различить; смотреть надо во вкладку «Сеть».',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'webpack — Module Federation',
    href: 'https://webpack.js.org/concepts/module-federation/',
    what: 'host и remote, контейнер с `init` и `get`, асинхронная граница `bootstrap`, ошибка eager-потребления',
  },
  {
    title: 'webpack — ModuleFederationPlugin',
    href: 'https://webpack.js.org/plugins/module-federation-plugin/',
    what: '`shared`: `singleton`, `requiredVersion`, `strictVersion`, `eager` и их умолчания',
  },
  {
    title: 'webpack — `lib/sharing/`',
    href: 'https://github.com/webpack/webpack/tree/v5.111.1/lib/sharing',
    what: '`ShareRuntimeModule` (регистрация версии), `ConsumeSharedRuntimeModule` (выбор версии, тексты предупреждений и ошибок), `ConsumeSharedPlugin` (умолчание `strictVersion`); код темы сверен с тегом v5.111.1',
  },
  {
    title: 'Module Federation 2.0',
    href: 'https://module-federation.io/',
    what: 'рантайм вне сборщика, манифест, генерация типов, `shareStrategy`',
  },
  {
    title: 'React — Invalid Hook Call Warning',
    href: 'https://react.dev/warnings/invalid-hook-call-warning',
    what: 'две копии React как причина и как её найти',
  },
  {
    title: 'Cam Jackson — Micro Frontends',
    href: 'https://martinfowler.com/articles/micro-frontends.html',
    what: 'зачем и чем платят: независимые выкаты, способы интеграции, общие зависимости',
  },
  {
    title: 'HTML Standard — fetch a single module script',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script',
    what: 'module map по URL, режим CORS для модулей, запомненная неудача',
  },
];

export const RELATED =
  'Смежное на сайте: [Модули и сборка](/tooling/modules/#s1) — module map и import maps: почему один адрес — один экземпляр. [Модули и сборка, раздел «Чанки и кеш»](/tooling/modules/#s5) — хеши в именах и динамический `import()`. [Пакетные менеджеры](/tooling/package-managers/#s2) — двойники в `node_modules` и semver. [CDN и серверный кеш](/platform/cdn-cache/#s4) — постоянные имена и версии в адресе. [Сеть и кеширование](/platform/network/#s2) — `no-cache` и валидация. [Стили веб-компонентов](/render/web-components-styles/) — изоляция стилей теневым корнем.';
