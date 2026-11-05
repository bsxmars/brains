import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Голос: запись с микрофона и речь».
 *
 * Тема написана 2026-11-03 вместе с двумя соседними медиатемами («Звук: Web Audio API» —
 * `/js/media-audio/`, писалась параллельно). Звонок и `RTCPeerConnection` не повторяются:
 * их дом — «WebRTC» (`/platform/webrtc/`); здесь микрофон — источник записи и речи.
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63 на macOS arm64: Chromium 153.0.8010.12 (headless shell и полный Chromium
 * `channel: 'chromium'`), Firefox 155.0, WebKit 26.6. Страница отдаётся `page.route` с выдуманного
 * источника `https://voice.test` (https — значит безопасный контекст). Микрофон поддельный:
 * Chromium `--use-fake-device-for-media-stream` + `--use-fake-ui-for-media-stream`, право
 * `microphone` у контекста; Firefox — `media.navigator.streams.fake`; WebKit — свой
 * «Mock audio device 1». Поддельный микрофон Chromium даёт короткий писк через равные
 * промежутки, между ними тишину. Пробы — `scratchpad/voice/`, повторяет `tests/e2e/media-voice.spec.ts`.
 *
 * Что снято пробами (и что из этого держит тест):
 *   — `RECORD_CODE` дословно: 2 с записи, `timeslice` 500 мс — 4 куска в четырёх прогонах
 *     подряд (5 — в отдельных пробах), тип `audio/webm;codecs=opus`, 24 157–24 471 байт на поддельном сигнале. Тест держит тип и число
 *     кусков (от 4 до 6), размер — только «больше нуля»;
 *   — `recorder.mimeType` пуст сразу после `start()` в Chromium и до конца записи в Firefox;
 *     тип у `event.data.type` есть всегда (тест: Chromium);
 *   — первый кусок начинается байтами `1a 45 df a3` (заголовок WebM), второй — нет, и
 *     `decodeAudioData` на нём одном — `EncodingError`; на склейке всех — 2,16 с из ~2,2 с;
 *   — `<audio>` с такой записью: `duration` — `Infinity`, после перемотки в конец — 2,1;
 *   — `isTypeSupported` и тип по умолчанию в трёх движках — `FORMAT_ROWS`, тест сверяет;
 *   — ошибки `ERROR_ROWS`: отказ (`--use-fake-ui-for-media-stream=deny`) и запрет
 *     `Permissions-Policy: microphone=()` — `NotAllowedError`; `deviceId: { exact }` —
 *     `OverconstrainedError`; `{}` — `TypeError`; на `http://` — `navigator.mediaDevices`
 *     нет вовсе. ⚠️ `NotFoundError` снят на **камере** (`device-count=0`): поддельные
 *     микрофоны этим флагом не убираются, а без флага Chromium берёт настоящий микрофон Mac.
 *     Контекст Playwright с `permissions: []` даёт `query` состояние `denied`, но `getUserMedia`
 *     этого не видит: с поддельным окном — согласие, без него — `NotSupportedError`. Поэтому
 *     «в `denied` ошибка сразу, без вопроса» — по спецификации Permissions, не снято;
 *     Без права и без поддельного окна headless Chromium отвечает `NotSupportedError` —
 *     спрашивать ему некого; это свойство стенда, в текст не идёт;
 *   — до разрешения `enumerateDevices` отдаёт устройства с пустыми `label`; после — с именами;
 *   — `track.stop()` посреди записи: запись кончается сама (`state` → `inactive`, событие
 *     `stop` через 2 мс), `stream.active` — `false`;
 *   — обработка: по умолчанию все три `true`, 48 000 Гц, один канал; с выключенной —
 *     44 100 Гц и разрешены два канала (поддельный микрофон); `applyConstraints({
 *     echoCancellation: true })` на дорожке с выключенной обработкой **выполняется без ошибки,
 *     а `getSettings()` остаётся `false`** (тест держит); `sampleRate: { exact: 8000 }` —
 *     `OverconstrainedError`;
 *   — битрейт: по умолчанию `audioBitsPerSecond` 128 000 и 40 980 байт за 3 с; с 32 000 —
 *     7 327 байт (поддельный сигнал, в основном тишина, кодек тратит на неё мало);
 *   — голоса: `getVoices()` пуст сразу после загрузки во всех трёх движках, потом приходит
 *     `voiceschanged`; на этом Mac — 180 голосов в Chromium, 53 в Firefox, 68 в WebKit; в Chromium
 *     русский один — «Milena» в headless shell и «Милена» в полном Chromium (имя переводится);
 *     голос по умолчанию тоже разный (Albert, Daria). Все `localService: true`. Тест держит
 *     только «сначала пусто, потом событие»;
 *   — `speak` без действия пользователя: Chromium — `error` с `not-allowed`, Firefox и WebKit
 *     говорят (тест: Chromium — оба случая). `page.evaluate` в Playwright считается действием
 *     пользователя (`userActivation.hasBeenActive === true`), поэтому проверка «без действия» — из
 *     скрипта страницы;
 *   — очередь: два `speak` подряд — `pending: true`, затем start/end первой, start/end второй;
 *     `cancel()` посреди фразы — `error` с `interrupted`; `rate = 20` → 10, `pitch = 5` → 2;
 *   — распознавание: Chromium — `SpeechRecognition === webkitSpeechRecognition`, статические
 *     `available` и `install`, свойства `processLocally`, `phrases`, `quality`; WebKit — только
 *     `webkitSpeechRecognition` без них; Firefox — ничего. В полном Chromium
 *     `available({ langs: ['ru-RU'], processLocally: true })` — `'downloadable'`, с
 *     `processLocally: false` — `'available'`. ⚠️ В headless shell `available()` **роняет
 *     вкладку** (Target crashed), поэтому распознавание тест запускает в полном Chromium;
 *   — `RECOGNIZE_CODE` в полном Chromium с поддельным микрофоном: события `start`, `audiostart`,
 *     затем `error` с `no-speech` и `end` (если раньше не вызвать `stop()` — тогда только `end`);
 *     ни одного `result`. **Что распознавание вернёт на живой речи,
 *     стенд не проверяет** — речи у поддельного микрофона нет, а облачный сервис Google
 *     сборке Playwright недоступен. Отправка звука на сервер — по документации (MDN, Chrome);
 *   — `UPLOAD_CODE` дословно, 3,1 с записи кусками по секунде: сервер (`page.route`) получил
 *     4 куска и склеил по номеру — 3,06 с; первые два — 1,98 с; без второго — 2,04 с;
 *     без первого — `EncodingError`. Три прогона подряд — одни и те же числа; тест держит
 *     отношения («короче целого») и `EncodingError`.
 *
 * Не проверялось: индикатор записи (в headless его нет — правило по спецификации Media
 * Capture), `NotReadableError` (микрофон занят другой программой), как распознавание ведёт
 * себя на настоящей речи, сколько весит запись живого голоса.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: '`MediaStream`',
    d: 'Живой поток звука или видео: с микрофона, камеры, экрана. Его не хранят и не читают по байтам — его подключают туда, где он нужен: к записи, к динамику, к звонку.',
  },
  {
    k: 'дорожка',
    d: '`MediaStreamTrack` — один источник внутри потока: один микрофон или одна камера. Пока у страницы есть хоть одна живая дорожка с микрофона, браузер считает, что микрофон занят.',
  },
  {
    k: '`MediaRecorder`',
    d: 'Записывает поток в файл. Сам сжимает звук и отдаёт готовые байты кусками через событие `dataavailable`.',
  },
  {
    k: 'контейнер и кодек',
    d: 'Кодек сжимает звук (Opus, AAC). Контейнер упаковывает сжатое в файл с заголовком (WebM, Ogg, MP4). Тип `audio/webm;codecs=opus` называет оба.',
  },
  {
    k: 'безопасный контекст',
    d: 'Страница с `https://` или с `localhost`. Только в нём у страницы есть `navigator.mediaDevices`; проверить можно через `isSecureContext`.',
  },
  {
    k: 'синтез и распознавание речи',
    d: 'Синтез — текст в звук: `speechSynthesis`. Распознавание — звук в текст: `SpeechRecognition`. Оба — часть Web Speech API, но устроены и поддержаны совсем по-разному.',
  },
];

export const PLAIN_STREAM =
  'Поток с микрофона — как кран с водой. Воду из крана не «читают», её подставляют под ведро или под шланг. `MediaRecorder` — ведро с крышкой: набирает и отдаёт порциями. А закрыть сам кран — это `track.stop()`. Пока кран открыт, вода течёт, даже если ведро вы уже унесли.';

export const PREREQ_NOTE = 'Запись приходит байтами и событиями, поэтому опора — две вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Blob — байты, которые где-то лежат',
    d: 'Узнать размер и отрезать кусок можно сразу, а прочитать байты — только асинхронно: `await blob.arrayBuffer()`. Запись с микрофона приходит именно так.',
    href: '/js/binary-data/#s5',
    hrefLabel: '«Двоичные данные», раздел «Blob и File»',
    tone: 'info',
  },
  {
    t: 'Промисы и `await`',
    d: '`getUserMedia` возвращает промис, который ждёт ответа человека на запрос разрешения. Ответ может не прийти долго, а может прийти отказом.',
    href: '/js/promise-internals/',
    hrefLabel: '«Промис изнутри»',
    tone: 'info',
  },
];

// ─── Раздел 1. Запись ──────────────────────────────────────────────────────────────────────

/**
 * Исполняется тестом дословно: `<script type="module">` на `https://voice.test` рядом с `<audio>`,
 * консоль сверяется с `RECORD_OUT` по типу и числу кусков (размер — машинный).
 */
export const RECORD_CODE = `const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
const recorder = new MediaRecorder(stream);
const chunks = [];

recorder.ondataavailable = (event) => chunks.push(event.data);
recorder.onstop = () => {
  stream.getTracks().forEach((track) => track.stop());   // отпустить микрофон
  const blob = new Blob(chunks, { type: chunks[0].type });
  console.log('кусков:', chunks.length);
  console.log('тип:', blob.type);
  console.log('байт:', blob.size);
  document.querySelector('audio').src = URL.createObjectURL(blob);
};

recorder.start(500);                        // отдавать кусок каждые полсекунды
setTimeout(() => recorder.stop(), 2000);    // писать две секунды`;

export const RECORD_OUT = `кусков: 4
тип: audio/webm;codecs=opus
байт: 24157`;

export const RECORD_NOTE =
  '`getUserMedia` спрашивает разрешение и отдаёт поток. `MediaRecorder` сжимает его и каждые 500 мс (это `timeslice`, аргумент `start`) отдаёт готовый кусок событием `dataavailable`. За две секунды кусков обычно четыре: три по полсекунды и последний, который приходит при `stop()`. Иногда браузер успевает отдать ещё один. Без `timeslice` кусок будет один — вся запись разом, в конце. Куски складывают в `Blob` и дальше обращаются с ним как с файлом: дают `<audio>` через `URL.createObjectURL`, отправляют на сервер, кладут в IndexedDB.';

export const PLAIN_CONTAINER =
  'Кодек и контейнер — как язык письма и конверт. Opus и AAC — языки: ими звук записан коротко. WebM, Ogg и MP4 — конверты: на них написано, что внутри и как читать. Письмо на одном и том же языке можно положить в разные конверты, но читать его будет только тот, кто знает и язык, и конверт.';

/**
 * Тест сверяет: `MediaRecorder.isTypeSupported` в трёх движках и тип куска по умолчанию
 * (с поддельным микрофоном каждого движка). Порядок колонок — Chromium, Firefox, WebKit.
 */
export const FORMAT_TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4;codecs=opus', 'audio/wav', 'audio/mpeg'] as const;

export const FORMAT_SUPPORT: Record<'chromium' | 'firefox' | 'webkit', boolean[]> = {
  chromium: [true, false, true, true, false, false],
  firefox: [true, true, false, false, false, false],
  webkit: [true, false, true, true, false, false],
};

export const FORMAT_DEFAULT: Record<'chromium' | 'firefox' | 'webkit', string> = {
  chromium: 'audio/webm;codecs=opus',
  firefox: 'audio/ogg; codecs=opus',
  webkit: 'audio/mp4; codecs=mp4a.40.2',
};

export const FORMAT_HEAD = ['тип', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'];

export const FORMAT_ROWS: string[][] = [
  ['по умолчанию', ...(['chromium', 'firefox', 'webkit'] as const).map((e) => `\`${FORMAT_DEFAULT[e]}\``)],
  ...FORMAT_TYPES.map((type, i) => [
    `\`${type}\``,
    ...(['chromium', 'firefox', 'webkit'] as const).map((e) => (FORMAT_SUPPORT[e][i] ? 'да' : 'нет')),
  ]),
];

export const FORMAT_NOTE =
  'Каждый движок пишет в свой формат, если не попросить другой: Chromium — WebM, Firefox — Ogg, WebKit — MP4 с AAC. Общий для всех трёх — только `audio/webm;codecs=opus`. WAV и MP3 `MediaRecorder` не пишет нигде. Поэтому тип выбирают явно, перебором `MediaRecorder.isTypeSupported(тип)`, и передают в `new MediaRecorder(stream, { mimeType })`. А на сервер отправляют тип из `event.data.type`: свойство `recorder.mimeType` в Chromium пусто сразу после `start()`, а в Firefox оставалось пустым до конца записи.';

export const HEADER_NOTE =
  'Куски — не отдельные файлы. Заголовок контейнера есть только в первом: у WebM он начинается байтами `1a 45 df a3`. Второй кусок сам по себе браузер не декодирует (`EncodingError`), а склейка всех по порядку — обычный файл. И у этого файла нет длительности: `MediaRecorder` пишет заголовок в начале, когда длина ещё неизвестна. `<audio>` с такой записью показывает `duration` равным `Infinity`. Настоящая длина появилась только после перемотки в конец, когда плеер дочитал файл.';

// ─── Раздел 2. Разрешение ─────────────────────────────────────────────────────────────────

/** Тест исполняет дословно с правом на микрофон и без него. */
export const PERMISSION_CODE = `const status = await navigator.permissions.query({ name: 'microphone' });
console.log('разрешение:', status.state);       // ничего не спрашивает, только читает

try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  console.log('микрофон:', stream.getAudioTracks()[0].label);
  stream.getTracks().forEach((track) => track.stop());
} catch (error) {
  console.log('ошибка:', error.name);
}`;

export const PERMISSION_OUT_GRANTED = `разрешение: granted
микрофон: Fake Default Audio Input`;

export const PERMISSION_OUT_DENIED = `разрешение: prompt
ошибка: NotAllowedError`;

export const PERMISSION_NOTE =
  'Браузер спрашивает разрешение в момент вызова `getUserMedia`, не раньше. `permissions.query` ничего не спрашивает: она только сообщает, что будет. `granted` — разрешение уже дано, вопроса не будет. `prompt` — вопрос появится. `denied` — человек отказал раньше: браузер запомнил ответ, и `getUserMedia` закончится `NotAllowedError` без вопроса. Отсюда правило: вызывать `getUserMedia` по нажатию кнопки «Записать», а не при загрузке страницы. Вопрос «можно микрофон?» без видимой причины человек отклоняет, а после отказа вернуть разрешение он может только сам, в настройках сайта.';

export const ERROR_ROWS: { k: string; when: string }[] = [
  { k: '`NotAllowedError`', when: 'человек отказал; или микрофон запрещён странице заголовком `Permissions-Policy: microphone=()`, или чужому `<iframe>` не дали `allow="microphone"`' },
  { k: '`NotFoundError`', when: 'устройства нужного вида нет ни одного' },
  { k: '`OverconstrainedError`', when: 'условие с `exact` невыполнимо, например `deviceId: { exact: \'…\' }` неизвестного микрофона; в `error.constraint` — какое именно' },
  { k: '`TypeError`', when: 'не попросили ни звука, ни видео: `getUserMedia({})`' },
  { k: 'нет `navigator.mediaDevices`', when: 'страница не в безопасном контексте (`http://` не на `localhost`): вызов падает с `TypeError` ещё до запроса' },
];

export const DEVICES_NOTE =
  'До разрешения страница знает о микрофонах немного: `enumerateDevices()` возвращает устройства с пустым `label`. Имена — «Микрофон MacBook Pro», «AirPods» — появляются только после разрешения. Так браузер не даёт сайту без спроса собрать примету вашего компьютера.';

export const STOP_CODE = `const [track] = stream.getAudioTracks();
track.stop();

console.log(track.readyState);     // 'ended'
console.log(stream.active);        // false
// recorder.state стал 'inactive', и пришло событие stop — запись кончилась сама`;

export const STOP_NOTE =
  'Пока у страницы есть живая дорожка с микрофона, браузер показывает индикатор записи: точку на вкладке, значок в адресной строке, в системе — оранжевую точку на Mac. Остановить `MediaRecorder` мало: это ведро, а кран — дорожка. Его закрывает `track.stop()` у каждой дорожки потока. Обратное тоже верно: если дорожку остановить посреди записи, `MediaRecorder` заканчивает её сам — `state` становится `inactive`, приходит последний кусок и событие `stop`. Отдельный `stop()` у записи после этого не нужен.';

// ─── Раздел 3. Обработка ───────────────────────────────────────────────────────────────────

/** Тест исполняет дословно; вывод сверяется с `PROCESSING_OUT`. */
export const PROCESSING_CODE = `const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
const [track] = stream.getAudioTracks();
const { echoCancellation, noiseSuppression, autoGainControl, sampleRate } = track.getSettings();
console.log(echoCancellation, noiseSuppression, autoGainControl, sampleRate);
console.log(track.getCapabilities().noiseSuppression);   // что вообще можно выбрать`;

export const PROCESSING_OUT = `false false false 44100
[true, false]`;

export const PLAIN_PROCESSING =
  'Обработка микрофона — как фильтры камеры телефона, только для звука. Эхоподавление вычитает из микрофона то, что играют ваши же динамики, — иначе собеседник слышит себя. Шумоподавление глушит вентилятор и клавиатуру. Автоусиление тянет тихий голос и прижимает громкий. Для разговора это благо, для записи гитары — порча: шумоподавление считает струны шумом.';

export const PROCESSING_ROWS: { k: string; on: string; off: string }[] = [
  { k: '`echoCancellation`', on: '`true`', off: '`false`' },
  { k: '`noiseSuppression`', on: '`true`', off: '`false`' },
  { k: '`autoGainControl`', on: '`true`', off: '`false`' },
  { k: '`sampleRate`', on: '48 000', off: '44 100' },
  { k: '`channelCount`', on: '1; два канала не выбрать', off: 'можно попросить 2' },
];

export const PROCESSING_NOTE =
  'По умолчанию браузер включает всю обработку: `getUserMedia({ audio: true })` готовит звук для звонка. Для голосовой заметки это подходит, для музыки и для распознавания на своём сервере — не всегда. Что включено на деле, говорит `getSettings()`, а не то, что вы просили: просьба без `exact` — пожелание, браузер вправе её не выполнить. `getCapabilities()` перечисляет, что дорожка вообще умеет. На поддельном микрофоне Chromium выключение обработки сменило и частоту: 44 100 Гц вместо 48 000, и стало можно попросить два канала.';

export const APPLY_NOTE =
  'Менять обработку на ходу через `track.applyConstraints` ненадёжно. В Chromium 153 `applyConstraints({ echoCancellation: true })` у дорожки с выключенной обработкой выполнился без ошибки, а `getSettings()` по-прежнему показывал `false`. Обработку выбирают при `getUserMedia`, а после любой смены проверяют `getSettings()`.';

export const LEVEL_NOTE =
  'Индикатор громкости «микрофон вас слышит» рисуют через Web Audio: поток подключают к `AnalyserNode` и раз в кадр читают уровень. На поддельном микрофоне Chromium такой замер видит писк через равные промежутки и тишину между ними. Как устроен граф узлов и что отдаёт анализатор — в теме [«Звук: Web Audio API»](/js/media-audio/).';

// ─── Раздел 4. Синтез речи ────────────────────────────────────────────────────────────────

/**
 * Тест исполняет дословно на странице с `<button>`: по клику — «сказано», вызов `say` из скрипта
 * страницы без действия пользователя — «ошибка: not-allowed». Громкость тест глушит обёрткой
 * над `speechSynthesis.speak` (код примера не меняется).
 */
export const SPEAK_CODE = `function voicesReady() {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  return new Promise((resolve) => {
    speechSynthesis.addEventListener('voiceschanged',
      () => resolve(speechSynthesis.getVoices()), { once: true });
  });
}

async function say(text) {
  const voices = await voicesReady();
  const phrase = new SpeechSynthesisUtterance(text);
  phrase.lang = 'ru-RU';
  phrase.voice = voices.find((voice) => voice.lang === 'ru-RU') ?? null;
  phrase.rate = 1.2;     // от 0.1 до 10, обычная скорость — 1
  phrase.pitch = 1;      // от 0 до 2
  phrase.onend = () => console.log('сказано');
  phrase.onerror = (event) => console.log('ошибка:', event.error);
  speechSynthesis.speak(phrase);
}

document.querySelector('button').onclick = () => say('Запись пошла');`;

export const SPEAK_OUT = 'сказано';

export const SPEAK_NOTE =
  '`SpeechSynthesisUtterance` — одна фраза с настройками: язык, голос, скорость `rate`, высота `pitch`, громкость `volume`. Значения вне диапазона браузер не отвергает, а прижимает к краю: `rate = 20` становится 10, `pitch = 5` — 2. `speechSynthesis.speak` ставит фразу в очередь и сразу возвращается. Две фразы подряд звучат по очереди: пока говорит первая, у `speechSynthesis` `speaking` и `pending` — `true`. `cancel()` очищает очередь и обрывает текущую фразу — она получает `error` с `interrupted`.';

export const VOICES_NOTE =
  'Голоса даёт операционная система, а не браузер. Сразу после загрузки `getVoices()` возвращает пустой массив во всех трёх движках, а список приходит позже событием `voiceschanged` — отсюда `voicesReady`. На одном и том же Mac Chromium показал 180 голосов, Firefox — 53, WebKit — 68. Русский в Chromium один, и даже его имя зависит от языка интерфейса: «Milena» в одной сборке, «Милена» в другой. Поэтому голос ищут по `lang`, а не по имени, и всегда держат запасной: `voice = null` — голос системы для этого языка.';

export const ACTIVATION_NOTE =
  'Chromium говорит только после действия человека на странице: клика, нажатия клавиши. `say()`, вызванная при загрузке, получает `error` с `not-allowed`, и звука нет. Firefox и WebKit в тех же условиях произнесли фразу. Код, проверенный в одном браузере, молча молчит в другом — запускать речь стоит из обработчика клика.';

// ─── Раздел 5. Распознавание ──────────────────────────────────────────────────────────────

/** Тест исполняет дословно: в Firefox — «распознавания нет», в полном Chromium — «ошибка: no-speech» и «конец». */
export const RECOGNIZE_CODE = `const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

if (!Recognition) {
  console.log('распознавания нет');
} else {
  const recognition = new Recognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;      // черновики по ходу речи, не только итог
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    console.log(last.isFinal ? 'итог:' : 'черновик:', last[0].transcript);
  };
  recognition.onerror = (event) => console.log('ошибка:', event.error);
  recognition.onend = () => console.log('конец');
  recognition.start();                    // спросит разрешение на микрофон
}`;

export const RECOGNIZE_SUPPORT: { k: string; v: string }[] = [
  { k: 'Chromium 153', v: '`SpeechRecognition` и `webkitSpeechRecognition` — один и тот же конструктор; есть `processLocally`, `available()`, `install()`' },
  { k: 'WebKit 26.6', v: 'только `webkitSpeechRecognition`, без `processLocally` и `available()`' },
  { k: 'Firefox 155', v: 'нет ни того, ни другого' },
];

export const PRIVACY_NOTE =
  'Синтез работает на вашем компьютере: все 180 голосов Chromium на стенде — `localService: true`. Распознавание в Chrome по умолчанию устроено иначе. Звук с микрофона уходит на сервер Google, и текст возвращается оттуда (так пишут MDN и документация Chrome). Для пользователя это значит: всё, что он говорит, пока идёт распознавание, слышит не только ваша страница. Без сети облачное распознавание не работает.';

export const LOCAL_CODE = `const options = { langs: ['ru-RU'], processLocally: true };

const state = await SpeechRecognition.available(options);
// 'available' — можно сразу, 'downloadable' — модель надо скачать,
// 'downloading' — уже качается, 'unavailable' — нельзя
if (state === 'downloadable') await SpeechRecognition.install(options);

const recognition = new SpeechRecognition();
recognition.lang = 'ru-RU';
recognition.processLocally = true;    // звук не уходит с компьютера`;

export const LOCAL_NOTE =
  'В Chromium 153 есть распознавание на самом устройстве. `SpeechRecognition.available` отвечает, можно ли распознавать язык без сервера. В полном Chromium на стенде для `ru-RU` ответ `downloadable` — модель есть, но её надо скачать. Без `processLocally` ответ `available`: через облако можно сразу. После `install` и `processLocally = true` звук не покидает компьютер. Это свойство есть только в Chromium: в коде для всех браузеров его проверяют, прежде чем обещать пользователю приватность.';

export const HEADLESS_NOTE =
  'Что распознавание вернёт на живой речи, в безголовом браузере не проверить: у поддельного микрофона нет речи, а у тестовой сборки — гарантии, что облачный сервис ей ответит. На поддельном микрофоне Chromium пример распознавания напечатал `ошибка: no-speech` и `конец` — ни одного `result`. Отличить «сервис не слышит речь» от «сервиса нет» по этому выводу нельзя. В headless shell Chromium вызов `SpeechRecognition.available()` и вовсе обрушил вкладку. Тест на распознавание пишут с заглушкой `SpeechRecognition`, а сам сервис проверяют руками.';

// ─── Раздел 6. Голос на сервер ────────────────────────────────────────────────────────────

/**
 * Тест исполняет дословно: `sessionId` и `recorder` задаёт обвязка, сервер — `page.route`,
 * который складывает тела по номеру из пути и склеивает их.
 */
export const UPLOAD_CODE = `let next = 0;

recorder.ondataavailable = (event) => {
  const n = next++;                               // номер — порядок склейки на сервере
  fetch(\`/voice/\${sessionId}/\${n}\`, {
    method: 'PUT',
    headers: { 'Content-Type': event.data.type },
    body: event.data,
  });
};
recorder.onstop = () => fetch(\`/voice/\${sessionId}/done?count=\${next}\`, { method: 'POST' });

recorder.start(1000);                             // кусок в секунду`;

export const UPLOAD_NOTE =
  'Отправлять запись по кускам, а не одним файлом в конце, стоит, когда запись длинная и терять её при обрыве жалко, или когда сервер должен начать работу раньше, чем человек закончит говорить. Каждый кусок уходит отдельным запросом со своим номером. Запросы могут прийти не по порядку, поэтому сервер склеивает их по номеру, а не по времени прихода. Сигнал «готово» несёт число кусков: так сервер узнаёт, что ничего не потерялось.';

export const LOSS_ROWS: { k: string; v: string }[] = [
  { k: 'все четыре куска по номеру', v: 'целый файл, 3,06 с' },
  { k: 'только первые два', v: 'уже файл, 1,98 с: начало записи можно слушать до её конца' },
  { k: 'без второго', v: 'декодируется, но короче — 2,04 с: секунда пропала молча' },
  { k: 'без первого', v: '`EncodingError`: заголовок был только в нём' },
];

export const LOSS_NOTE =
  'Отсюда два правила для сервера. Первый кусок обязателен: без него не прочитать ничего. Пропуск в середине ошибкой не выглядит — файл открывается, просто короче. Поэтому сервер сверяет полученные номера с числом из сигнала «готово». Если запись должна переживать обрыв сети, куски шлют по протоколу докачки — он разобран в [«Загрузке файлов», раздел «Докачка: протокол tus»](/platform/uploads/#s3). Для распознавания на своём сервере в реальном времени куски делают короче и шлют по одному долгому соединению, а не отдельными запросами — [«Долгие соединения», раздел «Когда нужно долгое соединение»](/platform/realtime/#s1).';

export const CLOSING =
  '**Микрофон — это поток, запись — его сжатые куски, речь — отдельный API.** Разрешение спрашивают по кнопке и на `https`. Формат выбирают `isTypeSupported` и берут тип у куска. Куски склеивают по порядку, начиная с первого. Микрофон отпускают `track.stop()`. Синтез работает локально и только после действия человека в Chromium. Распознавание в Chrome по умолчанию отправляет голос на сервер, и это нужно знать до того, как вы его включите.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`recorder.stop()` не гасит индикатор записи',
    d: 'Запись остановлена, а точка на вкладке горит: дорожка с микрофона жива. Гасит её только `track.stop()` у каждой дорожки потока. Та же утечка бывает, когда поток просят повторно на каждое нажатие «Записать» и не останавливают прошлый.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'У записи `MediaRecorder` нет длительности',
    d: '`<audio>` показывает `Infinity`, и полоса перемотки не работает. Либо считать длину самим (время между `start` и `stop`), либо поправить заголовок на сервере — например, пересобрать файл `ffmpeg`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Кусок из середины — не файл',
    d: 'Отправить на распознавание «последние две секунды» нельзя: у них нет заголовка. Нужен либо первый кусок впереди, либо сырой звук через Web Audio вместо `MediaRecorder`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Тип файла в каждом движке свой',
    d: 'Сервер, который ждёт WebM, получит из Safari MP4 с AAC, а из Firefox — Ogg. Тип берут у `event.data.type`, а не угадывают по браузеру.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Синтез в Chromium молчит без клика',
    d: '`speechSynthesis.speak` при загрузке страницы или в таймере без действия человека заканчивается `error` с `not-allowed`. Ошибку видно только тому, кто подписался на `onerror`.',
    tone: 'err',
  },
  {
    n: '06',
    t: '`getVoices()` сначала пуст',
    d: 'Первый вызов возвращает `[]` во всех трёх движках. Код, который выбирает голос сразу при загрузке, выбирает из пустого списка. Ждите `voiceschanged`, если список пуст.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'W3C — Media Capture and Streams',
    href: 'https://w3c.github.io/mediacapture-main/',
    what: '`getUserMedia`, дорожки, ограничения, ошибки и правило индикатора записи',
  },
  {
    title: 'W3C — MediaStream Recording',
    href: 'https://w3c.github.io/mediacapture-record/',
    what: '`MediaRecorder`, `timeslice`, `dataavailable`, `requestData`',
  },
  {
    title: 'W3C — Web Speech API',
    href: 'https://webaudio.github.io/web-speech-api/',
    what: '`speechSynthesis`, `SpeechRecognition`, `processLocally` и `available`',
  },
  {
    title: 'MDN — Using the Web Speech API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API',
    what: 'примеры синтеза и распознавания; о том, что Chrome распознаёт на сервере',
  },
  {
    title: 'MDN — MediaRecorder.isTypeSupported',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static',
    what: 'проверка формата перед записью',
  },
  {
    title: 'W3C — Permissions',
    href: 'https://w3c.github.io/permissions/',
    what: '`navigator.permissions.query` и состояния `granted`, `prompt`, `denied`',
  },
];

export const RELATED =
  'Смежное на сайте: [Звук: Web Audio API](/js/media-audio/) — граф узлов, анализатор уровня и сырой звук без `MediaRecorder`. [WebRTC](/platform/webrtc/) — тот же поток с микрофона, но отправленный в звонок. [Загрузка файлов, раздел «Прогресс отправки»](/platform/uploads/#s2) — почему у `fetch` нет прогресса и когда тело-стрим. [Стримы и обратное давление](/platform/streams/) — как читать и отдавать данные кусками. [Двоичные данные, раздел «Blob и File»](/js/binary-data/#s5) — что можно сделать с записью, не читая её.';
