import { describe, expect, it } from 'vitest';
import { classify } from '@/widgets/cors-preflight/model/preflight';
import type { CorsRequest } from '@/widgets/cors-preflight/model/types';

/**
 * Простой запрос против preflight — правило, на котором держится весь раздел про CORS.
 *
 * Тест закрепляет **модель по спецификации** (WHATWG Fetch, «CORS protocol»), а не замер:
 * демо на странице рисует ровно то, что считает эта функция, и разойтись они не имеют права.
 * Каждый случай выводится из одного вопроса — «мог ли это отправить `<form>` в 2005 году?»,
 * и именно поэтому тест перечисляет граничные пары, а не проверяет функцию «в целом».
 *
 * Отдельно закреплён случай, ради которого демо и написано: `POST` с `text/plain` — запрос
 * **простой**, хотя в теле лежит JSON. Если однажды кто-то «исправит» это на preflight,
 * тема начнёт врать про CSRF в JSON-API, а страница соберётся молча.
 */
const base: CorsRequest = {
  method: 'GET',
  contentType: 'none',
  header: 'none',
  credentials: 'omit',
};

const make = (patch: Partial<CorsRequest>): CorsRequest => ({ ...base, ...patch });

describe('что делает запрос простым', () => {
  it('GET без заголовков — простой', () => {
    expect(classify(base).simple).toBe(true);
  });

  it('POST с тремя кодировками формы — простой', () => {
    for (const contentType of ['urlencoded', 'multipart', 'text'] as const) {
      const verdict = classify(make({ method: 'POST', contentType }));
      expect(verdict.simple, `${contentType} обязан остаться простым`).toBe(true);
      expect(verdict.optionsRequest).toEqual([]);
    }
  });

  it('Accept-Language — safelisted, preflight не нужен', () => {
    expect(classify(make({ header: 'accept-language' })).simple).toBe(true);
  });
});

describe('что требует preflight', () => {
  it('метод, которого не умела форма', () => {
    for (const method of ['PATCH', 'DELETE'] as const) {
      expect(classify(make({ method })).simple, method).toBe(false);
    }
  });

  it('application/json — причина номер один в SPA', () => {
    const verdict = classify(make({ method: 'POST', contentType: 'json' }));
    expect(verdict.simple).toBe(false);
    expect(verdict.reasons).toHaveLength(1);
    // Content-Type обязан попасть в список заголовков, которые сервер должен разрешить.
    const allowHeaders = verdict.responseHeaders.find((h) => h.name === 'Access-Control-Allow-Headers');
    expect(allowHeaders?.value).toContain('Content-Type');
  });

  it('произвольный заголовок из JS', () => {
    expect(classify(make({ header: 'x-csrf-token' })).simple).toBe(false);
  });

  it('причины складываются, а не заменяют друг друга', () => {
    const verdict = classify(
      make({ method: 'PATCH', contentType: 'json', header: 'x-csrf-token' }),
    );
    expect(verdict.reasons).toHaveLength(3);
  });

  it('в запросе OPTIONS едет метод и отсортированный список заголовков', () => {
    const verdict = classify(make({ method: 'PATCH', contentType: 'json', header: 'x-csrf-token' }));
    expect(verdict.optionsRequest).toContain('Access-Control-Request-Method: PATCH');
    // Имена приводятся к нижнему регистру и сортируются — это нормализация по спецификации.
    expect(verdict.optionsRequest).toContain('Access-Control-Request-Headers: content-type,x-csrf-token');
  });
});

describe('POST + text/plain: простой запрос с JSON внутри', () => {
  const verdict = classify(make({ method: 'POST', contentType: 'text', credentials: 'include' }));

  it('остаётся простым — в этом вся беда', () => {
    expect(verdict.simple).toBe(true);
    expect(verdict.optionsRequest).toEqual([]);
  });

  it('демо обязано назвать это дырой, а не просто «простым запросом»', () => {
    expect(verdict.notes.some((note) => note.includes('дыра'))).toBe(true);
  });
});

describe('credentials меняют требования к ответу', () => {
  it('без кук wildcard допустима', () => {
    const origin = classify(base).responseHeaders.find((h) => h.name === 'Access-Control-Allow-Origin');
    expect(origin?.value).toContain('*');
  });

  it('с куками — только точный origin и Allow-Credentials', () => {
    const verdict = classify(make({ credentials: 'include' }));
    const origin = verdict.responseHeaders.find((h) => h.name === 'Access-Control-Allow-Origin');
    expect(origin?.value).not.toContain('*');
    expect(verdict.responseHeaders.some((h) => h.name === 'Access-Control-Allow-Credentials')).toBe(true);
  });

  it('Authorization получает отдельное предупреждение про wildcard', () => {
    const verdict = classify(make({ header: 'authorization' }));
    expect(verdict.notes.some((note) => note.includes('не покрывает'))).toBe(true);
  });
});

describe('Vary: Origin', () => {
  it('стоит на любом ответе, даже на простом запросе', () => {
    const vary = classify(base).responseHeaders.find((h) => h.name === 'Vary');
    expect(vary?.value).toBe('Origin');
  });

  it('на preflight дополняется двумя заголовками запроса', () => {
    const vary = classify(make({ method: 'DELETE' })).responseHeaders.find((h) => h.name === 'Vary');
    expect(vary?.value).toContain('Access-Control-Request-Method');
    expect(vary?.value).toContain('Access-Control-Request-Headers');
  });
});
