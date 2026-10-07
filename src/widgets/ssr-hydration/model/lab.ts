import type * as ReactNS from 'react';
import type * as ReactClient from 'react-dom/client';
import type * as VueNS from 'vue';
import type { CreatedRow, Hydrated, HydrationRun, NodeRow, OrderProps, Variant, VariantSpec } from './types';

/**
 * Гидратация настоящим React и настоящим Vue — поверх серверной разметки, в браузере читателя.
 *
 * Ровно этот модуль исполняет и `tests/unit/ssr-hydration.test.ts`: тест собирает его вместе
 * с продакшен-сборками обеих библиотек и гоняет в Chromium. Демо и тест спрашивают библиотеки
 * одним и тем же кодом — иначе «проверено тестом» значило бы «проверено что-то похожее».
 *
 * Библиотеки приходят параметром, а не импортом: демо подгружает React только по кнопке
 * (на странице без клика его нет ни байта), а тест подкладывает ту сборку, которую проверяет.
 *
 * Как отвечает, что стало с узлом: ссылки на все узлы контейнера снимаются ДО гидратации,
 * а после неё для каждой проверяется, лежит ли тот же объект в документе. Это единственный
 * честный способ отличить «узел забрали» от «узел выбросили и создали такой же» — по разметке
 * их не различить: в обоих случаях она одинаковая.
 */

/** Время сборки на сервере и в браузере: как `new Date()`, вызванный в двух местах. */
export const SERVER_STAMP = '12:00:00';
export const CLIENT_STAMP = '12:00:03';

/** Класс темы: сервер не знает, что у читателя тёмная. */
export const SERVER_THEME = 'day';
export const CLIENT_THEME = 'night';

export const VARIANTS: Record<Variant, VariantSpec> = {
  match: {
    server: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    client: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    inject: false,
  },
  text: {
    server: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    client: { stamp: CLIENT_STAMP, theme: SERVER_THEME },
    inject: false,
  },
  attr: {
    server: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    client: { stamp: SERVER_STAMP, theme: CLIENT_THEME },
    inject: false,
  },
  extension: {
    server: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    client: { stamp: SERVER_STAMP, theme: SERVER_THEME },
    inject: true,
  },
};

/**
 * «Расширение браузера»: узел, которого нет ни на сервере, ни в клиентском дереве.
 * Встаёт внутрь `<section>`, сразу после заголовка, — туда, куда расширения-переводчики
 * и проверялки орфографии и правда вставляют свои кнопки.
 */
export function injectExtension(container: HTMLElement): void {
  const section = container.querySelector('section');
  if (!section) return;
  const node = document.createElement('span');
  node.setAttribute('data-ext', '');
  node.textContent = 'Перевести';
  section.insertBefore(node, section.children[1] ?? null);
}

/** Сквозной пример из `data.ts` — строкой — в компонент. Та же строка напечатана в теме. */
export function loadReactOrder(code: string, React: typeof ReactNS) {
  return new Function('h', 'useState', 'Suspense', `${code}\nreturn Order;`)(
    React.createElement,
    React.useState,
    React.Suspense,
  ) as (props: OrderProps) => ReactNS.ReactNode;
}

export function loadVueOrder(code: string, Vue: VueLibs) {
  return new Function('h', 'ref', `${code}\nreturn Order;`)(Vue.h, Vue.ref) as VueNS.Component;
}

export interface ReactLibs {
  React: typeof ReactNS;
  client: typeof ReactClient;
}

export type VueLibs = Pick<typeof VueNS, 'createSSRApp' | 'createApp' | 'h' | 'ref'>;

// ---------------------------------------------------------------------------
// Снимок узлов
// ---------------------------------------------------------------------------

interface Snap {
  node: Node;
  label: string;
  depth: number;
  text: string | null;
}

function label(node: Node): string {
  if (node.nodeType === 3) return `"${(node as Text).data}"`;
  if (node.nodeType === 8) return `<!--${(node as Comment).data}-->`;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (el.hasAttribute('data-ext')) return `<${tag} data-ext>`;
  const cls = el.getAttribute('class');
  return cls ? `<${tag}.${cls}>` : `<${tag}>`;
}

function depthOf(node: Node, root: Node): number {
  let depth = 0;
  for (let p = node.parentNode; p && p !== root; p = p.parentNode) depth++;
  return depth;
}

function walk(root: Node): Node[] {
  const out: Node[] = [];
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, 0xffffffff);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
  return out;
}

function snapshot(root: Node): Snap[] {
  return walk(root).map((node) => ({
    node,
    label: label(node),
    depth: depthOf(node, root),
    text: node.nodeType === 1 ? null : (node as CharacterData).data,
  }));
}

/** Разметка без комментариев-маркеров: `<!-- -->` React и `<!--[-->` Vue — служебные. */
export function stripMarkers(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function compare(root: HTMLElement, before: Snap[], clientHtml: string, messages: string[]): HydrationRun {
  const nodes: NodeRow[] = before.map((snap) => {
    if (!root.contains(snap.node)) return { label: snap.label, depth: snap.depth, fate: 'dropped' };
    const now = snap.node.nodeType === 1 ? null : (snap.node as CharacterData).data;
    if (now !== snap.text) return { label: snap.label, depth: snap.depth, fate: 'patched', now: `"${now}"` };
    return { label: snap.label, depth: snap.depth, fate: 'kept' };
  });

  const known = new Set(before.map((snap) => snap.node));
  const created: CreatedRow[] = walk(root)
    .filter((node) => !known.has(node))
    .map((node) => ({ label: label(node), depth: depthOf(node, root) }));

  const html = root.innerHTML;
  return {
    nodes,
    created,
    messages,
    html,
    clientHtml,
    matchesClient: stripMarkers(html) === stripMarkers(clientHtml),
  };
}

/** Перехват консоли на время гидратации: Vue сообщает о несовпадениях только туда. */
function captureConsole(messages: string[]): () => void {
  const { error, warn } = console;
  console.error = (...args: unknown[]) => void messages.push(args.map(String).join(' '));
  console.warn = (...args: unknown[]) => void messages.push(args.map(String).join(' '));
  return () => {
    console.error = error;
    console.warn = warn;
  };
}

const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

/**
 * Дождаться, пока React закончит: `hydrateRoot` возвращается раньше, чем вызвана хоть одна
 * функция компонента, — гидратация идёт отдельной задачей. Сигнал — эффект обёртки над
 * корнем; две задачи сверху — запас на повторный рендер границы после несовпадения.
 */
function withSignal(React: typeof ReactNS, child: ReactNS.ReactNode): [ReactNS.ReactElement, Promise<void>] {
  let done!: () => void;
  const signal = new Promise<void>((resolve) => (done = resolve));
  function Signal(props: { children: ReactNS.ReactNode }) {
    React.useEffect(() => done(), []);
    return props.children;
  }
  return [React.createElement(Signal, null, child), signal];
}

async function renderReactFresh(code: string, props: OrderProps, libs: ReactLibs): Promise<string> {
  const Order = loadReactOrder(code, libs.React);
  const box = document.createElement('div');
  const root = libs.client.createRoot(box);
  const [tree, signal] = withSignal(libs.React, libs.React.createElement(Order, props));
  root.render(tree);
  await signal;
  await macrotask();
  const html = box.innerHTML;
  root.unmount();
  return html;
}

/**
 * Серверная разметка уже лежит в `container`. Гидратировать её `hydrateRoot` с пропами
 * клиента и рассказать, что стало с каждым узлом.
 */
export async function hydrateReact(
  container: HTMLElement,
  code: string,
  props: OrderProps,
  libs: ReactLibs,
): Promise<Hydrated> {
  const clientHtml = await renderReactFresh(code, props, libs);
  const before = snapshot(container);
  const messages: string[] = [];
  const Order = loadReactOrder(code, libs.React);
  const [tree, signal] = withSignal(libs.React, libs.React.createElement(Order, props));

  const restore = captureConsole(messages);
  let root: ReactClient.Root;
  try {
    root = libs.client.hydrateRoot(container, tree, {
      onRecoverableError: (error) => void messages.push(String((error as Error)?.message ?? error)),
    });
    await signal;
    await macrotask();
    await macrotask();
  } finally {
    restore();
  }

  return { run: compare(container, before, clientHtml, messages), unmount: () => root.unmount() };
}

// ---------------------------------------------------------------------------
// Vue
// ---------------------------------------------------------------------------

function renderVueFresh(code: string, props: OrderProps, Vue: VueLibs): string {
  const box = document.createElement('div');
  const app = Vue.createApp(loadVueOrder(code, Vue), { ...props });
  app.mount(box);
  const html = box.innerHTML;
  app.unmount();
  return html;
}

/** То же для Vue: `createSSRApp(...).mount(container)` — и отчёт по узлам. */
export async function hydrateVue(
  container: HTMLElement,
  code: string,
  props: OrderProps,
  Vue: VueLibs,
): Promise<Hydrated> {
  const clientHtml = renderVueFresh(code, props, Vue);
  const before = snapshot(container);
  const messages: string[] = [];
  const app = Vue.createSSRApp(loadVueOrder(code, Vue), { ...props });

  const restore = captureConsole(messages);
  try {
    app.mount(container);   // гидратация у Vue синхронная: отчёт готов, когда mount вернулся
    await macrotask();
  } finally {
    restore();
  }

  return { run: compare(container, before, clientHtml, messages), unmount: () => app.unmount() };
}

/** Положить серверную разметку в контейнер — и, если так задумано, «узел расширения» поверх. */
export function serve(container: HTMLElement, html: string, spec: VariantSpec): void {
  container.innerHTML = html;
  if (spec.inject) injectExtension(container);
}
