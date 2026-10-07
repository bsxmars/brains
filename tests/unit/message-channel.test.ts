import { spawnSync } from 'node:child_process';
import { createSecretKey } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MessageChannel,
  receiveMessageOnPort,
  type MessagePort,
} from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  NODE_ROWS,
  PITFALLS,
  PORT_LINES,
  SHARED_FACTS,
  SHARED_PAGE_CODE,
  SHARED_WORKER_CODE,
  SIZE_NOTE,
  SNAPSHOT_CODE,
  TRANSFER,
} from '@/content/lessons/message-channel/data';
import { SCENARIOS, runTransfer } from '@/widgets/transfer-rules/model/run';
import type { TransferKey } from '@/widgets/transfer-rules/model/types';

/**
 * Утверждения урока «MessageChannel» — запуском, а не по памяти.
 *
 * Тема набрана с пометками «проверено в Node 24.11»: тишина вместо исключения после `close()`
 * и после transfer, шесть случаев transfer-списка с настоящими текстами ошибок, авто-start
 * у `addEventListener`, синхронное чтение, удержание рантайма слушающим портом. Каждая такая
 * пометка — разовая ручная сверка, которую `npm test` не повторял ни разу: разойтись с движком
 * она могла молча. Здесь ожидания не переписаны в тест руками, а **вычислены из литералов
 * `data.ts`** и сверены с настоящим выполнением. Падение означает ровно одно: на странице
 * написана неправда.
 *
 * ⚠️ Браузерная половина темы сюда намеренно не попала — см. последний блок файла, где она
 * перечислена поимённо. В Node нет ни DOM-узла, ни `messageerror`, ни отказа `addEventListener`
 * заводить порт, и выдавать их за проверенные нельзя.
 *
 * ⚠️ Каждый канал закрывается в `finally`. Это не гигиена: живой слушающий порт — GC-root
 * и активный хэндл, он удержит рантайм и подвесит прогон. Ровно та утечка, о которой
 * рассказывает раздел 5 темы, — и уронить она способна сам тест про неё.
 *
 * ⚠️ Абсолютных миллисекунд здесь нет. Числа встречаются только в двух местах, и ни одно
 * из них ничего не утверждает: предохранитель `GUARD_MS`, чтобы упавший тест падал, а не висел
 * вечно, и `turns()`, дающая циклу провернуться. Решают всегда содержимое очереди и порядок.
 */

// ---------------------------------------------------------------------------
// Инструменты
// ---------------------------------------------------------------------------

/**
 * Предохранитель ожидания.
 *
 * Не утверждение о времени: если сообщение не пришло, тест обязан упасть с внятным текстом,
 * а не висеть до таймаута всего прогона. Ни одна проверка ниже не опирается на то, что срок
 * именно такой.
 */
const GUARD_MS = 2000;

/** Дать циклу событий провернуться несколько раз: доставка по порту — задача, не микрозадача. */
const turn = () => new Promise<void>((resolve) => void setTimeout(resolve, 0));
const turns = async (times = 5): Promise<void> => {
  for (let i = 0; i < times; i += 1) await turn();
};

/**
 * Канал, который закроется в любом случае.
 *
 * Оба конца гасятся в `finally` — включая путь с исключением. `close()` идемпотентен
 * (проверено), поэтому повторное закрытие внутри тела ничему не мешает.
 */
async function withChannel<T>(run: (channel: MessageChannel) => Promise<T> | T): Promise<T> {
  const channel = new MessageChannel();
  try {
    return await run(channel);
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

/** Дождаться одного сообщения. `once` в Node сам стартует порт — это и есть предмет проверки ниже. */
function nextMessage(port: MessagePort, what: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error(`сообщение «${what}» так и не пришло`)), GUARD_MS);
    port.once('message', (value: unknown) => {
      clearTimeout(guard);
      resolve(value);
    });
  });
}

/** Дождаться ровно `count` сообщений — и сказать, сколько пришло, если не дождались. */
function collect(port: MessagePort, count: number, what: string): Promise<unknown[]> {
  const got: unknown[] = [];
  return new Promise((resolve, reject) => {
    const guard = setTimeout(
      () => reject(new Error(`«${what}»: ждали ${count} сообщений, пришло ${got.length}`)),
      GUARD_MS,
    );
    port.on('message', (value: unknown) => {
      got.push(value);
      if (got.length === count) {
        clearTimeout(guard);
        resolve(got);
      }
    });
  });
}

/** Снять сообщение с порта синхронно — и отдать именно значение, а не обёртку. */
const peek = (port: MessagePort): unknown => receiveMessageOnPort(port)?.message;

/** Имя исключения или пустая строка, если вызов прошёл. Текст V8 не нормативен — имя нормативно. */
function attempt(call: () => void): string {
  try {
    call();
    return '';
  } catch (error) {
    return (error as Error).name;
  }
}

/**
 * Выполнить исходник отдельным процессом и посмотреть, **завершился ли он сам**.
 *
 * Нужен ровно для одного утверждения: слушающий порт держит рантайм живым. Внутри прогона
 * это не показать — незавершение процесса там выглядит как зависший Vitest, а не как красный
 * тест. Таймаут здесь — не мерка времени, а способ отличить «вышел» от «не вышел».
 */
function runInNode(source: string): { stdout: string; exitedOnItsOwn: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'lesson-message-channel-'));
  const file = join(dir, 'hold.cjs');
  writeFileSync(file, source);
  // Срок здесь — не мерка: удерживающий процесс не выйдет **никогда**, и ждать его дольше
  // незачем. Он заведомо короче таймаута самого теста, иначе падал бы Vitest, а не проверка.
  const run = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 2500 });
  return { stdout: run.stdout.trim(), exitedOnItsOwn: run.status === 0 && run.signal === null };
}

/** Строка таблицы «Node против браузера». Пропажа строки обязана падать внятно. */
function nodeRow(needle: string) {
  const found = NODE_ROWS.find((r) => r.k.includes(needle));
  if (!found) throw new Error(`в NODE_ROWS нет строки про «${needle}» — проверка без предмета`);
  return { browser: found.cells[0].v, node: found.cells[1].v };
}

/** Случай transfer-списка из данных темы. */
function transferCase(key: string) {
  const found = TRANSFER.find((c) => c.key === key);
  if (!found) throw new Error(`в TRANSFER нет случая «${key}» — проверка без предмета`);
  return found;
}

/** Тонкое место по номеру: нумерация живая, пропажа не должна приезжать `undefined` в заголовок. */
function pitfall(n: string) {
  const found = PITFALLS.find((p) => p.n === n);
  if (!found) throw new Error(`тонкого места ${n} в data.ts нет — проверка осталась без предмета`);
  return found;
}

// ---------------------------------------------------------------------------
// Раздел 1 · очередь порта
// ---------------------------------------------------------------------------

describe('очередь порта: буфер до включения ничего не теряет', () => {
  /**
   * Первая реплика песочницы обещает: «сообщения будут копиться». Проверяется это
   * единственным честным способом — отправить в порт, у которого **нет ни одного слушателя**,
   * и подписаться заметно позже. Ни одно сообщение пропасть не имеет права.
   */
  it('три сообщения, отправленные до подписки, приходят после неё — и в порядке отправки', async () => {
    expect(PORT_LINES.initial.text, 'страница обещает именно накопление').toContain('копиться');
    expect(PORT_LINES.postBuffered.text).toContain('ничего не потеряно');

    const got = await withChannel(async ({ port1, port2 }) => {
      port2.postMessage('первое');
      port2.postMessage('второе');
      port2.postMessage('третье');

      // Несколько оборотов цикла — буфер обязан пережить их все, а не «успеть проскочить».
      await turns();

      return collect(port1, 3, 'буфер до подписки');
    });

    expect(got, 'весь буфер доставлен разом, в порядке отправки').toEqual([
      'первое',
      'второе',
      'третье',
    ]);
    expect(PORT_LINES.startOk.text, 'страница формулирует это так же').toContain('в порядке отправки');
  });

  /**
   * ⚠️ Главное расхождение Node и браузера, и тема о нём честно пишет.
   *
   * В браузере `addEventListener('message')` очередь НЕ включает — нужен `start()`.
   * В Node тот же вызов стартует порт сам. Проверяем **поведение Node** и сверяем его
   * с правой колонкой таблицы; левую колонку в этой среде подтвердить нечем.
   */
  it('в Node `addEventListener` сам стартует порт — ни одного вызова `start()`', async () => {
    const row = nodeRow('addEventListener без start()');
    expect(row.node, 'таблица обещает авто-start').toContain('авто-start');

    const got = await withChannel(async ({ port1, port2 }) => {
      port2.postMessage('до подписки');

      const received: unknown[] = [];
      port1.addEventListener('message', (event) => {
        received.push((event as MessageEvent).data);
      });

      // Ни `port1.start()`, ни `onmessage` здесь нет намеренно: в браузере это и была бы тишина.
      await turns();
      return received;
    });

    expect(got, 'Node завёл порт за нас — в браузере тут было бы пусто').toEqual(['до подписки']);
    expect(PORT_LINES.listen.text, 'реплика песочницы предупреждает ровно об этом').toContain(
      'В Node этот же вызов стартует порт',
    );
  });

  it("`port.on('message')` — тоже авто-start, как и обещает таблица", async () => {
    expect(nodeRow("port.on('message')").node).toContain('авто-start');

    const got = await withChannel(({ port1, port2 }) => {
      port2.postMessage('эмиттером');
      return nextMessage(port1, 'через on()');
    });

    expect(got).toBe('эмиттером');
  });

  /** «`start()` идемпотентен, и выключить его обратно нечем» — обе половины реплики. */
  it('`start()` можно звать сколько угодно, обратного вызова не существует', async () => {
    expect(PORT_LINES.startAgain.text).toContain('идемпотентен');

    await withChannel(({ port1, port2 }) => {
      expect(attempt(() => { port1.start(); port1.start(); port1.start(); }), 'повтор не бросает').toBe('');
      expect('stop' in port1, 'способа выключить очередь обратно в API нет').toBe(false);
      port2.postMessage(null);
    });
  });

  /**
   * Третий из трёх фактов вступления: доставка — **макрозадача**, отдельный task source.
   * Проверяется порядком, а не часами: микрозадача, поставленная ПОСЛЕ отправки, всё равно
   * выполняется раньше доставки.
   */
  it('доставка — задача, а не микрозадача: `queueMicrotask` обгоняет её, встав позже', async () => {
    const order = await withChannel(async ({ port1, port2 }) => {
      const seen: string[] = [];
      const delivered = nextMessage(port1, 'доставка').then(() => void seen.push('сообщение'));

      port2.postMessage('x');
      queueMicrotask(() => void seen.push('микрозадача'));

      await delivered;
      return seen;
    });

    expect(order, 'слив микрозадач проходит целиком до того, как цикл возьмётся за задачу').toEqual([
      'микрозадача',
      'сообщение',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Раздел 1 · тишина вместо ошибки
// ---------------------------------------------------------------------------

describe('отсутствие ошибки ничего не доказывает: три способа промолчать', () => {
  /**
   * Тема утверждает это с пометкой «проверено в Node 24.11» и строит на нём целый абзац
   * про «почему у меня половина событий не доходит». Утверждение сильное и легко ломается
   * сменой версии — поэтому оно и закрепляется здесь.
   */
  it('`postMessage` в закрытый порт — тихий no-op, без исключения', async () => {
    expect(PORT_LINES.postClosed.text, 'страница обещает именно тишину').toContain('без исключения');

    const channel = new MessageChannel();
    channel.port1.close();
    channel.port2.close();

    expect(attempt(() => channel.port1.postMessage('в закрытый')), 'бросать нечему').toBe('');
    expect(attempt(() => channel.port2.postMessage('и с той стороны')), 'обе стороны молчат').toBe('');
  });

  /**
   * Второй молчащий случай: порт, отданный в transfer-списке. Локальная ссылка переходит
   * в detached, отправка по ней не делает ничего — и не жалуется.
   */
  it('`postMessage` в отсоединённый порт — тоже тишина', async () => {
    expect(PORT_LINES.detachedOk.text).toContain('Проверено в Node 24.11: исключения нет');

    await withChannel(async (carrier) => {
      const inner = new MessageChannel();
      try {
        carrier.port1.postMessage({ port: inner.port1 }, [inner.port1]);

        // Старый конец с этого момента — detached: сцепка с напарником жива, но не здесь.
        expect(attempt(() => inner.port1.postMessage('в пустоту')), 'ни ошибки, ни доставки').toBe('');

        const moved = (peek(carrier.port2) as { port: MessagePort }).port;
        try {
          inner.port2.postMessage('через переданный конец');
          expect(await nextMessage(moved, 'по переехавшему порту'), 'сцепка сохранилась').toBe(
            'через переданный конец',
          );
          expect(peek(moved), 'а то, что слали в detached, не пришло никуда').toBeUndefined();
        } finally {
          moved.close();
        }
      } finally {
        inner.port1.close();
        inner.port2.close();
      }
    });

    expect(PORT_LINES.transferOk.text, 'реплика называет это своим именем').toContain('detached');
  });

  /**
   * Третий: живой порт, у которого на том конце уже никого нет. Проверяем не «нет ошибки»,
   * а связку — отправили, ошибки нет, ответа тоже нет. Это и есть содержание итоговой врезки.
   */
  it('живой порт без собеседника: отправка проходит, ответа не будет никогда', async () => {
    await withChannel(async ({ port1, port2 }) => {
      const answers: unknown[] = [];
      port1.on('message', (value: unknown) => void answers.push(value));

      // Напарник закрыт — «воркер убит», «вкладка закрыта», «SW выгружен».
      port2.close();

      expect(attempt(() => port1.postMessage('есть кто?')), 'отправка не жалуется').toBe('');
      await turns();
      expect(answers, 'и не ответит тоже никто — событий об этом не бывает').toEqual([]);
    });
  });

  it('`close()` дважды — не ошибка', async () => {
    expect(PORT_LINES.closeAgain.text).toContain('Уже закрыт');
    const channel = new MessageChannel();
    channel.port1.close();
    expect(attempt(() => channel.port1.close())).toBe('');
    channel.port2.close();
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · правила transfer-списка
// ---------------------------------------------------------------------------

/**
 * Шесть случаев transfer-списка исполняет **модель виджета** — `widgets/transfer-rules/model/run`.
 *
 * Здесь раньше лежала своя `runTransfer`, повторявшая те же шесть случаев вручную: тест и демо
 * писались одновременно, и каждый спрашивал движок своим кодом. Ровно это `AGENTS.md` запрещает
 * («демо и тест обязаны спрашивать движок одним и тем же кодом»), и по делу: две реализации
 * расходятся молча, а расхождение между тем, что видит читатель, и тем, что проверяет тест,
 * не заметил бы никто.
 *
 * Направление сверки от этого не меняется: `model/run.ts` — движок, `TRANSFER` из `data.ts` —
 * заявление темы, тест ловит расхождение между ними.
 *
 * ⚠️ Утверждается только машиночитаемое: имя ошибки, числа `senderBytes`/`receiverBytes`,
 * сырые `arrivals`. Подписи из `values` и `owner` — текст для читателя («buf.byteLength → 0,
 * доступа больше нет»); проверка, зацепившаяся за такую строку, ломалась бы от косметической
 * правки, ничего не гарантируя по существу. Строки показа собраны из тех же чисел.
 *
 * ⚠️ `withChannel` здесь не нужен: модель сама заводит свежий канал и свежий буфер на каждый
 * прогон и закрывает порты в `finally` — иначе повторный прогон давал бы другой ответ.
 */

/** Случаи, которые модель умеет исполнять. Из этого же списка строится переключатель демо. */
const MODEL_KEYS = SCENARIOS.map((scenario) => scenario.key);

/**
 * Исполнить случай темы моделью виджета.
 *
 * Сторож на седьмой случай: появится он в `data.ts` — здесь и упадёт, с именем ключа. Молча
 * пройти мимо проверок новый случай не может.
 */
function runCase(key: string) {
  if (!MODEL_KEYS.includes(key as TransferKey)) {
    throw new Error(`случай «${key}» появился в data.ts, но модель виджета его не исполняет`);
  }
  return runTransfer(key as TransferKey);
}

describe('правила transfer-списка — шесть случаев, исполненных по-настоящему', () => {
  it('шесть случаев темы и шесть случаев модели — один список в одном порядке', async () => {
    expect(TRANSFER.map((c) => c.key)).toEqual(['self', 'no-list', 'orphan', 'view', 'ok', 'twice']);
    expect(MODEL_KEYS, 'демо листает ровно те случаи, что заявлены в теме').toEqual(
      TRANSFER.map((c) => c.key),
    );

    // Сторож на будущее: появится седьмой случай — тест скажет об этом сразу, а не пропустит.
    for (const item of TRANSFER) {
      const run = await runCase(item.key);
      expect(run.key, `случай «${item.key}» исполнен моделью`).toBe(item.key);
      expect(
        run.supported,
        '`MessageChannel` в этой среде есть: заглушка означала бы, что ниже проверяется пустота',
      ).toBe(true);
    }
  });

  for (const item of TRANSFER) {
    const expectsThrow = item.result === 'DataCloneError';

    it(`${item.key} · ${item.label} → ${item.result}`, async () => {
      const run = await runCase(item.key);

      if (expectsThrow) {
        // Имя ошибки нормативно; сменись оно — на странице напечатана неправда.
        expect(run.errorName, `случай «${item.label}» обязан падать DataCloneError`).toBe(
          'DataCloneError',
        );
      } else {
        expect(run.errorName, `случай «${item.label}» обязан пройти без исключения`).toBe('');
      }
    });
  }

  /**
   * Самая коварная строка темы: ошибки нет, а буфер молча испорчен и никуда не передан.
   * Проверяется обеими половинами сразу — иначе «тихо теряется» звучит как «ничего
   * не произошло», а произошло ровно обратное.
   */
  it('orphan · ошибки нет, буфер обнулён, получателю приехало только `{ n: 1 }`', async () => {
    const item = transferCase('orphan');
    const run = await runCase('orphan');

    expect(run.errorName, 'ни одна строка не упала').toBe('');
    expect(run.senderBytes, 'буфер детачнулся, хотя в сообщении его не было').toBe(0);
    expect(run.senderDetached, 'и это именно detached, а не пустой буфер').toBe(true);
    expect(run.arrivals, 'а приехало только само сообщение').toEqual([{ n: 1 }]);
    expect(run.receiverBytes, 'ни одного байта получателю не досталось').toBeNull();

    expect(item.owner?.sender, 'полоса владения говорит то же самое').toContain('0');
    expect(item.owner?.receiver).toContain('{ n: 1 }');
  });

  /**
   * Случай, который разводят реже всего: `view` в списке — это падение **до** отправки,
   * и буфер остаётся целым. «Упало» и «испортилось» здесь не одно и то же.
   */
  it('view · вызов не состоялся, и буфер отправителя цел — все 1024 байта', async () => {
    const item = transferCase('view');
    const run = await runCase('view');

    expect(run.errorName).toBe('DataCloneError');
    expect(run.senderBytes, 'бросок случился раньше, чем что-то отцепили').toBe(1024);
    expect(run.senderDetached, 'буфер не отсоединялся вовсе').toBe(false);
    expect(run.senderViewBytes, 'и вид на него тоже жив').toBe(1024);
    expect(run.arrivals, 'получателю не досталось ничего').toEqual([]);
    expect(item.owner?.sender, 'полоса владения обещает ровно 1024').toContain('1024');
  });

  /**
   * Правильный вариант — и единственный, где видно, что такое перенос владения:
   * у отправителя ноль **и у буфера, и у вьюхи**, у получателя рабочий массив с данными.
   */
  it('ok · у отправителя ноль, у получателя рабочий `Uint8Array(1024)` с теми же байтами', async () => {
    const item = transferCase('ok');
    const run = await runCase('ok');

    expect(run.errorName, 'правильный вызов не падает').toBe('');
    expect(run.senderBytes, 'владение ушло — у отправителя ноль').toBe(0);
    expect(run.senderDetached, 'и это именно detached, а не пустой буфер').toBe(true);
    expect(run.senderViewBytes, 'локальная вьюха умерла вместе с буфером').toBe(0);
    expect(run.receiverBytes, 'а у получателя рабочие 1024 байта — копирования не было').toBe(1024);
    expect(run.receiverMark, 'данные целы, у них просто новый владелец').toBe(7);

    const payload = (run.arrivals[0] as { payload?: unknown } | undefined)?.payload;
    expect(payload, 'вьюха приехала клонируемой структурой').toBeInstanceOf(Uint8Array);

    expect(item.owner?.sender, 'полоса владения обещает ноль у обоих').toContain('0');
    expect(item.owner?.receiver).toContain('Uint8Array(1024)');
  });

  /** Повторный перенос: буфер уже detached ещё с прошлой строки — и вот это падает громко. */
  it('twice · второй `postMessage` с тем же буфером падает, а первый прошёл', async () => {
    const item = transferCase('twice');
    const run = await runCase('twice');

    expect(run.errorName).toBe('DataCloneError');
    expect(run.senderBytes, 'ноль здесь ещё с первой строки, а не следствие броска').toBe(0);
    // Первый вызов обязан был пройти — иначе второму нечего ломать. Доказывает это доставка:
    // одно сообщение доехало, и увезло оно все 1024 байта вместе с меткой в первом байте.
    expect(run.arrivals.length, 'доехал ровно первый кусок, второй не ушёл').toBe(1);
    expect(run.receiverBytes, 'и буфер уехал целиком').toBe(1024);
    expect(run.receiverMark, 'с данными, а не пустой').toBe(7);
    expect(item.owner?.sender).toContain('ещё с прошлой строки');
  });

  /** Порт нельзя перенести сам по себе: по нему же и отправляют. */
  it('self · порт не может уехать через самого себя, но канал остаётся цел', async () => {
    const run = await runCase('self');

    expect(run.errorName).toBe('DataCloneError');
    expect(
      run.arrivals.length,
      'отказ оборвал одно сообщение, а не канал: следующее обычное доехало',
    ).toBe(1);
  });

  /**
   * Порты только переносятся: забыли список — сообщение не уйдёт вовсе. А вот буфер в той же
   * ситуации не падает, и это вторая половина случая: он уезжает молча копией, байты остаются
   * у обеих сторон, и перенос за O(1) оборачивается копированием.
   */
  it('no-list · порт роняет отправку целиком, а буфер в той же строке уезжает копией', async () => {
    const item = transferCase('no-list');
    const run = await runCase('no-list');

    expect(run.errorName, 'порт клонировать нечем').toBe('DataCloneError');
    expect(
      run.arrivals.map((message) => Object.keys(message as object)),
      'сообщение с портом не ушло вообще — доехало только второе, с буфером',
    ).toEqual([['buf']]);

    expect(run.senderBytes, 'буфер никуда не уехал: у отправителя все байты на месте').toBe(1024);
    expect(run.senderDetached, 'ничего не отсоединилось — это копия, а не перенос').toBe(false);
    expect(run.receiverBytes, 'и те же байты появились у получателя').toBe(1024);
    expect(run.receiverMark, 'копия полная, вместе с данными').toBe(7);
    expect(item.why, 'тема говорит и про тихую копию, а не только про падение порта').toContain(
      'копией',
    );
  });

  /**
   * ⚠️ Единственное место в файле, где сверяется **текст**, и он здесь не норматив, а цитата:
   * тема печатает эти строки на странице как «так и печатает Node». Пока они на странице
   * стоят в кавычках, они обязаны совпадать с движком. Сменит V8 формулировку — править надо
   * данные, а не это утверждение.
   */
  it('цитаты Node на странице совпадают с тем, что движок печатает сейчас', async () => {
    const quotes: Record<string, string> = {
      self: 'Transfer list contains source port',
      'no-list': 'Object that needs transfer was found in message but not listed in transferList',
      view: 'Found invalid value in transferList.',
      twice: 'Cannot transfer object of unsupported type.',
    };

    for (const [key, quote] of Object.entries(quotes)) {
      expect(transferCase(key).why, `цитата случая «${key}» пропала из данных`).toContain(quote);
      const run = await runCase(key);
      expect(run.error, `Node печатает про «${key}» уже не то, что напечатано на странице`).toContain(
        quote,
      );
    }
  });

  /**
   * `SharedArrayBuffer` — карточка раздела 3: он **клонируется**, а не переносится, и обе
   * стороны получают вид на одну память. Положить его в transfer-список — ошибка.
   *
   * ⚠️ Про cross-origin isolation тема говорит отдельно, и это браузерное: в Node изоляции нет.
   */
  it('`SharedArrayBuffer` клонируется и в transfer-список не кладётся', async () => {
    await withChannel((channel) => {
      const shared = new SharedArrayBuffer(8);
      new Uint8Array(shared)[0] = 9;

      expect(attempt(() => channel.port1.postMessage({ shared })), 'обычным сообщением уходит').toBe('');
      expect(shared.byteLength, 'у отправителя ничего не отцепилось — это не перенос').toBe(8);

      const got = (peek(channel.port2) as { shared: SharedArrayBuffer }).shared;
      expect(got, 'обе стороны смотрят в одну память').toBeInstanceOf(SharedArrayBuffer);
      expect(new Uint8Array(got)[0]).toBe(9);

      expect(
        attempt(() => channel.port1.postMessage({ shared }, [shared as unknown as ArrayBuffer])),
        'а в transfer-списке он недопустим',
      ).toBe('DataCloneError');
    });
  });
});

// ---------------------------------------------------------------------------
// Раздел 3 · что переживает клонирование
// ---------------------------------------------------------------------------

/**
 * Карточка раздела 3 перечисляет проходящие и непроходящие типы.
 *
 * ⚠️ Литерал живёт в `index.mdx`, внутри JSX, — импортировать его неоткуда, поэтому списки
 * продублированы здесь. Это худший вариант связи, чем у остальных блоков файла, и он выбран
 * сознательно: альтернатива — не проверять карточку вовсе.
 */
describe('клон — тот же алгоритм, что у structuredClone', () => {
  const passes: Record<string, () => unknown> = {
    Date: () => new Date(0),
    RegExp: () => /ab/g,
    Map: () => new Map([[1, 'a']]),
    Set: () => new Set([1]),
    TypedArray: () => new Uint8Array([1, 2, 3]),
    Error: () => new Error('boom'),
    BigInt: () => 1n,
    цикл: () => {
      const node: Record<string, unknown> = { n: 1 };
      node.self = node;
      return node;
    },
  };

  for (const [label, make] of Object.entries(passes)) {
    it(`${label} проходит клонирование`, () => {
      expect(attempt(() => void structuredClone(make()))).toBe('');
    });
  }

  it('и то же самое проходит через настоящий порт, а не только через structuredClone', async () => {
    await withChannel((channel) => {
      channel.port1.postMessage({
        date: new Date(0),
        re: /ab/g,
        map: new Map([[1, 'a']]),
        set: new Set([1]),
        ta: new Uint8Array([1, 2, 3]),
        err: new Error('boom'),
        big: 1n,
      });

      const got = peek(channel.port2) as Record<string, unknown>;
      expect(got.date).toBeInstanceOf(Date);
      expect(got.map).toBeInstanceOf(Map);
      expect(got.err).toBeInstanceOf(Error);
      expect(typeof got.big, 'BigInt доезжает биг-интом, а не строкой').toBe('bigint');
    });
  });

  it('цикл приезжает циклом: ссылка указывает на сам клон', () => {
    const source: Record<string, unknown> = { n: 1 };
    source.self = source;
    const clone = structuredClone(source);
    expect(clone.self, 'memory map сериализатора, а не бесконечная рекурсия').toBe(clone);
  });

  it('функция не клонируется — DataCloneError', () => {
    expect(attempt(() => void structuredClone({ f: () => {} }))).toBe('DataCloneError');
  });

  it('символ как значение — DataCloneError, а символьный ключ исчезает молча', () => {
    expect(attempt(() => void structuredClone(Symbol('id')))).toBe('DataCloneError');

    const clone = structuredClone({ [Symbol('id')]: 1, plain: 2 });
    expect(
      Reflect.ownKeys(clone),
      'вот это и есть «не проходят символьные ключи»: ни ошибки, ни ключа',
    ).toEqual(['plain']);
  });

  /**
   * Три обещания карточки разом — прототипы, `#`-поля и геттеры, — и все три молчат.
   * Геттер стоит разобрать отдельно: на прототипе он не попадает в клон **вовсе**,
   * а собственный вычисляется прямо во время клонирования и уезжает значением.
   */
  it('класс приезжает обычным объектом: ни прототипа, ни `#`-полей, ни геттера с прототипа', () => {
    class Money {
      #secret = 'приватное';
      currency = 'RUB';
      get amount(): number {
        return 100;
      }
      format(): string {
        return `${this.#secret} ${this.currency}`;
      }
    }

    const clone = structuredClone(new Money()) as unknown as Record<string, unknown>;

    expect(Object.getPrototypeOf(clone), 'клону выставляется Object.prototype').toBe(Object.prototype);
    expect(typeof clone.format, 'метод жил на прототипе — его нет').toBe('undefined');
    expect(Object.keys(clone), 'осталось одно собственное свойство').toEqual(['currency']);
    expect('amount' in clone, 'геттер объявлен на прототипе — сериализатор до него не доходит').toBe(
      false,
    );
    expect(
      Object.getOwnPropertyNames(clone).some((k) => k.includes('secret')),
      '`#`-поле не собственное свойство, а внутренний слот',
    ).toBe(false);
  });

  it('собственный геттер вызывается во время клонирования и уезжает уже значением', () => {
    let calls = 0;
    const source = {
      get lazy() {
        calls += 1;
        return 42;
      },
    };

    const clone = structuredClone(source) as { lazy: number };

    expect(calls, 'сериализатор сделал [[Get]] по собственному перечисляемому ключу').toBe(1);
    expect(Object.getOwnPropertyDescriptor(clone, 'lazy')?.get, 'в клоне это уже не геттер').toBeUndefined();
    expect(clone.lazy, 'связи с источником больше нет').toBe(42);
  });

  /**
   * ⚠️ Находка, а не проверка страницы: `Proxy` тема **не упоминает ни разу**, а он падает
   * DataCloneError — и для объекта, и для функции-цели. Причина не в ловушках: алгоритм
   * структурного клонирования не умеет экзотические объекты в принципе, и «прозрачный»
   * прокси над обычным объектом прозрачным здесь не оказывается. Ловушка практическая:
   * реактивное состояние Vue — это прокси, и `port.postMessage(state)` упадёт на ровном месте,
   * хотя `port.postMessage(toRaw(state))` пройдёт.
   */
  it('Proxy не клонируется — ни над объектом, ни над функцией', () => {
    expect(attempt(() => void structuredClone(new Proxy({ a: 1 }, {})))).toBe('DataCloneError');
    expect(attempt(() => void structuredClone(new Proxy(function stub() {}, {})))).toBe('DataCloneError');

    // Развёрнутая цель проходит — значит дело именно в прокси, а не в содержимом.
    expect(attempt(() => void structuredClone({ a: 1 }))).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Тонкое место 03 · порядок
// ---------------------------------------------------------------------------

describe(`${pitfall('03').n} · ${pitfall('03').t}`, () => {
  /**
   * «Внутри пары порядок отправки сохраняется всегда (проверено)» — единственная половина
   * утверждения, которую вообще можно доказать запуском. Берём заметную пачку: одиночная
   * пара ничего не показала бы.
   */
  it('двести сообщений в одном канале приходят ровно в порядке отправки', async () => {
    const count = 200;

    const got = await withChannel(({ port1, port2 }) => {
      for (let i = 0; i < count; i += 1) port2.postMessage(i);
      return collect(port1, count, 'FIFO внутри канала');
    });

    expect(got.length).toBe(count);
    expect(
      got.every((value, index) => value === index),
      'ни одной перестановки — очередь строго FIFO',
    ).toBe(true);
  });

  it('порядок держится и вперемешку с оборотами цикла', async () => {
    const got = await withChannel(async ({ port1, port2 }) => {
      port2.postMessage('первое');
      await turn();
      port2.postMessage('второе');
      await turn();
      port2.postMessage('третье');
      return collect(port1, 3, 'FIFO с паузами');
    });

    expect(got).toEqual(['первое', 'второе', 'третье']);
  });

  /**
   * ⚠️ Вторая половина тонкого места — «между разными каналами не гарантирован ничем» —
   * здесь только **описана**, и это осознанный отказ проверять. Утверждение отрицательное:
   * прогон, в котором порядок совпал, ничего не опровергает, а прогон, в котором разошёлся,
   * доказывал бы расхождение только на этой машине и в этой версии. Замер всё же делался
   * отдельно: два канала, отправка B → A, доставка пришла A → B — то есть порядок отправки
   * между каналами действительно не сохранился. Закреплять это тестом нельзя: он краснел бы
   * от смены реализации, а не от ошибки на странице.
   *
   * Проверяем поэтому то, что от утверждения проверяемо: оба сообщения доходят, и страница
   * называет лечение — слать по одному порту.
   */
  it('между двумя каналами доходит всё, но о порядке тема ничего не обещает', async () => {
    expect(pitfall('03').d, 'страница честно говорит «не гарантирован ничем»').toContain(
      'не гарантирован ничем',
    );
    expect(pitfall('03').d, 'и называет лечение').toContain('по одному порту');

    const a = new MessageChannel();
    const b = new MessageChannel();
    try {
      const seen: string[] = [];
      const done = Promise.all([
        nextMessage(a.port1, 'канал A').then(() => void seen.push('A')),
        nextMessage(b.port1, 'канал B').then(() => void seen.push('B')),
      ]);

      b.port2.postMessage(1);
      a.port2.postMessage(1);
      await done;

      expect(seen.sort(), 'доходят оба — утверждение только про порядок').toEqual(['A', 'B']);
    } finally {
      a.port1.close();
      a.port2.close();
      b.port1.close();
      b.port2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Тонкое место 04 · close() — не flush
// ---------------------------------------------------------------------------

describe(`${pitfall('04').n} · ${pitfall('04').t}`, () => {
  /** Первая половина: отправить и тут же закрыть **отправителя** — сообщение всё равно дойдёт. */
  it('отправили и закрыли свой конец — сообщение доезжает', async () => {
    expect(pitfall('04').d).toContain('сообщение дойдёт');

    const channel = new MessageChannel();
    try {
      channel.port2.postMessage('в полёте');
      channel.port2.close();

      await turns();
      const got = await collect(channel.port1, 1, 'после закрытия отправителя');
      expect(got, 'то, что уже в очереди получателя, ещё сработает').toEqual(['в полёте']);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  /** Вторая половина: закрыть **получателя** до подписки — буфер теряется вместе с портом. */
  it('закрыли получателя до подписки — буфер потерян целиком', async () => {
    expect(pitfall('04').d).toContain('потеряется вместе с буфером');

    const channel = new MessageChannel();
    try {
      channel.port2.postMessage('потеряется');
      channel.port1.close();

      const got: unknown[] = [];
      channel.port1.on('message', (value: unknown) => void got.push(value));
      await turns();

      expect(got, 'close() — не flush: очередь ушла вместе с портом').toEqual([]);
      expect(peek(channel.port1), 'и синхронно её тоже не достать').toBeUndefined();
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('`close()` расцепляет ОБЕ стороны, а не только свою', async () => {
    expect(PORT_LINES.closeOk.text).toContain('расцепил ОБЕ стороны');

    const channel = new MessageChannel();
    try {
      const got: unknown[] = [];
      channel.port2.on('message', (value: unknown) => void got.push(value));
      channel.port1.close();

      expect(attempt(() => channel.port2.postMessage('в закрытую сторону'))).toBe('');
      expect(attempt(() => channel.port1.postMessage('и обратно'))).toBe('');
      await turns();
      expect(got, 'сцепки больше нет ни в одну сторону').toEqual([]);
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Таблица «Node против браузера»
// ---------------------------------------------------------------------------

describe('Node против браузера — правая колонка таблицы', () => {
  /**
   * Синхронное чтение: то, чего в браузере нет принципиально. Проверяется не наличием
   * функции, а её эффектом — сообщение снимается с очереди **до** любого оборота цикла.
   */
  it('`receiveMessageOnPort` снимает сообщение синхронно, сразу после `postMessage`', async () => {
    expect(nodeRow('синхронное чтение').node).toContain('receiveMessageOnPort');
    expect(nodeRow('синхронное чтение').browser, 'в браузере такого нет').toBe('нет');

    await withChannel(({ port1, port2 }) => {
      port2.postMessage('sync');

      // Ни одного `await` между отправкой и чтением — в этом и весь смысл.
      expect(peek(port1), 'значение снято в том же обороте, что и отправлено').toBe('sync');
      expect(receiveMessageOnPort(port1), 'очередь опустела — второй раз приходит undefined').toBeUndefined();
    });
  });

  it('синхронное чтение забирает сообщения тоже в порядке отправки', async () => {
    await withChannel(({ port1, port2 }) => {
      port2.postMessage(1);
      port2.postMessage(2);
      expect([peek(port1), peek(port1), peek(port1)]).toEqual([1, 2, undefined]);
    });
  });

  /**
   * Событие `close` на напарнике: в Node есть, в браузерах поддержка неполная —
   * ровно это утверждают и таблица, и тонкое место 01.
   */
  it("`close()` одной стороны поднимает событие 'close' на напарнике", async () => {
    expect(nodeRow('событие close').node).toBe('есть');
    expect(nodeRow('событие close').browser, 'про браузер тема говорит осторожно').toContain(
      'неполная',
    );
    expect(pitfall('01').d, 'и тонкое место повторяет это').toContain('в Node есть');

    const channel = new MessageChannel();
    try {
      const closed = new Promise<void>((resolve, reject) => {
        const guard = setTimeout(() => reject(new Error("событие 'close' не пришло")), GUARD_MS);
        channel.port1.once('close', () => {
          clearTimeout(guard);
          resolve();
        });
      });

      channel.port2.close();
      await closed;
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  /**
   * «Держит ли порт рантайм живым: ДА, снимается `port.unref()`» — утверждение о процессе
   * целиком, и внутри прогона его не показать: незавершившийся процесс здесь выглядел бы
   * зависшим Vitest. Поэтому оба варианта запускаются отдельным процессом.
   *
   * ⚠️ Это и есть та самая утечка из раздела 5, только в её наблюдаемой форме.
   */
  it('слушающий порт не даёт процессу выйти, а `unref()` даёт', () => {
    expect(nodeRow('держит ли порт рантайм').node).toContain('unref');

    const script = (unref: boolean) =>
      [
        "const { MessageChannel } = require('node:worker_threads');",
        'const { port1 } = new MessageChannel();',
        "port1.on('message', () => {});",
        unref ? 'port1.unref();' : '',
        "console.log('конец скрипта');",
      ]
        .filter(Boolean)
        .join('\n');

    const holding = runInNode(script(false));
    expect(holding.stdout, 'скрипт дошёл до конца').toBe('конец скрипта');
    expect(
      holding.exitedOnItsOwn,
      'и всё равно не вышел: слушающий порт — активный хэндл',
    ).toBe(false);

    const released = runInNode(script(true));
    expect(released.stdout).toBe('конец скрипта');
    expect(released.exitedOnItsOwn, '`unref()` снял удержание — процесс вышел сам').toBe(true);
    // ⚠️ Свой срок: удерживающий процесс дожидается собственного таймаута, и стандартных
    // пяти секунд Vitest на два запуска не хватает. Проверка от этого числа не зависит —
    // оно только должно быть больше, чем `timeout` у `spawnSync` внутри `runInNode`.
  }, 20_000);

  /** Порт без слушателя рантайм не держит — иначе `unref()` был бы не нужен, а строка врала. */
  it('а порт без слушателя процесс не держит — удерживает именно подписка', () => {
    const idle = runInNode(
      [
        "const { MessageChannel } = require('node:worker_threads');",
        'new MessageChannel();',
        "console.log('конец скрипта');",
      ].join('\n'),
    );

    expect(idle.exitedOnItsOwn, 'очередь выключена, доставлять некому — держать нечего').toBe(true);
  });

  /**
   * Две последние строки таблицы — правка автора против оригинала, и проверяется
   * именно разница: `KeyObject` уходит обычным сообщением, `FileHandle` — только переносом.
   */
  it('`KeyObject` клонируется обычным сообщением', async () => {
    expect(nodeRow('что ещё клонируется').node).toContain('KeyObject');

    await withChannel(({ port1, port2 }) => {
      const key = createSecretKey(Buffer.alloc(16));
      expect(attempt(() => port2.postMessage({ key })), 'transfer-список не нужен').toBe('');
      expect(peek(port1), 'и он действительно приехал').toBeDefined();
    });
  });

  it('`FileHandle` только переносится: без списка — DataCloneError, со списком — уходит', async () => {
    expect(nodeRow('что только переносится').node).toContain('FileHandle');

    const handle = await open(new URL(import.meta.url), 'r');
    try {
      await withChannel(({ port2 }) => {
        expect(
          attempt(() => port2.postMessage({ handle })),
          'обычным сообщением уходить отказывается',
        ).toBe('DataCloneError');
      });

      await withChannel(({ port1, port2 }) => {
        expect(
          attempt(() => port2.postMessage({ handle }, [handle as unknown as ArrayBuffer])),
          'а в transfer-списке проходит',
        ).toBe('');
        expect(peek(port1), 'и приезжает на ту сторону').toBeDefined();
      });
    } finally {
      // Хэндл перенесён, поэтому закрытие здесь уже может не относиться к живому объекту —
      // но оставлять его непогашенным нельзя тем более.
      await handle.close().catch(() => undefined);
    }
  });
});

// ---------------------------------------------------------------------------
// Что в Node проверить нельзя
// ---------------------------------------------------------------------------

/**
 * ⚠️ Браузерная половина темы — список, а не умолчание.
 *
 * Пропустить её молча было бы хуже всего: «тесты зелёные» тогда означало бы «проверена
 * половина». Здесь перечислено, чего в этой среде нет, и закреплено, что тема про эти места
 * говорит осторожно, а не выдаёт их за проверенные.
 */
describe('браузерная половина: чего в Node нет и почему это не проверено', () => {
  it('DOM-узла в Node не существует — «не проходят DOM-узлы» здесь непроверяемо', () => {
    expect(typeof globalThis.document, 'документа нет — клонировать нечего').toBe('undefined');
  });

  it('левая колонка таблицы про `addEventListener` осталась словом автора', () => {
    // В браузере этот же вызов очередь НЕ включает. В Node такого состояния не получить:
    // порт стартует сам, и «тишины без start()» здесь не воспроизвести ни одним способом.
    expect(nodeRow('addEventListener без start()').browser).toBe('НЕ доставляет');
    expect(nodeRow('addEventListener без start()').node).toContain('авто-start');
    expect(PORT_LINES.listen.text, 'песочница честно разводит две среды').toContain('в БРАУЗЕРЕ');
  });

  it('`messageerror` в теме помечен как браузерный механизм, и здесь его не вызвать', () => {
    // Событие поднимается, когда сообщение не десериализовалось в целевом realm:
    // SharedArrayBuffer в неизолированный контекст, объекты из чужого agent cluster.
    // В одном процессе Node такого realm нет.
    expect(pitfall('05').d).toContain('не десериализовалось в целевом realm');
    expect(pitfall('05').d).toContain('SharedArrayBuffer');
  });

  it('кламп и троттлинг таймеров — свойство браузера, и таблица инструментов это знает', () => {
    expect(pitfall('06').d, 'заморозка вкладки, bfcache и выгрузка на мобильных').toContain('bfcache');
  });
});

// ---------------------------------------------------------------------------
// Листинги, которые печатает тема: исполняется тот же текст, что видит читатель
// ---------------------------------------------------------------------------

/** Дождаться условия, проворачивая цикл; предохранитель — не утверждение о времени. */
async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (check()) return;
    await turn();
  }
  throw new Error(`не дождались: ${what}`);
}

describe('«Сколько можно послать за раз»: сообщение упаковано в момент вызова', () => {
  it('правка объекта после `postMessage` не доезжает — уехал снимок', async () => {
    const logged: unknown[] = [];
    new Function('MessageChannel', 'console', SNAPSHOT_CODE)(MessageChannel, {
      log: (v: unknown) => logged.push(v),
    });
    await until(() => logged.length > 0, 'вывод листинга');
    expect(logged).toEqual([['хлеб']]);
    expect(SIZE_NOTE, 'текст ссылается ровно на это наблюдение').toContain('правка после отправки не доезжает');
  });
});

describe('`SharedWorker`: листинги раздела «Применение»', () => {
  type Connect = (e: { ports: MessagePort[] }) => void;

  /** Запустить код воркера с поддельным `self`; порты — настоящие, из Node. */
  function bootWorker(): Connect {
    const self: { onconnect?: Connect } = {};
    new Function('self', SHARED_WORKER_CODE)(self);
    if (!self.onconnect) throw new Error('листинг воркера не назначил self.onconnect');
    return self.onconnect;
  }

  it('один экземпляр раздаёт счётчик всем вкладкам, а «bye» снимает вкладку с рассылки', async () => {
    const connect = bootWorker();
    const a = new MessageChannel();
    const b = new MessageChannel();
    try {
      connect({ ports: [a.port1] });
      connect({ ports: [b.port1] });
      const inbox = { a: [] as unknown[], b: [] as unknown[] };
      const drain = () => {
        for (const [key, port] of [['a', a.port2], ['b', b.port2]] as const) {
          for (let m = receiveMessageOnPort(port); m; m = receiveMessageOnPort(port)) inbox[key].push(m.message);
        }
      };

      a.port2.postMessage('inc');
      await until(() => (drain(), inbox.a.length === 1 && inbox.b.length === 1), 'рассылка после первого inc');
      b.port2.postMessage('inc');
      await until(() => (drain(), inbox.a.length === 2 && inbox.b.length === 2), 'рассылка после второго inc');
      expect(inbox).toEqual({ a: [1, 2], b: [1, 2] });

      // «bye» и следующий «inc» идут по одному порту — порядок между ними гарантирован.
      a.port2.postMessage('bye');
      a.port2.postMessage('inc');
      await until(() => (drain(), inbox.b.length === 3), 'рассылка после ухода вкладки');
      drain();
      expect(inbox.b.at(-1), 'счёт идёт дальше').toBe(3);
      expect(inbox.a, 'ушедшей вкладке больше не пишут').toEqual([1, 2]);
    } finally {
      for (const port of [a.port1, a.port2, b.port1, b.port2]) port.close();
    }
  });

  it('вкладка: подключается, рисует ответ и прощается на `pagehide`', async () => {
    const channel = new MessageChannel();
    const urls: string[] = [];
    const listeners: Record<string, () => void> = {};
    class FakeSharedWorker {
      port = channel.port1;
      constructor(url: string) {
        urls.push(url);
      }
    }
    const counter = { textContent: null as unknown };
    try {
      new Function('SharedWorker', 'counter', 'addEventListener', SHARED_PAGE_CODE)(
        FakeSharedWorker,
        counter,
        (type: string, fn: () => void) => void (listeners[type] = fn),
      );
      expect(urls).toEqual(['/counter.js']);

      const worker = channel.port2; // сторона воркера
      await until(() => receiveMessageOnPort(worker)?.message === 'inc', 'inc от вкладки');
      worker.postMessage(1);
      await until(() => counter.textContent === 1, 'ответ воркера на странице');

      expect(Object.keys(listeners), 'подписка ровно на pagehide').toEqual(['pagehide']);
      listeners.pagehide();
      expect(receiveMessageOnPort(worker)?.message).toBe('bye');
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  });

  it('карточка про уход вкладки называет решение, которое стоит в листинге', () => {
    const leave = SHARED_FACTS.find((f) => f.t.includes('уходе вкладки'));
    expect(leave?.d).toContain('pagehide');
    expect(SHARED_PAGE_CODE).toContain("'pagehide'");
  });
});
