import type { DeliveryStep, NaiveApply, NaiveOp, Played, SeqApi, SeqOp, SeqScenario, TaggedOp } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `SEQ_CODE` и `NAIVE_CODE` из темы
 * «CRDT».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/crdt.test.ts`: сходимость — на всех перестановках доставки, итог — против
 * настоящего Yjs на тех же правках. Копии нет: разойдётся показанный код с проверкой —
 * покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadSeq(code: string): SeqApi {
  return new Function(`${code}\nreturn { createDoc, insert, remove, receive, text };`)() as SeqApi;
}

export function loadNaive(code: string): NaiveApply {
  return new Function(`${code}\nreturn applyNaive;`)() as NaiveApply;
}

export interface Prepared {
  /** Операции, которыми первый участник набрал общий текст `base`. */
  baseOps: SeqOp[];
  /** Правки участников по порядку: сначала все правки первого, потом второго… */
  ops: TaggedOp[];
  /** Текст каждого участника после своих правок, до чужих. */
  local: string[];
}

/** Набрать общий текст, разослать его и дать каждому участнику сделать свои правки. */
export function prepare(api: SeqApi, sc: SeqScenario): Prepared {
  const docs = sc.peers.map((p) => api.createDoc(p.client));
  const baseOps = [...sc.base].map((ch, i) => api.insert(docs[0], i, ch));
  for (const d of docs.slice(1)) for (const op of baseOps) api.receive(d, op);
  const ops: TaggedOp[] = [];
  sc.peers.forEach((p, n) => {
    for (const e of p.edits) {
      const naive: NaiveOp = e[0] === 'ins' ? { type: 'ins', index: e[1], char: e[2] } : { type: 'del', index: e[1] };
      const op = e[0] === 'ins' ? api.insert(docs[n], e[1], e[2]) : api.remove(docs[n], e[1]);
      ops.push({ peer: p.name, op, naive });
    }
  });
  return { baseOps, ops, local: docs.map((d) => api.text(d)) };
}

/** Новый участник получает общий текст, потом правки в порядке `order` (индексы в `ops`). */
export function deliver(api: SeqApi, prep: Prepared, order: number[], client = 99): string {
  const d = api.createDoc(client);
  for (const op of prep.baseOps) api.receive(d, op);
  for (const i of order) api.receive(d, prep.ops[i].op);
  return api.text(d);
}

/** Три порядка доставки для демо: как сделаны, задом наперёд и вразнобой (ГПСЧ Лемера). */
export type OrderKind = 'forward' | 'reverse' | 'shuffle';

export function makeOrder(n: number, kind: OrderKind, seed = 2026): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (kind === 'forward') return idx;
  if (kind === 'reverse') return idx.reverse();
  let s = seed;
  const r = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** Все перестановки 0…n−1 (для n ≤ 7 это не больше 5040). */
export function permutations(n: number): number[][] {
  const out: number[][] = [];
  const walk = (rest: number[], acc: number[]) => {
    if (!rest.length) out.push(acc);
    rest.forEach((x, i) => walk([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x]));
  };
  walk(Array.from({ length: n }, (_, i) => i), []);
  return out;
}

/** Итоги на всех порядках доставки: текст → сколько порядков к нему привели. */
export function allOrders(api: SeqApi, prep: Prepared): Map<string, number> {
  const res = new Map<string, number>();
  for (const p of permutations(prep.ops.length)) {
    const t = deliver(api, prep, p);
    res.set(t, (res.get(t) ?? 0) + 1);
  }
  return res;
}

/**
 * Сыграть сценарий в одном порядке доставки: что вышло у каждого участника (и что вышло бы
 * с наивными индексами), как правки приходили к новому участнику и какой у него итоговый
 * внутренний список — с надгробиями.
 */
export function play(api: SeqApi, naive: NaiveApply, sc: SeqScenario, order: number[]): Played {
  const prep = prepare(api, sc);
  const peers = sc.peers.map((p, n) => {
    const d = api.createDoc(p.client);
    for (const op of prep.baseOps) api.receive(d, op);
    let naiveText = sc.base;
    // Свои правки — сразу, по порядку; чужие — в порядке доставки.
    for (const t of prep.ops) if (t.peer === p.name) {
      api.receive(d, t.op);
      naiveText = naive(naiveText, t.naive);
    }
    for (const i of order) {
      const t = prep.ops[i];
      if (t.peer === p.name) continue;
      api.receive(d, t.op);
      naiveText = naive(naiveText, t.naive);
    }
    return { name: p.name, client: p.client, local: prep.local[n], final: api.text(d), naive: naiveText };
  });

  const d = api.createDoc(99);
  for (const op of prep.baseOps) api.receive(d, op);
  const steps: DeliveryStep[] = [];
  for (const i of order) {
    const t = prep.ops[i];
    const before = new Set<SeqOp>(d.pending);
    before.add(t.op);
    api.receive(d, t.op);
    const after = new Set<SeqOp>(d.pending);
    const applied = prep.ops.filter((x) => before.has(x.op) && !after.has(x.op));
    steps.push({ op: t, applied, waiting: d.pending.length, text: api.text(d) });
  }
  return { ops: prep.ops, peers, steps, items: d.items.map((it) => ({ ...it, id: [...it.id] as [number, number] })) };
}

/** Подпись операции: `+«!» A·4 за A·3` или `×«о» A·2`. Имена клиентов — буквы участников. */
export function opLabel(op: SeqOp, names: Map<number, string>, chars: Map<string, string>): string {
  const idOf = (id: [number, number]) => `${names.get(id[0]) ?? id[0]}·${id[1]}`;
  if (op.type === 'del') return `×«${chars.get(idOf(op.id)) ?? '?'}» ${idOf(op.id)}`;
  return `+«${op.char}» ${idOf(op.id)} ${op.origin ? `за ${idOf(op.origin)}` : 'в начало'}`;
}
