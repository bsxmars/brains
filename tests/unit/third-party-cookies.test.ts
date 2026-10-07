import { describe, expect, it } from 'vitest';
import {
  ENGINES,
  decide,
  sameCase,
  setCookieLine,
  type Engine,
  type EngineId,
} from '../../src/widgets/tpc-cookie-verdict/model/verdict';
import { SAA_CODE, VERDICT_MEASURED } from '../../src/content/platform/third-party-cookies/data';

/**
 * Тема «Встроенный контент без сторонних кук».
 *
 * Главная проверка — **модель против стенда**. `VERDICT_MEASURED` — 27 комбинаций куки
 * и запроса, снятых в Chromium 153 (два режима), Firefox 155 и WebKit 26.6 на стенде из разных
 * сайтов (`top.test`, `top2.test`, `embed.test`; скрипты описаны в шапке `data.ts`). Функция
 * `decide` — то, что считает демо в браузере читателя. Разошлись хотя бы в одной ячейке —
 * значит демо говорит читателю не то, что делает браузер.
 *
 * Сама таблица браузером здесь не пересобирается: в Node нет ни кук, ни фреймов. Её сторожит
 * вторая половина — проверка, что **каждый признак профиля движка держится хотя бы одной
 * строкой**. Иначе можно было бы «упростить» профиль (скажем, объявить `SameSite` по умолчанию
 * одинаковым везде), и тест остался бы зелёным — строки, которая это опровергает, в таблице
 * просто не было бы.
 */

const ENGINE_IDS = ENGINES.map((e) => e.id);

describe('decide против таблицы стенда', () => {
  it('в таблице 27 строк, id и комбинации не повторяются', () => {
    expect(VERDICT_MEASURED).toHaveLength(27);
    expect(new Set(VERDICT_MEASURED.map((r) => r.id)).size).toBe(VERDICT_MEASURED.length);
    const dupes = VERDICT_MEASURED.filter((a, i) => VERDICT_MEASURED.some((b, j) => j < i && sameCase(a, b)));
    expect(dupes.map((r) => r.id), 'одна и та же комбинация записана дважды').toEqual([]);
  });

  it('у каждой строки есть ответ всех четырёх режимов', () => {
    for (const row of VERDICT_MEASURED) expect(Object.keys(row.got).sort()).toEqual([...ENGINE_IDS].sort());
  });

  describe.each(VERDICT_MEASURED)('$id', (row) => {
    it.each(ENGINE_IDS)('%s', (engine) => {
      const verdict = decide(engine, row.cookie, row.request);
      expect(
        verdict.outcome,
        `${row.id} в ${engine}: стенд — ${row.got[engine]}, модель — ${verdict.outcome}. Шаги модели: ${verdict.steps.join(' → ')}`,
      ).toBe(row.got[engine]);
    });
  });
});

describe('каждый признак профиля держится таблицей', () => {
  /** Подменить один признак у одного движка и посчитать, сколько строк таблицы разошлось. */
  function broken(engineId: EngineId, patch: Partial<Engine>): number {
    const engine = ENGINES.find((e) => e.id === engineId)!;
    const saved = { ...engine };
    Object.assign(engine, patch);
    try {
      return VERDICT_MEASURED.filter((row) => decide(engineId, row.cookie, row.request).outcome !== row.got[engineId]).length;
    } finally {
      Object.assign(engine, saved);
    }
  }

  const FLIPS: [EngineId, Partial<Engine>, string][] = [
    ['chromium', { unsetSameSite: 'None' }, 'Chromium: умолчание SameSite — Lax'],
    ['firefox', { unsetSameSite: 'Lax' }, 'Firefox: умолчание SameSite — None'],
    ['webkit', { unsetSameSite: 'Lax' }, 'WebKit: умолчание SameSite — None'],
    ['webkit', { noneNeedsSecure: true }, 'WebKit принимает None без Secure'],
    ['firefox', { noneNeedsSecure: false }, 'Firefox отвергает None без Secure'],
    ['chromium', { thirdParty: 'block' }, 'Chromium по умолчанию отдаёт стороннюю куку'],
    ['chromium-restricted', { thirdParty: 'allow' }, 'ограниченный Chromium её не отдаёт'],
    ['firefox', { thirdParty: 'block' }, 'Firefox кладёт стороннюю куку в раздел, а не отвергает'],
    ['webkit', { thirdParty: 'partition' }, 'WebKit стороннюю неразделённую куку отвергает'],
  ];

  it.each(FLIPS)('%s %o — %s', (engine, patch) => {
    expect(broken(engine, patch), 'признак можно поменять, и ни одна строка стенда этого не заметит').toBeGreaterThan(0);
  });
});

describe('ключ раздела', () => {
  const chip = VERDICT_MEASURED.find((r) => r.id === 'chip-same-top')!;
  const u3p = VERDICT_MEASURED.find((r) => r.id === 'u3p-iframe')!;

  it('Partitioned из фрейма под top.test — раздел https://top.test во всех движках', () => {
    for (const engine of ENGINE_IDS) expect(decide(engine, chip.cookie, chip.request).partitionKey).toBe('https://top.test');
  });

  it('без Partitioned: Chromium — общая кука, Firefox — сам кладёт в раздел', () => {
    expect(decide('chromium', u3p.cookie, u3p.request).partitionKey).toBeNull();
    expect(decide('firefox', u3p.cookie, u3p.request).partitionKey).toBe('https://top.test');
  });
});

describe('setCookieLine печатает то, что выбрано', () => {
  it('все атрибуты', () => {
    expect(setCookieLine({ sameSite: 'None', secure: true, partitioned: true, domain: 'site', setIn: 'top.test' })).toBe(
      'Set-Cookie: widget=1; Domain=embed.test; SameSite=None; Secure; Partitioned; Path=/',
    );
  });
  it('без SameSite атрибута нет вовсе', () => {
    expect(setCookieLine({ sameSite: 'unset', secure: true, partitioned: false, domain: 'host', setIn: 'first-party' })).toBe(
      'Set-Cookie: widget=1; Secure; Path=/',
    );
  });
});

/**
 * `SAA_CODE` — строка, которую тема печатает и которую стенд (`probe-saa-code.mjs`) исполнял
 * во фрейме трёх движков. Здесь та же строка исполняется ещё раз — на поддельном документе,
 * и проверяется то, ради чего она так написана: `requestStorageAccess()` зовётся **синхронно
 * в обработчике клика**. На стенде `await document.hasStorageAccess()` перед вызовом стоил
 * WebKit жеста — `NotAllowedError` два прогона из двух.
 */
describe('SAA_CODE: запрос доступа — первой строкой обработчика', () => {
  function harness(opts: { has: boolean; grant: boolean }) {
    const trace: string[] = [];
    let inClick = false;
    let clickHandler: (() => unknown) | null = null;
    const status = { textContent: '' };
    const button = {
      addEventListener: (type: string, fn: () => unknown) => {
        if (type === 'click') clickHandler = fn;
      },
    };
    const document = {
      querySelector: (sel: string) => (sel === '#open-chat' ? button : sel === '#status' ? status : null),
      hasStorageAccess: () => {
        trace.push('has');
        return Promise.resolve(opts.has);
      },
      requestStorageAccess: () => {
        trace.push(inClick ? 'request:sync-in-click' : 'request:outside-click');
        return opts.grant ? Promise.resolve() : Promise.reject(new DOMException('no', 'NotAllowedError'));
      },
    };
    const fetch = (url: string, init: { credentials: string }) => {
      trace.push(`fetch ${url} ${init.credentials}`);
      return Promise.resolve({ text: () => Promise.resolve('none=1') });
    };
    new Function('document', 'fetch', SAA_CODE)(document, fetch);
    const click = async () => {
      inClick = true;
      clickHandler!();
      inClick = false;
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    return { trace, status, click };
  }

  it('без доступа: клик зовёт requestStorageAccess синхронно, отказ печатает запасной путь', async () => {
    const h = harness({ has: false, grant: false });
    await Promise.resolve();
    await h.click();
    expect(h.trace).toContain('request:sync-in-click');
    expect(h.trace).not.toContain('request:outside-click');
    expect(h.status.textContent).toBe('нужен вход во всплывающем окне');
  });

  it('с доступом после клика: fetch с credentials и ответ сервера в статусе', async () => {
    const h = harness({ has: false, grant: true });
    await h.click();
    expect(h.trace).toContain('fetch /me include');
    expect(h.status.textContent).toBe('none=1');
  });

  it('доступ уже есть при загрузке — данные без клика', async () => {
    const h = harness({ has: true, grant: true });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(h.trace).toEqual(['has', 'fetch /me include']);
    expect(h.status.textContent).toBe('none=1');
  });
});
