import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «StatefulSet, тома и данные».
 *
 * Тема написана здесь. До неё предмет висел строкой «StatefulSet, тома и данные — Отдельная
 * тема — готовится» в «Что осталось за кадром» у «Kubernetes: развёртывание».
 *
 * ── Что чем проверено ────────────────────────────────────────────────────────────────
 *
 * Кластер **не поднимался**: ни `kubectl`, ни драйвера хранилища, ни сети в этом заходе
 * не было. Поэтому тема держится на двух опорах, и у каждой строки ниже написано, на какой.
 *
 * 1. **Поведение контроллера и судьба PVC — кодом.** `SIM_CODE` — учебная модель,
 *    написанная по документации Kubernetes «StatefulSets»: разделы «Deployment and Scaling
 *    Guarantees», «Pod Management Policies», «Update strategies → Rolling Updates /
 *    Partitioned rolling updates», «PersistentVolumeClaim retention», «Stable Network ID»
 *    и «Stable Storage». Строка напечатана в теме, исполняется демо
 *    (`widgets/sts-controller/model/run.ts` собирает её `new Function`) и тестом
 *    `tests/unit/statefulset.test.ts`. Тест прогоняет через неё:
 *      — `ORDER_CASES` — случаи, **описанные в самой документации** словами («web-2 не
 *        запустится, пока web-0 снова не станет Running и Ready» и т. п.) и в учебнике
 *        «StatefulSet Basics» (staging и canary через `partition`); литерал столбца
 *        «действия» сверяется с прогоном, а сверх литерала тест проверяет сами правила —
 *        возрастание при создании, убывание при удалении и обновлении, ожидание Ready;
 *      — `CLAIM_CASES` — таблицу «политика × событие → PVC» из раздела про retention;
 *        каждая строка проверяется и функцией `claimFate`, и прогоном модели целиком;
 *      — `DNS_EXAMPLES` — таблицу из раздела «Stable Network ID» (три строки).
 *    ⚠️ Таблицы перенесены без доступа к сети в этом заходе: сверить их с живой страницей
 *    документации заново было нечем. Если строка разойдётся с документацией — править
 *    литерал и смотреть, краснеет ли функция.
 * 2. **Всё остальное — по документации, не прогоном** и помечено в тексте: режимы доступа,
 *    `reclaimPolicy`, `volumeBindingMode`, `emptyDir`/`hostPath`, снапшоты, операторы,
 *    неизменяемость полей StatefulSet (по тексту ошибки API-сервера), поведение DNS
 *    (негативный кеш CoreDNS, `publishNotReadyAddresses`), зависание на узле, который
 *    пропал. Листинги разбираются тестом как YAML — синтаксис, `apiVersion`/`kind`,
 *    `serviceName` против headless-сервиса, `clusterIP: None`, имена томов между
 *    `volumeClaimTemplates` и `volumeMounts`, класс хранения и драйвер снапшотов, — но в
 *    кластер не применялись.
 *
 * ── Чего модель не умеет, и это сказано в теме ───────────────────────────────────────
 *
 *   — `OnDelete`, `minReadySeconds`, `maxUnavailable` у `rollingUpdate`, `.spec.ordinals`;
 *   — `Failed`-поды и их пересоздание, откат ревизий, `--cascade=orphan`;
 *   — завершение пода мгновенно: следующий проход контроллера уже видит его удалённым.
 *     В кластере между ними — период корректного завершения (по умолчанию 30 с);
 *   — «выкат закончен» — собственная отметка модели: все реплики на новой версии и Ready.
 *
 * ⚠️ Модель следует **формулировке документации**, а не исходнику контроллера, который
 * в этом заходе не сверялся: перед удалением лишнего пода при `OrderedReady` все его
 * предшественники обязаны быть Running и Ready. Нашёл это место инвариант на случайных
 * сценариях в тесте: первая версия модели удаляла `db-4`, пока `db-1` ещё не был готов.
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// Вводный раздел
// ─────────────────────────────────────────────────────────────────────────────────────

export const INTRO_NOTE =
  'Веб-серверу без состояния от платформы нужно одно: запускать сколько угодно одинаковых копий и не жалеть ни одну. Базе данных нужно три вещи, которых у такой платформы нет. **Данные переживают процесс**: под умер — файлы остались. **У каждой копии свои данные**: ведущая реплика и ведомая — не взаимозаменяемы. **Копии находят друг друга по постоянному имени**: ведомая должна знать, куда подключаться за журналом. Kubernetes отвечает на это тремя отдельными механизмами — PersistentVolumeClaim, `volumeClaimTemplates` и StatefulSet с headless-сервисом. Ни один из них **не делает базу надёжной**: репликацию, переключение при отказе и резервные копии по-прежнему делает сама база или тот, кто ею управляет.';

/** Личность реплики — во вводном разделе, до первого листинга. */
export const PLAIN_IDENTITY =
  'Поды Deployment — курьеры службы доставки: заказ отдают первому свободному, заболел один — прислали другого, с другим именем, и никто не заметил. Поды StatefulSet — сотрудники за столами с табличками «стол 0», «стол 1», «стол 2». Ушёл сотрудник на больничный — за его стол садится замена **с той же табличкой**, а папки в ящике стола остались на месте. Папки — это том, табличка — имя и DNS-адрес.';

export const GLOSSARY = [
  {
    k: 'том',
    d: 'Каталог, который Kubernetes подключает в контейнер. Бывает временным — живёт, пока жив под, — и постоянным: тогда за ним стоит диск, который переживает под.',
  },
  {
    k: 'PersistentVolume (PV)',
    d: 'Объект кластера, описывающий конкретный кусок хранилища: облачный диск, раздел NFS, локальный SSD узла. Существует независимо от подов.',
  },
  {
    k: 'PersistentVolumeClaim (PVC)',
    d: 'Заявка на хранилище от имени приложения: «нужно 20 ГБ, подключаемых к одному узлу». Kubernetes находит или создаёт под неё PV и связывает их один к одному. Под ссылается на заявку, а не на диск.',
  },
  {
    k: 'StorageClass',
    d: 'Описание вида хранилища: какой драйвер создаёт диски, с какими параметрами, что делать с диском после заявки и когда его создавать. По классу диски выдаются автоматически.',
  },
  {
    k: 'CSI-драйвер',
    d: 'Container Storage Interface — программа, через которую Kubernetes создаёт, подключает, расширяет и снимает снапшоты дисков конкретного хранилища. У каждого облака и каждой СХД свой.',
  },
  {
    k: 'headless-сервис',
    d: 'Сервис с `clusterIP: None`: у него нет общего адреса и балансировки, DNS по его имени отдаёт адреса самих подов. StatefulSet использует его, чтобы у каждого пода было своё DNS-имя.',
  },
  {
    k: 'порядковый номер',
    d: 'Ordinal — число в имени пода StatefulSet: `db-0`, `db-1`, `db-2`. По нему контроллер решает порядок создания, удаления и обновления, по нему же под находит свой том.',
  },
  {
    k: 'ведущая и ведомая реплики',
    d: 'Primary и replica. В классической схеме пишет одна ведущая копия базы, а ведомые получают её журнал изменений и отвечают на чтение. Какой под ведущий, решает база или оператор — не Kubernetes.',
  },
  {
    k: 'зона доступности',
    d: 'Отдельный дата-центр внутри региона облака. Узлы кластера обычно разбросаны по зонам, а сетевой диск живёт в одной из них — и подключается только к узлам той же зоны.',
  },
  {
    k: 'оператор',
    d: 'Контроллер, написанный под конкретное приложение: он читает собственный вид объектов (скажем, `Cluster` для Postgres) и делает то, что делал бы администратор этой базы, — реплики, переключение, копии, обновления.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Перед началом
// ─────────────────────────────────────────────────────────────────────────────────────

export const PREREQ_NOTE =
  'StatefulSet — ещё один контроллер над подами. Всё, что верно для подов, сервисов и проб, верно и для него; отличается он тем, чего не даёт Deployment, — личностью реплики и её собственным диском.';

export const PREREQ = [
  {
    t: 'Под, ReplicaSet и Deployment',
    d: 'Под нельзя изменить — только заменить новым, и это делает контроллер, сводя желаемое с действительным. StatefulSet устроен так же, только заменяет под **тем же именем**.',
    href: '/delivery/kubernetes/#s1',
    hrefLabel: 'Kubernetes: развёртывание — «Под и контроллеры»',
    tone: 'info' as const,
  },
  {
    t: 'Сервис, его DNS-имя и headless',
    d: 'Как сервис находит поды по меткам, как устроено имя `db.shop.svc.cluster.local` и чем headless-сервис отличается от обычного, здесь не повторяется — тема достраивает к этому имена отдельных подов.',
    href: '/delivery/kubernetes/#s2',
    hrefLabel: 'Kubernetes: развёртывание — «Сервис»',
    tone: 'info' as const,
  },
  {
    t: 'Readiness-проба',
    d: 'Контроллер StatefulSet ждёт, пока под станет **Ready**, прежде чем трогать следующий. Ready ставит readiness-проба; нет пробы — под готов, едва запустился процесс, и ожидание теряет смысл.',
    href: '/delivery/kubernetes/#s3',
    hrefLabel: 'Kubernetes: развёртывание — «Пробы»',
    tone: 'warn' as const,
  },
  {
    t: 'Именованный том в Compose',
    d: 'Та же идея на одной машине: данные живут в томе, а не в контейнере, и переживают `docker compose down`. В кластере добавляется то, чего на одной машине нет, — узлы, зоны и диски, которые к ним не подключаются.',
    href: '/delivery/compose/#s4',
    hrefLabel: 'Docker Compose — «Тома и данные»',
    tone: 'info' as const,
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 1 — имя и адрес
// ─────────────────────────────────────────────────────────────────────────────────────

export const WHY_NOT_DEPLOYMENT =
  'Deployment считает поды одинаковыми: имя — случайный хвост вроде `api-7d9f8c-x2kq`, после замены — другой, а все копии получают один и тот же шаблон, включая тома. Для веб-сервера это достоинство (как контроллеры заменяют поды — в разделе [«Под и контроллеры»](/delivery/kubernetes/#s1)). Для базы — три поломки сразу. Три копии Postgres с **одним** томом — либо три процесса, пишущие в одни файлы, либо (что чаще) две копии, навсегда застрявшие без диска: облачный диск подключается к одному узлу. Три копии **без** общего тома — три пустые базы, и после каждой замены пода — снова пустая. И ведомой реплике некуда подключаться: имя ведущей меняется при каждом перезапуске.';

export const DEPLOY_VS_STS = {
  head: ['', 'Deployment', 'StatefulSet'],
  rows: [
    ['Имя пода', '`api-7d9f8c-x2kq` — случайное', '`db-0`, `db-1`, `db-2` — по номеру'],
    ['После замены пода', 'новое имя, новый адрес', '**то же имя**, новый IP-адрес'],
    ['Том', 'один шаблон на все копии', 'свой PVC на каждую копию, по имени: `data-db-0`'],
    ['DNS', 'только имя сервиса', 'имя сервиса **и** имя каждого пода'],
    ['Создание', 'все копии сразу', 'по умолчанию по одной, по возрастанию номера, с ожиданием Ready'],
    ['Обновление', 'новые поды рядом со старыми (`maxSurge`)', 'удалить старый, создать на его месте — с наибольшего номера'],
    ['Уменьшение', 'удаляются любые', 'с наибольшего номера; **диски остаются**'],
  ],
  cols: 'minmax(150px,.8fr) minmax(210px,1fr) minmax(250px,1.3fr)',
  kinds: ['prose', 'muted', 'prose'] as ('prose' | 'muted')[],
  minWidth: 680,
};

/**
 * Сквозной пример темы: на этот объект ссылаются все разделы, его состояние показывает демо.
 * Согласованность имён сверяет тест; в кластер листинг не применялся.
 */
export const STS_CODE = `apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: shop
spec:
  clusterIP: None                  # headless: DNS отдаёт адреса подов, не один адрес
  selector:
    app: db
  ports:
    - name: pg
      port: 5432
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: db
  namespace: shop
spec:
  serviceName: db                  # тот самый headless-сервис: от него имена подов в DNS
  replicas: 3                      # три пода — три НЕЗАВИСИМЫЕ базы: реплицирует не StatefulSet
  podManagementPolicy: OrderedReady      # по умолчанию; Parallel — все сразу
  updateStrategy:
    type: RollingUpdate
    rollingUpdate:
      partition: 0                 # обновлять поды с номером ≥ 0, то есть все
  persistentVolumeClaimRetentionPolicy:
    whenScaled: Retain             # по умолчанию: диски лишних реплик остаются
    whenDeleted: Retain
  selector:
    matchLabels:
      app: db
  template:
    metadata:
      labels:
        app: db
    spec:
      containers:
        - name: postgres
          image: postgres:17
          ports:
            - name: pg
              containerPort: 5432
          env:
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef: { name: db-auth, key: password }
            - name: PGDATA             # подкаталог: в корне свежего диска лежит lost+found
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "postgres"]
            periodSeconds: 5
          volumeMounts:
            - name: data               # имя из volumeClaimTemplates ниже
              mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
    - metadata:
        name: data                     # PVC получат имена data-db-0, data-db-1, data-db-2
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: fast-ssd
        resources:
          requests:
            storage: 20Gi`;

export const STS_NOTES = [
  {
    t: 'Три реплики — три базы',
    d: 'StatefulSet раздаёт подам имена и диски, но ничего не знает о Postgres. Три пода из листинга — три независимых сервера с тремя разными наборами данных. Чтобы `db-1` и `db-2` стали ведомыми репликами `db-0`, их надо так настроить: скриптом при старте, образом, который это умеет, или оператором (раздел «Копии, снапшоты и операторы»).',
    tone: 'warn' as const,
  },
  {
    t: '`PGDATA` в подкаталоге',
    d: 'Свежеотформатированный диск с ext4 приходит с каталогом `lost+found` в корне, а `initdb` отказывается работать в непустом каталоге. Документация образа `postgres` советует поэтому класть данные в подкаталог точки монтирования. ⚠️ По документации образа, не проверено запуском.',
  },
  {
    t: 'Имя — да, IP-адрес — нет',
    d: 'Пересозданный `db-1` получает то же имя и тот же диск, но **новый** IP-адрес. Клиент, который однажды разрешил имя и запомнил адрес, после перезапуска пода стучится в пустоту. Подключаться надо по имени и разрешать его заново при переподключении.',
  },
];

export const PLAIN_HEADLESS =
  'Обычный сервис — общий телефон приёмной: звонишь по одному номеру, трубку берёт любой свободный. Headless-сервис — справочник отдела: по имени отдела он выдаёт список прямых номеров сотрудников, а у каждого есть и свой добавочный: `db-0.db`. Позвонить «кому-нибудь» по-прежнему можно, но теперь можно и конкретному.';

export const DNS_WHY =
  'Имя пода собирается из трёх частей: имя StatefulSet и номер дают `db-0`, а домен берётся от headless-сервиса, указанного в `serviceName`: `db.shop.svc.cluster.local`. Вместе — `db-0.db.shop.svc.cluster.local`. Из того же пространства имён хватает короткого `db-0.db`. Имя самого сервиса `db` при этом отдаёт адреса **всех** готовых подов сразу — это список, а не балансировщик: выбирает клиент.';

/**
 * Таблица из раздела «Stable Network ID» документации StatefulSet. Столбцы «домен»
 * и «имя пода» тест пересчитывает функцией `podFqdn` из `SIM_CODE`.
 * ⚠️ Имена `nginx` и `web` — из документации, а не из сквозного примера темы.
 */
export const DNS_EXAMPLES = [
  { domain: 'cluster.local', service: 'default/nginx', set: 'default/web', setDomain: 'nginx.default.svc.cluster.local', pod: 'web-{0..N-1}.nginx.default.svc.cluster.local', host: 'web-{0..N-1}' },
  { domain: 'cluster.local', service: 'foo/nginx', set: 'foo/web', setDomain: 'nginx.foo.svc.cluster.local', pod: 'web-{0..N-1}.nginx.foo.svc.cluster.local', host: 'web-{0..N-1}' },
  { domain: 'kube.local', service: 'foo/nginx', set: 'foo/web', setDomain: 'nginx.foo.svc.kube.local', pod: 'web-{0..N-1}.nginx.foo.svc.kube.local', host: 'web-{0..N-1}' },
];

export const DNS_TABLE = {
  head: ['Домен кластера', 'Сервис', 'StatefulSet', 'Домен набора', 'DNS-имя пода', 'Имя хоста'],
  rows: DNS_EXAMPLES.map((e) => [e.domain, e.service, e.set, e.setDomain, e.pod, e.host].map((x) => `\`${x}\``)),
  cols: 'minmax(110px,.6fr) minmax(110px,.6fr) minmax(100px,.6fr) minmax(200px,1.1fr) minmax(250px,1.4fr) minmax(100px,.5fr)',
  kinds: ['mono', 'mono', 'mono', 'mono', 'mono', 'mono'] as 'mono'[],
  minWidth: 960,
};

export const DNS_NOTE =
  'Два свойства этих имён легко принять за поломку. Первое: в DNS попадает только **готовый** под. Пока `db-1` не прошёл readiness-пробу, имени `db-1.db` не существует — а базе, которая при старте ищет соседей, нужно как раз обратное. Для этого у сервиса есть поле `publishNotReadyAddresses: true`. Второе: **негативный кеш**. Если кто-то спросил имя до того, как под появился, ответ «такого нет» запоминается, и новый под несколько секунд «не резолвится». Документация StatefulSet называет цифру: CoreDNS кеширует ответы 30 секунд. ⚠️ Оба свойства — по документации, не проверены в кластере.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 2 — тома
// ─────────────────────────────────────────────────────────────────────────────────────

export const EPHEMERAL_WHY =
  'Файл, записанный процессом в свою файловую систему, живёт в слое контейнера и пропадает при его перезапуске. Первое, что попадается под руку вместо этого, — тома `emptyDir` и `hostPath`. Оба удобны, и оба теряют данные там, где этого не ждёшь.';

export const VOLUME_KINDS = {
  head: ['Том', 'Живёт, пока…', 'Под переехал на другой узел', 'Годится для'],
  rows: [
    ['слой контейнера', 'жив **контейнер**', 'данных нет', 'ничего, что жалко потерять'],
    ['`emptyDir`', 'жив **под** — перезапуск контейнера переживает', 'данных нет: каталог удалён вместе с подом', 'кеш, временные файлы, обмен между контейнерами пода'],
    ['`emptyDir` с `medium: Memory`', 'жив под; лежит в памяти (tmpfs)', 'данных нет', 'быстрые временные файлы; **занятое идёт в лимит памяти контейнера**'],
    ['`hostPath`', 'жив **узел** и его диск', 'под видит каталог **другого** узла — пустой или чужой', 'агенты узла (логи, мониторинг); для данных приложения — нет'],
    ['PVC → сетевой диск', 'жива **заявка** (а с `Retain` — и дольше)', 'диск переподключается к новому узлу — в пределах зоны', 'данные базы'],
    ['PVC → `local`-том', 'жив узел и его диск', 'под **не переедет**: он привязан к узлу с диском', 'базы, которые сами реплицируют данные и терпят потерю узла'],
  ],
  cols: 'minmax(160px,.8fr) minmax(190px,1fr) minmax(210px,1.1fr) minmax(220px,1.2fr)',
  kinds: ['mono', 'prose', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 820,
};

export const EPHEMERAL_WARN =
  '`hostPath` опасен вдвойне. Для данных — потому что узел в кластере расходный: его заменят при обновлении, и каталог уйдёт вместе с ним. Для безопасности — потому что под получает доступ к файловой системе узла; документация Kubernetes прямо советует его избегать. ⚠️ По документации «Volumes».';

export const PLAIN_CLAIM =
  'PVC — заявка на склад: «нужна полка на 20 ГБ, быстрая, для одного узла». StorageClass — прайс-лист склада: какие полки бывают и кто их выдаёт. PV — конкретная выданная полка с инвентарным номером. Под предъявляет **заявку**, а не номер полки — поэтому под можно пересоздать хоть сто раз: заявка та же, и полка за ней та же.';

export const CLAIM_WHY =
  'Приложение просит хранилище объектом **PersistentVolumeClaim**: размер, режим доступа и класс. Kubernetes связывает заявку с подходящим **PersistentVolume** — один к одному, навсегда: связанный PV не достанется другой заявке, даже когда эта будет удалена. PV можно завести заранее руками, но чаще его создаёт драйвер по **StorageClass** — это называется динамическим выделением.';

export const PROVISION_STEPS = [
  '**Заявка.** Появляется PVC с `storageClassName: fast-ssd`. Если класс не указан, берётся класс по умолчанию — тот, что помечен аннотацией `storageclass.kubernetes.io/is-default-class: "true"`; пустая строка `""` означает «динамически не выделять».',
  '**Ожидание пода** — если у класса `volumeBindingMode: WaitForFirstConsumer`. Заявка висит в `Pending`, пока не появится под, который её использует, и планировщик не выберет ему узел.',
  '**Диск.** CSI-драйвер из поля `provisioner` создаёт диск — в зоне выбранного узла — и заводит PV с `claimRef` на заявку. Заявка переходит в `Bound`.',
  '**Подключение.** Kubelet на узле подключает диск, форматирует его при первом использовании и монтирует в контейнер по `volumeMounts`.',
  '**Защита.** Пока заявкой пользуется под, удалить её нельзя: `kubectl delete pvc` вернётся сразу, но заявка повиснет в `Terminating`, пока под не уйдёт. Это защита от удаления диска из-под работающей базы.',
];

/** Класс хранения из сквозного примера. Имя и драйвер сверяет тест. */
export const STORAGECLASS_CODE = `apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com       # CSI-драйвер облака: он создаёт диски
parameters:
  type: gp3                        # параметры понимает только этот драйвер
reclaimPolicy: Retain              # по умолчанию Delete: удалили PVC — удалили диск
volumeBindingMode: WaitForFirstConsumer    # диск — в зоне узла, куда встал под
allowVolumeExpansion: true         # PVC можно увеличить; уменьшить нельзя никогда`;

export const ACCESS_MODES = {
  head: ['Режим', 'Буквально', 'На практике'],
  rows: [
    ['`ReadWriteOnce` · RWO', 'чтение и запись с **одного узла**', 'Облачные блочные диски умеют только его. Несколько подов на **одном** узле смогут писать одновременно — ограничение про узлы, а не про поды'],
    ['`ReadOnlyMany` · ROX', 'только чтение со многих узлов', 'Редкость: общий справочник, заранее залитые данные'],
    ['`ReadWriteMany` · RWX', 'чтение и запись со многих узлов', 'Нужна файловая система по сети: NFS, CephFS, облачные файловые хранилища. Базе не нужен — она пишет с одного узла'],
    ['`ReadWriteOncePod` · RWOP', 'чтение и запись **одним подом** во всём кластере', 'Только CSI-тома. Гарантирует, что второй под с этой заявкой не запустится вовсе — даже на том же узле'],
  ],
  cols: 'minmax(190px,.8fr) minmax(200px,.9fr) minmax(320px,1.6fr)',
  kinds: ['mono', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 760,
};

export const ACCESS_NOTE =
  'Режимы доступа — **не защита от записи**. Kubernetes по ним подбирает PV к заявке и решает, куда том можно подключить, но документация отдельно предупреждает: PV в режиме `ReadOnlyMany` не обязан быть доступен только для чтения. Только для чтения том делает `readOnly: true` в `volumeMounts` пода. ⚠️ По документации «Persistent Volumes → Access Modes».';

export const RECLAIM = {
  head: ['`reclaimPolicy`', 'Что с диском после удаления заявки', 'Когда'],
  rows: [
    ['`Delete`', 'PV и диск в хранилище удаляются', '**По умолчанию** у дисков, созданных по StorageClass. Удобно для временного, опасно для базы'],
    ['`Retain`', 'PV остаётся в фазе `Released`, диск цел. Новой заявке он **не достанется** сам: на нём чужие данные, и освобождает его администратор', 'Всё, что жалко. Цена — диски, за которые платишь, пока не удалишь руками'],
  ],
  cols: 'minmax(120px,.5fr) minmax(280px,1.4fr) minmax(260px,1.2fr)',
  kinds: ['mono', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 700,
};

export const RECLAIM_NOTE =
  'У PV, выделенного динамически, политика берётся из класса в момент создания. Смена `reclaimPolicy` в StorageClass на уже созданные диски не влияет — их политику меняют правкой самого PV (`kubectl patch pv …`). ⚠️ По документации «Persistent Volumes → Reclaiming» и «Change the Reclaim Policy of a PersistentVolume».';

export const ZONE_NOTE =
  'Облачный диск живёт в одной зоне и подключается только к узлам этой зоны; драйвер записывает это в PV как ограничение `nodeAffinity`. Отсюда два следствия. С режимом `volumeBindingMode: Immediate` (умолчание) диск создаётся сразу, **до** выбора узла — возможно, в зоне, где у пода нет подходящих узлов, и под навсегда застревает в `Pending`. `WaitForFirstConsumer` откладывает создание до выбора узла и учитывает остальные требования пода. Второе следствие не лечится ничем: под с таким диском **привязан к зоне навсегда**. Упала зона — под ждёт, пока она вернётся, даже если свободных узлов в соседних зонах полно. Выжить при потере зоны база может только сама: репликой в другой зоне на другом диске. ⚠️ По документации «Storage Classes → Volume Binding Mode» и «Allowed Topologies».';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 3 — свой диск у каждой реплики
// ─────────────────────────────────────────────────────────────────────────────────────

export const VCT_WHY =
  'Поле `volumeClaimTemplates` — шаблон заявки, а не заявка. Для каждого пода контроллер заводит отдельную PVC с именем `<шаблон>-<под>`: `data-db-0`, `data-db-1`, `data-db-2`. Имя вычисляется из номера, поэтому пересозданный `db-1` на любом узле найдёт **ту же** заявку — и тот же диск, со всеми данными. Контроллер заводит заявку, только если её нет; существующую он не трогает и не пересоздаёт.';

export const VCT_TRAPS = [
  {
    t: 'Уменьшили число реплик — диски остались',
    d: 'Это умолчание и осознанное решение: удалить данные базы из-за правки одного числа было бы хуже. Цена — PVC и диски `data-db-3`, `data-db-4`, которые продолжают существовать и стоить денег, пока их не удалят руками.',
    tone: 'warn' as const,
  },
  {
    t: 'Увеличили обратно — вернулись старые данные',
    d: 'Новый `db-3` найдёт заявку `data-db-3` и подключит её вместе со всем, что там лежало месяц назад. Для базы, которая догоняет ведущую по журналу, это может сработать; для той, что не умеет, — это реплика с устаревшими данными, которая считает себя актуальной.',
    tone: 'err' as const,
  },
  {
    t: 'Размер в шаблоне не поменять',
    d: 'Изменить у существующего StatefulSet можно только `replicas`, `ordinals`, `template`, `updateStrategy`, `persistentVolumeClaimRetentionPolicy` и `minReadySeconds` — так перечисляет поля сама ошибка API-сервера. Увеличивают каждую PVC отдельно (если класс разрешает `allowVolumeExpansion`), а шаблон — удалением StatefulSet с `--cascade=orphan` и созданием заново. ⚠️ По документации и тексту ошибки, в кластере не проверялось.',
  },
];

export const RETENTION_WHY =
  'С версии 1.32 (стабильно; ⚠️ по документации) у StatefulSet есть поле `persistentVolumeClaimRetentionPolicy` из двух половин: `whenScaled` — что делать с заявками лишних реплик при уменьшении, `whenDeleted` — что делать со всеми заявками при удалении самого StatefulSet. У каждой два значения: `Retain` (умолчание) и `Delete`. Устроено это через владельцев: при `Delete` контроллер записывает в заявку ссылку на под или на StatefulSet, и сборщик мусора удаляет её **после** того, как под завершился, — чтобы диск был корректно отключён. Политика касается только удаления контроллером. Под, который упал вместе с узлом или был удалён руками, возвращается к своей заявке при любой политике.';

/**
 * Таблица «политика × событие → PVC» из раздела «PersistentVolumeClaim retention».
 * Каждую строку тест проверяет дважды: `claimFate` из `SIM_CODE` и прогоном модели целиком.
 */
export const CLAIM_CASES = [
  { whenScaled: 'Retain', whenDeleted: 'Retain', scaled: 'kept', deleted: 'kept', replaced: 'kept' },
  { whenScaled: 'Delete', whenDeleted: 'Retain', scaled: 'deleted', deleted: 'kept', replaced: 'kept' },
  { whenScaled: 'Retain', whenDeleted: 'Delete', scaled: 'kept', deleted: 'deleted', replaced: 'kept' },
  { whenScaled: 'Delete', whenDeleted: 'Delete', scaled: 'deleted', deleted: 'deleted', replaced: 'kept' },
] as const;

const fate = (x: 'kept' | 'deleted') => (x === 'kept' ? 'остаётся' : '**удаляется**');

export const CLAIM_TABLE = {
  head: ['`whenScaled`', '`whenDeleted`', 'Уменьшили `replicas` 3 → 1: `data-db-1`, `data-db-2`', 'Удалили StatefulSet: все PVC', 'Под заменён (узел, `kubectl delete pod`)'],
  rows: CLAIM_CASES.map((c) => [`\`${c.whenScaled}\``, `\`${c.whenDeleted}\``, fate(c.scaled), fate(c.deleted), fate(c.replaced)]),
  cols: 'minmax(110px,.6fr) minmax(110px,.6fr) minmax(200px,1.1fr) minmax(170px,1fr) minmax(190px,1fr)',
  kinds: ['mono', 'mono', 'prose', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 820,
};

export const LEVELS_NOTE =
  'Удаление идёт по трём ступеням, и на каждой стоит своя политика. **Под** удалён — заявке всё равно, пока `persistentVolumeClaimRetentionPolicy` не сказала иначе. **Заявка** удалена — судьбу PV и диска решает уже `reclaimPolicy`. С классом по умолчанию это `Delete`, и `whenScaled: Delete` тогда означает: уменьшили `replicas` — и диски лишних реплик **стёрты в облаке**. С `reclaimPolicy: Retain` из листинга выше диск переживёт и это — останется PV в фазе `Released`.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 4 — порядок и обновление
// ─────────────────────────────────────────────────────────────────────────────────────

export const ORDER_RULES = [
  '**Создание — по возрастанию номера:** `db-0`, потом `db-1`, потом `db-2`.',
  '**Удаление — по убыванию:** с наибольшего номера к нулю.',
  '**Прежде чем трогать под, все предшественники должны быть Running и Ready.** `db-2` не создаётся, пока не готовы `db-0` и `db-1` — и если `db-0` упал в промежутке, контроллер ждёт его возвращения.',
  '**Прежде чем удалить под, все последующие должны полностью завершиться.** `db-1` не удаляется, пока `db-2` не исчез совсем.',
];

export const ORDER_WHY =
  'Четыре гарантии из документации StatefulSet — ответ на вопрос «кто в кластере первый». Базе, которая при старте ищет ведущую реплику, удобно знать: `db-0` существует и готов раньше всех остальных, а при уменьшении он уходит последним. Цена — скорость: пять реплик с минутой на запуск каждой — это пять минут, и одна зависшая реплика останавливает всё, что за ней.';

export const POLICIES = {
  head: ['`podManagementPolicy`', 'Масштабирование', 'Обновление', 'Когда'],
  rows: [
    ['`OrderedReady`', 'по одному, по номеру, с ожиданием Ready', 'по одному, с наибольшего номера', '**Умолчание.** Базы, которым важен порядок знакомства реплик'],
    ['`Parallel`', 'все недостающие — сразу, все лишние — сразу, без ожидания', '**так же по одному** — политика на обновление не влияет', 'Реплики не зависят друг от друга, а важны только имена и диски'],
  ],
  cols: 'minmax(150px,.7fr) minmax(210px,1.1fr) minmax(210px,1.1fr) minmax(230px,1.2fr)',
  kinds: ['mono', 'prose', 'prose', 'muted'] as ('mono' | 'prose' | 'muted')[],
  minWidth: 800,
};

export const POLICY_NOTE =
  '`podManagementPolicy` задаётся при создании и потом **не меняется**: его нет в списке изменяемых полей. Передумали — StatefulSet пересоздают (поды при этом можно оставить, удалив его с `--cascade=orphan`). ⚠️ По тексту ошибки API-сервера, не проверено в кластере.';

export const UPDATE_WHY =
  'StatefulSet не может поднять новый под рядом со старым, как Deployment: у нового было бы то же имя и тот же диск, а диск с `ReadWriteOnce` к двум подам сразу не подключить. Поэтому обновление при `RollingUpdate` (умолчание) — это **удалить и создать заново**: с наибольшего номера к нулю, по одному, дожидаясь, пока обновлённый под станет Running и Ready, и ещё `minReadySeconds`, если они заданы. Вторая стратегия, `OnDelete`, не обновляет ничего сама: новая версия приходит к поду, только когда его удалят руками.';

export const PLAIN_PARTITION =
  '`partition` — шлагбаум на номере: новую версию получают только поды с номером **не меньше**. Три реплики и `partition: 3` — шлагбаум закрыт, образ сменили, а не обновился никто. Опустили до 2 — обновился один `db-2`: канарейка. Проверили, опустили до 0 — поехали остальные. Поды ниже шлагбаума стоят на старой версии **даже если их удалить**: вернутся той же старой.';

export const PARTITION_NOTE =
  'Поле `maxUnavailable` у `rollingUpdate` позволяет обновлять несколько подов разом, но долго было за флагом возможностей (`MaxUnavailableStatefulSet`) — на своей версии проверяйте по документации. Модель темы его не знает и обновляет строго по одному, как по умолчанию.';

export const BROKEN_ROLLOUT =
  'Самая неприятная особенность `OrderedReady` с `RollingUpdate`: если новая версия **никогда** не становится Ready — образ с опечаткой, падение при старте, — выкат останавливается и ждёт вечно. Вернуть старый шаблон мало: контроллер по-прежнему ждёт, пока застрявший под станет Ready, прежде чем что-то делать. Документация называет это «forced rollback»: после отката шаблона застрявшие поды надо **удалить руками**, и только тогда они вернутся старой версией. ⚠️ По документации «StatefulSets → Forced rollback».';

export const SIM_WHY =
  'Правила выше — одной функцией. Модель ниже не исходник Kubernetes, а те же четыре гарантии, политика подов, обновление с `partition` и судьба заявок, записанные кодом. Один вызов `sync()` — один проход контроллера: сначала реплики по возрастанию номера, потом лишние поды по убыванию, потом обновление. `settle()` — то, что делают kubelet и сборщик мусора между проходами: завершившиеся поды исчезают, а за ними заявки, у которых владелец — под. Её же исполняет демо «Контроллер по шагам».';

export const SIM_CODE = `// Учебная модель контроллера StatefulSet. Не исходник Kubernetes, а правила
// из документации: «Deployment and Scaling Guarantees», «Pod Management
// Policies», «Rolling Updates» и «PersistentVolumeClaim retention».
// Один вызов sync() — один проход контроллера.

const podName = (set, ord) => set.name + '-' + ord;
const claimName = (set, ord) => set.claim + '-' + podName(set, ord);

// DNS-имя пода: <под>.<headless-сервис>.<пространство имён>.svc.<домен кластера>
function podFqdn(set, ord, domain = 'cluster.local') {
  return podName(set, ord) + '.' + set.serviceName + '.' + set.namespace + '.svc.' + domain;
}

// Что станет с PVC реплики. event: 'scale-down' | 'set-deleted' | 'pod-replaced'
function claimFate(policy, event) {
  if (event === 'scale-down') return policy.whenScaled === 'Delete' ? 'deleted' : 'kept';
  if (event === 'set-deleted') return policy.whenDeleted === 'Delete' ? 'deleted' : 'kept';
  return 'kept'; // под заменили (удалили руками, пропал узел): PVC остаётся при любой политике
}

function create(spec) {
  return {
    name: spec.name, serviceName: spec.serviceName, namespace: spec.namespace, claim: spec.claim,
    replicas: spec.replicas,
    podManagementPolicy: spec.podManagementPolicy || 'OrderedReady',
    partition: spec.partition || 0,
    retention: spec.retention || { whenScaled: 'Retain', whenDeleted: 'Retain' },
    currentRevision: 1, updateRevision: 1,
    pods: [], claims: [], deleted: false,
  };
}

const copy = (set) => JSON.parse(JSON.stringify(set));
const find = (set, ord) => set.pods.find((p) => p.ord === ord);
const healthy = (p) => p.ready && !p.terminating;

function sync(prev) {
  const set = copy(prev);
  const log = [];
  const say = (kind, ord, text, rev) => log.push({ kind, ord, text, rev });
  const out = () => ({ set, log });
  const n = (ord) => podName(set, ord);

  if (set.deleted) {
    // StatefulSet удалён: порядок завершения подов не гарантирован — все разом.
    for (const p of set.pods) {
      if (p.terminating) continue;
      p.terminating = true;
      say('delete', p.ord, 'удалить ' + n(p.ord) + ' — StatefulSet удалён, порядка нет');
    }
    return out();
  }

  const ordered = set.podManagementPolicy === 'OrderedReady';

  // 1. Реплики 0 … replicas−1 — по возрастанию номера.
  for (let ord = 0; ord < set.replicas; ord++) {
    const p = find(set, ord);
    if (!p) {
      const c = set.claims.find((x) => x.ord === ord);
      if (c) say('reuse', ord, 'PVC ' + c.name + ' уже есть — под получит прежние данные');
      else {
        set.claims.push({ ord, name: claimName(set, ord), owner: null });
        say('claim', ord, 'создать PVC ' + claimName(set, ord));
      }
      // Ниже partition под возвращается прежней версией — даже если его удалили.
      const rev = ord < set.partition ? set.currentRevision : set.updateRevision;
      set.pods.push({ ord, rev, ready: false, terminating: false });
      say('create', ord, 'создать ' + n(ord) + ' (v' + rev + ')', rev);
      if (ordered) { say('wait', ord, 'ждать, пока ' + n(ord) + ' станет Running и Ready'); return out(); }
    } else if (p.terminating) {
      if (ordered) { say('wait', ord, 'ждать, пока ' + n(ord) + ' завершится'); return out(); }
    } else if (!p.ready && ordered) {
      say('wait', ord, 'ждать, пока ' + n(ord) + ' станет Ready');
      return out();
    }
  }

  // 2. Лишние поды (номер ≥ replicas) — начиная с наибольшего номера.
  const condemned = set.pods.filter((p) => p.ord >= set.replicas).sort((a, b) => b.ord - a.ord);
  for (const p of condemned) {
    if (p.terminating) {
      if (ordered) { say('wait', p.ord, 'ждать, пока ' + n(p.ord) + ' завершится'); return out(); }
      continue;
    }
    // Все предшественники удаляемого должны быть Running и Ready.
    const blocker = set.pods.filter((q) => q.ord < p.ord && !healthy(q)).sort((a, b) => a.ord - b.ord)[0];
    if (ordered && blocker) {
      say('wait', blocker.ord, 'ждать, пока ' + n(blocker.ord) + ' станет Ready');
      return out();
    }
    p.terminating = true;
    say('delete', p.ord, 'удалить ' + n(p.ord) + ' — лишний после уменьшения');
    const c = set.claims.find((x) => x.ord === p.ord);
    if (c && claimFate(set.retention, 'scale-down') === 'deleted') {
      c.owner = 'pod';
      say('doom', p.ord, 'PVC ' + c.name + ' уйдёт следом за подом (whenScaled: Delete)');
    } else if (c) {
      say('keep', p.ord, 'PVC ' + c.name + ' остаётся (whenScaled: Retain)');
    }
    if (ordered) return out();
  }

  // 3. Обновление: с наибольшего номера вниз до partition, по одному поду за раз.
  //    Политика Parallel сюда не дотягивается — она про масштабирование.
  const replicas = set.pods.filter((p) => p.ord < set.replicas);
  const stale = replicas.some((p) => p.ord >= set.partition && p.rev !== set.updateRevision);
  if (stale) {
    for (let ord = set.replicas - 1; ord >= set.partition; ord--) {
      const p = find(set, ord);
      if (!p) return out();
      if (p.rev !== set.updateRevision && !p.terminating) {
        p.terminating = true;
        say('update', ord, 'удалить ' + n(ord) + ' (v' + p.rev + ') — вернётся с v' + set.updateRevision);
        return out();
      }
      if (!healthy(p)) { say('wait', ord, 'ждать, пока ' + n(ord) + ' станет Ready'); return out(); }
    }
  }

  const complete = replicas.length === set.replicas &&
    replicas.every((p) => p.rev === set.updateRevision && healthy(p));
  if (complete && set.currentRevision !== set.updateRevision) {
    set.currentRevision = set.updateRevision;
    say('done', -1, 'все реплики на v' + set.updateRevision + ' — выкат закончен');
  }
  return out();
}

// Kubelet и сборщик мусора: завершающиеся поды исчезают, PVC с владельцем-подом — следом.
function settle(prev) {
  const set = copy(prev);
  const log = [];
  const gone = set.pods.filter((p) => p.terminating).sort((a, b) => b.ord - a.ord);
  for (const p of gone) {
    log.push({ kind: 'gone', ord: p.ord, text: podName(set, p.ord) + ' завершился' });
    const c = set.claims.find((x) => x.ord === p.ord);
    if (c && c.owner === 'pod') {
      set.claims = set.claims.filter((x) => x !== c);
      log.push({ kind: 'claim-gone', ord: p.ord, text: 'PVC ' + c.name + ' удалён сборщиком мусора' });
    }
  }
  set.pods = set.pods.filter((p) => !p.terminating);

  if (set.deleted && set.pods.length === 0 && !set.finalized) {
    set.finalized = true;
    const fate = claimFate(set.retention, 'set-deleted');
    for (const c of set.claims) {
      log.push(fate === 'deleted'
        ? { kind: 'claim-gone', ord: c.ord, text: 'PVC ' + c.name + ' удалён следом за StatefulSet (whenDeleted: Delete)' }
        : { kind: 'keep', ord: c.ord, text: 'PVC ' + c.name + ' остался без владельца (whenDeleted: Retain)' });
    }
    if (fate === 'deleted') set.claims = [];
  }
  return { set, log };
}

function step(prev) {
  const a = settle(prev);
  const b = sync(a.set);
  const log = a.log.concat(b.log);
  if (log.length === 0) log.push({ kind: 'idle', ord: -1, text: 'желаемое совпадает с действительным — делать нечего' });
  return { set: b.set, log };
}

// Под прошёл readiness-пробу.
function ready(prev, ord) {
  const set = copy(prev);
  const p = find(set, ord);
  if (!p || p.ready || p.terminating) return { set, log: [] };
  p.ready = true;
  return { set, log: [{ kind: 'ready', ord, text: podName(set, ord) + ' прошёл readiness-пробу' }] };
}

// Под удалили руками или потеряли вместе с узлом. PVC это не трогает.
function kill(prev, ord) {
  const set = copy(prev);
  const p = find(set, ord);
  if (!p || p.terminating) return { set, log: [] };
  p.terminating = true;
  const c = set.claims.find((x) => x.ord === ord);
  const log = [{ kind: 'kill', ord, text: podName(set, ord) + ' удалён не контроллером' }];
  if (c && claimFate(set.retention, 'pod-replaced') === 'kept') {
    log.push({ kind: 'keep', ord, text: 'PVC ' + c.name + ' остаётся: под вернётся к нему' });
  }
  return { set, log };
}

const patch = (prev, fields) => Object.assign(copy(prev), fields);
const scale = (set, replicas) => patch(set, { replicas });
const updateImage = (set) => patch(set, { updateRevision: set.updateRevision + 1 });
const setPartition = (set, partition) => patch(set, { partition });
const setRetention = (set, retention) => patch(set, { retention });
const remove = (set) => patch(set, { deleted: true });

return {
  podName, claimName, podFqdn, claimFate, create, sync, settle, step, ready, kill,
  scale, updateImage, setPartition, setRetention, remove,
};`;

/**
 * Случаи из документации: раздел «Deployment and Scaling Guarantees» (описанные словами
 * сценарии с web-0/web-1/web-2), «Pod Management Policies», «Rolling Updates» и учебник
 * «StatefulSet Basics» (Staging an update, Rolling out a canary). Имена заменены
 * на сквозной пример темы. Столбец `trace` тест пересчитывает `play` из `widgets/sts-controller`
 * на `SIM_CODE`; в `run` новые поды становятся Ready сразу после прохода.
 */
export const ORDER_CASES = [
  {
    id: 'up',
    what: 'Создать три реплики с нуля',
    policy: 'OrderedReady',
    from: 'empty',
    script: ['scale 3', 'run'],
    trace: 'создать db-0 (v1), ждать db-0 → создать db-1 (v1), ждать db-1 → создать db-2 (v1), ждать db-2',
    doc: 'Deployment and Scaling Guarantees',
  },
  {
    id: 'up-fail',
    what: '`db-0` упал, когда `db-1` уже готов, а `db-2` ещё не создан',
    policy: 'OrderedReady',
    from: 'empty',
    script: ['scale 3', 'step', 'ready 0', 'step', 'ready 1', 'kill 0', 'step', 'step', 'ready 0', 'step'],
    trace: 'создать db-0 (v1), ждать db-0 → db-0 готов → создать db-1 (v1), ждать db-1 → db-1 готов → db-0 упал → db-0 завершился, создать db-0 (v1), ждать db-0 → ждать db-0 → db-0 готов → создать db-2 (v1), ждать db-2',
    doc: 'Deployment and Scaling Guarantees',
  },
  {
    id: 'down',
    what: 'Уменьшить с 3 до 1',
    policy: 'OrderedReady',
    from: 'settled',
    script: ['scale 1', 'run'],
    trace: 'удалить db-2 → db-2 завершился, удалить db-1 → db-1 завершился',
    doc: 'Deployment and Scaling Guarantees',
  },
  {
    id: 'down-fail',
    what: '`db-0` упал после удаления `db-2`, но до удаления `db-1`',
    policy: 'OrderedReady',
    from: 'settled',
    script: ['scale 1', 'step', 'kill 0', 'step', 'step', 'ready 0', 'step'],
    trace: 'удалить db-2 → db-0 упал → db-2 завершился, db-0 завершился, создать db-0 (v1), ждать db-0 → ждать db-0 → db-0 готов → удалить db-1',
    doc: 'Deployment and Scaling Guarantees',
  },
  {
    id: 'parallel-up',
    what: 'Создать три реплики с нуля',
    policy: 'Parallel',
    from: 'empty',
    script: ['scale 3', 'step'],
    trace: 'создать db-0 (v1), создать db-1 (v1), создать db-2 (v1)',
    doc: 'Pod Management Policies',
  },
  {
    id: 'parallel-down',
    what: 'Уменьшить с 3 до 1',
    policy: 'Parallel',
    from: 'settled',
    script: ['scale 1', 'step', 'step'],
    trace: 'удалить db-2, удалить db-1 → db-2 завершился, db-1 завершился',
    doc: 'Pod Management Policies',
  },
  {
    id: 'rolling',
    what: 'Сменить образ',
    policy: 'OrderedReady',
    from: 'settled',
    script: ['image', 'run'],
    trace: 'заменить db-2 → db-2 завершился, создать db-2 (v2), ждать db-2 → заменить db-1 → db-1 завершился, создать db-1 (v2), ждать db-1 → заменить db-0 → db-0 завершился, создать db-0 (v2), ждать db-0 → выкат закончен',
    doc: 'Rolling Updates',
  },
  {
    id: 'parallel-rolling',
    what: 'Сменить образ',
    policy: 'Parallel',
    from: 'settled',
    script: ['image', 'run'],
    trace: 'заменить db-2 → db-2 завершился, создать db-2 (v2), ждать db-2 → заменить db-1 → db-1 завершился, создать db-1 (v2), ждать db-1 → заменить db-0 → db-0 завершился, создать db-0 (v2) → выкат закончен',
    doc: 'Pod Management Policies',
  },
  {
    id: 'staged',
    what: '`partition: 3`, сменить образ, потом удалить `db-2`',
    policy: 'OrderedReady',
    from: 'settled',
    partition: 3,
    script: ['image', 'run', 'kill 2', 'run'],
    trace: 'db-2 упал → db-2 завершился, создать db-2 (v1), ждать db-2',
    doc: 'StatefulSet Basics: Staging an update',
  },
  {
    id: 'canary',
    what: '`partition: 3`, сменить образ, опустить `partition` до 2',
    policy: 'OrderedReady',
    from: 'settled',
    partition: 3,
    script: ['image', 'partition 2', 'run'],
    trace: 'заменить db-2 → db-2 завершился, создать db-2 (v2), ждать db-2',
    doc: 'StatefulSet Basics: Rolling out a canary',
  },
] as const;

export const ORDER_TABLE = {
  head: ['Ситуация', 'Политика', 'Что делает контроллер — по проходам', 'Где в документации'],
  rows: ORDER_CASES.map((c) => [c.what, `\`${c.policy}\``, c.trace, c.doc]),
  cols: 'minmax(190px,1fr) minmax(120px,.5fr) minmax(360px,2.2fr) minmax(160px,.8fr)',
  kinds: ['prose', 'mono', 'mono', 'muted'] as ('prose' | 'mono' | 'muted')[],
  minWidth: 960,
};

export const ORDER_TABLE_NOTE =
  'Стрелка — следующий проход контроллера, запятая — действия внутри одного прохода. Столбец с действиями — вывод модели выше на случаях, которые документация описывает словами. Две последние строки — из учебника «StatefulSet Basics»: при `partition: 3` смена образа не обновила никого, а удалённый `db-2` вернулся **старой** версией.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 5 — демо
// ─────────────────────────────────────────────────────────────────────────────────────

/** Набор, с которого начинает демо: тот же, что в `STS_CODE`. Совпадение сверяет тест. */
export const DEMO_SET = { name: 'db', serviceName: 'db', namespace: 'shop', claim: 'data', replicas: 3 };

export const DEMO_NOTE =
  'Состояние демо — объект из сквозного листинга: StatefulSet `db` в пространстве `shop` с шаблоном тома `data`, три реплики, все на v1 и готовы. Каждая кнопка правит объект так, как это сделал бы `kubectl apply`, а «проход контроллера» вызывает `step()` из кода выше.';

export const DEMO_CAPTION =
  'Контроллер ничего не делает сам по себе: каждое нажатие «проход контроллера» — один вызов `step()`. Новый под готов, только когда вы нажмёте «готов» — так видно, где `OrderedReady` ждёт, а `Parallel` нет. «Уронить» — под удалили руками или потеряли вместе с узлом: контроллер вернёт его с тем же именем к той же заявке. `podManagementPolicy` в кластере не меняется у живого объекта, поэтому переключатель начинает набор заново.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 6 — копии, снапшоты и операторы
// ─────────────────────────────────────────────────────────────────────────────────────

export const BACKUP_WHY =
  'PVC с `Retain` защищает от одной ошибки — случайного удаления объекта. От всего остального — `DELETE` без `WHERE`, сломанной миграции, испорченного диска, удалённого облачного аккаунта — защищает только **копия, лежащая в другом месте**. Kubernetes даёт для этого один инструмент на уровне дисков — снапшот тома; всё, что на уровне базы, остаётся базе.';

/** Снапшот PVC первой реплики и восстановление из него. Имена сверяет тест со сквозным примером. */
export const SNAPSHOT_CODE = `apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: ebs-snap
driver: ebs.csi.aws.com            # тот же драйвер, что создаёт диски класса fast-ssd
deletionPolicy: Retain             # удалили объект снапшота — сам снапшот в облаке остался
---
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: data-db-0-before-migration
  namespace: shop
spec:
  volumeSnapshotClassName: ebs-snap
  source:
    persistentVolumeClaimName: data-db-0   # заявка первой реплики
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data-db-0-restored
  namespace: shop
spec:
  storageClassName: fast-ssd
  dataSource:                      # новый диск — из снапшота, а не пустой
    name: data-db-0-before-migration
    kind: VolumeSnapshot
    apiGroup: snapshot.storage.k8s.io
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 20Gi                # не меньше размера исходного тома`;

export const SNAPSHOT_FACTS = [
  {
    t: 'Не входит в ядро',
    d: '`VolumeSnapshot`, `VolumeSnapshotContent` и `VolumeSnapshotClass` — собственные виды объектов (CRD), а создаёт снапшоты отдельный контроллер снапшотов вместе с CSI-драйвером. Документация прямо говорит, что их ставит дистрибутив или администратор; работают снапшоты только с CSI-томами. ⚠️ По документации «Volume Snapshots».',
  },
  {
    t: 'Снимок диска, а не базы',
    d: 'Снапшот работающей базы — как диск после выдёргивания питания: база, пишущая журнал (Postgres, MySQL), обычно поднимется с него, пройдя восстановление. Но согласованности на уровне приложения снапшот не обещает, и снимки двух дисков одной базы сделаны не одновременно. Надёжнее — остановить запись на время снимка или пользоваться средствами самой базы.',
    tone: 'warn' as const,
  },
  {
    t: 'Лежит рядом',
    d: 'Снапшот облачного диска обычно хранится в том же аккаунте и регионе. От случайного удаления PVC он спасёт, от потери аккаунта или региона — нет. Для этого копию выносят в другое место: другой аккаунт, другой регион, другое хранилище.',
  },
  {
    t: 'Восстановление — это новый диск',
    d: 'Снапшот нельзя «откатить» поверх живого тома: из него создают **новую** PVC через `dataSource` и подключают к поду. Со StatefulSet это значит — удалить старую заявку `data-db-0` и создать на её месте новую с тем же именем, чтобы под её нашёл.',
  },
];

export const BACKUP_KINDS = {
  head: ['Способ', 'Что сохраняет', 'Восстановить на момент', 'Кто делает'],
  rows: [
    ['Снапшот тома', 'содержимое диска целиком', 'снимка', 'CSI-драйвер по `VolumeSnapshot`'],
    ['Логическая копия (`pg_dump`)', 'схему и данные SQL-командами', 'начала выгрузки', 'сама база; `CronJob` в кластере'],
    ['Базовая копия + архив журнала (WAL)', 'файлы базы и все изменения после них', '**любую секунду** в пределах архива', 'база и её инструменты: pgBackRest, Barman, WAL-G — обычно через оператора'],
  ],
  cols: 'minmax(180px,.9fr) minmax(200px,1fr) minmax(160px,.8fr) minmax(220px,1.1fr)',
  kinds: ['prose', 'muted', 'prose', 'muted'] as ('prose' | 'muted')[],
  minWidth: 780,
};

export const OPERATOR_WHY =
  'StatefulSet знает про имена, порядок и диски — и ничего про то, что «ведущая упала, надо повысить ведомую» или «пора снять копию». Это знание кладут в **оператор**: контроллер, который следит за собственным видом объектов и делает работу администратора конкретной базы. Документация Kubernetes перечисляет, что обычно поручают оператору: разворачивать приложение по запросу, снимать и восстанавливать копии, обновлять код приложения вместе со схемой и настройками, публиковать сервис для приложений, не знающих API Kubernetes, имитировать отказы для проверки устойчивости и выбирать лидера там, где приложение не умеет этого само.';

export const OPERATOR_CODE = `# Объект оператора CloudNativePG: одна запись вместо StatefulSet, сервисов и скриптов
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: db
  namespace: shop
spec:
  instances: 3                     # ведущая и две ведомые — репликацию настроит оператор
  storage:
    storageClass: fast-ssd
    size: 20Gi`;

export const OPERATOR_FACTS = [
  {
    t: 'Что остаётся на вас',
    d: 'Оператор — тоже программа в кластере: его ставят, обновляют и читают его документацию. Он снимает рутину, но не ответственность: куда уходят копии, проверено ли восстановление, что будет при потере зоны — решаете вы.',
  },
  {
    t: 'StatefulSet — не обязательно',
    d: 'Операторы не обязаны строиться поверх StatefulSet. CloudNativePG, например, по своей документации управляет подами и PVC напрямую: ему нужно решать, какой под ведущий, а порядок `db-0 → db-1` ему только мешает. ⚠️ По документации CloudNativePG, в кластере не проверялось.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 7 — в кластере или снаружи
// ─────────────────────────────────────────────────────────────────────────────────────

export const OUTSIDE_WHY =
  'Всё выше — это работа, которую управляемая база (Amazon RDS, Cloud SQL, Azure Database, Managed PostgreSQL у российских облаков) делает за вас и за которую вы платите в счёте. Вопрос не «можно ли держать базу в Kubernetes» — можно, — а **кто будет делать эту работу в три часа ночи**.';

export const OUTSIDE_TABLE = {
  head: ['Задача', 'Управляемая база', 'База в кластере'],
  rows: [
    ['Резервные копии и восстановление на момент времени', 'включается настройкой, срок хранения — параметр', 'оператор или свои `CronJob`; проверка восстановления — ваша'],
    ['Отказ ведущей реплики', 'переключение делает провайдер', 'оператор; без него — вы, руками'],
    ['Обновление версии базы', 'окно обслуживания, минорные — автоматически', 'выкат нового образа и миграция данных между мажорными версиями'],
    ['Диск и его рост', 'часто растёт сам', 'PVC, `allowVolumeExpansion`, наблюдение за заполнением'],
    ['Потеря зоны', 'реплика в другой зоне — галочка', 'реплика в другой зоне на своём диске — настройка базы или оператора'],
    ['Цена', 'дороже тех же ресурсов', 'дешевле по счёту, дороже по времени людей'],
  ],
  cols: 'minmax(210px,1fr) minmax(220px,1.1fr) minmax(250px,1.2fr)',
  kinds: ['prose', 'muted', 'muted'] as ('prose' | 'muted')[],
  minWidth: 760,
};

export const OUTSIDE_NOTE =
  '⚠️ Правый и средний столбцы — общий обзор, а не обещания конкретного провайдера: сроки хранения копий, время переключения и что именно обновляется само, читайте в документации своего облака.';

export const OUTSIDE_VERDICT =
  'Честный вывод для небольшого проекта: **база — снаружи, в управляемом сервисе, а кластер — для приложений без состояния.** Внутри кластера базу держат там, где её потеря ничего не стоит (окружения для веток, тесты, кеш без обязательств), там, где облака нет (свои серверы), и там, где в команде уже есть человек, знающий и базу, и оператор. StatefulSet при этом остаётся полезным — для того, что не является основной базой: брокера очередей в тестовом окружении, поисковика, который можно переиндексировать, кеша с диском.';

export const EXTERNAL_WHY =
  'Приложению в кластере удобно ходить к внешней базе по короткому имени, как к любому сервису. Для этого есть сервис типа `ExternalName`: DNS отвечает по его имени псевдонимом (CNAME) на внешний адрес. Сменили базу — поправили один объект, а не конфигурацию всех приложений. Про сервисы без селектора — в разделе [«Сервис»](/delivery/kubernetes/#s2).';

/** Внешняя база под внутренним именем. Разбирает тест; адрес — выдуманный. */
export const EXTERNAL_CODE = `apiVersion: v1
kind: Service
metadata:
  name: db
  namespace: shop
spec:
  type: ExternalName
  externalName: shop-db.abc123.eu-central-1.rds.amazonaws.com   # адрес управляемой базы`;

export const EXTERNAL_NOTE =
  '`ExternalName` — только DNS-псевдоним. Порт он не переназначает, а TLS с проверкой имени сломается: клиент подключается к `db.shop.svc.cluster.local`, а сертификат выписан на имя провайдера. Документация сервисов предупреждает об этом прямо. Если нужна проверка сертификата (`sslmode=verify-full` у Postgres), клиенту дают настоящее имя базы, а `ExternalName` оставляют для удобства внутри кластера. ⚠️ По документации «Service → ExternalName».';

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 8 — тонкие места
// ─────────────────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Выкат застрял навсегда, и откат не помогает',
    d: 'С `OrderedReady` и `RollingUpdate` под новой версии, который никогда не станет Ready, останавливает выкат. Вернули старый шаблон — ничего не происходит: контроллер ждёт того же застрявшего пода. Лечение из документации — удалить застрявшие поды руками после отката. Проверяйте новую версию на одной реплике через `partition`, а не на всех сразу.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Под на пропавшем узле не пересоздаётся',
    d: 'StatefulSet гарантирует: подов с именем `db-1` не больше одного. Узел перестал отвечать — контроллер не знает, жив ли под на нём, и **не создаёт замену**, пока тот не удалён по-настоящему. `kubectl delete pod --force` снимает ожидание, но если узел на самом деле жив, в один диск начнут писать два процесса. Документация описывает безопасный путь: убедиться, что узел выключен, и пометить его taint-ом `node.kubernetes.io/out-of-service`. ⚠️ По документации «Force Delete StatefulSet Pods» и «Non-graceful node shutdown».',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Удалили PVC — удалили диск',
    d: 'У дисков, созданных по StorageClass, `reclaimPolicy` по умолчанию — `Delete`. Удаление заявки (руками, через `whenScaled: Delete` или вместе с пространством имён) стирает диск в облаке без корзины. Для данных — класс с `Retain` или `kubectl patch pv` на уже созданных томах.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Реплика вернулась с месячными данными',
    d: 'Уменьшили до 1, через месяц увеличили до 3 — `db-1` и `db-2` подключили свои старые заявки со старыми данными. База, которая не умеет догонять ведущую по журналу или проверять это, получит реплику, уверенную в своей актуальности. Перед увеличением решите, что делать со старыми заявками: удалить или оставить сознательно.',
    tone: 'warn',
  },
  {
    n: '05',
    t: '`Pending` навсегда после переезда',
    d: 'Облачный диск подключается только в своей зоне. Под с таким диском не встанет в другой зоне, даже если там полно места; в событиях пода — `volume node affinity conflict`. При `volumeBindingMode: Immediate` так можно застрять с первого же запуска: диск создали до выбора узла. `WaitForFirstConsumer` лечит второе, от первого спасает только реплика базы в другой зоне.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'Deployment с диском `ReadWriteOnce`',
    d: 'Одна реплика, один диск — работает, пока не придёт выкат. `RollingUpdate` поднимает новый под рядом со старым; если он попал на другой узел, диск туда не подключится, пока его держит старый, — в событиях `Multi-Attach error`, и выкат висит. Для Deployment с таким диском ставят `strategy: Recreate`, а лучше — StatefulSet.',
    tone: 'warn',
  },
  {
    n: '07',
    t: '`ReadOnlyMany` не делает том только для чтения',
    d: 'Режим доступа нужен для подбора PV и решения, куда подключать том. Запрета записи он не обещает — это прямо написано в документации. Только для чтения том делает `readOnly: true` в `volumeMounts`.',
  },
  {
    n: '08',
    t: '`emptyDir` под «временную» базу',
    d: 'Для окружения на ветку кажется достаточным: под живёт — данные есть. Но под переезжает при каждом обновлении узла и каждом вытеснении, а с ним уходит и `emptyDir`. С `medium: Memory` вдобавок всё записанное считается в лимит памяти контейнера — база растёт и получает `OOMKilled`.',
  },
  {
    n: '09',
    t: 'Имя пода есть, а DNS молчит',
    d: 'Не готовый под в DNS не попадает, а ответ «такого имени нет» кешируется — CoreDNS держит его до 30 секунд. Базе, которая при первом старте ищет соседей по именам, нужен `publishNotReadyAddresses: true` у headless-сервиса, а клиентам — повтор с задержкой, а не падение с первого `ENOTFOUND`.',
  },
  {
    n: '10',
    t: 'Удаление StatefulSet — не остановка по порядку',
    d: 'Порядок завершения — гарантия масштабирования, а не удаления. При `kubectl delete statefulset` поды уходят как придётся. Нужна корректная остановка — сначала `replicas: 0` и дождаться, потом удалять. ⚠️ По документации «StatefulSets → Limitations».',
  },
  {
    n: '11',
    t: 'Размер тома в шаблоне и `podManagementPolicy` не меняются',
    d: 'Оба поля вне списка изменяемых, и `kubectl apply` ответит ошибкой `Forbidden`. Увеличивают каждую PVC отдельно, а шаблон и политику меняют пересозданием StatefulSet с `--cascade=orphan` — поды и заявки при этом остаются на месте.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────────────
// Раздел 9 — источники
// ─────────────────────────────────────────────────────────────────────────────────────

export const SOURCES = [
  {
    title: 'Kubernetes: StatefulSets',
    href: 'https://kubernetes.io/docs/concepts/workloads/controllers/statefulset/',
    what: 'гарантии порядка и **сценарии с web-0/web-1/web-2**, `podManagementPolicy`, `RollingUpdate` и `partition`, forced rollback, **таблица DNS-имён**, имена PVC, `persistentVolumeClaimRetentionPolicy`, ограничения',
  },
  {
    title: 'Kubernetes: StatefulSet Basics',
    href: 'https://kubernetes.io/docs/tutorials/stateful-application/basic-stateful-set/',
    what: 'учебник: headless-сервис, порядок создания, **staging и canary через `partition`**, `Parallel`',
  },
  {
    title: 'Kubernetes: Force Delete StatefulSet Pods',
    href: 'https://kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod/',
    what: 'почему контроллер не заменяет под на недоступном узле и чем опасно принудительное удаление',
  },
  {
    title: 'Kubernetes: Node Shutdowns',
    href: 'https://kubernetes.io/docs/concepts/cluster-administration/node-shutdown/',
    what: 'non-graceful shutdown и taint `node.kubernetes.io/out-of-service`',
  },
  {
    title: 'Kubernetes: Persistent Volumes',
    href: 'https://kubernetes.io/docs/concepts/storage/persistent-volumes/',
    what: 'связывание PV и PVC, защита используемой заявки, `reclaimPolicy`, фазы, режимы доступа и предупреждение, что они не защищают от записи, расширение заявок',
  },
  {
    title: 'Kubernetes: Storage Classes',
    href: 'https://kubernetes.io/docs/concepts/storage/storage-classes/',
    what: 'класс по умолчанию, `reclaimPolicy`, `allowVolumeExpansion`, `volumeBindingMode` и топология',
  },
  {
    title: 'Kubernetes: Dynamic Volume Provisioning',
    href: 'https://kubernetes.io/docs/concepts/storage/dynamic-provisioning/',
    what: 'как заявка превращается в диск и что значит `storageClassName: ""`',
  },
  {
    title: 'Kubernetes: Volumes',
    href: 'https://kubernetes.io/docs/concepts/storage/volumes/',
    what: '`emptyDir` (в том числе `medium: Memory`), `hostPath` и его риски, `local`',
  },
  {
    title: 'Kubernetes: Volume Snapshots',
    href: 'https://kubernetes.io/docs/concepts/storage/volume-snapshots/',
    what: '`VolumeSnapshot`, `VolumeSnapshotClass`, `deletionPolicy`, восстановление через `dataSource`; снапшоты только для CSI',
  },
  {
    title: 'Kubernetes: DNS for Services and Pods',
    href: 'https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/',
    what: 'имена подов за headless-сервисом, `hostname` и `subdomain`',
  },
  {
    title: 'Kubernetes: Service → ExternalName',
    href: 'https://kubernetes.io/docs/concepts/services-networking/service/#externalname',
    what: 'CNAME на внешний адрес и предупреждение про HTTP и TLS',
  },
  {
    title: 'Kubernetes: Operator pattern',
    href: 'https://kubernetes.io/docs/concepts/extend-kubernetes/operator/',
    what: 'что такое оператор и **список того, что ему обычно поручают**',
  },
  {
    title: 'CloudNativePG: документация',
    href: 'https://cloudnative-pg.io/documentation/current/',
    what: 'объект `Cluster`, копии и восстановление на момент времени; управление подами и PVC без StatefulSet',
  },
  {
    title: 'Docker Hub: postgres',
    href: 'https://hub.docker.com/_/postgres',
    what: '`PGDATA` в подкаталоге точки монтирования и обязательный `POSTGRES_PASSWORD`',
  },
];

export const RELATED =
  'Смежное на сайте: [Kubernetes: развёртывание](/delivery/kubernetes/) — под, сервис, пробы и выкат Deployment, на которые опирается StatefulSet. [Docker Compose](/delivery/compose/#s4) — тома и данные на одной машине. [Helm, Kustomize и GitOps](/delivery/helm-gitops/) — как один StatefulSet доезжает до dev, stage и prod с разными размерами дисков. [Вход в кластер: Ingress и Gateway API](/delivery/ingress/) — как запрос снаружи доходит до приложения, которое ходит в базу.';

// ─────────────────────────────────────────────────────────────────────────────────────
// Трудные места — подробно
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Один файл базы и четыре события. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. `VOLUME_KINDS` сводила шесть видов томов в одну таблицу;
 * здесь четыре из них прослежены на одном файле через одни и те же события. Поведение —
 * ровно `VOLUME_KINDS`, `EPHEMERAL_WARN` и `ZONE_NOTE` (документация «Volumes»,
 * «Persistent Volumes»); в кластере не проверялось.
 */
export const VOLUME_SCENE: string[] = [
  'Под `db-0` из сквозного примера пишет файлы базы в `/var/lib/postgresql/data`. С ним по очереди случается четыре события, и все они — обычная жизнь кластера. **Первое:** Postgres падает, kubelet перезапускает контейнер в том же поде. **Второе:** под удаляют (`kubectl delete pod`), и контроллер создаёт его заново на том же узле. **Третье:** узел уходит на обслуживание, и под пересоздаётся на другом узле той же зоны. **Четвёртое:** узел, на котором под жил вначале, заменяют новым при обновлении кластера.',
  'Что было бы, **если бы тома не было вовсе** и база писала в собственную файловую систему контейнера. Это слой контейнера: он живёт, пока жив контейнер. Первое же событие — обычный перезапуск после падения — и база поднимается пустой. Ни ошибки, ни предупреждения: процесс стартовал, каталог чистый, он создаёт базу заново.',
];

export const VOLUME_WALK: { k: string; fate: string; cost: string }[] = [
  {
    k: '`emptyDir`',
    fate: 'Переживает **первое**: каталог принадлежит поду, а под тот же. Не переживает **второе**: под удалён — каталог удалён с ним, новый под получает пустой. Третье и четвёртое тем более.',
    cost: 'Годится для того, что можно потерять вместе с подом: кеш, временные файлы, обмен между контейнерами одного пода. А в варианте `medium: Memory` занятое ещё и идёт в лимит памяти контейнера.',
  },
  {
    k: '`hostPath`',
    fate: 'Переживает **первое** и **второе**, если новый под попал на тот же узел: каталог лежит на диске узла. На **третьем** под видит каталог **другого** узла — пустой или чужой. На **четвёртом** данных нет нигде: узел заменили вместе с диском.',
    cost: 'Узел в кластере расходный, и данные на нём — тоже. Плюс под получает доступ к файловой системе узла — документация прямо советует этого избегать.',
  },
  {
    k: 'PVC → сетевой диск',
    fate: 'Переживает все четыре. Пересозданный `db-0` находит **ту же заявку** `data-db-0` по имени, а за ней — тот же диск; на другом узле диск просто переподключается.',
    cost: 'Диск живёт в одной зоне: под привязан к ней навсегда. Упала зона — под ждёт её возвращения, даже если соседние зоны свободны.',
  },
  {
    k: 'PVC → `local`-том',
    fate: 'Переживает первое и второе. **Третьего** не случится: под привязан к узлу с диском и не переедет — будет ждать, пока узел вернётся. **Четвёртое** данные уносит.',
    cost: 'Быстро, но только для баз, которые сами держат копию на других узлах и переживают потерю одного.',
  },
];

/** Продолжение `PLAIN_CLAIM` — тот же склад на четырёх переездах. */
export const PLAIN_VOLUME_WALK =
  'Тот же склад. Слой контейнера — записи на листке, который сотрудник держит в руках: уронил (перезапуск) — пропали. `emptyDir` — ящик его рабочего стола: переживёт перерыв, но не увольнение. `hostPath` — шкаф в конкретной комнате: пересадили в другую — там чужой шкаф, снесли комнату — нет и шкафа. Заявка на сетевой диск — полка на складе по номеру: куда бы сотрудника ни пересадили, по заявке ему выдадут ту же полку. Только склад в другом городе (зоне) её не выдаст.';

/**
 * Уменьшили число реплик — три ступени удаления. Автор курса (2026-09-29): не сокращать,
 * а объяснять подробно. `LEVELS_NOTE` называл три ступени одним абзацем, `CLAIM_TABLE`
 * и `RECLAIM` — политики двумя таблицами. Здесь одно действие (`replicas` 3 → 1) прослежено
 * через все три ступени при трёх сочетаниях политик. Судьба заявок — ровно `CLAIM_CASES`
 * (проверяется `claimFate` в `tests/unit/statefulset.test.ts`); судьба диска — `RECLAIM`
 * и `LEVELS_NOTE` (по документации, в кластере не проверялось); «вернули три реплики» —
 * `VCT_TRAPS`.
 */
export const SCALE_SCENE: string[] = [
  'Сквозной пример — три реплики, у каждой свой диск. Правим одно число: `replicas: 3` → `1`. Контроллер удаляет `db-2`, потом `db-1` — сверху вниз. Вопрос: что к концу дня останется от их данных. Ответ зависит от трёх ступеней, и на каждой своя политика: **под** → **заявка** (`persistentVolumeClaimRetentionPolicy.whenScaled`) → **PV и диск в облаке** (`reclaimPolicy`).',
  'Что было бы, **если бы удаление пода сразу удаляло и диск**. Правка одного числа в манифесте — опечатка, неудачное слияние веток, откат не того коммита — стирала бы данные двух реплик без возможности вернуть. Поэтому по умолчанию цепочка обрывается на первой же ступени: под удалён, заявка осталась.',
];

export const SCALE_WALK: { k: string; claim: string; disk: string; back: string }[] = [
  {
    k: '`whenScaled: Retain` — по умолчанию',
    claim: '`data-db-1` и `data-db-2` **остаются**: контроллер их не трогает',
    disk: 'цел — до `reclaimPolicy` дело не дошло: заявку никто не удалял',
    back: '`db-1` и `db-2` находят свои старые заявки и поднимаются **со старыми данными**. Для базы, которая не умеет догонять ведущую по журналу, это реплика с устаревшими данными, считающая себя актуальной. И до этого момента за два диска идёт счёт',
  },
  {
    k: '`whenScaled: Delete`, класс с `reclaimPolicy: Delete`',
    claim: '**удаляются** — после того, как под завершился и диск корректно отключён',
    disk: '**стёрт в облаке**: заявки нет, а `Delete` у PV означает удалить и его, и диск',
    back: 'реплики получают новые пустые диски и заливают данные с ведущей заново. Предсказуемо — но если число поправили по ошибке, данные не вернуть',
  },
  {
    k: '`whenScaled: Delete`, класс с `reclaimPolicy: Retain`',
    claim: '**удаляются**',
    disk: 'цел: PV переходит в фазу `Released`. Новой заявке он сам не достанется — на нём чужие данные, освобождает его администратор',
    back: 'реплики получают новые пустые диски; старые лежат рядом, пока их не удалят руками. Страховка от ошибки ценой ручной уборки',
  },
];

/** Продолжение `PLAIN_CLAIM` — тот же склад, три двери на выходе. */
export const PLAIN_SCALE =
  'Тот же склад. Сотрудника уволили (под удалён) — это первая дверь. Заявку на его полку можно не закрывать (`Retain`): полка ждёт, и новый сотрудник за тем же столом получит её со всеми старыми папками. Можно закрыть (`Delete`) — тогда решает вторая дверь, правило склада: пустую полку либо сразу сдают в утиль вместе с содержимым (`reclaimPolicy: Delete`), либо опечатывают и ждут кладовщика (`Retain`).';

/* ──────────────────── Схемы ──────────────────── */

/**
 * Схема «номер → имя, адрес, заявка, диск» (раздел «Свой диск у каждой реплики», сразу
 * после `VCT_WHY`).
 *
 * Имена — сквозного примера `STS_CODE`: StatefulSet `db`, headless-сервис `db` в
 * пространстве `shop`, шаблон заявки `data`. Правила — из `DNS_WHY` (имя пода и адрес
 * в DNS), `VCT_WHY` (заявка `<шаблон>-<под>`) и `STS_NOTES` («Имя — да, IP-адрес — нет»):
 * пересозданный `db-1` получает то же имя и ту же заявку, но новый IP. Самих IP-адресов
 * тема не называет — схема их не выдумывает.
 */
export const IDENTITY_DIAGRAM = {
  title: 'Номер решает всё: имя, адрес в DNS и заявку на диск',
  caption:
    'Всё, что у пода постоянно, вычисляется из номера; поэтому пересозданный `db-1` находит ту же заявку и тот же диск — меняется только IP-адрес.',
  heads: ['под', 'адрес в DNS', 'заявка (PVC)', 'диск'],
  rows: [
    ['`db-0`', '`db-0.db.shop.svc.cluster.local`', '`data-db-0`', 'свой диск'],
    ['`db-1`', '`db-1.db.shop.svc.cluster.local`', '`data-db-1`', 'свой диск'],
    ['`db-2`', '`db-2.db.shop.svc.cluster.local`', '`data-db-2`', 'свой диск'],
  ],
  recreated: {
    k: 'пересоздан `db-1`',
    same: ['то же имя `db-1`', 'тот же адрес в DNS', 'та же заявка `data-db-1` и те же данные'],
    changed: 'новый IP-адрес — поэтому подключаются по имени',
  },
};

/**
 * Схема «по номерам вверх и вниз» (раздел «Порядок и обновление», сразу после карточки
 * «Четыре гарантии»).
 *
 * Три полосы — ровно `ORDER_RULES` и `UPDATE_WHY`: создание от `db-0` к `db-2` с ожиданием
 * Running и Ready у предшественника, удаление от `db-2` к `db-0` с ожиданием полного ухода
 * последующего, обновление `RollingUpdate` — удалить и создать заново, с конца, по одному,
 * дожидаясь готовности. Политика `OrderedReady` — умолчание, она же в `STS_CODE`.
 */
export const ORDER_DIAGRAM = {
  title: 'Контроллер идёт по номерам: вверх при создании, вниз при удалении и обновлении',
  caption:
    'Каждый шаг ждёт предыдущего: создание — пока сосед снизу не станет Running и Ready, удаление — пока сосед сверху не исчезнет совсем.',
  lanes: [
    {
      k: 'создание',
      pods: ['db-0', 'db-1', 'db-2'],
      wait: 'ждёт Running и Ready',
      tone: 'ok',
    },
    {
      k: 'удаление',
      pods: ['db-2', 'db-1', 'db-0'],
      wait: 'ждёт, пока исчезнет совсем',
      tone: 'err',
    },
    {
      k: 'обновление `RollingUpdate`',
      pods: ['db-2', 'db-1', 'db-0'],
      wait: 'удалить, создать заново, ждать Ready',
      tone: 'info',
    },
  ],
};
