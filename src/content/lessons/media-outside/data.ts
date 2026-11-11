import type { ConceptDiagramData } from '@/shared/ui/concept-diagram';
import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Плеер вне вкладки: Picture-in-Picture, Media Session и захват экрана».
 *
 * Тема написана 2026-11-03 вместе с соседними медиатемами: «Видео» (`/js/media-video/` —
 * `<video>`, события, кодеки, автоплей, MediaSource), «Голос: запись с микрофона и речь»
 * (`/js/media-voice/` — `getUserMedia`, `MediaRecorder`). Здесь не повторяется ни то ни другое:
 * запись захваченного экрана — ссылкой на «Голос», передача в звонок — на «WebRTC».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63 на macOS arm64: Chromium 153.0.8010.12 (headless shell — им гоняются проверки
 * курса — и полный Chromium `channel: 'chromium'`, тоже без окна), Firefox 155, WebKit 26.6.
 * Страница отдаётся `page.route` с выдуманного `https://media-outside.test` (https — значит
 * безопасный контекст). Ролик `tests/fixtures/media-outside/clip.webm` — 320×180, 4 с, VP8 + Opus,
 * 47 КБ; `tone.webm` — только звук, 2 с. Оба собраны `ffmpeg` (`testsrc2`, `sine`).
 * Пробы — `.mo-probe*.mjs` в корне проекта (удалены), повторяет их `tests/e2e/media-outside.spec.ts`.
 *
 * ⚠️ `page.evaluate` в Chromium и Firefox даёт странице временную активацию: сразу после него
 * `navigator.userActivation.isActive === true`. Поэтому «без жеста» стенд проверяет скриптом,
 * который исполняется при загрузке, а «с жестом» — настоящим `page.click`.
 *
 * Что снято пробами (и что из этого держит тест):
 *   — `PIP_CODE` дословно: окно `PictureInPictureWindow` 320×180 в headless shell, 284×160
 *     в полном Chromium на том же ролике; после выхода `width`/`height` — 0. Тест: shell;
 *   — отказы `requestPictureInPicture` (`PIP_ERRORS`) — в трёх движках, тест сверяет имена;
 *     WebKit стенда окна не открывает вообще: `NotSupportedError` и на правильном вызове;
 *   — вторая картинка в картинке закрывает первую: `leave` у первого видео, `enter` у второго;
 *     удаление видео из DOM: Chromium окно оставляет, Firefox закрывает (тест: оба);
 *   — временная активация живёт около 5 с во всех трёх (`isActive` true на 4,5 с, false на 5,5 с);
 *     `requestPictureInPicture` и `requestWindow` её тратят: второй `requestWindow` в том же
 *     обработчике — `NotAllowedError` (Chromium, Firefox). Тест: второй вызов;
 *   — `DPIP_CODE` дословно: окно — `about:blank` того же источника, без стилей; элемент уезжает
 *     из страницы; `pagehide` при `close()` приходит. Тест: Chromium shell и Firefox;
 *   — `cssRules` таблицы с чужого источника — `SecurityError` (Chromium, Firefox); подключение
 *     через `<link>` в окне Firefox работает (rgb(9, 8, 7) из чужой таблицы). В Chromium стенд
 *     загрузку `<link>` в окне не увидел: запросы окна, похоже, идут мимо `page.route` — не снято;
 *   — второй `requestWindow` закрывает первое окно: полный Chromium и Firefox (`closed === true`);
 *     headless shell первое окно оставляет открытым — особенность стенда, тест берёт Firefox;
 *   — размер окна Document PiP: Firefox 300×200 внутри при запросе 300×200, при 5000×5000 на
 *     экране 1366×768 — 1093×614; Chromium под Playwright отвечает `innerWidth` вкладки 1280×720
 *     (эмуляция окна наследуется), а `outerWidth`×`outerHeight` полного Chromium — 300×234.
 *     В тексте поэтому только «размер — пожелание», без чисел Chromium;
 *   — `documentPictureInPicture` есть в Chromium и Firefox 155, нет в WebKit; на `http:` нет
 *     нигде (как и `navigator.mediaDevices`), `mediaSession` и `requestPictureInPicture` есть
 *     и на `http:`. Тест: три движка;
 *   — Media Session (`MS_ACTIONS`, `MS_POSITION`): таблицы сверяет тест в трёх движках;
 *     недопустимое `playbackState` молча игнорируется везде; `artwork.src` разрешается
 *     в абсолютный адрес, массив заморожен;
 *   — `keyboard.press('MediaPlayPause')` доходит до страницы как `keydown`, обработчик сессии
 *     не вызывается (оба Chromium). Кнопок ОС стенд не нажимает: что их показывает и когда —
 *     не снято, и текст это говорит прямо;
 *   — захват экрана: headless shell без флагов — `NotSupportedError`; с одним
 *     `--use-fake-ui-for-media-stream` — `NotReadableError` (нет доступа к настоящему экрану);
 *     `--auto-select-desktop-capture-source=…` и `--auto-select-tab-capture-source-by-title=…`
 *     без поддельного устройства — shell `NotSupportedError`, полный Chromium ждёт ответа
 *     (выбор так и не случился за 5 с). Работает пара `--use-fake-ui-for-media-stream`
 *     + `--use-fake-device-for-media-stream`: поддельный экран 1280×720, `displaySurface`
 *     `monitor`, а с подсказкой `browser` — вкладка. `=deny` у первого флага — `NotAllowedError`.
 *     Тест: всё это, кроме полного Chromium;
 *   — `GDM_CODE` дословно (поддельный экран): `browser 1`, после `stop()` — `ended` без события;
 *     звуковая дорожка стенда — поддельный микрофон (`Fake audio`), а не звук вкладки:
 *     настоящий звук вкладки headless не проверить;
 *   — `audio: true` в Firefox и WebKit: дорожек звука 0, без ошибки (Firefox — проба с настоящим
 *     экраном машины, поэтому в тест не взята; WebKit — «Mock screen device 1», тест);
 *   — `setFocusBehavior` (`FOCUS_ROWS`): до вызова — можно; сразу после `await` — можно;
 *     через микрозадачу — `InvalidStateError`; на экране целиком — `InvalidStateError`;
 *     контроллер второй раз — `InvalidStateError`. `CaptureController` есть только в Chromium;
 *   — `min` и `exact` в `getDisplayMedia` — `TypeError` в Chromium; `min` — и в Firefox, и в WebKit;
 *     `frameRate: 5`, `640×360` — ровно столько (`resizeMode: crop-and-scale`);
 *   — без жеста: Firefox и WebKit — `InvalidStateError`, Chromium — без отказа (полный ждёт выбора);
 *     во фрейме без `allow="display-capture"` — `NotAllowedError` (тест);
 *   — что Chromium по умолчанию переключает на показанную вкладку (`PLAIN_FOCUS`) — по статье
 *     Chrome for Developers о Conditional Focus: без экрана переключение не увидеть.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: 'Picture-in-Picture',
    d: '«Картинка в картинке»: маленькое окно поверх всех программ. Человек ушёл из вкладки в почту, а видео продолжает идти в углу экрана.',
  },
  {
    k: 'временная активация',
    d: 'Короткое окно после настоящего клика или нажатия клавиши, когда страница может сделать то, что без человека запрещено: открыть окно, начать захват экрана. По-английски — transient activation.',
  },
  {
    k: 'безопасный контекст',
    d: 'Страница, открытая по `https:` или с `localhost`. Document PiP и захват экрана требуют такого контекста. Обычный удалённый http-источник не подходит, а localhost — исключение.',
  },
  {
    k: '`MediaStream`',
    d: 'Живой поток звука и видео: камера, микрофон, экран. Состоит из дорожек (`MediaStreamTrack`), у каждой свой вид — `video` или `audio`.',
  },
  {
    k: 'медиасессия',
    d: 'То, что браузер сообщает системе о звуке страницы: что играет, обложка, где сейчас позиция и какие кнопки работают.',
  },
  {
    k: 'поверхность захвата',
    d: 'Что именно показывает поток с экрана: весь монитор, окно программы или вкладку браузера. Выбирает человек, страница узнаёт ответ из `displaySurface`.',
  },
];

export const PLAIN_OUTSIDE =
  'Как у обычного музыкального плеера: окно с видео может оставаться поверх другой программы, а кнопка на наушниках управляет звуком без возврата к плееру. В браузере это разные механизмы. Picture-in-Picture отвечает за окно, Media Session — за связь с системными кнопками. Захват экрана решает другую задачу: получает выбранное человеком изображение экрана как поток.';

export const PREREQ_NOTE = 'Тема опирается на три вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Элемент `<video>`',
    d: 'Как ролик грузится и играет, что такое `readyState` и события `loadedmetadata`, `play`, `pause`, `timeupdate`.',
    href: '/js/media-video/',
    hrefLabel: '«Видео в браузере»',
    tone: 'info',
  },
  {
    t: 'Поток с устройства',
    d: '`getUserMedia` возвращает `MediaStream` с микрофона или камеры; `MediaRecorder` записывает его в файл. Захват экрана даёт поток того же вида.',
    href: '/js/media-voice/',
    hrefLabel: '«Голос: запись с микрофона и речь»',
    tone: 'info',
  },
  {
    t: 'Источник страницы',
    d: 'Источник — протокол, домен и порт. Окна, которые открывает страница, и права на захват привязаны к нему.',
    href: '/platform/security/#s1',
    hrefLabel: '«Безопасность фронтенда», раздел «Origin и правило одного источника»',
    tone: 'info',
  },
];

// ─── Раздел 1. Picture-in-Picture ──────────────────────────────────────────────────────────

/** Печатается в теме и исполняется `media-outside.spec.ts` на странице с `<video>` и `#pip`. */
export const PIP_CODE = `const video = document.querySelector('video');
const button = document.querySelector('#pip');

video.addEventListener('enterpictureinpicture', (event) => {
  const win = event.pictureInPictureWindow;
  console.log('enter', win.width, win.height);
});
video.addEventListener('leavepictureinpicture', () => {
  console.log('leave');
});

button.addEventListener('click', async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
    return;
  }
  try {
    const win = await video.requestPictureInPicture();
    console.log('окно', win.width, win.height);
    console.log(document.pictureInPictureElement === video);
  } catch (err) {
    console.log(err.name);
  }
});`;

/** Два клика по кнопке в headless shell Chromium 153. */
export const PIP_OUT = `enter 320 180
окно 320 180
true
leave`;

export const PIP_NOTE =
  'Порядок такой: сначала приходит событие `enterpictureinpicture`, потом выполняется промис. Промис возвращает объект `PictureInPictureWindow` с шириной и высотой окна в пикселях. Размер окна выбирает браузер. Chromium без окна (headless) сделал его ровно по кадру ролика, 320×180, а полный Chromium на том же ролике открыл 284×160. Потом человек может растянуть окно, и у него сработает событие `resize`. Наши проверки идут без экрана и растянуть окно не могут, поэтому это поведение мы не снимали. Когда окно закрылось, объект `PictureInPictureWindow` никуда не девается, но его `width` и `height` становятся 0.';

export const PLAIN_ACTIVATION =
  'Временная активация — как талон, который браузер выдаёт на каждый клик. Срок талона ограничен и задаётся браузером, и одно открытие окна его гасит. Без талона окно не открыть — иначе любая реклама сама вылезала бы поверх всех программ. На стенде трёх движков активация истекала между 4,5 и 5,5 секундами; полагаться на фиксированные пять секунд нельзя.';

export const PIP_RULES = [
  '**Окно одно на документ.** `requestPictureInPicture` у другого видео не открывает второе окно: первое видео получает `leavepictureinpicture`, второе — `enterpictureinpicture`.',
  '**Выйти можно, только если есть откуда.** Второй `exitPictureInPicture` подряд — `InvalidStateError`. Поэтому кнопка проверяет `document.pictureInPictureElement`, а не помнит состояние сама.',
  '**Видео удалили из DOM — движки расходятся.** Firefox окно закрывает и присылает `leavepictureinpicture`. Chromium окно оставляет, и `pictureInPictureElement` продолжает указывать на удалённый элемент. Перед удалением плеера вызывайте `exitPictureInPicture` сами.',
  '**Атрибут `disablepictureinpicture` запрещает окно для этого видео.** Он нужен там, где окно бессмысленно: фоновое видео на главной, анимация вместо картинки. Вызов `requestPictureInPicture` на таком видео — отказ.',
];

/** Сверяется тестом в трёх движках: имя ошибки — нормативное, текст — нет. */
export const PIP_ERRORS: { k: string; chromium: string; firefox: string; webkit: string }[] = [
  { k: 'без клика, при загрузке страницы', chromium: 'NotAllowedError', firefox: 'NotAllowedError', webkit: 'NotAllowedError' },
  { k: 'у видео `disablepictureinpicture`', chromium: 'InvalidStateError', firefox: 'InvalidStateError', webkit: 'NotSupportedError' },
  { k: 'метаданные ещё не загружены (`readyState` 0)', chromium: 'InvalidStateError', firefox: 'InvalidStateError', webkit: 'InvalidStateError' },
  { k: 'в файле нет видеодорожки, только звук', chromium: 'InvalidStateError', firefox: 'InvalidStateError', webkit: 'InvalidStateError' },
  { k: 'всё правильно, по клику', chromium: 'окно открыто', firefox: 'окно открыто', webkit: 'NotSupportedError' },
];

export const PIP_ERRORS_NOTE =
  'WebKit из набора Playwright окна не открывает вообще: метод есть, `document.pictureInPictureEnabled` — `true`, а правильный вызов всё равно отвечает `NotSupportedError`. Как ведёт себя настоящий Safari на экране, наши проверки без окна не показывают. Вывод для кода: `pictureInPictureEnabled` ничего не обещает, поэтому вызов всегда оборачивают в `try` и ловят отказ.';

// ─── Раздел 2. Document Picture-in-Picture ─────────────────────────────────────────────────

/** Печатается в теме и исполняется `media-outside.spec.ts`: страница с `#player` и `#float`. */
export const DPIP_CODE = `const player = document.querySelector('#player');
const home = player.parentElement;

document.querySelector('#float').addEventListener('click', async () => {
  if (!('documentPictureInPicture' in window)) return;
  let pip;
  try {
    pip = await documentPictureInPicture.requestWindow({ width: 360, height: 240 });
  } catch (error) {
    console.log(error.name);
    return;
  }

  // Окно приходит пустым: стили страницы переносим сами
  for (const sheet of document.styleSheets) {
    try {
      const style = pip.document.createElement('style');
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\\n');
      pip.document.head.append(style);
    } catch {
      // таблица с чужого источника: правил не прочитать, подключаем ссылкой
      const link = pip.document.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      pip.document.head.append(link);
    }
  }

  pip.document.body.append(player);          // элемент переезжает, а не копируется
  console.log('в окне:', player.ownerDocument === pip.document);
  console.log('на странице:', document.contains(player));

  pip.addEventListener('pagehide', () => {
    home.append(player);                      // окно закрыли — вернуть на место
    console.log('вернулся:', document.contains(player));
  });
});`;

/** Клик по `#float`, затем `documentPictureInPicture.window.close()`. Chromium shell и Firefox 155. */
export const DPIP_OUT = `в окне: true
на странице: false
вернулся: true`;

export const DPIP_NOTE =
  'Окно — настоящий `window` с пустым документом `about:blank`. Источник у него тот же, что у страницы, а `opener` указывает на страницу. Поэтому код страницы меняет DOM окна напрямую, как свой собственный. Стилей в окне нет. Если не скопировать таблицы стилей, перенесённый плеер покажется чёрным текстом на белом фоне. Сам элемент **переезжает**: после `append` его на странице больше нет. Поэтому, когда окно закрывают (событие `pagehide`), плеер возвращают на старое место. Иначе после закрытия окна он пропадёт совсем.';

export const DPIP_FACTS = [
  '**Окно одно на вкладку.** Второй `requestWindow` закрывает первое окно, и `documentPictureInPicture.window` указывает уже на новое. Так ведут себя Firefox и полный Chromium. Chromium без окна (headless) в наших проверках оставлял первое окно открытым.',
  '**Размер — пожелание.** `width` без `height` — `RangeError`, задавать оба или ни одного. Слишком большое окно браузер урежет: Firefox на просьбу 5000×5000 при экране 1366×768 открыл 1093×614.',
  '**Где есть.** Chromium и Firefox 155 — да, WebKit — нет; и только в безопасном контексте. Проверка — `\'documentPictureInPicture\' in window`, а без неё — обычная картинка в картинке у `<video>`.',
];

// ─── Раздел 3. Media Session ───────────────────────────────────────────────────────────────

/** Печатается в теме и исполняется `media-outside.spec.ts` в трёх движках на странице с `<audio>`. */
export const MS_CODE = `const audio = document.querySelector('audio');
const tracks = ['/ep-11.webm', '/ep-12.webm'];
let current = 0;

function playTrack(i) {
  current = (i + tracks.length) % tracks.length;
  audio.src = tracks[current];
  return play();
}

function play() {
  return audio.play().catch((error) => console.log('play:', error.name));
}

navigator.mediaSession.metadata = new MediaMetadata({
  title: 'Ночной эфир',
  artist: 'Радио «Курс»',
  album: 'Выпуск 12',
  artwork: [{ src: '/cover-512.png', sizes: '512x512', type: 'image/png' }],
});

const handlers = {
  play: () => play(),
  pause: () => audio.pause(),
  previoustrack: () => playTrack(current - 1),
  nexttrack: () => playTrack(current + 1),
  seekto: (details) => { audio.currentTime = details.seekTime; },
};
for (const [action, handler] of Object.entries(handlers)) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    console.log('кнопки нет:', action);  // неизвестное движку действие — TypeError
  }
}

audio.addEventListener('play', () => { navigator.mediaSession.playbackState = 'playing'; });
audio.addEventListener('pause', () => { navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('timeupdate', () => {
  // Нет конечной длительности — сбрасываем системную позицию.
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    navigator.mediaSession.setPositionState();
    return;
  }
  navigator.mediaSession.setPositionState({
    duration: audio.duration,
    position: audio.currentTime,
    playbackRate: audio.playbackRate,
  });
});

console.log(navigator.mediaSession.metadata.artwork[0].src);`;

/** Одна строка во всех трёх движках: все пять действий известны везде. */
export const MS_OUT = 'https://media-outside.test/cover-512.png';

export const MS_NOTE =
  'Метаданные — то, что система покажет в своём плеере: название, исполнитель, альбом и обложку. Относительный адрес обложки браузер сразу превращает в полный — его и печатает пример. Массив `artwork` заморожен: чтобы сменить картинку, присваивают новый `MediaMetadata` целиком. Каждый обработчик отвечает за одну кнопку в системе. Все пять действий из примера знают все три движка, поэтому `catch` ничего не печатает. Обработчик `seekto` получает объект с полем `seekTime` — это место, куда человек перетащил ползунок.';

export const PLAIN_SESSION =
  'Медиасессия — табличка на двери студии: «идёт эфир „Ночной эфир“, 12-я минута из 40». По табличке система рисует плеер в шторке, а кнопки на нём — звонки в студию: позвонили «пауза», и браузер зовёт ваш обработчик `pause`.';

/** Какие действия знает движок. Сверяется тестом: `setActionHandler` в трёх движках. */
export const MS_BASE_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad'];

export const MS_ACTIONS: { k: string; chromium: boolean; firefox: boolean; webkit: boolean; what: string }[] = [
  { k: 'togglemicrophone', chromium: true, firefox: false, webkit: true, what: 'кнопка микрофона в звонке' },
  { k: 'togglecamera', chromium: true, firefox: false, webkit: true, what: 'кнопка камеры в звонке' },
  { k: 'togglescreenshare', chromium: false, firefox: false, webkit: true, what: 'кнопка показа экрана' },
  { k: 'hangup', chromium: true, firefox: false, webkit: false, what: 'положить трубку' },
  { k: 'previousslide', chromium: true, firefox: false, webkit: false, what: 'предыдущий слайд' },
  { k: 'nextslide', chromium: true, firefox: false, webkit: false, what: 'следующий слайд' },
  { k: 'enterpictureinpicture', chromium: true, firefox: false, webkit: false, what: 'открыть картинку в картинке' },
  { k: 'voiceactivity', chromium: false, firefox: false, webkit: true, what: 'человек заговорил при выключенном микрофоне' },
];

export const MS_ACTIONS_NOTE =
  'Девять действий плеера — `play`, `pause`, `stop`, `seekbackward`, `seekforward`, `seekto`, `previoustrack`, `nexttrack`, `skipad` — знают все три движка. Остальные известны не везде. Если движок не знает действие, `setActionHandler` бросает `TypeError` — молча он его не пропускает. Поэтому каждый вызов `setActionHandler` стоит в своём `try`: иначе одна ошибка оставит без обработчиков все кнопки, которые идут после неё. Снять обработчик — передать `null`, это работает везде.';

/** Сверяется тестом в трёх движках. `ok` — вызов прошёл, иначе имя ошибки. */
export const MS_POSITION: { k: string; chromium: string; firefox: string; webkit: string }[] = [
  { k: '`{ duration: 180, position: 30, playbackRate: 1 }`', chromium: 'ok', firefox: 'ok', webkit: 'ok' },
  { k: '`setPositionState()` — без аргумента', chromium: 'ok', firefox: 'ok', webkit: 'ok' },
  { k: '`{}` — пустой объект', chromium: 'ok', firefox: 'ok', webkit: 'TypeError' },
  { k: '`{ position: 10 }` — без длительности', chromium: 'TypeError', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`{ duration: NaN }` — метаданных ещё нет', chromium: 'TypeError', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`{ duration: Infinity, position: 5 }` — прямой эфир', chromium: 'ok', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`{ duration: 10, position: 20 }` — позиция за концом', chromium: 'TypeError', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`{ duration: -1 }` и `position: -1`', chromium: 'TypeError', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`playbackRate: 0`', chromium: 'TypeError', firefox: 'TypeError', webkit: 'TypeError' },
  { k: '`playbackRate: -1` — назад', chromium: 'ok', firefox: 'ok', webkit: 'ok' },
];

export const MS_POSITION_NOTE =
  '`setPositionState` строго проверяет данные: если они не подходят, метод бросает `TypeError` и ничего не исправляет за вас. Две строки таблицы касаются почти любого плеера. Первая: пока не пришло событие `loadedmetadata`, `audio.duration` равно `NaN`, и вызов из раннего обработчика падает. Вторая: У прямого эфира `duration` — `Infinity`: Chromium его принимает, Firefox и WebKit — нет. Вызов без аргумента сбрасывает позицию везде. А `playbackState` с неверной строкой не бросает нигде: присваивание молча не действует, и состояние остаётся прежним.';

export const MS_LIMITS =
  '**Автотест не может нажать системную кнопку плеера.** `page.keyboard.press(\'MediaPlayPause\')` в Playwright доходит до страницы обычным `keydown`, а обработчик сессии не вызывается: медиаклавиши перехватывает система, до страницы они так не доходят. Когда система показывает плеер в шторке, решает браузер — обычно когда вкладка играет звук. Без экрана это тоже не проверить. Остаётся проверять обработчики руками на телефоне или вызывать те же функции из теста напрямую.';

// ─── Раздел 4. Захват экрана ───────────────────────────────────────────────────────────────

/** Печатается в теме и исполняется `media-outside.spec.ts` в Chromium с поддельным экраном. */
export const GDM_CODE = `const preview = document.querySelector('video');
const share = document.querySelector('#share');
let stream = null;
let requesting = false;
let generation = 0;

function finish() {
  generation++;                         // поздний ответ закрытого запроса не применяем
  if (!stream) return;
  const current = stream;
  stream = null;
  for (const track of current.getTracks()) track.stop();
  preview.srcObject = null;
}

share.addEventListener('click', async () => {
  if (stream || requesting) return;       // не оставлять прежний захват работающим
  requesting = true;
  const request = generation;
  const controller = 'CaptureController' in window ? new CaptureController() : undefined;
  try {
    const next = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: 5 },
      audio: true,
      controller,
    });
    if (request !== generation) {
      for (const track of next.getTracks()) track.stop();
      return;
    }
    stream = next;
    const [track] = stream.getVideoTracks();
    const { displaySurface } = track.getSettings();
    if (displaySurface === 'browser' || displaySurface === 'window') {
      controller?.setFocusBehavior('no-focus-change');  // без await перед этой строкой
    }
    console.log(displaySurface, stream.getAudioTracks().length);
    preview.srcObject = stream;
    track.addEventListener('ended', () => {
      finish();                         // в том числе останавливает оставшееся аудио
      console.log('показ остановил браузер');
    }, { once: true });
  } catch (error) {
    finish();
    console.log(error.name);
  } finally {
    requesting = false;
  }
});

document.querySelector('#stop').addEventListener('click', () => {
  if (!stream) { finish(); return; }     // в том числе отменяем применение позднего ответа
  const [track] = stream.getVideoTracks();
  finish();
  console.log('остановили сами:', track.readyState);
});`;

/** Клик по `#share`, затем по `#stop`. Chromium shell с поддельным экраном. */
export const GDM_OUT = `browser 1
остановили сами: ended`;

export const GDM_NOTE =
  'Что показать, выбирает человек в окне браузера: весь экран, окно программы или вкладку. `displaySurface: \'browser\'` в запросе — только подсказка: с какой вкладки открыть это окно выбора. Что выбрали на самом деле, говорит `getSettings().displaySurface`: `monitor`, `window` или `browser`. Размер и частота кадров — тоже пожелания. На просьбу 640×360 и 5 кадров в секунду Chromium отдал ровно столько и для этого уменьшил картинку. А `min` и `exact`, знакомые по `getUserMedia`, здесь запрещены: с ними вызов бросает `TypeError`.';

export const GDM_AUDIO =
  '**Звук — только в Chromium и только если человек согласился.** Firefox и WebKit на `audio: true` не бросают, а просто возвращают поток без звуковой дорожки. Поэтому после ответа проверяют, сколько в потоке звуковых дорожек, как в примере. Единица в выводе примера — поддельный микрофон Chromium (`Fake audio`), а не звук вкладки: настоящий звук вкладки в Chromium без экрана не проверить.';

export const PLAIN_FOCUS =
  'Человек выбрал показать вкладку со слайдами — и Chromium сам переключает на неё: слайды выходят вперёд, а ваша страница с заметками докладчика прячется. `setFocusBehavior(\'no-focus-change\')` говорит «останься здесь». Решение принимается один раз, в момент ответа, — как поворот на развилке: сказать «налево» можно до развилки или на ней, но не через квартал.';

/** Сверяется тестом в Chromium с поддельным экраном. */
export const FOCUS_ROWS: { k: string; v: string; tone: 'ok' | 'err' }[] = [
  { k: 'до `getDisplayMedia`, сразу после `new CaptureController()`', v: 'можно', tone: 'ok' },
  { k: 'сразу после `await`, синхронно', v: 'можно, если выбрана вкладка или окно', tone: 'ok' },
  { k: 'сразу после `await`, но выбран весь экран', v: '`InvalidStateError`: фокусу некуда переходить', tone: 'err' },
  { k: 'через микрозадачу или `setTimeout`', v: '`InvalidStateError`: решение уже принято', tone: 'err' },
  { k: 'тот же контроллер во втором `getDisplayMedia`', v: '`InvalidStateError`: контроллер одноразовый', tone: 'err' },
];

export const FOCUS_NOTE =
  '`CaptureController` есть только в Chromium. Поэтому в примере он создаётся под проверкой, а вызов идёт через `?.`. Решение о фокусе принимается в момент ответа, поэтому между `await getDisplayMedia(…)` и `setFocusBehavior` не должно быть ни одного `await`.';

export const STOP_NOTE =
  '**Показ останавливают двумя способами, и событие `ended` приходит только в одном.** Первый способ: человек жмёт кнопку браузера «Прекратить показ». Дорожка заканчивается и присылает `ended` (это поведение описано по спецификации: без экрана нажать кнопку браузера нельзя). Второй способ: ваш код вызывает `track.stop()`. Дорожка тоже переходит в `ended`, но события **нет**: пример печатает «остановили сами: ended», а «показ остановил браузер» не печатает. Поэтому индикатор «идёт показ» убирают в обоих местах — и в обработчике `ended`, и рядом с `stop()`.';

/** Сверяется тестом: Chromium с поддельным экраном, WebKit и Firefox без жеста. */
export const GDM_ERRORS: { k: string; v: string }[] = [
  { k: 'человек отказался или закрыл окно выбора', v: '`NotAllowedError`' },
  { k: 'вызов во фрейме без `allow="display-capture"`', v: '`NotAllowedError`: запрещено политикой прав' },
  { k: 'без клика', v: 'Firefox и WebKit — `InvalidStateError`; Chromium не отказывает и ждёт выбора человека' },
  { k: '`video: false`', v: 'Firefox и WebKit — `TypeError`, Chromium в наших проверках — `NotFoundError`: без видео захват не работает' },
  { k: '`min` или `exact` в ограничениях', v: '`TypeError`' },
  { k: 'обычный удалённый `http:`-источник', v: '`navigator.mediaDevices` — `undefined`, вызывать нечего' },
];

export const HEADLESS_NOTE =
  '**Как проверить захват в автотесте.** Chromium без окна сам по себе отвечает `NotSupportedError`, а с одним флагом `--use-fake-ui-for-media-stream` — `NotReadableError`: окно выбора он пропускает, но настоящего экрана не получает. Работает пара `--use-fake-ui-for-media-stream` и `--use-fake-device-for-media-stream`: поддельный экран 1280×720, поверхность `monitor`, а с подсказкой `browser` — вкладка. С `--use-fake-ui-for-media-stream=deny` тот же вызов даёт `NotAllowedError` — так проверяют ветку отказа. Флаги `--auto-select-desktop-capture-source` и `--auto-select-tab-capture-source-by-title` без поддельного устройства в наших проверках не сработали.';

export const GDM_NEXT =
  'Поток с экрана — обычный `MediaStream`. Записать его в файл — тем же `MediaRecorder`, что и голос: [«Голос: запись с микрофона и речь»](/js/media-voice/). Отправить собеседнику — дорожкой в `RTCPeerConnection`: [«WebRTC», раздел «Каналы данных и медиа»](/platform/webrtc/#s6).';

export const CLOSING =
  'Отдельное окно и системные кнопки не превращают страницу в постоянно активное приложение. Фоновое выполнение, таймеры и показ кадров зависят от состояния вкладки и политики браузера. Условия замедления, заморозки и возврата разобраны в [«Планировании задач», раздел «Фоновая вкладка, заморозка и bfcache»](/js/task-scheduling/#s4).';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`await fetch` перед открытием окна съедает клик',
    code: "button.onclick = async () => {\n  const info = await fetch('/api/track').then((r) => r.json());\n  await video.requestPictureInPicture();   // NotAllowedError, если ответ шёл дольше ~5 с\n};",
    d: 'Временная активация живёт около пяти секунд после клика во всех трёх движках. Если перед вызовом стоит медленный запрос, окно не откроется — и сломается это только у людей с плохой сетью, так что на своей машине ошибку не заметить. Правильный порядок: сначала открыть окно, потом грузить данные.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`page.evaluate` в Playwright — это жест',
    d: 'Сразу после `evaluate` у страницы `navigator.userActivation.isActive === true` — в Chromium и Firefox. Тест «без клика окно не открывается», написанный через `evaluate`, увидит открытое окно. Проверять отказ надо кодом, который исполняется при загрузке страницы, а не из `evaluate`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`track.stop()` не присылает `ended`',
    d: 'Событие приходит, когда дорожку закончил браузер или источник, а не ваш код. Уборка, повешенная только на `ended`, после своей же кнопки «Стоп» не выполнится.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Лишний `await` перед `setFocusBehavior`',
    d: 'Решение о фокусе принимается в момент ответа `getDisplayMedia`. Если между ответом и вызовом стоит обёртка с таймаутом, `Promise.race` или любой другой `await`, вызов бросает `InvalidStateError`: к этому моменту браузер уже решил сам.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Таблица стилей с CDN не копируется в окно Document PiP',
    d: '`cssRules` у таблицы с чужого источника — `SecurityError`. Цикл, который копирует правила без `try`, падает на первой такой таблице, и окно остаётся без стилей. Такую таблицу подключают в окне ссылкой `<link>`, как в примере.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Неизвестное действие медиасессии — `TypeError`',
    d: 'Браузер не пропускает его молча и не пишет предупреждение — он бросает исключение. Список действий в движках разный: `hangup` знает только Chromium, `togglescreenshare` — только WebKit. Один общий `try` вокруг всех `setActionHandler` оставит без кнопок всё, что идёт после первого отказа.',
    tone: 'err',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'W3C — Picture-in-Picture',
    href: 'https://w3c.github.io/picture-in-picture/',
    what: '`requestPictureInPicture`, `PictureInPictureWindow`, когда бросается `InvalidStateError` и `NotAllowedError`',
  },
  {
    title: 'WICG — Document Picture-in-Picture',
    href: 'https://wicg.github.io/document-picture-in-picture/',
    what: '`requestWindow`, одно окно на вкладку, трата активации',
  },
  {
    title: 'W3C — Media Session',
    href: 'https://w3c.github.io/mediasession/',
    what: 'метаданные, список действий, проверки `setPositionState`',
  },
  {
    title: 'W3C — Screen Capture',
    href: 'https://w3c.github.io/mediacapture-screen-share/',
    what: '`getDisplayMedia`, `displaySurface`, запрет `min` и `exact`, `CaptureController`',
  },
  {
    title: 'HTML Standard — User activation',
    href: 'https://html.spec.whatwg.org/multipage/interaction.html#tracking-user-activation',
    what: 'временная активация: что её даёт и что тратит',
  },
  {
    title: 'Chrome for Developers — Picture-in-Picture for any element',
    href: 'https://developer.chrome.com/docs/web-platform/document-picture-in-picture',
    what: 'перенос стилей и элементов в окно Document PiP',
  },
  {
    title: 'Chrome for Developers — Better screen sharing with Conditional Focus',
    href: 'https://developer.chrome.com/docs/web-platform/conditional-focus',
    what: 'зачем `setFocusBehavior` и почему его окно такое короткое',
  },
];

export const RELATED =
  'Смежное на сайте: [Видео в браузере](/js/media-video/) — `<video>`, события, кодеки и автоплей. [Голос: запись с микрофона и речь](/js/media-voice/) — `getUserMedia` и `MediaRecorder`, которым записывают и захват экрана. [WebRTC, раздел «Каналы данных и медиа»](/platform/webrtc/#s6) — как поток с экрана уходит собеседнику. [Планирование задач, раздел «Фоновая вкладка, заморозка и bfcache»](/js/task-scheduling/#s4) — что происходит со страницей, пока играет окно поверх. [Безопасность фронтенда, раздел «Origin и правило одного источника»](/platform/security/#s1) — безопасный контекст, без которого нет ни Document PiP, ни захвата.';

export const PIP_MARKUP = `<video src="/clip.webm" muted controls width="320" height="180"></video>
<button id="pip">Открыть или закрыть PiP</button>`;
export const DPIP_MARKUP = `<div id="home"><div id="player">Плеер с кнопками</div></div>
<button id="float">Открыть отдельное окно</button>`;
export const MS_MARKUP = `<audio src="/tone.webm" controls></audio>`;
export const GDM_MARKUP = `<video autoplay muted></video>
<button id="share">Показать экран</button>
<button id="stop">Остановить показ</button>`;

export const CAPTURE_STOP_DIAGRAM: ConceptDiagramData = {
  id: 'media-outside-stop-and-ended',
  title: 'Два способа закончить показ, одна очистка ресурсов',
  description: 'Браузер завершает дорожку и присылает ended. Прямой вызов track.stop тоже меняет readyState на ended, но сам это событие не отправляет. Поэтому очистка вызывается из обеих ветвей.',
  width: 920, height: 560,
  nodes: [
    { id: 'browser', x: 20, y: 32, width: 230, height: 160, label: 'Человек завершил показ', detail: 'Например, кнопкой браузера.', tone: 'neutral' },
    { id: 'event', x: 330, y: 32, width: 230, height: 160, label: 'Дорожка присылает `ended`', detail: 'Обработчик вызывает `finish()`.', tone: 'info' },
    { id: 'button', x: 20, y: 368, width: 230, height: 160, label: 'Кнопка страницы', detail: 'Код сам вызывает `finish()`.', tone: 'neutral' },
    { id: 'stop', x: 330, y: 368, width: 230, height: 160, label: '`track.stop()`', detail: '`readyState = ended`, но события `ended` нет.', tone: 'warn' },
    { id: 'cleanup', x: 650, y: 192, width: 250, height: 192, label: 'Завершить всю сессию', detail: 'Остановить оставшиеся дорожки, снять `srcObject`, очистить ссылку на поток.', tone: 'ok' },
  ],
  edges: [
    { from: 'browser', to: 'event' },
    { from: 'event', to: 'cleanup', via: [[605, 112], [605, 288]] },
    { from: 'button', to: 'stop' },
    { from: 'stop', to: 'cleanup', via: [[605, 448], [605, 288]] },
  ],
  note: 'Очистка безопасна при повторном вызове. Если поток ещё запрашивается, поздний ответ не подключается к превью, а его дорожки останавливаются.',
};
