/** Кандидат из `srcset` после разбора: адрес и либо ширина файла (`w`), либо плотность (`x`). */
export interface Candidate {
  url: string;
  w?: number;
  x?: number;
}

/** Условия, при которых браузер выбирает кандидата. */
export interface Env {
  /** Ширина вьюпорта в CSS-пикселях. */
  vw: number;
  /** `devicePixelRatio`: сколько физических пикселей в одном CSS-пикселе. */
  dpr: number;
  /** Файлы из этого `srcset`, которые уже лежат в кеше браузера. */
  cached?: string[];
  /** Картинка с `loading="lazy"`: только тогда работает `sizes="auto"`. */
  lazy?: boolean;
  /** Ширина картинки по раскладке — её берёт `sizes="auto"`. */
  layoutWidth?: number;
}

export interface Slot {
  /** Ширина слота в CSS-пикселях. */
  px: number;
  /** Какая часть `sizes` сработала; `null` — `sizes` нет или не сработала ни одна. */
  rule: string | null;
}

export interface Choice {
  slot: Slot;
  /** Кандидаты по возрастанию плотности. */
  list: { url: string; density: number }[];
  /** Что выбрал бы браузер без кеша — это и запросит упреждающий парсер. */
  pick: string;
  /** Что покажет элемент: более плотный файл из кеша, если такой есть. */
  shown: string;
}

export interface SrcsetApi {
  parseSrcset(srcset: string): Candidate[];
  slotWidth(sizes: string | null, env: Env): Slot;
  pickCandidate(srcset: string, sizes: string | null, env: Env): Choice;
}

/** Один прогон стенда: вьюпорт, DPR и файл, который Chromium запросил. */
export interface StandPick {
  vw: number;
  dpr: number;
  got: string;
}

/** Сценарий демо: разметка и что по ней снял стенд. */
export interface Scenario {
  id: string;
  label: string;
  srcset: string;
  sizes: string | null;
  runs: StandPick[];
}

/** Файл-кандидат на стенде: байты (sharp) и размеры в пикселях. */
export interface ImageFile {
  bytes: number;
  w: number;
  h: number;
}
