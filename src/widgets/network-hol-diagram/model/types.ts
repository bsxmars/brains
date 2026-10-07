/** Судьба пакета: отдан браузеру, потерян или дошёл, но придержан за дырой. */
export type PacketState = 'got' | 'lost' | 'held';

export interface HolPacket {
  /** Номер пакета в общей ленте — он же столбец схемы. */
  n: number;
  file: string;
  state: PacketState;
}

export interface HolLane {
  name: string;
  packets: HolPacket[];
}

export interface HolVersion {
  k: string;
  sub: string;
  lanes: HolLane[];
  verdict: string;
  tone: 'ok' | 'err';
}

export interface HolDiagramData {
  title: string;
  /** Сколько пакетов в сцене: столько столбцов у каждой ленты. */
  total: number;
  legend: { state: PacketState; t: string }[];
  versions: HolVersion[];
  caption: string;
}
