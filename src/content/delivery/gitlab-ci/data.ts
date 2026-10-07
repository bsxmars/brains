import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { JobSpec } from '@/widgets/pipeline-graph/model/types';
import type { PipelineCtx, Rule, When } from '@/widgets/rules-builder/model/types';
import type { VarLayer, VarSource } from '@/widgets/rules-builder/model/vars';

/**
 * Данные темы «GitLab CI: из чего собирается конвейер».
 *
 * Конспекта-источника у темы нет: материал собран здесь, и правило проекта работает в полную
 * силу — **каждое утверждение либо снято прогоном, либо помечено как взятое из документации**.
 *
 * ЧЕМ СНЯТО. Настоящего раннера GitLab на машине нет, поэтому прогоны сделаны
 * `gitlab-ci-local` 4.75.1 — он исполняет тот же `.gitlab-ci.yml` в контейнерах Docker
 * (Docker Engine 27.4.0, macOS arm64). Образ везде `alpine:3`. Шесть отдельных проектов
 * в каталоге вне репозитория; контейнеры и тома сняты за собой сразу после замеров.
 *
 * ЧТО СНЯТО ПРОГОНОМ.
 *
 *  1. Порядок выполнения при стадиях: длительности джобов и момент старта каждой стадии.
 *  2. Что джоб видит в рабочей директории; чем `artifacts` отличается от `cache`; что делают
 *     `dependencies: []` и `needs` с загрузкой артефактов; что переживает границу конвейера.
 *  3. Решение `rules` в четырёх контекстах для одиннадцати наборов правил — таблица
 *     `RULE_CHECK` ниже, она же сверяется с моделью демо в `tests/unit/gitlab-ci.test.ts`.
 *  4. `rules:changes` против настоящей базы сравнения (`origin/main`) — три состояния диффа.
 *  5. Приоритет переменных: пять слоёв, одна переменная, вывод `printenv` из контейнера.
 *  6. Что `extends` делает с массивами и словарями — по развёрнутому YAML (`--preview`).
 *
 * ⚠️ ЧЕГО СНЯТЬ НЕ УДАЛОСЬ И ПОЧЕМУ. Три вещи помечены в тексте как проверенные
 * документацией, а не прогоном:
 *
 *  • **старт джоба по `needs` раньше конца стадии.** `gitlab-ci-local` этого не делает:
 *    в замере джоб с `needs: [fast]` дождался не соседа `fast` (1,3 с), а конца всей стадии
 *    (21 с). Поэтому шкала DAG в демо — расчёт по правилам GitLab, и подпись говорит об этом;
 *  • **`only`/`except`.** Инструмент их не вычисляет вовсе: джоб с `only: [main]` остался
 *    в конвейере и на ветке `feature/x`, а джоб с `except: [main]` — на самой `main`;
 *  • **всё, что живёт на стороне GitLab.com**: раннеры и их теги, окружения, ручные джобы
 *    с одобрением, защищённые и маскированные переменные, общий кеш между раннерами.
 *
 * ВТОРОЙ ПРОХОД (сентябрь 2026). Порядок разделов: стадии → `needs` → артефакты и кеш →
 * переменные → правила → шаблоны. `needs` встал сразу за стадиями, потому что лечит ровно
 * их простой и нужен разделу про артефакты (он сужает загрузку); переменные — перед правилами,
 * потому что демо правил включает и выключает слои `DEPLOY`, то есть опирается на старшинство.
 *
 * Дома общих с «GitHub Actions» идей: **здесь** — артефакт против кеша (оба сняты одним
 * прогоном) и стадии против графа. **Там** — цена границы джоба, ключ кеша и его промахи,
 * маскирование секретов, матрица; здесь по ним выжимка и ссылка на раздел.
 *
 * ТРЕТИЙ ПРОХОД: БЛОК «ЗА КАДРОМ» РАСКРЫТ И УДАЛЁН (решение автора курса). Прогонов не было;
 * всё дописанное — **по документации GitLab, не прогоном**, листинги разбирает
 * `tests/unit/delivery-configs.test.ts`:
 *   — «Раннеры и теги» → подраздел раздела 1 (`RUNNER_*`); чем опасна долгоживущая машина —
 *     одной ссылкой на «Свои раннеры» в теме про Actions, без пересказа;
 *   — «Кеш между раннерами» → карточка в разделе 3 (`SHARED_CACHE_*`);
 *   — «Конвейеры для merge request» → подраздел раздела 5 (`MR_*`), рецепт `workflow:rules`
 *     дословно из документации;
 *   — «Окружения и выкладки» → подраздел раздела 5 (`DEPLOY_*`): только отличия GitLab
 *     (откат перезапуском, блокирующий `manual`, `resource_group`); что такое окружение —
 *     ссылкой на тему про Actions;
 *   — «Дочерние конвейеры и `parallel:matrix`», «Компоненты и каталог CI» → подраздел
 *     раздела 6 (`MATRIX_CODE`, `CHILD_CODE`, `COMPONENT_CODE`, `SCALE_FACTS`); цена сочетания
 *     матрицы — ссылкой на матрицы Actions.
 */

// ---------------------------------------------------------------------------
// Раздел 1. Стадии и джобы
// ---------------------------------------------------------------------------

export const STAGES_CODE = `# .gitlab-ci.yml — тот самый конвейер, на котором сняты числа темы
stages:
  - build
  - test
  - deploy

default:
  image: alpine:3

build:a:                 # 7,30 с — самый долгий джоб стадии
  stage: build
  script: [sleep 6]

build:b:                 # 1,32 с
  stage: build
  script: [echo ok]

test:unit:               # нужен только результат build:b
  stage: test
  script: [echo ok]

test:lint:               # не нужен вообще никто
  stage: test
  script: [echo ok]

deploy:
  stage: deploy
  script: [echo ok]`;

export const STAGE_TIMELINE = `# метки из прогона, секунды от старта конвейера
0,00  build:b  старт
0,00  build:a  старт
1,32  build:b  готов          ← результат готов, но им никто не воспользуется ещё 6 секунд
7,30  build:a  готов          ← только теперь стадия build закрыта
7,30  test:unit  старт
7,30  test:lint  старт
8,50  test:*   готовы
8,50  deploy   старт
9,55  deploy   готов`;

export const STAGE_FACTS = [
  {
    t: 'Джоб ждёт всю предыдущую стадию, а не нужного ему соседа',
    d: 'Джоб не ждёт того, чей результат ему нужен. Он ждёт, пока закончится **вся** предыдущая стадия, — включая джобы, которые ему вовсе не нужны. В замере `test:unit` простоял 5,98 с после того, как нужный ему `build:b` уже был готов.',
    tone: 'err' as const,
  },
  {
    t: 'Внутри стадии джобы идут параллельно',
    d: 'Это единственная параллельность, которую стадии дают сами: `build:a` и `build:b` стартовали одновременно. Поэтому стадия длится не сумму своих джобов, а столько, сколько самый долгий из них.',
  },
  {
    t: 'Имя стадии ничего не значит',
    d: '`build`, `test`, `deploy` — просто строки из списка `stages`. Порядок задаёт место в списке, а не смысл слова. Стадию можно назвать `тест` и поставить перед сборкой — конвейер соберётся.',
  },
  {
    t: 'Джоб — это контейнер и скрипт',
    d: 'Раннер — программа-исполнитель — запускает контейнер из образа и копирует в него репозиторий. Потом выполняет строки `before_script` и `script` одну за другой и запоминает код возврата. Если любая строка завершилась с ненулевым кодом, то есть с ошибкой, джоб падает: скрипт останавливается на первой ошибке. Каждый джоб — новый контейнер, и граница между джобами стоит секунды; сколько именно, замерено на похожем конвейере в [GitHub Actions: что переживает границу](/delivery/github-actions/#s3).',
  },
];

export const ORDER_ROWS = [
  {
    k: '`stages`',
    what: 'порядок стадий — точек, где все ждут друг друга',
    why: 'джоб не начнётся, пока не закончился последний джоб предыдущей стадии',
  },
  {
    k: '`stage:` у джоба',
    what: 'в какой стадии джоб',
    why: 'если не указано — `test`, а не первая стадия из списка',
  },
  {
    k: '`needs:`',
    what: 'чего джоб ждёт на самом деле',
    why: 'ключ снимает ожидание стадии у этого джоба, и только у него',
  },
  {
    k: '`rules` / `only`',
    what: 'попадёт ли джоб в конвейер вообще',
    why: 'решается один раз, когда конвейер создаётся, — до запуска любого джоба',
  },
  {
    k: '`when`',
    what: 'при каком исходе предыдущих джобов этот стартует',
    why: 'по умолчанию `on_success`: если в стадии упал джоб, следующие стадии не запускаются',
  },
];

// ---------------------------------------------------------------------------
// Раздел 5. Правила
// ---------------------------------------------------------------------------

export const RULES_CODE = `deploy:prod:
  stage: deploy
  script: [./deploy.sh]
  rules:
    - if: '$CI_PIPELINE_SOURCE == "schedule"'
      when: never                              # 1. ночной конвейер сюда не ходит
    - if: '$CI_COMMIT_TAG =~ /^v[0-9]+/'       # 2. релиз по тегу
    - if: '$CI_COMMIT_BRANCH == "main" && $DEPLOY == "yes"'
      variables:
        TARGET: production                     # 3. правило умеет и задавать переменные
    - changes: [src/**/*]
      when: manual                             # 4. тронули код — предложить кнопку
    - when: always                             # 5. а сюда добираются не всегда`;

/** Правила конструктора. `text` — то, что читатель видит в собранном файле. */
export const DEMO_RULES: Rule[] = [
  {
    id: 'sched',
    text: "- if: '$CI_PIPELINE_SOURCE == \"schedule\"'\n  when: never",
    if: { op: 'eq', left: '$CI_PIPELINE_SOURCE', right: 'schedule' },
    when: 'never',
  },
  {
    id: 'tag',
    text: "- if: '$CI_COMMIT_TAG =~ /^v[0-9]+/'",
    if: { op: 'match', left: '$CI_COMMIT_TAG', right: '^v[0-9]+' },
  },
  {
    id: 'deploy',
    text: "- if: '$CI_COMMIT_BRANCH == \"main\" && $DEPLOY == \"yes\"'\n  variables:\n    TARGET: production",
    if: {
      op: 'and',
      parts: [
        { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' },
        { op: 'eq', left: '$DEPLOY', right: 'yes' },
      ],
    },
    variables: { TARGET: 'production' },
  },
  {
    id: 'changes',
    text: '- changes:\n    - src/**/*\n  when: manual',
    changes: ['src/**/*'],
    when: 'manual',
  },
  {
    id: 'catch',
    text: '- when: always',
    when: 'always',
  },
];

/**
 * Слои, которыми в демо можно задать `$DEPLOY`, — от слабого к сильному.
 *
 * Значения выбраны так, чтобы приоритет было видно по последствиям: переменная проекта
 * включает выкладку, а запуск вручную — выключает, хотя «вручную» написано позже и выглядит
 * слабее. Порядок слоёв сверяется с `VAR_ORDER` в тесте.
 */
export const DEMO_LAYERS: (VarLayer & { label: string })[] = [
  { source: 'global' as VarSource, value: 'no', label: 'variables: в корне' },
  { source: 'job' as VarSource, value: 'no', label: 'variables: джоба' },
  { source: 'project' as VarSource, value: 'yes', label: 'переменная проекта' },
  { source: 'manual' as VarSource, value: 'no', label: 'запуск вручную' },
];

/** Четыре контекста, в которых снят прогон. */
export const RULE_CONTEXTS: { id: 'main' | 'feature' | 'tag' | 'flags'; label: string; ctx: PipelineCtx }[] = [
  {
    id: 'main',
    label: 'push в main',
    ctx: { branch: 'main', tag: null, source: 'push', changed: [], vars: {} },
  },
  {
    id: 'feature',
    label: 'push в feature/x',
    ctx: { branch: 'feature/x', tag: null, source: 'push', changed: [], vars: {} },
  },
  {
    id: 'tag',
    label: 'тег v1.2.3',
    ctx: { branch: null, tag: 'v1.2.3', source: 'push', changed: [], vars: {} },
  },
  {
    id: 'flags',
    label: 'main + переменные',
    ctx: {
      branch: 'main',
      tag: null,
      source: 'push',
      changed: [],
      vars: { DEPLOY: 'yes', FLAG: '1', FALSE_FLAG: 'false' },
    },
  },
];

/**
 * Вердикты, снятые прогоном.
 *
 * Каждая строка — отдельный джоб в одном и том же файле; колонки — четыре контекста.
 * Значения взяты из `gitlab-ci-local --list-all` дословно (колонка `when`), и тест требует,
 * чтобы модель демо повторила их все. `never` в этой таблице означает «джоба в конвейере нет»:
 * `--list` без `-all` такие строки просто не печатает.
 */
export const RULE_CHECK: {
  name: string;
  about: string;
  rules: Rule[];
  verdict: Record<'main' | 'feature' | 'tag' | 'flags', When>;
}[] = [
  {
    name: 'only-main',
    about: 'одно условие по ветке',
    rules: [{ id: 'a', text: "- if: '$CI_COMMIT_BRANCH == \"main\"'", if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' } }],
    verdict: { main: 'on_success', feature: 'never', tag: 'never', flags: 'on_success' },
  },
  {
    name: 'never-first',
    about: '`when: never` стоит первым',
    rules: [
      { id: 'a', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' }, when: 'never' },
      { id: 'b', text: '', if: { op: 'defined', left: '$CI_COMMIT_BRANCH' }, when: 'always' },
    ],
    verdict: { main: 'never', feature: 'always', tag: 'never', flags: 'never' },
  },
  {
    name: 'never-last',
    about: 'те же два правила, порядок обратный',
    rules: [
      { id: 'a', text: '', if: { op: 'defined', left: '$CI_COMMIT_BRANCH' }, when: 'always' },
      { id: 'b', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' }, when: 'never' },
    ],
    verdict: { main: 'always', feature: 'always', tag: 'never', flags: 'always' },
  },
  {
    name: 'no-match',
    about: 'условие не совпадает никогда',
    rules: [{ id: 'a', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'never-exists' } }],
    verdict: { main: 'never', feature: 'never', tag: 'never', flags: 'never' },
  },
  {
    name: 'and-or',
    about: '`&&` в первом правиле, регулярное выражение во втором',
    rules: [
      {
        id: 'a',
        text: '',
        if: {
          op: 'and',
          parts: [
            { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' },
            { op: 'eq', left: '$DEPLOY', right: 'yes' },
          ],
        },
      },
      { id: 'b', text: '', if: { op: 'match', left: '$CI_COMMIT_TAG', right: '^v[0-9]+' } },
    ],
    verdict: { main: 'never', feature: 'never', tag: 'on_success', flags: 'on_success' },
  },
  {
    name: 'truthy',
    about: '`if: \'$FLAG\'` — проверка на непустоту',
    rules: [{ id: 'a', text: '', if: { op: 'defined', left: '$FLAG' } }],
    verdict: { main: 'never', feature: 'never', tag: 'never', flags: 'on_success' },
  },
  {
    name: 'falsey-string',
    about: 'та же проверка, но переменная равна строке `false`',
    rules: [{ id: 'a', text: '', if: { op: 'defined', left: '$FALSE_FLAG' } }],
    verdict: { main: 'never', feature: 'never', tag: 'never', flags: 'on_success' },
  },
  {
    name: 'rule-vars',
    about: 'первое правило задаёт переменную, второе срабатывает для всех остальных',
    rules: [
      {
        id: 'a',
        text: '',
        if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' },
        variables: { TARGET: 'из rules:variables' },
      },
      { id: 'b', text: '', when: 'always' },
    ],
    verdict: { main: 'on_success', feature: 'always', tag: 'always', flags: 'on_success' },
  },
  {
    name: 'manual-job',
    about: '`when: manual` в правиле',
    rules: [{ id: 'a', text: '', if: { op: 'defined', left: '$CI_COMMIT_BRANCH' }, when: 'manual' }],
    verdict: { main: 'manual', feature: 'manual', tag: 'never', flags: 'manual' },
  },
  {
    name: 'soft-fail',
    about: '`allow_failure: true` в правиле',
    rules: [{ id: 'a', text: '', if: { op: 'defined', left: '$CI_COMMIT_BRANCH' }, allowFailure: true }],
    verdict: { main: 'on_success', feature: 'on_success', tag: 'never', flags: 'on_success' },
  },
  {
    name: 'catch-all-first',
    about: 'правило без `if` стоит первым',
    rules: [
      { id: 'a', text: '', when: 'always' },
      { id: 'b', text: '', if: { op: 'eq', left: '$CI_COMMIT_BRANCH', right: 'main' }, when: 'never' },
    ],
    verdict: { main: 'always', feature: 'always', tag: 'always', flags: 'always' },
  },
];

export const RULE_STEPS = [
  'Правила проверяются **сверху вниз**, и проверка останавливается на первом совпавшем. Правила ниже не рассматриваются вовсе — даже если подходят лучше.',
  'Когда правило совпало, джоб получает его `when`, `allow_failure` и `variables`. Если `when` не написан, считается `on_success` — «запустить, если всё до этого прошло успешно».',
  'Если в совпавшем правиле `when: never`, джоба в конвейере **нет**. Поэтому `when: never` в конце списка почти всегда бесполезен: до него просто не доходят.',
  'Если не совпало ни одно правило, джоба в конвейере тоже нет. Это не «пропущен»: на отсутствующий джоб нельзя сослаться из `needs`.',
  'Условие без сравнения (`if: \'$VAR\'`) означает «переменная задана и не пуста». Строка `"false"` не пуста — и условие **проходит**.',
  'Правило без `if` и без `changes` совпадает всегда. Если поставить его первым, до остальных правил очередь не дойдёт никогда.',
];

export const ONLY_ROWS = [
  {
    k: '`only` / `except`',
    what: 'списки веток, тегов и типов конвейера',
    why: 'заморожены: новых возможностей не получают, но и не удалены',
    tone: 'warn' as const,
  },
  {
    k: '`rules`',
    what: 'упорядоченный список условий с `when`, `changes` и `variables`',
    why: 'то, что развивается; всё новое появляется здесь',
    tone: 'ok' as const,
  },
  {
    k: 'вместе в одном джобе',
    what: 'GitLab не примет файл',
    why: 'конвейер не создастся вовсе — по документации GitLab',
    tone: 'err' as const,
  },
  {
    k: '`only: [main]` + `except: [main]`',
    what: '`except` сильнее: джоба не будет',
    why: 'по документации; прогоном не снято — инструмент `only`/`except` не вычисляет',
    tone: 'warn' as const,
  },
];

export const CHANGES_CODE = `# прогон с настоящей базой сравнения: git diff --name-only origin/main
# правила: src-only → changes [src/**/*],  docs-only → changes [docs/**/*]

состояние диффа            src-only     docs-only
────────────────────────   ──────────   ──────────
ничего не менялось         never        never
коммит тронул docs/        never        on_success
коммит тронул src/         on_success   on_success     ← оба: дифф считается от базы,
                                                          а не от прошлого коммита`;

export const RULES_FACTS = [
  {
    t: 'Решение принимается один раз',
    d: 'Состав конвейера вычисляется в момент его создания. Правила смотрят на ветку, тег, причину запуска и переменные — больше ни на что. Джоб, не попавший в конвейер, не появится в нём позже, чем бы ни закончились остальные.',
    tone: 'warn' as const,
  },
  {
    t: 'Опечатка в имени переменной не вызывает ошибки',
    d: 'Незнакомое имя превращается в пустую строку. Условие `$DEPOLY == "yes"` просто ложно — и джоб молча не запускается. Проверено прогоном: неизвестное имя конвейер не роняет.',
    tone: 'err' as const,
  },
  {
    t: '`changes` смотрит на всю ветку, а не на последний коммит',
    d: 'Это не «что изменил последний коммит», а список файлов, которыми ветка отличается от базы сравнения (в замере — `origin/main`). Поэтому джоб, сработавший на одном коммите, срабатывает и на следующем: изменённый файл всё ещё в списке отличий.',
  },
  {
    t: '`when: manual` — джоб есть и ждёт кнопки',
    d: 'Джоб создан, виден в конвейере и ждёт, пока его запустят вручную. В этом и разница с `never`: на ручной джоб можно сослаться в `needs`, а на отсутствующий — нет.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 3. Артефакты и кеш
// ---------------------------------------------------------------------------

export const ARTIFACTS_CODE = `make:
  stage: one
  cache:
    key: shared-cache
    paths: [vendor/]      # кеш: моё ускорение, живёт между конвейерами
  artifacts:
    paths: [out/]         # артефакт: мой результат, нужен следующим джобам
  script:
    - mkdir -p out vendor
    - echo ... > out/app.txt
    - echo ... > vendor/dep.txt
    - echo ... > stray.txt   # ничей файл: не артефакт и не кеш

use:
  stage: two
  cache:
    key: shared-cache
    paths: [vendor/]
  script: [ls -A]`;

export const WORKSPACE_LOG = `# прогон 1, том чистый
make  > MAKE видит в начале:  .git  .gitlab-ci.yml
make  > MAKE оставил:         .git  .gitlab-ci.yml  out  stray.txt  vendor

use   > USE видит:            .git  .gitlab-ci.yml  other-out  out  vendor
use   > cat out/app.txt       artifact-from-make      ← артефакт приехал
use   > cat vendor/dep.txt    cache-from-make         ← кеш приехал
use   > cat stray.txt         НЕТ: No such file       ← ничей файл не пережил границу

# прогон 2, тот же проект, новый конвейер
make  > MAKE видит в начале:  .git  .gitlab-ci.yml  vendor
#                                                   ↑ кеш пережил конвейер, артефакт — нет`;

export const ART_ROWS = [
  {
    k: 'зачем',
    art: 'передать результат следующему джобу',
    cache: 'не делать второй раз то, что уже делали',
  },
  {
    k: 'кто получает',
    art: 'джобы следующих стадий — автоматически',
    cache: 'только тот, кто объявил тот же `key`',
  },
  {
    k: 'сколько живёт',
    art: 'внутри конвейера (и в хранилище до `expire_in`)',
    cache: 'между конвейерами, пока цел ключ',
  },
  {
    k: 'что если пропал',
    art: 'джоб падает: файла нет',
    cache: 'джоб работает дольше — и только',
  },
  {
    k: 'гарантия',
    art: 'есть: артефакт скачивается перед стартом',
    cache: 'нет: кеш только ускоряет и ничего не обещает',
  },
  {
    k: 'снято в замере',
    art: '`out/` приехал в оба джоба следующей стадии',
    cache: '`vendor/` приехал только туда, где объявлен `cache`',
  },
];

export const SEEN_ROWS = [
  {
    k: '`use` — с `cache`, без `needs`',
    v: '`out/`, `other-out/`, `vendor/`',
    why: 'артефакты **всех** джобов прошлых стадий плюс свой кеш',
    tone: 'ok' as const,
  },
  {
    k: '`nocache` — без `cache`',
    v: '`out/`, `other-out/`',
    why: 'кеша нет: он приезжает только туда, где объявлен',
    tone: 'warn' as const,
  },
  {
    k: '`nodeps` — `dependencies: []`',
    v: 'ничего',
    why: 'пустой список отключает загрузку артефактов целиком',
    tone: 'err' as const,
  },
  {
    k: '`via-needs` — `needs: [other]`',
    v: 'только `other-out/`',
    why: '`needs` сужает загрузку до названных джобов — `out/` не приехал',
    tone: 'err' as const,
  },
];

export const ART_FACTS = [
  {
    t: 'Каждый джоб начинает с чистой копии репозитория',
    d: 'В замере джоб в начале видел только `.git` и `.gitlab-ci.yml` — и больше ничего. Файл, который создал сосед и не объявил артефактом, до следующего джоба не доживает.',
    tone: 'err' as const,
  },
  {
    t: '`needs` меняет не только порядок',
    d: 'Джоб с `needs` получает артефакты **только** тех джобов, что перечислены в `needs`. В замере `via-needs` с `needs: [other]` не увидел артефакт `make`, хотя тот работал стадией раньше. Конвейер ускорили — файл потеряли.',
    tone: 'err' as const,
  },
  {
    t: 'Кеш живёт по ключу, а не по джобу',
    d: 'Два джоба с одинаковым `key` пользуются одним кешем. Джоб без секции `cache` кеш не получает вовсе. В замере кеш `vendor/` дожил до следующего конвейера, а артефакт `out/` — нет. Ключ решает, что считать «тем же самым»: всё, что в него не попало, кеш считает неважным. Как из-за этого кеш промахивается или приносит старое — разобрано в [GitHub Actions: кеш и промахи](/delivery/github-actions/#s5).',
  },
  {
    t: 'Соседу по стадии артефакт не достанется',
    d: 'Джоб скачивает артефакты только предыдущих стадий. Джоб той же стадии их не увидит: когда он стартует, сосед ещё работает.',
    tone: 'warn' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 2. needs и DAG
// ---------------------------------------------------------------------------

export const NEEDS_CODE = `test:unit:
  stage: test
  needs: [build:b]     # жду ровно того, чей результат мне нужен

test:lint:
  stage: test
  needs: []            # не жду никого: линтеру не нужна сборка

deploy:
  stage: deploy
  needs: [test:unit]   # и мне не нужен линтер`;

/** Длительности сняты прогоном; расстановка по времени — расчёт, см. `model/schedule.ts`. */
export const GRAPH_JOBS: JobSpec[] = [
  { name: 'build:a', stage: 'build', ms: 7300 },
  { name: 'build:b', stage: 'build', ms: 1320 },
  { name: 'test:unit', stage: 'test', ms: 1200, needs: ['build:b'] },
  { name: 'test:lint', stage: 'test', ms: 1160, needs: [] },
  { name: 'deploy', stage: 'deploy', ms: 1050, needs: ['test:unit'] },
];

export const GRAPH_STAGES = ['build', 'test', 'deploy'];

export const DAG_ROWS = [
  {
    k: '`deploy` готов',
    stages: '9,55 с',
    dag: '3,57 с',
    what: 'выигрыш 5,98 с — и это при тех же джобах той же длительности',
  },
  {
    k: 'конвейер целиком',
    stages: '9,55 с',
    dag: '7,30 с',
    what: 'его по-прежнему держит долгий `build:a`',
  },
  {
    k: '`test:lint` готов',
    stages: '8,46 с',
    dag: '1,16 с',
    what: '`needs: []` — единственный способ стартовать в нулевой момент',
  },
  {
    k: '`test:unit` ждал',
    stages: '5,98 с зря',
    dag: '0 с',
    what: 'нужный ему `build:b` был готов на 1,32 с',
  },
];

export const NEEDS_FACTS = [
  {
    t: '`needs` ускоряет только свой джоб',
    d: '`needs` снимает ожидание стадии **только у того джоба, где он написан**. Соседи без этого ключа по-прежнему ждут свои стадии. Отсюда частое «добавили `needs`, а быстрее не стало».',
    tone: 'warn' as const,
  },
  {
    t: '`needs: []` и отсутствие `needs` — разные вещи',
    d: 'Пустой список значит «не жду никого»: джоб стартует сразу, в нулевой момент. Нет ключа — значит «жду всю предыдущую стадию». Разница — две квадратные скобки, а в замере — семь секунд.',
    tone: 'err' as const,
  },
  {
    t: 'Стадии никуда не исчезают',
    d: '`stage:` нужен и при `needs`. Он задаёт, в какой колонке джоб нарисован на схеме конвейера, и как ведут себя джобы без `needs`. Ссылаться в `needs` можно только на джобы своей или более ранней стадии.',
  },
  {
    t: 'В GitHub Actions — наоборот',
    d: 'Там стадий нет: без `needs` все джобы стартуют сразу, и `needs` — единственный способ задать порядок. Зато файлы там не приезжают сами ни при какой раскладке: каждый джоб скачивает артефакт отдельным шагом. Сравнение — [GitHub Actions: порядок джобов](/delivery/github-actions/#s2).',
  },
  {
    t: 'Ссылка на отсутствующий джоб ломает весь файл',
    d: 'Если `needs` называет джоб, которого нет в конвейере (например, его исключили правила), GitLab считает ошибочным весь файл — если не добавить `optional: true`. Это по документации GitLab; `gitlab-ci-local` такую ошибку не ловит — проверено.',
    tone: 'err' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 4. Переменные
// ---------------------------------------------------------------------------

export const VARS_CODE = `variables:
  WHO: globals              # слой 1: корень файла

job:
  variables:
    WHO: job                # слой 2: джоб
  rules:
    - if: '$CI_COMMIT_BRANCH'
      variables:
        WHO: rules          # слой 3: правило
  script: [printenv WHO]

# слой 4: переменная проекта (в замере — файл переменных инструмента)
# слой 5: запуск вручную с переменной`;

export const VAR_ROWS = [
  {
    k: 'только корень файла',
    v: '`globals`',
    why: 'самый слабый из слоёв, которые пишут руками',
    tone: 'info' as const,
  },
  {
    k: 'корень + джоб',
    v: '`job`',
    why: '`variables:` джоба перебивает корневые',
    tone: 'ok' as const,
  },
  {
    k: 'джоб + `rules:variables`',
    v: '`rules`',
    why: 'сработавшее правило сильнее самого джоба',
    tone: 'ok' as const,
  },
  {
    k: 'всё это + переменная проекта',
    v: '`project`',
    why: '**написанное в файле проигрывает настройкам проекта**',
    tone: 'err' as const,
  },
  {
    k: 'всё это + запуск с переменной',
    v: '`cli`',
    why: 'ручной запуск сильнее всех',
    tone: 'warn' as const,
  },
  {
    k: 'отчёт `dotenv` из `needs`',
    v: '`from-dotenv`',
    why: 'перебил `variables:` джоба — снято отдельным прогоном',
    tone: 'warn' as const,
  },
];

export const VAR_STEPS = [
  '**Предопределённые** (`CI_COMMIT_BRANCH`, `CI_JOB_NAME`, `CI_PROJECT_DIR`…) — их GitLab задаёт сам, и это самый слабый слой. Их можно перекрыть своим значением: в замере джоб переписал `CI_COMMIT_BRANCH`, инструмент предупредил и подчинился.',
  '**`variables:` в корне файла** — общие для всех джобов.',
  '**`variables:` джоба** — перебивают корневые.',
  '**`rules:variables` сработавшего правила** — перебивают джобовые.',
  '**`dotenv` из джоба, названного в `needs`**, — файл со строками `ИМЯ=значение`, который предыдущий джоб сохранил как отчёт. Он перебивает всё, что написано в `.gitlab-ci.yml`. Это снято прогоном; что этот слой слабее переменных проекта — по документации GitLab.',
  '**Переменные проекта и группы** — их задают в настройках GitLab, а не в файле. Они сильнее всего, что написано в `.gitlab-ci.yml`. Это главный сюрприз: «я же прописал значение в файле» не помогает.',
  '**Переменные ручного запуска** (и запуска по расписанию с переопределением) — сильнее всех.',
];

export const VAR_FACTS = [
  {
    t: 'Подстановка происходит в оболочке джоба',
    d: '`DERIVED: "$BASE-world"` превратилось в `hello-world`. Значение собирается, когда джоб запускается, а не когда GitLab читает файл. Поэтому в подстановку попадает и переменная, заданная позже в другом слое.',
  },
  {
    t: 'Пустая переменная — это значение',
    d: 'Переменная, равная пустой строке, всё равно задана. Условие `if: \'$VAR\'` её не пропустит, а `if: \'$VAR == ""\'` — пропустит. Это два разных вопроса, и их часто путают.',
    tone: 'warn' as const,
  },
  {
    t: 'Предопределённые перекрываются молча',
    d: 'Ничто не мешает объявить свою переменную `CI_COMMIT_BRANCH` — джоб получит ваше значение. И все правила, которые спрашивают ветку, будут видеть его же. Проверено прогоном.',
    tone: 'err' as const,
  },
  {
    t: 'Секреты в переменных — это соглашение, а не защита',
    d: 'Маскированная переменная прячется в логе звёздочками. Защищённая — доступна только защищённым веткам. Всё это настраивается в проекте и в файле не видно, а правила старшинства выше действуют и на такие переменные. Почему маскирование — последняя линия защиты, а не первая, снято прогоном в [GitHub Actions: права и секреты](/delivery/github-actions/#s7): там base64 и кусок секрета напечатались открытым текстом. Для GitLab это взято из документации, прогоном здесь не снималось.',
  },
];

// ---------------------------------------------------------------------------
// Раздел 6. Шаблоны, extends, include
// ---------------------------------------------------------------------------

export const EXTENDS_CODE = `.base:
  variables:
    A: из .base
    B: из .base
  before_script: [echo before из .base]
  script:
    - echo script из .base 1
    - echo script из .base 2
  artifacts:
    when: always
    expire_in: 1 day
    paths: [base-path/]
  tags: [base-tag]

child:
  extends: .base
  variables:
    B: из child
    C: только в child
  script: [echo script из child]
  artifacts:
    paths: [child-path/]
  tags: [child-tag]`;

export const EXTENDS_RESULT = `# вывод gitlab-ci-local --preview: что получилось на самом деле
child:
  variables:
    A: из .base          # ← словарь слит: ключ родителя уцелел
    B: из child          # ← и перекрыт там, где имена совпали
    C: только в child
  before_script: [echo before из .base]
  script: [echo script из child]     # ← массив заменён целиком, обе строки родителя исчезли
  artifacts:
    when: always         # ← сам artifacts — словарь, эти ключи уцелели
    expire_in: 1 day
    paths: [child-path/] # ← а paths внутри него — массив, и он заменён
  tags: [child-tag]      # ← массив: base-tag потерян`;

export const EXTENDS_ROWS = [
  {
    k: '`variables`',
    what: 'словарь',
    how: 'слияние по ключам: чужие ключи остаются',
    tone: 'ok' as const,
  },
  {
    k: '`artifacts`',
    what: 'словарь',
    how: 'слияние: `when` и `expire_in` родителя уцелели',
    tone: 'ok' as const,
  },
  {
    k: '`artifacts.paths`',
    what: 'массив внутри словаря',
    how: '**замена целиком** — `base-path/` исчез',
    tone: 'err' as const,
  },
  {
    k: '`script`, `before_script`',
    what: 'массив',
    how: 'замена целиком: строки родителя не дописываются',
    tone: 'err' as const,
  },
  {
    k: '`tags`, `rules`',
    what: 'массив',
    how: 'замена целиком — и правила родителя тихо исчезают',
    tone: 'err' as const,
  },
  {
    k: '`extends: [.a, .b]`',
    what: 'несколько родителей',
    how: 'последний в списке выигрывает при конфликте',
    tone: 'warn' as const,
  },
];

export const REFERENCE_CODE = `# !reference вставляет массив, а не заменяет его
referenced:
  before_script:
    - !reference [.base, before_script]
    - echo before из referenced
  script:
    - !reference [.base, script]
    - echo script из referenced

# развёрнутый результат:
#   before_script: [echo before из .base, echo before из referenced]
#   script:        [echo script из .base 1, echo script из .base 2, echo script из referenced]`;

export const INCLUDE_CODE = `# templates.yml
from-include:
  variables: { A: из include, B: из include }
  before_script: [echo before из include]
  script: [echo script из include]

# .gitlab-ci.yml
include: [{ local: /templates.yml }]

from-include:                          # то же имя — не замена, а слияние
  variables: { B: переопределено в корневом файле }
  script: [echo script из корневого файла]

# развёрнутый результат:
#   variables:     A: из include, B: переопределено в корневом файле
#   before_script: [echo before из include]      ← уцелел, хотя в корневом файле его нет
#   script:        [echo script из корневого файла]`;

export const EXTENDS_FACTS = [
  {
    t: 'Правило одно, а последствий два',
    d: 'Словари (наборы «ключ: значение») сливаются, массивы (списки) заменяются. Поэтому `variables` ведёт себя «как ожидалось», а `script` — «неожиданно»: разница не в ключе, а в типе значения.',
  },
  {
    t: 'Опасны массивы, которых вы не писали',
    d: 'Про `script` помнят все. Про `rules`, `tags` и `artifacts.paths` — почти никто. Пока вы не пишете их в своём джобе, они приходят из шаблона. В день, когда написали, список шаблона пропадает целиком — и в изменениях файла этого не видно.',
    tone: 'err' as const,
  },
  {
    t: 'Джоб из `include` не заменяется, а сливается',
    d: 'Если объявить в своём файле джоб с тем же именем, вы его не переписываете, а накладываете свои поля поверх — по тем же правилам слияния. В замере `before_script` из подключённого файла уцелел, хотя в корневом файле его не было вовсе.',
    tone: 'warn' as const,
  },
  {
    t: '`!reference` — вставка вместо замены',
    d: 'Единственный способ **дописать** строки к массиву родителя, а не заменить их. Снято прогоном: `script` из трёх строк собрался из двух строк родителя и одной своей.',
    tone: 'ok' as const,
  },
];

// ---------------------------------------------------------------------------
// Третий проход: бывший «за кадром», раскрытый в теме (по документации, не прогоном)
// ---------------------------------------------------------------------------

/**
 * ⚠️ Всё в этом блоке — **по документации GitLab, не прогоном**: `gitlab-ci-local` не
 * воспроизводит ни раннеров с тегами, ни окружений, ни конвейеров merge request, ни общего
 * кеша, а дочерние конвейеры и компоненты в этом проходе не запускались. YAML-листинги
 * разбираются парсером в `tests/unit/delivery-configs.test.ts` — синтаксис и форма,
 * не поведение. `SHARED_CACHE_CODE` — TOML, парсером не проверяется.
 * Источники: «Executors», «Configure runners → Use tags», «Cache → Use a distributed cache»,
 * «Merge request pipelines», «workflow:rules», «Environments», «Deployment safety →
 * resource_group», «parallel:matrix», «Downstream pipelines», «CI/CD components».
 */

/** Раздел 1 · раннеры, исполнители и теги. */
export const RUNNER_TAGS_CODE = `e2e:
  tags: [docker, gpu]     # раннер обязан иметь ОБА тега
  image: node:22          # образ учитывают только исполнители с контейнерами
  script: npm run e2e`;

export const RUNNER_FACTS = [
  {
    t: 'Раннер — программа, исполнитель — способ запуска',
    d: 'GitLab Runner — программа на чьей-то машине, которая забирает джобы у GitLab. Как именно она их выполняет, решает **исполнитель** (executor), выбранный при регистрации. `docker` — каждый джоб в новом контейнере из `image:`; так сняты все прогоны этой темы. `kubernetes` — каждый джоб отдельным подом в кластере. `shell` — прямо в оболочке машины раннера: `image:` там игнорируется, а всё, что джоб поставил или оставил вне рабочей папки, увидит следующий. Чем опасна такая долгоживущая машина — разобрано в [GitHub Actions: свои раннеры](/delivery/github-actions/#s2).',
    tone: 'info' as const,
  },
  {
    t: 'Теги выбирают раннер, а не описывают его',
    d: 'Джоб с `tags: [docker, gpu]` возьмёт только раннер, у которого есть **все** перечисленные теги. Нет такого — джоб висит в `pending` без ошибки, пока не истечёт время ожидания. И обратное: раннер с тегами по умолчанию не берёт джобы **без** тегов (настройка «run untagged jobs»). Отсюда «на общих раннерах всё шло, на своём ничего не стартует».',
    tone: 'warn' as const,
  },
  {
    t: 'Тег — строка, и она не проверяется',
    d: 'Опечатка в теге — такая же, как опечатка в имени переменной в разделе «Правила запуска»: конвейер собирается, джоб создаётся и ждёт раннер, которого не существует. А теги в шаблоне — массив, и `extends` заменяет их целиком (раздел «Шаблоны и include»).',
    tone: 'err' as const,
  },
];

/** Раздел 3 · кеш между раннерами. TOML из config.toml раннера — не YAML конвейера. */
export const SHARED_CACHE_CODE = `# /etc/gitlab-runner/config.toml — настройка раннера, а не конвейера
[[runners]]
  executor = "docker"
  [runners.cache]
    Type = "s3"            # ещё бывают gcs и azure
    Shared = true          # один кеш на все раннеры с этой настройкой
    [runners.cache.s3]
      ServerAddress = "s3.amazonaws.com"
      BucketName = "ci-cache"
      BucketLocation = "eu-central-1"`;

export const SHARED_CACHE_NOTE =
  'По умолчанию кеш хранит **сам раннер** на своей машине (у исполнителя `docker` — в томе Docker). Раннеров несколько — кешей несколько: джоб, попавший на соседнюю машину, начнёт с пустого, и это ровно то «кеш имеет право исчезнуть», что сказано выше. Общий кеш настраивается не в `.gitlab-ci.yml`, а у раннера: архив кеша уезжает в облачное хранилище файлов (S3 или совместимое), и любой раннер с той же настройкой скачает его оттуда. Цена — сеть: кеш теперь скачивается и загружается архивом на каждом джобе, и джобу, который кеш только читает, стоит поставить `cache: { policy: pull }`, чтобы не выгружать его обратно. **По документации, не прогоном.**';

/** Раздел 5 · конвейеры для merge request. Сниппет — из документации «workflow:rules». */
export const MR_CODE = `# один конвейер на push: для ветки без MR — конвейер ветки, с открытым MR — конвейер MR
workflow:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH`;

export const MR_FACTS = [
  {
    t: 'Три вида конвейера на одну ветку',
    d: '**Конвейер ветки** запускается на push и видит `CI_COMMIT_BRANCH`. **Конвейер merge request** (запроса на слияние) запускается, когда MR открыт или обновлён: `CI_PIPELINE_SOURCE` равен `merge_request_event`, есть переменные `CI_MERGE_REQUEST_*`, а `CI_COMMIT_BRANCH` — **нет**, и правило на неё молча ложно. **Конвейер результата слияния** проверяет не вашу ветку, а то, что получится после её слияния с целевой, — на временном коммите (в платных тарифах).',
    tone: 'info' as const,
  },
  {
    t: 'Два одинаковых конвейера на один push',
    d: 'Конвейер MR сам по себе не появляется: его создаёт джоб, у которого есть правило под `merge_request_event`. Если у джобов есть правила и под push, и под MR, один push в ветку с открытым MR создаёт **оба** конвейера. В Actions то же явление зовётся «один коммит — два прогона»: [GitHub Actions: событие и триггер](/delivery/github-actions/#s1).',
    tone: 'err' as const,
  },
  {
    t: '`workflow:rules` решает раньше джобов',
    d: 'Это правила того же вида, что в демо выше, но для **конвейера целиком**: если ни одно не совпало, конвейер не создаётся вовсе, и правила джобов даже не читаются. Листинг выше — рецепт из документации: пока MR нет, работают конвейеры веток; как только он открыт, остаются только конвейеры MR.',
    tone: 'ok' as const,
  },
];

/** Раздел 5 · ручной выкат, окружения и очередь выкатов. */
export const DEPLOY_CODE = `deploy:prod:
  stage: deploy
  script: ./deploy.sh "$CI_COMMIT_SHORT_SHA"
  environment:
    name: production
    url: https://shop.example.com
  resource_group: production      # два выката в production одновременно не пойдут
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
      when: manual                # кнопка, а не автоматический запуск`;

export const DEPLOY_FACTS = [
  {
    t: 'Окружение — история выкатов',
    d: 'Джоб с `environment:` записывается как выкат: в разделе окружений видно, какой коммит, когда и каким конвейером уехал в `production`, а `url` превращается в ссылку на сайт. Что такое окружение и зачем ему свои секреты и правила — разобрано на примере Actions: [GitHub Actions: права и секреты](/delivery/github-actions/#s7). Здесь — только отличия GitLab.',
  },
  {
    t: 'Откат — это повтор старого джоба',
    d: 'Кнопка отката у окружения не хранит копию сайта: она **перезапускает джоб выката** из прошлого успешного конвейера. Значит, откат работает, только если этот джоб умеет выкатить свою версию заново — например, берёт образ по тегу коммита. Джоб, который собирает «из того, что сейчас в `main`», откатит вас в текущее состояние.',
    tone: 'warn' as const,
  },
  {
    t: '`when: manual` в `rules` останавливает конвейер',
    d: 'Ручной джоб, объявленный через `rules`, по умолчанию **блокирующий**: конвейер получает статус «заблокирован» и не считается пройденным, пока кнопку не нажмут. `when: manual` на уровне самого джоба ведёт себя наоборот — джоб необязательный, и конвейер зелёный без него. Разницу делает умолчание `allow_failure`, и оно у двух записей разное. **По документации.**',
    tone: 'err' as const,
  },
  {
    t: '`resource_group` — очередь на одно окружение',
    d: 'Джобы с одинаковым `resource_group` во **всём проекте** выполняются по одному: второй выкат ждёт, пока закончится первый, даже если они из разных конвейеров. Без этого два почти одновременных merge в `main` выкатываются параллельно, и победит тот, кто закончит последним, — не обязательно более новый.',
  },
  {
    t: 'Одобрение перед выкатом — на стороне GitLab',
    d: 'Кто вправе выкатывать в окружение и сколько одобрений нужно, задаётся в настройках защищённых окружений, а не в файле. Эта часть доступна в платных тарифах.',
  },
];

/** Раздел 6 · матрица, дочерние конвейеры и компоненты. */
export const MATRIX_CODE = `test:
  image: node:$NODE-$OS
  parallel:
    matrix:
      - NODE: ["20", "22"]
        OS: [alpine, bookworm]   # 2 × 2 = четыре джоба
  script: npm test`;

export const CHILD_CODE = `frontend:
  trigger:
    include: frontend/.gitlab-ci.yml   # отдельный конвейер со своими стадиями
    strategy: depend                   # ждать его и взять его статус
  rules:
    - changes: [frontend/**/*]

# конвейер, сгенерированный на лету: один джоб пишет YAML, другой его запускает
generate:
  script: node gen-ci.js > generated.yml
  artifacts: { paths: [generated.yml] }
run-generated:
  needs: [generate]
  trigger:
    include:
      - artifact: generated.yml
        job: generate`;

export const COMPONENT_CODE = `# templates/node-test.yml в проекте-каталоге
spec:
  inputs:
    node-version:
      default: "22"
---
test:
  image: node:$[[ inputs.node-version ]]
  script: npm test

# в .gitlab-ci.yml потребителя — с версией, как зависимость
include:
  - component: $CI_SERVER_FQDN/my-group/ci-templates/node-test@1.2.0
    inputs:
      node-version: "20"`;

export const SCALE_FACTS = [
  {
    t: '`parallel:matrix` — один джоб на каждое сочетание',
    d: 'Из одного описания GitLab создаёт по джобу на сочетание значений; в конвейере они видны как `test: [20, alpine]` и так далее, и каждый — отдельный контейнер со всей ценой границы. Во что обходится каждое сочетание, снято на матрице Actions: [GitHub Actions: матрицы](/delivery/github-actions/#s6). Здесь важно другое: сочетания перемножаются, и две оси по пять значений — это уже двадцать пять джобов.',
    tone: 'warn' as const,
  },
  {
    t: 'Дочерний конвейер — отдельный конвейер',
    d: '`trigger: include:` запускает конвейер со своими стадиями и своим графом. Барьер стадий родителя до него не дотягивается: у монорепозитория фронтенд и бэкенд перестают ждать друг друга. Цена — артефакты сами между родителем и ребёнком не ездят, а переменные передаются вниз, но не обратно.',
    tone: 'info' as const,
  },
  {
    t: 'Без `strategy: depend` родитель не ждёт',
    d: 'Джоб с `trigger` без `strategy: depend` считается успешным, **как только дочерний конвейер создан**. Родитель зелёный, выкат пошёл, а тесты в дочернем конвейере ещё идут — или уже упали.',
    tone: 'err' as const,
  },
  {
    t: 'Компонент — `include` с версией и входами',
    d: 'Обычный `include` приносит чужой YAML «как есть» и сливается с вашим по правилам этого раздела. Компонент — это шаблон с объявленными **входами** (`spec: inputs`) и **версией** после `@`: входы подставляются на месте `$[[ inputs.… ]]` при создании конвейера, а обновление шаблона не ломает вас, пока вы не подняли версию. Опубликованные компоненты собраны в каталог CI/CD — так `include` работает, когда шаблонами пользуются десятки проектов.',
    tone: 'ok' as const,
  },
];

// ---------------------------------------------------------------------------
// Раздел 7. Тонкие места
// ---------------------------------------------------------------------------

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Джоб ждёт всю предыдущую стадию, а не нужного ему соседа',
    tone: 'err',
    code: 'build:b готов на 1,32 с\ntest:unit стартовал на 7,30 с — ждал чужой build:a',
    d: 'Джоб ждёт не того, чей результат ему нужен, а конца всей предыдущей стадии. Один долгий джоб задерживает всех, кому он не нужен: в замере это 5,98 с простоя на конвейере длиной 9,55 с.',
  },
  {
    n: '02',
    t: 'Первое совпавшее правило решает всё',
    tone: 'err',
    code: 'never первым → джоба нет\nnever вторым  → джоб есть (when: always)',
    d: 'Одни и те же правила в разном порядке дали разный конвейер. `when: never` в конце списка почти никогда не срабатывает: до него не доходят. Снято прогоном в четырёх ситуациях.',
  },
  {
    n: '03',
    t: 'Ни одно правило не совпало — джоба нет, а не «пропущен»',
    tone: 'warn',
    d: 'Разница видна, когда на джоб ссылаются. На пропущенный можно сослаться в `needs`, на отсутствующий — нет: из-за такой ссылки GitLab не примет весь файл.',
  },
  {
    n: '04',
    t: '`if: \'$FLAG\'` — это «строка непуста», а не «истина»',
    tone: 'err',
    code: 'FALSE_FLAG=false  →  джоб запустился',
    d: 'Строка `"false"` непуста, поэтому такое условие её пропускает. Выключатель, сделанный из переменной со значением `false`, не выключает ничего. Сравнивайте явно: `$FLAG == "true"`.',
  },
  {
    n: '05',
    t: 'Правило без `if` совпадает всегда',
    tone: 'warn',
    d: 'Если `- when: always` стоит первым, до остальных правил очередь не доходит никогда — хотя список выглядит осмысленным. В замере такой джоб дал `always` во всех четырёх ситуациях, хотя ниже стоял `never`.',
  },
  {
    n: '06',
    t: 'Опечатка в имени переменной не ломает ничего',
    tone: 'err',
    d: 'Неизвестная переменная в условии — пустая строка, а не ошибка. `$DEPOLY == "yes"` просто ложно, джоб молча не запускается, конвейер зелёный. Единственная защита — смотреть, какие джобы попали в конвейер, а не только зелёный ли он.',
  },
  {
    n: '07',
    t: 'На конвейере тега ветки не существует',
    tone: 'warn',
    d: '`$CI_COMMIT_BRANCH` там не определена, поэтому все правила вида `== "main"` перестают совпадать разом. Снято прогоном: из одиннадцати джобов на теге запустились три. Для «ветка или тег» есть `$CI_COMMIT_REF_NAME`.',
  },
  {
    n: '08',
    t: 'Джоб начинает с чистой копии репозитория, а не с того, что оставил сосед',
    tone: 'err',
    code: 'make оставил stray.txt\nuse: cat stray.txt → No such file',
    d: 'Файл, не объявленный артефактом или кешем, до следующего джоба не доживает. Каждый джоб начинает с чистой копии репозитория — в замере он видел только `.git` и `.gitlab-ci.yml`.',
  },
  {
    n: '09',
    t: '`needs` сужает не только ожидание, но и артефакты',
    tone: 'err',
    code: 'needs: [other]  →  приехал только other-out/\n                    out/ от make не приехал',
    d: 'Джоб без `needs` получает артефакты всех джобов прошлых стадий; джоб с `needs` — только названных. Ускорили конвейер одной строкой, потеряли файл в другой.',
  },
  {
    n: '10',
    t: 'Кеш может пропасть, артефакт — обязан приехать',
    tone: 'warn',
    code: 'прогон 2: vendor/ на месте (кеш)\n           out/ отсутствует (артефакт)',
    d: 'В замере кеш дожил до следующего конвейера, артефакт — нет. Но и кеша может не оказаться в любой момент — другой раннер, истёк ключ, — и это нормально. Передавать кешем результат сборки — значит построить конвейер, который работает через раз.',
  },
  {
    n: '11',
    t: '`dependencies: []` выключает артефакты целиком',
    d: 'Полезно, когда джобу не нужны чужие файлы: экономит время загрузки. Опасно тем, что выглядит как мелкая оптимизация, а отключает всё сразу — в замере такой джоб не увидел ни одного артефакта.',
  },
  {
    n: '12',
    t: 'Переменная проекта сильнее написанного в файле',
    tone: 'err',
    code: 'variables в джобе: job\nпеременная проекта: project\nв контейнере:       project',
    d: 'Главный сюрприз приоритетов: «я же прописал значение в `.gitlab-ci.yml`» не работает. Настройки проекта и группы перебивают и корневые `variables:`, и джобовые, и `rules:variables`. Файл не показывает этого никак.',
  },
  {
    n: '13',
    t: '`rules:variables` перебивает `variables:` джоба',
    tone: 'warn',
    d: 'Значение переменной зависит от того, какое правило совпало, — то есть от ветки. Снято прогоном: на `main` джоб напечатал значение из правила, на `feature/x` — из `variables:` джоба.',
  },
  {
    n: '14',
    t: '`extends` заменяет массивы целиком',
    tone: 'err',
    code: 'родитель: script из двух строк, tags: [base-tag]\nпотомок:  script из одной строки\nитог:     обе строки родителя исчезли, base-tag тоже',
    d: 'Словари сливаются, массивы заменяются. Про `script` помнят, про `rules`, `tags` и `artifacts.paths` — нет: они приходят из шаблона и исчезают молча. Добавить, а не заменить, умеет только `!reference`.',
  },
  {
    n: '15',
    t: 'Джоб с тем же именем в `include` сливается, а не заменяется',
    tone: 'warn',
    d: 'Объявив его в своём файле, вы накладываете свои поля поверх чужого джоба. В замере `before_script` из подключённого файла уцелел, хотя в корневом файле его не было, — и выполнился перед вашим `script`.',
  },
  {
    n: '16',
    t: 'Несколько родителей: выигрывает последний',
    d: '`extends: [.a, .b]` при конфликте ключей берёт значение из `.b`. Порядок в списке — это приоритет, и переставленные местами шаблоны меняют поведение джоба, не меняя ни одной другой строки.',
  },
  {
    n: '17',
    t: '`changes` считается от базы, а не от последнего коммита',
    tone: 'warn',
    code: 'коммит тронул docs/  → docs-only: on_success\nследующий тронул src/ → сработали оба',
    d: 'Изменения считаются относительно базы сравнения (в замере — `origin/main`). Поэтому джоб, сработавший на файле однажды, срабатывает и на всех следующих коммитах ветки, пока этот файл отличается от базы.',
  },
  {
    n: '18',
    t: '`only`/`except` и `rules` в одном джобе — ошибка',
    d: 'Не «побеждает сильнейший», а ошибка в файле: конвейер не создастся. `only`/`except` заморожены и новых возможностей не получают. По документации GitLab — прогоном не снято: инструмент, которым снята тема, `only` не вычисляет вовсе.',
  },
];

export const MEASURED = [
  {
    k: 'порядок при стадиях: старт каждой стадии',
    v: '0 / 7,30 / 8,50 с',
    where: 'lab-order',
  },
  {
    k: 'джоб с `needs: [fast]` в gitlab-ci-local',
    v: 'дождался конца стадии (21 с)',
    where: 'lab-dag',
  },
  {
    k: 'вердикты `rules` для 11 наборов правил × 4 контекста',
    v: '44 значения `when`',
    where: 'lab-rules',
  },
  {
    k: '`rules:changes` против `origin/main`',
    v: '3 состояния диффа',
    where: 'lab-changes',
  },
  {
    k: 'что видит джоб в рабочей директории',
    v: '`.git` и `.gitlab-ci.yml`',
    where: 'lab-work',
  },
  {
    k: 'кеш и артефакт во втором конвейере',
    v: 'кеш есть, артефакта нет',
    where: 'lab-work',
  },
  {
    k: '`needs` и `dependencies: []` на загрузку артефактов',
    v: 'только названные / ничего',
    where: 'lab-work',
  },
  {
    k: 'приоритет пяти слоёв одной переменной',
    v: '`globals → job → rules → project → cli`',
    where: 'lab-vars',
  },
  {
    k: '`dotenv` против `variables:` джоба',
    v: 'победил `dotenv`',
    where: 'lab-dotenv',
  },
  {
    k: '`extends`: словари и массивы',
    v: 'развёрнутый YAML `--preview`',
    where: 'lab-extends',
  },
];

// ---------------------------------------------------------------------------
// Раздел 8. Источники
// ---------------------------------------------------------------------------

export const SOURCES = [
  {
    title: 'GitLab CI/CD YAML syntax reference',
    href: 'https://docs.gitlab.com/ee/ci/yaml/',
    what: 'полный список ключей: `stages`, `needs`, `artifacts`, `cache`, `extends`',
  },
  {
    title: 'Specify when jobs run with `rules`',
    href: 'https://docs.gitlab.com/ee/ci/jobs/job_rules.html',
    what: 'первое совпавшее правило, `when: never`, `rules:variables`, `changes`',
  },
  {
    title: 'Choose when to run jobs — `only` / `except`',
    href: 'https://docs.gitlab.com/ee/ci/yaml/#only--except',
    what: 'статус устаревания и запрет на `only` вместе с `rules` в одном джобе',
  },
  {
    title: 'Needs — run jobs out of stage order',
    href: 'https://docs.gitlab.com/ee/ci/yaml/#needs',
    what: 'DAG, `needs: []`, `optional: true` и ограничение на артефакты',
  },
  {
    title: 'Job artifacts',
    href: 'https://docs.gitlab.com/ee/ci/jobs/job_artifacts.html',
    what: 'что скачивается по умолчанию, `dependencies`, `expire_in`, отчёты',
  },
  {
    title: 'Caching in GitLab CI/CD',
    href: 'https://docs.gitlab.com/ee/ci/caching/',
    what: 'ключи кеша, политики и прямое «кеш — не для передачи результатов»',
  },
  {
    title: 'GitLab CI/CD variables',
    href: 'https://docs.gitlab.com/ee/ci/variables/',
    what: 'полная таблица приоритетов слоёв — раздел «Переменные и их приоритеты» сверялся с ней',
  },
  {
    title: 'Predefined CI/CD variables reference',
    href: 'https://docs.gitlab.com/ee/ci/variables/predefined_variables.html',
    what: '`CI_COMMIT_BRANCH`, `CI_COMMIT_TAG`, `CI_PIPELINE_SOURCE` и когда их нет',
  },
  {
    title: 'Use CI/CD configuration from other files',
    href: 'https://docs.gitlab.com/ee/ci/yaml/includes.html',
    what: 'правила слияния при `include` и джоб с тем же именем',
  },
  {
    title: 'GitLab Runner — executors и теги',
    href: 'https://docs.gitlab.com/runner/executors/',
    what: 'исполнители `shell`, `docker`, `kubernetes`; выбор раннера по тегам и «run untagged jobs»',
  },
  {
    title: 'Merge request pipelines и `workflow:rules`',
    href: 'https://docs.gitlab.com/ee/ci/pipelines/merge_request_pipelines.html',
    what: 'три вида конвейера, `merge_request_event`, рецепт против двойных конвейеров',
  },
  {
    title: 'Environments and deployments',
    href: 'https://docs.gitlab.com/ee/ci/environments/',
    what: 'окружения, история выкатов, откат, `resource_group`, защищённые окружения',
  },
  {
    title: 'Downstream pipelines',
    href: 'https://docs.gitlab.com/ee/ci/pipelines/downstream_pipelines.html',
    what: 'дочерние конвейеры, `strategy: depend`, конвейеры из артефакта',
  },
  {
    title: 'CI/CD components',
    href: 'https://docs.gitlab.com/ee/ci/components/',
    what: '`spec: inputs`, версии компонентов и каталог',
  },
  {
    title: 'Use a distributed cache',
    href: 'https://docs.gitlab.com/runner/configuration/autoscale.html#distributed-runners-caching',
    what: 'общий кеш раннеров в S3-совместимом хранилище, `Shared = true`',
  },
  {
    title: 'gitlab-ci-local',
    href: 'https://github.com/firecow/gitlab-ci-local',
    what: 'инструмент, которым сняты прогоны темы: версия 4.75.1',
  },
];

/* ──────────────────── Вводный раздел · словарь темы ──────────────────── */

/**
 * Слова, которыми тема пользуется раньше, чем объясняет.
 *
 * Все они — ключи YAML, и в этом ловушка: имя выглядит понятным, а значит не то, что
 * подсказывает вид файла. «Стадия» звучит как зависимость, «кеш» — как способ передать
 * файлы; оба прочтения неверны, и тема начинается ровно с этого.
 */
export const GLOSSARY = [
  {
    k: 'стадия (stage)',
    d: 'Группа джобов, после которой все ждут друг друга. **Это не зависимость:** джоб ждёт не того, чей результат ему нужен, а конца всей предыдущей стадии. В замере нужный результат был готов на 1,32 с, а джоб стартовал только на 7,30 с.',
  },
  {
    k: 'джоб',
    d: 'Одна задача конвейера (от англ. job): свой контейнер, своя **копия репозитория**, своя рабочая папка. Из предыдущего джоба сюда само по себе ничего не попадает.',
  },
  {
    k: 'раннер',
    d: 'Программа-исполнитель (от англ. runner): забирает джоб и выполняет его на своей машине. От её настроек зависят образ, теги и то, сколько джобов идут одновременно. Отсюда половина расхождений между «у меня работает» и «в проекте нет».',
  },
  {
    k: 'артефакт',
    d: 'Файлы, которые джоб объявил своим результатом. Следующие джобы получают их **автоматически** — для передачи результата дальше артефакт и нужен.',
  },
  {
    k: 'кеш',
    d: 'Способ ускорить повторную работу, а не передать файлы. Джоб получает кеш по имени ключа — если он есть, без гарантий. Документация GitLab говорит это прямо, а половина странных конвейеров вырастает из попытки передать кешем результат сборки.',
  },
  {
    k: '`rules`',
    d: 'Список условий, который читается сверху вниз **до первого совпадения**, — а не набор «или». Те же два правила в другом порядке дают другой конвейер; это снято прогоном.',
  },
  {
    k: '`needs` и DAG',
    d: 'Прямая зависимость одного джоба от другого поверх стадий. С ней конвейер из лестницы стадий становится графом зависимостей (DAG — граф без циклов). `needs: []` значит «стартуй сразу, никого не жди».',
  },
  {
    k: '`extends` и `include`',
    d: '`extends` наследует настройки из блока-шаблона, `include` подключает другой файл. Оба **сливают словари, а массивы заменяют целиком**. Отсюда самая частая неожиданность: список команд не дополнился, а подменился.',
  },
  {
    k: 'предопределённые переменные',
    d: 'Переменные, которые GitLab задаёт сам: `CI_COMMIT_BRANCH`, `CI_COMMIT_TAG`, `CI_PIPELINE_SOURCE` и другие. Важно не то, что они есть, а то, что **иногда их нет вовсе**: например, на конвейере тега нет ветки. Правило, построенное на отсутствующей переменной, ведёт себя не так, как ожидаешь.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

/* ──────────────────── Врезки «на пальцах» и подписи к демо ──────────────────── */

/** Стадия как барьер — в начале раздела про стадии. */
export const PLAIN_STAGE_BARRIER =
  'Стадия — как привал в походе с правилом «идём дальше, когда подошёл последний». Дальше все выходят вместе, по самому медленному, — даже тот, кому нужен был только проводник, пришедший первым. Кто кого ждёт по делу, в файле не написано — только кто в какой группе.';

/** `rules` — в начале раздела про правила. */
export const PLAIN_RULES =
  'Правила — не «или», а ряд окошек, которые джоб обходит слева направо. У первого окошка, где табличка подошла, решение и принимается — «берём», «не берём», «вручную», — и к остальным он уже не идёт. Переставьте окошки — тот же джоб получит другой ответ. Не подошло ни одно — джоба в конвейере нет.';

/** Артефакт против кеша — в начале раздела про границу джоба. */
export const PLAIN_ART_CACHE =
  'Артефакт — посылка с описью: следующий джоб получит её гарантированно, и без неё он работать не может. Кеш — вещи в камере хранения на вокзале: вернулись на тот же вокзал — забрали и сэкономили время, попали на другой — покупаете заново. Передавать кешем результат сборки — всё равно что отправлять посылку через камеру хранения.';

/** Приоритет переменных — в начале раздела про переменные. */
export const PLAIN_VAR_PRIORITY =
  'Слои переменных — как распоряжения в фирме: в `.gitlab-ci.yml` пишет отдел, в настройках проекта — директор. Отдел может уточнять у себя сколько угодно, но если директор распорядился иначе, действует его слово, хотя отдел сидит ближе к исполнителю. И в бумагах отдела распоряжения директора не видно.';

/** Подпись к демо правил. */
export const RULES_DEMO_NOTE =
  'Три переключателя описывают конвейер: «Из-за чего завёлся конвейер», «Ветка» и «Что изменил коммит». Кнопки ↑ и ↓ двигают правило по списку, × убирает его, + возвращает. Кнопки в строке «Где задана `DEPLOY`» включают места, где задана переменная. Следите, какое правило совпало первым: всё ниже него уже не читается. И за тем, что условия видят в переменных: на теге `$CI_COMMIT_BRANCH` «не определена».';

/** Подпись к демо графа. */
export const GRAPH_DEMO_NOTE =
  'Переключатель «Чем связаны джобы» выбирает «по стадиям» или «с needs»; рядом — время всего конвейера. Пустой отрезок перед полосой джоба — это время, которое он ждал. Смотрите на него и на подпись справа от полосы. Строка под шкалой называет, когда закончился `deploy` и сколько секунд сэкономил `needs`.';

export const PREREQ_NOTE =
  'Джоб работает внутри контейнера и передаёт дальше результат сборки. Поэтому тема опирается на две вещи: что такое образ контейнера и что выдаёт сборщик.';

export const PREREQ = [
  {
    t: 'Джоб выполняется в контейнере',
    d: 'Каждый джоб получает образ и запускается внутри него. Что такое образ, из чего он состоит и почему в нём «уже всё установлено», здесь не повторяется.',
    href: '/delivery/docker/#s1',
    hrefLabel: 'Docker: что такое образ',
    tone: 'info' as const,
  },
  {
    t: 'Что производит сборка',
    d: 'Артефакт — это результат сборки, и его размер и состав решаются не здесь. Что выдаёт сборщик — один файл, набор чанков (кусков кода) или ещё и карты исходников, — то и стоит объявлять артефактом.',
    href: '/tooling/modules/#s5',
    hrefLabel: 'Модули и сборка · Чанки и кеш',
    tone: 'warn' as const,
  },
];

/** Вывод к таблице ключей: раздел 1 кончался ею молча. */
export const ORDER_NOTE =
  'Все эти ключи **решают состав и порядок конвейера в момент его создания, а не по ходу работы.** Поэтому ошибку в них не найти в логах джоба — она видна по тому, какие джобы вообще появились. Если что-то «не запустилось», смотрите сначала не вывод команд, а список джобов в созданном конвейере.';

/**
 * Смежное на сайте.
 *
 * Тема была сиротой: ни одной входящей ссылки при том, что прямой её аналог — соседняя
 * тема направления. Теперь связь двусторонняя.
 */
export const RELATED =
  'Смежное на сайте: [GitHub Actions: конвейер](/delivery/github-actions/) — тот же вопрос «что решает, запустится ли шаг, и какие файлы доживут до следующего» в другом инструменте; сравнивать полезно. [Docker: образ и слои](/delivery/docker/) — что именно уезжает в контейнере каждого джоба. [Kubernetes: развёртывание](/delivery/kubernetes/) — куда конвейер выкатывает результат. [Модули и сборка](/tooling/modules/) — из чего складывается то, что вы объявляете артефактом.';

// ---------------------------------------------------------------------------
// Трудные места — подробно
// ---------------------------------------------------------------------------

/**
 * Три файла одного джоба — три судьбы. Автор курса (2026-09-29): трудное не сокращать,
 * а объяснять подробно и просто. `ART_ROWS` сравнивала артефакт и кеш по шести признакам
 * разом; здесь каждый файл из `ARTIFACTS_CODE` прослежен через три границы. Первые две
 * границы — снятые прогоном строки `WORKSPACE_LOG`; третья (другой раннер) — по
 * `SHARED_CACHE_NOTE` и документации GitLab «Caching», прогоном не снималась.
 */
export const FILES_SCENE: string[] = [
  'Джоб `make` из листинга выше оставляет в рабочей папке три файла: `out/app.txt` (объявлен артефактом), `vendor/dep.txt` (объявлен кешем) и `stray.txt` (не объявлен никак). Проследим каждый через три границы: следующая стадия этого конвейера, следующий конвейер на том же раннере, следующий конвейер на другом раннере.',
  'Что было бы, **если бы файлы не объявляли вовсе**. Джоб кончился — его контейнер и рабочая папка выброшены. Следующий джоб начинает со свежей копии репозитория: в замере он видел только `.git` и `.gitlab-ci.yml`. Всё, что сделал `make`, пропало бы на первой же границе — именно так пропал `stray.txt`.',
];

export const FILES_FATES: { k: string; next: string; pipeline: string; runner: string; cost: string }[] = [
  {
    k: '`out/app.txt` — артефакт',
    next: 'приехал: GitLab выгрузил его после `make` и скачал перед `use`. Так же он приехал бы в любой джоб следующих стадий — если тот не сузил загрузку через `needs` или `dependencies`',
    pipeline: 'не приехал: артефакт живёт внутри своего конвейера. В новом конвейере его снова должен кто-то сделать',
    runner: 'для артефакта раннер не важен: он лежит на сервере GitLab, а не на машине раннера',
    cost: 'Гарантия стоит выгрузки и скачивания на каждой границе. Зато если файла нет — джоб падает сразу, а не работает с чем попало.',
  },
  {
    k: '`vendor/dep.txt` — кеш',
    next: 'приехал в `use`, потому что тот объявил тот же `key: shared-cache`. Джоб без секции `cache` его не получил бы',
    pipeline: 'приехал: второй прогон `make` уже в начале видел `vendor/`. Ради этого кеш и заводят',
    runner: 'не приедет, если кеш хранится на машине раннера (так по умолчанию): у соседнего раннера свой, пустой. Приедет, только если у раннеров настроен общий кеш в облачном хранилище',
    cost: 'Ничего не обещает. Пропал — джоб просто работает дольше, поэтому передавать через кеш можно только то, что джоб в состоянии сделать заново.',
  },
  {
    k: '`stray.txt` — ничей',
    next: 'не приехал: `cat stray.txt` — `No such file`',
    pipeline: 'не приехал',
    runner: 'не приехал',
    cost: 'Самый коварный вариант: внутри джоба файл есть, и всё, что его читает в том же джобе, работает. Пропажа видна только на границе.',
  },
];

/** Продолжение `PLAIN_ART_CACHE` — те же посылка и камера хранения на трёх границах. */
export const PLAIN_FILES =
  'Те же посылка и камера хранения. Посылку с описью (артефакт) доставят в соседний цех того же заказа, где бы он ни был, — но в следующий заказ её не положат. Вещи в камере (кеш) дождутся вас и завтра — если вернётесь на тот же вокзал. А то, что вы просто оставили на столе в цехе (ничей файл), уберут вместе со столом в конце смены.';

/**
 * `rules` на пяти событиях. Автор курса (2026-09-29): не сокращать, а объяснять подробно.
 * `RULE_STEPS` описывали порядок чтения, но не прогоняли по нему сам `RULES_CODE`. Здесь —
 * пять событий через те же пять правил. Поведение — ровно `RULE_STEPS` (первое совпадение,
 * `on_success` по умолчанию, `never` — джоба нет, правило без условий совпадает всегда);
 * документация GitLab «rules». Отдельным прогоном этот разбор не снимался — вердикты
 * похожих джобов сняты в `RULE_CHECK`.
 */
export const RULES_SCENE: string[] = [
  'Джоб `deploy:prod` из листинга выше и пять разных событий. На каждом GitLab идёт по правилам сверху вниз и останавливается на первом, чьё условие выполнено.',
  'Сначала — как вышло бы, если бы правила читались как «или»: «запустить, если совпало хоть одно». Последнее правило `when: always` совпадает всегда, значит джоб запускался бы на **любом** событии — и в ночном конвейере тоже, хотя первое правило прямо говорит «ночью не ходить». Первое правило стало бы бессмысленным. Порядок «до первого совпадения» и нужен, чтобы запрет выше мог перекрыть разрешение ниже.',
];

export const RULES_WALK: { k: string; path: string; verdict: string }[] = [
  {
    k: 'Ночной конвейер по расписанию',
    path: 'правило 1: `$CI_PIPELINE_SOURCE == "schedule"` — да. Остановка',
    verdict: '`when: never` — джоба в конвейере **нет**. До правила 5 очередь не дошла',
  },
  {
    k: 'Тег `v1.4.0`',
    path: 'правило 1 — нет, это не расписание. Правило 2: тег подходит под `/^v[0-9]+/` — да. Остановка',
    verdict: '`when` не написан — значит `on_success`: джоб запустится, когда пройдут предыдущие стадии',
  },
  {
    k: 'Push в `main`, запуск с `DEPLOY=yes`',
    path: 'правила 1 и 2 — нет. Правило 3: ветка `main` и `DEPLOY == "yes"` — да. Остановка',
    verdict: '`on_success`, и джоб получает переменную `TARGET=production` — её задаёт только это правило',
  },
  {
    k: 'Push в `main` без `DEPLOY`, тронут `src/`',
    path: 'правила 1–2 — нет. Правило 3 — нет: `DEPLOY` не задан. Правило 4: изменения в `src/` — да. Остановка',
    verdict: '`when: manual` — в конвейере появится кнопка, и без нажатия выката не будет. `TARGET` не задан: правило 3 не сработало',
  },
  {
    k: 'Push в ветку `docs`, тронут только `README`',
    path: 'правила 1–4 — нет. Правило 5 без условий совпадает всегда',
    verdict: '`when: always` — джоб войдёт в конвейер и, по документации GitLab, запустится независимо от исхода прошлых стадий. Скорее всего, это не то, чего хотел автор: выкат в production из ветки с документацией',
  },
];

/** Продолжение `PLAIN_RULES` — те же окошки, пройденные пять раз. */
export const PLAIN_RULES_WALK =
  'Те же окошки. Первое — «ночью не принимаем»: ночной посетитель разворачивается у него и до остальных не доходит. Последнее окошко без таблички принимает всех — поэтому ставить его первым нельзя, а оставлять последним надо с умыслом: к нему приходят все, кому не подошло ни одно окошко выше, и о них вы, скорее всего, не думали.';

/* ──────────────────── Схемы ──────────────────── */

/**
 * Шкала времени стадий — раздел «Стадии и джобы», перед карточкой «Что из этого вышло
 * в прогоне».
 *
 * Изображает ровно метки `STAGE_TIMELINE` (секунды от старта конвейера, снято прогоном
 * `gitlab-ci-local`) на джобах `STAGES_CODE`. Отрезок ожидания `test:unit` — те самые
 * 5,98 с из `STAGE_FACTS` (7,30 − 1,32). Новых чисел нет; ширина полос пропорциональна
 * времени.
 */
export const STAGE_DIAGRAM = {
  title: 'Кто кого ждёт: метки прогона на шкале времени',
  total: 9.55,
  stages: [
    {
      name: 'build',
      jobs: [
        { name: 'build:a', from: 0, to: 7.3, note: '`sleep 6`' },
        { name: 'build:b', from: 0, to: 1.32, note: 'готов на 1,32 с' },
      ],
    },
    {
      name: 'test',
      jobs: [
        {
          name: 'test:unit',
          from: 7.3,
          to: 8.5,
          wait: { from: 1.32, label: 'ждёт 5,98 с: `build:b` готов, но стадия `build` — нет' },
        },
        { name: 'test:lint', from: 7.3, to: 8.5 },
      ],
    },
    { name: 'deploy', jobs: [{ name: 'deploy', from: 8.5, to: 9.55 }] },
  ] as {
    name: string;
    jobs: { name: string; from: number; to: number; note?: string; wait?: { from: number; label: string } }[];
  }[],
  barriers: [
    { at: 7.3, label: '7,30 — стадия `build` закрыта' },
    { at: 8.5, label: '8,50 — `test` закрыта' },
  ],
  axis: [
    { at: 0, label: '0 с' },
    { at: 1.32, label: '1,32' },
    { at: 7.3, label: '7,30' },
    { at: 8.5, label: '8,50' },
    { at: 9.55, label: '9,55 с' },
  ],
  caption:
    'Нужный `test:unit` результат готов на 1,32 с, а стартует он на 7,30 с: стадия открывается только тогда, когда закончился самый долгий джоб прошлой.',
};
