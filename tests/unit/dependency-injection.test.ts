import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';
import { Window } from 'happy-dom';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/dependency-injection/data';
import { createLab, creationOrder, loadAngular, loadVue, mountReact, mountVue, setupOrder, show, toVue } from '@/widgets/di-lab/model/run';
import type { DiError, DiSpec, Flags, From, Provider } from '@/widgets/di-lab/model/types';

/**
 * Тема «Внедрение зависимостей во фреймворках».
 *
 * Здесь пересобирается стенд из шапки `data.ts`:
 *   — учебный инжектор `ANGULAR_DI_CODE` и настоящий Angular 21 (JIT, happy-dom) получают одно
 *     и то же дерево и одни и те же запросы в конструкторах компонентов; сверяются значения,
 *     номера экземпляров, коды ошибок и путь цикла. Деревья — `SCENARIOS` ниже и `DEMO_SPEC`
 *     темы со всеми сочетаниями флагов;
 *   — `VUE_PROVIDE_CODE` против Vue 3.5: значения `inject` и то, какие компоненты делят объект
 *     `provides` и чей объект — прототип чьего;
 *   — `REACT_CONTEXT_CODE` против React 19 (`renderToString`);
 *   — все примеры `*_CODE` исполняются (TypeScript → CommonJS через `ts.transpileModule`), их
 *     вывод сверяется с `*_OUT`;
 *   — тексты ошибок, продакшен-вид ошибок (отдельный процесс с `ngDevMode = false`) и места
 *     исходников, на которые опирается текст.
 *
 * Глобалы happy-dom ставятся до загрузки Angular и Vue: оба смотрят на `document` при первом
 * обращении. React берётся через `require`, чтобы `react`, `react-dom/server` и `jsx-runtime`
 * были одной копией.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

// ─── DOM ───────────────────────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'Event', 'MouseEvent', 'KeyboardEvent', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

await import('reflect-metadata');
await import('@angular/compiler');
const ng = await import('@angular/core');
const ngTesting = await import('@angular/core/testing');
const pb = await import('@angular/platform-browser');
const pbTesting = await import('@angular/platform-browser/testing');
const vue = await import('vue');
const React = require('react') as typeof import('react');
const ReactServer = require('react-dom/server') as typeof import('react-dom/server');

const { Component, Injectable, InjectionToken, Injector, createEnvironmentInjector, inject } = ng;

// ─── Исполнение примеров ─────────────────────────────────────────────────────────────────

const MODULES: Record<string, unknown> = {
  '@angular/core': ng,
  '@angular/core/testing': ngTesting,
  '@angular/platform-browser': pb,
  vue,
  react: React,
  'react-dom/server': ReactServer,
  'react/jsx-runtime': require('react/jsx-runtime'),
};

interface SnippetRun {
  out: string[];
  exports: Record<string, unknown>;
  specs: [string, () => Promise<void>][];
}

/** Пример темы как есть: TypeScript с декораторами и JSX → CommonJS → исполнение. */
async function runSnippet(code: string): Promise<SnippetRun> {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      useDefineForClassFields: false,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const out: string[] = [];
  const specs: SnippetRun['specs'] = [];
  const con = { log: (...a: unknown[]) => out.push(format(...a)) };
  const mod = { exports: {} as Record<string, unknown> };
  const req = (name: string) => {
    if (!(name in MODULES)) throw new Error(`пример импортирует ${name}`);
    return MODULES[name];
  };
  const body = `return (async () => {\n${js}\n})();`;
  await new Function('require', 'module', 'exports', 'console', 'it', 'expect', body)(
    req,
    mod,
    mod.exports,
    con,
    (name: string, fn: () => Promise<void>) => specs.push([name, fn]),
    expect,
  );
  return { out, exports: mod.exports, specs };
}

const errText = (fn: () => unknown) => {
  try {
    fn();
    return 'нет ошибки';
  } catch (e) {
    return (e as Error).message;
  }
};

// ─── Настоящий Angular по дереву ─────────────────────────────────────────────────────────

interface Query {
  from: From;
  token: string;
  flags?: Flags;
}
type Result = { value: unknown } | { error: string; path?: string[] };

let uid = 0;

/** Дерево → компоненты Angular; запросы выполняются в конструкторах, как `inject()` в поле. */
async function runAngular(spec: DiSpec, queries: Query[]) {
  const id = ++uid;
  const counters: Record<string, number> = {};
  const toks = new Map<string, unknown>();
  const tok = (name: string): never => {
    if (!toks.has(name)) {
      const def = spec.classes[name];
      if (def) {
        const C = class {
          deps = (def.deps ?? []).map((d) => inject(tok(d)));
          label: string;
          constructor() {
            counters[name] = (counters[name] ?? 0) + 1;
            this.label = `${name}#${counters[name]}`;
          }
        };
        Object.defineProperty(C, 'name', { value: name });
        if (def.providedIn) Injectable({ providedIn: def.providedIn })(C);
        toks.set(name, C);
      } else {
        toks.set(name, new InjectionToken(name));
      }
    }
    return toks.get(name) as never;
  };
  const conv = (p: Provider): never => {
    if (typeof p === 'string') return tok(p);
    const o: Record<string, unknown> = { provide: tok(p.provide) };
    if (p.multi) o.multi = true;
    if ('useValue' in p) o.useValue = p.useValue;
    else if (p.useClass) o.useClass = tok(p.useClass);
    else if (p.useExisting) o.useExisting = tok(p.useExisting);
    else if (p.useFactory) {
      o.useFactory = p.useFactory;
      o.deps = (p.deps ?? []).map(tok);
    }
    return o as never;
  };

  const results: Result[] = [];
  const ask = (i: number, get: (token: never, flags: Flags) => unknown) => {
    const q = queries[i];
    try {
      results[i] = { value: show(get(tok(q.token), q.flags ?? {})) };
    } catch (e) {
      results[i] = parseNgError((e as Error).message);
    }
  };
  const order: string[] = [];
  const classes = new Map<string, unknown>();
  const make = (c: DiSpec['components'][number]): unknown => {
    if (classes.has(c.id)) return classes.get(c.id);
    const kids = spec.components.filter((k) => k.parent === c.id);
    const imports = kids.map(make);
    const C = class {
      constructor() {
        order.push(c.id);
        queries.forEach((q, i) => {
          if ('node' in q.from && q.from.node === c.id) ask(i, (tk, f) => inject(tk, f));
        });
      }
    };
    Object.defineProperty(C, 'name', { value: c.id });
    Component({
      selector: `di-${c.id.toLowerCase()}-${id}`,
      template: kids.map((k) => `<di-${k.id.toLowerCase()}-${id} />`).join(''),
      imports: imports as never[],
      providers: (c.providers ?? []).map(conv),
      viewProviders: (c.viewProviders ?? []).map(conv),
    })(C);
    classes.set(c.id, C);
    return C;
  };
  spec.components.forEach(make);

  const app = await pb.createApplication({ providers: spec.env[0].providers.map(conv) });
  const envs: Record<string, import('@angular/core').EnvironmentInjector> = { [spec.env[0].id]: app.injector };
  for (const e of spec.env.slice(1)) envs[e.id] = createEnvironmentInjector(e.providers.map(conv), envs[e.parent!], e.id);
  for (const r of spec.components.filter((c) => !c.parent)) {
    const host = document.createElement('div');
    document.body.append(host);
    const ref = ng.createComponent(classes.get(r.id) as never, { environmentInjector: envs[r.env!], hostElement: host });
    ref.changeDetectorRef.detectChanges();
  }
  queries.forEach((q, i) => {
    if ('env' in q.from) {
      const env = envs[q.from.env];
      ask(i, (tk, f) => env.get(tk, undefined, f));
    }
  });
  return { results, order, app };
}

/** Код ошибки и путь цикла из текста Angular: без имени компонента и без `InjectionToken `. */
function parseNgError(message: string): Result {
  const code = /^(NG0\d+)/.exec(message)?.[1] ?? message;
  const path = /Path: (.*?)\.( Find| Source|$)/.exec(message)?.[1]?.split(' -> ').map((s) => s.replace(/^InjectionToken /, ''));
  return { error: code, path };
}

/** Те же запросы к учебному инжектору — в том же порядке, что конструкторы Angular. */
function runMini(spec: DiSpec, queries: Query[]) {
  const mini = loadAngular(t.ANGULAR_DI_CODE);
  const di = mini.createInjectors(spec);
  const results: Result[] = [];
  const ask = (i: number) => {
    const q = queries[i];
    try {
      results[i] = { value: show(mini.resolve(di, q.from, q.token, q.flags ?? {})) };
    } catch (e) {
      const err = e as DiError;
      results[i] = { error: err.code, path: err.path };
    }
  };
  const order = creationOrder(spec);
  for (const node of order) queries.forEach((q, i) => 'node' in q.from && q.from.node === node && ask(i));
  queries.forEach((q, i) => 'env' in q.from && ask(i));
  return { results, order };
}

/** Путь сверяется только у цикла и только когда Angular его напечатал (два шага и больше). */
function norm(results: Result[], spec: DiSpec) {
  return results.map((r) => {
    if (!('error' in r)) return r;
    let path = r.path?.filter((tk) => !spec.components.some((c) => c.id === tk));
    if (r.error !== 'NG0200' || !path || path.length < 2) path = undefined;
    return { error: r.error, path };
  });
}

const n = (node: string, token: string, flags?: Flags): Query => ({ from: { node }, token, flags });
const e = (env: string, token: string, flags?: Flags): Query => ({ from: { env }, token, flags });

const tree = (extra: Partial<DiSpec> = {}): DiSpec => ({
  classes: {
    ...t.DEMO_SPEC.classes,
    FileLogger: {},
    X: { deps: ['Y'] },
    Y: { deps: ['X'] },
    Uses: { deps: ['MISSING'] },
    ...extra.classes,
  },
  env: [...t.DEMO_SPEC.env, ...(extra.env ?? [])],
  components: extra.components ?? t.DEMO_SPEC.components,
});

const SCENARIOS: [string, DiSpec, Query[]][] = [
  ['синглтон на инжектор', tree(), [n('Menu', 'Store'), n('CardA', 'Store'), n('CardB', 'Store'), n('CardA', 'Store'), n('App', 'Store'), n('Header', 'Logger'), n('CardB', 'Logger'), e('root', 'Logger')]],
  ['флаги', tree(), [n('Menu', 'Store', { self: true, optional: true }), n('CardA', 'Store', { skipSelf: true }), n('CardA', 'THEME', { host: true }), n('CardA', 'PLUGINS', { host: true, optional: true }), n('Board', 'THEME', { skipSelf: true }), n('Board', 'THEME'), n('Menu', 'THEME', { host: true, optional: true }), n('App', 'THEME', { host: true, optional: true }), n('App', 'Store', { host: true }), n('Menu', 'Store', { self: true })]],
  ['ещё флаги', tree(), [n('CardA', 'Store', { self: true, skipSelf: true, optional: true }), n('App', 'Store', { skipSelf: true, optional: true }), n('App', 'Store', { skipSelf: true }), e('root', 'Logger', { self: true }), e('root', 'Logger', { skipSelf: true, optional: true }), n('Header', 'Store', { host: true }), n('Menu', 'Logger', { host: true, optional: true }), n('CardA', 'Logger', { skipSelf: true })]],
  ['multi', tree(), [n('CardA', 'PLUGINS'), n('Menu', 'PLUGINS'), n('Board', 'PLUGINS', { skipSelf: true })]],
  ['зависимости корня — от корня', tree(), [n('CardA', 'Api'), n('CardA', 'THEME')]],
  ['цикл в окружении', tree(), [n('Menu', 'Auth'), n('Menu', 'Auth'), n('Menu', 'Session')]],
  ['цикл в компоненте', tree({ components: [{ id: 'App', parent: null, env: 'root', providers: ['X', 'Y'] }, { id: 'Kid', parent: 'App' }] }), [n('Kid', 'X'), n('Kid', 'X'), n('App', 'Y')]],
  ['нет провайдера', tree(), [n('Menu', 'NOPE'), n('Menu', 'NOPE', { optional: true }), e('root', 'NOPE', { optional: true }), e('root', 'NOPE')]],
  ['окружение не снимает метку', tree({ env: [{ id: 'route', parent: 'root', providers: ['Uses'] }], components: [{ id: 'Page', parent: null, env: 'route' }] }), [n('Page', 'Uses'), n('Page', 'Uses'), e('route', 'Uses')]],
  ['компонент снимает метку', tree({ components: [{ id: 'App', parent: null, env: 'root', providers: ['Uses'] }] }), [n('App', 'Uses'), n('App', 'Uses')]],
  [
    'useClass, useExisting, useFactory',
    tree({
      components: [
        {
          id: 'App',
          parent: null,
          env: 'root',
          providers: ['Store', { provide: 'Cache', useExisting: 'Store' }, { provide: 'Copy', useClass: 'Store' }, { provide: 'Logger', useClass: 'FileLogger' }, { provide: 'URL', useFactory: ((theme: string) => '/api?theme=' + theme) as never, deps: ['THEME'] }],
        },
        { id: 'Kid', parent: 'App', providers: [{ provide: 'THEME', useValue: 'тёмная' }, 'Store'] },
      ],
    }),
    [n('Kid', 'Cache'), n('Kid', 'Store'), n('App', 'Cache'), n('App', 'Store'), n('App', 'Copy'), n('Kid', 'Logger'), n('Kid', 'URL')],
  ],
  [
    'дочернее окружение',
    tree({ env: [{ id: 'route', parent: 'root', providers: [{ provide: 'THEME', useValue: 'маршрут' }, 'Logger'] }], components: [{ id: 'Page', parent: null, env: 'route' }] }),
    [n('Page', 'THEME'), n('Page', 'Logger'), n('Page', 'Api'), e('route', 'Logger', { skipSelf: true }), e('root', 'Logger'), e('route', 'THEME', { self: true }), e('route', 'Api', { self: true, optional: true }), e('route', 'Store', { optional: true })],
  ],
  [
    'providers и viewProviders одного узла',
    tree({ components: [{ id: 'App', parent: null, env: 'root', providers: [{ provide: 'THEME', useValue: 'p' }], viewProviders: [{ provide: 'THEME', useValue: 'v' }] }, { id: 'Kid', parent: 'App' }] }),
    [n('App', 'THEME'), n('Kid', 'THEME'), n('Kid', 'THEME', { host: true }), n('Kid', 'THEME', { skipSelf: true, host: true })],
  ],
  [
    'фабрика провайдера не видит viewProviders своего узла',
    tree({ components: [{ id: 'App', parent: null, env: 'root', providers: [{ provide: 'A', useExisting: 'THEME' }], viewProviders: [{ provide: 'THEME', useValue: 'v' }, { provide: 'B', useExisting: 'THEME' }] }, { id: 'Kid', parent: 'App' }] }),
    [n('Kid', 'A'), n('App', 'A'), n('Kid', 'B')],
  ],
];

const FLAG_SETS: Flags[] = [];
for (let m = 0; m < 16; m++) {
  FLAG_SETS.push({ optional: Boolean(m & 1), self: Boolean(m & 2), skipSelf: Boolean(m & 4), host: Boolean(m & 8) });
}

describe('учебный инжектор отвечает как Angular 21', () => {
  for (const [name, spec, queries] of SCENARIOS) {
    it(name, async () => {
      const real = await runAngular(spec, queries);
      const mini = runMini(spec, queries);
      expect(mini.order).toEqual(real.order);
      expect(norm(mini.results, spec)).toEqual(norm(real.results, spec));
    });
  }

  it('дерево демо: каждый компонент, каждый токен, все 16 сочетаний флагов', async () => {
    const queries: Query[] = [];
    for (const c of t.DEMO_SPEC.components) {
      for (const tk of t.DEMO_TOKENS) for (const flags of FLAG_SETS) queries.push(n(c.id, tk.id, flags));
    }
    const real = await runAngular(t.DEMO_SPEC, queries);
    const mini = runMini(t.DEMO_SPEC, queries);
    expect(queries.length).toBe(6 * 6 * 16);
    expect(norm(mini.results, t.DEMO_SPEC)).toEqual(norm(real.results, t.DEMO_SPEC));
  });

  it('порядок конструкторов: весь шаблон, потом вглубь', async () => {
    const real = await runAngular(t.DEMO_SPEC, []);
    expect(real.order).toEqual(['App', 'Header', 'Board', 'Menu', 'CardA', 'CardB']);
    expect(creationOrder(t.DEMO_SPEC)).toEqual(real.order);
  });

  it('утверждения из текста: Api берёт корневую тему, multi не складывает уровни', async () => {
    const queries = [n('CardA', 'Api'), n('CardA', 'THEME'), n('Menu', 'PLUGINS'), n('CardA', 'PLUGINS'), n('Board', 'THEME')];
    const real = await runAngular(t.DEMO_SPEC, queries);
    expect(real.results).toEqual([{ value: 'Api#1' }, { value: 'тёмная' }, { value: ['поиск', 'экспорт'] }, { value: ['график'] }, { value: 'тёмная' }]);
    const lab = createLab(t.DEMO_SPEC, { angular: t.ANGULAR_DI_CODE, vue: t.VUE_PROVIDE_CODE, react: t.REACT_CONTEXT_CODE }, t.DEMO_DEFAULTS);
    const api = lab.ask('angular', 'CardA', 'Api').value as { deps: unknown[] };
    expect(api.deps).toEqual(['светлая']);
  });
});

// ─── Vue ───────────────────────────────────────────────────────────────────────────────────

/** Дерево → приложение Vue: в `setup` — `provide` по списку, потом запросы; объекты `provides` запоминаются. */
function runVue(spec: DiSpec, asks: { node: string; key: string; fallback?: unknown }[]) {
  const vspec = toVue(spec);
  const counters: Record<string, number> = {};
  const make = (v: unknown): unknown => {
    const pv = v as { value?: unknown; cls?: string; multi?: unknown[] };
    if ('value' in pv) return pv.value;
    if (pv.multi) return pv.multi.map(make);
    counters[pv.cls!] = (counters[pv.cls!] ?? 0) + 1;
    return { label: `${pv.cls}#${counters[pv.cls!]}` };
  };
  const results: unknown[] = [];
  const objs = new Map<string, object>();
  const comps = new Map<string, unknown>();
  const build = (c: (typeof vspec.components)[number]): unknown => {
    if (comps.has(c.id)) return comps.get(c.id);
    const kids = vspec.components.filter((k) => k.parent === c.id).map(build);
    const comp = vue.defineComponent({
      name: c.id,
      setup() {
        for (const p of c.provides) vue.provide(p.key, make(p.value));
        asks.forEach((a, i) => {
          if (a.node !== c.id) return;
          results[i] = show('fallback' in a ? vue.inject(a.key, a.fallback) : vue.inject(a.key));
        });
        objs.set(c.id, (vue.getCurrentInstance() as unknown as { provides: object }).provides);
        return () => vue.h('div', kids.map((k) => vue.h(k as never)));
      },
    });
    comps.set(c.id, comp);
    return comp;
  };
  const rootSpec = vspec.components.find((c) => !c.parent)!;
  const app = vue.createApp(build(rootSpec) as never);
  // provide до mount: компоненты создаются при монтировании, сборка компонентов — заранее
  for (const p of vspec.appProvides) app.provide(p.key, make(p.value));
  const warn = console.warn;
  console.warn = () => {};
  try {
    app.mount(document.createElement('div'));
  } finally {
    console.warn = warn;
  }
  return { results, objs, app };
}

describe('provide/inject: учебная версия отвечает как Vue 3.5', () => {
  const plain = t.DEMO_TOKENS.filter((tk) => tk.plain);

  it('значения inject на дереве демо — с запасным значением и без', () => {
    const asks: { node: string; key: string; fallback?: unknown }[] = [];
    for (const c of t.DEMO_SPEC.components) {
      for (const tk of plain) {
        asks.push({ node: c.id, key: tk.id });
        asks.push({ node: c.id, key: tk.id, fallback: 'запасное' });
      }
    }
    const real = runVue(t.DEMO_SPEC, asks);
    const api = loadVue(t.VUE_PROVIDE_CODE);
    const { vue: mini, vspec } = mountVue(api, t.DEMO_SPEC);
    const got = asks.map((a) => show(api.inject(mini, vspec, a.node, a.key, 'fallback' in a ? { value: a.fallback } : undefined).value));
    expect(got).toEqual(real.results);
    // Порядок создания экземпляров совпал — значит, и `setup` идёт в том же порядке.
    expect(setupOrder(t.DEMO_SPEC)).toEqual(['App', 'Header', 'Menu', 'Board', 'CardA', 'CardB']);
  });

  it('объекты provides: кто делит объект с родителем, чей прототип чей', () => {
    const real = runVue(t.DEMO_SPEC, []);
    const api = loadVue(t.VUE_PROVIDE_CODE);
    const { vue: mini } = mountVue(api, t.DEMO_SPEC);
    const appProvides = (real.app as unknown as { _context: { provides: object } })._context.provides;
    // Чей объект: первый компонент (в порядке setup), у которого он оказался; 'app' — appContext.
    const realOwner = new Map<object, string>([[appProvides, 'app']]);
    for (const id of setupOrder(t.DEMO_SPEC)) if (!realOwner.has(real.objs.get(id)!)) realOwner.set(real.objs.get(id)!, id);
    for (const id of setupOrder(t.DEMO_SPEC)) {
      const chain = (o: object | null, owners: Map<object, string>) => {
        const out: string[] = [];
        for (; o; o = Object.getPrototypeOf(o) as object | null) out.push(owners.get(o) ?? '?');
        return out;
      };
      expect(chain(mini.provides.get(id)!, mini.owner), id).toEqual(chain(real.objs.get(id)!, realOwner));
    }
    expect(real.objs.get('Header')).toBe(real.objs.get('App'));
    expect(real.objs.get('Menu')).toBe(real.objs.get('App'));
    expect(Object.getPrototypeOf(real.objs.get('App')!)).toBe(appProvides);
  });

  it('из текста демо: Board видит родительскую тему, App — не видит свой Store', () => {
    const lab = createLab(t.DEMO_SPEC, { angular: t.ANGULAR_DI_CODE, vue: t.VUE_PROVIDE_CODE, react: t.REACT_CONTEXT_CODE }, t.DEMO_DEFAULTS);
    expect(lab.ask('angular', 'Board', 'THEME').value).toBe('тёмная');
    expect(lab.ask('vue', 'Board', 'THEME').value).toBe('светлая');
    expect(lab.ask('react', 'Board', 'THEME').value).toBe('светлая');
    const appStore = lab.ask('vue', 'App', 'Store');
    expect(appStore.value).toBeUndefined();
    expect(appStore.warn).toBe('injection "Store" not found.');
    expect(show(lab.ask('angular', 'App', 'Store').value)).toBe('Store#1');
  });

  it('VUE_CHAIN_CODE, VUE_DEFAULTS_CODE, VUE_REACTIVE_CODE печатают то, что в теме', async () => {
    expect((await runSnippet(t.VUE_CHAIN_CODE)).out).toEqual(t.VUE_CHAIN_OUT);
    const warns: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => warns.push(String(a[0]).split('\n')[0]);
    try {
      expect((await runSnippet(t.VUE_DEFAULTS_CODE)).out).toEqual(t.VUE_DEFAULTS_OUT);
    } finally {
      console.warn = warn;
    }
    expect(warns).toEqual([t.VUE_DEFAULTS_WARN]);
    expect((await runSnippet(t.VUE_REACTIVE_CODE)).out).toEqual(t.VUE_REACTIVE_OUT);
  });

  it('inject после await в setup: undefined и предупреждение', async () => {
    const warns: string[] = [];
    const warn = console.warn;
    console.warn = (...a: unknown[]) => warns.push(String(a[0]).split('\n')[0]);
    let late: unknown = 'не дошло';
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const Child = vue.defineComponent({
      setup() {
        void (async () => {
          await Promise.resolve();
          late = vue.inject('k');
          resolveDone();
        })();
        return () => null;
      },
    });
    vue.createApp({ setup: () => (vue.provide('k', 1), () => vue.h(Child)) }).mount(document.createElement('div'));
    await done;
    console.warn = warn;
    expect(late).toBeUndefined();
    expect(warns.some((w) => w.includes('inject() can only be used inside setup()'))).toBe(true);
  });

  it('исходник runtime-core: Object.create(parentProvides) и key in provides', () => {
    const src = readFileSync(`${root}node_modules/@vue/runtime-core/dist/runtime-core.cjs.js`, 'utf8');
    const flat = (s: string) => s.replace(/\s+/g, ' ');
    for (const line of [
      'provides: parent ? parent.provides : Object.create(appContext.provides),',
      'if (parentProvides === provides) {',
      'provides = currentInstance.provides = Object.create(parentProvides);',
      'if (provides && key in provides) {',
      'return treatDefaultAsFactory && shared.isFunction(defaultValue) ? defaultValue.call(instance && instance.proxy) : defaultValue;',
    ]) {
      expect(flat(src), line).toContain(flat(line));
    }
    // Сокращённая цитата в теме — из тех же строк.
    for (const key of ['Object.create(parentProvides)', 'key in provides', 'instance.parent.provides', 'Object.create(appContext.provides)']) {
      expect(t.VUE_SOURCE_CODE).toContain(key);
    }
  });

  it('pinia: app.provide(piniaSymbol), inject(piniaSymbol) и runWithContext', () => {
    const src = readFileSync(`${root}node_modules/pinia/dist/pinia.js`, 'utf8');
    expect(src).toContain('app.provide(piniaSymbol, pinia)');
    expect(src).toContain('hasInjectionContext() && inject(piniaSymbol)');
    expect(src).toContain('pinia._a.runWithContext');
    expect(require('pinia/package.json').version).toBe('4.0.3');
  });

  it('app.runWithContext даёт inject вне setup', () => {
    const app = vue.createApp({ render: () => null });
    app.provide('k', 'из приложения');
    expect(app.runWithContext(() => vue.inject('k'))).toBe('из приложения');
    expect(vue.hasInjectionContext()).toBe(false);
  });
});

// ─── React ─────────────────────────────────────────────────────────────────────────────────

describe('контекст: учебная версия отвечает как React 19', () => {
  it('значения на дереве демо', () => {
    const h = React.createElement;
    const vspec = toVue(t.DEMO_SPEC);
    const ctxs = Object.fromEntries(t.DEMO_TOKENS.filter((tk) => tk.plain).map((tk) => [tk.id, React.createContext(t.DEMO_DEFAULTS[tk.id])]));
    const seen: Record<string, unknown> = {};
    const counters: Record<string, number> = {};
    const make = (v: unknown): unknown => {
      const pv = v as { value?: unknown; cls?: string; multi?: unknown[] };
      if ('value' in pv) return pv.value;
      if (pv.multi) return pv.multi.map(make);
      counters[pv.cls!] = (counters[pv.cls!] ?? 0) + 1;
      return { label: `${pv.cls}#${counters[pv.cls!]}` };
    };
    const wrap = (entries: typeof vspec.appProvides, values: unknown[], child: unknown) =>
      entries.reduceRight((acc, en, i) => (en.key in ctxs ? h(ctxs[en.key].Provider, { value: values[i] }, acc as never) : acc), child);
    const comps = new Map<string, () => unknown>();
    const build = (c: (typeof vspec.components)[number]): (() => unknown) => {
      if (comps.has(c.id)) return comps.get(c.id)!;
      const kids = vspec.components.filter((k) => k.parent === c.id).map(build);
      const Comp = () => {
        const [values] = React.useState(() => c.provides.map((p) => make(p.value)));
        for (const id of Object.keys(ctxs)) seen[`${c.id}:${id}`] = show(React.useContext(ctxs[id]));
        return wrap(c.provides, values, kids.map((k, i) => h(k as never, { key: i })));
      };
      comps.set(c.id, Comp);
      return Comp;
    };
    const App = build(vspec.components.find((c) => !c.parent)!);
    const topValues = vspec.appProvides.map((p) => make(p.value));
    ReactServer.renderToString(wrap(vspec.appProvides, topValues, h(App as never)) as never);

    const tree = mountReact(t.DEMO_SPEC, t.DEMO_DEFAULTS);
    const api = new Function(`${t.REACT_CONTEXT_CODE}\nreturn readContext;`)() as (tr: typeof tree, id: string, key: string) => { value: unknown };
    for (const key of Object.keys(seen)) {
      const [id, token] = key.split(':');
      expect(show(api(tree, id, token).value), key).toEqual(seen[key]);
    }
    expect(Object.keys(seen).length).toBe(6 * 5);
  });

  it('REACT_USE_CODE печатает то, что в теме', async () => {
    expect((await runSnippet(t.REACT_USE_CODE)).out).toEqual(t.REACT_USE_OUT);
  });

  it('Provider — это сам контекст; value={undefined} перекрывает значение по умолчанию', () => {
    const Ctx = React.createContext('по умолчанию');
    expect(Ctx.Provider).toBe(Ctx);
    let got: unknown = 'не прочитано';
    const Read = () => ((got = React.useContext(Ctx)), null);
    ReactServer.renderToString(React.createElement(Ctx, { value: undefined as never }, React.createElement(Read)));
    expect(got).toBeUndefined();
    expect(React.version).toBe('19.3.0');
  });
});

// ─── Angular: примеры и ошибки ───────────────────────────────────────────────────────────

describe('Angular 21: примеры темы и тексты ошибок', () => {
  it('версии стенда', () => {
    expect(ng.VERSION.full).toBe('21.2.25');
    expect(vue.version).toBe('3.5.42');
  });

  it('без DI: Cart сам создаёт PriceApi и в тесте идёт в сеть', async () => {
    const { exports } = await runSnippet(t.CART_PLAIN_CODE);
    const Cart = exports.Cart as new () => { total(ids: string[]): Promise<number> };
    await expect(new Cart().total(['a'])).rejects.toThrow(TypeError);
  });

  it('с DI: TestBed подменяет PriceApi, и спека темы проходит', async () => {
    // Платформа браузера уже создана `createApplication` выше; у TestBed — своя, тестовая.
    ng.destroyPlatform();
    ngTesting.TestBed.initTestEnvironment(pbTesting.BrowserTestingModule, pbTesting.platformBrowserTesting());
    try {
      const run = await runSnippet(`${t.CART_DI_CODE}\n\n${t.CART_SPEC_CODE}`);
      expect(run.specs.map(([name]) => name)).toEqual(['считает сумму без сети']);
      for (const [, fn] of run.specs) await fn();
      // Без подмены та же корзина идёт в fetch — подделка действительно сработала.
      ngTesting.TestBed.resetTestingModule();
      const real = ngTesting.TestBed.inject(run.exports.Cart as never) as { total(ids: string[]): Promise<number> };
      await expect(real.total(['a'])).rejects.toThrow(TypeError);
    } finally {
      ngTesting.TestBed.resetTestingModule();
      ngTesting.TestBed.resetTestEnvironment();
      ng.destroyPlatform();
    }
  });

  it('TOKENS_CODE печатает то, что в теме', async () => {
    expect((await runSnippet(t.TOKENS_CODE)).out).toEqual(t.TOKENS_OUT);
  });

  it('MENU_CODE: inject с флагами и декораторы параметров дают одно и то же', async () => {
    const run = await runSnippet(t.MENU_CODE);
    expect(run.out).toEqual(t.MENU_OUT);
  });

  it('CYCLE_CODE: NG0200, NG0201 и «цикл» после неудачного создания', async () => {
    expect((await runSnippet(t.CYCLE_CODE)).out).toEqual(t.CYCLE_OUT);
  });

  it('NG0203 вне контекста внедрения и после await', async () => {
    class Logger {}
    Injectable({ providedIn: 'root' })(Logger);
    expect(errText(() => inject(Logger))).toBe(t.NG0203_TEXT);
    const injector = Injector.create({ providers: [] });
    const late = await ng.runInInjectionContext(injector, async () => {
      await Promise.resolve();
      return errText(() => inject(Logger));
    });
    expect(late).toMatch(/^NG0203:/);
  });

  it('NG0201 с self или host: текст «found in NodeInjector»', async () => {
    const msgs: string[] = [];
    const T = new InjectionToken('T');
    class C {
      constructor() {
        msgs.push(errText(() => inject(T, { self: true })), errText(() => inject(T, { host: true })), errText(() => inject(T)));
      }
    }
    Component({ selector: 'di-msg', template: '' })(C);
    const app = await pb.createApplication();
    const host = document.createElement('div');
    document.body.append(host);
    ng.createComponent(C, { environmentInjector: app.injector, hostElement: host });
    expect(msgs[0]).toMatch(/^NG0201: No provider for InjectionToken T found in NodeInjector\./);
    expect(msgs[1]).toMatch(/^NG0201: No provider for InjectionToken T found in NodeInjector\./);
    expect(msgs[2]).toMatch(/^NG0201: No provider found for `InjectionToken T`\. Source: Environment Injector\./);
  });

  it('в продакшене от сообщений остаются коды', () => {
    const script = `
      globalThis.ngDevMode = false;
      await import('@angular/compiler');
      const { inject, Injector, InjectionToken } = await import('@angular/core');
      const C = new InjectionToken('C'), D = new InjectionToken('D');
      const inj = Injector.create({ providers: [{ provide: C, useFactory: () => inject(D) }, { provide: D, useFactory: () => inject(C) }] });
      const out = [];
      for (const tk of [C, new InjectionToken('Z')]) { try { inj.get(tk); } catch (e) { out.push(e.message); } }
      console.log(JSON.stringify(out));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(out)).toEqual(t.PROD_ERRORS);
  });

  it('multi и обычный провайдер одного токена в одном инжекторе — ошибка', () => {
    const P = new InjectionToken('P');
    expect(errText(() => Injector.create({ providers: [{ provide: P, useValue: 'a', multi: true }, { provide: P, useValue: 'b' }] }))).toBe('Cannot mix multi providers and regular providers');
  });

  it('InjectionToken с фабрикой без providedIn работает как root', async () => {
    const T = new InjectionToken('T', { factory: () => 'из фабрики' });
    const app = await pb.createApplication();
    const child = createEnvironmentInjector([], app.injector);
    expect(child.get(T)).toBe('из фабрики');
    expect(child.get(T, null, { self: true })).toBeNull();
  });

  it('иерархия окружений: корень с областью root, над ним платформа', async () => {
    const app = await pb.createApplication();
    const scopes = (inj: unknown) => [...((inj as { scopes: Set<string> }).scopes ?? [])];
    expect(scopes(app.injector)).toEqual(['environment', 'root']);
    const platform = (app.injector as unknown as { parent: unknown }).parent;
    expect(scopes(platform)).toEqual(['platform']);
    expect((platform as { parent: { constructor: { name: string } } }).parent.constructor.name).toBe('NullInjector');
  });

  it('провайдер компонента: лениво и уничтожается вместе с компонентом', async () => {
    const log: string[] = [];
    class Svc {
      constructor() {
        log.push('создан');
      }
      ngOnDestroy() {
        log.push('уничтожен');
      }
    }
    let lazyMade = false;
    class Lazy {
      constructor() {
        lazyMade = true;
      }
    }
    class C {
      svc = inject(Svc);
    }
    Component({ selector: 'di-life', template: '', providers: [Svc, Lazy] })(C);
    const app = await pb.createApplication();
    const host = document.createElement('div');
    document.body.append(host);
    const ref = ng.createComponent(C, { environmentInjector: app.injector, hostElement: host });
    ref.destroy();
    expect(log).toEqual(['создан', 'уничтожен']);
    expect(lazyMade).toBe(false);
  });

  it('viewProviders не видит содержимое из <ng-content>', async () => {
    const T = new InjectionToken('T');
    const seen: Record<string, unknown> = {};
    class Inner {
      constructor() {
        seen.inner = inject(T, { optional: true });
      }
    }
    Component({ selector: 'di-inner', template: '' })(Inner);
    class Outer {}
    Component({ selector: 'di-outer', template: '<ng-content /><di-inner />', imports: [Inner], viewProviders: [{ provide: T, useValue: 'из viewProviders' }] })(Outer);
    class Projected {
      constructor() {
        seen.projected = inject(T, { optional: true });
      }
    }
    Component({ selector: 'di-projected', template: '' })(Projected);
    class Root {}
    Component({ selector: 'di-proj-root', template: '<di-outer><di-projected /></di-outer>', imports: [Outer, Projected] })(Root);
    const app = await pb.createApplication();
    const host = document.createElement('div');
    document.body.append(host);
    ng.createComponent(Root, { environmentInjector: app.injector, hostElement: host }).changeDetectorRef.detectChanges();
    expect(seen).toEqual({ projected: null, inner: 'из viewProviders' });
  });

  it('исходник Angular: NOT_YET/CIRCULAR, область root, флаги и блум-фильтр на 256 бит', () => {
    const chunk = (name: string) => readFileSync(`${root}node_modules/@angular/core/fesm2022/${name}`, 'utf8');
    const r3 = chunk('_effect-chunk2.mjs');
    expect(r3).toContain('const NOT_YET = {};');
    expect(r3).toContain('const CIRCULAR = {};');
    expect(r3).toContain('if (record.value === CIRCULAR) {');
    expect(r3).toContain('record.value = CIRCULAR;');
    expect(r3).toContain('injectableDefInScope(def) {');
    expect(r3).toContain('return providedIn === \'any\' || this.scopes.has(providedIn);');
    const node = chunk('_debug_node-chunk.mjs');
    expect(node).toContain('const BLOOM_SIZE = 256;');
    expect(node).toContain('function shouldSearchParent(flags, isFirstHostTNode) {');
    expect(node).toContain('factory.resolving = false;');
    expect(node).toContain('if ((flags & (2 | 1)) === 0) {');
  });
});

// ─── Демо ──────────────────────────────────────────────────────────────────────────────────

describe('демо: тот же модуль, что на странице', () => {
  const lab = () => createLab(t.DEMO_SPEC, { angular: t.ANGULAR_DI_CODE, vue: t.VUE_PROVIDE_CODE, react: t.REACT_CONTEXT_CODE }, t.DEMO_DEFAULTS);

  it('второй запрос того же токена — «уже создан», после сброса — снова создаётся', () => {
    const l = lab();
    expect(l.ask('angular', 'CardA', 'Store').trace.at(-1)).toMatchObject({ at: 'CardA', step: 'create' });
    expect(l.ask('angular', 'CardA', 'Store').trace.at(-1)).toMatchObject({ at: 'CardA', step: 'hit' });
    l.reset();
    expect(l.ask('angular', 'CardA', 'Store').trace.at(-1)).toMatchObject({ step: 'create' });
  });

  it('цикл показан ошибкой с путём', () => {
    const r = lab().ask('angular', 'Menu', 'Auth');
    expect(r.error?.code).toBe('NG0200');
    expect(r.error?.message).toContain('Path: Auth -> Session -> Auth');
    expect(r.trace.map((s) => s.step)).toContain('cycle');
  });

  it('путь Vue пропускает компоненты без provide: у Menu — сразу App', () => {
    const r = lab().ask('vue', 'Menu', 'Store');
    expect(r.trace.map((s) => s.at)).toEqual(['App']);
  });

  it('размеры учебных версий — как в лиде раздела «Своими руками»', () => {
    const lines = (code: string) => code.split('\n').length;
    // «Полторы сотни строк», «сорока и двадцати»: держим порядок, а не точное число.
    expect(lines(t.ANGULAR_DI_CODE)).toBeGreaterThan(130);
    expect(lines(t.ANGULAR_DI_CODE)).toBeLessThan(165);
    expect(Math.abs(lines(t.VUE_PROVIDE_CODE) - 40)).toBeLessThan(6);
    expect(Math.abs(lines(t.REACT_CONTEXT_CODE) - 20)).toBeLessThan(4);
  });

  it('у всех токенов демо есть описание, у цикла нет смысла во Vue и React', () => {
    expect(t.DEMO_TOKENS.map((tk) => tk.id)).toEqual(['Store', 'Logger', 'Api', 'THEME', 'PLUGINS', 'Auth']);
    expect(t.DEMO_TOKENS.filter((tk) => !tk.plain).map((tk) => tk.id)).toEqual(['Auth']);
  });
});
