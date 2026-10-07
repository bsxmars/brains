import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { RouteScenario } from '@/widgets/ing-router/model/types';

/**
 * Данные темы «Вход в кластер: Ingress и Gateway API».
 *
 * ── Что чем проверено ────────────────────────────────────────────────────────────────
 *
 * Кластер **не поднимался**: ни `kubectl`, ни контроллера входа, ни сети в этом заходе
 * не было. Поэтому тема держится на двух опорах, и у каждой строки ниже написано, на какой.
 *
 * 1. **Правила выбора бэкенда — кодом.** `ROUTER_CODE` — учебная функция, написанная
 *    по спецификациям: для Ingress — «Ingress → Path types / Multiple matches / Hostname
 *    wildcards» (kubernetes.io), для HTTPRoute — справочник API Gateway API (`HTTPRouteRule`,
 *    `HTTPRouteMatch`, `HTTPPathModifier`, `HTTPBackendRef`). Строка напечатана в теме,
 *    исполняется демо (`widgets/ing-router/model/run.ts` собирает её `new Function`)
 *    и тестом `tests/unit/ingress.test.ts`. Тест прогоняет через неё таблицы примеров
 *    **из самих спецификаций** — `PATH_EXAMPLES` (таблица pathType из документации Ingress),
 *    `HOST_EXAMPLES` (таблица звёздочек оттуда же) и `REWRITE_EXAMPLES` (таблица
 *    `ReplacePrefixMatch` из справочника Gateway API) — и сверяет ответ с литералом.
 *    ⚠️ Таблицы перенесены без доступа к сети в этом заходе: сверить их с живой страницей
 *    документации заново было нечем. Если строка разойдётся с документацией — править
 *    литерал и смотреть, краснеет ли функция.
 * 2. **Всё остальное — по документации, не прогоном**: умолчания ingress-nginx
 *    (`proxy-body-size` 1m, таймауты 60 с, редирект 308 на HTTPS), поведение cert-manager,
 *    статус ingress-nginx и заморозка Ingress API, уровни поддержки Gateway API. Листинги
 *    разбираются тестом как YAML (синтаксис, `apiVersion`/`kind`, согласованность имён
 *    сервисов, портов, классов, секретов и ссылок между Gateway и HTTPRoute), но в кластер
 *    не применялись.
 *
 * ── Что модель не умеет, и это сказано в теме ────────────────────────────────────────
 *
 *   — `ImplementationSpecific` и регулярные выражения: их смысл задаёт контроллер;
 *   — приоритет хостов **внутри Ingress** (точный → со звёздочкой → без `host`): спецификация
 *     Ingress его не называет, модель берёт порядок Gateway API и nginx — помечено в `HOST_NOTE`;
 *   — слияние нескольких Ingress на одном хосте и сравнение нескольких HTTPRoute между собой
 *     (по времени создания и имени): модель смотрит на один объект;
 *   — метод запроса в `matches`;
 *   — веса раздаются детерминированным кругом, а не случайно — сказано в `CANARY_NOTE`.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Вводный раздел
// ─────────────────────────────────────────────────────────────────────────────────────

export const INTRO_NOTE =
  'Сервис в Kubernetes знает адрес и порт, но не знает ни хоста, ни пути: `shop.example.com/api` и `admin.example.com/` для него одно и то же соединение. Чтобы один внешний адрес раздавал запросы разным приложениям по HTTP-признакам, нужен **вход** — прокси, который читает запрос и выбирает сервис по правилам. Правила описывают объектом **Ingress** или ресурсами **Gateway API**, а исполняет их отдельная программа — контроллер входа. Отсюда почти все сюрпризы темы. Правило «совпадения пути» не совпадает со строковым префиксом. Правило без контроллера ничего не делает и ни на что не жалуется. А половина настроек живёт не в правилах, а в аннотациях, которые понимает только один контроллер.';

/** Вход в кластер — во вводном разделе, сразу под тезисом темы. */
export const PLAIN_ENTRY =
  'Кластер — бизнес-центр. У каждой фирмы внутри есть свой добавочный номер (сервис), но с улицы по добавочному не дозвониться. На входе сидит ресепшн — контроллер входа — с табличкой: «доставка для „Магазина“ — на третий этаж, всё с пометкой „бухгалтерия“ — на пятый». Ingress и HTTPRoute — это и есть табличка. Повесить табличку можно, даже если ресепшн пуст, — только читать её будет некому.';

export const GLOSSARY = [
  {
    k: 'контроллер входа',
    d: 'Прокси (nginx, Envoy, HAProxy, Traefik), запущенный в кластере как обычные поды, плюс программа, которая следит за объектами Ingress или Gateway API и перестраивает конфигурацию прокси. В сам Kubernetes не входит — его ставят отдельно.',
  },
  {
    k: 'L4 и L7',
    d: 'Уровни, на которых работает посредник. На L4 он видит адрес и порт и пересылает соединение целиком, не читая его. На L7 он разбирает HTTP: хост, путь, заголовки — и может решать по ним. Сервис Kubernetes — L4, контроллер входа — L7.',
  },
  {
    k: 'бэкенд',
    d: 'Куда вход отправляет запрос. В Ingress и HTTPRoute это почти всегда сервис с портом: `api:8080`. Сами адреса подов вход берёт из списка адресов этого сервиса.',
  },
  {
    k: 'хост',
    d: 'Имя сайта из запроса: заголовок `Host` в HTTP/1.1 или `:authority` в HTTP/2. По нему один адрес обслуживает много сайтов. При TLS имя приходит ещё раньше — в SNI, до расшифровки.',
  },
  {
    k: 'TLS-терминация',
    d: 'Место, где зашифрованное соединение расшифровывается. Обычно это вход: снаружи HTTPS, внутри кластера до пода — обычный HTTP. Приложение о шифровании узнаёт только из заголовков, которые добавил вход.',
  },
  {
    k: 'SNI',
    d: 'Server Name Indication — имя сайта, которое клиент называет в самом начале TLS-рукопожатия. По нему вход выбирает, какой сертификат показать, когда на одном адресе живут несколько сайтов.',
  },
  {
    k: 'Secret',
    d: 'Объект Kubernetes для чувствительных данных. Сертификат для входа лежит в Secret типа `kubernetes.io/tls` двумя ключами: `tls.crt` и `tls.key`.',
  },
  {
    k: 'аннотация',
    d: 'Произвольная пара «ключ — строка» в `metadata.annotations`. Kubernetes её не проверяет и не понимает — читает тот, кто знает ключ. Поэтому опечатка в аннотации не ошибка, а просто ничего.',
  },
  {
    k: 'CRD',
    d: 'Custom Resource Definition — способ добавить в кластер новый вид объектов. Gateway API устроен именно так: `Gateway` и `HTTPRoute` появляются в кластере только после установки их CRD.',
  },
  {
    k: 'канарейка',
    d: 'Выкат, при котором новая версия получает малую долю запросов — скажем, 10%, — а остальные идут на старую. Если новая ведёт себя плохо, пострадали немногие.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Перед началом
// ─────────────────────────────────────────────────────────────────────────────────────

export const PREREQ_NOTE =
  'Вход стоит последним звеном цепочки: он выбирает сервис, а дальше работает то, что уже устроено в кластере.';

export const PREREQ = [
  {
    t: 'Сервис — имя поверх списка адресов',
    d: 'Ingress и HTTPRoute ссылаются не на поды, а на сервис. Как сервис находит поды по меткам и почему опечатка в селекторе даёт пустой список без единой ошибки, здесь не повторяется.',
    href: '/delivery/kubernetes/#s2',
    hrefLabel: 'Kubernetes: развёртывание — «Сервис»',
    tone: 'info' as const,
  },
  {
    t: 'Readiness-проба решает, кому достаются запросы',
    d: 'Вход шлёт запросы только на поды из списка адресов, а в список попадает под, прошедший readiness-пробу. Нет пробы — вход честно отправит запрос в ещё не проснувшийся под.',
    href: '/delivery/kubernetes/#s3',
    hrefLabel: 'Kubernetes: развёртывание — «Пробы»',
    tone: 'warn' as const,
  },
  {
    t: 'Заголовки кеша и кто их ставит',
    d: '`Cache-Control`, валидация и `ETag` — предмет отдельного разбора. Здесь важно одно: вход может их переписать, но решать, что кешировать, должен тот, кто знает имена файлов.',
    href: '/platform/network/#s2',
    hrefLabel: 'Сеть и кеширование — «Кеш и валидация»',
    tone: 'info' as const,
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 1 — путь запроса снаружи
// ─────────────────────────────────────────────────────────────────────────────────────

export const PATH_STEPS = [
  '**DNS.** Имя `shop.example.com` указывает на внешний адрес. Обычно это облачный балансировщик, который создан сервисом типа `LoadBalancer` — у **самого контроллера входа**, а не у вашего приложения.',
  '**Балансировщик (L4).** Принимает TCP-соединение и пересылает его на узлы или поды контроллера. HTTP он не читает: хост и путь для него — зашифрованные байты.',
  '**Контроллер входа (L7).** Расшифровывает TLS, читает хост и путь, находит подходящее правило Ingress или HTTPRoute и выбирает бэкенд — сервис с портом.',
  '**Список адресов сервиса.** Из EndpointSlice этого сервиса контроллер берёт адреса готовых подов. ingress-nginx по умолчанию шлёт запрос **прямо поду**, минуя адрес сервиса (`ClusterIP`); сервис здесь нужен как источник списка, а не как пересыльщик.',
  '**Под** отвечает, и ответ идёт обратно той же дорогой.',
];

export const SERVICE_TYPES_NOTE =
  'Магазин, админка и API живут в одном кластере, и каждому нужен выход наружу. Сервис типа `LoadBalancer` на каждое приложение — это отдельный внешний адрес и отдельный счёт за балансировщик на каждый сайт. И всё равно ни один из них не отличит `/api` от `/`: все типы сервиса — `ClusterIP`, `NodePort` и `LoadBalancer` — работают на L4 и видят только адрес и порт (сами типы разобраны в [разделе «Сервис»](/delivery/kubernetes/#s2) темы про Kubernetes). Ingress и Gateway API решают именно это: **один** внешний адрес на весь кластер и выбор приложения по хосту и пути.';

export const LAYERS = {
  head: ['Звено', 'Что видит', 'Что решает', 'Где настраивается'],
  rows: [
    ['DNS', 'имя', 'на какой внешний адрес идти', 'у регистратора или в облаке'],
    ['балансировщик', 'адрес и порт', 'на какой узел переслать соединение', 'сервис `LoadBalancer` контроллера'],
    ['контроллер входа', 'SNI, хост, путь, заголовки, параметры', 'какой сертификат показать и в какой сервис отправить', '**Ingress** или **Gateway + HTTPRoute**'],
    ['сервис', 'метки и готовность подов', 'какие поды входят в список адресов', 'Service и readiness-проба'],
  ],
  cols: 'minmax(130px,.7fr) minmax(170px,1fr) minmax(210px,1.3fr) minmax(190px,1.1fr)',
  kinds: ['mono', 'prose', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 760,
};

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 2 — Ingress: хост, путь, выбор
// ─────────────────────────────────────────────────────────────────────────────────────

export const INGRESS_WHY =
  'Ingress — объект API `networking.k8s.io/v1`: список правил «хост и путь → сервис и порт», плюс сертификаты и бэкенд по умолчанию. Сам он ничего не принимает и никуда не пересылает. Это **описание**, которое контроллер входа превращает в конфигурацию своего прокси.';

/** Главный листинг Ingress. Имена и порты сверяет тест; куда уходят запросы — `INGRESS_ROUTES`. */
export const INGRESS_CODE = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
spec:
  ingressClassName: nginx          # какой контроллер исполняет эти правила
  tls:
    - hosts: [shop.example.com]
      secretName: shop-tls         # сертификат и ключ — в Secret
  defaultBackend:                  # куда всё, что не совпало ни с одним путём
    service: { name: web, port: { number: 80 } }
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix       # /api, /api/, /api/orders — но не /apiary
            backend:
              service: { name: api, port: { number: 8080 } }
          - path: /
            pathType: Prefix       # всё остальное на этом хосте
            backend:
              service: { name: web, port: { number: 80 } }`;

/** Куда уходят запросы по `INGRESS_CODE`. Столбец «куда» пересчитывает тест той же функцией. */
export const INGRESS_ROUTES = {
  head: ['Запрос', 'Куда', 'Почему'],
  rows: [
    ['`https://shop.example.com/api/orders`', '`api:8080`', 'совпали `/api` и `/`, выбран более длинный путь'],
    ['`https://shop.example.com/apiary`', '`web:80`', '`/api` сравнивается по сегментам: `apiary` — не `api`'],
    ['`https://shop.example.com/`', '`web:80`', 'совпал только `/`'],
    ['`https://admin.example.com/`', '`web:80`', 'хост не подошёл ни к одному правилу — сработал `defaultBackend`'],
  ],
  cols: 'minmax(250px,1.3fr) minmax(100px,.5fr) minmax(250px,1.4fr)',
  kinds: ['mono', 'mono', 'muted'] as ('mono' | 'muted')[],
  minWidth: 680,
};

/** Сегменты пути — сразу под листингом, где `Prefix` встречается впервые. */
export const PLAIN_PREFIX =
  '`Prefix` сравнивает путь не по буквам, а по словам между косыми чертами — как почтальон читает адрес: «ул. Ленина» совпадает с «ул. Ленина, д. 5», но не с «ул. Ленинградской», хотя буквы в начале одни и те же. `/api` — одно слово `api`, и `/apiary` с ним не совпадает, а `/api/orders` — совпадает.';

export const PATH_TYPES = {
  head: ['`pathType`', 'Как сравнивает', 'Где подводит'],
  rows: [
    ['`Exact`', 'Путь целиком, с учётом регистра. `/foo` — это только `/foo`', 'завершающий слэш: `/foo/` уже **другой** путь'],
    ['`Prefix`', 'По сегментам между `/`, с учётом регистра. `/foo` совпадает с `/foo`, `/foo/` и `/foo/bar`, но не с `/foobar`. Слэш в конце правила ничего не меняет', 'ждут строкового префикса и удивляются, что `/api` не ловит `/apiv2`'],
    ['`ImplementationSpecific`', 'Как решит контроллер: у ingress-nginx это может быть регулярное выражение', 'переносимости нет: смысл пути меняется вместе с контроллером'],
  ],
  cols: 'minmax(170px,.8fr) minmax(280px,1.6fr) minmax(220px,1.1fr)',
  kinds: ['mono', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 720,
};

export const MATCH_STEPS = [
  'Выбрать правила по хосту. Правило без `host` подходит к любому хосту; `*.foo.com` — к хосту ровно на одну метку длиннее.',
  'Сравнить путь запроса с каждым путём этих правил — по его `pathType`.',
  'Если совпало несколько, выиграет **самый длинный** путь правила.',
  'При равной длине `Exact` сильнее `Prefix`.',
  'Не совпало ничего — запрос уходит в `defaultBackend`. Если его нет, ответ решает контроллер: ingress-nginx отдаёт 404 от собственного бэкенда по умолчанию.',
];

/**
 * Таблица примеров pathType из документации Ingress («Examples»). Каждый случай — один
 * запрос. `want` — имя бэкенда, выбранного функцией: пути правил пронумерованы `p0`, `p1`…
 * в порядке записи, `default` — бэкенд по умолчанию. Столбец «совпадёт?» — формулировка
 * документации. ⚠️ Перенесено без повторной сверки с живой страницей (сети в заходе не было).
 */
export const PATH_EXAMPLES: {
  kind: string;
  paths: { path: string; type: 'Exact' | 'Prefix' }[];
  request: string;
  want: string;
  verdict: string;
}[] = [
  { kind: 'Prefix', paths: [{ path: '/', type: 'Prefix' }], request: '/anything/at/all', want: 'p0', verdict: 'да, `/` совпадает со всеми путями' },
  { kind: 'Exact', paths: [{ path: '/foo', type: 'Exact' }], request: '/foo', want: 'p0', verdict: 'да' },
  { kind: 'Exact', paths: [{ path: '/foo', type: 'Exact' }], request: '/bar', want: 'default', verdict: 'нет' },
  { kind: 'Exact', paths: [{ path: '/foo', type: 'Exact' }], request: '/foo/', want: 'default', verdict: 'нет' },
  { kind: 'Exact', paths: [{ path: '/foo/', type: 'Exact' }], request: '/foo', want: 'default', verdict: 'нет' },
  { kind: 'Prefix', paths: [{ path: '/foo', type: 'Prefix' }], request: '/foo', want: 'p0', verdict: 'да' },
  { kind: 'Prefix', paths: [{ path: '/foo', type: 'Prefix' }], request: '/foo/', want: 'p0', verdict: 'да' },
  { kind: 'Prefix', paths: [{ path: '/foo/', type: 'Prefix' }], request: '/foo', want: 'p0', verdict: 'да' },
  { kind: 'Prefix', paths: [{ path: '/foo/', type: 'Prefix' }], request: '/foo/', want: 'p0', verdict: 'да' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bb', type: 'Prefix' }], request: '/aaa/bbb', want: 'default', verdict: 'нет' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bbb', type: 'Prefix' }], request: '/aaa/bbb', want: 'p0', verdict: 'да' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bbb/', type: 'Prefix' }], request: '/aaa/bbb', want: 'p0', verdict: 'да, слэш в конце правила не мешает' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bbb', type: 'Prefix' }], request: '/aaa/bbb/', want: 'p0', verdict: 'да, слэш в конце запроса не мешает' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bbb', type: 'Prefix' }], request: '/aaa/bbb/ccc', want: 'p0', verdict: 'да, вложенный путь' },
  { kind: 'Prefix', paths: [{ path: '/aaa/bbb', type: 'Prefix' }], request: '/aaa/bbbxyz', want: 'default', verdict: 'нет: строковый префикс не считается' },
  {
    kind: 'Prefix',
    paths: [{ path: '/', type: 'Prefix' }, { path: '/aaa', type: 'Prefix' }],
    request: '/aaa/ccc',
    want: 'p1',
    verdict: 'да, по префиксу `/aaa`',
  },
  {
    kind: 'Prefix',
    paths: [{ path: '/', type: 'Prefix' }, { path: '/aaa', type: 'Prefix' }, { path: '/aaa/bbb', type: 'Prefix' }],
    request: '/aaa/bbb',
    want: 'p2',
    verdict: 'да, по префиксу `/aaa/bbb`',
  },
  {
    kind: 'Prefix',
    paths: [{ path: '/', type: 'Prefix' }, { path: '/aaa', type: 'Prefix' }, { path: '/aaa/bbb', type: 'Prefix' }],
    request: '/ccc',
    want: 'p0',
    verdict: 'да, по префиксу `/`',
  },
  { kind: 'Prefix', paths: [{ path: '/aaa', type: 'Prefix' }], request: '/ccc', want: 'default', verdict: 'нет, уходит в бэкенд по умолчанию' },
  {
    kind: 'смешанный',
    paths: [{ path: '/foo', type: 'Prefix' }, { path: '/foo', type: 'Exact' }],
    request: '/foo',
    want: 'p1',
    verdict: 'да, выигрывает `Exact`',
  },
];

/** То же, строками таблицы. Собрано из `PATH_EXAMPLES`, чтобы на странице и в тесте был один список. */
export const PATH_TABLE = {
  head: ['Вид', 'Пути правила', 'Запрос', 'Совпадёт?'],
  rows: PATH_EXAMPLES.map((e) => [
    e.kind,
    e.paths.map((p) => (e.paths.length > 1 && e.kind === 'смешанный' ? `\`${p.path}\` ${p.type}` : `\`${p.path}\``)).join(', '),
    `\`${e.request}\``,
    e.verdict,
  ]),
  cols: 'minmax(100px,.5fr) minmax(190px,1fr) minmax(140px,.8fr) minmax(210px,1.2fr)',
  kinds: ['muted', 'mono', 'mono', 'prose'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 680,
};

/** Таблица звёздочек из документации Ingress («Hostname wildcards»). */
export const HOST_EXAMPLES = [
  { rule: '*.foo.com', host: 'bar.foo.com', match: true, verdict: 'да: общий суффикс, одна метка перед ним' },
  { rule: '*.foo.com', host: 'baz.bar.foo.com', match: false, verdict: 'нет: звёздочка закрывает ровно одну метку' },
  { rule: '*.foo.com', host: 'foo.com', match: false, verdict: 'нет: метки перед суффиксом нет вовсе' },
];

export const HOST_TABLE = {
  head: ['`host` правила', 'Хост запроса', 'Совпадёт?'],
  rows: HOST_EXAMPLES.map((e) => [`\`${e.rule}\``, `\`${e.host}\``, e.verdict]),
  cols: 'minmax(140px,.7fr) minmax(170px,.9fr) minmax(260px,1.5fr)',
  kinds: ['mono', 'mono', 'prose'] as ('mono' | 'prose')[],
  minWidth: 600,
};

export const HOST_NOTE =
  'Чего спецификация Ingress **не говорит**: что делать, если к запросу подошли и правило с точным хостом, и правило со звёздочкой, и правило без хоста. Учебная функция темы берёт порядок, который задаёт Gateway API и которому следует nginx: точный хост, потом звёздочка, потом правило без хоста. Если у вас другой контроллер — сверяйтесь с его документацией. То же с несколькими Ingress на одном хосте: как их правила сливаются, решает контроллер, а не спецификация.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 3 — класс, контроллер, аннотации
// ─────────────────────────────────────────────────────────────────────────────────────

export const CONTROLLER_WHY =
  'В кластере без контроллера входа Ingress создаётся без единой жалобы: API-сервер проверит схему, запишет объект — и всё. У объекта будет пустое поле адреса (`ADDRESS` в `kubectl get ingress`), и больше ничего не произойдёт. Контроллер находит «свои» объекты по классу. Класс — это объект `IngressClass`, у которого в `spec.controller` записано имя реализации, а Ingress ссылается на класс полем `ingressClassName`.';

export const INGRESS_CLASS_CODE = `apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  name: nginx
  annotations:
    # класс по умолчанию: его получат Ingress без ingressClassName
    ingressclass.kubernetes.io/is-default-class: "true"
spec:
  controller: k8s.io/ingress-nginx   # имя, по которому контроллер узнаёт свои объекты`;

export const CLASS_FACTS = [
  {
    t: 'Ingress без класса может остаться ничьим',
    d: 'Если `ingressClassName` не указан и класса по умолчанию в кластере нет, объект не принадлежит никому. ingress-nginx начиная с версии 1.0 такие объекты по умолчанию **пропускает** — нужен класс или флаг `--watch-ingress-without-class`. По документации ingress-nginx.',
    tone: 'err' as const,
  },
  {
    t: 'Старая аннотация класса',
    d: 'До `networking.k8s.io/v1` класс писали аннотацией `kubernetes.io/ingress.class`. Она объявлена устаревшей; в старых манифестах и чартах встречается до сих пор, и часть контроллеров её ещё читает. Новые манифесты — только `ingressClassName`.',
    tone: 'warn' as const,
  },
  {
    t: 'Два контроллера в одном кластере — законно',
    d: 'Скажем, внешний и внутренний вход с разными адресами. Разводят их классы: у каждого своё имя в `spec.controller`, и каждый Ingress говорит, к какому он относится.',
  },
];

export const ANNOTATIONS_WHY =
  'Спецификация Ingress умеет ровно хост, путь, бэкенд и TLS. Всё остальное, без чего живой сайт не обходится, — лимит тела запроса, таймауты, переписывание пути, редиректы, канарейка, CORS, ограничение частоты — контроллеры добавляют **аннотациями**. У каждого контроллера свой набор ключей, и другой контроллер чужие ключи молча игнорирует.';

/** Аннотации ingress-nginx. ⚠️ Умолчания — по документации ingress-nginx, не прогоном. */
export const ANNOTATIONS_CODE = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: files
  annotations:
    # значения аннотаций — всегда строки: 3600 без кавычек YAML прочтёт числом
    nginx.ingress.kubernetes.io/proxy-body-size: "20m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /$2
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /files(/|$)(.*)            # регулярное выражение, а не префикс
            pathType: ImplementationSpecific
            backend:
              service: { name: files, port: { number: 8080 } }`;

export const ANNOTATIONS = {
  head: ['Аннотация ingress-nginx', 'Умолчание', 'Что ломается без неё'],
  rows: [
    ['`proxy-body-size`', '`1m`', 'загрузка файла больше мегабайта получает **413** от входа, а приложение запроса даже не видит'],
    ['`proxy-read-timeout`, `proxy-send-timeout`', '60 с', 'WebSocket или долгий стрим, молчащий минуту, обрывается входом'],
    ['`rewrite-target` + `use-regex`', 'нет', 'бэкенд получает путь вместе с префиксом `/files` и отвечает 404'],
    ['`ssl-redirect`', '`true`, если есть `tls`', 'HTTP-запросы получают **308** на HTTPS — в том числе health-check балансировщика, если он ходит по HTTP'],
    ['`canary`, `canary-weight`, `canary-by-header`', 'нет', 'второй Ingress с теми же хостом и путём вместо канарейки становится конфликтом'],
  ],
  cols: 'minmax(220px,1.1fr) minmax(110px,.5fr) minmax(280px,1.6fr)',
  kinds: ['mono', 'mono', 'prose'] as ('mono' | 'prose')[],
  minWidth: 720,
};

export const PORTABILITY_NOTE =
  'Отсюда главный изъян Ingress: **переносима только его простая часть**. Правила хоста и пути поймёт любой контроллер, а аннотации — только тот, для которого они написаны. Сменили ingress-nginx на Traefik или на вход облачного провайдера — объект применится без ошибок, а лимит тела, таймауты и переписывание пути тихо исчезнут. Никакого предупреждения не будет: для другого контроллера это просто незнакомые строки в метаданных.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 4 — TLS и сертификаты
// ─────────────────────────────────────────────────────────────────────────────────────

export const TLS_WHY =
  'Секция `tls` в Ingress говорит: для этих хостов расшифровывай на входе вот этим сертификатом. Сертификат и ключ лежат в Secret типа `kubernetes.io/tls` (ключи `tls.crt` и `tls.key`) в том же пространстве имён, что и Ingress. Если на одном адресе несколько сайтов, вход выбирает сертификат по SNI. Спецификация Ingress знает только порт 443 и только терминацию на входе. Дальше, до пода, идёт обычный HTTP.';

export const TLS_BEHIND_NOTE =
  'Что это значит для приложения: **оно не знает, что запрос пришёл по HTTPS**. Соединение до него — обычный HTTP от пода контроллера. Схему и адрес клиента вход передаёт заголовками `X-Forwarded-Proto` и `X-Forwarded-For`. Если сервер приложения им не доверяет, он строит абсолютные ссылки и редиректы с `http://`, а куку с `Secure` может не выставить вовсе. В Express за это отвечает `app.set(\'trust proxy\', …)`, в других серверах — похожая настройка.';

/** cert-manager — в начале подраздела про сертификаты. */
export const PLAIN_CERT =
  'cert-manager — секретарь, который следит за сроками пропусков. Вы говорите ему: «для `shop.example.com` пропуск нужен всегда». Он сам сходит в бюро пропусков (Let\'s Encrypt), докажет, что сайт ваш, положит пропуск в сейф (Secret) и за месяц до истечения повторит всё заново. Вход только берёт пропуск из сейфа и не знает, кто его туда положил.';

export const CERT_WHY =
  '**cert-manager** — отдельный контроллер (проект CNCF), который выпускает сертификаты и продлевает их. Центр сертификации описывают объектом `Issuer` или `ClusterIssuer`. Чаще всего это Let\'s Encrypt по протоколу ACME. Дальше достаточно одной аннотации на Ingress: cert-manager увидит её, создаст объект `Certificate` на хосты из секции `tls` и положит результат в Secret с именем из `secretName`.';

/** ⚠️ По документации cert-manager; в кластер не применялось. */
export const CERT_CODE = `apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef:
      name: letsencrypt-account     # ключ учётной записи ACME, а не сертификата
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx # проверку домена пройдёт через тот же вход
---
# на самом Ingress — одна аннотация; spec тот же, что в листинге выше
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt`;

export const CERT_FACTS = [
  {
    t: 'HTTP-01 или DNS-01',
    d: 'HTTP-01 доказывает владение доменом ответом по адресу `/.well-known/acme-challenge/…` — cert-manager поднимает для этого временный Ingress. Сертификат **со звёздочкой** так не получить: Let\'s Encrypt выдаёт их только через DNS-01, то есть cert-manager должен уметь писать записи в ваш DNS.',
    tone: 'warn' as const,
  },
  {
    t: 'Продление — само, но не мгновенно',
    d: 'Если `renewBefore` не задан, cert-manager продлевает сертификат, когда прошло две трети срока: у 90-дневного сертификата Let\'s Encrypt это примерно за 30 дней до конца. Сломанное продление видно в `kubectl describe certificate` задолго до того, как сайт перестанет открываться, — если туда смотреть.',
  },
  {
    t: 'Для экспериментов — тестовый сервер',
    d: 'У Let\'s Encrypt есть лимиты на выпуск сертификатов для одного домена. Отлаживая настройку, указывайте в `server` адрес staging-сервера: его сертификаты браузер не примет, зато лимиты у него гораздо щедрее.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 5 — Gateway API
// ─────────────────────────────────────────────────────────────────────────────────────

export const GATEWAY_WHY =
  'Gateway API — следующее поколение того же входа, и делает его та же рабочая группа SIG Network. Основные ресурсы — `GatewayClass`, `Gateway` и `HTTPRoute` — стабильны с версии v1.0 (октябрь 2023). Два отличия от Ingress важнее остальных. Первое: **то, что было аннотациями, стало полями** — заголовки, параметры запроса, веса, редиректы, переписывание пути. Второе: **объект разрезан по ролям** — вход настраивает одна команда, маршруты другая.';

/** Разделение ролей — сразу под тезисом о ролях. */
export const PLAIN_ROLES =
  'Ingress — одна табличка на ресепшне, которую правят все арендаторы сразу: кто-то поменял часы работы входа, а сломалось у соседа. В Gateway API табличек три. Управляющая компания решает, какой будет ресепшн (`GatewayClass`). Администрация здания — какие двери открыты и с какими замками (`Gateway`: порты, протоколы, сертификаты, кому можно вешать маршруты). Арендатор пишет только свою строку: «моим гостям — на третий этаж» (`HTTPRoute`).';

export const ROLES = {
  head: ['Ресурс', 'Чей', 'Что описывает'],
  rows: [
    ['`GatewayClass`', 'поставщик инфраструктуры', 'какая реализация исполняет входы этого класса (`controllerName`) — аналог `IngressClass`'],
    ['`Gateway`', 'команда кластера', 'слушатели: порт, протокол, хост, сертификат — и из каких пространств имён разрешено цепляться маршрутам'],
    ['`HTTPRoute`', 'команда приложения', 'хосты, условия совпадения, фильтры и бэкенды с весами — в пространстве имён приложения'],
  ],
  cols: 'minmax(150px,.7fr) minmax(170px,.8fr) minmax(320px,1.8fr)',
  kinds: ['mono', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 680,
};

/** Инфраструктура: класс и вход. ⚠️ `controllerName` — условное имя; у каждой реализации своё. */
export const GATEWAY_CODE = `apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: shared
spec:
  controllerName: example.com/gateway-controller  # у каждой реализации своё имя
---
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
  namespace: infra
spec:
  gatewayClassName: shared
  listeners:
    - name: http                 # маршруты — только из infra: так по умолчанию
      protocol: HTTP
      port: 80
    - name: https
      protocol: HTTPS
      port: 443
      hostname: "*.example.com"
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-tls   # Secret в том же пространстве, что и Gateway
      allowedRoutes:
        namespaces:
          from: Selector         # маршруты из пространств с этой меткой
          selector:
            matchLabels:
              shared-gateway-access: "true"`;

/** Приложение: своё пространство имён и маршрут. Куда уходят запросы, пересчитывает тест. */
export const HTTPROUTE_CODE = `apiVersion: v1
kind: Namespace
metadata:
  name: shop
  labels:
    shared-gateway-access: "true"   # без метки слушатель https маршрут не примет
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
  namespace: shop
spec:
  parentRefs:
    - name: public
      namespace: infra
      sectionName: https           # к какому слушателю цепляемся
  hostnames: ["shop.example.com"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: /api }
      filters:
        - type: URLRewrite         # бэкенд получит /orders вместо /api/orders
          urlRewrite:
            path: { type: ReplacePrefixMatch, replacePrefixMatch: / }
      backendRefs:
        - name: api
          port: 8080
    - backendRefs:                 # всё остальное: канарейка 90 / 10
        - name: web-v1
          port: 80
          weight: 90
        - name: web-v2
          port: 80
          weight: 10`;

/** Редирект на HTTPS — маршрут команды кластера, прицеплен к слушателю `http`. */
export const REDIRECT_CODE = `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: to-https
  namespace: infra
spec:
  parentRefs:
    - name: public
      sectionName: http
  rules:
    - filters:
        - type: RequestRedirect
          requestRedirect:
            scheme: https
            statusCode: 301`;

export const GATEWAY_ROUTES = {
  head: ['Запрос', 'Результат'],
  rows: [
    ['`http://shop.example.com/cart`', 'редирект **301** на `https://shop.example.com/cart` — маршрут `to-https`'],
    ['`https://shop.example.com/api/orders`', '`api:8080`, путь у бэкенда — `/orders`'],
    ['`https://shop.example.com/catalog`', '`web-v1:80` или `web-v2:80` — 90 запросов из 100 на первый'],
  ],
  cols: 'minmax(260px,1.2fr) minmax(300px,1.5fr)',
  kinds: ['mono', 'prose'] as ('mono' | 'prose')[],
  minWidth: 620,
};

export const ROUTE_MATCH_NOTE =
  'Условие совпадения в HTTPRoute (`matches`) — это путь (`Exact`, `PathPrefix` или, на усмотрение реализации, регулярное выражение), заголовки, параметры запроса и метод. Внутри одного условия всё должно выполниться **одновременно**. Условия в списке `matches` связаны через **или**. Правило без `matches` равносильно `PathPrefix /`, то есть ловит всё.';

/** Порядок из справочника Gateway API (`HTTPRouteRule`). */
export const ROUTE_ORDER = [
  'Совпадение пути `Exact` — сильнее любого префикса, **даже более длинного**.',
  '`PathPrefix` с наибольшим числом символов.',
  'Условие на метод.',
  'Больше условий на заголовки.',
  'Больше условий на параметры запроса.',
  'Если всё равно ничья между разными HTTPRoute — старший по времени создания, потом по алфавиту `пространство/имя`. Внутри одного маршрута — первое по порядку правило.',
];

export const ROUTE_ORDER_NOTE =
  'Сравните с Ingress: там первым идёт **длина** пути, а `Exact` решает только при равной длине. На практике разница всплывает на завершающем слэше: `Prefix /foo/` против `Exact /foo` на запросе `/foo` в Ingress выигрывает префикс (он на символ длиннее), в HTTPRoute — `Exact`. И ещё одно правило, которого у Ingress нет: если к запросу не подошло ни одно правило, HTTPRoute обязан ответить **404** — в Ingress это решает контроллер.';

/**
 * Таблица примеров `ReplacePrefixMatch` из справочника Gateway API (`HTTPPathModifier`).
 * ⚠️ Перенесено без повторной сверки с живой страницей (сети в заходе не было).
 */
export const REWRITE_EXAMPLES = [
  { request: '/foo/bar', prefix: '/foo', replace: '/xyz', result: '/xyz/bar' },
  { request: '/foo/bar', prefix: '/foo', replace: '/xyz/', result: '/xyz/bar' },
  { request: '/foo/bar', prefix: '/foo/', replace: '/xyz', result: '/xyz/bar' },
  { request: '/foo/bar', prefix: '/foo/', replace: '/xyz/', result: '/xyz/bar' },
  { request: '/foo', prefix: '/foo', replace: '/xyz', result: '/xyz' },
  { request: '/foo/', prefix: '/foo', replace: '/xyz', result: '/xyz/' },
  { request: '/foo/bar', prefix: '/foo', replace: '', result: '/bar' },
  { request: '/foo/', prefix: '/foo', replace: '', result: '/' },
  { request: '/foo', prefix: '/foo', replace: '', result: '/' },
  { request: '/foo/', prefix: '/foo', replace: '/', result: '/' },
  { request: '/foo', prefix: '/foo', replace: '/', result: '/' },
];

export const REWRITE_TABLE = {
  head: ['Запрос', '`PathPrefix`', '`replacePrefixMatch`', 'Бэкенд получит'],
  rows: REWRITE_EXAMPLES.map((e) => [
    `\`${e.request}\``,
    `\`${e.prefix}\``,
    e.replace === '' ? 'пустая строка' : `\`${e.replace}\``,
    `\`${e.result}\``,
  ]),
  cols: 'minmax(110px,1fr) minmax(110px,1fr) minmax(150px,1.2fr) minmax(120px,1fr)',
  kinds: ['mono', 'mono', 'mono', 'mono'] as 'mono'[],
  minWidth: 560,
};

export const FILTERS_NOTE =
  'Фильтры правила меняют запрос по дороге. `RequestRedirect` отвечает клиенту редиректом (по умолчанию 302), и бэкенд не вызывается вовсе. `URLRewrite` меняет путь или хост, который увидит бэкенд, а клиент по-прежнему видит свой адрес. `ReplacePrefixMatch` заменяет ровно ту часть пути, что совпала с `PathPrefix`, — по сегментам, как и совпадала, поэтому допустим только в правиле с `PathPrefix`. Есть ещё `RequestHeaderModifier`, `ResponseHeaderModifier` и `RequestMirror`. ⚠️ У фильтров разный **уровень поддержки**: `RequestHeaderModifier` и `RequestRedirect` обязательны для всех (Core), а `URLRewrite`, `ResponseHeaderModifier` и зеркалирование — Extended, то есть реализация вправе их не уметь. Что умеет ваша, — в её отчёте о соответствии.';

export const CANARY_NOTE =
  'Веса в `backendRefs` — доли: у `web-v1` вес 90, у `web-v2` 10, значит, на вторую версию идёт 10 запросов из 100. Вес 0 — не слать вовсе, вес по умолчанию — 1. Настоящие реализации выбирают бэкенд на каждый запрос случайно с этими весами, поэтому доля сходится **в среднем**. Демо ниже раздаёт запросы плавным взвешенным кругом, как nginx: это детерминированно, и доля выходит точной на каждом полном круге. Канарейку по заголовку — «все, кто прислал `x-canary: always`, идут на новую версию» — делают отдельным правилом с условием на заголовок: оно сильнее правила без условий.';

export const COMPARE = {
  head: ['', 'Ingress', 'Gateway API'],
  rows: [
    ['Где живёт', 'встроен в Kubernetes, `networking.k8s.io/v1`', 'CRD, ставятся отдельно; без них `kind: HTTPRoute` — неизвестный вид объекта'],
    ['Роли', 'один объект на всех: и сертификат, и маршруты', '`GatewayClass` — `Gateway` — `HTTPRoute`, у каждого свой владелец'],
    ['Условия совпадения', 'хост и путь', 'хост, путь, заголовки, параметры запроса, метод'],
    ['Веса, редирект, переписывание', 'аннотации конкретного контроллера', 'поля `weight` и `filters` спецификации'],
    ['Протоколы', 'HTTP и HTTPS', 'ещё `GRPCRoute` (стабилен с v1.1); `TLSRoute`, `TCPRoute`, `UDPRoute` — в экспериментальном канале'],
    ['Прицепился ли маршрут', 'не видно: у объекта есть только адрес', 'в `status.parents` — условия `Accepted` и `ResolvedRefs` с причиной отказа'],
    ['Между пространствами имён', 'бэкенд — только из своего пространства', 'можно, но с явным разрешением — `ReferenceGrant` в пространстве бэкенда'],
    ['Развитие', 'API заморожен: новых возможностей не будет', 'развивается; новые возможности сначала появляются в экспериментальном канале'],
  ],
  cols: 'minmax(160px,.8fr) minmax(220px,1.1fr) minmax(280px,1.5fr)',
  kinds: ['prose', 'muted', 'prose'] as ('prose' | 'muted')[],
  minWidth: 720,
};

/** ⚠️ Статус ingress-nginx и Ingress API — по объявлениям проекта, со ссылками в `SOURCES`. */
export const STATUS_FACTS = [
  {
    t: 'ingress-nginx выведен из поддержки',
    d: 'В ноябре 2025 года SIG Network объявила: у ingress-nginx — контроллера, который годами был выбором по умолчанию, — поддержка «по мере сил» только до марта 2026-го, а после — ни выпусков, ни исправлений, **ни исправлений уязвимостей**. Уже установленный контроллер продолжит работать, но чинить его никто не будет. Совет проекта — переходить на Gateway API.',
    tone: 'err' as const,
  },
  {
    t: 'Ingress заморожен, но не удалён',
    d: 'Документация Kubernetes называет Ingress API замороженным: он стабилен, поддерживается и никуда не денется, но новых возможностей в нём не будет — они появляются в Gateway API. Действующий Ingress с другим контроллером — законный выбор, просто без развития.',
    tone: 'warn' as const,
  },
  {
    t: 'Не путать два nginx',
    d: '`ingress-nginx` (проект Kubernetes, `k8s.io/ingress-nginx`) и «NGINX Ingress Controller» от F5/NGINX — два разных контроллера с **разными аннотациями**. Объявление касается первого. Манифесты от одного второму не подходят, а инструкции из поиска легко перепутать.',
  },
  {
    t: 'Переезд: ingress2gateway',
    d: 'Проект `kubernetes-sigs/ingress2gateway` переводит Ingress в `Gateway` и `HTTPRoute`, включая часть аннотаций ingress-nginx. Всё, что он не узнал, придётся переносить руками — именно поэтому аннотации и есть главная цена переезда.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 6 — правило выбора кодом и демо
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Учебная функция выбора бэкенда. Печатается в теме, исполняется демо и тестом.
 *
 * ⚠️ Внутри шаблонной строки нельзя обратных кавычек без экранирования и нельзя `${`;
 * поэтому строки склеиваются плюсом, а обратная кавычка для разметки — одна, в `c`.
 * Регулярных выражений здесь нет намеренно: обратная косая в шаблонной строке теряется.
 */
export const ROUTER_CODE = `// Учебная модель: куда вход отправит запрос. Не прокси и не контроллер —
// только правила выбора из двух спецификаций:
//   Ingress   — kubernetes.io/docs/concepts/services-networking/ingress/
//   HTTPRoute — gateway-api.sigs.k8s.io/reference/spec/
// Демо и тест темы исполняют именно этот текст.

const c = (s) => '\`' + s + '\`';

// Путь сравнивается по сегментам: '/aaa//bbb/' → ['aaa', 'bbb'].
function segments(path) {
  return path.split('/').filter((s) => s !== '');
}

// Prefix в Ingress и PathPrefix в HTTPRoute — одно правило:
// '/foo' совпадает с '/foo', '/foo/' и '/foo/bar', но не с '/foobar'.
function prefixMatches(prefix, path) {
  const want = segments(prefix);
  const got = segments(path);
  return want.length <= got.length && want.every((s, i) => s === got[i]);
}

function parseRequest(url, headerLine) {
  const u = new URL(url);
  const headers = {};
  for (const part of (headerLine || '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0) headers[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  return {
    scheme: u.protocol.slice(0, -1),
    host: u.hostname,               // без порта и в нижнем регистре
    path: u.pathname,
    query: Object.fromEntries(u.searchParams),
    headers,
  };
}

// ── Ingress ─────────────────────────────────────────────────────────────

function serviceName(backend) {
  const s = backend.service;
  return s.name + ':' + (s.port.number ?? s.port.name);
}

// Звёздочка в Ingress закрывает ровно одну метку:
// '*.foo.com' — это 'bar.foo.com', но не 'baz.bar.foo.com' и не 'foo.com'.
// Ранг: точный хост > звёздочка > правило без host (порядок Gateway API и nginx;
// спецификация Ingress его не задаёт).
function ingressHost(ruleHost, host) {
  if (!ruleHost) return { rank: 1, why: 'правило без ' + c('host') + ' подходит к любому хосту' };
  if (ruleHost.startsWith('*.')) {
    const suffix = ruleHost.slice(1);
    const label = host.endsWith(suffix) ? host.slice(0, -suffix.length) : '';
    if (label === '' || label.includes('.')) return null;
    return { rank: 2, why: c(ruleHost) + ': звёздочка закрыла одну метку ' + c(label) };
  }
  return ruleHost === host ? { rank: 3, why: c(host) + ' совпал точно' } : null;
}

function routeIngress(spec, req) {
  const why = [];
  const rules = spec.rules || [];
  const hosts = rules.map((r) => ingressHost(r.host, req.host));
  const top = Math.max(0, ...hosts.map((h) => (h ? h.rank : 0)));
  const group = rules.map((_, i) => i).filter((i) => hosts[i] && hosts[i].rank === top);
  why.push(group.length > 0
    ? 'хост: ' + hosts[group[0]].why
    : 'хост ' + c(req.host) + ' не подошёл ни к одному правилу');

  const checked = [];
  for (const i of group) {
    (rules[i].http?.paths || []).forEach((p, j) => {
      let ok = null;                 // ImplementationSpecific: решает контроллер
      if (p.pathType === 'Exact') ok = p.path === req.path;
      if (p.pathType === 'Prefix') ok = prefixMatches(p.path, req.path);
      checked.push({ rule: i, path: j, type: p.pathType, value: p.path, ok, backend: serviceName(p.backend) });
    });
  }
  if (checked.some((x) => x.ok === null)) {
    why.push(c('ImplementationSpecific') + ' сравнивает контроллер, модель такие пути пропускает');
  }

  // Совпало несколько — выигрывает самый длинный путь; при равной длине Exact сильнее Prefix.
  const hits = checked
    .filter((x) => x.ok === true)
    .sort((a, b) => b.value.length - a.value.length || (b.type === 'Exact') - (a.type === 'Exact'));

  if (hits.length > 0) {
    const win = hits[0];
    why.push('совпали: ' + hits.map((x) => c(x.value) + ' ' + x.type).join(', '));
    if (hits.length > 1) {
      const next = hits[1];
      if (next.value.length < win.value.length) why.push('выигрывает самый длинный путь — ' + c(win.value));
      else if (win.type === 'Exact' && next.type === 'Prefix') why.push('длина равна — ' + c('Exact') + ' сильнее ' + c('Prefix'));
      else why.push('пути равны — взят первый по порядку (спецификация здесь молчит)');
    }
    return { kind: 'backend', backend: win.backend, via: win, checked, why };
  }
  if (spec.defaultBackend) {
    why.push('ни один путь не совпал — запрос уходит в ' + c('defaultBackend'));
    return { kind: 'default', backend: serviceName(spec.defaultBackend), via: null, checked, why };
  }
  why.push('ни один путь не совпал, ' + c('defaultBackend') + ' нет — ответ за контроллером (ingress-nginx: 404)');
  return { kind: 'none', backend: null, via: null, checked, why };
}

// ── HTTPRoute ───────────────────────────────────────────────────────────

// Звёздочка в Gateway API закрывает одну метку и больше:
// '*.foo.com' — это и 'bar.foo.com', и 'baz.bar.foo.com', но не 'foo.com'.
function gatewayHost(pattern, host) {
  if (!pattern.startsWith('*.')) return pattern === host;
  const suffix = pattern.slice(1);
  return host.endsWith(suffix) && host.length > suffix.length;
}

// Одно условие из matches: путь, заголовки и параметры — все сразу.
function tryMatch(m, req) {
  const path = m.path || { type: 'PathPrefix', value: '/' };
  const headers = m.headers || [];
  const query = m.queryParams || [];
  const miss = [];
  if (path.type === 'RegularExpression') miss.push('регулярные выражения — на усмотрение реализации');
  else if (path.type === 'Exact' ? req.path !== path.value : !prefixMatches(path.value, req.path)) {
    miss.push('путь ' + c(req.path) + ' не подходит к ' + path.type + ' ' + c(path.value));
  }
  for (const h of headers) {
    if (req.headers[h.name.toLowerCase()] !== h.value) miss.push('нет заголовка ' + c(h.name + ': ' + h.value));
  }
  for (const q of query) {
    if (req.query[q.name] !== q.value) miss.push('нет параметра ' + c(q.name + '=' + q.value));
  }
  return { path, headers: headers.length, query: query.length, miss };
}

// Порядок из спецификации: Exact, потом самый длинный PathPrefix, потом больше
// заголовков, потом больше параметров, потом порядок правил (сортировка устойчива).
// Метод и сравнение нескольких HTTPRoute между собой модель опускает.
function stronger(a, b) {
  return (b.path.type === 'Exact') - (a.path.type === 'Exact')
    || b.path.value.length - a.path.value.length
    || b.headers - a.headers
    || b.query - a.query;
}

function reason(win, next) {
  if (win.path.type === 'Exact' && next.path.type !== 'Exact') return c('Exact') + ' сильнее любого префикса';
  if (win.path.value.length > next.path.value.length) return 'префикс длиннее';
  if (win.headers > next.headers) return 'больше условий на заголовки';
  if (win.query > next.query) return 'больше условий на параметры';
  return 'равны — выигрывает первое по порядку';
}

// Отрезать от пути первые n сегментов, сохранив всё, что после них.
function dropSegments(path, n) {
  let at = 0;
  for (let i = 0; i < n; i++) {
    while (path[at] === '/') at++;
    while (at < path.length && path[at] !== '/') at++;
  }
  return path.slice(at);
}

// ReplacePrefixMatch заменяет ту часть пути, что совпала с PathPrefix, — по сегментам.
function rewritePath(mod, matched, path) {
  if (!mod) return path;
  if (mod.type === 'ReplaceFullPath') return mod.replaceFullPath;
  let head = mod.replacePrefixMatch;
  while (head.endsWith('/')) head = head.slice(0, -1);
  const out = head + dropSegments(path, segments(matched.value).length);
  return out === '' ? '/' : out;
}

function routeHTTP(spec, req) {
  const why = [];
  const names = spec.hostnames || [];
  if (names.length > 0 && !names.some((n) => gatewayHost(n, req.host))) {
    why.push('хост ' + c(req.host) + ' не входит в ' + c('hostnames') + ' — маршрут не для него, ответ 404');
    return { kind: 'none', checked: [], why };
  }
  why.push(names.length > 0 ? 'хост подошёл к ' + c('hostnames') : 'у маршрута нет ' + c('hostnames') + ' — он для любого хоста');

  const checked = [];
  (spec.rules || []).forEach((rule, i) => {
    (rule.matches || [{}]).forEach((m, j) => checked.push({ rule: i, match: j, ...tryMatch(m, req) }));
  });
  const hits = checked.filter((x) => x.miss.length === 0).sort(stronger);
  if (hits.length === 0) {
    why.push('ни одно условие не выполнено — ответ 404');
    return { kind: 'none', checked, why };
  }

  const win = hits[0];
  const rule = spec.rules[win.rule];
  why.push('выбрано правило ' + (win.rule + 1) + ': ' + win.path.type + ' ' + c(win.path.value)
    + (win.headers ? ', заголовков ' + win.headers : '') + (win.query ? ', параметров ' + win.query : ''));
  const others = hits.filter((x) => x.rule !== win.rule);
  if (others.length > 0) why.push('сильнее правила ' + (others[0].rule + 1) + ': ' + reason(win, others[0]));

  for (const f of rule.filters || []) {
    if (f.type !== 'RequestRedirect') continue;
    const r = f.requestRedirect;
    const status = r.statusCode || 302;
    const location = (r.scheme || req.scheme) + '://' + (r.hostname || req.host)
      + (r.port ? ':' + r.port : '') + rewritePath(r.path, win.path, req.path);
    why.push(c('RequestRedirect') + ': бэкенд не вызывается, клиент получает ' + status);
    return { kind: 'redirect', status, location, via: win, checked, why };
  }

  let upstream = { host: req.host, path: req.path };
  for (const f of rule.filters || []) {
    if (f.type !== 'URLRewrite') continue;
    const w = f.urlRewrite;
    upstream = { host: w.hostname || req.host, path: rewritePath(w.path, win.path, req.path) };
    why.push(c('URLRewrite') + ': бэкенд получит ' + c(upstream.path) + ' вместо ' + c(req.path));
  }

  const backends = (rule.backendRefs || []).map((b) => ({ name: b.name + ':' + b.port, weight: b.weight ?? 1 }));
  const total = backends.reduce((s, b) => s + b.weight, 0);
  if (backends.length > 1) {
    why.push('бэкендов ' + backends.length + ', доли по весам: '
      + backends.map((b) => c(b.name) + ' ' + Math.round((100 * b.weight) / total) + '%').join(', '));
  }
  return { kind: 'backend', backends, upstream, via: win, checked, why };
}

// Раздать n запросов по весам плавным взвешенным кругом, как upstream в nginx:
// детерминированно, и доли точные на каждом полном круге. Настоящие реализации
// обычно выбирают случайно с теми же весами — доля сходится в среднем.
function spread(backends, n) {
  const live = backends.filter((b) => b.weight > 0).map((b) => ({ ...b, current: 0, count: 0 }));
  const total = live.reduce((s, b) => s + b.weight, 0);
  const order = [];
  for (let i = 0; i < n && total > 0; i++) {
    let best = live[0];
    for (const b of live) {
      b.current += b.weight;
      if (b.current > best.current) best = b;
    }
    best.current -= total;
    best.count += 1;
    order.push(best.name);
  }
  const counts = backends.map((b) => ({ name: b.name, weight: b.weight, count: live.find((x) => x.name === b.name)?.count ?? 0 }));
  return { order, counts };
}

// Модуль собирается через new Function — отсюда return.
return { parseRequest, routeIngress, routeHTTP, spread, prefixMatches, rewritePath, ingressHost, gatewayHost };`;

export const ROUTER_WHY =
  'Всё сказанное о выборе бэкенда умещается в одну функцию на полторы сотни строк, и она ниже целиком. Это не контроллер: она не держит соединений и ничего не пересылает. Она только отвечает на вопрос «какое правило выиграет». Каждую строку таблиц примеров из спецификаций — `pathType`, звёздочки, `ReplacePrefixMatch` — она отвечает так же, как документация. Демо под ней исполняет **тот же текст**: можно проверить любой свой адрес.';

export const DEMO_NOTE =
  'Выберите сценарий и впишите адрес — или нажмите один из готовых запросов под полем. Справа — какой бэкенд выбран и почему, ниже — каждое правило сценария с отметкой «совпало или нет», а в листинге подсвечено выигравшее правило. В сценариях с HTTPRoute появляется поле заголовков, в канарейке — раздача N запросов по весам.';

export const DEMO_CAPTION =
  'Ответы считает функция выше, собранная из той же строки. Кластера за демо нет: как поведёт себя конкретный контроллер в случаях, которые спецификация оставляет ему (`ImplementationSpecific`, слияние нескольких Ingress), модель не знает и прямо об этом говорит.';

/** Сценарии демо. `spec` обязан совпасть с разбором `yaml` — это сверяет тест. */
export const SCENARIOS: RouteScenario[] = [
  {
    id: 'longest',
    label: 'длинный префикс',
    kind: 'ingress',
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: shop
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }
          - path: /api
            pathType: Prefix
            backend:
              service: { name: api, port: { number: 8080 } }
          - path: /api/v2
            pathType: Prefix
            backend:
              service: { name: api-v2, port: { number: 8080 } }`,
    spec: {
      ingressClassName: 'nginx',
      rules: [
        {
          host: 'shop.example.com',
          http: {
            paths: [
              { path: '/', pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } },
              { path: '/api', pathType: 'Prefix', backend: { service: { name: 'api', port: { number: 8080 } } } },
              { path: '/api/v2', pathType: 'Prefix', backend: { service: { name: 'api-v2', port: { number: 8080 } } } },
            ],
          },
        },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/api/v2/orders' },
      { url: 'https://shop.example.com/api/orders' },
      { url: 'https://shop.example.com/api/v2beta' },
      { url: 'https://shop.example.com/apidocs' },
      { url: 'https://admin.example.com/api' },
    ],
    note: 'Порядок записи путей не важен: `/` стоит первым, но `/api/v2/orders` уходит в `api-v2`, потому что этот путь длиннее. `/api/v2beta` совпадает только с `/api`, `/apidocs` — только с `/`. Чужой хост не подходит ни к одному правилу, а `defaultBackend` здесь нет — ответ за контроллером.',
  },
  {
    id: 'exact',
    label: 'Exact против Prefix',
    kind: 'ingress',
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app
spec:
  ingressClassName: nginx
  defaultBackend:
    service: { name: web, port: { number: 80 } }
  rules:
    - http:
        paths:
          - path: /app
            pathType: Prefix
            backend:
              service: { name: spa, port: { number: 80 } }
          - path: /app
            pathType: Exact
            backend:
              service: { name: landing, port: { number: 80 } }`,
    spec: {
      ingressClassName: 'nginx',
      defaultBackend: { service: { name: 'web', port: { number: 80 } } },
      rules: [
        {
          http: {
            paths: [
              { path: '/app', pathType: 'Prefix', backend: { service: { name: 'spa', port: { number: 80 } } } },
              { path: '/app', pathType: 'Exact', backend: { service: { name: 'landing', port: { number: 80 } } } },
            ],
          },
        },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/app' },
      { url: 'https://shop.example.com/app/' },
      { url: 'https://shop.example.com/app/settings' },
      { url: 'https://shop.example.com/apps' },
    ],
    note: 'На `/app` совпадают оба пути одной длины, и выигрывает `Exact` — хотя записан вторым. Но стоит добавить слэш, `/app/`, и `Exact` уже не совпадает: запрос уходит в `spa`. `/apps` не совпадает ни с чем и попадает в `defaultBackend`. У правила нет `host`, поэтому хост в адресе можно вписать любой.',
  },
  {
    id: 'segments',
    label: '/docs и /docsearch',
    kind: 'ingress',
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: docs
spec:
  ingressClassName: nginx
  defaultBackend:
    service: { name: web, port: { number: 80 } }
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /docs
            pathType: Prefix
            backend:
              service: { name: docs, port: { number: 80 } }`,
    spec: {
      ingressClassName: 'nginx',
      defaultBackend: { service: { name: 'web', port: { number: 80 } } },
      rules: [
        {
          host: 'shop.example.com',
          http: {
            paths: [{ path: '/docs', pathType: 'Prefix', backend: { service: { name: 'docs', port: { number: 80 } } } }],
          },
        },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/docs' },
      { url: 'https://shop.example.com/docs/intro' },
      { url: 'https://shop.example.com/docsearch' },
      { url: 'https://shop.example.com/Docs/intro' },
    ],
    note: '`Prefix /docs` ловит `/docs` и всё, что под ним, но не `/docsearch`: сравниваются сегменты, а `docsearch` — другой сегмент. И регистр важен: `/Docs/intro` тоже уходит в `defaultBackend`.',
  },
  {
    id: 'hosts',
    label: 'хост и звёздочка',
    kind: 'ingress',
    yaml: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tenants
spec:
  ingressClassName: nginx
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: shop, port: { number: 80 } }
    - host: "*.example.com"
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: tenant, port: { number: 80 } }
    - http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: web, port: { number: 80 } }`,
    spec: {
      ingressClassName: 'nginx',
      rules: [
        {
          host: 'shop.example.com',
          http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'shop', port: { number: 80 } } } }] },
        },
        {
          host: '*.example.com',
          http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'tenant', port: { number: 80 } } } }] },
        },
        {
          http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'web', port: { number: 80 } } } }] },
        },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/' },
      { url: 'https://acme.example.com/' },
      { url: 'https://eu.acme.example.com/' },
      { url: 'https://example.com/' },
    ],
    note: 'К `shop.example.com` подходят все три правила, и выигрывает точное. `acme.example.com` ловит звёздочка. А вот `eu.acme.example.com` звёздочка Ingress уже не ловит — она закрывает одну метку, — как и `example.com` без метки вовсе: оба уходят в правило без хоста. Порядок «точный → звёздочка → без хоста» — выбор модели: спецификация Ingress его не задаёт.',
  },
  {
    id: 'canary',
    label: 'канарейка с весами',
    kind: 'httproute',
    yaml: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
spec:
  parentRefs:
    - name: public
  hostnames: ["shop.example.com"]
  rules:
    - matches:
        - headers:
            - name: x-canary
              value: always
      backendRefs:
        - name: web-v2
          port: 80
    - backendRefs:
        - name: web-v1
          port: 80
          weight: 90
        - name: web-v2
          port: 80
          weight: 10`,
    spec: {
      parentRefs: [{ name: 'public' }],
      hostnames: ['shop.example.com'],
      rules: [
        {
          matches: [{ headers: [{ name: 'x-canary', value: 'always' }] }],
          backendRefs: [{ name: 'web-v2', port: 80 }],
        },
        {
          backendRefs: [
            { name: 'web-v1', port: 80, weight: 90 },
            { name: 'web-v2', port: 80, weight: 10 },
          ],
        },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/catalog' },
      { url: 'https://shop.example.com/catalog', headers: 'x-canary: always' },
      { url: 'https://shop.example.com/catalog', headers: 'X-Canary: always' },
      { url: 'https://shop.example.com/catalog', headers: 'x-canary: Always' },
    ],
    note: 'Без заголовка выигрывает второе правило, и запросы делятся 90 на 10. С заголовком `x-canary: always` оба правила подходят (у обоих путь по умолчанию — `PathPrefix /`), но первое сильнее: у него есть условие на заголовок. Имя заголовка сравнивается без учёта регистра, **значение** — точно: `Always` уже не совпадает.',
  },
  {
    id: 'filters',
    label: 'редирект и переписывание',
    kind: 'httproute',
    yaml: `apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: shop
spec:
  parentRefs:
    - name: public
  hostnames: ["shop.example.com"]
  rules:
    - matches:
        - path: { type: PathPrefix, value: /old-shop }
      filters:
        - type: RequestRedirect
          requestRedirect:
            path: { type: ReplacePrefixMatch, replacePrefixMatch: /shop }
            statusCode: 301
    - matches:
        - path: { type: PathPrefix, value: /api }
      filters:
        - type: URLRewrite
          urlRewrite:
            path: { type: ReplacePrefixMatch, replacePrefixMatch: / }
      backendRefs:
        - name: api
          port: 8080
    - matches:
        - path: { type: PathPrefix, value: /api }
          queryParams:
            - name: debug
              value: "1"
      backendRefs:
        - name: api-debug
          port: 8080
    - backendRefs:
        - name: web
          port: 80`,
    spec: {
      parentRefs: [{ name: 'public' }],
      hostnames: ['shop.example.com'],
      rules: [
        {
          matches: [{ path: { type: 'PathPrefix', value: '/old-shop' } }],
          filters: [
            {
              type: 'RequestRedirect',
              requestRedirect: { path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/shop' }, statusCode: 301 },
            },
          ],
        },
        {
          matches: [{ path: { type: 'PathPrefix', value: '/api' } }],
          filters: [{ type: 'URLRewrite', urlRewrite: { path: { type: 'ReplacePrefixMatch', replacePrefixMatch: '/' } } }],
          backendRefs: [{ name: 'api', port: 8080 }],
        },
        {
          matches: [{ path: { type: 'PathPrefix', value: '/api' }, queryParams: [{ name: 'debug', value: '1' }] }],
          backendRefs: [{ name: 'api-debug', port: 8080 }],
        },
        { backendRefs: [{ name: 'web', port: 80 }] },
      ],
    },
    probes: [
      { url: 'https://shop.example.com/old-shop/cart' },
      { url: 'https://shop.example.com/api/orders' },
      { url: 'https://shop.example.com/api/orders?debug=1' },
      { url: 'https://shop.example.com/apiary' },
      { url: 'https://blog.example.com/' },
    ],
    note: '`/old-shop/cart` получает редирект 301 на `/shop/cart` — до бэкенда запрос не доходит. `/api/orders` уходит в `api` уже как `/orders`. С `?debug=1` сильнее третье правило: путь у него тот же, но есть условие на параметр, и переписывания у него нет. А хост не из `hostnames` маршрут не касается вовсе.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 7 — фронтенд на входе
// ─────────────────────────────────────────────────────────────────────────────────────

export const SPA_NOTE =
  '**Фолбэк SPA — не работа входа.** Ingress и HTTPRoute выбирают сервис по пути, но не умеют «если файла нет, отдай `index.html`»: о файлах вход ничего не знает. `defaultBackend` — это не фолбэк на `index.html`, а целый другой сервис для всего несовпавшего. Фолбэк живёт в сервере, который раздаёт статику в поде: `try_files $uri /index.html` у nginx или аналог у вашего сервера. Как клиентские маршруты и страница 404 устроены на статике без своего сервера, разобрано в [«GitHub Pages» — «Маршрутизация без сервера»](/delivery/github-pages/#s3). Отсюда же ловушка на входе: если `/api` не описан отдельным путём, запрос к несуществующему API уйдёт в сервис фронтенда и получит `index.html` со статусом 200 вместо 404.';

export const CACHE_NOTE =
  '**Заголовки кеша лучше ставить там, где известны имена файлов.** Добавить заголовок на входе можно — фильтром `ResponseHeaderModifier` в HTTPRoute или средствами контроллера, — но вход видит только путь и не знает, какой файл с хешем в имени, а какой нет. Правило «хешированным — `immutable` на год, HTML — `no-cache`» знает сборка и сервер статики. Что именно ставить и почему, — в [«Сети и кешировании» — «Кеш и валидация»](/platform/network/#s2). ⚠️ Отдельно про ingress-nginx: произвольные вставки конфигурации (`configuration-snippet`) там по умолчанию выключены — из-за них случались уязвимости. Отсюда совет «добавьте сниппет с `add_header`» часто просто не работает.';

export const WS_NOTE =
  '**WebSocket проходит через вход, но живёт по его таймаутам.** ingress-nginx пропускает `Upgrade` без настройки, но соединение, в котором 60 секунд нет ни байта, обрывает `proxy-read-timeout` — это видно в таблице аннотаций выше. Лечится двумя половинами: поднять таймауты аннотациями и слать сердцебиение чаще, чем истекает самый короткий таймаут на всём пути (балансировщик облака тоже рвёт тихие соединения). И ещё одно следствие: при выкате контроллера или пода соединения обрываются, так что переподключение клиент обязан уметь сам. В Gateway API у правила есть поле `timeouts`, но оно про время запроса целиком; таймаут простоя долгого соединения стандартом не описан и настраивается политиками конкретной реализации. Как устроены сердцебиение и переподключение на клиенте, — в теме [«Реалтайм»](/platform/realtime/).';

// ─────────────────────────────────────────────────────────────────────────────────────
// Тонкие места
// ─────────────────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Ingress создан, адреса нет, ничего не происходит',
    code: '$ kubectl get ingress shop\nNAME   CLASS   HOSTS              ADDRESS   PORTS     AGE\nshop   nginx   shop.example.com             80, 443   10m',
    d: 'Пустой `ADDRESS` означает, что объект не взял ни один контроллер. Причин три: контроллера в кластере нет вовсе; `ingressClassName` не совпадает ни с одним `IngressClass`; класс не указан, а класса по умолчанию нет. Ошибки не будет ни в одном из трёх случаев: API-сервер проверяет только схему. Первым делом — `kubectl get ingressclass` и поды контроллера. ⚠️ Вывод выше показывает форму, а не снят с кластера.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`Prefix /api` не ловит `/apiv2` — и это не баг',
    d: '`Prefix` сравнивает сегменты пути, а не символы: `/api` совпадает с `/api`, `/api/` и `/api/v2`, но не с `/apiv2` и не с `/apiary`. Это закрывает ошибку, от которой страдают строковые префиксы: `/app` больше не перехватывает `/apple`. Но и ломает перенос конфигураций nginx, где `location /api` — как раз строковый префикс. Проверка в демо — сценарий «/docs и /docsearch».',
    tone: 'warn',
  },
  {
    n: '03',
    t: '`Exact /foo` не совпадает с `/foo/`',
    d: 'Роутер фронтенда часто нормализует адрес с завершающим слэшем, а статический хостинг и сборщики нередко отдают страницы именно как `/foo/`. `Exact` сравнивает строку целиком: `/foo/` — другой путь, и запрос молча уйдёт в более общее правило или в `defaultBackend`. Для страниц почти всегда нужен `Prefix`, а `Exact` — для одной конкретной точки вроде `/healthz`.',
    tone: 'warn',
  },
  {
    n: '04',
    t: '`use-regex` включает регулярки на **всех** путях хоста',
    d: 'По документации ingress-nginx, аннотация `use-regex` (и `rewrite-target`, которая её подразумевает) превращает в регулярные выражения все пути **этого хоста во всех Ingress**, а не только в том объекте, где она стоит, — и делает их нечувствительными к регистру. Соседняя команда добавила переписывание в свой Ingress — и ваш `Exact /health` стал регулярным выражением. Ни предупреждения, ни события.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Загрузка файла падает с 413, а в логах приложения пусто',
    d: 'Умолчание ingress-nginx для тела запроса — 1 мегабайт (`proxy-body-size: 1m`). Запрос крупнее отбивает сам вход, до пода он не доходит, поэтому в логах приложения его нет. Со стороны фронтенда это выглядит как «сервер отказал без причины». Лимит поднимают аннотацией на том Ingress, через который идут загрузки, — и только там.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Смена контроллера стирает половину настроек молча',
    d: 'Аннотации понимает только их контроллер. После переезда с ingress-nginx на другой контроллер Ingress применяется без ошибок, но лимиты, таймауты, переписывание путей, CORS и канарейка перестают действовать: для нового контроллера это чужие строки. Перед переездом стоит выписать все аннотации всех Ingress — `kubectl get ingress -A -o yaml` — и для каждой найти замену. Это и есть настоящий объём работы.',
    tone: 'err',
  },
  {
    n: '07',
    t: 'Звёздочка в Ingress и в Gateway API значит разное',
    d: 'В Ingress `*.example.com` закрывает ровно одну метку: `a.example.com` — да, `eu.a.example.com` — нет. В Gateway API — одну и больше: подходят оба. `example.com` без метки не покрывает ни тот, ни другой. При переезде правило со звёздочкой начинает ловить больше хостов, чем раньше.',
    tone: 'warn',
  },
  {
    n: '08',
    t: 'HTTPRoute создан, но трафика нет: маршрут не прицепился',
    d: 'Слушатель `Gateway` по умолчанию принимает маршруты только из своего пространства имён (`allowedRoutes.namespaces.from: Same`). Маршрут из пространства приложения будет создан без ошибок, но в `status.parents` у него появится `Accepted: False` с причиной `NotAllowedByListeners`. У Ingress такой диагностики нет вовсе, у HTTPRoute она есть — но смотреть надо в `kubectl get httproute -o yaml`, а не в события.',
    tone: 'warn',
  },
  {
    n: '09',
    t: '`Exact` в Gateway API сильнее более длинного префикса',
    d: 'В Ingress первым решает длина пути, а `Exact` выигрывает лишь при равной длине. В HTTPRoute `Exact` стоит выше любого `PathPrefix`. Расходятся они на краю — `PathPrefix /foo/` против `Exact /foo` на запросе `/foo`, — и это тот случай, который всплывает после переезда.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Приложение за входом думает, что работает по HTTP',
    d: 'TLS расшифровывает вход, до пода идёт обычный HTTP. Сервер, который не доверяет `X-Forwarded-Proto`, строит редиректы на `http://` (и вход тут же возвращает на HTTPS — петля), а куку с `Secure` пропускает. Адрес клиента по той же причине — адрес пода контроллера, а настоящий лежит в `X-Forwarded-For`. Доверять этим заголовкам надо ровно от входа — иначе клиент подделает их сам.',
    tone: 'err',
  },
  {
    n: '11',
    t: 'Сертификат со звёздочкой через HTTP-01 не выпустится',
    d: 'Let\'s Encrypt выдаёт сертификаты на `*.example.com` только через проверку DNS-01. cert-manager, настроенный на HTTP-01, будет пытаться бесконечно, а `Certificate` останется в `Ready: False`. Разбор — в `kubectl describe certificate`, `certificaterequest` и `challenge`, по цепочке.',
    tone: 'warn',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Источники
// ─────────────────────────────────────────────────────────────────────────────────────

export const SOURCES = [
  {
    title: 'Kubernetes: Ingress',
    href: 'https://kubernetes.io/docs/concepts/services-networking/ingress/',
    what: 'pathType и **таблица примеров**, правило «самый длинный путь, при равенстве `Exact`», звёздочки в хосте, `defaultBackend`, `tls`, `IngressClass`; пометка о заморозке API',
  },
  {
    title: 'Kubernetes: Ingress Controllers',
    href: 'https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/',
    what: 'почему Ingress без контроллера ничего не делает, класс по умолчанию и несколько контроллеров в одном кластере',
  },
  {
    title: 'Kubernetes Blog: Ingress NGINX Retirement',
    href: 'https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/',
    what: 'сроки прекращения поддержки ingress-nginx и совет переходить на Gateway API',
  },
  {
    title: 'Gateway API: API Overview',
    href: 'https://gateway-api.sigs.k8s.io/concepts/api-overview/',
    what: 'роли и ресурсы (`GatewayClass`, `Gateway`, `HTTPRoute`), прикрепление маршрутов, `ReferenceGrant`',
  },
  {
    title: 'Gateway API: API reference (Standard)',
    href: 'https://gateway-api.sigs.k8s.io/reference/spec/',
    what: '`HTTPRouteRule` — порядок приоритета совпадений и 404; `HTTPRouteMatch`; `HTTPPathModifier` с **таблицей `ReplacePrefixMatch`**; `HTTPBackendRef.weight`; уровни поддержки фильтров',
  },
  {
    title: 'Gateway API: HTTPRoute и Traffic splitting',
    href: 'https://gateway-api.sigs.k8s.io/guides/traffic-splitting/',
    what: 'канарейка весами и по заголовку — те же приёмы, что в демо',
  },
  {
    title: 'ingress-nginx: Annotations',
    href: 'https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/',
    what: '`proxy-body-size`, таймауты, `rewrite-target`, `ssl-redirect`, канарейка; умолчания — в соседней странице ConfigMap',
  },
  {
    title: 'ingress-nginx: Ingress Path Matching',
    href: 'https://kubernetes.github.io/ingress-nginx/user-guide/ingress-path-matching/',
    what: 'как `use-regex` распространяется на все пути хоста и почему регулярки нечувствительны к регистру',
  },
  {
    title: 'ingress-nginx: Websockets',
    href: 'https://kubernetes.github.io/ingress-nginx/user-guide/miscellaneous/#websockets',
    what: 'WebSocket проходит без настройки, но рвётся по `proxy-read-timeout` и `proxy-send-timeout` — 60 с по умолчанию',
  },
  {
    title: 'cert-manager: Securing Ingress Resources',
    href: 'https://cert-manager.io/docs/usage/ingress/',
    what: 'аннотация `cert-manager.io/cluster-issuer`, откуда берутся хосты и имя Secret; соседние страницы — ACME, HTTP-01 и DNS-01, `renewBefore`',
  },
  {
    title: 'kubernetes-sigs/ingress2gateway',
    href: 'https://github.com/kubernetes-sigs/ingress2gateway',
    what: 'перевод Ingress в ресурсы Gateway API и какие аннотации он понимает',
  },
];

export const RELATED =
  'Смежное на сайте: [Kubernetes: развёртывание](/delivery/kubernetes/) — сервис, пробы и выкат, на которые опирается вход. [Docker: образ и слои](/delivery/docker/) — как процесс в поде получает `SIGTERM`, когда вход уже снял его с трафика. [GitHub Pages](/delivery/github-pages/) — статика без своего сервера и её маршрутизация. [Сеть и кеширование](/platform/network/) — заголовки кеша и preflight. [Безопасность фронтенда](/platform/security/) — куки с `Secure`, которые зависят от того, знает ли приложение про HTTPS. [Реалтайм](/platform/realtime/) — долгие соединения, которым вход ставит таймауты. [Nginx как обратный прокси](/delivery/nginx-proxy/) — выбор `location`, слеш в `proxy_pass`, буферизация и кеш на одном прокси. [TLS и сертификаты](/delivery/tls-certificates/) — рукопожатие по сообщениям, цепочка доверия и ACME. [DNS](/delivery/dns/) — путь запроса по серверам, TTL и кеш, CNAME на вершине зоны и смена адреса при выкатке.';

/* ──────────────────── Трудные места — подробно ──────────────────── */

/**
 * Три правила, три запроса, две спецификации. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. `MATCH_STEPS`, `ROUTE_ORDER` и `ROUTE_ORDER_NOTE` давали
 * порядок выбора списками, а разницу между Ingress и HTTPRoute — одним предложением. Здесь
 * один набор правил прогнан через оба порядка. Исход `/foo` закреплён в `tests/unit/ingress.test.ts`
 * («Prefix /foo/ против Exact /foo»); `/foo/bar` и `/foobar` — по тем же спискам и `PLAIN_PREFIX`
 * (спецификация Ingress «Path types», Gateway API «HTTPRoute matching precedence»). Их можно
 * проверить в демо раздела «Куда уйдёт запрос».
 */
export const MATCH_SCENE: string[] = [
  'Три правила для одного хоста: `Exact /foo` ведёт в сервис `exact`, `Prefix /foo/` — в `prefix`, `Prefix /` — в `root`. Одни и те же три правила записаны и в Ingress, и в HTTPRoute. Прогоним через них три запроса.',
  'Сначала — что было бы, **если бы префикс сравнивал буквы**, а не сегменты пути. Хвостовой слэш у префикса спецификации не учитывают: `Prefix /foo/` для них то же, что `Prefix /foo`. Сравнивай они после этого буквы, запрос `/foobar` — он ведь начинается с `/foo` — ушёл бы в сервис `prefix`, чужой для этой страницы. Сравнение по сегментам между косыми чертами этого не допускает: `foobar` и `foo` — разные сегменты.',
];

export const MATCH_WALK: { k: string; ingress: string; gateway: string }[] = [
  {
    k: '`/foo`',
    ingress: 'совпали `Exact /foo` и `Prefix /foo/` (хвостовой слэш у префикса не мешает), и ещё `Prefix /`. Первым решает **длина**: `/foo/` на символ длиннее `/foo` — выигрывает `prefix`',
    gateway: 'совпали те же три. Первым решает **вид**: `Exact` сильнее любого префикса, даже более длинного, — выигрывает `exact`',
  },
  {
    k: '`/foo/bar`',
    ingress: '`Exact /foo` не совпал — путь другой. Совпали `Prefix /foo/` и `Prefix /`; длиннее первый — `prefix`',
    gateway: 'то же самое: точного совпадения нет, из префиксов длиннее `/foo/` — `prefix`',
  },
  {
    k: '`/foobar`',
    ingress: '`Exact` не совпал, `Prefix /foo/` не совпал — сегмент `foobar` не равен `foo`. Остался `Prefix /` — `root`',
    gateway: 'то же самое — `root`. Если бы не было и `Prefix /`, HTTPRoute обязан был бы ответить 404, а в Ingress ответ выбрал бы контроллер',
  },
];

export const MATCH_FOOT =
  'Расходятся спецификации только на первом запросе — там, где точное правило короче префиксного. Поэтому, переводя правила с Ingress на HTTPRoute, стоит искать пары «`Exact` и префикс со слэшем на конце»: остальное поедет туда же.';

/** Продолжение `PLAIN_PREFIX` — тот же почтальон, два начальника с разными инструкциями. */
export const PLAIN_MATCH =
  'Тот же почтальон, и у него письмо на «ул. Ленина» — а в сортировке две ячейки: «ул. Ленина (только сама улица)» и «ул. Ленина, все дома». В одном отделении инструкция «клади в ячейку с самой длинной надписью» — письмо уходит во вторую. В другом — «ячейка с пометкой „только“ всегда главнее» — письмо уходит в первую. Письмо на «ул. Ленинградскую» ни в одну из них не попадёт ни там, ни там: почтальон читает улицу целиком.';

/**
 * Один запрос через TLS на входе. Автор курса (2026-09-29): не сокращать, а объяснять
 * подробно. `TLS_WHY` и `TLS_BEHIND_NOTE` говорили, где кончается шифрование и чем это
 * грозит приложению, но не показывали это на одном запросе. Механика — ровно эти две
 * константы и `PATH_STEPS` (документация Kubernetes «Ingress · TLS», ingress-nginx
 * «X-Forwarded-*», Express «Behind proxies»); прогоном в теме не снималось.
 */
export const TLS_SCENE: string[] = [
  'Пользователь отправляет форму входа на `https://shop.example.com/login`. Приложение на Express проверяет пароль, ставит куку сессии с флагом `Secure` и отвечает редиректом на страницу аккаунта. Проследим, что про этот запрос знает каждое звено.',
  '**Балансировщик** видит зашифрованные байты — ни хоста, ни пути. **Контроллер входа** по SNI выбирает сертификат из Secret, расшифровывает запрос и видит всё: `https`, хост, путь, заголовки. Дальше он открывает к поду **обычное HTTP-соединение** и добавляет два заголовка: `X-Forwarded-Proto: https` и `X-Forwarded-For` с адресом клиента. **Приложение** получает запрос по HTTP. Что пользователь пришёл по HTTPS, оно может узнать только из заголовка.',
];

export const TLS_VARIANTS: { k: string; what: string; cost: string }[] = [
  {
    k: 'Приложение заголовкам не доверяет',
    what: 'Для Express запрос пришёл по `http`: соединение-то обычное. Абсолютные ссылки и редирект он строит с `http://shop.example.com/…`, а куку с `Secure` — «только для HTTPS» — может не выставить вовсе: по его сведениям, соединение не защищено.',
    cost: 'Вход в систему «не работает» без единой ошибки в логах: пароль верный, а сессии нет. Или браузер уходит по редиректу на `http://` — мимо шифрования, ради которого всё затевалось.',
  },
  {
    k: 'Приложение доверяет входу: `app.set(\'trust proxy\', …)`',
    what: 'Express берёт схему из `X-Forwarded-Proto` и адрес клиента из `X-Forwarded-For`. Запрос для него — `https`, кука с `Secure` выставляется, редирект уходит на `https://`.',
    cost: 'Доверять можно только тому, кто стоит перед приложением на самом деле — входу. Значение настройки описывает именно его, поэтому его и подбирают под свою схему, а не ставят «на всякий случай».',
  },
];

/** Продолжение `PLAIN_ENTRY` — тот же ресепшн вскрывает конверт. */
export const PLAIN_TLS =
  'Тот же бизнес-центр. Письма приходят в запечатанных конвертах (TLS), и вскрывает их ресепшн — у него ключ от конверта (сертификат из Secret). Наверх, в фирму, письмо несут уже без конверта, но с отметкой ресепшна «пришло запечатанным» (`X-Forwarded-Proto`). Фирма, которая отметкам ресепшна не верит, решит, что письмо пришло открыткой, — и не станет доверять ему ничего секретного.';

/* ──────────────────── Схемы ──────────────────── */

/**
 * Схема «путь запроса снаружи до пода» (раздел «Путь запроса снаружи до пода», перед
 * карточкой «Пять шагов от имени до пода»).
 *
 * Пять узлов — ровно пять шагов `PATH_STEPS`, с их же словами: кто что видит (L4 не читает
 * HTTP, L7 читает хост и путь) и обход адреса сервиса у ingress-nginx по умолчанию. Имя —
 * `shop.example.com`, как во всех листингах темы. Конкретных сервисов на схеме нет: в этом
 * разделе их ещё не объявили.
 */
export const PATH_DIAGRAM = {
  title: 'Пять участников, и только один читает HTTP',
  caption:
    'Хост и путь видит только контроллер входа: до него запрос — TCP-соединение, после него — адрес конкретного пода.',
  nodes: [
    { t: 'DNS', s: '`shop.example.com` → внешний адрес', tag: 'имя', tone: 'dim' },
    { t: 'балансировщик', s: 'HTTP не читает; это сервис `LoadBalancer` у контроллера входа', tag: 'L4 · TCP', tone: 'dim' },
    {
      t: 'контроллер входа',
      s: 'расшифровывает TLS, находит правило Ingress или HTTPRoute, выбирает сервис с портом',
      tag: 'L7 · читает хост и путь',
      tone: 'info',
    },
    { t: 'EndpointSlice сервиса', s: 'адреса готовых подов', tag: 'список', tone: 'dim' },
    { t: 'под', s: 'отвечает; ответ идёт обратно той же дорогой', tag: 'приложение', tone: 'ok' },
  ],
  bypass: 'ingress-nginx по умолчанию шлёт запрос **прямо поду**, минуя адрес сервиса (`ClusterIP`): сервис здесь — источник списка, а не пересыльщик.',
};

/**
 * Схема «три объекта — три владельца» (раздел «Gateway API», сразу после `HTTPROUTE_CODE`).
 *
 * Объекты, имена и связи — из `GATEWAY_CODE` и `HTTPROUTE_CODE`: `GatewayClass shared`,
 * `Gateway public` в `infra` со слушателями `http` и `https`, `HTTPRoute shop` в `shop`,
 * который цепляется к слушателю `https` через `parentRefs` и проходит его `allowedRoutes`
 * по метке пространства. Владельцы — из таблицы `ROLES`.
 */
export const ROLES_DIAGRAM = {
  title: 'Три объекта — три владельца',
  caption:
    'Маршрут живёт в пространстве приложения и сам цепляется к входу; вход пускает его только по метке пространства.',
  layers: [
    {
      owner: 'поставщик инфраструктуры',
      ns: 'на весь кластер',
      kind: '`GatewayClass` `shared`',
      lines: ['`controllerName: example.com/gateway-controller`'],
      tone: 'dim',
    },
    {
      owner: 'команда кластера',
      ns: 'пространство `infra`',
      kind: '`Gateway` `public`',
      lines: [
        'слушатель `http` · 80 — маршруты только из `infra`',
        'слушатель `https` · 443 · `*.example.com` · сертификат `wildcard-tls`',
        'пускает маршруты из пространств с меткой `shared-gateway-access: "true"`',
      ],
      tone: 'info',
    },
    {
      owner: 'команда приложения',
      ns: 'пространство `shop` · метка `shared-gateway-access: "true"`',
      kind: '`HTTPRoute` `shop`',
      lines: [
        '`/api` → `api:8080`, путь переписан на `/`',
        'всё остальное → `web-v1` 90 / `web-v2` 10',
      ],
      tone: 'ok',
    },
  ],
  links: ['`gatewayClassName: shared`', '`parentRefs: public`, `sectionName: https`'],
};
