import { describe, expect, it } from 'vitest';
import { ISOLATION, ISOLATION_FOOT } from '@/content/platform/security/data';

/**
 * «Безопасность фронтенда», раздел «Изоляция страницы: COOP и COEP».
 *
 * Перенесено 2026-11-03 из `workers.test.ts` вместе с разделом. Таблица `ISOLATION` снята
 * в Chromium 153 (см. докстринг в `data.ts`); здесь сторожится, что подпись под демо
 * не спорит с ней: без изоляции имени `SharedArrayBuffer` нет, проверять надо
 * `crossOriginIsolated`, а буфер всё равно достаётся через общую память WebAssembly.
 */
describe('изоляция · текст не спорит с таблицей замера', () => {
  it('без изоляции `typeof SharedArrayBuffer` — undefined, и подпись не говорит «конструктор оставлен»', () => {
    const row = ISOLATION.rows.find((r) => r[0] === '`typeof SharedArrayBuffer`')!;
    expect(row[1]).toBe("'undefined'");
    expect(ISOLATION_FOOT).not.toMatch(/оставля\w* конструктор/);
    expect(ISOLATION_FOOT).toContain('crossOriginIsolated');
    expect(ISOLATION_FOOT).toMatch(/WebAssembly/);
  });
});
