import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * «Server Components изнутри».
 *
 * Всё, что тема утверждает о формате потока, ошибках, серверных функциях и `cache()`, снято
 * запуском настоящего `react-server-dom-webpack` 19.3.0 (React 19.3.0, Node 26.8.2) и закреплено
 * `tests/unit/server-components.test.ts`:
 *
 *   — серверная половина — в **отдельном процессе** `node --conditions=react-server`: без этого
 *     условия экспорта `react-server-dom-webpack/server` не загружается вовсе, а `react` отдаёт
 *     обычную сборку, а не серверную. Процесс запускается дважды — с `NODE_ENV=production`
 *     и `development`, и сам сообщает, какая сборка загружена (`require.cache`);
 *   — клиентская половина (`/client.browser`, `/client.node`) и `react-dom/server` — в отдельном
 *     обычном процессе, тоже в продакшен-сборке;
 *   — манифест клиентских модулей собран руками (`DEMO_MANIFEST`), настоящей сборки webpack нет.
 *
 * Учебный сериализатор и десериализатор живут здесь строками (`FLIGHT_SERVER_CODE`,
 * `FLIGHT_CLIENT_CODE`): страница печатает их, демо исполняет их в браузере, тест — их же.
 * На всех 48 сочетаниях переключателей демо учебный поток совпадает с настоящим **байт в байт
 * и кусок в кусок**, а учебный клиент собирает то же дерево, что настоящий, после каждого куска.
 * Где форматы честно различаются, различие записано в `MINI_VS_REAL`, и тест держит обе стороны.
 *
 * ⚠️ Не проверено запуском — и в тексте подписано так же:
 *   — что сборщик действительно не кладёт серверные модули в клиентский бандл: webpack здесь
 *     не запускался. Проверено только то, что в потоке нет кода серверных компонентов, а модуль
 *     с `'use client'` на сервере подменяется ссылкой и не исполняется (`node-register`).
 *     Источник утверждения про бандл — react.dev, «Server Components»;
 *   — как фреймворк доставляет поток в браузер (вложенным в HTML или отдельным запросом)
 *     и каким HTTP-запросом уходит вызов серверной функции — это решает фреймворк, а не пакет;
 *     проверено только то, что клиент зовёт `callServer(id, args)`, а `encodeReply`/`decodeReply`
 *     переносят аргументы. Источник — react.dev, «Server Functions»;
 *   — что `cache()` живёт ровно один запрос **во фреймворке**: проверено на голом
 *     `renderToPipeableStream` — там кеш общий в пределах одного вызова и пустой в следующем.
 */

// ---------------------------------------------------------------------------
// Вводный раздел и словарь
// ---------------------------------------------------------------------------

export const INTRO_NOTE =
  'Страница поста разбирает markdown и ходит в базу, а в браузер ради этого уезжают парсер и клиент к API — хотя читателю нужен только готовый текст и одна кнопка «лайк». Server Components — не ещё один способ отрендерить HTML, а **компоненты, которые исполняются только на сервере** и присылают в браузер не разметку и не код, а результат: дерево элементов в текстовом потоке. Клиентские компоненты в этом дереве — дырки с адресом модуля, их код грузится и оживает как обычно.';

export const GLOSSARY = [
  {
    k: 'серверный компонент',
    d: 'Функция-компонент, которую React вызывает **только на сервере**, в том числе `async`. Может читать базу и файлы. Не имеет состояния и эффектов: в серверной сборке React хуков `useState` и `useEffect` нет вовсе. В браузер уходит то, что она вернула, а не она сама.',
  },
  {
    k: 'клиентский компонент',
    d: 'Обычный компонент React — со состоянием, эффектами и обработчиками. Им становится всё, что экспортирует модуль с `\'use client\'` и всё, что этот модуль импортирует. На сервере вместо него стоит ссылка на модуль.',
  },
  {
    k: 'Flight',
    d: 'Внутреннее имя формата, которым сервер передаёт дерево клиенту: текст из строк `id:значение`, где значение — JSON с `$`-ссылками на другие строки. Публичной спецификации у формата нет — он описан только кодом React, поэтому тема сверяет каждое утверждение с запуском.',
  },
  {
    k: '`\'use client\'`',
    d: 'Директива в первой строке модуля: «отсюда начинается код для браузера». Её читает сборщик, а не React в рантайме: он подменяет экспорты такого модуля ссылками для сервера и кладёт сам модуль в клиентский бандл.',
  },
  {
    k: 'серверная функция',
    d: 'Функция из модуля с `\'use server\'` (раньше — Server Action). Её можно передать клиенту пропом, но приедет не код, а id: вызов в браузере отправляет id и аргументы на сервер.',
  },
  {
    k: 'сериализатор',
    d: 'Код, который превращает живые объекты в текст, чтобы их можно было передать по сети. Обратную работу — из текста снова объекты — делает десериализатор. Здесь сериализатор стоит на сервере и пишет поток Flight, а десериализатор — клиентская часть React.',
  },
  {
    k: 'манифест клиентских модулей',
    d: 'Таблица, которую строит сборщик: «ссылка на клиентский компонент → id модуля, его чанки (файлы, на которые сборщик порезал код для браузера), имя экспорта». Сериализатор берёт из неё то, что пишет в I-строку; клиент по ней знает, какие файлы догрузить.',
  },
  {
    k: 'условие `react-server`',
    d: 'Условие экспорта в `package.json` (как `import` и `require`). Под ним `react` отдаёт урезанную серверную сборку, а `react-server-dom-webpack/server` вообще загружается. Серверные компоненты исполняются в окружении, запущенном с этим условием.',
  },
  {
    k: 'digest',
    d: 'Короткий код ошибки, который сервер кладёт в поток вместо текста. Возвращается из `onError`; в продакшен-сборке клиент получает только его и общую фразу, а настоящая причина остаётся в журнале сервера.',
  },
];

export const PREREQ_NOTE =
  'Тема стоит на трёх вещах из React и одной из сборки. Если какая-то из них незнакома, её стоит прочесть сначала.';

export const PREREQ = [
  {
    t: 'Элемент React — это объект',
    d: 'JSX превращается в вызов `createElement`, а тот возвращает обычный объект `{ $$typeof, type, key, props }`. Сериализатор в этой теме работает именно с такими объектами.',
    href: '/frameworks/react-internals/#s1',
    hrefLabel: 'React изнутри: свой рендерер, раздел «Элемент»',
    tone: 'info' as const,
  },
  {
    t: 'SSR и гидратация',
    d: 'Сервер отдаёт HTML, браузер оживляет его кодом всех компонентов. Здесь это не пересказывается: тема объясняет, чем Server Components от этого отличаются.',
    href: '/frameworks/ssr-hydration/#s1',
    hrefLabel: 'SSR и гидратация: React и Vue, раздел «Что отдаёт сервер»',
    tone: 'warn' as const,
  },
  {
    t: 'Suspense',
    d: 'Граница, которая показывает `fallback`, пока внутри что-то не готово. В потоке Flight она окажется просто символом — а работает на клиенте.',
    href: '/frameworks/react-concurrent-internals/#s5',
    hrefLabel: 'React изнутри: конкурентность и lanes, раздел «Suspense»',
    tone: 'info' as const,
  },
  {
    t: 'Условия в `exports`',
    d: 'Один пакет отдаёт разные файлы в зависимости от условий `import`, `require`, `node`. Серверные компоненты добавляют своё условие — `react-server`.',
    href: '/tooling/modules/#s3',
    hrefLabel: 'Модули и сборка, раздел «CommonJS против ESM»',
    tone: 'ok' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 1. Не другой SSR
// ---------------------------------------------------------------------------

export const PLAIN_RSC =
  'SSR — как прислать фотографию обставленной комнаты: смотреть можно сразу, но чтобы ящики открывались, вслед везут всю мебель — код **всех** компонентов — и собирают её заново поверх фотографии. Server Components — как привезти комнату, где шкафы собраны на заводе и стоят намертво, а инструкцию приложили только к тому, что двигается: к кнопке лайка. Шкафы собирать не нужно, и их чертежей у вас нет.';

export const SSR_VS_RSC = {
  head: ['', 'SSR', 'Server Components'],
  rows: [
    ['что уходит в браузер', 'строка HTML', 'поток Flight: дерево элементов текстом, с дырками под клиентские компоненты'],
    ['какие компоненты исполняются на сервере', 'все — и потом ещё раз в браузере', 'серверные — только там; клиентские — только в браузере (и при SSR, если он есть)'],
    ['код компонента в браузере', 'нужен код всех: без него гидратация не соберёт дерево', 'нужен код только клиентских: в потоке нет ни строки кода серверных'],
    ['что гидратируется', 'всё дерево', 'только клиентские компоненты — серверные приехали готовым результатом'],
    ['состояние и эффекты', 'есть у всех, на сервере не срабатывают', 'у серверных их нет совсем: в серверной сборке React нет `useState` и `useEffect`'],
  ],
  cols: 'minmax(150px,.8fr) minmax(200px,1fr) minmax(260px,1.3fr)',
  kinds: ['mono', 'muted', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 700,
};

/** Ключи, которых нет в `react` под условием `react-server`. Тест сверяет с загруженной сборкой. */
export const SERVER_REACT_MISSING = ['useState', 'useEffect', 'useReducer', 'useContext', 'useLayoutEffect'];
/** Ключи, которые в серверной сборке есть. */
export const SERVER_REACT_HAS = ['cache', 'use', 'useId', 'useMemo', 'Suspense'];

export const SERVER_REACT_NOTE =
  'Серверный компонент исполняется другой сборкой React. Под условием `react-server` в объекте `React` **нет** `useState`, `useEffect`, `useReducer`, `useContext` и `useLayoutEffect` — зато есть `cache`, `use`, `useId`, `useMemo`. Вызов `useState` в серверном компоненте — не предупреждение, а `TypeError: useState is not a function`: имени просто не существует.';

export const SSR_FROM_FLIGHT_NOTE =
  'SSR и Server Components не соперничают — они стоят друг за другом. Сервер получает поток Flight, тут же разбирает его клиентской частью пакета и отдаёт получившееся дерево в `renderToString` из `react-dom/server`: HTML выходит сразу с результатом серверных компонентов и с первой отрисовкой клиентских. Ниже — ровно то, что вернул `renderToString` для потока из раздела «Формат потока» с настоящим клиентским `Like` (у него `useState`).';

/** Что вернул `renderToString` для дерева, собранного из `FLIGHT_SAMPLE` (сверено тестом). */
export const SSR_FROM_FLIGHT_HTML =
  '<main><h1>Пост</h1><button>♥ <!-- -->0</button><!--$--><ul><li>Первый</li><li>Второй</li></ul><!--/$--><!--$--><aside>Похожие посты</aside><!--/$--></main>';

/**
 * Листинг исполняется тестом как напечатан: подставляются `h`, `useState`, `createFromNodeStream`,
 * `renderToString`, `flight` (поток `FLIGHT_SAMPLE`) и `manifest`, а результат — `html`.
 */
export const SSR_FROM_FLIGHT_CODE = String.raw`// Like — настоящий клиентский компонент: на сервере его код тоже есть
function Like() {
  const [n] = useState(0);
  return h('button', null, '♥ ', n);
}

// поток готов — разбираем его клиентской частью пакета, прямо на сервере
const tree = await createFromNodeStream(flight, manifest);
const html = renderToString(tree);   // тот же react-dom/server, что в обычном SSR`;

// ---------------------------------------------------------------------------
// Раздел 2. Формат потока
// ---------------------------------------------------------------------------

export const PLAIN_FLIGHT =
  'Поток Flight — опись посылки по коробкам. У каждой строки свой номер, а вместо вложенной коробки внутри написано «см. коробку 3». Коробку 3 можно довезти позже: пока её нет, на её месте пусто, а всё остальное уже можно распаковывать. Коробки с инструкциями к мебели, которую собираете вы сами, помечены отдельно — буквой `I`.';

/** Манифест клиентских модулей демо и теста: собран руками, в той форме, которую ждёт пакет. */
export const DEMO_MANIFEST = {
  like: { id: 'like', chunks: ['like', 'like.js'], name: 'Like' },
};

/** Что отвечает «база» демо на каждый запрос. */
export const DEMO_DATA: Record<string, unknown> = {
  likes: 42,
  related: 'Похожие посты',
  comments: ['Первый', 'Второй'],
};

/**
 * Порядок, в котором «база» отвечает. В демо — задержками, в тесте — по макрозадачам
 * без таймеров: так порядок кусков не зависит от нагрузки на машину.
 */
export const DEMO_ORDER = ['likes', 'related', 'comments'];

/** Сквозной пример: сервер страницы поста. Переключатели демо — поля `opts`. */
export const PAGE_CODE = String.raw`function page(opts, { h, Suspense, client, action, query }) {
  const Like = client('like', 'Like');           // модуль like.js начинается с 'use client'
  const save = action('actions', 'save');         // функция из модуля с 'use server'

  function ServerLike({ value }) {                // тот же лайк, но серверный компонент
    return h('button', null, '♥ ' + typeof value);
  }

  function SyncComments() {
    return h('ul', null, ['Первый', 'Второй'].map((text) => h('li', { key: text }, text)));
  }

  async function Comments() {
    const list = await query('comments');         // ждём «базу»
    return h('ul', null, list.map((text) => h('li', { key: text }, text)));
  }

  async function Related() {
    const title = await query('related');
    return h('aside', null, title);
  }

  class Price {
    constructor(value) { this.value = value; }
  }

  const value =
    opts.prop === 'number' ? 7
    : opts.prop === 'date' ? new Date(Date.UTC(2026, 8, 29))
    : opts.prop === 'promise' ? query('likes')    // промис уходит к клиенту как есть
    : opts.prop === 'action' ? save
    : opts.prop === 'class' ? new Price(7)
    : () => 7;

  const wrap = (child) =>
    opts.suspense ? h(Suspense, { fallback: h('p', null, 'Загружаем…') }, child) : child;

  return h('main', null,
    h('h1', null, 'Пост'),
    h(opts.like === 'client' ? Like : ServerLike, { value }),
    wrap(opts.comments === 'async' ? h(Comments) : h(SyncComments)),
    opts.comments === 'async' ? wrap(h(Related)) : null,
  );
}`;

/** Сочетание переключателей, чей настоящий поток напечатан в разделе «Формат потока». */
export const SAMPLE_OPTS = { like: 'client', comments: 'async', suspense: true, prop: 'number' } as const;

/**
 * Настоящий поток `react-server-dom-webpack` 19.3.0 (продакшен) для `SAMPLE_OPTS`, по кускам —
 * так, как их получил `Writable`. Сверено тестом с живым прогоном.
 */
export const FLIGHT_SAMPLE = [
  '1:I["like",["like","like.js"],"Like"]\n2:"$Sreact.suspense"\n0:["$","main",null,{"children":[["$","h1",null,{"children":"Пост"}],["$","$L1",null,{"value":7}],["$","$2",null,{"fallback":["$","p",null,{"children":"Загружаем…"}],"children":"$L3"}],["$","$2",null,{"fallback":["$","p",null,{"children":"Загружаем…"}],"children":"$L4"}]]}]\n',
  '4:["$","aside",null,{"children":"Похожие посты"}]\n',
  '3:["$","ul",null,{"children":[["$","li","Первый",{"children":"Первый"}],["$","li","Второй",{"children":"Второй"}]]}]\n',
];

export const FLIGHT_SAMPLE_VIEW = FLIGHT_SAMPLE.map((chunk, i) => `// кусок ${i + 1}\n${chunk}`).join('\n');

/**
 * Образец потока, прочитанный строка за строкой. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно. Таблицы `ROW_KINDS` и `PREFIXES` называли строки и префиксы по одному;
 * здесь они собраны на одном потоке — `FLIGHT_SAMPLE`, дословном выводе `react-server-dom-webpack`
 * 19.3.0, сверенном тестом. Что клиент может показать после первого куска (две заглушки; без
 * Suspense — пустой экран), закреплено тестом «демо: что показывает дерево».
 */
export const FLIGHT_READ_NOTE =
  'Что было бы **без строк и дыр**. Сервер дождался бы обоих запросов — комментариев и похожих постов — и отправил бы одно дерево целиком. Пока отвечает самый медленный запрос, у читателя нет ничего, даже заголовка. Поток нужен, чтобы отдать готовое сразу, а недостающее дослать. Ниже образец выше, прочитанный клиентом по мере прихода.';

export const FLIGHT_READ_STEPS: { k: string; line: string; what: string }[] = [
  {
    k: 'Кусок 1 · строка `1:`',
    line: '1:I["like",["like","like.js"],"Like"]',
    what: 'Клиентский модуль: id `like`, файл `like.js`, экспорт `Like`. Кода компонента в потоке нет — только адрес, по которому клиент его возьмёт. Строка идёт раньше корня: когда клиент дойдёт до ссылки на неё в дереве, он уже будет знать, что это.',
  },
  {
    k: 'Кусок 1 · строка `2:`',
    line: '2:"$Sreact.suspense"',
    what: 'Символ `Symbol.for(\'react.suspense\')`. Функцией или классом `Suspense` не передать, а символ по имени восстанавливается на любой стороне — поэтому встроенные типы едут так.',
  },
  {
    k: 'Кусок 1 · строка `0:` — корень',
    line: '["$","$L1",null,{"value":7}]  …  ["$","$2",null,{"fallback":…,"children":"$L3"}]',
    what: 'Дерево страницы: `main`, `h1` с текстом. Элемент с типом `$L1` — это `Like` из строки 1 с пропом `value: 7`. Два элемента с типом `$2` — `Suspense` из строки 2, у каждого заглушка «Загружаем…», а вместо детей дыры `$L3` и `$L4`: строк 3 и 4 ещё нет, потому что `Comments` и `Related` ждут базу.',
  },
  {
    k: 'Что видно после куска 1',
    line: 'Пост · ♥ · Загружаем… · Загружаем…',
    what: 'Каркас страницы уже на экране: заголовок, лайк (как только загружен `like.js`) и две заглушки. Не будь `Suspense`, дырам негде было бы показать заглушку, и экран остался бы пустым до последнего куска — тест проверяет оба случая.',
  },
  {
    k: 'Кусок 2 · строка `4:`',
    line: '4:["$","aside",null,{"children":"Похожие посты"}]',
    what: 'Ответ `Related` встаёт в дыру `$L4`, вторая заглушка сменяется блоком. Строка 4 пришла **раньше** строки 3: номера раздаются при обходе дерева, а отправляются строки по готовности.',
  },
  {
    k: 'Кусок 3 · строка `3:`',
    line: '3:["$","ul",null,{"children":[["$","li","Первый",…],…]}]',
    what: 'Комментарии встают в `$L3`. Дыр больше нет — страница собрана. У `li` второе поле кортежа — ключ `"Первый"`: ключи из `map` доезжают до клиента как есть.',
  },
];

export const ROW_KINDS = {
  head: ['строка', 'что это'],
  rows: [
    ['`0:[…]`', 'корень дерева. Номер `0` — всегда корень, остальные номера раздаются по мере того, как сериализатор натыкается на то, что нужно вынести в отдельную строку'],
    ['`1:I["like",["like","like.js"],"Like"]`', 'клиентский модуль: id модуля, его чанки парами «id, файл» и имя экспорта. Одна строка на модуль, сколько бы раз компонент ни встретился'],
    ['`2:"$Sreact.suspense"`', 'символ `Symbol.for(…)`: так в поток попадают `Suspense`, `Fragment` с ключом и другие встроенные типы'],
    ['`2:E{"digest":""}`', 'ошибка. В продакшен-сборке — только `digest`, в отладочной сборке — ещё текст, имя и стек'],
    ['`1:T800,яяя…`', 'длинный текст (от 1024 символов): вынесен без JSON-экранирования, а число после `T` — длина в **байтах** UTF-8 в шестнадцатеричной записи: 1024 буквы «я» — это `800`, то есть 2048 байт'],
  ],
  cols: 'minmax(220px,1fr) minmax(280px,1.6fr)',
  kinds: ['mono', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 620,
};

/** Элемент в потоке — кортеж из четырёх: маркер `"$"`, тип, ключ, пропсы. */
export const ELEMENT_TUPLE = '["$", "li", "Первый", {"children":"Первый"}]';

/**
 * Префиксы значений. `example` — фрагмент, который тест ищет в настоящем потоке (продакшен);
 * `where` — какое дерево его даёт (ключ в `FORMAT_TREES` теста).
 */
export const PREFIXES: { p: string; d: string; example: string; where: string }[] = [
  { p: '`"$"` первым в массиве', d: 'маркер элемента: `["$", тип, ключ, пропсы]`', example: '["$","main",null,', where: 'sample' },
  { p: '`$L1`', d: '**ленивая** ссылка на строку 1. В позиции типа — клиентский компонент из I-строки; в позиции ребёнка — место, куда встанет результат `async`-компонента, когда строка придёт', example: '"$L1"', where: 'sample' },
  { p: '`$@2`', d: 'промис: значение придёт строкой 2', example: '"$@2"', where: 'promise' },
  { p: '`$h2`', d: 'серверная функция: в строке 2 лежит `{"id":…,"bound":…}`', example: '"$h2"', where: 'action' },
  { p: '`$2`', d: 'просто ссылка на строку 2 — символ, клиентский модуль вне позиции типа, ошибку', example: '"$2"', where: 'sample' },
  { p: '`$Sимя`', d: 'символ `Symbol.for(имя)` — только внутри своей строки', example: '"$Sreact.suspense"', where: 'sample' },
  { p: '`$D…`', d: '`Date` строкой ISO', example: '"$D1970-01-01T00:00:00.000Z"', where: 'scalars' },
  { p: '`$n10`', d: '`BigInt`', example: '"$n10"', where: 'scalars' },
  { p: '`$undefined`, `$NaN`, `$Infinity`, `$-0`', d: 'значения, которых нет в JSON', example: '"$undefined"', where: 'scalars' },
  { p: '`$$`', d: 'экранирование: строка `"$5"` из данных уходит как `"$$5"`', example: '"$$5"', where: 'scalars' },
  { p: '`$Q2`, `$W2`', d: '`Map` и `Set`: содержимое — массивом в строке 2', example: '"$Q2"', where: 'mapset' },
  { p: '`$Z`', d: '`Error` в пропсах. В продакшен-сборке — без номера и без текста', example: '"$Z"', where: 'error' },
  { p: '`$0:props:x`', d: 'повторная ссылка **по пути** на объект, который уже сериализован в этом потоке', example: '"$0:props:x"', where: 'shared' },
];

export const FORMAT_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Номера — шестнадцатеричные',
    d: 'После `9` идёт `a`, после `f` — `10`. В продакшен-сборке на маленькой странице до этого не доходит, а в отладочной сборке номера с буквами появляются уже на образце из пяти строк.',
  },
  {
    t: 'Порядок внутри куска не совпадает с номерами',
    d: 'В куске сначала идут I-строки и символы, потом модели, последними — ошибки. Поэтому `1:` и `2:` в образце стоят **перед** `0:`: корень дописывается, когда сериализатор прошёл его целиком и раздал номера всему, что вынес.',
  },
  {
    t: 'Отладочная сборка шлёт в разы больше',
    d: 'С `NODE_ENV=development` в поток добавляются строки для DevTools: `:N` с отметкой времени, `D` с именами, временем и стеком компонентов, а у каждого элемента в кортеже появляются владелец и стек. Образец из этого раздела в отладочной сборке больше продакшен-версии в несколько раз. Разбирать формат по отладочному выводу — значит видеть в нём то, чего в продакшен-сборке нет.',
    tone: 'warn',
  },
];

// ---------------------------------------------------------------------------
// Раздел 3. Сериализатор своими руками
// ---------------------------------------------------------------------------

/**
 * Учебный сериализатор. Исполняется демо в браузере и тестом — против настоящего React.
 * Сообщения об ошибках — первые строки сообщений React дословно: тест сверяет и их.
 */
export const FLIGHT_SERVER_CODE = String.raw`const ELEMENT = Symbol.for('react.transitional.element');
const FRAGMENT = Symbol.for('react.fragment');
const CLIENT_REF = Symbol.for('react.client.reference');
const SERVER_REF = Symbol.for('react.server.reference');

const EVENT_HANDLER = 'Event handlers cannot be passed to Client Component props.';
const FUNCTION_PROP = 'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server". Or maybe you meant to call this function rather than return it.';
const NOT_PLAIN = 'Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.';
const LOCAL_SYMBOL = (sym) => 'Only global symbols received from Symbol.for(...) can be passed to Client Components. The symbol Symbol.for(' + sym.description + ') cannot be found among global symbols.';

// Дерево элементов → поток строк «id:значение». Куски уходят в onChunk по мере готовности.
function renderToFlight(root, manifest, { onChunk = () => {}, onError = () => {} } = {}) {
  let nextId = 0;
  const imports = [];          // I-строки модулей и строки символов — в куске первыми
  const rows = [];             // модели: дерево, промисы, серверные функции
  const errors = [];           // E-строки — последними
  const written = new Map();   // одна строка на модуль, символ и серверную функцию
  let pending = 0;
  let pinged = [];
  const later = typeof setImmediate === 'function' ? setImmediate : (fn) => setTimeout(fn, 0);
  let finish;
  const done = new Promise((resolve) => (finish = resolve));

  const hex = (id) => id.toString(16);
  const line = (id, text) => hex(id) + ':' + text + '\n';
  const isThenable = (v) => v !== null && typeof v === 'object' && typeof v.then === 'function';
  const isServerElement = (v) =>
    v !== null && typeof v === 'object' && v.$$typeof === ELEMENT &&
    typeof v.type === 'function' && v.type.$$typeof !== CLIENT_REF;

  function fail(id, error) {
    onError(error);                                   // причина — в журнал сервера
    errors.push(line(id, 'E' + JSON.stringify({ digest: '' })));   // клиенту — только digest
    return id;
  }

  // Строка с этим id появится, когда значение будет готово.
  function emit(id, value) {
    while (isServerElement(value)) {                 // серверный компонент: вызвать, взять результат
      try {
        value = value.type(value.props);
      } catch (error) {
        return fail(id, error);
      }
      if (isThenable(value)) return wait(id, value);  // async: тот же id, но позже
    }
    rows.push(line(id, JSON.stringify(model(value, ''))));
  }

  function wait(id, promise) {
    pending++;
    promise.then(
      (value) => ping(() => emit(id, value)),
      (error) => ping(() => fail(id, error)),
    );
    return id;
  }

  // Всё, что стало готово до следующей макрозадачи, уходит одним куском.
  function ping(work) {
    pinged.push(work);
    if (pinged.length > 1) return;
    later(() => {
      const batch = pinged;
      pinged = [];
      for (const run of batch) {
        pending--;
        run();
      }
      flush();
    });
  }

  function flush() {
    const chunk = imports.join('') + rows.join('') + errors.join('');
    imports.length = rows.length = errors.length = 0;
    if (chunk) onChunk(chunk);
    if (pending === 0) finish();
  }

  function model(value, key) {
    if (value === null || typeof value === 'boolean') return value;
    if (value === undefined) return '$undefined';
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return '$NaN';
      if (value === Infinity) return '$Infinity';
      if (value === -Infinity) return '$-Infinity';
      return Object.is(value, -0) ? '$-0' : value;
    }
    if (typeof value === 'bigint') return '$n' + value;
    if (typeof value === 'string') return value[0] === '$' ? '$' + value : value;
    if (typeof value === 'symbol') return '$' + hex(symbol(value));
    if (value.$$typeof === CLIENT_REF) return '$' + hex(clientRef(value));
    if (typeof value === 'function') {
      if (value.$$typeof === SERVER_REF) return '$h' + hex(serverRef(value));
      const text = /^on[A-Z]/.test(key) ? EVENT_HANDLER : FUNCTION_PROP;
      return '$' + hex(fail(nextId++, new Error(text)));
    }
    if (value.$$typeof === ELEMENT) return element(value);
    if (isThenable(value)) return '$@' + hex(wait(nextId++, value));
    if (Array.isArray(value)) return value.map((item, i) => model(item, String(i)));
    if (value instanceof Date) return '$D' + value.toISOString();
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return '$' + hex(fail(nextId++, new Error(NOT_PLAIN)));
    }
    const out = {};
    for (const k of Object.keys(value)) out[k] = model(value[k], k);
    return out;
  }

  function element(el) {
    if (isServerElement(el)) {                        // вложенный серверный компонент
      let result;
      try {
        result = el.type(el.props);
      } catch (error) {
        return '$L' + hex(fail(nextId++, error));
      }
      if (isThenable(result)) return '$L' + hex(wait(nextId++, result));   // дыра до лучших времён
      return model(result, '');
    }
    if (el.type === FRAGMENT && el.key === null) return model(el.props.children, 'children');
    const type =
      typeof el.type === 'string' ? el.type
      : el.type.$$typeof === CLIENT_REF ? '$L' + hex(clientRef(el.type))
      : model(el.type, '');                           // символ: Suspense и другие встроенные
    return ['$', type, el.key, model(el.props, '')];
  }

  function clientRef(ref) {
    if (!written.has(ref.$$id)) {
      const [path, name] = ref.$$id.split('#');
      const entry = manifest[path];
      const id = nextId++;
      imports.push(line(id, 'I' + JSON.stringify([entry.id, entry.chunks, name])));
      written.set(ref.$$id, id);
    }
    return written.get(ref.$$id);
  }

  function symbol(sym) {
    const name = Symbol.keyFor(sym);
    if (name === undefined) return fail(nextId++, new Error(LOCAL_SYMBOL(sym)));
    if (!written.has(sym)) {
      const id = nextId++;
      imports.push(line(id, JSON.stringify('$S' + name)));
      written.set(sym, id);
    }
    return written.get(sym);
  }

  function serverRef(fn) {
    if (!written.has(fn)) {
      const id = nextId++;
      rows.push(line(id, JSON.stringify({ id: fn.$$id, bound: null })));
      written.set(fn, id);
    }
    return written.get(fn);
  }

  emit(nextId++, root);
  flush();
  return done;
}`;

/**
 * Учебный клиент: всё, что пришло к этому моменту, → дерево. Тест сверяет результат
 * с настоящим клиентом `react-server-dom-webpack` после **каждого** куска.
 */
export const FLIGHT_CLIENT_CODE = String.raw`const HOLE = Symbol.for('учебный.flight.дыра');

// Всё, что пришло к этому моменту, → дерево элементов. Чего ещё нет — дыра HOLE.
function createFromFlight(text, modules, callServer = () => {}) {
  const rows = new Map();
  for (const raw of text.split('\n')) {
    if (!raw) continue;
    const colon = raw.indexOf(':');
    const id = parseInt(raw.slice(0, colon), 16);
    const body = raw.slice(colon + 1);
    if (body[0] === 'I') rows.set(id, { kind: 'module', meta: JSON.parse(body.slice(1)) });
    else if (body[0] === 'E') rows.set(id, { kind: 'error', meta: JSON.parse(body.slice(1)) });
    else rows.set(id, { kind: 'model', json: JSON.parse(body) });
  }

  let failed = null;   // ссылка на E-строку в пропсах валит весь элемент — как у React

  function row(id) {
    const r = rows.get(id);
    if (!r) return { $$typeof: HOLE, id };
    if (r.kind === 'error') return { $$typeof: HOLE, id, error: r.meta };
    if (r.kind === 'module') {
      const [moduleId, , name] = r.meta;   // настоящий клиент здесь ещё грузит чанки r.meta[1]
      return modules[moduleId][name];
    }
    return revive(r.json);
  }

  function revive(value) {
    if (Array.isArray(value)) {
      if (value[0] !== '$') return value.map(revive);
      const outer = failed;
      failed = null;
      const el = {
        $$typeof: Symbol.for('react.transitional.element'),
        type: revive(value[1]),
        key: value[2],
        props: revive(value[3]),
      };
      const error = failed;
      failed = outer;
      return error ? { $$typeof: HOLE, error } : el;
    }
    if (value !== null && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) out[k] = revive(value[k]);
      return out;
    }
    if (typeof value !== 'string' || value[0] !== '$') return value;
    if (value === '$undefined') return undefined;
    if (value === '$NaN') return NaN;
    if (value === '$Infinity') return Infinity;
    if (value === '$-Infinity') return -Infinity;
    if (value === '$-0') return -0;
    const tag = value[1];
    const rest = value.slice(2);
    if (tag === '$') return value.slice(1);            // экранированный «$»
    if (tag === 'S') return Symbol.for(rest);
    if (tag === 'D') return new Date(rest);
    if (tag === 'n') return BigInt(rest);
    if (tag === 'L') return row(parseInt(rest, 16));   // дыра, пока строки нет
    if (tag === '@') return promise(parseInt(rest, 16));
    if (tag === 'h') {
      const ref = row(parseInt(rest, 16));
      return (...args) => callServer(ref.id, args);     // кода функции нет — только её id
    }
    const target = row(parseInt(value.slice(1), 16));
    if (target && target.$$typeof === HOLE && target.error) failed = target.error;
    return target;
  }

  // Промис с полями status и value — так React помечает промисы, которые уже можно прочесть.
  function promise(id) {
    const target = row(id);
    if (target && target.$$typeof === HOLE) {
      if (!target.error) return Object.assign(new Promise(() => {}), { status: 'pending' });
      const p = Promise.reject(target.error);
      p.catch(() => {});
      return Object.assign(p, { status: 'rejected', reason: target.error });
    }
    return Object.assign(Promise.resolve(target), { status: 'fulfilled', value: target });
  }

  return row(0);
}`;

export const MINI_NOTE =
  'Сериализатор — это обход дерева с тремя очередями. Серверный компонент вызывается на месте, и в поток попадает то, что он вернул. Если вернул промис — на его месте ставится `$L` с новым номером, а строка с этим номером уйдёт, когда промис разрешится. Всё, что стало готово до следующей макрозадачи (следующего оборота цикла событий), уходит одним куском. Клиент устроен зеркально: разбирает строки и подставляет по ссылкам, а на месте недошедших оставляет дыру.';

export const DEMO_NOTE =
  'Переключатели меняют `opts` в `page()` выше. Кнопка вызывает учебный `renderToFlight` **у вас в браузере** и показывает куски по мере готовности; «база» отвечает с задержками — лайки, потом «похожие», потом комментарии. Слева — строки потока, справа — что соберёт из пришедшего учебный `createFromFlight`. Все 48 сочетаний совпадают с настоящим `react-server-dom-webpack` 19.3.0: поток — байт в байт, дерево — после каждого куска.';

export const DEMO_CAPTION =
  'Цвета строк: **I** — клиентский модуль, **$S** — символ, **E** — ошибка. В дереве: сплошное — готово к показу без кода, пунктир — клиентский компонент (его код грузится и гидратируется), жёлтое — заглушка Suspense. Экран пуст, пока дыра без Suspense ждёт своей строки: ей негде показать заглушку.';

export const MINI_VS_REAL = {
  head: ['что в дереве', 'настоящий React', 'учебный'],
  rows: [
    ['строка от 1024 символов', 'отдельная строка `T` с длиной в байтах', 'строкой внутри JSON'],
    ['один объект в двух пропсах', 'второй раз — ссылка по пути `"$0:props:x"`', 'копия'],
    ['большая синхронная модель', 'после ~3200 символов строк режет дерево на строки `$L` — без всякого `async`', 'одной строкой'],
    ['`Map`, `Set`, `Error`, типизированные массивы', '`$Q`, `$W`, `$Z`, строка с сырыми байтами', 'ошибка «Only plain objects…»'],
    ['`save.bind(null, id)`', '`"bound":"$@3"` и строка 3 с аргументами', 'всегда `"bound":null`'],
    ['текст ошибки', 'первая строка + указатель на место в пропсах', 'только первая строка'],
    ['отладочная сборка', 'строки `:N`, `D`, стеки и текст ошибок', 'нет'],
  ],
  cols: 'minmax(190px,1fr) minmax(250px,1.3fr) minmax(170px,.8fr)',
  kinds: ['prose', 'muted', 'muted'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 660,
};

// ---------------------------------------------------------------------------
// Раздел 4. Граница 'use client'
// ---------------------------------------------------------------------------

export const PLAIN_BOUNDARY =
  '`\'use client\'` — не наклейка «клиентский» на один компонент, а дверь: всё, что импортировано за ней, едет в браузер. Через дверь передают только то, что пролезает в посылку, — данные. Функцию, экземпляр класса с методами, соединение с базой не передашь: у них нет текстового вида, а код на сервере и код в браузере — разные программы.';

/**
 * Что можно положить в проп клиентского компонента. Таблица вычислена, а не набрана:
 * тест рендерит `h(Like, { [key]: <code> })` настоящим сервером, берёт из потока значение
 * пропа и остальные строки, а потом разбирает поток настоящим клиентом (`client.browser`)
 * и описывает, что приехало. `wire` — значение пропа в строке 0, `rows` — прочие строки,
 * кроме I-строки модуля.
 */
export const PROP_CASES: { code: string; key?: string; wire: string; rows: string; arrives: string }[] = [
  { code: '7', wire: '7', rows: '', arrives: 'число 7' },
  { code: "'$5'", wire: '"$$5"', rows: '', arrives: 'строка "$5"' },
  { code: 'undefined', wire: '"$undefined"', rows: '', arrives: 'undefined' },
  { code: '10n', wire: '"$n10"', rows: '', arrives: 'BigInt 10' },
  { code: 'new Date(0)', wire: '"$D1970-01-01T00:00:00.000Z"', rows: '', arrives: 'Date' },
  { code: "new Map([['a', 1]])", wire: '"$Q2"', rows: '2:[["a",1]]', arrives: 'Map' },
  { code: 'new Set([1])', wire: '"$W2"', rows: '2:[1]', arrives: 'Set' },
  { code: "Symbol.for('ui')", wire: '"$2"', rows: '2:"$Sui"', arrives: 'Symbol(ui)' },
  { code: 'Promise.resolve(42)', wire: '"$@2"', rows: '2:42', arrives: 'промис → 42' },
  { code: "new URL('https://example.com/')", wire: '"https://example.com/"', rows: '', arrives: 'строка "https://example.com/"' },
  { code: "new Error('секрет')", wire: '"$Z"', rows: '', arrives: 'Error без исходного текста' },
  { code: 'save', wire: '"$h2"', rows: '2:{"id":"actions#save","bound":null}', arrives: 'функция' },
  { code: '() => 7', wire: '"$2"', rows: '2:E{"digest":""}', arrives: 'элемент упал' },
  { code: '() => {}', key: 'onClick', wire: '"$2"', rows: '2:E{"digest":""}', arrives: 'элемент упал' },
  { code: 'new (class Price {})()', wire: '"$2"', rows: '2:E{"digest":""}', arrives: 'элемент упал' },
  { code: 'Object.create(null)', wire: '"$2"', rows: '2:E{"digest":""}', arrives: 'элемент упал' },
  { code: "Symbol('local')", wire: '"$2"', rows: '2:E{"digest":""}', arrives: 'элемент упал' },
];

export const PROP_TABLE = {
  head: ['проп клиентского компонента', 'значение в строке 0', 'ещё строки', 'что получит клиент'],
  rows: PROP_CASES.map((c) => [
    `\`${c.key ?? 'v'}: ${c.code}\``,
    `\`${c.wire}\``,
    c.rows ? `\`${c.rows}\`` : '—',
    c.arrives,
  ]),
  cols: 'minmax(210px,1.2fr) minmax(170px,1fr) minmax(170px,1fr) minmax(150px,.9fr)',
  kinds: ['mono', 'mono', 'muted', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 760,
};

/** Первые строки сообщений `onError` — дословно, сверено тестом. */
export const BOUNDARY_ERRORS = {
  head: ['что передали', 'что пишет сервер в `onError`'],
  rows: [
    ['функцию в проп `onClick`, `onChange`…', 'Event handlers cannot be passed to Client Component props.'],
    ['функцию в любой другой проп', 'Functions cannot be passed directly to Client Components unless you explicitly expose it by marking it with "use server". Or maybe you meant to call this function rather than return it.'],
    ['экземпляр класса, объект без прототипа, `RegExp`', 'Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.'],
    ['`Symbol(\'local\')`', 'Only global symbols received from Symbol.for(...) can be passed to Client Components. The symbol Symbol.for(local) cannot be found among global symbols.'],
  ],
  cols: 'minmax(200px,.8fr) minmax(320px,1.6fr)',
  kinds: ['prose', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 620,
};

export const BOUNDARY_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Ошибка не бросается — она едет в поток',
    d: 'Недопустимый проп не останавливает рендер. Сервер зовёт `onError`, кладёт на место пропа ссылку на E-строку и продолжает: остальная страница уходит как ни в чём не бывало. У клиента падает **весь элемент**, в пропсах которого лежит ссылка, — до ближайшей границы ошибок.',
    tone: 'warn',
  },
  {
    t: 'Даже у `<button>` в серверном компоненте',
    d: '`h(\'button\', { onClick })` внутри серверного компонента даёт ту же ошибку «Event handlers cannot be passed to Client Component props», хотя никакого клиентского компонента рядом нет: обычный тег тоже отрисуется в браузере, и функцию туда не довезти. Интерактивная кнопка — это всегда клиентский компонент.',
    tone: 'err',
  },
  {
    t: 'На сервере функция в пропе — не ошибка',
    d: 'Переключите в демо лайк на серверный и проп на «функцию»: ошибок нет. Серверный компонент получил функцию обычным аргументом и не отправил её никуда. Граница проходит не по компоненту, а по **переезду**: проверяется только то, что уходит в поток.',
    tone: 'ok',
  },
  {
    t: 'Модуль с `\'use client\'` на сервере не исполняется',
    d: 'Проверено через `react-server-dom-webpack/node-register` — тот же приём, что делает сборщик. Экспорты модуля стали ссылками с `$$typeof = Symbol(react.client.reference)` и `$$id` вида `file:///…/Like.js#Like`, а `console.log` в теле модуля **не сработал ни разу**: тело не выполнялось. Клиентский компонент на сервере не вызывают — его только упоминают.',
  },
  {
    t: 'Серверное можно положить внутрь клиентского',
    d: 'Клиентскому компоненту можно передать готовые элементы — `children` или любой другой проп: `h(Like, null, h(\'span\', null, \'из сервера\'))` уходит в поток обычным кортежем. Так клиентская обёртка (вкладки, раскрывашка) получает серверное содержимое, не импортируя серверный код.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 5. Серверные функции
// ---------------------------------------------------------------------------

export const PLAIN_ACTION =
  'Серверная функция в браузере — не функция, а номер телефона. Вызов набирает номер и диктует аргументы, отвечает сервер. Код остаётся на сервере: клиенту известны только id и то, что вы сами продиктовали.';

export const ACTION_CODE = String.raw`// actions.js
'use server';
export async function save(postId, value) { … }

// в потоке — не код, а id
2:{"id":"actions#save","bound":null}
0:["$","$L1",null,{"onSave":"$h2"}]

// в браузере onSave(7, { note: 'x' }) превращается в
callServer('actions#save', [7, { note: 'x' }])
// аргументы кодирует encodeReply:
'[7,{"note":"x"},"$D1970-01-01T00:00:00.000Z"]'   // тот же $-синтаксис`;

export const ACTION_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Одна строка на функцию',
    d: 'Функция, переданная в два пропа, даёт одну строку и две ссылки `$h2`. В строке — `id` из директивы (`модуль#экспорт`) и `bound`. Ни тела, ни имени параметров в потоке нет. А в браузере из двух ссылок получаются **две разные функции** с одним id: `props.onSave === props.again` — `false`. Сравнивать серверные функции через `===` бессмысленно.',
  },
  {
    t: 'Вызов — это `callServer(id, args)`',
    d: 'Настоящий клиент (`client.browser`) превращает `$h2` в функцию, которая при вызове зовёт переданный ему `callServer` с id и массивом аргументов. Проверено: `save(7, { note: \'x\' })` → `callServer(\'actions#save\', [7, { note: \'x\' }])`. Как именно запрос уйдёт по сети, решает фреймворк.',
  },
  {
    t: 'Аргументы едут тем же форматом',
    d: '`encodeReply` на клиенте кодирует аргументы тем же `$`-синтаксисом (`Date` — как `$D…`), `decodeReply` на сервере возвращает настоящий `Date`. Значит, и ограничения те же: функцию или экземпляр класса аргументом не передать.',
  },
  {
    t: '`bind` отправляет аргументы клиенту',
    d: '`save.bind(null, \'post-7\')` в пропе даёт `"bound":"$@3"` и отдельную строку `3:["post-7"]`: привязанный аргумент лежит в потоке **открытым текстом**, а при вызове вернётся от клиента обратно. Что пришло от клиента, клиент мог и подменить.',
    tone: 'warn',
  },
];

export const ACTION_NOTE =
  'Серверная функция — обычная точка входа на сервер, только объявленная директивой. Всё, что относится к проверке входа — чей объект, какие поля разрешены, — к ней относится полностью: разобрано в [«Безопасности бэкенда глазами фронтенда»](/platform/backend-security/#s1).';

// ---------------------------------------------------------------------------
// Раздел 6. Async, Suspense и cache
// ---------------------------------------------------------------------------

/**
 * «React копит готовые задачи до `setImmediate`» — по исходнику (`pingTask` в
 * `react-server-dom-webpack-server.node.production.js`); поведение — один кусок на две задачи,
 * готовые в одной макрозадаче, — проверено тестом (`sameTick`).
 */
export const ORDER_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Куски идут по готовности, а не по месту в дереве',
    d: 'В образце «Похожие» стоят ниже комментариев, но строка `4:` приходит раньше `3:`: их запрос ответил первым. Номер строки раздаётся при обходе, а отправка — когда промис разрешился.',
  },
  {
    t: 'Suspense в потоке — просто символ',
    d: 'Сравните в демо поток с Suspense и без: дыры `$L3`, `$L4` и порядок кусков одинаковые, меняются только обёртки `["$","$2",…]` и строка символа. Сервер Flight не ждёт на границах — он ждёт промисы. Граница нужна **клиенту**: где показать заглушку, пока дыры нет.',
    tone: 'warn',
  },
  {
    t: 'Без Suspense ждёт вся страница',
    d: 'Это видно и в SSR: тест отдаёт в `renderToPipeableStream` дерево, собранное из первого куска. С Suspense каркас готов сразу — HTML с заглушкой «Загружаем…». Без Suspense `onShellReady` не вызывается, пока не пришли все куски: дыре негде показать заглушку, кроме как вместо всей страницы.',
    tone: 'err',
  },
  {
    t: 'Готовое к одной макрозадаче уходит одним куском',
    d: 'Два `async`-компонента, разрешившиеся в одной макрозадаче, дают один кусок с двумя строками. React копит готовые задачи до `setImmediate` — учебный сериализатор делает то же, поэтому их куски совпадают.',
  },
  {
    t: '`async`-корень не даёт дыры',
    d: 'Если `async` сам корень, строки `0:"$L1"` не будет: корень — это задача 0, и она просто приходит позже целиком. Дыра `$L` появляется только у вложенного.',
  },
];

export const PLAIN_CACHE =
  '`cache()` — блокнот официанта на один заказ: если за столиком дважды спросили одно и то же, на кухню ходят один раз. Новый заказ — новый блокнот. А вопрос, заданный не за столиком (вне рендера), в блокнот не записывается вовсе.';

/**
 * Листинг исполняется тестом как напечатан: подставляются `cache` (из серверной сборки React),
 * `h` и `db` — «база», которая считает свои вызовы. Из него же берутся `getUser` и `Name`
 * для остальных строк `CACHE_RUNS`.
 */
export const CACHE_CODE = String.raw`const getUser = cache(async (id) => db.user(id));    // db.user — настоящий запрос

async function Name()   { const u = await getUser(1); return h('b', null, u.name); }
async function Avatar() { const u = await getUser(1); return h('i', null, u.name); }  // тот же промис
async function Other()  { const u = await getUser(2); return h('i', null, u.name); }  // другой аргумент

const page = h('div', null, h(Name), h(Avatar), h(Other));`;

/** Сколько раз выполнилась обёрнутая функция в каждом случае (сверено тестом). */
export const CACHE_RUNS = {
  head: ['случай', 'вызовов функции'],
  rows: [
    ['один рендер `page`: `getUser(1)`, `getUser(1)`, `getUser(2)`', '2'],
    ['два рендера `h(Name)` подряд', '2'],
    ['вне рендера: `await getUser(1)` дважды', '2'],
    ['`byObj({ id: 1 })` дважды и один объект `k` дважды', '3'],
  ],
  cols: 'minmax(320px,1.6fr) minmax(120px,.5fr)',
  kinds: ['prose', 'mono'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 480,
};

/** Числа из `CACHE_RUNS` по порядку — их сверяет тест. */
export const CACHE_COUNTS = [2, 2, 2, 3];

export const CACHE_NOTE =
  'Кеш живёт один рендер: второй вызов `renderToPipeableStream` начинает с пустого. Вне рендера обёрнутая функция просто выполняется каждый раз — ошибки нет, кеша тоже. Аргументы сравниваются **по ссылке**: два одинаковых литерала `{ id: 1 }` — два разных ключа. `cache` есть только в серверной сборке React; в обычной `react` его тоже можно импортировать, но кешировать там не для кого.';

/**
 * ⚠️ Последняя фраза `CACHE_NOTE` («в обычной `react` … не для кого») — по документации
 * react.dev («cache»: «cache is only for use with React Server Components»). Запуском проверено
 * только, что `cache` существует в серверной сборке и как он считает вызовы в ней.
 */

// ---------------------------------------------------------------------------
// Тонкие места
// ---------------------------------------------------------------------------

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Suspense не ускоряет поток',
    d: 'Граница Suspense в серверном компоненте не меняет ни порядок, ни состав кусков — только добавляет строку символа. Ускоряет её отсутствие ожиданий, а не её наличие. Граница решает другое: покажет ли клиент остальную страницу, пока дыра не заполнена.',
    tone: 'warn',
  },
  {
    n: '02',
    t: 'Недопустимый проп ломает элемент молча для сервера',
    d: 'Рендер не падает: поток завершается, в журнале — одна строка `onError`. Сломан только элемент в браузере, и в продакшен-сборке текст у него общий: браузерная сборка клиента бросает `Minified React error #441`, серверная (при SSR) — «An error occurred in the Server Components render. The specific message is omitted in production builds…». Причину ищут по `digest` в журнале сервера — поэтому `onError` стоит возвращать осмысленный код.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`Error` в пропе приезжает без текста',
    code: "h(Like, { e: new Error('секрет') })\n// поток: {\"e\":\"$Z\"}\n// клиент: Error с текстом «Minified React error #441…», без «секрет»",
    d: 'Ошибку можно передать пропом, но в продакшен-сборке от неё остаётся только тип: ни номера строки, ни сообщения. Если клиенту нужен текст — передавайте строку, а не `Error`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`URL` становится строкой, и это не ошибка',
    d: 'У `URL` есть `toJSON`, и сериализатор, как и `JSON.stringify`, зовёт его: в пропе приезжает `"https://example.com/"` без единого предупреждения. `Date` сохраняет тип только потому, что для него есть свой префикс `$D`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`bind` — не способ спрятать аргумент',
    d: 'Привязанные аргументы серверной функции уходят в поток открытым текстом и возвращаются от клиента при вызове. Кладите туда только то, что клиенту и так можно знать, и проверяйте на сервере, как любой вход.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`cache()` вне рендера не кеширует',
    d: 'Обёрнутая функция, вызванная из обработчика, скрипта или теста, выполняется каждый раз — без ошибки и без предупреждения. А внутри рендера кеш не переживает запрос: это дедупликация на один проход, а не кеш данных.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`$L` в потоке ещё не значит `async`',
    d: 'На большой синхронной модели React сам режет дерево на строки `$L` — после примерно 3200 символов строк в одной задаче. Увидев в потоке `$L`, не ищите `await`: это может быть просто длинный список.',
  },
  {
    n: '08',
    t: 'Разбор формата по отладочной сборке',
    d: 'В `NODE_ENV=development` строк в разы больше: время, стек, владелец, тайминги. В продакшен-сборке их нет, а номера строк другие. Всё, что тема показывает, снято в продакшен-сборке; сверять свой вывод стоит с ней же.',
  },
];

// ---------------------------------------------------------------------------
// Источники
// ---------------------------------------------------------------------------

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'React · Server Components',
    href: 'https://react.dev/reference/rsc/server-components',
    what: 'Что такое серверный компонент, `async`-компоненты и то, что их код не попадает в бандл.',
  },
  {
    title: 'React · \'use client\'',
    href: 'https://react.dev/reference/rsc/use-client',
    what: 'Граница как свойство модуля и список сериализуемых типов пропсов.',
  },
  {
    title: 'React · Server Functions и \'use server\'',
    href: 'https://react.dev/reference/rsc/server-functions',
    what: 'Серверные функции, их передача клиенту и оговорка, что аргументы — это вход от пользователя.',
  },
  {
    title: 'React · cache',
    href: 'https://react.dev/reference/react/cache',
    what: 'Кеш на один рендер, сравнение аргументов и то, что `cache` предназначен для серверных компонентов.',
  },
  {
    title: 'react-server-dom-webpack · исходник сервера',
    href: 'https://github.com/facebook/react/blob/main/packages/react-server/src/ReactFlightServer.js',
    what: 'Три очереди строк, раздача номеров, префиксы, порог 1024 символа для `T` и 3200 для нарезки модели.',
  },
  {
    title: 'react-server-dom-webpack · исходник клиента',
    href: 'https://github.com/facebook/react/blob/main/packages/react-client/src/ReactFlightClient.js',
    what: 'Разбор строк, ленивые ссылки и то, как ошибка в пропсах превращает элемент в падающий.',
  },
  {
    title: 'RFC: React Server Components',
    href: 'https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md',
    what: 'Замысел: зачем компонентам исполняться только на сервере и почему результат — дерево, а не HTML.',
  },
];

export const RELATED =
  'Смежное на сайте: [SSR и гидратация: React и Vue](/frameworks/ssr-hydration/#s4) — стриминг HTML, который обычно идёт вместе с потоком Flight. [React изнутри: свой рендерер](/frameworks/react-internals/#s1) — элемент как объект, с которым работает сериализатор. [React изнутри: конкурентность и lanes](/frameworks/react-concurrent-internals/#s5) — как клиент ждёт на границе Suspense. [Модули и сборка](/tooling/modules/#s3) — условия `exports`, через которые загружается серверная сборка. [Безопасность бэкенда глазами фронтенда](/platform/backend-security/#s4) — лишние поля во входе, в том числе в аргументах серверной функции. [Стримы и обратное давление](/platform/streams/#s2) — читаемый поток, которым Flight доезжает до клиента. [Слои кеша в Next.js](/frameworks/next-cache/) — какой из четырёх кешей держит данные и как каждый сбросить. [Suspense и границы ошибок](/frameworks/suspense-errors/) — что ловит граница в React и Vue, водопад и стабильный промис.';
