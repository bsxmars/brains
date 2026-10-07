import { createServer, type Server } from 'node:http';
import { type Browser, type CDPSession, chromium, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t from '@/content/render/text-input/data';
import { loadSimulate, sameRun } from '@/widgets/input-lab/model/run';
import type { FieldEvent, FieldRun, InputScenario } from '@/widgets/input-lab/model/types';

/**
 * Тема «Ввод текста в браузере: события, IME и автозаполнение».
 *
 * `SIM_CODE` — учебная модель поля, строкой из темы: напечатана на странице и исполняется
 * демо. Здесь её журнал сверяется с журналами Chromium (`STAND_RUNS`) на каждом сценарии,
 * а сами журналы снимаются заново: тест поднимает страницу на 127.0.0.1:52410, вешает на поле
 * `WATCH_CODE` (ту же строку, что показана читателю и работает в живом поле демо) и набирает
 * сценарии клавиатурой Playwright и командами CDP — так же, как стенд.
 *
 * `FACTS` (запись из кода, история, вставка, `contenteditable`) снимаются заново тут же.
 * Автозаполнение — в полном Chromium (`channel: 'chromium'`): в headless shell домена
 * `Autofill` нет. Примеры кода темы исполняются в браузере как есть.
 */

const simulate = loadSimulate(t.SIM_CODE);
const PORT = 52410;
const AF_PORT = 52411;
const isMac = process.platform === 'darwin';

describe('модель против журналов Chromium', () => {
  it('пятнадцать сценариев, у каждого — журнал стенда', () => {
    expect(t.SCENARIOS).toHaveLength(15);
    expect(t.SIM_NOTE).toContain('пятнадцати');
    expect(Object.keys(t.STAND_RUNS).sort()).toEqual(t.SCENARIOS.map((s) => s.id).sort());
    expect(t.DEMO_SCENARIOS.every((s) => s.note.length > 0)).toBe(true);
  });

  it('«восемьдесят строк» в тексте — длина SIM_CODE', () => {
    const lines = t.SIM_CODE.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(75);
    expect(lines).toBeLessThanOrEqual(85);
  });

  for (const s of t.SCENARIOS) {
    it(`сценарий ${s.id}`, () => {
      const run = simulate(s.start, s.actions, s.cancel);
      expect(run.value).toBe(t.STAND_RUNS[s.id].value);
      expect(run.sel).toEqual(t.STAND_RUNS[s.id].sel);
      expect(run.log).toEqual(t.STAND_RUNS[s.id].log);
      expect(sameRun(run, t.STAND_RUNS[s.id])).toBe(true);
    });
  }

  it('сценарии различают модели: без «IME неотменяем» и без «каретки в конец» модель краснеет', () => {
    const noImeGuard = loadSimulate(t.SIM_CODE.replace("fire('beforeinput', fields, !composing)", "fire('beforeinput', fields, true)"));
    const noCaretJump = loadSimulate(t.SIM_CODE.replace('sel = [value.length, value.length];', ''));
    const runOf = (fn: typeof simulate, id: string) => {
      const s = t.SCENARIOS.find((x) => x.id === id)!;
      return fn(s.start, s.actions, s.cancel);
    };
    expect(sameRun(runOf(noImeGuard, 'ime-cancel'), t.STAND_RUNS['ime-cancel'])).toBe(false);
    expect(sameRun(runOf(noCaretJump, 'set'), t.STAND_RUNS.set)).toBe(false);
  });
});

describe('утверждения текста — из журналов стенда', () => {
  const R = t.STAND_RUNS;
  const types = (id: string) => R[id].log.map((e) => e.type);

  it('порядок одного нажатия и что отменяемо', () => {
    expect(types('char')).toEqual(['keydown', 'keypress', 'beforeinput', 'input', 'keyup']);
    expect(t.ORDER_ROWS.map((r) => r.cancelable)).toEqual(['да', 'да', 'да', '**нет**', 'да']);
    expect(R.char.log.find((e) => e.type === 'beforeinput')!.value).toBe('');
    expect(R.char.log.find((e) => e.type === 'input')!.value).toBe('a');
  });

  it('CANCEL_ROWS: что пропадает при каждой отмене', () => {
    expect(types('cancel-keydown')).toEqual(['keydown', 'keyup']);
    expect(types('cancel-keypress')).toEqual(['keydown', 'keypress', 'keyup']);
    expect(types('cancel-before')).not.toContain('input');
    expect(R['cancel-before'].value).toBe('abc');
    expect(types('paste-keydown')).toEqual(['keydown', 'keyup']);
    expect(types('cancel-paste')).toEqual(['keydown', 'paste', 'keyup']);
    expect(R['ime-cancel'].value).toBe('か');
    expect(R['ime-cancel'].log.filter((e) => e.type === 'beforeinput').every((e) => e.cancelable === false)).toBe(true);
    for (const row of t.CANCEL_ROWS) expect(R[row.run], row.run).toBeDefined();
  });

  it('beforeinput без правки: Backspace в начале и Enter в <input>', () => {
    expect(types('backspace0')).toEqual(['keydown', 'beforeinput', 'keyup']);
    expect(types('enter')).toEqual(['keydown', 'keypress', 'beforeinput', 'keyup']);
    expect(R.enter.log[2].inputType).toBe('insertLineBreak');
  });

  it('key, code и keyCode в двух раскладках; keypress только у символов', () => {
    expect(t.KEY_ROWS.map((r) => [r.en, r.ru])).toEqual([
      ['a', 'ф'],
      ['KeyA', 'KeyA'],
      ['65', '65'],
      ['97', '1092'],
      ['a', 'ф'],
    ]);
    expect(types('backspace')).not.toContain('keypress');
    expect(types('paste')).not.toContain('keypress');
  });

  it('IME: шаг — замена слова, слово выделено, Enter — только keydown/keyup', () => {
    const log = R.ime.log;
    expect(log.filter((e) => e.type === 'beforeinput').map((e) => e.data)).toEqual(['k', 'か', 'かん', '漢']);
    expect(log.filter((e) => e.type === 'compositionupdate').map((e) => e.sel)).toEqual([[2, 2], [2, 3], [2, 3], [2, 4]]);
    const enter = log.filter((e) => e.key === 'Enter');
    expect(enter.map((e) => [e.type, e.composing])).toEqual([['keydown', true], ['keyup', true]]);
    expect(log.filter((e) => e.inputType).every((e) => e.inputType === 'insertCompositionText')).toBe(true);
    expect(R.ime.value).toBe('ab漢');
  });

  it('el.value: каретка в конец, та же строка — на месте', () => {
    expect(R.set.value).toBe('ABCDEFx');
    expect(R['set-same'].value).toBe('abxcdef');
  });
});

// ─── Chromium ──────────────────────────────────────────────────────────────────────────────

const PAGE = `<!doctype html><meta charset="utf-8"><body>
<input id="f"><textarea id="t"></textarea>
<div id="ce" contenteditable="true">abc</div><div id="pt" contenteditable="plaintext-only">abc</div>
<script>${t.WATCH_CODE}
window.cancel = []; window.log = [];
watchField(document.getElementById('f'), (e) => window.log.push(e), window.cancel);
window.raw = [];
for (const id of ['f', 't', 'ce', 'pt']) {
  const el = document.getElementById(id);
  for (const type of ['keydown', 'keypress', 'beforeinput', 'textInput', 'input', 'keyup', 'paste', 'cut'])
    el.addEventListener(type, (e) => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
      window.raw.push({ type, inputType: e.inputType, trusted: e.isTrusted, data: e.data,
        dt: e.dataTransfer ? e.dataTransfer.getData('text/plain') : undefined,
        types: e.clipboardData ? [...e.clipboardData.types] : undefined,
        html: e.clipboardData ? e.clipboardData.getData('text/html') : undefined,
        plain: e.clipboardData ? e.clipboardData.getData('text/plain') : undefined });
      if (window.rawCancel === type) e.preventDefault();
    });
}
</script>`;

let server: Server;
let browser: Browser;
let page: Page;
let cdp: CDPSession;
const URL_ = `http://127.0.0.1:${PORT}/`;

beforeAll(async () => {
  server = createServer((_q, r) => {
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    r.end(PAGE);
  });
  await new Promise<void>((ok) => server.listen(PORT, '127.0.0.1', () => ok()));
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${PORT}` });
  page = await ctx.newPage();
  cdp = await ctx.newCDPSession(page);
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((ok) => server?.close(ok));
});

type W = Window & { log: FieldEvent[]; cancel: string[]; raw: Record<string, unknown>[]; rawCancel: string | null };

/** Сценарий в Chromium — тем же способом, что на стенде (см. шапку `data.ts`). */
async function runInChromium(s: InputScenario): Promise<FieldRun> {
  await page.goto(URL_);
  await page.evaluate(
    ([v, c, cancel]) => {
      const f = document.getElementById('f') as HTMLInputElement;
      f.value = v as string;
      f.focus();
      f.setSelectionRange(c as number, c as number);
      (window as unknown as W).cancel.push(...(cancel as string[]));
    },
    [s.start.value, s.start.caret, s.cancel] as const,
  );
  let composing = false;
  for (const a of s.actions) {
    if (a.do === 'key') {
      const vk = a.code.startsWith('Key') ? a.code.charCodeAt(3) : ({ Backspace: 8, Enter: 13 } as Record<string, number>)[a.code];
      const nonLatin = a.key.length === 1 && !/^[\x20-\x7e]$/.test(a.key);
      if (composing || nonLatin) {
        const text = !composing && a.key.length === 1 ? a.key : undefined;
        await cdp.send('Input.dispatchKeyEvent', {
          type: text ? 'keyDown' : 'rawKeyDown',
          key: a.key,
          code: a.code,
          windowsVirtualKeyCode: vk,
          ...(text ? { text, unmodifiedText: text } : {}),
        });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: a.key, code: a.code, windowsVirtualKeyCode: vk });
      } else await page.keyboard.press(a.key);
    } else if (a.do === 'paste') {
      await page.evaluate((text) => navigator.clipboard.writeText(text), a.text);
      await page.keyboard.press('ControlOrMeta+v');
    } else if (a.do === 'compose') {
      composing = true;
      await cdp.send('Input.imeSetComposition', { text: a.text, selectionStart: a.text.length, selectionEnd: a.text.length });
    } else if (a.do === 'commit') {
      composing = false;
      await cdp.send('Input.insertText', { text: a.text });
    } else if (a.do === 'set') {
      await page.evaluate((v) => ((document.getElementById('f') as HTMLInputElement).value = v), a.value);
    }
  }
  return page.evaluate(() => {
    const f = document.getElementById('f') as HTMLInputElement;
    const log = (window as unknown as W).log.filter((e) => e.key !== 'Meta' && e.key !== 'Control');
    return { value: f.value, sel: [f.selectionStart!, f.selectionEnd!], log };
  });
}

describe('Chromium: журналы STAND_RUNS снимаются заново', () => {
  it('браузер той версии, что на стенде', () => {
    expect(browser.version()).toBe('153.0.8010.12');
  });

  for (const s of t.SCENARIOS) {
    it(`сценарий ${s.id}`, async () => {
      const got = await runInChromium(s);
      expect(got).toEqual(t.STAND_RUNS[s.id]);
    });
  }
});

describe('Chromium: FACTS', () => {
  const take = () => page.evaluate(() => {
    const w = window as unknown as W;
    const l = w.raw;
    w.raw = [];
    return l;
  });
  const types = (l: Record<string, unknown>[]) => l.map((e) => (e.inputType ? `${e.type}:${e.inputType}` : String(e.type)));
  const focus = (id: string, value: string, caret: number | 'end' | 'all') =>
    page.evaluate(
      ([id, value, caret]) => {
        const el = document.getElementById(id as string)!;
        if (id === 'ce' || id === 'pt') {
          el.innerHTML = value as string;
          el.focus();
          const r = document.createRange();
          r.selectNodeContents(el);
          if (caret === 'end') r.collapse(false);
          getSelection()!.removeAllRanges();
          getSelection()!.addRange(r);
        } else {
          const f = el as HTMLInputElement;
          f.value = value as string;
          f.focus();
          f.setSelectionRange(caret as number, caret as number);
        }
        (window as unknown as W).raw = [];
        (window as unknown as W).rawCancel = null;
      },
      [id, value, caret] as const,
    );
  const val = (id: string) =>
    page.evaluate((id) => {
      const el = document.getElementById(id)!;
      return id === 'ce' || id === 'pt' ? el.innerHTML : (el as HTMLInputElement).value;
    }, id);
  const writeHtml = () =>
    page.evaluate(async (html) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['жирный'], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
    }, t.CLIP_HTML);

  const out: Record<string, unknown> = {};

  it('textInput между beforeinput и input', async () => {
    await page.goto(URL_);
    await focus('f', '', 0);
    await page.keyboard.press('a');
    out.withTextInput = types(await take());
    expect(out.withTextInput).toEqual(t.FACTS.withTextInput);
  });

  it('запись из кода: value, setRangeText, execCommand', async () => {
    await page.goto(URL_);
    await focus('f', 'abcdef', 2);
    out.program = await page.evaluate(() => {
      const el = document.getElementById('f') as HTMLInputElement;
      const w = window as unknown as W;
      const r: Record<string, unknown> = {};
      const reset = () => {
        el.value = 'abcdef';
        el.setSelectionRange(2, 2);
        w.raw = [];
      };
      const sel = () => [el.selectionStart, el.selectionEnd];
      reset();
      el.value = 'abXcdef';
      r.valueChanged = { value: el.value, sel: sel() };
      el.setSelectionRange(2, 2);
      el.value = 'abXcdef';
      r.valueSame = { value: el.value, sel: sel() };
      let events = w.raw.length;
      for (const mode of ['preserve', 'start', 'end', 'select'] as const) {
        reset();
        el.setRangeText('XY', 2, 2, mode);
        events += w.raw.length;
        r[mode] = { value: el.value, sel: sel() };
      }
      reset();
      el.setRangeText('XY');
      r.default = { value: el.value, sel: sel() };
      reset();
      el.setRangeText('Q', 0, 0);
      r.before = { value: el.value, sel: sel() };
      r.events = events + w.raw.length;
      reset();
      r.execOk = document.execCommand('insertText', false, 'XY');
      r.exec = { value: el.value, sel: sel(), log: w.raw.map((e) => [e.type, e.inputType, e.trusted]) };
      return r;
    });
    expect(out.program).toEqual(t.FACTS.program);
  });

  it('история: Ctrl+Z после value, после execCommand и отменённый', async () => {
    const undo = 'ControlOrMeta+z';
    await page.goto(URL_);
    await focus('f', '', 0);
    await page.keyboard.type('ab');
    await page.evaluate(() => ((document.getElementById('f') as HTMLInputElement).value = 'xyz'));
    await take();
    await page.keyboard.press(undo);
    expect({ value: await val('f'), log: types(await take()) }).toEqual(t.FACTS.undoAfterSet);

    await page.goto(URL_);
    await focus('f', '', 0);
    await page.keyboard.type('ab');
    await page.evaluate(() => document.execCommand('insertText', false, 'Q'));
    await take();
    await page.keyboard.press(undo);
    const afterUndo = await val('f');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect({ afterUndo, afterRedo: await val('f'), log: types(await take()) }).toEqual(t.FACTS.undoAfterExec);

    await page.goto(URL_);
    await focus('f', '', 0);
    await page.keyboard.type('ab');
    await page.evaluate(() => ((window as unknown as W).rawCancel = 'beforeinput'));
    await page.keyboard.press(undo);
    expect({ value: await val('f') }).toEqual(t.FACTS.undoCancelled);
  });

  it('прочие inputType: слово, вырезание, Delete, Enter в textarea', async () => {
    await page.goto(URL_);
    await focus('f', 'one two', 7);
    await page.keyboard.press(isMac ? 'Alt+Backspace' : 'Control+Backspace');
    expect({ value: await val('f'), log: types(await take()) }).toEqual(t.FACTS.wordBackward);

    await page.goto(URL_);
    await focus('f', 'abc', 0);
    await page.evaluate(() => (document.getElementById('f') as HTMLInputElement).setSelectionRange(0, 2));
    await page.keyboard.press('ControlOrMeta+x');
    const cut = { value: await val('f'), log: types(await take()), clip: await page.evaluate(() => navigator.clipboard.readText()) };
    expect(cut).toEqual(t.FACTS.cut);

    await page.goto(URL_);
    await focus('f', 'abc', 1);
    await page.keyboard.press('Delete');
    expect({ value: await val('f'), log: types(await take()) }).toEqual(t.FACTS.del);

    await page.goto(URL_);
    await focus('t', 'ab', 2);
    await page.keyboard.press('Enter');
    expect({ value: await val('t'), log: types(await take()) }).toEqual(t.FACTS.textareaEnter);
  });

  it('вставка HTML: <input>, contenteditable, plaintext-only, синтетическая', async () => {
    await page.goto(URL_);
    await writeHtml();
    await focus('f', '', 0);
    await page.keyboard.press('ControlOrMeta+v');
    let l = await take();
    const paste = l.find((e) => e.type === 'paste')!;
    expect({ value: await val('f'), types: paste.types, html: paste.html, beforeData: l.find((e) => e.type === 'beforeinput')!.data }).toEqual(
      t.FACTS.pasteInput,
    );

    await page.goto(URL_);
    await writeHtml();
    await focus('ce', 'abc', 'end');
    await page.keyboard.press('ControlOrMeta+v');
    l = await take();
    await page.waitForTimeout(100);
    const before = l.find((e) => e.type === 'beforeinput')!;
    expect({
      value: await val('ce'),
      beforeData: before.data,
      beforeDt: before.dt,
      hacked: await page.evaluate(() => (window as unknown as { hacked?: number }).hacked ?? null),
    }).toEqual(t.FACTS.pasteCe);

    await page.goto(URL_);
    await writeHtml();
    await focus('pt', 'abc', 'end');
    await page.keyboard.press('ControlOrMeta+v');
    expect({ value: await val('pt'), log: types(await take()) }).toEqual(t.FACTS.pastePlainOnly);

    await page.goto(URL_);
    await focus('f', '', 0);
    const synthetic = await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', 'фейк');
      const f = document.getElementById('f') as HTMLInputElement;
      f.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { value: f.value, log: (window as unknown as W).raw.map((e) => [e.type, e.trusted, e.plain]) };
    });
    expect(synthetic).toEqual(t.FACTS.synthetic);
  });

  it('contenteditable: абзац, перенос, жирный, отмена, execCommand', async () => {
    await page.goto(URL_);
    await focus('ce', 'abc', 'end');
    await page.keyboard.press('Enter');
    expect({ value: await val('ce'), log: types(await take()) }).toEqual(t.FACTS.ceEnter);
    await page.keyboard.press('Shift+Enter');
    expect({ value: await val('ce'), log: types(await take()) }).toEqual(t.FACTS.ceShiftEnter);

    await page.goto(URL_);
    await focus('ce', 'abc', 'all');
    await page.keyboard.press('ControlOrMeta+b');
    expect({ value: await val('ce'), log: types(await take()) }).toEqual(t.FACTS.ceBold);

    await page.goto(URL_);
    await focus('ce', 'abc', 'all');
    await page.evaluate(() => ((window as unknown as W).rawCancel = 'beforeinput'));
    await page.keyboard.press('ControlOrMeta+b');
    expect({ value: await val('ce') }).toEqual(t.FACTS.ceBoldCancelled);

    await page.goto(URL_);
    await focus('ce', 'abc', 'all');
    const ok = await page.evaluate(() => document.execCommand('bold'));
    expect({ ok, value: await val('ce'), log: types(await take()) }).toEqual(t.FACTS.ceExecBold);
  });

  it(':autofill и :-webkit-autofill поддержаны', async () => {
    const got = await page.evaluate(() => [CSS.supports('selector(:autofill)'), CSS.supports('selector(:-webkit-autofill)')]);
    expect(got).toEqual(t.FACTS.autofillSelector);
  });

  it('таблицы текста собраны из FACTS', () => {
    const all = [
      ...Object.values(t.FACTS).flatMap((v) => (v && typeof v === 'object' && 'log' in v ? (v.log as unknown[]) : [])),
      ...t.FACTS.withTextInput,
    ].map(String);
    const seen = new Set(all.filter((x) => x.includes(':')).map((x) => x.split(':')[1]));
    for (const r of Object.values(t.STAND_RUNS)) for (const e of r.log) if (e.inputType) seen.add(e.inputType);
    const listed = t.INPUT_TYPE_ROWS.flatMap((r) => [...r.t.matchAll(/`(\w+)`/g)].map((m) => m[1]));
    for (const it of listed) expect(seen.has(it), it).toBe(true);
  });
});

describe('Chromium: примеры кода темы', () => {
  it('SHORTCUT_CODE: Ctrl/Cmd+K по code срабатывает на русской раскладке, «?» — по key', async () => {
    await page.goto(URL_);
    await page.evaluate((code) => {
      const w = window as unknown as { calls: string[] };
      w.calls = [];
      new Function('openSearch', 'showHelp', code)(() => w.calls.push('search'), () => w.calls.push('help'));
    }, t.SHORTCUT_CODE);
    const mod = isMac ? 4 : 2; // Meta : Control в маске модификаторов CDP
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'л', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: mod });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'л', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: mod });
    // «?» на русской раскладке — Shift+7.
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '?', code: 'Digit7', windowsVirtualKeyCode: 55, modifiers: 8, text: '?' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '?', code: 'Digit7', windowsVirtualKeyCode: 55, modifiers: 8 });
    // Проверка по key на той же клавише Ctrl/Cmd+K не сработала бы: key — «л».
    const keys = await page.evaluate(() => (window as unknown as { calls: string[] }).calls);
    expect(keys).toEqual(['search', 'help']);
  });

  it('ENTER_CODE: Enter посреди набора не отправляет, после выбора — отправляет', async () => {
    await page.goto(URL_);
    await page.evaluate((code) => {
      const w = window as unknown as { sent: string[] };
      w.sent = [];
      const input = document.getElementById('f') as HTMLInputElement;
      input.focus();
      new Function('input', 'send', code)(input, (v: string) => w.sent.push(v));
    }, t.ENTER_CODE);
    await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    expect(await page.evaluate(() => (window as unknown as { sent: string[] }).sent)).toEqual([]);
    await cdp.send('Input.insertText', { text: '漢' });
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => (window as unknown as { sent: string[] }).sent)).toEqual(['漢']);
  });

  it('PASTE_PLAIN_CODE: только текст, и Ctrl+Z его снимает', async () => {
    await page.goto(URL_);
    await page.evaluate(async ([code, html]) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob(['жирный'], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      const editor = document.getElementById('ce')!;
      new Function('editor', code)(editor);
      editor.focus();
      const r = document.createRange();
      r.selectNodeContents(editor);
      r.collapse(false);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    }, [t.PASTE_PLAIN_CODE, t.CLIP_HTML] as const);
    await page.keyboard.press('ControlOrMeta+v');
    expect(await page.evaluate(() => document.getElementById('ce')!.innerHTML)).toBe('abcжирный');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.getElementById('ce')!.innerHTML)).toBe('abc');
  });

  it('INSERT_CODE: каретка за вставкой, один input с isTrusted: false', async () => {
    await page.goto(URL_);
    const got = await page.evaluate((code) => {
      const f = document.getElementById('f') as HTMLInputElement;
      f.value = 'abcdef';
      f.setSelectionRange(2, 2);
      const seen: [string, boolean, string | null][] = [];
      f.addEventListener('input', (e) => seen.push([(e as InputEvent).inputType, e.isTrusted, (e as InputEvent).data]));
      new Function(`${code}\nreturn insertAtCaret;`)()(f, 'XY');
      return { value: f.value, sel: [f.selectionStart, f.selectionEnd], seen };
    }, t.INSERT_CODE);
    expect(got).toEqual({ value: 'abXYcdef', sel: [4, 4], seen: [['insertText', false, 'XY']] });
  });

  it('NO_FORMAT_CODE: жирный отменён, буква печатается', async () => {
    await page.goto(URL_);
    await page.evaluate((code) => {
      const editor = document.getElementById('ce')!;
      new Function('editor', code)(editor);
      editor.focus();
      const r = document.createRange();
      r.selectNodeContents(editor);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    }, t.NO_FORMAT_CODE);
    await page.keyboard.press('ControlOrMeta+b');
    expect(await page.evaluate(() => document.getElementById('ce')!.innerHTML)).toBe('abc');
    await page.keyboard.press('x');
    expect(await page.evaluate(() => document.getElementById('ce')!.innerHTML)).toBe('x');
  });
});

// ─── Автозаполнение: полный Chromium ──────────────────────────────────────────────────────

const AF_PAGE = `<!doctype html><meta charset="utf-8"><body>
<form id="a"><input id="fn" autocomplete="name"><input id="email" autocomplete="email"><input id="city" autocomplete="address-level2"></form>
<form id="b" autocomplete="off"><input id="fn2" autocomplete="name"><input id="email2" autocomplete="email"><input id="city2" autocomplete="address-level2"></form>
<form id="c"><input id="fn3" autocomplete="nope-xyz"><input id="email3" autocomplete="nope-abc"><input id="city3" autocomplete="nope-def"></form>
<script>
window.log = []; window.marked = [];
for (const el of document.querySelectorAll('#a input'))
  for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'change', 'focus', 'blur'])
    el.addEventListener(type, (e) => window.log.push({ id: el.id, type, cls: e.constructor.name, key: e.key,
      inputType: 'inputType' in e, trusted: e.isTrusted, autofill: el.matches(':autofill'), active: document.activeElement.tagName }));
</script>`;

const ADDRESS = {
  fields: [
    { name: 'NAME_FULL', value: 'Ivan Petrov' },
    { name: 'EMAIL_ADDRESS', value: 'ivan@example.com' },
    { name: 'ADDRESS_HOME_CITY', value: 'Riga' },
    { name: 'ADDRESS_HOME_COUNTRY', value: 'LV' },
  ],
};

describe('полный Chromium: автозаполнение — AUTOFILL', () => {
  let afServer: Server;
  let full: Browser;
  let p: Page;
  let s: CDPSession;
  let root: number;

  beforeAll(async () => {
    afServer = createServer((_q, r) => {
      r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      r.end(AF_PAGE);
    });
    await new Promise<void>((ok) => afServer.listen(AF_PORT, '127.0.0.1', () => ok()));
    full = await chromium.launch({ channel: 'chromium' });
    p = await full.newPage();
    s = await p.context().newCDPSession(p);
    await p.goto(`http://127.0.0.1:${AF_PORT}/`);
    await s.send('Autofill.enable');
    root = (await s.send('DOM.getDocument')).root.nodeId;
  }, 60_000);

  afterAll(async () => {
    await full?.close();
    await new Promise((ok) => afServer?.close(ok));
  });

  const fill = async (sel: string) => {
    const { nodeId } = await s.send('DOM.querySelector', { nodeId: root, selector: sel });
    const { node } = await s.send('DOM.describeNode', { nodeId });
    await s.send('Autofill.trigger', { fieldId: node.backendNodeId, address: ADDRESS });
    await p.waitForTimeout(300);
  };
  const values = (form: string) => p.evaluate((f) => [...document.querySelectorAll<HTMLInputElement>(`#${f} input`)].map((e) => e.value), form);

  it('та же версия, что на стенде', () => {
    expect(full.version()).toBe('153.0.8010.12');
  });

  it('события на каждом поле и :autofill', async () => {
    await p.evaluate((code) => {
      const w = window as unknown as { marked: string[] };
      new Function('form', 'markFilled', 'validate', code)(
        document.getElementById('a'),
        (f: HTMLInputElement) => w.marked.push(f.id),
        () => {},
      );
    }, t.AUTOFILL_CODE);
    await fill('#fn');
    const log = await p.evaluate(() => (window as unknown as { log: Record<string, unknown>[] }).log);
    expect(await values('a')).toEqual(t.AUTOFILL.values);
    for (const id of t.AUTOFILL.fields) {
      const mine = log.filter((e) => e.id === id);
      expect(mine.map((e) => ({ type: e.type, cls: e.cls, autofill: e.autofill })), id).toEqual(t.AUTOFILL.perField);
      expect(mine.every((e) => e.key === undefined && e.inputType === false && e.trusted === true)).toBe(true);
      expect(mine.every((e) => e.active === t.AUTOFILL.active)).toBe(true);
    }
    expect(log.filter((e) => e.type === 'beforeinput')).toHaveLength(t.AUTOFILL.beforeinput);
    // AUTOFILL_CODE: каждое поле помечено как заполненное браузером.
    expect(await p.evaluate(() => (window as unknown as { marked: string[] }).marked)).toEqual(t.AUTOFILL.fields);
  });

  it('правка снимает :autofill', async () => {
    await p.focus('#email');
    await p.keyboard.press('End');
    await p.keyboard.press('Backspace');
    expect(await p.evaluate(() => ({ autofill: document.getElementById('email')!.matches(':autofill') }))).toEqual(t.AUTOFILL.afterEdit);
  });

  it('форма с autocomplete="off" заполнилась, выдуманный токен — нет', async () => {
    await fill('#fn2');
    expect(await values('b')).toEqual(t.AUTOFILL.formOff);
    await fill('#fn3');
    expect(await values('c')).toEqual(t.AUTOFILL.bogusToken);
  });
});
