/**
 * Типы учебной модели контроллера StatefulSet (`SIM_CODE` в теме «StatefulSet, тома и данные»).
 *
 * Сама модель живёт строкой в `data.ts` темы и собирается `new Function` (`run.ts`), поэтому
 * здесь только форма её входов и выходов — чтобы демо и тест обращались к ней с типами.
 */

export type PodPolicy = 'OrderedReady' | 'Parallel';
export type ClaimPolicy = 'Retain' | 'Delete';

export interface Retention {
  whenScaled: ClaimPolicy;
  whenDeleted: ClaimPolicy;
}

export interface SetSpec {
  name: string;
  serviceName: string;
  namespace: string;
  /** Имя шаблона тома в `volumeClaimTemplates`. */
  claim: string;
  replicas: number;
  podManagementPolicy?: PodPolicy;
  partition?: number;
  retention?: Retention;
}

export interface Pod {
  ord: number;
  /** Номер ревизии шаблона: 1, 2, … */
  rev: number;
  ready: boolean;
  terminating: boolean;
}

export interface Claim {
  ord: number;
  name: string;
  /** `pod` — у PVC владелец-под: сборщик мусора удалит PVC следом за подом. */
  owner: 'pod' | null;
}

export interface SetState {
  name: string;
  serviceName: string;
  namespace: string;
  claim: string;
  replicas: number;
  podManagementPolicy: PodPolicy;
  partition: number;
  retention: Retention;
  currentRevision: number;
  updateRevision: number;
  pods: Pod[];
  claims: Claim[];
  deleted: boolean;
  finalized?: boolean;
}

export type LogKind =
  | 'create'
  | 'claim'
  | 'reuse'
  | 'wait'
  | 'delete'
  | 'update'
  | 'doom'
  | 'keep'
  | 'gone'
  | 'claim-gone'
  | 'kill'
  | 'ready'
  | 'done'
  | 'idle';

export interface LogEntry {
  kind: LogKind;
  /** Номер пода, к которому относится запись; −1 — ко всему набору. */
  ord: number;
  text: string;
  /** Ревизия создаваемого пода — только у `create`. */
  rev?: number;
}

export interface Pass {
  set: SetState;
  log: LogEntry[];
}

export type ClaimEvent = 'scale-down' | 'set-deleted' | 'pod-replaced';

/** То, что возвращает `SIM_CODE`. */
export interface StsSim {
  podName(set: Pick<SetState, 'name'>, ord: number): string;
  claimName(set: Pick<SetState, 'name' | 'claim'>, ord: number): string;
  podFqdn(set: Pick<SetState, 'name' | 'serviceName' | 'namespace'>, ord: number, domain?: string): string;
  claimFate(policy: Retention, event: ClaimEvent): 'kept' | 'deleted';
  create(spec: SetSpec): SetState;
  sync(set: SetState): Pass;
  settle(set: SetState): Pass;
  step(set: SetState): Pass;
  ready(set: SetState, ord: number): Pass;
  kill(set: SetState, ord: number): Pass;
  scale(set: SetState, replicas: number): SetState;
  updateImage(set: SetState): SetState;
  setPartition(set: SetState, partition: number): SetState;
  setRetention(set: SetState, retention: Retention): SetState;
  remove(set: SetState): SetState;
}
