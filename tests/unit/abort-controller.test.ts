import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, addAbortListener, getEventListeners, getMaxListeners, once } from 'node:events';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { setInterval as every, setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/abort-controller/data';
import { compareScenario, loadMini, nativeImpl, runScenario } from '@/widgets/abort-lab/model/run';

/**
 * Тема «Отмена: AbortController и AbortSignal».
 *
 * Код примеров — строки из `data.ts`, те же, что печатает страница. Главная проверка — учебная
 * реализация `MINI_CODE` против настоящих классов Node на всех сценариях демо: оба вывода
 * обязаны совпасть с `SCENARIO_LOGS` (их же стенд снял в Chromium 153). Всё, что зависит от
 * версии Node (сборка зависимых сигналов, слушатели встроенного fetch), проверяется в отдельном
 * процессе и сверяется с колонкой той версии, на которой идёт прогон.
 */

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...a: unknown[]) => Promise<unknown>;

/** Исполнить строку как ES-модуль в отдельном процессе; вернуть stdout и код выхода. */
function runModule(code: string, flags: string[] = []) {
  const r = spawnSync(process.execPath, [...flags, '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 30_000 });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

const NODE = process.version; // стенд: v24.11.0

describe('сценарии демо: учебные классы против настоящих', () => {
  it.each(t.SCENARIOS)('$label: настоящий AbortController Node печатает SCENARIO_LOGS', async (sc) => {
    expect(await runScenario(sc, nativeImpl(), t.TRACK_CODE)).toEqual(t.SCENARIO_LOGS[sc.id]);
  });

  it.each(t.SCENARIOS)('$label: учебная реализация совпадает с настоящей', async (sc) => {
    const r = await compareScenario(sc, t.MINI_CODE, t.TRACK_CODE);
    expect(r.mini).toEqual(r.native);
    expect(r.same).toBe(true);
  });

  it('у каждого сценария есть литерал вывода, и наоборот', () => {
    expect(Object.keys(t.SCENARIO_LOGS).sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
  });

  it('учебный конструктор сигнала закрыт, как настоящий', () => {
    const mini = loadMini(t.MINI_CODE) as { AbortSignal: new () => unknown };
    expect(() => new mini.AbortSignal()).toThrow(TypeError);
    expect(() => new (AbortSignal as unknown as new () => unknown)()).toThrow(TypeError);
  });

  it('MINI_DIFF: isTrusted у учебного события false, у настоящего true; причина — не DOMException', () => {
    const mini = loadMini(t.MINI_CODE) as { AbortController: typeof AbortController };
    const flags: boolean[] = [];
    for (const C of [mini.AbortController, AbortController]) {
      const ac = new C();
      ac.signal.addEventListener('abort', (e) => flags.push(e.isTrusted));
      ac.abort();
    }
    expect(flags).toEqual([false, true]);
    const m = new mini.AbortController();
    m.abort();
    expect(m.signal.reason).not.toBeInstanceOf(DOMException);
    expect(m.signal.reason.name).toBe('AbortError');
  });

  it('AbortSignal.abort(null) — причина null у обеих реализаций', () => {
    const mini = loadMini(t.MINI_CODE) as { AbortSignal: typeof AbortSignal };
    for (const S of [mini.AbortSignal, AbortSignal]) {
      const s = S.abort(null);
      expect([s.aborted, s.reason]).toEqual([true, null]);
    }
  });
});

describe('раздел «Контроллер и сигнал»', () => {
  it('у сигнала нет abort; PAIR_CODE отменяет прошлый запрос', async () => {
    expect('abort' in new AbortController().signal).toBe(false);

    const input = Object.assign(new EventTarget(), { value: '' });
    const events: string[] = [];
    const fetchStub = (url: string, { signal }: { signal: AbortSignal }) =>
      new Promise((ok, fail) => {
        const t2 = setTimeout(() => ok(url), 20);
        signal.addEventListener('abort', () => {
          clearTimeout(t2);
          fail(signal.reason);
        });
      });
    const show = (v: string) => events.push('показан ' + v);
    const ignoreAbort = (e: Error) => events.push('отменён: ' + e.name);
    const code = `${t.PAIR_CODE}\ninput.value = 'ка'; input.dispatchEvent(new Event('input'));\ninput.value = 'кот'; input.dispatchEvent(new Event('input'));`;
    await new AsyncFunction('input', 'fetch', 'show', 'ignoreAbort', code)(input, fetchStub, show, ignoreAbort);
    await sleep(40);
    expect(events).toEqual(['отменён: AbortError', 'показан /api/search?q=кот']);
  });

  it('ORDER_FACTS: ошибка слушателя в Node — после возврата abort(), uncaughtException роняет процесс', () => {
    const r = runModule(`
      const ac = new AbortController();
      ac.signal.addEventListener('abort', () => { console.log('a'); throw new Error('boom'); });
      ac.signal.addEventListener('abort', () => console.log('b'));
      ac.abort();
      console.log('после abort()');
    `);
    expect(r.stdout.trim().split('\n')).toEqual(['a', 'b', 'после abort()']);
    expect(r.stderr).toContain('boom');
    expect(r.status).not.toBe(0);
  });
});

describe('раздел «Устройство»: сборщик и any()', () => {
  it('GC_ROWS совпадает с колонкой текущей версии Node', () => {
    const code = `
      globalThis.long = new AbortController();
      const mk = (kind) => { const refs = []; for (let i = 0; i < 1000; i++) {
        if (kind === 'none') refs.push(new WeakRef(AbortSignal.any([long.signal])));
        if (kind === 'listener') { const s = AbortSignal.any([long.signal]); s.addEventListener('abort', () => {}); refs.push(new WeakRef(s)); }
        if (kind === 'removed') { const s = AbortSignal.any([long.signal]); const f = () => {}; s.addEventListener('abort', f); s.removeEventListener('abort', f); refs.push(new WeakRef(s)); }
        if (kind === 'abortedDep') { const c = new AbortController(); const s = AbortSignal.any([long.signal, c.signal]); s.addEventListener('abort', () => {}); c.abort(); refs.push(new WeakRef(s)); }
      } return refs; };
      const R = { none: mk('none'), listener: mk('listener'), removed: mk('removed'), abortedDep: mk('abortedDep') };
      await new Promise((r) => setTimeout(r, 0)); gc(); gc(); await new Promise((r) => setTimeout(r, 0)); gc();
      console.log(JSON.stringify(Object.values(R).map((v) => v.filter((r) => r.deref()).length)));
    `;
    const alive = JSON.parse(runModule(code, ['--expose-gc']).stdout) as number[];
    // Последний сигнал в цикле может держать регистр — допуск в одну штуку.
    const near = (n: number) => (n <= 1 ? 0 : n);
    const col = NODE.startsWith('v24.') ? 'node24' : NODE.startsWith('v26.') ? 'node26' : null;
    if (!col) return;
    expect(alive.map(near).map((n) => `${n} из 1000`)).toEqual(t.GC_ROWS.map((r) => r[col]));
  });
});

describe('раздел «fetch»: свой сервер, шесть стадий', () => {
  it('SERVER_CODE + CLIENT_CODE дают FETCH_RESULT', () => {
    const code = `${t.SERVER_CODE}
await new Promise((r) => server.listen(0, '127.0.0.1', r));
${t.CLIENT_CODE}
await sleep(150);
console.log(JSON.stringify({ client, seen }));
server.closeAllConnections(); server.close();`;
    const r = runModule(code);
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual(t.FETCH_RESULT);
  });

  it('FETCH_ROWS описывает шесть шагов клиента', () => {
    expect(t.FETCH_ROWS).toHaveLength(t.FETCH_RESULT.client.length);
  });

  it('FETCH_FACTS: коды DOMException — 20 у AbortError, 23 у TimeoutError', () => {
    expect(new DOMException('', 'AbortError').code).toBe(20);
    expect(new DOMException('', 'TimeoutError').code).toBe(23);
    expect(AbortSignal.abort().reason).toBeInstanceOf(DOMException);
  });

  it('FETCH_FACTS: HTTP/2 — отмена закрывает поток с кодом CANCEL (8), сессия живёт', async () => {
    const log: string[] = [];
    let sessions = 0;
    const server = http2.createServer();
    server.on('session', () => sessions++);
    server.on('stream', (stream, h) => {
      stream.on('close', () => log.push(`${h[':path']} rstCode=${stream.rstCode}`));
      if (h[':path'] === '/fast') {
        stream.respond({ ':status': 200 });
        stream.end('ok');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    const ac = new AbortController();
    const req = client.request({ ':path': '/slow' }, { signal: ac.signal });
    const err = new Promise<Error>((r) => req.on('error', r));
    await sleep(50);
    ac.abort();
    expect((await err).name).toBe('AbortError');
    await sleep(50);
    const r2 = client.request({ ':path': '/fast' });
    r2.resume();
    await new Promise((r) => r2.on('end', r));
    await sleep(30);
    client.close();
    server.close();
    expect(log).toEqual(['/slow rstCode=8', '/fast rstCode=0']);
    expect(sessions).toBe(1);
  });
});

describe('раздел «timeout и any»', () => {
  let server: http.Server;
  let base = '';
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') setTimeout(() => res.destroyed || res.end('поздно'), 500);
      else res.end('быстро');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const load = () => new Function(`${t.COMBINE_CODE}\nreturn load;`)() as (u: string, o?: object) => Promise<Response>;

  it('COMBINE_CODE: таймаут — своя ошибка с TimeoutError в cause', async () => {
    const e = (await load()(base + '/slow', { ms: 50 }).catch((x) => x)) as Error;
    expect(e.message).toBe('сервер не ответил за 50 мс');
    expect((e.cause as Error).name).toBe('TimeoutError');
  });

  it('COMBINE_CODE: отмена пользователем выходит как есть; быстрый ответ проходит', async () => {
    const ac = new AbortController();
    const p = load()(base + '/slow', { signal: ac.signal, ms: 5000 }).catch((x) => x);
    await sleep(30);
    ac.abort();
    expect(((await p) as Error).name).toBe('AbortError');
    expect(await (await load()(base + '/fast', { ms: 1000 })).text()).toBe('быстро');
  });

  it('COMBINE_FACTS: таймер timeout() в Node не держит процесс — выход с кодом 13', () => {
    const r = runModule(`const s = AbortSignal.timeout(50); await new Promise((r) => s.addEventListener('abort', r)); console.log('дождались');`);
    expect(r.stdout).toBe('');
    expect(r.status).toBe(13);
  });
});

describe('раздел «Свой код»', () => {
  type Delay = (ms: number, o?: { signal?: AbortSignal }) => Promise<void>;
  const delay = () => new Function(`${t.DELAY_CODE}\nreturn delay;`)() as Delay;

  it('DELAY_CODE: 100 вызовов на одном сигнале — 0 слушателей', async () => {
    const d = delay();
    const ac = new AbortController();
    for (let i = 0; i < 100; i++) await d(0, { signal: ac.signal });
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
  });

  it('DELAY_CODE: отменённый заранее — отклонённый промис, а не синхронный throw', async () => {
    let p: Promise<void> | undefined;
    expect(() => {
      p = delay()(10, { signal: AbortSignal.abort() });
    }).not.toThrow();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('DELAY_CODE: отмена посреди ожидания — отказ с reason, слушатель снят', async () => {
    const ac = new AbortController();
    const why = new Error('стоп');
    const p = delay()(1000, { signal: ac.signal });
    ac.abort(why);
    await expect(p).rejects.toBe(why);
    expect(getEventListeners(ac.signal, 'abort')).toHaveLength(0);
  });

  it('LEAK_NODE_NOTE: у AbortSignal порог предупреждения 0, у EventTarget — 10', () => {
    expect(getMaxListeners(new AbortController().signal)).toBe(0);
    expect(getMaxListeners(new EventTarget())).toBe(10);
  });

  it('LEAK_NODE_NOTE: встроенный fetch Node 24.11 оставляет по слушателю на запрос', () => {
    if (!NODE.startsWith('v24.11')) return;
    const r = runModule(`
      import http from 'node:http'; import { getEventListeners } from 'node:events';
      const server = http.createServer((q, s) => s.end('ok')); await new Promise((r) => server.listen(0, '127.0.0.1', r));
      const ac = new AbortController(); const url = 'http://127.0.0.1:' + server.address().port + '/';
      for (let i = 0; i < 200; i++) await (await fetch(url, { signal: ac.signal })).text();
      console.log(getEventListeners(ac.signal, 'abort').length); server.closeAllConnections(); server.close();
    `);
    expect(Number(r.stdout.trim())).toBe(200);
    expect(t.LEAK_NODE_NOTE).toContain('200 слушателей');
  });

  describe('NODE_API_ROWS', () => {
    it('timers/promises: setTimeout и цикл по setInterval', async () => {
      const ac = new AbortController();
      const p = sleep(1000, null, { signal: ac.signal });
      expect(getEventListeners(ac.signal, 'abort')).toHaveLength(1);
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });

      const ac2 = new AbortController();
      let n = 0;
      const e = await (async () => {
        for await (const tick of every(5, 'тик', { signal: ac2.signal })) if (tick && ++n === 3) ac2.abort();
      })().catch((x) => x);
      expect([n, e.name]).toEqual([3, 'AbortError']);
    });

    it('events.once: слушатель снимается с эмиттера', async () => {
      const ee = new EventEmitter();
      const ac = new AbortController();
      const p = once(ee, 'ready', { signal: ac.signal });
      expect(ee.listenerCount('ready')).toBe(1);
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
      expect(ee.listenerCount('ready')).toBe(0);
    });

    it('fs.readFile: отказ AbortError', async () => {
      const ac = new AbortController();
      const p = readFile(new URL(import.meta.url), { signal: ac.signal });
      ac.abort();
      await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('child_process.spawn: SIGTERM по умолчанию, killSignal — по выбору', async () => {
      const kill = (opts: object) =>
        new Promise<{ err: string; sig: string | null }>((resolve) => {
          const ac = new AbortController();
          let err = '';
          const cp = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { signal: ac.signal, ...opts });
          cp.on('error', (e) => (err = e.name));
          cp.on('exit', (_code, sig) => resolve({ err, sig }));
          setTimeout(() => ac.abort(), 50);
        });
      expect(await kill({})).toEqual({ err: 'AbortError', sig: 'SIGTERM' });
      expect(await kill({ killSignal: 'SIGINT' })).toEqual({ err: 'AbortError', sig: 'SIGINT' });
    });

    it('events.addAbortListener: Disposable снимает слушателя', () => {
      const ac = new AbortController();
      const fired: string[] = [];
      const d = addAbortListener(ac.signal, () => fired.push('сработал'));
      expect(typeof d[Symbol.dispose]).toBe('function');
      d[Symbol.dispose]();
      ac.abort();
      expect(fired).toEqual([]);
    });

    it('pipeTo с signal: cancel у источника, abort у приёмника, прочитанное дописано', async () => {
      const log: string[] = [];
      const ac = new AbortController();
      let pulled = 0;
      let written = 0;
      const source = new ReadableStream(
        {
          pull(c) {
            c.enqueue(++pulled);
          },
          cancel(r) {
            log.push('cancel ' + r.name);
          },
        },
        { highWaterMark: 0 },
      );
      const sink = new WritableStream({
        async write() {
          await sleep(10);
          written++;
        },
        abort(r) {
          log.push('abort ' + r.name);
        },
      });
      const piping = source.pipeTo(sink, { signal: ac.signal });
      await sleep(35);
      ac.abort();
      const e = await piping.catch((x) => x);
      expect(e.name).toBe('AbortError');
      // Порядок двух вызовов различается между версиями Node (24.11 и 26.8) — сверяется набор.
      expect(log.sort()).toEqual(['abort AbortError', 'cancel AbortError']);
      expect(written).toBe(pulled);
    });
  });

  it('NODE_ERR_CODE: значения совпадают с комментариями', () => {
    const lines = t.NODE_ERR_CODE.split('\n').filter((l) => /^from\w+[.\s].*;\s+\/\//.test(l));
    const exprs = lines.map((l) => l.slice(0, l.indexOf(';')));
    const comments = lines.map((l) => l.slice(l.indexOf('//') + 2).trim());
    const head = t.NODE_ERR_CODE.slice(0, t.NODE_ERR_CODE.indexOf('\nfromFetch ==='));
    const r = runModule(`${head}\nconsole.log(JSON.stringify([${exprs.join(', ')}]));`);
    const values = JSON.parse(r.stdout) as unknown[];
    expect(values).toEqual([true, false, 'AbortError', 'ABORT_ERR', true, false]);
    values.forEach((v, i) => expect(comments[i].startsWith(typeof v === 'string' ? `'${v}'` : String(v))).toBe(true));
  });
});

describe('раздел «Гонка»', () => {
  it('RACE_CODE: данные получены, слушатель отработал, сигнал отменён', async () => {
    const out: string[] = [];
    await new AsyncFunction('log', t.RACE_CODE)((s: string) => out.push(s));
    expect(out).toEqual(t.RACE_LOG);
  });

  it('SHARED_CODE: запрос живёт, пока остался хоть один потребитель', async () => {
    const out: string[] = [];
    await new AsyncFunction('log', `${t.SHARED_CODE}\n${t.SHARED_DEMO_CODE}`)((s: string) => out.push(s));
    await sleep(30);
    expect(out).toEqual(t.SHARED_LOG);
  });
});
