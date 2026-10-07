import { describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/hmr/data';
import { loadFindBoundary } from '@/widgets/hmr-boundary/model/run';
import type { BoundaryResult, HmrJournal, ObservedMessage } from '@/widgets/hmr-boundary/model/types';

/**
 * Тема «HMR изнутри».
 *
 * `FIND_BOUNDARY_CODE` — строка из темы: она напечатана на странице и исполняется демо.
 * Здесь та же строка прогоняется на графах стенда, и ответ сверяется с тем, что прислал
 * **настоящий Vite 8.3.0** на той же фикстуре (журналы — литералами в `JOURNALS`, как сняты
 * стендом: `createServer` + Chromium 153, см. шапку `data.ts`). Расхождение учебной функции
 * с Vite — красный тест, а не находка читателя.
 *
 * Сверяются три вещи:
 *  1. перезагрузка или обновление;
 *  2. сообщение: тип и пары `path` / `acceptedPath` — поля, которые функция вычисляет
 *     (`explicitImportRequired` и `isWithinCircularImport` она не моделирует и не печатает);
 *  3. какие адреса браузер перезапросил с `?t=` — только когда перезагрузки не было.
 */

const findBoundary = loadFindBoundary(t.FIND_BOUNDARY_CODE);

type Projected =
  | { type: 'update'; updates: { type: string; path: string; acceptedPath: string }[] }
  | { type: 'full-reload' };

/** Сообщение Vite без полей, которых функция не считает. `custom` к поиску границы не относится. */
function project(m: ObservedMessage): Projected | null {
  if (m.type === 'custom') return null;
  if (m.type === 'full-reload') return { type: 'full-reload' };
  return { type: 'update', updates: m.updates.map((u) => ({ type: u.type, path: u.path, acceptedPath: u.acceptedPath })) };
}

function projectResult(r: BoundaryResult): Projected {
  return r.payload.type === 'full-reload'
    ? { type: 'full-reload' }
    : { type: 'update', updates: r.payload.updates.map((u) => ({ type: u.type, path: u.path, acceptedPath: u.acceptedPath })) };
}

/** Что сделала бы функция на тех шагах, что прошёл Vite: правка и, если был, `invalidate`. */
function simulate(j: HmrJournal): { messages: Projected[]; reload: boolean; refetch: string[] } {
  const first = findBoundary(j.graph, j.changed);
  const messages = [projectResult(first)];
  let reload = first.reload;
  const refetch = [...first.refetch];

  if (j.invalidates && !first.reload) {
    // Колбэк `accept` у изменённого модуля позвал invalidate(): подъём продолжается
    // от его импортёров, а его собственный accept больше не в счёт.
    const second = findBoundary(j.graph, j.changed, { invalidated: true });
    messages.push(projectResult(second));
    reload = second.reload;
    for (const u of second.refetch) if (!refetch.includes(u)) refetch.push(u);
  }
  return { messages, reload, refetch };
}

/** `<link>` клиент перезапрашивает по чистому адресу: `?direct` срезается. */
const clean = (url: string) => url.replace(/\?direct$/, '');

describe('FIND_BOUNDARY_CODE против журналов настоящего Vite', () => {
  it('журналы на месте', () => {
    // Меньше — значит часть стенда потерялась при правке данных.
    expect(t.JOURNALS.length).toBeGreaterThanOrEqual(18);
    expect(new Set(t.JOURNALS.map((j) => j.id)).size).toBe(t.JOURNALS.length);
  });

  for (const j of t.JOURNALS) {
    describe(j.id, () => {
      const sim = simulate(j);
      const observed = j.messages.map(project).filter((m): m is Projected => m !== null);

      it('перезагрузка или обновление — как у Vite', () => {
        expect(sim.reload, `${j.id}: функция ${sim.reload ? 'перезагружает' : 'обновляет'}, Vite — наоборот`).toBe(j.reload);
      });

      it('сообщения совпадают по типу и парам path/acceptedPath', () => {
        expect(sim.messages).toEqual(observed);
      });

      it('перезапрошенные адреса совпадают', () => {
        if (j.reload) return;
        expect(new Set(sim.refetch.map(clean))).toEqual(new Set(j.refetched));
      });

      it('журнал сервера согласован с сообщением', () => {
        const last = j.log[j.log.length - 1];
        expect(last.startsWith(j.reload ? 'page reload' : 'hmr update')).toBe(true);
      });
    });
  }
});

describe('журналы согласованы между собой и с демо', () => {
  it('каждый вариант демо — тот же граф, что у его журналов', () => {
    for (const j of t.JOURNALS.filter((x) => x.variant)) {
      const v = t.DEMO_VARIANTS.find((x) => x.id === j.variant);
      expect(v, `${j.id}: нет варианта ${j.variant}`).toBeDefined();
      expect(v!.graph, `${j.id}: граф журнала разошёлся с вариантом демо`).toEqual(j.graph);
    }
  });

  it('у каждого варианта демо есть хотя бы один прогон стенда', () => {
    for (const v of t.DEMO_VARIANTS) {
      expect(t.JOURNALS.some((j) => j.variant === v.id), v.id).toBe(true);
    }
  });

  it('у каждого узла демо есть место на схеме', () => {
    for (const v of t.DEMO_VARIANTS) for (const url of Object.keys(v.graph)) expect(t.DEMO_POS[url], url).toBeDefined();
  });

  it('сообщение `update` из текста — дословно из журнала', () => {
    // PAYLOAD_UPDATE_CODE показывает сценарий app-dep/utils; его пара path/acceptedPath обязана
    // совпадать с журналом, иначе комментарий «что импортировать заново» врёт.
    const j = t.JOURNALS.find((x) => x.id === 'app-dep/utils')!;
    const u = (j.messages[0] as Extract<ObservedMessage, { type: 'update' }>).updates[0];
    expect(t.PAYLOAD_UPDATE_CODE).toContain(`"path": "${u.path}"`);
    expect(t.PAYLOAD_UPDATE_CODE).toContain(`"acceptedPath": "${u.acceptedPath}"`);
  });
});

describe('состояние: то, на что опирается текст', () => {
  const byId = (id: string) => t.JOURNALS.find((j) => j.id === id)!;

  it('принятие себя обнуляет модульное состояние, hot.data его переносит', () => {
    expect(byId('button-self/utils')).toMatchObject({ before: 'v1:3', after: 'v2:0' });
    expect(byId('button-self-data/utils')).toMatchObject({ before: 'v1:3', after: 'v2:3' });
    expect(t.ACCEPT_ROWS.some((r) => r.state.includes('`v1:3` → `v2:3`'))).toBe(true);
  });

  it('Vue: шаблон сохраняет состояние, script setup — нет', () => {
    expect(byId('vue/template').after).toBe('счёт (новый): 3');
    expect(byId('vue/script').after).toBe('счёт: 0');
    // Подстрока короткая и смысловая: ради неё и писалась строка таблицы.
    expect(t.VUE_ROWS[0].state).toContain('состояние на месте');
    expect(t.VUE_ROWS[1].state).toContain('`setup` вызван заново');
  });

  it('две тупиковые ветки: текст обещает перезагрузку, стенд её дал', () => {
    expect(byId('two-paths/utils').reload).toBe(true);
    expect(t.PITFALLS[0].d).toContain('full-reload');
  });
});

describe('учебная функция на графах, которых на стенде не было', () => {
  it('принятие зависимости на двух ветках даёт два обновления в одном сообщении', () => {
    const graph = {
      '/main.js': { imports: ['/A.js', '/B.js'] },
      '/A.js': { imports: ['/utils.js'], accept: ['/utils.js'] },
      '/B.js': { imports: ['/utils.js'], accept: 'self' as const },
      '/utils.js': { imports: [] },
    };
    const r = findBoundary(graph, '/utils.js');
    expect(r.reload).toBe(false);
    expect(r.payload.type === 'update' && r.payload.updates.map((u) => [u.path, u.acceptedPath])).toEqual([
      ['/A.js', '/utils.js'],
      ['/B.js', '/B.js'],
    ]);
  });

  it('импорт по кругу не зацикливает подъём', () => {
    const graph = {
      '/main.js': { imports: ['/a.js'] },
      '/a.js': { imports: ['/b.js'] },
      '/b.js': { imports: ['/a.js'] },
    };
    expect(findBoundary(graph, '/b.js').reload).toBe(true);
  });
});
