/** id символа: `[client, clock]`. */
export type CharId = [number, number];

/** Операция мини-CRDT из `SEQ_CODE`: вставка за соседом слева или удаление по id. */
export type SeqOp =
  | { type: 'ins'; id: CharId; origin: CharId | null; char: string }
  | { type: 'del'; id: CharId };

/** Элемент внутреннего списка: символ, его id и пометка-надгробие. */
export interface SeqItem {
  id: CharId;
  char: string;
  deleted: boolean;
}

export interface SeqDoc {
  client: number;
  clock: number;
  items: SeqItem[];
  pending: SeqOp[];
}

/** То, что возвращает строка `SEQ_CODE`, собранная `new Function`. */
export interface SeqApi {
  createDoc: (client: number) => SeqDoc;
  insert: (doc: SeqDoc, index: number, char: string) => SeqOp;
  remove: (doc: SeqDoc, index: number) => SeqOp;
  receive: (doc: SeqDoc, op: SeqOp) => void;
  text: (doc: SeqDoc) => string;
}

/** Наивная правка по индексу — `NAIVE_CODE`. */
export type NaiveOp = { type: 'ins'; index: number; char: string } | { type: 'del'; index: number };
export type NaiveApply = (s: string, op: NaiveOp) => string;

/** Правка участника в сценарии: вставить символ в позицию или удалить символ в позиции. */
export type Edit = ['ins', number, string] | ['del', number];

export interface Peer {
  name: string;
  client: number;
  edits: Edit[];
}

/**
 * Сценарий совместной правки. Текст `base` набирает первый участник и рассылает всем,
 * потом каждый правит свою копию, не видя чужих правок. `yjs` — итог Yjs на тех же правках
 * (снят стендом, сверяется тестом); `sameAsYjs` — совпадает ли с ним мини-реализация.
 */
export interface SeqScenario {
  id: string;
  label: string;
  base: string;
  peers: Peer[];
  yjs: string;
  sameAsYjs: boolean;
}

/** Операция сценария вместе с тем, чья она. */
export interface TaggedOp {
  peer: string;
  op: SeqOp;
  naive: NaiveOp;
}

/** Шаг доставки новому участнику: какая операция пришла и что применилось. */
export interface DeliveryStep {
  op: TaggedOp;
  /** Операции, которые применились на этом шаге (пришедшая и дождавшиеся её). */
  applied: TaggedOp[];
  /** Сколько операций ждёт после шага. */
  waiting: number;
  text: string;
}

export interface PeerResult {
  name: string;
  client: number;
  local: string;
  final: string;
  naive: string;
}

export interface Played {
  ops: TaggedOp[];
  peers: PeerResult[];
  steps: DeliveryStep[];
  items: SeqItem[];
}
