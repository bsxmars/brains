/** Группа битов внутри одного байта: сами биты и что они значат. */
export interface FrameBits {
  b: string;
  t: string;
}

/** Поле кадра: подпись, байты в hex, при необходимости — разбор по битам или по символам. */
export interface FrameField {
  k: string;
  bytes: string[];
  /** Подписи под каждым байтом (например, исходная буква под замаскированным байтом). */
  under?: string[];
  bits?: FrameBits[];
  d: string;
  tone: 'info' | 'warn' | 'ok' | 'none';
}

export interface FrameDiagramData {
  title: string;
  fields: FrameField[];
  server: string;
  caption: string;
}
