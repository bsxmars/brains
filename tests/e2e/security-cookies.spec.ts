import { expect, test } from '@playwright/test';
import {
  BLIND_SPOTS,
  BLIND_SPOT_RUN,
  REFRESH_LOCK_CODE,
  REFRESH_LOCK_NOTE,
} from '../../src/content/platform/security/data';

/**
 * Раздел 6 «Куки и JWT глазами фронтендера»: браузерная половина.
 *
 * Node-часть раздела (разбор токена, `base64url`, `exp`, подпись) закрыта
 * `tests/unit/security-jwt.test.ts` и здесь не дублируется. А всё, что раздел утверждает
 * про **слепые зоны фронта**, снято разовым прогоном в Chromium 153 — и по правилу курса
 * такому утверждению нужен сторож: «проверено запуском» относится к тому запуску, которого
 * больше никто не повторит.
 *
 * Юнит-тестом это не закрыть в принципе: в Node нет ни `document.cookie`, ни `cookieStore`,
 * ни сетевого процесса, который прячет `HttpOnly`-куку от рендерера, ни `navigator.locks`
 * с его очередью на источник. Спрашивать обязан настоящий браузер — отсюда e2e.
 *
 * Устройство проверки то же, что в `browser-architecture.spec.ts`: **тема — заявление,
 * браузер — ответ, тест ловит расхождение.** Ожидания не переписаны сюда литералами —
 * `claim()` достаёт их из `BLIND_SPOTS`, `REFRESH_LOCK_CODE` и `REFRESH_LOCK_NOTE`. Если
 * карточка начнёт обещать пустое значение вместо отсутствия пары, покраснеет тест, а не читатель.
 *
 * ⚠️ Сервера с куками здесь нет — сайт статический. Обе куки кладутся **снаружи**, через
 * `context.addCookies`, ровно как в прогоне автора: `sid` с `HttpOnly` и `theme` без него.
 * Удаление тоже проверяется снаружи: страница выполняет строку из темы, а список кук
 * спрашивается у Playwright — изнутри страницы `HttpOnly`-куку не видно и до, и после, так что
 * «исчезла» и «не видна» с той стороны неразличимы.
 *
 * ⚠️ Закрепляется свойство, а не число: у замка сверяется **порядок** событий, а не миллисекунды.
 * Уступка очереди задач внутри первого обработчика — это уступка, а не замер: без неё второй
 * обработчик не успел бы вклиниться, и проверка проходила бы независимо от замка.
 *
 * ⚠️ Имя ошибки нормативно, текст — нет. Здесь исключений не ловят вовсе: браузер на все три
 * «нельзя» отвечает молча — тем и опасны.
 *
 * Чего здесь нет намеренно:
 *   — **гонка обновления между вкладками**: для неё нужен сервер с одноразовым refresh.
 *     В теме она честно помечена непроверенной, и подделывать её нечем; проверен замок,
 *     которым она лечится. Что пометка осталась пометкой — отдельная проверка ниже;
 *   — **cross-site куки и `SameSite`**: нужны два сайта и живая сессия, в теме тоже помечены
 *     непроверенными;
 *   — **всё про JWT**: закрыто юнит-тестом.
 */
const PAGE = '/platform/security/';

/** Заголовки карточек `BLIND_SPOTS` — ключи, по которым проверки достают утверждение темы. */
const S = {
  read: 'Прочитать куку — нельзя',
  expired: 'Узнать, что кука истекла, — нельзя',
  remove: 'Удалить куку при выходе — нельзя',
  why: 'Почему так, а не «пока не сделали»',
  rest: 'Что остаётся: ответ и догадка',
} as const;

/** Текст карточки целиком — вместе с объяснением причины. */
function card(title: string): string {
  const found = BLIND_SPOTS.find((item) => item.t === title);
  if (!found) {
    throw new Error(
      `в BLIND_SPOTS нет карточки «${title}»: раздел переписали, а сторож остался прежним`,
    );
  }
  return found.d;
}

/**
 * Само утверждение — то, что тема обещает в ответ браузера.
 *
 * Пояснение вокруг значения сверять с движком нельзя: оно про причину, а не про ответ.
 * Поэтому у каждой проверки своя выкройка, и если формулировку перепишут так, что выкройка
 * перестанет подходить, сторож падает с внятной причиной, а не проходит на пустом месте.
 */
function claim(text: string, pattern: RegExp, what: string): string {
  const found = text.match(pattern);
  if (!found?.[1]) {
    throw new Error(
      `${what}: в тексте темы не нашлось утверждения по выкройке ${pattern}. ` +
        'Сторож читает ожидание отсюда — без него сверять не с чем.',
    );
  }
  return found[1];
}

/* ── Что тема утверждает про прогон ─────────────────────────────────────────────────────── */

/** Кука без `HttpOnly` и её значение: тема обещает, что `document.cookie` вернул ровно эту пару. */
const VISIBLE_PAIR = claim(card(S.read), /вернул ровно `([^`]+)`/, 'видимая кука');
const VISIBLE = {
  name: VISIBLE_PAIR.split('=')[0],
  value: VISIBLE_PAIR.slice(VISIBLE_PAIR.indexOf('=') + 1),
};

/** Кука с `HttpOnly` — та, которой фронт не видит вовсе. */
const SECRET = {
  name: claim(card(S.read), /`([^`]+)` с `HttpOnly`/, 'httpOnly-кука'),
  // Значение в теме не названо и названо быть не должно: его никто не видит. Оно нужно только
  // затем, чтобы проверить, что оно никуда не утекло.
  value: 'e2e-secret-session',
};

/** Строка «удаления» — из темы, дословно: демо и тест обязаны спрашивать движок одним кодом. */
const REMOVE_CODE = claim(card(S.remove), /Строка `([^`]+)`/, 'строка удаления');
const REMOVE_VALUE = claim(REMOVE_CODE, /document\.cookie\s*=\s*"([^"]+)"/, 'присваивание в куку');

/** Имя замка — из кода, который читатель видит на странице. */
const LOCK_NAME = claim(REFRESH_LOCK_CODE, /navigator\.locks\.request\('([^']+)'/, 'имя замка');

/** Порядок событий, который тема обещает от двух вызовов подряд. */
const LOCK_ORDER = claim(REFRESH_LOCK_NOTE, /дали порядок `([^`]+)`/, 'порядок в замке')
  .split('>')
  .map((step) => step.trim());

/** Что тема обещает от `navigator.locks` на непрозрачном источнике. */
const BLANK_LOCKS = claim(
  REFRESH_LOCK_NOTE,
  /`about:blank` `navigator\.locks` вообще `([^`]+)`/,
  'замок на about:blank',
);

/** Текст раздела 6 со страницы, со схлопнутыми пробелами. */
async function sectionText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const section = document.getElementById('s6');
    return (section?.textContent ?? '').replace(/\s+/g, ' ');
  });
}

test.beforeEach(async ({ context, page, baseURL }) => {
  if (!baseURL) throw new Error('baseURL не задан: куку некуда положить');

  // Ровно те две куки, что названы в прогоне темы. Секретная — с `HttpOnly`, обычная — со
  // сроком: раздел утверждает, что `cookieStore` срок у неё показывает.
  await context.addCookies([
    { name: SECRET.name, value: SECRET.value, url: baseURL, httpOnly: true },
    {
      name: VISIBLE.name,
      value: VISIBLE.value,
      url: baseURL,
      httpOnly: false,
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ]);

  await page.goto(PAGE);
});

/**
 * Сторож сторожа: набор карточек закреплён целиком.
 *
 * Без этого раздел тихо растёт мимо проверок — новое «нельзя» просто не будет никем спрошено,
 * а прогон останется зелёным. Красный тест здесь значит «допишите проверку», а не «откатите
 * данные».
 */
test('набор карточек BLIND_SPOTS не менялся мимо сторожа', () => {
  expect(
    BLIND_SPOTS.map((item) => item.t),
    'в BLIND_SPOTS изменился набор карточек: допишите проверку на новую — иначе снятое ' +
      'прогоном утверждение снова останется без сторожа',
  ).toEqual(Object.values(S));
});

/**
 * Ядро раздела: `HttpOnly`-куки нет в `document.cookie` **как пары**, а не как пустого значения.
 *
 * Разница не косметическая: код, который отличает «нет сессии» от «сессия есть, значение скрыто»
 * по пустой строке, ошибается молча — различать там нечего.
 */
test('document.cookie не отдаёт httpOnly-куку: её нет как пары', async ({ page }) => {
  const seen = await page.evaluate(() => document.cookie);
  const names = seen
    .split(';')
    .map((pair) => pair.trim().split('=')[0])
    .filter(Boolean);

  expect(names, 'обычная кука пропала из document.cookie — проверка ниже ничего не доказывает').toContain(
    VISIBLE.name,
  );
  expect(
    names,
    `имя «${SECRET.name}» видно из JS: HttpOnly перестал прятать куку от рендерера`,
  ).not.toContain(SECRET.name);
  expect(seen, 'значение httpOnly-куки утекло в document.cookie').not.toContain(SECRET.value);

  expect(seen, 'тема обещает не то, что ответил браузер').toBe(VISIBLE_PAIR);
  expect(
    card(S.read),
    'из карточки пропало «отсутствие самой пары» — а весь смысл в том, что это не пустое значение',
  ).toContain('отсутствие самой пары');
});

/**
 * `cookieStore` — более новый API, и он ничего не меняет: те же видимые куки, только со сроком.
 *
 * Проверяется и то, что срок у видимой куки действительно есть: без него утверждение темы
 * «срок показывает, но лишь для видимых» проверено наполовину.
 */
test('cookieStore.getAll() не видит httpOnly-куку', async ({ page }) => {
  const told = {
    visible: claim(card(S.expired), /вернул один `([^`]+)`/, 'видимая кука в cookieStore'),
    hidden: claim(card(S.expired), /\*\*не вернул\*\* `([^`]+)`/, 'скрытая кука в cookieStore'),
  };

  const seen = await page.evaluate(async (name: string) => {
    if (typeof cookieStore === 'undefined') {
      return { has: false, names: [] as string[], expires: null as number | null };
    }
    // ⚠️ Срок приходится доставать через приведение: в `lib.dom` у `CookieListItem` поля
    // `expires` нет, хотя браузер его возвращает — типы отстают от API. Приведение узкое
    // и только здесь; сам ответ ниже проверяется как значение, а не как тип.
    const all = (await cookieStore.getAll()) as unknown as {
      name: string;
      expires: number | null;
    }[];
    return {
      has: true,
      names: all.map((item) => item.name),
      expires: all.find((item) => item.name === name)?.expires ?? null,
    };
  }, VISIBLE.name);

  expect(
    seen.has,
    'cookieStore в браузере отсутствует — а раздел ссылается на его ответ как на снятый',
  ).toBe(true);
  expect(seen.names, 'видимая кука пропала и из cookieStore').toContain(told.visible);
  expect(
    seen.names,
    `«${told.hidden}» видна через cookieStore: HttpOnly перестал прятать куку от рендерера`,
  ).not.toContain(told.hidden);
  expect(
    typeof seen.expires,
    'у видимой куки нет срока — тогда фраза «cookieStore срок показывает» ничем не подтверждена',
  ).toBe('number');

  // Имена в карточке и в прогоне обязаны совпадать: иначе сверяются разные куки.
  expect(told.visible, 'карточки раздела разошлись в имени видимой куки').toBe(VISIBLE.name);
  expect(told.hidden, 'карточки раздела разошлись в имени httpOnly-куки').toBe(SECRET.name);
});

/**
 * «Кнопка выйти», не сходившая на сервер, никого не вывела.
 *
 * Страница выполняет **ту самую строку из темы**, а список кук спрашивается у Playwright —
 * снаружи страницы. Изнутри проверять нечем: `HttpOnly`-куку не видно ни до, ни после, и
 * «удалилась» от «не видна» там не отличить.
 *
 * Рядом — контроль: та же строка для обычной куки срабатывает. Без него проверка доказывала бы
 * только то, что строка вообще ничего не делает.
 */
test('document.cookie с Max-Age=0 httpOnly-куку не удаляет', async ({ page, context }) => {
  expect(REMOVE_CODE, 'строка удаления в теме перестала быть присваиванием в document.cookie').toContain(
    'document.cookie',
  );
  expect(REMOVE_VALUE, 'строка удаления в теме гасит не ту куку').toContain(`${SECRET.name}=`);

  await page.evaluate((value: string) => {
    document.cookie = value;
  }, REMOVE_VALUE);

  // Контроль: тем же способом гасим обычную куку.
  await page.evaluate((value: string) => {
    document.cookie = value;
  }, REMOVE_VALUE.replace(`${SECRET.name}=`, `${VISIBLE.name}=`));

  const after = await context.cookies();
  const secret = after.find((item) => item.name === SECRET.name);

  expect(secret, 'httpOnly-кука исчезла после записи в document.cookie — раздел обещает обратное')
    .toBeDefined();
  expect(secret?.value, 'значение httpOnly-куки переписали из JS').toBe(SECRET.value);
  expect(secret?.httpOnly, 'кука осталась, но потеряла HttpOnly').toBe(true);

  expect(
    after.map((item) => item.name),
    'обычная кука пережила ту же строку — значит проверка выше ничего не доказывает: ' +
      'не работает сам способ, а не запрет на HttpOnly',
  ).not.toContain(VISIBLE.name);
});

/**
 * Замок — единственное место раздела, где гонка снимается, и проверяется он свойством:
 * второй обработчик не начинается, пока не дорезолвился промис первого.
 *
 * ⚠️ Никаких длительностей: `setTimeout(…, 0)` здесь — уступка очереди задач, а не замер.
 * Без неё второй обработчик просто не успел бы вклиниться, и проверка была бы зелёной
 * независимо от того, работает замок или нет.
 */
test('navigator.locks сериализует два обработчика с одним именем', async ({ page }) => {
  const kind = await page.evaluate(() => typeof navigator.locks);

  // ⚠️ Замку нужен защищённый контекст. `http://localhost` им является по спецификации, но если
  // API вдруг не оказалось — проверка честно пропускается: подделывать очередь заглушкой значит
  // проверять заглушку.
  test.skip(
    kind !== 'object',
    `navigator.locks недоступен (typeof === ${kind}): очередь замка проверить нечем, ` +
      'а подделывать её заглушкой нельзя',
  );

  const order = await page.evaluate(async (name: string) => {
    const seen: string[] = [];

    const first = navigator.locks.request(name, async () => {
      seen.push('A-start');
      // Уступка очереди задач, а не замер длительности.
      await new Promise((resolve) => setTimeout(resolve, 0));
      seen.push('A-end');
    });
    const second = navigator.locks.request(name, async () => {
      seen.push('B-start');
      seen.push('B-end');
    });

    await Promise.all([first, second]);
    return seen;
  }, LOCK_NAME);

  // Свойство, ради которого замок и стоит в коде темы: никакого перехлёста.
  expect(
    order.indexOf('A-end'),
    `обработчики перехлестнулись: ${order.join(' > ')} — замок не сериализует`,
  ).toBeLessThan(order.indexOf('B-start'));
  expect(order, 'тема обещает не тот порядок, который дал браузер').toEqual(LOCK_ORDER);

  expect(
    REFRESH_LOCK_NOTE,
    `в разборе не названо имя замка «${LOCK_NAME}» из кода: код и текст разошлись`,
  ).toContain(LOCK_NAME);
});

/**
 * Замок принадлежит источнику, а у непрозрачного источника его нет вовсе.
 *
 * Строка в теме появилась из ошибки прогона — проверка сперва была запущена на пустой странице.
 * Здесь она закреплена: `about:blank` — это тот самый непрозрачный origin из раздела 1.
 */
test('navigator.locks отсутствует на непрозрачном источнике', async ({ context }) => {
  const blank = await context.newPage(); // новая страница стартует на about:blank
  const seen = await blank.evaluate(() => ({
    url: location.href,
    kind: typeof navigator.locks,
  }));
  await blank.close();

  expect(seen.url, 'проба ушла не на about:blank — проверялся не тот источник').toBe('about:blank');
  expect(
    seen.kind,
    'на непрозрачном источнике замок появился — тема обещает обратное',
  ).toBe(BLANK_LOCKS);
});

/**
 * Раздел обязан подавать три «нельзя» как **снятые прогоном**, а не как общее знание, —
 * и обязан сохранять пометки на непроверенном.
 *
 * Тихо повысить статус гонки вкладок и cross-site кук до «проверено» нельзя: ни того, ни другого
 * этот прогон не проверяет и проверить не может.
 */
test('раздел 6 подаёт «нельзя» как снятое и не повышает статус непроверенного', async ({
  page,
}) => {
  const text = await sectionText(page);

  expect(text, 'на странице нет раздела s6 «Куки и JWT глазами фронтендера»').not.toBe('');
  expect(
    text,
    'из раздела пропала оговорка о том, что три «нельзя» сняты прогоном: без неё они читаются ' +
      'как пересказ спецификации',
  ).toContain('сняты прогоном');
  expect(text, 'из раздела пропала версия браузера, на которой снят прогон').toMatch(
    /Chromium \d+(\.\d+)*/,
  );

  const unverified = BLIND_SPOT_RUN.split('осталось непроверенным')[1] ?? '';
  expect(
    unverified,
    'из раздела пропал перечень непроверенного — а он единственное, что отделяет снятое от снятого наполовину',
  ).not.toBe('');
  expect(
    unverified,
    'гонка обновления между вкладками выпала из непроверенного: её никто не проверял — ' +
      'ни этот прогон, ни какой-либо другой (нужен сервер с одноразовым refresh)',
  ).toContain('гонка обновления между вкладками');
  expect(
    unverified,
    'cross-site куки выпали из непроверенного: для них нужны два сайта и живая сессия',
  ).toContain('cross-site');
  expect(text, 'перечень непроверенного не доехал до страницы').toContain('осталось непроверенным');
});

/**
 * Сторожим то, что видит читатель, а не мёртвый экспорт: каждая карточка обязана быть в разделе.
 */
test('карточки BLIND_SPOTS действительно на странице', async ({ page }) => {
  const text = await sectionText(page);
  const missing = BLIND_SPOTS.map((item) => item.t).filter((title) => !text.includes(title));

  expect(missing, `карточки из BLIND_SPOTS не найдены в разделе 6: ${missing.join(', ')}`).toEqual(
    [],
  );
});
