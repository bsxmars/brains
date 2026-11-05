import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Звук: Web Audio API».
 *
 * Тема написана 2026-11-03. Видео (`<video>`, кодеки, MSE) — в соседней медиатеме, здесь
 * `<audio>` упомянут одной фразой как источник графа. Микрофон и `getUserMedia` — в «WebRTC».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Playwright 1.63: headless Chromium 153.0.8010.12 (обязательный), Firefox 155, WebKit 26.6,
 * macOS arm64. Каждый пример с выводом исполняет `tests/e2e/media-audio.spec.ts` — той же
 * строкой, что видит читатель: страница и файлы отдаются маленьким `node:http` на `localhost`.
 * Почему не `page.route`, как в соседних спеках: два препятствия, оба сняты запуском.
 *   — `audioWorklet` есть только в безопасном контексте: на `http://a.test` его нет
 *     (`undefined`) во всех трёх движках, а `AudioContext` там создаётся;
 *   — на `https://a.test` через `page.route` Chromium модуль ворклета не получает:
 *     `AbortError: Failed to load worklet module script … (Network error)` — запрос ворклета
 *     мимо перехвата. `localhost` — безопасный контекст, и сервер настоящий.
 * Звук: `tests/fixtures/media-audio/tone-440.wav` — ffmpeg 8, синус 440 Гц, 44 100 Гц, моно,
 * 16 бит, 0,1 с, 8 898 байт (`ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=0.1
 * -ac 1 -c:a pcm_s16le tone-440.wav`). Амплитуда синуса ffmpeg по умолчанию — 1/8 (пик 0.125).
 * Каталог проб — `scratchpad/au/` (`p1…p10.mjs`).
 *
 * ⚠️ Ловушка стенда: `page.evaluate` в Playwright **считается жестом пользователя**
 * (`navigator.userActivation.hasBeenActive === true` внутри него) — контекст, созданный там,
 * сразу `running` во всех трёх движках. Поведение без жеста снимается только кодом, который
 * страница исполняет сама (`<script>`), а жест — настоящим `page.click`.
 *
 * Что снято пробами:
 *   — без жеста: `new AudioContext()` → `suspended`, `resume()` не выполняется и не
 *     отклоняется (через секунду промис висит), `currentTime` = 0. После `page.click` тот же,
 *     ранее вызванный `resume()` выполняется (раньше нового), состояние `running`. Одинаково
 *     в Chromium, Firefox и WebKit. Флаги `--autoplay-policy=…` в Chromium на это не влияют.
 *     В консоль: Chromium — предупреждение «The AudioContext was not allowed to start…»,
 *     Firefox — два предупреждения, WebKit — ничего;
 *   — `new AudioContext()` в обработчике настоящего клика: Chromium — сразу `running`,
 *     Firefox и WebKit — `suspended`, а `running` становится чуть позже. В WebKit, пока
 *     главный поток занят, этот переход не случается: созданный в клике контекст без
 *     `await ctx.resume()` за 300 мс занятого цикла не вызвал `process()` ни разу. Новый
 *     узел ворклета в WebKit тоже включается не сразу (1 вызов за 300 мс занятости сразу после
 *     создания), поэтому `BUSY_CODE` ждёт первого отчёта из `process()`;
 *   — эхо на `DelayNode` 10 мс: ненулевые сэмплы ровно `0: 1` и `480: 0.5` (Chromium, Firefox);
 *     WebKit даёт ещё `479: 0.0000054` и `480: 0.49999` — задержка там интерполируется;
 *   — фильтр нижних частот 1000 Гц: 440 Гц −28 → −27 дБ, 6000 Гц −28 → −59 дБ (Chromium,
 *     WebKit; одинаково). У Firefox нет `OfflineAudioContext.prototype.suspend`;
 *   — остановка синуса 440 Гц на 50-й мс: `gain.value = 0` — скачок 0.977 на сэмпле 2432
 *     (блок 19 × 128: `suspend(0.05)` округлён вверх до границы блока); линейный спуск за 10 мс —
 *     0.058, это наибольший шаг самой синусоиды: 2π·440/48000 = 0.0576;
 *   — `linearRampToValueAtTime(0, 0.1)` без якоря: 1 → 0.75 → 0.5 → 0.25 → 0 от нуля,
 *     во всех трёх; `exponentialRampToValueAtTime(0, …)` — `RangeError` во всех трёх;
 *   — `ConstantSourceNode.start(0.01).stop(0.02)` — единицы на сэмплах 480…959 ровно;
 *   — `suspend(0.001)` останавливает на 128-м кадре, `suspend(0.003)` — на 256-м;
 *   — живой контекст: за 50 мс занятого цикла `currentTime` в Chromium принимает 16 разных
 *     значений, все кратны 128 кадрам, шаги 128 и 256; в WebKit 20 значений, шаги по 128;
 *     в Firefox — одно значение на всю задачу;
 *   — `baseLatency` при `latencyHint` interactive / balanced / playback: Chromium 0.00533 /
 *     0.01 / 0.02133 с (256 / 480 / 1024 кадра); Firefox 0 у всех; WebKit 0.00267 у всех.
 *     `outputLatency` Chromium: 0 до первого блока, затем 0.016; Firefox ≈0.0128; WebKit ≈0.0051.
 *     `sampleRate` живого контекста — 48 000 во всех трёх: это частота устройства вывода;
 *   — `renderQuantumSize`: в Chromium 153 есть (128; с `renderSizeHint: 256` — 256), в Firefox
 *     и WebKit свойства нет;
 *   — ворклет: блок 128 сэмплов, 1280 кадров — 10 вызовов `process()`, константа 0.8 → 0.4;
 *     в глобальной области ворклета нет `setTimeout`, `fetch`, `performance`, `queueMicrotask`,
 *     `window`; `Atomics` есть; `TextDecoder` — только в WebKit;
 *   — главный поток занят 300 мс: `process()` за это время вызван 110–114 раз при ожидаемых
 *     0.3 × 48000 / 128 ≈ 113 (Chromium, Firefox, WebKit). Тест держит отношение, не число;
 *   — `decodeAudioData`: файл 44 100 Гц в контексте 48 000 → 4800 сэмплов, 0.1 с; в
 *     `OfflineAudioContext` на 44 100 — 4410. Буфер после декодирования отсоединён (0 байт)
 *     в Chromium и Firefox, в WebKit — нет (8898). Мусор вместо файла — `EncodingError`;
 *   — круг из двух `GainNode` без задержки Chromium не глушит (пик 2, а не 0, как просит
 *     спецификация), поэтому о кругах в графе тема молчит;
 *   — `createMediaElementSource` второй раз на тот же `<audio>` — `InvalidStateError` в Chromium
 *     и WebKit; Firefox второй источник создаёт молча.
 */

// ─── Вводный раздел ────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'сэмпл',
    d: 'Одно число — громкость сигнала в один момент времени, обычно от −1 до 1. Звук в Web Audio — это длинный ряд таких чисел в `Float32Array`.',
  },
  {
    k: 'частота дискретизации',
    d: 'Сколько сэмплов приходится на секунду звука: 44 100 или 48 000. Свойство `sampleRate`. Сэмпл номер 480 при 48 000 Гц — это ровно 10 мс от начала.',
  },
  {
    k: 'узел',
    d: 'Объект, который создаёт, меняет или слушает звук: генератор, громкость, фильтр, задержка. Узлы соединяют методом `connect`, и сигнал течёт по этим соединениям.',
  },
  {
    k: 'поток рендеринга звука',
    d: 'Отдельный поток браузера, который считает сэмплы для колонок. JS страницы работает в главном потоке и только описывает, что считать.',
  },
  {
    k: 'децибел, дБ',
    d: 'Громкость в логарифмической шкале. Минус 20 дБ — в 10 раз тише по амплитуде, минус 40 дБ — в 100 раз. `AnalyserNode` отдаёт уровни именно в дБ.',
  },
  {
    k: 'жест пользователя',
    d: 'Клик, нажатие клавиши, касание экрана. Без него браузер не даёт странице начать звук сам.',
  },
];

export const PLAIN_AUDIO =
  'Web Audio похож на гитарную педалборду. Гитара — источник, педали — громкость, фильтр, эхо, а провода между ними — `connect`. Вы собираете цепочку и говорите «играй с такой-то секунды». Звук через педали гонит не ваш JS, а отдельный мотор браузера.';

export const PREREQ_NOTE = 'Тема опирается на три вещи из соседних тем.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Типизированный массив',
    d: 'Сэмплы лежат в `Float32Array` — виде поверх буфера байтов. Файл приходит как `ArrayBuffer`.',
    href: '/js/binary-data/#s1',
    hrefLabel: '«Двоичные данные», раздел «Буфер и вид»',
    tone: 'info',
  },
  {
    t: 'Задача и цикл событий',
    d: 'Главный поток выполняет задачи по одной. Пока задача идёт, ни таймер, ни сообщение не обработаются.',
    href: '/js/event-loop/#s1',
    hrefLabel: '«Event Loop», раздел «Один оборот цикла, по шагам»',
    tone: 'info',
  },
  {
    t: 'Порт сообщений',
    d: 'Пара портов: что отправлено `postMessage` в один, приходит событием `message` в другой. Через такой порт говорят с ворклетом.',
    href: '/js/message-channel/#basics',
    hrefLabel: '«MessageChannel», раздел «Как это выглядит в коде»',
    tone: 'info',
  },
];

// ─── Раздел 1. Первый звук ─────────────────────────────────────────────────────────────────

export const FIRST_HTML = '<button>Сыграть</button>';

/** Исполняется тестом как `<script type="module">` под `FIRST_HTML`; клик — настоящий `page.click`. */
export const FIRST_CODE = `const ctx = new AudioContext();              // один на страницу
console.log('создан:', ctx.state);

document.querySelector('button').addEventListener('click', async () => {
  await ctx.resume();                          // клик — жест, теперь можно
  console.log('после клика:', ctx.state);

  const tone = new OscillatorNode(ctx, { frequency: 440 });   // нота ля
  const volume = new GainNode(ctx, { gain: 0.2 });            // пятая часть громкости
  tone.connect(volume).connect(ctx.destination);              // генератор → громкость → колонки

  const now = ctx.currentTime;
  tone.start(now);
  tone.stop(now + 0.3);                        // ровно 300 мс звука
  tone.onended = () => console.log('доиграл');
});`;

export const FIRST_OUT = `создан: suspended
после клика: running
доиграл`;

export const FIRST_NOTE =
  '`AudioContext` — сам звуковой движок: у него свои часы, своя частота дискретизации и выход на колонки `ctx.destination`. `OscillatorNode` рисует синусоиду нужной частоты, `GainNode` умножает каждый сэмпл на `gain`. `connect` возвращает узел, к которому подключили, поэтому цепочку пишут одной строкой. `start` и `stop` принимают **время по часам контекста**, а не задержку: «играй с `now`, замолчи в `now + 0.3`».';

export const ONE_SHOT_NOTE =
  'Генератор и проигрыватель буфера — одноразовые. Второй `start` на том же узле бросает `InvalidStateError`. Так задумано: на каждую ноту создают новый узел, а сами сэмплы — `AudioBuffer` — переиспользуют сколько угодно раз.';

export const AUTOPLAY_CODE = `const ctx = new AudioContext();
ctx.resume().then(() => console.log('первый resume выполнен'));
setTimeout(() => console.log('через секунду:', ctx.state, ctx.currentTime), 1000);

document.querySelector('button').onclick = async () => {
  await ctx.resume();
  console.log('после клика:', ctx.state);
};`;

export const AUTOPLAY_OUT = `через секунду: suspended 0
первый resume выполнен
после клика: running`;

export const AUTOPLAY_NOTE =
  'Контекст, созданный до первого жеста, стоит в состоянии `suspended`: часы `currentTime` не идут, звука нет. `resume()` без жеста не выполняется и не отклоняется — промис просто ждёт. Исключения нет: Chromium и Firefox пишут в консоль только предупреждение, WebKit молчит вовсе. Это легко принять за «звук сломан». После клика выполняется и новый `resume()`, и тот, давний. Порядок одинаков в Chromium, Firefox и WebKit. Правило поэтому простое: `resume()` — в обработчике клика, а `ctx.state` проверять перед тем, как играть.';

export const PLAIN_AUTOPLAY =
  'Браузер ведёт себя как вахтёр в кинотеатре: проектор можно включить и зарядить плёнку заранее, но свет в зале погаснет, только когда зритель сам сел и сказал «начинайте». Страница, которая заорала сама, едва открылась, — то, от чего браузеры защищают людей.';

// ─── Раздел 2. Граф узлов ──────────────────────────────────────────────────────────────────

export const NODE_ROWS: { k: string; v: string; w: string }[] = [
  { k: '`OscillatorNode`', v: 'источник', w: 'синус, квадрат, пила или треугольник нужной частоты' },
  { k: '`AudioBufferSourceNode`', v: 'источник', w: 'проигрывает готовые сэмплы из `AudioBuffer` — короткие звуки, декодированный файл' },
  { k: '`MediaElementAudioSourceNode`', v: 'источник', w: 'забирает звук из `<audio>` или `<video>`: длинную запись играет элемент, а граф её обрабатывает' },
  { k: '`ConstantSourceNode`', v: 'источник', w: 'одно и то же число на каждом сэмпле — удобно для управления параметрами' },
  { k: '`GainNode`', v: 'обработка', w: 'умножает сигнал на `gain`: громкость, плавное появление и затухание' },
  { k: '`BiquadFilterNode`', v: 'обработка', w: 'фильтр: срезает высокие (`lowpass`), низкие (`highpass`) или полосу частот' },
  { k: '`DelayNode`', v: 'обработка', w: 'выдаёт вход с опозданием на `delayTime` секунд — основа эха' },
  { k: '`AnalyserNode`', v: 'анализ', w: 'пропускает сигнал без изменений и даёт прочитать его форму и спектр' },
  { k: '`ctx.destination`', v: 'выход', w: 'колонки; в `OfflineAudioContext` — итоговый буфер' },
];

export const GRAPH_NOTE =
  'К одному входу можно подключить несколько узлов — их сигналы **складываются**. Один выход можно подключить к нескольким входам — сигнал **раздваивается**. Из этих двух правил собирается любая сеть: параллельные эффекты, смесь нескольких источников, ответвление на анализатор. `disconnect()` снимает связь на ходу.';

export const PLAIN_OFFLINE =
  '`OfflineAudioContext` — тот же движок, только без колонок. Он считает звук быстрее реального времени и отдаёт результат буфером. Как запись в студии вместо концерта: можно переслушать каждый сэмпл. Поэтому все примеры с числами ниже работают на нём — одинаковый граф даёт одинаковые сэмплы при каждом запуске.';

/** Исполняется тестом как модуль; вывод сверяется в Chromium. */
export const ECHO_CODE = `const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 4800, sampleRate: 48000 }); // 0.1 с

const click = new AudioBuffer({ length: 1, sampleRate: 48000 });
click.getChannelData(0)[0] = 1;                 // щелчок: один сэмпл громкостью 1

const source = new AudioBufferSourceNode(ctx, { buffer: click });
const echo = new DelayNode(ctx, { delayTime: 0.01 });   // на 10 мс позже
const quiet = new GainNode(ctx, { gain: 0.5 });          // и вдвое тише

source.connect(ctx.destination);                         // прямой путь
source.connect(echo).connect(quiet).connect(ctx.destination);   // путь через эхо
source.start();

const out = (await ctx.startRendering()).getChannelData(0);
const heard = [...out.keys()].filter((i) => out[i] !== 0).map((i) => \`\${i}: \${out[i]}\`);
console.log(heard.join(', '));`;

export const ECHO_OUT = '0: 1, 480: 0.5';

export const ECHO_NOTE =
  'Сигнал раздвоился на выходе `source` и сложился на входе `destination`. Из 4800 сэмплов звучат два: исходный щелчок на нулевом и эхо на 480-м — 10 мс при 48 000 Гц, вдвое тише. Остальные 4798 — ровно ноль. WebKit размазывает эхо на соседний сэмпл (на 479-м — 0.0000054): задержку он считает с интерполяцией. На слух разницы нет, но сравнивать сэмплы «на равенство» между браузерами нельзя.';

/** Исполняется тестом как модуль; вывод сверяется в Chromium. У Firefox нет `suspend` у офлайн-контекста. */
export const FILTER_CODE = `const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });

const low = new OscillatorNode(ctx, { frequency: 440 });
const high = new OscillatorNode(ctx, { frequency: 6000 });
const before = new AnalyserNode(ctx, { fftSize: 2048 });
const filter = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 1000 });
const after = new AnalyserNode(ctx, { fftSize: 2048 });

low.connect(before);
high.connect(before);                          // два тона на одном входе — сумма
before.connect(filter).connect(after).connect(ctx.destination);
low.start();
high.start();

function level(analyser, hz) {                 // уровень частоты hz в дБ
  const db = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(db);
  return Math.round(db[Math.round(hz / (ctx.sampleRate / analyser.fftSize))]);
}

ctx.suspend(0.5).then(() => {                  // остановиться на середине и посмотреть
  console.log('до фильтра:', level(before, 440), level(before, 6000));
  console.log('после:', level(after, 440), level(after, 6000));
  ctx.resume();
});
await ctx.startRendering();`;

export const FILTER_OUT = `до фильтра: -28 -28
после: -27 -59`;

export const FILTER_NOTE =
  'Анализатор раскладывает последние 2048 сэмплов на частоты: каждая ячейка массива — полоса шириной 48 000 / 2048 ≈ 23 Гц. До фильтра оба тона одинаково громкие, −28 дБ. Фильтр нижних частот на 1000 Гц пропустил 440 Гц почти без потерь и ослабил 6000 Гц на 31 дБ — примерно в 35 раз по амплитуде. Так же строят визуализацию музыки: `AnalyserNode` в конце цепочки, а `getByteFrequencyData` раз в кадр — рисовать столбики на холсте.';

// ─── Раздел 3. Время звука ─────────────────────────────────────────────────────────────────

export const CLOCK_NOTE =
  'У звука свои часы — `ctx.currentTime`, в секундах от создания контекста. Они идут по сэмплам, которые уже посчитаны, а не по системному времени. Пока контекст `suspended`, часы стоят. `performance.now()` — часы страницы, в миллисекундах, и с часами звука они расходятся с первой секунды. Переводит одно в другое `ctx.getOutputTimestamp()`: он отдаёт пару `{ contextTime, performanceTime }` — какой момент звука сейчас выходит из колонок и когда это по `performance.now()`.';

export const PLAIN_CLOCK =
  'Часы звука — это счётчик тактов у барабанщика. Вы не говорите ему «через 250 мс ударь»: пока ваша записка дойдёт, он собьётся. Вы говорите «ударь на такте 17», и он ударит точно, потому что сам считает такты. `start(when)` — это «на такте 17», а `setTimeout` — записка.';

/** Исполняется тестом как модуль. */
export const START_CODE = `const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
const one = new ConstantSourceNode(ctx, { offset: 1 });   // единица на каждом сэмпле
one.connect(ctx.destination);
one.start(0.01);                                        // с 10-й миллисекунды
one.stop(0.02);                                         // до 20-й

const out = (await ctx.startRendering()).getChannelData(0);
console.log('звучит с', out.indexOf(1), 'по', out.lastIndexOf(1));`;

export const START_OUT = 'звучит с 480 по 959';

export const START_NOTE =
  'Звук начался ровно на 480-м сэмпле и кончился на 959-м — до сэмпла, а не «примерно через 10 мс». Отсюда правило ритма: метроном, барабаны и последовательность нот планируют заранее через `start(when)`, на полсекунды вперёд. А `setTimeout` нужен, только чтобы вовремя дописать следующую порцию нот. Колбэк таймера может опоздать на десятки миллисекунд — как и почему, разобрано в [«Event Loop», раздел «Таймеры: почему `0` это не ноль»](/js/event-loop/#s4). На слух это сбитый ритм.';

export const AUTOMATION_LEAD =
  'Параметр узла — `gain.gain`, `filter.frequency`, `osc.frequency` — не просто число, а `AudioParam`. Ему можно расписать изменения по часам звука, и движок посчитает их для каждого сэмпла.';

export const AUTOMATION_ROWS: { k: string; v: string }[] = [
  { k: '`setValueAtTime(v, t)`', v: 'в момент `t` стать `v` — скачком' },
  { k: '`linearRampToValueAtTime(v, t)`', v: 'ровно дойти до `v` к моменту `t`, **начиная с предыдущего события**' },
  { k: '`exponentialRampToValueAtTime(v, t)`', v: 'то же по экспоненте — так громкость звучит естественнее; `v` не может быть 0' },
  { k: '`setTargetAtTime(v, t, τ)`', v: 'с момента `t` плавно стремиться к `v`, за `τ` секунд пройдя ~63 % пути' },
  { k: '`cancelScheduledValues(t)`', v: 'снять всё расписанное после `t`' },
];

/** Исполняется тестом как модуль; вывод сверяется в Chromium и WebKit. */
export const CLICK_CODE = `async function stopAt50ms(how) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
  const tone = new OscillatorNode(ctx, { frequency: 440 });
  const volume = new GainNode(ctx);
  tone.connect(volume).connect(ctx.destination);
  tone.start();

  ctx.suspend(0.05).then(() => {               // «пользователь нажал стоп»
    const now = ctx.currentTime;
    if (how === 'рывком') {
      volume.gain.value = 0;
    } else {
      volume.gain.setValueAtTime(volume.gain.value, now);   // откуда спускаться
      volume.gain.linearRampToValueAtTime(0, now + 0.01);   // и до нуля за 10 мс
    }
    ctx.resume();
  });

  const out = (await ctx.startRendering()).getChannelData(0);
  let jump = 0;                                // самый большой шаг между соседними сэмплами
  for (let i = 1; i < out.length; i++) jump = Math.max(jump, Math.abs(out[i] - out[i - 1]));
  return jump.toFixed(3);
}

console.log('рывком:', await stopAt50ms('рывком'));
console.log('за 10 мс:', await stopAt50ms('плавно'));`;

export const CLICK_OUT = `рывком: 0.977
за 10 мс: 0.058`;

export const CLICK_NOTE =
  'Синусоида 440 Гц при 48 000 Гц меняется от сэмпла к сэмплу не больше чем на 0.058. Рывок застал её почти на гребне — 0.977 — и за один сэмпл бросил в ноль. Такой вертикальный обрыв колонка воспроизводит как **щелчок**, и слышно его на любой громкости. Спуск за 10 мс оставил самый большой шаг тем же 0.058 — тем, что даёт сама волна: щелчка нет, а на слух звук обрывается так же мгновенно. Поэтому громкость, частоту фильтра и всё, что меняется на ходу, меняют через расписание, а не присваиванием `value`.';

export const ANCHOR_NOTE =
  '`setValueAtTime(volume.gain.value, now)` перед спуском — не лишняя строка. `linearRampToValueAtTime` начинает спуск **от предыдущего события в расписании**. Если событий не было, то от нуля секунд. Тогда спуск к моменту `now + 0.01` начнётся задним числом: к `now` громкость окажется где-то посередине — тот же рывок, только поменьше.';

// ─── Раздел 4. Блоки и задержка ────────────────────────────────────────────────────────────

export const BLOCK_NOTE =
  'Поток звука считает не по сэмплу, а **блоками по 128 сэмплов** — при 48 000 Гц это 2,67 мс. На каждый блок он проходит весь граф: источники выдают 128 чисел, каждый узел превращает их в следующие 128. Изменения из главного потока — новый узел, `value`, `connect` — вступают в силу на границе блока. Расписание параметров (`setValueAtTime` и соседи) точнее: оно считается внутри блока для каждого сэмпла.';

export const PLAIN_BLOCK =
  'Блоки похожи на поезд с вагонами по 128 мест. Поток звука отправляет вагон за вагоном, без пауз. Вы с перрона можете поменять маршрут, но только между вагонами: ушедший вагон уже в пути. Если очередной вагон не собран вовремя, на выходе дыра — треск и заикание.';

/** Исполняется тестом как модуль. */
export const SUSPEND_CODE = `const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 4800, sampleRate: 48000 });
for (const t of [0.001, 0.003]) {
  ctx.suspend(t).then(() => {
    console.log('просили', t * 48000, 'кадр, остановились на', ctx.currentTime * 48000);
    ctx.resume();
  });
}
await ctx.startRendering();`;

export const SUSPEND_OUT = `просили 48 кадр, остановились на 128
просили 144 кадр, остановились на 256`;

export const SUSPEND_NOTE =
  'Остановиться посреди блока движок не может: `suspend` округляет момент вверх, до ближайшей границы. Поэтому в примере со щелчком громкость упала не на 2400-м сэмпле, ровно на 50-й миллисекунде, а на 2432-м — в начале 20-го блока. И часы живого контекста шагают так же. В Chromium за 50 мс занятого цикла `currentTime` принял 16 разных значений, каждое кратно 128 кадрам. Firefox на всю задачу отдаёт одно и то же значение — читать часы звука в цикле ожидания там бесполезно.';

export const LATENCY_NOTE =
  'Блок — не единственная задержка. Между «сэмпл посчитан» и «звук вышел из колонки» лежат ещё два отрезка, и контекст сообщает оба:';

export const LATENCY_FACTS = [
  '**`baseLatency`** — запас, который держит сам браузер: сколько готовых блоков лежит наготове, чтобы поток звука не опоздал. Размер выбирают при создании, `new AudioContext({ latencyHint })`: `interactive` — меньше задержка, больше риск треска на слабом устройстве; `playback` — наоборот;',
  '**`outputLatency`** — путь через систему и звуковую карту до колонки. Его знает только операционная система, и в Chromium до первого посчитанного блока он 0.',
];

export const LATENCY_ROWS: { k: string; v: string; w: string; x: string }[] = [
  { k: '`interactive` (по умолчанию)', v: '256 кадров, 5,3 мс', w: '0', x: '128 кадров, 2,7 мс' },
  { k: '`balanced`', v: '480 кадров, 10 мс', w: '0', x: '128 кадров, 2,7 мс' },
  { k: '`playback`', v: '1024 кадра, 21,3 мс', w: '0', x: '128 кадров, 2,7 мс' },
];

export const LATENCY_TABLE_NOTE =
  'Это headless-браузеры на ноутбуке, и для чисел своего устройства это не ответ. `sampleRate` живого контекста у всех трёх — 48 000: это частота устройства вывода, а не выбор страницы. Но вывод из таблицы общий: `latencyHint` — **просьба**, а не приказ. Firefox показывает 0 при любом выборе, WebKit — один блок. Полагаться можно только на то, что прочитали из `baseLatency` и `outputLatency` у себя. Синхронизировать звук с картинкой — по их сумме, а не по константе из статьи.';

export const QUANTUM_NOTE =
  '128 — число из спецификации, но уже не вечное. В Chromium 153 у контекста есть свойство `renderQuantumSize` и параметр `renderSizeHint`: `new AudioContext({ renderSizeHint: 256 })` даёт блок в 256 сэмплов. В Firefox 155 и WebKit 26.6 такого свойства нет. Код, который зашил 128 в длину массивов, сломается там, где блок станет другим; длину берут у самого массива — `output[0].length`.';

// ─── Раздел 5. AudioWorklet ────────────────────────────────────────────────────────────────

export const WORKLET_LEAD_NOTE =
  'Готовых узлов хватает на громкость, фильтры и эхо. Свою обработку — искажение, синтезатор, шумоподавление — пишут на `AudioWorklet`. Это файл с классом, который поток звука вызывает на каждый блок. Код исполняется **в потоке рендеринга звука**, рядом со встроенными узлами, а не на главном потоке.';

export const PLAIN_WORKLET =
  'Ворклет — ваш музыкант в оркестровой яме. Дирижёр — поток звука — каждые 2,7 мс поворачивается к нему и ждёт ровно 128 нот. Сидеть в зрительном зале (главный поток) музыкант не может: там бывает шумно, и он пропустил бы взмах палочки. Со зрителями он переписывается записками — через порт.';

/** Файл модуля. Тест отдаёт эту строку по адресу `quieter.js`. */
export const WORKLET_PROCESSOR_CODE = `// quieter.js — исполняется в потоке рендеринга звука
class Quieter extends AudioWorkletProcessor {
  calls = 0;

  constructor() {
    super();
    this.port.onmessage = () => this.port.postMessage(this.calls);   // ответ главному потоку
  }

  process(inputs, outputs) {
    const input = inputs[0];                  // первый вход: массив каналов
    const output = outputs[0];
    for (let ch = 0; ch < output.length; ch++) {
      for (let i = 0; i < output[ch].length; i++) output[ch][i] = input[ch][i] * 0.5;
    }
    if (this.calls === 0) this.port.postMessage(\`блок: \${output[0].length}, частота: \${sampleRate}\`);
    this.calls++;
    return true;                              // «я ещё нужен» — иначе узел могут выключить
  }
}

registerProcessor('quieter', Quieter);`;

/** Исполняется тестом как модуль; `quieter.js` — `WORKLET_PROCESSOR_CODE`. */
export const WORKLET_MAIN_CODE = `const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1280, sampleRate: 48000 });
await ctx.audioWorklet.addModule('quieter.js');       // загрузить класс в поток звука

const quieter = new AudioWorkletNode(ctx, 'quieter');
const source = new ConstantSourceNode(ctx, { offset: 0.8 });
source.connect(quieter).connect(ctx.destination);
source.start();

const firstReport = new Promise((done) => (quieter.port.onmessage = (e) => done(e.data)));
const out = (await ctx.startRendering()).getChannelData(0);
console.log(await firstReport);
console.log('на выходе:', out[0].toFixed(2), out[1279].toFixed(2));

quieter.port.onmessage = (e) => console.log('вызовов process():', e.data);
quieter.port.postMessage('сколько?');`;

export const WORKLET_OUT = `блок: 128, частота: 48000
на выходе: 0.40 0.40
вызовов process(): 10`;

export const WORKLET_NOTE =
  '`addModule` загружает файл в отдельную глобальную область внутри потока звука. `registerProcessor` даёт классу имя, а `new AudioWorkletNode(ctx, \'quieter\')` в главном потоке создаёт узел и экземпляр класса по ту сторону. 1280 кадров — это 10 блоков, и `process()` вызван ровно 10 раз. Каждый раз ему дают по 128 сэмплов на канал: `inputs[номер входа][номер канала]` — `Float32Array`. Ответ пишут в такой же `outputs`.';

export const WORKLET_SCOPE_FACTS = [
  '**нет `setTimeout`, `fetch`, `performance`, `queueMicrotask`, `window`** — ни в одном из трёх движков. Есть `sampleRate`, `currentTime`, `currentFrame` и `port`. Ворклет не ходит в сеть и ничего не ждёт: всё нужное ему приносят;',
  '**`process()` обязан успеть за блок.** На 48 000 Гц это 2,67 мс на весь граф, включая встроенные узлы. Опоздал — на выходе дыра, и пользователь слышит треск. Поэтому внутри `process()` не создают объектов: сборка мусора посреди блока — та же пауза;',
  '**`port` — обычный `MessagePort`**, сообщения копируются структурным клонированием. Для команд вида «смени пресет» этого хватает. Поток сэмплов из ворклета наружу — например, для записи — гоняют через общую память: кольцевой буфер на `SharedArrayBuffer` и `Atomics`, без копий и без задач в цикле событий.',
];

export const WORKLET_PORT_LINKS =
  'Как устроен порт и почему сообщение — это задача главного потока, — в [«MessageChannel», раздел «Как это выглядит в коде»](/js/message-channel/#basics). Общий буфер и атомарный флажок — в [«Общая память и Atomics», раздел «Общий буфер: одна память на несколько потоков»](/js/atomics/#s1). В браузере общий буфер есть только на изолированной странице — [«Безопасность фронтенда», раздел «Изоляция страницы: COOP и COEP»](/platform/security/#s7).';

/** Исполняется тестом: страница с кнопкой, клик запускает живой контекст. */
export const BUSY_CODE = `document.querySelector('button').onclick = async () => {
  const ctx = new AudioContext();
  await ctx.resume();                          // дождаться, пока звук действительно пошёл
  await ctx.audioWorklet.addModule('quieter.js');
  const quieter = new AudioWorkletNode(ctx, 'quieter');
  const started = new Promise((done) => (quieter.port.onmessage = done));   // первый отчёт process()
  const silence = new ConstantSourceNode(ctx, { offset: 0 });
  silence.connect(quieter).connect(ctx.destination);
  silence.start();
  await started;                               // узел уже считает

  const calls = () => new Promise((reply) => {
    quieter.port.onmessage = (e) => typeof e.data === 'number' && reply(e.data);
    quieter.port.postMessage('сколько?');
  });

  const before = await calls();
  const start = performance.now();
  while (performance.now() - start < 300) {}   // главный поток занят 300 мс
  const after = await calls();

  console.log('за 300 мс занятости:', after - before, 'вызовов process()');
  console.log('блоков в 300 мс звука:', Math.round(0.3 * ctx.sampleRate / 128));
};`;

export const BUSY_OUT = `за 300 мс занятости: 112 вызовов process()
блоков в 300 мс звука: 113`;

export const BUSY_NOTE =
  'Главный поток 300 мс крутил пустой цикл и не обработал ни одного события. А ворклет за это время отработал 110–114 блоков из 113 положенных — каждый запуск число своё. Под нагрузкой (три браузера разом на одном ноутбуке) бывало и 94: поток звука делит процессор с остальными, но от главного потока не зависит. Это и есть причина отдельного потока. Раньше свою обработку писали на `ScriptProcessorNode`, и её колбэк исполнялся на главном потоке: любая долгая задача страницы оборачивалась треском. Узел до сих пор есть во всех трёх движках, но объявлен устаревшим.';

// ─── Раздел 6. Декодирование ───────────────────────────────────────────────────────────────

/** Исполняется тестом как модуль; `tone-440.wav` — из `tests/fixtures/media-audio/`. */
export const DECODE_CODE = `const ctx = new AudioContext();
const bytes = await (await fetch('tone-440.wav')).arrayBuffer();
console.log('файл:', bytes.byteLength, 'байт');

const tone = await ctx.decodeAudioData(bytes);       // байты файла → сэмплы
console.log('в контексте', ctx.sampleRate, 'Гц:', tone.length, 'сэмплов,', tone.duration, 'с');
console.log('байтов в исходном буфере:', bytes.byteLength);

const player = new AudioBufferSourceNode(ctx, { buffer: tone });
player.connect(ctx.destination);                     // player.start() — по клику`;

export const DECODE_OUT = `файл: 8898 байт
в контексте 48000 Гц: 4800 сэмплов, 0.1 с
байтов в исходном буфере: 0`;

export const DECODE_NOTE =
  'Файл — WAV на 44 100 Гц, 0,1 с, то есть 4410 сэмплов. А в буфере их 4800: `decodeAudioData` сразу пересчитывает звук на частоту **контекста**, чтобы играть без преобразований. В `OfflineAudioContext` на 44 100 Гц тот же файл даёт ровно 4410. Декодирование работает и в контексте `suspended`: жест нужен звуку, а не разбору файла. Поэтому звуки игры декодируют заранее, при загрузке, а по клику только создают `AudioBufferSourceNode` и зовут `start`.';

export const DECODE_FACTS = [
  '**Исходный `ArrayBuffer` после вызова пуст** — 0 байт в Chromium и Firefox: браузер забирает его себе, как при передаче в воркер. В WebKit буфер остаётся целым. Нужен файл дважды — декодируйте копию, `bytes.slice(0)`;',
  '**Мусор вместо файла — отказ промиса с `EncodingError`**, а не тихий пустой буфер;',
  '**Декодированный звук весит много.** Каждый сэмпл — 4 байта `Float32`, на каждый канал. Минута стерео при 48 000 Гц — 23 МБ в памяти, даже если MP3 весил 1 МБ. Длинную музыку поэтому не декодируют целиком, а играют через `<audio>` и при нужде подключают к графу `MediaElementAudioSourceNode`.',
];

export const CLOSING =
  '**Страница описывает звук, а считает его другой поток.** Граф узлов задаёт, откуда сигнал берётся и как меняется. Часы контекста задают, когда — до сэмпла. Всё, что меняется на ходу, меняют расписанием, а не присваиванием, иначе щелчок. Свою обработку пишут ворклетом, который успевает за 128 сэмплов. И ни один звук не начнётся, пока пользователь сам не нажал.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`resume()` без жеста молча висит',
    d: 'Ни ошибки, ни отказа: промис просто не выполняется, а `currentTime` стоит на нуле. Код вида `await ctx.resume(); play()` при загрузке страницы зависнет до первого клика. Проверяйте `ctx.state` и зовите `resume()` в обработчике клика или нажатия клавиши.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Контекст из обработчика клика ещё не обязательно `running`',
    d: '`new AudioContext()` прямо в обработчике клика в Chromium сразу `running`, а в Firefox и WebKit — `suspended`, и запускается он чуть позже. В WebKit этот запуск ждёт свободного главного потока: займёте его сразу — звука не будет до конца задачи. Поэтому и здесь первым делом `await ctx.resume()`.',
    tone: 'warn',
  },
  {
    n: '03',
    t: 'Спуск начинается с прошлого события, а не с «сейчас»',
    code: 'gain.gain.linearRampToValueAtTime(0, 0.1);\n// громкость: 1 → 0.75 → 0.5 → 0.25 → 0\n// на 0, 25, 50, 75, 100 мс — от нуля, а не от вызова',
    d: 'Без `setValueAtTime(текущее, now)` перед спуском движок ведёт линию от предыдущего события в расписании, а если его нет — от нуля секунд. Вызов на пятой секунде даст мгновенный скачок, а не плавный спуск.',
    tone: 'err',
  },
  {
    n: '04',
    t: '`exponentialRampToValueAtTime(0, t)` бросает `RangeError`',
    d: 'Экспонента до нуля не доходит никогда, и спецификация это запрещает. Спускают до `0.0001` (−80 дБ, тишина на слух) или берут `setTargetAtTime(0, t, τ)`.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Без безопасного контекста нет `audioWorklet`',
    d: 'На `http://` вне `localhost` у контекста нет свойства `audioWorklet` — `undefined` во всех трёх движках, а сам `AudioContext` создаётся как ни в чём не бывало. Ошибка всплывает только на `addModule`: `Cannot read properties of undefined`.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Один `<audio>` — один источник графа',
    d: 'Второй `createMediaElementSource` на тот же элемент в Chromium и WebKit бросает `InvalidStateError`, а Firefox второй источник создаёт. Код, проверенный только в Firefox, ломается у остальных. Узел создают один раз и держат.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'У Firefox нет `suspend` у `OfflineAudioContext`',
    d: '`ctx.suspend is not a function` в Firefox 155. В Chromium и WebKit офлайн-рендер можно остановить на нужном блоке и что-то поменять. Для кросс-браузерного кода события расписывают заранее, через `setValueAtTime` и соседей: их поддерживают все.',
  },
];

// ─── Источники ─────────────────────────────────────────────────────────────────────────────

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'W3C — Web Audio API 1.1',
    href: 'https://www.w3.org/TR/webaudio-1.1/',
    what: 'граф, блок рендеринга, расписание `AudioParam`, `AudioWorklet`, `decodeAudioData`',
  },
  {
    title: 'MDN — Web Audio API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API',
    what: 'справочник по узлам и поддержка в браузерах',
  },
  {
    title: 'MDN — Autoplay guide for media and Web Audio APIs',
    href: 'https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay',
    what: 'когда звук разрешён без жеста и как это проверить',
  },
  {
    title: 'Chrome for Developers — Audio Worklet is now available by default',
    href: 'https://developer.chrome.com/blog/audio-worklet',
    what: 'зачем ворклет пришёл на смену `ScriptProcessorNode`',
  },
  {
    title: 'Chrome for Developers — Audio Worklet design pattern',
    href: 'https://developer.chrome.com/blog/audio-worklet-design-pattern',
    what: 'кольцевой буфер на `SharedArrayBuffer` между ворклетом и воркером',
  },
  {
    title: 'Chris Wilson — A Tale of Two Clocks',
    href: 'https://web.dev/articles/audio-scheduling',
    what: 'почему ноты планируют `start(when)`, а `setTimeout` только дописывает расписание',
  },
];

export const RELATED =
  'Смежное на сайте: [MessageChannel](/js/message-channel/) — порт, через который говорят с ворклетом. [Общая память и Atomics](/js/atomics/) — кольцевой буфер между ворклетом и воркером. [Воркеры и параллелизм](/js/workers/) — отдельные потоки для тяжёлого JS. [Event Loop](/js/event-loop/) — почему таймер опаздывает. [Двоичные данные](/js/binary-data/) — `ArrayBuffer` и `Float32Array`, в которых лежит звук. [WebRTC](/platform/webrtc/) — микрофон через `getUserMedia` и звонки. [Canvas](/render/canvas/) — где рисуют спектр из `AnalyserNode`. [Видео в браузере](/js/media-video/) — `<video>` и `<audio>`, автоплей и кодеки. [Голос: запись с микрофона и речь](/js/media-voice/) — запись звука и синтез речи.';
