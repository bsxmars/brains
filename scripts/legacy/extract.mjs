#!/usr/bin/env node
/**
 * Раскрывает standalone-бандлы Claude Design из `JS/`. Оригиналы не меняются.
 *
 * Бандл — это HTML-обёртка с тремя JSON-блоками:
 *   __bundler/manifest — uuid → { mime, compressed, data: base64 (gzip, если compressed) };
 *                        шрифты, React 18 UMD, react-dom и dc-runtime;
 *   __bundler/template — сама страница: `<x-dc>`-шаблон, стили инлайном, в конце
 *                        `<script type="text/x-dc">` с классом `DCLogic` урока.
 *
 * Что получается:
 *   legacy/extracted/<slug>/template.html  шаблон целиком — эталон разметки и текста;
 *   legacy/extracted/<slug>/logic.js       класс урока: данные демо и сценарии шагов;
 *   src/shared/styles/fonts/*.woff2        шрифты байт в байт — во всех бандлах одни и те же;
 *   src/shared/styles/fonts.css            те же @font-face с теми же unicode-range;
 *   tests/fixtures/palette.json            все цвета оригиналов — эталон для теста палитры.
 *
 * Запуск: `npm run legacy:extract`. Повторный запуск перезаписывает результат.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'JS');
const OUT = join(ROOT, 'legacy', 'extracted');
const STYLES = join(ROOT, 'src', 'shared', 'styles');
const FIXTURES = join(ROOT, 'tests', 'fixtures');

/** Имя оригинала → slug урока, в порядке курса. */
export const LESSONS = [
  ['Устройство браузера', 'browser-architecture'],
  ['Event Loop', 'event-loop'],
  ['Колбэки', 'callbacks'],
  ['Промис изнутри', 'promise-internals'],
  ['Планирование задач', 'task-scheduling'],
  ['MessageChannel', 'message-channel'],
  ['Движок V8', 'v8-engine'],
  ['Объектная модель JS', 'object-model'],
  ['Строки в V8', 'v8-strings'],
  ['Память и GC', 'memory-gc'],
  ['Профилирование памяти', 'memory-profiling'],
  ['Память Node в проде', 'node-memory'],
];

function block(html, type) {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`));
  if (!m) throw new Error(`нет блока __bundler/${type}`);
  return JSON.parse(m[1]);
}

function decode(entry) {
  const bytes = Buffer.from(entry.data, 'base64');
  return entry.compressed ? gunzipSync(bytes) : bytes;
}

const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const slugify = (s) => s.toLowerCase().replace(/['"]/g, '').replace(/\s+/g, '-');

/** `/* latin *\/ @font-face { … }` — комментарий с подмножеством стоит перед каждым правилом. */
const FACE = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
const prop = (body, name) => body.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();

function parseFonts(template) {
  return [...template.matchAll(FACE)].map(([, subset, body]) => {
    const family = prop(body, 'font-family').replace(/'/g, '');
    const style = prop(body, 'font-style');
    const weight = prop(body, 'font-weight');
    return {
      subset,
      family,
      style,
      weight,
      range: prop(body, 'unicode-range'),
      uuid: body.match(/url\("([^"]+)"\)/)[1],
      file: `${slugify(family)}-${style}-${weight.replace(/\s+/g, '-')}-${subset}.woff2`,
    };
  });
}

/**
 * Цвета — из всего шаблона, включая логику: половина стилей оригинала собирается строками
 * в `renderVals()`. `(?<![&\w])` отсекает HTML-сущности вроде `&#8212;`.
 */
const HEX = /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g;
const RGB = /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/g;

function normColor(c) {
  if (c.startsWith('rgb')) return c.replace(/\s+/g, '');
  const h = c.slice(1).toUpperCase();
  return `#${h.length === 3 ? [...h].map((x) => x + x).join('') : h}`;
}

const palette = new Map(); // цвет → { count, lessons:Set }
let fontsRef = null; // эталонный набор шрифтов из первого бандла
const report = [];

for (const [name, slug] of LESSONS) {
  const html = readFileSync(join(SRC, `${name} - standalone.html`), 'utf8');
  const manifest = block(html, 'manifest');
  const template = block(html, 'template');

  const logic = template.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!logic) throw new Error(`${name}: не найден <script type="text/x-dc">`);

  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'template.html'), template);
  writeFileSync(join(dir, 'logic.js'), `${logic.trim()}\n`);

  // Шрифты: берём из первого бандла, у остальных только сверяем md5.
  const fonts = parseFonts(template).map((f) => ({ ...f, md5: md5(decode(manifest[f.uuid])) }));
  if (!fontsRef) {
    fontsRef = fonts;
    mkdirSync(join(STYLES, 'fonts'), { recursive: true });
    for (const f of fonts) writeFileSync(join(STYLES, 'fonts', f.file), decode(manifest[f.uuid]));
  } else {
    const a = fontsRef.map((f) => `${f.file}:${f.md5}`).join();
    const b = fonts.map((f) => `${f.file}:${f.md5}`).join();
    if (a !== b) throw new Error(`${name}: набор шрифтов отличается от первого бандла`);
  }

  for (const c of [...(template.match(HEX) ?? []), ...(template.match(RGB) ?? [])]) {
    const key = normColor(c);
    const rec = palette.get(key) ?? { count: 0, lessons: new Set() };
    rec.count += 1;
    rec.lessons.add(slug);
    palette.set(key, rec);
  }

  const mangled = [...new Set(template.match(/sc-camel-(?!on-)[a-z-]+/g) ?? [])];
  report.push({ slug, template: template.length, logic: logic.length, mangled });
}

// fonts.css — те же правила, что в helmet оригинала, только url() смотрит на локальные файлы.
const css = [
  '/*',
  ' * Сгенерировано scripts/legacy/extract.mjs из бандлов JS/*.html — руками не править.',
  ' *',
  ' * Файлы шрифтов — байт в байт из оригиналов, правила — с теми же unicode-range.',
  ' * У Newsreader нет кириллического подмножества: русский текст рисуется фолбэком Georgia,',
  ' * ровно как в оригинале. Добавлять кириллический serif нельзя — это сменит вид уроков.',
  ' */',
  ...fontsRef.map((f) =>
    [
      `/* ${f.subset} */`,
      '@font-face {',
      `  font-family: '${f.family}';`,
      `  font-style: ${f.style};`,
      `  font-weight: ${f.weight};`,
      '  font-display: swap;',
      `  src: url('./fonts/${f.file}') format('woff2');`,
      `  unicode-range: ${f.range};`,
      '}',
    ].join('\n'),
  ),
].join('\n');
writeFileSync(join(STYLES, 'fonts.css'), `${css}\n`);

mkdirSync(FIXTURES, { recursive: true });
const colors = [...palette.entries()]
  .map(([value, r]) => ({ value, count: r.count, lessons: r.lessons.size }))
  .sort((a, b) => b.count - a.count);
writeFileSync(join(FIXTURES, 'palette.json'), `${JSON.stringify({ colors }, null, 2)}\n`);

console.log(`шрифтов: ${fontsRef.length}, цветов: ${colors.length}`);
for (const r of report) {
  console.log(
    `${r.slug.padEnd(22)} шаблон ${String(r.template).padStart(6)}  логика ${String(r.logic).padStart(6)}` +
      (r.mangled.length ? `  sc-camel: ${r.mangled.join(', ')}` : ''),
  );
}
