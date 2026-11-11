export type DiagramTone = 'neutral' | 'info' | 'ok' | 'warn' | 'err' | 'ink';
export type DiagramSide = 'top' | 'right' | 'bottom' | 'left';

export interface DiagramNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  detail?: string;
  tone?: DiagramTone;
}

export interface DiagramEdge {
  from: string;
  to: string;
  fromSide?: DiagramSide;
  toSide?: DiagramSide;
  via?: [number, number][];
  label?: string;
  labelX?: number;
  labelY?: number;
  dashed?: boolean;
}

export interface ConceptDiagramData {
  id: string;
  title: string;
  /** Describes the relationship shown, including conditions on arrows. */
  description: string;
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  note?: string;
}
