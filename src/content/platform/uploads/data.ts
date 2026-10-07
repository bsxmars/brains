import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Загрузка файлов: multipart, докачка, прямо в хранилище».
 *
 * Тема написана здесь, 2026-10-02, по списку кандидатов направления «Сеть и безопасность».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Node 24.11.0 (встроенный `fetch` — undici 7.16.0), Chromium 153.0.8010.12 (Playwright 1.63,
 * headless), `tus-js-client` 4.3.1, `@tus/server` 2.4.5, `@tus/file-store` 2.1.1 — всё из
 * `node_modules` проекта, октябрь 2026. Серверы — свои, на `node:http` / `node:http2`.
 *
 * multipart: одна и та же `FormData` (`MP_FORM_CODE`) отправлена `fetch` из Node и из Chromium
 * на сервер, который сохранил тело байт в байт. Тела совпали во всём, кроме границы:
 * undici — `----formdata-undici-0` + 11 цифр (тело 443 байта), Chromium — `----WebKitFormBoundary`
 * + 16 символов (467 байт); `Content-Length` выставлен в обоих, `Transfer-Encoding` нет. Отправка
 * настоящей `<form enctype="multipart/form-data">` в Chromium дала то же устройство тела.
 * Проверено там же: `\n`, `\r` и `\r\n` в строковом значении приходят как CRLF; в имени поля
 * перевод строки — `%0D%0A`, в имени файла `\n` — `%0A`, кавычка — `%22`; `Blob` без имени —
 * `filename="blob"`, без типа — `application/octet-stream`; байты файла не трогаются (LF внутри
 * CSV остался LF). Имя файла `../../etc/passwd` из `new File(…)` уходит как есть в обоих.
 * Разбор: `Response.formData()` над телом из Node — undici возвращает имя `a"b.bin`
 * (раскодировал `%22`), Chromium — `a%22b.bin` (оставил). `printBytes` (`model/run.ts`)
 * печатает тело Chromium — это `MP_BODY_PRINT`.
 *
 * Прогресс (Chromium): XHR c телом 8 МиБ на локальный HTTP/1.1-сервер, который читает тело
 * быстро, — одно событие `progress` (сразу 8 388 608 из 8 388 608), порядок `loadstart`,
 * `progress`, `load`, `loadend`. Сервер, который читает порциями с паузой 15 мс: 17 и 15
 * событий в двух прогонах, первое — уже на 1,98 и 1,15 МиБ; в момент `upload.onload`
 * (100%) сервер прочёл 7 045 048 и 7 028 736 байт из 8 388 608. Числа зависят от буферов ОС
 * и от нагрузки — в тексте только порядок величины, тест держит отношения («событий больше
 * одного», «на 100% сервер прочёл не всё»). Preflight: простой POST `text/plain` через XHR
 * на чужой порт — без preflight; тот же с `xhr.upload.onprogress` — сначала `OPTIONS`; `fetch`
 * тем же простым запросом — без preflight. `fetch` с телом-стримом (`duplex: 'half'`) по
 * HTTP/1.1 — `TypeError: Failed to fetch`; по HTTP/2 (свой `http2.createSecureServer`,
 * самоподписанный сертификат) — проходит, а сервер, не читающий тело, получил 0 байт, пока
 * стрим отдал 196 608 (три куска по 64 КиБ, `highWaterMark: 0`). HTTP/2-замер в тест не
 * вынесен: нужен сертификат; он снят один раз стендом.
 *
 * tus: `@tus/server` + `FileStore` за прокси, который ведёт журнал и рвёт PATCH, пропустив
 * 150 000 байт тела суммарно (сначала байты доходят до сервера, потом обрыв обеих сторон).
 * Файл 300 000 байт, `chunkSize: 100 000`. Node-клиент `tus-js-client`: последовательность
 * `TUS_LOG` — после обрыва `HEAD` вернул `Upload-Offset: 150000`, то есть сервер сохранил
 * дошедшие 50 000 байт, и следующий кусок пошёл с 150 000; файл на диске совпал с исходным.
 * ⚠️ Первая версия прокси рвала соединение, не дождавшись отправки, — тогда сервер получал 0
 * байт обрывка, а когда прокси продолжал пересылать данные после обрыва, файл на диске
 * **испортился молча** (смещения совпали, байты — нет). Протокол сверяет только смещение,
 * не содержимое; контрольные суммы — отдельное расширение `checksum`.
 * Chromium (`dist/tus.min.js`, XHR, `retryDelays: null`): после обрыва браузер **сам повторил
 * PATCH** с прежним `Upload-Offset: 100000` и получил `409`; повторил ли — зависит от того,
 * было ли соединение переиспользовано: с `Connection: close` на каждом ответе повтора нет,
 * клиент видит сетевую ошибку. Три прогона из трёх. Затем перезагрузка страницы:
 * в `localStorage` ключ `tus::tus-br-video.mp4-video/mp4-300000-<lastModified>-/files::<число>`,
 * `findPreviousUploads()` нашёл одну запись, `resumeFromPreviousUpload` → `HEAD` (150000) →
 * два PATCH; после успеха запись в `localStorage` осталась (`removeFingerprintOnSuccess: false`
 * по умолчанию). Отпечаток файла — `fileSignature.js` в исходниках клиента: имя, тип, размер,
 * `lastModified`, адрес; содержимое в него не входит.
 *
 * Подпись: `PRESIGN_CODE` даёт на примере из документации AWS («Authenticating Requests: Using
 * Query Parameters», раздел «An Example») ту же хеш-сумму канонического запроса `3bfa2928…`,
 * ту же подпись `aeeed9bb…` и тот же URL до символа. С настоящим S3 **не сверялось**: всё
 * про поведение хранилища (что подписано, срок до 7 дней, политика POST с
 * `content-length-range`, CORS бакета) — из документации AWS, не отсюда. `verifyPresigned` —
 * учебная проверка «как это делает хранилище», сверена только с самой собой (круговой тест,
 * подмена пути, метода, срока).
 *
 * Тоже только из документации: `client_max_body_size` nginx по умолчанию 1 МБ, лимит S3 на
 * один PUT — 5 ГБ.
 *
 * Пересобирается `tests/unit/uploads.test.ts`: тела multipart (Node и Chromium), разбор,
 * журнал tus с Node-клиентом, повтор PATCH в Chromium, прогресс XHR и preflight, пример AWS,
 * `413` от `@tus/server` с `maxSize`.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: '`multipart/form-data`',
    d: 'Формат тела запроса, в котором едут сразу несколько полей формы, в том числе файлы. Каждое поле — отдельная часть со своими заголовками, части разделены строкой-границей.',
  },
  {
    k: 'граница (boundary)',
    d: 'Случайная строка, которую отправитель выбирает для одного запроса и пишет в заголовок `Content-Type`. В теле она стоит между частями, так сервер понимает, где кончается одно поле и начинается другое.',
  },
  {
    k: 'кусок (chunk)',
    d: 'Часть файла, которую отправляют отдельным запросом. Большой файл делят на куски, чтобы обрыв связи стоил одного куска, а не всего файла.',
  },
  {
    k: 'смещение (offset)',
    d: 'Номер байта, с которого продолжать: сколько байт файла уже лежит на сервере. В протоколе tus его несёт заголовок `Upload-Offset`.',
  },
  {
    k: 'tus',
    d: 'Открытый протокол докачки поверх обычного HTTP: создать загрузку, слать куски, после обрыва спросить сервер, сколько дошло, и продолжить с этого места.',
  },
  {
    k: 'объектное хранилище',
    d: 'Сервис, который хранит файлы по ключу: Amazon S3 и совместимые с ним (MinIO, Yandex Object Storage, Cloudflare R2). Файл кладут запросом `PUT` на адрес вида `бакет/ключ`.',
  },
  {
    k: 'presigned URL (ссылка с подписью)',
    d: 'Адрес хранилища, в который сервер вашего сайта заранее вписал разрешение: что можно сделать, с каким файлом и до какого времени, — и подписал его своим секретом. С этой ссылкой браузер идёт в хранилище сам.',
  },
  {
    k: 'HMAC',
    d: 'Подпись общим секретом: хеш от сообщения, перемешанного с ключом. Подделать её без ключа нельзя, проверить может только тот, кто ключ знает.',
  },
];

export const PLAIN_UPLOAD =
  'Как отправить шкаф. Можно привезти его целиком в одной машине вместе с документами — это multipart. Можно разобрать на коробки и везти по одной, отмечая в накладной, сколько уже доставлено, — тогда сломанная машина стоит одной коробки, а не всего шкафа. А можно не возить через свой склад вовсе: выдать покупателю пропуск на склад перевозчика, где написано, что и до какого числа ему можно сдать, — это ссылка с подписью.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи из других тем: как форма собирает поля, когда браузер шлёт preflight, как устроено тело-стрим и что такое поток HTTP/2.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: '`FormData`',
    d: 'Набор пар «имя — значение», который браузер собирает из полей формы или вы сами — через `append`. Какие поля в него попадают, а какие теряются, разобрано отдельно; здесь — во что он превращается в сети.',
    href: '/frameworks/forms/#s7',
    hrefLabel: '«Формы во фреймворках», раздел «Отправка»',
    tone: 'info',
  },
  {
    t: 'Preflight',
    d: 'Перед «непростым» запросом на чужой источник браузер спрашивает разрешения запросом `OPTIONS`. Простым запрос остаётся при узком наборе методов, заголовков и типов тела — `multipart/form-data` в этом наборе есть.',
    href: '/platform/security/#s2',
    hrefLabel: '«Безопасность фронтенда», раздел «CORS и preflight»',
    tone: 'info',
  },
  {
    t: 'Тело запроса стримом',
    d: '`fetch` умеет отправлять тело кусками по мере готовности — `ReadableStream` с `duplex: \'half\'`. В браузере это работает только по HTTP/2.',
    href: '/platform/streams/#s6',
    hrefLabel: '«Стримы и обратное давление», раздел «Итерация и байты»',
    tone: 'info',
  },
  {
    t: 'Поток и окно HTTP/2',
    d: 'По одному соединению HTTP/2 идут параллельные потоки, и у каждого есть окно — сколько байт можно отправить, не дожидаясь, пока получатель их прочтёт.',
    href: '/platform/http2-http3/#s3',
    hrefLabel: '«HTTP/2 и HTTP/3», раздел «Потоки и окно»',
    tone: 'info',
  },
];

// ─── Раздел 1. Тело multipart ──────────────────────────────────────────────────────────────

/** Эта же строка исполняется в Node и в Chromium тестом: её `FormData` уходит `fetch`. */
export const MP_FORM_CODE = `const form = new FormData();
form.append('title', 'Отчёт за май');
form.append('report', new Blob(['id;sum\\n1;500\\n'], { type: 'text/csv' }), 'май.csv');
form.append('raw', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])]), 'a"b.bin');

await fetch('/upload', { method: 'POST', body: form });`;

/** Те же поля в виде, который принимает `encodeMultipart`. Тест сверяет их с `MP_FORM_CODE`. */
export const MP_ENTRIES_SPEC = [
  { name: 'title', value: 'Отчёт за май' },
  { name: 'report', filename: 'май.csv', type: 'text/csv', text: 'id;sum\n1;500\n' },
  { name: 'raw', filename: 'a"b.bin', type: '', bytes: [0x89, 0x50, 0x4e, 0x47] },
] as const;

export const MP_BOUNDARY_CHROMIUM = '----WebKitFormBoundarysV9IdCCAgZcy6ICM';
export const MP_BOUNDARY_NODE = '----formdata-undici-040336589709';

/** Тело из Chromium, напечатанное `printBytes`: `␍␊` — CRLF, `␊` — одиночный LF, `\x89` — байт. */
export const MP_BODY_PRINT = `------WebKitFormBoundarysV9IdCCAgZcy6ICM␍␊
Content-Disposition: form-data; name="title"␍␊
␍␊
Отчёт за май␍␊
------WebKitFormBoundarysV9IdCCAgZcy6ICM␍␊
Content-Disposition: form-data; name="report"; filename="май.csv"␍␊
Content-Type: text/csv␍␊
␍␊
id;sum␊
1;500␊
␍␊
------WebKitFormBoundarysV9IdCCAgZcy6ICM␍␊
Content-Disposition: form-data; name="raw"; filename="a%22b.bin"␍␊
Content-Type: application/octet-stream␍␊
␍␊
\\x89PNG␍␊
------WebKitFormBoundarysV9IdCCAgZcy6ICM--␍␊`;

export const MP_HEADER_CODE = `Content-Type: multipart/form-data; boundary=----WebKitFormBoundarysV9IdCCAgZcy6ICM
Content-Length: 467`;

export const PLAIN_BOUNDARY =
  'Как закладки в стопке бумаг, которую отправляют одним конвертом. Отправитель берёт полоску с узором, которого точно нет ни на одном листе, и кладёт её между документами, а образец полоски пишет на конверте. Получатель режет стопку по этим полоскам. Узор случайный и длинный, поэтому шанс встретить его внутри письма ничтожен.';

export const MP_ROWS: { k: string; node: string; chromium: string; tone?: 'ok' | 'warn' }[] = [
  { k: 'граница', node: '`----formdata-undici-0` и 11 цифр', chromium: '`----WebKitFormBoundary` и 16 букв и цифр' },
  { k: 'длина тела', node: '443 байта', chromium: '467 байт — граница длиннее на 6 символов, а встречается она 4 раза' },
  { k: '`Content-Length`', node: 'есть', chromium: 'есть', tone: 'ok' },
  { k: 'всё остальное', node: 'байт в байт как у Chromium', chromium: 'байт в байт как у Node', tone: 'ok' },
];

export const MP_RULES: string[] = [
  '**Текст нормализуется, файл — нет.** `\\n`, `\\r` и `\\r\\n` в строковом значении приходят как CRLF. Байты файла идут как есть: перевод строки внутри CSV остался одиночным `␊`.',
  '**Кавычка и перевод строки в имени экранируются процентами:** `a"b.bin` уходит как `a%22b.bin`. Обратно их раскодирует не каждый: `Response.formData()` в Node вернул `a"b.bin`, в Chromium — `a%22b.bin`.',
  '**Без имени и без типа:** `Blob` без третьего аргумента уходит как `filename="blob"`, без типа — `Content-Type: application/octet-stream`.',
  '**Граница — заголовок запроса, а не договорённость.** Без неё в `Content-Type` сервер не найдёт частей, поэтому `Content-Type` для `FormData` руками не ставят: браузер впишет его сам, вместе с границей.',
];

export const MP_NOTE =
  'Разбор — обратная дорога: найти в байтах первую строку `--граница`, прочитать заголовки части до пустой строки, взять данные до следующего `␍␊--граница` и так до `--граница--`. Искать приходится в байтах, а не в строке: файл не обязан быть текстом, и декодировать его как UTF-8 нельзя — испортятся байты вроде `\\x89`.';

export const DEMO_CAPTION =
  'Тело собрано функцией темы, разобрано обратно второй функцией. Попробуйте кавычку или перевод строки в имени файла и в тексте поля: первая станет `%22`, а перевод строки в тексте превратится в CRLF — в отличие от байт файла.';

// ─── Раздел 2. Прогресс отправки ───────────────────────────────────────────────────────────

/** Исполняется в Chromium тестом: на медленном сервере событий больше одного. */
export const PROGRESS_CODE = `function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Прогресс отправки — у xhr.upload, прогресс ответа — у самого xhr.
    xhr.upload.onprogress = (e) => onProgress(e.loaded, e.total);
    xhr.onload = () => resolve(xhr.status);   // ответ пришёл — файл принят
    xhr.onerror = () => reject(new TypeError('сеть'));
    xhr.open('POST', url);
    xhr.send(file);
  });
}`;

export const PROGRESS_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Событий мало и они неравномерны',
    d: 'Восемь мебибайт на быстрый локальный сервер дали **одно** событие `progress` — сразу на 100%. На сервер, который читает медленно, — полтора десятка, и первое приходит, когда «отправлено» уже 1–2 МиБ: столько поместилось в буферы операционной системы.',
  },
  {
    t: '100% — не «сервер принял»',
    d: '`loaded` считает байты, отданные сети, а не прочитанные сервером. В момент `upload.onload` медленный сервер прочёл около 7 МиБ из 8. Конец загрузки — это ответ сервера, `xhr.onload`, а не последнее событие прогресса.',
    tone: 'warn',
  },
  {
    t: 'Подписка на прогресс делает запрос «непростым»',
    d: 'Тот же POST `text/plain` на чужой источник уходит сразу, а с обработчиком на `xhr.upload` — после `OPTIONS`. Причина — правило простых запросов из [«Безопасности фронтенда»](/platform/security/#s2): слушатель на `upload` в нём прямо запрещён.',
    tone: 'warn',
  },
];

export const FETCH_PROGRESS_NOTE =
  'У `fetch` прогресса отправки нет вовсе: ни события, ни поля. Обходной путь один — отдать тело стримом и считать, сколько байт стрим уже отдал. Он работает только по HTTP/2 (по HTTP/1.1 Chromium отвечает `TypeError: Failed to fetch` — подробно в [«Стримах»](/platform/streams/#s6)), и считает он не то: сервер, который не читал тело, получил **0 байт**, а стрим к этому моменту отдал **196 608** — они ждали в буферах и в окне потока HTTP/2. Для полосы загрузки файла `XMLHttpRequest` остаётся честнее.';

export const PLAIN_PROGRESS =
  'Как отправка посылок через окошко почты. Счётчик «отдано» растёт, когда коробка ушла с вашего стола в окошко, а не когда её получил адресат. Пока очередь за окошком не разобрана, вы уже «отправили всё», а у адресата ещё пусто. Доставку подтверждает только ответ.';

// ─── Раздел 3. Докачка: tus ────────────────────────────────────────────────────────────────

/**
 * Последовательность, снятая стендом: `tus-js-client` 4.3.1 в Node → прокси с обрывом →
 * `@tus/server` 2.4.5 + `FileStore`. Пересобирается тестом.
 */
export const TUS_LOG: { req: string; status: string; res: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { req: '`POST /files`, `Upload-Length: 300000`', status: '`201`', res: '`Location: /files/<id>`' },
  { req: '`PATCH`, `Upload-Offset: 0`, тело 100 000', status: '`204`', res: '`Upload-Offset: 100000`', tone: 'ok' },
  { req: '`PATCH`, `Upload-Offset: 100000`, тело 100 000', status: 'нет — обрыв на 50 000-м байте', res: '—', tone: 'err' },
  { req: '`HEAD`', status: '`200`', res: '`Upload-Offset: 150000`', tone: 'warn' },
  { req: '`PATCH`, `Upload-Offset: 150000`, тело 100 000', status: '`204`', res: '`Upload-Offset: 250000`', tone: 'ok' },
  { req: '`PATCH`, `Upload-Offset: 250000`, тело 50 000', status: '`204`', res: '`Upload-Offset: 300000`', tone: 'ok' },
];

export const TUS_LOG_NOTE =
  'Сервер сохранил 50 000 байт, которые дошли до обрыва, и `HEAD` об этом сказал. Клиент не повторяет кусок целиком, а продолжает со 150 000 — и границы кусков сдвигаются: последний PATCH везёт 50 000 байт, а не 100 000. Решает, откуда продолжать, сервер, а не клиент: клиент знает только, сколько отправил, а не сколько дошло.';

export const PLAIN_OFFSET =
  'Как переезд с накладной. Грузчики возят коробки, а на складе ведут учёт: «принято 15 коробок». Машина сломалась по дороге — водитель не гадает, что успел выгрузить, а звонит на склад и спрашивает номер последней принятой коробки. Склад же не примет коробку №12, если по учёту ждёт №16: так одна коробка не окажется на полке дважды.';

export const TUS_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: '`409` — защита от двойной записи',
    d: 'PATCH со смещением, которое не совпадает с серверным, сервер отклоняет `409 Conflict` и ничего не пишет. В Chromium это видно вживую: после обрыва браузер **сам повторил** PATCH с прежним `Upload-Offset: 100000` — соединение было переиспользовано, а такие запросы Chromium повторяет при сбросе. Сервер к этому времени держал 150 000 и ответил `409`. Без проверки смещения 50 000 байт легли бы в файл дважды.',
    tone: 'warn',
  },
  {
    t: 'Докачка после перезагрузки страницы',
    d: '`tus-js-client` в браузере кладёт адрес загрузки в `localStorage` под отпечатком файла. После перезагрузки `findPreviousUploads()` находит запись, `resumeFromPreviousUpload()` подставляет адрес, и клиент начинает с `HEAD`. Отпечаток — имя, тип, размер, `lastModified` и адрес сервера; **содержимое в него не входит**.',
  },
  {
    t: 'Смещение сверяется, содержимое — нет',
    d: 'Протокол следит, чтобы байты легли на своё место, но не проверяет, те ли это байты. Испорченный по дороге кусок с верным смещением сервер примет. Для этого есть отдельное расширение `checksum`: клиент шлёт хеш куска в заголовке `Upload-Checksum`.',
    tone: 'warn',
  },
];

export const TUS_DEMO_CAPTION =
  'Учебный клиент и учебный сервер из этого раздела, между ними — сеть, которая один раз рвётся. Сдвигайте место обрыва: при обрыве посреди куска сервер сохраняет дошедшее, и следующий PATCH начинается не с границы куска. Обрыв ровно на границе даёт `HEAD` с тем же числом, что и последний ответ.';

// ─── Раздел 4. Прямо в хранилище ───────────────────────────────────────────────────────────

export const DIRECT_CHIPS: { label: string; tone: 'ink' | 'info' | 'ok' }[] = [
  { label: 'браузер → ваш API: «хочу загрузить avatar.png, 2 МБ»', tone: 'ink' },
  { label: 'API: проверяет права, выбирает ключ, подписывает URL', tone: 'info' },
  { label: 'браузер → хранилище: PUT по ссылке', tone: 'ink' },
  { label: 'хранилище: проверяет подпись и срок', tone: 'info' },
  { label: 'браузер → ваш API: «готово»', tone: 'ok' },
];

export const DIRECT_NOTE =
  'Файл не проходит через ваш сервер: тот только решает, можно ли, и подписывает разрешение. Секрет при этом никуда не уезжает. В ссылке лежат ключ доступа (имя, не секрет), дата, срок и подпись — HMAC от описания запроса. Хранилище знает тот же секрет, считает подпись заново и сравнивает.';

/** Пример из документации AWS: эти значения дают подпись `aeeed9bb…`, тест сверяет. */
export const AWS_EXAMPLE = {
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  path: '/test.txt',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',
  secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  date: '20130524T000000Z',
  expires: 86400,
};

export const AWS_SIGNATURE = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
export const AWS_CANONICAL_HASH = '3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04';

export const SIGNED_ROWS: { k: string; v: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'метод', v: 'подписан: ссылку на `GET` нельзя использовать для `PUT`', tone: 'ok' },
  { k: 'путь (ключ объекта)', v: 'подписан: другой файл по той же подписи не положить', tone: 'ok' },
  { k: 'хост, дата, срок, ключ доступа', v: 'подписаны: продлить ссылку, исправив `X-Amz-Expires`, нельзя', tone: 'ok' },
  { k: '`Content-Type`', v: 'не подписан, если его нет в `X-Amz-SignedHeaders`: по ссылке для картинки положат что угодно', tone: 'warn' },
  { k: 'размер и содержимое', v: 'не подписаны (`UNSIGNED-PAYLOAD`): ограничить размер ссылка для `PUT` не может', tone: 'err' },
];

export const DIRECT_FACTS: { t: string; d: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  {
    t: 'Ссылка — это пропуск, а не адрес',
    d: 'Кто держит ссылку, тот и пользуется ею до конца срока: никакой проверки, что это тот самый пользователь, хранилище не делает. Поэтому срок ставят минутами, а не днями (у SigV4 предел — неделя), и ключ объекта выбирает сервер. Если ключ берётся из запроса, получается та же дыра, что в [«Безопасности бэкенда», раздел «Чужой объект по id»](/platform/backend-security/#s1): клиент подпишет себе чужой файл.',
    tone: 'warn',
  },
  {
    t: 'Размер ограничивают иначе',
    d: 'У ссылки для `PUT` размер не подписан. Ограничение задаёт загрузка формой — `POST` с политикой, где есть условие `content-length-range`, — или проверка после загрузки: хранилище сообщает о новом объекте, и ваш сервер смотрит размер и первые байты, прежде чем считать файл принятым.',
  },
  {
    t: 'Браузер идёт на чужой источник',
    d: 'Хранилище — другой origin, а `PUT` — не простой запрос: будет preflight, и бакету нужны свои правила CORS с вашим адресом, методом `PUT` и заголовками, которые вы шлёте. Без них загрузка падает в браузере, хотя тот же `curl` проходит.',
  },
];

export const SIGN_DEMO_CAPTION =
  'Ссылка подписана функцией темы на примере из документации AWS — подпись совпадает с опубликованной. Проверка повторяет то, что делает хранилище: считает подпись заново из того, что пришло. Любая правка подписанной части даёт другую подпись, а время сверяется отдельно.';

// ─── Раздел 5. Проверки на сервере ─────────────────────────────────────────────────────────

export const SAFETY_RULES: string[] = [
  '**Тип — по первым байтам.** Расширение и `Content-Type` из запроса пишет клиент, им верить нельзя. Сигнатура PNG — восемь байт `\\x89PNG␍␊\\x1a␊`, JPEG начинается с `FF D8 FF`, PDF — с `%PDF-`. Неизвестное — отклонить, а не «пропустить как есть».',
  '**Размер — считать по мере чтения.** `Content-Length` может отсутствовать (тело кусками) или врать. Сервер считает прочитанные байты и обрывает запрос с `413`, как только предел превышен; у tus то же правило проверяется ещё на `POST` по `Upload-Length` — `@tus/server` с `maxSize` отвечает `413` до первого байта файла.',
  '**Имя файла — подпись, а не путь.** `new File([…], \'../../etc/passwd\')` уходит в `FormData` именно так — и из Node, и из Chromium. Файл кладут под ключом, который придумал сервер, а имя хранят отдельно, очищенным, чтобы показать человеку.',
  '**Раздача — отдельная тема.** Как сделать, чтобы загруженный файл не исполнился в вашем origin, — `Content-Type` по белому списку, `nosniff`, `Content-Disposition: attachment` и отдельный домен — в [«Безопасности фронтенда», раздел «XSS»](/platform/security/#s4).',
];

/** Имена, которые тест прогоняет через `displayName` и `path.resolve`. */
export const BAD_NAMES = ['../../etc/passwd', 'C:\\Users\\a\\..\\b.txt', '..', 'a\u0000b.png', ' .htaccess', 'x/'];

// ─── Тонкие места и источники ──────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`Content-Type: multipart/form-data` руками',
    d: 'Заголовок без `boundary` — и сервер не найдёт в теле ни одной части. С `FormData` в `fetch` и XHR `Content-Type` не задают: браузер вписывает его сам, вместе с границей.',
    tone: 'err',
  },
  {
    n: '02',
    t: '100% на полосе — не «файл сохранён»',
    d: '`upload.onprogress` считает отданные сети байты. На медленном сервере 100% наступили, когда прочитано было около 7 МиБ из 8. Кнопку «готово» включает ответ сервера.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Подписка на `xhr.upload` добавляет preflight',
    d: 'Простой POST на чужой источник с обработчиком на `upload` перестаёт быть простым. Если сервер не отвечает на `OPTIONS`, загрузка падает — а без полосы прогресса работала.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Браузер сам повторяет неидемпотентный запрос',
    d: 'Обрыв на переиспользованном соединении — и Chromium отправил PATCH ещё раз, без ведома кода. tus отбился `409`, потому что сверяет смещение. Обработчик загрузки, который просто дописывает тело в конец файла, получил бы кусок дважды.',
    tone: 'err',
  },
  {
    n: '05',
    t: '`chunkSize` у `tus-js-client` по умолчанию — бесконечность',
    d: 'Весь файл уходит одним PATCH. Докачка при этом работает, если сервер сохраняет дошедшее, но прокси с пределом тела — у nginx `client_max_body_size` по умолчанию 1 МБ — отвергнет такой запрос целиком. Размер куска задают меньше самого строгого предела по дороге.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Отпечаток не смотрит в содержимое',
    d: 'Два разных файла с одинаковыми именем, типом, размером и `lastModified` для `tus-js-client` — один, и второй «докачается» в чужую загрузку. А записи в `localStorage` по умолчанию остаются и после успеха: `removeFingerprintOnSuccess: true` их убирает.',
  },
  {
    n: '07',
    t: 'Ссылка с подписью не ограничивает размер',
    d: 'Подписаны метод, путь, хост и срок, тело — нет. По ссылке для `PUT` клиент положит файл любого размера в пределах хранилища (у S3 — до 5 ГБ за один `PUT`). Нужен `POST` с политикой или проверка после загрузки.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'Разборщики multipart расходятся в мелочах',
    d: '`a"b.bin` уходит как `a%22b.bin`, а обратно его раскодирует undici в Node и не раскодирует Chromium. Имя файла от клиента не должно ничего решать на сервере — тогда и расхождение не важно.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'HTML Standard — multipart/form-data encoding algorithm',
    href: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html',
    what: 'граница, экранирование `%22` `%0A` `%0D` в именах, нормализация переводов строк',
  },
  {
    title: 'RFC 7578 — Returning Values from Forms: multipart/form-data',
    href: 'https://www.rfc-editor.org/rfc/rfc7578',
    what: 'формат частей, `Content-Disposition`, `filename`',
  },
  {
    title: 'XMLHttpRequest Standard — upload, progress events',
    href: 'https://xhr.spec.whatwg.org/',
    what: '`xhr.upload`, события `loadstart` / `progress` / `load` / `loadend`, слушатель на `upload` и CORS',
  },
  {
    title: 'tus — Resumable Upload Protocol 1.0.x',
    href: 'https://tus.io/protocols/resumable-upload',
    what: '`POST` / `HEAD` / `PATCH`, `Upload-Offset`, `409`, расширения `creation`, `checksum`, `expiration`',
  },
  {
    title: 'tus-js-client — API',
    href: 'https://github.com/tus/tus-js-client/blob/main/docs/api.md',
    what: '`chunkSize`, `retryDelays`, `findPreviousUploads`, `removeFingerprintOnSuccess`; версия 4.3.1 на стенде',
  },
  {
    title: '@tus/server',
    href: 'https://github.com/tus/tus-node-server/tree/main/packages/server',
    what: '`Server`, `FileStore`, `maxSize`; версия 2.4.5 на стенде',
  },
  {
    title: 'Amazon S3 — Authenticating Requests: Using Query Parameters (SigV4)',
    href: 'https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html',
    what: 'параметры `X-Amz-*`, канонический запрос, пример с подписью `aeeed9bb…`, срок до 7 дней',
  },
  {
    title: 'Amazon S3 — Creating a POST policy',
    href: 'https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html',
    what: 'условие `content-length-range` для загрузки формой',
  },
  {
    title: 'MIME Sniffing Standard — matching an image type pattern',
    href: 'https://mimesniff.spec.whatwg.org/',
    what: 'сигнатуры PNG, JPEG, GIF, WebP',
  },
];

export const RELATED =
  'Смежное на сайте: [Формы во фреймворках, раздел «Отправка»](/frameworks/forms/#s7) — что попадает в `FormData`. [Стримы и обратное давление](/platform/streams/#s6) — тело запроса стримом и `duplex`. [HTTP/2 и HTTP/3, раздел «Потоки и окно»](/platform/http2-http3/#s3) — почему стрим отдал больше, чем прочёл сервер. [Сеть и кеширование, раздел «Кеш и валидация»](/platform/network/#s2) — докачка в обратную сторону: `Range` и `If-Range` при скачивании. [Безопасность фронтенда, раздел «XSS»](/platform/security/#s4) — как раздавать загруженное. [node:stream изнутри](/platform/node-streams/) — как сервер читает тело по кускам. [Бинарные данные](/js/binary-data/) — ArrayBuffer и виды на нём, порядок байт, TextDecoder на разрезанном символе, разбор PNG.';

// ─── Учебные функции (строки: печатаются на странице, исполняются демо и тестом) ────────────

export const MULTIPART_CODE = `const CRLF = '\\r\\n';
const enc = new TextEncoder();
const dec = new TextDecoder();

// Переводы строк в текстовых значениях и в именах полей приводятся к CRLF.
function normalizeNewlines(s) {
  return s.replace(/\\r\\n|\\r|\\n/g, CRLF);
}

// Имя живёт внутри кавычек заголовка: кавычку и перевод строки туда не вписать.
function escapeQuoted(s) {
  return s.replace(/\\n/g, '%0A').replace(/\\r/g, '%0D').replace(/"/g, '%22');
}

// entries — пары [имя, значение]; значение — строка или файл { filename, type, bytes }.
function encodeMultipart(entries, boundary) {
  const parts = [];
  for (const [name, value] of entries) {
    let head = '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="' + escapeQuoted(normalizeNewlines(name)) + '"';
    let body;
    if (typeof value === 'string') {
      head += CRLF + CRLF;
      body = enc.encode(normalizeNewlines(value));
    } else {
      head += '; filename="' + escapeQuoted(value.filename) + '"' + CRLF +
        'Content-Type: ' + (value.type || 'application/octet-stream') + CRLF + CRLF;
      body = value.bytes;                       // байты файла идут как есть
    }
    parts.push(enc.encode(head), body, enc.encode(CRLF));
  }
  parts.push(enc.encode('--' + boundary + '--' + CRLF));
  return concat(parts);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Поиск последовательности байт: разделитель ищут в байтах, а не в строке —
// внутри файла может быть что угодно, и декодировать его как текст нельзя.
function indexOf(hay, needle, from) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

function parseMultipart(bytes, boundary) {
  const delim = enc.encode('--' + boundary);
  const result = [];
  let pos = indexOf(bytes, delim, 0);
  if (pos < 0) throw new Error('нет разделителя');
  while (true) {
    pos += delim.length;
    if (bytes[pos] === 45 && bytes[pos + 1] === 45) return result;   // «--» — конец тела
    pos += 2;                                                          // CRLF после разделителя
    const headEnd = indexOf(bytes, enc.encode(CRLF + CRLF), pos);
    const head = dec.decode(bytes.subarray(pos, headEnd));
    const next = indexOf(bytes, enc.encode(CRLF + '--' + boundary), headEnd + 4);
    if (headEnd < 0 || next < 0) throw new Error('тело оборвано');
    const data = bytes.subarray(headEnd + 4, next);
    const name = /\\bname="([^"]*)"/.exec(head)[1];
    const filename = /\\bfilename="([^"]*)"/.exec(head);
    const type = /^content-type:\\s*(.+)$/im.exec(head);
    result.push(filename
      ? { name: unescapeQuoted(name), filename: unescapeQuoted(filename[1]), type: type ? type[1].trim() : 'text/plain', bytes: data }
      : { name: unescapeQuoted(name), value: dec.decode(data) });
    pos = next + 2;
  }
}

function unescapeQuoted(s) {
  return s.replace(/%0A/g, '\\n').replace(/%0D/g, '\\r').replace(/%22/g, '"');
}`;

export const TUS_CLIENT_CODE = `async function tusUpload(fetch, endpoint, file, chunkSize) {
  const tus = { 'Tus-Resumable': '1.0.0' };

  // 1. Создать загрузку: сервер отвечает адресом, по которому её можно найти потом.
  const created = await fetch(endpoint, {
    method: 'POST',
    headers: { ...tus, 'Upload-Length': String(file.length) },
  });
  if (created.status !== 201) throw new Error('POST ' + created.status);
  const url = new URL(created.headers.get('Location'), endpoint).href;

  let offset = 0;
  let failures = 0;
  while (offset < file.length) {
    try {
      // 2. Отправить кусок с того места, где, по нашим сведениям, сервер остановился.
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...tus, 'Upload-Offset': String(offset), 'Content-Type': 'application/offset+octet-stream' },
        body: file.subarray(offset, offset + chunkSize),
      });
      if (res.status !== 204) throw new Error('PATCH ' + res.status);
      offset = Number(res.headers.get('Upload-Offset'));
    } catch (err) {
      if (++failures > 3) throw err;
      // 3. Связь оборвалась или сервер не согласен: спросить, сколько байт у него на самом деле.
      const head = await fetch(url, { method: 'HEAD', headers: tus });
      offset = Number(head.headers.get('Upload-Offset'));
    }
  }
  return url;
}`;

export const TUS_SERVER_CODE = `function createTusServer() {
  const uploads = new Map();
  let lastId = 0;

  // req: { method, path, headers (имена строчными), body — дошедшие байты }
  function handle(req) {
    const h = req.headers;
    if (req.method !== 'OPTIONS' && h['tus-resumable'] !== '1.0.0') {
      return { status: 412, headers: { 'Tus-Version': '1.0.0' } };
    }
    const base = { 'Tus-Resumable': '1.0.0' };

    if (req.method === 'POST') {
      const length = Number(h['upload-length']);
      const id = String(++lastId);
      uploads.set(id, { length, offset: 0, data: new Uint8Array(length) });
      return { status: 201, headers: { ...base, Location: req.path + '/' + id } };
    }

    const up = uploads.get(req.path.split('/').pop());
    if (!up) return { status: 404, headers: base };

    if (req.method === 'HEAD') {
      return { status: 200, headers: { ...base, 'Upload-Offset': String(up.offset),
        'Upload-Length': String(up.length), 'Cache-Control': 'no-store' } };
    }

    if (req.method === 'PATCH') {
      if (h['content-type'] !== 'application/offset+octet-stream') return { status: 415, headers: base };
      // Клиент обязан продолжать ровно с того места, где сервер остановился.
      if (Number(h['upload-offset']) !== up.offset) return { status: 409, headers: base };
      if (up.offset + req.body.length > up.length) return { status: 413, headers: base };
      // Сохраняется всё, что дошло, — даже если соединение оборвалось посреди тела.
      up.data.set(req.body, up.offset);
      up.offset += req.body.length;
      return { status: 204, headers: { ...base, 'Upload-Offset': String(up.offset) } };
    }
    return { status: 405, headers: base };
  }

  return { handle, uploads };
}`;

export const PRESIGN_CODE = `const te = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', te.encode(s)));
async function hmac(key, s) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? te.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, te.encode(s));
}
// Кодирование по правилам SigV4: всё, кроме A-Z a-z 0-9 - _ . ~, — в %XX.
const uriEncode = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

async function signature(secret, day, region, stringToSign) {
  // Ключ подписи выводится из секрета, даты, региона и службы — секрет в URL не попадает.
  let key = await hmac('AWS4' + secret, day);
  key = await hmac(key, region);
  key = await hmac(key, 's3');
  key = await hmac(key, 'aws4_request');
  return hex(await hmac(key, stringToSign));
}

function canonical(method, host, path, query) {
  const q = Object.keys(query).sort().map((k) => uriEncode(k) + '=' + uriEncode(query[k])).join('&');
  return [method, path, q, 'host:' + host, '', 'host', 'UNSIGNED-PAYLOAD'].join('\\n');
}

async function presign({ method, host, path, accessKey, secret, region, date, expires }) {
  const day = date.slice(0, 8);                         // date: '20130524T000000Z'
  const scope = day + '/' + region + '/s3/aws4_request';
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': accessKey + '/' + scope,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalRequest = canonical(method, host, path, query);
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, await sha256(canonicalRequest)].join('\\n');
  const sig = await signature(secret, day, region, stringToSign);
  const qs = Object.keys(query).sort().map((k) => k + '=' + uriEncode(query[k])).join('&');
  return { url: 'https://' + host + path + '?' + qs + '&X-Amz-Signature=' + sig,
    canonicalRequest, stringToSign, signature: sig };
}

// Сторона хранилища: секрет она знает сама, по ключу доступа из URL.
async function verifyPresigned(method, url, secretFor, now) {
  const u = new URL(url);
  const query = Object.fromEntries(u.searchParams);
  const given = query['X-Amz-Signature'];
  delete query['X-Amz-Signature'];
  const [accessKey, day, region] = query['X-Amz-Credential'].split('/');
  const d = query['X-Amz-Date'];
  const start = Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11), +d.slice(11, 13), +d.slice(13, 15));
  if (now > start + Number(query['X-Amz-Expires']) * 1000) return { ok: false, reason: 'срок истёк' };
  const canonicalRequest = canonical(method, u.host, u.pathname, query);
  const stringToSign = ['AWS4-HMAC-SHA256', d, query['X-Amz-Credential'].slice(accessKey.length + 1), await sha256(canonicalRequest)].join('\\n');
  const expected = await signature(secretFor(accessKey), day, region, stringToSign);
  return expected === given ? { ok: true, reason: 'подпись верна' } : { ok: false, reason: 'подпись не совпала' };
}`;

export const SAFETY_CODE = `// Тип — по первым байтам файла, а не по имени и не по Content-Type из запроса.
const SIGNATURES = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],              // GIF8
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],  // %PDF-
];
function sniffType(bytes) {
  for (const [type, sig] of SIGNATURES) {
    if (sig.every((b, i) => bytes[i] === b)) return type;
  }
  // WebP: RIFF, четыре байта длины, WEBP
  const ascii = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;                                          // не знаем — значит не принимаем
}

// Имя от клиента — только подпись для людей. Путь из него не строят.
function displayName(filename) {
  const last = filename.split(/[\\\\/]/).pop();             // после последней косой черты, любой
  const clean = last.replace(/[\\u0000-\\u001f\\u007f]/g, '').replace(/^[.\\s]+|[.\\s]+$/g, '');
  return clean.slice(0, 100) || 'file';
}`;
