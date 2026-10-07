/**
 * Счётчик обращений к контексту — обёртка, через которую демо считает вызовы честно.
 *
 * Правило курса: число на странице снято, а не вспомнено. Для WebGL из этого следует неудобное:
 * **время мерить нечем**, а структуру — можно. Сколько раз позвали отрисовку, сколько раз
 * переключили состояние, сколько байт уехало в видеопамять — это свойство вашего кода, оно
 * одинаково на любой машине и воспроизводится в проверках. С него и считаем.
 *
 * Обёртка — `Proxy` поверх настоящего контекста: демо работает с ним как обычно, а счётчик
 * набегает сам. Тот же приём годится и в бою — вставить обёртку на время отладки и посмотреть,
 * сколько вызовов уходит на кадр, дешевле, чем гадать по профайлеру.
 *
 * ⚠️ Списки имён экспортируются намеренно: демо печатает их читателю. Счётчик, про который
 * не сказано, что именно он считает, — это ровно то число, которое следующий автор сверит
 * со своим и «исправит» верное на неверное.
 */

/** Вызовы отрисовки: каждый — отдельная команда GPU и отдельный проход по конвейеру. */
export const DRAW_CALLS = [
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'multiDrawArraysWEBGL',
  'multiDrawElementsWEBGL',
] as const;

/** Смены состояния: то, ради чего драйвер перестраивает конвейер между вызовами. */
export const STATE_CALLS = [
  'useProgram',
  'bindBuffer',
  'bindVertexArray',
  'bindTexture',
  'bindFramebuffer',
  'vertexAttribPointer',
  'enableVertexAttribArray',
  'blendFunc',
  'enable',
  'disable',
] as const;

/** Загрузка данных: перенос через границу CPU → GPU. */
export const UPLOAD_CALLS = [
  'bufferData',
  'bufferSubData',
  'texImage2D',
  'texSubImage2D',
  'texStorage2D',
  'compressedTexImage2D',
] as const;

export interface GlCounters {
  /** Вызовов отрисовки. */
  draw: number;
  /** Экземпляров суммарно: у инстансированного вызова их много, у обычного — один. */
  instances: number;
  /** Смен состояния. */
  state: number;
  /** Загрузок данных в видеопамять. */
  upload: number;
  /** Обновлений униформ — их считаем отдельно: это тоже трафик на каждый вызов. */
  uniform: number;
}

export function emptyCounters(): GlCounters {
  return { draw: 0, instances: 0, state: 0, upload: 0, uniform: 0 };
}

const DRAW = new Set<string>(DRAW_CALLS);
const STATE = new Set<string>(STATE_CALLS);
const UPLOAD = new Set<string>(UPLOAD_CALLS);

/** У какого аргумента живёт число экземпляров. */
const INSTANCE_ARG: Record<string, number> = {
  drawArraysInstanced: 3,
  drawElementsInstanced: 4,
};

/**
 * Обёрнутый контекст: снаружи он неотличим от настоящего, внутри — считает.
 *
 * ⚠️ Метод обязан вызываться с `this`, равным настоящему контексту: у WebGL реализация нативная
 * и на чужом получателе бросает `Illegal invocation`. Поэтому в ловушке `get` возвращается
 * функция, зовущая оригинал через `apply` на цели, а не сам метод.
 */
export function countingContext<T extends object>(gl: T, counters: GlCounters): T {
  const cache = new Map<string, unknown>();

  return new Proxy(gl, {
    get(target, key, receiver) {
      if (typeof key !== 'string') return Reflect.get(target, key, receiver);

      const value = (target as Record<string, unknown>)[key];
      if (typeof value !== 'function') return value;

      const cached = cache.get(key);
      if (cached) return cached;

      const fn = value as (...args: unknown[]) => unknown;
      const wrapped = (...args: unknown[]) => {
        if (DRAW.has(key)) {
          counters.draw++;
          const at = INSTANCE_ARG[key];
          counters.instances += at === undefined ? 1 : Number(args[at] ?? 1);
        } else if (STATE.has(key)) {
          counters.state++;
        } else if (UPLOAD.has(key)) {
          counters.upload++;
        } else if (key.startsWith('uniform') || key === 'vertexAttrib2f' || key === 'vertexAttrib4f') {
          counters.uniform++;
        }
        return fn.apply(target, args);
      };

      cache.set(key, wrapped);
      return wrapped;
    },
  }) as T;
}
