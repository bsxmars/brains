import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/browser-architecture/data';
import { ORINOCO } from '@/content/lessons/memory-gc/data';

const MDX = readFileSync('src/content/lessons/browser-architecture/index.mdx', 'utf8');

describe('«Устройство браузера»: вычитка 2026-10-30', () => {
  it('ссылка на «Память и GC» называет карточку, которая там есть, и её раздел', () => {
    expect(ORINOCO.some((c) => c.k.startsWith('общий обход с DOM'))).toBe(true);
    expect(MDX).toContain('(/js/memory-gc/#s1), карточка «общий обход с DOM» в разделе «Путь объекта»');
    expect(MDX).not.toContain('карточка словаря «общая куча с DOM»');
  });

  it('measureUserAgentSpecificMemory не «отбирали после Spectre» — только первые две возможности', () => {
    expect(MDX).toContain('Первые две — ровно те, что отобрали после Spectre');
  });

  it('PITFALLS 01: пять рендереров — только у четырёх разных чужих сайтов', () => {
    expect(t.PITFALLS[0].d).toContain('с четырёх разных чужих сайтов — это пять рендереров');
  });

  it('числа под таблицей DOM_HEAP_ROWS сходятся с самой таблицей', () => {
    const mb = (s: string) => Number(s.replace(' МБ', ''));
    const [empty, full, cleared, again] = t.DOM_HEAP_ROWS;
    expect(Math.round((mb(full[2]) - mb(empty[2])) * 10) / 10).toBe(0.1); // «сдвинули кучу V8 на 0.1 МБ»
    expect(mb(full[3]) - mb(empty[3])).toBe(178); // «процесс вырос на 178 МБ»
    expect(Math.round((mb(again[2]) - mb(cleared[2])) * 10) / 10).toBe(3.8); // «200 000 обёрток — 3.8 МБ»
    expect(Number(cleared[1]) - Number(empty[1])).toBe(3); // поддерево div > span > текст
    expect(MDX).toContain('на 0.1 МБ, а процесс вырос на 178 МБ');
  });
});
