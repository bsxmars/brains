import { createRequire } from 'node:module';
import { compileScript, parse } from '@vue/compiler-sfc';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/suspense-errors/data';
import { loadBoundary } from '@/widgets/boundary-lab/model/run';
import type { Mode, Status, TreeNode } from '@/widgets/boundary-lab/model/types';

/**
 * Тема «Suspense и границы ошибок».
 *
 * Каждый пример кода из темы исполняется здесь как есть:
 *   — JSX снимается `typescript.transpileModule` (`jsx: react-jsx`) и монтируется в React 19.3
 *     поверх happy-dom; имена, которых в примере нет (`fetchUser`, `log`, `report`…), тест
 *     подкладывает параметрами;
 *   — SFC компилируются `@vue/compiler-sfc` (`inlineTemplate`) и монтируются в Vue 3.5;
 *   — учебная модель `BOUNDARY_CODE` сверяется с React и Vue на всех 243 сочетаниях
 *     состояний демо-дерева и на тех же сочетаниях в режиме «волнами».
 *
 * Промисы данных выполняет сам тест — таймеров нет. Где важен итог, React работает под `act`;
 * где важны колбэки корня — без `act` (под ним `onUncaughtError` не вызывается), и тогда тест
 * ждёт рендера, пока не выполнится условие.
 *
 * Глобалы happy-dom ставятся до загрузки `react-dom` и `vue` (обе — через `require`, чтобы
 * копия была одна, как в `forms.test.ts`).
 */

const require = createRequire(import.meta.url);

// ─── DOM, React, Vue ───────────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = [
  'window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'Event',
  'MouseEvent', 'ErrorEvent', 'Document', 'SVGElement', 'MutationObserver',
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
const DOC_CLASS = Object.getPrototypeOf(win.document).constructor;
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : key === 'Document' ? DOC_CLASS : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
const g = globalThis as Record<string, unknown>;

// Vue печатает «Suspense — экспериментальный» один раз за процесс через console.info.
const infos: string[] = [];
const origInfo = console.info;
console.info = (...a: unknown[]) => void infos.push(String(a[0]));

const React = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const Vue = require('vue') as typeof import('vue');
const { act, createElement: h } = React;

afterAll(() => {
  console.info = origInfo;
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete g[key];
  }
});

const doc = win.document as unknown as Document;
const container = () => {
  const div = doc.createElement('div');
  doc.body.appendChild(div);
  return div;
};
const withAct = (on: boolean) => {
  g.IS_REACT_ACT_ENVIRONMENT = on;
};
const macrotask = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, limit = 3000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > limit) throw new Error('не дождались');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/**
 * Что видно: текст каждого элемента (соседние текстовые узлы склеены), кроме спрятанных
 * `display: none` и кнопок. Демо-дерево зовёт с `merge = false`: заглушки там — голые строки,
 * и две соседние заглушки иначе слились бы в одну.
 */
function visible(root: Element, merge = true): string[] {
  const out: string[] = [];
  const walk = (parent: Node) => {
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    };
    parent.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        buf += n.nodeValue ?? '';
        if (!merge) flush();
      }
      else if (n.nodeType === 1) {
        flush();
        const el = n as HTMLElement;
        if (el.style?.display !== 'none' && el.tagName !== 'BUTTON') walk(el);
      }
    });
    flush();
  };
  walk(root);
  return out;
}

/** Промис, который выполняет тест: `fetch*` из примеров. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

/** JSX из темы → значения, названные в `names`. Имена из `scope` приходят параметрами. */
function runJsx(code: string, names: string[], scope: Record<string, unknown>, runtime?: unknown) {
  const cjs = ts.transpileModule(`${code}\nexport { ${names.join(', ')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string) => (id === 'react/jsx-runtime' && runtime ? runtime : require(id));
  new Function('require', 'exports', ...Object.keys(scope), cjs)(req, exports, ...Object.values(scope));
  return exports;
}

/** JSX-выражение из темы (а не объявления) → элемент. */
function jsxExpr(code: string, scope: Record<string, unknown>, runtime?: unknown) {
  return runJsx(`const __el = (${code});`, ['__el'], scope, runtime).__el;
}

/** SFC из темы → компонент Vue. `modules` подменяют импорты вроде `./api`. */
function sfc(source: string, modules: Record<string, unknown> = {}) {
  const { descriptor } = parse(source);
  const out = compileScript(descriptor, { id: Math.random().toString(36).slice(2), inlineTemplate: true }).content;
  const cjs = ts.transpileModule(out, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  const req = (id: string) => (id in modules ? modules[id] : require(id));
  new Function('require', 'exports', cjs)(req, exports);
  return exports.default as import('vue').Component;
}

type BoundaryProps = { fallback?: unknown; onError?: (e: Error, stack: string) => void; children?: unknown };
const { ErrorBoundary } = runJsx(t.BOUNDARY_CLASS_CODE, ['ErrorBoundary'], { Component: React.Component }) as {
  ErrorBoundary: typeof React.Component<BoundaryProps> & { getDerivedStateFromError(e: Error): unknown };
};

/** Та же граница — с типом, который понимает `createElement`. */
const EB = ErrorBoundary as unknown as React.ComponentType<BoundaryProps & { key?: number }>;

describe('стенд', () => {
  it('версии, на которых снята тема', () => {
    expect(React.version).toBe('19.3.0');
    expect(Vue.version).toBe('3.5.42');
  });
});

// ─── Раздел 1. Бросок и ближайшая граница ──────────────────────────────────────────────────

describe('USE_CODE: бросок, заглушка, прогрев, повтор', () => {
  it('вызовы и экран в момент каждого вызова — USE_ROWS', async () => {
    withAct(true);
    const el = container();
    const calls: [string, string][] = [];
    const user = deferred<{ name: string }>();
    const { Page } = runJsx(t.USE_CODE, ['Page'], {
      use: React.use,
      Suspense: React.Suspense,
      fetchUser: () => user.promise,
      log: (name: string) => calls.push([name, visible(el).join(' | ')]),
    }) as { Page: React.FC };
    const root = createRoot(el);
    await act(async () => root.render(h(Page)));
    // 1: Profile на пустом экране; 2: коммит заглушки; 3: прогрев — Profile и Stats при заглушке
    expect(calls).toEqual([
      ['Profile', ''],
      ['Profile', 'Загружаем профиль…'],
      ['Stats', 'Загружаем профиль…'],
    ]);
    calls.length = 0;
    await act(async () => user.resolve({ name: 'Ада' }));
    expect(calls.map((c) => c[0])).toEqual(['Profile', 'Stats']);
    expect(visible(el)).toEqual(['Ада', 'Подписчиков: 12']);
    expect(t.USE_ROWS.map((r) => r.calls)).toEqual(['`Profile`', '—', '`Profile`, `Stats`', '`Profile`, `Stats`']);
    root.unmount();
  });

  it('без Suspense над ждущим — на экране ничего, даже соседи (S1_FACTS)', async () => {
    withAct(true);
    const el = container();
    const never = new Promise(() => {});
    const Wait = () => React.use(never) as never;
    const root = createRoot(el);
    await act(async () => root.render(h('main', null, h('p', null, 'шапка'), h(Wait))));
    expect(el.innerHTML).toBe('');
    root.unmount();
  });
});

// ─── Раздел 2. Стабильный промис ───────────────────────────────────────────────────────────

describe('UNSTABLE_CODE против CACHED_CODE', () => {
  async function run(code: string) {
    withAct(true);
    const pending: (() => void)[] = [];
    let renders = 0;
    const fetchUser = (id: number) =>
      new Promise((r) => pending.push(() => r({ name: `Ада #${id}` })));
    const { Profile } = runJsx(code, ['Profile'], {
      use: (p: Promise<unknown>) => {
        renders++;
        return React.use(p);
      },
      fetchUser,
    }) as { Profile: React.FC<{ id: number }> };
    const el = container();
    const root = createRoot(el);
    await act(async () =>
      root.render(h(React.Suspense, { fallback: h('p', null, 'загрузка') }, h(Profile, { id: 1 }))),
    );
    const rows = [`рендеров ${renders} · промисов ${pending.length} · заглушка`];
    for (let k = 0; k < 3; k++) {
      const next = pending[k];
      if (!next || visible(el)[0] !== 'загрузка') break;
      await act(async () => next());
      const shown = visible(el)[0] === 'загрузка' ? 'заглушка' : `**«${visible(el)[0]}»**`;
      rows.push(`рендеров ${renders} · промисов ${pending.length} · ${shown}`);
    }
    root.unmount();
    return rows;
  }

  it('без кеша — промис за промисом, вечная заглушка', async () => {
    expect(await run(t.UNSTABLE_CODE)).toEqual(t.UNSTABLE_ROWS.map((r) => r.bad));
  });

  it('с кешем — один промис, содержимое после первого ответа', async () => {
    expect(await run(t.CACHED_CODE)).toEqual(t.UNSTABLE_ROWS.map((r) => r.good).filter((x) => x !== '—'));
  });

  it('UNCACHED_WARNING: use(Promise.resolve(…)) — предупреждение, и содержимое показано', async () => {
    withAct(true);
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(String(a[0]));
    const Quick = () => h('p', null, React.use(Promise.resolve('сразу')) as string);
    const el = container();
    const root = createRoot(el);
    await act(async () => root.render(h(React.Suspense, { fallback: h('p', null, 'загрузка') }, h(Quick))));
    console.error = orig;
    expect(errors.some((e) => e.startsWith('A component was suspended by an uncached promise'))).toBe(true);
    expect(t.UNCACHED_WARNING).toContain('A component was suspended by an uncached promise');
    expect(visible(el)).toEqual(['сразу']);
    root.unmount();
  });
});

// ─── Раздел 3. Водопад ─────────────────────────────────────────────────────────────────────

describe('WATERFALL_CODE и PREFETCH_CODE', () => {
  async function waves(make: (scope: Record<string, unknown>) => React.ReactElement) {
    withAct(true);
    const cache = new Map<string, Promise<unknown>>();
    const fresh: string[] = [];
    const resolvers: (() => void)[] = [];
    const load = (key: string, value: unknown) => {
      if (!cache.has(key)) {
        fresh.push(key.split(':')[0]);
        cache.set(key, new Promise((r) => resolvers.push(() => r(value))));
      }
      return cache.get(key)!;
    };
    const scope = {
      use: React.use,
      Suspense: React.Suspense,
      getUser: (id: number) => load(`user:${id}`, { name: 'Ада' }),
      getPosts: (id: number) => load(`posts:${id}`, [1, 2, 3]),
    };
    const el = container();
    const root = createRoot(el);
    await act(async () => root.render(make(scope)));
    const out: { started: string[]; shown: string[] }[] = [];
    for (;;) {
      const started = fresh.splice(0);
      out.push({ started, shown: visible(el) });
      if (!started.length) break;
      await act(async () => resolvers.splice(0).forEach((r) => r()));
    }
    root.unmount();
    return out;
  }

  it('вложенная граница — запросы по очереди, две волны (WATERFALL_ROWS)', async () => {
    const res = await waves((scope) => {
      const { UserPage } = runJsx(t.WATERFALL_CODE, ['UserPage'], scope) as { UserPage: React.FC<{ id: number }> };
      return h(React.Suspense, { fallback: h('p', null, 'Профиль…') }, h(UserPage, { id: 1 }));
    });
    expect(res).toEqual([
      { started: ['user'], shown: ['Профиль…'] },
      { started: ['posts'], shown: ['Ада', 'Посты…'] },
      { started: [], shown: ['Ада', 'Постов: 3'] },
    ]);
    expect(t.WATERFALL_ROWS[0]).toMatchObject({ w1: '`user`', w2: '`posts`', trips: '2' });
  });

  it('запросы подняты в UserRoute — одна волна', async () => {
    const res = await waves((scope) => {
      const { UserPage } = runJsx(t.WATERFALL_CODE, ['UserPage'], scope);
      const { UserRoute } = runJsx(t.PREFETCH_CODE, ['UserRoute'], { ...scope, UserPage }) as {
        UserRoute: React.FC<{ id: number }>;
      };
      return h(UserRoute, { id: 1 });
    });
    expect(res).toEqual([
      { started: ['user', 'posts'], shown: ['Профиль…'] },
      { started: [], shown: ['Ада', 'Постов: 3'] },
    ]);
    expect(t.WATERFALL_ROWS[1]).toMatchObject({ w1: '`user`, `posts`', w2: '—', trips: '1' });
  });
});

// ─── Раздел 4. Переходы ────────────────────────────────────────────────────────────────────

describe('TRANSITION_CODE: обычное обновление против перехода', () => {
  async function run(button: 'Обычно' | 'Переходом') {
    withAct(true);
    const users: Record<number, ReturnType<typeof deferred<{ name: string }>>> = {
      1: deferred(),
      2: deferred(),
    };
    const { Profile } = runJsx(t.CACHED_CODE, ['Profile'], {
      use: React.use,
      fetchUser: (id: number) => users[id].promise,
    });
    const { App } = runJsx(t.TRANSITION_CODE, ['App'], {
      useState: React.useState,
      useTransition: React.useTransition,
      Suspense: React.Suspense,
      Profile,
    }) as { App: React.FC };
    const el = container();
    const root = createRoot(el);
    await act(async () => root.render(h(App)));
    await act(async () => users[1].resolve({ name: 'Ада' }));
    const shown = [visible(el)];
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === button)!;
    await act(async () => void btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event));
    shown.push(visible(el));
    const hidden = [...el.querySelectorAll('h2')].map((x) => (x as HTMLElement).getAttribute('style'));
    await act(async () => users[2].resolve({ name: 'Грейс' }));
    shown.push(visible(el));
    root.unmount();
    return { shown, hidden };
  }

  it('обычно: заглушка, «Ада» спрятана display: none !important, потом «Грейс»', async () => {
    const { shown, hidden } = await run('Обычно');
    expect(shown).toEqual([['Ада'], ['Загружаем профиль…'], ['Грейс']]);
    expect(hidden).toEqual(['display: none !important;']);
    expect(t.TRANSITION_NOTE).toContain('display: none !important');
  });

  it('переходом: старое на месте и isPending, потом «Грейс»', async () => {
    const { shown } = await run('Переходом');
    expect(shown).toEqual([['Ада'], ['Обновляем…', 'Ада'], ['Грейс']]);
  });
});

// ─── Раздел 5. Граница ошибок ──────────────────────────────────────────────────────────────

describe('BOUNDARY_CLASS_CODE: порядок вызовов', () => {
  it('Feed бросает → повтор корня → getDerivedStateFromError → fallback → коммит: onCaughtError, componentDidCatch', async () => {
    withAct(false);
    const log: string[] = [];
    class Spy extends ErrorBoundary {
      static getDerivedStateFromError(e: Error) {
        log.push('getDerivedStateFromError');
        return ErrorBoundary.getDerivedStateFromError(e);
      }
      render() {
        if ((this.state as { error: unknown }).error) log.push('render → fallback');
        return super.render();
      }
    }
    const Header = () => (log.push('Header'), h('p', null, 'шапка'));
    const Feed = () => {
      log.push('Feed бросает');
      throw new Error('бум');
    };
    const el = container();
    const root = createRoot(el, { onCaughtError: () => log.push('root.onCaughtError') });
    const tree = jsxExpr(t.BOUNDARY_USE_CODE, {
      ErrorBoundary: Spy,
      Feed,
      report: () => log.push('componentDidCatch'),
    });
    root.render(h('main', null, h(Header), tree as React.ReactElement));
    await until(() => log.includes('componentDidCatch'));
    expect(visible(el)).toEqual(['шапка', 'Ленту показать не удалось']);
    // Шапка рендерится дважды: React повторил рендер всего корня
    expect(log.filter((x) => x === 'Header')).toHaveLength(2);
    const order = log.filter((x, i) => x !== 'Header' && x !== log[i - 1]);
    const lastPass = order.slice(order.lastIndexOf('Feed бросает'));
    expect(lastPass).toEqual(t.ERROR_ORDER_CHIPS.filter((c) => c.tone !== 'dashed' && c.tone !== 'ink').map((c) => c.label));
    root.unmount();
  });

  it('повтор прошёл — onRecoverableError с исходной ошибкой в cause (ERROR_ORDER_NOTE)', async () => {
    withAct(false);
    let n = 0;
    const seen: Error[] = [];
    const Flaky = () => {
      n++;
      if (n === 1) throw new Error('гонка');
      return h('p', null, 'ок');
    };
    const el = container();
    const root = createRoot(el, { onRecoverableError: (e) => void seen.push(e as Error) });
    root.render(h(Flaky));
    await until(() => seen.length > 0);
    expect(visible(el)).toEqual(['ок']);
    expect(seen[0].message).toMatch(/^There was an error during concurrent rendering but React was able to recover/);
    expect((seen[0].cause as Error).message).toBe('гонка');
    expect(t.ERROR_ORDER_NOTE).toContain('There was an error during concurrent rendering but React was able to recover');
    root.unmount();
  });
});

describe('что граница не ловит — NOT_CAUGHT_ROWS', () => {
  it('отклонённый промис в use: сначала заглушка Suspense, потом граница ошибок', async () => {
    withAct(false);
    const rejected = Promise.reject(new Error('404'));
    rejected.catch(() => {});
    const Use = () => h('p', null, React.use(rejected) as string);
    const el = container();
    const root = createRoot(el, { onCaughtError: () => {} });
    root.render(
      h(EB, { fallback: h('p', null, 'ошибка') },
        h(React.Suspense, { fallback: h('p', null, 'загрузка') }, h(Use))),
    );
    await until(() => visible(el).length > 0);
    expect(visible(el)).toEqual(['загрузка']);
    await until(() => visible(el)[0] === 'ошибка');
    root.unmount();
  });

  it('обработчик события: граница молчит, ошибка — событием error у window', async () => {
    withAct(false);
    const errs: string[] = [];
    const onErr = (e: Event) => {
      errs.push((e as ErrorEvent).error?.message);
      e.preventDefault();
    };
    win.addEventListener('error', onErr as never);
    const orig = console.error;
    console.error = () => {};
    const Btn = () =>
      h('button', { onClick: () => { throw new Error('клик'); } }, 'кнопка');
    const el = container();
    const root = createRoot(el);
    root.render(h(EB, { fallback: h('p', null, 'ошибка') }, h('p', null, 'лента'), h(Btn)));
    await until(() => el.querySelector('button') !== null);
    el.querySelector('button')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);
    await macrotask();
    console.error = orig;
    win.removeEventListener('error', onErr as never);
    expect(errs).toEqual(['клик']);
    expect(visible(el)).toEqual(['лента']);
    root.unmount();
  });

  it('асинхронный код и таймер: граница молчит, ошибка остаётся у того, кто вызвал колбэк', async () => {
    withAct(true);
    const timers: (() => void)[] = [];
    let later!: Promise<unknown>;
    const Comp = () => {
      React.useEffect(() => {
        later = Promise.resolve().then(() => {
          throw new Error('асинхронно');
        });
        later.catch(() => {}); // без этого — unhandledrejection, который роняет прогон
        timers.push(() => {
          throw new Error('таймер');
        });
      }, []);
      return h('p', null, 'жив');
    };
    const el = container();
    const root = createRoot(el);
    await act(async () => root.render(h(EB, { fallback: h('p', null, 'ошибка') }, h(Comp))));
    await expect(later).rejects.toThrow('асинхронно');
    expect(() => timers[0]()).toThrow('таймер');
    await act(async () => {});
    expect(visible(el)).toEqual(['жив']);
    root.unmount();
  });

  it('упала заглушка границы — ловит граница выше', async () => {
    withAct(true);
    const Broken = () => {
      throw new Error('заглушка сломана');
    };
    const Feed = () => {
      throw new Error('бум');
    };
    const el = container();
    const root = createRoot(el, { onCaughtError: () => {} });
    await act(async () =>
      root.render(
        h(EB, { fallback: h('p', null, 'внешняя') },
          h(EB, { fallback: h(Broken) }, h(Feed))),
      ),
    );
    expect(visible(el)).toEqual(['внешняя']);
    root.unmount();
  });
});

describe('FORWARD_CODE: асинхронная ошибка, принесённая в рендер', () => {
  it('setState(() => { throw }) — граница ловит, onError получает ту же ошибку', async () => {
    withAct(true);
    const err = new Error('не загрузилось');
    const got: Error[] = [];
    const { Feed } = runJsx(t.FORWARD_CODE, ['Feed'], {
      useState: React.useState,
      useEffect: React.useEffect,
      loadMore: () => Promise.reject(err),
    }) as { Feed: React.FC };
    const el = container();
    const root = createRoot(el, { onCaughtError: () => {} });
    await act(async () =>
      root.render(h(EB, { fallback: h('p', null, 'ошибка'), onError: (e: Error) => void got.push(e) }, h(Feed))),
    );
    expect(visible(el)).toEqual(['ошибка']);
    expect(got).toEqual([err]);
    root.unmount();
  });
});

describe('PITFALLS 04: сброс границы через key', () => {
  it('после ошибки граница в заглушке; новый key — содержимое вернулось', async () => {
    withAct(true);
    const Feed = ({ id }: { id: number }) => {
      if (id === 1) throw new Error('бум');
      return h('p', null, `лента ${id}`);
    };
    const el = container();
    const root = createRoot(el, { onCaughtError: () => {} });
    const tree = (id: number, key: number) =>
      h(EB, { key, fallback: h('p', null, 'ошибка') }, h(Feed, { id }));
    await act(async () => root.render(tree(1, 1)));
    expect(visible(el)).toEqual(['ошибка']);
    await act(async () => root.render(tree(2, 1)));
    expect(visible(el)).toEqual(['ошибка']); // та же граница — так и висит
    await act(async () => root.render(tree(2, 2)));
    expect(visible(el)).toEqual(['лента 2']);
    root.unmount();
  });
});

// ─── Раздел 6. Ошибки у корня ──────────────────────────────────────────────────────────────

describe('ROOT_CODE: три колбэка корня', () => {
  function makeRoot() {
    const reports: [string, unknown, unknown][] = [];
    const el = container();
    const { root } = runJsx(t.ROOT_CODE, ['root'], {
      createRoot,
      container: el,
      report: (kind: string, error: unknown, stack: unknown) => void reports.push([kind, error, stack]),
    }) as { root: ReturnType<typeof createRoot> };
    return { el, root, reports };
  }

  it('пойманная: onCaughtError с componentStack, затем componentDidCatch', async () => {
    withAct(false);
    const { el, root, reports } = makeRoot();
    const order: string[] = [];
    const Feed = () => {
      throw new Error('бум');
    };
    const orig = reports.push.bind(reports);
    reports.push = (...items) => (order.push('onCaughtError'), orig(...items));
    root.render(h(EB, { fallback: h('p', null, 'ошибка'), onError: () => void order.push('componentDidCatch') }, h(Feed)));
    await until(() => order.length === 2);
    expect(order).toEqual(['onCaughtError', 'componentDidCatch']);
    expect(reports[0][0]).toBe('caught');
    expect(String(reports[0][2])).toContain('at Feed');
    root.unmount();
    el.remove();
  });

  it('errorBoundary — экземпляр сработавшей границы (ROOT_ROWS)', async () => {
    withAct(false);
    let seen: unknown = null;
    const instances: unknown[] = [];
    class Mine extends ErrorBoundary {
      componentDidMount() {
        instances.push(this);
      }
    }
    const Feed = () => {
      throw new Error('бум');
    };
    const el = container();
    const root = createRoot(el, { onCaughtError: (_e, info) => void (seen = info.errorBoundary) });
    root.render(h(Mine as unknown as typeof EB, { fallback: h('p', null, 'ошибка') }, h(Feed)));
    await until(() => seen !== null);
    expect(seen).toBeInstanceOf(ErrorBoundary);
    expect(instances).toEqual([seen]);
    root.unmount();
  });

  it('непойманная после показанной страницы: контейнер пуст целиком (ROOT_NOTE)', async () => {
    withAct(false);
    const { el, root, reports } = makeRoot();
    const Feed = ({ broken }: { broken: boolean }) => {
      if (broken) throw new Error('бум');
      return h('p', null, 'лента');
    };
    const page = (broken: boolean) => h('main', null, h('p', null, 'шапка'), h(Feed, { broken }));
    root.render(page(false));
    await until(() => visible(el).length === 2);
    expect(visible(el)).toEqual(['шапка', 'лента']);
    root.render(page(true));
    await until(() => reports.length > 0);
    expect(reports.map((r) => r[0])).toEqual(['uncaught']);
    expect(el.innerHTML).toBe('');
  });

  it('оправился сам: onRecoverableError, в report уходит исходная ошибка', async () => {
    withAct(false);
    const { el, root, reports } = makeRoot();
    let n = 0;
    const Flaky = () => {
      n++;
      if (n === 1) throw new Error('гонка');
      return h('p', null, 'ок');
    };
    root.render(h(Flaky));
    await until(() => reports.length > 0);
    expect(reports[0][0]).toBe('recovered');
    expect((reports[0][1] as Error).message).toBe('гонка');
    expect(visible(el)).toEqual(['ок']);
    root.unmount();
  });

  it('по умолчанию непойманная уходит событием error у window (ROOT_DEFAULTS)', async () => {
    withAct(false);
    const got: string[] = [];
    const onErr = (e: Event) => {
      got.push((e as ErrorEvent).error?.message);
      e.preventDefault();
    };
    win.addEventListener('error', onErr as never);
    const warn = console.warn;
    console.warn = () => {};
    const el = container();
    const root = createRoot(el);
    const Feed = () => {
      throw new Error('без обработчика');
    };
    root.render(h(Feed));
    await until(() => got.length > 0);
    console.warn = warn;
    win.removeEventListener('error', onErr as never);
    expect(got).toEqual(['без обработчика']);
  });

  it('PITFALLS 06: под act onUncaughtError не вызван — ошибку бросает act', async () => {
    withAct(true);
    const called: unknown[] = [];
    const el = container();
    const root = createRoot(el, { onUncaughtError: (e) => void called.push(e) });
    const Feed = () => {
      throw new Error('под act');
    };
    await expect(act(async () => root.render(h(Feed)))).rejects.toThrow('под act');
    expect(called).toEqual([]);
  });
});

// ─── Раздел 7. Vue ─────────────────────────────────────────────────────────────────────────

describe('Vue: Suspense с async setup', () => {
  const settle = async () => {
    for (let i = 0; i < 5; i++) await macrotask();
  };

  it('VUE_PAGE_SFC + VUE_PROFILE_SFC: заглушка, потом содержимое', async () => {
    const user = deferred<{ name: string }>();
    const Profile = sfc(t.VUE_PROFILE_SFC, { './api': { fetchUser: () => user.promise } });
    const Page = sfc(t.VUE_PAGE_SFC, { './Profile.vue': { __esModule: true, default: Profile } });
    const el = container();
    Vue.createApp(Page).mount(el);
    await settle();
    expect(visible(el)).toEqual(['Загружаем профиль…']);
    user.resolve({ name: 'Ада' });
    await settle();
    expect(visible(el)).toEqual(['Ада']);
    // console.info с этой фразой печатается один раз за процесс — при первом Suspense
    expect(infos).toContain('<Suspense> is an experimental feature and its API will likely change.');
    expect(t.VUE_SUSPENSE_FACTS[2].d).toContain('<Suspense> is an experimental feature and its API will likely change.');
  });

  it('async setup без Suspense — предупреждение и пусто даже после ответа', async () => {
    const user = deferred<{ name: string }>();
    const Profile = sfc(t.VUE_PROFILE_SFC, { './api': { fetchUser: () => user.promise } });
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...a: unknown[]) => void warns.push(String(a[0]));
    const el = container();
    Vue.createApp({ render: () => Vue.h('main', null, [Vue.h('p', 'шапка'), Vue.h(Profile, { id: 1 })]) }).mount(el);
    await settle();
    user.resolve({ name: 'Ада' });
    await settle();
    console.warn = orig;
    expect(visible(el)).toEqual(['шапка']);
    expect(warns.some((w) => w.includes('setup function returned a promise, but no <Suspense> boundary was found'))).toBe(true);
  });

  it('повторное ожидание: старое на экране; с timeout 0 — заглушка сразу', async () => {
    for (const timeout of [undefined, 0]) {
      const users: Record<number, ReturnType<typeof deferred<{ name: string }>>> = { 1: deferred(), 2: deferred() };
      const Profile = sfc(t.VUE_PROFILE_SFC, { './api': { fetchUser: (id: number) => users[id].promise } });
      const id = Vue.ref(1);
      const el = container();
      Vue.createApp({
        render: () =>
          Vue.h(Vue.Suspense, { timeout }, {
            default: () => Vue.h(Profile, { id: id.value, key: id.value }),
            fallback: () => Vue.h('p', 'Загружаем профиль…'),
          }),
      }).mount(el);
      await settle();
      users[1].resolve({ name: 'Ада' });
      await settle();
      const shown = [visible(el)];
      id.value = 2;
      await settle();
      shown.push(visible(el));
      users[2].resolve({ name: 'Грейс' });
      await settle();
      shown.push(visible(el));
      expect(shown).toEqual(timeout === 0
        ? [['Ада'], ['Загружаем профиль…'], ['Грейс']]
        : [['Ада'], ['Ада'], ['Грейс']]);
    }
  });

  it('вложенный Suspense живёт сам по себе', async () => {
    const posts = deferred<string>();
    const Posts = Vue.defineComponent({ async setup() { const v = await posts.promise; return () => Vue.h('p', v); } });
    const el = container();
    Vue.createApp({
      render: () => Vue.h(Vue.Suspense, null, {
        default: () => Vue.h('div', [Vue.h('p', 'Ада'), Vue.h(Vue.Suspense, null, { default: () => Vue.h(Posts), fallback: () => Vue.h('p', 'Посты…') })]),
        fallback: () => Vue.h('p', 'Профиль…'),
      }),
    }).mount(el);
    await settle();
    expect(visible(el)).toEqual(['Ада', 'Посты…']);
  });
});

describe('Vue: VUE_BOUNDARY_SFC и app.config.errorHandler — VUE_ROWS', () => {
  const settle = async () => {
    for (let i = 0; i < 5; i++) await macrotask();
  };
  const Boundary = sfc(t.VUE_BOUNDARY_SFC);

  async function mount(child: import('vue').Component, after?: (el: HTMLElement) => void) {
    const caught: [string, string][] = [];
    const handled: string[] = [];
    const el = container();
    const app = Vue.createApp({
      render: () => Vue.h(Boundary, {
        fallback: 'ошибка',
        onCaught: (e: Error, info: string) => caught.push([e.message, info]),
      }, { default: () => Vue.h(child) }),
    });
    app.config.errorHandler = (e) => void handled.push((e as Error).message);
    app.mount(el);
    await settle();
    if (after) {
      after(el);
      await settle();
    }
    return { el, caught, handled };
  }
  const click = (el: HTMLElement) =>
    el.querySelector('button')!.dispatchEvent(new win.MouseEvent('click', { bubbles: true }) as unknown as Event);

  it('рендер: ловит, info — render function, дальше не всплывает', async () => {
    const Bomb = Vue.defineComponent({ setup: () => () => { throw new Error('бум'); } });
    const r = await mount(Bomb);
    expect(r.caught).toEqual([['бум', 'render function']]);
    expect(r.handled).toEqual([]);
    expect(visible(r.el)).toEqual(['ошибка']);
  });

  it('обработчик события: ловит, info — native event handler', async () => {
    const Btn = Vue.defineComponent({ setup: () => () => Vue.h('button', { onClick: () => { throw new Error('клик'); } }, 'кнопка') });
    const r = await mount(Btn, click);
    expect(r.caught).toEqual([['клик', 'native event handler']]);
    expect(visible(r.el)).toEqual(['ошибка']);
  });

  it('async-обработчик, бросок после await: ловит', async () => {
    const Btn = Vue.defineComponent({
      setup: () => () => Vue.h('button', { onClick: async () => { await null; throw new Error('после await'); } }, 'кнопка'),
    });
    const r = await mount(Btn, click);
    expect(r.caught).toEqual([['после await', 'native event handler']]);
  });

  it('таймер: мимо — ошибка остаётся у того, кто вызвал колбэк', async () => {
    const timers: (() => void)[] = [];
    const Timer = Vue.defineComponent({
      setup() {
        Vue.onMounted(() => timers.push(() => { throw new Error('таймер'); }));
        return () => Vue.h('p', 'жив');
      },
    });
    const r = await mount(Timer);
    expect(() => timers[0]()).toThrow('таймер');
    await settle();
    expect(r.caught).toEqual([]);
    expect(visible(r.el)).toEqual(['жив']);
  });

  it('отклонённый await в setup: ловит, info — setup function', async () => {
    const Rejecting = Vue.defineComponent({ async setup() { await null; throw new Error('404'); } });
    const Wrapped = Vue.defineComponent({ setup: () => () => Vue.h(Vue.Suspense, null, { default: () => Vue.h(Rejecting), fallback: () => Vue.h('p', 'загрузка') }) });
    const r = await mount(Wrapped);
    expect(r.caught).toEqual([['404', 'setup function']]);
    expect(visible(r.el)).toEqual(['ошибка']);
  });

  it('VUE_PROPAGATION: внутренняя без false и внешняя с false — сработали обе, на экране внешняя', async () => {
    const passing = t.VUE_BOUNDARY_SFC.replace('return false;   // дальше не всплывать', 'return;');
    expect(passing).not.toBe(t.VUE_BOUNDARY_SFC);
    const Inner = sfc(passing);
    const order: string[] = [];
    const handled: string[] = [];
    const Bomb = Vue.defineComponent({ setup: () => () => { throw new Error('бум'); } });
    const el = container();
    const app = Vue.createApp({
      render: () => Vue.h(Boundary, { fallback: 'внешняя', onCaught: () => order.push('внешняя') }, {
        default: () => Vue.h(Inner, { fallback: 'внутренняя', onCaught: () => order.push('внутренняя') }, { default: () => Vue.h(Bomb) }),
      }),
    });
    app.config.errorHandler = (e) => void handled.push((e as Error).message);
    app.mount(el);
    await settle();
    expect(order).toEqual(['внутренняя', 'внешняя']);
    expect(handled).toEqual([]);
    expect(visible(el)).toEqual(['внешняя']);
  });

  it('VUE_APP_CODE: никто не поймал — пустой комментарий на месте, остальное живёт', async () => {
    const reports: [string, string][] = [];
    const Bomb = Vue.defineComponent({ setup: () => () => { throw new Error('бум'); } });
    const App = { render: () => Vue.h('main', [Vue.h('p', 'шапка'), Vue.h(Bomb), Vue.h('p', 'подвал')]) };
    const el = container();
    el.id = 'app';
    const code = t.VUE_APP_CODE.replace("app.mount('#app');", 'app.mount(el);');
    new Function('createApp', 'App', 'report', 'el', code)(Vue.createApp, App, (e: Error, info: string) => reports.push([e.message, info]), el);
    expect(reports).toEqual([['бум', 'render function']]);
    expect(el.innerHTML).toBe('<main><p>шапка</p><!----><p>подвал</p></main>');
  });

  it('VUE_DEV_PROD: в отладочной сборке без errorHandler — mount бросает, не смонтировано ничего', () => {
    const Bomb = Vue.defineComponent({ setup: () => () => { throw new Error('бум'); } });
    const el = container();
    const warn = console.warn;
    console.warn = () => {};
    expect(() => Vue.createApp({ render: () => Vue.h('main', [Vue.h('p', 'шапка'), Vue.h(Bomb)]) }).mount(el)).toThrow('бум');
    console.warn = warn;
    expect(el.innerHTML).toBe('');
  });
});

// ─── Раздел 8. Модель против React и Vue ───────────────────────────────────────────────────

const model = loadBoundary(t.BOUNDARY_CODE);

/** JSX демо-дерева → формат модели: подменный `jsx`-рантайм собирает узлы вместо элементов. */
function treeFromJsx(): TreeNode {
  const SUSPENSE = Symbol('Suspense');
  const BOUNDARY = Symbol('ErrorBoundary');
  type Raw = { type: unknown; props: { children?: Raw | Raw[]; fallback?: string } };
  const runtime = {
    jsx: (type: unknown, props: Raw['props']) => ({ type, props }),
    jsxs: (type: unknown, props: Raw['props']) => ({ type, props }),
    Fragment: Symbol('Fragment'),
  };
  const names = ['App', ...t.DEMO_NAMES];
  const scope: Record<string, unknown> = { Suspense: SUSPENSE, ErrorBoundary: BOUNDARY };
  for (const n of names) scope[n] = n;
  const raw = jsxExpr(t.DEMO_TREE_JSX, scope, runtime) as Raw;
  const conv = (r: Raw): TreeNode => {
    const kids = r.props.children === undefined ? [] : ([] as Raw[]).concat(r.props.children);
    const children = kids.map(conv);
    if (r.type === SUSPENSE) return { type: 'suspense', fallback: r.props.fallback!, children };
    if (r.type === BOUNDARY) return { type: 'boundary', fallback: r.props.fallback!, children };
    return { type: 'component', name: r.type as string, children };
  };
  return conv(raw);
}

/** Компоненты демо для React: ждут на стабильном промисе, падают ошибкой со своим именем. */
function reactDemo(status: Record<string, Status>, promise: (name: string) => Promise<unknown>, log: string[]) {
  const comps: Record<string, unknown> = {};
  for (const name of ['App', ...t.DEMO_NAMES]) {
    const Comp = ({ children }: { children?: React.ReactNode }) => {
      const s = status[name] ?? 'ok';
      if (s === 'wait') React.use(promise(name));
      if (s === 'fail') throw new Error(name);
      return h('div', null, h('b', null, name), children);
    };
    Object.defineProperty(Comp, 'name', { value: name });
    comps[name] = Comp;
  }
  class Logged extends ErrorBoundary {
    componentDidCatch(error: Error, info: React.ErrorInfo) {
      log.push(String((this.props as { fallback: unknown }).fallback));
      super.componentDidCatch?.(error, info);
    }
  }
  return jsxExpr(t.DEMO_TREE_JSX, { ...comps, Suspense: React.Suspense, ErrorBoundary: Logged }) as React.ReactElement;
}

/** То же дерево во Vue: Suspense с одним корнем, граница — VUE_BOUNDARY_SFC. */
const VueBoundary = sfc(t.VUE_BOUNDARY_SFC);
function vueDemo(node: TreeNode, status: Record<string, Status>, promise: (name: string) => Promise<unknown>, caught: string[]): import('vue').VNode {
  const kids = () => node.children.map((c) => vueDemo(c, status, promise, caught));
  const one = () => {
    const k = kids();
    return k.length === 1 ? k[0] : Vue.h('div', k);
  };
  if (node.type === 'suspense') return Vue.h(Vue.Suspense, null, { default: one, fallback: () => Vue.h('i', node.fallback) });
  if (node.type === 'boundary') {
    return Vue.h(VueBoundary, { fallback: node.fallback, onCaught: () => caught.push(node.fallback) }, { default: one });
  }
  const s = status[node.name] ?? 'ok';
  const draw = () => Vue.h('div', [Vue.h('b', node.name), ...kids()]);
  const comp = s === 'wait'
    ? Vue.defineComponent({ name: node.name, async setup() { await promise(node.name); return draw; } })
    : Vue.defineComponent({ name: node.name, setup: () => () => { if (s === 'fail') throw new Error(node.name); return draw(); } });
  return Vue.h(comp);
}

const COMBOS: Record<string, Status>[] = [];
(function rec(i: number, st: Record<string, Status>) {
  if (i === t.DEMO_NAMES.length) return void COMBOS.push(st);
  for (const s of ['ok', 'wait', 'fail'] as Status[]) rec(i + 1, { ...st, [t.DEMO_NAMES[i]]: s });
})(0, {});

function loader() {
  const map = new Map<string, Promise<unknown>>();
  const fresh: string[] = [];
  const resolvers: (() => void)[] = [];
  return {
    get: (n: string) => {
      if (!map.has(n)) {
        fresh.push(n);
        map.set(n, new Promise((r) => resolvers.push(() => r(n))));
      }
      return map.get(n)!;
    },
    take: () => fresh.splice(0),
    resolveAll: () => resolvers.splice(0).forEach((r) => r()),
  };
}

async function realReact(status: Record<string, Status>) {
  withAct(true);
  const cdc: string[] = [];
  const L = loader();
  const el = container();
  const root = createRoot(el, { onCaughtError: () => {} });
  let uncaught: string[] = [];
  try {
    await act(async () => root.render(reactDemo(status, L.get, cdc)));
  } catch (e) {
    uncaught = [(e as Error).message];
  }
  const shown = visible(el, false);
  root.unmount();
  el.remove();
  return { shown, caught: cdc, uncaught };
}

async function realVue(status: Record<string, Status>, tree: TreeNode) {
  const caught: string[] = [];
  const uncaught: string[] = [];
  const L = loader();
  const el = container();
  const app = Vue.createApp({ render: () => vueDemo(tree, status, L.get, caught) });
  app.config.errorHandler = (e) => void uncaught.push((e as Error).message);
  app.mount(el);
  for (let i = 0; i < 5; i++) await macrotask();
  const shown = visible(el, false);
  app.unmount();
  el.remove();
  return { shown, caught, uncaught };
}

async function realWaves(mode: Mode, status: Record<string, Status>, tree: TreeNode) {
  const L = loader();
  const el = container();
  const waves: { started: string[]; shown: string[] }[] = [];
  if (mode === 'react') {
    withAct(true);
    const root = createRoot(el, { onCaughtError: () => {} });
    try {
      await act(async () => root.render(reactDemo(status, L.get, [])));
    } catch { /* корень снят — волны кончатся пустыми */ }
    for (;;) {
      const started = L.take();
      waves.push({ started, shown: visible(el, false) });
      if (!started.length) break;
      try {
        await act(async () => L.resolveAll());
      } catch { /* то же */ }
    }
    root.unmount();
  } else {
    const app = Vue.createApp({ render: () => vueDemo(tree, status, L.get, []) });
    app.config.errorHandler = () => {};
    app.mount(el);
    const settle = async () => {
      for (let i = 0; i < 5; i++) await macrotask();
    };
    await settle();
    for (;;) {
      const started = L.take();
      waves.push({ started, shown: visible(el, false) });
      if (!started.length) break;
      L.resolveAll();
      await settle();
    }
    app.unmount();
  }
  el.remove();
  return waves;
}

describe('BOUNDARY_CODE против React 19.3 и Vue 3.5 — демо-дерево', () => {
  const quiet = () => {
    const e = console.error;
    const w = console.warn;
    console.error = () => {};
    console.warn = () => {};
    return () => {
      console.error = e;
      console.warn = w;
    };
  };

  it('DEMO_TREE — то же дерево, что DEMO_TREE_JSX', () => {
    expect(treeFromJsx()).toEqual(t.DEMO_TREE);
  });

  it('сочетаний 243 — как сказано в подписи', () => {
    expect(COMBOS).toHaveLength(243);
    expect(t.DEMO_CAPTION).toContain('243');
    for (const p of t.DEMO_PRESETS) for (const n of Object.keys(p.status)) expect(t.DEMO_NAMES).toContain(n);
  });

  it('React: экран, непойманное и порядок componentDidCatch — на всех сочетаниях', async () => {
    const restore = quiet();
    let crashedAfterCommit = 0;
    try {
      for (const status of COMBOS) {
        const real = await realReact(status);
        const m = model.renderRoot(t.DEMO_TREE, status, 'react');
        expect({ status, shown: real.shown, uncaught: real.uncaught }).toEqual({ status, shown: m.shown, uncaught: m.uncaught });
        // Корень упал: React иногда успевает закоммитить первый проход (до прогрева соседей),
        // и componentDidCatch приходит перед тем, как дерево снимут. Экран от этого не зависит.
        if (real.uncaught.length) {
          if (real.caught.length) crashedAfterCommit++;
          continue;
        }
        expect({ status, caught: real.caught }).toEqual({ status, caught: m.caught });
      }
    } finally {
      restore();
    }
    expect(crashedAfterCommit).toBeGreaterThan(0);
  });

  it('Vue: экран, порядок onErrorCaptured и errorHandler — на всех сочетаниях', async () => {
    const restore = quiet();
    try {
      for (const status of COMBOS) {
        const real = await realVue(status, t.DEMO_TREE);
        const m = model.renderRoot(t.DEMO_TREE, status, 'vue');
        expect({ status, ...real }).toEqual({ status, shown: m.shown, caught: m.caught, uncaught: m.uncaught });
      }
    } finally {
      restore();
    }
  });

  it('волны загрузки (loadWaves) — React и Vue, на всех сочетаниях', async () => {
    const restore = quiet();
    try {
      for (const mode of ['react', 'vue'] as Mode[]) {
        for (const status of COMBOS) {
          const real = await realWaves(mode, status, t.DEMO_TREE);
          expect({ mode, status, waves: real }).toEqual({ mode, status, waves: model.loadWaves(t.DEMO_TREE, status, mode) });
        }
      }
    } finally {
      restore();
    }
  }, 60_000);

  it('водопад в демо: Comments за Feed — вторая волна, Profile рядом с Ads — первая', () => {
    const w = model.loadWaves(t.DEMO_TREE, { Feed: 'wait', Comments: 'wait', Profile: 'wait' }, 'react');
    expect(w.map((x) => x.started)).toEqual([['Feed', 'Profile'], ['Comments'], []]);
  });
});
