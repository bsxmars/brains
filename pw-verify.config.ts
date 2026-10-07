import { defineConfig, devices } from '@playwright/test';

/**
 * ВРЕМЕННЫЙ конфиг проверки — удаляется сразу после прогона.
 *
 * Отличается от проектного ровно одним: здесь нет `globalSetup`. Проектный собирает сайт перед
 * тестами, а сборка сейчас падает на чужой теме `/platform/workers` (`WAIT_NOTE is not defined`),
 * из-за чего не запускается ни один тест. Проверки гоняются против уже собранного `dist`,
 * который отдаёт поднятый сервер предпросмотра на 4329.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['json']],
  use: { baseURL: 'http://localhost:4329' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
