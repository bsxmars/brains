import type {
  Apis,
  BufApi,
  Codes,
  Counted,
  DemoCase,
  DemoState,
  GapBuf,
  Kind,
  PieceBuf,
  RopeBuf,
  RopeRow,
  RopeTree,
  ScaleCell,
  ScaleResult,
  Scenario,
} from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `STRING_CODE`, `GAP_CODE`, `ROPE_CODE`
 * и `PIECE_CODE` из темы «Как редактор хранит текст».
 *
 * Строки напечатаны на странице, собраны здесь `new Function` и прогоняются
 * `tests/unit/text-buffers.test.ts`: тексты и начала строк — против строковой модели
 * и `split('\n')` на тысячах случайных правок, счётчики — против утверждений текста.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
const NAMES = 'create, insert, remove, text, lineStart';

export function loadBuf<T>(code: string, extra = ''): T {
  return new Function(`${code}\nreturn { ${NAMES}${extra} };`)() as T;
}

export function loadAll(codes: Codes): Apis {
  return {
    string: loadBuf(codes.string),
    gap: loadBuf(codes.gap),
    rope: loadBuf(codes.rope),
    piece: loadBuf(codes.piece, ', snapshot, restore'),
  };
}

export const KINDS: Kind[] = ['string', 'gap', 'rope', 'piece'];

/** ГПСЧ Лемера: случайные правки повторяются от запуска к запуску. */
export function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

/** Документ ровно из n символов: строки по ~40 символов. */
export function makeDoc(n: number): string {
  let s = '';
  for (let i = 0; s.length < n; i++) s += `строка ${i} — немного текста для примера\n`;
  return s.slice(0, n);
}

/** Начала строк по `split('\n')` — эталон для `lineStart`. */
export function lineStarts(text: string): number[] {
  const out = [0];
  for (const line of text.split('\n').slice(0, -1)) out.push(out[out.length - 1] + line.length + 1);
  return out;
}

// ─── Сквозной пример ───────────────────────────────────────────────────────────────────────

function ropeRows(n: RopeTree, depth = 0, out: RopeRow[] = []): RopeRow[] {
  if (n.h === 0 && 's' in n) out.push({ depth, leaf: true, s: n.s, len: n.len, lines: n.lines });
  else if ('left' in n) {
    out.push({ depth, leaf: false, s: '', len: n.len, lines: n.lines });
    ropeRows(n.left, depth + 1, out);
    ropeRows(n.right, depth + 1, out);
  }
  return out;
}

/** Сыграть сквозной пример на всех четырёх буферах; нулевое состояние — до правок. */
export function playDemo(apis: Apis, demo: DemoCase): DemoState[] {
  const bufs = {
    string: apis.string.create(demo.base),
    gap: apis.gap.create(demo.base, demo.gap),
    rope: apis.rope.create(demo.base, demo.leaf),
    piece: apis.piece.create(demo.base),
  };
  const snap = (step: DemoState['step'], found: number | null, cost: Record<Kind, Counted>): DemoState => {
    const g = bufs.gap;
    const p = bufs.piece;
    return {
      step,
      text: apis.string.text(bufs.string),
      found,
      cost,
      gap: { cells: Array.from(g.a, (c, i) => (i >= g.start && i < g.end ? null : (c ?? null))), start: g.start, end: g.end },
      rope: ropeRows(bufs.rope.root),
      piece: {
        orig: p.orig,
        add: p.add,
        pieces: p.pieces.map((x) => ({ ...x, text: p[x.buf].slice(x.start, x.start + x.len) })),
      },
    };
  };
  const zero = () => ({ copied: 0, visited: 0 });
  const out = [snap(null, null, { string: zero(), gap: zero(), rope: zero(), piece: zero() })];
  for (const step of demo.steps) {
    const before = Object.fromEntries(KINDS.map((k) => [k, { copied: bufs[k].copied, visited: bufs[k].visited }])) as Record<Kind, Counted>;
    let found: number | null = null;
    for (const k of KINDS) {
      const api = apis[k] as BufApi;
      const b = bufs[k] as Counted;
      if (step.op === 'ins') api.insert(b, step.pos, step.str);
      else if (step.op === 'del') api.remove(b, step.pos, step.len);
      else found = api.lineStart(b, step.line);
    }
    const cost = Object.fromEntries(
      KINDS.map((k) => [k, { copied: bufs[k].copied - before[k].copied, visited: bufs[k].visited - before[k].visited }]),
    ) as Record<Kind, Counted>;
    out.push(snap(step, found, cost));
  }
  return out;
}

/** Все четыре буфера после шага: тексты и (для `line`) найденные позиции. Для теста. */
export function playAll(apis: Apis, demo: DemoCase): { texts: string[]; found: (number | null)[] }[] {
  const bufs = KINDS.map((k) => (apis[k] as BufApi).create(demo.base, k === 'gap' ? demo.gap : k === 'rope' ? demo.leaf : undefined));
  return demo.steps.map((step) => {
    const found = KINDS.map((k, i) => {
      const api = apis[k] as BufApi;
      if (step.op === 'ins') api.insert(bufs[i], step.pos, step.str);
      else if (step.op === 'del') api.remove(bufs[i], step.pos, step.len);
      else return api.lineStart(bufs[i], step.line);
      return null;
    });
    return { texts: KINDS.map((k, i) => (apis[k] as BufApi).text(bufs[i])), found };
  });
}

// ─── В масштабе ────────────────────────────────────────────────────────────────────────────

export const OPS = 1000;
export const PASTE = 10000;

/**
 * Один сценарий на одном буфере. Документ — `makeDoc(n)`, случайность — Лемер с зерном 2026.
 *   — `type`: курсор в середине, 1000 символов подряд; первая вставка — отдельно;
 *   — `scatter`: 1000 правок по одному символу в случайных местах, вставка и удаление через раз;
 *   — `lines`: те же 1000 правок, потом 1000 поисков начала случайной строки;
 *   — `paste`: одна вставка 10 000 символов в середину.
 */
export function measure(api: BufApi, n: number, scen: Scenario, opt?: number): ScaleCell {
  const b = api.create(makeDoc(n), opt);
  const r = rng(2026);
  const ri = (k: number) => Math.floor(r() * k);
  let len = n;
  const edits = () => {
    for (let i = 0; i < OPS; i++) {
      if (i % 2) {
        api.remove(b, ri(len), 1);
        len--;
      } else {
        api.insert(b, ri(len + 1), 'ж');
        len++;
      }
    }
  };
  const res: ScaleCell = { copied: 0, visited: 0 };
  if (scen === 'type') {
    const at = n >> 1;
    api.insert(b, at, 'ж');
    res.first = b.copied;
    b.copied = b.visited = 0;
    for (let i = 1; i < OPS; i++) api.insert(b, at + i, 'ж');
    res.copied = b.copied / (OPS - 1);
    res.visited = b.visited / (OPS - 1);
  } else if (scen === 'scatter') {
    edits();
    res.copied = b.copied / OPS;
    res.visited = b.visited / OPS;
  } else if (scen === 'lines') {
    edits();
    b.copied = b.visited = 0;
    const lines = api.text(b).split('\n').length;
    for (let i = 0; i < OPS; i++) api.lineStart(b, ri(lines));
    res.copied = b.copied / OPS;
    res.visited = b.visited / OPS;
  } else {
    api.insert(b, n >> 1, makeDoc(PASTE));
    res.copied = b.copied;
    res.visited = b.visited;
  }
  const any = b as Partial<PieceBuf & RopeBuf & GapBuf>;
  if (any.pieces) res.pieces = any.pieces.length;
  if (any.root) res.h = any.root.h;
  const round = (x: number) => Math.round(x * 10) / 10;
  res.copied = round(res.copied);
  res.visited = round(res.visited);
  return res;
}

export function measureAll(apis: Apis, n: number, scen: Scenario): ScaleResult {
  return Object.fromEntries(KINDS.map((k) => [k, measure(apis[k] as BufApi, n, scen)])) as ScaleResult;
}
