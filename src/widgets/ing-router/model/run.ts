import type { IngressSpec, Router, RouteScenario } from './types';

/**
 * Демо и тест спрашивают правила выбора одним и тем же кодом — строкой `ROUTER_CODE` из темы.
 *
 * `loadRouter` собирает её `new Function`: та же строка напечатана в теме, та же исполняется
 * здесь и в `tests/unit/ingress.test.ts`. Копии нет — если текст на странице разойдётся
 * с таблицами из спецификаций, покраснеет тест.
 *
 * Ни DOM, ни Vue: чистые функции, чтобы их мог импортировать юнит-тест.
 */
export function loadRouter(code: string): Router {
  return new Function(code)() as Router;
}

/**
 * Номера строк YAML, с которых начинается каждый путь Ingress (`- path:`) или каждое
 * правило HTTPRoute (элемент списка прямо под `rules:`), — чтобы подсветить в листинге
 * то правило, которое выиграло.
 *
 * Разбор по отступам, а не парсером YAML: парсер в браузер не везём. Расхождение числа
 * найденных строк с числом правил сверяет тест — на каждом сценарии.
 */
export function ruleLines(yaml: string, kind: RouteScenario['kind']): number[] {
  const lines = yaml.split('\n');
  if (kind === 'ingress') {
    return lines.flatMap((line, i) => (/^\s*- path:/.test(line) ? [i] : []));
  }
  const start = lines.findIndex((line) => /^\s*rules:\s*$/.test(line));
  if (start < 0) return [];
  const indent = lines[start].search(/\S/);
  const out: number[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const at = lines[i].search(/\S/);
    if (at < 0) continue;
    if (at <= indent) break;
    if (at === indent + 2 && lines[i].trimStart().startsWith('- ')) out.push(i);
  }
  return out;
}

/** Сквозной номер пути Ingress: правила идут одно за другим, пути внутри — по порядку. */
export function flatPathIndex(spec: IngressSpec, rule: number, path: number): number {
  const before = (spec.rules ?? []).slice(0, rule).reduce((n, r) => n + (r.http?.paths.length ?? 0), 0);
  return before + path;
}
