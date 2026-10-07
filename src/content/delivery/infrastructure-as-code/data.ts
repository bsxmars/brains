import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { Config, Schema } from '@/widgets/iac-lab/model/types';

/**
 * Данные темы «Инфраструктура как код: Terraform и OpenTofu изнутри».
 *
 * Тема написана здесь, 2026-10-02, для направления «Доставка».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * OpenTofu **1.12.7** — образ `ghcr.io/opentofu/opentofu:latest` (linux/arm64) в Docker Desktop
 * на macOS. Бинаря Terraform на машине нет: всё, что снято, снято OpenTofu; Terraform назван
 * как оригинал, а его отличия взяты из документации и помечены ниже. Облака нет: только
 * провайдеры без внешнего API — `hashicorp/local` **2.9.1** (`local_file`), `hashicorp/random`
 * **3.9.1** (`random_pet`, `random_password`) и встроенный `terraform_data`.
 *
 * ⚠️ Реестр `registry.opentofu.org` со стенда отвечал `403 Forbidden` (Cloudflare, по географии),
 * поэтому `tofu init` без помощи провайдеры не скачивает. Провайдеры взяты из релизов на GitHub
 * (`github.com/opentofu/terraform-provider-{local,random}` — их же раздаёт реестр OpenTofu)
 * и подложены через `init -plugin-dir`. Тест умеет то же через `TOFU_PLUGIN_DIR`.
 *
 * Что снято:
 *   — сквозной пример (`MAIN_TF`) применён с `count` и с `for_each`; состояния сжаты в `stand.ts`;
 *   — 51 план: 48 сочетаний переключателей демо (режим × правка × окружения × дрейф) и три
 *     сверх них — `create_before_destroy`, `depends_on`, ресурс убран из конфигурации. По каждому
 *     — `tofu show -json` (действия, причины, `previous_address`, `replace_paths`, дрейф),
 *     текст `tofu show` (заголовки `# …` и строка `Plan:`) и граф `tofu graph -plan`;
 *   — `terraform.tfstate` после первого `apply` (`STATE_JSON_CODE` — выдержка из него);
 *   — `sensitive`-вывод, `tofu output`, `-raw`, `-json` и число вхождений пароля в состоянии;
 *   — шифрование состояния OpenTofu (`pbkdf2` + `aes_gcm`) и отказ с неверной фразой;
 *   — `tofu state push` чужого `lineage` и того же `serial`;
 *   — бэкенд `http` против своего сервера на Node (порт 5001 на стенде, в тесте — случайный):
 *     запросы `init`, `plan`, `apply` и отказ `423` при втором процессе во время `apply`;
 *   — `-target`, `-replace`, `import` с `-generate-config-out` (`random_password`; у `local_file`
 *     импорта нет — «Resource Import Not Implemented»), `ephemeral` и его отказ в обычном поле,
 *     `plan -refresh-only` после ручной правки, модуль, вызванный дважды;
 *   — `tofu apply -h`: `-parallelism` «Defaults to 10»; `plan -h`: `-exclude` есть.
 *
 * Пересобирает всё перечисленное `tests/unit/infrastructure-as-code.test.ts`, если есть Docker
 * и образ (`describe.skipIf`); без Docker тест сверяет `PLAN_CODE` и вид плана с литералами
 * `stand.ts` на всех 51 сценарии.
 *
 * Снято один раз, тестом не повторяется: локальный замок состояния (`flock`) на каталоге хоста,
 * смонтированном в **два** контейнера Docker Desktop, второй процесс не остановил — файл
 * `.terraform.tfstate.lock.info` был, а `plan` прошёл. Внутри одного контейнера тот же опыт
 * даёт «Error acquiring the state lock» (это тест повторяет). Ещё снято без повтора: 20 прогонов
 * `apply` после удаления `stage` из `count` — во всех двадцати удаления шли раньше создания,
 * и `prod.txt` в итоге был на месте, хотя ребра между `env[1]` и удалением `env[2]` в графе нет.
 *
 * Только по документации (в тексте сказано словами «по документации» или без цифр стенда):
 * лицензия Terraform (BSL с августа 2023) и ответвление OpenTofu от 1.5; бэкенды S3, GCS,
 * azurerm, pg и их замки, включая `use_lockfile` и устаревший DynamoDB; ephemeral-ресурсы
 * в Terraform с 1.10; шифрование состояния в OpenTofu с 1.7; что у Terraform нет шифрования
 * состояния на стороне клиента; устройство Pulumi, AWS CDK и Crossplane.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'провайдер',
    d: 'Плагин, который умеет разговаривать с одной системой: облаком, GitHub, файловой системой. Отдельная программа; Terraform сам не знает ни одного API и всё делает через провайдеров.',
  },
  {
    k: 'ресурс и адрес',
    d: 'Ресурс — блок `resource "тип" "имя"`: один объект, которым управляет Terraform. Адрес — его имя внутри Terraform: `local_file.config`, а у размноженных — `local_file.env[1]` или `local_file.env["dev"]`.',
  },
  {
    k: 'состояние (state)',
    d: 'JSON-файл, где записано, какой настоящий объект стоит за каждым адресом и какие у него были поля после прошлого запуска.',
  },
  {
    k: 'план и apply',
    d: 'План — список действий, после которых мир станет таким, как в конфигурации. `apply` — выполнить этот список.',
  },
  {
    k: 'дрейф',
    d: 'Расхождение настоящего объекта с тем, что записано в состоянии. Появляется, когда объект меняют мимо Terraform: руками в консоли облака, другим скриптом.',
  },
  {
    k: 'поле, требующее замены',
    d: 'Поле, которое у живого объекта поменять нельзя: только удалить объект и создать новый. В провайдерах это называется ForceNew или RequiresReplace.',
  },
  {
    k: 'HCL',
    d: 'Язык конфигураций Terraform: блоки в фигурных скобках, `имя = значение`, подстановки `${…}`. Файлы с ним кончаются на `.tf`.',
  },
];

export const PLAIN_IAC =
  'Как заказ мебели по описи. Вы не пишете грузчикам «внести стол, потом внести второй стол». Вы даёте опись: «в комнате два стола и шкаф». Грузчики смотрят, что уже стоит, и вносят только недостающее. Если опись не менялась, второй визит ничего не меняет.';

export const PREREQ_NOTE =
  'Тема опирается на три вещи, разобранные в других темах, и на одну, которая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Желаемое состояние и сверка',
    d: 'Описание говорит, каким система должна быть, а программа сама доводит её до описанного. В Kubernetes так работают контроллеры: сравнивают и исправляют в цикле.',
    href: '/delivery/kubernetes/#s1',
    hrefLabel: '«Kubernetes: развёртывание», раздел «Под и контроллеры»',
    tone: 'info',
  },
  {
    t: 'Конфигурация в Git',
    d: 'Описание инфраструктуры лежит в репозитории, правится через ревью и применяется конвейером или контроллером.',
    href: '/delivery/helm-gitops/#s8',
    hrefLabel: '«Helm, Kustomize и GitOps», раздел «GitOps»',
    tone: 'info',
  },
  {
    t: 'Порядок по графу зависимостей',
    d: 'Если A нужен для B, то A делают раньше. Упорядочить так все узлы графа — это топологическая сортировка.',
    href: '/tooling/monorepo/#s3',
    hrefLabel: '«Монорепозитории», раздел «Граф и порядок»',
    tone: 'info',
  },
  {
    t: 'Терминал и Docker',
    d: 'Команды стенда запускают OpenTofu в контейнере: `docker run … ghcr.io/opentofu/opentofu init` — то же, что `tofu init` на машине с установленным OpenTofu.',
    tone: 'info',
  },
];

// ─── Раздел 1. Желаемое состояние ──────────────────────────────────────────────────────────

/**
 * Сквозной пример — объект, а не HCL: из него `toHcl` печатает `MAIN_TF`, демо строит сценарии,
 * а тест кладёт тот же текст в `main.tf` перед `tofu apply`. Строки с `${key}` — элемент списка
 * окружений (в HCL это `local.envs[count.index]` или `each.key`).
 */
export const BASE_CONFIG: Config = {
  resources: [
    { type: 'random_pet', name: 'app', attrs: { length: 2 } },
    { type: 'random_password', name: 'db', attrs: { length: 16, special: false } },
    { type: 'terraform_data', name: 'release', attrs: { input: 'v1' } },
    {
      type: 'local_file',
      name: 'config',
      attrs: {
        filename: 'out/app.conf',
        content: 'app=${random_pet.app.id}\nrelease=${terraform_data.release.output}\ndb_password=${random_password.db.result}\n',
      },
    },
    {
      type: 'local_file',
      name: 'env',
      count: ['dev', 'stage', 'prod'],
      attrs: { filename: 'out/${key}.txt', content: 'env=${key}\n' },
    },
  ],
};

/** `toHcl(BASE_CONFIG, { header: true })` — тест сверяет дословно. */
export const MAIN_TF = `terraform {
  required_providers {
    local = {
      source  = "hashicorp/local"
      version = "2.9.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
  }
}

locals {
  envs = ["dev", "stage", "prod"]
}

resource "random_pet" "app" {
  length = 2
}

resource "random_password" "db" {
  length  = 16
  special = false
}

resource "terraform_data" "release" {
  input = "v1"
}

resource "local_file" "config" {
  filename = "out/app.conf"
  content  = "app=\${random_pet.app.id}\\nrelease=\${terraform_data.release.output}\\ndb_password=\${random_password.db.result}\\n"
}

resource "local_file" "env" {
  count    = length(local.envs)
  filename = "out/\${local.envs[count.index]}.txt"
  content  = "env=\${local.envs[count.index]}\\n"
}
`;

export const EXAMPLE_PARTS = [
  { k: '`random_pet.app`', d: 'Случайное имя приложения из двух слов, вроде `cool-corgi`. Заменитель облачного объекта с вычисляемым `id`.' },
  { k: '`random_password.db`', d: 'Пароль базы из 16 символов. Нужен, чтобы увидеть, куда Terraform кладёт секреты.' },
  { k: '`terraform_data.release`', d: 'Встроенный ресурс без провайдера: хранит значение `input` и отдаёт его как `output`. Единственный здесь, кто умеет меняться на месте.' },
  { k: '`local_file.config`', d: 'Файл, собранный из трёх ресурсов выше. Ссылки `${…}` в его содержимом — это и подстановка, и зависимость.' },
  { k: '`local_file.env`', d: 'По файлу на окружение: `count` размножает ресурс по списку `local.envs`.' },
];

export const STAND_NOTE =
  'Вместо сервера — файл, вместо облака — диск. Механика плана от этого не меняется: провайдер `local` точно так же сообщает, какие поля требуют замены, а `random` — что значение станет известно только после создания. Зато пример запускается без облачного аккаунта.';

export const CYCLE_CHIPS = [
  { label: '.tf — что должно быть', tone: 'ok' as const },
  { label: 'init — провайдеры' },
  { label: 'plan — refresh и сравнение' },
  { label: 'apply — действия' },
  { label: 'terraform.tfstate', tone: 'warn' as const },
];

export const CYCLE_ROWS = [
  { k: '`tofu init`', d: 'Читает блок `required_providers`, скачивает провайдеров в `.terraform/` и записывает точные версии и хеши в `.terraform.lock.hcl`.' },
  { k: '`tofu plan`', d: 'Перечитывает настоящие объекты из состояния (refresh), сравнивает их с конфигурацией и печатает список действий. Ничего не меняет.' },
  { k: '`tofu apply`', d: 'Строит тот же план, спрашивает подтверждение и выполняет его, обходя граф зависимостей. После каждого объекта обновляет состояние.' },
  { k: '`tofu destroy`', d: 'План, где каждое действие — удаление, в обратном порядке графа.' },
];

/** Второй `apply` той же конфигурации: строка из `tofu show` сценария `count.none.all.clean`. */
export const SECOND_RUN = `$ tofu apply      # второй раз, конфигурация та же
No changes. Your infrastructure matches the configuration.`;

export const TOFU_NOTE =
  'Terraform написала HashiCorp в 2014 году. В августе 2023-го компания перевела его на лицензию BSL, которая ограничивает конкурирующие коммерческие продукты, и сообщество ответвило последнюю открытую версию 1.5 — так появился OpenTofu (лицензия MPL 2.0, фонд Linux Foundation). Язык, формат состояния и команды у них общие: `terraform plan` и `tofu plan` делают одно и то же. Дальше примеры сняты OpenTofu, а слово Terraform означает оба инструмента; где они расходятся, сказано отдельно.';

// ─── Раздел 2. Файл состояния ──────────────────────────────────────────────────────────────

export const PLAIN_STATE =
  'Конфигурация — это опись «в комнате два стола». Состояние — инвентарная книга: «стол №1 — вот этот, инвентарный номер 4471». Без книги грузчик видит в комнате столы, но не знает, какие из них ваши, а какие соседские, — и на всякий случай привезёт ещё два.';

/**
 * Выдержка из настоящего `terraform.tfstate` после первого `apply` (`stand.ts`, `STATE_COUNT`):
 * три записи из пяти и часть полей. Тест проверяет, что это подмножество свежего состояния
 * (случайные `lineage`, пароль, хеш и содержимое `config` — по типу).
 */
export const STATE_JSON_CODE = `{
  "version": 4,
  "terraform_version": "1.12.7",
  "serial": 1,
  "lineage": "66b936b8-db9a-c9b7-3fba-e79f7939629c",
  "outputs": {},
  "resources": [
    {
      "mode": "managed",
      "type": "random_password",
      "name": "db",
      "provider": "provider[\\"registry.opentofu.org/hashicorp/random\\"]",
      "instances": [
        {
          "schema_version": 3,
          "attributes": {
            "id": "none",
            "length": 16,
            "special": false,
            "result": "yZx5zg0EmvQjvOji",
            "bcrypt_hash": "$2a$10$pTPj4hqiZ.FzdvDevBxv4OCxRNke5HiURAt6CEhUalH5kJH291aru"
          },
          "sensitive_attributes": [
            [{ "type": "get_attr", "value": "bcrypt_hash" }],
            [{ "type": "get_attr", "value": "result" }]
          ]
        }
      ]
    },
    {
      "mode": "managed",
      "type": "local_file",
      "name": "env",
      "provider": "provider[\\"registry.opentofu.org/hashicorp/local\\"]",
      "instances": [
        {
          "index_key": 0,
          "schema_version": 0,
          "attributes": {
            "filename": "out/dev.txt",
            "content": "env=dev\\n",
            "id": "d8d51f5230722d3284facaef278d84831353cfdd"
          }
        }
      ]
    },
    {
      "mode": "managed",
      "type": "local_file",
      "name": "config",
      "provider": "provider[\\"registry.opentofu.org/hashicorp/local\\"]",
      "instances": [
        {
          "schema_version": 0,
          "attributes": {
            "filename": "out/app.conf",
            "content": "app=cool-corgi\\nrelease=v1\\ndb_password=yZx5zg0EmvQjvOji\\n"
          },
          "dependencies": [
            "random_password.db",
            "random_pet.app",
            "terraform_data.release"
          ]
        }
      ]
    }
  ],
  "check_results": null
}`;

export const STATE_FIELDS = [
  { k: 'version', d: 'Версия формата файла. Сейчас `4` — и у Terraform, и у OpenTofu.' },
  { k: 'serial', d: 'Номер записи. Растёт при каждой записи состояния: после первого `apply` — `1`, после второго, который что-то поменял, — `2`.' },
  { k: 'lineage', d: 'Случайный номер «рода», выдаётся, когда состояние создаётся впервые, и потом не меняется. По нему видно, что два файла — версии одного состояния, а не разных.' },
  { k: 'resources[].instances[]', d: 'По записи на экземпляр: `index_key` (`0` у `count`, `"dev"` у `for_each`), все поля объекта в `attributes` и `dependencies` — от кого он зависел.' },
  { k: 'sensitive_attributes', d: 'Список путей к полям, которые при выводе надо закрыть. Сами значения при этом лежат в `attributes` открыто.' },
];

export const STATE_JOBS = [
  {
    t: 'Адрес → настоящий объект',
    d: 'В облаке у объекта свой номер: `i-0abc…` у сервера, имя у бакета. Конфигурация его не знает. Состояние связывает `local_file.env[0]` с файлом `out/dev.txt`, а `random_pet.app` — со значением `cool-corgi`.',
  },
  {
    t: 'Поля на момент прошлого apply',
    d: 'План сравнивает конфигурацию с тем, что записано, — после refresh, то есть после того, как провайдер перечитал объект. Без записи провайдеру нечего перечитывать: он не знает, какой объект читать.',
  },
  {
    t: 'Зависимости для удаления',
    d: 'Когда ресурс убирают из конфигурации, его ссылок больше нет. Порядок удаления Terraform берёт из `dependencies` в состоянии: у `local_file.config` там записаны все три ресурса, из которых он собран.',
  },
];

/** `tofu state push` на стенде: чужое состояние и состояние с тем же `serial`. */
export const LINEAGE_CODE = `$ tofu state push other.tfstate      # состояние из другого каталога
Error: Failed to write the imported state

cannot import state with lineage "e66ffcab-bdf3-19cf-344e-cea91d231eaa" over
unrelated state with lineage "66b936b8-db9a-c9b7-3fba-e79f7939629c"

$ tofu state push older.tfstate      # тот же lineage, тот же serial, другое содержимое
Error: Failed to write the imported state

cannot overwrite existing state with serial 1 with a different state that has
the same serial`;

export const LINEAGE_NOTE =
  '`lineage` и `serial` — защита от перепутанных файлов. Чужое состояние поверх своего не ляжет, старая копия поверх новой — тоже. Обойти проверку можно флагом `-force`, и это ровно тот случай, когда стоит остановиться и перечитать, что именно вы заливаете.';

// ─── Раздел 3. Секреты в состоянии ─────────────────────────────────────────────────────────

/** Дописано к `MAIN_TF` на стенде. */
export const SENSITIVE_HCL = `output "db_password" {
  value     = random_password.db.result
  sensitive = true
}`;

export const SENSITIVE_RUN = `$ tofu output
db_password = <sensitive>

$ tofu output -raw db_password
yZx5zg0EmvQjvOji

$ grep -c yZx5zg0EmvQjvOji terraform.tfstate
3`;

export const SENSITIVE_FACTS = [
  {
    t: 'Три копии пароля',
    d: 'В состоянии пароль лежит трижды: в `result` у `random_password.db`, в `content` у `local_file.config`, куда его подставили, и в `outputs.db_password`. Все три — открытым текстом.',
    tone: 'err' as const,
  },
  {
    t: '`sensitive` — про экран',
    d: 'Метка прячет значение из вывода `plan`, `apply` и `output`: в плане содержимое `config` печатается как `(sensitive value)`. Но `tofu output -raw` и `-json` отдают его как есть, а в файле метка — только строчка в `sensitive_attributes`.',
    tone: 'warn' as const,
  },
  {
    t: 'План тоже хранит',
    d: 'Файл `tfplan` из `plan -out` содержит те же значения, что и состояние. Конвейер, который сохраняет план артефактом между джобами, сохраняет и пароль.',
    tone: 'warn' as const,
  },
];

export const SECRETS_LINK =
  'Почему переменная окружения и бандл тоже текут, разобрано в [«Секретах и конфигурации»](/delivery/secrets-config/#s5). Здесь — три способа не держать открытый пароль в состоянии.';

export const ENCRYPTION_HCL = `terraform {
  encryption {
    key_provider "pbkdf2" "pass" {
      passphrase = "correct-horse-battery-staple"
    }
    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.pass
    }
    state {
      method = method.aes_gcm.main
    }
  }
}

resource "random_password" "db" {
  length  = 16
  special = false
}
`;

/** Верх зашифрованного `terraform.tfstate`: поля как в файле, `encrypted_data` укорочено. */
export const ENCRYPTED_STATE = `{
  "serial": 1,
  "lineage": "d8967a05-7dac-0007-813d-ef788b0408af",
  "meta": {
    "key_provider.pbkdf2.pass": "eyJzYWx0IjoiMXNDTHhaYUEvcEUx…"
  },
  "encrypted_data": "wDo79cou02ZUcYCj7ZX+wjgggSX56SbxWjYJ1U+s…",
  "encryption_version": "v0"
}

$ grep -c <пароль> terraform.tfstate
0

$ tofu plan          # фраза в main.tf поменялась
Error: Error acquiring the state lock
Error message: failed to write backup file: decryption failed for all
provided methods`;

export const ENCRYPTION_NOTE =
  'В `meta` лежат параметры ключа — соль и число итераций (600 000, SHA-512), — но не сам ключ: его выводят из фразы при каждом запуске. `serial` и `lineage` остаются открытыми, чтобы работали проверки выше. Фраза в `.tf` здесь только для опыта; в жизни её дают через переменную окружения `TF_ENCRYPTION` или берут ключ из KMS. Это возможность OpenTofu (с версии 1.7, по документации); у Terraform шифрования на стороне клиента нет, он полагается на шифрование хранилища — например, бакета S3.';

export const EPHEMERAL_HCL = `ephemeral "random_password" "tmp" {
  length  = 16
  special = false
}

resource "local_file" "leak" {
  filename = "out/secret.txt"
  content  = ephemeral.random_password.tmp.result
}`;

export const EPHEMERAL_ERROR = `Error: Ephemeral value used in non-ephemeral context

  with local_file.leak,
  on main.tf line 8, in resource "local_file" "leak":
   8:   content  = ephemeral.random_password.tmp.result

Attribute ".content" is referencing an ephemeral value but ephemeral values
can be referenced only by other ephemeral attributes or by write-only ones.`;

export const EPHEMERAL_NOTE =
  'Эфемерное значение живёт один запуск и не попадает ни в план, ни в состояние: на стенде от него в `terraform.tfstate` осталось только имя в `dependencies`. Поэтому его нельзя положить в обычное поле — поле сохраняется. Пустить его можно в настройки провайдера, в переменные окружения провижионера и в поля «только для записи» (write-only), которые провайдер отправляет в API и не возвращает. В Terraform такие ресурсы есть с 1.10.';

export const SECRET_WAYS = [
  { k: 'шифровать состояние', how: 'OpenTofu: блок `encryption`. Terraform: шифрование хранилища и доступ к нему.', left: 'Пароль в файле есть, но прочесть его без ключа нельзя.' },
  { k: 'не хранить вовсе', how: '`ephemeral`-ресурс и write-only поле.', left: 'Пароль проходит через Terraform и исчезает. Провайдер должен уметь write-only.' },
  { k: 'не трогать секрет Terraform', how: 'Terraform создаёт пустое хранилище секретов, значение кладёт другой процесс, а приложение читает его при запуске.', left: 'В состоянии только имя секрета.' },
];

// ─── Раздел 4. Общее состояние и блокировка ────────────────────────────────────────────────

export const PLAIN_LOCK =
  'Одна инвентарная книга на две бригады. Пока первая вписывает новый стол, вторая книгу не берёт: на обложке табличка «занято, бригада 1, с 10:44». Без таблички вторая бригада тоже впишет свой стол — и одна из записей пропадёт.';

export const BACKEND_HCL = `terraform {
  backend "http" {
    address        = "http://host.docker.internal:5001/state/app"
    lock_address   = "http://host.docker.internal:5001/state/app"
    unlock_address = "http://host.docker.internal:5001/state/app"
  }
}`;

/** Журнал своего сервера состояния на Node: запросы каждой команды. */
export const HTTP_LOG = `tofu init     GET    /state/app                → 204   # состояния ещё нет
tofu plan     LOCK   /state/app                → 200
              GET    /state/app                → 204
              UNLOCK /state/app                → 200
tofu apply    LOCK   /state/app                → 200
              GET    /state/app                → 204
              GET    /state/app                → 204
              POST   /state/app?ID=a27b5151-…  → 200   # ID — номер замка
              UNLOCK /state/app                → 200`;

export const LOCK_CONFLICT = `$ tofu plan      # пока другой процесс делает apply
Error: Error acquiring the state lock

Error message: HTTP remote state already locked:
ID=8be79a0b-ff45-e662-beb8-a81c623dab26
Lock Info:
  ID:        8be79a0b-ff45-e662-beb8-a81c623dab26
  Operation: OperationTypeApply
  Who:       root@6eb6b6f47962
  Version:   1.12.7
  Created:   2026-10-02 10:50:27.938333377 +0000 UTC`;

export const LOCK_FACTS = [
  {
    t: 'Замок берёт и `plan`',
    d: 'Даже чтение идёт под замком: `plan` взял его и отпустил. Поэтому долгий `apply` в конвейере останавливает и чужие `plan` в пулреквестах.',
  },
  {
    t: 'Состояние пишется целиком',
    d: 'Бэкенду не присылают «добавь ресурс». Ему присылают весь JSON заново (`POST` с номером замка), и сервер просто заменяет файл. Отсюда и нужда в замке: две записи подряд — это не слияние, а победа последней.',
  },
  {
    t: 'Застрявший замок',
    d: 'Если процесс убили посреди `apply`, замок остаётся. Снимают его `tofu force-unlock <ID>`, зная, что никто больше не работает. `-lock-timeout=5m` вместо мгновенной ошибки ждёт, пока замок освободится.',
    tone: 'warn' as const,
  },
];

export const BACKEND_ROWS = [
  { k: '`local`', where: '`terraform.tfstate` рядом с конфигурацией', lock: 'Блокировка файла средствами ОС' },
  { k: '`s3`', where: 'Объект в бакете S3', lock: 'Файл-замок `.tflock` рядом (`use_lockfile = true`) или запись в DynamoDB — второй способ объявлен устаревшим' },
  { k: '`gcs`', where: 'Объект в Google Cloud Storage', lock: 'Файл-замок рядом с состоянием' },
  { k: '`azurerm`', where: 'Blob в Azure Storage', lock: 'Аренда (lease) на blob' },
  { k: '`pg`', where: 'Строка в таблице PostgreSQL', lock: 'Рекомендательная блокировка (advisory lock)' },
  { k: '`http`', where: 'Любой сервер с GET/POST', lock: 'Запросы `LOCK` и `UNLOCK`, занято — ответ `423` или `409`' },
];

export const BACKEND_NOTE =
  'Строки, кроме `local` и `http`, — по документации: на стенде облака нет. Принцип у всех один — общий файл и замок рядом. Сколько состояний заводить — тоже решение: одно на всё означает, что `plan` перечитывает всю инфраструктуру и держит замок для всех, поэтому обычно делят по окружениям и по слоям (сеть отдельно, приложения отдельно). Чтобы два конвейера не стояли в очереди за замком, их и самих не пускают параллельно — как `concurrency` в [GitHub Actions](/delivery/github-actions/#s7).';

// ─── Раздел 5. Граф зависимостей ───────────────────────────────────────────────────────────

export const PLAIN_GRAPH =
  'Как одеваться: носки раньше ботинок, рубашка раньше пиджака, а носки и рубашку можно надевать в любом порядке — хоть одновременно. Раздеваются в обратном порядке: ботинки, потом носки.';

/** `tofu graph` сквозного примера; строки провайдеров и их рёбра убраны. */
export const GRAPH_DOT = `digraph {
  "[root] local_file.config (expand)" -> "[root] random_password.db (expand)"
  "[root] local_file.config (expand)" -> "[root] random_pet.app (expand)"
  "[root] local_file.config (expand)" -> "[root] terraform_data.release (expand)"
  "[root] local_file.env (expand)" -> "[root] local.envs (expand)"
}`;

export const GRAPH_NOTE =
  'Стрелка идёт от зависимого к тому, от кого он зависит: `config` → `random_pet`. Никто не писал «сначала питомец» — ребро выведено из ссылки `${random_pet.app.id}` в содержимом файла. У `local_file.env` ссылок на ресурсы нет, только на `local.envs`, поэтому остальные четыре ресурса создаются одновременно: `apply` выполняет до 10 операций параллельно (`-parallelism`, по умолчанию 10).';

export const DEPENDS_HCL = `resource "local_file" "env" {
  count    = length(local.envs)
  filename = "out/\${local.envs[count.index]}.txt"
  content  = "env=\${local.envs[count.index]}\\n"

  depends_on = [terraform_data.release]
}`;

export const DEPENDS_NOTE =
  '`depends_on` добавляет ребро, которого нет в ссылках. Нужен он, когда связь есть, но в значениях её не видно: например, сервер должен стартовать после того, как выдали права, а сами права в его полях не упоминаются. На стенде с ним в графе apply появились рёбра `local_file.env[1] → terraform_data.release`: замена файла ждёт правки релиза. Злоупотреблять им не стоит — каждое лишнее ребро съедает параллельность.';

/**
 * Рёбра графа apply сценария `count.input.drop.clean` из `stand.ts`: правка `release`
 * и удаление `stage` из середины `count`. Тест сверяет с `TOFU_PLANS`.
 */
export const APPLY_EDGES = [
  { from: 'local_file.config', to: 'local_file.config (destroy)', d: 'Новый файл — после удаления старого: обычная замена.' },
  { from: 'local_file.config', to: 'terraform_data.release', d: 'Новый файл — после правки релиза: в нём `output` релиза.' },
  { from: 'local_file.env[1]', to: 'local_file.env[1] (destroy)', d: 'То же для заменяемого экземпляра `count`.' },
  { from: 'terraform_data.release', to: 'local_file.config (destroy)', d: 'Правка релиза ждёт, пока удалят файл, который на него ссылается: удаления идут от зависимых к зависимостям.' },
];

export const APPLY_GRAPH_NOTE =
  'Граф `apply` не равен графу конфигурации. В нём у каждого экземпляра свои узлы, а у замены их два: создание и удаление. Рёбра удалений направлены обратно рёбрам создания: тот, кто зависит, удаляется первым. Граф снят командой `tofu graph -plan=tfplan` для сценария «правка релиза и `stage` убран из `count`» и сведён к шагам.';

// ─── Раздел 6. Как читать план ─────────────────────────────────────────────────────────────

export const PLAIN_REPLACE =
  'Стены в доме перекрашивают, не выселяя жильцов, — это правка на месте. Фундамент так не поменять: дом сносят и строят новый. Поле, требующее замены, — фундамент объекта.';

export const SYMBOL_ROWS = [
  { s: '`+`', k: 'create', d: 'Объекта нет — создать.', tone: 'ok' as const },
  { s: '`~`', k: 'update in-place', d: 'Поменять поле у живого объекта. Объект и его номер остаются.', tone: 'warn' as const },
  { s: '`-/+`', k: 'destroy and then create', d: 'Поле требует замены: удалить старый, потом создать новый. Между ними объекта нет.', tone: 'err' as const },
  { s: '`+/-`', k: 'create and then destroy', d: 'Та же замена, но сначала новый, потом удаление старого — при `create_before_destroy`.', tone: 'err' as const },
  { s: '`-`', k: 'destroy', d: 'Объекта нет в конфигурации — удалить.', tone: 'err' as const },
];

/** `tofu show` сценария `count.input.all.clean`: `input = "v2"`. Хеши содержимого убраны. */
export const PLAN_INPUT_TEXT = `  # local_file.config must be replaced
-/+ resource "local_file" "config" {
      ~ content              = (sensitive value) # forces replacement
      ~ id                   = "1c6cfc863f71720dbc2a1377dace06154dd5d9a9" -> (known after apply)
        # (3 unchanged attributes hidden)
    }

  # terraform_data.release will be updated in-place
  ~ resource "terraform_data" "release" {
        id     = "619c25a9-151b-c0aa-1f11-09623ecf9b01"
      ~ input  = "v1" -> "v2"
      ~ output = "v1" -> (known after apply)
    }

Plan: 1 to add, 1 to change, 1 to destroy.`;

export const UNKNOWN_STEPS = [
  { k: '1. Правка на месте', d: '`input` у `terraform_data` меняется без замены: `~`. Но `output` — вычисляемое поле, и до `apply` оно неизвестно: `(known after apply)`.' },
  { k: '2. Неизвестное заразно', d: 'Содержимое `config` собрано из `output`. Часть строки неизвестна — значит, неизвестна вся строка.' },
  { k: '3. Замена «на всякий случай»', d: '`content` у `local_file` требует замены. Новое значение неизвестно, а значит, может отличаться, — и Terraform планирует `-/+`, хотя после `apply` текст будет ровно `release=v2`.' },
];

export const CONTENT_SENSITIVE_NOTE =
  'Содержимое `config` напечатано как `(sensitive value)`: в него подставлен пароль, и метка `sensitive` переходит на всё, что из него собрано.';

export const CBD_HCL = `resource "local_file" "config" {
  filename = "out/app.conf"
  content  = "app=\${random_pet.app.id}\\nrelease=\${terraform_data.release.output}\\ndb_password=\${random_password.db.result}\\n"

  lifecycle {
    create_before_destroy = true
  }
}`;

/** `tofu show` сценария `extra.cbd`: `create_before_destroy` у `config` и `length = 3` у питомца. */
export const CBD_TEXT = `  # local_file.config must be replaced
+/- resource "local_file" "config" {
      ~ content              = (sensitive value) # forces replacement
        # (3 unchanged attributes hidden)
    }

  # random_pet.app must be replaced
+/- resource "random_pet" "app" {
      ~ id        = "cool-corgi" -> (known after apply)
      ~ length    = 2 -> 3 # forces replacement
        # (1 unchanged attribute hidden)
    }

Plan: 2 to add, 0 to change, 2 to destroy.`;

export const CBD_NOTE =
  '`create_before_destroy` объявлен только у `config`, а `+/-` стоит и у `random_pet`. Это не ошибка: если новый `config` создаётся раньше удаления старого, новому нужен новый питомец, пока старый ещё жив, — значит, и питомец обязан создаваться до удаления. Флаг протекает на всех, от кого ресурс зависит. Цена — два объекта одновременно: в облаке это конфликт имён, если имя задано жёстко.';

export const REPLACE_FLAG =
  'Заменить объект без правки конфигурации — `tofu plan -replace=local_file.config`. План скажет «will be replaced, as requested», а в JSON причина будет `replace_by_request`.';

// ─── Раздел 7. Дрейф, refresh и импорт ─────────────────────────────────────────────────────

export const PLAIN_DRIFT =
  'Кто-то ночью переставил стол и ничего не записал в книгу. Утром грузчик по описи сначала обходит комнату и сверяет книгу с тем, что видит, — и только потом решает, что делать.';

export const DRIFT_RUN = `$ echo 'env=dev, debug=true' > out/dev.txt     # правка мимо Terraform

$ tofu plan -refresh-only
Note: Objects have changed outside of OpenTofu

  # local_file.env[0] has been deleted
  - resource "local_file" "env" {
      - filename             = "out/dev.txt" -> null
    }

$ tofu plan
  # local_file.env[0] will be created
Plan: 1 to add, 0 to change, 0 to destroy.`;

export const DRIFT_FACTS = [
  {
    t: 'Провайдер решает, как выглядит дрейф',
    d: 'Файл на месте, а план говорит «has been deleted». Так устроено чтение у `local_file`: содержимое не совпало с записанным хешем — значит, «того» файла больше нет. Облачный провайдер в похожей ситуации обычно покажет `~` и поле, которое поменяли.',
    tone: 'warn' as const,
  },
  {
    t: '`-refresh-only` — принять мир',
    d: 'Перечитывает объекты и предлагает только обновить состояние, не трогая мир. `apply -refresh-only` записывает дрейф в состояние как новую норму; обычный `apply` вернёт мир к конфигурации.',
  },
  {
    t: 'Между запусками дрейф никто не видит',
    d: 'Terraform не работает постоянно: он смотрит на мир только во время `plan` и `apply`. Контроллер GitOps сверяет в цикле — это разобрано в [«Helm, Kustomize и GitOps»](/delivery/helm-gitops/#s8). У Terraform для того же ставят `plan` по расписанию и смотрят на код выхода с `-detailed-exitcode`.',
  },
];

export const IMPORT_HCL = `import {
  to = random_password.legacy
  id = "OldPassw0rdFromWiki"
}`;

export const IMPORT_RUN = `$ tofu plan -generate-config-out=generated.tf
  # random_password.legacy will be imported
  # (config will be generated)
  # (imported from "OldPassw0rdFromWiki")
Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.

$ cat generated.tf
# __generated__ by OpenTofu from "OldPassw0rdFromWiki"
resource "random_password" "legacy" {
  length           = 19
  special          = true
  ...
}`;

export const IMPORT_NOTE =
  'Импорт берёт существующий объект под управление: дописывает его в состояние под указанным адресом и ничего не создаёт. `id` — то, по чему провайдер находит объект; у сервера это его номер, у `random_password` — само значение. Сгенерированную конфигурацию надо перечитать: `special = true` провайдер вывел по умолчанию, хотя в пароле нет спецсимволов. Импорт поддерживает не каждый ресурс: у `local_file` на стенде — «Resource Import Not Implemented».';

export const TARGET_RUN = `$ tofu plan -target=local_file.config     # в конфигурации ещё и stage убран из count
  # local_file.config must be replaced
  # terraform_data.release will be updated in-place
Plan: 1 to add, 1 to change, 1 to destroy.

Warning: Resource targeting is in effect

You are creating a plan with either the -target option or the -exclude
option, which means that the result of this plan may not represent all of the
changes requested by the current configuration.`;

export const TARGET_NOTE =
  '`-target` строит план для одного адреса и всего, от чего он зависит: `release` попал в план вслед за `config`, а удаление `stage` — нет, хотя полный план содержит и его (2 to add, 1 to change, 3 to destroy). После такого `apply` конфигурация и мир расходятся до следующего полного запуска. OpenTofu умеет и наоборот — `-exclude`, «всё, кроме».';

// ─── Раздел 8. count против for_each ───────────────────────────────────────────────────────

export const PLAIN_COUNT =
  'Нумерованные места в театре против мест по фамилиям. Ушёл зритель со второго места — при нумерации все, кто сидел правее, пересаживаются на одно кресло влево. Если на креслах таблички с фамилиями, освобождается одно кресло, и больше никто не встаёт.';

/** `tofu show` сценария `count.none.drop.clean`: `envs = ["dev", "prod"]`. Хеши убраны. */
export const COUNT_DROP_TEXT = `  # local_file.env[1] must be replaced
-/+ resource "local_file" "env" {
      ~ content              = <<-EOT # forces replacement
          - env=stage
          + env=prod
        EOT
      ~ filename             = "out/stage.txt" -> "out/prod.txt" # forces replacement
      ~ id                   = "02988a0f90f5f8b05bab3c41ff9c7c169052cb25" -> (known after apply)
    }

  # local_file.env[2] will be destroyed
  # (because index [2] is out of range for count)
  - resource "local_file" "env" {
      - filename             = "out/prod.txt" -> null
    }

Plan: 1 to add, 0 to change, 2 to destroy.`;

export const COUNT_DROP_NOTE =
  'Убрали одно окружение из середины, а план трогает два объекта. Номер — часть адреса: `prod` был `[2]`, стал `[1]`. Экземпляр `[1]` (бывший `stage`) получает чужие поля и заменяется, `[2]` выходит за длину списка и удаляется. На стенде после `apply` файл `prod.txt` на месте, но он удалён и создан заново. В облаке на месте файла был бы сервер `prod` — с простоем и новым адресом.';

export const FOREACH_HCL = `resource "local_file" "env" {
  for_each = toset(local.envs)
  filename = "out/\${each.key}.txt"
  content  = "env=\${each.key}\\n"
}`;

export const FOREACH_DROP_TEXT = `  # local_file.env["stage"] will be destroyed
  # (because key ["stage"] is not in for_each map)

Plan: 0 to add, 0 to change, 1 to destroy.`;

export const MIGRATE_TEXT = `  # local_file.env[0] will be destroyed
  # (because resource does not use count)
  # local_file.env[1] will be destroyed
  # (because resource does not use count)
  # local_file.env[2] will be destroyed
  # (because resource does not use count)
  # local_file.env["dev"] will be created
  # local_file.env["prod"] will be created
  # local_file.env["stage"] will be created

Plan: 3 to add, 0 to change, 3 to destroy.`;

export const MOVED_HCL = `moved {
  from = local_file.env[0]
  to   = local_file.env["dev"]
}

moved {
  from = local_file.env[1]
  to   = local_file.env["stage"]
}

moved {
  from = local_file.env[2]
  to   = local_file.env["prod"]
}`;

export const MOVED_TEXT = `  # local_file.env[0] has moved to local_file.env["dev"]
  # local_file.env[1] has moved to local_file.env["stage"]
  # local_file.env[2] has moved to local_file.env["prod"]

Plan: 0 to add, 0 to change, 0 to destroy.`;

export const MOVED_NOTE =
  '`moved` переименовывает запись в состоянии и не трогает объект. Обратите внимание на итог: «0 to add, 0 to change, 0 to destroy», но не «No changes» — перенос записи тоже изменение, и его нужно применить. Блоки `moved` оставляют в коде, пока все копии состояния (у коллег, в других окружениях) не прошли через `apply`. До них то же делали командой `tofu state mv` — руками и без ревью.';

export const COUNT_ROWS = [
  { k: 'ключ экземпляра', count: 'номер `[0]`, `[1]`…', each: 'строка из набора `["dev"]`' },
  { k: 'убрать из середины', count: 'замена всех правее и удаление последнего', each: 'удаление ровно одного' },
  { k: 'когда годится', count: 'одинаковые объекты, где важно только число: «три реплики»', each: 'объекты со своими именами и настройками' },
  { k: 'ограничение', count: '—', each: 'ключи должны быть известны при `plan`: нельзя `for_each` по `id`, которого ещё нет' },
];

// ─── Раздел 9. Планировщик своими руками ───────────────────────────────────────────────────

/**
 * Что из полей провайдера требует замены, а что вычисляется. `computed` тест сверяет со схемой
 * `tofu providers schema -json` (поля `computed` без `optional`); `forceNew` в схеме не
 * публикуется — его закрывают сценарии, где меняются `length`, `content`, `filename`, `input`.
 */
export const SCHEMA: Schema = {
  random_pet: { forceNew: ['length', 'prefix', 'separator', 'keepers'], computed: ['id'] },
  random_password: {
    forceNew: ['length', 'special', 'upper', 'lower', 'numeric', 'min_lower', 'min_upper', 'min_numeric', 'min_special', 'override_special', 'keepers'],
    computed: ['bcrypt_hash', 'id', 'result'],
  },
  terraform_data: { forceNew: ['triggers_replace'], computed: ['id', 'output'], recomputed: ['output'] },
  local_file: {
    forceNew: ['content', 'filename', 'file_permission', 'directory_permission', 'content_base64', 'sensitive_content', 'source'],
    computed: ['content_base64sha256', 'content_base64sha512', 'content_md5', 'content_sha1', 'content_sha256', 'content_sha512', 'id'],
  },
};

export const PLANNER_INTRO =
  'Мини-планировщик примерно на сто тридцать строк делает то же, что `tofu plan`, в семь шагов. На вход — желаемая конфигурация, состояние после прошлого `apply`, схема полей (что требует замены, что вычисляется) и «настоящий мир» для refresh. На выход — действие для каждого экземпляра и порядок шагов.';

export const PLAN_CODE = `const UNKNOWN = '(known after apply)';

// Ссылки вида \${random_pet.app.id}: ресурс — первые две части имени.
const REF = /\\$\\{([a-z_]+\\.[a-z_]+)\\.([a-z_]+)\\}/g;

function dependsOf(res) {
  const out = new Set(res.dependsOn ?? []);
  for (const value of Object.values(res.attrs)) {
    if (typeof value !== 'string') continue;
    for (const m of value.matchAll(REF)) out.add(m[1]);
  }
  return [...out];
}

// Экземпляры ресурса: count даёт номера, for_each — ключи.
function instancesOf(res) {
  const base = res.type + '.' + res.name;
  if (res.count) return res.count.map((item, i) => ({ addr: base + '[' + i + ']', item }));
  if (res.forEach) return res.forEach.map((item) => ({ addr: base + '["' + item + '"]', item }));
  return [{ addr: base, item: null }];
}

// Топологическая сортировка (Кан): сначала те, от кого зависят.
// При равенстве — порядок объявления, чтобы план был детерминированным.
function topoSort(keys, deps) {
  const left = new Map(keys.map((k) => [k, deps.get(k).filter((d) => keys.includes(d)).length]));
  const order = [];
  while (order.length < keys.length) {
    const next = keys.find((k) => left.get(k) === 0 && !order.includes(k));
    if (!next) throw new Error('цикл в графе: ' + keys.filter((k) => !order.includes(k)).join(', '));
    order.push(next);
    for (const k of keys) if (deps.get(k).includes(next)) left.set(k, left.get(k) - 1);
  }
  return order;
}

function plan(config, state, schema, world = {}) {
  // 1. moved: объект в состоянии меняет адрес, сам объект не трогают.
  const prior = new Map(state.map((r) => [r.addr, { ...r, attrs: { ...r.attrs } }]));
  const movedFrom = new Map();
  const real = new Map(Object.entries(world));
  for (const { from, to } of config.moved ?? []) {
    if (!prior.has(from) || prior.has(to)) continue;
    prior.set(to, { ...prior.get(from), addr: to });
    prior.delete(from);
    movedFrom.set(to, from);
    if (real.has(from)) { real.set(to, real.get(from)); real.delete(from); }
  }

  // 2. refresh: читаем настоящие объекты. null — объекта больше нет.
  const drift = [];
  for (const [addr, now] of real) {
    if (!prior.has(addr)) continue;
    if (now === null) { prior.delete(addr); drift.push({ addr, kind: 'deleted' }); }
    else { Object.assign(prior.get(addr).attrs, now); drift.push({ addr, kind: 'changed' }); }
  }

  // 3. Граф ресурсов: зависимости из конфигурации, а у удалённых из неё — из состояния.
  const resKey = (addr) => addr.replace(/\\[.*\\]$/, '');
  const deps = new Map(config.resources.map((r) => [r.type + '.' + r.name, dependsOf(r)]));
  for (const r of prior.values()) if (!deps.has(resKey(r.addr))) deps.set(resKey(r.addr), r.deps ?? []);
  const order = topoSort([...deps.keys()], deps);

  // 4. Сравнение «хочу» и «есть» в порядке графа: значения зависимостей уже посчитаны.
  const planned = new Map();
  const changes = [];
  const evaluate = (value, item) => {
    if (typeof value !== 'string') return value;
    let unknown = false;
    const text = value.replaceAll('\${key}', item).replace(REF, (_, res, attr) => {
      const v = planned.get(res)?.[attr];
      if (v === UNKNOWN || v === undefined) unknown = true;
      return v;
    });
    return unknown ? UNKNOWN : text;
  };
  const wanted = new Set();
  for (const key of order) {
    const res = config.resources.find((r) => r.type + '.' + r.name === key);
    if (!res) continue;
    const sch = schema[res.type];
    for (const { addr, item } of instancesOf(res)) {
      wanted.add(addr);
      const old = prior.get(addr);
      const want = {};
      for (const [k, v] of Object.entries(res.attrs)) want[k] = evaluate(v, item);
      let action = 'create';
      let replacePaths = [];
      if (old) {
        const changed = Object.keys(want).filter((k) => want[k] === UNKNOWN || want[k] !== old.attrs[k]);
        replacePaths = changed.filter((k) => sch.forceNew.includes(k));
        action = replacePaths.length ? 'replace' : changed.length ? 'update' : 'no-op';
      }
      // Вычисляемые поля нового объекта станут известны только после apply.
      const after = { ...old?.attrs, ...want };
      const unknownNow = action === 'create' || action === 'replace' ? sch.computed
        : action === 'update' ? sch.recomputed ?? [] : [];
      for (const k of unknownNow) after[k] = UNKNOWN;
      if (!res.count && !res.forEach) planned.set(key, after);
      changes.push({ addr, action, replacePaths, movedFrom: movedFrom.get(addr) ?? null, deps: dependsOf(res) });
    }
  }

  // 5. Что есть в состоянии, но не нужно конфигурации, — удалить.
  for (const [addr, old] of prior) {
    if (wanted.has(addr)) continue;
    const res = config.resources.find((r) => r.type + '.' + r.name === resKey(addr));
    const reason = !res ? 'delete_because_no_resource_config'
      : res.count && /\\[\\d+\\]$/.test(addr) ? 'delete_because_count_index'
      : res.forEach && /\\["/.test(addr) ? 'delete_because_each_key'
      : 'delete_because_wrong_repetition';
    changes.push({ addr, action: 'delete', reason, movedFrom: movedFrom.get(addr) ?? null, deps: old.deps ?? [] });
  }

  // 6. create_before_destroy: свой флаг или флаг того, кто от ресурса зависит.
  const ownCbd = new Set(config.resources.filter((r) => r.createBeforeDestroy).map((r) => r.type + '.' + r.name));
  const cbd = (key) => ownCbd.has(key) || [...deps].some(([k, d]) => d.includes(key) && cbd(k));
  for (const c of changes) if (c.action === 'replace') c.cbd = cbd(resKey(c.addr));

  // 7. Порядок: удаления — от зависимых к зависимостям, создание — наоборот,
  //    старые копии после create_before_destroy — в самом конце.
  const steps = [];
  const at = (key) => changes.filter((c) => resKey(c.addr) === key);
  for (const key of [...order].reverse())
    for (const c of at(key)) if (c.action === 'delete' || (c.action === 'replace' && !c.cbd)) steps.push({ addr: c.addr, step: 'destroy' });
  for (const key of order)
    for (const c of at(key)) if (c.action === 'create' || c.action === 'replace') steps.push({ addr: c.addr, step: 'create' });
    else if (c.action === 'update') steps.push({ addr: c.addr, step: 'update' });
  for (const key of [...order].reverse())
    for (const c of at(key)) if (c.action === 'replace' && c.cbd) steps.push({ addr: c.addr, step: 'destroy' });

  return { changes, drift, order, steps };
}`;

export const PLANNER_STEPS = [
  { k: '1. `moved`', d: 'Переименовать записи состояния до сравнения. Иначе `env[0]` и `env["dev"]` — два разных адреса.' },
  { k: '2. refresh', d: 'Перечитать мир. Объекта нет — запись выбрасывается, и ниже он окажется «не создан».' },
  { k: '3. граф', d: 'Рёбра из ссылок `${…}` и `depends_on`; у ресурсов, которых больше нет в конфигурации, — из `deps` в состоянии.' },
  { k: '4. сравнение', d: 'Идём по графу, чтобы значения зависимостей уже были посчитаны. Изменилось поле, требующее замены, — замена, иначе правка на месте, иначе ничего.' },
  { k: '5. удаления', d: 'Всё, что есть в состоянии, но не нужно конфигурации. Причина — как у OpenTofu: номер вне `count`, ключа нет в `for_each`, ресурс без `count`.' },
  { k: '6. `create_before_destroy`', d: 'Свой флаг или флаг того, кто от ресурса зависит, — так он протекает на питомца.' },
  { k: '7. порядок', d: 'Удаления — от зависимых к зависимостям, создание и правки — наоборот, старые копии после `create_before_destroy` — в самом конце.' },
];

export const PLANNER_LIMITS =
  'Чего здесь нет. Решение «замена или правка» настоящий Terraform не принимает сам — он спрашивает провайдера (`PlanResourceChange`), а тот уже знает про вложенные блоки, значения по умолчанию и поля, которые сервер нормализует. Неизвестные значения бывают частичными: известен тип и длина списка, но не элементы. Ещё нет источников данных (`data`), модулей и параллельного обхода: `apply` идёт по графу в десять потоков, а не по списку. Тест сверяет учебную функцию с `tofu plan` на 51 сценарии: действия по каждому экземпляру, причины удаления, переносы, дрейф и то, что порядок шагов не нарушает ни одного ребра настоящего графа `apply`.';

export const DEMO_NOTES = {
  mode: {
    count: 'Состояние снято `apply` с `count`, конфигурация тоже с `count`: адреса `[0]`, `[1]`, `[2]`.',
    for_each: 'И состояние, и конфигурация с `for_each`: адреса `["dev"]`, `["stage"]`, `["prod"]`.',
    migrate: 'Состояние снято с `count`, а в конфигурации уже `for_each` — без подсказки, что `[0]` и `["dev"]` один и тот же файл.',
    moved: 'То же, но с тремя блоками `moved`: записи состояния переименовываются до сравнения.',
  },
  edit: {
    none: '',
    input: '`terraform_data.release` получает `input = "v2"` — правка на месте, но её `output` до `apply` неизвестен.',
    force: '`random_pet.app` получает `length = 3` — поле требует замены, а за питомцем тянется `config`.',
  },
  drop: '`stage` убран из середины списка `local.envs`.',
  drift: 'После `apply` в `dev.txt` дописали строку руками; refresh видит это как удаление файла.',
};

export const DEMO_CAPTION =
  'План считает `plan` из `PLAN_CODE`, текст `main.tf` печатается из той же конфигурации, которую тест отдаёт настоящему `tofu plan`. Сравните удаление `stage` при `count` и при `for_each`, переход на `for_each` без `moved` и с ним, а потом включите дрейф: правка руками превращается в `+`, а при переходе без `moved` — в одно удаление меньше.';

// ─── Раздел 10. Модули и соседи ────────────────────────────────────────────────────────────

export const MODULE_SITE_HCL = `# modules/site/main.tf
variable "name" {
  type = string
}

variable "envs" {
  type = set(string)
}

resource "local_file" "env" {
  for_each = var.envs
  filename = "out/\${var.name}/\${each.key}.txt"
  content  = "site=\${var.name}\\nenv=\${each.key}\\n"
}

output "files" {
  value = [for f in local_file.env : f.filename]
}`;

export const MODULE_ROOT_HCL = `# main.tf
module "shop" {
  source = "./modules/site"
  name   = "shop"
  envs   = ["dev", "prod"]
}

module "blog" {
  source = "./modules/site"
  name   = "blog"
  envs   = ["prod"]
}`;

export const MODULE_RUN = `$ tofu state list
module.blog.local_file.env["prod"]
module.shop.local_file.env["dev"]
module.shop.local_file.env["prod"]`;

export const MODULE_NOTE =
  'Модуль — каталог с `.tf`-файлами, у которого есть входы (`variable`) и выходы (`output`). Вызвали его дважды — получили два набора ресурсов с приставкой `module.<имя>.` в адресе. Своего состояния у модуля нет: всё ложится в одно состояние корня. Отсюда следствие для рефакторинга: перенос ресурса в модуль меняет адрес, и без `moved` план предложит удалить и создать заново. Модули из реестра подключают с версией (`version = "~> 5.0"`), как пакеты.';

export const TOFU_ROWS = [
  { k: 'лицензия', tf: 'BSL 1.1 с августа 2023', tofu: 'MPL 2.0, фонд Linux Foundation' },
  { k: 'шифрование состояния', tf: 'нет, только хранилищем', tofu: 'блок `encryption` (на стенде работает)' },
  { k: '«всё, кроме»', tf: 'нет', tofu: '`-exclude` (на стенде есть в `plan -h`)' },
  { k: 'эфемерные значения', tf: 'с 1.10', tofu: 'есть (на стенде 1.12.7 работает)' },
  { k: 'реестр', tf: '`registry.terraform.io`', tofu: '`registry.opentofu.org`, провайдеры те же' },
];

export const NEIGHBOURS = [
  {
    t: 'Pulumi',
    d: 'Тот же план-и-применение, но конфигурация — программа на TypeScript, Python или Go. Циклы и функции языка вместо `count` и `for_each`. Состояние своё: в облаке Pulumi или в бакете. `pulumi preview` — это `plan`.',
  },
  {
    t: 'AWS CDK',
    d: 'Программа на TypeScript синтезирует шаблон CloudFormation, а применяет его сервис AWS. Файла состояния нет: состояние хранит сам CloudFormation. Работает только с AWS.',
  },
  {
    t: 'Crossplane',
    d: 'Ресурсы облака — объекты Kubernetes, а применяет их контроллер в кластере в бесконечном цикле. Это GitOps-модель: дрейф исправляется сам, без запуска `plan`.',
  },
];

export const NEIGHBOURS_NOTE =
  'Сравнение — по документации. Общее у всех четырёх: описание желаемого, сравнение с записанным, план, применение. Различаются язык описания, место хранения состояния и то, кто и когда сверяет — человек командой или контроллер постоянно.';

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: '`sensitive` не шифрует',
    d: 'Метка прячет значение с экрана, а в `terraform.tfstate` и в файле плана оно лежит открыто. На стенде пароль нашёлся в состоянии трижды. Доступ к состоянию — это доступ ко всем его секретам.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Удаление из середины `count` пересоздаёт хвост',
    d: 'Номер — часть адреса. Убрали `stage` из `["dev", "stage", "prod"]` — `prod` заменяется на месте `[1]`, а `[2]` удаляется. Для объектов со своими именами — `for_each`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Переход на `for_each` без `moved` — всё заново',
    d: 'Адреса `[0]` и `["dev"]` для Terraform — разные объекты. Без блоков `moved` план удаляет три и создаёт три, хотя содержимое то же.',
    tone: 'err',
  },
  {
    n: '04',
    t: '«known after apply» в поле, требующем замены, — это замена',
    d: 'Правка на месте у одного ресурса превращает его вычисляемое поле в неизвестное, и зависимый ресурс с этим полем в ForceNew-атрибуте заменяется, даже если итоговое значение совпадёт.',
    tone: 'warn',
  },
  {
    n: '05',
    t: 'Замок состояния зависит от хранилища',
    d: 'Локальный замок — блокировка файла ОС. На стенде каталог хоста был смонтирован в два контейнера Docker Desktop, и второй `plan` прошёл мимо замка первого `apply`. Для команды — удалённое состояние с настоящим замком.',
    tone: 'warn',
  },
  {
    n: '06',
    t: '`-target` оставляет мир неполным',
    d: 'Применяется только выбранное и его зависимости. Остальные изменения из конфигурации ждут следующего полного `apply` — до тех пор Git и мир расходятся.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'Дрейф виден только во время `plan`',
    d: 'Terraform не следит за миром. Ручная правка живёт, пока кто-нибудь не запустит `plan`, — и тогда обычный `apply` её откатит. Вид дрейфа решает провайдер: `local_file` показывает правку как удаление.',
  },
  {
    n: '08',
    t: 'Потерянное состояние — потерянная связь',
    d: 'Без записи Terraform не знает, что объекты уже есть, и план предложит создать их заново: дубликаты или ошибки «имя занято». Удалённое состояние с версиями хранилища — страховка; `import` — способ собрать связь обратно по одному объекту.',
    tone: 'err',
  },
  {
    n: '09',
    t: '`create_before_destroy` протекает на зависимости',
    d: 'Объявили у одного ресурса — получили `+/-` и у тех, от кого он зависит. Два объекта одновременно — это конфликт, если имя задано жёстко.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'OpenTofu — State',
    href: 'https://opentofu.org/docs/language/state/',
    what: 'зачем нужно состояние, что в нём лежит; версия 1.12.7 на стенде',
  },
  {
    title: 'OpenTofu — State and plan encryption',
    href: 'https://opentofu.org/docs/language/state/encryption/',
    what: 'блок `encryption`, `pbkdf2`, `aes_gcm`, `TF_ENCRYPTION`',
  },
  {
    title: 'OpenTofu — Ephemerality',
    href: 'https://opentofu.org/docs/language/ephemerality/',
    what: '`sensitive` против шифрования против эфемерных значений',
  },
  {
    title: 'OpenTofu — State locking',
    href: 'https://opentofu.org/docs/language/state/locking/',
    what: 'какие команды берут замок, `force-unlock`',
  },
  {
    title: 'OpenTofu — http backend',
    href: 'https://opentofu.org/docs/language/settings/backends/http/',
    what: 'GET/POST/DELETE, `LOCK`/`UNLOCK`, ответы `423` и `409`',
  },
  {
    title: 'Terraform — S3 backend',
    href: 'https://developer.hashicorp.com/terraform/language/backend/s3',
    what: '`use_lockfile` и устаревшая блокировка через DynamoDB',
  },
  {
    title: 'Terraform — Resource graph',
    href: 'https://developer.hashicorp.com/terraform/internals/graph',
    what: 'как строится граф, узлы удаления, обход с параллельностью',
  },
  {
    title: 'OpenTofu — Refactoring (`moved`)',
    href: 'https://opentofu.org/docs/language/modules/develop/refactoring/',
    what: 'перенос адресов, `count` → `for_each`, перенос в модуль',
  },
  {
    title: 'OpenTofu — Import',
    href: 'https://opentofu.org/docs/language/import/',
    what: 'блок `import`, `-generate-config-out`',
  },
  {
    title: 'OpenTofu — JSON output format',
    href: 'https://opentofu.org/docs/internals/json-format/',
    what: '`resource_changes`, `action_reason`, `replace_paths`, `resource_drift` — с ними сверяется планировщик',
  },
  {
    title: 'OpenTofu — lifecycle',
    href: 'https://opentofu.org/docs/language/meta-arguments/lifecycle/',
    what: '`create_before_destroy` и остальные настройки жизненного цикла',
  },
  {
    title: 'Pulumi — State and backends',
    href: 'https://www.pulumi.com/docs/iac/concepts/state-and-backends/',
    what: 'где Pulumi хранит состояние',
  },
];

export const RELATED =
  'Смежное на сайте: [Kubernetes: развёртывание, раздел «Под и контроллеры»](/delivery/kubernetes/#s1) — желаемое состояние и цикл сверки. [Helm, Kustomize и GitOps, раздел «GitOps»](/delivery/helm-gitops/#s8) — сверка в цикле вместо запуска по команде. [Секреты и конфигурация, раздел «Секрет на сервере»](/delivery/secrets-config/#s5) — куда ещё утекают секреты. [GitHub Actions, раздел «Права и секреты»](/delivery/github-actions/#s7) — `concurrency` и окружения для выката. [Монорепозитории, раздел «Граф и порядок»](/tooling/monorepo/#s3) — топологический порядок. [Docker: образ и слои](/delivery/docker/) — откуда берётся образ, в котором запускали OpenTofu.';
