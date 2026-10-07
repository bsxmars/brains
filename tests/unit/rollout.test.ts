import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildFrames,
  estimateSeconds,
  hasTrafficGap,
  limits,
  resolveSurge,
  resolveUnavailable,
  summarize,
} from '@/widgets/rollout-timeline/model/rollout';
import type { Amount, RolloutParams } from '@/widgets/rollout-timeline/model/types';

/**
 * Арифметика перекатывания и сверка её со снятой записью.
 *
 * Кластер здесь не поднимается: запись сделана один раз (kind 0.33, Kubernetes 1.37.0)
 * и лежит в `tests/fixtures/rollout-capture.json` — три прогона, каждый снят опросом
 * `kubectl get pods` примерно раз в 0.07 с и одновременным опросом сервиса из пода-клиента.
 *
 * Тест сторожит две разные вещи, и обе ломались бы молча:
 *   1) **правила**, по которым демо досчитывает нескольковшие конфигурации, — округление
 *      процентов, потолок живых подов, пол доступности, число волн;
 *   2) **согласие модели с записью** — если завтра формулу подправят «на глаз», расхождение
 *      со снятыми числами всплывёт здесь, а не на странице.
 *
 * ⚠️ Секунды сверяются с допуском, а не дословно: время старта процесса машинозависимо.
 * Дословно сверяются только целые поды — их число правилами задано жёстко.
 */

interface CaptureFrame {
  t: number;
  newTotal: number;
  newReady: number;
  oldTotal: number;
  oldReady: number;
  terminating: number;
}

interface CaptureRun {
  replicas: number;
  maxSurge: Amount;
  maxUnavailable: Amount;
  readinessProbe: boolean;
  bootDelaySeconds: number;
  rolloutStatusSeconds: number;
  maxLivePods: number;
  maxPodObjects: number;
  minAvailable: number;
  clientProbes: number;
  clientFailures: number;
  firstFailure: number | null;
  lastFailure: number | null;
  frames: CaptureFrame[];
}

const CAPTURE: Record<string, CaptureRun> = JSON.parse(
  readFileSync(new URL('../fixtures/rollout-capture.json', import.meta.url), 'utf8'),
);

/** Константы часов — те самые, что сняты прогоном и стоят в данных темы. */
const CLOCK = { bootSeconds: 8, syncSeconds: 0.4, terminateSeconds: 1 };

const paramsOf = (run: CaptureRun): RolloutParams => ({
  replicas: run.replicas,
  maxSurge: run.maxSurge,
  maxUnavailable: run.maxUnavailable,
  readiness: run.readinessProbe,
  ...CLOCK,
});

describe('проценты стратегии округляются в разные стороны', () => {
  /**
   * Это не придирка к формулировке: при трёх репликах те же «25 % / 25 %» дают запас 1
   * и просадку 0 — перекатывание идёт вообще без потери мощности и втрое дольше. Замер C
   * ровно это и показал: живых не больше 4, доступных ни разу не меньше 3.
   */
  const cases: [number, Amount, number, number][] = [
    // реплик, значение, ожидаемый maxSurge, ожидаемый maxUnavailable
    [4, '25%', 1, 1],
    [3, '25%', 1, 0],
    [2, '25%', 1, 0],
    [1, '25%', 1, 0],
    [10, '25%', 3, 2],
    [10, '30%', 3, 3],
    [4, 2, 2, 2],
    [4, 0, 0, 0],
  ];

  for (const [replicas, value, surge, unavailable] of cases) {
    it(`${replicas} реплик и ${value}: запас ${surge}, просадка ${unavailable}`, () => {
      expect(resolveSurge(value, replicas)).toBe(surge);
      expect(resolveUnavailable(value, replicas)).toBe(unavailable);
    });
  }

  it('оба нуля запрещены — такая стратегия не может сдвинуться с места', () => {
    expect(() => limits({ replicas: 4, maxSurge: 0, maxUnavailable: 0 })).toThrow();
  });
});

describe('границы перекатывания', () => {
  it('по умолчанию при четырёх репликах — живых не больше пяти, доступных не меньше трёх', () => {
    const l = limits({ replicas: 4, maxSurge: '25%', maxUnavailable: '25%' });
    expect(l).toMatchObject({ surge: 1, unavailable: 1, maxLive: 5, minAvailable: 3, batch: 2, waves: 2 });
  });

  it('maxUnavailable: 0 удлиняет выкат, но не роняет мощность', () => {
    const l = limits({ replicas: 4, maxSurge: 1, maxUnavailable: 0 });
    expect(l).toMatchObject({ maxLive: 5, minAvailable: 4, batch: 1, waves: 4 });
  });

  it('maxSurge: 0 не даёт занять лишнего места — платит доступность', () => {
    const l = limits({ replicas: 4, maxSurge: 0, maxUnavailable: 1 });
    expect(l).toMatchObject({ maxLive: 4, minAvailable: 3, batch: 1, waves: 4 });
  });
});

describe('ни один кадр не выходит за объявленные границы', () => {
  const strategies: [Amount, Amount][] = [
    ['25%', '25%'],
    [1, 0],
    [0, 1],
    [2, 1],
    ['50%', '0%'],
    ['100%', '25%'],
  ];

  for (const replicas of [1, 2, 3, 4, 5, 8]) {
    for (const [maxSurge, maxUnavailable] of strategies) {
      const params: RolloutParams = { replicas, maxSurge, maxUnavailable, readiness: true, ...CLOCK };
      const l = limits(params);
      if (l.surge === 0 && l.unavailable === 0) continue;

      it(`${replicas} реплик, surge ${maxSurge}, unavailable ${maxUnavailable}`, () => {
        const frames = buildFrames(params);
        for (const frame of frames) {
          expect(frame.live).toBeLessThanOrEqual(l.maxLive);
          expect(frame.available).toBeGreaterThanOrEqual(l.minAvailable);
        }
        // Замена обязана дойти до конца: в последнем кадре старых подов нет.
        const last = frames[frames.length - 1];
        expect(last.pods.filter((p) => p.gen === 'new')).toHaveLength(replicas);
        expect(last.pods.some((p) => p.gen === 'old')).toBe(false);
      });
    }
  }
});

describe('модель сходится со снятой записью', () => {
  for (const [tag, run] of Object.entries(CAPTURE)) {
    describe(`прогон ${tag}: ${run.replicas} реплик, readiness ${run.readinessProbe ? 'есть' : 'нет'}`, () => {
      it('запись сама по себе не нарушает правил', () => {
        const l = limits(run);
        const live = run.frames.map((f) => f.newTotal + f.oldTotal);
        const available = run.frames.filter((f) => f.t >= 0).map((f) => f.newReady + f.oldReady);
        expect(Math.max(...live)).toBe(run.maxLivePods);
        expect(Math.min(...available)).toBe(run.minAvailable);
        expect(run.maxLivePods).toBe(l.maxLive);
        expect(run.minAvailable).toBe(l.minAvailable);
      });

      it('модель предсказывает те же целые поды', () => {
        const model = summarize(buildFrames(paramsOf(run)));
        expect(model.maxLive).toBe(run.maxLivePods);
        expect(model.minAvailable).toBe(run.minAvailable);
      });

      it('модель предсказывает время с точностью до пары секунд', () => {
        const predicted = estimateSeconds(paramsOf(run));
        expect(Math.abs(predicted - run.rolloutStatusSeconds)).toBeLessThanOrEqual(3);
      });
    });
  }

  /**
   * Главное утверждение темы, и оно проверяется сравнением двух прогонов, а не одним.
   * Прогоны `a` и `b` отличаются ровно одним полем манифеста — наличием readiness-пробы.
   * Kubernetes в обоих отрапортовал успех и одни и те же «доступные» числа; клиент
   * увидел совершенно разное.
   */
  it('без readiness-пробы Kubernetes рапортует то же, а клиент видит отказы', () => {
    const withProbe = CAPTURE.a;
    const without = CAPTURE.b;

    expect(withProbe.minAvailable).toBe(without.minAvailable);
    expect(withProbe.maxLivePods).toBe(without.maxLivePods);

    // Выкат «успел» за секунду — потому что ждать было нечего.
    expect(without.rolloutStatusSeconds).toBeLessThan(2);
    expect(withProbe.rolloutStatusSeconds).toBeGreaterThan(10);

    // А отказов стало на порядок больше, и все они уложились в окно старта процесса.
    expect(without.clientFailures).toBeGreaterThan(withProbe.clientFailures * 5);
    expect(without.lastFailure ?? 0).toBeLessThanOrEqual(without.bootDelaySeconds + 1);
  });

  it('модель показывает провал трафика ровно там, где его показал замер', () => {
    expect(hasTrafficGap(buildFrames(paramsOf(CAPTURE.b)))).toBe(true);
    expect(hasTrafficGap(buildFrames(paramsOf(CAPTURE.a)))).toBe(false);
    expect(hasTrafficGap(buildFrames(paramsOf(CAPTURE.c)))).toBe(false);
  });

  it('завершающиеся поды видны в kubectl get pods сверх потолка живых', () => {
    // Потолок `maxSurge` считает только не завершающиеся поды, а `kubectl get pods`
    // печатает и те, что доживают grace-период: в записи строк было семь при потолке пять.
    expect(CAPTURE.a.maxPodObjects).toBeGreaterThan(CAPTURE.a.maxLivePods);
    expect(CAPTURE.a.maxPodObjects).toBe(7);
    expect(CAPTURE.a.maxLivePods).toBe(5);
  });
});
