import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BASIC_CODE,
  ABORT_HEAD,
  ABORT_ROWS,
  DUP_HEAD,
  DUP_ROWS,
  ENGINES_HEAD,
  ENGINES_ROWS,
  MOTION_CODE,
  MPA_HEAD,
  MPA_ROWS,
  PITFALLS,
  PROMISES_HEAD,
  PROMISES_ROWS,
  VT_SCENARIOS,
} from '../../src/content/render/view-transitions/data';
import {
  NAME_PREFIX,
  VT_CLASS,
  VT_SCENARIO_KEYS,
  formatError,
  parsePseudo,
  runScenario,
  toRows,
  type VtHost,
} from '../../src/widgets/vt-lab/model/run';
import type { VtLogEntry, VtScenarioKey } from '../../src/widgets/vt-lab/model/types';

/**
 * Тема «View Transitions: анимация между состояниями».
 *
 * Что проверяемо в Node, проверяется здесь; поведение самого браузера — нет: в Node нет ни
 * `startViewTransition`, ни отрисовки. Его снимал стенд из шапки `data.ts` в трёх движках,
 * и тот же стенд прогонял модуль демо `widgets/vt-lab/model/run.ts`, собранный esbuild.
 *
 * Здесь закреплено то, что может сломаться молча:
 *   - пример `BASIC_CODE` исполняется как напечатан — без API, с API и с отказом `ready`;
 *   - прогон демо снимает имена и исключение корня после себя, в том числе когда переход
 *     отклонён, и в сценарии «одинаковые имена» действительно создаёт дубль в новом снимке;
 *   - разбор `pseudoElement` и сортировка строк таблицы анимаций;
 *   - правило `prefers-reduced-motion` для псевдоэлементов перехода стоит в общих стилях курса.
 *
 * ⚠️ Стаб `document` ниже — не модель браузера. Он повторяет только то, что снято стендом
 * (колбэк вызывается асинхронно, дубль отклоняет `ready`), и нужен, чтобы проверить учёт
 * имён в прогоне, а не семантику API.
 */

/* ─────────────── стабы ─────────────── */

class FakeStyle {
  private props = new Map<string, string>();
  setProperty(k: string, v: string) {
    this.props.set(k, v);
  }
  removeProperty(k: string) {
    this.props.delete(k);
  }
  getPropertyValue(k: string) {
    return this.props.get(k) ?? '';
  }
}

interface FakeEl {
  style: FakeStyle;
  dataset: { vtKey: string };
}

const el = (key: string): FakeEl => ({ style: new FakeStyle(), dataset: { vtKey: key } });

function makeDoc(opts: { api: boolean }) {
  const root = { style: new FakeStyle() };
  let cards = [el('a'), el('b'), el('c')];
  const seenNew: string[][] = [];
  const doc = {
    documentElement: root,
    defaultView: {
      requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0),
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 5)),
    },
    getAnimations: () => [],
    ...(opts.api && {
      startViewTransition(update?: () => unknown) {
        const updateCallbackDone = Promise.resolve().then(() => update?.());
        const ready = updateCallbackDone.then(() => {
          const names = cards.map((c) => c.style.getPropertyValue('view-transition-name'));
          seenNew.push(names);
          if (new Set(names).size !== names.length) {
            throw Object.assign(new Error('дубль'), { name: 'InvalidStateError' });
          }
        });
        const finished = ready.catch(() => undefined);
        return { updateCallbackDone, ready, finished, skipTransition() {} };
      },
    }),
  };
  const host: VtHost = {
    doc: doc as unknown as Document,
    cards: () => cards as unknown as HTMLElement[],
    update: async () => {
      cards = [...cards.slice(1), cards[0]];
    },
  };
  return { doc, root, host, seenNew, cards: () => cards };
}

async function run(key: VtScenarioKey, api = true) {
  const env = makeDoc({ api });
  const log: VtLogEntry[] = [];
  await runScenario(env.host, key, { log: (e) => log.push(e), anims: () => {} });
  return { ...env, log };
}

/* ─────────────── пример из темы ─────────────── */

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

const basic = new AsyncFunction('document', 'list', `${BASIC_CODE}\nreturn t`);

function list() {
  const items = ['1', '2', '3'];
  return {
    items,
    get firstElementChild() {
      return items[0];
    },
    append(x: string) {
      items.splice(items.indexOf(x), 1);
      items.push(x);
    },
  };
}

describe('BASIC_CODE исполняется как напечатан', () => {
  it('без API: обновление применено синхронно, объекта перехода нет', async () => {
    const l = list();
    const t = await basic({}, l);
    expect(t).toBeNull();
    expect(l.items).toEqual(['2', '3', '1']);
  });

  it('с API: колбэк отдан браузеру и выполнен', async () => {
    const l = list();
    let called = 0;
    const doc = {
      startViewTransition(update: () => void) {
        const updateCallbackDone = Promise.resolve().then(() => {
          called += 1;
          update();
        });
        return { updateCallbackDone, ready: updateCallbackDone, finished: updateCallbackDone };
      },
    };
    await basic(doc, l);
    expect(called).toBe(1);
    expect(l.items).toEqual(['2', '3', '1']);
  });

  /**
   * Самый частый случай на деле: переход пропущен (дубль имени, новый переход, `skipTransition`).
   * Пример обязан дойти до конца: `ready` отклонён, но обработан, `finished` разрешён.
   */
  it('с отказом ready: пример не бросает и отказ обработан', async () => {
    const l = list();
    const doc = {
      startViewTransition(update: () => void) {
        const updateCallbackDone = Promise.resolve().then(update);
        const ready = updateCallbackDone.then(() => {
          throw Object.assign(new Error('пропущен'), { name: 'AbortError' });
        });
        return { updateCallbackDone, ready, finished: ready.catch(() => undefined) };
      },
    };
    await expect(basic(doc, l)).resolves.toBeTruthy();
    expect(l.items).toEqual(['2', '3', '1']);
  });
});

/* ─────────────── модуль демо ─────────────── */

describe('разбор псевдоэлементов и строк таблицы', () => {
  it('parsePseudo', () => {
    expect(parsePseudo('::view-transition-old(vt-card-a)')).toEqual({ part: 'old', name: 'vt-card-a' });
    expect(parsePseudo('::view-transition-image-pair(root)')).toEqual({ part: 'image-pair', name: 'root' });
    expect(parsePseudo('::view-transition-group(-ua-auto-60)')).toEqual({ part: 'group', name: '-ua-auto-60' });
    expect(parsePseudo('::before')).toBeNull();
    expect(parsePseudo(null)).toBeNull();
  });

  it('formatError: имя и текст, а без текста — одно имя', () => {
    expect(formatError({ name: 'InvalidStateError', message: 'x' })).toBe('InvalidStateError: x');
    expect(formatError({ name: 'AbortError' })).toBe('AbortError');
    expect(formatError('строка')).toBe('строка');
  });

  it('toRows: только псевдоэлементы перехода, по имени и по уровню дерева', () => {
    const anim = (pseudo: string | null, name: string) =>
      ({
        effect: { pseudoElement: pseudo, getComputedTiming: () => ({ duration: 600 }) },
        animationName: name,
        playState: 'running',
      }) as unknown as Animation;
    const rows = toRows([
      anim('::view-transition-new(b)', 'fade-in'),
      anim(null, 'чужая анимация элемента'),
      anim('::view-transition-group(b)', 'group-b'),
      anim('::view-transition-old(a)', 'fade-out'),
      anim('::view-transition-group(a)', 'group-a'),
    ]);
    expect(rows.map((r) => `${r.part}(${r.name})`)).toEqual(['group(a)', 'old(a)', 'group(b)', 'new(b)']);
    expect(rows[0].duration).toBe(600);
  });
});

describe('прогон демо убирает за собой', () => {
  it.each(VT_SCENARIO_KEYS.filter((k) => k !== 'slow'))('%s: имена и исключение корня сняты', async (key) => {
    const { root, cards } = await run(key);
    expect(root.style.getPropertyValue('view-transition-name')).toBe('');
    for (const c of cards()) expect(c.style.getPropertyValue('view-transition-name')).toBe('');
  });

  it('во время перехода корень исключён, а у карточек разные имена', async () => {
    const { seenNew } = await run('plain');
    expect(seenNew).toEqual([[`${NAME_PREFIX}b`, `${NAME_PREFIX}c`, `${NAME_PREFIX}a`]]);
  });

  it('«одинаковые имена» создаёт дубль в новом снимке, и ready отклонён', async () => {
    const { seenNew, log } = await run('duplicate');
    const [names] = seenNew;
    expect(names[0]).toBe(names[1]);
    expect(log.some((e) => e.tone === 'err' && e.text.includes('InvalidStateError'))).toBe(true);
    // изменение DOM применено: updateCallbackDone разрешён
    expect(log.some((e) => e.tone === 'ok' && e.text.includes('updateCallbackDone'))).toBe(true);
  });

  it('без API: сцена изменена, одна запись об отсутствии API, имён не было', async () => {
    const { log, cards, root } = await run('plain', false);
    expect(cards().map((c) => c.dataset.vtKey)).toEqual(['b', 'c', 'a']);
    expect(log).toHaveLength(1);
    expect(log[0].tone).toBe('err');
    expect(root.style.getPropertyValue('view-transition-name')).toBe('');
  });
});

/* ─────────────── данные темы ─────────────── */

describe('данные темы согласованы с демо', () => {
  it('сценарии в данных — ровно те, что умеет прогон', () => {
    expect(VT_SCENARIOS.map((s) => s.key).sort()).toEqual([...VT_SCENARIO_KEYS].sort());
  });

  it('у таблиц число ячеек совпадает с шапкой', () => {
    const tables: [string[], string[][]][] = [
      [PROMISES_HEAD, PROMISES_ROWS],
      [DUP_HEAD, DUP_ROWS],
      [ABORT_HEAD, ABORT_ROWS],
      [MPA_HEAD, MPA_ROWS],
      [ENGINES_HEAD, ENGINES_ROWS],
    ];
    for (const [head, rows] of tables) for (const row of rows) expect(row).toHaveLength(head.length);
  });

  it('тонкие места пронумерованы подряд', () => {
    expect(PITFALLS.map((p) => p.n)).toEqual(PITFALLS.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  /**
   * Правило, напечатанное в теме, и правило, которое реально стоит на странице, — одно и то же.
   * Без него демо при `reduce` показывало бы анимации полной длины: браузер это предпочтение
   * для переходов не учитывает (снято в трёх движках).
   */
  it('правило reduced-motion для псевдоэлементов перехода стоит в motion.css', () => {
    const motion = readFileSync(new URL('../../src/shared/styles/motion.css', import.meta.url), 'utf8');
    const block = motion.slice(motion.indexOf('prefers-reduced-motion: reduce'));
    for (const part of ['group', 'image-pair', 'old', 'new']) {
      expect(block, `нет ::view-transition-${part}(*) в motion.css`).toContain(`::view-transition-${part}(*)`);
      expect(MOTION_CODE).toContain(`::view-transition-${part}(*)`);
    }
    expect(block).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
  });

  it('класс перехода у карточек и в правиле длительности — тот же, что в модели', () => {
    const vue = readFileSync(new URL('../../src/widgets/vt-lab/ui/VtLab.vue', import.meta.url), 'utf8');
    expect(vue).toContain(`view-transition-class: ${VT_CLASS};`);
    expect(vue).toContain(`::view-transition-group(*.${VT_CLASS})`);
  });
});
