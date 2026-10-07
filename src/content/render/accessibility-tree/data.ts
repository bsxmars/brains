import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { AxCase, AxScene, ChromeVerdict } from '@/widgets/ax-tree-lab/model/types';

/**
 * Данные темы «Дерево доступности: что видит скринридер».
 *
 * Тема написана здесь, 2026-10-01, для направления «Браузер и рендеринг».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium **153.0.8010.12** (headless shell из Playwright 1.63, `chromium.launch()`),
 * happy-dom 20.14.5, axe-core **4.13.0**, Node 24.11.0, macOS, октябрь 2026. Скрипты стенда —
 * вне проекта, в рабочем каталоге автора темы (`stand1-cases.mjs` … `stand7-extra.mjs`);
 * страницы отдаёт свой `node:http` на localhost.
 *
 * Что снято:
 *   — `CASES` (88 фикстур, цель помечена `data-k`): CDP `DOM.describeNode` → `backendNodeId`,
 *     затем `Accessibility.getPartialAXTree({ fetchRelatives: false })`. Из ответа взяты роль,
 *     имя, `ignored` с причинами, источник имени (первый из `name.sources`, не помеченный
 *     `superseded` и с непустым значением) и свойства `focusable`, `disabled`, `checked`,
 *     `pressed`, `expanded`, `level` (у заголовков), `live`. Нормализация, и только она:
 *       · роль `image` записана как `img` (внутреннее имя Chromium против роли ARIA);
 *       · `ignored` с причинами `notRendered`, `notVisible`, `ariaHiddenElement`,
 *         `ariaHiddenSubtree`, `inertElement` → `{ hidden: true }`; с причиной `uninteresting`
 *         (у `<a>` без `href`) → роль `generic`; прочие игнорируемые (`emptyAlt`,
 *         `presentationalRole`) → `none`;
 *       · имя обрезано по краям: CDP отдаёт хвостовой пробел («Сохранить », «Имя »);
 *       · источники CDP переведены в слова темы: `contents` → `content`,
 *         `relatedElement:labelfor`/`labelwrapped` → `label`, `relatedElement:tablecaption` →
 *         `caption`, `relatedElement:legend` → `legend`, `attribute:*` → имя атрибута,
 *         `placeholder` → `placeholder`;
 *   — `SCENES[].elements`: то же по каждому элементу сцены; `generic`, `none` и внутренние роли
 *     Chromium `LabelText` и `Legend` без имени записаны `~` (растворяются в дереве).
 *     `SCENES[].tabs` — настоящие нажатия `page.keyboard.press('Tab')` от начала документа,
 *     номер `document.activeElement` в списке элементов сцены, пока фокус не вернулся;
 *   — `KEY_ROWS`: `el.focus()`, затем `page.keyboard.press('Enter' | 'Space')`, счётчик вызовов
 *     `onclick`. Пробел у кнопки: после `keyboard.down(' ')` вызовов 0, после `up` — 1; Enter —
 *     1 уже на `down`. Порядок Tab в контейнере `flex-direction: row-reverse` — по документу
 *     («Один», «Два», «Три»), хотя «Один» нарисован правее всех (x = 1223, 1184, 1146);
 *   — `SHADOW_ROWS`: `Accessibility.getFullAXTree`, три поля в открытых теневых корнях;
 *   — `ROLE_FACTS`, `TAB_FACTS` (`stand7-extra.mjs`): `<button role="heading">` — в CDP роль
 *     `heading`, `level=2`, `focusable=true`; Enter и пробел вызвали `onclick` оба раза. Кнопки
 *     A, B, C: фокус на B, `B.remove()` → `activeElement` — `BODY`, следующий Tab — на C;
 *   — `AXE_SCENES`: `axe.run(document)` со всеми правилами в Chromium на каждой сцене; правила
 *     уровня страницы (`region`, `landmark-one-main`, `page-has-heading-one`) отброшены — сцена
 *     не страница;
 *   — `DIVERGE_ROWS`: тот же `CASES`, плюс `page.locator('body').ariaSnapshot()` Playwright —
 *     у Playwright своё вычисление роли и имени, не из Chromium.
 *
 * Учебные функции (`HIDDEN_CODE` … `TREE_CODE`) на стенде исполнялись и в Chromium, и в
 * happy-dom: 87 фикстур из 88 совпали с CDP по роли, имени, источнику имени и скрытости, все
 * сцены — по каждому элементу и по порядку Tab. Расхождение одно и намеренное: `btn-before`,
 * текст из CSS `::before` (вне подмножества, см. `NAME_FACTS`).
 *
 * Не снято, взято из документации: как именно и когда скринридер **озвучивает** живой регион
 * (`LIVE_FACTS` — по WAI-ARIA 1.2 и MDN, headless-браузер не даёт наблюдать объявления; со
 * стенда там только свойства `live`/`atomic` у `status`, `alert`, `output`); что Chromium
 * строит дерево доступности лениво, по запросу (документация Chromium); имена API платформ
 * (UI Automation, NSAccessibility, AT-SPI). Firefox и Safari стенд не снимал.
 *
 * Тест `tests/unit/accessibility-tree.test.ts` исполняет те же строки кода в happy-dom по всем
 * фикстурам и сценам и сверяет с литералами Chromium; там же axe-core в happy-dom повторяет
 * `AXE_SCENES` (правила про роли и фокус, без раскладки), `DIY_BUTTON_CODE` и `LIVE_CODE`
 * исполняются. Браузер в тесте не поднимается: сменится Chromium — стенд перезапускается руками.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'дерево доступности',
    d: 'Второе дерево, которое браузер строит рядом с DOM. В нём только то, что имеет смысл для человека: кнопки, ссылки, заголовки, поля, текст. У каждого узла — роль, имя и состояния. Обёртки без смысла в него не попадают.',
  },
  {
    k: 'скринридер',
    d: 'Программа экранного доступа: NVDA и JAWS в Windows, VoiceOver в macOS и iOS, TalkBack в Android. Читает дерево доступности через API операционной системы и произносит его вслух или выводит на брайлевский дисплей.',
  },
  {
    k: 'роль',
    d: 'Что это за узел: `button`, `link`, `heading`, `textbox`, `list`. Неявная роль берётся из тега, явная — из атрибута `role`. От роли зависит, что скажет скринридер и какие команды он предложит.',
  },
  {
    k: 'доступное имя',
    d: 'То, что звучит вместе с ролью: «кнопка, **Купить**». Браузер вычисляет его по алгоритму из спецификации accname: смотрит `aria-labelledby`, `aria-label`, `<label>`, `alt`, текст внутри, `title` — в строгом порядке.',
  },
  {
    k: 'состояние',
    d: 'Изменчивые свойства узла: выключен (`disabled`), отмечен (`checked`), раскрыт (`expanded`), нажат (`pressed`), уровень заголовка. Берутся из родных атрибутов HTML и из `aria-*`.',
  },
  {
    k: 'ARIA',
    d: 'WAI-ARIA — набор атрибутов `role` и `aria-*`. Они меняют то, что попадёт в дерево доступности, и ничего больше: ни фокуса, ни реакции на клавиши не добавляют.',
  },
  {
    k: 'ориентир (landmark)',
    d: 'Крупная область страницы с ролью `banner`, `navigation`, `main`, `region`, `contentinfo`. Скринридер умеет прыгать между ними одной клавишей, как зрячий взглядом.',
  },
  {
    k: 'фокус и порядок Tab',
    d: 'Фокус — элемент, который сейчас получает нажатия клавиш. Tab переводит фокус на следующий элемент, Shift+Tab — на предыдущий. Порядок задают разметка и атрибут `tabindex`.',
  },
];

export const PLAIN_AXTREE =
  'Как опись квартиры для того, кто её не видит. Дизайнер подобрал обои и свет, а опись говорит: «дверь, ведёт в кухню; выключатель, сейчас выключен». Дверь, нарисованная на стене, в опись не попадёт, как бы похоже её ни нарисовали. А настоящая дверь без таблички запишется как «дверь» — и всё, куда она ведёт, придётся угадывать.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из других тем и на одну, которой на сайте нет, — она объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Вычисленный стиль и наследование',
    d: 'Для каждого элемента браузер вычисляет итоговое значение каждого свойства CSS. Одни свойства наследуются детьми, другие нет: `visibility: hidden` у родителя прячет и детей через наследование, а `display: none` не наследуется — он просто не даёт рисовать всё поддерево.',
    href: '/render/css-cascade/#s3',
    hrefLabel: '«Каскад и вычисление стилей», раздел «Наследование»',
    tone: 'info',
  },
  {
    t: 'Фокус и действие по умолчанию',
    d: 'Нажатие клавиши приходит в элемент с фокусом. Клик по кнопке или ссылке запускает её «поведение активации»: отправить форму, перейти по адресу.',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», раздел «Действие по умолчанию»',
    tone: 'info',
  },
  {
    t: 'Shadow DOM',
    d: 'Веб-компонент прячет свою разметку в теневое дерево. Селекторы и `id` снаружи туда не достают, и изнутри наружу тоже.',
    href: '/render/web-components-styles/#s1',
    hrefLabel: '«Стили веб-компонентов», раздел «Граница»',
    tone: 'info',
  },
  {
    t: 'Как слушает скринридер',
    d: 'Человек со скринридером не видит страницу целиком. Он двигается по дереву: следующий заголовок (клавиша H в NVDA), следующий ориентир, следующий элемент по Tab — и слышит роль, имя и состояние: «кнопка, Купить», «флажок, Курьером, отмечен». Порядок — порядок узлов в дереве, а не расположение на экране.',
    tone: 'info',
  },
];

// ─── Раздел 1. Второе дерево ───────────────────────────────────────────────────────────────

export const TREE_CODE = `// Дерево: скрытое выпадает целиком, безымянные generic и none
// растворяются — их дети поднимаются к родителю. Текст — листьями.
function axTree(el) {
  const kids = [];
  for (const n of el.childNodes) {
    if (n.nodeType === 3 && n.data.trim()) kids.push({ role: 'text', name: n.data.replace(/\\s+/g, ' ').trim(), children: [] });
    if (n.nodeType !== 1 || isHidden(n)) continue;
    const role = roleOf(n);
    const { name, from } = accName(n);
    const children = axTree(n);
    if ((role === 'generic' || role === 'none') && !name) kids.push(...children);
    // Имя из текста уже сказано — текстовые листья под ним не повторяем.
    else kids.push({ role, name, from, states: statesOf(n, role), focusable: focusable(n), el: n,
      children: from === 'content' ? children.filter((c) => c.role !== 'text') : children });
  }
  return kids;
}`;

export const TREE_NOTE =
  '`axTree` обходит DOM и для каждого элемента спрашивает четыре вещи: скрыт ли он (`isHidden`), какая у него роль (`roleOf`), какое имя (`accName`) и состояния (`statesOf`). Сами эти функции — в разделах про скрытое, роли и имена. Безымянный `generic` растворяется: в дереве Chromium такие узлы есть, но скринридер их не называет, и детей он слышит так, будто обёртки нет.';

/** Подпись под демо. */
export const DEMO_CAPTION =
  'Дерево считают функции темы прямо в вашем браузере: сцена вставлена в скрытый `iframe`, а `axTree`, `accName` и `tabOrder` работают с настоящим DOM и настоящими вычисленными стилями. Строка «Chromium 153» под деревом — сверка с тем, что для той же разметки отдал через CDP настоящий Chromium на стенде: роль и имя каждого элемента и порядок нажатий Tab.';

export const TREE_FACTS: { t: string; d: string; tone?: 'warn' }[] = [
  {
    t: 'Девять элементов — шесть узлов',
    d: 'В «Карточке» девять элементов, включая `svg` и `path`. В дереве — шесть узлов с ролями и текст. Иконка с `aria-hidden` выпала, а `div` с обработчиком клика растворился: от него осталась строка «Купить», для скринридера это просто текст.',
  },
  {
    t: 'Кто читает дерево',
    d: 'Браузер отдаёт дерево операционной системе: UI Automation и IAccessible2 в Windows, NSAccessibility в macOS, AT-SPI в Linux. Скринридер спрашивает систему, а не страницу. Chromium строит дерево только тогда, когда его кто-то попросил: программа экранного доступа, DevTools или CDP.',
  },
  {
    t: 'Как посмотреть самому',
    d: 'DevTools Chromium: вкладка Elements, панель Accessibility — роль, имя и откуда оно взялось; там же переключатель на дерево всей страницы. Из кода — CDP `Accessibility.getFullAXTree` или `locator.ariaSnapshot()` в Playwright.',
  },
];

// ─── Раздел 2. Что попадает в дерево ───────────────────────────────────────────────────────

export const HIDDEN_CODE = `const style = (el) => el.ownerDocument.defaultView.getComputedStyle(el);

// Не отрисован или выключен: таких нет ни в дереве, ни в порядке Tab.
function unreachable(el) {
  for (let n = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden') || n.hasAttribute('inert')) return true;
    if (style(n).display === 'none') return true;   // display не наследуется — идём вверх
  }
  const v = style(el).visibility;                   // а visibility наследуется
  return v === 'hidden' || v === 'collapse';
}

// aria-hidden прячет от дерева доступности, но не от клавиатуры.
const ariaHidden = (el) => el.closest('[aria-hidden="true"]') !== null;
const isHidden = (el) => unreachable(el) || ariaHidden(el);`;

export const PLAIN_HIDDEN =
  'Спрятать от глаз и спрятать от скринридера — разные действия. `opacity: 0` — это стеклянная дверь: её не видно, но она на месте, в неё можно войти и о неё можно споткнуться. `aria-hidden` — наоборот, дверь, которую вычеркнули из описи, но не заперли: зрячий её видит, а клавиатура в неё проходит.';

/** Сцена «Спрятано» на стенде: в дереве и в порядке Tab. Сверяется тестом с `SCENES`. */
export const HIDE_ROWS: { k: string; tree: string; tab: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`display: none`', tree: 'нет', tab: 'нет' },
  { k: '`visibility: hidden`', tree: 'нет', tab: 'нет' },
  { k: 'атрибут `hidden`', tree: 'нет', tab: 'нет' },
  { k: '`inert` на предке', tree: 'нет', tab: 'нет' },
  { k: '`aria-hidden="true"`', tree: 'нет', tab: '**да**', tone: 'err' },
  { k: '`opacity: 0`', tree: 'да', tab: 'да', tone: 'warn' },
  { k: '1×1 px, `overflow: hidden`, `clip-path`', tree: 'да', tab: 'да', tone: 'ok' },
];

export const HIDE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`aria-hidden` на фокусируемом — призрак',
    d: 'Кнопка с `aria-hidden="true"` пропала из дерева, но Tab на неё по-прежнему попадает. Человек со скринридером оказывается на элементе, о котором не сказано ни слова, а Enter на нём что-то делает. axe называет это правилом `aria-hidden-focus`.',
    tone: 'err',
  },
  {
    t: '«Только для скринридера»',
    d: 'Элемент размером в пиксель с обрезанным содержимым глазу не виден, а в дереве на месте — с ролью, именем и фокусом. Так делают подписи к иконкам и пропуск к основному содержимому. `display: none` для этого не годится: он убирает и из дерева.',
    tone: 'ok',
  },
  {
    t: '`inert` — выключить кусок страницы целиком',
    d: 'Атрибут убирает поддерево и из дерева доступности, и из порядка Tab, и из кликов. Так выключают страницу под открытым диалогом. Без `inert` это делали тремя приёмами сразу: `aria-hidden`, `tabindex="-1"` на каждом элементе и перехват кликов.',
  },
  {
    t: 'Растворился — не значит выпал',
    d: '`div` и `span` без роли и имени получают роль `generic`, и Chromium обычно помечает их как неинтересные. Их дети остаются в дереве и поднимаются к ближайшему осмысленному предку. Выпадает поддерево только у скрытого.',
  },
];

// ─── Раздел 3. Роль ────────────────────────────────────────────────────────────────────────

export const ROLE_CODE = `// Подмножество HTML-AAM: только эти роли и элементы.
const KNOWN = new Set(['alert', 'article', 'banner', 'button', 'checkbox', 'combobox',
  'complementary', 'contentinfo', 'dialog', 'figure', 'form', 'generic', 'group', 'heading', 'img',
  'link', 'list', 'listitem', 'main', 'navigation', 'none', 'paragraph', 'presentation',
  'region', 'search', 'status', 'table', 'textbox']);

function implicitRole(el) {
  const tag = el.localName;
  const type = (el.getAttribute('type') || 'text').toLowerCase();
  const scoped = el.parentElement?.closest('article, aside, main, nav, section');
  switch (tag) {
    case 'button': return 'button';
    case 'a': return el.hasAttribute('href') ? 'link' : 'generic';
    case 'img': return el.getAttribute('alt') === '' ? 'none' : 'img';
    case 'input':
      if (type === 'checkbox') return 'checkbox';
      if (['submit', 'button', 'reset'].includes(type)) return 'button';
      return 'textbox';                             // text, email, tel, url, без list
    case 'textarea': return 'textbox';
    case 'select': return 'combobox';               // без multiple и size > 1
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'nav': return 'navigation';
    case 'main': return 'main';
    case 'aside': return 'complementary';
    case 'article': return 'article';
    case 'header': return scoped ? 'sectionheader' : 'banner';
    case 'footer': return scoped ? 'sectionfooter' : 'contentinfo';
    case 'section': return hasOwnLabel(el) ? 'region' : 'generic';
    case 'form': return 'form';
    case 'ul': case 'ol': return 'list';
    case 'li': return 'listitem';
    case 'p': return 'paragraph';
    case 'fieldset': return 'group';
    case 'table': return 'table';
    case 'output': return 'status';
    case 'dialog': return 'dialog';
    case 'figure': return 'figure';
    default: return 'generic';                      // div, span, b, label, small…
  }
}

const hasOwnLabel = (el) =>
  !!(el.getAttribute('aria-label') || '').trim() || el.hasAttribute('aria-labelledby');

function roleOf(el) {
  // role="foo button": берётся первое знакомое слово, незнакомые пропускаются.
  const tokens = (el.getAttribute('role') || '').trim().toLowerCase().split(/\\s+/);
  let role = tokens.find((t) => KNOWN.has(t));
  if (role === 'presentation') role = 'none';
  // Фокусируемому элементу снять роль нельзя: браузер оставляет родную
  // (tabIndexOf — в коде про фокус).
  if (role === 'none' && tabIndexOf(el) !== null) role = undefined;
  return role || implicitRole(el);
}

function statesOf(el, role) {
  const s = {};
  const native = ['button', 'input', 'select', 'textarea'].includes(el.localName);
  if ((native && el.hasAttribute('disabled')) || el.getAttribute('aria-disabled') === 'true') s.disabled = true;
  if (role === 'checkbox') s.checked = el.localName === 'input' ? String(el.checked) : el.getAttribute('aria-checked') || 'false';
  for (const a of ['pressed', 'expanded']) {
    const v = el.getAttribute('aria-' + a);
    if (v === 'true' || v === 'false') s[a] = v;
  }
  if (el.localName === 'select') s.expanded = 'false';      // закрытый список
  if (role === 'heading') s.level = Number(el.getAttribute('aria-level')) || Number(el.localName[1]) || 2;
  const live = el.getAttribute('aria-live') || { status: 'polite', alert: 'assertive' }[role];
  if (live && live !== 'off') s.live = live;
  return s;
}`;

export const PLAIN_ROLE =
  'Тег — это табличка на двери, которую браузер вешает сам: `<button>` — «кнопка», `<nav>` — «навигация». Атрибут `role` — табличка, повешенная поверх старой. Она меняет то, что прочитают, но не то, что за дверью: кладовка с табличкой «выход» не становится выходом.';

/** Фикстуры для таблицы ролей: id из `CASES` и пояснение. Роль — из литерала Chromium. */
export const ROLE_PICKS: { id: string; note: string }[] = [
  { id: 'a-href', note: 'Ссылка — только с `href`.' },
  { id: 'a-no-href', note: 'Без `href` это не ссылка: ни роли, ни фокуса, просто текст.' },
  { id: 'nav-plain', note: 'Ориентир, даже без имени.' },
  { id: 'h2', note: 'Уровень — состояние узла: `level: 2`.' },
  { id: 'section-plain', note: 'Без имени `section` — не ориентир.' },
  { id: 'section-named', note: 'С именем — ориентир `region`.' },
  { id: 'header-top', note: 'Шапка страницы.' },
  { id: 'header-in-article', note: 'Внутри `article` — уже не шапка страницы.' },
  { id: 'img-empty-alt', note: 'Пустой `alt` — «картинка для красоты», в дереве её нет.' },
  { id: 'ul-nostyle', note: 'Chromium оставляет список и без маркеров.' },
  { id: 'div-onclick', note: 'Обработчик клика роли не даёт.' },
  { id: 'div-role-button', note: 'Явная роль — кнопка для скринридера.' },
  { id: 'div-role-typo', note: 'Опечатка: роль молча не применилась.' },
  { id: 'div-role-list', note: 'Неизвестное слово пропущено, взято следующее.' },
  { id: 'btn-presentation', note: 'Фокусируемому элементу роль не снять.' },
  { id: 'span-presentation', note: 'Обычному — снять можно.' },
];

export const ROLE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Первое правило ARIA',
    d: 'Если есть родной элемент с нужной ролью и поведением, берут его, а не `div` с `role`. Спецификация «Using ARIA» ставит это правило первым, и причина — в разделе про `div` с `onclick`: роль — только табличка.',
  },
  {
    t: 'Опечатка в роли не видна никому, кроме axe',
    d: '`role="buton"` браузер не понимает и молча берёт роль тега — `generic`. Ни ошибки в консоли, ни предупреждения. axe-core находит это правилом `aria-roles`.',
    tone: 'err',
  },
  {
    t: 'Роль меняет только дерево',
    d: '`<button role="heading">` в дереве Chromium стал заголовком второго уровня, а Enter и пробел на стенде по-прежнему его нажимали. `<div role="button">` без `tabindex` стал кнопкой для скринридера, а фокуса так и не получил.',
    tone: 'warn',
  },
];

// ─── Раздел 4. Доступное имя ───────────────────────────────────────────────────────────────

export const PLAIN_NAME =
  'Как подписать коробку при переезде. Если на коробку наклеен ярлык со ссылкой «см. опись №3», пишут то, что в описи (`aria-labelledby`). Нет ссылки — смотрят надпись маркером (`aria-label`). Нет надписи — родной ярлык производителя (`<label>`, `alt`). Нет и его — открывают и перечисляют содержимое. Последний шанс — бумажка, приклеенная скотчем сбоку (`title`).';

export const NAME_STEPS: { step: string; what: string; tone?: 'warn' }[] = [
  { step: '2A', what: 'Скрытый узел имени не даёт — если до него не дошли по `aria-labelledby`.' },
  { step: '2B', what: '`aria-labelledby`: тексты узлов по списку `id`, через пробел. Ссылки внутри них уже не раскрываются.' },
  { step: '2C', what: '`aria-label`, если в нём есть что-то кроме пробелов.' },
  { step: '2D', what: 'Родной способ HTML: `<label>` у поля, `alt` у картинки, `<legend>` у группы, `<caption>` у таблицы, `value` у кнопки-`input`.' },
  { step: '2E', what: 'Поле внутри подписи даёт своё значение. В учебную функцию не входит.', tone: 'warn' },
  { step: '2F–2H', what: 'Содержимое: текст и имена детей подряд, если роль берёт имя из содержимого (`button`, `link`, `heading`…), а внутри обхода — всегда. Блочные дети отделяются пробелом.' },
  { step: '2I', what: '`title`. У полей после него — `placeholder` (это уже правило HTML-AAM).' },
];

export const NAME_CODE = `// Роли, которые берут имя из своего текста (из подмножества темы).
const FROM_CONTENT = new Set(['button', 'link', 'heading', 'checkbox']);

// Имя и шаг, на котором оно нашлось. mode: 'top' — сам элемент,
// 'child' — обход содержимого, 'ref' — узел, на который сослался aria-labelledby.
function nameStep(el, mode = 'top', showHidden = false) {
  // 2A. Скрытое не звучит — кроме того, на что сослались по aria-labelledby.
  if (!showHidden && isHidden(el)) return ['', 'hidden'];

  // 2B. aria-labelledby: тексты узлов по списку id, через пробел. Только один уровень.
  if (mode === 'top') {
    // id ищутся в своём дереве: из Shadow DOM документ не виден, и наоборот.
    const root = el.getRootNode();
    const refs = (el.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map((id) => id && root.getElementById(id)).filter(Boolean);
    if (refs.length) {
      const parts = refs.map((r) => nameStep(r, 'ref', isHidden(r))[0].trim());
      return [parts.join(' '), 'aria-labelledby'];
    }
  }

  // 2C. aria-label — если в нём есть что-то кроме пробелов.
  const label = (el.getAttribute('aria-label') || '').trim();
  if (label) return [label, 'aria-label'];

  // 2D. Родной способ HTML: label у поля, alt у картинки, legend, caption, value.
  const own = nativeName(el);
  if (own[0].trim()) return own;

  // 2F. Из содержимого — если роль это разрешает, а внутри обхода всегда.
  const role = roleOf(el);
  if (mode !== 'top' || FROM_CONTENT.has(role)) {
    const text = contentOf(el, showHidden);
    if (text.trim()) return [text, 'content'];
  }

  // 2I. title — последний запасной. У generic Chromium его не берёт.
  const title = el.getAttribute('title') || '';
  if (title.trim() && (mode !== 'top' || role !== 'generic')) return [title, 'title'];
  // Для полей после title — placeholder (HTML-AAM).
  const ph = el.getAttribute('placeholder') || '';
  if (ph.trim() && ['input', 'textarea'].includes(el.localName)) return [ph, 'placeholder'];
  return ['', ''];
}

function nativeName(el) {
  const tag = el.localName;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) {
    return [el.getAttribute('value') || '', 'value'];
  }
  if (['input', 'select', 'textarea'].includes(tag)) {
    // Все label этого поля в порядке документа: for="id" и обёртка.
    const labels = [...el.getRootNode().querySelectorAll('label')].filter((l) =>
      (el.id && l.getAttribute('for') === el.id) || (!l.hasAttribute('for') && l.contains(el)));
    return [labels.map((l) => contentOf(l, false)).join(' '), 'label'];
  }
  if (tag === 'img') return [el.getAttribute('alt') || '', 'alt'];
  const first = { fieldset: 'legend', table: 'caption' }[tag];
  if (first) {
    const child = [...el.children].find((c) => c.localName === first);
    if (child) return [contentOf(child, false), first];
  }
  return ['', ''];
}

// Текст содержимого: текстовые узлы как есть, элементы — рекурсией.
// Блочный элемент отделяется пробелами, строчный — нет: «Ска<b>чать</b>» → «Скачать».
function contentOf(el, showHidden) {
  let out = '';
  for (const n of el.childNodes) {
    if (n.nodeType === 3) out += n.data;
    if (n.nodeType !== 1) continue;
    if (['input', 'select', 'textarea'].includes(n.localName)) continue; // 2E — вне подмножества
    const part = nameStep(n, 'child', showHidden)[0];
    const display = style(n).display;
    out += display && !display.startsWith('inline') ? ' ' + part + ' ' : part;
  }
  return out;
}

// Итог: пробелы схлопнуты, края обрезаны.
function accName(el) {
  const [text, from] = nameStep(el);
  const name = text.replace(/\\s+/g, ' ').trim();
  return { name, from: name ? from : '' };
}`;

export const NAME_NOTE =
  'Учебная функция покрывает подмножество: роли и элементы из раздела про роли, без шага 2E, без текста из CSS (`::before`, `::after`) и без `aria-describedby`. На 88 фикстурах стенда она совпала с Chromium 153 по роли, имени и шагу, на котором имя нашлось, во всех случаях, кроме одного — `::before`.';

/** Фикстуры для таблицы имён: id из `CASES`. Имя и шаг — из литерала Chromium. */
export const NAME_PICKS: { id: string; note: string }[] = [
  { id: 'btn-text', note: 'Текст кнопки.' },
  { id: 'btn-aria-label', note: '`aria-label` перекрыл видимый «×».' },
  { id: 'btn-labelledby', note: 'Два узла — через пробел.' },
  { id: 'labelledby-beats-label', note: 'Ссылка сильнее и атрибута, и текста.' },
  { id: 'labelledby-missing', note: 'Нет такого `id` — молча шаг дальше.' },
  { id: 'labelledby-hidden-ref', note: 'Скрытый узел по ссылке звучит.' },
  { id: 'btn-hidden-child', note: 'А скрытый ребёнок — нет.' },
  { id: 'btn-svg-hidden', note: 'Иконка без подписи — кнопка без имени.' },
  { id: 'btn-svg-title', note: '`title` спас — последним шагом.' },
  { id: 'btn-space-label', note: '`aria-label` из пробелов не считается.' },
  { id: 'btn-inline-parts', note: 'Строчные куски — слитно.' },
  { id: 'btn-block-parts', note: 'Блочные — через пробел.' },
  { id: 'input-label-wrap', note: 'Подпись-обёртка.' },
  { id: 'input-two-labels', note: 'Две подписи — обе.' },
  { id: 'input-label-and-aria', note: '`aria-label` сильнее `<label>`.' },
  { id: 'input-title-placeholder', note: '`title` раньше `placeholder`.' },
  { id: 'input-placeholder', note: 'Только `placeholder` — тоже имя.' },
  { id: 'img-no-alt', note: 'Без `alt` картинка — безымянная `img`.' },
  { id: 'span-title', note: '`generic` не берёт `title`…' },
  { id: 'div-aria-label', note: '…а `aria-label` Chromium ему даёт.' },
];

export const NAME_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: '`aria-label` заглушает видимый текст',
    d: 'Кнопка «×» с `aria-label="Закрыть"` звучит как «Закрыть». Это хорошо для скринридера, но человек, который управляет голосом, скажет «нажми крестик» — и ничего не произойдёт. Правило WCAG 2.5.3: видимая подпись должна входить в имя. «Каталог» с именем «Каталог товаров» — можно; «Купить» с именем «Оформить» — нельзя.',
    tone: 'warn',
  },
  {
    t: 'Неверный `id` в `aria-labelledby` молчит',
    d: 'Ссылка на несуществующий `id` пропускается без ошибки, и имя берётся следующим шагом. Переименовали `id` при рефакторинге — кнопка тихо перешла с «Удалить заказ 42» на «×».',
    tone: 'err',
  },
  {
    t: 'Текст из CSS попадает в имя',
    d: 'Кнопка с `.ic::before { content: "★ " }` в Chromium называется «★ В избранное»: сгенерированный текст — часть содержимого. Учебная функция CSS-содержимое не читает и даёт «В избранное» — это единственное её расхождение с Chromium на стенде. Иконку из шрифта через `::before` скринридер прочитает символом, часто бессмысленным.',
    tone: 'warn',
  },
  {
    t: '`generic` с `aria-label`',
    d: 'ARIA 1.2 запрещает давать имя роли `generic`, а Chromium 153 всё равно выставил `div` с `aria-label` имя «Подсказка». Playwright в `ariaSnapshot` то же самое имя не показал. Скринридеры читают такое по-разному — подпись на безролевой обёртке ненадёжна.',
  },
];

/** Shadow DOM: три поля в открытых теневых корнях, CDP `getFullAXTree`. Сверяется тестом. */
export const SHADOW_ROWS: { k: string; name: string; tone: 'ok' | 'err' }[] = [
  { k: '`<label for="inner">` снаружи, `<input id="inner">` в теневом дереве', name: '`""`', tone: 'err' },
  { k: '`<input aria-labelledby="outer-hint">` в теневом дереве, подсказка снаружи', name: '`""`', tone: 'err' },
  { k: '`<label for="i3">` и `<input id="i3">` в одном теневом дереве', name: '«Имя внутри»', tone: 'ok' },
];

export const SHADOW_NOTE =
  'Поэтому в `NAME_CODE` `id` ищутся через `el.getRootNode()`, а не в документе. Компонент, которому нужна подпись снаружи, получает её атрибутом и кладёт внутрь — `aria-label` на внутреннее поле — или держит и поле, и подпись в одном теневом дереве.';

// ─── Раздел 5. div с onclick ───────────────────────────────────────────────────────────────

export const KEYS_HTML = `<button onclick="hit('button')">button</button>
<div onclick="hit('div')">div onclick</div>
<div role="button" tabindex="0" onclick="hit('role')">div role=button tabindex=0</div>
<a href="#top" onclick="hit('a'); return false">a href</a>
<input type="checkbox" onclick="hit('checkbox')">`;

/** Стенд: `el.focus()`, потом Enter или пробел; что вызвал `onclick`. */
export const KEY_ROWS: { k: string; tab: string; enter: string; space: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`<button>`', tab: 'да', enter: 'клик', space: 'клик', tone: 'ok' },
  { k: '`<div onclick>`', tab: 'нет', enter: '`focus()` не сработал — клавиша ушла кнопке, на которой стоял фокус', space: 'то же', tone: 'err' },
  { k: '`<div role="button" tabindex="0">`', tab: 'да', enter: 'ничего', space: 'ничего', tone: 'warn' },
  { k: '`<a href>`', tab: 'да', enter: 'клик', space: 'ничего' },
  { k: '`<input type="checkbox">`', tab: 'да', enter: 'ничего', space: 'клик и галочка' },
];

export const PLAIN_ARIA =
  'ARIA — табличка, а не ремонт. Повесить на кладовку табличку «лифт» можно за секунду, и слепой посетитель честно услышит «лифт». Только кнопок вызова там нет, и ехать некуда.';

export const BUTTON_GIVES: { t: string; d: string }[] = [
  { t: 'Роль и имя', d: '`button` в дереве, имя — из текста.' },
  { t: 'Фокус', d: 'Место в порядке Tab без всякого `tabindex`.' },
  { t: 'Enter и пробел', d: 'Enter нажимает на `keydown`, пробел — на `keyup`: на стенде после нажатия пробела вызовов 0, после отпускания — 1.' },
  { t: '`disabled`', d: 'Выключенная кнопка уходит из порядка Tab и получает в дереве состояние `disabled`.' },
  { t: 'Форма', d: 'Внутри `<form>` кнопка отправляет её, если не сказано `type="button"`.' },
];

export const DIY_BUTTON_CODE = `// Что придётся написать, чтобы div стал кнопкой хотя бы для клавиатуры
const el = document.querySelector('.buy');
el.setAttribute('role', 'button');      // роль — для дерева
el.tabIndex = 0;                         // фокус — для Tab
el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') el.click();     // Enter нажимает сразу
  if (e.key === ' ') e.preventDefault(); // иначе пробел прокрутит страницу
});
el.addEventListener('keyup', (e) => {
  if (e.key === ' ') el.click();         // пробел — на отпускании
});
// И всё ещё нет disabled и отправки формы. Проще: <button type="button">.`;

export const DIY_NOTE =
  'Тест темы исполняет этот код в happy-dom: после него Enter и отпущенный пробел вызывают `click` у `div`. Но это ровно та половина, которую `<button>` даёт даром, и её легко сделать неточно — например, нажимать на пробеле при `keydown`, как Enter, или забыть `preventDefault`.';

// ─── Раздел 6. Фокус и порядок Tab ─────────────────────────────────────────────────────────

export const FOCUS_CODE = `// tabindex элемента: число — фокусируется, null — не фокусируется вовсе.
function tabIndexOf(el) {
  const native = ['button', 'input', 'select', 'textarea'].includes(el.localName);
  if (native && el.hasAttribute('disabled')) return null;   // выключенное поле — никак
  const raw = el.getAttribute('tabindex');
  if (raw !== null && /^\\s*[-+]?\\d+\\s*$/.test(raw)) return parseInt(raw, 10);
  if (native || (el.localName === 'a' && el.hasAttribute('href'))) return 0;
  return null;                                  // div, span, a без href
}

const focusable = (el) => tabIndexOf(el) !== null && !unreachable(el);

// Порядок Tab: сначала положительные tabindex по возрастанию,
// потом все с нулём (и родные) — в порядке документа. -1 — мимо.
function tabOrder(root) {
  const all = [...root.querySelectorAll('*')].filter((el) => focusable(el) && tabIndexOf(el) >= 0);
  const positive = all.filter((el) => tabIndexOf(el) > 0)
    .sort((a, b) => tabIndexOf(a) - tabIndexOf(b));   // sort устойчив: равные — по документу
  return [...positive, ...all.filter((el) => tabIndexOf(el) === 0)];
}`;

export const TABINDEX_ROWS: { k: string; what: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'нет атрибута', what: 'Фокус только у родных: `a[href]`, `button`, `input`, `select`, `textarea` — если не `disabled`. `div` и `span` фокус не получают.' },
  { k: '`tabindex="0"`', what: 'Элемент встаёт в порядок Tab на своё место в документе.', tone: 'ok' },
  { k: '`tabindex="-1"`', what: 'Фокус можно поставить из кода (`el.focus()`), Tab элемент пропускает. Так делают заголовок, на который переводят фокус после перехода, и строки списка, по которым ходят стрелками.', tone: 'ok' },
  { k: '`tabindex="1"` и больше', what: 'Элемент уходит в начало порядка, раньше всего остального на странице, по возрастанию числа. Почти всегда ошибка: порядок перестаёт совпадать с тем, что видно и что читает скринридер.', tone: 'err' },
];

export const TAB_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Порядок Tab — порядок разметки',
    d: 'В контейнере с `flex-direction: row-reverse` кнопка «Один» нарисована правее всех, но Tab на стенде прошёл «Один», «Два», «Три» — по документу. `order`, `grid-area` и `position` двигают пиксели, а не дерево: фокус прыгает по экрану, а скринридер читает в порядке DOM.',
    tone: 'warn',
  },
  {
    t: 'Положительный `tabindex` ломает всю страницу',
    d: 'В сцене «Порядок Tab» ссылка «Помощь» с `tabindex="1"` и поле с `tabindex="2"` получили фокус раньше кнопки, стоящей первой. На настоящей странице так же: два положительных `tabindex` в подвале — и первый Tab уводит человека в подвал.',
    tone: 'err',
  },
  {
    t: 'Фокус умирает вместе с узлом',
    d: 'Удалили элемент с фокусом — `document.activeElement` стал `body`. Chromium помнит место, и следующий Tab на стенде попал на кнопку, стоявшую сразу за удалённой. Но до этого нажатия фокус не стоит ни на чём, и скринридеру нечего назвать. Перерисовка списка, закрытие диалога, замена кнопки на спиннер — каждое такое место должно само вернуть фокус туда, где человек был.',
  },
];

// ─── Раздел 7. Живые регионы ───────────────────────────────────────────────────────────────

export const PLAIN_LIVE =
  'Скринридер читает то, куда человек пришёл. Изменение в другом конце страницы он не заметит, как не заметит человек, который смотрит в другую сторону. Живой регион — договорённость «если здесь что-то поменяется, скажи мне, даже если я не смотрю».';

/** Свойства из CDP (стенд): у `status` и `output` — `live: polite`, `atomic: true`; у `alert` — `assertive`. */
export const LIVE_ROWS: { k: string; live: string; what: string }[] = [
  { k: '`aria-live="polite"`', live: 'polite', what: 'Объявит, когда скринридер договорит текущее. Для «Сохранено», «Товар в корзине», числа результатов поиска.' },
  { k: '`role="status"`, `<output>`', live: 'polite', what: 'То же, и `atomic: true`: при изменении читается весь регион, а не только изменившийся кусок.' },
  { k: '`aria-live="assertive"`, `role="alert"`', live: 'assertive', what: 'Перебивает то, что читается сейчас. Только для срочного: ошибка, после которой нельзя продолжать.' },
  { k: '`aria-live="off"` (по умолчанию)', live: '—', what: 'Изменения не объявляются, пока человек сам не придёт к узлу.' },
];

export const LIVE_CODE = `// Регион стоит в разметке с первой отрисовки — пустой:
// <div id="cart-status" role="status"></div>
const status = document.getElementById('cart-status');

function announce(text) {
  status.textContent = text;   // меняется содержимое уже известного региона
}

// Так часто не объявится: регион и текст появляются одним изменением,
// и скринридер узнаёт о регионе, когда менять в нём уже нечего.
function announceTooLate(text) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
}`;

export const LIVE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Регион должен быть раньше текста',
    d: 'Скринридер следит за регионами, которые уже есть в дереве, и объявляет **изменения** в них. Регион, вставленный вместе с текстом, для него новый узел, а не изменение. Отсюда приём: пустой регион в разметке с самого начала, текст — потом.',
    tone: 'err',
  },
  {
    t: 'Тот же текст ещё раз может не прозвучать',
    d: 'Записали «Товар в корзине» второй раз подряд — содержимое не изменилось, объявлять нечего. Обычно регион сначала очищают, а новый текст записывают в следующей задаче.',
    tone: 'warn',
  },
  {
    t: 'Регион в скрытом контейнере молчит',
    d: 'Регион внутри `display: none` или `aria-hidden` в дереве отсутствует — следить не за чем. Невидимый, но звучащий регион прячут тем же приёмом «только для скринридера».',
  },
];

// ─── Раздел 8. Кто ещё считает дерево ──────────────────────────────────────────────────────

/** Chromium (CDP) против Playwright (`ariaSnapshot`) и спецификации на фикстурах `CASES`. */
export const DIVERGE_ROWS: { k: string; chrome: string; pw: string; spec: string }[] = [
  { k: '`<figure>` с `<figcaption>`', chrome: '`figure`, имя пустое', pw: '`figure "Продажи за год"`', spec: 'HTML-AAM: имя из `figcaption`' },
  { k: '`<button>` внутри `inert`', chrome: 'нет в дереве', pw: '`button "Купить"`', spec: 'HTML: инертное недоступно технологиям доступа' },
  { k: '`<div aria-label="Подсказка">`', chrome: '`generic "Подсказка"`', pw: 'только текст', spec: 'ARIA 1.2: имя у `generic` запрещено' },
  { k: '`<header>` внутри `<article>`', chrome: '`sectionheader`', pw: 'узла нет', spec: 'HTML-AAM: не `banner`, а `generic`; `sectionheader` — роль из черновика ARIA 1.3' },
];

export const DIVERGE_NOTE =
  'Дерево доступности — не стандартный объект с одним ответом. Его считает каждый браузер, и каждый инструмент проверки считает его заново по-своему. `getByRole` в Playwright и `ariaSnapshot` проверяют вычисление Playwright, а не браузера; совпадает оно почти всегда, но на границах — как здесь — нет.';

/** axe-core 4.13.0 на сценах демо (правила уровня страницы отброшены). Тест повторяет в happy-dom. */
export const AXE_SCENES: Record<string, string[]> = {
  card: [],
  form: [],
  hidden: ['aria-hidden-focus'],
  roles: ['aria-allowed-role', 'aria-roles', 'presentation-role-conflict'],
  tab: ['tabindex'],
};

export const AXE_RULES = ['aria-roles', 'aria-hidden-focus', 'tabindex', 'aria-allowed-role', 'presentation-role-conflict', 'button-name', 'link-name', 'image-alt', 'label'];

export const AXE_ROWS: { k: string; found: string; tone: 'ok' | 'warn' | 'err' }[] = [
  { k: 'Карточка', found: 'ничего. `div` с `onclick`, до которого не дойти с клавиатуры, axe не видит: обработчики событий из DOM не прочитать.', tone: 'err' },
  { k: 'Форма', found: 'ничего — у всех полей есть имена, пусть одно и из `placeholder`.', tone: 'warn' },
  { k: 'Спрятано', found: '`aria-hidden-focus` — кнопка с `aria-hidden`, на которую попадает Tab.', tone: 'ok' },
  { k: 'Роли', found: '`aria-roles` (опечатка `buton`), `aria-allowed-role` и `presentation-role-conflict` (кнопке не снять роль).', tone: 'ok' },
  { k: 'Порядок Tab', found: '`tabindex` — два положительных значения.', tone: 'ok' },
];

export const AXE_NOTE =
  'Автоматическая проверка ловит то, что видно в разметке: неизвестную роль, поле без имени, положительный `tabindex`. Она не знает, что `div` кликается, что `placeholder` исчезнет при вводе и что «×» стоило назвать «Закрыть заказ», а не «Закрыть». Это проверяют руками: пройти страницу Tab без мыши и послушать её скринридером.';

// ─── Сцены демо ────────────────────────────────────────────────────────────────────────────

/** Разметка сцен. Её же вставляет в скрытый iframe демо, её же снимал стенд. */
export const SCENE_HTML = {
  card: `<article>
  <h2>Кофемолка «Утро»</h2>
  <img alt="Ручная кофемолка, вид сбоку">
  <p>Керамические жернова, 12 степеней помола.</p>
  <button aria-label="В избранное">
    <svg aria-hidden="true" width="16" height="16"><path d="M8 14 2 8a3 3 0 0 1 6-4 3 3 0 0 1 6 4z"/></svg>
  </button>
  <div class="buy" onclick="buy()">Купить</div>
  <a href="/delivery">Условия доставки</a>
</article>`,
  form: `<form aria-label="Оформление заказа">
  <label for="name">Имя</label>
  <input id="name">
  <input type="tel" placeholder="Телефон">
  <span id="code-hint">Код придёт в SMS</span>
  <input aria-labelledby="code-hint" inputmode="numeric">
  <fieldset>
    <legend>Доставка</legend>
    <label><input type="checkbox" checked> Курьером</label>
  </fieldset>
  <button type="submit">Оформить</button>
</form>`,
  hidden: `<button>Видна всем</button>
<button style="display: none">display: none</button>
<button style="visibility: hidden">visibility: hidden</button>
<button hidden>атрибут hidden</button>
<button aria-hidden="true">aria-hidden</button>
<div inert><button>внутри inert</button></div>
<button style="opacity: 0">opacity: 0</button>
<button style="position: absolute; width: 1px; height: 1px;
  overflow: hidden; clip-path: inset(50%)">Только для скринридера</button>`,
  roles: `<header><a href="/">Магазин</a></header>
<nav aria-label="Каталог">
  <ul>
    <li><a href="/coffee">Кофе</a></li>
    <li><a>Чай</a></li>
  </ul>
</nav>
<main>
  <h1>Кофе</h1>
  <section><h2>Новинки</h2></section>
  <section aria-label="Отзывы"><p>«Мелет ровно»</p></section>
  <div role="buton">Опечатка в роли</div>
  <button role="presentation">Купить</button>
</main>
<footer>© 2026</footer>`,
  tab: `<button>Первая в разметке</button>
<input aria-label="Поиск" tabindex="2">
<a href="/help" tabindex="1">Помощь</a>
<div tabindex="0">Карточка, tabindex="0"</div>
<div tabindex="-1">Только из кода, tabindex="-1"</div>
<div onclick="openCard()">div с onclick</div>
<button disabled>Выключена</button>
<a>Ссылка без href</a>
<a href="/last">Последняя ссылка</a>`,
};

/** Chromium 153 на стенде: строка на каждый элемент сцены и порядок Tab (см. шапку). */
const SCENE_STAND = {
  card: { elements: ['article|', 'heading|Кофемолка «Утро»', 'img|Ручная кофемолка, вид сбоку', 'paragraph|', 'button|В избранное', '-', '-', '~', 'link|Условия доставки'], tabs: [4, 8] },
  form: { elements: ['form|Оформление заказа', '~', 'textbox|Имя', 'textbox|Телефон', '~', 'textbox|Код придёт в SMS', 'group|Доставка', '~', '~', 'checkbox|Курьером', 'button|Оформить'], tabs: [2, 3, 5, 9, 10] },
  hidden: { elements: ['button|Видна всем', '-', '-', '-', '-', '-', '-', 'button|opacity: 0', 'button|Только для скринридера'], tabs: [0, 4, 7, 8] },
  roles: { elements: ['banner|', 'link|Магазин', 'navigation|Каталог', 'list|', 'listitem|', 'link|Кофе', 'listitem|', '~', 'main|', 'heading|Кофе', '~', 'heading|Новинки', 'region|Отзывы', 'paragraph|', '~', 'button|Купить', 'contentinfo|'], tabs: [1, 5, 15] },
  tab: { elements: ['button|Первая в разметке', 'textbox|Поиск', 'link|Помощь', '~', '~', '~', 'button|Выключена', '~', 'link|Последняя ссылка'], tabs: [2, 1, 0, 3, 8] },
};

export const SCENES: AxScene[] = [
  {
    id: 'card',
    label: 'Карточка',
    html: SCENE_HTML.card,
    note: 'Карточка товара, как её часто верстают. Сердечко — кнопка с `aria-label`, а «Купить» — `div` с обработчиком клика: на экране они одинаково кликаются, в дереве — нет.',
    ...SCENE_STAND.card,
  },
  {
    id: 'form',
    label: 'Форма',
    html: SCENE_HTML.form,
    note: 'Четыре способа дать полю имя: `<label for>`, `placeholder`, `aria-labelledby` на подсказку и подпись-обёртка у флажка. Группа получает имя из `<legend>`.',
    ...SCENE_STAND.form,
  },
  {
    id: 'hidden',
    label: 'Спрятано',
    html: SCENE_HTML.hidden,
    note: 'Восемь кнопок, спрятанных по-разному. Сравните дерево с порядком Tab: одна кнопка в дереве отсутствует, а фокус на неё попадает.',
    ...SCENE_STAND.hidden,
  },
  {
    id: 'roles',
    label: 'Роли',
    html: SCENE_HTML.roles,
    note: 'Ориентиры из тегов: `header`, `nav`, `main`, `footer`. Безымянная `section` и `<a>` без `href` растворяются, опечатка в `role` молча не срабатывает, а кнопке роль не снять.',
    ...SCENE_STAND.roles,
  },
  {
    id: 'tab',
    label: 'Порядок Tab',
    html: SCENE_HTML.tab,
    note: 'Положительные `tabindex` уводят фокус в начало, `-1` и `div` без атрибута Tab пропускает, выключенная кнопка и ссылка без `href` не фокусируются вовсе.',
    ...SCENE_STAND.tab,
  },
];

// ─── Фикстуры стенда ───────────────────────────────────────────────────────────────────────

/** 88 фикстур: разметка и ответ Chromium 153 через CDP (см. шапку). */
export const CASES: AxCase[] = [
  { id: 'btn-text', html: '<button data-k>Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'btn-aria-label', html: '<button data-k aria-label="Закрыть">×</button>', chrome: { role: 'button', name: 'Закрыть', from: 'aria-label', focusable: true } },
  { id: 'btn-labelledby', html: '<span id="a1">Удалить</span><span id="a2">заказ 42</span><button data-k aria-labelledby="a1 a2">×</button>', chrome: { role: 'button', name: 'Удалить заказ 42', from: 'aria-labelledby', focusable: true } },
  { id: 'labelledby-beats-label', html: '<span id="b1">Из подписи</span><button data-k aria-labelledby="b1" aria-label="Из атрибута">Из текста</button>', chrome: { role: 'button', name: 'Из подписи', from: 'aria-labelledby', focusable: true } },
  { id: 'labelledby-hidden-ref', html: '<span id="c1" hidden>Скрытая подпись</span><button data-k aria-labelledby="c1">Текст</button>', chrome: { role: 'button', name: 'Скрытая подпись', from: 'aria-labelledby', focusable: true } },
  { id: 'labelledby-missing', html: '<button data-k aria-labelledby="nope" aria-label="Запасное">Текст</button>', chrome: { role: 'button', name: 'Запасное', from: 'aria-label', focusable: true } },
  { id: 'labelledby-self', html: '<button id="d1" data-k aria-labelledby="d1 d2">Удалить</button><span id="d2">файл</span>', chrome: { role: 'button', name: 'Удалить файл', from: 'aria-labelledby', focusable: true } },
  { id: 'btn-img-alt', html: '<button data-k><img src="cart.svg" alt="Корзина"></button>', chrome: { role: 'button', name: 'Корзина', from: 'content', focusable: true } },
  { id: 'btn-svg-hidden', html: '<button data-k><svg aria-hidden="true" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg></button>', chrome: { role: 'button', name: '', from: '', focusable: true } },
  { id: 'btn-svg-title', html: '<button data-k title="Поиск"><svg aria-hidden="true" width="10" height="10"><circle cx="5" cy="5" r="4"/></svg></button>', chrome: { role: 'button', name: 'Поиск', from: 'title', focusable: true } },
  { id: 'btn-hidden-child', html: '<button data-k>Сохранить <span hidden>черновик</span></button>', chrome: { role: 'button', name: 'Сохранить', from: 'content', focusable: true } },
  { id: 'btn-vis-hidden-child', html: '<button data-k>Сохранить <span style="visibility:hidden">черновик</span></button>', chrome: { role: 'button', name: 'Сохранить', from: 'content', focusable: true } },
  { id: 'btn-aria-hidden-child', html: '<button data-k>Сохранить <span aria-hidden="true">💾</span></button>', chrome: { role: 'button', name: 'Сохранить', from: 'content', focusable: true } },
  { id: 'btn-inline-parts', html: '<button data-k>Ска<b>чать</b> файл</button>', chrome: { role: 'button', name: 'Скачать файл', from: 'content', focusable: true } },
  { id: 'btn-block-parts', html: '<button data-k><div>Скачать</div><div>файл</div></button>', chrome: { role: 'button', name: 'Скачать файл', from: 'content', focusable: true } },
  { id: 'btn-empty-label', html: '<button data-k aria-label="">Текст</button>', chrome: { role: 'button', name: 'Текст', from: 'content', focusable: true } },
  { id: 'btn-space-label', html: '<button data-k aria-label="   ">Текст</button>', chrome: { role: 'button', name: 'Текст', from: 'content', focusable: true } },
  { id: 'btn-whitespace', html: '<button data-k>\n   Много    пробелов \n</button>', chrome: { role: 'button', name: 'Много пробелов', from: 'content', focusable: true } },
  { id: 'btn-before', html: '<style>.ic::before{content:"★ "}</style><button data-k class="ic">В избранное</button>', chrome: { role: 'button', name: '★ В избранное', from: 'content', focusable: true } },
  { id: 'input-label-for', html: '<label for="e1">Почта</label><input data-k id="e1" type="email">', chrome: { role: 'textbox', name: 'Почта', from: 'label', focusable: true } },
  { id: 'input-label-wrap', html: '<label>Имя <input data-k></label>', chrome: { role: 'textbox', name: 'Имя', from: 'label', focusable: true } },
  { id: 'input-placeholder', html: '<input data-k placeholder="Поиск по каталогу">', chrome: { role: 'textbox', name: 'Поиск по каталогу', from: 'placeholder', focusable: true } },
  { id: 'input-title', html: '<input data-k title="Город">', chrome: { role: 'textbox', name: 'Город', from: 'title', focusable: true } },
  { id: 'input-title-placeholder', html: '<input data-k title="Город" placeholder="Москва">', chrome: { role: 'textbox', name: 'Город', from: 'title', focusable: true } },
  { id: 'input-label-and-aria', html: '<label for="e2">Цена</label><input data-k id="e2" aria-label="Сумма заказа">', chrome: { role: 'textbox', name: 'Сумма заказа', from: 'aria-label', focusable: true } },
  { id: 'input-two-labels', html: '<label for="e3">Телефон</label><input data-k id="e3"><label for="e3">(мобильный)</label>', chrome: { role: 'textbox', name: 'Телефон (мобильный)', from: 'label', focusable: true } },
  { id: 'input-nothing', html: '<input data-k>', chrome: { role: 'textbox', name: '', from: '', focusable: true } },
  { id: 'checkbox-label', html: '<input data-k type="checkbox" id="e4"><label for="e4">Согласен с условиями</label>', chrome: { role: 'checkbox', name: 'Согласен с условиями', from: 'label', states: {checked: 'false'}, focusable: true } },
  { id: 'submit-value', html: '<input data-k type="submit" value="Отправить">', chrome: { role: 'button', name: 'Отправить', from: 'value', focusable: true } },
  { id: 'textarea-label', html: '<label for="e5">Комментарий</label><textarea data-k id="e5"></textarea>', chrome: { role: 'textbox', name: 'Комментарий', from: 'label', focusable: true } },
  { id: 'select-label', html: '<label for="e6">Страна</label><select data-k id="e6"><option>Россия</option><option>Казахстан</option></select>', chrome: { role: 'combobox', name: 'Страна', from: 'label', states: {expanded: 'false'}, focusable: true } },
  { id: 'img-alt', html: '<img data-k src="logo.svg" alt="Логотип магазина">', chrome: { role: 'img', name: 'Логотип магазина', from: 'alt', focusable: false } },
  { id: 'img-empty-alt', html: '<img data-k src="divider.svg" alt="">', chrome: { role: 'none', name: '', from: '', focusable: false } },
  { id: 'img-no-alt', html: '<img data-k src="photo.jpg">', chrome: { role: 'img', name: '', from: '', focusable: false } },
  { id: 'img-title', html: '<img data-k src="map.png" title="Схема проезда">', chrome: { role: 'img', name: 'Схема проезда', from: 'title', focusable: false } },
  { id: 'a-href', html: '<a data-k href="/catalog">Каталог</a>', chrome: { role: 'link', name: 'Каталог', from: 'content', focusable: true } },
  { id: 'a-no-href', html: '<a data-k>Каталог</a>', chrome: { role: 'generic', name: '', from: '', focusable: false } },
  { id: 'a-img', html: '<a data-k href="/"><img src="logo.svg" alt="На главную"></a>', chrome: { role: 'link', name: 'На главную', from: 'content', focusable: true } },
  { id: 'a-aria-label', html: '<a data-k href="/catalog" aria-label="Каталог товаров">Каталог</a>', chrome: { role: 'link', name: 'Каталог товаров', from: 'aria-label', focusable: true } },
  { id: 'div-onclick', html: '<div data-k onclick="void 0">Купить</div>', chrome: { role: 'generic', name: '', from: '', focusable: false } },
  { id: 'div-role-button', html: '<div data-k role="button" tabindex="0">Купить</div>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'div-role-typo', html: '<div data-k role="buton">Купить</div>', chrome: { role: 'generic', name: '', from: '', focusable: false } },
  { id: 'div-role-list', html: '<div data-k role="foo button">Купить</div>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: false } },
  { id: 'div-aria-label', html: '<div data-k aria-label="Подсказка">Текст</div>', chrome: { role: 'generic', name: 'Подсказка', from: 'aria-label', focusable: false } },
  { id: 'span-title', html: '<span data-k title="Подсказка">Текст</span>', chrome: { role: 'generic', name: '', from: '', focusable: false } },
  { id: 'nav-label', html: '<nav data-k aria-label="Главное меню"><a href="/">Главная</a></nav>', chrome: { role: 'navigation', name: 'Главное меню', from: 'aria-label', focusable: false } },
  { id: 'nav-plain', html: '<nav data-k><a href="/">Главная</a></nav>', chrome: { role: 'navigation', name: '', from: '', focusable: false } },
  { id: 'main', html: '<main data-k><p>Текст</p></main>', chrome: { role: 'main', name: '', from: '', focusable: false } },
  { id: 'h2', html: '<h2 data-k>Заказы</h2>', chrome: { role: 'heading', name: 'Заказы', from: 'content', states: {level: 2}, focusable: false } },
  { id: 'h2-nested', html: '<h2 data-k>Заказы <small>(3)</small></h2>', chrome: { role: 'heading', name: 'Заказы (3)', from: 'content', states: {level: 2}, focusable: false } },
  { id: 'div-heading', html: '<div data-k role="heading" aria-level="3">Доставка</div>', chrome: { role: 'heading', name: 'Доставка', from: 'content', states: {level: 3}, focusable: false } },
  { id: 'p', html: '<p data-k>Абзац текста</p>', chrome: { role: 'paragraph', name: '', from: '', focusable: false } },
  { id: 'section-named', html: '<section data-k aria-label="Отзывы"><p>…</p></section>', chrome: { role: 'region', name: 'Отзывы', from: 'aria-label', focusable: false } },
  { id: 'section-plain', html: '<section data-k><p>…</p></section>', chrome: { role: 'generic', name: '', from: '', focusable: false } },
  { id: 'header-top', html: '<header data-k><p>Шапка</p></header>', chrome: { role: 'banner', name: '', from: '', focusable: false } },
  { id: 'header-in-article', html: '<article><header data-k><p>Шапка статьи</p></header></article>', chrome: { role: 'sectionheader', name: '', from: '', focusable: false } },
  { id: 'footer-top', html: '<footer data-k><p>Подвал</p></footer>', chrome: { role: 'contentinfo', name: '', from: '', focusable: false } },
  { id: 'article', html: '<article data-k><p>Статья</p></article>', chrome: { role: 'article', name: '', from: '', focusable: false } },
  { id: 'aside', html: '<aside data-k><p>Сбоку</p></aside>', chrome: { role: 'complementary', name: '', from: '', focusable: false } },
  { id: 'form-plain', html: '<form data-k><input></form>', chrome: { role: 'form', name: '', from: '', focusable: false } },
  { id: 'form-named', html: '<form data-k aria-label="Вход"><input></form>', chrome: { role: 'form', name: 'Вход', from: 'aria-label', focusable: false } },
  { id: 'ul', html: '<ul data-k><li>Раз</li><li>Два</li></ul>', chrome: { role: 'list', name: '', from: '', focusable: false } },
  { id: 'ul-nostyle', html: '<ul data-k style="list-style:none"><li>Раз</li></ul>', chrome: { role: 'list', name: '', from: '', focusable: false } },
  { id: 'li', html: '<ul><li data-k>Раз</li></ul>', chrome: { role: 'listitem', name: '', from: '', focusable: false } },
  { id: 'fieldset-legend', html: '<fieldset data-k><legend>Доставка</legend><input></fieldset>', chrome: { role: 'group', name: 'Доставка', from: 'legend', focusable: false } },
  { id: 'table-caption', html: '<table data-k><caption>Цены</caption><tr><td>1</td></tr></table>', chrome: { role: 'table', name: 'Цены', from: 'caption', focusable: false } },
  { id: 'figure', html: '<figure data-k><img src="chart.png" alt="График"><figcaption>Продажи за год</figcaption></figure>', chrome: { role: 'figure', name: '', from: '', focusable: false } },
  { id: 'img-no-src', html: '<img data-k alt="Кофемолка">', chrome: { role: 'img', name: 'Кофемолка', from: 'alt', focusable: false } },
  { id: 'btn-presentation', html: '<button data-k role="presentation">Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'span-presentation', html: '<span data-k role="presentation">Текст</span>', chrome: { role: 'none', name: '', from: '', focusable: false } },
  { id: 'btn-aria-hidden', html: '<button data-k aria-hidden="true">Купить</button>', chrome: { hidden: true } },
  { id: 'btn-in-aria-hidden', html: '<div aria-hidden="true"><button data-k>Купить</button></div>', chrome: { hidden: true } },
  { id: 'btn-display-none', html: '<button data-k style="display:none">Купить</button>', chrome: { hidden: true } },
  { id: 'btn-visibility', html: '<button data-k style="visibility:hidden">Купить</button>', chrome: { hidden: true } },
  { id: 'btn-hidden-attr', html: '<button data-k hidden>Купить</button>', chrome: { hidden: true } },
  { id: 'btn-in-inert', html: '<div inert><button data-k>Купить</button></div>', chrome: { hidden: true } },
  { id: 'btn-opacity', html: '<button data-k style="opacity:0">Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'btn-offscreen', html: '<button data-k style="position:absolute;left:-9999px">Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'btn-clip', html: '<button data-k style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', focusable: true } },
  { id: 'btn-disabled', html: '<button data-k disabled>Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', states: {disabled: true}, focusable: false } },
  { id: 'btn-aria-disabled', html: '<button data-k aria-disabled="true">Купить</button>', chrome: { role: 'button', name: 'Купить', from: 'content', states: {disabled: true}, focusable: true } },
  { id: 'btn-pressed', html: '<button data-k aria-pressed="true">Жирный</button>', chrome: { role: 'button', name: 'Жирный', from: 'content', states: {pressed: 'true'}, focusable: true } },
  { id: 'btn-expanded', html: '<button data-k aria-expanded="false">Меню</button>', chrome: { role: 'button', name: 'Меню', from: 'content', states: {expanded: 'false'}, focusable: true } },
  { id: 'checkbox-checked', html: '<input data-k type="checkbox" checked aria-label="Запомнить">', chrome: { role: 'checkbox', name: 'Запомнить', from: 'aria-label', states: {checked: 'true'}, focusable: true } },
  { id: 'status', html: '<div data-k role="status">Сохранено</div>', chrome: { role: 'status', name: '', from: '', states: {live: 'polite'}, focusable: false } },
  { id: 'alert', html: '<div data-k role="alert">Ошибка</div>', chrome: { role: 'alert', name: '', from: '', states: {live: 'assertive'}, focusable: false } },
  { id: 'live-polite', html: '<div data-k aria-live="polite">Сохранено</div>', chrome: { role: 'generic', name: '', from: '', states: {live: 'polite'}, focusable: false } },
  { id: 'output', html: '<output data-k>42</output>', chrome: { role: 'status', name: '', from: '', states: {live: 'polite'}, focusable: false } },
];

const caseById = (id: string): AxCase => {
  const c = CASES.find((x) => x.id === id);
  if (!c) throw new Error(`нет фикстуры ${id}`);
  return c;
};

/** Разметка фикстуры без служебного `data-k`. */
export const caseHtml = (c: AxCase) => c.html.replace(' data-k', '');

const roleCell = (v: ChromeVerdict) => {
  if (v.hidden) return 'нет в дереве';
  const lvl = v.states?.level ? ` · level ${v.states.level}` : '';
  return (v.role === 'generic' || v.role === 'none') && !v.name ? `\`${v.role}\` — растворяется` : `\`${v.role}\`${lvl}`;
};

export const ROLE_ROWS = ROLE_PICKS.map((p) => {
  const c = caseById(p.id);
  return { html: caseHtml(c), role: roleCell(c.chrome), note: p.note };
});

const FROM_LABEL: Record<string, string> = {
  'aria-labelledby': '2B · `aria-labelledby`',
  'aria-label': '2C · `aria-label`',
  label: '2D · `<label>`',
  alt: '2D · `alt`',
  legend: '2D · `<legend>`',
  caption: '2D · `<caption>`',
  value: '2D · `value`',
  content: '2F · содержимое',
  title: '2I · `title`',
  placeholder: '`placeholder`',
  '': '—',
};

export const NAME_ROWS = NAME_PICKS.map((p) => {
  const c = caseById(p.id);
  const v = c.chrome;
  const name = v.hidden ? '—' : v.name ? `«${v.name}»` : 'пусто';
  return { html: caseHtml(c), name, from: v.hidden ? '—' : FROM_LABEL[v.from], note: p.note };
});

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`<div onclick>` выглядит как кнопка и не является ею',
    d: 'Нет роли, нет фокуса, Enter и пробел ничего не делают. На стенде `focus()` по такому `div` не сработал, и Enter ушёл элементу, на котором фокус стоял раньше. → `<button type="button">`.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`role="button"` не добавляет поведения',
    d: 'С ролью и `tabindex="0"` `div` получил фокус и имя, но Enter и пробел не вызвали `onclick` ни разу. Клавиши, `disabled` и отправку формы придётся писать самому.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`aria-hidden` на фокусируемом элементе',
    d: 'Узла нет в дереве, а Tab на него попадает: человек стоит на «пустоте». Прячут целиком — `hidden` или `inert`; прячут только иконку внутри кнопки — `aria-hidden` на иконке, а не на кнопке.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Неверный `id` в `aria-labelledby` не даёт ошибки',
    d: 'Ссылка в никуда пропускается, имя берётся следующим шагом — часто это «×» или пустота. Проверка — посмотреть имя в панели Accessibility или в `ariaSnapshot`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`aria-label` сильнее видимого текста',
    d: 'Имя из `aria-label` полностью заменяет содержимое. Видимая подпись должна входить в него, иначе голосовое управление «нажми Купить» промахнётся.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`placeholder` вместо `<label>`',
    d: 'Имя у поля будет, и axe промолчит. Но подсказка исчезает, как только начали печатать, и зрячий человек забывает, что это было за поле. `<label>` видна всегда.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Положительный `tabindex`',
    d: 'Элемент с `tabindex="1"` получает фокус раньше всего на странице. Нужно «пораньше» — переставьте элемент в разметке; нужно «из кода» — `tabindex="-1"`.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'CSS переставляет картинку, но не порядок',
    d: '`flex-direction: row-reverse`, `order`, `grid-area` двигают элементы на экране, а Tab и скринридер идут по DOM. На стенде правая кнопка получила фокус первой.',
    tone: 'warn',
  },
  {
    n: '09',
    t: 'Живой регион, вставленный вместе с текстом',
    d: 'Скринридер объявляет изменения в регионах, о которых уже знает. Пустой `role="status"` должен стоять в разметке заранее, текст в него пишут потом.',
    tone: 'err',
  },
  {
    n: '10',
    t: '`<label for>` не видит поле в Shadow DOM',
    d: 'Подпись снаружи и поле внутри теневого дерева на стенде дали пустое имя; то же с `aria-labelledby` через границу. Подпись кладут внутрь компонента.',
    tone: 'warn',
  },
  {
    n: '11',
    t: 'Зелёный axe — не доступная страница',
    d: 'Карточка с некликабельной с клавиатуры кнопкой прошла axe без замечаний. Автоматика ловит ошибки разметки; клавиатуру и звучание проверяют руками.',
    tone: 'warn',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Accessible Name and Description Computation 1.2',
    href: 'https://www.w3.org/TR/accname-1.2/',
    what: 'алгоритм доступного имени, шаги 2A–2I',
  },
  {
    title: 'HTML Accessibility API Mappings (HTML-AAM)',
    href: 'https://www.w3.org/TR/html-aam-1.0/',
    what: 'неявные роли элементов HTML и то, как HTML даёт им имена (`label`, `alt`, `legend`, `caption`, `title`, `placeholder`)',
  },
  {
    title: 'WAI-ARIA 1.2',
    href: 'https://www.w3.org/TR/wai-aria-1.2/',
    what: 'роли, `aria-hidden`, `aria-live`, правило «первое знакомое слово» в `role`, роли, которым имя запрещено',
  },
  {
    title: 'Using ARIA — First rule of ARIA use',
    href: 'https://www.w3.org/TR/using-aria/#rule1',
    what: 'родной элемент вместо `div` с ролью',
  },
  {
    title: 'HTML Standard — The inert attribute',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#the-inert-attribute',
    what: '`inert`: без фокуса, без кликов, без технологий доступа',
  },
  {
    title: 'HTML Standard — Sequential focus navigation',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#sequential-focus-navigation',
    what: 'порядок Tab и значения `tabindex`',
  },
  {
    title: 'MDN — ARIA live regions',
    href: 'https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions',
    what: '`aria-live`, `status`, `alert`; регион должен быть в разметке до изменения',
  },
  {
    title: 'WCAG 2.2 — 2.5.3 Label in Name',
    href: 'https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html',
    what: 'видимая подпись должна входить в доступное имя',
  },
  {
    title: 'Chrome DevTools Protocol — Accessibility domain',
    href: 'https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/',
    what: '`getFullAXTree`, `getPartialAXTree`, источники имени; так снят стенд (Chromium 153)',
  },
  {
    title: 'Playwright — Aria snapshots',
    href: 'https://playwright.dev/docs/aria-snapshots',
    what: '`locator.ariaSnapshot()`, собственное вычисление ролей и имён',
  },
  {
    title: 'axe-core — Rule descriptions',
    href: 'https://github.com/dequelabs/axe-core/blob/develop/doc/rule-descriptions.md',
    what: '`aria-hidden-focus`, `aria-roles`, `tabindex`, `presentation-role-conflict`; версия 4.13.0 на стенде',
  },
];

export const RELATED =
  'Смежное на сайте: [События DOM, раздел «Действие по умолчанию»](/render/dom-events/#s4) — откуда берётся клик по кнопке с клавиатуры. [Длинные списки, раздел «Доступность и поиск»](/render/virtual-lists/#s5) — `aria-setsize`, фокус в виртуальном списке. [Стили веб-компонентов, раздел «Граница»](/render/web-components-styles/#s1) — что не пересекает теневую границу. [Каскад и вычисление стилей, раздел «Наследование»](/render/css-cascade/#s3) — почему `visibility` наследуется, а `display` нет. [Контекст наложения](/render/stacking/) — порядок отрисовки, почему не помогает `z-index: 9999` и верхний слой.';
