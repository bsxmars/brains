import type { GenLogEntry, GenMachine, GenPhase } from './types';

/**
 * Генератор как машина состояний — чистый редьюсер над `dialog()` из урока.
 *
 * Логика отделена от компонента, чтобы её можно было прогнать тестом против настоящего
 * генератора: демо обязано отвечать ровно то же, что движок. Всё, что здесь закодировано,
 * проверено запуском в Node 24.11, и три вещи из проверенного расходятся с интуицией:
 *
 *   1. аргумент **первого** `next()` теряется — генератор ещё не стоит ни на каком `yield`,
 *      значению некуда попасть;
 *   2. `finally` выполняется, только если генератор уже **вошёл** в `try`. На suspended-start
 *      ни `throw()`, ни `return()` его не запускают;
 *   3. «очистка» печатается **до** того, как вызов вернёт значение: `finally` отрабатывает
 *      синхронно внутри `next()`/`return()`, а не после.
 */
export function createMachine(): GenMachine {
  return { phase: 0, name: null, log: [] };
}

const push = (m: GenMachine, phase: GenPhase, entry: GenLogEntry, name = m.name): GenMachine => ({
  phase,
  name,
  log: [...m.log, entry],
});

/** Аргумент в подпись вызова: `next()` против `next('Аня')`. */
const call = (fn: string, v: string | number | null) =>
  `${fn}(${v === null ? '' : JSON.stringify(v)})`;

export function callNext(m: GenMachine, v: string | number | null): GenMachine {
  if (m.phase === 0) {
    return push(m, 1, {
      call: call('next', v),
      res: "→ { value: 'Как тебя зовут?', done: false }",
      note:
        v === null
          ? 'Тело выполнилось до первого yield и замерло. Сам вызов dialog() не выполнял ни одной строки.'
          : 'Аргумент первого next() ТЕРЯЕТСЯ: генератор ещё не стоит ни на каком yield, значению некуда попасть.',
      tone: v === null ? undefined : 'warn',
    });
  }

  if (m.phase === 1) {
    const name = v === null ? 'undefined' : String(v);
    return push(
      m,
      2,
      {
        call: call('next', v),
        res: `→ { value: 'Привет, ${name}…', done: false }`,
        note: 'Переданное значение стало значением выражения yield, на котором стоял генератор. Ровно это и делает его корутиной, а не источником значений.',
      },
      name,
    );
  }

  if (m.phase === 2) {
    return push(m, 3, {
      call: call('next', v),
      res: `→ { value: '${m.name}, ${v === null ? 'undefined' : v}', done: true }`,
      note: 'Дошли до return. Блок finally отработал синхронно внутри этого вызова — «очистка» напечаталась ДО того, как next() вернул значение. Генератор закрыт.',
    });
  }

  return push(m, 3, {
    call: call('next', v),
    res: '→ { value: undefined, done: true }',
    note: 'Исчерпанный генератор отвечает так навсегда. Он одноразовый: перезапустить его нельзя, можно только создать новый.',
    tone: 'warn',
  });
}

export function callThrow(m: GenMachine): GenMachine {
  if (m.phase === 0) {
    return push(m, 3, {
      call: 'throw(new Error)',
      res: '✗ ошибка вылетает наружу',
      note: 'Генератор ещё не вошёл в try — finally не выполнялся, «очистки» не было. Генератор закрыт.',
      tone: 'err',
    });
  }

  if (m.phase === 3) {
    return push(m, 3, {
      call: 'throw(new Error)',
      res: '✗ ошибка вылетает наружу',
      note: 'Генератор уже закрыт, ловить некому, finally тоже не выполняется.',
      tone: 'err',
    });
  }

  return push(m, 3, {
    call: 'throw(new Error)',
    res: '✗ брошено ВНУТРИ, в точке паузы',
    note: 'Не «бросить снаружи». Будь внутри try/catch вокруг yield — генератор поймал бы и продолжил. Здесь catch нет: сработал finally («очистка»), и ошибка ушла наружу.',
    tone: 'err',
  });
}

export function callReturn(m: GenMachine): GenMachine {
  const note =
    m.phase === 0
      ? 'Генератор не входил в try — finally не выполнялся. Значение просто отдано наружу.'
      : m.phase === 3
        ? 'Уже закрыт, просто отдаёт значение. Ошибки нет.'
        : 'Как будто в точке паузы выполнили return. Блоки finally отрабатывают — «очистка». Ровно это делает for…of при break.';

  return push(m, 3, {
    call: "return('стоп')",
    res: "→ { value: 'стоп', done: true }",
    note,
    tone: 'warn',
  });
}
