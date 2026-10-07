import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as data from '@/content/frameworks/react-rerender/data';
import {
  FIRST_RENDER,
  FIRST_RENDER_NOTE,
  GLOSSARY,
  PROFILER_CODE,
  PROFILER_LOG,
  PROFILER_PROD,
  SELF_CHECK,
} from '@/content/frameworks/react-rerender/data';

/**
 * «Ре-рендеринг в React», подраздел «Как мерить: `<Profiler>`».
 *
 * Исполняется **та же строка** `PROFILER_CODE`, что напечатана в теме. Каждая сборка — в своём
 * процессе Node: `react`/`react-dom` выбирают сборку по `NODE_ENV` один раз, при загрузке, а
 * `vitest` выставляет `NODE_ENV=test`, то есть внутри его процесса продакшен-сборки не получить.
 *
 * DOM в зависимостях курса нет, поэтому в дочернем процессе — поддельный документ из обычных
 * объектов, того же рода, что в `tests/unit/react-internals.test.ts`: клиентскому рендереру
 * на этом примере хватает создать, вставить и прочитать узел.
 *
 * Ожидание между шагами — ожидание, а не замер: в журнал пишется только порядок строк.
 */

const RUNNER = String.raw`
class N { constructor(t) { this.nodeType = t; this.childNodes = []; this.parentNode = null; this.nodeValue = null; }
  get ownerDocument() { return doc; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes.at(-1) ?? null; }
  get nextSibling() { const s = this.parentNode?.childNodes ?? []; return s[s.indexOf(this) + 1] ?? null; }
  appendChild(c) { c.parentNode?.detach(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore(c, b) { if (!b) return this.appendChild(c); c.parentNode?.detach(c); this.childNodes.splice(this.childNodes.indexOf(b), 0, c); c.parentNode = this; return c; }
  removeChild(c) { this.detach(c); return c; }
  detach(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; }
  addEventListener() {} removeEventListener() {}
  get textContent() { return this.nodeType === 3 ? this.nodeValue : this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { if (this.nodeType === 3) { this.nodeValue = v; return; } this.childNodes = []; if (v !== '' && v != null) { const t = new N(3); t.nodeValue = String(v); t.parentNode = this; this.childNodes.push(t); } }
  get data() { return this.nodeValue; } set data(v) { this.nodeValue = v; }
}
class E extends N { constructor(n) { super(1); this.localName = n; this.tagName = n.toUpperCase(); this.nodeName = this.tagName; this.attrs = {}; this.style = {}; this.namespaceURI = 'http://www.w3.org/1999/xhtml'; }
  get attributes() { return Object.entries(this.attrs).map(([name, value]) => ({ name, value })); }
  setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; } hasAttribute(k) { return k in this.attrs; }
}
const doc = Object.assign(new N(9), { nodeName: '#document', createElement: (t) => new E(t),
  createTextNode: (v) => { const t = new N(3); t.nodeValue = String(v); return t; },
  documentElement: new E('html'), body: new E('body'), defaultView: null });
doc.activeElement = doc.body;
const win = { document: doc, HTMLIFrameElement: class {}, event: undefined, addEventListener() {}, removeEventListener() {} };
doc.defaultView = win;
Object.assign(globalThis, { window: win, document: doc });

const React = require('react');
const client = require(process.env.ENTRY);
const out = [];
const log = (s) => out.push(s);
const set = {};
const App = new Function('h', 'memo', 'useState', 'useLayoutEffect', 'Profiler', 'log', 'set',
  process.env.CODE + '\nreturn App;')(React.createElement, React.memo, React.useState, React.useLayoutEffect, React.Profiler, log, set);
const settle = () => new Promise((r) => setTimeout(r, 20));
(async () => {
  const root = client.createRoot(new E('div'));
  root.render(React.createElement(App)); await settle();
  log('— set.app(1)'); set.app(1); await settle();
  log('— set.counter(1)'); set.counter(1); await settle();
  process.stdout.write(JSON.stringify(out));
})();
`;

function run(nodeEnv: 'development' | 'production', entry: 'react-dom/client' | 'react-dom/profiling'): string[] {
  const stdout = execFileSync(process.execPath, ['-e', RUNNER], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: nodeEnv, ENTRY: entry, CODE: PROFILER_CODE },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(stdout) as string[];
}

describe('«Ре-рендеринг в React»: <Profiler>', () => {
  it('отладочная сборка: журнал дословно PROFILER_LOG', () => {
    expect(run('development', 'react-dom/client')).toEqual(PROFILER_LOG);
  });

  it('react-dom/profiling в продакшене: журнал совпадает с отладочным дословно', () => {
    expect(run('production', 'react-dom/profiling')).toEqual(PROFILER_LOG);
  });

  it('продакшен-сборка: компоненты те же, onRender — ни одного', () => {
    const prod = run('production', 'react-dom/client');
    expect(prod.filter((s) => s.startsWith('onRender'))).toEqual([]);
    expect(prod).toEqual(PROFILER_LOG.filter((s) => !s.startsWith('onRender')));
    // текст темы держит именно это утверждение — «ноль», а не «меньше»
    expect(PROFILER_PROD).toContain('не зовётся ни разу');
  });

  it('onRender приходит, хотя ребёнок в memo не рендерился', () => {
    const afterApp = PROFILER_LOG.slice(PROFILER_LOG.indexOf('— set.app(1)'), PROFILER_LOG.indexOf('— set.counter(1)'));
    expect(afterApp).toContain('onRender лист: update');
    expect(afterApp).not.toContain('Leaf()');
  });

  it('«за кадром»: пункт про профилирование раскрыт, а блок снят целиком', () => {
    // Последний пункт (Server Components) стал своей темой — блока больше нет,
    // и профилирование не должно вернуться туда строкой.
    expect('OFFSCREEN' in data).toBe(false);
  });
});

/**
 * Серверный проход: две правки темы, которые стояли без сторожа (React 19.3.0, сняты однажды
 * руками). `SELF_CHECK`, задача G, раньше обещала, что на `useLayoutEffect` при серверном
 * рендере «React предупреждает» — на 19.3.0 предупреждения нет. А вводная карточка звала
 * элемент «неизменяемым объектом» без оговорки — заморожен он только в отладочной сборке.
 *
 * Каждая сборка — в своём процессе с явным `NODE_ENV`, как и `<Profiler>` выше: внутри vitest
 * `NODE_ENV=test`, и продакшен-сборку там не получить. Какую сборку процесс **на самом деле**
 * загрузил, проверяется по `require.cache` — иначе «прогон в продакшене» мог бы молча оказаться
 * отладочным (та же ловушка, что с `@vue/*` в AGENTS.md).
 *
 * Молчание проверяется с контролем: тот же перехват в отладочной сборке обязан поймать
 * настоящее предупреждение React (список без `key`) — иначе «сообщений ноль» доказывало бы
 * только то, что перехват не работает.
 */
const SSR_RUNNER = String.raw`
const messages = [];
for (const k of ['error', 'warn', 'log', 'info', 'debug']) console[k] = (...a) => messages.push(k + ': ' + String(a[0]));
process.stderr.write = (chunk) => { messages.push('stderr: ' + chunk); return true; };
process.on('warning', (w) => messages.push('warning: ' + w.message));

const React = require('react');
const server = require('react-dom/server');
const h = React.createElement;
let layout = 0, effect = 0, calls = 0;
function C() {
  calls++;
  React.useLayoutEffect(() => { layout++; });
  React.useEffect(() => { effect++; });
  return h('div', null, 'x');
}
const out = {};
out.html = [server.renderToString(h(C)), server.renderToStaticMarkup(h(C))];
setTimeout(() => {
  out.counts = { calls, layout, effect };
  out.silent = messages.splice(0);
  // контроль перехвата: список без key — предупреждение, которое React печатает в dev
  server.renderToString(h('ul', null, [1, 2].map((i) => h('li', null, i))));
  out.control = messages.splice(0);
  out.frozen = Object.isFrozen(h('div'));
  out.builds = Object.keys(require.cache)
    .filter((p) => /[\\/]react(-dom)?[\\/]cjs[\\/]/.test(p))
    .map((p) => p.split(/[\\/]cjs[\\/]/)[1])
    .sort();
  process.stdout.write(JSON.stringify(out));
}, 0);
`;

interface SsrRun {
  html: string[];
  counts: { calls: number; layout: number; effect: number };
  silent: string[];
  control: string[];
  frozen: boolean;
  builds: string[];
}

function ssr(nodeEnv: 'development' | 'production'): SsrRun {
  const stdout = execFileSync(process.execPath, ['-e', SSR_RUNNER], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: nodeEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout) as SsrRun;
}

describe('«Ре-рендеринг в React»: серверный проход в обеих сборках', () => {
  const runs = { development: ssr('development'), production: ssr('production') };

  it('каждый процесс загрузил ту сборку, которую заказали', () => {
    for (const [env, run] of Object.entries(runs)) {
      expect(run.builds.length, env).toBeGreaterThan(0);
      for (const file of run.builds) expect(file, env).toMatch(new RegExp(`\\.${env}\\.js$`));
    }
    expect(runs.development.builds).toContain('react.development.js');
    expect(runs.production.builds).toContain('react.production.js');
  });

  it('useLayoutEffect и useEffect на сервере не выполняются: ноль вызовов при двух рендерах', () => {
    for (const run of Object.values(runs)) {
      expect(run.html).toEqual(['<div>x</div>', '<div>x</div>']);
      expect(run.counts).toEqual({ calls: 2, layout: 0, effect: 0 });
    }
    const row = (hook: string) => FIRST_RENDER.rows.find((r) => r[0] === hook);
    expect(row('`useLayoutEffect`')?.[3]).toBe('**0**');
    expect(row('`useEffect`')?.[3]).toBe('**0**');
  });

  it('предупреждения нет — ни в renderToString, ни в renderToStaticMarkup, ни в одной сборке', () => {
    expect(runs.development.silent).toEqual([]);
    expect(runs.production.silent).toEqual([]);
    // контроль: перехват живой — в отладочной сборке React предупреждение печатает и ловится
    expect(runs.development.control.join('\n')).toContain('unique "key" prop');
    expect(runs.production.control).toEqual([]);

    const g = SELF_CHECK.find((q) => q.question.startsWith('**G.'));
    // Было «и React предупреждает об этом»; правка держится на отрицании — оно и проверяется.
    expect(g?.answer).toContain('не печатают ни одного сообщения, в обеих сборках');
  });

  it('Object.isFrozen(element): true в отладочной сборке, false в продакшене', () => {
    expect(runs.development.frozen).toBe(true);
    expect(runs.production.frozen).toBe(false);
    expect(FIRST_RENDER_NOTE).toContain('`Object.isFrozen` на элементе даёт `true` в отладочной и `false` в продакшен');
    // Словарь говорит о договорённости («его не меняют»), а не о заморозке: в продакшене
    // элемент изменить можно, и карточка не должна обещать обратного.
    const element = GLOSSARY.find((t) => t.k === 'элемент');
    expect(element?.d).toContain('После создания его не меняют');
    expect(element?.d).not.toMatch(/заморож|нельзя (из)?мен/);
  });
});
