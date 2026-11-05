import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/media-voice/data';

/**
 * «Голос: запись с микрофона и речь» — то, что проверяется без браузера.
 *
 * Поведение браузера (запись, форматы, ошибки, синтез, распознавание, склейка кусков)
 * проверяет `tests/e2e/media-voice.spec.ts` — в Node этих API нет. Здесь — связки текста
 * с данными и ссылки на другие темы.
 */

const ROOTS: Record<string, string> = {
  js: 'lessons',
  render: 'render',
  frameworks: 'frameworks',
  tooling: 'tooling',
  platform: 'platform',
};

describe('таблица форматов', () => {
  it('собрана из тех же данных, что сверяет e2e: строка на тип плюс «по умолчанию»', () => {
    expect(t.FORMAT_ROWS.length).toBe(t.FORMAT_TYPES.length + 1);
    for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
      expect(t.FORMAT_SUPPORT[engine].length).toBe(t.FORMAT_TYPES.length);
    }
  });

  it('общий для трёх движков тип, названный в тексте, — действительно общий', () => {
    const common = t.FORMAT_TYPES.filter((_, i) => ['chromium', 'firefox', 'webkit'].every((e) => t.FORMAT_SUPPORT[e as 'chromium'][i]));
    expect(common).toEqual(['audio/webm;codecs=opus']);
    expect(t.FORMAT_NOTE).toContain('Общий для всех трёх — только `audio/webm;codecs=opus`');
  });

  it('вывод примера записи называет тип по умолчанию Chromium', () => {
    expect(t.RECORD_OUT).toContain(`тип: ${t.FORMAT_DEFAULT.chromium}`);
  });
});

describe('ссылки', () => {
  const text = JSON.stringify(t);
  const links = [...text.matchAll(/\]\(\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?\)/g)];

  it('ссылки найдены', () => {
    expect(links.length).toBeGreaterThanOrEqual(6);
  });

  it('ссылки с разделом ведут в существующий раздел', () => {
    for (const [, dir, slug, anchor] of links) {
      if (!anchor) continue;
      const file = new URL(`../../src/content/${ROOTS[dir]}/${slug}/index.mdx`, import.meta.url);
      expect(existsSync(file), `/${dir}/${slug}/`).toBe(true);
      expect(readFileSync(file, 'utf8'), `/${dir}/${slug}/#${anchor}`).toMatch(new RegExp(`id="${anchor}"`));
    }
  });

  it('о WebRTC — только ссылка: звонок разобран там', () => {
    expect(t.RELATED).toContain('(/platform/webrtc/)');
    expect(text).not.toMatch(/RTCPeerConnection/);
  });
});

describe('тонкие места', () => {
  it('у каждого пункта свой номер и текст', () => {
    expect(new Set(t.PITFALLS.map((p) => p.n)).size).toBe(t.PITFALLS.length);
    expect(t.PITFALLS.every((p) => p.t && p.d)).toBe(true);
  });
});
