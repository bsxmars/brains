import { describe, expect, it } from 'vitest';
import { buildRequest, compilePolicy } from '@/widgets/fetch-metadata-policy/model/policy';
import {
  HTTP_NOTE,
  PITFALLS,
  RIP_CODE,
  RIP_PRESETS,
  RIP_STAND,
  RULE_NOTES,
  SEC_FETCH_DECISIONS,
  SEC_FETCH_ROWS,
} from '@/content/platform/xs-leaks/data';

/**
 * Тема «XS-Leaks»: политика изоляции ресурсов исполняется здесь **той же строкой**, которую
 * печатает тема и компилирует демо (`RIP_CODE` → `compilePolicy`). Копии на TypeScript нет:
 * она проверяла бы саму себя.
 *
 * Запросы — поддельные объекты `{ method, path, headers }`, как их отдаёт `node:http`.
 * Заголовки для «настоящих» случаев взяты из `SEC_FETCH_ROWS` — это то, что Chromium 153
 * прислал на стенде темы. Браузерное поведение (CORP, COOP, `frame-ancestors`, отсутствие
 * `Sec-Fetch-*` на http) снято стендом и здесь не проверяется — в Node ему взяться неоткуда.
 */
const policy = compilePolicy(RIP_CODE);

const req = (headers: Record<string, string>, method = 'GET', path = '/account') => ({ method, path, headers });
const meta = (site: string, mode: string, dest: string) => ({
  'sec-fetch-site': site,
  'sec-fetch-mode': mode,
  'sec-fetch-dest': dest,
});

describe('политика изоляции ресурсов: ветки', () => {
  it('без заголовков пропускает — и это та самая дыра http', () => {
    expect(policy(req({}))).toEqual({ allow: true, rule: 'no-metadata' });
    // Тема обещает, что на http политика не отказывает никому: это следствие ветки (1).
    expect(HTTP_NOTE).toMatch(/пропускает всё/);
  });

  it.each(['same-origin', 'same-site', 'none'])('свой сайт (%s) пропускается в любом режиме', (site) => {
    for (const [mode, dest] of [['no-cors', 'image'], ['cors', 'empty'], ['navigate', 'document']]) {
      expect(policy(req(meta(site, mode, dest), 'POST'))).toEqual({ allow: true, rule: 'own-site' });
    }
  });

  it('чужой сайт: переход по GET пропускается, фрейм тоже', () => {
    expect(policy(req(meta('cross-site', 'navigate', 'document')))).toEqual({ allow: true, rule: 'navigation' });
    expect(policy(req(meta('cross-site', 'navigate', 'iframe')))).toEqual({ allow: true, rule: 'navigation' });
  });

  it('чужой сайт: POST-форма — навигация, но отказ', () => {
    expect(policy(req(meta('cross-site', 'navigate', 'document'), 'POST'))).toEqual({ allow: false, rule: 'cross-site' });
  });

  it.each(['object', 'embed'])('чужой сайт: навигация в <%s> не считается переходом', (dest) => {
    expect(policy(req(meta('cross-site', 'navigate', dest)))).toEqual({ allow: false, rule: 'cross-site' });
  });

  it('чужой сайт: картинка, скрипт и fetch — отказ, кроме открытых адресов', () => {
    for (const [mode, dest] of [['no-cors', 'image'], ['no-cors', 'script'], ['cors', 'empty'], ['no-cors', 'empty']]) {
      expect(policy(req(meta('cross-site', mode, dest)))).toEqual({ allow: false, rule: 'cross-site' });
      expect(policy(req(meta('cross-site', mode, dest), 'GET', '/embed/logo.png'))).toEqual({ allow: true, rule: 'public-path' });
    }
    // Префикс, а не подстрока: `/account/embed/` открытым не становится.
    expect(policy(req(meta('cross-site', 'no-cors', 'image'), 'GET', '/account/embed/x.png')).allow).toBe(false);
  });
});

describe('таблица, стенд и демо спрашивают один и тот же код', () => {
  it('колонка решений вычислена по каждой строке', () => {
    expect(SEC_FETCH_DECISIONS).toHaveLength(SEC_FETCH_ROWS.length);
    SEC_FETCH_ROWS.forEach((row, i) => {
      const got = policy(buildRequest(row.site, row.mode, row.dest, row.method, row.path));
      expect(SEC_FETCH_DECISIONS[i], row.k).toEqual(got);
    });
  });

  it('из запросов стенда отказ получили ровно чужие подгрузки и чужой POST', () => {
    const denied = SEC_FETCH_ROWS.filter((_, i) => !SEC_FETCH_DECISIONS[i].allow).map((r) => r.k);
    expect(denied).toEqual([
      '`<img>` на странице `b.test`',
      '`fetch` со страницы `b.test`',
      '`fetch` с `b.test`, `no-cors`',
      '`<script>` на странице `b.test`',
      'форма `POST` со страницы `b.test`',
    ]);
  });

  it('каждая ветка из RIP_STAND совпадает с тем, что решает код на тех же заголовках', () => {
    // Стенд: картинка с b.test — cross-site/no-cors/image; открытый адрес; ссылка; своя; http.
    const cases: Record<string, ReturnType<typeof req>> = {
      '`cross-site`': req(meta('cross-site', 'no-cors', 'image'), 'GET', '/avatar.png'),
      '`public-path`': req(meta('cross-site', 'no-cors', 'image'), 'GET', '/embed/logo.png'),
      '`navigation`': req(meta('cross-site', 'navigate', 'document')),
      '`own-site`': req(meta('same-origin', 'no-cors', 'image'), 'GET', '/avatar.png'),
      '`no-metadata`': req({}, 'GET', '/avatar.png'),
    };
    for (const row of RIP_STAND) {
      const probe = cases[row.rule];
      expect(probe, `нет пробы для ветки ${row.rule}`).toBeDefined();
      expect(`\`${policy(probe).rule}\``).toBe(row.rule);
      // «Загрузилась» и «открылась» — пропуск; «403» — отказ.
      expect(policy(probe).allow, row.k).toBe(!row.got.includes('403'));
    }
  });

  it('у каждой ветки есть подпись для демо, и отказ подписан как 403', () => {
    const rules = new Set([...SEC_FETCH_DECISIONS.map((d) => d.rule), 'no-metadata', 'public-path']);
    for (const rule of rules) expect(RULE_NOTES[rule], rule).toBeDefined();
    expect(RULE_NOTES['cross-site']).toMatch(/403/);
  });

  it('наборы демо строятся теми же функциями и все решаемы', () => {
    for (const p of RIP_PRESETS) {
      const d = policy(buildRequest(p.site, p.mode, p.dest, p.method, p.path));
      expect(RULE_NOTES[d.rule], p.label).toBeDefined();
    }
    // Набор «без заголовков» действительно без заголовков: buildRequest не подставляет пустые.
    const absent = RIP_PRESETS.find((p) => p.site === undefined)!;
    expect(buildRequest(absent.site, absent.mode, absent.dest, absent.method, absent.path).headers).toEqual({});
  });
});

describe('текст темы не расходится с политикой', () => {
  it('тонкое место про переходы: политика их действительно пропускает', () => {
    const pitfall = PITFALLS.find((p) => /пропускает переходы/.test(p.t));
    expect(pitfall, 'пропало тонкое место «политика пропускает переходы»').toBeDefined();
    expect(policy(req(meta('cross-site', 'navigate', 'document'))).allow).toBe(true);
  });

  it('тонкое место про same-site: поддомен политике «свой»', () => {
    expect(PITFALLS.some((p) => /same-site/.test(p.t))).toBe(true);
    expect(policy(req(meta('same-site', 'no-cors', 'image'))).allow).toBe(true);
  });

  it('строка политики обязана объявлять isolationPolicy', () => {
    expect(() => compilePolicy('function other() {}')).toThrow(/isolationPolicy/);
  });
});
