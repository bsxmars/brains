import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { transform } from 'esbuild';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/tooling/e2e-testing/data';
import { loadAutoWait, timelineOf } from '@/widgets/autowait-lab/model/run';
import type { LogLine } from '@/widgets/autowait-lab/model/types';

/**
 * Тема «Тесты в браузере изнутри».
 *
 * `AUTOWAIT_CODE` — строка из темы: напечатана на странице и исполняется демо. Здесь она
 * прогоняется по фикстурам стенда и сверяется с журналами настоящего Playwright 1.63
 * (литералы `AW_FIXTURES[].stand`, снятые `DEBUG=pw:api` в Chromium): сообщения — дословно
 * и в том же порядке, время строк и момент клика — с допуском (`FIND_MS` и `CHECK_MS` в модели —
 * оценка времени проверки, а не константа). Паузы и тексты сообщений модели сверяются с
 * исходником `playwright-core` из `node_modules`: сменится лестница пауз или формулировка —
 * покраснеет здесь. Браузер тест не поднимает: журналы — литералы стенда (шапка `data.ts`).
 */

const autoWait = loadAutoWait(t.AUTOWAIT_CODE);
const consts = new Function(`${t.AUTOWAIT_CODE}\nreturn { FIND_PAUSES, RETRY_PAUSES };`)() as {
  FIND_PAUSES: number[];
  RETRY_PAUSES: number[];
};

/** Допуск по времени: проверки на стенде занимали от 5 до 35 мс, модель берёт среднее. */
const TOLERANCE_MS = 60;

const require = createRequire(import.meta.url);
const coreDir = dirname(require.resolve('playwright-core/package.json'));
const core = readFileSync(join(coreDir, 'lib/coreBundle.js'), 'utf8');
const coreVersion = (JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')) as { version: string }).version;

const msgs = (log: LogLine[]) => log.map(([, m]) => m);

describe('autoWait повторяет журнал Playwright на фикстурах стенда', () => {
  const cases = [
    ...t.AW_FIXTURES.map((fx) => ({ id: fx.id, timeline: timelineOf(fx, fx.changeAt), stand: fx.stand, clicks: fx.standClicks })),
    { id: 'ready', timeline: timelineOf({ before: {} }, null), stand: t.READY_STAND, clicks: t.READY_CLICKS },
  ];

  it.each(cases)('$id: те же сообщения в том же порядке', ({ timeline, stand }) => {
    const r = autoWait(timeline, 3000);
    expect(r.error).toBeNull();
    expect(msgs(r.log)).toEqual(msgs(stand));
  });

  it.each(cases)('$id: время строк и момент клика — в пределах допуска', ({ timeline, stand, clicks }) => {
    const r = autoWait(timeline, 3000);
    r.log.forEach(([tm], i) => expect(Math.abs(tm - stand[i][0])).toBeLessThanOrEqual(TOLERANCE_MS));
    for (const c of clicks) expect(Math.abs((r.clickAt ?? -1) - c)).toBeLessThanOrEqual(TOLERANCE_MS);
    // Момент клика стенда — последняя строка его журнала.
    expect(clicks[0]).toBe(stand.at(-1)?.[0]);
  });

  it('три прогона стенда разошлись не больше чем на 9 мс', () => {
    for (const c of [...t.AW_FIXTURES.map((f) => f.standClicks), t.READY_CLICKS]) {
      expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(9);
    }
  });
});

describe('таймауты', () => {
  const never = (id: string) => timelineOf(t.AW_FIXTURES.find((f) => f.id === id)!, null);

  it('отключённая навсегда: столько же попыток, сколько в журнале ошибки', () => {
    const r = autoWait(never('disabled'), 1500);
    expect(r.clickAt).toBeNull();
    expect(t.TIMEOUT_LOG.startsWith(`page.click: ${r.error}`)).toBe(true);
    const attempts = r.log.filter(([, m]) => m.includes('waiting for element to be visible')).length;
    const inLog = [...t.TIMEOUT_LOG.matchAll(/(\d+) × waiting for element/g)].reduce((s, m) => s + Number(m[1]), 0);
    expect(attempts).toBe(7);
    expect(inLog).toBe(attempts);
    // Причина — та же, что в журнале ошибки, и ни одной другой.
    const reasons = new Set(r.log.filter(([, m]) => /element is not/.test(m)).map(([, m]) => m.trim()));
    expect([...reasons]).toEqual(['element is not enabled']);
  });

  it('не найденная: в журнале одна строка', () => {
    const r = autoWait(never('late'), 1500);
    expect(msgs(r.log)).toEqual(["waiting for locator('#buy')"]);
    expect(r.error).toBe('Timeout 1500ms exceeded.');
  });

  it('при таймауте 1500 ступень 500 мс у поиска выпадает', () => {
    // Кнопка появится на 1300-й: с лестницей до 500 мс её нашли бы на ~1275+500, с урезанной — раньше.
    const r = autoWait(timelineOf({ before: { attached: false } }, 1300), 1500);
    expect(r.clickAt).not.toBeNull();
    expect(r.clickAt!).toBeLessThan(1500);
  });
});

describe('таблица фикстур совпадает с журналами', () => {
  const byLabel: Record<string, string> = {
    '`display: none` до 600 мс': 'hidden',
    '`disabled` до 1100 мс': 'disabled',
    'оверлей до 700 мс': 'overlay',
    'анимация до 700 мс': 'moving',
    'появится через 600 мс': 'late',
  };

  it.each(Object.entries(byLabel))('%s', (label, id) => {
    const row = t.STAND_ROWS.find((r) => r.k === label)!;
    const fx = t.AW_FIXTURES.find((f) => f.id === id)!;
    expect(row.when).toBe(`${Math.min(...fx.standClicks)}–${Math.max(...fx.standClicks)} мс`);
    const m = /^`(.+)` × (\d+)$/.exec(row.why);
    if (!m) {
      // «появится позже»: до найденного элемента в журнале нет ни одной причины.
      expect(fx.stand.filter(([, s]) => /element is not|intercepts/.test(s))).toHaveLength(0);
      return;
    }
    expect(fx.stand.filter(([, s]) => s.trim() === m[1])).toHaveLength(Number(m[2]));
  });

  it('готовая кнопка', () => {
    const row = t.STAND_ROWS.find((r) => r.k === 'готова сразу')!;
    expect(row.when).toBe(`${Math.min(...t.READY_CLICKS)}–${Math.max(...t.READY_CLICKS)} мс`);
  });
});

describe('модель сверена с исходником playwright-core', () => {
  it('версия 1.63', () => {
    expect(coreVersion).toBe('1.63.0');
  });

  it('паузы между повторами действия — server/dom.ts, _retryAction', () => {
    expect(core).toContain(`const waitTime = [${consts.RETRY_PAUSES.join(', ')}];`);
  });

  it('паузы между поисками элемента — server/frames.ts, retryWithProgressAndBackoff', () => {
    const [first, ...rest] = consts.FIND_PAUSES;
    expect(first).toBe(0);
    expect(core).toContain(`const backoffScale = [${rest.join(', ')}];`);
    expect(core).toContain('timeouts = [0, ...timeouts];');
    // Урезание лестницы до пятой части таймаута.
    expect(core).toContain('backoffScale[backoffScale.length - 1] > progress2.timeout / 5');
  });

  it('у Chromium стабильность — один кадр сравнения после первого', () => {
    const at = core.indexOf('// packages/playwright-core/src/server/chromium/crPage.ts');
    const tail = core.slice(at);
    const m = /rafCountForStablePosition\(\) \{\s*return (\d+);/.exec(tail);
    expect(m?.[1]).toBe('1');
  });

  it('тексты сообщений модели есть в исходнике', () => {
    for (const s of [
      'attempting ${actionName} action',
      'retrying ${actionName} action',
      'waiting ${timeout}ms',
      'waiting for element to be ${waitForEnabled ? "visible, enabled and stable"',
      'element is not ${result2.missingState}',
      'intercepts pointer events',
      'scrolling into view if needed',
      'done scrolling',
      'performing ${actionName} action',
      'element was detached from the DOM, retrying',
      'locator resolved to ${injected.previewNode(element4)}',
    ]) {
      expect(core, s).toContain(s);
    }
  });

  it('порядок проверок: сначала стабильность, потом остальные состояния', () => {
    expect(core).toContain('if (states.includes("stable")) {');
  });

  it('паузы из текста темы совпадают с моделью', () => {
    expect(t.ACT_STEPS[0].d).toContain(`${consts.FIND_PAUSES.join(', ')}, 500…`);
  });
});

describe('протокол', () => {
  it('в CDP_CLICK столько команд, сколько в таблице', () => {
    const cmds = t.CDP_CLICK.split('\n').filter((l) => /^[A-Z]\w+\.\w+/.test(l));
    const row = t.CDP_ROWS.find((r) => r.k.includes('click'))!;
    expect(cmds).toHaveLength(row.send);
    expect(cmds.filter((l) => l.startsWith('Input.dispatchMouseEvent'))).toHaveLength(3);
    expect(t.CDP_CLICK.split('\n')[0]).toContain(`${row.send} команд`);
  });
});

describe('строки спецификаций — валидный модуль', () => {
  it.each(['LOCATOR_CODE', 'ASSERT_CODE', 'RACE_CODE', 'STATE_CODE'] as const)('%s', async (k) => {
    const r = await transform(t[k], { loader: 'js', format: 'esm' });
    expect(r.code).toContain('@playwright/test');
  });
});
