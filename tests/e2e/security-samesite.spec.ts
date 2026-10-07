import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  COOKIE_FACTS,
  PITFALLS,
  SAMESITE_NOTES,
  SAMESITE_ROWS,
} from '../../src/content/platform/security/data';

/**
 * `SameSite` и префиксы кук — «Безопасность фронтенда»: таблица `SAMESITE_ROWS`, карточки
 * `SAMESITE_NOTES` и `COOKIE_FACTS`, тонкое место про CSRF в `PITFALLS`.
 *
 * Тема утверждает снятое разово в Chromium 153 на двух настоящих сайтах: свежая кука, получившая
 * `Lax` **по умолчанию**, уходит на cross-site top-level `POST`, а явная `SameSite=Lax` — нет;
 * переход по ссылке уносит обе, `Strict` — не уносит; префиксы `__Host-`/`__Secure-` и
 * `SameSite=None` без `Secure` браузер отвергает. Юнит-тестом это не закрыть — решение о куке
 * принимает сетевой стек браузера.
 *
 * ⚠️ Стенд — **два разных сайта**, `a.test` и `b.test`, оба сведены на `127.0.0.1` правилом
 * `--host-resolver-rules`. Два порта на `localhost` здесь не годятся: это cross-origin, но
 * **same-site** — порт в понятие site не входит, и зонд показал бы «всё уходит» там, где в жизни
 * не уходит ничего (AGENTS.md, ловушки стендов). Сервер — свой `http.createServer` на свободном
 * порту; сайт курса и `global-setup` не нужны.
 *
 * ⚠️ Проверка обязана отличать «`SameSite` не пустил» от «форма куку не несёт вообще». Поэтому
 * рядом с кросс-сайтовым `POST` стоит тот же `POST` с самого `a.test`: там уходят все три куки.
 *
 * ⚠️ **Половины «через 130 секунд не уходит ни одна» здесь нет — намеренно.** Исключение
 * «Lax + POST» живёт две минуты от установки куки, и проверить его конец можно только
 * ожиданием дольше двух минут; в каждом прогоне e2e такая пауза неприемлема, а сократить её
 * нечем — срок зашит в Chromium, флага нет. Проверяется начало исключения и его граница
 * по виду куки (умолчательная против явной); конец исключения остаётся снятым разово.
 *
 * Ожидания связаны с текстом темы: символы ✅/❌ из `SAMESITE_ROWS` сверяются с тем, что дошло
 * до сервера, а у карточек проверяется короткая смысловая подстрока — та, ради которой делалась
 * правка (подробно у каждой проверки).
 */

test.use({
  launchOptions: { args: ['--host-resolver-rules=MAP a.test 127.0.0.1, MAP b.test 127.0.0.1'] },
});

/** Куки, которые ставит `a.test`. Ключ — имя, значение — строка `Set-Cookie`. */
const SET = {
  dflt: 'dflt=1; Path=/',
  lax: 'lax=1; Path=/; SameSite=Lax',
  strict: 'strict=1; Path=/; SameSite=Strict',
  none: 'none=1; Path=/; SameSite=None',
  host: '__Host-h=1; Path=/',
  secure: '__Secure-s=1; Path=/',
} as const;

let server: Server;
let PORT = 0;
/** Какие куки дошли до `a.test/echo` — по метке запроса. */
const seen = new Map<string, string[]>();

function cookieNames(req: IncomingMessage): string[] {
  return (req.headers.cookie ?? '')
    .split(';')
    .map((pair) => pair.trim().split('=')[0])
    .filter(Boolean)
    .sort();
}

const A = () => `http://a.test:${PORT}`;
const B = () => `http://b.test:${PORT}`;

/** Страница с формой `POST` и ссылкой на `a.test/echo` — отдаётся с любого из двух сайтов. */
function launcher(): string {
  return `<!doctype html><title>launcher</title>
<form method="POST" action="${A()}/echo?tag=post"><button id="post">post</button></form>
<a id="link" href="${A()}/echo?tag=link">link</a>`;
}

function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  req.resume();
  if (url.pathname === '/set') {
    res.setHeader('set-cookie', Object.values(SET));
    res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>set</title>');
    return;
  }
  if (url.pathname === '/echo') {
    seen.set(url.searchParams.get('tag') ?? '?', cookieNames(req));
    res
      .writeHead(200, { 'content-type': 'text/html', 'access-control-allow-origin': B() })
      .end('<!doctype html><title>echo</title>');
    return;
  }
  if (url.pathname === '/launcher') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(launcher());
    return;
  }
  res.writeHead(404).end();
}

test.beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  PORT = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Свежие куки: ставятся в начале каждой проверки, то есть заведомо внутри двухминутного окна. */
async function plant(context: BrowserContext, page: Page) {
  seen.clear();
  await context.clearCookies();
  await page.goto(`${A()}/set`);
}

/** Что дошло до сервера по метке — с внятной ошибкой, если запрос не дошёл вовсе. */
function arrived(tag: string): string[] {
  const names = seen.get(tag);
  if (!names) throw new Error(`запрос «${tag}» до a.test не дошёл — стенд сломан, сверять не с чем`);
  return names;
}

/** Строка таблицы `SAMESITE_ROWS`: `true`, если тема обещает, что кука уйдёт. */
function row(k: string) {
  const found = SAMESITE_ROWS.find((item) => item.k === k);
  if (!found) {
    throw new Error(`в SAMESITE_ROWS нет строки «${k}»: таблицу переписали, а сторож остался прежним`);
  }
  const goes = (cell: string) => cell.startsWith('✅');
  return { strict: goes(found.strict), lax: goes(found.lax), laxCell: found.lax };
}

function card(list: { t: string; d: string }[], start: string, where: string): string {
  const found = list.find((item) => item.t.startsWith(start));
  if (!found) throw new Error(`в ${where} нет карточки «${start}…»: сторож остался без утверждения`);
  return found.d;
}

/**
 * Приём кук. `__Host-` и `__Secure-` без `Secure`, `SameSite=None` без `Secure` — отвергнуты.
 * Карточки темы обязаны обещать то же самое.
 *
 * ⚠️ **`context.cookies()` здесь врёт в сторону темы.** Playwright подставляет `sameSite: 'Lax'`
 * любой куке, у которой браузер атрибута не хранит (`sameSite: c.sameSite ?? "Lax"` в его
 * исходниках), — и умолчательная кука выглядит неотличимой от явной `Lax`. Поэтому хранилище
 * спрашивается напрямую, по протоколу отладчика: там у умолчательной куки `sameSite` **нет**.
 * Это не мелочь, а весь механизм исключения «Lax + POST»: Chromium помнит, что атрибут не был
 * указан, и потому отличает умолчательную куку от явной. «Трактуется как `Lax`» проверяется
 * поведением (переход по ссылке и `fetch` ниже), а не записью в хранилище.
 */
test('браузер отвергает префиксы и None без Secure; умолчание хранится без атрибута', async ({
  context,
  page,
}) => {
  await plant(context, page);
  const cdp = await context.newCDPSession(page);
  const { cookies } = (await cdp.send('Network.getCookies', { urls: [A()] })) as {
    cookies: { name: string; sameSite?: string }[];
  };
  const names = cookies.map((cookie) => cookie.name).sort();

  expect(names, 'набор принятых кук не тот').toEqual(['dflt', 'lax', 'strict']);
  expect(
    cookies.find((cookie) => cookie.name === 'dflt')?.sameSite,
    'у куки без SameSite в хранилище появился атрибут — умолчательная кука перестала отличаться от явной',
  ).toBeUndefined();
  expect(cookies.find((cookie) => cookie.name === 'lax')?.sameSite, 'явная Lax хранится не как Lax').toBe(
    'Lax',
  );

  // «Примет, **только если** есть `Secure`» — ради этой оговорки карточка и сверяется:
  // без неё префикс выглядит украшением имени, а не условием приёма.
  expect(card(COOKIE_FACTS, 'Префикс `__Host-`', 'COOKIE_FACTS')).toContain(
    'браузер примет, **только если** есть `Secure`',
  );
  // «Молча выбросит» — утверждение про `None` без `Secure`, подтверждённое отсутствием куки выше.
  expect(card(SAMESITE_NOTES, '`None` требует `Secure`', 'SAMESITE_NOTES')).toContain(
    'молча её выбросит',
  );
  expect(card(SAMESITE_NOTES, 'Умолчание `Lax`', 'SAMESITE_NOTES')).toContain(
    'кука без явного `SameSite` трактуется как `Lax`',
  );
});

/**
 * Ядро правки: свежая умолчательная кука уходит на cross-site top-level `POST`, явная `Lax` —
 * нет, `Strict` — тоже нет. Контроль — тот же `POST` с самого `a.test`: уходят все три,
 * значит отсутствие кук на кросс-сайтовом `POST` — решение `SameSite`, а не свойство формы.
 */
test('cross-site POST формой уносит свежую умолчательную куку, но не явную Lax', async ({
  context,
  page,
}) => {
  await plant(context, page);

  // Контроль: same-site POST.
  await page.goto(`${A()}/launcher`);
  await Promise.all([page.waitForURL(/tag=post/), page.click('#post')]);
  expect(arrived('post'), 'same-site POST не унёс все три куки — контроль сломан').toEqual([
    'dflt',
    'lax',
    'strict',
  ]);

  // Кросс-сайтовый POST.
  seen.clear();
  await page.goto(`${B()}/launcher`);
  await Promise.all([page.waitForURL(/tag=post/), page.click('#post')]);
  const post = arrived('post');

  expect(post, 'свежая кука с Lax по умолчанию не ушла на cross-site POST').toContain('dflt');
  expect(post, 'явная SameSite=Lax ушла на cross-site POST — исключение шире, чем пишет тема').not.toContain(
    'lax',
  );
  expect(post, 'Strict ушла на cross-site POST').not.toContain('strict');

  // Таблица: у `Lax` в строке про POST — «❌ *», то есть «нет, кроме исключения».
  const table = row('Cross-site `POST` формой');
  expect(table.lax, 'таблица обещает, что Lax уходит на cross-site POST').toBe(false);
  expect(table.laxCell, 'из таблицы пропала звёздочка исключения').toContain('*');
  expect(table.strict, 'таблица обещает, что Strict уходит на cross-site POST').toBe(false);

  // Текст обязан проводить ту же границу. Подстроки — формулировки правки: исключение только для
  // умолчательной куки, и вывод «явное строже». Без них тема вернулась бы к «Lax + POST»
  // для любой Lax, а это браузер только что опроверг.
  const star = card(SAMESITE_NOTES, 'Звёздочка в строке про `POST`', 'SAMESITE_NOTES');
  expect(star).toContain('**только к куке, получившей `Lax` по умолчанию**');
  expect(star).toContain('**явное `SameSite=Lax` строже умолчательного**');
  expect(card(PITFALLS, '`SameSite=Lax` не спасает от GET-CSRF', 'PITFALLS')).toContain(
    'Явная `SameSite=Lax` так не уходит',
  );
});

/** Переход по ссылке с чужого сайта уносит обе `Lax` (явную и умолчательную), `Strict` — нет. */
test('переход по ссылке с чужого сайта уносит Lax обоих видов, но не Strict', async ({
  context,
  page,
}) => {
  await plant(context, page);
  await page.goto(`${B()}/launcher`);
  await Promise.all([page.waitForURL(/tag=link/), page.click('#link')]);
  const link = arrived('link');

  expect(link, 'переход по ссылке не унёс умолчательную куку').toContain('dflt');
  expect(link, 'переход по ссылке не унёс явную Lax').toContain('lax');
  expect(link, 'Strict ушла на переходе по ссылке с чужого сайта').not.toContain('strict');

  const table = row('Переход по ссылке с чужого сайта');
  expect(table.lax, 'таблица обещает, что Lax не уходит по ссылке').toBe(true);
  expect(table.strict, 'таблица обещает, что Strict уходит по ссылке').toBe(false);
});

/** Cross-site `fetch` с `credentials: 'include'` не уносит ни одной из трёх. */
test('cross-site fetch с credentials не уносит ничего', async ({ context, page }) => {
  await plant(context, page);
  await page.goto(`${B()}/launcher`);
  await page.evaluate(async (url) => {
    await fetch(url, { credentials: 'include', mode: 'no-cors' });
  }, `${A()}/echo?tag=fetch`);

  expect(arrived('fetch'), 'cross-site fetch унёс куки').toEqual([]);
  expect(row('Cross-site `fetch` / XHR').lax, 'таблица обещает, что Lax уходит на fetch').toBe(false);
});
