import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { DICTIONARY_LIMITS, DICTIONARY_MEASURED } from '@/content/platform/network/data';

/**
 * «Сеть и кеширование», сжатие со словарём. Браузерная половина (Chromium шлёт
 * `Available-Dictionary` и распаковывает `dcz`) снята стендом и описана в `data.ts`; здесь
 * закреплена серверная половина — размеры, которые детерминированы и повторяются в Node.
 * Файлы те же, что на стенде: `vue.global.prod.js` из установленного Vue и он же со вставкой
 * в 25 байт после сотого килобайта.
 */
const require = createRequire(import.meta.url);
const vuePath = require.resolve('vue/dist/vue.global.prod.js');
const vueVersion: string = require('vue/package.json').version;
const v1 = readFileSync(vuePath);
const v2 = Buffer.concat([v1.subarray(0, 100000), Buffer.from('/*patch*/console.log(42);'), v1.subarray(100000)]);

const num = (s: string) => Number(s.replace(/\*|\s/g, ''));
const row = (label: string) => {
  const r = DICTIONARY_MEASURED.rows.find((x) => x[0].startsWith(label));
  if (!r) throw new Error(`в DICTIONARY_MEASURED нет строки «${label}»`);
  return num(r[1]);
};

describe('network: сжатие со словарём', () => {
  it('замер снят на Vue 3.5.42 — на другой версии числа законно другие', () => {
    // Если Vue обновили, красной станет эта проверка, а не числа ниже: перемерьте и поправьте data.ts.
    expect(vueVersion).toBe('3.5.42');
  });

  it('размеры в таблице совпадают с zlib', () => {
    if (vueVersion !== '3.5.42') return;
    const level19 = { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19 } };
    expect(row('без сжатия')).toBe(v2.length);
    expect(row('zstd 19')).toBe(zlib.zstdCompressSync(v2, level19).length);
    expect(row('brotli 11')).toBe(zlib.brotliCompressSync(v2).length);
    // dcz = 8 байт магии и длины + 32 байта SHA-256 словаря + кадр zstd со словарём.
    const dcz = 40 + zlib.zstdCompressSync(v2, { dictionary: v1, ...level19 }).length;
    expect(row('`dcz`')).toBe(dcz);
  });

  it('словарь выигрывает у лучшего сжатия без словаря больше чем в сотню раз — отношение, ради которого карточка', () => {
    expect(row('brotli 11') / row('`dcz`')).toBeGreaterThan(100);
  });

  it('текст называет заголовок в 40 байт и условие «словарь живёт в HTTP-кеше»', () => {
    // Подстроки смысловые: без них карточка перестаёт объяснять, откуда 101 байт и почему no-store не работает.
    expect(DICTIONARY_LIMITS).toContain('40');
    expect(DICTIONARY_LIMITS).toContain('`no-store`');
  });
});
