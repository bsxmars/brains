import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    /**
     * 20 с вместо стандартных 5 (2026-10-01). Не ради медленных тестов — у тех свои таймауты
     * рядом с кодом. В наборе теперь есть тяжёлые соседи (настоящий Postgres в PGlite, Chromium,
     * запуск jest и vitest отдельными процессами), и в полном прогоне они отнимают процессор:
     * тесты, которые в одиночку идут доли секунды, падали по таймауту в случайных файлах.
     */
    testTimeout: 20_000,
    /**
     * Два воркера, а не по одному на ядро (2026-10-06). Полный прогон поднимал воркер на каждое
     * ядро, и вместе с соседями — Chromium, PGlite, дочерние jest и vitest — ноутбук грелся,
     * а лёгкие тесты падали по таймауту. Флаг `--no-file-parallelism` агенты забывали, поэтому
     * ограничение стоит здесь, а не в командной строке.
     */
    maxWorkers: 2,
  },
});
