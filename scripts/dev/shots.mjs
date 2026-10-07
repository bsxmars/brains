#!/usr/bin/env node
/**
 * Снимки для сверки глазами: новая страница рядом с оригинальным бандлом.
 *
 * Автотесты ловят палитру, шрифты и переполнение, но «отбивка на четыре пикселя больше»
 * не ловится ничем, кроме сравнения картинок. Скрипт поднимает `astro preview`, снимает
 * обе страницы одной шириной и кладёт PNG туда, куда скажут аргументом.
 *
 * Запуск: `node scripts/dev/shots.mjs <куда> [slug] [ширина]`
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [outDir = '/tmp', slug = 'promise-internals', width = '1280'] = process.argv.slice(2);
const PORT = 4331;

/** Имя оригинала для каждого slug — то же соответствие, что в extract.mjs. */
const LEGACY = {
  'promise-internals': 'Промис изнутри',
  'event-loop': 'Event Loop',
  callbacks: 'Колбэки',
};

// `astro preview` в Astro 7 умеет работать демоном: поднимаем его и гасим в finally.
execFileSync('npx', ['astro', 'preview', '--background', '--port', String(PORT)], {
  cwd: ROOT,
  stdio: 'ignore',
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* сервер ещё поднимается */
    }
    await wait(500);
  }
  throw new Error(`сервер не поднялся: ${url}`);
}

try {
  mkdirSync(outDir, { recursive: true });
  await waitForServer(`http://localhost:${PORT}/`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: 1200 } });

  await page.goto(`http://localhost:${PORT}/js/${slug}/`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `${slug}-new.png`), fullPage: true });

  const legacy = `file://${join(ROOT, 'JS', `${LEGACY[slug]} - standalone.html`)}`;
  await page.goto(legacy);
  // Бандл распаковывает себя в браузере: ждём, пока страница подменит документ.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(outDir, `${slug}-legacy.png`), fullPage: true });

  await browser.close();
  console.log(`готово: ${outDir}`);
} finally {
  try {
    execFileSync('npx', ['astro', 'preview', 'stop'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* сервер уже остановлен */
  }
}
