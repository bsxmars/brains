import type {
  DefineStore,
  Effects,
  Lab,
  LabAction,
  LabComponentId,
  LabMode,
  LabRow,
  LabState,
  MiniApi,
  MiniStore,
  Reactivity,
  TrackedStore,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `STORE_CODE`, `SELECTOR_CODE`
 * и `PINIA_CODE` из темы «Стейт-менеджеры изнутри».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и сверяются
 * `tests/unit/state-managers.test.ts` с настоящими библиотеками: стор и подписка с селектором —
 * с `zustand/vanilla` и `subscribeWithSelector`, счёт рендеров — с компонентами React 19.3
 * на `zustand` и Vue 3.5 на `pinia`. Копии нет: разойдётся показанный код с библиотекой —
 * покраснеет тест.
 *
 * Ни DOM, ни компонентов: реактивность Vue приходит параметром, чтобы модуль мог исполнить
 * юнит-тест. В режиме Pinia «рендер компонента» — эффект Vue, который читает стор; для действий
 * демо (по одной записи) число запусков эффекта совпадает с числом рендеров компонента Vue —
 * это тоже проверяет тест.
 */
export function loadMini(storeCode: string, selectorCode: string): MiniApi {
  return new Function(`${storeCode}\n${selectorCode}\nreturn { createStore, subscribeSelector, shallow };`)() as MiniApi;
}

export function loadDefineStore(piniaCode: string, vue: Reactivity): DefineStore {
  return new Function('reactive', 'computed', 'toRefs', `${piniaCode}\nreturn defineStore;`)(
    vue.reactive,
    vue.computed,
    vue.toRefs,
  ) as DefineStore;
}

/** Состояние сквозного примера — то же, что напечатано в теме (`SAMPLE_STATE`). */
export const initialState = (): LabState => ({ count: 0, user: { name: 'Аня' }, todos: ['молоко'] });

const NAMES = ['Боря', 'Вера', 'Гоша', 'Аня'];

interface LabComponent {
  id: LabComponentId;
  /** Селектор, на который подписан компонент в режимах `selector` и `shallow`. */
  selector: (s: LabState) => unknown;
  /** Что компонент показывает — из состояния стора. */
  view: (s: LabState) => string;
  /** Что компонент показывает в режиме Pinia — чтением полей стора. */
  read: (store: TrackedStore) => string;
}

export const LAB_COMPONENTS: LabComponent[] = [
  { id: 'counter', selector: (s) => s.count, view: (s) => String(s.count), read: (st) => String(st.count) },
  { id: 'name', selector: (s) => s.user.name, view: (s) => s.user.name, read: (st) => st.user.name },
  {
    id: 'summary',
    selector: (s) => ({ count: s.count, todos: s.todos.length }),
    view: (s) => `${s.count}/${s.todos.length}`,
    read: (st) => st.summary,
  },
];

/**
 * React-проверка из отладочной сборки: два вызова селектора на одном и том же состоянии
 * обязаны дать одно и то же по `Object.is`. Не дают — `useSyncExternalStore` уходит в цикл.
 */
export function snapshotIsStable(selector: (s: LabState) => unknown, state: LabState): boolean {
  return Object.is(selector(state), selector(state));
}

/** Действия демо — над стором (`setState`) и над стором Pinia (запись в поле). */
function storeAction(action: LabAction, store: MiniStore, step: number): void {
  if (action === 'inc') store.setState((s) => ({ count: s.count + 1 }));
  else if (action === 'rename') store.setState({ user: { name: NAMES[step % NAMES.length] } });
  else if (action === 'addTodo') store.setState((s) => ({ todos: [...s.todos, `дело ${s.todos.length + 1}`] }));
  else if (action === 'sameCount') store.setState((s) => ({ count: s.count }));
  else store.setState((s) => s);
}

function trackedAction(action: LabAction, store: TrackedStore, step: number): void {
  if (action === 'inc') store.inc();
  else if (action === 'rename') store.user.name = NAMES[step % NAMES.length];
  else if (action === 'addTodo') store.todos.push(`дело ${store.todos.length + 1}`);
  // Запись того же значения и есть действие: Vue сравнивает его со старым и никого не будит.
  // eslint-disable-next-line no-self-assign -- см. выше
  else if (action === 'sameCount') store.count = store.count;
  // eslint-disable-next-line no-self-assign -- см. выше
  else store.user = store.user;
}

interface Counters {
  value: string;
  renders: number;
  checks: number;
}

export interface LabCodes {
  store: string;
  selector: string;
  pinia: string;
}

/** Стенд демо: стор, три компонента-подписчика и счётчики их рендеров и проверок. */
export function createLab(mode: LabMode, codes: LabCodes, vue: Reactivity & Effects): Lab {
  const counters = new Map<LabComponentId, Counters>();
  const before = new Map<LabComponentId, Counters>();
  let step = 0;
  let act: (a: LabAction) => void;
  let stop: () => void;

  if (mode === 'tracking') {
    const useStore = loadDefineStore(codes.pinia, vue)('lab', {
      state: initialState,
      getters: { summary: (s) => `${s.count}/${s.todos.length}` },
      actions: {
        inc() {
          this.count++;
        },
      },
    });
    const store = useStore();
    const scope = vue.effectScope(true);
    scope.run(() => {
      for (const c of LAB_COMPONENTS) {
        const entry: Counters = { value: '', renders: 0, checks: 0 };
        counters.set(c.id, entry);
        // «Рендер»: эффект читает стор — Vue запоминает, что именно прочитано.
        vue.effect(() => {
          entry.renders++;
          entry.value = c.read(store);
        });
      }
    });
    act = (a) => trackedAction(a, store, step);
    stop = () => scope.stop();
  } else {
    const mini = loadMini(codes.store, codes.selector);
    const store = mini.createStore(initialState);
    const offs: (() => void)[] = [];
    for (const c of LAB_COMPONENTS) {
      const entry: Counters = { value: c.view(store.getState()), renders: 1, checks: 0 };
      counters.set(c.id, entry);
      const render = () => {
        entry.renders++;
        entry.value = c.view(store.getState());
      };
      if (mode === 'all') {
        offs.push(store.subscribe(render));
      } else {
        const counted = (s: LabState) => {
          entry.checks++;
          return c.selector(s);
        };
        offs.push(mini.subscribeSelector(store, counted, render, mode === 'shallow' ? mini.shallow : undefined));
      }
    }
    act = (a) => storeAction(a, store, step);
    stop = () => offs.forEach((off) => off());
  }

  for (const [id, c] of counters) before.set(id, { ...c });

  return {
    rows: () =>
      LAB_COMPONENTS.map((c) => {
        const now = counters.get(c.id)!;
        const was = before.get(c.id)!;
        return {
          id: c.id,
          value: now.value,
          renders: now.renders,
          checks: now.checks,
          lastRenders: now.renders - was.renders,
          lastChecks: now.checks - was.checks,
        } satisfies LabRow;
      }),
    act(a) {
      for (const [id, c] of counters) before.set(id, { ...c });
      act(a);
      if (a === 'rename') step++;
    },
    stop,
  };
}
