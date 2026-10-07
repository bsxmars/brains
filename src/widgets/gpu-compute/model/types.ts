/**
 * Типы демо «вычисление на GPU».
 *
 * Предустановка описывает задачу целиком: шейдер, эталон на JS и — отдельно от шейдера —
 * раскладку привязок, из которой демо строит `GPUBindGroupLayout`. Раскладка лежит в данных
 * намеренно: так её можно сверить с `@group/@binding` в тексте шейдера разбором строки
 * (`tests/unit/webgpu.test.ts`), а расхождение станет красным тестом, а не ошибкой проверки
 * у читателя в консоли.
 */

/** Тип привязки буфера — как его называет `GPUBufferBindingLayout.type`. */
export type BindingType = 'read-only-storage' | 'storage' | 'uniform';

/** Откуда берутся данные буфера. */
export type BufferSource = 'a' | 'b' | 'values' | 'zeros';

export interface GpuBinding {
  binding: number;
  type: BindingType;
  /** Имя переменной в шейдере — по нему тест находит объявление. */
  name: string;
  source: BufferSource;
  /** Длина в элементах `u32`: по числу входов или по числу корзин гистограммы. */
  length: 'n' | 'bins';
  /** Этот буфер читается обратно и сверяется с эталоном. */
  out?: boolean;
  /**
   * Ошибка, которую демо делает нарочно: буфер создан без флага `STORAGE`. Самая частая
   * ошибка первого дня — и она не бросает исключения.
   */
  forgetStorage?: boolean;
}

export interface GpuPreset {
  key: string;
  label: string;
  wgsl: string;
  /** Исходник эталона: `function reference(input, bins) { … }` → `Uint32Array`. */
  reference: string;
  bindings: GpuBinding[];
  /** Должен совпадать с `@workgroup_size` шейдера — сверяет тест. */
  workgroupSize: number;
  n: number;
  bins?: number;
  /** Чего ждать: совпадения, расхождения (гонка) или ошибки проверки. */
  expect: 'match' | 'mismatch' | 'error';
  /** Подпись под результатом. Разрешена строчная разметка. */
  note: string;
}

export interface Inputs {
  a: Uint32Array;
  b: Uint32Array;
  values: Uint32Array;
}

export type StageKey = 'device' | 'buffers' | 'pipeline' | 'encode' | 'submit' | 'map' | 'check';

export type StageState = 'idle' | 'run' | 'ok' | 'err' | 'warn';

export interface Stage {
  key: StageKey;
  /** Вызов API, которым этап сделан, — моноширинно. */
  call: string;
  state: StageState;
  /** Что вышло: строчная разметка разрешена. */
  detail: string;
}

export interface Sample {
  i: number;
  gpu: number;
  js: number;
}

/** Почему WebGPU нет: имени нет вовсе, имя есть без адаптера, или страница не в защищённом контексте. */
export type Absence = 'no-api' | 'no-adapter' | 'insecure';

export interface RunResult {
  /** `gpu` — считал ваш GPU; `model` — WebGPU нет, конвейер показан моделью на JS. */
  mode: 'gpu' | 'model';
  stages: Stage[];
  /** Сколько элементов вышло не таким, как у эталона. `null` — сравнивать нечего. */
  mismatches: number | null;
  total: number;
  sample: Sample[];
  /** Сумма всех элементов результата — для гистограммы это число учтённых значений. */
  sum: number;
  sumExpected: number;
  /** Для модели: почему не GPU. */
  absence?: Absence;
}
