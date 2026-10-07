import { LESSON_VARS } from '@/shared/ui';
import type { CspOption, CspProbe } from './types';

/**
 * Документ внутри рамки — тот самый, к которому применяется настоящая политика браузера.
 *
 * Живёт отдельным `.ts`, а не строкой внутри `.vue`, по прозаической причине: в SFC любая
 * последовательность `</script>` закрывает блок компонента, и собрать разметку с тегами
 * скриптов там нельзя, не экранируя каждый. Здесь же это обычный текст.
 *
 * ⚠️ **Два элемента стоят ДО `<meta>` намеренно, и это не обход политики, а её свойство.**
 * CSP из мета-тега применяется только к тому, что идёт в документе **после** тега (CSP Level 3,
 * то же тонкое место разобрано в теме). Поэтому:
 *
 *   - **репортёр** — слушатель `securitypolicyviolation` — обязан оказаться выше политики:
 *     под `default-src 'none'` он был бы заблокирован сам, и рамка молчала бы вместо того,
 *     чтобы показать, что именно заблокировано;
 *   - **стили** — чтобы рамка не превращалась в голый HTML на каждом втором наборе директив.
 *
 * Всё, что политика действительно проверяет, — пробы ниже мета-тега. Ни одна из них не ходит
 * в сеть: внешний скрипт указывает на хост, которого нет ни в одном из наборов, поэтому он
 * блокируется **до** сетевого запроса, а «скрипт, созданный из JS» собирается из `blob:`
 * прямо в рамке. Демо работает без интернета и ничего наружу не отправляет.
 */

/** Чужой хост: он не входит ни в один из предлагаемых наборов, значит запроса не будет никогда. */
const FOREIGN_SCRIPT = 'https://cdn.example.org/widget.js';

/** Пробы — по одной на каждый способ исполнить код, который политика рассматривает отдельно. */
export const CSP_PROBES: CspProbe[] = [
  {
    id: 'inline',
    label: 'инлайн-скрипт в теге',
    hint: 'Разрешает только unsafe-inline. Нужного nonce у него нет.',
  },
  {
    id: 'nonce',
    label: 'скрипт с атрибутом nonce',
    hint: 'Тот же инлайн, но с меткой, которую сервер положил в заголовок.',
  },
  {
    id: 'attr',
    label: 'инлайн-обработчик onclick',
    hint: 'Атрибут, а не тег: nonce на него повесить некуда, решает script-src-attr.',
  },
  {
    id: 'eval',
    label: 'вызов eval()',
    hint: 'Отдельное разрешение unsafe-eval; nonce его не заменяет.',
  },
  {
    id: 'external',
    label: 'внешний скрипт с чужого хоста',
    hint: 'Вставлен парсером. Ни один набор этот хост не разрешает.',
  },
  {
    id: 'dynamic',
    label: 'скрипт, созданный через createElement',
    hint: 'Ровно то, на что strict-dynamic переносит доверие с уже доверенного скрипта.',
  },
];

/**
 * Наборы директив. Порядок — от самого строгого к рабочему, как их и внедряют.
 *
 * Метка `{NONCE}` заменяется значением, которое остров генерирует на клиенте: каждый прогон
 * получает новый nonce, как и положено — статичный nonce защиты не даёт вовсе.
 */
export const CSP_OPTIONS: CspOption[] = [
  {
    key: 'none',
    label: "default-src 'none'",
    policy: "default-src 'none'",
    about:
      'Запрещено всё. Полезно как отправная точка внедрения: дальше директивы **добавляют**, ' +
      'а не убирают. Обратите внимание, что блокируются даже те способы, о которых обычно ' +
      'не думают, — атрибут-обработчик и `eval`.',
  },
  {
    key: 'self',
    label: "script-src 'self'",
    policy: "script-src 'self'",
    about:
      'Канонический «строгий» CSP из нулевых: исполнять можно только файлы со своего origin. ' +
      'Инлайн при этом запрещён целиком — и в теге, и в атрибуте. Именно от этого набора ' +
      'обычно ломается рантайм-инжект стилей у UI-библиотек.',
  },
  {
    key: 'unsafe-inline',
    label: "+ 'unsafe-inline'",
    policy: "script-src 'self' 'unsafe-inline'",
    about:
      'Так политику «чинят», когда страница перестала работать. Исполняется **любой** инлайн — ' +
      'и тот, что положили вы, и тот, что принесла инъекция. От XSS такая политика не защищает ' +
      'вообще: ровно тот способ, которым XSS и работает, снова разрешён.',
  },
  {
    key: 'unsafe-eval',
    label: "+ 'unsafe-eval'",
    policy: "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    about:
      'Добавляет `eval`, `new Function` и строковые таймеры. Нужно полной сборке Vue ' +
      'с компилятором шаблонов и webpack-у в режиме `devtool: eval-*`. Цена: любая ' +
      'возможность повлиять на строку внутри `eval` превращается в исполнение чего угодно.',
  },
  {
    key: 'nonce',
    label: "'nonce-…'",
    policy: "script-src 'nonce-{NONCE}'",
    about:
      'Единственный источник доверия — метка, которую сервер сгенерировал на этот ответ. ' +
      'Инъекция её не знает и угадать не может. Заметьте, что **обработчик `onclick` ' +
      'не проходит**: атрибуту nonce поставить некуда.',
  },
  {
    key: 'nonce-unsafe-inline',
    label: "nonce + 'unsafe-inline'",
    policy: "script-src 'nonce-{NONCE}' 'unsafe-inline'",
    about:
      'Официально рекомендованная форма записи — и одновременно ловушка. Современный браузер, ' +
      'увидев nonce, **игнорирует `unsafe-inline`**, и результат обязан совпасть с предыдущим ' +
      'набором. Старый браузер, не знающий nonce, уважает `unsafe-inline` — и остаётся почти ' +
      'без политики.',
  },
  {
    key: 'strict-dynamic',
    label: "nonce + 'strict-dynamic'",
    policy: "script-src 'nonce-{NONCE}' 'strict-dynamic'",
    about:
      'Рабочая политика для собранного приложения. Доверие переносится с доверенного скрипта ' +
      'на всё, что он создаст **программно**, — иначе ленивые чанки со случайными именами ' +
      'перечислить было бы нечем. Граница проходит по способу вставки: созданное через ' +
      '`createElement` наследует доверие, вставленное парсером — нет.',
  },
];

/** Репортёр: он же запускает поздние пробы, когда мета-тег уже разобран и политика действует. */
const REPORTER = `
(function () {
  var ran = [];
  var violations = [];
  window.__cspRan = function (id) { if (ran.indexOf(id) < 0) ran.push(id); };

  document.addEventListener('securitypolicyviolation', function (e) {
    violations.push({
      directive: String(e.effectiveDirective || e.violatedDirective || ''),
      blocked: String(e.blockedURI || '')
    });
  });

  // Нулевой таймаут: к моменту вызова документ разобран целиком, мета-тег прочитан,
  // и политика уже действует — иначе eval прошёл бы просто потому, что успел раньше.
  setTimeout(function () {
    try { (0, eval)('window.__cspRan("eval")'); } catch (err) { /* заблокировано политикой */ }

    try {
      var blob = new Blob(['window.__cspRan("dynamic")'], { type: 'text/javascript' });
      var s = document.createElement('script');
      s.src = URL.createObjectURL(blob);
      document.head.appendChild(s);
    } catch (err) { /* нечего делать: результат виден по отсутствию пробы в списке */ }

    var button = document.getElementById('probe-attr');
    if (button) button.click();
  }, 0);

  setTimeout(function () {
    try {
      parent.postMessage({ __csp: true, ran: ran, violations: violations }, '*');
    } catch (err) { /* родителя нет — демо просто не покажет результат */ }
  }, 400);
})();
`;

/** Собрать документ рамки под выбранный набор директив. */
export function buildSandboxDoc(policy: string, nonce: string): string {
  const applied = policy.replace(/\{NONCE\}/g, nonce);
  const v = LESSON_VARS;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<script>${REPORTER}</script>
<style>
  body {
    margin: 0;
    padding: 14px 16px;
    background: ${v['--surface-2']};
    color: ${v['--text-muted']};
    font: 12px ui-monospace, monospace;
    line-height: 1.5;
  }
  p { margin: 0 0 10px; }
  button {
    font: inherit;
    color: ${v['--on-ink']};
    background: ${v['--ink']};
    border: 0;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
  }
</style>
<meta http-equiv="Content-Security-Policy" content="${applied.replace(/"/g, '&quot;')}">
</head>
<body>
<p>Это отдельный документ со своей политикой. Ниже — шесть проб; что из них выполнится, решает браузер.</p>
<script>window.__cspRan('inline')</script>
<script nonce="${nonce}">window.__cspRan('nonce')</script>
<script src="${FOREIGN_SCRIPT}"></script>
<button id="probe-attr" type="button" onclick="window.__cspRan('attr')">обработчик в атрибуте</button>
</body>
</html>`;
}
