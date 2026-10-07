import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { GpuPreset } from '@/widgets/gpu-compute/model/types';

/**
 * Данные темы «WebGPU: другая модель работы с видеокартой».
 *
 * Тема написана здесь. До неё предмет висел строкой «Отдельная тема — готовится» в «за кадром»
 * у [«WebGL и конвейера GPU»](/render/webgl/). Конвейер GPU, шейдеры, вызовы отрисовки, текстуры
 * и фреймбуферы разобраны там — здесь на них только ссылки. Эта тема — про то, чем WebGPU
 * устроен **иначе**: явные объекты, запись команд отдельно от отправки, неизменяемый конвейер,
 * группы привязок, вычислительные шейдеры, асинхронное чтение и ошибки промисом.
 *
 * ## Где и чем проверено
 *
 * Сентябрь 2026, свои скрипты Playwright 1.63 (страница с `localhost`, без сети):
 *
 *   — **Chromium 153.0.8010.12**, headless shell (браузер проверок проекта): `navigator.gpu` есть,
 *     `requestAdapter()` → **`null`**. С флагом `--enable-unsafe-webgpu` — адаптер
 *     `google · swiftshader`, `isFallbackAdapter: true`, то есть **программный, считает процессор**.
 *     Флаги `--use-webgpu-adapter=swiftshader`, `--use-angle=swiftshader`, `--enable-features=Vulkan`
 *     поверх него ничего не меняют;
 *   — **Chromium 153 полный** (`channel: 'chromium'`, новый headless): адаптер `apple · metal-3`
 *     без всяких флагов — настоящая видеокарта;
 *   — **Firefox 155**: `navigator.gpu` есть, в headless `requestAdapter()` → `null`, с окном
 *     (`headless: false`) — адаптер есть, `adapter.info` отдаёт пустые строки;
 *   — **WebKit 26.6**: адаптер `apple` в headless.
 *
 * Каждое утверждение о поведении ниже снято запуском во всех конфигурациях, где есть адаптер,
 * если рядом не сказано иного. Тексты ошибок — дословные, из этих прогонов.
 *
 * ## ⚠️ Чего здесь нет
 *
 * **Времени — ни одного числа.** Правило то же, что в «WebGL»: `submit` возвращается раньше,
 * чем GPU начал работу, а в проверках проекта адаптер программный — секундомер мерил бы
 * процессор. Все числа темы структурные: лимиты, счёт групп и вызовов, байты, совпавшие элементы.
 *
 * Код хоста (`ADD_HOST_CODE`) исполнен в браузере тем же скриптом — строка из этого файла,
 * а не копия; в `vitest` WebGPU нет, поэтому тест сверяет с шейдером только раскладку привязок.
 * Шейдеры демо (`GPU_PRESETS`) исполнены во всех четырёх конфигурациях, результат сверен
 * с эталоном: сложение и гистограмма — 0 расхождений.
 */

// ---- Вводный раздел ----

export const PLAIN_MODEL =
  'WebGL похож на разговор с мастером по телефону: «возьми эту кисть», «теперь синюю краску», «рисуй» — и каждая фраза уходит сразу, а мастер помнит, что вы сказали раньше. WebGPU — это заказ-наряд: вы заранее заполняете бланк целиком (какой станок, какие детали, в каком порядке), сдаёте пачку бланков в окошко и потом забираете готовое. Бланк проверяют один раз при приёме, а не на каждой фразе.';

export const GLOSSARY = [
  {
    k: 'адаптер (adapter)',
    d: 'Описание видеокарты, которую браузер готов дать странице: производитель, возможности, пределы. Сам по себе ничего не делает — из него запрашивают устройство. `navigator.gpu.requestAdapter()` может вернуть `null`, и это не ошибка, а ответ «видеокарты для вас нет».',
  },
  {
    k: 'устройство (device)',
    d: 'Ваше рабочее подключение к GPU: через него создаются буферы, шейдеры и конвейеры. Всё созданное принадлежит устройству и умирает вместе с ним. Аналог контекста WebGL — только не привязан к канвасу.',
  },
  {
    k: 'очередь (queue)',
    d: '`device.queue` — единственный вход, через который работа попадает на GPU: `submit` отправляет записанные команды, `writeBuffer` — данные.',
  },
  {
    k: 'энкодер команд (command encoder)',
    d: 'Объект, в который вы записываете команды для GPU: «возьми этот конвейер», «запусти столько групп», «скопируй буфер». Сам он ничего не отправляет — только копит запись.',
  },
  {
    k: 'командный буфер',
    d: 'Записанная заранее пачка команд (`GPUCommandBuffer`). Получается из энкодера вызовом `finish()`, отправляется `queue.submit` — ровно один раз.',
  },
  {
    k: 'конвейер (pipeline)',
    d: 'Объект, в котором собрано всё состояние для работы шейдера: сам шейдер, точка входа, раскладка ресурсов, а для рисования ещё формат вершин, смешивание, глубина. После создания не меняется.',
  },
  {
    k: 'группа привязок (bind group)',
    d: 'Набор ресурсов — буферов, текстур — которые шейдер увидит под номерами `@binding(0)`, `@binding(1)`… Её форму описывает раскладка (`GPUBindGroupLayout`), и форма должна совпасть с объявлениями в шейдере.',
  },
  {
    k: 'storage-буфер',
    d: 'Буфер в памяти видеокарты, который шейдер может не только читать, но и писать — как обычный массив. Помечается флагом `GPUBufferUsage.STORAGE` при создании. В WebGL такого не было: писать шейдер мог только в пиксели.',
  },
  {
    k: 'атомарная операция',
    d: 'Действие «прочитать, изменить, записать», которое выполняется целиком, без вмешательства соседей: `atomicAdd` прибавляет так, что два вызова не затрут прибавления друг друга. Обычное `x = x + 1` из тысяч вызовов сразу теряет часть прибавлений.',
  },
  {
    k: 'WGSL',
    d: 'Язык шейдеров WebGPU. Не GLSL: другой синтаксис, строже типы, ресурсы объявляются прямо в тексте шейдера. Браузер сам переводит его под платформу.',
  },
  {
    k: 'вычислительный шейдер (compute)',
    d: 'Шейдер, который ничего не рисует: читает буферы, пишет буферы. Запускается не на вершинах и пикселях, а сеткой рабочих групп, размер которой задаёте вы.',
  },
];

// ---- Перед началом ----

export const PREREQ = [
  {
    t: 'Что такое конвейер GPU и шейдер',
    d: 'Вершины → вершинный шейдер → растеризация → фрагментный шейдер → пиксели. WebGPU рисует **тем же конвейером**: меняется то, как вы его настраиваете, а не он сам.',
    href: '/render/webgl/#s2',
    hrefLabel: 'WebGL и конвейер GPU · Конвейер',
    tone: 'info' as const,
  },
  {
    t: 'Что вызов API кладёт команду в очередь, а не выполняет её',
    d: '`drawArrays` возвращается раньше, чем GPU взялся за работу, и путь команды лежит через отдельный GPU-процесс. В WebGPU эта очередь просто вынесена наружу и получила имя.',
    href: '/render/webgl/#s3',
    hrefLabel: 'WebGL и конвейер GPU · Что стоит дорого',
    tone: 'warn' as const,
  },
  {
    t: 'Как работают промисы',
    d: 'Почти всё, что в WebGPU отвечает «готово», — промис: адаптер, устройство, чтение буфера, области ошибок, потеря устройства.',
    href: '/js/promise-internals/',
    hrefLabel: 'Промис изнутри',
    tone: 'info' as const,
  },
  {
    t: 'Что `ArrayBuffer` может «опустеть»',
    d: 'После передачи владения у буфера `byteLength` становится 0. С отображённым буфером WebGPU происходит то же самое при `unmap()`.',
    href: '/js/message-channel/#s3',
    hrefLabel: 'MessageChannel · Правила transfer-списка',
    tone: 'warn' as const,
  },
];

// ---- Раздел «Другая модель» ----

export const MODEL_ROWS = {
  head: ['', 'WebGL 2', 'WebGPU'],
  rows: [
    ['вход', '`canvas.getContext("webgl2")` — контекст рождается из канваса', '`navigator.gpu` → адаптер → устройство; канвас нужен, только если рисуете на экран'],
    ['состояние', 'глобальный автомат: `useProgram`, `bindBuffer`, `enable(BLEND)` меняют «текущее», и оно доживает до следующего вызова', '«текущего» нет: всё состояние собрано в объекты — конвейер, группы привязок — и передаётся явно'],
    ['команды', 'каждый вызов уходит сразу', 'записываются в энкодер, отправляются пачкой через `queue.submit`'],
    ['когда проверяется', 'на каждом вызове отрисовки: драйвер смотрит на всё текущее состояние', 'при создании конвейера и группы привязок — один раз; при записи — только то, что меняется'],
    ['ошибки', '`gl.getError()` — синхронный флаг, опрашивать вручную', 'объект становится «недействительным», ошибка приходит промисом из области ошибок или событием'],
    ['вычисления', 'только через рисование: данные в текстуре, результат в пикселях', 'вычислительные шейдеры, storage-буферы, атомарные операции'],
    ['чтение результата', '`readPixels` — ждёт GPU и останавливает поток', '`mapAsync` — промис; поток свободен, пока GPU работает'],
    ['язык', 'GLSL ES 3.00', 'WGSL'],
  ],
  cols: 'minmax(120px,.6fr) minmax(220px,1.2fr) minmax(240px,1.3fr)',
  kinds: ['mono', 'muted', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 680,
};

export const MODEL_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Пределы адаптера — не пределы устройства',
    d: 'Адаптер сообщает, на что способна карта; устройство по умолчанию получает **базовые пределы спецификации**, одинаковые везде. Замер: у адаптеров Chromium (Metal), Firefox и WebKit на одной машине `maxComputeInvocationsPerWorkgroup` = 1024, у полученных из них устройств — 256. Больше дадут, только если попросить при создании: `requestDevice({ requiredLimits: { … } })`. Так код, написанный на мощной машине, не ломается молча на слабой.',
    tone: 'warn',
  },
  {
    t: 'Канвас не обязателен — и держит один тип контекста',
    d: 'Для вычислений канвас не нужен вовсе: устройство существует само по себе. Для рисования канвас даёт контекст `"webgpu"` — но один канвас не может быть и тем и другим: `getContext("webgpu")` после `"webgl2"` вернул `null`, и наоборот, во всех трёх движках.',
  },
  {
    t: 'Адаптер бывает программным',
    d: '`adapter.info.isFallbackAdapter` = `true` значит, что считает процессор (в Chromium это SwiftShader). Всё работает и даёт тот же результат, но о скорости видеокарты такой адаптер не говорит ничего. Спросить у адаптера можно заранее — и решить, стоит ли вообще уходить с CPU.',
    tone: 'warn',
  },
];

// ---- Раздел «Запись и отправка» ----

export const PLAIN_ENCODER =
  'Энкодер — это список покупок. Пока вы его пишете, в магазин никто не идёт, и вычеркнуть или дописать можно что угодно. `finish()` — список сложен и отдан курьеру: дописывать в него уже нельзя. `submit` — курьер ушёл. Второй раз тот же список не отдать: он одноразовый.';

export const ADD_WGSL = `@group(0) @binding(0) var<storage, read> a: array<u32>;
@group(0) @binding(1) var<storage, read> b: array<u32>;
@group(0) @binding(2) var<storage, read_write> sum: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&sum)) { return; }
  sum[i] = a[i] + b[i];
}`;

/**
 * Хост-код сложения — целиком, от адаптера до прочитанного массива.
 *
 * ⚠️ Исполнен как есть: скрипт проверки темы подставляет `ADD_WGSL` и зовёт `addOnGpu` в трёх
 * движках, результат совпал с `a[i] + b[i]` на всех элементах. Раскладку привязок из этой
 * строки тест сверяет с `@binding` в `ADD_WGSL` — разбором строки.
 */
export const ADD_HOST_CODE = `async function addOnGpu(a, b) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;                   // имя есть, видеокарты нет
  const device = await adapter.requestDevice();
  const U = GPUBufferUsage;

  const upload = (data) => {
    const buf = device.createBuffer({ size: data.byteLength, usage: U.STORAGE | U.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);    // копия снята в момент вызова
    return buf;
  };
  const bufA = upload(a);
  const bufB = upload(b);
  const bufSum = device.createBuffer({ size: a.byteLength, usage: U.STORAGE | U.COPY_SRC });
  const readback = device.createBuffer({ size: a.byteLength, usage: U.MAP_READ | U.COPY_DST });

  // Раскладка: какие ресурсы и под какими номерами увидит шейдер
  const layout = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ] });
  // Конвейер: шейдер + раскладка, проверяются здесь, один раз
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: device.createShaderModule({ code: ADD_WGSL }), entryPoint: 'main' },
  });
  // Группа привязок: конкретные буферы под эти номера
  const group = device.createBindGroup({ layout, entries: [
    { binding: 0, resource: { buffer: bufA } },
    { binding: 1, resource: { buffer: bufB } },
    { binding: 2, resource: { buffer: bufSum } },
  ] });

  const encoder = device.createCommandEncoder();   // запись…
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(a.length / 64));
  pass.end();
  encoder.copyBufferToBuffer(bufSum, 0, readback, 0, a.byteLength);
  device.queue.submit([encoder.finish()]);         // …и отправка

  await readback.mapAsync(GPUMapMode.READ);        // ждать результата — отдельный шаг
  const sum = new Uint32Array(readback.getMappedRange().slice(0));
  readback.unmap();
  device.destroy();
  return sum;
}`;

export const ENCODE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Командный буфер одноразовый',
    d: 'Второй `submit` того же буфера исключения не бросает — он отклоняется проверкой: «`[CommandBuffer] cannot be submitted more than once.`» (Chromium). Повторить работу — значит записать её заново. Дёшево это потому, что дорогое — конвейер и группы — уже создано и переиспользуется.',
    tone: 'warn',
  },
  {
    t: 'Конвейер нельзя поправить',
    d: 'У объекта `GPUComputePipeline` ровно два члена: `label` и `getBindGroupLayout()`. Ни одного сеттера. Другое смешивание, другой формат, другой шейдер — **другой конвейер**. Отсюда привычка движков на WebGPU: собрать все конвейеры заранее и по ходу кадра только выбирать нужный.',
  },
  {
    t: 'Почему это быстрее, а не просто строже',
    d: 'В WebGL драйвер не знает, что вы поменяете следующим, и на каждом вызове отрисовки перепроверяет **всё** текущее состояние. Здесь проверка переехала в момент создания объекта: у готового конвейера проверять нечего. Цена смены состояния из [«Что стоит дорого»](/render/webgl/#s3) никуда не делась — её просто платят заранее и один раз.',
    tone: 'ok',
  },
  {
    t: 'Запись можно вести где угодно',
    d: 'Энкодер ничего не отправляет, поэтому писать команды можно порциями, в любом порядке своих функций и даже в воркере (`navigator.gpu` там есть — проверено в Chromium и Firefox). На GPU всё уйдёт одной пачкой, когда вы решите.',
  },
];

export const PLAIN_BIND_GROUP =
  'Раскладка — это форма розетки: сколько гнёзд и какой формы. Группа привязок — конкретная вилка, воткнутая в эту розетку: вот этот буфер в гнездо 0, этот — в гнездо 2. Шейдер знает только номера гнёзд. Если вилка не той формы, её не примут ещё при сборке, а не в момент включения.';

export const BIND_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`layout: "auto"` — удобно и коварно',
    d: 'Конвейер может вывести раскладку из шейдера сам. Но выводит он её **только из того, что шейдер использует**: объявленная и неиспользованная привязка из раскладки выпадает, и группа с ней отклоняется — «`binding index 1 not present in the bind group layout`» (Chromium; Firefox — то же своими словами; WebKit 26.6 такую группу принял).',
    tone: 'warn',
  },
  {
    t: 'Группы от «auto» не переносятся',
    d: 'Раскладка, выведенная автоматически, принадлежит своему конвейеру. Группа, созданная по ней, с другим конвейером несовместима — даже если шейдеры объявляют ровно то же. Chromium прямо советует: «`Use an explicit bind group layout … to share bind groups between pipelines`». Поэтому в демо ниже раскладка явная.',
    tone: 'warn',
  },
  {
    t: 'Номер группы — это частота смены',
    d: 'Групп у конвейера несколько (базовый предел — 4), и принято раскладывать ресурсы по тому, как часто они меняются: группа 0 — общее на кадр, 1 — материал, 2 — объект. Тогда между вызовами переставляют только последнюю.',
  },
];

// ---- Раздел «Вычисления» ----

export const PLAIN_WORKGROUP =
  'Задачу режут на бригады. В каждой бригаде одинаковое число рабочих — это `@workgroup_size`, — у бригады общий стол (память `var<workgroup>`), и она может договориться «ждём, пока все допишут» (`workgroupBarrier`). Между бригадами общего стола нет и договориться нельзя. Вы говорите, сколько бригад нанять, — `dispatchWorkgroups(n)`, — а кто из них начнёт первым, не решаете.';

export const WORKGROUP_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Номер вызова — из трёх чисел',
    d: '`global_invocation_id` = номер группы × размер группы + номер внутри группы. Для одномерной задачи достаточно `.x`. Сетка трёхмерная, чтобы картинке или объёму не пришлось пересчитывать индексы вручную.',
  },
  {
    t: 'Групп всегда с запасом',
    d: 'Нужно 1000 элементов при группе в 64 — просят `ceil(1000 / 64)` = 16 групп, то есть 1024 вызова. Лишние 24 обязаны ничего не делать: отсюда проверка `if (i >= arrayLength(&sum)) { return; }`. Без неё они пишут за край — и **исключения не будет** (об этом в «Тонких местах»).',
    tone: 'warn',
  },
  {
    t: 'Пределы проверяются, а не угадываются',
    d: '`@workgroup_size(512)` на устройстве с базовыми пределами — ошибка при создании конвейера: «`exceeds the maximum allowed (256, 256, 64)`». `dispatchWorkgroups(70000)` — ошибка при отправке: не больше 65 535 групп на измерение. Больше данных — больше измерений или несколько проходов.',
  },
];

export const WGSL_ROWS = {
  head: ['', 'GLSL ES 3.00', 'WGSL'],
  rows: [
    ['ресурсы', '`uniform` в тексте, номер — из JS: `getUniformLocation`', 'номер прямо в тексте: `@group(0) @binding(2) var<storage, read_write> sum: array<u32>;`'],
    ['точка входа', 'всегда `main`, один шейдер — одна стадия', 'любая функция с `@compute`, `@vertex` или `@fragment`; в одном модуле их может быть несколько'],
    ['литерал без типа', '`float x = 1;` — ошибка: «cannot convert from \'const int\' to \'highp float\'»', '`let x: f32 = 1;` — можно: литерал абстрактный и примет нужный тип'],
    ['смешанная арифметика', 'запрещена', 'тоже запрещена: `u32 * f32` → «no matching overload for \'operator * (u32, f32)\'»'],
    ['препроцессор', '`#define`, `#ifdef`', 'нет: `#define` — «invalid character found». Варианты шейдера собирают строками в JS или константами `override`'],
    ['точность', '`highp`/`mediump`/`lowp`', 'квалификаторов нет: `f32` всегда; `f16` — отдельная возможность `shader-f16`, которой у программного адаптера Chromium нет'],
  ],
  cols: 'minmax(130px,.6fr) minmax(200px,1fr) minmax(260px,1.4fr)',
  kinds: ['prose', 'muted', 'prose'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 680,
};

export const WGSL_NOTE =
  'Тексты ошибок — Chromium 153 (компилятор Tint): GLSL — через ANGLE (слой Chromium, который переводит WebGL в родной графический API системы), WGSL — через `getCompilationInfo()`. Своего компилятора WGSL у драйвера нет: браузер сам переводит шейдер в язык платформы — SPIR-V, HLSL или MSL. Поэтому класса ошибок «у меня в драйвере работает» здесь меньше, чем в WebGL, — но не ноль, см. про барьер в «Тонких местах».';

export const HISTOGRAM_WGSL = `@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>>;

const BINS = 16u;
var<workgroup> local: array<atomic<u32>, BINS>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u,
        @builtin(local_invocation_index) lid: u32) {
  if (gid.x < arrayLength(&values)) {
    atomicAdd(&local[values[gid.x] % BINS], 1u);
  }
  workgroupBarrier();
  if (lid < BINS) {
    atomicAdd(&bins[lid], atomicLoad(&local[lid]));
  }
}`;

/**
 * Та же гистограмма без атомиков. Работает «почти» — и в этом весь урок.
 *
 * Снято на входе демо (65 536 значений из `makeInputs`, 16 корзин), по прогону на конфигурацию:
 * Chromium/SwiftShader насчитал 47 283, Chromium/Metal — **364**, WebKit — 394, Firefox — 323.
 * Правильный ответ — 65 536. Расходятся все 16 корзин. На другом входе (линейный конгруэнтный
 * генератор, см. `model/input.ts`) и в повторах числа другие — Metal давал и 192, — но проигрыш
 * всегда: у гонки нет «правильной» доли потерь, есть только железо, на котором она случилась.
 */
export const RACE_WGSL = `@group(0) @binding(0) var<storage, read> values: array<u32>;
@group(0) @binding(1) var<storage, read_write> bins: array<u32>;

const BINS = 16u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= arrayLength(&values)) { return; }
  let k = values[gid.x] % BINS;
  bins[k] = bins[k] + 1u;   // прочитал, прибавил, записал — не атомарно
}`;

/**
 * Гонка и атомики на одной корзине. Добавлено по решению автора курса (2026-09-29): карточка
 * про гистограмму сообщала «без `atomicAdd` теряют прибавления», а как именно теряется
 * прибавление и зачем в `HISTOGRAM_WGSL` второй уровень с памятью группы — не показывала.
 * Итоги без атомиков — из докстринга `RACE_WGSL` (прогоны в трёх движках); число атомарных
 * прибавлений в общую память — счёт по коду `HISTOGRAM_WGSL` (16 на группу вместо 64, как
 * в заметке пресета `histogram`). Времени здесь нет: сравнивается число обращений, а не скорость.
 */
export const RACE_SCENE_CODE = `// корзина 3 сейчас равна 7; два вызова одновременно хотят прибавить 1
вызов A:  прочитал bins[3] → 7
вызов B:  прочитал bins[3] → 7
вызов A:  записал 7 + 1 → 8
вызов B:  записал 7 + 1 → 8        // должно было стать 9`;

export const RACE_SCENE_NOTE =
  'Строка `bins[k] = bins[k] + 1u` — это не одно действие, а три: прочитать, прибавить, записать. Между чтением и записью одного вызова успевает пройти чужое чтение — и оба записывают один и тот же ответ. Одно прибавление исчезло без следа: ни ошибки, ни предупреждения. На 65 536 значений и шестнадцать корзин это случается постоянно — в прогонах по разным движкам из 65 536 доходили сотни или десятки тысяч, и каждый раз своё число.';

export const RACE_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: 'Без атомиков',
    when: '`RACE_WGSL`: каждый вызов сам читает и пишет корзину в общем буфере',
    what: 'Шестьдесят пять тысяч вызовов на шестнадцать ячеек — на каждую ячейку тысячи желающих одновременно. Потери зависят от того, как железо разложило вызовы по времени: один и тот же шейдер на другой машине теряет другую долю.',
    cost: 'Неверный результат, который выглядит правдоподобно: корзины не пустые, просто меньше.',
  },
  {
    k: '`atomicAdd` в общий буфер',
    when: 'корзины объявлены `array<atomic<u32>>`, каждый вызов делает `atomicAdd(&bins[k], 1u)`',
    what: 'Чтение, прибавление и запись становятся одним неделимым действием: вызов B увидит уже 8 и запишет 9. Потерь нет.',
    cost: 'Каждое из 65 536 значений — отдельное атомарное обращение к общей памяти, и все они толпятся у шестнадцати ячеек.',
  },
  {
    k: 'Сначала группа, потом общий буфер',
    when: '`HISTOGRAM_WGSL`: у группы свои 16 корзин в `var<workgroup>`',
    what: 'Вызовы группы прибавляют атомарно к **своему столу** — локальной памяти группы. `workgroupBarrier()` ждёт, пока допишут все 64. Потом шестнадцать вызовов переносят по одной корзине в общий буфер — тоже `atomicAdd`: группы между собой не договариваются.',
    cost: 'Атомарных прибавлений в общую память — 16 на группу вместо 64. Условие — барьер, до которого обязаны дойти все вызовы группы, поэтому проверка границы здесь в `if`, а не ранним `return`.',
  },
];

/** «На пальцах»: продолжение бригад из `PLAIN_WORKGROUP`. */
export const PLAIN_RACE =
  'Те же бригады, и все считают голоса на одну общую доску с шестнадцатью графами. Двое подходят к графе «3», оба видят «7», оба стирают и пишут «8» — один голос пропал. Атомик — очередь к графе: пока один пишет, второй ждёт и видит уже новое число. Но очередь к шестнадцати графам на всю стройку длинная. Поэтому бригада сперва считает у себя на столе, дожидается, пока все закончат, и только потом один человек несёт к доске итог по каждой графе.';

export const ADD_REFERENCE = `function reference({ a, b }) {
  const sum = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) sum[i] = a[i] + b[i];   // Uint32Array переполняется как u32
  return sum;
}`;

export const HISTOGRAM_REFERENCE = `function reference({ values }, bins) {
  const out = new Uint32Array(bins);
  for (const v of values) out[v % bins]++;
  return out;
}`;

export const GPU_PRESETS: GpuPreset[] = [
  {
    key: 'add',
    label: 'сложить два массива',
    wgsl: ADD_WGSL,
    reference: ADD_REFERENCE,
    bindings: [
      { binding: 0, type: 'read-only-storage', name: 'a', source: 'a', length: 'n' },
      { binding: 1, type: 'read-only-storage', name: 'b', source: 'b', length: 'n' },
      { binding: 2, type: 'storage', name: 'sum', source: 'zeros', length: 'n', out: true },
    ],
    workgroupSize: 64,
    n: 100_000,
    expect: 'match',
    note: 'Сто тысяч пар случайных `u32`. Суммы, не влезшие в 32 бита, **переполняются одинаково** у GPU и у `Uint32Array` эталона — поэтому сверка точная, а не «примерно». На `f32` так не вышло бы: JS считает в `f64`.',
  },
  {
    key: 'histogram',
    label: 'гистограмма',
    wgsl: HISTOGRAM_WGSL,
    reference: HISTOGRAM_REFERENCE,
    bindings: [
      { binding: 0, type: 'read-only-storage', name: 'values', source: 'values', length: 'n' },
      { binding: 1, type: 'storage', name: 'bins', source: 'zeros', length: 'bins', out: true },
    ],
    workgroupSize: 64,
    n: 65_536,
    bins: 16,
    expect: 'match',
    note: 'Каждая группа сначала считает свои 64 значения на общем столе (`var<workgroup>`), ждёт барьера и только потом шестнадцатью вызовами прибавляет итог к общему буферу. Атомарных прибавлений в общую память — 16 на группу вместо 64.',
  },
  {
    key: 'race',
    label: 'гистограмма без атомиков',
    wgsl: RACE_WGSL,
    reference: HISTOGRAM_REFERENCE,
    bindings: [
      { binding: 0, type: 'read-only-storage', name: 'values', source: 'values', length: 'n' },
      { binding: 1, type: 'storage', name: 'bins', source: 'zeros', length: 'bins', out: true },
    ],
    workgroupSize: 64,
    n: 65_536,
    bins: 16,
    expect: 'mismatch',
    note: 'Тысячи вызовов одновременно читают одну корзину, прибавляют единицу и записывают — и затирают прибавления друг друга. Ни ошибки, ни предупреждения: шейдер корректен, он просто считает не то. Сумма по корзинам показывает, сколько значений потерялось **у вас**.',
  },
  {
    key: 'broken',
    label: 'забыт флаг STORAGE',
    wgsl: ADD_WGSL,
    reference: ADD_REFERENCE,
    bindings: [
      { binding: 0, type: 'read-only-storage', name: 'a', source: 'a', length: 'n' },
      { binding: 1, type: 'read-only-storage', name: 'b', source: 'b', length: 'n' },
      { binding: 2, type: 'storage', name: 'sum', source: 'zeros', length: 'n', out: true, forgetStorage: true },
    ],
    workgroupSize: 64,
    n: 100_000,
    expect: 'error',
    note: 'Буфер результата создан без `GPUBufferUsage.STORAGE`. Ни один вызов не бросил исключения: группа привязок стала «недействительной», отправка — отклонённой, а чтение честно вернуло то, что лежало в буфере для чтения, — нули. Без области ошибок вы узнали бы об этом только по неверным числам.',
  },
];

export const DEMO_NOTE =
  'Демо запускает шейдер **на вашей видеокарте** — по кнопке, не при прокрутке. Код шейдера и эталон на JS — те же строки, что напечатаны на странице. Если WebGPU в браузере нет, этапы покажет модель на JS и честно подпишет, чего она не умеет.';

// ---- Раздел «Чтение результата» ----

export const PLAIN_MAP =
  'Буфер на видеокарте — посылка на складе в другом городе. Посмотреть внутрь нельзя, можно заказать доставку: `mapAsync`. Пока посылка в пути, коробки у вас нет (`pending`), и открыть её нельзя. Привезли (`mapped`) — открываете и **перекладываете содержимое к себе**: `unmap()` увозит коробку обратно, и то, что вы не переложили, уедет вместе с ней.';

export const MAP_STEPS: string[] = [
  '**Результат пишется в буфер со `STORAGE`.** Такой буфер нельзя отобразить в память страницы: флаг `MAP_READ` сочетается только с `COPY_DST`. Попытка `MAP_READ | STORAGE` — ошибка проверки при создании буфера.',
  '**Копия в промежуточный буфер** — `copyBufferToBuffer` в том же энкодере, после прохода. Эта команда тоже записывается и уходит с `submit`.',
  '**`mapAsync(GPUMapMode.READ)`** — промис. `mapState` сразу становится `pending`: `getMappedRange()` в этот момент бросает `OperationError`, а второй `mapAsync` отклоняется тем же `OperationError`. Промис выполнится, когда GPU закончит всю работу, что пишет в этот буфер.',
  '**`getMappedRange()`** даёт `ArrayBuffer`, который смотрит прямо в отображённую память. Скопируйте его (`.slice(0)`) или разберите сразу.',
  '**`unmap()`** возвращает буфер GPU. Полученный `ArrayBuffer` в этот момент обнуляется — `byteLength` 0, как после передачи владения. Пока буфер отображён, отправить команды, которые его трогают, нельзя: «`used in submit while mapped`».',
];

export const MAP_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: '`submit` не ждёт — и ничего не возвращает',
    d: 'Он возвращает `undefined` сразу. Нет способа синхронно спросить GPU «ну что там» — и это не упущение, а цель: `readPixels` в WebGL останавливает поток, пока GPU не догонит, и именно этим он дорог ([«Почему время здесь мерить трудно»](/render/webgl/#s4)). Здесь остановки нет вовсе: поток свободен, пока ждёт промис.',
    tone: 'ok',
  },
  {
    t: '`writeBuffer` копирует сразу',
    d: 'Данные забираются в момент вызова: поменяйте массив сразу после `writeBuffer` — на GPU уедет прежнее содержимое. Проверено: первый элемент входа переписан после вызова, результат сложения посчитан по старому значению во всех трёх движках. Значит, массив можно переиспользовать, не дожидаясь GPU.',
  },
  {
    t: '`onSubmittedWorkDone` и `mapAsync` — без порядка между собой',
    d: '`queue.onSubmittedWorkDone()` — промис «всё отправленное доделано». Кто из двух промисов выполнится первым, не обещано: Chromium и WebKit сначала отдали `onSubmittedWorkDone`, Firefox 155 — `mapAsync`. Ждите того, что вам нужно, а не соседнего.',
    tone: 'warn',
  },
];

// ---- Раздел «Ошибки» ----

export const PLAIN_SCOPE =
  'Область ошибок — это сачок, который вы ставите под участок кода: `pushErrorScope` поставил, `popErrorScope` поднял и посмотрел, что попало. Сачки вкладываются стопкой, и ошибка падает в ближайший подходящего вида. Если сачка нет — она летит на пол, то есть в событие `uncapturederror` и консоль.';

export const ERROR_KINDS = {
  head: ['что', 'как приходит', 'пример из прогонов'],
  rows: [
    ['неверный вызов', '**исключение**, сразу', '`writeBuffer` с размером не кратным 4 → `OperationError`; `getMappedRange()` у неотображённого буфера → `OperationError`'],
    ['неверный объект или команда', '**ничего не бросается**: объект «недействителен», ошибка — в область ошибок', 'группа привязок с буфером без `STORAGE`; `MAP_READ | STORAGE`; второй `submit`'],
    ['следствие прежней ошибки', 'тоже без исключения, со ссылкой на причину', '«`[Invalid BindGroup] is invalid due to a previous error`» — при `setBindGroup`'],
    ['нехватка памяти', 'в область с фильтром `out-of-memory`', 'проверка с фильтром `out-of-memory` ошибку проверки **не ловит** — она ушла дальше по стопке'],
    ['потеря устройства', 'промис `device.lost`', '`destroy()` → `reason: "destroyed"`; после этого вызовы молчат'],
  ],
  cols: 'minmax(160px,.8fr) minmax(200px,1fr) minmax(280px,1.5fr)',
  kinds: ['prose', 'prose', 'muted'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 700,
};

/**
 * Одна ошибка через всю программу сложения. Добавлено по решению автора курса (2026-09-29):
 * `ERROR_KINDS` перечислял виды таблицей, а «недействительность заразна» стояла карточкой
 * без пути. Здесь — пресет демо «забыт флаг STORAGE» по шагам `ADD_HOST_CODE`. Исходы — из
 * заметки пресета `broken` (группа недействительна, отправка отклонена, чтение вернуло нули,
 * ни одного исключения), текст про `setBindGroup` — строка «следствие прежней ошибки»
 * `ERROR_KINDS`, текст Chromium — `ERROR_TEXTS`. Сверх этого ничего не утверждается.
 */
export const BROKEN_SCENE_CODE = `// в addOnGpu забыли один флаг у буфера результата
const bufSum = device.createBuffer({ size: a.byteLength, usage: U.COPY_SRC });
//                                                      было: U.STORAGE | U.COPY_SRC`;

export const BROKEN_SCENE_NOTE =
  'Если бы WebGPU бросал исключение на каждой ошибке, как обычный JS, каждый вызов ждал бы ответа от GPU-процесса, где идёт проверка, — та самая синхронизация, от которой API уходит. Поэтому ошибка здесь не останавливает программу, а **помечает объект**. Программа идёт дальше до конца, и остаётся понять, где именно она свернула не туда.';

export const BROKEN_STEPS: { k: string; when: string; what: string; cost: string }[] = [
  {
    k: '`createBuffer`',
    when: 'буфер создаётся без `STORAGE`',
    what: 'Ошибки нет: буфер с флагом `COPY_SRC` — законный буфер. Он просто не годится для того, что с ним сделают дальше.',
    cost: 'Ничего — пока.',
  },
  {
    k: '`createBindGroup`',
    when: 'буфер кладут в гнездо 2 с типом `storage`',
    what: 'Вот здесь проверка: назначение буфера не совпадает с раскладкой. Chromium формулирует так: «Binding usage (BufferUsage::CopySrc) of [Buffer] doesn\'t match expected usage (BufferUsage::Storage).» Исключения **нет** — группа создана, но недействительна, а ошибка ушла в область ошибок, если её поставили, иначе в `uncapturederror` и консоль.',
    cost: 'Единственное место, где причина названа прямо. Без области ошибок вокруг — легко пропустить.',
  },
  {
    k: '`setBindGroup` и `submit`',
    when: 'запись команд и отправка',
    what: 'Каждый шаг, который пользуется недействительной группой, тоже становится недействительным — с сообщением «is invalid due to a previous error». Отправка отклоняется проверкой. И снова ни одного исключения.',
    cost: 'Цепочка ошибок-следствий, которые указывают друг на друга, а не на забытый флаг.',
  },
  {
    k: '`mapAsync` и чтение',
    when: 'ждём результат',
    what: 'Промис выполняется, `getMappedRange` отдаёт данные — буфер для чтения честно отдаёт то, что в нём лежало: **нули**. Функция возвращает массив нулей.',
    cost: 'Неверный ответ вместо ошибки. Найти причину можно только по первой ошибке в цепочке — поэтому область ошибок ставят вокруг создания объектов.',
  },
];

export const SCOPE_CODE = `device.pushErrorScope('validation');
const group = device.createBindGroup({ layout, entries });
const error = await device.popErrorScope();   // GPUValidationError или null
if (error) report(error.message);

// всё, что ни в одну область не попало
device.addEventListener('uncapturederror', (e) => report(e.error.message));`;

export const SCOPE_FACTS: { t: string; d: string; tone?: 'warn' | 'err' | 'ok' }[] = [
  {
    t: 'Почему не исключения',
    d: 'Проверка идёт не там, где вы: в Chromium — в GPU-процессе, и ответ оттуда асинхронный. Бросить исключение в момент вызова значило бы ждать GPU-процесс на каждом вызове — ровно ту синхронизацию, от которой WebGPU уходит. Поэтому исключение бросают только проверки, которые можно сделать на месте (размер кратен 4, буфер отображён), а остальное приходит промисом.',
  },
  {
    t: 'Недействительность заразна',
    d: 'Объект, созданный с ошибкой, остаётся объектом: его можно передать дальше, и каждый следующий шаг, который им пользуется, тоже станет недействительным. Предустановка «забыт флаг STORAGE» в демо раздела «Вычисления» доводит такую цепочку до конца: исключений ноль, результат — нули.',
    tone: 'err',
  },
  {
    t: 'Лишний `popErrorScope` — исключение',
    d: 'Пустая стопка → промис отклоняется `OperationError` («No error scopes to pop»). Отсюда правило: `push` и `pop` парой в одной функции. Если между ними бросилось синхронное исключение, область осталась в стопке и поймает чужую ошибку.',
    tone: 'warn',
  },
];

export const ERROR_TEXTS = {
  head: ['ошибка', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [
    [
      'буфер без `STORAGE` в группе',
      '«Binding usage (BufferUsage::CopySrc) of [Buffer] doesn\'t match expected usage (BufferUsage::Storage).»',
      '«Usage flags BufferUsages(COPY_SRC) of Buffer with \'\' label do not contain required usage flags BufferUsages(STORAGE)»',
      '«GPUDevice.createBindGroup: Unexpected type(2), buffer.usage(4)»',
    ],
    [
      '`MAP_READ | STORAGE`',
      '«… If a buffer usage contains BufferUsage::MapRead the only other allowed usage is BufferUsage::CopyDst.»',
      '«`MAP` usage can only be combined with the opposite `COPY`»',
      '«Validation failure.»',
    ],
    [
      'в шейдере `c[i]` вместо `b[i]`',
      '9:19 «unresolved value \'c\'»',
      '9:19 «no definition in scope for identifier: `c`»',
      '9:19 «unresolved identifier \'c\'»',
    ],
  ],
  cols: 'minmax(150px,.7fr) minmax(200px,1fr) minmax(200px,1fr) minmax(180px,.9fr)',
  kinds: ['prose', 'muted', 'muted', 'muted'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 820,
};

export const LOST_CODE = `device.lost.then((info) => {
  if (info.reason === 'destroyed') return;   // сами позвали destroy()
  start();   // новый адаптер, новое устройство, все буферы и конвейеры — заново
});`;

export const LOST_NOTE =
  'После потери устройства ничего не бросается: `createBuffer` возвращает объект, область ошибок возвращает `null` — вызовы просто ничего не значат. `mapAsync` отклоняется (`AbortError` в Chromium, `OperationError` в Firefox). Картина та же, что с [потерей контекста WebGL](/render/webgl/#s5), и лечится так же: сборка ресурсов — функция, которую можно позвать второй раз. Разница одна: восстанавливать нужно с **нового адаптера** — в Chromium прежний после `requestDevice` уже «израсходован», и второй запрос отклоняется `OperationError`.';

// ---- Раздел «Поддержка и выбор» ----

export const ENGINE_ROWS = {
  head: ['', 'Chromium 153', 'Firefox 155', 'WebKit 26.6'],
  rows: [
    ['`navigator.gpu`', 'есть', 'есть', 'есть'],
    ['адаптер без окна (headless)', '`null`; с `--enable-unsafe-webgpu` — программный SwiftShader. Полная сборка — Metal', '`null`; с окном — есть', 'есть'],
    ['второй `requestDevice` у того же адаптера', '`OperationError`: «adapter is consumed»', 'выдаёт устройство', 'выдаёт устройство'],
    ['`workgroupBarrier` после раннего `return`', 'ошибка компиляции', '**собирается молча**', 'ошибка компиляции'],
    ['лишняя привязка при `layout: "auto"`', 'ошибка', 'ошибка', 'принята'],
    ['первым выполнился', '`onSubmittedWorkDone`', '`mapAsync`', '`onSubmittedWorkDone`'],
    ['`device.lost.message` после `destroy()`', '«Device was destroyed.»', '«Device destroyed»', 'пустая строка'],
    ['на `http:` не с `localhost`', '`navigator.gpu` — `undefined`', '`undefined`', 'не снято'],
  ],
  cols: 'minmax(170px,1fr) minmax(170px,1fr) minmax(140px,.8fr) minmax(130px,.8fr)',
  kinds: ['prose', 'muted', 'muted', 'muted'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 760,
};

export const ENGINE_NOTE =
  'Совпало во всех трёх движках: результат сложения и гистограммы, последовательность `mapState`, обнуление буфера после `unmap`, `reason: "destroyed"`, позиция ошибки в шейдере, базовые пределы устройства, арифметика из «Тонких мест». Разошлось — то, что в таблице. Строка про адаптер без окна — о браузере без экрана, в котором гоняют автоматические проверки: у читателя с видеокартой адаптер обычно есть. Снято на macOS, сентябрь 2026.';

export const DETECT_CODE = `async function gpuOrNull() {
  if (!navigator.gpu) return null;                    // нет API или не https
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;                          // API есть, видеокарты нет
  return adapter.requestDevice();
}`;

export const CHOOSE_ROWS = {
  head: ['задача', 'чем', 'почему'],
  rows: [
    ['интерфейс, текст, формы', 'DOM и CSS', 'браузер сам решает, что перерисовать; доступность и выделение текста бесплатны'],
    ['диаграмма, несколько тысяч фигур, простая анимация', 'Canvas 2D или SVG', 'хватает процессора; ни шейдеров, ни потери устройства'],
    ['3D-сцена, десятки тысяч объектов, эффекты по пикселям — и нужна вся аудитория', 'WebGL 2 (или библиотека поверх)', 'работает везде, где есть видеокарта, включая старые браузеры и устройства'],
    ['то же, но много смен состояния и вызовов отрисовки', 'WebGPU', 'проверка переезжает в создание конвейеров, запись команд дешевле и её можно вести в воркере'],
    ['вычисления над большими массивами: физика частиц, свёртки, нейросети, сортировка', 'WebGPU compute', 'в WebGL это делают через рисование в текстуру; здесь — прямо: буферы, группы, атомики'],
    ['посчитать немного и сразу', 'JS или WebAssembly', 'дорога до GPU и обратно — буферы, отправка, `mapAsync` — дороже самой работы на малых данных'],
  ],
  cols: 'minmax(220px,1.3fr) minmax(150px,.7fr) minmax(240px,1.3fr)',
  kinds: ['prose', 'mono', 'muted'] as ('mono' | 'prose' | 'muted' | 'ok' | 'warn')[],
  minWidth: 720,
};

// ---- Тонкие места ----

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`navigator.gpu` есть — ещё не значит, что WebGPU работает',
    d: 'Firefox 155 без окна и headless Chromium без флага отдают `navigator.gpu`, но `requestAdapter()` возвращает `null`. Проверять надо адаптер, а не имя: `if (navigator.gpu)` пропустит вас в ветку, где дальше работать нечем.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Ошибки проверки не бросаются',
    d: 'Неверный буфер, неверная группа, недопустимый размер группы — объект создаётся, исключения нет, в консоли в лучшем случае предупреждение. Весь недействительный путь доходит до конца, и результат — нули или мусор. Области ошибок на время разработки — обязательны, а у пользователей — хотя бы `uncapturederror`, отправленный в журнал ошибок.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Текст ошибки — не контракт',
    d: 'Одна и та же ошибка в трёх движках — три разных текста, от подробного абзаца в Chromium до «Validation failure.» в WebKit. Ветвиться можно по типу (`GPUValidationError`, `GPUOutOfMemoryError`) и по `reason` у потери устройства, а не по сообщению. Совпадает только позиция в шейдере: строка и колонка.',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Устройство слабее адаптера',
    d: 'Адаптер Metal обещает 1024 вызова в группе, а устройство без `requiredLimits` даёт 256 — и `@workgroup_size(512)` на нём не соберётся. Chromium в тексте ошибки даже подсказывает, сколько можно попросить. Просить надо явно и только то, что адаптер действительно умеет.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Чтение за краем массива не падает',
    d: 'В WGSL выход за границу не исключение: по спецификации можно получить любое значение из того же буфера или ноль. В проверке `inp[100000]` у массива из восьми элементов вернул **последний элемент** — во всех трёх движках. Шейдер без проверки границы не упадёт, а тихо посчитает по чужим данным.',
    tone: 'err',
  },
  {
    n: '06',
    t: 'Барьер в неоднородном потоке управления',
    d: '`workgroupBarrier()` обязаны достичь все вызовы группы. Ранний `return` по `global_invocation_id` перед барьером нарушает это — Chromium и WebKit отказываются компилировать («must only be called from uniform control flow»), а **Firefox 155 собирает молча**. Шейдер, проверенный только в Firefox, сломается у остальных. Поэтому в гистограмме выше проверка границы обёрнута в `if`, а не сделана `return`.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Без атомиков прибавления теряются',
    d: '`bins[k] = bins[k] + 1u` из тысяч вызовов сразу — это гонка: на 65 536 значениях демо Chromium с Metal насчитал 364, WebKit — 394, Firefox — 323. Ни ошибки, ни предупреждения. `atomicAdd` решает, но дорог при споре за одну ячейку — отсюда приём с локальной гистограммой в `var<workgroup>`.',
    tone: 'err',
  },
  {
    n: '08',
    t: 'После `unmap()` данных больше нет',
    d: '`ArrayBuffer` из `getMappedRange()` смотрит в отображённую память и при `unmap()` обнуляется: `byteLength` 0. Кто сохранил ссылку «на потом», получит пустой массив. Копия — `.slice(0)` — до `unmap()`.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`MAP_READ` — только с `COPY_DST`',
    d: 'Отобразить для чтения буфер, в который пишет шейдер, нельзя: `MAP_READ | STORAGE` — ошибка проверки. Нужен второй буфер и `copyBufferToBuffer`. Это не бюрократия: так GPU пишет в свою быструю память, а страница читает из той, что ей доступна.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Одноразовое: командный буфер, энкодер после `finish()`, адаптер в Chromium',
    d: 'Второй `submit` того же буфера отклоняется, `beginComputePass` у завершённого энкодера — «`is already finished`», и ни то ни другое не бросает. Адаптер после `requestDevice` в Chromium «израсходован» — после потери устройства начинать надо с `requestAdapter()`.',
    tone: 'warn',
  },
  {
    n: '11',
    t: 'Размер записи кратен четырём',
    d: '`writeBuffer` с тремя байтами бросает `OperationError` во всех трёх движках, это из тех немногих проверок, что делаются на месте. Если такой вызов стоит между `pushErrorScope` и `popErrorScope`, область останется в стопке и поймает чужую ошибку.',
    tone: 'warn',
  },
  {
    n: '12',
    t: '`f32` — не `number`',
    d: '`0.1 + 0.2` в шейдере — 0.30000001192092896, в JS — 0.30000000000000004. Сравнивать результат GPU с расчётом на JS надо через `Math.fround` или допуск, а суммы многих чисел ещё и зависят от порядка сложения, который у параллельного кода не ваш. Подпороговые числа (1e-40) в проверке сохранились, но спецификация разрешает обнулять их — рассчитывать на них нельзя.',
    tone: 'warn',
  },
  {
    n: '13',
    t: 'Целочисленная арифметика не бросает',
    d: '`0xFFFFFFFFu + 1u` = 0: переполнение заворачивается. `7u / 0u` = 7, `7u % 0u` = 0 — так велит спецификация, а не «неопределённое поведение», и так вышло во всех трёх движках. JS на том же даст `Infinity` и `NaN`: эталон для сверки обязан повторять правила `u32`, как `Uint32Array` в демо.',
  },
  {
    n: '14',
    t: 'Порядок промисов между собой не обещан',
    d: '`onSubmittedWorkDone()` и `mapAsync()` в Chromium выполнились в одном порядке, в Firefox — в обратном. Код, который по первому решает, что готово второе, работает в одном браузере.',
    tone: 'warn',
  },
];

// ---- Источники ----

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'WebGPU — спецификация W3C',
    href: 'https://www.w3.org/TR/webgpu/',
    what: 'Первоисточник: адаптер и устройство, «израсходованный» адаптер, пределы по умолчанию, области ошибок, `mapAsync` и состояния отображения, потеря устройства.',
  },
  {
    title: 'WebGPU Shading Language (WGSL) — спецификация W3C',
    href: 'https://www.w3.org/TR/WGSL/',
    what: 'Язык: абстрактные литералы, атомики, память `workgroup`, анализ однородности для барьеров, правила целочисленного деления на ноль и выхода за границу массива.',
  },
  {
    title: 'WebGPU Explainer',
    href: 'https://gpuweb.github.io/gpuweb/explainer/',
    what: 'Почему API устроен так: асинхронные ошибки, проверка при создании объектов, отказ от глобального состояния.',
  },
  {
    title: 'MDN: WebGPU API',
    href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API',
    what: 'Справочник по интерфейсам и таблица поддержки по браузерам и платформам.',
  },
  {
    title: 'WebGPU Fundamentals',
    href: 'https://webgpufundamentals.org/',
    what: 'Практика: вычислительные шейдеры, гистограмма на рабочих группах, раскладка привязок — с живыми примерами.',
  },
  {
    title: 'Dawn — реализация WebGPU в Chromium',
    href: 'https://dawn.googlesource.com/dawn',
    what: 'Откуда берутся тексты ошибок Chromium и компилятор Tint, переводящий WGSL в язык платформы.',
  },
];

export const RELATED =
  'Смежное на сайте: [WebGL и конвейер GPU](/render/webgl/) — сам конвейер, шейдеры, цена вызова отрисовки, потеря контекста. [Кадр браузера](/render/render-pipeline/) — где в кадре оказывается канвас. [Воркеры и параллелизм](/js/workers/) — офскрин-канвас и куда уносить запись команд. [Устройство браузера](/js/browser-architecture/) — GPU-процесс, в котором на самом деле идёт проверка.';
