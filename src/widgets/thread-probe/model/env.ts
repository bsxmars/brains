import type { EnvRow } from './types';

/**
 * Что вкладка говорит о себе сама — вопросами к платформе, а не таблицей в данных урока.
 *
 * Правило курса на этот счёт прямое (`AGENTS.md`, «Таблицу о поведении языка не набирают —
 * её вычисляют»): величина, которую видно из браузера, обязана спрашиваться у браузера.
 * Всё, что ниже, спрашивается в момент нажатия и печатается как есть.
 *
 * ⚠️ Привычная обёртка `try { new SharedArrayBuffer(1) } catch` **ловит не то**. На этом сайте
 * конструктора нет как имени, и такая проверка поймает `ReferenceError` о несуществующей
 * переменной — ошибку про орфографию, а не про изоляцию. Единственная верная проверка —
 * `typeof SharedArrayBuffer === 'undefined'`.
 *
 * ⚠️ Имя ошибки нормативно, текст — нет. `Atomics.wait` на главном потоке обязан дать
 * `TypeError`; дословная фраза V8 — дело сборки, поэтому имя лежит в значении строки,
 * а сообщение уходит в пояснение с оговоркой.
 *
 * ⚠️ Все обращения к среде — **внутри** функций: остров сперва рендерится в Node, и чтение
 * `navigator` на уровне модуля уронило бы сборку всей страницы.
 */

/** `Atomics.wait` через узкий интерфейс: предмет проверки — что бросит движок, а не типы. */
interface AtomicsLike {
  wait(view: Int32Array, index: number, value: number, timeout: number): string;
}

function waitRow(): EnvRow {
  if (typeof Atomics === 'undefined') {
    return {
      key: 'wait',
      label: 'Atomics.wait на главном потоке',
      value: 'спрашивать нечего',
      tone: 'dim',
      note: 'самого `Atomics` в этой среде нет',
    };
  }

  // Ожидаемое значение намеренно не совпадает с содержимым, а таймаут нулевой: даже там,
  // где `wait` разрешён, он обязан вернуться немедленно. Демо не имеет права заморозить вкладку.
  const view = new Int32Array(new ArrayBuffer(8));

  try {
    const result = (Atomics as unknown as AtomicsLike).wait(view, 0, 1, 0);
    return {
      key: 'wait',
      label: 'Atomics.wait на главном потоке',
      value: `вернул '${result}'`,
      tone: 'warn',
      note: 'в браузере этого быть не должно: у агента документа `[[CanBlock]]` равен `false`',
    };
  } catch (failure) {
    const error = failure as { name?: string; message?: string };
    return {
      key: 'wait',
      label: 'Atomics.wait на главном потоке',
      value: error?.name ?? 'Error',
      tone: 'ok',
      note: `так и задумано: заблокированный главный поток не прочитал бы сообщение, которое его разбудит. Имя ошибки нормативно, текст — нет: «${error?.message ?? ''}»`,
    };
  }
}

/** Опрос вкладки. Синхронный и дешёвый: ни одного цикла, только чтение свойств. */
export function probeEnvironment(): EnvRow[] {
  const rows: EnvRow[] = [];

  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  rows.push({
    key: 'cores',
    label: 'navigator.hardwareConcurrency',
    value: typeof cores === 'number' ? String(cores) : 'нет такого свойства',
    tone: typeof cores === 'number' ? 'ok' : 'dim',
    note: 'Это **не «сколько у вас ядер»**, а верхняя оценка параллелизма: сколько воркеров имеет смысл заводить. Ядра бывают разной скорости, рядом живут другие вкладки, а браузер вправе округлить это число или занизить его ради приватности.',
  });

  const workers = typeof Worker !== 'undefined';
  rows.push({
    key: 'worker',
    label: 'typeof Worker',
    value: workers ? "'function'" : "'undefined'",
    tone: workers ? 'ok' : 'err',
    note: workers
      ? 'второй поток странице доступен — замер слева поднимает настоящий `Worker`, а не таймер'
      : 'второго потока здесь взять неоткуда',
  });

  const isolated = typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : undefined;
  rows.push({
    key: 'isolated',
    label: 'crossOriginIsolated',
    value: String(isolated),
    tone: isolated ? 'ok' : 'warn',
    note: isolated
      ? 'документ изолирован: общая память и точные часы доступны'
      : 'сайт статический, заголовков `COOP`/`COEP` у него нет — и это видно отсюда, а не из документации: без изоляции браузер грубит часы и прячет общую память',
  });

  const shared = typeof SharedArrayBuffer;
  rows.push({
    key: 'sab',
    label: 'typeof SharedArrayBuffer',
    value: `'${shared}'`,
    tone: shared === 'function' ? 'ok' : 'err',
    note:
      shared === 'function'
        ? 'конструктор есть — но сам по себе он ничего не доказывает: браузеры оставляли его и без изоляции'
        : 'конструктора нет **как имени**, поэтому `new SharedArrayBuffer(8)` дал бы `ReferenceError`, а не `SecurityError`: ошибку про несуществующую переменную, а не про запрет',
  });

  const atomics = typeof Atomics;
  rows.push({
    key: 'atomics',
    label: 'typeof Atomics',
    value: `'${atomics}'`,
    tone: atomics === 'object' ? 'ok' : 'dim',
    note: 'объект на месте, хотя разделяемого буфера нет: прячут не `Atomics`, а память, на которую он смотрит',
  });

  rows.push(waitRow());

  return rows;
}

/**
 * Изоляция кадра — тем же способом, каким её проверяет сам браузер.
 *
 * Кадр с чужого домена сюда не годится: он тянет сеть, мигает и зависит от того, кто что
 * отдаёт сегодня. Здесь `srcdoc` и `sandbox` без `allow-same-origin` — документ получает
 * непрозрачный источник, оставаясь в этой же вкладке. Обращение к его `contentDocument`
 * обязано быть отказано, и отказ приходит без единого запроса в сеть.
 *
 * Хозяин кадра — переданный узел: остров живёт внутри страницы урока, и вешать служебный
 * `iframe` в `document.body` значило бы мусорить в чужом дереве.
 */
export function probeFrameIsolation(host: HTMLElement | null): Promise<EnvRow> {
  const key = 'frame';
  const label = 'contentDocument чужого кадра';

  if (typeof document === 'undefined' || !host) {
    return Promise.resolve({
      key,
      label,
      value: 'проверять негде',
      tone: 'dim',
      note: 'нет документа, в который можно было бы поставить кадр',
    });
  }

  return new Promise<EnvRow>((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', '');
    frame.srcdoc = '<!doctype html><title>изолированный кадр</title><p>чужой документ';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0';

    const done = (row: EnvRow) => {
      frame.remove();
      resolve(row);
    };

    frame.onload = () => {
      try {
        const reached = frame.contentDocument;
        done({
          key,
          label,
          value: reached ? 'документ прочитан' : 'вернул null',
          tone: reached ? 'err' : 'ok',
          note: reached
            ? 'чтения быть не должно: кадр объявлен `sandbox` без `allow-same-origin`'
            : 'границу видно и без исключения: браузер отдал `null` вместо чужого документа',
        });
      } catch (failure) {
        const error = failure as { name?: string; message?: string };
        done({
          key,
          label,
          value: error?.name ?? 'Error',
          tone: 'ok',
          note: `кадр с \`sandbox\` без \`allow-same-origin\` получил непрозрачный источник, и граница держится сама — без единого запроса в сеть: документ приехал из \`srcdoc\`. Имя ошибки нормативно, текст — нет: «${error?.message ?? ''}»`,
        });
      }
    };

    host.appendChild(frame);
  });
}
