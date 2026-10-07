import type {
  CorsContentType,
  CorsHeader,
  CorsRequest,
  PreflightReason,
  PreflightVerdict,
  ResponseHeader,
} from './types';

/**
 * Простой запрос или preflight — по правилам WHATWG Fetch.
 *
 * ⚠️ **Это модель по спецификации, а не замер.** Ни одного числа отсюда не снято запуском:
 * функция воспроизводит текст стандарта, и её ценность в том, что каждое условие выводится
 * из одного вопроса — **«мог ли это сделать `<form>` в 2005 году?»**. Если мог, значит
 * запрос и так был возможен, и требовать на него разрешения бессмысленно: атакующий просто
 * отправил бы форму. Если не мог — это новая возможность, и на неё нужно согласие сервера.
 *
 * Логика вынесена из компонента отдельным файлом ровно за этим: правило, записанное в теме,
 * обязано проверяться командой, а `.vue` юнит-тестом не покрыть (`tests/unit/preflight.test.ts`).
 */

/** Форма умела только эти методы; `HEAD` — это `GET` без тела. */
const SAFELISTED_METHODS = new Set(['GET', 'HEAD', 'POST']);

/** Ровно те три кодировки, которые умел атрибут `enctype` у формы. */
const SAFELISTED_CONTENT_TYPES = new Set<CorsContentType>(['none', 'urlencoded', 'multipart', 'text']);

/** Из тех заголовков, что предлагает демо, safelisted только этот. */
const SAFELISTED_HEADERS = new Set<CorsHeader>(['none', 'accept-language']);

const CONTENT_TYPE_VALUE: Record<CorsContentType, string> = {
  none: '',
  urlencoded: 'application/x-www-form-urlencoded',
  multipart: 'multipart/form-data',
  text: 'text/plain',
  json: 'application/json',
};

const HEADER_NAME: Record<CorsHeader, string> = {
  none: '',
  'accept-language': 'Accept-Language',
  'x-csrf-token': 'X-CSRF-Token',
  authorization: 'Authorization',
};

export function contentTypeValue(type: CorsContentType): string {
  return CONTENT_TYPE_VALUE[type];
}

export function headerName(header: CorsHeader): string {
  return HEADER_NAME[header];
}

export function classify(request: CorsRequest): PreflightVerdict {
  const { method, contentType, header, credentials } = request;
  const withCredentials = credentials === 'include';

  const reasons: PreflightReason[] = [];

  if (!SAFELISTED_METHODS.has(method)) {
    reasons.push({
      what: `метод \`${method}\``,
      why: 'Форма умела только `GET` и `POST`. Всё остальное принёс `XMLHttpRequest` — значит это новая возможность, и на неё нужно согласие сервера.',
    });
  }

  if (!SAFELISTED_CONTENT_TYPES.has(contentType)) {
    reasons.push({
      what: `\`Content-Type: ${CONTENT_TYPE_VALUE[contentType]}\``,
      why: 'Форма кодировала тело тремя способами, и `application/json` не из них. Это причина №1 всех preflight в SPA.',
    });
  }

  if (!SAFELISTED_HEADERS.has(header)) {
    reasons.push({
      what: `заголовок \`${HEADER_NAME[header]}\``,
      why: 'Формой произвольный заголовок выставить было нельзя. Заголовки, которые ставит сам браузер (`Origin`, `Cookie`, `Referer`), в этот учёт не входят — из JS их не подделать.',
    });
  }

  const simple = reasons.length === 0;

  /** Непростые заголовки, которые придётся перечислить в `Access-Control-Allow-Headers`. */
  const declared: string[] = [];
  if (contentType === 'json') declared.push('Content-Type');
  if (!SAFELISTED_HEADERS.has(header)) declared.push(HEADER_NAME[header]);

  const optionsRequest = simple
    ? []
    : [
        'OPTIONS /v1/orders/42 HTTP/1.1',
        'Origin: https://app.example.com',
        `Access-Control-Request-Method: ${method}`,
        ...(declared.length
          ? [`Access-Control-Request-Headers: ${declared.map((h) => h.toLowerCase()).sort().join(',')}`]
          : []),
        'Sec-Fetch-Mode: cors',
      ];

  const responseHeaders: ResponseHeader[] = [
    {
      name: 'Access-Control-Allow-Origin',
      value: withCredentials ? 'https://app.example.com' : 'https://app.example.com  (или *)',
      why: withCredentials
        ? 'С куками `*` запрещена спецификацией: ответ персонализирован, и сервер обязан назвать origin поимённо.'
        : 'Запрос анонимный, поэтому `*` допустима — ответ и так публичный.',
    },
  ];

  if (withCredentials) {
    responseHeaders.push({
      name: 'Access-Control-Allow-Credentials',
      value: 'true',
      why: 'Строго строка `true`, ничего другого не принимается. Нужна и на ответе preflight, и на финальном ответе.',
    });
  }

  if (!simple) {
    responseHeaders.push({
      name: 'Access-Control-Allow-Methods',
      value: `GET, POST, PATCH, DELETE`,
      why: `Должен содержать запрошенный \`${method}\`. Сам \`OPTIONS\` перечислять не обязательно.`,
    });

    if (declared.length) {
      responseHeaders.push({
        name: 'Access-Control-Allow-Headers',
        value: declared.join(', '),
        why: 'Обязан покрыть **все** заголовки из `Access-Control-Request-Headers`. Забыли один — отклонён весь запрос.',
      });
    }

    responseHeaders.push({
      name: 'Access-Control-Max-Age',
      value: '600',
      why: 'Без него умолчание — **5 секунд**, и preflight уходит практически перед каждым запросом. Ключ кеша включает полный URL, поэтому на REST с id в пути их всё равно будет много.',
    });
  }

  responseHeaders.push({
    name: 'Vary',
    value: simple ? 'Origin' : 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    why: 'Обязателен всегда, когда `Allow-Origin` **вычисляется**, — включая ответы, где origin не подошёл. Иначе CDN раздаст всем ответ, закешированный для чужого origin.',
  });

  const notes: string[] = [];

  if (simple && request.method === 'POST' && contentType === 'text') {
    notes.push(
      '⚠️ **Вот та самая дыра.** `POST` с `text/plain` — простой запрос, и в теле при этом может ' +
        'лежать валидный JSON. Preflight не будет, разрешения никто не спросит, куки уйдут ' +
        'по обычным правилам. Хендлер вида `json.NewDecoder(r.Body).Decode(&req)` на ' +
        '`Content-Type` не смотрит — и выполнит команду с чужого сайта. Лечится строгой ' +
        'проверкой `Content-Type` на сервере: она **заставляет** браузер сделать preflight.',
    );
  }

  if (simple) {
    notes.push(
      'Простой запрос уходит **немедленно**. CORS отработает только на ответе: тело скачается ' +
        'на машину пользователя, но JS его не получит. Сервер запрос к этому моменту **уже ' +
        'выполнил** — побочный эффект случился. Защиты сервера здесь нет по построению.',
    );
  } else {
    notes.push(
      'Preflight ходит **анонимно**: ни кук, ни `Authorization`, даже при `credentials: include`. ' +
        'Отсюда самая частая поломка — auth-middleware отвечает на `OPTIONS` `401`, и браузер ' +
        'считает preflight проваленным. Обработка CORS обязана стоять **снаружи** аутентификации.',
    );
    notes.push(
      'Ответ на preflight обязан быть **2xx** и **не редиректом**: `301` на `OPTIONS` — это ' +
        'провал, а не переход. Прокси, дописывающий слэш к пути, ломает CORS без внятного сообщения.',
    );
  }

  if (header === 'authorization') {
    notes.push(
      '⚠️ `Access-Control-Allow-Headers: *` **не покрывает `Authorization`** — спецификация ' +
        'исключила его из wildcard намеренно. Перечисляйте поимённо, иначе получите ' +
        '`Request header field authorization is not allowed` и будете искать баг в браузере.',
    );
  }

  if (withCredentials) {
    notes.push(
      'Чтение ответа и установка куки — **разные** механизмы. Даже при идеальном CORS ' +
        '`Set-Cookie` в cross-site ответе будет проигнорирован, если у куки нет ' +
        '`SameSite=None; Secure`. Если фронт и API на поддоменах одного site, куки ' +
        'уже same-site — и `None` не нужен.',
    );
  }

  notes.push(
    '**Финальный ответ проверяется заново, независимо от preflight.** Успешный preflight ' +
      'разрешил только отправку; право прочитать ответ даёт `Access-Control-Allow-Origin` ' +
      '**на самом ответе**. Отсюда самый коварный случай: `204` на preflight, сервер выполнил ' +
      'запрос, вернул `200` — а `fetch` отклонился, потому что заголовки поставили только ' +
      'в ветке `OPTIONS`.',
  );

  return { simple, reasons, optionsRequest, responseHeaders, notes };
}
