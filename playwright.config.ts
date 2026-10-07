import { defineConfig, devices } from '@playwright/test';

const PORT = 4329;

/**
 * Браузерные проверки — то, чего не видят ни типы, ни vitest: у jsdom нет раскладки, поэтому
 * блок, вылезающий за экран, и цвет, приехавший не из палитры, проходят зелёными.
 *
 * Гоняется собранный сайт (`astro preview`), а не дев-сервер: в проде отдаётся именно он,
 * а дев-сервер собирает стили другим путём.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  /** Два браузера разом, а не по одному на ядро: полный прогон грел ноутбук (2026-10-06). */
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    /**
     * Второй движок — только для полосы навигации, и это не перестраховка.
     *
     * Настоящий баг: клик по пункту полосы не подтягивал к нему ленту, и **только в Gecko**.
     * Причина — порядок внутри кадра. Пересчёт висит на `requestAnimationFrame` после клика
     * по якорю: в Chromium и WebKit страница к этому кадру уже переместилась, в Firefox ещё
     * нет. Код, вычислявший цель по положению страницы, брал прежний пункт — и лента
     * оставалась там, где была. Замер в Firefox 155: `scrollLeft` 170 при максимуме 784;
     * в Chromium на том же месте 782 и пункт виден.
     *
     * То есть прогон в одном движке этот класс ошибок не видит в принципе. Но гонять все 320+
     * проверок дважды незачем: раскладка и палитра от движка не зависят, а зависит порядок
     * прокрутки. Поэтому в Firefox уходит один файл — `nav-follow.spec.ts`.
     *
     * ⚠️ Требует бинарь: `npx playwright install firefox`. Без него проект падает с «browser
     * executable doesn't exist», и это честно — сторож без второго движка бессмысленен.
     */
    {
      name: 'firefox-nav',
      testMatch: /nav-follow\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  /**
   * Сборка и сервер — в setup, а не в `webServer`: `astro preview` уходит в фон сам, и
   * Playwright принимает мгновенный выход запустившего процесса за упавший сервер.
   */
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
});
