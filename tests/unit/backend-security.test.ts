import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { join } from 'node:path';
import * as sqlite from 'node:sqlite';
import * as util from 'node:util';
import { describe, expect, it } from 'vitest';
// zod приходит в проект вместе с Astro и объявлен им как `astro/zod` — тот же пакет, что
// `import { z } from 'zod'` в тексте темы. Пропадёт — файл упадёт на импорте громко.
import * as zod from 'astro/zod';
import * as t from '@/content/platform/backend-security/data';
import { answerOf, decideCase, loadEgress, loadNaive, runNaive } from '@/widgets/bs-egress-check/model/run';
import { applyBody, changedFields, loadFieldCode } from '@/widgets/bs-field-allowlist/model/run';
import { cleanPrototype, runPollution } from '@/widgets/pollution-lab/model/run';

/**
 * Тема «Безопасность бэкенда глазами фронтенда».
 *
 * Весь код темы — строки из `data.ts`, и здесь исполняются **они**, а не копии. Для строк
 * с `import` приём такой: `load` вырезает строки импорта и подставляет те же имена из
 * настоящих модулей (`node:sqlite`, `node:child_process`, `zod`…). Имя, которого нет среди
 * подставленных, — ошибка загрузки, а не молчаливый `undefined`. Остальной текст идёт в движок
 * как есть, в строгом режиме (модули всегда строгие).
 *
 * Для каждой защиты проверяются три вещи:
 *   1. защищённая версия проходит таблицу случаев, напечатанную на странице;
 *   2. «наивная» версия на той же таблице ошибается **ровно в тех строках**, что отмечены, —
 *      это и есть доказательство, что проверка нужна;
 *   3. тест читателя (`CHECK_*_CODE`) зелёный на защищённой версии и красный на наивной —
 *      иначе он ничего не проверяет.
 *
 * Внешней сети нет: `guardLookup` проверяется настоящим `http.get` на свой сервер
 * `127.0.0.1`, «DNS» подменён функцией.
 */

const MODULES: Record<string, object> = {
  'node:sqlite': sqlite,
  'node:child_process': childProcess,
  'node:util': util,
  'node:fs': fs,
  'node:os': os,
  'node:path': path,
  zod,
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as FunctionConstructor;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- строки темы — нетипизированный JS
type Any = any;

/**
 * Исполнить строку темы. `scope` — имена, которые код получает снаружи (`db`, `assert`,
 * `handlers`), `names` — что вернуть из его области.
 */
async function load(code: string, names: string[], scope: Record<string, unknown> = {}): Promise<Record<string, Any>> {
  const bindings: string[] = [];
  const body = code.replace(/^import \{([^}]+)\} from '([^']+)';\n/gm, (_, list: string, from: string) => {
    const mod = MODULES[from];
    if (!mod) throw new Error(`Строка темы импортирует ${from}, а тест его не подставляет`);
    for (const name of list.split(',').map((s) => s.trim())) {
      if (!(name in mod)) throw new Error(`В ${from} нет ${name}`);
      bindings.push(`const ${name} = __modules[${JSON.stringify(from)}].${name};`);
    }
    return '';
  });
  expect(body, 'остался необработанный import').not.toMatch(/^import /m);
  const fn = new AsyncFunction(
    '__modules',
    ...Object.keys(scope),
    `"use strict";\n${bindings.join('\n')}\n${body}\nreturn { ${names.join(', ')} };`,
  );
  return fn(MODULES, ...Object.values(scope));
}

async function freshDb(): Promise<Any> {
  return (await load(t.SEED_CODE, ['db'])).db;
}

/* ─────────────────────────── сквозной пример ─────────────────────────── */

describe('SEED_CODE: сквозная база', () => {
  it('два покупателя и три заказа, как обещает текст', async () => {
    const db = await freshDb();
    expect(db.prepare('SELECT id, name, role FROM users ORDER BY id').all().map((r: Any) => ({ ...r }))).toEqual([
      { id: 'u1', name: 'Алиса', role: 'user' },
      { id: 'u2', name: 'Борис', role: 'user' },
    ]);
    expect(db.prepare('SELECT id, owner_id FROM orders ORDER BY id').all().map((r: Any) => [r.id, r.owner_id])).toEqual([
      [1, 'u1'],
      [2, 'u1'],
      [3, 'u2'],
    ]);
  });

  it('ALICE — та же учётная запись, что строка u1 в базе', async () => {
    const db = await freshDb();
    const row = db.prepare("SELECT * FROM users WHERE id = 'u1'").get();
    expect({ ...row }).toEqual(t.ALICE);
  });
});

/* ─────────────────────────── IDOR ─────────────────────────── */

describe('раздел 1: доступ к объекту по id', () => {
  const users: Record<string, { id: string }> = { u1: { id: 'u1' }, u2: { id: 'u2' } };

  for (const variant of ['safe', 'naive'] as const) {
    describe(variant === 'safe' ? 'SAFE_IDOR_CODE' : 'NAIVE_IDOR_CODE', () => {
      for (const c of t.IDOR_CASES) {
        it(`${c.who ?? 'аноним'} → ${c.call}(${c.id}) = ${c[variant]}`, async () => {
          const db = await freshDb();
          const { handlers } = await load(variant === 'safe' ? t.SAFE_IDOR_CODE : t.NAIVE_IDOR_CODE, ['handlers']);
          const res = await handlers[c.call]({ user: c.who ? users[c.who] : null, params: { id: c.id } }, db);
          expect(res.status).toBe(c[variant]);
        });
      }
    });
  }

  it('наивная версия расходится с защищённой ровно в отмененах чужого заказа', () => {
    const diff = t.IDOR_CASES.filter((c) => c.safe !== c.naive).map((c) => `${c.who}:${c.call}:${c.id}`);
    expect(diff).toEqual(['u2:cancelOrder:1', 'u1:cancelOrder:3']);
  });

  it('наивная отмена чужого заказа действительно меняет базу', async () => {
    const db = await freshDb();
    const { handlers } = await load(t.NAIVE_IDOR_CODE, ['handlers']);
    await handlers.cancelOrder({ user: users.u2, params: { id: '1' } }, db);
    expect(db.prepare('SELECT status FROM orders WHERE id = 1').get().status).toBe('cancelled');
  });

  it('тест читателя зелёный на защищённой версии', async () => {
    const db = await freshDb();
    const { handlers } = await load(t.SAFE_IDOR_CODE, ['handlers']);
    await expect(load(t.CHECK_IDOR_CODE, [], { handlers, db, assert })).resolves.toBeDefined();
  });

  it('и красный на наивной — на отмене чужого заказа', async () => {
    const db = await freshDb();
    const { handlers } = await load(t.NAIVE_IDOR_CODE, ['handlers']);
    await expect(load(t.CHECK_IDOR_CODE, [], { handlers, db, assert })).rejects.toThrow(/cancelOrder\(1\) от u2/);
  });
});

/* ─────────────────────────── SSRF ─────────────────────────── */

describe('раздел 2: исходящий запрос на адрес пользователя', () => {
  const egress = loadEgress(t.EGRESS_CODE);
  const naive = loadNaive(t.NAIVE_EGRESS_CODE, t.NAIVE_FETCH_CODE);

  describe('таблица EGRESS_CASES', () => {
    for (const c of t.EGRESS_CASES) {
      it(`${c.label}: защитная ${c.safe}${c.stage ? ` (${c.stage})` : ''}, чёрный список ${c.naive}`, () => {
        const d = decideCase(egress, naive, c, t.DNS_CHOICES);
        expect(d.safe.ok ? 'ok' : 'block', JSON.stringify(d.safe)).toBe(c.safe);
        if (!d.safe.ok) expect(d.safe.stage).toBe(c.stage);
        expect(d.naive.ok ? 'ok' : 'block', d.naive.reason).toBe(c.naive);
      });
    }

    it('чёрный список пропускает ровно эти строки', () => {
      const missed = t.EGRESS_CASES.filter((c) => c.safe === 'block' && c.naive === 'ok').map((c) => c.label);
      expect(missed).toEqual([
        '127.0.0.2',
        'localhost с точкой',
        'IPv4 внутри IPv6',
        '172.16.0.5',
        'fd00::1',
        'имя → частный адрес',
        'имя → два адреса',
        'порт 6379',
        'схема file:',
      ]);
      // и нигде не строже защитной
      expect(t.EGRESS_CASES.filter((c) => c.safe === 'ok' && c.naive === 'block')).toEqual([]);
    });

    it('у каждой строки есть ответ DNS из списка демо', () => {
      for (const c of t.EGRESS_CASES) expect(() => answerOf(t.DNS_CHOICES, c.dns)).not.toThrow();
    });
  });

  it('список разрешённых хостов: чужое имя отсекается до DNS', () => {
    const r = egress.checkOutgoing('https://evil.example.net/', ['93.184.215.14'], t.ALLOW_HOSTS);
    expect(r).toMatchObject({ ok: false, stage: 'url' });
    expect(egress.checkOutgoing('https://hooks.example.com/x', ['93.184.215.14'], t.ALLOW_HOSTS).ok).toBe(true);
    // а разрешённое имя, ответившее частным адресом, — всё равно нет
    expect(egress.checkOutgoing('https://hooks.example.com/x', ['10.0.0.5'], t.ALLOW_HOSTS)).toMatchObject({ ok: false, stage: 'dns' });
  });

  describe('классификация адресов', () => {
    const blocked = [
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254', '172.16.0.1',
      '172.31.255.255', '192.168.1.1', '192.0.2.1', '198.18.0.1', '203.0.113.9', '224.0.0.1', '255.255.255.255',
      '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '64:ff9b::a00:1', '::127.0.0.1',
      'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%en0', 'ff02::1', '2001:db8::1', '2001:0:4136::1',
      '2002:7f00:1::1', '100::1',
      // Строки реестра IANA IPv6 Special-Purpose (CSV от 2026-09-29) с «Globally Reachable: False».
      // 2001:2::/48 и 3fff::/20 лежат внутри 2000::/3 — их черновик «по памяти» пропускал.
      '2001:2::1', '3fff::1', '3fff:fff::1', '5f00::1', '64:ff9b:1::a00:1',
      // IPv6-адрес сервиса метаданных AWS (документация IMDS) — внутри fc00::/7.
      'fd00:ec2::254',
    ];
    const allowed = [
      '93.184.215.14', '8.8.8.8', '172.15.255.255', '172.32.0.0', '100.128.0.0', '11.0.0.0',
      '2606:2800:21f:cb07:6820:80da:af6b:8b2c', '2001:3::1', '3000::1', '3fff:1000::1', '3ff0::1', '::ffff:5db8:d70e', '64:ff9b::808:808', '2002:5db8:d70e::1',
    ];
    for (const ip of blocked) it(`${ip} запрещён`, () => expect(egress.addressProblem(ip)).not.toBeNull());
    for (const ip of allowed) it(`${ip} разрешён`, () => expect(egress.addressProblem(ip)).toBeNull());
  });

  describe('PARSER_ROWS: что парсер делает с хостом', () => {
    for (const r of t.PARSER_ROWS) {
      it(`${r.input} → ${r.host}`, () => {
        expect(new URL(r.input).hostname).toBe(r.host);
        // и защитная проверка отказывает каждой из них
        const d = egress.checkOutgoing(r.input, ['127.0.0.1']);
        expect(d.ok).toBe(false);
      });
    }

    it('чёрный список ловит пять строк из семи — кроме [::ffff:7f00:1] и localhost. (как сказано в PARSER_NOTE)', () => {
      const passed = t.PARSER_ROWS.filter((r) => runNaive(naive, r.input).ok).map((r) => r.host);
      expect(passed).toEqual(['[::ffff:7f00:1]', 'localhost.']);
      expect(t.PARSER_NOTE).toContain('пять строк таблицы из семи');
    });
  });

  describe('guardLookup на настоящем http.get', () => {
    /** «DNS» без сети: имя → адреса. */
    const fakeDns =
      (table: Record<string, string[]>) =>
      (host: string, options: { all?: boolean }, cb: (err: Error | null, a?: unknown, f?: number) => void) => {
        const list = (table[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
        if (!list.length) return cb(Object.assign(new Error(`ENOTFOUND ${host}`), { code: 'ENOTFOUND' }));
        if (options.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      };

    async function withServer(fn: (port: number, hits: () => number) => Promise<void>) {
      let hits = 0;
      const server = http.createServer((_, res) => {
        hits++;
        res.end('internal');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      try {
        await fn((server.address() as AddressInfo).port, () => hits);
      } finally {
        server.close();
      }
    }

    function get(port: number, lookup: Any): Promise<{ status?: number; code?: string }> {
      return new Promise((resolve) => {
        const req = http.get({ host: 'hooks.example.com', port, path: '/', lookup, agent: false }, (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', (e: NodeJS.ErrnoException) => resolve({ code: e.code }));
      });
    }

    it('без guardLookup запрос доходит до внутреннего сервиса, с ним — нет (как в GUARD_RUN_NOTE)', async () => {
      const dns = fakeDns({ 'hooks.example.com': ['127.0.0.1'] });
      await withServer(async (port, hits) => {
        expect(await get(port, dns)).toEqual({ status: 200 });
        expect(hits()).toBe(1);

        expect(await get(port, egress.guardLookup(dns))).toEqual({ code: 'EGRESS_BLOCKED' });
        expect(hits()).toBe(1);
      });
      expect(t.GUARD_RUN_NOTE).toContain('счётчик 1');
    });

    // REBIND_NOTE обещает то же для `fetch`: `Agent` из undici с `connect.lookup`. undici приходит
    // в проект транзитивно (astro → unifont); пропадёт — файл упадёт на импорте громко.
    // Прогон заодно показал, что undici зовёт lookup с `all: true` — ветка guardLookup для списка.
    it('та же guardLookup в `connect.lookup` у Agent из undici — для fetch (как в REBIND_NOTE)', async () => {
      const undici = await import('undici');
      const dns = fakeDns({ 'hooks.example.com': ['127.0.0.1'] });
      await withServer(async (port, hits) => {
        const open = new undici.Agent({ connect: { lookup: dns as Any } });
        const res = await undici.fetch(`http://hooks.example.com:${port}/`, { dispatcher: open });
        expect(res.status).toBe(200);
        await res.text();
        expect(hits()).toBe(1);

        const guarded = new undici.Agent({ connect: { lookup: egress.guardLookup(dns) as Any } });
        const err = await undici.fetch(`http://hooks.example.com:${port}/`, { dispatcher: guarded }).catch((e: Any) => e);
        expect(err?.cause?.code).toBe('EGRESS_BLOCKED');
        expect(hits()).toBe(1);
        await Promise.all([open.close(), guarded.close()]);
      });
      expect(t.REBIND_NOTE).toContain('connect.lookup');
    });

    it('guardLookup отдаёт публичный адрес без изменений — в обоих режимах вызова', async () => {
      const guarded = egress.guardLookup(fakeDns({ 'a.example': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'] }));
      const all = await new Promise((r) => guarded('a.example', { all: true }, (e, a) => r(e ?? a)));
      expect(all).toEqual([
        { address: '93.184.215.14', family: 4 },
        { address: '2606:2800:21f:cb07:6820:80da:af6b:8b2c', family: 6 },
      ]);
      const one = await new Promise((r) => guarded('a.example', {}, (e, a, f) => r(e ?? [a, f])));
      expect(one).toEqual(['93.184.215.14', 4]);
    });
  });

  describe('редирект', () => {
    /** Поддельный fetch: 302 с публичного адреса на адрес метаданных облака. */
    function fakeFetch() {
      const visited: string[] = [];
      const routes: Record<string, () => Response> = {
        'https://hooks.example.com/in': () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }),
        'http://169.254.169.254/': () => new Response('secret', { status: 200 }),
      };
      const fetch = async (url: string, init?: { redirect?: string }): Promise<Response> => {
        let current = url;
        for (let i = 0; i < 5; i++) {
          visited.push(current);
          const res = routes[current]?.() ?? new Response('nope', { status: 404 });
          const location = res.headers.get('location');
          if (init?.redirect === 'manual' || !location) return res;
          current = new URL(location, current).href;
        }
        throw new Error('петля');
      };
      return { fetch, visited };
    }

    it('naiveFetch проверяет первый адрес и уходит по редиректу', async () => {
      const f = fakeFetch();
      const res = await naive.naiveFetch!('https://hooks.example.com/in', { fetch: f.fetch });
      expect(await res.text()).toBe('secret');
      expect(f.visited).toEqual(['https://hooks.example.com/in', 'http://169.254.169.254/']);
    });

    it('fetchChecked останавливается на первом ответе 302', async () => {
      const f = fakeFetch();
      await expect(egress.fetchChecked('https://hooks.example.com/in', { fetch: f.fetch })).rejects.toMatchObject({
        code: 'EGRESS_BLOCKED',
      });
      expect(f.visited).toEqual(['https://hooks.example.com/in']);
    });
  });
});

/* ─────────────────────────── инъекции ─────────────────────────── */

describe('раздел 3: инъекции', () => {
  describe('SQL', () => {
    it('SQL_RUN: склейка и параметры на сквозной базе', async () => {
      const db = await freshDb();
      const safe = (await load(t.SAFE_SQL_CODE, ['findOrders'])).findOrders;
      const naive = (await load(t.NAIVE_SQL_CODE, ['findOrders'])).findOrders;
      const ids = (rows: Any[]) => rows.map((r) => r.id);

      expect(ids(naive(db, 'u1', 'new'))).toEqual([1]);
      expect(ids(safe(db, 'u1', 'new'))).toEqual([1]);

      expect(() => naive(db, 'u1', "O'Brien")).toThrow('near "Brien": syntax error');
      expect(safe(db, 'u1', "O'Brien")).toEqual([]);

      const leaked = naive(db, 'u1', "new' OR '1'='1");
      expect(ids(leaked)).toEqual([1, 2, 3]);
      expect(leaked.find((r: Any) => r.id === 3).owner_id).toBe('u2');
      expect(safe(db, 'u1', "new' OR '1'='1")).toEqual([]);

      // строки таблицы на странице — те же три значения
      expect(t.SQL_RUN.map((r) => r.value)).toEqual(['`new`', "`O'Brien`", "`new' OR '1'='1`"]);
      expect(t.SQL_RUN[1].naive).toContain('near "Brien": syntax error');
    });

    it('тест читателя зелёный на параметрах и красный на склейке', async () => {
      const safe = await load(t.SAFE_SQL_CODE, ['findOrders']);
      await expect(load(t.CHECK_SQL_CODE, [], { db: await freshDb(), assert, ...safe })).resolves.toBeDefined();
      const naive = await load(t.NAIVE_SQL_CODE, ['findOrders']);
      await expect(load(t.CHECK_SQL_CODE, [], { db: await freshDb(), assert, ...naive })).rejects.toThrow();
    });

    it('listOrders: сортировка выбором из списка, незнакомое значение — по умолчанию', async () => {
      const db = await freshDb();
      const { listOrders } = await load(t.SAFE_SQL_CODE, ['listOrders']);
      expect(listOrders(db, 'u1', 'total').map((r: Any) => r.id)).toEqual([2, 1]);
      expect(listOrders(db, 'u1', 'date').map((r: Any) => r.id)).toEqual([1, 2]);
      expect(listOrders(db, 'u1', 'total; DROP TABLE orders').map((r: Any) => r.id)).toEqual([1, 2]);
      expect(listOrders(db, 'u1', '__proto__').map((r: Any) => r.id)).toEqual([1, 2]);
    });

    it('тонкое место 06: ORDER BY ? сортирует по константе и не жалуется', async () => {
      const db = await freshDb();
      expect(db.prepare('SELECT id FROM orders ORDER BY ?').all('total').map((r: Any) => r.id)).toEqual([1, 2, 3]);
      expect(db.prepare('SELECT id FROM orders ORDER BY total').all().map((r: Any) => r.id)).toEqual([3, 2, 1]);
      expect(t.PITFALLS.find((p) => p.n === '06')!.d).toContain('`1, 2, 3` вместо `3, 2, 1`');
    });

    it('тонкое место 07: prepare исполняет первый оператор, exec — все', async () => {
      const { findOrders } = await load(t.NAIVE_SQL_CODE, ['findOrders']);
      const db = await freshDb();
      expect(() => findOrders(db, 'u1', "new'; DROP TABLE orders; --")).not.toThrow();
      expect(db.prepare('SELECT count(*) AS n FROM orders').get().n).toBe(3);

      const same = "SELECT id FROM orders WHERE owner_id = 'u1' AND status = 'new'; DROP TABLE orders; --'";
      db.exec(same);
      expect(() => db.prepare('SELECT count(*) FROM orders').get()).toThrow('no such table: orders');
    });
  });

  describe('HTML-шаблон на сервере', () => {
    it('escapeHtml и тег html экранируют текст и атрибут', async () => {
      const { letter, escapeHtml } = await load(t.ESCAPE_CODE, ['letter', 'escapeHtml']);
      expect(letter({ name: '<script>x</script>', bio: '" onmouseover="x' })).toBe(
        '<p>Здравствуйте, &lt;script&gt;x&lt;/script&gt;!</p><a title="&quot; onmouseover=&quot;x">профиль</a>',
      );
      expect(escapeHtml("a&b'c")).toBe('a&amp;b&#39;c');
      expect(letter({ name: 'Алиса', bio: '' })).toBe('<p>Здравствуйте, Алиса!</p><a title="">профиль</a>');
    });
  });

  describe('командная строка', () => {
    it('тест читателя зелёный на execFile', async () => {
      const { countLines } = await load(t.SAFE_EXEC_CODE, ['countLines']);
      await expect(load(t.CHECK_EXEC_CODE, [], { countLines, assert })).resolves.toBeDefined();
    });

    it('наивная версия: честный ответ и выполненная вторая команда (EXEC_NOTE)', async () => {
      const { countLines } = await load(t.NAIVE_EXEC_CODE, ['countLines']);
      const dir = mkdtempSync(join(tmpdir(), 'bs-exec-'));
      writeFileSync(join(dir, 'report.txt'), 'a\nb\nc\n');
      expect(await countLines(dir, 'report.txt; touch marker')).toBe(3);
      expect(existsSync(join(dir, 'marker'))).toBe(true);
      // и тест читателя её ловит — на первой же проверке после честной
      await expect(load(t.CHECK_EXEC_CODE, [], { countLines, assert })).rejects.toThrow();
    });

    it('тонкое место 05: shell: true возвращает оболочку, Node пишет DEP0190', () => {
      // Отдельный процесс: предупреждение выдаётся раз на процесс, и в общем процессе тестов
      // его мог уже «съесть» кто-то другой — тогда проверка не отличила бы «есть» от «нет».
      const dir = mkdtempSync(join(tmpdir(), 'bs-shell-'));
      writeFileSync(join(dir, 'report.txt'), 'a\nb\nc\n');
      const script = `require('node:child_process').execFile('wc', ['-l', 'report.txt; touch m'], { shell: true }, () => {});`;
      const out = childProcess.spawnSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8' });
      expect(existsSync(join(dir, 'm'))).toBe(true);
      expect(out.stderr).toContain('DEP0190');
      expect(t.PITFALLS.find((p) => p.n === '05')!.d).toContain('DEP0190');
    });
  });
});

/* ─────────────────────────── массовое присваивание ─────────────────────────── */

describe('раздел 4: лишние поля в теле запроса', () => {
  const code = loadFieldCode(t.NAIVE_MASS_CODE, t.PICK_CODE);

  describe('FIELD_CASES: три способа записи на одних телах', () => {
    for (const c of t.FIELD_CASES) {
      it(c.label, async () => {
        const body = JSON.parse(c.body);

        const naive = code.updateProfile({ ...t.ALICE }, body);
        expect(changedFields(t.ALICE, naive, body)).toEqual(c.changed);

        expect(code.pickEditable(body)).toEqual(c.pickPatch);

        const { updateProfile } = await load(t.SAFE_MASS_CODE, ['updateProfile']);
        if (c.schemaPatch === null) {
          expect(() => updateProfile({ ...t.ALICE }, body)).toThrow(zod.ZodError);
        } else {
          const saved = updateProfile({ ...t.ALICE }, body);
          expect(saved).toEqual({ ...t.ALICE, ...c.schemaPatch });
          expect(Object.getPrototypeOf(saved)).toBe(Object.prototype);
        }

        // демо считает тем же путём
        const applied = applyBody(code, t.ALICE, c.body);
        expect('rows' in applied && applied.naiveChanged).toEqual(c.changed);
      });
    }
  });

  it('__proto__ через Object.assign меняет прототип, а не добавляет поле', () => {
    const user = code.updateProfile({ ...t.ALICE }, JSON.parse('{"__proto__": {"isAdmin": true}}'));
    expect(user.isAdmin).toBe(true);
    expect(Object.hasOwn(user, 'isAdmin')).toBe(false);
    expect(Object.getPrototypeOf(user)).not.toBe(Object.prototype);
  });

  it('.strict() отказывает вместо того, чтобы отбросить (тонкое место 08)', async () => {
    const { ProfilePatch } = await load(t.SAFE_MASS_CODE, ['ProfilePatch']);
    expect(ProfilePatch.parse({ name: 'A', role: 'admin' })).toEqual({ name: 'A' });
    const strict = ProfilePatch.strict().safeParse({ name: 'A', role: 'admin' });
    expect(strict.success).toBe(false);
    expect(strict.error.issues[0].code).toBe('unrecognized_keys');
  });

  it('тест читателя зелёный на схеме, красный на Object.assign', async () => {
    const safe = await load(t.SAFE_MASS_CODE, ['updateProfile']);
    await expect(load(t.CHECK_MASS_CODE, [], { assert, ...safe })).resolves.toBeDefined();
    await expect(load(t.CHECK_MASS_CODE, [], { assert, updateProfile: code.updateProfile })).rejects.toThrow();
  });

  it('демо: неразборчивый JSON и не-объект — сообщение, а не падение', () => {
    expect(applyBody(code, t.ALICE, '{name:')).toHaveProperty('error');
    expect(applyBody(code, t.ALICE, '[1]')).toHaveProperty('error');
  });
});

/* ─────────────────────────── ошибки и секреты ─────────────────────────── */

describe('раздел 5: ошибки и секреты', () => {
  async function realSqliteError(): Promise<Error> {
    const db = await freshDb();
    try {
      db.prepare('SELECT * FROM payments').all();
    } catch (e) {
      return e as Error;
    }
    throw new Error('ошибки не было');
  }

  it('наивный ответ уносит имя таблицы, внутренний адрес и стек (ERROR_NOTES)', async () => {
    const { toResponse } = await load(t.NAIVE_ERROR_CODE, ['toResponse']);
    const sql = JSON.stringify(toResponse(await realSqliteError()).body);
    expect(sql).toContain('no such table: payments');
    const conn = JSON.stringify(toResponse(new Error('connect ECONNREFUSED 10.0.3.7:5432')).body);
    expect(conn).toContain('10.0.3.7:5432');
    expect(conn).toContain('    at ');
    expect(t.ERROR_NOTES[0]).toContain('no such table: payments');
  });

  it('защищённый: 500 с requestId, подробности — только в журнал; PublicError показывается', async () => {
    const { toResponse, PublicError } = await load(t.SAFE_ERROR_CODE, ['toResponse', 'PublicError']);
    const logged: Any[] = [];
    const err = await realSqliteError();
    const res = toResponse(err, 'req-7', (x: Any) => logged.push(x));
    expect(res).toEqual({ status: 500, body: { error: 'Внутренняя ошибка', requestId: 'req-7' } });
    expect(logged).toEqual([{ requestId: 'req-7', err }]);

    const shown = toResponse(new PublicError(404, 'Заказ не найден'), 'req-8', () => {});
    expect(shown).toEqual({ status: 404, body: { error: 'Заказ не найден' } });
  });

  it('тест читателя зелёный на защищённом, красный на наивном', async () => {
    const safe = await load(t.SAFE_ERROR_CODE, ['toResponse']);
    await expect(load(t.CHECK_ERROR_CODE, [], { assert, ...safe })).resolves.toBeDefined();
    const naive = await load(t.NAIVE_ERROR_CODE, ['toResponse']);
    await expect(load(t.CHECK_ERROR_CODE, [], { assert, ...naive })).rejects.toThrow();
  });

  it('findLeaks: значение секрета в клиентском файле найдено, публичные и короткие — нет', async () => {
    const { findLeaks } = await load(t.FIND_LEAKS_CODE, ['findLeaks']);
    const env = {
      DATABASE_URL: 'postgres://shop:hunter2hunter2@10.0.3.7/shop',
      STRIPE_SECRET: 'sk_test_0123456789abcdef',
      VITE_API_BASE: 'https://api.example.com',
      NEXT_PUBLIC_SITE: 'https://example.com/site',
      NODE_ENV: 'prod',
    };
    const files = {
      'dist/client/index-3f2a.js': 'const a="https://api.example.com";fetch(a,{headers:{k:"sk_test_0123456789abcdef"}})',
      'dist/client/about-91bc.js': 'console.log("prod")',
    };
    expect(findLeaks(env, files)).toEqual(['STRIPE_SECRET → dist/client/index-3f2a.js']);
  });
});

/* ─────────────────────────── цепочка поставок ─────────────────────────── */

describe('раздел 6: цепочка поставок', () => {
  it('lockProblems на package-lock.json этого проекта: сотни пакетов, замечаний ноль', async () => {
    const { lockProblems } = await load(t.LOCK_CHECK_CODE, ['lockProblems']);
    const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
    expect(lockProblems(lock)).toEqual([]);
    // Точное число в текст не пишется: оно меняется с каждой установкой пакета
    // (650 → 736 за один день), и тест краснел от npm install, а не от ошибки.
    // Закреплён порядок — «сотни», — и то, что текст обещает ноль замечаний.
    const count = Object.keys(lock.packages).filter((p) => p !== '' && !lock.packages[p].link).length;
    expect(count).toBeGreaterThan(100);
    expect(t.SUPPLY_CARDS[1].d).toContain('сотни пакетов, замечаний ноль');
  });

  it('lockProblems находит пакет из git и пакет без integrity', async () => {
    const { lockProblems } = await load(t.LOCK_CHECK_CODE, ['lockProblems']);
    const lock = {
      packages: {
        '': { name: 'app' },
        'node_modules/ok': { resolved: 'https://registry.npmjs.org/ok/-/ok-1.0.0.tgz', integrity: 'sha512-x' },
        'node_modules/fork': { resolved: 'git+ssh://git@example.com/fork.git#abc', integrity: 'sha512-y' },
        'node_modules/bare': { resolved: 'https://registry.npmjs.org/bare/-/bare-1.0.0.tgz' },
        'node_modules/local': { resolved: 'packages/local', link: true },
      },
    };
    expect(lockProblems(lock)).toEqual([
      'node_modules/fork: resolved git+ssh://git@example.com/fork.git#abc',
      'node_modules/bare: нет integrity',
    ]);
  });
});

/* ─────────────────────────── связность темы ─────────────────────────── */

describe('ссылки и формулировки', () => {
  it('браузерная половина — ссылками на «Безопасность фронтенда», а не пересказом', () => {
    const all = JSON.stringify(t);
    for (const anchor of ['/platform/security/#s2', '/platform/security/#s4', '/platform/security/#s6']) {
      expect(all).toContain(anchor);
    }
    expect(all).toContain('/tooling/package-managers/#s3');
    expect(all).toContain('/tooling/package-managers/#s6');
    expect(all).toContain('/tooling/modules/#s6');
  });
});

/**
 * Prototype pollution через глубокое слияние — переехало из «Объектной модели» 2026-10-03
 * вместе с текстом и демо. Демо и тест спрашивают движок одним модулем: `runPollution`.
 */
describe('prototype pollution', () => {
  /**
   * Prototype pollution. Самое сильное здесь — не `true` у постороннего объекта, а то, что
   * цель слияния не получила **ни одного** собственного ключа: полезная нагрузка прошла мимо неё.
   */
  it('свойство приходит постороннему объекту, а цель остаётся пустой', () => {
    try {
      const attack = runPollution([]);
      expect(attack.polluted, 'посторонний объект получил чужое свойство').toBe(true);
      expect(attack.targetKeys, 'в цели не осталось ничего — всё уехало в прототип').toEqual([]);
      expect(attack.victim, 'опыт ставился на настоящем прототипе').toBe('Object.prototype');
    } finally {
      // Демо пачкает общий прототип — тот самый случай, о котором рассказывает раздел.
      cleanPrototype();
    }
  });

  it('каждая из защит гасит атаку', () => {
    try {
      for (const fix of ['filter', 'nullProto', 'freeze'] as const) {
        expect(runPollution([fix]).polluted, `защита «${fix}» не сработала`).toBe(false);
      }
    } finally {
      cleanPrototype();
    }
  });

  /*
   * Разбор атаки по шагам (`t.POLLUTION_WALK`) и три защиты (`t.POLLUTION_DEFENSES`) сверены
   * с трассой того же `runPollution`, что крутит демо: какое звено рвёт каждая защита,
   * видно по тому, на какой строке трасса обрывается или сворачивает.
   */
  it('код в тексте — тот, что исполняет демо, и он правда отравляет прототип', () => {
    const strip = (code: string) => code.split('\n').map((l) => l.replace(/\s+\/\/ .*$/, ''));
    try {
      expect(strip(t.POLLUTION_CODE)).toEqual(runPollution([]).code);
      expect(t.POLLUTION_CODE).toContain('({}).isAdmin;   // true');
      expect(new Function(`${t.POLLUTION_CODE}\nreturn ({}).isAdmin;`)()).toBe(true);
    } finally {
      cleanPrototype();
    }
  });

  it('разбор по шагам совпадает с трассой демо', () => {
    try {
      const attack = runPollution([]);
      expect(attack.log[0]).toBe('Object.keys(payload) → ["__proto__"]');
      expect(attack.log[1]).toContain('аксессор вернул сам прототип');
      expect(attack.log[2]).toBe('пишем isAdmin = true');
      expect(t.POLLUTION_WALK[0]).toContain('`["__proto__"]`');
      expect(t.POLLUTION_WALK[4]).toContain('`[]`');

      // Проверка ключа: трасса обрывается сразу после Object.keys — до чтения аксессора.
      const filtered = runPollution(['filter']);
      expect(filtered.log[1]).toContain('отклонён проверкой');

      // Цель без прототипа: чтение даёт undefined, нагрузка оседает в собственном ключе цели.
      const nullProto = runPollution(['nullProto']);
      expect(nullProto.log[1]).toBe('читаем target["__proto__"] → undefined');
      expect(nullProto.targetKeys).toEqual(['__proto__']);
      expect(t.POLLUTION_DEFENSES[1].d).toContain('`["__proto__"]`');

      // Заморозка: чтение проходит, отказывает запись, и это TypeError.
      const frozen = runPollution(['freeze']);
      expect(frozen.log[1]).toContain('аксессор вернул сам прототип');
      expect(frozen.errorName).toBe('TypeError');
      expect(t.POLLUTION_DEFENSES[2].d).toContain('`TypeError`');
    } finally {
      cleanPrototype();
    }
  });

  it('путь через constructor ведёт туда же, а Map до прототипа не доходит', () => {
    const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const value = source[key];
        if (value && typeof value === 'object') {
          if (!target[key]) target[key] = {};
          merge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
        } else target[key] = value;
      }
    };
    try {
      merge({}, JSON.parse('{"constructor":{"prototype":{"isAdmin":true}}}'));
      expect(({} as Record<string, unknown>).isAdmin).toBe(true);
    } finally {
      cleanPrototype();
    }
    const map = new Map<string, unknown>([['__proto__', { isAdmin: true }]]);
    expect(map.get('__proto__')).toEqual({ isAdmin: true });
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    // Литерал с тем же именем меняет прототип, а JSON.parse заводит ключ — шаг 1 разбора.
    expect(Object.keys({ __proto__: { isAdmin: true } })).toEqual([]);
    expect(Object.keys(JSON.parse('{"__proto__":{}}'))).toEqual(['__proto__']);
  });

});
