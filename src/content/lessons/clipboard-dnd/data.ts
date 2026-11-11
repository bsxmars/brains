import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';

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
 * Уточнения 2026-11-11: Async Clipboard и событийный DataTransfer разделены по W3C Clipboard API;
 * политики разрешений — снимок стенда, не универсальное правило. LATE_CODE обрабатывает отказ
 * сети/записи (регрессия в e2e); PASTE_IMAGE_CODE освобождает URL; FILE_DROP_CODE пропускает null.
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
  "Буфер обмена похож на общий стол: текст из одной программы можно взять в другой. Браузер ограничивает доступ страницы к этому столу. Кнопка «Скопировать» просит доступ через `navigator.clipboard`; команда «Вставить» даёт обработчику `paste` данные конкретной вставки.";

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
  "Это записанный результат в Chromium 153: запись разрешена, а чтение сначала запрещено. После выдачи `clipboard-read` та же кнопка читает команду. Разрешение на запись не означает разрешение на чтение. У Firefox и Safari подтверждение устроено иначе. Клик — подходящее место для вызова, но не гарантия успеха: проверяйте промис и показывайте «Скопировано» только после его выполнения.";

export const COPY_ROWS: { when: string; write: string; read: string }[] = [
  { when: 'по клику, сразу', write: 'проходит', read: '`NotAllowedError`, пока пользователь не разрешил чтение' },
  { when: 'при загрузке страницы, без клика', write: '`NotAllowedError`', read: '`NotAllowedError`' },
  { when: 'через 6 с после клика (ждали ответа сервера)', write: '`NotAllowedError`', read: 'как без клика' },
  { when: 'сайту уже разрешено чтение', write: 'проходит и без клика', read: 'проходит' },
  { when: 'у документа нет фокуса: вызов из консоли DevTools, вкладка в фоне', write: '`NotAllowedError`: Document is not focused', read: 'то же' },
];

export const WHY_NOTE =
  "`navigator.clipboard` доступен в безопасном контексте, например HTTPS; документу нужен фокус. Дальше браузер применяет свою политику: временную активацию после действия человека, выданное разрешение или подтверждение вставки. Запись без контроля позволила бы подменять команды и адреса, чтение — забирать чужие пароли и переписку. Один клик не снимает все ограничения; `NotAllowedError` означает отказ, а точный текст сообщения зависит от браузера.";

export const PLAIN_ACTIVATION =
  "Временная активация — короткий срок после действия человека, когда страница может запросить ограниченную операцию. Как временный пропуск: если сначала долго ждать сервер, к моменту вызова `write` он может истечь. Конкретный срок задаёт браузер, поэтому фиксированная задержка не заменяет обработку отказа.";

export const ENGINE_ROWS: { engine: string; write: string; read: string }[] = [
  { engine: 'Chromium 153', write: 'по жесту, или без него, если сайту разрешено чтение', read: 'по разрешению `clipboard-read`: браузер один раз спрашивает пользователя' },
  { engine: 'Firefox 155', write: 'по жесту', read: 'по жесту. То, что записала ваша же страница, отдаёт сразу. Чужое — только после кнопки «Вставить» у курсора; без неё промис либо ждёт, либо отклоняется с `NotAllowedError` — в проверках встречалось и то и другое' },
  { engine: 'WebKit 26.6 (Safari)', write: 'по жесту', read: 'только через кнопку «Вставить», которую нажимает человек; в автотесте, где человека нет, — всегда `NotAllowedError`' },
];

/** Исполняется тестом: `/api/invite` отвечает через 6,5 с — дольше, чем живёт жест. */
export const LATE_CODE = `copy.addEventListener('click', () => {
  // write вызван сразу, пока жест жив; текст придёт позже
  const text = fetch('/api/invite')
    .then((response) => {
      if (!response.ok) throw new Error('Не удалось получить ссылку');
      return response.text();
    })
    .then((body) => new Blob([body], { type: 'text/plain' }));

  navigator.clipboard.write([new ClipboardItem({ 'text/plain': text })])
    .then(() => { copy.textContent = 'Скопировано'; })
    .catch((error) => {
      copy.textContent = 'Не удалось скопировать';
      console.log(error.name);
    });
});`;

export const LATE_NOTE =
  'Если текст ещё надо получить с сервера, передайте браузеру обещание будущих данных. `ClipboardItem` принимает вместо данных **промис**: `write` вызывают сразу, в обработчике клика, а промиса браузер дожидается сам. Браузер проверяет жест в момент вызова `write`, а не когда данные готовы. В нашей проверке ответ пришёл через 6,5 секунды — позже, чем живёт жест, — и запись всё равно прошла во всех трёх движках.';

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
    const url = URL.createObjectURL(file);
    img.onload = img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
    document.body.append(img);
    console.log(file.name, file.type);
  }
});`;

export const PASTE_IMAGE_OUT = 'image.png image/png';

export const PASTE_IMAGE_NOTE =
  'Картинка может прийти в `paste` **файлом**. В примере Chromium дал `Files` в `types` и `File` с именем `image.png`; имя и представления зависят от источника и браузера. Событие `paste` приходит туда, где фокус, даже если это кнопка, а не поле ввода, — поэтому слушают его на `document`. Что браузер сам вставит в `<input>` и `contenteditable`, если вы не отменили вставку, — в [«Вводе текста», раздел «Вставка и буфер обмена»](/render/text-input/#s5).';

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
  "Таблица показывает ответы `supports` на стенде, а не полный список возможностей платформы. Для совместимой записи картинки выбирают PNG. Chromium и Firefox отклоняли `write` с неподдержанным типом; WebKit не отклонил image/jpeg и application/json, хотя `supports` ответил false. Проверка `supports` помогает выбрать формат, но не отменяет обработку отказа `write`.";

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
  'В примере Chromium `read()` вернул почищенный HTML: `onerror` и `<script>` убраны. Так делают Chromium и Firefox. Chromium по флагу `unsanitized` отдаёт исходник целиком, Firefox этот флаг не слушает. Картинки браузер тоже не пропускает как есть: PNG из 103 байт вернулся из буфера 116 байтами — Chromium раскодировал его и закодировал заново, а «PNG» из случайных байтов не записал вовсе (`DataError`).';

export const SANITIZE_WARN =
  'Но чистка браузера вас не защищает. Во-первых, она есть не на каждом пути: нельзя переносить результат Async Clipboard на `getData(\'text/html\')` в событии `paste` и считать его безопасным. Во-вторых, даже почищенный HTML сохранил внешнюю картинку — это готовый пиксель слежения. Чужой HTML перед вставкой в DOM чистят самим: `setHTML` или DOMPurify, как разобрано в [«Безопасности фронтенда», раздел «XSS»](/platform/security/#s4).';

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
  "Тип с приставкой web — свой формат (web custom format): приложение само задаёт содержимое и отвечает за его проверку. На стенде он поддерживается в Chromium, Firefox бросает TypeError в конструкторе, WebKit отвечает false на `supports`. Простой текст рядом — запасное представление для программ, которые не знают формат приложения.";

export const EVENT_TYPES_NOTE =
  'У событий правила другие. В `copy` через `setData` можно положить **любой** тип — например, `application/x-card`. Его увидит `paste` на любой странице во всех трёх движках, но `navigator.clipboard.read()` его не видит. И наоборот: формат с `web ` событие `paste` не показывает — в `types` только `text/plain`. Получается, что события и `navigator.clipboard` видят общие данные только для стандартных типов вроде `text/plain`.';

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
  if (id !== card.id) return;                  // принимаем только нашу карточку
  paid.append(card);
  console.log('drop', id);
});

card.addEventListener('dragend', (event) => {
  console.log('dragend', event.dataTransfer.dropEffect);
});`;

export const DRAG_OUT = ['dragenter ["text/plain"] ""', 'drop card-42', 'dragend move'];

export const DRAG_NOTE =
  'Источник кладёт данные в `dragstart`, приёмник забирает их в `drop`, а `dragend` приходит источнику в конце и говорит, чем всё кончилось: `move` — перенесли, `none` — бросили мимо или приёмник отказался. Перетаскивать сами по себе можно картинки, ссылки и выделенный текст. Идентификатор из переноса — входные данные: приёмник проверяет, что это его карточка, а не произвольный элемент страницы. У обычного `<div>` свойство `draggable` по умолчанию равно `false`, поэтому карточке нужен атрибут `draggable="true"`.';

export const PLAIN_DROP =
  'Перетаскивание — как поиск свободного места в зале с сумкой в руках. Над каждым местом вы спрашиваете: «можно сюда?» Место, которое промолчало, — занято. `dragover` и есть этот вопрос, а `preventDefault()` в нём — ответ «да, ставьте». Без ответа сумку поставить нельзя, и вы уносите её обратно.';

export const DRAGOVER_NOTE =
  'Действие по умолчанию у `dragover` — «сюда бросать нельзя». Почти все элементы страницы приёмниками не являются, и браузер считает так, пока код не отменит это действие. Уберите `preventDefault()` из `dragover` — и `drop` не придёт вовсе, а `dragend` скажет `none`. Отменять `dragenter` в Chromium для этого не нужно, хватает `dragover`. `preventDefault()` в `drop` отменяет уже другое: то, что браузер сделал бы с данными сам, — например, открыл брошенный файл или ссылку.';

export const EFFECT_NOTE =
  '`effectAllowed` выставляет источник: что с данными **можно** сделать — `copy`, `move`, `link`, их сочетания (`copyMove`) или `all`. `dropEffect` выставляет приёмник в `dragover`: что **будет** сделано. От него зависит значок у курсора. Если приёмник просит то, чего источник не разрешал, бросить не выйдет: при `effectAllowed = \'move\'` и `dropEffect = \'copy\'` `drop` не пришёл, `dragend` — `none`.';

export const KEYBOARD_NOTE =
  "**`draggable` не создаёт доступное управление.** У карточки из примера `tabIndex` равен -1: одного атрибута недостаточно ни для фокуса по Tab, ни для команды переноса с клавиатуры. Добавьте кнопки «Выше»/«Ниже» или меню «Переместить в…», доступные и клавиатуре, и обычному нажатию. WCAG 2.2, критерий 2.5.7, отдельно требует альтернативу перетаскиванию одним указателем, кроме предусмотренных критерием исключений; это не замена требованиям клавиатурной доступности. Фокус разобран в [«Дереве доступности»](/render/accessibility-tree/#s6).";

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
  'Пока карточку везут через страницу, она проезжает над чужими элементами, а то и над чужим `<iframe>`. Если бы каждый `dragover` видел данные, любая страница читала бы всё, что над ней провезли. Поэтому в `dragenter` и `dragover` видно только **тип** данных: строчка `dragenter ["text/plain"] ""` в выводе примера показывает тип `text/plain` и пустую строку вместо самих данных. Решать, принимать ли груз, приходится по `types`, а прочитать его можно только в `drop`.';

export const PLAIN_PROTECTED =
  "Пока посылку несут, видна наклейка с типом содержимого. На выдаче её можно открыть. Сохранить номер окна выдачи — не то же самое, что забрать посылку: ссылка на `DataTransfer` не заменяет данные, полученные в обработчике.";

export const AFTER_NOTE =
  "Ссылка на `DataTransfer` не сохраняет право читать хранилище события. После завершения обработчика нельзя рассчитывать на его `getData`, `files` и `items`. Строку, `File` или запись папки забирают синхронно; собственная строка и полученные объекты остаются доступны для дальнейшей обработки. Сохранить массив `items` недостаточно: это ещё объекты доступа к хранилищу, а не сами файлы. Поэтому `webkitGetAsEntry` вызывается до первого `await` в примере «Файлы и папки».";

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
    .map((item) => item.webkitGetAsEntry())
    .filter((entry) => entry !== null);

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
  "**Папка в `files` может выглядеть как `File`.** На стенде Chromium она пришла с пустым типом, служебным размером и отказом `NotFoundError` при `text()`. Это не размер содержимого. Для обхода используют запись `webkitGetAsEntry` с `isDirectory` или поддерживаемый браузером `getAs`File`SystemHandle`. `readEntries` может возвращать содержимое несколькими пачками: в Chromium на 150 файлах пришли 100 и 50. Цикл завершается только пустой пачкой, а не заданным числом записей.";

export const GUARD_CODE = `// файл, брошенный мимо зоны, браузер откроет сам
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());`;

export const GUARD_NOTE =
  'Если человек промахнулся мимо зоны, браузер делает с файлом то, что делает по умолчанию: Chromium открыл его в новой вкладке, по адресу `file://…`. Человек хотел загрузить файл, а оказался на другой вкладке. Две строки на `window` отменяют это для всей страницы. Что делать с файлами дальше — отправить на сервер с прогрессом и докачкой — разобрано в [«Загрузке файлов»](/platform/uploads/).';

export const CLOSING =
  "Общий принцип — передавать данные вместе с их типом, но способы доступа различаются. `navigator.clipboard` использует промисы и `ClipboardItem`; события копирования, вставки и перетаскивания дают `DataTransfer` на время обработки события. Забранные строки, `File` и записи папок можно обрабатывать дальше, даже когда доступ через событие уже закрыт.";

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
    t: 'Карточка не переносится',
    d: 'Курсор показывает запрет, `drop` не приходит. Почти всегда это `dragover` без `preventDefault()`. Реже — `dropEffect`, который источник не разрешил в `effectAllowed`.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`getData` в `dragover` возвращает пустую строку',
    d: 'Так браузер защищает данные: во время перетаскивания видно только `types`. Подсвечивать зону по содержимому нельзя — только по типу. В Firefox данные видны и там, поэтому код, отлаженный в нём, в Chromium сломается.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Файлы пропали после `await`',
    d: 'После события доступ через `dataTransfer` и `clipboardData` больше не гарантирован. `File` и записи `webkitGetAsEntry()` забирают синхронно, первой строкой обработчика, а читают потом.',
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

/** Схема FILE_DROP_CODE: доступ события и полученные записи имеют разный срок жизни. */
export const FILE_CAPTURE_DIAGRAM: ConceptDiagramData = {
  id: 'file-capture',
  title: 'Забрать запись сейчас, читать файл позже',
  description: 'Схема обработки файлов из примера обхода папки. Стрелки показывают порядок действий, а не длительность. Защищённый режим соответствует HTML Standard; отличие Firefox разобрано в разделе «Режимы DataTransfer».',
  width: 920,
  height: 560,
  nodes: [
    { id: 'over', x: 0, y: 20, width: 260, height: 180, label: 'dragover', detail: 'Видны типы. preventDefault разрешает принять перенос.', tone: 'info' },
    { id: 'drop', x: 330, y: 20, width: 260, height: 180, label: 'drop', detail: 'Сейчас можно читать dataTransfer.items.', tone: 'info' },
    { id: 'entries', x: 660, y: 20, width: 260, height: 180, label: 'Записи папок и файлов', detail: 'webkitGetAsEntry вызывается синхронно, до await.', tone: 'ok' },
    { id: 'closed', x: 330, y: 350, width: 260, height: 180, label: 'Доступ закрыт', detail: 'Сохранённый DataTransfer не удерживает данные события.', tone: 'warn' },
    { id: 'walk', x: 660, y: 350, width: 260, height: 180, label: '`await walk(entry)`', detail: 'Полученные записи позволяют читать файлы и обходить папки.', tone: 'ok' },
  ],
  edges: [
    { from: 'over', to: 'drop', label: 'бросили', labelX: 295, labelY: 85 },
    { from: 'drop', to: 'entries', label: 'забрать', labelX: 625, labelY: 85 },
    { from: 'drop', to: 'closed', fromSide: 'bottom', toSide: 'top', label: 'событие завершено', labelX: 360, labelY: 275 },
    { from: 'entries', to: 'walk', fromSide: 'bottom', toSide: 'top', label: 'асинхронное чтение', labelX: 780, labelY: 275 },
  ],
  note: 'Копировать только items в массив недостаточно: нужны File или записи, полученные из них во время drop.',
};
