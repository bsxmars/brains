import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { compile } from '@vue/compiler-dom';
import { build } from 'esbuild';
import { type Browser, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/platform/csp/data';
import { loadCheck } from '@/widgets/csp-lab/model/run';

/**
 * Тема «CSP и Trusted Types».
 *
 * `CSP_CHECK_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * сверяется с журналом Chromium (`MATRIX`) на всех 31 × 15 парах «политика × проба», а сам
 * журнал снимается заново: тест поднимает тот же `node:http` (сайт на 52600, CDN на 52601),
 * запускает Chromium с `--host-resolver-rules` (`site.test`, `cdn.test`, `other.test`)
 * и отдаёт `PAGE_HTML` под каждой политикой. Так же заново снимаются тексты консоли, тела
 * отчётов, `<meta>`, Trusted Types и поведение Vue и React под ними. Код примеров
 * (`NONCE_SERVER_CODE`, `REFACTOR_AFTER`, `TT_POLICY_CODE`, `DEFAULT_POLICY_CODE`,
 * `REACT_TT_CODE`, `VIOLATION_LISTENER_CODE`) попадает в браузер или в Node без изменений.
 *
 * Хеши пересчитывает `node:crypto`. Доставка `report-to` на сервер не проверяется: на стенде
 * её не удалось увидеть (см. шапку `data.ts`) — проверяется тело отчёта из `ReportingObserver`.
 */

const require = createRequire(import.meta.url);
const check = loadCheck(t.CSP_CHECK_CODE);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64');

// ─── Стенд ─────────────────────────────────────────────────────────────────────────────────

interface PageDef {
  headers: Record<string, string>;
  body: string;
}
const pages = new Map<string, PageDef>();
const assets = new Map<string, string>();
const reports: { path: string; contentType?: string; body: string }[] = [];

function handler(origin: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', origin);
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        reports.push({ path: url.pathname, contentType: req.headers['content-type'], body });
        res.writeHead(204);
        res.end();
      });
      return;
    }
    const key = origin + url.pathname;
    const script = t.SCRIPT_FILES[key] ?? assets.get(url.pathname);
    if (script !== undefined) {
      res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
      res.end(script);
      return;
    }
    const page = pages.get(url.pathname);
    if (page && origin === t.SITE) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...page.headers });
      res.end(page.body);
      return;
    }
    res.writeHead(404);
    res.end();
  };
}

let site: Server;
let cdn: Server;
let browser: Browser;

beforeAll(async () => {
  site = createServer(handler(t.SITE));
  cdn = createServer(handler(t.CDN));
  await Promise.all([
    new Promise<void>((r) => site.listen(52600, '127.0.0.1', r)),
    new Promise<void>((r) => cdn.listen(52601, '127.0.0.1', r)),
  ]);
  browser = await chromium.launch({
    args: ['--host-resolver-rules=MAP site.test 127.0.0.1:52600, MAP other.test 127.0.0.1:52600, MAP cdn.test 127.0.0.1:52601'],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  site?.close();
  cdn?.close();
});

interface Visit {
  console: string[];
  errors: string[];
  page: Page;
  close: () => Promise<void>;
}

/** Открыть страницу с заголовками; `init` — код до загрузки (в обход CSP). */
async function visit(path: string, headers: Record<string, string>, body: string, init: string[] = [], host = t.SITE): Promise<Visit> {
  pages.set(path, { headers, body });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const out: Visit = { console: [], errors: [], page, close: () => ctx.close() };
  page.on('console', (m) => out.console.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => out.errors.push(`${e.name}: ${e.message}`));
  for (const code of init) await page.addInitScript(code);
  await page.goto(host + path);
  await page.waitForTimeout(100);
  return out;
}

const csp = (v: string | null): Record<string, string> => (v ? { 'content-security-policy': v } : {});

// ─── Хеши ─────────────────────────────────────────────────────────────────────────────────

describe('хеши в теме — SHA-256 настоящих текстов', () => {
  it('HASHES пересчитываются node:crypto', () => {
    expect(sha("mark('inline')")).toBe(t.HASHES.inline);
    expect(sha("mark('inline-nonce')")).toBe(t.HASHES.inlineNonce);
    expect(sha("mark('inline-hash')")).toBe(t.HASHES.inlineHash);
    expect(sha(t.SCRIPT_FILES[`${t.SITE}/s/hashed.js`])).toBe(t.HASHES.extHash);
    expect(sha("mark('onclick')")).toBe(t.HASHES.onclick);
    expect(sha("mark('onclick-hash')")).toBe(t.HASHES.onclickHash);
    expect(sha("javascript:mark('js-url')")).toBe(t.HASHES.jsUrl);
    expect(sha("mark('js-url')")).toBe(t.HASHES.jsUrlBody);
    expect(t.PAGE_HTML).toContain(`integrity="sha256-${t.HASHES.extHash}"`);
  });

  it('HASH_CODE печатает верный хеш, и пробел с переводом строки его меняют', () => {
    const code = t.HASH_CODE.replace(/^import .*$/m, '').replace(/^sha\(.*$/gm, '');
    const fn = new Function('createHash', `${code}\nreturn sha;`)(createHash) as (s: string) => string;
    expect(t.HASH_CODE).toContain(`'${t.HASHES.inlineHash}'`);
    expect(fn("mark('inline-hash')")).toBe(t.HASHES.inlineHash);
    expect(fn("mark('inline-hash')\n")).not.toBe(t.HASHES.inlineHash);
    expect(fn(" mark('inline-hash')")).not.toBe(t.HASHES.inlineHash);
  });
});

// ─── Функция против журнала ───────────────────────────────────────────────────────────────

describe('CSP_CHECK_CODE против журнала Chromium (литерал MATRIX)', () => {
  it('31 политика × 15 проб: ответ функции совпадает с тем, что выполнил браузер', () => {
    expect(t.MATRIX).toHaveLength(31);
    expect(t.PROBES).toHaveLength(15);
    for (const row of t.MATRIX) {
      for (const p of t.PROBES) {
        const got = check(row.csp, p.req, `${t.SITE}/m/${row.id}`).allowed;
        expect(got, `${row.id} × ${p.id}`).toBe(row.ran.includes(p.id));
      }
    }
  });

  it('пресеты демо есть в журнале', () => {
    for (const p of t.PRESETS) expect(t.MATRIX.some((r) => r.id === p.id), p.id).toBe(true);
  });
});

describe('журнал MATRIX снимается заново в Chromium', () => {
  const consoles = new Map<string, string[]>();

  it('каждая политика пропускает ровно те пробы, что записаны', async () => {
    for (const row of t.MATRIX) {
      const v = await visit(`/m/${row.id}`, csp(row.csp), t.PAGE_HTML, [
        t.MARK_CODE,
        `window.__eff = []; document.addEventListener('securitypolicyviolation', (e) => __eff.push(e.effectiveDirective));`,
      ]);
      const cdp = await v.page.context().newCDPSession(v.page);
      await cdp.send('Runtime.evaluate', { expression: t.AFTER_LOAD_CODE, allowUnsafeEvalBlockedByCSP: false });
      await v.page.waitForTimeout(400);
      const ran = (await v.page.evaluate(() => (window as unknown as { ran: string[] }).ran)) as string[];
      const eff = (await v.page.evaluate(() => (window as unknown as { __eff: string[] }).__eff)) as string[];
      expect([...ran].sort(), row.id).toEqual([...row.ran].sort());
      // Отказ называется своей директивой — той, что вернула функция.
      const blocked = t.PROBES.filter((p) => !row.ran.includes(p.id)).map((p) => check(row.csp, p.req, t.SITE + '/').effective);
      expect(new Set(eff), row.id).toEqual(new Set(blocked));
      consoles.set(row.id, v.console);
      await v.close();
    }
  }, 180_000);

  it('тексты консоли в теме — дословно из Chromium', () => {
    expect(consoles.get('nonce-inline')).toContain(`[error] ${t.CONSOLE_UNSAFE_INLINE}`);
    expect(consoles.get('self-sd')).toContain(`[error] ${t.CONSOLE_STRICT_DYNAMIC}`);
    // Браузер подсказывает хеш заблокированного инлайна — тот же, что даёт node:crypto.
    expect(consoles.get('self')!.join('\n')).toContain(`a hash ('sha256-${t.HASHES.inline}')`);
    expect(consoles.get('hash-onclick')!.join('\n')).toContain(
      "hashes do not apply to event handlers, style attributes and javascript: navigations unless the 'unsafe-hashes' keyword is present",
    );
    expect(consoles.get('nonce')!.join('\n')).toContain("'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback");
  });
});

// ─── Nonce на сервере, обработчики ────────────────────────────────────────────────────────

describe('NONCE_SERVER_CODE и REFACTOR_AFTER', () => {
  const render = new Function('randomBytes', `${t.NONCE_SERVER_CODE}\nreturn render;`)(randomBytes) as (
    s: string,
  ) => { headers: Record<string, string>; body: string };

  it('nonce новый на каждый ответ, 16 байт, в заголовке и в разметке одинаковый', () => {
    const a = render(t.NONCE_TEMPLATE);
    const b = render(t.NONCE_TEMPLATE);
    const nonceOf = (r: { headers: Record<string, string> }) => /'nonce-([^']+)'/.exec(r.headers['Content-Security-Policy'])![1];
    expect(nonceOf(a)).not.toBe(nonceOf(b));
    expect(Buffer.from(nonceOf(a), 'base64')).toHaveLength(16);
    expect(a.body).toContain(`nonce="${nonceOf(a)}"`);
    expect(a.headers['Cache-Control']).toBe('no-store');
  });

  it('в браузере выполняется свой скрипт, а внедрённый из комментария — нет', async () => {
    const r = render(t.NONCE_TEMPLATE);
    const v = await visit('/nonce', r.headers, r.body, [t.MARK_CODE]);
    expect(await v.page.evaluate(() => (window as unknown as { ran: string[] }).ran)).toEqual(['свой']);
    await v.close();
  });

  it('обработчик в атрибуте молчит под nonce, тот же через addEventListener — работает', async () => {
    const head = csp("script-src 'nonce-r4nd0m'");
    const before = await visit('/before', head, t.REFACTOR_BEFORE.replace('save()', "mark('save')"), [t.MARK_CODE]);
    await before.page.click('button');
    expect(await before.page.evaluate(() => (window as unknown as { ran: string[] }).ran)).toEqual([]);
    await before.close();
    const after = await visit('/after', head, t.REFACTOR_AFTER, [t.MARK_CODE]);
    await after.page.click('button');
    expect(await after.page.evaluate(() => (window as unknown as { ran: string[] }).ran)).toEqual(['save']);
    await after.close();
  });
});

// ─── Отчёты ──────────────────────────────────────────────────────────────────────────────

describe('отчёты', () => {
  const reportsAt = (path: string) => reports.filter((r) => r.path === path);

  it('report-uri: тело POST совпадает с REPORT_URI_BODY, адрес чужого скрипта — целиком', async () => {
    expect(t.REPORT_HEADERS_CODE).toContain("script-src 'nonce-r4nd0m' 'report-sample';\n  report-uri /csp-uri");
    const v = await visit('/r/uri', { 'content-security-policy-report-only': "script-src 'nonce-r4nd0m' 'report-sample'; report-uri /csp-uri" }, t.REPORT_PAGE_HTML, [
      t.VIOLATION_LISTENER_CODE.split('\n// ')[0],
    ]);
    await v.page.click('#b');
    await v.page.waitForTimeout(800);
    const got = reportsAt('/csp-uri');
    expect(got).toHaveLength(3);
    expect(got[0].contentType).toBe('application/csp-report');
    const bodies = got.map((r) => JSON.parse(r.body) as { 'csp-report': Record<string, unknown> });
    const inline = bodies.find((b) => b['csp-report']['effective-directive'] === 'script-src-elem' && b['csp-report']['blocked-uri'] === 'inline');
    expect(inline).toEqual(JSON.parse(t.REPORT_URI_BODY));
    expect(bodies.map((b) => b['csp-report']['blocked-uri'])).toContain('http://cdn.test/s/cdn.js?token=SECRET123');
    // Событие на странице — строки из комментария VIOLATION_LISTENER_CODE.
    const expected = t.VIOLATION_LISTENER_CODE.split('\n')
      .filter((l) => l.startsWith('// '))
      .map((l) => l.slice(3).replace(/ {2}/g, ' ').trim());
    const logs = v.console.filter((c) => c.startsWith('[log] report')).map((c) => c.slice(6).trim());
    expect(logs).toEqual(expected);
    await v.close();
  });

  it('report-to: тело отчёта в ReportingObserver совпадает с REPORT_TO_BODY', async () => {
    const observer = `window.__ro = []; new ReportingObserver((rs) => { for (const r of rs) __ro.push(r.toJSON()); }, { buffered: true }).observe();`;
    const v = await visit('/r/to', {
      'content-security-policy-report-only': "script-src 'nonce-r4nd0m' 'report-sample'; report-to csp",
      'reporting-endpoints': 'csp="https://site.test/csp-to"',
    }, t.REPORT_PAGE_HTML, [observer]);
    await v.page.waitForTimeout(500);
    const ro = (await v.page.evaluate(() => (window as unknown as { __ro: unknown[] }).__ro)) as { body: { blockedURL: string } }[];
    expect(ro.find((r) => r.body.blockedURL === 'inline')).toEqual(JSON.parse(t.REPORT_TO_BODY));
    expect(ro.map((r) => r.body.blockedURL)).toContain('http://cdn.test/s/cdn.js?token=SECRET123');
    await v.close();
  });

  it('с report-to Chromium не шлёт report-uri', async () => {
    const v = await visit('/r/both', {
      'content-security-policy-report-only': "script-src 'nonce-r4nd0m'; report-uri /csp-uri-both; report-to csp",
      'reporting-endpoints': 'csp="https://site.test/csp-to"',
    }, t.REPORT_PAGE_HTML);
    await v.page.click('#b');
    await v.page.waitForTimeout(1500);
    expect(reportsAt('/csp-uri-both')).toHaveLength(0);
    await v.close();
  });

  it('две политики сразу: применённая — [error], report-only — [info]; чужой скрипт выполнился', async () => {
    const lines = t.TWO_HEADERS_CODE.split('\n').filter((l) => !l.startsWith('#') && l.trim());
    const enforce = lines[0].replace('Content-Security-Policy: ', '');
    const ro = (lines[1] + lines[2]).replace('Content-Security-Policy-Report-Only: ', '').replace(';  ', '; ');
    expect(ro).toBe("script-src 'nonce-r4nd0m' 'strict-dynamic'; report-uri /csp-ro2");
    const v = await visit('/r/two', { 'content-security-policy': enforce, 'content-security-policy-report-only': ro }, t.REPORT_PAGE_HTML, [t.MARK_CODE]);
    await v.page.waitForTimeout(500);
    expect(await v.page.evaluate(() => (window as unknown as { ran: string[] }).ran)).toEqual(['cdn-src']);
    expect(v.console.some((c) => c.startsWith('[error]') && c.endsWith('The action has been blocked.'))).toBe(true);
    expect(v.console.some((c) => c.startsWith('[info]') && c.endsWith('The policy is report-only, so the violation has been logged but no further action has been taken.'))).toBe(true);
    expect(reportsAt('/csp-ro2').map((r) => JSON.parse(r.body)['csp-report']['blocked-uri'])).toContain('http://cdn.test/s/cdn.js?token=SECRET123');
    await v.close();
  });
});

// ─── <meta> ──────────────────────────────────────────────────────────────────────────────

describe('<meta> против заголовка', () => {
  const metaConsole = (k: string) => t.META_ROWS.find((r) => r.k.includes(k))!.console;

  it('META_PAGE_HTML: скрипт до meta выполнился, три директивы проигнорированы, отчётов нет', async () => {
    const v = await visit('/meta/a', {}, t.META_PAGE_HTML);
    const w = await v.page.evaluate(() => {
      const g = window as unknown as Record<string, string | undefined>;
      return [g.before, g.after, g.nonced];
    });
    expect(w).toEqual(['выполнился', undefined, 'выполнился']);
    for (const k of ['`frame-ancestors`', '`report-uri`', '`sandbox`']) expect(v.console).toContain(`[error] ${metaConsole(k)}`);
    await v.page.waitForTimeout(300);
    expect(reports.filter((r) => r.path === '/meta-report')).toHaveLength(0);
    await v.close();
  });

  it('report-only в meta и meta в body выбрасываются целиком', async () => {
    const ro = await visit('/meta/ro', {}, `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy-Report-Only" content="script-src 'none'">
</head><body><script>window.x = 1</script></body></html>`);
    expect(ro.console).toContain(`[error] ${metaConsole('Report-Only')}`);
    await ro.close();
    const body = await visit('/meta/body', {}, `<!doctype html><html><head><meta charset="utf-8"></head><body>
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<script>window.inBody = 'выполнился'</script></body></html>`);
    expect(body.console).toContain(`[error] ${metaConsole('в `<body>`')}`);
    expect(await body.page.evaluate(() => (window as unknown as { inBody: string }).inBody)).toBe('выполнился');
    await body.close();
  });

  it('frame-ancestors в заголовке не даёт встроить страницу, в meta — даёт', async () => {
    pages.set('/fa/header', { headers: csp("frame-ancestors 'none'"), body: '<p id=p>header</p>' });
    pages.set('/fa/meta', { headers: {}, body: `<head><meta http-equiv="Content-Security-Policy" content="frame-ancestors 'none'"></head><p id=p>meta</p>` });
    // Встраивает other.test — другой origin.
    const v = await visit('/fa/host', {}, `<!doctype html><iframe src="${t.SITE}/fa/header"></iframe><iframe src="${t.SITE}/fa/meta"></iframe>`, [], 'http://other.test');
    await v.page.waitForTimeout(800);
    const texts: string[] = [];
    for (const f of v.page.frames().slice(1)) texts.push(await f.evaluate(() => document.getElementById('p')?.textContent ?? 'пусто').catch(() => 'ошибка'));
    expect(texts).toContain('meta');
    expect(texts).not.toContain('header');
    expect(v.console.join('\n')).toContain(`violates the following Content Security Policy directive: "frame-ancestors 'none'"`);
    await v.close();
  });
});

// ─── Trusted Types ───────────────────────────────────────────────────────────────────────

const TT_ONLY = csp("require-trusted-types-for 'script'");

describe('Trusted Types', () => {
  it('места вставки из SINK_ROWS требуют свой тип, образцы отчётов — дословно', async () => {
    const probe = `window.__tt = []; window.__v = [];
document.addEventListener('securitypolicyviolation', (e) => __v.push(e.sample));
const probe = (fn) => { try { fn(); __tt.push('прошло'); } catch (e) { __tt.push(e.name + ': ' + e.message); } };
const d = document.createElement('div');
probe(() => { d.innerHTML = '<b>x</b>'; });
probe(() => { const x = document.createElement('i'); d.append(x); x.outerHTML = '<b>y</b>'; });
probe(() => d.insertAdjacentHTML('beforeend', '<b>z</b>'));
probe(() => { document.createElement('iframe').srcdoc = '<b>x</b>'; });
probe(() => new DOMParser().parseFromString('<b>x</b>', 'text/html'));
probe(() => document.createRange().createContextualFragment('<b>x</b>'));
probe(() => d.setHTMLUnsafe('<b>x</b>'));
probe(() => { document.createElement('script').src = '/s/dyn.js'; });
probe(() => { document.createElement('script').text = '1'; });
probe(() => d.setAttribute('onclick', 'f()'));
probe(() => setTimeout('void 0'));
probe(() => eval('1+1'));
probe(() => d.setHTML('<b>x</b>'));
probe(() => { d.textContent = '<b>x</b>'; });
probe(() => { document.createElement('img').src = '/x.png'; });
probe(() => { document.createElement('a').href = 'javascript:void 0'; });`;
    const v = await visit('/tt/sinks', TT_ONLY, `<!doctype html><script>${probe}</script>`);
    const res = (await v.page.evaluate(() => (window as unknown as { __tt: string[] }).__tt)) as string[];
    const samples = (await v.page.evaluate(() => (window as unknown as { __v: string[] }).__v)) as string[];
    const n = t.SINK_ROWS.length;
    // Все места, кроме последнего (eval), — TypeError с именем требуемого типа.
    for (let i = 0; i < n - 1; i++) {
      expect(res[i], t.SINK_ROWS[i].k).toMatch(/^TypeError: .*This document requires/);
      expect(res[i], t.SINK_ROWS[i].k).toContain(`'${t.SINK_ROWS[i].type}'`);
    }
    expect(res[n - 1]).toBe("EvalError: Evaluating a string as JavaScript violates this document's Trusted Type assignment requirements.");
    expect(res.slice(n)).toEqual(t.SINK_FREE.map(() => 'прошло'));
    for (const row of t.SINK_ROWS) expect(samples, row.k).toContain(row.sample);
    await v.close();
  });

  it('TT_POLICY_CODE: TrustedHTML проходит экранированным, строка — TypeError', async () => {
    const v = await visit('/tt/policy', csp(t.TT_HEADER_CODE.replace('Content-Security-Policy: ', '')), `<!doctype html><script>${t.TT_POLICY_CODE}</script>`);
    expect(v.console).toContain('[log] &lt;img src=x onerror=alert(1)&gt;');
    expect(t.TT_POLICY_CODE).toContain('// &lt;img src=x onerror=alert(1)&gt;');
    expect(v.errors).toEqual(["TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment."]);
    await v.close();
  });

  it('имена политик: TT_NAMES_ROWS', async () => {
    const code = `window.__r = []; const p = (f) => { try { f(); __r.push('ok'); } catch (e) { __r.push(e.message); } };
p(() => trustedTypes.createPolicy('app', {})); p(() => trustedTypes.createPolicy('app', {})); p(() => trustedTypes.createPolicy('other', {}));`;
    const run = async (h: string | null) => {
      const v = await visit('/tt/names', csp(h), `<!doctype html><script>${code}</script>`);
      const r = (await v.page.evaluate(() => (window as unknown as { __r: string[] }).__r)) as string[];
      await v.close();
      return r;
    };
    expect(await run("require-trusted-types-for 'script'")).toEqual(['ok', 'ok', 'ok']);
    const named = await run("require-trusted-types-for 'script'; trusted-types app");
    expect(named[0]).toBe('ok');
    expect(named[1]).toContain('Policy with name "app" already exists.');
    expect(named[2]).toContain('Policy "other" disallowed.');
    expect(t.TT_NAMES_ROWS[1].what).toContain('Policy "other" disallowed.');
    expect(await run("require-trusted-types-for 'script'; trusted-types app other 'allow-duplicates'")).toEqual(['ok', 'ok', 'ok']);
    expect((await run("trusted-types 'none'")).every((r) => r.includes('disallowed'))).toBe(true);
  });

  it('DEFAULT_POLICY_CODE: консоль совпадает с DEFAULT_POLICY_LOG', async () => {
    const v = await visit('/tt/default', csp("require-trusted-types-for 'script'; trusted-types default"), `<!doctype html><script>${t.DEFAULT_POLICY_CODE}</script>`);
    const logs = v.console.filter((c) => c.startsWith('[log] ')).map((c) => c.slice(6));
    expect([...logs, ...v.errors].join('\n')).toBe(t.DEFAULT_POLICY_LOG);
    await v.close();
  });

  it('отчёт Trusted Types: образец «место|строка», 40 символов', async () => {
    reports.length = 0;
    const v = await visit('/tt/ro', { 'content-security-policy-report-only': "require-trusted-types-for 'script'; report-uri /tt-report" },
      `<!doctype html><script>document.createElement('div').innerHTML = '<img src=x onerror="alert(document.cookie)">';</script>`);
    await v.page.waitForTimeout(800);
    const r = reports.filter((x) => x.path === '/tt-report').map((x) => JSON.parse(x.body)['csp-report']);
    expect(r).toHaveLength(1);
    expect(r[0]['blocked-uri']).toBe('trusted-types-sink');
    expect(r[0]['script-sample']).toBe('Element innerHTML|<img src=x onerror="alert(document.cooki');
    expect(r[0]['script-sample'].split('|')[1]).toHaveLength(40);
    await v.close();
  });
});

// ─── Фреймворки ──────────────────────────────────────────────────────────────────────────

describe('Vue и React под Trusted Types — FW_ROWS', () => {
  const DEFINE = {
    'process.env.NODE_ENV': '"production"',
    __VUE_OPTIONS_API__: 'true',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  };
  async function bundle(contents: string, loader: 'js' | 'jsx' = 'js') {
    const r = await build({
      stdin: { contents, resolveDir: process.cwd(), loader },
      bundle: true, write: false, format: 'iife', minify: true, jsx: 'automatic', define: DEFINE, logLevel: 'silent',
    });
    return r.outputFiles[0].text;
  }
  const renderFn = (tpl: string, opts = {}) =>
    compile(tpl, { mode: 'module', ...opts }).code.replace('export function render', 'function render');

  beforeAll(async () => {
    assets.set('/assets/vue-html.js', await bundle(`import { createApp } from 'vue';
${renderFn('<div id="out" v-html="html"></div>')}
window.__run = (trusted) => {
  let html = '<b>x</b>';
  if (trusted) html = trustedTypes.createPolicy('app', { createHTML: (s) => s }).createHTML(html);
  try { createApp({ data: () => ({ html }), render }).mount('#app'); return document.getElementById('out').innerHTML === '<b>x</b>' ? 'вставлено' : 'не то'; }
  catch (e) { return e.name; }
};`));
    const big = '<div id="out"><ul>' + Array.from({ length: 25 }, (_, i) => `<li class="i">пункт ${i}</li>`).join('') + '</ul><p>{{ n }}</p></div>';
    const bigCode = renderFn(big, { hoistStatic: true, prefixIdentifiers: true });
    expect(bigCode).toContain('createStaticVNode');
    assets.set('/assets/vue-static.js', await bundle(`import { createApp } from 'vue';
${bigCode}
window.__run = () => { try { createApp({ data: () => ({ n: 1 }), render }).mount('#app'); return document.querySelectorAll('li').length === 25 ? 'вставлено' : 'не то'; } catch (e) { return e.name; } };`));
    const reactMount = (useCode: boolean) => `import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
${useCode ? `const sanitize = (s) => s;\n${t.REACT_TT_CODE}` : `function Comment({ html }) { return <div className="comment" dangerouslySetInnerHTML={{ __html: html }} />; }`}
window.__run = () => {
  let err = null;
  try {
    const root = createRoot(document.getElementById('app'), { onUncaughtError: (e) => { err = e.name; } });
    flushSync(() => root.render(<Comment html="<b>x</b>" />));
  } catch (e) { err = e.name; }
  return err ?? (document.querySelector('.comment')?.innerHTML === '<b>x</b>' ? 'вставлено' : 'не то');
};`;
    assets.set('/assets/react-str.js', await bundle(reactMount(false), 'jsx'));
    assets.set('/assets/react-tt.js', await bundle(reactMount(true), 'jsx'));
  }, 60_000);

  async function run(asset: string, header: string | null, arg = false) {
    const v = await visit(`/fw${asset}-${header?.length ?? 0}`, csp(header), `<!doctype html><div id="app"></div><script src="${asset}"></script>`);
    const r = (await v.page.evaluate((a) => (window as unknown as { __run: (x: boolean) => string }).__run(a), arg)) as string;
    await v.close();
    return r;
  }
  const cell = (s: string) => s.replaceAll('*', '');
  const cols = ['none', 'any', 'app', 'vue'] as const;

  it('Vue: v-html со строкой и шаблон с большой статикой', async () => {
    for (const c of cols) {
      expect(await run('/assets/vue-html.js', t.FW_HEADERS[c]), `v-html ${c}`).toBe(cell(t.FW_ROWS[0][c]));
      expect(await run('/assets/vue-static.js', t.FW_HEADERS[c]), `static ${c}`).toBe(cell(t.FW_ROWS[2][c]));
    }
    expect(await run('/assets/vue-html.js', t.FW_HEADERS.app, true)).toBe(cell(t.FW_ROWS[1].app));
  }, 60_000);

  it('React 19: строка — TypeError под любым TT, TrustedHTML из REACT_TT_CODE — вставлено', async () => {
    for (const c of cols) {
      expect(await run('/assets/react-str.js', t.FW_HEADERS[c]), `str ${c}`).toBe(cell(t.FW_ROWS[3][c]));
      expect(await run('/assets/react-tt.js', t.FW_HEADERS[c]), `tt ${c}`).toBe(cell(t.FW_ROWS[4][c]));
    }
  }, 60_000);

  it('исходник Vue в теме — дословно из установленного @vue/runtime-dom', () => {
    const file = readFileSync(require.resolve('@vue/runtime-dom/dist/runtime-dom.esm-bundler.js'), 'utf8');
    expect(file).toContain(t.VUE_SOURCE);
    expect(file).toContain(t.VUE_SOURCE_LINE);
    expect((require('vue/package.json') as { version: string }).version).toBe('3.5.42');
    expect((require('react/package.json') as { version: string }).version).toBe('19.3.0');
  });

  it('Chromium — та версия, что в шапке', () => {
    expect(browser.version()).toBe('153.0.8010.12');
  });
});
