/**
 * Что пытается выполниться на странице — так, как это видит проверка CSP.
 *
 * `script` — `<script src>`: адрес, nonce, хеш из `integrity` и кто вставил элемент
 * (`parser: true` — парсер HTML, `false` — код через `createElement`).
 * `inline` — `<script>` с текстом; `hash` — SHA-256 текста в base64.
 * `handler` — обработчик в атрибуте (`onclick`); `hash` — от текста атрибута.
 * `js-url` — переход по `javascript:`-ссылке; `hash` — от всего адреса вместе с `javascript:`.
 * `eval` — строка как код: `eval`, `new Function`, `setTimeout` со строкой.
 */
export type ScriptRequest =
  | { type: 'script'; url: string; parser: boolean; nonce?: string; integrity?: string }
  | { type: 'inline'; nonce?: string; hash: string }
  | { type: 'handler'; hash: string }
  | { type: 'js-url'; hash: string }
  | { type: 'eval' };

export interface CheckResult {
  allowed: boolean;
  /** Директива, от лица которой браузер отчитается: `script-src-elem`, `script-src-attr`, `script-src`. */
  effective: string;
  /** Директива из заголовка, которая на деле решила (с учётом запасных); `null` — ни одна политика её не задала. */
  directive: string | null;
}

export type CheckFn = (header: string | null, req: ScriptRequest, pageUrl: string) => CheckResult;

/** Проба сквозной страницы: id, разметка, как её видит проверка. */
export interface Probe {
  id: string;
  /** Как проба выглядит в разметке или в коде. */
  code: string;
  req: ScriptRequest;
}

/** Политика стенда и что из проб выполнилось в Chromium под ней. */
export interface MatrixRow {
  id: string;
  csp: string | null;
  ran: string[];
}

export interface Preset {
  id: string;
  label: string;
}
