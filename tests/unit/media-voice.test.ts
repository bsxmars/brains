import { existsSync, readFileSync } from 'node:fs';
import { getEventListeners } from 'node:events';
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

describe('очистка записи тем же исходником', () => {
  const capture = (navigator: unknown, Recorder: unknown) => new Function('navigator', 'MediaRecorder',
    t.RECORD_CODE.split('\n\nconst { blob, parts }')[0] + '\nreturn recordClip;')(navigator, Recorder) as (ms?: number) => Promise<{ blob: Blob; parts: number }>;

  it('ошибка конструктора MediaRecorder не оставляет дорожку живой', async () => {
    let stopped = 0;
    const stream = { getTracks: () => [{ stop: () => stopped++ }] };
    const why = new Error('не удалось создать запись');
    class Recorder { constructor() { throw why; } }
    await expect(capture({ mediaDevices: { getUserMedia: async () => stream } }, Recorder)()).rejects.toBe(why);
    expect(stopped).toBe(1);
  });

  it('последний dataavailable учитывается перед stop', async () => {
    let stopped = 0;
    const stream = { getTracks: () => [{ stop: () => stopped++ }] };
    class Recorder {
      state = 'inactive'; mimeType = 'audio/webm';
      ondataavailable!: (e: { data: Blob }) => void; onstop!: () => void;
      start() { this.state = 'recording'; this.ondataavailable({ data: new Blob(['a'], { type: this.mimeType }) }); }
      stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['b'], { type: this.mimeType }) }); this.onstop(); }
    }
    const result = await capture({ mediaDevices: { getUserMedia: async () => stream } }, Recorder)(0);
    expect(await result.blob.text()).toBe('ab');
    expect(result.parts).toBe(2);
    expect(stopped).toBe(1);
  });
});

describe('ожидание голосов и локальный режим', () => {
  it('voicesReady ограничивает ожидание пустого списка и снимает подписку', async () => {
    const synth = Object.assign(new EventTarget(), { getVoices: () => [] });
    const ready = new Function('speechSynthesis', t.SPEAK_CODE.split("\ndocument.querySelector")[0] + '\nreturn voicesReady;')(synth);
    await expect(ready(0)).resolves.toEqual([]);
    expect(getEventListeners(synth, 'voiceschanged')).toHaveLength(0);
  });

  it('локальное распознавание не создаётся до успешной установки', async () => {
    let installed = false, instances = 0;
    class Recognition {
      lang = ''; processLocally = false;
      constructor() { instances++; }
      static async available() { return installed ? 'available' : 'downloadable'; }
      static async install() { return false; }
    }
    Object.defineProperty(Recognition.prototype, 'processLocally', { value: false, writable: true });
    const local = () => new Function('window', `${t.LOCAL_CODE}\nreturn localRecognition;`)({ SpeechRecognition: Recognition });
    await expect(local()()).rejects.toThrow('не установлен');
    expect(instances).toBe(0);
    Recognition.install = async () => { installed = true; return true; };
    await expect(local()()).resolves.toMatchObject({ lang: 'ru-RU', processLocally: true });
    expect(instances).toBe(1);
  });
});

describe('отправка всех кусков до done', () => {
  class Recorder extends EventTarget {
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
    part(text: string) { this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([text], { type: 'audio/webm' }) })); }
  }
  const uploader = (fetchImpl: unknown) => new Function('fetch', `${t.UPLOAD_CODE}\nreturn uploadRecording;`)(fetchImpl) as (r: Recorder, id: string) => Promise<number>;
  const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('done ждёт подтверждения каждого PUT, затем снимаются обработчики', async () => {
    const calls: { url: string; resolve: (r: unknown) => void }[] = [];
    const send = (url: string) => new Promise((resolve) => calls.push({ url, resolve }));
    const rec = new Recorder();
    const done = uploader(send)(rec, 'session');
    rec.part('a'); rec.part('b'); rec.stop();
    await turn();
    expect(calls.map((c) => c.url)).toEqual(['/voice/session/0']);
    calls[0].resolve({ ok: true });
    await turn();
    expect(calls.map((c) => c.url)).toEqual(['/voice/session/0', '/voice/session/1']);
    calls[1].resolve({ ok: true });
    await turn();
    expect(calls[2].url).toBe('/voice/session/done?count=2');
    calls[2].resolve({ ok: true });
    await expect(done).resolves.toBe(2);
    expect(getEventListeners(rec, 'dataavailable')).toHaveLength(0);
    expect(getEventListeners(rec, 'stop')).toHaveLength(0);
  });

  it('ошибка записи не запускает оставшиеся PUT после ответа на текущий', async () => {
    const calls: string[] = [];
    let acknowledge!: (value: unknown) => void;
    const rec = new Recorder();
    const done = uploader((url: string) => {
      calls.push(url);
      return new Promise((resolve) => { acknowledge = resolve; });
    })(rec, 'session');
    const rejected = expect(done).rejects.toThrow('ошибка записи');
    rec.part('a'); rec.part('b');
    await turn();
    rec.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ошибка записи') }));
    await rejected;
    acknowledge({ ok: true });
    await turn();
    expect(calls).toEqual(['/voice/session/0']);
  });

  it('HTTP-ошибка останавливает запись и не посылает done', async () => {
    const calls: string[] = [];
    const rec = new Recorder();
    const done = uploader(async (url: string) => { calls.push(url); return { ok: false, status: 500 }; })(rec, 'session');
    const rejected = expect(done).rejects.toThrow('HTTP 500');
    rec.part('a');
    await rejected;
    expect(rec.state).toBe('inactive');
    expect(calls).toEqual(['/voice/session/0']);
  });
});

describe('обработчики распознавания без живой речи', () => {
  it('обрабатываются все изменившиеся результаты, кнопка освобождается на end', () => {
    type Result = { transcript: string }[] & { isFinal: boolean };
    const created: Recognition[] = [];
    class Recognition {
      onresult!: (e: { resultIndex: number; results: Result[] }) => void;
      onend!: () => void;
      starts = 0;
      constructor() { created.push(this); }
      start() { this.starts++; }
    }
    const button = { disabled: false, onclick: null as null | (() => void) };
    const out: string[] = [];
    new Function('window', 'document', 'console', t.RECOGNIZE_CODE)(
      { SpeechRecognition: Recognition }, { querySelector: () => button },
      { log: (...args: unknown[]) => out.push(args.join(' ')) },
    );
    const current = created[0];
    button.onclick!();
    expect(button.disabled).toBe(true);
    expect(current.starts).toBe(1);
    current.onresult({ resultIndex: 0, results: [
      Object.assign([{ transcript: 'первая' }], { isFinal: true }),
      Object.assign([{ transcript: 'вторая' }], { isFinal: false }),
    ] });
    expect(out).toEqual(['итог: первая', 'черновик: вторая']);
    current.onend();
    expect(button.disabled).toBe(false);
  });
});

describe('необязательная проверка разрешения', () => {
  it('ошибка permissions.query не блокирует getUserMedia и очистку', async () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
    let stopped = 0;
    const track = { label: 'тест', stop: () => stopped++ };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    const out: string[] = [];
    await new AsyncFunction('navigator', 'console', t.PERMISSION_CODE)(
      { permissions: { query: async () => { throw new TypeError('имя не поддерживается'); } }, mediaDevices: { getUserMedia: async () => stream } },
      { log: (...args: unknown[]) => out.push(args.join(' ')) },
    );
    expect(out).toEqual(['проверка разрешения недоступна', 'микрофон: тест']);
    expect(stopped).toBe(1);
  });
});
