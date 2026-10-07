import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HYDRATE_ORDER_LOG,
  HYDRATE_ORDER_REACT,
  HYDRATE_ORDER_VUE,
  LAZY_VUE_CODE,
  LAZY_VUE_LOG,
  MISMATCH_TABLE,
  PITFALLS,
  REACT_ORDER_CODE,
  SELECTIVE_CODE,
  SERVER_HTML,
  SILENCE,
  SILENCE_CODE,
  STREAM_REACT_CODE,
  STREAM_REACT_REST_END,
  STREAM_REACT_REST_START,
  STREAM_REACT_SHELL,
  STREAM_VUE_CHUNKS,
  STREAM_VUE_CODE,
  VUE_ORDER_CODE,
} from '@/content/frameworks/ssr-hydration/data';
import { SERVER_STAMP, SERVER_THEME, VARIANTS } from '@/widgets/ssr-hydration/model/lab';
import type { HydrationRun, Variant } from '@/widgets/ssr-hydration/model/types';

/**
 * «SSR и гидратация»: всё, что тема утверждает о React 19.3 и Vue 3.5, — запуском.
 *
 * Две половины, и у каждой своя среда.
 *
 * **Сервер — в Node, отдельным процессом на каждую сборку.** Внутри vitest сборку пакетов
 * выбирает не `NODE_ENV`, а условие `development` (AGENTS.md: «Внутри vitest `NODE_ENV` сборку
 * `@vue/*` не выбирает»). Дочерний процесс — обычный Node, там `NODE_ENV` работает как у всех,
 * а какая сборка загружена на самом деле, процесс сообщает сам — по `require.cache`.
 *
 * **Браузер — Chromium через Playwright.** Гидратации нужен настоящий DOM, и не поддельный:
 * вся тема про то, какие объекты узлов остались в документе. Тест собирает esbuild'ом
 * **тот же модуль**, которым считает демо (`widgets/ssr-hydration/model/lab.ts`), вместе
 * с настоящими `react-dom/client` и `vue` — дважды: продакшен (как на сайте) и отладочная.
 *
 * Листинги из `data.ts` исполняются как напечатаны: подставляются только имена, которые
 * они зовут, но не объявляют.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Build = 'production' | 'development';

// ---------------------------------------------------------------------------
// Сервер: Node, отдельный процесс на сборку
// ---------------------------------------------------------------------------

interface ServerOut {
  loaded: string[];
  react: string;
  reactBoundary: string;
  vue: string;
  reactStream: string[];
  vueStream: string[];
  toStringPending: string;
}

/** Скрипт для дочернего процесса: CommonJS, чтобы спросить `require.cache`, какая сборка загружена. */
const SERVER_SCRIPT = String.raw`
const { Writable } = require('node:stream');
const React = require('react');
const server = require('react-dom/server');
const Vue = require('vue');
const vueServer = require('@vue/server-renderer');
const codes = JSON.parse(process.env.SSR_CODES);
const h = React.createElement;

function collector(chunks, done) {
  return new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
    final(cb) { cb(); done(); },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

(async () => {
  const Order = new Function('h', 'useState', 'Suspense', codes.react + '\nreturn Order;')(h, React.useState, React.Suspense);
  const VOrder = new Function('h', 'ref', codes.vue + '\nreturn Order;')(Vue.h, Vue.ref);
  const props = codes.props;

  const out = {};
  out.react = server.renderToString(h(Order, props));
  out.reactBoundary = server.renderToString(h(Order, { ...props, boundary: true }));
  out.vue = await vueServer.renderToString(Vue.createSSRApp(VOrder, props));

  // renderToString и граница, которая так и не дождётся данных
  const never = new Promise(() => {});
  function Pending() { React.use(never); return null; }
  out.toStringPending = server.renderToString(h('main', null, h(React.Suspense, { fallback: h('i', null, 'ждём') }, h(Pending))));

  // Стриминг React: промис разрешается после того, как каркас ушёл
  {
    const chunks = [];
    const data = deferred();
    const finished = new Promise((done) => {
      const res = collector(chunks, done);
      new Function('h', 'use', 'Suspense', 'renderToPipeableStream', 'reviewsPromise', 'res', codes.streamReact)(
        h, React.use, React.Suspense, server.renderToPipeableStream, data.promise, res,
      );
    });
    setTimeout(() => { chunks.push('▸ данные'); data.resolve([1, 2, 3]); }, 30);
    await finished;
    out.reactStream = chunks;
  }

  // Стриминг Vue
  {
    const chunks = [];
    const data = deferred();
    const finished = new Promise((done) => {
      const res = collector(chunks, done);
      new Function('h', 'Suspense', 'createSSRApp', 'pipeToNodeWritable', 'reviewsPromise', 'res', codes.streamVue)(
        Vue.h, Vue.Suspense, Vue.createSSRApp, vueServer.pipeToNodeWritable, data.promise, res,
      );
    });
    setTimeout(() => { chunks.push('▸ данные'); data.resolve([1, 2, 3]); }, 30);
    await finished;
    out.vueStream = chunks;
  }

  out.loaded = Object.keys(require.cache)
    .filter((f) => /react-dom-server\.node\.|react\.(development|production)|server-renderer\.cjs|runtime-core\.cjs/.test(f))
    .map((f) => f.split('/').pop());
  process.stdout.write(JSON.stringify(out));
})();
`;

function serverRun(build: Build): ServerOut {
  const stdout = execFileSync(process.execPath, ['-e', SERVER_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: build,
      SSR_CODES: JSON.stringify({
        react: REACT_ORDER_CODE,
        vue: VUE_ORDER_CODE,
        props: { stamp: SERVER_STAMP, theme: SERVER_THEME },
        streamReact: STREAM_REACT_CODE,
        streamVue: STREAM_VUE_CODE,
      }),
    },
  });
  return JSON.parse(stdout) as ServerOut;
}

describe.each(['production', 'development'] as const)('сервер, Node, сборка %s', (buildName) => {
  const out = serverRun(buildName);

  it('загружена заказанная сборка — иначе проверка «обеих сборок» проверяет одну', () => {
    const want = buildName === 'production' ? /production|prod/ : /development|cjs\.js$/;
    for (const file of out.loaded) expect(file, file).toMatch(want);
    expect(out.loaded.length).toBeGreaterThanOrEqual(3);
  });

  it('SERVER_HTML — дословно то, что вернули renderToString обеих библиотек', () => {
    expect(out.react).toBe(SERVER_HTML.react);
    expect(out.reactBoundary).toBe(SERVER_HTML.reactBoundary);
    expect(out.vue).toBe(SERVER_HTML.vue);
  });

  it('маркеры: <!-- --> между соседними текстами у React, у Vue — один текст без шва', () => {
    expect(out.react).toContain('Нажато: <!-- -->0');
    expect(out.vue).toContain('Нажато: 0');
    expect(out.reactBoundary).toContain('<!--$--><p>');
  });

  it('стриминг React: каркас — до данных, дословно; остаток — скрытый div и $RC', () => {
    expect(out.reactStream[0]).toBe(STREAM_REACT_SHELL);
    expect(out.reactStream[1]).toBe('▸ данные');
    const rest = out.reactStream.slice(2).join('');
    expect(rest.startsWith(STREAM_REACT_REST_START)).toBe(true);
    expect(rest.endsWith(STREAM_REACT_REST_END)).toBe(true);
    // Вставку откладывает сам встроенный скрипт: «не раньше чем через 300 мс после первого кадра».
    expect(rest).toContain('$RT+300');
  });

  it('стриминг Vue: по порядку, подвал ждёт отзывов, fallback на сервере не рисуется', () => {
    expect(out.vueStream).toEqual(STREAM_VUE_CHUNKS);
    expect(out.vueStream.join('')).not.toContain('Загружаем');
  });

  it('renderToString и незавершённая граница: fallback с <!--$!-->, причина — только в отладочной', () => {
    expect(out.toStringPending).toContain('<!--$!-->');
    expect(out.toStringPending).toContain('<i>ждём</i>');
    if (buildName === 'development') expect(out.toStringPending).toContain('does not support Suspense');
    else expect(out.toStringPending).toContain('<template></template>');
  });
});

// ---------------------------------------------------------------------------
// Браузер: Chromium, модуль демо + настоящие библиотеки
// ---------------------------------------------------------------------------

const ENTRY = `
import * as React from 'react';
import * as client from 'react-dom/client';
import * as Vue from 'vue';
import * as lab from './src/widgets/ssr-hydration/model/lab.ts';
window.T = { lab, React, client, Vue };
`;

async function bundle(mode: Build): Promise<string> {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      // Те же флаги, что ставит плагин Vue при сборке сайта.
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
  });
  return result.outputFiles[0].text;
}

let browser: Browser;
const bundles: Partial<Record<Build, string>> = {};

beforeAll(async () => {
  bundles.production = await bundle('production');
  bundles.development = await bundle('development');
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
});

/** Чистая страница на выдуманном адресе: всё отдаёт перехват, сеть не трогается. */
async function fresh(mode: Build): Promise<Page> {
  const page = await browser.newPage();
  await page.route('http://ssr.test/**', (route) =>
    route.request().url().endsWith('/b.js')
      ? route.fulfill({ contentType: 'text/javascript', body: bundles[mode]! })
      : route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><body><script src="/b.js"></script>' }),
  );
  await page.goto('http://ssr.test/');
  return page;
}

type Fw = 'react' | 'reactBoundary' | 'vue';

interface LabResult {
  run: HydrationRun;
  deadClick: string;
  liveClick: string;
}

/**
 * Один прогон демо: серверная разметка → (клик по мёртвой кнопке) → гидратация → клик.
 * Функция уезжает в браузер текстом, поэтому всё нужное — в аргументах.
 */
async function labRun(page: Page, fw: Fw, variant: Variant): Promise<LabResult> {
  const html = fw === 'vue' ? SERVER_HTML.vue : fw === 'react' ? SERVER_HTML.react : SERVER_HTML.reactBoundary;
  return page.evaluate(
    async ({ fw, variant, html, reactCode, vueCode }) => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const box = document.createElement('div');
      document.body.append(box);
      const spec = T.lab.VARIANTS[variant];
      T.lab.serve(box, html, spec);
      box.querySelector('button')!.click();
      const deadClick = box.querySelector('button')!.textContent;
      const done =
        fw === 'vue'
          ? await T.lab.hydrateVue(box, vueCode, spec.client, T.Vue)
          : await T.lab.hydrateReact(box, reactCode, { ...spec.client, boundary: fw === 'reactBoundary' }, {
              React: T.React,
              client: T.client,
            });
      box.querySelector('button')!.click();
      await new Promise((r) => setTimeout(r, 0));
      return { run: done.run, deadClick, liveClick: box.querySelector('button')!.textContent };
    },
    { fw, variant, html, reactCode: REACT_ORDER_CODE, vueCode: VUE_ORDER_CODE },
  );
}

const fates = (run: HydrationRun) => Object.fromEntries(run.nodes.map((n) => [n.label, n.fate]));

describe('браузер: демо гидратации — тот же модуль, продакшен-сборка', () => {
  const results = {} as Record<`${Fw}:${Variant}`, LabResult>;

  beforeAll(async () => {
    for (const variant of Object.keys(VARIANTS) as Variant[]) {
      for (const fw of ['react', 'reactBoundary', 'vue'] as Fw[]) {
        // Своя страница на каждый прогон: у Vue сообщение о несовпадении — одно на страницу.
        const page = await fresh('production');
        results[`${fw}:${variant}`] = await labRun(page, fw, variant);
        await page.close();
      }
    }
  }, 120_000);

  it('до гидратации клик ничего не делает, после — работает у всех и во всех вариантах', () => {
    for (const [key, r] of Object.entries(results)) {
      expect(r.deadClick, key).toBe('Нажато: 0');
      expect(r.liveClick, key).toBe('Нажато: 1');
    }
  });

  it('совпадение: ни один узел не пересоздан, сообщений нет', () => {
    for (const fw of ['react', 'reactBoundary', 'vue'] as Fw[]) {
      const { run } = results[`${fw}:match`];
      expect(run.nodes.every((n) => n.fate === 'kept'), fw).toBe(true);
      expect(run.created, fw).toEqual([]);
      expect(run.messages, fw).toEqual([]);
      expect(run.matchesClient, fw).toBe(true);
    }
    // React оставляет свой шов в документе и после гидратации.
    expect(results['react:match'].run.html).toContain('<!-- -->');
  });

  it('текст: React выбрасывает всё до корня (10 новых узлов), с границей — только её', () => {
    const plain = results['react:text'].run;
    expect(plain.nodes.every((n) => n.fate === 'dropped')).toBe(true);
    expect(plain.created).toHaveLength(10);
    expect(plain.messages).toHaveLength(1);
    expect(plain.messages[0]).toMatch(/Minified React error #418;.*args\[\]=text/);

    const bounded = results['reactBoundary:text'].run;
    const f = fates(bounded);
    expect([f['<section.day>'], f['<h3>'], f['<button>']]).toEqual(['kept', 'kept', 'kept']);
    expect([f['<p>'], f['<time>'], f['<!--$-->']]).toEqual(['dropped', 'dropped', 'dropped']);
    expect(bounded.created.map((c) => c.label)).toEqual(['<p>', '"Собран в "', '<time>', '"12:00:03"']);
  });

  it('текст: Vue оставляет <time>, внутри — новый текстовый узел; одна строка в консоли', () => {
    const { run } = results['vue:text'];
    const f = fates(run);
    expect(f['<time>']).toBe('kept');
    expect(f['"12:00:00"']).toBe('dropped');
    expect(run.nodes.filter((n) => n.fate !== 'kept')).toHaveLength(1);
    expect(run.created.map((c) => c.label)).toEqual(['"12:00:03"']);
    expect(run.messages).toEqual(['Hydration completed but contains mismatches.']);
  });

  it('атрибут: у обоих все узлы на месте, класс серверный, в продакшене — ни звука', () => {
    for (const fw of ['react', 'reactBoundary', 'vue'] as Fw[]) {
      const { run } = results[`${fw}:attr`];
      expect(run.nodes.every((n) => n.fate === 'kept'), fw).toBe(true);
      expect(run.messages, fw).toEqual([]);
      expect(run.matchesClient, fw).toBe(false);
      expect(run.html, fw).toContain('class="day"');
      expect(run.clientHtml, fw).toContain('class="night"');
    }
  });

  it('чужой узел: React — весь корень (или граница), Vue — сдвиг всего хвоста', () => {
    const react = results['react:extension'].run;
    expect(react.nodes.every((n) => n.fate === 'dropped')).toBe(true);
    expect(react.messages[0]).toMatch(/#418;.*args\[\]=HTML/);
    expect(react.html).not.toContain('data-ext');

    const bounded = fates(results['reactBoundary:extension'].run);
    expect([bounded['<h3>'], bounded['<button>']]).toEqual(['kept', 'kept']);

    const vue = results['vue:extension'].run;
    const f = fates(vue);
    expect([f['<section.day>'], f['<h3>']]).toEqual(['kept', 'kept']);
    expect([f['<span data-ext>'], f['<p>'], f['<button>']]).toEqual(['dropped', 'dropped', 'dropped']);
    expect(vue.messages).toEqual(['Hydration completed but contains mismatches.']);
    expect(vue.matchesClient).toBe(true);
  });

  it('текст MISMATCH_TABLE держит то, что показал прогон', () => {
    const [text, attr, ext] = MISMATCH_TABLE.rows;
    expect(text[1]).toContain('10 узлов');
    expect(attr[1]).toContain('класс остался серверным');
    expect(attr[2]).toContain('класс остался серверным');
    expect(ext[2]).toContain('сдвинулся весь хвост');
  });
});

describe('браузер: отладочная сборка называет несовпадения по именам', () => {
  const messages = {} as Record<string, string[]>;

  beforeAll(async () => {
    for (const variant of ['text', 'attr', 'extension'] as Variant[]) {
      for (const fw of ['react', 'vue'] as Fw[]) {
        const page = await fresh('development');
        messages[`${fw}:${variant}`] = (await labRun(page, fw, variant)).run.messages;
        await page.close();
      }
    }
  }, 120_000);

  it('React: текст и узел — «Hydration failed», атрибут — «won’t be patched up»', () => {
    expect(messages['react:text'][0]).toContain("Hydration failed because the server rendered text didn't match the client");
    expect(messages['react:extension'][0]).toContain("Hydration failed because the server rendered HTML didn't match the client");
    expect(messages['react:attr'].join('\n')).toContain("This won't be patched up");
  });

  it('Vue: text/class/node/children mismatch и прямое «check-only»', () => {
    expect(messages['vue:text'].join('\n')).toContain('Hydration text content mismatch');
    expect(messages['vue:attr'].join('\n')).toContain('Hydration class mismatch');
    expect(messages['vue:attr'].join('\n')).toContain('this mismatch is check-only');
    expect(messages['vue:extension'].join('\n')).toContain('Hydration node mismatch');
    expect(messages['vue:extension'].join('\n')).toContain('Hydration children mismatch');
  });
});

describe('браузер: порядок вызовов, флаги, выборочная и ленивая гидратация', () => {
  it.each(['production', 'development'] as const)('HYDRATE_ORDER: журнал обоих листингов (%s)', async (mode) => {
    const page = await fresh(mode);
    const result = await page.evaluate(
      async ({ reactCode, vueCode }) => {
        const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
        const Async = Object.getPrototypeOf(async () => {}).constructor;
        const out: Record<string, { log: string[]; same: boolean; text: string }> = {};

        for (const fw of ['react', 'vue']) {
          const container = document.createElement('div');
          container.innerHTML = fw === 'react' ? '<button>Нажато: <!-- -->0</button>' : '<button>Нажато: 0</button>';
          document.body.append(container);
          const button = container.firstChild;
          const log: string[] = [];
          const push = (line: string) => void log.push(line);
          if (fw === 'react') {
            const R = T.React;
            await new Async('h', 'useState', 'useEffect', 'useLayoutEffect', 'hydrateRoot', 'container', 'button', 'log', reactCode)(
              R.createElement, R.useState, R.useEffect, R.useLayoutEffect, T.client.hydrateRoot, container, button, push,
            );
          } else {
            const V = T.Vue;
            await new Async('h', 'ref', 'onBeforeMount', 'onMounted', 'createSSRApp', 'container', 'button', 'log', vueCode)(
              V.h, V.ref, V.onBeforeMount, V.onMounted, V.createSSRApp, container, button, push,
            );
          }
          const snapshot = [...log];
          await new Promise((r) => setTimeout(r, 0));
          out[fw] = { log: snapshot, same: container.firstChild === button, text: container.textContent ?? '' };
        }
        return out;
      },
      { reactCode: HYDRATE_ORDER_REACT, vueCode: HYDRATE_ORDER_VUE },
    );
    await page.close();

    expect(result.react.log).toEqual(HYDRATE_ORDER_LOG.react);
    expect(result.vue.log).toEqual(HYDRATE_ORDER_LOG.vue);
    for (const fw of ['react', 'vue']) {
      expect(result[fw].same, fw).toBe(true);
      expect(result[fw].text, fw).toBe('Нажато: 1');
    }
  });

  it('Vue молчит о втором несовпадении на той же странице', async () => {
    const page = await fresh('production');
    const counts = await page.evaluate(async (vueCode) => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: number[] = [];
      for (let i = 0; i < 2; i++) {
        const box = document.createElement('div');
        document.body.append(box);
        const spec = T.lab.VARIANTS.text;
        T.lab.serve(box, '<section class="day"><h3>Заказ №42</h3><p>Собран в <time>12:00:00</time></p><button>Нажато: 0</button></section>', spec);
        const done = await T.lab.hydrateVue(box, vueCode, spec.client, T.Vue);
        out.push(done.run.messages.length, done.run.created.length);
      }
      return out;
    }, VUE_ORDER_CODE);
    await page.close();
    // Первый раз: одно сообщение, один новый узел. Второй: узел так же заменён — а сообщения нет.
    expect(counts).toEqual([1, 1, 0, 1]);
  });

  it('SILENCE: suppressHydrationWarning оставляет серверный текст, data-allow-mismatch — клиентский', async () => {
    const lines = SILENCE_CODE.split('\n').filter((line) => line.startsWith('h('));
    expect(lines).toHaveLength(2);
    const page = await fresh('production');
    const result = await page.evaluate(
      async ({ reactLine, vueLine }) => {
        const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
        const tick = () => new Promise((r) => setTimeout(r, 30));
        const errors: string[] = [];
        const messages: string[] = [];

        const r = document.createElement('div');
        r.innerHTML = '<p>Собран в <time>12:00:00</time></p>';
        document.body.append(r);
        const time = new Function('h', 'stamp', `return ${reactLine}`)(T.React.createElement, '12:00:03');
        T.client.hydrateRoot(r, T.React.createElement('p', null, 'Собран в ', time), {
          onRecoverableError: (e: Error) => void errors.push(e.message),
        });
        await tick();

        const v = document.createElement('div');
        v.innerHTML = '<p>Собран в <time data-allow-mismatch="text">12:00:00</time></p>';
        document.body.append(v);
        const error = console.error;
        console.error = (...a: unknown[]) => void messages.push(String(a[0]));
        const vTime = () => new Function('h', 'props', `return ${vueLine}`)(T.Vue.h, { stamp: '12:00:03' });
        T.Vue.createSSRApp({ render: () => T.Vue.h('p', ['Собран в ', vTime()]) }).mount(v);
        console.error = error;
        await tick();

        // Глубина действия: флаг на родителе
        const r2 = document.createElement('div');
        r2.innerHTML = '<p>Собран в <time>12:00:00</time></p>';
        document.body.append(r2);
        const parentErrors: string[] = [];
        T.client.hydrateRoot(
          r2,
          T.React.createElement('p', { suppressHydrationWarning: true }, 'Собран в ', T.React.createElement('time', null, '12:00:03')),
          { onRecoverableError: (e: Error) => void parentErrors.push(e.message) },
        );
        await tick();
        const v2 = document.createElement('div');
        v2.innerHTML = '<p data-allow-mismatch="text">Собран в <time>12:00:00</time></p>';
        document.body.append(v2);
        const parentMessages: string[] = [];
        console.error = (...a: unknown[]) => void parentMessages.push(String(a[0]));
        T.Vue.createSSRApp({
          render: () => T.Vue.h('p', { 'data-allow-mismatch': 'text' }, ['Собран в ', T.Vue.h('time', '12:00:03')]),
        }).mount(v2);
        console.error = error;

        return {
          react: r.textContent, errors, vue: v.textContent, messages,
          parentReact: parentErrors.length, parentVue: parentMessages.length, parentVueText: v2.textContent,
        };
      },
      { reactLine: lines[0], vueLine: lines[1] },
    );
    await page.close();

    expect(result.react).toBe('Собран в 12:00:00');
    expect(result.errors).toEqual([]);
    expect(result.vue).toBe('Собран в 12:00:03');
    expect(result.messages).toEqual([]);
    expect(result.parentReact).toBe(1);   // на родителе React не спасает
    expect(result.parentVue).toBe(0);     // а Vue ищет атрибут у предков
    expect(result.parentVueText).toBe('Собран в 12:00:03');
    expect(SILENCE.rows[0][2]).toContain('серверное');
    expect(SILENCE.rows[1][2]).toContain('клиентское');
  });

  it('SELECTIVE_CODE: тронутая граница — первой; клик до приезда кода потерян', async () => {
    const page = await fresh('production');
    const result = await page.evaluate(async (code) => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const R = T.React;
      const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
      const html =
        '<main><!--$--><button id="reviews">Reviews: <!-- -->0</button><!--/$-->' +
        '<!--$--><button id="similar">Similar: <!-- -->0</button><!--/$--></main>';

      async function scenario(loadSimilarFirst: boolean) {
        const log: string[] = [];
        const errors: string[] = [];
        const make = (name: string) =>
          function Part() {
            const [n, setN] = R.useState(0);
            log.push(`тело ${name}`);
            return R.createElement('button', { id: name.toLowerCase(), onClick: () => { log.push(`onClick ${name}`); setN(n + 1); } }, `${name}: `, n);
          };
        const gates: Record<string, (value: unknown) => void> = {};
        const gate = (name: string) => new Promise((resolve) => (gates[name] = () => resolve({ default: make(name) })));
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.append(container);
        const reviewsGate = gate('Reviews');
        const similarGate = gate('Similar');
        const hydrateRoot = (el: Element, node: unknown) =>
          T.client.hydrateRoot(el, node, { onRecoverableError: (e: Error) => void errors.push(e.message) });
        new Function('h', 'lazy', 'Suspense', 'hydrateRoot', 'container', 'loadReviews', 'loadSimilar', code)(
          R.createElement, R.lazy, R.Suspense, hydrateRoot, container, () => reviewsGate, () => similarGate,
        );
        await tick(30);
        if (loadSimilarFirst) {
          // Код обоих уже здесь, гидратация до границ ещё не дошла.
          gates.Reviews(null);
          gates.Similar(null);
          await Promise.resolve();
          await Promise.resolve();
          (container.querySelector('#similar') as HTMLElement).click();
          await tick(30);
        } else {
          (container.querySelector('#similar') as HTMLElement).click();
          await tick(20);
          gates.Reviews(null);
          await tick(20);
          gates.Similar(null);
          await tick(30);
        }
        return { log, errors, text: container.querySelector('#similar')!.textContent };
      }

      return { loaded: await scenario(true), pending: await scenario(false) };
    }, SELECTIVE_CODE);
    await page.close();

    expect(result.loaded.errors).toEqual([]);
    expect(result.loaded.log).toEqual(['тело Similar', 'onClick Similar', 'тело Similar', 'тело Reviews']);
    expect(result.pending.errors).toEqual([]);
    expect(result.pending.log).not.toContain('onClick Similar');
    expect(result.pending.log).toEqual(['тело Reviews', 'тело Similar']);
    expect(result.pending.text).toBe('Similar: 0');
  });

  it('LAZY_VUE_CODE: loader — при монтировании, гидратация — по клику, клик повторён', async () => {
    const page = await fresh('production');
    const result = await page.evaluate(async (code) => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const V = T.Vue;
      const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
      const log: string[] = [];
      const Impl = {
        setup() {
          log.push('setup Reviews');
          const n = V.ref(0);
          V.onMounted(() => log.push('onMounted Reviews'));
          return () => V.h('button', { onClick: () => { log.push('onClick'); n.value++; } }, `Нажато: ${n.value}`);
        },
      };
      const loadReviews = () => (log.push('loader'), Promise.resolve(Impl));
      const Reviews = new Function('defineAsyncComponent', 'hydrateOnInteraction', 'loadReviews', `${code}\nreturn Reviews;`)(
        V.defineAsyncComponent, V.hydrateOnInteraction, loadReviews,
      );
      const container = document.createElement('div');
      container.innerHTML = '<main><h1>Товар</h1><button>Нажато: 0</button></main>';
      document.body.append(container);
      const button = container.querySelector('button')!;
      V.createSSRApp({ render: () => V.h('main', [V.h('h1', 'Товар'), V.h(Reviews)]) }).mount(container);
      log.push('mount вернул');
      await tick(30);
      button.click();
      log.push('клик по кнопке отзывов');
      await tick(30);

      // hydrateOnVisible: тот же вопрос — когда loader и когда setup
      const visibleLog: string[] = [];
      const Far = V.defineAsyncComponent({
        loader: () => (visibleLog.push('loader'), Promise.resolve({ setup: () => (visibleLog.push('setup'), () => V.h('p', { style: 'margin-top:3000px' }, 'низ')) })),
        hydrate: V.hydrateOnVisible(),
      });
      const far = document.createElement('div');
      far.innerHTML = '<p style="margin-top:3000px">низ</p>';
      document.body.append(far);
      V.createSSRApp({ render: () => V.h(Far) }).mount(far);
      visibleLog.push('mount вернул');
      await tick(100);
      visibleLog.push('прокрутка');
      far.querySelector('p')!.scrollIntoView();
      await tick(150);

      return { log, same: container.querySelector('button') === button, text: button.textContent, visibleLog };
    }, LAZY_VUE_CODE);
    await page.close();

    expect(result.log).toEqual(LAZY_VUE_LOG);
    expect(result.same).toBe(true);
    expect(result.text).toBe('Нажато: 1');
    expect(result.visibleLog).toEqual(['loader', 'mount вернул', 'прокрутка', 'setup']);
  });

  it('тонкое место 03: лишний узел перед корнем — Vue удваивает, React пропускает', async () => {
    const pitfall = PITFALLS.find((p) => p.n === '03')!;
    const code = pitfall.code!;
    const expected = /\/\/ '(.*)'$/.exec(code)![1];
    const page = await fresh('production');
    const result = await page.evaluate(
      async ({ code }) => {
        const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
        const tick = () => new Promise((r) => setTimeout(r, 30));
        const container = document.createElement('div');
        document.body.append(container);
        const error = console.error;
        console.error = () => {};
        const vue = new Function('container', 'createSSRApp', 'h', `${code.replace(/\n[^\n]*$/, '')}\nreturn container.innerHTML;`)(
          container, T.Vue.createSSRApp, T.Vue.h,
        );
        console.error = error;

        const r = document.createElement('div');
        r.innerHTML = '<span>чужой</span><p>x</p>';
        document.body.append(r);
        const p = r.lastChild;
        const errors: string[] = [];
        T.client.hydrateRoot(r, T.React.createElement('p', null, 'x'), { onRecoverableError: (e: Error) => void errors.push(e.message) });
        await tick();

        // Невалидная вложенность: парсер разрывает <p>, Vue оставляет хвосты
        const n = document.createElement('div');
        n.innerHTML = '<p><div>x</div></p>';
        document.body.append(n);
        const parsed = n.innerHTML;
        console.error = () => {};
        T.Vue.createSSRApp({ render: () => T.Vue.h('p', [T.Vue.h('div', 'x')]) }).mount(n);
        console.error = error;
        const rn = document.createElement('div');
        rn.innerHTML = '<p><div>x</div></p>';
        document.body.append(rn);
        const nestErrors: string[] = [];
        T.client.hydrateRoot(rn, T.React.createElement('p', null, T.React.createElement('div', null, 'x')), {
          onRecoverableError: (e: Error) => void nestErrors.push(e.message),
        });
        await tick();

        return { vue, react: r.innerHTML, reactKept: r.contains(p), errors, parsed, nestVue: n.innerHTML, nestReact: rn.innerHTML, nestErrors };
      },
      { code },
    );
    await page.close();

    expect(result.vue).toBe(expected);
    expect(result.react).toBe('<span>чужой</span><p>x</p>');
    expect(result.reactKept).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.parsed).toBe('<p></p><div>x</div><p></p>');
    expect(result.nestVue).toBe('<p><div>x</div></p><div>x</div><p></p>');
    expect(result.nestReact).toBe('<p><div>x</div></p>');
    expect(result.nestErrors[0]).toMatch(/#418/);
  });

  it('React 19: узлы расширений в начале и конце <body> при гидратации документа прощены', async () => {
    const page = await fresh('production');
    const result = await page.evaluate(async () => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const h = T.React.createElement;
      const errors: string[] = [];
      document.body.innerHTML = '<div id="ext-top">расширение</div><main><p>x</p></main><div id="ext-end">расширение</div>';
      const main = document.querySelector('main');
      T.client.hydrateRoot(document, h('html', null, h('head', null), h('body', null, h('main', null, h('p', null, 'x')))), {
        onRecoverableError: (e: Error) => void errors.push(e.message),
      });
      await new Promise((r) => setTimeout(r, 50));
      return { errors, kept: document.contains(main), top: !!document.getElementById('ext-top'), end: !!document.getElementById('ext-end') };
    });
    await page.close();
    expect(result).toEqual({ errors: [], kept: true, top: true, end: true });
  });

  it('тонкое место 05: без onRecoverableError несовпадение приходит в window.onerror', async () => {
    const page = await fresh('production');
    const seen = await page.evaluate(async () => {
      const T = (window as unknown as { T: any }).T;   // eslint-disable-line @typescript-eslint/no-explicit-any
      const out: string[] = [];
      window.addEventListener('error', (e) => {
        out.push(e.message);
        e.preventDefault();
      });
      const box = document.createElement('div');
      box.innerHTML = '<p>сервер</p>';
      document.body.append(box);
      T.client.hydrateRoot(box, T.React.createElement('p', null, 'клиент'));
      await new Promise((r) => setTimeout(r, 50));
      return out;
    });
    await page.close();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^Uncaught Error: Minified React error #418/);
  });
});

// ---------------------------------------------------------------------------
// Исходники: то, что тема утверждает по чтению кода
// ---------------------------------------------------------------------------

describe('исходники: острова Astro и сообщение Vue', () => {
  const read = (path: string) => readFileSync(new URL(`../../node_modules/${path}`, import.meta.url), 'utf8');

  it('client:visible грузит код острова только в колбэке IntersectionObserver', () => {
    const src = read('astro/dist/runtime/client/visible.js');
    expect(src).toContain('new IntersectionObserver');
    const callback = src.slice(src.indexOf('const cb'), src.indexOf('new IntersectionObserver'));
    expect(callback).toContain('await load()');
  });

  it('каждый Vue-остров Astro — своё приложение createSSRApp', () => {
    const src = read('@astrojs/vue/dist/client.js');
    expect(src).toMatch(/isHydrate \? createSSRApp : createApp/);
    expect(src).toContain('app.mount(element, isHydrate)');
  });

  it('Vue: одно сообщение на страницу — флаг в модуле', () => {
    const src = read('@vue/runtime-core/dist/runtime-core.cjs.prod.js');
    expect(src).toMatch(/if \(hasLoggedMismatchError\) \{\s*return;/);
  });
});
