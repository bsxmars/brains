import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/frameworks/next-cache/data';
import { asStand, loadRoutes, playScenario, sameAsStand } from '@/widgets/next-cache-lab/model/run';
import type { ModelCodes } from '@/widgets/next-cache-lab/model/types';

/**
 * Тема «Слои кеша в Next.js» — быстрая часть.
 *
 * Учебная модель четырёх слоёв (`ROUTES_CODE`, `SERVER_MODEL_CODE`, `ROUTER_MODEL_CODE` — строки
 * из темы, их же исполняет демо) прогоняется по сценариям темы и сверяется с журналом стенда
 * `STAND` шаг в шаг: какие ключи дошли до бэкенда, `x-nextjs-cache`, `Cache-Control`, что на
 * странице, какие запросы сделала вкладка. Сам журнал пересобирается настоящим Next 16.3.8
 * в `next-cache-stand.test.ts`; здесь — модель против него и числа из текста против журнала.
 */

const codes: ModelCodes = { routes: t.ROUTES_CODE, server: t.SERVER_MODEL_CODE, router: t.ROUTER_MODEL_CODE };

describe('модель четырёх слоёв против журнала стенда', () => {
  for (const sc of t.SCENARIOS) {
    it(`сценарий «${sc.label}» — каждый шаг как на стенде`, () => {
      const { results } = playScenario(codes, sc.steps);
      expect(results).toHaveLength(sc.stand.length);
      results.forEach((r, i) => {
        const model = asStand(r, sc.mode, i === 0 ? null : sc.steps[i - 1]);
        expect(model, `${sc.id}, шаг ${i}`).toEqual(sc.stand[i]);
        expect(sameAsStand(model, sc.stand[i])).toBe(true);
      });
    });
  }

  it('сценарии демо — это сценарии стенда, в том же порядке', () => {
    expect(t.SCENARIOS.map((s) => s.id)).toEqual(t.SCENARIO_STEPS.map((s) => s.id));
    for (const sc of t.SCENARIOS) expect(sc.stand).toBe(t.STAND[sc.id]);
  });

  it('модель различает слои: фоновая перегенерация помечена «фоном»', () => {
    const isr = t.SCENARIOS.find((s) => s.id === 'isr')!;
    const { results } = playScenario(codes, isr.steps);
    const stale = results[2];
    expect(stale.xcache).toBe('STALE');
    expect(stale.trace.some((l) => l.later && l.layer === 'данные')).toBe(true);
    expect(stale.trace.some((l) => !l.later && l.layer === 'маршрут')).toBe(true);
  });
});

describe('маршруты модели — это страницы стенда', () => {
  const routes = loadRoutes(t.ROUTES_CODE);
  const file = (path: string) => t.APP_FILES[`app${path}/page.jsx`];

  it('у каждой страницы стенда есть маршрут модели и наоборот', () => {
    const pages = Object.keys(t.APP_FILES)
      .filter((p) => /^app\/[a-z]+\/page\.jsx$/.test(p))
      .map((p) => p.slice(3, -9));
    expect(pages.sort()).toEqual(Object.keys(routes).sort());
  });

  it('опции каждого fetch модели стоят в коде страницы', () => {
    for (const [path, r] of Object.entries(routes)) {
      const code = file(path);
      expect(code.includes('await cookies()'), path).toBe(Boolean(r.dynamic));
      for (const f of r.fetches) {
        if (f.key === 'user') {
          expect(code).toContain("unstable_cache(() => query('user'), ['user'], { tags: ['user'] })");
          continue;
        }
        expect(code, `${path} ${f.key}`).toContain(`get('${f.key}'`);
        if (f.cache) expect(code).toContain(`get('${f.key}', { cache: '${f.cache}'`);
        if (f.revalidate) expect(code).toContain(`get('${f.key}', { next: { revalidate: ${f.revalidate} } })`);
        if (f.tags) expect(code).toContain(`next: { tags: ['${f.tags[0]}'] }`);
        if (f.signal) expect(code).toContain(`get('${f.key}', { signal: new AbortController().signal })`);
      }
    }
    // Два <Menu /> на /static, Cart повторяет cart на /dynamic.
    expect(file('/static')).toContain('<Menu /><Menu />');
    expect(file('/dynamic')).toContain('<Cart />');
  });
});

describe('числа и утверждения текста — из журнала стенда', () => {
  const S = t.STAND;

  it('сборка: четыре ключа по разу, /dynamic не рендерился; /isr со сроком 3s', () => {
    expect(S.memo[0].backend).toEqual(['banner#1', 'menu#1', 'post#1', 'rates#1']);
    expect(t.BUILD_TABLE).toMatch(/○ \/isr\s+3s\s+1y/);
    expect(t.BUILD_TABLE).toMatch(/ƒ \/dynamic/);
    expect(t.BUILD_TABLE).toMatch(/○ \/static/);
    expect(t.BUILD_NOTE).toContain('четыре запроса');
  });

  it('мемоизация: menu дважды на странице — один запрос; stock со своим сигналом — два', () => {
    expect(S.memo[1].shown).toBe('menu=1 menu=1 banner=1');
    const dyn = S.dynamic[1];
    expect(dyn.backend.filter((k) => k.startsWith('cart'))).toEqual(['cart#1']);
    expect(dyn.backend.filter((k) => k.startsWith('stock'))).toEqual(['stock#1', 'stock#2']);
    expect(dyn.shown).toContain('stock=1 stock=2');
  });

  it('кеш данных на динамическом маршруте: cart каждый раз, catalog один раз, news — фоном', () => {
    const gets = S.dynamic.filter((s) => s.shown);
    expect(gets.map((s) => s.shown!.match(/cart=(\d)/)![1])).toEqual(['1', '2', '3', '4']);
    expect(t.FETCH_ROWS[0].dyn).toContain('1, 2, 3, 4');
    expect(gets.every((s) => s.shown!.includes('catalog=1'))).toBe(true);
    // После паузы 6 с: старое news=1 на экране, news#2 у бэкенда; следующий — news=2.
    expect(S.dynamic[5].shown).toContain('news=1');
    expect(S.dynamic[5].backend).toContain('news#2');
    expect(S.dynamic[6].shown).toContain('news=2');
    expect(S.dynamic[5].backend).toContain('user#2');
    expect(S.dynamic[5].xcache).toBeNull();
  });

  it('пересборка без очистки .next спросила только rates', () => {
    expect(t.REBUILD_HITS).toEqual(['rates#2']);
    expect(t.DATA_FACTS[0].d).toContain('только про `rates`');
  });

  it('ISR: STALE со старым значением, потом HIT с новым; Cache-Control как в тексте', () => {
    expect(S.isr[2]).toMatchObject({ xcache: 'STALE', shown: 'rates=1', backend: ['rates#2'] });
    expect(S.isr[3]).toMatchObject({ xcache: 'HIT', shown: 'rates=2', backend: [] });
    expect(S.isr[2].cc).toBe('s-maxage=3, stale-while-revalidate=31535997');
    expect(t.CC_NOTE).toContain('`s-maxage=3, stale-while-revalidate=31535997`');
    expect(S.memo[1].cc).toBe('s-maxage=31536000');
    expect(t.CC_NOTE).toContain('`s-maxage=31536000`');
  });

  it("revalidateTag: 'max' — STALE и post 1→2, { expire: 0 } — MISS и сразу 3; сам вызов бэкенд не трогает", () => {
    expect(S.tag[2].backend).toEqual([]);
    expect(S.tag[3]).toMatchObject({ xcache: 'STALE', shown: 'post=1', backend: ['post#2'] });
    expect(S.tag[4]).toMatchObject({ xcache: 'HIT', shown: 'post=2' });
    expect(S.tag[6]).toMatchObject({ xcache: 'MISS', shown: 'post=3', backend: ['post#3'] });
    expect(t.INVALIDATE_ROWS[0].next).toContain('`post: 1`, потом `post: 2`');
    expect(t.INVALIDATE_ROWS[1].next).toContain('`post: 3`');
  });

  it('revalidatePath: MISS и заново menu с banner', () => {
    expect(S.path[3]).toMatchObject({ xcache: 'MISS', backend: ['banner#2', 'menu#2'], shown: 'menu=2 menu=2 banner=2' });
    expect(t.INVALIDATE_ROWS[3].next).toContain('`menu: 2`, `banner: 2`');
  });

  it('вкладка: префетч всех ссылок без бэкенда, статика без запроса, динамика каждый раз, вебхук не доходит', () => {
    const R = S.router;
    expect(R[1].requests).toEqual(['document /static', 'prefetch /dynamic', 'prefetch /isr', 'prefetch /static', 'prefetch /tagged']);
    expect(R[1].backend).toEqual([]);
    expect(R[2].requests).toEqual([]);
    expect(R[3].requests).toEqual(['rsc /dynamic']);
    expect(R[5].requests).toEqual(['rsc /dynamic']);
    expect(R[6].requests).toEqual([]);
    // updateTag: сразу post=2, кеш роутера сброшен — снова префетч.
    expect(R[8]).toMatchObject({ shown: 'post=2', backend: ['post#2'] });
    expect(R[8].requests).toContain('action /tagged');
    expect(R[8].requests).toContain('prefetch /tagged');
    // Вебхук: вкладка показывает post=2 без запроса, после перезагрузки — post=3.
    expect(R[13]).toMatchObject({ shown: 'post=2', requests: [], backend: [] });
    expect(R[14]).toMatchObject({ shown: 'post=3', backend: ['post#3'] });
  });

  it("'use cache': частичный пререндер, price фоном, live каждый раз, без x-nextjs-cache", () => {
    expect(t.APP2_BUILD_TABLE).toMatch(/◐ \/cached\s+3s\s+10m/);
    const A = t.APP2_STAND;
    expect(A[0].backend).toEqual(['price#1']);
    expect(A[4]).toMatchObject({ shown: 'price=1 live=3', backend: ['live#3', 'price#2'] });
    expect(A[5].shown).toBe('price=2 live=4');
    expect(A.every((s) => !s.xcache)).toBe(true);
    expect(A[1].cc).toBe('private, no-cache, no-store, max-age=0, must-revalidate');
  });

  it('профили cacheLife в таблице — из кода Next 16.3.8', () => {
    const require = createRequire(import.meta.url);
    const { defaultConfig } = require('next/dist/server/config-shared.js') as {
      defaultConfig: { cacheLife: Record<string, { stale?: number; revalidate: number; expire: number }> };
    };
    const human = (s: number | undefined) => {
      if (s === undefined) return '5 мин';
      if (s >= 0xfffffffe) return 'никогда';
      const units: [number, string][] = [[31536000, '1 год'], [2592000, '30 дней'], [86400, '1 день'], [3600, '1 ч'], [60, 'мин'], [1, 'с']];
      for (const [u, name] of units) {
        if (u >= 86400 || u === 3600) { if (s === u) return name; continue; }
        if (s % u === 0) return u === 60 ? (s === 60 ? '1 мин' : `${s / 60} мин`) : `${s} с`;
      }
      return String(s);
    };
    for (const row of t.CACHELIFE_ROWS) {
      const p = defaultConfig.cacheLife[row.k.slice(1, -1)];
      expect([row.stale, row.rev, row.exp], row.k).toEqual([human(p.stale), human(p.revalidate), human(p.expire)]);
    }
  });
});
