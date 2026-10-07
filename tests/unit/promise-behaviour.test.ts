import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { POOL_RUNS, REJECTION_RUNS } from '@/content/lessons/promise-internals/data';

/**
 * Два утверждения темы «Промис изнутри», которые дороже всего проверять глазами.
 *
 * Первое — граница «поздно» у необработанного отказа. Тема утверждает: обработчик, навешенный
 * в том же сливе микрозадач, спасает, а навешенный следующей задачей — уже нет. Это не вывод
 * из спецификации, а поведение, и меряется оно только запуском.
 *
 * ⚠️ Гоняется отдельным процессом, а не внутри vitest: `unhandledRejection` — событие
 * процесса, и перехватывать его в общем прогоне значит ловить чужие отказы и мешать другим
 * тестам. Тем же приёмом (`child_process`) в курсе сняты числа про порядок фаз в Node.
 *
 * Второе — пул конкурентности. Здесь проверяется ровно то, ради чего он в теме: пик
 * одновременно выполняющихся равен лимиту, а не числу задач. Цифры времени из таблицы
 * машинозависимы и не закрепляются — закрепляется **пик**, он от машины не зависит.
 */

/** Прогон в чистом процессе: возвращает его stdout. */
function runNode(source: string): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8',
    timeout: 20_000,
  });
}

describe('необработанный отказ: где проходит граница «поздно»', () => {
  const output = runNode(`
    const fired = [];
    process.on('unhandledRejection', (e) => fired.push(e.message));

    // (а) обработчик в том же сливе микрозадач
    const a = Promise.reject(new Error('спасён'));
    Promise.resolve().then(() => a.catch(() => {}));

    // (б) обработчик в следующей задаче
    const b = Promise.reject(new Error('опоздал'));
    setTimeout(() => b.catch(() => {}), 0);

    setTimeout(() => console.log(JSON.stringify(fired)), 50);
  `);

  const fired: string[] = JSON.parse(output.trim().split('\n').at(-1) as string);

  it('спасает тот, кто успел в том же сливе микрозадач', () => {
    expect(
      fired,
      'отказ, обработанный в том же сливе, не должен поднимать unhandledRejection',
    ).not.toContain('спасён');
  });

  it('обработчик из следующей задачи уже опоздал', () => {
    expect(
      fired,
      'отказ, обработанный следующей задачей, обязан поднять unhandledRejection — ' +
        'на этом стоит тонкое место 07',
    ).toContain('опоздал');
  });

  it('таблица в теме описывает ровно этот прогон', () => {
    // Строк три: спасён, опоздал, не обработан вовсе.
    expect(REJECTION_RUNS.rows).toHaveLength(3);
    expect(REJECTION_RUNS.rows[0][1]).toContain('нет');
    expect(REJECTION_RUNS.rows[1][1]).toContain('да');
  });
});

describe('пул конкурентности против Promise.all', () => {
  /** Тот же пул, что напечатан в теме. */
  async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    const it = items[Symbol.iterator]();
    await Promise.all(
      Array.from({ length: limit }, async () => {
        for (let next = it.next(); !next.done; next = it.next()) await fn(next.value);
      }),
    );
  }

  /**
   * Считает пик одновременно выполняющихся задач.
   *
   * ⚠️ Возвращается объект, и читать `peak` надо **через него** (`meter.peak`), а не
   * деструктуризацией: `const { peak } = makeTask()` фиксирует значение на момент вызова,
   * то есть ноль, и проверка молча становится бессмысленной. На этом тест уже один раз
   * покраснел — и хорошо, что покраснел: ошибка ровно того рода, про который говорит
   * соседняя тема про реактивность, «деструктуризация фиксирует значение».
   */
  function makeMeter() {
    let inFlight = 0;
    const meter = {
      peak: 0,
      task: async () => {
        inFlight++;
        meter.peak = Math.max(meter.peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    };
    return meter;
  }

  it('Promise.all запускает всё разом: пик равен числу задач', async () => {
    const meter = makeMeter();
    await Promise.all(Array.from({ length: 50 }, () => meter.task()));
    expect(meter.peak).toBe(50);
  });

  it('пул держит пик на лимите, сколько бы задач ни было', async () => {
    const meter = makeMeter();
    await pool(Array.from({ length: 50 }, (_, i) => i), 5, () => meter.task());
    expect(
      meter.peak,
      'пул обязан держать ровно limit одновременных — иначе он не пул',
    ).toBe(5);
  });

  it('таблица в теме называет те же два пика', () => {
    expect(POOL_RUNS.rows[0][1]).toContain('50');
    expect(POOL_RUNS.rows[1][1]).toContain('5');
  });
});
