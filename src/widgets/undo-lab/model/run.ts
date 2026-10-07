import type { CreateEditor, DemoStep, Editor, Entry, FieldState, NativeAct, Op } from './types';

/**
 * Демо и тест спрашивают одну и ту же историю — строки `OPS_CODE`, `XFORM_CODE` и
 * `HISTORY_CODE` из темы «Отмена и повтор», собранные здесь `new Function`.
 *
 * Строки напечатаны на странице; `tests/unit/undo-redo.test.ts` прогоняет их против
 * `Y.UndoManager` и истории `<textarea>` в Chromium. Копии нет — если показанный код разойдётся
 * с ними, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadEditor(opsCode: string, xformCode: string, historyCode: string): CreateEditor {
  return new Function(`${opsCode}\n${xformCode}\n${historyCode}\nreturn createEditor;`)() as CreateEditor;
}

/** Интервал между символами при наборе в сценариях на виртуальном времени. */
export const TYPE_GAP = 120;

/** Проиграть шаги на виртуальном времени. Возвращает время после последнего шага. */
export function play(ed: Editor, steps: DemoStep[], start = 0): number {
  let now = start;
  for (const s of steps) {
    if (s.do === 'type') {
      for (const ch of s.s) {
        ed.insert(ch, now);
        now += TYPE_GAP;
      }
    } else if (s.do === 'wait') now += s.ms;
    else if (s.do === 'undo') ed.undo();
    else ed.redo();
  }
  return now;
}

/**
 * Сценарий сверки с `<textarea>` — так же, как его играет Chromium: стрелки двигают каретку
 * (`select`), Enter — вставка перевода строки. Возвращает состояние после каждого Ctrl+Z/Ctrl+Shift+Z.
 */
export function playNative(ed: Editor, acts: NativeAct[]): FieldState[] {
  let now = 0;
  const out: FieldState[] = [];
  for (const a of acts) {
    now += 100;
    if (a[0] === 'type') {
      for (const ch of a[1]) {
        ed.insert(ch, now);
        now += 100;
      }
    } else if (a[0] === 'wait') now += a[1];
    else if (a[0] === 'select') ed.select(a[1], a[2]);
    else if (a[0] === 'key') {
      if (a[1] === 'Backspace') ed.backspace(now);
      else if (a[1] === 'Enter') ed.insert('\n', now);
      else if (a[1] === 'ArrowLeft') ed.select(Math.max(0, ed.sel[0] - 1));
      else ed.select(Math.min(ed.text.length, ed.sel[1] + 1));
    } else {
      if (a[0] === 'undo') ed.undo();
      else ed.redo();
      out.push([ed.text, ed.sel[0], ed.sel[1]]);
    }
  }
  return out;
}

/** Кусок записи для показа: подряд идущие правки одного вида склеены в одну строку. */
export interface Run {
  type: 'ins' | 'del';
  pos: number;
  text: string;
}

/**
 * Склеить правки записи для подписи: «удалить „вет“ с 3», «вставить „ab“ на 0».
 * Это только подпись — шаг делает `step` из `HISTORY_CODE`, правка за правкой.
 */
export function runs(entry: Entry): { runs: Run[]; eaten: number } {
  const out: Run[] = [];
  let eaten = 0;
  for (const op of entry.ops as (Op | null)[]) {
    if (!op) {
      eaten++;
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.type === op.type) {
      const end = prev.pos + prev.text.length;
      if (op.type === 'ins' && op.pos === end) {
        prev.text += op.ch;
        continue;
      }
      if (op.type === 'ins' && op.pos === prev.pos) {
        prev.text = op.ch + prev.text;
        continue;
      }
      if (op.type === 'del' && op.pos === prev.pos - 1) {
        prev.text = op.ch + prev.text;
        prev.pos = op.pos;
        continue;
      }
      if (op.type === 'del' && op.pos === prev.pos) {
        prev.text += op.ch;
        continue;
      }
    }
    out.push({ type: op.type, pos: op.pos, text: op.ch });
  }
  return { runs: out, eaten };
}
