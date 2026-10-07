/** Запись разобранного `Accept-Encoding`: имя кодировки в нижнем регистре и её вес. */
export interface AcceptEntry {
  coding: string;
  q: number;
}

/** Функции из строки `NEGOTIATE_CODE` темы «Сжатие в вебе». */
export interface NegotiateApi {
  parseAcceptEncoding(header: string): AcceptEntry[];
  weight(list: AcceptEntry[], coding: string): number;
  /** Кодировка для ответа, `'identity'` или `null`, если подходящего варианта нет. */
  negotiate(header: string | null, offers: string[]): string | null;
}

/** Готовый заголовок клиента: что шлёт браузер, Node или curl (снято стендом) либо пример из RFC. */
export interface AePreset {
  id: string;
  label: string;
  /** `null` — заголовка нет вовсе. */
  header: string | null;
  /** Откуда заголовок. Строчная разметка. */
  note: string;
}

/** Файл курса и его размеры в байтах: исходный и предсжатые варианты (снято стендом). */
export interface LabFile {
  id: string;
  label: string;
  type: string;
  raw: number;
  /** Размер после сжатия: brotli 11, zstd 19, gzip 9 — то, что кладут рядом при сборке. */
  sizes: Record<'br' | 'zstd' | 'gzip', number>;
}
