/**
 * Геометрия липкого элемента — вход `stickyOffset` из темы.
 * Все числа — в координатах содержимого контейнера прокрутки: 0 — верх содержимого.
 */
export interface StickyInput {
  /** Прокрутка контейнера и высота его видимой части (`clientHeight`). */
  scrollTop: number;
  portHeight: number;
  /** `padding` контейнера прокрутки: Chromium липнет к его краю, а не к краю рамки. */
  padTop: number;
  padBottom: number;
  /** `top` и `bottom` из CSS; `null` — `auto`. */
  top: number | null;
  bottom: number | null;
  /** Где элемент стоял бы в потоке, и его высота. */
  elTop: number;
  elHeight: number;
  marginTop: number;
  marginBottom: number;
  /** Контентный бокс родителя — блока-контейнера. */
  cbTop: number;
  cbBottom: number;
}

/** Сдвиг липкого элемента от его места в потоке, px. */
export type StickyFn = (s: StickyInput) => number;

/** Узел снимка: элемент или текст, `top`/`bottom` — в координатах содержимого прокрутки. */
export interface AnchorNode {
  id: string;
  top: number;
  bottom: number;
  /** Причина исключения из выбора якоря; `null` — кандидат. */
  skip: string | null;
  kids: AnchorNode[];
  /** Текстовый узел — у него нет своего `id`, подпись взята у родителя. */
  text?: boolean;
}

/** Снимок контейнера прокрутки — вход `selectAnchor`. */
export interface ScrollSnapshot {
  scrollTop: number;
  /** `clientHeight` — видимая часть без полосы прокрутки. */
  height: number;
  /** `scroll-padding-top` и `scroll-padding-bottom`, px. */
  paddingTop: number;
  paddingBottom: number;
  overflowAnchor: string;
  kids: AnchorNode[];
}

/** Журнал выбора: узел и вердикт, в порядке обхода. */
export type AnchorLog = [string, string][];

export type AnchorFn = (sc: ScrollSnapshot, log?: AnchorLog) => AnchorNode | null;

/** День ленты в демо: липкая шапка и сообщения под ней. */
export interface FeedGroup {
  id: string;
  day: string;
  msgs: string[];
}
