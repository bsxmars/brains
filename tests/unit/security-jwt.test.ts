import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AUTH_SCHEME_CODE,
  BLIND_SPOTS,
  BLIND_SPOT_RUN,
  EXP_NOTE,
  JWT_ANATOMY_CODE,
  JWT_PARTS,
  JWT_READ_CODE,
  JWT_READ_TRAPS,
  JWT_RUN_NOTE,
  JWT_SIGNATURE_NOTE,
  REFRESH_LOCK_CODE,
  REFRESH_LOCK_NOTE,
  REFRESH_RACE_STEPS,
  TOKEN_PAIR_ROWS,
} from '@/content/platform/security/data';

/**
 * Раздел «Куки и JWT глазами фронтендера» — запуском, а не по памяти.
 *
 * Весь раздел набран с пометками «проверено запуском»: разбор настоящего токена, две ловушки
 * `atob`, подпись на двух ключах, `exp` в секундах. Каждая такая пометка — разовая ручная
 * сверка, которую `npm test` не повторял, и разойтись с движком она могла молча. Здесь
 * ожидания не переписаны в тест руками, а **вынуты из литералов `data.ts`** и сверены
 * с настоящим выполнением: разбирается тот токен, что напечатан в теме; листинг `readPayload`
 * исполняется прямо из `JWT_READ_CODE`; сравнения `exp` вычисляются из текста `EXP_NOTE`;
 * листинг замка исполняется прямо из `REFRESH_LOCK_CODE`. Падение означает ровно одно:
 * на странице написана неправда.
 *
 * ⚠️ Браузерная половина раздела сюда намеренно не попала, и подделывать её заглушкой нельзя:
 * слепота к `HttpOnly`, `cookieStore`, `navigator.locks` — это браузер, а не Node. Тема
 * ссылается на прогон в Chromium 153 через Playwright, и место таким проверкам — в e2e.
 * Сама гонка вкладок не проверяется нигде: для неё нужен сервер с одноразовым refresh,
 * и тема честно помечает её непроверенной. Кросс-сайтовые куки — там же.
 *
 * ⚠️ Две находки прогона записаны здесь как есть, данные темы не правились:
 *   1. литерал мусора в `JWT_READ_TRAPS` потерял невидимые управляющие байты C1 —
 *      см. «мусор в теме совпадает с настоящим»;
 *   2. `JWT_RUN_NOTE` обещает, что лишние `=` «ничего не ломают», а один лишний `=`
 *      в Node 26.8 бросает — см. «паддинг».
 */

// ── инструменты ───────────────────────────────────────────────────────────────────────────

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const sign = (data: string, key: string): string =>
  createHmac('sha256', key).update(data).digest('base64url');

/** Вытащить литерал из текста темы. Пропажа литерала — обрыв связи с данными, а не пустяк. */
function must(match: RegExpMatchArray | null, what: string): RegExpMatchArray {
  if (!match) throw new Error(`в data.ts не нашлось ${what} — тест потерял связь с темой`);
  return match;
}

/**
 * Управляющие байты C1 (0x80–0x9F). Печатного вида у них нет, поэтому диапазон записан
 * escape-последовательностями: литеральные символы теряются при любом копировании —
 * ровно так они и пропали из `data.ts`, см. «мусор в теме совпадает с настоящим».
 */
const C1 = /[\u0080-\u009F]/;

/** Поймать брошенное, не теряя объект ошибки: имя нам нужно, текст — нет. */
function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('вызов не бросил, хотя обязан был');
}

/** Настоящий токен из `JWT_ANATOMY_CODE`: берём его из темы, а не переписываем в тест. */
const [HEADER, PAYLOAD, SIGNATURE] = JWT_ANATOMY_CODE.split('\n')[0].trim().split(/\s*\.\s*/);

/** Строка `→ {…}` из того же блока — обещанный темой результат `atob`. */
const PROMISED_JSON = must(JWT_ANATOMY_CODE.match(/→\s*(\{.*\})/), 'строки с обещанным разбором')[1];

/** Ловушки темы — по смыслу, а не по индексу: порядок в массиве меняется легче, чем текст. */
const TRAP_B64URL = JWT_READ_TRAPS.find((t) => t.includes('base64url'));
const TRAP_BYTES = JWT_READ_TRAPS.find((t) => t.includes('байты'));

/** `scope`, дающий `-` в base64url. Взят из текста ловушки, а не выдуман тестом. */
const SCOPE = must(TRAP_B64URL?.match(/`scope: "([^"]+)"`/) ?? null, 'примера со `scope`')[1];

/** Листинг `readPayload` исполняется прямо из данных — как `runListing` в «Колбэках». */
const readPayload = new Function(`${JWT_READ_CODE}\nreturn readPayload;`)() as (
  token: string,
) => Record<string, unknown>;

// ── 1. Разбор токена: ядро раздела ────────────────────────────────────────────────────────

describe('разбор токена — то, что читатель повторит в консоли', () => {
  it('токен из темы состоит ровно из трёх частей через точку', () => {
    expect(JWT_ANATOMY_CODE.split('\n')[0].trim().split(/\s*\.\s*/)).toHaveLength(3);
    expect(HEADER.length, 'заголовок пуст').toBeGreaterThan(0);
    expect(PAYLOAD.length, 'нагрузка пуста').toBeGreaterThan(0);
    expect(SIGNATURE.length, 'подпись пуста').toBeGreaterThan(0);
  });

  it('`atob` средней части даёт ровно тот JSON, что обещан в теме', () => {
    // Обещание взято из самого блока — строка после стрелки. Разойдись они, покраснеет тест.
    expect(atob(PAYLOAD)).toBe(PROMISED_JSON);
  });

  it('разобранная нагрузка — читаемый объект, а не набор байтов', () => {
    const payload = JSON.parse(atob(PAYLOAD)) as Record<string, unknown>;
    expect(payload.role, 'в теме показан токен с ролью').toBe('admin');
    expect(typeof payload.exp).toBe('number');
    // NumericDate — секунды: живи там миллисекунды, число было бы на три порядка длиннее.
    expect(payload.exp as number).toBeLessThan(1e11);
  });

  it('заголовок разбирается тем же `atob` и объявляет HS256', () => {
    expect(JSON.parse(atob(HEADER))).toEqual({ alg: 'HS256', typ: 'JWT' });
  });

  it('подпись считается по «первая часть плюс точка плюс вторая» — это проверяемо', () => {
    // Утверждение `JWT_PARTS[0]` и комментарий к `JWT_ANATOMY_CODE`: HS256, ключ `secret`.
    expect(sign(`${HEADER}.${PAYLOAD}`, 'secret')).toBe(SIGNATURE);
  });

  it('части — `base64url`: ни `+`, ни `/`, ни паддинга', () => {
    expect(
      /[+/=]/.test(HEADER + PAYLOAD + SIGNATURE),
      'в токене нашёлся символ обычного base64',
    ).toBe(false);
    // И алфавит base64url в токене действительно задействован — иначе разница была бы теорией.
    expect(/[-_]/.test(SIGNATURE), 'в подписи нет ни `-`, ни `_`').toBe(true);
  });
});

// ── 2. Главная ловушка: base64url ≠ base64 ────────────────────────────────────────────────

describe('`atob` не понимает `base64url` — главная ловушка раздела', () => {
  const part = b64url(JSON.stringify({ sub: '1', scope: SCOPE }));

  it('обе ловушки темы на месте', () => {
    expect(JWT_READ_TRAPS).toHaveLength(2);
    expect(TRAP_B64URL, 'ловушки про base64url нет').toBeDefined();
    expect(TRAP_BYTES, 'ловушки про байты нет').toBeDefined();
  });

  it('нагрузка со `scope` из темы кодируется в строку с `-` внутри', () => {
    expect(part.includes('-'), `в ${part} нет дефиса — пример перестал показывать ловушку`).toBe(
      true,
    );
  });

  it('штатный `atob` на ней бросает — имя ошибки нормативно, текст нет', () => {
    const error = caught(() => atob(part));
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('InvalidCharacterError');
    // Текст сообщения сознательно не закреплён: в теме он разный для Chromium и Node,
    // и это нормально — нормативно имя.
  });

  it('замена `-`/`_` на `+`/`/` чинит разбор', () => {
    const fixed = part.replace(/-/g, '+').replace(/_/g, '/');
    expect(JSON.parse(atob(fixed))).toEqual({ sub: '1', scope: SCOPE });
  });

  it('`_` ломает разбор так же, как `-`', () => {
    // Ловушка тихая именно потому, что оба символа появляются лишь при определённых байтах.
    const underscored = Buffer.from([0xff, 0xff, 0xfe]).toString('base64url');
    expect(underscored.includes('_')).toBe(true);
    expect((caught(() => atob(underscored)) as DOMException).name).toBe('InvalidCharacterError');
  });
});

// ── 3. Вторая ловушка: байты вместо текста ────────────────────────────────────────────────

describe('`atob` отдаёт байты, а не текст', () => {
  /** Обе строки — из текста ловушки: исходная нагрузка и обещанный мусор. */
  const literals = [...(TRAP_BYTES ?? '').matchAll(/`(\{"name":"[^`]*"\})`/g)].map((m) => m[1]);
  const source = literals[0];
  const promisedGarbage = literals[1];
  const raw = atob(b64url(source));

  it('в ловушке записаны обе строки — исходная и мусорная', () => {
    expect(literals, 'в тексте ловушки не две строки `{"name":…}`').toHaveLength(2);
    expect(source, 'исходная строка не кириллическая').toMatch(/[А-Яа-я]/);
  });

  it('кириллица после `atob` действительно превращается в `Ð`-последовательности', () => {
    expect(raw).not.toBe(source);
    expect(raw.includes('Ð'), 'мусор перестал быть похож на обещанный').toBe(true);
  });

  it('⚠️ мусор в теме совпадает с настоящим — до невидимых управляющих байтов', () => {
    // Находка прогона, данные не правились. Настоящий вывод `atob` содержит байты C1
    // (0x90, 0x9B, 0x81): они непечатаемые и при переносе в `data.ts` потерялись.
    // Видимая часть совпадает символ в символ — её и сверяем, а само расхождение
    // закреплено двумя утверждениями ниже, чтобы оно не забылось и не «починилось» молча.
    expect(C1.test(raw), 'в выводе `atob` пропали управляющие байты').toBe(true);
    expect(C1.test(promisedGarbage), 'литерал в теме обзавёлся байтами C1').toBe(false);
    expect(raw.replace(new RegExp(C1.source, 'g'), '')).toBe(promisedGarbage);
  });

  it('`TextDecoder` возвращает исходную строку — и только он', () => {
    const decoded = new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    expect(decoded).toBe(source);
  });
});

// ── 4. Листинг темы исполняется ───────────────────────────────────────────────────────────

describe('листинг `readPayload` из темы исполняется и чинит обе ловушки сразу', () => {
  it('разбирает настоящий токен в тот же JSON, что обещан в блоке анатомии', () => {
    expect(readPayload(`${HEADER}.${PAYLOAD}.${SIGNATURE}`)).toEqual(JSON.parse(PROMISED_JSON));
  });

  it('разбирает нагрузку, на которой штатный `atob` падает', () => {
    const payload = { name: 'Ада Лавлейс', scope: SCOPE };
    const token = `${HEADER}.${b64url(JSON.stringify(payload))}.${SIGNATURE}`;

    // Обе поправки листинга работают вместе: base64url чинится, UTF-8 не рассыпается.
    expect(readPayload(token)).toEqual(payload);
  });

  it('обе поправки в листинге на месте — и каждая названа', () => {
    expect(JWT_READ_CODE).toContain("replace(/-/g, '+')");
    expect(JWT_READ_CODE).toContain('TextDecoder');
  });
});

// ── 5. Паддинг ────────────────────────────────────────────────────────────────────────────

describe('паддинг дописывать не нужно', () => {
  it('средняя часть токена не кратна четырём и разбирается без единого `=`', () => {
    expect(PAYLOAD.length % 4, 'пример перестал показывать отсутствие паддинга').not.toBe(0);
    expect(() => atob(PAYLOAD)).not.toThrow();
  });

  it('тема действительно утверждает, что паддинг не нужен', () => {
    expect(JWT_RUN_NOTE).toMatch(/не нужно/);
  });

  it('⚠️ один лишний `=` разбор ломает, два — нет', () => {
    // Находка прогона, данные не правились: `JWT_RUN_NOTE` обещает, что лишние `=`
    // «ничего не ломают». В Node 26.8 это верно лишь для правильного паддинга: длина
    // части даёт остаток 2, поэтому `==` дополняет её до кратной четырём, а одиночный
    // `=` — нет, и `atob` бросает. Закрепляем поведение движка, а не формулировку темы.
    expect(PAYLOAD.length % 4).toBe(2);
    expect((caught(() => atob(`${PAYLOAD}=`)) as DOMException).name).toBe('InvalidCharacterError');
    expect(atob(`${PAYLOAD}==`)).toBe(atob(PAYLOAD));
  });
});

// ── 6. Подпись: почему её не проверяют на фронте ──────────────────────────────────────────

describe('подпись: проверить её на клиенте нечем', () => {
  it('одна и та же нагрузка на двух ключах даёт две разные подписи', () => {
    // Ровно то, что `JWT_SIGNATURE_NOTE` объявляет проверенным запуском.
    const body = `${HEADER}.${PAYLOAD}`;
    expect(sign(body, 'key-A')).not.toBe(sign(body, 'key-B'));
    // Длина одна и та же: отличить «не тот ключ» от «не тот размер» по виду нельзя.
    expect(sign(body, 'key-A')).toHaveLength(sign(body, 'key-B').length);
  });

  it('подделанная нагрузка из темы парсится на клиенте без единой жалобы', () => {
    const forgedJson = must(
      JWT_PARTS.map((p) => p.d)
        .join('\n')
        .match(/`(\{"sub":[^`]*"role":"admin"\})`/),
      'примера подделанной нагрузки',
    )[1];
    const token = `${HEADER}.${b64url(forgedJson)}.${SIGNATURE}`;

    // Клиент доволен…
    expect(readPayload(token)).toEqual(JSON.parse(forgedJson));
    expect(readPayload(token).role).toBe('admin');
    // …а подпись под этой нагрузкой уже не сходится: отказ придёт от сервера, не от фронта.
    expect(sign(`${HEADER}.${b64url(forgedJson)}`, 'secret')).not.toBe(SIGNATURE);
  });

  it('тема не обещает клиентской проверки подписи', () => {
    expect(JWT_SIGNATURE_NOTE).toMatch(/фронт не может/);
    expect(JWT_SIGNATURE_NOTE).toMatch(/[Кк]люч живёт на сервере/);
    expect(JWT_SIGNATURE_NOTE).toMatch(/не чтобы разрешить/);
  });
});

// ── 7. `exp` — секунды, а не миллисекунды ─────────────────────────────────────────────────

describe('`exp` в секундах: обе половины классической ошибки', () => {
  /** Оба сравнения вынуты из текста `EXP_NOTE` и исполняются — не переписаны в тест. */
  const comparisons = [...EXP_NOTE.matchAll(/`(payload\.exp[^`]*Date\.now\(\))`/g)].map((m) => m[1]);

  it('в теме записаны ровно два сравнения, наивное перед верным', () => {
    expect(comparisons, 'сравнений в `EXP_NOTE` не два').toHaveLength(2);
    expect(comparisons[0]).not.toContain('* 1000');
    expect(comparisons[1]).toContain('* 1000');
    expect(EXP_NOTE.indexOf('`false`'), 'порядок обещаний перевернулся').toBeLessThan(
      EXP_NOTE.indexOf('`true`'),
    );
  });

  it('на заведомо живом токене наивное сравнение даёт `false`, верное — `true`', () => {
    const payload = { exp: Math.floor(Date.now() / 1000) + 600 };
    const evaluate = (expr: string): boolean =>
      (new Function('payload', `return ${expr};`) as (p: typeof payload) => boolean)(payload);

    expect(evaluate(comparisons[0]), 'наивное сравнение вдруг стало верным').toBe(false);
    expect(evaluate(comparisons[1]), 'верное сравнение вдруг сломалось').toBe(true);
  });

  it('тема оставляет решение «токен истёк» за сервером', () => {
    expect(EXP_NOTE).toMatch(/принимает сервер/);
    expect(EXP_NOTE).toMatch(/удобство, а не безопасность/);
  });
});

// ── 8. Данные не расходятся с утверждениями ───────────────────────────────────────────────

describe('данные раздела не расходятся с тем, что показывает движок', () => {
  it('`JWT_PARTS` описывает ровно три части, в порядке разбора токена', () => {
    expect(JWT_PARTS).toHaveLength(3);
    expect(JWT_PARTS[0].t, 'первое утверждение — про три части').toMatch(/[Тт]ри части/);
    expect(JWT_PARTS[1].t, 'второе — про нагрузку и `base64url`').toMatch(/base64url/);
    expect(JWT_PARTS[2].t, 'третье — про подпись').toMatch(/[Пп]одпись/);
    // И порядок совпадает с тем, что даёт разбор: заголовок, нагрузка, подпись.
    expect(JSON.parse(atob(HEADER))).toHaveProperty('alg');
    expect(JSON.parse(atob(PAYLOAD))).toHaveProperty('role');
    expect(() => JSON.parse(atob(SIGNATURE))).toThrow();
  });

  it('срок жизни access взят из схемы раздела 5, а не выдуман', () => {
    const scheme = must(
      AUTH_SCHEME_CODE.match(/TTL\s+(\d+–\d+)\s+минут/),
      'TTL в схеме раздела 5',
    )[1];
    const row = TOKEN_PAIR_ROWS.find((r) => r.k === 'Срок жизни');

    expect(row, 'строки «Срок жизни» в таблице нет').toBeDefined();
    expect(row!.access, `в таблице должен стоять тот же диапазон ${scheme}`).toContain(scheme);
  });

  it('у refresh назван порядок, а не выдуманное число', () => {
    const row = TOKEN_PAIR_ROWS.find((r) => r.k === 'Срок жизни')!;
    expect(row.refresh).toMatch(/[Пп]орядок, а не число/);
    // Ни одной цифры: любое конкретное число здесь было бы выдано за замер, которого не было.
    expect(/\d/.test(row.refresh), `в сроке refresh появилось число: ${row.refresh}`).toBe(false);
  });

  it('таблица пары токенов заполнена целиком', () => {
    expect(TOKEN_PAIR_ROWS.length).toBeGreaterThan(3);
    for (const row of TOKEN_PAIR_ROWS) {
      expect(row.access.length, `пустая ячейка access в «${row.k}»`).toBeGreaterThan(0);
      expect(row.refresh.length, `пустая ячейка refresh в «${row.k}»`).toBeGreaterThan(0);
    }
  });
});

// ── 9. Замок из темы: листинг, а не браузер ───────────────────────────────────────────────

/**
 * Здесь проверяется **логика листинга**, а не гарантия браузера.
 *
 * `navigator.locks` сериализует обработчики — это свойство платформы, и тема ссылается
 * на прогон в Chromium 153. Воспроизводить его в Node нечем и незачем. Но сам листинг
 * содержит нетривиальное место — повторную проверку внутри замка, — и вот она проверяема:
 * дайте листингу честно сериализующий замок, и второй вызов обязан **не ходить за токеном**.
 * Контрольный прогон ниже снимает эту строку и показывает, что без неё проверка краснеет.
 */
function serializingLocks(): {
  request: (name: string, fn: () => Promise<unknown>) => Promise<unknown>;
} {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request(name, fn) {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = previous.then(() => fn());
      tails.set(
        name,
        run.catch(() => undefined),
      );
      return run;
    },
  };
}

async function exerciseLock(listing: string): Promise<{ fetches: number; shared: boolean }> {
  let fetches = 0;
  const isFresh = (t: { fresh?: boolean } | undefined): boolean => Boolean(t?.fresh);
  const fetchStub = async (): Promise<{ json: () => Promise<unknown> }> => {
    fetches += 1;
    const id = fetches;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { json: async () => ({ id, fresh: true }) };
  };

  const build = new Function(
    'isFresh',
    'fetch',
    'navigator',
    'seed',
    `'use strict';\nlet token = seed;\n${listing}\nreturn getAccessToken;`,
  ) as (
    isFresh: unknown,
    fetch: unknown,
    navigator: unknown,
    seed: unknown,
  ) => () => Promise<unknown>;

  const getAccessToken = build(isFresh, fetchStub, { locks: serializingLocks() }, { fresh: false });
  const [first, second] = await Promise.all([getAccessToken(), getAccessToken()]);
  return { fetches, shared: first === second };
}

describe('замок из темы: листинг снимает двойное обновление', () => {
  it('два одновременных вызова дают ровно одно обращение к `/api/auth/refresh`', async () => {
    const { fetches, shared } = await exerciseLock(REFRESH_LOCK_CODE);
    expect(fetches, 'листинг сходил за токеном дважды').toBe(1);
    expect(shared, 'второй вызов не забрал чужой результат').toBe(true);
  });

  it('контроль: без повторной проверки внутри замка обращений становится два', async () => {
    const lines = REFRESH_LOCK_CODE.split('\n');
    const inner = lines.findIndex((line, i) => i > 2 && line.includes('isFresh(token)'));
    expect(inner, 'внутри замка нет повторной проверки — листинг потерял суть').toBeGreaterThan(2);

    const crippled = lines.filter((_, i) => i !== inner).join('\n');
    const { fetches } = await exerciseLock(crippled);
    // Если бы здесь тоже была единица, проверка выше не значила бы ничего.
    expect(fetches, 'проверка выше не умеет краснеть').toBe(2);
  });

  it('тема не выдаёт сериализацию замка за проверенную в Node', () => {
    expect(REFRESH_LOCK_NOTE).toMatch(/Chromium/);
    expect(REFRESH_LOCK_NOTE).toMatch(/Playwright/);
  });
});

// ── 10. Границы: что осталось непроверенным ───────────────────────────────────────────────

describe('границы раздела названы честно', () => {
  it('гонка вкладок и cross-site куки помечены непроверенными', () => {
    // Сторож против тихого повышения статуса: «проверено» без прогона — ровно то,
    // ради чего написан этот файл.
    expect(BLIND_SPOT_RUN).toMatch(/непроверенным/);
    expect(BLIND_SPOT_RUN).toMatch(/гонка обновления между вкладками/);
    expect(BLIND_SPOT_RUN).toMatch(/cross-site/);
  });

  it('браузерные «нельзя» названы прогоном в Chromium, а не выводом из спецификации', () => {
    expect(BLIND_SPOT_RUN).toMatch(/Chromium/);
    expect(BLIND_SPOT_RUN).toMatch(/Playwright/);
    expect(BLIND_SPOTS.length).toBeGreaterThan(3);
    expect(
      BLIND_SPOTS.filter((s) => s.t.includes('нельзя')).length,
      'трёх «нельзя» не стало',
    ).toBe(3);
  });

  it('шаги гонки перечислены полностью', () => {
    expect(REFRESH_RACE_STEPS).toHaveLength(6);
    for (const step of REFRESH_RACE_STEPS) expect(step.length).toBeGreaterThan(20);
  });
});
