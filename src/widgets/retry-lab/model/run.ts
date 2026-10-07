import type { Bin, HerdPreset, RetryAfterMode, RetryApi, RetryCode, SimResult, Strategy } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки темы «Ограничение частоты в API»
 * (`RETRY_AFTER_CODE`, `BACKOFF_CODE`, `POLICY_CODE`, `BREAKER_CODE`, `SIM_CODE`). Строки
 * напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/rate-limits.test.ts`: разбор `Retry-After` и решения «повторять ли» — против
 * undici `RetryAgent` на живом `node:http`, стратегии джиттера — на порте OCC-модели
 * из статьи AWS, симуляция — по литералам темы. Копий кода нет.
 *
 * Ни DOM, ни Vue, ни настоящих таймеров: всё время — виртуальное.
 */
export function loadRetry(code: RetryCode): RetryApi {
  return new Function(
    `${code.retryAfter}\n${code.backoff}\n${code.policy}\n${code.breaker}\n${code.sim}\n` +
      'return { parseRetryAfter, seeded, backoff, createRetryPolicy, createBreaker, simulate };',
  )() as RetryApi;
}

/** Прогон сценария демо: все клиенты стартуют в 0 — ровно в момент сбоя. */
export function runHerd(api: RetryApi, preset: HerdPreset, strategy: Strategy, retryAfter: RetryAfterMode, seed: number): SimResult {
  return api.simulate({
    starts: Array.from({ length: preset.clients }, () => 0),
    downUntil: preset.downUntil,
    rate: preset.rate,
    latency: preset.latency,
    policy: { base: preset.base, cap: preset.cap, maxRetries: preset.maxRetries, strategy, retryAfter, seed },
  });
}

/** Журнал сервера по столбикам ширины `bin`: сколько ответов 200, 429 и 503 в каждом. */
export function binLog(log: SimResult['log'], bin: number): Bin[] {
  const end = log.reduce((m, [t]) => Math.max(m, t), 0);
  const bins: Bin[] = Array.from({ length: Math.floor(end / bin) + 1 }, () => ({ ok: 0, s429: 0, s503: 0 }));
  for (const [t, status] of log) {
    const b = bins[Math.floor(t / bin)];
    if (status === 200) b.ok++;
    else if (status === 429) b.s429++;
    else b.s503++;
  }
  return bins;
}
