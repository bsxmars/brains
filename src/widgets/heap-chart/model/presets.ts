import type { HeapPreset } from './types';

/**
 * Пресеты графика heap во времени. Лежат в виджете, а не в уроке, сознательно: тот же график
 * нужен разговору про профилирование и про память Node в проде — как линейка тиков нужна
 * сразу двум урокам. Урок передаёт их пропом, свои данные не заводит.
 *
 * Пила строится, а не рисуется руками: у каждого цикла есть нижняя огибающая (минимум после
 * Major GC) и амплитуда. Поэтому «огибающая ровная» и «огибающая ползёт вверх» отличаются
 * ровно одним массивом чисел, а не двумя разными картинками.
 */

/** Шагов внутри одного цикла между Major GC. */
const CYCLE = 8;

/**
 * Пила по нижней огибающей: внутри цикла память растёт, мелкие зубцы — Scavenge,
 * падение в конце цикла — Major GC к следующему минимуму.
 */
function sawtooth(floors: number[], amplitude: number) {
  const points: number[] = [];
  const gc: HeapPreset['gc'] = [];

  // Базовый замер: минимум сразу после принудительной сборки. С него начинается протокол,
  // поэтому он обязан попасть в огибающую — иначе первый минимум выпадает из сравнения.
  points.push(floors[0]);
  gc.push({ at: 0, kind: 'major' });

  for (let cycle = 1; cycle < floors.length; cycle++) {
    const floor = floors[cycle - 1];
    for (let i = 0; i < CYCLE; i++) {
      const rise = (amplitude * (i + 1)) / CYCLE;
      // Каждый второй шаг — Scavenge: небольшой откат, молодое поколение опустело.
      const scavenged = i % 2 === 1;
      points.push(Math.round(floor + rise - (scavenged ? amplitude * 0.14 : 0)));
      if (scavenged) gc.push({ at: points.length - 1, kind: 'minor' });
    }
    // Major GC: память падает ровно на минимум этого цикла. Каждая точка Major GC —
    // элемент огибающей, и другого источника у неё нет.
    points.push(floors[cycle]);
    gc.push({ at: points.length - 1, kind: 'major' });
  }

  return { points, gc };
}

const HEALTHY = sawtooth([200, 200, 200, 200, 200], 700);
const LEAKING = sawtooth([200, 206, 212, 218, 224], 700);

export const HEAP_PRESETS: HeapPreset[] = [
  {
    key: 'ok',
    label: 'норма',
    tone: 'ok',
    ...HEALTHY,
    markers: [
      { at: CYCLE + 1, label: 'серия из 20 переходов' },
      { at: (CYCLE + 1) * 3, label: 'та же серия ещё раз' },
    ],
    verdict:
      'Пики доходят до 800 с лишним МБ, но после каждого Major GC память возвращается к тем же 200 МБ. Утечки нет: сколько бы серий ни прогнали, минимум стоит на месте.',
  },
  {
    key: 'leak',
    label: 'утечка',
    tone: 'err',
    ...LEAKING,
    markers: [
      { at: CYCLE + 1, label: 'серия из 20 переходов' },
      { at: (CYCLE + 1) * 3, label: 'та же серия ещё раз' },
    ],
    verdict:
      'Пики почти те же — а минимум после каждой сборки выше предыдущего на одну и ту же величину. Каждая серия оставляет за собой постоянный след. Вот это диагноз.',
  },
];
