import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Доступ к железу: Serial, USB, Bluetooth, HID и MIDI».
 *
 * Тема написана 2026-11-03. Весь код примеров — строки отсюда; их исполняет
 * `tests/e2e/device-hardware.spec.ts` в настоящих браузерах (Playwright 1.63).
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Chromium 153.0.8010.12 (headless shell Playwright), Firefox 155.0 (Nightly-сборка Playwright),
 * WebKit 26.6; macOS arm64. Страница отдаётся через `page.route` с выдуманного источника
 * `https://device-hardware.test` — это безопасный контекст. Каталог проб — `.dh-probe*.mjs`
 * (удалены после переноса в спек).
 *
 * Что снято пробами и закреплено спеком:
 *   — наличие `navigator.serial/usb/bluetooth/hid` и `requestMIDIAccess` в трёх движках
 *     (`SUPPORT`). На `http://` вне localhost их нет ни в одном движке;
 *   — без жеста в Chromium все четыре `request*` бросают `SecurityError`
 *     («Must be handling a user gesture to show a permission request»). То же по
 *     `button.click()` из кода и через 5,5 с после настоящего клика (`ERROR_ROWS`);
 *   — с настоящим кликом headless shell окна выбора не рисует и ведёт себя как «закрыли без
 *     выбора»: Serial и USB — `NotFoundError`, HID — **пустой массив**, без ошибки. Жест одним
 *     `requestPort` не расходуется: второй вызов в том же клике тоже дошёл до окна;
 *   — `getPorts()`/`getDevices()` на чистом профиле — пустой массив, жеста не требуют;
 *   — чужой iframe без `allow` — `SecurityError` уже на `getPorts()`; с `allow="serial; …"` — как
 *     в главном фрейме;
 *   — MIDI без разрешения — `NotAllowedError`; с разрешением — 0 входов и 0 выходов
 *     (устройств на стенде нет). В Playwright разрешение даётся только парой `midi` + `midi-sysex`;
 *   — Firefox: `requestMIDIAccess()` без устройств не отвечает несколько секунд и потом
 *     отклоняется `SecurityError` (на стенде — через 13,5 с, один прогон), в консоли
 *     «Silently denying site request for MIDI access because no devices were detected»;
 *   — Firefox с настройками `dom.webserial.testing.enabled` и `dom.webserial.gated = false`
 *     подставляет тестовый порт (vendorId 0x2341, productId 0x0043 — Arduino Uno), который
 *     возвращает записанное обратно. На нём `SERIAL_CODE` и `PERMISSION_CODE` проходят целиком;
 *   — Firefox закрывает порт и при запертом читателем `readable` (по спецификации `close()`
 *     должен отклониться: `ReadableStream.cancel` у запертого потока — `TypeError`);
 *   — Bluetooth: протокол DevTools в Chromium 153 даёт `BluetoothEmulation` (сессия браузера)
 *     и `DeviceAccess` (сессия страницы). Фальшивое устройство с батарейным сервисом читается
 *     через `BT_CODE` целиком; подписка на уведомления оформляется, но **прислать** новое
 *     значение от устройства этот протокол не умеет — команды для этого нет;
 *   — blocklist Bluetooth: сервис `human_interface_device` в `filters` — `SecurityError` сразу,
 *     в `optionalServices` — молча выброшен; сервис, не названный в запросе, — `SecurityError`
 *     у `getPrimaryService`, а `getPrimaryServices()` перечисляет только названные.
 *
 * Что проверить нельзя, и почему: чтение и запись USB и HID — нужно настоящее устройство;
 * для USB, HID и Serial в Chromium подделки нет — в протоколе DevTools нет таких доменов
 * (сверено по `browser_protocol.json` ChromeDevTools), а флагов запуска с фальшивыми портами
 * мы не нашли. Поэтому `USB_CODE` и `HID_CODE` исполняются только до окна выбора.
 *
 * Позиции Mozilla и Apple — по `activities.yml` в mozilla/standards-positions и меткам
 * задач в WebKit/standards-positions на 2026-11-03 (ссылки — в `SOURCES`).
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const PLAIN_DEVICE =
  'Сайт и устройство на столе разделены операционной системой. Обычно с устройством говорит программа, которую вы поставили, а браузер видит только то, что ОС уже перевела на язык страницы: нажатие клавиши, движение мыши, звук. Эти API прокладывают от страницы прямой провод к одному устройству. Провод выдаёт человек: сам выбирает устройство в окне браузера, и только его.';

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'последовательный порт',
    d: 'Канал, по которому байты идут друг за другом. У платы Arduino или ESP32 это USB-кабель, который система показывает как `COM3` или `/dev/tty.usbmodem…`. Так же подключены 3D-принтеры, станки, сканеры штрихкодов.',
  },
  {
    k: 'безопасный контекст',
    d: 'Страница по `https://` или с `localhost`. На обычном `http://` этих API нет вовсе: `navigator.serial` — `undefined`, а не «есть, но запрещён».',
  },
  {
    k: 'жест пользователя',
    d: 'Клик, нажатие клавиши, касание экрана. Браузер помнит его несколько секунд — по-английски transient activation. Проверить можно так: `navigator.userActivation.isActive`.',
  },
  {
    k: 'окно выбора',
    d: 'Список подходящих устройств, который рисует сам браузер, а не страница. Сайт получает только то устройство, которое выбрал человек, и не узнаёт, что ещё было в списке.',
  },
  {
    k: '`Permissions-Policy`',
    d: 'Правило страницы: каким встроенным фреймам можно пользоваться мощными API. Задаётся заголовком ответа или атрибутом `allow` у `<iframe>`.',
  },
  {
    k: 'blocklist',
    d: 'Список устройств, сервисов и классов, к которым сайт не пустят даже с согласия человека. Его ведут авторы спецификации и браузера.',
  },
  {
    k: 'прошивка',
    d: 'Программа внутри самого устройства. Многие устройства умеют принимать новую прошивку по тому же каналу, по которому с ними говорят.',
  },
];

// ─── Перед началом ─────────────────────────────────────────────────────────────────────────

export const PREREQ_NOTE = 'Тема опирается на три вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Читаемый и записываемый поток',
    d: 'Данные приходят кусками через `reader.read()`, уходят через `writer.write()`. Пока читатель держит поток, никто другой его не возьмёт.',
    href: '/platform/streams/#s2',
    hrefLabel: '«Стримы», раздел «Читаемый поток: кто кого зовёт»',
    tone: 'info',
  },
  {
    t: 'Байты и их вид',
    d: 'Устройство отдаёт байты. В JS это `Uint8Array` или `DataView` поверх буфера; текст из байтов получают `TextDecoder`.',
    href: '/js/binary-data/#s1',
    hrefLabel: '«Двоичные данные», раздел «Буфер и вид»',
    tone: 'info',
  },
  {
    t: 'Источник страницы',
    d: 'Разрешение выдаётся источнику — схеме, хосту и порту. Чужой iframe — другой источник, даже если он внутри вашей страницы.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
];

// ─── Раздел 1. Первый порт ─────────────────────────────────────────────────────────────────

/**
 * Исполняется спеком в Firefox на тестовом порту (он возвращает записанное обратно), отсюда
 * ответ `ping` на `ping`. В Chromium тот же код по клику падает на `requestPort` с
 * `NotFoundError`: окна выбора в headless shell нет.
 */
export const SERIAL_CODE = `const button = document.querySelector('#connect');

button.addEventListener('click', async () => {
  // 1. Окно выбора. Без клика здесь будет SecurityError
  const port = await navigator.serial.requestPort({
    filters: [{ usbVendorId: 0x2341 }],     // показывать только платы Arduino
  });

  // 2. Открыть порт на скорости, которую ждёт устройство
  await port.open({ baudRate: 9600 });

  // 3. Записать: байты уходят в port.writable
  const writer = port.writable.getWriter();
  await writer.write(new TextEncoder().encode('ping\\n'));
  writer.releaseLock();

  // 4. Прочитать: байты из port.readable → текст → строки
  const decoder = new TextDecoderStream();
  const piped = port.readable.pipeTo(decoder.writable);
  const reader = decoder.readable.getReader();

  let tail = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (tail + value).split('\\n');
    tail = lines.pop();                      // кусок без \\n ждёт продолжения
    for (const line of lines) console.log('строка:', line);
    if (lines.length > 0) break;             // ответ получен
  }

  // 5. Закрыть: сначала отпустить поток, потом порт
  await reader.cancel();
  await piped.catch(() => {});
  await port.close();
  console.log('порт закрыт');
});`;

export const SERIAL_OUT = 'строка: ping\nпорт закрыт';

export const SERIAL_NOTE =
  'Вывод снят на тестовом порту Firefox: он возвращает всё, что в него записали, поэтому на `ping` пришёл `ping`. Настоящая плата ответит тем, что зашито в её программу. Сам код от этого не меняется: открыть, записать, читать, закрыть.';

export const PLAIN_BAUD =
  '`baudRate` — скорость, на которой обе стороны договорились говорить: 9600 бит в секунду, 115200 и так далее. Самой скорости порт не узнает — это как два человека, которые заранее условились, как быстро диктовать цифры. Если плата шлёт на 115200, а вы открыли на 9600, порт откроется без ошибки, но байты придут мусором.';

export const STREAM_FACTS = [
  '`port.readable` — обычный `ReadableStream`, кусками в нём идут `Uint8Array`. `port.writable` — `WritableStream`, туда пишут `Uint8Array`. До `open()` оба равны `null`;',
  '**куски не совпадают со строками.** Порт отдаёт байты по мере прихода: одна строка может приехать тремя кусками, а три строки — одним. Поэтому хвост без `\\n` откладывают до следующего куска;',
  '`TextDecoderStream` склеивает и байты: буква «ж» в UTF-8 — два байта, и если кусок разрезал её пополам, декодер дождётся второй половины;',
  '**пока поток заперт читателем или писателем, порт не закрыть.** По спецификации `close()` сам отменяет оба потока, а отменить запертый поток нельзя. Отсюда порядок в конце примера: `reader.cancel()`, дождаться `pipeTo`, и только потом `port.close()`.',
];

export const STREAM_LINK =
  'Почему поток один на одного читателя и как его отменять — в [«Стримах», раздел «Отмена, `tee` и блокировка читателя»](/platform/streams/#s5).';

// ─── Раздел 2. Разрешения ──────────────────────────────────────────────────────────────────

export const PERMISSION_STEPS = [
  '**Безопасный контекст.** На `http://` объектов `navigator.serial`, `usb`, `bluetooth`, `hid` и метода `requestMIDIAccess` нет ни в одном движке;',
  '**жест.** `requestPort()` и все `requestDevice()` работают только внутри обработчика клика или клавиши. Без жеста — `SecurityError`, окно даже не открывается;',
  '**окно выбора.** Список устройств видит человек, а не сайт. Сайт получает одно выбранное устройство. Закрыли окно без выбора — `NotFoundError`, а у HID — пустой массив;',
  '**уже разрешённые.** `getPorts()` и `getDevices()` возвращают то, что человек выбрал раньше на этом же источнике. Жеста они не требуют — так страница переподключается после перезагрузки;',
  '**отзыв.** `port.forget()` и `device.forget()` снимают разрешение. После них устройство пропадает из `getPorts()`, и до него снова нужно окно выбора;',
  '**фреймы.** Чужой `<iframe>` по умолчанию не получает ничего — даже `getPorts()`. Открывает доступ атрибут `allow="serial; usb; hid; bluetooth; midi"` или заголовок `Permissions-Policy` на странице.',
];

export const PLAIN_GESTURE =
  'Жест — это доказательство, что человек сейчас здесь и сам что-то нажал. Без этого правила любой сайт мог бы при загрузке показать окно «Разрешить доступ к устройству?», и человек нажал бы «Да», не читая. Код не может подделать жест: `button.click()` из скрипта вызывает обработчик, но жестом не считается. И жест живёт недолго: если между кликом и `requestPort` прошло несколько секунд — например, страница ждала ответа сервера, — запрос снова упадёт.';

/**
 * При загрузке выполняется модулем: верхний `await` работает только там.
 * Спек проверяет `при загрузке: 0` в Chromium и всю тройку — в Firefox на тестовом порту.
 */
export const PERMISSION_CODE = `// При загрузке: жеста нет, окна нет — только то, что уже разрешено
console.log('при загрузке:', (await navigator.serial.getPorts()).length);

button.addEventListener('click', async () => {
  const port = await navigator.serial.requestPort();     // окно выбора
  console.log('после выбора:', (await navigator.serial.getPorts()).length);

  await port.forget();                                   // снять разрешение
  console.log('после forget:', (await navigator.serial.getPorts()).length);
});`;

export const PERMISSION_OUT = 'при загрузке: 0\nпосле выбора: 1\nпосле forget: 0';

/** Ячейка «что вышло» вычисляется спеком в Chromium 153 и сверяется с `got` дословно. */
export const ERROR_ROWS: { call: string; when: string; got: string }[] = [
  { call: '`serial.requestPort()`', when: 'при загрузке страницы', got: '`SecurityError`' },
  { call: '`usb`, `hid`, `bluetooth` `.requestDevice()`', when: 'при загрузке страницы', got: '`SecurityError`' },
  { call: '`serial.requestPort()`', when: 'в обработчике `button.click()` из кода', got: '`SecurityError`' },
  { call: '`serial.requestPort()`', when: 'через 5,5 с после настоящего клика', got: '`SecurityError`' },
  { call: '`serial.requestPort()`, `usb.requestDevice()`', when: 'по клику, окно закрыли без выбора', got: '`NotFoundError`' },
  { call: '`hid.requestDevice()`', when: 'по клику, окно закрыли без выбора', got: 'пустой массив, без ошибки' },
  { call: '`serial.getPorts()`', when: 'на новом профиле, без жеста', got: 'пустой массив' },
  { call: '`serial.getPorts()`', when: 'в чужом `<iframe>` без `allow`', got: '`SecurityError`' },
  { call: '`requestMIDIAccess()`', when: 'разрешение не выдано', got: '`NotAllowedError`' },
];

export const ERROR_NOTE =
  'Имя ошибки — часть стандарта, на него можно опираться в `catch`. Текст сообщения у каждого браузера свой. В Chromium без жеста это «Must be handling a user gesture to show a permission request».';

// ─── Раздел 3. Где это работает ────────────────────────────────────────────────────────────

/** Сверяется спеком с `typeof` в трёх движках на https-странице. */
export const SUPPORT: { api: string; probe: 'serial' | 'usb' | 'bluetooth' | 'hid' | 'midi'; chromium: boolean; firefox: boolean; webkit: boolean; ff: string }[] = [
  { api: 'Web Serial', probe: 'serial', chromium: true, firefox: true, webkit: false, ff: 'есть, с версии 151 — через дополнение-разрешение' },
  { api: 'WebUSB', probe: 'usb', chromium: true, firefox: false, webkit: false, ff: 'нет' },
  { api: 'Web Bluetooth', probe: 'bluetooth', chromium: true, firefox: false, webkit: false, ff: 'нет' },
  { api: 'WebHID', probe: 'hid', chromium: true, firefox: false, webkit: false, ff: 'нет' },
  { api: 'Web MIDI', probe: 'midi', chromium: true, firefox: true, webkit: false, ff: 'есть — через дополнение-разрешение' },
];

export const SUPPORT_NOTE =
  'Chromium — это Chrome, Edge, Opera, Яндекс Браузер. Safari и все браузеры на WebKit не дают ни одного из пяти API. Проверяйте наличие API, а не имя браузера: `\'serial\' in navigator`.';

export const FIREFOX_NOTE =
  'В Firefox Serial и MIDI есть, но не открываются простым окном. При первом запросе Firefox предлагает установить **дополнение-разрешение** для этого сайта: его генерирует сам браузер, и ставить его человек должен сознательно. Без устройств MIDI в Firefox отказывает молча и не сразу: на стенде промис висел 13,5 секунды и только потом отклонился `SecurityError`, а в консоли Firefox написал «Silently denying site request for MIDI access because no devices were detected».';

export const POSITIONS = [
  {
    k: 'Mozilla',
    d: 'USB, Bluetooth и HID — **negative**: устройства не рассчитаны на то, что с ними будет говорить случайный сайт, а осмысленного согласия от человека одной кнопкой не получить. Serial — **neutral**, MIDI — **positive**, но оба только через дополнение-разрешение: устройство часто выполняет команды без всякой проверки, кто их прислал.',
  },
  {
    k: 'Apple (WebKit)',
    d: 'Serial, USB, Bluetooth и HID — **oppose**: риски безопасности и приватности, и привязка сайта к конкретному устройству. MIDI WebKit не делает тоже — он в списке API, отложенных из-за слежки по отпечатку: набор подключённых устройств отличает одного человека от другого.',
  },
];

// ─── Раздел 4. Четыре других API ───────────────────────────────────────────────────────────

/**
 * Пример из спецификации WebUSB (плата Arduino с прошивкой WebUSB). Без устройства не
 * исполняется дальше первой строки: спек проверяет только `NotFoundError` от окна выбора.
 */
export const USB_CODE = `button.addEventListener('click', async () => {
  const device = await navigator.usb.requestDevice({
    filters: [{ vendorId: 0x2341 }],
  });
  await device.open();
  await device.selectConfiguration(1);
  await device.claimInterface(2);   // занять интерфейс: его не должен держать драйвер ОС

  // управляющая передача — короткая команда «настрой себя»
  await device.controlTransferOut({
    requestType: 'class', recipient: 'interface',
    request: 0x22, value: 0x01, index: 2,
  });

  // массовая передача — до 64 байт данных из конечной точки 5
  const result = await device.transferIn(5, 64);
  console.log(new TextDecoder().decode(result.data));
});`;

export const PLAIN_TRANSFERS =
  'USB-устройство — это почтовое отделение с несколькими окошками. **Интерфейс** — отдел: у веб-камеры отдельно видео и звук. **Конечная точка** — окошко в отделе, у каждого номер и направление «сюда» или «отсюда». **Управляющая передача** — короткая записка начальнику отдела («включи светодиод», «назови модель»). **Массовая передача** — посылки через окошко: данные большими порциями, без гарантии времени, но целиком.';

export const USB_NOTE =
  'Главная помеха WebUSB — драйвер. Если ОС узнала устройство — флешку, клавиатуру, веб-камеру, — интерфейс уже занят её драйвером, и `claimInterface` отклоняется `NetworkError`. Поэтому WebUSB годится для устройств, у которых своего драйвера в системе нет: платы разработчика, прошивальщики, лабораторные приборы. А интерфейсы аудио, HID, накопителей, хабов, смарт-карт, видео и беспроводных контроллеров спецификация закрывает сама: для них `claimInterface` — `SecurityError`.';

/**
 * Исполняется спеком целиком на фальшивом устройстве Chromium (`BluetoothEmulation`):
 * имя `Pulse-1`, батарейный сервис, уровень 87.
 */
export const BT_CODE = `button.addEventListener('click', async () => {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: ['battery_service'] }],   // только устройства с батарейным сервисом
  });
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('battery_service');
  const level = await service.getCharacteristic('battery_level');

  const value = await level.readValue();             // DataView
  console.log(device.name, 'заряд:', value.getUint8(0) + '%');

  level.addEventListener('characteristicvaluechanged', (e) => {
    console.log('новый заряд:', e.target.value.getUint8(0) + '%');
  });
  await level.startNotifications();                  // дальше устройство пишет само
  console.log('подписка оформлена');
});`;

export const BT_OUT = 'Pulse-1 заряд: 87%\nподписка оформлена';

export const PLAIN_GATT =
  'Bluetooth LE-устройство устроено как шкаф с папками. **Сервис** — папка на одну тему: «батарея», «пульс». **Характеристика** — лист в папке с одним значением: «уровень заряда — 87». Каждую папку и лист называет UUID; для стандартных есть короткие имена вроде `battery_service`. Значение можно прочитать, записать или подписаться на него — тогда устройство само присылает новое, когда оно меняется. Этот набор правил и называется GATT.';

export const BT_NOTE =
  'Вывод снят на фальшивом устройстве, которое Chromium создаёт через протокол DevTools (раздел «Как проверить без железа»). Сайт видит только те сервисы, которые назвал в `filters` или `optionalServices`: остальные для него не существуют, `getPrimaryService` на них — `SecurityError`. Это и есть защита: страница с пульсометром не прочитает с того же браслета ничего лишнего.';

/** Без устройства спек доходит до `устройство не выбрано`: окно в headless shell закрыто. */
export const HID_CODE = `button.addEventListener('click', async () => {
  const [device] = await navigator.hid.requestDevice({
    filters: [{ vendorId: 0x057e }],               // Nintendo: Joy-Con, Pro Controller
  });
  if (!device) return console.log('устройство не выбрано');

  await device.open();
  device.addEventListener('inputreport', (e) => {
    // reportId — какой это отчёт, data — его байты
    console.log(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
  });
});`;

export const HID_OUT = 'устройство не выбрано';

export const HID_NOTE =
  'HID — протокол клавиатур, мышей, геймпадов, а ещё педалей, пультов, считывателей карт. Устройство говорит **отчётами**: пачками байтов с номером. Что значит каждый байт, оно само описывает в дескрипторе — `device.collections` отдаёт этот дескриптор разобранным. Входной отчёт приходит событием `inputreport`, выходной уходит `sendReport()`, настройки читаются и пишутся отчётами-«свойствами» (`receiveFeatureReport`, `sendFeatureReport`).';

/** Спек исполняет код модулем в Chromium с выданным разрешением, затем зовёт `describe` на `MIDI_SAMPLES`. */
export const MIDI_CODE = `const midi = await navigator.requestMIDIAccess();     // без sysex
console.log('входов:', midi.inputs.size, 'выходов:', midi.outputs.size);

function describe([status, data1, data2]) {
  const command = status >> 4;            // старшие 4 бита: что случилось
  const channel = (status & 0x0f) + 1;    // младшие 4 бита: канал 1–16
  if (command === 0x9 && data2 > 0) return \`канал \${channel}: нажата нота \${data1}, сила \${data2}\`;
  if (command === 0x8 || command === 0x9) return \`канал \${channel}: отпущена нота \${data1}\`;
  if (command === 0xb) return \`канал \${channel}: регулятор \${data1} = \${data2}\`;
  return \`другое: \${status.toString(16)}\`;
}

for (const input of midi.inputs.values()) {
  input.onmidimessage = (e) => console.log(describe(e.data));
}
midi.onstatechange = (e) => console.log(e.port.name, e.port.state);`;

export const MIDI_OUT = 'входов: 0 выходов: 0';

export const MIDI_SAMPLES: { bytes: number[]; out: string }[] = [
  { bytes: [0x90, 60, 100], out: 'канал 1: нажата нота 60, сила 100' },
  { bytes: [0x80, 60, 0], out: 'канал 1: отпущена нота 60' },
  { bytes: [0x90, 60, 0], out: 'канал 1: отпущена нота 60' },
  { bytes: [0xb1, 7, 90], out: 'канал 2: регулятор 7 = 90' },
];

export const MIDI_NOTE =
  'MIDI — самый простой из пяти протоколов. Обычное сообщение — до трёх байт: статус (что и на каком канале) и одно-два значения от 0 до 127. `0x90 60 100` — «на первом канале нажата нота 60 (до первой октавы) с силой 100». Нота с силой 0 тоже означает «отпущена»: так шлют многие клавиатуры. Выход работает зеркально: `output.send([0x90, 60, 100])`.';

export const SYSEX_NOTE =
  '**Sysex** — сообщение `F0 … F7` любой длины в формате производителя. Им синтезаторы принимают пресеты, а часто и новую прошивку. Поэтому у разрешения два уровня: `requestMIDIAccess()` и `requestMIDIAccess({ sysex: true })`. В Chromium с версии 124 спрашивается любой доступ к MIDI, а не только sysex; sysex просят, только если без него никак.';

export const API_ROWS = [
  ['Serial', 'поток байтов к порту', '`requestPort` → `open({ baudRate })` → `readable` / `writable`', 'платы разработчика, принтеры, станки, весы'],
  ['USB', 'передачи к интерфейсам устройства', '`requestDevice` → `open` → `claimInterface` → `transferIn` / `Out`', 'устройства без системного драйвера, прошивальщики'],
  ['Bluetooth LE', 'значения характеристик GATT', '`requestDevice` → `gatt.connect` → сервис → характеристика', 'браслеты, датчики, умные лампы'],
  ['HID', 'отчёты по описанию устройства', '`requestDevice` → `open` → `inputreport` / `sendReport`', 'геймпады вне Gamepad API, педали, пульты'],
  ['MIDI', 'сообщения по 1–3 байта', '`requestMIDIAccess` → `inputs` / `outputs` → `onmidimessage`', 'клавиатуры, контроллеры, синтезаторы'],
];

// ─── Раздел 5. Почему это опасно ───────────────────────────────────────────────────────────

export const DANGER_WHY =
  'Устройство обычно верит каждому, кто к нему подключён. Плата выполнит любую команду из порта, принтер — любой G-код, многие устройства примут новую прошивку без подписи. Раньше это было безопасно: подключиться могла только программа, которую человек сам поставил. Теперь подключиться может страница, открытая минуту назад. Окно выбора защищает от тихого доступа, но не от человека, который нажал «Подключить», потому что сайт попросил.';

export const YUBIKEY_NOTE =
  'Так уже было. В феврале 2018 года Маркус Фервир и Микеле Орру показали фишинг через WebUSB. Ключ YubiKey NEO защищает вход тем, что сверяет адрес сайта: поддельный сайт получит отказ. Но через WebUSB поддельная страница просила «подключить» ключ, человек выбирал его в окне, и страница слала ключу запрос напрямую через интерфейс смарт-карты — уже без сверки адреса. Chrome 67 закрыл этот путь: класс интерфейса смарт-карты вошёл в список защищённых.';

export const BLOCK_ROWS = [
  ['USB', 'интерфейсы аудио, HID, накопителей, хабов, смарт-карт, видео и беспроводных контроллеров — у них есть свой системный путь; плюс список отдельных устройств'],
  ['HID', 'мыши, клавиатуры, цифровые клавиатуры, системное управление (кнопки питания, сна) и FIDO-ключи — иначе сайт стал бы кейлоггером'],
  ['Bluetooth', 'сервис HID (`0x1812`, клавиатуры по Bluetooth), сервисы FIDO-ключей, сервисы обновления прошивки Nordic, TI и Cypress; запись в часть служебных характеристик'],
  ['MIDI', 'blocklist нет — опасную часть, sysex, закрывает отдельный уровень разрешения'],
];

export const BLOCK_NOTE =
  'Геймпадов в blocklist HID нет: через WebHID достают то, чего не знает Gamepad API, — подсветку, вибрацию, модели, которых нет в его списке. Bluetooth проверяет blocklist на каждом шаге: сервис HID в `filters` — `SecurityError` сразу, в `optionalServices` — молча выброшен.';

export const FRAME_NOTE =
  'Для встроенных фреймов работает `Permissions-Policy`. По умолчанию все пять API разрешены только своему источнику: чужой `<iframe>` получает `SecurityError` уже на `getPorts()`. Открыть доступ виджету можно атрибутом `allow="serial"` или заголовком у родительской страницы, а закрыть себе самим — заголовком `Permissions-Policy: serial=(), usb=(), hid=(), bluetooth=(), midi=()`. Сайту, которому железо не нужно, такой заголовок стоит поставить: XSS на нём тогда не дотянется и до устройств.';

export const CLOSING =
  '**Пять API — один договор.** Страница просит только по клику, выбирает человек, сайт получает одно устройство и только его, а разрешение можно отозвать. Дальше каждый API говорит на языке своего протокола: Serial — потоком байтов, USB — передачами, Bluetooth — характеристиками, HID — отчётами, MIDI — короткими сообщениями. Работает это в Chromium; Firefox даёт Serial и MIDI через дополнение, Safari — ничего.';

// ─── Раздел 6. Как проверить без железа ────────────────────────────────────────────────────

export const TEST_ROWS = [
  ['наличие API, безопасный контекст', 'любой браузер', '`typeof navigator.serial` и т. п. на `https://` и `http://`'],
  ['ошибки без жеста, `getPorts()` на пустом профиле', 'Chromium, Firefox', 'код в `<script>` страницы, а не в `page.evaluate`'],
  ['полный цикл Serial', 'Firefox', 'настройки `dom.webserial.testing.enabled: true` и `dom.webserial.gated: false` — тестовый порт, который возвращает записанное'],
  ['полный цикл Bluetooth', 'Chromium', 'протокол DevTools: `BluetoothEmulation` создаёт устройство, `DeviceAccess` выбирает его в окне'],
  ['MIDI без устройств', 'Chromium', 'выданное разрешение — пустые `inputs` и `outputs`'],
  ['USB и HID', '—', 'подделки нет: только настоящее устройство'],
];

export const TEST_NOTE =
  'В Playwright `page.evaluate` выполняется **с жестом**: `navigator.userActivation.isActive` там `true`. Проверка «без клика будет `SecurityError`» через `evaluate` поэтому ничего не докажет — код надо класть в страницу. И наоборот: настоящий клик `page.click()` в headless Chromium не открывает окно выбора, а сразу ведёт себя как «окно закрыли» — `NotFoundError`.';

/**
 * Исполняется спеком дословно: `new AsyncFunction('browser', 'page', BT_EMULATION_CODE)`,
 * затем на странице — `BT_CODE` по клику.
 */
export const BT_EMULATION_CODE = `// Playwright + протокол DevTools: фальшивый браслет с зарядом 87%
const BATTERY = '0000180f-0000-1000-8000-00805f9b34fb';
const LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';
const CCCD = '00002902-0000-1000-8000-00805f9b34fb';   // дескриптор подписки
const address = '09:09:09:09:09:01';

const cdp = await browser.newBrowserCDPSession();
await cdp.send('BluetoothEmulation.enable', { state: 'powered-on', leSupported: true });
await cdp.send('BluetoothEmulation.simulatePreconnectedPeripheral', {
  address, name: 'Pulse-1', manufacturerData: [], knownServiceUuids: [BATTERY],
});
const { serviceId } = await cdp.send('BluetoothEmulation.addService', { address, serviceUuid: BATTERY });
const { characteristicId } = await cdp.send('BluetoothEmulation.addCharacteristic', {
  serviceId, characteristicUuid: LEVEL, properties: { read: true, notify: true },
});
const { descriptorId } = await cdp.send('BluetoothEmulation.addDescriptor', {
  characteristicId, descriptorUuid: CCCD,
});

// устройство отвечает «успешно» (code 0) на подключение, чтение и подписку
cdp.on('BluetoothEmulation.gattOperationReceived', ({ type }) =>
  cdp.send('BluetoothEmulation.simulateGATTOperationResponse', { address, type, code: 0 }));
cdp.on('BluetoothEmulation.characteristicOperationReceived', ({ type }) =>
  cdp.send('BluetoothEmulation.simulateCharacteristicOperationResponse', {
    characteristicId, type, code: 0,
    ...(type === 'read' && { data: Buffer.from([87]).toString('base64') }),
  }));
cdp.on('BluetoothEmulation.descriptorOperationReceived', ({ type }) =>
  cdp.send('BluetoothEmulation.simulateDescriptorOperationResponse', { descriptorId, type, code: 0 }));

// окно выбора: взять первое устройство из списка, один раз
const pageCdp = await page.context().newCDPSession(page);
await pageCdp.send('DeviceAccess.enable');
pageCdp.once('DeviceAccess.deviceRequestPrompted', ({ id, devices }) =>
  pageCdp.send('DeviceAccess.selectPrompt', { id, deviceId: devices[0].id }));`;

export const BT_EMULATION_NOTE =
  'Устройство здесь — набор ответов: на каждое действие страницы браузер присылает событие, и тест отвечает «успешно» или кодом ошибки. Так проверяются подключение, перечисление сервисов, чтение и подписка. Прислать странице **новое значение** от устройства этот протокол в Chromium 153 не умеет: подписку на уведомления проверить можно, сам приход уведомления — нет. Если у характеристики нет дескриптора `0x2902`, `startNotifications()` отвечает `NotSupportedError`.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`await` до `requestPort` может съесть жест',
    code: "button.onclick = async () => {\n  const cfg = await fetch('/config').then((r) => r.json());\n  await navigator.serial.requestPort();   // SecurityError, если ответ шёл дольше нескольких секунд\n};",
    d: 'Жест живёт несколько секунд — на стенде через 5,5 с его уже не было. Сначала окно выбора, потом всё остальное.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Отмена у HID — не ошибка',
    d: 'Serial и USB на закрытое окно отвечают `NotFoundError`, а `hid.requestDevice()` возвращает пустой массив. Код `const [device] = …` без проверки упадёт дальше, на `device.open()`, с непонятным `TypeError`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Строка приходит кусками',
    d: 'Один `reader.read()` — не одна строка и не одно сообщение устройства. Копите хвост до разделителя. С двоичным протоколом то же самое: длину пакета берите из заголовка, а не из размера куска.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`port.close()` при запертом потоке',
    d: 'По спецификации закрытие отклоняется, пока поток держит читатель или писатель. Firefox 155 на стенде закрыл порт и так, но рассчитывать на это нельзя: сначала `reader.cancel()` и `writer.close()`, потом `port.close()`.',
  },
  {
    n: '05',
    t: 'Неназванный сервис Bluetooth не существует',
    d: 'Сервис, которого нет ни в `filters`, ни в `optionalServices`, для сайта невидим: `getPrimaryService` — `SecurityError`, `getPrimaryServices()` его не перечислит. Список нужных сервисов пишется заранее, в запросе.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Нота с силой 0 — это «отпущена»',
    d: 'Многие MIDI-клавиатуры не шлют `0x8n` вовсе: отпускание приходит как `0x9n` с силой 0. Обработчик, который считает всякое `0x9n` нажатием, оставит ноты звучать вечно.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  { title: 'WHATWG — WebSerial Standard', href: 'https://serial.spec.whatwg.org/', what: '`requestPort`, `open`, потоки порта, порядок закрытия' },
  { title: 'WebUSB API', href: 'https://usb.spec.whatwg.org/', what: 'передачи, `claimInterface`, защищённые классы интерфейсов' },
  { title: 'Web Bluetooth', href: 'https://webbluetoothcg.github.io/web-bluetooth/', what: 'GATT, `optionalServices`, проверка blocklist' },
  { title: 'WebHID API', href: 'https://wicg.github.io/webhid/', what: 'отчёты, коллекции, почему клавиатуры закрыты' },
  { title: 'Web MIDI API', href: 'https://webaudio.github.io/web-midi-api/', what: 'входы, выходы, `onmidimessage`, sysex' },
  { title: 'Bluetooth GATT blocklist', href: 'https://github.com/WebBluetoothCG/registries/blob/master/gatt_blocklist.txt', what: 'закрытые сервисы и характеристики' },
  { title: 'WebHID blocklist', href: 'https://github.com/WICG/webhid/blob/main/blocklist.txt', what: 'мыши, клавиатуры, системное управление, FIDO' },
  { title: 'Mozilla standards positions', href: 'https://mozilla.github.io/standards-positions/', what: 'Serial (#336), WebUSB (#100), Web Bluetooth (#95), WebHID (#459), Web MIDI (#58)' },
  { title: 'WebKit standards positions — Web Serial', href: 'https://github.com/WebKit/standards-positions/issues/199', what: 'позиция oppose; там же #68 WebUSB, #570 Web Bluetooth, #510 WebHID' },
  { title: 'WebKit — Tracking Prevention', href: 'https://webkit.org/tracking-prevention/', what: 'Web MIDI и остальные API, отложенные из-за отпечатка' },
  { title: 'Firefox 151 for developers', href: 'https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/151', what: 'Web Serial в Firefox через дополнение-разрешение' },
  { title: 'Chrome — Web MIDI permission prompt', href: 'https://developer.chrome.com/blog/web-midi-permission-prompt', what: 'разрешение на любой доступ к MIDI с Chrome 124' },
  { title: 'Yubico — Security Advisory YSA-2018-02', href: 'https://www.yubico.com/support/issue-rating-system/security-advisories/ysa-2018-02/', what: 'фишинг ключа через WebUSB и как Chrome 67 его закрыл' },
  { title: 'Chrome DevTools Protocol — BluetoothEmulation', href: 'https://chromedevtools.github.io/devtools-protocol/tot/BluetoothEmulation/', what: 'фальшивые Bluetooth-устройства для тестов; выбор в окне — домен DeviceAccess' },
];

export const RELATED =
  'Смежное на сайте: [Стримы](/platform/streams/) — потоки, на которых построен Web Serial. [Двоичные данные](/js/binary-data/) — `Uint8Array`, `DataView`, текст из байтов. [Безопасность фронтенда](/platform/security/) — источник и заголовки, которыми закрывают API для фреймов. [WebRTC](/platform/webrtc/) — камера и микрофон, другой путь к устройствам через разрешения. [Страница и система](/js/os-integration/) — экран, «Поделиться», значок и оплата: те же правила жеста и разрешений.';
