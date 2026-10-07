import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { TxScenario, TxStep } from '@/widgets/tx-lab/model/types';

/**
 * Данные темы «Хранилища браузера: от localStorage до OPFS».
 *
 * Тема написана здесь, 2026-10-01. Что уже разобрано в соседних темах, дано ссылкой и не
 * пересказывается: куки, `HttpOnly` и где держать токен — «Безопасность фронтенда» (раздел «Куки
 * и JWT для фронта») и «Аутентификация» (раздел «Где держать вход»); разделение хранилища
 * по сайту верхнего уровня и Storage Access API — «Встроенный контент без сторонних кук»
 * (раздел «Разделённое хранилище»); Service Worker и стратегии кеша — «Сеть» (раздел «Service
 * Worker», там же карточки про `estimate()` и `persist()` по документации — здесь они сняты
 * стендом); микрозадачи — «Event loop» (раздел «Checkpoint»).
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0, Chromium 153.0.8010.12 (Playwright 1.63.0), fake-indexeddb 6.2.5, 1 октября 2026.
 * Скрипт стенда — `agent-storage/stand.mjs` в каталоге scratchpad агента, в репозиторий не входит.
 * Сервер — `node:http` на 127.0.0.1:51720 (основной origin `http://localhost:51720`) и :51721
 * (тот же хост, другой порт). Маршруты: `/slow` отвечает через 150 мс, `/opfs-worker.js` отдаёт
 * `OPFS_WORKER_CODE` дословно, `/data/*` — текст с `Cache-Control: max-age=60`, `/404` — 404.
 *
 * Стенд импортировал **этот файл** (копию, снятую до того, как сюда легли литералы) и исполнял
 * строки кода отсюда — те же, что печатает тема. Литералы `STAND` ниже — его вывод без правок.
 *
 *   — Транзакции: каждый из девяти сценариев `TX_SCENARIO_CODE` — пять прогонов через
 *     `TX_HARNESS_CODE` с настоящим `fetch`; все пять дали один журнал (`STAND.tx`). Тексты
 *     ошибок Chromium — `STAND.txMessages` (имя нормативно, текст — нет).
 *   — Версии: две вкладки одного контекста, A исполняет `OLD_TAB_CODE`, B — `NEW_TAB_CODE`;
 *     журналы двух вкладок слиты по `performance.timeOrigin + now()`. Вариант «вкладка не
 *     закрывает базу» — `OLD_TAB_CODE` без строки `POLITE_LINE`; вкладку A затем закрыли
 *     (`page.close()`), через 0,5 с журнал снят ещё раз.
 *   — `INDEX_CODE` — в базе `shop` версии 2, которую оставил вежливый вариант.
 *   — Предел `localStorage`: двоичный поиск длины значения до `QuotaExceededError`
 *     (`STAND.lsLimit`); куки — двоичный поиск длины значения куки `c` и 181 кука подряд.
 *   — События `storage`: четыре вкладки одного контекста (A — автор, B — тот же origin,
 *     C — порт 51721, D — `http://127.0.0.1:51720`), во всех `LISTENER_CODE`, в A — `WRITER_CODE`.
 *   — `sessionStorage`: вкладка B, перезагрузка A, `window.open` из A, `noopener`, ссылка
 *     `target=_blank`, уход A на другой origin и возврат.
 *   — Cache API, OPFS в воркере и в окне — `CACHE_CODE`, `OPFS_WORKER_CODE`, `OPFS_MAIN_CODE`.
 *   — Квота: `ESTIMATE_CODE` и `PERSIST_CODE` в контексте Playwright без профиля
 *     (`browser.newContext()` — профиль «вне записи», как у инкогнито) и в профиле на диске
 *     (`launchPersistentContext`); затем новый контекст без профиля и перезапуск профиля —
 *     что из данных осталось. Диск машины стенда — 239 ГБ, свободно около 21 ГБ.
 *   — Неудачный `setItem` (отдельный прогон `fail-keep.mjs`, тот же Chromium): `STAND.lsLimit.failKeeps`.
 *   — Сжатие IndexedDB: 4 МиБ нулей и 4 МиБ случайных байтов, прирост `usageDetails.indexedDB`.
 *
 * Только по документации, не запускалось: порядок вытеснения (сначала best-effort, по давности
 * использования, origin целиком), правила, по которым Chromium сам выдаёт `persist()`,
 * поведение Firefox и Safari (вопрос пользователю, семидневная очистка в Safari), то, что OPFS
 * не видна в файловой системе пользователя, и что на ней работают SQLite и другие базы в WASM.
 *
 * Пересобирается `tests/unit/browser-storage.test.ts`: `TX_MODEL_CODE` сверяется на всех
 * сценариях с журналом `fake-indexeddb` (через ту же `TX_HARNESS_CODE`) и с `STAND.tx`;
 * `OLD_TAB_CODE` / `NEW_TAB_CODE` / `INDEX_CODE` — исполняются в `fake-indexeddb` и сверяются
 * со `STAND.version` / `STAND.index`; `LS_TYPES_CODE` — в отдельном процессе Node
 * с `--experimental-webstorage`; числа из текста — с литералами стенда. Браузерный прогон
 * тестом не повторяется.
 *
 * ⚠️ Где `fake-indexeddb` и Chromium расходятся (на стенде, вне сценариев темы): `objectStore()`
 * после `await setTimeout` у транзакции с выполненным `put` — Chromium отдаёт хранилище
 * (транзакция ещё не «завершена» для него), `fake-indexeddb` бросает `InvalidStateError`.
 * Поэтому сценарии темы так не делают; модель следует Chromium в тех местах, где оба совпали:
 * `objectStore()` бросает `InvalidStateError` у транзакции, которая уже фиксируется
 * (`commit()` или пустая транзакция после конца задачи).
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'квота',
    d: 'Сколько байт браузер разрешает занять одному сайту. Узнать её можно вызовом `navigator.storage.estimate()`; в неё входят IndexedDB, Cache API и OPFS.',
  },
  {
    k: 'вытеснение',
    d: 'Когда на диске кончается место, браузер сам удаляет данные сайтов — не по записи, а весь сайт разом. По-английски eviction.',
  },
  {
    k: 'best-effort и persistent',
    d: 'Два режима хранилища сайта. Best-effort («по возможности») — по умолчанию: браузер может его вытеснить. Persistent («постоянное») браузер не трогает, удалить его может только пользователь.',
  },
  {
    k: 'объектное хранилище',
    d: 'Таблица внутри базы IndexedDB (object store): записи по ключу. Ключ берётся из поля записи (`keyPath`) или передаётся отдельно.',
  },
  {
    k: 'индекс и курсор',
    d: 'Индекс — второй порядок записей хранилища, по другому полю: по нему ищут без перебора. Курсор — указатель, который проходит записи по одной.',
  },
  {
    k: 'транзакция',
    d: 'Группа запросов к базе, которая применяется целиком или не применяется вовсе. В IndexedDB любое чтение и запись идут внутри транзакции.',
  },
  {
    k: 'OPFS',
    d: 'Origin Private File System — личная файловая система сайта: папки и файлы, которых пользователь не видит и которые не видит никто, кроме этого origin.',
  },
  {
    k: 'разделение по сайту',
    d: 'Хранилище фрейма чужого сайта отделено по сайту верхнего уровня: у `widget.com` внутри `a.com` и внутри `b.com` — два разных хранилища. По-английски storage partitioning.',
  },
];

export const PLAIN_STORAGE =
  'Хранилища браузера похожи на места в квартире. Куки — записка в кармане куртки: маленькая и уходит с вами на каждую встречу с сервером. `localStorage` — стикер на холодильнике: виден всем домашним сразу, но много на нём не напишешь. `sessionStorage` — записка на столе в одной комнате. IndexedDB — шкаф с ящиками и описью. Cache API — полка с готовыми ответами. OPFS — кладовка, куда кладут целые файлы.';

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, разобранные в других темах.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Origin',
    d: 'Источник страницы — протокол, домен и порт вместе. Все хранилища, кроме кук, делятся по origin: `http://localhost:51720` и `http://localhost:51721` друг друга не видят.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
  {
    t: 'Задача и микрозадача',
    d: 'Браузер исполняет код задачами: обработчик клика, таймер, ответ сети. После каждой задачи он выполняет все накопившиеся микрозадачи — продолжения после `await` готового промиса. Транзакция IndexedDB живёт ровно по этой границе.',
    href: '/js/event-loop/#s3',
    hrefLabel: '«Event loop», раздел «Checkpoint»',
    tone: 'info',
  },
  {
    t: 'Воркер',
    d: 'Отдельный поток со своим циклом событий и без DOM. Синхронный доступ к файлам OPFS есть только в нём: там долгая операция не замораживает страницу.',
    href: '/js/workers/#s1',
    hrefLabel: '«Воркеры», раздел «Агент»',
    tone: 'info',
  },
  {
    t: 'Структурное клонирование',
    d: 'Алгоритм, которым браузер копирует объект: `Date`, `Map`, `Blob` и `ArrayBuffer` переживают копию, функции и классы — нет. IndexedDB хранит записи именно так.',
    href: '/js/workers/#s2',
    hrefLabel: '«Воркеры», раздел «Клонирование»',
    tone: 'info',
  },
];

// ─── Код темы: строки, которые печатает CodeBlock, исполняет стенд, демо и тест ─────────────

export const LS_TYPES_CODE = `localStorage.setItem('count', 42);
localStorage.setItem('user', { name: 'Аня' });
localStorage.setItem('token', undefined);
log(typeof localStorage.getItem('count') + ' ' + localStorage.getItem('count'));
log(localStorage.getItem('user'));
log(localStorage.getItem('token'));
log(localStorage.getItem('missing'));
localStorage.setItem('user', JSON.stringify({ name: 'Аня' }));
log(JSON.parse(localStorage.getItem('user')).name);`;

export const LISTENER_CODE = `addEventListener('storage', (e) => {
  if (e.storageArea !== localStorage) return;
  log(e.key + ': ' + e.oldValue + ' → ' + e.newValue);
});`;

export const WRITER_CODE = `localStorage.setItem('theme', 'dark');
localStorage.setItem('theme', 'dark');
localStorage.setItem('theme', 'light');
localStorage.removeItem('theme');
localStorage.removeItem('theme');
localStorage.setItem('cart', '3');
localStorage.clear();
sessionStorage.setItem('draft', 'abc');`;

export const OLD_TAB_CODE = `const open = indexedDB.open('shop', 1);
open.onupgradeneeded = () => {
  open.result.createObjectStore('orders', { keyPath: 'id' });
};
open.onsuccess = () => {
  const db = open.result;
  db.onversionchange = (e) => {
    log('A: versionchange ' + e.oldVersion + ' → ' + e.newVersion);
    db.close();
  };
  log('A: открыта версия ' + db.version);
};`;

export const NEW_TAB_CODE = `const open = indexedDB.open('shop', 2);
open.onblocked = (e) => {
  log('B: blocked ' + e.oldVersion + ' → ' + e.newVersion);
};
open.onupgradeneeded = (e) => {
  log('B: upgradeneeded ' + e.oldVersion + ' → ' + e.newVersion);
  const orders = open.transaction.objectStore('orders');
  orders.createIndex('byStatus', 'status');
};
open.onsuccess = () => {
  log('B: открыта версия ' + open.result.version);
};`;

/** Строка, которую стенд вырезал из `OLD_TAB_CODE` для варианта «вкладка не закрывает базу». */
export const POLITE_LINE = '\n    db.close();';

export const INDEX_CODE = `const tx = db.transaction('orders', 'readwrite');
const orders = tx.objectStore('orders');
orders.put({ id: 1, status: 'new', total: 300 });
orders.put({ id: 2, status: 'paid', total: 1200 });
orders.put({ id: 3, status: 'new', total: 50 });
orders.put({ id: 4, status: 'paid', total: 700 });

const byStatus = orders.index('byStatus');
log('новых: ' + await req(byStatus.count('new')));

const range = await req(orders.getAll(IDBKeyRange.bound(2, 3)));
log('id от 2 до 3: ' + range.map((o) => o.id).join(', '));

const cursor = byStatus.openCursor('paid', 'prev');
await new Promise((done) => {
  cursor.onsuccess = () => {
    const c = cursor.result;
    if (!c) return done();
    log('оплачен: id ' + c.value.id + ', ' + c.value.total + ' ₽');
    c.continue();
  };
});`;

/**
 * Обвязка сценариев транзакции. Одна и та же строка исполнялась в Chromium (стенд), исполняется
 * в fake-indexeddb (тест) и в браузере читателя (демо): свежая база с хранилищем `notes`,
 * в нём записи `initial`; сценарий получает `db`, `log`, `req` и `fetch`.
 */
export const TX_HARNESS_CODE = `async function runTx(indexedDB, scenario, fetch) {
  const name = 'tx-' + scenario.id + '-' + Math.random().toString(36).slice(2);
  const db = await new Promise((ok, fail) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      const store = open.result.createObjectStore('notes', { keyPath: 'id' });
      for (const id of scenario.initial) store.put({ id });
    };
    open.onsuccess = () => ok(open.result);
    open.onerror = () => fail(open.error);
  });

  // Запрос IndexedDB → промис: так же устроены обёртки вроде библиотеки idb.
  const req = (r) => new Promise((ok, fail) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });

  // Итог транзакции ловится с момента её создания: complete может прийти раньше конца сценария.
  const log = [];
  let ended;
  const proxy = {
    transaction(...args) {
      const tx = db.transaction(...args);
      ended = new Promise((ok) => {
        tx.addEventListener('complete', () => ok('complete'));
        tx.addEventListener('abort', () => ok('abort: ' + (tx.error ? tx.error.name : 'null')));
      });
      return tx;
    },
  };

  const AsyncFunction = (async () => {}).constructor;
  const body = new AsyncFunction('db', 'log', 'req', 'fetch', scenario.code);
  try {
    await body(proxy, (m) => log.push(m), req, fetch);
  } catch (e) {
    log.push('исключение: ' + e.name);
  }
  if (ended) log.push(await ended);

  const keys = await new Promise((ok) => {
    const r = db.transaction('notes').objectStore('notes').getAllKeys();
    r.onsuccess = () => ok(r.result);
  });
  log.push('в базе: ' + (keys.length ? keys.join(', ') : 'пусто'));
  db.close();
  indexedDB.deleteDatabase(name);
  return log;
}`;

export const TX_SCENARIO_CODE: { id: string; initial: number[]; code: string; /** Шаг модели на каждую строку `code`, по порядку. */
  steps: TxStep[] }[] = [
  {
    id: 'micro',
    initial: [],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 1 });
await Promise.resolve();
log('после микрозадачи');
store.put({ id: 2 });`,
    steps: [['tx'], ['store'], ['put', 1], ['micro'], ['log', 'после микрозадачи'], ['put', 2]],
  },
  {
    id: 'request',
    initial: [1],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
const note = await req(store.get(1));
log('get вернул id ' + note.id);
store.put({ id: 2 });`,
    steps: [['tx'], ['store'], ['get', 1, 'await'], ['log', 'get вернул id 1'], ['put', 2]],
  },
  {
    id: 'fetch',
    initial: [],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 1 });
const res = await fetch('/slow');
log('ответ ' + res.status);
store.put({ id: 2 });`,
    steps: [['tx'], ['store'], ['put', 1], ['net'], ['log', 'ответ 200'], ['put', 2]],
  },
  {
    id: 'timeout',
    initial: [],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 1 });
await new Promise((resolve) => setTimeout(resolve, 0));
log('после setTimeout');
store.put({ id: 2 });`,
    steps: [['tx'], ['store'], ['put', 1], ['timeout'], ['log', 'после setTimeout'], ['put', 2]],
  },
  {
    id: 'fetch-first',
    initial: [],
    code: `const res = await fetch('/slow');
log('ответ ' + res.status);
const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 1 });
store.put({ id: 2 });`,
    steps: [['net'], ['log', 'ответ 200'], ['tx'], ['store'], ['put', 1], ['put', 2]],
  },
  {
    id: 'empty',
    initial: [],
    code: `const tx = db.transaction('notes', 'readwrite');
await new Promise((resolve) => setTimeout(resolve, 0));
const store = tx.objectStore('notes');
store.put({ id: 1 });`,
    steps: [['tx'], ['timeout'], ['store'], ['put', 1]],
  },
  {
    id: 'conflict',
    initial: [1],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 2 });
store.add({ id: 1 });
store.put({ id: 3 });`,
    steps: [['tx'], ['store'], ['put', 2], ['add', 1], ['put', 3]],
  },
  {
    id: 'handled',
    initial: [1],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 2 });
const add = store.add({ id: 1 });
add.onerror = (e) => { log('add: ' + add.error.name); e.preventDefault(); };
store.put({ id: 3 });`,
    steps: [['tx'], ['store'], ['put', 2], ['add', 1], ['onerror'], ['put', 3]],
  },
  {
    id: 'commit',
    initial: [],
    code: `const tx = db.transaction('notes', 'readwrite');
const store = tx.objectStore('notes');
store.put({ id: 1 });
tx.commit();
log('commit вызван');
store.put({ id: 2 });`,
    steps: [['tx'], ['store'], ['put', 1], ['commit'], ['log', 'commit вызван'], ['put', 2]],
  },
];

export const CACHE_CODE = `const cache = await caches.open('api-v1');
await cache.add('/data/user?id=1');
log('тот же URL: ' + (await cache.match('/data/user?id=1')).status);
log('другой query: ' + (await cache.match('/data/user?id=2')));
const loose = await cache.match('/data/user', { ignoreSearch: true });
log('ignoreSearch: ' + new URL(loose.url).search);
try {
  await cache.put(new Request('/data/x', { method: 'POST', body: '1' }), new Response(''));
} catch (e) {
  log('put POST: ' + e.name);
}
try {
  await cache.add('/404');
} catch (e) {
  log('add 404: ' + e.name);
}
await cache.put('/data/err', new Response('boom', { status: 500 }));
log('put 500: ' + (await cache.match('/data/err')).status);
log('ключи: ' + (await cache.keys()).map((r) => new URL(r.url).pathname).join(', '));`;

export const OPFS_WORKER_CODE = `// opfs-worker.js
const lines = [];
const log = (m) => lines.push(m);

self.onmessage = async () => {
  const root = await navigator.storage.getDirectory();
  const file = await root.getFileHandle('log.bin', { create: true });
  const handle = await file.createSyncAccessHandle();

  const bytes = new TextEncoder().encode('hello, opfs');
  log('write → ' + handle.write(bytes, { at: 0 }));
  log('getSize → ' + handle.getSize());
  const buf = new Uint8Array(4);
  log('read → ' + handle.read(buf, { at: 7 }) + ' ' + new TextDecoder().decode(buf));

  try {
    await file.createSyncAccessHandle();
  } catch (e) {
    log('второй handle: ' + e.name);
  }

  handle.truncate(5);
  handle.flush();
  handle.close();
  postMessage(lines);
};`;

export const OPFS_MAIN_CODE = `const root = await navigator.storage.getDirectory();
const file = await root.getFileHandle('log.bin');
log('createSyncAccessHandle: ' + typeof file.createSyncAccessHandle);
log('файл: ' + JSON.stringify(await (await file.getFile()).text()));

const drafts = await root.getDirectoryHandle('drafts', { create: true });
const draft = await drafts.getFileHandle('a.txt', { create: true });
const w = await draft.createWritable();
await w.write('черновик');
await w.close();

const names = [];
for await (const [name, h] of root.entries()) names.push(name + ' (' + h.kind + ')');
log(names.sort().join(', '));`;

export const ESTIMATE_CODE = `const MiB = 1024 * 1024;
const bytes = new Uint8Array(MiB);
for (let i = 0; i < MiB; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536));

async function report(step) {
  const { quota, usage, usageDetails } = await navigator.storage.estimate();
  log({ step, usage, free: quota - usage, ...usageDetails });
}
await report('пусто');

const db = await new Promise((ok) => {
  const open = indexedDB.open('blobs', 1);
  open.onupgradeneeded = () => open.result.createObjectStore('b');
  open.onsuccess = () => ok(open.result);
});
await new Promise((ok) => {
  const tx = db.transaction('b', 'readwrite');
  tx.objectStore('b').put(bytes, 'mb');
  tx.oncomplete = ok;
});
await report('+1 МиБ в IndexedDB');

const cache = await caches.open('blobs');
await cache.put('/blob', new Response(bytes));
await report('+1 МиБ в Cache API');

const root = await navigator.storage.getDirectory();
const w = await (await root.getFileHandle('mb.bin', { create: true })).createWritable();
await w.write(bytes);
await w.close();
await report('+1 МиБ в OPFS');

localStorage.setItem('big', 'x'.repeat(MiB / 2)); // полмиллиона символов UTF-16 = 1 МиБ
await report('+1 МиБ в localStorage');`;

export const PERSIST_CODE = `log('persisted(): ' + await navigator.storage.persisted());
const status = await navigator.permissions.query({ name: 'persistent-storage' });
log('разрешение: ' + status.state);
log('persist(): ' + await navigator.storage.persist());`;

// ─── Литералы стенда: вывод stand.mjs без правок ───────────────────────────────────────────

export const STAND = {
  chromium: '153.0.8010.12',
  origin: 'http://localhost:51720',
  tx: {
    micro: ['после микрозадачи', 'complete', 'в базе: 1, 2'],
    request: ['get вернул id 1', 'complete', 'в базе: 1, 2'],
    fetch: ['ответ 200', 'исключение: TransactionInactiveError', 'complete', 'в базе: 1'],
    timeout: ['после setTimeout', 'исключение: TransactionInactiveError', 'complete', 'в базе: 1'],
    'fetch-first': ['ответ 200', 'complete', 'в базе: 1, 2'],
    empty: ['исключение: InvalidStateError', 'complete', 'в базе: пусто'],
    conflict: ['abort: ConstraintError', 'в базе: 1'],
    handled: ['add: ConstraintError', 'complete', 'в базе: 1, 2, 3'],
    commit: ['commit вызван', 'исключение: TransactionInactiveError', 'complete', 'в базе: 1'],
  } as Record<string, string[]>,
  txRuns: 5,
  txMessages: {
    inactive: "Failed to execute 'put' on 'IDBObjectStore': The transaction is not active.",
    finished: "Failed to execute 'objectStore' on 'IDBTransaction': The transaction has finished.",
  },
  version: {
    polite: ['A: открыта версия 1', 'A: versionchange 1 → 2', 'B: upgradeneeded 1 → 2', 'B: открыта версия 2'],
    stubborn: ['A: открыта версия 1', 'A: versionchange 1 → 2', 'B: blocked 1 → 2'],
    stubbornAfterClose: [
      'A: открыта версия 1',
      'A: versionchange 1 → 2',
      'B: blocked 1 → 2',
      'B: upgradeneeded 1 → 2',
      'B: открыта версия 2',
    ],
  },
  index: ['новых: 2', 'id от 2 до 3: 2, 3', 'оплачен: id 4, 700 ₽', 'оплачен: id 2, 1200 ₽'],
  lsTypes: ['string 42', '[object Object]', 'undefined', null, 'Аня'] as (string | null)[],
  lsLimit: {
    ascii: 5242879,
    key10: 5242870,
    cyrillic: 5242879,
    emoji: 2621439,
    session: 5242879,
    error: {
      name: 'QuotaExceededError',
      code: 22,
      ctor: 'QuotaExceededError',
      isDOMException: true,
      message: "Failed to execute 'setItem' on 'Storage': Setting the value of 'k' exceeded the quota.",
    },
    megaValues: 5,
    /** `setItem('k', 'small')`, затем 6e6 символов в `k` и в новый `n` — обе записи упали. */
    failKeeps: { k: 'small', n: null, length: 1 },
  },
  cookie: {
    maxValueWithName1: 4095,
    counts: [
      { set: 180, kept: 180, firstKept: true },
      { set: 181, kept: 150, firstKept: false },
    ],
  },
  events: {
    author: [] as string[],
    sameOrigin: ['theme: null → dark', 'theme: dark → light', 'theme: light → null', 'cart: null → 3', 'null: null → null'],
    otherPort: [] as string[],
    otherHost: [] as string[],
  },
  session: {
    otherTab: null,
    reload: 'abc',
    windowOpen: 'abc',
    openerAfterPopupWrite: 'abc',
    noopener: null,
    blankLink: null,
    awayAndBack: 'abc',
  } as Record<string, string | null>,
  cache: [
    'тот же URL: 200',
    'другой query: undefined',
    'ignoreSearch: ?id=1',
    'put POST: TypeError',
    'add 404: TypeError',
    'put 500: 500',
    'ключи: /data/user, /data/err',
  ],
  opfsWorker: ['write → 11', 'getSize → 11', 'read → 4 opfs', 'второй handle: NoModificationAllowedError'],
  opfsMain: ['createSyncAccessHandle: undefined', 'файл: "hello"', 'drafts (directory), log.bin (file)'],
  idbCompression: { zeros4MiB: 0, random4MiB: 4198400 },
  quotaOtr: [
    { step: 'пусто', usage: 0, free: 3221225472 },
    { step: '+1 МиБ в IndexedDB', usage: 1122304, free: 3221225472, indexedDB: 1122304 },
    { step: '+1 МиБ в Cache API', usage: 2170966, free: 3221225472, caches: 1048662, indexedDB: 1122304 },
    { step: '+1 МиБ в OPFS', usage: 3219700, free: 3221225472, caches: 1048662, fileSystem: 1048734, indexedDB: 1122304 },
    { step: '+1 МиБ в localStorage', usage: 3219700, free: 3221225472, caches: 1048662, fileSystem: 1048734, indexedDB: 1122304 },
  ] as QuotaRow[],
  persistOtr: ['persisted(): false', 'разрешение: prompt', 'persist(): false'],
  otrNewContext: { local: false, idb: [] as string[] },
  quotaProfile: [
    { step: 'пусто', usage: 0, free: 10737418240 },
    { step: '+1 МиБ в IndexedDB', usage: 1050676, free: 10737418240, indexedDB: 1050676 },
    { step: '+1 МиБ в Cache API', usage: 2099764, free: 10737418240, caches: 1049088, indexedDB: 1050676 },
    { step: '+1 МиБ в OPFS', usage: 3148498, free: 10737418240, caches: 1049088, fileSystem: 1048734, indexedDB: 1050676 },
    { step: '+1 МиБ в localStorage', usage: 3148498, free: 10737418240, caches: 1049088, fileSystem: 1048734, indexedDB: 1050676 },
  ] as QuotaRow[],
  persistProfile: ['persisted(): false', 'разрешение: prompt', 'persist(): false'],
  profileRestart: { local: true, idb: ['blobs'] },
};

export interface QuotaRow {
  step: string;
  usage: number;
  free: number;
  indexedDB?: number;
  caches?: number;
  fileSystem?: number;
}

const GiB = 1024 ** 3;
/** Разряды через пробел: `5 242 880`. */
const nf = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const mib = (n: number) => `${(n / 1024 ** 2).toFixed(2).replace('.', ',')} МиБ`;

/** Предел `localStorage` на origin в единицах UTF-16 — ключи и значения вместе. */
export const LS_LIMIT_UNITS = STAND.lsLimit.ascii + 1;

// ─── Раздел 1. Что где хранить ─────────────────────────────────────────────────────────────

export const MAP_ROWS: { k: string; what: string; api: string; size: string; who: string; worker: string }[] = [
  {
    k: 'куки',
    what: 'строки `имя=значение`',
    api: '`document.cookie` и заголовки; уходят с каждым запросом',
    size: `${nf(STAND.cookie.maxValueWithName1 + 1)} байт на куку (имя + значение), ${STAND.cookie.counts[0].kept} на домен`,
    who: 'сервер и JS страницы (без `HttpOnly`)',
    worker: 'нет `document.cookie`',
  },
  {
    k: '`localStorage`',
    what: 'только строки',
    api: 'синхронный: `getItem` возвращает значение сразу',
    size: `${nf(LS_LIMIT_UNITS)} символов UTF-16 на origin`,
    who: 'все вкладки origin',
    worker: 'нет',
  },
  {
    k: '`sessionStorage`',
    what: 'только строки',
    api: 'синхронный, как `localStorage`',
    size: `те же ${nf(STAND.lsLimit.session + 1)} символов`,
    who: 'одна вкладка',
    worker: 'нет',
  },
  {
    k: 'IndexedDB',
    what: 'объекты, `Blob`, `ArrayBuffer` — всё, что переживает структурное клонирование',
    api: 'асинхронный, через транзакции',
    size: 'общая квота сайта — гигабайты',
    who: 'все вкладки и воркеры origin',
    worker: 'есть',
  },
  {
    k: 'Cache API',
    what: 'пары «запрос → ответ»',
    api: 'асинхронный, на промисах',
    size: 'общая квота сайта',
    who: 'все вкладки, воркеры и Service Worker origin',
    worker: 'есть',
  },
  {
    k: 'OPFS',
    what: 'файлы и папки, байты',
    api: 'асинхронный; в воркере — ещё и синхронный',
    size: 'общая квота сайта',
    who: 'все вкладки и воркеры origin',
    worker: 'есть, с синхронным доступом',
  },
];

export const CHOICE: { t: string; d: string; tone?: 'ok' | 'warn' | 'info' }[] = [
  {
    t: 'Тема, язык, свёрнутая панель',
    d: '`localStorage`. Пара строк, нужна сразу при загрузке, до первого `await`. Синхронность здесь — достоинство.',
    tone: 'ok',
  },
  {
    t: 'Черновик формы в одной вкладке',
    d: '`sessionStorage`. Переживает перезагрузку и уход на другой сайт, а в соседней вкладке не мешает второму черновику.',
    tone: 'ok',
  },
  {
    t: 'Данные приложения, офлайн, поиск по полям',
    d: 'IndexedDB. Объекты без `JSON.stringify`, индексы, транзакции, мегабайты и больше. И главный поток не встаёт на время записи.',
    tone: 'ok',
  },
  {
    t: 'Ответы сети для офлайна',
    d: 'Cache API, обычно из Service Worker: он перехватывает запрос и отдаёт сохранённый ответ целиком, с заголовками.',
    tone: 'ok',
  },
  {
    t: 'Большие файлы и запись по байтам',
    d: 'OPFS: видео до загрузки, база SQLite в WebAssembly, журнал. Запись в середину файла без перезаписи всего файла.',
    tone: 'ok',
  },
  {
    t: 'Токен входа',
    d: 'Ни одно хранилище здесь не спасает от чужого скрипта на странице: что может прочитать ваш JS, может прочитать и он. Разбор — в темах [«Безопасность фронтенда»](/platform/security/#s6) и [«Аутентификация»](/platform/authentication/#s3).',
    tone: 'warn',
  },
];

// ─── Раздел 2. localStorage и sessionStorage ───────────────────────────────────────────────

export const LS_TYPES_NOTE =
  '`setItem` молча приводит значение к строке: число становится `"42"`, объект — `"[object Object]"`, `undefined` — строкой `"undefined"`. Отсутствующий ключ — это `null`, а не `undefined`. Объект сохраняют через `JSON.stringify` и читают через `JSON.parse`.';

export const PLAIN_SYNC =
  'Синхронный вызов — как спросить у соседа по столу: ответ сразу, но пока он вспоминает, вы стоите и ждёте. Асинхронный — как отправить письмо: вы занимаетесь своими делами, ответ придёт потом. `localStorage` — сосед по столу. Пока он «вспоминает», страница не рисует кадр и не отвечает на клики.';

export const LS_LIMIT_ROWS: { k: string; got: string; d: string }[] = [
  {
    k: 'ключ `k`, значение из `a`',
    got: nf(STAND.lsLimit.ascii),
    d: `ключ + значение = ${nf(LS_LIMIT_UNITS)} = 5 × 1024 × 1024`,
  },
  {
    k: 'ключ из 10 букв',
    got: nf(STAND.lsLimit.key10),
    d: 'на 9 символов меньше: ключ считается вместе со значением',
  },
  {
    k: 'значение из `я`',
    got: nf(STAND.lsLimit.cyrillic),
    d: 'столько же, хотя в UTF-8 `я` — два байта: считаются символы, а не байты UTF-8',
  },
  {
    k: 'значение из 😀',
    got: nf(STAND.lsLimit.emoji),
    d: 'вдвое меньше: эмодзи — два символа UTF-16 (`"😀".length === 2`)',
  },
  {
    k: '`sessionStorage`',
    got: nf(STAND.lsLimit.session),
    d: 'тот же предел, отдельный от `localStorage`',
  },
  {
    k: 'значения по 1 Ми символов',
    got: `${STAND.lsLimit.megaValues} шт.`,
    d: 'предел общий на origin, а не на один ключ',
  },
];

export const QUOTA_ERROR_NOTE = `Переполнение даёт \`${STAND.lsLimit.error.name}\`, \`code\` ${STAND.lsLimit.error.code}. В Chromium ${STAND.chromium.split('.')[0]} это отдельный класс — \`e.constructor.name\` равно \`${STAND.lsLimit.error.ctor}\`, — но он наследует \`DOMException\`, и старые проверки \`e.name === 'QuotaExceededError'\` работают. Запись, которая не влезла, не применяется вовсе: у ключа остаётся старое значение, новый ключ не появляется.`;

export const SESSION_ROWS: { k: string; got: string; d: string }[] = [
  { k: 'вторая вкладка того же сайта', got: String(STAND.session.otherTab), d: 'у каждой вкладки своё `sessionStorage`' },
  { k: 'перезагрузка вкладки', got: `\`${STAND.session.reload}\``, d: 'данные переживают перезагрузку' },
  { k: 'уход на другой сайт и «Назад»', got: `\`${STAND.session.awayAndBack}\``, d: 'хранилище принадлежит вкладке, а не документу' },
  { k: '`window.open` из вкладки', got: `\`${STAND.session.windowOpen}\``, d: 'новое окно получает **копию**' },
  { k: 'запись в копии', got: `\`${STAND.session.openerAfterPopupWrite}\` у исходной`, d: 'копия дальше живёт своей жизнью' },
  { k: '`window.open(…, \'noopener\')`', got: String(STAND.session.noopener), d: 'без связи с открывшим окном — без копии' },
  { k: 'ссылка `target="_blank"`', got: String(STAND.session.blankLink), d: 'такая ссылка по умолчанию открывается с `noopener`' },
];

export const EVENTS_ROWS: { k: string; got: string }[] = [
  { k: 'A — вкладка, которая пишет', got: STAND.events.author.length ? STAND.events.author.join(', ') : 'ничего' },
  { k: 'B — тот же origin', got: STAND.events.sameOrigin.map((e) => `\`${e}\``).join(', ') },
  { k: 'C — тот же хост, порт 51721', got: STAND.events.otherPort.length ? STAND.events.otherPort.join(', ') : 'ничего' },
  { k: 'D — `127.0.0.1:51720`', got: STAND.events.otherHost.length ? STAND.events.otherHost.join(', ') : 'ничего' },
];

export const EVENTS_NOTE =
  'Восемь вызовов дали пять событий. Повторная запись того же значения и удаление ключа, которого уже нет, событий не порождают. `clear()` приходит одним событием, у которого `key` — `null`. Вкладка-автор своё событие не получает: оно для **других** окон. Вкладка D открыла тот же сервер по адресу `127.0.0.1`, но для браузера это другой origin, и хранилище у неё своё.';

// ─── Раздел 3. IndexedDB ───────────────────────────────────────────────────────────────────

export const PLAIN_IDB =
  'IndexedDB похожа на архив с описью. База — архив; объектные хранилища — шкафы; запись лежит в шкафу под номером (ключом); индекс — дополнительная опись «по фамилии». Номер версии — номер издания описи: чтобы добавить шкаф или опись, архив закрывают на переучёт, и все читатели должны выйти.';

export const VERSION_ROWS: { k: string; log: string; d: string }[] = [
  {
    k: 'A закрывает базу в `versionchange`',
    log: STAND.version.polite.map((l) => `\`${l}\``).join(', '),
    d: 'обновление прошло сразу',
  },
  {
    k: 'A не закрывает',
    log: STAND.version.stubborn.map((l) => `\`${l}\``).join(', '),
    d: 'B ждёт: `blocked` — не отказ, запрос остаётся в очереди',
  },
  {
    k: '…и вкладку A закрыли',
    log: STAND.version.stubbornAfterClose.slice(STAND.version.stubborn.length).map((l) => `\`${l}\``).join(', '),
    d: 'обновление продолжилось само',
  },
];

export const VERSION_NOTE =
  'Обновить схему можно только в `onupgradeneeded`, а он приходит, когда все соединения со старой версией закрыты. Вкладка, открытая вчера, держит соединение — и новая версия сайта в другой вкладке будет ждать её сколько угодно. Поэтому в `onversionchange` базу закрывают и сообщают пользователю, что страницу пора перезагрузить: старый код с новой схемой всё равно работать не обязан.';

export const INDEX_NOTE =
  'Запись лежит под ключом из поля `id` (`keyPath`), индекс `byStatus` создан при обновлении до версии 2. `count` и `getAll` отвечают одним запросом. Курсор с направлением `\'prev\'` идёт по индексу с конца, а записи с равным значением индекса — по убыванию основного ключа: поэтому `4` раньше `2`. `IDBKeyRange.bound(2, 3)` — отрезок ключей с концами.';

// ─── Раздел 4. Жизнь транзакции ────────────────────────────────────────────────────────────

export const PLAIN_TX =
  'Транзакция — как окошко кассы, которое работает, пока к нему стоит очередь. Пока вы у окошка — в той же задаче или её микрозадачах, — можно подавать бумаги. Отошли позвонить (`await fetch`) — кассир обслужил то, что было, увидел пустую очередь и закрыл окошко. Вернулись с новой бумагой — окошко закрыто. А пока кассир отдаёт вам результат прошлой бумаги, вы снова у окошка и можете подать следующую.';

export const TX_RULES: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Активна в задаче, где создана',
    d: 'И во всех микрозадачах после неё: браузер снимает активность только после контрольной точки микрозадач. `await Promise.resolve()` транзакцию не убивает — хоть сто раз подряд.',
    tone: 'info',
  },
  {
    t: 'Снова активна в обработчике запроса',
    d: 'На время `onsuccess` и `onerror` — и микрозадач, которые они породили. Поэтому `await` промиса, обёрнутого вокруг запроса, безопасен: продолжение выполняется внутри обработчика.',
    tone: 'ok',
  },
  {
    t: 'Фиксируется сама',
    d: 'Неактивна и запросов в очереди нет — значит, новых взять неоткуда: транзакция фиксируется и присылает `complete`. Явный `commit()` делает то же сразу.',
    tone: 'warn',
  },
  {
    t: 'Ошибка запроса — откат всего',
    d: 'Необработанная ошибка запроса откатывает транзакцию целиком, вместе с тем, что прошло успешно, и присылает `abort`. `preventDefault()` в `onerror` говорит «ошибку разобрал» — и транзакция продолжается.',
    tone: 'err',
  },
];

export const TX_HARNESS_NOTE =
  'Сценарий получает базу с хранилищем `notes`, функцию `log` и обёртку `req`. Исключение сценария попадает в журнал строкой `исключение: …`; в конце — итог транзакции и ключи, которые остались в базе.';

/**
 * Модель жизни транзакции. Не реализация IndexedDB: она не хранит значения и не знает про
 * индексы. Она отвечает на один вопрос — **когда** транзакция активна и когда фиксируется —
 * и проигрывает сценарий построчно по очередям задач и микрозадач.
 *
 * Допущение модели: ответ сети приходит, когда у базы дел больше нет (на стенде `/slow` отвечает
 * через 150 мс), а таймер встаёт в общую очередь задач. На итоговый журнал девяти сценариев
 * порядок «таймер или событие базы раньше» не влияет: обвязка пишет итог транзакции в конец.
 */
export const TX_MODEL_CODE = `function simulateTransaction(steps, initial) {
  const tasks = [];      // очередь задач: FIFO
  const micro = [];      // очередь микрозадач
  const network = [];    // ответы сети: приходят, когда у базы дел больше нет
  const log = [];
  const trace = [];
  const saved = new Set(initial);   // что лежит в базе
  let tx = null;
  let where = '';
  let pc = 0;            // номер шага сценария = номер строки кода
  let finished = false;  // сценарий доиграл (или бросил исключение)
  let lastRequest = null;
  let ending = '';

  const note = (line, what) => trace.push({
    line, where, what,
    state: tx ? tx.state : '—',
    queue: tx ? [tx.running, ...tx.queue].filter(Boolean).map((r) => r.name) : [],
  });

  function fail(line, name) {
    log.push('исключение: ' + name);
    note(line, 'исключение ' + name + ' — сценарий прерван');
    finished = true;
  }

  // Исполняет строки сценария, пока не встретит await или конец.
  function resume() {
    while (!finished && pc < steps.length) {
      const [op, arg, extra] = steps[pc];
      const line = pc;
      pc += 1;
      if (op === 'tx') {
        tx = { state: 'active', fresh: true, queue: [], running: null, data: new Set(saved), closing: false, error: '' };
        note(line, 'транзакция создана: активна до конца этой задачи');
      } else if (op === 'store') {
        if (tx.state === 'committing' || tx.state === 'finished') return fail(line, 'InvalidStateError');
        note(line, 'objectStore: доступ к хранилищу');
      } else if (op === 'put' || op === 'add' || op === 'get') {
        if (tx.state !== 'active') return fail(line, 'TransactionInactiveError');
        const request = { name: op + ' ' + arg, line, op, key: arg, awaited: extra === 'await', prevent: false };
        tx.queue.push(request);
        lastRequest = request;
        note(line, request.name + ' — в очередь запросов');
        pump();
        if (request.awaited) return;   // продолжение — в обработчике события запроса
      } else if (op === 'onerror') {
        lastRequest.prevent = true;
        note(line, 'обработчик ошибки ' + lastRequest.name + ' с preventDefault()');
      } else if (op === 'commit') {
        if (tx.state !== 'active') return fail(line, 'InvalidStateError');
        tx.state = 'committing';
        note(line, 'commit(): новых запросов не будет');
        maybeCommit();
      } else if (op === 'log') {
        log.push(arg);
        note(line, 'log: ' + arg);
      } else if (op === 'micro') {
        micro.push(resume);
        note(line, 'await: продолжение — микрозадачей');
        return;
      } else if (op === 'timeout') {
        tasks.push({ name: 'таймер', run: resume });
        note(line, 'await setTimeout: продолжение — новой задачей');
        return;
      } else if (op === 'net') {
        network.push({ name: 'ответ сети', run: resume });
        note(line, 'await fetch: продолжение — задачей, когда придёт ответ');
        return;
      }
    }
    finished = true;
  }

  // Следующий запрос из очереди уходит в базу; его результат придёт отдельной задачей.
  function pump() {
    if (!tx || tx.running || tx.queue.length === 0 || tx.state === 'finished') return;
    const r = tx.running = tx.queue.shift();
    if (r.op === 'add' && tx.data.has(r.key)) r.error = 'ConstraintError';
    else if (r.op !== 'get') tx.data.add(r.key);
    tasks.push({ name: (r.error ? 'error ' : 'success ') + r.name, run: () => dispatch(r) });
  }

  // Событие запроса: на время обработчика (и его микрозадач) транзакция снова активна.
  function dispatch(r) {
    tx.running = null;
    if (tx.state === 'inactive') tx.state = 'active';
    note(null, (r.error ? 'error: ' + r.error : 'success') + ' у ' + r.name + ' — транзакция активна, пока идёт обработчик');
    if (r.error) {
      if (r.prevent) log.push(r.op + ': ' + r.error);
      if (r.awaited) micro.push(() => fail(r.line, r.error));
    } else if (r.awaited) {
      micro.push(resume);
    }
    checkpoint();
    if (tx.state === 'active') tx.state = 'inactive';
    if (r.error && !r.prevent) return abort(r.error);
    note(null, 'обработчик закончился — транзакция снова неактивна');
    pump();
    maybeCommit();
  }

  function abort(error) {
    tx.state = 'finished';
    tx.queue = [];
    tx.error = error;
    note(null, 'необработанная ошибка: откат, abort (' + error + ')');
    ending = 'abort: ' + error;
  }

  // Автокоммит: транзакция неактивна и запросов больше нет.
  function maybeCommit() {
    if (!tx || tx.closing || tx.running || tx.queue.length) return;
    if (tx.state !== 'inactive' && tx.state !== 'committing') return;
    tx.closing = true;
    tx.state = 'committing';
    note(null, 'запросов нет, новых не добавить — фиксация');
    tasks.push({ name: 'complete', run: () => {
      tx.state = 'finished';
      for (const k of tx.data) saved.add(k);
      note(null, 'complete: изменения в базе');
      ending = 'complete';
    } });
  }

  // Контрольная точка микрозадач; в её конце свежая транзакция теряет активность.
  function checkpoint() {
    const outer = where;
    while (micro.length) {
      where = 'микрозадача';
      micro.shift()();
    }
    where = outer;
    if (tx && tx.fresh) {
      tx.fresh = false;
      if (tx.state === 'active') {
        tx.state = 'inactive';
        note(null, 'задача и её микрозадачи кончились — транзакция неактивна');
      }
      maybeCommit();
    }
  }

  function runTask(task) {
    where = 'задача: ' + task.name;
    task.run();
    checkpoint();
  }

  runTask({ name: 'скрипт', run: resume });
  for (let guard = 0; guard < 1000; guard++) {
    if (tasks.length) runTask(tasks.shift());
    else if (network.length) runTask(network.shift());
    else break;
  }
  if (ending) log.push(ending);
  const keys = [...saved].sort((a, b) => a - b);
  log.push('в базе: ' + (keys.length ? keys.join(', ') : 'пусто'));
  return { log, trace };
}`;

const TX_TEXT: Record<string, { label: string; note: string }> = {
  micro: {
    label: 'микрозадача',
    note: '`await Promise.resolve()` продолжает сценарий микрозадачей той же задачи. Активность снимается только после того, как кончились все микрозадачи, — второй `put` проходит.',
  },
  request: {
    label: 'await запроса',
    note: 'Так работают обёртки вроде библиотеки `idb`. Продолжение после `await req(…)` выполняется микрозадачей **внутри** обработчика `onsuccess`, где транзакция снова активна.',
  },
  fetch: {
    label: 'await fetch',
    note: 'Пока ждали сеть, задача кончилась, `put 1` выполнился, очередь опустела — транзакция зафиксировалась. Второй `put` бросает `TransactionInactiveError`, а в базе остаётся только `1`: половина работы записана, половина нет.',
  },
  timeout: {
    label: 'setTimeout',
    note: 'Таймер — тоже новая задача. Даже с нулевой задержкой транзакция к этому моменту неактивна: результат тот же, что с `fetch`.',
  },
  'fetch-first': {
    label: 'fetch до транзакции',
    note: 'Исправление: сначала всё, что требует ожидания, потом транзакция — и в ней только запросы к базе. Транзакция создана в задаче ответа сети и активна до её конца.',
  },
  empty: {
    label: 'пустая транзакция',
    note: 'Транзакция без единого запроса фиксируется сразу после своей задачи. Через таймер даже `objectStore()` бросает — уже `InvalidStateError`: транзакция завершается.',
  },
  conflict: {
    label: 'ошибка запроса',
    note: '`add` с ключом, который уже есть, — `ConstraintError`. Ошибку никто не разобрал, и транзакция откатилась целиком: `put 2`, выполненный раньше, тоже пропал.',
  },
  handled: {
    label: 'preventDefault',
    note: 'Тот же конфликт, но обработчик `onerror` вызывает `preventDefault()`. Ошибка остаётся у одного запроса, остальные записаны.',
  },
  commit: {
    label: 'commit()',
    note: 'Явный `commit()` запрещает новые запросы сразу, не дожидаясь конца задачи. Это способ зафиксировать раньше, а не продлить жизнь транзакции.',
  },
};

export const DEMO_SCENARIOS: TxScenario[] = TX_SCENARIO_CODE.map((s) => ({
  ...s,
    label: TX_TEXT[s.id].label,
  note: TX_TEXT[s.id].note,
  chromium: STAND.tx[s.id],
}));

export const DEMO_CAPTION = `Три журнала одного сценария: модель, Chromium ${STAND.chromium} и ваш браузер — только что, той же обвязкой \`runTx\` (вместо \`/slow\` она запрашивает эту страницу). Если движок живёт по тем же правилам, что модель, журналы совпадают строка в строку. Шаги показывают, в какой задаче выполняется строка и в каком состоянии транзакция; пока идут события базы, подсвечена строка, на которой сценарий ждёт.`;

export const TX_FIX_NOTE =
  'Если между чтением и записью нужна сеть — например, прочитать черновик, отправить на сервер и пометить отправленным, — это **две** транзакции. Первая читает, потом `await fetch`, потом вторая пишет. Между ними запись могла поменяться в другой вкладке; если это важно, вторая транзакция перечитывает запись и сверяет номер версии в ней.';

// ─── Раздел 5. Cache API и OPFS ────────────────────────────────────────────────────────────

export const CACHE_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Ключ — запрос целиком',
    d: 'URL с query: `?id=2` не находит ответ для `?id=1`. `ignoreSearch` сравнивает без query. Метод — только `GET`: `put` с `POST` бросает `TypeError`.',
    tone: 'info',
  },
  {
    t: '`add` проверяет ответ, `put` — нет',
    d: '`add` сам делает `fetch` и отказывается от ответа с ошибкой: на `404` — `TypeError`. `put` сохраняет что дали — даже `500`. Ошибку сервера легко закешировать навсегда.',
    tone: 'warn',
  },
  {
    t: 'Срока годности нет',
    d: '`Cache-Control: max-age=60` у ответа сохраняется как заголовок, но Cache API на него не смотрит: запись лежит, пока её не удалят. Стратегии обновления пишут сами — разбор в теме [«Сеть», раздел «Service Worker»](/platform/network/#s5).',
    tone: 'warn',
  },
];

export const PLAIN_OPFS =
  'OPFS — как личная кладовка сайта в квартире браузера. Ключ от неё только у этого сайта, а хозяин квартиры, пользователь, её даже не видит в списке комнат: это не папка «Загрузки». Зато внутри можно класть целые файлы и переписывать их кусками.';

export const OPFS_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'Синхронный доступ — только в воркере',
    d: '`createSyncAccessHandle` в окне — `undefined`. В выделенном воркере `write`, `read` и `getSize` возвращают числа сразу, без промисов: так быстрее всего писать много мелких кусков.',
    tone: 'info',
  },
  {
    t: 'Один синхронный дескриптор на файл',
    d: 'Пока первый открыт, второй `createSyncAccessHandle` к тому же файлу — `NoModificationAllowedError`. Это блокировка: две вкладки с воркерами не испортят файл одновременной записью.',
    tone: 'warn',
  },
  {
    t: 'Позиция задаётся явно',
    d: '`write(bytes, { at: 0 })` пишет с нулевого байта, `read(buf, { at: 7 })` читает с седьмого. `truncate(5)` обрезает файл до пяти байт — окно затем прочло `"hello"`.',
  },
];

// ─── Раздел 6. Квота, вытеснение, инкогнито ────────────────────────────────────────────────

const pickQuota = (rows: QuotaRow[], i: number) => rows[i];

export const QUOTA_ROWS: { k: string; otr: string; profile: string; parts: string }[] = STAND.quotaOtr.map((r, i) => {
  const p = pickQuota(STAND.quotaProfile, i);
  const parts = [
    p.indexedDB !== undefined ? `IndexedDB ${mib(p.indexedDB)}` : '',
    p.caches !== undefined ? `caches ${mib(p.caches)}` : '',
    p.fileSystem !== undefined ? `fileSystem ${mib(p.fileSystem)}` : '',
  ].filter(Boolean);
  return {
    k: r.step,
    otr: mib(r.usage),
    profile: mib(p.usage),
    parts: parts.length ? parts.join(', ') : '—',
  };
});

export const FREE_OTR_GIB = STAND.quotaOtr[0].free / GiB;
export const FREE_PROFILE_GIB = STAND.quotaProfile[0].free / GiB;

export const QUOTA_NOTE = `\`quota − usage\` на каждом шаге не менялось: ровно ${FREE_PROFILE_GIB} ГиБ в профиле на диске и ${FREE_OTR_GIB} ГиБ в контексте без профиля, при свободных на диске около 21 ГБ. Квота растёт вместе с занятым, то есть \`estimate()\` отвечает «сколько ещё можно», и это оценка браузера, а не обещание. **\`localStorage\` в \`usage\` не попал**: полмиллиона символов не сдвинули ни одного числа.`;

export const COMPRESSION_NOTE = `Мегабайт в IndexedDB занял чуть больше мегабайта, но это потому, что байты были случайными. Отдельный замер: 4 МиБ нулей прибавили к \`usageDetails.indexedDB\` ${STAND.idbCompression.zeros4MiB} байт, 4 МиБ случайных байтов — ${nf(STAND.idbCompression.random4MiB)}. Chromium сжимает большие значения, поэтому «сколько займёт» по длине данных не посчитать.`;

export const PERSIST_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' | 'info' }[] = [
  {
    t: 'По умолчанию — best-effort',
    d: 'Когда места мало, браузер удаляет данные сайтов сам, начиная с тех, куда заходили давно, и удаляет origin целиком: IndexedDB, Cache API, OPFS и `localStorage` вместе. Частично стёртой базы не бывает. Это по документации MDN и web.dev.',
    tone: 'warn',
  },
  {
    t: '`persist()` — просьба, а не приказ',
    d: 'Persistent-хранилище браузер под давлением не трогает. В свежем профиле Chromium `persist()` ответил `false` — и на диске, и без профиля, — разрешение в состоянии `prompt`. По документации Chromium решает сам, без окна: по тому, как часто человек бывает на сайте, установлен ли он как приложение, есть ли закладка. Firefox спрашивает пользователя.',
    tone: 'info',
  },
  {
    t: 'Код должен пережить пустое хранилище',
    d: 'Очистка данных сайта пользователем, вытеснение, приватное окно — после любого из них приложение стартует с нуля. Хранилище браузера — кеш данных, источник правды — сервер.',
    tone: 'err',
  },
];

export const INCOGNITO_NOTE = `Контекст Playwright без профиля — тот же профиль «вне записи», что у окна инкогнито. В нём \`estimate()\` дал ${FREE_OTR_GIB} ГиБ вместо ${FREE_PROFILE_GIB}, а данные жили только до закрытия контекста: в новом — ни \`localStorage\`, ни баз IndexedDB. Профиль на диске после перезапуска браузера сохранил и то и другое (база \`${STAND.profileRestart.idb[0]}\` на месте). API в инкогнито те же, они не бросают ошибок — просто всё стирается при закрытии окна.`;

export const PARTITION_NOTE =
  'И последнее правило, которое меняет «кто видит». Фрейм чужого сайта получает хранилище, разделённое по сайту верхнего уровня: у виджета внутри `a.com` и внутри `b.com` два разных `localStorage`, две IndexedDB и два Cache API. Как это устроено в трёх движках и что делает Storage Access API — в теме [«Встроенный контент без сторонних кук», раздел «Разделённое хранилище»](/platform/third-party-cookies/#s4).';

export const TAKEAWAY =
  'Выбор хранилища — это выбор правил, а не объёма. `localStorage` — для пары строк, нужных сразу; всё остальное — IndexedDB, Cache API или OPFS, асинхронно. В транзакции IndexedDB не ждут ничего, кроме самой базы: сеть — до неё или между двумя транзакциями. И любое из хранилищ может оказаться пустым, поэтому сервер остаётся источником правды.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`await fetch` внутри транзакции',
    d: 'Самая частая ошибка с IndexedDB. Пока ждали ответ, транзакция зафиксировала то, что успели поставить, и следующий запрос бросает `TransactionInactiveError`. В базе остаётся половина изменений. Сеть — до транзакции или между двумя.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`await` бывает безопасным',
    d: 'Обратная крайность — бояться любого `await`. Ожидание самой базы (`await req(store.get(1))`, библиотека `idb`) и готовых промисов транзакцию не убивает. Убивает ожидание новой задачи: сети, таймера, `postMessage`, события пользователя.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Одна ошибка откатывает всё',
    d: '`add` с занятым ключом без обработчика `onerror` отменяет и записи, которые уже прошли. Если ошибка ожидаема, `onerror` вызывает `preventDefault()`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Старая вкладка блокирует обновление схемы',
    d: 'Без `onversionchange` с `db.close()` новая версия сайта в соседней вкладке получит `blocked` и будет ждать, пока пользователь не закроет старую. Снаружи это выглядит как зависшая загрузка.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`localStorage.setItem(key, obj)` не ошибка, а потеря',
    d: 'Объект молча станет строкой `"[object Object]"`, `undefined` — строкой `"undefined"`. Ошибки нет, данных тоже. Только `JSON.stringify` и `JSON.parse`.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Предел `localStorage` — в символах, не в байтах',
    d: `${nf(LS_LIMIT_UNITS)} символов UTF-16 на origin в Chromium, ключи вместе со значениями. Эмодзи — два символа. Кириллица — один, хотя по сети она весит вдвое больше латиницы. И \`setItem\` при переполнении бросает: запись нужно оборачивать в \`try\`.`,
    tone: 'warn',
  },
  {
    n: '07',
    t: '`storage` не приходит в свою вкладку',
    d: 'Событие получают **другие** окна того же origin. Синхронизация «записал — обновил интерфейс» в самой вкладке-авторе делается обычным вызовом, а не слушателем. Для обмена сообщениями между вкладками есть `BroadcastChannel`.',
  },
  {
    n: '08',
    t: '`estimate()` — не размер диска',
    d: 'Он отвечает, сколько ещё можно занять, и в Chromium это была круглая константа сверх занятого. Хранилище при этом может быть вытеснено целиком, пока сайт не получил `persist()`. Квоту спрашивают перед большой записью, а не зашивают в код.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Indexed Database API 3.0',
    href: 'https://w3c.github.io/IndexedDB/',
    what: 'транзакции и их состояния, автокоммит, `commit()`, ошибки запросов и `abort`, `versionchange` и `blocked`, индексы и курсоры',
  },
  {
    title: 'WHATWG HTML — perform a microtask checkpoint',
    href: 'https://html.spec.whatwg.org/multipage/webappapis.html#perform-a-microtask-checkpoint',
    what: 'шаг «Cleanup Indexed Database transactions» после микрозадач — почему `await Promise.resolve()` транзакцию не убивает',
  },
  {
    title: 'WHATWG HTML — Web storage',
    href: 'https://html.spec.whatwg.org/multipage/webstorage.html',
    what: '`localStorage`, `sessionStorage`, событие `storage`, копия `sessionStorage` при открытии окна',
  },
  {
    title: 'WHATWG Storage Standard',
    href: 'https://storage.spec.whatwg.org/',
    what: '`estimate()`, `persist()`, режимы best-effort и persistent, «хранилище сайта — единица вытеснения»',
  },
  {
    title: 'WHATWG File System Standard',
    href: 'https://fs.spec.whatwg.org/',
    what: 'OPFS: `getDirectory()`, `FileSystemSyncAccessHandle`, блокировка файла',
  },
  {
    title: 'W3C — Service Workers: Cache',
    href: 'https://w3c.github.io/ServiceWorker/',
    what: 'интерфейсы `Cache` и `CacheStorage`: `match`, `add`, `put`, `ignoreSearch`',
  },
  {
    title: 'MDN — Storage quotas and eviction criteria',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria',
    what: 'квоты по браузерам, порядок вытеснения, как браузеры выдают `persist()`',
  },
  {
    title: 'web.dev — Storage for the web',
    href: 'https://web.dev/articles/storage-for-the-web',
    what: 'обзор хранилищ и квот от команды Chrome',
  },
  {
    title: 'RFC 6265 — HTTP State Management Mechanism',
    href: 'https://www.rfc-editor.org/rfc/rfc6265',
    what: 'минимальные пределы для кук: 4096 байт на куку, 50 на домен',
  },
  {
    title: 'fake-indexeddb',
    href: 'https://github.com/dumbmatter/fakeIndexedDB',
    what: 'IndexedDB на чистом JS: с ней тест сверяет модель транзакции; версия 6.2.5',
  },
];

export const RELATED =
  'Смежное на сайте: [Безопасность фронтенда, раздел «Куки и JWT для фронта»](/platform/security/#s6) — кука, `localStorage` или память для токена. [Аутентификация, раздел «Где держать вход»](/platform/authentication/#s3) — кто проходит вход и что остаётся в браузере. [Встроенный контент без сторонних кук, раздел «Разделённое хранилище»](/platform/third-party-cookies/#s4) — хранилище фрейма под чужим сайтом. [Сеть, раздел «Service Worker»](/platform/network/#s5) — стратегии кеша поверх Cache API. [Кеш серверных данных, раздел «Серверное состояние — не ваше»](/frameworks/data-cache/#s1) — почему данные с сервера живут в кеше, а не в сторе. [Воркеры, раздел «Что можно передать»](/js/workers/#s2) — структурное клонирование, которым IndexedDB копирует записи. [Service Worker изнутри](/render/service-worker/) — жизненный цикл, почему новая версия ждёт, перехват fetch и работа без сети. [Копирование и сериализация](/js/serialization/) — `JSON.stringify` по шагам, алгоритм `structuredClone` и что теряет каждая копия.';
