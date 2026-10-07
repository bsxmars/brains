import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/delivery/nginx-proxy/data';
import { loadLocationApi, loadServerApi } from '@/widgets/nginx-lab/model/run';

/**
 * Тема «Nginx как обратный прокси».
 *
 * `LOCATION_CODE`, `PROXY_CODE` и `SERVER_CODE` — строки из темы: напечатаны на странице
 * и исполняются демо. Здесь они прогоняются по журналам стенда — ответам настоящего nginx
 * 1.30.0 в Docker (как снято — шапка `data.ts`). На каждый адрес модель обязана назвать ту же
 * location, тот же путь у бэкенда и тот же редирект; на каждый `Host` — тот же server.
 *
 * Сам nginx тест не запускает: в окружении тестов Docker не гарантирован. Если поведение
 * nginx сменится, стенд нужно переснять и обновить журналы — тогда модель проверится заново.
 */

const loc = loadLocationApi(t.LOCATION_CODE, t.PROXY_CODE);
const srv = loadServerApi(t.SERVER_CODE);
const locs = loc.parseLocations(t.LOC_CONF);

describe('разбор конфига', () => {
  it('десять location в том же порядке, что на стенде', () => {
    expect(locs.map((l) => [l.text, l.pass])).toEqual([
      ['= /', 'http://backend'],
      ['/', 'http://backend'],
      ['/api/', 'http://backend/'],
      ['/api/v1/', 'http://backend/internal/v1/'],
      ['/v2', 'http://backend/'],
      ['/images/', 'http://backend/img'],
      ['^~ /static/', 'http://backend'],
      ['~ \\.json$', 'http://backend'],
      ['~ ^/api/v1/.+\\.json$', 'http://backend'],
      ['~* \\.(png|jpe?g)$', 'http://backend'],
    ]);
  });
});

describe('модель выбора location против журнала nginx 1.30', () => {
  for (const [name, journal] of [['LOC_JOURNAL', t.LOC_JOURNAL], ['NORM_JOURNAL', t.NORM_JOURNAL]] as const) {
    it(`${name}: location, путь у бэкенда и редирект — как у nginx (${journal.length} адресов)`, () => {
      for (const p of journal) {
        const found = loc.findLocation(locs, p.uri);
        expect(found.location?.text ?? null, p.uri).toBe(p.location);
        expect(loc.proxyPath(found, p.uri), p.uri).toBe(p.backend);
        if (p.status === 301) {
          // nginx пишет абсолютный адрес со своим портом; путь и аргументы — те же.
          expect(p.redirect, p.uri).toBe(`http://127.0.0.1:8080${found.redirect}`);
        } else {
          expect(found.redirect, p.uri).toBeNull();
        }
      }
    });
  }

  it('все адреса демо есть в журналах — под каждым стоит ответ стенда', () => {
    const known = new Set([...t.LOC_JOURNAL, ...t.NORM_JOURNAL].map((p) => p.uri));
    for (const g of t.PROBE_GROUPS) for (const u of g.uris) expect(known.has(u), u).toBe(true);
  });

  it('утверждения раздела о регулярках и префиксах', () => {
    // Регулярка перебивает префикс /images/, ^~ — защищает /static/.
    expect(loc.findLocation(locs, '/images/logo.png').by).toBe('regex');
    expect(loc.findLocation(locs, '/static/logo.png').by).toBe('^~');
    // Первая по порядку регулярка побеждает более «точную».
    const f = loc.findLocation(locs, '/api/v1/export.json');
    expect(f.regexes.map((r) => r.hit)).toEqual([true]);
    expect(f.longest?.text).toBe('/api/v1/');
    // Префикс сравнивается посимвольно: /v2beta — в location /v2.
    expect(loc.findLocation(locs, '/v2beta').location?.text).toBe('/v2');
    expect(t.LOC_NOTE).toContain('первая по порядку побеждает');
  });

  it('нормализация: %2F раскрывается до разбора «..»', () => {
    expect(loc.normalize('/api/a%2F..%2Fb').path).toBe('/api/b');
    expect(loc.normalize('/api//users').path).toBe('/api/users');
    expect(loc.normalize('/a/..').path).toBe('/');
    expect(t.NORM_NOTE).toContain('`/api/a%2F..%2Fb` доезжает как `/b`');
  });
});

describe('модель выбора server против журнала nginx 1.30', () => {
  const servers = srv.parseServers(t.SERVER_CONF);
  /** Что отвечает каждый server: текст из `return 200 "…"` или обрыв для `return 444`. */
  const answers = [...t.SERVER_CONF.matchAll(/server\s*\{([^}]*)\}/g)].map((m) => {
    const r = /return (\d+)(?: "([^"]*)")?;/.exec(m[1]);
    if (!r) throw new Error('server без return');
    return r[1] === '444' ? null : (r[2] ?? '').replace('\\n', '');
  });

  it(`каждый Host попал в тот же server (${t.SERVER_JOURNAL.length} запросов)`, () => {
    expect(servers).toHaveLength(8);
    for (const p of t.SERVER_JOURNAL) {
      const f = srv.findServer(servers, p.port, p.host);
      const a = answers[f.server.index];
      const expected = a === null ? 'закрыто без ответа' : a.replace('$branch', (p.host ?? '').split('.')[0]);
      expect(expected, `${p.port} ${p.host}`).toBe(p.answer);
    }
  });

  it('звёздочка nginx закрывает несколько меток, первый server — умолчание без default_server', () => {
    expect(srv.findServer(servers, 8081, 'a.b.shop.test').name).toBe('*.shop.test');
    expect(srv.findServer(servers, 8081, 'unknown.example').by).toBe('first');
    expect(srv.findServer(servers, 8082, 'unknown.example').by).toBe('default_server');
  });
});

describe('утверждения текста, которые проверяются без nginx', () => {
  it('`//users` в new URL читается как хост, а `//` бросает', () => {
    const u = new URL('//users', 'http://x');
    expect(u.host).toBe('users');
    expect(u.pathname).toBe('/');
    expect(() => new URL('//', 'http://x')).toThrow(TypeError);
    expect(t.DOUBLE_SLASH_NOTE).toContain("`new URL('//users', 'http://x').pathname` — это `/`");
  });

  it('gzip: тело стенда 2811 байт, уровень 1 даёт те же 458, что nginx', () => {
    // То же тело, что отдаёт бэкенд стенда на /json.
    const body = JSON.stringify({
      items: Array.from({ length: 60 }, (_, i) => ({ id: i, title: 'item number ' + i, price: 100 + i })),
    });
    expect(Buffer.byteLength(body)).toBe(2811);
    expect(gzipSync(body, { level: 1 }).length).toBe(458);
    expect(t.GZIP_ROWS.map((r) => r.bytes)).toEqual([2811, 458, 2811, 2811]);
    expect(t.GZIP_NOTE).toContain('2811 байт стали 458');
  });

  it('SSE: «пачка» — одно чтение после всех пяти событий', () => {
    for (const r of t.STREAM_ROWS) {
      for (const reads of [r.v130, r.v127]) {
        // Последнее чтение всегда после пятого события; «пачка» — это ровно [5].
        expect(reads.at(-1)).toBe(5);
        expect([...reads].sort((a, b) => a - b)).toEqual(reads);
      }
    }
    const def = t.STREAM_ROWS[0];
    expect(def.v127).toEqual([5]);
    expect(def.v130).toEqual([1, 2, 3, 4, 5]);
  });

  it('толпа: без блокировки 10 походов к бэкенду, с ней — 1', () => {
    expect(t.CROWD_ROWS.map((r) => r.origin)).toEqual([10, 1]);
  });
});
