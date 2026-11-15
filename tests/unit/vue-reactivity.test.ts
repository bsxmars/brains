// Настоящий Vue 3.5.42 в happy-dom: это проверки реактивности и DOM, не стоимости кадра.
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';
import { afterAll, describe, expect, it } from 'vitest';
import { FLUSH_HEAD, FLUSH_ROWS, GLOSSARY, GRAPH_FACTS, PITFALLS, REF_VS_REACTIVE, SCOPE_NOTE } from '@/content/frameworks/vue-reactivity/data';

const require = createRequire(import.meta.url);
const win = new Window();
const KEYS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'Event', 'MouseEvent'];
const saved = new Map(KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
for (const k of KEYS) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? win : (win as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
}
afterAll(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
});
const Vue = require('vue') as typeof import('vue');
const { computed, createApp, effect, h, KeepAlive, nextTick, ref, watch, watchEffect } = Vue;

describe('границы контейнера и области Vue 3.5', () => {
  it('чтение внутри колбэка watch не расширяет его источник', () => {
    const source = ref(0), other = ref(0);
    let calls = 0;
    const stopWatcher = watch(source, () => { calls++; void other.value; }, { flush: 'sync' });
    source.value++;
    other.value++;
    expect(calls).toBe(1);
    stopWatcher();
    expect(GLOSSARY.find((term) => term.k === 'эффект')?.d).toContain('чтения внутри колбэка к ним не добавляются');
  });
  it('деструктуризация value оставляет снимок, computed переживает stop области', () => {
    const n = ref(1);
    const { value } = n;
    const scope = Vue.effectScope();
    const c = scope.run(() => computed(() => n.value * 2))!;
    expect(c.value).toBe(2);
    scope.stop();
    n.value = 2;
    expect([value, c.value]).toEqual([1, 4]);
    // Рекомендация ref не означает невозможность потерять связь или остановку computed.
    expect(REF_VS_REACTIVE).toContain('тоже теряет связь');
    expect(SCOPE_NOTE).toContain('не регистрируется в списке эффектов');
  });

  it('конечный ref в интерполяции разворачивается, доступ к элементу массива — нет', async () => {
    const arr = Vue.reactive([ref(2)]);
    expect(Vue.isRef(arr[0])).toBe(true);
    const { app, el } = mount({ setup: () => ({ arr }), render: Vue.compile('<p>{{ arr[0] }}</p>') });
    expect(el.textContent).toBe('2');
    arr[0]!.value = 3;
    await nextTick();
    expect(el.textContent).toBe('3');
    app.unmount();
    expect(PITFALLS.find((p) => p.n === '5.7')?.d).toContain('разворот при выводе');
  });
});

const mount = (root: Parameters<typeof createApp>[0]) => {
  const el = win.document.createElement('div') as unknown as Element;
  win.document.body.appendChild(el as never);
  const app = createApp(root);
  app.mount(el);
  return { app, el };
};

describe('GRAPH_FACTS: computed, который пишет в свой источник', () => {
  it('ошибки нет, эффект записи не видит, кеш не держится', () => {
    const n = ref(0);
    let calls = 0;
    const seen: number[] = [];
    const c = computed(() => {
      calls++;
      const v = n.value;
      n.value = v + 1;
      return v;
    });
    expect(() => effect(() => void seen.push(c.value))).not.toThrow();
    expect([calls, seen, n.value]).toEqual([1, [0], 1]);
    void c.value;
    void c.value;
    expect(calls).toBe(3);
    const fact = GRAPH_FACTS.find((f) => f.t.includes('побочных эффектов'))!;
    expect(fact.d).not.toContain('Maximum recursive updates exceeded');
    expect(fact.d).toContain('кеш не держится');
  });
});

describe('FLUSH_ROWS «Компонент размонтирован»', () => {
  it('pre и post отброшены, sync выполнен на записи', async () => {
    const log: string[] = [];
    const n = ref(0);
    const show = ref(true);
    const Child = {
      setup() {
        watch(n, () => void log.push('pre'));
        watch(n, () => void log.push('post'), { flush: 'post' });
        watch(n, () => void log.push('sync'), { flush: 'sync' });
        return () => h('p', n.value);
      },
    };
    const { app } = mount({ render: () => (show.value ? h(Child) : null) });
    n.value++;
    show.value = false;
    await nextTick();
    await nextTick();
    app.unmount();
    expect(log).toEqual(['sync']);
    const row = FLUSH_ROWS.find((r) => r[0] === 'Компонент размонтирован')!;
    expect(FLUSH_HEAD.slice(1)).toEqual(["'pre' · по умолчанию", "'post'", "'sync'"]);
    expect(row.slice(1)).toEqual(['задание отброшено', 'задание отброшено', 'выполнится']);
  });
});

describe('PITFALLS 5.3: KeepAlive не приостанавливает рендер', () => {
  it('скрытый компонент перерисовывается и его watchEffect срабатывает', async () => {
    const n = ref(0);
    const show = ref(true);
    let renders = 0;
    let effects = 0;
    const A = {
      setup() {
        watchEffect(() => {
          void n.value;
          effects++;
        });
        return () => (renders++, h('p', n.value));
      },
    };
    const B = { render: () => h('i', 'b') };
    const { app, el } = mount({ render: () => h(KeepAlive, null, [show.value ? h(A) : h(B)]) });
    show.value = false;
    await nextTick();
    const [r0, e0] = [renders, effects];
    n.value++;
    await nextTick();
    expect([renders - r0, effects - e0]).toEqual([1, 1]);
    expect(el.innerHTML).toBe('<i>b</i>');
    app.unmount();
    const p = PITFALLS.find((x) => x.n === '5.3')!;
    expect(p.d).not.toContain('приостановлен через `pause`');
    expect(p.d).toContain('скрытый компонент перерисовывается');
  });
});
