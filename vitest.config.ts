import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Тяжёлые файлы: Chromium, настоящий Postgres в PGlite, дочерние процессы, сеть, замеры времени
 * и памяти. Список снят замером полного прогона (2026-11-05, официальный Node 26.8.2): каждый
 * идёт от 3 с, вместе — 85% времени набора. Плюс `node-memory` и `cost-invariants` — они короткие,
 * но сверяют замеры и мигают, когда процессор занят соседями.
 *
 * Новый тест, который запускает браузер, процесс или меряет время, — сюда.
 */
const HEAVY = [
  'canvas', 'cdn-cache', 'continuous-profiling', 'cost-invariants', 'csp', 'db-migrations',
  'deflate', 'errors', 'fuzzy-search', 'git-internals', 'http2-http3', 'images', 'indexes',
  'memory-gc', 'message-channel', 'node-event-loop', 'node-memory', 'numbers', 'observers',
  'package-publishing', 'rate-limiting', 'realtime', 'regex', 'responsive', 'router',
  'schedulers', 'scrolling', 'spatial-index', 'ssr-hydration', 'supply-chain', 'suspense-errors',
  'svelte-runes', 'text-input', 'tls-certificates', 'transactions', 'undo-redo', 'unicode-intl',
  'uploads', 'v8-engine', 'v8-strings',
].map((name) => `tests/unit/${name}.test.ts`);

/**
 * ⚠️ Переименованный файл из списка выпал бы из обоих проектов молча: из лёгкого он исключён,
 * а в тяжёлом его больше нет. Поэтому несуществующее имя — ошибка конфига, а не пропуск.
 */
const missing = HEAVY.filter((file) => !existsSync(file));
if (missing.length) throw new Error(`vitest.config.ts: в HEAVY нет таких файлов: ${missing.join(', ')}`);

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  resolve: { alias },
  test: {
    /**
     * Два проекта, и идут они по очереди (`groupOrder`), а не вместе.
     *
     * Раньше все файлы шли в два воркера вперемешку: два тяжёлых соседа разом грели ноутбук,
     * а лёгкие тесты рядом с ними падали по таймауту. Теперь лёгкие идут первыми в два потока,
     * а тяжёлые — после них и строго по одному. Полный прогон дольше на пару минут, зато
     * машина не забита, а замерные проверки идут в тишине.
     *
     * Отдельно: `npm run test:fast` (только лёгкие) и `npm run test:heavy`.
     */
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          exclude: HEAVY,
          environment: 'node',
          /** 20 с вместо 5: у медленных тестов свои таймауты рядом с кодом, это запас на занятый процессор. */
          testTimeout: 20_000,
          /** Не по воркеру на ядро — полный прогон грел ноутбук. */
          maxWorkers: 2,
          sequence: { groupOrder: 0 },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'heavy',
          include: HEAVY,
          environment: 'node',
          testTimeout: 20_000,
          /** Один файл за раз: каждый из них сам поднимает браузер, базу или процессы. */
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
