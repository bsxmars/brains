import type { CaseSetup, FiredFlag, ReachCaseKey, ReachCaseSpec } from './types';

/**
 * Семь графов ссылок, построенных по-настоящему: объект, держатель, слабая ссылка на объект.
 *
 * Зачем модуль, а не логика в компоненте: ровно эти функции зовёт юнит-тест — в Node, где есть
 * `--expose-gc` и где ответ детерминирован. Демо и тест обязаны спрашивать движок одинаково,
 * иначе «проверено тестом» означало бы «проверено что-то похожее» (тот же довод, что
 * у `widgets/clone-survival`, `widgets/lock-lab` и `widgets/ic-bench`).
 *
 * ⚠️ **Подопытный объект наружу не возвращается ни из одной функции этого файла.** Стоит вернуть
 * его хотя бы раз — и он поселится в кадре вызывающего, который живёт весь прогон; тогда
 * «не собрался» получили бы все семь случаев, включая те, где держать некому. Правило
 * из AGENTS.md («ссылку создавать внутри функции») здесь не совет, а условие работы стенда.
 *
 * ⚠️ **Ловушка контекста — та самая, о которой сам урок и рассказывает, и она едва не сломала
 * этот файл.** V8 создаёт **один Context на скоуп**, и любое замыкание, созданное в теле
 * `build*`, удерживает этот Context целиком — вместе с подопытным объектом, который лежит
 * в соседней переменной. Достаточно было бы отдать наружу `finalized: () => flag` или собрать
 * колбэк реестра прямо здесь — и **каждый** случай стал бы «не собрался», причём выглядело бы
 * это как свойство сборщика, а не как ошибка стенда.
 *
 * Отсюда два правила, которые нельзя нарушать при правке:
 *
 *  1. колбэк `FinalizationRegistry` собирается в `makeFinalizer()` — **в чужом скоупе**, где
 *     подопытного нет и быть не может;
 *  2. наружу отдаётся объект-флаг, а не функция-читалка: поле читается, замыкание — нет.
 *
 * Единственное место, где замыкание в теле сборки создаётся намеренно, — случай со слушателем.
 * Там оно и есть предмет: обработчик держит Context, Context держит объект.
 */

/** Куда уходит значение, прочитанное обработчиком: без стока чтение можно было бы выбросить. */
let sink: unknown;

/** Что стенд прочитал последним. Нужно только затем, чтобы обработчик не оказался пустым. */
export function listenerSink(): unknown {
  return sink;
}

/**
 * Флаг и реестр — собранные в отдельном скоупе.
 *
 * Контекст этого замыкания содержит `flag` и ничего больше. Именно поэтому реестр можно
 * держать сильно (а держать его надо: у собранного реестра колбэк не вызывается) и при этом
 * не удерживать подопытного.
 */
function makeFinalizer(tag: string): { flag: FiredFlag; reg: unknown; registered: boolean } {
  const flag: FiredFlag = { fired: false };

  if (typeof FinalizationRegistry === 'undefined') return { flag, reg: null, registered: false };

  const reg = new FinalizationRegistry((seen: string) => {
    if (seen === tag) flag.fired = true;
  });

  return { flag, reg, registered: true };
}

/** Зарегистрировать подопытного, если реестр в этой среде есть. */
function register(reg: unknown, victim: object, tag: string): void {
  if (reg instanceof FinalizationRegistry) reg.register(victim, tag);
}

/* ------------------------------------------------------------------------------------------ *
 * Семь сборок. Каждая — отдельная функция, а не ветка одной: у отдельной функции отдельный
 * скоуп, и подопытный одного случая физически не может попасть в Context другого.
 * ------------------------------------------------------------------------------------------ */

/** 1 · Никто не держит. Объект создан и брошен в той же строке. */
function buildNone(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('none');
  const victim = { tag: 'none', payload: [1, 2, 3] };
  register(reg, victim, 'none');

  return { key: 'none', ref: new WeakRef(victim), extra: null, keep: [reg], flag, registered };
}

/** 2 · Держит обычная переменная. Стенд кладёт объект в `keep` — это и есть та переменная. */
function buildVariable(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('variable');
  const victim = { tag: 'variable', payload: [1, 2, 3] };
  register(reg, victim, 'variable');

  return { key: 'variable', ref: new WeakRef(victim), extra: null, keep: [reg, victim], flag, registered };
}

/** 3 · Ключ в `Map`. Обычная коллекция держит ключ сильно — в этом вся разница с `WeakMap`. */
function buildMap(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('map');
  const victim = { tag: 'map', payload: [1, 2, 3] };
  const map = new Map<object, unknown>();
  map.set(victim, { size: 3 });
  register(reg, victim, 'map');

  return { key: 'map', ref: new WeakRef(victim), extra: null, keep: [reg, map], flag, registered };
}

/** 4 · Ключ в `WeakMap`. Тот же граф, что у случая 3, с единственной заменой слова. */
function buildWeakMapKey(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('weakmap-key');
  const victim = { tag: 'weakmap-key', payload: [1, 2, 3] };
  const weak = new WeakMap<object, unknown>();
  weak.set(victim, { size: 3 });
  register(reg, victim, 'weakmap-key');

  return { key: 'weakmap-key', ref: new WeakRef(victim), extra: null, keep: [reg, weak], flag, registered };
}

/**
 * 5 · Значение в `WeakMap`, ключ жив.
 *
 * Подопытный здесь — **значение**, а не ключ. У записи WeakMap слабый только ключ: пока ключ
 * достижим, значение держится сильно, и слово «weak» в имени к нему не относится.
 */
function buildWeakMapValue(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('weakmap-value');
  const victim = { tag: 'weakmap-value', payload: [1, 2, 3] };
  const key = { tag: 'живой ключ' };
  const weak = new WeakMap<object, unknown>();
  weak.set(key, victim);
  register(reg, victim, 'weakmap-value');

  return {
    key: 'weakmap-value',
    ref: new WeakRef(victim),
    extra: null,
    keep: [reg, weak, key],
    flag,
    registered,
  };
}

/**
 * 6 · Значение ссылается на собственный ключ, снаружи не держит никто.
 *
 * Тот самый случай, который оригинал урока объявлял утечкой: «цикл, слабая ссылка его
 * не разрывает». Цикла здесь нет — есть эфемерон: запись жива тогда и только тогда, когда ключ
 * достижим **иначе**, чем через саму эту запись. Путь, начинающийся внутри записи и ведущий
 * к её ключу, достижимости не создаёт.
 *
 * Поэтому здесь два узла под наблюдением: ключ и значение. Собраться обязаны оба — и показать
 * надо оба, иначе «собрался ключ» можно списать на случайность.
 */
function buildEphemeronCycle(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('ephemeron-cycle');
  const victim = { tag: 'ephemeron-cycle', payload: [1, 2, 3] };
  const value = { self: victim, size: 3 };
  const weak = new WeakMap<object, unknown>();
  weak.set(victim, value);
  register(reg, victim, 'ephemeron-cycle');

  return {
    key: 'ephemeron-cycle',
    ref: new WeakRef(victim),
    extra: { label: 'значение записи', ref: new WeakRef(value) },
    keep: [reg, weak],
    flag,
    registered,
  };
}

/**
 * 7 · Слушатель события.
 *
 * Единственная сборка, где замыкание создаётся намеренно: обработчик читает поле подопытного,
 * значит подопытный попадает в Context, Context — в функцию, функция — в шину. Ровно та
 * цепочка, которую урок называет самой частой причиной утечек.
 *
 * `EventTarget` есть и в браузере, и в Node; запасной вариант — список обработчиков, чтобы
 * случай не пропадал в среде без него.
 */
function buildListener(): CaseSetup {
  const { flag, reg, registered } = makeFinalizer('listener');
  const victim = { tag: 'listener', payload: [1, 2, 3] };
  register(reg, victim, 'listener');

  const handler = () => {
    sink = victim.tag;
  };

  let bus: unknown;
  if (typeof EventTarget === 'function') {
    const target = new EventTarget();
    target.addEventListener('ping', handler);
    bus = target;
  } else {
    bus = [handler];
  }

  return { key: 'listener', ref: new WeakRef(victim), extra: null, keep: [reg, bus], flag, registered };
}

const BUILDERS: Record<ReachCaseKey, () => CaseSetup> = {
  none: buildNone,
  variable: buildVariable,
  map: buildMap,
  'weakmap-key': buildWeakMapKey,
  'weakmap-value': buildWeakMapValue,
  'ephemeron-cycle': buildEphemeronCycle,
  listener: buildListener,
};

/** Построить случай. Дальше с ним работает `chase` из `run.ts`. */
export function buildCase(key: ReachCaseKey): CaseSetup {
  return BUILDERS[key]();
}

/**
 * Описания случаев: подписи, исходник и разбор.
 *
 * ⚠️ В `code` лежит **тот же граф**, что строит соседняя функция. Расхождение между исходником
 * на странице и исполняемым кодом — обычный способ соврать читателю незаметно, поэтому при
 * правке сборки правится и строка.
 */
export const REACH_CASES: ReachCaseSpec[] = [
  {
    key: 'none',
    label: 'никто не держит',
    title: 'Объект создан и брошен',
    holder: 'никто',
    expects: 'collected',
    code: `const victim = { tag: 'none', payload: [1, 2, 3] };
const ref = new WeakRef(victim);
// наружу victim не возвращается — ссылки на него не осталось`,
    why: 'Контрольный случай стенда. Если **он** не собирается, значит не работает само давление, и остальным шести ответам верить нельзя. Объект создан внутри функции и наружу не отдан — путь к нему от корней не начинается нигде.',
  },
  {
    key: 'variable',
    label: 'переменная',
    title: 'Держит обычная ссылка',
    holder: 'массив стенда — он же «ваша переменная»',
    expects: 'held',
    code: `const victim = { tag: 'variable', payload: [1, 2, 3] };
keep.push(victim);   // обычная сильная ссылка
const ref = new WeakRef(victim);`,
    why: 'Базовая линия с другой стороны: пока на объект есть обычная ссылка, сборщик до него не дойдёт **никогда**, сколько ни дави. Но заметьте формулировку вердикта: стенд говорит «не собрался за N попыток», а не «жив». Доказать живость он не умеет — и никто не умеет.',
  },
  {
    key: 'map',
    label: 'ключ Map',
    title: 'Ключ в обычной Map',
    holder: 'сама Map',
    expects: 'held',
    code: `const map = new Map();
map.set(victim, { size: 3 });   // Map держит ключ сильно
const ref = new WeakRef(victim);`,
    why: 'Кеш «по объекту», сделанный на `Map`, — это не кеш, а список всего, что через него прошло. Ключ держится сильно, и `delete` здесь обязан звать тот, кто знает, что объект больше не нужен. Забыл — утечка, и снимок кучи покажет `Map` с растущим числом ключей.',
  },
  {
    key: 'weakmap-key',
    label: 'ключ WeakMap',
    title: 'Ключ в WeakMap',
    holder: 'никто: WeakMap ключ не держит',
    expects: 'collected',
    code: `const weak = new WeakMap();
weak.set(victim, { size: 3 });   // ключ слабый
const ref = new WeakRef(victim);`,
    why: 'Тот же граф, что строкой выше, с единственной заменой слова — и противоположный исход. Запись исчезает вместе с ключом, без чьего-либо участия. Ровно ради этого `WeakMap` и берут: производные данные живут ровно столько, сколько живёт объект, к которому они привязаны.',
  },
  {
    key: 'weakmap-value',
    label: 'значение WeakMap',
    title: 'Значение в WeakMap, ключ жив',
    holder: 'запись: пока жив ключ, значение держится сильно',
    expects: 'held',
    code: `const key = { tag: 'живой ключ' };
const weak = new WeakMap();
weak.set(key, victim);   // слабый только КЛЮЧ
const ref = new WeakRef(victim);
keep.push(key);          // ключ держат снаружи`,
    why: 'Слово «weak» в имени относится к ключу и только к нему. Значение держится обычной сильной ссылкой, пока запись жива, — а запись жива, пока достижим ключ. Отсюда практическое: складывать в `WeakMap` тяжёлые данные под ключ-долгожитель значит держать их столько же, сколько живёт ключ.',
  },
  {
    key: 'ephemeron-cycle',
    label: 'цикл в WeakMap',
    title: 'Значение ссылается на собственный ключ',
    holder: 'никто снаружи; изнутри значение ссылается на ключ',
    expects: 'collected',
    code: `const value = { self: victim, size: 3 };
const weak = new WeakMap();
weak.set(victim, value);   // значение → ключ, снаружи никто
const ref = new WeakRef(victim);
const valueRef = new WeakRef(value);`,
    why: 'Главная правка темы против оригинала — и здесь она не утверждается, а **выполняется**. По ECMA-262 запись WeakMap это эфемерон: она сохраняется тогда и только тогда, когда ключ достижим **иначе**, чем через саму эту запись. Путь, который начинается внутри записи и возвращается к её ключу, достижимости не создаёт — и пара собирается целиком. Поэтому под наблюдением два узла: собраться обязаны оба. Опасен другой расклад — когда значение держат снаружи: тогда через него достижим и ключ.',
  },
  {
    key: 'listener',
    label: 'слушатель',
    title: 'Замыкание в обработчике события',
    holder: 'шина → обработчик → Context → объект',
    expects: 'held',
    code: `const bus = new EventTarget();
bus.addEventListener('ping', () => {
  sink = victim.tag;       // обработчик читает поле объекта
});
const ref = new WeakRef(victim);`,
    why: 'Цепочка длиннее, чем кажется: шина держит функцию, функция держит **весь Context своего скоупа**, а в нём лежит объект. Снять слушатель `removeEventListener` с новым `bind`-обёрткой нельзя — поиск идёт по идентичности. Та же ловушка едва не сломала и сам этот стенд: замыкание, случайно созданное рядом с подопытным, удерживало бы его во **всех** семи случаях.',
  },
];

/** Описание случая по ключу. */
export function caseSpec(key: ReachCaseKey): ReachCaseSpec {
  return REACH_CASES.find((item) => item.key === key) ?? REACH_CASES[0];
}
