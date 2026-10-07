import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/service-worker/data';
import { loadLifecycle, loadReplay, loadStrategies, sameSnapshot } from '@/widgets/sw-lab/model/run';
import type { SwScenario, SwScript } from '@/widgets/sw-lab/model/types';

/**
 * Тема «Service Worker изнутри».
 *
 * `LIFECYCLE_CODE` — учебная модель регистрации, строкой из темы: напечатана на странице
 * и исполняется демо. Здесь её журнал сверяется на каждом шаге каждого сценария с журналом
 * Chromium 153, снятым стендом (`LIFECYCLE_SCENARIOS[].chromium`: CDP `ServiceWorker`,
 * `controllerchange` во вкладках, версия контроллера). Отдельно проверено, что сценарии
 * различают модели: модель, где F5 освобождает ожидание, где `skipWaiting` не переводит вкладки
 * без `claim`, где вкладка без контроллера держит старую версию или где после навигации нет
 * проверки обновления, на них краснеет.
 *
 * `STRATEGY_CODE` прогоняется `REPLAY_CODE` и сверяется с ответами страницы стенда.
 * `SW_CODE`, `STATE_CODE`, `PRELOAD_CODE` и `ROUTER_CODE` исполняются в поддельном глобальном
 * объекте воркера: что скачивает установка, что чистит активация, чем отвечает офлайн.
 * Браузерный прогон здесь не повторяется — он в шапке `data.ts`.
 */

const run = loadLifecycle(t.LIFECYCLE_CODE);
const api = loadStrategies(t.STRATEGY_CODE);
const replay = loadReplay(t.REPLAY_CODE);

const scenarioIds = t.LIFECYCLE_SCENARIOS.map((s) => [s.id, s] as [string, SwScenario]);

describe('жизненный цикл: модель против Chromium', () => {
  it('десять сценариев, у каждого журнал Chromium на каждый шаг', () => {
    expect(t.LIFECYCLE_SCENARIOS).toHaveLength(10);
    expect(t.STAND.lifecycleRuns).toBe(3);
    for (const s of t.LIFECYCLE_SCENARIOS) {
      expect(s.chromium.length, s.id).toBe(s.steps.length);
      expect(s.steps[0], s.id).toEqual({ do: 'deploy', script: { v: 'v1', ...(s.id === 'claim' ? { claim: true } : {}) } });
    }
  });

  it.each(scenarioIds)('%s: модель = Chromium на каждом шаге', (_id, s) => {
    const model = run(s.steps);
    s.chromium.forEach((c, i) => expect(model[i], `${s.id}, шаг ${i + 1}`).toEqual(c));
    expect(s.chromium.every((c, i) => sameSnapshot(model[i], c))).toBe(true);
  });

  /** Подмена строки в модели: если подмена не нашлась, проверка сама по себе ничего не стоит. */
  const mutate = (from: string, to: string) => {
    expect(t.LIFECYCLE_CODE, from).toContain(from);
    return loadLifecycle(t.LIFECYCLE_CODE.replace(from, to));
  };
  const failing = (model: ReturnType<typeof loadLifecycle>) =>
    t.LIFECYCLE_SCENARIOS.filter((s) => JSON.stringify(model(s.steps)) !== JSON.stringify(s.chromium)).map((s) => s.id);

  it('сценарии различают модели: неверные модели краснеют', () => {
    // «F5 освобождает ожидание»: перезагрузка сначала закрывает вкладку.
    const f5 = mutate('reload: (m, s) => navigate(m, s.tab),', 'reload: (m, s) => { m.tabs.delete(s.tab); tryActivate(m); navigate(m, s.tab); },');
    expect(failing(f5)).toContain('reload');
    // «Без claim вкладки остаются у старой версии».
    const noMove = mutate('(active && worker === active) ||', 'false ||');
    expect(failing(noMove)).toEqual(expect.arrayContaining(['skip', 'skipInstall']));
    // «Держит любая открытая вкладка, даже без контроллера».
    const anyTab = mutate('const busy = active && [...m.tabs.values()].includes(active);', 'const busy = active && m.tabs.size > 0;');
    expect(failing(anyTab)).toContain('uncontrolled');
    // «Навигация не проверяет обновление».
    const noCheck = mutate('    update(m);                                  // после навигации — проверка обновления', '');
    expect(failing(noCheck)).toContain('reload');
    // «claim забирает только вкладки с другим контроллером, а без контроллера — нет».
    const claimSkipsNull = mutate('(waiting.script.claim && worker !== waiting)', '(waiting.script.claim && worker !== null && worker !== waiting)');
    expect(failing(claimSkipsNull)).toContain('claim');
  });

  it('утверждения текста стоят на журналах', () => {
    const last = (id: string) => (t.LIFECYCLE_SCENARIOS.find((s) => s.id === id) as SwScenario).chromium;
    // Первая страница без контроллера, после перезагрузки — v1.
    expect(last('first')[1].tabs).toEqual({ A: null });
    expect(last('first')[2].tabs).toEqual({ A: 'v1' });
    // Две перезагрузки — v2 всё ещё ждёт.
    expect(last('reload').slice(-2).map((c) => c.waiting)).toEqual(['v2', 'v2']);
    // skipWaiting без claim: обе вкладки перешли, controllerchange в обеих.
    expect(last('skip').at(-1)).toMatchObject({ active: 'v2', controllerchange: ['A', 'B'], tabs: { A: 'v2', B: 'v2' } });
    // skipWaiting в install: вкладка без контроллера так и осталась без него.
    expect(last('skipInstall').at(-1)?.tabs).toEqual({ A: null, B: 'v2' });
    // Закрыли последнюю вкладку — активация без вкладок.
    expect(last('close')[7]).toMatchObject({ workers: ['v1 redundant', 'v2 activating', 'v2 activated'], tabs: {} });
    // 404 в PRECACHE: installing → redundant.
    expect(last('fail').at(-1)?.workers).toEqual(['v2 installing', 'v2 redundant']);
    // Те же байты — ни одного события.
    expect(last('same').at(-1)?.workers).toEqual([]);
  });
});

describe('стратегии: STRATEGY_CODE против страницы стенда', () => {
  it.each(t.STRATEGY_CASES.map((c) => [c.id, c] as const))('%s: ответы и число запросов = Chromium', async (_id, c) => {
    expect(await replay(api[c.id], t.STRATEGY_STEPS)).toEqual(c.chromium);
  });

  it('стратегии на сценарии дают разные журналы', () => {
    const logs = t.STRATEGY_CASES.map((c) => JSON.stringify(c.chromium));
    expect(new Set(logs).size).toBe(3);
    expect(t.STAND.strategyRuns).toBe(3);
  });

  it('числа из текста', () => {
    const by = (id: string) => (t.STRATEGY_CASES.find((c) => c.id === id) as (typeof t.STRATEGY_CASES)[number]).chromium;
    const hits = (id: string) => by(id).reduce((n, e) => n + e.hits, 0);
    const facts = t.STRATEGY_FACTS.map((f) => f.d).join(' ');
    expect(by('cacheFirst')).toHaveLength(7);
    expect(hits('cacheFirst')).toBe(1);
    expect(by('cacheFirst').every((e) => e.got === 'данные 1')).toBe(true);
    expect(facts).toContain('семь запросов страницы — один запрос к серверу');
    expect(hits('networkFirst')).toBe(6);
    expect(facts).toContain('Шесть запросов из семи');
    // SWR после обновления на сервере: сначала старое, потом новое.
    expect(by('staleWhileRevalidate').slice(2, 4).map((e) => e.got)).toEqual(['данные 1', 'данные 2']);
  });
});

// ─── Поддельный глобальный объект воркера ─────────────────────────────────────────────────

interface FakeReq {
  url: string;
  mode?: string;
}
type Handler = (e: Record<string, unknown>) => void;

/** Сервер стенда: какие файлы есть, журнал запросов, «нет сети». */
function makeWorld(version: string) {
  const net = { offline: false, log: [] as string[] };
  const files: Record<string, string> = {
    '/offline.html': 'Нет сети',
    '/app.js': `window.APP = '${version}';`,
    [`/report.${version}.js`]: `export default 'отчёт ${version}';`,
    '/data/x': 'данные 1',
  };
  const fetchFn = async (input: string | FakeReq) => {
    const url = typeof input === 'string' ? input : input.url;
    if (net.offline) throw new TypeError('Failed to fetch');
    net.log.push(`GET ${url}`);
    return url in files ? new Response(files[url]) : new Response('', { status: 404 });
  };
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: string | FakeReq) => (typeof r === 'string' ? r : r.url);
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) as Map<string, Response>;
      return {
        async addAll(list: string[]) {
          const got: [string, Response][] = [];
          for (const u of list) {
            const r = await fetchFn(u);
            if (!r.ok) throw new TypeError(`addAll: ${u} → ${r.status}`);
            got.push([u, r]);
          }
          for (const [u, r] of got) store.set(u, r);
        },
        async put(r: string | FakeReq, res: Response) {
          store.set(keyOf(r), res);
        },
        async match(r: string | FakeReq) {
          return store.get(keyOf(r))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
    async match(r: string | FakeReq) {
      for (const s of stores.values()) {
        const hit = s.get(keyOf(r));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  return { net, files, fetchFn, caches, stores };
}

/** Исполнить скрипт воркера: обработчики событий и вызовы skipWaiting/claim. */
function boot(code: string, world: ReturnType<typeof makeWorld>) {
  const handlers: Record<string, Handler[]> = {};
  const calls: string[] = [];
  const self = {
    addEventListener: (type: string, h: Handler) => (handlers[type] ??= []).push(h),
    skipWaiting: () => {
      calls.push('skipWaiting');
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        calls.push('claim');
        return Promise.resolve();
      },
    },
    registration: {
      navigationPreload: {
        enable: () => {
          calls.push('navigationPreload.enable');
          return Promise.resolve();
        },
      },
    },
  };
  new Function('self', 'caches', 'fetch', code)(self, world.caches, world.fetchFn);

  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      respondWith: (p: Promise<Response> | Response) => {
        responded = Promise.resolve(p);
      },
    };
    for (const h of handlers[type] ?? []) h(event);
    const response = responded ? await responded : undefined;
    await Promise.all(waits);
    return response;
  }
  return { dispatch, calls, handlers };
}

/** Вариант sw.js — те же правки, что описывает VARIANT_NOTE и вставлял стенд. */
function variant(s: SwScript): string {
  const edit = (code: string, from: string, to: string) => {
    expect(code, from).toContain(from);
    return code.replace(from, to);
  };
  let code = edit(t.SW_CODE, "const VERSION = 'v1';", `const VERSION = '${s.v}';`);
  if (s.missing) code = edit(code, '`/report.${VERSION}.js`];', "`/report.${VERSION}.js`, '/missing.js'];");
  if (s.skipWaiting)
    code = edit(code, "self.addEventListener('install', (event) => {\n", "self.addEventListener('install', (event) => {\n  self.skipWaiting();\n");
  if (s.claim) code = edit(code, '    }\n  })());', '    }\n    await self.clients.claim();\n  })());');
  return code;
}

describe('SW_CODE в поддельном воркере', () => {
  it('install скачивает PRECACHE по запросу на адрес — как сервер стенда', async () => {
    const w = makeWorld('v1');
    await boot(t.SW_CODE, w).dispatch('install');
    const fromStand = t.STAND.installRequests.slice(t.STAND.installRequests.indexOf('GET /sw.js') + 1);
    expect(w.net.log).toEqual(fromStand);
    expect(await w.caches.keys()).toEqual(t.STAND.keys.v1);
  });

  it('activate v2 удаляет кеш v1: ключи как на стенде', async () => {
    const w = makeWorld('v1');
    await boot(t.SW_CODE, w).dispatch('install');
    w.files['/report.v2.js'] = "export default 'отчёт v2';";
    const v2 = boot(variant({ v: 'v2' }), w);
    await v2.dispatch('install');
    expect(await w.caches.keys()).toEqual(t.STAND.keys.v2Waiting);
    await v2.dispatch('activate');
    expect(await w.caches.keys()).toEqual(t.STAND.keys.v2Active);
  });

  it('404 в PRECACHE — промис waitUntil отклонён, кеш не записан', async () => {
    const w = makeWorld('v2');
    await expect(boot(variant({ v: 'v2', missing: true }), w).dispatch('install')).rejects.toThrow('/missing.js → 404');
    expect([...(w.stores.get('static-v2')?.keys() ?? [])]).toEqual([]);
  });

  it('варианты: skipWaiting в install, claim в activate', async () => {
    const w = makeWorld('v2');
    const v = boot(variant({ v: 'v2', skipWaiting: true, claim: true }), w);
    await v.dispatch('install');
    await v.dispatch('activate');
    expect(v.calls).toEqual(['skipWaiting', 'claim']);
  });

  it('без сети: навигация — заглушка, app.js — из кеша, прочее — TypeError', async () => {
    const w = makeWorld('v1');
    const sw = boot(t.SW_CODE, w);
    await sw.dispatch('install');
    w.net.offline = true;
    const nav = await sw.dispatch('fetch', { request: { url: '/', mode: 'navigate' } });
    expect(await nav?.text()).toBe('Нет сети');
    const app = await sw.dispatch('fetch', { request: { url: '/app.js', mode: 'no-cors' } });
    expect(await app?.text()).toBe("window.APP = 'v1';");
    await expect(sw.dispatch('fetch', { request: { url: '/data', mode: 'cors' } })).rejects.toThrow('Failed to fetch');
    expect(t.STAND.offline).toEqual({ title: 'offline', data: 'TypeError: Failed to fetch', requests: 0 });
  });

  it('смесь версий: на сервере v2, а app.js отдаётся из static-v1', async () => {
    const w = makeWorld('v1');
    const sw = boot(t.SW_CODE, w);
    await sw.dispatch('install');
    w.files['/app.js'] = "window.APP = 'v2';";
    const app = await sw.dispatch('fetch', { request: { url: '/app.js', mode: 'no-cors' } });
    expect(await app?.text()).toBe("window.APP = 'v1';");
    expect(t.STAND.afterDeploy).toEqual({ controller: 'v1', app: 'v1', waiting: 'v2' });
  });

  it('skip-waiting по сообщению', async () => {
    const sw = boot(t.SW_CODE, makeWorld('v1'));
    await sw.dispatch('message', { data: 'skip-waiting' });
    await sw.dispatch('message', { data: 'другое' });
    expect(sw.calls).toEqual(['skipWaiting']);
  });
});

describe('прочий код темы в поддельном воркере', () => {
  it('STATE_CODE: счёт идёт, пока жив скрипт; новый запуск — с единицы', async () => {
    const w = makeWorld('v1');
    const count = async (sw: ReturnType<typeof boot>) =>
      (await sw.dispatch('fetch', { request: new Request('https://site.test/count') }))?.text();
    const first = boot(t.STATE_CODE, w);
    const seq = [await count(first), await count(first), await count(first)];
    const second = boot(t.STATE_CODE, w); // остановка воркера — это новый запуск скрипта
    expect(seq).toEqual(t.STAND.sleep.seq);
    expect([await count(second), await count(second)]).toEqual(t.STAND.sleep.afterStop);
  });

  it('PRELOAD_CODE: включает предзагрузку и отдаёт preloadResponse без своего fetch', async () => {
    const w = makeWorld('v1');
    const sw = boot(t.PRELOAD_CODE, w);
    await sw.dispatch('activate');
    expect(sw.calls).toEqual(['navigationPreload.enable']);
    const res = await sw.dispatch('fetch', {
      request: { url: '/', mode: 'navigate' },
      preloadResponse: Promise.resolve(new Response('страница')),
    });
    expect(await res?.text()).toBe('страница');
    expect(w.net.log).toEqual([]);
    expect(t.STAND.preload.requests).toHaveLength(1);
    expect(t.STAND.preload.ignoredRequests).toHaveLength(2);
    expect(t.STAND.preload.requests[0].preload).toBe('true');
  });

  it('ROUTER_CODE: чужой адрес — без respondWith, свой — через стратегию', async () => {
    const w = makeWorld('v1');
    const sw = boot(`${t.STRATEGY_CODE}\n${t.ROUTER_CODE}`, w);
    expect(await sw.dispatch('fetch', { request: new Request('https://site.test/other') })).toBeUndefined();
    const res = await sw.dispatch('fetch', { request: new Request('https://site.test/data/cf') });
    expect(res?.status).toBe(404); // в поддельном сервере такого адреса нет — ответ сети как есть
    expect(w.net.log).toEqual(['GET https://site.test/data/cf']);
    expect(t.STAND.respond.none).toBe('из сети');
    expect(t.STAND.respond.late).toContain('InvalidStateError');
  });
});

describe('литералы стенда и текст', () => {
  it('версии стенда', () => {
    expect(t.STAND.chromium).toBe('153.0.8010.12');
  });

  it('updateViaCache: только all прячет новую версию', () => {
    expect(t.STAND.viaCache.map((v) => [v.value, v.requestsAfterTwoUpdates])).toEqual([
      ['imports', 2],
      ['imports', 2],
      ['all', 0],
      ['none', 2],
    ]);
    expect(t.VIA_CACHE_ROWS.find((r) => r.k.includes("'all'"))?.seen).toContain('0 запросов');
    expect(t.STAND.updateRequestHeaders).toEqual({ 'service-worker': 'script', 'cache-control': 'max-age=0' });
  });

  it('обновление: импорт меняет версию, самоперехват не мешает', () => {
    expect(t.STAND.importOnly.after.v).toBe('v2+i2');
    expect(t.STAND.selfIntercept.pageFetch).toBe("const VERSION = 'v1';");
    expect(t.STAND.selfIntercept.afterUpdate).toEqual({ slot: 'waiting', v: 'v2+i1' });
    // «через полторы-две секунды»
    for (const ms of t.STAND.navUpdateDelayMs) expect(ms).toBeGreaterThan(1400);
    for (const ms of t.STAND.navUpdateDelayMs) expect(ms).toBeLessThan(2100);
  });

  it('область и безопасный контекст', () => {
    expect(t.STAND.scope.defaultJs).toBe('/js/');
    expect(t.STAND.scope.wider).toBe('SecurityError');
    expect(t.SCOPE_ROWS[1].d).toContain("is not under the max scope allowed ('/js/')");
    expect(t.STAND.scope.widerMessage).toContain("is not under the max scope allowed ('/js/')");
    expect(t.STAND.secure['shop.test']).toBe('undefined');
  });

  it('риск skipWaiting + claim: ленивый кусок старой версии не загрузился', () => {
    expect(t.STAND.risk.wait.report).toBe('отчёт v1');
    expect(t.STAND.risk.wait.requests).toEqual([]);
    expect(t.STAND.risk.skipClaim.report).toBe('TypeError: Failed to fetch dynamically imported module');
    expect(t.RISK_ROWS[1].got).toContain(t.STAND.risk.skipClaim.report);
    expect(t.RISK_CODE).toContain("import('/report.v1.js')");
  });

  it('сон: 25 с пережил, 40 с — нет', () => {
    const idle = t.STAND.sleep.idle;
    expect(idle.find((x) => x.pauseS === 25)?.seq.at(-1)).not.toBe('1');
    expect(idle.find((x) => x.pauseS === 40)?.seq.at(-1)).toBe('1');
    expect(t.SLEEP_NOTE).toContain('между 25 и 40 секундами');
    expect(t.STAND.sleep.playwright75s.at(-1)).toBe('3');
  });

  it('отладка и bfcache', () => {
    expect(t.STAND.hardReload.controller).toBeNull();
    expect(t.STAND.hardReload.requests).toContain('GET /app.js');
    expect(t.STAND.unregister).toMatchObject({ result: true, registration: null, controller: 'v1', fetchHitServer: 0, afterReload: null });
    expect(t.STAND.bfcache.notRestored).toEqual(['ServiceWorkerVersionActivation']);
    expect(t.WAIT_FACTS[1].d).toContain('ServiceWorkerVersionActivation');
  });

  it('PAGE_CODE регистрирует тот же /sw.js', () => {
    expect(t.PAGE_CODE).toContain("navigator.serviceWorker.register('/sw.js')");
    expect(t.PAGE_CODE).toContain("addEventListener('controllerchange'");
  });
});
