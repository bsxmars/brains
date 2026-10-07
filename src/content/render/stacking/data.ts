import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { PropOption, StackScene } from '@/widgets/stacking-lab/model/types';

/**
 * Данные темы «Контекст наложения, z-index и верхний слой».
 *
 * Тема написана 2026-10-02 для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium 153.0.8010.12 (Playwright 1.63, headless), Node 24.11.0, октябрь 2026. Скрипты стенда
 * лежали в scratchpad агента; всё, что ниже утверждается о браузере, пересобирается
 * `tests/unit/stacking.test.ts` — тем же Chromium, теми же приёмами. Таймеров нет: только
 * `document.elementFromPoint`/`elementsFromPoint`, `getComputedStyle`, `getBoundingClientRect`,
 * псевдоклассы `:modal`/`:popover-open`/`:fullscreen`, цвет пикселя на снимке экрана и дерево
 * доступности из протокола отладчика (`Accessibility.getFullAXTree`).
 *
 * Как сняты:
 *   — **кто создаёт контекст** (`TRIGGER_ROWS`): родитель P со свойством из строки и ребёнок C
 *     с `position: relative; z-index: -1`, оба 100×100 в углу. Если P — контекст, C рисуется
 *     внутри него поверх его фона, и `elementFromPoint(50, 50)` отдаёт C; если нет — C уходит
 *     в корневой контекст под фон P, и в точке P. У строк «flex/grid» P лежит в контейнере
 *     с `display: flex`/`grid`. `content-visibility: auto` контекст создаёт не сразу, а после
 *     кадра (сразу после вставки, в той же задаче — нет, после двух `requestAnimationFrame` — да), в таблицу
 *     не вошёл, оговорён в тексте;
 *   — **порядок отрисовки**: функция `STACKING_CODE` против `elementsFromPoint` на деревьях,
 *     разложенных `layoutTree` (`widgets/stacking-lab/model/run.ts`) так, что все блоки
 *     накрывают одну точку. На стенде 900 случайных деревьев (три зерна по 300, до 10 блоков,
 *     `position` × `z-index` × восемь свойств-причин × блок/`inline-block`/flex/float) — 900
 *     совпадений. Первый прогон дал 74 расхождения, и все были в стенде, а не в модели:
 *     блоки уезжали из общей точки (сдвиг больше размера блока; отступ первого ребёнка
 *     схлопывался с `body` — лечится `display: flow-root`). Тест гоняет 300 деревьев заново;
 *   — **верхний слой**: `showModal()`, `showPopover()`, `requestFullscreen()` (по настоящему
 *     клику — без него запрос отклоняется). Над всем лежит `position: fixed` блок
 *     с `z-index: 2147483647`; верх определяется `elementFromPoint`, видимость — пикселем.
 *
 * Только из документации, не проверено запуском: формулировки CSS 2.1 приложения E (порядок
 * проверен поведением, а не текстом), поведение других движков. Инертность всего вне
 * полноэкранного элемента — поведение Chromium 153; нормы в спецификации Fullscreen API
 * для неё я не нашёл, поэтому в тексте она подана как поведение Chromium.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'контекст наложения (stacking context)',
    d: 'Группа элементов, которую браузер рисует целиком, как одну стопку. `z-index` детей сравнивается только внутри неё, а снаружи вся стопка стоит на одном месте — там, где стоит её корень.',
  },
  {
    k: 'порядок отрисовки (paint order)',
    d: 'Очерёдность, в которой браузер кладёт краску на экран. Что нарисовано позже, то и сверху. Порядок в HTML на него влияет, но не решает его.',
  },
  {
    k: '`z-index`',
    d: 'Номер слоя внутри контекста наложения. Работает у позиционированных элементов (`position` не `static`) и у детей flex- и grid-контейнеров. У остальных браузер его молча игнорирует.',
  },
  {
    k: 'позиционированный элемент',
    d: 'Элемент с `position: relative`, `absolute`, `fixed` или `sticky`. Без `z-index` он сам контекст не создаёт (кроме `fixed` и `sticky`), но рисуется позже обычных блоков.',
  },
  {
    k: 'верхний слой (top layer)',
    d: 'Отдельный слой поверх всей страницы. Туда браузер переносит модальный `<dialog>`, открытый поповер и элемент во весь экран. Никакой `z-index` на странице его не перекроет.',
  },
  {
    k: '`::backdrop`',
    d: 'Псевдоэлемент-подложка размером с окно. Браузер кладёт его сразу под элемент верхнего слоя: им затемняют страницу под модальным окном.',
  },
  {
    k: 'инертность (inert)',
    d: 'Состояние «видно, но не трогать»: элемент не получает кликов и фокуса и пропадает из дерева доступности. Модальный диалог делает таким всё, что вне него.',
  },
  {
    k: 'слой композитора',
    d: 'Кусок страницы, который видеокарта хранит отдельной картинкой. С контекстом наложения его путают постоянно, но это другое: контекст решает порядок, слой — как картинку собрать.',
  },
];

export const PLAIN_CONTEXT =
  'Как папки в стопке бумаг на столе. Листы внутри папки можно перекладывать как угодно, но в общую стопку папку кладут целиком. Лист с пометкой «самый верхний» внутри папки, лежащей в самом низу, всё равно окажется под всеми листами, лежащими выше папки. `z-index: 9999` — пометка на листе, а решает, где лежит папка.';

export const PREREQ_NOTE =
  'Тема опирается на одну вещь из других тем и на две, которые на сайте не разбираются отдельно, — они объяснены прямо на карточках.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Кадр: стиль, раскладка, отрисовка',
    d: 'Браузер сначала вычисляет стили, потом раскладывает блоки по местам, потом рисует их. Порядок отрисовки — правило третьего шага: что класть на экран раньше, что позже.',
    href: '/render/render-pipeline/#s1',
    hrefLabel: '«Кадр браузера», раздел «Кадр по шагам»',
    tone: 'info',
  },
  {
    t: 'Свойство `position`',
    d: '`static` — обычный поток, по умолчанию. `relative` сдвигает элемент от его места, `absolute` вынимает из потока и ставит относительно ближайшего позиционированного предка, `fixed` — относительно окна, `sticky` прилипает при прокрутке.',
    tone: 'info',
  },
  {
    t: 'Порядок в дереве',
    d: 'Порядок, в котором элементы встречаются в HTML, если читать разметку сверху вниз: сначала родитель, потом его дети по очереди, потом следующий сосед родителя. Когда браузеру больше не на что опереться, позже в дереве — значит выше на экране.',
    tone: 'info',
  },
];

// ─── Раздел 1. Семь шагов отрисовки ────────────────────────────────────────────────────────

export const PLAIN_ORDER =
  'Как маляр, который красит стену с картинкой: сначала фон, потом дальние предметы, потом ближние. Он не помнит, что вы нарисовали эскиз в другом порядке, — у него свой порядок слоёв. Порядок в HTML для браузера — только эскиз: внутри одного шага он важен, а между шагами решают сами шаги.';

/** Шаги приложения E, как их печатает тема. Номера совпадают с `step` у `paintOrder`. */
export const PAINT_STEPS = [
  '**Фон и рамка** самого корня контекста.',
  '**Дочерние контексты с отрицательным `z-index`** — от самого отрицательного; при равных — в порядке дерева.',
  '**Фоны обычных блоков** в потоке — в порядке дерева, на любой глубине.',
  '**Float** — каждый целиком, со всем, что внутри.',
  '**Строчное содержимое**: текст, `inline-block`, дети flex- и grid-контейнеров — тоже каждый целиком.',
  '**Позиционированные с `z-index: auto` и контексты с `z-index: 0`** — в порядке дерева, вперемешку.',
  '**Контексты с положительным `z-index`** — по возрастанию; при равных — в порядке дерева.',
];

/** Подписи шагов в демо: номер шага → коротко. */
export const STEP_LABELS: Record<number, string> = {
  2: 'z < 0',
  3: 'блок',
  4: 'float',
  5: 'строчный',
  6: 'auto или 0',
  7: 'z > 0',
};

export const STACKING_CODE = `// Значения, при которых свойство контекста НЕ создаёт.
const NEUTRAL = {
  transform: 'none', translate: 'none', rotate: 'none', scale: 'none',
  filter: 'none', 'backdrop-filter': 'none', perspective: 'none',
  'clip-path': 'none', 'mask-image': 'none', 'mix-blend-mode': 'normal',
  isolation: 'auto', 'view-transition-name': 'none',
};

// Почему элемент создаёт контекст наложения; null — не создаёт.
function contextReason(css, parentCss = {}) {
  const pos = css.position ?? 'static';
  const z = css['z-index'] ?? 'auto';
  const item = /flex|grid/.test(parentCss.display ?? '');
  if (pos === 'fixed' || pos === 'sticky') return 'position: ' + pos;
  if (z !== 'auto' && pos !== 'static') return 'position + z-index';
  if (z !== 'auto' && item) return 'z-index у flex- или grid-ребёнка';
  if (css.opacity !== undefined && Number(css.opacity) < 1) return 'opacity: ' + css.opacity;
  for (const [prop, none] of Object.entries(NEUTRAL)) {
    if (css[prop] !== undefined && css[prop] !== none) return prop + ': ' + css[prop];
  }
  if (/layout|paint|content|strict/.test(css.contain ?? '')) return 'contain: ' + css.contain;
  // will-change создаёт контекст заранее — если его создало бы само свойство.
  for (const p of (css['will-change'] ?? '').split(',').map((s) => s.trim())) {
    if (p === 'opacity' || p === 'position' || p in NEUTRAL) return 'will-change: ' + p;
    if (p === 'z-index' && (pos !== 'static' || item)) return 'will-change: z-index';
  }
  return null;
}

// Порядок отрисовки снизу вверх. tree — дети корня, то есть <html>.
function paintOrder(tree) {
  const nodes = [];
  const prepare = (list, parent) => list.map((src) => {
    const css = src.css ?? {};
    const item = /flex|grid/.test(parent?.css.display ?? '');
    const z = css['z-index'] ?? 'auto';
    const n = { id: src.id, css, parent };
    n.reason = contextReason(css, parent?.css);
    n.positioned = (css.position ?? 'static') !== 'static';
    n.z = z !== 'auto' && (n.positioned || item) ? Number(z) : 0;   // иначе z-index не работает
    n.kind = item || /inline/.test(css.display ?? '') ? 'inline'
      : (css.float ?? 'none') !== 'none' ? 'float' : 'block';
    nodes.push(n);
    n.kids = prepare(src.kids ?? [], n);
    return n;
  });
  const root = { id: null, kids: prepare(tree, null) };
  const layered = (n) => n.reason !== null || n.positioned;

  // Контексты и позиционированные потомки — не заходя внутрь дочерних контекстов.
  function zKids(el) {
    const out = [];
    for (const k of el.kids) {
      if (layered(k)) out.push(k);
      if (!k.reason) out.push(...zKids(k));
    }
    return out;
  }
  // Потомки в обычном потоке нужного вида: спускаемся только через обычные блоки.
  function flow(el, kind) {
    const out = [];
    for (const k of el.kids) {
      if (layered(k)) continue;
      if (k.kind === kind) out.push(k);
      if (k.kind === 'block') out.push(...flow(k, kind));
    }
    return out;
  }

  const order = [];
  function paintFlow(el, ctx) {
    for (const b of flow(el, 'block')) order.push({ id: b.id, step: 3, ctx });
    for (const f of flow(el, 'float')) atomic(f, 4, ctx);
    for (const i of flow(el, 'inline')) atomic(i, 5, ctx);
  }
  // «Как будто свой контекст», но позиционированные потомки уходят в настоящий.
  function atomic(el, step, ctx) {
    order.push({ id: el.id, step, ctx });
    paintFlow(el, ctx);
  }
  function paintContext(el, step, ctx) {
    if (el.id !== null) order.push({ id: el.id, step, ctx });   // 1: свой фон
    const own = el.id;
    const zs = zKids(el);
    const byZ = (a, b) => a.z - b.z;                     // sort устойчив: при равных — порядок дерева
    for (const k of zs.filter((k) => k.z < 0).sort(byZ)) paintContext(k, 2, own);
    paintFlow(el, own);                                  // 3, 4, 5
    for (const k of zs.filter((k) => k.z === 0)) {
      if (k.reason) paintContext(k, 6, own); else atomic(k, 6, own);
    }
    for (const k of zs.filter((k) => k.z > 0).sort(byZ)) paintContext(k, 7, own);
  }
  paintContext(root, 0, null);

  const ctxOf = (n) => (!n.parent ? null : n.parent.reason ? n.parent.id : ctxOf(n.parent));
  return {
    order,
    contexts: nodes.map((n) => ({ id: n.id, reason: n.reason, z: n.z, ctx: ctxOf(n) })),
  };
}`;

export const STACKING_NOTE =
  'Восемьдесят строк — и всё приложение E. Главное в них — два обхода: `zKids` собирает тех, кто рисуется отдельным слоем (контексты и позиционированные), и не заходит внутрь чужих контекстов; `flow` собирает обычные блоки, float и строчные, спускаясь только через обычные блоки. Float и `inline-block` рисуются целиком, «как будто» свой контекст, — но позиционированные дети из них уходят наверх, в настоящий.';

/** Сквозной пример раздела: шесть детей в обратном порядке. Тот же, что сцена «Семь слоёв» в демо. */
export const LAYERS_HTML = `<div id="stage" style="isolation: isolate">
  <div id="pos"    style="position: relative; z-index: 1"></div>
  <div id="auto"   style="position: relative"></div>
  <div id="inline" style="display: inline-block"></div>
  <div id="float"  style="float: left"></div>
  <div id="block"></div>
  <div id="neg"    style="position: relative; z-index: -1"></div>
</div>`;

/** Порядок сквозного примера снизу вверх — `paintOrder` и Chromium (сверяет тест). */
export const LAYERS_ORDER = ['stage', 'neg', 'block', 'float', 'inline', 'auto', 'pos'];

export const LAYERS_NOTE =
  'В разметке дети идут ровно наоборот, а нарисованы снизу вверх так: `stage`, `neg`, `block`, `float`, `inline`, `auto`, `pos`. Каждый попал на свой шаг, и порядок в HTML не сыграл никакой роли: внутри шага сравнивать было не с кем.';

export const ORDER_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`z-index` без `position` не работает',
    d: '`z-index: 5` у обычного блока Chromium игнорирует: ни контекста, ни подъёма. Исключение — дети flex- и grid-контейнеров: у них `z-index` работает и без `position` и создаёт контекст.',
    tone: 'warn',
  },
  {
    t: '`z-index: -1` уходит под фон родителя',
    d: 'Если родитель не создаёт контекст, ребёнок с отрицательным `z-index` рисуется на втором шаге **ближайшего контекста выше** — раньше фона самого родителя. Так «подложку» прячут под карточку — и так же она случайно пропадает под фоном страницы.',
    tone: 'warn',
  },
  {
    t: 'Позиционированный без `z-index` — не контекст',
    d: '`position: relative` поднимает элемент на шестой шаг, но его позиционированные дети не остаются внутри: они идут в тот же шестой шаг или в другие шаги настоящего контекста, рядом с родителем. Контекст появляется, только когда у него есть числовой `z-index`.',
  },
];

// ─── Раздел 2. Кто создаёт контекст ────────────────────────────────────────────────────────

/** Свойство → создаёт ли контекст. Снято в Chromium 153, сверяется тестом и функцией. */
export const TRIGGER_ROWS: { css: string; parent?: 'flex' | 'grid'; sc: boolean; note: string }[] = [
  { css: 'position: relative', sc: false, note: 'без `z-index` — только шестой шаг' },
  { css: 'position: relative; z-index: 0', sc: true, note: 'ноль — тоже число' },
  { css: 'position: absolute', sc: false, note: '' },
  { css: 'z-index: 5', sc: false, note: 'без `position` значение игнорируется' },
  { css: 'z-index: 1', parent: 'flex', sc: true, note: 'ребёнок flex-контейнера — без `position`' },
  { css: 'z-index: 1', parent: 'grid', sc: true, note: 'то же у grid' },
  { css: 'position: fixed', sc: true, note: 'всегда, даже без `z-index`' },
  { css: 'position: sticky', sc: true, note: 'всегда, даже без `z-index`' },
  { css: 'opacity: 0.99', sc: true, note: 'любое значение меньше 1, в том числе 0' },
  { css: 'opacity: 1', sc: false, note: 'анимация от 1 к 0.99 создаёт контекст на ходу' },
  { css: 'transform: translateZ(0)', sc: true, note: 'любое значение, кроме `none`' },
  { css: 'scale: 1', sc: true, note: 'отдельные `translate`, `rotate`, `scale` — даже ничего не меняя' },
  { css: 'filter: grayscale(0)', sc: true, note: 'фильтр, который ничего не делает, — тоже' },
  { css: 'backdrop-filter: blur(1px)', sc: true, note: '' },
  { css: 'isolation: isolate', sc: true, note: 'ничего больше не делает — для этого и есть' },
  { css: 'mix-blend-mode: multiply', sc: true, note: 'любое, кроме `normal`' },
  { css: 'clip-path: inset(0)', sc: true, note: 'а также `mask-image`, `perspective`' },
  { css: 'will-change: transform', sc: true, note: 'заранее — как будто `transform` уже стоит' },
  { css: 'will-change: top', sc: false, note: '`top` контекст не создаёт — и обещание его тоже' },
  { css: 'contain: paint', sc: true, note: 'а также `layout`, `content`, `strict`' },
  { css: 'contain: size', sc: false, note: 'и `contain: style` — нет' },
  { css: 'container-type: inline-size', sc: false, note: 'и `size` — нет' },
  { css: 'view-transition-name: card', sc: true, note: '' },
  { css: 'overflow: hidden', sc: false, note: 'обрезает, но слоёв не группирует' },
  { css: 'display: inline-block', sc: false, note: 'рисуется целиком, но не контекст' },
  { css: 'float: left', sc: false, note: 'то же' },
];

export const TRIGGER_NOTE =
  'Отдельная строка — `content-visibility: auto`. Сразу после вставки в страницу элемент с ним контекстом не был, а после пары кадров стал: браузер включает изоляцию, только когда решит, близко ли элемент к экрану. Изоляцию разбирает [«Кадр браузера», раздел «Чтение и запись»](/render/render-pipeline/#s3).';

export const COMPOSITOR_NOTE =
  'Контекст наложения и слой композитора — разные вещи, хотя создаются часто одними и теми же свойствами. Контекст — правило порядка: кто кого накрывает. Слой — отдельная картинка в видеопамяти, которую видеокарта двигает без перерисовки (об этом — [«Кадр браузера», раздел «Что дешевле двигать»](/render/render-pipeline/#s4) и [«Анимации и композитор», раздел «Слои и их цена»](/render/animations/#s5)). `isolation: isolate` создаёт контекст без слоя, а `will-change: transform` — и то и другое сразу.';

// ─── Раздел 3. Ловушка z-index ─────────────────────────────────────────────────────────────

export const TRAP_HTML = `<header style="position: relative; z-index: 1">
  <div class="modal" style="position: fixed; inset: 100px; z-index: 9999">
    Модальное окно
  </div>
</header>
<main style="position: relative; z-index: 2">…</main>`;

export const TRAP_STEPS = [
  'Корень страницы сравнивает своих детей-контексты: `header` с `z-index: 1` и `main` с `z-index: 2`. `main` выше.',
  '`.modal` живёт **внутри** контекста `header`. Его `9999` сравнивается только с соседями внутри шапки.',
  'Снаружи шапка со всем содержимым — один слой номер 1. Модальное окно оказывается под `main`, хотя у него самое большое число на странице.',
];

export const TRAP_FIXES: { t: string; d: string; tone?: 'ok' | 'warn' }[] = [
  {
    t: 'Вынести из контекста',
    d: 'Модальное окно кладут в конец `body` — порталом во фреймворке (`createPortal`, `<Teleport to="body">`) или руками. Тогда его `z-index` спорит с контекстами верхнего уровня.',
    tone: 'ok',
  },
  {
    t: 'Отправить в верхний слой',
    d: '`<dialog>` с `showModal()` или `popover` ложатся поверх всей страницы, откуда бы их ни открыли. `z-index` не нужен вовсе.',
    tone: 'ok',
  },
  {
    t: 'Снять `z-index` у шапки',
    d: 'Шапка с `z-index: auto` контекст не создаёт, и `9999` модального окна снова на корневом уровне. Работает, пока шапке не понадобится свой слой — например, при `position: sticky`, который создаёт контекст сам.',
    tone: 'warn',
  },
];

export const LEAK_HTML = `<header style="position: sticky; top: 0; z-index: 1">…</header>
<article class="card">
  <span class="badge" style="position: relative; z-index: 10">new</span>
</article>`;

export const LEAK_NOTE =
  'Обратная беда. Значок внутри карточки с `z-index: 10` при прокрутке вылезает **поверх** прилипшей шапки: карточка не контекст, и его `10` сравнивается с шапкой напрямую. `isolation: isolate` на карточке делает её контекстом и больше ничего не меняет — ни сдвигов, ни прозрачности, ни слоя в видеопамяти. Значок остаётся над соседями внутри карточки, а вся карточка — под шапкой.';

export const PLAIN_ISOLATE =
  'Как ящик для инструментов с перегородками. Внутри молоток можно положить поверх отвёртки, но из ящика он не вылезет и не ляжет поверх соседнего ящика. `isolation: isolate` — крышка: «всё, что внутри компонента, разбирается внутри».';

export const ISOLATE_ADVICE =
  'Отсюда правило для компонентов: **корень компонента, где есть свои `z-index`, — с `isolation: isolate`.** Числа внутри перестают зависеть от того, куда компонент вставили, а странице хватает нескольких уровней: содержимое, шапка, всплывающее — и не нужно воевать девятками.';

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

export const DEMO_SCENES: StackScene[] = [
  {
    id: 'trap',
    label: 'Ловушка 9999',
    note: 'Шапка с `z-index: 1`, внутри неё `modal` с `z-index: 9999`, рядом `main` с `z-index: 2`. Сверху `main`. Поставьте шапке `z-index: auto` — и модальное окно выйдет из её контекста.',
    tree: [
      {
        id: 'header',
        css: { position: 'relative', 'z-index': '1' },
        kids: [{ id: 'modal', css: { position: 'fixed', 'z-index': '9999' } }],
      },
      { id: 'main', css: { position: 'relative', 'z-index': '2' } },
    ],
  },
  {
    id: 'leak',
    label: 'Протечка',
    note: 'Значок карточки с `z-index: 10` выше прилипшей шапки. Дайте карточке `isolation` — значок останется внутри неё.',
    tree: [
      { id: 'header', css: { position: 'sticky', 'z-index': '1' } },
      {
        id: 'card',
        css: {},
        kids: [{ id: 'badge', css: { position: 'relative', 'z-index': '10' } }],
      },
    ],
  },
  {
    id: 'layers',
    label: 'Семь шагов',
    note: 'Сквозной пример раздела «Семь шагов отрисовки»: дети идут в разметке наоборот, а рисуются по шагам. Поменяйте вид или `z-index` одного из них — и посмотрите, на какой шаг он переедет.',
    tree: [
      {
        id: 'stage',
        css: { isolation: 'isolate' },
        kids: [
          { id: 'pos', css: { position: 'relative', 'z-index': '1' } },
          { id: 'auto', css: { position: 'relative' } },
          { id: 'inline', css: { display: 'inline-block' } },
          { id: 'float', css: { float: 'left' } },
          { id: 'block', css: {} },
          { id: 'neg', css: { position: 'relative', 'z-index': '-1' } },
        ],
      },
    ],
  },
  {
    id: 'negative',
    label: 'z-index: -1',
    note: 'У `child` отрицательный `z-index`, и он ушёл под фон `parent`: родитель не контекст. Дайте родителю `isolation` или `opacity` — и ребёнок окажется над его фоном.',
    tree: [{ id: 'parent', css: {}, kids: [{ id: 'child', css: { position: 'relative', 'z-index': '-1' } }] }],
  },
];

/** Варианты свойств в редакторе демо. Сцены выше собраны только из них. */
export const DEMO_OPTIONS: { position: PropOption[]; z: PropOption[]; kind: PropOption[]; effect: PropOption[] } = {
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'].map(
    (v): PropOption => ({ value: v, label: v, css: v === 'static' ? {} : { position: v } }),
  ),
  z: ['auto', '-1', '0', '1', '2', '10', '9999'].map(
    (v): PropOption => ({ value: v, label: v, css: v === 'auto' ? {} : { 'z-index': v } }),
  ),
  kind: [
    { value: 'block', label: 'блок', css: {} },
    { value: 'inline-block', label: 'inline-block', css: { display: 'inline-block' } },
    { value: 'float', label: 'float', css: { float: 'left' } },
    { value: 'flex', label: 'flex-контейнер', css: { display: 'flex' } },
  ],
  effect: [
    { value: 'none', label: '—', css: {} },
    { value: 'opacity', label: 'opacity: .9', css: { opacity: '0.9' } },
    { value: 'transform', label: 'transform', css: { transform: 'translateZ(0)' } },
    { value: 'filter', label: 'filter', css: { filter: 'blur(0)' } },
    { value: 'isolation', label: 'isolation', css: { isolation: 'isolate' } },
    { value: 'will-change', label: 'will-change', css: { 'will-change': 'transform' } },
    { value: 'contain', label: 'contain: paint', css: { contain: 'paint' } },
    { value: 'blend', label: 'mix-blend-mode', css: { 'mix-blend-mode': 'multiply' } },
  ],
};

export const DEMO_CAPTION =
  'Сцена — настоящие блоки в вашем браузере, каждый следующий сдвинут вправо и вниз, но все накрывают одну общую точку. Контексты и порядок считает `paintOrder` из раздела «Семь шагов отрисовки», а строка «ваш браузер» — `document.elementsFromPoint` в общей точке: браузер сам говорит, кто там сверху. Тест темы делает то же в Chromium на трёхстах случайных деревьях.';

// ─── Раздел 4. Верхний слой ────────────────────────────────────────────────────────────────

export const PLAIN_TOP =
  'Как субтитры в кино. Что бы ни происходило в кадре — кто кого заслонил, какой предмет ближе к камере, — субтитры идут поверх. Они не часть сцены, их накладывают отдельно и последними. Верхний слой — такие субтитры страницы: модальное окно, поповер, элемент во весь экран.';

/** Худшее место для модального окна — и `showModal()` всё равно кладёт его поверх. Исполняется тестом. */
export const TOP_HTML = `<div class="wall" style="position: fixed; inset: 0; z-index: 2147483647"></div>

<div style="position: relative; z-index: -1; opacity: .5;
            transform: translateX(10px); overflow: hidden; width: 50px; height: 50px">
  <dialog id="dlg" style="width: 200px; height: 100px">…</dialog>
</div>`;

export const TOP_CODE = `dlg.showModal();

document.elementFromPoint(400, 300) === dlg;   // true — поверх стены с максимальным z-index
dlg.matches(':modal');                         // true
getComputedStyle(dlg).position;                // 'fixed' — так велят стили браузера
getComputedStyle(dlg).overlay;                 // 'auto' — элемент в верхнем слое`;

export const TOP_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Предки больше не мешают',
    d: 'Окно 800×600, диалог 200×100 встал ровно в центр: `300, 250`. Сдвиг `transform` и обрезка `overflow: hidden` предка на него не действуют, `z-index: -1` предка — тоже, а пиксель в центре диалога — чистый цвет его фона: `opacity: .5` предка не применилась.',
    tone: 'ok',
  },
  {
    t: 'Но наследование остаётся',
    d: 'Из дерева элемент никуда не переезжает. Наследуемые свойства вроде `font-family` он берёт у своих предков, а клик внутри диалога всплывает через них — обработчик на предке срабатывает. Переезжает только картинка.',
  },
  {
    t: 'Подложка — `::backdrop`',
    d: 'У модального диалога она по умолчанию `rgba(0, 0, 0, 0.1)`: белая страница под ней на снимке — `229, 229, 229`. У поповера подложка есть, но прозрачная. Клик по подложке попадает в сам диалог: `elementFromPoint` отдаёт `dialog`.',
  },
];

export const TOP_ROWS: { k: string; how: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`dialog.showModal()`', how: 'верхний слой, модально: всё вне диалога инертно', tone: 'ok' },
  { k: '`dialog.show()`, атрибут `open`', how: '**не** верхний слой: обычный элемент со своим `z-index`, страница живая', tone: 'warn' },
  { k: '`popover="auto"` + `showPopover()`', how: 'верхний слой, не модально; закрывается кликом мимо, `Esc` и открытием другого `auto`-поповера', tone: 'ok' },
  { k: '`popover="manual"`', how: 'верхний слой; закрывается только из кода — `hidePopover()`', tone: 'ok' },
  { k: '`element.requestFullscreen()`', how: 'верхний слой с чёрной подложкой; только по действию пользователя', tone: 'ok' },
];

/** Порядок внутри верхнего слоя. Исполняется тестом: после каждой строки — кто сверху. */
export const ORDER_CODE = `a.showPopover();               // сверху a
b.showPopover();               // сверху b — открыт позже
a.style.zIndex = '999';        // сверху всё ещё b: z-index здесь не работает
a.hidePopover();
a.showPopover();               // сверху a — переоткрыт последним`;

export const ORDER_NOTE =
  'Верхний слой — это список, а не шкала. Элемент встаёт в конец списка в момент открытия, и рисуются они по порядку списка: кто открыт позже, тот выше. `::backdrop` каждого встаёт прямо под своим элементом, то есть **над** всеми открытыми раньше: поповер, открытый до модального диалога, на снимке темнеет до тех же `229`, что и страница, а открытый после — остаётся белым.';

export const OVERLAY_NOTE =
  'Анимировать вход и выход из верхнего слоя — отдельная история: у элемента нет предыдущего значения, с которого начать, а при закрытии он покидает слой мгновенно. Первое решает `@starting-style` (разобран в [«Каскаде и вычислении стилей», разделе «Шесть критериев»](/render/css-cascade/#s1)), второе — свойство `overlay` в списке `transition` с `allow-discrete`: `getComputedStyle(…).overlay` — `auto`, пока элемент в верхнем слое, и `none` вне его.';

// ─── Раздел 5. Модальное окно ──────────────────────────────────────────────────────────────

export const PLAIN_INERT =
  'Как экспонаты за стеклом в музее. Их видно, но дотронуться нельзя, а экскурсовод их не упоминает, пока вы у стенда с открытым буклетом. `showModal()` ставит такое стекло перед всей страницей, кроме самого диалога.';

export const MODAL_ROWS: { k: string; v: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'клик по кнопке под диалогом', v: 'обработчик не вызван' },
  { k: '`elementFromPoint` над той же кнопкой', v: 'сам `dialog`: попадание в подложку' },
  { k: '`button.focus()` снаружи', v: 'фокус остаётся в диалоге' },
  { k: 'Tab', v: 'кнопки диалога, затем шаг за пределы страницы (`activeElement` — `body`) и снова первая кнопка' },
  { k: 'дерево доступности', v: 'узлов снаружи нет; у диалога `modal: true`', tone: 'ok' },
  { k: 'атрибут `inert` у страницы', v: 'не появляется: `button.inert === false`', tone: 'warn' },
  { k: '`Esc`', v: 'закрывает; фокус возвращается туда, где был до открытия', tone: 'ok' },
  { k: 'фокус при открытии', v: 'первый фокусируемый внутри, а с атрибутом `autofocus` — он' },
];

export const MODAL_NOTE =
  'Это ровно то, что делает атрибут `inert`, только без атрибута: браузер помнит, что страница «заблокирована модальным диалогом», и обращается с ней как с инертной. Сам `inert` и то, как он убирает узлы из дерева доступности, разобраны в [«Дереве доступности», разделе «Что попадает в дерево»](/render/accessibility-tree/#s2). Новый атрибут `closedby="any"` добавляет модальному диалогу закрытие кликом по подложке — на стенде клик мимо закрыл его.';

export const MODAL_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`showModal()` закрывает `auto`-поповеры',
    d: 'Открытый `popover="auto"` при открытии модального диалога закрылся, а `popover="manual"` остался. Поповер внутри диалога открывается поверх него как обычно.',
    tone: 'warn',
  },
  {
    t: 'Виден, но не кликается',
    d: '`manual`-поповер, открытый **после** модального диалога, встаёт выше него: пиксель — цвет поповера. Но он вне диалога, а значит инертен: `elementsFromPoint` в этой точке его не видит, клики проходят мимо.',
    tone: 'err',
  },
  {
    t: 'Диалог в скрытом родителе',
    d: '`showModal()` у диалога внутри `display: none`: `open` — `true`, `:modal` — да, ширина — 0. Диалога не видно, а страница уже инертна: `elementFromPoint` в любой точке отдаёт `<html>`. Пользователь видит страницу, которая перестала отвечать.',
    tone: 'err',
  },
  {
    t: 'Полный экран в Chromium',
    d: 'Пока элемент во весь экран, в Chromium 153 инертно всё вне него — даже поповер, открытый поверх: его видно, но `elementsFromPoint` его не находит, а `focus()` на кнопке в нём не срабатывает. Поповер **внутри** полноэкранного элемента работает.',
    tone: 'warn',
  },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`z-index: 9999` не выводит из контекста',
    d: 'Число сравнивается только с соседями внутри ближайшего контекста. Модальное окно внутри шапки с `z-index: 1` ниже `main` с `z-index: 2`, какое бы число у него ни стояло. Лечат не числом, а местом: портал в `body` или верхний слой.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`z-index` без `position` молчит',
    d: 'У обычного блока значение игнорируется без всякого предупреждения. А у ребёнка flex- или grid-контейнера оно работает и без `position` — поэтому одно и то же правило ведёт себя по-разному в зависимости от родителя.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Контекст создают свойства «не про слои»',
    d: '`opacity` меньше 1, любой `transform` и `filter`, `will-change`, `contain: paint`, `mix-blend-mode`, `position: sticky`. Добавили к шапке плавное появление — и `z-index` всплывающего меню внутри неё перестал выходить наружу.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Анимация `opacity` переставляет слои на ходу',
    d: 'При `opacity: 1` элемент не контекст, при `0.99` — уже да. Пока идёт анимация, его позиционированные дети заперты внутри, а на последнем кадре выходят обратно — и могут прыгнуть поверх соседей или под них.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`z-index: -1` проваливается под фон',
    d: 'Ребёнок с отрицательным `z-index` уходит в ближайший контекст выше и рисуется до фона своего родителя. Если родитель белый и непрозрачный, ребёнка просто не видно. Чтобы подложка осталась под содержимым, но над фоном, родителю нужен контекст — `isolation: isolate`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`container-type` контекст не создаёт',
    d: 'В Chromium 153 ни `inline-size`, ни `size` контекста не дают, хотя и включают часть изоляции. Старые статьи и ответы утверждают обратное — проверяйте поведением, а не списком из памяти.',
  },
  {
    n: '07',
    t: 'В верхнем слое `z-index` не работает',
    d: 'Порядок там — время открытия. Поповер с `z-index: 999`, открытый раньше, лежит под поповером без `z-index`, открытым позже. Поднять наверх — закрыть и открыть заново.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`show()` — не модальный и не верхний слой',
    d: 'Диалог, открытый `show()` или атрибутом `open`, — обычный элемент: его перекроет любой контекст выше, и страница под ним кликается. Поверх всего кладёт только `showModal()`.',
    tone: 'err',
  },
  {
    n: '09',
    t: 'Модальный диалог в скрытом родителе блокирует страницу',
    d: '`showModal()` у диалога внутри `display: none` открывает его без единого пикселя на экране — а всё остальное уже инертно. Ошибки в консоли нет.',
    tone: 'err',
  },
  {
    n: '10',
    t: 'Поверх модального — видно, но мертво',
    d: '`manual`-поповер, открытый после `showModal()`, рисуется выше диалога, но лежит вне него и потому инертен. Всплывающее внутри модального окна кладут **внутрь** диалога.',
    tone: 'err',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'CSS 2.1, Appendix E — Elaborate description of Stacking Contexts',
    href: 'https://www.w3.org/TR/CSS21/zindex.html',
    what: 'семь шагов отрисовки, атомарная отрисовка float и `inline-block`',
  },
  {
    title: 'CSS Flexbox 1 — Flex Item Z-Ordering',
    href: 'https://www.w3.org/TR/css-flexbox-1/#painting',
    what: 'flex-элементы рисуются как `inline-block`, `z-index` работает без `position`',
  },
  {
    title: 'CSS Positioned Layout 4',
    href: 'https://drafts.csswg.org/css-position-4/',
    what: 'верхний слой, `::backdrop`, свойство `overlay`',
  },
  {
    title: 'Compositing and Blending 1 — isolation',
    href: 'https://www.w3.org/TR/compositing-1/#isolation',
    what: '`isolation: isolate`, `mix-blend-mode`',
  },
  {
    title: 'CSS Will Change 1',
    href: 'https://www.w3.org/TR/css-will-change-1/',
    what: '`will-change` создаёт контекст, если его создало бы само свойство',
  },
  {
    title: 'HTML Standard — The dialog element',
    href: 'https://html.spec.whatwg.org/multipage/interactive-elements.html#the-dialog-element',
    what: '`showModal()`, `show()`, `closedby`, фокус при открытии и закрытии',
  },
  {
    title: 'HTML Standard — Popover',
    href: 'https://html.spec.whatwg.org/multipage/popover.html',
    what: '`auto` и `manual`, закрытие кликом мимо',
  },
  {
    title: 'HTML Standard — Inert subtrees',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#inert-subtrees',
    what: 'страница, заблокированная модальным диалогом',
  },
  {
    title: 'Fullscreen API Standard',
    href: 'https://fullscreen.spec.whatwg.org/',
    what: '`requestFullscreen()`, верхний слой, `:fullscreen`',
  },
  {
    title: 'MDN — Stacking context',
    href: 'https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_positioned_layout/Stacking_context',
    what: 'полный список свойств, создающих контекст',
  },
];

export const RELATED =
  'Смежное на сайте: [Кадр браузера, раздел «Что дешевле двигать»](/render/render-pipeline/#s4) — слои композитора и `will-change`, которые путают с контекстами. [Анимации и композитор, раздел «Слои и их цена»](/render/animations/#s5) — когда элемент получает свой слой и сколько он стоит. [Каскад и вычисление стилей, раздел «Шесть критериев»](/render/css-cascade/#s1) — `@starting-style` для появления диалога и поповера. [Дерево доступности, раздел «Что попадает в дерево»](/render/accessibility-tree/#s2) — `inert` и то, что видит скринридер. [Прокрутка изнутри](/render/scrolling/) — липкие шапки, якорь прокрутки при догрузке сверху, snap и `scroll-padding`.';
