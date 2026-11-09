/**
 * Проба песочницы iframe — документ, который демо кладёт в `srcdoc`, и разбор его ответа.
 *
 * Модуль без DOM и Vue: его же импортирует `tests/unit/iframe.test.ts` и гоняет тот же
 * документ в Chromium, Firefox и WebKit, сверяя ответы с таблицей `SANDBOX_MATRIX` темы.
 * Демо и таблица спрашивают движок одинаково.
 *
 * Документ живёт строкой в `.ts`, а не в `.vue`: в SFC последовательность `</script>`
 * закрыла бы блок компонента.
 *
 * Пробы ничего не оставляют после себя: запись в `localStorage` тут же удаляется, куки
 * только читаются (длина строки не печатается), форма отправляется во вложенный
 * `about:blank` внутри самого фрейма — в сеть ничего не уходит.
 */

/** Флаги, которые переключает демо. Остальные флаги разобраны в теме таблицей. */
export const LAB_FLAGS = ['allow-scripts', 'allow-same-origin', 'allow-forms'] as const;
export type LabFlag = (typeof LAB_FLAGS)[number];

/** Что фрейм получил: атрибута нет вовсе или есть `sandbox` с набором флагов. */
export interface LabSetup {
  sandbox: boolean;
  flags: LabFlag[];
}

/** Значение атрибута `sandbox` или `null`, если атрибута нет. Порядок флагов — как в `LAB_FLAGS`. */
export function sandboxValue(setup: LabSetup): string | null {
  if (!setup.sandbox) return null;
  return LAB_FLAGS.filter((f) => setup.flags.includes(f)).join(' ');
}

/** Тег так, как его написал бы читатель (без длинного `srcdoc`). */
export function iframeTag(setup: LabSetup): string {
  const value = sandboxValue(setup);
  const attr = value === null ? '' : value === '' ? ' sandbox' : ` sandbox="${value}"`;
  return `<iframe${attr} srcdoc="…проба…"></iframe>`;
}

/** Ответ изнутри фрейма. Каждое поле — значение или имя исключения (`SecurityError`). */
export interface ProbeReport {
  origin: string;
  parentDoc: string;
  storage: string;
  cookie: string;
  frameElement: string;
  form: string;
}

/** Полный результат прогона: ответ фрейма (или `null`, если скрипты не выполнились) и взгляд снаружи. */
export interface ProbeResult {
  report: ProbeReport | null;
  /** `iframe.contentDocument` глазами родителя: `null` или `'document'`. */
  outside: 'null' | 'document';
}

/**
 * Скрипт пробы. Каждая проба в своём `try`: исключение одной не глушит остальные.
 * Форма уходит во вложенный фрейм `sink`; через 300 мс видно, был ли в нём переход (событие `load`).
 */
const PROBE_SCRIPT = `
(() => {
  const out = {};
  const t = (k, fn) => { try { out[k] = String(fn()); } catch (e) { out[k] = e.name; } };
  t('origin', () => self.origin);
  t('parentDoc', () => typeof parent.document.title);
  t('storage', () => { localStorage.setItem('iframe-lab', '1'); localStorage.removeItem('iframe-lab'); return 'ok'; });
  t('cookie', () => typeof document.cookie);
  t('frameElement', () => (frameElement ? frameElement.tagName : 'null'));
  const form = document.getElementById('probe-form');
  const sink = document.getElementById('probe-sink');
  let loads = 0;
  sink.addEventListener('load', () => loads++);
  try { form.requestSubmit(); } catch (e) { out.form = e.name; }
  document.getElementById('probe-state').textContent = 'Скрипт выполнился. Источник документа: ' + out.origin;
  setTimeout(() => {
    // Перешёл ли приёмник: каждый переход заканчивается его событием load. Документ
    // приёмника не читается — с непрозрачным источником он недоступен даже своему фрейму.
    if (!out.form) out.form = loads > 0 ? 'sent' : 'blocked';
    parent.postMessage(Object.assign({ __iframeLab: true }, out), '*');
  }, 300);
})();
`;

/** Цвета и шрифт документа внутри фрейма — из темы курса, их передаёт остров. */
export interface ProbeTheme {
  bg: string;
  text: string;
  mono: string;
}

/** Документ пробы для `srcdoc`. */
export function buildProbeDoc(theme: ProbeTheme): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; padding: 12px 14px; background: ${theme.bg}; color: ${theme.text}; font: 12px/1.5 ${theme.mono}; }
  p { margin: 0; }
  form, iframe { display: none; }
</style>
</head>
<body>
<p id="probe-state">Скрипты в этом документе не выполнились: он молчит.</p>
<form id="probe-form" action="about:blank" method="get" target="probe-sink"><input name="sent" value="1"></form>
<iframe id="probe-sink" name="probe-sink" title="приёмник формы"></iframe>
<script>${PROBE_SCRIPT}</script>
</body>
</html>`;
}

/** Ответ из `message` — проба или чужое сообщение. */
export function readReport(data: unknown): ProbeReport | null {
  if (!data || typeof data !== 'object' || (data as { __iframeLab?: unknown }).__iframeLab !== true) return null;
  const d = data as Record<string, unknown>;
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '—');
  return {
    origin: s('origin'),
    parentDoc: s('parentDoc'),
    storage: s('storage'),
    cookie: s('cookie'),
    frameElement: s('frameElement'),
    form: s('form'),
  };
}

/** Колонки результата — в том же порядке, что `cellsOf` и таблица темы `SANDBOX_MATRIX`. */
export const PROBE_COLUMNS = [
  'скрипт',
  'self.origin',
  'parent.document',
  'localStorage',
  'document.cookie',
  'форма',
  'contentDocument снаружи',
] as const;

/** Что фрейм может, по-человечески: одна строка на колонку. Демо и таблица темы печатают это. */
export function cellsOf(result: ProbeResult): string[] {
  const r = result.report;
  const outside = result.outside === 'document' ? 'документ' : 'null';
  if (!r) return ['нет', '—', '—', '—', '—', '—', outside];
  const word = (v: string, ok: string, yes: string) => (v === ok ? yes : v);
  return [
    'да',
    r.origin === 'null' ? '"null"' : 'как у родителя',
    word(r.parentDoc, 'string', 'читает'),
    word(r.storage, 'ok', 'пишет'),
    word(r.cookie, 'string', 'читает'),
    r.form === 'sent' ? 'уходит' : r.form === 'blocked' ? 'не уходит' : r.form,
    outside,
  ];
}

/** Можно ли это фрейму — для цвета ячейки в демо. «Нет» и имя исключения — запрет. */
export function isAllowed(cell: string): boolean {
  return !['нет', '—', 'null', 'не уходит', '"null"'].includes(cell) && !/Error$/.test(cell);
}
