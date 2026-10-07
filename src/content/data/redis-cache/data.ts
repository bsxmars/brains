import type { Pitfall } from '@/widgets/pitfalls/model/types';
import type { HerdParams, RaceScenario, Row, Strategy } from '@/widgets/cache-race-lab/model/types';

/**
 * Данные темы «Кеш перед базой: Redis, инвалидация и толпа».
 *
 * Тема написана здесь, 2026-10-01, третьей в направлении «Данные и бэкенд».
 *
 * ── Стенд ─────────────────────────────────────────────────────────────────────────────────
 * Redis **7.4.11** в Docker (`redis:7-alpine`, образ был на машине; `INFO server` →
 * `redis_version:7.4.11`, aarch64), без файла настроек: `maxmemory 0`, `maxmemory-policy
 * noeviction`, `maxmemory-samples 5`, `save 3600 1 300 100 60 10000`, `appendonly no`. Клиент —
 * ioredis 5.11.1 из `node_modules` проекта, Node 24.11.0, октябрь 2026. Контейнер поднимался
 * на 127.0.0.1:53507 и удалён после стенда. Что снято:
 *   — `STAND_RACE`: семь сценариев гонки. Те же генераторы (`CLIENT_CODE`, `FIX_CODE`) и тот же
 *     планировщик `runSchedule`, база — заглушка `createDb`, а команды кеша уходят в настоящий Redis
 *     через `redis.call`; функции `fill_if_lease`, `set_if_newer`, `unlock` — библиотека `LUA_CODE`,
 *     загруженная `FUNCTION LOAD`. Журнал записан как есть;
 *   — `STAND_BURST`: 50 читателей разом, **настоящее** время и настоящая конкуренция — десять
 *     соединений ioredis, `Promise.all`, база — `setTimeout` на 200 мс со счётчиком вызовов. Три
 *     прогона на строку, все совпали. Сколько времени ждал каждый, не записано: это таймер;
 *   — `TTL_LOG`, `LOCK_STEAL_LOG` (пауза 300 мс при `PX 100`), `IDLE_LOG` (пауза 3,1 с — ответ 3
 *     или 4, отметка Redis точна до секунды), `MEMORY_USAGE`, `REDIS_DEFAULTS`;
 *   — `STAND_EVICT`: нагрузка `WORKLOAD_CODE` при `maxmemory` = исходная `used_memory` + 432 000
 *     байт, значения по 1000 байт; паузы между фазами — 1,1 с, чтобы секундная отметка LRU
 *     различала фазы. Восемь политик × три прогона. Первый прогон `noeviction` сразу после старта
 *     контейнера вместил 310 ключей, следующие — 297: исходная память разная. Вместимость
 *     остальных прогонов — 298–299 ключей; модель берёт `EVICT_CAPACITY = 298`. Счёт ключей
 *     сделан после `CONFIG SET maxmemory 0` — иначе ответ `KEYS *` сам вызывает вытеснение
 *     (`READ_EVICT`, разовый замер);
 *   — `RESTART_ROWS`: 1000 ключей, `docker restart`; второй контейнер с `--save ""`; `docker kill`
 *     после `FLUSHALL` и 500 записей. Записано по `DBSIZE` и `docker logs`. В тесте не
 *     повторяется — тест не перезапускает чужой контейнер.
 *
 * ── Что считает модель, а не стенд ───────────────────────────────────────────────────────
 *   — `STREAM_ROWS` и `XFETCH_MEANS`: поток из 100 чтений через момент истечения в виртуальном
 *     времени `simulate` — на настоящем Redis физический срок ключа шёл бы по настоящим часам.
 *     Тест сверяет их с формулами `plainExpected` и `xfetchExpected` (среднее по 1000 зёрен —
 *     в пределах 3 % от формулы);
 *   — вытеснение в модели меряется ключами, выборка — равномерная, у Redis — соседние ячейки
 *     хеш-таблицы (`dictGetSomeKeys`). Сверка со стендом — по статистике, а не по именам ключей.
 *
 * ── Что взято из документации ────────────────────────────────────────────────────────────
 *   — пул кандидатов на 16 мест и 24-битная отметка LRU — исходник `evict.c` и страница Key eviction;
 *   — фоновое удаление истёкших ключей выборкой — страница `EXPIRE`;
 *   — почему чтение вытесняет: в `used_memory` входит `used_memory_overhead`, а в него — память
 *     соединений (`mem_clients_normal` в `INFO memory`, документация `INFO`); из счёта для
 *     `maxmemory` вычитаются только буферы реплик и AOF (`mem_not_counted_for_evict`). Сам факт
 *     вытеснения на `GET` и `KEYS` снят, причина — по документации;
 *   — аренды Facebook — статья NSDI 2013; nginx `proxy_cache_lock` — числа со стенда темы
 *     «Nginx как обратный прокси», здесь не перепроверялись.
 *
 * ── Тест ──────────────────────────────────────────────────────────────────────────────────
 * `tests/unit/redis-cache.test.ts` всегда сверяет модель с литералами стенда и с аналитикой.
 * Блок с живым Redis пересобирает `STAND_RACE`, `STAND_BURST`, `TTL_LOG`, `LOCK_STEAL_LOG`,
 * `IDLE_LOG` и три политики вытеснения, если задан `REDIS_CACHE_CONTAINER` — имя запущенного
 * контейнера `redis:7-alpine` с опубликованным портом 6379 (`docker run -d --name redis-cache-lab
 * -p 127.0.0.1:53507:6379 redis:7-alpine`); без переменной блок пропускается.
 */

// ─── Зачин ─────────────────────────────────────────────────────────────────────────────────

export const GLOSSARY = [
  {
    k: 'Redis',
    d: 'Сервер «ключ — значение», который держит данные в памяти. Приложение ходит к нему по сети командами: `GET` читает ключ, `SET` пишет, `DEL` удаляет. Ответ — за доли миллисекунды, поэтому его ставят перед медленной базой.',
  },
  {
    k: 'попадание и промах',
    d: 'Попадание (hit) — нужный ключ нашёлся в кеше. Промах (miss) — не нашёлся: значение придётся читать из базы, и это дорого.',
  },
  {
    k: 'TTL',
    d: 'Time To Live — срок жизни ключа. Ключ с `EX 300` Redis удалит через 300 секунд сам. Команда `TTL` показывает, сколько осталось: `-1` — срока нет, `-2` — ключа нет.',
  },
  {
    k: 'инвалидация',
    d: 'Сброс копии в кеше, когда в базе поменялись данные: удалить ключ или переписать его. Иначе кеш продолжит отдавать старое до конца срока.',
  },
  {
    k: 'реплика',
    d: 'Копия базы, которая получает изменения основной с небольшим опозданием. С неё читают, чтобы разгрузить основную. Только что записанное на реплике может ещё не появиться.',
  },
  {
    k: 'толпа (stampede)',
    d: 'Много запросов разом нашли ключ пустым — например, у популярной записи вышел срок — и все пошли в базу за одним и тем же.',
  },
  {
    k: 'вытеснение (eviction)',
    d: 'Память, отведённая Redis, кончилась, и он сам удаляет ключи, чтобы записать новые. Каких именно — решает политика `maxmemory-policy`.',
  },
];

export const PLAIN_CACHE =
  'Кеш — это шпаргалка на столе у справочной. Ответы на частые вопросы лежат под рукой, за редкими приходится идти в архив. Шпаргалка быстрая, но она копия: архив поменялся — шпаргалка врёт, пока её не переписали. Вся тема — о том, когда и как её переписывать и что делать, если в архив вдруг пошли все сразу.';

export const PREREQ_NOTE =
  'Тема опирается на четыре вещи. Три разобраны на сайте, четвёртая объяснена прямо на карточке.';

export const PREREQ: { t: string; d: string; href?: string; hrefLabel?: string; tone: 'info' }[] = [
  {
    t: 'Транзакция и COMMIT',
    d: 'Изменения внутри `BEGIN … COMMIT` не видны другим соединениям, пока транзакция не зафиксирована. Читатель, пришедший раньше `COMMIT`, видит старую строку.',
    href: '/data/transactions/#s3',
    hrefLabel: '«Транзакции и уровни изоляции», раздел «Снимки и уровни»',
    tone: 'info',
  },
  {
    t: 'Срок свежести в HTTP',
    d: 'Тот же приём, что TTL: копия считается верной заданное время, потом её нужно обновить. Разница в том, что в HTTP срок пишет сервер в заголовке, а в Redis — ваш код в команде.',
    href: '/platform/network/#s2',
    hrefLabel: '«Сеть и кеширование», раздел «Кеш и валидация»',
    tone: 'info',
  },
  {
    t: 'Генератор в JavaScript',
    d: 'Функция `function*` останавливается на `yield` и продолжает, когда её позовут снова. Учебные клиенты темы отдают через `yield` каждый поход в кеш или в базу — так планировщик может переставлять их шаги.',
    href: '/js/generators/#s1',
    hrefLabel: '«Генераторы и асинхронные итераторы», раздел «Пауза генератора»',
    tone: 'info',
  },
  {
    t: 'Команды Redis',
    d: '`SET user:1 "Анна" EX 300` — записать на 300 секунд, `GET user:1` — прочитать (нет ключа — `(nil)`), `DEL user:1` — удалить (ответ — сколько ключей удалено). `SET … NX` пишет, только если ключа ещё нет: на этом держатся замки.',
    tone: 'info',
  },
];

// ─── Учебная модель (строки; их печатает тема, исполняют демо и тест) ─────────────────────

export const REDIS_CODE = `// Маленький Redis: строки со сроком, SET NX, DEL и три функции из библиотеки ниже.
// now() — часы в миллисекундах; в планировщике это виртуальное время.
function createRedis(now = () => 0) {
  const data = new Map();                       // key → { value, expireAt }
  const live = (key) => {
    const e = data.get(key);
    if (e && e.expireAt !== null && e.expireAt <= now()) data.delete(key); // ленивое истечение
    return data.get(key);
  };

  function set(key, value, ...opts) {
    let expireAt = null, nx = false, keepTtl = false;
    for (let i = 0; i < opts.length; i++) {
      const o = String(opts[i]).toUpperCase();
      if (o === 'NX') nx = true;
      else if (o === 'KEEPTTL') keepTtl = true;
      else if (o === 'EX') expireAt = now() + Number(opts[++i]) * 1000;
      else if (o === 'PX') expireAt = now() + Number(opts[++i]);
    }
    const old = live(key);
    if (nx && old) return null;                 // ключ уже есть — NX отказывает
    data.set(key, { value: String(value), expireAt: keepTtl && old ? old.expireAt : expireAt });
    return 'OK';
  }

  // То же, что функции Lua в библиотеке cachelab: каждая исполняется целиком, без вклинивания.
  const functions = {
    fill_if_lease([key, lease], [token, value, ttl]) {
      if (live(lease)?.value !== String(token)) return 0;
      set(key, value, 'EX', ttl);
      data.delete(lease);
      return 1;
    },
    set_if_newer([key], [version, value, ttl]) {
      const cur = live(key);
      if (cur && Number(cur.value.split(':')[0]) >= Number(version)) return 0;
      set(key, \`\${version}:\${value}\`, 'EX', ttl);
      return 1;
    },
    unlock([lock], [token]) {
      if (live(lock)?.value !== String(token)) return 0;
      data.delete(lock);
      return 1;
    },
  };

  function call(cmd, ...args) {
    switch (cmd) {
      case 'GET': return live(args[0])?.value ?? null;
      case 'SET': return set(...args);
      case 'DEL': return args.filter((k) => live(k) && data.delete(k)).length;
      case 'FCALL': {
        const [name, n, ...rest] = args;
        return functions[name](rest.slice(0, Number(n)), rest.slice(Number(n)));
      }
      default: throw new Error(\`ERR unknown command '\${cmd}'\`);
    }
  }

  const dump = () => Object.fromEntries([...data.keys()].filter(live).map((k) => [k, data.get(k).value]));
  return { call, dump };
}`;

export const LUA_CODE = `#!lua name=cachelab

-- Положить значение, только если аренда всё ещё наша.
-- Писатель снял аренду вместе с ключом — значит, прочитанное уже устарело.
redis.register_function('fill_if_lease', function(keys, args)
  if redis.call('GET', keys[2]) ~= args[1] then return 0 end
  redis.call('SET', keys[1], args[2], 'EX', args[3])
  redis.call('DEL', keys[2])
  return 1
end)

-- Записать, только если версия новее той, что уже лежит. Значение — «версия:данные».
redis.register_function('set_if_newer', function(keys, args)
  local cur = redis.call('GET', keys[1])
  if cur and tonumber(string.match(cur, '^(%d+):')) >= tonumber(args[1]) then return 0 end
  redis.call('SET', keys[1], args[1] .. ':' .. args[2], 'EX', args[3])
  return 1
end)

-- Снять замок, только если он наш: наш мог истечь, и теперь замок держит другой.
redis.register_function('unlock', function(keys, args)
  if redis.call('GET', keys[1]) ~= args[1] then return 0 end
  return redis.call('DEL', keys[1])
end)`;

export const DB_CODE = `// База-заглушка: основная копия, реплика с отставанием, транзакция.
// Пока нет COMMIT, изменение не видно никому, кроме самой транзакции.
function createDb(rows, { replica = false } = {}) {
  const primary = new Map(rows.map((r) => [r.id, r]));
  const copy = new Map(primary);                // что видит реплика
  const backlog = [];                           // зафиксировано, но до реплики не доехало
  let tx = null;
  return {
    read: (id) => (replica ? copy : primary).get(id) ?? null,
    begin() { tx = new Map(); return 'BEGIN'; },
    update(id, name) {
      const row = { id, v: (tx.get(id) ?? primary.get(id)).v + 1, name };
      tx.set(id, row);
      return row;
    },
    commit() {
      for (const row of tx.values()) { primary.set(row.id, row); backlog.push(row); }
      tx = null;
      return 'COMMIT';
    },
    replay() { for (const row of backlog.splice(0)) copy.set(row.id, row); return 'реплика догнала'; },
    snapshot: () => ({ primary: [...primary.values()], replica: replica ? [...copy.values()] : null, tx: tx ? [...tx.values()] : null }),
  };
}`;

export const SCHEDULE_CODE = `// Планировщик: буква в order — один шаг этого клиента, R — реплика догоняет.
// Шаг — то, что клиент отдал через yield: поход в кеш, в базу или пауза.
async function runSchedule({ cache, db, clients, order, onStep = () => {} }) {
  const log = [];
  const running = {};
  for (const [name, gen] of Object.entries(clients)) running[name] = { gen, step: gen.next() };
  for (const who of order.replace(/\\s+/g, '')) {
    if (who === 'R') { log.push(\`R: \${db.replay()}\`); onStep(log); continue; }
    const c = running[who];
    if (c.step.done) throw new Error(\`\${who} уже закончил\`);
    const [kind, ...args] = c.step.value;
    let reply = null;
    if (kind === 'cache') reply = await cache.call(...args);
    else if (kind === 'db') reply = db[args[0]](...args.slice(1));
    log.push(\`\${who}: \${stepText(kind, args)}\${kind === 'wait' ? '' : \` → \${show(reply)}\`}\`);
    onStep(log);
    c.step = c.gen.next(reply);
  }
  return log;
}

function stepText(kind, args) {
  if (kind === 'cache') return args.join(' ');
  if (kind === 'wait') return \`пауза: \${args[0]}\`;
  return \`db.\${args[0]}(\${args.slice(1).join(', ')})\`;
}

function show(reply) {
  if (reply === null) return '(nil)';
  if (typeof reply === 'number') return \`(integer) \${reply}\`;
  if (typeof reply === 'object') return \`\${reply.v}:\${reply.name}\`;
  return reply === 'OK' || reply === 'BEGIN' || reply === 'COMMIT' ? reply : \`"\${reply}"\`;
}`;

export const CLIENT_CODE = `const TTL = 300;                               // секунд
const enc = (row) => \`\${row.v}:\${row.name}\`;     // в кеше — «версия:имя»

// Читатель, cache-aside: кеш → при промахе база → положить в кеш.
function* readUser(id) {
  const key = \`user:\${id}\`;
  const hit = yield ['cache', 'GET', key];
  if (hit !== null) return hit;
  const row = yield ['db', 'read', id];
  yield ['cache', 'SET', key, enc(row), 'EX', TTL];
  return enc(row);
}

// Писатель: изменить базу, после COMMIT удалить ключ.
function* renameUser(id, name) {
  yield ['db', 'begin'];
  yield ['db', 'update', id, name];
  yield ['db', 'commit'];
  yield ['cache', 'DEL', \`user:\${id}\`];
}

// Тот же писатель с ошибкой порядка: ключ удалён до COMMIT.
function* renameUserDelFirst(id, name) {
  yield ['db', 'begin'];
  yield ['db', 'update', id, name];
  yield ['cache', 'DEL', \`user:\${id}\`];
  yield ['db', 'commit'];
}`;

export const FIX_CODE = `// 1. Аренда. Промах берёт lease:id через SET NX, писатель снимает её вместе с ключом.
// Запоздавший читатель уже не положит старое: fill_if_lease не найдёт своей аренды.
function* readUserLease(id, me) {
  const key = \`user:\${id}\`, lease = \`lease:\${id}\`;
  const hit = yield ['cache', 'GET', key];
  if (hit !== null) return hit;
  const got = yield ['cache', 'SET', lease, me, 'NX', 'PX', 5000];
  const row = yield ['db', 'read', id];
  if (got === 'OK') yield ['cache', 'FCALL', 'fill_if_lease', 2, key, lease, me, enc(row), TTL];
  return enc(row);
}

function* renameUserLease(id, name) {
  yield ['db', 'begin'];
  yield ['db', 'update', id, name];
  yield ['db', 'commit'];
  yield ['cache', 'DEL', \`user:\${id}\`, \`lease:\${id}\`];
}

// 2. Версия. Писатель после COMMIT кладёт новое значение сам, а кеш принимает
// запись, только если версия новее той, что уже лежит.
function* readUserVersioned(id) {
  const key = \`user:\${id}\`;
  const hit = yield ['cache', 'GET', key];
  if (hit !== null) return hit;
  const row = yield ['db', 'read', id];
  yield ['cache', 'FCALL', 'set_if_newer', 1, key, row.v, row.name, TTL];
  return enc(row);
}

function* renameUserVersioned(id, name) {
  yield ['db', 'begin'];
  const row = yield ['db', 'update', id, name];
  yield ['db', 'commit'];
  yield ['cache', 'FCALL', 'set_if_newer', 1, \`user:\${id}\`, row.v, row.name, TTL];
}

// 3. Двойное удаление: второй DEL — позже самого долгого чтения.
function* renameUserTwice(id, name) {
  yield* renameUser(id, name);
  yield ['wait', 'дольше самого долгого чтения'];
  yield ['cache', 'DEL', \`user:\${id}\`];
}`;

export const HERD_CODE = `const TTL_MS = 60_000, LOCK_MS = 3_000, POLL_MS = 50, SOFT_MS = 30_000;

// Без защиты: каждый промах идёт в базу сам.
function* plain(key) {
  const hit = yield ['cache', 'GET', key];
  if (hit !== null) return hit;
  const fresh = yield ['db', 'load', key];
  yield ['cache', 'SET', key, fresh, 'PX', TTL_MS];
  return fresh;
}

// Замок: в базу идёт тот, кто взял lock:key. Остальные ждут и перечитывают кеш.
function* withLock(key, me) {
  for (;;) {
    const hit = yield ['cache', 'GET', key];
    if (hit !== null) return hit;
    const got = yield ['cache', 'SET', \`lock:\${key}\`, me, 'NX', 'PX', LOCK_MS];
    if (got === 'OK') {
      // Пока брали замок, прежний владелец мог успеть положить значение и уйти.
      const again = yield ['cache', 'GET', key];
      if (again !== null) {
        yield ['cache', 'FCALL', 'unlock', 1, \`lock:\${key}\`, me];
        return again;
      }
      const fresh = yield ['db', 'load', key];
      yield ['cache', 'SET', key, fresh, 'PX', TTL_MS];
      yield ['cache', 'FCALL', 'unlock', 1, \`lock:\${key}\`, me];
      return fresh;
    }
    yield ['sleep', POLL_MS];
  }
}

// XFetch: рядом со значением — сколько длился пересчёт (delta) и когда срок (expiry).
// Каждый читатель бросает монетку: чем ближе срок, тем вероятнее пересчитать заранее.
function* xfetch(key, beta, random) {
  const raw = yield ['cache', 'GET', key];
  const now = yield ['now'];
  if (raw !== null) {
    const { value, delta, expiry } = JSON.parse(raw);
    if (now - delta * beta * Math.log(random()) < expiry) return value;
  }
  const fresh = yield ['db', 'load', key];
  const done = yield ['now'];
  const entry = { value: fresh, delta: done - now, expiry: done + TTL_MS };
  yield ['cache', 'SET', key, JSON.stringify(entry), 'PX', TTL_MS];
  return fresh;
}

// Мягкий срок: после soft отдаём старое сразу, а обновляет один — под замком.
function* refresh(key, me) {
  const raw = yield ['cache', 'GET', key];     // пока брали замок, могли уже обновить
  const before = yield ['now'];
  const cur = raw === null ? null : JSON.parse(raw);
  let value = cur?.value;
  if (!cur || before >= cur.soft) {
    value = yield ['db', 'load', key];
    const now = yield ['now'];
    yield ['cache', 'SET', key, JSON.stringify({ value, soft: now + SOFT_MS }), 'PX', TTL_MS];
  }
  yield ['cache', 'FCALL', 'unlock', 1, \`lock:\${key}\`, me];
  return value;
}

function* staleWhileRevalidate(key, me) {
  for (;;) {
    const raw = yield ['cache', 'GET', key];
    const now = yield ['now'];
    const entry = raw === null ? null : JSON.parse(raw);
    if (entry && now < entry.soft) return entry.value;          // свежее
    const got = yield ['cache', 'SET', \`lock:\${key}\`, me, 'NX', 'PX', LOCK_MS];
    if (entry) {                                                 // устаревшее есть:
      if (got === 'OK') yield ['spawn', refresh(key, me)];      // обновить в фоне
      return entry.value;                                        // и отдать старое сразу
    }
    if (got === 'OK') return yield* refresh(key, me);           // пусто, идём сами
    yield ['sleep', POLL_MS];                                    // пусто, но уже идут — ждём
  }
}`;

export const SIM_CODE = `// Виртуальное время: N клиентов «одновременно», без таймеров.
// Поход в кеш занимает 0 мс, в базу — dbMs, sleep — сколько попросили.
async function simulate({ cache, clock, clients, dbMs }) {
  const queue = [];                                // { at, seq, task, reply }
  let seq = 0, dbCalls = 0;
  const push = (at, task, reply) => queue.push({ at, seq: seq++, task, reply });
  const start = (at, gen, background = false) => {
    const task = { gen, start: at, end: null, db: false, slept: false, result: null, background };
    tasks.push(task);
    push(at, task, undefined);
  };
  const tasks = [];
  for (const { at, gen } of clients) start(at, gen);

  while (queue.length) {
    queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const { at, task, reply } = queue.shift();
    clock.now = at;
    const step = task.gen.next(reply);
    if (step.done) { task.end = at; task.result = step.value; continue; }
    const [kind, ...args] = step.value;
    if (kind === 'cache') push(at, task, await cache.call(...args));
    else if (kind === 'now') push(at, task, at);
    else if (kind === 'db') { dbCalls++; task.db = true; push(at + dbMs, task, \`v@\${at + dbMs}\`); }
    else if (kind === 'sleep') { task.slept = true; push(at + args[0], task, undefined); }
    else if (kind === 'spawn') { start(at, args[0], true); push(at, task, undefined); }
  }
  const readers = tasks.filter((t) => !t.background)
    .map((t) => ({ at: t.start, wait: t.end - t.start, db: t.db, slept: t.slept, result: t.result }));
  return { dbCalls, readers };
}`;

export const EVICT_CODE = `// Вытеснение как в Redis, упрощённо: память меряется ключами, часы идут секундами.
function createStore({ capacity, policy, samples = 5, random = Math.random }) {
  const data = new Map();   // key → { lru: секунда последнего обращения, expireAt }
  const pool = [];          // кандидаты { key, score } по возрастанию score, не больше 16
  let clock = 0, evicted = 0;

  // Чем больше score, тем охотнее ключ вытесняют.
  function score(key) {
    const e = data.get(key);
    if (policy === 'volatile-ttl') return -e.expireAt;  // раньше истечёт — раньше уйдёт
    return clock - e.lru;                                // дольше не трогали — раньше уйдёт
  }

  function pickVictim() {
    const from = policy.startsWith('volatile-')
      ? [...data.keys()].filter((k) => data.get(k).expireAt !== null)
      : [...data.keys()];
    if (from.length === 0) return null;
    if (policy.endsWith('-random')) return from[Math.floor(random() * from.length)];
    // Не список всех ключей, а samples случайных — и пул лучших кандидатов между вызовами.
    for (let i = 0; i < samples; i++) {
      const key = from[Math.floor(random() * from.length)];
      const s = score(key);
      if (pool.length === 16 && s <= pool[0].score) continue;
      pool.push({ key, score: s });
      pool.sort((a, b) => a.score - b.score);
      if (pool.length > 16) pool.shift();
    }
    while (pool.length) {
      const { key } = pool.pop();          // лучший кандидат — в конце пула
      if (data.has(key)) return key;        // ключ могли удалить, пока он ждал
    }
    return null;
  }

  function set(key, ttl = null) {
    while (!data.has(key) && data.size >= capacity) {
      const victim = policy === 'noeviction' ? null : pickVictim();
      if (victim === null) throw new Error("OOM command not allowed when used memory > 'maxmemory'.");
      data.delete(victim);
      evicted++;
    }
    data.set(key, { lru: clock, expireAt: ttl === null ? null : clock + ttl });
    return 'OK';
  }

  function get(key) {
    const e = data.get(key);
    if (!e) return null;
    e.lru = clock;                          // чтение освежает ключ
    return 'value';
  }

  return { set, get, tick: (sec) => { clock += sec; }, keys: () => [...data.keys()], evicted: () => evicted };
}`;

export const WORKLOAD_CODE = `// Нагрузка стенда: 50 «долгих» ключей без срока (сессии), 50 горячих
// и 600 холодных кешевых ключей со сроком. Горячие читают каждую секунду.
function* workload() {
  for (let i = 0; i < 50; i++) yield ['set', \`s:\${i}\`, null];
  for (let i = 0; i < 50; i++) yield ['set', \`h:\${i}\`, 3600];
  let c = 0;
  for (let i = 0; i < 100; i++) yield ['set', \`c:\${c++}\`, 3600];
  for (let phase = 1; phase <= 5; phase++) {
    yield ['tick', 1];
    for (let i = 0; i < 50; i++) yield ['get', \`h:\${i}\`];
    for (let i = 0; i < 100; i++) yield ['set', \`c:\${c++}\`, 3600];
  }
}`;

// ─── Раздел 1. Cache-aside ─────────────────────────────────────────────────────────────────

export const PATTERN_ROWS: { k: string; how: string; when: string; tone?: 'warn' | 'err' }[] = [
  {
    k: 'cache-aside',
    how: 'Приложение само читает кеш, при промахе — базу, и само кладёт результат в кеш. При записи меняет базу и удаляет ключ.',
    when: 'Почти всегда с Redis: кеш можно выключить, и всё продолжит работать, только медленнее. Кешируется лишь то, что кто-то прочитал.',
  },
  {
    k: 'read-through',
    how: 'Приложение спрашивает только кеш, а кеш при промахе сам идёт в базу. Сам Redis базу читать не умеет — эту роль играет библиотека-обёртка в приложении.',
    when: 'Когда хочется спрятать загрузку за одной функцией `get(key, loader)`. Гонки те же, что у cache-aside: они просто переехали в библиотеку.',
  },
  {
    k: 'write-through',
    how: 'Запись идёт через кеш: он пишет в базу и держит новое значение у себя.',
    when: 'Когда только что записанное почти наверняка прочитают — профиль, корзина. Цена: каждая запись дороже, и кеш заполняется тем, что никто не читает.',
    tone: 'warn',
  },
  {
    k: 'write-behind',
    how: 'Кеш принимает запись сразу и сбрасывает в базу позже, пачками.',
    when: 'Счётчики просмотров, лайки — где потерять последние секунды не страшно. На стенде `docker kill` унёс все 500 ключей, записанных после последнего снимка на диск.',
    tone: 'err',
  },
];

export const ASIDE_NOTE =
  'Писатель **удаляет** ключ, а не кладёт туда новое значение. Так надёжнее: если два писателя положат свои значения в разном порядке, в кеше останется проигравший, а удаление от порядка не зависит — следующий читатель возьмёт из базы то, что там есть. Но и удаление не спасает от всех гонок, и их видно уже в этих двадцати строках.';

export const CLIENT_SIDE_NOTE =
  'Клиентский кеш TanStack Query устроен так же: копия по ключу, а после мутации — `invalidateQueries`, то есть то же «удалить и перечитать». Разница в масштабе: там копия у одного пользователя, и гонка портит экран одному человеку. Кеш в Redis общий — гонка портит ответ всем, кто читает ключ до конца срока. Клиентская сторона — в [«Кеше данных на клиенте», раздел «Мутации»](/frameworks/data-cache/#s5).';

// ─── Раздел 2. TTL ─────────────────────────────────────────────────────────────────────────

export const TTL_NOTE =
  'Срок — это **верхняя граница** того, сколько кеш может врать. Удаление при записи делает копию свежей в обычном случае, а TTL ограничивает ущерб от необычного: потерянного `DEL`, гонки, ошибки в коде. Без срока ошибочная копия живёт вечно. Срок без удаления — каждое изменение видно с опозданием до TTL: с `EX 300` пользователь пять минут видит старое имя после переименования.';

export const TTL_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: '`SET` без `EX` стирает срок',
    d: 'Обычный `SET` поверх ключа со сроком делает его вечным: `TTL` после него — `-1`. Сохранить срок помогает `KEEPTTL`. `INCR` срок не трогает.',
    tone: 'err',
  },
  {
    t: '`EXPIRE` на пустом ключе ничего не делает',
    d: 'Ответ `0`: ключа нет — срок ставить некому. Пара `INCR` + `EXPIRE` для счётчика работает, только если между ними процесс не упал: иначе счётчик останется без срока.',
    tone: 'warn',
  },
  {
    t: 'Истёкший ключ удаляется не сразу',
    d: 'Redis удаляет просроченный ключ при обращении к нему и фоном — проверяя случайную выборку ключей со сроком. Для приложения ключ исчез ровно в срок, но память он может занимать ещё какое-то время.',
  },
  {
    t: 'Одинаковый срок — одновременное истечение',
    d: 'Ключи, прогретые разом с одним `EX`, истекут в одну секунду. Лечится разбросом срока ±10 %; расчёт — в [«CDN и серверном кеше», раздел «Кеш в приложении»](/platform/cdn-cache/#s6).',
  },
];

// ─── Раздел 3. Гонка инвалидации ───────────────────────────────────────────────────────────

export const PLAIN_RACE =
  'Вы переписали адрес в записной книжке и выбросили бумажку с холодильника. А сосед прочитал книжку минутой раньше и как раз сейчас клеит на холодильник новую бумажку — со старым адресом. Каждый действовал правильно; неверный результат дал порядок шагов.';

export const ROWS: Row[] = [{ id: 1, v: 1, name: 'Анна' }];

export const RACE_SCENARIOS: RaceScenario[] = [
  {
    id: 'slow-reader',
    label: 'Медленный читатель',
    group: 'race',
    replica: false,
    clients: { A: ['readUser', 1], B: ['renameUser', 1, 'Мария'], C: ['readUser', 1] },
    order: 'AA BBBB A C',
    note: 'Читатель A промахнулся и прочитал базу. Пока он нёс ответ в кеш, писатель B успел переименовать пользователя и удалить ключ — которого ещё нет.',
    verdict: '`DEL` писателя ничего не удалил (`(integer) 0`), а через шаг A положил старое. В базе «Мария», в кеше «Анна» на 300 секунд. Нужно, чтобы чтение базы было медленнее всей записи — редкость, но при тысячах запросов в секунду редкое случается каждый день.',
  },
  {
    id: 'early-del',
    label: 'Удаление до COMMIT',
    group: 'race',
    replica: false,
    clients: { A: ['readUser', 1], B: ['renameUserDelFirst', 1, 'Мария'], C: ['readUser', 1] },
    order: 'BBB AAA B C',
    note: 'Писатель удаляет ключ внутри транзакции, до `COMMIT`. Частая ошибка: «удалим заранее, чтобы точно успеть».',
    verdict: 'A пришёл между `DEL` и `COMMIT`, промахнулся и прочитал базу — а незафиксированное изменение не видно никому, кроме самой транзакции. В кеш легло «1:Анна». Этой гонке не нужен медленный читатель: окно открыто всё время, пока идёт транзакция.',
  },
  {
    id: 'replica',
    label: 'Чтение из реплики',
    group: 'race',
    replica: true,
    clients: { A: ['readUser', 1], B: ['renameUser', 1, 'Мария'], C: ['readUser', 1] },
    order: 'BBBB AAA R C',
    note: 'Всё сделано правильно: `DEL` после `COMMIT`. Но читатели ходят в реплику, а она отстаёт.',
    verdict: 'Ключ удалён после фиксации, A честно промахнулся — и прочитал из реплики строку, до которой изменение ещё не доехало. Реплика догнала через шаг, но в кеше уже «1:Анна». Порядок «сначала `COMMIT`, потом `DEL`» здесь не помогает вовсе.',
  },
  {
    id: 'lease',
    label: 'Аренда',
    group: 'fix',
    replica: false,
    clients: { A: ['readUserLease', 1, 'A'], B: ['renameUserLease', 1, 'Мария'], C: ['readUserLease', 1, 'C'] },
    order: 'AAA BBBB A CCCC',
    note: 'Тот же порядок, что у медленного читателя. Теперь промах сначала берёт аренду `lease:1` через `SET NX`, а писатель удаляет её вместе с ключом.',
    verdict: 'Запоздавший A пришёл с данными, а аренды уже нет: `fill_if_lease` вернула `0` и ничего не записала. Следующий читатель C взял новую аренду и положил «2:Мария».',
  },
  {
    id: 'lease-replica',
    label: 'Аренда и реплика',
    group: 'fix',
    replica: true,
    clients: { A: ['readUserLease', 1, 'A'], B: ['renameUserLease', 1, 'Мария'], C: ['readUserLease', 1, 'C'] },
    order: 'BBBB AAAA R C',
    note: 'Аренда против отстающей реплики.',
    verdict: 'Не помогла. A взял аренду уже **после** удаления — ей нечего было отменять, — и честно положил то, что отдала реплика. Аренда ловит «старое пришло после удаления», а реплика отдаёт старое и после удаления.',
  },
  {
    id: 'version',
    label: 'Версия',
    group: 'fix',
    replica: true,
    clients: { A: ['readUserVersioned', 1], B: ['renameUserVersioned', 1, 'Мария'], C: ['readUserVersioned', 1] },
    order: 'A BBBB AA R C',
    note: 'Писатель после `COMMIT` сам кладёт новое значение с номером версии. Кеш принимает запись, только если версия новее.',
    verdict: 'Реплика отдала A версию 1, а в кеше уже лежит версия 2 — `set_if_newer` вернула `0`. Версия защищает от любого порядка шагов, пока ключ в кеше жив. Её цена: номер версии должен быть в самой строке базы.',
  },
  {
    id: 'double-del',
    label: 'Двойное удаление',
    group: 'fix',
    replica: false,
    clients: { A: ['readUser', 1], B: ['renameUserTwice', 1, 'Мария'], C: ['readUser', 1], D: ['readUser', 1] },
    order: 'AA BBBB A C BB DDD',
    note: 'Писатель удаляет ключ дважды: сразу после `COMMIT` и ещё раз — позже самого долгого чтения.',
    verdict: 'Окно не закрылось, а сузилось: C успел прочитать старое между двумя удалениями. Зато второй `DEL` убрал копию A, и D положил свежее. Пауза подбирается на глаз; если чтение или реплика отстанут сильнее паузы — гонка вернётся.',
  },
];

export const RACE_CAPTION =
  'Каждый шаг — один поход клиента в кеш или в базу. Порядок шагов задаёт планировщик `runSchedule`, команды кеша исполняет учебный Redis `createRedis`, а точно такие же журналы дали эти генераторы на настоящем Redis 7.4.';

export const RACE_FIX_CAPTION =
  'Те же клиенты и планировщик. Функции `fill_if_lease` и `set_if_newer` на настоящем Redis — библиотека Lua из этого раздела, в учебном Redis — их перевод на JavaScript.';

export const SCHEDULE_NOTE =
  'Клиенты — генераторы: каждый `yield` отдаёт одну операцию, а планировщик решает, чей шаг следующий. Так любую гонку можно воспроизвести сколько угодно раз и в точности: порядок записан строкой, а не зависит от того, кто быстрее.';

// ─── Раздел 4. Чем лечить гонку ────────────────────────────────────────────────────────────

export const PLAIN_LEASE =
  'Как номерок в гардеробе. Промахнувшийся читатель берёт номерок «я несу свежее для user:1». Писатель, поменявший данные, номерок аннулирует. Читатель приходит с вещами, гардеробщик смотрит: номерок недействителен — вещи не принимаем.';

export const FUNCTIONS_NOTE =
  'Проверка и запись должны идти **одним шагом**: если сначала `GET lease:1`, а потом `SET user:1`, писатель вклинится между ними. Redis исполняет функцию Lua целиком, не прерываясь на чужие команды — поэтому три функции живут в библиотеке и вызываются `FCALL`. Загрузить её — `FUNCTION LOAD`, один раз на сервер.';

export const FIX_ROWS: { k: string; slow: string; early: string; replica: string; cost: string; tone?: 'ok' | 'warn' }[] = [
  { k: '`DEL` после `COMMIT`', slow: 'нет', early: 'да', replica: 'нет', cost: 'ничего — это просто правильный порядок' },
  { k: 'аренда (`SET NX`)', slow: 'да', early: 'да', replica: 'нет', cost: 'лишний ключ и функция Lua; заодно гасит толпу — в базу идёт держатель аренды' },
  { k: 'версия', slow: 'да', early: 'да', replica: 'да', cost: 'номер версии в строке базы; писатель кладёт значение сам', tone: 'ok' },
  { k: 'двойное удаление', slow: 'сужает окно', early: 'сужает окно', replica: 'если пауза больше отставания', cost: 'отложенная задача и пауза, подобранная на глаз', tone: 'warn' },
  { k: 'короткий TTL', slow: 'ограничивает', early: 'ограничивает', replica: 'ограничивает', cost: 'больше промахов; ставится всегда, как предохранитель' },
];

export const FIX_NOTE =
  'В реальных системах аренды и версии появились из одной и той же беды: Facebook описал аренды в статье о memcache в 2013 году — ими гасили и устаревшие записи, и толпу. Версии — естественный выбор, если в строке уже есть счётчик изменений (`updated_at`, номер ревизии), а основная беда — реплики.';

// ─── Раздел 5. Толпа ───────────────────────────────────────────────────────────────────────

export const PLAIN_HERD =
  'В столовой кончился суп, новую кастрюлю варить двадцать минут. Если каждый, кто подошёл к пустой раздаче, сам идёт на кухню ставить кастрюлю, через минуту на плите их двадцать. Замок — табличка «суп уже варят, подождите». Мягкий срок — «пока варят, налью вчерашнего».';

export const HERD_PARAMS: HerdParams = { n: 50, streamN: 100, dbMs: 200, expiryMs: 1000, intervalMs: 20, offsetMs: 10, beta: 1 };

export const HERD_STRATEGIES: { value: Strategy; label: string }[] = [
  { value: 'plain', label: 'без защиты' },
  { value: 'lock', label: 'замок' },
  { value: 'xfetch', label: 'XFetch' },
  { value: 'swr', label: 'мягкий срок' },
];

export const LOCK_NOTE =
  'Три детали, без которых замок ломается. Срок `PX` — чтобы упавший держатель не запер ключ навсегда; он должен быть заметно дольше похода в базу. Снимать замок — только свой: `unlock` сравнивает токен. И после того как замок взят, кеш нужно **перечитать**: прежний держатель мог положить значение и снять замок ровно между вашими `GET` и `SET NX`. Без этой проверки учебная модель нашла лишний поход в базу при мягком сроке.';

export const XFETCH_NOTE =
  'Формула и смысл β разобраны в [«CDN и серверном кеше», раздел «Устаревшее и толпа»](/platform/cdn-cache/#s3). В Redis её удобно держать так: в значении — `delta` (сколько длился пересчёт в прошлый раз) и `expiry`, а физический срок ключа совпадает с `expiry`. XFetch не замок: на промахе, когда ключа уже нет, он не помогает ничем — все 50 пойдут в базу.';

export const SWR_NOTE =
  'Мягкий срок — `stale-while-revalidate` внутри приложения. У значения два срока: мягкий (`soft`) — после него обновляем, жёсткий (`PX`) — после него ключа нет. Между ними читатель получает старое мгновенно, а обновляет один, под замком и в фоне. То же делают nginx (`proxy_cache_use_stale updating` с `proxy_cache_background_update`) и CDN.';

export const NGINX_NOTE =
  'Замок на промахе — ровно то, что делает nginx директивой `proxy_cache_lock`: на стенде темы [«Nginx как обратный прокси», раздел «Кеш и gzip»](/delivery/nginx-proxy/#s7) десять одновременных запросов к холодному ключу дали 10 походов к бэкенду без неё и 1 — с ней. Здесь та же картина на Redis: разница только в том, где живёт замок.';

// ─── Раздел 6. Вытеснение ──────────────────────────────────────────────────────────────────

export const PLAIN_EVICT =
  'Полка на 300 книг, а приносят семисотую. Библиотекарь не ищет по журналу самую давно не бравшуюся книгу — журнала нет. Он вытаскивает пять книг наугад и убирает ту, что дольше всех стояла нетронутой. Если наугад брать одну, убирается случайная книга; если пять — почти всегда старая.';

export const EVICT_CAPACITY = 298;

export const POLICY_ROWS: { k: string; from: string; how: string; when: string; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: '`noeviction`', from: '—', how: 'не вытесняет: запись, которой не хватило памяти, падает с ошибкой `OOM`', when: 'по умолчанию; для очередей и данных, которые терять нельзя', tone: 'err' },
  { k: '`allkeys-lru`', from: 'все ключи', how: 'самый давно не читанный из выборки', when: 'чистый кеш: всё в нём можно перечитать из базы', tone: 'ok' },
  { k: '`volatile-lru`', from: 'ключи со сроком', how: 'самый давно не читанный из выборки', when: 'кеш и данные в одном Redis: данные без срока не трогаются' },
  { k: '`allkeys-lfu`, `volatile-lfu`', from: 'все / со сроком', how: 'самый редко читаемый: счётчик обращений, который со временем убывает', when: 'горячее меняется медленно, а редкие ключи читают всплесками' },
  { k: '`volatile-ttl`', from: 'ключи со сроком', how: 'тот, у кого срок истечёт раньше', when: 'когда срок сам по себе означает важность', tone: 'warn' },
  { k: '`allkeys-random`, `volatile-random`', from: 'все / со сроком', how: 'случайный', when: 'доступ к ключам равномерный', tone: 'warn' },
];

export const EVICT_NOTE =
  'Redis не хранит список всех ключей по давности — это стоило бы памяти на каждый ключ и работы на каждое чтение. Вместо этого у ключа есть 24-битная отметка последнего обращения, а при нехватке памяти он берёт `maxmemory-samples` случайных ключей (по умолчанию 5), добавляет их в пул из 16 лучших кандидатов и удаляет самого давнего из пула. Пул переживает между вытеснениями, и за несколько раундов в нём копятся действительно старые ключи.';

export const EVICT_MODEL_NOTE =
  'Модель проще Redis: память меряется ключами, а не байтами, ключи выбираются равномерно (Redis берёт соседние ячейки своей хеш-таблицы), часы идут целыми секундами — как и отметка у Redis, которая точна до секунды.';

export const EVICT_CAPTION =
  'Нагрузка — `workload` выше, вытеснение — `createStore`, «случайность» — с заданным зерном. Рядом — что осталось после той же нагрузки на настоящем Redis.';

// ─── Раздел 7. Холодный кеш ────────────────────────────────────────────────────────────────

export const COLD_NOTE =
  'Пустой кеш после рестарта — та же толпа, только по всем ключам сразу: каждое первое чтение каждого ключа идёт в базу. Если трафик большой, база получает за первую минуту столько, сколько обычно за час. Что делать: не перезапускать все экземпляры Redis разом, давать снимку `RDB` пережить рестарт (как в первой строке таблицы), прогревать самые горячие ключи до того, как пустить трафик, и держать в коде защиту от толпы — она нужна именно в этот момент.';

export const COLD_FACTS: { t: string; d: string; tone?: 'warn' | 'err' }[] = [
  {
    t: 'Кеш в памяти процесса холодный после каждого деплоя',
    d: 'У `Map` или LRU в куче процесса нет диска: каждый выкат начинает с нуля, и восемь экземпляров прогреваются восемь раз. Сравнение с Redis — в [«CDN и серверном кеше», раздел «Кеш в приложении»](/platform/cdn-cache/#s6).',
    tone: 'warn',
  },
  {
    t: 'Добавили узел — часть ключей «остыла»',
    d: 'Если ключи раскладываются по нескольким Redis хешем, новый узел меняет адрес части ключей: они есть, но не там, где их ищут. Остаток от деления перекладывает почти всё, кольцо — около 1/N. Разбор — в [«Балансировке нагрузки», раздел «Хеш по ключу»](/delivery/load-balancing/#s4).',
  },
  {
    t: 'Снимок на диск — не про сохранность',
    d: 'Для кеша RDB — способ быстрее прогреться, а не гарантия. Между снимками теряется всё записанное; если Redis держит данные, которые нельзя перечитать из базы, нужен AOF и политика `noeviction`, а это уже не кеш.',
    tone: 'err',
  },
];

// ─── Литералы стенда ───────────────────────────────────────────────────────────────────────

export const STAND_VERSION = '7.4.11';

/** Журналы гонок на настоящем Redis: те же генераторы и планировщик, кеш — ioredis. */
export const STAND_RACE: Record<string, { log: string[]; cached: string | null; primary: string }> = {
  'slow-reader': {
    log: [
      'A: GET user:1 → (nil)',
      'A: db.read(1) → 1:Анна',
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: DEL user:1 → (integer) 0',
      'A: SET user:1 1:Анна EX 300 → OK',
      'C: GET user:1 → "1:Анна"',
    ],
    cached: '1:Анна',
    primary: '2:Мария',
  },
  'early-del': {
    log: [
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: DEL user:1 → (integer) 0',
      'A: GET user:1 → (nil)',
      'A: db.read(1) → 1:Анна',
      'A: SET user:1 1:Анна EX 300 → OK',
      'B: db.commit() → COMMIT',
      'C: GET user:1 → "1:Анна"',
    ],
    cached: '1:Анна',
    primary: '2:Мария',
  },
  'replica': {
    log: [
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: DEL user:1 → (integer) 0',
      'A: GET user:1 → (nil)',
      'A: db.read(1) → 1:Анна',
      'A: SET user:1 1:Анна EX 300 → OK',
      'R: реплика догнала',
      'C: GET user:1 → "1:Анна"',
    ],
    cached: '1:Анна',
    primary: '2:Мария',
  },
  'lease': {
    log: [
      'A: GET user:1 → (nil)',
      'A: SET lease:1 A NX PX 5000 → OK',
      'A: db.read(1) → 1:Анна',
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: DEL user:1 lease:1 → (integer) 1',
      'A: FCALL fill_if_lease 2 user:1 lease:1 A 1:Анна 300 → (integer) 0',
      'C: GET user:1 → (nil)',
      'C: SET lease:1 C NX PX 5000 → OK',
      'C: db.read(1) → 2:Мария',
      'C: FCALL fill_if_lease 2 user:1 lease:1 C 2:Мария 300 → (integer) 1',
    ],
    cached: '2:Мария',
    primary: '2:Мария',
  },
  'lease-replica': {
    log: [
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: DEL user:1 lease:1 → (integer) 0',
      'A: GET user:1 → (nil)',
      'A: SET lease:1 A NX PX 5000 → OK',
      'A: db.read(1) → 1:Анна',
      'A: FCALL fill_if_lease 2 user:1 lease:1 A 1:Анна 300 → (integer) 1',
      'R: реплика догнала',
      'C: GET user:1 → "1:Анна"',
    ],
    cached: '1:Анна',
    primary: '2:Мария',
  },
  'version': {
    log: [
      'A: GET user:1 → (nil)',
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: FCALL set_if_newer 1 user:1 2 Мария 300 → (integer) 1',
      'A: db.read(1) → 1:Анна',
      'A: FCALL set_if_newer 1 user:1 1 Анна 300 → (integer) 0',
      'R: реплика догнала',
      'C: GET user:1 → "2:Мария"',
    ],
    cached: '2:Мария',
    primary: '2:Мария',
  },
  'double-del': {
    log: [
      'A: GET user:1 → (nil)',
      'A: db.read(1) → 1:Анна',
      'B: db.begin() → BEGIN',
      'B: db.update(1, Мария) → 2:Мария',
      'B: db.commit() → COMMIT',
      'B: DEL user:1 → (integer) 0',
      'A: SET user:1 1:Анна EX 300 → OK',
      'C: GET user:1 → "1:Анна"',
      'B: пауза: дольше самого долгого чтения',
      'B: DEL user:1 → (integer) 1',
      'D: GET user:1 → (nil)',
      'D: db.read(1) → 2:Мария',
      'D: SET user:1 2:Мария EX 300 → OK',
    ],
    cached: '2:Мария',
    primary: '2:Мария',
  },
};

/** Пятьдесят читателей разом, настоящее время, база отвечает за 200 мс. Три прогона на строку дали одно и то же. */
export const STAND_BURST: Record<string, { dbCalls: number; waited: number }> = {
  'plain/miss': { dbCalls: 50, waited: 50 },
  'lock/miss': { dbCalls: 1, waited: 50 },
  'xfetch/miss': { dbCalls: 50, waited: 50 },
  'swr/miss': { dbCalls: 1, waited: 50 },
  'swr/stale': { dbCalls: 1, waited: 0 },
};

export const TTL_LOG = [
  'SET user:1 1:Анна EX 300 → OK',
  'TTL user:1 → (integer) 300',
  'SET user:1 2:Мария → OK',
  'TTL user:1 → (integer) -1',
  'SET user:1 2:Мария EX 300 → OK',
  'SET user:1 3:Мария KEEPTTL → OK',
  'TTL user:1 → (integer) 300',
  'TTL user:404 → (integer) -2',
  'EXPIRE user:404 60 → (integer) 0',
  'INCR views → (integer) 1',
  'EXPIRE views 60 → (integer) 1',
  'INCR views → (integer) 2',
  'TTL views → (integer) 60',
];

export const LOCK_STEAL_LOG = [
  'A: SET lock:news A NX PX 100 → OK',
  'прошло 300 мс',
  'B: SET lock:news B NX PX 3000 → OK',
  'A: DEL lock:news → (integer) 1',
  'C: SET lock:news C NX PX 3000 → OK',
  'A: FCALL unlock 1 lock:news A → (integer) 0',
  'C: GET lock:news → "C"',
];

export const IDLE_LOG = [
  'OBJECT IDLETIME page:1 → (integer) 4',
  'GET page:1 → "xxx…"',
  'OBJECT IDLETIME page:1 → (integer) 0',
  'OBJECT FREQ page:1 → (error) ERR An LFU maxmemory policy is not selected, access frequency not tracked. Please note that when switching between policies at runtime LRU and LFU data will take some time to adjust.',
  'CONFIG SET maxmemory-policy allkeys-lfu → OK',
  'OBJECT IDLETIME page:1 → (error) ERR An LFU maxmemory policy is selected, idle time not tracked. Please note that when switching between policies at runtime LRU and LFU data will take some time to adjust.',
];

/** `MEMORY USAGE` ключа со значением в 1000 байт. */
export const MEMORY_USAGE = 1072;

export const REDIS_DEFAULTS = { policy: 'noeviction', samples: 5, maxmemory: 0 };

/** Нагрузка `WORKLOAD_CODE` на настоящем Redis с `maxmemory` = исходная память + 432 000 байт; три прогона на политику. */
export const STAND_EVICT: Record<string, { s: number; h: number; c: number; evicted: number; fails: number; firstFail: number | null }[]> = {
  'noeviction/5': [
    { s: 50, h: 50, c: 211, evicted: 0, fails: 389, firstFail: 310 },
    { s: 50, h: 50, c: 199, evicted: 0, fails: 401, firstFail: 297 },
    { s: 50, h: 50, c: 199, evicted: 0, fails: 401, firstFail: 297 },
  ],
  'allkeys-lru/5': [
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
  ],
  'allkeys-lru/1': [
    { s: 11, h: 13, c: 274, evicted: 402, fails: 0, firstFail: null },
    { s: 12, h: 11, c: 275, evicted: 402, fails: 0, firstFail: null },
    { s: 9, h: 14, c: 275, evicted: 402, fails: 0, firstFail: null },
  ],
  'allkeys-lru/10': [
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
    { s: 0, h: 50, c: 248, evicted: 402, fails: 0, firstFail: null },
  ],
  'volatile-lru/5': [
    { s: 50, h: 50, c: 199, evicted: 401, fails: 0, firstFail: null },
    { s: 50, h: 50, c: 199, evicted: 401, fails: 0, firstFail: null },
    { s: 50, h: 50, c: 199, evicted: 401, fails: 0, firstFail: null },
  ],
  'volatile-ttl/5': [
    { s: 50, h: 0, c: 249, evicted: 401, fails: 0, firstFail: null },
    { s: 50, h: 0, c: 249, evicted: 401, fails: 0, firstFail: null },
    { s: 50, h: 0, c: 249, evicted: 401, fails: 0, firstFail: null },
  ],
  'allkeys-random/5': [
    { s: 15, h: 11, c: 272, evicted: 402, fails: 0, firstFail: null },
    { s: 15, h: 12, c: 271, evicted: 402, fails: 0, firstFail: null },
    { s: 15, h: 10, c: 274, evicted: 401, fails: 0, firstFail: null },
  ],
  'allkeys-lfu/5': [
    { s: 18, h: 50, c: 230, evicted: 402, fails: 0, firstFail: null },
    { s: 7, h: 50, c: 241, evicted: 402, fails: 0, firstFail: null },
    { s: 8, h: 50, c: 240, evicted: 402, fails: 0, firstFail: null },
  ],
};

export const OOM_ERROR = 'OOM command not allowed when used memory > \'maxmemory\'.';

/** Разовый замер, не пересобирается: кеш на пределе (`allkeys-lru`), 400 подряд `GET` и один `KEYS *`. */
export const READ_EVICT = { gets: 400, byGets: 22, byKeys: 23 };

/** Точки снимка по умолчанию у `redis:7-alpine` без файла настроек (`CONFIG GET save`). */
export const SAVE_DEFAULT = '3600 1 300 100 60 10000';

export const RESTART_ROWS: { k: string; how: string; before: number; after: number; tone: 'ok' | 'err' }[] = [
  {
    k: '`docker restart`, настройки образа',
    how: 'Redis получил SIGTERM, записал снимок (`Saving the final RDB snapshot before exiting`) и прочитал его при старте (`keys loaded: 1000`).',
    before: 1000,
    after: 1000,
    tone: 'ok',
  },
  {
    k: '`docker restart`, `--save ""`',
    how: 'Снимков нет — читать при старте нечего.',
    before: 1000,
    after: 0,
    tone: 'err',
  },
  {
    k: '`docker kill`, настройки образа',
    how: 'SIGKILL: финального снимка нет, а ни одна точка `save` за минуту и 500 изменений не сработала. Пропало всё, что записано после последнего снимка.',
    before: 500,
    after: 0,
    tone: 'err',
  },
];

/** Поток из 100 чтений через истечение: модель, виртуальное время, зерно 1. Пересчитывает тест. */
export const STREAM_ROWS: { strategy: Strategy; dbCalls: number; waited: number; maxWait: number; stale: number }[] = [
  { strategy: 'plain', dbCalls: 11, waited: 11, maxWait: 200, stale: 0 },
  { strategy: 'lock', dbCalls: 1, waited: 11, maxWait: 200, stale: 0 },
  { strategy: 'xfetch', dbCalls: 1, waited: 1, maxWait: 200, stale: 0 },
  { strategy: 'swr', dbCalls: 1, waited: 0, maxWait: 0, stale: 11 },
];

/** XFetch на том же потоке: среднее по зёрнам 1…1000 и ожидание по формуле `xfetchExpected`. */
export const XFETCH_MEANS: { beta: number; mean: string; expected: string }[] = [
  { beta: 0.5, mean: '5,73', expected: '5,71' },
  { beta: 1, mean: '2,79', expected: '2,83' },
  { beta: 2, mean: '2,68', expected: '2,71' },
];

// ─── Тонкие места ──────────────────────────────────────────────────────────────────────────

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Удаление внутри транзакции',
    d: '`DEL` до `COMMIT` открывает окно на всё время транзакции: любой промах в нём прочитает старую строку и положит её в кеш. Удалять — после фиксации, а лучше — из обработчика, который вызывается по факту `COMMIT`.',
    tone: 'err',
  },
  {
    n: '02',
    t: 'Чтение из реплики ломает «DEL после COMMIT»',
    d: 'Ключ удалён правильно, а следующий промах читает реплику, где изменения ещё нет. Лечится версией в значении или чтением промахов с основной базы.',
    tone: 'err',
  },
  {
    n: '03',
    t: '`SET` без срока делает ключ вечным',
    d: 'Обновили значение обычным `SET` — и срок пропал: `TTL` стал `-1`. Ошибочная копия теперь не исправится сама никогда. Пишите срок в каждом `SET` или `KEEPTTL`.',
    tone: 'err',
  },
  {
    n: '04',
    t: 'Замок снимают только по токену',
    d: 'Ваш замок истёк, пока шёл запрос, его взял другой — а вы делаете `DEL lock:…` и снимаете **чужой**. На стенде после такого `DEL` замок получил третий клиент: держателей стало двое. Снимать — функцией, которая сравнивает токен.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'После замка — перечитать кеш',
    d: 'Между `GET` (пусто) и `SET NX` (взял) прежний держатель мог положить значение и уйти. Без повторного `GET` вы пойдёте в базу второй раз.',
    tone: 'warn',
  },
  {
    n: '06',
    t: 'XFetch не спасает на промахе',
    d: 'Монетка бросается, пока значение есть. Ключ вытеснили, Redis перезапустили, ключ ещё не создан — и XFetch ведёт себя как код без защиты. Против пустого ключа нужен замок.',
    tone: 'warn',
  },
  {
    n: '07',
    t: 'По умолчанию Redis не вытесняет',
    d: 'Политика по умолчанию — `noeviction`: память кончилась — запись падает с `OOM command not allowed`. Для кеша это значит ошибки вместо промахов. Кешу ставят `allkeys-lru` или `allkeys-lfu` и `maxmemory` ниже лимита контейнера.',
    tone: 'warn',
  },
  {
    n: '08',
    t: '`allkeys-lru` вытесняет и то, что не кеш',
    d: 'Сессии, очереди и флаги, положенные в тот же Redis без срока, для `allkeys-lru` — просто давно не читанные ключи. На стенде все 50 таких ключей пропали. Либо отдельный Redis под данные, либо `volatile-lru` и срок на всех кешевых ключах.',
    tone: 'err',
  },
  {
    n: '09',
    t: '`volatile-ttl` выбрасывает самые старые записи — и горячие тоже',
    d: 'Ему всё равно, читают ли ключ: важен только остаток срока. Горячие ключи, записанные первыми, истекают раньше всех — на стенде ушли все 50.',
    tone: 'warn',
  },
  {
    n: '10',
    t: 'Вытесняет не только запись',
    d: 'Redis проверяет память перед каждой командой, и `used_memory` включает буферы клиентов. На стенде у кеша на пределе 400 подряд `GET` вытеснили 22 ключа, а один `KEYS *` — ещё 23. `evicted_keys` поэтому может расти и при чтении.',
  },
];

export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Redis — Key eviction',
    href: 'https://redis.io/docs/latest/develop/reference/eviction/',
    what: '`maxmemory`, восемь политик, приближённый LRU, `maxmemory-samples`, LFU',
  },
  {
    title: 'Redis — SET',
    href: 'https://redis.io/docs/latest/commands/set/',
    what: '`EX`, `PX`, `NX`, `KEEPTTL`; что обычный `SET` сбрасывает срок',
  },
  {
    title: 'Redis — EXPIRE',
    href: 'https://redis.io/docs/latest/commands/expire/',
    what: 'ответы `TTL` `-1` и `-2`, ленивое и фоновое удаление истёкших ключей',
  },
  {
    title: 'Redis — OBJECT IDLETIME',
    href: 'https://redis.io/docs/latest/commands/object-idletime/',
    what: 'простой ключа в секундах; недоступен при политике LFU',
  },
  {
    title: 'Redis — Functions',
    href: 'https://redis.io/docs/latest/develop/programmability/functions-intro/',
    what: '`FUNCTION LOAD`, `FCALL`, атомарность функции',
  },
  {
    title: 'Redis — Distributed locks',
    href: 'https://redis.io/docs/latest/develop/use/patterns/distributed-locks/',
    what: '`SET … NX PX`, снятие замка по токену',
  },
  {
    title: 'Redis — Persistence',
    href: 'https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/',
    what: 'RDB и AOF, точки `save`',
  },
  {
    title: 'Redis 7.4 — evict.c',
    href: 'https://github.com/redis/redis/blob/7.4/src/evict.c',
    what: 'пул кандидатов на 16 мест, `evictionPoolPopulate`',
  },
  {
    title: 'Nishtala et al. — Scaling Memcache at Facebook (NSDI 2013)',
    href: 'https://www.usenix.org/conference/nsdi13/technical-sessions/presentation/nishtala',
    what: 'аренды (leases) против устаревших записей и толпы',
  },
  {
    title: 'Vattani, Chierichetti, Lowenstein — Optimal Probabilistic Cache Stampede Prevention (VLDB 2015)',
    href: 'https://www.vldb.org/pvldb/vol8/p886-vattani.pdf',
    what: 'XFetch',
  },
  {
    title: 'nginx — proxy_cache_lock',
    href: 'https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_lock',
    what: 'замок на промахе в обратном прокси',
  },
  {
    title: 'ioredis',
    href: 'https://github.com/redis/ioredis',
    what: 'клиент Node.js; на стенде — 5.11.1',
  },
];

export const RELATED =
  'Смежное на сайте: [CDN и серверный кеш, «Устаревшее и толпа»](/platform/cdn-cache/#s3) — коллапс запросов, `stale-while-revalidate` и XFetch в общем HTTP-кеше. [CDN и серверный кеш, «Кеш в приложении»](/platform/cdn-cache/#s6) — память процесса против Redis и разброс сроков. [Nginx как обратный прокси, «Кеш и gzip»](/delivery/nginx-proxy/#s7) — `proxy_cache_lock`. [Кеш данных на клиенте](/frameworks/data-cache/) — та же копия по ключу, но в браузере. [Транзакции и уровни изоляции](/data/transactions/) — когда изменение становится видно другим. [Индексы Postgres и EXPLAIN](/data/indexes/) — сделать сам запрос дешевле, прежде чем его кешировать. [Балансировка нагрузки, «Хеш по ключу»](/delivery/load-balancing/#s4) — раскладка ключей по узлам. [Очереди и идемпотентность](/data/queues/) — подтверждение, повторная доставка, ключ идемпотентности и outbox. [Кеши с вытеснением](/algorithms/eviction/) — LRU на `Map` и в `lru-cache`, провалы LRU на скане и цикле, LFU, W-TinyLFU и SIEVE.';

// ─── Таблицы и подписи, собранные из литералов стенда ──────────────────────────────────────

export const INTRO_CALLOUT =
  'Кеш перед базой — это **копия**, и у копии три беды. Она устаревает: база поменялась, а кеш ещё нет. Она пустеет разом: срок вышел, и за одним и тем же в базу идут все. И она не помещается: память кончилась, и Redis сам решает, что выбросить. Каждая беда здесь снята на настоящем Redis — журналом команд и числом походов в базу.';

const strategyLabel = (s: Strategy) => HERD_STRATEGIES.find((x) => x.value === s)!.label;

export const BURST_ROWS: { k: string; db: number; waited: number; tone?: 'ok' | 'warn' | 'err' }[] = [
  { k: 'без защиты', ...pick('plain/miss'), tone: 'err' },
  { k: 'замок `SET lock NX PX`', ...pick('lock/miss'), tone: 'ok' },
  { k: 'XFetch', ...pick('xfetch/miss'), tone: 'err' },
  { k: 'мягкий срок, ключа нет', ...pick('swr/miss'), tone: 'ok' },
  { k: 'мягкий срок, лежит старое', ...pick('swr/stale'), tone: 'ok' },
];

function pick(key: string) {
  const r = STAND_BURST[key];
  return { db: r.dbCalls, waited: r.waited };
}

export const BURST_NOTE = `Пятьдесят читателей одновременно пришли за ключом \`news\`, база отвечает 200 мс. Без защиты в базу пошли все ${STAND_BURST['plain/miss'].dbCalls} — за одним и тем же значением. С замком пошёл один, а остальные ${STAND_BURST['lock/miss'].waited - 1} опрашивали кеш раз в 50 мс, пока значение не появилось. Мягкий срок, когда есть что отдать, не заставил ждать никого.`;

export const STREAM_TABLE = STREAM_ROWS.map((r) => ({
  k: strategyLabel(r.strategy),
  db: r.dbCalls,
  waited: r.waited,
  stale: r.stale,
  tone: (r.dbCalls > 1 ? 'err' : r.waited > 1 ? 'warn' : 'ok') as 'ok' | 'warn' | 'err',
}));

export const STREAM_NOTE = `Поток ровнее толпы: ${HERD_PARAMS.streamN} чтений по одному каждые ${HERD_PARAMS.intervalMs} мс, ключ истекает на ${HERD_PARAMS.expiryMs}-й миллисекунде. Без защиты в базу идут все, кто пришёл, пока первый промах ждёт ответа: ${STREAM_ROWS[0].dbCalls} человек. Замок оставляет один поход, но ${STREAM_ROWS[1].waited} читателей всё равно ждут. XFetch с этим зерном пересчитал значение за 810 мс до срока, и ждал только тот, у кого выпала монетка. Мягкий срок отдал ${STREAM_ROWS[3].stale} читателям старое мгновенно.`;

export const HERD_CAPTION =
  'Читатели — генераторы `HERD_CODE`, время — виртуальное (`simulate`), база отвечает 200 мс. На пятидесяти одновременных читателях эти же генераторы на настоящем Redis дали те же числа, что и здесь.';

export const XFETCH_TABLE_NOTE =
  'Монетки разные — и число пересчётов тоже. Среднее по тысяче прогонов сходится с формулой: читатель i пересчитывает с вероятностью exp(−до срока / (β·Δ)), если ни один пересчёт, начатый раньше чем за Δ до него, ещё не закончился. При β = 0,5 монетка выпадает поздно и часто у нескольких сразу.';

export const EVICT_ROWS = Object.entries(STAND_EVICT).map(([key, runs]) => {
  const [policy, samples] = key.split('/');
  const range = (g: 's' | 'h' | 'c') => {
    const xs = runs.map((r) => r[g]);
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  const fails = runs[0].fails ? `OOM с ${Math.min(...runs.map((r) => r.firstFail ?? Infinity))}-й записи` : String(runs[1].evicted);
  return {
    k: policy.endsWith('lru') ? `\`${policy}\`, выборка ${samples}` : `\`${policy}\``,
    s: range('s'),
    h: range('h'),
    c: range('c'),
    out: fails,
    tone: (policy === 'noeviction' || runs.some((r) => r.s === 0) || runs.some((r) => r.h === 0) ? 'warn' : undefined) as 'warn' | undefined,
  };
});

export const EVICT_STAND_NOTE = `Память — около ${EVICT_CAPACITY} ключей по 1000 байт (\`MEMORY USAGE\` одного такого ключа — ${MEMORY_USAGE} байт), записано 700. \`allkeys-lru\` с выборкой 5 и 10 оставил все 50 горячих ключей и выбросил все 50 ключей без срока: их ни разу не читали. С выборкой 1 тот же LRU стал случайным выбором — горячих уцелело 11–14, как у \`allkeys-random\`. \`volatile-lru\` не тронул ключи без срока, \`volatile-ttl\` выбросил горячие — у них срок кончался раньше всех.`;

export const IDLE_NOTE =
  'Отметку последнего обращения видно командой `OBJECT IDLETIME` — секунды простоя. После паузы в 3,1 с она показала 4: часы Redis идут целыми секундами. Чтение сбрасывает её в 0. При политике LFU вместо отметки хранится счётчик обращений, и `IDLETIME` отвечает ошибкой, а `OBJECT FREQ` — наоборот.';

export const LOCK_STEAL_NOTE =
  'Замок A истёк, пока A ещё работал, и его взял B. A по привычке снял замок простым `DEL` — и снял **чужой**: следом замок получил C, и теперь работают двое. Функция `unlock` в той же ситуации ответила `0` и ничего не тронула.';

export const COLD_TITLE_NOTE = `Без файла настроек образ \`redis:7-alpine\` делает снимок на диск по точкам \`save ${SAVE_DEFAULT}\` — «через час, если было хотя бы одно изменение», и чаще при большем числе изменений — и при штатной остановке.`;

/** Все строки модели в том порядке, в каком их склеивает `loadModel`. */
export const MODEL_PARTS = [REDIS_CODE, DB_CODE, SCHEDULE_CODE, CLIENT_CODE, FIX_CODE, HERD_CODE, SIM_CODE, EVICT_CODE, WORKLOAD_CODE];
export const RACE_ONLY = RACE_SCENARIOS.filter((s) => s.group === 'race');
export const FIX_ONLY = RACE_SCENARIOS.filter((s) => s.group === 'fix');
