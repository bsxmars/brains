import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import * as t from '@/content/lessons/browser-architecture/data';
import { compareBoundaries } from '@/widgets/site-resolver/model/compare';
import { probeWait } from '@/widgets/thread-probe/model/env';
import { burn } from '@/widgets/thread-probe/model/work';
import { ORINOCO } from '@/content/lessons/memory-gc/data';

const MDX = readFileSync('src/content/lessons/browser-architecture/index.mdx', 'utf8');

describe('«Устройство браузера»: вычитка 2026-10-30', () => {
  it('ссылка на «Память и GC» называет карточку, которая там есть, и её раздел', () => {
    expect(ORINOCO.some((c) => c.k.startsWith('общий обход с DOM'))).toBe(true);
    expect(MDX).toContain('(/js/memory-gc/#s2), карточка «общий обход с DOM» в разделе «Путь объекта»');
    expect(MDX).not.toContain('карточка словаря «общая куча с DOM»');
  });

  it('measureUserAgentSpecificMemory не «отбирали после Spectre» — только первые две возможности', () => {
    expect(MDX).toContain('Первые две — ровно те, что отобрали после Spectre');
  });

  it('справочник сравнивает границы URL без назначения PID', () => {
    for (const entry of t.SITE_CASES) {
      const result = compareBoundaries(entry);
      expect(result.sameSite, entry.full).toBe(entry.same);
      expect(result.origin).toBe(new URL(entry.full).origin);
      expect(Object.keys(result)).toEqual(['origin', 'hostOrigin', 'sameSite', 'sameOrigin']);
    }
    expect(compareBoundaries(t.SITE_CASES[0]).sameOrigin).toBe(true);
    expect(compareBoundaries(t.SITE_CASES[1])).toMatchObject({ sameSite: true, sameOrigin: false });
  });

  it('порт меняет origin, но не подготовленный PSL site; стандартный порт нормализуется', () => {
    const entry = { ...t.SITE_CASES[0], full: 'https://app.shop.com:8443/status' };
    expect(compareBoundaries(entry)).toMatchObject({ sameSite: true, sameOrigin: false });
    expect(compareBoundaries({ ...entry, full: 'https://app.shop.com:443/status' }).sameOrigin).toBe(true);
    expect(compareBoundaries({ ...entry, full: 'http://app.shop.com/', site: 'http://shop.com' }))
      .toMatchObject({ sameSite: false, sameOrigin: false });
  });

  it('публикуется настоящая функция прибора, а не отдельная копия вычисления', () => {
    expect(t.THREAD_WORK_CODE).toBe(burn.toString());
    expect(new Function(`return (${t.THREAD_WORK_CODE})(0)`)()).toBe(0);
  });

  it('wait-проба использует допустимый буфер, в том числе через Wasm без глобального SAB', () => {
    // Node can block: the deliberately different expected value must return immediately.
    // A normal ArrayBuffer would throw TypeError and produce the wrong result.
    expect(probeWait().value).toBe("вернул 'not-equal'");
    vi.stubGlobal('SharedArrayBuffer', undefined);
    try {
      expect(probeWait().value).toBe("вернул 'not-equal'");
    } finally {
      vi.unstubAllGlobals();
    }
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


describe('углубление навигации и практической диагностики', () => {
  it('старые якоря сохранены, новые разделы имеют собственные semantic id', () => {
    for (const id of ['s0', 's1', 's2', 's3', 's4', 's5', 'navigation', 'practice']) {
      expect(MDX).toContain(`id="${id}"`);
      expect(MDX).toContain(`id: ${id},`);
    }
    expect(MDX.indexOf('id="navigation"')).toBeLessThan(MDX.indexOf('id="s3"'));
    expect(MDX.indexOf('id="practice"')).toBeLessThan(MDX.indexOf('id="s5"'));
  });
  it('схема описывает выбор renderer и старый документ, а не предсказанный PID', () => {
    const nodes = t.NAVIGATION_DIAGRAM.nodes;
    expect(nodes.find((node) => node.id === 'renderer')?.detail).toContain('не обещает новый PID');
    expect(nodes.find((node) => node.id === 'old')?.detail).toContain('204');
    expect(t.NAVIGATION_DIAGRAM.note).toContain('bfcache');
    expect(MDX).toContain('не первый показанный кадр');
    expect(MDX).toContain('Firefox и WebKit могут реализовать');
  });
  it('практический совет называет гипотезу, инструмент и границу вывода', () => {
    expect(t.DIAGNOSTIC_CASES).toHaveLength(4);
    const blocked = t.DIAGNOSTIC_CASES.find((item) => item.symptom.includes('не отвечает'))!;
    expect(blocked.instrument).toContain('Performance');
    expect(blocked.limit).toContain('ждать сеть, IPC');
    const frame = t.DIAGNOSTIC_CASES.find((item) => item.symptom.includes('iframe'))!;
    expect(frame.limit).toContain('postMessage');
    const memory = t.DIAGNOSTIC_CASES.find((item) => item.symptom.includes('RSS'))!;
    expect(memory.limit).toContain('не доказывает утечку');
    expect(memory.instrument).toContain('после GC');
    const shared = t.DIAGNOSTIC_CASES.find((item) => item.symptom.includes('другую'))!;
    expect(shared.limit).toContain('не доказывает общего агента');
  });
});
