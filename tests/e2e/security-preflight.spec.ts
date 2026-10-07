import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { PREFLIGHT_MEASURED } from '../../src/content/platform/network/data';
import { PREFLIGHT_FACTS } from '../../src/content/platform/security/data';

/**
 * Кеш preflight: «Безопасность фронтенда» (`PREFLIGHT_FACTS`) и «Сеть и кеширование»
 * (таблица замера `PREFLIGHT_MEASURED`, раздел «Preflight и его кеш»).
 *
 * Обе темы утверждают снятое разово в Chromium 153: в кеш preflight кладётся **не запрошенный**
 * метод, а весь набор из `Access-Control-Allow-Methods` и `Allow-Headers`, поэтому после preflight
 * под `POST` щедрый ответ пропускает `PUT` без нового `OPTIONS`. Такое утверждение юнит-тестом
 * не закрыть: кеш preflight живёт в сетевом стеке браузера, в Node его нет.
 *
 * Стенд — два настоящих origin (`http.createServer` на двух свободных портах `localhost`):
 * страница на одном, API на другом. Сайт курса не нужен, `global-setup` тоже. Сервер считает
 * **дошедшие** `OPTIONS` и дошедшие основные запросы — это и есть ответ браузера; время здесь
 * не меряется.
 *
 * ⚠️ Три условия, без которых проверка не отличает «работает» от «не работает» (AGENTS.md):
 *   — **свой URL на каждый случай**: иначе шаг попадает в запись кеша, созданную соседним шагом,
 *     и числа выходят ровные, но пустые — первый авторский замер пришлось выбросить ровно так;
 *   — **контроль срока парой** `Max-Age: 600` против `Max-Age: 1` с одной и той же паузой:
 *     без короткого срока «второго `OPTIONS` нет» ничего не доказывает — кеш мог бы и не истекать;
 *   — **`Allow-*` ровно те, что нужны случаю**, и узкий ответ рядом со щедрым: без отказа при
 *     `Allow-Methods: POST` нельзя сказать, что `PUT` прошёл именно благодаря кешу набора.
 *
 * Ожидаемые числа не переписаны сюда литералами: `measured()` достаёт их из строк
 * `PREFLIGHT_MEASURED`, так что таблица на странице и этот прогон — одно и то же заявление.
 *
 * Чего здесь нет намеренно: строки про умолчание в 5 секунд («третий вызов через 6 секунд») —
 * она требует шестисекундной паузы и стоит на границе в одну секунду; её закрепление — вопрос
 * отдельного, медленного сторожа.
 */

type CaseConfig = { methods: string; headers: string; maxAge: string };

/** Настройки ответа на `OPTIONS` для каждого случая — по пути запроса. */
const CASES: Record<string, CaseConfig> = {
  long: { methods: 'POST', headers: 'content-type', maxAge: '600' },
  short: { methods: 'POST', headers: 'content-type', maxAge: '1' },
  narrow: { methods: 'POST', headers: 'content-type', maxAge: '600' },
  generous: { methods: 'GET, POST, PUT', headers: 'content-type, x-trace', maxAge: '600' },
  creds: { methods: 'POST', headers: 'content-type', maxAge: '600' },
};

/** Пауза для пары сроков: заведомо больше `Max-Age: 1` и заведомо меньше `Max-Age: 600`. */
const PAUSE_MS = 2500;

interface Tally {
  options: number;
  actual: Record<string, number>;
}

let pageServer: Server;
let apiServer: Server;
let PAGE_ORIGIN = '';
let API_ORIGIN = '';
const tally = new Map<string, Tally>();

function count(name: string): Tally {
  let entry = tally.get(name);
  if (!entry) {
    entry = { options: 0, actual: {} };
    tally.set(name, entry);
  }
  return entry;
}

function api(req: IncomingMessage, res: ServerResponse) {
  const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '');
  const config = CASES[name];
  if (!config) {
    res.writeHead(404).end();
    return;
  }
  const cors = {
    'access-control-allow-origin': PAGE_ORIGIN,
    'access-control-allow-credentials': 'true',
  };
  if (req.method === 'OPTIONS') {
    count(name).options += 1;
    res
      .writeHead(204, {
        ...cors,
        'access-control-allow-methods': config.methods,
        'access-control-allow-headers': config.headers,
        'access-control-max-age': config.maxAge,
      })
      .end();
    return;
  }
  const method = req.method ?? '?';
  const entry = count(name);
  entry.actual[method] = (entry.actual[method] ?? 0) + 1;
  req.resume();
  res.writeHead(200, { ...cors, 'content-type': 'text/plain' }).end('ok');
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, 'localhost', () => resolve((server.address() as AddressInfo).port));
  });
}

test.beforeAll(async () => {
  pageServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>preflight</title>');
  });
  apiServer = createServer(api);
  PAGE_ORIGIN = `http://localhost:${await listen(pageServer)}`;
  API_ORIGIN = `http://localhost:${await listen(apiServer)}`;
});

test.afterAll(async () => {
  await Promise.all(
    [pageServer, apiServer].map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

test.beforeEach(async ({ page }) => {
  tally.clear();
  await page.goto(`${PAGE_ORIGIN}/`);
});

/** Один `fetch` со страницы: `ok` — дошёл ли ответ до JS, `error` — имя ошибки при отказе. */
async function call(
  page: Page,
  name: string,
  init: { method: string; headers?: Record<string, string>; credentials?: RequestCredentials },
): Promise<{ ok: boolean; error: string }> {
  return page.evaluate(
    async ({ url, init }) => {
      try {
        const response = await fetch(url, { ...init, body: init.method === 'GET' ? undefined : '{}' });
        return { ok: response.ok, error: '' };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.name : String(error) };
      }
    },
    { url: `${API_ORIGIN}/${name}`, init },
  );
}

const JSON_HEADERS = { 'content-type': 'application/json' };

/** Сколько `OPTIONS` дошло до сервера по случаю — на данный момент. */
function options(name: string): number {
  return tally.get(name)?.options ?? 0;
}

/**
 * Ожидание темы: колонка «ушло `OPTIONS`» строки, начинающейся с `prefix`, — числами по шагам.
 * `'1 + 0'` → `[1, 0]`, `'1'` → `[1]`.
 */
function measured(prefix: string): number[] {
  const row = PREFLIGHT_MEASURED.rows.find(([what]) => what.startsWith(prefix));
  if (!row) {
    throw new Error(
      `в PREFLIGHT_MEASURED нет строки, начинающейся с «${prefix}»: таблицу переписали, ` +
        'а сторож остался прежним',
    );
  }
  return row[1].split('+').map((part) => Number(part.trim()));
}

/**
 * Связь с текстом «Безопасности фронтенда»: карточка про кеш preflight обязана говорить
 * именно то, что проверяется ниже, — что кешируется **набор из ответа**, а не запрошенный
 * метод. Подстрока короткая и смысловая: ради неё правка и делалась (AGENTS.md, «Уточнено
 * в „Безопасности фронтенда“»). Покраснело здесь — перечитайте карточку, а не ослабляйте выкройку.
 */
test('карточка PREFLIGHT_FACTS говорит про кеш набора, а не запрошенного метода', () => {
  const card = PREFLIGHT_FACTS.find((fact) => fact.t.startsWith('У него свой кеш'));
  expect(card, 'в PREFLIGHT_FACTS пропала карточка «У него свой кеш»').toBeTruthy();
  expect(card!.d, 'карточка перестала говорить, что кешируется не запрошенный метод').toContain(
    'в кеш кладётся **не запрошенный** метод, а весь набор из `Access-Control-Allow-Methods`',
  );
});

/**
 * Контроль срока: одна и та же пауза, два срока. Длинный держит запись — второго `OPTIONS` нет;
 * короткий её теряет — второй есть. Без короткого срока «нет второго `OPTIONS`» не отличило бы
 * работающий кеш от кеша, который не истекает никогда.
 */
test('Max-Age 600 держит запись через паузу, Max-Age 1 — нет', async ({ page }) => {
  const run = async (name: string) => {
    const first = await call(page, name, { method: 'POST', headers: JSON_HEADERS });
    const afterFirst = options(name);
    await page.waitForTimeout(PAUSE_MS);
    const second = await call(page, name, { method: 'POST', headers: JSON_HEADERS });
    expect(first.ok && second.ok, `${name}: основной запрос не прошёл — считать нечего`).toBe(true);
    return [afterFirst, options(name) - afterFirst];
  };

  const [long, short] = await Promise.all([run('long'), run('short')]);

  expect(long, 'Max-Age: 600 — запись кеша не дожила до второго вызова').toEqual([1, 0]);
  expect(short, 'Max-Age: 1 — запись пережила свой срок: контроль не отличает кеш от его отсутствия').toEqual(
    [1, 1],
  );

  // Сверка с таблицей темы. Строка про 600 записана итогом на два вызова, про 1 — по шагам.
  expect([long[0] + long[1]], 'таблица темы про Max-Age: 600 разошлась с браузером').toEqual(
    measured('`Access-Control-Max-Age: 600`'),
  );
  expect(short, 'таблица темы про Max-Age: 1 разошлась с браузером').toEqual(
    measured('`Access-Control-Max-Age: 1`'),
  );
});

/**
 * Ядро утверждения. Щедрый ответ на preflight под `POST` заранее разрешает `PUT` — он идёт
 * без нового `OPTIONS`, как и заголовок, который до этого не посылался ни разу. Узкий ответ
 * рядом — контроль: там тот же `PUT` требует новый `OPTIONS` и умирает на нём, до сервера
 * не дойдя.
 */
test('в кеш кладётся набор из Allow-*: PUT после preflight под POST идёт без OPTIONS', async ({ page }) => {
  // Щедрый ответ.
  const post = await call(page, 'generous', { method: 'POST', headers: JSON_HEADERS });
  const afterPost = options('generous');
  const put = await call(page, 'generous', { method: 'PUT', headers: JSON_HEADERS });
  const afterPut = options('generous');
  const traced = await call(page, 'generous', {
    method: 'PUT',
    headers: { ...JSON_HEADERS, 'x-trace': '1' },
  });
  const afterTrace = options('generous');

  expect(post.ok && put.ok && traced.ok, 'при щедром ответе один из запросов не прошёл').toBe(true);
  expect(
    [afterPost, afterPut - afterPost],
    'PUT после preflight под POST потребовал новый OPTIONS: кешируется запрошенный метод, а не набор',
  ).toEqual(measured('`Allow-Methods: GET, POST, PUT`'));
  expect(
    [afterTrace - afterPut],
    'ни разу не посланный x-trace из Allow-Headers потребовал новый OPTIONS',
  ).toEqual(measured('он же — `PUT` с ни разу не использованным `x-trace`'));
  expect(tally.get('generous')?.actual, 'до сервера дошли не все основные запросы').toEqual({
    POST: 1,
    PUT: 2,
  });

  // Узкий ответ — контроль.
  const narrowPost = await call(page, 'narrow', { method: 'POST', headers: JSON_HEADERS });
  const beforePut = options('narrow');
  const narrowPut = await call(page, 'narrow', { method: 'PUT', headers: JSON_HEADERS });

  expect(narrowPost.ok, 'POST при узком ответе не прошёл — контроль сломан').toBe(true);
  expect(
    [options('narrow') - beforePut],
    'при Allow-Methods: POST запрос PUT не вызвал нового OPTIONS — контроль не отличает кеш набора от кеша чего угодно',
  ).toEqual(measured('`Allow-Methods: POST`, затем запрос `PUT`'));
  expect(narrowPut, 'PUT при Allow-Methods: POST не получил CORS-отказ').toEqual({
    ok: false,
    error: 'TypeError',
  });
  expect(
    tally.get('narrow')?.actual.PUT ?? 0,
    'PUT дошёл до сервера — а тема обещает, что он умирает на preflight',
  ).toBe(0);
});

/** Режим credentials — часть ключа: `omit` и `include` на одном URL платят по своему preflight. */
test('credentials omit и include на одном URL — две записи кеша', async ({ page }) => {
  await call(page, 'creds', { method: 'POST', headers: JSON_HEADERS, credentials: 'omit' });
  const afterOmit = options('creds');
  const again = await call(page, 'creds', { method: 'POST', headers: JSON_HEADERS, credentials: 'omit' });
  const afterAgain = options('creds');
  await call(page, 'creds', { method: 'POST', headers: JSON_HEADERS, credentials: 'include' });

  expect(again.ok, 'повторный omit не прошёл').toBe(true);
  // Контроль: тот же режим повторно в кеш попадает — иначе «второй OPTIONS» ниже ничего не значит.
  expect(afterAgain - afterOmit, 'повторный вызов в том же режиме не попал в кеш').toBe(0);
  expect(
    [afterOmit, options('creds') - afterAgain],
    'смена режима credentials не потребовала своего preflight',
  ).toEqual(measured('тот же URL: `credentials: omit`, затем `include`'));
});
