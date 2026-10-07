import type { FieldKind, PngApi, PngField, PngInfo, ReadApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `READ_CODE` и `PNG_CODE` из темы
 * «Бинарные данные». Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/binary-data.test.ts`: `readAs` — против настоящих типизированных массивов,
 * `parsePng` и `crc32` — против `zlib.crc32`, `zlib.inflateSync` и размеров, которые вернул
 * Chromium. Копии нет: разойдётся показанный код с движком — покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadRead(code: string): ReadApi {
  return new Function(`${code}\nreturn { TYPES, readAs };`)() as ReadApi;
}

export function loadPng(code: string): PngApi {
  return new Function(`${code}\nreturn { SIGNATURE, crc32, parsePng };`)() as PngApi;
}

const hex = (n: number, w: number) => `0x${n.toString(16).padStart(w, '0')}`;
const COLOR: Record<number, string> = { 0: 'оттенки серого', 2: 'RGB', 3: 'палитра', 4: 'серый с прозрачностью', 6: 'RGBA' };

/**
 * Раскладка файла по полям — по ответу `parsePng`, без своего разбора: смещения и длины берутся
 * из `chunks`, числа `IHDR` — из `info`. Хвост, который разбор не дошёл (обрезанный файл), —
 * поле «не разобрано».
 */
export function pngFields(info: PngInfo, total: number): PngField[] {
  const out: PngField[] = [{ start: 0, end: 8, kind: 'sig', name: 'сигнатура', value: '`89 50 4e 47 0d 0a 1a 0a` — это PNG' }];
  const f = (start: number, end: number, kind: FieldKind, name: string, value: string) => out.push({ start, end, kind, name, value });

  for (const c of info.chunks) {
    const d = c.offset + 8;
    f(c.offset, c.offset + 4, 'len', `длина ${c.type}`, `\`${c.length}\` байт данных`);
    f(c.offset + 4, d, 'type', 'тип блока', `\`${c.type}\``);
    if (c.type === 'IHDR' && c.length === 13) {
      f(d, d + 4, 'data', 'ширина', `\`${info.width}\` пикс. (как little-endian было бы ${new DataView(c.data.buffer, c.data.byteOffset).getUint32(0, true).toLocaleString('ru')})`);
      f(d + 4, d + 8, 'data', 'высота', `\`${info.height}\` пикс.`);
      f(d + 8, d + 9, 'data', 'бит на канал', `\`${info.bitDepth}\``);
      f(d + 9, d + 10, 'data', 'тип цвета', `\`${info.colorType}\` — ${COLOR[info.colorType] ?? 'неизвестный'}`);
      f(d + 10, d + 11, 'data', 'сжатие', `\`${c.data[10]}\` — deflate`);
      f(d + 11, d + 12, 'data', 'фильтр', `\`${c.data[11]}\``);
      f(d + 12, d + 13, 'data', 'чересстрочность', `\`${info.interlace}\` — ${info.interlace ? 'Adam7' : 'нет'}`);
    } else if (c.length > 0) {
      f(d, d + c.length, 'data', `данные ${c.type}`, c.type === 'IDAT' ? `\`${c.length}\` байт сжатых пикселей` : `\`${c.length}\` байт`);
    }
    f(d + c.length, d + c.length + 4, 'crc', `CRC ${c.type}`, `\`${hex(c.crc, 8)}\` — ${c.crcOk ? '**сходится**' : '**не сходится**'}`);
  }

  const last = out[out.length - 1].end;
  if (last < total) f(last, total, 'data', 'не разобрано', 'байты, до которых разбор не дошёл');
  return out;
}

/** Раскладка, когда `parsePng` бросил: сигнатура и всё остальное одним неразобранным полем. */
export function fallbackFields(total: number): PngField[] {
  const out: PngField[] = [{ start: 0, end: Math.min(8, total), kind: 'sig', name: 'сигнатура', value: 'первые 8 байт файла' }];
  if (total > 8) out.push({ start: 8, end: total, kind: 'data', name: 'не разобрано', value: 'разбор остановился с ошибкой' });
  return out;
}
