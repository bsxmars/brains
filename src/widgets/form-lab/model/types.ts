/** Модель поля для мини-`v-model`: откуда читать и куда писать значение. */
export interface FieldModel {
  get(): unknown;
  set(value: unknown): void;
}

export interface ModelMods {
  lazy?: boolean;
  trim?: boolean;
  number?: boolean;
}

/** `bindModel` из `MODEL_CODE`: вешает слушатели и возвращает «модель → DOM». */
export type BindModel = (el: HTMLElement, model: FieldModel, mods?: ModelMods) => () => void;

/** Часть спецификации дерева: форма, поле или превью. См. `buildTree` в `RENDER_CODE`. */
export interface RenderPart {
  owns?: string[];
  reads?: string[];
  memo?: boolean;
  /** Проп → откуда: ключ состояния, `'$key'`, `'new-fn'`, `'same'`, `'const'`. */
  props?: Record<string, string>;
}

export interface RenderSpec {
  form: RenderPart;
  field: RenderPart;
  preview: RenderPart | null;
}

/** Вариант устройства состояния формы: код для читателя и то же дерево словами модели. */
export interface RenderSetup extends RenderSpec {
  id: string;
  framework: 'react' | 'vue';
  label: string;
  /** Код варианта — его же монтирует тест. */
  code: string;
  /** Пояснение к варианту. Строчная разметка. */
  note: string;
}

export interface TreeNode {
  name: string;
  owns: string[];
  reads: string[];
  memo: boolean;
  props: Record<string, string>;
  children: TreeNode[];
}

export interface RenderApi {
  whoRenders(framework: 'react' | 'vue', node: TreeNode, key: string): string[];
  buildTree(spec: RenderSpec, fields: string[]): TreeNode;
}
