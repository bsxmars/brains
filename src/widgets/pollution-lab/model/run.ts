import type { PollutionFix, PollutionRun, PollutionVictim } from './types';

/**
 * Prototype pollution — выполнением, а не цепочкой фишек.
 *
 * В уроке атака нарисована статичной схемой, и самое важное в ней приходится принимать на слово:
 * что после слияния **посторонний, ничем не связанный объект** отвечает чужим свойством.
 * Здесь это происходит по-настоящему: наивный `merge` получает `JSON.parse` вредоносной строки,
 * а затем спрашивается свежий `{}`, которого никто не касался.
 *
 * Логика живёт отдельно от компонента по правилу курса: тест импортирует этот же модуль.
 *
 * ⚠️ **Демо обязано убирать за собой.** Успешная атака вешает свойство на настоящий
 * `Object.prototype` — то есть портит страницу читателя ровно тем способом, о котором
 * рассказывает раздел. Поэтому запись снимается в `finally`, а компонент чистит прототип ещё
 * и при размонтировании: `cleanPrototype()`.
 *
 * ⚠️ **Заморозка ставится на дублёре, и это не поблажка, а единственный честный способ.**
 * `Object.freeze` необратим: заморозив настоящий `Object.prototype`, демо оставило бы страницу
 * навсегда изменённой, и «убрать за собой» стало бы невыполнимо. Поэтому при включённой
 * заморозке роль общего прототипа играет настоящий объект `Base`, а роль постороннего —
 * настоящий `Object.create(Base)`. Механизм от этого не меняется: `target['__proto__']`
 * читает тот же аксессор и возвращает тот же прототип, а отказ бросает тот же движок.
 * Подменять исключение или ответ не приходится — подменён только пострадавший.
 */

/** Вредоносная нагрузка ровно в том виде, в каком она приходит с улицы. */
export const PAYLOAD = '{"__proto__":{"isAdmin":true}}';

/** Свойство, которое подбрасывает атака. Оно же снимается при уборке. */
export const FLAG = 'isAdmin';

export const FIXES: { value: PollutionFix; label: string }[] = [
  { value: 'filter', label: 'проверка ключа' },
  { value: 'nullProto', label: 'Object.create(null)' },
  { value: 'freeze', label: 'freeze(Object.prototype)' },
];

/** Ключи, на которых наивное слияние проваливается в прототип. */
const DANGEROUS = ['__proto__', 'constructor', 'prototype'];

type Dict = Record<string, unknown>;

/**
 * Снять подброшенное свойство с настоящего `Object.prototype`.
 *
 * Отдельной экспортируемой функцией, потому что зовут её из двух мест: `finally` каждого
 * прогона и `onUnmounted` компонента. Свойство создавалось обычным присваиванием, поэтому
 * оно настраиваемое и удаляется.
 */
export function cleanPrototype(): void {
  delete (Object.prototype as Dict)[FLAG];
}

/** Как назвать то, что вернуло чтение ключа: для трассы важна не форма, а identity. */
function describe(value: unknown, victim: object, victimLabel: string): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value === victim) return `${victimLabel} ← аксессор вернул сам прототип`;
  if (typeof value === 'object') return 'объект';
  return JSON.stringify(value);
}

/**
 * Тот самый наивный рекурсивный merge, который живёт в половине утилитных библиотек.
 *
 * Уязвимость вся в одной строке: `target[key]` для ключа `__proto__` — это **чтение
 * аксессора**, и возвращает оно прототип, а не собственное свойство. Дальше рекурсия
 * добросовестно пишет в то, что ей вернули.
 */
function merge(target: Dict, source: Dict, guard: boolean, log: string[], victim: object, victimLabel: string): Dict {
  for (const key of Object.keys(source)) {
    if (guard && DANGEROUS.includes(key)) {
      log.push(`ключ "${key}" отклонён проверкой`);
      continue;
    }

    const value = source[key];

    if (value && typeof value === 'object') {
      const current = target[key];
      log.push(`читаем target["${key}"] → ${describe(current, victim, victimLabel)}`);

      if (!current || typeof current !== 'object') {
        target[key] = {};
        log.push(`своего "${key}" не было — создали обычное свойство`);
      }

      merge(target[key] as Dict, value as Dict, guard, log, victim, victimLabel);
      continue;
    }

    target[key] = value;
    log.push(`пишем ${key} = ${JSON.stringify(value)}`);
  }

  return target;
}

/** Исходник под выбранные защиты — тот же, что исполнился. */
function listing(fixes: PollutionFix[]): string[] {
  const lines: string[] = [];

  if (fixes.includes('freeze')) lines.push('Object.freeze(Object.prototype);', '');

  lines.push('function merge(target, source) {');
  lines.push('  for (const key of Object.keys(source)) {');
  if (fixes.includes('filter')) {
    lines.push("    if (key === '__proto__' || key === 'constructor') continue;");
  }
  lines.push('    const value = source[key];');
  lines.push('    if (value && typeof value === "object") {');
  lines.push('      if (!target[key]) target[key] = {};');
  lines.push('      merge(target[key], value);');
  lines.push('    } else target[key] = value;');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push(fixes.includes('nullProto') ? 'const target = Object.create(null);' : 'const target = {};');
  lines.push(`merge(target, JSON.parse('${PAYLOAD}'));`);
  lines.push('');
  lines.push(fixes.includes('freeze') ? 'Object.create(Base).isAdmin;' : '({}).isAdmin;');

  return lines;
}

/**
 * Провести одну настоящую атаку с выбранным набором защит.
 *
 * Возвращает то, что реально произошло: ответ постороннего объекта, собственные ключи цели,
 * имя брошенной ошибки и трассу слияния.
 */
export function runPollution(fixes: PollutionFix[]): PollutionRun {
  const guard = fixes.includes('filter');
  const useNullProto = fixes.includes('nullProto');
  const useFreeze = fixes.includes('freeze');

  // Дублёр общего прототипа — только под заморозку; во всех остальных случаях страдает настоящий.
  const base: Dict = {};
  const victim: object = useFreeze ? base : Object.prototype;
  const victimKind: PollutionVictim = useFreeze ? 'stand-in' : 'Object.prototype';
  const victimLabel = useFreeze ? 'Base (дублёр Object.prototype)' : 'Object.prototype';

  if (useFreeze) Object.freeze(base);

  const target: Dict = useNullProto
    ? (Object.create(useFreeze ? base : null) as Dict)
    : useFreeze
      ? (Object.create(base) as Dict)
      : {};

  const log: string[] = [];
  let errorName = '';
  let error = '';
  let bystander = 'undefined';
  let polluted = false;

  try {
    const payload = JSON.parse(PAYLOAD) as Dict;
    log.push(`Object.keys(payload) → ${JSON.stringify(Object.keys(payload))}`);

    merge(target, payload, guard, log, victim, victimLabel);

    // Посторонний: объект, которого никто не касался. Весь вопрос демо — что он ответит.
    const witness = (useFreeze ? Object.create(base) : {}) as Dict;
    const seen = witness[FLAG];
    polluted = seen !== undefined;
    bystander = seen === undefined ? 'undefined' : JSON.stringify(seen);
    log.push(`посторонний объект → ${bystander}`);
  } catch (caught) {
    errorName = caught instanceof Error ? caught.name : 'Error';
    error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
    log.push(`отказ: ${error}`);
  } finally {
    // Прибираем всегда — даже если выше что-то бросило на половине пути.
    cleanPrototype();
  }

  /**
   * Ключи считаются после блока намеренно: уборка в `finally` трогает только прототип,
   * а цель к этому моменту окончательна — и при успешном слиянии, и при отказе на половине пути.
   */
  const targetKeys = Object.keys(target);

  const verdict = polluted
    ? 'Свойства не было ни у кого — а теперь оно есть у всех. Цель слияния при этом не получила ничего: запись ушла в прототип.'
    : errorName
      ? 'Атака упёрлась в отказ: запись в прототип бросила исключение, и слияние не доехало.'
      : 'Атака не прошла: запись осталась внутри цели, посторонний объект по-прежнему ничего не знает.';

  return {
    fixes,
    code: listing(fixes),
    payload: PAYLOAD,
    probe: useFreeze ? 'Object.create(Base).isAdmin' : '({}).isAdmin',
    bystander,
    polluted,
    targetKeys,
    victim: victimKind,
    victimNote: useFreeze
      ? 'Заморозка поставлена на объект-дублёр: `Object.freeze` необратим, и демо не имеет права оставить страницу читателя замороженной. Механизм тот же — то же чтение аксессора и то же исключение от движка.'
      : 'Опыт идёт на настоящем `Object.prototype`; подброшенное свойство снимается сразу после проверки.',
    errorName,
    error,
    log,
    verdict,
    tone: polluted ? 'err' : 'ok',
  };
}
