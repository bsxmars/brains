import type { BindingType } from './types';

/**
 * Разбор WGSL настолько, насколько его нужно, чтобы сверить шейдер с раскладкой в JS.
 *
 * Это не парсер языка, а три регулярных выражения — и в этом их честность: они понимают ровно
 * ту форму объявлений, которой написаны шейдеры темы, а на незнакомой форме возвращают пусто,
 * и тест краснеет на «привязок не нашлось», а не молча проходит.
 */

export interface WgslBinding {
  group: number;
  binding: number;
  name: string;
  /** `storage` или `uniform` — адресное пространство из `var<…>`. */
  space: 'storage' | 'uniform';
  /** Доступ: у `storage` по умолчанию `read`. */
  access: 'read' | 'read_write';
}

const BINDING_RE =
  /@group\((\d+)\)\s*@binding\((\d+)\)\s*var<\s*(storage|uniform)\s*(?:,\s*(read|read_write)\s*)?>\s*([A-Za-z_]\w*)/g;

export function parseBindings(wgsl: string): WgslBinding[] {
  return [...wgsl.matchAll(BINDING_RE)].map((m) => ({
    group: Number(m[1]),
    binding: Number(m[2]),
    space: m[3] as 'storage' | 'uniform',
    access: m[3] === 'uniform' ? 'read' : ((m[4] ?? 'read') as 'read' | 'read_write'),
    name: m[5],
  }));
}

/** Какой тип привязки в `GPUBindGroupLayout` соответствует объявлению в шейдере. */
export function layoutTypeOf(b: WgslBinding): BindingType {
  if (b.space === 'uniform') return 'uniform';
  return b.access === 'read_write' ? 'storage' : 'read-only-storage';
}

/** `@workgroup_size(64)` → 64; `@workgroup_size(8, 8)` → 64. Нет атрибута — `null`. */
export function workgroupSizeOf(wgsl: string): number | null {
  const m = wgsl.match(/@workgroup_size\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?(?:,\s*(\d+)\s*)?\)/);
  if (!m) return null;
  return Number(m[1]) * Number(m[2] ?? 1) * Number(m[3] ?? 1);
}

/** Значение `const NAME = 16u;` — чтобы сверить число корзин шейдера с данными. */
export function constOf(wgsl: string, name: string): number | null {
  const m = wgsl.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\d+)u?\\s*;`));
  return m ? Number(m[1]) : null;
}
