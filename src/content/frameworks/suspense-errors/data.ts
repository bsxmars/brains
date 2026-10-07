import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Status, TreeNode } from '@/widgets/boundary-lab/model/types';

/**
 * Данные темы «Suspense и границы ошибок: кто ловит брошенное из рендера».
 *
 * Тема написана 2026-10-02 для направления «Фреймворки изнутри».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * React **19.3.0** и react-dom 19.3.0 (`react-dom/client`), Vue **3.5.42**, happy-dom 20.14.5
 * как DOM, Node 24.11.0 — всё из `node_modules` проекта, октябрь 2026. Скрипты стенда лежали
 * в scratchpad агента; всё, что из них попало в текст, пересобирается
 * `tests/unit/suspense-errors.test.ts` тем же кодом, что напечатан в теме:
 *   — JSX-примеры (`USE_CODE`, `CACHED_CODE`, `UNSTABLE_CODE`, `WATERFALL_CODE`,
 *     `PREFETCH_CODE`, `TRANSITION_CODE`, `BOUNDARY_CLASS_CODE`, `FORWARD_CODE`, `ROOT_CODE`,
 *     `DEMO_TREE_JSX`) снимаются `typescript.transpileModule` с `jsx: react-jsx` и
 *     монтируются в настоящий React; данные отдаёт заглушка `fetchUser`/`fetchPosts`,
 *     промисы которой тест выполняет сам — без таймеров;
 *   — Vue-примеры (`VUE_*_SFC`) компилируются `@vue/compiler-sfc` и монтируются в Vue 3.5;
 *   — учебная модель `BOUNDARY_CODE` сверяется с React и Vue на **всех 243** сочетаниях
 *     «готов / ждёт / падает» пяти компонентов демо-дерева (что видно на экране, какие
 *     границы ошибок сработали и в каком порядке, что ушло мимо всех границ) и на тех же
 *     243 сочетаниях в режиме «волнами» (кто и когда начал загрузку).
 *
 * Как снимали: React — `createRoot` внутри `act` там, где важен итог, и **без** `act` там,
 * где важны колбэки корня (под `act` React не зовёт `onUncaughtError`, а складывает ошибку
 * и бросает её из `act` — см. «Тонкие места»). «Что видно» — текст DOM без узлов
 * со `style.display === 'none'`: так React прячет содержимое, уже показанное до заглушки.
 *
 * Отладочная и рабочая сборки React вызывают функцию упавшего компонента разное число раз
 * за проход (на стенде 2 и 3) — в текст это число не попало, только то, что сборки
 * совпадают в главном: второй, синхронный проход по корню и порядок колбэков. Рабочая
 * сборка снята отдельным процессом с `NODE_ENV=production`; в тесте — отладочная.
 *
 * Только из исходников (не проверено запуском, помечено в тексте как устройство):
 * `FALLBACK_THROTTLE_MS = 300` (`react-dom-client.development.js`), то, что обработчики
 * по умолчанию у корня — `reportError` для непойманных и `console.error` для пойманных
 * (`defaultOnUncaughtError` / `defaultOnCaughtError`), что `use` для `useSuspenseQuery`
 * в TanStack Query — по документации библиотеки. Vue `info` в рабочей сборке — ссылка
 * `https://vuejs.org/error-reference/#runtime-1`: снято отдельным процессом с
 * `NODE_ENV=production`, в тесте не повторяется (Vue в vitest — отладочная сборка).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'рендер',
    d: 'Вызов функции компонента: React или Vue спрашивают, что нарисовать. Результат — описание разметки, а не сама разметка. Рендер можно повторить и выбросить, на экран он попадает только после **коммита**.',
  },
  {
    k: 'коммит',
    d: 'Шаг, на котором фреймворк применяет посчитанное к DOM. До коммита пользователь не видит ничего из нового рендера.',
  },
  {
    k: 'граница `<Suspense>`',
    d: 'Компонент-обёртка. Пока что-то внутри ждёт данных, вместо всего содержимого показывается заглушка.',
  },
  {
    k: 'заглушка (`fallback`)',
    d: 'То, что граница показывает вместо содержимого: «Загружаем…» у Suspense, «Что-то сломалось» у границы ошибок.',
  },
  {
    k: 'граница ошибок',
    d: 'Компонент, который ловит ошибки из рендера своих потомков и показывает заглушку вместо упавшего поддерева. В React — классовый компонент, во Vue — компонент с хуком `onErrorCaptured`.',
  },
  {
    k: '`use(promise)`',
    d: 'Функция React 19: если промис выполнен — возвращает значение, если ещё ждёт — останавливает рендер компонента до его выполнения.',
  },
  {
    k: 'переход (`startTransition`)',
    d: 'Пометка «это обновление не срочное». Такое обновление React может отложить и не показывать ради него заглушку.',
  },
];

export const PLAIN_THROW =
  'Как пожарная тревога в офисе. Сотрудник не ищет, кому звонить, — он нажимает кнопку, и сигнал идёт вверх по зданию, пока не дойдёт до того, кто отвечает именно за пожары. Охранник на входе за пожары не отвечает и просто пропускает сигнал дальше. Suspense отвечает за «данных ещё нет», граница ошибок — за «всё сломалось», и каждая пропускает чужой сигнал мимо себя.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи, разобранные в других темах.';

export const PREREQ: { t: string; d: string; href: string; hrefLabel: string; tone: 'info' }[] = [
  {
    t: 'Рендер и коммит — разные шаги',
    d: 'React сначала считает новое дерево и только потом одним заходом меняет DOM. Посчитанное можно выбросить без следа — на этом стоит весь Suspense.',
    href: '/frameworks/react-internals/#s3',
    hrefLabel: '«React изнутри: свой рендерер и хуки», раздел «Две фазы»',
    tone: 'info',
  },
  {
    t: 'Промис и его состояния',
    d: 'Промис ждёт (pending), выполнен (fulfilled) или отклонён (rejected). Подписаться на него — значит оставить колбэк, который вызовут, когда состояние сменится.',
    href: '/js/promise-internals/#s1',
    hrefLabel: '«Промис изнутри», раздел «Модель»',
    tone: 'info',
  },
  {
    t: '`throw` и `try/catch`',
    d: 'Брошенное значение летит вверх по стеку вызовов до ближайшего `catch`. Бросить можно что угодно, не только `Error`, — и React этим пользуется.',
    href: '/js/errors/#s1',
    hrefLabel: '«Ошибки и стеки», раздел «Объект ошибки»',
    tone: 'info',
  },
  {
    t: 'Срочные и несрочные обновления',
    d: 'React раскладывает обновления по приоритетам — полосам. Переход идёт в несрочной полосе, и его рендер можно прервать или отложить.',
    href: '/frameworks/react-concurrent-internals/#s4',
    hrefLabel: '«React изнутри: конкурентность и lanes», раздел «Переходы»',
    tone: 'info',
  },
];

// ─── Раздел 1. Бросок и ближайшая граница ──────────────────────────────────────────────────

export const S1_LEAD =
  'Компонент, которому не хватает данных, не может вернуть «подожди» из своей функции: рендер синхронный. Поэтому он **бросает** — `use(promise)` прерывает функцию прямо на своей строке. React ловит бросок, идёт вверх по дереву до ближайшего `<Suspense>` и показывает его заглушку. Когда промис выполнится, React рендерит содержимое границы заново, с начала.';

export const USE_CODE = `// Промис создан один раз — снаружи компонента
const userPromise = fetchUser(1);

function Profile() {
  log('Profile');
  const user = use(userPromise);   // ждёт — бросает; готов — отдаёт значение
  return <h2>{user.name}</h2>;
}

function Stats() {
  log('Stats');
  return <p>Подписчиков: 12</p>;
}

function Page() {
  return (
    <Suspense fallback={<p>Загружаем профиль…</p>}>
      <Profile />
      <Stats />
    </Suspense>
  );
}`;

/** Вызовы `log` и экран в момент каждого вызова — снято тестом в React 19.3. */
export const USE_ROWS = [
  { step: '1. Рендер', calls: '`Profile`', screen: 'пусто', what: '`use` бросил: промис ещё ждёт. Рендер `Stats` даже не начат — бросок остановил обход границы.' },
  { step: '2. Коммит заглушки', calls: '—', screen: '«Загружаем профиль…»', what: 'React дошёл до `<Suspense>` и закоммитил её заглушку вместо всего содержимого.' },
  { step: '3. Прогрев', calls: '`Profile`, `Stats`', screen: '«Загружаем профиль…»', what: 'Сразу после коммита React ещё раз рендерит содержимое, чтобы соседи успели начать свои загрузки. Результат выбрасывается.' },
  { step: '4. Промис выполнен', calls: '`Profile`, `Stats`', screen: '«Ада», «Подписчиков: 12»', what: 'Колбэк на промисе заказал новый рендер. Граница рендерится с начала, `use` теперь отдаёт значение.' },
];

export const USE_NOTE =
  'Компонент **не продолжается** с места остановки. Всё, что функция успела посчитать до `use`, считается заново: React хранит не «место в функции», а только сам промис. Поэтому рендер обязан быть чистым — без запросов, записи в переменные снаружи и других побочных эффектов: он выполнится столько раз, сколько React понадобится.';

export const PLAIN_RETRY =
  'Как повар, у которого кончилась мука: он не держит полуготовое тесто на столе, а выбрасывает его, отдаёт гостю хлеб «пока ждёте» и начинает блюдо заново, когда привезут муку. Готовить дважды дешевле, чем помнить, на каком шаге остановился.';

export const S1_INTERNALS =
  'Как именно React ловит бросок, вешает колбэк на промис и в какой полосе идёт повторный рендер, разобрано по шагам с мини-реализацией в теме [«React изнутри: конкурентность и lanes», раздел «Suspense»](/frameworks/react-concurrent-internals/#s5). Там же — про 300 мс задержки, чтобы заглушка не мигнула. Здесь — что из этого следует для того, кто расставляет границы.';

export const S1_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Без границы ждёт весь корень',
    d: 'Если над ждущим компонентом нет `<Suspense>`, бросок доходит до корня. При первом рендере на экране не появится **ничего** — ни шапка, ни соседние блоки, пока промис не выполнится.',
    tone: 'warn',
  },
  {
    t: 'Граница прячет всё содержимое',
    d: 'Заглушку получает граница целиком. Готовый `Stats` из примера не покажется, пока ждёт `Profile`: внутри одной границы содержимое появляется разом.',
  },
  {
    t: 'Бросает не только `use`',
    d: '`React.lazy` бросает промис загрузки кода. До `use` библиотеки бросали промис сами, `throw promise` — этот путь React 19.3 ещё поддерживает, но в исходниках он помечен как устаревший.',
  },
];

// ─── Раздел 2. Стабильный промис ───────────────────────────────────────────────────────────

export const S2_LEAD =
  'Повторный рендер начинается с начала функции. Значит, строка `use(fetchUser(id))` при каждом повторе создаёт **новый** запрос и новый промис, и React снова ждёт — уже его. Промис нужно брать из места, которое переживает рендер: кеша, библиотеки данных, загрузчика маршрута.';

export const UNSTABLE_CODE = `function Profile({ id }) {
  // Новый промис на каждый рендер
  const user = use(fetchUser(id));
  return <h2>{user.name}</h2>;
}`;

export const CACHED_CODE = `const cache = new Map();

function getUser(id) {
  if (!cache.has(id)) cache.set(id, fetchUser(id));
  return cache.get(id);   // тот же промис, пока ключ тот же
}

function Profile({ id }) {
  const user = use(getUser(id));
  return <h2>{user.name}</h2>;
}`;

/** Снято тестом: `Profile id={1}` в `<Suspense>`, промисы выполняются по одному. */
export const UNSTABLE_ROWS = [
  { k: 'первый рендер и прогрев', bad: 'рендеров 2 · промисов 2 · заглушка', good: 'рендеров 2 · промисов 1 · заглушка' },
  { k: 'выполнен 1-й промис', bad: 'рендеров 3 · промисов 3 · заглушка', good: 'рендеров 3 · промисов 1 · **«Ада #1»**' },
  { k: 'выполнен 2-й промис', bad: 'рендеров 4 · промисов 4 · заглушка', good: '—' },
  { k: 'выполнен 3-й промис', bad: 'рендеров 5 · промисов 5 · заглушка', good: '—' },
];

export const UNSTABLE_NOTE =
  'Без кеша каждый выполненный промис будит рендер, а рендер заказывает следующий запрос. Цикл не кончается и ошибки не даёт: на экране вечная заглушка, а в сети — запрос за запросом. С кешем второй рендер получает **тот же** промис, уже выполненный, и `use` сразу отдаёт значение.';

export const UNCACHED_WARNING =
  'Предупреждение в консоли бывает не всегда. React 19.3 пишет `A component was suspended by an uncached promise…`, только если при повторе в той же попытке рендера увидел другой промис на том же месте. На стенде так вышло с `use(Promise.resolve(…))`: промис уже выполнен, React повторил рендер сразу — и заметил подмену. Содержимое при этом показалось. С настоящим запросом, который идёт дольше, — тишина и бесконечная заглушка.';

export const PLAIN_CACHE =
  'Как номерок в гардеробе. Сдали пальто — получили номерок, и сколько бы раз вы ни подходили к стойке, по номерку выдадут то же пальто. Без номерка каждый подход — новое пальто в очередь на сдачу, и своё вы не получите никогда.';

export const CACHE_WHERE: { t: string; d: string }[] = [
  {
    t: 'Свой кеш по ключу',
    d: '`Map` из примера — честный минимум. Чего ему не хватает: он не забывает старое и не умеет «перезапросить». Кеш нужно чистить по ключу или по времени.',
  },
  {
    t: 'Библиотека данных',
    d: 'TanStack Query с `useSuspenseQuery` держит промис в своём кеше по ключу запроса — по документации библиотеки, этот хук и бросает для Suspense. Как устроен такой кеш, разобрано в теме [«Кеш данных на клиенте», раздел «Кеш по ключу»](/frameworks/data-cache/#s2).',
  },
  {
    t: 'Сервер',
    d: 'В Server Components промис создают на сервере и передают клиенту пропом — там он стабилен сам по себе. Склейку одинаковых запросов на сервере даёт `cache()`: [«Server Components изнутри», раздел «Async, Suspense и cache()»](/frameworks/server-components/#s6).',
  },
];

// ─── Раздел 3. Водопад ─────────────────────────────────────────────────────────────────────

export const S3_LEAD =
  'Компонент начинает загрузку, только когда до него дошёл рендер. Если дочерний компонент лежит **внутри** того, кто ждёт, его рендер не начнётся, пока родитель не дождётся своего. Запросы выстраиваются в очередь — водопадом, — хотя друг от друга не зависят.';

export const WATERFALL_CODE = `function UserPage({ id }) {
  const user = use(getUser(id));          // 1-й запрос
  return (
    <section>
      <h1>{user.name}</h1>
      <Suspense fallback={<p>Посты…</p>}>
        <Posts userId={id} />              {/* 2-й — только после 1-го */}
      </Suspense>
    </section>
  );
}

function Posts({ userId }) {
  const posts = use(getPosts(userId));
  return <p>Постов: {posts.length}</p>;
}`;

export const PREFETCH_CODE = `function UserRoute({ id }) {
  // Оба запроса стартуют здесь — до первого броска
  getUser(id);
  getPosts(id);
  return (
    <Suspense fallback={<p>Профиль…</p>}>
      <UserPage id={id} />
    </Suspense>
  );
}`;

/** Снято тестом: каждую волну тест выполняет все начатые запросы. */
export const WATERFALL_ROWS = [
  { k: '`<UserPage>` как есть', w1: '`user`', w2: '`posts`', screen: '«Профиль…» → имя и «Посты…» → всё', trips: '2' },
  { k: '`<UserRoute>` — запросы подняты', w1: '`user`, `posts`', w2: '—', screen: '«Профиль…» → всё сразу', trips: '1' },
];

export const WATERFALL_NOTE =
  'Соседям внутри **одной** границы водопад не грозит: после заглушки React прогревает соседей, и их загрузки стартуют в той же волне. Две **соседние** границы тоже грузятся параллельно, но показываются по отдельности — каждая, когда готова сама. Всё это видно в демо в конце темы, в режиме «волнами»: там же — что Vue ведёт себя так же.';

export const WATERFALL_FIX =
  'Лечат водопад одним приёмом — **начать загрузку раньше рендера того, кому она нужна**. Вручную, как в `UserRoute`; загрузчиком маршрута, который стартует запросы при переходе ([«Роутер изнутри», раздел «Ленивые маршруты и данные»](/frameworks/router/#s8)); на сервере, где Server Components ждут промисы, не дожидаясь границ. Граница решает, **что показывать** во время ожидания, — порядок запросов она не меняет.';

// ─── Раздел 4. Переходы ────────────────────────────────────────────────────────────────────

export const S4_LEAD =
  'Граница показывает заглушку, когда содержимое ещё не готово. Но что делать, если оно уже на экране, а новое обновление снова бросило промис? Обычное обновление прячет показанное за заглушкой. Переход оставляет старое на месте, пока новое не будет готово.';

export const TRANSITION_CODE = `function App() {
  const [id, setId] = useState(1);
  const [isPending, startTransition] = useTransition();

  return (
    <main>
      <button onClick={() => setId(2)}>Обычно</button>
      <button onClick={() => startTransition(() => setId(2))}>Переходом</button>
      {isPending && <p>Обновляем…</p>}
      <Suspense fallback={<p>Загружаем профиль…</p>}>
        <Profile id={id} />
      </Suspense>
    </main>
  );
}`;

/** Снято тестом: «Ада» — пользователь 1, «Грейс» — 2; профиль из `CACHED_CODE`. */
export const TRANSITION_ROWS = [
  { k: 'до клика', plain: '«Ада»', trans: '«Ада»' },
  { k: 'клик, промис ждёт', plain: '«Загружаем профиль…»; «Ада» в DOM, но скрыта `display: none`', trans: '«Обновляем…» и «Ада»' },
  { k: 'промис выполнен', plain: '«Грейс»', trans: '«Грейс»' },
];

export const TRANSITION_NOTE =
  'Обычное обновление не удаляет показанное, а **прячет**: React ставит узлам `display: none !important` и оставляет компоненты смонтированными — их состояние переживёт ожидание. Переход не коммитит ничего, пока новое не готово, а `isPending` даёт показать, что работа идёт. Почему переход умеет ждать — он идёт в несрочной полосе, и React вправе не коммитить её рендер, — разобрано в теме [«React изнутри: конкурентность и lanes», раздел «Переходы»](/frameworks/react-concurrent-internals/#s4).';

export const TRANSITION_WHEN =
  'Правило выбора простое. Новый экран, которого ещё не было, — заглушка честна. Смена данных на уже показанном экране (вкладка, фильтр, следующая страница списка) — переход: мигнуть заглушкой и снова показать почти то же самое хуже, чем подержать старое ещё полсекунды. Документация React ждёт того же от роутеров с поддержкой Suspense: переход по ссылке они оборачивают в `startTransition` сами.';

// ─── Раздел 5. Граница ошибок ──────────────────────────────────────────────────────────────

export const S5_LEAD =
  'Ошибку из рендера React ловит тем же путём, что и промис: идёт вверх по дереву до ближайшей **границы ошибок**. Отдельного хука для этого нет — граница пишется классом, потому что ей нужны два метода, которых у функций нет.';

export const BOUNDARY_CLASS_CODE = `class ErrorBoundary extends Component {
  state = { error: null };

  // Рендер-фаза: по ошибке решить, что показать. Без побочных эффектов
  static getDerivedStateFromError(error) {
    return { error };
  }

  // Коммит: заглушка уже на экране — время отправить отчёт
  componentDidCatch(error, info) {
    this.props.onError?.(error, info.componentStack);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}`;

export const BOUNDARY_USE_CODE = `<ErrorBoundary fallback={<p>Ленту показать не удалось</p>} onError={report}>
  <Feed />
</ErrorBoundary>`;

export const PLAIN_BOUNDARY =
  'Как автомат в электрощитке. Замкнуло в одной комнате — выбило автомат этой комнаты, остальная квартира со светом. Нет автоматов по комнатам — выбивает вводной, и темно везде. Граница ошибок — такой автомат: она гасит своё поддерево и показывает заглушку, а соседи продолжают работать.';

/** Порядок снят тестом (отладочная сборка); рабочая сборка дала тот же порядок. */
export const ERROR_ORDER_CHIPS: { label: string; tone?: 'ink' | 'info' | 'warn' | 'ok' | 'dashed' }[] = [
  { label: 'Feed бросает', tone: 'warn' },
  { label: 'повтор рендера корня', tone: 'dashed' },
  { label: 'getDerivedStateFromError', tone: 'info' },
  { label: 'render → fallback', tone: 'info' },
  { label: 'коммит', tone: 'ink' },
  { label: 'root.onCaughtError', tone: 'ok' },
  { label: 'componentDidCatch', tone: 'ok' },
];

export const ERROR_ORDER_NOTE =
  'Два шага здесь неочевидны. **Повтор**: получив ошибку в конкурентном рендере, React один раз рендерит весь корень заново, синхронно, — вдруг ошибка была гонкой с данными, которые менялись по ходу. Если повтор прошёл чисто, граница не срабатывает, а ошибка уходит в `onRecoverableError` корня с текстом `There was an error during concurrent rendering but React was able to recover…`. **Две половины границы**: `getDerivedStateFromError` вызывается в рендере, и его результат можно выбросить, — поэтому он только возвращает новое состояние. `componentDidCatch` — после коммита, ровно один раз: место для отчёта.';

export const NOT_CAUGHT_ROWS = [
  { k: 'ошибка в рендере потомка', res: '**ловит**', how: 'Заглушка границы вместо поддерева; соседи границы живут.' },
  { k: '`use()` с отклонённым промисом', res: '**ловит**', how: 'Сначала покажется заглушка Suspense: React узнаёт, что промис отклонён, только подписавшись на него. Потом ошибка уходит к границе ошибок.' },
  { k: 'обработчик события (`onClick`)', res: 'нет', how: 'Это не рендер. React передаёт ошибку в `reportError` — у `window` срабатывает событие `error`, экран не меняется.' },
  { k: 'асинхронный код (`then`, `setTimeout`)', res: 'нет', how: 'Ошибка случится позже, когда рендер давно кончился. Отклонённый промис станет `unhandledrejection`.' },
  { k: 'ошибка в самой границе', res: 'нет', how: 'Упала заглушка границы — ошибку получает **следующая** граница выше. Граница не ловит себя.' },
];

export const NOT_CAUGHT_NOTE =
  'Куда уходят ошибки, которые не поймал никто, — события `error` и `unhandledrejection` у `window`, `process.on(\'uncaughtException\')` в Node — разобрано в теме [«Ошибки и стеки», раздел «Необработанные»](/js/errors/#s4).';

export const FORWARD_CODE = `function Feed() {
  const [, setState] = useState();

  useEffect(() => {
    loadMore().catch((error) => {
      // Функция-обновление выполнится в рендере — и бросит там
      setState(() => { throw error; });
    });
  }, []);

  return <p>Лента</p>;
}`;

export const FORWARD_NOTE =
  'Асинхронную ошибку можно **принести** в рендер. Функцию, переданную в `setState`, React вызывает во время следующего рендера компонента — и всё, что она бросит, летит к границе как обычная ошибка рендера. На стенде `loadMore`, отклонённый с `Error`, дал заглушку ближайшей границы и `componentDidCatch` с этой ошибкой.';

// ─── Раздел 6. Ошибки у корня ──────────────────────────────────────────────────────────────

export const S6_LEAD =
  'В React 19 корень получил три колбэка: для ошибок, пойманных границей, для непойманных и для тех, от которых React оправился сам. Раньше всё это можно было увидеть только в консоли.';

export const ROOT_CODE = `const root = createRoot(container, {
  // Граница поймала: заглушка на экране
  onCaughtError(error, { componentStack, errorBoundary }) {
    report('caught', error, componentStack);
  },
  // Не поймал никто: React снял всё дерево
  onUncaughtError(error, { componentStack }) {
    report('uncaught', error, componentStack);
  },
  // Повторный синхронный рендер прошёл: экран целый
  onRecoverableError(error) {
    report('recovered', error.cause ?? error);
  },
});`;

export const ROOT_ROWS = [
  { k: '`onCaughtError`', when: 'граница ошибок поймала; вызывается после коммита, **до** `componentDidCatch`', arg: '`componentStack`, `errorBoundary` — экземпляр сработавшей границы', def: '`console.error`' },
  { k: '`onUncaughtError`', when: 'ошибка дошла до корня', arg: '`componentStack`', def: '`reportError` — событие `error` у `window`' },
  { k: '`onRecoverableError`', when: 'синхронный повтор рендера прошёл без ошибки; несовпадение при гидратации', arg: 'исходная ошибка — в `error.cause`', def: '`reportError`' },
];

export const ROOT_NOTE =
  '**Непойманная ошибка снимает весь корень.** На стенде корень сначала показал страницу, потом обновление уронило один компонент без границы над ним — и контейнер опустел целиком, вместе с шапкой, которая не падала. React считает, что лучше не показать ничего, чем показать дерево в неизвестном состоянии. Отсюда практическое правило: граница ошибок вокруг каждого самостоятельного блока страницы и одна — у самого корня.';

export const ROOT_DEFAULTS =
  'Обработчики по умолчанию — по исходникам React 19.3: непойманная ошибка уходит в `reportError` (в браузере это событие `error` у `window`, его видят сервисы ошибок), пойманная — в `console.error`. В отладочной сборке к ним добавляется подсказка вида `An error occurred in the <Feed> component`.';

// ─── Раздел 7. Vue ─────────────────────────────────────────────────────────────────────────

export const S7_LEAD =
  'Во Vue те же две идеи устроены иначе. Ждать умеет `async setup`: компонент с `await` в `<script setup>` не рисуется, пока промис не выполнится, а ближайший `<Suspense>` показывает заглушку. Ошибки ловит хук `onErrorCaptured` у любого предка — классов не нужно, и ловит он больше, чем граница React.';

export const VUE_PROFILE_SFC = `<!-- Profile.vue -->
<script setup>
import { fetchUser } from './api';

const props = defineProps({ id: Number });
// await на верхнем уровне делает setup асинхронным
const user = await fetchUser(props.id);
</script>

<template>
  <h2>{{ user.name }}</h2>
</template>`;

export const VUE_PAGE_SFC = `<!-- Page.vue -->
<script setup>
import Profile from './Profile.vue';
</script>

<template>
  <Suspense>
    <Profile :id="1" />
    <template #fallback>
      <p>Загружаем профиль…</p>
    </template>
  </Suspense>
</template>`;

export const VUE_BOUNDARY_SFC = `<!-- ErrorBoundary.vue -->
<script setup>
import { onErrorCaptured, shallowRef } from 'vue';

defineProps({ fallback: String });
const emit = defineEmits(['caught']);
const error = shallowRef(null);

onErrorCaptured((err, instance, info) => {
  error.value = err;
  emit('caught', err, info);
  return false;   // дальше не всплывать
});
</script>

<template>
  <p v-if="error">{{ fallback }}</p>
  <slot v-else />
</template>`;

export const VUE_APP_CODE = `const app = createApp(App);

// Всё, что не остановил ни один onErrorCaptured
app.config.errorHandler = (error, instance, info) => {
  report(error, info);
};

app.mount('#app');`;

export const VUE_PROPAGATION =
  'Ошибка во Vue идёт вверх по **всем** предкам: каждый `onErrorCaptured` на пути получает её по очереди, от ближнего к дальнему. `return false` останавливает подъём — дальние предки и `app.config.errorHandler` ошибку не увидят. Без `return false` граница покажет заглушку, но ошибка пойдёт дальше: на стенде внутренняя граница без `false` и внешняя с `false` сработали обе, а заглушку на экране оставила внешняя — она заменила всё поддерево вместе с внутренней.';

/** Каждая строка снята тестом в React 19.3 и Vue 3.5.42, кроме помеченных. */
export const VUE_ROWS = [
  { k: 'ошибка в рендере', react: 'граница ошибок', vue: '`onErrorCaptured`, `info`: `render function`' },
  { k: 'обработчик события', react: 'мимо: `reportError`', vue: '**ловит**: `info`: `native event handler`' },
  { k: 'обработчик `async`, бросок после `await`', react: 'мимо', vue: '**ловит** — Vue подписан на промис, который вернул обработчик' },
  { k: '`setTimeout` внутри компонента', react: 'мимо', vue: 'мимо' },
  { k: 'отклонённый `await` в `setup`', react: '(`use` с отклонённым промисом — граница ошибок)', vue: '`onErrorCaptured`, `info`: `setup function`' },
  { k: 'никто не поймал', react: 'корень снят целиком', vue: 'с `errorHandler`: на месте компонента пустой комментарий, остальное живёт' },
];

export const VUE_DEV_PROD =
  'Без `app.config.errorHandler` отладочная и рабочая сборки Vue ведут себя по-разному. В отладочной непойманная ошибка рендера **бросается** из `app.mount` — на стенде не смонтировалось ничего. В рабочей Vue пишет её в `console.error` и рисует остальное приложение: на месте упавшего компонента остаётся `<!---->`. И третий аргумент `info` в рабочей сборке — не текст, а ссылка вида `https://vuejs.org/error-reference/#runtime-1`.';

export const VUE_SUSPENSE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: '`async setup` без `<Suspense>` — пусто навсегда',
    d: 'Vue предупреждает `setup function returned a promise, but no <Suspense> boundary was found` и рисует на месте компонента пустоту. На стенде промис потом выполнился — компонент так и не появился.',
    tone: 'err',
  },
  {
    t: 'Повторное ожидание по умолчанию — как переход',
    d: 'Когда показанное содержимое сменилось на новое ждущее, Vue держит старое на экране, пока новое не готово, — без заглушки. Проп `timeout` задаёт, через сколько миллисекунд всё же показать заглушку: с `:timeout="0"` — сразу.',
  },
  {
    t: 'Suspense во Vue 3.5 — экспериментальный',
    d: 'При первом использовании Vue пишет `<Suspense> is an experimental feature and its API will likely change.` Вложенный `<Suspense>` по умолчанию живёт сам по себе: на стенде внешний показал своё содержимое, а внутренний — свою заглушку.',
    tone: 'warn',
  },
];

// ─── Раздел 8. Дерево границ: модель и демо ────────────────────────────────────────────────

export const S8_LEAD =
  'Всё сказанное сводится к одному алгоритму. Рендер обходит дерево; компонент может вернуть разметку, бросить промис или бросить ошибку. Брошенное летит вверх, и каждая граница решает: своё — ловлю и показываю заглушку, чужое — пропускаю выше. Ниже этот алгоритм целиком — и он предсказывает настоящие React и Vue на всех сочетаниях демо-дерева.';

export const BOUNDARY_CODE = `// Узел дерева — одно из трёх:
//   { type: 'component', name, children }
//   { type: 'suspense', fallback, children }   — ловит промисы
//   { type: 'boundary', fallback, children }   — ловит ошибки
// status[name]: 'ok' — рисуется, 'wait' — ждёт данных, 'fail' — падает.

class Pending {                        // «брошенный промис»: кто ждёт
  constructor(name) { this.name = name; }
}

function renderNode(node, ctx) {
  const { status, log } = ctx;
  if (node.type === 'component') {
    const s = status[node.name] ?? 'ok';
    if (s === 'wait') {
      ctx.asked.push({ name: node.name, inSuspense: ctx.inSuspense });
      if (ctx.mode === 'vue' && !ctx.inSuspense) {
        log.push(\`\${node.name}: async setup без Suspense выше — пусто\`);
        return [];
      }
      log.push(\`\${node.name}: бросает промис\`);
      throw new Pending(node.name);
    }
    if (s === 'fail') {
      if (ctx.mode === 'vue' && !ctx.inBoundary) {
        log.push(\`\${node.name}: ошибка → app.config.errorHandler, на месте компонента пусто\`);
        ctx.uncaught.push(node.name);
        return [];
      }
      log.push(\`\${node.name}: бросает ошибку\`);
      throw new Error(node.name);
    }
    return [node.name, ...renderChildren(node.children, ctx)];
  }

  const isSuspense = node.type === 'suspense';
  const inner = isSuspense
    ? { ...ctx, inSuspense: true }
    : { ...ctx, inBoundary: true };
  const mark = ctx.caught.length;
  try {
    return renderChildren(node.children, inner);
  } catch (thrown) {
    const isPromise = thrown instanceof Pending;
    if (isPromise !== isSuspense) {    // не своё — бросаем выше
      log.push(\`«\${node.fallback}» пропускает \${isPromise ? 'промис' : 'ошибку'} выше\`);
      throw thrown;
    }
    if (isSuspense) {
      log.push(\`Suspense ловит промис \${thrown.name} → «\${node.fallback}»\`);
      // React не монтирует то, что спрятано за заглушкой: componentDidCatch там не будет
      if (ctx.mode === 'react') ctx.caught.length = mark;
    } else {
      log.push(\`граница ловит ошибку \${thrown.message} → «\${node.fallback}»\`);
      ctx.caught.push(node.fallback);
    }
    return [node.fallback];
  }
}

// Ошибка сразу уходит вверх. Промис — нет: соседей рендерим дальше, как React 19
// «прогревает» их после заглушки, а Vue запускает setup у всех детей сразу.
function renderChildren(children = [], ctx) {
  const out = [];
  let pending = null;
  for (const child of children) {
    try {
      out.push(...renderNode(child, ctx));
    } catch (thrown) {
      if (!(thrown instanceof Pending)) throw thrown;
      pending ??= thrown;
    }
  }
  if (pending) throw pending;
  return out;
}

function renderRoot(tree, status, mode = 'react') {
  const ctx = { status, mode, log: [], asked: [], caught: [], uncaught: [],
    inSuspense: false, inBoundary: false };
  let shown;
  try {
    shown = renderNode(tree, ctx);
  } catch (thrown) {
    shown = [];
    ctx.caught.length = 0;             // коммита не будет — и componentDidCatch тоже
    if (thrown instanceof Pending) {
      ctx.log.push(\`корень: Suspense выше \${thrown.name} нет — не показано ничего\`);
    } else {
      ctx.log.push(\`корень: ошибку \${thrown.message} не поймал никто — root.onUncaughtError, дерево снято\`);
      ctx.uncaught.push(thrown.message);
    }
  }
  if (mode === 'react') {
    for (const b of ctx.caught) ctx.log.push(\`коммит: root.onCaughtError, затем componentDidCatch у «\${b}»\`);
  }
  const { log, asked, caught, uncaught } = ctx;
  return { shown, log, asked, caught, uncaught };
}

// Загрузка волнами: компонент начинает грузить данные, когда до него дошёл рендер.
// Каждую волну все начатые загрузки завершаются — и рендер идёт заново.
function loadWaves(tree, initial, mode = 'react') {
  const status = { ...initial };
  const started = new Set();
  const waves = [];
  for (;;) {
    const { shown, asked, uncaught } = renderRoot(tree, status, mode);
    const fresh = asked.map((a) => a.name).filter((name) => !started.has(name));
    waves.push({ started: fresh, shown });
    if (fresh.length === 0) return waves;
    if (mode === 'react' && uncaught.length > 0) {
      waves.push({ started: [], shown: [] });   // корень снят — рендера больше не будет
      return waves;
    }
    for (const a of asked) {
      started.add(a.name);
      // Vue: компонент с async setup без Suspense выше не появится и после загрузки
      if (mode === 'react' || a.inSuspense) status[a.name] = 'ok';
    }
  }
}`;

export const MODEL_NOTE =
  'Два места модели держат на себе всю разницу между «просто `try/catch`» и фреймворком. **Соседи**: ошибка останавливает обход сразу, а промис — нет, соседей рендерят дальше, и если кто-то из них упадёт, ошибка важнее ожидания. **Корень**: в React непойманное снимает всё дерево, во Vue — только упавший компонент. Чего у модели нет: повторов рендера, задержки заглушки, переходов — на итог для неизменного дерева они не влияют.';

export const DEMO_TREE_JSX = `<App>
  <Header />
  <ErrorBoundary fallback="Лента сломалась">
    <Suspense fallback="Лента: загрузка…">
      <Feed>
        <Suspense fallback="Комментарии: загрузка…">
          <Comments />
        </Suspense>
      </Feed>
    </Suspense>
  </ErrorBoundary>
  <Suspense fallback="Сайдбар: загрузка…">
    <ErrorBoundary fallback="Реклама сломалась">
      <Ads />
    </ErrorBoundary>
    <Profile />
  </Suspense>
</App>`;

const C = (name: string, ...children: TreeNode[]): TreeNode => ({ type: 'component', name, children });
const S = (fallback: string, ...children: TreeNode[]): TreeNode => ({ type: 'suspense', fallback, children });
const B = (fallback: string, ...children: TreeNode[]): TreeNode => ({ type: 'boundary', fallback, children });

/** То же дерево, что `DEMO_TREE_JSX`, в формате модели. Тест сверяет их между собой. */
export const DEMO_TREE: TreeNode = C(
  'App',
  C('Header'),
  B('Лента сломалась', S('Лента: загрузка…', C('Feed', S('Комментарии: загрузка…', C('Comments'))))),
  S('Сайдбар: загрузка…', B('Реклама сломалась', C('Ads')), C('Profile')),
);

/** Компоненты, состояние которых переключает читатель. `App` — всегда готов. */
export const DEMO_NAMES = ['Header', 'Feed', 'Comments', 'Ads', 'Profile'];

export const DEMO_PRESETS: { id: string; label: string; status: Record<string, Status> }[] = [
  { id: 'calm', label: 'всё готово', status: {} },
  { id: 'feed', label: 'лента ждёт', status: { Feed: 'wait' } },
  { id: 'chain', label: 'водопад', status: { Feed: 'wait', Comments: 'wait', Profile: 'wait' } },
  { id: 'mix', label: 'ждёт и падает', status: { Ads: 'fail', Profile: 'wait' } },
  { id: 'root', label: 'шапка падает', status: { Header: 'fail' } },
];

export const DEMO_CAPTION =
  'Переключайте состояние компонентов и смотрите, какая граница сработала. Экран и ход рендера считает `renderRoot` из модели выше, волны — `loadWaves`; на всех 243 сочетаниях они совпадают с тем, что показали настоящие React 19.3 и Vue 3.5. Попробуйте уронить `Header`: React снимет всё, Vue — только шапку. А в режиме «волнами» сравните `Comments` (ждёт за `Feed`) и `Profile` (сосед в той же границе).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Промис, созданный в рендере, — вечная заглушка',
    d: '`use(fetch(…))` в теле компонента: каждый повтор рендера — новый запрос, каждый ответ — новый повтор. Ошибки нет, предупреждение бывает не всегда. Промис берут из кеша по ключу или получают пропом.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Граница ошибок не ловит обработчики событий',
    d: 'Самая частая ошибка ожиданий в React. Бросок из `onClick` уходит в `reportError`, экран не меняется. Ловить в самом обработчике или нести в рендер через `setState(() => { throw error })`. Во Vue наоборот — `onErrorCaptured` поймает и обработчик.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Граница не ловит саму себя',
    d: 'Если упала заглушка границы ошибок (или её `render`), ошибку получит граница **выше**. Заглушку пишут максимально простой: текст и кнопка, без данных, которые могут не прийти.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'После ошибки граница так и остаётся в заглушке',
    d: 'Состояние `{ error }` само не сбросится. Чтобы попробовать снова, границу перемонтируют: `key` на границе, который меняется вместе с тем, что упало (`key={userId}`). На стенде смена `key` вернула содержимое.',
  },
  {
    n: '05',
    t: 'Вложенные границы — водопад запросов',
    d: 'Компонент внутри ждущего родителя не начнёт загрузку, пока родитель не дождётся. Запросы, которые друг от друга не зависят, нужно запускать выше — в загрузчике маршрута или в общем родителе.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Под `act` колбэки корня молчат',
    d: 'В тестах с `act` React не зовёт `onUncaughtError`: он складывает ошибку и бросает её из `act`. Проверка «наш `onUncaughtError` отправил отчёт» под `act` не пройдёт никогда — её делают без `act`, дожидаясь рендера вручную.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Скрытое Suspense не размонтировано',
    d: 'Когда обычное обновление снова бросило промис, показанное прячется через `display: none`, но компоненты живут: эффекты не перезапускаются, состояние сохранено. Измерения размеров в такой момент вернут нули.',
  },
  {
    n: '08',
    t: 'Vue: отладка и продакшен ведут себя по-разному',
    d: 'Без `app.config.errorHandler` отладочная сборка бросает ошибку из `mount`, а рабочая — пишет в консоль и рисует остальное. Тест, прошедший в отладке, ничего не говорит о продакшене: обработчик ставят явно.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'React — `<Suspense>`',
    href: 'https://react.dev/reference/react/Suspense',
    what: 'заглушка, вложенные границы, переходы и сброс по `key`',
  },
  {
    title: 'React — `use`',
    href: 'https://react.dev/reference/react/use',
    what: 'чтение промиса в рендере, требование стабильного промиса, отклонённый промис и граница ошибок',
  },
  {
    title: 'React — `Component`, раздел про границы ошибок',
    href: 'https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary',
    what: '`getDerivedStateFromError`, `componentDidCatch`, что граница не ловит',
  },
  {
    title: 'React — `createRoot`',
    href: 'https://react.dev/reference/react-dom/client/createRoot',
    what: 'параметры `onCaughtError`, `onUncaughtError`, `onRecoverableError`',
  },
  {
    title: 'React — `useTransition`',
    href: 'https://react.dev/reference/react/useTransition',
    what: 'переход не показывает заглушку для уже показанного содержимого',
  },
  {
    title: 'React — исходники: `ReactFiberThrow.js`',
    href: 'https://github.com/facebook/react/blob/main/packages/react-reconciler/src/ReactFiberThrow.js',
    what: 'поиск ближайшей границы для промиса и для ошибки, обновления границ',
  },
  {
    title: 'Vue — `<Suspense>`',
    href: 'https://vuejs.org/guide/built-ins/suspense.html',
    what: '`async setup`, `#fallback`, `timeout`, вложенные границы',
  },
  {
    title: 'Vue — `onErrorCaptured`',
    href: 'https://vuejs.org/api/composition-api-lifecycle.html#onerrorcaptured',
    what: 'какие ошибки ловит, правила всплытия и `return false`',
  },
  {
    title: 'Vue — `app.config.errorHandler`',
    href: 'https://vuejs.org/api/application.html#app-config-errorhandler',
    what: 'последний обработчик и строки `info`',
  },
  {
    title: 'Vue — исходники: `errorHandling.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/errorHandling.ts',
    what: '`handleError`: подъём по предкам, `errorHandler`, поведение без обработчика в отладке и продакшене',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри: конкурентность и lanes, раздел «Suspense»](/frameworks/react-concurrent-internals/#s5) — бросок, пинг и полоса повтора в мини-реализации. [SSR и гидратация, раздел «Стриминг»](/frameworks/ssr-hydration/#s4) — граница Suspense как единица стриминга HTML и гидратации. [Server Components изнутри, раздел «Async, Suspense и cache()»](/frameworks/server-components/#s6) — серверный компонент ждёт промис, клиент — на границе. [Слои кеша в Next.js, раздел «\'use cache\'»](/frameworks/next-cache/#s8) — динамический блок за `<Suspense>` в частичном пререндере. [Кеш данных на клиенте](/frameworks/data-cache/) — кеш по ключу, из которого берут стабильный промис. [Ошибки и стеки](/js/errors/) — объект ошибки, стек и необработанные ошибки вне фреймворка.';
