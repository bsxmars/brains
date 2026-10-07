/** CSS-модуль для демо: путь в фикстуре стенда и текст файла. */
export interface ModuleFile {
  id: string;
  label: string;
  /** Путь от корня проекта — только подпись: в имя класса он не входит. */
  path: string;
  css: string;
}

/** Файл-фикстура Tailwind: текст и байты CSS, который Tailwind 4.3.3 написал по одному этому файлу. */
export interface TwFile {
  id: string;
  name: string;
  text: string;
  bytes: number;
}

export interface Candidate {
  candidate: string;
  /** Смещение начала в тексте. */
  start: number;
}

export interface ModuleNamer {
  stringHash(str: string): number;
  scopedName(name: string, css: string): string;
  moduleExports(css: string): Record<string, string>;
}

export type Scanner = (text: string) => Candidate[];
