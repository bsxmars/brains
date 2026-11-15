import { describe, expect, it } from 'vitest';
import { ISOLATION, ISOLATION_FOOT, ISOLATION_NOTE, ISOLATION_WHY, ORIGIN_PARTS, SOP_ALLOWS, SOP_FORBIDS } from '@/content/platform/security/data';

/**
 * «Безопасность фронтенда», раздел «Изоляция страницы: COOP и COEP».
 *
 * Перенесено 2026-11-03 из `workers.test.ts` вместе с разделом. Таблица `ISOLATION` снята
 * в Chromium 153 (см. докстринг в `data.ts`); здесь сторожится, что подпись под демо
 * не спорит с ней: без изоляции имени `SharedArrayBuffer` нет, проверять надо
 * `crossOriginIsolated`, а буфер всё равно достаётся через общую память WebAssembly.
 */
describe('изоляция · текст не спорит с таблицей замера', () => {
  it('COOP/COEP задают условия режима, а не доказывают состав памяти процесса', () => {
    // Заголовки и нормативная граница не превращают браузерный снимок в аудит памяти.
    expect(ISOLATION_WHY).toContain('не проверка содержимого процесса');
    expect(ISOLATION_WHY).toContain('COOP: same-origin');
    expect(ISOLATION_WHY).toContain('COEP: require-corp');
    expect(ISOLATION_NOTE).toContain('в этом замере');
  });
  it('без изоляции `typeof SharedArrayBuffer` — undefined, и подпись не говорит «конструктор оставлен»', () => {
    const row = ISOLATION.rows.find((r) => r[0] === '`typeof SharedArrayBuffer`')!;
    expect(row[1]).toBe("'undefined'");
    expect(ISOLATION_FOOT).not.toMatch(/оставля\w* конструктор/);
    expect(ISOLATION_FOOT).toContain('crossOriginIsolated');
    expect(ISOLATION_FOOT).toMatch(/WebAssembly/);
  });
});


describe('границы origin и автоматических кук', () => {
  it('opaque origin равен самому себе; null — только сериализация', () => {
    // HTML Standard, same origin: одна идентичность opaque сравнивается равной себе.
    const opaque = ORIGIN_PARTS.find((part) => part.t.includes('opaque'))!;
    expect(opaque.d).toContain('равен самому себе');
    expect(opaque.d).toContain('Два независимо созданных');
    expect(opaque.d).toContain('file:');
    expect(opaque.d).toContain('зависят от реализации');
  });
  it('SOP не превращает cookie Domain в origin и не обещает куки любой форме', () => {
    expect(SOP_FORBIDS.join(' ')).toContain('общий Domain');
    expect(SOP_ALLOWS[0]).toContain('SameSite');
    expect(SOP_ALLOWS[0]).toContain('могут уйти');
  });
});
