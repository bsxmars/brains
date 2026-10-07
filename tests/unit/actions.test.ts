import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOUNDARY_NUMBERS, MEASURED, PITFALLS, SCENARIOS } from '@/content/delivery/github-actions/data';
import {
  averageCost,
  boundaryBetween,
  lanes,
  parseMarks,
  scenarioById,
  span,
  toSpans,
} from '@/widgets/pipeline-timeline/model/timeline';
import type { Span } from '@/widgets/pipeline-timeline/model/timeline';

/**
 * Числа темы «GitHub Actions: конвейер» — против записи прогона.
 *
 * Тест **не запускает докер и не ходит в сеть**: он разбирает то, что `act` напечатал во время
 * замера. Фикстуры в `tests/fixtures/actions/` — дословные логи прогонов, включая шум: поднятие
 * контейнеров, клонирование действий, предупреждения Node. То, что разбор его не путает
 * с отметками, тоже проверяется здесь.
 *
 * Что именно закрепляется. Не миллисекунды сами по себе — они машинозависимы, и тест, сверяющий
 * их с другой машиной, покраснел бы от смены железа, а не от ошибки (см. «Как меряют в этом
 * курсе» в AGENTS.md). Закрепляются три вещи:
 *
 *   — числа на шкале демо совпадают с записью до миллисекунды: их нельзя поправить руками,
 *     не уронив сборку;
 *   — **отношения**, на которых стоит объяснение: граница джоба дороже границы шага, пять
 *     джобов дороже пяти шагов, у параллельных джобов цена считается от зависимости;
 *   — утверждения текста про то, что переживает границу, — против строк, которые шаги
 *     действительно напечатали.
 */

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/actions/${name}`, import.meta.url), 'utf8');

/** Шаги записи, сведённые по ключу «джоб/шаг», — с ними и сверяются данные темы. */
const recorded = (file: string): Map<string, Span> => {
  const spans = toSpans(parseMarks(fixture(file)));
  return new Map(spans.map((s) => [`${s.job}/${s.step}`, s]));
};

const SEQUENTIAL = scenarioById(SCENARIOS, 'sequential');
const NEEDS = scenarioById(SCENARIOS, 'needs');
const MATRIX = scenarioById(SCENARIOS, 'matrix');

describe('разбор записи прогона', () => {
  it('отметки на шкале демо совпадают с логом act до миллисекунды', () => {
    for (const scenario of SCENARIOS) {
      const log = recorded(scenario.fixture.replace('tests/fixtures/actions/', ''));

      for (const step of scenario.steps) {
        const key = `${step.job}/${step.step}`;
        const match = log.get(key);
        expect(match, `${scenario.id}: в записи нет ${key}`).toBeDefined();
        expect(match?.start, `${scenario.id}: ${key} начало`).toBe(step.start);
        expect(match?.end, `${scenario.id}: ${key} конец`).toBe(step.end);
      }
    }
  });

  it('в записи нет шагов, которых нет на шкале, и наоборот', () => {
    for (const scenario of SCENARIOS) {
      const log = recorded(scenario.fixture.replace('tests/fixtures/actions/', ''));
      const shown = scenario.steps.map((s) => `${s.job}/${s.step}`).sort();
      expect([...log.keys()].sort(), `${scenario.id}`).toEqual(shown);
    }
  });

  it('шум лога в отметки не попадает', () => {
    const raw = fixture('p2-needs.log');

    // В логе есть и клонирование действия, и предупреждения Node, и вывод самих команд.
    expect(raw).toContain('git clone');
    expect(raw).toContain('DeprecationWarning');

    // А в разобранном — только отметки, поставленные шагами.
    const marks = parseMarks(raw);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.every((m) => m.phase === 'begin' || m.phase === 'end')).toBe(true);
    expect(marks.every((m) => Number.isInteger(m.at) && m.at > 0)).toBe(true);
  });

  it('шаги на шкале отсортированы по времени', () => {
    for (const scenario of SCENARIOS) {
      const starts = scenario.steps.map((s) => s.start);
      expect([...starts], `${scenario.id}`).toEqual([...starts].sort((a, b) => a - b));
    }
  });
});

describe('цена границы считается от зависимости, а не от соседа по времени', () => {
  it('cost — это расстояние от конца шага из after до начала этого шага', () => {
    for (const scenario of SCENARIOS) {
      const log = recorded(scenario.fixture.replace('tests/fixtures/actions/', ''));

      for (const step of scenario.steps) {
        if (!step.after) {
          expect(step.boundary, `${scenario.id}: ${step.step}`).toBe('start');
          expect(step.cost).toBe(0);
          continue;
        }

        const previous = log.get(`${step.after.job}/${step.after.step}`);
        expect(previous, `${scenario.id}: нет ${step.after.job}/${step.after.step}`).toBeDefined();
        expect(step.cost, `${scenario.id}: цена границы перед ${step.step}`).toBe(
          step.start - (previous as Span).end,
        );
      }
    }
  });

  it('род границы совпадает с тем, тот же это джоб или другой', () => {
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        const previous = step.after ? { job: step.after.job, step: step.after.step, start: 0, end: 0 } : null;
        expect(boundaryBetween(previous, { job: step.job, step: step.step, start: 0, end: 0 })).toBe(
          step.boundary,
        );
      }
    }
  });

  it('у параллельных джобов цена границы положительна', () => {
    // lint и test идут одновременно: считать их цену друг от друга дало бы отрицательное число.
    for (const scenario of SCENARIOS) {
      for (const step of scenario.steps) {
        expect(step.cost, `${scenario.id}: ${step.job}/${step.step}`).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('главный факт темы: граница джоба дороже границы шага', () => {
  it('средняя граница шага дешевле самой дешёвой границы джоба', () => {
    const stepCost = averageCost(SEQUENTIAL.steps, 'step');
    const jobCosts = NEEDS.steps.filter((s) => s.boundary === 'job').map((s) => s.cost);

    expect(stepCost).toBeGreaterThan(0);
    expect(Math.min(...jobCosts)).toBeGreaterThan(stepCost);
  });

  it('та же работа пятью джобами длится дольше, чем пятью шагами', () => {
    expect(span(NEEDS.steps)).toBeGreaterThan(span(SEQUENTIAL.steps));
  });

  it('числа, названные в тексте, — это и есть длительности записей', () => {
    const sequential = span(SEQUENTIAL.steps);
    const needs = span(NEEDS.steps);

    expect(BOUNDARY_NUMBERS.some((row) => row.v.includes(String(sequential)))).toBe(true);
    expect(BOUNDARY_NUMBERS.some((row) => row.v.includes(String(needs)))).toBe(true);
  });

  it('последовательный сценарий живёт на одной машине, остальные — нет', () => {
    expect(lanes(SEQUENTIAL.steps)).toEqual(['pipeline']);
    expect(lanes(NEEDS.steps).length).toBeGreaterThan(1);
    expect(lanes(MATRIX.steps).filter((job) => job.startsWith('test-'))).toHaveLength(3);
  });
});

describe('что переживает границу — против того, что напечатали шаги', () => {
  it('$GITHUB_ENV не виден в том же шаге, а export не переживает шаг', () => {
    const raw = fixture('a-steps.log');

    expect(raw).toContain('same-step-shell=[]');
    expect(raw).toContain('same-step-expr=[]');
    expect(raw).toContain('FROM_ENV_FILE=[survives]');
    expect(raw).toContain('PLAIN_EXPORT=[]');
    expect(raw).toContain('STEP_LEVEL=[]');
    expect(raw).toContain('JOB_LEVEL=[job]');
  });

  it('cd не переживает шаг, а файл вне рабочей директории переживает', () => {
    const raw = fixture('a-steps.log');

    expect(raw).toContain('cwd-at-end-of-step=/tmp');
    expect(raw).toContain('file in /tmp: still there');
    // Следующий шаг начался не в /tmp, а в рабочей директории.
    expect(raw).toMatch(/cwd=(?!\/tmp)/);
  });

  it('между джобами не едет ни файл, ни $GITHUB_ENV, а необъявленный outputs пуст', () => {
    const raw = fixture('b-jobs.log');

    expect(raw).toContain('needs.build.outputs.declared=[built-in-job-A]');
    expect(raw).toContain('needs.build.outputs.undeclared_attempt=[]');
    expect(raw).toContain('env file from job A=[]');
    expect(raw).toContain('FILE GONE');
  });

  it('рабочая директория джоба в начале пуста', () => {
    const raw = fixture('n-hash.log');
    expect(raw).toContain('--- ls of GITHUB_WORKSPACE at the very first step ---');
    // Кроме `.` и `..` в ней ничего нет: следом сразу идёт следующий заголовок.
    expect(raw).toMatch(/\| \.\.\s*\n.*--- tracked files/);
  });

  it('демо показывает ровно те замеры, которые есть в записи', () => {
    const needsProbes = NEEDS.steps.flatMap((step) => step.probes ?? []);
    const raw = fixture('p2-needs.log');

    expect(needsProbes.length).toBeGreaterThan(0);
    expect(raw).toContain('lint: env-file from install = [EMPTY]');
    expect(raw).toContain('lint: workspace has work/? [no]');
    expect(raw).toContain('deploy: workspace has dist? [no]');

    // Замер, помеченный «не доехало», обязан быть помечен именно так.
    const lost = needsProbes.filter((probe) => !probe.ok).map((probe) => probe.v);
    expect(lost).toContain('[EMPTY]');
    expect(lost).toContain('[no]');
  });
});

describe('условия и падения', () => {
  it('continue-on-error делает conclusion успешным при провальном outcome', () => {
    const raw = fixture('c-if.log');

    expect(raw).toContain('outcome=[failure]');
    expect(raw).toContain('conclusion=[success]');
    expect(raw).toContain('success() is TRUE after a tolerated failure');
    // Шаг с `if: failure()` в этом джобе не выполнялся.
    expect(raw).not.toContain('failure() is TRUE -- should not print');
  });

  it('после настоящего падения шаги пропускаются, а always выполняется', () => {
    const raw = fixture('c-if.log');

    expect(raw).not.toContain('SHOULD NOT PRINT');
    expect(raw).toContain('always() runs even after a hard failure');
  });

  it('джоб после упавшей зависимости получает skipped, а не failure', () => {
    const raw = fixture('i-skip.log');

    expect(raw).toContain('needs.first.result=[failure]');
    expect(raw).toContain('needs.downstream.result=[skipped]');
    expect(raw).toContain('needs.reporter.result=[success]');
    expect(raw).not.toContain('SHOULD NOT PRINT');
  });
});

describe('подстановка выражений', () => {
  it('значение вклеивается в текст скрипта и выполняется', () => {
    const raw = fixture('f2-inject.log');

    // На диске раннера кавычка закрылась и появилась вторая команда.
    expect(raw).toContain('echo "title is x"; echo INJECTED-AND-EXECUTED; echo ""');
    expect(raw).toContain('INJECTED-AND-EXECUTED');
    // Через переменную окружения тот же текст остался текстом.
    expect(raw).toContain('echo "title is $TITLE"');
    expect(raw).toContain('title is x"; echo INJECTED-AND-EXECUTED; echo "');
  });
});

describe('hashFiles — это не sha256 файла', () => {
  /** Что напечатал движок выражений: `hash_one=[…]`. */
  const printed = (key: string): string => {
    const found = new RegExp(`${key}=\\[([0-9a-f]{64})\\]`).exec(fixture('n-hash.log'));
    if (!found) throw new Error(`В записи нет ${key}`);
    return found[1];
  };

  const sha256 = (input: Buffer): Buffer => createHash('sha256').update(input).digest();

  it('для одного файла это sha256 от байтов его дайджеста', () => {
    // Содержимое файлов задано самим прогоном: printf 'abc' и printf 'def'.
    const digest = sha256(Buffer.from('abc'));

    expect(digest.toString('hex')).not.toBe(printed('hash_one'));
    expect(sha256(digest).toString('hex')).toBe(printed('hash_one'));
  });

  it('для нескольких файлов — sha256 от склейки их дайджестов', () => {
    const first = sha256(Buffer.from('abc'));
    const second = sha256(Buffer.from('def'));

    expect(sha256(Buffer.concat([first, second])).toString('hex')).toBe(printed('hash_two'));
    // Шаблон и явный список дали одно и то же.
    expect(printed('hash_glob')).toBe(printed('hash_two'));
  });

  it('несуществующий путь вырождает ключ в постоянный', () => {
    expect(fixture('h-hash.log')).toContain('full_key=[Linux-node-]');
  });
});

describe('секреты', () => {
  it('точное вхождение маскируется, а производные — нет', () => {
    const raw = fixture('j-secret.log');

    expect(raw).toContain('the secret is ***');
    expect(raw).toContain('through-env ***');
    expect(raw).not.toContain('the secret is hunter2secretvalue');

    // Ровно тот же секрет, преобразованный, доехал до лога открытым текстом.
    expect(raw).toContain(Buffer.from('hunter2secretvalue').toString('base64'));
    expect(raw).toContain('reversed eulavterces2retnuh');
    expect(raw).toContain('first-half hunter');
  });

  it('секрет не становится переменной окружения сам по себе', () => {
    expect(fixture('j-secret.log')).toContain('MY_TOKEN in env? [NO]');
  });
});

describe('матрица', () => {
  it('max-parallel: 2 разложил четыре клетки на две волны', () => {
    // В логе каждая клетка печатает `date +%s.%N`; волны видно по разрыву между ними.
    const stamps = [...fixture('d-matrix.log').matchAll(/\| (\d{10}\.\d+)/g)]
      .map((m) => Number(m[1]) * 1000)
      .sort((a, b) => a - b);

    expect(stamps).toHaveLength(4);

    const insideFirst = stamps[1] - stamps[0];
    const betweenWaves = stamps[2] - stamps[1];
    const insideSecond = stamps[3] - stamps[2];

    // Внутри волны клетки стартуют практически одновременно, между волнами — заметный разрыв.
    expect(betweenWaves).toBeGreaterThan(insideFirst * 10);
    expect(betweenWaves).toBeGreaterThan(insideSecond * 10);
  });

  it('для needs вся матрица — один результат', () => {
    expect(fixture('p3-matrix.log')).toContain('needs.test.result=[success]');
  });

  it('outputs доступны только у прямых зависимостей', () => {
    expect(fixture('p3-matrix.log')).toContain(
      'build: needs.install.outputs.count is not reachable here: []',
    );
    expect(fixture('p2-needs.log')).toContain('build: count came from install as []');
  });
});

describe('состав темы', () => {
  it('тонких мест не меньше двенадцати и номера не повторяются', () => {
    expect(PITFALLS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(PITFALLS.map((p) => p.n)).size).toBe(PITFALLS.length);
    expect(PITFALLS.every((p) => p.t.length > 0 && p.d.length > 0)).toBe(true);
  });

  it('у каждого сценария демо своя запись и свой файл конвейера', () => {
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((s) => s.fixture)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.every((s) => s.workflow.endsWith('.yml'))).toBe(true);
  });

  it('каждый замер в сводке указывает, в какой записи он лежит', () => {
    expect(MEASURED.length).toBeGreaterThan(0);
    expect(MEASURED.every((row) => row.where.length > 0)).toBe(true);
  });
});
