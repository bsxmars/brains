import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Scenario, Step } from '@/widgets/query-cache-lab/model/types';

/**
 * Данные темы «Кеш данных на клиенте: TanStack Query и SWR».
 *
 * Тема написана 2026-10-01 для направления «Фреймворки изнутри». Чего здесь нет намеренно,
 * потому что разобрано рядом: стор, подписчики и селекторы (`/frameworks/state-managers/`),
 * `stale-while-revalidate` в HTTP-кеше браузера и CDN (`/platform/network/#s2`,
 * `/platform/cdn-cache/#s3`), `useSyncExternalStore` (`/frameworks/react-hooks-internals/#s6`).
 * Здесь — то, что кеш данных добавляет поверх: запись по ключу, две оси состояния, свежесть
 * против сборки мусора, мутации и структурное разделение.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@tanstack/query-core` **5.104.0** (`QueryClient`, `QueryObserver`, `MutationObserver`,
 * `focusManager`, `onlineManager`, `dehydrate`/`hydrate`, `hashKey`, `replaceEqualDeep`),
 * `swr` **2.5.1** с react / react-dom **19.3.0**, happy-dom 20.14.5 вместо DOM — всё из
 * `node_modules` проекта. Node 24.11.0, vitest 5.0.0, октябрь 2026.
 *
 * Время — фейковые таймеры vitest (`vi.useFakeTimers`, `advanceTimersByTimeAsync`), сервер —
 * функция с задержкой `SERVER_LATENCY` мс на тех же таймерах; реальных задержек нет. Мерилось
 * детерминированное: в какие моменты уходили запросы и какие состояния получал наблюдатель.
 * Состояние наблюдателя TanStack Query сведено к пяти полям (`status`, `fetchStatus`, `data`,
 * `failureCount`, ошибка через `status`), повторы подряд склеены — так же, как у мини-версии.
 * Для SWR то же снято с компонента React на `useSWR`: `isLoading`, `isValidating`, `data`,
 * `error` на каждом рендере. `Math.random` в прогонах SWR зафиксирован на 0,5 — от него
 * зависят паузы между повторами.
 *
 * `query-core` в Node считает себя сервером (`typeof window === 'undefined'`): `retry` 0
 * и `gcTime` бесконечный. Прогоны «как в браузере» включают клиентский режим
 * `environmentManager.setIsServer(() => false)`; серверный режим снят отдельно (`SERVER_DEFAULTS`).
 *
 * Мини-реализация — строки `KEY_CODE`, `CACHE_CODE`, `OBSERVE_CODE`, `INVALIDATE_CODE`,
 * `OPTIMISTIC_CODE`, `SHARE_CODE`. Демо исполняет их через `widgets/query-cache-lab/model/run.ts`
 * на виртуальных часах. `tests/unit/data-cache.test.ts` прогоняет те же `SCENARIOS` на мини-версии
 * и на `query-core` при трёх значениях `staleTime` и требует совпадения запросов и состояний;
 * литералы `TRACES`, `SWR_TRACES`, `SHARE_REFS`, `NOTIFY_COUNTS`, `HASHES`, `HYDRATE_CALLS`,
 * `SERVER_DEFAULTS`, `OFFLINE_SEEN` пересобираются там же из библиотек.
 *
 * Не снято, взято из документации и исходников (`SOURCES`): как адаптер React
 * (`@tanstack/react-query`, в проекте не установлен) подписывает компонент на `QueryObserver`
 * и отслеживает прочитанные поля (`TRACKED_NOTE`). Механизм отслеживания проверен на ядре
 * (`notifyOnChangeProps`), сам хук — нет.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'серверное состояние',
    d: 'Данные, которыми владеет сервер: список заказов, профиль, комментарии. У браузера — только копия, снятая в какой-то момент. Её меняют и другие люди, поэтому она стареет сама.',
  },
  {
    k: 'ключ запроса (`queryKey`)',
    d: 'Массив, который однозначно называет данные: `[\'todos\']`, `[\'todo\', 5]`, `[\'todos\', { done: true }]`. Одинаковый ключ — одна запись в кеше, сколько бы компонентов её ни просили.',
  },
  {
    k: 'запись кеша',
    d: 'То, что лежит под ключом: данные, ошибка, время получения, кто смотрит и промис запроса, если он в пути.',
  },
  {
    k: 'наблюдатель',
    d: 'Подписка компонента на запись. Хук `useQuery` создаёт наблюдателя (`QueryObserver`) и перерисовывает компонент, когда наблюдатель сообщает о новом состоянии.',
  },
  {
    k: '`status` и `fetchStatus`',
    d: 'Два независимых вопроса. `status` — есть ли данные: `pending`, `success`, `error`. `fetchStatus` — идёт ли запрос прямо сейчас: `fetching`, `idle`, `paused`.',
  },
  {
    k: 'свежие и устаревшие данные',
    d: 'Свежие отдаются без запроса. Устаревшие тоже показываются, но при удобном случае кеш сходит за новыми. Границу задаёт `staleTime` — сколько миллисекунд данные считаются свежими.',
  },
  {
    k: 'сборка мусора (`gcTime`)',
    d: 'Сколько хранить запись, на которую больше никто не смотрит. Потом её удаляют, и следующий компонент начнёт загрузку с нуля.',
  },
  {
    k: 'инвалидация',
    d: 'Пометка «эти данные устарели, перезапросить». Её делают после изменения на сервере, когда кеш сам не может знать, что копия больше не верна.',
  },
  {
    k: 'оптимистичное обновление',
    d: 'Показать результат изменения до ответа сервера, а при ошибке вернуть как было. Интерфейс откликается сразу, а не через время запроса.',
  },
];

export const PLAIN_SERVER_STATE =
  'Как расписание электричек, сфотографированное на телефон. Фото — копия: смотреть удобно и быстро, но расписание меняют без вас. Чем старше снимок, тем меньше ему веры. Значение счётчика в форме — другое дело: оно ваше, кроме вас его никто не поменяет.';

export const PREREQ_NOTE =
  'Кеш данных — это стор с особыми правилами: он сам ходит в сеть и решает, когда копия устарела. Поэтому тема опирается на устройство стора, на промисы и на то, как HTTP-кеш обходится с устаревшими ответами.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Стор: состояние и подписчики',
    d: 'Объект вне компонентов, который держит данные и сообщает подписчикам об изменении. Кеш запросов устроен так же, только записей много и у каждой свои подписчики.',
    href: '/frameworks/state-managers/#s1',
    hrefLabel: '«Стейт-менеджеры изнутри», раздел «Стор»',
    tone: 'info',
  },
  {
    t: 'Один промис можно ждать многим',
    d: 'Подписаться на промис, который ещё ждёт, — значит дописать реакцию в его список. Сколько бы подписчиков ни было, результат будет один. На этом держится дедупликация запросов.',
    href: '/js/promise-internals/#s1',
    hrefLabel: '«Промис изнутри», раздел «Пять скрытых полей»',
    tone: 'info',
  },
  {
    t: 'Свежий и устаревший ответ в HTTP',
    d: 'Браузер отдаёт свежий ответ без сети, а устаревший проверяет у сервера. `stale-while-revalidate` разрешает отдать устаревшее сразу и обновить его фоном. Кеш данных переносит ту же идею в код приложения.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
  {
    t: 'Рендер и сравнение по ссылке',
    d: 'React перерисовывает компонент, когда новое значение не равно старому по `Object.is`. Объект с тем же содержимым, но новый, для него — изменение.',
    href: '/frameworks/react-rerender/#s5',
    hrefLabel: '«Ре-рендеринг в React», раздел «Мемоизация»',
    tone: 'info',
  },
];

// ─── Стенд: сервер и сценарии ───────────────────────────────────────────────────────────────

/** Сколько учебный сервер думает над запросом. Один и тот же у демо, мини-версии и библиотек. */
export const SERVER_LATENCY = 300;

/** Что лежит на сервере с самого начала. */
export const SERVER_TODOS = ['молоко'];

/**
 * Сценарии — один список шагов на всех: демо исполняет его на мини-кеше, тест — ещё и на
 * `query-core` и SWR. Время в шагах — виртуальное, мс.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'dedupe',
    label: 'два компонента',
    note: 'Шапка и список монтируются одновременно и просят один ключ `[\'todos\']`. Второй наблюдатель находит запрос уже в пути и ждёт тот же промис: запрос к серверу один.',
    steps: [{ do: 'mount', who: 'A' }, { do: 'mount', who: 'B' }, { do: 'wait', ms: 1000 }],
  },
  {
    id: 'remount',
    label: 'вернулись через 2 с',
    note: 'Компонент ушёл со страницы и вернулся через две секунды. Запись ещё жива, поэтому данные видны сразу. Пойдёт ли кеш за новыми, решает `staleTime`: при нуле — пойдёт, при пяти секундах — нет.',
    steps: [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
      { do: 'unmount', who: 'A' },
      { do: 'wait', ms: 2000 },
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
    ],
  },
  {
    id: 'gc',
    label: 'ушли на 5 минут',
    note: 'Компонент ушёл и не возвращался пять минут — ровно `gcTime` по умолчанию. Запись удалена, и возвращение начинается с `pending`, как в первый раз. `staleTime` здесь ничего не решает: данных просто нет.',
    steps: [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
      { do: 'unmount', who: 'A' },
      { do: 'wait', ms: 300_000 },
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
    ],
  },
  {
    id: 'focus',
    label: 'фокус окна',
    note: 'Пользователь трижды возвращается во вкладку: на 10-й секунде, через 0,1 с и ещё через секунду. Второй раз запрос уже в пути — новый не нужен. Третий раз данные снова устарели, и кеш идёт на сервер ещё раз.',
    steps: [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 10_000 },
      { do: 'focus' },
      { do: 'wait', ms: 100 },
      { do: 'focus' },
      { do: 'wait', ms: 1000 },
      { do: 'focus' },
      { do: 'wait', ms: 1000 },
    ],
  },
  {
    id: 'retry',
    label: 'сервер падает',
    note: 'Сервер трижды отвечает ошибкой, четвёртый раз — данными. Кеш повторяет запрос сам, с паузами 1, 2 и 4 с. Всё это время наблюдатель остаётся в `pending` и видит только счётчик неудач.',
    steps: [{ do: 'serverFails', n: 3 }, { do: 'mount', who: 'A' }, { do: 'wait', ms: 9000 }],
  },
  {
    id: 'rollback',
    label: 'ошибка мутации',
    note: 'Дело «хлеб» появляется в списке сразу, до ответа сервера. Сервер отвечает ошибкой — список возвращается к снимку, а затем кеш всё равно сверяется с сервером.',
    steps: [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
      { do: 'add', title: 'хлеб', fail: true },
      { do: 'wait', ms: 1000 },
    ],
  },
  {
    id: 'race',
    label: 'мутация во время запроса',
    note: 'Фоновый запрос после фокуса ещё в пути, а пользователь уже добавляет дело. Старый ответ ушёл с сервера до добавления — если его не отменить, он затрёт оптимистичный список.',
    steps: [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
      { do: 'focus' },
      { do: 'wait', ms: 100 },
      { do: 'add', title: 'хлеб' },
      { do: 'wait', ms: 1000 },
    ],
  },
];

/**
 * Быстрое возвращение: ушёл через 0,5 с, вернулся ещё через 0,5 с. Не пресет демо — им тест
 * показывает разницу между `staleTime` TanStack Query и окном дедупликации SWR.
 */
export const QUICK_RETURN: Step[] = [
  { do: 'mount', who: 'A' },
  { do: 'wait', ms: 500 },
  { do: 'unmount', who: 'A' },
  { do: 'wait', ms: 500 },
  { do: 'mount', who: 'A' },
  { do: 'wait', ms: 1000 },
];

/** Варианты `staleTime` в демо. Тест прогоняет каждый сценарий при каждом из них. */
export const STALE_OPTIONS: { value: string; label: string; ms: number }[] = [
  { value: '0', label: '0 (по умолчанию)', ms: 0 },
  { value: '5000', label: '5 с', ms: 5000 },
  { value: 'inf', label: 'Infinity', ms: Infinity },
];

export interface TraceLiteral {
  calls: number[];
  seen: { A: string[]; B?: string[] };
}

/**
 * Что сняли на `query-core`: моменты запросов (мс) и состояния наблюдателей. Мини-версия даёт
 * то же самое — это и проверяет тест. Ключ — `сценарий:staleTime`.
 */
export const TRACES: Record<string, TraceLiteral> = {
  'dedupe:0': {
    calls: [0],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]'],
      B: ['монтирование', 'pending · fetching', 'success · idle [молоко]'],
    },
  },
  'remount:0': {
    calls: [0, 3000],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'размонтирование', 'монтирование', 'success · fetching [молоко]', 'success · idle [молоко]'],
    },
  },
  'remount:5000': {
    calls: [0],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'размонтирование', 'монтирование', 'success · idle [молоко]'],
    },
  },
  'gc:0': {
    calls: [0, 301000],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'размонтирование', 'монтирование', 'pending · fetching', 'success · idle [молоко]'],
    },
  },
  'focus:0': {
    calls: [0, 10000, 11100],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · idle [молоко]'],
    },
  },
  'focus:inf': {
    calls: [0],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]'],
    },
  },
  'retry:0': {
    calls: [0, 1300, 3600, 7900],
    seen: {
      A: ['монтирование', 'pending · fetching', 'pending · fetching неудач: 1', 'pending · fetching неудач: 2', 'pending · fetching неудач: 3', 'success · idle [молоко]'],
    },
  },
  'rollback:0': {
    calls: [0, 1300],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'success · idle [молоко, хлеб]', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · idle [молоко]'],
    },
  },
  'race:0': {
    calls: [0, 1000, 1400],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · idle [молоко]', 'success · idle [молоко, хлеб]', 'success · fetching [молоко, хлеб]', 'success · idle [молоко, хлеб]'],
    },
  },
  'quick:0': {
    calls: [0, 1000],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'размонтирование', 'монтирование', 'success · fetching [молоко]', 'success · idle [молоко]'],
    },
  },
  'race-nocancel:0': {
    calls: [0, 1000, 1400],
    seen: {
      A: ['монтирование', 'pending · fetching', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · fetching [молоко, хлеб]', 'success · idle [молоко]', 'success · fetching [молоко]', 'success · idle [молоко, хлеб]'],
    },
  },
};

/** То же на SWR 2.5.1: состояние компонента на `useSWR` на каждом рендере. */
export const SWR_TRACES: Record<string, TraceLiteral> = {
  'dedupe': {
    calls: [0],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]'],
      B: ['монтирование', 'isLoading · isValidating', '[молоко]'],
    },
  },
  'remount': {
    calls: [0, 3001],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]', 'размонтирование', 'монтирование', '[молоко]', 'isValidating · [молоко]', '[молоко]'],
    },
  },
  'gc': {
    calls: [0, 301001],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]', 'размонтирование', 'монтирование', '[молоко]', 'isValidating · [молоко]', '[молоко]'],
    },
  },
  'focus': {
    calls: [0, 10000],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]', 'isValidating · [молоко]', '[молоко]'],
    },
  },
  'retry': {
    calls: [0],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', 'error'],
    },
  },
  'rollback': {
    calls: [0, 1300],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]', '[молоко, хлеб]', 'isValidating · [молоко]', '[молоко]'],
    },
  },
  'quick': {
    calls: [0],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', '[молоко]', 'размонтирование', 'монтирование', '[молоко]'],
    },
  },
  'retry-long': {
    calls: [0, 10300, 30600, 70900],
    seen: {
      A: ['монтирование', 'isLoading · isValidating', 'error', 'isLoading · isValidating · error', 'error', 'isLoading · isValidating · error', 'error', 'isLoading · isValidating · error', '[молоко]'],
    },
  },
};

/** Секунды для текста: `1300` → «1,3 с». */
export const sec = (ms: number) => `${(ms / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} с`;

const callsText = (calls: number[]) =>
  calls.length === 1 ? `один, в ${sec(calls[0])}` : `${calls.length}: ${calls.map(sec).join('; ')}`;

const seenText = (seen: string[]) => seen.map((s) => (s.startsWith('монт') || s.startsWith('размонт') ? `*${s}*` : `\`${s}\``)).join(' → ');

/** Строка таблицы по прогону: подпись, запросы, что видел наблюдатель `A`. */
const traceRow = (k: string, key: string, tone?: 'info' | 'ok' | 'warn' | 'err') => {
  const tr = TRACES[key];
  return { k, calls: callsText(tr.calls), seen: seenText(tr.seen.A), tone };
};

// ─── Раздел 1. Серверное состояние ─────────────────────────────────────────────────────────

export const STATE_ROWS: { k: string; client: string; server: string }[] = [
  { k: 'кто владелец', client: 'интерфейс: открыто ли меню, что набрано в поле', server: 'сервер: заказы, профиль, комментарии' },
  { k: 'может ли устареть', client: 'нет — другого источника правды нет', server: 'да, с момента получения: данные меняют другие люди и процессы' },
  { k: 'кто ещё читает', client: 'обычно один компонент или ветка', server: 'много компонентов на разных экранах — и все хотят одно и то же' },
  { k: 'что нужно кроме значения', client: 'ничего', server: 'загрузка, ошибка, повтор, обновление, сброс после изменения' },
  { k: 'где держать', client: '`useState`, `ref`, стор', server: 'кеш запросов: TanStack Query, SWR, RTK Query, Apollo' },
];

/** Наивная загрузка: каждый компонент сам. Тест исполняет и считает запросы. */
export const NAIVE_CODE = `// Каждый компонент грузит сам — как fetch в useEffect.
function mountNaive(get, show) {
  show({ loading: true });
  get().then(
    (data) => show({ loading: false, data }),
    (error) => show({ loading: false, error }),
  );
}

mountNaive(getTodos, showHeader);  // шапка: «1 дело»
mountNaive(getTodos, showList);    // список дел`;

export const NAIVE_NOTE =
  'Два компонента — два одинаковых запроса и две копии данных, которые расходятся, если ответы пришли разными. Флаги загрузки и ошибки каждый ведёт сам. Вкладка час пролежала в фоне — компоненты об этом не знают и показывают часовую копию. Пользователь добавил дело — обновить список должен тот, кто добавлял, и он должен знать, какие компоненты показывают этот список. Кеш данных забирает все четыре заботы себе.';

// ─── Раздел 2. Кеш по ключу ────────────────────────────────────────────────────────────────

export const PLAIN_CACHE =
  'Как секретарь, у которого спрашивают курс валют. Ответ банка он записывает в блокнот вместе со временем звонка. Спросили через минуту — читает из блокнота. Спросили через час — сначала называет записанное, а потом перезванивает в банк и поправляется. Пока он звонит, второму спросившему звонить не нужно: оба ждут один звонок. Листок, о котором неделю никто не спрашивал, он выбрасывает.';

export const KEY_CODE = `// Ключ запроса → строка. Порядок полей в объектах не важен.
function hashKey(key) {
  return JSON.stringify(key, (_, v) =>
    isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  );
}

function isPlain(v) {
  return v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
}

// Префикс ['todos'] накрывает ['todos'] и ['todos', { done: true }], но не ['todo'].
function startsWith(key, prefix) {
  return prefix.every((part, i) => hashKey([key[i]]) === hashKey([part]));
}`;

export const CACHE_CODE = `function createCache(clock) {
  return { clock, entries: new Map() }; // hashKey(key) → запись
}

function entryFor(cache, key, options) {
  const hash = hashKey(key);
  let entry = cache.entries.get(hash);
  if (!entry) {
    entry = {
      key, hash, options,
      data: undefined, error: null, failures: 0,
      status: 'pending',    // есть ли данные: pending → success | error
      fetchStatus: 'idle',  // идёт ли запрос: idle | fetching
      updatedAt: 0, invalidated: false,
      observers: new Set(), promise: null, run: null, dropGc: null,
    };
    cache.entries.set(hash, entry);
    scheduleGc(cache, entry);
  }
  if (options) entry.options = options;
  return entry;
}

function update(entry, patch) {
  Object.assign(entry, patch);
  for (const observer of entry.observers) observer.notify();
}

function fetchEntry(cache, entry, { restart = false } = {}) {
  // Запрос уже в пути — второй не нужен: все ждут один промис.
  if (entry.promise && !(restart && entry.data !== undefined)) return entry.promise;
  const run = (entry.run = {}); // метка похода: по ней узнаём отменённый
  const { fn, retry = 3 } = entry.options;
  update(entry, {
    fetchStatus: 'fetching', failures: 0,
    ...(entry.data === undefined && { status: 'pending', error: null }),
  });
  entry.promise = (async () => {
    for (;;) {
      try {
        const data = await fn(entry.key);
        if (entry.run !== run) return; // отменён или перезапущен
        entry.promise = null;
        update(entry, {
          data: replaceEqualDeep(entry.data, data), error: null,
          status: 'success', fetchStatus: 'idle', failures: 0,
          updatedAt: cache.clock.now(), invalidated: false,
        });
        break;
      } catch (error) {
        if (entry.run !== run) return;
        if (entry.failures >= retry) {
          entry.promise = null;
          update(entry, {
            error, status: 'error', fetchStatus: 'idle',
            failures: entry.failures + 1, invalidated: true,
          });
          break;
        }
        const delay = Math.min(1000 * 2 ** entry.failures, 30_000); // 1 с, 2 с, 4 с…
        update(entry, { failures: entry.failures + 1 });
        await new Promise((resume) => cache.clock.after(delay, resume));
        if (entry.run !== run) return;
      }
    }
    scheduleGc(cache, entry);
  })();
  return entry.promise;
}

function cancel(cache, key) {
  const entry = cache.entries.get(hashKey(key));
  if (!entry?.promise) return;
  entry.run = entry.promise = null;
  update(entry, { fetchStatus: 'idle' });
}`;

/** Ключи и их хеши — `hashKey` из `query-core`; тест сверяет с ним мини-версию. */
export const HASHES: { key: string; hash: string }[] = [
  { key: "['todos']", hash: '["todos"]' },
  { key: "['todo', 5]", hash: '["todo",5]' },
  { key: "['todos', { page: 1, done: true }]", hash: '["todos",{"done":true,"page":1}]' },
  { key: "['todos', { done: true, page: 1 }]", hash: '["todos",{"done":true,"page":1}]' },
];

export const KEY_NOTE =
  'Кеш хранит записи в обычном `Map`, поэтому ключ-массив сначала превращается в строку. Поля объектов в ней отсортированы: `{ page: 1, done: true }` и `{ done: true, page: 1 }` — один ключ. Всё, от чего зависит ответ сервера, обязано попасть в ключ: номер страницы, фильтр, id. Забытый параметр — и разные запросы делят одну запись.';

export const STATUS_ROWS: { status: string; fetch: string; when: string; show: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  { status: '`pending`', fetch: '`fetching`', when: 'первая загрузка: данных нет, запрос в пути', show: 'скелетон или спиннер на месте контента', tone: 'info' },
  { status: '`success`', fetch: '`idle`', when: 'данные есть, запросов нет', show: 'данные', tone: 'ok' },
  { status: '`success`', fetch: '`fetching`', when: 'данные есть и показываются, а за новыми уже пошли фоном', show: 'данные; можно тонкий индикатор обновления', tone: 'ok' },
  { status: '`error`', fetch: '`idle`', when: 'все попытки кончились ошибкой', show: 'ошибку и кнопку «повторить»; если данные были — их тоже', tone: 'err' },
  { status: '`pending`', fetch: '`paused`', when: 'данных нет, а сети нет: запрос ждёт подключения', show: '«нет сети», а не вечный спиннер', tone: 'warn' },
];

export const STATUS_NOTE =
  'Один флаг `loading` эти случаи не различает. «Данных нет, идёт запрос» и «данные есть, идёт фоновое обновление» требуют разного экрана: в первом случае показать нечего, во втором спиннер поверх готового списка только мешает. Поэтому в TanStack Query два поля: `isLoading` — это `pending` **и** `fetching`, `isFetching` — любой запрос, в том числе фоновый.';

export const DEDUPE_ROWS = (['A', 'B'] as const).map((who) => ({
  who: who === 'A' ? '`A` — шапка' : '`B` — список',
  seen: seenText(TRACES['dedupe:0'].seen[who]!),
}));

export const DEDUPE_CALLS = callsText(TRACES['dedupe:0'].calls);

export const DEDUPE_NOTE =
  'Дедупликация — одна строка в начале `fetchEntry`: если у записи уже есть промис, вернуть его. Второй наблюдатель не делает ничего особенного — он подписывается на запись, видит, что данных нет, и просит запрос, а запрос уже в пути.';

// ─── Раздел 3. Свежесть и сборка мусора ────────────────────────────────────────────────────

export const PLAIN_STALE =
  '`staleTime` — сколько верить записи в блокноте без перезвона. `gcTime` — сколько хранить листок, о котором перестали спрашивать. Это разные сроки: устаревший листок не выбрасывают, по нему отвечают сразу и параллельно перезванивают. Выбрасывают только ненужный.';

export const OBSERVE_CODE = `// Данные моложе staleTime отдаются без запроса.
function isStale(cache, entry, staleTime = 0) {
  return entry.data === undefined || entry.invalidated ||
    cache.clock.now() - entry.updatedAt >= staleTime;
}

// Записи, на которую никто не смотрит, даётся gcTime; потом её удаляют.
function scheduleGc(cache, entry) {
  entry.dropGc?.();
  entry.dropGc = cache.clock.after(entry.options?.gcTime ?? 5 * 60_000, () => {
    if (!entry.observers.size && !entry.promise) cache.entries.delete(entry.hash);
  });
}

function observe(cache, key, options, listener) {
  const entry = entryFor(cache, key, options);
  const fields = options.fields ?? ['status', 'fetchStatus', 'data', 'error', 'failures'];
  let last = null;
  const observer = {
    options,
    notify() {
      const now = Object.fromEntries(fields.map((f) => [f, entry[f]]));
      if (last && fields.every((f) => Object.is(now[f], last[f]))) return;
      last = now;
      listener(now);
    },
  };
  entry.dropGc?.();
  entry.observers.add(observer);
  if (isStale(cache, entry, options.staleTime)) fetchEntry(cache, entry);
  observer.notify();
  return () => {
    entry.observers.delete(observer);
    if (!entry.observers.size) scheduleGc(cache, entry);
  };
}

// Окно снова в фокусе или вернулась сеть: освежить то, на что смотрят.
function onFocus(cache) {
  for (const entry of cache.entries.values()) {
    const observers = [...entry.observers];
    if (observers.some((o) => isStale(cache, entry, o.options.staleTime))) fetchEntry(cache, entry);
  }
}`;

export const TIMES_ROWS: { k: string; stale: string; gc: string }[] = [
  { k: 'о чём', stale: 'когда идти за новыми данными', gc: 'когда удалить запись, на которую никто не смотрит' },
  { k: 'отсчёт от', stale: 'момента, когда пришли данные (`updatedAt`)', gc: 'ухода последнего наблюдателя' },
  { k: 'по умолчанию', stale: '`0` — данные устаревают сразу', gc: '5 минут в браузере, бесконечность на сервере' },
  { k: 'если срок вышел', stale: 'данные **показываются**, но при монтировании, фокусе окна или возврате сети кеш идёт за новыми', gc: 'запись удалена; следующий компонент увидит `pending`' },
  { k: '`Infinity`', stale: 'сам кеш за новыми не пойдёт — только по инвалидации или явному `refetch`', gc: 'запись живёт, пока жива вкладка' },
];

export const FRESH_ROWS = [
  traceRow('ушёл на 0,5 с, `staleTime: 0`', 'quick:0', 'warn'),
  traceRow('ушёл на 2 с, `staleTime: 0`', 'remount:0', 'warn'),
  traceRow('ушёл на 2 с, `staleTime: 5000`', 'remount:5000', 'ok'),
  traceRow('ушёл на 5 мин (`gcTime` по умолчанию)', 'gc:0', 'err'),
];

export const STALE_NOTE =
  'Отсюда главная неожиданность: с настройками по умолчанию **каждое** монтирование компонента — это запрос, даже если данные пришли секунду назад. Это не ошибка, а выбор авторов: показывать устаревшее можно, а знать, когда оно устареет, может только приложение. Обычный рецепт — задать `staleTime` в несколько секунд или минут для всего приложения и меньше для того, что меняется часто.';

export const HTTP_SWR_NOTE =
  'Это та же идея, что `stale-while-revalidate` в HTTP: отдать устаревшее сразу, обновить фоном. Разница в границе. В заголовке окно ограничено N секундами — после них кеш ждёт сервер. На клиенте ограничения нет: пока запись жива, устаревшие данные показываются сколько угодно долго, а фоновое обновление случается при монтировании, фокусе или возврате сети. Как это устроено в общем кеше — в теме [«CDN и серверный кеш», раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3).';

/** Кеш с сервера: исполняется тестом с `query-core` (`QueryClient`, `QueryObserver`, `dehydrate`, `hydrate`). */
export const HYDRATE_CODE = `// На сервере: загрузить и упаковать кеш в JSON.
const server = new QueryClient();
await server.prefetchQuery({ queryKey: ['todos'], queryFn: getTodos });
const json = JSON.stringify(dehydrate(server));

// В браузере: распаковать до первого рендера и подписаться.
const client = new QueryClient();
hydrate(client, JSON.parse(json));
const todos = new QueryObserver(client, { queryKey: ['todos'], queryFn: getTodos, staleTime });
todos.subscribe(render);`;

/** Сколько раз браузер вызвал `getTodos` после гидратации — по `staleTime`. */
export const HYDRATE_CALLS: { staleTime: number; calls: number }[] = [
  { staleTime: 0, calls: 1 },
  { staleTime: 60_000, calls: 0 },
];

export const HYDRATE_NOTE =
  'В JSON уезжает запись целиком, вместе с `dataUpdatedAt` — моментом, когда сервер получил данные. В браузере это уже прошлое, и при `staleTime: 0` запись устарела ещё в пути: наблюдатель тут же повторяет запрос, который сервер только что сделал. Поэтому при серверном рендере `staleTime` ставят больше нуля — хотя бы на время, пока страница доезжает и оживает. Как сервер присылает разметку и как она оживает — в теме [«SSR и гидратация»](/frameworks/ssr-hydration/).';

// ─── Раздел 4. Фокус, сеть и повторы ───────────────────────────────────────────────────────

export const FOCUS_NOTE =
  '`onFocus` проходит по записям, на которые кто-то смотрит, и освежает устаревшие. Запрос в пути не повторяется — та же дедупликация. Событие возврата сети обрабатывается так же. В браузере TanStack Query слушает `visibilitychange` и события `online`/`offline`, а `focusManager` и `onlineManager` позволяют подставить свои источники — например, `AppState` в React Native.';

export const FOCUS_ROWS = [
  traceRow('`staleTime: 0`', 'focus:0', 'warn'),
  traceRow('`staleTime: Infinity`', 'focus:inf', 'ok'),
];

export const RETRY_ROWS = [traceRow('3 ошибки, потом данные', 'retry:0', 'info')];

/** Сеть пропала до первого запроса: что видел наблюдатель `query-core`. */
export const OFFLINE_SEEN: string[] = ['pending · paused', 'вызовов за 5 с: 0', 'pending · fetching', 'success · idle', 'вызовов: 1'];

export const OFFLINE_NOTE =
  'Без сети запрос не уходит вовсе: `fetchStatus` становится `paused`, функция запроса не вызывается ни разу. Сеть вернулась — запрос стартует сам. В мини-версии этой ветки нет; в TanStack Query она называется `networkMode: \'online\'` и стоит по умолчанию.';

export const RETRY_NOTE =
  'Пауза перед повтором растёт вдвое: `Math.min(1000 × 2^n, 30 000)` — 1, 2, 4 с и дальше до потолка в 30 с. Повторов по умолчанию три, то есть всего четыре попытки. Пока они идут, `status` остаётся `pending`: интерфейс показывает загрузку, а не ошибку, и видна она только в `failureCount`.';

/** Значения по умолчанию в зависимости от того, где работает `query-core`. */
export const SERVER_DEFAULTS: { where: string; calls: number; gcTime: string }[] = [
  { where: 'браузер', calls: 4, gcTime: '300000' },
  { where: 'сервер', calls: 1, gcTime: 'Infinity' },
];

export const SERVER_NOTE =
  'Ядро решает, браузер это или сервер, по `typeof window`. На сервере повторов нет — пользователь ждёт ответа страницы, и три попытки с паузами только задержат его, — а `gcTime` бесконечный: кеш живёт ровно один запрос к серверу и выбрасывается целиком. Отсюда правило: на сервере `QueryClient` создают **на каждый запрос**. Общий на все — и данные одного пользователя уедут другому.';

// ─── Раздел 5. Мутации ─────────────────────────────────────────────────────────────────────

export const INVALIDATE_CODE = `function invalidate(cache, prefix) {
  for (const entry of cache.entries.values()) {
    if (!startsWith(entry.key, prefix)) continue;
    update(entry, { invalidated: true });
    // Ответ, который уже в пути, мог уйти до изменения — перезапросить.
    if (entry.observers.size) fetchEntry(cache, entry, { restart: true });
  }
}

function getData(cache, key) {
  return cache.entries.get(hashKey(key))?.data;
}

function setData(cache, key, updater) {
  const entry = entryFor(cache, key);
  const data = typeof updater === 'function' ? updater(entry.data) : updater;
  update(entry, {
    data: replaceEqualDeep(entry.data, data), error: null,
    status: 'success', updatedAt: cache.clock.now(), invalidated: false,
  });
}`;

export const OPTIMISTIC_CODE = `// Добавить дело: показать сразу, откатить при ошибке, сверить с сервером.
async function addTodo(cache, title, send) {
  cancel(cache, ['todos']);                 // чтобы ответ в пути не затёр наше
  const prev = getData(cache, ['todos']);   // снимок для отката
  setData(cache, ['todos'], (list) => [...list, title]);
  try {
    await send(title);
  } catch {
    setData(cache, ['todos'], prev);        // откат
  } finally {
    invalidate(cache, ['todos']);           // сверка с сервером
  }
}`;

export const PLAIN_OPTIMISTIC =
  'Как официант, который ставит на стол хлебницу, ещё не дойдя до кухни: почти всегда хлеб есть. Если на кухне сказали «кончился» — хлебницу уносят и извиняются. Гость ждёт не время похода на кухню, а ноль; редкая ошибка стоит одного неловкого момента.';

export const INVALIDATE_NOTE =
  'Кеш не знает, какие записи задело изменение на сервере: это знает только приложение. Поэтому после мутации оно называет префикс ключа, и все записи под ним помечаются устаревшими. Те, на которые смотрят, перезапрашиваются сразу; остальные — когда на них снова посмотрят. Запрос, уже бывший в пути, перезапускается: он мог уйти до изменения и привезти старое.';

/** Тот же рецепт на `query-core`: `MutationObserver` с тремя колбэками. Исполняется тестом. */
export const TQ_MUTATION_CODE = `const addTodo = new MutationObserver(client, {
  mutationFn: (title) => send(title),
  onMutate: async (title) => {
    await client.cancelQueries({ queryKey: ['todos'] });
    const prev = client.getQueryData(['todos']);
    client.setQueryData(['todos'], (list) => [...list, title]);
    return { prev };                            // контекст для отката
  },
  onError: (error, title, ctx) => client.setQueryData(['todos'], ctx.prev),
  onSettled: () => client.invalidateQueries({ queryKey: ['todos'] }),
});

addTodo.mutate('хлеб').catch(showError); // mutate пробрасывает ошибку`;

export const TQ_MUTATION_NOTE =
  'В React это тот же объект под хуком `useMutation`. Три колбэка — те же три шага, что в `addTodo`: снимок и оптимистичная запись, откат, сверка. Повторов у мутаций по умолчанию нет вовсе (`retry: 0`): повторить «списать деньги» без ведома пользователя опаснее, чем показать ошибку.';

export const MUTATION_ROWS = [
  traceRow('сервер отказал: откат', 'rollback:0', 'info'),
  traceRow('фоновый запрос в пути, с `cancel`', 'race:0', 'ok'),
  traceRow('то же без `cancel`', 'race-nocancel:0', 'err'),
];

export const RACE_NOTE =
  'Без `cancelQueries` фоновый ответ, ушедший с сервера до мутации, приходит через 0,2 с после оптимистичной записи и затирает её: «хлеб» пропадает и появляется снова только после сверки. Пользователь видит мигание. Отмена не обрывает запрос в сети — его ответ просто не попадёт в кеш.';

// ─── Раздел 6. Структурное разделение ──────────────────────────────────────────────────────

export const SHARE_CODE = `// Новый ответ, но неизменившиеся части — старыми ссылками.
function replaceEqualDeep(prev, next) {
  if (prev === next) return prev;
  const arrays = Array.isArray(prev) && Array.isArray(next);
  if (!arrays && !(isPlain(prev) && isPlain(next))) return next;
  const keys = arrays ? next.map((_, i) => i) : Object.keys(next);
  const out = arrays ? [] : {};
  let same = keys.length === Object.keys(prev).length;
  for (const k of keys) {
    out[k] = replaceEqualDeep(prev[k], next[k]);
    if (out[k] !== prev[k] || !(k in prev)) same = false;
  }
  return same ? prev : out;
}`;

/** Ответ сервера до и после: изменилось название второго дела. */
export const SHARE_PREV = { user: { name: 'Аня' }, todos: [{ id: 1, t: 'молоко' }, { id: 2, t: 'хлеб' }] };
export const SHARE_NEXT = { user: { name: 'Аня' }, todos: [{ id: 1, t: 'молоко' }, { id: 2, t: 'батон' }] };

/** Пример для печати: те же два объекта, что сверяет тест. */
export const SHARE_SAMPLE = `// было в кеше
${JSON.stringify(SHARE_PREV)}
// пришло с сервера
${JSON.stringify(SHARE_NEXT)}`;

/** Какие части результата `replaceEqualDeep(SHARE_PREV, SHARE_NEXT)` — старые ссылки. Сверено с `query-core` и SWR. */
export const SHARE_REFS: { part: string; tq: boolean; swr: boolean }[] = [
  { part: 'весь ответ', tq: false, swr: false },
  { part: '`user`', tq: true, swr: false },
  { part: '`todos`', tq: false, swr: false },
  { part: '`todos[0]` — молоко', tq: true, swr: false },
  { part: '`todos[1]` — хлеб → батон', tq: false, swr: false },
];

/** Сколько раз наблюдатель получил новое состояние, когда повторный запрос вернул то же самое. */
export const NOTIFY_COUNTS: { k: string; n: number }[] = [
  { k: 'query-core, с разделением: подписка на `data`', n: 0 },
  { k: 'query-core: подписка на все поля', n: 2 },
  { k: 'query-core, без разделения: подписка на `data`', n: 1 },
  { k: 'мини-кеш темы: `fields: [\'data\']`', n: 0 },
];

export const SHARE_NOTE =
  'Каждый ответ сервера разбирается из JSON заново, и все объекты в нём новые, даже если ничего не изменилось. Для React новый объект — изменение. `replaceEqualDeep` обходит новый ответ вместе со старым и там, где содержимое совпало, возвращает старую ссылку. Изменилось название второго дела — новыми станут только второе дело, массив и корень. `user` и первое дело остаются прежними объектами, и компонент, получивший их пропсом через `memo`, не перерисуется.';

export const TRACKED_NOTE =
  'Если повторный ответ совпал целиком, совпадает и ссылка на `data`. Наблюдатель, подписанный только на `data`, не получит ничего. Так работает `notifyOnChangeProps`. Хук `useQuery` по документации делает это сам: запоминает, какие поля результата компонент прочитал, и перерисовывает только при изменении этих полей. Поэтому `isFetching`, которого компонент не читает, не будит его дважды на каждый фоновый запрос.';

// ─── Раздел 7. Песочница ───────────────────────────────────────────────────────────────────

export const DEMO_CAPTION =
  'Время здесь виртуальное, поэтому видно состояние «запрос в пути», которое в жизни длится доли секунды. Сравните «вернулись через 2 с» при `staleTime` 0 и 5 с: в первом случае компонент получает данные сразу и всё равно уходит на сервер, во втором — нет. «Фокус окна» при `Infinity` не даёт ни одного лишнего запроса. А если на странице оба компонента, одно добавленное дело будит обоих: запись у них общая.';

// ─── Раздел 8. SWR ─────────────────────────────────────────────────────────────────────────

/** Оптимистичная мутация в SWR. Исполняется тестом с настоящим `mutate` из `useSWRConfig`. */
export const SWR_MUTATE_CODE = `mutate('todos', send('хлеб'), {
  optimisticData: (list) => [...list, 'хлеб'],
  rollbackOnError: true,   // ошибка — вернуть снимок
  populateCache: false,    // ответ POST — не список, в кеш его не класть
  revalidate: true,        // после — сверить с сервером
}).catch(showError);       // mutate пробрасывает ошибку`;

export const SWR_FACTS: { t: string; d: string; tone?: 'info' | 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Нет `staleTime` — есть окно дедупликации',
    d: 'Монтирование с данными в кеше в SWR всегда идёт за новыми (`revalidateIfStale: true`), если с конца прошлого запроса прошло больше `dedupingInterval` — 2 с. Окно отсчитывается от **ответа**, а не от вопроса.',
  },
  {
    t: 'Фокус — не чаще раза в 5 с',
    d: '`focusThrottleInterval` глушит повторные события фокуса в течение 5 с после последнего обновления по фокусу. TanStack Query вместо этого смотрит на свежесть данных.',
  },
  {
    t: 'Ошибку видно сразу',
    d: 'После первой неудачи у компонента уже есть `error`, а повтор ждёт `errorRetryInterval` — 5 с, умноженные на целую часть от `(Math.random() + 0,5) × 2^n`. Первый повтор — через 5 или 10 с, второй — через 10–25 с. При `Math.random()`, равном 0,5, паузы — 10, 20 и 40 с.',
    tone: 'warn',
  },
  {
    t: 'Записи не удаляются',
    d: 'Кеш по умолчанию — обычный `Map` на всё время жизни вкладки. Сборки мусора нет: вернувшийся через час компонент получит часовую копию сразу и обновит её фоном.',
  },
  {
    t: 'Сравнение целиком, а не по частям',
    d: 'Новый ответ сравнивается со старым глубоко (`dequal`). Совпал целиком — остаётся старый объект и рендера нет. Отличается хоть одно поле — новым становится весь ответ, со всеми вложенными объектами.',
  },
];

export const SWR_ROWS: { k: string; tq: string; swr: string; tone?: 'info' | 'ok' | 'warn' | 'err' }[] = [
  { k: 'два компонента сразу', tq: `запросов ${callsText(TRACES['dedupe:0'].calls)}`, swr: `запросов ${callsText(SWR_TRACES.dedupe.calls)}` },
  { k: 'вернулся через 0,5 с', tq: `запросов ${callsText(TRACES['quick:0'].calls)} — данные устарели сразу`, swr: `запросов ${callsText(SWR_TRACES.quick.calls)} — окно дедупликации ещё открыто`, tone: 'warn' },
  { k: 'вернулся через 2 с', tq: `запросов ${callsText(TRACES['remount:0'].calls)}`, swr: `запросов ${callsText(SWR_TRACES.remount.calls)} — окно закрылось через 2 с после **ответа**` },
  { k: 'вернулся через 5 мин', tq: `запись удалена, снова \`pending\`; запросов ${callsText(TRACES['gc:0'].calls)}`, swr: `данные на месте сразу, фоном — обновление; запросов ${callsText(SWR_TRACES.gc.calls)}`, tone: 'info' },
  { k: 'фокус в 10; 10,1 и 11,1 с', tq: `запросов ${callsText(TRACES['focus:0'].calls)}`, swr: `запросов ${callsText(SWR_TRACES.focus.calls)} — остальные фокусы погашены`, tone: 'info' },
  { k: 'сервер трижды упал', tq: `запросов ${callsText(TRACES['retry:0'].calls)}; ошибку не видно, только счётчик`, swr: `за те же 9 с один запрос, \`error\` виден с ${sec(SERVER_LATENCY)}; повторы в ${SWR_TRACES['retry-long'].calls.slice(1).map(sec).join('; ')}`, tone: 'warn' },
  { k: 'мутация отклонена', tq: seenText(TRACES['rollback:0'].seen.A.slice(3)), swr: seenText(SWR_TRACES.rollback.seen.A.slice(3)) },
];

export const SWR_NOTE =
  'SWR — это кеш по ключу с дедупликацией и фоновым обновлением, как и TanStack Query, только меньше и проще в настройках. В нём нет отдельного наблюдателя без React: состояние живёт в хуке, а глобальный кеш хранит данные и промисы запросов. Числа ниже сняты с компонента на `useSWR` в тех же сценариях.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Сервер лежит: когда наблюдатель `query-core` впервые увидит `error`. Сверяет тест. */
export const ERROR_VISIBLE_AT = 8200;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`staleTime: 0` — запрос на каждое монтирование',
    d: 'С настройками по умолчанию компонент, вернувшийся через полсекунды, снова идёт на сервер. Вкладки, модальные окна, списки с раскрытием — каждое открытие даёт запрос. Это не утечка и не ошибка, но если данные меняются раз в минуту, задайте `staleTime` в минуту.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Параметр запроса не попал в ключ',
    d: '`useQuery({ queryKey: [\'todos\'], queryFn: () => getTodos(page) })` — все страницы делят одну запись. Смена `page` не меняет ключ, нового запроса нет, на экране старая страница. Правило: всё, что читает `queryFn`, лежит в `queryKey`.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`Map`, `Set` и экземпляры классов в ключе',
    d: 'Ключ превращается в строку через `JSON.stringify`. `Map` и `Set` становятся `{}`: `[new Map([[1, \'a\']])]` и `[new Map()]` — один ключ. В ключ кладут строки, числа и простые объекты.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Оптимистичная запись без отмены мигает',
    d: 'Фоновый запрос, ушедший до мутации, возвращает старый список и затирает оптимистичный. Дело пропадает и появляется снова после сверки. Первая строка `onMutate` — `await cancelQueries(...)`.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Повторы прячут упавший сервер',
    d: `Четыре попытки с паузами 1, 2 и 4 с: если сервер лежит, \`status: 'error'\` наступит только через ${sec(ERROR_VISIBLE_AT)}. Всё это время пользователь видит загрузку. Для запросов, где ошибка понятна сразу (404, 403), повтор отключают функцией \`retry: (n, error) => …\`.`,
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Один `QueryClient` на весь сервер',
    d: 'На сервере `gcTime` бесконечный: записи не удаляются никогда. Общий клиент копит данные всех пользователей и отдаёт их чужим страницам. Клиент создают на каждый запрос к серверу, а в браузере — один раз, вне компонента.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Инвалидация не перезапрашивает то, на что не смотрят',
    d: 'Запись без наблюдателей только помечается устаревшей. Запрос уйдёт, когда её снова кто-то смонтирует, — даже при `staleTime: Infinity`. Если данные нужны готовыми заранее, их загружают явно: `prefetchQuery` или `refetchType: \'all\'`.',
  },
  {
    n: '08',
    t: 'Структурное разделение не видит `Date` и классы',
    d: '`replaceEqualDeep` заходит только в массивы и простые объекты. `Date`, экземпляр класса, `Map` из `select` всегда считаются новыми — и компонент перерисуется на каждом обновлении, даже если значение то же. Из `queryFn` лучше отдавать JSON как есть, а превращать в объекты — в компоненте или в `select`.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'TanStack Query — Important Defaults',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults',
    what: '`staleTime: 0`, `gcTime` 5 минут, три повтора, обновление при фокусе и возврате сети; версия 5.104.0 на стенде',
  },
  {
    title: 'TanStack Query — Caching Examples',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/caching',
    what: 'жизнь записи: монтирование, фоновое обновление, сборка мусора',
  },
  {
    title: 'TanStack Query — Query Keys',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/query-keys',
    what: 'ключ-массив, детерминированный хеш объектов',
  },
  {
    title: 'TanStack Query — Query Invalidation',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation',
    what: '`invalidateQueries` и совпадение по префиксу',
  },
  {
    title: 'TanStack Query — Optimistic Updates',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates',
    what: '`onMutate`, `cancelQueries`, откат в `onError`',
  },
  {
    title: 'TanStack Query — Query Retries',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/query-retries',
    what: 'число повторов и формула паузы',
  },
  {
    title: 'TanStack Query — Render Optimizations',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations',
    what: 'структурное разделение и отслеживание прочитанных полей',
  },
  {
    title: 'TanStack Query — Server Rendering & Hydration',
    href: 'https://tanstack.com/query/latest/docs/framework/react/guides/ssr',
    what: '`dehydrate`/`hydrate`, `staleTime` больше нуля при SSR, клиент на каждый запрос',
  },
  {
    title: 'TanStack Query — исходники query-core',
    href: 'https://github.com/TanStack/query/tree/main/packages/query-core/src',
    what: '`query.ts`, `queryObserver.ts`, `retryer.ts`, `utils.ts` (`replaceEqualDeep`, `hashKey`)',
  },
  {
    title: 'SWR — API Options',
    href: 'https://swr.vercel.app/docs/api',
    what: '`dedupingInterval`, `focusThrottleInterval`, `errorRetryInterval` и прочие значения по умолчанию; версия 2.5.1 на стенде',
  },
  {
    title: 'SWR — Mutation & Revalidation',
    href: 'https://swr.vercel.app/docs/mutation',
    what: '`optimisticData`, `rollbackOnError`, `populateCache`',
  },
  {
    title: 'RFC 5861 — HTTP Cache-Control Extensions for Stale Content',
    href: 'https://www.rfc-editor.org/rfc/rfc5861',
    what: 'откуда название SWR: `stale-while-revalidate` в HTTP',
  },
];

export const RELATED =
  'Смежное на сайте: [Стейт-менеджеры изнутри, раздел «Стор»](/frameworks/state-managers/#s1) — подписчики и селекторы, на которых стоит любой кеш. [CDN и серверный кеш, раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3) — `stale-while-revalidate` и коллапс запросов в общем кеше. [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — тот же приём в HTTP-кеше браузера. [SSR и гидратация](/frameworks/ssr-hydration/) — как страница с данными с сервера оживает в браузере. [Server Components изнутри, раздел «Async, Suspense и cache()»](/frameworks/server-components/#s6) — данные, которые загружает сервер, а не браузер. [Роутер изнутри](/frameworks/router/) — сопоставление адреса с маршрутами, guards и загрузка данных до перехода. [Suspense и границы ошибок](/frameworks/suspense-errors/) — что ловит граница в React и Vue, водопад и стабильный промис. [Ограничение частоты в API](/platform/rate-limits/) — 429 и `Retry-After`, джиттер, бюджет повторов и `RetryAgent` из undici. [Кеши с вытеснением](/algorithms/eviction/) — LRU на `Map` и в `lru-cache`, провалы LRU на скане и цикле, LFU, W-TinyLFU и SIEVE.';
