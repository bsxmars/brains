import { describe, expect, it } from 'vitest';
import { CLONE_CASES } from '@/widgets/clone-survival/model/cases';
import { runCloneCase } from '@/widgets/clone-survival/model/run';

/**
 * Таблица «что переживёт клонирование» — это тест, а не утверждение автора.
 *
 * Демо урока вызывает настоящий `structuredClone` в браузере читателя, и вердикт складывается
 * из проверок клона. Здесь тот же код исполняется в Node: если движок однажды начнёт переносить
 * то, что раньше ронял (или наоборот), урок покраснеет раньше читателя.
 *
 * Случаи, помеченные `browserOnly`, пропускаются: DOM-узла в Node не существует, и проверять
 * там нечего.
 *
 * ⚠️ Отдельно проверяются **молчаливые** потери — прототип, дескрипторы, символьные ключи
 * и `lastIndex`. Вердикта `lossy` для них мало: он говорит «что-то потерялось», а урок
 * утверждает, что именно.
 */
describe('structuredClone — что переживает клонирование', () => {
  for (const item of CLONE_CASES.filter((c) => !c.browserOnly)) {
    it(`${item.label} → ${item.expected}`, () => {
      const outcome = runCloneCase(item);
      expect(outcome.verdict, `${item.label}: ${outcome.note}`).toBe(item.expected);
    });
  }

  it('всё, что падает, падает именно DataCloneError', () => {
    for (const item of CLONE_CASES.filter((c) => !c.browserOnly && c.expected === 'throw')) {
      expect(runCloneCase(item).note, item.label).toBe('DataCloneError');
    }
  });
});

describe('молчаливые потери — то, что не видно по самому факту успеха', () => {
  it('класс приезжает обычным объектом: нет прототипа, методов и приватных полей', () => {
    const item = CLONE_CASES.find((c) => c.key === 'class')!;
    const clone = structuredClone(item.make()) as Record<string, unknown>;

    expect(Object.getPrototypeOf(clone), 'клону выставляется Object.prototype').toBe(Object.prototype);
    expect(typeof clone.format, 'метод жил на прототипе — его нет').toBe('undefined');
    expect(Object.keys(clone), 'от объекта осталось одно собственное свойство').toEqual(['currency']);
    // ⚠️ Вот это и есть место, где расхожее объяснение врёт. Геттер класса объявлен
    // на прототипе, то есть он не собственный и не перечисляемый, — сериализатор до него
    // не доходит вообще. Никакого «вычислился и уехал значением» здесь не происходит.
    expect('amount' in clone, 'геттер класса в клон не попадает вовсе').toBe(false);
  });

  it('а вот собственный геттер вызывается прямо во время клонирования', () => {
    let calls = 0;
    const source = {
      get lazy() {
        calls += 1;
        return 42;
      },
    };

    const clone = structuredClone(source) as { lazy: number };

    expect(calls, 'сериализатор сделал [[Get]] по собственному перечисляемому ключу').toBe(1);
    expect(Object.getOwnPropertyDescriptor(clone, 'lazy')?.get, 'в клоне уже не геттер').toBeUndefined();
    expect(clone.lazy, 'уехало вычисленное значение, связи с источником больше нет').toBe(42);
  });

  it('дескрипторы не переносятся: Object.freeze клон не переживает', () => {
    const clone = structuredClone(Object.freeze({ a: 1 })) as { a: number };
    expect(Object.isFrozen(clone)).toBe(false);
    clone.a = 2;
    expect(clone.a).toBe(2);
  });

  it('символьный ключ исчезает без ошибки', () => {
    const clone = structuredClone({ [Symbol('id')]: 1, plain: 2 });
    expect(Reflect.ownKeys(clone)).toEqual(['plain']);
  });

  it('у RegExp переносятся исходник и флаги, но не lastIndex', () => {
    const source = /ab/g;
    source.lastIndex = 1;
    const clone = structuredClone(source);

    expect(clone).toBeInstanceOf(RegExp);
    expect(clone.source).toBe('ab');
    expect(clone.flags).toBe('g');
    // Конспект урока утверждал обратное; проверка в Node 24.11 и Chromium 153 говорит «ноль».
    expect(clone.lastIndex, 'позиция поиска в сериализацию не входит').toBe(0);
  });

  it('общий объект остаётся одним объектом, а цикл указывает на сам клон', () => {
    const inner = { n: 1 };
    const source = { a: inner, b: inner } as Record<string, unknown>;
    source.self = source;

    const clone = structuredClone(source);
    expect(clone.a, 'memory map: повторная встреча даёт ссылку, а не второй объект').toBe(clone.b);
    expect(clone.self).toBe(clone);
  });
});

describe('перенос владения — то же самое без всякого воркера', () => {
  it('ArrayBuffer.prototype.transfer() отцепляет исходный буфер и убивает все его view', () => {
    const buffer = new ArrayBuffer(1024);
    const bytes = new Uint8Array(buffer);
    const doubles = new Float64Array(buffer);
    bytes[0] = 7;

    const moved = buffer.transfer();

    expect(buffer.byteLength, 'у detached-буфера длина ноль').toBe(0);
    expect(buffer.detached).toBe(true);
    expect(bytes.byteLength, 'view никто не трогал — он умер вместе с буфером').toBe(0);
    expect(doubles.byteLength, 'и второй view тоже: один перенос убил оба').toBe(0);
    expect(new Uint8Array(moved)[0], 'данные целы, у них просто новый владелец').toBe(7);

    // Индексное чтение возвращает undefined, а не бросает, — отсюда и молчаливость ошибки.
    expect(bytes[0]).toBeUndefined();
    bytes[0] = 5;
    expect(bytes[0], 'запись по индексу игнорируется без ошибки').toBeUndefined();
    // А методы состояние буфера проверяют явно.
    expect(() => bytes.set([1, 2, 3])).toThrow(TypeError);
  });
});
