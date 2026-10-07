import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEASURED, SIZE_BARS, BUILD_VARIANTS } from '@/content/delivery/docker/data';
import {
  appLayers,
  deltaOverBase,
  findLayer,
  parseHistory,
  parseSize,
  sumBytes,
} from '@/widgets/layer-cache/model/history';

/**
 * Числа темы «Docker: образ и слои», закреплённые разбором снятого вывода.
 *
 * ⚠️ **Тест не запускает Docker и не должен.** Он проверяет две вещи: что разбор вывода
 * `docker history` считает правильно и что числа, которые читатель видит на странице,
 * следуют из сырого замера, а не набраны руками. Сырьё лежит в `tests/fixtures/docker/`
 * ровно в том виде, в каком его напечатал демон: `docker history --format '{{json .}}'`
 * и `docker image inspect --format '{{.Size}}'`.
 *
 * Почему это устроено так, а не сравнением с эталонными числами в самом тесте: замер,
 * переписанный в тест руками, проверяет аккуратность переписывания, а не замер. Здесь
 * единственный источник правды — фикстура, и страница сверяется с ней.
 */
const FIXTURES = new URL('../fixtures/docker/', import.meta.url);

const read = (name: string) => readFileSync(new URL(name, FIXTURES), 'utf8');

const sizes = JSON.parse(read('image-sizes.json')) as Record<string, number>;
const alpine = parseHistory(read('history-alpine.jsonl'));
const multi = parseHistory(read('history-multi.jsonl'));

/**
 * Длина `docker history` базового образа `node:22-alpine`.
 *
 * Отметки «отсюда начинается база» в истории готового образа нет — строки базы ничем
 * не отличаются от своих, поэтому число приходится знать снаружи. Что оно верное,
 * проверяется отдельным тестом ниже: у обоих образов хвост обязан совпадать дословно.
 */
const BASE_ROWS = 9;

describe('разбор размера слоя', () => {
  it('читает десятичные единицы Docker', () => {
    // У Docker `MB` — это 10⁶, а не 2²⁰. Сложение слоёв базы сходится только в этой системе.
    expect(parseSize('0B')).toBe(0);
    expect(parseSize('235B')).toBe(235);
    expect(parseSize('30.7kB')).toBe(30_700);
    expect(parseSize('6.86MB')).toBe(6_860_000);
    expect(parseSize('1.13GB')).toBe(1_130_000_000);
  });

  it('не делает вид, что разобрал мусор', () => {
    // Молча вернуть 0 на нечитаемой строке — это способ получить «образ похудел» из опечатки.
    expect(() => parseSize('много')).toThrow();
    expect(() => parseSize('12PB')).toThrow();
  });
});

describe('разбор docker history', () => {
  it('читает фикстуры целиком и сверху вниз', () => {
    expect(alpine).toHaveLength(15);
    expect(multi).toHaveLength(16);
    // История печатается новыми слоями вверх, поэтому первой идёт последняя инструкция.
    expect(alpine[0].createdBy).toContain('CMD');
    expect(multi[0].createdBy).toContain('CMD');
  });

  it('оба образа стоят на одной базе', () => {
    // Это и подтверждает BASE_ROWS: хвосты обязаны совпасть дословно, вместе с весами.
    const tail = (layers: typeof alpine) => layers.slice(layers.length - BASE_ROWS);
    expect(tail(multi)).toEqual(tail(alpine));
  });

  it('видит слои конфига, не кладущие ни одного файла', () => {
    // `0B` — это не «мало», а «нисколько»: WORKDIR и ENV меняют только конфиг образа.
    const workdir = findLayer(multi, 'WORKDIR');
    const user = findLayer(multi, 'USER node');
    expect(workdir?.bytes).toBe(0);
    expect(user?.bytes).toBe(0);
  });
});

describe('арифметика размеров', () => {
  const alpineDelta = deltaOverBase(sizes['lesson-docker-size:alpine'], sizes['node:22-alpine']);
  const multiDelta = deltaOverBase(sizes['lesson-docker-size:multi'], sizes['node:22-alpine']);

  it('сумма слоёв сходится с inspect в пределах округления', () => {
    /**
     * Точного равенства здесь быть не может, и это свойство `docker history`, а не погрешность
     * теста: колонка `SIZE` округлена до трёх значащих цифр. Поэтому вклад приложения считают
     * вычитанием по `inspect`, а сложение годится только на проверку порядка величины.
     */
    const bySum = sumBytes(appLayers(alpine, BASE_ROWS));
    expect(Math.abs(bySum - alpineDelta) / alpineDelta).toBeLessThan(0.01);
  });

  it('многоступенчатая сборка убирает из образа зависимости сборки', () => {
    // Отношение, а не байты: абсолютные числа поедут от версии typescript, отношение — нет.
    expect(alpineDelta / multiDelta).toBeGreaterThan(5);
    expect(alpineDelta).toBeGreaterThan(30_000_000);
    expect(multiDelta).toBeLessThan(6_000_000);
  });

  it('самый тяжёлый слой приложения — установка зависимостей', () => {
    const heaviest = [...appLayers(alpine, BASE_ROWS)].sort((a, b) => b.bytes - a.bytes)[0];
    expect(heaviest.createdBy).toContain('npm ci');

    // И он же худеет в многоступенчатой сборке — потому что ставится без devDependencies.
    const prod = findLayer(multi, 'npm ci --omit=dev');
    const all = findLayer(alpine, 'npm ci');
    expect(prod!.bytes).toBeLessThan(all!.bytes / 5);
  });

  it('результат сборки на порядки легче инструментов, которыми он получен', () => {
    const dist = findLayer(multi, 'COPY /app/dist');
    const deps = findLayer(multi, 'npm ci --omit=dev');
    expect(dist!.bytes).toBeLessThan(deps!.bytes / 1000);
  });
});

describe('числа страницы совпадают со снятыми', () => {
  it('MEASURED — это фикстура, а не набранные руками числа', () => {
    expect(MEASURED.base['node:22']).toBe(sizes['node:22']);
    expect(MEASURED.base['node:22-slim']).toBe(sizes['node:22-slim']);
    expect(MEASURED.base['node:22-alpine']).toBe(sizes['node:22-alpine']);
    expect(MEASURED.images.full).toBe(sizes['lesson-docker-size:full']);
    expect(MEASURED.images.slim).toBe(sizes['lesson-docker-size:slim']);
    expect(MEASURED.images.alpine).toBe(sizes['lesson-docker-size:alpine']);
    expect(MEASURED.images.multi).toBe(sizes['lesson-docker-size:multi']);
  });

  it('вклад приложения одинаков на всех трёх базах', () => {
    /**
     * Главное утверждение пятого раздела: меняя базу, вы меняете фундамент, а не постройку.
     * Проверяется прямо — три разницы обязаны сойтись между собой с точностью до килобайт.
     */
    const deltas = [
      MEASURED.images.full - MEASURED.base['node:22'],
      MEASURED.images.slim - MEASURED.base['node:22-slim'],
      MEASURED.images.alpine - MEASURED.base['node:22-alpine'],
    ];
    for (const delta of deltas) {
      expect(Math.abs(delta - deltas[0])).toBeLessThan(1000);
    }
  });

  it('полосы диаграммы показывают те же числа, что inspect', () => {
    // Диаграмма рисуется в мегабайтах — сверяем перевод, чтобы подпись не разъехалась с осью.
    const bar = (label: string) => SIZE_BARS.find((b) => b.label === label)!;
    expect(bar('node:22').value * 1e6).toBeCloseTo(MEASURED.base['node:22'], -5);
    expect(bar('node:22-alpine').value * 1e6).toBeCloseTo(MEASURED.base['node:22-alpine'], -5);
    expect(bar('многоступенчатая сборка').value * 1e6).toBeCloseTo(MEASURED.images.multi, -5);
  });

  it('`.dockerignore` срезает контекст на четыре порядка', () => {
    expect(MEASURED.context.without / MEASURED.context.with).toBeGreaterThan(10_000);
  });
});

describe('данные демо не противоречат сами себе', () => {
  const runs = BUILD_VARIANTS.flatMap((variant) =>
    variant.runs.map((run) => ({ variant: variant.key, ...run })),
  );

  it('у каждого варианта есть прогон на каждый сценарий', () => {
    for (const variant of BUILD_VARIANTS) {
      expect(variant.runs.map((r) => r.change).sort()).toEqual(['none', 'pkg', 'src']);
    }
  });

  it('слой из кеша не стоит времени', () => {
    // Иначе демо показывало бы «взято из кеша за 2 секунды» — а это и есть то, чего не бывает.
    for (const run of runs) {
      for (const step of run.steps) {
        if (step.state === 'cached') expect(step.seconds).toBe(0);
      }
    }
  });

  it('сумма шагов не превышает время всей сборки', () => {
    // Снаружи сборка всегда дольше суммы шагов: контекст, разбор файла и экспорт образа.
    for (const run of runs) {
      const steps = run.steps.reduce((sum, step) => sum + step.seconds, 0);
      expect(steps).toBeLessThanOrEqual(run.total + 1e-9);
    }
  });

  it('промах обрушивает всё, что ниже по файлу', () => {
    /**
     * Центральное утверждение темы, и его легко нарушить, правя данные руками: после первого
     * пересобранного слоя не может стоять слой «из кеша».
     */
    for (const run of runs) {
      const first = run.steps.findIndex((step) => step.state === 'rebuilt');
      if (first === -1) continue;
      for (const step of run.steps.slice(first)) {
        expect(step.state).toBe('rebuilt');
      }
    }
  });

  it('правка кода переживает установку зависимостей только при правильном порядке', () => {
    const npmStep = (variantKey: string, change: string) => {
      const variant = BUILD_VARIANTS.find((v) => v.key === variantKey)!;
      const run = variant.runs.find((r) => r.change === change)!;
      return run.steps.find((s) => s.instruction.includes('npm ci'))!;
    };

    // Ровно та разница, ради которой существует третий раздел.
    expect(npmStep('good', 'src').state).toBe('cached');
    expect(npmStep('bad', 'src').state).toBe('rebuilt');

    // А правку манифеста обязаны заметить оба: тут переустановка законна.
    expect(npmStep('good', 'pkg').state).toBe('rebuilt');
    expect(npmStep('bad', 'pkg').state).toBe('rebuilt');
  });
});
