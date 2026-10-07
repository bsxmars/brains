/** Имена сборок демо: host и два remote. */
export type MfAppName = 'host' | 'catalog' | 'cart';
export type MfRemoteName = Exclude<MfAppName, 'host'>;

/** Состояние remote в сети стенда. */
export type MfStatus = 'up' | 'down' | 'hang';

/** Что выставлено переключателями демо. */
export interface MfState {
  versions: Record<MfAppName, string>;
  status: Record<MfRemoteName, MfStatus>;
  singleton: boolean;
  /** `auto` — не задавать `strictVersion`, пусть сработает умолчание. */
  strict: 'auto' | 'on' | 'off';
  /** `eager` у host. */
  eager: boolean;
}

export interface MfPreset {
  label: string;
  state: MfState;
}

/** Настройки общей зависимости одной сборки — то, что принимает `consume`. */
export interface MfLibConfig {
  version: string;
  requiredVersion: string;
  singleton: boolean;
  strictVersion?: boolean;
  eager: boolean;
}

export interface MfApp {
  name: MfAppName;
  pkg: string;
  url: string;
  status: MfStatus;
  lib: MfLibConfig;
}

/** Исполненная копия библиотеки. */
export interface MfCopy {
  pkg: string;
  version: string;
  owner: string;
}

export interface MfLogEntry {
  level: 'warn' | 'error';
  who: string;
  text: string;
}

export interface MfWorld {
  copies: MfCopy[];
  log: MfLogEntry[];
}

export interface MfScopeEntry {
  from: string;
  eager: boolean;
  loaded: boolean;
}

export type MfScope = Record<string, Record<string, MfScopeEntry>>;

export interface MfWidgetResult {
  fallback?: boolean;
  error?: string;
  lib?: MfCopy;
  html?: string;
}

export interface MfRun {
  scope: MfScope;
  host: MfCopy | null;
  results: Partial<Record<MfRemoteName, MfWidgetResult>>;
}

type Get = () => MfCopy;

/** Всё, что возвращает строка `FEDERATION_CODE`. */
export interface Federation {
  satisfies(version: string, range: string): boolean;
  compare(a: string, b: string): number;
  register(scope: MfScope, pkg: string, version: string, from: string, eager: boolean, get: Get): void;
  consume(
    scope: MfScope,
    pkg: string,
    cfg: { singleton: boolean; requiredVersion?: string; strictVersion?: boolean },
    fallback: Get,
    who: string,
    log: MfLogEntry[],
  ): MfCopy;
  bundleLibrary(copies: MfCopy[], pkg: string, version: string, owner: string): Get;
  runHost(
    world: MfWorld,
    host: MfApp,
    remotes: MfApp[],
    loadEntry: (remote: MfApp) => Promise<unknown>,
    timeoutMs: number,
  ): Promise<MfRun>;
  fakeNetwork(world: MfWorld): (remote: MfApp) => Promise<unknown>;
}
