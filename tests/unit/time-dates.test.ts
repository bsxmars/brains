import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/time-dates/data';
import { loadTz } from '@/widgets/tz-lab/model/run';
import type { Disambiguation, ZoneTable } from '@/widgets/tz-lab/model/types';

/**
 * Тема «Время и даты: UTC, часовые пояса и Temporal».
 *
 * Пояс процесса Node читает из `TZ`, поэтому всё, что зависит от пояса, исполняется здесь
 * в **отдельных процессах** с нужным `TZ` (и английской локалью — от неё зависит название пояса
 * в `toString`). Таблицы выражений и примеры кода — те же строки, что напечатаны в теме.
 *
 * `LOCAL_TO_UTC_CODE` — учебная функция темы — сверяется с `Temporal.ZonedDateTime`
 * из `temporal-polyfill` (все четыре `disambiguation`) и с `Date` в процессе с `TZ` зоны —
 * на моментах через каждые 5 минут вокруг каждого перехода из `ZONE_TABLES`. Сами таблицы
 * пересобираются полифилом: сменится база поясов — покраснеет здесь.
 *
 * Строки, снятые в другой среде (Node 26.8, Chromium, Firefox, WebKit), — снимок стенда:
 * проверяется та из них, что относится к версии Node, где идёт прогон.
 */

const MINUTE = 60_000;
const tz = loadTz(t.LOCAL_TO_UTC_CODE);
const NODE24 = process.version === 'v24.11.0';

/** Исполнить скрипт в отдельном процессе Node с поясом `zone`; скрипт печатает JSON. */
function inZone<T>(zone: string, script: string): T {
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, TZ: zone, LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' },
    encoding: 'utf8',
  });
  return JSON.parse(out) as T;
}

/** Значение выражения так, как его печатает таблица: строки в одинарных кавычках, ошибки — по имени. */
const SHOW = `const show = (c) => { try { const v = (0, eval)('(' + c + ')'); return typeof v === 'string' ? "'" + v + "'" : String(v); } catch (e) { return e.constructor.name; } };`;

function evalRows(rows: t.ExprRow[]) {
  const zones = [...new Set(rows.map((r) => r.tz))];
  for (const zone of zones) {
    const mine = rows.filter((r) => r.tz === zone);
    const got = inZone<string[]>(zone, `${SHOW} console.log(JSON.stringify(${JSON.stringify(mine.map((r) => r.code))}.map(show)));`);
    mine.forEach((r, i) => expect(got[i], `${zone}: ${r.code}`).toBe(r.out));
  }
}

/** Значение последнего выражения примера (`eval`) в процессе с поясом. */
const runSnippet = (zone: string, code: string) =>
  JSON.stringify(inZone(zone, `console.log(JSON.stringify(eval(${JSON.stringify(code)})));`));

describe('Date — это число', () => {
  it('таблица NUMBER_ROWS', () => evalRows(t.NUMBER_ROWS));
});

describe('строка без зоны', () => {
  it('PARSE_ROWS: момент и число месяца в трёх поясах', () => {
    for (const [col, zone] of t.PARSE_TZ.entries()) {
      const got = inZone<{ iso: string; date: number }[]>(
        zone,
        `console.log(JSON.stringify(${JSON.stringify(t.PARSE_ROWS.map((r) => r.s))}.map((s) => { const d = new Date(eval(s)); return { iso: d.toISOString(), date: d.getDate() }; })));`,
      );
      t.PARSE_ROWS.forEach((r, i) => expect(got[i], `${zone}: ${r.s}`).toEqual(r.cells[col]));
    }
  });

  it('DATE_INPUT_CODE: в Нью-Йорке «минус день»', () => {
    for (const r of t.DATE_INPUT_OUT) expect(runSnippet(r.tz, t.DATE_INPUT_CODE), r.tz).toBe(r.out);
  });
});

describe('летнее время', () => {
  it('таблица DST_ROWS', () => evalRows(t.DST_ROWS));

  it('TOMORROW_CODE: +24 часа в Берлине — 13:00', () => {
    for (const r of t.TOMORROW_OUT) expect(runSnippet(r.tz, t.TOMORROW_CODE), r.tz).toBe(r.out);
  });
});

describe('сравнение и вывод', () => {
  it('таблица COMPARE_ROWS', () => evalRows(t.COMPARE_ROWS));

  it('INTL_CODE: один момент — три подписи', () => {
    expect(JSON.parse(runSnippet('UTC', t.INTL_CODE))).toEqual(t.INTL_OUT);
  });

  it('текст ICU: нулевое смещение в Node 24 — «GMT»', () => {
    const text = new Intl.DateTimeFormat('en', { timeZone: 'UTC', timeZoneName: 'longOffset' }).formatToParts(0).at(-1)?.value;
    if (NODE24) expect(text).toBe('GMT');
    expect(t.INTL_NOTE).toContain('`GMT+00:00`');
  });
});

describe('база поясов', () => {
  it('VERSIONS_CODE и строка RUNTIME_ROWS своей версии Node', () => {
    expect(eval(t.VERSIONS_CODE)).toBe(418);
    const row = t.RUNTIME_ROWS.find((r) => r.env === `Node ${process.version.slice(1)}`);
    if (row) {
      expect(row.icu).toBe(process.versions.icu);
      expect(row.tz).toBe(process.versions.tz);
    }
    expect(typeof (globalThis as { Temporal?: unknown }).Temporal).toBe('undefined');
  });

  it('CHISINAU_CODE: ответ совпадает со строкой своей версии tzdata', () => {
    const row = t.CHISINAU_OUT.find((r) => r.tz === process.versions.tz);
    expect(row, `в CHISINAU_OUT нет строки для tzdata ${process.versions.tz} — снимите её заново`).toBeTruthy();
    const got = inZone<string>('Europe/Chisinau', `console.log(JSON.stringify(eval(${JSON.stringify(t.CHISINAU_CODE)})));`);
    expect(`'${got}'`).toBe(row?.out);
  });

  it('имена зон: Calcutta, Kiev, MSK, Etc/GMT-3, +03:00', () => {
    if (NODE24) {
      expect(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata' }).resolvedOptions().timeZone).toBe('Asia/Calcutta');
      const list = Intl.supportedValuesOf('timeZone');
      expect(list).toContain('Europe/Kiev');
      expect(list).not.toContain('Europe/Kyiv');
    }
    expect(() => new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv' })).not.toThrow();
    expect(() => new Intl.DateTimeFormat('en', { timeZone: 'MSK' })).toThrow(RangeError);
    expect(new Intl.DateTimeFormat('en', { timeZone: '+03:00' }).resolvedOptions().timeZone).toBe('+03:00');
    const hour = new Intl.DateTimeFormat('en', { timeZone: 'Etc/GMT-3', hour: '2-digit', hourCycle: 'h23' }).format(Date.UTC(2026, 2, 29));
    expect(hour).toBe('03');
  });

  it('process.env.TZ, присвоенный на ходу, меняет пояс процесса', () => {
    const got = inZone<string[]>(
      'Europe/Moscow',
      `const a = new Date(2026, 2, 29).toISOString(); process.env.TZ = 'America/New_York'; console.log(JSON.stringify([a, new Date(2026, 2, 29).toISOString()]));`,
    );
    expect(got).toEqual(['2026-03-28T21:00:00.000Z', '2026-03-29T04:00:00.000Z']);
  });
});

describe('Temporal (полифил)', () => {
  /** Пример без строки `import`: `Temporal` приходит параметром, значение — последнее выражение. */
  const evalTemporal = (code: string) =>
    new Function('Temporal', 'src', 'return eval(src);')(Temporal, code.replace(/^import .*\n/m, '')) as unknown;

  it('TEMPORAL_CODE', () => {
    expect(evalTemporal(t.TEMPORAL_CODE)).toEqual(t.TEMPORAL_OUT);
  });

  it('DISAMBIGUATION_ROWS: Берлин, разрыв и повтор', () => {
    const zoned = (wall: string, mode: string) => {
      try {
        const z = Temporal.PlainDateTime.from(wall).toZonedDateTime('Europe/Berlin', { disambiguation: mode as Disambiguation });
        return z.toPlainTime().toString().slice(0, 5) + z.offset;
      } catch (e) {
        return (e as Error).constructor.name;
      }
    };
    for (const r of t.DISAMBIGUATION_ROWS) {
      const mode = r.mode.replaceAll("'", '');
      expect(zoned('2026-03-29T02:30', mode), r.mode).toBe(r.gap);
      expect(zoned('2026-10-25T02:30', mode), r.mode).toBe(r.overlap);
    }
  });

  it('DISAMBIGUATION_CODE: по умолчанию как Date, reject — RangeError', () => {
    const first = t.DISAMBIGUATION_CODE.split('\n').slice(0, 3).join('\n');
    expect(String(evalTemporal(first))).toBe('2026-03-29T03:30:00+02:00[Europe/Berlin]');
    expect(() => evalTemporal(t.DISAMBIGUATION_CODE)).toThrow(RangeError);
  });

  it('OFFSET_ROWS', () => {
    for (const r of t.OFFSET_ROWS) {
      const mode = r.mode.replaceAll("'", '') as 'reject' | 'use' | 'ignore' | 'prefer';
      let got: string;
      try {
        got = Temporal.ZonedDateTime.from('2026-07-01T12:00+01:00[Europe/Berlin]', { offset: mode }).toString();
      } catch (e) {
        got = (e as Error).constructor.name;
      }
      expect(got, r.mode).toBe(r.out);
    }
  });

  it('OFFSET_NOTE: строка Node 26 по базе 2025b — RangeError, с offset: use — тот же момент', () => {
    const s = '2026-03-29T02:30:00+02:00[Europe/Chisinau]';
    expect(t.OFFSET_NOTE).toContain(s);
    if (process.versions.tz === '2025b') {
      expect(() => Temporal.ZonedDateTime.from(s)).toThrow(RangeError);
      const kept = Temporal.ZonedDateTime.from(s, { offset: 'use' });
      expect(kept.toInstant().toString()).toBe('2026-03-29T00:30:00Z');
    }
  });

  it('TEMPORAL_FACTS', () => {
    expect(Temporal.PlainDate.from('2026-03-29').month).toBe(3);
    expect(Temporal.PlainDate.from('2026-01-31').add({ months: 1 }).toString()).toBe('2026-02-28');
    expect(() => Temporal.PlainDate.from('2026-01-31').add({ months: 1 }, { overflow: 'reject' })).toThrow(RangeError);
    const d = new Date(2026, 0, 31);
    d.setMonth(1);
    expect([d.getMonth(), d.getDate()]).toEqual([2, 3]);

    const a = Temporal.Instant.from('2026-03-29T00:00Z');
    const b = Temporal.Instant.from('2026-03-29T01:00Z');
    expect(() => (a as unknown as number) < (b as unknown as number)).toThrow(TypeError);
    expect(() => new Date(a as unknown as number)).toThrow(TypeError);
    expect(Temporal.Instant.compare(a, b)).toBe(-1);

    const utc = Temporal.ZonedDateTime.from('2026-03-29T01:00+00:00[UTC]');
    const berlin = Temporal.ZonedDateTime.from('2026-03-29T03:00+02:00[Europe/Berlin]');
    expect(utc.equals(berlin)).toBe(false);
    expect(utc.epochMilliseconds).toBe(berlin.epochMilliseconds);
    expect(utc.toInstant().equals(berlin.toInstant())).toBe(true);

    expect(Temporal.Instant.fromEpochMilliseconds(Date.UTC(2026, 2, 29)).toString()).toBe('2026-03-29T00:00:00Z');
    expect(JSON.stringify({ at: a })).toBe('{"at":"2026-03-29T00:00:00Z"}');

    // Импорт по имени `Date.prototype` не трогает, `temporal-polyfill/global` — добавляет метод.
    expect(typeof (Date.prototype as { toTemporalInstant?: unknown }).toTemporalInstant).toBe('undefined');
    const withGlobal = execFileSync(process.execPath, ['-e', "require('temporal-polyfill/global'); console.log(typeof Date.prototype.toTemporalInstant)"], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    expect(withGlobal).toBe('function');
  });

  it('Kathmandu: начало 1 января 1986 года — 00:15', () => {
    expect(Temporal.PlainDate.from('1986-01-01').toZonedDateTime('Asia/Kathmandu').toString()).toBe('1986-01-01T00:15:00+05:45[Asia/Kathmandu]');
  });

  it('SUPPORT_NOTE: вес полифила — 57 КБ, 20 КБ в gzip', async () => {
    const out = await build({
      stdin: { contents: "import { Temporal } from 'temporal-polyfill'; console.log(Temporal.Now.instant().toString());", resolveDir: process.cwd() },
      bundle: true,
      minify: true,
      format: 'esm',
      write: false,
    });
    const bytes = out.outputFiles[0].contents;
    expect(Math.round(bytes.length / 1000)).toBe(57);
    expect(Math.round(gzipSync(bytes, { level: 9 }).length / 1000)).toBe(20);
    expect(t.SUPPORT_NOTE).toContain('57 КБ');
    expect(t.SUPPORT_NOTE).toContain('20 КБ в gzip');
  });
});

/** Таблицы, снятые по той же базе, что у процесса. Таблицы другой версии tzdata — снимок стенда. */
const ACTIVE = Object.entries(t.ZONE_TABLES).filter(([, table]) => table.tzdata === process.versions.tz);

/** Переходы зоны полифилом на отрезке таблицы. */
function rebuild(table: ZoneTable) {
  const first = table.transitions[0].at - 86_400_000;
  const last = table.transitions.at(-1)!.at + 86_400_000;
  let z = Temporal.Instant.fromEpochMilliseconds(first).toZonedDateTimeISO(table.zone);
  const out: { at: number; before: number; after: number }[] = [];
  for (;;) {
    const next = z.getTimeZoneTransition('next');
    if (!next || next.epochMilliseconds > last) break;
    const before = next.subtract({ nanoseconds: 1 }).offsetNanoseconds / 60e9;
    out.push({ at: next.epochMilliseconds, before, after: next.offsetNanoseconds / 60e9 });
    z = next;
  }
  return out;
}

/** Время на часах каждые 5 минут: от трёх часов до перехода до трёх часов после. */
function samples(table: ZoneTable): number[] {
  const out: number[] = [];
  for (const tr of table.transitions) {
    const a = tr.at + tr.before * MINUTE;
    const b = tr.at + tr.after * MINUTE;
    for (let local = Math.min(a, b) - 180 * MINUTE; local <= Math.max(a, b) + 180 * MINUTE; local += 5 * MINUTE) out.push(local);
  }
  return out;
}

const plain = (local: number) => Temporal.PlainDateTime.from(new Date(local).toISOString().slice(0, 16));

describe('LOCAL_TO_UTC_CODE против Temporal и Date', () => {
  it('для текущей версии tzdata есть таблицы, включая Кишинёв', () => {
    expect(ACTIVE.length).toBeGreaterThanOrEqual(6);
    expect(ACTIVE.some(([, table]) => table.zone === 'Europe/Chisinau'), `нет таблицы Кишинёва для tzdata ${process.versions.tz}`).toBe(true);
  });

  it.each(ACTIVE)('таблица %s совпадает с переходами полифила', (_, table) => {
    expect(rebuild(table)).toEqual(table.transitions);
  });

  it.each(ACTIVE)('%s: четыре disambiguation совпадают с ZonedDateTime', (_, table) => {
    const modes: Disambiguation[] = ['compatible', 'earlier', 'later', 'reject'];
    let gaps = 0;
    let overlaps = 0;
    for (const local of samples(table)) {
      const n = tz.candidates(table.transitions, local).filter((c) => c.fits).length;
      if (n === 0) gaps++;
      if (n === 2) overlaps++;
      for (const mode of modes) {
        const run = (f: () => number) => {
          try {
            return f();
          } catch (e) {
            return (e as Error).constructor.name;
          }
        };
        const ours = run(() => tz.localToUtc(table.transitions, local, mode));
        const theirs = run(() => plain(local).toZonedDateTime(table.zone, { disambiguation: mode }).epochMilliseconds);
        expect(ours, `${table.zone} ${new Date(local).toISOString()} ${mode}`).toBe(theirs);
      }
    }
    // Каждый переход даёт либо разрыв, либо повтор — иначе выборка прошла мимо.
    expect(gaps + overlaps).toBeGreaterThan(0);
  });

  it.each(ACTIVE)('%s: compatible совпадает с Date в процессе с TZ', (_, table) => {
    const locals = samples(table);
    const parts = locals.map((l) => {
      const d = new Date(l);
      return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()];
    });
    const got = inZone<number[]>(table.zone, `console.log(JSON.stringify(${JSON.stringify(parts)}.map((p) => new Date(...p).getTime())));`);
    locals.forEach((local, i) => expect(tz.localToUtc(table.transitions, local), new Date(local).toISOString()).toBe(got[i]));
  });

  it('CALL_CODE — пример вызова в теме', () => {
    const got = new Function(`${t.LOCAL_TO_UTC_CODE}\nreturn eval(${JSON.stringify(t.CALL_CODE)});`)();
    expect(got).toEqual(t.CALL_OUT);
  });

  it('сценарии демо ссылаются на настоящие переходы', () => {
    for (const s of t.DEMO_SCENARIOS) {
      expect(s.table.transitions[s.focus], s.id).toBeTruthy();
      expect(s.step).toBeGreaterThan(0);
    }
    // Кишинёв: 02:30 и 03:30 по двум базам — ровно то, что говорят подписи сценариев.
    const wall = (h: number) => Date.UTC(2026, 2, 29, h, 30);
    const fits = (table: ZoneTable, local: number) => tz.candidates(table.transitions, local).filter((c) => c.fits).length;
    expect([fits(t.ZONE_TABLES.chisinauOld, wall(2)), fits(t.ZONE_TABLES.chisinauOld, wall(3))]).toEqual([0, 1]);
    expect([fits(t.ZONE_TABLES.chisinauNew, wall(2)), fits(t.ZONE_TABLES.chisinauNew, wall(3))]).toEqual([1, 0]);
  });
});
