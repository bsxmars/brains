import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { LabAction, LabComponentId, LabMode } from '@/widgets/store-lab/model/types';

/**
 * Данные темы «Стейт-менеджеры изнутри: кого будит изменение».
 *
 * Тема написана 2026-10-01 для направления «Фреймворки изнутри». Чего здесь нет намеренно,
 * потому что разобрано рядом: устройство `useSyncExternalStore` и разрыв экрана
 * (`/frameworks/react-hooks-internals/#s6`), `memo` и `Object.is` в React
 * (`/frameworks/react-rerender/#s5`), граф зависимостей и очередь Vue
 * (`/frameworks/vue-reactivity/#s2`, `#s3`). Здесь — то, что стор добавляет поверх.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * redux **5.0.1**, @reduxjs/toolkit **2.13.0** (immer 11.1.18), reselect 5.3.0,
 * zustand **5.0.15**, pinia **4.0.3**, react / react-dom **19.3.0**, vue **3.5.42**,
 * happy-dom 20.14.5 вместо DOM — всё из `node_modules` проекта. Node 24.11.0, октябрь 2026.
 *
 * Сквозной пример — состояние `{ count: 0, user: { name: 'Аня' }, todos: ['молоко'] }`
 * и одна последовательность из пяти действий: `inc`, `rename`, «то же число новым объектом»
 * (`set(s => ({ count: s.count }))`), «то же состояние» (`set(s => s)`), `addTodo`.
 * На ней сняты:
 *   — число вызовов подписчика у `redux.createStore` и `zustand/vanilla` (`NOTIFY_ROWS`);
 *   — вызовы селектора и слушателя у `subscribeWithSelector` из `zustand/middleware`,
 *     с `Object.is` и с `shallow` (`SELECTOR_ROWS`); `createSelector` из reselect (тонкие места);
 *   — рендеры четырёх компонентов React на `create` из zustand, отладочная и продакшен-сборки
 *     (`REACT_RENDERS`). Рендеры в обеих сборках совпали; число вызовов селектора — нет
 *     (в отладочной на один больше при монтировании и в рендере), поэтому в текст идёт только
 *     то, что от сборки не зависит: компонент, которому изменение не нужно, вызывает селектор
 *     ровно один раз;
 *   — селектор-объект без `useShallow`: обе сборки уходят в цикл при монтировании,
 *     `Summary` вызван 54 раза, затем «Maximum update depth exceeded» (в продакшене —
 *     «Minified React error #185»), корень размонтирован, `textContent` пуст;
 *   — рендеры компонентов Vue на pinia и `$subscribe` с `flush` по умолчанию и `'sync'`
 *     (`PINIA_RENDERS`), обе сборки Vue — одинаково;
 *   — Redux Toolkit: общие ветки после Immer, заморозка, тексты проверки мутаций в разработке
 *     и их отсутствие при `NODE_ENV=production`.
 *
 * Мини-реализация — строки `STORE_CODE`, `REDUX_CODE`, `SELECTOR_CODE`, `HOOK_CODE`,
 * `PINIA_CODE`. Демо исполняет их через `widgets/store-lab/model/run.ts`, тест — тем же модулем
 * и отдельно с React и Vue. Всё перечисленное выше, кроме продакшен-сборок React и Vue,
 * повторяет `tests/unit/state-managers.test.ts`, сверяя мини-версию с библиотеками.
 *
 * Не снято: `react-redux` и `use-sync-external-store` в проекте не установлены. Фраза о том,
 * что Zustand 4 и `useSelector` дают на селекторе-объекте лишний рендер, а не цикл, —
 * по их документации (`SOURCES`), а механизм этого лишнего рендера показан на
 * `subscribeSelector`, который сверен с `subscribeWithSelector`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'стор',
    d: 'Объект, который держит состояние приложения вне компонентов и сообщает, когда оно меняется. Компоненты читают из него и подписываются на изменения.',
  },
  {
    k: 'подписчик (слушатель)',
    d: 'Функция, которую стор вызывает после изменения. Компонент подписывается, чтобы узнать об изменении и перерисоваться.',
  },
  {
    k: 'селектор',
    d: 'Функция вида `(state) => кусок`. Выбирает из всего состояния то, что нужно одному компоненту: `(s) => s.count`.',
  },
  {
    k: 'сравнение по ссылке, `Object.is`',
    d: 'Два объекта равны, только если это один и тот же объект. Содержимое не важно: `Object.is({ a: 1 }, { a: 1 })` — `false`. Числа и строки сравниваются по значению.',
  },
  {
    k: 'неизменяемое обновление',
    d: 'Новое состояние — новый объект, старый не трогают: `{ ...state, count: 1 }` вместо `state.count = 1`. Тогда «изменилось ли» проверяется одним сравнением ссылок.',
  },
  {
    k: '`useSyncExternalStore`',
    d: 'Хук React для состояния, которое живёт вне React. Получает две функции стора: `subscribe` — подписаться, `getSnapshot` — прочитать текущее значение.',
  },
  {
    k: 'трекинг зависимостей',
    d: 'Приём Vue: во время рендера запоминается каждое прочитанное поле реактивного объекта. Запись в поле перезапускает только тех, кто его читал.',
  },
];

export const PLAIN_STORE =
  'Как рассылка в домовом чате. Управдом хранит доску объявлений и список жильцов, которые попросили сообщать им новости. Поменял объявление — написал всем по списку. Касается ли новость именно его квартиры, каждый жилец решает сам. Управдом — стор, доска — состояние, список — подписчики.';

export const PREREQ_NOTE =
  'Стор живёт вне фреймворка, но перерисовывать компонент решает фреймворк. Поэтому тема опирается на то, как это решают React и Vue.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'React сравнивает ссылки, а не содержимое',
    d: 'Ре-рендер — это повторный вызов функции компонента. Решая, нужен ли он, React сравнивает пропсы и зависимости через `Object.is`. Новый массив с теми же элементами для него — изменение.',
    href: '/frameworks/react-rerender/#s5',
    hrefLabel: '«Ре-рендеринг в React», раздел «Мемоизация»',
    tone: 'info',
  },
  {
    t: '`useSyncExternalStore`: снимок и подписка',
    d: 'Компонент React читает внешний стор через этот хук. После каждого уведомления стора React вызывает `getSnapshot` и сравнивает ответ с прошлым. Другой — компонент перерисовывается.',
    href: '/frameworks/react-hooks-internals/#s6',
    hrefLabel: '«React изнутри: хуки и контекст», раздел «Внешний стор»',
    tone: 'info',
  },
  {
    t: 'Vue запоминает, кто что прочитал',
    d: 'Рендер компонента Vue — эффект. Каждое чтение поля `reactive`-объекта внутри него записывает эффект в подписчики этого поля. Запись в поле перезапускает только их.',
    href: '/frameworks/vue-reactivity/#s2',
    hrefLabel: '«Реактивность Vue», раздел «Граф»',
    tone: 'info',
  },
];

// ─── Раздел 1. Стор: состояние и подписчики ────────────────────────────────────────────────

/** Стор — почти дословно `zustand/vanilla` 5.0.15. Тест сверяет его с библиотекой. */
export const STORE_CODE = `// Стор: состояние и набор подписчиков. Больше ничего.
function createStore(createState) {
  let state;
  const listeners = new Set();

  const getState = () => state;

  const setState = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    if (Object.is(next, state)) return;        // та же ссылка — звать некого
    const prev = state;
    state = Object.assign({}, state, next);    // слияние даёт НОВЫЙ объект
    listeners.forEach((listener) => listener(state, prev));
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);   // отписка
  };

  const api = { getState, setState, subscribe };
  state = createState(setState, getState, api);
  return api;
}`;

/** Сквозной пример. Тест исполняет его с `createStore` из темы и с `zustand/vanilla`. */
export const USAGE_CODE = `const store = createStore(() => ({
  count: 0,
  user: { name: 'Аня' },
  todos: ['молоко'],
}));

const off = store.subscribe((state, prev) => {
  console.log('подписчик:', prev.count, '→', state.count);
});

store.setState((s) => ({ count: s.count + 1 }));   // новое число
store.setState((s) => s);                          // то же состояние
store.setState((s) => ({ count: s.count }));       // то же число, новый объект
off();
store.setState((s) => ({ count: s.count + 1 }));   // после отписки`;

export const USAGE_OUT = `подписчик: 0 → 1
подписчик: 1 → 1`;

export const USAGE_NOTE =
  'Вторую запись стор пропустил: функция вернула тот же объект. А третью — нет, хотя `count` не изменился. `Object.assign({}, …)` собрал новый объект состояния, и стор увидел другую ссылку. Содержимое стор не сравнивает: для этого пришлось бы обходить всё состояние на каждое изменение. Он сравнивает одну ссылку и зовёт всех подписчиков. Касается ли изменение конкретного подписчика, тот решает сам. Четвёртую запись не услышал никто: `off()` убрал подписчика из набора.';

// ─── Раздел 2. Redux: reducer, dispatch и неизменяемость ───────────────────────────────────

/** Стор Redux без проверок аргументов и `replaceReducer`. Тест сверяет его с `redux.createStore`. */
export const REDUX_CODE = `// Redux: состояние меняет только reducer, а подписчиков зовут после каждого dispatch.
function createReduxStore(reducer) {
  let state = reducer(undefined, { type: '@@init' });
  const listeners = new Set();
  return {
    getState: () => state,
    dispatch(action) {
      state = reducer(state, action);
      listeners.forEach((listener) => listener());   // всем — даже если state тот же
      return action;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}`;

/** Reducer сквозного примера. Тест кормит его обоим сторам — из темы и из `redux`. */
export const REDUCER_CODE = `function reducer(state = { count: 0, user: { name: 'Аня' }, todos: ['молоко'] }, action) {
  switch (action.type) {
    case 'inc':
      return { ...state, count: state.count + 1 };       // новый корень, user и todos — прежние
    case 'rename':
      return { ...state, user: { ...state.user, name: action.name } };
    case 'addTodo':
      return { ...state, todos: [...state.todos, action.text] };
    default:
      return state;                                      // незнакомое действие — то же состояние
  }
}`;

export const PLAIN_ACTION =
  'Действие — бланк заявления: «тип: переименовать, имя: Боря». Reducer — сотрудник, который по бланку и текущей карточке заводит новую карточку. Старую он не исправляет, а кладёт в архив. Сам стор ничего не решает: принял бланк, отдал сотруднику, повесил новую карточку и оповестил всех.';

/** Кого зовёт стор — снято на `redux` 5.0.1 и `zustand/vanilla` 5.0.15, повторяет тест. */
export const NOTIFY_ROWS: { k: string; zustand: string; redux: string; tone: 'ok' | 'warn' }[] = [
  {
    k: 'значение изменилось',
    zustand: 'зовёт всех',
    redux: 'зовёт всех',
    tone: 'ok',
  },
  {
    k: 'то же значение в новом объекте: `set(s => ({ count: s.count }))`, reducer вернул копию',
    zustand: 'зовёт всех: ссылка новая',
    redux: 'зовёт всех',
    tone: 'warn',
  },
  {
    k: 'то же состояние: `set(s => s)`, незнакомое действие',
    zustand: '**не зовёт**',
    redux: '**зовёт всех**',
    tone: 'warn',
  },
];

export const REDUX_NOTE =
  'Пять `dispatch` подряд — пять вызовов подписчика, хотя после двух из них состояние осталось тем же объектом. Так задумано: подписка в Redux — сигнал «что-то произошло», без подробностей. Решать, касается ли это компонента, должен селектор подписчика.';

export const PLAIN_IMMUTABLE =
  'Как версии документа в облаке. Каждая правка создаёт новую версию, старая остаётся как была. Чтобы понять, менялся ли документ, не нужно перечитывать текст — достаточно сравнить номер версии. Ссылка на объект и есть такой номер: другой объект — значит, было изменение.';

/** Мутация в reducer. Тест прогоняет её на сторе из темы и на `redux` с `subscribeSelector`. */
export const MUTATE_CODE = `case 'addTodo':
  state.todos.push(action.text);   // мутация: массив тот же
  return state;                    // и корень тот же

// подписчик, которому нужен список:
subscribeSelector(store, (s) => s.todos, renderTodos);
store.dispatch({ type: 'addTodo', text: 'хлеб' });
// renderTodos не вызван: s.todos — тот же массив
// store.getState().todos.length — 2, на экране — 1`;

export const MUTATE_NOTE =
  'Стор Redux своего подписчика позвал — он зовёт всегда. Но селектор вернул тот же массив, и сравнение ссылок решило, что ничего не изменилось. Данные в сторе новые, экран — старый, ошибок нет. Неизменяемость в Redux — не вопрос вкуса: без неё сравнение ссылок врёт.';

/** Redux Toolkit: Immer копирует только путь к изменённому полю. Тест исполняет с RTK. */
export const IMMER_CODE = `const app = createSlice({
  name: 'app',
  initialState: { count: 0, user: { name: 'Аня' }, todos: ['молоко'] },
  reducers: {
    inc(state) { state.count++; },                    // это черновик, а не состояние
    addTodo(state, action) { state.todos.push(action.payload); },
  },
});
const store = configureStore({ reducer: app.reducer });

const before = store.getState();
store.dispatch(app.actions.inc());
const after = store.getState();
console.log(before === after, before.user === after.user, before.todos === after.todos);`;

export const IMMER_OUT = 'false true true';

export const IMMER_NOTE =
  'Redux Toolkit разрешает писать «мутацией», потому что reducer получает не состояние, а черновик библиотеки Immer. Immer запоминает, какие поля тронуты, и копирует только путь от корня до них. Корень новый, а `user` и `todos` — те же объекты, что были. Селектор `s => s.todos` после `inc` поэтому видит «ничего не изменилось» и рендера не заказывает.';

export const RTK_FACTS: { t: string; d: string; tone?: 'warn' | 'ok' }[] = [
  {
    t: 'Состояние заморожено',
    d: '`Object.isFrozen(store.getState())` — `true`, вложенные объекты тоже. Запись мимо reducer в модуле бросает `TypeError: Cannot assign to read only property`.',
  },
  {
    t: 'Мутация ловится — в разработке',
    d: 'Обычный reducer, который мутирует, `configureStore` поймает: «A state mutation was detected inside a dispatch, in the path: count». Запись между действиями — «…detected between dispatches». При `NODE_ENV=production` проверки нет, мутация проходит молча.',
    tone: 'warn',
  },
  {
    t: 'Тот же объект — подписчики всё равно позваны',
    d: 'Черновик, в котором ничего не изменилось (`state.count = state.count`), Immer превращает в прежний объект. Но `dispatch` всё равно позовёт подписчиков: это поведение самого Redux, а не Immer.',
  },
];

// ─── Раздел 3. Селектор: подписка на свой кусок ────────────────────────────────────────────

/** Подписка с селектором — та же логика, что `subscribeWithSelector` из `zustand/middleware`. */
export const SELECTOR_CODE = `// Подписка на кусок состояния: селектор — на каждое уведомление,
// слушатель — только если кусок другой.
function subscribeSelector(store, selector, listener, equals = Object.is) {
  let slice = selector(store.getState());
  return store.subscribe(() => {
    const next = selector(store.getState());
    if (equals(slice, next)) return;           // кусок тот же — рендера не будет
    const prev = slice;
    slice = next;
    listener(next, prev);
  });
}

// Поверхностное сравнение: те же ключи, и значения равны по Object.is.
function shallow(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}`;

export const PLAIN_SELECTOR =
  'Жилец из домового чата читает каждое сообщение, но отвечает, только если оно про его квартиру. Прочитать приходится все — это вызов селектора. Ответить — только на своё: это вызов слушателя, то есть рендер.';

/**
 * Пять действий сквозного примера, стор из `STORE_CODE`. Снято на `subscribeWithSelector`
 * zustand 5.0.15; тест повторяет и на нём, и на `subscribeSelector` из темы.
 */
export const SELECTOR_ROWS: { sel: string; calls: number; renders: number; why: string; tone?: 'warn' | 'ok' }[] = [
  { sel: '`(s) => s.count`', calls: 5, renders: 1, why: 'число сменилось только на `inc`' },
  { sel: '`(s) => s.user.name`', calls: 5, renders: 1, why: 'имя сменилось только на `rename`' },
  {
    sel: '`(s) => ({ count: s.count, todos: s.todos.length })`',
    calls: 5,
    renders: 4,
    why: 'объект новый на каждом вызове — `Object.is` не совпадает никогда',
    tone: 'warn',
  },
  {
    sel: 'тот же селектор + `shallow`',
    calls: 5,
    renders: 2,
    why: 'поля сравниваются по одному: сменились на `inc` и `addTodo`',
    tone: 'ok',
  },
];

export const SELECTOR_NOTE =
  'Уведомлений было четыре: `set(s => s)` стор пропустил. Каждый селектор вызван пять раз — один раз при подписке и по разу на уведомление, в том числе на чужие. Селектор, который каждый раз строит новый объект, вызывает слушателя на всё подряд. Это и есть **лишний рендер**: `rename` и «то же число» перерисовали бы `Summary`, хотя его числа не менялись. `shallow` сравнивает не сам объект, а его поля, и пропускает такие изменения.';

// ─── Раздел 4. Zustand: create и useSyncExternalStore ──────────────────────────────────────

/** Как стор Zustand используют в React. Тест снимает JSX TypeScript'ом и рендерит с zustand. */
export const CREATE_CODE = `import { create } from 'zustand';

const useApp = create((set) => ({
  count: 0,
  user: { name: 'Аня' },
  todos: ['молоко'],
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

export function Counter() {
  const count = useApp((s) => s.count);   // селектор: подписка на одно число
  return <p>{count}</p>;
}`;

/** Хук Zustand 5 без отладочных мелочей. Тест рендерит с ним те же компоненты, что с `zustand`. */
export const HOOK_CODE = `// Хук Zustand 5 по сути: селектор и есть getSnapshot для useSyncExternalStore.
function useStore(store, selector = (state) => state) {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

// useShallow: если новый объект поверхностно равен прошлому — вернуть прошлый.
function useShallow(selector) {
  const prev = useRef(undefined);
  return (state) => {
    const next = selector(state);
    return shallow(prev.current, next) ? prev.current : (prev.current = next);
  };
}`;

export const HOOK_NOTE =
  'Методы стора лежат прямо на хуке: `useApp.getState()`, `useApp.setState()` — так стор меняют вне компонентов. Сам хук ничего не сравнивает. Селектор становится `getSnapshot`: после уведомления React вызывает его и сравнивает ответ с прошлым через `Object.is`. Та же проверка, что в `subscribeSelector`, только делает её React.';

/** Компоненты таблицы рендеров. */
export const REACT_COMPONENTS = [
  { k: '`Counter`', sel: '`useApp((s) => s.count)`' },
  { k: '`Name`', sel: '`useApp((s) => s.user.name)`' },
  { k: '`Whole`', sel: '`useApp()` — без селектора' },
  { k: '`Summary`', sel: '`useApp(useShallow((s) => ({ count: s.count, todos: s.todos.length })))`' },
];

/**
 * Рендеры за каждое действие, React 19.3 + zustand 5.0.15, отладочная и продакшен-сборки —
 * одинаково. Столбцы — `REACT_COMPONENTS` по порядку. Тест повторяет на `create` из zustand
 * и на `useStore` из `HOOK_CODE`.
 */
export const REACT_RENDERS: { action: string; renders: [number, number, number, number] }[] = [
  { action: '`inc`', renders: [1, 0, 1, 1] },
  { action: '`rename`', renders: [0, 1, 1, 0] },
  { action: '`set(s => ({ count: s.count }))`', renders: [0, 0, 1, 0] },
  { action: '`set(s => s)`', renders: [0, 0, 0, 0] },
  { action: '`addTodo`', renders: [0, 0, 1, 1] },
];

export const REACT_NOTE =
  '`useApp()` без селектора возвращает всё состояние. А оно после каждого `set` — новый объект, так что `Whole` перерисовывается на любое изменение стора, даже на «то же число». Селектор, который возвращает одно поле, отрезает чужие изменения. Компонент, которого изменение не касается, платит за него одним вызовом селектора, без рендера.';

/** Селектор-объект без `useShallow`. Тест рендерит его с zustand и с `HOOK_CODE`. */
export const LOOP_CODE = `function Summary() {
  // новый объект на каждый вызов селектора
  const { count, todos } = useApp((s) => ({ count: s.count, todos: s.todos.length }));
  return <p>{count}/{todos}</p>;
}`;

export const LOOP_NOTE =
  'В Zustand 5 это не лишний рендер, а бесконечный цикл — сразу при монтировании. После коммита React проверяет, не изменился ли стор, пока шёл рендер: снова зовёт `getSnapshot` и сравнивает с тем, что отрисовано. Селектор вернул новый объект — значит, «изменился». React ставит новый рендер, тот получает ещё один новый объект, и так по кругу. Отладочная сборка предупреждает: «The result of getSnapshot should be cached to avoid an infinite loop». Через полсотни рендеров `Summary` React сдаётся с ошибкой «Maximum update depth exceeded». Поймать её некому, и React размонтирует всё дерево — пустеет весь экран, а не только `Summary`. Почему предохранитель срабатывает именно так, разобрано в [«React изнутри: хуки и контекст», раздел «Внешний стор»](/frameworks/react-hooks-internals/#s6).';

export const LOOP_V4_NOTE =
  'В Zustand 4 и в `useSelector` из react-redux тот же селектор давал не цикл, а лишний рендер на каждое изменение стора. Там снимком служит всё состояние, а селектор применяется к нему отдельно и сравнивается после уведомления — как в `subscribeSelector`. Миграция на Zustand 5 поэтому превращает тихий лишний рендер в падение.';

export const SHALLOW_NOTE =
  '`useShallow` хранит прошлый объект и, если новый поверхностно равен ему, возвращает прошлый. Для `Object.is` это тот же объект: цикла нет, а рендер будет, только когда правда сменилось одно из полей. Другой выход — два селектора на два поля: `useApp((s) => s.count)` и `useApp((s) => s.todos.length)`. Оба возвращают числа, а числа сравниваются по значению.';

// ─── Раздел 5. Pinia: подписка не нужна ────────────────────────────────────────────────────

/** Pinia без плагинов, `$patch` и `$subscribe`. Тест рендерит с ним те же компоненты, что с `pinia`. */
export const PINIA_CODE = `// Pinia по сути: стор — reactive-объект, геттеры — computed, действия — функции.
function defineStore(id, { state, getters = {}, actions = {} }) {
  let store = null;
  return function useStore() {
    if (store) return store;                   // один экземпляр на приложение
    const raw = reactive(state());
    const computedGetters = {};
    for (const key in getters) {
      computedGetters[key] = computed(() => getters[key](raw));
    }
    // reactive разворачивает ref и computed: store.count читает и пишет raw.count
    store = reactive({ ...toRefs(raw), ...computedGetters });
    for (const key in actions) store[key] = actions[key].bind(store);
    return store;
  };
}`;

export const PINIA_USAGE_CODE = `const useApp = defineStore('app', {
  state: () => ({ count: 0, user: { name: 'Аня' }, todos: ['молоко'] }),
  getters: { summary: (s) => \`\${s.count}/\${s.todos.length}\` },
  actions: { inc() { this.count++; } },
});

// в компоненте: никакого селектора и никакой подписки
const store = useApp();
// шаблон читает store.count — с этой минуты рендер подписан на count`;

export const PINIA_NOTE =
  'Селектор Zustand отвечает на вопрос «касается ли меня изменение» после каждого изменения, у каждого подписчика. Vue отвечает на него заранее, при чтении: рендер прочитал `store.count` — значит, записан в подписчики `count`. Проверок «на всякий случай» нет. Запись в `user.name` не будит ни `Counter`, ни `Summary`, и ни одной функции, похожей на селектор, при этом не вызывается.';

export const PINIA_COMPONENTS = [
  { k: '`Counter`', sel: '`store.count`' },
  { k: '`Name`', sel: '`store.user.name`' },
  { k: '`Summary`', sel: 'геттер `store.summary`' },
  { k: '`Todos`', sel: '`store.todos.length`' },
];

/**
 * Рендеры компонентов Vue 3.5.42 на pinia 4.0.3, за каждое действие с ожиданием `nextTick`.
 * Столбцы — `PINIA_COMPONENTS`. Тест повторяет на `pinia` и на `defineStore` из `PINIA_CODE`.
 */
export const PINIA_RENDERS: { action: string; renders: [number, number, number, number] }[] = [
  { action: '`store.inc()`', renders: [1, 0, 1, 0] },
  { action: "`store.user.name = 'Боря'`", renders: [0, 1, 0, 0] },
  { action: '`store.count = store.count`', renders: [0, 0, 0, 0] },
  { action: '`store.user = store.user`', renders: [0, 0, 0, 0] },
  { action: "`store.todos.push('хлеб')`", renders: [0, 0, 1, 1] },
  { action: 'три записи подряд: `count++`, `count++`, `user.name`', renders: [1, 1, 1, 0] },
];

export const PINIA_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Та же запись — тишина',
    d: 'Vue сравнивает новое значение со старым прямо при записи. `store.count = store.count` не будит никого — в отличие от `set({ count: s.count })` в Zustand, где перерисовался `Whole`.',
    tone: 'ok',
  },
  {
    t: 'Три записи — один рендер',
    d: 'Рендеры компонентов встают в очередь и выполняются после текущего кода. Сколько бы записей ни было, компонент перерисуется один раз. Как устроена очередь, разобрано в [«Реактивности Vue», раздел «Планировщик»](/frameworks/vue-reactivity/#s3).',
  },
  {
    t: '`$subscribe` — для кода вне компонентов',
    d: 'Например, чтобы сохранять стор в `localStorage`. По умолчанию слушатель зовётся раз за очередь: три записи — один вызов. С `{ flush: \'sync\' }` — на каждую запись: три. `$patch` объектом даёт один вызов и в режиме `sync`.',
  },
  {
    t: 'Деструктуризация отрывает от стора',
    d: '`const { count } = useApp()` копирует число один раз — компонент покажет `0` навсегда. `storeToRefs(store)` отдаёт `ref`, связанные с полями стора. Это обычная ловушка `reactive`, она разобрана в [«Реактивности Vue», раздел «Ловушки»](/frameworks/vue-reactivity/#s4).',
    tone: 'err',
  },
];

// ─── Раздел 6. Все вместе: демо ────────────────────────────────────────────────────────────

export const LAB_MODES: { value: LabMode; label: string; note: string }[] = [
  {
    value: 'all',
    label: 'без селектора',
    note: 'Каждый компонент подписан как `store.subscribe(render)`: рендер на любое уведомление.',
  },
  {
    value: 'selector',
    label: 'селектор',
    note: 'Подписка `subscribeSelector(store, selector, render)` со сравнением `Object.is`.',
  },
  {
    value: 'shallow',
    label: 'селектор + shallow',
    note: 'Та же подписка, но объект `Summary` сравнивается функцией `shallow` — по полям.',
  },
  {
    value: 'tracking',
    label: 'Pinia',
    note: 'Стор из мини-`defineStore`, рендер — эффект Vue, который читает поля стора. Селекторов нет.',
  },
];

export const LAB_ACTIONS: { value: LabAction; label: string; store: string; pinia: string }[] = [
  { value: 'inc', label: '+1', store: 'set((s) => ({ count: s.count + 1 }))', pinia: 'store.inc()' },
  { value: 'rename', label: 'новое имя', store: "set({ user: { name: '…' } })", pinia: "store.user.name = '…'" },
  { value: 'addTodo', label: 'новое дело', store: 'set((s) => ({ todos: [...s.todos, …] }))', pinia: 'store.todos.push(…)' },
  { value: 'sameCount', label: 'то же число', store: 'set((s) => ({ count: s.count }))', pinia: 'store.count = store.count' },
  { value: 'sameRef', label: 'то же состояние', store: 'set((s) => s)', pinia: 'store.user = store.user' },
];

/** Как компонент читает стор — по режимам. Функции за этими строками — `LAB_COMPONENTS` в `run.ts`. */
export const LAB_COMPONENTS_TEXT: { id: LabComponentId; label: string; code: Record<LabMode, string> }[] = [
  {
    id: 'counter',
    label: 'Counter',
    code: {
      all: 'store.getState().count',
      selector: '(s) => s.count',
      shallow: '(s) => s.count',
      tracking: 'store.count',
    },
  },
  {
    id: 'name',
    label: 'Name',
    code: {
      all: 'store.getState().user.name',
      selector: '(s) => s.user.name',
      shallow: '(s) => s.user.name',
      tracking: 'store.user.name',
    },
  },
  {
    id: 'summary',
    label: 'Summary',
    code: {
      all: 'store.getState() → count/todos.length',
      selector: '(s) => ({ count: s.count, todos: s.todos.length })',
      shallow: '(s) => ({ count: s.count, todos: s.todos.length }) + shallow',
      tracking: 'store.summary — геттер',
    },
  },
];

/** Строчная разметка. Подставляется демо, когда селектор неустойчив. */
export const LAB_LOOP_NOTE =
  'Этот селектор на одном и том же состоянии возвращает разные объекты. Здесь он даёт лишний рендер на каждое уведомление, а в React с `useSyncExternalStore` — бесконечный цикл.';

export const DEMO_CAPTION =
  'Сравните «то же число» в разных режимах. Без селектора перерисуются все трое: стор собрал новый объект состояния. С селектором — только `Summary`, чей селектор каждый раз строит новый объект; `shallow` убирает и его. В режиме Pinia та же запись не будит никого и не вызывает ни одной проверки. Рендеры и проверки считают `createStore`, `subscribeSelector`, `shallow` и `defineStore`, напечатанные в разделах выше.';

export const COMPARE = {
  head: ['', 'Redux', 'Zustand', 'Pinia'],
  rows: [
    ['кто меняет состояние', 'reducer по действию из `dispatch`', '`set` из любого места', 'запись в поле, действие стора'],
    ['кого зовёт стор', 'всех подписчиков после каждого `dispatch`', 'всех подписчиков, если сменилась ссылка состояния', 'только эффекты, которые читали изменённое поле'],
    ['как компонент узнаёт «моё»', 'селектор и сравнение ссылок (`useSelector`)', 'селектор — это `getSnapshot` в `useSyncExternalStore`', 'никак: Vue помнит, что прочитал рендер'],
    ['неизменяемость', 'обязательна; в Toolkit её даёт Immer', 'обязательна', 'не нужна: запись ловит Vue'],
  ],
};

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Селектор-объект в Zustand 5 — не лишний рендер, а падение',
    d: '`useApp((s) => ({ a: s.a, b: s.b }))` уходит в цикл при монтировании и роняет всё дерево ошибкой «Maximum update depth exceeded». В Zustand 4 тот же код работал с лишними рендерами — миграция превращает тихую проблему в громкую. Лечение — `useShallow` или по селектору на поле.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`.map` и `.filter` в селекторе — тоже новый объект',
    d: '`(s) => s.todos.map(...)` строит новый массив на каждом вызове. На пяти действиях сквозного примера такой селектор позвал слушателя четыре раза из четырёх. `createSelector` из reselect пересчитывает, только когда вход сменил ссылку: два расчёта и один вызов слушателя.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`useApp()` без селектора подписывает на всё',
    d: 'Хук возвращает всё состояние, а оно новое после любого `set`. Компонент перерисуется от изменения поля, которое он не читает, и даже от `set` с тем же значением.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Мутация прячет изменение от сравнения ссылок',
    d: '`state.todos.push(x); return state` — данные в сторе новые, а селектор `s => s.todos` видит тот же массив. Экран не обновится, ошибки не будет. Redux Toolkit ловит такое только в разработке.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Redux зовёт подписчиков на любое действие',
    d: 'Даже на незнакомое, после которого reducer вернул то же состояние. Отсеивают лишнее только селекторы, а они вызываются у каждого подписанного компонента на каждое действие. Поэтому селектор должен быть дешёвым.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`set` с тем же значением — всё равно уведомление',
    d: 'Стор Zustand сравнивает ссылку на всё состояние, а не поля. `set({ count: s.count })` создаёт новый объект и будит всех подписчиков; спасают их только селекторы. Не будит лишь функция, которая вернула то же состояние: `set((s) => s)`.',
  },
  {
    n: '07',
    t: 'Деструктуризация стора Pinia — снимок, а не подписка',
    d: '`const { count } = useApp()` — число, скопированное один раз. Для полей — `storeToRefs`, для действий деструктуризация безопасна: это просто функции.',
    tone: 'err',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Redux — Store API',
    href: 'https://redux.js.org/api/store',
    what: '`getState`, `dispatch`, `subscribe`: подписчик зовётся после каждого действия; версия 5.0.1 на стенде',
  },
  {
    title: 'Redux Style Guide — Do Not Mutate State',
    href: 'https://redux.js.org/style-guide/#do-not-mutate-state',
    what: 'почему мутация ломает обновление интерфейса',
  },
  {
    title: 'Redux Toolkit — Writing Reducers with Immer',
    href: 'https://redux-toolkit.js.org/usage/immer-reducers',
    what: 'черновик, общие ветки, заморозка; версия 2.13.0 на стенде',
  },
  {
    title: 'React — useSyncExternalStore',
    href: 'https://react.dev/reference/react/useSyncExternalStore',
    what: '`subscribe`, `getSnapshot` и требование возвращать тот же снимок',
  },
  {
    title: 'Zustand — Prevent rerenders with useShallow',
    href: 'https://zustand.docs.pmnd.rs/guides/prevent-rerenders-with-use-shallow',
    what: 'селектор-объект и `useShallow`; версия 5.0.15 на стенде',
  },
  {
    title: 'Zustand — Migrating to v5',
    href: 'https://zustand.docs.pmnd.rs/migrations/migrating-to-v5',
    what: 'почему селектор с новой ссылкой в v5 даёт бесконечный цикл, а в v4 — нет',
  },
  {
    title: 'React Redux — useSelector',
    href: 'https://react-redux.js.org/api/hooks#useselector',
    what: 'сравнение результата селектора по ссылке и лишний рендер на новом объекте',
  },
  {
    title: 'Pinia — State: subscribing to the state',
    href: 'https://pinia.vuejs.org/core-concepts/state.html#Subscribing-to-the-state',
    what: '`$subscribe` и `flush`; версия 4.0.3 на стенде',
  },
  {
    title: 'Pinia — Destructuring from a Store',
    href: 'https://pinia.vuejs.org/core-concepts/#Destructuring-from-a-Store',
    what: '`storeToRefs` и почему деструктуризация теряет реактивность',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри: хуки и контекст, раздел «Внешний стор»](/frameworks/react-hooks-internals/#s6) — как устроен `useSyncExternalStore` и почему без него экран рвётся. [Ре-рендеринг в React, раздел «Мемоизация»](/frameworks/react-rerender/#s5) — `memo` и сравнение через `Object.is`. [Реактивность Vue, раздел «Граф»](/frameworks/vue-reactivity/#s2) — откуда Vue знает, кто что прочитал. [Vue 3 изнутри: watch, effectScope и computed 3.5, раздел «effectScope»](/frameworks/vue-watch-internals/#s4) — область, в которой Pinia держит эффекты стора. [Сигналы](/frameworks/signals/) — значение, которое само помнит читателей: та же идея, что у Pinia, без компонентов. [Кеш данных на клиенте](/frameworks/data-cache/) — серверное состояние в кеше по ключу: устаревание, дедупликация, инвалидация после мутации. [Внедрение зависимостей](/frameworks/dependency-injection/) — `provide`/`inject` во Vue, контекст React и иерархия инжекторов Angular. [Отмена и повтор](/algorithms/undo-redo/) — две стопки, снимки и обратные правки, группировка и история `<textarea>`.';
