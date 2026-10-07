import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { SCROLL_TL_CODE, SCROLL_TL_FACTS } from '../../src/content/render/render-pipeline/data';

/**
 * Анимации по таймлайну прокрутки — «Кадр браузера», `SCROLL_TL_CODE` и `SCROLL_TL_FACTS`.
 *
 * Тема утверждает снятое разово в Chromium 153: значение свойства идёт 0 → 0.5 → 1 по позиции
 * прокрутки без единого обработчика `scroll`; явный `animation-duration` ничего не меняет; при
 * главном потоке, занятом циклом, прокрутка колесом проходит и полоса доезжает до конца.
 * В Node нет ни раскладки, ни композитора — спрашивать обязан браузер.
 *
 * Страница — своя, отданная перехватом запроса на `http://localhost` (порт выдуманный, до сети
 * запрос не доходит); сайт курса и `global-setup` не нужны.
 *
 * ⚠️ **Контроль рядом с каждым утверждением** — иначе проверка не отличает «анимация идёт по
 * прокрутке» от «я не прокрутил»:
 *   — та же анимация **без** `animation-timeline` стоит на месте при всех трёх положениях;
 *   — в опыте с блокировкой рядом с полосой на таймлайне стоит полоса на обработчике `scroll`.
 *     Во время блокировки она обязана остаться на месте — это и есть доказательство, что
 *     главный поток действительно не исполнялся, — а после разблокировки доехать: тот же код
 *     при свободном потоке работает.
 *
 * ⚠️ **Блокировка без таймерного порога.** Цикл на главном потоке крутится не «четыре секунды»,
 * а **до сигнала из теста**: он читает флаг в `SharedArrayBuffer`, а флаг ставит воркер, когда
 * тест, сделав прокрутку и снимок, отвечает ему «отпускай». Для `SharedArrayBuffer` страница
 * отдаётся с `COOP`/`COEP` (на `localhost` это безопасный контекст). Время в проверке не
 * участвует нигде, кроме страховки от зависания — и та не решает исход, а валит тест.
 *
 * ⚠️ **Скриншот — это PNG, а не пиксели** (AGENTS.md): кадр декодируется `sharp`, и доля
 * закрашенных пикселей считается по настоящему изображению.
 *
 * ⚠️ **Расхождение с текстом темы — в способе, а не в выводе.** Тема пишет «колесо мыши
 * прокрутило страницу» при занятом потоке. Колесо, посланное из Playwright, при занятом потоке
 * страницу не двигает (подробно — у проверки блокировкой), поэтому источник прокрутки здесь —
 * плавная прокрутка, начатая до цикла. Вывод карточки («работал не JS») проверен; «колесо»
 * в ней этим сторожем не подтверждено.
 */

const ORIGIN = 'http://localhost:5987';

/** Ширина полосы на таймлайне и полосы на обработчике — доля окна, от 0 до 1. */
const PAGE_HTML = `<!doctype html><title>scroll-timeline</title>
<style>
  html, body { margin: 0; }
  body { height: 4000px; }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes grow { to { transform: scaleX(1) } }
  .probe { width: 10px; height: 10px; }
  /* ⚠️ Шорткат animation сбрасывает animation-timeline — поэтому timeline объявлен после него. */
  #tl { animation: fade linear both; animation-timeline: scroll(root block); }
  #tl3s { animation: fade linear both; animation-timeline: scroll(root block); animation-duration: 3s; }
  /* Контроль: та же анимация по часам, остановленная, — прокрутка её не двигает. */
  #clock { animation: fade 3s linear both paused; }
  .bar { position: fixed; left: 0; width: 100%; height: 20px; transform-origin: left; transform: scaleX(0); }
  #tlbar { top: 0; background: rgb(255, 0, 0); animation: grow linear both; animation-timeline: scroll(root block); }
  #jsbar { top: 40px; background: rgb(0, 0, 255); }
</style>
<div class="probe" id="tl"></div><div class="probe" id="tl3s"></div><div class="probe" id="clock"></div>
<div class="bar" id="tlbar"></div><div class="bar" id="jsbar"></div>`;

/** Воркер: ждёт, пока главный поток войдёт в цикл, и отпускает его только по ответу теста. */
const WORKER = `onmessage = async (e) => {
  const flag = new Int32Array(e.data);
  postMessage('ready');
  while (Atomics.load(flag, 0) !== 1) await new Promise((r) => setTimeout(r, 5));
  await fetch('/started');
  for (;;) {
    if ((await (await fetch('/release', { cache: 'no-store' })).text()) === 'yes') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  Atomics.store(flag, 1, 1);
};`;

let released = false;
let started: () => void = () => {};

async function open(page: Page, isolated: boolean) {
  released = false;
  await page.context().route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const iso: Record<string, string> = isolated
      ? { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' }
      : {};
    if (path === '/w.js') {
      return route.fulfill({ headers: { 'content-type': 'text/javascript', ...iso }, body: WORKER });
    }
    if (path === '/started') {
      started();
      return route.fulfill({ body: 'ok' });
    }
    if (path === '/release') return route.fulfill({ body: released ? 'yes' : 'no' });
    return route.fulfill({ headers: { 'content-type': 'text/html', ...iso }, body: PAGE_HTML });
  });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto(`${ORIGIN}/`);
}

/** Два кадра: значение таймлайна прокрутки обновляется на кадре, а не в момент `scrollTo`. */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function opacities(page: Page, y: 'top' | 'middle' | 'bottom') {
  await page.evaluate((where) => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, where === 'top' ? 0 : where === 'middle' ? max / 2 : max);
  }, y);
  await settle(page);
  return page.evaluate(() => {
    const read = (id: string) => Number(getComputedStyle(document.getElementById(id)!).opacity);
    return { tl: read('tl'), tl3s: read('tl3s'), clock: read('clock') };
  });
}

/** Доля строки пикселей на высоте `y`, закрашенная цветом полосы. */
async function filled(png: Buffer, y: number, channel: 'red' | 'blue'): Promise<number> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const hit = channel === 'red' ? r > 200 && g < 60 && b < 60 : b > 200 && r < 60 && g < 60;
    if (hit) count++;
  }
  return count / info.width;
}

function fact(start: string): string {
  const found = SCROLL_TL_FACTS.find((item) => item.t.startsWith(start));
  if (!found) throw new Error(`в SCROLL_TL_FACTS нет карточки «${start}…»: сторож остался без утверждения`);
  return found.d;
}

/**
 * Значение по позиции: 0 → 0.5 → 1, с явной длительностью — то же самое; анимация по часам
 * рядом не шевелится. Обработчиков `scroll` на странице нет ни одного — это проверено
 * протоколом отладчика, а не на слово.
 */
test('opacity идёт 0 → 0.5 → 1 по позиции прокрутки; animation-duration ничего не меняет', async ({
  page,
}) => {
  await open(page, false);

  const cdp = await page.context().newCDPSession(page);
  const { result } = (await cdp.send('Runtime.evaluate', { expression: 'window' })) as {
    result: { objectId: string };
  };
  const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', {
    objectId: result.objectId,
    depth: -1,
  })) as { listeners: { type: string }[] };
  expect(
    listeners.filter((l) => l.type === 'scroll'),
    'на странице есть обработчик scroll — утверждение «ноль обработчиков» ничего не доказывает',
  ).toEqual([]);

  const kind = await page.evaluate(
    () => document.getElementById('tl')!.getAnimations()[0]?.timeline?.constructor.name,
  );
  expect(kind, 'анимация привязана не к таймлайну прокрутки').toBe('ScrollTimeline');

  const top = await opacities(page, 'top');
  const middle = await opacities(page, 'middle');
  const bottom = await opacities(page, 'bottom');

  expect([top.tl, middle.tl, bottom.tl].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.5, 1]);
  expect(
    [top.tl3s, middle.tl3s, bottom.tl3s].map((v) => Math.round(v * 100) / 100),
    'явный animation-duration: 3s изменил значение — тема утверждает обратное',
  ).toEqual([0, 0.5, 1]);
  expect(
    [top.clock, middle.clock, bottom.clock],
    'контроль сломан: анимация по часам сдвинулась от прокрутки',
  ).toEqual([0, 0, 0]);

  // Связь с темой. Код полосы в теме обязан быть тем же механизмом, что проверен здесь, а
  // карточки — называть три положения и безразличие к длительности. Подстроки — смысловые.
  expect(SCROLL_TL_CODE).toContain('animation-timeline: scroll(root block)');
  expect(fact('Значение привязано к позиции')).toContain('`opacity` идёт 0 → 0.5 → 1 строго по позиции');
  expect(fact('`animation-duration` здесь ничего не значит')).toContain(
    'явный `animation-duration: 3s` на результат не влияет',
  );
});


/**
 * Проверка блокировкой. Плавная прокрутка до конца запускается до блокировки; главный поток
 * занят циклом до сигнала теста; кадры композитора (скринкаст) показывают, что полоса на
 * таймлайне доезжает до конца, а полоса на обработчике стоит там, где была. После разблокировки
 * вторая доезжает сама.
 *
 * ⚠️ **Почему плавная прокрутка, а не колесо.** Колесо, посланное протоколом отладчика
 * (`page.mouse.wheel` и сырой `Input.dispatchMouseEvent` одинаково), при занятом главном
 * потоке **не прокручивает**: подтверждение приходит, а страница сдвигается только после конца
 * цикла — проверено в headless shell и в новом headless Chromium 153. Первый кадр после
 * разблокировки при этом показывает полосу на таймлайне уже целиком, а полосу на обработчике —
 * ещё на месте; этот кадр легко принять за «доехала во время блокировки». Плавная прокрутка,
 * начатая до цикла, живёт в композиторе и идёт без главного потока — её и проверяем.
 *
 * ⚠️ **И почему скринкаст, а не `page.screenshot()`.** Снимок тоже ждёт главный поток и
 * возвращается только после цикла — то есть показывает кадр «после», а не «во время».
 * Кадры `Page.startScreencast` приходят и во время цикла (время-анимация по `transform`
 * на них идёт), поэтому опыт читается по ним.
 */
test('главный поток занят — полоса на таймлайне доезжает, полоса на обработчике стоит', async ({
  page,
}) => {
  test.setTimeout(20_000);
  await open(page, true);
  expect(await page.evaluate(() => crossOriginIsolated), 'страница не изолирована — SAB не будет').toBe(
    true,
  );

  const cdp = await page.context().newCDPSession(page);
  const entered = new Promise<void>((resolve) => (started = resolve));
  let isBlocked = false;
  void entered.then(() => (isBlocked = true));

  await page.evaluate(() => {
    const bar = document.getElementById('jsbar')!;
    const max = () => document.documentElement.scrollHeight - innerHeight;
    // Единственный обработчик scroll — у контрольной полосы. У полосы на таймлайне его нет.
    addEventListener('scroll', () => {
      bar.style.transform = `scaleX(${scrollY / max()})`;
    });
    scrollTo(0, max() / 2);
  });
  // Воркер заводится и отвечает заранее: его старт идёт через главный поток, и заведённый
  // в одной задаче с циклом воркер не проснулся бы никогда.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const shared = new SharedArrayBuffer(8);
        const worker = new Worker('/w.js');
        worker.onmessage = () => resolve();
        worker.postMessage(shared);
        (window as unknown as { flag: Int32Array }).flag = new Int32Array(shared);
      }),
  );
  await settle(page);

  /** Кадры композитора: по каждому — доля обеих полос и был ли уже цикл. */
  type Frame = { tl: number; js: number; blocked: boolean };
  const frames: Frame[] = [];
  let wake: () => void = () => {};
  cdp.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
    const blocked = isBlocked && !released;
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    const png = Buffer.from(event.data, 'base64');
    void Promise.all([filled(png, 10, 'red'), filled(png, 50, 'blue')]).then(([tl, js]) => {
      frames.push({ tl, js, blocked });
      wake();
    });
  });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });

  // Страховка от зависания: если кадров нет, тест упадёт, а не повиснет. Исход она не решает.
  let guardFired = false;
  const guard = setTimeout(() => {
    guardFired = true;
    released = true;
    wake();
  }, 10_000);

  try {
    await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const { flag } = window as unknown as { flag: Int32Array };
      scrollTo({ top: max, behavior: 'smooth' });
      // Кадр — чтобы плавная прокрутка ушла в композитор, затем цикл до сигнала теста.
      requestAnimationFrame(() =>
        setTimeout(() => {
          Atomics.store(flag, 0, 1);
          while (Atomics.load(flag, 1) !== 1) {
            /* главный поток занят, пока тест не отпустит */
          }
        }, 0),
      );
    });
    await entered;

    // Ждём кадр, снятый во время цикла, где полоса на таймлайне доехала до конца.
    while (!guardFired && !frames.some((f) => f.blocked && f.tl > 0.99)) {
      await new Promise<void>((resolve) => (wake = resolve));
    }
  } finally {
    clearTimeout(guard);
    released = true;
  }

  const during = frames.filter((f) => f.blocked);
  expect(guardFired, 'во время цикла полоса на таймлайне так и не доехала до конца').toBe(false);
  expect(during.length, 'во время цикла не пришло ни одного кадра').toBeGreaterThan(0);
  expect(
    Math.min(...during.map((f) => f.tl)),
    'полоса на таймлайне была у конца уже к началу цикла — движение во время цикла не показано',
  ).toBeLessThan(0.99);
  expect(
    during.map((f) => Math.round(f.js * 100) / 100),
    'полоса на обработчике сдвинулась во время цикла — главный поток не был занят, опыт ничего не доказывает',
  ).toEqual(during.map(() => 0.5));

  // Контроль при свободном потоке: тот же обработчик после разблокировки доводит свою полосу.
  await settle(page);
  await cdp.send('Page.stopScreencast');
  const after = await page.screenshot();
  expect(await filled(after, 50, 'blue'), 'после разблокировки полоса на обработчике не доехала').toBeCloseTo(
    1,
    1,
  );

  // Связь с темой: карточка утверждает, что полоса доезжает без JS. Подстрока — вывод опыта.
  const card = fact('Проверка блокировкой');
  expect(card, 'карточка перестала утверждать, что полоса доезжает при занятом потоке').toContain(
    'полоса на таймлайне прокрутки доезжает до конца',
  );
  expect(card).toContain('контрольная полоса на обработчике `scroll` стоит на месте');
  // Утверждение про колесо мыши этот стенд опроверг (колесо и скриншот под Playwright ждут
  // главный поток) — оно снято с карточки 2026-09-29 и не должно вернуться.
  expect(card).not.toContain('колесо мыши прокрутило');
});
