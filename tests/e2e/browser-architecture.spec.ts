import { expect, test } from '@playwright/test';
import { OBSERVABLE } from '../../src/content/lessons/browser-architecture/data';

/**
 * Раздел 0 «Граница наблюдаемого» темы «Устройство браузера»: таблица `OBSERVABLE` — не пересказ
 * документации, а **снятые значения**. Сняты они разово, в Chrome 153.0.8010.12 на собранной
 * странице этого сайта, и по правилу курса такому числу нужен сторож: «проверено запуском»
 * относится к тому запуску, которого больше никто не повторит.
 *
 * Юнит-тестом это не закрыть: в Node нет ни `crossOriginIsolated`, ни `window.opener`,
 * ни политики, из-за которой `SharedArrayBuffer` отсутствует. Спрашивать обязан настоящий
 * браузер — отсюда e2e.
 *
 * Устройство проверки: **тема — заявление, браузер — ответ, тест ловит расхождение.** Ожидания
 * не переписаны сюда литералами: каждая проверка достаёт утверждение из `OBSERVABLE` через
 * `claim()` и сверяет его с тем, что вернул Chromium. Если в таблице появится `function` там,
 * где браузер отвечает `undefined`, — краснеет тест, а не читатель.
 *
 * ⚠️ **Закрепляется свойство, а не число.** `navigator.hardwareConcurrency` — единственная
 * строка таблицы, зависящая от железа; её значение (`8`) не сверяется ни с чем и сверяться
 * не должно, иначе проверка покраснеет от смены машины, а не от ошибки. Закрепляется форма:
 * величина есть, это целое больше нуля, и тема подаёт её как снятую, а не как общий факт.
 * Остальные строки — структурные: они следуют из того, что заголовков `Cross-Origin-Opener-Policy`
 * и `Cross-Origin-Embedder-Policy` в проекте нет нигде, а сайт раздаётся статикой.
 *
 * ⚠️ Имя ошибки нормативно, текст — нет: проверяется `name` и `instanceof`, а не сообщение V8.
 *
 * Чего здесь нет намеренно: число процессов, память процесса, Spare Renderer, границы изолятов
 * и диспетчер задач — со страницы они не наблюдаемы в принципе, и подделывать их нечем.
 *
 * `document.domain` проверяется отдельно и не на странице курса: умолчание зависит от схемы
 * (HTTPS против HTTP), а курс раздаётся по `http://localhost`. Поэтому стенд — свой контекст
 * с перехваченными ответами на синтетических хостах (последняя проверка файла).
 */
const PAGE = '/js/browser-architecture/';

/** Вопросы таблицы — ключи, по которым проверки достают утверждение темы. */
const Q = {
  cores: '`navigator.hardwareConcurrency`',
  isolated: '`crossOriginIsolated`',
  sabName: '`typeof SharedArrayBuffer`',
  sabNew: '`new SharedArrayBuffer(8)`',
  atomics: '`typeof Atomics`',
  wait: '`Atomics.wait` в главном потоке',
  opener: '`window.opener` в ссылке с `target="_blank"`',
} as const;

/** Ячейка ответа целиком — вместе с пояснением после значения. */
function answer(question: string): string {
  const row = OBSERVABLE.find(([asked]) => asked === question);
  if (!row) {
    throw new Error(
      `в OBSERVABLE нет строки «${question}»: таблицу переписали, а сторож остался прежним`,
    );
  }
  return row[1];
}

/**
 * Само утверждение — первое значение в ячейке: `` `undefined` — имени нет `` → `undefined`.
 *
 * Пояснение после значения — текст для читателя, и сверять его с движком нельзя: оно про
 * причину, а не про ответ.
 */
function claim(question: string): string {
  const cell = answer(question);
  const value = cell.match(/^`([^`]+)`/);
  if (!value) {
    throw new Error(
      `ответ на «${question}» не начинается со значения в обратных кавычках: «${cell}». ` +
        'Сторож читает утверждение темы отсюда — без него сверять не с чем.',
    );
  }
  return value[1];
}

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
});

/**
 * Сторож сторожа: список вопросов закреплён целиком.
 *
 * Без этого таблица тихо растёт мимо проверок — новая строка просто не будет никем спрошена,
 * а прогон останется зелёным. Красный тест здесь значит «допишите проверку», а не «откатите
 * данные».
 */
test('таблица раздела 0 не менялась мимо сторожа', () => {
  expect(
    OBSERVABLE.map(([asked]) => asked),
    'в OBSERVABLE изменился набор вопросов: допишите проверку на новую строку — ' +
      'иначе снятое значение снова останется без сторожа',
  ).toEqual(Object.values(Q));
});

test('сайт не изолирован по источнику: crossOriginIsolated === false', async ({ page }) => {
  const seen = await page.evaluate(() => window.crossOriginIsolated);

  // Структурное свойство, а не особенность машины: заголовков COOP/COEP в проекте нет нигде,
  // сайт статический. Появятся заголовки — покраснеет и эта проверка, и таблица темы.
  expect(seen, 'страница изолирована по источнику — значит, в проекте появились COOP/COEP').toBe(
    false,
  );
  expect(claim(Q.isolated), 'тема обещает не то, что ответил браузер').toBe(String(seen));
});

test('SharedArrayBuffer отсутствует как имя, а не как право', async ({ page }) => {
  const seen = await page.evaluate(() => typeof SharedArrayBuffer);

  expect(seen, 'конструктор появился: изоляция по источнику включилась').toBe('undefined');
  expect(claim(Q.sabName), 'тема обещает не то, что ответил браузер').toBe(seen);
});

/**
 * Ядро раздела: привычная обёртка `try { new SharedArrayBuffer(1) } catch` ловит **не то**.
 *
 * Отказа в правах здесь нет — нет самого имени, поэтому это `ReferenceError` о несуществующей
 * переменной, а не `SecurityError`. Разница видна только по имени ошибки, и код, который
 * диагностирует «SAB запрещён» по факту исключения, ошибается молча.
 */
test('new SharedArrayBuffer(8) бросает ReferenceError, а не SecurityError', async ({ page }) => {
  const seen = await page.evaluate(() => {
    try {
      const shared = new SharedArrayBuffer(8);
      return { threw: false, name: '', reference: false, dom: false, size: shared.byteLength };
    } catch (error) {
      return {
        threw: true,
        // ⚠️ Имя нормативно, текст — нет: сообщение V8 сюда не попадает.
        name: error instanceof Error ? error.name : typeof error,
        reference: error instanceof ReferenceError,
        dom: typeof DOMException !== 'undefined' && error instanceof DOMException,
        size: 0,
      };
    }
  });

  expect(seen.threw, `конструктор отработал и выдал буфер на ${seen.size} байт`).toBe(true);
  expect(seen.name, 'изменилось имя ошибки — обёртка в демо ловит уже не то').toBe('ReferenceError');
  expect(seen.reference, 'ошибка не наследует ReferenceError').toBe(true);
  expect(
    seen.dom,
    'ошибка оказалась DOMException — это отказ в правах, а раздел утверждает обратное: ' +
      'имени нет вовсе',
  ).toBe(false);

  expect(claim(Q.sabNew), 'тема обещает не то, что ответил браузер').toBe(seen.name);
  expect(
    answer(Q.sabNew),
    'из ответа пропало упоминание SecurityError — а вся строка про то, что это НЕ он',
  ).toContain('SecurityError');
});

/**
 * Асимметрия, ради которой строка и стоит в таблице: разделяемого буфера нет, а объект
 * `Atomics` есть. Отсюда и ловушка проверки «умеет ли платформа в разделяемую память»
 * по наличию `Atomics`.
 */
test('Atomics существует, хотя разделяемого буфера нет', async ({ page }) => {
  const seen = await page.evaluate(() => typeof Atomics);

  expect(seen, 'объект Atomics исчез — асимметрия раздела 0 перестала быть правдой').toBe('object');
  expect(claim(Q.atomics), 'тема обещает не то, что ответил браузер').toBe(seen);
});

/**
 * `Atomics.wait` запрещён в главном потоке отдельно и независимо от изоляции.
 *
 * ⚠️ Разделяемый буфер здесь создать нечем (см. проверку выше), поэтому вызов идёт на обычном
 * `Int32Array`. Обе возможные причины отказа — «буфер не разделяемый» и «главный поток не
 * может блокироваться» — дают `TypeError`, так что наблюдаемое имя устойчиво.
 *
 * Сначала проверяется, что метод вообще есть: если бы `Atomics.wait` оказался `undefined`,
 * вызов тоже бросил бы `TypeError`, и проверка прошла бы по неверной причине.
 */
test('Atomics.wait в главном потоке бросает TypeError', async ({ page }) => {
  const seen = await page.evaluate(() => {
    const kind = typeof Atomics.wait;
    const cell = new Int32Array(new ArrayBuffer(4));
    try {
      return { kind, threw: false, name: '', type: false, verdict: Atomics.wait(cell, 0, 1, 0) };
    } catch (error) {
      return {
        kind,
        threw: true,
        name: error instanceof Error ? error.name : typeof error,
        type: error instanceof TypeError,
        verdict: '',
      };
    }
  });

  expect(seen.kind, 'Atomics.wait отсутствует — тогда TypeError придёт не от запрета').toBe(
    'function',
  );
  expect(seen.threw, `вызов прошёл и вернул «${seen.verdict}»: главный поток заблокировался`).toBe(
    true,
  );
  expect(seen.name, 'изменилось имя ошибки').toBe('TypeError');
  expect(seen.type, 'ошибка не наследует TypeError').toBe(true);
  expect(claim(Q.wait), 'тема обещает не то, что ответил браузер').toBe(seen.name);
});

/**
 * `<a target="_blank">` подразумевает `noopener` сам — с Chrome 88, Firefox 79 и Safari 12.1.
 * Оригинал темы утверждал обратное, и правка держится на этом замере.
 *
 * Якорь ставится фиксированно поверх всего: полоса разделов и стрелка «все темы» липнут
 * к верху окна и накрывают элемент, поставленный в поток, — клик тогда уходит не туда.
 */
test('вкладка из target="_blank" не видит открывателя', async ({ page, context }) => {
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/';
    link.target = '_blank';
    link.id = 'e2e-blank-probe';
    link.textContent = 'проба';
    link.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:4px';
    document.body.append(link);
  });

  const [opened] = await Promise.all([
    context.waitForEvent('page'),
    page.click('#e2e-blank-probe'),
  ]);
  await opened.waitForLoadState('domcontentloaded');

  // Значение приводится к строке прямо в браузере: `null` и «объект есть» иначе не различить
  // на выходе из evaluate.
  const seen = await opened.evaluate(() =>
    window.opener === null ? 'null' : `${typeof window.opener}`,
  );
  await opened.close();

  expect(seen, 'открытая вкладка видит открывателя — noopener перестал подразумеваться').toBe(
    'null',
  );
  expect(claim(Q.opener), 'тема обещает не то, что ответил браузер').toBe(seen);
});

/**
 * Ядро темы: поток унести можно. Проверяется не наличие имени, а то, что рабочий поток
 * действительно заводится и отвечает, — на этом стоит весь раздел про воркеры.
 */
test('Worker доступен: поток унести можно', async ({ page }) => {
  const seen = await page.evaluate(async () => {
    const kind = typeof Worker;
    if (kind !== 'function') return { kind, echo: '' };

    const source = URL.createObjectURL(
      new Blob(['self.onmessage = (e) => self.postMessage(e.data)'], { type: 'text/javascript' }),
    );
    const worker = new Worker(source);
    try {
      return {
        kind,
        echo: await new Promise<string>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent) => resolve(String(event.data));
          worker.onerror = () => reject(new Error('воркер не запустился'));
          worker.postMessage('пинг');
        }),
      };
    } finally {
      worker.terminate();
      URL.revokeObjectURL(source);
    }
  });

  expect(seen.kind, 'конструктора Worker нет — тема обещает обратное').toBe('function');
  expect(seen.echo, 'воркер не ответил: отдельный поток со страницы не заводится').toBe('пинг');
});

/**
 * ⚠️ Единственная строка таблицы, зависящая от железа. Значение `8` — с машины автора, и
 * сверять его здесь нельзя: тест, закрепивший число, покраснеет от смены машины, а не от ошибки.
 *
 * Закрепляется форма ответа с обеих сторон: браузер обязан вернуть целое больше нуля, а тема —
 * утверждать именно число, а не «ядра» или прочерк.
 */
test('hardwareConcurrency: закрепляется величина, а не число', async ({ page }) => {
  const seen = await page.evaluate(() => navigator.hardwareConcurrency);

  expect(typeof seen, 'платформа перестала сообщать число').toBe('number');
  expect(Number.isInteger(seen), `hardwareConcurrency пришёл дробным: ${seen}`).toBe(true);
  expect(seen, `hardwareConcurrency неположителен: ${seen}`).toBeGreaterThan(0);

  const told = claim(Q.cores);
  expect(told, `в таблице стоит не число, а «${told}»`).toMatch(/^\d+$/);
  expect(Number(told), 'в таблице неположительное число ядер').toBeGreaterThan(0);
});

/**
 * Число ядер подано как снятое на конкретной машине, а не как общий факт платформы.
 *
 * Это единственная защита от того, чтобы `8` начало читаться как свойство браузера: сверить
 * само число нельзя (см. выше), поэтому закрепляется оговорка вокруг него. Уйдёт рамка «сняли
 * здесь, вот версия Chrome» — и таблица превратится в обещание, которого тема давать не может.
 */
test('раздел 0 подаёт значения как снятые, а не как общий факт', async ({ page }) => {
  const text = await page.evaluate(() => {
    const section = document.getElementById('s0');
    return (section?.textContent ?? '').replace(/\s+/g, ' ');
  });

  expect(text, 'на странице нет раздела s0 «Граница наблюдаемого»').not.toBe('');
  expect(
    text,
    'из раздела 0 пропала оговорка о том, что значения сняты на этой странице: ' +
      'без неё число ядер читается как общий факт платформы',
  ).toContain('сняты на собранной странице этого сайта');
  expect(
    text,
    'из раздела 0 пропала версия браузера, на которой снята таблица',
  ).toMatch(/Chrome \d+(\.\d+)*/);
});

/**
 * Сторожим ту таблицу, которую видит читатель, а не мёртвый экспорт: каждый вопрос из
 * `OBSERVABLE` обязан быть на странице.
 *
 * Сверяется первое имя из вопроса, а не строка целиком: остальное едет через `inlineMd`
 * и на странице выглядит иначе, чем в данных.
 */
test('таблица раздела 0 действительно на странице', async ({ page }) => {
  const text = await page.evaluate(() => {
    const section = document.getElementById('s0');
    return (section?.textContent ?? '').replace(/\s+/g, ' ');
  });

  const missing = OBSERVABLE.map(([asked]) => asked.match(/`([^`]+)`/)?.[1] ?? asked).filter(
    (name) => !text.includes(name),
  );

  expect(missing, `вопросы из OBSERVABLE не найдены в разделе 0: ${missing.join(', ')}`).toEqual([]);
});

/**
 * Раздел 1, карточка про `document.domain`: сеттер выключает группировка документа по origin
 * (`window.originAgentCluster === true`), а умолчание зависит от схемы. Снято 2026-10-01
 * в Chrome 153.0.8010.12 и перепроверено настоящим https-сервером: прежний замер темы шёл
 * по обычному http — ровно там, где умолчание обратное, — и тема утверждала «по умолчанию
 * работает».
 *
 * Свой контекст с перехватом: ответы синтетические, сеть и DNS не нужны. Чужой домен
 * в каждом режиме обязан давать `SecurityError` — иначе проверка не отличила бы «no-op» от
 * «присвоение вообще ничего не проверяет».
 */
test('document.domain: на HTTPS по умолчанию no-op, ?0 возвращает, на HTTP работает всегда', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await context.route('**/*', (route) => {
    const oac = new URL(route.request().url()).searchParams.get('oac');
    const headers: Record<string, string> = { 'content-type': 'text/html' };
    if (oac) headers['origin-agent-cluster'] = oac;
    return route.fulfill({ status: 200, headers, body: '<!doctype html><title>oac</title>' });
  });

  const probe = async (url: string) => {
    const page = await context.newPage();
    await page.goto(url);
    const seen = await page.evaluate(() => {
      const out = { keyed: window.originAgentCluster, after: '', foreign: '' };
      document.domain = 'shop.test';
      out.after = document.domain;
      try {
        document.domain = 'other.test';
        out.foreign = 'прошло';
      } catch (error) {
        out.foreign = error instanceof Error ? error.name : String(error);
      }
      return out;
    });
    await page.close();
    return seen;
  };

  try {
    const httpsDefault = await probe('https://a.shop.test/');
    const httpsOne = await probe('https://a.shop.test/?oac=%3F1');
    const httpsZero = await probe('https://a.shop.test/?oac=%3F0');
    const httpOne = await probe('http://a.shop.test/?oac=%3F1');

    expect(httpsDefault, 'HTTPS без заголовка перестал группироваться по origin').toEqual({
      keyed: true,
      after: 'a.shop.test',
      foreign: 'SecurityError',
    });
    expect(httpsOne, '?1 на HTTPS повёл себя не как умолчание').toEqual(httpsDefault);
    expect(httpsZero, '?0 не вернул группировку по сайту').toEqual({
      keyed: false,
      after: 'shop.test',
      foreign: 'SecurityError',
    });
    expect(httpOne, 'на HTTP заголовок вдруг подействовал').toEqual(httpsZero);
  } finally {
    await context.close();
  }
});
