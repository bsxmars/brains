import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Буфер обмена и перетаскивание».
 *
 * Тема написана 2026-11-03. Вставка в поля ввода (какое представление берёт `<input>`, а какое
 * `contenteditable`, `plaintext-only`, `execCommand('insertText')`) живёт в «Вводе текста»,
 * раздел «Вставка», — здесь только ссылка. Чистка HTML перед вставкой в DOM — в «Безопасности
 * фронтенда», раздел XSS. Отправка файлов на сервер — в «Загрузке файлов».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63: Chromium **153.0.8010.12** (headless shell; полный Chromium через
 * `channel: 'chromium'` — для фокуса документа и файла, брошенного мимо зоны), Firefox **155.0**,
 * WebKit **26.6**. macOS arm64, Node 26.8.2, ноябрь 2026. Страница отдаётся через `page.route`
 * с выдуманного `https://clipboard-dnd.test` — `navigator.clipboard` есть только в безопасном
 * контексте. Буфер обмена у браузеров Playwright свой, системный не трогается (проверено
 * `pbpaste` после прогонов). Каталог проб — `scratchpad/cd/` (`p1.mjs` … `p16.mjs`).
 *
 * ⚠️ Две ловушки стенда, обе съели время:
 *   — `page.evaluate` и `waitForFunction` в Playwright исполняются **с жестом пользователя**:
 *     после любого из них `navigator.userActivation.isActive` — `true`. Поэтому «без жеста»
 *     снимается скриптом самой страницы, до первого `evaluate`;
 *   — headless shell без выданных разрешений отказывает в записи **всегда**, даже по клику
 *     (настоящий Chrome выдаёт запись сам). Поэтому строки «по клику» сняты с разрешением
 *     `clipboard-write` — это и есть поведение Chrome по умолчанию.
 *
 * Что снято (Chromium 153, если не сказано иное):
 *   — `writeText` при загрузке без клика — `NotAllowedError`; по клику — проходит; через 3 с
 *     после клика — проходит, через 6 с — `NotAllowedError` (`userActivation.isActive` уже
 *     `false`). Те же 3 и 6 с — во всех трёх движках;
 *   — если сайту выдано `clipboard-read`, запись проходит и без клика;
 *   — `readText` без `clipboard-read` — `NotAllowedError` и по клику;
 *   — документ без фокуса (вторая вкладка поверх, полный Chromium) — `NotAllowedError` с текстом
 *     «Document is not focused» и у записи, и у чтения;
 *   — Firefox 155: без жеста — `NotAllowedError` у обоих. По клику запись проходит; чтение того,
 *     что записала эта же страница, — сразу, а чтение чужого (пустой буфер в начале прогона)
 *     не разрешилось за 14 с: Firefox ждёт нажатия кнопки «Вставить» (сама кнопка в безоконном
 *     режиме не видна, её вид — по MDN). WebKit 26.6: запись — по клику, чтение не прошло ни разу,
 *     ни своего, ни чужого (кнопка «Вставить» Safari — по документации);
 *   — `ClipboardItem` с промисом, который разрешился через 6,5 с после клика, — проходит во всех
 *     трёх движках: жест проверяется в момент вызова `write`;
 *   — `copy`: в начале обработчика `clipboardData.types` пуст; `setData` без `preventDefault`
 *     пропадает — скопировано выделение (Chromium, Firefox; в WebKit прочитать буфер нельзя);
 *   — `cut` на обычном тексте приходит, текст на месте; `execCommand('copy')` без жеста — `false`,
 *     по клику — `true` и шлёт `copy`;
 *   — `paste` с картинкой: `types` — `Files`, файл `image.png`, `image/png`; PNG 103 байта
 *     вернулся 116 байтами (браузер перекодирует), «PNG» из текста — `DataError` при записи.
 *     ⚠️ Firefox 155 на стенде отдал `items` с файлом, но пустой `files` и `getAsFile()` — `null`:
 *     похоже на особенность безоконного режима, в текст не вошло;
 *   — после обработчика `clipboardData` пуст (Chromium, WebKit), в Firefox `setData` бросает
 *     `NoModificationAllowedError`;
 *   — `ClipboardItem.supports` — таблица `SUPPORTS_ROWS`, пересобирается тестом в трёх движках;
 *     WebKit при этом `write` с `image/jpeg` и `application/json` не отклонил;
 *   — `read()` чистит `text/html` (Chromium, Firefox): `onerror` и `<script>` убраны, стиль
 *     и внешняя картинка остались; `{ unsanitized: ['text/html'] }` в Chromium отдаёт исходник
 *     в обёртке `<html><head></head><body>…`, Firefox флаг не слушает. SVG тоже чистится;
 *   — `web `-форматы: только Chromium; Firefox — `TypeError` в конструкторе `ClipboardItem`;
 *     в событии `paste` формата не видно (только `text/plain`). Свой MIME через `setData`
 *     в `copy` доходит до `paste` во всех трёх движках, но `read()` его не видит;
 *   — перетаскивание (`page.dragAndDrop`): `dragenter`/`dragover` видят `types`, `getData` — `""`;
 *     `drop` читает; без `preventDefault` в `dragover` `drop` не пришёл, `dragend` — `none`;
 *     `dropEffect = 'copy'` при `effectAllowed = 'move'` — `drop` не пришёл, `dragend` — `none`;
 *     `preventDefault` только в `dragover` (без `dragenter`) — достаточно. Тип
 *     `Application/X-Card` записан строчными. Firefox 155 отдаёт данные и в `dragover`, и после
 *     события. WebKit 26.6 в Playwright показал `effectAllowed: 'all'` вместо заданного — его
 *     перетаскивание на стенде имитируется, в текст не вошло;
 *   — синтетический `DragEvent` с `new DataTransfer()` отдаёт данные в `dragover` (все три);
 *   — `draggable`: у `<img>` и `<a href>` — `true`, у `<div>` — `false`; `tabIndex` у
 *     `<div draggable="true">` — `-1` (все три);
 *   — файлы из системы (CDP `Input.dispatchDragEvent` с путями — настоящий `drop` с `isTrusted`):
 *     в `dragover` `types` — `Files`, `files` пуст, `items` видны с `kind`; папка в `files` —
 *     «файл» с пустым типом и размером 128, его `text()` — `NotFoundError`; `webkitGetAsEntry`
 *     и `getAsFileSystemHandle` различают папку; `readEntries` на 150 файлах — пачки 100 и 50;
 *     после таймера `items[0].kind` — `""`, `getAsFile()` — `null`, а взятый раньше `File` читается;
 *   — файл, брошенный мимо зоны, полный Chromium открыл в новой вкладке (`file://…`).
 *
 * Что пересобирает `tests/e2e/clipboard-dnd.spec.ts`: все примеры кода исполняются как есть
 * и сверяются с `*_OUT`; строки `COPY_ROWS`, `ENGINE_ROWS`, `SUPPORTS_ROWS`, `MODES_ROWS`
 * и отдельные утверждения нот — пробами в тех же движках.
 *
 * Только по документации: кнопка «Вставить» в Firefox и Safari, критерий WCAG 2.5.7, что видят
 * `web `-формат системные программы.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'буфер обмена',
    d: 'Общее хранилище операционной системы: то, что скопировали в одной программе, вставляют в другой. Один на всю систему, а не на вкладку.',
  },
  {
    k: 'жест пользователя',
    d: 'Клик, нажатие клавиши, касание. После него странице несколько секунд разрешено то, чего без человека делать нельзя: открыть окно, записать в буфер. В спецификации — временная активация (transient activation).',
  },
  {
    k: '`DataTransfer`',
    d: 'Объект с данными, которые переносят: `clipboardData` у событий буфера и `dataTransfer` у событий перетаскивания. Внутри — пары «тип → данные» и файлы.',
  },
  {
    k: 'MIME-тип',
    d: 'Название вида данных: `text/plain` — текст, `text/html` — разметка, `image/png` — картинка. По нему получатель решает, что взять.',
  },
  {
    k: 'санитизация',
    d: 'Чистка чужого HTML: убрать скрипты, обработчики вроде `onerror` и всё, что может выполнить код.',
  },
  {
    k: 'приёмник',
    d: 'Элемент, на который можно бросить перетаскиваемое. Обычный элемент приёмником не является, пока код не скажет обратного.',
  },
];

export const PLAIN_CLIPBOARD =
  'Буфер обмена — общий стол в квартире. Кто угодно может положить на него вещь, и кто угодно может взять. Поэтому браузер пускает к столу страницу только тогда, когда за ней стоит человек: кладёт она по его клику, а берёт — с его разрешения.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Действие по умолчанию',
    d: 'После события браузер делает своё: копирует выделение, открывает брошенный файл. `preventDefault()` этот шаг отменяет.',
    href: '/render/dom-events/#s4',
    hrefLabel: '«События DOM», раздел «Действие по умолчанию»',
    tone: 'info',
  },
  {
    t: 'Blob и File',
    d: '`Blob` — кусок байтов с типом, `File` — тот же `Blob` с именем. Картинки и файлы из буфера и перетаскивания приходят именно так.',
    href: '/js/binary-data/#s5',
    hrefLabel: '«Двоичные данные», раздел «Blob и File»',
    tone: 'info',
  },
  {
    t: 'Промисы и `await`',
    d: '`navigator.clipboard` целиком асинхронный: каждый вызов возвращает промис, и отказ браузера приходит отклонением.',
    href: '/js/promise-internals/#s1',
    hrefLabel: '«Промис изнутри», раздел «Модель»',
    tone: 'info',
  },
  {
    t: 'Вставка в поле ввода',
    d: 'Что браузер сам вставит в `<input>` и в `contenteditable` из одного и того же буфера.',
    href: '/render/text-input/#s5',
    hrefLabel: '«Ввод текста», раздел «Вставка и буфер обмена»',
    tone: 'info',
  },
];

// ─── Раздел 1. Копировать по кнопке ────────────────────────────────────────────────────────

export const COPY_MARKUP = `<button id="copy">Скопировать команду</button>
<button id="paste">Что в буфере?</button>`;

/** Исполняется тестом: клик по `#copy`, затем буфер читается и сверяется с командой. */
export const COPY_CODE = `const copy = document.querySelector('#copy');

copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('npm create astro@latest');
    copy.textContent = 'Скопировано';
    console.log('скопировано');
  } catch (error) {
    console.log(error.name);   // браузер запретил запись
  }
});`;

export const COPY_OUT = 'скопировано';

/** Исполняется тестом дважды: без разрешения на чтение и с ним. */
export const READ_CODE = `document.querySelector('#paste').addEventListener('click', async () => {
  try {
    console.log('в буфере:', await navigator.clipboard.readText());
  } catch (error) {
    console.log(error.name);
  }
});`;

export const READ_OUT_DENIED = 'NotAllowedError';
export const READ_OUT_GRANTED = 'в буфере: npm create astro@latest';

export const COPY_NOTE =
  'Запись прошла, а чтение по той же кнопке вернуло `NotAllowedError`. Чтение требует отдельного разрешения: Chromium спрашивает пользователя, можно ли сайту читать буфер, и только после «Разрешить» `readText` отдаёт текст. Все отказы приходят одним именем — `NotAllowedError`, отличается только текст сообщения. Поэтому `writeText` всегда стоит в `try` или с `.catch`: кнопка, которая молча не скопировала, хуже кнопки, которой нет.';

export const COPY_ROWS: { when: string; write: string; read: string }[] = [
  { when: 'по клику, сразу', write: 'проходит', read: '`NotAllowedError`, пока пользователь не разрешил чтение' },
  { when: 'при загрузке страницы, без клика', write: '`NotAllowedError`', read: '`NotAllowedError`' },
  { when: 'через 6 с после клика (ждали ответа сервера)', write: '`NotAllowedError`', read: 'как без клика' },
  { when: 'сайту уже разрешено чтение', write: 'проходит и без клика', read: 'проходит' },
  { when: 'у документа нет фокуса: вызов из консоли DevTools, вкладка в фоне', write: '`NotAllowedError`: Document is not focused', read: 'то же' },
];

export const WHY_NOTE =
  'Причины у запретов разные. **Запись — по жесту**, иначе любая страница могла бы подменить то, что человек только что скопировал: номер карты, адрес кошелька, команду для терминала. **Чтение — по разрешению**: в буфере лежат пароли, коды из SMS, куски чужой переписки, и рекламный скрипт на странице не должен их видеть. **Фокус** нужен обоим: буфер общий для всей системы, и вкладка в фоне не должна хозяйничать в нём, пока человек работает в другой программе. Отсюда частый сюрприз: `navigator.clipboard.writeText(\'x\')` в консоли DevTools падает, потому что фокус в этот момент у самой консоли.';

export const PLAIN_ACTIVATION =
  'Клик выдаёт странице талон: «человек только что был здесь». Талон действует несколько секунд — на стенде через 3 секунды запись ещё проходила, через 6 уже нет, во всех трёх движках. Если обработчик клика ждал ответа сервера дольше, талон сгорел, и запись не пройдёт, хотя кнопку честно нажали.';

export const ENGINE_ROWS: { engine: string; write: string; read: string }[] = [
  { engine: 'Chromium 153', write: 'по жесту, или без него, если сайту разрешено чтение', read: 'по разрешению `clipboard-read`: браузер один раз спрашивает пользователя' },
  { engine: 'Firefox 155', write: 'по жесту', read: 'по жесту. То, что записала ваша же страница, отдаёт сразу. Чужое — только после кнопки «Вставить» у курсора; без неё промис либо ждёт, либо отклоняется с `NotAllowedError` — на стенде было и то и другое' },
  { engine: 'WebKit 26.6 (Safari)', write: 'по жесту', read: 'только через кнопку «Вставить», которую нажимает человек; на стенде без человека — всегда `NotAllowedError`' },
];

/** Исполняется тестом: `/api/invite` отвечает через 6,5 с — дольше, чем живёт жест. */
export const LATE_CODE = `copy.addEventListener('click', () => {
  // write вызван сразу, пока жест жив; текст придёт позже
  const text = fetch('/api/invite')
    .then((response) => response.text())
    .then((body) => new Blob([body], { type: 'text/plain' }));

  navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })]);
});`;

export const LATE_NOTE =
  'Если текст ещё надо получить с сервера, не ждите его перед записью. `ClipboardItem` принимает **промис** вместо данных: `write` вызывается сразу, в клике, а браузер дожидается промиса сам. На стенде ответ пришёл через 6,5 секунды — позже, чем живёт жест, — и запись прошла во всех трёх движках: жест проверяется в момент вызова `write`, а не в момент, когда данные готовы.';

// ─── Раздел 2. События copy, cut и paste ───────────────────────────────────────────────────

export const COPY_EVENT_MARKUP = '<p>Цена: 1 990 ₽</p>';

/** Исполняется тестом: выделить абзац, Ctrl+C (Cmd+C), прочитать буфер. */
export const COPY_EVENT_CODE = `document.addEventListener('copy', (event) => {
  const text = document.getSelection().toString();
  event.clipboardData.setData('text/plain', \`\${text}\\nИсточник: \${location.href}\`);
  event.preventDefault();   // без этого браузер скопирует выделение, а setData пропадёт
});`;

/** Что оказалось в буфере после Ctrl+C на странице `https://clipboard-dnd.test/`. */
export const COPY_EVENT_OUT = `Цена: 1 990 ₽
Источник: https://clipboard-dnd.test/`;

export const COPY_EVENT_NOTE =
  'В начале обработчика `clipboardData` пуст: выделение браузер положит в буфер сам, после события. Если вызвать `setData` и **не** вызвать `preventDefault`, браузер так и сделает — ваши данные пропадут, и в буфере окажется просто выделенный текст. `cut` устроен так же, только после копирования браузер удаляет выделенное, если оно в редактируемом поле. На обычном тексте `cut` тоже приходит, но удалять там нечего.';

export const EXEC_NOTE =
  'Старый способ скопировать из кода — `document.execCommand(\'copy\')`. Он шлёт то же событие `copy` и работает только по жесту: при загрузке страницы вернул `false`, по клику — `true`. Новый код пишут на `navigator.clipboard`, а `execCommand` остаётся запасным путём для очень старых браузеров.';

/** Исполняется тестом: в буфер кладётся `tests/fixtures/clipboard-dnd/dot.png`, затем Ctrl+V. */
export const PASTE_IMAGE_CODE = `document.addEventListener('paste', (event) => {
  const images = [...event.clipboardData.files]
    .filter((file) => file.type.startsWith('image/'));
  if (images.length === 0) return;     // текст пусть вставит браузер

  event.preventDefault();
  for (const file of images) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    document.body.append(img);
    console.log(file.name, file.type);
  }
});`;

export const PASTE_IMAGE_OUT = 'image.png image/png';

export const PASTE_IMAGE_NOTE =
  'Скриншот или картинка, скопированная из другой программы, приходит в `paste` **файлом**: в `types` стоит `Files`, а в `clipboardData.files` — `File` с именем `image.png`, какое бы имя ни было у исходника. Событие `paste` приходит туда, где фокус, даже если это кнопка, а не поле ввода, — поэтому слушают его на `document`. Что браузер сам вставит в `<input>` и `contenteditable`, если вы не отменили вставку, — в [«Вводе текста», раздел «Вставка и буфер обмена»](/render/text-input/#s5).';

// ─── Раздел 3. Форматы ─────────────────────────────────────────────────────────────────────

/** Исполняется тестом: вывод сверяется с `ITEM_OUT` построчно. */
export const ITEM_CODE = `const item = new ClipboardItem({
  'text/plain': new Blob(['Итого: 1 990 ₽'], { type: 'text/plain' }),
  'text/html': new Blob(['<b>Итого:</b> 1 990 ₽'], { type: 'text/html' }),
});
await navigator.clipboard.write([item]);

const [back] = await navigator.clipboard.read();
console.log(back.types.join(', '));
console.log(await (await back.getType('text/html')).text());`;

export const ITEM_OUT = ['text/plain, text/html', '<b>Итого:</b> 1 990 ₽'];

export const ITEM_NOTE =
  'Один `ClipboardItem` — одна вещь в нескольких видах. Почтовая программа возьмёт `text/html` и покажет «Итого» жирным, терминал возьмёт `text/plain`. Ключ и тип `Blob` обязаны совпадать: `Blob` с `text/html` под ключом `text/plain` — `NotAllowedError`. Положить можно не всё подряд: список разрешённых типов у каждого браузера свой, и спросить его можно заранее через `ClipboardItem.supports(тип)`.';

export const SUPPORTS_ROWS: { type: string; chromium: string; firefox: string; webkit: string }[] = [
  { type: '`text/plain`', chromium: 'да', firefox: 'да', webkit: 'да' },
  { type: '`text/html`', chromium: 'да', firefox: 'да', webkit: 'да' },
  { type: '`image/png`', chromium: 'да', firefox: 'да', webkit: 'да' },
  { type: '`image/svg+xml`', chromium: 'да', firefox: 'нет', webkit: 'да' },
  { type: '`text/uri-list`', chromium: 'нет', firefox: 'нет', webkit: 'да' },
  { type: '`image/jpeg`', chromium: 'нет', firefox: 'нет', webkit: 'нет' },
  { type: '`application/json`', chromium: 'нет', firefox: 'нет', webkit: 'нет' },
  { type: '`web application/x-board+json`', chromium: 'да', firefox: 'нет', webkit: 'нет' },
];

export const SUPPORTS_NOTE =
  '`image/jpeg` не поддерживает никто: картинки в буфер кладут PNG. Chromium и Firefox на неподдержанный тип отклоняют `write` с `NotAllowedError`, а WebKit на стенде запись с `image/jpeg` и `application/json` не отклонил — молча. Отсюда правило: проверять `supports` до записи, а не надеяться на ошибку.';

/** Исполняется тестом: вывод сверяется с `SANITIZE_OUT` построчно. */
export const SANITIZE_CODE = `const html = '<b>жирный</b><img src="https://example.com/p.png" onerror="alert(1)"><script>alert(2)</script>';
await navigator.clipboard.write([new ClipboardItem({
  'text/html': new Blob([html], { type: 'text/html' }),
})]);

const [safe] = await navigator.clipboard.read();
console.log(await (await safe.getType('text/html')).text());

const [raw] = await navigator.clipboard.read({ unsanitized: ['text/html'] });
console.log(await (await raw.getType('text/html')).text());`;

export const SANITIZE_OUT = [
  '<b>жирный</b><img src="https://example.com/p.png">',
  '<html><head></head><body><b>жирный</b><img src="https://example.com/p.png" onerror="alert(1)"><script>alert(2)</script></body></html>',
];

export const SANITIZE_NOTE =
  '`read()` отдаёт HTML уже почищенным: `onerror` и `<script>` убраны. Так делают Chromium и Firefox. Chromium по флагу `unsanitized` отдаёт исходник целиком, Firefox этот флаг не слушает. Картинки браузер тоже не пропускает как есть: PNG из 103 байт вернулся из буфера 116 байтами — Chromium раскодировал его и закодировал заново, а «PNG» из случайных байтов не записал вовсе (`DataError`).';

export const SANITIZE_WARN =
  'Но чистка браузера вас не защищает. Во-первых, она есть не на каждом пути: событие `paste` отдаёт `getData(\'text/html\')` **как есть**, со скриптами и обработчиками. Во-вторых, даже почищенный HTML сохранил внешнюю картинку — это готовый пиксель слежения. Чужой HTML перед вставкой в DOM чистят самим: `setHTML` или DOMPurify, как разобрано в [«Безопасности фронтенда», раздел «XSS»](/platform/security/#s4).';

/** Исполняется тестом: вывод сверяется с `WEB_FORMAT_OUT` построчно. */
export const WEB_FORMAT_CODE = `const board = JSON.stringify({ cells: [[1, 2], [3, 4]] });
await navigator.clipboard.write([new ClipboardItem({
  'web application/x-board+json': new Blob([board], { type: 'web application/x-board+json' }),
  'text/plain': new Blob(['1\\t2\\n3\\t4'], { type: 'text/plain' }),
})]);

const [item] = await navigator.clipboard.read();
console.log(item.types.join(', '));
console.log(await (await item.getType('web application/x-board+json')).text());`;

export const WEB_FORMAT_OUT = ['web application/x-board+json, text/plain', '{"cells":[[1,2],[3,4]]}'];

export const PLAIN_WEB_FORMAT =
  'Свой формат — как записка на языке, который знают только свои. Ваше же приложение в другой вкладке прочитает её целиком: таблицу с формулами, а не просто цифры. Остальные программы её не поймут и возьмут то, что лежит рядом простым текстом.';

export const WEB_FORMAT_NOTE =
  'Тип с приставкой `web ` — **свой формат** (web custom format). Браузер не чистит его и не перекодирует: что положили, то и прочитали. Поэтому и разрешён он только с явной приставкой — каждый, кто его читает, знает, что данные не проверены. Есть он только в Chromium: в Firefox конструктор `ClipboardItem` с таким типом бросает `TypeError`, а WebKit на `supports` отвечает `false`. Простой текст рядом обязателен — это то, что получат все остальные.';

export const EVENT_TYPES_NOTE =
  'У событий правила другие. В `copy` через `setData` можно положить **любой** тип — например, `application/x-card`. Его увидит `paste` на любой странице во всех трёх движках, но `navigator.clipboard.read()` его не видит. И наоборот: формат с `web ` событие `paste` не показывает — в `types` только `text/plain`. Два пути к буферу пересекаются только на стандартных типах.';

// ─── Раздел 4. Перетаскивание ──────────────────────────────────────────────────────────────

export const DRAG_MARKUP = `<div id="card-42" draggable="true">Счёт №42</div>
<div id="paid">Оплаченные</div>`;

/** Исполняется тестом: `page.dragAndDrop('#card-42', '#paid')`, вывод — `DRAG_OUT`. */
export const DRAG_CODE = `const card = document.querySelector('#card-42');
const paid = document.querySelector('#paid');

card.addEventListener('dragstart', (event) => {
  event.dataTransfer.setData('text/plain', card.id);
  event.dataTransfer.effectAllowed = 'move';   // карточку можно только перенести
});

paid.addEventListener('dragenter', (event) => {
  const { types } = event.dataTransfer;
  console.log('dragenter', JSON.stringify(types), JSON.stringify(event.dataTransfer.getData('text/plain')));
});

paid.addEventListener('dragover', (event) => {
  event.preventDefault();                      // «сюда можно бросить»
});

paid.addEventListener('drop', (event) => {
  event.preventDefault();
  const id = event.dataTransfer.getData('text/plain');
  paid.append(document.getElementById(id));
  console.log('drop', id);
});

card.addEventListener('dragend', (event) => {
  console.log('dragend', event.dataTransfer.dropEffect);
});`;

export const DRAG_OUT = ['dragenter ["text/plain"] ""', 'drop card-42', 'dragend move'];

export const DRAG_NOTE =
  'Источник кладёт данные в `dragstart`, приёмник забирает их в `drop`, а `dragend` приходит источнику в конце и говорит, чем всё кончилось: `move` — перенесли, `none` — бросили мимо или приёмник отказался. Перетаскивать сами по себе можно картинки, ссылки и выделенный текст. У `<div>` `draggable` по умолчанию `false`, поэтому карточке нужен атрибут `draggable="true"`.';

export const PLAIN_DROP =
  'Перетаскивание — как поиск свободного места в зале с сумкой в руках. Над каждым местом вы спрашиваете: «можно сюда?» Место, которое промолчало, — занято. `dragover` и есть этот вопрос, а `preventDefault()` в нём — ответ «да, ставьте». Без ответа сумку поставить нельзя, и вы уносите её обратно.';

export const DRAGOVER_NOTE =
  'Действие по умолчанию у `dragover` — «сюда бросать нельзя». Почти все элементы страницы приёмниками не являются, и браузер считает так, пока код не отменит это действие. Уберите `preventDefault()` из `dragover` — и `drop` не придёт вовсе, а `dragend` скажет `none`. Отменять `dragenter` в Chromium для этого не нужно, хватает `dragover`. `preventDefault()` в `drop` отменяет уже другое: то, что браузер сделал бы с данными сам, — например, открыл брошенный файл или ссылку.';

export const EFFECT_NOTE =
  '`effectAllowed` выставляет источник: что с данными **можно** сделать — `copy`, `move`, `link`, их сочетания (`copyMove`) или `all`. `dropEffect` выставляет приёмник в `dragover`: что **будет** сделано. От него зависит значок у курсора. Если приёмник просит то, чего источник не разрешал, бросить не выйдет: при `effectAllowed = \'move\'` и `dropEffect = \'copy\'` `drop` не пришёл, `dragend` — `none`.';

export const KEYBOARD_NOTE =
  '**С клавиатуры перетащить нельзя.** `draggable` не делает элемент фокусируемым: у карточки `tabIndex` — `-1`, и Tab до неё не дойдёт. Человек без мыши или с экранным диктором карточку не перенесёт вовсе. Поэтому у перетаскивания всегда есть второй путь — кнопки «Выше» и «Ниже» или меню «Переместить в…». Того же требует WCAG 2.2, критерий 2.5.7: всё, что делается перетаскиванием, должно делаться и простым нажатием. Как устроены фокус и порядок Tab — в [«Дереве доступности», раздел «Фокус и порядок Tab»](/render/accessibility-tree/#s6).';

// ─── Раздел 5. Режимы DataTransfer ─────────────────────────────────────────────────────────

export const MODES_ROWS: { when: string; what: string }[] = [
  { when: '`dragstart`', what: 'читать и писать' },
  { when: '`dragenter`, `dragover`, `dragleave`', what: 'только `types` и `kind`/`type` у `items`; `getData` — пустая строка, `files` пуст' },
  { when: '`drop`', what: 'читать всё' },
  { when: '`copy`, `cut`', what: 'писать; в начале пусто' },
  { when: '`paste`', what: 'читать всё' },
  { when: 'после события: в таймере, после ожидания сети', what: 'ничего: `getData` — пустая строка, `files` и `items` пусты' },
];

export const MODES_NOTE =
  'Пока карточку везут через страницу, она проезжает над чужими элементами, а то и над чужим `<iframe>`. Если бы каждый `dragover` видел данные, любая страница читала бы всё, что над ней провезли. Поэтому в `dragenter` и `dragover` видно только **какого рода** груз: строчка `dragenter ["text/plain"] ""` в выводе выше — ровно это. Решать, принимать ли груз, приходится по `types`, а прочитать его можно только в `drop`.';

export const PLAIN_PROTECTED =
  'Как посылка на почте. Пока её несут мимо окошек, видна только наклейка: «документы», «хрупкое». Вскрыть её может только тот, кто расписался в получении, — обработчик `drop`. А потом коробку уносят: вернуться к ней через минуту нельзя.';

export const AFTER_NOTE =
  '`DataTransfer` живёт, пока идёт событие. Сохранили его в переменную и заглянули через таймер или после `await fetch(…)` — там пусто: `getData` вернёт пустую строку, `items` и `files` окажутся пустыми. Ожидание без настоящей паузы, вроде `await null`, ещё успевает, но строить на этом код не стоит. Сами `File` и записи о папках, взятые в обработчике, живут дальше. Значит, всё нужное забирают **синхронно, в самом обработчике**, а читают потом.';

export const FIREFOX_NOTE =
  'Firefox 155 при перетаскивании внутри одной страницы отдаёт данные и в `dragover`, и после события. Код, отлаженный в Firefox, в Chromium получит пустые строки. Полагайтесь на то, что обещает спецификация: в `dragover` — только `types`.';

export const SYNTHETIC_NOTE =
  'Защита касается только настоящих событий. `new DragEvent(\'dragover\', { dataTransfer })` с `DataTransfer`, собранным в коде, отдаёт данные в любом обработчике во всех трёх движках (`isTrusted` у него `false`). Тест на таких событиях пройдёт, а у живого человека тот же код увидит пустую строку. И ещё одна мелочь: тип в `setData` браузер переводит в строчные буквы — `Application/X-Card` превращается в `application/x-card`.';

// ─── Раздел 6. Файлы и папки из системы ────────────────────────────────────────────────────

export const FILE_DROP_MARKUP = '<div id="zone">Бросьте файлы или папку</div>';

/**
 * Исполняется тестом: CDP `Input.dispatchDragEvent` бросает на `#zone` настоящие пути
 * `tests/fixtures/clipboard-dnd/drop/note.txt` и `…/drop/photos`. Порядок внутри папки
 * не обещан, поэтому тест сверяет строки отсортированными.
 */
export const FILE_DROP_CODE = `const zone = document.querySelector('#zone');

zone.addEventListener('dragover', (event) => event.preventDefault());

zone.addEventListener('drop', async (event) => {
  event.preventDefault();
  // забрать записи сразу: после события items будет пуст
  const entries = [...event.dataTransfer.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry());

  for (const entry of entries) {
    for (const [path, size] of await walk(entry)) console.log(path, size);
  }
});

async function walk(entry, dir = '') {
  if (entry.isFile) {
    const file = await new Promise((ok, fail) => entry.file(ok, fail));
    return [[dir + file.name, file.size]];
  }
  const reader = entry.createReader();
  const found = [];
  for (;;) {
    // readEntries отдаёт содержимое папки пачками, пока не вернёт пустую
    const batch = await new Promise((ok, fail) => reader.readEntries(ok, fail));
    if (batch.length === 0) return found;
    for (const child of batch) found.push(...(await walk(child, dir + entry.name + '/')));
  }
}`;

export const FILE_DROP_OUT = ['note.txt 28', 'photos/1.txt 1', 'photos/2.txt 2'];

export const FILES_NOTE =
  'Бросили файл `note.txt` и папку `photos` с двумя файлами. Пока их везли над зоной, `dragover` видел `types` — `Files` — и два элемента в `items` с `kind: \'file\'`, но `files` был пуст. В `drop` пришло всё. Если нужны только файлы, хватит `dataTransfer.files` или `item.getAsFile()`; папку так не прочитать.';

export const FOLDER_NOTE =
  '**Папка в `files` притворяется файлом.** В `dataTransfer.files` она лежит как `File` с именем `photos`, пустым типом и размером, который ничего не значит: на нашем Mac — 128, число из файловой системы, а не содержимое. `await file.text()` на ней — `NotFoundError`. Отличить папку можно только через `item.webkitGetAsEntry()` (`isDirectory: true`) или, в Chromium, `item.getAsFileSystemHandle()` (`kind: \'directory\'`). `readEntries` отдаёт содержимое пачками по сто: на папке из 150 файлов — 100 и 50, поэтому его зовут в цикле до пустой пачки.';

export const GUARD_CODE = `// файл, брошенный мимо зоны, браузер откроет сам
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());`;

export const GUARD_NOTE =
  'Промахнулся мимо зоны — и браузер сделал с файлом то, что делает по умолчанию: Chromium открыл его в новой вкладке, по адресу `file://…`. Человек, который хотел загрузить файл, оказался на другой вкладке. Две строки на `window` отменяют это для всей страницы. Что делать с файлами дальше — отправить на сервер с прогрессом и докачкой — разобрано в [«Загрузке файлов»](/platform/uploads/).';

export const CLOSING =
  '**Буфер обмена и перетаскивание — один механизм с двумя входами.** Данные лежат в `DataTransfer` парами «тип → данные», а браузер решает, кому и когда их показать. Записать в буфер можно по жесту, прочитать — с разрешения. Чужой HTML чистят самим, даже если браузер уже почистил. В `dragover` видно только типы, данные — в `drop`, и забирать их нужно сразу, в обработчике.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '«Скопировать» работает у вас и не работает у пользователя',
    d: 'Проверяли из консоли DevTools — там запись падает с «Document is not focused», и наоборот: в коде по клику всё проходит. А у пользователя кнопка ждёт ответа сервера дольше, чем живёт жест. Лечение — `ClipboardItem` с промисом, `write` зовут сразу в клике.',
    tone: 'warn',
  },
  {
    n: '02',
    t: '`setData` в `copy` ничего не изменил',
    code: "document.addEventListener('copy', (e) => {\n  e.clipboardData.setData('text/plain', 'своё');\n  // нет e.preventDefault() — скопируется выделение\n});",
    d: 'Без `preventDefault()` браузер кладёт в буфер выделение, и записанное вами пропадает. Ошибки нет, просто не тот текст.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Перетаскивание не бросается',
    d: 'Курсор показывает запрет, `drop` не приходит. Почти всегда это `dragover` без `preventDefault()`. Реже — `dropEffect`, который источник не разрешил в `effectAllowed`.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`getData` в `dragover` возвращает пустую строку',
    d: 'Это не ошибка, а защита: во время перетаскивания видно только `types`. Подсвечивать зону по содержимому нельзя — только по типу. В Firefox данные видны и там, поэтому код, отлаженный в нём, в Chromium сломается.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Файлы пропали после `await`',
    d: '`dataTransfer` и `clipboardData` пустеют, как только событие закончилось. `File` и записи `webkitGetAsEntry()` забирают синхронно, первой строкой обработчика, а читают потом.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Загрузили папку как файл',
    d: 'В `files` папка — `File` без типа, и размер у него не про содержимое. Отправка на сервер упадёт на чтении (`NotFoundError`). Пропускайте элементы, у которых `webkitGetAsEntry().isDirectory`, или обходите их.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'W3C — Clipboard API and events',
    href: 'https://w3c.github.io/clipboard-apis/',
    what: '`navigator.clipboard`, `ClipboardItem`, события `copy`/`cut`/`paste`, санитизация и свои форматы',
  },
  {
    title: 'HTML Standard — Drag and drop',
    href: 'https://html.spec.whatwg.org/multipage/dnd.html',
    what: 'события перетаскивания, режимы `DataTransfer`, `effectAllowed` и `dropEffect`',
  },
  {
    title: 'HTML Standard — Tracking user activation',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation',
    what: 'что такое временная активация и сколько она живёт',
  },
  {
    title: 'web.dev — Unblocking clipboard access',
    href: 'https://web.dev/articles/async-clipboard',
    what: 'асинхронный буфер: разрешения, картинки, запись по промису',
  },
  {
    title: 'Chrome for Developers — Web custom formats for the Async Clipboard API',
    href: 'https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api',
    what: 'приставка `web `, зачем она и что видят системные программы',
  },
  {
    title: 'MDN — HTML Drag and Drop API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API',
    what: 'справочник по событиям и `DataTransfer`, поддержка в браузерах',
  },
  {
    title: 'MDN — DataTransferItem.webkitGetAsEntry()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry',
    what: 'папки при перетаскивании и обход `readEntries`',
  },
  {
    title: 'WCAG 2.2 — Understanding 2.5.7 Dragging Movements',
    href: 'https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html',
    what: 'почему у перетаскивания должен быть путь без перетаскивания',
  },
];

export const RELATED =
  'Смежное на сайте: [Ввод текста, раздел «Вставка и буфер обмена»](/render/text-input/#s5) — что браузер сам вставляет в поле и как вставить только текст. [События DOM](/render/dom-events/) — путь события и действие по умолчанию. [Безопасность фронтенда, раздел «XSS»](/platform/security/#s4) — как чистить чужой HTML. [Загрузка файлов](/platform/uploads/) — что делать с брошенными файлами дальше. [Двоичные данные, раздел «Blob и File»](/js/binary-data/#s5) — во что приходят картинки и файлы. [Дерево доступности](/render/accessibility-tree/) — фокус, роли и экранный диктор. [Страница и система](/js/os-integration/) — меню «Поделиться», ещё один способ отдать данные наружу.';
