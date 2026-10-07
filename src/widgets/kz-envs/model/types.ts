/**
 * Формы данных демо «один манифест на три окружения».
 *
 * Модель — строки `MODEL_PARTS` из темы `delivery/helm-gitops`, собранные `new Function`.
 * Здесь описана только та часть её ответа, которую читают демо и тест.
 */

export type Env = 'dev' | 'stage' | 'prod';
export type Tool = 'kustomize' | 'helm';
/** `strategic` — как kustomize; `replace` — списки заменяются целиком, как в JSON merge patch. */
export type ListMode = 'strategic' | 'replace';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- разобранный YAML произвольной формы
export type Doc = any;

export interface ContainerFact {
  name: string;
  image: string | null;
  env: string[];
}

export interface Facts {
  replicas: number | null;
  containers: ContainerFact[];
  host: string | null;
  config: { name: string; data: Record<string, string> } | null;
}

export interface View {
  lines: { text: string; changed: boolean }[];
  gone: string[];
  facts: Facts;
}

export type SetArg = string | { expr: string; asString: boolean };

export interface Model {
  parseYaml(text: string): Doc[];
  dumpYaml(value: Doc, opts?: { sortKeys?: boolean }): string;
  dumpAll(docs: Doc[]): string;
  strategicMerge(base: Doc, patch: Doc, kind: string, path?: string[]): Doc;
  jsonMergePatch(target: Doc, patch: Doc): Doc;
  jsonPatch(doc: Doc, ops: Doc[]): Doc;
  kustomize(files: Record<string, string>, dir: string, mode?: ListMode): Doc[];
  setImage(image: string, rules: Doc[]): string;
  contentHash(obj: Doc): string;
  helmValues(chart: Doc, files: Doc[], sets: SetArg[]): Doc;
  parseSet(expr: string, asString?: boolean): [string[], Doc][];
  applySet(values: Doc, expr: string, asString?: boolean): Doc;
  renderTemplate(src: string, root: Doc): string;
  helmTemplate(chart: Doc, values: Doc, release: { name: string; namespace?: string }): string;
  parseHelmCommand(cmd: string): { release: string; chart: string; namespace: string; files: string[]; sets: SetArg[] };
  helmRelease(files: Record<string, string>, cmd: string): { values: Doc; text: string };
  lineDiff(before: string[], after: string[]): { changed: boolean[]; gone: string[] };
  factsOf(docs: Doc[]): Facts;
  buildView(files: Record<string, string>, commands: Record<string, string>, env: Env, tool: Tool, mode: ListMode): View;
}
