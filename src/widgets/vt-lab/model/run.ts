import type { VtAnimRow, VtLogEntry, VtScenarioKey, VtTone } from './types';

/**
 * Прогон настоящего `document.startViewTransition` на сцене демо.
 *
 * Здесь нет ни одной заготовленной строки о поведении браузера: порядок записей в журнале —
 * порядок, в котором пришли колбэк и промисы, текст ошибки — `name` и `message` того, что
 * отклонило `ready`, список анимаций — то, что вернул `document.getAnimations()`. Модуль
 * не знает про Vue: сцену ему отдаёт компонент через `VtHost`, поэтому тот же код гоняет
 * и браузерный стенд проверки (сборка esbuild, три движка).
 *
 * ⚠️ Модуль исполняется только по нажатию кнопки: в `setup` острова (а значит, и в Node
 * на сборке) он не вызывается, и `document` здесь трогается только внутри функций.
 */

/** Все сценарии, которые умеет прогон: сверяется тестом с `VT_SCENARIOS` в данных темы. */
export const VT_SCENARIO_KEYS: readonly VtScenarioKey[] = ['plain', 'slow', 'duplicate', 'skip', 'overlap'];

/** `view-transition-class` карточек сцены: на него смотрит правило длительности в `VtLab.vue`. */
export const VT_CLASS = 'vt-card';
/** Имена даются на время прогона и снимаются после `finished` — постоянных имён на странице нет. */
export const NAME_PREFIX = 'vt-card-';
/** «Ответ сервера» в сценарии медленного колбэка. */
export const SLOW_MS = 800;

/**
 * Минимум API, на который опирается прогон. Свой тип, а не `lib.dom`: так модуль не зависит
 * от того, какие поля успела описать версия TypeScript (`activeViewTransition`, например).
 */
interface Transition {
  updateCallbackDone: Promise<void>;
  ready: Promise<void>;
  finished: Promise<void>;
  skipTransition(): void;
}
type Start = (update?: () => unknown) => Transition;

/** Что компонент отдаёт прогону. */
export interface VtHost {
  doc: Document;
  /** Карточки сцены в DOM; ключ — атрибут `data-vt-key`. */
  cards(): HTMLElement[];
  /** Поменять сцену и дождаться, пока фреймворк донесёт изменение до DOM. */
  update(): Promise<void>;
}

export interface VtSink {
  log(entry: VtLogEntry): void;
  /** Снимок анимаций на момент `ready` (и сразу после `skipTransition`). */
  anims(rows: VtAnimRow[]): void;
}

/** `::view-transition-old(vt-card-a)` → `{ part: 'old', name: 'vt-card-a' }`. */
export function parsePseudo(pseudo: string | null | undefined): { part: string; name: string } | null {
  const m = /^::view-transition-([a-z-]+)\(([^)]+)\)$/.exec(pseudo ?? '');
  return m ? { part: m[1], name: m[2] } : null;
}

/** Как отклонённый промис выглядит в журнале: имя нормативно, текст у каждого движка свой. */
export function formatError(e: unknown): string {
  if (e && typeof e === 'object' && 'name' in e) {
    const { name, message } = e as { name: unknown; message?: unknown };
    return message ? `${String(name)}: ${String(message)}` : String(name);
  }
  return String(e);
}

/** Строки таблицы анимаций из того, что вернул `getAnimations()`: только псевдоэлементы перехода. */
export function toRows(animations: Animation[]): VtAnimRow[] {
  const rows: VtAnimRow[] = [];
  for (const a of animations) {
    const effect = a.effect as KeyframeEffect | null;
    const parsed = parsePseudo(effect?.pseudoElement);
    if (!parsed) continue;
    const duration = effect?.getComputedTiming().duration;
    rows.push({
      ...parsed,
      animation: (a as CSSAnimation).animationName ?? '—',
      duration: typeof duration === 'number' ? duration : 0,
      state: a.playState,
    });
  }
  const order = ['group', 'image-pair', 'old', 'new'];
  return rows.sort((x, y) => x.name.localeCompare(y.name) || order.indexOf(x.part) - order.indexOf(y.part));
}

export function hasApi(doc: Document): boolean {
  return typeof (doc as unknown as { startViewTransition?: unknown }).startViewTransition === 'function';
}

/**
 * Один прогон сценария. Промис разрешается, когда всё закончилось и имена сняты.
 *
 * Корень документа на время прогона исключён (`view-transition-name: none` на `<html>`):
 * иначе браузер снял бы всю страницу, и в список попали бы ещё пять анимаций группы `root`,
 * а прокрутка на эти полсекунды показывала бы снимок вместо страницы.
 */
export async function runScenario(host: VtHost, key: VtScenarioKey, sink: VtSink): Promise<void> {
  const { doc } = host;
  const win = doc.defaultView;
  let frame = 0;
  let ticking = true;
  const tick = () => {
    if (!ticking) return;
    frame += 1;
    win?.requestAnimationFrame(tick);
  };
  win?.requestAnimationFrame(tick);

  const log = (tone: VtTone, text: string) => sink.log({ frame, tone, text });
  const root = doc.documentElement;

  if (!hasApi(doc)) {
    await host.update();
    log('err', 'В этом браузере `document.startViewTransition` нет: DOM изменён без перехода.');
    ticking = false;
    return;
  }

  const start = (doc as unknown as { startViewTransition: Start }).startViewTransition.bind(doc);
  const cards = host.cards();
  root.style.setProperty('view-transition-name', 'none');
  for (const card of cards) card.style.setProperty('view-transition-name', NAME_PREFIX + card.dataset.vtKey);

  /** Вешает журнал на три промиса; метка нужна, когда переходов два. */
  const watch = (t: Transition, tag: string, extra?: { onReady?: () => void }) => {
    const done = t.updateCallbackDone.then(
      () => log('ok', `${tag}\`updateCallbackDone\` — колбэк завершился, DOM в новом состоянии`),
      (e) => log('err', `${tag}\`updateCallbackDone\` отклонён — ${formatError(e)}`),
    );
    const ready = t.ready.then(
      () => {
        const rows = toRows(doc.getAnimations());
        sink.anims(rows);
        log('ok', `${tag}\`ready\` — новое состояние снято, псевдоэлементы построены: анимаций ${rows.length}`);
        extra?.onReady?.();
      },
      (e) => log('err', `${tag}\`ready\` отклонён — ${formatError(e)}`),
    );
    const finished = t.finished.then(
      () => log('ok', `${tag}\`finished\` — оверлей снят, анимаций перехода: ${toRows(doc.getAnimations()).length}`),
      (e) => log('err', `${tag}\`finished\` отклонён — ${formatError(e)}`),
    );
    return Promise.all([done, ready, finished]);
  };

  try {
    if (key === 'overlap') {
      const t1 = start(async () => {
        log('call', '#1 колбэк вызван — хотя переход #1 уже отменён');
        await host.update();
      });
      log('sync', '#1 `startViewTransition()` вернул объект');
      const w1 = watch(t1, '#1 ');
      const t2 = start(async () => {
        log('call', '#2 колбэк: старое состояние снято, меняем DOM');
        await host.update();
      });
      log('sync', '#2 `startViewTransition()` вызван сразу следом, до кадра');
      const w2 = watch(t2, '#2 ');
      await Promise.all([w1, w2]);
      return;
    }

    let skipAt: (() => void) | undefined;
    const t = start(async () => {
      if (key === 'slow') {
        const before = frame;
        log('call', `колбэк: старое состояние снято, ждём «ответа сервера» ${SLOW_MS} мс`);
        await new Promise((ok) => win?.setTimeout(ok, SLOW_MS));
        log('info', `колбэк: за время ожидания отрисовано кадров — ${frame - before}`);
      } else {
        log('call', 'колбэк: старое состояние снято, меняем DOM');
      }
      await host.update();
      if (key === 'duplicate') {
        const [first, second] = host.cards();
        const name = NAME_PREFIX + first.dataset.vtKey;
        second.style.setProperty('view-transition-name', name);
        log('call', `колбэк: второй карточке то же имя \`${name}\`, что и первой`);
      }
    });
    log('sync', '`startViewTransition()` вернул объект; колбэк ещё не вызван');

    if (key === 'skip') {
      skipAt = () => {
        t.skipTransition();
        const rows = toRows(doc.getAnimations());
        sink.anims(rows);
        log('call', `\`skipTransition()\` сразу после \`ready\`: анимаций перехода осталось ${rows.length}`);
      };
    }
    await watch(t, '', { onReady: skipAt });
  } finally {
    // Имена живут только на время перехода: постоянное имя на странице — это будущий дубль.
    for (const card of host.cards()) card.style.removeProperty('view-transition-name');
    root.style.removeProperty('view-transition-name');
    ticking = false;
  }
}
