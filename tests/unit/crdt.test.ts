import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import * as t from '@/content/algorithms/crdt/data';
import { allOrders, deliver, loadNaive, loadSeq, makeOrder, permutations, play, prepare } from '@/widgets/crdt-lab/model/run';
import type { Edit, SeqOp, SeqScenario } from '@/widgets/crdt-lab/model/types';

/**
 * Тема «CRDT: как два редактора сливают правки без сервера».
 *
 * Строки из темы (`SEQ_CODE`, `NAIVE_CODE`, `G_CODE`, `LWW_CODE`, `OR_CODE`, `VV_CODE`,
 * `YJS_CODE`) напечатаны на странице; `SEQ_CODE` и `NAIVE_CODE` исполняет демо через
 * `widgets/crdt-lab/model/run.ts`. Здесь: сходимость `SEQ_CODE` на всех порядках доставки,
 * сверка итогов с настоящим Yjs 13.6 (где правила порядка совпадают — текст в текст, где нет —
 * закреплена сама разница), свойства слияния простых CRDT и все числа стенда про Yjs.
 */

const seq = loadSeq(t.SEQ_CODE);
const naive = loadNaive(t.NAIVE_CODE);

/** ГПСЧ Лемера — тот же, что на стенде. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

function ydoc(client: number, gc = true): Y.Doc {
  const d = new Y.Doc({ gc });
  d.clientID = client;
  return d;
}
function syncAll(docs: Y.Doc[]) {
  for (const a of docs) for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
}
function applyEdit(text: Y.Text, e: Edit) {
  if (e[0] === 'ins') text.insert(e[1], e[2]);
  else text.delete(e[1], 1);
}
/** Сценарий на настоящем Yjs: тот же текст, те же правки, те же клиенты. */
function yjsPlay(sc: SeqScenario): string {
  const docs = sc.peers.map((p) => ydoc(p.client));
  if (sc.base) docs[0].getText('t').insert(0, sc.base);
  syncAll(docs);
  sc.peers.forEach((p, n) => p.edits.forEach((e) => applyEdit(docs[n].getText('t'), e)));
  syncAll(docs);
  const texts = docs.map((d) => d.getText('t').toString());
  expect(new Set(texts).size).toBe(1);
  return texts[0];
}

// ─── Наивные индексы ───────────────────────────────────────────────────────────────────────

describe('наивные индексы расходятся', () => {
  it('NAIVE_CASE и NAIVE_PRINT', () => {
    const { base, a, b } = t.NAIVE_CASE;
    expect(naive(base, a.op)).toBe(a.local);
    expect(naive(base, b.op)).toBe(b.local);
    expect(naive(a.local, b.op)).toBe(a.got);
    expect(naive(b.local, a.op)).toBe(b.got);
    expect(a.got).not.toBe(b.got);
    for (const s of [a.local, b.local, a.got, b.got]) expect(t.NAIVE_PRINT).toContain(s);
  });

  it('в демо «начало и конец» по индексам копии расходятся, а CRDT сходится к тому же, что Yjs', () => {
    const sc = t.SCENARIOS.find((s) => s.id === 'ends')!;
    const r = play(seq, naive, sc, makeOrder(2, 'forward'));
    expect(r.peers.map((p) => p.naive)).toEqual([t.NAIVE_CASE.a.got, t.NAIVE_CASE.b.got]);
    expect(r.peers.map((p) => p.final)).toEqual(['скоты', 'скоты']);
  });
});

// ─── Последовательность: сходимость и сверка с Yjs ──────────────────────────────────────────

describe('SEQ_CODE: сходимость', () => {
  for (const sc of t.SCENARIOS) {
    it(`«${sc.label}»: все порядки доставки дают один итог`, () => {
      const prep = prepare(seq, sc);
      const res = allOrders(seq, prep);
      expect(res.size).toBe(1);
      const total = [...res.values()].reduce((s, n) => s + n, 0);
      expect(total).toBe(permutations(prep.ops.length).length);
      // И у каждого участника, в каждом из трёх порядков демо, — то же самое.
      const only = [...res.keys()][0];
      for (const kind of ['forward', 'reverse', 'shuffle'] as const) {
        const r = play(seq, naive, sc, makeOrder(prep.ops.length, kind));
        for (const p of r.peers) expect(p.final).toBe(only);
        expect(r.steps.at(-1)?.text ?? sc.base).toBe(only);
        expect(r.steps.at(-1)?.waiting ?? 0).toBe(0);
      }
    });
  }

  it('правка, пришедшая раньше соседа слева, ждёт («трое», задом наперёд)', () => {
    const sc = t.SCENARIOS.find((s) => s.id === 'three')!;
    const r = play(seq, naive, sc, makeOrder(4, 'reverse'));
    expect(r.steps.some((s) => s.applied.length === 0)).toBe(true);
    expect(r.steps.some((s) => s.applied.length === 2)).toBe(true);
  });

  it('повтор правки ничего не меняет', () => {
    const sc = t.SCENARIOS.find((s) => s.id === 'three')!;
    const prep = prepare(seq, sc);
    expect(deliver(seq, prep, [0, 1, 2, 3, 3, 0, 2, 1])).toBe(deliver(seq, prep, [0, 1, 2, 3]));
  });

  it('свойство: случайные правки трёх участников сходятся при любом порядке', () => {
    const r = rng(11);
    for (let trial = 0; trial < 60; trial++) {
      const peers = [1, 2, 3].map((c, n) => {
        let len = 4;
        const edits: Edit[] = [];
        for (let k = 0; k < 2; k++) {
          if (len > 0 && r() < 0.3) {
            edits.push(['del', Math.floor(r() * len)]);
            len--;
          } else {
            edits.push(['ins', Math.floor(r() * (len + 1)), String.fromCharCode(65 + n * 5 + k)]);
            len++;
          }
        }
        return { name: String(c), client: c, edits };
      });
      const sc: SeqScenario = { id: 'r', label: 'r', base: 'абвг', peers, yjs: '', sameAsYjs: false };
      expect(allOrders(seq, prepare(seq, sc)).size).toBe(1);
    }
  });

  it('вставка между a и b после набора ab встаёт туда, куда поставлен курсор', () => {
    const d = seq.createDoc(1);
    seq.insert(d, 0, 'a');
    seq.insert(d, 1, 'b');
    const x = seq.insert(d, 1, 'x');
    expect(seq.text(d)).toBe('axb');
    // у x и b один сосед слева, но clock у x больше
    expect(x.type === 'ins' && x.origin).toEqual([1, 1]);
    expect(x.id).toEqual([1, 3]);
  });
});

describe('SEQ_CODE против Yjs', () => {
  for (const sc of t.SCENARIOS) {
    it(`«${sc.label}»: Yjs даёт ${sc.yjs}`, () => {
      expect(yjsPlay(sc)).toBe(sc.yjs);
      const mini = deliver(seq, prepare(seq, sc), makeOrder(prepare(seq, sc).ops.length, 'forward'));
      if (sc.sameAsYjs) expect(mini).toBe(sc.yjs);
      else {
        expect(mini).not.toBe(sc.yjs);
        expect(mini).toBe(t.SEQ_DIFFERS[sc.id as keyof typeof t.SEQ_DIFFERS]);
      }
    });
  }

  it('у Yjs три документа и 24 порядка доставки — один итог', () => {
    const docs = [ydoc(1), ydoc(2), ydoc(3)];
    docs[0].getText('t').insert(0, 'abc');
    syncAll(docs);
    const base = Y.encodeStateAsUpdate(docs[0]);
    const ups: Uint8Array[] = [];
    docs.forEach((d) => d.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && ups.push(u)));
    docs[0].getText('t').insert(1, 'X');
    docs[1].getText('t').insert(1, 'Y');
    docs[2].getText('t').delete(1, 1);
    docs[2].getText('t').insert(1, 'Z');
    expect(ups).toHaveLength(4);
    const res = new Set<string>();
    for (const p of permutations(4)) {
      const d = ydoc(50);
      Y.applyUpdate(d, base);
      for (const i of p) Y.applyUpdate(d, ups[i], 'remote');
      res.add(d.getText('t').toString());
    }
    expect([...res]).toEqual(['aXYZc']);
  });

  it('Yjs держит правку без предшественников в pendingStructs, повтор безвреден', () => {
    const a = ydoc(1);
    const ups: Uint8Array[] = [];
    a.on('update', (u: Uint8Array) => ups.push(u));
    a.getText('t').insert(0, 'ab');
    a.getText('t').insert(2, 'c');
    a.getText('t').delete(0, 1);
    const b = ydoc(2);
    Y.applyUpdate(b, ups[1]);
    expect(b.getText('t').toString()).toBe('');
    expect(b.store.pendingStructs).not.toBeNull();
    Y.applyUpdate(b, ups[2]);
    Y.applyUpdate(b, ups[0]);
    expect(b.getText('t').toString()).toBe('bc');
    expect(b.store.pendingStructs).toBeNull();
    Y.applyUpdate(b, ups[0]);
    Y.applyUpdate(b, ups[1]);
    expect(b.getText('t').toString()).toBe('bc');
  });

  it('RANDOM_MATCH: доля совпадений с Yjs на случайных правках (зерно 2026)', () => {
    const r = rng(2026);
    const ri = (n: number) => Math.floor(r() * n);
    function trial(peers: number, opsPer: number): boolean {
      const base = 'абвг';
      const docs = Array.from({ length: peers }, (_, p) => seq.createDoc(p + 1));
      const ys = Array.from({ length: peers }, (_, p) => ydoc(p + 1));
      const bops = [...base].map((ch, i) => seq.insert(docs[0], i, ch));
      docs.slice(1).forEach((d) => bops.forEach((o) => seq.receive(d, o)));
      ys[0].getText('t').insert(0, base);
      const bu = Y.encodeStateAsUpdate(ys[0]);
      ys.slice(1).forEach((y) => Y.applyUpdate(y, bu));
      const all: SeqOp[] = [];
      for (let p = 0; p < peers; p++) {
        for (let k = 0; k < opsPer; k++) {
          const d = docs[p];
          const yt = ys[p].getText('t');
          const len = seq.text(d).length;
          if (len > 0 && r() < 0.3) {
            const i = ri(len);
            all.push(seq.remove(d, i));
            yt.delete(i, 1);
          } else {
            const i = ri(len + 1);
            const c = String.fromCharCode(65 + p * 5 + k);
            all.push(seq.insert(d, i, c));
            yt.insert(i, c);
          }
        }
      }
      docs.forEach((d) => all.forEach((o) => seq.receive(d, o)));
      syncAll(ys);
      const txt = seq.text(docs[0]);
      expect(docs.every((d) => seq.text(d) === txt)).toBe(true);
      return txt === ys[0].getText('t').toString();
    }
    for (const row of t.RANDOM_MATCH) {
      let same = 0;
      for (let i = 0; i < 2000; i++) if (trial(row.peers, row.ops)) same++;
      expect(same, `${row.peers} участника × ${row.ops}`).toBe(row.same);
    }
    for (const n of ['1840', '1566', '1023']) expect(t.RANDOM_NOTE).toContain(n);
  }, 60_000);
});

// ─── Простые CRDT ──────────────────────────────────────────────────────────────────────────

type G = Record<string, number>;
type PN = { p: G; n: G };
type Lww = { value: unknown; time: number; client: number };
type Or = { adds: Record<string, string>; removed: Record<string, boolean> };
const g = new Function(`${t.G_CODE}\nreturn { gInc, gValue, gMerge, pnInc, pnDec, pnValue, pnMerge };`)() as {
  gInc: (c: G, client: string, n?: number) => G;
  gValue: (c: G) => number;
  gMerge: (a: G, b: G) => G;
  pnInc: (c: PN, client: string) => PN;
  pnDec: (c: PN, client: string) => PN;
  pnValue: (c: PN) => number;
  pnMerge: (a: PN, b: PN) => PN;
};
const lww = new Function(`${t.LWW_CODE}\nreturn { lwwSet, lwwMerge };`)() as {
  lwwSet: (v: unknown, time: number, client: number) => Lww;
  lwwMerge: (a: Lww, b: Lww) => Lww;
};
const or = new Function(`${t.OR_CODE}\nreturn { orEmpty, orAdd, orRemove, orMerge, orValue };`)() as {
  orEmpty: () => Or;
  orAdd: (s: Or, el: string, tag: string) => Or;
  orRemove: (s: Or, el: string) => Or;
  orMerge: (a: Or, b: Or) => Or;
  orValue: (s: Or) => string[];
};

function laws<S>(name: string, gen: () => S, merge: (a: S, b: S) => S) {
  it(`${name}: слияние коммутативно, ассоциативно, идемпотентно`, () => {
    for (let i = 0; i < 300; i++) {
      const a = gen();
      const b = gen();
      const c = gen();
      expect(merge(a, b)).toEqual(merge(b, a));
      expect(merge(merge(a, b), c)).toEqual(merge(a, merge(b, c)));
      expect(merge(a, a)).toEqual(a);
    }
  });
}

describe('простые CRDT', () => {
  const r = rng(5);
  const clients = ['А', 'Б', 'В'];
  const genG = () => {
    let c: G = {};
    for (let i = 0; i < 6; i++) c = g.gInc(c, clients[Math.floor(r() * 3)], 1 + Math.floor(r() * 3));
    return c;
  };
  laws('G-Counter', genG, g.gMerge);
  laws('PN-Counter', () => ({ p: genG(), n: genG() }), g.pnMerge);
  laws('LWW-Register', () => {
      // одна пара (time, client) — одна запись: значение из неё и выводится
      const time = Math.floor(r() * 4);
      const client = Math.floor(r() * 3);
      return lww.lwwSet(`${time}:${client}`, time, client);
    }, lww.lwwMerge);
  laws(
    'OR-Set',
    () => {
      let s = or.orEmpty();
      for (let i = 0; i < 5; i++) {
        const el = ['молоко', 'хлеб', 'сыр'][Math.floor(r() * 3)];
        // метка уникальна в мире, но одна и та же метка всегда означает один элемент
        if (r() < 0.6) s = or.orAdd(s, el, `${el}#${Math.floor(r() * 4)}`);
        else s = or.orRemove(s, el);
      }
      return s;
    },
    or.orMerge,
  );

  it('COUNTER_CASE: максимум теряет, сумма двоит, G-Counter нет', () => {
    const { a, b, sum, maxOnly, sumAgain } = t.COUNTER_CASE;
    const ca = g.gInc({}, 'А', a);
    const cb = g.gInc({}, 'Б', b);
    expect(Math.max(a, b)).toBe(maxOnly);
    // «сумма»: копия Бориса пришла ещё раз, потом ещё
    expect([a + b + b, a + b + b + b]).toEqual(sumAgain);
    for (const n of [maxOnly, sum, ...sumAgain]) expect(t.COUNTER_NOTE).toContain(String(n));
    const merged = g.gMerge(g.gMerge(ca, cb), cb);
    expect(g.gValue(merged)).toBe(sum);
    expect(g.pnValue(g.pnDec(g.pnInc({ p: {}, n: {} }, 'А'), 'Б'))).toBe(0);
  });

  it('LWW: ничья — побеждает больший client, как у Y.Map', () => {
    const w = lww.lwwMerge(lww.lwwSet('A', 1, 1), lww.lwwSet('B', 1, 2));
    expect(w.value).toBe('B');
    for (const [ca, cb, win] of [[1, 2, 'B'], [2, 1, 'A']] as const) {
      const a = ydoc(ca);
      const b = ydoc(cb);
      a.getMap('m').set('k', 'A');
      b.getMap('m').set('k', 'B');
      syncAll([a, b]);
      expect(a.getMap('m').get('k')).toBe(win);
      expect(b.getMap('m').get('k')).toBe(win);
    }
  });

  it('OR_CASE: удаление и повторное добавление — добавление побеждает', () => {
    const both = or.orAdd(or.orEmpty(), 'молоко', 'a1');
    const a = or.orRemove(both, 'молоко');
    const b = or.orAdd(both, 'молоко', 'b1');
    expect(or.orValue(a)).toEqual(t.OR_CASE.a);
    expect(or.orValue(b)).toEqual(t.OR_CASE.b);
    expect(or.orValue(or.orMerge(a, b))).toEqual(t.OR_CASE.merged);
    expect(or.orValue(or.orMerge(b, a))).toEqual(t.OR_CASE.merged);
  });
});

// ─── Векторные часы ─────────────────────────────────────────────────────────────────────────

describe('векторные часы', () => {
  const vv = new Function(`${t.VV_CODE}\nreturn { compare, missing };`)() as {
    compare: (a: Record<string, number>, b: Record<string, number>) => string;
    missing: (log: { client: number; clock: number }[], sv: Record<string, number>) => { client: number; clock: number }[];
  };
  it('VV_CASES', () => {
    for (const c of t.VV_CASES) expect(vv.compare(c.a, c.b)).toBe(c.r);
    expect(vv.compare({ 1: 2 }, { 1: 2 })).toBe('равны');
  });
  it('missing отдаёт ровно то, чего нет, — как encodeStateAsUpdate(doc, sv)', () => {
    const log = [
      { client: 1, clock: 0 },
      { client: 1, clock: 1 },
      { client: 1, clock: 2 },
      { client: 2, clock: 0 },
    ];
    expect(vv.missing(log, { 1: 2 })).toEqual([{ client: 1, clock: 2 }, { client: 2, clock: 0 }]);
    // Yjs: state vector — «сколько символов клиента видел»
    const a = ydoc(1);
    a.getText('t').insert(0, 'ab');
    a.getText('t').insert(2, 'c');
    expect([...Y.decodeStateVector(Y.encodeStateVector(a))]).toEqual([[1, 3]]);
  });
});

// ─── Yjs: пример и размеры ─────────────────────────────────────────────────────────────────

describe('Yjs', () => {
  it('YJS_CODE: тексты и байты', () => {
    const body = t.YJS_CODE.replace(/^\/\/ Y — .*\n/, '');
    const r = new Function('Y', `${body}\nreturn { a, b, full, svA, svB, toB, toA };`)(Y) as Record<string, Uint8Array> & { a: Y.Doc; b: Y.Doc };
    expect(r.a.getText('t').toString()).toBe('кот!?');
    expect(r.b.getText('t').toString()).toBe('кот!?');
    expect(t.YJS_CODE).toContain("// 'кот!?'");
    const s = t.YJS_SIZES;
    expect([r.full.length, r.svA.length, r.svB.length, r.toB.length, r.toA.length]).toEqual([s.full, s.svA, s.svB, s.toB, s.toA]);
    expect(Y.encodeStateAsUpdate(r.a).length).toBe(s.after);
    expect([...Y.decodeStateVector(r.svA)]).toEqual([[1, 4]]);
    expect([...Y.decodeStateVector(r.svB)]).toEqual([[2, 1], [1, 3]]);
    expect(Buffer.byteLength('кот')).toBe(6);
  });

  it('склейка: кот и ! в конец — одна структура длины 4', () => {
    const d = ydoc(1);
    d.getText('t').insert(0, 'кот');
    d.getText('t').insert(3, '!');
    const structs = d.store.clients.get(1)!;
    expect(structs).toHaveLength(1);
    expect(structs[0].length).toBe(4);
  });

  const TEXT = 'Совместный редактор хранит каждую букву отдельно. '.repeat(20);

  it('SIZES: полное состояние, разница, удаления', () => {
    const s = t.SIZES;
    expect(TEXT.length).toBe(s.textChars);
    expect(Buffer.byteLength(TEXT)).toBe(s.textBytes);
    for (const gc of [true, false]) {
      const a = ydoc(1, gc);
      const tx = a.getText('t');
      for (const ch of TEXT) tx.insert(tx.length, ch);
      const full = Y.encodeStateAsUpdate(a);
      expect(full.length).toBe(s.typedEnd);
      expect(a.store.clients.get(1)).toHaveLength(1);
      const b = ydoc(2, gc);
      Y.applyUpdate(b, full);
      const sv = Y.encodeStateVector(b);
      expect(sv.length).toBe(s.sv);
      // ещё один символ — и разница по state vector b
      tx.insert(tx.length, '!');
      expect(Y.encodeStateAsUpdate(a, sv).length).toBe(s.diffOne);
      // удалить всё (1001 символ)
      tx.delete(0, tx.length);
      expect(Y.encodeStateAsUpdate(a).length).toBe(gc ? s.deletedAllGc : s.deletedAllNoGc);
    }
    const bulk = ydoc(1);
    bulk.getText('t').insert(0, TEXT);
    expect(Y.encodeStateAsUpdate(bulk).length).toBe(s.bulk);
    const r = rng(2026);
    const rnd = ydoc(1);
    const rt = rnd.getText('t');
    for (const ch of TEXT) rt.insert(Math.floor(r() * (rt.length + 1)), ch);
    expect(Y.encodeStateAsUpdate(rnd).length).toBe(s.randomPos);
  });

  function churnY(gc: boolean) {
    const r = rng(7);
    const d = ydoc(1, gc);
    const tx = d.getText('t');
    for (let i = 0; i < t.CHURN.edits; i++) {
      if (tx.length > 50 && r() < 0.5) tx.delete(Math.floor(r() * tx.length), 1);
      else tx.insert(Math.floor(r() * (tx.length + 1)), 'x');
    }
    return d;
  }

  it('CHURN: надгробия у Yjs и у SEQ_CODE', () => {
    const c = t.CHURN;
    const d = churnY(true);
    const structs = d.store.clients.get(1)!;
    expect(d.getText('t').length).toBe(c.visible);
    expect(structs.length).toBe(c.yStructs);
    expect(structs.filter((x) => x.deleted).length).toBe(c.yDeleted);
    expect(Y.encodeStateAsUpdate(d).length).toBe(c.yBytesGc);
    expect(Y.encodeStateAsUpdate(churnY(false)).length).toBe(c.yBytesNoGc);

    const r = rng(7);
    const m = seq.createDoc(1);
    for (let i = 0; i < c.edits; i++) {
      const len = seq.text(m).length;
      if (len > 50 && r() < 0.5) seq.remove(m, Math.floor(r() * len));
      else seq.insert(m, Math.floor(r() * (len + 1)), 'x');
    }
    expect(seq.text(m).length).toBe(c.visible);
    expect(m.items.length).toBe(c.miniItems);
    expect(m.items.filter((x) => x.deleted).length).toBe(c.miniTombs);
    for (const n of ['62', '1031', '969']) expect(t.TOMB_NOTE).toContain(n);
  });

  it('разница по state vector несёт весь набор удалений', () => {
    const s = t.SIZES;
    const d = churnY(true);
    const peer = ydoc(2);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(d));
    const sv = Y.encodeStateVector(peer);
    let ev: Uint8Array | null = null;
    d.on('update', (u: Uint8Array) => (ev = u));
    d.getText('t').insert(0, '!');
    const diff = Y.encodeStateAsUpdate(d, sv);
    expect(diff.length).toBe(s.churnDiff);
    expect(ev!.length).toBe(s.churnEvent);
    const dec = Y.decodeUpdate(diff);
    expect(dec.structs).toHaveLength(1);
    expect([...dec.ds.clients.values()][0]).toHaveLength(s.churnDsRanges);
  });

  it('SIZE_ROWS печатает снятые числа', () => {
    const s = t.SIZES;
    const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/\s/g, ' ');
    const vals = t.SIZE_ROWS.map((r) => r.v);
    for (const n of [s.typedEnd, s.randomPos, s.sv, s.diffOne, s.deletedAllGc, s.deletedAllNoGc, t.CHURN.yBytesGc]) {
      expect(vals).toContain(fmt(n));
    }
  });

  it('один clientID на двоих: Yjs меняет свой и предупреждает', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = ydoc(1);
    const b = ydoc(1);
    a.getText('t').insert(0, 'кот');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const printed = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(printed).toContain('Changed the client-id because another client seems to be using it.');
    expect(b.clientID).not.toBe(1);
  });

  it('относительные позиции существуют под этими именами', () => {
    expect(typeof Y.createRelativePositionFromTypeIndex).toBe('function');
    expect(typeof Y.createAbsolutePositionFromRelativePosition).toBe('function');
  });
});
