/**
 * Разбор лога компилятора GLSL — того самого, что отдаёт `gl.getShaderInfoLog()`.
 *
 * Зачем отдельный модуль. Демо урока обещает читателю **настоящий текст ошибки от движка**,
 * а не пересказ: правишь шейдер, жмёшь «собрать» — и видишь то же, что увидел бы в своём
 * проекте. Показать лог как есть мало: чтобы подсветить виноватую строку в редакторе, номер
 * из лога надо достать. Разбор — чистая функция, и потому он закрыт тестом
 * (`tests/unit/webgl.test.ts`), который не просит ни GPU, ни браузера.
 *
 * Формат строки лога задан спекой GLSL ES (§9.3 «Diagnostics»):
 *
 *     ERROR: 0:8: 'u_tim' : undeclared identifier
 *     ^      ^ ^  ^         ^
 *     |      | |  |         └ сообщение
 *     |      | |  └ символ, о котором речь
 *     |      | └ номер СТРОКИ
 *     |      └ индекс исходника в массиве, переданном в shaderSource
 *     └ ERROR или WARNING
 *
 * ⚠️ **Первое число — не колонка.** Это индекс строки исходного текста в том массиве, который
 * получил `shaderSource`, и почти всегда он равен нулю: строку передают одну. Ошибку «0:8 —
 * это восьмая колонка» делают регулярно, и стоит она получаса поисков не в том месте.
 *
 * ⚠️ Строки без координат существуют: `ERROR: -1:-1: '' : Missing main()`. Минус один означает
 * «к конкретной строке не привязано», и подсвечивать по нему нечего — такую ошибку показываем
 * текстом. Проверено запуском (см. шапку `data.ts` темы).
 *
 * ⚠️ Точного формата **не обещает никто**: спека фиксирует его как рекомендацию, а драйверы
 * вольны писать по-своему. Поэтому разбор здесь снисходительный: не разобралось — строка
 * остаётся сообщением без номера, и читатель всё равно видит её целиком. Лог никогда
 * не прячется за разбором.
 */

export type IssueSeverity = 'error' | 'warning';

export interface ShaderIssue {
  severity: IssueSeverity;
  /** Номер строки в исходнике читателя, считая с единицы. `null` — ошибка без привязки. */
  line: number | null;
  /** Индекс исходника в массиве `shaderSource`. Почти всегда 0 — и это не колонка. */
  source: number | null;
  /** Текст сообщения без префикса и координат. */
  text: string;
  /** Исходная строка лога — её и показываем читателю. */
  raw: string;
}

/** `ERROR: 0:8: 'u_tim' : undeclared identifier` — префикс, два числа, остаток. */
const LINE = /^(ERROR|WARNING)\s*:\s*(-?\d+)\s*:\s*(-?\d+)\s*:\s*(.*)$/i;
/** Тот же префикс, но без координат — встречается у ошибок уровня всей программы. */
const BARE = /^(ERROR|WARNING)\s*:\s*(.*)$/i;

export function parseShaderLog(log: string): ShaderIssue[] {
  const issues: ShaderIssue[] = [];

  for (const raw of log.split('\n')) {
    const text = raw.trim();
    if (!text) continue;

    const full = LINE.exec(text);
    if (full) {
      const line = Number(full[3]);
      issues.push({
        severity: full[1].toLowerCase() === 'warning' ? 'warning' : 'error',
        // Отрицательные координаты означают «не привязано к строке», а не «строка минус первая».
        line: line > 0 ? line : null,
        source: Number(full[2]) >= 0 ? Number(full[2]) : null,
        text: full[4].trim(),
        raw: text,
      });
      continue;
    }

    const bare = BARE.exec(text);
    if (bare) {
      issues.push({
        severity: bare[1].toLowerCase() === 'warning' ? 'warning' : 'error',
        line: null,
        source: null,
        text: bare[2].trim(),
        raw: text,
      });
      continue;
    }

    // Лог линковки координат не содержит вовсе: «Types of varying 'v_uv' differ between
    // VERTEX and FRAGMENT shaders.» Это всё равно ошибка, и молчать о ней нельзя.
    issues.push({ severity: 'error', line: null, source: null, text, raw: text });
  }

  return issues;
}

/** Номера строк, которые надо подсветить в редакторе, — по возрастанию и без повторов. */
export function badLines(issues: ShaderIssue[]): number[] {
  const lines = new Set<number>();
  for (const issue of issues) if (issue.line !== null) lines.add(issue.line);
  return [...lines].sort((a, b) => a - b);
}

/**
 * Первая ошибка — короткая сводка над логом.
 *
 * Компилятор часто выдаёт вторую ошибку как следствие первой (`undeclared identifier`, а следом
 * `not enough data provided for construction`), поэтому читателю полезнее знать, с какой начать.
 */
export function firstError(issues: ShaderIssue[]): ShaderIssue | null {
  return issues.find((i) => i.severity === 'error') ?? null;
}
