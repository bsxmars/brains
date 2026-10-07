/**
 * Таблица «что проходит через границу теневого дерева» — вычисляется, а не набирается.
 *
 * Каждая проверка строит свой маленький хост с теневым корнем, кладёт правило по одну сторону
 * границы и спрашивает `getComputedStyle` по другую. Ответ — то, что сказал движок, в котором
 * модуль исполнен: в браузере читателя его зовёт `ShadowBoundary.vue`, в трёх движках стенда —
 * сборка этого же файла, и стенд сверяет ответы с литералом `BOUNDARY_ROWS` в данных темы.
 *
 * ⚠️ Проверка обязана отличать «не работает» от «не так собрали стенд». Поэтому там, где
 * отрицательный ответ можно получить по ошибке сборки, рядом стоит контроль — то же правило
 * на элементе документа или соседний случай, который обязан сработать. Контроль не прошёл —
 * ответ `null`, а не `false`.
 *
 * ⚠️ Модуль трогает `document` только внутри `runBoundary`: остров рендерится и в Node,
 * а там документа нет. Цвета — только токены темы через `var()`: сравниваются вычисленные
 * значения, а не литералы.
 *
 * Побочный эффект один и неустранимый: `CSS.registerProperty` отменить нельзя. Имя свойства
 * уникально для демо, повторная регистрация ловится.
 */

export type BoundaryResult = Record<string, boolean | null>;

interface Fixture {
  host: HTMLElement;
  root: ShadowRoot;
  wrap: HTMLElement;
  /** Класс хоста — им пользуются правила страницы. */
  cls: string;
}

/** Порядок строк таблицы. Сверяется тестом с ключами `BOUNDARY_ROWS`. */
export const BOUNDARY_KEYS = [
  'inherit-color',
  'inherit-font',
  'custom-prop',
  'registered-noinherit',
  'slot-inherit',
  'outer-selector',
  'query-selector',
  'doc-adopted',
  'part',
  'slotted-top',
  'slotted-deep',
  'host-context',
  'button-font',
  'shadow-font-face',
  'all-initial-font',
  'all-initial-custom-prop',
] as const;

export type BoundaryKey = (typeof BOUNDARY_KEYS)[number];

const OK = 'var(--tone-ok-strong)';
const ERR = 'var(--tone-err-strong)';
const MONO = 'var(--mono)';
const REGISTERED = '--sd-probe-noinherit';

export function runBoundary(doc: Document): BoundaryResult {
  const win = doc.defaultView;
  if (!win) throw new Error('runBoundary: у документа нет окна');

  const sandbox = doc.createElement('div');
  // Отрисовано, но невидимо и без размеров: часть проверок требует, чтобы элемент был в дереве
  // отрисовки. Всё снимается синхронно и удаляется до следующего кадра.
  sandbox.style.cssText =
    'position: fixed; left: 0; top: 0; width: 0; height: 0; overflow: hidden; pointer-events: none; contain: strict';
  doc.body.append(sandbox);

  const pageStyle = doc.createElement('style');
  doc.head.append(pageStyle);
  const pageCss: string[] = [];

  const cs = (el: Element, prop: string) => win.getComputedStyle(el).getPropertyValue(prop).trim();
  /** Вычисленное значение токена: тем же путём, каким его получит элемент. */
  const resolve = (prop: string, value: string) => {
    const probe = doc.createElement('span');
    probe.style.setProperty(prop, value);
    sandbox.append(probe);
    const out = cs(probe, prop);
    probe.remove();
    return out;
  };

  let n = 0;
  const salt = Math.random().toString(36).slice(2, 7);
  const mk = (inner: string, page = '', light = ''): Fixture => {
    const cls = `sd-probe-${salt}-${n++}`;
    const wrap = doc.createElement('div');
    const host = doc.createElement('div');
    host.className = cls;
    host.innerHTML = light;
    wrap.append(host);
    sandbox.append(wrap);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = inner;
    if (page) pageCss.push(page.replaceAll('HOST', `.${cls}`));
    return { host, root, wrap, cls };
  };
  const flush = () => {
    pageStyle.textContent = pageCss.join('\n');
  };
  const p = (f: Fixture) => f.root.querySelector('p') as HTMLElement;

  const ok = resolve('color', OK);
  const err = resolve('color', ERR);
  if (!ok || ok === err) {
    pageStyle.remove();
    sandbox.remove();
    throw new Error('runBoundary: токены темы не найдены — два разных цвета вычислились одинаково');
  }

  const out: BoundaryResult = {};
  const fixtures: Partial<Record<BoundaryKey, Fixture>> = {};
  const add = (key: BoundaryKey, f: Fixture) => {
    fixtures[key] = f;
    return f;
  };

  // Сначала строится всё, потом один раз пишется лист страницы и снимаются ответы:
  // так пересчёт стилей один, и ни одна проверка не видит полуготового соседа.
  add('inherit-color', mk('<p>x</p>')).wrap.style.color = OK;
  add('inherit-font', mk('<p>x</p>')).wrap.style.fontFamily = MONO;
  add('custom-prop', mk('<p>x</p>')).wrap.style.setProperty('--sd-probe', '7px');

  try {
    win.CSS.registerProperty({ name: REGISTERED, syntax: '<length>', inherits: false, initialValue: '0px' });
  } catch {
    // Уже зарегистрировано прошлым запуском на этой странице — это то же самое свойство.
  }
  add('registered-noinherit', mk('<p>x</p>')).host.style.setProperty(REGISTERED, '9px');

  {
    const f = add('slot-inherit', mk(`<style>slot { color: ${OK}; }</style><slot></slot>`, '', '<span>x</span>'));
    f.host.style.color = ERR;
  }

  add('outer-selector', mk('<p>x</p>', `HOST p { color: ${ERR}; }`));
  // Контроль: тот же класс на обычном элементе без теневого корня — правило обязано сработать.
  // Не потомок самого хоста: без слота такой потомок вне плоского дерева, и Chromium с Firefox
  // отдают для него пустые строки вместо значений.
  const outerControl = doc.createElement('p');
  const outerControlHost = doc.createElement('div');
  outerControlHost.className = fixtures['outer-selector']!.cls;
  outerControlHost.append(outerControl);
  sandbox.append(outerControlHost);

  add('query-selector', mk(`<p class="sd-probe-${salt}-inner">x</p>`));

  const docSheet = new win.CSSStyleSheet();
  docSheet.replaceSync(`.sd-probe-${salt}-da { color: ${ERR}; }`);
  const docAdoptedBefore = [...doc.adoptedStyleSheets];
  doc.adoptedStyleSheets = [...docAdoptedBefore, docSheet];
  add('doc-adopted', mk(`<p class="sd-probe-${salt}-da">x</p>`));
  const docControl = doc.createElement('p');
  docControl.className = `sd-probe-${salt}-da`;
  sandbox.append(docControl);

  add('part', mk(`<style>p { color: ${OK}; }</style><p part="sd-lbl">x</p>`, `HOST::part(sd-lbl) { color: ${ERR}; }`));

  {
    const inner = '<style>::slotted(*) { padding-left: 5px; }</style><slot></slot>';
    add('slotted-top', mk(inner, '', '<p><span>x</span></p>'));
  }

  add('host-context', mk(`<style>:host-context(.sd-probe-${salt}-dark) p { color: ${ERR}; }</style><p>x</p>`)).wrap.classList.add(
    `sd-probe-${salt}-dark`,
  );

  add('button-font', mk('<button type="button">x</button>')).wrap.style.fontFamily = MONO;

  const faceName = `SdProbeFace${salt}`;
  add('shadow-font-face', mk(`<style>@font-face { font-family: ${faceName}; src: local("Georgia"); } p { font-family: ${faceName}; }</style><p>x</p>`));

  add('all-initial-font', mk('<style>:host { all: initial; }</style><p>x</p>')).wrap.style.fontFamily = MONO;
  add('all-initial-custom-prop', mk('<style>:host { all: initial; }</style><p>x</p>')).wrap.style.setProperty('--sd-probe', '7px');

  flush();

  try {
    const f = fixtures as Record<BoundaryKey, Fixture>;
    out['inherit-color'] = cs(p(f['inherit-color']), 'color') === ok;
    out['inherit-font'] = cs(p(f['inherit-font']), 'font-family') === cs(f['inherit-font'].wrap, 'font-family');
    out['custom-prop'] = cs(p(f['custom-prop']), '--sd-probe') === '7px';
    {
      const reg = f['registered-noinherit'];
      // Контроль: на самом хосте значение стоит — иначе свойство просто не зарегистрировалось.
      out['registered-noinherit'] = cs(reg.host, REGISTERED) === '9px' ? cs(p(reg), REGISTERED) === '9px' : null;
    }
    {
      const s = f['slot-inherit'];
      const span = s.host.querySelector('span') as HTMLElement;
      out['slot-inherit'] = cs(span, 'color') === ok;
    }
    out['outer-selector'] = cs(outerControl, 'color') === err ? cs(p(f['outer-selector']), 'color') === err : null;
    out['query-selector'] = doc.querySelector(`.sd-probe-${salt}-inner`) !== null;
    out['doc-adopted'] = cs(docControl, 'color') === err ? cs(p(f['doc-adopted']), 'color') === err : null;
    out['part'] = cs(p(f['part']), 'color') === err;
    {
      const s = f['slotted-top'];
      const top = s.host.querySelector('p') as HTMLElement;
      const deep = s.host.querySelector('span') as HTMLElement;
      out['slotted-top'] = cs(top, 'padding-left') === '5px';
      out['slotted-deep'] = out['slotted-top'] ? cs(deep, 'padding-left') === '5px' : null;
    }
    out['host-context'] = cs(p(f['host-context']), 'color') === err;
    {
      const b = f['button-font'];
      out['button-font'] = cs(b.root.querySelector('button') as HTMLElement, 'font-family') === cs(b.wrap, 'font-family');
    }
    // Регистрация шрифта из теневого корня видна по `document.fonts`: в движке, который её
    // принимает, шрифт появляется в наборе документа сразу после расчёта стиля.
    cs(p(f['shadow-font-face']), 'font-family');
    out['shadow-font-face'] = [...doc.fonts].some((face) => face.family.replace(/["']/g, '') === faceName);
    {
      const a = f['all-initial-font'];
      out['all-initial-font'] = cs(p(a), 'font-family') !== cs(a.wrap, 'font-family');
    }
    out['all-initial-custom-prop'] = cs(p(f['all-initial-custom-prop']), '--sd-probe') === '7px';
  } finally {
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== docSheet);
    pageStyle.remove();
    sandbox.remove();
  }

  return out;
}
