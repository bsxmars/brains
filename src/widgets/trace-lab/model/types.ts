/** Значение атрибута в том виде, в каком его отдаёт SDK на стенде: строка или число. */
export type AttrValue = string | number;

/** Событие внутри спана: `exception` с временем от начала запроса. */
export interface SpanEvent {
  name: string;
  /** Миллисекунды от начала запроса. */
  time: number;
  attributes: Record<string, AttrValue>;
}

/**
 * Спан, снятый стендом с `InMemorySpanExporter` и сведённый к полям, которые нужны теме.
 * `service` — `service.name` из ресурса, время — миллисекунды от начала запроса.
 */
export interface StandSpan {
  service: string;
  name: string;
  kind: 'CLIENT' | 'SERVER' | 'INTERNAL';
  traceId: string;
  spanId: string;
  /** `null` — корень трассы. */
  parentSpanId: string | null;
  start: number;
  end: number;
  status: 'UNSET' | 'OK' | 'ERROR';
  attributes: Record<string, AttrValue>;
  events: SpanEvent[];
}

/** Переход между сервисами: что пришло в заголовке `traceparent`. */
export interface Hop {
  from: string;
  to: string;
  traceparent: string;
}

/** Строка структурного лога стенда. */
export interface LogLine {
  ts: string;
  service: string;
  level: 'info' | 'error';
  msg: string;
  trace_id: string;
  span_id: string;
}

/** Сценарий стенда: один запрос web → api → stock. */
export interface TraceScenario {
  id: string;
  label: string;
  /** Подпись над демо. Строчная разметка. */
  note: string;
  traceId: string;
  /** Код ответа, который получил web. */
  status: number;
  hops: Hop[];
  /** В порядке, в каком их отдал экспортёр, — по времени окончания. */
  spans: StandSpan[];
  logs: LogLine[];
}

/** Узел дерева, как его строит `buildTree` из `TREE_CODE`. */
export type SpanNode = StandSpan & { children: SpanNode[] };

export interface WaterfallRow {
  span: SpanNode;
  depth: number;
  /** Родитель указан, но в списке его нет. */
  orphan: boolean;
}

export interface TreeApi {
  buildTree(spans: StandSpan[]): SpanNode[];
  waterfall(roots: SpanNode[]): WaterfallRow[];
}

export interface ParsedTraceparent {
  version: string;
  traceId: string;
  parentId: string;
  flags: number;
  sampled: boolean;
}

export interface TraceparentApi {
  parseTraceparent(header: string): ParsedTraceparent | null;
  formatTraceparent(ctx: { traceId: string; spanId: string; sampled: boolean }): string;
}

export interface StatsApi {
  percentile(values: number[], q: number): number;
  mean(values: number[]): number;
  bucketCounts(values: number[], bounds: number[]): number[];
  percentileFromBuckets(bounds: number[], counts: number[], q: number): number;
}

/** Набор задержек для демо перцентилей. */
export interface LatencySet {
  id: string;
  label: string;
  /** Подпись над демо. Строчная разметка. */
  note: string;
  /** Миллисекунды. */
  values: number[];
}
