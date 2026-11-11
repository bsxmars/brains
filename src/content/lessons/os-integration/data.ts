import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Страница и система: экран, „Поделиться“, значок, оплата».
 *
 * Тема написана 2026-11-03: Wake Lock, Web Share, Badging API и Payment Request — четыре API,
 * которыми страница просит что-то у операционной системы. Условия зависят от API:
 * безопасный контекст, жест пользователя, Permissions Policy для iframe.
 * Web Push здесь не разбирается — у него своя тема (`/platform/web-push/`).
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63, macOS arm64: Chromium 153.0.8010.12 в двух сборках — полный Chromium
 * (`channel: 'chromium'`, «Chrome for Testing») и headless shell (сборка Playwright по
 * умолчанию), Firefox 155.0, WebKit 26.6. Страница — выдуманный источник
 * `http://localhost:5301` через `page.route` (localhost — безопасный контекст), для сравнения
 * `http://os.test` (не безопасный). Каждый пример с выводом и каждая таблица ниже исполняются
 * `tests/e2e/os-integration.spec.ts` — тот же код, что видит читатель. Пробы — `scratchpad/os/`.
 *
 * Что снято пробами (всё — запуском, не по памяти):
 *   — наличие имён: полный Chromium — все четыре API; headless shell — нет `navigator.share`
 *     и `canShare`; Firefox — только `wakeLock`; WebKit — `wakeLock` и `share`, нет `setAppBadge`
 *     и `PaymentRequest`. На `http://os.test` — ни одного имени ни в одном движке, а
 *     `navigator.userActivation` есть везде. Юзер-агент обеих сборок Chromium — `HeadlessChrome/153`;
 *   — Wake Lock: полный Chromium и Firefox дают замок без жеста, WebKit без жеста — `NotAllowedError`,
 *     по клику — замок; headless shell — `NotAllowedError` всегда (`permissions.query` — `prompt`).
 *     `request('system')` — `TypeError` везде. Второй `release()` не бросает, событие одно;
 *   — снятие замка при скрытии вкладки: **Playwright держит страницы видимыми** (новая вкладка,
 *     `bringToFront`, свёрнутое окно, `connectOverCDP` — `visibilityState` остаётся `visible`).
 *     Поэтому снято голым CDP поверх `chromium.launchServer` (Playwright к страницам не
 *     подключается): соседняя вкладка → `release` **раньше** `visibilitychange`; возврат →
 *     `request` без жеста снова даёт замок (Chromium 153, headless и с окном одинаково);
 *   — Web Share: без жеста — `NotAllowedError` (Chromium, WebKit); второй вызов при открытом
 *     меню — `InvalidStateError` (Chromium); `{}` и битый URL — `TypeError`; `canShare` с `.exe` —
 *     `true`, а `share` с ним же по клику — `NotAllowedError` (Chromium). `AbortError` (человек
 *     закрыл меню) в headless не получить: в Chromium меню открывается и ждёт, у WebKit из
 *     Playwright меню нет вовсе — промис выполняется сразу;
 *   — значок: в обычной вкладке `setAppBadge(3)` и `clearAppBadge()` выполняются (`undefined`),
 *     `setAppBadge(-1)` — `TypeError`. Виден ли значок — в headless не проверить: иконки нет;
 *   — оплата: `canMakePayment()` для неизвестного метода — `false`, `show()` — `NotSupportedError`
 *     (полный Chromium); в headless shell службы оплаты нет — `UnknownError`. Сумма `'1,00'`
 *     или `'-1'` и пустой список методов — `TypeError` в конструкторе. Настоящее окно оплаты,
 *     `PaymentResponse` и `complete()` на стенде недостижимы: платёжных приложений нет;
 *   — жест: окно `isActive` после клика — 5032–5051 мс во всех трёх движках; `share()` гасит его
 *     сразу (Chromium, WebKit); `share()` через 6 с после клика — `NotAllowedError`.
 *     ⚠️ `page.evaluate` в Playwright сам считается жестом: `isActive` внутри него — `true`;
 *   — iframe: чужой без `allow` — Wake Lock `NotAllowedError` (все три), `share` —
 *     `NotAllowedError` (Chromium, WebKit), `new PaymentRequest` — `SecurityError` (Chromium);
 *     с `allow="screen-wake-lock; web-share; payment"` — работает. Заголовок
 *     `Permissions-Policy: screen-wake-lock=()` соблюдает только Chromium; Firefox и WebKit
 *     его не читают и дают замок;
 *   — `matchMedia('(display-mode: standalone)')` во вкладке — `false`, `browser` — `true`.
 */

/** Как печатать снятый исход в таблицах: `ok` — словом, имя ошибки — кодом. */
export function outcome(v: string): string {
  const words: Record<string, string> = { ok: 'выполнен', pending: 'меню открыто', 'no api': 'нет API' };
  return words[v] ?? `\`${v}\``;
}

export const has = (v: boolean): string => (v ? 'есть' : 'нет');

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'безопасный контекст',
    d: 'Страница, открытая по `https:`, или с `localhost` и `127.0.0.1`. Проверяется флажком `isSecureContext`. Вне безопасного контекста эти API не доступны; PaymentRequest находится в window, остальные — в navigator. Обычный удалённый HTTP-источник и localhost — разные случаи.',
  },
  {
    k: 'жест пользователя',
    d: 'Короткое окно после настоящего действия человека: клика, нажатия клавиши, касания. В спецификации HTML это называется transient activation — временная активация. Наличие активации проверяется в момент вызова. Сам таймер её не создаёт; короткий таймер после клика может выполниться до её истечения.',
  },
  {
    k: 'Permissions Policy',
    d: 'Правила, какие возможности браузера разрешены странице и встроенным в неё iframe. Для iframe — атрибут `allow`, для всей страницы — заголовок ответа `Permissions-Policy`.',
  },
  {
    k: 'замок',
    d: 'Объект `WakeLockSentinel`, который возвращает `navigator.wakeLock.request`. Пока замок не отпущен, система не гасит экран.',
  },
  {
    k: 'установленное приложение',
    d: 'Сайт, который пользователь добавил на рабочий стол или экран «Домой», и он открывается своим окном без адресной строки. Как такое приложение называется и выглядит, описывает файл-манифест. Ещё его называют PWA.',
  },
  {
    k: 'платёжное приложение',
    d: 'То, что принимает оплату от имени браузера: Google Pay, Apple Pay, приложение банка. Если у пользователя ни одного такого нет, окну оплаты нечего показать.',
  },
];

export const PLAIN_SYSTEM =
  'Как разные возможности приложения на телефоне: экран можно попросить не гасить, ссылку — передать через системное меню, а непрочитанные сообщения — отметить числом на иконке. Для браузера это разные API с разными условиями доступа. Наличие метода ещё не обещает, что система выполнит просьбу или покажет человеку заметный результат.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Источник страницы',
    d: 'Протокол, домен и порт вместе. От протокола зависит, безопасный ли контекст: на `http:` браузер прячет почти всё, что касается системы.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
  {
    t: 'Отказ промиса и имя ошибки',
    d: 'Все четыре API отвечают промисом. Отказ ловят `try`/`catch` вокруг `await`, а различают по `err.name`: `NotAllowedError`, `TypeError`, `AbortError`.',
    href: '/js/errors/#s1',
    hrefLabel: '«Ошибки и стеки», раздел «Что лежит в объекте ошибки»',
    tone: 'info',
  },
  {
    t: 'Видимость вкладки',
    d: 'Ушли на соседнюю вкладку или свернули окно — `document.visibilityState` становится `hidden`, и приходит событие `visibilitychange`.',
    href: '/js/task-scheduling/#s4',
    hrefLabel: '«Планирование задач», раздел «Фоновая вкладка, заморозка и bfcache»',
    tone: 'info',
  },
];

// ─── Раздел 1. Wake Lock ───────────────────────────────────────────────────────────────────

/** Тест кладёт код в страницу с `<button id="awake">`, кликает дважды и сверяет консоль с `WAKE_OUT`. */
export const WAKE_CODE = `// <button id="awake">Не гасить экран</button>
const button = document.querySelector('#awake');
let lock = null;
let busy = false;

button.addEventListener('click', async () => {
  if (!navigator.wakeLock) { console.log('нет Wake Lock'); return; }
  if (busy) return;
  busy = true;
  try {
    if (lock && !lock.released) {
      await lock.release();
      return;
    }
    lock = await navigator.wakeLock.request('screen');
    console.log('держим:', lock.type, lock.released);
    lock.addEventListener('release', () => console.log('отпустили, released =', lock.released));
  } catch (err) {
    console.log('отказ:', err.name);
  } finally { busy = false; }
});`;

export const WAKE_OUT = `держим: screen false
отпустили, released = true`;

export const WAKE_NOTE =
  'Первый клик берёт замок, второй отпускает. `request` принимает одно значение — `\'screen\'`; любое другое бросает `TypeError`. Повторный `release()` у отпущенного замка не бросает и второго события `release` не даёт. Отпущенный замок снова не включить: в следующий раз нужен новый `request`, и он вернёт новый объект.';

/**
 * Что отвечает `request('screen')` в разных условиях. Столбец `got` — то, что сверяет тест:
 * `ok` — замок выдан, иначе имя ошибки.
 */
export const WAKE_ROWS: { k: string; got: string; v: string }[] = [
  {
    k: 'полный Chromium, Firefox',
    got: 'ok',
    v: 'Замок выдают и по клику, и без него — например, сразу при загрузке.',
  },
  {
    k: 'WebKit',
    got: 'NotAllowedError',
    v: 'Без жеста — `NotAllowedError`. По клику — замок.',
  },
  {
    k: 'headless shell Chromium',
    got: 'NotAllowedError',
    v: '`NotAllowedError` всегда, и по клику тоже. `navigator.permissions.query({ name: \'screen-wake-lock\' })` отвечает `prompt`: разрешение нужно спросить у человека, а показать вопрос в сборке без окна негде.',
  },
  {
    k: 'страница на `http:` (обычный удалённый источник, не localhost)',
    got: 'no api',
    v: '`navigator.wakeLock` нет вовсе, и вызов падает раньше промиса: `TypeError` о чтении `request` у `undefined`.',
  },
];

export const WAKE_REFUSE_NOTE =
  'Спецификация разрешает системе отказать и по своим причинам — например, в режиме экономии батареи. Поэтому к отказу готовятся заранее, как к обычному случаю: кнопка показывает «не получилось», и страница работает дальше.';

export const PLAIN_WAKE =
  'Замок — табличка «не выключать» на выключателе. Табличка висит, пока вы в комнате. Вышли — табличку снимают, даже если вы забыли это сделать. Вернулись — вешайте новую.';

/** Тест: голый CDP поверх `chromium.launchServer`, клик с жестом, соседняя вкладка, возврат. */
export const VIS_CODE = `// <button id="awake">Не гасить экран</button>
let wanted = false;          // намерение человека сохраняется и без действующего замка
let lock = null;
let pending = false;

async function keepAwake() {
  wanted = true;
  if (!navigator.wakeLock) { console.log('нет Wake Lock'); return; }
  if (pending || (lock && !lock.released) || document.visibilityState !== 'visible') return;
  pending = true;
  try {
    const next = await navigator.wakeLock.request('screen');
    if (!wanted || document.visibilityState !== 'visible') {
      await next.release();
      return;
    }
    lock = next;
    next.addEventListener('release', () => {
      if (lock === next) lock = null;
      console.log('снят, вкладка', document.visibilityState);
    }, { once: true });
    console.log('взят');
  } catch (error) {
    console.log('отказ:', error.name);       // показать возможность повторить по кнопке
  } finally { pending = false; }
}

document.querySelector('#awake').addEventListener('click', keepAwake);
document.addEventListener('visibilitychange', () => {
  console.log('вкладка', document.visibilityState);
  if (wanted && document.visibilityState === 'visible') void keepAwake();
});`;

export const VIS_OUT = `взят
снят, вкладка hidden
вкладка hidden
вкладка visible
взят`;

export const WAKE_LIFETIME_DIAGRAM: ConceptDiagramData = {
  id: 'os-integration-wake-intent-and-lock',
  title: 'Намерение не гасить экран сохраняется дольше одного замка',
  description: 'Флаг wanted запоминает выбор человека. Объект WakeLockSentinel действует только пока браузер его не отпустил. При возврате видимой страницы код запрашивает новый объект, если он ещё нужен.',
  width: 920, height: 490,
  nodes: [
    { id: 'wanted', x: 20, y: 20, width: 250, height: 170, label: 'Человек нажал кнопку', detail: '`wanted = true`\nЭто намерение, а не выданный замок.', tone: 'neutral' },
    { id: 'request', x: 335, y: 20, width: 250, height: 170, label: '`request("screen")`', detail: 'Не запускать второй запрос, пока первый не завершён.', tone: 'info' },
    { id: 'active', x: 650, y: 20, width: 250, height: 170, label: 'Замок выдан', detail: 'Сохранить новый sentinel и слушать его release.', tone: 'ok' },
    { id: 'released', x: 650, y: 300, width: 250, height: 170, label: 'Браузер отпустил замок', detail: 'Например, вкладка скрыта. Старый объект повторно не включается.', tone: 'warn' },
    { id: 'visible', x: 335, y: 300, width: 250, height: 170, label: 'Вкладка снова видна', detail: 'Если wanted всё ещё true, запросить новый замок.', tone: 'info' },
  ],
  edges: [
    { from: 'wanted', to: 'request' }, { from: 'request', to: 'active' },
    { from: 'active', to: 'released', fromSide: 'bottom', toSide: 'top' },
    { from: 'released', to: 'visible', fromSide: 'left', toSide: 'right' },
    { from: 'visible', to: 'request', fromSide: 'top', toSide: 'bottom' },
  ],
  note: 'Показан путь успешного запроса. Отказ тоже обычный исход: намерение сохраняется, но действующего замка нет. При позднем ответе уже скрытой странице полученный замок сразу отпускается.',
};

export const VIS_NOTE =
  'Человек нажал кнопку, потом ушёл на соседнюю вкладку и вернулся. Как только вкладку спрятали, браузер сам отпустил замок, и событие `release` пришло **раньше** `visibilitychange`. Так задумано: скрытой странице экран не нужен, а забытая фоновая вкладка иначе держала бы экран включённым часами. Сам браузер замок не вернёт, это делает страница: флажок `wanted` помнит, что человек просил, а обработчик `visibilitychange` берёт новый замок, когда вкладка снова видна. В Chromium повторный `request` проходит без нового клика.';

export const VIS_WEBKIT_NOTE =
  'В WebKit этот же возврат упирается в жест: `visibilitychange` — не действие человека, и `request` без клика там отвергается с `NotAllowedError`. Надёжный вариант для всех движков — поймать отказ и снова показать кнопку «Не гасить экран».';

// ─── Раздел 2. Web Share ───────────────────────────────────────────────────────────────────

/** Тест: полный Chromium, два клика по `#share` подряд, консоль сверяется с `SHARE_OUT`. */
export const SHARE_CODE = `// <button id="share">Поделиться</button>
const data = {
  title: 'Рецепт борща',
  text: 'Тот самый, со свёклой в конце',
  url: location.href,
};
async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    console.log('ссылка скопирована');
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = url;
    document.body.append(link);              // остаётся ссылка для ручного копирования
    console.log('скопируйте ссылку на странице');
  }
}

document.querySelector('#share').addEventListener('click', async () => {
  if (typeof navigator.share !== 'function' ||
      (navigator.canShare && !navigator.canShare(data))) return copyLink(data.url);
  try {
    await navigator.share(data);
    console.log('выбрали, куда отправить');
  } catch (err) {
    if (err.name === 'AbortError') console.log('меню закрыли');
    else console.log('отказ:', err.name);
  }
});`;

export const SHARE_OUT = `// клик 1: открылось системное меню, промис ждёт выбора
// клик 2, пока меню открыто:
отказ: InvalidStateError`;

export const SHARE_NOTE =
  'Страница отдаёт заголовок, текст, ссылку или файлы, а куда они уйдут — в мессенджер, почту, заметки, — выбирает человек. Странице не сообщают, что именно он выбрал. Промис выполняется, когда цель выбрана, а не когда сообщение доставлено. Закрыл меню — отказ с `AbortError`. Одновременно открыто только одно меню: второй вызов, пока первое ждёт, получает `InvalidStateError`.';

export const SHARE_FALLBACK_NOTE =
  'Ветка с `copyLink` нужна на практике. В Firefox 155 на macOS `navigator.share` нет вовсе, и без запасного пути кнопка там просто ничего не делает. `canShare?.()` с вопросительным знаком не падает, когда метода нет: выражение даёт `undefined`, и срабатывает запасной путь.';

/**
 * Что отвечают `share` и `canShare` в полном Chromium и WebKit. Строки «по клику» тест вызывает
 * из обработчика настоящего клика: без жеста Chromium на `{}` отвечает `NotAllowedError`, а не `TypeError`. `chromium`/`webkit` — то, что
 * сверяет тест: `ok`, `true`/`false` или имя ошибки.
 */
export const SHARE_ROWS: { k: string; chromium: string; webkit: string }[] = [
  { k: '`share({ url })` без клика', chromium: 'NotAllowedError', webkit: 'NotAllowedError' },
  { k: '`share({})` по клику', chromium: 'TypeError', webkit: 'TypeError' },
  { k: '`share({ url: \'http://[\' })` по клику', chromium: 'TypeError', webkit: 'TypeError' },
  { k: '`canShare({ url })`', chromium: 'true', webkit: 'true' },
  { k: '`canShare({ title })`', chromium: 'true', webkit: 'true' },
  { k: '`canShare({})`', chromium: 'false', webkit: 'false' },
  { k: '`canShare({ url: \'http://[\' })`', chromium: 'false', webkit: 'false' },
];

export const SHARE_TABLE_NOTE =
  '`canShare` проверяет форму данных: есть ли хоть одно поле и разбирается ли ссылка. Пустой объект и битый URL он отсекает заранее — там, где `share` по клику бросил бы `TypeError`. Без клика Chromium на те же данные отвечает `NotAllowedError`: жест он проверяет раньше, чем данные. Файлы передают полем `files` — массивом `File`. Перед этим спрашивают `canShare({ files })`: не каждая система принимает файлы.';

export const SHARE_TARGET_NOTE =
  'Обратная задача — чтобы ваше приложение появилось в чужом меню «Поделиться» — решается полем `share_target` в манифесте (Web Share Target). Это работает только у установленного приложения и не во всех системах.';

// ─── Раздел 3. Значок ──────────────────────────────────────────────────────────────────────

/** Модульный скрипт: тест исполняет его в headless shell Chromium и сверяет консоль с `BADGE_OUT`. */
export const BADGE_CODE = `async function showUnread(count) {
  if (!('setAppBadge' in navigator)) return;      // Firefox, WebKit
  if (count > 0) await navigator.setAppBadge(count);
  else await navigator.clearAppBadge();
  console.log('значок:', count);
}

if ('setAppBadge' in navigator) {
  await showUnread(3);
  await showUnread(0);
  await navigator.setAppBadge(-1).catch((err) => console.log('отказ:', err.name));
}`;

export const BADGE_OUT = `значок: 3
значок: 0
отказ: TypeError`;

export const BADGE_NOTE =
  'Почтовое приложение пишет на своей иконке число непрочитанных. `setAppBadge(n)` делает то же для веб-приложения, `clearAppBadge()` значок убирает. По спецификации `setAppBadge(0)` тоже убирает значок, а вызов без числа, `setAppBadge()`, просит отметку без цифры. Число — целое и не меньше нуля: `-1` даёт `TypeError`. Жест для значка не нужен.';

export const BADGE_TAB_NOTE =
  'В обычной вкладке промис **выполняется**, и ничего не происходит: у вкладки нет своей иконки, рисовать значок не на чем. Значок виден только у установленного приложения: по документации браузеров — в доке macOS, на панели задач Windows, на экране «Домой». Выполненный промис не значит, что человек что-то увидел. Проверить, что страница открыта как приложение, можно запросом `matchMedia(\'(display-mode: standalone)\').matches`: во вкладке он даёт `false`.';

export const BADGE_PUSH_NOTE =
  'Значок обычно меняется, когда страница закрыта: пришло письмо, а вкладки нет. Это работа Service Worker, который просыпается на сообщение с сервера, — как это устроено, разобрано в [«Web Push», раздел «Service Worker: событие push»](/platform/web-push/#s6).';

// ─── Раздел 4. Оплата ──────────────────────────────────────────────────────────────────────

/**
 * Модульный скрипт (верхнеуровневый `await`). Тест закрывает `https://pay.example/**` ответом 404 —
 * платёжного приложения на стенде нет — и сверяет консоль полного Chromium с `PAY_OUT`.
 */
export const PAY_CODE = `// <button id="pay">Оплатить</button>
const methods = [{ supportedMethods: 'https://pay.example/', data: { merchantId: 'shop-42' } }];
const details = { total: { label: 'Итого', amount: { currency: 'RUB', value: '990.00' } } };
async function sendToServer(data) {
  const response = await fetch('/pay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const result = await response.json();
  return result.paid === true;             // статус подтверждает сервер через провайдера
}

const canPay = typeof PaymentRequest === 'function'
  ? await new PaymentRequest(methods, details).canMakePayment().catch(() => false)
  : false;                                    // и это может отказать
console.log('есть чем платить:', canPay);

document.querySelector('#pay').addEventListener('click', async () => {
  if (typeof PaymentRequest !== 'function') { console.log('нет Payment Request'); return; }
  const request = new PaymentRequest(methods, details);
  let response;
  try {
    response = await request.show();
  } catch (error) {
    console.log('оплата не началась:', error.name);
    return;
  }

  let paid = false;
  try {
    paid = await sendToServer(response.details);
  } catch (error) {
    console.log('подтверждение не получено:', error.name);
  } finally {
    await response.complete(paid ? 'success' : 'fail')
      .catch((error) => console.log('complete:', error.name));
  }
});`;

export const PAY_OUT = `есть чем платить: false
оплата не началась: NotSupportedError`;

export const PAY_FLOW = [
  '**`new PaymentRequest(methods, details)`** — что продаём и чем можно платить. Способ оплаты — адрес платёжного приложения, например `\'https://google.com/pay\'`. Сумма — строкой: `\'990.00\'`; `\'1,00\'`, `\'-1\'` и пустой список способов бросают `TypeError` прямо в конструкторе.',
  '**`canMakePayment()`** — может ли браузер обработать хотя бы один из перечисленных методов. Это не подтверждение доступной карты, баланса или успешной оплаты.',
  '**`show()`** — открыть окно оплаты. Только по жесту и только один раз на объект: второй `show()` у того же запроса даёт `InvalidStateError`, поэтому запрос создают заново на каждый клик.',
  '**`response.details`** — то, что вернуло платёжное приложение: обычно токен, а не номер карты. Его отправляют на сервер, а сервер — платёжному провайдеру.',
  '**`response.complete(\'success\')`** — закрыть окно и показать итог. Пока `complete` не вызван, окно ждёт ответа сервера.',
];

export const PAY_STAND_NOTE =
  'В нашей проверке платёжных приложений нет, поэтому окно не открылось: `canMakePayment()` ответил `false`, а `show()` отвергнут с `NotSupportedError`. В headless shell Chromium нет и самой службы оплаты: там отказывают и `canMakePayment()`, и `show()` — с `UnknownError`. Поэтому у `canMakePayment()` свой `catch`: без него отказ остановил бы весь модуль, и кнопка не получила бы обработчика. Шаги после `show()` выше описаны по спецификации: дойти до них без платёжного приложения нельзя.';

export const PLAIN_PAY =
  'PaymentRequest похож на форму выбора способа оплаты, а не на учётную систему магазина. Браузер организует обмен с платёжным приложением, а ответ обрабатывает сервер через провайдера. complete сообщает браузеру, что взаимодействие завершено. Само это сообщение не списывает и не возвращает деньги.';

export const PAY_REALITY =
  'Поэтому в магазинах обычно стоит не голый `PaymentRequest`, а кнопка или форма платёжного провайдера. Списание, проверку 3-D Secure, возвраты и чеки делает он, а его библиотека сама решает, чем открыть окно: Apple Pay, Google Pay или своей формой карты. PaymentRequest используют в согласованной с провайдером интеграции. Успешная проверка наличия API не заменяет запасной способ оплаты.';

// ─── Раздел 5. Жест, безопасный контекст, iframe ──────────────────────────────────────────

/** Тест кликает по `#probe` в трёх движках и сверяет консоль с `ACTIVATION_OUT`. */
export const ACTIVATION_CODE = `// <button id="probe">Нажми</button>
document.querySelector('#probe').addEventListener('click', () => {
  const start = performance.now();
  const timer = setInterval(() => {
    if (navigator.userActivation.isActive) return;
    clearInterval(timer);
    const sec = Math.round((performance.now() - start) / 1000);
    console.log('окно жеста закрылось через', sec, 'с; hasBeenActive =',
      navigator.userActivation.hasBeenActive);
  }, 50);
});`;

export const ACTIVATION_OUT = 'окно жеста закрылось через 5 с; hasBeenActive = true';

export const ACTIVATION_NOTE =
  '`navigator.userActivation` показывает два флажка. `isActive` — открыто ли окно жеста прямо сейчас: на стенде после клика оно держалось около пяти секунд. Это результат указанных сборок, а не гарантированный срок для любого браузера. `hasBeenActive` — был ли хоть один жест с загрузки страницы; он не гаснет. По спецификации HTML жестом считаются нажатие клавиши, нажатие кнопки мыши и касание; прокрутка и движение мыши — нет.';

export const PLAIN_ACTIVATION =
  'Временная активация похожа на пропуск с коротким сроком: настоящий клик даёт его странице, а истечение срока лишает этого права. Некоторые API, например share, потребляют пропуск уже при вызове. Не все возможности темы требуют или потребляют его одинаково; поэтому проверяют правила конкретного API.';

/** Тест: полный Chromium и WebKit, клик по `#share`, консоль сверяется с `CONSUME_OUT`. */
export const CONSUME_CODE = `document.querySelector('#share').addEventListener('click', () => {
  console.log('до share:', navigator.userActivation.isActive);
  const shared = navigator.share({ url: location.href });
  console.log('после share:', navigator.userActivation.isActive);
  shared.catch(() => {});
});`;

export const CONSUME_OUT = `до share: true
после share: false`;

export const CONSUME_NOTE =
  '`share()` забирает жест сразу, в момент вызова. Второе меню из того же клика не откроется: нужен новый клик. Оплата также использует активацию. Значок и Wake Lock в Chromium обходятся без неё — одинаковое требование ко всем четырём API неверно.';

/** Без жеста, сразу при загрузке. Значения сверяет тест: `ok`, имя ошибки или `no api`. */
export const GESTURE_ROWS: { k: string; chromium: string; firefox: string; webkit: string }[] = [
  { k: '`wakeLock.request(\'screen\')`', chromium: 'ok', firefox: 'ok', webkit: 'NotAllowedError' },
  { k: '`share({ url })`', chromium: 'NotAllowedError', firefox: 'no api', webkit: 'NotAllowedError' },
  { k: '`setAppBadge(3)`', chromium: 'ok', firefox: 'no api', webkit: 'no api' },
];

/** Чужой iframe (другой источник) без `allow` и с ним. Значения сверяет тест. */
export const IFRAME_ROWS: {
  k: string;
  feature: string;
  without: { chromium: string; firefox: string; webkit: string };
  with: { chromium: string; firefox: string; webkit: string };
}[] = [
  {
    k: 'Wake Lock',
    feature: 'screen-wake-lock',
    without: { chromium: 'NotAllowedError', firefox: 'NotAllowedError', webkit: 'NotAllowedError' },
    // WebKit с `allow` пропускает, но без жеста отвечает тем же `NotAllowedError` — см. GESTURE_ROWS.
    with: { chromium: 'ok', firefox: 'ok', webkit: 'NotAllowedError' },
  },
  {
    k: '«Поделиться» по клику',
    feature: 'web-share',
    without: { chromium: 'NotAllowedError', firefox: 'no api', webkit: 'NotAllowedError' },
    with: { chromium: 'pending', firefox: 'no api', webkit: 'ok' },
  },
  {
    k: '`new PaymentRequest`',
    feature: 'payment',
    without: { chromium: 'SecurityError', firefox: 'no api', webkit: 'no api' },
    with: { chromium: 'ok', firefox: 'no api', webkit: 'no api' },
  },
];

export const IFRAME_CODE = `<!-- виджет оплаты с другого сайта: просить окно оплаты и не гасить экран ему можно -->
<iframe src="https://widget.example/checkout"
        allow="payment; screen-wake-lock; web-share"></iframe>`;

export const IFRAME_NOTE =
  'Iframe с другого источника по умолчанию не получает ни одной из трёх возможностей: Wake Lock и `share` отвечают `NotAllowedError`, а `new PaymentRequest` бросает `SecurityError` ещё в конструкторе. Атрибут `allow` разрешает их поимённо. Iframe с того же источника, что и страница, получает их без атрибута. Замок в WebKit и с `allow` требует клика — как и на самой странице. В обратную сторону работает заголовок ответа `Permissions-Policy: screen-wake-lock=(), payment=()`: он запрещает возможности и самой странице, и всем её iframe. Зачем ставить такой заголовок всем сайтам — в [«Безопасности фронтенда», раздел «CSRF и кликджекинг»](/platform/security/#s5).';

export const HEADER_ENGINE_NOTE =
  'Заголовок `Permissions-Policy` соблюдает только Chromium. Firefox 155 и WebKit 26.6 его не читают: со `screen-wake-lock=()` в ответе они всё равно выдают замок. Атрибут `allow` у iframe понимают все три.';

// ─── Раздел 6. Есть ли API ────────────────────────────────────────────────────────────────

/** Тест исполняет код в четырёх сборках на `http://localhost` и `http://os.test` и сверяет `SUPPORT_ROWS`. */
export const DETECT_CODE = `const can = {
  wakeLock: 'wakeLock' in navigator,
  share: 'share' in navigator,
  badge: 'setAppBadge' in navigator,
  payment: 'PaymentRequest' in window,
};
console.log(isSecureContext, can);`;

/** Наличие имени в безопасном контексте. На `http://os.test` все `false` во всех сборках. */
export const SUPPORT_ROWS: { k: string; key: 'wakeLock' | 'share' | 'badge' | 'payment'; full: boolean; shell: boolean; firefox: boolean; webkit: boolean }[] = [
  { k: '`navigator.wakeLock`', key: 'wakeLock', full: true, shell: true, firefox: true, webkit: true },
  { k: '`navigator.share`', key: 'share', full: true, shell: false, firefox: false, webkit: true },
  { k: '`navigator.setAppBadge`', key: 'badge', full: true, shell: true, firefox: false, webkit: false },
  { k: '`PaymentRequest`', key: 'payment', full: true, shell: true, firefox: false, webkit: false },
];

export const SUPPORT_NOTE =
  'Сборки Playwright на macOS, ноябрь 2026. На `http:` — не `localhost`, а настоящем домене — ни одного из четырёх имён нет ни в одном движке, хотя `navigator.userActivation` есть везде. Поэтому `\'share\' in navigator` — одновременно проверка и движка, и протокола.';

export const UA_NOTE =
  'Полный Chromium и headless shell — одна версия, 153, и у обоих в юзер-агенте `HeadlessChrome/153`. Но у первого `navigator.share` есть, а у второго нет. WebKit из Playwright представляется как `Safari`, а `PaymentRequest`, который в Safari есть, у него отсутствует. По строке юзер-агента не угадать даже версию сборки, не то что набор возможностей. Проверяйте то, чем собираетесь пользоваться: имя в `navigator` или `window`.';

export const INSTALL_NOTE =
  'Часть возможностей зависит не от браузера, а от того, установлен ли сайт как приложение. Значок виден только у установленного. Поле `share_target` работает только у установленного. На iPhone даже push-уведомления доступны только сайту с экрана «Домой» — подробно в [«Web Push», раздел «Где push не дойдёт»](/platform/web-push/#s7). Установить сайт можно, если он отдаёт манифест: файл, где записаны имя, иконки и вид окна.';

export const MANIFEST_LINK_CODE = `<link rel="manifest" href="/app.webmanifest">`;
export const MANIFEST_CODE = `{
  "name": "Рецепты",
  "start_url": "/",
  "display": "standalone",
  "icons": [{ "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }]
}`;

export const INSTALL_SW_NOTE =
  'Работу без сети установленному приложению даёт не манифест, а Service Worker — [«Service Worker изнутри»](/render/service-worker/).';

export const CLOSING =
  'Проверяйте конкретную возможность в navigator или window. Действие, которому нужна временная активация, вызывайте сразу из обработчика пользовательского ввода. Ловите отказ и различайте его по `err.name`. И держите запасной путь: показать ссылку для копирования вместо недоступного меню «Поделиться», снова показать кнопку «Не гасить экран», открыть форму карты вместо окна оплаты.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

/** Код из тонкого места 02 исполняет тест: полный Chromium, `share` через 6 с после клика. */
export const LATE_SHARE_CODE = `button.addEventListener('click', async () => {
  const url = await makeShortLink();    // запрос к серверу, 6 секунд
  await navigator.share({ url });       // NotAllowedError: окно жеста уже закрылось
});`;

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'В Playwright `page.evaluate` — уже жест, а вкладка всегда видна',
    d: 'Код внутри `page.evaluate` получает `isActive === true`, будто человек только что кликнул. Поэтому тест «без жеста» через `evaluate` проходит там, где у пользователя будет `NotAllowedError`. Вкладки Playwright держит видимыми: соседняя вкладка, `bringToFront` и свёрнутое окно оставляют `visibilityState === \'visible\'`, и снятие замка так не проверить. Код «без жеста» кладут в саму страницу, жест дают настоящим `page.click`, а скрытие вкладки проверяют через голый CDP.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Долгий `await` перед `share` съедает жест',
    code: LATE_SHARE_CODE,
    d: 'Окно жеста — около пяти секунд с клика, и `await` его не продлевает. Если перед `share` или `show` страница ждёт сервер, к моменту вызова окно уже закрыто: в нашей проверке `share` через шесть секунд после клика дал `NotAllowedError`. Данные готовят заранее, до клика, а в обработчике остаётся сам вызов.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`canShare` ответил `true`, а `share` отказал',
    d: '`canShare` проверяет форму данных, а не то, что примет система. В Chromium `canShare({ files: [файл .exe] })` даёт `true`, а `share` с тем же файлом по клику — `NotAllowedError`. Поэтому `catch` у `share` нужен и после успешного `canShare`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Значок «поставился», но его никто не видит',
    d: 'В обычной вкладке `setAppBadge` выполняется без ошибки и без видимого результата. Отличить вкладку от установленного приложения по промису нельзя — только по `matchMedia(\'(display-mode: standalone)\')`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'В WebKit замок не вернуть без клика',
    d: 'Возврат замка на `visibilitychange` в Chromium и Firefox проходит, а WebKit без жеста отвечает `NotAllowedError`. Обработчик возврата обязан ловить отказ и снова показывать кнопку.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Headless shell — не Chrome',
    d: 'Chromium, который Playwright запускает по умолчанию, — урезанная сборка headless shell. В ней нет `navigator.share`, служба оплаты не отвечает (`UnknownError`), а Wake Lock всегда даёт `NotAllowedError`. Тест на этой сборке скажет «не поддерживается» о том, что у пользователей Chrome работает. Для таких проверок нужен полный Chromium: `channel: \'chromium\'`.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'W3C — Screen Wake Lock API',
    href: 'https://www.w3.org/TR/screen-wake-lock/',
    what: '`request`, `WakeLockSentinel`, снятие замка при скрытии документа, право системы отказать',
  },
  {
    title: 'W3C — Web Share API',
    href: 'https://www.w3.org/TR/web-share/',
    what: '`share` и `canShare`, жест, `AbortError` и `InvalidStateError`, политика `web-share`',
  },
  {
    title: 'W3C — Badging API',
    href: 'https://www.w3.org/TR/badging/',
    what: '`setAppBadge`, `clearAppBadge`, отметка без числа, где значок показывается',
  },
  {
    title: 'W3C — Payment Request API',
    href: 'https://www.w3.org/TR/payment-request/',
    what: 'конструктор, `canMakePayment`, `show` по жесту, `PaymentResponse.complete`, политика `payment`',
  },
  {
    title: 'HTML Standard — User activation',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation',
    what: 'временная и «липкая» активация, какие события их дают, `navigator.userActivation`',
  },
  {
    title: 'W3C — Permissions Policy',
    href: 'https://www.w3.org/TR/permissions-policy/',
    what: 'атрибут `allow`, заголовок `Permissions-Policy`, умолчание `self` для iframe',
  },
  {
    title: 'W3C — Web Application Manifest',
    href: 'https://www.w3.org/TR/appmanifest/',
    what: 'поля манифеста, `display`, медиазапрос `display-mode`',
  },
  {
    title: 'MDN — Web Share Target API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target',
    what: 'поле `share_target` и где оно поддерживается',
  },
];

export const RELATED =
  'Смежное на сайте: [Web Push](/platform/web-push/) — уведомления и Service Worker, который меняет значок при закрытой странице. [Service Worker изнутри](/render/service-worker/) — работа установленного приложения без сети. [Безопасность фронтенда, раздел «CSRF и кликджекинг»](/platform/security/#s5) — заголовок `Permissions-Policy` среди обязательных. [Встроенный контент без сторонних кук, раздел «Storage Access API»](/platform/third-party-cookies/#s5) — ещё один API, который ждёт жеста в iframe. [Планирование задач, раздел «Фоновая вкладка, заморозка и bfcache»](/js/task-scheduling/#s4) — что ещё происходит со скрытой вкладкой. [Passkeys и WebAuthn](/platform/passkeys/) — вход через систему, тоже только в безопасном контексте. [Доступ к железу](/js/device-hardware/) — устройства по выбору пользователя. [Буфер обмена и перетаскивание](/js/clipboard-dnd/) — ещё одно место, где нужен жест пользователя.';
