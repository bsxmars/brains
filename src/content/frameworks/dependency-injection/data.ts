import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { DemoToken, DiSpec } from '@/widgets/di-lab/model/types';

/**
 * Данные темы «Внедрение зависимостей во фреймворках: inject, provide, контекст».
 *
 * Тема написана здесь, 2026-10-02, для направления «Фреймворки изнутри».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * `@angular/core`, `@angular/compiler`, `@angular/common`, `@angular/platform-browser` **21.2.25**,
 * Vue **3.5.42**, React и react-dom **19.3.0**, pinia 4.0.3, happy-dom 20.14.5, TypeScript 6.0.3,
 * `reflect-metadata` — всё из `node_modules` проекта. Node 24.11.0, октябрь 2026.
 *
 * Как снято. Angular запущен в Node с DOM из happy-dom, в режиме JIT (`@angular/compiler`
 * загружен до приложения; AOT-компилятора `ngc` в проекте нет): компоненты собраны вызовами
 * `Component({...})(class)`, приложение — `createApplication` + `createComponent`. Тот же приём,
 * что в «Angular без zone.js», только без браузера: для DI рендер не нужен, нужны конструкторы.
 * Примеры на TypeScript с декораторами (`*_CODE`) переводятся `ts.transpileModule`
 * (`experimentalDecorators`, `emitDecoratorMetadata` — для типов параметров, которые читает JIT
 * через `reflect-metadata`) и исполняются; их вывод — литералы `*_OUT`.
 *
 * Что измерено запуском (и пересобирается `tests/unit/dependency-injection.test.ts`):
 *   — учебный инжектор `ANGULAR_DI_CODE` против настоящего Angular на наборе деревьев: значения,
 *     номера экземпляров, коды ошибок, путь цикла; порядок конструкторов компонентов;
 *   — `VUE_PROVIDE_CODE` против Vue 3.5: значения `inject` и устройство объектов `provides`
 *     (кто с кем делит объект, чей прототип чей);
 *   — `REACT_CONTEXT_CODE` против React 19 (`renderToString`): ближайший провайдер, значение
 *     по умолчанию;
 *   — все примеры кода и их вывод, тексты ошибок `NG0200`/`NG0201`/`NG0203` в режиме разработки
 *     и их вид в продакшене (`ngDevMode = false`, отдельный процесс);
 *   — места исходников, на которые опирается текст: `Object.create(parentProvides)` и
 *     `key in provides` в runtime-core, `NOT_YET`/`CIRCULAR` и `injectableDefInScope` в R3Injector,
 *     флаги и блум-фильтр NodeInjector, `inject(piniaSymbol)` в pinia.
 *
 * Без запуска, по документации: что `providedIn: 'root'` даёт сборщику выкинуть неиспользуемый
 * сервис (tree-shakable providers). Проверить это нечем — AOT-компилятора, который пишет
 * итоговый код сервиса, в проекте нет; в тексте это сказано как свойство схемы ссылок, со
 * ссылкой на документацию Angular.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'зависимость',
    d: 'Объект, без которого класс или компонент не работает: клиент API, логгер, хранилище. Корзине нужен сервис цен — это её зависимость.',
  },
  {
    k: 'внедрение зависимостей (DI)',
    d: 'Класс не создаёт зависимость сам, а получает готовую снаружи. Кто именно её даст и какую — решает не класс, а тот, кто собирает приложение.',
  },
  {
    k: 'токен',
    d: 'Имя, по которому просят зависимость: класс (`Logger`), `InjectionToken` в Angular, ключ `provide` во Vue, объект контекста в React. Важно, чтобы два разных смысла не получили одно имя.',
  },
  {
    k: 'провайдер',
    d: 'Запись «по этому токену отдавать вот это»: готовое значение, новый экземпляр класса, результат функции или другой токен.',
  },
  {
    k: 'инжектор',
    d: 'Объект, который хранит провайдеры и отвечает на запрос «дай токен X». Не нашёл у себя — спрашивает родителя. В Angular инжекторов много, и они образуют дерево.',
  },
  {
    k: 'синглтон',
    d: 'Объект в одном экземпляре на всех. В DI это всегда «один на инжектор»: на всё приложение, если провайдер в корне, и по одному на компонент, если провайдер в компоненте.',
  },
];

export const PLAIN_DI =
  'Как розетка в гостинице. Фен не носит с собой электростанцию, он просит «дайте 220 вольт», а откуда ток — из городской сети или от генератора отеля, — решает здание. В тестовой комнате можно поставить стенд вместо сети, и фен этого не заметит.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Цепочка прототипов',
    d: 'Если у объекта нет своего свойства, чтение идёт в его прототип, потом в прототип прототипа. `Object.create(p)` создаёт пустой объект с прототипом `p`. На этом целиком построен `provide` во Vue.',
    href: '/js/object-model/#s2',
    hrefLabel: '«Объектная модель», раздел «Прототипы»',
    tone: 'info',
  },
  {
    t: 'Дерево компонентов',
    d: 'Компонент выводит другие компоненты, те — свои, и выходит дерево. Родитель создаётся раньше детей. Всё, что ниже, — поддерево.',
    href: '/frameworks/react-rerender/#s2',
    hrefLabel: '«Ре-рендеринг в React», раздел «Дерево»',
    tone: 'info',
  },
  {
    t: '`ref` во Vue',
    d: 'Объект со свойством `value`. Кто прочитал `value` во время рендера, тот перерисуется, когда `value` поменяют. Число, вынутое из `ref`, — уже просто число.',
    href: '/frameworks/vue-internals/#s4',
    hrefLabel: '«Vue 3 изнутри», раздел «ref»',
    tone: 'info',
  },
  {
    t: 'Декораторы TypeScript',
    d: '`@Injectable()`, `@Component()` — функции, которые вызываются над классом и записывают в него служебные данные. Angular читает их, чтобы знать, как класс создавать. Для темы достаточно этого.',
    tone: 'info',
  },
];

// ─── Раздел 1. Зачем это всё ──────────────────────────────────────────────────────────────

export const CART_PLAIN_CODE = `export class PriceApi {
  async price(id: string): Promise<number> {
    const res = await fetch(\`/api/price/\${id}\`);
    return (await res.json()).price;
  }
}

export class Cart {
  private api = new PriceApi();          // корзина сама решила, с кем работать
  async total(ids: string[]) {
    let sum = 0;
    for (const id of ids) sum += await this.api.price(id);
    return sum;
  }
}`;

export const CART_DI_CODE = `import { Injectable, inject } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PriceApi {
  async price(id: string): Promise<number> {
    const res = await fetch(\`/api/price/\${id}\`);
    return (await res.json()).price;
  }
}

@Injectable({ providedIn: 'root' })
export class Cart {
  private api = inject(PriceApi);        // «дайте PriceApi» — какой именно, решает инжектор
  async total(ids: string[]) {
    let sum = 0;
    for (const id of ids) sum += await this.api.price(id);
    return sum;
  }
}`;

export const CART_SPEC_CODE = `import { TestBed } from '@angular/core/testing';

it('считает сумму без сети', async () => {
  TestBed.configureTestingModule({
    providers: [
      { provide: PriceApi, useValue: { price: async (id: string) => ({ a: 100, b: 250 })[id] } },
    ],
  });
  const cart = TestBed.inject(Cart);
  expect(await cart.total(['a', 'b'])).toBe(350);
});`;

export const WHY_NOTE =
  'В первом варианте `new PriceApi()` зашит внутрь: тест корзины пойдёт в сеть, и заменить сервис можно только подменой модуля целиком (как это делает `vi.mock` — [«Тест-раннеры изнутри», раздел «Моки и подъём»](/tooling/test-runners/#s3)). Во втором корзина только называет, что ей нужно, а тест кладёт в инжектор подделку под тем же токеном. Код корзины одинаков в приложении и в тесте.';

export const WHY_ROWS = [
  {
    k: 'замена реализации',
    d: 'Тест, сборка для витрины, другой бэкенд: провайдер меняется в одном месте, классы-потребители не трогаются.',
  },
  {
    k: 'один экземпляр на поддерево',
    d: 'Провайдер в корне — один объект на приложение. Провайдер в компоненте — свой объект у каждого экземпляра этого компонента и общий для всех его потомков. Так у каждой карточки своё состояние, а у её кнопок — карточкино.',
  },
  {
    k: 'без проброса через пропсы',
    d: 'Внук получает тему от деда, а промежуточные компоненты о ней не знают. Во Vue и React ради этого DI обычно и берут.',
  },
];

// ─── Раздел 2. Vue: provide и inject ──────────────────────────────────────────────────────

export const PLAIN_PROVIDES =
  'Как записки на холодильнике в семье. У каждого ребёнка свой магнит с запиской, но если своей записки «где ключи» нет, смотрят на родительскую, потом на бабушкину. Пока ребёнок ничего не написал, отдельного магнита у него нет — он смотрит прямо на родительский.';

export const VUE_CHAIN_CODE = `import { createApp, getCurrentInstance, h, inject, provide, type InjectionKey } from 'vue';

const Theme: InjectionKey<string> = Symbol('theme');   // символ не совпадёт ни с чьим ключом
const objs: Record<string, object> = {};
// provides — внутреннее поле экземпляра, в публичных типах его нет
const own = (name: string) => { objs[name] = (getCurrentInstance() as any).provides; };

const Card = { setup() { own('Card'); return () => h('p', inject(Theme)); } };
const Board = {
  setup() {
    provide(Theme, 'тёмная');
    console.log('Board видит:', inject(Theme));         // своё не видно: читает родителя
    own('Board');
    return () => h(Card);
  },
};
const Header = { setup() { own('Header'); return () => h('header'); } };
const App = { setup() { own('App'); return () => [h(Header), h(Board)]; } };

const app = createApp(App);
app.provide(Theme, 'светлая');
const root = document.createElement('div');
app.mount(root);

const proto = Object.getPrototypeOf;
console.log('Card пишет:', root.querySelector('p')!.textContent);
console.log('Header === App:', objs.Header === objs.App);
console.log('proto(Board) === App:', proto(objs.Board) === objs.App);
console.log('Card === Board:', objs.Card === objs.Board);
console.log('proto(App) === app:', proto(objs.App) === app._context.provides);
console.log('своё у Board:', Object.hasOwn(objs.Board, Theme), '· у App:', Object.hasOwn(objs.App, Theme));`;

export const VUE_CHAIN_OUT = [
  'Board видит: светлая',
  'Card пишет: тёмная',
  'Header === App: true',
  'proto(Board) === App: true',
  'Card === Board: true',
  'proto(App) === app: true',
  'своё у Board: true · у App: false',
];

/** Исходник Vue 3.5.42 (`runtime-core`), сокращён до сути. Тест проверяет, что эти строки в нём есть. */
export const VUE_SOURCE_CODE = `// создание экземпляра компонента
provides: parent ? parent.provides : Object.create(appContext.provides),

function provide(key, value) {
  let provides = currentInstance.provides;
  const parentProvides = currentInstance.parent && currentInstance.parent.provides;
  if (parentProvides === provides) {
    provides = currentInstance.provides = Object.create(parentProvides);
  }
  provides[key] = value;
}

function inject(key, defaultValue, treatDefaultAsFactory = false) {
  const instance = getCurrentInstance();
  let provides = instance.parent == null
    ? instance.vnode.appContext && instance.vnode.appContext.provides
    : instance.parent.provides;
  if (provides && key in provides) {
    return provides[key];
  } else if (arguments.length > 1) {
    return treatDefaultAsFactory && isFunction(defaultValue)
      ? defaultValue.call(instance && instance.proxy) : defaultValue;
  } else {
    warn(\`injection "\${String(key)}" not found.\`);
  }
}`;

export const VUE_STEPS = [
  {
    k: 'Ссылка вместо копии',
    d: 'Новый компонент берёт **тот же объект**, что у родителя, — `parent.provides`. Пока он сам ничего не провайдит, отдельного объекта у него нет: у `Header` и `App` он один.',
  },
  {
    k: 'Копия при первой записи',
    d: 'Первый `provide()` замечает, что объект общий с родителем, и заводит свой: `Object.create(parentProvides)`. Прототип нового объекта — родительский объект, поэтому всё родительское видно сквозь него.',
  },
  {
    k: 'Поиск — это оператор `in`',
    d: '`key in provides` идёт по цепочке прототипов, а `provides[key]` читает первое найденное. Отдельного обхода дерева во Vue нет: обход делает движок JS, а дерево компонентов отражено в цепочке объектов.',
  },
  {
    k: 'Читается объект родителя',
    d: '`inject` смотрит в `instance.parent.provides`. Поэтому `Board` после своего `provide` видит родительское «светлая»: своё значение — для детей, а не для себя.',
  },
];

export const VUE_DEFAULTS_CODE = `import { createApp, h, inject, provide } from 'vue';

const Child = {
  setup() {
    console.log(inject('lang', 'ru'));            // нигде нет — запасное значение
    console.log(inject('user', 'гость'));         // провайдено undefined — оно и придёт
    const make = () => ({ items: [] as string[] });
    console.log(inject('cart', make, true));      // третий аргумент: это фабрика
    console.log(typeof inject('cart', make));     // без него — сама функция
    console.log(inject('missing'));               // undefined и предупреждение в dev
    return () => null;
  },
};

createApp({
  setup() {
    provide('user', undefined);
    return () => h(Child);
  },
}).mount(document.createElement('div'));`;

export const VUE_DEFAULTS_OUT = ['ru', 'undefined', '{ items: [] }', 'function', 'undefined'];

export const VUE_DEFAULTS_WARN = '[Vue warn]: injection "missing" not found.';

export const VUE_DEFAULTS_NOTE =
  'Запасное значение срабатывает только когда ключа **нет в цепочке**, а не когда пришло `undefined`: проверка — `key in provides`, а не сравнение значения. Без второго аргумента Vue не бросает ошибку — `inject` вернёт `undefined`, а предупреждение будет только в сборке для разработки. Функцию во втором аргументе Vue считает значением; чтобы он её вызвал, нужен третий аргумент `true`.';

export const VUE_REACTIVE_CODE = `import { createApp, h, inject, nextTick, provide, readonly, ref, type InjectionKey, type Ref } from 'vue';

const CountKey: InjectionKey<Readonly<Ref<number>>> = Symbol('count');
const count = ref(0);

const Badge = {
  setup() {
    const snapshot = inject<number>('count-value')!;   // число, снятое в момент provide
    const live = inject(CountKey)!;                     // сам ref: читается при рендере
    return () => h('b', \`\${snapshot} / \${live.value}\`);
  },
};
const App = {
  setup() {
    provide('count-value', count.value);
    provide(CountKey, readonly(count));                 // детям — только чтение
    return () => h(Badge);
  },
};

const root = document.createElement('div');
createApp(App).mount(root);
count.value = 5;
await nextTick();
console.log(root.innerHTML);`;

export const VUE_REACTIVE_OUT = ['<b>0 / 5</b>'];

export const VUE_REACTIVE_NOTE =
  '`provide` ничего не оборачивает и ни на что не подписывает: в объект `provides` кладётся ровно то, что передали. Число — это снимок, ref — живая ссылка. Реактивность появляется не от `inject`, а оттого, что рендер ребёнка читает `live.value`. `readonly` оставляет детям чтение, а менять значение — тому, кто провайдит: обычно рядом кладут и функцию изменения. Коротко то же — в [«Реактивности Vue», раздел «Ловушки»](/frameworks/vue-reactivity/#s4).';

export const VUE_APP_FACTS = [
  {
    t: '`app.provide` — для всего приложения',
    d: 'Пишет прямо в `appContext.provides` — в тот объект, который стоит в самом конце каждой цепочки. Так подключаются плагины: Pinia вызывает `app.provide(piniaSymbol, pinia)`, а `useStore()` достаёт её через `inject(piniaSymbol)`.',
  },
  {
    t: '`inject` вне `setup`',
    d: 'Без текущего компонента искать не от кого. `app.runWithContext(fn)` подставляет приложение на время вызова — `inject` внутри читает `app.provide`. Так Pinia создаёт сторы: функция стора выполняется в `runWithContext`, и `inject` в ней работает. Проверить заранее, получится ли, — `hasInjectionContext()`.',
  },
  {
    t: 'Ключ — лучше символ',
    d: 'Строковый ключ `\'theme\'` может совпасть с чужим, и тогда ближний провайдер молча перекроет дальний. `Symbol(\'theme\')` уникален, а `InjectionKey<T>` — это символ с типом значения: `inject(Theme)` сразу знает, что вернёт `string | undefined`.',
  },
];

// ─── Раздел 3. React: контекст ────────────────────────────────────────────────────────────

export const REACT_USE_CODE = `import { createContext, use, useContext } from 'react';
import { renderToString } from 'react-dom/server';

const Theme = createContext('системная');

function Badge({ show }: { show: boolean }) {
  if (!show) return null;            // ранний выход до чтения контекста
  const theme = use(Theme);          // use можно звать и после условия
  return <b>{theme}</b>;
}

function Panel() {
  const outer = useContext(Theme);   // свой провайдер ниже — Panel его не видит
  return (
    <Theme value="тёмная">
      <i>{outer}</i>
      <Badge show />
    </Theme>
  );
}

console.log(renderToString(<><Panel /><Badge show /></>));`;

export const REACT_USE_OUT = ['<i>системная</i><b>тёмная</b><b>системная</b>'];

export const REACT_NOTE =
  'Правило поиска то же, что во Vue: ближайший провайдер **выше** компонента, а если его нет — значение из `createContext`. `Panel` выводит `<Theme value>`, значит провайдер стоит ниже `Panel`, и сам `Panel` видит значение по умолчанию. В React 19 `<Theme value>` и `<Theme.Provider value>` — одно и то же: `Provider` указывает на сам объект контекста.';

export const REACT_FACTS = [
  {
    t: 'Смена значения будит всех читателей',
    d: 'React сравнивает новое `value` провайдера со старым через `Object.is`. Новый объект `{ user, setUser }` на каждом рендере — значит, «изменилось» всё, и каждый читатель вызывается снова, даже под `memo` и даже если читает одно поле. Лечат мемоизацией `value` (`useMemo`) и разбиением на несколько контекстов. Как именно React находит читателей мимо `memo` — [«Ре-рендеринг в React», раздел «Дерево»](/frameworks/react-rerender/#s2) и своими руками в [«React изнутри: хуки и контекст», раздел «Контекст»](/frameworks/react-hooks-internals/#s5).',
    tone: 'warn' as const,
  },
  {
    t: '`use(Context)` — то же чтение, другие правила',
    d: '`useContext` — хук: его нельзя звать после раннего `return`, в условии или цикле. `use` из React 19 читает контекст так же, но эти запреты на него не действуют — он годится и после проверки, как в `Badge`. Зовут его, как и хуки, только во время рендера.',
  },
  {
    t: 'Стор через контекст — это DI',
    d: 'Провайдеры библиотек состояния обычно кладут в контекст **сам стор** — объект, который после создания не меняется, поэтому контекст никого не будит. Об изменениях компонент узнаёт мимо контекста, через подписку на стор, — как это устроено, разобрано в [«Стейт-менеджерах изнутри»](/frameworks/state-managers/#s1).',
  },
];

// ─── Раздел 4. Angular: иерархия инжекторов ───────────────────────────────────────────────

export const PLAIN_INJECTORS =
  'Как склады в торговой сети. В каждом магазине есть маленькая подсобка, у района — склад побольше, у сети — центральный. Продавец сначала идёт в свою подсобку, потом в подсобку соседнего отдела по коридору, и только потом звонит на районный склад. Если и на центральном нет — товара нет вообще.';

export const INJECTOR_ROWS = [
  {
    k: '`NullInjector`',
    what: 'Конец цепочки. Ничего не хранит: на любой запрос бросает `NG0201` или отдаёт `null`, если запрос был с `optional`.',
  },
  {
    k: 'платформенный',
    what: 'Один на страницу, общий для всех приложений Angular на ней. Своему коду он почти не нужен.',
  },
  {
    k: '`EnvironmentInjector` корня',
    what: 'Инжектор приложения с областью `root`: провайдеры из `bootstrapApplication(App, { providers })` и все классы с `providedIn: \'root\'`. Дочерние окружения появляются у ленивых маршрутов и у `createEnvironmentInjector`.',
  },
  {
    k: '`ElementInjector`',
    what: 'Свой у каждого элемента, на котором стоит компонент или директива. Родитель — инжектор элемента, внутри которого компонент стоит в шаблоне. Цепочка элементов кончается у корневого компонента, дальше поиск уходит в окружение.',
  },
];

export const INJECTOR_NOTE =
  'Поиск идёт в два этапа. Сначала вверх по дереву элементов — от того, кто просит, к корневому компоненту. Потом, если не нашлось, в окружение, к которому подключено приложение, и дальше по его родителям до `NullInjector`. Чтобы не опрашивать каждый элемент, `NodeInjector` держит у элемента блум-фильтр на 256 бит: по номеру токена сразу видно, что у этого элемента его точно нет, и элемент пропускается без поиска по списку.';

export const PROVIDED_IN_FACTS = [
  {
    t: 'Лениво и один раз на инжектор',
    d: 'Запись провайдера сначала помечена «ещё не создан» (`NOT_YET`). Экземпляр появляется при первом запросе и дальше отдаётся тот же. Никто не попросил — конструктор не вызывался ни разу.',
  },
  {
    t: '`providedIn: \'root\'` живёт в корне',
    d: 'Запись такого класса заводит инжектор с областью `root` — даже если спросили из дочернего окружения или из компонента. И **зависимости** класса ищутся от корня: сервис с `inject(THEME)` получит корневую тему, а не тему компонента, который его попросил.',
    tone: 'warn' as const,
  },
  {
    t: 'Провайдер в компоненте — экземпляр на компонент',
    d: '`providers: [Store]` у карточки — свой `Store` у каждой карточки на странице. Все потомки карточки видят именно его. Уничтожается он вместе с компонентом.',
  },
  {
    t: 'Почему «tree-shakable»',
    d: 'При `providers: [Logger]` в настройке приложения ссылка идёт от приложения к классу, и сборщик обязан его оставить. При `providedIn: \'root\'` ссылка обратная: класс сам знает, где ему жить, а приложение о нём молчит. Класс, который никто не `inject`-ит, ни из чего не достижим, и сборщик его выбрасывает ([«Модули и сборка», раздел «Tree shaking»](/tooling/modules/#s4)).',
  },
];

// ─── Раздел 5. Провайдеры, токены и флаги ─────────────────────────────────────────────────

export const TOKENS_CODE = `import { Injector, InjectionToken, inject } from '@angular/core';

export class Logger {
  log(m: string) { return 'консоль: ' + m; }
}
export class FileLogger extends Logger {
  log(m: string) { return 'файл: ' + m; }
}

export const API_URL = new InjectionToken<string>('API_URL');
export const PRICES_URL = new InjectionToken<string>('PRICES_URL');
export const AUDIT = new InjectionToken<Logger>('AUDIT');
export const PLUGINS = new InjectionToken<string[]>('PLUGINS');

const injector = Injector.create({
  providers: [
    { provide: API_URL, useValue: 'https://shop.example/api' },
    { provide: Logger, useClass: FileLogger },          // просят Logger — получают FileLogger
    { provide: AUDIT, useExisting: Logger },            // второе имя того же экземпляра
    { provide: PRICES_URL, useFactory: () => inject(API_URL) + '/prices' },
    { provide: PLUGINS, useValue: 'поиск', multi: true },
    { provide: PLUGINS, useValue: 'экспорт', multi: true },
  ],
});

console.log(injector.get(Logger).log('старт'));
console.log(injector.get(AUDIT) === injector.get(Logger));
console.log(injector.get(PRICES_URL));
console.log(injector.get(PLUGINS));`;

export const TOKENS_OUT = ['файл: старт', 'true', 'https://shop.example/api/prices', "[ 'поиск', 'экспорт' ]"];

export const PROVIDER_ROWS = [
  { k: '`useValue`', what: 'Готовое значение, как есть. Создавать нечего.', note: 'настройки, адреса, подделка в тесте' },
  { k: '`useClass`', what: 'Новый экземпляр указанного класса — свой у каждого инжектора с этим провайдером. Запись `providers: [Store]` — короткая форма `{ provide: Store, useClass: Store }`.', note: 'другая реализация того же токена' },
  { k: '`useFactory`', what: 'Результат функции. Внутри работает `inject()`, а старый способ — массив `deps`.', note: 'значение, которое нужно вычислить' },
  { k: '`useExisting`', what: 'Ничего не создаёт: запрашивает другой токен и отдаёт **тот же** экземпляр. Отличие от `useClass` с тем же классом — там был бы второй объект.', note: 'второе имя, узкий интерфейс' },
  { k: '`multi: true`', what: 'Все провайдеры токена с этим флагом **в одном инжекторе** собираются в массив. Смешать в одном инжекторе `multi` и обычный провайдер нельзя — ошибка.', note: 'плагины, перехватчики, валидаторы' },
];

export const TOKEN_NOTE =
  '`InjectionToken` нужен там, где у значения нет класса: строка, число, массив, интерфейс. Интерфейс TypeScript после сборки исчезает, и просить по нему нечем, поэтому токен — отдельный объект, а `<string>` в угловых скобках — только подсказка для типов. Описание `\'API_URL\'` попадает в тексты ошибок. Токен с фабрикой `new InjectionToken(\'X\', { factory: () => … })` работает без всякого провайдера: если `providedIn` не указан, Angular считает его `\'root\'`.';

export const MULTI_NOTE =
  '`multi` не складывает уровни. Если компонент провайдит в `PLUGINS` своё «график», его потомки получат `[\'график\']`, а не три плагина: поиск остановился на первом инжекторе, где нашлась запись.';

export const MENU_CODE = `import { Component, Injectable, Optional, Self, SkipSelf, inject } from '@angular/core';
import { createApplication } from '@angular/platform-browser';

@Injectable()
export class MenuState {
  level = 0;
}

@Component({
  selector: 'app-menu',
  template: '<ng-content />',
  providers: [MenuState],                 // у каждого меню — своё состояние
})
export class Menu {
  private parent = inject(MenuState, { skipSelf: true, optional: true });
  private state = inject(MenuState, { self: true });
  constructor() {
    this.state.level = this.parent ? this.parent.level + 1 : 0;
    console.log('меню уровня', this.state.level);
  }
}

// То же через декораторы параметров — так писали до inject()
@Component({ selector: 'app-old-menu', template: '<ng-content />', providers: [MenuState] })
export class OldMenu {
  constructor(@Optional() @SkipSelf() parent: MenuState, @Self() state: MenuState) {
    state.level = parent ? parent.level + 1 : 0;
    console.log('старое меню уровня', state.level);
  }
}

@Component({
  selector: 'app-root',
  imports: [Menu, OldMenu],
  template: \`
    <app-menu><app-menu><app-menu /></app-menu></app-menu>
    <app-old-menu><app-old-menu /></app-old-menu>
  \`,
})
export class App {}

const app = await createApplication();
document.body.append(document.createElement('app-root'));
app.bootstrap(App);`;

export const MENU_OUT = ['меню уровня 0', 'меню уровня 1', 'меню уровня 2', 'старое меню уровня 0', 'старое меню уровня 1'];

export const FLAG_ROWS = [
  {
    k: '`optional: true`',
    old: '`@Optional()`',
    what: 'Не нашёл — `null` вместо ошибки `NG0201`.',
  },
  {
    k: '`self: true`',
    old: '`@Self()`',
    what: 'Искать только в собственном инжекторе того, кто просит. Ни родителей, ни окружения.',
  },
  {
    k: '`skipSelf: true`',
    old: '`@SkipSelf()`',
    what: 'Начать с родителя. Свой провайдер пропускается — так вложенное меню находит внешнее.',
  },
  {
    k: '`host: true`',
    old: '`@Host()`',
    what: 'Не выходить за компонент, в чьём шаблоне стоит запрашивающий. У этого компонента видны **только** `viewProviders`, его обычные `providers` — нет. Окружение не спрашивается вовсе.',
  },
];

export const FLAGS_NOTE =
  'Флаги складываются: `{ skipSelf: true, optional: true }` — «родительское, если оно есть». `self` вместе со `skipSelf` не найдёт ничего никогда. Флаги действуют только в дереве элементов: в окружение поиск уходит с одним `optional`, остальное там уже ни на что не влияет. Если запрос был с `self` или `host`, в окружение он не уходит вовсе.';

export const VIEW_PROVIDERS_NOTE =
  '`viewProviders` видят сам компонент и компоненты из **его шаблона**. Отличие от `providers` заметно в двух местах: содержимое, которое вставили через `<ng-content>`, их не видит, а флаг `host` видит только их. Если у компонента один и тот же токен есть в обоих списках, для детей из шаблона побеждает `viewProviders`.';

// ─── Раздел 6. Своими руками ──────────────────────────────────────────────────────────────

export const ANGULAR_DI_CODE = `const NOT_YET = Symbol('не создан');
const CIRCULAR = Symbol('создаётся');

// Таблица одного инжектора: токен → запись. Экземпляр появится при первом запросе.
function collect(providers = []) {
  const records = new Map();
  for (const p of providers) {
    const provider = typeof p === 'string' ? { provide: p, useClass: p } : p;
    if (provider.multi) {
      const r = records.get(provider.provide) ?? { multi: [], value: NOT_YET };
      r.multi.push(provider);
      records.set(provider.provide, r);
    } else {
      // У useValue создавать нечего: значение лежит в записи сразу.
      const value = 'useValue' in provider ? provider.useValue : NOT_YET;
      records.set(provider.provide, { provider, value });
    }
  }
  return records;
}

// Инжекторы окружения и по инжектору на каждый компонент дерева.
function createInjectors(spec) {
  return {
    classes: spec.classes,
    env: new Map(spec.env.map((e) => [e.id, { ...e, records: collect(e.providers) }])),
    nodes: new Map(spec.components.map((c) => [c.id,
      { ...c, records: collect(c.providers), view: collect(c.viewProviders) }])),
    counters: {},
  };
}

// inject(token, flags) в конструкторе компонента: from = { node: 'CardA' }.
// injector.get(token, …, flags) у окружения: from = { env: 'root' }.
function resolve(di, from, token, flags = {}, trace = [], path = []) {
  const log = (at, step) => trace.push({ at, token, step, depth: path.length });
  const notFound = () => {
    if (flags.optional) { log('—', 'null'); return null; }
    throw diError('NG0201', 'No provider found for \`' + token + '\`', [...path, token]);
  };

  if (from.node) {
    let node = di.nodes.get(from.node);
    const host = node.parent;            // компонент, в чьём шаблоне объявлен этот
    let own = true;
    if (flags.skipSelf) {
      log(node.id, 'skip');
      node = flags.self ? undefined : di.nodes.get(node.parent);
      own = false;
    }
    while (node) {
      const atHost = flags.host && node.id === host;
      // viewProviders видны детям из шаблона и самому компоненту;
      // на хосте при флаге host видны ТОЛЬКО они.
      const seeView = own ? from.ownView !== false : true;
      const record = (seeView && node.view.get(token)) || (!atHost && node.records.get(token));
      if (record) {
        log(node.id, stepOf(record));
        const at = { node: node.id, ownView: record === node.view.get(token) };
        return hydrate(di, record, token, at, path, trace);
      }
      log(node.id, atHost ? 'host-miss' : 'miss');
      if (flags.self || atHost) break;
      node = di.nodes.get(node.parent);
      own = false;
    }
    // self и host не выпускают поиск из дерева компонентов.
    if (flags.self || flags.host) return notFound();
    // Окружению уходит только optional — остальные флаги остались в дереве.
    const env = rootOf(di, from.node).env;
    return resolve(di, { env }, token, { optional: flags.optional }, trace, path);
  }

  let inj = di.env.get(from.env);
  let skip = Boolean(flags.skipSelf);
  while (inj) {
    if (skip) {
      log(inj.id, 'skip');
    } else {
      let record = inj.records.get(token);
      // providedIn: 'root' — запись заводит инжектор с областью root, а не тот, кого спросили.
      if (!record && inj.root && di.classes[token]?.providedIn === 'root') {
        record = { provider: { provide: token, useClass: token }, value: NOT_YET };
        inj.records.set(token, record);
      }
      if (record) {
        log(inj.id, stepOf(record));
        return hydrate(di, record, token, { env: inj.id }, path, trace);
      }
      log(inj.id, 'miss');
    }
    if (flags.self) break;
    skip = false;
    inj = di.env.get(inj.parent);
  }
  log('NullInjector', 'miss');
  return notFound();
}

// Один экземпляр на запись — значит, на инжектор. CIRCULAR ловит цикл.
function hydrate(di, record, token, at, path, trace) {
  if (record.value === CIRCULAR) {
    throw diError('NG0200', 'Circular dependency detected for \`' + token + '\`', [...path, token]);
  }
  if (record.value !== NOT_YET) return record.value;
  record.value = CIRCULAR;
  const next = [...path, token];
  try {
    record.value = record.multi
      ? record.multi.map((p) => make(di, p, at, next, trace))
      : make(di, record.provider, at, next, trace);
  } catch (e) {
    if (at.node) record.value = NOT_YET;   // окружение метку не снимает — см. «Ошибки»
    throw e;
  }
  return record.value;
}

// Зависимости провайдера ищутся от инжектора, где он записан, а не от того, кто попросил.
function make(di, provider, at, path, trace) {
  const dep = (token) => resolve(di, at, token, {}, trace, path);
  if ('useValue' in provider) return provider.useValue;
  if (provider.useExisting) return dep(provider.useExisting);
  if (provider.useFactory) return provider.useFactory(...(provider.deps ?? []).map(dep));
  const cls = provider.useClass;
  const deps = (di.classes[cls]?.deps ?? []).map(dep);
  di.counters[cls] = (di.counters[cls] ?? 0) + 1;
  return { label: cls + '#' + di.counters[cls], deps };
}

function stepOf(record) {
  return record.value === NOT_YET ? 'create' : record.value === CIRCULAR ? 'cycle' : 'hit';
}

function rootOf(di, id) {
  let node = di.nodes.get(id);
  while (node.parent) node = di.nodes.get(node.parent);
  return node;
}

function diError(code, text, path) {
  const e = new Error(code + ': ' + text + '. Path: ' + path.join(' -> ') + '.');
  e.code = code;
  e.path = path;
  return e;
}`;

export const MINI_STEPS = [
  {
    k: 'Запись, а не объект',
    d: '`collect` превращает список провайдеров в таблицу «токен → запись». В записи лежит рецепт и метка `NOT_YET`; только у `useValue` значение готово сразу. Пока никто не попросил, ничего не создаётся.',
  },
  {
    k: 'Дорога вверх',
    d: '`resolve` идёт от компонента к корню дерева, потом по окружениям. Флаги меняют только три вещи: откуда начать (`skipSelf`), где остановиться (`self`, `host`) и что вернуть вместо ошибки (`optional`).',
  },
  {
    k: 'Один на инжектор',
    d: '`hydrate` создаёт значение один раз и кладёт в ту же запись. Второй запрос — к той же записи, значит, тот же объект. Разные карточки — разные инжекторы, разные записи, разные экземпляры.',
  },
  {
    k: 'Цикл — метка на записи',
    d: 'На время создания запись помечена `CIRCULAR`. Если создание `A` попросило `B`, а `B` — снова `A`, второй заход видит метку и бросает `NG0200` с путём `A -> B -> A`.',
  },
];

export const MINI_NOTE =
  'Учебная версия проще настоящей: в ней нет директив, `<ng-content>`, встроенных представлений `@if` и `@for` и платформенного инжектора, а токены — строки. На деревьях из одних компонентов тест темы гоняет её рядом с Angular 21 на наборе сценариев: все флаги, `multi`, четыре вида провайдеров, дочернее окружение, цикл в окружении и в компоненте. Значения, номера экземпляров и коды ошибок совпадают.';

export const VUE_PROVIDE_CODE = `// Vue 3.5: provides — обычный объект, а родитель — его прототип.
function createVueApp(spec, make) {
  const owner = new Map();               // объект provides → чей он (для показа пути)
  const app = Object.create(null);       // appContext.provides: сюда пишет app.provide
  owner.set(app, 'app');
  for (const e of spec.appProvides) app[e.key] = make(e.value);

  const provides = new Map();            // компонент → его instance.provides
  function setup(c) {
    const parent = c.parent ? provides.get(c.parent) : null;
    // Корень получает Object.create(app), остальные — ссылку на объект родителя.
    let own = parent ?? Object.create(app);
    if (!parent) owner.set(own, c.id);
    for (const e of c.provides) {
      // provide(): при первой записи — свой объект с прототипом родителя.
      if (own === parent) {
        own = Object.create(parent);
        owner.set(own, c.id);
      }
      own[e.key] = make(e.value);
    }
    provides.set(c.id, own);
  }
  return { app, owner, provides, setup };
}

// inject(key, fallback) ищет в provides РОДИТЕЛЯ — свои provide компонент не видит.
function inject(vue, spec, id, key, fallback) {
  const c = spec.components.find((x) => x.id === id);
  const start = c.parent ? vue.provides.get(c.parent) : vue.app;
  const trace = [];
  // Так ищет оператор in: своё свойство, потом прототип, потом его прототип.
  for (let o = start; o; o = Object.getPrototypeOf(o)) {
    const hit = Object.hasOwn(o, key);
    trace.push({ at: vue.owner.get(o), step: hit ? 'hit' : 'miss' });
    if (hit) break;
  }
  if (key in start) return { value: start[key], trace };
  if (fallback) return { value: fallback.value, trace, fallback: true };
  return { value: undefined, trace, warn: 'injection "' + key + '" not found.' };
}`;

export const REACT_CONTEXT_CODE = `// React 19: ближайший <Ctx value> выше по дереву, иначе значение из createContext.
// Свой <Ctx value> компонент не видит: тот стоит в его выводе, то есть ниже.
function readContext(tree, id, key) {
  const trace = [];
  for (let at = tree.parent.get(id); at; at = tree.parent.get(at)) {
    const own = tree.values.get(at);
    if (own.has(key)) {
      trace.push({ at, step: 'hit' });
      return { value: own.get(key), trace };
    }
    trace.push({ at, step: 'miss' });
  }
  if (tree.top.has(key)) {
    trace.push({ at: 'над корнем', step: 'hit' });
    return { value: tree.top.get(key), trace };
  }
  trace.push({ at: 'createContext', step: 'default' });
  return { value: tree.defaults[key], trace };
}`;

export const REACT_MINI_NOTE =
  'Сам React не ходит вверх по дереву: он держит стек значений и подменяет значение контекста на время обхода поддерева провайдера ([«React изнутри: хуки и контекст», раздел «Контекст»](/frameworks/react-hooks-internals/#s5)). Ответ на вопрос «что прочитает этот компонент» у стека и у подъёма по дереву один и тот же; подъём проще показать.';

/** Дерево демо. Тот же объект тест отдаёт настоящим Angular, Vue и React. */
export const DEMO_SPEC: DiSpec = {
  classes: {
    Logger: { providedIn: 'root' },
    Api: { providedIn: 'root', deps: ['THEME'] },
    Auth: { providedIn: 'root', deps: ['Session'] },
    Session: { providedIn: 'root', deps: ['Auth'] },
    Store: {},
  },
  env: [
    {
      id: 'root',
      parent: null,
      root: true,
      providers: [
        { provide: 'THEME', useValue: 'светлая' },
        { provide: 'PLUGINS', useValue: 'поиск', multi: true },
        { provide: 'PLUGINS', useValue: 'экспорт', multi: true },
      ],
    },
  ],
  components: [
    { id: 'App', parent: null, env: 'root', providers: ['Store'] },
    { id: 'Header', parent: 'App' },
    { id: 'Board', parent: 'App', providers: [{ provide: 'PLUGINS', useValue: 'график', multi: true }], viewProviders: [{ provide: 'THEME', useValue: 'тёмная' }] },
    { id: 'Menu', parent: 'Header' },
    { id: 'CardA', parent: 'Board', providers: ['Store'] },
    { id: 'CardB', parent: 'Board', providers: ['Store'] },
  ],
};

/** Значения `createContext(…)` в React-режиме демо. */
export const DEMO_DEFAULTS: Record<string, unknown> = {
  Store: null,
  Logger: null,
  Api: null,
  THEME: 'системная',
  PLUGINS: [],
};

export const DEMO_TOKENS: DemoToken[] = [
  {
    id: 'Store',
    note: 'Класс без `providedIn`. Его провайдят `App` и каждая карточка: `providers: [Store]`.',
    plainNote: '`App` и каждая карточка провайдят свой экземпляр `Store`.',
    plain: true,
  },
  {
    id: 'Logger',
    note: '`@Injectable({ providedIn: \'root\' })` — один на приложение, создаётся при первом запросе.',
    plainNote: 'Один на приложение: во Vue — `app.provide`, в React — провайдер над корнем. Создан заранее, а не по запросу.',
    plain: true,
  },
  {
    id: 'Api',
    note: '`providedIn: \'root\'`, а внутри — `inject(THEME)`. Зависимость ищется от корня, а не от того, кто попросил `Api`.',
    plainNote: 'Тоже на уровне приложения. Своих зависимостей у значения здесь нет: экземпляр создаёт тот, кто провайдит.',
    plain: true,
  },
  {
    id: 'THEME',
    note: '`InjectionToken`: в окружении «светлая», у `Board` в `viewProviders` — «тёмная».',
    plainNote: 'Приложение даёт «светлая», `Board` провайдит «тёмная».',
    plain: true,
  },
  {
    id: 'PLUGINS',
    note: '`multi`: окружение даёт «поиск» и «экспорт», `Board` в `providers` — «график».',
    plainNote: 'Массив: приложение даёт «поиск» и «экспорт», `Board` — свой массив из одного «графика».',
    plain: true,
  },
  { id: 'Auth', note: '`Auth` просит `Session`, а `Session` — `Auth`. Обе `providedIn: \'root\'`.', plain: false },
];

export const DEMO_TREE_CODE = `// Окружение: THEME = 'светлая', PLUGINS = ['поиск', 'экспорт'],
//            providedIn: 'root' — Logger, Api (просит THEME), Auth ⇄ Session
App      providers: [Store]
├ Header
│ └ Menu
└ Board  providers: [PLUGINS 'график' (multi)], viewProviders: [THEME 'тёмная']
  ├ CardA  providers: [Store]
  └ CardB  providers: [Store]`;

export const DEMO_CAPTION =
  'Выберите, кто просит, что и с какими флагами. Путь считают функции этого раздела — `resolve`, `inject` и `readContext`, и тест сверяет их с Angular 21, Vue 3.5 и React 19 на этом же дереве. Экземпляры живут между запросами: спросите `Store` у одной карточки дважды — второй раз он «уже создан». Сравните одну и ту же пару «кто — что» в трёх режимах: `Board`, спросивший `THEME`, в Angular видит свою «тёмную», а во Vue и React — родительскую «светлую».';

// ─── Раздел 7. Ошибки ─────────────────────────────────────────────────────────────────────

export const CYCLE_CODE = `import { Injectable, InjectionToken, inject } from '@angular/core';
import { createApplication } from '@angular/platform-browser';

@Injectable({ providedIn: 'root' })
export class Auth { private session = inject(Session); }

@Injectable({ providedIn: 'root' })
export class Session { private auth = inject(Auth); }

export const REPORT_CONFIG = new InjectionToken<string>('REPORT_CONFIG');

@Injectable({ providedIn: 'root' })
export class Report { private config = inject(REPORT_CONFIG); }   // провайдера нет

const app = await createApplication();
for (const token of [Auth, Report, Report]) {
  try {
    app.injector.get(token);
  } catch (e) {
    console.log((e as Error).message);
  }
}`;

export const CYCLE_OUT = [
  'NG0200: Circular dependency detected for `Auth`. Source: Environment Injector. Path: Auth -> Session -> Auth. Find more at https://v21.angular.dev/errors/NG0200',
  'NG0201: No provider found for `InjectionToken REPORT_CONFIG`. Source: Environment Injector. Path: Report -> InjectionToken REPORT_CONFIG. Find more at https://v21.angular.dev/errors/NG0201',
  'NG0200: Circular dependency detected for `Report`. Source: Environment Injector. Find more at https://v21.angular.dev/errors/NG0200',
];

export const CYCLE_NOTE =
  'Третья строка — не опечатка. `Report` упал в первый раз из-за отсутствующего `REPORT_CONFIG`, а во второй раз Angular говорит уже о **цикле**, которого нет. Инжектор окружения ставит на запись метку «создаётся» и при ошибке её не снимает: следующий запрос видит метку и считает, что зашёл в цикл. Чинить надо первую ошибку, а не искать цикл. `ElementInjector` метку снимает, и там повтор даёт ту же `NG0201`.';

export const ERROR_ROWS = [
  {
    k: '`NG0200`',
    when: 'Создание токена снова попросило этот же токен. Путь печатается в режиме разработки.',
    fix: 'Разорвать цикл: вынести общее в третий сервис или просить зависимость лениво — `injector.get()` в методе, а не `inject()` в поле.',
  },
  {
    k: '`NG0201`',
    when: 'Поиск дошёл до конца и не нашёл провайдера. Запрос из компонента без флагов называет источником окружение (`Source: Environment Injector`): последним его спрашивало именно оно.',
    fix: 'Добавить провайдер, `providedIn` или `optional`. С `self`/`host` текст другой: `…found in NodeInjector`.',
  },
  {
    k: '`NG0203`',
    when: '`inject()` вызван вне контекста внедрения: в методе, в `setTimeout`, после `await`.',
    fix: 'Звать в поле класса, конструкторе, фабрике провайдера или внутри `runInInjectionContext(injector, fn)`.',
  },
];

export const NG0203_TEXT =
  'NG0203: The `Logger` token injection failed. `inject()` function must be called from an injection context such as a constructor, a factory function, a field initializer, or a function used with `runInInjectionContext`. Find more at https://v21.angular.dev/errors/NG0203';

export const PROD_ERRORS = ['NG0200', 'NG0201'];

export const PROD_NOTE =
  'В продакшен-сборке от этих сообщений остаются только коды: `e.message` равен `\'NG0200\'` — без имени токена и без пути. Все тексты ошибок живут под проверкой `ngDevMode` и вырезаются сборкой. Поэтому цикл ищут в режиме разработки, а в логах продакшена по коду понятно только, что за беда, но не где она.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Во Vue и React компонент не видит своё',
    d: '`provide` во Vue и `<Ctx value>` в React — для потомков. Сам компонент читает родительское значение, даже если вызвал `inject` после своего `provide`. В Angular наоборот: конструктор компонента видит и свои `providers`, и свои `viewProviders`.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Зависимости `providedIn: \'root\'` ищутся от корня',
    d: 'Сервис в корне, который просит `THEME`, получит корневую тему, даже если его попросила карточка с собственной `THEME`. Нужна тема компонента — провайдите сервис в компоненте или передайте тему аргументом метода.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`multi` не собирает уровни',
    d: 'Ближайший инжектор с записью отдаёт только свои элементы. Плагин, добавленный в компоненте, скрывает плагины корня от всего поддерева, а не дополняет их.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`host` не видит `providers` хоста',
    d: 'С флагом `host` у компонента-хоста ищутся только `viewProviders`. Сервис из его обычных `providers` не найдётся, хотя он стоит ровно на хосте.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`NG0200` после `NG0201`',
    d: 'Ошибка при создании сервиса в окружении оставляет на записи метку «создаётся», и следующий запрос того же токена сообщает о цикле. Смотрите на первую ошибку в консоли, а не на последнюю.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`undefined` — тоже значение',
    d: '`provide(key, undefined)` во Vue перекрывает запасное значение `inject(key, \'гость\')`: проверяется наличие ключа, а не значение. В React `<Ctx value={undefined}>` точно так же перекрывает значение из `createContext`.',
  },
  {
    n: '07',
    t: 'Число в `provide` — это снимок',
    d: '`provide(\'count\', count.value)` отдаст детям число на момент `setup`. Передавайте сам `ref` (лучше `readonly`) и функцию изменения рядом.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'Новый объект в `value` будит всех',
    d: '`<Ctx value={{ user, setUser }}>` создаёт объект на каждом рендере, и по `Object.is` он всегда новый. Все читатели вызываются заново, `memo` не спасает. `useMemo` для значения или два контекста: данные отдельно, функции отдельно.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`inject()` после `await`',
    d: 'Контекст внедрения в Angular и текущий компонент во Vue существуют только синхронно, пока идёт конструктор или `setup`. После `await` их уже нет: Angular бросит `NG0203`, Vue вернёт `undefined` с предупреждением.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Angular — Hierarchical injectors',
    href: 'https://angular.dev/guide/di/hierarchical-dependency-injection',
    what: '`EnvironmentInjector` и `ElementInjector`, порядок поиска, флаги, `viewProviders`',
  },
  {
    title: 'Angular — Dependency providers',
    href: 'https://angular.dev/guide/di/dependency-injection-providers',
    what: '`useClass`, `useValue`, `useFactory`, `useExisting`, `multi`, `InjectionToken`',
  },
  {
    title: 'Angular — Creating an injectable service',
    href: 'https://angular.dev/guide/di/creating-injectable-service',
    what: '`providedIn: \'root\'` и почему такой сервис выбрасывается сборкой, если не используется',
  },
  {
    title: 'Angular — NG0200: Circular dependency in DI',
    href: 'https://angular.dev/errors/NG0200',
    what: 'описание ошибки цикла; рядом — `NG0201` и `NG0203`',
  },
  {
    title: 'Исходник Angular: `r3_injector.ts` и `di.ts`',
    href: 'https://github.com/angular/angular/tree/main/packages/core/src/render3',
    what: '`R3Injector`, `NOT_YET` и `CIRCULAR`, поиск по `NodeInjector` и блум-фильтр; на стенде — сборка 21.2.25 из `node_modules`',
  },
  {
    title: 'Vue — Provide / Inject',
    href: 'https://vuejs.org/guide/components/provide-inject.html',
    what: '`provide`, `inject`, `app.provide`, `InjectionKey`, значения по умолчанию, реактивность',
  },
  {
    title: 'Исходник Vue: `apiInject.ts`',
    href: 'https://github.com/vuejs/core/blob/main/packages/runtime-core/src/apiInject.ts',
    what: '`Object.create(parentProvides)` и `key in provides`; на стенде — 3.5.42',
  },
  {
    title: 'React — `createContext`, `useContext`, `use`',
    href: 'https://react.dev/reference/react/use',
    what: 'чтение контекста после условия; провайдер и значение по умолчанию — на соседних страницах справочника',
  },
];

export const RELATED =
  'Смежное на сайте: [React изнутри: хуки и контекст, раздел «Контекст»](/frameworks/react-hooks-internals/#s5) — стек провайдеров и пометка читателей, собранные своими руками. [Ре-рендеринг в React, раздел «Дерево»](/frameworks/react-rerender/#s2) — почему смена значения провайдера проходит мимо `memo`. [Стейт-менеджеры изнутри](/frameworks/state-managers/) — стор, который раздают через контекст или `app.provide`. [Angular без zone.js](/frameworks/angular-zoneless/) — тот же Angular 21 с другой стороны: кто и когда проверяет шаблоны. [Объектная модель, раздел «Прототипы»](/js/object-model/#s2) — цепочка, по которой ищет `inject` во Vue. [Тест-раннеры изнутри, раздел «Моки и подъём»](/tooling/test-runners/#s3) — подмена модуля там, где DI нет.';
