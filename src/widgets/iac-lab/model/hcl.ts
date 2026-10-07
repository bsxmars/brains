import type { AttrValue, Config, ResourceConfig } from './types';

/**
 * Печать конфигурации планировщика в HCL — тем текстом, который видит читатель в демо
 * и который тест кладёт в `main.tf` перед настоящим `tofu plan`. Отступы и выравнивание `=`
 * — как у `tofu fmt`: тест проверяет это `tofu fmt -check` на каждом сценарии.
 *
 * Это печать, а не механизм: план считает `PLAN_CODE` из темы.
 */

/** Провайдеры с закреплёнными версиями — те, что стояли на стенде. */
export const HCL_HEADER = `terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "2.9.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }
}
`;

const quote = (s: string) => '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n') + '"';

function value(v: AttrValue, res: ResourceConfig): string {
  if (typeof v !== 'string') return String(v);
  const key = res.count ? '${local.envs[count.index]}' : '${each.key}';
  return quote(v).replaceAll('${key}', key);
}

/** Строки `имя = значение` с выравниванием `=` по самому длинному имени, как у `tofu fmt`. */
function aligned(pairs: [string, string][], indent: string): string[] {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${indent}${k.padEnd(width)} = ${v}`);
}

function resource(res: ResourceConfig): string {
  const head: [string, string][] = [];
  if (res.count) head.push(['count', 'length(local.envs)']);
  if (res.forEach) head.push(['for_each', 'toset(local.envs)']);
  const attrs: [string, string][] = Object.entries(res.attrs).map(([k, v]) => [k, value(v, res)]);
  const lines = [`resource "${res.type}" "${res.name}" {`];
  // Как у fmt: count/for_each выравниваются вместе с атрибутами — это одна группа строк.
  lines.push(...aligned([...head, ...attrs], '  '));
  if (res.dependsOn?.length) lines.push('', `  depends_on = [${res.dependsOn.join(', ')}]`);
  if (res.createBeforeDestroy) lines.push('', '  lifecycle {', '    create_before_destroy = true', '  }');
  lines.push('}');
  return lines.join('\n');
}

export function toHcl(config: Config, opts: { header?: boolean } = {}): string {
  const parts: string[] = [];
  if (opts.header) parts.push(HCL_HEADER.trimEnd());
  const list = config.resources.find((r) => r.count || r.forEach);
  const envs = list?.count ?? list?.forEach;
  if (envs) parts.push(`locals {\n  envs = [${envs.map(quote).join(', ')}]\n}`);
  for (const res of config.resources) parts.push(resource(res));
  for (const m of config.moved ?? []) {
    parts.push(['moved {', ...aligned([['from', m.from], ['to', m.to]], '  '), '}'].join('\n'));
  }
  return parts.join('\n\n') + '\n';
}
