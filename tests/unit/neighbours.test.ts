import { describe, expect, it } from 'vitest';
import { neighbours } from '@/entities/lesson/model/neighbours';

/**
 * Пейджер «назад / вперёд» появился в курсе позже самих уроков: функция соседей была написана
 * сразу, но полгода никем не вызывалась. Теперь она рисует ссылки на каждой странице урока,
 * и её края — первый урок, последний, чужой id — это ровно те случаи, где ошибка выглядит
 * как «ссылка ведёт не туда», а не как падение.
 */
const COURSE = [{ id: 'first' }, { id: 'middle' }, { id: 'last' }];

describe('соседи урока', () => {
  it('у первого урока нет предыдущего', () => {
    const { prev, next } = neighbours(COURSE, 'first');
    expect(prev).toBeUndefined();
    expect(next?.id).toBe('middle');
  });

  it('у последнего нет следующего', () => {
    const { prev, next } = neighbours(COURSE, 'last');
    expect(prev?.id).toBe('middle');
    expect(next).toBeUndefined();
  });

  it('у середины есть оба', () => {
    const { prev, next } = neighbours(COURSE, 'middle');
    expect(prev?.id).toBe('first');
    expect(next?.id).toBe('last');
  });

  it('неизвестный урок не получает чужих соседей', () => {
    // Иначе `findIndex` вернул бы −1, и «предыдущим» стал бы последний урок курса.
    expect(neighbours(COURSE, 'нет-такого')).toEqual({});
  });

  it('единственный урок в курсе остаётся без ссылок', () => {
    expect(neighbours([{ id: 'alone' }], 'alone')).toEqual({ prev: undefined, next: undefined });
  });
});
