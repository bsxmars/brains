import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Window } from 'happy-dom';
import {
  dehydrate,
  environmentManager,
  focusManager,
  hashKey,
  hydrate,
  MutationObserver,
  onlineManager,
  partialMatchKey,
  QueryClient,
  QueryObserver,
  replaceEqualDeep,
  type QueryObserverResult,
} from '@tanstack/query-core';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as t from '@/content/frameworks/data-cache/data';
import { collapse, createLab, describe as describeSnap, loadMini, MOUNT, UNMOUNT } from '@/widgets/query-cache-lab/model/run';
import type { MiniCodes, Scenario, Step, Trace, Who } from '@/widgets/query-cache-lab/model/types';

/**
 * Тема «Кеш данных на клиенте: TanStack Query и SWR».
 *
 * Строки мини-кеша из темы исполняются здесь тем же `createLab`, что крутит демо, и сверяются
 * с `@tanstack/query-core` 5.104 на всех сценариях `SCENARIOS` при всех `staleTime` демо:
 * в какие моменты ушли запросы и какие состояния получил каждый наблюдатель. Литералы темы
 * (`TRACES`, `SWR_TRACES`, `HASHES`, `SHARE_REFS`, `NOTIFY_COUNTS`, `HYDRATE_CALLS`,
 * `SERVER_DEFAULTS`, `OFFLINE_SEEN`) пересобираются из библиотек — сменится поведение версии,
 * покраснеет здесь.
 *
 * Время — фейковые таймеры vitest; мини-кеш живёт на своих виртуальных часах. SWR 2.5 — хук,
 * без React его не запустить: компонент на `useSWR` рендерится в happy-dom (глобалы ставятся
 * до загрузки `react-dom` и `swr`, оба грузятся через `require`, чтобы React был один).
 * `Math.random` в прогонах SWR зафиксирован на 0,5: от него зависит пауза перед повтором.
 *
 * `DUMP=1` пишет снятое в `DUMP_TO` — так литералы и заполнялись.
 */

const require = createRequire(import.meta.url);

// ─── DOM для SWR ───────────────────────────────────────────────────────────────────────────

const win = new Window({ url: 'http://localhost/' });
// Без rAF SWR откладывает фоновое обновление через setTimeout(…, 1) — его видят фейковые таймеры.
(win as unknown as Record<string, unknown>).requestAnimationFrame = undefined;
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'Event'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const swr = require('swr') as typeof import('swr');
const useSWR = swr.default;
const { SWRConfig, useSWRConfig } = swr;
const { act, createElement: h, useState } = React;

const dump: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.DUMP) writeFileSync(process.env.DUMP_TO ?? 'data-cache-dump.json', JSON.stringify(dump, null, 1));
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
});

// ─── Общее ─────────────────────────────────────────────────────────────────────────────────

const CODES: MiniCodes = {
  key: t.KEY_CODE,
  cache: t.CACHE_CODE,
  observe: t.OBSERVE_CODE,
  invalidate: t.INVALIDATE_CODE,
  optimistic: t.OPTIMISTIC_CODE,
  share: t.SHARE_CODE,
};
const mini = loadMini(CODES);
const LAT = t.SERVER_LATENCY;
const scenario = (id: string): Scenario => t.SCENARIOS.find((s) => s.id === id)!;

/** Учебный сервер на фейковых таймерах — тот же, что `createLab` держит на виртуальных. */
function fakeServer() {
  const s = { todos: [...t.SERVER_TODOS], failNext: 0, calls: [] as number[], posts: [] as number[] };
  const get = (): Promise<string[]> => {
    s.calls.push(Date.now());
    const fail = s.failNext > 0;
    if (fail) s.failNext--;
    return new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error('503')) : res([...s.todos])), LAT));
  };
  const send = (fail: boolean) => (title: string): Promise<void> => {
    s.posts.push(Date.now());
    return new Promise((res, rej) =>
      setTimeout(() => {
        if (fail) rej(new Error('500'));
        else {
          s.todos.push(title);
          res();
        }
      }, LAT),
    );
  };
  return { s, get, send };
}

const tqSnap = (r: QueryObserverResult) =>
  describeSnap({ status: r.status, fetchStatus: r.fetchStatus === 'paused' ? 'idle' : r.fetchStatus, data: r.data, failures: r.failureCount });

function useClientMode() {
  beforeEach(() => {
    environmentManager.setIsServer(() => false);
    vi.useFakeTimers();
    vi.setSystemTime(0);
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
}

/** Сценарий на `query-core`: те же шаги, что у демо, мутация — строкой `TQ_MUTATION_CODE`. */
async function runTq(sc: Scenario, staleTime: number, mutationCode = t.TQ_MUTATION_CODE): Promise<Trace> {
  vi.setSystemTime(0);
  const { s, get, send } = fakeServer();
  const client = new QueryClient();
  client.mount();
  const seen: Record<Who, string[]> = { A: [], B: [] };
  const subs = new Map<Who, () => void>();
  for (const step of sc.steps as Step[]) {
    if (step.do === 'wait') await vi.advanceTimersByTimeAsync(step.ms);
    else if (step.do === 'mount') {
      seen[step.who].push(MOUNT);
      const o = new QueryObserver(client, { queryKey: ['todos'], queryFn: get, staleTime });
      const who = step.who;
      subs.set(who, o.subscribe((r) => seen[who].push(tqSnap(r))));
      seen[who].push(tqSnap(o.getCurrentResult()));
    } else if (step.do === 'unmount') {
      subs.get(step.who)!();
      subs.delete(step.who);
      seen[step.who].push(UNMOUNT);
    } else if (step.do === 'focus') {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    } else if (step.do === 'serverFails') s.failNext = step.n;
    else if (step.do === 'add') {
      new Function('MutationObserver', 'client', 'send', 'showError', mutationCode)(
        MutationObserver,
        client,
        send(Boolean(step.fail)),
        () => {},
      );
    }
    await vi.advanceTimersByTimeAsync(0);
  }
  for (const off of subs.values()) off();
  client.unmount();
  client.clear();
  return { calls: s.calls, posts: s.posts, seen: { A: collapse(seen.A), B: collapse(seen.B) } };
}

async function runLab(sc: Scenario, staleTime: number): Promise<Trace> {
  const lab = createLab(CODES, { staleTime, latency: LAT, todos: t.SERVER_TODOS });
  for (const step of sc.steps) await lab.run(step);
  lab.stop();
  return lab.trace();
}

const traceLiteral = (tr: Trace): t.TraceLiteral => ({
  calls: tr.calls,
  seen: tr.seen.B.length ? { A: tr.seen.A, B: tr.seen.B } : { A: tr.seen.A },
});

// ─── Мини-кеш против query-core ────────────────────────────────────────────────────────────

describe('сценарии: мини-кеш демо против @tanstack/query-core', () => {
  useClientMode();

  const cases = t.SCENARIOS.flatMap((sc) => t.STALE_OPTIONS.map((o) => [sc.id, o.value, o.ms] as const));
  it.each(cases)('%s при staleTime %s — те же запросы и те же состояния', async (id, value, ms) => {
    const sc = scenario(id);
    const tq = await runTq(sc, ms);
    const lab = await runLab(sc, ms);
    expect(lab).toEqual(tq);
    dump[`traces.${id}:${value}`] = traceLiteral(tq);
    const literal = t.TRACES[`${id}:${value}`];
    if (literal) expect(traceLiteral(tq), `TRACES['${id}:${value}'] разошёлся с query-core`).toEqual(literal);
  });

  it('гонка без cancelQueries: старый ответ затирает оптимистичный список', async () => {
    const without = t.TQ_MUTATION_CODE.replace("    await client.cancelQueries({ queryKey: ['todos'] });\n", '');
    expect(without).not.toBe(t.TQ_MUTATION_CODE);
    const tr = traceLiteral(await runTq(scenario('race'), 0, without));
    dump['traces.race-nocancel:0'] = tr;
    expect(tr).toEqual(t.TRACES['race-nocancel:0']);
    // RACE_NOTE: «через 0,2 с после оптимистичной записи» — фокус в 1000, добавление в 1100.
    expect(tr.calls[1] + LAT - 1100).toBe(200);
    expect(t.RACE_NOTE).toContain('через 0,2 с');
  });

  it('быстрое возвращение (QUICK_RETURN): при staleTime 0 — второй запрос', async () => {
    const sc: Scenario = { id: 'quick', label: '', note: '', steps: t.QUICK_RETURN };
    const tq = await runTq(sc, 0);
    expect(await runLab(sc, 0)).toEqual(tq);
    dump['traces.quick:0'] = traceLiteral(tq);
    expect(traceLiteral(tq)).toEqual(t.TRACES['quick:0']);
  });

  it('в TRACES нет ключей, которых не прогоняли', () => {
    const known = new Set([...t.SCENARIOS.flatMap((sc) => t.STALE_OPTIONS.map((o) => `${sc.id}:${o.value}`)), 'race-nocancel:0', 'quick:0']);
    for (const k of Object.keys(t.TRACES)) expect(known.has(k), k).toBe(true);
    expect(Object.keys(t.TRACES).length).toBeGreaterThan(5);
  });
});

// ─── Ключ, ссылки, уведомления ─────────────────────────────────────────────────────────────

describe('ключ и структурное разделение', () => {
  it('HASHES: hashKey темы совпадает с query-core', () => {
    expect(t.HASHES.length).toBeGreaterThan(2);
    for (const { key, hash } of t.HASHES) {
      const k = new Function(`return ${key};`)() as unknown[];
      expect(hashKey(k)).toBe(hash);
      expect(mini.hashKey(k)).toBe(hash);
    }
  });

  it('startsWith совпадает с partialMatchKey на ключах-массивах', () => {
    const pairs: [unknown[], unknown[]][] = [
      [['todos'], ['todos']],
      [['todos', { done: true }], ['todos']],
      [['todo'], ['todos']],
      [['todos'], ['todos', 1]],
      [['user', 1], ['user', 2]],
      [['user', 1, 'posts'], ['user', 1]],
    ];
    for (const [a, b] of pairs) expect(mini.startsWith(a, b)).toBe(partialMatchKey(a, b));
  });

  it('Map в ключе превращается в {} — два разных Map дают один ключ', () => {
    const a = [new Map([[1, 'a']])];
    const b = [new Map()];
    expect(hashKey(a)).toBe(hashKey(b));
    expect(mini.hashKey(a)).toBe(mini.hashKey(b));
  });

  it('replaceEqualDeep темы совпадает с query-core: и на примере, и на случайных деревьях', () => {
    const refs = (r: typeof t.SHARE_PREV, prev: typeof t.SHARE_PREV) => [
      r === prev,
      r.user === prev.user,
      r.todos === prev.todos,
      r.todos[0] === prev.todos[0],
      r.todos[1] === prev.todos[1],
    ];
    const next = () => JSON.parse(JSON.stringify(t.SHARE_NEXT)) as typeof t.SHARE_NEXT;
    expect(refs(mini.replaceEqualDeep(t.SHARE_PREV, next()), t.SHARE_PREV)).toEqual(refs(replaceEqualDeep(t.SHARE_PREV, next()), t.SHARE_PREV));
    expect(refs(replaceEqualDeep(t.SHARE_PREV, next()), t.SHARE_PREV)).toEqual(t.SHARE_REFS.map((r) => r.tq));

    // Случайные деревья: где библиотека вернула старую ссылку, там и мини-версия.
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const tree = (d: number): unknown => {
      const r = rnd();
      if (d > 3 || r < 0.3) return Math.floor(rnd() * 3);
      if (r < 0.65) return Array.from({ length: Math.floor(rnd() * 4) }, () => tree(d + 1));
      return Object.fromEntries(Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => [`k${Math.floor(rnd() * 5)}${i}`, tree(d + 1)]));
    };
    const shape = (x: unknown, prev: unknown): unknown =>
      x === prev ? 'SAME' : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, shape(v, (prev as Record<string, unknown>)?.[k])])) : x;
    for (let i = 0; i < 400; i++) {
      const a = tree(0);
      const b = rnd() < 0.5 ? JSON.parse(JSON.stringify(a)) : tree(0);
      expect(shape(mini.replaceEqualDeep(a, b), a)).toEqual(shape(replaceEqualDeep(a, b), a));
    }
  });

  describe('уведомления при повторном ответе с тем же содержимым', () => {
    useClientMode();

    it('NOTIFY_COUNTS: подписка на data молчит только при структурном разделении', async () => {
      const counts: { k: string; n: number }[] = [];
      const payload = () => ({ user: { name: 'Аня' }, todos: ['молоко'] });
      for (const sharing of [true, false]) {
        const client = new QueryClient();
        const fn = () => new Promise((r) => setTimeout(() => r(payload()), LAT));
        const onlyData = new QueryObserver(client, { queryKey: ['me'], queryFn: fn, structuralSharing: sharing, notifyOnChangeProps: ['data'] });
        const all = new QueryObserver(client, { queryKey: ['me'], queryFn: fn, structuralSharing: sharing });
        let n = 0;
        let m = 0;
        onlyData.subscribe(() => n++);
        all.subscribe(() => m++);
        await vi.advanceTimersByTimeAsync(1000);
        n = 0;
        m = 0;
        void client.invalidateQueries({ queryKey: ['me'] });
        await vi.advanceTimersByTimeAsync(1000);
        counts.push({ k: `query-core, ${sharing ? 'с разделением' : 'без разделения'}: подписка на \`data\``, n });
        if (sharing) counts.push({ k: 'query-core: подписка на все поля', n: m });
        client.clear();
      }

      // Мини-версия: наблюдатель с fields: ['data'].
      const cache = mini.createCache({ now: () => Date.now(), after: (ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } });
      let k = 0;
      mini.observe(cache, ['me'], { fn: () => new Promise((r) => setTimeout(() => r(payload()), LAT)), fields: ['data'] }, () => k++);
      await vi.advanceTimersByTimeAsync(1000);
      k = 0;
      mini.invalidate(cache, ['me']);
      await vi.advanceTimersByTimeAsync(1000);
      counts.push({ k: 'мини-кеш темы: `fields: [\'data\']`', n: k });

      dump.notify = counts;
      expect(counts).toEqual(t.NOTIFY_COUNTS);
    });
  });
});

// ─── Сервер, гидратация, сеть ──────────────────────────────────────────────────────────────

describe('query-core: сервер, гидратация, сеть', () => {
  it('SERVER_DEFAULTS: на сервере ни одного повтора и бесконечный gcTime', async () => {
    const rows: { where: string; calls: number; gcTime: string }[] = [];
    for (const server of [false, true]) {
      environmentManager.setIsServer(() => server);
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const client = new QueryClient();
      let calls = 0;
      const o = new QueryObserver(client, {
        queryKey: ['x'],
        queryFn: () => {
          calls++;
          return Promise.reject(new Error('503'));
        },
      });
      const off = o.subscribe(() => {});
      await vi.advanceTimersByTimeAsync(60_000);
      off();
      const q = client.getQueryCache().find({ queryKey: ['x'] })!;
      rows.push({ where: server ? 'сервер' : 'браузер', calls, gcTime: q.gcTime === Infinity ? 'Infinity' : String(q.gcTime) });
      client.clear();
      vi.useRealTimers();
    }
    environmentManager.setIsServer(() => false);
    dump.serverDefaults = rows;
    expect(rows).toEqual(t.SERVER_DEFAULTS);
  });

  describe('в браузере', () => {
    useClientMode();

    it('HYDRATE_CODE: при staleTime 0 браузер повторяет запрос сервера', async () => {
      const rows: { staleTime: number; calls: number }[] = [];
      for (const staleTime of [0, 60_000]) {
        let calls = 0;
        let onServer = true;
        const getTodos = () => {
          if (!onServer) calls++;
          return Promise.resolve([...t.SERVER_TODOS]);
        };
        const body = t.HYDRATE_CODE.replace('// В браузере', 'markBrowser();\n// В браузере');
        const run = new Function(
          'QueryClient', 'QueryObserver', 'dehydrate', 'hydrate', 'getTodos', 'staleTime', 'render', 'markBrowser',
          `return (async () => {\n${body}\nreturn { json, client };\n})();`,
        );
        const { json } = await run(QueryClient, QueryObserver, dehydrate, hydrate, getTodos, staleTime, () => {}, () => (onServer = false));
        await vi.advanceTimersByTimeAsync(1000);
        // В JSON уезжает момент получения данных на сервере — по нему браузер судит о свежести.
        expect(JSON.parse(json).queries[0].state).toHaveProperty('dataUpdatedAt');
        rows.push({ staleTime, calls });
      }
      dump.hydrate = rows;
      expect(rows).toEqual(t.HYDRATE_CALLS);
    });

    it('OFFLINE_SEEN: без сети запрос ждёт в paused и уходит сам, когда сеть вернулась', async () => {
      const client = new QueryClient();
      client.mount();
      let calls = 0;
      const seen: string[] = [];
      onlineManager.setOnline(false);
      const o = new QueryObserver(client, {
        queryKey: ['p'],
        queryFn: () => {
          calls++;
          return Promise.resolve([...t.SERVER_TODOS]);
        },
      });
      const push = (r: QueryObserverResult) => seen.push(`${r.status} · ${r.fetchStatus}`);
      o.subscribe(push);
      push(o.getCurrentResult());
      await vi.advanceTimersByTimeAsync(5000);
      seen.push(`вызовов за 5 с: ${calls}`);
      onlineManager.setOnline(true);
      await vi.advanceTimersByTimeAsync(100);
      seen.push(`вызовов: ${calls}`);
      client.unmount();
      client.clear();
      dump.offline = collapse(seen);
      expect(collapse(seen)).toEqual(t.OFFLINE_SEEN);
    });

    it('NAIVE_CODE: два компонента — два запроса', async () => {
      let calls = 0;
      const shown: unknown[] = [];
      const getTodos = () => {
        calls++;
        return Promise.resolve([...t.SERVER_TODOS]);
      };
      new Function('getTodos', 'showHeader', 'showList', t.NAIVE_CODE)(getTodos, (s: unknown) => shown.push(s), (s: unknown) => shown.push(s));
      await vi.advanceTimersByTimeAsync(10);
      expect(calls).toBe(2);
      expect(shown).toHaveLength(4);
    });
  });
});

// ─── SWR ───────────────────────────────────────────────────────────────────────────────────

const swrSnap = (r: { isLoading: boolean; isValidating: boolean; data?: string[]; error?: unknown }) => {
  const parts: string[] = [];
  if (r.isLoading) parts.push('isLoading');
  if (r.isValidating) parts.push('isValidating');
  if (r.data) parts.push(`[${r.data.join(', ')}]`);
  if (r.error) parts.push('error');
  return parts.join(' · ') || 'пусто';
};

async function runSwr(steps: Step[]): Promise<Trace> {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const { s, get, send } = fakeServer();
  const seen: Record<Who, string[]> = { A: [], B: [] };
  let setShown: (ids: Who[]) => void = () => {};
  let mutate: unknown;
  const provider = () => new Map();
  function Comp({ id }: { id: Who }) {
    const r = useSWR('todos', get);
    seen[id].push(swrSnap(r));
    return null;
  }
  function Grab() {
    mutate = useSWRConfig().mutate;
    return null;
  }
  function App() {
    const [shown, set] = useState<Who[]>([]);
    setShown = set;
    return h(SWRConfig, { value: { provider } }, h(Grab), ...shown.map((id) => h(Comp, { key: id, id })));
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(h(App)));
  const shown = new Set<Who>();
  for (const step of steps) {
    if (step.do === 'wait') await act(async () => void (await vi.advanceTimersByTimeAsync(step.ms)));
    else if (step.do === 'mount' || step.do === 'unmount') {
      if (step.do === 'mount') shown.add(step.who);
      else shown.delete(step.who);
      seen[step.who].push(step.do === 'mount' ? MOUNT : UNMOUNT);
      await act(async () => setShown([...shown]));
    } else if (step.do === 'focus') await act(async () => void win.dispatchEvent(new win.Event('focus')));
    else if (step.do === 'serverFails') s.failNext = step.n;
    else if (step.do === 'add') {
      await act(async () => {
        new Function('mutate', 'send', 'showError', t.SWR_MUTATE_CODE)(mutate, send(Boolean(step.fail)), () => {});
      });
    }
  }
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
  return { calls: s.calls, posts: s.posts, seen: { A: collapse(seen.A), B: collapse(seen.B) } };
}

/** Сценарии SWR: те же, что у демо, плюс долгий прогон повторов. */
const SWR_RUNS: Record<string, Step[]> = {
  ...Object.fromEntries(t.SCENARIOS.filter((sc) => sc.id !== 'race').map((sc) => [sc.id, sc.steps])),
  'retry-long': [{ do: 'serverFails', n: 3 }, { do: 'mount', who: 'A' }, { do: 'wait', ms: 80_000 }],
  quick: t.QUICK_RETURN,
};

describe('SWR 2.5 на тех же сценариях', () => {
  it.each(Object.keys(SWR_RUNS))('%s — совпадает с SWR_TRACES', async (id) => {
    const tr = traceLiteral(await runSwr(SWR_RUNS[id]));
    dump[`swr.${id}`] = tr;
    expect(tr, `SWR_TRACES['${id}']`).toEqual(t.SWR_TRACES[id]);
  });

  it('SHARE_REFS: SWR сравнивает целиком — изменилось одно поле, новым стал весь ответ', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let n = 0;
    const payloads = [t.SHARE_PREV, t.SHARE_PREV, t.SHARE_NEXT];
    const get = () => new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(payloads[Math.min(n++, 2)]))), LAT));
    const datas: (typeof t.SHARE_PREV)[] = [];
    let renders = 0;
    let refetch: () => Promise<unknown> = async () => undefined;
    function Comp() {
      const { data, mutate } = useSWR('me', get);
      refetch = mutate;
      renders++;
      if (data && datas.at(-1) !== data) datas.push(data as typeof t.SHARE_PREV);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(h(SWRConfig, { value: { provider: () => new Map() } }, h(Comp))));
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    const r1 = renders;
    await act(async () => {
      void refetch();
      await vi.advanceTimersByTimeAsync(3000);
    });
    // Ответ совпал целиком: тот же объект, рендеров нет.
    expect(renders - r1).toBe(0);
    expect(datas).toHaveLength(1);
    await act(async () => {
      void refetch();
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(datas).toHaveLength(2);
    const [prev, next] = datas;
    const refs = [next === prev, next.user === prev.user, next.todos === prev.todos, next.todos[0] === prev.todos[0], next.todos[1] === prev.todos[1]];
    await act(async () => root.unmount());
    vi.useRealTimers();
    dump.shareSwr = refs;
    expect(refs).toEqual(t.SHARE_REFS.map((r) => r.swr));
  });
});

// ─── Числа в прозе ─────────────────────────────────────────────────────────────────────────

describe('числа в тексте совпадают с прогонами', () => {
  it('повторы: паузы 1, 2, 4 с — запросы в 0; 1,3; 3,6; 7,9 с', () => {
    expect(t.TRACES['retry:0'].calls).toEqual([0, 1300, 3600, 7900]);
    expect(t.RETRY_NOTE).toContain('1, 2, 4 с');
  });

  it('SWR: первый повтор через 10 с при random 0,5, ошибка видна после первой неудачи', () => {
    const tr = t.SWR_TRACES['retry-long'];
    expect(tr.calls[1] - (tr.calls[0] + LAT)).toBe(10_000);
    expect(tr.seen.A).toContain('error');
  });

  it('SWR: окно дедупликации 2 с от ответа — вернулись через секунду без запроса', () => {
    expect(t.SWR_TRACES.quick.calls).toEqual([0]);
    expect(t.TRACES['quick:0'].calls).toEqual([0, 1000]);
    // Через 2 с после ухода (2,7 с после ответа) окно уже закрыто: SWR идёт на сервер.
    expect(t.SWR_TRACES.remount.calls).toHaveLength(2);
  });

  it('SWR: запись живёт и через 5 минут, TanStack Query — нет', () => {
    expect(t.SWR_TRACES.gc.seen.A.filter((s) => s.startsWith('isLoading'))).toHaveLength(1);
    expect(t.TRACES['gc:0'].seen.A.filter((s) => s.startsWith('pending · fetching'))).toHaveLength(2);
  });
});

describe('тонкие места закрыты прогонами', () => {
  useClientMode();

  it('05: сервер лежит — error виден только через ERROR_VISIBLE_AT, у мини-кеша так же', async () => {
    const steps: Step[] = [{ do: 'serverFails', n: 9 }, { do: 'mount', who: 'A' }, { do: 'wait', ms: t.ERROR_VISIBLE_AT - 1 }];
    const sc: Scenario = { id: 'down', label: '', note: '', steps };
    const before = await runTq(sc, 0);
    expect(before.seen.A.at(-1)).toMatch(/^pending/);
    const after = await runTq({ ...sc, steps: [...steps, { do: 'wait', ms: 1 }] }, 0);
    expect(after.seen.A.at(-1)).toMatch(/^error/);
    expect(await runLab({ ...sc, steps: [...steps, { do: 'wait', ms: 1 }] }, 0)).toEqual(after);
  });

  it('07: инвалидация без наблюдателей — запрос только при следующем монтировании, даже со staleTime Infinity', async () => {
    const { s, get } = fakeServer();
    const client = new QueryClient();
    const o = new QueryObserver(client, { queryKey: ['todos'], queryFn: get, staleTime: Infinity });
    const off = o.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    off();
    void client.invalidateQueries({ queryKey: ['todos'] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.calls).toHaveLength(1);
    const again = new QueryObserver(client, { queryKey: ['todos'], queryFn: get, staleTime: Infinity });
    again.subscribe(() => {})();
    expect(s.calls).toHaveLength(2);
    client.clear();

    // Мини-кеш — так же.
    const calls: number[] = [];
    const clock = { now: () => Date.now(), after: (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } };
    const cache = mini.createCache(clock);
    const fn = () => { calls.push(Date.now()); return Promise.resolve(['молоко']); };
    mini.observe(cache, ['todos'], { fn, staleTime: Infinity }, () => {})();
    await vi.advanceTimersByTimeAsync(1000);
    mini.invalidate(cache, ['todos']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(1);
    mini.observe(cache, ['todos'], { fn, staleTime: Infinity }, () => {});
    expect(calls).toHaveLength(2);
  });

  it('08: Date и экземпляры классов всегда новые — и в query-core, и в мини-версии', () => {
    class Money {
      constructor(public v: number) {}
    }
    for (const [a, b] of [[new Date(0), new Date(0)], [new Money(1), new Money(1)], [new Map(), new Map()]] as const) {
      expect(replaceEqualDeep(a, b)).toBe(b);
      expect(mini.replaceEqualDeep(a, b)).toBe(b);
    }
  });
});

describe('утверждения раздела «Мутации» и SWR', () => {
  useClientMode();

  it('INVALIDATE_NOTE: инвалидация во время запроса перезапускает его — и в query-core, и в мини-кеше', async () => {
    expect(t.INVALIDATE_NOTE).toContain('перезапускается');
    const run = async (lib: 'tq' | 'mini') => {
      vi.setSystemTime(0);
      const { s, get } = fakeServer();
      const seen: string[] = [];
      if (lib === 'tq') {
        const client = new QueryClient();
        const o = new QueryObserver(client, { queryKey: ['todos'], queryFn: get });
        o.subscribe((r) => seen.push(tqSnap(r)));
        await vi.advanceTimersByTimeAsync(1000);
        s.todos.push('хлеб');
        void client.refetchQueries({ queryKey: ['todos'] });
        await vi.advanceTimersByTimeAsync(100);
        s.todos.push('сыр');
        void client.invalidateQueries({ queryKey: ['todos'] });
        await vi.advanceTimersByTimeAsync(1000);
        client.clear();
      } else {
        const clock = { now: () => Date.now(), after: (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); } };
        const cache = mini.createCache(clock);
        mini.observe(cache, ['todos'], { fn: get }, (x) => seen.push(describeSnap(x)));
        await vi.advanceTimersByTimeAsync(1000);
        s.todos.push('хлеб');
        mini.onFocus(cache);
        await vi.advanceTimersByTimeAsync(100);
        s.todos.push('сыр');
        mini.invalidate(cache, ['todos']);
        await vi.advanceTimersByTimeAsync(1000);
      }
      return { calls: s.calls, seen: collapse(seen) };
    };
    const tq = await run('tq');
    expect(tq.calls).toEqual([0, 1000, 1100]);
    // Ответ первого фонового запроса ([молоко, хлеб]) в кеш не попал — сразу [молоко, хлеб, сыр].
    expect(tq.seen.at(-1)).toBe('success · idle [молоко, хлеб, сыр]');
    expect(tq.seen.some((x) => x.includes('[молоко, хлеб]'))).toBe(false);
    expect(await run('mini')).toEqual(tq);
  });

  it('TQ_MUTATION_NOTE: мутация по умолчанию не повторяется', async () => {
    expect(t.TQ_MUTATION_NOTE).toContain('`retry: 0`');
    const client = new QueryClient();
    let calls = 0;
    const m = new MutationObserver(client, {
      mutationFn: () => {
        calls++;
        return Promise.reject(new Error('500'));
      },
    });
    m.mutate(undefined).catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
  });

  it('SWR: окно дедупликации считается от ответа, а не от запроса', async () => {
    // Ответ пришёл в 0,3 с. Возврат в 2,2 с — позже 2 с от запроса, но раньше 2 с от ответа.
    const steps: Step[] = [
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 500 },
      { do: 'unmount', who: 'A' },
      { do: 'wait', ms: 1700 },
      { do: 'mount', who: 'A' },
      { do: 'wait', ms: 1000 },
    ];
    expect((await runSwr(steps)).calls).toEqual([0]);
    steps[3] = { do: 'wait', ms: 1900 };
    expect((await runSwr(steps)).calls).toHaveLength(2);
    expect(t.SWR_FACTS[0].d).toContain('от **ответа**');
  });

  it('SWR: паузы перед повторами при random 0,5 — 10, 20 и 40 с', () => {
    const c = t.SWR_TRACES['retry-long'].calls;
    expect(c.slice(1).map((x, i) => x - (c[i] + LAT))).toEqual([10_000, 20_000, 40_000]);
    expect(t.SWR_FACTS[2].d).toContain('10, 20 и 40 с');
  });
});
