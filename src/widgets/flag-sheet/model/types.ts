/**
 * Строка шпаргалки по флагам.
 *
 * Поле `owner` — не украшение: в оригинале урока `--max-memory-restart` стоял в одном ряду
 * с флагами Node, хотя это флаг PM2 (проверено: `node --max-memory-restart=300M` отвечает
 * `bad option`). Чей флаг — такая же часть факта, как то, что он делает.
 */
export interface FlagRow {
  flag: string;
  /** Чей флаг: Node, PM2, манифест Kubernetes. */
  owner: 'node' | 'pm2' | 'k8s';
  /** Что задаёт. */
  what: string;
  /** Что реально ограничивает. */
  limits: string;
  /** Чего не трогает — половина ошибок живёт здесь. */
  misses?: string;
  tone?: 'info' | 'ok' | 'warn' | 'err';
}
