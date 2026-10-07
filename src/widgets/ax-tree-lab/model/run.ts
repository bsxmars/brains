import type { AxApi } from './types';

/**
 * Демо и тест спрашивают одни и те же функции — строки `ROLE_CODE`, `NAME_CODE` и `TAB_CODE`
 * из темы «Дерево доступности».
 *
 * Строки напечатаны на странице, склеены здесь и собраны `new Function`. Тест
 * `tests/unit/accessibility-tree.test.ts` прогоняет их в happy-dom по фикстурам и сценам и
 * сверяет с тем, что Chromium 153 отдал через CDP на стенде (литералы в `data.ts`). Копии нет:
 * разойдётся показанный код с браузером — покраснеет тест.
 *
 * Функции берут окно из `el.ownerDocument.defaultView`, поэтому им всё равно, где лежит
 * разметка: в скрытом `iframe` демо, в окне happy-dom или в странице стенда.
 */
export function loadAx(parts: string[]): AxApi {
  return new Function(
    `${parts.join('\n\n')}\nreturn { roleOf, accName, statesOf, isHidden, focusable, tabOrder, axTree };`,
  )() as AxApi;
}

/** Все элементы сцены в порядке документа — тот же список, по которому снят стенд. */
export function sceneElements(root: Element): Element[] {
  return [...root.querySelectorAll('*')].filter((el) => el.localName !== 'script');
}

/**
 * Строка на элемент, как в литерале стенда: `-` — скрыт, `~` — generic или none без имени
 * (в дереве растворяется), иначе `роль|имя`.
 */
export function elementRow(api: AxApi, el: Element): string {
  if (api.isHidden(el)) return '-';
  const role = api.roleOf(el);
  const { name } = api.accName(el);
  if ((role === 'generic' || role === 'none') && !name) return '~';
  return `${role}|${name}`;
}
