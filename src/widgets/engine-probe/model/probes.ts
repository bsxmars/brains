import type { EngineKey, EngineSnapshot, Probe } from './types';

/**
 * Вопросы к движку — одни и те же для демо и для проверки.
 *
 * Демо зовёт `runProbes()` в `onMounted` и кладёт ответы рядом со снимком трёх движков из
 * `data.ts`; e2e (`tests/e2e/browser-engines.spec.ts`) открывает собранную страницу в
 * Chromium, Firefox и WebKit, читает те же ответы из разметки демо и сверяет со снимком.
 * Поэтому каждый ответ — короткая строка без адресов, времени и случайных чисел.
 *
 * Модуль исполняется и при серверном рендере (остров сперва рисуется в Node), поэтому
 * сами зонды здесь только объявлены: зовут их лишь в браузере.
 */

const has = (value: unknown): string => (value === undefined || value === null ? 'нет' : 'есть');
const fn = (value: unknown): string => (typeof value === 'function' ? 'есть' : 'нет');
const css = (text: string): string => (CSS.supports(text) ? 'есть' : 'нет');
const entry = (type: string): string =>
  (PerformanceObserver.supportedEntryTypes ?? []).includes(type) ? 'есть' : 'нет';

/** Текст ошибки — дословно: он и есть то, что расходится. Имя ошибки одно у всех (`TypeError`). */
function message(fnThatThrows: () => unknown): string {
  try {
    fnThatThrows();
    return 'не бросило';
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
}

/**
 * Формат строки стека без адресов: у V8 — «at имя (адрес:строка:колонка)» под строкой
 * с сообщением, у SpiderMonkey и JavaScriptCore — «имя@адрес:строка:колонка» без неё.
 */
function stackFormat(): string {
  // Функция-подопытный — строкой: имя `inner` в собранном модуле минификатор переименовал бы.
  const inner = new Function("function inner() { return new Error('x').stack || ''; } return inner();") as () => string;
  const lines = inner().split('\n').filter(Boolean);
  const first = lines[0] ?? '';
  const frame = lines.find((line) => line.includes('inner')) ?? '';
  const head = first.startsWith('Error: x') ? 'первая строка — «Error: x»; ' : 'сообщения в стеке нет; ';
  if (/^\s+at inner \(/.test(frame)) return head + 'кадр «at inner (адрес:строка:колонка)»';
  if (/^inner@/.test(frame)) return head + 'кадр «inner@адрес:строка:колонка»';
  return head + 'кадр в другом формате';
}

/** Дата по местным компонентам: так ответ не зависит от часового пояса машины. */
function parsed(text: string): string {
  const time = Date.parse(text);
  if (Number.isNaN(time)) return 'NaN';
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Наименьший ненулевой шаг `performance.now()`, округлённый до понятной величины. */
function nowStep(): string {
  let best = Infinity;
  let last = performance.now();
  for (let i = 0, seen = 0; i < 300_000 && seen < 30; i++) {
    const now = performance.now();
    if (now !== last) {
      best = Math.min(best, now - last);
      last = now;
      seen++;
    }
  }
  if (best >= 0.9) return '1 мс';
  if (best >= 0.09) return '0.1 мс';
  if (best >= 0.009) return '0.01 мс';
  return 'меньше 0.01 мс';
}

export const PROBES: Probe[] = [
  // ---- язык ----
  // Код ошибки — строкой через `new Function`: сообщение цитирует имя переменной, а сборка
  // переименовывает локальные переменные. Строку минификатор не трогает — ответ не зависит от сборки.
  { key: 'err-undefined', group: 'язык', label: 'o.x, где o — undefined', run: () => message(new Function('const o = undefined; return o.x;') as () => unknown) },
  { key: 'err-not-fn', group: 'язык', label: 'o.f(), где o.f нет', run: () => message(new Function('const o = {}; return o.f();') as () => unknown) },
  { key: 'stack', group: 'язык', label: 'new Error().stack', run: stackFormat },
  { key: 'stack-limit', group: 'язык', label: 'Error.stackTraceLimit', run: () => String((Error as { stackTraceLimit?: number }).stackTraceLimit) },
  { key: 'date-dots', group: 'язык', label: "Date.parse('01.10.2026')", run: () => parsed('01.10.2026') },
  { key: 'date-slash', group: 'язык', label: "Date.parse('1/10/2026')", run: () => parsed('1/10/2026') },
  { key: 'date-russian', group: 'язык', label: "Date.parse('1 октября 2026')", run: () => parsed('1 октября 2026') },
  { key: 'temporal', group: 'язык', label: 'Temporal', run: () => has((globalThis as { Temporal?: unknown }).Temporal) },
  { key: 'iterator-helpers', group: 'язык', label: 'Iterator.prototype.map', run: () => fn((globalThis as { Iterator?: { prototype?: { map?: unknown } } }).Iterator?.prototype?.map) },
  {
    key: 'using',
    group: 'язык',
    label: 'using x = …',
    run: () => {
      try {
        new Function('{ using x = null; }');
        return 'есть';
      } catch {
        return 'нет';
      }
    },
  },

  // ---- CSS ----
  { key: 'css-scroll-timeline', group: 'CSS', label: 'animation-timeline: scroll()', run: () => css('animation-timeline: scroll()') },
  { key: 'css-interpolate-size', group: 'CSS', label: 'interpolate-size: allow-keywords', run: () => css('interpolate-size: allow-keywords') },
  { key: 'css-if', group: 'CSS', label: 'if(style(…): …)', run: () => css('color: if(style(--x: 1): red; else: blue)') },
  { key: 'css-grid-lanes', group: 'CSS', label: 'display: grid-lanes', run: () => css('display: grid-lanes') },
  { key: 'css-reading-flow', group: 'CSS', label: 'reading-flow: grid-rows', run: () => css('reading-flow: grid-rows') },
  { key: 'css-anchor', group: 'CSS', label: 'anchor-name: --a', run: () => css('anchor-name: --a') },
  { key: 'css-has', group: 'CSS', label: ':has()', run: () => (CSS.supports('selector(:has(a))') ? 'есть' : 'нет') },

  // ---- API ----
  { key: 'scheduler', group: 'API', label: 'scheduler.postTask', run: () => fn((globalThis as { scheduler?: { postTask?: unknown } }).scheduler?.postTask) },
  { key: 'idle', group: 'API', label: 'requestIdleCallback', run: () => fn((globalThis as { requestIdleCallback?: unknown }).requestIdleCallback) },
  { key: 'set-html', group: 'API', label: 'Element.prototype.setHTML', run: () => fn((Element.prototype as { setHTML?: unknown }).setHTML) },
  { key: 'move-before', group: 'API', label: 'Element.prototype.moveBefore', run: () => fn((Element.prototype as { moveBefore?: unknown }).moveBefore) },
  { key: 'file-picker', group: 'API', label: 'showOpenFilePicker', run: () => fn((globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker) },
  { key: 'eye-dropper', group: 'API', label: 'EyeDropper', run: () => fn((globalThis as { EyeDropper?: unknown }).EyeDropper) },
  { key: 'view-transition', group: 'API', label: 'document.startViewTransition', run: () => fn((document as { startViewTransition?: unknown }).startViewTransition) },
  { key: 'navigation', group: 'API', label: 'navigation', run: () => has((globalThis as { navigation?: unknown }).navigation) },

  // ---- наблюдатели производительности ----
  { key: 'po-longtask', group: 'наблюдатели', label: "'longtask'", run: () => entry('longtask') },
  { key: 'po-loaf', group: 'наблюдатели', label: "'long-animation-frame'", run: () => entry('long-animation-frame') },
  { key: 'po-layout-shift', group: 'наблюдатели', label: "'layout-shift'", run: () => entry('layout-shift') },
  { key: 'po-event', group: 'наблюдатели', label: "'event'", run: () => entry('event') },

  // ---- таймер ----
  { key: 'now-step', group: 'таймер', label: 'шаг performance.now()', run: nowStep },
];

/** Ответы вашего браузера: `{ key: ответ }`. Зовут только в браузере. */
export function runProbes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const probe of PROBES) {
    try {
      out[probe.key] = probe.run();
    } catch (error) {
      out[probe.key] = `зонд упал: ${error instanceof Error ? error.name : String(error)}`;
    }
  }
  return out;
}

/** С каким движком снимка ваш браузер совпал больше всего — и на скольких зондах. */
export function closest(answers: Record<string, string>, snapshot: EngineSnapshot): { engine: EngineKey; same: number; total: number } {
  const engines: EngineKey[] = ['chromium', 'firefox', 'webkit'];
  const keys = Object.keys(snapshot).filter((key) => key in answers);
  const score = engines.map((engine) => ({ engine, same: keys.filter((key) => snapshot[key][engine] === answers[key]).length }));
  score.sort((a, b) => b.same - a.same);
  return { ...score[0], total: keys.length };
}
