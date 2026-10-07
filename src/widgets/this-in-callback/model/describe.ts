/**
 * Как назвать значение, которое реально оказалось в `this`.
 *
 * Функция нужна ровно потому, что ответ теперь не пишется, а достаётся: в `this` может лежать
 * `undefined`, глобальный объект, DOM-элемент, экземпляр класса — и всё это надо показать
 * одной строкой, не уронив демо и не вывалив на читателя весь объект целиком.
 *
 * ⚠️ Три правила, и все три проверены неприятностями:
 *
 * - **`undefined` и `null` обязаны пройти раньше любого `typeof`-разбора** — иначе обращение
 *   к свойству у них же всё и уронит;
 * - **чтение любого свойства обёрнуто в `try`**: сюда может приехать прокси, у которого
 *   геттер бросает, и описание значения не имеет права быть опаснее самого значения;
 * - **большой объект печатается коротко.** Три ключа, значения обрезаны; иначе на месте
 *   аккуратной подписи оказывается стена текста.
 */

/** Значение поля — одной короткой строкой. Ни одного развёрнутого вложенного объекта. */
function short(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value.length > 24 ? `${value.slice(0, 24)}…` : value);
  if (typeof value === 'function') return 'ƒ';
  if (typeof value === 'object') return Array.isArray(value) ? '[…]' : '{…}';
  return String(value);
}

/** Тег элемента — по утиной проверке, а не по `instanceof Element`: в Node такого класса нет. */
function elementTag(value: object): string {
  try {
    const node = value as { nodeType?: unknown; tagName?: unknown };
    if (typeof node.nodeType === 'number' && typeof node.tagName === 'string') return node.tagName.toLowerCase();
  } catch {
    // Значение отказалось отвечать на чтение свойства — значит, это не элемент.
  }
  return '';
}

/** Имя конструктора; для литерала — честное «объект», а не выдуманный `Object`. */
function ctorName(value: object): string {
  try {
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    if (ctor?.name && ctor.name !== 'Object') return ctor.name;
  } catch {
    // Прокси без цели или объект без прототипа — имени просто нет.
  }
  return 'объект';
}

/** Первые три собственных ключа — чтобы экземпляр было видно, а не только его класс. */
function fields(value: object): string {
  try {
    const keys = Object.keys(value);
    if (!keys.length) return '';
    const shown = keys.slice(0, 3);
    const body = shown.map((key) => `${key}: ${short((value as Record<string, unknown>)[key])}`).join(', ');
    return ` { ${body}${keys.length > shown.length ? ', …' : ''} }`;
  } catch {
    return '';
  }
}

/**
 * Описание настоящего значения `this` — то, что демо показывает в правой панели.
 *
 * Глобальный объект назван отдельно и до всего прочего: в браузере это `Window`, в Node —
 * `globalThis`, и разница здесь принципиальна. Именно он приезжает вместо `undefined`,
 * когда колбэк оказался нестрогим, — а это тот самый случай, когда вместо ошибки получается
 * молча неправильный запрос.
 */
export function describeThis(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';

  if (value === globalThis) {
    return typeof window !== 'undefined' && value === window ? 'globalThis (Window)' : 'globalThis';
  }

  if (typeof value === 'function') {
    const name = (value as { name?: string }).name;
    return name ? `функция ${name}` : 'анонимная функция';
  }

  if (typeof value !== 'object') return `${typeof value} ${short(value)}`;

  const tag = elementTag(value);
  if (tag) return `<${tag}> — DOM-элемент`;

  return `${ctorName(value)}${fields(value)}`;
}
