/** Метод запроса. `GET` и `POST` умела форма, остальное принёс `XMLHttpRequest`. */
export type CorsMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Что стоит в `Content-Type`. Три из них умела форма — отсюда и весь список безопасных. */
export type CorsContentType = 'none' | 'urlencoded' | 'multipart' | 'text' | 'json';

/** Один дополнительный заголовок, выставленный из JS вручную. */
export type CorsHeader = 'none' | 'accept-language' | 'x-csrf-token' | 'authorization';

/** Режим credentials: `omit` — анонимно, `include` — с куками. */
export type CorsCredentials = 'omit' | 'include';

/** Что читатель собрал переключателями. */
export interface CorsRequest {
  method: CorsMethod;
  contentType: CorsContentType;
  header: CorsHeader;
  credentials: CorsCredentials;
}

/** Одна причина, по которой запрос перестал быть простым. */
export interface PreflightReason {
  /** Что именно в запросе. Разрешена строчная разметка — идёт через `Md`. */
  what: string;
  /** Почему это требует спроса: ответ всегда один и тот же — «форма так не умела». */
  why: string;
}

/** Заголовок, без которого браузер ответ не отдаст. */
export interface ResponseHeader {
  name: string;
  value: string;
  /** Зачем он нужен. Разрешена строчная разметка. */
  why: string;
}

/**
 * Вердикт: простой запрос или preflight, и что должно вернуться с сервера.
 *
 * ⚠️ Это **модель по спецификации** (WHATWG Fetch, раздел «CORS protocol»), а не замер.
 * Здесь описано, что браузер обязан сделать, а не то, что сделал конкретный браузер
 * конкретной версии.
 */
export interface PreflightVerdict {
  simple: boolean;
  reasons: PreflightReason[];
  /** Строки запроса `OPTIONS`, если он нужен. */
  optionsRequest: string[];
  responseHeaders: ResponseHeader[];
  /** Мины, которые видны только на этом сочетании. Разрешена строчная разметка. */
  notes: string[];
}
