import { expect, test } from '@playwright/test';
import { PAGES } from './pages';
import { LESSON_VARS } from '../../src/shared/ui/theme';

/**
 * Ни одного цвета и ни одного шрифта мимо темы курса.
 *
 * Раньше эталоном был файл `tests/fixtures/palette.json` — 70 цветов, снятых машиной с исходных
 * бандлов: курс переносился «вид в вид», и проверка сторожила именно это. Затем автор сменил
 * схему (белая канва, насыщенные тона, тени вместо рамок), и сверять с бандлами стало бессмысленно.
 *
 * Поэтому эталон теперь — сам `shared/ui/theme.ts`. Правило, которое сторожит тест, не ослабло,
 * а стало точнее: **цвет появляется только через токен**. Новый оттенок в чужом компоненте
 * по-прежнему валит проверку, но смена палитры целиком — это правка одного файла, а не
 * переписывание фикстуры. Фикстура осталась при `scripts/legacy/extract.mjs`: она хранит палитру
 * оригиналов и нужна, когда надо свериться с тем, как урок выглядел изначально.
 *
 * Сюда же попадают будущие графики: новая диаграмма обязана обойтись цветами курса.
 */

/** `#EFEFEC` → `rgb(239, 239, 236)`, `rgba(239,239,236,.92)` → `rgba(239, 239, 236, 0.92)`. */
function toComputed(value: string): string {
  if (value.startsWith('rgb')) {
    const parts = value.replace(/rgba?\(|\)/g, '').split(',').map((p) => p.trim());
    const [r, g, b, a] = parts;
    return a === undefined || Number(a) === 1
      ? `rgb(${r}, ${g}, ${b})`
      : `rgba(${r}, ${g}, ${b}, ${Number(a)})`;
  }
  const hex = value.slice(1);
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Токены темы — это не только цвет: там же шрифты, радиусы, тени и ступени шкалы. */
const isColor = (value: string) => /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/.test(value);

const ALLOWED_COLORS = new Set([
  ...Object.values(LESSON_VARS).filter(isColor).map(toComputed),
  'rgba(0, 0, 0, 0)', // прозрачное — отсутствие цвета, а не цвет
]);

/** Шрифты ровно те, что вшиты в оригиналы, плюс фолбэки из их же стека. */
const ALLOWED_FONTS = new Set(['IBM Plex Mono', 'Newsreader', 'Georgia', 'serif', 'monospace']);

for (const path of PAGES) {
  test(`палитра и шрифты: ${path}`, async ({ page }) => {
    await page.goto(path);
    // Остров линейки гидратируется по появлению на экране — дождёмся его стилей тоже.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const found = await page.evaluate(() => {
      const colors = new Map<string, string>();
      const fonts = new Map<string, string>();
      const seen = (map: Map<string, string>, value: string, where: string) => {
        if (value && !map.has(value)) map.set(value, where);
      };

      // Только то, что действительно рисуется: у `head`, `script` и соседей вычисленный цвет
      // есть, но он ничей — это унаследованный дефолт браузера, а не цвет на экране.
      const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT']);

      for (const el of [document.body, ...Array.from(document.body.querySelectorAll('*'))]) {
        if (SKIP.has(el.tagName)) continue;
        const cs = getComputedStyle(el);
        const where = `${el.tagName.toLowerCase()}.${el.className?.toString().slice(0, 40)}`;

        seen(colors, cs.color, where);
        seen(colors, cs.backgroundColor, where);
        for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
          const width = parseFloat(cs[`border${side}Width` as 'borderTopWidth']);
          if (width > 0) seen(colors, cs[`border${side}Color` as 'borderTopColor'], where);
        }
        if (el instanceof SVGElement) {
          if (cs.fill && cs.fill !== 'none') seen(colors, cs.fill, where);
          if (cs.stroke && cs.stroke !== 'none') seen(colors, cs.stroke, where);
        }

        const family = cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
        seen(fonts, family, where);
      }

      return {
        colors: Array.from(colors, ([value, where]) => ({ value, where })),
        fonts: Array.from(fonts, ([value, where]) => ({ value, where })),
      };
    });

    const strayColors = found.colors.filter((c) => !ALLOWED_COLORS.has(c.value));
    expect(strayColors, `цвет мимо theme.ts: ${JSON.stringify(strayColors)}`).toEqual([]);

    const strayFonts = found.fonts.filter((f) => !ALLOWED_FONTS.has(f.value));
    expect(strayFonts, `шрифт вне набора оригинала: ${JSON.stringify(strayFonts)}`).toEqual([]);
  });
}
