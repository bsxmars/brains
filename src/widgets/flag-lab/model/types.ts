/** Контекст пользователя демо: id и, у части, почта и страна. */
export interface DemoUser {
  targetingKey: string;
  email?: string;
  country?: string;
  [attr: string]: string | undefined;
}

export interface Rule {
  when: { attr: string; in?: string[]; endsWith?: string };
  variant: string;
}

/** Флаг в форме, которую понимает `evaluate` из темы. */
export interface Flag {
  variants: Record<string, unknown>;
  defaultVariant: string;
  disabled?: boolean;
  rules?: Rule[];
  split?: [string, number][];
}

export interface Resolution {
  value: unknown;
  variant?: string;
  reason: string;
  errorCode?: string;
}

/** Функции из строк `FLAG_CODE` и `COIN_CODE` темы. */
export interface FlagApi {
  murmur3(text: string): number;
  bucketOf(flagKey: string, targetingKey: string, total: number): number;
  pickVariant(flagKey: string, targetingKey: string, split: [string, number][]): string | undefined;
  evaluate(flagKey: string, flag: Flag | undefined, context: Record<string, unknown>, defaultValue: unknown): Resolution;
  coinFlip(percent: number, random?: () => number): boolean;
}

export type Decider = 'hash' | 'coin';
