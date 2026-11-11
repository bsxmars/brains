import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
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
 * Дополнительно device-hardware.test.ts исполняет те же helpers на подставных устройствах:
 * cleanup после ошибок, разделение UTF-8 и строк, MIDI hotplug и снятие подписок.
 * Это проверка логики приложения, не USB/HID-стека.
 * Что нативно не проверено: чтение и запись USB и HID — нужно настоящее устройство;
 * для USB, HID и Serial в Chromium подделки нет — в протоколе DevTools нет таких доменов
 * (сверено по `browser_protocol.json` ChromeDevTools), а флагов запуска с фальшивыми портами
 * мы не нашли. Поэтому `USB_CODE` и `HID_CODE` исполняются только до окна выбора.
 *
 * Позиции Mozilla и Apple — по `activities.yml` в mozilla/standards-positions и меткам
 * задач в WebKit/standards-positions на 2026-11-03 (ссылки — в `SOURCES`).
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const PLAIN_DEVICE = "Эти API передают странице данные в формате самого устройства. Например, Serial даёт байты из порта платы, а не готовые события «нажата кнопка». Страница должна знать протокол платы: какую команду послать, где заканчивается ответ и что значат его байты. Разрешение браузера открывает канал, но не объясняет этот протокол.";

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'последовательный порт',
    d: 'Канал, по которому байты идут друг за другом. У платы Arduino или ESP32 это USB-кабель, который система показывает как `COM3` или `/dev/tty.usbmodem…`. Так же подключены 3D-принтеры, станки, сканеры штрихкодов.',
  },
  {
    k: 'безопасный контекст',
    d: 'Среда, которую браузер считает безопасной: обычно HTTPS, а также локальная разработка на loopback-адресах. Проверяется `window.isSecureContext`. На обычном HTTP вне этой среды объектов этих API нет.',
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

async function readLine(stream, signal) {
  const reader = stream.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  let tail = '';
  try {
    signal.throwIfAborted();
    signal.addEventListener('abort', cancel, { once: true });
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) throw new Error('Поток завершился до конца строки');
      tail += value;
      const end = tail.indexOf('\\n');
      if (end !== -1) return tail.slice(0, end);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function pingPort(port) {
  await port.open({ baudRate: 9600 });
  let piped;
  try {
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode('ping\\n'));
    } finally {
      writer.releaseLock();
    }

    const decoder = new TextDecoderStream();
    piped = port.readable.pipeTo(decoder.writable);
    void piped.catch(() => {}); // pipeTo может отклониться раньше readLine
    const line = await readLine(decoder.readable, AbortSignal.timeout(3000));
    console.log('строка:', line);
  } finally {
    // readLine уже отменил чтение. pipeTo освобождает блокировку port.readable
    await piped?.catch(() => {});
    await port.close();
  }
  console.log('порт закрыт');
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const port = await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x2341 }], // только этот производитель, не проверка прошивки
    });
    await pingPort(port);
  } catch (error) {
    console.log('ошибка:', error.name);
  } finally {
    button.disabled = false;
  }
});`;

export const SERIAL_OUT = 'строка: ping\nпорт закрыт';

export const SERIAL_NOTE = "Записанный вывод получен на тестовом порту Firefox: он возвращает отправленные байты, поэтому на `ping` пришёл `ping`. Настоящая плата должна иметь прошивку с тем же протоколом. `readLine` ждёт первую строку не дольше трёх секунд; это срок чтения ответа, а не гарантия длительности `open()` или записи. После успеха и после ошибки `finally` освобождает порт.";

export const PLAIN_BAUD = "`baudRate` задаёт скорость обмена, например 9600 бит в секунду. Её берут из документации устройства. Для настоящего UART несовпадение скоростей может испортить данные; у виртуального USB-порта настройка может обрабатываться прошивкой иначе. Браузер не угадывает нужное значение.";

export const STREAM_FACTS = [
  '`port.readable` — обычный `ReadableStream`, кусками в нём идут `Uint8Array`. `port.writable` — `WritableStream`, туда пишут `Uint8Array`. До `open()` оба равны `null`;',
  '**куски не совпадают со строками.** Порт отдаёт байты по мере прихода: одна строка может приехать тремя кусками, а три строки — одним. Поэтому хвост без `\\n` откладывают до следующего куска;',
  '`TextDecoderStream` склеивает и байты: буква «ж» в UTF-8 — два байта, и если кусок разрезал её пополам, декодер дождётся второй половины;',
  '**разрешение и соединение — разные вещи.** `port.close()` освобождает открытый порт, но не отзывает разрешение сайта. `port.forget()` решает другую задачу: убрать ранее выданный доступ.',
];

export const STREAM_LINK =
  'Почему поток один на одного читателя и как его отменять — в [«Стримах», раздел «Отмена, `tee` и блокировка читателя»](/platform/streams/#s5).';

// ─── Раздел 2. Разрешения ──────────────────────────────────────────────────────────────────

export const PERMISSION_STEPS = [
  '**Безопасный контекст.** Все пять API требуют безопасной среды; её проверяют через `isSecureContext`. Поддержка самого API проверяется отдельно;',
  '**жест для окна выбора.** Serial, USB, Bluetooth и HID требуют кратковременной активации пользователя для `requestPort()` / `requestDevice()`. Не откладывайте запрос за долгий `await`;',
  '**выбор устройства.** Serial, USB и Bluetooth возвращают одно выбранное устройство; HID возвращает массив выбранных устройств, включая пустой массив при отмене. Список кандидатов страница не получает;',
  '**MIDI — другой контракт.** `requestMIDIAccess()` запрашивает доступ к MIDI, без обязательного жеста и без окна выбора одного устройства. При успехе `MIDIAccess.inputs` / `outputs` содержат доступные MIDI-порты. Браузер всё равно может запросить разрешение или отказать;',
  '**повторный доступ и отзыв.** У Serial есть `getPorts()` и `port.forget()`, у USB и HID — `getDevices()` и `device.forget()`. Наличие других методов проверяют для конкретного API. Закрыть соединение — не значит отозвать разрешение;',
  '**фреймы.** Доступ ограничивает `Permissions-Policy`: разрешение пользователя не отменяет запрет родителя. Делегирование фрейму тоже не заменяет разрешение пользователя.',
];

export const PLAIN_GESTURE =
  'Жест — это доказательство, что человек сейчас здесь и сам что-то нажал. Без этого правила любой сайт мог бы при загрузке показать окно «Разрешить доступ к устройству?», и человек нажал бы «Да», не читая. Код не может подделать жест: `button.click()` из скрипта вызывает обработчик, но жестом не считается. И жест живёт недолго: если между кликом и `requestPort` прошло несколько секунд — например, страница ждала ответа сервера, — запрос снова упадёт.';

/**
 * При загрузке выполняется модулем: верхний `await` работает только там.
 * Спек проверяет `при загрузке: 0` в Chromium и всю тройку — в Firefox на тестовом порту.
 */
export const PERMISSION_CODE = `const button = document.querySelector('#connect');

// При загрузке: жеста нет, окна нет — только то, что уже разрешено
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
  'Таблица — снимок указанных движков, а не обещание всех браузеров на их основе. Проверяйте наличие API в текущей среде, например `\'serial\' in navigator`, затем обрабатывайте отказ запроса. Позиции разработчиков ниже зафиксированы по источникам на ноябрь 2026 года.';

export const FIREFOX_NOTE =
  'В Firefox Serial и MIDI есть, но не открываются простым окном. При первом запросе Firefox предлагает установить **дополнение-разрешение** для этого сайта: его генерирует сам браузер, и ставить его человек должен сознательно. Если устройств MIDI нет, Firefox отказывает молча и не сразу: в нашей проверке промис висел 13,5 секунды и только потом отклонился `SecurityError`, а в консоли Firefox написал «Silently denying site request for MIDI access because no devices were detected».';

export const POSITIONS = [
  {
    k: 'Mozilla',
    d: 'USB, Bluetooth и HID — **negative** (против). Довод: устройства не рассчитаны на то, что с ними будет говорить случайный сайт, а одной кнопкой «Разрешить» человек не может осознанно согласиться на такой доступ. Serial — **neutral** (нейтрально), MIDI — **positive** (за), но оба только через дополнение-разрешение: устройство часто выполняет команды, не проверяя, кто их прислал.',
  },
  {
    k: 'Apple (WebKit)',
    d: 'Serial, USB, Bluetooth и HID — **oppose** (против). Доводы: риски для безопасности и приватности, а ещё сайт начинает работать только с конкретным устройством. MIDI в WebKit тоже нет: он в списке API, отложенных из-за слежки по отпечатку. Набор подключённых устройств помогает отличить одного человека от другого.',
  },
];

// ─── Раздел 4. Четыре других API ───────────────────────────────────────────────────────────

/**
 * Обмен с конкретной прошивкой WebUSB. E2E проверяет отказ выбора, unit — cleanup
 * на подставном устройстве; успешный нативный обмен с платой здесь не утверждается.
 */
export const USB_CODE = `const button = document.querySelector('#connect');

async function readUsb(device) {
  await device.open();
  let claimed = false;
  try {
    // Номера из прошивки этой платы, не универсальные значения для USB
    await device.selectConfiguration(1);
    await device.claimInterface(2);
    claimed = true;
    const setup = await device.controlTransferOut({
      requestType: 'class', recipient: 'interface',
      request: 0x22, value: 0x01, index: 2,
    });
    if (setup.status !== 'ok') throw new Error('Управляющая передача не выполнена');
    const result = await device.transferIn(5, 64);
    if (result.status !== 'ok' || !result.data) throw new Error('Ответ USB не получен');
    console.log(new TextDecoder().decode(result.data));
  } finally {
    try {
      if (claimed) await device.releaseInterface(2);
    } finally {
      await device.close();
    }
  }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const device = await navigator.usb.requestDevice({ filters: [{ vendorId: 0x2341 }] });
    await readUsb(device);
  } catch (error) {
    console.log('ошибка:', error.name);
  } finally {
    button.disabled = false;
  }
});`;

export const PLAIN_TRANSFERS =
  'USB-устройство — это почтовое отделение с несколькими окошками. **Интерфейс** — отдел: у веб-камеры отдельно видео и звук. **Конечная точка** — окошко в отделе, у каждого номер и направление «сюда» или «отсюда». **Управляющая передача** — короткая записка начальнику отдела («включи светодиод», «назови модель»). **Массовая передача** — посылки через окошко: данные большими порциями, без гарантии времени, но целиком.';

export const USB_NOTE = "Этот обмен рассчитан на конкретную Arduino с прошивкой WebUSB: конфигурацию, интерфейс, конечную точку и управляющую команду берут из её описания. Нативная браузерная проба без платы проверяет только отмену выбора; успешный обмен здесь не измерен. Тесты на подставном объекте проверяют логику: даже при ошибке передачи код освобождает интерфейс и закрывает устройство. Системный драйвер может занимать интерфейс, а защищённые классы спецификация запрещает независимо от драйвера.";

/**
 * Исполняется спеком целиком на фальшивом устройстве Chromium (`BluetoothEmulation`):
 * имя `Pulse-1`, батарейный сервис, уровень 87.
 */
export const BT_CODE = `const button = document.querySelector('#connect');

async function watchBattery(device) {
  let level;
  let subscribed = false;
  const changed = (e) => console.log('новый заряд:', e.target.value.getUint8(0) + '%');
  const stop = async () => {
    level?.removeEventListener('characteristicvaluechanged', changed);
    try {
      if (subscribed && device.gatt.connected) {
        subscribed = false;
        await level.stopNotifications();
      }
    } finally {
      device.gatt.disconnect();
    }
  };
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('battery_service');
    level = await service.getCharacteristic('battery_level');
    const value = await level.readValue();
    console.log(device.name, 'заряд:', value.getUint8(0) + '%');
    if (level.properties.notify || level.properties.indicate) {
      level.addEventListener('characteristicvaluechanged', changed);
      await level.startNotifications();
      subscribed = true;
      console.log('подписка оформлена');
    }
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}

let stopBattery;
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (stopBattery) {
      const stop = stopBattery;
      stopBattery = null;
      button.textContent = 'Подключить';
      await stop();
      return;
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: ['battery_service'] }],
    });
    stopBattery = await watchBattery(device);
    button.textContent = 'Отключить';
  } catch (error) {
    console.log('ошибка:', error.name);
  } finally {
    button.disabled = false;
  }
});`;

export const BT_OUT = 'Pulse-1 заряд: 87%\nподписка оформлена';

export const PLAIN_GATT =
  'Bluetooth LE-устройство устроено как шкаф с папками. **Сервис** — папка на одну тему: «батарея», «пульс». **Характеристика** — лист в папке с одним значением: «уровень заряда — 87». Каждую папку и лист называет UUID; для стандартных есть короткие имена вроде `battery_service`. Значение можно прочитать, записать или подписаться на него — тогда устройство само присылает новое, когда оно меняется. Этот набор правил и называется GATT.';

export const BT_NOTE = "Записанный вывод получен на устройстве, созданном через DevTools в Chromium: батарея читается, подписка устанавливается. Приход нового значения эта нативная эмуляция не проверяет. Если характеристика не поддерживает уведомления, остаётся только чтение. Повторный клик снимает обработчик, останавливает уведомления и разрывает GATT-соединение; при ошибке настройки соединение тоже закрывается. Сайт получает только сервисы, названные в `filters` или `optionalServices`; это ограничение доступа, а не проверка безопасности самого сервиса.";

/** Без устройства спек доходит до `устройство не выбрано`: окно в headless shell закрыто. */
export const HID_CODE = `const button = document.querySelector('#connect');

async function watchHid(device) {
  await device.open();
  const report = (e) => console.log(e.reportId,
    new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
  device.addEventListener('inputreport', report);
  return async () => {
    device.removeEventListener('inputreport', report);
    await device.close();
  };
}

let stopHid;
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (stopHid) {
      const stop = stopHid;
      stopHid = null;
      button.textContent = 'Подключить';
      await stop();
      return;
    }
    const [device] = await navigator.hid.requestDevice({
      filters: [{ vendorId: 0x057e }], // Nintendo
    });
    if (!device) return console.log('устройство не выбрано');
    // В этом примере используем только первый элемент результата
    stopHid = await watchHid(device);
    button.textContent = 'Отключить';
  } catch (error) {
    console.log('ошибка:', error.name);
  } finally {
    button.disabled = false;
  }
});`;

export const HID_OUT = 'устройство не выбрано';

export const HID_NOTE =
  'HID — протокол клавиатур, мышей, геймпадов, а ещё педалей, пультов, считывателей карт. Устройство говорит **отчётами**: пачками байтов с номером. Что значит каждый байт, оно само описывает в дескрипторе — `device.collections` отдаёт этот дескриптор разобранным. Входной отчёт приходит событием `inputreport`, выходной уходит `sendReport()`, настройки читаются и пишутся отчётами-«свойствами» (`receiveFeatureReport`, `sendFeatureReport`).';

/** Спек исполняет код модулем в Chromium с выданным разрешением, затем зовёт `describe` на `MIDI_SAMPLES`. */
export const MIDI_CODE = `function describe([status, data1, data2]) {
  const command = status >> 4;            // старшие 4 бита: что случилось
  const channel = (status & 0x0f) + 1;    // младшие 4 бита: канал 1–16
  if (command === 0x9 && data2 > 0) return \`канал \${channel}: нажата нота \${data1}, сила \${data2}\`;
  if (command === 0x8 || command === 0x9) return \`канал \${channel}: отпущена нота \${data1}\`;
  if (command === 0xb) return \`канал \${channel}: регулятор \${data1} = \${data2}\`;
  return \`другое: \${status.toString(16)}\`;
}

function watchMidi(midi) {
  const inputs = new Set();
  const message = (e) => console.log(describe(e.data));
  const attach = (port) => {
    if (port.type !== 'input' || port.state !== 'connected' || inputs.has(port)) return;
    inputs.add(port);
    port.addEventListener('midimessage', message); // неявно открывает MIDI-вход
  };
  const changed = (e) => {
    console.log(e.port.name, e.port.state);
    attach(e.port); // в том числе клавиатура, подключённая после загрузки
  };
  for (const input of midi.inputs.values()) attach(input);
  midi.addEventListener('statechange', changed);
  return async () => {
    midi.removeEventListener('statechange', changed);
    await Promise.allSettled([...inputs].map((input) => {
      input.removeEventListener('midimessage', message);
      return input.close();
    }));
    inputs.clear();
  };
}

let stopMidi = async () => {};
try {
  const midi = await navigator.requestMIDIAccess(); // без sysex, без chooser устройства
  console.log('входов:', midi.inputs.size, 'выходов:', midi.outputs.size);
  stopMidi = watchMidi(midi);
  // В приложении вызывайте stopMidi при закрытии музыкального инструмента
  window.addEventListener('pagehide', () => { void stopMidi(); }, { once: true });
} catch (error) {
  console.log('ошибка:', error.name);
}`;

export const MIDI_OUT = 'входов: 0 выходов: 0';

export const MIDI_SAMPLES: { bytes: number[]; out: string }[] = [
  { bytes: [0x90, 60, 100], out: 'канал 1: нажата нота 60, сила 100' },
  { bytes: [0x80, 60, 0], out: 'канал 1: отпущена нота 60' },
  { bytes: [0x90, 60, 0], out: 'канал 1: отпущена нота 60' },
  { bytes: [0xb1, 7, 90], out: 'канал 2: регулятор 7 = 90' },
];

export const MIDI_NOTE = "Здесь `describe` разбирает только три вида канальных сообщений: ноту, отпускание ноты и регулятор. Они занимают три байта: статус и два значения. Другие MIDI-сообщения бывают короче, а sysex — длиннее. `0x90 60 100` означает ноту 60 на первом канале с силой 100; сила 0 у `0x9n` тоже означает отпускание. `watchMidi` подхватывает новые входы по `statechange`, а возвращённый `stopMidi` снимает подписки и закрывает использованные входы. Отправка ноты — `output.send([0x90, 60, 100])`.";

export const SYSEX_NOTE =
  '**Sysex** — сообщение `F0 … F7` любой длины в формате производителя. Им синтезаторы принимают пресеты, а часто и новую прошивку. Поэтому у разрешения два уровня: `requestMIDIAccess()` и `requestMIDIAccess({ sysex: true })`. В Chromium с версии 124 спрашивается любой доступ к MIDI, а не только sysex; sysex просят, только если без него никак.';

export const API_ROWS = [
  ['Serial', 'поток байтов к порту', '`requestPort` → `open({ baudRate })` → `readable` / `writable`', 'платы разработчика, принтеры, станки, весы'],
  ['USB', 'передачи к интерфейсам устройства', '`requestDevice` → `open` → `claimInterface` → `transferIn` / `Out`', 'устройства без системного драйвера, прошивальщики'],
  ['Bluetooth LE', 'значения характеристик GATT', '`requestDevice` → `gatt.connect` → сервис → характеристика', 'браслеты, датчики, умные лампы'],
  ['HID', 'отчёты по описанию устройства', '`requestDevice` → `open` → `inputreport` / `sendReport`', 'геймпады вне Gamepad API, педали, пульты'],
  ['MIDI', 'короткие сообщения; sysex переменной длины', '`requestMIDIAccess` → `inputs` / `outputs` → `onmidimessage`', 'клавиатуры, контроллеры, синтезаторы'],
];

// ─── Раздел 5. Почему это опасно ───────────────────────────────────────────────────────────

export const DANGER_WHY = "Разрешение отвечает на вопрос «этому сайту можно открыть канал?», но не на вопрос «безопасны ли его команды?». Устройство может принимать команды движения, изменения настроек или перепрошивки. Их допустимость определяется протоколом и прошивкой; браузер не понимает смысл каждого пакета. Поэтому фильтр по производителю не заменяет проверку совместимости, а окно выбора не делает произвольный сайт доверенным.";

export const YUBIKEY_NOTE =
  'Так уже было. В феврале 2018 года Маркус Фервир и Микеле Орру показали фишинг через WebUSB. Ключ YubiKey NEO защищает вход тем, что сверяет адрес сайта: поддельный сайт получит отказ. Но через WebUSB поддельная страница просила «подключить» ключ, человек выбирал его в окне, и страница слала ключу запрос напрямую через интерфейс смарт-карты — уже без сверки адреса. Chrome 67 закрыл этот путь: класс интерфейса смарт-карты вошёл в список защищённых.';

export const BLOCK_ROWS = [
  ['USB', 'интерфейсы аудио, HID, накопителей, хабов, смарт-карт, видео и беспроводных контроллеров — у них есть свой системный путь; плюс список отдельных устройств'],
  ['HID', 'мыши, клавиатуры, цифровые клавиатуры, системное управление (кнопки питания, сна) и FIDO-ключи — иначе сайт стал бы кейлоггером'],
  ['Bluetooth', 'сервис HID (`0x1812`, клавиатуры по Bluetooth), сервисы FIDO-ключей, сервисы обновления прошивки Nordic, TI и Cypress; запись в часть служебных характеристик'],
  ['MIDI', 'blocklist нет — опасную часть, sysex, закрывает отдельный уровень разрешения'],
];

export const BLOCK_NOTE =
  'Геймпадов в blocklist HID нет: через WebHID достают то, чего не знает Gamepad API, — подсветку, вибрацию, модели, которых нет в его списке. Bluetooth сверяется с blocklist на каждом шаге: сервис HID в `filters` сразу даёт `SecurityError`, а из `optionalServices` браузер молча его убирает.';

export const FRAME_NOTE = "`Permissions-Policy` ограничивает API независимо от пользовательского разрешения. По умолчанию доступ разрешён своему источнику; для чужого iframe нужно делегирование, например `allow=\"serial\"`. Атрибут не отменяет запрет, заданный заголовком родителя. Заголовок `Permissions-Policy: serial=(), usb=(), hid=(), bluetooth=(), midi=()` запрещает эти API странице и её фреймам. Это сужает возможности внедрённого скрипта, но не защищает от самого XSS.";

export const CLOSING = "**Открыть канал — только начало.** Формат команд задаёт устройство, разрешение ограничивает браузер, а открытые соединения и подписки освобождает приложение. Для каждого API нужны собственные обработка отказа и завершение работы.";

// ─── Раздел 6. Как проверить без железа ────────────────────────────────────────────────────

export const TEST_ROWS = [
  ['наличие API, безопасный контекст', 'любой браузер', '`typeof navigator.serial` и т. п. на `https://` и `http://`'],
  ['ошибки без жеста, `getPorts()` на пустом профиле', 'Chromium, Firefox', 'код в `<script>` страницы, а не в `page.evaluate`'],
  ['полный цикл Serial', 'Firefox', 'настройки `dom.webserial.testing.enabled: true` и `dom.webserial.gated: false` — тестовый порт, который возвращает записанное'],
  ['полный цикл Bluetooth', 'Chromium', 'протокол DevTools: `BluetoothEmulation` создаёт устройство, `DeviceAccess` выбирает его в окне'],
  ['MIDI без устройств', 'Chromium', 'выданное разрешение — пустые `inputs` и `outputs`'],
  ['логика USB и HID после выбора', 'модульные тесты', 'подставные объекты: ошибки передачи, снятие подписок, releaseInterface и close; без проверки USB/HID-стека'],
  ['нативный обмен USB и HID', 'на стенде не проверен', 'нужно совместимое устройство и его протокол'],
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
  'Устройство здесь — набор ответов: на каждое действие страницы браузер присылает событие, и тест отвечает «успешно» или кодом ошибки. Так проверяются подключение, перечисление сервисов, чтение и подписка. Прислать странице **новое значение** от устройства этот протокол в Chromium 153 не умеет: подписку на уведомления проверить можно, сам приход уведомления — нет. В этом стенде для успешной подписки добавлен дескриптор `0x2902`: без него эмуляция ответила `NotSupportedError`.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`await` до `requestPort` может съесть жест',
    code: "button.onclick = async () => {\n  const cfg = await fetch('/config').then((r) => r.json());\n  await navigator.serial.requestPort();   // SecurityError, если ответ шёл дольше нескольких секунд\n};",
    d: 'Жест живёт несколько секунд: в нашей проверке через 5,5 с после клика его уже не было. Поэтому сначала открывают окно выбора, а запросы к серверу делают потом.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'HID при отмене не бросает ошибку',
    d: 'Serial и USB на закрытое окно отвечают `NotFoundError`, а `hid.requestDevice()` возвращает пустой массив. Код `const [device] = …` без проверки упадёт дальше, на `device.open()`, с непонятным `TypeError`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Строка приходит кусками',
    d: 'Один `reader.read()` не равен одной строке или одному сообщению устройства. Копите хвост, пока не придёт разделитель. С двоичным протоколом то же самое: длину пакета берите из заголовка, а не из размера куска.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`port.close()` при запертом потоке',
    d: 'Закрытие порта требует освободить блокировки его потоков. В примере запись уже дожидается write и освобождает writer; чтение отменяет reader, освобождает его и дожидается pipeTo. Одного writer.close() недостаточно, если writer всё ещё держит блокировку.',
  },
  {
    n: '05',
    t: 'Сервис Bluetooth, не названный в запросе, сайту не виден',
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


/** Учебная схема блокировок из SERIAL_CODE; не результат замера устройства. */
export const SERIAL_CLEANUP_DIAGRAM: ConceptDiagramData = {
  id: 'serial-cleanup',
  title: 'Два потока должны отпустить порт',
  description: 'Условия закрытия порта в pingPort: освободить выходной поток и завершить запущенное чтение. pipeTo держит собственную блокировку входного потока порта.',
  width: 900,
  height: 660,
  nodes: [
    { id: 'write', x: 35, y: 30, width: 340, height: 110, label: 'writer.write завершён', detail: 'Успех или ошибка записи', tone: 'info' },
    { id: 'writerfree', x: 35, y: 240, width: 340, height: 110, label: 'writer.releaseLock()', detail: 'Освобождён port.writable', tone: 'ok' },
    { id: 'read', x: 525, y: 30, width: 340, height: 110, label: 'readLine завершает чтение', detail: 'Ответ, ошибка или срок ожидания', tone: 'info' },
    { id: 'readerfree', x: 525, y: 240, width: 340, height: 110, label: 'cancel → releaseLock', detail: 'Освобождён поток декодера', tone: 'ok' },
    { id: 'pipefree', x: 525, y: 430, width: 340, height: 110, label: 'Дождаться pipeTo', detail: 'Освобождён port.readable', tone: 'ok' },
    { id: 'close', x: 35, y: 520, width: 340, height: 110, label: 'port.close()', detail: 'Открытый порт освобождён', tone: 'ink' },
  ],
  edges: [
    { from: 'write', to: 'writerfree', fromSide: 'bottom', toSide: 'top', label: 'finally', labelX: 205, labelY: 190 },
    { from: 'read', to: 'readerfree', fromSide: 'bottom', toSide: 'top', label: 'finally', labelX: 695, labelY: 190 },
    { from: 'readerfree', to: 'pipefree', fromSide: 'bottom', toSide: 'top' },
    { from: 'writerfree', to: 'close', fromSide: 'bottom', toSide: 'top', label: 'выходной поток свободен', labelX: 205, labelY: 445 },
    { from: 'pipefree', to: 'close', fromSide: 'bottom', toSide: 'right', via: [[695, 575]], label: 'входной поток свободен', labelX: 625, labelY: 620 },
  ],
  note: 'Чтение начинается после успешной записи; при ошибке записи pipeTo ещё не запущен. close ждёт освобождения использованных потоков и закрывает соединение, а forget отзывает разрешение.',
};
