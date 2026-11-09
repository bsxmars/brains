import { createRequire } from 'node:module';
import {
  MAX_LATITUDE,
  WebMercatorViewport,
  getDistanceScales,
  lngLatToWorld,
  worldToLngLat,
} from '@math.gl/web-mercator';
import { compileScript, parse } from '@vue/compiler-sfc';
import { Window } from 'happy-dom';
import Supercluster from 'supercluster';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/maps/data';
import { freshTiles, loadMaps, marksInView, tileKey, uniqueRequests, viewBox } from '@/widgets/map-lab/model/run';
import type { Mark } from '@/widgets/map-lab/model/types';

/**
 * Тема «Карты в интерфейсе: как устроена веб-карта и как её встроить».
 *
 * `*_CODE` — строки темы: напечатаны на странице и исполняются демо (`widgets/map-lab`). Здесь
 * они сверяются с `@math.gl/web-mercator` 4.1 (проекция, метры на пиксель, границы окна) и
 * `supercluster` 9.1 (кластеры на каждом уровне), а числа таблиц пересчитываются теми же
 * функциями. Компоненты карты для React и Vue исполняются настоящими React 19 и Vue 3.5 в
 * happy-dom; вместо `maplibre-gl` — подставной класс, который считает созданные и удалённые
 * карты. Браузер и сеть не нужны: файл лёгкий.
 */

const api = loadMaps(t.MAP_CODES);
const CITY = Object.fromEntries(t.CITY_ROWS.map((r) => [r.city, r]));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** math.gl: мир — 512 единиц на уровне 0, ось y вверх. Тема: 256 · 2^z, ось y вниз. */
function mathglToTheme(lng: number, lat: number, z: number) {
  const [X, Y] = lngLatToWorld([lng, lat]);
  const k = (256 * 2 ** z) / 512;
  return { x: X * k, y: (512 - Y) * k };
}

/** Точки с зерном по всему миру, кроме приполярных широт. */
function randomPlaces(n: number, seed: number) {
  const rnd = api.mulberry32(seed);
  return Array.from({ length: n }, () => ({ lng: rnd() * 360 - 180, lat: rnd() * 170 - 85 }));
}

describe('проекция: MERCATOR_CODE против @math.gl/web-mercator', () => {
  it('MAX_LAT — та же граница квадратного мира, что MAX_LATITUDE у math.gl', () => {
    expect(api.MAX_LAT).toBeCloseTo(MAX_LATITUDE, 6);
    expect(api.MAX_LAT.toFixed(4)).toBe('85.0511');
    // На этой широте мир квадратный: y = 0 ровно у верхнего края.
    expect(api.project(0, api.MAX_LAT, 0).y).toBeCloseTo(0, 9);
    // Севернее границы точка прижимается к краю, а не улетает в бесконечность.
    expect(api.project(0, 89.9, 3).y).toBe(api.project(0, api.MAX_LAT, 3).y);
  });

  it('project совпадает с lngLatToWorld на 2000 точках и уровнях 0…18', () => {
    for (const p of randomPlaces(2000, 11)) {
      for (const z of [0, 5, 12, 18]) {
        const mine = api.project(p.lng, p.lat, z);
        const theirs = mathglToTheme(p.lng, p.lat, z);
        const size = 256 * 2 ** z;
        expect(Math.abs(mine.x - theirs.x) / size).toBeLessThan(1e-12);
        expect(Math.abs(mine.y - theirs.y) / size).toBeLessThan(1e-12);
      }
    }
  });

  it('unproject — обратная к project и совпадает с worldToLngLat', () => {
    for (const p of randomPlaces(500, 12)) {
      const w = api.project(p.lng, p.lat, 10);
      const back = api.unproject(w.x, w.y, 10);
      expect(back.lng).toBeCloseTo(p.lng, 9);
      expect(back.lat).toBeCloseTo(p.lat, 9);
      const k = 512 / (256 * 2 ** 10);
      const [lng, lat] = worldToLngLat([w.x * k, 512 - w.y * k]);
      expect(back.lng).toBeCloseTo(lng, 9);
      expect(back.lat).toBeCloseTo(lat, 9);
    }
  });

  /**
   * ⚠️ math.gl берёт среднюю окружность Земли 40 030 км, EPSG:3857 и таблицы OSM — 2πR при
   * R = 6 378 137 м (40 075 км). Поэтому сверяется зависимость от широты и уровня, а постоянное
   * отношение двух окружностей проверено отдельно.
   */
  it('metersPerPixel меняется с широтой и уровнем так же, как у getDistanceScales', () => {
    const ratio = (2 * Math.PI * api.R) / 40.03e6;
    expect(ratio).toBeCloseTo(1.0011, 4);
    for (const lat of [0, 1.2903, 30, 55.7558, 64.1466, 68.9707, 80]) {
      const [unitMeters] = getDistanceScales({ latitude: lat, longitude: 0 }).metersPerUnit;
      for (const z of [0, 7, 12, 18]) {
        const theirs = (unitMeters * 512) / (256 * 2 ** z);
        expect(api.metersPerPixel(lat, z) / theirs).toBeCloseTo(ratio, 12);
      }
    }
    // Число из таблиц OSM для уровня 0 на экваторе.
    expect(api.metersPerPixel(0, 0).toFixed(2)).toBe('156543.03');
  });

  it('CITY_ROWS: тайл, пиксель в тайле и метры на пиксель на уровне 12', () => {
    for (const r of t.CITY_ROWS) {
      const hit = api.tileOf(r.lng, r.lat, 12);
      expect(`${hit.z}/${hit.x}/${hit.y}`, r.city).toBe(r.tile);
      expect(`${hit.px}, ${hit.py}`, r.city).toBe(r.px);
      expect(round2(api.metersPerPixel(r.lat, 12)), r.city).toBe(r.mpp);
      // Тот же тайл по координатам math.gl.
      const w = mathglToTheme(r.lng, r.lat, 12);
      expect(`12/${Math.floor(w.x / 256)}/${Math.floor(w.y / 256)}`, r.city).toBe(r.tile);
    }
    expect(t.CITY_NOTE).toContain('38 метров');
    expect(t.CITY_NOTE).toContain('меньше 14');
  });

  it('STRETCH_ROWS: растяжение длин 1/cos φ и площадей 1/cos² φ — то же, что у math.gl', () => {
    for (const r of t.STRETCH_ROWS) {
      const c = Math.cos((r.lat * Math.PI) / 180);
      expect(round2(1 / c), r.place).toBe(r.len);
      expect(round2(1 / c ** 2), r.place).toBe(r.area);
      const atLat = getDistanceScales({ latitude: r.lat, longitude: 0 }).unitsPerMeter[0];
      const atEquator = getDistanceScales({ latitude: 0, longitude: 0 }).unitsPerMeter[0];
      expect(round2(atLat / atEquator), r.place).toBe(r.len);
    }
    // «в десять раз по площади» — Гренландия на 72°.
    expect(t.STRETCH_NOTE).toContain('в десять раз по площади');
  });

  it('ZOOM_512_NOTE: окно math.gl на уровне z − 1 накрывает те же долготы, что окно темы на z', () => {
    for (const z of [4, 9, 12, 16]) {
      const vp = new WebMercatorViewport({ width: 1280, height: 800, longitude: 37.6173, latitude: 55.7558, zoom: z - 1 });
      const [[minLng], [maxLng]] = vp.getBounds();
      expect(maxLng - minLng).toBeCloseTo((1280 * 360) / (256 * 2 ** z), 9);
    }
  });
});

describe('тайлы: TILES_CODE', () => {
  it('PYRAMID_ROWS: 4^z тайлов и метры на пиксель', () => {
    for (const r of t.PYRAMID_ROWS) {
      expect(r.tiles).toBe(4 ** r.z);
      expect(round2(api.metersPerPixel(0, r.z))).toBe(r.equator);
      expect(round2(api.metersPerPixel(55.7558, r.z))).toBe(r.moscow);
    }
  });

  it('тайлы окна — ровно те, что накрывают границы окна по WebMercatorViewport', () => {
    for (const r of t.CITY_ROWS) {
      for (const z of [4, 8, 12, 15, 18]) {
        const c = api.project(r.lng, r.lat, z);
        const tiles = api.tilesInView(c.x, c.y, z, 1280, 800);
        const vp = new WebMercatorViewport({ width: 1280, height: 800, longitude: r.lng, latitude: r.lat, zoom: z - 1 });
        const [[minLng, minLat], [maxLng, maxLat]] = vp.getBounds();
        const nw = api.tileOf(minLng, maxLat, z);
        const se = api.tileOf(maxLng, minLat, z);
        const xs = tiles.map((q) => q.x);
        const ys = tiles.map((q) => q.y);
        expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], `${r.city} z${z}`).toEqual([
          nw.x,
          se.x,
          nw.y,
          se.y,
        ]);
        expect(tiles.length).toBe((se.x - nw.x + 1) * (se.y - nw.y + 1));
      }
    }
  });

  it('GESTURE_ROWS: открыть, сдвинуть, приблизить, вернуться', () => {
    const { lng, lat } = CITY['Москва'];
    const c = api.project(lng, lat, 12);
    const open = api.tilesInView(c.x, c.y, 12, 1280, 800);
    const panned = api.tilesInView(c.x + 300, c.y, 12, 1280, 800);
    const zoomed = api.tilesInView((c.x + 300) * 2, c.y * 2, 13, 1280, 800);
    const back = api.tilesInView(c.x + 300, c.y, 12, 1280, 800);
    const memory = new Set([...open, ...panned, ...zoomed].map(tileKey));
    const got = [
      [open.length, uniqueRequests(open)],
      [panned.length, freshTiles(open, panned).length],
      [zoomed.length, freshTiles(panned, zoomed).length],
      [back.length, back.filter((q) => !memory.has(tileKey(q))).length],
      [back.length, freshTiles(zoomed, back).length],
    ];
    expect(got).toEqual(t.GESTURE_ROWS.map((r) => [r.tiles, r.fresh]));
  });

  it('LOW_ZOOM: на уровне 0 окно 1280 × 800 — шесть мест и один адрес 0/0/0', () => {
    const { lng, lat } = CITY['Москва'];
    const c = api.project(lng, lat, 0);
    const tiles = api.tilesInView(c.x, c.y, 0, 1280, 800);
    expect(tiles.length).toBe(6);
    expect(new Set(tiles.map(tileKey))).toEqual(new Set(['0/0/0']));
    expect(t.LOW_ZOOM).toContain('шесть мест');
    expect(t.LOW_ZOOM).toContain('Запрос уйдёт один');
  });

  it('адрес тайла из словаря — это Москва на уровне 12', () => {
    const url = api.tileUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png', api.tileOf(37.6173, 55.7558, 12));
    expect(url).toBe('https://tile.openstreetmap.org/12/2476/1280.png');
    expect(t.GLOSSARY.find((g) => g.k === 'адрес z/x/y')?.d).toContain('12/2476/1280');
  });

  it('по долготе мир повторяется: окно через линию перемены дат берёт тайлы с обоих краёв', () => {
    const c = api.project(180, 0, 3);
    const xs = new Set(api.tilesInView(c.x, c.y, 3, 1280, 800).map((q) => q.x));
    expect(xs.has(0) && xs.has(7)).toBe(true);
    expect([...xs].every((x) => x >= 0 && x < 8)).toBe(true);
  });
});

describe('кластеры: CLUSTER_CODE против supercluster', () => {
  const S = t.CLUSTER_SETUP;

  function supercluster(places: { lng: number; lat: number }[], radius: number, maxZoom: number) {
    // extent 256: радиус supercluster меряется в пикселях тех же уровней, что у темы.
    return new Supercluster({ radius, extent: 256, maxZoom }).load(
      places.map((p) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
    );
  }

  /** Метки темы и supercluster в одном виде: число точек и центр в градусах, по порядку. */
  function normalize(list: { count: number; lng: number; lat: number }[]) {
    return [...list].sort((a, b) => a.count - b.count || a.lng - b.lng || a.lat - b.lat);
  }
  const fromMine = (m: Mark[]) =>
    normalize(m.map((q) => ({ count: q.count, ...api.unproject(q.x * 256, q.y * 256, 0) })));

  function compareWindow(places: { lng: number; lat: number }[], radius: number, maxZoom: number, lng: number, lat: number, zooms: number[]) {
    const levels = api.buildClusters(places, radius, maxZoom);
    const sc = supercluster(places, radius, maxZoom);
    for (const z of zooms) {
      const c = api.project(lng, lat, z);
      const box = viewBox(256, c.x, c.y, z, 1280, 800);
      const mine = fromMine(marksInView(levels, z, box));
      const nw = api.unproject(c.x - 640, c.y - 400, z);
      const se = api.unproject(c.x + 640, c.y + 400, z);
      const theirs = normalize(
        sc.getClusters([nw.lng, se.lat, se.lng, nw.lat], z).map((f) => ({
          count: (f.properties as { point_count?: number }).point_count ?? 1,
          lng: f.geometry.coordinates[0],
          lat: f.geometry.coordinates[1],
        })),
      );
      expect(mine.length, `z${z}: число меток`).toBe(theirs.length);
      expect(mine.map((m) => m.count), `z${z}: размеры кластеров`).toEqual(theirs.map((m) => m.count));
      // supercluster хранит координаты целыми (доля мира × 2^30, с отбрасыванием дроби), и центр
      // кластера, собранный за несколько уровней, уходит на ~1e-6 градуса. Допуск 1e-5° — около
      // метра на местности и сотая доля пикселя даже на уровне 16.
      mine.forEach((m, i) => {
        expect(Math.abs(m.lng - theirs[i].lng), `z${z}: долгота метки ${i}`).toBeLessThan(1e-5);
        expect(Math.abs(m.lat - theirs[i].lat), `z${z}: широта метки ${i}`).toBeLessThan(1e-5);
      });
    }
  }

  it('набор темы: на всех уровнях 0…17 те же метки в окне над Москвой', () => {
    const places = api.makePlaces(S.n, S.seed);
    compareWindow(places, S.radius, S.maxZoom, S.lng, S.lat, Array.from({ length: S.maxZoom + 2 }, (_, z) => z));
  });

  it('другие зёрна, радиусы и весь мир — ответ тот же', () => {
    for (const [seed, n, radius] of [
      [1, 500, 40],
      [2, 3000, 60],
      [3, 1500, 25],
    ]) {
      compareWindow(api.makePlaces(n, seed), radius, 16, S.lng, S.lat, [6, 10, 12, 14, 16]);
    }
    const world = randomPlaces(3000, 5);
    const levels = api.buildClusters(world, 40, 16);
    const sc = supercluster(world, 40, 16);
    for (const z of [0, 2, 4, 6]) {
      const mine = fromMine(levels[z]);
      const theirs = sc.getClusters([-180, -85, 180, 85], z);
      expect(mine.length, `мир z${z}`).toBe(theirs.length);
    }
  });

  it('CLUSTER_ROWS пересчитываются', () => {
    const levels = api.buildClusters(api.makePlaces(S.n, S.seed), S.radius, S.maxZoom);
    const rows = S.zooms.map((z) => {
      const c = api.project(S.lng, S.lat, z);
      const box = viewBox(256, c.x, c.y, z, 1280, 800);
      const marks = marksInView(levels, z, box);
      return {
        z,
        raw: marksInView(levels, S.maxZoom + 1, box).length,
        marks: marks.length,
        clusters: marks.filter((m) => m.count > 1).length,
      };
    });
    expect(rows).toEqual(t.CLUSTER_ROWS);
    expect(t.CLUSTER_ROWS_NOTE).toContain('`makePlaces(2000, 7)`');
  });
});

// ─── Компоненты: React и Vue в happy-dom ────────────────────────────────────────────────────

const require = createRequire(import.meta.url);
const win = new Window({ url: 'http://localhost/' });
const GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Text', 'Comment', 'Event'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
for (const key of GLOBALS) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  const value = key === 'window' ? win : (win as unknown as Record<string, unknown>)[key];
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete (globalThis as Record<string, unknown>)[key];
  }
  await win.happyDOM.close();
});

/** Подставной `maplibre-gl`: считает карты и проверяет, что контейнер уже в документе. */
function fakeMaplibre() {
  const stats = { created: 0, removed: 0, jumps: [] as unknown[], detached: 0 };
  class Map {
    constructor(opts: { container: { isConnected?: boolean } }) {
      stats.created++;
      if (!opts.container?.isConnected) stats.detached++;
    }
    jumpTo(o: unknown) {
      stats.jumps.push(o);
    }
    remove() {
      stats.removed++;
    }
  }
  const live = () => stats.created - stats.removed;
  return { mod: { Map }, stats, live };
}

/** ESM → CommonJS (и JSX → `react/jsx-runtime`), потом исполнить с подставленными модулями. */
function loadModule(source: string, modules: Record<string, unknown>) {
  const js = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const req = (id: string) => {
    if (id.endsWith('.css')) return {};
    if (!(id in modules)) throw new Error(`неожиданный импорт ${id}`);
    return modules[id];
  };
  new Function('require', 'module', 'exports', js)(req, module, module.exports);
  return module.exports;
}

describe('React: REACT_MAP_CODE и REACT_BAD_CODE', () => {
  const React = require('react') as typeof import('react');
  const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
  const { renderToString } = require('react-dom/server') as typeof import('react-dom/server');
  const { act, createElement: h, StrictMode } = React;
  const base = { react: React, 'react/jsx-runtime': require('react/jsx-runtime') };

  /** Шапка с импортами — та же, что у REACT_MAP_CODE: плохая версия напечатана без неё. */
  const header = t.REACT_MAP_CODE.slice(0, t.REACT_MAP_CODE.indexOf('export function'));

  it('версия React — та, что в стенде темы', () => {
    expect((require('react/package.json') as { version: string }).version).toBe('19.3.0');
  });

  it('LIFECYCLE_ROWS: правильный компонент в StrictMode и версия без очистки', async () => {
    const good = fakeMaplibre();
    const { MapView } = loadModule(t.REACT_MAP_CODE, { ...base, 'maplibre-gl': good.mod }) as {
      MapView: (p: { center: number[]; zoom: number }) => unknown;
    };
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    const snap = (f: ReturnType<typeof fakeMaplibre>) => [f.stats.created, f.stats.removed, f.live()];
    const rows: number[][] = [];

    await act(async () => root.render(h(StrictMode, null, h(MapView as never, { center: [37.6173, 55.7558], zoom: 10 }))));
    rows.push(snap(good));
    await act(async () => root.render(h(StrictMode, null, h(MapView as never, { center: [30.3141, 59.9386], zoom: 10 }))));
    await act(async () => root.render(h(StrictMode, null, h(MapView as never, { center: [30.3141, 59.9386], zoom: 12 }))));
    rows.push(snap(good));
    expect(good.stats.jumps.at(-1)).toEqual({ center: [30.3141, 59.9386], zoom: 12 });
    await act(async () => root.unmount());
    rows.push(snap(good));
    expect(good.stats.detached, 'карта создаётся, когда div уже в документе').toBe(0);

    const bad = fakeMaplibre();
    const { MapView: BadView } = loadModule(header + t.REACT_BAD_CODE, { ...base, 'maplibre-gl': bad.mod }) as {
      MapView: unknown;
    };
    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    const root2 = createRoot(el2);
    for (const zoom of [10, 11, 12]) {
      await act(async () => root2.render(h(BadView as never, { center: [37.6173, 55.7558], zoom })));
    }
    rows.push(snap(bad));
    await act(async () => root2.unmount());
    rows.push(snap(bad));

    expect(rows).toEqual(t.LIFECYCLE_ROWS.map((r) => [r.created, r.removed, r.live]));
  });

  it('SSR_NOTE: renderToString отдаёт пустой div и карту не создаёт', () => {
    const f = fakeMaplibre();
    const { MapView } = loadModule(t.REACT_MAP_CODE, { ...base, 'maplibre-gl': f.mod }) as { MapView: unknown };
    const html = renderToString(h(MapView as never, { center: [37.6173, 55.7558], zoom: 10 }));
    expect(html).toBe('<div style="height:400px"></div>');
    expect(f.stats.created).toBe(0);
  });
});

describe('Vue: VUE_MAP_CODE', () => {
  const Vue = require('vue') as typeof import('vue');
  const { renderToString } = require('vue/server-renderer') as typeof import('vue/server-renderer');

  function compile(f: ReturnType<typeof fakeMaplibre>) {
    const { descriptor } = parse(t.VUE_MAP_CODE);
    const script = compileScript(descriptor, { id: 'maps', inlineTemplate: true });
    return loadModule(script.content, { vue: Vue, 'maplibre-gl': f.mod }).default as import('vue').Component;
  }

  it('версия Vue — та, что в стенде темы', () => {
    expect(Vue.version).toBe('3.5.42');
  });

  it('карта создаётся в onMounted, пропсы идут командой jumpTo, при уходе — remove()', async () => {
    const f = fakeMaplibre();
    const Comp = compile(f);
    const state = Vue.reactive({ center: [37.6173, 55.7558], zoom: 10 });
    const app = Vue.createApp({ render: () => Vue.h(Comp, { center: state.center, zoom: state.zoom }) });
    const el = document.createElement('div');
    document.body.appendChild(el);
    app.mount(el);
    expect([f.stats.created, f.stats.removed, f.stats.detached]).toEqual([1, 0, 0]);
    state.zoom = 12;
    await Vue.nextTick();
    expect(f.stats.jumps).toEqual([{ center: [37.6173, 55.7558], zoom: 12 }]);
    expect(f.stats.created).toBe(1);
    app.unmount();
    expect([f.stats.created, f.stats.removed]).toEqual([1, 1]);
  });

  it('SSR_NOTE: renderToString во Vue карту не создаёт', async () => {
    const f = fakeMaplibre();
    const Comp = compile(f);
    const html = await renderToString(Vue.createSSRApp(Comp, { center: [37.6173, 55.7558], zoom: 10 }));
    expect(html).toContain('<div style="height:400px;"');
    expect(f.stats.created).toBe(0);
  });

  it('VUE_NOTE: ref() отдаёт Proxy вместо карты, shallowRef — сам объект', () => {
    const map = new (fakeMaplibre().mod.Map)({ container: { isConnected: true } });
    expect(Vue.isProxy(Vue.ref(map).value)).toBe(true);
    expect(Vue.ref(map).value).not.toBe(map);
    expect(Vue.shallowRef(map).value).toBe(map);
    expect(t.VUE_NOTE).toContain('`shallowRef`');
  });
});

describe('ссылки темы', () => {
  it('«Где разобрано», «Смежное» и отсылки в тексте ведут на существующие разделы', async () => {
    const { readFileSync } = await import('node:fs');
    const strings = Object.values(t)
      .flatMap((v) => (typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap((x) => Object.values(x as object)) : []))
      .filter((v): v is string => typeof v === 'string');
    const links = [...strings.join(' ').matchAll(/\]\(\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?\)/g)];
    expect(links.length).toBeGreaterThan(15);
    for (const [, dir, slug, anchor] of links) {
      const col = dir === 'js' ? 'lessons' : dir;
      const mdx = readFileSync(new URL(`../../src/content/${col}/${slug}/index.mdx`, import.meta.url), 'utf8');
      if (anchor) expect(mdx, `${dir}/${slug}#${anchor}`).toMatch(new RegExp(`\\{ id: ${anchor},`));
    }
    for (const p of t.PREREQ) {
      const [, dir, slug, anchor] = /^\/([a-z]+)\/([a-z0-9-]+)\/#(s\d+)$/.exec(p.href ?? '') ?? [];
      const mdx = readFileSync(new URL(`../../src/content/${dir === 'js' ? 'lessons' : dir}/${slug}/index.mdx`, import.meta.url), 'utf8');
      expect(mdx, p.href).toMatch(new RegExp(`\\{ id: ${anchor},`));
    }
  });
});

describe('напечатанный, но не исполняемый код', () => {
  /**
   * MapLibre GL JS и Leaflet в проекте не установлены, а сети на стенде нет: `EMBED_CODE`,
   * `LEAFLET_CODE` и `GEOJSON_CLUSTER_CODE` написаны по документации. Здесь — только то, что
   * проверяется без библиотеки: код разбирается без синтаксических ошибок, JSON — валиден, а
   * числа из подписей совпадают с самим кодом.
   */
  it('JS-примеры разбираются без ошибок', () => {
    for (const [name, code] of Object.entries({ EMBED: t.EMBED_CODE, LEAFLET: t.LEAFLET_CODE, GEOJSON_CLUSTER: t.GEOJSON_CLUSTER_CODE })) {
      const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext } });
      expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), name).toEqual([]);
    }
  });

  it('TEMPLATE_CODE: шаблон адреса даёт тот же тайл Москвы', () => {
    const style = JSON.parse(t.TEMPLATE_CODE) as { sources: { osm: { tiles: string[]; tileSize: number } } };
    expect(style.sources.osm.tileSize).toBe(256);
    expect(api.tileUrl(style.sources.osm.tiles[0], api.tileOf(37.6173, 55.7558, 12))).toBe(
      'https://tile.openstreetmap.org/12/2476/1280.png',
    );
  });

  it('STYLE_CODE: толщина 1 пиксель на уровне 8 и 8 на уровне 16, как в подписи', () => {
    const layer = JSON.parse(t.STYLE_CODE) as { paint: { 'line-width': unknown[] } };
    expect(layer.paint['line-width'].slice(3)).toEqual([8, 1, 16, 8]);
    expect(t.STYLE_NOTE).toContain('1 пиксель на уровне 8, 8 пикселей на уровне 16');
  });

  it('координаты Москвы одинаковы во всех примерах, порядок — по библиотеке', () => {
    expect(t.EMBED_CODE).toContain('[37.6173, 55.7558]');
    expect(t.LEAFLET_CODE).toContain('[55.7558, 37.6173]');
    expect(t.LEAFLET_CODE).not.toContain('[37.6173, 55.7558]');
  });
});
