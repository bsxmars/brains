import { describe, expect, it } from 'vitest';
import { countingContext, emptyCounters } from '@/widgets/draw-calls/lib/counter';
import { aliveCount, glErrorName, resourceReport } from '@/widgets/context-loss/lib/resources';
import { badLines, firstError, parseShaderLog } from '@/widgets/shader-lab/lib/parse-log';
import { DEPTH_STEP, FRAMEBUFFER_FACTS, TEXTURE_FACTS } from '@/content/render/webgl/data';

/**
 * Структурные утверждения темы «WebGL: где кончается браузер».
 *
 * Тема про GPU, а тест GPU не просит — и это не компромисс, а её главный тезис. Время работы
 * видеокарты измерить в проверках нельзя вовсе: в headless-Chromium проекта работает программный
 * растеризатор (`ANGLE … SwiftShader`), а расширение `EXT_disjoint_timer_query_webgl2`
 * отсутствует. Что **можно** — считать структуру: сколько вызовов отрисовки делает код, сколько
 * экземпляров рисует один вызов, что именно умирает при потере контекста и как разбирается лог
 * компилятора. Это одинаково на любой машине, поэтому здесь и закрепляется.
 *
 * Логи в первом блоке — не выдуманные: они сняты запуском в том самом Chromium 153.0.8010.12
 * (Playwright 1.63, headless, ANGLE/SwiftShader) и перенесены сюда байт в байт.
 */

describe('лог компилятора GLSL', () => {
  it('разбирает координаты настоящей ошибки', () => {
    const issues = parseShaderLog("ERROR: 0:8: 'u_tim' : undeclared identifier\n");

    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    // Второе число — номер СТРОКИ. Первое (0) — индекс исходника в массиве shaderSource,
    // и принять его за колонку стоит получаса поисков не в том месте.
    expect(issues[0].line).toBe(8);
    expect(issues[0].source).toBe(0);
    expect(issues[0].text).toBe("'u_tim' : undeclared identifier");
  });

  it('вторая ошибка часто следствие первой — обе видны, подсветка одна', () => {
    const log =
      "ERROR: 0:5: 'uv' : undeclared identifier\n" +
      "ERROR: 0:5: 'constructor' : not enough data provided for construction\n";
    const issues = parseShaderLog(log);

    expect(issues).toHaveLength(2);
    expect(badLines(issues)).toEqual([5]);
    expect(firstError(issues)?.text).toBe("'uv' : undeclared identifier");
  });

  it('ошибка без строки не притворяется первой строкой', () => {
    // Так компилятор сообщает об отсутствии main(): координаты -1:-1.
    const issues = parseShaderLog("ERROR: -1:-1: '' : Missing main()\n");

    expect(issues[0].line).toBeNull();
    expect(issues[0].source).toBeNull();
    expect(badLines(issues)).toEqual([]);
  });

  it('лог линковки без координат не теряется', () => {
    const log =
      "Types of varying 'v_uv' differ between VERTEX and FRAGMENT shaders.\n" +
      'FRAGMENT varying v_uv does not match any VERTEX varying\n';
    const issues = parseShaderLog(log);

    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
    expect(issues[0].text).toContain("varying 'v_uv' differ");
  });

  it('предупреждение не выдаётся за ошибку', () => {
    const issues = parseShaderLog(
      "WARNING: 0:3: 'u_unused' : unused variable\nERROR: 0:9: '}' : syntax error\n",
    );

    expect(issues.map((i) => i.severity)).toEqual(['warning', 'error']);
    expect(firstError(issues)?.line).toBe(9);
    // Подсвечивать строку предупреждения тоже надо: читателю важно, где оно.
    expect(badLines(issues)).toEqual([3, 9]);
  });

  it('пустой лог — это успех, а не ошибка без текста', () => {
    expect(parseShaderLog('')).toEqual([]);
    expect(parseShaderLog('\n\n')).toEqual([]);
    expect(firstError([])).toBeNull();
  });
});

/**
 * Поддельный контекст: счётчику всё равно, кто на той стороне, — ему нужны имена методов.
 * Заодно проверяется, что обёртка не теряет `this`: у настоящего WebGL реализация нативная
 * и на чужом получателе бросает `Illegal invocation`.
 */
function fakeGl() {
  const calls: string[] = [];
  return {
    calls,
    TRIANGLES: 4,
    drawArrays(this: { calls: string[] }) {
      this.calls.push('drawArrays');
    },
    // Аргументы нужны по-настоящему: счётчик читает из них число экземпляров.
    drawArraysInstanced(this: { calls: string[] }, ..._args: number[]) {
      this.calls.push('drawArraysInstanced');
    },
    useProgram(this: { calls: string[] }) {
      this.calls.push('useProgram');
    },
    bindBuffer(this: { calls: string[] }) {
      this.calls.push('bindBuffer');
    },
    bufferData(this: { calls: string[] }) {
      this.calls.push('bufferData');
    },
    uniform1f(this: { calls: string[] }) {
      this.calls.push('uniform1f');
    },
    vertexAttrib2f(this: { calls: string[] }) {
      this.calls.push('vertexAttrib2f');
    },
    getParameter() {
      return 8192;
    },
  };
}

describe('счётчик обращений к контексту', () => {
  it('тысяча квадратов тысячей вызовов и одним инстансированным — это 1000 против 1', () => {
    const perCall = emptyCounters();
    const byCall = countingContext(fakeGl(), perCall);
    for (let i = 0; i < 1000; i++) {
      byCall.vertexAttrib2f();
      byCall.drawArrays();
    }

    const perInstance = emptyCounters();
    const instanced = countingContext(fakeGl(), perInstance);
    instanced.drawArraysInstanced(4, 0, 6, 1000);

    expect(perCall.draw).toBe(1000);
    expect(perInstance.draw).toBe(1);

    // Экземпляров при этом ровно столько же: работа для растеризатора одна и та же,
    // разная только цена разговора с драйвером.
    expect(perCall.instances).toBe(1000);
    expect(perInstance.instances).toBe(1000);
  });

  it('состояние, загрузки и униформы считаются по отдельности', () => {
    const counters = emptyCounters();
    const gl = countingContext(fakeGl(), counters);

    gl.useProgram();
    gl.bindBuffer();
    gl.bufferData();
    gl.uniform1f();
    gl.drawArrays();

    expect(counters).toEqual({ draw: 1, instances: 1, state: 2, upload: 1, uniform: 1 });
  });

  it('обёртка не теряет получателя и не подменяет константы', () => {
    const counters = emptyCounters();
    const raw = fakeGl();
    const gl = countingContext(raw, counters);

    gl.drawArrays();
    gl.useProgram();

    // Метод отработал на настоящем контексте, а не на прокси-пустышке.
    expect(raw.calls).toEqual(['drawArrays', 'useProgram']);
    // Константа остаётся константой: оборачивать имеет смысл только функции.
    expect(gl.TRIANGLES).toBe(4);
    expect(gl.getParameter()).toBe(8192);
  });
});

/** Контекст, который отвечает на `is*` тем, что ему велели: «до потери» и «после». */
function ledgerGl(alive: boolean) {
  return {
    isTexture: () => alive,
    isBuffer: () => alive,
    isProgram: () => alive,
    isVertexArray: () => alive,
    isShader: () => alive,
    isFramebuffer: () => alive,
  };
}

describe('ресурсы после потери контекста', () => {
  const slots = [
    { kind: 'texture' as const, label: 'текстура 64×64', handle: {} },
    { kind: 'buffer' as const, label: 'буфер вершин', handle: {} },
    { kind: 'program' as const, label: 'программа', handle: {} },
    { kind: 'vao' as const, label: 'VAO', handle: {} },
  ];

  it('до потери живы все', () => {
    const rows = resourceReport(ledgerGl(true), slots);
    expect(aliveCount(rows)).toBe(4);
  });

  it('после потери не выживает ни один — и это не зависит от вида ресурса', () => {
    const rows = resourceReport(ledgerGl(false), slots);
    expect(aliveCount(rows)).toBe(0);
    expect(rows.map((r) => r.alive)).toEqual([false, false, false, false]);
  });

  it('рядом с каждой строкой стоит вызов, которым её можно перепроверить', () => {
    const rows = resourceReport(ledgerGl(true), slots);
    expect(rows.map((r) => r.probe)).toEqual([
      'gl.isTexture()',
      'gl.isBuffer()',
      'gl.isProgram()',
      'gl.isVertexArray()',
    ]);
  });

  it('контекста нет вовсе — считаем ресурсы мёртвыми, а не падаем', () => {
    const rows = resourceReport(null, slots);
    expect(aliveCount(rows)).toBe(0);
  });

  it('37442 — это CONTEXT_LOST_WEBGL, а не «ошибка номер много»', () => {
    expect(glErrorName(37442)).toBe('CONTEXT_LOST_WEBGL');
    expect(glErrorName(0)).toBe('NO_ERROR');
    expect(glErrorName(1282)).toBe('INVALID_OPERATION');
    // Незнакомый код печатается шестнадцатеричным: по нему хотя бы ищется в заголовках.
    expect(glErrorName(0x9000)).toBe('0x9000');
  });
});

/**
 * Числа подразделов «глубина», «текстуры» и «фреймбуферы», которые получены счётом, а не замером.
 *
 * Шаг глубины на программном растеризаторе проекта воспроизвести не удалось (см. докстринг
 * `data.ts`), поэтому таблица `DEPTH_STEP` — расчёт, и тест держит его честным: пересчитывает
 * формулу перспективной глубины независимо и требует, чтобы вывод текста — «управляет ближняя
 * плоскость, дальняя почти ни на что не влияет» — следовал из самих чисел.
 */
describe('шаг буфера глубины', () => {
  // Окно глубины d(z) = f/(f−n) − f·n/((f−n)·z); шаг в мире = 2^−bits · dz/dd.
  const step = (n: number, f: number, z: number, bits: number) => 2 ** -bits * ((f - n) * z * z) / (f * n);

  it('каждая клетка таблицы совпадает с формулой с точностью до процента', () => {
    for (const row of DEPTH_STEP.rows) {
      DEPTH_STEP.dist.forEach((z, i) => {
        const exact = step(row.near, DEPTH_STEP.far, z, DEPTH_STEP.bits);
        expect(Math.abs(row.m[i] - exact) / exact).toBeLessThan(0.01);
      });
    }
  });

  it('шаг растёт как квадрат расстояния', () => {
    for (const row of DEPTH_STEP.rows) {
      expect(row.m[1] / row.m[0]).toBeCloseTo(100, 0);
      expect(row.m[2] / row.m[1]).toBeCloseTo(100, 0);
    }
  });

  it('ближняя плоскость ×10 — шаг ÷10, дальняя ×10 — почти ничего', () => {
    const [a, b] = DEPTH_STEP.rows;
    expect(a.m[1] / b.m[1]).toBeCloseTo(10, 0);
    const farther = step(0.1, DEPTH_STEP.far * 10, 100, DEPTH_STEP.bits);
    const base = step(0.1, DEPTH_STEP.far, 100, DEPTH_STEP.bits);
    expect(Math.abs(farther / base - 1)).toBeLessThan(0.001);
  });
});

describe('память текстур', () => {
  const mib = (bytes: number) => bytes / 2 ** 20;
  const chain = (w: number) => {
    let total = 0;
    let levels = 0;
    for (let s = w; s >= 1; s >>= 1) {
      total += s * s * 4;
      levels += 1;
    }
    return { total, levels };
  };
  const text = (t: string) => TEXTURE_FACTS.find((f) => f.t.includes(t))?.d ?? '';

  it('1024×1024 RGBA: 4 МиБ, с мипмапами 5.33 МиБ, одиннадцать уровней', () => {
    const { total, levels } = chain(1024);
    expect(mib(1024 * 1024 * 4)).toBe(4);
    expect(mib(total).toFixed(2)).toBe('5.33');
    expect(levels).toBe(11);
    const d = text('треть памяти');
    expect(d).toContain('4 МиБ');
    expect(d).toContain('5.33 МиБ');
    expect(d).toContain('одиннадцать уровней');
  });

  it('распакованная 2048×2048 RGBA — 16 МиБ', () => {
    expect(mib(2048 * 2048 * 4)).toBe(16);
    expect(text('не PNG')).toContain('16 МиБ');
  });

  it('три канала по 8 бит — около 16.7 млн номеров объектов', () => {
    expect((2 ** 24 / 1e6).toFixed(1)).toBe('16.8');
    const d = FRAMEBUFFER_FACTS.find((f) => f.t.includes('номер объекта'))?.d ?? '';
    expect(d).toContain('16.8 млн');
  });

  it('три полноэкранных прохода на 1920×1080 — около шести миллионов запусков шейдера', () => {
    expect(Math.round((1920 * 1080 * 3) / 1e6)).toBe(6);
    const d = FRAMEBUFFER_FACTS.find((f) => f.t.includes('полный экран'))?.d ?? '';
    expect(d).toContain('шесть миллионов');
  });
});
