import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/platform/browser-storage/data';
import { loadHarness, loadModel, sameLog } from '@/widgets/tx-lab/model/run';
import type { TxScenario } from '@/widgets/tx-lab/model/types';

/**
 * Тема «Хранилища браузера».
 *
 * `TX_MODEL_CODE` — учебная модель жизни транзакции IndexedDB, строкой из темы: напечатана
 * на странице и исполняется демо. Здесь её журнал сверяется на каждом сценарии с двумя
 * настоящими реализациями: с `fake-indexeddb` 6.2.5 (через ту же обвязку `TX_HARNESS_CODE`, что
 * исполнял стенд) и с журналами Chromium 153, снятыми стендом (`STAND.tx`). Отдельно проверено,
 * что сценарии различают модели: модель, где `await` готового промиса считается новой задачей,
 * или где обработчик запроса не возвращает активность, на них краснеет.
 *
 * Код версий и индексов (`OLD_TAB_CODE`, `NEW_TAB_CODE`, `INDEX_CODE`) исполняется
 * в `fake-indexeddb` и сверяется с журналами Chromium. `LS_TYPES_CODE` — в отдельном процессе
 * Node с `--experimental-webstorage`: в процессе vitest `localStorage` нет. Числа из текста
 * сверяются с литералами стенда. Браузерный прогон не повторяется.
 */

const model = loadModel(t.TX_MODEL_CODE);
const runTx = loadHarness(t.TX_HARNESS_CODE);

/** `fetch('/slow')` стенда: ответ приходит новой задачей, через 150 мс, со статусом 200. */
const slowFetch = () => new Promise<{ status: number }>((ok) => setTimeout(() => ok({ status: 200 }), 150));
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

const lines = (code: string) => code.split('\n');

describe('сценарии транзакции', () => {
  it('девять сценариев, у каждого шаг на строку кода и журнал Chromium', () => {
    expect(t.DEMO_SCENARIOS).toHaveLength(9);
    expect(t.STAND.txRuns).toBe(5);
    for (const s of t.DEMO_SCENARIOS) {
      expect(s.steps.length, s.id).toBe(lines(s.code).length);
      expect(s.chromium, s.id).toEqual(t.STAND.tx[s.id]);
      expect(s.label.length, s.id).toBeGreaterThan(0);
    }
  });

  it.each(t.DEMO_SCENARIOS.map((s) => [s.id, s] as [string, TxScenario]))(
    '%s: модель = Chromium',
    (_id, s) => {
      expect(model(s.steps, s.initial).log).toEqual(s.chromium);
    },
  );

  it.each(t.DEMO_SCENARIOS.map((s) => [s.id, s] as [string, TxScenario]))(
    '%s: fake-indexeddb через ту же обвязку = Chromium',
    async (_id, s) => {
      const log = await runTx(new IDBFactory(), s, slowFetch);
      expect(log).toEqual(s.chromium);
    },
  );

  it('журнал модели: строки кода существуют, транзакция в конце завершена', () => {
    for (const s of t.DEMO_SCENARIOS) {
      const { trace } = model(s.steps, s.initial);
      const n = lines(s.code).length;
      for (const e of trace) if (e.line !== null) expect(e.line, s.id).toBeLessThan(n);
      expect(trace.at(-1)?.state, s.id).toBe('finished');
    }
  });

  it('исключение показано на той строке, что его бросила', () => {
    const at = (id: string) => {
      const s = t.DEMO_SCENARIOS.find((x) => x.id === id) as TxScenario;
      const e = model(s.steps, s.initial).trace.find((x) => x.what.startsWith('исключение'));
      return e && e.line !== null ? lines(s.code)[e.line] : '';
    };
    expect(at('fetch')).toBe('store.put({ id: 2 });');
    expect(at('timeout')).toBe('store.put({ id: 2 });');
    expect(at('commit')).toBe('store.put({ id: 2 });');
    expect(at('empty')).toBe("const store = tx.objectStore('notes');");
  });

  it('сценарии различают модели: неверная модель на них краснеет', () => {
    const find = (id: string) => t.DEMO_SCENARIOS.find((x) => x.id === id) as TxScenario;

    // «await готового промиса — новая задача»: тогда пример с микрозадачей упал бы.
    const microAsTask = t.TX_MODEL_CODE.replace(
      "micro.push(resume);\n        note(line, 'await: продолжение — микрозадачей');",
      "tasks.push({ name: 'таймер', run: resume });\n        note(line, 'await: продолжение — микрозадачей');",
    );
    expect(microAsTask).not.toBe(t.TX_MODEL_CODE);
    const m1 = loadModel(microAsTask);
    expect(sameLog(m1(find('micro').steps, []).log, t.STAND.tx.micro)).toBe(false);

    // «обработчик запроса не возвращает активность»: тогда обёртка вроде idb не работала бы.
    const noReactivate = t.TX_MODEL_CODE.replace("if (tx.state === 'inactive') tx.state = 'active';", '');
    expect(noReactivate).not.toBe(t.TX_MODEL_CODE);
    const m2 = loadModel(noReactivate);
    const req = find('request');
    expect(sameLog(m2(req.steps, req.initial).log, t.STAND.tx.request)).toBe(false);
  });

  it('тексты ошибок Chromium — с именем, которое видит обвязка', () => {
    expect(t.STAND.txMessages.inactive).toMatch(/not active/);
    expect(t.STAND.txMessages.finished).toMatch(/has finished/);
  });
});

describe('версии базы: versionchange и blocked', () => {
  async function run(polite: boolean) {
    const idb = new IDBFactory();
    const log: string[] = [];
    let dbA: IDBDatabase | undefined;
    const wrapA = {
      open: (name: string, version?: number) => {
        const r = idb.open(name, version);
        r.addEventListener('success', () => (dbA = r.result));
        return r;
      },
    };
    const oldCode = polite ? t.OLD_TAB_CODE : t.OLD_TAB_CODE.replace(t.POLITE_LINE, '');
    if (!polite) expect(oldCode).not.toBe(t.OLD_TAB_CODE);
    new Function('indexedDB', 'log', oldCode)(wrapA, (m: string) => log.push(m));
    await sleep(30);
    new Function('indexedDB', 'log', t.NEW_TAB_CODE)(idb, (m: string) => log.push(m));
    await sleep(60);
    return { idb, log, closeA: () => dbA?.close() };
  }

  it('вкладка закрывает базу — обновление сразу', async () => {
    expect((await run(true)).log).toEqual(t.STAND.version.polite);
  });

  it('не закрывает — blocked, после закрытия — обновление', async () => {
    const r = await run(false);
    expect(r.log).toEqual(t.STAND.version.stubborn);
    r.closeA();
    await sleep(60);
    expect(r.log).toEqual(t.STAND.version.stubbornAfterClose);
  });

  it('индексы и курсор: INDEX_CODE в базе версии 2', async () => {
    const { idb } = await run(true);
    const db = await new Promise<IDBDatabase>((ok) => {
      const o = idb.open('shop');
      o.onsuccess = () => ok(o.result);
    });
    const log: string[] = [];
    const req = (r: IDBRequest) =>
      new Promise((ok, fail) => {
        r.onsuccess = () => ok(r.result);
        r.onerror = () => fail(r.error);
      });
    const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<void>;
    await new AsyncFunction('db', 'log', 'req', 'IDBKeyRange', t.INDEX_CODE)(db, (m: string) => log.push(m), req, IDBKeyRange);
    db.close();
    expect(log).toEqual(t.STAND.index);
  });
});

describe('localStorage', () => {
  it('LS_TYPES_CODE в Node с Web Storage даёт тот же журнал, что Chromium', () => {
    const file = join(tmpdir(), `browser-storage-${process.pid}-${Date.now()}.db`);
    try {
      const script = `const lines = []; const log = (m) => lines.push(m);\n${t.LS_TYPES_CODE}\nlocalStorage.clear();\nprocess.stdout.write(JSON.stringify(lines));`;
      const out = execFileSync(process.execPath, ['--experimental-webstorage', `--localstorage-file=${file}`, '-e', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      expect(JSON.parse(out)).toEqual(t.STAND.lsTypes);
    } finally {
      rmSync(file, { force: true });
    }
  });

  it('предел: 5 × 1024 × 1024 символов UTF-16 на ключи и значения origin', () => {
    const L = t.STAND.lsLimit;
    expect(t.LS_LIMIT_UNITS).toBe(5 * 1024 * 1024);
    expect(L.ascii + 'k'.length).toBe(t.LS_LIMIT_UNITS);
    expect(L.key10 + 10).toBe(t.LS_LIMIT_UNITS);
    expect(L.cyrillic).toBe(L.ascii);
    expect('😀'.length).toBe(2);
    expect(L.emoji * 2 + 1).toBeLessThanOrEqual(t.LS_LIMIT_UNITS);
    expect((L.emoji + 1) * 2 + 1).toBeGreaterThan(t.LS_LIMIT_UNITS);
    expect(L.session).toBe(L.ascii);
    // Пять значений по 1 Ми − 2 символа с ключами `k0`…`k4` — ровно предел; шестое не влезло.
    expect(L.megaValues * (1024 * 1024 - 2 + 2)).toBe(t.LS_LIMIT_UNITS);
    expect(L.error).toMatchObject({ name: 'QuotaExceededError', code: 22, isDOMException: true });
    expect(L.failKeeps).toEqual({ k: 'small', n: null, length: 1 });
  });

  it('событие storage: восемь вызовов, пять событий, только у соседа по origin', () => {
    expect(lines(t.WRITER_CODE)).toHaveLength(8);
    expect(t.EVENTS_NOTE).toContain('Восемь вызовов дали пять событий');
    expect(t.STAND.events.sameOrigin).toHaveLength(5);
    expect(t.STAND.events.author).toEqual([]);
    expect(t.STAND.events.otherPort).toEqual([]);
    expect(t.STAND.events.otherHost).toEqual([]);
    expect(t.STAND.events.sameOrigin.at(-1)).toBe('null: null → null');
  });

  it('куки: 4096 байт на имя и значение, 181-я сбрасывает до 150', () => {
    expect(t.STAND.cookie.maxValueWithName1 + 'c'.length).toBe(4096);
    expect(t.STAND.cookie.counts).toEqual([
      { set: 180, kept: 180, firstKept: true },
      { set: 181, kept: 150, firstKept: false },
    ]);
  });
});

describe('квота', () => {
  it('quota − usage постоянно: 3 ГиБ без профиля, 10 ГиБ в профиле', () => {
    expect(t.FREE_OTR_GIB).toBe(3);
    expect(t.FREE_PROFILE_GIB).toBe(10);
    for (const rows of [t.STAND.quotaOtr, t.STAND.quotaProfile]) {
      expect(new Set(rows.map((r) => r.free)).size).toBe(1);
      for (const r of rows) expect((r.indexedDB ?? 0) + (r.caches ?? 0) + (r.fileSystem ?? 0)).toBe(r.usage);
      // localStorage в usage не попал: последний шаг равен предпоследнему.
      expect(rows.at(-1)).toMatchObject({ usage: rows.at(-2)?.usage });
    }
    expect(t.QUOTA_ROWS).toHaveLength(5);
  });

  it('сжатие и пережитый перезапуск', () => {
    expect(t.STAND.idbCompression.zeros4MiB).toBe(0);
    expect(t.STAND.idbCompression.random4MiB).toBeGreaterThanOrEqual(4 * 1024 * 1024);
    expect(t.STAND.otrNewContext).toEqual({ local: false, idb: [] });
    expect(t.STAND.profileRestart).toEqual({ local: true, idb: ['blobs'] });
    expect(t.STAND.persistOtr.at(-1)).toBe('persist(): false');
    expect(t.STAND.persistProfile.at(-1)).toBe('persist(): false');
  });
});

describe('Cache API и OPFS', () => {
  it('утверждения карточек совпадают с журналами стенда', () => {
    expect(t.STAND.cache).toContain('другой query: undefined');
    expect(t.STAND.cache).toContain('put POST: TypeError');
    expect(t.STAND.cache).toContain('add 404: TypeError');
    expect(t.STAND.cache).toContain('put 500: 500');
    expect(t.STAND.opfsWorker.at(-1)).toBe('второй handle: NoModificationAllowedError');
    expect(t.STAND.opfsMain[0]).toBe('createSyncAccessHandle: undefined');
    expect(t.STAND.opfsMain[1]).toBe('файл: "hello"');
  });
});
