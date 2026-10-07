import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { FeedGroup } from '@/widgets/scroll-lab/model/types';

/**
 * Данные темы «Прокрутка изнутри: липкие шапки, якорь, цепочка и возврат на место».
 *
 * Тема написана здесь, 2026-10-02.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (Playwright 1.63, headless shell), Node 24.11.0, macOS, октябрь
 * 2026. Скрипты стенда — в каталоге агента в scratchpad (`sticky*.mjs`, `anchor*.mjs`,
 * `misc*.mjs`, `restore*.mjs`, `sbw*.mjs`); всё, что попало в литералы ниже, снимается заново
 * в `tests/unit/scrolling.test.ts` — тем же браузером, теми же страницами.
 *
 * Как снято:
 *   — липкость: `getBoundingClientRect` элемента при разных `scrollTop`; место «в потоке» —
 *     тот же замер с `position: static`. `STICKY_CODE` сверен на 800 случайных раскладках
 *     (высота окна, `padding` контейнера и секции, поля, `top` и `bottom` вместе) — расхождений
 *     ноль; в тесте — 150 раскладок с фиксированным зерном;
 *   — якорь: `selectAnchor` получает снимок (`SNAPSHOT_JS` в `widgets/scroll-lab/model/run.ts`),
 *     а Chromium — вставку блока 100px перед каждым узлом дерева по очереди. Проверка: сдвиг
 *     `scrollTop` браузера равен тому, на сколько та же вставка сдвинула выбранный моделью
 *     якорь (замер с `overflow-anchor: none`). На 80 случайных деревьях (`sticky`, `absolute`,
 *     `relative` со сдвигом, пустые блоки, `overflow-anchor: none`, `scroll-padding`) —
 *     расхождений ноль. Модель без исключений, без `scroll-padding` или без правила «в нуле
 *     якоря нет» дала на тех же деревьях 10, 5 и 9 расхождений из 40 — проверка их различает;
 *   — касания: CDP `Input.synthesizeScrollGesture` с `gestureSourceType: 'touch'`, колесо —
 *     `page.mouse.wheel`;
 *   — полоса прокрутки: в headless на macOS системные полосы — наложения шириной 0, и Playwright
 *     вдобавок запускает Chromium с `--hide-scrollbars`. Для замера полоса задана
 *     `::-webkit-scrollbar { width: 12px }`, а флаг снят (`ignoreDefaultArgs`);
 *   — возврат на место: локальный HTTP-сервер, переход по ссылке и «назад». Кеш «назад-вперёд»
 *     в этом прогоне не сработал ни разу (`pageshow.persisted === false`): страница
 *     загружалась заново, и позицию восстанавливал браузер.
 *
 * Не снято, взято из документации и спецификаций:
 *   — что прокрутку ведёт поток композитора и что слушатель `wheel`/`touchstart`/`touchmove`
 *     без `passive` заставляет её ждать главный поток. В «Кадре браузера» это показано записью
 *     экрана; колесо из Playwright при занятом главном потоке страницу не двигает
 *     (см. шапку `tests/e2e/scroll-timeline.spec.ts`), поэтому здесь не воспроизводилось;
 *   — жест «потянуть, чтобы обновить» (только Chrome на Android) и разница `contain`/`none`
 *     в эффекте у края — по спецификации и статье Chrome for Developers; что оба значения
 *     обрывают цепочку и колеса, и касания, — снято;
 *   — пассивность `touchstart` на `window`/`document` по умолчанию — по документации
 *     (стенд «Событий DOM» проверял `wheel` и `touchmove`);
 *   — «приоритетные кандидаты» якоря (элемент в фокусе, найденное через поиск по странице) —
 *     по спецификации CSS Scroll Anchoring;
 *   — исключение `position: sticky` из кандидатов и отказ от якоря при `scrollTop === 0` сняты
 *     только в Chromium; утверждать их для Firefox и Safari стенд не позволяет, текст и не
 *     утверждает.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'контейнер прокрутки',
    d: 'Элемент, у которого `overflow` равен `auto`, `scroll` или `hidden`. У него есть своя позиция прокрутки — `scrollTop`. Главный контейнер страницы — сам документ.',
  },
  {
    k: 'поток композитора',
    d: 'Отдельный поток браузера, который собирает кадр из готовых слоёв и сдвигает их. Прокрутка — тоже сдвиг слоя, поэтому её ведёт он, а не поток с вашим JS.',
  },
  {
    k: 'главный поток',
    d: 'Поток, где исполняется JS страницы, считаются стили и раскладка. Если он занят, обработчики событий ждут своей очереди.',
  },
  {
    k: 'блок-контейнер',
    d: 'Родитель, внутри которого элемент раскладывается. Для липкого элемента это ближайший блочный предок; за его контентный бокс (без `padding`) элемент не выезжает.',
  },
  {
    k: 'якорь прокрутки',
    d: 'Узел, за которым браузер следит, пока над ним меняется содержимое. Если якорь сдвинулся, браузер сдвигает прокрутку на столько же — и на экране ничего не прыгает.',
  },
  {
    k: 'цепочка прокрутки',
    d: 'Когда вложенный контейнер упёрся в край, следующий жест прокручивает его предка — обычно всю страницу.',
  },
  {
    k: 'точка привязки',
    d: 'Позиция, к которой контейнер с `scroll-snap-type` доводит прокрутку сам: например, начало каждой карточки карусели.',
  },
];

export const PLAIN_SCROLL =
  'Как лента транспортёра под окошком кассы. Ленту двигает мотор — поток композитора, — и всё, что на ней лежит, уже упаковано: нарисовано заранее. Кассир — ваш JS — может крикнуть «стоп», но только если ему это разрешили. Если разрешили, мотор перед каждым рывком ждёт, не крикнет ли он, даже когда кассир занят и молчит.';

export const PLAIN_STICKY =
  'Как закладки-разделители в толстой папке. Пока вы листаете раздел «Счета», его разделитель торчит сверху и напоминает, где вы. Дошли до «Договоров» — их разделитель подъезжает снизу и выталкивает прежний. А вынуть разделитель за пределы своего раздела нельзя: он подшит к нему.';

export const PREREQ_NOTE =
  'Тема опирается на две вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Прокрутку ведёт композитор',
    d: 'Браузер рисует страницу слоями, а прокрутка — это сдвиг слоя. Сдвигает его отдельный поток, поэтому страница прокручивается, даже когда JS завис.',
    href: '/render/render-pipeline/#s4',
    hrefLabel: '«Кадр браузера», раздел «Что дешевле двигать»',
    tone: 'info',
  },
  {
    t: 'Пассивные слушатели',
    d: 'Слушатель `wheel` или `touchmove` может отменить прокрутку через `preventDefault()`. `passive: true` — обещание этого не делать, и тогда браузеру не нужно ждать ответа.',
    href: '/render/dom-events/#s6',
    hrefLabel: '«События DOM», раздел «Пассивные слушатели»',
    tone: 'info',
  },
  {
    t: 'Блочная модель',
    d: 'У каждого блока четыре рамки, одна в другой: содержимое (content box), внутренний отступ `padding`, граница `border` и внешнее поле `margin`. Тема говорит «контентный бокс», когда важно, что `padding` в счёт не идёт.',
    tone: 'info',
  },
];

// ─── Раздел 1. Кто крутит ──────────────────────────────────────────────────────────────────

export const WHO_NOTE =
  'Поток композитора двигает слой сам, пока ему никто не мешает. Помешать может одно: слушатель, который вправе отменить жест. Обработчик `scroll` не мешает — он узнаёт о прокрутке **после** того, как она случилась, и отменить её не может.';

/** Касание: CDP `synthesizeScrollGesture` 200px вниз и 200px вправо по одному контейнеру. */
export const TOUCH_ROWS: { css: string; down: boolean; right: boolean; tone: 'ok' | 'warn' }[] = [
  { css: 'auto', down: true, right: true, tone: 'ok' },
  { css: 'none', down: false, right: false, tone: 'warn' },
  { css: 'pan-x', down: false, right: true, tone: 'warn' },
  { css: 'pan-y', down: true, right: false, tone: 'warn' },
];

export const TOUCH_NOTE =
  '`touch-action` — решение, известное до начала жеста. Композитор читает его из CSS и не ждёт главного потока: палец пошёл вбок над `pan-y` — значит, это не прокрутка, и жест достаётся вашим `pointermove`. Слушатель с `preventDefault()` даёт тот же итог, но ценой ожидания на каждом касании.';

export const WHO_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Что заставляет ждать',
    d: 'Слушатель `wheel`, `touchstart` или `touchmove` без `passive: true` на элементе под пальцем или курсором — или на любом его предке. На `window`, `document`, `html` и `body` Chromium считает их пассивными по умолчанию, на остальных элементах — нет.',
    tone: 'warn',
  },
  {
    t: 'Что не заставляет',
    d: 'Обработчики `scroll` и `scrollend`. Они приходят после сдвига и не умеют его отменить. Если в них тяжёлая работа, прокрутка не тормозит, но опаздывает всё, что они рисуют: прогресс-полоса, «прилипшая» вручную шапка.',
  },
  {
    t: 'Поэтому `position: sticky`, а не JS',
    d: 'Шапку, которую двигает обработчик `scroll`, рисует главный поток — на кадр позже прокрутки, а при занятом потоке и того позже. Липкую шапку считает тот же, кто прокручивает, поэтому она не отстаёт.',
    tone: 'ok',
  },
];

// ─── Раздел 2. Липкая шапка ────────────────────────────────────────────────────────────────

/** Сквозной пример раздела: два дня ленты, шапки липнут к верху рамки. */
export const STICKY_HTML = `<div class="feed" style="height: 300px; overflow: auto">
  <section style="height: 400px">
    <h2 style="position: sticky; top: 0; height: 40px; margin: 0">Вчера</h2>
    …сообщения…
  </section>
  <section style="height: 400px">
    <h2 style="position: sticky; top: 0; height: 40px; margin: 0">Сегодня</h2>
    …сообщения…
  </section>
  <div style="height: 600px"></div>
</div>`;

/** Верх шапок относительно верха рамки при разных `scrollTop` — `STICKY_HTML` в Chromium. */
export const STICKY_ROWS: { st: number; first: number; second: number; what: string }[] = [
  { st: 0, first: 0, second: 400, what: 'обе шапки стоят там, где их поставил поток' },
  { st: 100, first: 0, second: 300, what: '«Вчера» прилипла: ей нужно −100, она держится на 0' },
  { st: 360, first: 0, second: 40, what: '«Сегодня» подошла вплотную снизу' },
  { st: 380, first: -20, second: 20, what: '«Вчера» упёрлась в конец своей секции и уезжает вместе с ней' },
  { st: 400, first: -40, second: 0, what: 'сменилась: теперь прилипла «Сегодня»' },
];

export const STICKY_CODE = `// Где окажется липкий элемент. Все числа — в координатах содержимого
// контейнера прокрутки (0 — самый верх содержимого).
//   scrollTop, portHeight — прокрутка и высота видимой части (clientHeight)
//   padTop, padBottom     — padding контейнера: Chromium липнет к его краю
//   top, bottom           — значения из CSS или null, если auto
//   elTop, elHeight       — где элемент стоял бы в потоке и его высота
//   marginTop, marginBottom — поля элемента: они тоже остаются в родителе
//   cbTop, cbBottom       — контентный бокс родителя (блока-контейнера)
function stickyOffset(s) {
  const viewTop = s.scrollTop + s.padTop;
  const viewBottom = s.scrollTop + s.portHeight - s.padBottom;
  let y = s.elTop;
  // bottom: не ниже, чем «нижний край окна минус bottom»
  if (s.bottom !== null) y = Math.min(y, viewBottom - s.bottom - s.elHeight);
  // top: не выше, чем «верхний край окна плюс top»; при споре top сильнее
  if (s.top !== null) y = Math.max(y, viewTop + s.top);
  // из родителя не выезжает, но и за своё место в потоке — тоже
  const lowest = Math.max(s.elTop, s.cbBottom - s.marginBottom - s.elHeight);
  const highest = Math.min(s.elTop, s.cbTop + s.marginTop);
  y = Math.min(Math.max(y, highest), lowest);
  return y - s.elTop; // сдвиг от места в потоке
}`;

export const STICKY_CODE_NOTE =
  'Липкий элемент — обычный элемент в потоке, которому браузер на каждом кадре дописывает сдвиг. Сдвиг ограничен с двух сторон: краем окна прокрутки и краями родителя. Поэтому «шапка уезжает в конце секции» — не отдельное правило, а тот же предел `lowest`. И поэтому место под шапку в потоке сохраняется: соседи не наезжают на неё, как было бы с `position: fixed`.';

/** Ближайший контейнер прокрутки: какой предок «забирает» липкость. Снято в Chromium. */
export const SCROLLER_ROWS: { k: string; got: string; tone: 'ok' | 'err' | 'warn' }[] = [
  {
    k: 'между шапкой и рамкой предок с `overflow: hidden`',
    got: 'не липнет: при `scrollTop` 100 шапка на −100. Она прилипла к предку, а тот не прокручивается',
    tone: 'err',
  },
  {
    k: 'у обёртки только `overflow-x: hidden`',
    got: 'не липнет: `overflow-y` при этом вычисляется в `auto`, и обёртка становится контейнером прокрутки',
    tone: 'err',
  },
  {
    k: 'тот же предок с `overflow: clip`',
    got: 'липнет: `clip` обрезает так же, но контейнера прокрутки не создаёт',
    tone: 'ok',
  },
  {
    k: 'боковое меню в сетке, `align-items` по умолчанию',
    got: 'не липнет: меню растянуто на высоту строки сетки (3000px), ехать ему некуда. С `align-self: start` липнет',
    tone: 'err',
  },
  {
    k: 'у рамки прокрутки `padding-top: 20px`',
    got: 'шапка с `top: 0` держится на 20px от верха рамки — у края `padding`, а не у края рамки',
    tone: 'warn',
  },
  {
    k: 'у шапки `margin-bottom: 30px`, секция 200px',
    got: 'уезжает на 30px раньше: поле тоже обязано остаться внутри секции',
    tone: 'warn',
  },
];

export const HIDDEN_SCROLL_NOTE =
  'Почему `hidden` «ломает», а `clip` нет. Контейнер с `overflow: hidden` прячет полосу, но остаётся контейнером прокрутки: на стенде `scrollTop = 100` прокрутил его на 100. С `overflow: clip` то же присваивание оставило 0 — прокручивать там нечего. Липкому элементу важен именно ближайший **контейнер прокрутки**, а не тот, что прокручивается сейчас.';

export const FIND_SCROLLER_CODE = `// Кто держит липкий элемент: первый предок с overflow не visible и не clip
function stickyScroller(el) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (!/^(visible|clip)$/.test(s.overflowY) || !/^(visible|clip)$/.test(s.overflowX)) return p;
  }
  return document.scrollingElement;
}`;

export const STACK_NOTE =
  'Ещё одно следствие: `position: sticky` всегда создаёт свой контекст наложения, даже без `z-index`. Всплывающее меню внутри липкой шапки перестаёт выходить поверх соседей с `z-index` — подробно в [«Контексте наложения», раздел «Кто создаёт контекст»](/render/stacking/#s2).';

// ─── Раздел 3. Якорь прокрутки ─────────────────────────────────────────────────────────────

export const PLAIN_ANCHOR =
  'Как палец на строке. Вы читаете абзац, а кто-то вклеивает в книгу страницы выше. Без пальца вы потеряли бы место: текст уехал вниз. Браузер держит палец на строке, которую вы видите, и после вклейки перелистывает книгу так, чтобы строка осталась под пальцем.';

export const ANCHOR_CODE = `// Выбор якоря прокрутки — по CSS Scroll Anchoring, с поправками Chromium.
// sc — снимок контейнера: scrollTop, height (clientHeight), scroll-padding,
// overflow-anchor и дерево узлов { id, top, bottom, skip, kids }
// в координатах содержимого. skip — почему узел исключён: overflow-anchor: none,
// position: sticky или fixed, absolute с блоком-контейнером снаружи прокрутки.
function selectAnchor(sc, log = []) {
  if (sc.overflowAnchor === 'none') {
    log.push(['контейнер', 'overflow-anchor: none — якоря нет']);
    return null;
  }
  if (sc.scrollTop === 0) {
    log.push(['контейнер', 'прокрутка в нуле — якоря нет']);
    return null;
  }
  // Окно выбора — видимая часть минус scroll-padding (место под липкую шапку)
  const viewTop = sc.scrollTop + sc.paddingTop;
  const viewBottom = sc.scrollTop + sc.height - sc.paddingBottom;
  function walk(list) {
    for (const node of list) { // в порядке документа
      if (node.skip) { log.push([node.id, 'исключён: ' + node.skip]); continue; }
      if (node.bottom <= node.top) { log.push([node.id, 'пустой — пропуск']); continue; }
      if (node.top >= viewTop && node.bottom <= viewBottom) {
        log.push([node.id, 'виден целиком — якорь']);
        return node;
      }
      if (node.top < viewBottom && node.bottom > viewTop) {
        log.push([node.id, 'виден частично — ищем внутри']);
        const inner = walk(node.kids);
        if (inner) return inner;
        log.push([node.id, 'внутри взять нечего — якорь он сам']);
        return node;
      }
      log.push([node.id, 'вне окна — пропуск']);
    }
    return null;
  }
  return walk(sc.kids);
}
// После раскладки: scrollTop += (новый top якоря − старый top якоря)`;

export const ANCHOR_CODE_NOTE =
  'Якорь выбирается **до** изменения, по старой раскладке, — Chromium делает это, когда прокрутка сдвинулась и раскладку пора пересчитать. После раскладки браузер смотрит, куда уехал якорь, и сдвигает `scrollTop` на ту же разницу. Ни события, ни способа спросить «кто сейчас якорь» у страницы нет: увидеть выбор можно только по последствиям.';

/** Лента из 20 строк по 50px в рамке 300px; над первой строкой вставлен блок 100px. Chromium 153. */
export const ANCHOR_ROWS: { k: string; anchor: string; shift: number; tone: 'ok' | 'warn' | 'err' }[] = [
  { k: 'прокрутка 250', anchor: '`r5` — первая строка, видная целиком', shift: 100, tone: 'ok' },
  { k: 'прокрутка 225', anchor: '`r4` — видна частично, внутри пусто, якорь она сама', shift: 100, tone: 'ok' },
  { k: 'прокрутка 0', anchor: 'нет', shift: 0, tone: 'err' },
  { k: 'прокрутка 250, у рамки `overflow-anchor: none`', anchor: 'нет', shift: 0, tone: 'warn' },
  { k: 'прокрутка 250, у `r5` `overflow-anchor: none`', anchor: '`r6`', shift: 100, tone: 'ok' },
  { k: 'прокрутка 250, у `r5` высота 0', anchor: '`r6` — пустой блок пропущен', shift: 100, tone: 'ok' },
  { k: 'прокрутка 250, у рамки `scroll-padding-top: 100px`', anchor: '`r7` — верхние 100px окна в выборе не участвуют', shift: 100, tone: 'ok' },
  { k: 'прокрутка 250, первым в рамке — липкая шапка 30px', anchor: '`r4`: шапку Chromium не берёт', shift: 100, tone: 'ok' },
];

export const ANCHOR_ROWS_NOTE =
  'Во всех строках, кроме двух, сдвиг одинаков — +100. Разница видна, когда вставка попадает **между** кандидатами: блок, вставленный перед `r5` при прокрутке 225, прокрутку не сдвигает — якорь `r4` выше вставки и не двигался. Так и можно узнать, кого выбрал браузер: вставлять блок перед каждым узлом по очереди. Якорь — последний узел в порядке документа, вставка перед которым ещё сдвигает прокрутку.';

export const ZERO_NOTE =
  'Строка «прокрутка 0» — не опечатка. В самом начале Chromium якорь не выбирает вовсе: лента, открытая с первой строки, при догрузке сверху показывает новое и уезжает вниз. Это удобно для новостей и неудобно для чата, где прокрутку в начало обычно и вызывает подгрузка истории. Поправка там своя: запомнить `scrollHeight` до вставки и прибавить разницу к `scrollTop`.';

export const DEMO_CAPTION =
  'Прокрутите ленту и догрузите день сверху. С `overflow-anchor: auto` сообщение, отмеченное якорем, остаётся на той же высоте: браузер сдвинул `scrollTop` ровно на высоту вставки. С `none` прокрутка стоит, и всё содержимое уезжает вниз. Липкие шапки якорем не бывают — в журнале выбора они «исключены». Якорем может оказаться сообщение, наполовину закрытое шапкой: окно выбора начинается от верха рамки. С `scroll-padding-top` на высоту шапки эта полоса из выбора исключена, и якорь — первое сообщение, которое видно. В самом верху ленты якоря нет и с `auto`.';

/** Изменения в том же кадре, что и рост блока над окном (+100px). Якорь — `j10`. Chromium 153. */
export const SUPPRESS_ROWS: { k: string; shift: number; tone: 'ok' | 'err' }[] = [
  { k: 'ничего (контроль)', shift: 100, tone: 'ok' },
  { k: 'у обёртки якоря сменился `position`', shift: 0, tone: 'err' },
  { k: 'у обёртки якоря сменился `top`', shift: 0, tone: 'err' },
  { k: 'у обёртки якоря появился `transform`', shift: 0, tone: 'err' },
  { k: 'у обёртки якоря сменились `min-height` или `padding-top`', shift: 0, tone: 'err' },
  { k: 'у самого якоря сменились `height` или `margin-top`', shift: 0, tone: 'err' },
  { k: 'у строки **ниже** якоря сменилась высота', shift: 100, tone: 'ok' },
];

export const SUPPRESS_NOTE =
  'Правило защиты от зацикливания: если в том же кадре поменялись размер, поля, позиция или `transform` у самого якоря или у его предков внутри контейнера, браузер не поправляет прокрутку вообще. Иначе поправка могла бы снова поменять раскладку, та — поправку, и так по кругу. Для страницы это выглядит как случайный прыжок: подгрузка сверху совпала с анимацией обёртки — и якорь «не сработал».';

export const VLIST_NOTE =
  'Как якорение ведёт себя в виртуальном списке, где строки пересоздаются, и почему `scrollTop += delta` при включённом якоре даёт двойную поправку, — в [«Виртуальных списках», раздел «Разная высота»](/render/virtual-lists/#s3).';

/** Лента демо: три дня, догружаются ещё три — по одному за нажатие. */
export const DEMO_FEED: FeedGroup[] = [
  {
    id: 'mon',
    day: 'Понедельник',
    msgs: ['Созвон перенесли на 11:00', 'Макет шапки в общей папке', 'Кто смотрел ревью по ленте?', 'Посмотрю после обеда'],
  },
  {
    id: 'yesterday',
    day: 'Вчера',
    msgs: ['Липкая шапка уезжает на iOS', 'Похоже, overflow-x: hidden у обёртки', 'Убрал — липнет', 'Отлично, вливаем', 'Сборка зелёная'],
  },
  {
    id: 'today',
    day: 'Сегодня',
    msgs: ['Лента прыгает при подгрузке истории', 'Сверху приходит 30 сообщений', 'А якорь прокрутки включён?', 'Проверю overflow-anchor', 'Нашёл: в самом верху якоря нет'],
  },
];

export const DEMO_OLDER: FeedGroup[] = [
  { id: 'sun', day: 'Воскресенье', msgs: ['Тихий день', 'Обновил зависимости', 'Тесты прошли'] },
  { id: 'sat', day: 'Суббота', msgs: ['Кто дежурит?', 'Я', 'Спасибо!', 'Алерт по памяти закрыт'] },
  { id: 'fri', day: 'Пятница', msgs: ['Релиз в 17:00', 'Откатили', 'Причина — кеш', 'Выкатили снова'] },
];

// ─── Раздел 4. Цепочка и упор ──────────────────────────────────────────────────────────────

export const PLAIN_CHAIN =
  'Как два эскалатора подряд. Пока вы на внутреннем — едете по нему. Доехали до конца — следующий шаг уже по внешнему, хотя вы шли «по тому же самому». `overscroll-behavior: contain` — перила в конце внутреннего: дальше не пройти, пока не сойдёте сами.';

/** Вложенный блок прокручен до конца; жест вниз на 200px над ним. Сдвиг страницы, px. */
export const CHAIN_ROWS: { css: string; wheel: number; touch: string; tone: 'ok' | 'warn' }[] = [
  { css: 'auto', wheel: 200, touch: 'прокрутилась', tone: 'warn' },
  { css: 'contain', wheel: 0, touch: 'стоит', tone: 'ok' },
  { css: 'none', wheel: 0, touch: 'стоит', tone: 'ok' },
];

/** Блок в 50px от конца; два шага колеса по 200px. Прокрутка блока и страницы после каждого. */
export const LATCH = { boxBefore: 250, boxEnd: 300, first: { box: 300, page: 0 }, second: { box: 300, page: 200 } };

export const LATCH_NOTE =
  'Цепочка срабатывает не посреди жеста. Блок был в 50px от конца, колесо прокрутило на 200: блок доехал до конца, а остаток в 150px страница **не** получила. Жест «прилип» к тому контейнеру, с которого начался. Страница поехала только со следующего шага колеса — он начался уже над упёршимся блоком.';

export const CHAIN_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`contain` против `none`',
    d: 'Оба значения обрывают цепочку. Разница — в эффекте у края: `contain` оставляет «пружину» и подсветку края самого контейнера, `none` убирает и их. Для модального окна и выпадающего списка обычно хватает `contain`.',
  },
  {
    t: '«Потянуть, чтобы обновить»',
    d: 'В Chrome на Android жест вниз в самом верху страницы перезагружает её — это та же цепочка, дошедшая до браузера. `overscroll-behavior-y: contain` на `html` отключает его, не трогая обычную прокрутку. Для чата, карты и игры это обычно нужно.',
    tone: 'warn',
  },
  {
    t: 'Вместо `preventDefault` на `wheel`',
    d: 'Чтобы прокрутка списка в модальном окне не уводила страницу, раньше вешали слушатель `wheel` без `passive` и гасили событие у края. Это возвращает ожидание главного потока. Одно свойство CSS решает то же без JS.',
    tone: 'ok',
  },
];

// ─── Раздел 5. Snap и scrollend ────────────────────────────────────────────────────────────

export const PLAIN_SNAP =
  'Как магнитные защёлки на дверце шкафа. Дверцу можно оставить где угодно, но у защёлки она сама притягивается и встаёт ровно. `mandatory` — защёлки сильные: дверца встанет на одну из них всегда. `proximity` — слабые: притянут, только если отпустить совсем рядом.';

export const SNAP_HTML = `<div class="carousel" style="height: 300px; overflow: auto;
                              scroll-snap-type: y mandatory">
  <div id="s0" style="height: 300px; scroll-snap-align: start">0</div>
  <div id="s1" style="height: 300px; scroll-snap-align: start">1</div>
  … s2, s3, s4 …
</div>`;

/** Карусель из `SNAP_HTML`, пять слайдов по 300px. Итоговый `scrollTop` и события. Chromium 153. */
export const SNAP_ROWS: { type: string; wheel: string; to760: string; change: string }[] = [
  { type: '`y mandatory`', wheel: '0 — вернулась к `s0`', to760: '900 — встала на `s3`', change: '`s3`' },
  { type: '`y proximity`', wheel: '0 — вернулась к `s0`', to760: '760 — точек рядом нет', change: '`null`' },
  { type: '`none`', wheel: '100', to760: '760', change: 'нет события' },
];

export const SNAP_NOTE =
  'Колесо на 100px меньше половины слайда, поэтому `mandatory` и `proximity` вернули карусель к `s0`. `scrollTo({ top: 760 })` — между `s2` (600) и `s3` (900): `mandatory` довёл до ближайшей точки, `proximity` оставил как есть. Событие `scrollsnapchange` в Chromium 153 есть (как и `scrollsnapchanging`) и сообщает новый слайд в `snapTargetBlock` — при `proximity`, ушедшей с точки, там `null`.';

export const SNAP_EVENTS_CODE = `carousel.addEventListener('scrollsnapchange', (e) => {
  // слайд, на котором карусель остановилась; null — ни на каком
  markCurrent(e.snapTargetBlock);
});

carousel.addEventListener('scrollend', () => {
  // прокрутка закончилась вся: колесо, палец, инерция, доводка до точки
  saveProgress(carousel.scrollTop);
});`;

/** Обработчики `scroll` и `scrollend` на контейнере. Chromium 153. */
export const SCROLLEND_ROWS: { k: string; scroll: string; scrollend: number }[] = [
  { k: '`box.scrollTop = 500`', scroll: '1', scrollend: 1 },
  { k: 'то же значение ещё раз', scroll: '0', scrollend: 0 },
  { k: "`box.scrollTo({ top: 1500, behavior: 'smooth' })`", scroll: 'по одному на кадр анимации', scrollend: 1 },
  { k: 'колесо на 100px по карусели с `mandatory` (с доводкой к `s0`)', scroll: 'по одному на кадр доводки', scrollend: 1 },
];

export const SCROLLEND_NOTE =
  'До `scrollend` конец прокрутки угадывали таймером: «если 100 мс не было `scroll`, значит всё». Таймер ошибается в обе стороны — палец ещё на экране, а пауза уже прошла, или инерция давно кончилась, а таймер ещё ждёт. `scrollend` присылает браузер, когда закончились и жест, и инерция, и доводка к точке привязки. Если позиция не изменилась, событий нет вовсе — ни `scroll`, ни `scrollend`.';

// ─── Раздел 6. Шапка и якоря ссылок ────────────────────────────────────────────────────────

export const INTO_VIEW_HTML = `<html style="scroll-padding-top: 60px">
  <header style="position: sticky; top: 0; height: 60px">…</header>
  …
  <h2 id="t" style="scroll-margin-top: 16px">Цель</h2>`;

/** Цель на 1560px, липкая шапка 60px, окно 600px. Верх цели в окне после прокрутки. Chromium 153. */
export const INTO_VIEW_ROWS: { k: string; top: number; hit: string; tone: 'ok' | 'err' }[] = [
  { k: 'без настроек', top: 0, hit: 'под шапкой — `elementFromPoint` у верха цели отдаёт `HEADER`', tone: 'err' },
  { k: '`scroll-padding-top: 60px` у `html`', top: 60, hit: 'сразу под шапкой', tone: 'ok' },
  { k: 'то же и `scroll-margin-top: 16px` у цели', top: 76, hit: 'под шапкой с зазором', tone: 'ok' },
  { k: 'только `scroll-margin-top: 76px` у цели', top: 76, hit: 'то же, но правило на каждой цели', tone: 'ok' },
];

export const INTO_VIEW_NOTE =
  'Те же числа дал переход по ссылке `#t`: и `scrollIntoView()`, и якорь в адресе, и переход по оглавлению читают одни и те же свойства. `scroll-padding` ставят **контейнеру** — один раз на высоту шапки. `scroll-margin` ставят **цели** — когда отступ нужен только ей. `focus()` прокручивает иначе: ставит элемент в середину окна — и тоже учитывает `scroll-padding`. На стенде цель высотой 40px встала на 280 без него и на 310 с ним, то есть в середину той части окна, что ниже шапки.';

export const ANCHOR_PAD_NOTE =
  'У `scroll-padding-top` есть и второе действие, которое легко не заметить. Окно выбора якоря прокрутки — видимая часть **минус** `scroll-padding`. Без него браузер может выбрать якорем строку, спрятанную под шапкой, — читатель её не видит, но лента держится за неё.';

// ─── Раздел 7. Полоса и сдвиг ──────────────────────────────────────────────────────────────

export const PLAIN_GUTTER =
  'Как поле для подписи на бланке. Если поля нет, а подпись всё же понадобилась, её втискивают сбоку — и текст бланка приходится сдвигать. Если поле оставлено заранее, бланк выглядит одинаково и с подписью, и без неё.';

/** Рамка шириной 200px, полоса 12px (`::-webkit-scrollbar`). `clientWidth`. Chromium 153. */
export const GUTTER_ROWS: { k: string; short: number; long: number }[] = [
  { k: '`overflow: auto`', short: 200, long: 188 },
  { k: '`overflow: auto; scrollbar-gutter: stable`', short: 188, long: 188 },
  { k: '`overflow: auto; scrollbar-gutter: stable both-edges`', short: 176, long: 176 },
  { k: '`overflow: hidden; scrollbar-gutter: stable`', short: 188, long: 188 },
  { k: '`overflow: visible; scrollbar-gutter: stable`', short: 200, long: 200 },
];

export const GUTTER_NOTE =
  '«Короткое» содержимое помещается в рамку, «длинное» — нет. Без `scrollbar-gutter` ширина для содержимого меняется в момент, когда появляется полоса: всё, что выровнено по центру или растянуто на ширину, сдвигается на 6 или 12px. `stable` держит место всегда, `both-edges` — ещё и симметрично с другой стороны. Для `overflow: visible` свойство не действует: там полосы не бывает.';

export const GUTTER_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'На Mac сдвиг не виден',
    d: 'С настройкой macOS по умолчанию полосы прокрутки — наложения: они рисуются поверх содержимого и места не занимают. На стенде ширина системной полосы — 0, и `scrollbar-gutter` резервировать нечего. У пользователя Windows или Linux полоса классическая — и сдвиг есть. Проверять вёрстку только на Mac — значит его не увидеть.',
    tone: 'warn',
  },
  {
    t: 'Целиком страница',
    d: '`html { scrollbar-gutter: stable }` убирает прыжок вёрстки при переходе между короткой и длинной страницей, а также когда модальное окно ставит `overflow: hidden` на `body`, чтобы запретить прокрутку.',
    tone: 'ok',
  },
];

// ─── Раздел 8. Назад на место ──────────────────────────────────────────────────────────────

/** Страница A прокручена на 1500, переход по ссылке на B, «назад». Chromium 153, без bfcache. */
export const RESTORE_ROWS: { k: string; y: number; tone: 'ok' | 'err' | 'warn' }[] = [
  { k: '`history.scrollRestoration` — `auto` (по умолчанию)', y: 1500, tone: 'ok' },
  { k: 'на A стоит `history.scrollRestoration = \'manual\'`', y: 0, tone: 'warn' },
  { k: 'A дорастает до нужной высоты **до** события `load`', y: 1500, tone: 'ok' },
  { k: 'A дорастает до нужной высоты через 300 мс **после** `load`', y: 0, tone: 'err' },
];

export const RESTORE_NOTE =
  'При возврате на страницу браузер сам ставит прокрутку туда, где вы были, — но только пока страница грузится. Если высота нужна для позиции 1500, а список приходит позже `load`, браузер успел поставить 0 и больше не пытается. Отсюда «назад в каталог, а каталог открылся сверху» на сайтах, которые грузят товары после загрузки страницы.';

export const RESTORE_CODE = `// Страница сама знает, когда её содержимое готово
history.scrollRestoration = 'manual';

addEventListener('pagehide', () => {
  sessionStorage.setItem('y:' + location.pathname, String(scrollY));
});

async function showCatalog() {
  await renderItems(await loadItems());          // высота страницы — уже настоящая
  const y = sessionStorage.getItem('y:' + location.pathname);
  if (y) scrollTo(0, Number(y));
}`;

export const RESTORE_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`manual` живёт в записи истории',
    d: 'Режим сохраняется вместе с записью. Поставили `manual` на странице A — при возврате на A браузер прокрутку не тронет: на стенде страница открылась в начале.',
  },
  {
    t: 'Кеш «назад-вперёд» — другой путь',
    d: 'Если страница вернулась из кеша «назад-вперёд», она не загружалась заново: прокрутка, введённый текст и состояние JS — те же, что были. Когда кеш срабатывает и когда нет — в [«Мгновенной навигации», раздел «Кеш „назад-вперёд“»](/platform/instant-navigation/#s1).',
  },
  {
    t: 'SPA — свой случай',
    d: 'При `pushState` документ не меняется, и браузер знает про позицию меньше. Как роутер забирает прокрутку себе и что делает Navigation API — в [«Роутере изнутри», раздел «Прокрутка»](/frameworks/router/#s9).',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`overflow-x: hidden` у обёртки отключает липкость',
    d: 'Хотели спрятать горизонтальный вылет — получили контейнер прокрутки: `overflow-y` вычисляется в `auto`. Липкая шапка внутри прилипает к обёртке, которая не прокручивается. Если нужно только обрезать — `overflow-x: clip`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Липкому элементу некуда ехать',
    d: 'Боковое меню в сетке или во flex растянуто на высоту строки — и сдвигать его некуда. Шапка в секции высотой с себя — то же самое. → `align-self: start` и проверка, что родитель выше липкого элемента.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'В самом верху якоря нет',
    d: 'Chromium не выбирает якорь при `scrollTop === 0`. Чат, который подгружает историю, когда пользователь доехал до начала, без своей поправки прыгает ровно в этот момент. → запомнить `scrollHeight` до вставки и прибавить разницу к `scrollTop`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Поправка отменяется молча',
    d: 'Если в том же кадре изменился размер, поля, позиция или `transform` у якоря или у его предков, браузер не сдвигает прокрутку вовсе. Ошибки нет ни в консоли, ни в событиях — только прыжок, который не воспроизводится, когда анимация не совпала по времени.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Якорь под липкой шапкой',
    d: 'Без `scroll-padding-top` окно выбора якоря начинается от верха рамки, и якорем может стать строка, которую закрывает шапка. → `scroll-padding-top` на высоту шапки чинит сразу и `scrollIntoView`, и ссылки `#…`, и выбор якоря.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Свой обработчик `scroll` вместо `sticky`',
    d: 'Шапку, которую «прилепляет» JS, рисует главный поток после прокрутки. При занятом потоке она отстаёт и дёргается; липкую считает композитор вместе с прокруткой.',
  },
  {
    n: '07',
    t: 'Возврат на место не ждёт ваших данных',
    d: 'Браузер восстанавливает прокрутку, пока страница грузится. Список, который пришёл после `load`, позицию не получит. → `scrollRestoration = \'manual\'` и своя прокрутка после отрисовки данных.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'На Mac полоса не занимает места',
    d: 'Сдвиг вёрстки от появившейся полосы виден только там, где полосы классические. → `scrollbar-gutter: stable` на контейнерах, которые то короткие, то длинные, и проверка в Windows или с настройкой macOS «Показывать полосы прокрутки: всегда».',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Один слушатель без `passive` возвращает прокрутку на главный поток',
    d: 'Слушатель `wheel` или `touchmove` на элементе, а не на `window`, по умолчанию не пассивный. Пока он висит, прокрутка над этим элементом ждёт JS. Если отменять жест не нужно — `{ passive: true }`; если нужно — сначала `touch-action` и `overscroll-behavior`.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'CSS Positioned Layout Module Level 3',
    href: 'https://drafts.csswg.org/css-position-3/',
    what: '`position: sticky`: прямоугольник липкости, ближайший контейнер прокрутки, предел блока-контейнера',
  },
  {
    title: 'CSS Scroll Anchoring Module Level 1',
    href: 'https://drafts.csswg.org/css-scroll-anchoring/',
    what: 'выбор якоря, исключённые узлы, окно выбора с `scroll-padding`, условия подавления поправки, `overflow-anchor`',
  },
  {
    title: 'Chromium — `scroll_anchor.cc`',
    href: 'https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/layout/scroll_anchor.cc',
    what: 'реализация якоря в Blink: обход кандидатов и какие узлы не берутся',
  },
  {
    title: 'CSS Overscroll Behavior Module Level 1',
    href: 'https://drafts.csswg.org/css-overscroll-1/',
    what: 'цепочка прокрутки, `contain` и `none`',
  },
  {
    title: 'Chrome for Developers — Take control of your scroll',
    href: 'https://developer.chrome.com/blog/overscroll-behavior',
    what: '`overscroll-behavior` и жест «потянуть, чтобы обновить» в Chrome на Android',
  },
  {
    title: 'CSS Scroll Snap Module Level 1 и Level 2',
    href: 'https://drafts.csswg.org/css-scroll-snap-1/',
    what: '`scroll-snap-type`, `scroll-snap-align`, `scroll-padding`, `scroll-margin`; события `scrollsnapchange` и `scrollsnapchanging` — в [Level 2](https://drafts.csswg.org/css-scroll-snap-2/)',
  },
  {
    title: 'CSSOM View Module',
    href: 'https://drafts.csswg.org/cssom-view/',
    what: '`scrollIntoView`, `scrollTo`, события `scroll` и `scrollend`',
  },
  {
    title: 'Pointer Events — `touch-action`',
    href: 'https://w3c.github.io/pointerevents/',
    what: 'какие жесты браузер берёт себе и какие отдаёт странице',
  },
  {
    title: 'CSS Overflow Module Level 3',
    href: 'https://drafts.csswg.org/css-overflow-3/',
    what: '`overflow: clip` против `hidden`, `scrollbar-gutter`',
  },
  {
    title: 'HTML Standard — History',
    href: 'https://html.spec.whatwg.org/multipage/nav-history-apis.html',
    what: '`history.scrollRestoration`, режимы `auto` и `manual`',
  },
];

export const RELATED =
  'Смежное на сайте: [Кадр браузера, раздел «Что дешевле двигать»](/render/render-pipeline/#s4) — композитор, плитки и анимации по прокрутке без JS. [События DOM, раздел «Пассивные слушатели»](/render/dom-events/#s6) — `passive`, отмена колеса и касаний. [Виртуальные списки](/render/virtual-lists/) — якорь при пересоздании строк и липкие заголовки в окне. [Контекст наложения](/render/stacking/) — почему липкая шапка накрывает соседей. [Роутер изнутри, раздел «Прокрутка»](/frameworks/router/#s9) — позиция при переходах внутри SPA. [Мгновенная навигация](/platform/instant-navigation/) — кеш «назад-вперёд», который возвращает страницу целиком. [Адаптивность изнутри](/render/responsive/) — вьюпорт, `svh`/`dvh`, `em` в медиазапросах, что ломает `container-type` и `clamp` при масштабе.';
