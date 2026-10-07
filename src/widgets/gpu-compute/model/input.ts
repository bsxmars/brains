import type { GpuBinding, GpuPreset, Inputs } from './types';

/**
 * Входы демо — детерминированные, чтобы эталон и GPU получили одно и то же, а тест мог
 * пересчитать то же самое без браузера.
 *
 * ⚠️ Генератор — mulberry32, а не линейный конгруэнтный. С ЛКГ по модулю 2³² младшие биты
 * периодичны: при проверке демо `(s >>> 8) % 16` дал гистограмму из шестнадцати ровных
 * 4096 — корзины заполнялись по кругу, и гонка на такой гистограмме выглядела бы иначе,
 * чем на настоящих данных. Проверено запуском, закреплено `tests/unit/webgpu.test.ts`.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export const SEED = 20260928;

export function makeInputs(n: number, seed = SEED): Inputs {
  const next = mulberry32(seed);
  const a = new Uint32Array(n);
  const b = new Uint32Array(n);
  const values = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = next();
    b[i] = next();
    values[i] = next();
  }
  return { a, b, values };
}

/** Длина буфера привязки в элементах `u32`. */
export function bindingLength(binding: GpuBinding, preset: GpuPreset): number {
  return binding.length === 'bins' ? (preset.bins ?? 0) : preset.n;
}

/** Содержимое буфера перед отправкой: вход или нули. */
export function bindingData(binding: GpuBinding, preset: GpuPreset, inputs: Inputs): Uint32Array {
  if (binding.source === 'zeros') return new Uint32Array(bindingLength(binding, preset));
  return inputs[binding.source];
}

/** Сколько рабочих групп запросить, чтобы покрыть `n` элементов: с округлением вверх. */
export function workgroupCount(n: number, size: number): number {
  return Math.ceil(n / size);
}

/** Исходник эталона → функция. Тот же вызов делает тест: исполняется строка из данных темы. */
export function compileReference(source: string): (input: Inputs, bins?: number) => Uint32Array {
  return new Function(`"use strict"; return (${source});`)() as (input: Inputs, bins?: number) => Uint32Array;
}

/** Расхождения с эталоном и несколько строк для показа — первые расхождения или первые элементы. */
export function compare(got: Uint32Array, want: Uint32Array, show = 5) {
  let mismatches = 0;
  const bad: number[] = [];
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) {
      mismatches++;
      if (bad.length < show) bad.push(i);
    }
  }
  const idx = bad.length > 0 ? bad : Array.from({ length: Math.min(show, want.length) }, (_, i) => i);
  return {
    mismatches,
    sample: idx.map((i) => ({ i, gpu: got[i] ?? 0, js: want[i] })),
    sum: got.reduce((s, v) => s + v, 0),
    sumExpected: want.reduce((s, v) => s + v, 0),
  };
}
