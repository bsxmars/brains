import { describe, expect, it } from 'vitest';
import { createRuntime } from '@/shared/lib/promise-sim';

/**
 * Тезис раздела 1 — «подписка ничего не стоит, тики тратит резолв» — проверяется здесь же,
 * на той самой модели, которой управляет демо. Если однажды подписка начнёт стоить тик,
 * урок соврёт читателю в первом же абзаце, и тест обязан это остановить.
 */
describe('живой объект промиса', () => {
  it('подписка на pending — запись в список, ноль микрозадач', () => {
    const rt = createRuntime();
    const promise = rt.pending();

    rt.performPromiseThen(promise, 'r1');
    rt.performPromiseThen(promise, 'r2');
    rt.performPromiseThen(promise, 'r3');

    expect(promise.reactions).toHaveLength(3);
    expect(rt.queue).toHaveLength(0);
    expect(rt.tick).toBe(0);
  });

  it('резолв выкладывает весь список в очередь, и только тогда тратятся тики', () => {
    const rt = createRuntime();
    const promise = rt.pending();
    const ran: string[] = [];

    rt.performPromiseThen(promise, 'r1', { then: () => ran.push('r1') });
    rt.performPromiseThen(promise, 'r2', { then: () => ran.push('r2') });

    rt.resolvePromise(promise, 'value');
    expect(promise.state).toBe('fulfilled');
    expect(promise.reactions, 'списки после резолва очищаются').toHaveLength(0);
    expect(rt.queue).toHaveLength(2);
    expect(rt.tick, 'постановка в очередь сама по себе тиков не тратит').toBe(0);

    rt.step();
    rt.step();
    expect(ran).toEqual(['r1', 'r2']);
    expect(rt.tick).toBe(2);
    expect(rt.step(), 'пустая очередь больше ничего не отдаёт').toBeNull();
  });

  it('подписка на завершённый промис стоит ровно один тик', () => {
    const rt = createRuntime();
    const promise = rt.settled();

    rt.performPromiseThen(promise, 'поздняя реакция');
    expect(promise.reactions, 'на settled список не заполняется').toHaveLength(0);
    expect(rt.queue).toHaveLength(1);

    expect(rt.step()?.tick).toBe(1);
    expect(rt.queue).toHaveLength(0);
  });
});
