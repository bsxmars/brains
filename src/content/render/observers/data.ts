import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RoScene, ThresholdOption } from '@/widgets/observer-lab/model/types';

/**
 * Данные темы «Наблюдатели: Intersection, Resize, Mutation — когда они срабатывают».
 *
 * Тема написана здесь, 2026-10-02, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63.0, `chromium.launch()`),
 * Node 24.11.0, macOS, октябрь 2026. Страницы — `page.setContent`, сервера нет. Скрипты
 * стенда — в рабочем каталоге автора темы (`order.mjs`, `io-stand.mjs`, `ro-stand.mjs`,
 * `facts*.mjs`). Таймерных замеров нет: снимался порядок вызовов, число записей, геометрия.
 *
 * Что снято:
 *   — `ORDER_LOG`: `ORDER_CODE` — та же строка, что на странице, — исполнен на `ORDER_HTML`;
 *     шесть прогонов подряд дали один и тот же журнал. Номер кадра — счётчик в цепочке
 *     `requestAnimationFrame`, отсчитан от кадра, в котором шла задача;
 *   — `IO_CODE` сверен с Chromium на 2400 случайных геометриях (шесть зёрен по 400): корень
 *     с `overflow: hidden` случайного размера, цель где угодно вокруг и внутри (в том числе
 *     нулевой ширины или высоты), `rootMargin` в px и %, случайный набор порогов. Для каждой
 *     геометрии сверены `rootBounds`, `intersectionRect`, `intersectionRatio`, `isIntersecting`
 *     первой записи, затем цель переставлялась — и сверялось, придёт ли вторая запись и какая.
 *     Расхождений ноль. По дороге найдены три вещи, которых нет в тексте спецификации:
 *       1) `isIntersecting` — `false`, пока `intersectionRatio` меньше первого порога, даже
 *          если цель частично видна (спецификация: «пересекаются или касаются»). Тот же прогон
 *          в Firefox 155.0 и WebKit 26.6 дал то же самое — все три движка, не причуда Chromium;
 *       2) отсюда же: запись приходит, только когда меняется номер ступеньки порогов;
 *          смена одного `isIntersecting` без смены ступеньки невозможна;
 *       3) округление `rootMargin`: пиксели — вниз (`-10.5px` → `-11px`, `0.3px` → `0px`,
 *          видно и в геттере `rootMargin`), проценты — к нулю (`-5%` от 111 → −5, `5%` от 77 → 3).
 *          Проценты верха и низа — от высоты корня, лево и право — от ширины (спецификация
 *          говорит «от ширины» для всех четырёх; так не делает ни один из трёх движков).
 *          Firefox и WebKit не округляют вовсе (Firefox — до 1/60 px);
 *   — `IO_CASES`: шесть разобранных в тексте геометрий — тест сверяет их и с моделью, и с Chromium;
 *   — `RO_CODE` сверен с Chromium на 260 случайных деревьях (зёрна 23, 7, 99; 60 + 100 + 100):
 *     4–8 блоков, случайные цели, порядок `observe()` и реакции колбэка (растянуть чужую
 *     ширину на 1px); сравнивались круги доставки и ошибка в каждом из четырёх кадров.
 *     Расхождений ноль. Текст ошибки — `RO_LOOP_MESSAGE`;
 *   — `RO_BOX_ROWS`, `RO_FACTS`: блок `width: 100.3px; padding: 10px; border: 2px` и блок
 *     `box-sizing: border-box`; `transform: scale(2)`, `display: none`, нулевой размер,
 *     строчный `<span>`. `device-pixel-content-box`: при DPR 1 блок шириной 100.3px со сдвигом
 *     10.3px даёт 101 пиксель, без сдвига — 100. ⚠️ Эмуляция DPR через `deviceScaleFactor`
 *     на `device-pixel-content-box` не влияет вовсе (те же 101/100 при 2 и 1.5), а с флагом
 *     `--force-device-scale-factor=2` пиксели удваиваются, но `devicePixelRatio` в headless
 *     shell остаётся 1 — поэтому числа для DPR больше 1 в тексте не приводятся;
 *   — `MO_LOG`: `MO_CODE` исполнен на `MO_HTML`; `MO_STYLE_ROWS` — правка правила в таблице
 *     стилей, `element.animate`, повторный `classList.add`, наблюдение без `subtree`;
 *   — `SENTINEL_*`, `LAZY_CODE`, `RO_LOOP_BAD_CODE`: строки исполнены как есть, тест
 *     повторяет это заново;
 *   — `IntersectionObserver` v2: `trackVisibility: true` без `delay` — `NotSupportedError`
 *     (спецификация велит молча поднять `delay` до 100; Chromium бросает), `isVisible` у цели
 *     под предком с `opacity: .5` — `false`, у обычной — `true`. `trackVisibility` есть только
 *     в Chromium; Firefox и WebKit не проверялись — взято из документации.
 *
 * Только из спецификаций, без стенда: место шагов в «update the rendering» (HTML Standard),
 * то, что колбэк IntersectionObserver — отдельная задача (Intersection Observer, «queue an
 * intersection observer task»), правило глубины и начальный размер −1×−1 (Resize Observer).
 * Стенд согласуется с ними: колбэк IntersectionObserver пришёл позже двух задач, поставленных
 * из колбэка ResizeObserver того же кадра; узел нулевого размера получил первую запись.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'наблюдатель (observer)',
    d: 'Объект с колбэком, который браузер зовёт сам, когда у элемента что-то поменялось: видимость, размер или содержимое. Вы не спрашиваете — вам сообщают.',
  },
  {
    k: 'запись (entry, record)',
    d: 'Одно сообщение в колбэке: какой элемент и что с ним. Колбэк получает **массив** записей — всё, что накопилось с прошлого вызова.',
  },
  {
    k: 'корень (root)',
    d: 'Прямоугольник, с которым IntersectionObserver сравнивает цель. По умолчанию — окно браузера, можно указать прокручиваемый блок.',
  },
  {
    k: 'порог (threshold)',
    d: 'Доля площади цели, на которой нужно сообщить: `0` — «хоть пиксель», `0.5` — «половина», `1` — «вся». Порогов может быть несколько.',
  },
  {
    k: 'раскладка (layout)',
    d: 'Шаг кадра, на котором браузер считает размеры и положения всех коробок. До него новые размеры неизвестны.',
  },
  {
    k: 'микрозадача',
    d: 'Короткая работа, которую браузер выполняет сразу после текущего кода, до следующей задачи и до кадра. Туда попадают `then` промисов и `queueMicrotask`.',
  },
];

export const PLAIN_OBSERVER =
  'Как три разных датчика в доме. Датчик двери (MutationObserver) пищит сразу, как дверь хлопнула, — он не знает, кто вошёл и какого он роста. Ростомер у входа (ResizeObserver) срабатывает, когда гость уже встал на весы, — то есть когда размеры посчитаны. А камера во дворе (IntersectionObserver) присылает снимок чуть позже, отдельным письмом: «гость в кадре на 60 %».';

export const PREREQ_NOTE =
  'Сам кадр, очереди задач и цена принудительной раскладки разобраны в своих темах. Здесь — только то, что из них нужно, чтобы понять, куда в этот порядок встают наблюдатели.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кадр по шагам',
    d: 'Между двумя кадрами браузер выполняет задачи, а в момент отрисовки — `requestAnimationFrame`, стили, раскладку и отрисовку. Наблюдатели встроены в этот же список.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Задачи и микрозадачи',
    d: 'Задача — `setTimeout`, событие, сообщение. После каждой задачи браузер выполняет все микрозадачи до конца очереди, и только потом берёт следующую задачу или рисует кадр.',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event loop», раздел «Checkpoint»',
    tone: 'info',
  },
  {
    t: 'Принудительная раскладка',
    d: 'Если записать стиль, а потом прочитать размер (`offsetHeight`, `getBoundingClientRect()`), браузер посчитает раскладку прямо в этой строке, вне плана кадра. Наблюдатели придуманы, чтобы так не делать.',
    href: '/render/render-pipeline/#s3',
    hrefLabel: '«Кадр браузера», раздел «Чтение и запись»',
    tone: 'info',
  },
];

// ─── Раздел 1. Место в кадре ───────────────────────────────────────────────────────────────

export const ORDER_HTML = `<div id="box" style="width: 100px; height: 50px"></div>
<div id="target" style="position: absolute; top: 2000px; width: 100px; height: 100px"></div>`;

/** Эксперимент на всю тему. Тест исполняет эту строку в Chromium на `ORDER_HTML`. */
export const ORDER_CODE = `async function probe() {
  const log = [];
  let frame = 0, start = 0;
  (function count() {                       // номер кадра растёт в каждом rAF
    requestAnimationFrame(() => { frame++; count(); });
  })();
  const note = (what) => log.push(\`кадр +\${frame - start} · \${what}\`);
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

  const box = document.querySelector('#box');
  const target = document.querySelector('#target');   // пока далеко внизу

  new MutationObserver((records) => note(\`MutationObserver, записей: \${records.length}\`))
    .observe(box, { attributes: true });
  new ResizeObserver(() => {
    note('ResizeObserver');
    queueMicrotask(() => note('микрозадача из ResizeObserver'));
    setTimeout(() => note('setTimeout из ResizeObserver'));
  }).observe(box);
  new IntersectionObserver(() => note('IntersectionObserver')).observe(target);

  await wait(300);
  log.length = 0;                           // первые вызовы — от observe(), не считаем

  setTimeout(() => {                        // одна обычная задача
    start = frame;
    note('задача: начало');
    box.style.width = '200px';              // для MutationObserver и ResizeObserver
    target.style.top = '10px';              // для IntersectionObserver
    queueMicrotask(() => note('микрозадача'));
    setTimeout(() => note('setTimeout 0'));
    requestAnimationFrame(() => note('rAF'));
    note('задача: конец');
  });
  await wait(300);
  return log;
}`;

/** Вывод `probe()` в Chromium 153 — шесть прогонов из шести. Сверяется `tests/unit/observers.test.ts`. */
export const ORDER_LOG = [
  'кадр +0 · задача: начало',
  'кадр +0 · задача: конец',
  'кадр +0 · MutationObserver, записей: 1',
  'кадр +0 · микрозадача',
  'кадр +0 · setTimeout 0',
  'кадр +1 · rAF',
  'кадр +1 · ResizeObserver',
  'кадр +1 · микрозадача из ResizeObserver',
  'кадр +1 · setTimeout из ResizeObserver',
  'кадр +1 · IntersectionObserver',
];

export const ORDER_NOTE =
  'Три наблюдателя попали в три разных места. `MutationObserver` сработал ещё в той же задаче, раньше `setTimeout` и раньше кадра: его колбэк — микрозадача. `ResizeObserver` — внутри кадра, после `rAF`. А `IntersectionObserver` пришёл последним, **даже позже `setTimeout`, поставленного из `ResizeObserver`**: пересечения браузер считает в кадре, а колбэк ставит в очередь отдельной задачей.';

export const ORDER_ROWS: { k: string; when: string; sees: string; tone: 'info' | 'warn' | 'ok' }[] = [
  {
    k: 'MutationObserver',
    when: 'микрозадача в той же задаче, где менялся DOM',
    sees: 'Что поменялось в дереве: узлы, атрибуты, текст. Размеров ещё никто не считал — прочитать их здесь значит заставить браузер посчитать раскладку немедленно.',
    tone: 'info',
  },
  {
    k: 'ResizeObserver',
    when: 'кадр: после `rAF` и раскладки, до отрисовки',
    sees: 'Готовые размеры. Если колбэк их поменяет, браузер посчитает раскладку ещё раз в этом же кадре и снова спросит наблюдателей — но только про более глубокие элементы.',
    tone: 'warn',
  },
  {
    k: 'IntersectionObserver',
    when: 'считается в кадре после `ResizeObserver`, колбэк — отдельной задачей после кадра',
    sees: 'Пересечения по уже нарисованной геометрии. Всё, что колбэк поменяет, попадёт только в следующий кадр.',
    tone: 'ok',
  },
];

export const PLAIN_TASK_AFTER =
  'Как фотограф на свадьбе: снимок он делает в момент, когда все стоят (кадр), а фотографии присылает потом, отдельным письмом. Письмо может прийти после других писем, отправленных в тот же вечер, — так и колбэк IntersectionObserver встаёт в очередь задач позади тех, что уже там стоят.';

export const FRAME_NOTE =
  'В теме [«Кадр браузера»](/render/render-pipeline/#s1) порядок записан шагами спецификации: `rAF` → `ResizeObserver` → `IntersectionObserver` → отрисовка. Он верен для **расчёта**. Колбэк `IntersectionObserver` спецификация велит не звать на месте, а поставить в очередь задачей («queue an intersection observer task») — поэтому в журнале он оказался за двумя задачами, поставленными раньше.';

// ─── Раздел 2. IntersectionObserver ────────────────────────────────────────────────────────

export const IO_USAGE_CODE = `const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    console.log(e.target.id, e.isIntersecting, e.intersectionRatio);
  }
}, {
  root: scroller,                  // по умолчанию null — окно браузера
  rootMargin: '0px 0px 200px 0px', // раздвинуть корень вниз на 200px
  threshold: [0, 0.5, 1],          // сообщать на 0 %, 50 % и 100 %
});
io.observe(card);`;

export const IO_OPTION_ROWS: { k: string; v: string; d: string }[] = [
  {
    k: 'root',
    v: '`null` или элемент',
    d: '`null` — окно верхнего документа. Элемент должен быть **предком** цели: про чужую ветку дерева запись придёт с `isIntersecting: false` и нулями.',
  },
  {
    k: 'rootMargin',
    v: 'как `margin`: 1–4 значения',
    d: 'Раздвигает (плюс) или сжимает (минус) прямоугольник корня. Только `px` и `%`: `1em` — `SyntaxError`. Проценты верха и низа — от высоты корня, левого и правого — от ширины.',
  },
  {
    k: 'threshold',
    v: 'число или массив от 0 до 1',
    d: 'Пороги, на которых сообщать. Сортируются по возрастанию, повторы остаются: `[0.5, 0, 1, 0.5]` → `[0, 0.5, 0.5, 1]`. Значение вне 0…1 — `RangeError`. Без опции — `[0]`.',
  },
];

export const PLAIN_ROOT_MARGIN =
  'Как зона у турникета в метро: створки открываются, когда вы ещё в шаге от них, а не когда упёрлись. `rootMargin: "0px 0px 600px 0px"` раздвигает нижний край окна на 600 пикселей вниз — цель «пересекается», когда до экрана ей ещё ехать полэкрана.';

/** Учебная модель записи IntersectionObserver. Исполняется демо и тестом; сверена с Chromium. */
export const IO_CODE = `// Прямоугольник — { x, y, width, height } в пикселях окна, как у getBoundingClientRect().

// "10px 5%" → ['10px', '5%', '10px', '5%']: верх, право, низ, лево — как у margin в CSS.
function parseMargin(text) {
  const t = text.trim() ? text.trim().split(/\\s+/) : ['0px'];
  if (t.length === 1) return [t[0], t[0], t[0], t[0]];
  if (t.length === 2) return [t[0], t[1], t[0], t[1]];
  if (t.length === 3) return [t[0], t[1], t[2], t[1]];
  return t;
}

// Раздвинуть корень на rootMargin. Проценты — от высоты (верх, низ) и ширины (бока).
// Округление как в Chromium: пиксели — вниз, проценты — к нулю.
function expand(root, rootMargin) {
  const [top, right, bottom, left] = parseMargin(rootMargin).map((v, i) =>
    v.endsWith('%')
      ? Math.trunc((parseFloat(v) / 100) * (i % 2 ? root.width : root.height))
      : Math.floor(parseFloat(v)),
  );
  return {
    x: root.x - left,
    y: root.y - top,
    width: root.width + left + right,
    height: root.height + top + bottom,
  };
}

// Общая часть двух прямоугольников. Касание краями — тоже общая часть, нулевой площади.
function intersect(a, b) {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (left > right || top > bottom) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

// Одна запись: что браузер посчитает про цель в этом кадре.
function computeEntry(target, root, rootMargin, thresholds) {
  const rootBounds = expand(root, rootMargin);
  const hit = intersect(target, rootBounds);
  const intersectionRect = hit ?? { x: 0, y: 0, width: 0, height: 0 };
  const targetArea = target.width * target.height;
  const intersectionRatio =
    targetArea > 0
      ? (intersectionRect.width * intersectionRect.height) / targetArea
      : hit ? 1 : 0;                      // у цели без площади — «вся» или «нисколько»
  // «Пересекается» — только если ratio дотянул до первого порога.
  const isIntersecting = hit !== null && intersectionRatio >= thresholds[0];
  // Номер ступеньки: сколько порогов достигнуто. Не пересекается — ступенька 0.
  let thresholdIndex = thresholds.findIndex((t) => t > intersectionRatio);
  if (thresholdIndex === -1) thresholdIndex = thresholds.length;
  if (!isIntersecting) thresholdIndex = 0;
  return { rootBounds, intersectionRect, intersectionRatio, isIntersecting, thresholdIndex };
}

// Два кадра подряд: будет ли вызов и какие пороги пройдены между ними.
// Сразу после observe() регистрация помнит ступеньку -1 — поэтому первый вызов будет всегда.
function compareFrames(prev, next, thresholds) {
  const fires = next.thresholdIndex !== prev.thresholdIndex;
  const lo = Math.max(0, Math.min(prev.thresholdIndex, next.thresholdIndex));
  const hi = Math.max(prev.thresholdIndex, next.thresholdIndex);
  return { fires, crossed: prev.thresholdIndex < 0 ? [] : thresholds.slice(lo, hi) };
}`;

export const PLAIN_RATIO =
  'Как лестница с отметками на стене. Пороги — отметки, `intersectionRatio` — уровень воды, номер ступеньки — сколько отметок уже под водой. Браузер пишет вам, только когда вода перешла через отметку, а не когда она чуть поднялась между двумя отметками.';

/** Разобранные геометрии. Корень 0,0 200×100; тест сверяет каждую с моделью и с Chromium. */
export const IO_ROOT = { x: 0, y: 0, width: 200, height: 100 };

export const IO_CASES: {
  k: string;
  target: { x: number; y: number; width: number; height: number };
  rootMargin: string;
  thresholds: number[];
  ratio: number;
  isIntersecting: boolean;
  why: string;
}[] = [
  {
    k: 'касается нижним краем',
    target: { x: 20, y: 100, width: 50, height: 40 },
    rootMargin: '0px',
    thresholds: [0],
    ratio: 0,
    isIntersecting: true,
    why: 'Площадь пересечения — ноль, но края касаются. С порогом `0` это «пересекается»: ratio 0 достиг первого порога.',
  },
  {
    k: 'то же, порог 0.5',
    target: { x: 20, y: 100, width: 50, height: 40 },
    rootMargin: '0px',
    thresholds: [0.5],
    ratio: 0,
    isIntersecting: false,
    why: 'Та же геометрия. Первый порог — `0.5`, до него далеко, и `isIntersecting` — `false`.',
  },
  {
    k: 'видна на четверть, порог 0.5',
    target: { x: 20, y: 70, width: 50, height: 120 },
    rootMargin: '0px',
    thresholds: [0.5],
    ratio: 0.25,
    isIntersecting: false,
    why: 'Цель **видна**, 30 из 120 пикселей высоты. Но ratio 0.25 меньше первого порога — и браузер говорит `false`.',
  },
  {
    k: 'видна на 90 %, порог 1',
    target: { x: 20, y: 10, width: 50, height: 100 },
    rootMargin: '0px',
    thresholds: [1],
    ratio: 0.9,
    isIntersecting: false,
    why: 'Частый случай с `threshold: 1` — «покажи, когда видна целиком». До этого момента `isIntersecting` — `false`.',
  },
  {
    k: 'ниже окна, в зоне rootMargin',
    target: { x: 20, y: 150, width: 50, height: 40 },
    rootMargin: '0px 0px 100px 0px',
    thresholds: [0],
    ratio: 1,
    isIntersecting: true,
    why: 'Корень раздвинут вниз на 100px, до 200. Цель на экране не видна, но для наблюдателя она пересекается целиком.',
  },
  {
    k: 'полоса нулевой ширины',
    target: { x: 50, y: 20, width: 0, height: 40 },
    rootMargin: '0px',
    thresholds: [0, 0.5, 1],
    ratio: 1,
    isIntersecting: true,
    why: 'Площади у цели нет, делить не на что. Тогда ratio — `1`, если цель внутри корня или касается его, и `0`, если нет.',
  },
];

export const IO_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Первый вызов — сразу после `observe()`',
    d: 'Даже если цель далеко за экраном. Новая регистрация помнит ступеньку −1, любая посчитанная ступенька от неё отличается — значит, запись. Это не ошибка, а ответ «где цель сейчас», и колбэк обязан проверять `isIntersecting`, а не считать сам вызов сигналом «появилась».',
    tone: 'warn',
  },
  {
    t: '`isIntersecting` зависит от порогов',
    d: 'Спецификация называет пересечением любое касание. Chromium 153, Firefox 155 и WebKit 26.6 ответили иначе: пока ratio меньше первого порога, `isIntersecting` — `false`. На стенде так прошли все 2400 случайных геометрий в Chromium; в Firefox и WebKit расходились только доли пикселя.',
    tone: 'err',
  },
  {
    t: 'Между порогами — тишина',
    d: 'Цель с порогами `[0, 1]`, которая выезжает с 10 % до 90 %, не даст ни одного вызова: ступенька всё время одна. Нужен процент для полосы прогресса — ставьте порогов больше, например `[0, 0.1, … , 1]`.',
  },
  {
    t: '`display: none` — не пересекается',
    d: 'Коробки нет, прямоугольник нулевой и стоит в начале координат: `isIntersecting: false`, ratio 0. Тот же ответ у элемента вне документа.',
  },
];

export const PLAIN_VISIBILITY =
  'Обычный наблюдатель отвечает «попадает ли цель в рамку», но не «видит ли её человек»: цель может лежать под другим блоком или быть прозрачной. Версия 2 спрашивает и это, но дорого — ей приходится проверять всё, что нарисовано поверх.';

export const IO_V2_NOTE =
  '**IntersectionObserver v2** добавляет в запись поле `isVisible`: цель не перекрыта, не прозрачна, не размыта фильтром и не искажена трансформацией. Включается опцией `trackVisibility: true`, и вместе с ней обязательна `delay` не меньше 100 мс — минимальный интервал между записями для одной цели. Chromium 153 без `delay` бросает `NotSupportedError`. На стенде цель внутри блока с `opacity: .5` получила `isIntersecting: true` и `isVisible: false`. Ради этого v2 и придуман: против «невидимых» кнопок и рамок с чужим содержимым, которым подсовывают клик. Для ленивой загрузки он не нужен.';

export const IO_THRESHOLD_OPTIONS: ThresholdOption[] = [
  { value: '0', label: '[0]', thresholds: [0] },
  { value: 'half', label: '[0, 0.5, 1]', thresholds: [0, 0.5, 1] },
  { value: 'one', label: '[1]', thresholds: [1] },
  { value: 'quarters', label: '[0.25, 0.5, 0.75]', thresholds: [0.25, 0.5, 0.75] },
];

export const IO_DEMO_CAPTION =
  'Прокручивайте рамку и двигайте нижний `rootMargin`. Строки журнала с пометкой `rAF` — это расчёт по `IO_CODE` из этой темы: модель заранее говорит, будет ли вызов. Строки «задача» — настоящий `IntersectionObserver` браузера с теми же опциями; номер кадра у него тот же, что у предсказания, а пришёл он позже — отдельной задачей. Пунктир под рамкой — зона `rootMargin`: цель, заехавшая туда, уже «пересекается», хотя её не видно. С порогами `[0.25, 0.5, 0.75]` проверьте, что частично видимая цель долго остаётся `false`.';

// ─── Раздел 3. ResizeObserver ──────────────────────────────────────────────────────────────

export const RO_USAGE_CODE = `const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const { inlineSize, blockSize } = e.contentBoxSize[0];
    console.log(e.target.id, inlineSize, blockSize);
  }
});
ro.observe(card);                                   // content-box — по умолчанию
ro.observe(frame, { box: 'border-box' });
ro.observe(canvas, { box: 'device-pixel-content-box' });`;

export const RO_BOX_ROWS: { k: string; what: string; stand: string }[] = [
  {
    k: '`content-box`',
    what: 'Ширина и высота содержимого — без `padding` и рамки. По умолчанию.',
    stand: 'блок `width: 100.3px; padding: 10px; border: 2px` — `100.296875`: ширина хранится долями 1/64 пикселя',
  },
  {
    k: '`border-box`',
    what: 'С `padding` и рамкой — та коробка, которую видно на экране.',
    stand: '`124.296875` = 100.296875 + 2 × 10 + 2 × 2',
  },
  {
    k: '`device-pixel-content-box`',
    what: 'Содержимое в **целых пикселях экрана**, с учётом того, как коробка легла на пиксельную сетку. Нужен холсту: столько пикселей у буфера — столько у экрана, и картинка не мылится.',
    stand: 'при DPR 1 тот же блок со сдвигом 10.3px — `101`, без сдвига — `100`. Это не `Math.round(width × devicePixelRatio)`',
  },
];

export const RO_BOX_NOTE =
  'Опция `box` решает, **на что реагировать**, а не что прийти в записи: в записи всегда все три размера. Блок с `box-sizing: border-box`, у которого `padding` вырос с 10 до 30 пикселей, на стенде позвал наблюдателя `content-box` (содержимое сжалось со 180 до 140) и промолчал у наблюдателя `border-box` — внешний размер остался 200. Как холст подгоняет буфер под пиксели экрана — в теме [«Canvas 2D»](/render/canvas/#s2).';

export const RO_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Первая запись — всегда, даже про ноль',
    d: 'Новое наблюдение помнит размер −1×−1, и любой настоящий размер от него отличается. Блок `0×0`, блок с `display: none` и строчный `<span>` получили первую запись с нулями.',
  },
  {
    t: '`transform` размер не меняет',
    d: '`transform: scale(2)` растягивает картинку уже после раскладки, коробка остаётся прежней — у наблюдателей `content-box` и `border-box` вызова нет. Следить за «видимым» размером после трансформации ResizeObserver не умеет.',
    tone: 'warn',
  },
  {
    t: 'Скрыть — тоже изменение',
    d: '`display: none` у наблюдаемого блока даёт запись с размером `0×0`, обратное `display: block` — запись с настоящим. Скрытие вкладкой, `visibility: hidden` и уход за экран коробку не меняют, записи нет.',
  },
  {
    t: 'Только размер, не положение',
    d: 'Блок, который сдвинулся, но не поменял размер, записи не даст. За положением на экране следит IntersectionObserver, и то — грубо, ступеньками порогов.',
  },
];

export const RO_LOOP_MESSAGE = 'ResizeObserver loop completed with undelivered notifications.';

export const PLAIN_DEPTH =
  'Как правка документа сверху вниз. Редактор прошёлся по главам, потом по разделам внутри глав, потом по абзацам — каждый проход глубже прошлого. Если правка в абзаце требует переписать главу, в этот проход редактор к главе не вернётся: иначе он мог бы ходить по кругу вечно. Глава ждёт завтрашнего прохода, а в журнале появляется запись «не всё успели».';

/** Учебная модель одного кадра ResizeObserver. Исполняется демо и тестом; сверена с Chromium. */
export const RO_CODE = `// Один кадр глазами ResizeObserver.
// depthOf — глубина узла в дереве; observed — цели в порядке observe();
// dirty — у кого размер не совпадает с последним сообщённым;
// reactions — чьи размеры колбэк меняет, получив запись про цель.
function resizeFrame(depthOf, observed, dirty, reactions) {
  const rounds = [];
  let depth = 0;                                   // в начале кадра годится любая глубина
  for (;;) {
    const active = observed.filter((id) => dirty.has(id) && depthOf[id] > depth);
    if (active.length === 0) break;
    rounds.push(active);                           // один вызов колбэка, все записи круга
    for (const id of active) dirty.delete(id);     // размер сообщён и запомнен
    depth = Math.min(...active.map((id) => depthOf[id]));
    for (const id of active) for (const r of reactions[id] ?? []) dirty.add(r);
  }
  // Кто изменился, но не глубже последнего круга, ждёт следующего кадра.
  const skipped = observed.filter((id) => dirty.has(id));
  return { rounds, skipped, error: skipped.length > 0 };
}`;

export const RO_LOOP_STEPS: { k: string; d: string }[] = [
  {
    k: 'Раскладка',
    d: 'Браузер посчитал все размеры. Глубина отсечки — 0: годится любой элемент.',
  },
  {
    k: 'Сбор',
    d: 'Кто из наблюдаемых изменился и лежит **глубже отсечки**, идёт в круг. Остальные изменённые откладываются.',
  },
  {
    k: 'Вызов',
    d: 'Колбэк получает записи круга одним массивом. Отсечка становится глубиной самого мелкого из них.',
  },
  {
    k: 'Повтор',
    d: 'Если колбэк что-то поменял, раскладка считается заново, и сбор повторяется с новой отсечкой. Глубина растёт с каждым кругом, поэтому кругов не больше, чем уровней в дереве.',
  },
  {
    k: 'Ошибка',
    d: 'Кругов больше нет, а отложенные остались — браузер бросает в `window` событие `error` с текстом про «undelivered notifications». Отложенные получат запись в следующем кадре.',
  },
];

export const RO_LOOP_BAD_CODE = `// Высота карточки — половина ширины. Колбэк меняет размер того же элемента.
new ResizeObserver(([entry]) => {
  entry.target.style.height = entry.contentRect.width / 2 + 'px';
}).observe(card);`;

export const RO_LOOP_FIX_CODE = `.card {
  aspect-ratio: 2 / 1;   /* то же самое без JS и без лишнего круга */
}`;

export const RO_LOOP_NOTE =
  'На стенде этот код дал два вызова и **одну** ошибку `ResizeObserver loop completed…`. Колбэк поменял высоту той же карточки — её глубина не больше отсечки, и запись отложилась до следующего кадра. Там высота уже правильная, колбэк записывает то же значение, и цикл затихает. Ошибка безвредна для кадра, но засоряет сбор ошибок в продакшене, а её внешний вид — «loop» — пугает зря. Пропорции даёт CSS; если без JS никак, меняют размер **детей** наблюдаемого элемента — они глубже, и их доставят в этом же кадре.';

export const RO_SCENES: RoScene[] = [
  {
    id: 'down',
    label: 'вниз по дереву',
    nodes: [
      { id: 'A', parent: null },
      { id: 'B', parent: 'A' },
      { id: 'C', parent: 'B' },
    ],
    observed: ['A', 'B', 'C'],
    start: 'A',
    reactions: { A: ['B'], B: ['C'] },
    note: 'Колбэк про **A** растягивает **B**, про **B** — **C**. Каждый следующий элемент глубже прошлого, поэтому все три круга укладываются в один кадр, без ошибки.',
  },
  {
    id: 'up',
    label: 'вверх',
    nodes: [
      { id: 'A', parent: null },
      { id: 'B', parent: 'A' },
      { id: 'C', parent: 'B' },
    ],
    observed: ['A', 'B', 'C'],
    start: 'C',
    reactions: { C: ['A'] },
    note: 'Колбэк про самый глубокий **C** растягивает **A**. A мельче отсечки — в этом кадре его не доставят: ошибка, и запись про A приходит в следующем кадре.',
  },
  {
    id: 'sibling',
    label: 'сосед',
    nodes: [
      { id: 'A', parent: null },
      { id: 'B', parent: 'A' },
      { id: 'D', parent: 'A' },
    ],
    observed: ['A', 'B', 'D'],
    start: 'B',
    reactions: { B: ['D'] },
    note: '**B** и **D** — соседи, глубина одна. «Глубже» строго больше, а не «не мельче», поэтому сосед тоже ждёт следующего кадра.',
  },
  {
    id: 'self',
    label: 'сам себя',
    nodes: [
      { id: 'A', parent: null },
      { id: 'B', parent: 'A' },
    ],
    observed: ['A', 'B'],
    start: 'B',
    reactions: { B: ['B'] },
    note: 'Колбэк про **B** каждый раз растит сам **B**. Это бесконечный цикл, но не зависание: по одной записи и одной ошибке на кадр, страница живёт дальше. Демо останавливает его через четыре кадра.',
  },
  {
    id: 'mixed',
    label: 'вниз и вверх',
    nodes: [
      { id: 'A', parent: null },
      { id: 'B', parent: 'A' },
      { id: 'C', parent: 'B' },
      { id: 'D', parent: 'C' },
    ],
    observed: ['A', 'B', 'C', 'D'],
    start: 'A',
    reactions: { A: ['C'], C: ['B', 'D'] },
    note: '**A** растит **C** — второй круг. **C** растит своего ребёнка **D** и своего родителя **B**: D глубже отсечки и успевает в третий круг, B — нет и уезжает в следующий кадр.',
  },
];

export const RO_DEMO_CAPTION =
  'Каждый блок — настоящий `<div>` под настоящим `ResizeObserver`; «толчок» растягивает на 1px блок, с которого начинается сцена, а колбэк растягивает тех, кого велит сцена. Рядом — что предсказывает `RO_CODE` для тех же кадров. Номер круга внутри кадра — номер вызова колбэка. Ошибка `ResizeObserver loop…` ловится обработчиком `error` на `window` и в консоль не уходит.';

// ─── Раздел 4. MutationObserver ────────────────────────────────────────────────────────────

export const MO_HTML = `<style>#list {}</style>
<ul id="list" class="menu"><li>Первый</li></ul>`;

/** Тест исполняет эту строку в Chromium на `MO_HTML` и сверяет журнал с `MO_LOG`. */
export const MO_CODE = `async function probeMutations() {
  const list = document.querySelector('#list');
  const log = [];
  const mo = new MutationObserver((records) => {
    log.push(\`вызов, записей: \${records.length}\`);
    for (const r of records) {
      const what = r.type === 'childList'
        ? \`+\${r.addedNodes.length} −\${r.removedNodes.length}\`
        : \`\${r.attributeName ?? 'текст'}, было «\${r.oldValue}»\`;
      log.push(\`  \${r.type} · \${r.target.nodeName} · \${what}\`);
    }
  });
  mo.observe(list, {
    subtree: true,               // и потомки, а не только сам list
    childList: true,             // добавление и удаление узлов
    attributes: true,            // атрибуты
    attributeOldValue: true,     // прежнее значение атрибута — в записи
    characterData: true,         // текст в текстовых узлах
    characterDataOldValue: true,
  });

  list.classList.add('open');                          // атрибут class
  list.classList.add('open');                          // ещё раз — класс уже есть
  list.firstElementChild.firstChild.data = 'Первый*';  // текст внутри узла
  list.append(document.createElement('li'));           // новый ребёнок
  list.firstElementChild.textContent = 'Первый!';      // текстовый узел заменён целиком
  document.styleSheets[0].cssRules[0].style.color = 'red';  // правило CSS — не DOM

  await null;                                          // колбэк — микрозадача: дождёмся

  list.title = 'перед отключением';
  const missed = mo.takeRecords();                     // недоставленное — забрать вручную
  mo.disconnect();
  log.push(\`takeRecords: \${missed.length}\`);
  return log;
}`;

/** Вывод `probeMutations()` в Chromium 153. Сверяется тестом. */
export const MO_LOG = [
  'вызов, записей: 5',
  '  attributes · UL · class, было «menu»',
  '  attributes · UL · class, было «menu open»',
  '  characterData · #text · текст, было «Первый»',
  '  childList · UL · +1 −0',
  '  childList · LI · +1 −1',
  'takeRecords: 1',
];

export const MO_NOTE =
  'Шесть правок — **один** вызов с пятью записями: колбэк ждёт конца задачи и получает всё, что накопилось. Правило в таблице стилей записи не дало вовсе. Второй `classList.add("open")` запись дал, хотя класс уже был: наблюдатель сообщает о **записи** в атрибут, а не о смене значения, и `oldValue` у неё равен новому. А последняя правка до колбэка не дошла бы совсем: `disconnect()` выбрасывает недоставленные записи, и `takeRecords()` — единственный способ их забрать.';

export const MO_OPTION_ROWS: { k: string; d: string }[] = [
  { k: '`childList`', d: 'Добавление и удаление детей. Запись — на родителе: `addedNodes`, `removedNodes`, а также соседи `previousSibling` и `nextSibling`.' },
  { k: '`attributes`', d: 'Любая запись в атрибут, в том числе `style` и `class`. `attributeFilter: ["class"]` сужает до перечисленных имён и сам включает `attributes`.' },
  { k: '`characterData`', d: 'Правка текста **внутри** текстового узла (`node.data = …`). Присваивание `textContent` элементу — это уже не она: старый текстовый узел удаляется, новый вставляется, и запись — `childList`.' },
  { k: '`subtree`', d: 'Те же виды записей для всех потомков. Без него наблюдатель видит только сам элемент: атрибут ребёнка на стенде записи не дал.' },
  { k: '`attributeOldValue`, `characterDataOldValue`', d: 'Положить в запись прежнее значение. Сами включают свой вид записей. Без них `oldValue` — `null`.' },
];

export const MO_KIND_ERROR =
  'Хотя бы один вид записей обязателен. `observe(el, { subtree: true })` — `TypeError: The options object must set at least one of \'attributes\', \'characterData\', or \'childList\' to true.`';

export const PLAIN_STYLE =
  'MutationObserver смотрит в чертёж — разметку, а стили живут в другом документе. Если поменяли таблицу стилей, чертёж не тронут, и датчику сообщать не о чем, хотя на экране всё стало другим.';

export const MO_STYLE_ROWS: { k: string; v: string; tone: 'ok' | 'err' }[] = [
  { k: '`el.style.color = "green"`', v: 'запись `attributes`, `style` — это атрибут', tone: 'ok' },
  { k: '`el.classList.add("x")`', v: 'запись `attributes`, `class`', tone: 'ok' },
  { k: 'правка правила в `document.styleSheets`', v: 'ни одной записи', tone: 'err' },
  { k: '`el.animate(…)`, CSS-анимация, переход', v: 'ни одной записи', tone: 'err' },
  { k: '`:hover`, медиазапрос, контейнерный запрос', v: 'ни одной записи — это не правка DOM', tone: 'err' },
];

export const MO_STYLE_NOTE =
  'Наблюдать **вычисленный** стиль нечем: ни один наблюдатель не сообщает «у элемента поменялся `color`». Если нужен ответ на стиль, ловят его следствие: размер — ResizeObserver, состояние медиазапроса — событие `change` у `matchMedia`, конец анимации — `animationend`.';

// ─── Раздел 5. Применения ──────────────────────────────────────────────────────────────────

export const LAZY_NOTE =
  'Для обычных `<img>` и `<iframe>` наблюдатель не нужен: `loading="lazy"` делает то же самое силами браузера, с запасом 3000px и поправкой на скорость сети. Разбор — в теме [«Картинки», раздел «lazy и приоритет»](/render/images/#s5). IntersectionObserver остаётся там, куда `loading` не поставить: фоновые картинки, видео, тяжёлые виджеты, свой запас.';

/** Тест исполняет эту строку в Chromium: грузятся фоны только в пределах окна и запаса. */
export const LAZY_CODE = `// Фоновые картинки: у них нет loading="lazy"
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;          // первый вызов приходит про всех
    e.target.style.backgroundImage = \`url(\${e.target.dataset.bg})\`;
    io.unobserve(e.target);                   // загрузили — следить незачем
  }
}, { rootMargin: '0px 0px 600px 0px' });       // начинать за 600px до экрана

document.querySelectorAll('[data-bg]').forEach((el) => io.observe(el));`;

export const SENTINEL_CODE = `// Лента: пустой «сторож» стоит после последней карточки
const sentinel = document.querySelector('#feed-end');
let loading = false;

const io = new IntersectionObserver(async ([entry]) => {
  if (!entry.isIntersecting || loading) return;
  loading = true;
  await loadNextPage();                       // дописывает карточки перед сторожем
  loading = false;
}, { rootMargin: '0px 0px 800px 0px' });
io.observe(sentinel);`;

export const SENTINEL_FIX_CODE = `  await loadNextPage();
  loading = false;
  io.unobserve(sentinel);    // новая регистрация начинает со ступеньки −1,
  io.observe(sentinel);      // и ближайший кадр снова пришлёт запись`;

export const SENTINEL_NOTE =
  'На стенде (окно 600px, страница — три карточки по 40px) первая версия загрузила **одну** страницу и встала. Сторож после неё всё ещё в зоне `rootMargin`: ступенька не поменялась, записи нет, и следующая загрузка не начнётся, пока пользователь не прокрутит. Если прокручивать нечего, лента не догрузится никогда. Повторный `observe()` сбрасывает память регистрации — с ним лента грузилась, пока сторож не уехал за 1400px (окно + запас).';

export const VIRTUAL_NOTE =
  'В виртуальном списке сторожа нет: строки за окном не существуют, а последняя отрисованная появляется и исчезает при каждой перерисовке. Там подгрузку решает тот же расчёт окна — разбор в теме [«Виртуальные списки», раздел «Заголовки и подгрузка»](/render/virtual-lists/#s6).';

export const APPLY_ROWS: { task: string; tool: string; why: string; tone: 'ok' | 'info' | 'warn' }[] = [
  {
    task: 'картинка или `<iframe>` ниже экрана',
    tool: '`loading="lazy"`',
    why: 'браузер сам выбирает запас и знает о сети; наблюдатель тут — лишний код',
    tone: 'ok',
  },
  {
    task: 'фон, видео, тяжёлый виджет ниже экрана',
    tool: 'IntersectionObserver + `rootMargin`',
    why: '`loading` к ним не поставить; после загрузки — `unobserve`',
    tone: 'info',
  },
  {
    task: 'оживить остров, когда его видно',
    tool: 'IntersectionObserver на детях острова',
    why: 'так устроен `client:visible` в Astro — [«Острова», раздел «Директивы»](/frameworks/islands/#s4)',
    tone: 'info',
  },
  {
    task: 'бесконечная лента',
    tool: 'сторож + IntersectionObserver, повторный `observe` после загрузки',
    why: 'без повтора лента встаёт, если страница коротка',
    tone: 'warn',
  },
  {
    task: 'вёрстка компонента зависит от ширины его места',
    tool: '`@container`',
    why: 'CSS применит правило в той же раскладке, без JS и без второго круга — [«Адаптивность», раздел «Контейнеры»](/render/responsive/#s4)',
    tone: 'ok',
  },
  {
    task: 'JS должен знать размер: холст, график, виртуальный список',
    tool: 'ResizeObserver',
    why: 'CSS не перерисует буфер холста и не пересчитает окно списка; `device-pixel-content-box` — для холста',
    tone: 'info',
  },
  {
    task: 'узнать, что чужой код поменял DOM',
    tool: 'MutationObserver',
    why: 'сторонний виджет, расширение браузера, редактор с `contenteditable`; свои изменения вы и так знаете',
    tone: 'info',
  },
];

export const CQ_VS_RO_NOTE =
  'Container queries и ResizeObserver решают похожую задачу в разных местах кадра. `@container` срабатывает **внутри** раскладки: браузер знает ширину контейнера и сразу применяет нужные правила. ResizeObserver сообщает размер **после** раскладки — и если колбэк в ответ поменяет вёрстку, браузеру придётся считать её второй раз, а то и откладывать на следующий кадр. Поэтому правило простое: если ответ на размер — другой CSS, это `@container`; если ответ — код (перерисовать холст, пересчитать строки), это ResizeObserver.';

// ─── Демо и тонкие места ───────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Первый вызов IntersectionObserver — не «цель появилась»',
    d: 'Он приходит после `observe()` всегда, и для цели за экраном — с `isIntersecting: false`. Код, который грузит данные на сам факт вызова, загрузит всё сразу.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`isIntersecting: false` у видимой цели',
    d: 'С `threshold: [0.5]` цель, видная на четверть, — `false` во всех трёх движках. Нужно «хоть пиксель» — первым порогом ставьте `0`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Колбэк IntersectionObserver опаздывает на кадр',
    d: 'Пересечение посчитано в кадре, а колбэк — отдельная задача после него. Всё, что вы покажете в ответ, появится не раньше следующего кадра. Для «прилипания» и параллакса это видно глазом — их делают через CSS (`position: sticky`, анимации по прокрутке).',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Лента со сторожем встаёт на коротких страницах',
    d: 'Сторож остался в зоне после загрузки — записи нет, следующей загрузки тоже. Лечится повторным `observe()` после каждой загрузки.',
    code: 'io.unobserve(sentinel); io.observe(sentinel);',
    tone: 'err',
  },
  {
    n: '05',
    t: '`ResizeObserver loop completed…` от безобидного кода',
    d: 'Достаточно одного изменения размера самой цели в её же колбэке. Кадр не сломан, отложенная запись придёт следующим кадром, но сборщик ошибок будет получать её от каждого пользователя. Пропорции — `aspect-ratio`, зависимость от ширины места — `@container`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'ResizeObserver не видит `transform`',
    d: '`scale()` меняет картинку, а не коробку. Видимый размер после трансформации — только `getBoundingClientRect()`.',
  },
  {
    n: '07',
    t: '`textContent` — это `childList`, а не `characterData`',
    d: 'Присваивание `textContent` удаляет текстовый узел и вставляет новый. Наблюдатель только с `characterData` такую правку не увидит.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`disconnect()` теряет недоставленное',
    d: 'Записи, накопленные в текущей задаче, пропадают молча. Если они нужны — сначала `takeRecords()`.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Запись в атрибут без смены значения — тоже запись',
    d: 'Повторный `classList.add`, `setAttribute` с тем же значением, фреймворк, который переписывает `style` целиком, — каждый раз запись. Колбэк, который сам пишет в наблюдаемый атрибут, зациклится: проверяйте `oldValue` против текущего значения.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Колбэк MutationObserver задерживает кадр',
    d: 'Это микрозадача: пока она и её последствия не кончились, кадра не будет. Тяжёлую работу по записям откладывают в задачу или в `requestAnimationFrame`.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'HTML Standard — Update the rendering',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering',
    what: 'порядок шагов кадра: `rAF`, цикл ResizeObserver с глубиной, пересечения',
  },
  {
    title: 'Intersection Observer (W3C)',
    href: 'https://w3c.github.io/IntersectionObserver/',
    what: '`rootMargin`, пороги, расчёт пересечения, `previousThresholdIndex = -1`, колбэк задачей',
  },
  {
    title: 'Intersection Observer v2',
    href: 'https://w3c.github.io/IntersectionObserver/v2/',
    what: '`trackVisibility`, `delay`, `isVisible`',
  },
  {
    title: 'Resize Observer (CSSWG)',
    href: 'https://drafts.csswg.org/resize-observer/',
    what: 'виды коробок, начальный размер −1×−1, глубина и текст ошибки',
  },
  {
    title: 'DOM Standard — Mutation observers',
    href: 'https://dom.spec.whatwg.org/#mutation-observers',
    what: 'виды записей, опции, микрозадача, `takeRecords`',
  },
  {
    title: 'MDN — IntersectionObserver',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver',
    what: 'справочник по опциям и полям записи',
  },
];

export const RELATED =
  'Смежное на сайте: [Кадр браузера, раздел «Кадр по шагам»](/render/render-pipeline/#s1) — весь кадр целиком. [Event loop, раздел «Checkpoint»](/js/event-loop/#s3) — когда выполняются микрозадачи. [Картинки, раздел «lazy и приоритет»](/render/images/#s5) — `loading="lazy"` и его запас. [Виртуальные списки, раздел «Разная высота»](/render/virtual-lists/#s3) — ResizeObserver на строках списка. [Адаптивность, раздел «Контейнеры»](/render/responsive/#s4) — `@container`. [Острова, раздел «Директивы»](/frameworks/islands/#s4) — `client:visible`. [Angular без zone.js, раздел «zone.js»](/frameworks/angular-zoneless/#s2) — какие наблюдатели zone.js подменяет, а какие нет.';
