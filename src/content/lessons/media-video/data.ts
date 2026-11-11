import type { GlossaryTerm, Pitfall, Prereq, Source } from '@/entities/lesson';

/**
 * Данные темы «Видео в браузере».
 *
 * Тема написана 2026-11-03 в серии медиатем. Соседние темы не повторяются: камера,
 * `getUserMedia` и `RTCPeerConnection` — дом в WebRTC, рисование и запачканный холст —
 * в Canvas, `ArrayBuffer` — в «Двоичных данных».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63: Chromium 153.0.8010.12 (headless shell и полный, `channel: 'chromium'`),
 * Firefox 155.0, WebKit 26.6; macOS на Apple M1. Ролики генерирует `ffmpeg`
 * (`tests/fixtures/media-video/gen.sh`): 160×90 и 320×180, 10 кадров в секунду, ключевой
 * кадр каждую секунду, вместе около 200 КБ. Пробы — `scratchpad/mv/` и скрипты `.mv-*.mjs`.
 *
 * Каждый пример с выводом исполняет `tests/e2e/media-video.spec.ts`: страница — ровно строка
 * отсюда, ролики отдаёт `page.route` с выдуманного источника. Вывод сверяется с `*_OUT`
 * дословно в Chromium; в Firefox и WebKit — там, где ответ совпадает (см. ниже).
 *
 * Что снято пробами и закреплено тестом:
 *   — порядок событий первого ролика одинаков в трёх движках: `loadstart`, `durationchange`,
 *     `loadedmetadata`, `loadeddata`, `canplay`, `canplaythrough`, `play`, `playing`, `pause`,
 *     `ended` (WebKit вставляет лишние `durationchange`, но не в этом примере). `pause`
 *     приходит **раньше** `ended`;
 *   — `play()` до старта и сразу `pause()` — `AbortError` во всех трёх; 404 на файл —
 *     `NotSupportedError` и `error.code === 4` (не 2: «сетевой» код 404 не даёт);
 *   — автоплей: `play()` со звуком без жеста — `NotAllowedError` в Chromium и Firefox,
 *     без звука — играет; клик разрешает звук. Ролик без звуковой дорожки, но без `muted`: Chromium —
 *     `NotAllowedError`, Firefox — играет. `navigator.getAutoplayPolicy` есть только в Firefox
 *     (`'allowed-muted'` до жеста). `page.evaluate` в Playwright идёт с жестом пользователя;
 *   — ⚠️ WebKit: пример `AUTOPLAY_CODE` отклонил звук 16 раз из 16, но на странице с тремя
 *     роликами сборка Playwright дважды из трёх пустила звук без жеста. Поэтому WebKit
 *     в проверку автоплея не входит, а Safari на iPhone стенд не заменяет;
 *   — ответы `canPlayType`, `isTypeSupported` и `decodingInfo` — `CODEC_SNAPSHOT` по движкам.
 *     «Chromium» в таблице — полный Chromium: headless shell отвечает на HEVC пустой строкой
 *     и `powerEfficient: false` на всё (декодирует программно);
 *   — MSE: init без кадров даёт пустой буфер, каждый кусок добавляет секунду; второй
 *     `appendBuffer`, пока идёт первый, — `InvalidStateError` во всех трёх; смена качества
 *     с новым init даёт `resize` на 2.0 с;
 *   — `waiting`: после конца буфера `readyState` 2 во всех трёх. На перемотке без данных
 *     Chromium и Firefox показывают `readyState` 1, WebKit — 3 и `waiting` не шлёт;
 *   — HLS по ссылке на плейлист играют Chromium 153 и WebKit; Firefox — `error.code` 4;
 *   — `requestVideoFrameCallback`: 20 вызовов на 20 кадров (Firefox — 21–22, первый кадр дважды),
 *     `requestAnimationFrame` за то же время — около 120;
 *   — кадр ролика с чужого источника без `crossorigin` пачкает холст: `getImageData` —
 *     `SecurityError` во всех трёх; с `crossorigin` и заголовком CORS — читается.
 *     ⚠️ Случай «атрибут есть, заголовка нет» стенд не проверяет: `route.fulfill` в Playwright
 *     сам добавляет CORS-заголовок, и ролик грузится;
 *   — `preload="none"`: только `loadstart` и `suspend`; `preload="metadata"` на файле 25 КБ
 *     Chromium и Firefox всё равно довели до `readyState` 4, WebKit остановился на 1.
 *
 *   — ключевой кадр у `ffmpeg` без настроек (testsrc2, 30 к/с, 20 с): libx264 — 0, 8.33, 16.67 с
 *     (250 кадров), libvpx-vp9 — каждые 4.27 с (128 кадров);
 *   — `preload`, `<source>` по типу, `autoplay` без `muted`, `paused`
 *     во время `waiting`, `ended` без `endOfStream` — отдельные проверки в том же спеке.
 *
 * Снято и в тему не вошло: снять `muted` без жеста — Chromium поставил ролик на паузу, когда
 * звук включали сразу после `await play()`, и не поставил, когда по таймеру через 100 мс;
 * прокрутка колесом в Chromium из Playwright разрешила `play()` со звуком. Оба случая
 * зависят от того, как именно пришёл ввод, и проверке не поддаются.
 *
 * Не проверено и сказано в тексте прямо: поведение на iPhone (`playsinline`, автоплей
 * Safari) — стенда с iOS нет; выбор качества в hls.js и dash.js — по их документации.
 * Чередование `waiting`/`playing` в Chromium после долива (пять пар за 300 мс) видно
 * в двух прогонах из двух, но число не постоянно и в тест не идёт.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY: GlossaryTerm[] = [
  {
    k: '`HTMLMediaElement`',
    d: 'Общий интерфейс `<video>` и `<audio>`: методы `play()` и `pause()`, свойства `currentTime`, `duration`, `muted`, `readyState`, события загрузки и показа. Всё из этой темы, кроме размера кадра, работает и для звука.',
  },
  {
    k: 'контейнер',
    d: 'Формат файла: mp4, webm. Внутри — дорожки (картинка, звук, субтитры), время каждого кадра и оглавление, по которому ищут нужную секунду.',
  },
  {
    k: 'кодек',
    d: 'Способ сжатия картинки или звука внутри контейнера: H.264, HEVC, VP9, AV1. Разжимает **декодер** — программа или отдельный блок в чипе.',
  },
  {
    k: 'ключевой кадр',
    d: 'Кадр, который разжимается сам по себе. Остальные кадры хранят только отличия от соседних, поэтому показ с любой секунды начинается с ближайшего ключевого кадра перед ней.',
  },
  {
    k: 'буфер',
    d: 'Уже полученные секунды ролика, которые можно показать без сети. Их список лежит в `video.buffered`.',
  },
  {
    k: '`TimeRanges`',
    d: 'Список отрезков времени в секундах: `length` — сколько отрезков, `start(i)` и `end(i)` — границы i-го. Такой тип у `buffered`, `played` и `seekable`.',
  },
  {
    k: 'жест пользователя',
    d: 'Клик, нажатие клавиши, касание экрана. Браузер помнит, был ли он на странице, и некоторые действия разрешает только после него.',
  },
  {
    k: 'HLS и DASH',
    d: 'Два способа раздавать видео кусками по несколько секунд. К кускам прилагается плейлист — список адресов, часто в нескольких качествах.',
  },
];

export const PLAIN_VIDEO =
  '`<video>` похож на кинопроектор с механиком. Плёнку привозят частями, механик заправляет её и крутит. Кнопка «пуск» — это просьба механику, а не рычаг: если плёнки ещё нет, он ждёт; если зал не разрешал звук, он откажет. О том, что происходит в будке, механик сообщает записками — событиями. Из зала видно только их.';

export const PREREQ_NOTE = 'Тема опирается на три вещи из соседних тем.';

export const PREREQ: Prereq[] = [
  {
    t: 'Промис и await',
    d: 'Промис либо выполнится, либо отклонится с ошибкой. `await` ждёт результата, `try`/`catch` ловит отказ. Отказ без обработчика попадает в консоль красной ошибкой.',
    href: '/js/promise-internals/#s5',
    hrefLabel: '«Промис изнутри», раздел «Необработанный отказ»',
    tone: 'info',
  },
  {
    t: 'События DOM',
    d: '`addEventListener(name, fn)` вызывает `fn` при каждом событии. Третий аргумент `{ once: true }` снимает слушателя после первого вызова.',
    href: '/render/dom-events/#s1',
    hrefLabel: '«События DOM», раздел «Путь и три фазы»',
    tone: 'info',
  },
  {
    t: 'Байты в буфере',
    d: '`fetch(url)` и `.arrayBuffer()` дают сырые байты файла — `ArrayBuffer`. Их можно передать дальше, не разбирая.',
    href: '/js/binary-data/#s1',
    hrefLabel: '«Двоичные данные», раздел «Буфер и вид»',
    tone: 'info',
  },
];

// ─── Раздел 1. Первый ролик ────────────────────────────────────────────────────────────────

/** Страница целиком: тест отдаёт её как есть, `clip.mp4` — 2 с, 160×90, H.264 + AAC. */
export const FIRST_CODE = `<video src="clip.mp4" muted></video>
<script>
  const video = document.querySelector('video');
  const names = ['loadstart', 'durationchange', 'loadedmetadata', 'loadeddata',
    'canplay', 'canplaythrough', 'play', 'playing', 'pause', 'ended'];
  for (const name of names) {
    video.addEventListener(name, () => console.log(name, video.currentTime.toFixed(1)));
  }
  video.addEventListener('loadedmetadata', () => {
    console.log('  длина', video.duration, 'с, кадр', \`\${video.videoWidth}×\${video.videoHeight}\`);
  });
  video.addEventListener('canplay', async () => {
    await video.play();                 // промис выполнится, когда пойдут кадры
    console.log('  play() выполнен');
  }, { once: true });
</script>`;

export const FIRST_OUT = `loadstart 0.0
durationchange 0.0
loadedmetadata 0.0
  длина 2 с, кадр 160×90
loadeddata 0.0
canplay 0.0
canplaythrough 0.0
play 0.0
playing 0.0
  play() выполнен
pause 2.0
ended 2.0`;

export const FIRST_NOTE =
  'Сначала браузер узнаёт, **что** за ролик: длину и размер кадра (`loadedmetadata`). Потом получает первый кадр (`loadeddata`), потом решает, что данных хватит начать (`canplay`) и досмотреть без остановок (`canplaythrough`). `play` значит «попросили играть», `playing` — «кадры действительно пошли». Промис из `play()` выполняется вместе с `playing`, а не в момент вызова. В конце ролик сам встаёт на паузу: `pause` приходит раньше `ended`. Порядок одинаков в Chromium, Firefox и WebKit.';

export const ELEMENT_ROWS: { k: string; v: string }[] = [
  { k: '`video.play()`', v: 'просит играть; возвращает промис' },
  { k: '`video.pause()`', v: 'ставит на паузу сразу; ничего не возвращает' },
  { k: '`video.currentTime`', v: 'где сейчас, в секундах; запись — перемотка' },
  { k: '`video.duration`', v: 'длина; `NaN`, пока нет `loadedmetadata`' },
  { k: '`video.paused`, `video.ended`', v: 'стоит ли ролик и дошёл ли до конца' },
  { k: '`video.muted`, `video.volume`', v: 'звук выключен; громкость от 0 до 1' },
  { k: '`preload="none"` / `"metadata"` / `"auto"`', v: 'подсказка, сколько грузить заранее' },
];

export const PRELOAD_NOTE =
  '`preload` — подсказка, а не приказ. С `none` браузеры не грузили ничего, кроме `loadstart`, до самого `play()`. С `metadata` файл в 25 КБ Chromium и Firefox всё равно скачали целиком и дошли до `canplaythrough`, а WebKit остановился на `loadedmetadata`.';

export const PLAY_ERRORS_CODE = `<script>
  const early = document.createElement('video');
  early.muted = true;
  early.src = 'clip.mp4';
  early.play().catch((e) => console.log('передумали:', e.name));
  early.pause();                      // остановили раньше, чем ролик пошёл

  const broken = document.createElement('video');
  broken.muted = true;
  broken.src = 'missing.mp4';         // сервер ответит 404
  broken.play().catch((e) => console.log('нет файла:', e.name, 'error.code =', broken.error.code));
</script>`;

export const PLAY_ERRORS_OUT = `передумали: AbortError
нет файла: NotSupportedError error.code = 4`;

export const PLAY_REJECT_ROWS: { k: string; v: string; tone: 'warn' | 'err' }[] = [
  { k: '`NotAllowedError`', v: 'браузер не разрешил играть: обычно звук без жеста пользователя — раздел [«Автоплей»](#s3)', tone: 'warn' },
  { k: '`AbortError`', v: 'ролик остановили или сменили `src` раньше, чем он пошёл. Частый случай — `pause()` сразу после `play()`', tone: 'warn' },
  { k: '`NotSupportedError`', v: 'файл не открылся: формат не поддержан, файл битый **или сервер ответил 404**', tone: 'err' },
];

export const PLAY_ERRORS_NOTE =
  'Отказ `play()` — обычный отклонённый промис. Без `catch` он попадает в консоль как необработанный: так было во всех трёх движках. Причину ошибки загрузки пишет `video.error.code`, и тут легко ошибиться. На 404 приходит код **4** — «источник не поддержан», а не 2 — «ошибка сети». По стандарту, пока браузер не узнал, что за ролик перед ним, любая неудача даёт код 4: и обрыв сети, и 404, и незнакомый формат.';

// ─── Раздел 2. Контейнер и кодек ───────────────────────────────────────────────────────────

export const PLAIN_CODEC =
  'Контейнер — конверт, кодек — язык письма. На конверте написано, сколько в нём листов и в каком порядке их читать. А прочесть сами листы можно, только если знаешь язык. Поэтому «умею mp4» ничего не обещает: в одном конверте mp4 может лежать письмо на H.264, которое понимают все, а в другом — на HEVC, который понимают не все.';

export const CODEC_TYPES = [
  'video/mp4',
  'video/mp4; codecs="avc1.42C01E"',
  'video/mp4; codecs="hvc1.1.6.L93.B0"',
  'video/webm; codecs="vp9"',
  'video/webm; codecs="vp09.00.10.08"',
  'video/mp4; codecs="av01.0.04M.08"',
  'application/vnd.apple.mpegurl',
];

export const CODEC_CODE = `const types = [
${CODEC_TYPES.map((t) => `  '${t}',`).join('\n')}
];
const video = document.createElement('video');
for (const type of types) {
  const play = video.canPlayType(type);              // 'probably', 'maybe' или ''
  const mse = MediaSource.isTypeSupported(type);     // true или false
  let info;
  try {
    const r = await navigator.mediaCapabilities.decodingInfo({
      type: 'media-source',
      video: { contentType: type, width: 1920, height: 1080, bitrate: 4_000_000, framerate: 30 },
    });
    info = \`supported=\${r.supported} powerEfficient=\${r.powerEfficient}\`;
  } catch (e) {
    info = e.name;
  }
  console.log(type, '|', JSON.stringify(play), mse, info);
}`;

type Engine = 'chromium' | 'firefox' | 'webkit';

/**
 * Вывод `CODEC_CODE`, снятый в трёх движках (Chromium — полный, `channel: 'chromium'`).
 * Тест исполняет `CODEC_CODE` и сверяет построчно. Таблицы ниже вычисляются отсюда.
 */
export const CODEC_SNAPSHOT: Record<Engine, string[]> = {
  chromium: [
    'video/mp4 | "maybe" false supported=false powerEfficient=false',
    'video/mp4; codecs="avc1.42C01E" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="hvc1.1.6.L93.B0" | "probably" true supported=true powerEfficient=true',
    'video/webm; codecs="vp9" | "probably" true supported=false powerEfficient=false',
    'video/webm; codecs="vp09.00.10.08" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="av01.0.04M.08" | "probably" true supported=true powerEfficient=false',
    'application/vnd.apple.mpegurl | "maybe" false supported=false powerEfficient=false',
  ],
  firefox: [
    'video/mp4 | "maybe" true TypeError',
    'video/mp4; codecs="avc1.42C01E" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="hvc1.1.6.L93.B0" | "probably" true supported=true powerEfficient=true',
    'video/webm; codecs="vp9" | "probably" true supported=true powerEfficient=true',
    'video/webm; codecs="vp09.00.10.08" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="av01.0.04M.08" | "probably" true supported=true powerEfficient=false',
    'application/vnd.apple.mpegurl | "" false TypeError',
  ],
  webkit: [
    'video/mp4 | "maybe" true TypeError',
    'video/mp4; codecs="avc1.42C01E" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="hvc1.1.6.L93.B0" | "probably" true supported=true powerEfficient=true',
    'video/webm; codecs="vp9" | "probably" true supported=false powerEfficient=false',
    'video/webm; codecs="vp09.00.10.08" | "probably" true supported=true powerEfficient=true',
    'video/mp4; codecs="av01.0.04M.08" | "" false supported=false powerEfficient=false',
    'application/vnd.apple.mpegurl | "maybe" false supported=false powerEfficient=false',
  ],
};

const CODEC_LABELS: Record<string, string> = {
  'video/mp4': 'mp4 без кодека',
  'video/mp4; codecs="avc1.42C01E"': 'H.264 · `avc1.42C01E`',
  'video/mp4; codecs="hvc1.1.6.L93.B0"': 'HEVC · `hvc1.1.6.L93.B0`',
  'video/webm; codecs="vp9"': 'VP9 · `vp9`',
  'video/webm; codecs="vp09.00.10.08"': 'VP9 · `vp09.00.10.08`',
  'video/mp4; codecs="av01.0.04M.08"': 'AV1 · `av01.0.04M.08`',
  'application/vnd.apple.mpegurl': 'плейлист HLS',
};

const ENGINES: Engine[] = ['chromium', 'firefox', 'webkit'];

function parse(line: string) {
  const [, rest] = line.split(' | ');
  const [play, mse, ...info] = rest.split(' ');
  const joined = info.join(' ');
  const decode =
    joined === 'TypeError' ? '`TypeError`'
    : joined.startsWith('supported=false') ? 'нет'
    : joined.endsWith('powerEfficient=true') ? 'да, экономно'
    : 'да, не экономно';
  return { play: play === '""' ? '`""`' : `\`${play.replaceAll('"', '')}\``, mse: mse === 'true' ? 'да' : 'нет', decode };
}

/** Строка, затем три движка: «canPlayType · MSE». */
export const CODEC_ROWS: string[][] = CODEC_TYPES.map((type, i) => [
  CODEC_LABELS[type],
  ...ENGINES.map((e) => {
    const p = parse(CODEC_SNAPSHOT[e][i]);
    return `${p.play} · MSE ${p.mse}`;
  }),
]);

/** Строка, затем три движка: ответ `decodingInfo` для 1080p30. */
export const DECODE_ROWS: string[][] = CODEC_TYPES.map((type, i) => [
  CODEC_LABELS[type],
  ...ENGINES.map((e) => parse(CODEC_SNAPSHOT[e][i]).decode),
]);

export const CODEC_NOTE =
  '`canPlayType` отвечает тремя строками, и ни одна не значит «да». `"probably"` — «узнаю и контейнер, и кодек». `"maybe"` — «контейнер знаю, а что внутри — не сказано»: так все три движка ответили на `video/mp4` без кодека. Пустая строка — «точно нет». `MediaSource.isTypeSupported` строже: это вопрос «приму ли такие куски в MediaSource», и Chromium без кодека отвечает `false`, а Firefox и WebKit — `true`.';

export const DECODE_NOTE =
  '`navigator.mediaCapabilities.decodingInfo` спрашивает не «знаю ли формат», а «потяну ли **этот** ролик»: размер, частоту кадров и поток. В ответе три поля: `supported` — сможет ли, `smooth` — без пропуска кадров, `powerEfficient` — экономно ли для батареи. Экономно обычно значит «есть аппаратный декодер в чипе». У M1 он есть для H.264, HEVC и VP9 и нет для AV1 — это видно в ответах Chromium и Firefox. Headless-сборка Chromium, у которой декодер только программный, ответила `powerEfficient: false` на всё, а HEVC не узнала вовсе.';

export const CODEC_STRING_NOTE =
  'С короткой строкой `codecs="vp9"` легко ошибиться. `canPlayType` во всех трёх движках говорит `"probably"`, а `decodingInfo` в Chromium и WebKit — «не поддержано»: в Chromium в консоли при этом предупреждение «Invalid (ambiguous) video codec string». Полная строка `vp09.00.10.08` называет профиль, уровень и глубину цвета, и с ней ответы совпадают. У H.264 полная строка — три байта из заголовка файла: `42C01E` значит профиль Baseline и уровень 3.0.';

export const PICK_STEPS = [
  'Сделайте два-три варианта ролика: AV1 или VP9 для тех, кто умеет, и H.264 для всех остальных.',
  'Спросите `decodingInfo` о каждом, с размером и потоком настоящего файла.',
  'Берите первый, у которого `supported` и `powerEfficient` — `true`. Если такого нет — первый просто `supported`.',
  'Без JS то же решает `<source>`: браузер берёт первый `<source type="…">`, тип которого узнал.',
];

// ─── Раздел 3. Автоплей ────────────────────────────────────────────────────────────────────

export const AUTOPLAY_CODE = `<video src="clip.mp4" loop></video>
<button>Включить звук</button>
<script>
  const video = document.querySelector('video');
  video.addEventListener('canplay', async () => {
    try {
      await video.play();               // со звуком, жеста ещё не было
    } catch (e) {
      console.log('со звуком:', e.name);
      video.muted = true;
      await video.play();
      console.log('без звука: играет');
    }
  }, { once: true });

  document.querySelector('button').addEventListener('click', () => {
    video.muted = false;                // внутри обработчика клика — можно
    console.log('звук включён, paused =', video.paused);
  });
</script>`;

/** Две строки — сразу после загрузки, третья — после клика по кнопке. */
export const AUTOPLAY_OUT = `со звуком: NotAllowedError
без звука: играет
звук включён, paused = false`;

export const AUTOPLAY_NOTE =
  'Пока пользователь ничего не нажал, ролик со звуком не запустится: `play()` отклоняется с `NotAllowedError`, а `paused` остаётся `true`. Без звука — пожалуйста. После клика звук включается, и ролик продолжает играть. Атрибут `autoplay` подчиняется тем же правилам: без `muted` ролик молча не стартует, ошибки не будет вовсе, а с `muted` — играет.';

export const PLAIN_AUTOPLAY =
  'Браузер защищает пользователя от сайта, который заорал, едва открылся. Правило простое: шуметь можно, только когда человек сам что-то сделал на странице. Клик или нажатие клавиши — разрешение. Беззвучное видео никого не пугает, поэтому ему можно всегда.';

export const AUTOPLAY_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Нет звуковой дорожки — ещё не `muted`',
    d: 'Ролик, в котором звука нет вовсе, но без `muted`: Chromium отклоняет `play()` так же, как со звуком, а Firefox пускает. Надёжно — ставить `muted` явно.',
    tone: 'warn',
  },
  {
    t: '`playsinline` — для iPhone',
    d: 'Без этого атрибута Safari на iPhone разворачивает ролик на весь экран при запуске, а беззвучный автоплей там работает только вместе с ним. Сами мы на iPhone это не проверяли — так пишет команда WebKit (ссылка в источниках). Фоновое видео поэтому пишут так: `<video autoplay muted loop playsinline>`.',
  },
  {
    t: 'Спросить заранее можно только в Firefox',
    d: '`navigator.getAutoplayPolicy("mediaelement")` до первого клика отвечает `"allowed-muted"`. В Chromium 153 и WebKit 26.6 такого метода нет — там остаётся пробовать `play()` и ловить отказ.',
  },
  {
    t: 'В тестах Playwright автоплей «работает»',
    d: '`page.evaluate` выполняет код как будто после жеста: `navigator.userActivation.hasBeenActive` после него — `true`. Проверку автоплея там надо писать скриптом самой страницы, иначе тест пройдёт, а пользователь увидит отказ.',
    tone: 'err',
  },
];

// ─── Раздел 4. MediaSource ─────────────────────────────────────────────────────────────────

export const MSE_WHY =
  'С `src="clip.mp4"` браузер сам решает, что и когда скачать. Для длинного ролика этого мало. Плееру нужно менять качество на ходу, когда сеть просела, и не тянуть заранее лишнего. А ещё — вставить рекламу или собрать картинку и звук из разных файлов. Для этого есть **MediaSource Extensions** (MSE): ролик раздают кусками по несколько секунд, а код плеера сам скачивает каждый кусок и отдаёт браузеру.';

export const PLAIN_FRAGMENTS =
  'Обычный mp4 — книга с одним оглавлением на всю книгу: пока его нет, читать нельзя. Фрагментированный mp4 — сериал. Первым идёт короткое описание: какой кодек, какой размер кадра. Это init-сегмент, кадров в нём нет. Дальше серии, и у каждой своё маленькое оглавление: какие в ней кадры и с какой секунды. Серии можно смотреть по порядку, пропускать и брать из разных «озвучек» — лишь бы описание подходило.';

export const MASTER_M3U8 = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=60000,RESOLUTION=160x90,CODECS="avc1.42C01E"
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=160000,RESOLUTION=320x180,CODECS="avc1.42C01E"
high/index.m3u8
`;

export const MEDIA_M3U8 = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:1
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXT-X-MAP:URI="init.mp4"
#EXTINF:1.000000,
0.m4s
#EXTINF:1.000000,
1.m4s
#EXTINF:1.000000,
2.m4s
#EXTINF:1.000000,
3.m4s
#EXT-X-ENDLIST
`;

export const HLS_NOTE =
  'Это HLS. Первый плейлист перечисляет качества, второй — куски одного качества: `#EXT-X-MAP` указывает на init-сегмент, `#EXTINF` — длительность следующего куска. Файлы нарезал `ffmpeg` с ключами `-f hls -hls_segment_type fmp4`; init весит 827 байт, кусок — 6–7 КБ. По ссылке на первый плейлист `<video src="hls/index.m3u8">` играют Chromium 153 и WebKit. Firefox отвечает `error.code` 4, и там HLS разбирают библиотекой вроде hls.js. Она делает то же, что код в подразделе «Куски в буфер»: скачивает куски и подаёт их в MediaSource.';

export const MSE_SETUP_CODE = `<video></video>
<script type="module">
  const video = document.querySelector('video');
  const source = new MediaSource();
  video.src = URL.createObjectURL(source);    // адрес blob: вместо файла
  await new Promise((open) => source.addEventListener('sourceopen', open, { once: true }));

  const buffer = source.addSourceBuffer('video/mp4; codecs="avc1.42C01E"');
  source.duration = 4;                        // длину плеер знает из плейлиста

  async function append(url) {
    const bytes = await (await fetch(url)).arrayBuffer();
    buffer.appendBuffer(bytes);               // отдать кусок браузеру
    await new Promise((done) => buffer.addEventListener('updateend', done, { once: true }));
  }
  const ranges = () => Array.from({ length: video.buffered.length }, (_, i) =>
    \`\${video.buffered.start(i).toFixed(1)}–\${video.buffered.end(i).toFixed(1)}\`).join(', ') || 'пусто';`;

export const MSE_FEED_CODE = `  video.addEventListener('resize', () => console.log(
    'кадр', \`\${video.videoWidth}×\${video.videoHeight}\`, 'на', video.currentTime.toFixed(1), 'с'));
  video.addEventListener('ended', () => console.log('конец'));

  await append('hls/low/init.mp4');           // кодек и размер кадра, картинки нет
  console.log('init.mp4 → буфер', ranges());
  for (const [quality, n] of [['low', 0], ['low', 1], ['high', 2], ['high', 3]]) {
    if (n === 2) await append('hls/high/init.mp4');   // сменили качество: сначала его init
    await append(\`hls/\${quality}/\${n}.m4s\`);
    console.log(\`\${quality}/\${n}.m4s → буфер\`, ranges());
  }
  source.endOfStream();                       // кусков больше не будет
  video.muted = true;
  await video.play();
</script>`;

/** Вывод Chromium. Firefox и WebKit печатают первый `resize` в другом месте — тест сверяет у них остальные строки. */
export const MSE_OUT = `init.mp4 → буфер пусто
кадр 160×90 на 0.0 с
low/0.m4s → буфер 0.0–1.0
low/1.m4s → буфер 0.0–2.0
high/2.m4s → буфер 0.0–3.0
high/3.m4s → буфер 0.0–4.0
кадр 320×180 на 2.0 с
конец`;

export const MSE_STEPS = [
  '`new MediaSource()` и `URL.createObjectURL` дают ролику адрес `blob:`. Файла за ним нет — его наполнит ваш код.',
  'По `sourceopen` заводят `SourceBuffer` под точный тип с кодеком — тот, что принял `isTypeSupported`.',
  'Первым в буфер идёт init-сегмент. Буфер после него пуст, но браузер уже знает размер кадра.',
  'Дальше куски по порядку. `appendBuffer` возвращается сразу, а работа заканчивается событием `updateend`. Второй `appendBuffer`, пока не пришёл `updateend`, бросает `InvalidStateError` — во всех трёх движках.',
  '`endOfStream()` говорит «больше не будет». Без него браузер не знает, что ролик кончился: на конце буфера придёт `waiting`, а `ended` не придёт никогда.',
];

export const ADAPT_NOTE =
  'На второй секунде ролик сменил качество: размер кадра вырос с 160×90 до 320×180, и пришло событие `resize`. Для этого хватило подать init-сегмент другого качества перед его кусками — у них другой размер кадра, и браузеру надо об этом сказать. Кодек тот же, поэтому `SourceBuffer` прежний. Для смены кодека есть `buffer.changeType(тип)`. Решать, **какое** качество брать следующим, должен сам плеер. Библиотеки вроде hls.js смотрят, как быстро скачался прошлый кусок и сколько секунд осталось в буфере.';

export const MMS_NOTE =
  'В WebKit есть ещё `ManagedMediaSource` — вариант MSE, где браузер сам выкидывает лишний буфер и сам подсказывает, когда грузить дальше. В Chromium 153 и Firefox 155 его нет.';

// ─── Раздел 5. Буфер и readyState ──────────────────────────────────────────────────────────

export const READY_ROWS: { k: string; v: string }[] = [
  { k: '0 `HAVE_NOTHING`', v: 'ничего не известно' },
  { k: '1 `HAVE_METADATA`', v: 'известны длина и размер кадра, картинки нет — `loadedmetadata`' },
  { k: '2 `HAVE_CURRENT_DATA`', v: 'есть кадр на текущую секунду, но не дальше — `loadeddata`' },
  { k: '3 `HAVE_FUTURE_DATA`', v: 'есть кадры немного вперёд, можно начать — `canplay`' },
  { k: '4 `HAVE_ENOUGH_DATA`', v: 'по оценке браузера хватит до конца без остановок — `canplaythrough`' },
];

export const NETWORK_ROWS: { k: string; v: string }[] = [
  { k: '0 `NETWORK_EMPTY`', v: 'источника ещё нет' },
  { k: '1 `NETWORK_IDLE`', v: 'источник выбран, но сейчас не качается: всё уже здесь или браузер решил подождать' },
  { k: '2 `NETWORK_LOADING`', v: 'качает' },
  { k: '3 `NETWORK_NO_SOURCE`', v: 'подходящего источника нет — так выглядел ролик после 404' },
];

export const READY_NOTE =
  '`readyState` отвечает на вопрос «сколько у меня есть», `networkState` — «что я сейчас делаю». Они независимы. Целиком скачанный файл — это `readyState` 4 и `networkState` 1: качать больше нечего. Каждый переход `readyState` вверх приходит своим событием из раздела [«Первый ролик»](#s1). Вниз событие одно — `waiting`.';

/** Исполняется после `MSE_SETUP_CODE` той же страницей. */
export const STALL_CODE = `  const once = (name) => new Promise((done) => video.addEventListener(name, done, { once: true }));
  const state = (what) => console.log(what, 't =', video.currentTime.toFixed(1),
    'readyState =', video.readyState, 'буфер', ranges());

  await append('hls/low/init.mp4');
  await append('hls/low/0.m4s');              // только первая секунда
  video.muted = true;
  video.play();
  await once('playing');
  await once('waiting');  state('ждёт');      // кадры кончились раньше данных

  const playing = once('playing');
  await append('hls/low/1.m4s');              // вторая секунда пришла
  await playing;          state('играет');

  video.currentTime = 3.2;                    // туда, где буфера нет
  await once('seeking');  state('перематывает');
  const seeked = once('seeked');
  await append('hls/low/3.m4s');
  await seeked;           state('перемотал');
</script>`;

/** Вывод Chromium; Firefox отличается только `readyState = 3` во второй строке. */
export const STALL_OUT = `ждёт t = 0.9 readyState = 2 буфер 0.0–1.0
играет t = 0.9 readyState = 4 буфер 0.0–2.0
перематывает t = 3.2 readyState = 1 буфер 0.0–2.0
перемотал t = 3.2 readyState = 4 буфер 0.0–2.0, 3.0–4.0`;

export const STALL_NOTE =
  'Ролик встал около 0.9 с (WebKit — на 1.0). `readyState` упал до 2, пришло `waiting`, но `paused` осталось `false`. Ролик не на паузе, он **ждёт**, и как только кусок пришёл, сам пошёл дальше. После перемотки в буфере два отрезка с дырой между ними: 0–2 и 3–4.';

export const PLAIN_WAITING =
  'Буфер — рельсы, уложенные перед поездом. Пока впереди есть рельсы, поезд едет. Кончились — поезд встал, хотя машинист тормоза не нажимал: это `waiting`, а не `pause`. Перемотка — прыжок на другой участок. Если рельсов там нет, поезд стоит, пока их не уложат. И уложить их надо с ближайшей станции — с ключевого кадра.';

export const SEEK_NOTE =
  'Почему перемотка ждёт, даже когда сеть быстрая. Кадр на 3.2 с хранит только отличие от предыдущего, тот — от своего, и так до ключевого кадра на 3.0. Чтобы показать 3.2, браузер скачивает кусок с ключевого кадра и разжимает всё от него. В наших роликах ключевой кадр стоит каждую секунду — так их сжали нарочно. `ffmpeg` без настроек ставит его реже: H.264 — раз в 250 кадров, это 8.3 с при 30 кадрах в секунду, VP9 — раз в 128 кадров, 4.3 с. Перемотка в конец такого отрезка стоит скачивания и разжатия всего отрезка.';

export const WEBKIT_SEEK_NOTE =
  'WebKit на той же перемотке `waiting` не прислал, а `readyState` остался 3. Индикатор загрузки, привязанный только к `waiting`, в Safari на перемотке не появится. Надёжнее показывать его между `seeking` и `seeked` тоже.';

// ─── Раздел 6. Кадр за кадром ──────────────────────────────────────────────────────────────

export const FRAME_CODE = `<video src="clip.mp4" muted></video>
<script>
  const video = document.querySelector('video');
  let frames = 0;
  let paints = 0;

  function onFrame(now, meta) {
    frames++;
    if (frames <= 3) console.log('кадр', meta.presentedFrames, 'время в ролике', meta.mediaTime.toFixed(1));
    video.requestVideoFrameCallback(onFrame);  // колбэк срабатывает один раз — подписаться снова
  }
  video.requestVideoFrameCallback(onFrame);

  function paint() {
    paints++;
    if (!video.ended) requestAnimationFrame(paint);
  }
  video.addEventListener('playing', () => requestAnimationFrame(paint), { once: true });

  video.addEventListener('ended', () => console.log('кадров', frames, '· отрисовок экрана', paints));
  video.addEventListener('canplay', () => video.play(), { once: true });
</script>`;

/** Вывод Chromium; число отрисовок машинозависимо (тест держит «больше кадров втрое»). */
export const FRAME_OUT = `кадр 1 время в ролике 0.0
кадр 2 время в ролике 0.1
кадр 3 время в ролике 0.2
кадров 20 · отрисовок экрана 123`;

export const FRAME_NOTE =
  '`requestVideoFrameCallback` вызывает колбэк, когда на экран вышел **новый кадр ролика**. 2 секунды по 10 кадров — 20 вызовов, а `requestAnimationFrame` за то же время сработал около 120 раз, по разу на обновление экрана. В `meta` приходит, какой это кадр по счёту (`presentedFrames`) и с какой он секунды ролика (`mediaTime`). Firefox обычно сообщал первый кадр дважды, с одним и тем же `mediaTime`, и вызовов выходило на один-два больше, — но не всегда.';

export const CANVAS_NOTE =
  'Внутри колбэка кадр рисуют на холст — `ctx.drawImage(video, 0, 0)` — и уже с холста читают пиксели, накладывают эффекты или отправляют дальше. Если ролик пришёл с чужого источника без атрибута `crossorigin`, холст становится «запачканным», и `getImageData` бросает `SecurityError` — так во всех трёх движках. С `crossorigin="anonymous"` и заголовком CORS у сервера кадр читается. Подробно — в [«Canvas», раздел «Чужие пиксели»](/render/canvas/#s6).';

export const MORE_NOTE =
  'Ещё две вещи рядом. `video.requestPictureInPicture()` выносит ролик в маленькое окно поверх других; `document.pictureInPictureEnabled` — `true` во всех трёх движках стенда. А камеру и микрофон показывают в том же `<video>`, только не через `src`, а через `video.srcObject = stream` — откуда берётся `stream`, разобрано в [«WebRTC», раздел «Каналы данных и медиа»](/platform/webrtc/#s6).';

export const CLOSING =
  '`<video>` — машина состояний, а JS видит её через события. `play()` — просьба: она выполняется, когда пошли кадры, и отклоняется по трём причинам — нет жеста, передумали, файл не открылся. Что сыграет, решает кодек, а не расширение файла, и спрашивать надо точной строкой. Длинный ролик плеер собирает сам: init-сегмент, куски, `updateend`, `endOfStream`. А `waiting` — не пауза: ролик стоит, потому что в буфере кончились кадры.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`play()` без `catch` — красная ошибка в консоли',
    code: 'video.play();            // отказ никто не ловит\nvideo.play().catch(() => showPlayButton());',
    d: 'Отказ автоплея приходит не исключением в месте вызова, а отклонённым промисом. Без обработчика он уходит в консоль как необработанный во всех трёх движках. Правильная реакция почти всегда одна: показать кнопку «Смотреть».',
    tone: 'err',
  },
  {
    n: '02',
    t: '`pause()` сразу после `play()` роняет промис',
    d: 'Кнопка, по которой быстро кликнули дважды, даёт `AbortError`: `play()` ещё не успел выполниться, а `pause()` уже пришёл. Ошибкой это не считают — ловят и игнорируют именно `AbortError`, остальные показывают.',
    tone: 'warn',
  },
  {
    n: '03',
    t: '404 — это `error.code` 4, а не 2',
    d: 'Код 2 (`MEDIA_ERR_NETWORK`) по стандарту бывает, только если сеть подвела **после** `loadedmetadata`. До этого 404, обрыв и неподдержанный кодек дают один и тот же `MEDIA_ERR_SRC_NOT_SUPPORTED`. Отличить «нет файла» от «не тот формат» по `error.code` нельзя — только запросив файл отдельно и посмотрев на ответ сервера.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`"probably"` не значит «сыграет плавно»',
    d: '`canPlayType` говорит только, знает ли браузер формат. AV1 в 4K может оказаться известным и при этом слишком тяжёлым для слабого ноутбука без аппаратного декодера. Про плавность и батарею отвечает `decodingInfo`.',
  },
  {
    n: '05',
    t: '`waiting` может прийти несколько раз подряд',
    d: 'В Chromium после того, как буфер долили, `waiting` и `playing` несколько раз чередовались на одной и той же секунде. Индикатор загрузки, который появляется по каждому `waiting` сразу, мигает. Его показывают с задержкой в несколько сотен миллисекунд и прячут по `playing`.',
    tone: 'warn',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: Source[] = [
  {
    title: 'HTML Standard — Media elements',
    href: 'https://html.spec.whatwg.org/multipage/media.html',
    what: '`readyState`, `networkState`, порядок событий, промис `play()` и его отказы',
  },
  {
    title: 'W3C — Media Source Extensions',
    href: 'https://www.w3.org/TR/media-source-2/',
    what: '`MediaSource`, `SourceBuffer`, init-сегмент, `ManagedMediaSource`',
  },
  {
    title: 'W3C — Media Capabilities',
    href: 'https://www.w3.org/TR/media-capabilities/',
    what: '`decodingInfo`: `supported`, `smooth`, `powerEfficient`',
  },
  {
    title: 'MDN — Autoplay guide for media and Web Audio APIs',
    href: 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay',
    what: 'правила автоплея в браузерах и `getAutoplayPolicy`',
  },
  {
    title: 'WebKit — New video policies for iOS',
    href: 'https://webkit.org/blog/6784/new-video-policies-for-ios/',
    what: '`playsinline` и беззвучный автоплей на iPhone',
  },
  {
    title: 'RFC 8216 — HTTP Live Streaming',
    href: 'https://datatracker.ietf.org/doc/html/rfc8216',
    what: 'плейлисты HLS: `#EXT-X-STREAM-INF`, `#EXT-X-MAP`, `#EXTINF`',
  },
  {
    title: 'WICG — HTMLVideoElement.requestVideoFrameCallback',
    href: 'https://wicg.github.io/video-rvfc/',
    what: 'когда вызывается колбэк и что в `metadata`',
  },
  {
    title: 'hls.js — API',
    href: 'https://github.com/video-dev/hls.js/blob/master/docs/API.md',
    what: 'как библиотека подаёт куски в MSE и выбирает качество',
  },
];

export const RELATED =
  'Смежное на сайте: [Canvas, раздел «Чужие пиксели»](/render/canvas/#s6) — почему кадр с чужого источника нельзя прочитать. [WebRTC](/platform/webrtc/) — камера, `srcObject` и видео между браузерами. [Двоичные данные](/js/binary-data/) — `ArrayBuffer`, который уходит в `appendBuffer`. [Стримы](/platform/streams/) — как читать ответ `fetch` по частям. [Изображения](/render/images/) — `<picture>` и выбор формата, тот же приём, что `<source>` у видео. [Звук: Web Audio API](/js/media-audio/) — звук ролика через граф узлов. [Плеер вне вкладки](/js/media-outside/) — Picture-in-Picture и кнопки плеера в системе.';
