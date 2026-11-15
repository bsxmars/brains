import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { buildRequest, compilePolicy } from '@/widgets/fetch-metadata-policy/model/policy';
import {
  HTTP_NOTE,
  BASELINE,
  CORP_NOTE,
  GLOSSARY,
  RIP_MIDDLEWARE_CODE,
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
 * прислал на стенде темы. Таблицы CORP/COOP/frame-ancestors остаются снимком исторического стенда.
 * Отдельный Chromium-контроль ниже повторяет Lax, SOP, CORP и HTTP loopback;
 * он не выдаётся за пересъёмку всей исторической таблицы.
 */
const policy = compilePolicy(RIP_CODE);

const req = (headers: Record<string, string>, method = 'GET', path = '/account') => ({ method, path, headers });
const meta = (site: string, mode: string, dest: string) => ({
  'sec-fetch-site': site,
  'sec-fetch-mode': mode,
  'sec-fetch-dest': dest,
});

describe('политика изоляции ресурсов: ветки', () => {
  it('без заголовков пропускает — ветка не доказывает доверие клиенту', () => {
    expect(policy(req({}))).toEqual({ allow: true, rule: 'no-metadata' });
    // Обычный HTTP на исторических .test хостах не давал metadata; loopback проверен ниже.
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


// Исполняется печатаемая обвязка node:http, а не её копия в тесте.
describe('Vary на обоих решениях middleware', () => {
  it.each([
    { site: 'same-origin', initial: 'Accept-Encoding', allowed: true },
    { site: 'cross-site', initial: ['Accept-Encoding', 'sec-fetch-site'], allowed: false },
    { site: 'same-origin', initial: '*', allowed: true },
  ])('$site, Vary=$initial', ({ site, initial, allowed }) => {
    const headers = new Map<string, string | string[]>([['Vary', initial]]);
    let status = 200;
    let appCalls = 0;
    let ended = false;
    const res = {
      getHeader: (name: string) => headers.get(name),
      setHeader: (name: string, value: string) => headers.set(name, value),
      writeHead: (value: number) => { status = value; },
      end: () => { ended = true; },
    };
    let request!: (req: object, res: object) => void;
    const server = { on: (_event: string, listener: typeof request) => { request = listener; } };
    const app = () => { appCalls++; };
    new Function('server', 'app', `${RIP_CODE}\n${RIP_MIDDLEWARE_CODE}`)(server, app);
    request({ url: '/avatar.png', method: 'GET', headers: meta(site, 'no-cors', 'image') }, res);
    expect(status).toBe(allowed ? 200 : 403);
    expect(appCalls).toBe(allowed ? 1 : 0);
    expect(ended).toBe(!allowed);
    const vary = String(headers.get('Vary'));
    if (initial === '*') expect(vary).toBe('*');
    else {
      const names = vary.toLowerCase().split(',').map((name) => name.trim());
      expect(names).toEqual(expect.arrayContaining(['accept-encoding', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest']));
      expect(names.filter((name) => name === 'sec-fetch-site')).toHaveLength(1);
    }
  });
});

it('Chromium: Lax, SOP, HTTP loopback и конечный ресурс после redirect', async () => {
  const seen: { path: string; cookie: string; site: string }[] = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/tQAAAAASUVORK5CYII=', 'base64');
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    seen.push({ path: url.pathname, cookie: req.headers.cookie ?? '', site: String(req.headers['sec-fetch-site'] ?? '') });
    if (url.pathname === '/redirect-html' || url.pathname === '/redirect-png') {
      res.writeHead(302, { Location: url.pathname === '/redirect-html' ? '/login' : '/public.png' });
      return res.end();
    }
    if (url.pathname.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
      if (url.pathname === '/private.png') res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      return res.end(png);
    }
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/framed') return res.end('<iframe></iframe><iframe></iframe>');
    if (url.pathname === '/launcher') return res.end('<a id="go">go</a>');
    res.end('<p>login or account</p>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const target = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([{ name: 'session', value: 'known', url: target, sameSite: 'Lax' }]);
    const page = await context.newPage();
    await page.goto(`http://localhost:${port}/launcher`);
    const images = await page.evaluate(async (origin) => {
      const result: Record<string, string> = {};
      for (const path of ['/plain.png', '/private.png', '/redirect-html', '/redirect-png']) {
        result[path] = await new Promise<string>((resolve) => {
          const img = new Image();
          img.onload = () => resolve('load');
          img.onerror = () => resolve('error');
          img.src = origin + path;
        });
      }
      return result;
    }, target);
    expect(images).toEqual({ '/plain.png': 'load', '/private.png': 'error', '/redirect-html': 'error', '/redirect-png': 'load' });
    const imageRequest = seen.find((request) => request.path === '/plain.png')!;
    expect(imageRequest.cookie).toBe('');
    expect(imageRequest.site).toBe('cross-site'); // HTTP loopback получает Fetch Metadata.
    const foreign = await page.evaluate(async (origin) => {
      const frame = document.createElement('iframe');
      const ready = new Promise<void>((resolve) => { frame.onload = () => resolve(); });
      frame.src = origin + '/framed';
      document.body.append(frame);
      await ready;
      let locationError = '';
      try { void frame.contentWindow!.location.href; }
      catch (error) { locationError = (error as DOMException).name; }
      return { length: frame.contentWindow!.length, locationError };
    }, target);
    expect(foreign).toEqual({ length: 2, locationError: 'SecurityError' });
    await page.locator('#go').evaluate((link, href) => link.setAttribute('href', href), target + '/navigation');
    await Promise.all([page.waitForURL(target + '/navigation'), page.locator('#go').click()]);
    expect(seen.find((request) => request.path === '/navigation')!.cookie).toBe('session=known');
    expect(BASELINE[0]).toContain('top-level GET');
    expect(GLOSSARY.find((term) => term.k === 'группа контекстов просмотра')!.d).toContain('location.href');
    expect(HTTP_NOTE).toContain('HTTP loopback');
    expect(CORP_NOTE).toContain('вся цепочка и конечный ресурс');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 30_000);
