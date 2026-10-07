import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { EFFECTS_TIMING } from '../../src/content/frameworks/react-rerender/data';
import { TIMING_ROWS } from '../../src/content/frameworks/react-vs-vue/data';

/**
 * Когда выполняется `useEffect` — «Ре-рендеринг в React» (`EFFECTS_TIMING`) и «React против Vue»
 * (строка `useEffect` в `TIMING_ROWS`).
 *
 * Обе темы утверждают снятое разово (React 19.3.0, обе сборки, Chromium 153): после
 * **дискретного** события — клика — `useEffect` выполняется в той же задаче, что и коммит,
 * то есть **до** кадра. Было в теме «после отрисовки»; поправлено замером, и замеру нужен сторож.
 *
 * Закрепляется **порядок**, а не миллисекунды. Метки ставит `useLayoutEffect` того же коммита:
 * микрозадача, `requestAnimationFrame` и `setTimeout(0)`. Эффект раньше микрозадачи — значит,
 * в той же задаче (микрозадачи сливаются на её конце); раньше `rAF` — значит, до кадра.
 *
 * ⚠️ Контроль рядом: тот же компонент, обновлённый из `setTimeout`, — эффект уходит в отдельную
 * задачу и оказывается **после** микрозадачи. Без контроля проверка не отличала бы «после клика
 * — синхронно» от «эффект всегда синхронный». Положение эффекта относительно кадра в этом случае
 * не сверяется: там исход статистический («до и после кадра примерно поровну» в самой теме),
 * и сторож на нём мигал бы.
 *
 * React берётся из `node_modules` проекта — CJS-файлы обеих сборок, отданные странице перехватом
 * запроса и связанные крошечным загрузчиком `require` (UMD-сборок у React 19 нет). Сборка сайта
 * и `global-setup` не нужны. Клик — настоящий, через `page.click`: синтетический `dispatchEvent`
 * React приоритизирует не так, как событие от пользователя.
 */

const ORIGIN = 'http://localhost:5977';
const ROOT = new URL('../../node_modules/', import.meta.url);

type Build = 'production' | 'development';

/** Какие файлы отдать под каким именем модуля. */
const MODULES: Record<string, (build: Build) => string> = {
  react: (b) => `react/cjs/react.${b}.js`,
  'react-dom': (b) => `react-dom/cjs/react-dom.${b}.js`,
  'react-dom/client': (b) => `react-dom/cjs/react-dom-client.${b}.js`,
  scheduler: (b) => `scheduler/cjs/scheduler.${b}.js`,
};

const version = JSON.parse(readFileSync(new URL('react/package.json', ROOT), 'utf8')).version as string;

/** Модуль, завёрнутый в фабрику CommonJS: `process` подставляется, чтобы сборка выбиралась явно. */
function wrap(name: string, build: Build): string {
  const source = readFileSync(new URL(MODULES[name](build), ROOT), 'utf8');
  return `__defs[${JSON.stringify(name)}] = function (module, exports, require, process) {\n${source}\n};`;
}

const LOADER = (build: Build) => `window.__defs = {};
window.__require = (function () {
  const cache = {};
  const process = { env: { NODE_ENV: ${JSON.stringify(build)} } };
  return function require(name) {
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} };
    cache[name] = module;
    __defs[name](module, module.exports, require, process);
    return module.exports;
  };
})();`;

/**
 * Компонент стенда. `useLayoutEffect` ставит три метки, `useEffect` — свою; журнал общий.
 * Нулевой рендер (монтирование) меток не ставит: проверяется обновление.
 */
const APP = `
const React = __require('react');
const { createRoot } = __require('react-dom/client');
const { useState, useEffect, useLayoutEffect, createElement } = React;
window.__log = [];
function App() {
  const [n, setN] = useState(0);
  window.__bumpFromTimer = () => setTimeout(() => setN((x) => x + 1), 0);
  useLayoutEffect(() => {
    if (n === 0) return;
    const log = window.__log;
    queueMicrotask(() => log.push('microtask'));
    requestAnimationFrame(() => log.push('raf'));
    setTimeout(() => log.push('timeout'), 0);
  }, [n]);
  useEffect(() => {
    if (n === 0) return;
    window.__log.push('effect');
  }, [n]);
  return createElement('button', { id: 'bump', onClick: () => setN((x) => x + 1) }, String(n));
}
createRoot(document.getElementById('root')).render(createElement(App));
window.__version = React.version;
// Какая сборка загружена на деле: элемент заморожен только в отладочной (см. «Правки содержания»).
window.__frozen = Object.isFrozen(createElement('i'));`;

async function open(page: Page, build: Build) {
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const js = (body: string) => route.fulfill({ contentType: 'text/javascript', body });
    if (path === '/loader.js') return js(LOADER(build));
    if (path === '/app.js') return js(APP);
    const name = decodeURIComponent(path.replace(/^\/m\//, '').replace(/\.js$/, ''));
    if (path.startsWith('/m/') && MODULES[name]) return js(wrap(name, build));
    const scripts = ['/loader.js', ...Object.keys(MODULES).map((n) => `/m/${encodeURIComponent(n)}.js`), '/app.js'];
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>effect-timing</title><div id="root"></div>${scripts
        .map((src) => `<script src="${src}"></script>`)
        .join('')}`,
    });
  });
  await page.goto(`${ORIGIN}/`);
  await page.waitForSelector('#bump');
}

/** Журнал одного обновления: дождаться всех четырёх меток, вернуть их порядок. */
async function journal(page: Page, trigger: () => Promise<void>): Promise<string[]> {
  await page.evaluate(() => {
    (window as unknown as { __log: string[] }).__log.length = 0;
  });
  await trigger();
  await page.waitForFunction(() => {
    const log = (window as unknown as { __log: string[] }).__log;
    return ['effect', 'microtask', 'raf', 'timeout'].every((mark) => log.includes(mark));
  });
  return page.evaluate(() => [...(window as unknown as { __log: string[] }).__log]);
}

const REPEATS = 5;

for (const build of ['production', 'development'] as const) {
  test(`React ${build}: после клика useEffect — в той же задаче и до кадра`, async ({ page }) => {
    await open(page, build);
    expect(await page.evaluate(() => (window as unknown as { __version: string }).__version)).toBe(version);
    // Без этой сверки «обе сборки» легко оказываются одной: загрузчик мог взять не тот файл.
    expect(
      await page.evaluate(() => (window as unknown as { __frozen: boolean }).__frozen),
      'загружена не та сборка React, что заказана',
    ).toBe(build === 'development');

    for (let i = 0; i < REPEATS; i++) {
      const log = await journal(page, () => page.click('#bump'));
      const at = (mark: string) => log.indexOf(mark);
      expect(at('effect'), `клик ${i + 1}: эффект после микрозадачи — ушёл в отдельную задачу (${log})`).toBeLessThan(
        at('microtask'),
      );
      expect(at('effect'), `клик ${i + 1}: эффект после кадра (${log})`).toBeLessThan(at('raf'));
    }

    // Контроль: обновление из таймера — эффект в отдельной задаче, после микрозадачи коммита.
    // Положение относительно кадра здесь не сверяется: оно статистическое (см. шапку).
    for (let i = 0; i < REPEATS; i++) {
      const log = await journal(page, () =>
        page.evaluate(() => (window as unknown as { __bumpFromTimer: () => void }).__bumpFromTimer()),
      );
      expect(
        log.indexOf('effect'),
        `таймер ${i + 1}: эффект раньше микрозадачи — контроль не отличает клик от таймера (${log})`,
      ).toBeGreaterThan(log.indexOf('microtask'));
    }
  });
}

/**
 * Связь с текстом. Обе темы обязаны говорить то, что проверено выше: после клика — в той же
 * задаче, до отрисовки. Подстроки — формулировки правки («было: после отрисовки»); вернётся
 * старое — покраснеет здесь.
 */
test('темы говорят: после клика useEffect — в той же задаче, до отрисовки', () => {
  expect(EFFECTS_TIMING, '«Ре-рендеринг в React» перестал говорить про ту же задачу после клика').toContain(
    'После клика или нажатия клавиши React выполняет его **в той же задаче**',
  );
  const row = TIMING_ROWS.rows.find(([, react]) => react === '`useEffect`');
  expect(row, 'в TIMING_ROWS пропала строка useEffect').toBeTruthy();
  expect(row![2], '«React против Vue» разошлась с замером про клик').toContain(
    'после клика или клавиши — в той же задаче, **до** отрисовки',
  );
});
