import { describe, expect, it } from 'vitest';
import * as t from '@/content/render/animations/data';
import { agrees, layerBytes, loadLayers, loadPlan, standStages } from '@/widgets/anim-lab/model/run';
import type { AnimSpec, LayerEl, StandFrame } from '@/widgets/anim-lab/model/types';

/**
 * Тема «Анимации и композитор».
 *
 * `FRAME_PLAN_CODE` и `LAYER_CODE` — строки из темы: напечатаны на странице и исполняются демо.
 * Здесь они сверяются с литералами, которые снял Chromium 153 (шапка `data.ts`): счётчики
 * `LayoutCount`/`RecalcStyleCount`, события `Paint` и поле `compositeFailed` трассировки, кадры
 * скринкаста при занятом главном потоке, слои и причины `LayerTree`. Браузерный прогон здесь
 * не повторяется — в Node нет ни композитора, ни раскладки; стенд лежит в scratchpad автора
 * (`stand.mjs`), литералы сверены с его последним прогоном.
 *
 * Примеры `WAAPI_CODE`, `RAF_CODE`, `REDUCED_CODE` исполняются на заглушках: тест достаёт из них
 * ключевые кадры и спрашивает `framePlan`, а пружину из `RAF_CODE` прогоняет кадр за кадром.
 */

const plan = loadPlan(t.FRAME_PLAN_CODE);
const layers = loadLayers(t.FRAME_PLAN_CODE, t.LAYER_CODE);
const FPS = t.STAND.fps;

const css = (keyframes: Record<string, [string, string]>): AnimSpec => ({ by: 'css', keyframes });
const every = (n: number) => n >= FPS / 2;

describe('framePlan против счётчиков Chromium', () => {
  it.each(t.STAND.props.map((r) => [r.label, r] as const))('%s', (_label, r) => {
    const p = plan.framePlan([css({ [r.p]: [r.from, r.to] })]);
    expect(p.plans[0].thread === 'compositor', 'композитор').toBe(r.compositeFailed === 0);
    expect(p.style, 'стиль на кадр').toBe(every(r.style));
    expect(p.layout, 'раскладка на кадр').toBe(every(r.layout));
    expect(p.paint, 'отрисовка на кадр').toBe(r.paint > FPS);
    // Отказ из-за неподдерживаемого свойства трассировка называет поимённо — и это ровно
    // те свойства, которые функция считает помехой (у border-radius — четыре угла сразу).
    if (r.compositeFailed & 8192) {
      expect(r.unsupported.every((u) => u.startsWith(r.p.split('-')[0]))).toBe(true);
      expect(p.plans[0].blockers).toEqual([r.p]);
    }
  });

  /** Смеси и способы — те же сценарии, что на стенде. */
  const DRIVERS: Record<string, AnimSpec[]> = {
    'waapi transform': [{ by: 'waapi', keyframes: { transform: ['none', 'translateX(300px)'] } }],
    'transition transform': [css({ transform: ['none', 'translateX(300px)'] })],
    'raf transform': [{ by: 'raf', keyframes: { transform: ['translateX(0)', 'translateX(300px)'] } }],
    'raf left': [{ by: 'raf', keyframes: { left: ['0px', '300px'] } }],
    'one keyframes transform+box-shadow': [css({ transform: ['none', 'translateX(300px)'], 'box-shadow': ['none', '0 0 20px red'] })],
    'two animations transform, box-shadow': [css({ transform: ['none', 'translateX(300px)'] }), css({ 'box-shadow': ['none', '0 0 20px red'] })],
    // Переход на два свойства — два объекта CSSTransition.
    'transition transform, box-shadow': [css({ transform: ['none', 'translateX(300px)'] }), css({ 'box-shadow': ['none', '0 0 20px red'] })],
    'box-shadow unchanged in keyframes': [css({ transform: ['none', 'translateX(300px)'], 'box-shadow': ['0 0 0 #000', '0 0 0 #000'] })],
  };

  it.each(Object.entries(DRIVERS))('%s', (key, specs) => {
    const s: StandFrame = t.STAND.drivers[key];
    const p = plan.framePlan(specs);
    expect(p.style).toBe(every(s.style));
    expect(p.layout).toBe(every(s.layout));
    expect(p.paint).toBe(s.paint > FPS);
    // Есть отказ ⇔ хоть одна анимация не на композиторе (rAF отказа не пишет: анимации нет).
    const fails = p.plans.some((x) => x.thread === 'main' && x.blockers[0] !== 'requestAnimationFrame');
    expect(fails).toBe(s.compositeFailed !== 0);
  });

  it('известное расхождение: композитная анимация рядом с циклом rAF — стиль на каждом кадре', () => {
    // Модель отвечает, что анимации нужно, — ей стиль не нужен. Стенд показывает, что Chromium
    // обновляет его на кадрах, которые и так рисует главный поток. Сам цикл стиля не считает.
    expect(plan.framePlan([css({ transform: ['none', 'translateX(300px)'] })]).style).toBe(false);
    expect(t.STAND.drivers['css transform + rAF'].style).toBeGreaterThanOrEqual(FPS - 2);
    expect(t.STAND.drivers['none + rAF'].style).toBe(0);
    expect(t.STAND.drivers['waapi transform'].style).toBe(0);
    expect(t.BLOCK_STYLE_FACT).toContain('0 пересчётов стиля за секунду');
    expect(t.PITFALLS.find((p) => p.n === '04')!.d).toContain('шестьдесят');
  });
});

describe('занятый главный поток: композитор ⇔ элемент двигался', () => {
  const BLOCK: Record<string, AnimSpec[]> = {
    'css-transform': [css({ transform: ['translateX(0)', 'translateX(700px)'] })],
    'css-left': [css({ left: ['0px', '700px'] })],
    'waapi-transform': [{ by: 'waapi', keyframes: { transform: ['translateX(0)', 'translateX(700px)'] } }],
    'raf-transform': [{ by: 'raf', keyframes: { transform: ['translateX(0)', 'translateX(700px)'] } }],
    'transition-transform': [css({ transform: ['none', 'translateX(700px)'] })],
    'transform+box-shadow': [css({ transform: ['translateX(0)', 'translateX(700px)'], 'box-shadow': ['0 0 0 #888', '0 0 6px #888'] })],
    'transform, box-shadow отдельно': [css({ transform: ['translateX(0)', 'translateX(700px)'] }), css({ 'box-shadow': ['0 0 0 #888', '0 0 6px #888'] })],
    'transition transform, box-shadow': [css({ transform: ['none', 'translateX(700px)'] }), css({ 'box-shadow': ['none', '0 0 6px #888'] })],
    'css-opacity': [css({ opacity: ['1', '0'] })],
    'css-background-color': [css({ 'background-color': ['#000', '#fff'] })],
    'filter-brightness': [css({ filter: ['brightness(1)', 'brightness(0)'] })],
    'filter-blur': [css({ filter: ['blur(0)', 'blur(10px)'] })],
    'css-box-shadow': [css({ 'box-shadow': ['0 0 0 0 #888', '0 0 0 12px #888'] })],
    'css-clip-path': [css({ 'clip-path': ['inset(0px)', 'inset(15px)'] })],
    'waapi-left': [{ by: 'waapi', keyframes: { left: ['0px', '700px'] } }],
  };

  it('каждая полоса стенда описана, и таблица темы называет все пятнадцать', () => {
    expect(Object.keys(BLOCK).sort()).toEqual(Object.keys(t.STAND.block.moved).sort());
    expect(t.BLOCK_ROWS.map((r) => r.id).sort()).toEqual(Object.keys(t.STAND.block.moved).sort());
    expect(t.BLOCK_NOTE).toContain(`за секунду пришло ${t.STAND.block.framesDuring}`);
  });

  it.each(Object.entries(BLOCK))('%s', (id, specs) => {
    // Видимое движение несёт первая анимация полосы.
    expect(plan.framePlan(specs).plans[0].thread === 'compositor').toBe(t.STAND.block.moved[id]);
  });
});

describe('демо «Кадр анимации»', () => {
  it.each(t.DEMO_CASES.map((c) => [c.id, c] as const))('%s: framePlan совпадает с Chromium', (_id, c) => {
    expect(agrees(plan.framePlan(c.animations), c, FPS)).toBe(true);
  });

  it('ссылки демо на литералы стенда не перепутаны', () => {
    const byId = Object.fromEntries(t.DEMO_CASES.map((c) => [c.id, c]));
    expect(byId.transform.chromium).toBe(t.prop('transform'));
    expect(byId.blur.chromium.compositeFailed).toBe(4096);
    expect(byId.left.chromium.unsupported).toEqual(['left']);
    expect(byId.mixed.chromium).toBe(t.STAND.drivers['one keyframes transform+box-shadow']);
    expect(standStages(byId.split).firstOnCompositor).toBe(true);
    expect(standStages(byId.mixed).firstOnCompositor).toBe(false);
  });
});

describe('биты compositeFailed', () => {
  it('8224 = 8192 + 32, 4096 — один бит; таблица называет эти три', () => {
    const bits = (n: number) => [...Array(24).keys()].filter((i) => n & (1 << i)).map((i) => 1 << i);
    expect(bits(8224)).toEqual([32, 8192]);
    expect(bits(4096)).toEqual([4096]);
    expect(t.FAIL_ROWS.map((r) => Number(r[0])).sort((a, b) => a - b)).toEqual([32, 4096, 8192]);
    const seen = new Set(t.STAND.props.flatMap((r) => bits(r.compositeFailed)));
    expect([...seen].sort((a, b) => a - b)).toEqual([32, 4096, 8192]);
  });
});

/** Сцены стенда `LayerTree` в терминах `ownLayer`. */
const animated: LayerEl = { animations: [css({ transform: ['none', 'translateX(300px)'] })] };
const many = (n: number, el: LayerEl) => Array.from({ length: n }, () => ({ ...el }));
const SCENES: Record<string, LayerEl[]> = {
  'обычный блок': [{}],
  'transform: translateX(10px)': [{ transform: 'translateX(10px)' }],
  'transform: translateZ(0)': [{ transform: 'translateZ(0)' }],
  'will-change: transform': [{ willChange: ['transform'] }],
  'will-change: opacity': [{ willChange: ['opacity'] }],
  'идёт анимация transform': [animated],
  'идёт анимация opacity': [{ animations: [css({ opacity: ['1', '.2'] })] }],
  'идёт анимация filter: grayscale()': [{ animations: [css({ filter: ['none', 'grayscale(1)'] })] }],
  'идёт анимация filter: blur()': [{ animations: [css({ filter: ['none', 'blur(8px)'] })] }],
  'идёт анимация transform + box-shadow (одни keyframes)': [
    { animations: [css({ transform: ['none', 'translateX(300px)'], 'box-shadow': ['none', '0 0 20px red'] })] },
  ],
  'идёт анимация clip-path': [{ animations: [css({ 'clip-path': ['none', 'inset(20px)'] })] }],
  'идёт анимация left': [{ animations: [css({ left: ['0px', '300px'] })] }],
  'идёт анимация background-color': [{ animations: [css({ 'background-color': ['red', 'blue'] })] }],
  'transform в rAF': [{ transform: 'translateX(10px)', animations: [{ by: 'raf', keyframes: { transform: ['translateX(0)', 'translateX(300px)'] } }] }],
  'position: fixed': [{ position: 'fixed' }],
  '100 карточек': many(100, {}),
  '100 карточек с will-change': many(100, { willChange: ['transform'] }),
  '100 карточек поверх анимации': [animated, ...many(100, { overLayer: true })],
  '100 карточек с will-change поверх анимации': [animated, ...many(100, { willChange: ['transform'], overLayer: true })],
};

describe('countLayers против LayerTree', () => {
  it.each(Object.entries(SCENES))('%s', (key, elements) => {
    const got = layers.countLayers(elements);
    const want = t.STAND.layers[key];
    expect(got.count).toBe(want.count);
    expect(got.reasons).toEqual(want.reasons);
  });

  it('сцены демо — те же, что на стенде', () => {
    for (const s of t.LAYER_SCENES) {
      const got = layers.countLayers(s.elements);
      expect(got.count, s.id).toBe(s.chromium.count);
      expect(got.reasons, s.id).toEqual(s.chromium.reasons);
    }
  });

  it('слой без названной причины — только у 3D-преобразования', () => {
    expect(layers.ownLayer({ transform: 'translateZ(0)' })).toEqual({ layer: true, reason: null });
    expect(layers.ownLayer({ transform: 'translateX(10px)' })).toEqual({ layer: false, reason: null });
  });

  it('свой слой ≠ композитная анимация: blur — слой без композитора, background-color — наоборот', () => {
    const blur = css({ filter: ['none', 'blur(8px)'] });
    const bg = css({ 'background-color': ['red', 'blue'] });
    expect(plan.planAnimation(blur).thread).toBe('main');
    expect(layers.ownLayer({ animations: [blur] }).layer).toBe(true);
    expect(plan.planAnimation(bg).thread).toBe('compositor');
    expect(layers.ownLayer({ animations: [bg] }).layer).toBe(false);
  });
});

describe('байты слоёв — арифметика по размерам LayerTree', () => {
  const z = t.STAND.layerSizes;
  const b = (s: number[], n = 1, dpr = 1) => layerBytes(s[0], s[1], dpr) * n;

  it('литералы стенда складываются из размеров слоёв', () => {
    expect(t.STAND.layers['обычный блок'].bytes).toBe(b(z.root));
    expect(t.STAND.layers['100 карточек с will-change'].bytes).toBe(b(z.root) + b(z.card, 100));
    expect(t.STAND.layers['100 карточек с will-change, DPR 2'].bytes).toBe(b(z.root, 1, 2) + b(z.card, 100, 2));
    expect(t.STAND.layers['100 карточек поверх анимации'].bytes).toBe(b(z.root) + b(z.anim) + b(z.squashed));
    expect(t.STAND.layers['100 карточек с will-change поверх анимации'].bytes).toBe(b(z.root) + b(z.anim) + b(z.card, 100));
    expect(t.STAND.layers['position: fixed'].bytes).toBe(b(z.fixedRoot) + layerBytes(100, 100, 1));
  });

  it('склеенный слой по байтам больше ста маленьких — как говорит текст', () => {
    expect(t.LAYER_COST.squashed).toBe(1_267_200);
    expect(t.LAYER_COST.cards).toBe(960_000);
    expect(t.LAYER_COST.cardsDpr2).toBe(3_840_000);
    expect(t.LAYER_COST.squashed).toBeGreaterThan(t.LAYER_COST.cards);
    expect(t.EXPLOSION_NOTE).toContain('по байтам он больше ста маленьких');
    expect(t.EXPLOSION_ROWS.map((r) => Number(r[1]))).toEqual([1, 101, 3, 102]);
  });

  it('жизнь слоя анимации: 1 → 2 → 1', () => {
    expect(t.STAND.layerLifetime).toEqual({ before: 1, during: 2, after: 1 });
    expect(t.LAYER_FACTS[1].d).toContain('во время — 2');
  });
});

describe('примеры темы исполняются', () => {
  /** Заглушка элемента: запоминает ключевые кадры `animate` и классы. */
  function stubCard() {
    const calls: { keyframes: Record<string, string>[]; options: Record<string, unknown> }[] = [];
    const classes: string[] = [];
    let finish: () => void = () => {};
    const finished = new Promise<void>((ok) => (finish = ok));
    const card = {
      animate(keyframes: Record<string, string>[], options: Record<string, unknown>) {
        calls.push({ keyframes, options });
        return { finished };
      },
      classList: { add: (c: string) => classes.push(c) },
    };
    return { card, calls, classes, finish };
  }

  /** Ключевые кадры WAAPI (массив объектов) → вход `planAnimation`. */
  function toSpec(frames: Record<string, string>[]): AnimSpec {
    const keyframes: Record<string, [string, string]> = {};
    for (const prop of Object.keys(frames[0])) keyframes[prop] = [frames[0][prop], frames.at(-1)![prop]];
    return { by: 'waapi', keyframes };
  }

  it('WAAPI_CODE: только transform и opacity — анимация целиком на композиторе', async () => {
    const s = stubCard();
    new Function('card', t.WAAPI_CODE)(s.card);
    expect(s.calls).toHaveLength(1);
    const p = plan.planAnimation(toSpec(s.calls[0].keyframes));
    expect(p.props.sort()).toEqual(['opacity', 'transform']);
    expect(p.thread).toBe('compositor');
    s.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.classes).toEqual(['shown']);
  });

  it('RAF_CODE: за десять кадров точка проходит 89% пути', () => {
    const handlers: Record<string, (e: { clientX: number }) => void> = {};
    let queue: (() => void)[] = [];
    const dot = { style: { transform: '' } };
    new Function('addEventListener', 'requestAnimationFrame', 'dot', t.RAF_CODE)(
      (type: string, fn: (e: { clientX: number }) => void) => (handlers[type] = fn),
      (fn: () => void) => queue.push(fn),
      dot,
    );
    handlers.pointermove({ clientX: 100 });
    for (let i = 0; i < 10; i++) {
      const run = queue;
      queue = [];
      run.forEach((fn) => fn());
    }
    const x = Number(/translateX\(([\d.]+)px\)/.exec(dot.style.transform)![1]);
    expect(x).toBeCloseTo(100 * (1 - 0.8 ** 10), 6);
    expect(Math.round(x)).toBe(89);
    expect(t.RAF_NOTE).toContain('89%');
    // Значение пишет JS — для модели это всегда главный поток.
    expect(plan.planAnimation({ by: 'raf', keyframes: { transform: ['translateX(0)', dot.style.transform] } }).thread).toBe('main');
  });

  it('REDUCED_CODE: при reduce — только прозрачность, иначе сдвиг и прозрачность; обе композитны', () => {
    for (const matches of [true, false]) {
      const s = stubCard();
      const show = new Function('matchMedia', `${t.REDUCED_CODE}\nreturn show;`)(() => ({ matches })) as (c: unknown) => void;
      show(s.card);
      const spec = toSpec(s.calls[0].keyframes);
      expect(Object.keys(spec.keyframes).sort()).toEqual(matches ? ['opacity'] : ['opacity', 'transform']);
      expect(plan.planAnimation(spec).thread).toBe('compositor');
    }
  });
});

describe('prefers-reduced-motion: таблица темы = стенд', () => {
  it('браузер сам ничего не гасит; глобальное правило не трогает WAAPI и rAF', () => {
    expect(t.STAND.reduced).toMatchObject({ matches: true, cssWithoutMedia: 1, cssWithMedia: 0, transition: 1, waapi: 1 });
    expect(t.STAND.reducedGlobal).toEqual({ css: 0, transition: 0, waapi: { playState: 'running', duration: 1000 }, rafFrames: 10 });
    const row = (k: string) => t.REDUCED_ROWS.find((r) => r[0].includes(k))!;
    expect(row('element.animate')[2]).toContain('running');
    expect(row('requestAnimationFrame')[2]).toContain('10 кадров из 10');
    expect(t.PITFALLS.find((p) => p.n === '07')!.d).toContain('продолжают двигать');
  });

  it('типы анимаций в протоколе отладчика и классы в getAnimations', () => {
    expect(t.STAND.animTypes.map((a) => a.type).sort()).toEqual(['CSSAnimation', 'CSSTransition', 'WebAnimation']);
    expect(t.STAND.reduced.classes).toEqual(['CSSAnimation', 'CSSTransition', 'Animation']);
    expect(t.DRIVER_ROWS[2][2]).toContain('`WebAnimation`');
  });
});

describe('текст не разошёлся со стендом', () => {
  it('композитный набор в тексте = свойства без отказа на стенде', () => {
    const ok = t.STAND.props.filter((r) => !r.compositeFailed).map((r) => r.p);
    for (const p of ['filter', 'background-color', 'clip-path', 'translate', 'rotate', 'scale']) expect(ok).toContain(p);
    expect(t.PROP_FACTS[0].d).toContain('`filter`, `background-color` и `clip-path`');
    // blur — отказ 4096 при нуле раскладок и без перерисовки на кадр.
    const blur = t.prop('filter: blur()');
    expect([blur.compositeFailed, blur.layout, blur.paint > FPS]).toEqual([4096, 0, false]);
  });

  it('у композитных — ноль пересчётов стиля и раскладок за секунду', () => {
    for (const r of t.STAND.props.filter((x) => !x.compositeFailed)) {
      expect([r.label, r.style, r.layout]).toEqual([r.label, 0, 0]);
    }
    expect(t.PROP_NOTE).toContain('ноль пересчётов стиля и ноль раскладок');
  });

  it('счётчики стенда — около 60 кадров в секунду там, где работа на кадр есть', () => {
    for (const r of t.STAND.props.filter((x) => x.compositeFailed)) {
      expect(Math.abs(r.style - FPS), r.label).toBeLessThanOrEqual(8);
    }
  });
});
