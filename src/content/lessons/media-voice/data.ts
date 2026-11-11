import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';
import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';

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
 *     стенд не проверяет** — речи у поддельного микрофона нет, а работоспособность облачного сервиса
 *     такой пробой не подтверждается. Отправка звука на сервер — по документации (MDN, Chrome);
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
    d: '`MediaStreamTrack` — один источник внутри потока: один микрофон или одна камера. Полученные дорожки нужно остановить явно, когда этот захват больше не нужен. Остановка записи MediaRecorder их не завершает.',
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
    d: 'Контекст, который браузер считает безопасным: например, HTTPS или локальный адрес разработки. Проверка — isSecureContext; доступ к mediaDevices требует такого контекста.',
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
export const RECORD_CODE = `async function recordClip(ms = 2000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let recorder, timer;
  const chunks = [];
  try {
    recorder = new MediaRecorder(stream);
    await new Promise((resolve, reject) => {
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = (event) => reject(event.error ?? new Error('Запись прервана'));
      recorder.onstop = resolve; // последний dataavailable приходит перед stop
      recorder.start(500);
      timer = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, ms);
    });
    return { blob: new Blob(chunks, { type: chunks[0]?.type ?? recorder.mimeType }), parts: chunks.length };
  } finally {
    clearTimeout(timer);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
  }
}

const { blob, parts } = await recordClip();
console.log('кусков:', parts);
console.log('тип:', blob.type);
console.log('байт:', blob.size);
const audio = document.querySelector('audio');
const recordingUrl = URL.createObjectURL(blob);
audio.src = recordingUrl;
function releaseRecording() { // вызвать при замене записи или закрытии интерфейса
  audio.removeAttribute('src');
  audio.load();
  URL.revokeObjectURL(recordingUrl);
}`;

export const RECORD_OUT = `кусков: 4
тип: audio/webm;codecs=opus
байт: 24157`;

export const RECORD_NOTE =
  'getUserMedia возвращает живой поток. MediaRecorder отдаёт сжатые куски через dataavailable; timeslice = 500 задаёт ориентир для их выдачи, а не точные интервалы. При stop приходит последний кусок, затем событие stop. Только после него пример собирает Blob. finally отпускает все полученные дорожки и при успехе, и при ошибке. Вывод — записанный результат Chromium 153 с поддельным микрофоном; размер файла зависит от сигнала и настроек.';

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
  'Каждый движок пишет в свой формат, если не попросить другой: Chromium — WebM, Firefox — Ogg, WebKit — MP4 с AAC. Общий для всех трёх — только `audio/webm;codecs=opus`. В проверенных версиях все три движка отвергли WAV и MP3. Поддержку в другом окружении проверяют заново. Поэтому тип выбирают явно, перебором `MediaRecorder.isTypeSupported(тип)`, и передают в `new MediaRecorder(stream, { mimeType })`. А на сервер отправляют тип из `event.data.type`: свойство `recorder.mimeType` в Chromium пусто сразу после `start()`, а в Firefox оставалось пустым до конца записи.';

export const HEADER_NOTE =
  'Отдельные куски MediaRecorder не обязаны быть воспроизводимыми файлами. В опыте с WebM заголовок оказался в первом: он начинается байтами 1a 45 df a3. Второй кусок отдельно не декодировался, а полная склейка открылась. У этой записи Chromium audio.duration сначала был Infinity и уточнился после чтения до конца. Это наблюдение конкретного формата и движка, а не обещание, что у любой записи отсутствует длительность.';

// ─── Раздел 2. Разрешение ─────────────────────────────────────────────────────────────────

/** Тест исполняет дословно с правом на микрофон и без него. */
export const PERMISSION_CODE = `try {
  const status = await navigator.permissions.query({ name: 'microphone' });
  console.log('разрешение:', status.state);
} catch {
  console.log('проверка разрешения недоступна'); // query не обязана знать это имя
}

try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  try {
    console.log('микрофон:', stream.getAudioTracks()[0].label);
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
} catch (error) {
  console.log('ошибка:', error.name);
}`;

export const PERMISSION_OUT_GRANTED = `разрешение: granted
микрофон: Fake Default Audio Input`;

export const PERMISSION_OUT_DENIED = `разрешение: prompt
ошибка: NotAllowedError`;

export const PERMISSION_NOTE =
  'permissions.query только читает доступное браузеру состояние и может не поддерживать имя microphone. Эта проверка не заменяет getUserMedia. granted обычно означает, что согласие уже сохранено; prompt допускает запрос к человеку; denied может означать отказ пользователя или ограничение политики. Окончательный результат даёт getUserMedia. Человек может оставить вопрос без ответа, и тогда промис остаётся ожидающим. Запускайте захват по понятной кнопке «Записать», чтобы запрос разрешения был связан с действием пользователя.';

export const ERROR_ROWS: { k: string; when: string }[] = [
  { k: '`NotAllowedError`', when: 'человек отказал; или микрофон запрещён странице заголовком `Permissions-Policy: microphone=()`, или чужому `<iframe>` не дали `allow="microphone"`' },
  { k: '`NotFoundError`', when: 'устройства нужного вида нет ни одного' },
  { k: '`OverconstrainedError`', when: 'условие с `exact` невыполнимо, например `deviceId: { exact: \'…\' }` неизвестного микрофона; в `error.constraint` — какое именно' },
  { k: '`TypeError`', when: 'не попросили ни звука, ни видео: `getUserMedia({})`' },
  { k: 'нет `navigator.mediaDevices`', when: 'страница не в безопасном контексте, например обычный HTTP-источник вне локальной разработки: вызов падает с `TypeError` ещё до запроса' },
];

export const DEVICES_NOTE =
  'До разрешения страница знает о микрофонах немного: `enumerateDevices()` возвращает устройства с пустым `label`. Названия устройств становятся доступны с учётом разрешений и активного захвата. Так браузер не даёт сайту без спроса собрать приметы, по которым ваш компьютер можно узнать и на других сайтах.';

export const STOP_CODE = `const [track] = stream.getAudioTracks();
track.stop();

console.log(track.readyState);     // 'ended'
console.log(stream.active);        // false
// recorder.state стал 'inactive', и пришло событие stop — запись кончилась сама`;

export const STOP_NOTE =
  'recorder.stop завершает запись, сохраняя дорожки живыми. Для окончания этого захвата останавливают все полученные дорожки. Если завершились все дорожки, которые записывал MediaRecorder, он сам выдаёт последний dataavailable и stop. Другая дорожка или другая страница могут продолжать использовать устройство; аппаратный индикатор в headless-стенде не проверялся.';

/** Два независимых ресурса из RECORD_CODE и STOP_CODE; не измерение аппаратного индикатора. */
export const RECORD_LIFETIME_DIAGRAM: ConceptDiagramData = {
  id: 'voice-recorder-versus-track',
  title: 'Остановить запись и отпустить микрофон — разные действия',
  description: 'Поток получает MediaRecorder, но дорожка живёт отдельно от него. Здесь показан случай, когда вызывают только recorder.stop().',
  width: 900, height: 520,
  nodes: [
    { id: 'stream', x: 20, y: 175, width: 220, height: 170, label: 'getUserMedia', detail: 'Поток с живой аудиодорожкой.', tone: 'info' },
    { id: 'recorder', x: 340, y: 30, width: 220, height: 170, label: 'MediaRecorder', detail: 'Записывает данные этой дорожки.', tone: 'info' },
    { id: 'blob', x: 660, y: 30, width: 220, height: 170, label: 'Запись завершена', detail: 'Последний dataavailable, затем stop. Можно собрать Blob.', tone: 'ok' },
    { id: 'live', x: 340, y: 320, width: 220, height: 170, label: 'Дорожка ещё live', detail: 'Остановка recorder не останавливает дорожку.', tone: 'warn' },
    { id: 'ended', x: 660, y: 320, width: 220, height: 170, label: 'Дорожка ended', detail: 'Этот захват больше не использует устройство.', tone: 'ok' },
  ],
  edges: [
    { from: 'stream', to: 'recorder', via: [[290, 260], [290, 115]], label: 'поток', labelX: 290, labelY: 95 },
    { from: 'stream', to: 'live', via: [[290, 260], [290, 405]], label: 'track', labelX: 290, labelY: 385 },
    { from: 'recorder', to: 'blob', label: 'stop()', labelX: 610, labelY: 95 },
    { from: 'live', to: 'ended', label: 'stop()', labelX: 610, labelY: 385 },
  ],
  note: 'Это схема владения ресурсами, а не новый замер. Для завершения захвата вызывают stop у всех полученных дорожек. Если устройство использует другая дорожка или другая страница, оно может остаться занятым. recordClip делает очистку в finally, поэтому в основном примере дорожки освобождаются и после ошибки.',
};

// ─── Раздел 3. Обработка ───────────────────────────────────────────────────────────────────

/** Тест исполняет дословно; вывод сверяется с `PROCESSING_OUT`. */
export const PROCESSING_CODE = `const stream = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
try {
  const [track] = stream.getAudioTracks();
  const { echoCancellation, noiseSuppression, autoGainControl, sampleRate } = track.getSettings();
  console.log(echoCancellation, noiseSuppression, autoGainControl, sampleRate);
  console.log(track.getCapabilities().noiseSuppression);
} finally {
  stream.getTracks().forEach((track) => track.stop());
}`;

export const PROCESSING_OUT = `false false false 44100
[true, false]`;

export const PLAIN_PROCESSING =
  'Обработка микрофона — как фильтры камеры телефона, только для звука. Эхоподавление вычитает из микрофона то, что играют ваши же динамики, — иначе собеседник слышит себя. Шумоподавление глушит вентилятор и клавиатуру. Автоусиление тянет тихий голос и прижимает громкий. Для разговора это полезно, а запись гитары портит: шумоподавление считает струны шумом.';

export const PROCESSING_ROWS: { k: string; on: string; off: string }[] = [
  { k: '`echoCancellation`', on: '`true`', off: '`false`' },
  { k: '`noiseSuppression`', on: '`true`', off: '`false`' },
  { k: '`autoGainControl`', on: '`true`', off: '`false`' },
  { k: '`sampleRate`', on: '48 000', off: '44 100' },
  { k: '`channelCount`', on: '1; два канала не выбрать', off: 'можно попросить 2' },
];

export const PROCESSING_NOTE =
  'В записанном опыте Chromium с поддельным микрофоном при audio: true были включены все три вида обработки. Это не гарантированные настройки любого браузера или устройства. Для голосовой заметки это подходит, для музыки и для распознавания на своём сервере — не всегда. Что включено на деле, говорит `getSettings()`, а не то, что вы просили: просьба без `exact` — пожелание, браузер вправе её не выполнить. `getCapabilities()` перечисляет, что дорожка вообще умеет. На поддельном микрофоне Chromium выключение обработки сменило и частоту: 44 100 Гц вместо 48 000, и стало можно попросить два канала.';

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
export const SPEAK_CODE = `function voicesReady(ms = 1500) {
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const finish = (list) => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', changed);
      resolve(list);
    };
    const changed = () => {
      const list = speechSynthesis.getVoices();
      if (list.length > 0) finish(list);
    };
    const timer = setTimeout(() => finish(speechSynthesis.getVoices()), ms);
    speechSynthesis.addEventListener('voiceschanged', changed);
    changed();
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
  '`SpeechSynthesisUtterance` — одна фраза с настройками: язык, голос, скорость `rate`, высота `pitch`, громкость `volume`. В пробе Chromium 153 значения вне диапазона прижимались к краю: `rate = 20` становится 10, `pitch = 5` — 2. `speechSynthesis.speak` ставит фразу в очередь и сразу возвращается. Две фразы подряд звучат по очереди: пока говорит первая, у `speechSynthesis` `speaking` и `pending` — `true`. `cancel()` очищает очередь и обрывает текущую фразу — она получает `error` с `interrupted`.';

export const VOICES_NOTE =
  'Список голосов зависит от системы и реализации браузера. localService у выбранного голоса отличает локальный синтез от удалённого. В записанном опыте сразу после загрузки getVoices возвращал пустой массив во всех трёх движках, а список приходит позже событием `voiceschanged` — отсюда `voicesReady`. Русский в Chromium один, и даже его имя зависит от языка интерфейса: «Milena» в одной сборке, «Милена» в другой. Поэтому голос ищут по `lang`, а не по имени, и всегда держат запасной: `voice = null` — выбор голоса движком с учётом phrase.lang; подходящий голос может отсутствовать.';

export const ACTIVATION_NOTE =
  'Chromium говорит только после действия человека на странице: клика, нажатия клавиши. `say()`, вызванная при загрузке, получает `error` с `not-allowed`, и звука нет. Firefox и WebKit в тех же условиях произнесли фразу. Код, проверенный в Firefox или WebKit, в Chromium просто промолчит, поэтому речь запускают из обработчика клика.';

// ─── Раздел 5. Распознавание ──────────────────────────────────────────────────────────────

/** Тест исполняет дословно: в Firefox — «распознавания нет», в полном Chromium — «ошибка: no-speech» и «конец». */
export const RECOGNIZE_CODE = `const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
const button = document.querySelector('button');

if (!Recognition) {
  console.log('распознавания нет');
  button.disabled = true;
} else {
  const recognition = new Recognition();
  recognition.lang = 'ru-RU';
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    // Измениться может несколько результатов, а не только последний
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      console.log(result.isFinal ? 'итог:' : 'черновик:', result[0].transcript);
    }
  };
  recognition.onerror = (event) => console.log('ошибка:', event.error);
  recognition.onend = () => { button.disabled = false; console.log('конец'); };
  button.onclick = () => {
    button.disabled = true;
    try { recognition.start(); }
    catch (error) { button.disabled = false; console.log('ошибка:', error.name); }
  };
}`;

export const RECOGNIZE_SUPPORT: { k: string; v: string }[] = [
  { k: 'Chromium 153', v: '`SpeechRecognition` и `webkitSpeechRecognition` — один и тот же конструктор; есть `processLocally`, `available()`, `install()`' },
  { k: 'WebKit 26.6', v: 'только `webkitSpeechRecognition`, без `processLocally` и `available()`' },
  { k: 'Firefox 155', v: 'нет ни того, ни другого' },
];

export const PRIVACY_NOTE =
  'Web Speech API допускает локальные и удалённые сервисы. В опыте все голоса синтеза имели localService: true, но это не свойство любого браузера. Распознавание без требования processLocally: true тоже может отправлять аудио сервису. Если для функции важно выполнение на устройстве, проверяйте поддержку локального режима и готовность языкового пакета; не подменяйте его сетевым режимом незаметно.';

export const LOCAL_CODE = `async function localRecognition(lang = 'ru-RU') {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition || !('processLocally' in Recognition.prototype)
      || typeof Recognition.available !== 'function' || typeof Recognition.install !== 'function') {
    throw new Error('Локальное распознавание не поддерживается');
  }
  const options = { langs: [lang], processLocally: true };
  let state = await Recognition.available(options);
  if (state === 'downloadable') {
    if (!await Recognition.install(options)) throw new Error('Языковой пакет не установлен');
    state = await Recognition.available(options);
  }
  if (state !== 'available') throw new Error('Языковой пакет не готов: ' + state);
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.processLocally = true;
  return recognition; // start вызывается отдельно из пользовательского действия
}`;

export const LOCAL_NOTE =
  'В Chromium 153 есть распознавание на самом устройстве. `SpeechRecognition.available` отвечает, можно ли распознавать язык без сервера. В полном Chromium на стенде для `ru-RU` ответ `downloadable` — модель есть, но её надо скачать. Ответ available с processLocally: false означает наличие подходящего сервиса, а не гарантирует доступ к облаку или успешный результат. После успешной установки нужно снова проверить готовность и задать processLocally = true до start. Ошибки установки и ограничения Permissions-Policy тоже нужно обработать. Это свойство есть только в Chromium: в коде для всех браузеров его проверяют, прежде чем обещать пользователю приватность.';

export const HEADLESS_NOTE =
  'Что распознавание вернёт на живой речи, в безголовом браузере не проверить: у поддельного микрофона нет речи, а у тестовой сборки — гарантии, что облачный сервис ей ответит. На поддельном микрофоне Chromium пример распознавания напечатал `ошибка: no-speech` и `конец` — ни одного `result`. Отличить «сервис не слышит речь» от «сервиса нет» по этому выводу нельзя. В headless shell Chromium вызов `SpeechRecognition.available()` и вовсе обрушил вкладку. Обработчики result и end проверяются на заглушке SpeechRecognition; работоспособность и точность реального сервиса требуют отдельных проб с речью.';

// ─── Раздел 6. Голос на сервер ────────────────────────────────────────────────────────────

/**
 * Тест исполняет дословно: `sessionId` и `recorder` задаёт обвязка, сервер — `page.route`,
 * который складывает тела по номеру из пути и склеивает их.
 */
export const UPLOAD_CODE = `function uploadRecording(recorder, sessionId) {
  const base = '/voice/' + encodeURIComponent(sessionId);
  let next = 0, chain = Promise.resolve(), finished = false;
  const { promise, resolve, reject } = Promise.withResolvers();
  const cleanup = () => {
    recorder.removeEventListener('dataavailable', onData);
    recorder.removeEventListener('stop', onStop);
    recorder.removeEventListener('error', onError);
  };
  const fail = (error) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (recorder.state !== 'inactive') recorder.stop();
    reject(error);
  };
  const send = async (url, options) => {
    if (finished) return; // после ошибки не начинать оставшиеся запросы очереди
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('HTTP ' + response.status);
  };
  const onData = ({ data }) => {
    if (data.size === 0) return;
    const n = next++;
    chain = chain.then(() => send(base + '/' + n, {
      method: 'PUT', headers: { 'Content-Type': data.type }, body: data,
    }));
    chain.catch(fail);
  };
  const onStop = () => {
    chain.then(() => send(base + '/done?count=' + next, { method: 'POST' }))
      .then(() => { if (!finished) { finished = true; cleanup(); resolve(next); } }, fail);
  };
  const onError = (event) => fail(event.error ?? new Error('Запись прервана'));
  recorder.addEventListener('dataavailable', onData);
  recorder.addEventListener('stop', onStop);
  recorder.addEventListener('error', onError);
  try { recorder.start(1000); } catch (error) { fail(error); }
  return promise;
}`;

/** Владелец потока обеспечивает очистку и после отказа отправки. */
export const UPLOAD_USE_CODE = `async function recordAndUpload(stopButton, sessionId) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  let stop;
  try {
    const recorder = new MediaRecorder(stream);
    const uploaded = uploadRecording(recorder, sessionId);
    stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    stopButton.addEventListener('click', stop);
    await uploaded; // успех — только после ответа сервера на done
  } finally {
    if (stop) stopButton.removeEventListener('click', stop);
    stream.getTracks().forEach((track) => track.stop());
  }
}`;

export const UPLOAD_NOTE =
  'Отправлять запись по кускам, а не одним файлом в конце, стоит, когда запись длинная и терять её при обрыве жалко, или когда сервер должен начать работу раньше, чем человек закончит говорить. Каждый кусок уходит отдельным запросом со своим номером. Запросы могут прийти не по порядку, поэтому сервер склеивает их по номеру, а не по времени прихода. Уведомление done отправляется только после подтверждения всех PUT. Число кусков позволяет серверу проверить полноту, но сервер всё равно обязан сверить номера. Ошибка HTTP отклоняет промис и останавливает запись. Захват микрофона остаётся ответственностью владельца stream: его дорожки нужно остановить в finally.';

export const LOSS_ROWS: { k: string; v: string }[] = [
  { k: 'все четыре куска по номеру', v: 'целый файл, 3,06 с' },
  { k: 'только первые два', v: 'уже файл, 1,98 с: начало записи можно слушать до её конца' },
  { k: 'без второго', v: 'декодируется, но короче — 2,04 с: секунда пропала молча' },
  { k: 'без первого', v: '`EncodingError`: заголовок был только в нём' },
];

export const LOSS_NOTE =
  'Отсюда два правила для сервера. В опыте с WebM первый кусок был обязателен: без его заголовка декодирование не удалось. Искусственно удалённый средний кусок в этом опыте не вызвал ошибки декодера: запись открылась, но стала короче. Поэтому сервер сверяет полученные номера с числом из сигнала «готово». Если запись должна переживать обрыв сети, куски шлют по протоколу докачки — он разобран в [«Загрузке файлов», раздел «Докачка: протокол tus»](/platform/uploads/#s3). Для распознавания на своём сервере в реальном времени куски делают короче и шлют по одному долгому соединению, а не отдельными запросами — [«Долгие соединения», раздел «Когда нужно долгое соединение»](/platform/realtime/#s1).';

export const CLOSING =
  '**Микрофон — это поток, запись — его сжатые куски, речь — отдельный API.** Разрешение спрашивают по кнопке и на `https`. Формат выбирают `isTypeSupported` и берут тип у куска. Куски склеивают по порядку, начиная с первого. Микрофон отпускают `track.stop()`. У синтеза проверяют localService выбранного голоса; в Chromium запуск связывают с действием человека. Распознавание без требования локального режима может обращаться к сетевому сервису; режим нужно выбрать до запуска.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`recorder.stop()` не гасит индикатор записи',
    d: 'Запись остановлена, а точка на вкладке горит: дорожка с микрофона жива. Для завершения этого захвата вызывают track.stop() у всех полученных дорожек; другое окно или другой захват могут продолжать использовать то же устройство. Та же утечка бывает, когда поток просят повторно на каждое нажатие «Записать» и не останавливают прошлый.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Длительность записи может быть неизвестна',
    d: 'У проверенной WebM-записи Chromium audio.duration сначала был Infinity, поэтому обычная полоса перемотки не знала конца записи. Либо считать длину самим (время между `start` и `stop`), либо поправить заголовок на сервере — например, пересобрать файл `ffmpeg`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Кусок не обязан быть самостоятельным файлом',
    d: 'Нельзя полагаться, что произвольный фрагмент MediaRecorder декодируется отдельно: ему может не хватить заголовка контейнера. Нужен либо первый кусок впереди, либо сырой звук через Web Audio вместо `MediaRecorder`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Формат по умолчанию зависит от движка',
    d: 'При выборе формата по умолчанию сервер на стенде получил WebM из Chromium, MP4/AAC из WebKit и Ogg из Firefox. Тип берут у `event.data.type`, а не угадывают по браузеру.',
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
    d: 'Первый вызов может вернуть пустой массив, как на стенде во всех трёх движках. Код, который выбирает голос сразу при загрузке, выбирает из пустого списка. Ждите `voiceschanged`, если список пуст.',
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
    what: '`speechSynthesis`, localService голоса, `SpeechRecognition`, `processLocally` и `available`',
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
