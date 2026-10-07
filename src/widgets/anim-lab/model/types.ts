/** Одна анимация: кто её ведёт и что она меняет — `{ свойство: [from, to] }`. */
export interface AnimSpec {
  by: 'css' | 'waapi' | 'raf';
  keyframes: Record<string, [string, string]>;
}

/** Ответ `planAnimation` из `FRAME_PLAN_CODE`: что одна анимация требует на каждый кадр. */
export interface AnimPlan {
  props: string[];
  thread: 'compositor' | 'main';
  /** Что не пустило анимацию на композитор: свойства или `requestAnimationFrame`. */
  blockers: string[];
  style: boolean;
  layout: boolean;
  paint: boolean;
}

/** Ответ `framePlan`: план каждой анимации элемента и цена кадра за все сразу. */
export interface FramePlan {
  plans: AnimPlan[];
  style: boolean;
  layout: boolean;
  paint: boolean;
  composite: boolean;
}

/** Элемент для `ownLayer` из `LAYER_CODE`. */
export interface LayerEl {
  willChange?: string[];
  transform?: string;
  animations?: AnimSpec[];
  position?: string;
  /** Нарисован поверх элемента со своим слоем и перекрывает его. */
  overLayer?: boolean;
}

export interface LayerVerdict {
  layer: boolean;
  /** Идентификатор причины, как его называет `LayerTree.compositingReasons`; `null` — не назван. */
  reason: string | null;
}

export interface LayerCount {
  /** Слоёв всего, вместе с корневым слоем прокрутки. */
  count: number;
  reasons: Record<string, number>;
}

export interface AnimApi {
  framePlan(animations: AnimSpec[]): FramePlan;
  planAnimation(animation: AnimSpec): AnimPlan;
}

export interface LayerApi {
  ownLayer(el: LayerEl): LayerVerdict;
  countLayers(elements: LayerEl[]): LayerCount;
}

/** Что снял Chromium на одном сценарии за 1 с анимации (см. шапку `data.ts` темы). */
export interface StandFrame {
  layout: number;
  style: number;
  paint: number;
  commit: number;
  /** Битовая маска `compositeFailed` из трассировки; 0 — анимация ушла на композитор. */
  compositeFailed: number;
  unsupported: string[];
}

/** Сценарий демо «Кадр анимации». */
export interface AnimCase {
  id: string;
  label: string;
  /** Код, который читатель видит: CSS или JS. */
  code: string;
  animations: AnimSpec[];
  /** Литерал стенда: счётчики Chromium. */
  chromium: StandFrame;
  /** Двигался ли элемент, пока главный поток стоял в цикле (кадры скринкаста). */
  movedWhileBlocked: boolean;
  /** Подпись под сценарием. Строчная разметка. */
  note: string;
}

/** Сцена демо «Слои»: что на странице и сколько слоёв снял Chromium. */
export interface LayerScene {
  id: string;
  label: string;
  elements: LayerEl[];
  /** Литерал стенда: число слоёв с содержимым и причины. */
  chromium: { count: number; reasons: Record<string, number>; bytes: number };
  note: string;
}
