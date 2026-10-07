/** Документ во вкладке и вердикт: попадёт ли он в тот же процесс, что главный фрейм. */
export interface SiteCase {
  /** Подпись на переключателе. */
  label: string;
  full: string;
  /** Схема + eTLD+1 — то, чем на самом деле меряется изоляция. */
  site: string;
  /** Тот же site, что у главного фрейма. */
  same: boolean;
  why: string;
  verdict: string;
}
