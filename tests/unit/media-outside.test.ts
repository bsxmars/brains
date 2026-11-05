import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as t from '@/content/lessons/media-outside/data';

/**
 * «Плеер вне вкладки» — то, что проверяется без браузера.
 *
 * Поведение браузера (окна, отказы, медиасессия, захват) проверяет `tests/e2e/media-outside.spec.ts`:
 * в Node этих API нет. Здесь — ссылки на другие темы и названия разделов, которые текст обещает.
 */

const ROOTS: Record<string, string> = { js: 'lessons', render: 'render', platform: 'platform' };
const text = JSON.stringify(t);

describe('ссылки', () => {
  const links = [...text.matchAll(/\]\(\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?\)/g)];
  const prereq = t.PREREQ.map((p) => /^\/([a-z]+)\/([a-z0-9-]+)\/(?:#(s\d+))?$/.exec(p.href)!);

  it('ссылки найдены', () => {
    expect(links.length).toBeGreaterThanOrEqual(8);
    expect(prereq.every(Boolean)).toBe(true);
  });

  it('каждая ведёт в существующую тему, а с якорем — в существующий раздел', () => {
    for (const [, dir, slug, anchor] of [...links, ...prereq]) {
      const file = new URL(`../../src/content/${ROOTS[dir]}/${slug}/index.mdx`, import.meta.url);
      expect(existsSync(file), `/${dir}/${slug}/`).toBe(true);
      if (anchor) expect(readFileSync(file, 'utf8'), `/${dir}/${slug}/#${anchor}`).toMatch(new RegExp(`id="${anchor}"`));
    }
  });

  it('название раздела в ссылке совпадает с заголовком раздела', () => {
    const named = [...text.matchAll(/\[[^\]]*раздел «([^»]+)»\]\(\/([a-z]+)\/([a-z0-9-]+)\/#(s\d+)\)/g)];
    expect(named.length).toBeGreaterThanOrEqual(3);
    for (const [, title, dir, slug, anchor] of named) {
      const mdx = readFileSync(new URL(`../../src/content/${ROOTS[dir]}/${slug}/index.mdx`, import.meta.url), 'utf8');
      const section = mdx.slice(mdx.indexOf(`id="${anchor}"`), mdx.indexOf(`id="${anchor}"`) + 300);
      expect(section, `/${dir}/${slug}/#${anchor}`).toContain(title);
    }
  });

  it('фоновая вкладка разобрана там, куда ведёт ссылка: звук отменяет сильное замедление', () => {
    const data = readFileSync(new URL('../../src/content/lessons/task-scheduling/data.ts', import.meta.url), 'utf8');
    expect(data).toContain('играла звук или использует WebRTC');
    expect(t.CLOSING).toContain('(/js/task-scheduling/#s4)');
  });

  it('о звонке и записи — только ссылки', () => {
    expect(text).not.toMatch(/RTCPeerConnection\(|new MediaRecorder/);
    expect(t.GDM_NEXT).toContain('(/js/media-voice/)');
    expect(t.GDM_NEXT).toContain('(/platform/webrtc/#s6)');
  });
});

describe('таблицы', () => {
  it('у каждой строки отказов есть ответ всех трёх движков', () => {
    for (const r of [...t.PIP_ERRORS, ...t.MS_POSITION]) {
      expect([r.chromium, r.firefox, r.webkit].every((v) => v.length > 0), r.k).toBe(true);
    }
  });

  it('действия из примера медиасессии знают все движки — поэтому вывод примера одна строка', () => {
    const used = [...t.MS_CODE.matchAll(/^\s+(\w+): /gm)].map((m) => m[1]).filter((k) => !['title', 'artist', 'album', 'artwork', 'duration', 'position', 'playbackRate'].includes(k));
    expect(used).toEqual(['play', 'pause', 'previoustrack', 'nexttrack', 'seekto']);
    for (const a of used) expect(t.MS_BASE_ACTIONS).toContain(a);
    expect(t.MS_OUT.split('\n')).toHaveLength(1);
  });

  it('тонкие места пронумерованы по порядку', () => {
    expect(t.PITFALLS.map((p) => p.n)).toEqual(t.PITFALLS.map((_, i) => String(i + 1).padStart(2, '0')));
  });
});
