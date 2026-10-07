import type { Pitfall } from '@/widgets/pitfalls/model/types';

/**
 * Данные темы «Поведение как значение: стратегия, команда, шаблонный метод, состояние».
 *
 * Источник — видеокурс по TypeScript из папки автора (`~/Desktop/курсы/ts/pattern`, ролики
 * 114 Command, 115 State, 116 Strategy, 118 Template Method, расшифрованы whisper). Из курса
 * взяты сквозные примеры и классические реализации: авторизация с подменой стратегии на лету
 * (`Auth`, `JwtStrategy`, `GithubStrategy`), команда `AddUserCommand` с историей и откатом,
 * шаблон `SaveForm<T>` с шагами «заполнить → залогировать → отправить» и два API, документ
 * `DocumentItem` с состояниями «черновик» и «опубликован» и обратной ссылкой `setContext`.
 * Угол темы — не UML, а **что в JS уже есть** (функция — значение, замыкание, объект-данные)
 * и где книжная версия ломается на особенностях языка: потерянном `this`, `void`, который
 * принимает промис, полях, которые не сериализуются, и общих объектах-состояниях.
 *
 * ── Чем проверено ───────────────────────────────────────────────────────────────────────
 * Каждый пример — строка в этом файле, и `tests/unit/patterns-behavior.test.ts` берёт **эту
 * строку**: компиляция `tsc` 6.0.3 со `strict`, ошибки сверяются с пометками `// ts(NNNN)` по
 * строкам; вывод сверяется с массивами `*_OUT`, полученными исполнением (Node 26.8.2).
 * Пример с асинхронным шагом (`TM_ASYNC_CODE`) тест запускает отдельным процессом `node`:
 * необработанный отказ промиса роняет процесс, и это проверяется кодом выхода.
 *
 * Найдено запуском и стоит знать (курс этого не говорит):
 *   — компаратор `(a, b) => a > b` в V8 не переставляет **ничего**: V8 зовёт его как
 *     (следующий, предыдущий), `false` читается как «равны»; `tsc` ловит это как `ts(2345)`;
 *   — `this`-параметр у метода не мешает передать метод как стратегию в тип без `this`:
 *     ошибка (`ts(2322)`) появляется, только если и тип стратегии объявит `this: void`;
 *   — команда, запомнившая «как было» при создании, а не при выполнении, после очереди
 *     откатывает через шаг;
 *   — команда-замыкание: `JSON.stringify` даёт `{}`, `structuredClone` — `DataCloneError`;
 *     экземпляр класса `structuredClone` копирует молча, но без методов; Redux 5.0.1 отвергает
 *     действие-экземпляр класса («Actions must be plain objects»);
 *   — `async`-переопределение шага, объявленного в базе как `void`, компилируется без ошибок,
 *     шаблон не ждёт его, а отказ промиса роняет процесс Node мимо `try`;
 *     (`no-misused-promises` из typescript-eslint 8.70 такую подстановку ловит — проверено
 *     запуском `eslint` на этом примере, тестом не закреплено);
 *   — `override` ловит переименованный в базе необязательный шаг (`ts(4113)`), без него
 *     переопределение молча становится мёртвым методом;
 *   — объекты-состояния, заведённые по одному на всё приложение, при обратной ссылке через
 *     `setContext` публикуют чужой документ: последний `setContext` побеждает.
 */

/* ──────────────────── Вводный раздел · словарь ──────────────────── */

export const PLAIN_BEHAVIOR =
  'Все четыре паттерна — про одно: часть поведения вынимают из объекта и делают отдельной вещью, которую можно передать, сохранить или подменить. Как насадки у дрели: дрель одна, а сверлит, крутит или мешает — смотря что вставили. В C++ 1994 года «вещью» мог быть только объект класса. В JavaScript функция сама по себе значение, и половина этих паттернов сводится к тому, чтобы передать функцию.';

export const GLOSSARY = [
  {
    k: 'поведенческий паттерн',
    d: 'Паттерн про то, **кто и как выполняет действие**: какой алгоритм выбрать, когда запустить, в каком порядке пройти шаги, что разрешено объекту в его нынешнем положении. В этой теме их четыре: стратегия, команда, шаблонный метод, состояние.',
  },
  {
    k: 'функция первого класса',
    d: 'Функцию можно положить в переменную, передать аргументом и вернуть из другой функции — как число или строку. В JS это так с самого начала, поэтому «объект с одним методом» здесь почти всегда заменяется функцией.',
  },
  {
    k: 'колбэк',
    d: 'Функция, которую передают другой функции, чтобы та вызвала её сама: компаратор в `sort`, обработчик в `addEventListener`. Стратегия и команда в JS чаще всего выглядят именно как колбэк.',
  },
  {
    k: 'компаратор',
    d: 'Функция `(a, b) => число`, по которой `Array.prototype.sort` решает порядок: меньше нуля — `a` раньше, больше нуля — `b` раньше, ноль — равны. Самая известная стратегия в JS.',
  },
  {
    k: 'получатель (receiver)',
    d: 'Объект, который на самом деле выполняет работу, когда команда исполняется. В примере — `UserService`: команда «добавить пользователя» знает, что сделать, а сохраняет его сервис.',
  },
  {
    k: 'хук',
    d: 'Шаг алгоритма, который можно подменить снаружи, не трогая сам алгоритм. В шаблонном методе это защищённый метод, который переопределяет наследник; в JS — чаще функция в объекте настроек.',
  },
  {
    k: 'конечный автомат',
    d: 'Описание объекта как набора состояний и разрешённых переходов между ними: «черновик → на модерации → опубликован». Объект в каждый момент ровно в одном состоянии, а всё, чего нет в таблице переходов, запрещено.',
  },
  {
    k: 'размеченное объединение',
    d: 'Тип из нескольких вариантов объекта с общим полем-меткой: `{ status: \'draft\' } | { status: \'published\'; url: string }`. По метке компилятор понимает, какой вариант перед ним, и какие у него поля.',
  },
];

/* ──────────────────── Раздел 0 · перед началом ──────────────────── */

export const PREREQ_NOTE = 'Тема опирается на четыре вещи, и все четыре разобраны на сайте.';

export const PREREQ = [
  {
    t: 'Функция помнит, где её создали',
    d: 'Замыкание: функция видит переменные места, где её написали, даже когда тот вызов давно закончился. На этом держится команда без класса — она носит свои данные в замыкании.',
    href: '/js/closures/#s3',
    hrefLabel: 'Замыкания, раздел «Замыкание»',
    tone: 'info' as const,
  },
  {
    t: 'Метод, оторванный от объекта, теряет `this`',
    d: 'Стратегию и команду передают как значение, а метод класса, переданный так, вызывается без объекта. Почему это `TypeError` и почему компилятор молчит.',
    href: '/tooling/typescript/#s7',
    hrefLabel: 'TypeScript на уровне типов, раздел «Классы»',
    tone: 'warn' as const,
  },
  {
    t: 'Размеченное объединение и `never`',
    d: 'Как компилятор сужает тип по полю-метке в `switch` и как `assertNever` в `default` заставляет разобрать все варианты. На этом построена версия паттерна «состояние» без классов.',
    href: '/tooling/typescript/#s2',
    hrefLabel: 'TypeScript на уровне типов, раздел «Сужение»',
    tone: 'info' as const,
  },
  {
    t: 'Порядок инициализации класса',
    d: 'Поля наследника появляются только после возврата из `super()`. Шаблонный метод, вызванный из конструктора базового класса, видит их пустыми.',
    href: '/js/object-model/#s4',
    hrefLabel: 'Объектная модель, раздел «Классы»',
    tone: 'info' as const,
  },
];

/* ──────────────────── Раздел 1 · зачем ──────────────────── */

/**
 * С чего начинается стратегия: выбор алгоритма — цепочкой `if` внутри класса.
 *
 * Иллюстрация, а не исполняемый пример: тест только компилирует её (`tsc`, ошибок нет).
 */
export const PROBLEM_CODE = `interface User { name: string; githubToken?: string; jwtToken?: string }

class Auth {
  authUser(user: User, provider: string): boolean {
    if (provider === 'jwt') {
      return user.jwtToken === 's3cret';           // сверить подпись токена
    }
    if (provider === 'github') {
      return Boolean(user.githubToken);            // сходить в API GitHub
    }
    return false;
  }
  // logout, refresh — с той же лестницей if внутри
}
// пришёл Google — правка в каждом методе Auth`;

/** Четыре паттерна: что решает каждый и что из этого JS уже даёт сам. */
export const PATTERN_ROWS: { k: string; task: string; js: string; book: string }[] = [
  {
    k: 'Стратегия',
    task: 'подменять алгоритм, не трогая того, кто его вызывает',
    js: 'функция-аргумент: компаратор в `sort`, обработчик события; набор стратегий — объект функций',
    book: 'у алгоритма свои настройки и несколько связанных методов — его удобно собрать в класс',
  },
  {
    k: 'Команда',
    task: 'превратить вызов в объект: отложить, поставить в очередь, записать, отменить',
    js: 'замыкание `{ execute, undo }` внутри процесса; объект-данные `{ type, … }` для очереди и сети',
    book: 'общая логика всех команд — номер, история, журнал — в базовом классе',
  },
  {
    k: 'Шаблонный метод',
    task: 'зафиксировать порядок шагов, а сами шаги отдать на откуп',
    js: 'функция, которая принимает шаги объектом: `makeSaver({ fill, send })`',
    book: 'шагов много, у части есть разумные умолчания, а наследники уже есть',
  },
  {
    k: 'Состояние',
    task: 'менять поведение объекта вместе с его положением: черновик ведёт себя иначе, чем опубликованный',
    js: 'размеченное объединение и `switch` с проверкой полноты; таблица переходов',
    book: 'у каждого состояния много своей логики, и `switch` разрастается в каждом методе',
  },
];

/* ──────────────────── Раздел 2 · стратегия ──────────────────── */

export const PLAIN_STRATEGY =
  'Стратегия — как способ оплаты на кассе. Кассир пробивает чек одинаково, а дальше спрашивает «картой или наличными?» — и подставляет нужный способ. Добавить оплату по QR — значит научить кассу ещё одному способу, а не переучивать кассира.';

/**
 * Стратегия из видеокурса: интерфейс `AuthStrategy`, по классу на провайдера, подмена на лету.
 *
 * Закреплено тестом: компиляция без ошибок, вывод `STRATEGY_CLASSIC_OUT`.
 */
export const STRATEGY_CLASSIC_CODE = `interface User { name: string; githubToken?: string; jwtToken?: string }
interface AuthStrategy { auth(user: User): boolean }

class Auth {
  constructor(private strategy: AuthStrategy) {}
  setStrategy(strategy: AuthStrategy) { this.strategy = strategy; }   // подмена на лету
  authUser(user: User) { return this.strategy.auth(user); }
}
class JwtStrategy implements AuthStrategy {
  auth(user: User) { return user.jwtToken === 's3cret'; }
}
class GithubStrategy implements AuthStrategy {
  auth(user: User) { return Boolean(user.githubToken); }
}

const anna: User = { name: 'Аня', githubToken: 'gho_1' };
const auth = new Auth(new JwtStrategy());
console.log(auth.authUser(anna));              // false — JWT у Ани нет
auth.setStrategy(new GithubStrategy());
console.log(auth.authUser(anna));              // true`;

export const STRATEGY_CLASSIC_OUT = [false, true];

/**
 * Та же стратегия без классов: тип функции и объект функций с `satisfies`.
 *
 * Закреплено тестом: `ts(2339)` на несуществующем ключе, вывод `STRATEGY_FN_OUT`.
 */
export const STRATEGY_FN_CODE = `interface User { name: string; githubToken?: string; jwtToken?: string }
type AuthStrategy = (user: User) => boolean;

const STRATEGIES = {
  jwt: (user) => user.jwtToken === 's3cret',     // тип user выведен из AuthStrategy
  github: (user) => Boolean(user.githubToken),
} satisfies Record<string, AuthStrategy>;

function authUser(user: User, strategy: AuthStrategy) {
  return strategy(user);
}

const anna: User = { name: 'Аня', githubToken: 'gho_1' };
console.log(authUser(anna, STRATEGIES.github));          // true
console.log(authUser(anna, (u) => u.name === 'Аня'));    // разовая стратегия — без класса
STRATEGIES.google;                                       // ts(2339): такой нет`;

export const STRATEGY_FN_OUT = [true, true];

export const STRATEGY_FN_NOTES: string[] = [
  '**Интерфейс с одним методом — это тип функции.** `AuthStrategy` в книжном виде требует от стратегии ровно одного: принять пользователя и вернуть `boolean`. В JS для этого не нужен класс — подойдёт любая функция с такой сигнатурой, в том числе написанная прямо в месте вызова. `Auth` с полем и `setStrategy` сворачивается в функцию, которая принимает стратегию аргументом.',
  '**`satisfies` проверяет набор и не стирает ключи.** С аннотацией `Record<string, AuthStrategy>` у объекта пропали бы имена: `STRATEGIES.google` стал бы законным и вернул `undefined`. `satisfies` сверяет каждое значение с `AuthStrategy` — и заодно подсказывает тип параметра `user`, — но оставляет объекту его настоящие ключи, поэтому опечатка — ошибка компиляции.',
  '**Класс остаётся, когда у стратегии есть своё.** Секрет для подписи, клиент API, три связанных метода (`auth`, `refresh`, `logout`) — это уже объект, и собирать его в класс честно. Так устроен Passport.js: каждая стратегия — экземпляр со своими настройками, который регистрируют через `passport.use`.',
];

/**
 * Компаратор как стратегия сортировки: верный, составной и булев.
 *
 * Закреплено тестом: `ts(2345)` на булевом компараторе, вывод `SORT_OUT` (Node 26.8.2, V8).
 * Что булев компаратор не переставляет ничего — свойство V8, а не спецификации: для
 * несогласованного компаратора порядок «implementation-defined». Тест сверяет V8 отдельно
 * на случайных массивах.
 */
export const SORT_CODE = `interface User { name: string; age: number }
const users: User[] = [
  { name: 'Вера', age: 30 },
  { name: 'Аня', age: 25 },
  { name: 'Борис', age: 30 },
];
type Compare<T> = (a: T, b: T) => number;

const byAge: Compare<User> = (a, b) => a.age - b.age;
const byName: Compare<User> = (a, b) => a.name.localeCompare(b.name);
const thenBy = <T>(...rules: Compare<T>[]): Compare<T> => (a, b) => {
  for (const rule of rules) {
    const r = rule(a, b);
    if (r !== 0) return r;                       // первое правило, где не «равны»
  }
  return 0;
};

const names = (list: User[]) => list.map((u) => u.name).join();
console.log(names(users.toSorted(byAge)));                  // Вера раньше Бориса — как было
console.log(names(users.toSorted(thenBy(byAge, byName))));  // равных по возрасту — по имени

console.log([3, 1, 2].sort((a, b) => a > b).join());       // ts(2345): boolean, а не число`;

export const SORT_OUT = ['Аня,Вера,Борис', 'Аня,Борис,Вера', '3,1,2'];

export const SORT_NOTES: string[] = [
  '**`sort` — та же стратегия, только встроенная.** Алгоритм сортировки один, а порядок задаёт функция, которую передали. Поэтому новое правило — новая функция, а не новый метод: `byAge`, `byName` и `thenBy`, который собирает из двух правил третье.',
  '**Сортировка устойчивая — и на этом держится составной порядок.** С ES2019 `sort` и `toSorted` обязаны сохранять исходный порядок у равных элементов. Вера и Борис оба тридцатилетние, и `byAge` оставил их, как они стояли. Без этой гарантии результат `byAge` для равных был бы случайным.',
  '**Компаратор `a > b` в V8 не сортирует вовсе.** Он возвращает `true` или `false`, а `sort` ждёт число: `false` превращается в `0`, то есть «равны». V8 вызывает компаратор как «следующий, предыдущий». Если следующий меньше, `a > b` даёт `false`, то есть «равны», и элемент остаётся на месте; если больше — он и так стоит верно. Массив не меняется вовсе. Ошибки нет, просто порядок не тот. TypeScript ловит это сразу: функция, возвращающая `boolean`, не подходит в параметр `(a, b) => number`.',
];

/**
 * Стратегия — метод класса: `this` теряется, и `this`-параметр спасает не всегда.
 *
 * `tsc` 6.0.3; закреплено тестом: единственная ошибка — `ts(2322)` на строке с `this: void`,
 * вывод `THIS_STRATEGY_OUT` (имя ошибки, а не текст).
 */
export const THIS_STRATEGY_CODE = `interface User { name: string; jwtToken?: string }
type AuthStrategy = (user: User) => boolean;
type SafeStrategy = (this: void, user: User) => boolean;

class JwtStrategy {
  constructor(private secret: string) {}
  auth(this: JwtStrategy, user: User) { return user.jwtToken === this.secret; }
}
const jwt = new JwtStrategy('s3cret');
const anna: User = { name: 'Аня', jwtToken: 's3cret' };

function authUser(user: User, strategy: AuthStrategy) { return strategy(user); }
try { authUser(anna, jwt.auth); }                        // компилятор молчит
catch (e) { console.log((e as Error).name); }

function authSafe(user: User, strategy: SafeStrategy) { return strategy(user); }
authSafe(anna, jwt.auth);                                // ts(2345): this не тот
console.log(authSafe(anna, (u) => jwt.auth(u)));         // стрелка вызывает через объект`;

export const THIS_STRATEGY_OUT = ['TypeError', true];

export const THIS_STRATEGY_NOTE =
  'Метод `auth` читает `this.secret`, а `authUser` вызывает его как голую функцию — `this` равен `undefined`, и `TypeError`. Подпись `this: JwtStrategy` у метода кажется защитой, но она срабатывает только при прямом вызове `jwt.auth` без объекта. Тип `AuthStrategy` про `this` ничего не говорит, и компилятор считает, что метод в него подходит. Ошибка появляется, только когда обе стороны объявили `this`: метод — свой класс, тип стратегии — `this: void`, «вызову без объекта». Проще держать стратегию функцией без `this` или передавать стрелку `(u) => jwt.auth(u)`. Три способа не терять `this` и их цена — в теме [«TypeScript на уровне типов», раздел «Классы»](/tooling/typescript/#s7).';

/* ──────────────────── Раздел 3 · команда ──────────────────── */

export const PLAIN_COMMAND =
  'Команда — как заказ на кухню, записанный на бумажке. Официант не жарит котлету сам: он пишет, что приготовить и для какого стола, и кладёт бумажку в очередь. Бумажку можно отложить, отменить, пересчитать в конце смены. Повар — получатель: только он знает, как жарить.';

/**
 * Команда из видеокурса: базовый класс с номером и историей, `AddUserCommand` с откатом.
 *
 * В курсе `undo` объявлен только у `AddUserCommand`; здесь он поднят в базовый класс, чтобы
 * историю можно было откатывать, не зная вида команды. Закреплено тестом: вывод `COMMAND_CLASSIC_OUT`.
 */
export const COMMAND_CLASSIC_CODE = `class User { constructor(public userId: number) {} }

class UserService {                              // получатель: он и делает работу
  saved: number[] = [];
  saveUser(user: User) { this.saved.push(user.userId); }
  deleteUser(userId: number) { this.saved = this.saved.filter((id) => id !== userId); }
}

class CommandHistory {
  commands: Command[] = [];
  push(command: Command) { this.commands.push(command); }
  remove(command: Command) {
    this.commands = this.commands.filter((c) => c.commandId !== command.commandId);
  }
}

abstract class Command {
  commandId = Math.random();
  constructor(public history: CommandHistory) {}
  abstract execute(): void;
  abstract undo(): void;
}

class AddUserCommand extends Command {
  constructor(private user: User, private receiver: UserService, history: CommandHistory) {
    super(history);
  }
  execute() {
    this.receiver.saveUser(this.user);
    this.history.push(this);
  }
  undo() {
    this.receiver.deleteUser(this.user.userId);
    this.history.remove(this);
  }
}

const service = new UserService();
const history = new CommandHistory();
const add = new AddUserCommand(new User(1), service, history);
add.execute();
console.log('сохранены: ' + service.saved.join() + ', в истории ' + history.commands.length);
add.undo();
console.log('сохранены: ' + service.saved.join() + ', в истории ' + history.commands.length);`;

export const COMMAND_CLASSIC_OUT = ['сохранены: 1, в истории 1', 'сохранены: , в истории 0'];

/**
 * Команда-замыкание и момент, когда она запоминает «как было».
 *
 * Закреплено тестом: вывод `COMMAND_CAPTURE_OUT`.
 */
export const COMMAND_CAPTURE_CODE = `interface Command { execute(): void; undo(): void }
const user = { name: 'Аня' };

// «как было» запомнено при создании команды
function renameEarly(target: { name: string }, name: string): Command {
  const prev = target.name;
  return { execute: () => { target.name = name; }, undo: () => { target.name = prev; } };
}
// «как было» запомнено в момент выполнения
function rename(target: { name: string }, name: string): Command {
  let prev = '';
  return {
    execute: () => { prev = target.name; target.name = name; },
    undo: () => { target.name = prev; },
  };
}

const queue = [renameEarly(user, 'Анна'), renameEarly(user, 'Анна Иванова')];  // обе ждут в очереди
queue.forEach((c) => c.execute());
queue[1].undo();
console.log(user.name);                        // Аня — откат перепрыгнул через шаг

user.name = 'Аня';
const fixed = [rename(user, 'Анна'), rename(user, 'Анна Иванова')];
fixed.forEach((c) => c.execute());
fixed[1].undo();
console.log(user.name);                        // Анна`;

export const COMMAND_CAPTURE_OUT = ['Аня', 'Анна'];

export const COMMAND_NOTES: string[] = [
  '**Команда без класса — это замыкание.** Объект `{ execute, undo }`, созданный функцией, хранит цель и новое имя в замыкании: ни `this`, ни конструктора, ни `super`. Базовый класс команды окупается, когда у всех команд есть общее — номер, история, журнал, — и это общее не хочется повторять в каждой.',
  '**Откат запоминает «как было» в момент выполнения, а не создания.** Начинать стоит с того, ради чего команда нужна: очередь и отложенный запуск. Но команда, созданная заранее, видит состояние на момент создания. `renameEarly` обе запомнили «Аня», потому что обе созданы до первого выполнения, — и откат второй прыгнул через первую. Правило простое: всё, что нужно для `undo`, команда снимает внутри `execute`.',
  '**История — стопка, а не список с поиском.** Книжная версия удаляет команду из истории фильтром по номеру. Для отмены по Ctrl+Z нужен порядок: снимать последнюю, класть её в стопку повтора, а новая команда стопку повтора сбрасывает. Как устроены две стопки, чем запись-снимок отличается от обратной правки и как склеить набранное слово в одну запись — в теме [«Отмена и повтор: undo/redo изнутри»](/algorithms/undo-redo/#s3).',
];

/**
 * Команда для очереди и сети: замыкание и экземпляр класса не переживают сериализацию,
 * объект-данные — переживает.
 *
 * Закреплено тестом: вывод `COMMAND_DATA_OUT`; отдельно — что Redux 5 отвергает
 * действие-экземпляр класса.
 */
export const COMMAND_DATA_CODE = `const users: string[] = [];
const show = (label: string, f: () => unknown) => {
  try { console.log(label + ': ' + f()); } catch (e) { console.log(label + ': ' + (e as Error).name); }
};

const addUser = (name: string) => ({ execute: () => { users.push(name); } });
class AddUserCommand { constructor(public name: string) {} execute() { users.push(this.name); } }

show('JSON замыкания', () => JSON.stringify(addUser('Аня')));
show('structuredClone замыкания', () => structuredClone(addUser('Аня')));
const copy: any = structuredClone(new AddUserCommand('Аня'));
show('structuredClone класса, execute', () => typeof copy.execute);

// команда-данные: что сделать и с чем; как сделать — знает обработчик
type Cmd = { type: 'addUser'; name: string } | { type: 'removeUser'; name: string };
const handlers = {
  addUser: (c: { name: string }) => { users.push(c.name); },
  removeUser: (c: { name: string }) => { users.splice(users.indexOf(c.name), 1); },
};
const fromQueue: Cmd = JSON.parse(JSON.stringify({ type: 'addUser', name: 'Борис' }));
handlers[fromQueue.type](fromQueue);
show('после очереди', () => users.join());`;

export const COMMAND_DATA_OUT = [
  'JSON замыкания: {}',
  'structuredClone замыкания: DataCloneError',
  'structuredClone класса, execute: undefined',
  'после очереди: Борис',
];

export const COMMAND_DATA_NOTE =
  'Очередь задач, `postMessage` в воркер, `localStorage`, запрос на сервер — всё это передаёт **данные**, а не функции. Команда-замыкание превращается в `{}` у `JSON.stringify` и роняет `structuredClone` с `DataCloneError`. Экземпляр класса хуже: `structuredClone` копирует его молча, но методы остаются в прототипе, а прототип не копируется, и у копии нет `execute`. Поэтому команда, которая уходит из процесса, — это объект-данные `{ type, … }`, а код живёт в обработчике на той стороне. Так устроены действия Redux: Redux 5 проверяет, что действие — простой объект, и экземпляр класса отвергает ошибкой «Actions must be plain objects». Как действие проходит через reducer — в теме [«Стейт-менеджеры изнутри», раздел «Redux»](/frameworks/state-managers/#s2).';

/* ──────────────────── Раздел 4 · шаблонный метод ──────────────────── */

export const PLAIN_TEMPLATE =
  'Шаблонный метод — как бланк заявления: порядок граф задан («ФИО», «дата», «подпись»), а что в них писать — решает каждый. Нельзя поставить подпись раньше ФИО, но можно написать любое ФИО.';

/**
 * Шаблонный метод из видеокурса: `SaveForm<T>` и два API.
 *
 * Закреплено тестом: компиляция без ошибок, вывод `TM_CLASSIC_OUT`.
 */
export const TM_CLASSIC_CODE = `class Form { constructor(public name: string) {} }

abstract class SaveForm<T> {
  save(form: Form) {                            // шаблонный метод: порядок шагов зашит здесь
    const res = this.fill(form);
    this.log(res);
    this.send(res);
  }
  protected abstract fill(form: Form): T;       // шаг, который знает только API
  protected log(data: T): void {                 // общий шаг — один на всех
    console.log('лог: ' + JSON.stringify(data));
  }
  protected abstract send(data: T): void;
}

class FirstAPI extends SaveForm<string> {
  protected fill(form: Form) { return form.name; }
  protected send(data: string) { console.log('отправляю ' + data); }
}
class SecondAPI extends SaveForm<{ fio: string }> {
  protected fill(form: Form) { return { fio: form.name }; }
  protected send(data: { fio: string }) { console.log('отправляю ' + data.fio); }
}

new FirstAPI().save(new Form('Аня'));
new SecondAPI().save(new Form('Борис'));`;

export const TM_CLASSIC_OUT = ['лог: "Аня"', 'отправляю Аня', 'лог: {"fio":"Борис"}', 'отправляю Борис'];

/**
 * Асинхронный шаг в шаблоне, объявленном синхронным.
 *
 * `tsc` 6.0.3: ошибок нет. Тест запускает код отдельным процессом `node` и сверяет вывод
 * `TM_ASYNC_OUT`, код выхода 1 и текст ошибки в stderr: отказ промиса никто не ждал.
 */
export const TM_ASYNC_CODE = `abstract class SaveForm<T> {
  save(name: string) {
    this.send(this.fill(name));
    console.log('сохранено');
  }
  protected abstract fill(name: string): T;
  protected abstract send(data: T): void;
}

class SlowAPI extends SaveForm<string> {
  protected fill(name: string) { return name; }
  protected async send(data: string) {           // в базе void, здесь промис — ошибки нет
    await new Promise((r) => setTimeout(r, 10));
    throw new Error('сервер ответил 500 на ' + data);
  }
}

try {
  new SlowAPI().save('Аня');
} catch {
  console.log('поймано');                        // не напечатается
}`;

export const TM_ASYNC_OUT = ['сохранено'];

/**
 * Необязательный шаг переименовали в базе — наследник остался со старым именем.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(4113)` только там, где написан `override`; вывод `TM_OVERRIDE_OUT`.
 */
export const TM_OVERRIDE_CODE = `abstract class SaveForm {
  save(name: string) {
    this.prepare(name);
    console.log('сохранено ' + name);
  }
  protected prepare(name: string) {}             // необязательный шаг; раньше звался beforeSend
}

class AuditAPI extends SaveForm {
  protected beforeSend(name: string) { console.log('аудит ' + name); }   // молча мёртв
}
class CheckedAPI extends SaveForm {
  protected override beforeSend(name: string) { console.log('аудит ' + name); } // ts(4113)
}

new AuditAPI().save('Аня');                       // аудита нет`;

export const TM_OVERRIDE_OUT = ['сохранено Аня'];

export const TM_NOTES: string[] = [
  '**`void` в базе принимает `async`-наследника.** Тип возврата `void` значит для компилятора «результат никто не читает», и функция, которая возвращает промис, в него подходит. `SlowAPI.send` компилируется без единого слова, `save` не ждёт отправку и печатает «сохранено» сразу. Ошибка сервера случается уже после `try` — ловить её некому, и Node по умолчанию завершает процесс с кодом 1. Если шаг может быть асинхронным, его объявляют `Promise<void>`, а шаблон — `async` с `await`.',
  '**Необязательный шаг теряется молча при переименовании.** Абстрактный шаг переименовать безопасно: наследник без нового метода не скомпилируется. Шаг с пустой реализацией по умолчанию — нет: `AuditAPI.beforeSend` превратился в обычный метод, который никто не вызывает. Слово `override` говорит компилятору «это переопределение», и тот проверяет, что такой метод в базе есть, — `ts(4113)`. Флаг `noImplicitOverride` требует писать `override` у каждого переопределения, и тогда переименование в базе не пропустит ни одного наследника.',
  '**`abstract` и `protected` не доживают до `.js`.** Это проверки компилятора. Из JS-кода `save` можно вызвать у объекта, собранного без `fill`, а `send` — снаружи. Порядок шагов шаблон держит, только пока его не обходят.',
];

/**
 * Шаблонный метод без наследования: функция, которая принимает шаги объектом.
 *
 * Закреплено тестом: `ts(2345)` на пропущенном шаге, вывод `TM_HOOKS_OUT`.
 */
export const TM_HOOKS_CODE = `type Steps<T> = { fill(name: string): T; send(data: T): Promise<void> };

function makeSaver<T>(steps: Steps<T>) {
  return async (name: string) => {              // порядок шагов — по-прежнему в одном месте
    const data = steps.fill(name);
    console.log('лог: ' + JSON.stringify(data));
    await steps.send(data);
    console.log('сохранено');
  };
}

const saveFirst = makeSaver({
  fill: (name) => name,
  send: async (data) => { console.log('отправляю ' + data.toUpperCase()); },  // data: string
});
const saveSecond = makeSaver({
  fill: (name) => ({ fio: name }),
  send: async (data) => { console.log('отправляю ' + data.fio); },            // data: { fio }
});
await saveFirst('Аня');
await saveSecond('Борис');

makeSaver({ fill: (name) => name });            // ts(2345): шага send нет`;

export const TM_HOOKS_OUT = ['лог: "Аня"', 'отправляю АНЯ', 'сохранено', 'лог: {"fio":"Борис"}', 'отправляю Борис', 'сохранено'];

export const TM_HOOKS_NOTE =
  'Шаблон остался шаблоном: порядок «заполнить → залогировать → отправить» по-прежнему в одной функции. Ушли наследование и `this`. Тип `T` компилятор выводит из `fill` и подставляет в `send`, поэтому `data.toUpperCase()` в первом API и `data.fio` во втором проверены без единой аннотации. Шаги можно собрать из готовых функций и подменить в тесте, а пропущенный шаг — ошибка компиляции. Наследование выигрывает, когда шагов много и у большинства есть умолчание: переопределить два из десяти короче, чем передавать десять.';

/* ──────────────────── Раздел 5 · состояние ──────────────────── */

export const PLAIN_STATE =
  'Состояние — как светофор. Кнопка «перейти» у пешеходного светофора делает разное в зависимости от того, что сейчас горит: на красном — ставит в очередь, на зелёном — ничего. Паттерн «состояние» выносит это «смотря что горит» из кнопки в сам цвет: каждый цвет знает, что делать на нажатие и какой цвет следующий.';

/**
 * Состояние из видеокурса: документ, абстрактное состояние и обратная ссылка `setContext`.
 *
 * В курсе строку `this.state.setContext(this)` сначала забыли — тест выкидывает её и проверяет,
 * что компилятор молчит, а выполнение бросает `TypeError`. Вывод полной версии — `STATE_CLASS_OUT`.
 */
export const STATE_CLASS_CODE = `class DocumentItem {
  text = '';
  private state!: DocumentItemState;
  constructor() { this.setState(new DraftState()); }
  getState() { return this.state; }
  setState(state: DocumentItemState) {
    this.state = state;
    this.state.setContext(this);                 // эту строку легко забыть
  }
  publishDoc() { this.state.publish(); }
  deleteDoc() { this.state.delete(); }
}

abstract class DocumentItemState {
  abstract name: string;
  protected item!: DocumentItem;                 // «!» — обещание, что поле заполнят
  setContext(item: DocumentItem) { this.item = item; }
  abstract publish(): void;
  abstract delete(): void;
}

class DraftState extends DocumentItemState {
  name = 'черновик';
  publish() {
    console.log('на сайт: ' + this.item.text);
    this.item.setState(new PublishedState());
  }
  delete() { console.log('черновик удалён'); }
}
class PublishedState extends DocumentItemState {
  name = 'опубликован';
  publish() { console.log('уже опубликован'); }
  delete() {
    console.log('снят с публикации');
    this.item.setState(new DraftState());
  }
}

const item = new DocumentItem();
item.text = 'мой пост';
item.publishDoc();
item.publishDoc();
item.deleteDoc();
console.log(item.getState().name);`;

export const STATE_CLASS_OUT = ['на сайт: мой пост', 'уже опубликован', 'снят с публикации', 'черновик'];

/**
 * Состояния без своих данных, заведённые по одному на приложение, и обратная ссылка.
 *
 * Закреплено тестом: вывод `SHARED_STATE_OUT` — Аня опубликовала пост Бориса.
 */
export const SHARED_STATE_CODE = `abstract class DocState {
  protected item!: Doc;
  setContext(item: Doc) { this.item = item; }
  abstract publish(): void;
}
class Draft extends DocState { publish() { this.item.setState(PUBLISHED); } }
class Published extends DocState { publish() {} }

const DRAFT: DocState = new Draft();             // своих данных у состояния нет —
const PUBLISHED: DocState = new Published();     // зачем создавать его на каждый переход?

class Doc {
  state = DRAFT;
  constructor(public title: string) { this.state.setContext(this); }
  setState(s: DocState) { this.state = s; s.setContext(this); }
  publish() { this.state.publish(); }
}

const annaPost = new Doc('пост Ани');
const borisPost = new Doc('пост Бориса');        // DRAFT теперь смотрит на пост Бориса
annaPost.publish();
console.log('Аня: ' + (annaPost.state === PUBLISHED ? 'опубликован' : 'черновик'));
console.log('Борис: ' + (borisPost.state === PUBLISHED ? 'опубликован' : 'черновик'));`;

export const SHARED_STATE_OUT = ['Аня: черновик', 'Борис: опубликован'];

export const STATE_CLASS_NOTES: string[] = [
  '**Обратная ссылка — второй шаг, который легко забыть.** Состояние должно знать свой документ, чтобы переключить его, и книжная версия передаёт его отдельным вызовом `setContext`. Без этой строки первый же `publish` бросает `TypeError`: `this.item` — `undefined`. Компилятор молчит, потому что `item!` — обещание «поле заполнят», которое он не проверяет. Забыть этот вызов легко, а компилятор о нём не напомнит.',
  '**Общее состояние с обратной ссылкой путает документы.** У `Draft` и `Published` нет своих данных, и создавать их на каждый переход кажется расточительным — их заводят по одному. Но `setContext` записывает документ **в общий объект**: конструктор `borisPost` перезаписал ссылку, и `annaPost.publish()` опубликовал пост Бориса. Ни ошибки, ни предупреждения. Если состояния общие, документ передают аргументом — `publish(item: Doc)` — и поле `item` не заводят вовсе.',
  '**Плюс классов — логика состояния лежит в одном месте.** Всё, что черновик делает на «опубликовать», — в `DraftState`, а не в ветке `switch` внутри каждого метода документа. Окупается это, когда методов и логики много: CRM-заявка с десятком положений и проверками в каждом.',
];

/**
 * Состояние как размеченное объединение: у каждого состояния свои поля, `switch` с проверкой полноты.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2322)` на опубликованном документе без адреса, вывод `STATE_UNION_OUT`.
 */
export const STATE_UNION_CODE = `type Doc =
  | { status: 'draft'; text: string }
  | { status: 'moderation'; text: string; sentAt: Date }
  | { status: 'published'; text: string; url: string };
type Action = 'publish' | 'approve' | 'reject' | 'unpublish';

function assertNever(x: never): never {
  throw new Error('необработанное состояние: ' + JSON.stringify(x));
}

function next(doc: Doc, action: Action): Doc {
  switch (doc.status) {
    case 'draft':
      if (action === 'publish') return { status: 'moderation', text: doc.text, sentAt: new Date() };
      return doc;
    case 'moderation':
      if (action === 'approve') return { status: 'published', text: doc.text, url: '/p/1' };
      if (action === 'reject') return { status: 'draft', text: doc.text };
      return doc;
    case 'published':
      if (action === 'unpublish') return { status: 'draft', text: doc.text };
      return doc;
    default:
      return assertNever(doc);                   // новое состояние без case — ошибка компиляции
  }
}

let doc: Doc = { status: 'draft', text: 'мой пост' };
for (const action of ['approve', 'publish', 'approve', 'unpublish'] as const) {
  doc = next(doc, action);
  console.log(action + ' → ' + doc.status);
}
const broken: Doc = { status: 'published', text: 'пост' };   // ts(2322): нет url`;

export const STATE_UNION_OUT = ['approve → draft', 'publish → moderation', 'approve → published', 'unpublish → draft'];

/**
 * Таблица переходов: конечный автомат как данные.
 *
 * `tsc` 6.0.3; закреплено тестом: `ts(2820)` на опечатке, `ts(2741)` на пропущенном состоянии,
 * вывод `STATE_TABLE_OUT`.
 */
export const STATE_TABLE_CODE = `type Status = 'draft' | 'moderation' | 'published';
type Action = 'publish' | 'approve' | 'reject' | 'unpublish';
type Machine = { [S in Status]: Partial<Record<Action, Status>> };

const TRANSITIONS: Machine = {
  draft: { publish: 'moderation' },
  moderation: { approve: 'published', reject: 'draft' },
  published: { unpublish: 'draft', reject: 'publised' },   // ts(2820): опечатка
};
const FORGOTTEN: Machine = {                                 // ts(2741): нет published
  draft: { publish: 'moderation' },
  moderation: { approve: 'published', reject: 'draft' },
};

function next(status: Status, action: Action): Status {
  return TRANSITIONS[status][action] ?? status;               // перехода нет — стоим на месте
}
console.log(next('draft', 'approve'));
console.log(next('draft', 'publish'));`;

export const STATE_TABLE_OUT = ['draft', 'moderation'];

export const STATE_UNION_NOTES: string[] = [
  '**Невозможное состояние не собрать.** У каждого варианта объединения свои поля: адрес есть только у опубликованного, время отправки — только у документа на модерации. Опубликованный документ без `url` — ошибка компиляции. В версии на классах все поля живут в одном документе, и «опубликован, но без адреса» никто не запретит.',
  '**`assertNever` в `default` — та же проверка полноты, что у классов `abstract`.** Добавили состояние «в архиве» — каждый `switch`, который о нём не знает, перестаёт компилироваться. Как это работает и почему без этой строки забытый случай молча вернёт `undefined` — в теме [«TypeScript на уровне типов», раздел «Сужение»](/tooling/typescript/#s2).',
  '**Таблица переходов — автомат как данные.** Всё, что разрешено, видно в одном объекте, а тип `Machine` требует строку на каждое состояние и проверяет, что переходы ведут в существующие. Поведение в каждом состоянии здесь одно — «перейти», и для этого таблицы хватает. Когда к переходам добавляются проверки, запросы и побочные действия, их пишут рядом с таблицей или берут библиотеку конечных автоматов.',
];

/* ──────────────────── Раздел 6 · тонкие места ──────────────────── */

export const PITFALLS: Pitfall[] = [
  {
    n: '01',
    t: 'Метод, переданный стратегией или командой, теряет `this`',
    d: '`authUser(anna, jwt.auth)`, `button.addEventListener(\'click\', cmd.execute)`, `setTimeout(cmd.undo)` — метод уходит без объекта, и `this` внутри него — `undefined`. TypeScript молчит, даже если у метода объявлен `this`-параметр: ошибка появится, только когда и тип колбэка объявит `this: void`. Надёжнее стратегии и команды без `this` — функции и замыкания — или стрелка в месте передачи.',
    tone: 'err',
  },
  {
    n: '02',
    t: '`(a, b) => a > b` — не компаратор',
    d: 'Компаратор обязан вернуть число: отрицательное, ноль или положительное. Булев ответ даёт только «1» и «0», и `sort` не может узнать, что `a` меньше `b`. В V8 такая сортировка не меняет массив вовсе, в других движках — даёт какой-то порядок. Правильно: `a - b` для чисел, `a.localeCompare(b)` для строк. И без компаратора `sort` сравнивает строками: `[10, 9, 1].sort()` — это `[1, 10, 9]`.',
    tone: 'err',
  },
  {
    n: '03',
    t: 'Шаблонный метод, вызванный из конструктора, не видит полей наследника',
    d: 'Если базовый класс зовёт шаг прямо в конструкторе (`constructor() { this.setup() }`), то `setup` наследника выполнится раньше, чем появятся его поля: `separator = \';\'` в этот момент ещё `undefined`. Поля создаются после возврата из `super()`. Компилятор этого не видит. Шаблон вызывают отдельным методом после создания объекта. Порядок разобран в теме [«Объектная модель», раздел «Классы»](/js/object-model/#s4).',
    tone: 'warn',
  },
  {
    n: '04',
    t: 'Асинхронный шаг под типом `void`',
    d: 'Переопределение `async send()` подходит под `send(): void` базового класса — компилятор не возражает. Шаблон не ждёт промис: следующие шаги выполняются раньше отправки, а ошибка отправки не попадает ни в один `try`. Шаг, который может быть асинхронным, объявляют `Promise<void>` сразу, а линтер с правилом `no-misused-promises` из typescript-eslint ловит такие подстановки.',
    tone: 'err',
  },
  {
    n: '05',
    t: 'Команде, которая уходит из процесса, нельзя быть функцией',
    d: 'Очередь, воркер, сервер, `localStorage` принимают данные. Замыкание становится `{}` или `DataCloneError`, экземпляр класса — объектом без методов. Команда для передачи — объект `{ type, … }`, а выполняет её обработчик по `type` на той стороне.',
  },
  {
    n: '06',
    t: 'Одно общее состояние на всех с полем «мой документ»',
    d: 'Объект-состояние без своих данных хочется создать один раз. Пока он не хранит ссылку на документ, это безопасно. Как только хранит — через `setContext` или поле, — документы начинают переключать друг друга. Либо по объекту-состоянию на документ, либо документ передаётся в каждый метод состояния аргументом.',
    tone: 'warn',
  },
];

/* ──────────────────── Раздел 7 · источники ──────────────────── */

/** ⚠️ Без разметки: `SourceList` печатает `title` и `what` как есть. */
export const SOURCES: { title: string; href: string; what: string }[] = [
  {
    title: 'Refactoring Guru — поведенческие паттерны',
    href: 'https://refactoring.guru/ru/design-patterns/behavioral-patterns',
    what: 'классические схемы стратегии, команды, шаблонного метода и состояния с примерами на TypeScript',
  },
  {
    title: 'ECMAScript — Array.prototype.sort',
    href: 'https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.sort',
    what: 'устойчивость сортировки и что порядок с несогласованным компаратором зависит от движка',
  },
  {
    title: 'MDN — Array.prototype.sort()',
    href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort',
    what: 'требования к компаратору, устойчивость с ES2019, сравнение строками по умолчанию',
  },
  {
    title: 'TypeScript Handbook — this parameters',
    href: 'https://www.typescriptlang.org/docs/handbook/2/functions.html#declaring-this-in-a-function',
    what: 'this-параметр у функции и метода и this: void у колбэка',
  },
  {
    title: 'TypeScript Handbook — Classes, override',
    href: 'https://www.typescriptlang.org/docs/handbook/2/classes.html',
    what: 'abstract, protected, ключевое слово override и флаг noImplicitOverride',
  },
  {
    title: 'TypeScript FAQ — Why are functions returning non-void assignable to function returning void?',
    href: 'https://github.com/microsoft/TypeScript/wiki/FAQ#why-are-functions-returning-non-void-assignable-to-function-returning-void',
    what: 'почему функция с промисом подходит туда, где ждут void',
  },
  {
    title: 'Redux Fundamentals — Actions',
    href: 'https://redux.js.org/tutorials/fundamentals/part-2-concepts-data-flow#actions',
    what: 'действие как обычный объект с полем type — команда в виде данных',
  },
  {
    title: 'Passport.js — Strategies',
    href: 'https://www.passportjs.org/concepts/authentication/strategies/',
    what: 'авторизация на стратегиях, классический пример',
  },
];

export const RELATED =
  'Смежное на сайте: [Создание объектов: фабрика, строитель, прототип, одиночка](/patterns/creational/) — порождающие паттерны и что из них JS умеет сам. [Отмена и повтор: undo/redo изнутри](/algorithms/undo-redo/) — команда с откатом в настоящем редакторе: две стопки, обратные правки, группировка. [TypeScript на уровне типов, раздел «Сужение»](/tooling/typescript/#s2) — размеченные объединения и `assertNever`. [Стейт-менеджеры изнутри](/frameworks/state-managers/) — действия Redux как команды-данные. [Замыкания](/js/closures/) — откуда у команды без класса её данные. [Колбэки, раздел «this»](/js/callbacks/#s4) — что происходит с `this` у функции, переданной другой функции.';
