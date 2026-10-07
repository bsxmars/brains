/**
 * Учёт ресурсов GPU и их состояние после потери контекста.
 *
 * Потеря контекста — единственное событие в этой теме, которое случается в проде само:
 * драйвер перезапустили, вкладка ушла в фон и видеопамять отобрали, соседняя страница уронила
 * GPU-процесс, ноутбук переключился с дискретной карты на встроенную. Ваш код при этом никуда
 * не делся, а **все дескрипторы GPU стали мусором**: текстуры, буферы, программы, VAO.
 *
 * Отдельный модуль — чтобы «стал мусором» было не словом, а проверкой: `gl.isTexture(tex)`
 * отвечает на вопрос прямо, и демо спрашивает его у движка, а не рассказывает за него.
 * Функции здесь чистые относительно контекста — им достаточно объекта с методами `isTexture`,
 * `isBuffer` и соседями, поэтому тест подсовывает поддельный контекст и обходится без GPU.
 */

export type GlResourceKind = 'texture' | 'buffer' | 'program' | 'shader' | 'vao' | 'framebuffer';

/** Что именно надо позвать, чтобы спросить движок о живости ресурса. */
const PROBE: Record<GlResourceKind, string> = {
  texture: 'isTexture',
  buffer: 'isBuffer',
  program: 'isProgram',
  shader: 'isShader',
  vao: 'isVertexArray',
  framebuffer: 'isFramebuffer',
};

export interface ResourceSlot {
  kind: GlResourceKind;
  /** Подпись для читателя: «текстура 64×64», «буфер вершин». */
  label: string;
  /** Дескриптор от `gl.createTexture()` и соседей. `null` — ещё не создан. */
  handle: unknown;
}

export interface ResourceRow extends ResourceSlot {
  /** Что ответил движок на прямой вопрос. */
  alive: boolean;
  /** Каким вызовом спросили — печатается рядом, чтобы читатель мог повторить. */
  probe: string;
}

interface ProbeContext {
  [method: string]: unknown;
}

export function resourceReport(gl: ProbeContext | null, slots: ResourceSlot[]): ResourceRow[] {
  return slots.map((slot) => {
    const probe = PROBE[slot.kind];
    const fn = gl?.[probe];
    const alive =
      typeof fn === 'function' && slot.handle !== null
        ? Boolean((fn as (h: unknown) => boolean).call(gl, slot.handle))
        : false;
    return { ...slot, alive, probe: `gl.${probe}()` };
  });
}

/**
 * Имена кодов ошибок.
 *
 * `gl.getError()` возвращает число, и число это в коде обычно и остаётся — а потом в баг-репорте
 * стоит «ошибка 37442», по которой ничего не найти. 37442 — это `CONTEXT_LOST_WEBGL` (0x9242),
 * снято запуском: ровно его отдаёт потерянный контекст.
 */
export const GL_ERROR_NAMES: Record<number, string> = {
  0: 'NO_ERROR',
  1280: 'INVALID_ENUM',
  1281: 'INVALID_VALUE',
  1282: 'INVALID_OPERATION',
  1285: 'OUT_OF_MEMORY',
  1286: 'INVALID_FRAMEBUFFER_OPERATION',
  37442: 'CONTEXT_LOST_WEBGL',
};

export function glErrorName(code: number): string {
  return GL_ERROR_NAMES[code] ?? `0x${code.toString(16).toUpperCase()}`;
}

/** Сколько ресурсов пережило событие — короткая сводка над таблицей. */
export function aliveCount(rows: ResourceRow[]): number {
  return rows.filter((row) => row.alive).length;
}
