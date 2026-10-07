import type { Fire } from './types';

/**
 * Модель времени для debounce и throttle: вместо настоящих таймеров — дискретная симуляция.
 *
 * На каждом обороте выбирается ближайшее из двух событий — очередной вызов обёртки или
 * срабатывание запланированного таймера, — и обрабатывается то, что случилось раньше.
 * Так шкала считается мгновенно и одинаково при каждом рендере: демо показывает результат,
 * а не воспроизводит его в реальном времени.
 *
 * Обе функции перенесены из `legacy/extracted/callbacks/logic.js` без изменений. Их вывод
 * сверен с разбором по шагам из конспекта (Node 24.11):
 *
 *   throttle [0, 40, 80, 300], wait 100, leading+trailing → 0(arg 0), 100(arg 80), 300(arg 300);
 *   debounce [0, 40, 80, 300], wait 100, только trailing  → 180(arg 80), 400(arg 300);
 *   debounce [0, 50, 250],     wait 100, leading+trailing → 0(arg 0), 150(arg 50), 250(arg 250).
 *
 * `guard` — предохранитель от бесконечного цикла: модель времени легко зациклить опечаткой
 * в условии, а виснуть на странице она права не имеет.
 */
const GUARD = 200;

export function simulateDebounce(
  times: number[],
  wait: number,
  leading: boolean,
  trailing: boolean,
): Fire[] {
  let timer: number | null = null;
  let lastArgs: number | null = null;
  let i = 0;
  const fires: Fire[] = [];
  let guard = 0;

  while ((i < times.length || timer !== null) && guard++ < GUARD) {
    const nextEvent = i < times.length ? times[i] : Infinity;
    const nextTimer = timer !== null ? timer : Infinity;

    if (nextTimer <= nextEvent) {
      const firedAt = timer as number;
      timer = null;
      // lastArgs === null означает, что этот вызов уже отработал через leading: хвост не нужен,
      // иначе одиночный вызов при leading + trailing сработал бы дважды.
      if (trailing && lastArgs !== null) {
        fires.push({ t: firedAt, arg: lastArgs, kind: 'trailing' });
        lastArgs = null;
      }
    } else {
      const t = times[i];
      i++;
      const isFirstInWindow = timer === null;
      lastArgs = t;
      timer = t + wait; // каждый вызов сдвигает срок: debounce ждёт тишины
      if (leading && isFirstInWindow) {
        fires.push({ t, arg: t, kind: 'leading' });
        lastArgs = null;
      }
    }
  }

  return fires;
}

export function simulateThrottle(
  times: number[],
  wait: number,
  leading: boolean,
  trailing: boolean,
): Fire[] {
  // Вырожденная пара флагов. Раньше модель здесь всё-таки срабатывала, когда разрыв между
  // событиями превышал окно, — и расходилась с реализацией: у lodash `throttle` сводится
  // к `debounce` с `maxWait`, где вызов делают только ветки leading и trailing, а обе
  // выключены. Проверено запуском настоящего lodash на последовательности с разрывами
  // 0 / 120 / 260 мс при wait 100: ни одного вызова.
  if (!leading && !trailing) return [];

  let lastInvoke: number | null = null;
  let timer: number | null = null;
  let lastArgs: number | null = null;
  let i = 0;
  const fires: Fire[] = [];
  let guard = 0;

  while ((i < times.length || timer !== null) && guard++ < GUARD) {
    const nextEvent = i < times.length ? times[i] : Infinity;
    const nextTimer = timer !== null ? timer : Infinity;

    if (nextTimer <= nextEvent) {
      const firedAt = timer as number;
      timer = null;
      if (lastArgs !== null) {
        fires.push({ t: firedAt, arg: lastArgs, kind: 'trailing' });
        lastInvoke = firedAt;
        lastArgs = null;
      }
    } else {
      const t = times[i];
      i++;
      // При leading: false делаем вид, что fn только что уже вызывали, — тогда первое
      // срабатывание уезжает в хвост окна.
      if (lastInvoke === null && !leading) lastInvoke = t;
      const remaining = lastInvoke === null ? -1 : wait - (t - lastInvoke);
      lastArgs = t;

      if (remaining <= 0) {
        timer = null;
        fires.push({ t, arg: t, kind: 'leading' });
        lastInvoke = t;
        lastArgs = null;
      } else if (trailing && timer === null) {
        // Хвост планируется ровно один на окно: повторные вызовы внутри окна только
        // обновляют lastArgs, поэтому сработает он с последними аргументами.
        timer = t + remaining;
      }
    }
  }

  return fires;
}
