/** Prepared URL/PSL example; process placement is deliberately not predicted. */
export interface SiteCase {
  /** Подпись на переключателе. */
  label: string;
  full: string;
  /** Prepared schemeful site for this domain URL, according to PSL. */
  site: string;
  /** Тот же site, что у главного фрейма. */
  same: boolean;
  why: string;
  verdict: string;
}
